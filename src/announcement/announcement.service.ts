import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Announcement } from '../entities/announcement.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { RoomMember } from '../entities/room-member.entity';
import { RoomPermissions } from '../entities/room-permissions.entity';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { FcmService } from '../notification/fcm.service';

@Injectable()
export class AnnouncementService {
  constructor(
    @InjectRepository(Announcement)
    private announcementRepository: Repository<Announcement>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RoomMember)
    private roomMemberRepository: Repository<RoomMember>,
    @InjectRepository(RoomPermissions)
    private roomPermissionsRepository: Repository<RoomPermissions>,
    private fcmService: FcmService,
  ) {}

  async canPostAnnouncement(userId: string, roomId: string): Promise<boolean> {
    // Check if user is room admin
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    if (room.admin.id === userId) {
      return true; // Room admin can always post
    }

    // Check if user is a member with announcement permission
    const roomMember = await this.roomMemberRepository.findOne({
      where: {
        room: { id: roomId },
        user: { id: userId },
      },
      relations: ['roomPermissions'],
    });

    if (!roomMember) {
      return false; // Not a member
    }

    // Check if member has permission to post announcements
    const hasPermission = await this.roomPermissionsRepository.findOne({
      where: {
        member: { id: roomMember.id },
        can_post_announcements: true,
      },
    });

    return !!hasPermission;
  }

  async create(
    createAnnouncementDto: CreateAnnouncementDto,
    roomId: string,
    authorId: string,
  ): Promise<Announcement> {
    // Check permission
    const canPost = await this.canPostAnnouncement(authorId, roomId);
    if (!canPost) {
      throw new ForbiddenException('You do not have permission to post announcements in this room');
    }

    // Get room with admin relation
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // Get author
    const author = await this.userRepository.findOne({
      where: { id: authorId },
    });

    if (!author) {
      throw new NotFoundException('Author not found');
    }

    // Create announcement with explicit typing
    const announcement = new Announcement();
    announcement.title = createAnnouncementDto.title;
    announcement.content = createAnnouncementDto.content;
    announcement.room = room;
    announcement.author = author;

    const savedAnnouncement = await this.announcementRepository.save(announcement);

    // Send push notifications (don't await to avoid blocking)
    this.sendAnnouncementNotifications(savedAnnouncement).catch(error => {
      console.error('Error sending announcement notifications:', error);
    });

    return savedAnnouncement;
  }

  async sendAnnouncementNotifications(announcement: Announcement): Promise<void> {
    try {
      // Get all room members with FCM tokens
      const roomMembers = await this.roomMemberRepository.find({
        where: { room: { id: announcement.room.id } },
        relations: ['user'],
      });

      // Also include room admin
      const room = await this.roomRepository.findOne({
        where: { id: announcement.room.id },
        relations: ['admin'],
      });

      if(!room) throw new NotFoundException('Room Not Found');

      const allUsers = [
        room.admin,
        ...roomMembers.map(member => member.user),
      ];

      // Remove duplicates and filter users with FCM tokens
      const uniqueUsers = allUsers.filter((user, index, self) => 
        index === self.findIndex(u => u.id === user.id) && 
        user.fcmToken && 
        user.id !== announcement.author.id // Don't send to announcement author
      );

      const fcmTokens = uniqueUsers.map(user => user.fcmToken);

      if (fcmTokens.length > 0) {
        await this.fcmService.sendToMultipleDevices(
          fcmTokens,
          `New Announcement in ${announcement.room.title}`,
          announcement.title,
          {
            type: 'announcement',
            roomId: announcement.room.id,
            announcementId: announcement.id,
          }
        );
      }

      // Alternative: Send to topic (if you prefer topic-based messaging)
      await this.fcmService.sendToTopic(
        `room_${announcement.room.id}`,
        `New Announcement in ${announcement.room.title}`,
        announcement.title,
        {
          type: 'announcement',
          roomId: announcement.room.id,
          announcementId: announcement.id,
        }
      );
    } catch (error) {
      console.error('Error sending announcement notifications:', error);
      // Don't throw error as announcement was created successfully
    }
  }

  async findAll(
    roomId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    announcements: Announcement[];
    total: number;
    totalPages: number;
    currentPage: number;
  }> {
    const skip = (page - 1) * limit;

    const [announcements, total] = await this.announcementRepository.findAndCount({
      where: { room: { id: roomId } },
      relations: ['author', 'room'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      announcements,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async findOne(id: string): Promise<Announcement> {
    const announcement = await this.announcementRepository.findOne({
      where: { id },
      relations: ['author', 'room'],
    });

    if (!announcement) {
      throw new NotFoundException(`Announcement with ID ${id} not found`);
    }

    return announcement;
  }

  async update(
    id: string,
    updateAnnouncementDto: UpdateAnnouncementDto,
    userId: string,
  ): Promise<Announcement> {
    const announcement = await this.announcementRepository.findOne({
      where: { id },
      relations: ['author', 'room', 'room.admin'], // Include room.admin relation
    });

    if (!announcement) {
      throw new NotFoundException(`Announcement with ID ${id} not found`);
    }

    // Check if user can edit (only author or room admin)
    const isAuthor = announcement.author.id === userId;
    const isRoomAdmin = announcement.room.admin?.id === userId;

    if (!isAuthor && !isRoomAdmin) {
      throw new ForbiddenException('You can only edit your own announcements or if you are the room admin');
    }

    // Update fields
    if (updateAnnouncementDto.title) {
      announcement.title = updateAnnouncementDto.title;
    }
    if (updateAnnouncementDto.content) {
      announcement.content = updateAnnouncementDto.content;
    }

    return this.announcementRepository.save(announcement);
  }

  async remove(id: string, userId: string): Promise<void> {
    const announcement = await this.announcementRepository.findOne({
      where: { id },
      relations: ['author', 'room', 'room.admin'], // Include room.admin relation
    });

    if (!announcement) {
      throw new NotFoundException(`Announcement with ID ${id} not found`);
    }

    // Check if user can delete (only author or room admin)
    const isAuthor = announcement.author.id === userId;
    const isRoomAdmin = announcement.room.admin?.id === userId;

    if (!isAuthor && !isRoomAdmin) {
      throw new ForbiddenException('You can only delete your own announcements or if you are the room admin');
    }

    await this.announcementRepository.remove(announcement);
  }
}