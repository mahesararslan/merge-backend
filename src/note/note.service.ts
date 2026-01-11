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

    // If not root, get current folder info and breadcrumb in parallel
    if (!isRoot) {
      const [folder, breadcrumbResult] = await Promise.all([
        this.folderRepository.findOne({
          where: { id: folderId },
          relations: ['owner', 'parentFolder'],
        }),
        this.generateBreadcrumb(folderId),
      ]);

      currentFolder = folder;

      if (!currentFolder) {
        throw new NotFoundException('Folder not found');
      }

      if (currentFolder.owner.id !== userId || currentFolder.type !== FolderType.NOTES) {
        throw new ForbiddenException('You can only access your own notes folders');
      }

      breadcrumb = breadcrumbResult;
    }

    // Build base conditions
    const folderConditions: any = {
      owner: { id: userId },
      type: FolderType.NOTES,
    };
    const noteConditions: any = {
      owner: { id: userId },
    };

    if (isRoot) {
      folderConditions.parentFolder = null;
      noteConditions.folder = null;
    } else {
      folderConditions.parentFolder = { id: folderId };
      noteConditions.folder = { id: folderId };
    }

    // Get counts and data in parallel using optimized queries
    const sortField = sortBy === 'name' ? (sortBy === 'name' ? 'name' : sortBy) : sortBy;
    const noteSortField = sortBy === 'name' ? 'title' : sortBy;

    // Build folder query with subquery for counts
    let folderQueryBuilder = this.folderRepository
      .createQueryBuilder('folder')
      .leftJoin('folder.owner', 'owner')
      .addSelect(['owner.id', 'owner.firstName', 'owner.lastName', 'owner.email', 'owner.image'])
      .leftJoin('folder.parentFolder', 'parentFolder')
      .addSelect(['parentFolder.id', 'parentFolder.name'])
      .loadRelationCountAndMap('folder.subfolderCount', 'folder.subfolders', 'subfolder', (qb) =>
        qb.where('subfolder.type = :type', { type: FolderType.NOTES })
      )
      .where('folder.owner.id = :userId AND folder.type = :folderType', {
        userId,
        folderType: FolderType.NOTES,
      });

    // Build note query
    let noteQueryBuilder = this.noteRepository
      .createQueryBuilder('note')
      .leftJoin('note.owner', 'owner')
      .addSelect(['owner.id', 'owner.firstName', 'owner.lastName', 'owner.email', 'owner.image'])
      .leftJoin('note.folder', 'folder')
      .addSelect(['folder.id', 'folder.name'])
      .where('note.owner.id = :userId', { userId });

    // Filter by folder location
    if (isRoot) {
      folderQueryBuilder.andWhere('folder.parentFolder IS NULL');
      noteQueryBuilder.andWhere('note.folder IS NULL');
    } else {
      folderQueryBuilder.andWhere('folder.parentFolder.id = :folderId', { folderId });
      noteQueryBuilder.andWhere('note.folder.id = :folderId', { folderId });
    }

    // Apply search filter
    if (search) {
      folderQueryBuilder.andWhere('folder.name ILIKE :search', { search: `%${search}%` });
      noteQueryBuilder.andWhere(
        '(note.title ILIKE :search OR note.content ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Get counts in parallel
    const [totalFolders, totalNotes] = await Promise.all([
      folderQueryBuilder.getCount(),
      noteQueryBuilder.getCount(),
    ]);

    const totalCombined = totalFolders + totalNotes;
    const totalPages = Math.ceil(totalCombined / limit);
    const skip = (page - 1) * limit;

    // Optimized pagination: fetch only what's needed
    let folders = [];
    let notes = [];

    // Calculate how many folders and notes to fetch based on pagination
    const foldersToSkip = Math.min(skip, totalFolders);
    const foldersToTake = Math.min(Math.max(0, limit - Math.max(0, skip - totalFolders)), totalFolders - foldersToSkip);
    const notesToSkip = Math.max(0, skip - totalFolders);
    const notesToTake = limit - foldersToTake;

    // Fetch folders and notes in parallel
    const [foldersResult, notesResult] = await Promise.all([
      foldersToTake > 0
        ? folderQueryBuilder
            .orderBy(`folder.${sortField}`, sortOrder)
            .skip(foldersToSkip)
            .take(foldersToTake)
            .getMany()
        : Promise.resolve([]),
      notesToTake > 0
        ? noteQueryBuilder
            .orderBy(`note.${noteSortField}`, sortOrder)
            .skip(notesToSkip)
            .take(notesToTake)
            .getMany()
        : Promise.resolve([]),
    ]);

    folders = foldersResult;
    notes = notesResult;

    // Get note counts for folders in a single query
    let foldersWithCounts = folders;
    if (folders.length > 0) {
      const folderIds = folders.map(f => f.id);
      const noteCounts = await this.noteRepository
        .createQueryBuilder('note')
        .select('note.folder.id', 'folderId')
        .addSelect('COUNT(note.id)', 'count')
        .where('note.folder.id IN (:...folderIds)', { folderIds })
        .andWhere('note.owner.id = :userId', { userId })
        .groupBy('note.folder.id')
        .getRawMany();

      const noteCountMap = new Map(noteCounts.map(nc => [nc.folderId, parseInt(nc.count)]));

      foldersWithCounts = folders.map(folder => ({
        ...folder,
        noteCount: noteCountMap.get(folder.id) || 0,
        totalItems: (folder.subfolderCount || 0) + (noteCountMap.get(folder.id) || 0),
      }));
    }

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

  // Helper method to generate breadcrumb - optimized with single recursive CTE query
  private async generateBreadcrumb(folderId: string): Promise<any[]> {
    // Use a recursive query to get all ancestors in one database call
    const result = await this.folderRepository.query(`
      WITH RECURSIVE folder_path AS (
        SELECT id, name, type, "parentFolderId", 1 as depth
        FROM folders
        WHERE id = $1
        
        UNION ALL
        
        SELECT f.id, f.name, f.type, f."parentFolderId", fp.depth + 1
        FROM folders f
        INNER JOIN folder_path fp ON f.id = fp."parentFolderId"
      )
      SELECT id, name, type FROM folder_path ORDER BY depth DESC
    `, [folderId]);

    return result.map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
    }));
  }
}