#!/usr/bin/env node
/**
 * LAMDA Cloud Mirror Sync (Cada 15 minutos — Nube -> PcAlmacen)
 * -------------------------------------------------------------
 * Mantiene en `PcAlmacen` una réplica local calzada al minuto desde el VPS en la nube:
 *  1. Descarga el dump completo de PostgreSQL (`pg_dump`) hacia `backups/espejo_nube/etiquetas_nube_latest.sql`
 *     (vía túnel SSH comprimido si `CLOUD_SSH_HOST` está definido, ya que el puerto 5432 del VPS está cerrado a internet)
 *     y lo restaura sobre la base local de respaldo (`etiquetas_espejo_nube` o la indicada en `LOCAL_MIRROR_DB_NAME`).
 *  2. Barrera de seguridad innegociable:
 *     - JAMÁS permite restaurar sobre la base productiva `etiquetas`.
 *     - Mientras `PcAlmacen` NO esté en rol `GALPON_BRIDGE_ONLY` (y no se haya definido `MIRROR_ASSETS_ROOT`),
 *       desvía la descarga de archivos físicos y la reconstrucción del TA de ARCA hacia una carpeta aislada
 *       (`backups/espejo_nube/assets_mirror`) para no pisar archivos locales de `ROOT_DIR` antes del corte.
 *  3. Si `LAMDA_ROLE=GALPON_BRIDGE_ONLY`, asegura que la base local `etiquetas` mantenga
 *     `default_transaction_read_only = on` (Capa 3 del Triple Candado Anti-Doble Arranque).
 *  4. Sincroniza por SSH/SCP los 6 activos físicos fuera de BD (`ASSET_PATHS`) y luego reconstruye en disco
 *     (`src/facturacion/certs/TA-*.json`) el Ticket de Acceso vigente de ARCA/AFIP leído desde `public.factura_afip_ta`,
 *     comparando siempre las fechas de vencimiento (`expirationtime` vs `expira_en`) para que jamás se pise
 *     un TA más reciente por uno anterior.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const ROOT_DIR = path.resolve(__dirname, '..');

const ASSET_PATHS = [
    'src/logistica/public/uploads',
    'src/facturacion/pdfs',
    'src/facturacion/certs',
    'src/app-etiquetas/documentos',
    'src/services/gsheets',
    'data/ia_credito_ledger.json'
];

function esRolGalponBridgeOnly() {
    return String(process.env.LAMDA_ROLE || '').trim().toUpperCase() === 'GALPON_BRIDGE_ONLY';
}

function obtenerDirectorioEspejo() {
    if (process.env.MIRROR_BACKUP_DIR) {
        return path.resolve(process.env.MIRROR_BACKUP_DIR);
    }
    return path.resolve(ROOT_DIR, 'backups/espejo_nube');
}

/**
 * Mientras `PcAlmacen` no esté en `LAMDA_ROLE=GALPON_BRIDGE_ONLY` y no se haya fijado
 * `MIRROR_ASSETS_ROOT`, desvía activos físicos y tickets TA a `backups/espejo_nube/assets_mirror`
 * para no pisar archivos vivos de `ROOT_DIR` antes del corte.
 */
function obtenerRaizActivos() {
    if (process.env.MIRROR_ASSETS_ROOT) {
        return path.resolve(process.env.MIRROR_ASSETS_ROOT);
    }
    if (esRolGalponBridgeOnly()) {
        return ROOT_DIR;
    }
    return path.join(obtenerDirectorioEspejo(), 'assets_mirror');
}

function detectarClaveSsh() {
    if (process.env.CLOUD_SSH_KEY_PATH && fs.existsSync(process.env.CLOUD_SSH_KEY_PATH)) {
        return process.env.CLOUD_SSH_KEY_PATH;
    }
    const ed25519 = path.join(os.homedir(), '.ssh', 'id_ed25519');
    if (fs.existsSync(ed25519)) return ed25519;
    const rsa = path.join(os.homedir(), '.ssh', 'id_rsa');
    if (fs.existsSync(rsa)) return rsa;
    return null;
}

