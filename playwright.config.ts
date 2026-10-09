import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4321);

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: `http://localhost:${port}`,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            testIgnore: /\/mobile-[^/]*\.spec\.ts$/,
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'mobile',
            testMatch: /\/mobile-[^/]*\.spec\.ts$/,
            use: { ...devices['Pixel 7'] },
        },
    ],
    webServer: {
        command: `pnpm dev --port ${port}`,
        url: `http://localhost:${port}`,
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
