import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileService } from './file.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { QueryFileDto } from './dto/query-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { GeneratePresignedUrlDto } from './dto/generate-presigned-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth/jwt-auth.guard';

import { RoomMemberRole } from 'src/entities/room-member.entity';
import { RoomRoles } from 'src/auth/decorators/room-roles.decorator';
import { RoomRoleGuard } from 'src/auth/guards/roles/room-role.guard';


@Controller('files')
@UseGuards(JwtAuthGuard)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MODERATOR)
  @Post('upload/course-content/:roomId')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadFileInRoom(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }), // 50MB limit
        ],
      }),
    )
    file: any,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() uploadFileDto: UploadFileDto,
    @Req() req,
  ) {
    console.log('Uploading file:', file.originalname);
    const dto = { ...uploadFileDto, roomId };
    return this.fileService.uploadFile(file, dto, req.user.id);
  }

  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MODERATOR)
  @Post('upload/course-content/:roomId/:folderId')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadCourseContent(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }), // 50MB limit
        ],
      }),
    )
    file: any,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Body() uploadFileDto: UploadFileDto,
    @Req() req,
  ) {
    console.log('Uploading file:', file.originalname);
    const dto = { ...uploadFileDto, roomId, folderId };
    return this.fileService.uploadFile(file, dto, req.user.id);
  }

  @Get()
  findAll(@Query() queryDto: QueryFileDto, @Req() req) {
    return this.fileService.findAll(queryDto, req.user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.fileService.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateFileDto: UpdateFileDto,
    @Req() req,
  ) {
    return this.fileService.updateFile(id, updateFileDto, req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.fileService.deleteFile(id, req.user.id);
  }

  @Post('presigned-url')
  @HttpCode(HttpStatus.OK)
  async generatePresignedUrl(
    @Body() dto: GeneratePresignedUrlDto,
    @Req() req,
  ) {
    return this.fileService.generatePresignedUrl(
      dto.originalName,
      dto.contentType,
      dto.size,
      undefined, // no roomId for personal files
      dto.folderId,
      req.user.id,
    );
  }

  /**
   * Generate presigned URL for room file upload (Moderator+)
   * POST /files/presigned-url/room/:roomId
   */
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MODERATOR)
  @Post('presigned-url/room/:roomId')
  @HttpCode(HttpStatus.OK)
  async generateRoomPresignedUrl(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: GeneratePresignedUrlDto,
    @Req() req,
  ) {
    return this.fileService.generatePresignedUrl(
      dto.originalName,
      dto.contentType,
      dto.size,
      roomId,
      dto.folderId,
      req.user.id,
    );
  }

  /**
   * Confirm upload and save file metadata (Personal Files)
   * POST /files/confirm-upload
   */
  @Post('confirm-upload')
  @HttpCode(HttpStatus.CREATED)
  async confirmUpload(
    @Body() dto: ConfirmUploadDto,
    @Req() req,
  ) {
    return this.fileService.saveFileMetadata(
      dto.fileKey,
      dto.fileUrl,
      dto.originalName,
      dto.contentType,
      dto.size,
      req.user.id,
      undefined, // no roomId for personal files
      dto.folderId,
    );
  }

  /**
   * Confirm room file upload and save metadata (Moderator+)
   * POST /files/confirm-upload/room/:roomId
   */
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MODERATOR)
  @Post('confirm-upload/room/:roomId')
  @HttpCode(HttpStatus.CREATED)
  async confirmRoomUpload(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: ConfirmUploadDto,
    @Req() req,
  ) {
    return this.fileService.saveFileMetadata(
      dto.fileKey,
      dto.fileUrl,
      dto.originalName,
      dto.contentType,
      dto.size,
      req.user.id,
      roomId,
      dto.folderId,
    );
  }

  /**
   * Generate presigned URL for assignment file upload (Admin only - handled in service)
   * POST /files/presigned-url/assignment/:roomId
   */
  @Post('presigned-url/assignment/:roomId')
  @HttpCode(HttpStatus.OK)
  async generateAssignmentPresignedUrl(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: GeneratePresignedUrlDto,
    @Req() req,
  ) {
    return this.fileService.generatePresignedUrl(
      dto.originalName,
      dto.contentType,
      dto.size,
      roomId,
      undefined, // no folderId for assignments
      req.user.id,
      'assignment',
    );
  }

  /**
   * Generate presigned URL for assignment attempt file upload (Members)
   * POST /files/presigned-url/attempt/:assignmentId
   */
  @Post('presigned-url/attempt/:assignmentId')
  @HttpCode(HttpStatus.OK)
  async generateAttemptPresignedUrl(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: GeneratePresignedUrlDto,
    @Req() req,
  ) {
    return this.fileService.generatePresignedUrl(
      dto.originalName,
      dto.contentType,
      dto.size,
      undefined, // roomId will be fetched from assignmentId in service
      undefined, // no folderId for attempts
      req.user.id,
      'attempt',
      assignmentId,
    );
  }
}