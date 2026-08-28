import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Body of `POST /videos` — pre-registers a draft and starts the multipart upload. */
export class InitiateUploadDto {
  @ApiProperty({ maxLength: 255, example: 'My holiday clip' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ example: 'Shot in the Alps' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Channel that will own the video',
  })
  @IsUUID()
  channelId: string;

  @ApiProperty({
    description: 'Source size in bytes (must be <= 10 GB)',
    maximum: 10737418240,
    example: 5368709120,
  })
  @IsInt()
  @IsPositive()
  fileSize: number;

  @ApiProperty({ example: 'video/mp4' })
  @IsString()
  mimeType: string;

  @ApiPropertyOptional({ example: 'holiday.mp4' })
  @IsOptional()
  @IsString()
  originalFilename?: string;
}
