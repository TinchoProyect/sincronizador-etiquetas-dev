/**
 * Servicio Determinista de Combos / Packs Compuestos (LDN 8)
 * ---------------------------------------------------------------------------
 * - Modela Combos comerciales multi-SKU (2+ artículos oficiales LAMDA) sin
 *   contaminar public.recetas, receta_ingredientes ni pack_hijo_codigo.
 * - Siembra idempotentemente la Familia Oficial FAM-COMBOS ("Combos y Packs",
 *   abreviatura "CMB") en el Diccionario Oficial Búnker (0 estructura_desfasada).
 * - Soporta ambos modos de cálculo de costo_base_lamda:
 *     1. COSTO_MAS_MARGEN (por defecto: costos elaborados hijos + envase + MO + margen)
 *     2. SUMA_BASES_HIJOS_AJUSTADA (suma precios base hijos + cargo pack ± ajuste %)
 *   exhibiendo utilidad neta real de LAMDA descontando IIBB (4%) e IVA.
 * - Ejecuta cascada reactiva automática ante variaciones de costos hijos/insumos
 *   y explosión determinista de stock físico al despachar en Fulfillment,
 *   Canastos Barriales y Facturación B2B (con candado anti-doble-descuento).
 */

const db = require('../config/database');
const BunkerService = require('../../logistica/services/bunkerService');

let _esquemaCombosListo = false;

function marcarEsquemaCombosListo(estado = true) {
    _esquemaCombosListo = Boolean(estado);
}

function normalizarSku(sku) {
    return String(sku || '').trim().toUpperCase();
}

function normalizarAlicuota(val, def = 21) {
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : def;
}

function obtenerFactorNetoMargenTienda(ivaPct = 21, iibbPct = 4) {
    const iva = normalizarAlicuota(ivaPct, 21);
    const iibb = normalizarAlicuota(iibbPct, 4);
    const factor = (1 / (1 + iva / 100)) - (iibb / 100);
    return Math.max(0.01, Number(factor.toFixed(6)));
}

function calcularPrecioYGananciaNetaTienda(costoBase, margenPct, ivaPct = 21, iibbPct = 4) {
    const base = Math.max(0, Number(costoBase || 0));
    const margen = Math.max(0, Number(margenPct || 0));
    const factorNeto = obtenerFactorNetoMargenTienda(ivaPct, iibbPct);
    const precioVecino = Math.max(Math.round(base), Math.round(base * (1 + margen / 100)));
    const excedenteBruto = Math.max(0, precioVecino - base);
    const gananciaNeta = Math.round(excedenteBruto * factorNeto);
    return {
        precio_venta_vecino: precioVecino,
        ganancia_unitaria_gestor: gananciaNeta,
        margen_gestor_pct: base > 0 ? Number((((precioVecino - base) / base) * 100).toFixed(2)) : margen
    };
}

/**
 * Construye la firma canónica determinista de un Combo:
 * Ordena alfabéticamente por SKU en mayúsculas y consolida cantidades repetidas:
 * Ej: [{sku:'GDFX500', cantidad:1}, {sku:'BFX6', cantidad:2}] -> "BFX6:2|GDFX500:1"
 */
function construirFirmaComposicionCombo(items = []) {
    if (!Array.isArray(items) || items.length === 0) return '';
    const acum = new Map();
    for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue;
        const sku = normalizarSku(raw.componente_articulo_id || raw.articulo_id || raw.sku || raw.sku_nodo);
        const cant = Math.floor(Number(raw.cantidad || 0));
        if (!sku || !Number.isFinite(cant) || cant < 1) continue;
        acum.set(sku, (acum.get(sku) || 0) + cant);
    }
    if (acum.size === 0) return '';
    return Array.from(acum.entries())
        .sort((a, b) => a[0].localeCompare(b[0], 'en'))
        .map(([sku, cant]) => `${sku}:${cant}`)
        .join('|');
}

function formatearSufijoPeso(kilosUnidad) {
    const kg = Math.max(0.001, Number(kilosUnidad || 0));
    const gramos = Math.round(kg * 1000);
    if (gramos >= 1000 && gramos % 1000 === 0) {
        return `${gramos / 1000}kg`;
    }
    if (gramos >= 1000) {
        return `${Number(kg.toFixed(2)).toString().replace('.', ',')}kg`;
    }
    return `${gramos}g`;
}

function formatearSufijoSkuPeso(kilosUnidad) {
    const kg = Math.max(0.001, Number(kilosUnidad || 0));
    const gramos = Math.round(kg * 1000);
    if (gramos >= 1000 && gramos % 1000 === 0) {
        return `x${gramos / 1000}kg`;
    }
    return `x${gramos}`;
}

/**
 * Migración idempotente de esquema PostgreSQL + siembra oficial del Diccionario Búnker (FAM-COMBOS)
 */
async function ejecutarMigracionCombosCompuestos(runner) {
    const q = runner || db;

    // 1. Relajar CHECK de flujo_lamda en nodos_articulos_catalogo para permitir LDN 8 (Combos)
    const chkRes = await q.query(`
        SELECT conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'public.nodos_articulos_catalogo'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%flujo_lamda%'
    `);
    for (const row of chkRes.rows) {
        if (!String(row.def || '').includes('8')) {
            await q.query(`ALTER TABLE public.nodos_articulos_catalogo DROP CONSTRAINT IF EXISTS "${row.conname}"`);
        }
    }
    const chkAfter = await q.query(`
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.nodos_articulos_catalogo'::regclass
          AND conname = 'nodos_articulos_catalogo_flujo_lamda_check'
        LIMIT 1
    `);
    if (chkAfter.rowCount === 0) {
        await q.query(`
            ALTER TABLE public.nodos_articulos_catalogo
            ADD CONSTRAINT nodos_articulos_catalogo_flujo_lamda_check
            CHECK (flujo_lamda >= 1 AND flujo_lamda <= 8)
        `);
    }

    // 2. Columnas aditivas en tablas existentes
    await q.query(`
        ALTER TABLE public.bunker_articulos
            ADD COLUMN IF NOT EXISTS es_combo BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS firma_combo VARCHAR(500);

        ALTER TABLE public.stock_real_consolidado
            ADD COLUMN IF NOT EXISTS es_combo BOOLEAN NOT NULL DEFAULT false;

        ALTER TABLE public.nodos_articulos_catalogo
            ADD COLUMN IF NOT EXISTS es_combo BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS firma_combo VARCHAR(500),
            ADD COLUMN IF NOT EXISTS modo_precio_combo VARCHAR(40) NOT NULL DEFAULT 'COSTO_MAS_MARGEN',
            ADD COLUMN IF NOT EXISTS ajuste_comercial_combo_pct NUMERIC(8,2) NOT NULL DEFAULT 0.00,
            ADD COLUMN IF NOT EXISTS cargo_pack_combo NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            ADD COLUMN IF NOT EXISTS precio_manual_override NUMERIC(14,2);

        ALTER TABLE public.nodos_pedidos_items
            ADD COLUMN IF NOT EXISTS es_combo BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS componentes_combo_snapshot JSONB;

        ALTER TABLE public.nodos_pedidos_vecinos
            ADD COLUMN IF NOT EXISTS stock_descontado_deposito BOOLEAN NOT NULL DEFAULT false;
    `);

    // 3. Tabla relacional formal de componentes hijos de cada Combo (profundidad 1, sin ciclos)
    await q.query(`
        CREATE TABLE IF NOT EXISTS public.bunker_combos_componentes (
            id SERIAL PRIMARY KEY,
            combo_articulo_id VARCHAR(60) NOT NULL REFERENCES public.bunker_articulos(articulo_id) ON DELETE CASCADE,
            componente_articulo_id VARCHAR(60) NOT NULL REFERENCES public.bunker_articulos(articulo_id) ON DELETE RESTRICT,
            cantidad INTEGER NOT NULL CHECK (cantidad >= 1),
            orden SMALLINT NOT NULL DEFAULT 1,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            CONSTRAINT chk_combo_no_autoreferencia CHECK (UPPER(BTRIM(combo_articulo_id)) <> UPPER(BTRIM(componente_articulo_id))),
            CONSTRAINT unq_bunker_combo_componente UNIQUE (combo_articulo_id, componente_articulo_id)
        );

        CREATE INDEX IF NOT EXISTS idx_bunker_combos_componente_sku
            ON public.bunker_combos_componentes (UPPER(BTRIM(componente_articulo_id)));

        CREATE INDEX IF NOT EXISTS idx_bunker_articulos_es_combo
            ON public.bunker_articulos (es_combo) WHERE es_combo = true;
    `);

    // 4. Tablas de Solicitudes de Cotización de Combos desde Tiendas hacia LAMDA
    await q.query(`
        CREATE TABLE IF NOT EXISTS public.nodos_propuestas_combos (
            id SERIAL PRIMARY KEY,
            codigo_propuesta VARCHAR(40) NOT NULL UNIQUE,
            nodo_solicitante_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
            firma_composicion VARCHAR(500) NOT NULL,
            alias_vidriera_sugerido VARCHAR(180),
            categoria_vidriera_sugerida VARCHAR(120),
            precio_objetivo_vecino NUMERIC(14,2),
            comentario_gestor TEXT,
            respuesta_lamda TEXT,
            estado VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE_COTIZACION',
            articulo_catalogo_id INTEGER REFERENCES public.nodos_articulos_catalogo(id) ON DELETE SET NULL,
            combo_sku_creado VARCHAR(60),
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS unq_nodos_prop_combo_pendiente
            ON public.nodos_propuestas_combos (nodo_solicitante_id, firma_composicion)
            WHERE estado = 'PENDIENTE_COTIZACION';

        CREATE TABLE IF NOT EXISTS public.nodos_propuestas_combos_items (
            id SERIAL PRIMARY KEY,
            propuesta_combo_id INTEGER NOT NULL REFERENCES public.nodos_propuestas_combos(id) ON DELETE CASCADE,
            componente_articulo_id VARCHAR(60) NOT NULL REFERENCES public.bunker_articulos(articulo_id) ON DELETE RESTRICT,
            articulo_catalogo_hijo_id INTEGER REFERENCES public.nodos_articulos_catalogo(id) ON DELETE SET NULL,
            cantidad INTEGER NOT NULL CHECK (cantidad >= 1),
            orden SMALLINT NOT NULL DEFAULT 1,
            CONSTRAINT unq_nodos_prop_combo_item UNIQUE (propuesta_combo_id, componente_articulo_id)
        );
    `);

    // 5. Siembra idempotente de FAM-COMBOS en el Diccionario Oficial Búnker (Regla 7 - 0 estructura_desfasada)
    await asegurarTaxonomiaOficialCombosBunker(q);
}

async function asegurarTaxonomiaOficialCombosBunker(runner) {
    const q = runner || db;

    const famRes = await q.query(`
        INSERT INTO public.bunker_familias (codigo_familia, nombre, descripcion, abreviatura, activo, created_at, updated_at)
        VALUES (
            'FAM-COMBOS',
            'Combos y Packs',
            'Combos y packs comerciales compuestos por múltiples SKUs oficiales LAMDA',
            'CMB',
            true,
            NOW(),
            NOW()
        )
        ON CONFLICT (codigo_familia)
        DO UPDATE SET
            nombre = EXCLUDED.nombre,
            abreviatura = COALESCE(NULLIF(public.bunker_familias.abreviatura, ''), 'CMB'),
            activo = true,
            updated_at = NOW()
        RETURNING id, codigo_familia, nombre, abreviatura
    `);
    const fam = famRes.rows[0];

    await q.query(`
        INSERT INTO public.bunker_rubros (nombre)
        VALUES ('COMBOS Y PACKS')
        ON CONFLICT (nombre) DO NOTHING
    `);

    const catDefRes = await q.query(`
        INSERT INTO public.bunker_familia_categorias (familia_id, categoria, orden_posicional, creado_en)
        VALUES ($1, 'definicion', 1, NOW())
        ON CONFLICT (familia_id, categoria)
        DO UPDATE SET orden_posicional = public.bunker_familia_categorias.orden_posicional
        RETURNING id
    `, [fam.id]);
    const catDefId = catDefRes.rows[0]?.id || null;

    await q.query(`
        INSERT INTO public.bunker_familia_categorias (familia_id, categoria, orden_posicional, creado_en)
        VALUES ($1, 'presentacion', 2, NOW())
        ON CONFLICT (familia_id, categoria)
        DO UPDATE SET orden_posicional = public.bunker_familia_categorias.orden_posicional
    `, [fam.id]);

    let prinRes = await q.query(`
        SELECT id, termino, abreviatura
        FROM public.bunker_diccionario
        WHERE LOWER(BTRIM(termino)) = 'combo'
          AND LOWER(COALESCE(categoria, '')) = 'articulo_principal'
          AND obsoleto = false
        ORDER BY id ASC
        LIMIT 1
    `);
    if (prinRes.rowCount === 0) {
        prinRes = await q.query(`
            INSERT INTO public.bunker_diccionario (termino, abreviatura, categoria, creado_en, en_revision, obsoleto)
            VALUES ('Combo', 'CMB', 'articulo_principal', NOW(), false, false)
            RETURNING id, termino, abreviatura
        `);
    }
    const principalTerm = prinRes.rows[0];

    let defTermRes = await q.query(`
        SELECT id, termino, abreviatura
        FROM public.bunker_diccionario
        WHERE LOWER(BTRIM(termino)) IN ('seleccion', 'selección')
          AND LOWER(COALESCE(categoria, '')) = 'definicion'
          AND obsoleto = false
        ORDER BY id ASC
        LIMIT 1
    `);
    if (defTermRes.rowCount === 0) {
        defTermRes = await q.query(`
            INSERT INTO public.bunker_diccionario (termino, abreviatura, categoria, creado_en, en_revision, obsoleto)
            VALUES ('Selección', 'SEL', 'definicion', NOW(), false, false)
            RETURNING id, termino, abreviatura
        `);
    }
    const defTerm = defTermRes.rows[0];

    const relCheck = await q.query(`
        SELECT id
        FROM public.bunker_relacion_atributo_principal
        WHERE familia_id = $1
          AND articulo_principal_id = $2
          AND termino_id = $3
          AND LOWER(categoria) = 'definicion'
        LIMIT 1
    `, [fam.id, principalTerm.id, defTerm.id]);

    if (relCheck.rowCount === 0) {
        await q.query(`
            INSERT INTO public.bunker_relacion_atributo_principal (
                familia_id, articulo_principal_id, articulo_principal_texto,
                termino_id, termino_texto, categoria, categoria_id, creado_en
            ) VALUES ($1, $2, $3, $4, $5, 'definicion', $6, NOW())
        `, [
            fam.id,
            principalTerm.id,
            principalTerm.termino,
            defTerm.id,
            defTerm.termino,
            catDefId
        ]);
    }

    return {
        familia_id: Number(fam.id),
        codigo_familia: fam.codigo_familia,
        familia_nombre: fam.nombre,
        familia_abreviatura: fam.abreviatura || 'CMB',
        articulo_principal_id: Number(principalTerm.id),
        articulo_principal_termino: principalTerm.termino,
        articulo_principal_abreviatura: principalTerm.abreviatura || 'CMB',
        categoria_definicion_id: catDefId ? Number(catDefId) : null
    };
}

