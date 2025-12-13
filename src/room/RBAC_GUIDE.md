# Room Role-Based Access Control (RBAC) Guide

## Overview
The room RBAC system replaces the old permission-based system with a simpler role-based approach. Room members can now have two roles:
- **MEMBER** - Regular room member with basic access
- **MODERATOR** - Enhanced access to moderate and manage room content

Room admins automatically have all permissions and bypass role checks.

## Setup

### 1. Room Member Entity
The `RoomMember` entity now includes a `role` field:

```typescript
export enum RoomMemberRole {
  MEMBER = 'member',
  MODERATOR = 'moderator',
}

@Entity('room_members')
export class RoomMember {
  @Column({
    type: 'enum',
    enum: RoomMemberRole,
    default: RoomMemberRole.MEMBER,
  })
  role: RoomMemberRole;
}
```

### 2. Using the Guard in Controllers

#### Basic Usage - Require Moderator Role
```typescript
import { UseGuards } from '@nestjs/common';
import { RoomRoleGuard } from './guards/room-role.guard';
import { RoomRoles } from './decorators/room-roles.decorator';
import { RoomMemberRole } from 'src/entities/room-member.entity';

@Controller('room')
export class RoomController {
  
  // Only moderators and admins can create announcements
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MODERATOR)
  @Post(':roomId/announcement')
  createAnnouncement(
    @Param('roomId') roomId: string,
    @Body() announcementDto: CreateAnnouncementDto,
    @Req() req,
  ) {
    // req.roomMember contains the member info if you need it
    return this.roomService.createAnnouncement(roomId, announcementDto, req.user.id);
  }
}
```

#### Allow Multiple Roles
```typescript
// Both members and moderators can view content
@UseGuards(RoomRoleGuard)
@RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
@Get(':roomId/content')
getContent(@Param('roomId') roomId: string) {
  return this.roomService.getContent(roomId);
}
```

#### Admin Only (No RoomRoleGuard - Check in Service)
**Important:** Room admins are NOT members, so RoomRoleGuard would block them!
Admin-only operations must check admin status in the service layer.

```typescript
// ❌ WRONG - This would block the admin!
@UseGuards(RoomRoleGuard)
@RoomRoles(RoomMemberRole.MODERATOR)
@Delete(':roomId')
deleteRoom() { }

// ✅ CORRECT - No guard, check admin in service
@Patch(':roomId/settings')
updateSettings(
  @Param('roomId') roomId: string,
  @Body() updateDto: UpdateRoomDto,
  @Req() req,
) {
  // Service checks: room.admin.id === req.user.id
  return this.roomService.update(roomId, updateDto, req.user.id);
}
```

### 3. Updating Member Roles (Admin Operation)

**This is NOT authentication** - this is the admin **assigning/changing** a member's role.

#### How It Works
1. Admin (authenticated via JWT) makes request
2. Service verifies requester is room admin using `req.user.id` (from JWT)
3. If admin, updates the target member's role in database

#### Controller Example
```typescript
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

// No RoomRoleGuard - admin check is in service
@Patch(':roomId/members/:memberId/role')
updateMemberRole(
  @Param('roomId') roomId: string,
  @Param('memberId') memberId: string,
  @Body() updateRoleDto: UpdateMemberRoleDto,  // New role to assign
  @Req() req,  // req.user.id from JWT guard
) {
  // Service checks if req.user.id is room admin
  return this.roomService.updateMemberRole(
    roomId,
    memberId,
    updateRoleDto.role,
    req.user.id,  // Admin's ID from JWT
  );
}
```

#### Request Example
```bash
# Admin promoting user "Bob" to moderator
PATCH /room/123e4567-e89b-12d3-a456-426614174000/members/bob-user-id/role
Authorization: Bearer <admin-jwt-token>
Content-Type: application/json

{
  "role": "moderator"  // New role to assign to Bob
}

# Flow:
# 1. JWT guard extracts admin ID from token → req.user.id
# 2. Service checks: Is req.user.id the room admin?
# 3. If yes, update Bob's role to moderator
```

