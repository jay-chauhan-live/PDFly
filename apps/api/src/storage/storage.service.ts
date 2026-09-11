import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly urlTtl: number;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.urlTtl = config.get('DOWNLOAD_URL_TTL_SECONDS', { infer: true });

    this.client = new S3Client({
      region: config.get('S3_REGION', { infer: true }),
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
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
   * Short-lived signed URL. Buckets are never public (PLAN §11), so this is
   * the only way a client reaches an object.
   */
  signedDownloadUrl(key: string, filename?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
      }),
      { expiresIn: this.urlTtl },
    );
  }
}
