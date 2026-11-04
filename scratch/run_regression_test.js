require('dotenv').config();
const { Pool } = require('pg');
const { execSync } = require('child_process');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
});

async function run() {
    try {
        console.log("=== 1) Reverting local budget sequence to 'Imprimir' (En Preparacion) ===");
        await pool.query("UPDATE public.presupuestos SET secuencia = 'Imprimir' WHERE id = 8234459");
        
        console.log("=== 2) Running syncB2BEstados.js ===");
        let output = execSync("node src/actualizaPrecios/syncB2BEstados.js").toString();
        console.log(output);

        console.log("=== 3) Checking Supabase order status ===");
        let checkOut1 = execSync("node scratch/check_order_status.js").toString();
        console.log(checkOut1);

        console.log("=== 4) Restoring local budget sequence to 'Pedido_Listo' (Listo para Entregar) ===");
        await pool.query("UPDATE public.presupuestos SET secuencia = 'Pedido_Listo' WHERE id = 8234459");

        console.log("=== 5) Running syncB2BEstados.js ===");
        let output2 = execSync("node src/actualizaPrecios/syncB2BEstados.js").toString();
        console.log(output2);

        console.log("=== 6) Checking Supabase order status ===");
        let checkOut2 = execSync("node scratch/check_order_status.js").toString();
        console.log(checkOut2);

    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}
run();
