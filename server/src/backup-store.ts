import type { Config } from "./config.js";
import { LocalBackupStore, S3BackupStore, type BackupStore } from "./backup.js";
import { s3ClientFromConfig } from "./photos.js";

/** Backups go to the bucket when one is configured (survives the app's volume), else to a local directory. */
export function createBackupStore(config: Config): BackupStore {
  return config.S3_BUCKET ? new S3BackupStore(s3ClientFromConfig(config), config.S3_BUCKET) : new LocalBackupStore(config.BACKUP_DIR);
}
