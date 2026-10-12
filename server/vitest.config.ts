import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://smart:smart@localhost:5432/smartcourse_test",
      NODE_ENV: "test",
      SCRYPT_N: "1024",
      SC_LEGACY_SETUP: "1", // les tests d anciennes règles créent des familles sans e-mail ; les tests d installation exigent l e-mail explicitement
      SC_CITY_OPTIONAL: "1", // les tests antérieurs créent des profils sans ville ; les tests de la règle l exigent explicitement
    },
  },
});
