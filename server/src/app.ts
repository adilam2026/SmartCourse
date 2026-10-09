import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "./db.js";

export interface AppDeps {
  db: Db;
}

export function buildApp({ db }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true });

  app.get("/health", async (_req, reply) => {
    try {
      await db.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "db_unavailable" });
    }
  });

  return app;
}
