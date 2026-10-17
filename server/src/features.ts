import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import type { SseHub } from "./hub.js";
import { setBudgetEnabled } from "./budget.js";

export interface FamilyFeatures { multiLists: boolean; budget: boolean }

export async function familyFeatures(db: Pick<Db, "query">, familyId: string): Promise<FamilyFeatures> {
  const f = (await db.query("SELECT multi_lists_enabled, budget_enabled FROM families WHERE id = $1", [familyId])).rows[0];
  return { multiLists: !!f?.multi_lists_enabled, budget: !!f?.budget_enabled };
}

/**
 * Paramètres avancés de la famille : désactivés par défaut, modifiables par ses administrateurs, synchronisés entre ses membres.
 * Désactiver masque une fonction sans effacer ses données. « Plusieurs listes actives » ne peut être désactivée tant que plusieurs
 * listes restent en cours : rien n'est fusionné ni supprimé automatiquement. « Gestion du budget » : voir budget.ts.
 */
export function featureRoutes(app: FastifyInstance, { db, guard, hub }: { db: Db; guard: Guard; hub: SseHub }): void {
  app.get("/api/family/features", { preHandler: guard() }, async (req) => ({ features: await familyFeatures(db, req.auth!.familyId) }));

  app.put("/api/family/features", { preHandler: guard("family.manage") }, async (req) => {
    const b = z.object({ multiLists: z.boolean().optional(), budget: z.boolean().optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional() }).strict().parse(req.body ?? {});
    const a = req.auth!;
    await withTx(db, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('lists-active-' || $1::text))", [a.familyId]);
      if (b.multiLists === false) {
        const n = Number((await c.query("SELECT count(*) AS n FROM lists WHERE family_id = $1 AND status = 'active'", [a.familyId])).rows[0].n);
        if (n > 1) throw new HttpError(409, "multiple_active_lists", `${n} listes sont en cours : terminez-en ${n - 1} avant de désactiver l'option. Rien n'est fusionné ni supprimé automatiquement.`);
      }
      if (b.multiLists !== undefined)
        await c.query("UPDATE families SET multi_lists_enabled = $2, features_updated_at = now(), features_updated_by = $3 WHERE id = $1", [a.familyId, b.multiLists, a.profileId]);
      // Gestion du budget : la première activation exige la devise confirmée ; désactiver masque le module sans effacer ses données.
      if (b.budget !== undefined) await setBudgetEnabled(c, a, b.budget, b.currency);
    });
    hub.broadcast(a.familyId, "prefs.updated", {});
    return { features: await familyFeatures(db, a.familyId) };
  });
}
