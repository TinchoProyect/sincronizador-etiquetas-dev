require('dotenv').config();
const { ejecutarQuery } = require('../src/logistica/config/database');
const fs = require('fs');
const path = require('path');

async function test() {
    try {
        console.log("--- CLEANING BUNKER PRICE LISTS TABLES ---");
        await ejecutarQuery("DROP TABLE IF EXISTS public.bunker_lista_insumos CASCADE", [], "Drop insumos");
        await ejecutarQuery("DROP TABLE IF EXISTS public.bunker_lista_articulos CASCADE", [], "Drop lista articulos");
        await ejecutarQuery("DROP TABLE IF EXISTS public.bunker_listas_precios CASCADE", [], "Drop listas precios");

        console.log("--- APPLYING CLEAN DECOUPLED MIGRATION 13 ---");
        const sqlPath = path.join(__dirname, '..', 'src', 'logistica', 'migrations', '13_listas_precios_bunker.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        await ejecutarQuery(sql, [], 'Migration 13 Clean');
        console.log("Clean migration completed successfully!");
    } catch(e) { 
        console.error("Failed to clean and migrate:", e); 
    }
    process.exit(0);
}
test();
