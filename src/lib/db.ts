import { neon, neonConfig } from '@neondatabase/serverless';
import { mockSql } from './db-mock';

const url = import.meta.env.POSTGRES_URL;

if (!url) {
    throw new Error('POSTGRES_URL no está configurada');
}

const fetchEndpoint = import.meta.env.DEV ? import.meta.env.NEON_FETCH_ENDPOINT : undefined;
if (fetchEndpoint) {
    neonConfig.fetchEndpoint = fetchEndpoint;
    neonConfig.useSecureWebSocket = false;
}

const sql: any = process.env.MOCK_DB === 'true' ? mockSql : neon(url);

export default sql;
