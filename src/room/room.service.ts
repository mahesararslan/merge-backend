// src/room/room.service.ts
import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { TagService } from '../tag/tag.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { Tag } from 'src/entities/tag.entity';
import { RoomMember } from '../entities/room-member.entity'; // Add this import

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RoomMember) // Add this
    private roomMemberRepository: Repository<RoomMember>,
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
  const tags: Tag[] = createRoomDto.tagNames && createRoomDto.tagNames.length > 0
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
      where: { roomCode } 
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

  async findAll(page: number = 1, limit: number = 10, search?: string): Promise<{
    rooms: Room[];
    total: number;
    totalPages: number;
    currentPage: number;
  }> {
    const skip = (page - 1) * limit;
    
    const queryBuilder = this.roomRepository
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.admin', 'admin')
      .leftJoinAndSelect('room.tags', 'tags')
      .where('room.isPublic = :isPublic', { isPublic: true });

    if (search) {
      queryBuilder.andWhere(
        '(room.title ILIKE :search OR room.description ILIKE :search)',
        { search: `%${search}%` }
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

  async findByRoomCode(roomCode: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { roomCode },
      relations: ['admin', 'tags'],
    });

    if (!room) {
      throw new NotFoundException(`Room with code ${roomCode} not found`);
    }

    return room;
  }

  async update(id: string, updateRoomDto: UpdateRoomDto, userId: string): Promise<Room> {
    const room = await this.findOne(id);

    // Check if user is the admin of the room
    if (room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can update room settings');
    }

    // Handle tags update if provided
    if (updateRoomDto.tagNames) {
      const tags = await this.tagService.findOrCreateTags(updateRoomDto.tagNames);
      room.tags = tags;
    }

    // Update other fields
    if (updateRoomDto.title) room.title = updateRoomDto.title;
    if (updateRoomDto.description !== undefined) room.description = updateRoomDto.description;
    if (updateRoomDto.isPublic !== undefined) room.isPublic = updateRoomDto.isPublic;

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
        user: { id: userId } 
      }
    });

    if (existingMember) {
      return {
        success: true,
        message: `You are already a member of ${room.title}`,
        room
      };
    }

    // Check if user is the admin (admin doesn't need to join as member)
    if (room.admin.id === userId) {
      return {
        success: true,
        message: `You are the admin of ${room.title}`,
        room
      };
    }

    // Create membership
    const roomMember = this.roomMemberRepository.create({
      room,
      user
    });

    await this.roomMemberRepository.save(roomMember);

    return {
      success: true,
      message: `Successfully joined ${room.title}`,
      room
    };
  }

  async findJoinedRooms(userId: string): Promise<Room[]> {
    const roomMembers = await this.roomMemberRepository.find({
      where: { user: { id: userId } },
      relations: ['room', 'room.admin', 'room.tags'],
      order: { joinedAt: 'DESC' }
    });

    return roomMembers.map(member => member.room);
  }

  async findAllUserRooms(userId: string): Promise<{
    createdRooms: Room[];
    joinedRooms: Room[];
    totalRooms: number;
  }> {
    const [createdRooms, joinedRooms] = await Promise.all([
      this.findUserRooms(userId),
      this.findJoinedRooms(userId)
    ]);

    return {
      createdRooms,
      joinedRooms,
      totalRooms: createdRooms.length + joinedRooms.length
    };
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    const room = await this.findOne(roomId);

    // Check if user is the admin
    if (room.admin.id === userId) {
      throw new ForbiddenException('Room admin cannot leave the room. Transfer ownership or delete the room instead.');
    }

    const roomMember = await this.roomMemberRepository.findOne({
      where: { 
        room: { id: roomId }, 
        user: { id: userId } 
      }
    });

    if (!roomMember) {
      throw new NotFoundException('You are not a member of this room');
    }

    await this.roomMemberRepository.remove(roomMember);
  }

  async getRoomMembers(roomId: string, userId: string): Promise<RoomMember[]> {
    const room = await this.findOne(roomId);

    // Check if user has access to view members (admin or member)
    const hasAccess = room.admin.id === userId || 
      await this.roomMemberRepository.findOne({
        where: { 
          room: { id: roomId }, 
          user: { id: userId } 
        }
      });

    if (!hasAccess && !room.isPublic) {
      throw new ForbiddenException('You do not have access to view this room\'s members');
    }

    return this.roomMemberRepository.find({
      where: { room: { id: roomId } },
      relations: ['user'],
      order: { joinedAt: 'ASC' }
    });
  }

  async searchRoomsByTags(tagNames: string[]): Promise<Room[]> {
    if (!tagNames || tagNames.length === 0) {
      return this.roomRepository.find({
        where: { isPublic: true },
        relations: ['admin', 'tags'],
        order: { createdAt: 'DESC' },
      });
    }

    return this.roomRepository
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.admin', 'admin')
      .leftJoinAndSelect('room.tags', 'tags')
      .where('room.isPublic = :isPublic', { isPublic: true })
      .andWhere('tags.name IN (:...tagNames)', { tagNames })
      .orderBy('room.createdAt', 'DESC')
      .getMany();
  }
}