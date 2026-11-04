'use strict';

/**
 * FotosLotesService
 * Gestión de Inspección Visual de Partidas por Lote (Depósito Móvil -> Portal B2B)
 * - Alcance por defecto: Exclusivo al artículo de Línea 1 (Bulto Cerrado / Caja Madre).
 * - Alcance opcional: Extensión explícita a fracciones derivadas de Línea 2 (Mono-Ingrediente).
 * - Caducidad dinámica: Baja automática al agotarse físicamente el lote o al vincularse una partida nueva.
 */

class FotosLotesService {
    static BUCKET_NAME = 'b2b_lotes_fotos';
    static schemaReady = false;

    static getSupabaseConfig() {
        return {
            url: process.env.SUPABASE_B2B_URL,
            key: process.env.SUPABASE_B2B_SERVICE_KEY
        };
    }

    /**
     * Asegura de forma idempotente que la tabla exista en la base de datos local activa.
     */
    static async asegurarEsquema(db) {
        if (this.schemaReady) return;
        const sql = `
            CREATE TABLE IF NOT EXISTS public.bunker_articulos_fotos_lote (
                id SERIAL PRIMARY KEY,
                articulo_id VARCHAR(100) NOT NULL UNIQUE,
                vinculo_lote_id VARCHAR(150) DEFAULT NULL,
                lote_id_supabase VARCHAR(150) DEFAULT NULL,
                lote_codigo_corto VARCHAR(50) DEFAULT NULL,
                imagenes JSONB NOT NULL DEFAULT '[]'::jsonb,
                observacion_tecnica VARCHAR(300) DEFAULT NULL,
                extender_a_derivados BOOLEAN NOT NULL DEFAULT FALSE,
                derivados_seleccionados JSONB DEFAULT NULL,
                es_permanente BOOLEAN NOT NULL DEFAULT FALSE,
                activo BOOLEAN NOT NULL DEFAULT TRUE,
                motivo_baja VARCHAR(100) DEFAULT NULL,
                usuario_captura TEXT DEFAULT 'depósito',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            ALTER TABLE public.bunker_articulos_fotos_lote
                ALTER COLUMN vinculo_lote_id TYPE VARCHAR(150) USING vinculo_lote_id::text;
            ALTER TABLE public.bunker_articulos_fotos_lote
                ADD COLUMN IF NOT EXISTS derivados_seleccionados JSONB DEFAULT NULL;
            ALTER TABLE public.bunker_articulos_fotos_lote
                ALTER COLUMN usuario_captura TYPE TEXT;
            CREATE INDEX IF NOT EXISTS idx_bunker_fotos_lote_articulo_activo
            ON public.bunker_articulos_fotos_lote (articulo_id, activo);

            CREATE OR REPLACE FUNCTION public.fn_bunker_fotos_lote_before()
            RETURNS TRIGGER AS $fn$
            DECLARE
                v_raw TEXT;
                v_pos INT;
                v_user TEXT;
                v_json_str TEXT;
            BEGIN
                v_raw := COALESCE(NEW.usuario_captura, '');
                v_pos := strpos(v_raw, '||DERIV:');
                IF v_pos > 0 THEN
                    v_user := substring(v_raw from 1 for v_pos - 1);
                    v_json_str := substring(v_raw from v_pos + 8);
                    NEW.usuario_captura := v_user;
                    BEGIN
                        NEW.derivados_seleccionados := v_json_str::jsonb;
                    EXCEPTION WHEN OTHERS THEN
                        NEW.derivados_seleccionados := '[]'::jsonb;
                    END;
                ELSIF NEW.imagenes IS NOT NULL
                      AND jsonb_typeof(NEW.imagenes) = 'array'
                      AND jsonb_array_length(NEW.imagenes) > 0
                      AND (NEW.imagenes->0) ? 'derivados_seleccionados'
                THEN
                    NEW.derivados_seleccionados := NEW.imagenes->0->'derivados_seleccionados';
                END IF;

                IF NEW.imagenes IS NOT NULL AND jsonb_typeof(NEW.imagenes) = 'array' AND jsonb_array_length(NEW.imagenes) > 0 THEN
                    IF NEW.derivados_seleccionados IS NOT NULL THEN
                        NEW.imagenes := jsonb_set(
                            NEW.imagenes,
                            '{0,derivados_seleccionados}',
                            NEW.derivados_seleccionados,
                            true
                        );
                    END IF;
                END IF;

                -- Barrera protectora para Artículos Padre (Packs) y Fracciones con respaldo de hijo o receta/madre:
                -- 1) En INSERT/UPDATE activo: si el artículo no acumula stock_consolidado directo (ej. Pack Padre cuyo stock vive en el hijo),
                --    proteger con es_permanente = true para que ningún proceso legado elimine sus archivos de Supabase Storage.
                IF NEW.activo = true AND COALESCE(NEW.es_permanente, false) = false THEN
                    IF EXISTS (
                        SELECT 1
                        FROM public.bunker_articulos ba
                        LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
                        WHERE ba.articulo_id = NEW.articulo_id
                          AND (
                              COALESCE(ba.es_pack, src.es_pack, false) = true
                              OR COALESCE(src.stock_consolidado, 0) <= 0
                          )
                    ) THEN
                        NEW.es_permanente := true;
                    END IF;
                END IF;

                -- 2) Evita bajas falsas por STOCK_FISICO_AGOTADO cuando el stock físico vive en el artículo hijo o bulto madre.
                IF TG_OP = 'UPDATE'
                   AND OLD.activo = true
                   AND NEW.activo = false
                   AND COALESCE(NEW.motivo_baja, '') = 'STOCK_FISICO_AGOTADO'
                THEN
                    IF EXISTS (
                        SELECT 1
                        FROM public.bunker_articulos ba
                        LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
                        LEFT JOIN public.stock_real_consolidado src_hijo ON src_hijo.articulo_numero = COALESCE(ba.pack_hijo_codigo, src.pack_hijo_codigo)
                        WHERE ba.articulo_id = OLD.articulo_id
                          AND (
                              COALESCE(src.stock_consolidado, 0) > 0
                              OR (
                                  COALESCE(ba.es_pack, src.es_pack, false) = true
                                  AND COALESCE(src_hijo.stock_consolidado, 0) >= GREATEST(1, COALESCE(ba.pack_unidades, src.pack_unidades, 1))
                              )
                              OR EXISTS (
                                  SELECT 1
                                  FROM public.recetas r
                                  JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                                  JOIN public.ingredientes i ON i.id = ri.ingrediente_id
                                  LEFT JOIN public.stock_real_consolidado src_madre ON src_madre.articulo_numero = i.articulo_vinculado_numero
                                  WHERE r.articulo_numero IN (OLD.articulo_id, COALESCE(ba.pack_hijo_codigo, src.pack_hijo_codigo, ''))
                                    AND COALESCE(i.es_insumo, false) = false
                                    AND (
                                        COALESCE(i.stock_actual, 0) > 0
                                        OR COALESCE(src_madre.stock_consolidado, 0) > 0
                                        OR EXISTS (
                                            SELECT 1
                                            FROM public.bunker_lotes_destinos d_ing
                                            WHERE d_ing.tipo_destino = 'INGREDIENTE_PRODUCCION'
                                              AND d_ing.destino_id = i.id::text
                                              AND (COALESCE(d_ing.cantidad_asignada, 0) - COALESCE(d_ing.cantidad_abierta, 0)) > 0
                                        )
                                    )
                              )
                          )
                    ) THEN
                        NEW.activo := true;
                        NEW.motivo_baja := NULL;
                        NEW.imagenes := OLD.imagenes;
                    END IF;
                END IF;

                RETURN NEW;
            END;
            $fn$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trg_bunker_fotos_lote_before ON public.bunker_articulos_fotos_lote;
            CREATE TRIGGER trg_bunker_fotos_lote_before
                BEFORE INSERT OR UPDATE ON public.bunker_articulos_fotos_lote
                FOR EACH ROW
                EXECUTE FUNCTION public.fn_bunker_fotos_lote_before();

            CREATE OR REPLACE FUNCTION public.fn_bunker_fotos_lote_after()
            RETURNS TRIGGER AS $fn$
            DECLARE
                v_sku_deriv TEXT;
                v_child_imgs JSONB;
                v_madre_desc TEXT;
            BEGIN
                IF pg_trigger_depth() > 1 THEN
                    RETURN NEW;
                END IF;

                IF COALESCE(NEW.motivo_baja, '') LIKE 'HEREDADO_MADRE:%' THEN
                    RETURN NEW;
                END IF;

                -- 1. Desactivar cualquier fila heredada previa de esta madre
                UPDATE public.bunker_articulos_fotos_lote
                SET imagenes = '[]'::jsonb,
                    activo = false,
                    updated_at = NOW()
                WHERE motivo_baja = 'HEREDADO_MADRE:' || NEW.articulo_id;

                -- 2. Propagar a los derivados/presentaciones elegidos en derivados_seleccionados
                IF NEW.activo = true
                   AND NEW.derivados_seleccionados IS NOT NULL
                   AND jsonb_typeof(NEW.derivados_seleccionados) = 'array'
                   AND jsonb_array_length(NEW.derivados_seleccionados) > 0
                   AND jsonb_typeof(NEW.imagenes) = 'array'
                   AND jsonb_array_length(NEW.imagenes) > 0
                THEN
                    SELECT COALESCE(ba.descripcion_generada, ba.descripcion, NEW.articulo_id)
                    INTO v_madre_desc
                    FROM public.bunker_articulos ba
                    WHERE ba.articulo_id = NEW.articulo_id
                    LIMIT 1;

                    v_child_imgs := jsonb_set(
                        jsonb_set(
                            jsonb_set(
                                NEW.imagenes,
                                '{0,es_heredado_madre}',
                                'true'::jsonb,
                                true
                            ),
                            '{0,articulo_madre_nombre}',
                            to_jsonb(COALESCE(v_madre_desc, NEW.articulo_id)),
                            true
                        ),
                        '{0,id}',
                        to_jsonb('HEREDADO_MADRE:' || COALESCE(v_madre_desc, NEW.articulo_id) || '::' || COALESCE(NEW.imagenes->0->>'id', '1')),
                        true
                    );

                    FOR v_sku_deriv IN SELECT jsonb_array_elements_text(NEW.derivados_seleccionados)
                    LOOP
                        IF v_sku_deriv IS NOT NULL AND TRIM(v_sku_deriv) <> '' AND TRIM(v_sku_deriv) <> NEW.articulo_id THEN
                            INSERT INTO public.bunker_articulos_fotos_lote (
                                articulo_id,
                                vinculo_lote_id,
                                lote_id_supabase,
                                lote_codigo_corto,
                                imagenes,
                                observacion_tecnica,
                                extender_a_derivados,
                                es_permanente,
                                activo,
                                motivo_baja,
                                usuario_captura,
                                created_at,
                                updated_at
                            ) VALUES (
                                TRIM(v_sku_deriv),
                                NEW.vinculo_lote_id,
                                NEW.lote_id_supabase,
                                NEW.lote_codigo_corto,
                                v_child_imgs,
                                NEW.observacion_tecnica,
                                false,
                                true,
                                true,
                                'HEREDADO_MADRE:' || NEW.articulo_id,
                                NEW.usuario_captura,
                                NOW(),
                                NOW()
                            )
                            ON CONFLICT (articulo_id)
                            DO UPDATE SET
                                vinculo_lote_id = EXCLUDED.vinculo_lote_id,
                                lote_id_supabase = EXCLUDED.lote_id_supabase,
                                lote_codigo_corto = EXCLUDED.lote_codigo_corto,
                                imagenes = EXCLUDED.imagenes,
                                observacion_tecnica = EXCLUDED.observacion_tecnica,
                                extender_a_derivados = false,
                                es_permanente = true,
                                activo = true,
                                motivo_baja = EXCLUDED.motivo_baja,
                                usuario_captura = EXCLUDED.usuario_captura,
                                updated_at = NOW()
                            WHERE public.bunker_articulos_fotos_lote.activo = false
                               OR COALESCE(public.bunker_articulos_fotos_lote.motivo_baja, '') LIKE 'HEREDADO_MADRE:%';
                        END IF;
                    END LOOP;
                END IF;

                RETURN NEW;
            END;
            $fn$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trg_bunker_fotos_lote_after ON public.bunker_articulos_fotos_lote;
            CREATE TRIGGER trg_bunker_fotos_lote_after
                AFTER INSERT OR UPDATE ON public.bunker_articulos_fotos_lote
                FOR EACH ROW
                EXECUTE FUNCTION public.fn_bunker_fotos_lote_after();
        `;
        await db.query(sql);
        this.schemaReady = true;
    }

