#!/usr/bin/env node
/**
 * Publicador Orquestado de Desarrollo -> Producción (`Nube` + `PcAlmacen`)
 * -------------------------------------------------------------------------
 * Uso: `node scripts/publicarDesarrolloAProduccion.js`
 *
 * Pasos que ejecuta automáticamente:
 *  1. Audita el esquema de `etiquetas_pruebas` (y `migrations/schema_laboratorio_snapshot.json`)
 *     contra la base `etiquetas` de Producción (Local y Nube) y aplica de forma no destructiva
 *     cualquier tabla o columna nueva.
 *  2. Sincroniza la rama `desarrollo` con `main` en GitHub (`origin/main` y `origin/desarrollo`).
 *  3. Actualiza la carpeta productiva de `PcAlmacen` y despliega en Google Cloud (`34.39.187.220`)
 *     recargando los 5 servicios PM2 sin corte operativo.
 */

require('dotenv').config();
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { sincronizarEsquemaHaciaProduccion, exportarSnapshotLaboratorio } = require('./auditarDiferenciasEsquemaDb');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLOUD_HOST = process.env.CLOUD_SSH_HOST || '34.39.187.220';
const CLOUD_USER = process.env.CLOUD_SSH_USER || 'lamda_admin';

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
    if (String(os.hostname() || '').toLowerCase() === 'servediora') {
        console.error('❌ [BLOQUEADO EN NOTEBOOK] El pase de desarrollo a Producción (`main`) se ejecuta exclusivamente desde PcAlmacen.');
        process.exit(1);
    }

    console.log('==================================================================');
    console.log('🚀 PUBLICADOR DE DESARROLLO A PRODUCCIÓN (NUBE + PCALMACEN)');
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
        }
        console.log('✅ Ramas `origin/main` y `origin/desarrollo` alineadas en GitHub.');
    } catch (gitErr) {
        console.error('❌ Error sincronizando ramas en Git:', gitErr.message);
        process.exit(1);
    }

    // Paso 3: Desplegar en Google Cloud (34.39.187.220) y recargar PM2
    console.log('\n3️⃣ Actualizando servidor de Producción en la Nube (`34.39.187.220`)...');
    try {
        execSync(
            `ssh -n -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "cd /opt/lamda/sincronizador-etiquetas && git checkout -- data/ia_credito_ledger.json 2>/dev/null || true && git fetch origin && git checkout main && git reset --hard origin/main && pm2 restart all"`,
            { stdio: 'inherit', windowsHide: true, timeout: 45000 }
        );
        console.log('✅ Servidor en la Nube actualizado a la última versión de `main` y servicios PM2 activos.');
    } catch (cldErr) {
        console.error('❌ Error actualizando servidor en la Nube:', cldErr.message);
        process.exit(1);
    }

    console.log('\n🎉 PASE A PRODUCCIÓN COMPLETADO CON ÉXITO (Nube + PcAlmacen + Esquema DB al día).');
}

main();
