require('dotenv').config();
const { pool } = require('./src/logistica/config/database');

async function check() {
    try {
        const res = await pool.query(`
            SELECT pid, usename, state, query 
            FROM pg_stat_activity 
            WHERE state != 'idle' AND pid != pg_backend_pid()
        `);
        console.log("Active Queries:", res.rows);
        
        const locks = await pool.query(`
            SELECT a.datname, l.relation::regclass, l.transactionid, l.mode, l.GRANTED, a.usename, a.query, a.pid
            FROM pg_stat_activity a
            JOIN pg_locks l ON l.pid = a.pid
            WHERE a.pid != pg_backend_pid()
        `);
        console.log("Locks:", locks.rows);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
check();
