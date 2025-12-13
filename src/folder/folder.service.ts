// @ts-nocheck
import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Folder, FolderType } from '../entities/folder.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { Note } from '../entities/note.entity';
import { File } from '../entities/file.entity';
import { RoomMember, RoomMemberRole } from '../entities/room-member.entity';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { QueryFolderDto } from './dto/query-folder.dto';

@Injectable()
export class FolderService {
  constructor(
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(Note)
    private noteRepository: Repository<Note>,
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @InjectRepository(RoomMember)
    private roomMemberRepository: Repository<RoomMember>,
  ) {}

  async create(createFolderDto: CreateFolderDto, userId: string): Promise<Folder> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let room = null;
    let parentFolder = null;

    // Validate based on folder type
    if (createFolderDto.type === FolderType.NOTES) {
      // Notes folder - user specific, no room required
      if (createFolderDto.roomId) {
        throw new ConflictException('Notes folders cannot be associated with rooms');
      }
    } else if (createFolderDto.type === FolderType.ROOM) {
      // Room folder - room required
      if (!createFolderDto.roomId) {
        throw new ConflictException('Room ID is required for room folders');
      }

      room = await this.roomRepository.findOne({
        where: { id: createFolderDto.roomId },
        relations: ['admin'],
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      // Check if user has permission to create folders in this room
      const canCreateFolder = await this.canUserCreateFoldersInRoom(userId, createFolderDto.roomId);
      if (!canCreateFolder) {
        throw new ForbiddenException('You do not have permission to create folders in this room');
      }
    }

    // Validate parent folder
    if (createFolderDto.parentFolderId) {
      parentFolder = await this.folderRepository.findOne({
        where: { id: createFolderDto.parentFolderId },
        relations: ['owner', 'room'],
      });

      if (!parentFolder) {
        throw new NotFoundException('Parent folder not found');
      }

      // Check type consistency
      if (parentFolder.type !== createFolderDto.type) {
        throw new ConflictException('Parent folder must be of the same type');
      }

      // Check access to parent folder
      if (createFolderDto.type === FolderType.NOTES) {
        if (parentFolder.owner.id !== userId) {
          throw new ForbiddenException('You can only create subfolders in your own note folders');
        }
      } else {
        if (parentFolder.room?.id !== createFolderDto.roomId) {
          throw new ConflictException('Parent folder must be in the same room');
        }
      }
    }

    // Check for duplicate names at the same level
    const whereClause: any = {
      name: createFolderDto.name,
      type: createFolderDto.type,
      parentFolder: createFolderDto.parentFolderId ? { id: createFolderDto.parentFolderId } : IsNull(),
    };

    if (createFolderDto.type === FolderType.NOTES) {
      whereClause.owner = { id: userId };
      whereClause.room = IsNull();
    } else {
      whereClause.room = { id: createFolderDto.roomId };
    }

    const existingFolder = await this.folderRepository.findOne({ where: whereClause });

    if (existingFolder) {
      throw new ConflictException('A folder with this name already exists at this level');
    }

    const folder = new Folder();
    folder.name = createFolderDto.name;
    folder.type = createFolderDto.type;
    folder.owner = user;
    folder.room = room;
    folder.parentFolder = parentFolder;

    return this.folderRepository.save(folder);
  }

  async findAll(queryDto: QueryFolderDto, userId: string): Promise<{
    folders: any[];
    total: number;
    totalPages: number;
    currentPage: number;
    breadcrumb?: any[];
  }> {
    const { page, limit, sortBy, sortOrder, search, type, roomId, parentFolderId } = queryDto;
    const skip = (page - 1) * limit;

    let queryBuilder = this.folderRepository
      .createQueryBuilder('folder')
      .leftJoinAndSelect('folder.owner', 'owner')
      .leftJoinAndSelect('folder.room', 'room')
      .leftJoinAndSelect('folder.parentFolder', 'parentFolder')
      .leftJoin('folder.notes', 'notes')
      .leftJoin('folder.files', 'files')
      .leftJoin('folder.subfolders', 'subfolders')
      .addSelect('COUNT(DISTINCT notes.id)', 'noteCount')
      .addSelect('COUNT(DISTINCT files.id)', 'fileCount')
      .addSelect('COUNT(DISTINCT subfolders.id)', 'subfolderCount');

    // Access control based on folder type
    if (type === FolderType.NOTES || (!type && !roomId)) {
      // Notes folders - user specific
      queryBuilder.andWhere('folder.type = :noteType AND folder.owner.id = :userId', {
        noteType: FolderType.NOTES,
        userId,
      });
    } else if (type === FolderType.ROOM || roomId) {
      // Room folders - check room access
      if (!roomId) {
        throw new ConflictException('Room ID is required for room folders');
      }

      const canAccess = await this.canUserAccessRoom(userId, roomId);
      if (!canAccess) {
        throw new ForbiddenException('You do not have access to this room');
      }

      queryBuilder.andWhere('folder.type = :roomType AND folder.room.id = :roomId', {
        roomType: FolderType.ROOM,
        roomId,
      });
    }

    // Filter by parent folder
    if (parentFolderId) {
      queryBuilder.andWhere('folder.parentFolder.id = :parentFolderId', { parentFolderId });
    } else {
      queryBuilder.andWhere('folder.parentFolder IS NULL');
    }

    // Apply search filter
    if (search) {
      queryBuilder.andWhere('folder.name ILIKE :search', { search: `%${search}%` });
    }

    queryBuilder.groupBy('folder.id, owner.id, room.id, parentFolder.id');

    // Apply sorting
    queryBuilder.orderBy(`folder.${sortBy}`, sortOrder);

    // Apply pagination
    queryBuilder.skip(skip).take(limit);

    const [foldersWithCount, total] = await Promise.all([
      queryBuilder.getRawAndEntities(),
      this.getFolderCount(userId, type, roomId, parentFolderId, search),
    ]);

    // Format the response
    const folders = foldersWithCount.entities.map((folder, index) => ({
      ...folder,
      noteCount: parseInt(foldersWithCount.raw[index].noteCount) || 0,
      fileCount: parseInt(foldersWithCount.raw[index].fileCount) || 0,
      subfolderCount: parseInt(foldersWithCount.raw[index].subfolderCount) || 0,
    }));

    // Generate breadcrumb if we're in a subfolder
    let breadcrumb = [];
    if (parentFolderId) {
      breadcrumb = await this.generateBreadcrumb(parentFolderId);
    }

    return {
      folders,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      breadcrumb,
    };
  }

  async findOne(id: string, userId: string): Promise<any> {
    const folder = await this.folderRepository.findOne({
      where: { id },
      relations: ['owner', 'room', 'parentFolder', 'subfolders', 'notes', 'files'],
    });

    if (!folder) {
      throw new NotFoundException(`Folder with ID ${id} not found`);
    }

    // Check access
    const canAccess = await this.canUserAccessFolder(folder, userId);
    if (!canAccess) {
      throw new ForbiddenException('You do not have access to this folder');
    }

    // Generate breadcrumb
    const breadcrumb = await this.generateBreadcrumb(id);

    // Get recent items
    const recentNotes = folder.notes
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
      .map(note => ({
        id: note.id,
        title: note.title,
        type: 'note',
        updatedAt: note.updatedAt,
      }));

    const recentFiles = folder.files
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
      .map(file => ({
        id: file.id,
        name: file.originalName,
        type: 'file',
        fileType: file.type,
        size: file.size,
        updatedAt: file.updatedAt,
      }));

    return {
      ...folder,
      noteCount: folder.notes.length,
      fileCount: folder.files.length,
      subfolderCount: folder.subfolders.length,
      recentNotes,
      recentFiles,
      breadcrumb,
    };
  }

  async update(id: string, updateFolderDto: UpdateFolderDto, userId: string): Promise<Folder> {
    const folder = await this.folderRepository.findOne({
      where: { id },
      relations: ['owner', 'room', 'parentFolder'],
    });

    if (!folder) {
      throw new NotFoundException(`Folder with ID ${id} not found`);
    }

    // Check access and permissions
    const canUpdate = await this.canUserUpdateFolder(folder, userId);
    if (!canUpdate) {
      throw new ForbiddenException('You do not have permission to update this folder');
    }

    // Handle parent folder change
    if (updateFolderDto.parentFolderId !== undefined) {
      if (updateFolderDto.parentFolderId) {
        // Prevent circular references
        if (updateFolderDto.parentFolderId === id) {
          throw new ConflictException('A folder cannot be its own parent');
        }

        const newParent = await this.folderRepository.findOne({
          where: { id: updateFolderDto.parentFolderId },
          relations: ['owner', 'room'],
        });

        if (!newParent) {
          throw new NotFoundException('Parent folder not found');
        }

        // Check type consistency
        if (newParent.type !== folder.type) {
          throw new ConflictException('Cannot move folder to a different type folder');
        }

        // Check if new parent is a descendant
        const isDescendant = await this.isDescendantFolder(id, updateFolderDto.parentFolderId);
        if (isDescendant) {
          throw new ConflictException('Cannot move folder to its own descendant');
        }

        folder.parentFolder = newParent;
      } else {
        folder.parentFolder = null;
      }
    }

    // Update name
    if (updateFolderDto.name !== undefined) {
      folder.name = updateFolderDto.name;
    }

    return this.folderRepository.save(folder);
  }

  async remove(id: string, userId: string): Promise<{ 
    deletedFolder: Folder; 
    deletedItemsCount: { 
      subfolders: number; 
      notes: number; 
      files: number; 
      total: number; 
    } 
  }> {
    const folder = await this.folderRepository.findOne({
      where: { id },
      relations: ['owner', 'room', 'parentFolder', 'notes', 'files', 'subfolders'],
    });

    if (!folder) {
      throw new NotFoundException(`Folder with ID ${id} not found`);
    }

    // Check access and permissions
    const canDelete = await this.canUserDeleteFolder(folder, userId);
    if (!canDelete) {
      throw new ForbiddenException('You do not have permission to delete this folder');
    }

    // Recursively delete all contents
    const deletedItemsCount = await this.recursivelyDeleteFolderContents(folder);

    // Delete the folder itself
    await this.folderRepository.remove(folder);

    return {
      deletedFolder: folder,
      deletedItemsCount: {
        subfolders: deletedItemsCount.subfolders,
        notes: deletedItemsCount.notes,
        files: deletedItemsCount.files,
        total: deletedItemsCount.subfolders + deletedItemsCount.notes + deletedItemsCount.files,
      },
    };
  }

  // Permission helper methods
  private async canUserCreateFoldersInRoom(userId: string, roomId: string): Promise<boolean> {
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) return false;

    // Room admin can always create folders
    if (room.admin.id === userId) return true;

    // Check if user is a member with moderator role or higher
    const member = await this.roomMemberRepository.findOne({
      where: { room: { id: roomId }, user: { id: userId } },
    });

    if (!member) return false;

    // Moderators can add files
    return member.role === RoomMemberRole.MODERATOR;
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

  private async canUserAccessFolder(folder: Folder, userId: string): Promise<boolean> {
    if (folder.type === FolderType.NOTES) {
      return folder.owner.id === userId;
    } else {
      return this.canUserAccessRoom(userId, folder.room.id);
    }
  }

  private async canUserUpdateFolder(folder: Folder, userId: string): Promise<boolean> {
    if (folder.type === FolderType.NOTES) {
      return folder.owner.id === userId;
    } else {
      return this.canUserCreateFoldersInRoom(userId, folder.room.id);
    }
  }

  private async canUserDeleteFolder(folder: Folder, userId: string): Promise<boolean> {
    if (folder.type === FolderType.NOTES) {
      return folder.owner.id === userId;
    } else {
      return this.canUserCreateFoldersInRoom(userId, folder.room.id);
    }
  }

  // Other helper methods remain the same
  private async getFolderCount(
    userId: string,
    type?: FolderType,
    roomId?: string,
    parentFolderId?: string,
    search?: string
  ): Promise<number> {
    let queryBuilder = this.folderRepository.createQueryBuilder('folder');

    if (type === FolderType.NOTES || (!type && !roomId)) {
      queryBuilder.andWhere('folder.type = :noteType AND folder.owner.id = :userId', {
        noteType: FolderType.NOTES,
        userId,
      });
    } else if (type === FolderType.ROOM || roomId) {
      queryBuilder.andWhere('folder.type = :roomType AND folder.room.id = :roomId', {
        roomType: FolderType.ROOM,
        roomId,
      });
    }

    if (parentFolderId) {
      queryBuilder.andWhere('folder.parentFolder.id = :parentFolderId', { parentFolderId });
    } else {
      queryBuilder.andWhere('folder.parentFolder IS NULL');
    }

    if (search) {
      queryBuilder.andWhere('folder.name ILIKE :search', { search: `%${search}%` });
    }

    return queryBuilder.getCount();
  }

  private async generateBreadcrumb(folderId: string): Promise<any[]> {
    const breadcrumb = [];
    let currentFolder = await this.folderRepository.findOne({
      where: { id: folderId },
      relations: ['parentFolder'],
    });

    while (currentFolder) {
      breadcrumb.unshift({
        id: currentFolder.id,
        name: currentFolder.name,
        type: currentFolder.type,
      });

      if (currentFolder.parentFolder) {
        currentFolder = await this.folderRepository.findOne({
          where: { id: currentFolder.parentFolder.id },
          relations: ['parentFolder'],
        });
      } else {
        break;
      }
    }

    return breadcrumb;
  }

  private async isDescendantFolder(ancestorId: string, potentialDescendantId: string): Promise<boolean> {
    const descendant = await this.folderRepository.findOne({
      where: { id: potentialDescendantId },
      relations: ['parentFolder'],
    });

    if (!descendant) return false;

    let current = descendant.parentFolder;
    while (current) {
      if (current.id === ancestorId) {
        return true;
      }
      current = await this.folderRepository.findOne({
        where: { id: current.id },
        relations: ['parentFolder'],
      });
      current = current?.parentFolder;
    }

    return false;
  }

  private async recursivelyDeleteFolderContents(folder: Folder): Promise<{
    subfolders: number;
    notes: number;
    files: number;
  }> {
    let deletedSubfolders = 0;
    let deletedNotes = 0;
    let deletedFiles = 0;

    // Get all direct subfolders with their contents
    const subfolders = await this.folderRepository.find({
      where: { parentFolder: { id: folder.id } },
      relations: ['notes', 'files', 'subfolders'],
    });

    // Recursively delete each subfolder
    for (const subfolder of subfolders) {
      const subfolderStats = await this.recursivelyDeleteFolderContents(subfolder);
      deletedSubfolders += subfolderStats.subfolders;
      deletedNotes += subfolderStats.notes;
      deletedFiles += subfolderStats.files;

      // Delete the subfolder itself
      await this.folderRepository.remove(subfolder);
      deletedSubfolders += 1;
    }

    // Delete all notes in this folder
    const notes = await this.noteRepository.find({
      where: { folder: { id: folder.id } },
    });

    for (const note of notes) {
      await this.noteRepository.remove(note);
      deletedNotes += 1;
    }

    // Delete all files in this folder
    const files = await this.fileRepository.find({
      where: { folder: { id: folder.id } },
    });

    for (const file of files) {
      // Note: This only deletes the database record
      // The actual S3 file remains for potential recovery/cleanup
      await this.fileRepository.remove(file);
      deletedFiles += 1;
    }

    return {
      subfolders: deletedSubfolders,
      notes: deletedNotes,
      files: deletedFiles,
    };
  }
}