async function asegurarEsquemaCombosCompuestos() {
    if (_esquemaCombosListo) return;
    const { inicializarEsquemaEtapa1Nodos } = require('../migrations/asegurarEsquemaEtapa1Nodos');
    return inicializarEsquemaEtapa1Nodos({ log: false });
}

async function resolverAsegurarTerminoDefinicionCombo(runner, textoDefinicionRaw, abrevSugeridaRaw = '') {
    const q = runner || db;
    const tax = await asegurarTaxonomiaOficialCombosBunker(q);
    const limpio = String(textoDefinicionRaw || 'Selección')
        .replace(/^combo\s+/i, '')
        .replace(/\s+x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|grs?)\s*$/i, '')
        .trim() || 'Selección';

    const palabras = limpio
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

    const abrevAuto = String(abrevSugeridaRaw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 5)
        || (palabras.length >= 2
            ? palabras.slice(0, 3).map(w => w.slice(0, 2)).join('').slice(0, 5)
            : (palabras[0] ? palabras[0].slice(0, 4) : 'SEL'));

    let termRes = await q.query(`
        SELECT id, termino, abreviatura
        FROM public.bunker_diccionario
        WHERE LOWER(BTRIM(termino)) = LOWER(BTRIM($1))
          AND LOWER(COALESCE(categoria, '')) = 'definicion'
          AND obsoleto = false
        ORDER BY id ASC
        LIMIT 1
    `, [limpio]);

    if (termRes.rowCount === 0) {
        termRes = await q.query(`
            INSERT INTO public.bunker_diccionario (termino, abreviatura, categoria, creado_en, en_revision, obsoleto)
            VALUES ($1, $2, 'definicion', NOW(), false, false)
            RETURNING id, termino, abreviatura
        `, [limpio, abrevAuto]);
    }
    const term = termRes.rows[0];

    const relEx = await q.query(`
        SELECT id
        FROM public.bunker_relacion_atributo_principal
        WHERE familia_id = $1
          AND articulo_principal_id = $2
          AND termino_id = $3
          AND LOWER(categoria) = 'definicion'
        LIMIT 1
    `, [tax.familia_id, tax.articulo_principal_id, term.id]);

    if (relEx.rowCount === 0) {
        await q.query(`
            INSERT INTO public.bunker_relacion_atributo_principal (
                familia_id, articulo_principal_id, articulo_principal_texto,
                termino_id, termino_texto, categoria, categoria_id, creado_en
            ) VALUES ($1, $2, $3, $4, $5, 'definicion', $6, NOW())
        `, [
            tax.familia_id,
            tax.articulo_principal_id,
            tax.articulo_principal_termino,
            term.id,
            term.termino,
            tax.categoria_definicion_id
        ]);
    }

    return {
        taxonomia: tax,
        termino_id: Number(term.id),
        termino: term.termino,
        abreviatura: term.abreviatura || abrevAuto
    };
}

/**
 * Valida y enriquece la lista de componentes hijos de un Combo:
 * - Exige >= 2 SKUs hijos distintos (cada uno con cantidad entera >= 1).
 * - Impide auto-referencia, combos anidados (es_combo = true -> profundidad máxima 1)
 *   y artículos puente de producción (FAM-PRODUCCION / familia_id = 42).
 */
async function validarYEnriquecerComponentesCombo(runner, itemsRaw = [], opciones = {}) {
    const q = runner || db;
    await asegurarEsquemaCombosCompuestos(q);

    const costosSimulados = opciones.costosSimuladosArticulos || {};
    const comboSkuPropio = normalizarSku(opciones.comboSkuActual || '');

    if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
        const err = new Error('Seleccioná al menos 2 artículos oficiales LAMDA para conformar el Combo.');
        err.statusCode = 400;
        throw err;
    }

    const consolidados = new Map();
    let ordenIdx = 1;
    for (const raw of itemsRaw) {
        const sku = normalizarSku(raw?.componente_articulo_id || raw?.articulo_id || raw?.sku || raw?.sku_nodo);
        const cant = Math.floor(Number(raw?.cantidad || 0));
        if (!sku) continue;
        if (!Number.isFinite(cant) || cant < 1) {
            const err = new Error(`La cantidad del componente [${sku}] debe ser un número entero mayor o igual a 1.`);
            err.statusCode = 400;
            throw err;
        }
        if (comboSkuPropio && sku === comboSkuPropio) {
            const err = new Error(`El artículo [${sku}] no puede incluirse como componente de sí mismo.`);
            err.statusCode = 400;
            throw err;
        }
        if (consolidados.has(sku)) {
            const ex = consolidados.get(sku);
            ex.cantidad += cant;
        } else {
            consolidados.set(sku, {
                sku,
                cantidad: cant,
                orden: Number(raw?.orden || ordenIdx++)
            });
        }
    }

    if (consolidados.size < 2) {
        const err = new Error('Todo Combo / Pack compuesto debe integrar al menos 2 artículos distintos del catálogo oficial LAMDA.');
        err.statusCode = 400;
        throw err;
    }

    const skusUpper = Array.from(consolidados.keys());
    const resHijos = await q.query(`
        SELECT
            ba.articulo_id,
            ba.codigo_barras,
            ba.descripcion_generada,
            ba.descripcion,
            ba.familia_id,
            bf.codigo_familia,
            bf.nombre AS familia_nombre,
            ba.rubro,
            COALESCE(ba.es_combo, false) AS es_combo,
            COALESCE(ba.es_pack, false) AS es_pack,
            COALESCE(ba.pack_unidades, 1)::int AS pack_unidades,
            ba.pack_hijo_codigo,
            GREATEST(0.001, COALESCE(ba.kilos_unidad, src.kilos_unidad, 0.25))::numeric(12,4) AS kilos_unidad,
            COALESCE(ba.costo_base, 0)::numeric(14,4) AS costo_base_bunker,
            COALESCE(ba.porcentaje_iva, 21)::numeric(6,2) AS porcentaje_iva,
            nac.id AS articulo_catalogo_id,
            nac.flujo_lamda AS flujo_hijo,
            COALESCE(nac.costo_puro_total, 0)::numeric(14,4) AS costo_puro_total_nodo,
            COALESCE(nac.precio_base_nodo_final, 0)::numeric(14,2) AS precio_base_nodo_final,
            COALESCE(bla8.precio_final, 0)::numeric(14,2) AS precio_lista_nodos_final,
            COALESCE(src.stock_consolidado, 0)::numeric(14,3) AS stock_consolidado,
            COALESCE(src.es_pack, ba.es_pack, false) AS stock_es_pack,
            COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) AS stock_pack_hijo_codigo,
            COALESCE(src.pack_unidades, ba.pack_unidades, 1)::int AS stock_pack_unidades,
            COALESCE(src_nieto.stock_consolidado, 0)::numeric(14,3) AS stock_nieto_consolidado
        FROM public.bunker_articulos ba
        LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
        LEFT JOIN public.nodos_articulos_catalogo nac
               ON UPPER(BTRIM(nac.sku_nodo)) = UPPER(BTRIM(ba.articulo_id))
              AND nac.activo = true
        LEFT JOIN public.bunker_listas_precios lp_nodos
               ON COALESCE(lp_nodos.canal_comercial, 'MAYORISTA') = 'NODOS'
        LEFT JOIN public.bunker_lista_articulos bla8
               ON bla8.lista_id = lp_nodos.id
              AND UPPER(BTRIM(bla8.articulo_numero)) = UPPER(BTRIM(ba.articulo_id))
        LEFT JOIN public.stock_real_consolidado src
               ON UPPER(BTRIM(src.articulo_numero)) = UPPER(BTRIM(ba.articulo_id))
        LEFT JOIN public.articulos art_nieto
               ON (COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) IS NOT NULL
                   AND (art_nieto.numero = COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo)
                        OR art_nieto.codigo_barras = COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo)))
        LEFT JOIN public.stock_real_consolidado src_nieto
               ON src_nieto.articulo_numero = COALESCE(art_nieto.numero, src.pack_hijo_codigo, ba.pack_hijo_codigo)
        WHERE UPPER(BTRIM(ba.articulo_id)) = ANY($1::text[])
    `, [skusUpper]);

    const mapaBd = new Map();
    for (const row of resHijos.rows) {
        mapaBd.set(normalizarSku(row.articulo_id), row);
    }

    const componentes = [];
    for (const [skuKey, reqItem] of consolidados.entries()) {
        const row = mapaBd.get(skuKey);
        if (!row) {
            const err = new Error(`El artículo componente [${skuKey}] no existe en el padrón oficial Búnker LAMDA.`);
            err.statusCode = 400;
            throw err;
        }
        if (row.es_combo || String(row.codigo_familia || '').toUpperCase() === 'FAM-COMBOS') {
            const err = new Error(`No se permiten combos anidados: [${row.articulo_id}] ya es un Combo. Elegí directamente sus artículos individuales.`);
            err.statusCode = 400;
            throw err;
        }
        if (Number(row.familia_id) === 42 || String(row.codigo_familia || '').toUpperCase() === 'FAM-PRODUCCION') {
            const err = new Error(`El artículo [${row.articulo_id}] pertenece a Producción intermedia (puente/pre-mezcla) y no puede venderse dentro de un Combo comercial.`);
            err.statusCode = 400;
            throw err;
        }

        const skuReal = String(row.articulo_id).trim();
        const nomOficial = String(row.descripcion_generada || row.descripcion || skuReal).trim();
        const kilosHijo = Math.max(0.001, Number(row.kilos_unidad || 0.25));

        const costoSimulado = costosSimulados[skuKey] !== undefined ? Number(costosSimulados[skuKey]) : null;
        const costoUnitarioElaborado = (costoSimulado !== null && Number.isFinite(costoSimulado) && costoSimulado >= 0)
            ? costoSimulado
            : (Number(row.costo_puro_total_nodo) > 0
                ? Number(row.costo_puro_total_nodo)
                : Number(row.costo_base_bunker || 0));

        const ivaHijo = normalizarAlicuota(row.porcentaje_iva, 21);
        let precioBaseNodoHijo = Number(row.precio_base_nodo_final || 0);
        if (precioBaseNodoHijo <= 0 && Number(row.precio_lista_nodos_final) > 0) {
            precioBaseNodoHijo = Math.round(Number(row.precio_lista_nodos_final));
        }
        if (precioBaseNodoHijo <= 0 && costoUnitarioElaborado > 0) {
            precioBaseNodoHijo = Math.round(costoUnitarioElaborado * 1.25 * (1 + ivaHijo / 100));
        }

        let stockEfectivoHijo = Math.max(0, Number(row.stock_consolidado || 0));
        if (row.stock_es_pack && row.stock_pack_hijo_codigo && Number(row.stock_pack_unidades) > 0) {
            stockEfectivoHijo = Math.floor(Math.max(0, Number(row.stock_nieto_consolidado || 0)) / Number(row.stock_pack_unidades));
        } else {
            stockEfectivoHijo = Math.floor(stockEfectivoHijo);
        }

        const combosArmablesPorHijo = Math.floor(stockEfectivoHijo / reqItem.cantidad);

        componentes.push({
            componente_articulo_id: skuReal,
            sku_upper: skuKey,
            articulo_catalogo_hijo_id: row.articulo_catalogo_id ? Number(row.articulo_catalogo_id) : null,
            nombre_oficial_lamda: nomOficial,
            etiqueta_oficial_lamda: `[${skuReal}] ${nomOficial}`,
            codigo_barras: row.codigo_barras || null,
            familia_id: row.familia_id ? Number(row.familia_id) : null,
            familia_nombre: row.familia_nombre || 'Almacén',
            flujo_hijo: row.flujo_hijo ? Number(row.flujo_hijo) : null,
            cantidad: reqItem.cantidad,
            orden: reqItem.orden,
            kilos_unidad_hijo: Number(kilosHijo.toFixed(4)),
            kilos_subtotal: Number((kilosHijo * reqItem.cantidad).toFixed(4)),
            iva_alicuota: ivaHijo,
            costo_unitario_elaborado: Number(costoUnitarioElaborado.toFixed(2)),
            costo_subtotal_elaborado: Number((costoUnitarioElaborado * reqItem.cantidad).toFixed(2)),
            precio_base_nodo_hijo: Number(precioBaseNodoHijo.toFixed(2)),
            precio_base_subtotal_hijo: Number((precioBaseNodoHijo * reqItem.cantidad).toFixed(2)),
            stock_efectivo_hijo: stockEfectivoHijo,
            combos_armables_hijo: combosArmablesPorHijo
        });
    }

    componentes.sort((a, b) => (a.orden - b.orden) || a.sku_upper.localeCompare(b.sku_upper, 'en'));
    componentes.forEach((c, idx) => { c.orden = idx + 1; });

    const firmaComposicion = construirFirmaComposicionCombo(componentes);
    const kilosTotales = Number(componentes.reduce((acc, c) => acc + c.kilos_subtotal, 0).toFixed(4));
    const unidadesFisicasTotales = componentes.reduce((acc, c) => acc + c.cantidad, 0);
    const stockArmable = componentes.length > 0
        ? Math.min(...componentes.map(c => c.combos_armables_hijo))
        : 0;

    const ivasUnicos = Array.from(new Set(componentes.map(c => c.iva_alicuota)));
    const ivaSugeridoCombo = ivasUnicos.length === 1 ? ivasUnicos[0] : 21;

    return {
        firma_composicion: firmaComposicion,
        componentes,
        kilos_unidad_total: Math.max(0.001, kilosTotales),
        unidades_hijas_totales: unidadesFisicasTotales,
        stock_armable: Math.max(0, stockArmable),
        iva_sugerido_pct: ivaSugeridoCombo
    };
}

