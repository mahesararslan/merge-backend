import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from 'src/entities/user.entity';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async create(createUserDto: CreateUserDto, googleAccount?: boolean): Promise<User> {
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    const verificationToken = uuidv4();
    const user = this.userRepository.create({
      ...createUserDto,
      password: hashedPassword,
      googleAccount,
      isVerified: googleAccount ? true : false, // if google account, mark as verified
      verificationToken,
    });

    return this.userRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.find();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ 
      where: { id },
      // select everything other than the password
      select: ['id', 'email', 'firstName', 'lastName', 'role', 'image', 'new_user', 'isVerified', 'createdAt', 'updatedAt', 'hashedRefreshToken'] 
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (updateUserDto.password) {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    Object.assign(user, updateUserDto);
    return this.userRepository.save(user);
  }

  async updateHashedRefreshToken(userId: string, hashedRefreshToken: string | null) {
    return await this.update(userId, { hashedRefreshToken } as UpdateUserDto);
  }

  async findByVerificationToken(token: string): Promise<User | null> {
    return this.userRepository.findOne({ 
      where: { verificationToken: token } 
    });
  }

  async findByPasswordResetToken(token: string): Promise<User | null> {
    return this.userRepository.findOne({ 
      where: { 
        passwordResetToken: token,
        // passwordResetExpires: MoreThan(new Date()) // Uncomment if using TypeORM MoreThan
      }
    });
  }

  async verifyEmail(token: string): Promise<User> {
    const user = await this.findByVerificationToken(token);
    if (!user) {
      throw new NotFoundException('Invalid verification token');
    }

    if (user.isVerified) {
      throw new ConflictException('Email already verified');
    }

    user.isVerified = true;
    user.verificationToken = '';
    return this.userRepository.save(user);
  }  

  async setPasswordResetToken(email: string): Promise<User> {
    const user = await this.findByEmail(email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const resetToken = uuidv4();
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1); // Expires in 1 hour

    user.passwordResetToken = resetToken;
    user.passwordResetExpires = resetExpires;
    return this.userRepository.save(user);
  }

  async resetPassword(token: string, newPassword: string): Promise<User> {
    const user = await this.userRepository.findOne({ 
      where: { passwordResetToken: token }
    });

    if (!user) {
      throw new NotFoundException('Invalid reset token');
    }

    if (user.passwordResetExpires < new Date()) {
      throw new ConflictException('Reset token has expired');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword; // @ts-ignore
    user.passwordResetToken = null; // @ts-ignore
    user.passwordResetExpires = null; // @ts-ignore
    user.hashedRefreshToken = null; // Invalidate all refresh tokens

    return this.userRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.userRepository.remove(user);
  }
}
