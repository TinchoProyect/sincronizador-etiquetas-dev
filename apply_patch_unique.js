const { Pool } = require('pg');
require('dotenv').config({path: '.env'});
const dotenvTest = require('dotenv').config({path: '.env.test'});

const sql = `
CREATE UNIQUE INDEX IF NOT EXISTS uk_presupuestos_origen 
ON public.presupuestos (origen_punto_venta, origen_numero_factura) 
WHERE origen_numero_factura IS NOT NULL AND origen_numero_factura != '';
`;

async function applyPatch() {
    console.log("Applying patch to PRODUCTION...");
    const poolProd = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        await poolProd.query(sql);
        console.log("PROD SUCCESS");
    } catch (e) {
        console.error("PROD ERROR", e);
    } finally {
        await poolProd.end();
    }

    console.log("Applying patch to TEST...");
    const poolTest = new Pool({ connectionString: dotenvTest.parsed.DATABASE_URL_TEST });
    try {
        await poolTest.query(sql);
        console.log("TEST SUCCESS");
    } catch (e) {
        console.error("TEST ERROR", e);
    } finally {
        await poolTest.end();
    }
}

applyPatch();
