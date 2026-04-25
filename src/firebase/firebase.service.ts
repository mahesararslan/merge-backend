import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private firebaseApp: admin.app.App;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const privateKey = this.configService
      .get('FIREBASE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (!privateKey) {
      this.logger.warn(
        'Firebase credentials not configured. FCM will not work.',
      );
      return;
    }

    try {
      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.configService.get('FIREBASE_PROJECT_ID'),
          privateKey,
          clientEmail: this.configService.get('FIREBASE_CLIENT_EMAIL'),
        }),
      });
      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error);
    }
  }

  // Permanent FCM error codes where the token should be deleted
  private static readonly INVALID_TOKEN_ERRORS = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
    'messaging/invalid-argument',
    'messaging/mismatched-credential',
  ]);

  async sendToDevice(
    token: string,
    payload: {
      title: string;
      body: string;
      data?: { [key: string]: string };
    },
  ): Promise<boolean> {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase not initialized. Skipping FCM send.');
      return false;
    }

    try {
      const message: admin.messaging.Message = {
        token,
        data: {
          title: payload.title,
          body: payload.body,
          ...payload.data,
        },
        webpush: {
          headers: {
            Urgency: 'high',
          },
          fcmOptions: {
            link: payload.data?.actionUrl || '/',
          },
        },
      };

      await admin.messaging().send(message);
      return true;
    } catch (error) {
      const errorCode = error?.code || error?.errorInfo?.code;
      if (errorCode && FirebaseService.INVALID_TOKEN_ERRORS.has(errorCode)) {
        this.logger.warn(
          `Invalid FCM token (${errorCode}): ${token.slice(0, 20)}...`,
        );
      } else {
        this.logger.error(
          `Failed to send FCM to token ${token.slice(0, 20)}...: ${error.message}`,
        );
      }
      return false;
    }
  }

  async sendMulticast(
    tokens: string[],
    payload: {
      title: string;
      body: string;
      data?: { [key: string]: string };
    },
  ): Promise<{
    successCount: number;
    failureCount: number;
    invalidTokens: string[];
  }> {
    if (!this.firebaseApp || tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    try {
      const messages: admin.messaging.Message[] = tokens.map((token) => ({
        token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        webpush: {
          headers: {
            Urgency: 'high',
          },
          notification: {
            title: payload.title,
            body: payload.body,
            icon: 'https://www.mergeedu.app/logo.svg', // path to your app icon
          },
          fcmOptions: {
            link: payload.data?.actionUrl || '/',
          },
        },
        data: {
          ...payload.data,
        },
      }));

      const response = await admin.messaging().sendEach(messages);

      const invalidTokens: string[] = [];
      let successCount = 0;
      let failureCount = 0;

      response.responses.forEach((resp, idx) => {
        if (resp.success) {
          successCount++;
        } else {
          failureCount++;
          const errorCode = resp.error?.code;
          if (
            errorCode &&
            FirebaseService.INVALID_TOKEN_ERRORS.has(errorCode)
          ) {
            invalidTokens.push(tokens[idx]);
            this.logger.warn(
              `Invalid FCM token detected (${errorCode}): ${tokens[idx].slice(0, 20)}...`,
            );
          } else {
            this.logger.error(
              `FCM send failed for token ${tokens[idx].slice(0, 20)}...: ${resp.error?.message}`,
            );
          }
        }
      });

      this.logger.log(
        `FCM multicast: ${successCount} success, ${failureCount} failures, ${invalidTokens.length} invalid tokens`,
      );
      return { successCount, failureCount, invalidTokens };
    } catch (error) {
      this.logger.error(`Failed to send FCM multicast: ${error.message}`);
      return {
        successCount: 0,
        failureCount: tokens.length,
        invalidTokens: [],
      };
    }
  }
}
