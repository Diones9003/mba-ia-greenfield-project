import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { VIDEO_PROCESSING_QUEUE } from './video-processing.constants';
import { VideoProcessingProducer } from './video-processing.producer';

/**
 * Video Processing Queue Module (BullMQ + Redis).
 * Registers the video-processing queue and provides the producer service.
 * Consumer lives in the worker app (src/worker/).
 */
@Module({
  imports: [
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
  ],
  providers: [VideoProcessingProducer],
  exports: [VideoProcessingProducer],
})
export class VideoProcessingModule {}
