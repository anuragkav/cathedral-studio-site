// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  workers: 4,
  webServer: {
    command: "npx http-server -p 4173 -c-1 .",
    port: 4173,
    reuseExistingServer: false
  },
  use: {
    baseURL: "http://localhost:4173"
  }
});
