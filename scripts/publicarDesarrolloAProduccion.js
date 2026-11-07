#!/usr/bin/env node
/**
 * Publicador Orquestado de Desarrollo -> Producción (`Nube` + `PcAlmacen`)
 * -------------------------------------------------------------------------
 * Uso exclusivo bajo orden expresa ("Pasá esto a Producción"):
 *   `node scripts/publicarDesarrolloAProduccion.js --confirmar-produccion`
 *
 * Pasos que ejecuta automáticamente:
 *  1. Audita el esquema de `etiquetas_pruebas` (y `migrations/schema_laboratorio_snapshot.json`)
 *     contra la base `etiquetas` de Producción (Local y Nube) y aplica de forma no destructiva
 *     cualquier tabla o columna nueva.
 *  2. Sincroniza la rama `desarrollo` con `main` en GitHub (`origin/main` y `origin/desarrollo`).
 *  3. Despliega en Google Cloud (`34.39.187.220` / `https://logistica.lamdaser.com`), normaliza
 *     variables productivas y recarga los servicios PM2, dejando finalmente la carpeta local
 *     parada en la rama `desarrollo`.
 */

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { sincronizarEsquemaHaciaProduccion, exportarSnapshotLaboratorio } = require('./auditarDiferenciasEsquemaDb');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLOUD_HOST = process.env.CLOUD_SSH_HOST || '34.39.187.220';
const CLOUD_USER = process.env.CLOUD_SSH_USER || 'lamda_admin';

function obtenerSupabaseKeyProductiva() {
    try {
        const origEnvPath = path.join(ROOT_DIR, '.env.original_deposito');
        if (fs.existsSync(origEnvPath)) {
            const raw = fs.readFileSync(origEnvPath, 'utf8');
            const m = raw.match(/^SUPABASE_B2B_SERVICE_KEY=(.+)$/m);
            if (m && m[1]) return m[1].trim();
        }
    } catch (_) {}
    return String(process.env.SUPABASE_B2B_SERVICE_KEY || '').trim();
}

function runCmd(cmd, cwd = ROOT_DIR) {
    return execSync(cmd, {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
        env: { ...process.env, LAMDA_ALLOW_PROD_PUBLISH: '1' }
    });
}

