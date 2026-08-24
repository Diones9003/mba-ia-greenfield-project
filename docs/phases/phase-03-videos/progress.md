# phase-03-videos — Progress

**Status:** in progress
**SIs:** 4/6 completed

### SI-03.1 — Infrastructure: Storage, Queue, and Worker (Docker Compose, Config Namespaces, Dependencies)
- **Status:** completed (2026-08-24)
- **Tests:** env.validation.integration-spec — 7 passed (storage/queue/upload defaults + required key rejection); full baseline suite 147 passed
- **Observations:** Added `redis` (7-alpine, AOF), `minio` + one-shot `minio-setup` (creates `videos` bucket), and `nestjs-worker` services to compose.yaml; all addressed by service name (never localhost). Created `storage`/`queue`/`upload` config namespaces via `registerAs`, extended Joi schema (STORAGE_ACCESS_KEY/SECRET_KEY required), updated `.env.example`. Installed deps: @nestjs/bullmq, bullmq@5.x, ioredis@5.x, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, nanoid@3.x.

### SI-03.2 — Video Entity, Migration, and VideosModule
- **Status:** completed (2026-08-24)
- **Tests:** src/videos suite — 21 passed (public-id util, Video entity persistence, VideosRepository CRUD/queries, VideosService create/find, VideosModule wiring)
- **Observations:** Created `Video` entity (`@Entity('videos')`) with `video_status` enum (draft/processing/ready/error), `public_id` (nanoid 12, unique+indexed), `channel_id` FK to channels (ON DELETE CASCADE, indexed), nullable storage/processing columns, `file_size_bytes` bigint (typed `string | null` in TS), `metadata` jsonb. Added `generatePublicId()` util, `VideosRepository` wrapper (no direct EntityManager in services), basic `VideosService` (create/findByPublicId). Registered `VideosModule` (imports ChannelsModule). Migration `1787610093430-CreateVideos` generated and applied (enum + table + unique/index/FK).

### SI-03.3 — Upload Initiation: Draft Pre-Registration and Presigned Multipart (TD-03)
- **Status:** completed (3/6)
- **Tests:** `npm test` (unit+integration) — 30 suites / 181 tests green; e2e — 4 suites / 56 tests green; `tsc --noEmit` clean; lint clean on new sources. Full suite re-run twice on a dirty DB to confirm isolation/idempotency.
- **Observations:** Implemented `StorageService` (S3/MinIO multipart: create/presign part URL/complete/abort, presigned GET, put/get/delete) with a separate presign client on the public endpoint. Added `StorageModule`. Extended `VideosService` with `initiateUpload` (ownership + file-size guards, unique `public_id` retry with abort-on-collision, draft pre-registration with `upload_id`), `getPartUploadUrl`, and `completeUpload` (status guards → `processing`). Added `InitiateUploadDto`, `CompleteUploadDto`, `VideoResponseDto`. Added `VideosController` (`POST /videos`, `POST /videos/:publicId/parts/:partNumber/url`, `POST /videos/:publicId/complete`) behind JWT with `@CurrentUser()`. Added domain exceptions (VIDEO_NOT_FOUND, NOT_VIDEO_OWNER, FILE_TOO_LARGE, UPLOAD_NOT_INITIATED, UPLOAD_ALREADY_COMPLETED, INVALID_STATUS_TRANSITION). Hardened shared-DB test isolation: video integration specs now clean via `cleanAllTables` + delete `videos` in `afterAll`; migrations spec drops sequentially (no deadlock).

### SI-03.4 — Background Processing: BullMQ Queue, Worker Entrypoint, ffprobe + ffmpeg (TD-01/04/05/08)
- **Status:** completed (2026-08-24)
- **Tests:** `npm test -- video-processing` — 2 suites / 7 tests green (VideoProcessingProducer unit, VideoProcessingProcessor unit with mocked ffmpeg/storage/fs); `tsc --noEmit` clean; lint clean
- **Observations:** Created BullMQ queue infrastructure: `video-processing.constants.ts` (queue/job names + `ProcessVideoJobData` interface), `video-processing.producer.ts` (adds jobs with 3-attempt exponential backoff retry policy), `video-processing.module.ts` (registers BullMQ with Redis config). Integrated producer into `VideosService.completeUpload` to emit job after status→PROCESSING. Created isolated worker app in `src/worker/`: `FfmpegService` (child_process wrappers for ffprobe metadata extraction + ffmpeg thumbnail generation), `VideoProcessingProcessor` (BullMQ @Processor consuming jobs: downloads video from storage→/tmp, extracts metadata, generates thumbnail at 10% duration or 5s, uploads thumbnail to storage, updates Video entity with status=READY/duration/thumbnailKey/metadata, cleanup temp files, error handling with status=ERROR + processingError). Created `WorkerModule` (TypeORM + BullMQ consumer + StorageModule, no HTTP server) and `main.worker.ts` bootstrap. Created `Dockerfile.worker` (node:20-alpine + ffmpeg via apk). Updated `compose.yaml`: nestjs-worker service with Dockerfile.worker build, DATABASE_*/S3_*/REDIS_* env vars using service names. All error handling uses type-safe `getErrorMessage`/`getErrorStack` helpers.

### SI-03.5 — Streaming and Download (Presigned GET, native Range/206) (TD-07)
- **Status:** pending
- **Tests:** —
- **Observations:** —

### SI-03.6 — Complementary REST: Retrieve, List, Update, Delete
- **Status:** pending
- **Tests:** —
- **Observations:** —
