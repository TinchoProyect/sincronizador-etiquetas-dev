/**
 * Endpoint de Estado de Conexión, Base de Datos, Última Sincronización y Servicios Activos
 * para el recuadro compacto de la Pantalla Principal (`#pizarra-conexion-global-widget`).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

function checkPort(portNum, urlPath = '/') {
    return new Promise((resolve) => {
        const reqHttp = http.get('http://127.0.0.1:' + portNum + urlPath, { timeout: 2200 }, (r) => {
            r.resume();
            resolve(r.statusCode >= 200 && r.statusCode < 500);
        });
        reqHttp.on('error', () => resolve(false));
        reqHttp.on('timeout', () => {
            reqHttp.destroy();
            resolve(false);
        });
    });
}

function registerConnectionBoxRoutes(app, router, pool) {
    const handler = async (req, res) => {
        try {
            const [p3000, p3002, p3003, p3004, p3005] = await Promise.all([
                checkPort(3000, '/'),
                checkPort(3002, '/'),
                checkPort(3003, '/'),
                checkPort(3004, '/'),
                checkPort(3005, '/login')
            ]);
            const list = [
                p3000 ? 'Etiquetas' : null,
                p3002 ? 'Producción' : null,
                p3003 ? 'Presupuestos' : null,
                p3004 ? 'Facturación' : null,
                p3005 ? 'Logística' : null
            ].filter(Boolean);

            const dbName = process.env.DB_NAME || 'etiquetas';
            const isLab = dbName === 'etiquetas_pruebas';
            const isCloud = process.platform !== 'win32';
            const nodeMode = isLab ? 'LABORATORIO' : (isCloud ? 'NUBE' : 'LOCAL');
            const nodeLabel = isLab ? 'L · Laboratorio' : (isCloud ? 'N · Nube (Cloud 24/7)' : 'L · Local (PcAlmacen)');

            let readOnly = 'off';
            let lastSyncDate = new Date();
            try {
                const rRo = await pool.query('SHOW default_transaction_read_only;');
                readOnly = rRo.rows[0]?.default_transaction_read_only || 'off';
                const rTs = await pool.query(`
                    SELECT GREATEST(
                        COALESCE((SELECT MAX(fecha_actualizacion) FROM public.presupuestos), NOW() - INTERVAL '7 days'),
                        COALESCE((SELECT MAX(created_at) FROM public.factura_facturas), NOW() - INTERVAL '7 days')
                    ) AS ultima
                `);
                if (rTs.rows[0]?.ultima) lastSyncDate = new Date(rTs.rows[0].ultima);
            } catch (_) {}

            const lastSyncFormatted = lastSyncDate.toLocaleString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            }) + ' hs';

            res.json({
                ok: true,
                nodeMode,
                nodeLabel,
                dbName,
                readOnly,
                lastSyncFormatted,
                servicesActive: list.length,
                servicesTotal: 5,
                servicesDetail: list.join(', ')
            });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    };

    if (app) {
        app.get('/api/system/connection-box', handler);
    }
    if (router) {
        router.get('/system/connection-box', handler);
    }
}

function applyPatches() {
    const serverPath = path.resolve(__dirname, '../app-etiquetas/server.js');
    if (fs.existsSync(serverPath)) {
        let s = fs.readFileSync(serverPath, 'utf8');
        if (!s.includes('connectionBoxEndpoint')) {
            s = s.replace(
                '// Módulo Producción (resumen_faltantes_parciales)',
                'require("../shared/connectionBoxEndpoint").registerConnectionBoxRoutes(app, router, pool);\n// Módulo Producción (resumen_faltantes_parciales)'
            );
            fs.writeFileSync(serverPath, s, 'utf8');
            console.log('✅ Registered connectionBoxEndpoint in', serverPath);
        }
    }

    const runtimePath = path.resolve(__dirname, './lamdaCloudRuntime.js');
    if (fs.existsSync(runtimePath)) {
        let sRt = fs.readFileSync(runtimePath, 'utf8');
        if (!sRt.includes('isAlreadyDesktopAppWindow')) {
            const helper = `
    function isAlreadyDesktopAppWindow() {
        try {
            if (window.location.search.indexOf('desktop_app=1') !== -1) {
                sessionStorage.setItem('lamda_is_desktop_app', '1');
                return true;
            }
            if (sessionStorage.getItem('lamda_is_desktop_app') === '1') return true;
            if (window.__lamdaZebraPhysicalToken) return true;
            if (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: minimal-ui)').matches)) return true;
            if (!isMobileBrowser() && (window.outerHeight - window.innerHeight < 65)) return true;
        } catch (e) {}
        return false;
    }
`;
            sRt = sRt.replace('function isMobileBrowser()', helper + '\n    function isMobileBrowser()');
            sRt = sRt.replace(
                "if (!document.getElementById('btn-header-install-lamda-prueba')) {",
                "if (!isAlreadyDesktopAppWindow() && !document.getElementById('btn-header-install-lamda-prueba')) {"
            );
            sRt = sRt.replace(
                "if (!document.getElementById('tree-item-install-lamda-prueba')) {",
                "if (!isAlreadyDesktopAppWindow() && !document.getElementById('tree-item-install-lamda-prueba')) {"
            );
            fs.writeFileSync(runtimePath, sRt, 'utf8');
            console.log('✅ Updated lamdaCloudRuntime.js to hide install button in Desktop App mode');
        }
    }
}

if (require.main === module && process.argv.includes('--apply-patches')) {
    applyPatches();
}

module.exports = { registerConnectionBoxRoutes };
