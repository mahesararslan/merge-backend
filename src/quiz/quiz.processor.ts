import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { NotificationService } from '../notification/notification.service';

@Processor('quizzes')
@Injectable()
export class QuizProcessor {
  private readonly logger = new Logger(QuizProcessor.name);

  constructor(
    private readonly quizService: QuizService,
    private readonly notificationService: NotificationService,
  ) {}

  @Process('notify-24hr-before-due')
  async handleNotify24hrBeforeDue(job: Job) {
    const { quizId } = job.data;
    this.logger.log(`Processing 24hr-before-due notification for quiz: ${quizId}`);
    try {
      await this.notificationService.sendQuizDueSoonNotification(quizId);
      this.logger.log(`Sent 24hr-before-due notification for quiz ${quizId}`);
    } catch (error) {
      this.logger.error(`Failed to send 24hr-before-due notification for quiz ${quizId}: ${error.message}`);
    }
  }
}
