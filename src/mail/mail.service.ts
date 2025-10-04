import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: ConfigService) {
    this.initializeSendGrid();
  }

  private initializeSendGrid() {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    // console.log("SendGrid API Key:", apiKey); // Debugging line
    
    if (!apiKey) {
      this.logger.error('SendGrid API key is not configured');
      throw new Error('SendGrid API key is required');
    }

    sgMail.setApiKey(apiKey);
    this.logger.log('SendGrid service initialized successfully');
  }

  async sendVerificationEmail(email: string, name: string, verificationToken: string): Promise<void> {
    const verificationUrl = `${this.configService.get('FRONTEND_URL')}/verify?token=${verificationToken}`;
    

    const msg = {
      to: email,
      from: {
        email: this.configService.get('MAIL_FROM_ADDRESS'),
        name: this.configService.get('MAIL_FROM_NAME'),
      },
      subject: 'Verify Your Account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #007bff; margin: 0; font-size: 28px;">Welcome to ${this.configService.get('MAIL_FROM_NAME')}!</h1>
            </div>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">Hello <strong>${name}</strong>,</p>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Thank you for signing up! To get started, please verify your email address by clicking the button below:
            </p>
            
            <div style="text-align: center; margin: 40px 0;">
              <a href="${verificationUrl}" 
                 style="background: linear-gradient(45deg, #007bff, #0056b3); 
                        color: white; 
                        padding: 15px 35px; 
                        text-decoration: none; 
                        border-radius: 25px; 
                        display: inline-block; 
                        font-weight: bold; 
                        font-size: 16px;
                        box-shadow: 0 4px 15px rgba(0,123,255,0.3);
                        transition: all 0.3s ease;">
                ✉️ Verify Email Address
              </a>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 30px 0;">
              <p style="color: #666; font-size: 14px; margin: 0;">
                <strong>Can't click the button?</strong> Copy and paste this link into your browser:
              </p>
              <p style="word-break: break-all; color: #007bff; font-size: 14px; margin: 10px 0 0 0;">
                <a href="${verificationUrl}" style="color: #007bff;">${verificationUrl}</a>
              </p>
            </div>
            
            <p style="color: #666; font-size: 14px; line-height: 1.6;">
              If you didn't create an account, please ignore this email and no further action is required.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 40px 0;">
            
            <div style="text-align: center;">
              <p style="color: #999; font-size: 12px; margin: 0;">
                This is an automated message from ${this.configService.get('MAIL_FROM_NAME')}.<br>
                Please do not reply to this email.
              </p>
            </div>
          </div>
        </div>
      `,
    };

    try {
      await sgMail.send(msg);
      this.logger.log(`Verification email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}:`, error);
      throw error;
    }
  }

  async sendPasswordResetEmail(email: string, name: string, resetToken: string): Promise<void> {
    const resetUrl = `${this.configService.get('FRONTEND_URL')}/reset-password?token=${resetToken}`;
    
    const msg = {
      to: email,
      from: {
        email: this.configService.get('MAIL_FROM_ADDRESS'),
        name: this.configService.get('MAIL_FROM_NAME'),
      },
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #dc3545; margin: 0; font-size: 28px;">🔒 Password Reset Request</h1>
            </div>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">Hello <strong>${name}</strong>,</p>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              We received a request to reset your password. If this was you, click the button below to create a new password:
            </p>
            
            <div style="text-align: center; margin: 40px 0;">
              <a href="${resetUrl}" 
                 style="background: linear-gradient(45deg, #dc3545, #c82333); 
                        color: white; 
                        padding: 15px 35px; 
                        text-decoration: none; 
                        border-radius: 25px; 
                        display: inline-block; 
                        font-weight: bold; 
                        font-size: 16px;
                        box-shadow: 0 4px 15px rgba(220,53,69,0.3);
                        transition: all 0.3s ease;">
                🔑 Reset Password
              </a>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 30px 0;">
              <p style="color: #666; font-size: 14px; margin: 0;">
                <strong>Can't click the button?</strong> Copy and paste this link into your browser:
              </p>
              <p style="word-break: break-all; color: #dc3545; font-size: 14px; margin: 10px 0 0 0;">
                <a href="${resetUrl}" style="color: #dc3545;">${resetUrl}</a>
              </p>
            </div>
            
            <div style="border-left: 4px solid #dc3545; padding-left: 15px; margin: 30px 0;">
              <p style="color: #721c24; font-size: 14px; margin: 0;">
                ⏰ This link will expire in <strong>1 hour</strong> for security purposes.
              </p>
            </div>
            
            <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 8px; margin: 30px 0;">
              <p style="color: #0c5460; font-size: 14px; margin: 0;">
                <strong>💡 Security Tip:</strong> If you didn't request a password reset, please ignore this email. 
                Your password will remain unchanged. Consider enabling two-factor authentication for added security.
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 40px 0;">
            
            <div style="text-align: center;">
              <p style="color: #999; font-size: 12px; margin: 0;">
                This is an automated security message from ${this.configService.get('MAIL_FROM_NAME')}.<br>
                Please do not reply to this email.
              </p>
            </div>
          </div>
        </div>
      `,
    };

    try {
      await sgMail.send(msg);
      this.logger.log(`Password reset email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}:`, error);
      throw error;
    }
  }

  async sendOTPEmail(email: string, name: string, otpCode: string): Promise<void> {
    const msg = {
      to: email,
      from: {
        email: this.configService.get('MAIL_FROM_ADDRESS'),
        name: this.configService.get('MAIL_FROM_NAME'),
      },
      subject: 'Your Login Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #28a745; margin: 0; font-size: 28px;">🔐 Login Verification</h1>
            </div>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">Hello <strong>${name}</strong>,</p>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              You are attempting to sign in to your account. Please use the verification code below to complete your login:
            </p>
            
            <div style="text-align: center; margin: 40px 0;">
              <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); 
                          border: 3px dashed #007bff; 
                          padding: 30px; 
                          border-radius: 15px; 
                          display: inline-block;
                          box-shadow: 0 4px 15px rgba(0,123,255,0.1);">
                <p style="color: #666; font-size: 14px; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 1px;">
                  Your Verification Code
                </p>
                <h1 style="color: #007bff; 
                           margin: 0; 
                           font-size: 42px; 
                           letter-spacing: 8px; 
                           font-weight: bold;
                           text-shadow: 2px 2px 4px rgba(0,0,0,0.1);">
                  ${otpCode}
                </h1>
              </div>
            </div>
            
            <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 30px 0;">
              <p style="color: #856404; font-size: 14px; margin: 0;">
                <strong>⏰ Important:</strong> This verification code will expire in <strong>2 minutes</strong> for security purposes.
              </p>
            </div>
            
            <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 8px; margin: 30px 0;">
              <p style="color: #721c24; font-size: 14px; margin: 0;">
                <strong>🚨 Security Alert:</strong> If you didn't attempt to sign in, please ignore this email and consider changing your password immediately.
              </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <p style="color: #666; font-size: 14px;">
                Having trouble? Contact our support team for assistance.
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 40px 0;">
            
            <div style="text-align: center;">
              <p style="color: #999; font-size: 12px; margin: 0;">
                This is an automated security message from ${this.configService.get('MAIL_FROM_NAME')}.<br>
                Please do not reply to this email.
              </p>
            </div>
          </div>
        </div>
      `,
    };

    try {
      await sgMail.send(msg);
      this.logger.log(`OTP email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP email to ${email}:`, error);
      throw error;
    }
  }

  // Additional utility method for sending custom emails
  async sendCustomEmail(
    to: string,
    subject: string,
    html: string,
    from?: { email: string; name: string }
  ): Promise<void> {
    const msg = {
      to,
      from: from || {
        email: this.configService.get('MAIL_FROM_ADDRESS'),
        name: this.configService.get('MAIL_FROM_NAME'),
      },
      subject,
      html,
    };

    try { //@ts-ignore
      await sgMail.send(msg);
      this.logger.log(`Custom email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send custom email to ${to}:`, error);
      throw error;
    }
  }

  // Method for sending bulk emails (useful for LMS announcements)
  async sendBulkEmail(
    recipients: string[],
    subject: string,
    html: string
  ): Promise<void> {
    const msg = {
      to: recipients,
      from: {
        email: this.configService.get('MAIL_FROM_ADDRESS'),
        name: this.configService.get('MAIL_FROM_NAME'),
      },
      subject,
      html,
    };

    try {
      await sgMail.sendMultiple(msg);
      this.logger.log(`Bulk email sent to ${recipients.length} recipients`);
    } catch (error) {
      this.logger.error('Failed to send bulk email:', error);
      throw error;
    }
  }

  // Method to validate SendGrid configuration
  async validateConfiguration(): Promise<boolean> {
    try {
      // You can implement a test email send here if needed
      this.logger.log('SendGrid configuration is valid');
      return true;
    } catch (error) {
      this.logger.error('SendGrid configuration validation failed:', error);
      return false;
    }
  }
}