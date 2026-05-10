import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import {
  PutObjectInput,
  PutObjectResult,
  StorageBackend,
} from './storage-backend.interface';

/**
 * S3-compatible backend. Reads its credentials from env so the same code
 * works against AWS S3, Cloudflare R2, or any other S3 implementation.
 *
 * Required env (when STORAGE_BACKEND=s3):
 *   - AWS_REGION              (e.g. us-east-1)
 *   - AWS_S3_BUCKET           (e.g. stack62-files-prod)
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 * Optional:
 *   - AWS_S3_ENDPOINT         (set when using R2 / MinIO; omit for AWS)
 *   - AWS_S3_FORCE_PATH_STYLE ("true" for MinIO)
 */
@Injectable()
export class S3Backend implements StorageBackend {
  readonly name = 's3';
  private readonly logger = new Logger(S3Backend.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION');
    const bucket = this.configService.get<string>('AWS_S3_BUCKET');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );
    const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');
    const forcePathStyle =
      this.configService.get<string>('AWS_S3_FORCE_PATH_STYLE') === 'true';

    if (!region || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'STORAGE_BACKEND=s3 requires AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.',
      );
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle,
    });
  }

  isDurable(): boolean {
    return true;
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
      Metadata: input.checksum ? { checksum: input.checksum } : undefined,
    });
    const response = await this.client.send(command);
    return {
      etag: (response.ETag || '').replace(/"/g, ''),
      size: input.body.length,
    };
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.client.send(command);
    if (!response.Body) {
      throw new Error(`S3 object ${key} returned no body`);
    }
    return streamToBuffer(response.Body as Readable);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async generateSignedDownloadUrl(
    key: string,
    expiresInSeconds: number,
  ): Promise<string | null> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
