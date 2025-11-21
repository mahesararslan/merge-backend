// @ts-nocheck
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Note } from '../entities/note.entity';
import { User } from '../entities/user.entity';
import { Folder, FolderType } from '../entities/folder.entity';
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
    if (createNoteDto.folderId) {
      folder = await this.folderRepository.findOne({
        where: { id: createNoteDto.folderId },
        relations: ['owner'],
      });

      if (!folder) {
        throw new NotFoundException('Folder not found');
      }

      // Check if user owns the folder and it's a notes folder
      if (folder.owner.id !== userId || folder.type !== FolderType.NOTES) {
        throw new ForbiddenException('You can only create notes in your own notes folders');
      }
    }

    const note = new Note();
    note.owner = user;
    note.folder = folder;
    note.title = createNoteDto.title;
    note.content = createNoteDto.content;

    return this.noteRepository.save(note);
  }

  async findAll(queryDto: QueryNoteDto, userId: string): Promise<{
    folders: any[];
    notes: Note[];
    total: { folders: number; notes: number; combined: number };
    pagination: {
      totalPages: number;
      currentPage: number;
      sortBy: string;
      sortOrder: string;
    };
    breadcrumb?: any[];
    currentFolder?: any;
  }> {
    const { page, limit, sortBy, sortOrder, search, folderId } = queryDto;

    // Determine if we're looking at root or specific folder
    const isRoot = !folderId || folderId === 'root' || folderId === 'null';
    
    let currentFolder = null;
    let breadcrumb = [];

    // If not root, get current folder info and breadcrumb
    if (!isRoot) {
      currentFolder = await this.folderRepository.findOne({
        where: { id: folderId },
        relations: ['owner', 'parentFolder'],
      });

      if (!currentFolder) {
        throw new NotFoundException('Folder not found');
      }

      if (currentFolder.owner.id !== userId || currentFolder.type !== FolderType.NOTES) {
        throw new ForbiddenException('You can only access your own notes folders');
      }

      breadcrumb = await this.generateBreadcrumb(folderId);
    }

    // Build folder query
    let folderQueryBuilder = this.folderRepository
      .createQueryBuilder('folder')
      .leftJoinAndSelect('folder.owner', 'owner')
      .leftJoinAndSelect('folder.parentFolder', 'parentFolder')
      .where('folder.owner.id = :userId AND folder.type = :folderType', {
        userId,
        folderType: FolderType.NOTES,
      });

    // Build note query
    let noteQueryBuilder = this.noteRepository
      .createQueryBuilder('note')
      .leftJoinAndSelect('note.owner', 'owner')
      .leftJoinAndSelect('note.folder', 'folder')
      .where('note.owner.id = :userId', { userId });

    // Filter by folder location
    if (isRoot) {
      folderQueryBuilder.andWhere('folder.parentFolder IS NULL');
      noteQueryBuilder.andWhere('note.folder IS NULL');
    } else {
      folderQueryBuilder.andWhere('folder.parentFolder.id = :folderId', { folderId });
      noteQueryBuilder.andWhere('note.folder.id = :folderId', { folderId });
    }

    // Apply search filter to both folders and notes
    if (search) {
      folderQueryBuilder.andWhere('folder.name ILIKE :search', { search: `%${search}%` });
      noteQueryBuilder.andWhere(
        '(note.title ILIKE :search OR note.content ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Get total counts for pagination
    const [totalFolders, totalNotes] = await Promise.all([
      folderQueryBuilder.getCount(),
      noteQueryBuilder.getCount(),
    ]);

    const totalCombined = totalFolders + totalNotes;
    const totalPages = Math.ceil(totalCombined / limit);
    const skip = (page - 1) * limit;

    // For combined sorting, we need to handle folders and notes together
    let folders = [];
    let notes = [];

    if (sortBy === 'name' || sortBy === 'createdAt' || sortBy === 'updatedAt') {
      // Get all folders and notes, then sort them together
      const allFolders = await folderQueryBuilder
        .orderBy(`folder.${sortBy === 'name' ? 'name' : sortBy}`, sortOrder)
        .getMany();

      const allNotes = await noteQueryBuilder
        .orderBy(`note.${sortBy === 'name' ? 'title' : sortBy}`, sortOrder)
        .getMany();

      // Combine and sort
      const combined = [
        ...allFolders.map(folder => ({ ...folder, itemType: 'folder', sortValue: folder[sortBy === 'name' ? 'name' : sortBy] })),
        ...allNotes.map(note => ({ ...note, itemType: 'note', sortValue: note[sortBy === 'name' ? 'title' : sortBy] }))
      ];

      // Sort combined results
      combined.sort((a, b) => {
        if (sortOrder === 'ASC') {
          return a.sortValue > b.sortValue ? 1 : -1;
        } else {
          return a.sortValue < b.sortValue ? 1 : -1;
        }
      });

      // Apply pagination to combined results
      const paginatedCombined = combined.slice(skip, skip + limit);

      // Separate back to folders and notes
      folders = paginatedCombined.filter(item => item.itemType === 'folder');
      notes = paginatedCombined.filter(item => item.itemType === 'note');

      // Clean up the extra properties
      folders = folders.map(({ itemType, sortValue, ...folder }) => folder);
      notes = notes.map(({ itemType, sortValue, ...note }) => note);
    } else {
      // For title sorting, prioritize folders first, then notes
      const foldersFirst = Math.min(totalFolders, Math.max(0, limit - Math.max(0, skip - totalFolders)));
      const notesFirst = Math.min(totalNotes, Math.max(0, limit - Math.max(0, skip - totalNotes)));

      if (skip < totalFolders) {
        folders = await folderQueryBuilder
          .orderBy('folder.name', sortOrder)
          .skip(skip)
          .take(foldersFirst)
          .getMany();

        if (folders.length < limit) {
          notes = await noteQueryBuilder
            .orderBy(`note.${sortBy}`, sortOrder)
            .take(limit - folders.length)
            .getMany();
        }
      } else {
        notes = await noteQueryBuilder
          .orderBy(`note.${sortBy}`, sortOrder)
          .skip(skip - totalFolders)
          .take(notesFirst)
          .getMany();
      }
    }

    // Add counts to folders
    const foldersWithCounts = await Promise.all(
      folders.map(async (folder) => {
        const [subfolderCount, noteCount] = await Promise.all([
          this.folderRepository.count({
            where: { parentFolder: { id: folder.id }, owner: { id: userId } },
          }),
          this.noteRepository.count({
            where: { folder: { id: folder.id }, owner: { id: userId } },
          }),
        ]);

        return {
          ...folder,
          subfolderCount,
          noteCount,
          totalItems: subfolderCount + noteCount,
        };
      })
    );

    return {
      folders: foldersWithCounts,
      notes,
      total: {
        folders: totalFolders,
        notes: totalNotes,
        combined: totalCombined,
      },
      pagination: {
        totalPages,
        currentPage: page,
        sortBy,
        sortOrder,
      },
      breadcrumb,
      currentFolder,
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

    // Check if user owns the note
    if (note.owner.id !== userId) {
      throw new ForbiddenException('You can only access your own notes');
    }

    return note;
  }

  async update(id: string, updateNoteDto: UpdateNoteDto, userId: string): Promise<Note> {
    const note = await this.noteRepository.findOne({
      where: { id },
      relations: ['owner', 'folder'],
    });

    if (!note) {
      throw new NotFoundException(`Note with ID ${id} not found`);
    }

    // Check if user owns the note
    if (note.owner.id !== userId) {
      throw new ForbiddenException('You can only update your own notes');
    }

    // Handle folder change
    if (updateNoteDto.folderId !== undefined) {
      if (updateNoteDto.folderId) {
        const newFolder = await this.folderRepository.findOne({
          where: { id: updateNoteDto.folderId },
          relations: ['owner'],
        });

        if (!newFolder) {
          throw new NotFoundException('Folder not found');
        }

        if (newFolder.owner.id !== userId || newFolder.type !== FolderType.NOTES) {
          throw new ForbiddenException('You can only move notes to your own notes folders');
        }

        note.folder = newFolder;
      } else {
        note.folder = null;
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
    const note = await this.noteRepository.findOne({
      where: { id },
      relations: ['owner'],
    });

    if (!note) {
      throw new NotFoundException(`Note with ID ${id} not found`);
    }

    // Check if user owns the note
    if (note.owner.id !== userId) {
      throw new ForbiddenException('You can only delete your own notes');
    }

    await this.noteRepository.remove(note);
  }

  // Additional method for getting recently created notes
  async findRecentlyCreated(userId: string, limit: number = 5): Promise<Note[]> {
    return this.noteRepository.find({
      where: { owner: { id: userId } },
      relations: ['folder'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // Additional method for getting recently updated notes
  async findRecentlyUpdated(userId: string, limit: number = 5): Promise<Note[]> {
    return this.noteRepository.find({
      where: { owner: { id: userId } },
      relations: ['folder'],
      order: { updatedAt: 'DESC' },
      take: limit,
    });
  }

  // Helper method to generate breadcrumb
  private async generateBreadcrumb(folderId: string): Promise<any[]> {
    const breadcrumb = [];
    let currentFolder = await this.folderRepository.findOne({
      where: { id: folderId },
      relations: ['parentFolder'],
    });

    while (currentFolder) {
      breadcrumb.unshift({
        id: currentFolder.id,
        name: currentFolder.name,
        type: currentFolder.type,
      });

      if (currentFolder.parentFolder) {
        currentFolder = await this.folderRepository.findOne({
          where: { id: currentFolder.parentFolder.id },
          relations: ['parentFolder'],
        });
      } else {
        break;
      }
    }

    return breadcrumb;
  }
}