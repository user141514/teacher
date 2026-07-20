const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'frontend.spec.js',
  timeout: 20_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.js',
    env: {
      PORT: '4173',
      DEEPSEEK_API_KEY: 'test-only',
    },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
