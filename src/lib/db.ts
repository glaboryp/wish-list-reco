import { neon } from '@neondatabase/serverless';

// La variable de entorno POSTGRES_URL es la que nos dio Vercel
// y que ya está en el archivo .env
// const url = import.meta.env?.POSTGRES_URL || process.env.POSTGRES_URL || 'postgres://mock';
const url = process.env.POSTGRES_URL || 'postgresql://user:password@host.com/dbname';

let sql: any;

if (process.env.MOCK_DB === 'true') {
    console.log('Using MOCK DB');
    sql = async (strings: any, ...values: any[]) => {
        console.log('Mock SQL query:', strings, values);
        // Return mock data based on query or just generic data
        return [{
            id: 1,
            name: 'Mock Item',
            description: 'This is a mock item for testing',
            goal_amount: 100,
            raised_amount: 0,
            image_url: 'https://via.placeholder.com/150',
            status: 'active'
        }];
    };
} else {
    sql = neon(url);
}

export default sql;
