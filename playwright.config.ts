import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:4321',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'pnpm dev',
        url: 'http://localhost:4321',
        reuseExistingServer: !process.env.CI,
        env: {
            MOCK_DB: 'true',
            POSTGRES_URL: 'postgresql://user:password@host.com/dbname',
            ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
            SESSION_SECRET: 'e2e-session-secret-e2e-session-secret',
            SUPERADMIN_EMAIL: 'boss@example.org',
            PUBLIC_FIREBASE_API_KEY: 'e2e',
            PUBLIC_FIREBASE_AUTH_DOMAIN: 'e2e.firebaseapp.com',
            PUBLIC_FIREBASE_PROJECT_ID: 'e2e',
        },
    },
});
