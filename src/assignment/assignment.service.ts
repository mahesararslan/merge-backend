import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentAttempt } from '../entities/assignment-attempt.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { RoomMember } from '../entities/room-member.entity';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { QueryAssignmentDto } from './dto/query-assignment.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';

@Injectable()
export class AssignmentService {
  constructor(
    @InjectRepository(Assignment)
    private assignmentRepository: Repository<Assignment>,
    @InjectRepository(AssignmentAttempt)
    private attemptRepository: Repository<AssignmentAttempt>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RoomMember)
    private roomMemberRepository: Repository<RoomMember>,
  ) {}

  async create(createAssignmentDto: CreateAssignmentDto, userId: string) {
    const room = await this.roomRepository.findOne({
      where: { id: createAssignmentDto.roomId },
      relations: ['admin'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // Only room admin can create assignments
    if (room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can create assignments');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const assignment = this.assignmentRepository.create(createAssignmentDto);
    assignment.room = room;
    assignment.author = user;
    assignment.startAt = createAssignmentDto.startAt ? new Date(createAssignmentDto.startAt) : null;
    assignment.endAt = createAssignmentDto.endAt ? new Date(createAssignmentDto.endAt) : null;

    const saved = await this.assignmentRepository.save(assignment);
    return this.formatAssignmentResponse(saved);
  }

  async findAll(queryDto: QueryAssignmentDto, userId: string) {
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC', search, roomId } = queryDto;
    const skip = (page - 1) * limit;

    let queryBuilder = this.assignmentRepository
      .createQueryBuilder('assignment')
      .leftJoinAndSelect('assignment.room', 'room')
      .leftJoinAndSelect('assignment.author', 'author')
      .leftJoinAndSelect('room.admin', 'admin');

    // Filter by room if provided
    if (roomId) {
      queryBuilder.andWhere('assignment.room.id = :roomId', { roomId });

      // Check if user has access to this room
      const hasAccess = await this.checkRoomAccess(userId, roomId);
      if (!hasAccess) {
        throw new ForbiddenException('You do not have access to this room');
      }
    }

    // Search filter
    if (search) {
      queryBuilder.andWhere(
        '(assignment.title ILIKE :search OR assignment.description ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [assignments, total] = await queryBuilder
      .orderBy(`assignment.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      assignments: assignments.map(a => this.formatAssignmentResponse(a)),
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async findOne(id: string, userId: string) {
    const assignment = await this.assignmentRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin', 'author'],
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Check access
    const hasAccess = await this.checkRoomAccess(userId, assignment.room.id);
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this assignment');
    }

    return this.formatAssignmentResponse(assignment);
  }

  async update(id: string, updateAssignmentDto: UpdateAssignmentDto, userId: string) {
    const assignment = await this.assignmentRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin', 'author'],
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Only room admin can update
    if (assignment.room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can update assignments');
    }

    Object.assign(assignment, {
      ...updateAssignmentDto,
      startAt: updateAssignmentDto.startAt ? new Date(updateAssignmentDto.startAt) : assignment.startAt,
      endAt: updateAssignmentDto.endAt ? new Date(updateAssignmentDto.endAt) : assignment.endAt,
    });

    const updated = await this.assignmentRepository.save(assignment);
    return this.formatAssignmentResponse(updated);
  }

  async remove(id: string, userId: string) {
    const assignment = await this.assignmentRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin'],
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Only room admin can delete
    if (assignment.room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can delete assignments');
    }

    await this.assignmentRepository.remove(assignment);
    return { message: 'Assignment deleted successfully' };
  }

  async submitAttempt(submitAttemptDto: SubmitAttemptDto, userId: string) {
    const assignment = await this.assignmentRepository.findOne({
      where: { id: submitAttemptDto.assignmentId },
      relations: ['room'],
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Check if user is a member
    const hasAccess = await this.checkRoomAccess(userId, assignment.room.id);
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this assignment');
    }

    // Check if submission is allowed
    if (assignment.endAt && new Date() > assignment.endAt && !assignment.isTurnInLateEnabled) {
      throw new BadRequestException('Assignment submission deadline has passed');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user already submitted
    const existingAttempt = await this.attemptRepository.findOne({
      where: {
        assignment: { id: assignment.id },
        user: { id: userId },
      },
    });

    if (existingAttempt) {
      throw new BadRequestException('You have already submitted this assignment');
    }

    const attempt = this.attemptRepository.create({
      fileUrl: submitAttemptDto.fileUrl,
      submitAt: new Date(),
    });
    attempt.assignment = assignment;
    attempt.user = user;

    const saved = await this.attemptRepository.save(attempt);
    return this.formatAttemptResponse(saved);
  }

  async getAttempts(assignmentId: string, userId: string) {
    const assignment = await this.assignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['room', 'room.admin'],
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Only room admin can view all attempts
    if (assignment.room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can view all attempts');
    }

    const attempts = await this.attemptRepository.find({
      where: { assignment: { id: assignmentId } },
      relations: ['user', 'assignment'],
      order: { submitAt: 'DESC' },
    });

    return attempts.map(a => this.formatAttemptResponse(a));
  }

  async getMyAttempt(assignmentId: string, userId: string) {
    const assignment = await this.assignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['room'],
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Check access
    const hasAccess = await this.checkRoomAccess(userId, assignment.room.id);
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this assignment');
    }

    const attempt = await this.attemptRepository.findOne({
      where: {
        assignment: { id: assignmentId },
        user: { id: userId },
      },
      relations: ['user', 'assignment'],
    });

    if (!attempt) {
      return null;
    }

    return this.formatAttemptResponse(attempt);
  }

  async scoreAttempt(attemptId: string, score: number, userId: string) {
    const attempt = await this.attemptRepository.findOne({
      where: { id: attemptId },
      relations: ['assignment', 'assignment.room', 'assignment.room.admin', 'user'],
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }

    // Only room admin can score
    if (attempt.assignment.room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can score attempts');
    }

    attempt.score = score;
    const updated = await this.attemptRepository.save(attempt);
    return this.formatAttemptResponse(updated);
  }

  private async checkRoomAccess(userId: string, roomId: string): Promise<boolean> {
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) return false;

    // Admin has access
    if (room.admin.id === userId) return true;

    // Check if user is a member
    const member = await this.roomMemberRepository.findOne({
      where: {
        room: { id: roomId },
        user: { id: userId },
      },
    });

    return !!member;
  }

  private formatAssignmentResponse(assignment: Assignment) {
    return {
      id: assignment.id,
      title: assignment.title,
      description: assignment.description,
      assignmentUrl: assignment.assignmentUrl,
      startAt: assignment.startAt,
      endAt: assignment.endAt,
      isTurnInLateEnabled: assignment.isTurnInLateEnabled,
      createdAt: assignment.createdAt,
      room: assignment.room ? {
        id: assignment.room.id,
        title: assignment.room.title,
      } : null,
      author: assignment.author ? {
        id: assignment.author.id,
        firstName: assignment.author.firstName,
        lastName: assignment.author.lastName,
        email: assignment.author.email,
        image: assignment.author.image,
      } : null,
    };
  }

  private formatAttemptResponse(attempt: AssignmentAttempt) {
    return {
      id: attempt.id,
      fileUrl: attempt.fileUrl,
      submitAt: attempt.submitAt,
      score: attempt.score,
      user: attempt.user ? {
        id: attempt.user.id,
        firstName: attempt.user.firstName,
        lastName: attempt.user.lastName,
        email: attempt.user.email,
        image: attempt.user.image,
      } : null,
      assignment: attempt.assignment ? {
        id: attempt.assignment.id,
        title: attempt.assignment.title,
      } : null,
    };
  }
}
