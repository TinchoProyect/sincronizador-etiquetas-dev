'use strict';

/**
 * ============================================================================
 * SCRIPT AUDITABLE E IDEMPOTENTE DE SANEAMIENTO — ETAPA 5
 * ============================================================================
 * Modos:
 *   node scripts/sanearDatosNodosEtapa5.js           (por defecto --dry-run en BEGIN ... ROLLBACK)
 *   node scripts/sanearDatosNodosEtapa5.js --dry-run (explícito, siempre ROLLBACK)
 *   node scripts/sanearDatosNodosEtapa5.js --apply   (COMMIT transaccional real; exigir confirmación en etapa aprobada)
 *
 * Alcance estricto (NUNCA toca #35/#59 Pasa Rubia ni #74/#117 Aceituna/Arándano):
 *   1. GDFX200G (GRANA Flor x 200g): restaurar flujo_lamda=6, origen_tipo='UP_EXTERNA',
 *      ingrediente_origen_id=122, margen_lamda_pct=30%, rubro='CEREALES', sub_rubro='GRANOLA',
 *      recalculando Escalón 1 (Lista 8 + nodos_articulos_catalogo) y Escalón 2 (nodos_ofertas_gestor).
 *   2. ROMX500 (Romero x 500g): completar atributos canónicos del Diccionario Oficial Búnker
 *      para Familia 44 + relación PK #1573/#129, receta id=331, alta/sync en catálogo de Nodos
 *      (flujo=2, ing=193, envase=178) y ofertas habilitado_lamda=true / publicado_tienda=false.
 *   3. Metadatos puntuales + limpieza segura:
 *      - MFSTx1 -> rubro='FRUTOS SECOS', sub_rubro='MIX'
 *      - PTSX500G -> flujo_lamda=2, origen_tipo='INGREDIENTE', ingrediente_origen_id=56 (si existe)
 *      - CB-NODO-001 (bunker_clientes.id=93) -> nombre sincronizado con Paraíso
 *      - 5 recetas basura (TEST001, TEST002, TEST003, undefined, 8784896325) previa auditoría de 0 refs.
 *      - Reportar (sin borrar) recetas legacy huérfanas restantes.
 */

require('dotenv').config();
const assert = require('assert');
const db = require('../src/produccion/config/database');
const nodosBarrialesService = require('../src/produccion/services/nodosBarrialesService');

const MODOS_ARG = process.argv.slice(2);
const MODO_APPLY = MODOS_ARG.includes('--apply');
const MODO_DRY_RUN = !MODO_APPLY || MODOS_ARG.includes('--dry-run');

function round2(n) {
    return Number((Number(n) || 0).toFixed(2));
}

function round4(n) {
    return Number((Number(n) || 0).toFixed(4));
}

/**
 * Fórmula exacta de Escalón 1 / Lista Búnker (BunkerService / costosGrafoService).
 */
function calcularPrecioListaBunkerExacto({
    costoBaseUnitarioKiloOUnidad,
    kilosUnidad,
    esPack,
    margenPct,
    costoTiempo,
    ivaPct,
    modoIva,
    manoObraActiva
}) {
    const modoIvaNorm = String(modoIva || 'COMPLETO').toUpperCase();
    const ivaAplicado = modoIvaNorm === 'SIN_IVA' || modoIvaNorm === 'CERO'
        ? 0
        : (modoIvaNorm === 'MEDIO' || modoIvaNorm === 'DIEZ_Y_MEDIO' ? Number(ivaPct || 21) / 2 : Number(ivaPct || 21));
    const costoBaseFraccion = esPack ? Number(costoBaseUnitarioKiloOUnidad || 0) : Number(costoBaseUnitarioKiloOUnidad || 0) * Number(kilosUnidad || 1);
    const mo = manoObraActiva === false ? 0 : Number(costoTiempo || 0);
    const neto = (costoBaseFraccion * (1 + Number(margenPct || 0) / 100)) + mo;
    return round4(neto * (1 + ivaAplicado / 100));
}

async function tomarSnapshotGdfx200g(client) {
    const [ba, nac, bla8, ofs] = await Promise.all([
        client.query(`SELECT articulo_id, rubro, sub_rubro, familia_id, kilos_unidad, costo_base FROM public.bunker_articulos WHERE UPPER(articulo_id) = 'GDFX200G' LIMIT 1`),
        client.query(`SELECT id, sku_nodo, flujo_lamda, origen_tipo, ingrediente_origen_id, margen_lamda_pct, precio_base_nodo_neto, precio_base_nodo_final, activo FROM public.nodos_articulos_catalogo WHERE UPPER(sku_nodo) = 'GDFX200G' LIMIT 1`),
        client.query(`SELECT id, lista_id, margen_ganancia, costo_base_sobrescrito, costo_tiempo, iva, modo_iva, mano_obra_activa, precio_final FROM public.bunker_lista_articulos WHERE UPPER(articulo_numero) = 'GDFX200G' AND lista_id = 8 LIMIT 1`),
        client.query(`
            SELECT nog.id, nm.slug, nog.habilitado_lamda, nog.publicado_tienda, nog.precio_base_nodo_snapshot, nog.margen_gestor_pct, nog.precio_venta_vecino, nog.ganancia_unitaria_gestor
            FROM public.nodos_ofertas_gestor nog
            JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
            JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
            WHERE UPPER(nac.sku_nodo) = 'GDFX200G'
            ORDER BY nm.id ASC
        `)
    ]);
    return {
        bunker: ba.rows[0] || null,
        catalogo: nac.rows[0] || null,
        lista8: bla8.rows[0] || null,
        ofertas: ofs.rows
    };
}

