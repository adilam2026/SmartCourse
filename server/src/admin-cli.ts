import { loadConfig } from "./config.js";
import { createPoolFromConfig } from "./db.js";
import { hardenApiRoles } from "./harden.js";
import { migrate } from "./migrate.js";
import { operatorResetSecret } from "./profiles.js";
import { generateInstallToken } from "./auth.js";
import { countFamilyData, findFamilyByCode, purgeFamily } from "./family-purge.js";
import { createBackupStorage } from "./backup-store.js";
import { createPhotoStore } from "./photos.js";
import { classify, parseCsv, reportMarkdown } from "./price-import.js";
import { readFileSync } from "node:fs";

const [cmd, ...args] = process.argv.slice(2);
const db = createPoolFromConfig(loadConfig());
await migrate(db);
await hardenApiRoles(db);
try {
  if (cmd === "reset" && args.length === 2) {
    const code = await operatorResetSecret(db, args[0]!.toUpperCase(), args[1]!.toLowerCase());
    console.log(`Nouveau code pour ${args[1]} : ${code}\n(sessions révoquées, opération journalisée)`);
  } else if (cmd === "token") {
    console.log(`Lien d'installation (usage unique) : <adresse de l'application>/#/install/${await generateInstallToken(db)}`);
  } else if (cmd === "purge-family" && args[0]) {
    // Suppression DÉFINITIVE d'une seule famille. Sans --execute : identification et décompte seulement.
    const code = args[0].toUpperCase();
    const fam = await findFamilyByCode(db, code);
    if (!fam) throw new Error(`Aucune famille avec le code ${code} : rien à faire.`);
    const counts = await countFamilyData(db, fam.id);
    console.log(`Famille : « ${fam.name} » (code ${fam.code}), créée le ${fam.createdAt}`);
    console.log(`Profils : ${fam.profiles.map((p) => `${p.login} (${p.role}${p.primary ? ", principal" : ""})`).join(", ")}`);
    console.log("À supprimer :", JSON.stringify(counts));
    const others = (await db.query("SELECT count(*)::int AS n FROM families WHERE id <> $1", [fam.id])).rows[0].n;
    console.log(`Autres familles (jamais touchées) : ${others}`);
    if (!args.includes("--execute")) {
      console.log(`\nSimulation seulement. Pour supprimer : admin-cli purge-family ${fam.code} --execute --confirm ${fam.code}`);
    } else {
      const ci = args.indexOf("--confirm");
      if (ci < 0 || args[ci + 1]?.toUpperCase() !== fam.code) throw new Error(`Confirmation manquante : ajoutez --confirm ${fam.code}`);
      const r = await purgeFamily(db, createPhotoStore(loadConfig()), fam.id, fam.code);
      console.log(`\nFamille supprimée. Fichiers photo retirés : ${r.photoFilesRemoved}. Autres familles intactes : ${r.otherFamiliesUntouched}.`);
      console.log(`Lien d'installation pour une nouvelle famille (usage unique) : <adresse de l'application>/#/install/${r.installToken}`);
      const store = createBackupStorage(loadConfig());
      if (store) {
        const { listBackups } = await import("./backup.js");
        const all = await listBackups(store.store);
        console.log(`\nSauvegardes existantes contenant encore cette famille (copies complètes de la base, communes à toutes les familles : non modifiées) :`);
        for (const b of all) console.log(`  ${b.key}  (${b.at.toISOString()})`);
      } else console.log("\nAucun stockage de sauvegarde configuré ici : vérifiez les sauvegardes existantes dans Railway.");
    }
  } else if (cmd === "quota-status" || cmd === "quota-activate" || cmd === "quota-deactivate") {
    // Listes gratuites par famille : activation et retour arrière EXPLICITES (sans --execute : état et simulation seulement).
    const { quotaStatus, quotaActivate, quotaDeactivate } = await import("./list-quota.js");
    const before = await quotaStatus(db);
    console.log("État :", JSON.stringify(before));
    if (cmd === "quota-activate") {
      if (!args.includes("--execute")) console.log(`Simulation : ${before.families - before.started} famille(s) recevraient maintenant leurs ${before.freeLists} créations gratuites (anciennes listes non comptées). Pour activer : admin-cli quota-activate --execute`);
      else {
        const note = args.includes("--note") ? args[args.indexOf("--note") + 1] : undefined;
        const r = await quotaActivate(db, note);
        console.log(`Règle activée. Familles démarrées maintenant : ${r.familiesStarted}.`);
      }
    } else if (cmd === "quota-deactivate") {
      if (!args.includes("--execute")) console.log("Simulation : la règle serait désactivée (aucun blocage ; compteurs et achats conservés). Pour désactiver : admin-cli quota-deactivate --execute");
      else { await quotaDeactivate(db); console.log("Règle désactivée : plus aucun blocage. Compteurs et achats conservés."); }
    }
  } else if (cmd === "family-exists" && args[0]) {
    const { familyIdFor } = await import("./family-id.js");
    process.exitCode = (await familyIdFor(db, args[0])) ? 0 : 2;
  } else if (cmd === "recette-operator-right" && args[0]) {
    // RECETTE SEULEMENT : droit « opérateur » (sans achat) pour la famille fictive des contrôles iPhone ↔ Android, afin que la règle
    // des listes gratuites, active sur la recette, ne bloque pas ces contrôles. Refusé hors d'un projet Railway « recette ».
    if (!/recette/i.test(process.env.RAILWAY_PROJECT_NAME ?? "")) throw new Error("Refus : commande réservée au service de recette.");
    const { familyIdFor } = await import("./family-id.js");
    const fid = await familyIdFor(db, args[0]);
    if (!fid) throw new Error(`Famille ${args[0]} introuvable.`);
    const r = await db.query(
      `INSERT INTO family_entitlements (family_id, platform, product_id, kind, purchase_key, status, environment)
       VALUES ($1, 'google', 'recette_operateur', 'lifetime', $2, 'active', 'sandbox') ON CONFLICT (platform, purchase_key) DO NOTHING RETURNING id`,
      [fid, `recette-operateur-${fid}`],
    );
    if (r.rows[0]) await db.query("INSERT INTO entitlement_events (entitlement_id, family_id, source, type) VALUES ($1, $2, 'operator', 'recette.operator_right')", [r.rows[0].id, fid]);
    console.log(r.rows[0] ? `Droit opérateur de recette accordé à ${args[0]}.` : `${args[0]} a déjà son droit opérateur de recette.`);
  } else if ((cmd === "prices-report" || cmd === "prices-import") && args[0]) {
    // Base initiale des prix : le tableau validé est contrôlé ligne par ligne (retenues / exclues + raison). Sans --execute : rien n'est écrit.
    const rows = parseCsv(readFileSync(args[0], "utf8"));
    const idx = new Map<string, "initial" | "extended">();
    for (const r of (await db.query("SELECT key FROM initial_catalog")).rows) idx.set(r.key, "initial");
    for (const r of (await db.query("SELECT key FROM extended_catalog WHERE merged_into IS NULL")).rows) idx.set(r.key, "extended");
    const res = classify(rows, idx);
    console.log(reportMarkdown(res));
    const kept = res.filter((r) => r.retained);
    if (cmd === "prices-import" && args.includes("--execute")) {
      const replace = args.includes("--replace");
      let inserted = 0;
      let skipped = 0;
      for (const r of kept) {
        const p = r.row!;
        const q = await db.query(
          `INSERT INTO base_prices (origin, key, amount, ref_qty, ref_unit, packaging, piece_weight_g, kind, source, observed_on, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (origin, key) ${replace ? "DO UPDATE SET amount = $3, ref_qty = $4, ref_unit = $5, packaging = $6, piece_weight_g = $7, kind = $8, source = $9, observed_on = $10, note = $11, imported_at = now()" : "DO NOTHING"}`,
          [p.origin, p.key, p.amount, p.refQty, p.refUnit, p.packaging, p.pieceWeightG, p.kind, p.source, p.observedOn, p.note],
        );
        if (q.rowCount) inserted++;
        else skipped++;
      }
      // Les prix personnalisés des familles ne sont jamais touchés ; les téléphones relisent le catalogue.
      await db.query("UPDATE families SET catalog_rev = catalog_rev + 1");
      await db.query("INSERT INTO audit_log (family_id, actor_profile_id, action, details) VALUES (NULL, NULL, 'prices.imported', $1)", [JSON.stringify({ inserted, skipped, excluded: res.length - kept.length })]);
      console.log(`Import : ${inserted} prix écrits, ${skipped} déjà présents (conservés${replace ? "" : ", utilisez --replace pour les remplacer"}), ${res.length - kept.length} lignes exclues. Aucun prix de famille modifié.`);
    } else console.log(`Simulation seulement : ${kept.length} lignes seraient importées. Pour écrire : admin-cli prices-import <fichier.csv> --execute`);
  } else {
    console.log("Usage :\n  admin-cli reset <CODE_FAMILLE> <identifiant>\n  admin-cli token\n  admin-cli purge-family <CODE_FAMILLE> [--execute --confirm <CODE_FAMILLE>]\n  admin-cli prices-report <tableau.csv>\n  admin-cli prices-import <tableau.csv> [--execute] [--replace]\n  admin-cli quota-status | quota-activate [--execute] | quota-deactivate [--execute]");
    process.exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
