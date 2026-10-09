import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://smart:smart@localhost:5432/smartcourse_test",
      NODE_ENV: "test",
      SCRYPT_N: "1024",
    },
  },
});
