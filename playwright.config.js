// @ts-check
const { defineConfig, devices } = require("@playwright/test");

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
  },
  // Chromium/Firefox device presets run their own engine; Playwright's
  // "iPhone"/"iPad"/"Desktop Safari" presets always run on WebKit (real
  // iOS/Safari only ever use WebKit) — keep a WebKit-free tablet project
  // too, so tablet-sized layout has coverage even where WebKit can't run.
  projects: [
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone SE"] } },
    { name: "tablet-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 810, height: 1080 } } },
    { name: "tablet-safari", use: { ...devices["iPad Mini"] } },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "desktop-safari", use: { ...devices["Desktop Safari"] } }
  ]
});
