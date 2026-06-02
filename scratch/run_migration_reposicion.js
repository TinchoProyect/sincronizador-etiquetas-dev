const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function main() {
  await client.connect();
  try {
    console.log('🔄 Iniciando migración de base de datos...');
    
    // Crear la tabla relacional de mapeo
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS public.bunker_articulos_reposicion_mapeo (
          bunker_articulo_id VARCHAR(50) NOT NULL REFERENCES public.bunker_articulos(articulo_id) ON DELETE CASCADE,
          proveedor_id UUID NOT NULL,
          proveedor_producto_codigo VARCHAR(255) NOT NULL,
          CONSTRAINT pk_bunker_articulos_reposicion_mapeo PRIMARY KEY (bunker_articulo_id, proveedor_id, proveedor_producto_codigo)
      );
    `;
    await client.query(createTableQuery);
    console.log('✅ Tabla public.bunker_articulos_reposicion_mapeo creada o verificada exitosamente.');

    // Crear el índice de performance
    const createIndexQuery = `
      CREATE INDEX IF NOT EXISTS idx_bunker_articulos_rep_mapeo_art 
      ON public.bunker_articulos_reposicion_mapeo(bunker_articulo_id);
    `;
    await client.query(createIndexQuery);
    console.log('✅ Índice idx_bunker_articulos_rep_mapeo_art creado o verificado exitosamente.');
    
    console.log('🎉 Migración completada exitosamente.');
  } catch (err) {
    console.error('❌ Error durante la migración:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
