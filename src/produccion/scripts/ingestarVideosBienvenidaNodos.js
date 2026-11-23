'use strict';

/**
 * Script Idempotente de Ingesta de Videos de Bienvenida / Presentación por Nodo
 * -----------------------------------------------------------------------------
 * Uso (Laboratorio):
 *   $env:LAMDA_MODO_LABORATORIO="true"; $env:DB_NAME="etiquetas_pruebas"; $env:DB_PASSWORD="taKionga"
 *   node src/produccion/scripts/ingestarVideosBienvenidaNodos.js
 *
 * Opciones CLI:
 *   --slug=paraiso,moro,manso   Lista de slugs a procesar (default: paraiso,moro,manso)
 *   --source-dir=<ruta>         Carpeta raíz con subcarpetas <slug>/*.mp4
 *   --activo=true|false         Perilla maestra inicial (default: true)
 *   --tienda=true|false         Mostrar acceso discreto en tienda (default: true)
 *   --difusion=true|false       Habilitar opción de video en Kit de Difusión (default: true)
 *   --preserve-prefs            Conservar las perillas actuales si el nodo ya tenía video
 *   --allow-silent              Permitir videos sin pista de audio (por defecto exige audio AAC)
 *   --dry-run                   Validar archivos y nodos sin modificar BD ni disco
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
try {
    require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });
} catch (_) {}

const db = require('../config/database');
const nodosFotosService = require('../services/nodosFotosService');

const ETIQUETAS_DEFAULT_POR_SLUG = {
    paraiso: '¿Cómo funciona?',
    moro: '¿Cómo funciona?',
    manso: 'Ver presentación'
};

function parseArgs(argv) {
    const out = {
        slugs: ['paraiso', 'moro', 'manso'],
        sourceDir: '',
        activo: true,
        tienda: true,
        difusion: true,
        preservePrefs: false,
        allowSilent: false,
        dryRun: false
    };
    for (const raw of argv) {
        if (raw === '--preserve-prefs') out.preservePrefs = true;
        else if (raw === '--allow-silent') out.allowSilent = true;
        else if (raw === '--dry-run') out.dryRun = true;
        else if (raw.startsWith('--slug=')) {
            out.slugs = raw.slice('--slug='.length).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        } else if (raw.startsWith('--source-dir=')) {
            out.sourceDir = raw.slice('--source-dir='.length).trim();
        } else if (raw.startsWith('--activo=')) {
            out.activo = raw.slice('--activo='.length).trim().toLowerCase() !== 'false';
        } else if (raw.startsWith('--tienda=')) {
            out.tienda = raw.slice('--tienda='.length).trim().toLowerCase() !== 'false';
        } else if (raw.startsWith('--difusion=')) {
            out.difusion = raw.slice('--difusion='.length).trim().toLowerCase() !== 'false';
        }
    }
    return out;
}

function resolverCarpetaOrigen(sourceDirArg) {
    if (sourceDirArg) return path.resolve(sourceDirArg);
    const mediaRoot = nodosFotosService.obtenerDirectorioMediaNodos();
    const primaria = path.join(mediaRoot, 'videos-bienvenida');
    if (fs.existsSync(primaria)) return primaria;
    return path.join(ROOT_DIR, 'data', 'nodos-fotos', 'videos-bienvenida');
}

function localizarMasterParaSlug(baseDir, slug) {
    const slugDir = path.join(baseDir, slug);
    if (!fs.existsSync(slugDir)) return null;
    const preferido = path.join(slugDir, `${slug}-bienvenida-master.mp4`);
    if (fs.existsSync(preferido)) return preferido;

    const candidatos = fs.readdirSync(slugDir)
        .filter(f => /\.mp4$/i.test(f) && !/_tmp\.mp4$/i.test(f))
        .map(f => {
            const full = path.join(slugDir, f);
            return { full, mtimeMs: fs.statSync(full).mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return candidatos[0] ? candidatos[0].full : null;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const sourceDir = resolverCarpetaOrigen(opts.sourceDir);
    const dbName = process.env.DB_NAME || '(default)';
    const modoLab = nodosFotosService.esModoLaboratorioFotos();

    console.log('========================================================================');
    console.log('🎬 Ingesta de Videos de Bienvenida por Nodo (Audio AAC Preservado)');
    console.log(`   Entorno: ${modoLab ? 'LABORATORIO' : 'PRODUCCIÓN'} · DB=${dbName}`);
    console.log(`   Origen masters: ${sourceDir}`);
    console.log(`   Destino media:  ${nodosFotosService.obtenerDirectorioMediaNodos()}`);
    console.log(`   Slugs objetivo: ${opts.slugs.join(', ')}${opts.dryRun ? ' [DRY-RUN]' : ''}`);
    console.log('========================================================================');

    await db.query(`
        ALTER TABLE public.nodos_maestro
        ADD COLUMN IF NOT EXISTS config_video_bienvenida JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);

    const resultados = [];
    for (const slug of opts.slugs) {
        const resNodo = await db.query(
            `SELECT id, codigo_nodo, slug, nombre_marca
             FROM public.nodos_maestro
             WHERE LOWER(slug) = LOWER($1)
             LIMIT 1`,
            [slug]
        );
        if (resNodo.rows.length === 0) {
            console.warn(`⚠️  [${slug}] Nodo no encontrado en public.nodos_maestro. Omitido.`);
            continue;
        }
        const nodo = resNodo.rows[0];
        const masterPath = localizarMasterParaSlug(sourceDir, slug);
        if (!masterPath) {
            console.warn(`⚠️  [${slug}] No se encontró archivo .mp4 master en ${path.join(sourceDir, slug)}. Omitido.`);
            continue;
        }

        const statIn = fs.statSync(masterPath);
        console.log(`\n▶ [${nodo.codigo_nodo} · ${nodo.slug}] ${nodo.nombre_marca} (id=${nodo.id})`);
        console.log(`  Archivo master: ${masterPath} (${(statIn.size / (1024 * 1024)).toFixed(2)} MB)`);

        if (opts.dryRun) {
            resultados.push({ slug, nodoId: nodo.id, dryRun: true, masterPath });
            continue;
        }

        const cfg = await nodosFotosService.subirOIngestarVideoBienvenidaNodo({
            nodoId: nodo.id,
            tempFilePath: masterPath,
            preservarArchivoOrigen: true,
            activo: opts.preservePrefs ? null : opts.activo,
            mostrarEnTienda: opts.preservePrefs ? null : opts.tienda,
            habilitarEnDifusion: opts.preservePrefs ? null : opts.difusion,
            etiquetaBoton: opts.preservePrefs ? null : (ETIQUETAS_DEFAULT_POR_SLUG[slug] || '¿Cómo funciona?')
        });

        if (!opts.allowSilent && !cfg.tiene_audio) {
            throw new Error(`[${slug}] El video procesado no tiene pista de audio válida. Abortando verificación.`);
        }

        console.log(`  ✅ Procesado correctamente:`);
        console.log(`     Resolución/Duración: ${cfg.width}x${cfg.height} · ${cfg.duration_sec}s · Audio: ${cfg.tiene_audio ? '🔊 AAC SÍ' : '🔇 NO'}`);
        console.log(`     WhatsApp: ${cfg.url_whatsapp} (${(cfg.bytes_whatsapp / (1024 * 1024)).toFixed(2)} MB)`);
        console.log(`     Web:      ${cfg.url_web} (${(cfg.bytes_web / (1024 * 1024)).toFixed(2)} MB)`);
        console.log(`     Póster:   ${cfg.poster_url}`);
        console.log(`     Perillas: activo=${cfg.activo} · tienda=${cfg.mostrar_en_tienda} · difusion=${cfg.habilitar_en_difusion} · btn="${cfg.etiqueta_boton}"`);

        resultados.push({ slug, nodoId: nodo.id, cfg });
    }

    console.log('\n========================================================================');
    console.log(`✅ Ingesta finalizada (${resultados.length}/${opts.slugs.length} nodos procesados).`);
    console.log('========================================================================');
}

main()
    .catch(err => {
        console.error('❌ Error en ingestarVideosBienvenidaNodos:', err && err.stack ? err.stack : err);
        process.exitCode = 1;
    })
    .finally(async () => {
        try { await db.end(); } catch (_) {}
    });
