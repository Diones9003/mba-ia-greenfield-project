import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import uploadConfig from '../config/upload.config';
import { Video } from './entities/video.entity';
import { VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ConfigModule.forFeature(uploadConfig),
    ChannelsModule,
    StorageModule,
  ],
  controllers: [VideosController],
  providers: [VideosRepository, VideosService],
  exports: [TypeOrmModule, VideosRepository, VideosService],
})
export class VideosModule {}