async function sanearGdfx200g(client) {
    const antes = await tomarSnapshotGdfx200g(client);
    assert(antes.bunker, 'GDFX200G debe existir en public.bunker_articulos');
    assert(antes.catalogo, 'GDFX200G debe existir en public.nodos_articulos_catalogo');

    // 1. Completar rubro y sub_rubro en bunker_articulos sin alterar descripción ni anatomía
    await client.query(`
        UPDATE public.bunker_articulos
        SET rubro = 'CEREALES',
            sub_rubro = 'GRANOLA',
            updated_at = NOW()
        WHERE UPPER(articulo_id) = 'GDFX200G'
          AND (COALESCE(rubro, '') <> 'CEREALES' OR COALESCE(sub_rubro, '') <> 'GRANOLA')
    `);

    // 2. Obtener datos vivos de ingrediente #122 y envase de GDFX200G
    const cat = antes.catalogo;
    const catDetRes = await client.query(`
        SELECT kilos_unidad, insumo_envase_id, cantidad_envases_unidad, segundos_fraccionamiento, valor_hora_aplicado, iva_pct, iibb_pct, margen_sugerido_gestor_pct
        FROM public.nodos_articulos_catalogo WHERE id = $1 LIMIT 1
    `, [cat.id]);
    const cd = catDetRes.rows[0];
    const refRes = await client.query(`
        SELECT i.id AS ing_id, COALESCE(i.costo_patron, 0)::numeric(14,2) AS ing_costo_kg,
               env.id AS env_id, COALESCE(env.costo_patron, 0)::numeric(14,2) AS env_costo
        FROM public.ingredientes i
        LEFT JOIN public.ingredientes env ON env.id = $2::int
        WHERE i.id = $1::int
        LIMIT 1
    `, [122, Number(cd.insumo_envase_id || 180)]);
    assert(refRes.rowCount > 0, 'Ingrediente #122 (Grana de Flor) debe existir');
    const ingCostoKg = Number(refRes.rows[0].ing_costo_kg || 0);
    const envCosto = Number(refRes.rows[0].env_costo || 0);
    const kilos = Number(cd.kilos_unidad || antes.bunker.kilos_unidad || 0.2);

    const calc = nodosBarrialesService.calcularEstructuraCostosNodo({
        costo_insumo_kg: ingCostoKg,
        kilos_unidad: kilos,
        costo_envase_unitario: envCosto,
        cantidad_envases_unidad: Number(cd.cantidad_envases_unidad ?? 1),
        segundos_fraccionamiento: Number(cd.segundos_fraccionamiento ?? 300),
        valor_hora_aplicado: Number(cd.valor_hora_aplicado ?? 7000),
        margen_lamda_pct: 30,
        iva_pct: Number(cd.iva_pct ?? 21),
        iibb_pct: Number(cd.iibb_pct ?? 4),
        margen_sugerido_gestor_pct: Number(cd.margen_sugerido_gestor_pct ?? 28)
    });

    await client.query(`
        UPDATE public.nodos_articulos_catalogo
        SET flujo_lamda = 6,
            origen_tipo = 'UP_EXTERNA',
            ingrediente_origen_id = 122,
            costo_insumo_kg = $1,
            costo_insumo_fraccion = $2,
            costo_envase_aplicado = $3,
            costo_mano_obra_aplicado = $4,
            costo_puro_total = $5,
            margen_lamda_pct = 30.00,
            precio_base_nodo_neto = $6,
            precio_base_nodo_final = $7,
            precio_sugerido_vecino = $8,
            updated_at = NOW()
        WHERE id = $9
    `, [
        ingCostoKg,
        calc.costo_insumo_fraccion,
        calc.costo_envase_aplicado,
        calc.costo_mano_obra_aplicado,
        calc.costo_puro_total,
        calc.precio_base_nodo_neto,
        calc.precio_base_nodo_final,
        calc.precio_sugerido_vecino,
        cat.id
    ]);

    // 3. Recalcular Lista 8 (NODOS) en bunker_lista_articulos
    if (antes.lista8) {
        const l8 = antes.lista8;
        const costoBaseSobrescrito = round4(ingCostoKg + (envCosto / Math.max(0.001, kilos)));
        const precioFinalLista8 = calcularPrecioListaBunkerExacto({
            costoBaseUnitarioKiloOUnidad: costoBaseSobrescrito,
            kilosUnidad: kilos,
            esPack: false,
            margenPct: 30,
            costoTiempo: Number(l8.costo_tiempo || calc.costo_mano_obra_aplicado),
            ivaPct: Number(l8.iva || 21),
            modoIva: l8.modo_iva || 'COMPLETO',
            manoObraActiva: l8.mano_obra_activa !== false
        });
        await client.query(`
            UPDATE public.bunker_lista_articulos
            SET margen_ganancia = 30.0000,
                costo_base_sobrescrito = $1,
                precio_final = $2,
                updated_at = NOW()
            WHERE id = $3
        `, [costoBaseSobrescrito, precioFinalLista8, l8.id]);
    }

    // 4. Actualizar snapshot y precios en nodos_ofertas_gestor respetando margen_gestor_pct e impuestos de cada nodo
    const ofsDet = await client.query(`
        SELECT nog.id, nog.margen_gestor_pct, nog.precio_venta_vecino,
               COALESCE(nm.alicuota_iva_margen_pct, 21.00) AS iva_pct,
               COALESCE(nm.alicuota_iibb_margen_pct, 4.00) AS iibb_pct
        FROM public.nodos_ofertas_gestor nog
        JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
        WHERE nog.articulo_catalogo_id = $1
        ORDER BY nog.id ASC
    `, [cat.id]);
    for (const row of ofsDet.rows) {
        const calcOf = nodosBarrialesService.calcularPrecioYGananciaNetaOfertaNodo({
            costoBaseLamda: calc.precio_base_nodo_final,
            margenPct: Number(row.margen_gestor_pct ?? 28),
            ivaPct: nodosBarrialesService.normalizarAlicuotaFiscalNodo(row.iva_pct, 21),
            iibbPct: nodosBarrialesService.normalizarAlicuotaFiscalNodo(row.iibb_pct, 4),
            modo: 'margen'
        });
        await client.query(`
            UPDATE public.nodos_ofertas_gestor
            SET precio_base_nodo_snapshot = $1,
                precio_venta_vecino_anterior = precio_venta_vecino,
                precio_venta_vecino = $2,
                ganancia_unitaria_gestor = $3,
                alerta_cambio_costo = true,
                updated_at = NOW()
            WHERE id = $4
        `, [calc.precio_base_nodo_final, calcOf.precio_tienda, calcOf.ganancia_neta_nodo, row.id]);
    }

    const despues = await tomarSnapshotGdfx200g(client);
    return { antes, despues };
}

