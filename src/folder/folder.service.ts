// @ts-nocheck
import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Folder } from '../entities/folder.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { Note } from '../entities/note.entity';
import { File } from '../entities/file.entity';
import { RoomMember } from '../entities/room-member.entity';
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

    // Validate room if provided
    if (createFolderDto.roomId) {
      room = await this.roomRepository.findOne({
        where: { id: createFolderDto.roomId },
        relations: ['admin'],
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      // Check if user is admin or member
      const canAccess = await this.canUserAccessRoom(userId, createFolderDto.roomId);
      if (!canAccess) {
        throw new ForbiddenException('You do not have access to this room');
      }

      // Only admin can create folders in room
      if (room.admin.id !== userId) {
        throw new ForbiddenException('Only room admin can create folders');
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

      // Check access to parent folder
      if (!createFolderDto.roomId) {
        // Personal folder - user must own parent
        if (parentFolder.owner.id !== userId) {
          throw new ForbiddenException('You can only create subfolders in your own folders');
        }
      } else {
        // Room folder - parent must be in same room
        if (parentFolder.room?.id !== createFolderDto.roomId) {
          throw new ForbiddenException('Parent folder must be in the same room');
        }
      }
    }

    // Check for duplicate names at the same level
    const whereClause: any = {
      name: createFolderDto.name,
      owner: { id: userId },
      parentFolder: createFolderDto.parentFolderId ? { id: createFolderDto.parentFolderId } : IsNull(),
    };

    if (createFolderDto.roomId) {
      whereClause.room = { id: createFolderDto.roomId };
    } else {
      whereClause.room = IsNull();
    }

    const existingFolder = await this.folderRepository.findOne({ where: whereClause });

    if (existingFolder) {
      throw new ConflictException('A folder with this name already exists at this level');
    }

    const folder = new Folder();
    folder.name = createFolderDto.name;
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
    const { page, limit, sortBy, sortOrder, search, roomId, parentFolderId } = queryDto;
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

    // Access control based on room
    if (roomId) {
      // Check room access
      const canAccess = await this.canUserAccessRoom(userId, roomId);
      if (!canAccess) {
        throw new ForbiddenException('You do not have access to this room');
      }
      queryBuilder.andWhere('folder.room.id = :roomId', { roomId });
    } else {
      // Personal folders only
      queryBuilder.andWhere('folder.owner.id = :userId AND folder.room IS NULL', { userId });
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
      this.getFolderCount(userId, roomId, parentFolderId, search),
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

    // Check access
    const canAccess = await this.canUserAccessFolder(folder, userId);
    if (!canAccess) {
      throw new ForbiddenException('You do not have access to this folder');
    }

    // Only owner or room admin can update
    if (folder.room) {
      const room = await this.roomRepository.findOne({
        where: { id: folder.room.id },
        relations: ['admin'],
      });
      if (room.admin.id !== userId) {
        throw new ForbiddenException('Only room admin can update room folders');
      }
    } else if (folder.owner.id !== userId) {
      throw new ForbiddenException('You can only update your own folders');
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

  async remove(id: string, userId: string): Promise<{ deletedFolder: Folder; movedItemsCount: number }> {
    const folder = await this.folderRepository.findOne({
      where: { id },
      relations: ['owner', 'room', 'parentFolder', 'notes', 'files', 'subfolders'],
    });

    if (!folder) {
      throw new NotFoundException(`Folder with ID ${id} not found`);
    }

    // Check access
    const canAccess = await this.canUserAccessFolder(folder, userId);
    if (!canAccess) {
      throw new ForbiddenException('You do not have access to this folder');
    }

    // Only owner or room admin can delete
    if (folder.room) {
      const room = await this.roomRepository.findOne({
        where: { id: folder.room.id },
        relations: ['admin'],
      });
      if (room.admin.id !== userId) {
        throw new ForbiddenException('Only room admin can delete room folders');
      }
    } else if (folder.owner.id !== userId) {
      throw new ForbiddenException('You can only delete your own folders');
    }

    // Move all items to parent folder or root
    const parentFolder = folder.parentFolder;
    let movedItemsCount = 0;

    // Move subfolders
    for (const subfolder of folder.subfolders) {
      subfolder.parentFolder = parentFolder;
      await this.folderRepository.save(subfolder);
      movedItemsCount++;
    }

    // Move notes
    for (const note of folder.notes) {
      note.folder = parentFolder;
      await this.noteRepository.save(note);
      movedItemsCount++;
    }

    // Move files
    for (const file of folder.files) {
      file.folder = parentFolder;
      await this.fileRepository.save(file);
      movedItemsCount++;
    }

    // Delete the folder
    await this.folderRepository.remove(folder);

    return {
      deletedFolder: folder,
      movedItemsCount,
    };
  }

  // Helper methods
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
    if (!folder.room) {
      // Personal folder
      return folder.owner.id === userId;
    } else {
      // Room folder
      return this.canUserAccessRoom(userId, folder.room.id);
    }
  }

  private async getFolderCount(
    userId: string,
    roomId?: string,
    parentFolderId?: string,
    search?: string
  ): Promise<number> {
    let queryBuilder = this.folderRepository.createQueryBuilder('folder');

    if (roomId) {
      queryBuilder.andWhere('folder.room.id = :roomId', { roomId });
    } else {
      queryBuilder.andWhere('folder.owner.id = :userId AND folder.room IS NULL', { userId });
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
}