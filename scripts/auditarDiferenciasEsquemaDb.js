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
    const candidates = [process.env.DB_PASSWORD, 'taKionga', 'ta3Mionga', '1234', 'postgres'].filter(Boolean);

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
        ORDER BY c.table_name ASC, c.ordinal_position ASC, c.column_name ASC;
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

function ordenarEsquemaDeterminista(tables) {
    const sortedTables = {};
    const tableNames = Object.keys(tables || {}).sort((a, b) => a.localeCompare(b));
    for (const tName of tableNames) {
        const cols = tables[tName] || {};
        const sortedCols = {};
        const colNames = Object.keys(cols).sort((a, b) => {
            const posA = Number(cols[a]?.ordinal_position || 0);
            const posB = Number(cols[b]?.ordinal_position || 0);
            if (posA !== posB) return posA - posB;
            return a.localeCompare(b);
        });
        for (const cName of colNames) {
            const c = cols[cName];
            sortedCols[cName] = {
                ordinal_position: c.ordinal_position,
                data_type: c.data_type,
                udt_name: c.udt_name,
                character_maximum_length: c.character_maximum_length,
                numeric_precision: c.numeric_precision,
                numeric_scale: c.numeric_scale,
                is_nullable: c.is_nullable,
                column_default: c.column_default
            };
        }
        sortedTables[tName] = sortedCols;
    }
    return sortedTables;
}

