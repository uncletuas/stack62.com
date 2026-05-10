/**
 * Pluggable object storage. The same code path serves both the local
 * disk (for dev / docker-compose) and any S3-compatible backend (AWS
 * S3, Cloudflare R2, MinIO).
 *
 * Implementations: LocalDiskBackend, S3Backend (in this folder).
 * Factory:        provideStorageBackend() — picks based on STORAGE_BACKEND env.
 */

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  /** Optional cache-control header for CDNs / browsers. */
  cacheControl?: string;
  /** Optional checksum we can verify on read later. */
  checksum?: string;
}

export interface PutObjectResult {
  /** Backend-specific identifier (etag for S3, hash for local). */
  etag: string;
  /** Bytes actually stored. */
  size: number;
}

export interface StorageBackend {
  /** Friendly name for logs/metrics. */
  readonly name: string;

  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  getObjectBuffer(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  /** True when the backend persists across redeploys / multi-instance. */
  isDurable(): boolean;
  /**
   * Optional. Returns a time-limited signed URL when the backend supports
   * it, null otherwise. Lets the API hand the browser an S3 URL directly
   * for download without proxying bytes.
   */
  generateSignedDownloadUrl?(
    key: string,
    expiresInSeconds: number,
  ): Promise<string | null>;
}
