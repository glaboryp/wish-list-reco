import { neon } from '@neondatabase/serverless';

export type Row = Record<string, unknown>;
export type Sql = <T = Row>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

const url = import.meta.env.POSTGRES_URL;

if (!url) {
    throw new Error('POSTGRES_URL no está configurada');
}

const sql: Sql =
    process.env.MOCK_DB === 'true'
        ? ((await import('./db-mock')).mockSql as unknown as Sql)
        : (neon(url) as unknown as Sql);

export default sql;
