#!/usr/bin/env node
'use strict';

/**
 * Rutina Idempotente de Aprovisionamiento del Nodo MANSO (`slug = 'manso'`)
 * -------------------------------------------------------------------------
 * - Cero IDs primarios hardcodeados: vincula contablemente mediante `codigo_bunker_cliente_madre = 'CB-0036'`
 *   usando `guardarNodoMaestro()` / `asegurarVinculoContableNodo()` y hereda la cuenta recaudadora activa
 *   del entorno (`public.nodos_configuracion_canal WHERE id = 1`).
 * - Cero interferencia con `paraiso` (`nodo_id = 1`) ni con otros nodos existentes.
 * - Si `manso` tiene `0` filas en `public.nodos_ofertas_gestor`, vincula de forma idempotente los artículos
 *   activos de `public.nodos_articulos_catalogo` con `publicado_tienda = true` y margen inicial `28%`.
 * - Si `manso` ya existe y ya posee ofertas configuradas, no sobrescribe cambios humanos posteriores.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const fs = require('fs');
const db = require('../config/database');
const nodosService = require('../services/nodosBarrialesService');

const SEED_PATH = path.join(__dirname, '..', 'assets', 'mansoSeedData.json');

function cargarSeedCanonicoManso() {
    if (!fs.existsSync(SEED_PATH)) {
        throw new Error(`No se encontró el seed canónico de MANSO en ${SEED_PATH}`);
    }
    return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
}

async function provisionarNodoManso(opciones = {}) {
    const logActivo = opciones.log !== false;
    await nodosService.asegurarEsquemaNodosBarriales({ sembrarDemo: false });

    const seed = cargarSeedCanonicoManso();
    const codigoMadre = String(seed.codigo_bunker_cliente_madre || 'CB-0036').trim();

    // 1. Verificar si ya existe el nodo `manso`
    const existenteRes = await db.query(
        `SELECT id, codigo_nodo, slug, nombre_marca, gestor_nombre, gestor_token,
                bunker_cliente_id, codigo_bunker_cliente, cliente_madre_bunker_id,
                codigo_bunker_cliente_madre, cuenta_bancaria_id, alias_bancario_display, activo
         FROM public.nodos_maestro
         WHERE LOWER(slug) = 'manso'
         LIMIT 1`
    );

    let nodoManso = existenteRes.rows[0] || null;
    let creadoEnEstaCorrida = false;

    if (!nodoManso) {
        // Verificar existencia del cliente madre por código determinista ('CB-0036'), sin ID fijo
        const madreRes = await db.query(
            `SELECT id, codigo_bunker_cliente, cliente_nombre
             FROM public.bunker_clientes
             WHERE UPPER(TRIM(codigo_bunker_cliente)) = UPPER($1)
             LIMIT 1`,
            [codigoMadre]
        );

        if (madreRes.rows.length === 0) {
            const msg = `Cliente madre '${codigoMadre}' aún no existe en public.bunker_clientes; se omite alta automática de MANSO.`;
            if (logActivo) console.warn(`⚠️ [PROVISION-MANSO] ${msg}`);
            return {
                ok: false,
                skipped: true,
                reason: 'CLIENTE_MADRE_NO_ENCONTRADO',
                codigo_bunker_cliente_madre: codigoMadre
            };
        }

        // Resolver código de nodo libre (preferencia NODO-002 si no está ocupado)
        let codigoNodoDeseado = String(seed.codigo_nodo || 'NODO-002').trim();
        const chkCod = await db.query(
            `SELECT id, slug FROM public.nodos_maestro WHERE UPPER(codigo_nodo) = UPPER($1) LIMIT 1`,
            [codigoNodoDeseado]
        );
        if (chkCod.rows.length > 0) {
            codigoNodoDeseado = '';
        }

        // Resolver cuenta recaudadora activa del canal en el entorno actual
        const cfgCanalRes = await db.query(
            `SELECT cuenta_bancaria_id, alias_recaudador, cbu_recaudador, titular_recaudador
             FROM public.nodos_configuracion_canal
             WHERE id = 1
             LIMIT 1`
        );
        const cfgCanal = cfgCanalRes.rows[0] || null;

        const tokenPreferido = String(process.env.MANSO_GESTOR_TOKEN || seed.gestor_token || '').trim();

        nodoManso = await nodosService.guardarNodoMaestro({
            codigo_nodo: codigoNodoDeseado,
            slug: 'manso',
            nombre_marca: seed.nombre_marca || 'MANSO',
            subtitulo_marca: seed.subtitulo_marca || 'Alimentos Naturales y Frutos Secos · Envíos a Todo el País',
            bajada_marca: seed.bajada_marca || null,
            gestor_nombre: seed.gestor_nombre || 'Clarichuns',
            gestor_telefono: seed.gestor_telefono || '5492604030005',
            gestor_email: seed.gestor_email || '',
            barrio_zona: seed.barrio_zona || '',
            direccion_retiro: seed.direccion_retiro || '',
            codigo_bunker_cliente_madre: madreRes.rows[0].codigo_bunker_cliente,
            usar_cuenta_madre_unificada: true,
            usa_cuenta_compartida: true,
            cuenta_bancaria_id: cfgCanal?.cuenta_bancaria_id || null,
            perfil_operativo: seed.perfil_operativo || 'ecommerce_fulfillment',
            modulos_activos: seed.modulos_activos || nodosService.obtenerPresetModulosActivos('ecommerce_fulfillment'),
            config_paqueteria: seed.config_paqueteria || nodosService.obtenerConfigPaqueteriaDefault(),
            permitir_envio_barrial: false,
            permitir_retiro_nodo: false,
            permitir_reparto_propio: false,
            permitir_encomienda: true,
            mostrar_ingredientes_tienda: true,
            cargo_envio_barrial: 0,
            margen_gestor_default_pct: Number(seed.margen_gestor_default_pct || 28),
            config_ventanas_corte: Array.isArray(seed.config_ventanas_corte) ? seed.config_ventanas_corte : undefined,
            color_primario: seed.color_primario || '#c69f9f',
            latitud: seed.latitud,
            longitud: seed.longitud,
            logo_original_base64: seed.logo_original_base64 || null,
            logo_zpl_config: seed.logo_zpl_config || {
                mode: 'threshold',
                width: 112,
                height: 56,
                invert: false,
                iniciales: 'M',
                threshold: 168
            },
            tema_visual: seed.tema_visual || {},
            gestor_token: tokenPreferido
        });

        creadoEnEstaCorrida = true;
    } else if (nodoManso.activo === false && opciones.reactivarSiInactivo === true) {
        const updAct = await db.query(
            `UPDATE public.nodos_maestro SET activo = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [nodoManso.id]
        );
        nodoManso = updAct.rows[0];
    }

    // 2. Si el nodo MANSO tiene 0 filas en public.nodos_ofertas_gestor, vincular catálogo activo de forma idempotente
    const conteoOfertasRes = await db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE publicado_tienda = true)::int AS publicadas
         FROM public.nodos_ofertas_gestor
         WHERE nodo_id = $1`,
        [nodoManso.id]
    );

    let totalOfertas = Number(conteoOfertasRes.rows[0]?.total || 0);
    let ofertasPublicadas = Number(conteoOfertasRes.rows[0]?.publicadas || 0);
    let ofertasVinculadasNuevas = 0;

    if (totalOfertas === 0) {
        const catRes = await db.query(
            `SELECT id, precio_base_nodo_final
             FROM public.nodos_articulos_catalogo
             WHERE activo = true
               AND COALESCE(precio_base_nodo_final, 0) > 0
             ORDER BY id ASC`
        );
        const margenInicial = 28.00;
        for (const cat of catRes.rows) {
            const base = Number(cat.precio_base_nodo_final || 0);
            const precioVecino = Math.ceil((base * (1 + margenInicial / 100)) / 50) * 50;
            const ganancia = Math.max(0, precioVecino - base);
            const insOf = await db.query(
                `INSERT INTO public.nodos_ofertas_gestor (
                    nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                    margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor, publicado_tienda
                 ) VALUES ($1, $2, $3, $4, $5, $6, true)
                 ON CONFLICT (nodo_id, articulo_catalogo_id) DO NOTHING
                 RETURNING id`,
                [nodoManso.id, cat.id, base, margenInicial, precioVecino, ganancia]
            );
            if (insOf.rowCount > 0) {
                ofertasVinculadasNuevas += 1;
            }
        }

        const postRes = await db.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE publicado_tienda = true)::int AS publicadas
             FROM public.nodos_ofertas_gestor
             WHERE nodo_id = $1`,
            [nodoManso.id]
        );
        totalOfertas = Number(postRes.rows[0]?.total || 0);
        ofertasPublicadas = Number(postRes.rows[0]?.publicadas || 0);
    }

    const publicHost = String(process.env.NODOS_PUBLIC_BASE_URL || 'https://tienda.lamdaser.com').replace(/\/+$/, '');
    const resultado = {
        ok: true,
        created: creadoEnEstaCorrida,
        nodo_id: Number(nodoManso.id),
        codigo_nodo: nodoManso.codigo_nodo,
        slug: nodoManso.slug,
        codigo_bunker_cliente: nodoManso.codigo_bunker_cliente,
        codigo_bunker_cliente_madre: nodoManso.codigo_bunker_cliente_madre,
        ofertas_vinculadas_nuevas: ofertasVinculadasNuevas,
        ofertas_total: totalOfertas,
        ofertas_publicadas: ofertasPublicadas,
        gestor_token: nodoManso.gestor_token,
        urls: {
            tienda: `${publicHost}/tienda/manso`,
            gestor: `${publicHost}/gestor/manso?t=${encodeURIComponent(nodoManso.gestor_token || '')}`
        }
    };

    if (logActivo) {
        console.log(`✅ [PROVISION-MANSO] Nodo MANSO verificado (creado=${creadoEnEstaCorrida}, id=${resultado.nodo_id}, ofertas=${totalOfertas}, publicadas=${ofertasPublicadas})`);
    }

    return resultado;
}

if (require.main === module) {
    provisionarNodoManso({ log: true })
        .then((res) => {
            console.log(JSON.stringify(res, null, 2));
            process.exit(0);
        })
        .catch((err) => {
            console.error('❌ [PROVISION-MANSO] Error:', err);
            process.exit(1);
        });
}

module.exports = {
    provisionarNodoManso
};
