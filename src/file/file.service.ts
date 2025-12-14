// @ts-nocheck
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { File, FileType } from '../entities/file.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { Folder } from '../entities/folder.entity';
import { RoomMember } from '../entities/room-member.entity';
import { UploadFileDto } from './dto/upload-file.dto';
import { QueryFileDto } from './dto/query-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { S3Service } from './s3.service';
import axios from 'axios';

@Injectable()
export class FileService {
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
    private configService: ConfigService,
    private s3Service: S3Service,
  ) {}

  async uploadFile(
    file: Express.Multer.File,
    uploadFileDto: UploadFileDto,
    userId: string,
  ): Promise<File> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let folder = null;
    let room = null;

    // Validate folder if provided
    if (uploadFileDto.folderId) {
      folder = await this.folderRepository.findOne({
        where: { id: uploadFileDto.folderId },
        relations: ['owner', 'room'],
      });

      if (!folder) {
        throw new NotFoundException('Folder not found');
      }

      // Check folder access
      if (!folder.room) {
        // Personal folder
        if (folder.owner.id !== userId) {
          throw new ForbiddenException('You can only upload to your own folders');
        }
      } else {
        // Room folder
        const canAccess = await this.canUserAccessRoom(userId, folder.room.id);
        if (!canAccess) {
          throw new ForbiddenException('You do not have access to this room folder');
        }
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

      const canAccess = await this.canUserAccessRoom(userId, uploadFileDto.roomId);
      if (!canAccess) {
        throw new ForbiddenException('You do not have access to this room');
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
      const fileEntity = new File();
      fileEntity.uploader = user;
      fileEntity.room = room;
      fileEntity.folder = folder;
      fileEntity.originalName = file.originalname;
      fileEntity.fileName = uploadResponse.data.filename;
      fileEntity.filePath = uploadResponse.data.url;
      fileEntity.mimeType = file.mimetype;
      fileEntity.type = fileType;
      fileEntity.size = file.size;

      const savedFile = await this.fileRepository.save(fileEntity);
      return this.formatFileResponse(savedFile, true);
    } catch (error) {
      if (error.response) {
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

    // Determine folder structure
    let folder = 'personal-files';
    let subfolder = userId;

    if (roomId) {
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

    let folder = null;
    let room = null;

    // Validate folder if provided
    if (folderId) {
      folder = await this.folderRepository.findOne({
        where: { id: folderId },
        relations: ['owner', 'room'],
      });

      if (!folder) {
        throw new NotFoundException('Folder not found');
      }

      // Check folder access
      if (!folder.room) {
        if (folder.owner.id !== userId) {
          throw new ForbiddenException('You can only upload to your own folders');
        }
      } else {
        const canAccess = await this.canUserAccessRoom(userId, folder.room.id);
        if (!canAccess) {
          throw new ForbiddenException('You do not have access to this room folder');
        }
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

      const canAccess = await this.canUserAccessRoom(userId, roomId);
      if (!canAccess) {
        throw new ForbiddenException('You do not have access to this room');
      }
    }

    // Determine file type based on MIME type
    const fileType = this.determineFileType(contentType);

    // Create file record
    const fileEntity = this.fileRepository.create({
      uploader: user,
      room,
      folder,
      originalName,
      fileName: fileKey,
      filePath: fileUrl,
      mimeType: contentType,
      type: fileType,
      size,
    });

    const savedFile = await this.fileRepository.save(fileEntity);
    return this.formatFileResponse(savedFile, true);
  }

  async findAll(
    queryDto: QueryFileDto,
    userId: string,
  ): Promise<{
    files: File[];
    total: number;
    totalPages: number;
    currentPage: number;
  }> {
    const { page, limit, sortBy, sortOrder, folderId, roomId, type, search } = queryDto;
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
      // Check room access
      const canAccess = await this.canUserAccessRoom(userId, roomId);
      if (!canAccess) {
        throw new ForbiddenException('You do not have access to this room');
      }
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

    const formattedFiles = files.map(file => this.formatFileResponse(file, true));

    return {
      files: formattedFiles,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async findOne(id: string, userId: string): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['uploader', 'room', 'folder'],
    });

    if (!file) {
      throw new NotFoundException(`File with ID ${id} not found`);
    }

    // Check access
    if (file.room) {
      // Room file - check room access
      const canAccess = await this.canUserAccessRoom(userId, file.room.id);
      if (!canAccess) {
        throw new ForbiddenException('You do not have access to this file');
      }
    } else {
      // Personal file - check ownership
      if (file.uploader.id !== userId) {
        throw new ForbiddenException('You do not have access to this file');
      }
    }

    return this.formatFileResponse(file, true);
  }

  async updateFile(id: string, updateFileDto: UpdateFileDto, userId: string): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['uploader', 'room', 'folder'],
    });

    if (!file) {
      throw new NotFoundException(`File with ID ${id} not found`);
    }

    // Check if user can update this file
    if (file.uploader.id !== userId) {
      // Only uploader or room admin can update
      if (file.room) {
        const room = await this.roomRepository.findOne({
          where: { id: file.room.id },
          relations: ['admin'],
        });
        if (room.admin.id !== userId) {
          throw new ForbiddenException('You can only update your own files or files in rooms you admin');
        }
      } else {
        throw new ForbiddenException('You can only update your own files');
      }
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

        // Check if user can move to this folder
        if (!newFolder.room) {
          // Personal folder
          if (newFolder.owner.id !== userId) {
            throw new ForbiddenException('You can only move files to your own folders');
          }
        } else {
          // Room folder
          const canAccess = await this.canUserAccessRoom(userId, newFolder.room.id);
          if (!canAccess) {
            throw new ForbiddenException('You cannot move files to this room folder');
          }
        }

        file.folder = newFolder;
      } else {
        file.folder = null;
      }
    }

    return this.fileRepository.save(file);
  }

  async deleteFile(id: string, userId: string): Promise<void> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['uploader', 'room'],
    });

    if (!file) {
      throw new NotFoundException(`File with ID ${id} not found`);
    }

    // Check if user can delete this file
    if (file.uploader.id !== userId) {
      // Only uploader or room admin can delete
      if (file.room) {
        const room = await this.roomRepository.findOne({
          where: { id: file.room.id },
          relations: ['admin'],
        });
        if (room.admin.id !== userId) {
          throw new ForbiddenException('You can only delete your own files or files in rooms you admin');
        }
      } else {
        throw new ForbiddenException('You can only delete your own files');
      }
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
}