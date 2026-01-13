import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentAttempt } from '../entities/assignment-attempt.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { RoomMember } from '../entities/room-member.entity';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { QueryAssignmentDto } from './dto/query-assignment.dto';
import { QueryInstructorAssignmentDto } from './dto/query-instructor-assignment.dto';
import { QueryStudentAssignmentDto } from './dto/query-student-assignment.dto';
import { QueryAttemptsDto } from './dto/query-attempts.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { UpdateAttemptDto } from './dto/update-attempt.dto';
import { BulkScoreAttemptsDto } from './dto/bulk-score-attempts.dto';
import { SubmissionStatus } from './enums/assignment-submission-status.enum';
import { InstructorAssignmentStatus } from './enums/instructor-assignment-status.enum';

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

    // Filter by room
    queryBuilder.andWhere('assignment.room.id = :roomId', { roomId });

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

  async findAllForInstructor(queryDto: QueryInstructorAssignmentDto, userId: string) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'DESC', search, roomId, filter = 'all' } = queryDto;
    const skip = (page - 1) * limit;

    let queryBuilder = this.assignmentRepository
      .createQueryBuilder('assignment')
      .leftJoinAndSelect('assignment.room', 'room')
      .leftJoinAndSelect('assignment.author', 'author')
      .leftJoinAndSelect('room.admin', 'admin')
      .where('assignment.room.id = :roomId', { roomId });

    // Search filter
    if (search) {
      queryBuilder.andWhere(
        '(assignment.title ILIKE :search OR assignment.description ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Apply instructor-specific filters
    if (filter === 'needs_grading') {
      // Assignments that have at least one attempt without a score
      queryBuilder.andWhere(qb => {
        const subQuery = qb
          .subQuery()
          .select('1')
          .from('assignment_attempts', 'attempt')
          .where('attempt.assignmentId = assignment.id')
          .andWhere('attempt.score IS NULL')
          .getQuery();
        return `EXISTS ${subQuery}`;
      });
    } else if (filter === 'graded') {
      // Assignments where all attempts have been scored (and has at least one attempt)
      queryBuilder.andWhere(qb => {
        const hasAttemptsSubQuery = qb
          .subQuery()
          .select('1')
          .from('assignment_attempts', 'attempt')
          .where('attempt.assignmentId = assignment.id')
          .getQuery();
        return `EXISTS ${hasAttemptsSubQuery}`;
      });
      queryBuilder.andWhere(qb => {
        const ungradedSubQuery = qb
          .subQuery()
          .select('1')
          .from('assignment_attempts', 'attempt')
          .where('attempt.assignmentId = assignment.id')
          .andWhere('attempt.score IS NULL')
          .getQuery();
        return `NOT EXISTS ${ungradedSubQuery}`;
      });
    } else if (filter === 'closed') {
      queryBuilder.andWhere('assignment.isClosed = :isClosed', { isClosed: true });
    }

    const [assignments, total] = await queryBuilder
      .orderBy(`assignment.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    // Get attempt counts for each assignment
    const assignmentsWithStats = await Promise.all(
      assignments.map(async (assignment) => {
        const totalAttempts = await this.attemptRepository.count({
          where: { assignment: { id: assignment.id } },
        });
        const gradedAttempts = await this.attemptRepository.count({
          where: { assignment: { id: assignment.id }, score: Not(IsNull()) },
        });
        
        // Determine assignment status for instructor
        let status: InstructorAssignmentStatus;
        if (assignment.isClosed) {
          status = InstructorAssignmentStatus.CLOSED;
        } else if (totalAttempts > 0 && totalAttempts > gradedAttempts) {
          status = InstructorAssignmentStatus.NEEDS_GRADING;
        } else {
          status = InstructorAssignmentStatus.GRADED;
        }

        return {
          ...this.formatAssignmentResponse(assignment),
          status,
          totalAttempts,
          gradedAttempts,
          ungradedAttempts: totalAttempts - gradedAttempts,
        };
      })
    );

    return {
      assignments: assignmentsWithStats,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async findAllForStudent(queryDto: QueryStudentAssignmentDto, userId: string) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'DESC', search, roomId, filter = 'all' } = queryDto;
    const skip = (page - 1) * limit;
    const now = new Date();

    let queryBuilder = this.assignmentRepository
      .createQueryBuilder('assignment')
      .leftJoinAndSelect('assignment.room', 'room')
      .leftJoinAndSelect('assignment.author', 'author')
      .leftJoinAndSelect('room.admin', 'admin')
      .where('assignment.room.id = :roomId', { roomId });

    // Search filter
    if (search) {
      queryBuilder.andWhere(
        '(assignment.title ILIKE :search OR assignment.description ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Apply student-specific filters
    if (filter === 'completed') {
      // Assignments the student has submitted
      queryBuilder.andWhere(qb => {
        const subQuery = qb
          .subQuery()
          .select('1')
          .from('assignment_attempts', 'attempt')
          .where('attempt.assignmentId = assignment.id')
          .andWhere('attempt.userId = :userId', { userId })
          .getQuery();
        return `EXISTS ${subQuery}`;
      });
    } else if (filter === 'pending') {
      // Assignments not submitted and (no deadline OR deadline not passed OR late submission allowed)
      queryBuilder.andWhere(qb => {
        const subQuery = qb
          .subQuery()
          .select('1')
          .from('assignment_attempts', 'attempt')
          .where('attempt.assignmentId = assignment.id')
          .andWhere('attempt.userId = :userId', { userId })
          .getQuery();
        return `NOT EXISTS ${subQuery}`;
      });
      queryBuilder.andWhere(
        '(assignment.endAt IS NULL OR assignment.endAt > :now OR assignment.isTurnInLateEnabled = true)',
        { now }
      );
    } else if (filter === 'missed') {
      // Assignments not submitted and (deadline passed and late submission not allowed OR assignment is closed)
      queryBuilder.andWhere(qb => {
        const subQuery = qb
          .subQuery()
          .select('1')
          .from('assignment_attempts', 'attempt')
          .where('attempt.assignmentId = assignment.id')
          .andWhere('attempt.userId = :userId', { userId })
          .getQuery();
        return `NOT EXISTS ${subQuery}`;
      });
      queryBuilder.andWhere(
        '(assignment.isClosed = true OR (assignment.endAt IS NOT NULL AND assignment.endAt <= :now AND assignment.isTurnInLateEnabled = false))',
        { now }
      );
    }

    const [assignments, total] = await queryBuilder
      .orderBy(`assignment.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    // Get submission status for each assignment
    const assignmentsWithStatus = await Promise.all(
      assignments.map(async (assignment) => {
        const attempt = await this.attemptRepository.findOne({
          where: { assignment: { id: assignment.id }, user: { id: userId } },
        });
        
        let status: SubmissionStatus;
        if (attempt) {
          status = attempt.score !== null ? SubmissionStatus.GRADED : SubmissionStatus.SUBMITTED;
        } else if (assignment.isClosed || (assignment.endAt && new Date(assignment.endAt) < now && !assignment.isTurnInLateEnabled)) {
          status = SubmissionStatus.MISSED;
        } else {
          status = SubmissionStatus.PENDING;
        }

        return {
          ...this.formatAssignmentResponse(assignment),
          submissionStatus: status,
          submittedAt: attempt?.submitAt || null,
          score: attempt?.score || null,
          attempt: attempt ? {
            id: attempt.id,
            submitAt: attempt.submitAt,
            score: attempt.score,
            files: attempt.files,
          } : null,
        };
      })
    );

    return {
      assignments: assignmentsWithStatus,
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

  async findOneForStudent(id: string, userId: string) {
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

    const now = new Date();
    const attempt = await this.attemptRepository.findOne({
      where: { assignment: { id: assignment.id }, user: { id: userId } },
      relations: ['user'],
    });

    // Determine assignmentStatus
    let assignmentStatus: SubmissionStatus;
    if (attempt) {
      assignmentStatus = attempt.score !== null ? SubmissionStatus.GRADED : SubmissionStatus.SUBMITTED;
    } else if (assignment.isClosed || (assignment.endAt && new Date(assignment.endAt) < now && !assignment.isTurnInLateEnabled)) {
      assignmentStatus = SubmissionStatus.MISSED;
    } else {
      assignmentStatus = SubmissionStatus.PENDING;
    }

    return {
      ...this.formatAssignmentResponse(assignment),
      submissionStatus: assignmentStatus,
      attempt: attempt ? {
        id: attempt.id,
        submitAt: attempt.submitAt,
        score: attempt.score,
        files: attempt.files,
        note: attempt.note,
      } : null,
    };
  }

  async findOneForInstructor(id: string, queryDto: QueryAttemptsDto, userId: string) {
    const { page = 1, limit = 20, sortBy = 'submitAt', sortOrder = 'DESC', filter = 'all' } = queryDto;
    const skip = (page - 1) * limit;

    const assignment = await this.assignmentRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin', 'author'],
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Only room admin can access instructor view
    if (assignment.room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can access this view');
    }

    // Build query for attempts with pagination
    let queryBuilder = this.attemptRepository
      .createQueryBuilder('attempt')
      .leftJoinAndSelect('attempt.user', 'user')
      .where('attempt.assignment.id = :assignmentId', { assignmentId: id });

    // Apply filter
    if (filter === 'graded') {
      queryBuilder.andWhere('attempt.score IS NOT NULL');
    } else if (filter === 'ungraded') {
      queryBuilder.andWhere('attempt.score IS NULL');
    }

    const [attempts, total] = await queryBuilder
      .orderBy(`attempt.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    // Get stats
    const totalAttempts = await this.attemptRepository.count({
      where: { assignment: { id: assignment.id } },
    });
    const gradedAttempts = await this.attemptRepository.count({
      where: { assignment: { id: assignment.id }, score: Not(IsNull()) },
    });

    // Determine assignment status
    let status: InstructorAssignmentStatus;
    if (assignment.isClosed) {
      status = InstructorAssignmentStatus.CLOSED;
    } else if (totalAttempts > 0 && totalAttempts > gradedAttempts) {
      status = InstructorAssignmentStatus.NEEDS_GRADING;
    } else {
      status = InstructorAssignmentStatus.GRADED;
    }

    return {
      ...this.formatAssignmentResponse(assignment),
      status,
      totalAttempts,
      gradedAttempts,
      ungradedAttempts: totalAttempts - gradedAttempts,
      attempts: {
        data: attempts.map(a => ({
          id: a.id,
          submitAt: a.submitAt,
          score: a.score,
          files: a.files,
          note: a.note,
          user: a.user ? {
            id: a.user.id,
            firstName: a.user.firstName,
            lastName: a.user.lastName,
            email: a.user.email,
            image: a.user.image,
          } : null,
        })),
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      },
    };
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

    // Check if assignment is closed
    if (assignment.isClosed) {
      throw new BadRequestException('This assignment has been closed by the instructor');
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
      files: submitAttemptDto.files,
      note: submitAttemptDto.note || null,
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

  async updateAttempt(attemptId: string, updateAttemptDto: UpdateAttemptDto, userId: string) {
    const attempt = await this.attemptRepository.findOne({
      where: { id: attemptId },
      relations: ['user', 'assignment', 'assignment.room'],
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }

    // Only the user who submitted can edit their attempt
    if (attempt.user.id !== userId) {
      throw new ForbiddenException('You can only edit your own submission');
    }

    // Cannot edit if already scored
    if (attempt.score !== null) {
      throw new BadRequestException('Cannot edit a submission that has already been scored');
    }

    // Check if editing is still allowed (before deadline or late submission enabled)
    const assignment = attempt.assignment;
    if (assignment.endAt && new Date() > assignment.endAt && !assignment.isTurnInLateEnabled) {
      throw new BadRequestException('Assignment submission deadline has passed');
    }

    // Update fields if provided
    if (updateAttemptDto.files) {
      attempt.files = updateAttemptDto.files;
    }
    if (updateAttemptDto.note !== undefined) {
      attempt.note = updateAttemptDto.note || null;
    }

    const saved = await this.attemptRepository.save(attempt);
    return this.formatAttemptResponse(saved);
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

  async bulkScoreAttempts(bulkScoreAttemptsDto: BulkScoreAttemptsDto, userId: string) {
    const { roomId, attempts } = bulkScoreAttemptsDto;

    // Verify room access
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // Only room admin can score
    if (room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can score attempts');
    }

    const results: any[] = [];
    const errors: { attemptId: string; error: string }[] = [];

    for (const attemptScore of attempts) {
      try {
        const attempt = await this.attemptRepository.findOne({
          where: { id: attemptScore.attemptId },
          relations: ['assignment', 'assignment.room', 'user'],
        });

        if (!attempt) {
          errors.push({
            attemptId: attemptScore.attemptId,
            error: 'Attempt not found',
          });
          continue;
        }

        // Verify the attempt belongs to an assignment in this room
        if (attempt.assignment.room.id !== roomId) {
          errors.push({
            attemptId: attemptScore.attemptId,
            error: 'Attempt does not belong to this room',
          });
          continue;
        }

        attempt.score = attemptScore.score;
        const updated = await this.attemptRepository.save(attempt);
        results.push(this.formatAttemptResponse(updated));
      } catch (error) {
        errors.push({
          attemptId: attemptScore.attemptId,
          error: error.message,
        });
      }
    }

    return {
      success: results.length,
      failed: errors.length,
      results,
      errors,
    };
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
      assignmentFiles: assignment.assignmentFiles,
      totalScore: assignment.totalScore,
      startAt: assignment.startAt,
      endAt: assignment.endAt,
      isTurnInLateEnabled: assignment.isTurnInLateEnabled,
      isClosed: assignment.isClosed,
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
      files: attempt.files,
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
