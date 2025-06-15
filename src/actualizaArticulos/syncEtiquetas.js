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
    console.log('Conectando a la API...');

    const respuesta = await fetch('https://api.lamdaser.com/etiquetas/articulos');
    if (!respuesta.ok) throw new Error(`Error HTTP ${respuesta.status}`);

    console.log('Descargando datos de artículos...');
    const articulos = await respuesta.json();
    if (!Array.isArray(articulos) || articulos.length === 0) {
      throw new Error('No se recibieron artículos válidos desde la API.');
    }

    console.log(`Se encontraron ${articulos.length} artículos para sincronizar.`);
    client = await pool.connect();
    await client.query('BEGIN');

    console.log('Limpiando tabla de artículos...');
    await client.query('DELETE FROM articulos');

    console.log('Insertando nuevos artículos y evaluando snapshots...');
    let insertados = 0;

    for (const art of articulos) {
      const numero = art.numero;
      const nombre = art.nombre;
      const codigo_barras = art.codigo_barras;
      const stock = parseFloat((art.stock_total ?? 0).toFixed(2)); // Asegura precisión razonable

      // Insertar en tabla principal
      await client.query(
        'INSERT INTO articulos (numero, nombre, codigo_barras, stock_ventas) VALUES ($1, $2, $3, $4)',
        [numero, nombre, codigo_barras, stock]
      );

      // Buscar último snapshot
      const { rows } = await client.query(
        `SELECT stock_lomasoft
         FROM stock_lomasoft_snapshot
         WHERE articulo_numero = $1
         ORDER BY fecha_hora DESC
         LIMIT 1`,
        [numero]
      );

      const stockUltimo = rows[0]?.stock_lomasoft;

      // Solo insertar si no existe o cambió significativamente el stock
      if (stockUltimo === undefined || Math.abs(stockUltimo - stock) >= 0.01) {
        await client.query(
          `INSERT INTO stock_lomasoft_snapshot 
            (articulo_numero, descripcion, codigo_barras, fecha_dia, fecha_hora, stock_lomasoft)
           VALUES ($1, $2, $3, CURRENT_DATE, NOW(), $4)`,
          [numero, nombre, codigo_barras, stock]
        );
      }

      insertados++;
      if (insertados % 100 === 0) {
        console.log(`Progreso: ${insertados}/${articulos.length} artículos insertados`);
      }
    }

    await client.query('COMMIT');
    console.log(`¡Sincronización completada con éxito!`);
    console.log(`Se actualizaron ${insertados} artículos en la base de datos local.`);

  } catch (error) {
    console.error('❌ Error durante la sincronización:');
    console.error('Motivo:', error.message);
    if (client) {
      console.log('Revirtiendo cambios...');
      await client.query('ROLLBACK');
    }
    process.exit(1);
  } finally {
    if (client) {
      console.log('Cerrando conexión con la base de datos...');
      client.release();
    }
  }
}

sincronizarArticulos()
  .catch(error => {
    console.error('Error fatal:', error);
    process.exit(1);
  });