/**
 * Motor Determinista Dual de Costos y Precio Base de Combo (LDN 8):
 * - Modo 1: COSTO_MAS_MARGEN (por defecto)
 * - Modo 2: SUMA_BASES_HIJOS_AJUSTADA
 * Devuelve también utilidad y margen neto real de LAMDA post-IIBB (4%).
 */
function calcularEstructuraCostosCombo(params = {}) {
    const comps = Array.isArray(params.componentes) ? params.componentes : [];
    const modoPrecio = String(params.modo_precio_combo || 'COSTO_MAS_MARGEN').toUpperCase() === 'SUMA_BASES_HIJOS_AJUSTADA'
        ? 'SUMA_BASES_HIJOS_AJUSTADA'
        : 'COSTO_MAS_MARGEN';

    const costoComponentes = Number(
        comps.reduce((acc, c) => acc + Number(c.costo_subtotal_elaborado ?? (Number(c.costo_unitario_elaborado || 0) * Number(c.cantidad || 1))), 0).toFixed(2)
    );
    const sumaBasesHijos = Number(
        comps.reduce((acc, c) => acc + Number(c.precio_base_subtotal_hijo ?? (Number(c.precio_base_nodo_hijo || 0) * Number(c.cantidad || 1))), 0).toFixed(2)
    );

    const costoEnvaseCombo = Math.max(0, Number(Number(params.costo_envase_aplicado || 0).toFixed(2)));
    const segundosArmado = Math.max(0, Number(params.segundos_armado ?? params.segundos_fraccionamiento ?? params.segundos_fraccionado ?? 0));
    const valorHoraArmado = Math.max(0, Number(params.valor_hora_aplicado || 0));
    const costoManoObraArmado = Number(((segundosArmado / 3600) * valorHoraArmado).toFixed(2));

    const costoPuroTotal = Number((costoComponentes + costoEnvaseCombo + costoManoObraArmado).toFixed(2));

    const margenLamdaPct = Number(Number(params.margen_lamda_pct ?? 25).toFixed(2));
    const ajusteComercialPct = Number(Number(params.ajuste_comercial_combo_pct ?? 0).toFixed(2));
    const cargoPackCombo = Math.max(0, Number(Number(params.cargo_pack_combo ?? 0).toFixed(2)));
    const ivaPct = normalizarAlicuota(params.iva_pct ?? 21, 21);
    const iibbLamdaPct = normalizarAlicuota(params.alicuota_iibb_lamda_pct ?? 4, 4);
    const margenSugeridoGestorPct = Math.max(0, Number(Number(params.margen_sugerido_gestor_pct ?? 25).toFixed(2)));

    let precioBaseSugerido = 0;
    if (modoPrecio === 'SUMA_BASES_HIJOS_AJUSTADA') {
        const baseAntesAjuste = sumaBasesHijos + cargoPackCombo;
        precioBaseSugerido = Number((baseAntesAjuste * (1 + ajusteComercialPct / 100)).toFixed(2));
    } else {
        const netoSinIva = costoPuroTotal * (1 + margenLamdaPct / 100);
        precioBaseSugerido = Number((netoSinIva * (1 + ivaPct / 100)).toFixed(2));
    }

    const overrideManual = params.precio_manual_override !== null && params.precio_manual_override !== undefined && params.precio_manual_override !== ''
        ? Number(params.precio_manual_override)
        : null;
    const tieneOverrideManual = overrideManual !== null && Number.isFinite(overrideManual) && overrideManual > 0;

    const precioBaseFinal = tieneOverrideManual
        ? Math.round(overrideManual)
        : Math.max(1, Math.round(precioBaseSugerido));

    const precioNetoSinIvaFinal = Number((precioBaseFinal / (1 + ivaPct / 100)).toFixed(2));
    const iibbRetenidoLamda = Number((precioNetoSinIvaFinal * (iibbLamdaPct / 100)).toFixed(2));
    const ingresoLimpioPostIibb = Number((precioNetoSinIvaFinal - iibbRetenidoLamda).toFixed(2));
    const utilidadNetaRealLamda = Number((ingresoLimpioPostIibb - costoPuroTotal).toFixed(2));

    const margenMarkupEfectivoPct = costoPuroTotal > 0
        ? Number((((precioNetoSinIvaFinal - costoPuroTotal) / costoPuroTotal) * 100).toFixed(2))
        : 0;
    const margenNetoRealPostIibbPct = costoPuroTotal > 0
        ? Number(((utilidadNetaRealLamda / costoPuroTotal) * 100).toFixed(2))
        : 0;

    const diferenciaVsSumaHijosPesos = Number((precioBaseFinal - sumaBasesHijos).toFixed(2));
    const diferenciaVsSumaHijosPct = sumaBasesHijos > 0
        ? Number((((precioBaseFinal - sumaBasesHijos) / sumaBasesHijos) * 100).toFixed(2))
        : 0;

    const precioSugeridoVecino = Math.round(precioBaseFinal * (1 + margenSugeridoGestorPct / 100));

    return {
        modo_precio_combo: modoPrecio,
        costo_componentes: costoComponentes,
        costo_envase_aplicado: costoEnvaseCombo,
        segundos_fraccionamiento: segundosArmado,
        valor_hora_aplicado: valorHoraArmado,
        costo_mano_obra_aplicado: costoManoObraArmado,
        costo_puro_total: costoPuroTotal,
        costo_total_lamda: costoPuroTotal,
        suma_bases_hijos: sumaBasesHijos,
        cargo_pack_combo: cargoPackCombo,
        ajuste_comercial_combo_pct: ajusteComercialPct,
        margen_lamda_pct: modoPrecio === 'COSTO_MAS_MARGEN' && !tieneOverrideManual ? margenLamdaPct : margenMarkupEfectivoPct,
        iva_pct: ivaPct,
        iibb_pct: iibbLamdaPct,
        precio_base_nodo_neto: precioNetoSinIvaFinal,
        precio_neto_sin_iva: precioNetoSinIvaFinal,
        precio_base_nodo_sugerido: Math.round(precioBaseSugerido),
        precio_manual_override: tieneOverrideManual ? Math.round(overrideManual) : null,
        precio_base_nodo_final: precioBaseFinal,
        margen_sugerido_gestor_pct: margenSugeridoGestorPct,
        precio_sugerido_vecino: precioSugeridoVecino,
        iibb_retenido_lamda: iibbRetenidoLamda,
        ingreso_limpio_lamda: ingresoLimpioPostIibb,
        utilidad_neta_real_lamda: utilidadNetaRealLamda,
        margen_markup_efectivo_pct: margenMarkupEfectivoPct,
        margen_neto_real_post_iibb_pct: margenNetoRealPostIibbPct,
        diferencia_vs_suma_hijos_pesos: diferenciaVsSumaHijosPesos,
        diferencia_vs_suma_hijos_pct: diferenciaVsSumaHijosPct
    };
}

function construirDefinicionSugeridaDesdeHijos(componentes = [], definicionManual = '') {
    const manual = String(definicionManual || '')
        .replace(/^combo\s+/i, '')
        .replace(/\s+x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|grs?)\s*$/i, '')
        .trim();
    if (manual) return manual;

    const cortos = componentes.slice(0, 3).map(c => {
        const limpio = String(c.nombre_oficial_lamda || c.componente_articulo_id)
            .replace(/\s+x\s*\d+.*$/i, '')
            .replace(/\s+\d+\s*x\s*\d+.*$/i, '')
            .trim();
        return limpio.split(/\s+/).slice(0, 2).join(' ');
    }).filter(Boolean);

    if (cortos.length === 0) return 'Selección';
    const base = cortos.join(' + ');
    return componentes.length > 3 ? `${base} +${componentes.length - 3}` : base;
}

function construirPropiedadesDinamicasCombo(tax, termInfo, unidadesTotales, sufijoPesoNombre) {
    return {
        familia_id: tax.familia_id,
        incluir_familia: false,
        abreviatura_familia: tax.familia_abreviatura || 'CMB',
        articulo_principal: {
            id: tax.articulo_principal_id,
            valor: tax.articulo_principal_termino || 'Combo',
            abreviatura: tax.articulo_principal_abreviatura || 'CMB'
        },
        posiciones: {
            pos_1: {
                eje: 'definicion',
                valor: termInfo.termino,
                abreviatura: termInfo.abreviatura,
                posicion: 1,
                silencioso: false,
                modo_display: 'COMPLETO'
            },
            pos_2: {
                eje: 'presentacion',
                valor: `x ${sufijoPesoNombre}`,
                abreviatura: sufijoPesoNombre.replace(/\s+/g, ''),
                posicion: 2,
                silencioso: false,
                modo_display: 'COMPLETO'
            }
        },
        meta_combo: {
            es_combo: true,
            unidades_componentes: unidadesTotales
        }
    };
}

async function generarSkuYNomenclaturaOficialCombo(runner, {
    componentes = [],
    kilosUnidadTotal = 0.5,
    firmaComposicion = '',
    definicionCombo = '',
    abreviaturaDefinicion = '',
    skuSolicitado = ''
} = {}) {
    const q = runner || db;
    const defLimpia = construirDefinicionSugeridaDesdeHijos(componentes, definicionCombo);
    const termInfo = await resolverAsegurarTerminoDefinicionCombo(q, defLimpia, abreviaturaDefinicion);
    const tax = termInfo.taxonomia;

    const sufijoPesoNombre = formatearSufijoPeso(kilosUnidadTotal);
    const sufijoPesoSku = formatearSufijoSkuPeso(kilosUnidadTotal);
    const unidadesTotales = componentes.reduce((acc, c) => acc + Number(c.cantidad || 1), 0);

    if (firmaComposicion) {
        const exFirma = await q.query(`
            SELECT articulo_id, codigo_barras, descripcion_generada, propiedades_dinamicas
            FROM public.bunker_articulos
            WHERE es_combo = true AND firma_combo = $1
            ORDER BY articulo_id ASC
            LIMIT 1
        `, [firmaComposicion]);
        if (exFirma.rowCount > 0) {
            const rowEx = exFirma.rows[0];
            const descNueva = `Combo ${termInfo.termino} x ${sufijoPesoNombre}`;
            const propsCanonica = construirPropiedadesDinamicasCombo(tax, termInfo, unidadesTotales, sufijoPesoNombre);
            return {
                sku_oficial: rowEx.articulo_id,
                codigo_barras_existente: rowEx.codigo_barras || null,
                descripcion_generada: definicionCombo ? descNueva : (rowEx.descripcion_generada || descNueva),
                articulo_principal: tax.articulo_principal_termino || 'Combo',
                presentacion_etiqueta: `Combo ${unidadesTotales} prod. (${sufijoPesoNombre})`,
                familia_id: tax.familia_id,
                familia_nombre: tax.familia_nombre,
                rubro: 'COMBOS Y PACKS',
                propiedades_dinamicas: propsCanonica,
                ya_existia_por_firma: true
            };
        }
    }

    let skuCandidato = normalizarSku(skuSolicitado).replace(/^(NB-|EMB-)/i, '');
    if (!skuCandidato) {
        const abDef = String(termInfo.abreviatura || 'SEL').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 5) || 'SEL';
        skuCandidato = `CMB${abDef}${sufijoPesoSku}`.toUpperCase();
    }

    let skuFinal = skuCandidato;
    let sufijoNum = 2;
    while (true) {
        const colRes = await q.query(`
            SELECT articulo_id, es_combo, firma_combo
            FROM public.bunker_articulos
            WHERE UPPER(BTRIM(articulo_id)) = UPPER(BTRIM($1))
            LIMIT 1
        `, [skuFinal]);
        if (colRes.rowCount === 0) break;
        const existente = colRes.rows[0];
        if (existente.es_combo && (!firmaComposicion || existente.firma_combo === firmaComposicion)) {
            skuFinal = existente.articulo_id;
            break;
        }
        skuFinal = `${skuCandidato.replace(/x\d+(?:kg)?$/i, '')}${sufijoNum}${sufijoPesoSku}`.toUpperCase();
        sufijoNum += 1;
        if (sufijoNum > 50) break;
    }

    const descripcionGenerada = `Combo ${termInfo.termino} x ${sufijoPesoNombre}`;
    const propsCanonica = construirPropiedadesDinamicasCombo(tax, termInfo, unidadesTotales, sufijoPesoNombre);

    return {
        sku_oficial: skuFinal,
        codigo_barras_existente: null,
        descripcion_generada: descripcionGenerada,
        articulo_principal: tax.articulo_principal_termino || 'Combo',
        presentacion_etiqueta: `Combo ${unidadesTotales} prod. (${sufijoPesoNombre})`,
        familia_id: tax.familia_id,
        familia_nombre: tax.familia_nombre,
        rubro: 'COMBOS Y PACKS',
        propiedades_dinamicas: propsCanonica,
        ya_existia_por_firma: false
    };
}

async function generarCodigoBarrasUnicoCombo(client) {
    const seqRes = await client.query(`
        SELECT COALESCE(MAX(
            CASE WHEN codigo_barras ~ '^779899[0-9]{7}$'
                 THEN SUBSTRING(codigo_barras FROM 7 FOR 6)::int
                 ELSE 0 END
        ), 500000) + 1 AS prox
        FROM public.bunker_articulos
    `);
    const num = Number(seqRes.rows[0]?.prox || 500001);
    const base12 = `779899${String(num).padStart(6, '0')}`;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
    }
    const check = (10 - (sum % 10)) % 10;
    return `${base12}${check}`;
}

/**
 * Vista previa en seco para Pizarra ([LDN 8] Combos y Sub-pestaña 4 de Cotizador Nodos)
 */
