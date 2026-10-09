import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Pixel 7"],
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] },
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node ../e2e/reset-db.mjs && node dist/index.js",
    cwd: "../server",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: "test",
      DATABASE_URL: "postgres://smart:smart@localhost:5432/smartcourse_e2e",
      PHOTO_DIR: "/tmp/smartcourse-e2e-photos",
      WEB_DIR: "../web/dist",
      SCRYPT_N: "1024",
    },
  },
});