### 4. Common Use Cases

#### File Upload (Moderators Only)
```typescript
@UseGuards(RoomRoleGuard)
@RoomRoles(RoomMemberRole.MODERATOR)
@Post(':roomId/files/upload')
uploadFile(
  @Param('roomId') roomId: string,
  @UploadedFile() file: Express.Multer.File,
  @Req() req,
) {
  return this.fileService.uploadToRoom(roomId, file, req.user.id);
}
```

#### Start Live Session (Moderators Only)
```typescript
@UseGuards(RoomRoleGuard)
@RoomRoles(RoomMemberRole.MODERATOR)
@Post(':roomId/live-session/start')
startLiveSession(@Param('roomId') roomId: string) {
  return this.liveSessionService.start(roomId);
}
```

#### View Content (All Members)
```typescript
@UseGuards(RoomRoleGuard)
@RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
@Get(':roomId/files')
getFiles(@Param('roomId') roomId: string) {
  return this.fileService.getRoomFiles(roomId);
}
```

#### Post in Chat (All Members)
```typescript
@UseGuards(RoomRoleGuard)
@RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
@Post(':roomId/chat/message')
sendMessage(
  @Param('roomId') roomId: string,
  @Body() messageDto: CreateMessageDto,
  @Req() req,
) {
  return this.chatService.sendMessage(roomId, messageDto, req.user.id);
}
```

## How It Works

1. **Authentication Flow**:
   - Global JWT guard extracts user ID from token → `req.user.id`
   - `RoomRoleGuard` uses this `req.user.id` for authorization checks

2. **Guard Checks**: The `RoomRoleGuard` automatically:
   - Extracts `roomId` from URL params
   - Gets `userId` from `req.user.id` (set by JWT guard)
   - Checks if user is room admin (auto-allow, bypass member check)
   - If not admin, checks if user is room member with required role
   - Attaches member info to `req.roomMember` for controller use

3. **Role Hierarchy**:
   - **Room Admin**: NOT a member, owner of room, checked separately
   - **Moderator**: Room member with elevated permissions
   - **Member**: Room member with basic access
   
4. **Why Admins Are Different**:
   - Admins are in `rooms.admin` field, NOT in `room_members` table
   - RoomRoleGuard would block admins if used on admin-only routes
   - Admin-only routes check `room.admin.id === req.user.id` in service

3. **Error Responses**:
   - 403 Forbidden: User not authenticated
   - 403 Forbidden: User not a room member
   - 403 Forbidden: User lacks required role
   - 404 Not Found: Room doesn't exist

## Migration from Old Permission System

### Before (Permissions)
```typescript
const permissions = await roomPermissionsRepository.findOne({
  where: { member: { id: memberId } },
});

if (!permissions.can_add_files) {
  throw new ForbiddenException('No permission to add files');
}
```

### After (Roles)
```typescript
@UseGuards(RoomRoleGuard)
@RoomRoles(RoomMemberRole.MODERATOR)
@Post(':roomId/files')
uploadFile() {
  // Guard handles role check automatically
  // Only moderators and admins can reach here
}
```

## Best Practices

1. **Use Guards for Route Protection**: Always use `@UseGuards(RoomRoleGuard)` with `@RoomRoles()` decorator
2. **Service Layer Validation**: Still validate admin status in service methods for admin-only actions
3. **Consistent Naming**: Use `:roomId` param name for guard to work correctly
4. **Access Member Info**: Use `req.roomMember` to access the member's full info after guard validation
5. **Clear Role Requirements**: Document which roles can access each endpoint

## Troubleshooting

**Guard not working?**
- Ensure `roomId` is in URL params: `@Param('roomId')`
- Verify guard is in room.module providers
- Check JWT auth guard is applied globally

**403 Forbidden errors?**
- User may not be a room member
- User's role may not match required role
- Check if room exists

**Admin can't access?**
- Admins should always have access, check admin verification logic
- Ensure room.admin relation is loaded
