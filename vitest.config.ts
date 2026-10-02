/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

const ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
const SESSION_SECRET = 'test-session-secret-test-session-secret';

export default getViteConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/tests/**/*.{test,spec}.{js,ts}'],
    setupFiles: ['./vitest.setup.ts'],
    env: {
      POSTGRES_URL: 'postgresql://user:password@host.com/dbname',
    },
  },
  define: {
    'import.meta.env.POSTGRES_URL': JSON.stringify('postgres://mock'),
    'import.meta.env.ENCRYPTION_KEY': JSON.stringify(ENCRYPTION_KEY),
    'import.meta.env.SESSION_SECRET': JSON.stringify(SESSION_SECRET),
    'import.meta.env.SUPERADMIN_EMAIL': JSON.stringify('boss@example.org'),
    'import.meta.env.PUBLIC_FIREBASE_PROJECT_ID': JSON.stringify('test-project'),
  },
});
