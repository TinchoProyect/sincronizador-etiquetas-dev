const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

let entornoCargado = false;

/**
 * Carga la configuración de entorno del módulo de Facturación (:3004)
 * usando el `.env` raíz del proyecto como fuente única de verdad para
 * credenciales compartidas y `src/facturacion/.env` únicamente como
 * complemento para variables específicas del módulo.
 */
function cargarEntornoFacturacion(options = {}) {
    if (entornoCargado && !options.force) {
        return;
    }

    const preLabMode = process.env.LAMDA_MODO_LABORATORIO || process.env.MODO_LABORATORIO;
    const preDbName = process.env.DB_NAME;
    const preSafeWa = process.env.SAFE_REDIRECT_WHATSAPP_TO;

    const rootEnvPath = options.rootEnvPath || path.resolve(__dirname, '..', '..', '..', '.env');
    const factEnvPath = options.factEnvPath || path.resolve(__dirname, '..', '.env');

    if (fs.existsSync(rootEnvPath)) {
        dotenv.config({ path: rootEnvPath, override: false });
    }
    if (fs.existsSync(factEnvPath)) {
        dotenv.config({ path: factEnvPath, override: false });
    }

    if (fs.existsSync(rootEnvPath) && fs.existsSync(factEnvPath)) {
        try {
            const rootParsed = dotenv.parse(fs.readFileSync(rootEnvPath, 'utf8'));
            const factParsed = dotenv.parse(fs.readFileSync(factEnvPath, 'utf8'));
            const rootKey = String(rootParsed.SUPABASE_SERVICE_KEY || '').trim();
            const factKey = String(factParsed.SUPABASE_SERVICE_KEY || '').trim();
            if (factKey && rootKey && factKey !== rootKey) {
                console.warn(
                    `⚠️ [FACTURACION-ENV] src/facturacion/.env define SUPABASE_SERVICE_KEY distinta (len=${factKey.length}) a la del .env raíz (len=${rootKey.length}). Se prioriza la fuente única del .env raíz.`
                );
            }
        } catch (err) {
            console.warn('⚠️ [FACTURACION-ENV] No se pudo auditar superposición de .env:', err.message);
        }
    }

    if (preLabMode === 'true' || preLabMode === '1' || preDbName === 'etiquetas_pruebas') {
        process.env.LAMDA_MODO_LABORATORIO = 'true';
        process.env.MODO_LABORATORIO = 'true';
        process.env.DB_NAME = 'etiquetas_pruebas';
        if (preSafeWa) {
            process.env.SAFE_REDIRECT_WHATSAPP_TO = preSafeWa;
        }
    }

    entornoCargado = true;
}

module.exports = {
    cargarEntornoFacturacion
};
