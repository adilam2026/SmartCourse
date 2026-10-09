// Fresh empty database for every E2E run (the server migrates it on startup).
import pg from "pg";
const admin = new pg.Client({ connectionString: "postgres://smart:smart@localhost:5432/postgres" });
await admin.connect();
await admin.query("DROP DATABASE IF EXISTS smartcourse_e2e WITH (FORCE)");
await admin.query("CREATE DATABASE smartcourse_e2e");
await admin.end();
