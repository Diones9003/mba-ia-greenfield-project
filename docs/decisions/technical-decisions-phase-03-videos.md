---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-08-24
scope_description: "Backend foundation for video upload and processing: object storage, background job queue, large-file (10GB) upload protocol, FFmpeg worker architecture, video metadata/thumbnail extraction, unique video URLs, HTTP streaming, and the video status lifecycle."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers all Phase 03 capabilities: the `Video` domain (entity, module, controller, service), object-storage integration, the message queue + processing worker (FFmpeg/ffprobe), the large-file upload protocol, unique-URL generation, streaming/download endpoints, and the video status lifecycle.
- `next-frontend/` — Frontend deferred: the upload UI, video player, and channel dashboard that consume these endpoints are scheduled for later phases (Fase 04 — Gerenciamento de Vídeos e Canal, Fase 05 — Página de Visualização). Cross-layer TDs below (upload protocol, streaming) define the contract the frontend will consume, but no frontend code is written in this phase.

> **Infrastructure note:** Phase 03 introduces three new containers to `nestjs-project/compose.yaml` — an object storage service, a message-queue backing store, and a video-processing worker — plus the FFmpeg/ffprobe binaries. All new services are addressed by their Docker Compose service name (per the monorepo `CLAUDE.md` Docker Networking rule), and all new env vars are validated by the Joi schema in `src/config/env.validation.ts` with `registerAs` namespaces (inherited convention from Fase 01).

---

## TD-01: Message Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram (`software-arch.mermaid`) marks the Message Queue as **TBD**: the API publishes a job when a video finishes uploading, and the Video Worker consumes it to run FFmpeg processing. The queue must survive restarts, support retry with backoff, expose a dead-letter mechanism for permanently failed jobs, and be simple to run in Docker Compose. This decision determines whether a new infrastructure dependency (Redis) is added to the stack.

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- Redis-backed job queue. `@nestjs/bullmq` 11.x is the official NestJS wrapper (supports NestJS 11 + BullMQ v6), exposing `@Processor`/`@Process` decorators, `BullModule.registerQueue()`, and DI-injected `Queue` producers. Atomic state transitions via Redis Lua scripts.
- **Pros:** De-facto standard for background jobs in the Node/NestJS ecosystem — first-class `@nestjs/bullmq` integration, decorator-based workers, DI producers. Built-in retries with exponential backoff, rate limiting, delayed jobs, job flows (parent/child), and a mature ecosystem (Bull Board UI for observability). Failed jobs move to a "failed" set that serves as a dead-letter store. High throughput.
- **Cons:** Requires **Redis** as a new infrastructure container — one more service to run, monitor, and persist (AOF/RDB). Job state lives outside PostgreSQL, so job status and business data are not in the same transactional boundary. Slightly more moving parts for a single-instance dev stack.

### Option B: pg-boss (PostgreSQL-backed)
- Job queue built on PostgreSQL using `SKIP LOCKED` for safe concurrent consumption. Reuses the database already in the stack — no Redis.
- **Pros:** Zero new infrastructure — uses the existing PostgreSQL 17 container. ACID-compliant job state alongside business data (a job enqueue can share a transaction with the `videos` row insert). Native dead-letter queue, singleton jobs, retries, and scheduling. Low operational overhead.
- **Cons:** No official NestJS wrapper — integration is a hand-written provider/module. Lower ecosystem familiarity and fewer ready-made examples than BullMQ. Weaker job-flow orchestration and no polished UI (observability is SQL queries). Polling-based consumption adds latency vs Redis push (irrelevant for video jobs, where FFmpeg dominates the timeline).

