import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { File, FileType, FileProcessingStatus } from '../entities/file.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { Folder } from '../entities/folder.entity';
import { RoomMember } from '../entities/room-member.entity';
import { Assignment } from '../entities/assignment.entity';
import { UploadFileDto } from './dto/upload-file.dto';
import { QueryFileDto } from './dto/query-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { S3Service } from './s3.service';
import axios from 'axios';

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(RoomMember)
    private roomMemberRepository: Repository<RoomMember>,
    @InjectRepository(Assignment)
    private assignmentRepository: Repository<Assignment>,
    private configService: ConfigService,
    private s3Service: S3Service,
  ) {}

  /**
   * Trigger embedding generation for a file using the FastAPI AI service.
   * This method calls the AI service asynchronously and polls for completion.
   */
  private async triggerEmbeddingGeneration(
    fileId: string,
    s3Url: string,
    roomId: string,
    mimeType: string,
  ): Promise<void> {
    try {
      const aiServiceUrl = this.configService.get('AI_SERVICE_URL') || 'http://localhost:8001';
      
      // Determine document type from MIME type
      let documentType = 'pdf';
      if (mimeType.includes('pdf')) {
        documentType = 'pdf';
      } else if (mimeType.includes('word') || mimeType.includes('document')) {
        documentType = 'docx';
      } else if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
        documentType = 'pptx';
      } else if (mimeType.includes('text/plain')) {
        documentType = 'txt';
      }

      this.logger.log(`Triggering embedding generation for file ${fileId} from ${s3Url}`);

      // Call FastAPI to start processing
      const response = await axios.post(
        `${aiServiceUrl}/ingest/ingest-from-s3`,
        {
          s3_url: s3Url,
          room_id: roomId,
          file_id: fileId,
          document_type: documentType,
        },
        {
          timeout: 10000, // 10 second timeout for the initial request
        }
      );

      if (response.data.success) {
        this.logger.log(`Embedding generation started for file ${fileId}`);
        
        // Start polling for status in the background (don't await)
        this.pollProcessingStatus(fileId, aiServiceUrl).catch(error => {
          this.logger.error(`Error polling status for file ${fileId}: ${error.message}`);
        });
      } else {
        throw new Error('AI service returned unsuccessful response');
      }
    } catch (error) {
      this.logger.error(`Failed to trigger embedding generation for file ${fileId}: ${error.message}`);
      
      // Update file status to failed
      await this.fileRepository.update(fileId, {
        processingStatus: FileProcessingStatus.FAILED,
        processingError: `Failed to trigger embedding generation: ${error.message}`,
        processedAt: new Date(),
      });
    }
  }

  /**
   * Poll the AI service for processing status and update the database.
   */
  private async pollProcessingStatus(fileId: string, aiServiceUrl: string): Promise<void> {
    const maxAttempts = 60; // Poll for up to 5 minutes (60 * 5 seconds)
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        attempts++;

        const statusResponse = await axios.get(
          `${aiServiceUrl}/ingest/ingest-status/${fileId}`,
          { timeout: 5000 }
        );

        const status = statusResponse.data.status;
        
        if (status === 'completed') {
          this.logger.log(`Embedding generation completed for file ${fileId}`);
          
          await this.fileRepository.update(fileId, {
            processingStatus: FileProcessingStatus.COMPLETED,
            chunksCreated: statusResponse.data.chunks_created,
            processingError: null,
            processedAt: new Date(),
          });
          
          return; // Exit polling
        } else if (status === 'failed') {
          this.logger.error(`Embedding generation failed for file ${fileId}: ${statusResponse.data.error}`);
          
          await this.fileRepository.update(fileId, {
            processingStatus: FileProcessingStatus.FAILED,
            processingError: statusResponse.data.error,
            processedAt: new Date(),
          });
          
          return; // Exit polling
        }
        
        // Status is 'pending' or 'processing', continue polling
        this.logger.debug(`File ${fileId} status: ${status}, continuing to poll...`);
        
      } catch (error) {
        this.logger.error(`Error polling status for file ${fileId}: ${error.message}`);
        
        // Only fail if we've tried multiple times
        if (attempts >= 3) {
          await this.fileRepository.update(fileId, {
            processingStatus: FileProcessingStatus.FAILED,
            processingError: `Status polling failed: ${error.message}`,
            processedAt: new Date(),
          });
          return;
        }
      }
    }

    // Polling timed out
    this.logger.warn(`Polling timed out for file ${fileId} after ${maxAttempts} attempts`);
    await this.fileRepository.update(fileId, {
      processingStatus: FileProcessingStatus.FAILED,
      processingError: 'Processing timeout - please retry',
      processedAt: new Date(),
    });
  }

  async uploadFile(
    file: any,
    uploadFileDto: UploadFileDto,
    userId: string,
  ): Promise<any> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let folder: Folder | null = null;
    let room: Room | null = null;

    // Validate folder if provided
    if (uploadFileDto.folderId) {
      folder = await this.folderRepository.findOne({
        where: { id: uploadFileDto.folderId },
        relations: ['owner', 'room'],
      });

      if (!folder) {
        throw new NotFoundException('Folder not found');
      }

      // Set room from folder if it's a room folder
      if (folder.room) {
        room = folder.room;
      }
    }

    // Validate room if provided separately
    if (uploadFileDto.roomId && !room) {
      room = await this.roomRepository.findOne({
        where: { id: uploadFileDto.roomId },
        relations: ['admin'],
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }
    }

    try {
      // Call external upload service
      const uploadServiceUrl = this.configService.get('UPLOAD_FILE_SERVICE_URL');
      const internalSecret = this.configService.get('INTERNAL_SERVICE_SECRET');
      
      const formData = new FormData();
      formData.append('file', new Blob([file.buffer]), file.originalname);

      const uploadResponse = await axios.post(
        `${uploadServiceUrl}/upload`,
        formData,
        {
          headers: {
            'x-internal-secret': internalSecret,
            'Content-Type': 'multipart/form-data',
          },
        },
      );

      if (!uploadResponse.data.success) {
        throw new BadRequestException('File upload failed');
      }

      // Determine file type based on MIME type
      const fileType = this.determineFileType(file.mimetype);

      // Create file record
      const fileEntity = this.fileRepository.create({
        originalName: file.originalname,
        fileName: uploadResponse.data.filename,
        filePath: uploadResponse.data.url,
        mimeType: file.mimetype,
        size: file.size,
        type: this.determineFileType(file.mimetype),
      });
      fileEntity.uploader = user;
      fileEntity.room = room;
      fileEntity.folder = folder;

      const savedFile = await this.fileRepository.save(fileEntity);
      return this.formatFileResponse(savedFile);
    } catch (error) {
      if (error) {
        throw new BadRequestException(`Upload service error: ${error.response.data?.message || 'Unknown error'}`);
      }
      throw new BadRequestException('Failed to upload file to external service');
    }
  }

  /**
   * Generate presigned URL for direct S3 upload
   */
  async generatePresignedUrl(
    originalName: string,
    contentType: string,
    size: number,
    roomId?: string,
    folderId?: string,
    userId?: string,
    uploadType?: 'assignment' | 'attempt',
    assignmentId?: string,
  ): Promise<{
    uploadUrl: string;
    fileKey: string;
    fileUrl: string;
    metadata: {
      originalName: string;
      contentType: string;
      size: number;
      roomId?: string;
      folderId?: string;
    };
  }> {
    // Validate size (50MB limit)
    const maxSize = 50 * 1024 * 1024;
    if (size > maxSize) {
      throw new BadRequestException('File size exceeds 50MB limit');
    }

    // Handle assignment uploads - verify admin permission
    if (uploadType === 'assignment' && roomId) {
      const room = await this.roomRepository.findOne({
        where: { id: roomId },
        relations: ['admin'],
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      if (room.admin.id !== userId) {
        throw new ForbiddenException('Only room admin can upload assignment files');
      }
    }

    // Handle attempt uploads - verify member access
    if (uploadType === 'attempt' && assignmentId) {
      const assignment = await this.assignmentRepository.findOne({
        where: { id: assignmentId },
        relations: ['room'],
      });

      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }

      // Check if user is a member or admin
      if (!userId) {
        throw new ForbiddenException('User ID is required');
      }
      const hasAccess = await this.canUserAccessRoom(userId, assignment.room.id);
      if (!hasAccess) {
        throw new ForbiddenException('You do not have access to submit to this assignment');
      }

      roomId = assignment.room.id; // Set roomId from assignment
    }

    // Determine folder structure
    let folder = 'personal-files';
    let subfolder = userId;

    if (uploadType === 'assignment') {
      folder = 'assignment-files';
      subfolder = roomId;
    } else if (uploadType === 'attempt') {
      folder = 'attempt-files';
      subfolder = assignmentId;
    } else if (roomId) {
      folder = 'room-files';
      subfolder = roomId;
    }

    // Generate unique file key
    const fileKey = this.s3Service.generateFileKey(originalName, folder, subfolder);

    // Generate presigned URL (expires in 5 minutes)
    const { uploadUrl, fileUrl } = await this.s3Service.generatePresignedUploadUrl(
      fileKey,
      contentType,
      300, // 5 minutes
    );

    return {
      uploadUrl,
      fileKey,
      fileUrl,
      metadata: {
        originalName,
        contentType,
        size,
        roomId,
        folderId,
      },
    };
  }

  /**
   * Save file metadata after successful S3 upload
   */
  async saveFileMetadata(
    fileKey: string,
    fileUrl: string,
    originalName: string,
    contentType: string,
    size: number,
    userId: string,
    roomId?: string,
    folderId?: string,
  ): Promise<File> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let folder: Folder | null = null;
    let room: Room | null = null;

    // Validate folder if provided
    if (folderId) {
      folder = await this.folderRepository.findOne({
        where: { id: folderId },
        relations: ['owner', 'room'],
      });

      if (!folder) {
        throw new NotFoundException('Folder not found');
      }

      // Set room from folder if it's a room folder
      if (folder.room) {
        room = folder.room;
      }
    }

    // Validate room if provided separately
    if (roomId && !room) {
      room = await this.roomRepository.findOne({
        where: { id: roomId },
        relations: ['admin'],
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }
    }

    // Determine file type based on MIME type
    const fileType = this.determineFileType(contentType);

    // Determine if this file should have embeddings generated
    const shouldGenerateEmbeddings = room && this.isDocumentTypeSupported(contentType);
    const initialProcessingStatus = shouldGenerateEmbeddings 
      ? FileProcessingStatus.PROCESSING 
      : FileProcessingStatus.PENDING;

    // Create file record
    const fileEntity = this.fileRepository.create({
      originalName,
      fileName: fileKey,
      filePath: fileUrl,
      mimeType: contentType,
      type: fileType,
      size,
      processingStatus: initialProcessingStatus,
      chunksCreated: null,
      processingError: null,
      processedAt: null,
    });
    fileEntity.uploader = user;
    fileEntity.room = room;
    fileEntity.folder = folder;

    const savedFile = await this.fileRepository.save(fileEntity);

    // Trigger embedding generation for room files (don't await - run in background)
    if (shouldGenerateEmbeddings && room) {
      this.triggerEmbeddingGeneration(
        savedFile.id,
        fileUrl,
        room.id,
        contentType,
      ).catch(error => {
        this.logger.error(`Background embedding generation failed for file ${savedFile.id}: ${error.message}`);
      });
    }

    return this.formatFileResponse(savedFile);
  }

  /**
   * Check if the content type is supported for embedding generation.
   */
  private isDocumentTypeSupported(contentType: string): boolean {
    const supportedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'application/vnd.ms-powerpoint', // .ppt
      'text/plain', // .txt
    ];
    
    return supportedTypes.some(type => contentType.includes(type));
  }

  async findAll(
    queryDto: QueryFileDto,
    userId: string,
  ): Promise<{
    files: any[];
    total: number;
    totalPages: number;
    currentPage: number;
  }> {
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC', folderId, roomId, type, search } = queryDto;
    const skip = (page - 1) * limit;

    let queryBuilder = this.fileRepository
      .createQueryBuilder('file')
      .leftJoinAndSelect('file.uploader', 'uploader')
      .leftJoinAndSelect('file.room', 'room')
      .leftJoinAndSelect('file.folder', 'folder');

    // Filter by folder
    if (folderId) {
      if (folderId === 'root' || folderId === 'null') {
        queryBuilder.andWhere('file.folder IS NULL');
      } else {
        queryBuilder.andWhere('file.folder.id = :folderId', { folderId });
      }
    }

    // Filter by room or personal files
    if (roomId) {
      queryBuilder.andWhere('file.room.id = :roomId', { roomId });
    } else {
      // Personal files only
      queryBuilder.andWhere('file.uploader.id = :userId', { userId });
      queryBuilder.andWhere('file.room IS NULL');
    }

    // Filter by file type
    if (type) {
      queryBuilder.andWhere('file.type = :type', { type });
    }

    // Apply search filter
    if (search) {
      queryBuilder.andWhere('file.originalName ILIKE :search', { search: `%${search}%` });
    }

    queryBuilder
      .orderBy(`file.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit);

    const [files, total] = await queryBuilder.getManyAndCount();

    const formattedFiles = files.map(file => this.formatFileResponse(file));

    return {
      files: formattedFiles,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async findOne(id: string, userId: string): Promise<any> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['uploader', 'room', 'folder'],
    });

    if (!file) {
      throw new NotFoundException(`File with ID ${id} not found`);
    }

    return this.formatFileResponse(file);
  }

  async updateFile(id: string, updateFileDto: UpdateFileDto, userId: string): Promise<any> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['uploader', 'room', 'folder'],
    });

    if (!file) {
      throw new NotFoundException(`File with ID ${id} not found`);
    }

    // Update fields
    if (updateFileDto.updatedName !== undefined) {
      file.originalName = updateFileDto.updatedName;
    }

    if (updateFileDto.folderId !== undefined) {
      if (updateFileDto.folderId) {
        const newFolder = await this.folderRepository.findOne({
          where: { id: updateFileDto.folderId },
          relations: ['owner', 'room'],
        });

        if (!newFolder) {
          throw new NotFoundException('Folder not found');
        }

        file.folder = newFolder;
      } else {
        file.folder = null as any;
      }
    }

    const savedFile = await this.fileRepository.save(file);
    return this.formatFileResponse(savedFile);
  }

  async deleteFile(id: string, userId: string): Promise<void> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['uploader', 'room'],
    });

    if (!file) {
      throw new NotFoundException(`File with ID ${id} not found`);
    }

    // Delete file record (S3 file remains for potential recovery)
    await this.fileRepository.remove(file);
  }

  // Helper methods
  private determineFileType(mimeType: string): FileType {
    if (mimeType.startsWith('image/')) return FileType.IMAGE;
    if (mimeType === 'application/pdf') return FileType.PDF;
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') {
      return FileType.SPREADSHEET;
    }
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
      return FileType.PRESENTATION;
    }
    if (mimeType.includes('document') || mimeType.includes('text') || mimeType.includes('word')) {
      return FileType.DOCUMENT;
    }
    return FileType.OTHER;
  }

  private async canUserAccessRoom(userId: string, roomId: string): Promise<boolean> {
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) return false;
    if (room.admin.id === userId) return true;

    const member = await this.roomMemberRepository.findOne({
      where: { room: { id: roomId }, user: { id: userId } },
    });

    return !!member;
  }

  // Formatting helper methods
  private formatUserInfo(user: User): any {
    if (!user) return null;
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      image: user.image,
    };
  }

  private formatRoomInfo(room: Room): any {
    if (!room) return null;
    return {
      id: room.id,
      title: room.title,
    };
  }

  private formatFolderInfo(folder: Folder): any {
    if (!folder) return null;
    return {
      id: folder.id,
      name: folder.name,
      type: folder.type,
    };
  }

  private formatFileResponse(file: File): any {
    return {
      id: file.id,
      originalName: file.originalName,
      fileName: file.fileName,
      filePath: file.filePath,
      mimeType: file.mimeType,
      type: file.type,
      size: file.size,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      uploader: this.formatUserInfo(file.uploader),
      room: file.room ? this.formatRoomInfo(file.room) : null,
      folder: file.folder ? this.formatFolderInfo(file.folder) : null,
    };
  }
}