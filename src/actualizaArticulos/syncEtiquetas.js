const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function sincronizarArticulos() {
  let client;

  try {
    console.log('=== Sincronizador de Etiquetas ===');
    console.log('Iniciando sincronización de artículos...');

    const respuesta = await fetch('https://api.lamdaser.com/etiquetas/articulos');
    if (!respuesta.ok) throw new Error(`Error HTTP ${respuesta.status}`);

    const articulos = await respuesta.json();
    if (!Array.isArray(articulos) || articulos.length === 0) {
      throw new Error('No se recibieron artículos válidos desde la API.');
    }

    client = await pool.connect();
    await client.query('BEGIN');

    await client.query('DELETE FROM articulos');

    let insertados = 0;

    for (const art of articulos) {
      const numero = art.numero;
      const nombre = art.nombre;
      const codigo_barras = art.codigo_barras;
      const rawStock = art.stock_total;
      let stock = 0;

      if (typeof rawStock === 'number') {
        stock = parseFloat(rawStock.toFixed(2));
      } else if (typeof rawStock === 'string' && rawStock.trim().match(/^[-+]?\d+(\.\d+)?$/)) {
        stock = parseFloat(parseFloat(rawStock.trim()).toFixed(2));
      }

      await client.query(
        'INSERT INTO articulos (numero, nombre, codigo_barras, stock_ventas) VALUES ($1, $2, $3, $4)',
        [numero, nombre, codigo_barras, stock]
      );

      const { rows } = await client.query(
        `SELECT stock_lomasoft
         FROM stock_lomasoft_snapshot
         WHERE articulo_numero = $1
         ORDER BY fecha_hora DESC
         LIMIT 1`,
        [numero]
      );

      const stockUltimo = rows[0]?.stock_lomasoft;

      if (stockUltimo === undefined || Math.abs(stockUltimo - stock) >= 0.01) {
        await client.query(
          `INSERT INTO stock_lomasoft_snapshot 
            (articulo_numero, descripcion, codigo_barras, fecha_dia, fecha_hora, stock_lomasoft)
           VALUES ($1, $2, $3, CURRENT_DATE, NOW(), $4)`,
          [numero, nombre, codigo_barras, stock]
        );

        const { rows: datosConsolidado } = await client.query(
          `SELECT stock_movimientos, stock_ajustes 
           FROM stock_real_consolidado 
           WHERE articulo_numero = $1`,
          [numero]
        );

        let stock_movimientos = datosConsolidado[0]?.stock_movimientos ?? 0;
        let stock_ajustes = datosConsolidado[0]?.stock_ajustes ?? 0;

        stock_movimientos = parseFloat(stock_movimientos) || 0;
        stock_ajustes = parseFloat(stock_ajustes) || 0;

        const stock_consolidado = stock + stock_movimientos + stock_ajustes;

        await client.query(
          `UPDATE stock_real_consolidado
           SET stock_lomasoft = $1,
               stock_consolidado = $2,
               ultima_actualizacion = NOW()
           WHERE articulo_numero = $3`,
          [stock, stock_consolidado, numero]
        );
      }

      insertados++;
    }

    await client.query('COMMIT');
    console.log(`✅ Sincronización completada. ${insertados} artículos actualizados.`);

  } catch (error) {
    console.error('❌ Error durante la sincronización:', error.message);
    if (client) {
      await client.query('ROLLBACK');
    }
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
  }
}

sincronizarArticulos()
  .catch(error => {
    console.error('💥 Error fatal:', error);
    process.exit(1);
  });