async function tomarSnapshotRomx500(client) {
    const [ba, rel, rec, nac, bla8, ofs] = await Promise.all([
        client.query(`SELECT articulo_id, descripcion_generada, familia_id, rubro, sub_rubro, kilos_unidad, costo_base, propiedades_dinamicas FROM public.bunker_articulos WHERE UPPER(articulo_id) = 'ROMX500' LIMIT 1`),
        client.query(`SELECT id, familia_id, articulo_principal_id, termino_id, categoria, categoria_id FROM public.bunker_relacion_atributo_principal WHERE familia_id = 44 AND articulo_principal_id = 1573`),
        client.query(`SELECT id, articulo_numero, articulo_sugerido_numero FROM public.recetas WHERE UPPER(articulo_numero) = 'ROMX500' LIMIT 1`),
        client.query(`SELECT id, sku_nodo, flujo_lamda, origen_tipo, ingrediente_origen_id, insumo_envase_id, margen_lamda_pct, precio_base_nodo_neto, precio_base_nodo_final, activo FROM public.nodos_articulos_catalogo WHERE UPPER(sku_nodo) = 'ROMX500' LIMIT 1`),
        client.query(`SELECT id, lista_id, margen_ganancia, costo_base_sobrescrito, precio_final FROM public.bunker_lista_articulos WHERE UPPER(articulo_numero) = 'ROMX500' AND lista_id = 8 LIMIT 1`),
        client.query(`
            SELECT nog.id, nm.slug, nog.habilitado_lamda, nog.publicado_tienda, nog.precio_base_nodo_snapshot, nog.margen_gestor_pct, nog.precio_venta_vecino
            FROM public.nodos_ofertas_gestor nog
            JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
            JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
            WHERE UPPER(nac.sku_nodo) = 'ROMX500'
            ORDER BY nm.id ASC
        `)
    ]);
    return {
        bunker: ba.rows[0] || null,
        relacion_fam44: rel.rows,
        receta: rec.rows[0] || null,
        catalogo: nac.rows[0] || null,
        lista8: bla8.rows[0] || null,
        ofertas: ofs.rows
    };
}

