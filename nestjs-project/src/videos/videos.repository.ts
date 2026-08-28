import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { Video } from './entities/video.entity';

/**
 * Repository pattern wrapper for the Video aggregate.
 *
 * Services depend on this class instead of touching TypeORM's
 * `Repository`/`EntityManager` directly, per project conventions.
 */
@Injectable()
export class VideosRepository {
  constructor(
    @InjectRepository(Video)
    private readonly repo: Repository<Video>,
  ) {}

  create(data: DeepPartial<Video>): Video {
    return this.repo.create(data);
  }

  save(video: Video): Promise<Video> {
    return this.repo.save(video);
  }

  findByPublicId(publicId: string): Promise<Video | null> {
    return this.repo.findOne({ where: { public_id: publicId } });
  }

  /** Load a video by public id together with its owning channel. */
  findByPublicIdWithChannel(publicId: string): Promise<Video | null> {
    return this.repo.findOne({
      where: { public_id: publicId },
      relations: ['channel'],
    });
  }

  findById(id: string): Promise<Video | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Channel videos ordered newest-first (optionally filtered by status). */
  findByChannel(channelId: string, onlyReadyStatus?: string): Promise<Video[]> {
    const qb = this.repo
      .createQueryBuilder('video')
      .where('video.channel_id = :channelId', { channelId });

    if (onlyReadyStatus) {
      qb.andWhere('video.status = :status', { status: onlyReadyStatus });
    }

    return qb.orderBy('video.created_at', 'DESC').getMany();
  }

  async remove(video: Video): Promise<void> {
    await this.repo.remove(video);
  }
}