### Option C: RabbitMQ (`@nestjs/microservices` or `amqplib`)
- Dedicated AMQP message broker. NestJS can integrate via its microservices transport or a raw `amqplib` client.
- **Pros:** Purpose-built broker with rich routing (exchanges, bindings), durable queues, native dead-letter exchanges, and strong delivery guarantees. Scales to multi-consumer, multi-service topologies.
- **Cons:** Heaviest operational footprint of the three (broker + management plane). Overkill for a single-app monolith with one job type. NestJS's AMQP story is oriented at microservice RPC, not at a durable background-job abstraction with retries/backoff — more glue code to get job-queue semantics. Steeper learning curve.

### Option D: AWS SQS
- Managed cloud queue.
- **Pros:** Fully managed, no infra to run, effectively infinite scale, native dead-letter queues.
- **Cons:** External cloud dependency — breaks the "everything in Docker Compose" local-dev principle (requires LocalStack or a real AWS account for dev). Vendor lock-in. No visibility timeout / long-poll ergonomics tuned for a self-hosted greenfield study project. Contradicts the self-hosted posture chosen for storage (TD-02).

**Recommendation:** **Option A (BullMQ + Redis)** — For a video platform whose whole point is heavy background processing, BullMQ is the ecosystem standard with the only first-party NestJS module (`@nestjs/bullmq`), giving decorator-based workers, retries/backoff, and a dead-letter set out of the box. The cost is one Redis container, which is trivial to add to Compose and is a common companion service the project will likely reuse (caching, rate-limit store) in later phases. pg-boss's "no new infra" appeal is real, but the lack of an official NestJS wrapper and weaker tooling make it the riskier choice for the project's most processing-centric phase.

**Decision:** A (BullMQ + Redis)

**Libraries:** `@nestjs/bullmq@^11.x`, `bullmq@^5.x` (or v6), `redis:7-alpine` (Compose service)

---

## TD-02: Object Storage Backend & Client SDK

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The architecture diagram specifies **Object Storage (S3 or MinIO)** for video files and thumbnails. Phase 03 must pick the concrete backend for local development and the client SDK used by both the API (uploads, presigned URLs) and the worker (read source, write thumbnail). The choice must preserve the "everything runs in Docker Compose" principle and keep a clean path to real S3 in production.

**Options:**

### Option A: MinIO (self-hosted, S3-compatible) + AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)
- MinIO runs as a Compose container exposing an S3-compatible API. The application talks to it through the standard AWS SDK v3, pointed at the MinIO `endpoint`. In production, only the endpoint/credentials change to target real S3.
- **Pros:** Full dev/prod parity with a single code path — same SDK against MinIO locally and S3 in prod. AWS SDK v3 is modular (import only S3), supports multipart upload commands and presigned URLs (via `s3-request-presigner`), and honors `Range` requests. No vendor lock-in at the code level (S3 API is the contract). MinIO is a single lightweight container.
- **Cons:** Occasional signing/compatibility quirks between AWS SDK v3 and MinIO (region/endpoint/`forcePathStyle` must be configured correctly; historical custom-metadata presign issues). AWS SDK dependency tree is larger than a minimal client.

### Option B: MinIO + official MinIO JS client (`minio`)
- Same MinIO container, but using MinIO's purpose-built Node client.
- **Pros:** Purpose-built for MinIO — simpler API for presigned URLs (`presignedPutObject`/`presignedGetObject`) and fewer signing surprises against MinIO. Smaller dependency footprint than the full AWS SDK.
- **Cons:** Couples application code to the MinIO client API; migrating to real AWS S3 in production means swapping the client (the `minio` package targets MinIO/S3 but is not the canonical AWS SDK). Slightly less idiomatic if the team later adopts other AWS services.

### Option C: Local filesystem (bind-mounted volume)
- Store videos/thumbnails on a mounted disk path; serve via the API.
- **Pros:** Zero extra service; simplest possible dev setup.
- **Cons:** Diverges from the architecture diagram (no object storage). No presigned-URL offload — every byte flows through the API (kills the "10GB without impacting performance" goal, TD-03). No clean production story (would require rewrite to S3). Rejected as it defeats the phase's core non-functional requirements.

