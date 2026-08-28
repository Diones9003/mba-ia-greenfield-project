import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { VideoStatus } from './video-status.enum';

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** URL-safe public identifier (nanoid) — TD-06. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, unique: true })
  public_id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    enumName: 'video_status',
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  /** Owning channel (FK → channels.id). */
  @Index()
  @Column({ type: 'uuid' })
  channel_id: string;

  /** Object key of the source video in storage. */
  @Column({ type: 'varchar', nullable: true })
  storage_key: string | null;

  /** Object key of the generated thumbnail (set by worker). */
  @Column({ type: 'varchar', nullable: true })
  thumbnail_key: string | null;

  /** Extracted by ffprobe (set by worker). */
  @Column({ type: 'int', nullable: true })
  duration_seconds: number | null;

  /** Declared source size in bytes — bigint supports > 2GB / up to 10GB. */
  @Column({ type: 'bigint', nullable: true })
  file_size_bytes: string | null;

  @Column({ type: 'varchar', nullable: true })
  mime_type: string | null;

  @Column({ type: 'varchar', nullable: true })
  original_filename: string | null;

  /** Human-readable processing error message when status = error. */
  @Column({ type: 'varchar', nullable: true })
  processing_error: string | null;

  /** Summarized ffprobe format/streams output. */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  /** S3 multipart UploadId; set while draft, cleared on complete. */
  @Column({ type: 'varchar', nullable: true })
  upload_id: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
