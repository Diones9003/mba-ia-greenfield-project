import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** A single completed multipart part reported by the client. */
export class CompletedPartDto {
  @ApiProperty({ minimum: 1, maximum: 10000, example: 1 })
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber: number;

  @ApiProperty({ example: '"e868d1d8f3a3f1c9b2..."' })
  @IsString()
  eTag: string;
}

/** Body of `POST /videos/:publicId/complete`. */
export class CompleteUploadDto {
  @ApiProperty({ type: [CompletedPartDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts: CompletedPartDto[];
}
