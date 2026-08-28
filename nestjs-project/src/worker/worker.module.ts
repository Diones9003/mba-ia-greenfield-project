import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import queueConfig from '../config/queue.config';
import uploadConfig from '../config/upload.config';
import { envValidationSchema } from '../config/env.validation';
import { Video } from '../videos/entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { VideosRepository } from '../videos/videos.repository';
import { StorageModule } from '../storage/storage.module';
import { VideoProcessingProcessor } from './video-processing.processor';
import { FfmpegService } from './ffmpeg/ffmpeg.service';
import { VIDEO_PROCESSING_QUEUE } from '../videos/queue/video-processing.constants';

/**
 * Worker application module (runs in nestjs-worker container).
 * - No HTTP server, no controllers
 * - Only BullMQ consumer + TypeORM + Storage
 * - Processes video jobs emitted by the main API
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, storageConfig, queueConfig, uploadConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.name'),
        // Video → Channel → User: TypeORM exige o grafo completo de relações.
        entities: [Video, Channel, User],
        synchronize: false, // Never auto-sync in production
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Video]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('queue.redisHost'),
          port: configService.get<number>('queue.redisPort'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: VIDEO_PROCESSING_QUEUE,
    }),
    StorageModule,
  ],
  providers: [VideosRepository, VideoProcessingProcessor, FfmpegService],
})
export class WorkerModule {}
