import { neon, neonConfig } from '@neondatabase/serverless';

export type Row = Record<string, unknown>;
export type Sql = <T = Row>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

const url = import.meta.env.POSTGRES_URL;

if (!url) {
    throw new Error('POSTGRES_URL no está configurada');
}

const fetchEndpoint = import.meta.env.DEV ? import.meta.env.NEON_FETCH_ENDPOINT : undefined;
if (fetchEndpoint) {
    neonConfig.fetchEndpoint = fetchEndpoint;
    neonConfig.useSecureWebSocket = false;
}

const sql: Sql =
    process.env.MOCK_DB === 'true'
        ? ((await import('./db-mock')).mockSql as unknown as Sql)
        : (neon(url) as unknown as Sql);

export default sql;
