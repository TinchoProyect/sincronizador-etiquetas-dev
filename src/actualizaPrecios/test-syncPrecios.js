// filepath: src/actualizaPrecios/test-syncPrecios.js
'use strict';

/**
 * Script de prueba para validar el mapeo de campos rubro y sub_rubro
 * Simula datos de la API y verifica que se insertan correctamente en PostgreSQL
 */

require('dotenv').config();
const { Pool } = require('pg');

// ===== Conexión Postgres =====
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('🧪 [TEST-SYNC-PRECIOS] SCRIPT DE PRUEBA');
console.log('═══════════════════════════════════════════════════════');
console.log(`🔌 Conectado a BD: ${process.env.DB_NAME || 'etiquetas'}`);
console.log('📋 Este script insertará 3 registros de prueba');
console.log('═══════════════════════════════════════════════════════\n');

// ===== Utilidades (copiadas del script original) =====
const pick = (row, ...keys) => {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k];
  return null;
};

const K = {
  articulo:         ['articulo', 'Artículo', 'codigo', 'numero', 'Número'],
  descripcion:      ['descripcion', 'Descripción', 'nombre', 'Nombre'],
  costo:            ['costo', 'Costo'],
  moneda:           ['moneda', 'Moneda'],
  iva:              ['iva', 'IVA'],
  precio_neg:       ['precio_neg', 'Precio Neg.', 'precio1'],
  mayorista:        ['mayorista', 'Mayorista', 'precio2'],
  especial_brus:    ['especial_brus', 'Especial (Brus)', 'precio3'],
  consumidor_final: ['consumidor_final', 'Consumidor Final', 'precio4'],
  lista_5:          ['lista_5', 'Lista 5', 'precio5'],
  rubro:            ['familia', 'rubro', 'Familia', 'Rubro'],
  sub_rubro:        ['subfamilia', 'sub_rubro', 'SubFamilia', 'Sub Rubro'],
};

const toNum = v => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.replace(',', '.');
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  }
  return typeof v === 'number' ? v : null;
};

// ===== Datos de prueba simulando respuesta de la API =====
const articulosPrueba = [
  {
    // Caso 1: Usando nombres 'familia' y 'subfamilia' (como vienen de la API)
    articulo: 'TEST001',
    descripcion: 'QUESO MOZZARELLA TEST',
    costo: 1500.50,
    moneda: 'ARS',
    iva: 21.00,
    precio_neg: 2000.00,
    mayorista: 2100.00,
    especial_brus: 2200.00,
    consumidor_final: 2300.00,
    lista_5: 2400.00,
    familia: 'LACTEOS',           // ← Campo que mapea a 'rubro'
    subfamilia: 'QUESOS BLANDOS'  // ← Campo que mapea a 'sub_rubro'
  },
  {
    // Caso 2: Usando nombres alternativos 'Familia' y 'SubFamilia' (con mayúsculas)
    articulo: 'TEST002',
    Descripción: 'PAN INTEGRAL TEST',
    Costo: 800.75,
    Moneda: 'ARS',
    IVA: 10.50,
    'Precio Neg.': 1000.00,
    Mayorista: 1050.00,
    'Especial (Brus)': 1100.00,
    'Consumidor Final': 1150.00,
    'Lista 5': 1200.00,
    Familia: 'PANADERIA',         // ← Variante con mayúscula
    SubFamilia: 'PANES ESPECIALES' // ← Variante con mayúscula
  },
  {
    // Caso 3: Usando nombres 'rubro' y 'sub_rubro' directamente
    numero: 'TEST003',
    nombre: 'ACEITE DE OLIVA TEST',
    costo: 3500.00,
    moneda: 'ARS',
    iva: 21.00,
    precio1: 4500.00,
    precio2: 4600.00,
    precio3: 4700.00,
    precio4: 4800.00,
    precio5: 4900.00,
    rubro: 'ALMACEN',              // ← Nombre directo
    sub_rubro: 'ACEITES Y VINAGRES' // ← Nombre directo
  }
];

