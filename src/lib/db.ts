import { neon } from '@neondatabase/serverless';
import { mockSql } from './db-mock';

const url = import.meta.env.POSTGRES_URL;

if (!url) {
    throw new Error('POSTGRES_URL no está configurada');
}

const sql: any = process.env.MOCK_DB === 'true' ? mockSql : neon(url);

export default sql;
