import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from 'src/entities/user.entity';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { UpdatePasswordDto } from './dto/update-password.dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async create(createUserDto: CreateUserDto, googleAccount?: boolean): Promise<User> {
    const existingUser = await this.findByEmail(createUserDto.email);
    if (existingUser) throw new ConflictException('Email already in use');

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
      select: ['id', 'email', 'firstName', 'lastName', 'role', 'image', 'new_user', 'isVerified', 'createdAt', 'updatedAt', 'hashedRefreshToken', 'googleAccount', 'twoFactorEnabled'] 
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByEmail(email: string) {
    return this.userRepository.findOne({ where: { email } });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.userRepository.update(id, updateUserDto);
    if (user.affected === 0) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
  }

  async updatePassword(userId: string, updatePasswordDto: UpdatePasswordDto) {
    const user = await this.findOne(userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const isOldPasswordValid = await bcrypt.compare(updatePasswordDto.oldPassword, user.password);
    if (!isOldPasswordValid) {
      throw new BadRequestException('Old password is incorrect');
    }

    const hashedNewPassword = await bcrypt.hash(updatePasswordDto.newPassword, 10);
    user.password = hashedNewPassword;
    this.userRepository.save(user);
    return {
      success: true,
      message: 'password updated successfully'
    }
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

    user.isVerified = true; // @ts-ignore
    user.verificationToken = null;
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

  async toggle2FA(userId: string, enable: boolean): Promise<User> {
  const user = await this.findOne(userId);
  
  user.twoFactorEnabled = enable;
  
  // Clear any existing OTP data when disabling 2FA
  if (!enable) { // @ts-ignore
    user.otpCode = null; // @ts-ignore
    user.otpExpires = null;
  }
  
  return this.userRepository.save(user);
}

async setOTPCode(userId: string): Promise<string> {
  const user = await this.findOne(userId);
  
  // Generate 6-digit OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Set expiry to 2 minutes from now
  const otpExpires = new Date();
  otpExpires.setMinutes(otpExpires.getMinutes() + 2);
  
  user.otpCode = await bcrypt.hash(otpCode, 10);
  user.otpExpires = otpExpires;
  
  await this.userRepository.save(user);
  return otpCode;
}

async verifyOTP(email: string, otpCode: string): Promise<User | null> {
  const user = await this.findByEmail(email);

  // compare otpCode with hashed otpCode
  if (user && user.otpCode) {
    const isMatch = await bcrypt.compare(otpCode, user.otpCode);
    if (!isMatch) {
      return null;
    }
  } else {
    return null;
  }
  
  // Check if OTP has expired
  if (user.otpExpires < new Date()) {
    return null;
  }
  
  return user;
}

async clearOTP(userId: string): Promise<void> {
  await this.userRepository.update(userId, { // @ts-ignore
    otpCode: null, // @ts-ignore
    otpExpires: null,
  });
}

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.userRepository.remove(user);
  }
}
