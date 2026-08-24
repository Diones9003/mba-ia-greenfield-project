import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO for updating video metadata (title, description).
 * Only the video owner can update these fields.
 */
export class UpdateVideoDto {
  @ApiProperty({
    description: 'Video title',
    example: 'My Updated Video Title',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({
    description: 'Video description',
    example: 'Updated description of my video',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;
}
