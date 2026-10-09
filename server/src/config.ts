import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PHOTO_DIR: z.string().default("./data/photos"),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  WEB_DIR: z.string().default("../web/dist"),
  INSTALL_TOKEN: z.string().min(16).optional(),
  PORT: z.coerce.number().int().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