// ===== Función de prueba =====
async function testSyncPrecios() {
  let client;

  try {
    console.log('🚀 Iniciando prueba de sincronización...\n');

    client = await pool.connect();

    // Verificar conexión
    const connTest = await client.query('SELECT NOW() as ts, current_database() as db');
    console.log(`✅ Conexión PostgreSQL OK - DB: ${connTest.rows[0].db}`);
    console.log(`⏰ Timestamp: ${connTest.rows[0].ts}\n`);

    // Verificar que la tabla existe y tiene las columnas necesarias
    console.log('🔍 Verificando estructura de la tabla...');
    const colsCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'precios_articulos'
        AND column_name IN ('rubro', 'sub_rubro')
      ORDER BY column_name
    `);

    if (colsCheck.rows.length < 2) {
      console.error('❌ ERROR: Las columnas rubro y/o sub_rubro no existen en la tabla');
      console.error('   Por favor, ejecuta primero:');
      console.error('   ALTER TABLE precios_articulos ADD COLUMN rubro TEXT;');
      console.error('   ALTER TABLE precios_articulos ADD COLUMN sub_rubro TEXT;');
      process.exit(1);
    }

    console.log('✅ Columnas encontradas:');
    colsCheck.rows.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type}`);
    });
    console.log();

    // Preparar INSERT
    const insertSQL = `
      INSERT INTO public.precios_articulos (
        articulo, descripcion, costo, moneda, iva,
        precio_neg, mayorista, especial_brus, consumidor_final, lista_5,
        rubro, sub_rubro
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (articulo) 
      DO UPDATE SET 
        descripcion = EXCLUDED.descripcion,
        rubro = EXCLUDED.rubro,
        sub_rubro = EXCLUDED.sub_rubro
      RETURNING articulo, descripcion, rubro, sub_rubro
    `;

    console.log('📝 Insertando artículos de prueba...\n');

    // Procesar cada artículo de prueba
    for (let i = 0; i < articulosPrueba.length; i++) {
      const a = articulosPrueba[i];
      
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📦 Artículo ${i + 1}/${articulosPrueba.length}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      // Mostrar datos originales
      console.log('📥 Datos recibidos (simulando API):');
      console.log(JSON.stringify(a, null, 2));
      console.log();

      // Mapeo tolerante (igual que en el script original)
      const articulo         = pick(a, ...K.articulo);
      const descripcion      = pick(a, ...K.descripcion);
      const costo            = toNum(pick(a, ...K.costo));
      const moneda           = pick(a, ...K.moneda);
      const iva              = toNum(pick(a, ...K.iva));
      const precio_neg       = toNum(pick(a, ...K.precio_neg));
      const mayorista        = toNum(pick(a, ...K.mayorista));
      const especial_brus    = toNum(pick(a, ...K.especial_brus));
      const consumidor_final = toNum(pick(a, ...K.consumidor_final));
      const lista_5          = toNum(pick(a, ...K.lista_5));
      const rubro            = pick(a, ...K.rubro);
      const sub_rubro        = pick(a, ...K.sub_rubro);

      // Mostrar mapeo
      console.log('🔄 Mapeo aplicado:');
      console.log(`   articulo: ${articulo}`);
      console.log(`   descripcion: ${descripcion}`);
      console.log(`   rubro: ${rubro} ${rubro ? '✅' : '❌'}`);
      console.log(`   sub_rubro: ${sub_rubro} ${sub_rubro ? '✅' : '❌'}`);
      console.log();

      // Insertar
      const result = await client.query(insertSQL, [
        articulo, descripcion, costo, moneda, iva,
        precio_neg, mayorista, especial_brus, consumidor_final, lista_5,
        rubro, sub_rubro
      ]);

      // Mostrar resultado
      console.log('💾 Insertado en BD:');
      console.log(`   articulo: ${result.rows[0].articulo}`);
      console.log(`   descripcion: ${result.rows[0].descripcion}`);
      console.log(`   rubro: ${result.rows[0].rubro || '(null)'}`);
      console.log(`   sub_rubro: ${result.rows[0].sub_rubro || '(null)'}`);
      console.log();
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Verificar datos insertados
    console.log('🔍 Verificando datos en la base de datos...\n');
    const verifyQuery = `
      SELECT articulo, descripcion, rubro, sub_rubro
      FROM public.precios_articulos
      WHERE articulo LIKE 'TEST%'
      ORDER BY articulo
    `;
    
    const verifyResult = await client.query(verifyQuery);
    
    console.log('📊 Registros de prueba en la BD:');
    console.table(verifyResult.rows);

    // Resumen
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('✅ PRUEBA COMPLETADA EXITOSAMENTE');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`📝 Total de registros insertados: ${articulosPrueba.length}`);
    console.log(`✅ Registros con rubro: ${verifyResult.rows.filter(r => r.rubro).length}`);
    console.log(`✅ Registros con sub_rubro: ${verifyResult.rows.filter(r => r.sub_rubro).length}`);
    console.log('\n💡 Para limpiar los datos de prueba, ejecuta:');
    console.log('   DELETE FROM precios_articulos WHERE articulo LIKE \'TEST%\';');
    console.log('═══════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Error durante la prueba:', error.message);
    console.error('Stack:', error.stack);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

// Ejecutar prueba
testSyncPrecios()
  .catch(error => {
    console.error('💥 Error fatal en prueba:', error);
    process.exitCode = 1;
  });
