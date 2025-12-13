import { SetMetadata } from '@nestjs/common';
import { RoomMemberRole } from 'src/entities/room-member.entity';

export const ROOM_ROLES_KEY = 'roomRoles';

/**
 * Decorator to specify required room roles for accessing a route
 * Can be used to protect routes requiring moderator, member, or admin access
 * 
 * @param roles - Array of allowed room member roles
 * 
 * @example
 * // Only room admin can access
 * @RoomRoles(RoomMemberRole.ADMIN)
 * 
 * // Only room moderators and admins can access
 * @RoomRoles(RoomMemberRole.MODERATOR)
 * 
 * // All members, moderators, and admins can access
 * @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
 */
export const RoomRoles = (...roles: RoomMemberRole[]) => SetMetadata(ROOM_ROLES_KEY, roles);
