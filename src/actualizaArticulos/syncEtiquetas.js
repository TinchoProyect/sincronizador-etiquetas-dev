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

    if (!respuesta.ok) {
      throw new Error(`Error HTTP ${respuesta.status}`);
    }

    console.log('Descargando datos de artículos...');
    const articulos = await respuesta.json();

    if (!Array.isArray(articulos) || articulos.length === 0) {
      throw new Error('No se recibieron artículos válidos desde la API.');
    }

    console.log(`Se encontraron ${articulos.length} artículos para sincronizar.`);

    console.log('Conectando a la base de datos local...');
    client = await pool.connect();
    
    console.log('Iniciando transacción...');
    await client.query('BEGIN');
    
    console.log('Limpiando tabla de artículos...');
    await client.query('DELETE FROM articulos');

    console.log('Insertando nuevos artículos...');
    let insertados = 0;
    
    for (const art of articulos) {
      await client.query(
        'INSERT INTO articulos (numero, nombre, codigo_barras) VALUES ($1, $2, $3)',
        [art.numero, art.nombre, art.codigo_barras]
      );
      insertados++;
      
      if (insertados % 100 === 0) {
        console.log(`Progreso: ${insertados}/${articulos.length} artículos insertados`);
      }
    }

    console.log('Confirmando transacción...');
    await client.query('COMMIT');
    
    console.log(`¡Sincronización completada con éxito!`);
    console.log(`Se actualizaron ${insertados} artículos en la base de datos local.`);

  } catch (error) {
    console.error('❌ Error durante la sincronización:');
    console.error('Motivo:', error.message);
    
    if (client) {
      console.log('Revirtiendo cambios...');
      await client.query('ROLLBACK');
      console.log('Los cambios han sido revertidos. La base de datos local se mantiene sin cambios.');
    }
    
    process.exit(1);
  } finally {
    if (client) {
      console.log('Cerrando conexión con la base de datos...');
      client.release();
    }
  }
}

// Ejecutar sincronización
sincronizarArticulos()
  .catch(error => {
    console.error('Error fatal:', error);
    process.exit(1);
  });
