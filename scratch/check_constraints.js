require('dotenv').config();
const { pool } = require('../src/logistica/config/database');

async function test() {
    try {
        console.log("--- AUDITING CONSTRAINTS FOR 'articulos' ---");
        const resArt = await pool.query(
            `SELECT conname, contype, pg_get_constraintdef(c.oid) as def
             FROM pg_constraint c
             JOIN pg_namespace n ON n.oid = c.connamespace
             WHERE n.nspname = 'public' AND c.conrelid = 'public.articulos'::regclass`
        );
        console.log(resArt.rows);

        console.log("--- AUDITING CONSTRAINTS FOR 'bunker_articulos' ---");
        const resBunk = await pool.query(
            `SELECT conname, contype, pg_get_constraintdef(c.oid) as def
             FROM pg_constraint c
             JOIN pg_namespace n ON n.oid = c.connamespace
             WHERE n.nspname = 'public' AND c.conrelid = 'public.bunker_articulos'::regclass`
        );
        console.log(resBunk.rows);
    } catch(e) { 
        console.error(e); 
    }
    process.exit(0);
}
test();
