const { Client } = require('pg');
const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function run() {
    await client.connect();
    const query = `
    SELECT 
      p.id AS presupuesto_id, 
      p.id_cliente AS cliente_id, 
      p.fecha AS fecha_creacion,
      json_agg(pd.articulo) AS articulos,
      SUM(pd.cantidad * coalesce(pd.valor1, 0)) AS monto_total
    FROM presupuestos p
    JOIN presupuestos_detalles pd ON pd.id_presupuesto = p.id
    WHERE p.fecha >= '2026-02-01' AND p.fecha < '2026-03-01'
    GROUP BY p.id, p.id_cliente, p.fecha
    ORDER BY p.fecha DESC
    LIMIT 5;
  `;
    try {
        const res = await client.query(query);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error("Error en query:", err.message);
    }
    await client.end();
}
run().catch(console.error);