async function sanearRomx500(client) {
    const antes = await tomarSnapshotRomx500(client);
    assert(antes.bunker, 'ROMX500 debe existir en public.bunker_articulos');

    // 1. Asegurar relación PK oficial para Romero (#1573) con Deshidratado (#129) en Familia 44
    const catTratRes = await client.query(
        `SELECT id FROM public.bunker_familia_categorias WHERE familia_id = 44 AND LOWER(categoria) = 'tratamiento' LIMIT 1`
    );
    const catTratId = catTratRes.rows[0] ? Number(catTratRes.rows[0].id) : 298;
    await client.query(`
        INSERT INTO public.bunker_relacion_atributo_principal
            (familia_id, articulo_principal_id, termino_id, categoria, categoria_id)
        SELECT 44, 1573, 129, 'tratamiento', $1
        WHERE NOT EXISTS (
            SELECT 1 FROM public.bunker_relacion_atributo_principal
            WHERE familia_id = 44 AND articulo_principal_id = 1573 AND termino_id = 129 AND LOWER(categoria) = 'tratamiento'
        )
    `, [catTratId]);

    // 2. Completar propiedades_dinamicas canónicas en bunker_articulos sin romper descripción_generada
    const propsActual = (antes.bunker.propiedades_dinamicas && typeof antes.bunker.propiedades_dinamicas === 'object')
        ? antes.bunker.propiedades_dinamicas
        : {};
    const propsCanonica = {
        ...propsActual,
        familia_id: 44,
        familia_nombre: 'Deshidratados',
        articulo_principal_id: 1573,
        articulo_principal: 'Romero',
        abreviatura_principal: 'RMRO',
        incluir_familia: false,
        posicion_familia: 'ANTES',
        modo_display_familia: 'COMPLETO',
        silencioso_principal: false,
        modo_display_principal: 'COMPLETO',
        posiciones: {
            ...(propsActual.posiciones || {}),
            pos_1: {
                categoria_id: catTratId,
                termino_id: 129,
                eje: 'tratamiento',
                valor: 'Deshidratado',
                abreviatura: 'DHTDO',
                posicion: 1,
                silencioso: true,
                modo_display: 'COMPLETO'
            }
        }
    };
    await client.query(`
        UPDATE public.bunker_articulos
        SET familia_id = 44,
            rubro = COALESCE(NULLIF(TRIM(rubro), ''), 'DESHIDRATADOS'),
            sub_rubro = COALESCE(NULLIF(TRIM(sub_rubro), ''), 'ROMERO'),
            propiedades_dinamicas = $1::jsonb,
            updated_at = NOW()
        WHERE UPPER(articulo_id) = 'ROMX500'
    `, [JSON.stringify(propsCanonica)]);

    // 3. Asegurar receta #ROMX500 y vínculo determinista con ingrediente #193 + envase #178
    const ingRomRes = await client.query(`SELECT id, costo_patron, articulo_vinculado_numero FROM public.ingredientes WHERE id = 193 LIMIT 1`);
    const envRomRes = await client.query(`SELECT id, costo_patron FROM public.ingredientes WHERE id = 178 LIMIT 1`);
    assert(ingRomRes.rowCount > 0, 'Ingrediente #193 (Romero) debe existir');
    assert(envRomRes.rowCount > 0, 'Insumo #178 (Bolsa 20x30) debe existir');
    const ingRom = ingRomRes.rows[0];
    const envRom = envRomRes.rows[0];

    let recetaId = antes.receta ? Number(antes.receta.id) : null;
    if (!recetaId) {
        const insRec = await client.query(`
            INSERT INTO public.recetas (articulo_numero, descripcion, articulo_sugerido_numero)
            VALUES ('ROMX500', 'Receta de Búnker para Romero x 500g', $1)
            RETURNING id
        `, [ingRom.articulo_vinculado_numero || null]);
        recetaId = Number(insRec.rows[0].id);
        await client.query(`INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, cantidad) VALUES ($1, 193, 0.5), ($1, 178, 1)`, [recetaId]);
    } else {
        await client.query(`
            UPDATE public.recetas
            SET articulo_sugerido_numero = $1
            WHERE id = $2
              AND articulo_sugerido_numero IS DISTINCT FROM $1
        `, [ingRom.articulo_vinculado_numero || null, recetaId]);
        await client.query(`
            INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, cantidad)
            SELECT $1, 193, 0.5
            WHERE NOT EXISTS (SELECT 1 FROM public.receta_ingredientes WHERE receta_id = $1 AND ingrediente_id = 193)
        `, [recetaId]);
        await client.query(`
            INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, cantidad)
            SELECT $1, 178, 1
            WHERE NOT EXISTS (SELECT 1 FROM public.receta_ingredientes WHERE receta_id = $1 AND ingrediente_id = 178)
        `, [recetaId]);
    }

    // 4. Incorporar / normalizar ROMX500 en nodos_articulos_catalogo (flujo 2, ingrediente 193)
    const ingCostoKg = Number(ingRom.costo_patron || 5000);
    const envCosto = Number(envRom.costo_patron || 75.45);
    const kilos = Number(antes.bunker.kilos_unidad || 0.5);
    const margenLamda = antes.catalogo ? Number(antes.catalogo.margen_lamda_pct ?? 25) : 25;
    const calc = nodosBarrialesService.calcularEstructuraCostosNodo({
        costo_insumo_kg: ingCostoKg,
        kilos_unidad: kilos,
        costo_envase_unitario: envCosto,
        cantidad_envases_unidad: 1,
        segundos_fraccionamiento: 300,
        valor_hora_aplicado: 7000,
        margen_lamda_pct: margenLamda,
        iva_pct: 21,
        iibb_pct: 4,
        margen_sugerido_gestor_pct: 28
    });

    let catalogoId;
    if (antes.catalogo) {
        catalogoId = Number(antes.catalogo.id);
        await client.query(`
            UPDATE public.nodos_articulos_catalogo
            SET nombre_publico = $1,
                nomenclatura_bunker = $1,
                familia_bunker_id = 44,
                familia_bunker_nombre = 'Deshidratados',
                articulo_principal_bunker = 'Romero',
                categoria_familiar = 'DESHIDRATADOS',
                presentacion_etiqueta = 'Bolsa 500g',
                flujo_lamda = 2,
                origen_tipo = 'INGREDIENTE',
                ingrediente_origen_id = 193,
                insumo_envase_id = 178,
                kilos_unidad = $2,
                costo_insumo_kg = $3,
                costo_insumo_fraccion = $4,
                costo_envase_aplicado = $5,
                costo_mano_obra_aplicado = $6,
                costo_puro_total = $7,
                margen_lamda_pct = $8,
                precio_base_nodo_neto = $9,
                precio_base_nodo_final = $10,
                precio_sugerido_vecino = $11,
                activo = true,
                estado = 'APROBADO',
                updated_at = NOW()
            WHERE id = $12
        `, [
            antes.bunker.descripcion_generada || 'Romero x 500g',
            kilos,
            ingCostoKg,
            calc.costo_insumo_fraccion,
            calc.costo_envase_aplicado,
            calc.costo_mano_obra_aplicado,
            calc.costo_puro_total,
            margenLamda,
            calc.precio_base_nodo_neto,
            calc.precio_base_nodo_final,
            calc.precio_sugerido_vecino,
            catalogoId
        ]);
    } else {
        const insCat = await client.query(`
            INSERT INTO public.nodos_articulos_catalogo (
                sku_nodo, nombre_publico, nomenclatura_bunker, categoria_familiar, presentacion_etiqueta,
                familia_bunker_id, familia_bunker_nombre, articulo_principal_bunker,
                flujo_lamda, origen_tipo, ingrediente_origen_id, kilos_unidad,
                insumo_envase_id, cantidad_envases_unidad, segundos_fraccionamiento, valor_hora_aplicado,
                costo_insumo_kg, costo_insumo_fraccion, costo_envase_aplicado, costo_mano_obra_aplicado,
                margen_lamda_pct, iva_pct, iibb_pct, costo_puro_total,
                precio_base_nodo_neto, precio_base_nodo_final, margen_sugerido_gestor_pct, precio_sugerido_vecino,
                estado, activo
            ) VALUES (
                'ROMX500', $1, $1, 'DESHIDRATADOS', 'Bolsa 500g',
                44, 'Deshidratados', 'Romero',
                2, 'INGREDIENTE', 193, $2,
                178, 1, 300, 7000,
                $3, $4, $5, $6,
                $7, 21, 4, $8,
                $9, $10, 28, $11,
                'APROBADO', true
            )
            RETURNING id
        `, [
            antes.bunker.descripcion_generada || 'Romero x 500g',
            kilos,
            ingCostoKg,
            calc.costo_insumo_fraccion,
            calc.costo_envase_aplicado,
            calc.costo_mano_obra_aplicado,
            margenLamda,
            calc.costo_puro_total,
            calc.precio_base_nodo_neto,
            calc.precio_base_nodo_final,
            calc.precio_sugerido_vecino
        ]);
        catalogoId = Number(insCat.rows[0].id);
    }

    // 5. Asegurar fila de ROMX500 en Lista 8 (NODOS)
    const costoBaseSobrescrito = round4(ingCostoKg + (envCosto / Math.max(0.001, kilos)));
    const precioFinalLista8 = calcularPrecioListaBunkerExacto({
        costoBaseUnitarioKiloOUnidad: costoBaseSobrescrito,
        kilosUnidad: kilos,
        esPack: false,
        margenPct: margenLamda,
        costoTiempo: calc.costo_mano_obra_aplicado,
        ivaPct: 21,
        modoIva: 'COMPLETO',
        manoObraActiva: true
    });
    if (antes.lista8) {
        await client.query(`
            UPDATE public.bunker_lista_articulos
            SET margen_ganancia = $1,
                costo_base_sobrescrito = $2,
                precio_final = $3,
                updated_at = NOW()
            WHERE id = $4
        `, [margenLamda, costoBaseSobrescrito, precioFinalLista8, antes.lista8.id]);
    } else {
        await client.query(`
            INSERT INTO public.bunker_lista_articulos (
                lista_id, articulo_numero, margen_ganancia, costo_base_sobrescrito,
                costo_tiempo, iva, modo_iva, precio_final, modo_calculo,
                mano_obra_activa, minutos_mano_obra
            ) VALUES (8, 'ROMX500', $1, $2, $3, 21.00, 'COMPLETO', $4, 'AUTOMATIC', true, 5.0)
        `, [margenLamda, costoBaseSobrescrito, calc.costo_mano_obra_aplicado, precioFinalLista8]);
    }

    // 6. Ofertas de nodos: habilitado_lamda = true, publicado_tienda = false
    const nodosRes = await client.query(`
        SELECT id, COALESCE(margen_gestor_default_pct, 28.00) AS margen_def,
               COALESCE(alicuota_iva_margen_pct, 21.00) AS iva_pct,
               COALESCE(alicuota_iibb_margen_pct, 4.00) AS iibb_pct
        FROM public.nodos_maestro
        ORDER BY id ASC
    `);
    for (const nm of nodosRes.rows) {
        const exOfRes = await client.query(
            `SELECT id, margen_gestor_pct FROM public.nodos_ofertas_gestor WHERE nodo_id = $1 AND articulo_catalogo_id = $2 LIMIT 1`,
            [nm.id, catalogoId]
        );
        const margenNodo = exOfRes.rowCount > 0 ? Number(exOfRes.rows[0].margen_gestor_pct ?? nm.margen_def) : Number(nm.margen_def);
        const calcOf = nodosBarrialesService.calcularPrecioYGananciaNetaOfertaNodo({
            costoBaseLamda: calc.precio_base_nodo_final,
            margenPct: margenNodo,
            ivaPct: nodosBarrialesService.normalizarAlicuotaFiscalNodo(nm.iva_pct, 21),
            iibbPct: nodosBarrialesService.normalizarAlicuotaFiscalNodo(nm.iibb_pct, 4),
            modo: 'margen'
        });
        if (exOfRes.rowCount > 0) {
            await client.query(`
                UPDATE public.nodos_ofertas_gestor
                SET habilitado_lamda = true,
                    publicado_tienda = false,
                    precio_base_nodo_snapshot = $1,
                    precio_venta_vecino = $2,
                    ganancia_unitaria_gestor = $3,
                    updated_at = NOW()
                WHERE id = $4
            `, [calc.precio_base_nodo_final, calcOf.precio_tienda, calcOf.ganancia_neta_nodo, exOfRes.rows[0].id]);
        } else {
            await client.query(`
                INSERT INTO public.nodos_ofertas_gestor (
                    nodo_id, articulo_catalogo_id, habilitado_lamda, publicado_tienda,
                    precio_base_nodo_snapshot, margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor
                ) VALUES ($1, $2, true, false, $3, $4, $5, $6)
            `, [nm.id, catalogoId, calc.precio_base_nodo_final, margenNodo, calcOf.precio_tienda, calcOf.ganancia_neta_nodo]);
        }
    }

    const despues = await tomarSnapshotRomx500(client);
    return { antes, despues };
}

