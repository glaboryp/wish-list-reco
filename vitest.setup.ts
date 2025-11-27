import { vi } from 'vitest';

// Mock import.meta.env
(global as any).import = {
    meta: {
        env: {
            POSTGRES_URL: 'postgres://user:pass@host:5432/db',
            PUBLIC_PAYPAL_ENVIRONMENT: 'sandbox',
            PAYPAL_CLIENT_ID: 'test',
            PAYPAL_APP_SECRET: 'test'
        }
    }
};
