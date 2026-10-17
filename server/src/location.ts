import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canonicalCity } from "./cities.js";
import { isCountry, pricesAvailable } from "./countries.js";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import type { SseHub } from "./hub.js";

export interface FamilyLocation {
  country: string | null;
  city: string | null;
  confirmed: boolean;
  /** Prix indicatifs du catalogue (Maroc, ou pays non encore confirmé : comportement inchangé). */
  pricesAvailable: boolean;
  /** Préremplissage proposé à un administrateur quand le pays n'est pas confirmé : seulement depuis une ville reconnue. */
  suggestion: { country: string; city: string } | null;
}

export async function familyLocation(db: Pick<Db, "query">, familyId: string, withSuggestion: boolean): Promise<FamilyLocation> {
  const f = (await db.query("SELECT country, city, location_confirmed_at FROM families WHERE id = $1", [familyId])).rows[0] ?? {};
  const confirmed = !!f.location_confirmed_at;
  let suggestion: FamilyLocation["suggestion"] = null;
  if (!confirmed && withSuggestion) {
    // Ville de l'administrateur principal, puis de l'administrateur le plus ancien : seulement si elle figure dans la liste reconnue.
    const r = await db.query(
      "SELECT city FROM profiles WHERE family_id = $1 AND role = 'admin' AND active AND city IS NOT NULL ORDER BY is_primary DESC, created_at LIMIT 1",
      [familyId],
    );
    const known = r.rows[0]?.city ? canonicalCity(r.rows[0].city as string) : null;
    if (known) suggestion = { country: "MA", city: known };
  }
  return { country: f.country ?? null, city: f.city ?? null, confirmed, pricesAvailable: pricesAvailable(f.country), suggestion };
}

/** Ville servant aux prix communautaires : celle de la famille (Maroc confirmé), sinon celle du profil (comportement antérieur). */
export async function priceCity(db: Pick<Db, "query">, familyId: string, profileId: string): Promise<string | null> {
  const f = (await db.query("SELECT country, city FROM families WHERE id = $1", [familyId])).rows[0];
  if (f?.country && f.country !== "MA") return null;
  if (f?.city) return f.city as string;
  return ((await db.query("SELECT city FROM profiles WHERE id = $1", [profileId])).rows[0]?.city as string | null) ?? null;
}

export function locationRoutes(app: FastifyInstance, deps: { db: Db; guard: Guard; hub: SseHub; resolveCity: (c: string) => string }): void {
  const { db, guard, hub } = deps;
  app.get("/api/family/location", { preHandler: guard() }, async (req) => ({ location: await familyLocation(db, req.auth!.familyId, req.auth!.role === "admin") }));

  // Confirmer ou changer le pays et la ville de la famille (administrateurs). Ne touche ni aux prix familiaux ni à l'historique.
  app.put("/api/family/location", { preHandler: guard("family.manage") }, async (req) => {
    const b = z.object({ country: z.string().trim().toUpperCase(), city: z.string().trim().max(60).optional() }).parse(req.body ?? {});
    if (!isCountry(b.country)) throw new HttpError(400, "invalid_country", "Choisissez un pays dans la liste");
    const city = b.country === "MA" ? deps.resolveCity(b.city ?? "") : null;
    await db.query("UPDATE families SET country = $2, city = $3, location_confirmed_at = now() WHERE id = $1", [req.auth!.familyId, b.country, city]);
    // Les membres sans ville suivent la ville de la famille (aucune ville déjà choisie n'est écrasée).
    if (city) await db.query("UPDATE profiles SET city = $2 WHERE family_id = $1 AND city IS NULL", [req.auth!.familyId, city]);
    await db.query("UPDATE families SET catalog_rev = catalog_rev + 1 WHERE id = $1", [req.auth!.familyId]); // les prix affichés changent
    hub.broadcast(req.auth!.familyId, "prefs.updated", {});
    hub.broadcast(req.auth!.familyId, "catalog.updated", {});
    return { location: await familyLocation(db, req.auth!.familyId, true) };
  });
}
