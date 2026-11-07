/**
 * Activa los Git Hooks versionados (.githooks/) en el repositorio actual
 * y, si existe en esta máquina (PcAlmacen), también en las carpetas hermanas
 * de Laboratorio y Producción.
 *
 * Uso: node scripts/activarGitHooks.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const candidateDirs = [
    path.resolve(__dirname, '..'),
    'C:\\Users\\Martin\\Documents\\LAMDA-Laboratorio',
    'C:\\Users\\Martin\\Documents\\sincronizador-etiquetas - copia'
];

const seen = new Set();
for (const dir of candidateDirs) {
    const norm = path.resolve(dir).toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);

    if (fs.existsSync(path.join(dir, '.git'))) {
        try {
            execSync('git config core.hooksPath .githooks', { cwd: dir, stdio: 'pipe', windowsHide: true });
            const configured = execSync('git config --get core.hooksPath', { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();
            console.log(`✅ [GIT-HOOKS] Activado en: ${dir} (core.hooksPath = ${configured})`);
        } catch (err) {
            console.warn(`⚠️ [GIT-HOOKS] No se pudo activar en ${dir}: ${err.message}`);
        }
    }
}
