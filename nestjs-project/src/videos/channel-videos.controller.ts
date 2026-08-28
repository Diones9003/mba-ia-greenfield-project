import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { VideosService } from './videos.service';
import { VideoResponseDto } from './dto/video-response.dto';

/**
 * Public (and owner-aware) listing of a channel's videos.
 * Lives under `/channels/:channelId/videos` so it does not collide with
 * `/videos/:publicId`.
 */
@ApiTags('videos')
@Controller('channels')
export class ChannelVideosController {
  constructor(private readonly videosService: VideosService) {}

  @Public()
  @Get(':channelId/videos')
  @ApiOperation({
    summary: "List a channel's videos",
    description:
      'Newest first. Anonymous callers see only `ready` videos; the owner sees every status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video list',
    type: VideoResponseDto,
    isArray: true,
  })
  async listChannelVideos(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('channelId') channelId: string,
  ): Promise<VideoResponseDto[]> {
    return this.videosService.listChannelVideos(channelId, user?.sub ?? null);
  }
}
