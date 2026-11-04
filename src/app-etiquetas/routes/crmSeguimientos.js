const express = require('express');
const router = express.Router();
const pool = require('../../usuarios/pool');

// Helper para pausas entre mensajes secuenciales (burbujas)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Artículos predeterminados del "Pack Verdulería / Frutos Secos 2kg y 5kg" (Caso Zulma y similares)
const CODIGOS_PACK_VERDULERIA_FRUTOS_SECOS = [
    // Nueces (Peladas Mariposa, Cuarto, Con Cáscara y Pecán)
    'NMECHX2', 'NMELCHx5', 'NCBxK', 'NCECAMX5', 'EMB-VH3OLC',
    'EMB-1IUEZ8', 'NCC34/36X5', 'EMB-BALBK8', 'NCC36+X5', 'NPM', 'NPMx5',
    // Almendras (Peladas Naturales, Tostadas y Tostadas/Saladas)
    'APNx2', 'APN27/30X5', 'APN25/27x2', 'APN25/27X5',
    'ATx2', 'ATx5', 'ATySx5', 'EMB-STMAK2',
    // Avellanas y Pistachos
    'APx2', 'PTSx2', 'PTSx5', 'PPCX5',
    // Castañas de Cajú (Natural, Tostada, Tostada y Salada) y Castañas de Pará
    'CCW4X2', 'CCW4X5', 'CCTX2', 'CCTX5', 'CCTSx2B', 'CCTSx5', 'CPPX3',
    // Mixes de Frutos Secos en 2kg y 5kg
    'MFSx2', 'MFSx5', 'MFSSPx2', 'MFSSPx5', 'MFSTx2', 'MFSTx5', 'MSx2', 'MSx5', 'MFSPX2', 'MFSPx5'
];

let tablasPlantillasVerificadas = false;

async function asegurarTablasPlantillasCrm() {
    if (tablasPlantillasVerificadas) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.crm_plantillas_whatsapp (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(160) NOT NULL,
                descripcion VARCHAR(255),
                articulos_codigos JSONB DEFAULT '[]'::jsonb,
                formato_precio VARCHAR(40) DEFAULT 'BOLSA',
                descuento_pct NUMERIC(5,2) DEFAULT 0,
                saludo_template TEXT,
                cierre_template TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            ALTER TABLE public.crm_seguimientos_whatsapp
                ADD COLUMN IF NOT EXISTS plantilla_id INTEGER NULL,
                ADD COLUMN IF NOT EXISTS articulos_codigos JSONB DEFAULT '[]'::jsonb;
        `);

        // Sembrar perfil inicial si no existe ninguno
        const countRes = await pool.query('SELECT COUNT(*)::int AS total FROM public.crm_plantillas_whatsapp');
        if ((countRes.rows[0]?.total || 0) === 0) {
            await pool.query(`
                INSERT INTO public.crm_plantillas_whatsapp (
                    nombre, descripcion, articulos_codigos, formato_precio, descuento_pct,
                    saludo_template, cierre_template
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                '🌱 Perfil Verdulería — Frutos Secos (2 kg y 5 kg)',
                'Selección de Nueces, Almendras (naturales, tostadas y saladas), Avellanas, Pistachos, Castañas de Cajú/Pará y Mixes en fracciones de 2 kg y 5 kg.',
                JSON.stringify(CODIGOS_PACK_VERDULERIA_FRUTOS_SECOS),
                'BOLSA',
                0,
                '¡Hola {contacto}! ¿Cómo estás? Te paso el listado de frutos secos fraccionados en bolsas de 2 kg y 5 kg que tenemos preparados para que puedas ofrecer en la verdulería:',
                'Como estamos acá cerquita, si querés probar alguna fracción de 2 kg o de 5 kg avisame cuál te sirve y te lo alcanzo sin cargo. ¡Que tengas un excelente arranque de semana!'
            ]);
        }

        tablasPlantillasVerificadas = true;
    } catch (err) {
        console.warn('⚠️ [CRM-SEGUIMIENTOS] Aviso verificando tabla de plantillas WA:', err.message);
    }
}

asegurarTablasPlantillasCrm().catch(() => {});

/**
 * GET /api/crm/clientes
 * Lista de clientes de Búnker con sus contactos de WhatsApp y su Lista de Precios asignada
 */
