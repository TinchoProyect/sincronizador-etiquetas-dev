// filepath: scripts/clonarSupabaseB2BSandbox.js
'use strict';

/**
 * 🧪 CLONADOR Y POBLADOR AUTOMÁTICO DE SUPABASE SANDBOX (lamda-b2b-sandbox)
 * =========================================================================
 * Etapa 1 / Etapa 2 — Estrategia de Prueba Paralela en la Nube (Sistema LAMDA)
 *
 * Funciones:
 *  1. Consolida todos los archivos DDL de `supabase_migration/*.sql` en orden cronológico
 *     dentro de `supabase_migration/00_CONSOLIDADO_SANDBOX_COMPLETO.sql` (listo para pegar
 *     en el SQL Editor de `lamda-b2b-sandbox`, o para ejecutar automáticamente vía PostgreSQL
 *     si se provee `SUPABASE_SANDBOX_DB_URL`).
 *  2. Verifica con un CANDADO ESTRICTO que `SUPABASE_B2B_URL` NO apunte al proyecto de
 *     Producción (`zysyxtbcvgswancxtpib`).
 *  3. Ejecuta en secuencia los 8 sincronizadores oficiales de LAMDA hacia el proyecto Sandbox:
 *     - Catálogo y Precios (`syncB2BPrecios.js`)
 *     - Clientes y Listas de Precios (`syncB2BClientesListas.js`)
 *     - Cuentas Corrientes y Comprobantes (`syncB2BCuentas.js`)
 *     - Políticas Comerciales (`syncB2BPoliticas.js`)
 *     - Ofertas Dinámicas (`syncB2BOfertas.js`)
 *     - Servicios de Colaboradores (`syncB2BColaboradores.js`)
 *     - Artículos Habituales (`syncB2BHabituales.js`)
 *     - Estados Logísticos (`syncB2BEstados.js`)
 */

try { require('dotenv').config(); } catch (_) {}
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
let Client = null; try { Client = require('pg').Client; } catch (_) {}

const PROD_SUPABASE_ID = 'zysyxtbcvgswancxtpib';
const MIGRATIONS_DIR = path.resolve(__dirname, '../supabase_migration');
const CONSOLIDATED_SQL_PATH = path.join(MIGRATIONS_DIR, '00_CONSOLIDADO_SANDBOX_COMPLETO.sql');

function generarSqlConsolidado() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        throw new Error(`No existe el directorio de migraciones: ${MIGRATIONS_DIR}`);
    }

    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => /^\d+_.*\.sql$/i.test(f) && f !== '00_CONSOLIDADO_SANDBOX_COMPLETO.sql')
        .sort((a, b) => {
            const numA = parseInt(a.split('_')[0], 10);
            const numB = parseInt(b.split('_')[0], 10);
            return numA - numB || a.localeCompare(b);
        });

    const parts = [
        '-- ============================================================================',
        '-- LAMDA B2B SANDBOX — ESQUEMA CONSOLIDADO COMPLETO (GENERADO AUTOMÁTICAMENTE)',
        `-- Fecha de generación: ${new Date().toISOString()}`,
        `-- Total de archivos integrados: ${files.length}`,
        '-- Instrucciones: Pegar y ejecutar en el SQL Editor del proyecto lamda-b2b-sandbox',
        '-- ============================================================================\n'
    ];

    for (const file of files) {
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        parts.push(`\n-- ----------------------------------------------------------------------------`);
        parts.push(`-- ARCHIVO: ${file}`);
        parts.push(`-- ----------------------------------------------------------------------------`);
        parts.push(sql.trim());
        parts.push('');
    }

    fs.writeFileSync(CONSOLIDATED_SQL_PATH, parts.join('\n'), 'utf8');
    console.log(`📄 [SANDBOX-SQL] Archivo SQL consolidado generado con éxito (${files.length} migraciones):`);
    console.log(`   👉 ${CONSOLIDATED_SQL_PATH}`);
    return { filesCount: files.length, consolidatedPath: CONSOLIDATED_SQL_PATH };
}