async function sanearMetadatosYBasura(client) {
    // 1. MFSTx1 rubro/sub_rubro
    const mfstAntesRes = await client.query(`SELECT articulo_id, rubro, sub_rubro FROM public.bunker_articulos WHERE UPPER(articulo_id) = 'MFSTX1' LIMIT 1`);
    if (mfstAntesRes.rowCount > 0) {
        await client.query(`
            UPDATE public.bunker_articulos
            SET rubro = 'FRUTOS SECOS',
                sub_rubro = 'MIX',
                updated_at = NOW()
            WHERE UPPER(articulo_id) = 'MFSTX1'
              AND (COALESCE(rubro, '') <> 'FRUTOS SECOS' OR COALESCE(sub_rubro, '') <> 'MIX')
        `);
    }
    const mfstDespuesRes = await client.query(`SELECT articulo_id, rubro, sub_rubro FROM public.bunker_articulos WHERE UPPER(articulo_id) = 'MFSTX1' LIMIT 1`);

    // 2. PTSX500G flujo_lamda = 2 (mono-ingrediente de PTSx5 -> #56 Pistacho c/ cáscara)
    const ptsAntesNac = await client.query(`SELECT id, sku_nodo, flujo_lamda, origen_tipo, ingrediente_origen_id FROM public.nodos_articulos_catalogo WHERE UPPER(sku_nodo) = 'PTSX500G' LIMIT 1`);
    const ptsIngRes = await client.query(`SELECT id FROM public.ingredientes WHERE UPPER(COALESCE(articulo_vinculado_numero, '')) = 'PTSX5' ORDER BY id ASC LIMIT 1`);
    const ptsIngId = ptsIngRes.rows[0] ? Number(ptsIngRes.rows[0].id) : 56;
    if (ptsAntesNac.rowCount > 0) {
        await client.query(`
            UPDATE public.nodos_articulos_catalogo
            SET flujo_lamda = 2,
                origen_tipo = 'INGREDIENTE',
                ingrediente_origen_id = $1,
                updated_at = NOW()
            WHERE id = $2
        `, [ptsIngId, ptsAntesNac.rows[0].id]);
    }
    const ptsDespuesNac = await client.query(`SELECT id, sku_nodo, flujo_lamda, origen_tipo, ingrediente_origen_id FROM public.nodos_articulos_catalogo WHERE UPPER(sku_nodo) = 'PTSX500G' LIMIT 1`);

    // 3. CB-NODO-001 (bunker_clientes.id = 93) sincronizado con Paraíso
    const cbAntesRes = await client.query(`
        SELECT bc.id, bc.codigo_bunker_cliente, bc.cliente_nombre, nm.nombre_marca, nm.gestor_nombre
        FROM public.bunker_clientes bc
        LEFT JOIN public.nodos_maestro nm ON nm.bunker_cliente_id = bc.id
        WHERE bc.id = 93 OR bc.codigo_bunker_cliente = 'CB-NODO-001'
        LIMIT 1
    `);
    let cbDespues = cbAntesRes.rows[0] || null;
    if (cbAntesRes.rowCount > 0) {
        const r = cbAntesRes.rows[0];
        const nombreMarca = String(r.nombre_marca || 'Paraíso').trim();
        const gestorNombre = String(r.gestor_nombre || 'Matías Ferronato').trim();
        const nombreEsperado = `[NODO] ${nombreMarca} (${gestorNombre})`;
        if (r.cliente_nombre !== nombreEsperado) {
            await client.query(`UPDATE public.bunker_clientes SET cliente_nombre = $1 WHERE id = $2`, [nombreEsperado, r.id]);
        }
        const cbAfter = await client.query(`SELECT id, codigo_bunker_cliente, cliente_nombre FROM public.bunker_clientes WHERE id = $1`, [r.id]);
        cbDespues = cbAfter.rows[0];
    }

    // 4. 5 recetas basura (auditoría de 0 referencias antes de eliminar)
    const codigosBasura = ['TEST001', 'TEST002', 'TEST003', 'undefined', '8784896325'];
    const basuraAntesRes = await client.query(`
        SELECT r.id, r.articulo_numero, r.descripcion,
               (SELECT COUNT(*)::int FROM public.receta_ingredientes ri WHERE ri.receta_id = r.id) AS items_count,
               (SELECT COUNT(*)::int FROM public.bunker_articulos ba WHERE UPPER(ba.articulo_id) = UPPER(r.articulo_numero)) AS refs_bunker,
               (SELECT COUNT(*)::int FROM public.articulos a WHERE UPPER(a.numero) = UPPER(r.articulo_numero)) AS refs_articulos,
               (SELECT COUNT(*)::int FROM public.nodos_articulos_catalogo nac WHERE UPPER(nac.sku_nodo) = UPPER(r.articulo_numero)) AS refs_nodos,
               (SELECT COUNT(*)::int FROM public.presupuestos_detalles pd WHERE UPPER(pd.articulo) = UPPER(r.articulo_numero)) AS refs_presupuestos,
               (SELECT COUNT(*)::int FROM public.bunker_lista_articulos bla WHERE UPPER(bla.articulo_numero) = UPPER(r.articulo_numero)) AS refs_listas
        FROM public.recetas r
        WHERE r.articulo_numero = ANY($1::text[])
        ORDER BY r.id ASC
    `, [codigosBasura]);

    const eliminadasBasura = [];
    for (const r of basuraAntesRes.rows) {
        const totalRefs = Number(r.refs_bunker) + Number(r.refs_articulos) + Number(r.refs_nodos) + Number(r.refs_presupuestos) + Number(r.refs_listas);
        assert.strictEqual(totalRefs, 0, `Receta ${r.articulo_numero} tiene ${totalRefs} referencias activas, abortando baja`);
        await client.query(`DELETE FROM public.receta_ingredientes WHERE receta_id = $1`, [r.id]);
        await client.query(`DELETE FROM public.recetas WHERE id = $1`, [r.id]);
        eliminadasBasura.push({ id: Number(r.id), articulo_numero: r.articulo_numero, items_eliminados: Number(r.items_count) });
    }

    // 5. Reporte (SOLO LECTURA) de las recetas legacy huérfanas restantes
    const legacyRestantesRes = await client.query(`
        SELECT r.id, r.articulo_numero, r.descripcion
        FROM public.recetas r
        WHERE NOT EXISTS (SELECT 1 FROM public.bunker_articulos ba WHERE UPPER(ba.articulo_id) = UPPER(r.articulo_numero))
        ORDER BY r.id ASC
    `);

    return {
        mfstx1: { antes: mfstAntesRes.rows[0] || null, despues: mfstDespuesRes.rows[0] || null },
        ptsx500g: {
            estado: ptsAntesNac.rowCount > 0 ? 'ACTUALIZADO' : 'NO_PRESENTE (idempotente)',
            antes: ptsAntesNac.rows[0] || null,
            despues: ptsDespuesNac.rows[0] || null
        },
        cb_nodo_001: {
            antes: cbAntesRes.rows[0] ? { id: cbAntesRes.rows[0].id, codigo: cbAntesRes.rows[0].codigo_bunker_cliente, cliente_nombre: cbAntesRes.rows[0].cliente_nombre } : null,
            despues: cbDespues
        },
        recetas_basura: {
            antes_encontradas: basuraAntesRes.rows,
            eliminadas: eliminadasBasura,
            despues_restantes_en_bd: 0
        },
        recetas_legacy_reportadas_sin_borrar: {
            total: legacyRestantesRes.rowCount,
            codigos: legacyRestantesRes.rows.map(x => x.articulo_numero)
        }
    };
}

