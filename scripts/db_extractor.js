const { Client } = require('pg');
const fs = require('fs');

async function run() {
  const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
  });

  try {
    await client.connect();
    
    // Check all tables containing 'bunker' or 'articulos' or 'diccionario'
    const queryTables = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name ILIKE '%bunker%' OR table_name ILIKE '%articulo%' OR table_name ILIKE '%diccionario%');
    `;
    const resTables = await client.query(queryTables);
    
    let report = "--- TABLAS ENCONTRADAS ---\n";
    
    for (let row of resTables.rows) {
      const tableName = row.table_name;
      report += `\nTabla: ${tableName}\n`;
      
      const queryColumns = `
        SELECT column_name, data_type, character_maximum_length, is_nullable
        FROM information_schema.columns
        WHERE table_name = '${tableName}';
      `;
      const resColumns = await client.query(queryColumns);
      report += "Columnas:\n";
      for (let col of resColumns.rows) {
        report += `  - ${col.column_name} (${col.data_type}${col.character_maximum_length ? '('+col.character_maximum_length+')' : ''}) [Nullable: ${col.is_nullable}]\n`;
      }
      
      const queryCount = `SELECT COUNT(*) as count FROM public.${tableName}`;
      const resCount = await client.query(queryCount);
      report += `Cantidad de Registros: ${resCount.rows[0].count}\n`;
      
      if (resCount.rows[0].count > 0 && resCount.rows[0].count <= 10) {
        const queryData = `SELECT * FROM public.${tableName} LIMIT 5`;
        const resData = await client.query(queryData);
        report += `Muestra de Datos:\n${JSON.stringify(resData.rows, null, 2)}\n`;
      } else if (resCount.rows[0].count > 10) {
         const queryData = `SELECT * FROM public.${tableName} LIMIT 1`;
         const resData = await client.query(queryData);
         report += `Muestra (1er reg): ${JSON.stringify(resData.rows[0])}\n`;
      }
    }

    fs.writeFileSync('bunker_db_report.txt', report);
    console.log('Report saved to bunker_db_report.txt');

  } catch (err) {
    console.error('Error', err);
  } finally {
    await client.end();
  }
}

run();