async function aplicarEsquemaDirectoSiHayDbUrl() {
    const sandboxDbUrl = (process.env.SUPABASE_SANDBOX_DB_URL || '').trim();
    if (!sandboxDbUrl) {
        console.log('ℹ️  [SANDBOX-SQL] SUPABASE_SANDBOX_DB_URL no definida: podés aplicar el esquema pegando 00_CONSOLIDADO_SANDBOX_COMPLETO.sql en el SQL Editor de Supabase.');
        return;
    }
    if (sandboxDbUrl.includes(PROD_SUPABASE_ID)) {
        throw new Error('🛑 BLOQUEO DE SEGURIDAD: SUPABASE_SANDBOX_DB_URL apunta al proyecto de Producción. Abortando.');
    }

    console.log('🔌 [SANDBOX-SQL] Conectando a PostgreSQL de lamda-b2b-sandbox para aplicar esquema DDL...');
    const sqlCompleto = fs.readFileSync(CONSOLIDATED_SQL_PATH, 'utf8');
    const client = new Client({ connectionString: sandboxDbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
        await client.query(sqlCompleto);
        console.log('✅ [SANDBOX-SQL] Esquema DDL aplicado exitosamente en lamda-b2b-sandbox.');
    } finally {
        await client.end();
    }
}

function ejecutarScriptSync(nombre, relScriptPath, envOverrides) {
    return new Promise((resolve) => {
        const fullPath = path.resolve(__dirname, relScriptPath);
        console.log(`🚀 [SANDBOX-POPULATE] Ejecutando: ${nombre} (${path.basename(fullPath)})...`);
        const child = fork(fullPath, [], {
            env: {
                ...process.env,
                ...envOverrides,
                NODE_ENV: 'production'
            }
        });
        child.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ [SANDBOX-POPULATE] ${nombre} completado.`);
            } else {
                console.warn(`⚠️ [SANDBOX-POPULATE] ${nombre} finalizó con código ${code}.`);
            }
            resolve(code);
        });
        child.on('error', (err) => {
            console.error(`❌ [SANDBOX-POPULATE] Error en ${nombre}:`, err.message);
            resolve(-1);
        });
    });
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('🧪 [LAMDA B2B SANDBOX] PREPARACIÓN Y POBLADO DE PROYECTO ESPEJO EN SUPABASE');
    console.log('═══════════════════════════════════════════════════════════════════════════');

    // 1. Generar siempre el archivo SQL consolidado
    generarSqlConsolidado();

    const soloSql = process.argv.includes('--solo-sql');
    if (soloSql) {
        console.log('✅ Modo --solo-sql finalizado.');
        return;
    }

    // 2. Validar credenciales del proyecto Sandbox
    const targetUrl = (process.env.SUPABASE_SANDBOX_URL || process.env.SUPABASE_B2B_URL || '').trim();
    const targetKey = (process.env.SUPABASE_SANDBOX_SERVICE_KEY || process.env.SUPABASE_B2B_SERVICE_KEY || '').trim();

    if (!targetUrl || !targetKey || targetUrl.includes('127.0.0.1') || targetKey === 'modo_laboratorio_desconectado') {
        console.log('\n⚠️  Todavía no se configuraron las credenciales del proyecto Supabase Sandbox.');
        console.log('👉 Cuando crees el proyecto gratuito "lamda-b2b-sandbox" en la Etapa 2:');
        console.log('   1) Pegá el archivo generado "supabase_migration/00_CONSOLIDADO_SANDBOX_COMPLETO.sql" en el SQL Editor de Supabase.');
        console.log('   2) Configurá SUPABASE_B2B_URL y SUPABASE_B2B_SERVICE_KEY con las claves del proyecto Sandbox.');
        console.log('   3) Volvé a correr: npm run b2b:clonar-sandbox');
        return;
    }

    if (targetUrl.toLowerCase().includes(PROD_SUPABASE_ID)) {
        console.error('\n🛑 BLOQUEO DE SEGURIDAD CRÍTICO:');
        console.error(`   La URL configurada (${targetUrl}) pertenece al Supabase de PRODUCCIÓN (${PROD_SUPABASE_ID}).`);
        console.error('   Este script solo puede ejecutarse contra el proyecto espejo (lamda-b2b-sandbox).');
        process.exit(1);
    }

    // 3. Aplicar DDL directo si se proveyó SUPABASE_SANDBOX_DB_URL
    await aplicarEsquemaDirectoSiHayDbUrl();

    // 4. Poblar todas las tablas del Sandbox usando los sincronizadores oficiales de LAMDA
    const envOverrides = {
        SUPABASE_B2B_URL: targetUrl,
        SUPABASE_B2B_SERVICE_KEY: targetKey,
        LAMDA_B2B_SANDBOX_ENABLED: 'true'
    };

    const pasos = [
        { nombre: '1/8 Catálogo y Precios', script: '../src/actualizaPrecios/syncB2BPrecios.js' },
        { nombre: '2/8 Clientes y Listas', script: '../src/actualizaPrecios/syncB2BClientesListas.js' },
        { nombre: '3/8 Cuentas Corrientes', script: '../src/actualizaPrecios/syncB2BCuentas.js' },
        { nombre: '4/8 Políticas Comerciales', script: '../src/actualizaPrecios/syncB2BPoliticas.js' },
        { nombre: '5/8 Ofertas Dinámicas', script: '../src/actualizaPrecios/syncB2BOfertas.js' },
        { nombre: '6/8 Servicios Colaborador', script: '../src/actualizaPrecios/syncB2BColaboradores.js' },
        { nombre: '7/8 Artículos Habituales', script: '../src/actualizaPrecios/syncB2BHabituales.js' },
        { nombre: '8/8 Estados Logísticos', script: '../src/actualizaPrecios/syncB2BEstados.js' }
    ];

    for (const paso of pasos) {
        await ejecutarScriptSync(paso.nombre, paso.script, envOverrides);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('🎉 [LAMDA B2B SANDBOX] Poblado completo finalizado sobre:', targetUrl);
    console.log('═══════════════════════════════════════════════════════════════════════════');
}

main().catch((err) => {
    console.error('💥 Error en clonarSupabaseB2BSandbox:', err.message);
    process.exit(1);
});
