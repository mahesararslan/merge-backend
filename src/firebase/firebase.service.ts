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
      this.logger.warn('Firebase credentials not configured. FCM will not work.');
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
      this.logger.error(`Failed to send FCM to token ${token}: ${error.message}`);
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
  ): Promise<{ successCount: number; failureCount: number }> {
    if (!this.firebaseApp || tokens.length === 0) {
      return { successCount: 0, failureCount: 0 };
    }

    try {
    const messages: admin.messaging.Message[] = tokens.map(token => ({
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
}));

      const response = await admin.messaging().sendEach(messages);
      
      const successCount = response.responses.filter(r => r.success).length;
      const failureCount = response.responses.filter(r => !r.success).length;
      
      this.logger.log(
        `FCM multicast: ${successCount} success, ${failureCount} failures`,
      );
      return {
        successCount,
        failureCount,
      };
    } catch (error) {
      this.logger.error(`Failed to send FCM multicast: ${error.message}`);
      return { successCount: 0, failureCount: tokens.length };
    }
  }
}
