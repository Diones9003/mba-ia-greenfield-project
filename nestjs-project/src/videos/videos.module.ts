import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { Video } from './entities/video.entity';
import { VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Video]), ChannelsModule],
  providers: [VideosRepository, VideosService],
  exports: [TypeOrmModule, VideosRepository, VideosService],
})
export class VideosModule {}
