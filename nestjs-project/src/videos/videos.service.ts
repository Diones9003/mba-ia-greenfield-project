import { Injectable } from '@nestjs/common';
import { Video } from './entities/video.entity';
import { VideosRepository } from './videos.repository';
import { generatePublicId } from './public-id.util';

/**
 * Video domain service.
 *
 * SI-03.2 scope: basic persistence helpers (`create`, `findByPublicId`).
 * Upload, processing, streaming and CRUD behaviour are layered on in
 * SI-03.3 → SI-03.6.
 */
@Injectable()
export class VideosService {
  constructor(private readonly videosRepository: VideosRepository) {}

  /** Persist a new video row. */
  async create(data: Partial<Video>): Promise<Video> {
    const video = this.videosRepository.create({
      public_id: data.public_id ?? generatePublicId(),
      ...data,
    });
    return this.videosRepository.save(video);
  }

  /** Load a video by its public id, or null when absent. */
  async findByPublicId(publicId: string): Promise<Video | null> {
    return this.videosRepository.findByPublicId(publicId);
  }
}