function detectarBinarioPostgres(binName) {
    const candidatos = [
        process.env.PG_BIN_PATH ? path.join(process.env.PG_BIN_PATH, `${binName}.exe`) : null,
        `C:\\Program Files\\PostgreSQL\\17\\bin\\${binName}.exe`,
        `C:\\Program Files\\PostgreSQL\\16\\bin\\${binName}.exe`,
        `C:\\Program Files\\PostgreSQL\\15\\bin\\${binName}.exe`,
        `C:\\Program Files\\PostgreSQL\\14\\bin\\${binName}.exe`,
        `C:\\Program Files\\PostgreSQL\\13\\bin\\${binName}.exe`,
        `C:\\Program Files\\PostgreSQL\\12\\bin\\${binName}.exe`,
        binName
    ].filter(Boolean);

    for (const c of candidatos) {
        if (c === binName || fs.existsSync(c)) return c;
    }
    return binName;
}

/**
 * Extrae el timestamp en milisegundos del vencimiento (`expirationtime`) de un objeto o archivo `TA-*.json`.
 */
function obtenerExpiracionTaMs(taObjOrRaw) {
    try {
        const obj = typeof taObjOrRaw === 'string' ? JSON.parse(taObjOrRaw) : taObjOrRaw;
        if (!obj || typeof obj !== 'object') return 0;
        const expHeader =
            (Array.isArray(obj.header) && obj.header[1] && obj.header[1].expirationtime) ||
            (obj.header && obj.header.expirationtime) ||
            (obj.credentials && obj.credentials.expirationtime) ||
            obj.expira_en ||
            null;
        if (!expHeader) return 0;
        const ms = new Date(expHeader).getTime();
        return Number.isFinite(ms) ? ms : 0;
    } catch (_) {
        return 0;
    }
}

function capturarSnapshotTasEnDisco(certsDir) {
    const snapshot = new Map();
    if (!fs.existsSync(certsDir)) return snapshot;
    try {
        for (const name of fs.readdirSync(certsDir)) {
            if (/^TA-.*\.json$/i.test(name)) {
                const full = path.join(certsDir, name);
                const raw = fs.readFileSync(full, 'utf8');
                snapshot.set(name, {
                    raw,
                    expMs: obtenerExpiracionTaMs(raw)
                });
            }
        }
    } catch (_) {}
    return snapshot;
}

function protegerTasMasRecientesTrasExtraccion(certsDir, preExtractSnapshot) {
    if (!preExtractSnapshot || preExtractSnapshot.size === 0 || !fs.existsSync(certsDir)) return;
    for (const [name, prev] of preExtractSnapshot.entries()) {
        if (!prev.expMs) continue;
        const full = path.join(certsDir, name);
        let currentExpMs = 0;
        if (fs.existsSync(full)) {
            try {
                currentExpMs = obtenerExpiracionTaMs(fs.readFileSync(full, 'utf8'));
            } catch (_) {}
        }
        if (prev.expMs > currentExpMs) {
            fs.writeFileSync(full, prev.raw, 'utf8');
            console.log(`🛡️ [ESPEJO-NUBE] Conservado ${name} previo en disco por tener vencimiento más reciente (${new Date(prev.expMs).toISOString()}).`);
        }
    }
}

async function reconstruirTaAfipDesdeBase(dbConfig, assetsRoot = obtenerRaizActivos()) {
    const certsDir = path.resolve(assetsRoot, 'src/facturacion/certs');
    const client = new Client(dbConfig);
    try {
        await client.connect();
        const res = await client.query(`
            SELECT entorno, servicio, token, sign, expira_en, cuit, ta_raw_json
            FROM public.factura_afip_ta
            WHERE expira_en > NOW()
            ORDER BY expira_en DESC
        `);
        if (!fs.existsSync(certsDir)) {
            fs.mkdirSync(certsDir, { recursive: true });
        }
        let count = 0;
        for (const row of (res.rows || [])) {
            const isProd = String(row.entorno || '').toUpperCase() === 'PROD';
            const cuit = String(row.cuit || '23248921749').trim();
            const service = String(row.servicio || 'wsfe').trim();
            const fileName = `TA-${cuit}-${service}${isProd ? '-production' : ''}.json`;
            const targetFile = path.join(certsDir, fileName);

            const dbExpMs = new Date(row.expira_en).getTime();
            if (!Number.isFinite(dbExpMs) || dbExpMs <= Date.now()) {
                continue;
            }

            let diskExpMs = 0;
            if (fs.existsSync(targetFile)) {
                try {
                    diskExpMs = obtenerExpiracionTaMs(fs.readFileSync(targetFile, 'utf8'));
                } catch (_) {}
            }

            if (diskExpMs > dbExpMs) {
                console.log(`🛡️ [ESPEJO-NUBE] El archivo ${fileName} en disco tiene vencimiento más reciente (${new Date(diskExpMs).toISOString()}) que la BD (${new Date(dbExpMs).toISOString()}); no se pisa.`);
                count++;
                continue;
            }

            const payload = (row.ta_raw_json && typeof row.ta_raw_json === 'object' && row.ta_raw_json.credentials)
                ? row.ta_raw_json
                : {
                    header: [
                        { version: '1.0' },
                        { expirationtime: new Date(dbExpMs).toISOString() }
                    ],
                    credentials: {
                        token: row.token,
                        sign: row.sign
                    }
                };
            fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), 'utf8');
            count++;
        }
        return count;
    } catch (err) {
        console.warn('⚠️ [ESPEJO-NUBE] Aviso al reconstruir TA de AFIP desde BD:', err.message);
        return 0;
    } finally {
        try { await client.end(); } catch (_) {}
    }
}

