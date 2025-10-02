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

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
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
    
    // For now, just return the room info
    // Later you can implement actual membership logic
    return {
        success: true,
        message: `User ${userId} joined room ${room.title}`,
        room
    };
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