require('dotenv').config();
const { Pool } = require('pg');

async function checkTable(dbName) {
  const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: dbName,
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: process.env.DB_PORT || 5432,
  });

  try {
    const client = await pool.connect();
    const query = `
      SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'presupuestos_articulos_sin_stock'
      );
    `;
    const res = await client.query(query);
    const exists = res.rows[0].exists;
    client.release();
    pool.end();
    return exists;
  } catch (err) {
    if (err.message.includes('database "' + dbName + '" does not exist')) {
        pool.end();
        return "No existe la BD " + dbName;
    }
    console.error('Error on DB ' + dbName + ':', err.message);
    pool.end();
    return "Error " + err.message;
  }
}

async function main() {
  console.log("Iniciando auditoría de Base de Datos para tabla 'presupuestos_articulos_sin_stock'...");
  const prodExists = await checkTable('etiquetas');
  const testExists = await checkTable('etiquetas_pruebas');
  
  console.log("=========================================");
  console.log("Entorno de Producción (etiquetas): " + (prodExists === true ? "✅ INSTALADO" : (prodExists === false ? "❌ NO INSTALADO" : "⚠️ " + prodExists)));
  console.log("Entorno de Pruebas (etiquetas_pruebas): " + (testExists === true ? "✅ INSTALADO" : (testExists === false ? "❌ NO INSTALADO" : "⚠️ " + testExists)));
  console.log("=========================================");

  if (prodExists !== true || testExists !== true) {
      console.log("Se requiere migración en al menos un entorno.");
  } else {
      console.log("Ambos entornos están correctamente alineados.");
  }
}

main();
