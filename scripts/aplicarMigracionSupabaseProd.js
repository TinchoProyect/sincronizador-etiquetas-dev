#!/usr/bin/env node
'use strict';

/**
 * Ejecutor seguro de migraciones DDL / consultas sobre Supabase Producción.
 * -------------------------------------------------------------------------
 * Candados de seguridad:
 *  - Exige explícitamente el flag `--confirmar-produccion`.
 *  - Lee `SUPABASE_ACCESS_TOKEN` y `SUPABASE_B2B_URL` EXCLUSIVAMENTE desde `.env.original_deposito`
 *    (nunca desde `.env` de Laboratorio).
 *  - Rechaza cualquier URL local o de laboratorio (`127.0.0.1`, `localhost`).
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT_DIR = path.resolve(__dirname, '..');
const ORIG_ENV_PATH = path.join(ROOT_DIR, '.env.original_deposito');

function parseArgs(argv) {
    const opts = { confirmar: false, file: null, query: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--confirmar-produccion') {
            opts.confirmar = true;
        } else if (a === '--file' && argv[i + 1]) {
            opts.file = argv[++i];
        } else if (a === '--query' && argv[i + 1]) {
            opts.query = argv[++i];
        }
    }
    return opts;
}

function extraerProjectRef(supabaseUrl) {
    const val = String(supabaseUrl || '').trim();
    if (!val || val.includes('127.0.0.1') || val.includes('localhost')) {
        throw new Error('SUPABASE_B2B_URL en .env.original_deposito apunta a un entorno local/laboratorio. Operación abortada.');
    }
    let parsed;
    try {
        parsed = new URL(val);
    } catch (_) {
        throw new Error(`SUPABASE_B2B_URL inválida en .env.original_deposito: ${val}`);
    }
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) {
        throw new Error(`Hostname de Supabase Producción inválido: ${parsed.hostname}`);
    }
    return parsed.hostname.split('.')[0];
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (!opts.confirmar) {
        console.error('❌ [CANDADO SUPABASE PROD] Ejecución bloqueada.');
        console.error('   Se requiere el flag explícito `--confirmar-produccion`.');
        process.exit(1);
    }
    if ((opts.file && opts.query) || (!opts.file && !opts.query)) {
        console.error('❌ Debe especificar exactamente uno de `--file <ruta.sql>` o `--query "<sql>"`.');
        process.exit(1);
    }
    if (!fs.existsSync(ORIG_ENV_PATH)) {
        console.error('❌ No existe `.env.original_deposito` con las credenciales productivas.');
        process.exit(1);
    }

    const origEnv = dotenv.parse(fs.readFileSync(ORIG_ENV_PATH, 'utf8'));
    const accessToken = String(origEnv.SUPABASE_ACCESS_TOKEN || '').trim();
    if (!accessToken) {
        console.error('❌ Falta `SUPABASE_ACCESS_TOKEN` en `.env.original_deposito`.');
        process.exit(1);
    }

    const projectRef = extraerProjectRef(origEnv.SUPABASE_B2B_URL);
    let sql = opts.query;
    if (opts.file) {
        const sqlPath = path.resolve(ROOT_DIR, opts.file);
        if (!fs.existsSync(sqlPath)) {
            console.error(`❌ No se encontró el archivo SQL: ${sqlPath}`);
            process.exit(1);
        }
        sql = fs.readFileSync(sqlPath, 'utf8');
    }

    const apiUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql })
    });

    const rawText = await res.text();
    if (!res.ok) {
        const sanitized = rawText.replace(/sbp_[A-Za-z0-9_]+/g, 'sbp_***');
        console.error(`❌ Error en Supabase Management API (HTTP ${res.status}): ${sanitized}`);
        process.exit(1);
    }

    try {
        const json = JSON.parse(rawText);
        console.log(JSON.stringify(json, null, 2));
    } catch (_) {
        console.log(rawText);
    }
}

main().catch((err) => {
    const msg = String(err && err.message ? err.message : err).replace(/sbp_[A-Za-z0-9_]+/g, 'sbp_***');
    console.error('❌ Error inesperado:', msg);
    process.exit(1);
});
