import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { operatorResetSecret } from "./profiles.js";
import { generateInstallToken } from "./auth.js";

const [cmd, ...args] = process.argv.slice(2);
const db = createPool(loadConfig().DATABASE_URL);
await migrate(db);
try {
  if (cmd === "reset" && args.length === 2) {
    const code = await operatorResetSecret(db, args[0]!.toUpperCase(), args[1]!.toLowerCase());
    console.log(`Nouveau code pour ${args[1]} : ${code}\n(sessions révoquées, opération journalisée)`);
  } else if (cmd === "token") {
    console.log(`Jeton d'installation (à usage unique) : ${await generateInstallToken(db)}`);
  } else {
    console.log("Usage :\n  admin-cli reset <CODE_FAMILLE> <identifiant>\n  admin-cli token");
    process.exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
