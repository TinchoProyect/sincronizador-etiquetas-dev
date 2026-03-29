const pool = require('./src/produccion/config/database');

async function checkConstraint() {
    try {
        const query = `
            SELECT pg_get_constraintdef(c.oid) AS constraint_def
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            WHERE t.relname = 'mantenimiento_movimientos'
            AND c.conname = 'mantenimiento_movimientos_estado_check';
        `;
        const res = await pool.query(query);
        console.log("CONSTRAINT:", res.rows[0].constraint_def);
        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}
checkConstraint();
