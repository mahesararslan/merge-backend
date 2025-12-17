
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from 'src/entities/user.entity';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { Cache } from 'cache-manager';
import { TagService } from 'src/tag/tag.service';
import { Tag } from 'src/entities/tag.entity';
import { RoomService } from 'src/room/room.service';
import { Room } from 'src/entities/room.entity';
import { UserAuth } from 'src/entities/user-auth.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserAuth)
    private userAuthRepository: Repository<UserAuth>,
    @Inject('CACHE_MANAGER') private cacheManager: Cache,
    private tagService: TagService,
    private roomService: RoomService,
  ) {}

  async create(
    createUserDto: CreateUserDto,
    googleAccount?: boolean,
  ): Promise<User> {
    const existingUser = await this.findByEmail(createUserDto.email);
    console.log(existingUser);
    if (existingUser) throw new ConflictException('Email already in use');

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    const verificationToken = uuidv4();
    
    // Create user auth entity
    const userAuth = this.userAuthRepository.create({
      isVerified: googleAccount ? true : false,
      verificationToken,
    });

    const user = this.userRepository.create({
      ...createUserDto,
      password: hashedPassword,
      googleAccount,
      auth: userAuth,
    });

    return this.userRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.find();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['auth', 'tags'],
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    
    const profile = this.formatUserProfile(user, true);
    profile.tags = user.tags?.map(tag => this.formatTagInfo(tag)) || [];
    
    return profile as any;
  }

  // for getting account details of other users.
  async getProfileWithID(id: string) {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['tags'],
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    
    const profile = this.formatUserProfile(user, false);
    profile.tags = user.tags?.map(tag => this.formatTagInfo(tag)) || [];
    
    return profile;
  }

  async findByEmail(email: string) {
    return this.userRepository.findOne({ 
      where: { email },
      relations: ['auth'],
    });
  }

  async getUserwithAuth(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['auth'],
    });
    return user;
  }


  async update(id: string, updateUserDto: UpdateUserDto) {
    const updateResult = await this.userRepository.update(id, updateUserDto);
    if (updateResult.affected === 0) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    
    // Return updated user profile
    return this.findOne(id);
  }

  async updatePassword(userId: string, updatePasswordDto: UpdatePasswordDto) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const isOldPasswordValid = await bcrypt.compare(
      updatePasswordDto.oldPassword,
      user.password,
    );
    if (!isOldPasswordValid) {
      throw new BadRequestException('Old password is incorrect');
    }

    const hashedNewPassword = await bcrypt.hash(
      updatePasswordDto.newPassword,
      10,
    );
    user.password = hashedNewPassword;
    await this.userRepository.save(user);
    return {
      success: true,
      message: 'password updated successfully',
    };
  }

  async updateHashedRefreshToken(
    userId: string,
    hashedRefreshToken: string | null,
  ) {
    const user = await this.userRepository.findOne({ 
      where: { id: userId },
      relations: ['auth'],
    });
    if (!user || !user.auth) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
    user.auth.hashedRefreshToken = hashedRefreshToken as any;
    await this.userAuthRepository.save(user.auth);
  }

  async findByVerificationToken(token: string): Promise<User | null> {
    const userAuth = await this.userAuthRepository.findOne({
      where: { verificationToken: token },
      relations: ['user'],
    });
    return userAuth?.user || null;
  }

  async findByPasswordResetToken(token: string): Promise<User | null> {
    const userAuth = await this.userAuthRepository.findOne({
      where: {
        passwordResetToken: token,
        // passwordResetExpires: MoreThan(new Date()) // Uncomment if using TypeORM MoreThan
      },
      relations: ['user'],
    });
    return userAuth?.user || null;
  }

  async verifyEmail(token: string): Promise<User> {
    const user = await this.findByVerificationToken(token);
    if (!user) {
      throw new NotFoundException('Invalid verification token');
    }

    if (user.auth.isVerified) {
      throw new ConflictException('Email already verified');
    }

    user.auth.isVerified = true;
    user.auth.verificationToken = null as any;
    await this.userAuthRepository.save(user.auth);
    return user;
  }

  async setPasswordResetToken(email: string): Promise<User> {
    const user = await this.findByEmail(email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const resetToken = uuidv4();
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1); // Expires in 1 hour

    user.auth.passwordResetToken = resetToken;
    user.auth.passwordResetExpires = resetExpires;
    await this.userAuthRepository.save(user.auth);
    return user;
  }

  async resetPassword(token: string, newPassword: string): Promise<User> {
    const userAuth = await this.userAuthRepository.findOne({
      where: { passwordResetToken: token },
      relations: ['user'],
    });

    if (!userAuth || !userAuth.user) {
      throw new NotFoundException('Invalid reset token');
    }

    if (userAuth.passwordResetExpires < new Date()) {
      throw new ConflictException('Reset token has expired');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    userAuth.user.password = hashedPassword;
    userAuth.passwordResetToken = null as any;
    userAuth.passwordResetExpires = null as any;
    userAuth.hashedRefreshToken = null as any; // Invalidate all refresh tokens

    await this.userAuthRepository.save(userAuth);
    await this.userRepository.save(userAuth.user);
    return userAuth.user;
  }

  async toggle2FA(userId: string, enable: boolean, password: string): Promise<User> {
    const user = await this.userRepository.findOne({ 
      where: { id: userId },
      relations: ['auth'],
    });
    if (!user) throw new NotFoundException('User not found');
    // verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('Incorrect Password');

    user.auth.twoFactorEnabled = enable;

    // Clear any existing OTP data when disabling 2FA
    if (!enable) {
      user.auth.otpCode = null as any;
      user.auth.otpExpires = null as any;
    }

    await this.userAuthRepository.save(user.auth);
    return user;
  }

  async setOTPCode(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['auth'],
    });
    
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Set expiry to 2 minutes from now
    const otpExpires = new Date();
    otpExpires.setMinutes(otpExpires.getMinutes() + 2);

    user.auth.otpCode = await bcrypt.hash(otpCode, 10);
    user.auth.otpExpires = otpExpires;

    await this.userAuthRepository.save(user.auth);
    return otpCode;
  }

  async verifyOTP(email: string, otpCode: string): Promise<User | null> {
    const user = await this.findByEmail(email);

    // compare otpCode with hashed otpCode
    if (user && user.auth && user.auth.otpCode) {
      const isMatch = await bcrypt.compare(otpCode, user.auth.otpCode);
      if (!isMatch) {
        return null;
      }
    } else {
      return null;
    }

    // Check if OTP has expired
    if (user.auth.otpExpires < new Date()) {
      return null;
    }

    return user;
  }

  async clearOTP(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['auth'],
    });
    if (user && user.auth) {
      user.auth.otpCode = null as any;
      user.auth.otpExpires = null as any;
      await this.userAuthRepository.save(user.auth);
    }
  }

  async remove(id: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['auth'],
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    await this.userRepository.remove(user);
  }

  async setUserTags(userId: string, tagNames: string[]): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['tags', 'auth'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Get or create tags
    const tags = await this.tagService.findOrCreateTags(tagNames);

    // Replace all tags
    user.tags = tags;

    // Mark as not new user after setting tags
    if (user.new_user) {
      user.new_user = false;
    }

    await this.userRepository.save(user);

    // Invalidate cache
    // await this.cacheService.invalidateUserCache(userId);

    const profile = this.formatUserProfile(user, true);
    profile.tags = tags.map(tag => this.formatTagInfo(tag));
    
    return profile as any;
  }

  async getUserTags(userId: string): Promise<any[]> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['tags'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user.tags?.map(tag => this.formatTagInfo(tag)) || [];
  }

  async findUserRooms(userId: string, queryDto: any) {
    return this.roomService.findUserRoomsWithFilter(queryDto, userId);
  }

  private formatUserProfile(user: User, includeAuth = false) {
    const profile: any = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      image: user.image,
      new_user: user.new_user,
      googleAccount: user.googleAccount,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    if (includeAuth && user.auth) {
      profile.isVerified = user.auth.isVerified;
      profile.twoFactorEnabled = user.auth.twoFactorEnabled;
    }

    return profile;
  }

  private formatTagInfo(tag: Tag) {
    return {
      id: tag.id,
      name: tag.name,
    };
  }
}
