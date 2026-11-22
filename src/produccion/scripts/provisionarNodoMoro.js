#!/usr/bin/env node
'use strict';

/**
 * Rutina Idempotente de Aprovisionamiento del Nodo MORO (`NODO-003`, `slug = 'moro'`, perfil `LOCALES`)
 * ------------------------------------------------------------------------------------------------------
 * Reglas de idempotencia seguras para Laboratorio y futuro pase a Producción:
 * 1. Busca primero al titular (`CHISTE AGUSTIN LUCIANO`) en `public.bunker_clientes` por CUIT `20335062214`
 *    o teléfono `2215640696` (si Martín ya lo dio de alta manualmente, reutiliza su `id` sin duplicar).
 *    Solo si no existe, lo crea limpio junto a su `Cuenta Principal` en `factura_cuentas_corrientes`.
 * 2. Vincula `NODO-003` mediante `cliente_madre_bunker_id` (PK estable) + `codigo_bunker_cliente_madre`,
 *    de modo que cambios posteriores de CUIT/razón social en Clientes jamás rompan el vínculo del nodo.
 * 3. Cero interferencia con `paraiso` (`VECINOS`) ni `manso` (`REDES`).
 * 4. Si `moro` tiene `0` ofertas en `public.nodos_ofertas_gestor`, publica el catálogo activo estándar
 *    de nodos con margen inicial `28%`. Si ya posee ofertas, respeta intactos los ajustes humanos.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const db = require('../config/database');
const nodosService = require('../services/nodosBarrialesService');

const MORO_TITULAR_CANONICO = {
    razon_social: 'CHISTE AGUSTIN LUCIANO',
    cliente_nombre: 'Agustín Chiste - Moro Almacén de Bebidas',
    cuit_formateado: '20-33506221-4',
    cuit_digitos: '20335062214',
    condicion_iva: 'Responsable Inscripto',
    whatsapp_display: '+54 9 221 5640696',
    telefono_digitos: '5492215640696',
    telefono_local_sufijo: '2215640696',
    domicilio_fiscal: 'Av. 7 N° 202 (esq. 36), La Plata, Buenos Aires',
    provincia: 'Buenos Aires'
};

const MORO_CONFIG_RETIRO_LOCAL = {
    nombre_punto: 'Moro Almacén de Bebidas',
    direccion_corta: 'Av. 7 N° 202 (esq. 36)',
    direccion_completa: 'Av. 7 N° 202 esquina 36, Centro, La Plata',
    dias_atencion: 'Lunes a Viernes',
    horario_atencion: '10:00 a 21:00 hs',
    referencias_mostrador: 'Retirá por mostrador indicando tu apellido o número de pedido',
    mostrar_mapa_link: true,
    abastecimiento_dias_label: 'Martes y Viernes'
};

const MORO_VENTANAS_CORTE = [
    {
        dia_entrega: 'Martes',
        cierre_dia: 'Lunes',
        cierre_hora: '14:00',
        ventana_retiro: 'Lunes a Viernes 10:00 a 21:00 hs'
    },
    {
        dia_entrega: 'Viernes',
        cierre_dia: 'Jueves',
        cierre_hora: '14:00',
        ventana_retiro: 'Lunes a Viernes 10:00 a 21:00 hs'
    }
];

async function asegurarClienteTitularMoroEnBunker() {
    // 1. Buscar primero en bunker_clientes por CUIT (20335062214) o teléfono (2215640696)
    const existBunker = await db.query(
        `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, cuit_cuil, whatsapp_facturas
         FROM public.bunker_clientes
         WHERE REGEXP_REPLACE(COALESCE(cuit_cuil, ''), '[^0-9]', '', 'g') = $1
            OR REGEXP_REPLACE(COALESCE(whatsapp_facturas, ''), '[^0-9]', '', 'g') LIKE ('%' || $2)
         ORDER BY CASE WHEN REGEXP_REPLACE(COALESCE(cuit_cuil, ''), '[^0-9]', '', 'g') = $1 THEN 0 ELSE 1 END, id ASC
         LIMIT 1`,
        [MORO_TITULAR_CANONICO.cuit_digitos, MORO_TITULAR_CANONICO.telefono_local_sufijo]
    );

    let clienteBunker = existBunker.rows[0] || null;
    let creadoTitular = false;

    if (!clienteBunker) {
        // Revisar si ya existe en tabla legacy public.clientes para heredar lomas_soft_id sin duplicar
        let lomasSoftId = null;
        try {
            const legRes = await db.query(
                `SELECT cliente_id FROM public.clientes
                 WHERE REGEXP_REPLACE(COALESCE(cuit, ''), '[^0-9]', '', 'g') = $1
                    OR REGEXP_REPLACE(COALESCE(telefono, ''), '[^0-9]', '', 'g') LIKE ('%' || $2)
                    OR REGEXP_REPLACE(COALESCE(celular, ''), '[^0-9]', '', 'g') LIKE ('%' || $2)
                 ORDER BY id ASC LIMIT 1`,
                [MORO_TITULAR_CANONICO.cuit_digitos, MORO_TITULAR_CANONICO.telefono_local_sufijo]
            );
            if (legRes.rows[0]?.cliente_id) {
                lomasSoftId = Number(legRes.rows[0].cliente_id);
            }
        } catch (_) {}

        const maxCbRes = await db.query(
            `SELECT COALESCE(MAX(CAST(SUBSTRING(codigo_bunker_cliente FROM 4) AS INTEGER)), 0) AS max_num
             FROM public.bunker_clientes
             WHERE codigo_bunker_cliente ~ '^CB-[0-9]+$'`
        );
        const nextNum = Number(maxCbRes.rows[0]?.max_num || 0) + 1;
        const nuevoCodigoCb = `CB-${String(nextNum).padStart(4, '0')}`;

        const insCli = await db.query(
            `INSERT INTO public.bunker_clientes (
                codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id,
                cuit_cuil, condicion_iva, domicilio_fiscal, provincia,
                whatsapp_facturas, canal_envio_preferido, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'whatsapp', NOW(), NOW())
             RETURNING id, codigo_bunker_cliente, cliente_nombre, razon_social, cuit_cuil, whatsapp_facturas`,
            [
                nuevoCodigoCb,
                MORO_TITULAR_CANONICO.cliente_nombre,
                MORO_TITULAR_CANONICO.razon_social,
                lomasSoftId,
                MORO_TITULAR_CANONICO.cuit_digitos,
                MORO_TITULAR_CANONICO.condicion_iva,
                MORO_TITULAR_CANONICO.domicilio_fiscal,
                MORO_TITULAR_CANONICO.provincia,
                MORO_TITULAR_CANONICO.whatsapp_display
            ]
        );
        clienteBunker = insCli.rows[0];
        creadoTitular = true;
    }

    // Asegurar Cuenta Principal activa en factura_cuentas_corrientes
    const chkCc = await db.query(
        `SELECT id FROM public.factura_cuentas_corrientes
         WHERE codigo_bunker_cliente = $1 AND nombre_cuenta = 'Cuenta Principal'
         LIMIT 1`,
        [clienteBunker.codigo_bunker_cliente]
    );
    if (chkCc.rows.length === 0) {
        await db.query(
            `INSERT INTO public.factura_cuentas_corrientes (
                codigo_bunker_cliente, nombre_cuenta, moneda, saldo, estado, creada_en, actualizada_en, saldo_apertura
             ) VALUES ($1, 'Cuenta Principal', 'ARS', 0, 'ACTIVA', NOW(), NOW(), 0)`,
            [clienteBunker.codigo_bunker_cliente]
        );
    }

    return { clienteBunker, creadoTitular };
}

async function provisionarNodoMoro(opciones = {}) {
    const logActivo = opciones.log !== false;
    await nodosService.asegurarEsquemaNodosBarriales({ sembrarDemo: false });

    const { clienteBunker, creadoTitular } = await asegurarClienteTitularMoroEnBunker();

    // 1. Verificar si ya existe el nodo `moro`
    const existenteRes = await db.query(
        `SELECT id, codigo_nodo, slug, nombre_marca, gestor_nombre, gestor_token,
                bunker_cliente_id, codigo_bunker_cliente, cliente_madre_bunker_id,
                codigo_bunker_cliente_madre, cuenta_bancaria_id, alias_bancario_display,
                alicuota_iva_margen_pct, alicuota_iibb_margen_pct, activo
         FROM public.nodos_maestro
         WHERE LOWER(slug) = 'moro'
         LIMIT 1`
    );

    let nodoMoro = existenteRes.rows[0] || null;
    let creadoEnEstaCorrida = false;

    if (!nodoMoro) {
        let codigoNodoDeseado = 'NODO-003';
        const chkCod = await db.query(
            `SELECT id, slug FROM public.nodos_maestro WHERE UPPER(codigo_nodo) = UPPER($1) LIMIT 1`,
            [codigoNodoDeseado]
        );
        if (chkCod.rows.length > 0) {
            codigoNodoDeseado = '';
        }

        const cfgCanalRes = await db.query(
            `SELECT cuenta_bancaria_id, alias_recaudador, cbu_recaudador, titular_recaudador
             FROM public.nodos_configuracion_canal
             WHERE id = 1
             LIMIT 1`
        );
        const cfgCanal = cfgCanalRes.rows[0] || null;

        const zebraDataUrl = nodosService.leerLogoZebraMoroDataUrl();
        const modulosMoro = nodosService.obtenerPresetModulosActivos('LOCALES');
        const dicTextosMoro = nodosService.obtenerPresetDiccionarioTextosNodo('LOCALES');

        nodoMoro = await nodosService.guardarNodoMaestro({
            codigo_nodo: codigoNodoDeseado,
            slug: 'moro',
            nombre_marca: 'MORO',
            subtitulo_marca: 'Almacén de Bebidas · Retiro sin cargo en Av. 7 N° 202 (esq. 36)',
            bajada_marca: 'Almacén de Bebidas',
            gestor_nombre: 'Agustín Chiste',
            gestor_telefono: MORO_TITULAR_CANONICO.telefono_digitos,
            gestor_email: '',
            barrio_zona: 'Centro, La Plata',
            direccion_retiro: MORO_TITULAR_CANONICO.domicilio_fiscal,
            cliente_madre_bunker_id: Number(clienteBunker.id),
            codigo_bunker_cliente_madre: clienteBunker.codigo_bunker_cliente,
            usar_cuenta_madre_unificada: true,
            usa_cuenta_compartida: true,
            cuenta_bancaria_id: cfgCanal?.cuenta_bancaria_id || null,
            perfil_operativo: 'LOCALES',
            modulos_activos: modulosMoro,
            config_retiro_local: MORO_CONFIG_RETIRO_LOCAL,
            diccionario_textos: dicTextosMoro,
            permitir_retiro_nodo: true,
            permitir_reparto_propio: false,
            permitir_envio_barrial: false,
            permitir_encomienda: false,
            cobro_efectivo_entrega: false,
            mostrar_ingredientes_tienda: true,
            cargo_envio_barrial: 0,
            margen_gestor_default_pct: 28,
            config_ventanas_corte: MORO_VENTANAS_CORTE,
            color_primario: '#182132',
            latitud: -34.903948,
            longitud: -57.964282,
            logo_original_base64: zebraDataUrl,
            logo_zpl_config: nodosService.LOGO_ZPL_CONFIG_MORO_OFICIAL,
            tema_visual: nodosService.TEMA_VISUAL_MORO_OFICIAL
        });

        creadoEnEstaCorrida = true;
    } else if (nodoMoro.activo === false && opciones.reactivarSiInactivo === true) {
        const updAct = await db.query(
            `UPDATE public.nodos_maestro SET activo = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [nodoMoro.id]
        );
        nodoMoro = updAct.rows[0];
    }

    // 2. Si el nodo MORO tiene 0 ofertas en public.nodos_ofertas_gestor, vincular catálogo activo estándar
    const conteoOfertasRes = await db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE publicado_tienda = true)::int AS publicadas
         FROM public.nodos_ofertas_gestor
         WHERE nodo_id = $1`,
        [nodoMoro.id]
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
            const calcOf = nodosService.calcularPrecioYGananciaNetaOfertaNodo({
                costoBaseLamda: base,
                margenPct: margenInicial,
                ivaPct: nodoMoro.alicuota_iva_margen_pct ?? 21,
                iibbPct: nodoMoro.alicuota_iibb_margen_pct ?? 4,
                modo: 'margen'
            });
            const insOf = await db.query(
                `INSERT INTO public.nodos_ofertas_gestor (
                    nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                    margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor, publicado_tienda
                 ) VALUES ($1, $2, $3, $4, $5, $6, true)
                 ON CONFLICT (nodo_id, articulo_catalogo_id) DO NOTHING
                 RETURNING id`,
                [nodoMoro.id, cat.id, base, margenInicial, calcOf.precio_tienda, calcOf.ganancia_neta_nodo]
            );
            if (insOf.rowCount > 0) ofertasVinculadasNuevas += 1;
        }

        const postRes = await db.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE publicado_tienda = true)::int AS publicadas
             FROM public.nodos_ofertas_gestor
             WHERE nodo_id = $1`,
            [nodoMoro.id]
        );
        totalOfertas = Number(postRes.rows[0]?.total || 0);
        ofertasPublicadas = Number(postRes.rows[0]?.publicadas || 0);
    }

    const publicHost = String(process.env.NODOS_PUBLIC_BASE_URL || 'https://tienda.lamdaser.com').replace(/\/+$/, '');
    const resultado = {
        ok: true,
        created: creadoEnEstaCorrida,
        titular_bunker_creado: creadoTitular,
        cliente_madre_bunker_id: Number(clienteBunker.id),
        codigo_bunker_cliente_madre: clienteBunker.codigo_bunker_cliente,
        nodo_id: Number(nodoMoro.id),
        codigo_nodo: nodoMoro.codigo_nodo,
        slug: nodoMoro.slug,
        perfil_operativo: 'LOCALES',
        codigo_bunker_cliente: nodoMoro.codigo_bunker_cliente,
        ofertas_vinculadas_nuevas: ofertasVinculadasNuevas,
        ofertas_total: totalOfertas,
        ofertas_publicadas: ofertasPublicadas,
        gestor_token: nodoMoro.gestor_token,
        urls: {
            tienda: `${publicHost}/tienda/moro`,
            gestor: `${publicHost}/gestor/moro?t=${encodeURIComponent(nodoMoro.gestor_token || '')}`
        }
    };

    if (logActivo) {
        console.log(`✅ [PROVISION-MORO] Nodo MORO verificado (creado=${creadoEnEstaCorrida}, titular_nuevo=${creadoTitular}, id=${resultado.nodo_id}, madre=${resultado.codigo_bunker_cliente_madre}, ofertas=${totalOfertas}, publicadas=${ofertasPublicadas})`);
    }

    return resultado;
}

if (require.main === module) {
    provisionarNodoMoro({ log: true })
        .then((res) => {
            console.log(JSON.stringify(res, null, 2));
            process.exit(0);
        })
        .catch((err) => {
            console.error('❌ [PROVISION-MORO] Error:', err);
            process.exit(1);
        });
}

module.exports = {
    provisionarNodoMoro,
    MORO_TITULAR_CANONICO,
    MORO_CONFIG_RETIRO_LOCAL
};
