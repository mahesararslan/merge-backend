// src/file/file.controller.ts
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
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth/jwt-auth.guard';


@Controller('files')
@UseGuards(JwtAuthGuard)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  // @Post('upload')
  // @HttpCode(HttpStatus.CREATED)
  // @UseInterceptors(FileInterceptor('file'))
  // async uploadFile(
  //   @UploadedFile(
  //     new ParseFilePipe({
  //       validators: [
  //         new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }), // 50MB limit
  //       ],
  //     }),
  //   )
  //   file: Express.Multer.File,
  //   @Body() uploadFileDto: UploadFileDto,
  //   @Req() req,
  // ) {
  //   return this.fileService.uploadFile(file, uploadFileDto, req.user.id);
  // }

  // @Get()
  // findAll(@Query() queryDto: QueryFileDto, @Req() req) {
  //   return this.fileService.findAll(queryDto, req.user.id);
  // }

  // @Get(':id')
  // findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
  //   return this.fileService.findOne(id, req.user.id);
  // }

  // @Patch(':id')
  // update(
  //   @Param('id', ParseUUIDPipe) id: string,
  //   @Body() updateFileDto: UpdateFileDto,
  //   @Req() req,
  // ) {
  //   return this.fileService.updateFile(id, updateFileDto, req.user.id);
  // }

  // @Delete(':id')
  // @HttpCode(HttpStatus.NO_CONTENT)
  // remove(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
  //   return this.fileService.deleteFile(id, req.user.id);
  // }
}