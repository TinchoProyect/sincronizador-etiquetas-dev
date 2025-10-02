const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function checkTablesSchema() {
  try {
    console.log('=== VERIFICANDO ESQUEMA DE TABLAS ===\n');
    
    // Verificar tabla clientes
    console.log('--- TABLA CLIENTES ---');
    const clientesColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'clientes' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    if (clientesColumns.rows.length > 0) {
      console.log('Columnas de clientes:');
      clientesColumns.rows.forEach(col => {
        console.log(`  ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
      });
      
      // Verificar si tiene columna activo
      const hasActivo = clientesColumns.rows.some(col => col.column_name === 'activo');
      console.log(`¿Tiene columna 'activo'? ${hasActivo ? 'SÍ' : 'NO'}`);
      
      // Contar registros
      const clientesCount = await pool.query('SELECT COUNT(*) as total FROM clientes');
      console.log(`Total clientes: ${clientesCount.rows[0].total}`);
      
      // Mostrar algunos registros
      const sampleClientes = await pool.query('SELECT * FROM clientes LIMIT 3');
      console.log('Muestra de clientes:', sampleClientes.rows);
      
    } else {
      console.log('Tabla clientes no encontrada');
    }
    
    console.log('\n--- TABLA ARTICULOS ---');
    const articulosColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'articulos' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    if (articulosColumns.rows.length > 0) {
      console.log('Columnas de articulos:');
      articulosColumns.rows.forEach(col => {
        console.log(`  ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
      });
      
      // Contar registros con código de barras
      const articulosCount = await pool.query(`
        SELECT COUNT(*) as total 
        FROM articulos 
        WHERE codigo_barras IS NOT NULL AND TRIM(codigo_barras) <> ''
      `);
      console.log(`Artículos con código de barras: ${articulosCount.rows[0].total}`);
      
      // Mostrar algunos registros
      const sampleArticulos = await pool.query(`
        SELECT codigo_barras, numero, descripcion 
        FROM articulos 
        WHERE codigo_barras IS NOT NULL AND TRIM(codigo_barras) <> '' 
        LIMIT 3
      `);
      console.log('Muestra de artículos:', sampleArticulos.rows);
      
    } else {
      console.log('Tabla articulos no encontrada');
    }
    
    console.log('\n--- TABLA PRECIOS_ARTICULOS ---');
    const preciosColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'precios_articulos' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    if (preciosColumns.rows.length > 0) {
      console.log('Columnas de precios_articulos:');
      preciosColumns.rows.forEach(col => {
        console.log(`  ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
      });
      
      // Contar registros
      const preciosCount = await pool.query('SELECT COUNT(*) as total FROM precios_articulos');
      console.log(`Total precios_articulos: ${preciosCount.rows[0].total}`);
      
    } else {
      console.log('Tabla precios_articulos no encontrada');
    }
    
  } catch (error) {
    console.log('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkTablesSchema();
