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

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const db = require('../config/database');
const nodosService = require('../services/nodosBarrialesService');

async function migrarPerfilesOperativosNodos(opciones = {}) {
    const logActivo = opciones.log !== false;
    await nodosService.asegurarEsquemaNodosBarriales({ sembrarDemo: false });

    const { rows } = await db.query(
        `SELECT id, codigo_nodo, slug, nombre_marca, subtitulo_marca,
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

            const nuevoSubtitulo = subTieneJergaBarrial
                ? 'Alimentos Naturales y Frutos Secos · Envíos a Todo el País'
                : subRaw;

            const requiereUpdate =
                !yaEsFulfillment ||
                !tieneModulos ||
                !tienePaq ||
                subTieneJergaBarrial ||
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
                        modulos_activos = $3::jsonb,
                        config_paqueteria = $4::jsonb,
                        updated_at = NOW()
                     WHERE id = $1`,
                    [
                        row.id,
                        nuevoSubtitulo,
                        JSON.stringify(modulosManso),
                        JSON.stringify(configPaqManso)
                    ]
                );
                actualizados.push({ id: row.id, slug: row.slug, perfil_operativo: 'ecommerce_fulfillment' });
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
