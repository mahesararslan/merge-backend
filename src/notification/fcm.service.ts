// src/notification/fcm.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  constructor(private configService: ConfigService) {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.configService.get('firebase.projectId'),
          privateKey: this.configService.get('firebase.privateKey'),
          clientEmail: this.configService.get('firebase.clientEmail'),
        }),
      });
    }
  }

  async sendToDevice(
    registrationToken: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    try {
      const message = {
        notification: {
          title,
          body,
        },
        data: data || {},
        token: registrationToken,
      };

      const response = await admin.messaging().send(message);
      this.logger.log(`Successfully sent message: ${response}`);
    } catch (error) {
      this.logger.error('Error sending message:', error);
      throw error;
    }
  }

  async sendToMultipleDevices(
    registrationTokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    try {
      // Create individual messages for each token
      const messages = registrationTokens.map(token => ({
        notification: {
          title,
          body,
        },
        data: data || {},
        token,
      }));

      // Use sendEach instead of sendMulticast
      const response = await admin.messaging().sendEach(messages);
      
      this.logger.log(`Successfully sent ${response.successCount} messages`);
      
      if (response.failureCount > 0) {
        this.logger.warn(`Failed to send ${response.failureCount} messages`);
        
        // Log failed tokens for debugging
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            this.logger.error(`Failed to send to token ${registrationTokens[idx]}: ${resp.error?.message}`);
          }
        });
      }
    } catch (error) {
      this.logger.error('Error sending messages:', error);
      throw error;
    }
  }

  async sendToTopic(
    topic: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    try {
      const message = {
        notification: {
          title,
          body,
        },
        data: data || {},
        topic,
      };

      const response = await admin.messaging().send(message);
      this.logger.log(`Successfully sent message to topic: ${response}`);
    } catch (error) {
      this.logger.error('Error sending message to topic:', error);
      throw error;
    }
  }
}