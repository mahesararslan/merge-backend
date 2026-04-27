import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, In } from 'typeorm';
import axios from 'axios';
import Redis from 'ioredis';
import { LiveQnaQuestion, LiveQnaQuestionStatus } from '../entities/live-qna-question.entity';
import { LiveQnaVote } from '../entities/live-qna-vote.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { LiveSession } from '../entities/live-video-session.entity';
import { CreateLiveQnaQuestionDto } from './dto/create-live-qna-question.dto';

export interface LiveQnaQuestionResponse {
  id: string;
  roomId: string;
  sessionId: string;
  content: string;
  status: LiveQnaQuestionStatus;
  votesCount: number;
  viewerHasVoted: boolean;
  isMine: boolean;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    image?: string | null;
  };
  answeredBy?: {
    id: string;
    firstName: string;
    lastName: string;
    image?: string | null;
  } | null;
  answeredAt?: Date | null;
  aiAnswer?: string | null;
  aiAnswerSources?: string[] | null;
  aiAnsweredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class LiveQnaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveQnaService.name);
  private redis: Redis;

  constructor(
    @InjectRepository(LiveQnaQuestion)
    private readonly questionRepository: Repository<LiveQnaQuestion>,
    @InjectRepository(LiveQnaVote)
    private readonly voteRepository: Repository<LiveQnaVote>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
    @InjectRepository(LiveSession)
    private readonly sessionRepository: Repository<LiveSession>,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const url = this.configService.get<string>('REDIS_URL');
    
    // Base options for Upstash stability
    const baseOptions: any = {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      keepAlive: 30000, // 30s keep-alive
      family: 4,        // Force IPv4 for cloud stability
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
    };

    if (url) {
      // For Upstash/Render, ensure TLS is enabled for rediss://
      if (url.startsWith('rediss://')) {
        baseOptions.tls = { rejectUnauthorized: false };
      }
      this.redis = new Redis(url, baseOptions);
    } else {
      const host = this.configService.get<string>('REDIS_HOST', 'localhost');
      const port = this.configService.get<number>('REDIS_PORT', 6379);
      const password = this.configService.get<string>('REDIS_PASSWORD', '');

      this.redis = new Redis({
        host,
        port,
        ...(password && { password }),
        ...baseOptions,
      });
    }

    this.redis.on('ready', () => this.logger.log('LiveQna Redis connected'));
    this.redis.on('error', (err) => {
      // Ignore 'max retries' logs if they still appear during rapid reconnection
      if (err.message?.includes('max retries')) return;
      this.logger.error('LiveQna Redis error', err.message);
    });
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }

  async listQuestions(
    roomId: string,
    sessionId: string,
    viewerId: string,
  ): Promise<LiveQnaQuestionResponse[]> {
    await this.ensureSession(roomId, sessionId);

    const questions = await this.questionRepository.find({
      where: {
        room: { id: roomId },
        session: { id: sessionId },
      },
      relations: ['author', 'answeredBy'],
      order: {
        votesCount: 'DESC',
        createdAt: 'ASC',
      },
    });

    if (!questions.length) {
      return [];
    }

    const ids = questions.map((q) => q.id);
    const viewerVotes = await this.voteRepository.find({
      where: {
        question: { id: In(ids) },
        user: { id: viewerId },
      },
      relations: ['question'],
    });
    const votedIds = new Set(viewerVotes.map((vote) => vote.questionId));

    return questions.map((question) =>
      this.toResponse(question, viewerId, votedIds.has(question.id)),
    );
  }

  async createQuestion(
    roomId: string,
    sessionId: string,
    dto: CreateLiveQnaQuestionDto,
    authorId: string,
  ): Promise<LiveQnaQuestionResponse> {
    const [session, author] = await Promise.all([
      this.sessionRepository.findOne({
        where: { id: sessionId },
        relations: ['room'],
      }),
      this.userRepository.findOne({ where: { id: authorId } }),
    ]);

    if (!session || session.room?.id !== roomId) {
      throw new NotFoundException('Live session not found');
    }

    if (!author) {
      throw new NotFoundException('User not found');
    }

    const question = this.questionRepository.create({
      content: dto.content.trim(),
      author,
      room: session.room,
      session,
    });

    const saved = await this.questionRepository.save(question);
    const questionWithRelations = await this.loadQuestionOrFail(
      saved.id,
      roomId,
      sessionId,
    );

    return this.toResponse(questionWithRelations, authorId, false);
  }

  async voteQuestion(
    roomId: string,
    sessionId: string,
    questionId: string,
    userId: string,
  ): Promise<LiveQnaQuestionResponse> {
    const question = await this.loadQuestionOrFail(
      questionId,
      roomId,
      sessionId,
    );

    const alreadyVoted = await this.voteRepository.findOne({
      where: {
        question: { id: question.id },
        user: { id: userId },
      },
    });

    if (alreadyVoted) {
      return this.toResponse(question, userId, true);
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const vote = this.voteRepository.create({ question, user });
    await this.voteRepository.save(vote);
    await this.questionRepository.increment(
      { id: question.id },
      'votesCount',
      1,
    );

    const updated = await this.loadQuestionOrFail(question.id, roomId, sessionId);
    return this.toResponse(updated, userId, true);
  }

  async unvoteQuestion(
    roomId: string,
    sessionId: string,
    questionId: string,
    userId: string,
  ): Promise<LiveQnaQuestionResponse> {
    const question = await this.loadQuestionOrFail(
      questionId,
      roomId,
      sessionId,
    );

    const vote = await this.voteRepository.findOne({
      where: {
        question: { id: question.id },
        user: { id: userId },
      },
    });

    if (!vote) {
      return this.toResponse(question, userId, false);
    }

    await this.voteRepository.remove(vote);
    await this.questionRepository.decrement(
      { id: question.id },
      'votesCount',
      1,
    );

    const updated = await this.loadQuestionOrFail(question.id, roomId, sessionId);
    return this.toResponse(updated, userId, false);
  }

  async updateStatus(
    roomId: string,
    sessionId: string,
    questionId: string,
    status: LiveQnaQuestionStatus,
    actorId: string,
  ): Promise<LiveQnaQuestionResponse> {
    const question = await this.loadQuestionOrFail(
      questionId,
      roomId,
      sessionId,
    );

    if (question.status === status) {
      return this.toResponse(
        question,
        actorId,
        await this.userHasVoted(questionId, actorId),
      );
    }

    if (status === LiveQnaQuestionStatus.ANSWERED) {
      const actor = await this.userRepository.findOne({ where: { id: actorId } });
      if (!actor) {
        throw new NotFoundException('User not found');
      }
      question.status = LiveQnaQuestionStatus.ANSWERED;
      question.answeredBy = actor;
      question.answeredAt = new Date();
    } else if (status === LiveQnaQuestionStatus.OPEN) {
      question.status = LiveQnaQuestionStatus.OPEN;
      question.answeredBy = null;
      question.answeredAt = null;
    } else {
      throw new BadRequestException('Invalid status');
    }

    const saved = await this.questionRepository.save(question);
    return this.toResponse(
      saved,
      actorId,
      await this.userHasVoted(questionId, actorId),
    );
  }

  async askAiBot(
    roomId: string,
    sessionId: string,
    questionId: string,
    adminUserId: string,
  ): Promise<LiveQnaQuestionResponse> {
    const question = await this.loadQuestionOrFail(questionId, roomId, sessionId);

    // Gate: Q&A bot answers require the room admin (host) to be on Instructor Pro
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });
    if (!room) throw new NotFoundException('Room not found');
    const { getPlanLimits } = await import('../subscription/plan-limits.const');
    if (!getPlanLimits(room.admin.subscriptionTier).hasQaBot) {
      throw new ForbiddenException(
        'AI bot answers in Live Q&A require the room instructor to be on Instructor Pro plan.',
      );
    }

    const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8001');
    const aiServiceApiKey = this.configService.get<string>('AI_SERVICE_API_KEY', '');

    let answer = '';
    let sources: string[] = [];

    try {
      const response = await axios.post(
        `${aiServiceUrl}/query`,
        { query: question.content, user_id: adminUserId, room_ids: [roomId] },
        {
          headers: { 'Content-Type': 'application/json', 'X-API-Key': aiServiceApiKey },
          timeout: 60000,
        },
      );
      answer = response.data?.answer ?? '';
      sources = (response.data?.sources ?? [])
        .map((s: any) => s.section_title)
        .filter(Boolean);
    } catch (err: any) {
      this.logger.error(`askAiBot: FastAPI call failed — ${err?.message}`);
      throw new BadRequestException('AI service failed to generate an answer');
    }

    question.aiAnswer = answer;
    question.aiAnswerSources = sources;
    question.aiAnsweredAt = new Date();
    const saved = await this.questionRepository.save(question);

    const hasVoted = await this.userHasVoted(questionId, adminUserId);
    const responseObj = this.toResponse(saved, adminUserId, hasVoted);

    try {
      await this.redis.publish(
        'live-qna',
        JSON.stringify({ type: 'question-updated', roomId, sessionId, data: responseObj }),
      );
    } catch (err: any) {
      this.logger.error(`askAiBot: Redis publish failed — ${err?.message}`);
    }

    return responseObj;
  }

  async removeQuestion(
    roomId: string,
    sessionId: string,
    questionId: string,
  ): Promise<{ id: string }>
  {
    const question = await this.loadQuestionOrFail(
      questionId,
      roomId,
      sessionId,
    );

    await this.questionRepository.remove(question);
    return { id: questionId };
  }

  private async ensureSession(roomId: string, sessionId: string) {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['room'],
    });

    if (!session || session.room?.id !== roomId) {
      throw new NotFoundException('Live session not found');
    }

    return session;
  }

  private async loadQuestionOrFail(
    questionId: string,
    roomId: string,
    sessionId: string,
  ) {
    const question = await this.questionRepository.findOne({
      where: {
        id: questionId,
        room: { id: roomId },
        session: { id: sessionId },
      },
      relations: ['author', 'answeredBy', 'room', 'session'],
    });

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    return question;
  }

  private async userHasVoted(questionId: string, userId: string) {
    if (!userId) return false;
    return this.voteRepository.exist({
      where: {
        question: { id: questionId },
        user: { id: userId },
      },
    });
  }

  private toResponse(
    question: LiveQnaQuestion,
    viewerId: string,
    viewerHasVoted: boolean,
  ): LiveQnaQuestionResponse {
    return {
      id: question.id,
      roomId: question.roomId,
      sessionId: question.sessionId,
      content: question.content,
      status: question.status,
      votesCount: Math.max(0, question.votesCount ?? 0),
      viewerHasVoted,
      isMine: question.authorId === viewerId,
      author: question.author
        ? {
            id: question.author.id,
            firstName: question.author.firstName,
            lastName: question.author.lastName,
            image: question.author.image,
          }
        : {
            id: question.authorId,
            firstName: '',
            lastName: '',
          },
      answeredBy: question.answeredBy
        ? {
            id: question.answeredBy.id,
            firstName: question.answeredBy.firstName,
            lastName: question.answeredBy.lastName,
            image: question.answeredBy.image,
          }
        : null,
      answeredAt: question.answeredAt ?? null,
      aiAnswer: question.aiAnswer ?? null,
      aiAnswerSources: question.aiAnswerSources ?? null,
      aiAnsweredAt: question.aiAnsweredAt ?? null,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
    };
  }
}
