// @ts-nocheck
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, FindOptionsWhere } from 'typeorm';
import { Note } from '../entities/note.entity';
import { User } from '../entities/user.entity';
import { Folder } from '../entities/folder.entity';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { QueryNoteDto } from './dto/query-note.dto';

@Injectable()
export class NoteService {
  constructor(
    @InjectRepository(Note)
    private noteRepository: Repository<Note>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
  ) {}

  async create(createNoteDto: CreateNoteDto, userId: string): Promise<Note> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let folder = null;

    // Validate folder if provided
    if (createNoteDto.folderId) {
      folder = await this.folderRepository.findOne({
        where: { id: createNoteDto.folderId },
        relations: ['owner'],
      });

      if (!folder) {
        throw new NotFoundException('Folder not found');
      }

      // Check if user owns the folder
      if (folder.owner.id !== userId) {
        throw new ForbiddenException('You can only add notes to your own folders');
      }
    }

    const note = new Note();
    note.title = createNoteDto.title;
    note.content = createNoteDto.content;
    note.owner = user;
    note.folder = folder;

    return this.noteRepository.save(note);
  }

  async findAll(
    queryDto: QueryNoteDto,
    userId: string,
  ): Promise<{
    notes: Note[];
    total: number;
    totalPages: number;
    currentPage: number;
  }> {
    const { page, limit, folderId, search, sortBy, sortOrder } = queryDto;
    const skip = (page - 1) * limit;

    const where: FindOptionsWhere<Note> = {
      owner: { id: userId },
    };

    // Filter by folder
    if (folderId) {
      if (folderId === 'null' || folderId === 'root') {
        // Get notes not in any folder
        where.folder = null;
      } else {
        // Validate user owns the folder
        const folder = await this.folderRepository.findOne({
          where: { id: folderId },
          relations: ['owner'],
        });

        if (!folder) {
          throw new NotFoundException('Folder not found');
        }

        if (folder.owner.id !== userId) {
          throw new ForbiddenException('You can only access your own folders');
        }

        where.folder = { id: folderId };
      }
    }

    // Build the query
    let queryBuilder = this.noteRepository
      .createQueryBuilder('note')
      .leftJoinAndSelect('note.owner', 'owner')
      .leftJoinAndSelect('note.folder', 'folder')
      .where('note.owner.id = :userId', { userId });

    // Apply folder filter
    if (folderId) {
      if (folderId === 'null' || folderId === 'root') {
        queryBuilder.andWhere('note.folder IS NULL');
      } else {
        queryBuilder.andWhere('note.folder.id = :folderId', { folderId });
      }
    }

    // Apply search filter
    if (search) {
      queryBuilder.andWhere(
        '(note.title ILIKE :search OR note.content ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Apply sorting
    queryBuilder.orderBy(`note.${sortBy}`, sortOrder);

    // Apply pagination
    queryBuilder.skip(skip).take(limit);

    const [notes, total] = await queryBuilder.getManyAndCount();

    return {
      notes,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async findOne(id: string, userId: string): Promise<Note> {
    const note = await this.noteRepository.findOne({
      where: { id },
      relations: ['owner', 'folder'],
    });

    if (!note) {
      throw new NotFoundException(`Note with ID ${id} not found`);
    }

    // Check ownership
    if (note.owner.id !== userId) {
      throw new ForbiddenException('You do not have access to this note');
    }

    return note;
  }

  async update(id: string, updateNoteDto: UpdateNoteDto, userId: string): Promise<Note> {
    const note = await this.findOne(id, userId);

    // Only owner can update the note
    if (note.owner.id !== userId) {
      throw new ForbiddenException('You can only update your own notes');
    }

    // Validate new folder if provided
    if (updateNoteDto.folderId !== undefined) {
      if (updateNoteDto.folderId === null || updateNoteDto.folderId === '') {
        // Remove from folder
        note.folder = null;
      } else {
        const folder = await this.folderRepository.findOne({
          where: { id: updateNoteDto.folderId },
          relations: ['owner'],
        });

        if (!folder) {
          throw new NotFoundException('Folder not found');
        }

        if (folder.owner.id !== userId) {
          throw new ForbiddenException('You can only move notes to your own folders');
        }

        note.folder = folder;
      }
    }

    // Update other fields
    if (updateNoteDto.title !== undefined) {
      note.title = updateNoteDto.title;
    }
    if (updateNoteDto.content !== undefined) {
      note.content = updateNoteDto.content;
    }

    return this.noteRepository.save(note);
  }

  async remove(id: string, userId: string): Promise<void> {
    const note = await this.findOne(id, userId);

    // Only owner can delete the note
    if (note.owner.id !== userId) {
      throw new ForbiddenException('You can only delete your own notes');
    }

    await this.noteRepository.remove(note);
  }

  async moveToFolder(noteId: string, folderId: string | null, userId: string): Promise<Note> {
    const note = await this.findOne(noteId, userId);

    if (note.owner.id !== userId) {
      throw new ForbiddenException('You can only move your own notes');
    }

    if (folderId) {
      const folder = await this.folderRepository.findOne({
        where: { id: folderId },
        relations: ['owner'],
      });

      if (!folder) {
        throw new NotFoundException('Folder not found');
      }

      if (folder.owner.id !== userId) {
        throw new ForbiddenException('You can only move notes to your own folders');
      }

      note.folder = folder;
    } else {
      note.folder = null; // Remove from folder
    }

    return this.noteRepository.save(note);
  }

  async getNotesStats(userId: string): Promise<{
    totalNotes: number;
    notesInFolders: number;
    notesWithoutFolder: number;
    recentNotes: Note[];
  }> {
    const totalNotes = await this.noteRepository.count({
      where: { owner: { id: userId } },
    });

    const notesInFolders = await this.noteRepository.count({
      where: { 
        owner: { id: userId },
        folder: { id: Not(null) },
      },
    });

    const notesWithoutFolder = totalNotes - notesInFolders;

    const recentNotes = await this.noteRepository.find({
      where: { owner: { id: userId } },
      relations: ['folder'],
      order: { updatedAt: 'DESC' },
      take: 5,
    });

    return {
      totalNotes,
      notesInFolders,
      notesWithoutFolder,
      recentNotes,
    };
  }
}