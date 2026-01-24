import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Repository } from 'typeorm';
import { Queue } from 'bull';
import { CalendarEvent } from '../entities/calendar-event.entity';
import { User } from '../entities/user.entity';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';

@Injectable()
export class CalendarService {
	private readonly logger = new Logger(CalendarService.name);

	constructor(
		@InjectRepository(CalendarEvent)
		private calendarEventRepository: Repository<CalendarEvent>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectQueue('calendar')
		private calendarQueue: Queue,
	) {}

	async create(createCalendarEventDto: CreateCalendarEventDto, userId: string) {
		const user = await this.userRepository.findOne({ where: { id: userId } });
		if (!user) throw new NotFoundException('User not found');
		const event = this.calendarEventRepository.create({
			...createCalendarEventDto,
			owner: user,
			deadline: new Date(createCalendarEventDto.deadline),
		});
		const saved = await this.calendarEventRepository.save(event);

		// Schedule notifications
		const now = Date.now();
		const deadline = new Date(saved.deadline).getTime();
		const diff24h = deadline - now - 24 * 60 * 60 * 1000;
		const diff5m = deadline - now - 5 * 60 * 1000;
		if (diff24h > 0) {
			await this.calendarQueue.add('notify-24hr-before-deadline', { eventId: saved.id }, { delay: diff24h, removeOnComplete: true });
		}
		if (diff5m > 0) {
			await this.calendarQueue.add('notify-5min-before-deadline', { eventId: saved.id }, { delay: diff5m, removeOnComplete: true });
		}
		return saved;
	}

	async findAll(userId: string) {
		return this.calendarEventRepository.find({ where: { owner: { id: userId } }, order: { deadline: 'ASC' } });
	}

	async findOne(id: string, userId: string) {
		const event = await this.calendarEventRepository.findOne({ where: { id }, relations: ['owner'] });
		if (!event) throw new NotFoundException('Event not found');
		if (event.owner.id !== userId) throw new ForbiddenException('Forbidden');
		return event;
	}

	async update(id: string, updateCalendarEventDto: UpdateCalendarEventDto, userId: string) {
		const event = await this.calendarEventRepository.findOne({ where: { id }, relations: ['owner'] });
		if (!event) throw new NotFoundException('Event not found');
		if (event.owner.id !== userId) throw new ForbiddenException('Forbidden');
		Object.assign(event, updateCalendarEventDto);
		if (updateCalendarEventDto.deadline) event.deadline = new Date(updateCalendarEventDto.deadline);
		const saved = await this.calendarEventRepository.save(event);
		// (Re)schedule notifications if deadline changed
		// (For brevity, not removing old jobs; in production, consider job idempotency)
		const now = Date.now();
		const deadline = new Date(saved.deadline).getTime();
		const diff24h = deadline - now - 24 * 60 * 60 * 1000;
		const diff5m = deadline - now - 5 * 60 * 1000;
		if (diff24h > 0) {
			await this.calendarQueue.add('notify-24hr-before-deadline', { eventId: saved.id }, { delay: diff24h, removeOnComplete: true });
		}
		if (diff5m > 0) {
			await this.calendarQueue.add('notify-5min-before-deadline', { eventId: saved.id }, { delay: diff5m, removeOnComplete: true });
		}
		return saved;
	}

	async remove(id: string, userId: string) {
		const event = await this.calendarEventRepository.findOne({ where: { id }, relations: ['owner'] });
		if (!event) throw new NotFoundException('Event not found');
		if (event.owner.id !== userId) throw new ForbiddenException('Forbidden');
		await this.calendarEventRepository.remove(event);
		return { message: 'Event deleted' };
	}
}
