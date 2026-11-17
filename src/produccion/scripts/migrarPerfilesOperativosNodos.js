#!/usr/bin/env node
'use strict';

/**
 * Migración Idempotente de Perfiles Operativos Multi-Tienda (`nodos_maestro`)
 * ---------------------------------------------------------------------------
 * 1. Asegura que `paraiso` conserve `perfil_operativo = 'vecinal'` y sus módulos
 *    barriales intactos (cero cambios de comportamiento en Paraíso).
 * 2. Migra `manso` (`NODO-002`) a `perfil_operativo = 'ecommerce_fulfillment'`,
 *    con `permitir_retiro_nodo = false`, `permitir_reparto_propio = false`,
 *    `permitir_envio_barrial = false`, `permitir_encomienda = true`,
 *    `subtitulo_marca` limpio de e-commerce, preset `modulos_activos` de
 *    fulfillment LAMDA (`hoja_de_ruta: false`, `venta_continua_24_7: true`,
 *    `despacho_desde_lamda: true`, `canasto_consolidado: false`, `cobro_efectivo_entrega: false`)
 *    y `config_paqueteria` inicial configurable (respetando ajustes posteriores del admin/creador).
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const db = require('../config/database');
const nodosService = require('../services/nodosBarrialesService');

const MANSO_SEED_PATH = path.join(__dirname, '..', 'assets', 'mansoSeedData.json');

function leerSeedMansoSeguro() {
    try {
        if (fs.existsSync(MANSO_SEED_PATH)) {
            return JSON.parse(fs.readFileSync(MANSO_SEED_PATH, 'utf8'));
        }
    } catch (_) {}
    return {};
}

async function migrarPerfilesOperativosNodos(opciones = {}) {
    const logActivo = opciones.log !== false;
    await nodosService.asegurarEsquemaNodosBarriales({ sembrarDemo: false });
    const seedManso = leerSeedMansoSeguro();

    const { rows } = await db.query(
        `SELECT id, codigo_nodo, slug, nombre_marca, subtitulo_marca, bajada_marca,
                color_primario, tema_visual, logo_original_base64, logo_mono_preview_base64,
                logo_zpl_gfa, logo_zpl_config,
                perfil_operativo, modulos_activos, config_paqueteria, diccionario_textos,
                permitir_retiro_nodo, permitir_reparto_propio, permitir_envio_barrial, permitir_encomienda
         FROM public.nodos_maestro
         ORDER BY id ASC`
    );

    const actualizados = [];
    for (const row of rows) {
        const slugLower = String(row.slug || '').trim().toLowerCase();

        if (slugLower === 'manso') {
            const yaEsFulfillment = String(row.perfil_operativo || '').trim().toLowerCase() === 'ecommerce_fulfillment';
            const tieneModulos = row.modulos_activos && typeof row.modulos_activos === 'object' && Object.keys(row.modulos_activos).length > 0;
            const tienePaq = row.config_paqueteria && typeof row.config_paqueteria === 'object' && Object.keys(row.config_paqueteria).length > 0;
            const subRaw = String(row.subtitulo_marca || '').trim();
            const subTieneJergaBarrial = !subRaw || /barrial|barrio|vecin|comunidad/i.test(subRaw);
            const subEsDefaultGenerico = subRaw === 'Alimentos Naturales y Frutos Secos · Envíos a Todo el País';

            const tvActual = (row.tema_visual && typeof row.tema_visual === 'object') ? row.tema_visual : {};
            const cfgZplActual = (row.logo_zpl_config && typeof row.logo_zpl_config === 'object') ? row.logo_zpl_config : {};
            const temaOficial = nodosService.TEMA_VISUAL_MANSO_OFICIAL;
            const cfgZplOficial = nodosService.LOGO_ZPL_CONFIG_MANSO_OFICIAL;

            const faltaIdentidadOficialManso =
                String(row.color_primario || '').trim().toLowerCase() === '#c69f9f' ||
                !row.color_primario ||
                tvActual?.logo_incluye_texto !== true ||
                tvActual?.logos?.principal !== temaOficial.logos.principal ||
                tvActual?.logos?.horizontal !== temaOficial.logos.horizontal ||
                tvActual?.logos?.isotipo !== temaOficial.logos.isotipo ||
                tvActual?.paleta?.terracota !== temaOficial.paleta.terracota ||
                cfgZplActual?.modo_cabecera !== 'banner_completo' ||
                Number(cfgZplActual?.width || 0) !== cfgZplOficial.width ||
                !String(row.logo_zpl_gfa || '').startsWith('^GFA,1612,1612,26,');

            const modulosManso = nodosService.resolverModulosActivosNodo(
                {
                    perfil_operativo: 'ecommerce_fulfillment',
                    modulos_activos: yaEsFulfillment && tieneModulos ? row.modulos_activos : {}
                },
                {
                    retiro_punto: false,
                    reparto_zonal: false,
                    hoja_de_ruta: false,
                    envio_paqueteria: true,
                    venta_continua_24_7: true,
                    despacho_desde_lamda: true,
                    canasto_consolidado: false,
                    cobro_efectivo_entrega: false
                }
            );

            const configPaqManso = nodosService.normalizarConfigPaqueteria(
                tienePaq ? row.config_paqueteria : nodosService.obtenerConfigPaqueteriaDefault()
            );

            const nuevoSubtitulo = (subTieneJergaBarrial || subEsDefaultGenerico)
                ? (seedManso.subtitulo_marca || 'Frutos Secos · Snacks · Boxes')
                : subRaw;
            const nuevaBajada = String(row.bajada_marca || '').trim() || seedManso.bajada_marca || 'Que nunca falte algo rico';
            const nuevoColor = (!row.color_primario || String(row.color_primario).trim().toLowerCase() === '#c69f9f')
                ? '#672833'
                : row.color_primario;

            let zplGfaFinal = seedManso.logo_zpl_gfa || row.logo_zpl_gfa || null;
            let zplMonoPreviewFinal = seedManso.logo_mono_preview_base64 || row.logo_mono_preview_base64 || null;
            if (!String(zplGfaFinal || '').startsWith('^GFA,1612,1612,26,')) {
                const zebraDataUrl = nodosService.leerLogoZebraMansoDataUrl();
                if (zebraDataUrl) {
                    const conv = await nodosService.convertirLogoAZplGfa({
                        imageBase64: zebraDataUrl,
                        nombreMarca: 'MANSO',
                        iniciales: 'MO',
                        width: cfgZplOficial.width,
                        height: cfgZplOficial.height,
                        threshold: cfgZplOficial.threshold,
                        mode: cfgZplOficial.mode,
                        padding: cfgZplOficial.padding,
                        invert: false
                    });
                    zplGfaFinal = conv.logo_zpl_gfa;
                    zplMonoPreviewFinal = conv.logo_mono_preview_base64;
                }
            }

            const requiereUpdate =
                !yaEsFulfillment ||
                !tieneModulos ||
                !tienePaq ||
                subTieneJergaBarrial ||
                subEsDefaultGenerico ||
                !String(row.bajada_marca || '').trim() ||
                faltaIdentidadOficialManso ||
                row.permitir_retiro_nodo !== false ||
                row.permitir_reparto_propio !== false ||
                row.permitir_envio_barrial !== false ||
                row.permitir_encomienda !== true;

            if (requiereUpdate) {
                await db.query(
                    `UPDATE public.nodos_maestro SET
                        perfil_operativo = 'ecommerce_fulfillment',
                        permitir_retiro_nodo = false,
                        permitir_reparto_propio = false,
                        permitir_envio_barrial = false,
                        permitir_encomienda = true,
                        subtitulo_marca = $2,
                        bajada_marca = $3,
                        color_primario = $4,
                        tema_visual = $5::jsonb,
                        logo_original_base64 = COALESCE($6, logo_original_base64),
                        logo_mono_preview_base64 = COALESCE($7, logo_mono_preview_base64),
                        logo_zpl_gfa = COALESCE($8, logo_zpl_gfa),
                        logo_zpl_config = $9::jsonb,
                        modulos_activos = $10::jsonb,
                        config_paqueteria = $11::jsonb,
                        updated_at = NOW()
                     WHERE id = $1`,
                    [
                        row.id,
                        nuevoSubtitulo,
                        nuevaBajada,
                        nuevoColor,
                        JSON.stringify(temaOficial),
                        seedManso.logo_original_base64 || null,
                        zplMonoPreviewFinal,
                        zplGfaFinal,
                        JSON.stringify(cfgZplOficial),
                        JSON.stringify(modulosManso),
                        JSON.stringify(configPaqManso)
                    ]
                );
                actualizados.push({
                    id: row.id,
                    slug: row.slug,
                    perfil_operativo: 'ecommerce_fulfillment',
                    color_primario: nuevoColor
                });
            }
        } else {
            // Paraíso y cualquier otro nodo vecinal previo conservan perfil_operativo = 'vecinal' y sus flags intactos
            const perfilActual = nodosService.normalizarPerfilOperativoNodo(row.perfil_operativo || 'vecinal');
            if (perfilActual === 'vecinal') {
                const tieneModulos = row.modulos_activos && typeof row.modulos_activos === 'object' && Object.keys(row.modulos_activos).length > 0;
                if (!tieneModulos || !row.perfil_operativo) {
                    const modulosVecinal = nodosService.resolverModulosActivosNodo({
                        perfil_operativo: 'vecinal',
                        permitir_retiro_nodo: row.permitir_retiro_nodo !== false,
                        permitir_reparto_propio: Boolean(row.permitir_reparto_propio ?? row.permitir_envio_barrial ?? true),
                        permitir_encomienda: Boolean(row.permitir_encomienda)
                    });
                    await db.query(
                        `UPDATE public.nodos_maestro SET
                            perfil_operativo = 'vecinal',
                            modulos_activos = $2::jsonb,
                            updated_at = NOW()
                         WHERE id = $1`,
                        [row.id, JSON.stringify(modulosVecinal)]
                    );
                    actualizados.push({ id: row.id, slug: row.slug, perfil_operativo: 'vecinal' });
                }
            }
        }
    }

    const resultado = {
        ok: true,
        total_nodos: rows.length,
        actualizados
    };

    if (logActivo) {
        console.log(`✅ [MIGRACION-PERFILES-NODOS] Verificados ${rows.length} nodos (${actualizados.length} actualizados).`);
    }

    return resultado;
}

if (require.main === module) {
    migrarPerfilesOperativosNodos({ log: true })
        .then((res) => {
            console.log(JSON.stringify(res, null, 2));
            process.exit(0);
        })
        .catch((err) => {
            console.error('❌ [MIGRACION-PERFILES-NODOS] Error:', err);
            process.exit(1);
        });
}

module.exports = {
    migrarPerfilesOperativosNodos
};
