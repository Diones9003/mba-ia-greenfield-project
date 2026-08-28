import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import storageConfig from '../config/storage.config';

/** A single multipart part, as returned by S3/MinIO after a part upload. */
export interface UploadedPart {
  ETag: string;
  PartNumber: number;
}

/**
 * S3-compatible object storage gateway (MinIO in dev/prod parity — TD-02).
 *
 * Wraps a single `S3Client` configured with `forcePathStyle: true` so the
 * bucket is addressed as a path segment (required by MinIO). Presigned URLs
 * are built with the browser-reachable `publicEndpoint` so clients upload and
 * download bytes directly to storage — file bytes never traverse the API.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  /** Separate client bound to the public endpoint used for presigned URLs. */
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly cfg: ConfigType<typeof storageConfig>,
  ) {
    const credentials = {
      accessKeyId: cfg.accessKey,
      secretAccessKey: cfg.secretKey,
    };
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials,
      forcePathStyle: cfg.forcePathStyle,
    });
    this.presignClient = new S3Client({
      region: cfg.region,
      endpoint: cfg.publicEndpoint,
      credentials,
      forcePathStyle: cfg.forcePathStyle,
    });
    this.bucket = cfg.bucket;
  }

  /** Start a multipart upload; returns the S3 `UploadId`. */
  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<{ uploadId: string }> {
    const res = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!res.UploadId) {
      throw new Error('Storage did not return an UploadId');
    }
    return { uploadId: res.UploadId };
  }

  /** Presign an `UploadPart` PUT URL for a direct client upload. */
  async getPresignedUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    ttlSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  /** Assemble the object from the client-collected parts. */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts].sort((a, b) => a.PartNumber - b.PartNumber),
        },
      }),
    );
  }

  /** Abort an in-flight multipart upload, discarding staged parts. */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  /** Presign a GET URL, optionally forcing an attachment download disposition. */
  async getPresignedGetUrl(
    key: string,
    ttlSeconds: number,
    opts?: { disposition?: string },
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(opts?.disposition
          ? { ResponseContentDisposition: opts.disposition }
          : {}),
      }),
      { expiresIn: ttlSeconds },
    );
  }

  /** Upload an object directly (used by the worker for thumbnails). */
  async putObject(
    key: string,
    body: Buffer | Uint8Array | Readable,
    contentType?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
    );
  }

  /** Fetch an object body as a readable stream (used by the worker). */
  async getObjectStream(key: string): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return res.Body as Readable;
  }

  /** Delete an object; a missing object is treated as success. */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