**Recommendation:** **Option A (MinIO + AWS SDK v3)** — MinIO gives an S3-compatible object store that runs as one Compose container, matching the diagram and keeping storage self-hosted (consistent with the queue decision). Using the standard AWS SDK v3 (not the MinIO-specific client) means the exact same code path works against real S3 in production by changing only endpoint/credentials — the best long-term parity. The known MinIO/SDK signing quirks are configuration details (`forcePathStyle: true`, explicit `region`/`endpoint`), not blockers.

**Decision:** A (MinIO + AWS SDK v3)

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`, `minio/minio` (Compose service)

---

## TD-03: Large-File (10GB) Upload Strategy

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** The plan requires uploading files up to **10GB** "sem impacto na performance" and, per §4 Pontos de Atenção, in a way that "permita retomar em caso de falha de conexão" (resumable). Routing 10GB through the NestJS process is a known anti-pattern (RAM spikes, event-loop pressure, crashes). This is a cross-layer contract: it defines the handshake the future upload client must follow. On upload initiation, the API pre-registers the video as a `draft` row and returns the identifiers needed to upload directly to storage.

**Options:**

### Option A: Presigned Multipart Upload — direct client → storage (API orchestrates)
- The API only orchestrates: (1) `POST /videos` pre-registers a `draft` and calls `CreateMultipartUpload` on storage; (2) the client requests a presigned URL per part and `PUT`s each chunk **directly to MinIO/S3**; (3) the client posts the collected `ETag`s back and the API calls `CompleteMultipartUpload`. File bytes never traverse the API.
- **Pros:** Bytes bypass the API entirely — no RAM/CPU/event-loop impact, fully satisfying "sem impacto na performance". Native resumability/retry at the part level (re-`PUT` only the failed chunk). Parallel part uploads maximize throughput. `AbortMultipartUpload` cleans up cancelled uploads. Directly matches the S3 multipart model exposed by MinIO (TD-02).
- **Cons:** Most complex handshake — several endpoints (initiate, sign-part, complete, abort) and client-side chunking/ETag tracking. Presigned-URL expiry and part-size policy must be defined. Orphan-part cleanup job needed.

### Option B: Streaming Multipart through the API (`Busboy`/stream to storage)
- The client uploads to the API; the API streams the request body chunk-by-chunk straight into storage without buffering the whole file.
- **Pros:** Simpler client (a single `multipart/form-data` request). Streaming (not buffering) keeps memory bounded. API can enforce validation/auth inline on the stream.
- **Cons:** Every byte still flows through the API — 10GB per upload saturates the API's network and ties up a connection/worker for the entire transfer, which does impact performance and scalability under concurrency. No native resumability — a dropped connection restarts the whole 10GB. Contradicts the diagram's "API → Storage (Uploads)" being an orchestration, not a data pipe.

### Option C: tus resumable upload protocol (`@tus/server`)
- Open protocol for resumable uploads over HTTP `PATCH`, with a tus server component storing to the backend.
- **Pros:** Best-in-class resumability (offset-based resume, standardized). Good client libraries.
- **Cons:** Introduces a whole new protocol/server component and its own storage-adapter wiring — extra dependency and operational surface. Data still typically passes through the tus server (unless S3 store is used, which re-adds multipart complexity anyway). Heavier than needed given MinIO's native multipart already provides resumability via presigned parts.

**Recommendation:** **Option A (Presigned Multipart, direct-to-storage)** — It is the only option that fully honors both hard requirements: 10GB with zero API data-path impact, and connection-failure resumability (per-part retry). It leverages the S3 multipart API that MinIO already exposes (TD-02), so no new protocol/component is needed. The extra endpoints are a well-understood, bounded cost; part size (~50–100MB) and presigned-URL TTL become explicit policy values. The `draft` pre-registration (`POST /videos`) is the natural "initiate" step.

**Decision:** A (Presigned Multipart Upload, direct client → storage)

**Libraries:** (reuses TD-02 `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — no new dependency)

