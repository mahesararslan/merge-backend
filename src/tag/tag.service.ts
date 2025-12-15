import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tag } from '../entities/tag.entity';

@Injectable()
export class TagService {
  constructor(
    @InjectRepository(Tag)
    private tagRepository: Repository<Tag>,
  ) {}

  async findOrCreateTags(tagNames: string[]): Promise<Tag[]> {
    const tags: Tag[] = [];
    
    for (const tagName of tagNames) {
      const normalizedName = tagName.toLowerCase().trim();
      
      let tag = await this.tagRepository.findOne({ 
        where: { name: normalizedName } 
      });
      
      if (!tag) {
        tag = this.tagRepository.create({ name: normalizedName });
        tag = await this.tagRepository.save(tag);
      }
      
      tags.push(tag);
    }
    
    return tags;
  }

  // this should return all the unique tags in the system by name
  async findAll(): Promise<Tag[]> {
    return this.tagRepository.find({
      order: { name: 'ASC' }
    });
  }
}