async function aplicarCandadoReadOnlySiCorresponde(localPgConfig) {
    if (!esRolGalponBridgeOnly()) return;

    const client = new Client({ ...localPgConfig, database: 'postgres' });
    try {
        await client.connect();
        await client.query(`ALTER DATABASE etiquetas SET default_transaction_read_only = on;`);
        console.log('🔒 [ESPEJO-NUBE] Candado SQL Read-Only verificado sobre base local `etiquetas` (GALPON_BRIDGE_ONLY).');
    } catch (err) {
        console.warn('⚠️ [ESPEJO-NUBE] No se pudo aplicar Read-Only sobre `etiquetas`:', err.message);
    } finally {
        try { await client.end(); } catch (_) {}
    }
}

function sincronizarArchivosFisicosSSH(assetsRoot = obtenerRaizActivos(), mirrorDir = obtenerDirectorioEspejo()) {
    const sshHost = String(process.env.CLOUD_SSH_HOST || '').trim();
    const sshUser = String(process.env.CLOUD_SSH_USER || 'lamda_admin').trim();
    const sshRemoteDir = String(process.env.CLOUD_REMOTE_APP_DIR || '/opt/lamda/sincronizador-etiquetas').replace(/\/+$/, '');
    if (!sshHost) {
        console.log('ℹ️ [ESPEJO-NUBE] CLOUD_SSH_HOST no definido; omitiendo rsync/scp de carpetas físicas en esta corrida.');
        return [];
    }

    const sshKey = detectarClaveSsh();
    const keyArg = sshKey ? `-i "${sshKey}"` : '';
    const sshOpts = `${keyArg} -o StrictHostKeyChecking=no -o BatchMode=yes`;

    if (!fs.existsSync(assetsRoot)) {
        fs.mkdirSync(assetsRoot, { recursive: true });
    }

    const certsDir = path.resolve(assetsRoot, 'src/facturacion/certs');
    const preExtractTaSnapshot = capturarSnapshotTasEnDisco(certsDir);

    const remoteTar = '/tmp/lamda_assets_mirror.tar.gz';
    const localTar = path.join(mirrorDir, 'lamda_assets_mirror.tar.gz');
    const relList = ASSET_PATHS.map(p => `"${p}"`).join(' ');

    try {
        execSync(
            `ssh ${sshOpts} ${sshUser}@${sshHost} "cd '${sshRemoteDir}' && tar -czf ${remoteTar} --ignore-failed-read ${relList}"`,
            { stdio: 'pipe', timeout: 120000 }
        );
        execSync(
            `scp -q ${sshOpts} "${sshUser}@${sshHost}:${remoteTar}" "${localTar}"`,
            { stdio: 'pipe', timeout: 120000 }
        );
        execSync(
            `tar -xzf "${localTar}" -C "${assetsRoot}"`,
            { stdio: 'pipe', timeout: 120000 }
        );
        protegerTasMasRecientesTrasExtraccion(certsDir, preExtractTaSnapshot);
        const sincronizados = ASSET_PATHS.filter(rel => fs.existsSync(path.join(assetsRoot, rel)));
        console.log(`📁 [ESPEJO-NUBE] Activos físicos sincronizados (${sincronizados.length}/${ASSET_PATHS.length}) en ${assetsRoot}: ${sincronizados.join(', ')}`);
        return sincronizados;
    } catch (err) {
        console.warn(`⚠️ [ESPEJO-NUBE] Aviso sincronizando activos por tar/scp (${err.message}); intentando copia individual...`);
        const sincronizados = [];
        for (const relPath of ASSET_PATHS) {
            const localTarget = path.resolve(assetsRoot, relPath);
            const parentDir = path.dirname(localTarget);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }
            try {
                const cmd = `scp -r -q ${sshOpts} "${sshUser}@${sshHost}:${sshRemoteDir}/${relPath}" "${parentDir}"`;
                execSync(cmd, { stdio: 'ignore', timeout: 120000 });
                sincronizados.push(relPath);
                console.log(`📁 [ESPEJO-NUBE] Activo físico sincronizado: ${relPath}`);
            } catch (e2) {
                console.warn(`⚠️ [ESPEJO-NUBE] Aviso sincronizando ${relPath}: ${e2.message}`);
            }
        }
        protegerTasMasRecientesTrasExtraccion(certsDir, preExtractTaSnapshot);
        return sincronizados;
    }
}

