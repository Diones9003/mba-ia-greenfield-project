import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Video } from '../entities/video.entity';
import { VideoStatus } from '../entities/video-status.enum';

/**
 * Public projection of a video. Deliberately omits internal fields
 * (`storage_key`, `thumbnail_key`, `processing_error`, `upload_id`).
 */
export class VideoResponseDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;

  @ApiPropertyOptional({ nullable: true })
  durationSeconds?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Short-lived presigned URL of the thumbnail, when available',
  })
  thumbnailUrl?: string | null;

  @ApiProperty()
  channelId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  /** Map an entity to its public projection. */
  static fromEntity(
    video: Video,
    extra?: { thumbnailUrl?: string | null },
  ): VideoResponseDto {
    const dto = new VideoResponseDto();
    dto.publicId = video.public_id;
    dto.title = video.title;
    dto.description = video.description;
    dto.status = video.status;
    dto.durationSeconds = video.duration_seconds;
    dto.thumbnailUrl = extra?.thumbnailUrl ?? null;
    dto.channelId = video.channel_id;
    dto.createdAt = video.created_at;
    dto.updatedAt = video.updated_at;
    return dto;
  }
}
