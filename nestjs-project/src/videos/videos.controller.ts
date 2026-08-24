import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { VideosService } from './videos.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Video upload handshake endpoints (SI-03.3).
 *
 * All routes are protected by the global `JwtAuthGuard` and enforce channel
 * ownership. Byte transfer happens directly against storage via presigned URLs.
 */
@ApiTags('videos')
@ApiBearerAuth()
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Initiate a video upload',
    description:
      'Pre-registers a draft video and starts an S3 multipart upload, ' +
      'returning the identifiers needed to upload parts directly to storage.',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload initiated',
    schema: {
      properties: {
        publicId: { type: 'string' },
        uploadId: { type: 'string' },
        storageKey: { type: 'string' },
        partSize: { type: 'integer' },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not own the target channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description: 'File exceeds the maximum allowed size',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<{
    publicId: string;
    uploadId: string;
    storageKey: string;
    partSize: number;
  }> {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  @Post(':publicId/parts/:partNumber/url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a presigned URL for a multipart part',
    description:
      'Returns a short-lived presigned PUT URL the client uses to upload a ' +
      'single part of the video directly to storage.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned part URL',
    schema: {
      properties: {
        url: { type: 'string' },
        expiresIn: { type: 'integer' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Upload has not been initiated',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getPartUploadUrl(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Param('partNumber', ParseIntPipe) partNumber: number,
  ): Promise<{ url: string; expiresIn: number }> {
    return this.videosService.getPartUploadUrl(user.sub, publicId, partNumber);
  }

  @Post(':publicId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Assembles the uploaded parts into the final object and transitions ' +
      'the video to `processing`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed; video is now processing',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Upload already completed or invalid status transition',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<VideoResponseDto> {
    return this.videosService.completeUpload(user.sub, publicId, dto);
  }

  @Get(':publicId/stream')
  @Redirect()
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Returns a redirect (302) to a presigned GET URL for streaming. ' +
      'Storage natively supports Range requests (HTTP 206 Partial Content).',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to presigned streaming URL',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async streamVideo(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<{ url: string }> {
    const url = await this.videosService.getStreamUrl(user.sub, publicId);
    return { url };
  }

  @Get(':publicId/download')
  @Redirect()
  @ApiOperation({
    summary: 'Download a video',
    description:
      'Returns a redirect (302) to a presigned GET URL with ' +
      'Content-Disposition: attachment for downloading.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to presigned download URL',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async downloadVideo(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<{ url: string }> {
    const url = await this.videosService.getDownloadUrl(user.sub, publicId);
    return { url };
  }

  @Get(':publicId')
  @Public()
  @ApiOperation({
    summary: 'Get video details',
    description:
      'Returns video details. Public if status=READY, owner-only otherwise.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video details',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not accessible',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getVideo(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('publicId') publicId: string,
  ): Promise<VideoResponseDto> {
    return this.videosService.getVideoDetails(user?.sub || null, publicId);
  }

  @Patch(':publicId')
  @ApiOperation({
    summary: 'Update video metadata',
    description: 'Update video title and/or description. Owner only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video updated',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Not the video owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async updateVideo(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: UpdateVideoDto,
  ): Promise<VideoResponseDto> {
    return this.videosService.updateVideo(user.sub, publicId, dto);
  }

  @Delete(':publicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a video',
    description:
      'Deletes a video and its storage files (video + thumbnail). Owner only.',
  })
  @ApiResponse({
    status: 204,
    description: 'Video deleted successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Not the video owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async deleteVideo(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<void> {
    await this.videosService.deleteVideo(user.sub, publicId);
  }
}
