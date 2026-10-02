import { vi } from 'vitest';

vi.stubEnv('POSTGRES_URL', 'postgres://user:pass@host:5432/db');
