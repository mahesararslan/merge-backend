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

    // Create questions
    const questions = createQuizDto.questions.map(q => {
      const question = this.questionRepository.create({
        text: q.text,
        options: q.options,
        correctOption: q.correctOption,
        points: q.points,
      });
      question.quiz = savedQuiz;
      return question;
    });

    await this.questionRepository.save(questions);

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
      // Delete old questions
      await this.questionRepository.delete({ quiz: { id } });

      // Create new questions
      const questions = updateQuizDto.questions.map(q => {
        const question = this.questionRepository.create({
          text: q.text,
          options: q.options,
          correctOption: q.correctOption,
          points: q.points,
        });
        question.quiz = quiz;
        return question;
      });

      await this.questionRepository.save(questions);
    }

    return this.findOne(id, userId);
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

    const percentageScore = totalPoints > 0 ? (score / totalPoints) * 100 : 0;

    const attempt = this.attemptRepository.create({
      quiz,
      user,
      answers: submitAttemptDto.answers,
      score: percentageScore,
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
      relations: ['room'],
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

    return this.formatAttemptResponse(attempt);
  }

  private formatQuizResponse(quiz: Quiz, includeCorrectAnswers: boolean = false) {
    return {
      id: quiz.id,
      title: quiz.title,
      timeLimitMin: quiz.timeLimitMin,
      deadline: quiz.deadline,
      createdAt: quiz.createdAt,
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
      } : null,
    };
  }
}