---

## TD-04: Video Processing Worker Architecture

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** After `CompleteMultipartUpload`, the API publishes a job (TD-01) to process the video: extract duration/metadata (ffprobe) and generate a thumbnail from a frame (ffmpeg), then update the DB. FFmpeg is CPU/IO-heavy and must not block the API's event loop or HTTP request handling. This decision is where the BullMQ consumer runs and how it is isolated from the API.

**Options:**

### Option A: Separate NestJS worker container (dedicated BullMQ processor)
- A second container built from the same codebase, started with a worker entrypoint (e.g., a Nest application context that registers only the BullMQ `@Processor`). It shares entities/services via DI but runs no HTTP server. FFmpeg/ffprobe binaries are installed in this image.
- **Pros:** Strong isolation — FFmpeg CPU load cannot degrade API latency; the API image need not even ship FFmpeg. Independently scalable (run N worker replicas without scaling the API). Reuses the NestJS DI container, config, TypeORM repositories, and storage client — no code duplication. Clear ownership boundary matching the diagram's separate "Video Worker" container. Testable in isolation.
- **Cons:** A second service in Compose and a second process to build/run. Slightly more config (shared env, separate command/entrypoint). Two images or one image with two entrypoints to maintain.

### Option B: In-process BullMQ processor inside the API container
- The `@Processor` runs in the same Node process as the API HTTP server.
- **Pros:** Simplest setup — one container, one process, no extra Compose service. Fastest to bootstrap.
- **Cons:** FFmpeg competes with HTTP handling for the same CPU/event loop — heavy transcoding spikes directly hurt API responsiveness (worker threads help but don't fully isolate). Cannot scale workers independently of the API. API image must bundle FFmpeg. Contradicts the diagram's separate worker container. Poor fit for the phase's whole premise ("processamento pesado em segundo plano, sem bloquear o usuário").

### Option C: Standalone pure Node.js worker (no NestJS)
- A plain Node script consuming the BullMQ queue, calling FFmpeg and writing to DB/storage with standalone clients.
- **Pros:** Minimal runtime footprint; no Nest bootstrap overhead.
- **Cons:** Loses DI, config namespaces, TypeORM entity/repository reuse, and the domain services — forces duplicating DB access, config parsing, and storage logic. Divergent code style from the rest of the backend. Higher maintenance and drift risk. Not worth the marginal startup savings.

**Recommendation:** **Option A (Separate NestJS worker container)** — It matches the C4 diagram's dedicated Video Worker, isolates FFmpeg CPU load from API latency, scales independently, and — crucially — reuses the existing NestJS DI, config (`registerAs`), TypeORM repositories, and storage client with no duplication (one codebase, worker entrypoint). The only cost is a second Compose service sharing the same image, which is the standard NestJS pattern for background workers.

**Decision:** A (Separate NestJS worker container, shared codebase, BullMQ processor)

**Libraries:** (reuses `@nestjs/bullmq` from TD-01; FFmpeg/ffprobe binaries installed in the worker image — invocation approach in TD-05)

---

## TD-05: FFmpeg / ffprobe Invocation Approach

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker (TD-04) must run `ffprobe` to read duration/metadata (as JSON) and `ffmpeg` to extract a single frame as a thumbnail. Historically `fluent-ffmpeg` was the go-to Node wrapper, but it was **archived / deprecated on 2025-05-22** and no longer supports current FFmpeg versions. This decision picks how the worker invokes the binaries.

**Options:**

### Option A: `fluent-ffmpeg` wrapper
- High-level fluent API over the FFmpeg CLI.
- **Pros:** Ergonomic chained API; lots of legacy examples.
- **Cons:** **Officially archived/unmaintained since 2025-05-22**, does not support recent FFmpeg, no more fixes/security updates. Adopting a dead dependency in a greenfield 2026 project is an unjustifiable risk. Rejected.

### Option B: Direct binary invocation via Node `child_process` (`execFile`/`spawn`)
- Call `ffprobe`/`ffmpeg` binaries directly. `ffprobe -v quiet -print_format json -show_format -show_streams` returns machine-readable metadata; `ffmpeg -ss <t> -i <in> -frames:v 1 <out>.jpg` extracts a thumbnail frame.
- **Pros:** Zero extra dependencies (built-in module). Full control over flags and lifecycle. No wrapper to fall out of maintenance. Deterministic, easy to unit-test by mocking the exec call. FFmpeg version is controlled by the worker image, not an npm wrapper.
- **Cons:** Manual argument construction, exit-code/stderr handling, and JSON parsing. Slightly more boilerplate than a fluent API.

### Option C: `execa` (modern child_process wrapper)
- Promise-based, ergonomic wrapper over `child_process` with better error/stderr capture and stream handling.
- **Pros:** Cleaner async/await ergonomics than raw `child_process`; stderr auto-attached to errors (great for debugging FFmpeg failures); still invokes the real binaries (no FFmpeg-specific abstraction to rot). Actively maintained.
- **Cons:** One extra (small) dependency. ESM-oriented — recent majors are ESM-only, which needs a compatible import strategy in the NestJS/CommonJS build (a pinned version or dynamic import).

**Recommendation:** **Option B (direct `child_process`)** — With `fluent-ffmpeg` dead, invoking the binaries directly is the most robust, dependency-free choice; ffprobe's JSON output and a one-frame ffmpeg command are simple, well-documented invocations. `execa` (Option C) is a fine ergonomic upgrade, but its ESM-only recent versions add build friction in the CommonJS NestJS project for marginal benefit. Binary paths are pinned via the worker image (`FFMPEG_PATH`/`FFPROBE_PATH` if needed).

**Decision:** B (Direct binary invocation via Node `child_process`)

**Libraries:** none (Node built-in `child_process`); `ffmpeg` + `ffprobe` binaries installed in the worker Docker image

---

## TD-06: Unique Video URL Identifier

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a unique, URL-friendly public identifier that "nunca conflite com outro vídeo" and yields a short, clean route (YouTube-style, e.g., `/watch/<id>`). This is distinct from the internal primary key: the public identifier appears in URLs, so legibility and index behavior both matter. The decision must weigh collision safety, readability, and index performance.

**Options:**

### Option A: UUID v4 (random)
- 128-bit random UUID, e.g., `crypto.randomUUID()`, stored in a native `uuid` column.
- **Pros:** Native PostgreSQL `uuid` type (16 bytes), astronomically low collision probability, no dependency. Ubiquitous and standard.
- **Cons:** 36-char hyphenated string is long and unfriendly in a public URL. Random ordering causes B-tree index fragmentation / page splits on high-volume inserts (a known write-amplification cost at scale).

### Option B: nanoid (short, URL-safe public id)
- Cryptographically strong, URL-safe id (default 21 chars, `A–Za–z0–9_-`), configurable length. Stored in a dedicated indexed `public_id` column alongside the internal PK.
- **Pros:** Compact and clean in URLs (YouTube-like). URL-safe alphabet — no encoding needed. 21 chars gives ~126 bits of entropy (collision risk negligible); length is tunable. Decouples the public identifier from the DB primary key.
- **Cons:** Small dependency (`nanoid`). Not time-sortable (irrelevant for a lookup-by-id column). Shortening below ~12 chars would require collision-retry logic (avoided by keeping a safe length). Stored as text/`varchar` with a unique index.

### Option C: ULID
- 26-char Crockford-Base32, lexicographically sortable, timestamp-prefixed.
- **Pros:** Sortable (append-friendly index), readable, URL-safe, no hyphens.
- **Cons:** Longer than nanoid (26 vs configurable ~12–21). Timestamp prefix leaks creation time and makes ids partially guessable/enumerable in order — undesirable for public video URLs. Extra dependency. Sortability benefit applies to PKs, not a public lookup column.

### Option D: Auto-increment integer / slug
- Sequential integer or a title-derived slug.
- **Pros:** Tiny, human-readable (slug), trivial index (int).
- **Cons:** Sequential ints are enumerable (scrape all videos, leak total count) — a privacy/abuse problem for a public platform. Title slugs collide and change when titles are edited, breaking the "never conflicts" and stable-URL guarantees. Rejected.

**Recommendation:** **Option B (nanoid `public_id`, PK stays a UUID)** — For a public, YouTube-style URL the identifier must be short, URL-safe, non-enumerable, and collision-safe; nanoid at a safe length (~12–21 chars) delivers all four, while the internal primary key remains a standard PostgreSQL `uuid` (consistent with existing entities). This cleanly separates "internal PK" from "public URL id" — the recommended pattern (UUID/UUID v7 for PKs, nanoid for public URLs). ULID's sortability helps PKs, not a public lookup column, and its timestamp prefix is an enumeration leak.

**Decision:** B (nanoid for the public video URL id; internal PK remains `uuid`)

**Libraries:** `nanoid@^3.x` (CommonJS-compatible 3.x line for the NestJS build)

---

## TD-07: Video Streaming Strategy

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Playback must start without downloading the whole file, i.e., support HTTP `Range` requests (`206 Partial Content`) so the HTML5 `<video>` element can seek and buffer incrementally. The diagram already models this as **Frontend → Object Storage ("Streams", HTTPS)** — a direct edge, not through the API. Download is the same object fetched as an attachment. This is a cross-layer contract (the player's behavior depends on how bytes are served).

**Options:**

### Option A: Presigned GET URL — client streams directly from storage (Range handled by MinIO/S3)
- The API issues a short-lived presigned GET URL for the video object; the browser points the `<video>` `src` at it. MinIO/S3 natively honors `Range` and returns `206`/`Accept-Ranges: bytes`. Download uses a presigned URL with `response-content-disposition: attachment`.
- **Pros:** Exactly matches the diagram's direct Frontend→Storage streaming edge. Zero streaming load on the API — storage serves bytes and handles Range/206/416 natively. Scales effortlessly (storage/CDN does the heavy lifting). Presigned expiry provides access control. HTML5 `<video>` seeking works out of the box.
- **Cons:** Presigned URLs are time-limited and, once issued, grant direct object access until expiry (mitigated by short TTL). Fine-grained per-request authorization (e.g., revoking mid-stream) is weaker than an API proxy. URL points at the storage endpoint (must be reachable by the browser in prod, e.g., via a public MinIO/S3/CDN host).

### Option B: Proxy streaming through the API (API reads storage, forwards Range)
- The browser hits an API endpoint; the API validates auth, reads from storage with the incoming `Range`, and pipes back `206` responses.
- **Pros:** Full per-request authorization control (every byte range is gated by the API). Storage stays private (never exposed to the browser). Central place for logging/metrics.
- **Cons:** Every streamed byte flows through the API — high bandwidth/connection cost, poor scalability for large videos and many concurrent viewers (the exact anti-pattern the phase avoids for uploads). Contradicts the diagram's direct streaming edge. More code to correctly implement Range/206/416 forwarding.

### Option C: Redirect to a presigned URL (`302`)
- The API endpoint validates auth then `302`-redirects to a freshly presigned GET URL.
- **Pros:** Keeps a stable, API-owned URL while still offloading byte transfer to storage; auth check happens at redirect time. Combines A's scalability with an API-controlled entry point.
- **Cons:** Some HTML5 players/CDNs handle redirects on media `src` inconsistently for range requests (extra round-trip; occasional caching quirks). Slightly more complex than a plain presigned URL.

**Recommendation:** **Option A (presigned GET, direct-from-storage streaming)** — It is the literal realization of the architecture diagram's Frontend→Storage "Streams" edge, offloads all byte transfer and Range/`206` handling to MinIO/S3 (native), and scales without loading the API — mirroring the direct-to-storage philosophy chosen for uploads (TD-03). Short-lived presigned URLs provide adequate access control for this phase; a `302`-redirect variant (Option C) can be layered later if a stable API-owned URL is desired, without changing the storage model. Download reuses the same presigned mechanism with a `Content-Disposition: attachment` override.

**Decision:** A (Presigned GET URL — direct client ↔ storage streaming with native Range/206; download via presigned URL with attachment disposition)

**Libraries:** (reuses TD-02 `@aws-sdk/s3-request-presigner` — no new dependency)

---

## TD-08: Video Status Lifecycle

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** A video moves through distinct states from upload initiation to being watchable. The lifecycle must be an explicit, persisted enum on the `Video` entity so the API, worker, and (future) frontend agree on what a video can do at each point, and so processing failures are represented and retryable. This defines the state machine and the transitions the worker (TD-04) drives.

**Options:**

### Option A: Four-state machine — `draft → processing → ready | error`
- `draft`: row pre-registered on upload initiation (TD-03), file not yet fully uploaded/processed. `processing`: `CompleteMultipartUpload` done, job enqueued/running (ffprobe + thumbnail). `ready`: metadata + thumbnail persisted, video playable. `error`: processing failed after exhausting retries. Transitions: `draft→processing` (on upload complete + job publish), `processing→ready` (job success), `processing→error` (job permanently failed). Retry: BullMQ retries with exponential backoff (e.g., 3 attempts) while status stays `processing`; only after the last attempt fails does the worker set `error`. An `error` video can be re-submitted, moving it back to `processing`.
- **Pros:** Matches the plan's exact wording (rascunho → processamento → pronto/erro). Minimal, unambiguous states; each maps to a clear capability. Plays naturally with BullMQ retry/backoff and dead-letter (final failure ⇒ `error`). Easy to gate endpoints (only `ready` is publicly streamable; `draft`/`error` are owner-only).
- **Cons:** Coarser than a granular pipeline — a stuck upload (initiated but never completed) sits in `draft` and needs a janitor to expire orphans. No separate "uploading" vs "queued" distinction.

### Option B: Granular pipeline states — `draft → uploading → uploaded → queued → processing → ready | failed`
- Adds intermediate states for finer observability.
- **Pros:** Fine-grained progress/telemetry; can show precise stage in a dashboard.
- **Cons:** Over-engineered for Phase 03 — several states carry no distinct business rule and multiply transition/validation logic and tests. YAGNI; can be added later if the dashboard needs it. Higher risk of inconsistent transitions.

### Option C: Boolean flags (`is_processed`, `has_error`)
- Represent state via independent booleans instead of a single enum.
- **Pros:** Trivial columns.
- **Cons:** Booleans encode illegal combinations (`is_processed && has_error`), have no single source of truth for "current state", and make transition validation and querying awkward. An enum is the correct modeling tool. Rejected.

**Recommendation:** **Option A (`draft → processing → ready | error`)** — It is exactly the lifecycle the plan describes, models cleanly as a single persisted enum column with a small, well-defined transition set, and dovetails with BullMQ's retry/backoff/dead-letter (final failure ⇒ `error`, retryable back to `processing`). Public streaming (TD-07) is gated on `ready`. Orphaned `draft` uploads are handled by a TTL/cleanup job (aligned with `AbortMultipartUpload` from TD-03). Granular states (Option B) are deferred until a management dashboard (Fase 04) justifies them.

**Decision:** A (`draft → processing → ready | error`, single enum, BullMQ-driven retries with final `error` state)

**Libraries:** (none — enum on the `Video` entity; retry policy via `@nestjs/bullmq` from TD-01)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Backend | Message Queue Technology | BullMQ + Redis | A (BullMQ + Redis) |
| TD-02 | Backend | Object Storage Backend & Client SDK | MinIO + AWS SDK v3 | A (MinIO + AWS SDK v3) |
| TD-03 | Cross-layer | Large-File (10GB) Upload Strategy | Presigned Multipart, direct-to-storage | A (Presigned Multipart Upload) |
| TD-04 | Backend | Video Processing Worker Architecture | Separate NestJS worker container | A (Separate NestJS worker container) |
| TD-05 | Backend | FFmpeg / ffprobe Invocation Approach | Direct `child_process` | B (Direct binary invocation via `child_process`) |
| TD-06 | Backend | Unique Video URL Identifier | nanoid public id (PK stays uuid) | B (nanoid) |
| TD-07 | Cross-layer | Video Streaming Strategy | Presigned GET, direct-from-storage | A (Presigned GET URL, native Range/206) |
| TD-08 | Backend | Video Status Lifecycle | `draft → processing → ready \| error` | A (four-state enum) |

---

## New Dependencies

| Package / Service | Version | Purpose | Introduced by |
|-------------------|---------|---------|---------------|
| `@nestjs/bullmq` | `^11.x` | Official NestJS wrapper for BullMQ (queue producers + `@Processor` workers) | TD-01 |
| `bullmq` | `^5.x` | Redis-backed job queue engine | TD-01 |
| `redis` (Compose service) | `7-alpine` | Backing store for BullMQ | TD-01 |
| `@aws-sdk/client-s3` | `^3.x` | S3-compatible object storage client (uploads, multipart, GET) | TD-02, TD-03, TD-07 |
| `@aws-sdk/s3-request-presigner` | `^3.x` | Presigned URL generation (upload parts, streaming, download) | TD-02, TD-03, TD-07 |
| `minio` (Compose service) | latest stable image | Self-hosted S3-compatible object storage | TD-02 |
| `nanoid` | `^3.x` | Short, URL-safe public video identifier | TD-06 |
| FFmpeg + ffprobe (binaries) | distro package in worker image | Metadata extraction + thumbnail generation | TD-04, TD-05 |

_No new npm dependency for TD-05 (Node built-in `child_process`) or TD-08 (entity enum)._

---

## Notes for downstream pipeline

- **New containers** to add to `nestjs-project/compose.yaml`: `redis` (TD-01), `minio` (TD-02), and a `nestjs-worker` service built from the same image with a worker entrypoint and FFmpeg/ffprobe installed (TD-04/TD-05). All referenced by Compose service name (never `localhost`), per monorepo `CLAUDE.md`.
- **New config namespaces** (`registerAs`, validated in `src/config/env.validation.ts` via Joi, `.env.example` updated): storage (`STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_FORCE_PATH_STYLE`), queue/redis (`REDIS_HOST`, `REDIS_PORT`), upload policy (part size, presign TTL, max size 10GB), and optionally `FFMPEG_PATH`/`FFPROBE_PATH`.
- **New domain:** a `videos` module (entity + migration, controller, service) with `status` enum (TD-08), internal `uuid` PK, and unique `public_id` (nanoid, TD-06). Migrations are mandatory (`synchronize: false`, inherited from Fase 01).
- **Cross-layer TDs (TD-03, TD-07)** define the contract the frontend upload/player will consume in Fase 04/05; the OpenAPI artifact (`openapi.json`) must document the presign/complete/stream endpoints for the future frontend.
- **Testing:** unit (`*.spec.ts`) for URL generation, status transitions, and ffprobe/ffmpeg command builders (mocked `child_process`); integration (`*.integration-spec.ts`, `--runInBand`) for the videos repository/migrations and BullMQ job round-trips; e2e (`test/*.e2e-spec.ts`) for the upload-initiation, complete, and streaming/download endpoints. Definition of Done per `CLAUDE.md`: `tsc --noEmit` clean + lint + full suite green.
