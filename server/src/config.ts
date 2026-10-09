import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  INSTALL_TOKEN: z.string().min(16).optional(),
  PORT: z.coerce.number().int().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
