import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PHOTO_DIR: z.string().default("./data/photos"),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /**
   * Root certificate of the managed PostgreSQL (e.g. the Supabase CA downloaded from its Database settings): PEM text, or
   * the path of a PEM file. When set, the connection is encrypted AND the server's certificate is verified.
   * Required for Supabase hosts (see assertSafeDatabaseUrl): a managed database is reached over the Internet.
   */
  DATABASE_SSL_CA: z.string().optional(),
  /**
   * "internal" (default): the app makes, restores-to-check and prunes its own backups on the same PostgreSQL server.
   * "external": backups are made by the scheduled job in .github/workflows/backup-externe.yml, restored into ANOTHER
   * server and recorded in this database; the app only displays their state. Switch ONLY after one external run succeeded.
   */
  BACKUP_MODE: z.enum(["internal", "external"]).default("internal"),
  /** Independent storage for backups (any S3-compatible service, e.g. Cloudflare R2 or Backblaze B2). Falls back to S3_*. */
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_ENDPOINT: z.string().optional(),
  BACKUP_S3_REGION: z.string().optional(),
  BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Administrative URL of the scratch PostgreSQL server where a backup is restored to be checked (default: DATABASE_URL). */
  VERIFY_DATABASE_URL: z.string().optional(),
  WEB_DIR: z.string().default("../web/dist"),
  /** Per-IP cap on unauthenticated routes (login, setup) per minute. */
  LOGIN_RATE_MAX: z.coerce.number().int().min(1).default(20),
  /** Passphrase that encrypts backups. Without it, scheduled backups are disabled. KEEP A COPY OUTSIDE RAILWAY: lost key = unreadable backups. */
  BACKUP_KEY: z.string().min(16).optional(),
  /** Set to "1" to accept a local directory for backups in production (only if it is a persistent volume). */
  BACKUP_ALLOW_LOCAL: z.string().optional(),
  BACKUP_DIR: z.string().default("./data/backups"),
  PHOTO_MANIFEST: z.string().default("./catalog-photos/manifest.json"),
  INSTALL_TOKEN: z.string().min(16).optional(),
  PORT: z.coerce.number().int().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
