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
                logo_zpl_gfa, logo_zpl_config, direccion_retiro,
                perfil_operativo, modulos_activos, config_paqueteria, config_retiro_local, diccionario_textos,
                cobro_efectivo_entrega,
                permitir_retiro_nodo, permitir_reparto_propio, permitir_envio_barrial, permitir_encomienda
         FROM public.nodos_maestro
         ORDER BY id ASC`
    );

    const actualizados = [];
    for (const row of rows) {
        const slugLower = String(row.slug || '').trim().toLowerCase();

        if (slugLower === 'manso') {
            const yaEsRedes = String(row.perfil_operativo || '').trim() === 'REDES';
            const tieneModulos = row.modulos_activos && typeof row.modulos_activos === 'object' && Object.keys(row.modulos_activos).length > 0;
            const tieneNuevasPerillas = Boolean(row.modulos_activos?.abastecimiento_modo && row.modulos_activos?.etiqueta_zpl_formato);
            const tienePaq = row.config_paqueteria && typeof row.config_paqueteria === 'object' && Object.keys(row.config_paqueteria).length > 0;
            const subRaw = String(row.subtitulo_marca || '').trim();
            const subTieneJergaBarrial = !subRaw || /barrial|barrio|vecin|comunidad/i.test(subRaw);
            const subEsDefaultGenerico = subRaw === 'Alimentos Naturales y Frutos Secos · Envíos a Todo el País';

            const tvActual = (row.tema_visual && typeof row.tema_visual === 'object') ? row.tema_visual : {};
            const cfgZplActual = (row.logo_zpl_config && typeof row.logo_zpl_config === 'object') ? row.logo_zpl_config : {};
            const temaOficial = nodosService.TEMA_VISUAL_MANSO_OFICIAL;
            const cfgZplOficial = nodosService.LOGO_ZPL_CONFIG_MANSO_OFICIAL;

            const colorPrimarioActual = String(row.color_primario || '').trim().toLowerCase();
            const gfaPrefixOficial = '^GFA,2030,2030,35,';
            const faltaIdentidadOficialManso =
                !colorPrimarioActual ||
                colorPrimarioActual === '#c69f9f' ||
                colorPrimarioActual === '#672833' ||
                colorPrimarioActual !== '#4f1f27' ||
                tvActual?.logo_incluye_texto !== true ||
                tvActual?.logos?.principal !== temaOficial.logos.principal ||
                tvActual?.logos?.horizontal !== temaOficial.logos.horizontal ||
                tvActual?.logos?.vertical !== temaOficial.logos.vertical ||
                tvActual?.logos?.isotipo !== temaOficial.logos.isotipo ||
                tvActual?.logos?.og_share !== temaOficial.logos.og_share ||
                tvActual?.logos?.favicon_svg !== temaOficial.logos.favicon_svg ||
                tvActual?.paleta?.primario !== temaOficial.paleta.primario ||
                tvActual?.paleta?.terracota !== temaOficial.paleta.terracota ||
                tvActual?.paleta?.fondo !== temaOficial.paleta.fondo ||
                tvActual?.paleta?.pistacho !== temaOficial.paleta.pistacho ||
                cfgZplActual?.modo_cabecera !== 'banner_completo' ||
                Number(cfgZplActual?.width || 0) !== cfgZplOficial.width ||
                Number(cfgZplActual?.height || 0) !== cfgZplOficial.height ||
                !String(row.logo_zpl_gfa || '').startsWith(gfaPrefixOficial);

            // Preserva overrides existentes de Capa B completando solo perillas nuevas desde preset REDES
            const modulosManso = nodosService.resolverModulosActivosNodo({
                perfil_operativo: 'REDES',
                modulos_activos: tieneModulos ? row.modulos_activos : {},
                cobro_efectivo_entrega: row.cobro_efectivo_entrega ?? false
            });

            const configPaqManso = nodosService.normalizarConfigPaqueteria(
                tienePaq ? row.config_paqueteria : nodosService.obtenerConfigPaqueteriaDefault()
            );

            const nuevoSubtitulo = (subTieneJergaBarrial || subEsDefaultGenerico)
                ? (seedManso.subtitulo_marca || 'Frutos Secos · Snacks · Boxes')
                : subRaw;
            const nuevaBajada = String(row.bajada_marca || '').trim() || seedManso.bajada_marca || 'Que nunca falte algo rico';
            const nuevoColor = (!colorPrimarioActual || colorPrimarioActual === '#c69f9f' || colorPrimarioActual === '#672833')
                ? '#4F1F27'
                : row.color_primario;

            let zplGfaFinal = seedManso.logo_zpl_gfa || row.logo_zpl_gfa || null;
            let zplMonoPreviewFinal = seedManso.logo_mono_preview_base64 || row.logo_mono_preview_base64 || null;
            const zebraDataUrl = nodosService.leerLogoZebraMansoDataUrl();
            if (!String(zplGfaFinal || '').startsWith(gfaPrefixOficial)) {
                if (zebraDataUrl) {
                    const conv = await nodosService.convertirLogoAZplGfa({
                        imageBase64: zebraDataUrl,
                        nombreMarca: 'MANSO',
                        iniciales: cfgZplOficial.iniciales || 'M',
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
                !yaEsRedes ||
                !tieneModulos ||
                !tieneNuevasPerillas ||
                !tienePaq ||
                subTieneJergaBarrial ||
                subEsDefaultGenerico ||
                !String(row.bajada_marca || '').trim() ||
                faltaIdentidadOficialManso;

            if (requiereUpdate) {
                await db.query(
                    `UPDATE public.nodos_maestro SET
                        perfil_operativo = 'REDES',
                        permitir_retiro_nodo = $12,
                        permitir_reparto_propio = $13,
                        permitir_envio_barrial = $13,
                        permitir_encomienda = $14,
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
                        seedManso.logo_original_base64 || zebraDataUrl || null,
                        zplMonoPreviewFinal,
                        zplGfaFinal,
                        JSON.stringify(cfgZplOficial),
                        JSON.stringify(modulosManso),
                        JSON.stringify(configPaqManso),
                        Boolean(modulosManso.retiro_punto),
                        Boolean(modulosManso.reparto_zonal),
                        Boolean(modulosManso.envio_paqueteria)
                    ]
                );
                actualizados.push({
                    id: row.id,
                    slug: row.slug,
                    perfil_operativo: 'REDES',
                    color_primario: nuevoColor
                });
            }
        } else if (slugLower === 'moro') {
            const yaEsLocales = String(row.perfil_operativo || '').trim() === 'LOCALES';
            const tieneModulos = row.modulos_activos && typeof row.modulos_activos === 'object' && Object.keys(row.modulos_activos).length > 0;
            const tieneNuevasPerillas = Boolean(
                row.modulos_activos?.abastecimiento_modo &&
                row.modulos_activos?.etiqueta_zpl_formato &&
                typeof row.modulos_activos?.ocultar_franja_info_superior === 'boolean'
            );

            const tvActual = (row.tema_visual && typeof row.tema_visual === 'object') ? row.tema_visual : {};
            const dicActual = (row.diccionario_textos && typeof row.diccionario_textos === 'object') ? row.diccionario_textos : {};
            const cfgZplActual = (row.logo_zpl_config && typeof row.logo_zpl_config === 'object') ? row.logo_zpl_config : {};
            const temaOficial = nodosService.enriquecerTemaVisualConVersionAssets(nodosService.TEMA_VISUAL_MORO_OFICIAL);
            const cfgZplOficial = nodosService.LOGO_ZPL_CONFIG_MORO_OFICIAL;
            const zebraDataUrl = nodosService.leerLogoZebraMoroDataUrl();
            const gfaBytesPerRow = Math.ceil(cfgZplOficial.width / 8);
            const gfaTotalBytes = gfaBytesPerRow * cfgZplOficial.height;
            const gfaPrefixOficial = `^GFA,${gfaTotalBytes},${gfaTotalBytes},${gfaBytesPerRow},`;

            const faltaSubtituloCatalogo = !String(dicActual.subtitulo_catalogo || '').trim();
            const dicFinalMoro = {
                ...nodosService.obtenerPresetDiccionarioTextosNodo('LOCALES'),
                ...dicActual,
                subtitulo_catalogo: String(dicActual.subtitulo_catalogo || '').trim() || 'FRUTOS SECOS'
            };

            const colorPrimarioActual = String(row.color_primario || '').trim().toLowerCase();
            const faltaIdentidadOficialMoro =
                !colorPrimarioActual ||
                colorPrimarioActual === '#1e1e1c' ||
                colorPrimarioActual !== '#182132' ||
                tvActual?.logo_incluye_texto !== true ||
                tvActual?.assets_version !== temaOficial.assets_version ||
                tvActual?.logos?.principal !== temaOficial.logos.principal ||
                tvActual?.logos?.horizontal !== temaOficial.logos.horizontal ||
                tvActual?.logos?.gestor_header !== temaOficial.logos.gestor_header ||
                tvActual?.logos?.vertical !== temaOficial.logos.vertical ||
                tvActual?.logos?.isotipo !== temaOficial.logos.isotipo ||
                tvActual?.logos?.og_share !== temaOficial.logos.og_share ||
                tvActual?.logos?.favicon_svg !== temaOficial.logos.favicon_svg ||
                tvActual?.paleta?.primario !== temaOficial.paleta.primario ||
                tvActual?.paleta?.primario_oscuro !== temaOficial.paleta.primario_oscuro ||
                tvActual?.paleta?.terracota !== temaOficial.paleta.terracota ||
                tvActual?.paleta?.fondo !== temaOficial.paleta.fondo ||
                tvActual?.paleta?.superficie_calida !== temaOficial.paleta.superficie_calida ||
                tvActual?.paleta?.ocre !== temaOficial.paleta.ocre ||
                tvActual?.paleta?.amarillo_sol !== temaOficial.paleta.amarillo_sol ||
                tvActual?.paleta?.pistacho !== temaOficial.paleta.pistacho ||
                tvActual?.paleta?.borde !== temaOficial.paleta.borde ||
                cfgZplActual?.modo_cabecera !== 'banner_completo' ||
                Number(cfgZplActual?.width || 0) !== cfgZplOficial.width ||
                Number(cfgZplActual?.height || 0) !== cfgZplOficial.height ||
                Number(cfgZplActual?.padding ?? -1) !== cfgZplOficial.padding ||
                !String(row.logo_zpl_gfa || '').startsWith(gfaPrefixOficial) ||
                (Boolean(zebraDataUrl) && String(row.logo_original_base64 || '') !== zebraDataUrl);

            const modulosMoro = nodosService.resolverModulosActivosNodo({
                perfil_operativo: 'LOCALES',
                modulos_activos: tieneModulos ? row.modulos_activos : {},
                cobro_efectivo_entrega: row.cobro_efectivo_entrega ?? false,
                permitir_retiro_nodo: row.permitir_retiro_nodo,
                permitir_reparto_propio: row.permitir_reparto_propio,
                permitir_envio_barrial: row.permitir_envio_barrial,
                permitir_encomienda: row.permitir_encomienda
            });

            if (!yaEsLocales || !tieneModulos || !tieneNuevasPerillas || faltaIdentidadOficialMoro || faltaSubtituloCatalogo) {
                let zplGfaFinal = row.logo_zpl_gfa || null;
                let zplMonoPreviewFinal = row.logo_mono_preview_base64 || null;
                const necesitaRegenerarZpl =
                    Boolean(zebraDataUrl) && (
                        !String(row.logo_zpl_gfa || '').startsWith(gfaPrefixOficial) ||
                        String(row.logo_original_base64 || '') !== zebraDataUrl ||
                        Number(cfgZplActual?.width || 0) !== cfgZplOficial.width ||
                        Number(cfgZplActual?.height || 0) !== cfgZplOficial.height ||
                        Number(cfgZplActual?.padding ?? -1) !== cfgZplOficial.padding
                    );

                if (necesitaRegenerarZpl) {
                    const conv = await nodosService.convertirLogoAZplGfa({
                        imageBase64: zebraDataUrl,
                        nombreMarca: 'MORO',
                        iniciales: cfgZplOficial.iniciales || 'MO',
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

                await db.query(
                    `UPDATE public.nodos_maestro SET
                        perfil_operativo = 'LOCALES',
                        color_primario = $2,
                        tema_visual = $3::jsonb,
                        logo_original_base64 = COALESCE($4, logo_original_base64),
                        logo_mono_preview_base64 = COALESCE($5, logo_mono_preview_base64),
                        logo_zpl_gfa = COALESCE($6, logo_zpl_gfa),
                        logo_zpl_config = $7::jsonb,
                        modulos_activos = $8::jsonb,
                        diccionario_textos = $9::jsonb,
                        updated_at = NOW()
                     WHERE id = $1`,
                    [
                        row.id,
                        '#182132',
                        JSON.stringify(temaOficial),
                        zebraDataUrl || null,
                        zplMonoPreviewFinal,
                        zplGfaFinal,
                        JSON.stringify(cfgZplOficial),
                        JSON.stringify(modulosMoro),
                        JSON.stringify(dicFinalMoro)
                    ]
                );
                actualizados.push({
                    id: row.id,
                    slug: row.slug,
                    perfil_operativo: 'LOCALES',
                    color_primario: '#182132',
                    assets_version: temaOficial.assets_version,
                    subtitulo_catalogo: dicFinalMoro.subtitulo_catalogo,
                    zpl_regenerado: necesitaRegenerarZpl
                });
            }
        } else {
            // Paraíso -> VECINOS y cualquier otro nodo normalizan su perfil canónico
            // preservando 100% de sus overrides de Capa B y su estética actual
            const perfilCanon = nodosService.normalizarPerfilOperativoNodo(row.perfil_operativo || 'VECINOS');
            const tieneModulos = row.modulos_activos && typeof row.modulos_activos === 'object' && Object.keys(row.modulos_activos).length > 0;
            const tieneNuevasPerillas = Boolean(row.modulos_activos?.abastecimiento_modo && row.modulos_activos?.etiqueta_zpl_formato);
            const perfilExacto = String(row.perfil_operativo || '').trim() === perfilCanon;
            if (!perfilExacto || !tieneModulos || !tieneNuevasPerillas) {
                const modulosCanon = nodosService.resolverModulosActivosNodo({
                    perfil_operativo: perfilCanon,
                    modulos_activos: tieneModulos ? row.modulos_activos : {},
                    cobro_efectivo_entrega: row.cobro_efectivo_entrega,
                    permitir_retiro_nodo: row.permitir_retiro_nodo,
                    permitir_reparto_propio: row.permitir_reparto_propio,
                    permitir_envio_barrial: row.permitir_envio_barrial,
                    permitir_encomienda: row.permitir_encomienda
                });
                await db.query(
                    `UPDATE public.nodos_maestro SET
                        perfil_operativo = $2,
                        modulos_activos = $3::jsonb,
                        updated_at = NOW()
                     WHERE id = $1`,
                    [row.id, perfilCanon, JSON.stringify(modulosCanon)]
                );
                actualizados.push({ id: row.id, slug: row.slug, perfil_operativo: perfilCanon });
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