router.get('/crm/clientes', async (req, res) => {
    try {
        await asegurarTablasPlantillasCrm();
        const query = `
            SELECT 
                bc.id,
                bc.cliente_nombre,
                bc.razon_social,
                bc.codigo_bunker_cliente,
                bc.whatsapp_facturas,
                bc.lomas_soft_id,
                EXISTS (
                    SELECT 1
                    FROM public.bunker_cliente_listas_precios bclp
                    WHERE bclp.bunker_cliente_id = bc.id
                ) AS tiene_lista_asignada,
                (
                    SELECT bclp.bunker_lista_precio_id 
                    FROM public.bunker_cliente_listas_precios bclp 
                    WHERE bclp.bunker_cliente_id = bc.id 
                    ORDER BY bclp.id ASC LIMIT 1
                ) AS lista_asignada_id_real,
                COALESCE((
                    SELECT bclp.bunker_lista_precio_id 
                    FROM public.bunker_cliente_listas_precios bclp 
                    WHERE bclp.bunker_cliente_id = bc.id 
                    ORDER BY bclp.id ASC LIMIT 1
                ), 5) AS lista_asignada_id,
                COALESCE((
                    SELECT blp.nombre 
                    FROM public.bunker_cliente_listas_precios bclp 
                    JOIN public.bunker_listas_precios blp ON blp.id = bclp.bunker_lista_precio_id
                    WHERE bclp.bunker_cliente_id = bc.id 
                    ORDER BY bclp.id ASC LIMIT 1
                ), 'Sin lista asignada') AS lista_asignada_nombre
            FROM public.bunker_clientes bc
            ORDER BY bc.cliente_nombre ASC
        `;
        const result = await pool.query(query);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error al listar clientes:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/crm/catalogo-dinamico
 * Retorna el catálogo comercial de Búnker con stock físico consolidado y precios por lista
 * para alimentar el Armador Dinámico de Ofertas en el Programador WA.
 */
router.get('/crm/catalogo-dinamico', async (req, res) => {
    try {
        await asegurarTablasPlantillasCrm();

        const [resArt, resPrecios, resListas, resMixComp] = await Promise.all([
            pool.query(`
                SELECT 
                    ba.articulo_id,
                    ba.descripcion,
                    ba.descripcion_generada,
                    COALESCE(NULLIF(TRIM(ba.codigo_barras::text), ''), NULLIF(TRIM(a.codigo_barras::text), '')) AS codigo_barras,
                    COALESCE(ba.kilos_unidad, 1) AS kilos_unidad,
                    ba.familia_id,
                    COALESCE(bf.nombre, 'General') AS familia_nombre,
                    ba.rubro,
                    ba.sub_rubro,
                    COALESCE(ba.es_pack, false) AS es_pack,
                    COALESCE(ba.pack_unidades, 1) AS pack_unidades,
                    ba.pack_hijo_codigo,
                    COALESCE(ba.no_producido_por_lambda, false) AS no_producido_por_lambda,
                    COALESCE(ba.expresado_en_gramos, false) AS expresado_en_gramos,
                    COALESCE(ba.expresado_en_unidades, false) AS expresado_en_unidades,
                    ba.propiedades_dinamicas,
                    COALESCE((SELECT COUNT(*) FROM public.recetas r WHERE r.articulo_numero = ba.articulo_id), 0) AS total_recetas,
                    CASE
                        WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL)
                             AND COALESCE(ba.pack_unidades, 1) > 1
                        THEN COALESCE(src.stock_consolidado, 0) + FLOOR(COALESCE(src_hijo.stock_consolidado, 0) / COALESCE(ba.pack_unidades, 1))
                        ELSE COALESCE(src.stock_consolidado, 0)
                    END AS stock_real
                FROM public.bunker_articulos ba
                LEFT JOIN public.articulos a ON LOWER(TRIM(a.numero::text)) = LOWER(TRIM(ba.articulo_id::text))
                LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
                LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
                LEFT JOIN public.stock_real_consolidado src_hijo ON src_hijo.articulo_numero = ba.pack_hijo_codigo
                WHERE COALESCE(bf.nombre, '') NOT ILIKE 'Produccion'
                  AND COALESCE(bf.nombre, '') NOT ILIKE 'Insumos'
                  AND COALESCE(ba.descripcion_generada, ba.descripcion, '') NOT ILIKE 'PROD AP%'
                  AND COALESCE(ba.descripcion_generada, ba.descripcion, '') NOT ILIKE 'PROD UP%'
                  AND COALESCE(ba.descripcion_generada, ba.descripcion, '') NOT ILIKE 'CARRO MIX%'
                ORDER BY COALESCE(ba.descripcion_generada, ba.descripcion) ASC, ba.kilos_unidad ASC
            `),
            pool.query(`
                SELECT LOWER(TRIM(articulo_numero)) AS art_key, lista_id, ROUND(precio_final) AS precio_final
                FROM public.bunker_lista_articulos
                WHERE COALESCE(disponible, false) = true
                  AND precio_final IS NOT NULL
                  AND precio_final > 0
            `),
            pool.query(`
                SELECT id, nombre, descripcion, activa
                FROM public.bunker_listas_precios
                ORDER BY id ASC
            `),
            pool.query(`
                WITH mix_ingredientes AS (
                    SELECT 
                        m.id AS mix_id,
                        LOWER(TRIM(REGEXP_REPLACE(m.nombre, '\\s*\\((Mix|Simple|MIX)\\)', '', 'gi'))) AS clean_name,
                        STRING_AGG(sub.nombre, ', ' ORDER BY ic.id) AS composicion
                    FROM public.ingrediente_composicion ic
                    JOIN public.ingredientes m ON m.id = ic.mix_id
                    JOIN public.ingredientes sub ON sub.id = ic.ingrediente_id
                    GROUP BY m.id, m.nombre
                )
                SELECT 
                    ba.articulo_id,
                    mi.composicion
                FROM public.bunker_articulos ba
                JOIN public.recetas r ON r.articulo_numero = ba.articulo_id
                JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                JOIN public.ingredientes i ON i.id = ri.ingrediente_id
                JOIN mix_ingredientes mi ON (
                    i.id = mi.mix_id 
                    OR LOWER(TRIM(REGEXP_REPLACE(i.nombre, '\\s*\\((Mix|Simple|MIX)\\)', '', 'gi'))) = mi.clean_name
                )
                GROUP BY ba.articulo_id, mi.composicion
            `).catch(() => ({ rows: [] }))
        ]);

        const mapaMixComp = new Map();
        for (const mc of (resMixComp?.rows || [])) {
            if (mc.articulo_id && mc.composicion) {
                mapaMixComp.set(String(mc.articulo_id).trim().toLowerCase(), mc.composicion);
            }
        }

        const mapaPrecios = new Map();
        for (const p of resPrecios.rows) {
            if (!mapaPrecios.has(p.art_key)) {
                mapaPrecios.set(p.art_key, {});
            }
            mapaPrecios.get(p.art_key)[p.lista_id] = Number(p.precio_final);
        }

        const articulos = resArt.rows.map(r => {
            const key = String(r.articulo_id || '').trim().toLowerCase();
            const nombreVisible = r.descripcion_generada || r.descripcion || r.articulo_id;
            const descLow = String(nombreVisible || '').toLowerCase();
            const props = (r.propiedades_dinamicas && typeof r.propiedades_dinamicas === 'object') ? r.propiedades_dinamicas : {};
            const kilosUnidad = parseFloat(r.kilos_unidad) || 1;
            const packUnidades = Math.max(1, parseInt(r.pack_unidades, 10) || 1);
            const matchComboDesc = nombreVisible.match(/(?<![/\-\d]\s*)\b(\d+)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(g|gr|kg|k)\b/i);
            const esArticuloPadre = Boolean(
                (r.es_pack === true && packUnidades > 1 && kilosUnidad > 0) ||
                (packUnidades > 1 && kilosUnidad > 0) ||
                matchComboDesc
            );
            let kilosFraccion = kilosUnidad;
            if (esArticuloPadre) {
                if (packUnidades > 1 && kilosUnidad > 0) {
                    kilosFraccion = parseFloat((kilosUnidad / packUnidades).toFixed(3));
                } else if (matchComboDesc) {
                    const valNum = parseFloat(String(matchComboDesc[2]).replace(',', '.')) || 1;
                    const uStr = String(matchComboDesc[3] || '').toLowerCase();
                    kilosFraccion = uStr.startsWith('g') ? parseFloat((valNum / 1000).toFixed(3)) : valNum;
                }
            }

            const totalRecetas = parseInt(r.total_recetas, 10) || 0;
            const tienePackHijo = Boolean(r.pack_hijo_codigo && String(r.pack_hijo_codigo).trim() !== '');
            const noProducido = r.no_producido_por_lambda === true;

            let lineaNegocio = 1;
            if (key.startsWith('bf') || key.includes('bfx') || descLow.includes('barrita') || descLow.includes('barr.') || descLow.startsWith('barra ')) {
                lineaNegocio = 5;
            } else if (descLow.includes('granola') || descLow.includes('grana ')) {
                lineaNegocio = 6;
            } else if (key.startsWith('prod up') || key.includes('tostad') || descLow.includes('tostad') || descLow.includes('tost/sal') || descLow.includes('tost/') || props.presentacion_variable_wip) {
                lineaNegocio = 4;
            } else if (descLow.includes('mix') || /^m(?:fs|ct|sp|st|s\d|s[x])/i.test(key)) {
                lineaNegocio = 3;
            } else if (totalRecetas > 0 || (tienePackHijo && !noProducido)) {
                lineaNegocio = 2;
            }

            const ldnNombres = {
                1: 'LDN 1: Bulto Cerrado',
                2: 'LDN 2: Fraccionado',
                3: 'LDN 3: Mixes',
                4: 'LDN 4: UP Tostadero',
                5: 'LDN 5: Barritas',
                6: 'LDN 6: Granolas'
            };

            return {
                articulo_id: r.articulo_id,
                codigo_barras: r.codigo_barras || '',
                descripcion: r.descripcion,
                descripcion_generada: r.descripcion_generada,
                nombre_visible: nombreVisible,
                kilos_unidad: kilosUnidad,
                kilos_fraccion: kilosFraccion,
                es_pack: Boolean(r.es_pack),
                pack_unidades: packUnidades,
                pack_hijo_codigo: r.pack_hijo_codigo || null,
                es_articulo_padre: esArticuloPadre,
                no_producido_por_lambda: noProducido,
                expresado_en_gramos: Boolean(r.expresado_en_gramos),
                expresado_en_unidades: Boolean(r.expresado_en_unidades),
                total_recetas: totalRecetas,
                linea_negocio: lineaNegocio,
                linea_negocio_tag: `LDN ${lineaNegocio}`,
                linea_negocio_nombre: ldnNombres[lineaNegocio] || `LDN ${lineaNegocio}`,
                familia_id: r.familia_id,
                familia_nombre: r.familia_nombre,
                rubro: r.rubro || '',
                sub_rubro: r.sub_rubro || '',
                composicion: mapaMixComp.get(key) || '',
                propiedades_dinamicas: r.propiedades_dinamicas,
                stock_real: Math.max(0, parseFloat(Number(r.stock_real || 0).toFixed(2))),
                precios: mapaPrecios.get(key) || {}
            };
        });

        res.json({
            success: true,
            listas: resListas.rows,
            articulos
        });
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error cargando catálogo dinámico:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/crm/plantillas-wa
 * Lista los perfiles / plantillas comerciales reutilizables
 */
router.get('/crm/plantillas-wa', async (req, res) => {
    try {
        await asegurarTablasPlantillasCrm();
        const result = await pool.query(`
            SELECT * FROM public.crm_plantillas_whatsapp
            ORDER BY id ASC
        `);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error listando plantillas WA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/plantillas-wa
 * Crea o actualiza una plantilla / perfil comercial reutilizable
 */
router.post('/crm/plantillas-wa', async (req, res) => {
    try {
        await asegurarTablasPlantillasCrm();
        const {
            id,
            nombre,
            descripcion = '',
            articulos_codigos = [],
            formato_precio = 'BOLSA',
            descuento_pct = 0,
            saludo_template = '',
            cierre_template = ''
        } = req.body || {};

        if (!nombre || !String(nombre).trim()) {
            return res.status(400).json({ success: false, error: 'El nombre del perfil/plantilla es obligatorio.' });
        }

        const codigosLimpios = Array.isArray(articulos_codigos)
            ? articulos_codigos.map(c => String(c).trim()).filter(Boolean)
            : [];

        if (id) {
            const upd = await pool.query(`
                UPDATE public.crm_plantillas_whatsapp
                SET nombre = $2,
                    descripcion = $3,
                    articulos_codigos = $4,
                    formato_precio = $5,
                    descuento_pct = $6,
                    saludo_template = $7,
                    cierre_template = $8,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *
            `, [
                parseInt(id, 10),
                String(nombre).trim(),
                String(descripcion || '').trim(),
                JSON.stringify(codigosLimpios),
                formato_precio,
                parseFloat(descuento_pct) || 0,
                saludo_template,
                cierre_template
            ]);
            return res.json({ success: true, data: upd.rows[0] });
        } else {
            const ins = await pool.query(`
                INSERT INTO public.crm_plantillas_whatsapp (
                    nombre, descripcion, articulos_codigos, formato_precio, descuento_pct,
                    saludo_template, cierre_template
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `, [
                String(nombre).trim(),
                String(descripcion || '').trim(),
                JSON.stringify(codigosLimpios),
                formato_precio,
                parseFloat(descuento_pct) || 0,
                saludo_template,
                cierre_template
            ]);
            return res.status(201).json({ success: true, data: ins.rows[0] });
        }
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error guardando plantilla WA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/crm/plantillas-wa/:id
 */
router.delete('/crm/plantillas-wa/:id', async (req, res) => {
    try {
        await asegurarTablasPlantillasCrm();
        const id = parseInt(req.params.id, 10);
        await pool.query('DELETE FROM public.crm_plantillas_whatsapp WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/crm/seguimientos/resumen
 * Retorna resumen completo: hoy, proximos y todos los seguimientos
 */
router.get('/crm/seguimientos/resumen', async (req, res) => {
    try {
        await asegurarTablasPlantillasCrm();
        const qHoy = `
            SELECT id, bunker_cliente_id, cliente_nombre, contacto_nombre, telefono_destino,
                   TO_CHAR(fecha_programada, 'YYYY-MM-DD') as fecha_programada,
                   TO_CHAR(hora_programada, 'HH24:MI') as hora_programada,
                   mensajes, nota_interna, estado, enviado_at, created_at,
                   plantilla_id, COALESCE(articulos_codigos, '[]'::jsonb) as articulos_codigos
            FROM public.crm_seguimientos_whatsapp
            WHERE fecha_programada <= CURRENT_DATE AND estado = 'PENDIENTE'
            ORDER BY fecha_programada ASC, hora_programada ASC
        `;
        const qProximos = `
            SELECT id, bunker_cliente_id, cliente_nombre, contacto_nombre, telefono_destino,
                   TO_CHAR(fecha_programada, 'YYYY-MM-DD') as fecha_programada,
                   TO_CHAR(hora_programada, 'HH24:MI') as hora_programada,
                   mensajes, nota_interna, estado, enviado_at, created_at,
                   plantilla_id, COALESCE(articulos_codigos, '[]'::jsonb) as articulos_codigos
            FROM public.crm_seguimientos_whatsapp
            WHERE fecha_programada > CURRENT_DATE AND estado = 'PENDIENTE'
            ORDER BY fecha_programada ASC, hora_programada ASC
        `;
        const qTodos = `
            SELECT id, bunker_cliente_id, cliente_nombre, contacto_nombre, telefono_destino,
                   TO_CHAR(fecha_programada, 'YYYY-MM-DD') as fecha_programada,
                   TO_CHAR(hora_programada, 'HH24:MI') as hora_programada,
                   mensajes, nota_interna, estado, enviado_at, created_at,
                   plantilla_id, COALESCE(articulos_codigos, '[]'::jsonb) as articulos_codigos
            FROM public.crm_seguimientos_whatsapp
            ORDER BY fecha_programada DESC, hora_programada DESC LIMIT 100
        `;
        const [resHoy, resProx, resTodos] = await Promise.all([
            pool.query(qHoy),
            pool.query(qProximos),
            pool.query(qTodos)
        ]);
        res.json({
            success: true,
            hoy: resHoy.rows,
            proximos: resProx.rows,
            todos: resTodos.rows
        });
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error en resumen:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/crm/seguimientos
 * Lista los seguimientos. Si viene ?pendientes_hoy=true filtra por fecha <= CURRENT_DATE y PENDIENTE
 */
router.get('/crm/seguimientos', async (req, res) => {
    try {
        await asegurarTablasPlantillasCrm();
        const { pendientes_hoy } = req.query;
        let query = `
            SELECT id, bunker_cliente_id, cliente_nombre, contacto_nombre, telefono_destino,
                   TO_CHAR(fecha_programada, 'YYYY-MM-DD') as fecha_programada,
                   TO_CHAR(hora_programada, 'HH24:MI') as hora_programada,
                   mensajes, nota_interna, estado, enviado_at, created_at,
                   plantilla_id, COALESCE(articulos_codigos, '[]'::jsonb) as articulos_codigos
            FROM public.crm_seguimientos_whatsapp
        `;

        const params = [];
        if (pendientes_hoy === 'true') {
            query += ` WHERE fecha_programada <= CURRENT_DATE AND estado = 'PENDIENTE'
                       ORDER BY fecha_programada ASC, hora_programada ASC`;
        } else {
            query += ` ORDER BY fecha_programada DESC, hora_programada DESC LIMIT 50`;
        }

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error al consultar seguimientos:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/seguimientos
 * Crea un nuevo seguimiento programado
 */
router.post('/crm/seguimientos', async (req, res) => {
    try {
        await asegurarTablasPlantillasCrm();
        const {
            bunker_cliente_id,
            cliente_nombre,
            contacto_nombre,
            telefono_destino,
            fecha_programada,
            hora_programada,
            mensajes,
            nota_interna,
            plantilla_id = null,
            articulos_codigos = []
        } = req.body;

        if (!cliente_nombre || !telefono_destino || !fecha_programada || !mensajes) {
            return res.status(400).json({
                success: false,
                error: 'Faltan campos obligatorios: cliente_nombre, telefono_destino, fecha_programada, mensajes'
            });
        }

        // Asegurar que mensajes sea un array
        let mensajesArray = Array.isArray(mensajes) ? mensajes : [mensajes];
        mensajesArray = mensajesArray.map(m => String(m).trim()).filter(m => m.length > 0);

        if (mensajesArray.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Debe ingresar al menos un mensaje de WhatsApp'
            });
        }

        const codigosLimpios = Array.isArray(articulos_codigos)
            ? articulos_codigos.map(c => String(c).trim()).filter(Boolean)
            : [];

        const query = `
            INSERT INTO public.crm_seguimientos_whatsapp (
                bunker_cliente_id, cliente_nombre, contacto_nombre, telefono_destino,
                fecha_programada, hora_programada, mensajes, nota_interna, estado,
                plantilla_id, articulos_codigos
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE', $9, $10)
            RETURNING id, cliente_nombre, contacto_nombre, telefono_destino, fecha_programada, hora_programada, mensajes, estado, plantilla_id, articulos_codigos
        `;

        const values = [
            bunker_cliente_id || null,
            cliente_nombre.trim(),
            (contacto_nombre || 'Cliente').trim(),
            telefono_destino.trim(),
            fecha_programada,
            hora_programada || '09:00:00',
            JSON.stringify(mensajesArray),
            nota_interna ? nota_interna.trim() : null,
            plantilla_id ? parseInt(plantilla_id, 10) : null,
            JSON.stringify(codigosLimpios)
        ];

        const result = await pool.query(query, values);
        res.status(201).json({
            success: true,
            message: 'Seguimiento programado con éxito',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error al crear seguimiento:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/crm/seguimientos/:id
 * Actualiza los datos de un seguimiento existente
 */
router.put('/crm/seguimientos/:id', async (req, res) => {
    try {
        await asegurarTablasPlantillasCrm();
        const { id } = req.params;
        const {
            bunker_cliente_id,
            cliente_nombre,
            contacto_nombre,
            telefono_destino,
            fecha_programada,
            hora_programada,
            mensajes,
            nota_interna,
            plantilla_id,
            articulos_codigos
        } = req.body;

        let mensajesArray = undefined;
        if (mensajes !== undefined) {
            mensajesArray = (Array.isArray(mensajes) ? mensajes : [mensajes])
                .map(m => String(m).trim())
                .filter(m => m.length > 0);
        }

        let codigosJson = null;
        if (articulos_codigos !== undefined && Array.isArray(articulos_codigos)) {
            codigosJson = JSON.stringify(articulos_codigos.map(c => String(c).trim()).filter(Boolean));
        }

        const query = `
            UPDATE public.crm_seguimientos_whatsapp
            SET contacto_nombre = COALESCE($2, contacto_nombre),
                telefono_destino = COALESCE($3, telefono_destino),
                fecha_programada = COALESCE($4, fecha_programada),
                hora_programada = COALESCE($5, hora_programada),
                mensajes = COALESCE($6, mensajes),
                nota_interna = COALESCE($7, nota_interna),
                bunker_cliente_id = COALESCE($8, bunker_cliente_id),
                cliente_nombre = COALESCE($9, cliente_nombre),
                plantilla_id = COALESCE($10, plantilla_id),
                articulos_codigos = COALESCE($11, articulos_codigos),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;

        const values = [
            id,
            contacto_nombre,
            telefono_destino,
            fecha_programada,
            hora_programada,
            mensajesArray ? JSON.stringify(mensajesArray) : null,
            nota_interna,
            bunker_cliente_id !== undefined ? (bunker_cliente_id || null) : null,
            cliente_nombre ? String(cliente_nombre).trim() : null,
            plantilla_id !== undefined ? (plantilla_id ? parseInt(plantilla_id, 10) : null) : null,
            codigosJson
        ];

        const result = await pool.query(query, values);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Seguimiento no encontrado' });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error al actualizar seguimiento:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/seguimientos/:id/posponer
 * Pospone la fecha programada en N días
 */
router.post('/crm/seguimientos/:id/posponer', async (req, res) => {
    try {
        const { id } = req.params;
        const dias = parseInt(req.body.dias) || 1;

        const query = `
            UPDATE public.crm_seguimientos_whatsapp
            SET fecha_programada = CURRENT_DATE + ($2 || ' days')::INTERVAL,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;

        const result = await pool.query(query, [id, dias]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Seguimiento no encontrado' });
        }

        res.json({ success: true, message: `Seguimiento pospuesto ${dias} día(s)`, data: result.rows[0] });
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error al posponer seguimiento:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/seguimientos/:id/desestimar
 * Cancela / desestima el recordatorio
 */
router.post('/crm/seguimientos/:id/desestimar', async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            UPDATE public.crm_seguimientos_whatsapp
            SET estado = 'CANCELADO', updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        const result = await pool.query(query, [id]);
        res.json({ success: true, message: 'Seguimiento desestimado', data: result.rows[0] });
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error al desestimar seguimiento:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/seguimientos/:id/enviar
 * Dispara el envío de los mensajes por WhatsApp vía microservicio de facturación (puerto 3004)
 */
router.post('/crm/seguimientos/:id/enviar', async (req, res) => {
    try {
        const { id } = req.params;
        const qGet = 'SELECT * FROM public.crm_seguimientos_whatsapp WHERE id = $1';
        const resGet = await pool.query(qGet, [id]);

        if (resGet.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Seguimiento no encontrado' });
        }

        const seg = resGet.rows[0];
        const tel = seg.telefono_destino;
        let mensajes = seg.mensajes;
        if (typeof mensajes === 'string') {
            try { mensajes = JSON.parse(mensajes); } catch (e) { mensajes = [mensajes]; }
        }
        if (!Array.isArray(mensajes)) mensajes = [mensajes];

        console.log(`📱 [CRM-SEGUIMIENTOS] Despachando ${mensajes.length} mensaje(s) a ${tel} (${seg.contacto_nombre})`);

        // Despachar cada burbuja secuencialmente
        for (let i = 0; i < mensajes.length; i++) {
            const texto = mensajes[i];
            if (!texto || !texto.trim()) continue;

            const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-mensaje', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: tel,
                    mensajeTexto: texto.trim()
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(`Fallo en envío de burbuja ${i + 1}: ${errData.message || response.statusText}`);
            }

            // Si hay más de un mensaje, esperar 1.2 segundos entre burbujas para naturalidad
            if (i < mensajes.length - 1) {
                await sleep(1200);
            }
        }

        // Marcar como ENVIADO en base de datos
        const qUpdate = `
            UPDATE public.crm_seguimientos_whatsapp
            SET estado = 'ENVIADO', enviado_at = NOW(), updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        const resUpdate = await pool.query(qUpdate, [id]);

        res.json({
            success: true,
            message: `Mensaje(s) enviado(s) correctamente a ${seg.contacto_nombre}`,
            data: resUpdate.rows[0]
        });

    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error al enviar WhatsApp:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/seguimientos/:id/enviar-prueba
 * Envía una prueba real de todas las burbujas del seguimiento al número propio del operador (default: 5492216615746)
 * SIN modificar el estado PENDIENTE del seguimiento del cliente.
 */
router.post('/crm/seguimientos/:id/enviar-prueba', async (req, res) => {
    try {
        const { id } = req.params;
        const telPrueba = String(req.body?.telefono_prueba || '5492216615746').replace(/[^0-9]/g, '').trim() || '5492216615746';

        const qGet = 'SELECT * FROM public.crm_seguimientos_whatsapp WHERE id = $1';
        const resGet = await pool.query(qGet, [id]);

        if (resGet.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Seguimiento no encontrado' });
        }

        const seg = resGet.rows[0];
        let mensajes = req.body?.mensajes || seg.mensajes;
        if (typeof mensajes === 'string') {
            try { mensajes = JSON.parse(mensajes); } catch (e) { mensajes = [mensajes]; }
        }
        if (!Array.isArray(mensajes)) mensajes = [mensajes];
        mensajes = mensajes.map(m => String(m || '').trim()).filter(m => m.length > 0);

        if (mensajes.length === 0) {
            return res.status(400).json({ success: false, error: 'El seguimiento no contiene mensajes para probar.' });
        }

        console.log(`🧪 [CRM-SEGUIMIENTOS] Enviando PRUEBA (${mensajes.length} burbuja/s de "${seg.cliente_nombre}") al número propio ${telPrueba}`);

        for (let i = 0; i < mensajes.length; i++) {
            const texto = mensajes[i];
            const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-mensaje', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: telPrueba,
                    mensajeTexto: texto
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(`Fallo en envío de burbuja de prueba #${i + 1}: ${errData.message || response.statusText}`);
            }

            if (i < mensajes.length - 1) {
                await sleep(1200);
            }
        }

        res.json({
            success: true,
            telefono_prueba: telPrueba,
            burbujas_enviadas: mensajes.length,
            message: `Prueba enviada (${mensajes.length} mensaje/s) al ${telPrueba}. El seguimiento de ${seg.cliente_nombre} continúa PENDIENTE.`
        });
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error al enviar prueba WhatsApp:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/seguimientos/enviar-prueba-directa
 * Envía una prueba de burbujas en edición (aún no guardadas o desde cualquier modal) al número propio (default: 5492216615746).
 */
router.post('/crm/seguimientos/enviar-prueba-directa', async (req, res) => {
    try {
        const telPrueba = String(req.body?.telefono_prueba || '5492216615746').replace(/[^0-9]/g, '').trim() || '5492216615746';
        let mensajes = req.body?.mensajes || [];
        if (typeof mensajes === 'string') {
            try { mensajes = JSON.parse(mensajes); } catch (e) { mensajes = [mensajes]; }
        }
        if (!Array.isArray(mensajes)) mensajes = [mensajes];
        mensajes = mensajes.map(m => String(m || '').trim()).filter(m => m.length > 0);

        if (mensajes.length === 0) {
            return res.status(400).json({ success: false, error: 'No hay mensajes escritos para enviar en la prueba.' });
        }

        console.log(`🧪 [CRM-SEGUIMIENTOS] Enviando PRUEBA DIRECTA (${mensajes.length} burbuja/s) al número propio ${telPrueba}`);

        for (let i = 0; i < mensajes.length; i++) {
            const texto = mensajes[i];
            const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-mensaje', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: telPrueba,
                    mensajeTexto: texto
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(`Fallo en envío de burbuja de prueba #${i + 1}: ${errData.message || response.statusText}`);
            }

            if (i < mensajes.length - 1) {
                await sleep(1200);
            }
        }

        res.json({
            success: true,
            telefono_prueba: telPrueba,
            burbujas_enviadas: mensajes.length,
            message: `Prueba enviada (${mensajes.length} mensaje/s) al ${telPrueba}.`
        });
    } catch (error) {
        console.error('❌ [CRM-SEGUIMIENTOS] Error al enviar prueba directa WhatsApp:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
