import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Announcement } from '../entities/announcement.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { QueryAnnouncementDto } from './dto/query-announcement.dto';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    @InjectRepository(Announcement)
    private announcementRepository: Repository<Announcement>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectQueue('announcements')
    private announcementQueue: Queue,
    private notificationService: NotificationService,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    // Test queue connection on startup
    this.announcementQueue.isReady().catch((error) => {
      this.logger.error(`Queue not ready: ${error.message}`);
    });
  }

  async create(createAnnouncementDto: CreateAnnouncementDto, userId: string): Promise<any> {
    const room = await this.roomRepository.findOne({
      where: { id: createAnnouncementDto.roomId },
      relations: ['admin'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const announcement = this.announcementRepository.create({
      title: createAnnouncementDto.title,
      content: createAnnouncementDto.content,
      isPublished: createAnnouncementDto.isPublished || false,
      room,
      author: user,
    });

    const saved = await this.announcementRepository.save(announcement);

    // If published immediately, trigger notifications only
    // WebSocket broadcasting is handled by the gateway itself
    if (saved.isPublished) {
      await this.notificationService.createAnnouncementNotifications(saved);
    }

    return this.formatAnnouncementResponse(saved);
  }

  async schedule(scheduleAnnouncementDto: CreateAnnouncementDto, userId: string): Promise<any> {
    const scheduledDate = new Date(scheduleAnnouncementDto.scheduledAt??'');
    
    if (scheduledDate <= new Date()) {
      throw new BadRequestException('Scheduled time must be in the future');
    }

    // Load room and user entities (same pattern as create method)
    const room = await this.roomRepository.findOne({
      where: { id: scheduleAnnouncementDto.roomId },
      relations: ['admin'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.logger.log(`Scheduling announcement for: ${scheduledDate.toISOString()}`);

    const announcement = this.announcementRepository.create({
      title: scheduleAnnouncementDto.title,
      content: scheduleAnnouncementDto.content,
      scheduledAt: scheduledDate,
      isPublished: false,
      room,
      author: user,
    });

    const saved = await this.announcementRepository.save(announcement);
    this.logger.log(`Scheduled announcement saved: ${saved.id}`);

    // Schedule the announcement with BullMQ
    const delay = scheduledDate.getTime() - Date.now();
    try {
      this.logger.log(`Adding to queue with delay: ${delay}ms`);
      const job = await this.announcementQueue.add(
        'publish-scheduled', 
        { announcementId: saved.id },
        { 
          delay,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
        },
      );
      this.logger.log(`Scheduled announcement ${saved.id} for ${scheduledDate.toISOString()}, job ID: ${job.id}`);
    } catch (error) {
      this.logger.error(`Failed to add announcement to queue: ${error.message}`, error.stack);
      // Continue anyway - the announcement is saved and can be manually published
    }

    return this.formatAnnouncementResponse(saved);
  }

  async findAll(queryDto: QueryAnnouncementDto): Promise<any> {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'DESC', roomId, filter = 'all' } = queryDto;
    const skip = (page - 1) * limit;


    let queryBuilder = this.announcementRepository
      .createQueryBuilder('announcement')
      .leftJoinAndSelect('announcement.room', 'room')
      .leftJoinAndSelect('announcement.author', 'author')
      .where('announcement.room.id = :roomId', { roomId })
      .andWhere('announcement.isPublished = true');

    // Apply filters
    if (filter === 'published') {
      queryBuilder.andWhere('announcement.isPublished = :isPublished', { isPublished: true });
    } else if (filter === 'scheduled') {
      queryBuilder.andWhere('announcement.isPublished = :isPublished', { isPublished: false });
      queryBuilder.andWhere('announcement.scheduledAt IS NOT NULL');
    } else if (filter === 'draft') {
      queryBuilder.andWhere('announcement.isPublished = :isPublished', { isPublished: false });
      queryBuilder.andWhere('announcement.scheduledAt IS NULL');
    }

    const [announcements, total] = await queryBuilder
      .orderBy(`announcement.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      announcements: announcements.map((a) => this.formatAnnouncementResponse(a)),
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async findOne(id: string): Promise<any> {
    const announcement = await this.announcementRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin', 'author'],
    });

    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    return this.formatAnnouncementResponse(announcement);
  }

  async update(id: string, updateAnnouncementDto: UpdateAnnouncementDto, userId: string): Promise<any> {
    const announcement = await this.announcementRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin', 'author'],
    });

    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    // Only author can update
    if (announcement.author.id !== userId) {
      throw new ForbiddenException('Only the author can update this announcement');
    }

    const wasPublished = announcement.isPublished;

    if (updateAnnouncementDto.title !== undefined) {
      announcement.title = updateAnnouncementDto.title;
      announcement.isEdited = true;
    }
    if (updateAnnouncementDto.content !== undefined) {
      announcement.content = updateAnnouncementDto.content;
      announcement.isEdited = true;
    }
    if (updateAnnouncementDto.isPublished !== undefined) {
      announcement.isPublished = updateAnnouncementDto.isPublished;
    }

    const updated = await this.announcementRepository.save(announcement);

    // If just published (wasn't published before), trigger notifications only
    // WebSocket broadcasting is handled by the gateway itself
    if (!wasPublished && updated.isPublished) {
      await this.notificationService.createAnnouncementNotifications(updated);
    }

    return this.formatAnnouncementResponse(updated);
  }

  async remove(id: string, userId: string): Promise<any> {
    const announcement = await this.announcementRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin', 'author'],
    });

    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    // Only author or room admin can delete
    if (announcement.author.id !== userId && announcement.room.admin.id !== userId) {
      throw new ForbiddenException('Only the author or room admin can delete this announcement');
    }

    await this.announcementRepository.remove(announcement);
    return { message: 'Announcement deleted successfully' };
  }

  private async publishAnnouncement(announcement: Announcement): Promise<void> {
    try {
      // Create notifications and send FCM
      await this.notificationService.createAnnouncementNotifications(announcement);
    } catch (error) {
      this.logger.error(`Error publishing announcement: ${error.message}`, error.stack);
    }
  }

  private formatAnnouncementResponse(announcement: Announcement) {
    return {
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      isPublished: announcement.isPublished,
      isEdited: announcement.isEdited,
      scheduledAt: announcement.scheduledAt,
      createdAt: announcement.createdAt,
      editedAt: announcement.editedAt,
      room: announcement.room ? {
        id: announcement.room.id,
        title: announcement.room.title,
      } : null,
      author: announcement.author ? {
        id: announcement.author.id,
        firstName: announcement.author.firstName,
        lastName: announcement.author.lastName,
        email: announcement.author.email,
        image: announcement.author.image,
      } : null,
    };
  }
}
