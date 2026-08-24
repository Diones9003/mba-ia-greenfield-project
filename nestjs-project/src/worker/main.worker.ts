import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Bootstrap the video worker application.
 * This runs in a separate container (nestjs-worker) with FFmpeg installed.
 * No HTTP server — only BullMQ consumer listening for video processing jobs.
 */
async function bootstrap() {
  const app = await NestFactory.create(WorkerModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  await app.init();
  console.log('🎬 Video Worker started and listening for jobs...');
}

bootstrap().catch((err) => {
  console.error('❌ Video Worker failed to start:', err);
  process.exit(1);
});