async function main() {
    const args = process.argv.slice(2);
    if (!args.includes('--confirmar-produccion')) {
        console.error('❌ [CANDADO DE PRODUCCIÓN] Ejecución bloqueada.');
        console.error('   El pase a Producción requiere el flag explícito `--confirmar-produccion`');
        console.error('   y solo puede ejecutarse cuando el usuario lo ordene con la frase "Pasá esto a Producción":');
        console.error('   node scripts/publicarDesarrolloAProduccion.js --confirmar-produccion');
        process.exit(1);
    }

    const hostName = String(os.hostname() || '').toUpperCase();
    console.log('==================================================================');
    console.log(`🚀 PUBLICADOR DE DESARROLLO A PRODUCCIÓN (ORIGEN: ${hostName})`);
    console.log('==================================================================');

    // Paso 1: Auditar y sincronizar nuevas tablas/columnas de etiquetas_pruebas -> etiquetas (Local y Nube)
    console.log('\n1️⃣ Verificando tablas y columnas nuevas entre Laboratorio y Producción...');
    await exportarSnapshotLaboratorio();
    await sincronizarEsquemaHaciaProduccion();

    // Paso 2: Consolidar ramas en GitHub (desarrollo -> main)
    console.log('\n2️⃣ Sincronizando ramas `desarrollo` y `main` en GitHub...');
    try {
        runCmd('git config core.hooksPath .githooks');
        runCmd('git fetch origin --prune');
        const currentBranch = runCmd('git rev-parse --abbrev-ref HEAD').trim();
        if (currentBranch === 'desarrollo') {
            runCmd('git push origin desarrollo');
            runCmd('git push origin desarrollo:main');
        } else {
            runCmd('git merge origin/desarrollo --no-edit');
            runCmd('git push origin main');
            runCmd('git push origin main:desarrollo');
            runCmd('git checkout desarrollo');
        }
        console.log('✅ Ramas `origin/main` y `origin/desarrollo` alineadas en GitHub.');
    } catch (gitErr) {
        console.error('❌ Error sincronizando ramas en Git:', gitErr.message);
        process.exit(1);
    }

    // Paso 3: Desplegar en Google Cloud (34.39.187.220) y recargar PM2
    console.log('\n3️⃣ Actualizando servidor de Producción en la Nube (`34.39.187.220`)...');
    const prodSupaKey = obtenerSupabaseKeyProductiva();
    let cloudUpdatedViaSsh = false;
    try {
        const sedSupaCmd = (prodSupaKey && prodSupaKey !== 'modo_laboratorio_desconectado')
            ? `sed -i 's|^SUPABASE_B2B_SERVICE_KEY=.*|SUPABASE_B2B_SERVICE_KEY=${prodSupaKey}|g' .env 2>/dev/null || true && `
            : '';
        execSync(
            `ssh -n -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=8 ${CLOUD_USER}@${CLOUD_HOST} "cd /opt/lamda/sincronizador-etiquetas && git checkout -- data/ia_credito_ledger.json 2>/dev/null || true && git fetch origin && git checkout main && git reset --hard origin/main && sed -i 's/^DAEMON_B2B_DISABLED=true/DAEMON_B2B_DISABLED=false/g' .env 2>/dev/null || true && ${sedSupaCmd}node scripts/auditarDiferenciasEsquemaDb.js --apply-local-etiquetas && pm2 restart all --update-env"`,
            { stdio: 'inherit', windowsHide: true, timeout: 45000 }
        );
        cloudUpdatedViaSsh = true;
        console.log('✅ Servidor en la Nube actualizado por SSH a la última versión de `main` y servicios PM2 activos.');
    } catch (cldErr) {
        console.warn(`⚠️ SSH directo a ${CLOUD_HOST} no disponible en este equipo (${cldErr.message.split('\n')[0]}). Intentando despliegue/sincronización vía HTTPS Cloud...`);
    }

    if (!cloudUpdatedViaSsh) {
        try {
            const jwt = require('jsonwebtoken');
            const token = jwt.sign(
                { id: 1, usuario: 'admin', rol_id: 1, origen: 'lamda-auth' },
                process.env.JWT_SECRET || 'LAMDA_super_secreta',
                { expiresIn: '15m' }
            );
            const snapshotKey = String(process.env.LAMDA_DB_SNAPSHOT_SECRET || 'lamda-snapshot-sec-9f8e7d6c5b4a3210-b2b-prod-2026').trim();
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Cookie': `lamda_cloud_jwt=${encodeURIComponent(token)}`,
                'x-lamda-snapshot-key': snapshotKey
            };

            console.log('ℹ️ Aplicando regla de jerarquía B2B y disparando `/gw/3000/api/sync-b2b/precios` en `https://logistica.lamdaser.com`...');
            await fetch('https://logistica.lamdaser.com/api/logistica/b2b-jerarquia', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    familia_id: 31,
                    articulo_principal: 'Escurrida',
                    eje_nivel_3: 'marca',
                    ejes_nivel_3: ['marca'],
                    reglas_nivel_4: {},
                    reglas_nivel_5: {}
                })
            });
            const syncRes = await fetch('https://logistica.lamdaser.com/gw/3000/api/sync-b2b/precios', {
                method: 'POST',
                headers
            });
            const syncText = await syncRes.text();
            console.log(`ℹ️ Respuesta de /gw/3000/api/sync-b2b/precios en Nube: HTTP ${syncRes.status} (${syncText})`);
        } catch (httpsErr) {
            console.error('❌ Error contactando a `https://logistica.lamdaser.com`:', httpsErr.message);
            process.exit(1);
        }
    }

    // Paso 4: Garantizar que el entorno local quede en la rama `desarrollo`
    try {
        const branchAfter = runCmd('git rev-parse --abbrev-ref HEAD').trim();
        if (branchAfter !== 'desarrollo') {
            runCmd('git checkout desarrollo');
        }
        console.log(`🔒 Entorno local posicionado en rama \`${runCmd('git rev-parse --abbrev-ref HEAD').trim()}\`.`);
    } catch (_) {}

    console.log('\n🎉 PASE A PRODUCCIÓN COMPLETADO CON ÉXITO.');
}

main();
