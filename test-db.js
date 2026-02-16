const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
console.log('Testing connection to:', connectionString.replace(/:[^:]+@/, ':****@'));

const pool = new Pool({
    connectionString,
    ssl: {
        rejectUnauthorized: false
    },
    connectionTimeoutMillis: 10000,
});

async function testConnection() {
    console.log('Attempting to connect...');
    try {
        const start = Date.now();
        const client = await pool.connect();
        console.log('Connected successfully in', Date.now() - start, 'ms');

        const res = await client.query('SELECT NOW()');
        console.log('Query successful:', res.rows[0]);

        client.release();
    } catch (err) {
        console.error('Connection error:', err.message);
        console.error('Full error:', err);
    } finally {
        await pool.end();
        console.log('Pool closed.');
    }
}

testConnection();