async function previsualizarCotizacionCombo(payload = {}) {
    await asegurarEsquemaCombosCompuestos();
    const validado = await validarYEnriquecerComponentesCombo(db, payload.componentes || payload.items || [], {
        comboSkuActual: payload.sku_existente || null
    });

    let costoEnvase = 0;
    let insumoEnvaseInfo = null;
    if (payload.insumo_envase_id) {
        const envRes = await db.query(`
            SELECT id, codigo, nombre, COALESCE(costo_patron, 0)::numeric(14,2) AS costo_patron
            FROM public.ingredientes
            WHERE id = $1
            LIMIT 1
        `, [Number(payload.insumo_envase_id)]);
        if (envRes.rowCount > 0) {
            insumoEnvaseInfo = envRes.rows[0];
            costoEnvase = Number(insumoEnvaseInfo.costo_patron || 0);
        }
    }

    let valorHora = Number(payload.valor_hora_aplicado || 0);
    if (!valorHora && payload.tarifa_colaborador_id) {
        const tarRes = await db.query(
            'SELECT valor_hora FROM public.colaboradores_tarifas WHERE id = $1 LIMIT 1',
            [Number(payload.tarifa_colaborador_id)]
        );
        valorHora = Number(tarRes.rows[0]?.valor_hora || 0);
    }
    if (!valorHora) {
        const tarDef = await db.query('SELECT valor_hora FROM public.colaboradores_tarifas ORDER BY id ASC LIMIT 1');
        valorHora = Number(tarDef.rows[0]?.valor_hora || 4500);
    }

    const estructura = calcularEstructuraCostosCombo({
        componentes: validado.componentes,
        modo_precio_combo: payload.modo_precio_combo || 'COSTO_MAS_MARGEN',
        costo_envase_aplicado: costoEnvase,
        segundos_armado: payload.segundos_fraccionamiento ?? payload.segundos_armado ?? payload.segundos_fraccionado ?? 0,
        valor_hora_aplicado: valorHora,
        margen_lamda_pct: payload.margen_lamda_pct ?? 25,
        ajuste_comercial_combo_pct: payload.ajuste_comercial_combo_pct ?? 0,
        cargo_pack_combo: payload.cargo_pack_combo ?? 0,
        iva_pct: payload.iva_pct ?? validado.iva_sugerido_pct,
        alicuota_iibb_lamda_pct: payload.alicuota_iibb_lamda_pct ?? 4,
        precio_manual_override: payload.precio_manual_override
    });

    const anatomia = await generarSkuYNomenclaturaOficialCombo(db, {
        componentes: validado.componentes,
        kilosUnidadTotal: validado.kilos_unidad_total,
        firmaComposicion: validado.firma_composicion,
        definicionCombo: payload.definicion_combo || payload.nombre_oficial_definicion || '',
        abreviaturaDefinicion: payload.abreviatura_definicion || '',
        skuSolicitado: payload.sku_solicitud || payload.sku_nodo || ''
    });

    return {
        firma_composicion: validado.firma_composicion,
        kilos_unidad_total: validado.kilos_unidad_total,
        unidades_hijas_totales: validado.unidades_hijas_totales,
        stock_armable: validado.stock_armable,
        componentes: validado.componentes,
        insumo_envase: insumoEnvaseInfo,
        anatomia,
        estructura_costos: estructura
    };
}

/**
 * Creación de Solicitud de Cotización de Combo desde el panel de Gestión de la Tienda
 */
