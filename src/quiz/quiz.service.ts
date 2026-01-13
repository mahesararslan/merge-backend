import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quiz } from '../entities/quiz.entity';
import { QuizQuestion } from '../entities/quiz-question.entity';
import { QuizAttempt } from '../entities/quiz-attempt.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { QueryQuizDto } from './dto/query-quiz.dto';
import { QueryStudentQuizDto } from './dto/query-student-quiz.dto';
import { QueryInstructorQuizDto } from './dto/query-instructor-quiz.dto';
import { QueryQuizAttemptsDto } from './dto/query-quiz-attempts.dto';
import { QuizSubmissionStatus } from './enums/quiz-submission-status.enum';
import { InstructorQuizStatus } from './enums/instructor-quiz-status.enum';

@Injectable()
export class QuizService {
  constructor(
    @InjectRepository(Quiz)
    private quizRepository: Repository<Quiz>,
    @InjectRepository(QuizQuestion)
    private questionRepository: Repository<QuizQuestion>,
    @InjectRepository(QuizAttempt)
    private attemptRepository: Repository<QuizAttempt>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async create(createQuizDto: CreateQuizDto, userId: string) {
    const room = await this.roomRepository.findOne({
      where: { id: createQuizDto.roomId },
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

    const quiz = this.quizRepository.create({
      title: createQuizDto.title,
      timeLimitMin: createQuizDto.timeLimitMin,
      room,
      author: user,
    });

    if (createQuizDto.deadline) {
      quiz.deadline = new Date(createQuizDto.deadline);
    }

    const savedQuiz = await this.quizRepository.save(quiz);

    // Create questions - set the quiz relation object
    const questions: QuizQuestion[] = [];
    for (const q of createQuizDto.questions) {
      const question = this.questionRepository.create({
        text: q.text,
        options: q.options,
        correctOption: q.correctOption,
        points: q.points,
      });
      question.quiz = { id: savedQuiz.id } as Quiz;
      questions.push(question);
    }

    await this.questionRepository.save(questions);

    // Calculate and update total score
    const totalScore = questions.reduce((sum, q) => sum + q.points, 0);
    savedQuiz.totalScore = totalScore;
    await this.quizRepository.save(savedQuiz);

    return this.findOne(savedQuiz.id, userId);
  }

  async findAll(queryDto: QueryQuizDto, userId: string) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'DESC', search, roomId } = queryDto;
    const skip = (page - 1) * limit;

    let queryBuilder = this.quizRepository
      .createQueryBuilder('quiz')
      .leftJoinAndSelect('quiz.room', 'room')
      .leftJoinAndSelect('quiz.author', 'author')
      .leftJoinAndSelect('quiz.questions', 'questions')
      .where('quiz.room.id = :roomId', { roomId });

    if (search) {
      queryBuilder.andWhere('quiz.title ILIKE :search', { search: `%${search}%` });
    }

    const [quizzes, total] = await queryBuilder
      .orderBy(`quiz.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      quizzes: quizzes.map(q => this.formatQuizResponse(q, false)),
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async findAllForStudent(queryDto: QueryStudentQuizDto, userId: string) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'DESC', search, roomId, filter = 'all' } = queryDto;
    const skip = (page - 1) * limit;
    const now = new Date();

    let queryBuilder = this.quizRepository
      .createQueryBuilder('quiz')
      .leftJoinAndSelect('quiz.room', 'room')
      .leftJoinAndSelect('quiz.author', 'author')
      .leftJoinAndSelect('quiz.questions', 'questions')
      .where('quiz.room.id = :roomId', { roomId });

    if (search) {
      queryBuilder.andWhere('quiz.title ILIKE :search', { search: `%${search}%` });
    }

    // Apply student-specific filters
    if (filter === 'completed') {
      // Quizzes the student has submitted
      queryBuilder.andWhere(qb => {
        const subQuery = qb
          .subQuery()
          .select('1')
          .from('quiz_attempts', 'attempt')
          .where('attempt.quizId = quiz.id')
          .andWhere('attempt.userId = :userId', { userId })
          .getQuery();
        return `EXISTS ${subQuery}`;
      });
    } else if (filter === 'pending') {
      // Quizzes not submitted and (no deadline OR deadline not passed)
      queryBuilder.andWhere(qb => {
        const subQuery = qb
          .subQuery()
          .select('1')
          .from('quiz_attempts', 'attempt')
          .where('attempt.quizId = quiz.id')
          .andWhere('attempt.userId = :userId', { userId })
          .getQuery();
        return `NOT EXISTS ${subQuery}`;
      });
      queryBuilder.andWhere(
        '(quiz.deadline IS NULL OR quiz.deadline > :now)',
        { now }
      );
    } else if (filter === 'missed') {
      // Quizzes not submitted and (deadline passed OR quiz is closed)
      queryBuilder.andWhere(qb => {
        const subQuery = qb
          .subQuery()
          .select('1')
          .from('quiz_attempts', 'attempt')
          .where('attempt.quizId = quiz.id')
          .andWhere('attempt.userId = :userId', { userId })
          .getQuery();
        return `NOT EXISTS ${subQuery}`;
      });
      queryBuilder.andWhere(
        '(quiz.isClosed = true OR (quiz.deadline IS NOT NULL AND quiz.deadline <= :now))',
        { now }
      );
    }

    const [quizzes, total] = await queryBuilder
      .orderBy(`quiz.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    // Get submission status for each quiz
    const quizzesWithStatus = await Promise.all(
      quizzes.map(async (quiz) => {
        const attempt = await this.attemptRepository.findOne({
          where: { quiz: { id: quiz.id }, user: { id: userId } },
        });

        let status: QuizSubmissionStatus;
        if (attempt) {
          status = attempt.score !== null ? QuizSubmissionStatus.GRADED : QuizSubmissionStatus.SUBMITTED;
        } else if (quiz.isClosed || (quiz.deadline && new Date(quiz.deadline) < now)) {
          status = QuizSubmissionStatus.MISSED;
        } else {
          status = QuizSubmissionStatus.PENDING;
        }

        return {
          ...this.formatQuizResponse(quiz, false),
          submissionStatus: status,
          submittedAt: attempt?.submittedAt || null,
          score: attempt?.score || null,
          attempt: attempt ? {
            id: attempt.id,
            submittedAt: attempt.submittedAt,
            score: attempt.score,
          } : null,
        };
      })
    );

    return {
      quizzes: quizzesWithStatus,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async findAllForInstructor(queryDto: QueryInstructorQuizDto, userId: string) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'DESC', search, roomId, filter = 'all' } = queryDto;
    const skip = (page - 1) * limit;
    const now = new Date();

    let queryBuilder = this.quizRepository
      .createQueryBuilder('quiz')
      .leftJoinAndSelect('quiz.room', 'room')
      .leftJoinAndSelect('quiz.author', 'author')
      .leftJoinAndSelect('quiz.questions', 'questions')
      .where('quiz.room.id = :roomId', { roomId });

    if (search) {
      queryBuilder.andWhere('quiz.title ILIKE :search', { search: `%${search}%` });
    }

    // Apply instructor-specific filters
    if (filter === 'active') {
      // Quizzes with no deadline or deadline not yet passed
      queryBuilder.andWhere(
        '(quiz.deadline IS NULL OR quiz.deadline > :now)',
        { now }
      );
    } else if (filter === 'upcoming') {
      // Quizzes with deadline in the future (only those with deadlines)
      queryBuilder.andWhere('quiz.deadline IS NOT NULL');
      queryBuilder.andWhere('quiz.deadline > :now', { now });
    } else if (filter === 'ended') {
      // Quizzes with deadline passed
      queryBuilder.andWhere('quiz.deadline IS NOT NULL');
      queryBuilder.andWhere('quiz.deadline <= :now', { now });
    } else if (filter === 'open') {
      queryBuilder.andWhere('quiz.isClosed = :isClosed', { isClosed: false });
    } else if (filter === 'closed') {
      queryBuilder.andWhere('quiz.isClosed = :isClosed', { isClosed: true });
    }

    const [quizzes, total] = await queryBuilder
      .orderBy(`quiz.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    // Get attempt statistics for each quiz
    const quizzesWithStats = await Promise.all(
      quizzes.map(async (quiz) => {
        const totalAttempts = await this.attemptRepository.count({
          where: { quiz: { id: quiz.id } },
        });

        const attempts = await this.attemptRepository.find({
          where: { quiz: { id: quiz.id } },
          select: ['score'],
        });

        // Count graded attempts (those with a score)
        const gradedAttempts = attempts.filter(a => a.score !== null).length;
        const ungradedAttempts = totalAttempts - gradedAttempts;

        const averageScore = attempts.length > 0
          ? attempts.reduce((sum, a) => sum + (a.score || 0), 0) / attempts.length
          : null;

        // Determine assignment status for instructor
        let status: InstructorQuizStatus;
        if (quiz.isClosed) {
          status = InstructorQuizStatus.CLOSED;
        } else if (quiz.deadline && new Date(quiz.deadline) <= now) {
          status = InstructorQuizStatus.ENDED;
        } else if (totalAttempts > 0 && totalAttempts === gradedAttempts) {
          status = InstructorQuizStatus.ALL_GRADED;
        } else if (ungradedAttempts > 0) {
          status = InstructorQuizStatus.NEEDS_GRADING;
        } else {
          status = InstructorQuizStatus.OPEN;
        }

        return {
          ...this.formatQuizResponse(quiz, false),
          status,
          totalAttempts,
          gradedAttempts,
          ungradedAttempts,
          stats: {
            totalAttempts,
            averageScore: averageScore !== null ? Math.round(averageScore * 100) / 100 : null,
          },
        };
      })
    );

    return {
      quizzes: quizzesWithStats,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async findOne(id: string, userId: string) {
    const quiz = await this.quizRepository.findOne({
      where: { id },
      relations: ['room', 'author', 'questions'],
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    return this.formatQuizResponse(quiz, false);
  }

  async findOneForStudent(id: string, userId: string) {
    const quiz = await this.quizRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin', 'author', 'questions'],
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    const now = new Date();
    const attempt = await this.attemptRepository.findOne({
      where: { quiz: { id: quiz.id }, user: { id: userId } },
      relations: ['user'],
    });

    let submissionStatus: QuizSubmissionStatus;
    if (attempt) {
      submissionStatus = attempt.score !== null ? QuizSubmissionStatus.GRADED : QuizSubmissionStatus.SUBMITTED;
    } else if (quiz.isClosed || (quiz.deadline && new Date(quiz.deadline) < now)) {
      submissionStatus = QuizSubmissionStatus.MISSED;
    } else {
      submissionStatus = QuizSubmissionStatus.PENDING;
    }

    return {
      ...this.formatQuizResponse(quiz, false),
      submissionStatus,
      submittedAt: attempt?.submittedAt || null,
      score: attempt?.score || null,
      attempted: !!attempt,
      attempt: attempt ? {
        id: attempt.id,
        submittedAt: attempt.submittedAt,
        score: attempt.score,
        answers: attempt.answers,
      } : null,
    };
  }

  async findOneForInstructor(id: string, queryDto: QueryQuizAttemptsDto, userId: string) {
    const { page = 1, limit = 20, sortBy = 'submittedAt', sortOrder = 'DESC' } = queryDto;
    const skip = (page - 1) * limit;

    const quiz = await this.quizRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin', 'author', 'questions'],
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    // Only room admin can access instructor view
    if (quiz.room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can access this view');
    }

    // Get total attempts count
    const totalAttempts = await this.attemptRepository.count({
      where: { quiz: { id: quiz.id } },
    });

    // If no attempts, return quiz with null attempts
    if (totalAttempts === 0) {
      const now = new Date();
      let status: InstructorQuizStatus;
      if (quiz.isClosed) {
        status = InstructorQuizStatus.CLOSED;
      } else if (quiz.deadline && new Date(quiz.deadline) <= now) {
        status = InstructorQuizStatus.ENDED;
      } else {
        status = InstructorQuizStatus.OPEN;
      }

      return {
        ...this.formatQuizResponse(quiz, true),
        status,
        totalAttempts: 0,
        gradedAttempts: 0,
        ungradedAttempts: 0,
        averageScore: null,
        attempts: null,
      };
    }

    // Build query for attempts with pagination
    const [attempts, total] = await this.attemptRepository
      .createQueryBuilder('attempt')
      .leftJoinAndSelect('attempt.user', 'user')
      .where('attempt.quiz.id = :quizId', { quizId: id })
      .orderBy(`attempt.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    // Get stats
    const allAttempts = await this.attemptRepository.find({
      where: { quiz: { id: quiz.id } },
      select: ['score'],
    });

    const gradedAttempts = allAttempts.filter(a => a.score !== null).length;
    const ungradedAttempts = totalAttempts - gradedAttempts;
    const averageScore = allAttempts.length > 0
      ? allAttempts.reduce((sum, a) => sum + (a.score || 0), 0) / allAttempts.length
      : null;

    // Determine quiz status
    const now = new Date();
    let status: InstructorQuizStatus;
    if (quiz.isClosed) {
      status = InstructorQuizStatus.CLOSED;
    } else if (quiz.deadline && new Date(quiz.deadline) <= now) {
      status = InstructorQuizStatus.ENDED;
    } else if (totalAttempts > 0 && totalAttempts === gradedAttempts) {
      status = InstructorQuizStatus.ALL_GRADED;
    } else if (ungradedAttempts > 0) {
      status = InstructorQuizStatus.NEEDS_GRADING;
    } else {
      status = InstructorQuizStatus.OPEN;
    }

    return {
      ...this.formatQuizResponse(quiz, true),
      status,
      totalAttempts,
      gradedAttempts,
      ungradedAttempts,
      averageScore: averageScore !== null ? Math.round(averageScore * 100) / 100 : null,
      attempts: {
        data: attempts.map(a => ({
          id: a.id,
          submittedAt: a.submittedAt,
          score: a.score,
          answers: a.answers,
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

  async update(id: string, updateQuizDto: UpdateQuizDto, userId: string) {
    const quiz = await this.quizRepository.findOne({
      where: { id },
      relations: ['room', 'author', 'questions'],
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    // Update basic fields
    if (updateQuizDto.title !== undefined) {
      quiz.title = updateQuizDto.title;
    }
    if (updateQuizDto.timeLimitMin !== undefined) {
      quiz.timeLimitMin = updateQuizDto.timeLimitMin;
    }
    if (updateQuizDto.deadline !== undefined) {
      if (updateQuizDto.deadline) {
        quiz.deadline = new Date(updateQuizDto.deadline);
      } else {
        quiz.deadline = undefined as any;
      }
    }

    await this.quizRepository.save(quiz);

    // Update questions if provided
    if (updateQuizDto.questions) {
      // Delete all existing questions by their IDs
      const questionIds = quiz.questions.map(q => q.id);
      if (questionIds.length > 0) {
        await this.questionRepository.delete(questionIds);
        // console.log("Deleted questions with IDs:", questionIds);
      }

      // Create new questions - set the quiz relation object, not just quizId
      let totalScore = 0;
      for (const q of updateQuizDto.questions) {
        const question = this.questionRepository.create({
          text: q.text,
          options: q.options,
          correctOption: q.correctOption,
          points: q.points,
        });
        question.quiz = { id: quiz.id } as Quiz;  // Set relation with ID reference
        const savedQuestion = await this.questionRepository.save(question);
        // console.log('Saved question:', savedQuestion.id, 'with quizId:', savedQuestion.quizId);
        totalScore += q.points;
      }

      // Update total score using query builder to avoid cascade issues
      await this.quizRepository.update(id, { totalScore });
    }

    // Fetch fresh data from database
    const updatedQuiz = await this.quizRepository.findOne({
      where: { id },
      relations: ['room', 'author', 'questions'],
    });

    return this.formatQuizResponse(updatedQuiz!, false);
  }

  async remove(id: string, userId: string) {
    const quiz = await this.quizRepository.findOne({
      where: { id },
      relations: ['room', 'author'],
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    await this.quizRepository.remove(quiz);
    return { message: 'Quiz deleted successfully' };
  }

  async submitAttempt(submitAttemptDto: SubmitAttemptDto, userId: string) {
    const quiz = await this.quizRepository.findOne({
      where: { id: submitAttemptDto.quizId },
      relations: ['room', 'questions'],
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    // Check if quiz is closed
    if (quiz.isClosed) {
      throw new BadRequestException('This quiz has been closed by the instructor');
    }

    // Check deadline
    if (quiz.deadline && new Date() > quiz.deadline) {
      throw new BadRequestException('Quiz deadline has passed');
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
        quiz: { id: quiz.id },
        user: { id: userId },
      },
    });

    if (existingAttempt) {
      throw new BadRequestException('You have already submitted this quiz');
    }

    // Calculate score
    let score = 0;
    let totalPoints = 0;

    for (const question of quiz.questions) {
      totalPoints += question.points;
      const userAnswer = submitAttemptDto.answers[question.id];
      if (userAnswer === question.correctOption) {
        score += question.points;
      }
    }

    const attempt = this.attemptRepository.create({
      quiz,
      user,
      answers: submitAttemptDto.answers,
      score: score,
      submittedAt: new Date(),
    });

    const savedAttempt = await this.attemptRepository.save(attempt);
    return this.formatAttemptResponse(savedAttempt);
  }

  async getAttempts(quizId: string, userId: string) {
    const quiz = await this.quizRepository.findOne({
      where: { id: quizId },
      relations: ['room'],
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    const attempts = await this.attemptRepository.find({
      where: { quiz: { id: quizId } },
      relations: ['user', 'quiz'],
      order: { submittedAt: 'DESC' },
    });

    return attempts.map(a => this.formatAttemptResponse(a));
  }

  async getMyAttempt(quizId: string, userId: string) {
    const quiz = await this.quizRepository.findOne({
      where: { id: quizId },
      relations: ['room', 'questions'],
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    const attempt = await this.attemptRepository.findOne({
      where: {
        quiz: { id: quizId },
        user: { id: userId },
      },
      relations: ['user', 'quiz'],
    });

    if (!attempt) {
      return null;
    }

    // Include answer key (questions with correct answers)
    const answerKey = quiz.questions?.map(q => ({
      id: q.id,
      text: q.text,
      options: q.options,
      correctOption: q.correctOption,
      points: q.points,
    })) || [];

    return {
      ...this.formatAttemptResponse(attempt),
      answerKey,
    };
  }

  private formatQuizResponse(quiz: Quiz, includeCorrectAnswers: boolean = false) {
    return {
      id: quiz.id,
      title: quiz.title,
      timeLimitMin: quiz.timeLimitMin,
      deadline: quiz.deadline,
      createdAt: quiz.createdAt,
      isClosed: quiz.isClosed,
      room: quiz.room ? {
        id: quiz.room.id,
        title: quiz.room.title,
      } : null,
      author: quiz.author ? {
        id: quiz.author.id,
        firstName: quiz.author.firstName,
        lastName: quiz.author.lastName,
        email: quiz.author.email,
        image: quiz.author.image,
      } : null,
      questions: quiz.questions?.map(q => ({
        id: q.id,
        text: q.text,
        options: q.options,
        ...(includeCorrectAnswers && { correctOption: q.correctOption }),
        points: q.points,
      })) || [],
      totalQuestions: quiz.questions?.length || 0,
      totalPoints: quiz.questions?.reduce((sum, q) => sum + q.points, 0) || 0,
    };
  }

  private formatAttemptResponse(attempt: QuizAttempt) {
    return {
      id: attempt.id,
      submittedAt: attempt.submittedAt,
      answers: attempt.answers,
      score: attempt.score,
      user: attempt.user ? {
        id: attempt.user.id,
        firstName: attempt.user.firstName,
        lastName: attempt.user.lastName,
        email: attempt.user.email,
        image: attempt.user.image,
      } : null,
      quiz: attempt.quiz ? {
        id: attempt.quiz.id,
        title: attempt.quiz.title,
        totalScore: attempt.quiz.totalScore,
      } : null,
    };
  }
}
