const fs = require('fs');
const path = require('path');
const { pool } = require('../src/logistica/config/database');

async function run() {
    try {
        const sqlPath = path.join(__dirname, '..', 'src', 'logistica', 'migrations', '14_add_disponible_column.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('Running SQL:\n', sql);
        await pool.query(sql);
        console.log('✅ Column "disponible" added successfully (or already exists).');
    } catch (e) {
        console.error('❌ Migration failed:', e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

run();
