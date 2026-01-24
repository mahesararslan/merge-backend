import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { NotificationService } from '../notification/notification.service';

@Processor('assignments')
@Injectable()
export class AssignmentProcessor {
  private readonly logger = new Logger(AssignmentProcessor.name);

  constructor(
    @InjectRepository(Assignment)
    private assignmentRepository: Repository<Assignment>,
    private notificationService: NotificationService,
  ) {
    this.logger.log('AssignmentProcessor initialized and ready to process jobs');
  }

  @Process('publish-scheduled')
  async handleScheduledPublish(job: Job) {
    const { assignmentId } = job.data;
    this.logger.log(`Processing scheduled assignment: ${assignmentId}`);

    try {
      const assignment = await this.assignmentRepository.findOne({
        where: { id: assignmentId },
        relations: ['room', 'room.admin', 'author'],
      });

      if (!assignment) {
        this.logger.error(`Assignment ${assignmentId} not found`);
        return;
      }

      if (assignment.isPublished) {
        this.logger.warn(`Assignment ${assignmentId} already published`);
        return;
      }

      // Update assignment to published
      assignment.isPublished = true;
      await this.assignmentRepository.save(assignment);

      // Create notifications and send FCM
      await this.notificationService.createAssignmentNotifications(assignment);

      this.logger.log(`Successfully published assignment: ${assignmentId}`);
    } catch (error) {
      this.logger.error(`Error processing scheduled assignment: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Process('notify-24hr-before-due')
  async handleNotify24hrBeforeDue(job: Job) {
    const { assignmentId } = job.data;
    this.logger.log(`Processing 24hr-before-due notification for assignment: ${assignmentId}`);
    try {
      const assignment = await this.assignmentRepository.findOne({
        where: { id: assignmentId },
        relations: ['room', 'room.admin', 'author'],
      });
      if (!assignment) {
        this.logger.error(`Assignment ${assignmentId} not found`);
        return;
      }
      await this.notificationService.sendAssignmentDueSoonNotification(assignmentId);
      this.logger.log(`Sent 24hr-before-due notification for assignment: ${assignmentId}`);
    } catch (error) {
      this.logger.error(`Error processing scheduled assignment: ${error.message}`, error.stack);
      throw error;
    }
  }
}
