/// <reference types="vitest" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/tests/**/*.{test,spec}.{js,ts}'],
    setupFiles: ['./vitest.setup.ts'],
    env: {
      POSTGRES_URL: 'postgresql://user:password@host.com/dbname',
      PUBLIC_PAYPAL_ENVIRONMENT: 'sandbox',
      PAYPAL_CLIENT_ID: 'test',
      PAYPAL_APP_SECRET: 'test',
    },
  },
  define: {
    'import.meta.env.POSTGRES_URL': JSON.stringify('postgres://mock'),
    'import.meta.env.PUBLIC_PAYPAL_ENVIRONMENT': JSON.stringify('sandbox'),
    'import.meta.env.PAYPAL_CLIENT_ID': JSON.stringify('test'),
    'import.meta.env.PAYPAL_APP_SECRET': JSON.stringify('test'),
  },
});
