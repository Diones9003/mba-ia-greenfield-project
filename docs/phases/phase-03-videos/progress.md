# phase-03-videos — Progress

**Status:** completed
**SIs:** 6/6 completed

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
- **Status:** completed (2026-08-24; env/Dockerfile aligned 2026-08-26)
- **Tests:** `npm test -- video-processing` — processor unit (success, retry-without-ERROR, final onFailed → ERROR)
- **Observations:** Worker Compose env uses the same keys as the API (`DB_*`, `STORAGE_*`, `REDIS_*`) — no `DATABASE_*`/`S3_*` aliases. `Dockerfile.worker` is multi-stage (build from source + ffmpeg runtime) so the worker starts from `docker compose up` without a pre-built `dist/` on the host. `WorkerModule` validates env with the shared Joi schema. `FfmpegService` uses `FFMPEG_PATH`/`FFPROBE_PATH`. Thumbnail key is `{channelId}/{publicId}/thumb.jpg`. Status `error` is written only on the final BullMQ attempt (`@OnWorkerEvent('failed')`).

### SI-03.5 — Streaming and Download (Presigned GET, native Range/206) (TD-07)
- **Status:** completed (2026-08-24; public access aligned 2026-08-26)
- **Tests:** `videos-streaming.e2e-spec.ts` — 302 without auth for READY; 409 `VIDEO_NOT_READY` for draft; 404 unknown
- **Observations:** `GET /videos/:publicId/stream` and `download` are `@Public()`. 302 to a presigned GET (MinIO handles Range/206). Non-ready videos return 409, not 404.

### SI-03.6 — Complementary REST: Retrieve, List, Update, Delete
- **Status:** completed (2026-08-24; listing route + abort-on-delete aligned 2026-08-26)
- **Tests:** unit (stream/download/get/list/delete-abort) + e2e (`GET /videos/:id` 409, `GET /channels/:id/videos`, PATCH, DELETE 204)
- **Observations:** `GET /videos/:publicId` is public and 409 when not ready. `GET /channels/:channelId/videos` lives on `ChannelVideosController` (anonymous = ready only; owner sees every status via optional JWT). DELETE aborts in-flight multipart uploads. `CLAUDE.md` / `AGENTS.md` updated to match the code.
