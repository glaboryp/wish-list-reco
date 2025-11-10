import { neon } from '@neondatabase/serverless';

// La variable de entorno POSTGRES_URL es la que nos dio Vercel
// y que ya está en el archivo .env
const sql = neon(import.meta.env.POSTGRES_URL);

export default sql;
