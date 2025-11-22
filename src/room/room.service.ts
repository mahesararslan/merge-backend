// @ts-nocheck
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { TagService } from '../tag/tag.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { Tag } from 'src/entities/tag.entity';
import { RoomMember } from '../entities/room-member.entity'; // Add this import
import { QueryUserRoomsDto, RoomFilter } from './dto/query-user-rooms.dto';
import { RoomPermissions } from '../entities/room-permissions.entity';
import { Folder, FolderType } from '../entities/folder.entity';
import { File } from '../entities/file.entity';
import { QueryRoomContentDto } from './dto/query-room-content.dto';

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RoomMember) // Add this
    private roomMemberRepository: Repository<RoomMember>,
    @InjectRepository(RoomPermissions)
    private roomPermissionsRepository: Repository<RoomPermissions>,
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    private tagService: TagService,
  ) {}

  private generateRoomCode(): string {
    // Generate 6-character alphanumeric code
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async create(createRoomDto: CreateRoomDto, adminId: string): Promise<Room> {
    const admin = await this.userRepository.findOne({ where: { id: adminId } });
    if (!admin) {
      throw new NotFoundException('Admin user not found');
    }

    // Generate unique room code
    const roomCode = await this.generateUniqueRoomCode(); // Extract to separate method

    // Handle tags if provided
    const tags: Tag[] =
      createRoomDto.tagNames && createRoomDto.tagNames.length > 0
        ? await this.tagService.findOrCreateTags(createRoomDto.tagNames)
        : [];

    const room = this.roomRepository.create({
      title: createRoomDto.title,
      description: createRoomDto.description,
      isPublic: createRoomDto.isPublic ?? true,
      roomCode,
      admin,
      tags,
    });

    return this.roomRepository.save(room);
  }

  // Extract room code generation to separate method
  private async generateUniqueRoomCode(): Promise<string> {
    let roomCode: string;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      roomCode = this.generateRoomCode();
      const existingRoom = await this.roomRepository.findOne({
        where: { roomCode },
      });

      if (!existingRoom) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      throw new ConflictException('Unable to generate unique room code');
    }

    return roomCode!; // Non-null assertion since we know it's assigned if we reach here
  }

  async findAll(queryDto: QueryAllRoomsDto) {
    const { page, limit, search } = queryDto;
    const skip = (page - 1) * limit;

    const queryBuilder = this.roomRepository
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.admin', 'admin')
      .leftJoinAndSelect('room.tags', 'tags')
      .where('room.isPublic = :isPublic', { isPublic: true });

    if (search) {
      queryBuilder.andWhere(
        '(room.title ILIKE :search OR room.description ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [rooms, total] = await queryBuilder
      .orderBy('room.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      rooms,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      search: search || null,
    };
  }

  async findUserRooms(userId: string): Promise<Room[]> {
    return this.roomRepository.find({
      where: { admin: { id: userId } },
      relations: ['admin', 'tags'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { id },
      relations: ['admin', 'tags'],
    });

    if (!room) {
      throw new NotFoundException(`Room with ID ${id} not found`);
    }

    return room;
  }

  // Add this method to src/room/room.service.ts

  async getUserFeed(
    userId: string,
    queryDto: QueryUserFeedDto,
  ) {
    const { page, limit, includeJoined } = queryDto;
    const skip = (page - 1) * limit;

    // Get user with their interests/tags
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['tags'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const userTagNames = user.tags.map((tag) => tag.name);
    const hasPersonalizedFeed = userTagNames.length > 0;

    // Get rooms user has joined or created (to exclude if includeJoined is false)
    const userRoomIds = await this.getUserRoomIds(userId);

    const queryBuilder = this.roomRepository
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.admin', 'admin')
      .leftJoinAndSelect('room.tags', 'tags')
      .where('room.isPublic = :isPublic', { isPublic: true });

    // Exclude rooms user has already joined/created (unless includeJoined is true)
    if (!includeJoined && userRoomIds.length > 0) {
      queryBuilder.andWhere('room.id NOT IN (:...userRoomIds)', { userRoomIds });
    }

    if (hasPersonalizedFeed) {
      // Prioritize rooms with matching tags
      queryBuilder
        .addSelect(
          `(
          SELECT COUNT(*)::int 
          FROM room_tags rt 
          INNER JOIN tags t ON rt."tagId" = t.id 
          WHERE rt."roomId" = room.id 
          AND t.name = ANY(:userTags)
        )`,
          'tag_matches',
        )
        .setParameter('userTags', userTagNames)
        .orderBy('tag_matches', 'DESC')
        .addOrderBy('room.createdAt', 'DESC');
    } else {
      // If user has no interests, show popular rooms or most recent
      queryBuilder
        .leftJoin('room_members', 'rm', 'rm."roomId" = room.id')
        .addSelect('COUNT(rm.id)::int', 'member_count')
        .groupBy('room.id, admin.id, tags.id')
        .orderBy('member_count', 'DESC')
        .addOrderBy('room.createdAt', 'DESC');
    }

    const [rooms, total] = await queryBuilder
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    // Add additional metadata to each room
    const roomsWithMetadata = await Promise.all(
      rooms.map(async (room) => {
        const memberCount = await this.getRoomMemberCount(room.id);
        const tagMatches = hasPersonalizedFeed
          ? room.tags.filter((tag) => userTagNames.includes(tag.name)).length
          : 0;

        return {
          ...room,
          memberCount,
          tagMatches,
          isRecommended: tagMatches > 0,
          joinedByUser: userRoomIds.includes(room.id),
        };
      }),
    );

    return {
      rooms: roomsWithMetadata,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      userTags: userTagNames,
      hasPersonalizedFeed,
      includeJoined,
    };
  }

  // Helper method to get user's room IDs (created + joined)
  private async getUserRoomIds(userId: string): Promise<string[]> {
    const [createdRooms, joinedRoomMembers] = await Promise.all([
      this.roomRepository.find({
        where: { admin: { id: userId } },
        select: ['id'],
      }),
      this.roomMemberRepository.find({
        where: { user: { id: userId } },
        relations: ['room'],
        select: ['room'],
      }),
    ]);

    const createdRoomIds = createdRooms.map((room) => room.id);
    const joinedRoomIds = joinedRoomMembers.map((member) => member.room.id);

    return [...new Set([...createdRoomIds, ...joinedRoomIds])];
  }

  // Helper method to get room member count
  private async getRoomMemberCount(roomId: string): Promise<number> {
    return this.roomMemberRepository.count({
      where: { room: { id: roomId } },
    });
  }

  async update(
    id: string,
    updateRoomDto: UpdateRoomDto,
    userId: string,
  ): Promise<Room> {
    const room = await this.findOne(id);

    // Check if user is the admin of the room
    if (room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can update room settings');
    }

    // Handle tags update if provided
    if (updateRoomDto.tagNames) {
      const tags = await this.tagService.findOrCreateTags(
        updateRoomDto.tagNames,
      );
      room.tags = tags;
    }

    // Update other fields
    if (updateRoomDto.title) room.title = updateRoomDto.title;
    if (updateRoomDto.description !== undefined)
      room.description = updateRoomDto.description;
    if (updateRoomDto.isPublic !== undefined)
      room.isPublic = updateRoomDto.isPublic;

    return this.roomRepository.save(room);
  }

  async delete(id: string, userId: string): Promise<void> {
    const room = await this.findOne(id);

    // Check if user is the admin of the room
    if (room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can delete the room');
    }

    await this.roomRepository.remove(room);
  }

  async joinRoom(roomCode: string, userId: string) {
    const room = await this.findByRoomCode(roomCode);
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user is already a member
    const existingMember = await this.roomMemberRepository.findOne({
      where: {
        room: { id: room.id },
        user: { id: userId },
      },
    });

    if (existingMember) {
      return {
        success: true,
        message: `You are already a member of ${room.title}`,
        room,
      };
    }

    // Check if user is the admin (admin doesn't need to join as member)
    if (room.admin.id === userId) {
      return {
        success: true,
        message: `You are the admin of ${room.title}`,
        room,
      };
    }

    // Create membership
    const roomMember = this.roomMemberRepository.create({
      room,
      user,
    });

    await this.roomMemberRepository.save(roomMember);

    return {
      success: true,
      message: `Successfully joined ${room.title}`,
      room,
    };
  }

  async findJoinedRooms(userId: string): Promise<Room[]> {
    const roomMembers = await this.roomMemberRepository.find({
      where: { user: { id: userId } },
      relations: ['room', 'room.admin', 'room.tags'],
      order: { joinedAt: 'DESC' },
    });

    return roomMembers.map((member) => member.room);
  }

  async findAllUserRooms(userId: string): Promise<{
    createdRooms: Room[];
    joinedRooms: Room[];
    totalRooms: number;
  }> {
    const [createdRooms, joinedRooms] = await Promise.all([
      this.findUserRooms(userId),
      this.findJoinedRooms(userId),
    ]);

    return {
      createdRooms,
      joinedRooms,
      totalRooms: createdRooms.length + joinedRooms.length,
    };
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    const room = await this.findOne(roomId);

    // Check if user is the admin
    if (room.admin.id === userId) {
      throw new ForbiddenException(
        'Room admin cannot leave the room. Transfer ownership or delete the room instead.',
      );
    }

    const roomMember = await this.roomMemberRepository.findOne({
      where: {
        room: { id: roomId },
        user: { id: userId },
      },
    });

    if (!roomMember) {
      throw new NotFoundException('You are not a member of this room');
    }

    await this.roomMemberRepository.remove(roomMember);
  }

  async getRoomMembers(roomId: string, userId: string): Promise<RoomMember[]> {
    const room = await this.findOne(roomId);

    // Check if user has access to view members (admin or member)
    const hasAccess =
      room.admin.id === userId ||
      (await this.roomMemberRepository.findOne({
        where: {
          room: { id: roomId },
          user: { id: userId },
        },
      }));

    if (!hasAccess && !room.isPublic) {
      throw new ForbiddenException(
        "You do not have access to view this room's members",
      );
    }

    return this.roomMemberRepository.find({
      where: { room: { id: roomId } },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });
  }

  async findUserRoomsWithFilter(queryDto: QueryUserRoomsDto, userId: string) {
    const { page, limit, sortBy, sortOrder, filter, search } = queryDto;

    // Get counts for all categories
    const [createdCount, joinedCount] = await Promise.all([
      this.getCreatedRoomsCount(userId, search),
      this.getJoinedRoomsCount(userId, search),
    ]);

    const totalCount = createdCount + joinedCount;
    let rooms = [];
    let total = 0;

    switch (filter) {
      case RoomFilter.CREATED:
        const createdResult = await this.getCreatedRoomsWithDetails(userId, {
          page,
          limit,
          sortBy,
          sortOrder,
          search,
        }); 
        rooms = createdResult.rooms;
        total = createdResult.total;
        break;

      case RoomFilter.JOINED:
        const joinedResult = await this.getJoinedRoomsWithDetails(userId, {
          page,
          limit,
          sortBy,
          sortOrder,
          search,
        });
        rooms = joinedResult.rooms;
        total = joinedResult.total;
        break;

      case RoomFilter.ALL:
        const allResult = await this.getAllUserRoomsWithDetails(userId, {
          page,
          limit,
          sortBy,
          sortOrder,
          search,
        });
        rooms = allResult.rooms;
        total = allResult.total;
        break;

      default:
        throw new Error('Invalid filter option');
    }

    return {
      rooms,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      filter,
      counts: {
        created: createdCount,
        joined: joinedCount,
        total: totalCount,
      },
    };
  }

  private async getCreatedRoomsWithDetails(
    userId: string,
    options: any,
  ): Promise<{ rooms: any[]; total: number }> {
    const { page, limit, sortBy, sortOrder, search } = options;
    const skip = (page - 1) * limit;

    let queryBuilder = this.roomRepository
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.admin', 'admin')
      .leftJoinAndSelect('room.tags', 'tags')
      .where('room.admin.id = :userId', { userId });

    if (search) {
      queryBuilder.andWhere(
        '(room.title ILIKE :search OR room.description ILIKE :search)',
        {
          search: `%${search}%`,
        },
      );
    }

    queryBuilder
      .orderBy(`room.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit);

    const [rooms, total] = await queryBuilder.getManyAndCount();

    // Add role and member count to each room
    const roomsWithDetails = await Promise.all(
      rooms.map(async (room) => {
        const memberCount = await this.roomMemberRepository.count({
          where: { room: { id: room.id } },
        });

        return {
          ...room,
          userRole: 'admin',
          memberCount: memberCount + 1, // +1 for admin
        };
      }),
    );

    return { rooms: roomsWithDetails, total };
  }

  private async getJoinedRoomsWithDetails(
    userId: string,
    options: any,
  ): Promise<{ rooms: any[]; total: number }> {
    const { page, limit, sortBy, sortOrder, search } = options;
    const skip = (page - 1) * limit;

    let queryBuilder = this.roomMemberRepository
      .createQueryBuilder('member')
      .leftJoinAndSelect('member.room', 'room')
      .leftJoinAndSelect('room.admin', 'admin')
      .leftJoinAndSelect('room.tags', 'tags')
      .leftJoinAndSelect('member.user', 'user')
      .where('member.user.id = :userId', { userId });

    if (search) {
      queryBuilder.andWhere(
        '(room.title ILIKE :search OR room.description ILIKE :search)',
        {
          search: `%${search}%`,
        },
      );
    }

    queryBuilder
      .orderBy(`room.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit);

    const [members, total] = await queryBuilder.getManyAndCount();

    // Extract rooms and add details
    const roomsWithDetails = await Promise.all(
      members.map(async (member) => {
        const memberCount = await this.roomMemberRepository.count({
          where: { room: { id: member.room.id } },
        });

        const permissions = await this.roomPermissionsRepository.findOne({
          where: { member: { id: member.id } },
        });

        return {
          ...member.room,
          userRole: 'member',
          memberCount: memberCount + 1, // +1 for admin
          permissions,
          joinedAt: member.joinedAt,
        };
      }),
    );

    return { rooms: roomsWithDetails, total };
  }

  private async getAllUserRoomsWithDetails(
    userId: string,
    options: any,
  ): Promise<{ rooms: any[]; total: number }> {
    const { page, limit, sortBy, sortOrder } = options;

    // Get both created and joined rooms
    const [createdResult, joinedResult] = await Promise.all([
      this.getCreatedRoomsWithDetails(userId, {
        page: 1,
        limit: 1000,
        sortBy,
        sortOrder,
        search: options.search,
      }),
      this.getJoinedRoomsWithDetails(userId, {
        page: 1,
        limit: 1000,
        sortBy,
        sortOrder,
        search: options.search,
      }),
    ]);

    // Combine and sort all rooms
    const allRooms = [...createdResult.rooms, ...joinedResult.rooms];

    // Sort combined results
    allRooms.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];

      if (sortOrder === 'ASC') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    // Apply pagination to combined results
    const skip = (page - 1) * limit;
    const paginatedRooms = allRooms.slice(skip, skip + limit);

    return {
      rooms: paginatedRooms,
      total: allRooms.length,
    };
  }

  private async getCreatedRoomsCount(userId: string, search?: string): Promise<number> {
    let queryBuilder = this.roomRepository
      .createQueryBuilder('room')
      .where('room.admin.id = :userId', { userId });

    if (search) {
      queryBuilder.andWhere(
        '(room.title ILIKE :search OR room.description ILIKE :search)',
        {
          search: `%${search}%`,
        },
      );
    }

    return queryBuilder.getCount();
  }

  private async getJoinedRoomsCount(userId: string, search?: string): Promise<number> {
    let queryBuilder = this.roomMemberRepository
      .createQueryBuilder('member')
      .leftJoin('member.room', 'room')
      .where('member.user.id = :userId', { userId });

    if (search) {
      queryBuilder.andWhere(
        '(room.title ILIKE :search OR room.description ILIKE :search)',
        {
          search: `%${search}%`,
        },
      );
    }

    return queryBuilder.getCount();
  }

  private async checkUserRoomAccess(userId: string, roomId: string): Promise<boolean> {
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) return false;

    // Check if user is admin
    if (room.admin.id === userId) return true;

    // Check if user is a member
    const member = await this.roomMemberRepository.findOne({
      where: { room: { id: roomId }, user: { id: userId } },
    });

    return !!member;
  }

  private async getUserRoleInRoom(userId: string, roomId: string): Promise<'admin' | 'member' | null> {
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) return null;

    // Check if user is admin
    if (room.admin.id === userId) return 'admin';

    // Check if user is a member
    const member = await this.roomMemberRepository.findOne({
      where: { room: { id: roomId }, user: { id: userId } },
    });

    return member ? 'member' : null;
  }

  async getRoomContent(roomId: string, queryDto: QueryRoomContentDto, userId: string): Promise<{
    folders: any[];
    files: File[];
    total: { folders: number; files: number; combined: number };
    pagination: {
      totalPages: number;
      currentPage: number;
      sortBy: string;
      sortOrder: string;
    };
    breadcrumb?: any[];
    currentFolder?: any;
    roomInfo: any;
  }> {
    const { page, limit, sortBy, sortOrder, search, folderId } = queryDto;

    // First, verify user has access to this room
    const hasAccess = await this.checkUserRoomAccess(userId, roomId);
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this room');
    }

    // Get room info
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // Determine if we're looking at root or specific folder
    const isRoot = !folderId || folderId === 'root' || folderId === 'null';
    
    let currentFolder = null;
    let breadcrumb = [];

    // If not root, get current folder info and breadcrumb
    if (!isRoot) {
      currentFolder = await this.folderRepository.findOne({
        where: { id: folderId },
        relations: ['room', 'parentFolder'],
      });

      if (!currentFolder) {
        throw new NotFoundException('Folder not found');
      }

      if (currentFolder.room.id !== roomId || currentFolder.type !== FolderType.ROOM) {
        throw new ForbiddenException('Folder does not belong to this room');
      }

      breadcrumb = await this.generateFolderBreadcrumb(folderId);
    }

    // Build folder query
    let folderQueryBuilder = this.folderRepository
      .createQueryBuilder('folder')
      .leftJoinAndSelect('folder.room', 'room')
      .leftJoinAndSelect('folder.parentFolder', 'parentFolder')
      .where('folder.room.id = :roomId AND folder.type = :folderType', {
        roomId,
        folderType: FolderType.ROOM,
      });

    // Build file query
    let fileQueryBuilder = this.fileRepository
      .createQueryBuilder('file')
      .leftJoinAndSelect('file.uploader', 'uploader')
      .leftJoinAndSelect('file.room', 'room')
      .leftJoinAndSelect('file.folder', 'folder')
      .where('file.room.id = :roomId', { roomId });

    // Filter by folder location
    if (isRoot) {
      folderQueryBuilder.andWhere('folder.parentFolder IS NULL');
      fileQueryBuilder.andWhere('file.folder IS NULL');
    } else {
      folderQueryBuilder.andWhere('folder.parentFolder.id = :folderId', { folderId });
      fileQueryBuilder.andWhere('file.folder.id = :folderId', { folderId });
    }

    // Apply search filter to both folders and files
    if (search) {
      folderQueryBuilder.andWhere('folder.name ILIKE :search', { search: `%${search}%` });
      fileQueryBuilder.andWhere(
        '(file.originalName ILIKE :search OR file.fileName ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Get total counts for pagination
    const [totalFolders, totalFiles] = await Promise.all([
      folderQueryBuilder.getCount(),
      fileQueryBuilder.getCount(),
    ]);

    const totalCombined = totalFolders + totalFiles;
    const totalPages = Math.ceil(totalCombined / limit);
    const skip = (page - 1) * limit;

    // For combined sorting, we need to handle folders and files together
    let folders = [];
    let files = [];

    if (sortBy === 'name' || sortBy === 'createdAt' || sortBy === 'updatedAt') {
      // Get all folders and files, then sort them together
      const allFolders = await folderQueryBuilder
        .orderBy(`folder.${sortBy === 'name' ? 'name' : sortBy}`, sortOrder)
        .getMany();

      const allFiles = await fileQueryBuilder
        .orderBy(`file.${sortBy === 'name' ? 'originalName' : sortBy}`, sortOrder)
        .getMany();

      // Combine and sort
      const combined = [
        ...allFolders.map(folder => ({ 
          ...folder, 
          itemType: 'folder', 
          sortValue: folder[sortBy === 'name' ? 'name' : sortBy] 
        })),
        ...allFiles.map(file => ({ 
          ...file, 
          itemType: 'file', 
          sortValue: file[sortBy === 'name' ? 'originalName' : sortBy] 
        }))
      ];

      // Sort combined results
      combined.sort((a, b) => {
        const aValue = new Date(a.sortValue).getTime() || a.sortValue;
        const bValue = new Date(b.sortValue).getTime() || b.sortValue;
        
        if (sortOrder === 'ASC') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });

      // Apply pagination to combined results
      const paginatedCombined = combined.slice(skip, skip + limit);

      // Separate back to folders and files
      folders = paginatedCombined.filter(item => item.itemType === 'folder');
      files = paginatedCombined.filter(item => item.itemType === 'file');

      // Clean up the extra properties
      folders = folders.map(({ itemType, sortValue, ...folder }) => folder);
      files = files.map(({ itemType, sortValue, ...file }) => file);
    } else {
      // For title sorting, prioritize folders first, then files
      if (skip < totalFolders) {
        folders = await folderQueryBuilder
          .orderBy('folder.name', sortOrder)
          .skip(skip)
          .take(Math.min(totalFolders - skip, limit))
          .getMany();

        if (folders.length < limit) {
          files = await fileQueryBuilder
            .orderBy('file.originalName', sortOrder)
            .take(limit - folders.length)
            .getMany();
        }
      } else {
        files = await fileQueryBuilder
          .orderBy('file.originalName', sortOrder)
          .skip(skip - totalFolders)
          .take(limit)
          .getMany();
      }
    }

    // Add counts to folders
    const foldersWithCounts = await Promise.all(
      folders.map(async (folder) => {
        const [subfolderCount, fileCount] = await Promise.all([
          this.folderRepository.count({
            where: { parentFolder: { id: folder.id }, room: { id: roomId } },
          }),
          this.fileRepository.count({
            where: { folder: { id: folder.id }, room: { id: roomId } },
          }),
        ]);

        return {
          ...folder,
          subfolderCount,
          fileCount,
          totalItems: subfolderCount + fileCount,
        };
      })
    );

    // Get user's role in the room for permission context
    const userRole = await this.getUserRoleInRoom(userId, roomId);

    return {
      folders: foldersWithCounts,
      files,
      total: {
        folders: totalFolders,
        files: totalFiles,
        combined: totalCombined,
      },
      pagination: {
        totalPages,
        currentPage: page,
        sortBy,
        sortOrder,
      },
      breadcrumb,
      currentFolder,
      roomInfo: {
        id: room.id,
        title: room.title,
        userRole,
      },
    };
  }

  // Helper method to generate folder breadcrumb
  private async generateFolderBreadcrumb(folderId: string): Promise<any[]> {
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
}
