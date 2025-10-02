const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function checkSchema() {
  try {
    // Verificar si existe la tabla presupuestos_config
    const tableCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name LIKE '%config%'
    `);
    console.log('Tablas con config:', tableCheck.rows);
    
    // Verificar columnas de presupuestos_config si existe
    if (tableCheck.rows.some(r => r.table_name === 'presupuestos_config')) {
      const columns = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'presupuestos_config' AND table_schema = 'public'
      `);
      console.log('Columnas presupuestos_config:', columns.rows);
    }
    
    // Buscar cualquier tabla que tenga sheet o hoja en el nombre
    const sheetTables = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND (table_name LIKE '%sheet%' OR table_name LIKE '%hoja%')
    `);
    console.log('Tablas con sheet/hoja:', sheetTables.rows);
    
    // Verificar tabla presupuestos para ver si tiene campos de configuración
    const presupuestosColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'presupuestos' AND table_schema = 'public'
      AND (column_name LIKE '%sheet%' OR column_name LIKE '%hoja%' OR column_name LIKE '%url%')
    `);
    console.log('Columnas presupuestos con sheet/hoja/url:', presupuestosColumns.rows);
    
  } catch (error) {
    console.log('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSchema();