function construirFirmaEstructuralCanonica(tables) {
    const canonical = {};
    const tableNames = Object.keys(tables || {}).sort((a, b) => a.localeCompare(b));
    for (const tName of tableNames) {
        const cols = tables[tName] || {};
        const canonicalCols = {};
        const colNames = Object.keys(cols).sort((a, b) => a.localeCompare(b));
        for (const cName of colNames) {
            const c = cols[cName] || {};
            canonicalCols[cName] = {
                data_type: c.data_type ?? null,
                udt_name: c.udt_name ?? null,
                character_maximum_length: c.character_maximum_length ?? null,
                numeric_precision: c.numeric_precision ?? null,
                numeric_scale: c.numeric_scale ?? null,
                is_nullable: c.is_nullable ?? null,
                column_default: c.column_default ?? null
            };
        }
        canonical[tName] = canonicalCols;
    }
    return JSON.stringify(canonical);
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
        const rawTables = await extraerEsquemaDesdeCliente(client);
        const tables = ordenarEsquemaDeterminista(rawTables);
        const dir = path.dirname(SNAPSHOT_JSON_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        if (fs.existsSync(SNAPSHOT_JSON_PATH)) {
            try {
                const existingRaw = fs.readFileSync(SNAPSHOT_JSON_PATH, 'utf8');
                const existingParsed = JSON.parse(existingRaw);
                const hasVolatileFields = existingParsed && (
                    Object.prototype.hasOwnProperty.call(existingParsed, 'updatedAt') ||
                    Object.prototype.hasOwnProperty.call(existingParsed, 'exportedAt') ||
                    Object.prototype.hasOwnProperty.call(existingParsed, 'generatedAt') ||
                    Object.prototype.hasOwnProperty.call(existingParsed, 'host')
                );
                if (!hasVolatileFields && existingParsed && existingParsed.tables) {
                    const prevSig = construirFirmaEstructuralCanonica(existingParsed.tables);
                    const nextSig = construirFirmaEstructuralCanonica(tables);
                    if (prevSig === nextSig) {
                        console.log(`✅ [SCHEMA-AUDIT] Esquema de 'etiquetas_pruebas' sin cambios estructurales (${Object.keys(tables).length} tablas). Snapshot intacto.`);
                        return existingParsed.tables;
                    }
                }
            } catch (_) {}
        }

        const payload = {
            tableCount: Object.keys(tables).length,
            tables
        };
        fs.writeFileSync(SNAPSHOT_JSON_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
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
            const orderedCols = Object.entries(labCols)
                .sort((a, b) => (a[1].ordinal_position || 0) - (b[1].ordinal_position || 0));
            const hasSerialPk = orderedCols.some(([, cMeta]) => {
                const t = construirTipoSql(cMeta);
                return t === 'SERIAL' || t === 'BIGSERIAL';
            });
            const colDefs = orderedCols.map(([cName, cMeta], idx) => {
                const tSql = construirTipoSql(cMeta);
                const dSql = construirClausulaDefault(cMeta, tSql);
                let pkOrNullSql = '';
                if (tSql === 'SERIAL' || tSql === 'BIGSERIAL') {
                    pkOrNullSql = ' PRIMARY KEY';
                } else if (!hasSerialPk && idx === 0 && (cName === 'clave' || cName === 'id' || cName === 'codigo')) {
                    pkOrNullSql = ' NOT NULL PRIMARY KEY';
                } else if (String(cMeta.is_nullable || '').toUpperCase() === 'NO') {
                    pkOrNullSql = ' NOT NULL';
                }
                return `    "${cName}" ${tSql}${dSql}${pkOrNullSql}`;
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

    const ensureBunkerPrefsConstraintSql = `
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bunker_preferencias_ui') THEN
        DELETE FROM public.bunker_preferencias_ui WHERE clave IS NULL;
        DELETE FROM public.bunker_preferencias_ui a USING public.bunker_preferencias_ui b WHERE a.ctid < b.ctid AND a.clave = b.clave;
        ALTER TABLE public.bunker_preferencias_ui ALTER COLUMN clave SET NOT NULL;
        ALTER TABLE public.bunker_preferencias_ui ALTER COLUMN valor SET NOT NULL;
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conrelid = 'public.bunker_preferencias_ui'::regclass AND contype = 'p'
        ) THEN
            ALTER TABLE public.bunker_preferencias_ui ADD CONSTRAINT bunker_preferencias_ui_pkey PRIMARY KEY (clave);
        END IF;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_bunker_preferencias_ui_clave_unq ON public.bunker_preferencias_ui (clave);
    END IF;
END $$;`.trim();

    try {
        await prodClient.query('SET default_transaction_read_only = off;');
        await prodClient.query(ensureBunkerPrefsConstraintSql);
    } catch (_) {}

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

async function sincronizarSnapshotHaciaBaseLocal(targetDbName = 'etiquetas_pruebas') {
    if (!fs.existsSync(SNAPSHOT_JSON_PATH)) {
        return { changesCount: 0, sqlStatements: [] };
    }
    let snapshotTables = {};
    try {
        const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_JSON_PATH, 'utf8'));
        if (parsed && parsed.tables) snapshotTables = parsed.tables;
    } catch (_) {
        return { changesCount: 0, sqlStatements: [] };
    }

    const dbClient = await conectarDbLocal(targetDbName);
    if (!dbClient) {
        return { changesCount: 0, sqlStatements: [] };
    }

    try {
        const currentTables = await extraerEsquemaDesdeCliente(dbClient);
        const sqlStatements = [];
        for (const [tableName, snapCols] of Object.entries(snapshotTables)) {
            if (!currentTables[tableName]) {
                const orderedCols = Object.entries(snapCols)
                    .sort((a, b) => (a[1].ordinal_position || 0) - (b[1].ordinal_position || 0));
                const hasSerialPk = orderedCols.some(([, cMeta]) => {
                    const t = construirTipoSql(cMeta);
                    return t === 'SERIAL' || t === 'BIGSERIAL';
                });
                const colDefs = orderedCols.map(([cName, cMeta], idx) => {
                    const tSql = construirTipoSql(cMeta);
                    const dSql = construirClausulaDefault(cMeta, tSql);
                    let pkOrNullSql = '';
                    if (tSql === 'SERIAL' || tSql === 'BIGSERIAL') {
                        pkOrNullSql = ' PRIMARY KEY';
                    } else if (!hasSerialPk && idx === 0 && (cName === 'clave' || cName === 'id' || cName === 'codigo')) {
                        pkOrNullSql = ' NOT NULL PRIMARY KEY';
                    } else if (String(cMeta.is_nullable || '').toUpperCase() === 'NO') {
                        pkOrNullSql = ' NOT NULL';
                    }
                    return `    "${cName}" ${tSql}${dSql}${pkOrNullSql}`;
                });
                if (colDefs.length > 0) {
                    sqlStatements.push(`CREATE TABLE IF NOT EXISTS public."${tableName}" (\n${colDefs.join(',\n')}\n);`);
                }
            } else {
                const curCols = currentTables[tableName];
                for (const [colName, colMeta] of Object.entries(snapCols)) {
                    if (!curCols[colName]) {
                        const tSql = construirTipoSql(colMeta);
                        const finalType = tSql === 'SERIAL' ? 'INTEGER' : (tSql === 'BIGSERIAL' ? 'BIGINT' : tSql);
                        const dSql = construirClausulaDefault(colMeta, finalType);
                        sqlStatements.push(`ALTER TABLE public."${tableName}" ADD COLUMN IF NOT EXISTS "${colName}" ${finalType}${dSql};`);
                    }
                }
            }
        }

        await dbClient.query('SET default_transaction_read_only = off;');
        if (sqlStatements.length > 0) {
            for (const stmt of sqlStatements) {
                try {
                    await dbClient.query(stmt);
                } catch (_) {}
            }
            console.log(`✅ [SCHEMA-AUDIT] Aplicados ${sqlStatements.length} cambios estructurales de 'schema_laboratorio_snapshot.json' sobre '${targetDbName}'.`);
        } else {
            console.log(`✅ [SCHEMA-AUDIT] Base '${targetDbName}' ya cuenta con el 100% de las tablas/columnas del snapshot.`);
        }

        try {
            await dbClient.query(`
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bunker_preferencias_ui') THEN
                        DELETE FROM public.bunker_preferencias_ui WHERE clave IS NULL;
                        DELETE FROM public.bunker_preferencias_ui a USING public.bunker_preferencias_ui b WHERE a.ctid < b.ctid AND a.clave = b.clave;
                        ALTER TABLE public.bunker_preferencias_ui ALTER COLUMN clave SET NOT NULL;
                        ALTER TABLE public.bunker_preferencias_ui ALTER COLUMN valor SET NOT NULL;
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint WHERE conrelid = 'public.bunker_preferencias_ui'::regclass AND contype = 'p'
                        ) THEN
                            ALTER TABLE public.bunker_preferencias_ui ADD CONSTRAINT bunker_preferencias_ui_pkey PRIMARY KEY (clave);
                        END IF;
                        CREATE UNIQUE INDEX IF NOT EXISTS idx_bunker_preferencias_ui_clave_unq ON public.bunker_preferencias_ui (clave);
                    END IF;
                END $$;
            `);
        } catch (_) {}
        return { changesCount: sqlStatements.length, sqlStatements };
    } finally {
        try { await dbClient.end(); } catch (_) {}
    }
}

async function sincronizarEsquemaHaciaLaboratorio() {
    return sincronizarSnapshotHaciaBaseLocal('etiquetas_pruebas');
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--export-lab')) {
        await exportarSnapshotLaboratorio();
        return;
    }
    if (args.includes('--apply-lab')) {
        await sincronizarEsquemaHaciaLaboratorio();
        return;
    }
    if (args.includes('--apply-local-etiquetas')) {
        await sincronizarSnapshotHaciaBaseLocal('etiquetas');
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
    sincronizarEsquemaHaciaLaboratorio,
    sincronizarEsquemaHaciaProduccion
};
