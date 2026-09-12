import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.schema.js';

/**
 * S3-compatible object storage. MinIO locally, R2 or S3 in production — the
 * only difference is configuration, which is why PLAN §13.3 can stay open
 * without blocking anything.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  /** Talks to storage directly: uploads and deletes. */
  private readonly client: S3Client;
  /**
   * Signs download URLs only, and never connects. When storage sits behind a
   * reverse proxy — MinIO reached internally at `http://minio:9000` but served
   * to browsers at `https://host/pdfly-files` — a URL must be *signed* for the
   * public host or the proxy's MinIO rejects the SigV4 signature (it validates
   * against the Host header it receives). Presigning is offline crypto, so this
   * client resolving the public name is never required.
   */
  private readonly presignClient: S3Client;
  private readonly bucket: string;
  private readonly urlTtl: number;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.urlTtl = config.get('DOWNLOAD_URL_TTL_SECONDS', { infer: true });

    const common = {
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      },
    };

    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    // Falls back to the internal endpoint, so single-endpoint deployments
    // (dev, direct-to-R2) behave exactly as before.
    const publicEndpoint = config.get('S3_PUBLIC_ENDPOINT', { infer: true }) || endpoint;

    this.client = new S3Client({ ...common, endpoint });
    this.presignClient = new S3Client({ ...common, endpoint: publicEndpoint });
  }

  /** Layout from PLAN §3.5. */
  buildKey(orgId: string, documentId: string): string {
    return `org/${orgId}/${documentId}.pdf`;
  }

  async putPdf(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/pdf',
      }),
    );

    this.logger.debug(`stored ${key} (${body.byteLength} bytes)`);
  }

  /**
   * Deleting an object that is already gone is a success, not an error: S3
   * DELETE is idempotent, and a retried deletion must not fail the caller.
   */
  async deletePdf(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));

    this.logger.debug(`deleted ${key}`);
  }

  /**
   * Short-lived signed URL. Buckets are never public (PLAN §11), so this is
   * the only way a client reaches an object.
   */
  signedDownloadUrl(key: string, filename?: string): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
      }),
      { expiresIn: this.urlTtl },
    );
  }
}
