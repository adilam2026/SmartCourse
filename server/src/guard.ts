import type { FastifyRequest } from "fastify";
import { authenticate, type AuthContext } from "./auth.js";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";
import { can, type Action } from "./permissions.js";

export const COOKIE = "sc_session";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** Rejects with 401 if there is no valid session, 403 if the role lacks `action`. Identity always comes from the session. */
export const makeGuard = (db: Db) => (action?: Action) => async (req: FastifyRequest) => {
  const auth = await authenticate(db, req.cookies[COOKIE]);
  if (!auth) throw new HttpError(401, "unauthenticated", "Connexion requise");
  if (action && !can(auth.role, action)) throw new HttpError(403, "forbidden", "Action non autorisée");
  req.auth = auth;
};

export type Guard = ReturnType<typeof makeGuard>;