function imprimirTablaAntesDespues(resultado) {
    console.log('\n==================== RESUMEN ANTES -> DESPUÉS ====================');

    const gA = resultado.gdfx200g.antes;
    const gD = resultado.gdfx200g.despues;
    console.table([
        {
            entidad: 'GDFX200G (bunker_articulos)',
            campo: 'rubro / sub_rubro',
            antes: `${gA.bunker.rubro} / ${gA.bunker.sub_rubro}`,
            despues: `${gD.bunker.rubro} / ${gD.bunker.sub_rubro}`
        },
        {
            entidad: 'GDFX200G (nodos_articulos_catalogo)',
            campo: 'flujo / origen / ing / margen% / base_final',
            antes: `LDN ${gA.catalogo.flujo_lamda} / ${gA.catalogo.origen_tipo} / #${gA.catalogo.ingrediente_origen_id} / ${gA.catalogo.margen_lamda_pct}% / $${gA.catalogo.precio_base_nodo_final}`,
            despues: `LDN ${gD.catalogo.flujo_lamda} / ${gD.catalogo.origen_tipo} / #${gD.catalogo.ingrediente_origen_id} / ${gD.catalogo.margen_lamda_pct}% / $${gD.catalogo.precio_base_nodo_final}`
        },
        {
            entidad: 'GDFX200G (bunker_lista_articulos #8)',
            campo: 'margen% / costo_sobrescrito / precio_final',
            antes: gA.lista8 ? `${gA.lista8.margen_ganancia}% / $${gA.lista8.costo_base_sobrescrito} / $${gA.lista8.precio_final}` : 'N/A',
            despues: gD.lista8 ? `${gD.lista8.margen_ganancia}% / $${gD.lista8.costo_base_sobrescrito} / $${gD.lista8.precio_final}` : 'N/A'
        },
        ...gA.ofertas.map((oA, idx) => {
            const oD = gD.ofertas[idx];
            return {
                entidad: `GDFX200G oferta (${oA.slug})`,
                campo: `mrg ${oA.margen_gestor_pct}% | snap / vecino / gan`,
                antes: `$${oA.precio_base_nodo_snapshot} / $${oA.precio_venta_vecino} / $${oA.ganancia_unitaria_gestor}`,
                despues: `$${oD.precio_base_nodo_snapshot} / $${oD.precio_venta_vecino} / $${oD.ganancia_unitaria_gestor}`
            };
        }),
        {
            entidad: 'ROMX500 (bunker_articulos)',
            campo: 'pos_1 diccionario / rubro / sub_rubro',
            antes: `pos=${JSON.stringify(gA.bunker ? resultado.romx500.antes.bunker.propiedades_dinamicas?.posiciones : {})} | ${resultado.romx500.antes.bunker.rubro}/${resultado.romx500.antes.bunker.sub_rubro}`,
            despues: `pos_1=#129(DHTDO) | ${resultado.romx500.despues.bunker.rubro}/${resultado.romx500.despues.bunker.sub_rubro}`
        },
        {
            entidad: 'ROMX500 (bunker_relacion_atributo_principal)',
            campo: 'relaciones fam 44 (#1573 Romero)',
            antes: String(resultado.romx500.antes.relacion_fam44.length),
            despues: String(resultado.romx500.despues.relacion_fam44.length)
        },
        {
            entidad: 'ROMX500 (nodos_articulos_catalogo)',
            campo: 'estado / flujo / ing / envase / base_final',
            antes: resultado.romx500.antes.catalogo
                ? `LDN ${resultado.romx500.antes.catalogo.flujo_lamda} / $${resultado.romx500.antes.catalogo.precio_base_nodo_final}`
                : 'NO EXISTÍA EN CATÁLOGO NODOS',
            despues: `LDN ${resultado.romx500.despues.catalogo.flujo_lamda} / #${resultado.romx500.despues.catalogo.ingrediente_origen_id} / env#${resultado.romx500.despues.catalogo.insumo_envase_id} / $${resultado.romx500.despues.catalogo.precio_base_nodo_final}`
        },
        {
            entidad: 'ROMX500 (nodos_ofertas_gestor)',
            campo: 'ofertas (hab / pub)',
            antes: `${resultado.romx500.antes.ofertas.length} filas`,
            despues: `${resultado.romx500.despues.ofertas.length} nodos (${resultado.romx500.despues.ofertas.map(o => `${o.slug}:hab=${o.habilitado_lamda},pub=${o.publicado_tienda}`).join(' | ')})`
        },
        {
            entidad: 'MFSTx1 (bunker_articulos)',
            campo: 'rubro / sub_rubro',
            antes: `${resultado.otros.mfstx1.antes?.rubro} / ${resultado.otros.mfstx1.antes?.sub_rubro}`,
            despues: `${resultado.otros.mfstx1.despues?.rubro} / ${resultado.otros.mfstx1.despues?.sub_rubro}`
        },
        {
            entidad: 'PTSX500G (nodos_articulos_catalogo)',
            campo: 'flujo_lamda / ing',
            antes: resultado.otros.ptsx500g.antes ? `LDN ${resultado.otros.ptsx500g.antes.flujo_lamda}` : resultado.otros.ptsx500g.estado,
            despues: resultado.otros.ptsx500g.despues ? `LDN ${resultado.otros.ptsx500g.despues.flujo_lamda} / #${resultado.otros.ptsx500g.despues.ingrediente_origen_id}` : resultado.otros.ptsx500g.estado
        },
        {
            entidad: 'CB-NODO-001 (bunker_clientes #93)',
            campo: 'cliente_nombre',
            antes: resultado.otros.cb_nodo_001.antes?.cliente_nombre || 'N/A',
            despues: resultado.otros.cb_nodo_001.despues?.cliente_nombre || 'N/A'
        },
        {
            entidad: 'Recetas basura (TEST001..3, undefined, 8784896325)',
            campo: 'registros en recetas',
            antes: `${resultado.otros.recetas_basura.antes_encontradas.length} recetas (0 refs activas)`,
            despues: `${resultado.otros.recetas_basura.eliminadas.length} eliminadas -> 0 restantes`
        }
    ]);
    console.log('\nRecetas legacy huérfanas SOLO REPORTADAS (sin borrar):', resultado.otros.recetas_legacy_reportadas_sin_borrar);
}

