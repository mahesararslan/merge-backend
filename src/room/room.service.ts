import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { TagService } from '../tag/tag.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { Tag } from 'src/entities/tag.entity';
import { RoomMember } from '../entities/room-member.entity';
import { RoomJoinRequest, JoinRequestStatus } from '../entities/room-join-request.entity';
import { QueryUserRoomsDto, RoomFilter } from './dto/query-user-rooms.dto';
import { Folder, FolderType } from '../entities/folder.entity';
import { File } from '../entities/file.entity';
import { QueryRoomContentDto } from './dto/query-room-content.dto';
import { QueryAllRoomsDto } from './dto/query-all-rooms.dto';
import { QueryUserFeedDto } from './dto/query-user-feed.dto';
import { FolderService } from '../folder/folder.service';
import { FileService } from '../file/file.service';
import { BulkDeleteContentDto } from './dto/bulk-delete-content.dto';

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RoomMember)
    private roomMemberRepository: Repository<RoomMember>,
    @InjectRepository(RoomJoinRequest)
    private joinRequestRepository: Repository<RoomJoinRequest>,
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    private tagService: TagService,
    @Inject(forwardRef(() => FolderService))
    private folderService: FolderService,
    @Inject(forwardRef(() => FileService))
    private fileService: FileService,
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

  async create(createRoomDto: CreateRoomDto, adminId: string): Promise<any> {
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

    const savedRoom = await this.roomRepository.save(room);
    return this.formatRoomResponse(savedRoom);
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
    const { page = 1, limit = 10, search } = queryDto;
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

    const formattedRooms = rooms.map(room => this.formatRoomResponse(room));

    return {
      rooms: formattedRooms,
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

  async findOne(id: string): Promise<any> {
    const room = await this.roomRepository.findOne({
      where: { id },
      relations: ['admin', 'tags'],
    });

    if (!room) {
      throw new NotFoundException(`Room with ID ${id} not found`);
    }

    // Get moderators for this room
    const moderators = await this.roomMemberRepository.find({
      where: {
        room: { id },
        role: 'moderator' as any,
      },
      relations: ['user'],
    });

    const formattedModerators = moderators.map(m => ({
      id: m.id, // member_id
      userId: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      email: m.user.email,
      image: m.user.image,
    }));

    return {
      ...this.formatRoomResponse(room),
      moderators: formattedModerators,
    };
  }

  // Add this method to src/room/room.service.ts

  async getUserFeed(
    userId: string,
    queryDto: QueryUserFeedDto,
  ) {
    const { page = 1, limit = 10, search } = queryDto;
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

    // Get rooms user has joined or created (always exclude them)
    const userRoomIds = await this.getUserRoomIds(userId);

    // Base query for all public rooms excluding user's rooms
    const baseQueryBuilder = this.roomRepository
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.admin', 'admin')
      .leftJoinAndSelect('room.tags', 'tags')
      .where('room.isPublic = :isPublic', { isPublic: true });

    // Exclude rooms user has already joined/created
    if (userRoomIds.length > 0) {
      baseQueryBuilder.andWhere('room.id NOT IN (:...userRoomIds)', { userRoomIds });
    }

    // Apply search filter if provided
    if (search) {
      baseQueryBuilder.andWhere(
        '(room.title ILIKE :search OR room.description ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    let rooms: Room[];
    let total: number;

    if (hasPersonalizedFeed) {
      // Get personalized rooms (matching user's tags)
      const personalizedQuery = baseQueryBuilder.clone()
        .innerJoin('room.tags', 'userTags')
        .where('userTags.name IN (:...userTagNames)', { userTagNames })
        .andWhere('room.isPublic = :isPublic', { isPublic: true });
      
      if (userRoomIds.length > 0) {
        personalizedQuery.andWhere('room.id NOT IN (:...userRoomIds)', { userRoomIds });
      }
      
      if (search) {
        personalizedQuery.andWhere(
          '(room.title ILIKE :search OR room.description ILIKE :search)',
          { search: `%${search}%` },
        );
      }

      const personalizedRooms = await personalizedQuery
        .orderBy('room.createdAt', 'DESC')
        .getMany();

      // Get other public rooms (not matching user's tags)
      const otherRoomsQuery = this.roomRepository
        .createQueryBuilder('room')
        .leftJoinAndSelect('room.admin', 'admin')
        .leftJoinAndSelect('room.tags', 'tags')
        .where('room.isPublic = :isPublic', { isPublic: true });
      
      if (userRoomIds.length > 0) {
        otherRoomsQuery.andWhere('room.id NOT IN (:...userRoomIds)', { userRoomIds });
      }
      
      if (search) {
        otherRoomsQuery.andWhere(
          '(room.title ILIKE :search OR room.description ILIKE :search)',
          { search: `%${search}%` },
        );
      }

      // Exclude personalized rooms from other rooms
      const personalizedRoomIds = personalizedRooms.map(r => r.id);
      if (personalizedRoomIds.length > 0) {
        otherRoomsQuery.andWhere('room.id NOT IN (:...personalizedRoomIds)', { personalizedRoomIds });
      }

      const otherRooms = await otherRoomsQuery
        .orderBy('room.createdAt', 'DESC')
        .getMany();

      // Combine: personalized first, then others
      const allRooms = [...personalizedRooms, ...otherRooms];
      total = allRooms.length;

      // Apply pagination to combined results
      rooms = allRooms.slice(skip, skip + limit);
    } else {
      // No personalized feed, just show all public rooms
      [rooms, total] = await baseQueryBuilder
        .orderBy('room.createdAt', 'DESC')
        .skip(skip)
        .take(limit)
        .getManyAndCount();
    }

    // Add additional metadata to each room
    const roomsWithMetadata = await Promise.all(
      rooms.map(async (room) => {
        const memberCount = await this.getRoomMemberCount(room.id);
        const tagMatches = hasPersonalizedFeed
          ? room.tags.filter((tag) => userTagNames.includes(tag.name)).length
          : 0;

        return {
          ...this.formatRoomResponse(room),
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
      search: search || null,
    };
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
  ): Promise<any> {
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
    if (updateRoomDto.autoJoin !== undefined)
      room.autoJoin = updateRoomDto.autoJoin;

    const savedRoom = await this.roomRepository.save(room);
    return this.formatRoomResponse(savedRoom);
  }

  async delete(id: string, userId: string): Promise<void> {
    const room = await this.findOne(id);

    // Check if user is the admin of the room
    if (room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can delete the room');
    }

    await this.roomRepository.remove(room);
  }

  async findByRoomCode(roomCode: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { roomCode },
      relations: ['admin', 'tags'],
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    return room;
  }

  async joinRoom(roomCode: string, userId: string) {
    const room = await this.findByRoomCode(roomCode);
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user is the admin (admin doesn't need to join as member)
    if (room.admin.id === userId) {
      return {
        success: true,
        message: `You are the admin of ${room.title}`,
        room: this.formatRoomResponse(room),
      };
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
        room: this.formatRoomResponse(room),
      };
    }

    // If autoJoin is enabled, join directly without approval
    if (room.autoJoin) {
      const roomMember = this.roomMemberRepository.create({
        room,
        user,
      });
      await this.roomMemberRepository.save(roomMember);

      return {
        success: true,
        message: `Successfully joined ${room.title}`,
        room: this.formatRoomResponse(room),
      };
    }

    // For rooms without autoJoin, check if there's already a pending request
    const existingRequest = await this.joinRequestRepository.findOne({
      where: {
        room: { id: room.id },
        user: { id: userId },
        status: JoinRequestStatus.PENDING,
      },
    });

    if (existingRequest) {
      return {
        success: true,
        message: `You have already requested to join ${room.title}. Please wait for approval.`,
        requestId: existingRequest.id,
        status: 'pending',
      };
    }

    // Check if there's a rejected request (allow re-requesting)
    const rejectedRequest = await this.joinRequestRepository.findOne({
      where: {
        room: { id: room.id },
        user: { id: userId },
        status: JoinRequestStatus.REJECTED,
      },
    });

    if (rejectedRequest) {
      // Update the rejected request to pending
      rejectedRequest.status = JoinRequestStatus.PENDING;
      rejectedRequest.reviewedBy = null;
      rejectedRequest.reviewedAt = null;
      await this.joinRequestRepository.save(rejectedRequest);

      return {
        success: true,
        message: `Join request submitted for ${room.title}. Please wait for approval.`,
        requestId: rejectedRequest.id,
        status: 'pending',
      };
    }

    // Create new join request
    const joinRequest = this.joinRequestRepository.create({
      room,
      user,
      status: JoinRequestStatus.PENDING,
    });
    await this.joinRequestRepository.save(joinRequest);

    return {
      success: true,
      message: `Join request submitted for ${room.title}. Please wait for approval.`,
      requestId: joinRequest.id,
      status: 'pending',
    };
  }

  async getJoinRequests(roomId: string, userId: string) {
    const room = await this.findOne(roomId);

    // Check if user is admin or moderator
    const isAdmin = room.admin.id === userId;
    const isModerator = await this.roomMemberRepository.findOne({
      where: {
        room: { id: roomId },
        user: { id: userId },
        role: 'moderator' as any,
      },
    });

    if (!isAdmin && !isModerator) {
      throw new ForbiddenException('Only admin or moderator can view join requests');
    }

    const requests = await this.joinRequestRepository.find({
      where: {
        room: { id: roomId },
        status: JoinRequestStatus.PENDING,
      },
      relations: ['user', 'room'],
      order: { createdAt: 'ASC' },
    });

    return requests.map(request => ({
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      user: {
        id: request.user.id,
        firstName: request.user.firstName,
        lastName: request.user.lastName,
        email: request.user.email,
        image: request.user.image,
      },
    }));
  }

  async reviewJoinRequest(
    roomId: string,
    requestId: string,
    action: 'accepted' | 'rejected',
    reviewerId: string,
  ) {
    const room = await this.findOne(roomId);

    // Check if user is admin or moderator
    const isAdmin = room.admin.id === reviewerId;
    const isModerator = await this.roomMemberRepository.findOne({
      where: {
        room: { id: roomId },
        user: { id: reviewerId },
        role: 'moderator' as any,
      },
    });

    if (!isAdmin && !isModerator) {
      throw new ForbiddenException('Only admin or moderator can review join requests');
    }

    const request = await this.joinRequestRepository.findOne({
      where: { id: requestId, room: { id: roomId } },
      relations: ['user', 'room'],
    });

    if (!request) {
      throw new NotFoundException('Join request not found');
    }

    if (request.status !== JoinRequestStatus.PENDING) {
      throw new BadRequestException('This request has already been reviewed');
    }

    const reviewer = await this.userRepository.findOne({ where: { id: reviewerId } });

    if (action === 'accepted') {
      // Create membership
      const roomMember = this.roomMemberRepository.create({
        room: request.room,
        user: request.user,
      });
      await this.roomMemberRepository.save(roomMember);

      // Update request status
      request.status = JoinRequestStatus.ACCEPTED;
      request.reviewedBy = reviewer;
      request.reviewedAt = new Date();
      await this.joinRequestRepository.save(request);

      return {
        success: true,
        message: `${request.user.firstName} ${request.user.lastName} has been added to the room`,
      };
    } else {
      // Reject request
      request.status = JoinRequestStatus.REJECTED;
      request.reviewedBy = reviewer;
      request.reviewedAt = new Date();
      await this.joinRequestRepository.save(request);

      return {
        success: true,
        message: `Join request from ${request.user.firstName} ${request.user.lastName} has been rejected`,
      };
    }
  }

  async getMyJoinRequests(userId: string) {
    const requests = await this.joinRequestRepository.find({
      where: { user: { id: userId } },
      relations: ['room', 'room.admin'],
      order: { createdAt: 'DESC' },
    });

    return requests.map(request => ({
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      reviewedAt: request.reviewedAt,
      room: {
        id: request.room.id,
        title: request.room.title,
        description: request.room.description,
        admin: {
          id: request.room.admin.id,
          firstName: request.room.admin.firstName,
          lastName: request.room.admin.lastName,
        },
      },
    }));
  }

  async cancelJoinRequest(requestId: string, userId: string) {
    const request = await this.joinRequestRepository.findOne({
      where: { id: requestId, user: { id: userId } },
      relations: ['room'],
    });

    if (!request) {
      throw new NotFoundException('Join request not found');
    }

    if (request.status !== JoinRequestStatus.PENDING) {
      throw new BadRequestException('Only pending requests can be cancelled');
    }

    await this.joinRequestRepository.remove(request);

    return {
      success: true,
      message: `Join request for ${request.room.title} has been cancelled`,
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

  async getRoomMembers(roomId: string, userId: string): Promise<any[]> {
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

    const members = await this.roomMemberRepository.find({
      where: { room: { id: roomId } },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });

    return members.map(member => ({
      id: member.id,
      role: member.role,
      joinedAt: member.joinedAt,
      user: this.formatUserInfo(member.user),
    }));
  }

  async updateMemberRole(
    roomId: string,
    memberId: string,
    newRole: string,
    adminId: string,
  ): Promise<any> {
    const room = await this.findOne(roomId);

    // Only room admin can update member roles
    if (room.admin.id !== adminId) {
      throw new ForbiddenException('Only room admin can update member roles');
    }

    const member = await this.roomMemberRepository.findOne({
      where: {
        id: memberId,
        room: { id: roomId },
      },
      relations: ['user', 'room'],
    });

    if (!member) {
      throw new NotFoundException('Member not found in this room');
    }

    member.role = newRole as any;
    const savedMember = await this.roomMemberRepository.save(member);
    
    return {
      id: savedMember.id,
      role: savedMember.role,
      joinedAt: savedMember.joinedAt,
      user: this.formatUserInfo(savedMember.user),
    };
  }

  async removeMember(
    roomId: string,
    memberId: string,
    adminId: string,
  ): Promise<{ message: string }> {
    const room = await this.findOne(roomId);

    // Only room admin can remove members
    if (room.admin.id !== adminId) {
      throw new ForbiddenException('Only room admin can remove members');
    }

    const member = await this.roomMemberRepository.findOne({
      where: {
        id: memberId,
        room: { id: roomId },
      },
      relations: ['user'],
    });

    if (!member) {
      throw new NotFoundException('Member not found in this room');
    }

    // Delete any associated join requests for this user in this room
    await this.joinRequestRepository.delete({
      room: { id: roomId },
      user: { id: member.user.id },
    });

    await this.roomMemberRepository.remove(member);

    return {
      message: `${member.user.firstName} ${member.user.lastName} has been removed from the room`,
    };
  }

  async findUserRoomsWithFilter(queryDto: QueryUserRoomsDto, userId: string) {
    const { page, limit, sortBy, sortOrder, filter, search } = queryDto;

    // Get counts for all categories
    const [createdCount, joinedCount] = await Promise.all([
      this.getCreatedRoomsCount(userId, search),
      this.getJoinedRoomsCount(userId, search),
    ]);

    const totalCount = createdCount + joinedCount;
    let rooms: any[] = [];
    let total: number = 0;

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
      totalPages: Math.ceil(total / (limit || 10)),
      currentPage: page || 1,
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

        // Get 7 member previews (excluding admin)
        const memberPreviews = await this.roomMemberRepository.find({
          where: { room: { id: room.id } },
          relations: ['user'],
          take: 7,
          order: { joinedAt: 'DESC' },
        });

        const members = memberPreviews.map(m => ({
          id: m.user.id,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          image: m.user.image,
        }));

        // Get moderator IDs
        const moderators = await this.roomMemberRepository.find({
          where: { room: { id: room.id }, role: 'moderator' as any },
          relations: ['user'],
        });
        const moderatorIds = moderators.map(m => m.user.id);

        return {
          ...room,
          admin: {
            id: room.admin.id,
            firstName: room.admin.firstName,
            lastName: room.admin.lastName,
            email: room.admin.email,
            image: room.admin.image,
          },
          type: 'created',
          userRole: 'admin',
          memberCount: memberCount + 1, // +1 for admin
          members,
          moderators: moderatorIds,
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

        // Get 7 member previews (excluding admin)
        const memberPreviews = await this.roomMemberRepository.find({
          where: { room: { id: member.room.id } },
          relations: ['user'],
          take: 7,
          order: { joinedAt: 'DESC' },
        });

        const membersList = memberPreviews.map(m => ({
          id: m.user.id,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          image: m.user.image,
        }));

        // Get moderator IDs
        const moderators = await this.roomMemberRepository.find({
          where: { room: { id: member.room.id }, role: 'moderator' as any },
          relations: ['user'],
        });
        const moderatorIds = moderators.map(m => m.user.id);

        return {
          ...member.room,
          admin: {
            id: member.room.admin.id,
            firstName: member.room.admin.firstName,
            lastName: member.room.admin.lastName,
            email: member.room.admin.email,
            image: member.room.admin.image,
          },
          type: 'joined',
          userRole: member.role, // Use actual role from member
          memberCount: memberCount + 1, // +1 for admin
          role: member.role, // Include role field
          joinedAt: member.joinedAt,
          members: membersList,
          moderators: moderatorIds,
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

  /**
   * Get all room IDs for a user (both created and joined)
   */
  async getUserRoomIds(userId: string): Promise<string[]> {
    // Get created room IDs
    const createdRooms = await this.roomRepository.find({
      where: { admin: { id: userId } },
      select: ['id'],
    });

    // Get joined room IDs
    const joinedRoomMembers = await this.roomMemberRepository.find({
      where: { user: { id: userId } },
      relations: ['room'],
    });

    const createdRoomIds = createdRooms.map((room) => room.id);
    const joinedRoomIds = joinedRoomMembers.map((member) => member.room.id);

    // Return unique room IDs
    return [...new Set([...createdRoomIds, ...joinedRoomIds])];
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
    files: any[];
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
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC', search, folderId } = queryDto;

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
    
    let currentFolder: Folder | null = null;
    let breadcrumb: any[] = [];

    // If not root, get current folder info and breadcrumb in parallel
    if (!isRoot) {
      const [folder, breadcrumbResult] = await Promise.all([
        this.folderRepository.findOne({
          where: { id: folderId },
          relations: ['room', 'parentFolder'],
        }),
        this.generateFolderBreadcrumb(folderId),
      ]);

      currentFolder = folder;

      if (!currentFolder) {
        throw new NotFoundException('Folder not found');
      }

      if (!currentFolder.room || currentFolder.room.id !== roomId || currentFolder.type !== FolderType.ROOM) {
        throw new ForbiddenException('Folder does not belong to this room');
      }

      breadcrumb = breadcrumbResult;
    }

    // Build folder query with optimized selects and subfolder count
    let folderQueryBuilder = this.folderRepository
      .createQueryBuilder('folder')
      .leftJoin('folder.room', 'room')
      .addSelect(['room.id'])
      .leftJoin('folder.parentFolder', 'parentFolder')
      .addSelect(['parentFolder.id', 'parentFolder.name'])
      .leftJoin('folder.owner', 'owner')
      .addSelect(['owner.id', 'owner.firstName', 'owner.lastName', 'owner.email', 'owner.image'])
      .loadRelationCountAndMap('folder.subfolderCount', 'folder.subfolders', 'subfolder', (qb) =>
        qb.where('subfolder.type = :type', { type: FolderType.ROOM })
      )
      .where('folder.room.id = :roomId AND folder.type = :folderType', {
        roomId,
        folderType: FolderType.ROOM,
      });

    // Build file query with optimized selects
    let fileQueryBuilder = this.fileRepository
      .createQueryBuilder('file')
      .leftJoin('file.uploader', 'uploader')
      .addSelect(['uploader.id', 'uploader.firstName', 'uploader.lastName', 'uploader.email', 'uploader.image'])
      .leftJoin('file.room', 'room')
      .addSelect(['room.id'])
      .leftJoin('file.folder', 'folder')
      .addSelect(['folder.id', 'folder.name'])
      .where('file.room.id = :roomId', { roomId });

    // Filter by folder location
    if (isRoot) {
      folderQueryBuilder.andWhere('folder.parentFolder IS NULL');
      fileQueryBuilder.andWhere('file.folder IS NULL');
    } else {
      folderQueryBuilder.andWhere('folder.parentFolder.id = :folderId', { folderId });
      fileQueryBuilder.andWhere('file.folder.id = :folderId', { folderId });
    }

    // Apply search filter
    if (search) {
      folderQueryBuilder.andWhere('folder.name ILIKE :search', { search: `%${search}%` });
      fileQueryBuilder.andWhere(
        '(file.originalName ILIKE :search OR file.fileName ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Get counts in parallel
    const [totalFolders, totalFiles, userRole] = await Promise.all([
      folderQueryBuilder.getCount(),
      fileQueryBuilder.getCount(),
      this.getUserRoleInRoom(userId, roomId),
    ]);

    const totalCombined = totalFolders + totalFiles;
    const totalPages = Math.ceil(totalCombined / limit);
    const skip = (page - 1) * limit;

    // Calculate optimized pagination
    const foldersToSkip = Math.min(skip, totalFolders);
    const foldersToTake = Math.min(Math.max(0, limit - Math.max(0, skip - totalFolders)), totalFolders - foldersToSkip);
    const filesToSkip = Math.max(0, skip - totalFolders);
    const filesToTake = limit - foldersToTake;

    const sortField = sortBy === 'name' ? 'name' : sortBy;
    const fileSortField = sortBy === 'name' ? 'originalName' : sortBy;

    // Fetch folders and files in parallel
    const [folders, files] = await Promise.all([
      foldersToTake > 0
        ? folderQueryBuilder
            .orderBy(`folder.${sortField}`, sortOrder)
            .skip(foldersToSkip)
            .take(foldersToTake)
            .getMany()
        : Promise.resolve([]),
      filesToTake > 0
        ? fileQueryBuilder
            .orderBy(`file.${fileSortField}`, sortOrder)
            .skip(filesToSkip)
            .take(filesToTake)
            .getMany()
        : Promise.resolve([]),
    ]);

    // Get file counts for folders in a single query
    let foldersWithCounts: any[] = folders;
    if (folders.length > 0) {
      const folderIds = folders.map(f => f.id);
      const fileCounts = await this.fileRepository
        .createQueryBuilder('file')
        .select('file.folder.id', 'folderId')
        .addSelect('COUNT(file.id)', 'count')
        .where('file.folder.id IN (:...folderIds)', { folderIds })
        .andWhere('file.room.id = :roomId', { roomId })
        .groupBy('file.folder.id')
        .getRawMany();

      const fileCountMap = new Map(fileCounts.map(fc => [fc.folderId, parseInt(fc.count)]));

      foldersWithCounts = folders.map(folder => {
        const folderWithCount = folder as any;
        return {
          ...folder,
          owner: folder.owner ? {
            id: folder.owner.id,
            firstName: folder.owner.firstName,
            lastName: folder.owner.lastName,
            email: folder.owner.email,
            image: folder.owner.image,
          } : null,
          fileCount: fileCountMap.get(folder.id) || 0,
          totalItems: (folderWithCount.subfolderCount || 0) + (fileCountMap.get(folder.id) || 0),
        };
      });
    }

    // Format files with uploader info
    const filesWithUploaderInfo = files.map(file => ({
      ...file,
      uploader: file.uploader ? {
        id: file.uploader.id,
        firstName: file.uploader.firstName,
        lastName: file.uploader.lastName,
        email: file.uploader.email,
        image: file.uploader.image,
      } : null,
    }));

    return {
      folders: foldersWithCounts,
      files: filesWithUploaderInfo,
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

  // Helper method to generate folder breadcrumb - optimized with single recursive CTE query
  private async generateFolderBreadcrumb(folderId: string): Promise<any[]> {
    // Use a recursive query to get all ancestors in one database call
    const result = await this.folderRepository.query(`
      WITH RECURSIVE folder_path AS (
        SELECT id, name, type, "parentFolderId", 1 as depth
        FROM folders
        WHERE id = $1
        
        UNION ALL
        
        SELECT f.id, f.name, f.type, f."parentFolderId", fp.depth + 1
        FROM folders f
        INNER JOIN folder_path fp ON f.id = fp."parentFolderId"
      )
      SELECT id, name, type FROM folder_path ORDER BY depth DESC
    `, [folderId]);

    return result.map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
    }));
  }

  private formatUserInfo(user: User) {
    if (!user) return null;
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      image: user.image,
    };
  }

  private formatRoomResponse(room: Room) {
    return {
      id: room.id,
      title: room.title,
      description: room.description,
      isPublic: room.isPublic,
      autoJoin: room.autoJoin,
      roomCode: room.roomCode,
      admin: this.formatUserInfo(room.admin),
      tags: room.tags?.map(tag => ({ id: tag.id, name: tag.name })) || [],
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  }

  async bulkDeleteCourseContent(
    roomId: string,
    bulkDeleteDto: BulkDeleteContentDto,
    userId: string,
  ): Promise<{
    success: boolean;
    deletedFiles: number;
    deletedFolders: number;
    deletedSubfolders: number;
    deletedNotes: number;
    totalDeleted: number;
    errors: Array<{ id: string; type: string; error: string }>;
  }> {
    // Verify room exists and user has permission (admin or moderator)
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // Check if user is admin or moderator
    const isAdmin = room.admin.id === userId;
    const member = await this.roomMemberRepository.findOne({
      where: {
        room: { id: roomId },
        user: { id: userId },
      },
    });

    const isModerator = member?.role === 'moderator';

    if (!isAdmin && !isModerator) {
      throw new ForbiddenException('Only room admin or moderators can delete course content');
    }

    const errors: Array<{ id: string; type: string; error: string }> = [];
    let deletedFilesCount = 0;
    let deletedFoldersCount = 0;
    let deletedSubfoldersCount = 0;
    let deletedNotesCount = 0;

    // Delete individual files
    for (const fileId of bulkDeleteDto.fileIds || []) {
      try {
        // Verify file belongs to this room
        const file = await this.fileRepository.findOne({
          where: { id: fileId },
          relations: ['room'],
        });

        if (!file) {
          errors.push({ id: fileId, type: 'file', error: 'File not found' });
          continue;
        }

        if (file.room?.id !== roomId) {
          errors.push({ id: fileId, type: 'file', error: 'File does not belong to this room' });
          continue;
        }

        await this.fileService.deleteFile(fileId, userId);
        deletedFilesCount++;
      } catch (error: any) {
        errors.push({ 
          id: fileId, 
          type: 'file', 
          error: error.message || 'Failed to delete file' 
        });
      }
    }

    // Delete folders (this will recursively delete subfolders, files, and notes within)
    for (const folderId of bulkDeleteDto.folderIds || []) {
      try {
        // Verify folder belongs to this room
        const folder = await this.folderRepository.findOne({
          where: { id: folderId },
          relations: ['room'],
        });

        if (!folder) {
          errors.push({ id: folderId, type: 'folder', error: 'Folder not found' });
          continue;
        }

        if (folder.room?.id !== roomId) {
          errors.push({ id: folderId, type: 'folder', error: 'Folder does not belong to this room' });
          continue;
        }

        const deleteResult = await this.folderService.remove(folderId, userId);
        deletedFoldersCount++;
        deletedSubfoldersCount += deleteResult.deletedItemsCount.subfolders;
        deletedNotesCount += deleteResult.deletedItemsCount.notes;
        deletedFilesCount += deleteResult.deletedItemsCount.files;
      } catch (error: any) {
        errors.push({ 
          id: folderId, 
          type: 'folder', 
          error: error.message || 'Failed to delete folder' 
        });
      }
    }

    const totalDeleted = deletedFilesCount + deletedFoldersCount + deletedSubfoldersCount + deletedNotesCount;

    return {
      success: errors.length === 0,
      deletedFiles: deletedFilesCount,
      deletedFolders: deletedFoldersCount,
      deletedSubfolders: deletedSubfoldersCount,
      deletedNotes: deletedNotesCount,
      totalDeleted,
      errors,
    };
  }
}
