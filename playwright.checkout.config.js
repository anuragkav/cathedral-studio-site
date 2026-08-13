const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test/e2e",
  testMatch: "checkout.spec.js",
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: "npx http-server -p 4194 -c-1 .",
    port: 4194,
    reuseExistingServer: false
  },
  use: {
    baseURL: "http://localhost:4194"
  }
});