    /**
     * Asegura que el bucket público exista en Supabase Storage.
     */
    static async asegurarBucketStorage() {
        const { url, key } = this.getSupabaseConfig();
        if (!url || !key) return false;

        try {
            const checkRes = await fetch(`${url}/storage/v1/bucket/${this.BUCKET_NAME}`, {
                method: 'GET',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`
                }
            });
            if (checkRes.ok) return true;

            const createRes = await fetch(`${url}/storage/v1/bucket`, {
                method: 'POST',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id: this.BUCKET_NAME,
                    name: this.BUCKET_NAME,
                    public: true
                })
            });
            return createRes.ok;
        } catch (err) {
            console.warn('⚠️ [FOTOS-LOTES] Advertencia verificando bucket Storage:', err.message);
            return false;
        }
    }

    /**
     * Construye el mapa determinista de Derivados de Línea 2 (Fracciones mono-ingrediente 100% puras,
     * Presentaciones Hermanas vinculadas por un mismo Artículo Puente AP / Ingrediente Único, y Packs Padre/Hijo).
     */
    static async obtenerMapaDerivadosLinea2(db) {
        // 1. Resolver vínculo entre Ingrediente y su Artículo Búnker Madre (Línea 1) o Artículo Puente (AP)
        const ingRes = await db.query(`
            SELECT 
                i.id AS ingrediente_id,
                i.nombre AS ingrediente_nombre,
                COALESCE(
                    i.articulo_vinculado_numero,
                    (
                        SELECT d.destino_id
                        FROM public.bunker_lotes_destinos d
                        WHERE d.tipo_destino = 'ARTICULO_BUNKER'
                          AND d.vinculo_id IN (
                              SELECT d2.vinculo_id 
                              FROM public.bunker_lotes_destinos d2 
                              WHERE d2.tipo_destino = 'INGREDIENTE_PRODUCCION' AND d2.destino_id = i.id::text
                          )
                        ORDER BY d.id DESC
                        LIMIT 1
                    ),
                    (
                        SELECT svm.articulo_numero
                        FROM public.stock_ventas_movimientos svm
                        JOIN public.ingredientes_movimientos im 
                          ON substring(svm.observaciones from 'UUID: ([a-f0-9\\-]+)') = substring(im.observaciones from 'UUID: ([a-f0-9\\-]+)')
                         AND substring(svm.observaciones from 'UUID: ([a-f0-9\\-]+)') IS NOT NULL
                        WHERE im.ingrediente_id = i.id
                          AND svm.articulo_numero IS NOT NULL
                          AND EXISTS (SELECT 1 FROM public.bunker_articulos ba2 WHERE ba2.articulo_id = svm.articulo_numero)
                        ORDER BY svm.fecha DESC
                        LIMIT 1
                    )
                ) AS sku_madre
            FROM public.ingredientes i
            WHERE COALESCE(i.es_insumo, false) = false
        `);

        const ingToMadre = new Map();
        const ingNombreMap = new Map();
        for (const r of ingRes.rows) {
            const ingId = Number(r.ingrediente_id);
            ingNombreMap.set(ingId, String(r.ingrediente_nombre || '').trim());
            if (r.sku_madre) {
                ingToMadre.set(ingId, String(r.sku_madre).trim());
            }
        }

        // 1b. Detectar cuáles artículos en bunker_articulos son Artículos Puente (AP) o Unidades Productivas internas (UP)
        const metaArtRes = await db.query(`
            SELECT 
                ba.articulo_id,
                COALESCE(ba.descripcion_generada, ba.descripcion, ba.articulo_id) AS descripcion,
                COALESCE(ba.kilos_unidad, 1.0) AS kilos_unidad
            FROM public.bunker_articulos ba
        `);
        const metaArtMap = new Map();
        const skusPuenteInterno = new Set();
        for (const m of metaArtRes.rows) {
            const cod = String(m.articulo_id).trim();
            const desc = String(m.descripcion || cod).trim();
            metaArtMap.set(cod, {
                articulo_id: cod,
                descripcion: desc,
                nomenclatura: desc,
                kilos_unidad: parseFloat(m.kilos_unidad || 1.0)
            });
            if (/^PROD\s+(AP|UP)\b/i.test(desc)) {
                skusPuenteInterno.add(cod);
            }
        }

        // 2. Obtener todas las recetas con sus ingredientes alimenticios (excluyendo bolsas/empaques)
        const recRes = await db.query(`
            SELECT 
                r.articulo_numero,
                COALESCE(ba.descripcion_generada, ba.descripcion, r.articulo_numero) AS descripcion,
                COALESCE(ba.kilos_unidad, 1.0) AS kilos_unidad,
                ri.ingrediente_id,
                ri.unidad_medida,
                COALESCE(i.es_insumo, false) AS es_insumo
            FROM public.recetas r
            JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
            LEFT JOIN public.ingredientes i ON i.id = ri.ingrediente_id
            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = r.articulo_numero
            WHERE ri.ingrediente_id IS NOT NULL
        `);

        const recetasAlimentoPorArt = new Map();
        const articulosConReceta = new Set();

        for (const r of recRes.rows) {
            const artCod = String(r.articulo_numero || '').trim();
            if (!artCod) continue;
            const esEmpaque = r.es_insumo === true || String(r.unidad_medida || '').trim().toLowerCase() === 'unidades';
            if (!esEmpaque) {
                articulosConReceta.add(artCod);
                if (!recetasAlimentoPorArt.has(artCod)) {
                    recetasAlimentoPorArt.set(artCod, {
                        articulo_id: artCod,
                        descripcion: r.descripcion,
                        nomenclatura: r.descripcion,
                        kilos_unidad: parseFloat(r.kilos_unidad || 1.0),
                        ingredientes_ids: []
                    });
                }
                recetasAlimentoPorArt.get(artCod).ingredientes_ids.push(Number(r.ingrediente_id));
            }
        }

        // Mapa: sku_origen -> Array de fracciones / presentaciones hermanas / packs
        const derivadosPorMadre = new Map();
        const agregarDerivado = (skuMadre, derivadoObj) => {
            const key = String(skuMadre).trim();
            if (!key || key === derivadoObj.articulo_id) return;
            // Nunca ofrecer como derivado comercial un artículo puente interno (PROD AP / PROD UP)
            if (skusPuenteInterno.has(derivadoObj.articulo_id)) return;
            if (!derivadosPorMadre.has(key)) derivadosPorMadre.set(key, []);
            const lista = derivadosPorMadre.get(key);
            if (!lista.some(d => d.articulo_id === derivadoObj.articulo_id)) {
                lista.push({
                    ...derivadoObj,
                    nomenclatura: derivadoObj.nomenclatura || derivadoObj.descripcion
                });
            }
        };

        // Agrupador por ingrediente único (para vincular presentaciones hermanas de un mismo Artículo Puente AP o de un mismo ingrediente)
        const grupoPorIngredienteUnico = new Map();
        const puentePorArticulo = new Map();

        for (const [artCod, info] of recetasAlimentoPorArt.entries()) {
            if (skusPuenteInterno.has(artCod)) continue;
            const uniqueIngs = [...new Set(info.ingredientes_ids)];
            if (uniqueIngs.length === 1) {
                const ingId = uniqueIngs[0];
                const skuMadre = ingToMadre.get(ingId) || null;

                if (!grupoPorIngredienteUnico.has(ingId)) {
                    grupoPorIngredienteUnico.set(ingId, []);
                }
                grupoPorIngredienteUnico.get(ingId).push({
                    articulo_id: artCod,
                    descripcion: info.descripcion,
                    nomenclatura: info.descripcion,
                    kilos_unidad: info.kilos_unidad,
                    tipo_derivado: 'FRACCION_LINEA_2'
                });

                if (skuMadre && skuMadre !== artCod) {
                    agregarDerivado(skuMadre, {
                        articulo_id: artCod,
                        descripcion: info.descripcion,
                        nomenclatura: info.descripcion,
                        kilos_unidad: info.kilos_unidad,
                        tipo_derivado: 'FRACCION_LINEA_2'
                    });

                    const metaMadre = metaArtMap.get(skuMadre);
                    puentePorArticulo.set(artCod, {
                        articulo_id: skuMadre,
                        descripcion: metaMadre ? metaMadre.descripcion : (ingNombreMap.get(ingId) || skuMadre),
                        es_articulo_puente: skusPuenteInterno.has(skuMadre)
                    });
                } else if (!skuMadre) {
                    puentePorArticulo.set(artCod, {
                        articulo_id: `ING-${ingId}`,
                        descripcion: ingNombreMap.get(ingId) || 'Ingrediente Común',
                        es_articulo_puente: true
                    });
                }
            }
        }

        // 3. Incorporar Packs Comerciales vinculados (Padre/Hijo) de Línea 1, de Artículos Puente o de sus Fracciones
        const packsRes = await db.query(`
            SELECT 
                ba.articulo_id,
                COALESCE(ba.descripcion_generada, ba.descripcion, src.descripcion, ba.articulo_id) AS descripcion,
                COALESCE(ba.kilos_unidad, src.kilos_unidad, 1.0) AS kilos_unidad,
                COALESCE(ba.pack_hijo_codigo, src.pack_hijo_codigo) AS pack_hijo_codigo,
                COALESCE(ba.pack_unidades, src.pack_unidades, 1) AS pack_unidades
            FROM public.bunker_articulos ba
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
            WHERE (COALESCE(ba.es_pack, false) = true OR COALESCE(src.es_pack, false) = true)
              AND COALESCE(ba.pack_hijo_codigo, src.pack_hijo_codigo) IS NOT NULL
        `);

        for (const p of packsRes.rows) {
            const packCod = String(p.articulo_id).trim();
            const hijoCod = String(p.pack_hijo_codigo).trim();
            if (skusPuenteInterno.has(packCod)) continue;

            const packObj = {
                articulo_id: packCod,
                descripcion: p.descripcion,
                nomenclatura: p.descripcion,
                kilos_unidad: parseFloat(p.kilos_unidad || 1.0),
                tipo_derivado: 'PACK_COMERCIAL'
            };

            // Vinculación bidireccional Padre (Pack) <-> Hijo directo (ej: 10x300g <-> 300g)
            agregarDerivado(hijoCod, packObj);
            const metaHijo = metaArtMap.get(hijoCod);
            if (metaHijo) {
                agregarDerivado(packCod, {
                    articulo_id: hijoCod,
                    descripcion: metaHijo.descripcion,
                    nomenclatura: metaHijo.descripcion,
                    kilos_unidad: metaHijo.kilos_unidad,
                    tipo_derivado: 'FRACCION_HIJA_PACK'
                });
            }

            // Si el hijo pertenece a una Madre o Artículo Puente (AP), sumar el Pack a toda esa familia
            for (const [skuMadre, listaDeriv] of derivadosPorMadre.entries()) {
                if (listaDeriv.some(d => d.articulo_id === hijoCod)) {
                    agregarDerivado(skuMadre, {
                        ...packObj,
                        tipo_derivado: 'PACK_FRACCION_L2'
                    });
                }
            }
            for (const [ingId, miembros] of grupoPorIngredienteUnico.entries()) {
                if (miembros.some(m => m.articulo_id === hijoCod) && !miembros.some(m => m.articulo_id === packCod)) {
                    miembros.push({
                        ...packObj,
                        tipo_derivado: 'PACK_FRACCION_L2'
                    });
                    if (puentePorArticulo.has(hijoCod) && !puentePorArticulo.has(packCod)) {
                        puentePorArticulo.set(packCod, puentePorArticulo.get(hijoCod));
                    }
                }
            }
        }

        // 4. Vincular entre sí todas las presentaciones hermanas que comparten un mismo Artículo Puente (AP),
        //    una misma Madre de Línea 1 o un mismo Ingrediente Único (ej: Mix Premium 5kg <-> 2kg <-> 1kg <-> 300g <-> 10x300g)
        for (const [ingId, miembros] of grupoPorIngredienteUnico.entries()) {
            const skuMadre = ingToMadre.get(ingId) || null;
            const metaMadre = (skuMadre && !skusPuenteInterno.has(skuMadre)) ? metaArtMap.get(skuMadre) : null;

            const todosLosMiembros = [...miembros];
            if (metaMadre && !todosLosMiembros.some(m => m.articulo_id === metaMadre.articulo_id)) {
                todosLosMiembros.unshift({
                    articulo_id: metaMadre.articulo_id,
                    descripcion: metaMadre.descripcion,
                    nomenclatura: metaMadre.descripcion,
                    kilos_unidad: metaMadre.kilos_unidad,
                    tipo_derivado: 'BULTO_MADRE_L1'
                });
            }

            if (todosLosMiembros.length > 1) {
                for (const origen of todosLosMiembros) {
                    for (const hermano of todosLosMiembros) {
                        if (origen.articulo_id !== hermano.articulo_id) {
                            agregarDerivado(origen.articulo_id, hermano);
                        }
                    }
                }
            }
        }

        return { derivadosPorMadre, articulosConReceta, ingToMadre, puentePorArticulo, skusPuenteInterno };
    }

    /**
     * Obtiene el listado completo de artículos para la App Móvil del Depósito,
     * priorizando Línea de Negocio 1 (Bultos Cerrados Directos / Cajas Madre) y Presentaciones de Artículos Puente (AP) con su lote y stock.
     */
    static async listarArticulosDeposito(db) {
        await this.asegurarEsquema(db);

        const { derivadosPorMadre, articulosConReceta, ingToMadre, puentePorArticulo, skusPuenteInterno } = await this.obtenerMapaDerivadosLinea2(db);
        const skusMadreDeIngredientes = new Set(ingToMadre.values());

        // Todos los lotes vinculados por artículo (el más reciente es ultimo_lote, y el resto permite escanear cualquier etiqueta de lote en depósito)
        const lotesRes = await db.query(`
            SELECT
                sku_destino,
                v.id AS vinculo_id,
                v.lote_id_supabase,
                v.lote_codigo_corto,
                v.proveedor_nombre,
                v.numero_remito,
                d.cantidad_asignada,
                d.kilos_asignados
            FROM (
                SELECT 
                    d1.vinculo_id,
                    d1.id AS destino_row_id,
                    d1.cantidad_asignada,
                    d1.kilos_asignados,
                    CASE 
                        WHEN d1.tipo_destino = 'ARTICULO_BUNKER' THEN d1.destino_id
                        WHEN d1.tipo_destino = 'INGREDIENTE_PRODUCCION' THEN i.articulo_vinculado_numero
                        ELSE NULL
                    END AS sku_destino
                FROM public.bunker_lotes_destinos d1
                LEFT JOIN public.ingredientes i 
                  ON d1.tipo_destino = 'INGREDIENTE_PRODUCCION' AND d1.destino_id = i.id::text
            ) d
            JOIN public.bunker_lotes_vinculos v ON v.id = d.vinculo_id
            WHERE d.sku_destino IS NOT NULL
            ORDER BY sku_destino, d.destino_row_id DESC
        `);

        const ultimoLoteMap = new Map();
        const lotesPorArticuloMap = new Map();
        for (const r of lotesRes.rows) {
            const skuKey = String(r.sku_destino).trim();
            const loteObj = {
                vinculo_id: r.vinculo_id,
                lote_id_supabase: r.lote_id_supabase,
                lote_codigo_corto: r.lote_codigo_corto,
                proveedor_nombre: r.proveedor_nombre,
                numero_remito: r.numero_remito,
                cantidad_asignada: parseFloat(r.cantidad_asignada || 0),
                kilos_asignados: parseFloat(r.kilos_asignados || 0)
            };
            if (!ultimoLoteMap.has(skuKey)) {
                ultimoLoteMap.set(skuKey, loteObj);
            }
            if (!lotesPorArticuloMap.has(skuKey)) {
                lotesPorArticuloMap.set(skuKey, []);
            }
            const arr = lotesPorArticuloMap.get(skuKey);
            const codeKey = loteObj.lote_codigo_corto || loteObj.lote_id_supabase || loteObj.vinculo_id;
            if (arr.length < 15 && !arr.some(x => (x.lote_codigo_corto || x.lote_id_supabase || x.vinculo_id) === codeKey)) {
                arr.push(loteObj);
            }
        }

        // Códigos de barras de ingredientes vinculados a artículos de Línea 1 (para lectura de etiquetas de INGREDIENTE DE PRODUCCION)
        const codigosIngRes = await db.query(`
            SELECT articulo_vinculado_numero AS sku, codigo::text AS codigo_ingrediente
            FROM public.ingredientes
            WHERE articulo_vinculado_numero IS NOT NULL AND codigo IS NOT NULL
        `).catch(() => ({ rows: [] }));
        const codigosIngMap = new Map();
        for (const r of codigosIngRes.rows) {
            const skuKey = String(r.sku || '').trim();
            const codIng = String(r.codigo_ingrediente || '').trim();
            if (!skuKey || !codIng) continue;
            if (!codigosIngMap.has(skuKey)) codigosIngMap.set(skuKey, []);
            codigosIngMap.get(skuKey).push(codIng);
        }

        // Bultos cerrados en taller por ingrediente vinculado
        const bultosIngRes = await db.query(`
            SELECT 
                i.articulo_vinculado_numero AS sku,
                SUM(GREATEST(0, COALESCE(d.cantidad_asignada, 0) - COALESCE(d.cantidad_abierta, 0))) AS cajas_cerradas_taller
            FROM public.bunker_lotes_destinos d
            JOIN public.ingredientes i ON d.tipo_destino = 'INGREDIENTE_PRODUCCION' AND d.destino_id = i.id::text
            WHERE i.articulo_vinculado_numero IS NOT NULL
              AND (COALESCE(d.cantidad_asignada, 0) - COALESCE(d.cantidad_abierta, 0)) > 0
            GROUP BY i.articulo_vinculado_numero
        `);
        const cajasTallerMap = new Map();
        for (const r of bultosIngRes.rows) {
            if (r.sku) cajasTallerMap.set(String(r.sku).trim(), parseFloat(r.cajas_cerradas_taller || 0));
        }

        // Fotos activas en bunker_articulos_fotos_lote
        const fotosRes = await db.query(`
            SELECT *
            FROM public.bunker_articulos_fotos_lote
            WHERE activo = true
        `);
        const fotosMap = new Map();
        for (const f of fotosRes.rows) {
            if (String(f.motivo_baja || '').startsWith('HEREDADO_MADRE:')) continue;
            const imgs = Array.isArray(f.imagenes) ? f.imagenes : [];
            if (imgs.length > 0) {
                const derivSel = Array.isArray(f.derivados_seleccionados)
                    ? f.derivados_seleccionados
                    : (Array.isArray(imgs[0]?.derivados_seleccionados) ? imgs[0].derivados_seleccionados : null);
                fotosMap.set(String(f.articulo_id).trim(), {
                    id: f.id,
                    articulo_id: f.articulo_id,
                    vinculo_lote_id: f.vinculo_lote_id,
                    lote_id_supabase: f.lote_id_supabase,
                    lote_codigo_corto: f.lote_codigo_corto,
                    imagenes: imgs,
                    observacion_tecnica: f.observacion_tecnica || '',
                    extender_a_derivados: Boolean(f.extender_a_derivados),
                    derivados_seleccionados: derivSel,
                    es_permanente: Boolean(f.es_permanente),
                    usuario_captura: f.usuario_captura,
                    updated_at: f.updated_at
                });
            }
        }

        // Artículos con oferta dinámica activa
        const ofertasRes = await db.query(`
            SELECT DISTINCT oa.articulo_numero
            FROM public.bunker_ofertas_articulos oa
            JOIN public.bunker_ofertas_dinamicas od ON od.id = oa.oferta_id
            WHERE od.activo = true AND COALESCE(od.estado, 'ACTIVA') = 'ACTIVA'
        `).catch(() => ({ rows: [] }));
        const enOfertaSet = new Set(ofertasRes.rows.map(r => String(r.articulo_numero).trim()));

        // Cargar configuración activa de Jerarquía B2B (Niveles 3, 4 y 5 desde Gestión Comercial y Financiera -> Portal B2B)
        const jerarquiaRes = await db.query(`
            SELECT familia_id, articulo_principal, eje_nivel_3, reglas_nivel_4, reglas_nivel_5 
            FROM public.bunker_portal_b2b_jerarquia 
            WHERE eje_nivel_3 IS NOT NULL AND TRIM(eje_nivel_3) != ''
        `).catch(() => ({ rows: [] }));

        const jerarquiaMap = new Map();
        for (const jRow of jerarquiaRes.rows) {
            const famId = jRow.familia_id !== null && jRow.familia_id !== undefined ? jRow.familia_id : 0;
            const artP = String(jRow.articulo_principal || '').trim().toLowerCase();
            const rawEjeN3 = jRow.eje_nivel_3 ? String(jRow.eje_nivel_3).trim().toLowerCase() : '';
            const ejesN3 = rawEjeN3 ? rawEjeN3.split(',').map(s => s.trim()).filter(Boolean) : [];
            jerarquiaMap.set(`${famId}___${artP}`, {
                eje_nivel_3: rawEjeN3,
                ejes_nivel_3: ejesN3,
                reglas_nivel_4: jRow.reglas_nivel_4 && typeof jRow.reglas_nivel_4 === 'object' ? jRow.reglas_nivel_4 : {},
                reglas_nivel_5: jRow.reglas_nivel_5 && typeof jRow.reglas_nivel_5 === 'object' ? jRow.reglas_nivel_5 : {}
            });
        }

        // Consulta principal de artículos en Búnker (presentes en al menos una lista disponible o en catálogo general)
        const artRes = await db.query(`
            SELECT 
                ba.articulo_id,
                COALESCE(ba.descripcion_generada, ba.descripcion, src.descripcion, ba.articulo_id) AS descripcion,
                ba.descripcion AS descripcion_corta,
                ba.descripcion_generada,
                COALESCE(ba.kilos_unidad, src.kilos_unidad, 1.0) AS kilos_unidad,
                ba.familia_id,
                bf.nombre AS familia_nombre,
                ba.rubro,
                ba.sub_rubro,
                ba.propiedades_dinamicas,
                COALESCE(ba.es_pack, src.es_pack, false) AS es_pack,
                COALESCE(ba.pack_unidades, src.pack_unidades, 1) AS pack_unidades,
                COALESCE(ba.pack_hijo_codigo, src.pack_hijo_codigo) AS pack_hijo_codigo,
                COALESCE(NULLIF(TRIM(ba.codigo_barras), ''), NULLIF(TRIM(src.codigo_barras), '')) AS codigo_barras,
                GREATEST(0, COALESCE(src.stock_consolidado, 0)) AS stock_consolidado,
                EXISTS (
                    SELECT 1 FROM public.bunker_lista_articulos bla 
                    WHERE bla.articulo_numero = ba.articulo_id AND bla.disponible = true AND bla.precio_final > 0
                ) AS publicado_en_listas
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
            ORDER BY COALESCE(ba.descripcion_generada, ba.descripcion, ba.articulo_id) ASC
        `);

        // Mapa de stock físico por artículo para resolver en cascada el stock de Packs Comerciales (Padre -> Hijo)
        const stockConsolidadoPorSku = new Map();
        for (const r of artRes.rows) {
            const k = String(r.articulo_id || '').trim();
            if (k) {
                stockConsolidadoPorSku.set(k, parseFloat(r.stock_consolidado || 0));
            }
        }

        const resultado = [];
        for (const row of artRes.rows) {
            const sku = String(row.articulo_id).trim();
            const tieneRecetaPropia = articulosConReceta.has(sku);
            const esMadreIngrediente = skusMadreDeIngredientes.has(sku);
            const esPack = Boolean(row.es_pack);
            const packUnidades = Math.max(1, parseInt(row.pack_unidades || 1, 10));
            const packHijoCodigo = row.pack_hijo_codigo ? String(row.pack_hijo_codigo).trim() : null;
            const infoPuente = puentePorArticulo.get(sku) || (packHijoCodigo ? puentePorArticulo.get(packHijoCodigo) : null) || null;
            const skuMadreRef = infoPuente && !infoPuente.es_articulo_puente ? String(infoPuente.articulo_id).trim() : null;

            const ultimoLote = ultimoLoteMap.get(sku)
                || (packHijoCodigo ? ultimoLoteMap.get(packHijoCodigo) : null)
                || (skuMadreRef ? ultimoLoteMap.get(skuMadreRef) : null)
                || null;
            const lotesVinculados = (lotesPorArticuloMap.get(sku)?.length ? lotesPorArticuloMap.get(sku) : null)
                || (packHijoCodigo && lotesPorArticuloMap.get(packHijoCodigo)?.length ? lotesPorArticuloMap.get(packHijoCodigo) : null)
                || (skuMadreRef && lotesPorArticuloMap.get(skuMadreRef)?.length ? lotesPorArticuloMap.get(skuMadreRef) : null)
                || [];
            const codigosIngrediente = codigosIngMap.get(sku) || [];
            const codigoBarras = row.codigo_barras ? String(row.codigo_barras).trim() : '';

            // Es Línea de Negocio 1 (Bulto Cerrado Directo / Caja Madre), Pack Padre o Presentación de Artículo Puente (AP)
            const esPresentacionDePuenteAP = Boolean(infoPuente && infoPuente.es_articulo_puente);
            const esLinea1 = (!tieneRecetaPropia || esMadreIngrediente || Boolean(ultimoLote) || esPresentacionDePuenteAP) && !skusPuenteInterno.has(sku);

            const stockDeposito = parseFloat(row.stock_consolidado || 0);
            const stockCajasTaller = cajasTallerMap.get(sku) || 0;
            let stockPacksDesdeHijo = 0;
            if (esPack && packHijoCodigo && packUnidades > 1) {
                const stockHijoFisico = stockConsolidadoPorSku.get(packHijoCodigo) || 0;
                stockPacksDesdeHijo = Math.floor(stockHijoFisico / packUnidades);
            }
            const stockTotalBultos = Math.round((stockDeposito + stockCajasTaller + stockPacksDesdeHijo) * 100) / 100;

            // Extraer artículo principal y valores dinámicos para la Bolsa de Búsqueda Universal LAMDA (Fase 49)
            let props = row.propiedades_dinamicas;
            if (props && typeof props === 'string') {
                try { props = JSON.parse(props); } catch { props = null; }
            }
            let articuloPrincipal = '';
            const dynamicTokens = [];
            if (props && typeof props === 'object') {
                if (props.articulo_principal) {
                    articuloPrincipal = typeof props.articulo_principal === 'object'
                        ? String(props.articulo_principal.valor || '').trim()
                        : String(props.articulo_principal).trim();
                }
                const posObj = props.posiciones || props;
                for (const k of Object.keys(posObj)) {
                    if (k.startsWith('asistente_') || k.startsWith('rendimiento_') || k.startsWith('_meta')) continue;
                    const v = posObj[k];
                    if (v !== null && v !== undefined) {
                        const strVal = typeof v === 'object' ? String(v.valor || '').trim() : String(v).trim();
                        if (strVal) dynamicTokens.push(strVal);
                    }
                }
            }

            const familiaResuelta = (row.familia_nombre && String(row.familia_nombre).trim())
                || (row.rubro && String(row.rubro).trim())
                || 'General';
            const artPrincipalResuelto = articuloPrincipal
                || (row.sub_rubro && String(row.sub_rubro).trim())
                || (row.descripcion && String(row.descripcion).trim())
                || 'General';

            // Resolver Niveles 3, 4 y 5 según Configurador de Jerarquía B2B
            let subCategoria = null;
            let subSubCategoria = null;
            let subSubSubCategoria = null;

            const famId = row.familia_id || 0;
            const jerarquiaKey = `${famId}___${artPrincipalResuelto.toLowerCase()}`;
            const confRule = jerarquiaMap.get(jerarquiaKey) || null;

            if (confRule && props && typeof props === 'object') {
                const posObj = props.posiciones || props;

                // 1. Nivel 3
                const targetEjesN3 = Array.isArray(confRule.ejes_nivel_3) && confRule.ejes_nivel_3.length > 0
                    ? confRule.ejes_nivel_3
                    : (confRule.eje_nivel_3 ? [confRule.eje_nivel_3] : []);

                for (const targetEjeN3 of targetEjesN3) {
                    for (const key in posObj) {
                        if (Object.prototype.hasOwnProperty.call(posObj, key)) {
                            const p = posObj[key];
                            if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === targetEjeN3) {
                                if (p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                                    subCategoria = String(p.valor).trim();
                                    break;
                                }
                            }
                        }
                    }
                    if (subCategoria) break;
                }

                // 2. Nivel 4
                if (subCategoria && confRule.reglas_nivel_4) {
                    const configuredEjeN4 = confRule.reglas_nivel_4[subCategoria] || null;
                    if (configuredEjeN4) {
                        const targetEjesN4 = Array.isArray(configuredEjeN4)
                            ? configuredEjeN4.map(s => String(s).trim().toLowerCase()).filter(Boolean)
                            : String(configuredEjeN4).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

                        for (const targetEjeN4 of targetEjesN4) {
                            for (const key in posObj) {
                                if (Object.prototype.hasOwnProperty.call(posObj, key)) {
                                    const p = posObj[key];
                                    if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === targetEjeN4) {
                                        if (p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                                            subSubCategoria = String(p.valor).trim();
                                            break;
                                        }
                                    }
                                }
                            }
                            if (subSubCategoria) break;
                        }
                    }
                }

                // 3. Nivel 5
                if (subCategoria && subSubCategoria && confRule.reglas_nivel_5) {
                    const pathKeyN5 = `${subCategoria}___${subSubCategoria}`;
                    const configuredEjeN5 = confRule.reglas_nivel_5[pathKeyN5] || null;
                    if (configuredEjeN5) {
                        const targetEjesN5 = Array.isArray(configuredEjeN5)
                            ? configuredEjeN5.map(s => String(s).trim().toLowerCase()).filter(Boolean)
                            : String(configuredEjeN5).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

                        for (const targetEjeN5 of targetEjesN5) {
                            for (const key in posObj) {
                                if (Object.prototype.hasOwnProperty.call(posObj, key)) {
                                    const p = posObj[key];
                                    if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === targetEjeN5) {
                                        if (p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                                            subSubSubCategoria = String(p.valor).trim();
                                            break;
                                        }
                                    }
                                }
                            }
                            if (subSubSubCategoria) break;
                        }
                    }
                }
            }

            const derivados = derivadosPorMadre.get(sku) || [];
            const fotoData = fotosMap.get(sku) || null;
            const codigosLotesStr = lotesVinculados.map(l => `${l.lote_codigo_corto || ''} ${l.lote_id_supabase || ''}`).join(' ');

            const bolsaBusqueda = [
                sku,
                codigoBarras,
                ...codigosIngrediente,
                codigosLotesStr,
                row.descripcion || '',
                row.descripcion_corta || '',
                row.descripcion_generada || '',
                familiaResuelta,
                artPrincipalResuelto,
                subCategoria || '',
                subSubCategoria || '',
                subSubSubCategoria || '',
                row.rubro || '',
                row.sub_rubro || '',
                ultimoLote?.lote_codigo_corto || '',
                ultimoLote?.proveedor_nombre || '',
                infoPuente?.articulo_id || '',
                infoPuente?.descripcion || '',
                ...dynamicTokens
            ].join(' ').toLowerCase();

            resultado.push({
                articulo_id: sku,
                codigo_barras: codigoBarras,
                codigos_ingrediente: codigosIngrediente,
                descripcion: row.descripcion,
                nomenclatura: row.descripcion,
                kilos_unidad: parseFloat(row.kilos_unidad || 1.0),
                es_pack: esPack,
                pack_unidades: packUnidades,
                pack_hijo_codigo: packHijoCodigo,
                familia_id: row.familia_id || null,
                familia_nombre: familiaResuelta,
                familia: familiaResuelta,
                articulo_principal: artPrincipalResuelto,
                sub_categoria: subCategoria,
                sub_sub_categoria: subSubCategoria,
                sub_sub_sub_categoria: subSubSubCategoria,
                es_linea_1: esLinea1,
                articulo_puente: infoPuente,
                publicado_en_listas: Boolean(row.publicado_en_listas),
                en_oferta_activa: enOfertaSet.has(sku),
                stock_bultos: stockTotalBultos,
                tiene_stock: stockTotalBultos > 0,
                ultimo_lote: ultimoLote,
                lotes_vinculados: lotesVinculados,
                derivados_linea_2: derivados,
                fotos_lote: fotoData,
                tiene_fotos: Boolean(fotoData && fotoData.imagenes.length > 0),
                cantidad_fotos: fotoData ? fotoData.imagenes.length : 0,
                busqueda_texto: bolsaBusqueda
            });
        }

        return resultado;
    }

    /**
     * Sube un buffer binario al bucket público b2b_lotes_fotos en Supabase Storage.
     */
    static async subirArchivoStorage(storagePath, buffer, contentType = 'image/jpeg') {
        const { url, key } = this.getSupabaseConfig();
        if (!url || !key) {
            throw new Error('Credenciales de Supabase B2B no configuradas en el servidor.');
        }

        await this.asegurarBucketStorage();

        const uploadUrl = `${url}/storage/v1/object/${this.BUCKET_NAME}/${storagePath}`;
        let lastErrText = '';
        let lastStatus = 0;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await fetch(uploadUrl, {
                    method: 'POST',
                    headers: {
                        'apikey': key,
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': contentType,
                        'x-upsert': 'true',
                        'Cache-Control': 'public, max-age=31536000'
                    },
                    body: buffer
                });

                if (res.ok) {
                    const publicUrl = `${url}/storage/v1/object/public/${this.BUCKET_NAME}/${storagePath}`;
                    return publicUrl;
                }

                lastStatus = res.status;
                lastErrText = await res.text();
            } catch (err) {
                lastErrText = err.message;
            }

            if (attempt < 3) {
                await new Promise(r => setTimeout(r, 500 * attempt));
            }
        }

        throw new Error(`Error subiendo imagen a Supabase Storage (${lastStatus || 'NET'}): ${lastErrText}`);
    }

    /**
     * Elimina uno o varios archivos del bucket b2b_lotes_fotos en Supabase Storage.
     */
    static async eliminarArchivosStorage(storagePaths = []) {
        const { url, key } = this.getSupabaseConfig();
        if (!url || !key || !Array.isArray(storagePaths) || storagePaths.length === 0) return;

        const cleanPaths = storagePaths.filter(Boolean);
        if (cleanPaths.length === 0) return;

        try {
            await fetch(`${url}/storage/v1/object/${this.BUCKET_NAME}`, {
                method: 'DELETE',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prefixes: cleanPaths })
            });
        } catch (err) {
            console.warn('⚠️ [FOTOS-LOTES] Advertencia al limpiar archivos antiguos de Storage:', err.message);
        }
    }

    /**
     * Guarda o actualiza las fotos de una partida en depósito y sincroniza en el acto con Supabase B2B.
     */
    static async guardarFotosPartida(db, {
        articulo_id,
        nuevas_imagenes = null,
        imagenes_nuevas = null,
        imagenes_conservar_ids = null,
        imagenes_existentes = null,
        reemplazar_todas = false,
        reemplazar = false,
        lote_codigo_escaneado = null,
        observacion_tecnica = '',
        extender_a_derivados = false,
        derivados_seleccionados = null,
        es_permanente = false,
        usuario = 'Depósito Móvil'
    }) {
        await this.asegurarEsquema(db);

        const sku = String(articulo_id || '').trim();
        if (!sku) throw new Error('El código de artículo es obligatorio.');

        const listaNuevas = Array.isArray(imagenes_nuevas)
            ? imagenes_nuevas
            : (Array.isArray(nuevas_imagenes) ? nuevas_imagenes : []);
        const debeReemplazar = Boolean(reemplazar_todas || reemplazar);

        // 1. Verificar registro existente
        const existingRes = await db.query(
            'SELECT * FROM public.bunker_articulos_fotos_lote WHERE articulo_id = $1',
            [sku]
        );
        const existingRow = existingRes.rows[0] || null;
        const prevImgs = (existingRow && Array.isArray(existingRow.imagenes)) ? existingRow.imagenes : [];

        // 2. Determinar qué imágenes existentes se conservan y cuáles se borran de Storage
        let imgsConservadas = [];
        let pathsParaBorrar = [];

        if (debeReemplazar) {
            pathsParaBorrar = prevImgs.map(img => img.storage_path || img.path).filter(Boolean);
        } else if (Array.isArray(imagenes_existentes)) {
            const keepUrls = new Set(imagenes_existentes.map(img => String(img.url || img.id || '')));
            for (const img of prevImgs) {
                if (keepUrls.has(String(img.url || '')) || keepUrls.has(String(img.id || ''))) {
                    imgsConservadas.push(img);
                } else if (img.storage_path || img.path) {
                    pathsParaBorrar.push(img.storage_path || img.path);
                }
            }
        } else if (Array.isArray(imagenes_conservar_ids)) {
            const keepSet = new Set(imagenes_conservar_ids.map(String));
            for (const img of prevImgs) {
                if (keepSet.has(String(img.id))) {
                    imgsConservadas.push(img);
                } else if (img.storage_path || img.path) {
                    pathsParaBorrar.push(img.storage_path || img.path);
                }
            }
        } else {
            imgsConservadas = [...prevImgs];
        }

        // 3. Procesar y subir nuevas imágenes (máximo 6 fotos en total por partida)
        const maxFotos = 6;
        const cupoDisponible = Math.max(0, maxFotos - imgsConservadas.length);
        const nuevasParaSubir = listaNuevas.slice(0, cupoDisponible);

        const safeSkuPath = sku.replace(/[^a-zA-Z0-9_\-]/g, '_');
        const nuevasSubidas = [];

        for (let i = 0; i < nuevasParaSubir.length; i++) {
            const item = nuevasParaSubir[i];
            const rawBase64 = typeof item === 'string' ? item : (item.base64 || item.dataUrl || '');
            if (!rawBase64) continue;

            const matchMime = rawBase64.match(/^data:(image\/[a-zA-Z0-9+.\-]+);base64,/);
            const mimeType = matchMime ? matchMime[1] : (item.mimeType || 'image/jpeg');
            const ext = mimeType.includes('webp') ? 'webp' : (mimeType.includes('png') ? 'png' : 'jpg');
            const cleanBase64 = rawBase64.replace(/^data:image\/[a-zA-Z0-9+.\-]+;base64,/, '');
            const buffer = Buffer.from(cleanBase64, 'base64');

            const uniqueId = `${Date.now()}_${i + 1}_${Math.floor(Math.random() * 1000)}`;
            const storagePath = `partidas/${safeSkuPath}/${uniqueId}.${ext}`;

            const publicUrl = await this.subirArchivoStorage(storagePath, buffer, mimeType);
            const nowIso = new Date().toISOString();
            nuevasSubidas.push({
                id: uniqueId,
                url: publicUrl,
                storage_path: storagePath,
                path: storagePath,
                fecha_captura: nowIso,
                created_at: nowIso
            });
        }

        const imagenesFinales = [...imgsConservadas, ...nuevasSubidas];

        if (pathsParaBorrar.length > 0) {
            await this.eliminarArchivosStorage(pathsParaBorrar);
        }

        // 4. Obtener el lote vinculado actual o el lote escaneado manualmente por el operador
        let loteInfo = null;
        const codigoLoteManual = lote_codigo_escaneado ? String(lote_codigo_escaneado).trim().replace(/^L:\s*/i, '') : '';

        if (codigoLoteManual) {
            const loteEscaneadoRes = await db.query(`
                SELECT v.id::text AS vinculo_id, v.lote_id_supabase, v.lote_codigo_corto
                FROM public.bunker_lotes_vinculos v
                WHERE LOWER(COALESCE(v.lote_codigo_corto, '')) = LOWER($1)
                   OR LOWER(COALESCE(v.lote_id_supabase, '')) = LOWER($1)
                   OR LOWER(v.id::text) = LOWER($1)
                ORDER BY v.fecha_vinculacion DESC NULLS LAST
                LIMIT 1
            `, [codigoLoteManual]).catch(() => ({ rows: [] }));

            if (loteEscaneadoRes.rows.length > 0) {
                loteInfo = loteEscaneadoRes.rows[0];
            } else {
                loteInfo = {
                    vinculo_id: existingRow?.vinculo_lote_id || null,
                    lote_id_supabase: codigoLoteManual,
                    lote_codigo_corto: codigoLoteManual
                };
            }
        }

        if (!loteInfo) {
            const loteActualRes = await db.query(`
                SELECT v.id::text AS vinculo_id, v.lote_id_supabase, v.lote_codigo_corto
                FROM public.bunker_lotes_destinos d
                JOIN public.bunker_lotes_vinculos v ON v.id = d.vinculo_id
                LEFT JOIN public.ingredientes i ON d.tipo_destino = 'INGREDIENTE_PRODUCCION' AND d.destino_id = i.id::text
                WHERE (d.tipo_destino = 'ARTICULO_BUNKER' AND d.destino_id = $1)
                   OR (d.tipo_destino = 'INGREDIENTE_PRODUCCION' AND i.articulo_vinculado_numero = $1)
                ORDER BY d.id DESC
                LIMIT 1
            `, [sku]);
            loteInfo = loteActualRes.rows[0] || null;
        }

        if (!loteInfo && existingRow && !debeReemplazar && (existingRow.lote_codigo_corto || existingRow.lote_id_supabase)) {
            loteInfo = {
                vinculo_id: existingRow.vinculo_lote_id || null,
                lote_id_supabase: existingRow.lote_id_supabase || existingRow.lote_codigo_corto,
                lote_codigo_corto: existingRow.lote_codigo_corto || existingRow.lote_id_supabase
            };
        }

        const vinculoLoteId = loteInfo && loteInfo.vinculo_id ? String(loteInfo.vinculo_id) : null;
        const loteIdSupabase = loteInfo ? (loteInfo.lote_id_supabase || loteInfo.lote_codigo_corto) : null;
        const loteCodigoCorto = loteInfo ? (loteInfo.lote_codigo_corto || loteInfo.lote_id_supabase) : null;

        const obsLimpia = observacion_tecnica ? String(observacion_tecnica).trim().slice(0, 300) : null;
        const derivSelArray = Array.isArray(derivados_seleccionados)
            ? derivados_seleccionados.map(s => String(s || '').trim()).filter(Boolean)
            : null;
        const extDerivados = Boolean(extender_a_derivados);
        const esPerm = Boolean(es_permanente);
        const quedaActivo = imagenesFinales.length > 0;

        // 5. Upsert en public.bunker_articulos_fotos_lote
        const upsertRes = await db.query(`
            INSERT INTO public.bunker_articulos_fotos_lote (
                articulo_id,
                vinculo_lote_id,
                lote_id_supabase,
                lote_codigo_corto,
                imagenes,
                observacion_tecnica,
                extender_a_derivados,
                derivados_seleccionados,
                es_permanente,
                activo,
                motivo_baja,
                usuario_captura,
                created_at,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10, NULL, $11, NOW(), NOW())
            ON CONFLICT (articulo_id)
            DO UPDATE SET
                vinculo_lote_id = EXCLUDED.vinculo_lote_id,
                lote_id_supabase = EXCLUDED.lote_id_supabase,
                lote_codigo_corto = EXCLUDED.lote_codigo_corto,
                imagenes = EXCLUDED.imagenes,
                observacion_tecnica = EXCLUDED.observacion_tecnica,
                extender_a_derivados = EXCLUDED.extender_a_derivados,
                derivados_seleccionados = EXCLUDED.derivados_seleccionados,
                es_permanente = EXCLUDED.es_permanente,
                activo = EXCLUDED.activo,
                motivo_baja = CASE WHEN EXCLUDED.activo THEN NULL ELSE 'SIN_IMAGENES' END,
                usuario_captura = EXCLUDED.usuario_captura,
                updated_at = NOW()
            RETURNING *
        `, [
            sku,
            vinculoLoteId,
            loteIdSupabase,
            loteCodigoCorto,
            JSON.stringify(imagenesFinales),
            obsLimpia,
            extDerivados,
            derivSelArray !== null ? JSON.stringify(derivSelArray) : null,
            esPerm,
            quedaActivo,
            usuario || 'Depósito Móvil'
        ]);

        // 6. Sincronizar de inmediato con Supabase Cloud (manifest.json + tabla catálogo)
        await this.sincronizarManifestYCatalogoSupabase(db);

        return upsertRes.rows[0];
    }

    /**
     * Da de baja las fotos de un artículo, limpiando los archivos en Supabase Storage y actualizando el Portal.
     */
    static async eliminarFotosPartida(db, articuloId, motivo = 'BAJA_MANUAL_OPERARIO') {
        await this.asegurarEsquema(db);
        const sku = String(articuloId || '').trim();

        const existingRes = await db.query(
            'SELECT imagenes FROM public.bunker_articulos_fotos_lote WHERE articulo_id = $1',
            [sku]
        );

        if (existingRes.rows.length > 0) {
            const imgs = Array.isArray(existingRes.rows[0].imagenes) ? existingRes.rows[0].imagenes : [];
            const paths = imgs.map(i => i.storage_path || i.path).filter(Boolean);
            if (paths.length > 0) {
                await this.eliminarArchivosStorage(paths);
            }

            await db.query(`
                UPDATE public.bunker_articulos_fotos_lote
                SET imagenes = '[]'::jsonb,
                    derivados_seleccionados = '[]'::jsonb,
                    activo = false,
                    motivo_baja = $2,
                    updated_at = NOW()
                WHERE articulo_id = $1
            `, [sku, motivo]);
        }

        await this.sincronizarManifestYCatalogoSupabase(db);
        return { success: true };
    }

    /**
     * Evalúa y aplica la caducidad automática de fotos dinámicas (es_permanente = false)
     * cuando:
     *   1) El artículo se quedó sin stock físico en depósito y sin cajas cerradas en taller, o
     *   2) Ingresó un lote nuevo (vinculo_lote_id distinto al que tenía al momento de capturar las fotos).
     */
    static async evaluarCaducidadAutomaticaLotes(db) {
        await this.asegurarEsquema(db);

        const activasRes = await db.query(`
            SELECT *
            FROM public.bunker_articulos_fotos_lote
            WHERE activo = true
              AND COALESCE(es_permanente, false) = false
              AND COALESCE(motivo_baja, '') NOT LIKE 'HEREDADO_MADRE:%'
        `);

        if (activasRes.rows.length === 0) return { caducadas: 0 };

        let caducadasCount = 0;

        for (const row of activasRes.rows) {
            const sku = String(row.articulo_id).trim();

            // 1. Verificar stock físico real (contemplando stock directo, cajas en taller, unidades hijas si es Pack Padre y materia prima/bulto madre si es Fracción/Receta)
            const stockCheck = await db.query(`
                SELECT 
                    COALESCE(src.stock_consolidado, 0) AS stock_deposito,
                    COALESCE((
                        SELECT SUM(GREATEST(0, COALESCE(d.cantidad_asignada, 0) - COALESCE(d.cantidad_abierta, 0)))
                        FROM public.bunker_lotes_destinos d
                        JOIN public.ingredientes i ON d.tipo_destino = 'INGREDIENTE_PRODUCCION' AND d.destino_id = i.id::text
                        WHERE i.articulo_vinculado_numero = $1
                    ), 0) AS cajas_taller,
                    CASE
                        WHEN COALESCE(ba.es_pack, src.es_pack, false) = true
                             AND COALESCE(ba.pack_hijo_codigo, src.pack_hijo_codigo) IS NOT NULL
                        THEN FLOOR(
                            GREATEST(0, COALESCE(src_hijo.stock_consolidado, 0))
                            / GREATEST(1.0, COALESCE(ba.pack_unidades, src.pack_unidades, 1)::numeric)
                        )
                        ELSE 0
                    END AS stock_packs_hijo,
                    COALESCE((
                        SELECT MAX(
                            GREATEST(0, COALESCE(i.stock_actual, 0))
                            + GREATEST(0, COALESCE(src_madre.stock_consolidado, 0))
                            + COALESCE((
                                SELECT SUM(GREATEST(0, COALESCE(d2.cantidad_asignada, 0) - COALESCE(d2.cantidad_abierta, 0)))
                                FROM public.bunker_lotes_destinos d2
                                WHERE d2.tipo_destino = 'INGREDIENTE_PRODUCCION'
                                  AND d2.destino_id = i.id::text
                            ), 0)
                        )
                        FROM public.recetas r
                        JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                        JOIN public.ingredientes i ON i.id = ri.ingrediente_id
                        LEFT JOIN public.stock_real_consolidado src_madre ON src_madre.articulo_numero = i.articulo_vinculado_numero
                        WHERE r.articulo_numero IN ($1, COALESCE(ba.pack_hijo_codigo, src.pack_hijo_codigo, ''))
                          AND COALESCE(i.es_insumo, false) = false
                    ), 0) AS stock_respaldo_receta,
                    (
                        SELECT v.id::text
                        FROM public.bunker_lotes_destinos d
                        JOIN public.bunker_lotes_vinculos v ON v.id = d.vinculo_id
                        LEFT JOIN public.ingredientes i ON d.tipo_destino = 'INGREDIENTE_PRODUCCION' AND d.destino_id = i.id::text
                        WHERE (d.tipo_destino = 'ARTICULO_BUNKER' AND d.destino_id = $1)
                           OR (d.tipo_destino = 'INGREDIENTE_PRODUCCION' AND i.articulo_vinculado_numero = $1)
                        ORDER BY d.id DESC
                        LIMIT 1
                    ) AS ultimo_vinculo_id
                FROM public.bunker_articulos ba
                LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
                LEFT JOIN public.stock_real_consolidado src_hijo ON src_hijo.articulo_numero = COALESCE(ba.pack_hijo_codigo, src.pack_hijo_codigo)
                WHERE ba.articulo_id = $1
            `, [sku]);

            if (stockCheck.rows.length === 0) continue;

            const info = stockCheck.rows[0];
            const stockFisicoTotal = parseFloat(info.stock_deposito || 0)
                + parseFloat(info.cajas_taller || 0)
                + parseFloat(info.stock_packs_hijo || 0)
                + parseFloat(info.stock_respaldo_receta || 0);
            const ultimoVinculoId = info.ultimo_vinculo_id ? String(info.ultimo_vinculo_id).trim() : null;
            const fotoVinculoId = row.vinculo_lote_id ? String(row.vinculo_lote_id).trim() : null;

            let motivoCaducidad = null;

            if (stockFisicoTotal <= 0) {
                motivoCaducidad = 'STOCK_FISICO_AGOTADO';
            } else if (fotoVinculoId && ultimoVinculoId && ultimoVinculoId !== fotoVinculoId) {
                motivoCaducidad = `REEMPLAZADO_POR_NUEVO_LOTE`;
            }

            if (motivoCaducidad) {
                console.log(`🧹 [FOTOS-LOTES] Caducidad automática de fotos para ${sku} (Motivo: ${motivoCaducidad})`);
                const imgs = Array.isArray(row.imagenes) ? row.imagenes : [];
                const paths = imgs.map(i => i.storage_path || i.path).filter(Boolean);
                if (paths.length > 0 && !String(row.motivo_baja || '').startsWith('HEREDADO_MADRE:')) {
                    await this.eliminarArchivosStorage(paths);
                }

                await db.query(`
                    UPDATE public.bunker_articulos_fotos_lote
                    SET imagenes = '[]'::jsonb,
                        activo = false,
                        motivo_baja = $2,
                        updated_at = NOW()
                    WHERE id = $1
                `, [row.id, motivoCaducidad]);

                caducadasCount++;
            }
        }

        if (caducadasCount > 0) {
            await this.sincronizarManifestYCatalogoSupabase(db);
        }

        return { caducadas: caducadasCount };
    }

    /**
     * Construye el diccionario de imágenes vigentes por producto_codigo (incluyendo derivados de Línea 2
     * seleccionados individualmente o en bloque por el operario).
     */
    static async construirMapaImagenesCatalogo(db) {
        await this.asegurarEsquema(db);

        const activasRes = await db.query(`
            SELECT 
                fl.*,
                COALESCE(ba.descripcion_generada, ba.descripcion, fl.articulo_id) AS articulo_descripcion,
                COALESCE(ba.kilos_unidad, 1.0) AS kilos_unidad
            FROM public.bunker_articulos_fotos_lote fl
            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = fl.articulo_id
            WHERE fl.activo = true
        `);

        const mapa = {};
        if (activasRes.rows.length === 0) return mapa;

        // Evaluar si alguno tiene extender_a_derivados o derivados_seleccionados para calcular el árbol de Línea 2
        const requiereDerivados = activasRes.rows.some(r =>
            r.extender_a_derivados === true ||
            (Array.isArray(r.derivados_seleccionados) && r.derivados_seleccionados.length > 0)
        );
        let derivadosPorMadre = new Map();
        if (requiereDerivados) {
            const resDeriv = await this.obtenerMapaDerivadosLinea2(db);
            derivadosPorMadre = resDeriv.derivadosPorMadre;
        }

        // 1. Primero asignar las fotos directas (Línea 1)
        for (const row of activasRes.rows) {
            const imgs = Array.isArray(row.imagenes) ? row.imagenes : [];
            if (imgs.length === 0) continue;

            const skuMadre = String(row.articulo_id).trim();
            const esHeredadoTrigger = String(row.motivo_baja || '').startsWith('HEREDADO_MADRE:') || imgs[0]?.es_heredado_madre === true;
            const imgsMapped = imgs.map(img => ({
                id: img.id,
                url: img.url,
                created_at: img.created_at || img.fecha_captura || row.updated_at,
                fecha_captura: img.fecha_captura || img.created_at || row.updated_at,
                es_heredado_madre: esHeredadoTrigger || undefined,
                articulo_madre_nombre: imgs[0]?.articulo_madre_nombre || undefined
            }));

            mapa[skuMadre] = {
                articulo_origen: skuMadre,
                articulo_madre_id: skuMadre,
                articulo_origen_descripcion: row.articulo_descripcion || skuMadre,
                articulo_madre_nombre: imgs[0]?.articulo_madre_nombre || row.articulo_descripcion || skuMadre,
                kilos_origen: parseFloat(row.kilos_unidad || 1.0),
                es_referencia_caja_madre: esHeredadoTrigger,
                lote_codigo: row.lote_codigo_corto || row.lote_id_supabase || null,
                observacion_tecnica: row.observacion_tecnica || null,
                fecha_captura: row.updated_at || row.created_at,
                updated_at: row.updated_at || row.created_at,
                imagenes: imgsMapped,
                fotos: imgsMapped
            };
        }

        // 2. Luego propagar a derivados de Línea 2 (todos si extender_a_derivados === true, o solo derivados_seleccionados)
        for (const row of activasRes.rows) {
            const listaSel = Array.isArray(row.derivados_seleccionados)
                ? row.derivados_seleccionados.map(s => String(s).trim()).filter(Boolean)
                : null;
            const tieneSeleccion = listaSel && listaSel.length > 0;
            if (!row.extender_a_derivados && !tieneSeleccion) continue;

            const imgs = Array.isArray(row.imagenes) ? row.imagenes : [];
            if (imgs.length === 0) continue;

            const skuMadre = String(row.articulo_id).trim();
            const derivados = derivadosPorMadre.get(skuMadre) || [];
            const setSeleccionados = tieneSeleccion ? new Set(listaSel) : null;

            const imgsMapped = imgs.map(img => ({
                id: img.id,
                url: img.url,
                created_at: img.created_at || img.fecha_captura || row.updated_at,
                fecha_captura: img.fecha_captura || img.created_at || row.updated_at
            }));

            for (const deriv of derivados) {
                const skuDeriv = String(deriv.articulo_id).trim();
                if (setSeleccionados && !setSeleccionados.has(skuDeriv)) {
                    continue;
                }
                // No pisar si el derivado tuviera una captura propia directa
                if (mapa[skuDeriv] && !mapa[skuDeriv].es_referencia_caja_madre) {
                    continue;
                }

                mapa[skuDeriv] = {
                    articulo_origen: skuMadre,
                    articulo_madre_id: skuMadre,
                    articulo_origen_descripcion: row.articulo_descripcion || skuMadre,
                    articulo_madre_nombre: row.articulo_descripcion || skuMadre,
                    kilos_origen: parseFloat(row.kilos_unidad || 1.0),
                    es_referencia_caja_madre: true,
                    lote_codigo: row.lote_codigo_corto || row.lote_id_supabase || null,
                    observacion_tecnica: row.observacion_tecnica || null,
                    fecha_captura: row.updated_at || row.created_at,
                    updated_at: row.updated_at || row.created_at,
                    imagenes: imgsMapped,
                    fotos: imgsMapped
                };
            }
        }

        return mapa;
    }

    /**
     * Publica en tiempo real el manifest.json en Supabase Storage para disponibilidad inmediata (<1s)
     * en el Portal B2B sin depender del ciclo de 15 minutos ni del caché de catálogo.
     */
    static async sincronizarManifestYCatalogoSupabase(db) {
        const { url, key } = this.getSupabaseConfig();
        if (!url || !key) return;

        try {
            const itemsObj = await this.construirMapaImagenesCatalogo(db);

            const manifestPayload = {
                updated_at: new Date().toISOString(),
                total_articulos_con_fotos: Object.keys(itemsObj).length,
                items: itemsObj
            };

            await this.asegurarBucketStorage();

            const manifestUrl = `${url}/storage/v1/object/${this.BUCKET_NAME}/manifest.json`;
            await fetch(manifestUrl, {
                method: 'POST',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    'x-upsert': 'true',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                },
                body: JSON.stringify(manifestPayload)
            });

            console.log(`☁️ [FOTOS-LOTES] Manifest B2B sincronizado en tiempo real (${Object.keys(itemsObj).length} artículos con inspección visual activa).`);
        } catch (err) {
            console.error('⚠️ [FOTOS-LOTES] Error al sincronizar manifest en Supabase:', err.message);
        }
    }
}

module.exports = FotosLotesService;
