import type { Config } from "./config.js";
import { LocalBackupStore, S3BackupStore, type BackupStore } from "./backup.js";
import { s3ClientFromConfig } from "./photos.js";

export interface BackupStorage {
  store: BackupStore;
  kind: "s3" | "local";
}

/**
 * Where backups go. In production they MUST go to the bucket: the container's disk is erased at every
 * redeploy, so a "local" backup there would silently vanish. A local directory is allowed in development,
 * or in production only when BACKUP_ALLOW_LOCAL=1 (e.g. a persistent volume is mounted on BACKUP_DIR).
 * Returns null when no safe storage is configured.
 */
export function createBackupStorage(config: Config): BackupStorage | null {
  if (config.S3_BUCKET) return { kind: "s3", store: new S3BackupStore(s3ClientFromConfig(config), config.S3_BUCKET) };
  if (config.NODE_ENV === "production" && config.BACKUP_ALLOW_LOCAL !== "1") return null;
  return { kind: "local", store: new LocalBackupStore(config.BACKUP_DIR) };
}
