const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function explore() {
    await client.connect();
    try {
        let res = await client.query(`
            SELECT DISTINCT pa.articulo, pa.descripcion, pa.iva
            FROM presupuestos p
            JOIN presupuestos_detalles pd ON p.id = pd.id_presupuesto
            JOIN articulos a ON a.codigo_barras = pd.articulo
            JOIN precios_articulos pa ON pa.articulo = a.numero
            WHERE p.id_cliente = '577' 
            AND (pa.iva = '10.5' OR pa.iva = '10.50' OR CAST(pa.iva AS numeric) = 10.5)
        `);
        console.log("Count of requested articles with 10.5 IVA:", res.rows.length);
        console.table(res.rows);

        // Also let's check ALL articles requested by the client, just to be sure we are mapping right
        let res2 = await client.query(`
            SELECT COUNT(DISTINCT pd.articulo) as requested_count
            FROM presupuestos p
            JOIN presupuestos_detalles pd ON p.id = pd.id_presupuesto
            WHERE p.id_cliente = '577'
        `);
        console.log("Total unique articles requested by client:", res2.rows[0].requested_count);
        
        let res3 = await client.query(`
            SELECT COUNT(DISTINCT pa.articulo) as requested_mapped_count
            FROM presupuestos p
            JOIN presupuestos_detalles pd ON p.id = pd.id_presupuesto
            JOIN articulos a ON a.codigo_barras = pd.articulo
            JOIN precios_articulos pa ON pa.articulo = a.numero
            WHERE p.id_cliente = '577'
        `);
        console.log("Total unique articles requested by client mapped to precios_articulos:", res3.rows[0].requested_mapped_count);

    } catch (e) {
        console.error("Error exploring", e);
    } finally {
        await client.end();
    }
}
explore();