async function ejecutarSincronizacionEspejo() {
    const t0 = Date.now();
    const mirrorDir = obtenerDirectorioEspejo();
    const assetsRoot = obtenerRaizActivos();

    if (!fs.existsSync(mirrorDir)) {
        fs.mkdirSync(mirrorDir, { recursive: true });
    }
    if (!esRolGalponBridgeOnly() && !process.env.MIRROR_ASSETS_ROOT) {
        console.log(`🛡️ [ESPEJO-NUBE] Modo seguro pre-corte (LAMDA_ROLE != GALPON_BRIDGE_ONLY): activos físicos y TA se guardarán aislados en ${assetsRoot} sin tocar ROOT_DIR.`);
    }

    const sshHost = String(process.env.CLOUD_SSH_HOST || '').trim();
    const sshUser = String(process.env.CLOUD_SSH_USER || 'lamda_admin').trim();
    const cloudHost = String(process.env.CLOUD_DB_HOST || sshHost || '').trim();
    const cloudPort = parseInt(process.env.CLOUD_DB_PORT || '5432', 10);
    const cloudDb = process.env.CLOUD_DB_NAME || 'etiquetas';
    const cloudUser = process.env.CLOUD_DB_USER || 'postgres';
    const cloudPass = process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || 'postgres';

    const localHost = process.env.LOCAL_DB_HOST || 'localhost';
    const localPort = parseInt(process.env.LOCAL_DB_PORT || '5432', 10);
    const localUser = process.env.LOCAL_DB_USER || 'postgres';
    const localPass = process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || 'postgres';
    const localMirrorDb = String(process.env.LOCAL_MIRROR_DB_NAME || 'etiquetas_espejo_nube').trim();

    if (localMirrorDb.toLowerCase() === 'etiquetas') {
        throw new Error('BLOQUEO DE SEGURIDAD: LOCAL_MIRROR_DB_NAME no puede ser la base productiva `etiquetas`.');
    }

    await aplicarCandadoReadOnlySiCorresponde({
        host: localHost,
        port: localPort,
        user: localUser,
        password: localPass
    });

    if (!cloudHost && !sshHost) {
        console.log('ℹ️ [ESPEJO-NUBE] CLOUD_DB_HOST / CLOUD_SSH_HOST aún no configurados en .env. Verificando reconstrucción de TA AFIP en carpeta destino...');
        const tas = await reconstruirTaAfipDesdeBase({
            host: localHost,
            port: localPort,
            user: localUser,
            password: localPass,
            database: process.env.DB_NAME || 'etiquetas'
        }, assetsRoot);
        console.log(`✅ [ESPEJO-NUBE] Verificación completada (${tas} TA(s) vigentes en ${assetsRoot}).`);
        return { ok: true, mode: 'local_check_only', assetsRoot, tasReconstruidos: tas };
    }

    const pgDumpBin = detectarBinarioPostgres('pg_dump');
    const psqlBin = detectarBinarioPostgres('psql');
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const dumpPath = path.join(mirrorDir, `etiquetas_nube_${stamp}.sql`);
    const latestPath = path.join(mirrorDir, 'etiquetas_nube_latest.sql');

    if (sshHost) {
        const sshKey = detectarClaveSsh();
        const keyArg = sshKey ? `-i "${sshKey}"` : '';
        const sshOpts = `${keyArg} -o StrictHostKeyChecking=no -o BatchMode=yes`;
        const remoteGz = '/tmp/etiquetas_nube_mirror.sql.gz';
        const localGz = path.join(mirrorDir, 'etiquetas_nube_latest.sql.gz');

        console.log(`☁️ [ESPEJO-NUBE] Generando dump en caliente vía SSH en ${sshUser}@${sshHost} (${cloudDb})...`);
        execSync(
            `ssh ${sshOpts} ${sshUser}@${sshHost} "PGPASSWORD='${cloudPass}' pg_dump -h 127.0.0.1 -p ${cloudPort} -U ${cloudUser} -d ${cloudDb} --clean --if-exists --no-owner --no-privileges | gzip -1 > ${remoteGz}"`,
            { stdio: 'inherit', timeout: 180000 }
        );
        console.log(`⬇️ [ESPEJO-NUBE] Descargando snapshot comprimido desde ${sshHost}...`);
        execSync(
            `scp -q ${sshOpts} "${sshUser}@${sshHost}:${remoteGz}" "${localGz}"`,
            { stdio: 'inherit', timeout: 180000 }
        );
        const compressedBuf = fs.readFileSync(localGz);
        const sqlBuf = zlib.gunzipSync(compressedBuf);
        fs.writeFileSync(dumpPath, sqlBuf);
        fs.writeFileSync(latestPath, sqlBuf);
    } else {
        console.log(`☁️ [ESPEJO-NUBE] Descargando snapshot desde ${cloudHost}:${cloudPort}/${cloudDb}...`);
        execSync(`"${pgDumpBin}" -h ${cloudHost} -p ${cloudPort} -U ${cloudUser} -d ${cloudDb} --clean --if-exists --no-owner --no-privileges -f "${dumpPath}"`, {
            env: { ...process.env, PGPASSWORD: cloudPass },
            stdio: 'inherit'
        });
        fs.copyFileSync(dumpPath, latestPath);
    }

    // Asegurar base local espejo (`etiquetas_espejo_nube` o `etiquetas_espejo_test`)
    const adminClient = new Client({ host: localHost, port: localPort, user: localUser, password: localPass, database: 'postgres' });
    await adminClient.connect();
    const checkDb = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [localMirrorDb]);
    if (checkDb.rowCount === 0) {
        await adminClient.query(`CREATE DATABASE ${localMirrorDb}`);
    }
    await adminClient.end();

    console.log(`📥 [ESPEJO-NUBE] Restaurando espejo sobre base local \`${localMirrorDb}\`...`);
    execSync(`"${psqlBin}" -h ${localHost} -p ${localPort} -U ${localUser} -d ${localMirrorDb} -f "${latestPath}"`, {
        env: { ...process.env, PGPASSWORD: localPass },
        stdio: 'ignore'
    });

    // Primero sincronizar archivos físicos y luego reconstruir el TA desde BD comparando vencimientos
    // para que un archivo extraído del tar nunca pise un TA más reciente reconstruido desde PostgreSQL.
    const activosSincronizados = sincronizarArchivosFisicosSSH(assetsRoot, mirrorDir);

    const tas = await reconstruirTaAfipDesdeBase({
        host: localHost,
        port: localPort,
        user: localUser,
        password: localPass,
        database: localMirrorDb
    }, assetsRoot);

    const elapsedSeconds = Number(((Date.now() - t0) / 1000).toFixed(2));

    console.log(`✅ [ESPEJO-NUBE] Espejo completado en ${elapsedSeconds}s (${latestPath}) -> BD \`${localMirrorDb}\` + ${tas} TA(s) AFIP + ${activosSincronizados.length} activos físicos en ${assetsRoot}.`);
    return {
        ok: true,
        localMirrorDb,
        latestPath,
        assetsRoot,
        tasReconstruidos: tas,
        activosSincronizados,
        elapsedSeconds
    };
}

if (require.main === module) {
    ejecutarSincronizacionEspejo().catch((err) => {
        console.error('❌ [ESPEJO-NUBE] Error en sincronización de espejo:', err.message);
        process.exit(1);
    });
}

module.exports = {
    ejecutarSincronizacionEspejo,
    reconstruirTaAfipDesdeBase,
    sincronizarArchivosFisicosSSH,
    obtenerExpiracionTaMs,
    obtenerRaizActivos,
    detectarBinarioPostgres,
    ASSET_PATHS
};
