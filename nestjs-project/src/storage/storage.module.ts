import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

/**
 * Object-storage module — provides the shared {@link StorageService} gateway.
 * `ConfigModule.forFeature(storageConfig)` makes the `storage` namespace
 * injectable without relying on global registration order.
 */
@Module({
  imports: [ConfigModule.forFeature(storageConfig)],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