async function run() {
    console.log(`=== SANEAMIENTO ETAPA 5 [MODO: ${MODO_DRY_RUN ? 'DRY-RUN (ROLLBACK)' : 'APPLY (COMMIT)'}] ===`);
    console.log(`BD activa: ${process.env.DB_NAME || '(desconocida)'} | LAMDA_MODO_LABORATORIO=${process.env.LAMDA_MODO_LABORATORIO}`);

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Guardrail inamovible: #35/#59 Pasa Rubia y #74/#117 Aceituna/Arándano
        const protegidosAntes = (await client.query(`
            SELECT id, codigo, nombre, costo_patron, articulo_vinculado_numero, rol_ingrediente
            FROM public.ingredientes
            WHERE id IN (35, 59, 74, 117)
            ORDER BY id ASC
        `)).rows;

        const gdfx200g = await sanearGdfx200g(client);
        const romx500 = await sanearRomx500(client);
        const otros = await sanearMetadatosYBasura(client);

        const protegidosDespues = (await client.query(`
            SELECT id, codigo, nombre, costo_patron, articulo_vinculado_numero, rol_ingrediente
            FROM public.ingredientes
            WHERE id IN (35, 59, 74, 117)
            ORDER BY id ASC
        `)).rows;
        assert.deepStrictEqual(protegidosDespues, protegidosAntes, 'VIOLACIÓN GUARDRAIL: ingredientes #35/#59/#74/#117 alterados');

        const resumen = {
            modo: MODO_DRY_RUN ? 'DRY_RUN_ROLLBACK' : 'APPLY_COMMIT',
            guardrail_ingredientes_35_59_74_117_intactos: true,
            gdfx200g,
            romx500,
            otros
        };
        imprimirTablaAntesDespues(resumen);

        if (MODO_DRY_RUN) {
            await client.query('ROLLBACK');
            console.log('\n✅ [DRY-RUN] ROLLBACK ejecutado: 0 cambios persistidos en BD.');
        } else {
            await client.query('COMMIT');
            console.log('\n✅ [APPLY] COMMIT ejecutado.');
        }
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

(async () => {
    let code = 0;
    try {
        await run();
    } catch (err) {
        console.error('❌ ERROR EN SANEAMIENTO ETAPA 5:', err);
        code = 1;
    } finally {
        await db.end().catch(() => {});
        setTimeout(() => process.exit(code), 150).unref();
    }
})();
