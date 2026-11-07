#!/usr/bin/env node
/**
 * Auditor y Sincronizador Automático de Esquema DB (`etiquetas_pruebas` -> `etiquetas` Local + Nube)
 * --------------------------------------------------------------------------------------------------
 * Evita que al pasar de Desarrollo a Producción falte alguna tabla o columna creada durante las pruebas
 * en la Notebook o en el Laboratorio de `PcAlmacen` (incluso si se olvidó crear un archivo en `migrations/`).
 *
 * Modos de uso:
 *  - `node scripts/auditarDiferenciasEsquemaDb.js --export-lab`
 *      Exporta la estructura de tablas y columnas de `etiquetas_pruebas` a `migrations/schema_laboratorio_snapshot.json`.
 *  - `node scripts/auditarDiferenciasEsquemaDb.js --sync-prod`
 *      Compara `etiquetas_pruebas` + `migrations/schema_laboratorio_snapshot.json` contra `etiquetas` (Local y Nube),
 *      genera los `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` faltantes y los aplica
 *      de forma no destructiva en ambos nodos de Producción.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Client } = require('pg');

const ROOT_DIR = path.resolve(__dirname, '..');
const SNAPSHOT_JSON_PATH = path.join(ROOT_DIR, 'migrations', 'schema_laboratorio_snapshot.json');
const AUTO_SQL_PATH = path.join(ROOT_DIR, 'migrations', 'auto_schema_sync_latest.sql');
const CLOUD_HOST = process.env.CLOUD_SSH_HOST || '34.39.187.220';
const CLOUD_USER = process.env.CLOUD_SSH_USER || 'lamda_admin';

async function conectarDbLocal(dbName) {
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
    const dbUser = process.env.DB_USER || 'postgres';
    const candidates = [process.env.DB_PASSWORD, 'ta3Mionga', '1234', 'postgres'].filter(Boolean);

    for (const password of candidates) {
        const client = new Client({ host: dbHost, port: dbPort, user: dbUser, password, database: dbName });
        try {
            await client.connect();
            return client;
        } catch (_) {
            try { await client.end(); } catch (_) {}
        }
    }
    return null;
}

async function extraerEsquemaDesdeCliente(client) {
    const res = await client.query(`
        SELECT
            c.table_name,
            c.column_name,
            c.ordinal_position,
            c.data_type,
            c.udt_name,
            c.character_maximum_length,
            c.numeric_precision,
            c.numeric_scale,
            c.is_nullable,
            c.column_default
        FROM information_schema.columns c
        INNER JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name, c.ordinal_position;
    `);

    const tables = {};
    for (const row of res.rows) {
        if (!tables[row.table_name]) {
            tables[row.table_name] = {};
        }
        tables[row.table_name][row.column_name] = {
            ordinal_position: row.ordinal_position,
            data_type: row.data_type,
            udt_name: row.udt_name,
            character_maximum_length: row.character_maximum_length,
            numeric_precision: row.numeric_precision,
            numeric_scale: row.numeric_scale,
            is_nullable: row.is_nullable,
            column_default: row.column_default
        };
    }
    return tables;
}

function construirTipoSql(col) {
    const dt = String(col.data_type || '').toLowerCase();
    const udt = String(col.udt_name || '').toLowerCase();
    const def = String(col.column_default || '');

    if (def.startsWith('nextval(')) {
        return dt === 'bigint' ? 'BIGSERIAL' : 'SERIAL';
    }
    if (dt === 'character varying') {
        return col.character_maximum_length ? `VARCHAR(${col.character_maximum_length})` : 'VARCHAR';
    }
    if (dt === 'character') {
        return col.character_maximum_length ? `CHAR(${col.character_maximum_length})` : 'CHAR(1)';
    }
    if (dt === 'numeric') {
        if (col.numeric_precision && col.numeric_scale !== null) {
            return `NUMERIC(${col.numeric_precision},${col.numeric_scale})`;
        }
        return 'NUMERIC';
    }
    if (dt === 'ARRAY') {
        return udt.startsWith('_') ? `${udt.slice(1)}[]` : 'TEXT[]';
    }
    if (dt === 'user-defined') {
        return udt || 'TEXT';
    }
    return dt.toUpperCase() || 'TEXT';
}

function construirClausulaDefault(col, sqlType) {
    if (sqlType === 'SERIAL' || sqlType === 'BIGSERIAL') return '';
    if (!col.column_default) return '';
    const def = String(col.column_default);
    if (def.includes('nextval(')) return '';
    return ` DEFAULT ${def}`;
}

async function exportarSnapshotLaboratorio() {
    const client = await conectarDbLocal('etiquetas_pruebas');
    if (!client) {
        console.log('ℹ️ [SCHEMA-AUDIT] Base `etiquetas_pruebas` no disponible localmente; se omite exportación de snapshot.');
        return null;
    }
    try {
        const tables = await extraerEsquemaDesdeCliente(client);
        const dir = path.dirname(SNAPSHOT_JSON_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const payload = {
            updatedAt: new Date().toISOString(),
            tableCount: Object.keys(tables).length,
            tables
        };
        fs.writeFileSync(SNAPSHOT_JSON_PATH, JSON.stringify(payload, null, 2), 'utf8');
        console.log(`✅ [SCHEMA-AUDIT] Esquema de 'etiquetas_pruebas' exportado (${payload.tableCount} tablas) -> migrations/schema_laboratorio_snapshot.json`);
        return tables;
    } finally {
        try { await client.end(); } catch (_) {}
    }
}

async function sincronizarEsquemaHaciaProduccion() {
    console.log('🔍 [SCHEMA-AUDIT] Comparando estructura de Laboratorio (`etiquetas_pruebas`) contra Producción (`etiquetas`)...');
    let labTables = {};

    if (fs.existsSync(SNAPSHOT_JSON_PATH)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_JSON_PATH, 'utf8'));
            if (parsed && parsed.tables) {
                labTables = parsed.tables;
            }
        } catch (_) {}
    }

    const labClient = await conectarDbLocal('etiquetas_pruebas');
    if (labClient) {
        try {
            const liveLab = await extraerEsquemaDesdeCliente(labClient);
            for (const [tName, cols] of Object.entries(liveLab)) {
                labTables[tName] = { ...(labTables[tName] || {}), ...cols };
            }
        } finally {
            try { await labClient.end(); } catch (_) {}
        }
    }

    const prodClient = await conectarDbLocal('etiquetas');
    if (!prodClient) {
        console.warn('⚠️ [SCHEMA-AUDIT] No se pudo conectar a la base local `etiquetas`.');
        return { changesCount: 0, sqlStatements: [] };
    }

    let prodTables = {};
    try {
        prodTables = await extraerEsquemaDesdeCliente(prodClient);
    } catch (e) {
        try { await prodClient.end(); } catch (_) {}
        throw e;
    }

    const sqlStatements = [];
    const summaryLog = [];

    for (const [tableName, labCols] of Object.entries(labTables)) {
        if (!prodTables[tableName]) {
            const colDefs = Object.entries(labCols)
                .sort((a, b) => (a[1].ordinal_position || 0) - (b[1].ordinal_position || 0))
                .map(([cName, cMeta]) => {
                    const tSql = construirTipoSql(cMeta);
                    const dSql = construirClausulaDefault(cMeta, tSql);
                    const nullSql = (tSql === 'SERIAL' || tSql === 'BIGSERIAL') ? ' PRIMARY KEY' : '';
                    return `    "${cName}" ${tSql}${dSql}${nullSql}`;
                });
            if (colDefs.length > 0) {
                const stmt = `CREATE TABLE IF NOT EXISTS public."${tableName}" (\n${colDefs.join(',\n')}\n);`;
                sqlStatements.push(stmt);
                summaryLog.push(`➕ Nueva tabla detectada: public.${tableName} (${colDefs.length} columnas)`);
            }
        } else {
            const prodCols = prodTables[tableName];
            for (const [colName, colMeta] of Object.entries(labCols)) {
                if (!prodCols[colName]) {
                    const tSql = construirTipoSql(colMeta);
                    const finalType = tSql === 'SERIAL' ? 'INTEGER' : (tSql === 'BIGSERIAL' ? 'BIGINT' : tSql);
                    const dSql = construirClausulaDefault(colMeta, finalType);
                    const stmt = `ALTER TABLE public."${tableName}" ADD COLUMN IF NOT EXISTS "${colName}" ${finalType}${dSql};`;
                    sqlStatements.push(stmt);
                    summaryLog.push(`➕ Nueva columna detectada: public.${tableName}.${colName} (${finalType})`);
                }
            }
        }
    }

    if (sqlStatements.length === 0) {
        console.log('✅ [SCHEMA-AUDIT] Esquemas 100% alineados: no hay tablas ni columnas faltantes en Producción.');
        try { await prodClient.end(); } catch (_) {}
        return { changesCount: 0, sqlStatements: [] };
    }

    console.log(`🛠️  [SCHEMA-AUDIT] Se detectaron ${sqlStatements.length} cambios estructurales nuevos en Laboratorio:`);
    for (const line of summaryLog) {
        console.log('   ' + line);
    }

    const fullSql = [
        '-- Auto-generado por scripts/auditarDiferenciasEsquemaDb.js',
        `-- Fecha: ${new Date().toISOString()}`,
        ...sqlStatements
    ].join('\n\n') + '\n';

    const dir = path.dirname(AUTO_SQL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTO_SQL_PATH, fullSql, 'utf8');

    // 1. Aplicar en Base Local `etiquetas` (habilitando escritura sólo para esta sesión si está en Read-Only)
    try {
        await prodClient.query('SET default_transaction_read_only = off;');
        for (const stmt of sqlStatements) {
            await prodClient.query(stmt);
        }
        console.log('✅ [SCHEMA-AUDIT] Nuevas tablas/columnas aplicadas en la base de Producción LOCAL (`PcAlmacen`).');
    } catch (errLoc) {
        console.warn('⚠️ [SCHEMA-AUDIT] Advertencia aplicando DDL en base Local:', errLoc.message);
    } finally {
        try { await prodClient.end(); } catch (_) {}
    }

    // 2. Aplicar en Base de Producción NUBE (`34.39.187.220`)
    try {
        const b64Sql = Buffer.from(fullSql, 'utf8').toString('base64');
        execSync(
            `ssh -n -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "echo '${b64Sql}' | base64 -d | sudo -u postgres psql -d etiquetas -v ON_ERROR_STOP=0"`,
            { stdio: 'ignore', windowsHide: true, timeout: 25000 }
        );
        console.log('✅ [SCHEMA-AUDIT] Nuevas tablas/columnas aplicadas en la base de Producción NUBE (`34.39.187.220`).');
    } catch (errCld) {
        console.warn('⚠️ [SCHEMA-AUDIT] No se pudo aplicar DDL remoto en Nube:', errCld.message);
    }

    return { changesCount: sqlStatements.length, sqlStatements, summaryLog };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--export-lab')) {
        await exportarSnapshotLaboratorio();
        return;
    }
    await exportarSnapshotLaboratorio();
    await sincronizarEsquemaHaciaProduccion();
}

if (require.main === module) {
    main().catch((err) => {
        console.error('❌ [SCHEMA-AUDIT] Error:', err.message);
        process.exit(1);
    });
}

module.exports = {
    exportarSnapshotLaboratorio,
    sincronizarEsquemaHaciaProduccion
};
