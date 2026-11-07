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
  } else if (cmd === "recette-manager" && args[0]) {
    // RECETTE SEULEMENT : l'administrateur (adil) de la famille fictive indiquée devient gestionnaire, pour que les contrôles
    // automatiques puissent régler la mise à jour de l'application (/gestion/mise-a-jour). Refusé hors d'un projet « recette ».
    if (!/recette/i.test(process.env.RAILWAY_PROJECT_NAME ?? "")) throw new Error("Refus : commande réservée au service de recette.");
    const { familyIdFor } = await import("./family-id.js");
    const fid = await familyIdFor(db, args[0]);
    if (!fid) throw new Error(`Famille ${args[0]} introuvable.`);
    const r = await db.query("INSERT INTO catalog_managers (profile_id) SELECT id FROM profiles WHERE family_id = $1 AND login = 'adil' ON CONFLICT DO NOTHING", [fid]);
    console.log(`Recette : gestionnaire de mise à jour ${r.rowCount ? "ajouté" : "déjà présent"}.`);
  } else if (cmd === "update-status" || cmd === "update-disable") {
    // Mise à jour de l'application : état, et coupure de secours du blocage (sans la page de gestion) ; numéros conservés.
    const { readPolicy, disableRequired } = await import("./app-update.js");
    for (const p of ["android", "ios"] as const) {
      const r = await readPolicy(db, p);
      console.log(`${p} : dernière ${r?.latest_code ?? "—"}, minimale ${r?.min_code ?? "—"}, blocage ${r?.required_active ? "ACTIF" : "désactivé"}, système minimal ${r?.min_os ?? "—"}, fiche ${r?.store_url ? "renseignée" : "absente"}`);
    }
    if (cmd === "update-disable") {
      const which = args[0] === "android" || args[0] === "ios" ? [args[0]] : (["android", "ios"] as ("android" | "ios")[]);
      const n = await disableRequired(db, which as ("android" | "ios")[], "Blocage désactivé (admin-cli)");
      console.log(n ? `Blocage désactivé : ${which.join(", ")} (effet immédiat).` : "Aucun blocage actif.");
    }
  } else if (cmd === "platform-find" && args[0]) {
    // Retrouver le profil à autoriser : famille par l'e-mail (comparé côté serveur, jamais affiché), puis profil par le prénom
    // (--name, « adil » par défaut ; majuscules et accents ignorés). Ne propose une commande QUE s'il y a une seule famille et un
    // seul profil correspondant ; sinon, c'est au propriétaire de trancher. Le membre qui porte l'e-mail n'est jamais retenu
    // pour cette seule raison.
    const email = args[0].trim().toLowerCase();
    const want = ((args.includes("--name") ? args[args.indexOf("--name") + 1] : undefined) ?? "adil").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const norm = (x: string | null) => (x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const fams = (
      await db.query(
        `SELECT p.family_id FROM profiles p WHERE lower(p.recovery_email) = $1 AND p.deleted_at IS NULL
         UNION SELECT s.family_id FROM family_signups s WHERE lower(s.email) = $1 AND s.family_id IS NOT NULL`,
        [email],
      )
    ).rows;
    if (!fams.length) console.log("Aucune famille ne porte cet e-mail (récupération ou création de famille). Rien à proposer.");
    const proposals: { profile: string; family: string }[] = [];
    for (const f of fams) {
      console.log(`Famille (identifiant interne) : ${f.family_id}`);
      const ps = (
        await db.query(
          `SELECT id, display_name, login, role, is_primary, active, lower(coalesce(recovery_email, '')) = $2 AS has_email,
                  EXISTS (SELECT 1 FROM platform_admins a WHERE a.profile_id = p.id) AS platform
             FROM profiles p WHERE family_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
          [f.family_id, email],
        )
      ).rows;
      const candidates = ps.filter((p) => norm(p.display_name) === want || norm(p.login) === want);
      for (const p of ps)
        console.log(`  profil ${p.id} · ${p.display_name} (${p.login}) · ${p.role}${p.is_primary ? " · principal" : ""}${p.active ? "" : " · désactivé"}${p.has_email ? " · porte cet e-mail" : ""}${p.platform ? " · DROIT PLATEFORME" : ""}${candidates.includes(p) ? "  ← correspond au prénom" : ""}`);
      const emailHolder = ps.find((p) => p.has_email);
      if (emailHolder && !candidates.includes(emailHolder)) console.log(`  L'e-mail est porté par un autre membre (${emailHolder.display_name}) : ce membre ne reçoit PAS le droit.`);
      if (candidates.length === 1 && candidates[0].active) proposals.push({ profile: candidates[0].id, family: f.family_id });
      else if (candidates.length === 0) console.log(`  Aucun profil « ${want} » dans cette famille : à trancher par le propriétaire.`);
      else if (candidates.length > 1) console.log(`  ${candidates.length} profils correspondent au prénom : à trancher par le propriétaire (aucune commande proposée).`);
      else console.log("  Le profil correspondant est désactivé : à trancher par le propriétaire.");
    }
    if (fams.length > 1) console.log(`ATTENTION : ${fams.length} familles portent cet e-mail : à trancher par le propriétaire, aucune commande proposée.`);
    else if (proposals.length === 1) {
      const [pr] = proposals as [{ profile: string; family: string }];
      console.log(`Proposition (simulation d'abord, rien n'est encore attribué) :\n  admin-cli platform-grant ${pr.profile} --family ${pr.family}\nPuis, après vérification : la même commande avec --execute`);
    }
  } else if (cmd === "platform-status") {
    const r = (await db.query("SELECT a.profile_id, a.family_id, a.granted_at, p.display_name FROM platform_admins a JOIN profiles p ON p.id = a.profile_id ORDER BY a.granted_at")).rows;
    console.log(r.length ? r.map((x) => `profil ${x.profile_id} (${x.display_name}) · famille ${x.family_id} · depuis ${x.granted_at.toISOString()}`).join("\n") : "Aucun droit plateforme attribué.");
    const ex = (await db.query("SELECT family_id, reason FROM platform_excluded_families ORDER BY added_at")).rows;
    console.log(`Familles exclues des statistiques : ${ex.length}${ex.length ? " — " + ex.map((x) => `${x.family_id} (${x.reason})`).join(", ") : ""}`);
  } else if ((cmd === "platform-grant" || cmd === "platform-revoke") && args[0]) {
    // Droit plateforme : attribué à l'identifiant INTERNE du profil, lié à SA famille (vérifié en base).
    const profileId = args[0];
    if (!/^[0-9a-f-]{36}$/i.test(profileId)) throw new Error("Identifiant interne de profil attendu (voir platform-find)");
    const p = (await db.query("SELECT id, family_id, display_name, role, active, deleted_at FROM profiles WHERE id = $1", [profileId])).rows[0];
    if (!p) throw new Error("Profil introuvable.");
    const famArg = args.includes("--family") ? args[args.indexOf("--family") + 1] : null;
    if (cmd === "platform-grant" && famArg !== p.family_id) throw new Error("--family <identifiant interne de la famille> obligatoire et doit être celle du profil");
    const note = args.includes("--note") ? args[args.indexOf("--note") + 1] : null;
    console.log(`Profil ${p.id} · ${p.display_name} · ${p.role}${p.active && !p.deleted_at ? "" : " · INACTIF"} · famille ${p.family_id}`);
    if (!args.includes("--execute")) console.log(`Simulation : ${cmd === "platform-grant" ? "attribution" : "retrait"} du droit plateforme. Ajouter --execute pour appliquer.`);
    else {
      if (cmd === "platform-grant") {
        if (!p.active || p.deleted_at) throw new Error("Profil inactif : droit refusé.");
        await db.query("INSERT INTO platform_admins (profile_id, family_id, note) VALUES ($1,$2,$3) ON CONFLICT (profile_id) DO NOTHING", [p.id, p.family_id, note]);
      } else await db.query("DELETE FROM platform_admins WHERE profile_id = $1", [p.id]);
      await db.query("INSERT INTO platform_admins_history (profile_id, family_id, action, note) VALUES ($1,$2,$3,$4)", [p.id, p.family_id, cmd === "platform-grant" ? "grant" : "revoke", note]);
      console.log(cmd === "platform-grant" ? "Droit plateforme attribué." : "Droit plateforme retiré (effet immédiat sur toutes les routes).");
    }
  } else if ((cmd === "platform-exclude" || cmd === "platform-include") && args[0]) {
    const { familyIdFor } = await import("./family-id.js");
    const fid = /^[0-9a-f-]{36}$/i.test(args[0]) ? args[0] : await familyIdFor(db, args[0]);
    if (!fid) throw new Error("Famille introuvable.");
    const reason = args.includes("--reason") ? args[args.indexOf("--reason") + 1] : "demo";
    if (!args.includes("--execute")) console.log(`Simulation : ${cmd === "platform-exclude" ? `exclusion (${reason})` : "réintégration"} de la famille ${fid}. Ajouter --execute.`);
    else if (cmd === "platform-exclude") {
      await db.query("INSERT INTO platform_excluded_families (family_id, reason) VALUES ($1,$2) ON CONFLICT (family_id) DO UPDATE SET reason = $2", [fid, reason]);
      console.log("Famille exclue des statistiques et des photos manquantes.");
    } else {
      await db.query("DELETE FROM platform_excluded_families WHERE family_id = $1", [fid]);
      console.log("Famille réintégrée.");
    }
  } else if (cmd === "recette-platform-grant" && args[0]) {
    // RECETTE SEULEMENT : droit plateforme pour le profil FICTIF « adil » de la famille de recette indiquée.
    if (!/recette/i.test(process.env.RAILWAY_PROJECT_NAME ?? "")) throw new Error("Refus : commande réservée au service de recette.");
    const { familyIdFor } = await import("./family-id.js");
    const fid = await familyIdFor(db, args[0]);
    if (!fid) throw new Error(`Famille ${args[0]} introuvable.`);
    const r = await db.query(
      `INSERT INTO platform_admins (profile_id, family_id, note) SELECT id, family_id, 'recette' FROM profiles WHERE family_id = $1 AND login = 'adil' AND deleted_at IS NULL
       ON CONFLICT (profile_id) DO NOTHING RETURNING profile_id`,
      [fid],
    );
    if (r.rows[0]) await db.query("INSERT INTO platform_admins_history (profile_id, family_id, action, note) VALUES ($1,$2,'grant','recette')", [r.rows[0].profile_id, fid]);
    console.log(`Recette : droit plateforme ${r.rowCount ? "attribué" : "déjà présent"} (profil fictif).`);
  } else if (cmd === "purchases-status" || cmd === "purchases-open" || cmd === "purchases-close") {
    // Achats ouverts PAR PLATEFORME (sans --execute : état et simulation seulement). Une famille n'est bloquée par la règle des
    // listes gratuites que si un de ses administrateurs a un appareil d'une plateforme ouverte, en version suffisante.
    const { platformStates, setPlatform } = await import("./purchase-platforms.js");
    console.log("Plateformes :", JSON.stringify(await platformStates(db)));
    const seen = (await db.query("SELECT platform, version, count(*)::int AS profils FROM profile_clients GROUP BY 1,2 ORDER BY 1,2 DESC LIMIT 20")).rows;
    console.log("Versions vues (profils) :", JSON.stringify(seen));
    if (cmd !== "purchases-status") {
      const platform = args[0];
      if (platform !== "android" && platform !== "ios") throw new Error("Plateforme : android ou ios");
      const minArg = args.includes("--min-version") ? Number(args[args.indexOf("--min-version") + 1]) : null;
      if (cmd === "purchases-open" && !(minArg && minArg > 0)) throw new Error("--min-version <première version qui sait acheter> obligatoire");
      const note = args.includes("--note") ? args[args.indexOf("--note") + 1] : undefined;
      if (!args.includes("--execute")) console.log(`Simulation : ${cmd === "purchases-open" ? `ouverture ${platform} à partir de la version ${minArg}` : `fermeture ${platform}`}. Ajouter --execute pour appliquer.`);
      else {
        await setPlatform(db, platform, cmd === "purchases-open", minArg, note);
        console.log("Fait :", JSON.stringify(await platformStates(db)));
      }
    }
  } else if (cmd === "store-status" || cmd === "store-reconcile") {
    // Achats : état agrégé (aucun identifiant) ; rapprochement avec les stores (à planifier chaque jour, sans risque : relit les stores).
    const counts = (
      await db.query("SELECT platform, kind, status, environment, count(*)::int AS n FROM family_entitlements GROUP BY 1,2,3,4 ORDER BY 1,2,3,4")
    ).rows;
    console.log("Droits :", JSON.stringify(counts));
    const refused = (await db.query("SELECT type, count(*)::int AS n FROM entitlement_events WHERE source = 'refused' AND received_at > now() - interval '30 days' GROUP BY 1")).rows;
    console.log("Achats refusés (30 jours) :", JSON.stringify(refused));
    if (cmd === "store-reconcile") {
      const { StoreService, storesFromEnv } = await import("./store/service.js");
      const svc = new StoreService(db, undefined, storesFromEnv());
      if (!svc.google && !svc.apple) console.log("Aucun store configuré : rien à rapprocher.");
      else console.log("Rapprochement :", JSON.stringify(await svc.reconcile()));
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
    console.log("Usage :\n  admin-cli reset <CODE_FAMILLE> <identifiant>\n  admin-cli token\n  admin-cli purge-family <CODE_FAMILLE> [--execute --confirm <CODE_FAMILLE>]\n  admin-cli prices-report <tableau.csv>\n  admin-cli prices-import <tableau.csv> [--execute] [--replace]\n  admin-cli quota-status | quota-activate [--execute] | quota-deactivate [--execute]\n  admin-cli store-status | store-reconcile\n  admin-cli update-status | update-disable [android|ios]\n  admin-cli purchases-status | purchases-open <android|ios> --min-version N [--execute] | purchases-close <android|ios> [--execute]\n  admin-cli platform-find <e-mail> | platform-status | platform-grant <profil> --family <famille> [--execute] | platform-revoke <profil> [--execute] | platform-exclude|platform-include <famille> [--reason demo|verification|recette|interne] [--execute]");
    process.exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