async function crearPropuestaComboGestor(payload = {}) {
    await asegurarEsquemaCombosCompuestos();

    const nodoId = Number(payload.nodo_solicitante_id || 0);
    if (!nodoId) {
        const err = new Error('Identificador de tienda solicitante inválido.');
        err.statusCode = 400;
        throw err;
    }

    const nodoRes = await db.query('SELECT id, nombre_marca, slug FROM public.nodos_maestro WHERE id = $1 LIMIT 1', [nodoId]);
    if (nodoRes.rowCount === 0) {
        const err = new Error('La tienda solicitante no existe.');
        err.statusCode = 404;
        throw err;
    }

    const validado = await validarYEnriquecerComponentesCombo(db, payload.items || payload.componentes || []);

    const exCatRes = await db.query(`
        SELECT nac.id AS catalogo_id,
               nac.sku_nodo,
               COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_oficial_lamda,
               nac.presentacion_etiqueta,
               nac.kilos_unidad,
               nac.precio_base_nodo_final,
               EXISTS (
                   SELECT 1 FROM public.nodos_ofertas_gestor nog
                   WHERE nog.nodo_id = $1 AND nog.articulo_catalogo_id = nac.id
               ) AS ya_en_mi_oferta
        FROM public.nodos_articulos_catalogo nac
        LEFT JOIN public.bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(nac.sku_nodo))
        WHERE nac.activo = true
          AND nac.es_combo = true
          AND nac.firma_combo = $2
        LIMIT 1
    `, [nodoId, validado.firma_composicion]);

    if (exCatRes.rowCount > 0) {
        const comboEx = exCatRes.rows[0];
        const err = new Error(
            comboEx.ya_en_mi_oferta
                ? `Este combo ([${comboEx.sku_nodo}] ${comboEx.nombre_oficial_lamda}) ya está cargado en tu sección Mi Oferta y Márgenes.`
                : `Esta combinación exacta ([${comboEx.sku_nodo}] ${comboEx.nombre_oficial_lamda}) ya está cotizada por LAMDA ($${Number(comboEx.precio_base_nodo_final).toLocaleString('es-AR')}). Podés sumarla directo en un toque.`
        );
        err.statusCode = 409;
        err.combo_existente = comboEx;
        throw err;
    }

    const exPendRes = await db.query(`
        SELECT id, codigo_propuesta, alias_vidriera_sugerido, created_at
        FROM public.nodos_propuestas_combos
        WHERE nodo_solicitante_id = $1
          AND firma_composicion = $2
          AND estado = 'PENDIENTE_COTIZACION'
        LIMIT 1
    `, [nodoId, validado.firma_composicion]);

    if (exPendRes.rowCount > 0) {
        const pend = exPendRes.rows[0];
        const err = new Error(`Ya enviaste esta misma combinación y se encuentra en cotización (${pend.codigo_propuesta}).`);
        err.statusCode = 409;
        err.propuesta_existente = pend;
        throw err;
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const seqRes = await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS prox FROM public.nodos_propuestas_combos`);
        const proxNum = Number(seqRes.rows[0]?.prox || 1);
        const codigoPropuesta = `PROP-CMB-${String(proxNum).padStart(3, '0')}`;

        const aliasVidriera = String(payload.alias_vidriera_sugerido || '').trim().slice(0, 180) || null;
        const catVidriera = String(payload.categoria_vidriera_sugerida || '').trim().slice(0, 120) || null;
        const precioObj = Number(payload.precio_objetivo_vecino || 0) > 0
            ? Number(Number(payload.precio_objetivo_vecino).toFixed(2))
            : null;
        const comentario = String(payload.comentario_gestor || '').trim() || null;

        const insCab = await client.query(`
            INSERT INTO public.nodos_propuestas_combos (
                codigo_propuesta, nodo_solicitante_id, firma_composicion,
                alias_vidriera_sugerido, categoria_vidriera_sugerida,
                precio_objetivo_vecino, comentario_gestor, estado, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDIENTE_COTIZACION', NOW(), NOW())
            RETURNING *
        `, [
            codigoPropuesta,
            nodoId,
            validado.firma_composicion,
            aliasVidriera,
            catVidriera,
            precioObj,
            comentario
        ]);
        const propRow = insCab.rows[0];

        for (const comp of validado.componentes) {
            await client.query(`
                INSERT INTO public.nodos_propuestas_combos_items (
                    propuesta_combo_id, componente_articulo_id, articulo_catalogo_hijo_id, cantidad, orden
                ) VALUES ($1, $2, $3, $4, $5)
            `, [
                propRow.id,
                comp.componente_articulo_id,
                comp.articulo_catalogo_hijo_id,
                comp.cantidad,
                comp.orden
            ]);
        }

        await client.query('COMMIT');
        return {
            ...propRow,
            kilos_totales: validado.kilos_unidad_total,
            unidades_totales: validado.unidades_hijas_totales,
            items: validado.componentes
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function anularODescartarPropuestaCombo(propuestaId, { accion = 'anular', motivo = '', nodoIdRestringido = null } = {}) {
    await asegurarEsquemaCombosCompuestos();
    const id = Number(propuestaId || 0);
    if (!id) {
        const err = new Error('ID de solicitud de combo inválido.');
        err.statusCode = 400;
        throw err;
    }

    const resEx = await db.query('SELECT * FROM public.nodos_propuestas_combos WHERE id = $1 LIMIT 1', [id]);
    if (resEx.rowCount === 0) {
        const err = new Error('Solicitud de combo no encontrada.');
        err.statusCode = 404;
        throw err;
    }
    const row = resEx.rows[0];

    if (nodoIdRestringido && Number(row.nodo_solicitante_id) !== Number(nodoIdRestringido)) {
        const err = new Error('No tenés permisos sobre esta solicitud.');
        err.statusCode = 403;
        throw err;
    }
    if (row.estado === 'APROBADA') {
        const err = new Error('Esta solicitud de combo ya fue aprobada y cotizada.');
        err.statusCode = 400;
        throw err;
    }

    const nuevoEstado = String(accion || 'anular').toLowerCase() === 'descartar' ? 'DESCARTADA' : 'ANULADA';
    const respTexto = String(motivo || '').trim() || (nuevoEstado === 'DESCARTADA' ? 'Descartada por Administración LAMDA.' : 'Anulada por la tienda.');

    const upd = await db.query(`
        UPDATE public.nodos_propuestas_combos
        SET estado = $1,
            respuesta_lamda = $2,
            updated_at = NOW()
        WHERE id = $3
        RETURNING *
    `, [nuevoEstado, respTexto, id]);

    return upd.rows[0];
}

/**
 * Creación / Aprobación Formal y Determinista de un Artículo Combo en el Catálogo Maestro LAMDA
 */
async function cotizarYAprobarCombo(payload = {}) {
    await asegurarEsquemaCombosCompuestos();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        let propuestaOrigen = null;
        let itemsEntrada = Array.isArray(payload.componentes) && payload.componentes.length > 0
            ? payload.componentes
            : (Array.isArray(payload.items) ? payload.items : []);

        if (payload.propuesta_combo_id) {
            const propRes = await client.query(`
                SELECT * FROM public.nodos_propuestas_combos
                WHERE id = $1
                FOR UPDATE
            `, [Number(payload.propuesta_combo_id)]);
            if (propRes.rowCount === 0) {
                const err = new Error('La solicitud de combo indicada no existe.');
                err.statusCode = 404;
                throw err;
            }
            propuestaOrigen = propRes.rows[0];
            if (itemsEntrada.length === 0) {
                const itemsPropRes = await client.query(`
                    SELECT componente_articulo_id, cantidad, orden
                    FROM public.nodos_propuestas_combos_items
                    WHERE propuesta_combo_id = $1
                    ORDER BY orden ASC, id ASC
                `, [propuestaOrigen.id]);
                itemsEntrada = itemsPropRes.rows;
            }
        }

        let catalogoExistente = null;
        if (payload.catalogo_id) {
            const catExRes = await client.query(
                'SELECT * FROM public.nodos_articulos_catalogo WHERE id = $1 FOR UPDATE',
                [Number(payload.catalogo_id)]
            );
            catalogoExistente = catExRes.rows[0] || null;
        }

        const validado = await validarYEnriquecerComponentesCombo(client, itemsEntrada, {
            comboSkuActual: catalogoExistente?.sku_nodo || payload.sku_existente || null
        });

        let insumoEnvaseId = payload.insumo_envase_id ? Number(payload.insumo_envase_id) : null;
        let costoEnvase = 0;
        if (insumoEnvaseId) {
            const envRes = await client.query(
                'SELECT id, COALESCE(costo_patron, 0)::numeric(14,2) AS costo_patron FROM public.ingredientes WHERE id = $1 LIMIT 1',
                [insumoEnvaseId]
            );
            if (envRes.rowCount > 0) {
                costoEnvase = Number(envRes.rows[0].costo_patron || 0);
            } else {
                insumoEnvaseId = null;
            }
        }

        let tarifaColaboradorId = payload.tarifa_colaborador_id ? Number(payload.tarifa_colaborador_id) : null;
        let valorHora = Number(payload.valor_hora_aplicado || 0);
        if (tarifaColaboradorId && !valorHora) {
            const tRes = await client.query('SELECT id, valor_hora FROM public.colaboradores_tarifas WHERE id = $1 LIMIT 1', [tarifaColaboradorId]);
            valorHora = Number(tRes.rows[0]?.valor_hora || 0);
        }
        if (!valorHora) {
            const tDef = await client.query('SELECT id, valor_hora FROM public.colaboradores_tarifas ORDER BY id ASC LIMIT 1');
            if (tDef.rowCount > 0) {
                tarifaColaboradorId = tarifaColaboradorId || Number(tDef.rows[0].id);
                valorHora = Number(tDef.rows[0].valor_hora || 4500);
            } else {
                valorHora = 4500;
            }
        }

        const estructura = calcularEstructuraCostosCombo({
            componentes: validado.componentes,
            modo_precio_combo: payload.modo_precio_combo || catalogoExistente?.modo_precio_combo || 'COSTO_MAS_MARGEN',
            costo_envase_aplicado: costoEnvase,
            segundos_armado: payload.segundos_fraccionamiento ?? payload.segundos_armado ?? payload.segundos_fraccionado ?? catalogoExistente?.segundos_fraccionamiento ?? 0,
            valor_hora_aplicado: valorHora,
            margen_lamda_pct: payload.margen_lamda_pct ?? catalogoExistente?.margen_lamda_pct ?? 25,
            ajuste_comercial_combo_pct: payload.ajuste_comercial_combo_pct ?? catalogoExistente?.ajuste_comercial_combo_pct ?? 0,
            cargo_pack_combo: payload.cargo_pack_combo ?? catalogoExistente?.cargo_pack_combo ?? 0,
            iva_pct: payload.iva_pct ?? catalogoExistente?.iva_pct ?? validado.iva_sugerido_pct,
            alicuota_iibb_lamda_pct: payload.alicuota_iibb_lamda_pct ?? 4,
            precio_manual_override: payload.precio_manual_override !== undefined ? payload.precio_manual_override : null
        });

        const anatomia = await generarSkuYNomenclaturaOficialCombo(client, {
            componentes: validado.componentes,
            kilosUnidadTotal: validado.kilos_unidad_total,
            firmaComposicion: validado.firma_composicion,
            definicionCombo: payload.definicion_combo || payload.nombre_oficial_definicion || '',
            abreviaturaDefinicion: payload.abreviatura_definicion || '',
            skuSolicitado: catalogoExistente?.sku_nodo || payload.sku_solicitud || payload.sku_nodo || ''
        });

        const skuOficial = anatomia.sku_oficial;
        const descripcionOficial = anatomia.descripcion_generada;
        const kilosTotales = validado.kilos_unidad_total;
        const costoMateriaYEnvase = Number((estructura.costo_componentes + estructura.costo_envase_aplicado).toFixed(2));
        const costoPorKgSobrescrito = Number((costoMateriaYEnvase / Math.max(0.001, kilosTotales)).toFixed(4));

        let codigoBarras = anatomia.codigo_barras_existente || null;
        if (!codigoBarras) {
            const cbEx = await client.query(
                'SELECT codigo_barras FROM public.bunker_articulos WHERE UPPER(BTRIM(articulo_id)) = UPPER(BTRIM($1)) LIMIT 1',
                [skuOficial]
            );
            codigoBarras = cbEx.rows[0]?.codigo_barras || await generarCodigoBarrasUnicoCombo(client);
        }

        // 1-3. Alta/actualización canónica vía puerta única BunkerService.crearArticuloCanonico
        await BunkerService.crearArticuloCanonico(client, {
            articulo_id: skuOficial,
            codigo_barras: codigoBarras,
            familia_id: anatomia.familia_id,
            rubro: anatomia.rubro,
            sub_rubro: 'Combos Comerciales',
            descripcion: descripcionOficial,
            descripcion_generada: descripcionOficial,
            propiedades_dinamicas: anatomia.propiedades_dinamicas,
            kilos_unidad: kilosTotales,
            expresado_en_gramos: kilosTotales < 1,
            expresado_en_unidades: false,
            es_pack: false,
            pack_unidades: 1,
            pack_hijo_codigo: null,
            es_combo: true,
            firma_combo: validado.firma_composicion,
            no_producido_por_lambda: true,
            solo_produccion_externa: false,
            costo_base: estructura.costo_puro_total,
            porcentaje_iva: estructura.iva_pct,
            minutos_mano_obra: estructura.minutos_armado_mo ?? null,
            tarifa_colaborador_id: estructura.tarifa_colaborador_id || null,
            actualizar_si_existe: true
        });

        // 4. Sincronizar componentes hijos en public.bunker_combos_componentes
        await client.query('DELETE FROM public.bunker_combos_componentes WHERE combo_articulo_id = $1', [skuOficial]);
        for (const comp of validado.componentes) {
            await client.query(`
                INSERT INTO public.bunker_combos_componentes (
                    combo_articulo_id, componente_articulo_id, cantidad, orden, created_at
                ) VALUES ($1, $2, $3, $4, NOW())
            `, [skuOficial, comp.componente_articulo_id, comp.cantidad, comp.orden]);
        }

        // 5. Vincular en Lista 8 (Canal Nodos) + Listas Mayoristas B2B (1..7) si corresponde
        const listaNodosRes = await client.query(`
            SELECT id FROM public.bunker_listas_precios
            WHERE COALESCE(canal_comercial, 'MAYORISTA') = 'NODOS'
            ORDER BY id ASC LIMIT 1
        `);
        const listaNodosId = listaNodosRes.rows[0]?.id ? Number(listaNodosRes.rows[0].id) : 8;
        const manoObraActiva = estructura.costo_mano_obra_aplicado > 0;

        await client.query(`
            INSERT INTO public.bunker_lista_articulos (
                lista_id, articulo_numero, margen_ganancia, costo_base_sobrescrito,
                costo_tiempo, iva, precio_final, modo_calculo, modo_iva,
                es_patron, disponible, mano_obra_activa, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'AUTOMATIC', 'COMPLETO', false, true, $8, NOW())
            ON CONFLICT (lista_id, articulo_numero) DO UPDATE SET
                margen_ganancia = EXCLUDED.margen_ganancia,
                costo_base_sobrescrito = EXCLUDED.costo_base_sobrescrito,
                costo_tiempo = EXCLUDED.costo_tiempo,
                iva = EXCLUDED.iva,
                precio_final = EXCLUDED.precio_final,
                disponible = true,
                mano_obra_activa = EXCLUDED.mano_obra_activa,
                updated_at = NOW()
        `, [
            listaNodosId,
            skuOficial,
            estructura.margen_markup_efectivo_pct,
            costoPorKgSobrescrito > 0 ? costoPorKgSobrescrito : null,
            estructura.costo_mano_obra_aplicado,
            estructura.iva_pct,
            estructura.precio_base_nodo_final,
            manoObraActiva
        ]);

        const listasMayoristasIds = Array.isArray(payload.listas_mayoristas_compartidas)
            ? payload.listas_mayoristas_compartidas.map(Number).filter(n => n > 0 && n !== listaNodosId)
            : [];
        const margenesMayoristasMap = (payload.margenes_listas_mayoristas && typeof payload.margenes_listas_mayoristas === 'object')
            ? payload.margenes_listas_mayoristas
            : {};

        for (const lid of listasMayoristasIds) {
            const margenLista = margenesMayoristasMap[lid] !== undefined
                ? Number(margenesMayoristasMap[lid])
                : estructura.margen_markup_efectivo_pct;
            const precioFinalLista = Number((estructura.costo_puro_total * (1 + margenLista / 100) * (1 + estructura.iva_pct / 100)).toFixed(2));
            await client.query(`
                INSERT INTO public.bunker_lista_articulos (
                    lista_id, articulo_numero, margen_ganancia, costo_base_sobrescrito,
                    costo_tiempo, iva, precio_final, modo_calculo, modo_iva,
                    es_patron, disponible, mano_obra_activa, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'AUTOMATIC', 'COMPLETO', false, true, $8, NOW())
                ON CONFLICT (lista_id, articulo_numero) DO UPDATE SET
                    margen_ganancia = EXCLUDED.margen_ganancia,
                    costo_base_sobrescrito = EXCLUDED.costo_base_sobrescrito,
                    costo_tiempo = EXCLUDED.costo_tiempo,
                    iva = EXCLUDED.iva,
                    precio_final = EXCLUDED.precio_final,
                    disponible = true,
                    mano_obra_activa = EXCLUDED.mano_obra_activa,
                    updated_at = NOW()
            `, [
                lid,
                skuOficial,
                margenLista,
                costoPorKgSobrescrito > 0 ? costoPorKgSobrescrito : null,
                estructura.costo_mano_obra_aplicado,
                estructura.iva_pct,
                precioFinalLista,
                manoObraActiva
            ]);
        }

        // 6. Upsert en public.nodos_articulos_catalogo (flujo_lamda = 8, origen_tipo = 'COMBO')
        const compartidoMayorista = listasMayoristasIds.length > 0 || Boolean(payload.compartido_mayorista);
        const catUpsertRes = await client.query(`
            INSERT INTO public.nodos_articulos_catalogo (
                sku_nodo, nombre_publico, nomenclatura_bunker,
                familia_bunker_id, familia_bunker_nombre, articulo_principal_bunker,
                compartido_mayorista, listas_mayoristas_compartidas,
                categoria_familiar, presentacion_etiqueta, flujo_lamda, origen_tipo,
                ingrediente_origen_id, articulo_bunker_origen_codigo, kilos_unidad,
                insumo_envase_id, cantidad_envases_unidad, segundos_fraccionamiento,
                tarifa_colaborador_id, valor_hora_aplicado,
                costo_insumo_kg, costo_insumo_fraccion, costo_envase_aplicado, costo_mano_obra_aplicado,
                margen_lamda_pct, iva_pct, iibb_pct, costo_puro_total,
                precio_base_nodo_neto, precio_manual_override, precio_base_nodo_final,
                margen_sugerido_gestor_pct, precio_sugerido_vecino, notas_tecnicas,
                es_combo, firma_combo, modo_precio_combo, ajuste_comercial_combo_pct, cargo_pack_combo,
                estado, activo, updated_at
            ) VALUES (
                $1, $2, $2,
                $3, $4, $5,
                $6, $7::jsonb,
                $4, $8, 8, 'COMBO',
                NULL, $1, $9,
                $10, 1, $11,
                $12, $13,
                $14, $15, $16, $17,
                $18, $19, $20, $21,
                $22, $23, $24,
                $25, $26, $27,
                true, $28, $29, $30, $31,
                'APROBADO', true, NOW()
            )
            ON CONFLICT (sku_nodo) DO UPDATE SET
                nombre_publico = EXCLUDED.nombre_publico,
                nomenclatura_bunker = EXCLUDED.nomenclatura_bunker,
                familia_bunker_id = EXCLUDED.familia_bunker_id,
                familia_bunker_nombre = EXCLUDED.familia_bunker_nombre,
                articulo_principal_bunker = EXCLUDED.articulo_principal_bunker,
                compartido_mayorista = EXCLUDED.compartido_mayorista,
                listas_mayoristas_compartidas = EXCLUDED.listas_mayoristas_compartidas,
                categoria_familiar = EXCLUDED.categoria_familiar,
                presentacion_etiqueta = EXCLUDED.presentacion_etiqueta,
                flujo_lamda = 8,
                origen_tipo = 'COMBO',
                articulo_bunker_origen_codigo = EXCLUDED.articulo_bunker_origen_codigo,
                kilos_unidad = EXCLUDED.kilos_unidad,
                insumo_envase_id = EXCLUDED.insumo_envase_id,
                segundos_fraccionamiento = EXCLUDED.segundos_fraccionamiento,
                tarifa_colaborador_id = EXCLUDED.tarifa_colaborador_id,
                valor_hora_aplicado = EXCLUDED.valor_hora_aplicado,
                costo_insumo_kg = EXCLUDED.costo_insumo_kg,
                costo_insumo_fraccion = EXCLUDED.costo_insumo_fraccion,
                costo_envase_aplicado = EXCLUDED.costo_envase_aplicado,
                costo_mano_obra_aplicado = EXCLUDED.costo_mano_obra_aplicado,
                margen_lamda_pct = EXCLUDED.margen_lamda_pct,
                iva_pct = EXCLUDED.iva_pct,
                iibb_pct = EXCLUDED.iibb_pct,
                costo_puro_total = EXCLUDED.costo_puro_total,
                precio_base_nodo_neto = EXCLUDED.precio_base_nodo_neto,
                precio_manual_override = EXCLUDED.precio_manual_override,
                precio_base_nodo_final = EXCLUDED.precio_base_nodo_final,
                margen_sugerido_gestor_pct = EXCLUDED.margen_sugerido_gestor_pct,
                precio_sugerido_vecino = EXCLUDED.precio_sugerido_vecino,
                notas_tecnicas = EXCLUDED.notas_tecnicas,
                es_combo = true,
                firma_combo = EXCLUDED.firma_combo,
                modo_precio_combo = EXCLUDED.modo_precio_combo,
                ajuste_comercial_combo_pct = EXCLUDED.ajuste_comercial_combo_pct,
                cargo_pack_combo = EXCLUDED.cargo_pack_combo,
                estado = 'APROBADO',
                activo = true,
                updated_at = NOW()
            RETURNING *
        `, [
            skuOficial,
            descripcionOficial,
            anatomia.familia_id,
            anatomia.familia_nombre,
            anatomia.articulo_principal || 'Combo',
            compartidoMayorista,
            JSON.stringify(listasMayoristasIds),
            anatomia.presentacion_etiqueta,
            kilosTotales,
            insumoEnvaseId,
            estructura.segundos_fraccionamiento,
            tarifaColaboradorId,
            estructura.valor_hora_aplicado,
            Number((estructura.costo_componentes / Math.max(0.001, kilosTotales)).toFixed(2)),
            estructura.costo_componentes,
            estructura.costo_envase_aplicado,
            estructura.costo_mano_obra_aplicado,
            estructura.margen_lamda_pct,
            estructura.iva_pct,
            estructura.iibb_pct,
            estructura.costo_puro_total,
            estructura.precio_base_nodo_neto,
            estructura.precio_manual_override,
            estructura.precio_base_nodo_final,
            estructura.margen_sugerido_gestor_pct,
            estructura.precio_sugerido_vecino,
            String(payload.notas_tecnicas || '').trim(),
            validado.firma_composicion,
            estructura.modo_precio_combo,
            estructura.ajuste_comercial_combo_pct,
            estructura.cargo_pack_combo
        ]);
        const catalogoRow = catUpsertRes.rows[0];

        // 7. Aprobar propuestas pendientes que coincidan por ID o por firma_composicion
        const textoRespuesta = payload.respuesta_lamda
            ? String(payload.respuesta_lamda).trim()
            : `Aprobado por LAMDA con Precio Base $${estructura.precio_base_nodo_final.toLocaleString('es-AR')} ([${skuOficial}] ${descripcionOficial}).`;

        const propsCoincidentesRes = await client.query(`
            UPDATE public.nodos_propuestas_combos
            SET estado = 'APROBADA',
                articulo_catalogo_id = $1,
                combo_sku_creado = $2,
                respuesta_lamda = $3,
                updated_at = NOW()
            WHERE (id = $4 OR (firma_composicion = $5 AND estado = 'PENDIENTE_COTIZACION'))
            RETURNING *
        `, [
            catalogoRow.id,
            skuOficial,
            textoRespuesta,
            propuestaOrigen ? propuestaOrigen.id : -1,
            validado.firma_composicion
        ]);

        // 8. Habilitar en tiendas solicitantes + tiendas seleccionadas explícitamente (por defecto todas las tiendas activas como en fracciones)
        const nodosDestinoMap = new Map();
        for (const pr of propsCoincidentesRes.rows) {
            nodosDestinoMap.set(Number(pr.nodo_solicitante_id), {
                alias_vidriera: pr.alias_vidriera_sugerido || null,
                categoria_vidriera: pr.categoria_vidriera_sugerida || null
            });
        }
        if (Array.isArray(payload.nodos_habilitados_ids)) {
            for (const rawNid of payload.nodos_habilitados_ids) {
                const nid = Number(rawNid);
                if (nid > 0 && !nodosDestinoMap.has(nid)) {
                    nodosDestinoMap.set(nid, { alias_vidriera: null, categoria_vidriera: null });
                }
            }
        }
        if (payload.habilitar_en_todas_tiendas !== false && !Array.isArray(payload.nodos_habilitados_ids)) {
            const allNodos = await client.query('SELECT id FROM public.nodos_maestro WHERE COALESCE(activo, true) = true');
            for (const nr of allNodos.rows) {
                const nid = Number(nr.id);
                if (!nodosDestinoMap.has(nid)) {
                    nodosDestinoMap.set(nid, { alias_vidriera: null, categoria_vidriera: null });
                }
            }
        }

        for (const [nid, metaTienda] of nodosDestinoMap.entries()) {
            const nodoFiscalRes = await client.query(`
                SELECT id,
                       COALESCE(margen_gestor_default_pct, 25.00)::numeric(6,2) AS margen_def,
                       COALESCE(alicuota_iva_margen_pct, 21.00)::numeric(5,2) AS iva_margen,
                       COALESCE(alicuota_iibb_margen_pct, 4.00)::numeric(5,2) AS iibb_margen
                FROM public.nodos_maestro
                WHERE id = $1
                LIMIT 1
            `, [nid]);
            if (nodoFiscalRes.rowCount === 0) continue;
            const nf = nodoFiscalRes.rows[0];

            const ofExRes = await client.query(`
                SELECT * FROM public.nodos_ofertas_gestor
                WHERE nodo_id = $1 AND articulo_catalogo_id = $2
                LIMIT 1 FOR UPDATE
            `, [nid, catalogoRow.id]);

            if (ofExRes.rowCount > 0) {
                const ofActual = ofExRes.rows[0];
                const calcPrecio = calcularPrecioYGananciaNetaTienda(
                    estructura.precio_base_nodo_final,
                    ofActual.margen_gestor_pct,
                    nf.iva_margen,
                    nf.iibb_margen
                );
                const cambioCosto = Math.abs(Number(ofActual.precio_base_nodo_snapshot || 0) - Number(estructura.precio_base_nodo_final)) >= 1;
                await client.query(`
                    UPDATE public.nodos_ofertas_gestor
                    SET precio_base_nodo_snapshot = $1,
                        precio_venta_vecino = $2,
                        ganancia_unitaria_gestor = $3,
                        nombre_vidriera_personalizado = COALESCE(public.nodos_ofertas_gestor.nombre_vidriera_personalizado, $4),
                        categoria_vidriera_personalizada = COALESCE(public.nodos_ofertas_gestor.categoria_vidriera_personalizada, $5),
                        alerta_cambio_costo = CASE WHEN $6 THEN true ELSE public.nodos_ofertas_gestor.alerta_cambio_costo END,
                        updated_at = NOW()
                    WHERE id = $7
                `, [
                    estructura.precio_base_nodo_final,
                    calcPrecio.precio_venta_vecino,
                    calcPrecio.ganancia_unitaria_gestor,
                    metaTienda.alias_vidriera,
                    metaTienda.categoria_vidriera,
                    cambioCosto,
                    ofActual.id
                ]);
            } else {
                const margenInicialGestor = Number(nf.margen_def || 25);
                const calcPrecio = calcularPrecioYGananciaNetaTienda(
                    estructura.precio_base_nodo_final,
                    margenInicialGestor,
                    nf.iva_margen,
                    nf.iibb_margen
                );
                await client.query(`
                    INSERT INTO public.nodos_ofertas_gestor (
                        nodo_id, articulo_catalogo_id, publicado_tienda, destacado_tienda,
                        margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor,
                        precio_base_nodo_snapshot, alerta_cambio_costo,
                        nombre_vidriera_personalizado, categoria_vidriera_personalizada,
                        mostrar_ingredientes, updated_at
                    ) VALUES ($1, $2, false, false, $3, $4, $5, $6, false, $7, $8, true, NOW())
                `, [
                    nid,
                    catalogoRow.id,
                    margenInicialGestor,
                    calcPrecio.precio_venta_vecino,
                    calcPrecio.ganancia_unitaria_gestor,
                    estructura.precio_base_nodo_final,
                    metaTienda.alias_vidriera,
                    metaTienda.categoria_vidriera
                ]);
            }
        }

        await client.query('COMMIT');

        // Invalidar micro-caché de desglose comercial para que el nuevo Combo exponga de inmediato sus ingredientes
        try {
            const { invalidarCacheIngredientesComerciales } = require('./desgloseIngredientesComercialService');
            invalidarCacheIngredientesComerciales();
        } catch (_) {}

        return {
            catalogo: catalogoRow,
            sku_oficial: skuOficial,
            descripcion_oficial: descripcionOficial,
            codigo_barras: codigoBarras,
            firma_composicion: validado.firma_composicion,
            stock_armable: validado.stock_armable,
            componentes: validado.componentes,
            estructura_costos: estructura,
            propuestas_aprobadas: propsCoincidentesRes.rows
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Carga en una sola consulta O(1) todos los combos y calcula su stock_armable en tiempo real
 */
async function obtenerMapaCombosYStockArmable(runner = null, skusFiltro = null) {
    const q = runner || db;
    await asegurarEsquemaCombosCompuestos(q);

    const filtroArray = Array.isArray(skusFiltro) && skusFiltro.length > 0
        ? skusFiltro.map(normalizarSku).filter(Boolean)
        : null;

    const params = [];
    let whereSql = '';
    if (filtroArray && filtroArray.length > 0) {
        params.push(filtroArray);
        whereSql = 'WHERE UPPER(BTRIM(bcc.combo_articulo_id)) = ANY($1::text[])';
    }

    const res = await q.query(`
        SELECT
            bcc.combo_articulo_id,
            bcc.componente_articulo_id,
            bcc.cantidad,
            bcc.orden,
            COALESCE(ba_hijo.descripcion_generada, ba_hijo.descripcion, bcc.componente_articulo_id) AS componente_nombre_oficial,
            ba_hijo.codigo_barras AS componente_codigo_barras,
            GREATEST(0.001, COALESCE(ba_hijo.kilos_unidad, src_hijo.kilos_unidad, 0.25))::numeric(12,4) AS componente_kilos_unidad,
            COALESCE(nac_hijo.costo_puro_total, ba_hijo.costo_base, 0)::numeric(14,2) AS componente_costo_unitario,
            COALESCE(nac_hijo.precio_base_nodo_final, 0)::numeric(14,2) AS componente_precio_base_nodo,
            COALESCE(src_hijo.stock_consolidado, 0)::numeric(14,3) AS stock_hijo_directo,
            COALESCE(src_hijo.es_pack, ba_hijo.es_pack, false) AS hijo_es_pack,
            COALESCE(src_hijo.pack_hijo_codigo, ba_hijo.pack_hijo_codigo) AS hijo_pack_nieto_codigo,
            COALESCE(src_hijo.pack_unidades, ba_hijo.pack_unidades, 1)::int AS hijo_pack_unidades,
            COALESCE(src_nieto.stock_consolidado, 0)::numeric(14,3) AS stock_nieto_directo
        FROM public.bunker_combos_componentes bcc
        JOIN public.bunker_articulos ba_hijo ON ba_hijo.articulo_id = bcc.componente_articulo_id
        LEFT JOIN public.nodos_articulos_catalogo nac_hijo
               ON UPPER(BTRIM(nac_hijo.sku_nodo)) = UPPER(BTRIM(bcc.componente_articulo_id))
              AND nac_hijo.activo = true
        LEFT JOIN public.stock_real_consolidado src_hijo
               ON UPPER(BTRIM(src_hijo.articulo_numero)) = UPPER(BTRIM(bcc.componente_articulo_id))
        LEFT JOIN public.articulos art_nieto
               ON (COALESCE(src_hijo.pack_hijo_codigo, ba_hijo.pack_hijo_codigo) IS NOT NULL
                   AND (art_nieto.numero = COALESCE(src_hijo.pack_hijo_codigo, ba_hijo.pack_hijo_codigo)
                        OR art_nieto.codigo_barras = COALESCE(src_hijo.pack_hijo_codigo, ba_hijo.pack_hijo_codigo)))
        LEFT JOIN public.stock_real_consolidado src_nieto
               ON src_nieto.articulo_numero = COALESCE(art_nieto.numero, src_hijo.pack_hijo_codigo, ba_hijo.pack_hijo_codigo)
        ${whereSql}
        ORDER BY bcc.combo_articulo_id ASC, bcc.orden ASC, bcc.id ASC
    `, params);

    const mapa = new Map();
    for (const r of res.rows) {
        const key = normalizarSku(r.combo_articulo_id);
        if (!mapa.has(key)) {
            mapa.set(key, {
                combo_articulo_id: r.combo_articulo_id,
                componentes: [],
                stock_armable: 0
            });
        }
        let stockEfectivo = Math.floor(Math.max(0, Number(r.stock_hijo_directo || 0)));
        if (r.hijo_es_pack && r.hijo_pack_nieto_codigo && Number(r.hijo_pack_unidades) > 0) {
            stockEfectivo = Math.floor(Math.max(0, Number(r.stock_nieto_directo || 0)) / Number(r.hijo_pack_unidades));
        }
        const cantReq = Math.max(1, Number(r.cantidad || 1));
        const armablesPorHijo = Math.floor(stockEfectivo / cantReq);

        mapa.get(key).componentes.push({
            sku: r.componente_articulo_id,
            nombre_oficial_lamda: r.componente_nombre_oficial,
            etiqueta_oficial_lamda: `[${r.componente_articulo_id}] ${r.componente_nombre_oficial}`,
            codigo_barras: r.componente_codigo_barras || null,
            cantidad: cantReq,
            orden: Number(r.orden || 1),
            kilos_unidad: Number(r.componente_kilos_unidad || 0.25),
            costo_unitario: Number(r.componente_costo_unitario || 0),
            precio_base_nodo: Number(r.componente_precio_base_nodo || 0),
            stock_efectivo_hijo: stockEfectivo,
            combos_armables_hijo: armablesPorHijo,
            hijo_es_pack: Boolean(r.hijo_es_pack),
            hijo_pack_nieto_codigo: r.hijo_pack_nieto_codigo || null,
            hijo_pack_unidades: Number(r.hijo_pack_unidades || 1)
        });
    }

    for (const entry of mapa.values()) {
        entry.stock_armable = entry.componentes.length > 0
            ? Math.max(0, Math.min(...entry.componentes.map(c => c.combos_armables_hijo)))
            : 0;
    }

    return mapa;
}

/**
 * Cascada Reactiva Automática de Combos (LDN 8):
 * Recalcula todos los Combos afectados por variación de costos/precios de sus hijos o envases,
 * actualizando bunker_articulos, bunker_lista_articulos, nodos_articulos_catalogo y nodos_ofertas_gestor.
 */
async function recalcularCombosAfectadosPorCambio(runner = null, {
    skusModificados = null,
    insumosIdsModificados = null,
    todosLosCombos = false,
    costosSimuladosArticulos = {}
} = {}) {
    const q = runner || db;
    await asegurarEsquemaCombosCompuestos(q);

    const skusSet = Array.isArray(skusModificados)
        ? skusModificados.map(normalizarSku).filter(Boolean)
        : [];
    const insumosSet = Array.isArray(insumosIdsModificados)
        ? insumosIdsModificados.map(Number).filter(n => n > 0)
        : [];

    let combosTargetSql = `
        SELECT DISTINCT ba.articulo_id
        FROM public.bunker_articulos ba
        LEFT JOIN public.nodos_articulos_catalogo nac ON UPPER(BTRIM(nac.sku_nodo)) = UPPER(BTRIM(ba.articulo_id))
        WHERE ba.es_combo = true
    `;
    const params = [];

    if (!todosLosCombos && (skusSet.length > 0 || insumosSet.length > 0)) {
        const conds = [];
        if (skusSet.length > 0) {
            params.push(skusSet);
            conds.push(`EXISTS (
                SELECT 1 FROM public.bunker_combos_componentes bcc
                WHERE bcc.combo_articulo_id = ba.articulo_id
                  AND UPPER(BTRIM(bcc.componente_articulo_id)) = ANY($${params.length}::text[])
            )`);
            conds.push(`UPPER(BTRIM(ba.articulo_id)) = ANY($${params.length}::text[])`);
        }
        if (insumosSet.length > 0) {
            params.push(insumosSet);
            conds.push(`nac.insumo_envase_id = ANY($${params.length}::int[])`);
        }
        combosTargetSql += ` AND (${conds.join(' OR ')})`;
    } else if (!todosLosCombos && skusSet.length === 0 && insumosSet.length === 0) {
        return { combos_recalculados: 0, detalles: [] };
    }

    const combosRes = await q.query(combosTargetSql, params);
    if (combosRes.rowCount === 0) {
        return { combos_recalculados: 0, detalles: [] };
    }

    const detalles = [];
    for (const cRow of combosRes.rows) {
        const comboSku = cRow.articulo_id;
        const compsRes = await q.query(`
            SELECT componente_articulo_id, cantidad, orden
            FROM public.bunker_combos_componentes
            WHERE combo_articulo_id = $1
            ORDER BY orden ASC, id ASC
        `, [comboSku]);
        if (compsRes.rowCount < 2) continue;

        const validado = await validarYEnriquecerComponentesCombo(q, compsRes.rows, {
            comboSkuActual: comboSku,
            costosSimuladosArticulos
        });

        const metaRes = await q.query(`
            SELECT ba.articulo_id, COALESCE(ba.porcentaje_iva, 21) AS porcentaje_iva,
                   nac.id AS catalogo_id, nac.modo_precio_combo, nac.margen_lamda_pct,
                   nac.ajuste_comercial_combo_pct, nac.cargo_pack_combo, nac.precio_manual_override,
                   nac.margen_sugerido_gestor_pct,
                   nac.insumo_envase_id, COALESCE(env.costo_patron, nac.costo_envase_aplicado, 0)::numeric(14,2) AS costo_envase_vivo,
                   nac.segundos_fraccionamiento, COALESCE(ct.valor_hora, nac.valor_hora_aplicado, 4500)::numeric(14,2) AS valor_hora_vivo
            FROM public.bunker_articulos ba
            LEFT JOIN public.nodos_articulos_catalogo nac ON UPPER(BTRIM(nac.sku_nodo)) = UPPER(BTRIM(ba.articulo_id))
            LEFT JOIN public.ingredientes env ON env.id = nac.insumo_envase_id
            LEFT JOIN public.colaboradores_tarifas ct ON ct.id = nac.tarifa_colaborador_id
            WHERE ba.articulo_id = $1
            LIMIT 1
        `, [comboSku]);
        if (metaRes.rowCount === 0) continue;
        const m = metaRes.rows[0];

        const estructura = calcularEstructuraCostosCombo({
            componentes: validado.componentes,
            modo_precio_combo: m.modo_precio_combo || 'COSTO_MAS_MARGEN',
            costo_envase_aplicado: Number(m.costo_envase_vivo || 0),
            segundos_armado: Number(m.segundos_fraccionamiento || 0),
            valor_hora_aplicado: Number(m.valor_hora_vivo || 0),
            margen_lamda_pct: Number(m.margen_lamda_pct ?? 25),
            ajuste_comercial_combo_pct: Number(m.ajuste_comercial_combo_pct || 0),
            cargo_pack_combo: Number(m.cargo_pack_combo || 0),
            iva_pct: Number(m.porcentaje_iva ?? 21),
            alicuota_iibb_lamda_pct: 4,
            margen_sugerido_gestor_pct: Number(m.margen_sugerido_gestor_pct ?? 25),
            precio_manual_override: m.precio_manual_override
        });

        const kilosTotales = validado.kilos_unidad_total;
        const costoMateriaYEnvase = Number((estructura.costo_componentes + estructura.costo_envase_aplicado).toFixed(2));
        const costoKgSobrescrito = Number((costoMateriaYEnvase / Math.max(0.001, kilosTotales)).toFixed(4));

        await q.query(`
            UPDATE public.bunker_articulos
            SET kilos_unidad = $1,
                costo_base = $2,
                updated_at = NOW()
            WHERE articulo_id = $3
        `, [kilosTotales, estructura.costo_puro_total, comboSku]);

        // Recalcular bunker_lista_articulos en todas las listas donde participe el combo
        const listasComboRes = await q.query(`
            SELECT bla.id, bla.lista_id, bla.margen_ganancia, bla.iva, COALESCE(lp.canal_comercial, 'MAYORISTA') AS canal_comercial
            FROM public.bunker_lista_articulos bla
            JOIN public.bunker_listas_precios lp ON lp.id = bla.lista_id
            WHERE UPPER(BTRIM(bla.articulo_numero)) = UPPER(BTRIM($1))
        `, [comboSku]);

        for (const lRow of listasComboRes.rows) {
            if (lRow.canal_comercial === 'NODOS') {
                await q.query(`
                    UPDATE public.bunker_lista_articulos
                    SET margen_ganancia = $1,
                        costo_base_sobrescrito = $2,
                        costo_tiempo = $3,
                        precio_final = $4,
                        updated_at = NOW()
                    WHERE id = $5
                `, [
                    estructura.margen_markup_efectivo_pct,
                    costoKgSobrescrito > 0 ? costoKgSobrescrito : null,
                    estructura.costo_mano_obra_aplicado,
                    estructura.precio_base_nodo_final,
                    lRow.id
                ]);
            } else {
                const mLista = Number(lRow.margen_ganancia || 0);
                const ivaLista = normalizarAlicuota(lRow.iva, estructura.iva_pct);
                const pFinal = Number((estructura.costo_puro_total * (1 + mLista / 100) * (1 + ivaLista / 100)).toFixed(2));
                await q.query(`
                    UPDATE public.bunker_lista_articulos
                    SET costo_base_sobrescrito = $1,
                        costo_tiempo = $2,
                        precio_final = $3,
                        updated_at = NOW()
                    WHERE id = $4
                `, [
                    costoKgSobrescrito > 0 ? costoKgSobrescrito : null,
                    estructura.costo_mano_obra_aplicado,
                    pFinal,
                    lRow.id
                ]);
            }
        }

        if (m.catalogo_id) {
            await q.query(`
                UPDATE public.nodos_articulos_catalogo
                SET kilos_unidad = $1,
                    costo_insumo_kg = $2,
                    costo_insumo_fraccion = $3,
                    costo_envase_aplicado = $4,
                    valor_hora_aplicado = $5,
                    costo_mano_obra_aplicado = $6,
                    costo_puro_total = $7,
                    precio_base_nodo_neto = $8,
                    precio_base_nodo_final = $9,
                    precio_sugerido_vecino = $10,
                    updated_at = NOW()
                WHERE id = $11
            `, [
                kilosTotales,
                Number((estructura.costo_componentes / Math.max(0.001, kilosTotales)).toFixed(2)),
                estructura.costo_componentes,
                estructura.costo_envase_aplicado,
                estructura.valor_hora_aplicado,
                estructura.costo_mano_obra_aplicado,
                estructura.costo_puro_total,
                estructura.precio_base_nodo_neto,
                estructura.precio_base_nodo_final,
                estructura.precio_sugerido_vecino,
                m.catalogo_id
            ]);

            const ofRes = await q.query(`
                SELECT nog.id, nog.margen_gestor_pct, nog.precio_base_nodo_snapshot,
                       COALESCE(nm.alicuota_iva_margen_pct, 21.00)::numeric(5,2) AS iva_margen,
                       COALESCE(nm.alicuota_iibb_margen_pct, 4.00)::numeric(5,2) AS iibb_margen
                FROM public.nodos_ofertas_gestor nog
                JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
                WHERE nog.articulo_catalogo_id = $1
                FOR UPDATE OF nog
            `, [m.catalogo_id]);

            for (const ofRow of ofRes.rows) {
                const calc = calcularPrecioYGananciaNetaTienda(
                    estructura.precio_base_nodo_final,
                    ofRow.margen_gestor_pct,
                    ofRow.iva_margen,
                    ofRow.iibb_margen
                );
                const cambioBase = Math.abs(Number(ofRow.precio_base_nodo_snapshot || 0) - Number(estructura.precio_base_nodo_final)) >= 1;
                await q.query(`
                    UPDATE public.nodos_ofertas_gestor
                    SET precio_base_nodo_snapshot = $1,
                        precio_venta_vecino = $2,
                        ganancia_unitaria_gestor = $3,
                        alerta_cambio_costo = CASE WHEN $4 THEN true ELSE alerta_cambio_costo END,
                        updated_at = NOW()
                    WHERE id = $5
                `, [
                    estructura.precio_base_nodo_final,
                    calc.precio_venta_vecino,
                    calc.ganancia_unitaria_gestor,
                    cambioBase,
                    ofRow.id
                ]);
            }
        }

        detalles.push({
            sku_combo: comboSku,
            costo_total_lamda: estructura.costo_puro_total,
            precio_base_nodo_final: estructura.precio_base_nodo_final,
            utilidad_neta_real_lamda: estructura.utilidad_neta_real_lamda
        });
    }

    return {
        combos_recalculados: detalles.length,
        detalles
    };
}

/**
 * Tablero integral para Pizarra ([LDN 8] Combos y Sub-pestaña 4 de Cotizador Nodos)
 */
async function obtenerEstadoCombosPizarra(opciones = {}) {
    await asegurarEsquemaCombosCompuestos();
    const mapaCombos = (opciones && opciones.mapaCombos instanceof Map)
        ? opciones.mapaCombos
        : await obtenerMapaCombosYStockArmable(db);

    const [combosCatRes, propuestasRes, propItemsRes, articulosElegiblesRes, envasesRes, tarifasRes, nodosRes, listasMayoristasRes] = await Promise.all([
        db.query(`
            SELECT
                ba.articulo_id AS sku_combo,
                ba.codigo_barras,
                COALESCE(ba.descripcion_generada, ba.descripcion, nac.nombre_publico) AS nombre_oficial_lamda,
                ba.kilos_unidad,
                ba.costo_base,
                COALESCE(ba.porcentaje_iva, 21) AS porcentaje_iva,
                ba.firma_combo,
                nac.id AS catalogo_id,
                nac.presentacion_etiqueta,
                nac.modo_precio_combo,
                nac.margen_lamda_pct,
                nac.ajuste_comercial_combo_pct,
                nac.cargo_pack_combo,
                nac.insumo_envase_id,
                env.codigo AS envase_codigo,
                env.nombre AS envase_nombre,
                COALESCE(env.costo_patron, nac.costo_envase_aplicado, 0)::numeric(14,2) AS costo_envase_vivo,
                nac.tarifa_colaborador_id,
                nac.segundos_fraccionamiento,
                COALESCE(ct.valor_hora, nac.valor_hora_aplicado, 4500)::numeric(14,2) AS valor_hora_vivo,
                nac.costo_puro_total AS costo_total_lamda,
                nac.precio_base_nodo_neto,
                nac.precio_manual_override,
                nac.precio_base_nodo_final,
                COALESCE(nac.compartido_mayorista, false) AS compartido_mayorista,
                COALESCE(nac.listas_mayoristas_compartidas, '[]'::jsonb) AS listas_mayoristas_compartidas,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'nodo_id', nog.nodo_id,
                        'nombre_marca', nm.nombre_marca,
                        'publicado_tienda', nog.publicado_tienda,
                        'nombre_vidriera', COALESCE(NULLIF(BTRIM(nog.nombre_vidriera_personalizado), ''), ba.descripcion_generada),
                        'precio_venta_vecino', nog.precio_venta_vecino
                    ) ORDER BY nog.nodo_id ASC)
                    FROM public.nodos_ofertas_gestor nog
                    JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
                    WHERE nog.articulo_catalogo_id = nac.id),
                    '[]'::json
                ) AS tiendas_vinculadas
            FROM public.bunker_articulos ba
            LEFT JOIN public.nodos_articulos_catalogo nac ON UPPER(BTRIM(nac.sku_nodo)) = UPPER(BTRIM(ba.articulo_id))
            LEFT JOIN public.ingredientes env ON env.id = nac.insumo_envase_id
            LEFT JOIN public.colaboradores_tarifas ct ON ct.id = nac.tarifa_colaborador_id
            WHERE ba.es_combo = true
              AND COALESCE(nac.activo, true) = true
            ORDER BY COALESCE(ba.descripcion_generada, ba.articulo_id) ASC
        `),
        db.query(`
            SELECT npc.*,
                   nm.nombre_marca AS nodo_solicitante_nombre,
                   nm.slug AS nodo_solicitante_slug,
                   nm.color_primario AS nodo_color
            FROM public.nodos_propuestas_combos npc
            JOIN public.nodos_maestro nm ON nm.id = npc.nodo_solicitante_id
            WHERE COALESCE(npc.estado, '') <> 'ANULADA'
            ORDER BY CASE WHEN npc.estado = 'PENDIENTE_COTIZACION' THEN 0 ELSE 1 END, npc.id DESC
        `),
        db.query(`
            SELECT npci.*,
                   COALESCE(ba.descripcion_generada, ba.descripcion, npci.componente_articulo_id) AS nombre_oficial_lamda,
                   GREATEST(0.001, COALESCE(ba.kilos_unidad, 0.25))::numeric(12,4) AS kilos_unidad,
                   COALESCE(nac.costo_puro_total, ba.costo_base, 0)::numeric(14,2) AS costo_unitario,
                   COALESCE(nac.precio_base_nodo_final, 0)::numeric(14,2) AS precio_base_nodo
            FROM public.nodos_propuestas_combos_items npci
            JOIN public.bunker_articulos ba ON ba.articulo_id = npci.componente_articulo_id
            LEFT JOIN public.nodos_articulos_catalogo nac
                   ON UPPER(BTRIM(nac.sku_nodo)) = UPPER(BTRIM(npci.componente_articulo_id))
                  AND nac.activo = true
            ORDER BY npci.propuesta_combo_id ASC, npci.orden ASC, npci.id ASC
        `),
        db.query(`
            SELECT
                ba.articulo_id AS sku,
                COALESCE(ba.descripcion_generada, ba.descripcion, ba.articulo_id) AS nombre_oficial_lamda,
                COALESCE(bf.nombre, ba.rubro, 'Almacén') AS familia_nombre,
                GREATEST(0.001, COALESCE(ba.kilos_unidad, src.kilos_unidad, 0.25))::numeric(12,4) AS kilos_unidad,
                COALESCE(nac.costo_puro_total, ba.costo_base, 0)::numeric(14,2) AS costo_unitario,
                COALESCE(nac.precio_base_nodo_final, 0)::numeric(14,2) AS precio_base_nodo,
                nac.id AS catalogo_nodo_id,
                nac.flujo_lamda,
                COALESCE(src.stock_consolidado, 0)::numeric(14,2) AS stock_consolidado
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            LEFT JOIN public.nodos_articulos_catalogo nac
                   ON UPPER(BTRIM(nac.sku_nodo)) = UPPER(BTRIM(ba.articulo_id))
                  AND nac.activo = true
            LEFT JOIN public.stock_real_consolidado src
                   ON UPPER(BTRIM(src.articulo_numero)) = UPPER(BTRIM(ba.articulo_id))
            WHERE COALESCE(ba.es_combo, false) = false
              AND COALESCE(ba.familia_id, 0) NOT IN (42, 46)
              AND COALESCE(bf.codigo_familia, '') NOT IN ('FAM-PRODUCCION', 'FAM-INSUMOS', 'FAM-COMBOS')
              AND COALESCE(nac.costo_puro_total, ba.costo_base, 0) > 0
            ORDER BY (nac.id IS NOT NULL) DESC,
                     COALESCE(bf.nombre, ba.rubro, 'Almacén') ASC,
                     COALESCE(ba.descripcion_generada, ba.articulo_id) ASC
        `),
        db.query(`
            SELECT id, codigo, nombre, COALESCE(costo_patron, 0)::numeric(14,2) AS costo_patron
            FROM public.ingredientes
            WHERE COALESCE(es_insumo, false) = true
            ORDER BY nombre ASC
        `),
        db.query(`
            SELECT ct.id, ct.valor_hora, COALESCE(u.nombre_completo, u.usuario, 'Operador Taller') AS colaborador_nombre
            FROM public.colaboradores_tarifas ct
            LEFT JOIN public.usuarios u ON u.id = ct.usuario_id
            ORDER BY ct.id ASC
        `),
        db.query(`
            SELECT id, codigo_nodo, slug, nombre_marca, color_primario, perfil_operativo
            FROM public.nodos_maestro
            WHERE COALESCE(activo, true) = true
            ORDER BY id ASC
        `),
        db.query(`
            SELECT id, nombre, descripcion
            FROM public.bunker_listas_precios
            WHERE activa = true AND COALESCE(canal_comercial, 'MAYORISTA') = 'MAYORISTA'
            ORDER BY id ASC
        `)
    ]);

    const itemsPorPropId = new Map();
    for (const it of propItemsRes.rows) {
        const pid = Number(it.propuesta_combo_id);
        if (!itemsPorPropId.has(pid)) itemsPorPropId.set(pid, []);
        itemsPorPropId.get(pid).push({
            ...it,
            etiqueta_oficial_lamda: `[${it.componente_articulo_id}] ${it.nombre_oficial_lamda}`
        });
    }

    const propuestas = propuestasRes.rows.map(pr => {
        const items = itemsPorPropId.get(Number(pr.id)) || [];
        const kilosTot = Number(items.reduce((acc, x) => acc + Number(x.kilos_unidad || 0) * Number(x.cantidad || 1), 0).toFixed(3));
        return {
            ...pr,
            kilos_totales: kilosTot,
            items
        };
    });

    const combos = combosCatRes.rows.map(c => {
        const key = normalizarSku(c.sku_combo);
        const infoMapa = mapaCombos.get(key) || { componentes: [], stock_armable: 0 };
        const compsParaCalc = infoMapa.componentes.map(comp => ({
            costo_subtotal_elaborado: Number((comp.costo_unitario * comp.cantidad).toFixed(2)),
            precio_base_subtotal_hijo: Number((comp.precio_base_nodo * comp.cantidad).toFixed(2)),
            cantidad: comp.cantidad
        }));
        const estructura = calcularEstructuraCostosCombo({
            componentes: compsParaCalc,
            modo_precio_combo: c.modo_precio_combo || 'COSTO_MAS_MARGEN',
            costo_envase_aplicado: Number(c.costo_envase_vivo || 0),
            segundos_armado: Number(c.segundos_fraccionamiento || 0),
            valor_hora_aplicado: Number(c.valor_hora_vivo || 0),
            margen_lamda_pct: Number(c.margen_lamda_pct ?? 25),
            ajuste_comercial_combo_pct: Number(c.ajuste_comercial_combo_pct || 0),
            cargo_pack_combo: Number(c.cargo_pack_combo || 0),
            iva_pct: Number(c.porcentaje_iva || 21),
            alicuota_iibb_lamda_pct: 4,
            precio_manual_override: c.precio_manual_override ?? c.precio_base_nodo_final
        });
        return {
            ...c,
            stock_armable: infoMapa.stock_armable,
            componentes: infoMapa.componentes,
            estructura_viva: estructura
        };
    });

    return {
        combos,
        propuestas_combos: propuestas,
        pendientes_count: propuestas.filter(p => p.estado === 'PENDIENTE_COTIZACION').length,
        articulos_elegibles: articulosElegiblesRes.rows.map(a => ({
            ...a,
            etiqueta_oficial_lamda: `[${a.sku}] ${a.nombre_oficial_lamda}`
        })),
        insumos_empaque: envasesRes.rows,
        tarifas_colaboradores: tarifasRes.rows,
        nodos_activos: nodosRes.rows,
        listas_mayoristas: listasMayoristasRes.rows
    };
}

/**
 * Protección HTTP 409 Conflict: verifica si un SKU es componente hijo de algún Combo en Búnker
 */
async function verificarDependenciasComboAntesDeEliminar(runner, articuloId) {
    const q = runner || db;
    await asegurarEsquemaCombosCompuestos(q);
    const res = await q.query(`
        SELECT bcc.combo_articulo_id,
               bcc.cantidad,
               COALESCE(ba.descripcion_generada, ba.descripcion, bcc.combo_articulo_id) AS combo_nombre
        FROM public.bunker_combos_componentes bcc
        JOIN public.bunker_articulos ba ON ba.articulo_id = bcc.combo_articulo_id
        WHERE UPPER(BTRIM(bcc.componente_articulo_id)) = UPPER(BTRIM($1))
        ORDER BY bcc.combo_articulo_id ASC
    `, [String(articuloId || '').trim()]);
    return res.rows;
}

/**
 * Registra el egreso físico determinista de mercadería en depósito explotando Combos en sus SKUs hijos
 * (y resolviendo también multipacks hijos si existieran) + egreso opcional de envase contenedor del combo.
 */
async function registrarEgresoStockConExplosionCombo(client, {
    pedidoIds = [],
    origenIngreso = 'nodos_barriales',
    observacionBase = 'Despacho Tienda'
} = {}) {
    if (!Array.isArray(pedidoIds) || pedidoIds.length === 0) {
        return { movimientos_generados: 0, detalle_skus: [] };
    }
    await asegurarEsquemaCombosCompuestos(client);

    const itemsRes = await client.query(`
        SELECT
            npi.id AS pedido_item_id,
            npi.pedido_id,
            COALESCE(nac.sku_nodo, npi.sku_nodo) AS sku_oficial,
            npi.cantidad::numeric(12,2) AS cantidad_item,
            COALESCE(npi.es_combo, nac.es_combo, ba.es_combo, false) AS es_combo,
            npi.componentes_combo_snapshot,
            COALESCE(nac.kilos_unidad, ba.kilos_unidad, 0.25)::numeric(12,4) AS kilos_unidad,
            ba.codigo_barras,
            nac.insumo_envase_id
        FROM public.nodos_pedidos_items npi
        LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
        LEFT JOIN public.bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(COALESCE(nac.sku_nodo, npi.sku_nodo)))
        WHERE npi.pedido_id = ANY($1::int[])
        ORDER BY npi.id ASC
    `, [pedidoIds.map(Number)]);

    const mapaCombosVivo = await obtenerMapaCombosYStockArmable(client);
    const egresosPorSku = new Map();
    const egresosEnvasesCombo = new Map();

    const acumularEgresoSku = async (skuRaw, cantRaw, kilosUnitFallback, codBarrasFallback, etiquetaComboOrigen = '') => {
        let targetSku = String(skuRaw || '').trim();
        let targetCant = Number(cantRaw || 0);
        let targetCodBarras = codBarrasFallback || null;
        let targetKilosUnit = Number(kilosUnitFallback || 0.25);
        if (!targetSku || targetCant <= 0) return;

        const packRes = await client.query(`
            SELECT src.es_pack, src.pack_hijo_codigo, src.pack_unidades, COALESCE(src.kilos_unidad, ba.kilos_unidad, 0.25) AS kilos_u,
                   ba.codigo_barras
            FROM public.stock_real_consolidado src
            LEFT JOIN public.bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(src.articulo_numero))
            WHERE UPPER(BTRIM(src.articulo_numero)) = UPPER(BTRIM($1))
            LIMIT 1
        `, [targetSku]);

        if (packRes.rowCount > 0) {
            const pr = packRes.rows[0];
            targetKilosUnit = Number(pr.kilos_u || targetKilosUnit);
            targetCodBarras = pr.codigo_barras || targetCodBarras;
            if (pr.es_pack && pr.pack_hijo_codigo && Number(pr.pack_unidades) > 0) {
                const nietoRes = await client.query(`
                    SELECT a.numero, a.codigo_barras, COALESCE(src.kilos_unidad, ba.kilos_unidad, 0.05) AS kilos_u
                    FROM public.articulos a
                    LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = a.numero
                    LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = a.numero
                    WHERE a.numero = $1 OR a.codigo_barras = $1
                    LIMIT 1
                `, [pr.pack_hijo_codigo]);
                if (nietoRes.rowCount > 0) {
                    targetSku = nietoRes.rows[0].numero;
                    targetCodBarras = nietoRes.rows[0].codigo_barras || null;
                    targetCant = targetCant * Number(pr.pack_unidades);
                    targetKilosUnit = Number(nietoRes.rows[0].kilos_u || 0.05);
                }
            }
        }

        const key = normalizarSku(targetSku);
        if (!egresosPorSku.has(key)) {
            egresosPorSku.set(key, {
                sku: targetSku,
                codigo_barras: targetCodBarras,
                cantidad: 0,
                kilos: 0,
                referencias_combo: new Set()
            });
        }
        const entry = egresosPorSku.get(key);
        entry.cantidad = Number((entry.cantidad + targetCant).toFixed(3));
        entry.kilos = Number((entry.kilos + targetCant * targetKilosUnit).toFixed(3));
        if (etiquetaComboOrigen) {
            entry.referencias_combo.add(etiquetaComboOrigen);
        }
    };

    for (const it of itemsRes.rows) {
        const skuItem = String(it.sku_oficial || '').trim();
        const cantItem = Number(it.cantidad_item || 0);
        if (!skuItem || cantItem <= 0) continue;

        const keyUpper = normalizarSku(skuItem);
        const snapArr = Array.isArray(it.componentes_combo_snapshot) ? it.componentes_combo_snapshot : null;
        const infoVivo = mapaCombosVivo.get(keyUpper);
        const esComboEfectivo = Boolean(it.es_combo || (snapArr && snapArr.length > 0) || (infoVivo && infoVivo.componentes.length > 0));

        if (esComboEfectivo) {
            const comps = (snapArr && snapArr.length > 0)
                ? snapArr
                : (infoVivo ? infoVivo.componentes : []);

            for (const c of comps) {
                const skuHijo = c.sku || c.componente_articulo_id;
                const cantHijoPorCombo = Math.max(1, Number(c.cantidad || 1));
                await acumularEgresoSku(
                    skuHijo,
                    cantItem * cantHijoPorCombo,
                    c.kilos_unidad || 0.25,
                    c.codigo_barras || null,
                    `Combo ${skuItem} x${cantItem}`
                );
            }

            if (it.insumo_envase_id) {
                const envId = Number(it.insumo_envase_id);
                egresosEnvasesCombo.set(envId, (egresosEnvasesCombo.get(envId) || 0) + cantItem);
            }
        } else {
            await acumularEgresoSku(skuItem, cantItem, it.kilos_unidad, it.codigo_barras, '');
        }
    }

    const detalleSkus = [];
    for (const entry of egresosPorSku.values()) {
        const sufijoCombo = entry.referencias_combo.size > 0
            ? ` [${Array.from(entry.referencias_combo).join(', ')}]`
            : '';
        const obsFinal = `${observacionBase}${sufijoCombo}`;

        await client.query(`
            INSERT INTO public.stock_ventas_movimientos (
                articulo_numero, codigo_barras, kilos, cantidad, fecha, tipo, origen_ingreso, observaciones
            ) VALUES ($1, $2, $3, $4, NOW(), 'egreso_venta', $5, $6)
        `, [
            entry.sku,
            entry.codigo_barras || null,
            entry.kilos,
            entry.cantidad,
            origenIngreso,
            obsFinal
        ]);

        const updStock = await client.query(`
            UPDATE public.stock_real_consolidado
            SET stock_movimientos = COALESCE(stock_movimientos, 0) - $1,
                stock_consolidado = COALESCE(stock_lomasoft, 0) + (COALESCE(stock_movimientos, 0) - $1) + COALESCE(stock_ajustes, 0),
                ultima_actualizacion = NOW()
            WHERE UPPER(BTRIM(articulo_numero)) = UPPER(BTRIM($2))
        `, [entry.cantidad, entry.sku]);

        if (updStock.rowCount === 0) {
            await client.query(`
                INSERT INTO public.stock_real_consolidado (
                    articulo_numero, stock_lomasoft, stock_movimientos, stock_ajustes, stock_consolidado, ultima_actualizacion
                ) VALUES ($1, 0, $2, 0, $2, NOW())
                ON CONFLICT DO NOTHING
            `, [entry.sku, -entry.cantidad]);
        }

        detalleSkus.push({
            sku: entry.sku,
            cantidad_descontada: entry.cantidad,
            kilos_descontados: entry.kilos
        });
    }

    for (const [envId, cantEnv] of egresosEnvasesCombo.entries()) {
        const ingRes = await client.query('SELECT id, COALESCE(stock_actual, 0) AS stock_actual FROM public.ingredientes WHERE id = $1 FOR UPDATE', [envId]);
        if (ingRes.rowCount > 0) {
            const stockAnt = Number(ingRes.rows[0].stock_actual || 0);
            await client.query(`
                UPDATE public.ingredientes
                SET stock_actual = COALESCE(stock_actual, 0) - $1
                WHERE id = $2
            `, [cantEnv, envId]);
            await client.query(`
                INSERT INTO public.ingredientes_movimientos (
                    ingrediente_id, tipo, kilos, fecha, carro_id, observaciones, stock_anterior
                ) VALUES ($1, 'egreso', $2, NOW(), NULL, $3, $4)
            `, [envId, -cantEnv, `${observacionBase} [Empaque Combo]`, stockAnt]);
        }
    }

    return {
        movimientos_generados: detalleSkus.length,
        detalle_skus: detalleSkus
    };
}

/**
 * Reversión limpia en Laboratorio al reabrir un Canasto entregado (reabrirCanastoParaPruebaLaboratorio)
 */
async function revertirEgresoStockCanastoLaboratorio(client, { codigoCanasto }) {
    if (!codigoCanasto) return { revertidos: 0 };
    const patron = `%Canasto ${String(codigoCanasto).trim()}%`;

    const movsRes = await client.query(`
        DELETE FROM public.stock_ventas_movimientos
        WHERE origen_ingreso = 'canasto_nodo_barrial'
          AND observaciones LIKE $1
        RETURNING articulo_numero, cantidad
    `, [patron]);

    for (const m of movsRes.rows) {
        const cant = Number(m.cantidad || 0);
        if (cant > 0 && m.articulo_numero) {
            await client.query(`
                UPDATE public.stock_real_consolidado
                SET stock_movimientos = COALESCE(stock_movimientos, 0) + $1,
                    stock_consolidado = COALESCE(stock_lomasoft, 0) + (COALESCE(stock_movimientos, 0) + $1) + COALESCE(stock_ajustes, 0),
                    ultima_actualizacion = NOW()
                WHERE UPPER(BTRIM(articulo_numero)) = UPPER(BTRIM($2))
            `, [cant, m.articulo_numero]);
        }
    }

    const envMovsRes = await client.query(`
        DELETE FROM public.ingredientes_movimientos
        WHERE carro_id IS NULL
          AND tipo = 'egreso'
          AND observaciones LIKE $1
        RETURNING ingrediente_id, kilos
    `, [patron]);

    for (const em of envMovsRes.rows) {
        const dev = Math.abs(Number(em.kilos || 0));
        if (dev > 0 && em.ingrediente_id) {
            await client.query(`
                UPDATE public.ingredientes
                SET stock_actual = COALESCE(stock_actual, 0) + $1
                WHERE id = $2
            `, [dev, em.ingrediente_id]);
        }
    }

    return { revertidos: movsRes.rowCount };
}

module.exports = {
    normalizarSku,
    construirFirmaComposicionCombo,
    ejecutarMigracionCombosCompuestos,
    marcarEsquemaCombosListo,
    asegurarEsquemaCombosCompuestos,
    asegurarTaxonomiaOficialCombosBunker,
    validarYEnriquecerComponentesCombo,
    calcularEstructuraCostosCombo,
    generarSkuYNomenclaturaOficialCombo,
    previsualizarCotizacionCombo,
    crearPropuestaComboGestor,
    anularODescartarPropuestaCombo,
    cotizarYAprobarCombo,
    obtenerEstadoCombosPizarra,
    obtenerMapaCombosYStockArmable,
    recalcularCombosAfectadosPorCambio,
    verificarDependenciasComboAntesDeEliminar,
    registrarEgresoStockConExplosionCombo,
    revertirEgresoStockCanastoLaboratorio
};
