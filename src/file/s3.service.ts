import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class S3Service {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(private configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.getOrThrow('AWS_S3_REGION'),
      credentials: {
        accessKeyId: this.configService.getOrThrow('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucketName = this.configService.getOrThrow('AWS_S3_BUCKET_NAME');
  }

  /**
   * Generate a presigned URL for direct upload to S3
   * @param fileKey - The S3 key/path for the file
   * @param contentType - MIME type of the file
   * @param expiresIn - URL expiration time in seconds (default: 300 = 5 minutes)
   */
  async generatePresignedUploadUrl(
    fileKey: string,
    contentType: string,
    expiresIn: number = 300,
  ): Promise<{ uploadUrl: string; fileKey: string; fileUrl: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

    // Construct the final public URL (after upload completes)
    const fileUrl = `https://${this.bucketName}.s3.${this.configService.get('AWS_S3_REGION')}.amazonaws.com/${fileKey}`;

    return {
      uploadUrl,
      fileKey,
      fileUrl,
    };
  }

  /**
   * Generate a unique file key with folder structure
   * @param originalName - Original filename
   * @param folder - Folder type (e.g., 'room-files', 'personal-files', 'avatars')
   * @param subfolder - Optional subfolder (e.g., roomId or userId)
   */
  generateFileKey(originalName: string, folder: string, subfolder?: string): string {
    const timestamp = Date.now();
    const uuid = uuidv4();
    const extension = originalName.split('.').pop();
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    if (subfolder) {
      return `${folder}/${subfolder}/${timestamp}-${uuid}.${extension}`;
    }
    return `${folder}/${timestamp}-${uuid}.${extension}`;
  }

  /**
   * Delete a file from S3
   * @param fileKey - The S3 key/path of the file to delete
   */
  async deleteFile(fileKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
    });

    await this.s3Client.send(command);
  }

  /**
   * Get the public URL for a file
   * @param fileKey - The S3 key/path of the file
   */
  getFileUrl(fileKey: string): string {
    return `https://${this.bucketName}.s3.${this.configService.get('AWS_S3_REGION')}.amazonaws.com/${fileKey}`;
  }
}
