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
  try {
    const respuesta = await fetch('https://api.lamdaser.com/etiquetas/articulos');

    if (!respuesta.ok) {
      throw new Error(`Error HTTP ${respuesta.status}`);
    }

    const articulos = await respuesta.json();

    if (!Array.isArray(articulos) || articulos.length === 0) {
      throw new Error('No se recibieron artículos válidos desde la API.');
    }

    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query('DELETE FROM articulos');

    for (const art of articulos) {
      await client.query(
        'INSERT INTO articulos (numero, nombre, codigo_barras) VALUES ($1, $2, $3)',
        [art.numero, art.nombre, art.codigo_barras]
      );
    }

    await client.query('COMMIT');
    console.log(`Sincronización completa: ${articulos.length} artículos actualizados.`);
    client.release();

  } catch (error) {
    console.error('Sincronización cancelada. Se mantiene la base de datos local sin cambios.');
    console.error('Motivo:', error.message);
  }
}

sincronizarArticulos();
