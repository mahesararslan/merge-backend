import { Injectable, CanActivate, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoomMember, RoomMemberRole } from 'src/entities/room-member.entity';
import { Room } from 'src/entities/room.entity';
import { ROOM_ROLES_KEY } from '../decorators/room-roles.decorator';

/**
 * Guard to check if user has required role in a room
 * 
 * How it works:
 * 1. Extracts roomId from request params
 * 2. Checks if user is room admin (always has access)
 * 3. Checks if user is room member with required role
 * 4. Room admins automatically bypass role checks
 * 
 * @example
 * // In controller - protect route to require moderator role
 * @UseGuards(RoomRoleGuard)
 * @RoomRoles(RoomMemberRole.MODERATOR)
 * @Post(':roomId/announcement')
 * createAnnouncement(@Param('roomId') roomId: string) { ... }
 * 
 * // Multiple roles allowed
 * @UseGuards(RoomRoleGuard)
 * @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
 * @Get(':roomId/content')
 * getContent(@Param('roomId') roomId: string) { ... }
 */
@Injectable()
export class RoomRoleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(RoomMember)
    private roomMemberRepository: Repository<RoomMember>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required roles from decorator
    const requiredRoles = this.reflector.getAllAndOverride<RoomMemberRole[]>(ROOM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles specified, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    const roomId = request.params?.roomId || request.params?.id || request.body?.roomId || request.query?.roomId;

    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    if (!roomId) {
      throw new ForbiddenException('Room ID not provided in request params');
    }

    // Check if room exists
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }

    // Check if ADMIN role is required (admin-only access)
    const isAdminOnly = requiredRoles.includes(RoomMemberRole.ADMIN);
    
    if (isAdminOnly) {
      // For admin-only routes, only room admin can access
      if (room.admin.id !== userId) {
        throw new ForbiddenException('Only room admin can access this resource');
      }
      return true;
    }

    // Room admin always has access to member/moderator routes
    if (room.admin.id === userId) {
      // Attach pseudo member info for admin
      request.roomMember = { role: 'admin', room, user: room.admin };
      return true;
    }

    // Check if user is a member with required role
    const member = await this.roomMemberRepository.findOne({
      where: {
        room: { id: roomId },
        user: { id: userId },
      },
      relations: ['user', 'room'],
    });

    if (!member) {
      throw new ForbiddenException('You are not a member of this room');
    }

    // Check if member's role is in required roles
    const hasRole = requiredRoles.includes(member.role);

    if (!hasRole) {
      throw new ForbiddenException(`You need ${requiredRoles.join(' or ')} role to access this resource`);
    }

    // Attach member info to request for use in controller
    request.roomMember = member;
    
    return true;
  }
}
