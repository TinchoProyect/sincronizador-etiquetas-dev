#!/usr/bin/env node
/**
 * Orquestador de Rollback de Emergencia (Nube -> PcAlmacen en < 3 min)
 * --------------------------------------------------------------------
 * Ejecutado por `scripts/rollback-nube-a-pcalmacen.bat`:
 *  1. Intenta conectarse al VPS (`CLOUD_SSH_HOST`) con timeout corto (5s):
 *     - Si responde, detiene primero `pm2 stop all` en el VPS para evitar doble servidor activo
 *       (split-brain / doble facturación ARCA o colisión de WhatsApp).
 *     - Descarga una última copia rápida de la base (`pg_dump | gzip -1`) y de `ASSET_PATHS`.
 *     - Si el VPS no responde en pocos segundos (caída de internet o del VPS), pasa directo al
 *       último backup local en disco (`backups/espejo_nube/etiquetas_nube_latest.sql`).
 *  2. Toma las credenciales de PostgreSQL desde el `.env` local (`DB_PASSWORD`), levanta el candado
 *     `default_transaction_read_only = off` y cierra todas las conexiones locales abiertas sobre
 *     `etiquetas` (`pg_terminate_backend`) para que nada bloquee la restauración de emergencia.
 *  3. Restaura `etiquetas_nube_latest.sql` sobre `etiquetas` y reconstruye el Ticket `TA` de ARCA/AFIP
 *     respetando el vencimiento más reciente (`expira_en` vs archivo en disco).
 *  4. Limpia todas las banderas de modo nube/prueba en `.env` para volver a `LAMDA_ROLE=LOCAL_PRIMARY`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const { Client } = require('pg');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.resolve(ROOT_DIR, '.env');
require('dotenv').config({ path: ENV_PATH });

const {
    reconstruirTaAfipDesdeBase,
    sincronizarArchivosFisicosSSH,
    detectarBinarioPostgres,
    obtenerExpiracionTaMs
} = require('./syncEspejoDesdeNube');

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

function detenerVpsYCapturarUltimoSnapshot(mirrorDir) {
    const sshHost = String(process.env.CLOUD_SSH_HOST || '34.39.187.220').trim();
    const sshUser = String(process.env.CLOUD_SSH_USER || 'lamda_admin').trim();
    const cloudDb = process.env.CLOUD_DB_NAME || 'etiquetas';
    const cloudUser = process.env.CLOUD_DB_USER || 'postgres';
    const cloudPass = process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || 'postgres';
    const cloudPort = parseInt(process.env.CLOUD_DB_PORT || '5432', 10);

    if (!sshHost) {
        console.log('ℹ️ [ROLLBACK] Sin CLOUD_SSH_HOST configurado; se usará directamente el último espejo local en disco.');
        return false;
    }

    const sshKey = detectarClaveSsh();
    const keyArg = sshKey ? `-i "${sshKey}"` : '';
    const fastSshOpts = `${keyArg} -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=5 -o ServerAliveInterval=3 -o ServerAliveCountMax=2`;

    try {
        console.log(`🛑 [ROLLBACK] Intentando detener servicios en VPS (${sshUser}@${sshHost}) para evitar doble servidor activo...`);
        execSync(
            `ssh ${fastSshOpts} ${sshUser}@${sshHost} "pm2 stop all >/dev/null 2>&1 || true"`,
            { stdio: 'pipe', timeout: 10000 }
        );
        console.log('✅ [ROLLBACK] Servicios PM2 detenidos en el VPS.');

        const remoteGz = '/tmp/etiquetas_rollback_final.sql.gz';
        const localGz = path.join(mirrorDir, 'etiquetas_rollback_final.sql.gz');
        const latestPath = path.join(mirrorDir, 'etiquetas_nube_latest.sql');

        console.log('☁️ [ROLLBACK] VPS accesible: descargando última copia rápida en caliente tras detener PM2...');
        execSync(
            `ssh ${fastSshOpts} ${sshUser}@${sshHost} "PGPASSWORD='${cloudPass}' pg_dump -h 127.0.0.1 -p ${cloudPort} -U ${cloudUser} -d ${cloudDb} --clean --if-exists --no-owner --no-privileges | gzip -1 > ${remoteGz}"`,
            { stdio: 'pipe', timeout: 45000 }
        );
        execSync(
            `scp -q ${fastSshOpts} "${sshUser}@${sshHost}:${remoteGz}" "${localGz}"`,
            { stdio: 'pipe', timeout: 45000 }
        );
        const sqlBuf = zlib.gunzipSync(fs.readFileSync(localGz));
        fs.writeFileSync(latestPath, sqlBuf);
        console.log(`✅ [ROLLBACK] Última copia rápida descargada del VPS (${(sqlBuf.length / (1024 * 1024)).toFixed(2)} MB).`);
        return true;
    } catch (err) {
        console.warn(`⚠️ [ROLLBACK] El VPS no respondió en pocos segundos (${err.message}). Pasando directo al último backup local en disco.`);
        return false;
    }
}

function copiarActivosAisladosPreCorteSiExisten(mirrorDir) {
    const isolatedRoot = path.join(mirrorDir, 'assets_mirror');
    if (!fs.existsSync(isolatedRoot)) return;
    const certsTarget = path.join(ROOT_DIR, 'src/facturacion/certs');
    const certsSource = path.join(isolatedRoot, 'src/facturacion/certs');

    if (fs.existsSync(certsSource)) {
        if (!fs.existsSync(certsTarget)) fs.mkdirSync(certsTarget, { recursive: true });
        for (const name of fs.readdirSync(certsSource)) {
            const srcFile = path.join(certsSource, name);
            const dstFile = path.join(certsTarget, name);
            if (/^TA-.*\.json$/i.test(name) && fs.existsSync(dstFile)) {
                const srcExp = obtenerExpiracionTaMs(fs.readFileSync(srcFile, 'utf8'));
                const dstExp = obtenerExpiracionTaMs(fs.readFileSync(dstFile, 'utf8'));
                if (dstExp >= srcExp) continue;
            }
            if (fs.statSync(srcFile).isFile()) {
                fs.copyFileSync(srcFile, dstFile);
            }
        }
    }
}

function limpiarBanderasEnvLocalPrimary() {
    if (!fs.existsSync(ENV_PATH)) return;
    let content = fs.readFileSync(ENV_PATH, 'utf8');
    const replacements = {
        LAMDA_ROLE: 'LOCAL_PRIMARY',
        LAMDA_CLOUD_MODE: 'false',
        LAMDA_ENFORCE_AUTH: 'false',
        LAMDA_MODO_PRUEBA_NUBE: 'false',
        LAMDA_MODO_LABORATORIO: 'false',
        MODO_LABORATORIO: 'false',
        ZEBRA_SOLO_ENCOLAR: 'false',
        WHATSAPP_STANDBY_PASIVO: 'false'
    };

    for (const [key, val] of Object.entries(replacements)) {
        const re = new RegExp(`^${key}=.*$`, 'gm');
        if (re.test(content)) {
            content = content.replace(re, `${key}=${val}`);
        } else {
            content = content.trimEnd() + `\n${key}=${val}\n`;
        }
    }
    fs.writeFileSync(ENV_PATH, content, 'utf8');
    console.log('✅ [ROLLBACK] Banderas de modo nube/prueba limpiadas en `.env` (LAMDA_ROLE=LOCAL_PRIMARY).');
}

async function ejecutarRollback() {
    const mirrorDir = path.resolve(ROOT_DIR, 'backups/espejo_nube');
    if (!fs.existsSync(mirrorDir)) {
        fs.mkdirSync(mirrorDir, { recursive: true });
    }

    const vpsResponded = detenerVpsYCapturarUltimoSnapshot(mirrorDir);

    const localHost = process.env.LOCAL_DB_HOST || process.env.DB_HOST || 'localhost';
    const localPort = parseInt(process.env.LOCAL_DB_PORT || process.env.DB_PORT || '5432', 10);
    const localUser = process.env.LOCAL_DB_USER || process.env.DB_USER || 'postgres';
    const localPass = process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || 'postgres';
    const targetDb = process.env.ROLLBACK_TARGET_DB_NAME || 'etiquetas';

    const adminClient = new Client({
        host: localHost,
        port: localPort,
        user: localUser,
        password: localPass,
        database: 'postgres'
    });

    await adminClient.connect();
    try {
        console.log(`🔓 [ROLLBACK] Levantando candado Read-Only y cerrando conexiones abiertas sobre \`${targetDb}\`...`);
        await adminClient.query(`ALTER DATABASE ${targetDb} SET default_transaction_read_only = off;`);
        await adminClient.query(
            `SELECT pg_terminate_backend(pid)
             FROM pg_stat_activity
             WHERE datname = $1 AND pid <> pg_backend_pid();`,
            [targetDb]
        );
    } finally {
        await adminClient.end();
    }

    const latestPath = path.join(mirrorDir, 'etiquetas_nube_latest.sql');
    if (fs.existsSync(latestPath)) {
        const psqlBin = detectarBinarioPostgres('psql');
        console.log(`📥 [ROLLBACK] Restaurando espejo (${latestPath}) sobre base local \`${targetDb}\`...`);
        execSync(`"${psqlBin}" -h ${localHost} -p ${localPort} -U ${localUser} -d ${targetDb} -f "${latestPath}"`, {
            env: { ...process.env, PGPASSWORD: localPass },
            stdio: 'ignore'
        });
        console.log(`✅ [ROLLBACK] Base \`${targetDb}\` restaurada con éxito.`);
    } else {
        console.warn('⚠️ [ROLLBACK] No se encontró `etiquetas_nube_latest.sql`; se conserva el estado actual de la base local.');
    }

    if (vpsResponded && typeof sincronizarArchivosFisicosSSH === 'function') {
        try {
            sincronizarArchivosFisicosSSH(ROOT_DIR, mirrorDir);
        } catch (_) {}
    } else {
        copiarActivosAisladosPreCorteSiExisten(mirrorDir);
    }

    console.log('🔐 [ROLLBACK] Reconstruyendo Ticket de Acceso (TA) vigente de ARCA/AFIP respetando fecha de expiración más reciente...');
    const tas = await reconstruirTaAfipDesdeBase({
        host: localHost,
        port: localPort,
        user: localUser,
        password: localPass,
        database: targetDb
    }, ROOT_DIR);
    console.log(`✅ [ROLLBACK] TA(s) de ARCA/AFIP verificados en disco (${tas}).`);

    limpiarBanderasEnvLocalPrimary();
}

if (require.main === module) {
    ejecutarRollback().catch((err) => {
        console.error('❌ [ROLLBACK] Error durante la secuencia de rollback:', err.message);
        process.exit(1);
    });
}

module.exports = {
    ejecutarRollback,
    limpiarBanderasEnvLocalPrimary
};
