import { loadConfig } from "./config.js";
import { createPoolFromConfig } from "./db.js";
import { hardenApiRoles } from "./harden.js";
import { migrate } from "./migrate.js";
import { operatorResetSecret } from "./profiles.js";
import { generateInstallToken } from "./auth.js";
import { countFamilyData, findFamilyByCode, purgeFamily } from "./family-purge.js";
import { createBackupStorage } from "./backup-store.js";
import { createPhotoStore } from "./photos.js";

const [cmd, ...args] = process.argv.slice(2);
const db = createPoolFromConfig(loadConfig());
await migrate(db);
await hardenApiRoles(db);
try {
  if (cmd === "reset" && args.length === 2) {
    const code = await operatorResetSecret(db, args[0]!.toUpperCase(), args[1]!.toLowerCase());
    console.log(`Nouveau code pour ${args[1]} : ${code}\n(sessions révoquées, opération journalisée)`);
  } else if (cmd === "token") {
    console.log(`Jeton d'installation (à usage unique) : ${await generateInstallToken(db)}`);
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
      console.log(`Nouveau jeton d'installation (usage unique, à noter maintenant) : ${r.installToken}`);
      const store = createBackupStorage(loadConfig());
      if (store) {
        const { listBackups } = await import("./backup.js");
        const all = await listBackups(store.store);
        console.log(`\nSauvegardes existantes contenant encore cette famille (copies complètes de la base, communes à toutes les familles : non modifiées) :`);
        for (const b of all) console.log(`  ${b.key}  (${b.at.toISOString()})`);
      } else console.log("\nAucun stockage de sauvegarde configuré ici : vérifiez les sauvegardes existantes dans Railway.");
    }
  } else {
    console.log("Usage :\n  admin-cli reset <CODE_FAMILLE> <identifiant>\n  admin-cli token\n  admin-cli purge-family <CODE_FAMILLE> [--execute --confirm <CODE_FAMILLE>]");
    process.exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
