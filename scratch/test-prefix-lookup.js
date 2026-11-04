const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function run() {
    try {
        const token = '0bf411';
        const isShortCode = token.trim().length === 6;
        console.log('Testing query with token:', token, 'isShortCode:', isShortCode);
        
        const queryToken = `
            SELECT i.token, i.cliente_id, i.expires_at, i.usado, bc.razon_social, bc.email_portal, bc.email_portal_nombre, bc.email_portal_cargo
            FROM public.portal_invitaciones i
            JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = i.cliente_id
            WHERE ${isShortCode ? "i.token LIKE $1 || '%'" : "i.token = $1"}
            ORDER BY i.expires_at DESC
            LIMIT 1
        `;
        
        const resToken = await pool.query(queryToken, [token.trim()]);
        console.log('Query result count:', resToken.rows.length);
        if (resToken.rows.length > 0) {
            console.log('Row:', resToken.rows[0]);
        } else {
            console.log('No rows found, but query succeeded!');
        }
        process.exit(0);
    } catch (e) {
        console.error('SQL Query Error:', e);
        process.exit(1);
    }
}

run();
