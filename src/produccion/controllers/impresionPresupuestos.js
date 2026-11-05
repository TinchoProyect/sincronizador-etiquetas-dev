const pool = require('../config/database');
const JsBarcode = require('jsbarcode');
const { createCanvas } = require('canvas');
const motorCalculadoraFiscal = require('../utils/motorCalculadoraFiscal');
const inyectorVectorial = require('../utils/inyectorColumnasPDFKit');

/**
 * Calcular el total de artículos sumando las cantidades
 * @param {Array} articulos - Array de artículos con campo cantidad
 * @returns {number} Total de artículos
 */
function calcularTotalArticulos(articulos) {
    if (!Array.isArray(articulos) || articulos.length === 0) {
        return 0;
    }
    // CORRECCIÓN: Se devuelve la cantidad de ítems (renglones) en lugar de la suma de unidades
    return articulos.length;
}

/**
 * Generar buffer de imagen PNG del código de barras para PDF
 * @param {string} texto - Texto a codificar (ej: "12345-1")
 * @returns {Buffer} Buffer de imagen PNG
 */
function generarBufferCodigoBarras(texto) {
    try {
        const canvas = createCanvas();
        JsBarcode(canvas, texto, {
            format: "CODE128",
            width: 2,
            height: 40, // Altura ajustada para el pie de página
            displayValue: true,
            fontSize: 12,
            margin: 5
        });
        return canvas.toBuffer('image/png');
    } catch (error) {
        console.error('❌ Error al generar código de barras:', error);
        return null;
    }
}

/**
 * Generar buffer de imagen PNG para Comandos Hardware ON/OFF Backend
 * @param {string} texto - Texto a codificar
 * @returns {Buffer} Buffer de imagen PNG
 */
function generarBufferComando(texto) {
    try {
        const canvas = createCanvas();
        JsBarcode(canvas, texto, {
            format: "CODE128",
            width: 2,
            height: 60,
            displayValue: false, // La etiqueta textual suplanta esto
            margin: 0
        });
        return canvas.toBuffer('image/png');
    } catch (error) {
        console.error('❌ Error al generar barcode comando:', error);
        return null;
    }
}

function generarSVGCodigoBarras(texto) {
    try {
        const canvas = createCanvas();
        JsBarcode(canvas, texto, {
            format: "CODE128",
            width: 2,
            height: 60, // Estandarizado al tamaño principal
            displayValue: true,
            fontSize: 14,
            margin: 10
        });
        
        // Retornar directamente el tag img Base64 nativo, sin wrappers SVG que rompan el rendering
        return `<img src="${canvas.toDataURL()}" style="display: block; margin: 0 auto; height: 80px;" alt="Código de Presupuesto"/>`;
    } catch (error) {
        console.error('❌ Error al generar imagen código de barras HTML:', error);
        return '';
    }
}

function generarIMGComando(texto) {
    try {
        const canvas = createCanvas();
        JsBarcode(canvas, texto, {
            format: "CODE128",
            width: 1.5,
            height: 40, 
            displayValue: false, // The HTML has a separate label beneath
            margin: 5
        });
        
        return `<img src="${canvas.toDataURL()}" style="display: block; margin: 0 auto; height: 35px;" alt="${texto}"/>`;
    } catch (error) {
        console.error('❌ Error al generar imagen comando HTML:', error);
        return '';
    }
}

/**
 * Guardar snapshot de presupuesto al imprimir
 * @param {number} id_presupuesto - ID interno del presupuesto
 * @param {string} id_presupuesto_ext - ID externo del presupuesto
 * @param {Array} detalles - Array de artículos del presupuesto
 * @param {string} secuencia - Secuencia actual del presupuesto
 */
async function guardarSnapshotImpresion(id_presupuesto, id_presupuesto_ext, detalles, secuencia) {
    console.log(`📸 [SNAPSHOT-PRINT] Iniciando guardado de snapshot para presupuesto ID: ${id_presupuesto} (${id_presupuesto_ext})`);
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. Verificar si ya existe un snapshot activo
        const checkSnapshotQuery = `
            SELECT 
                id,
                secuencia_en_snapshot,
                motivo,
                numero_impresion,
                diferencias_detalles
            FROM presupuestos_snapshots
            WHERE id_presupuesto = $1 AND activo = true
            ORDER BY fecha_snapshot DESC
            LIMIT 1
        `;
        
        const checkResult = await client.query(checkSnapshotQuery, [id_presupuesto]);
        
        if (checkResult.rows.length > 0) {
            // YA EXISTE SNAPSHOT ACTIVO - No crear uno nuevo, reutilizar el existente
            const snapshotExistente = checkResult.rows[0];
            
            console.log(`📸 [SNAPSHOT-PRINT] Reimpresión de presupuesto con snapshot existente (no se crea nuevo registro)`);
            console.log(`📸 [SNAPSHOT-PRINT] Snapshot existente ID: ${snapshotExistente.id}`);
            console.log(`📸 [SNAPSHOT-PRINT] Manteniendo:`);
            console.log(`📸 [SNAPSHOT-PRINT]    - secuencia_en_snapshot: ${snapshotExistente.secuencia_en_snapshot}`);
            console.log(`📸 [SNAPSHOT-PRINT]    - motivo: ${snapshotExistente.motivo}`);
            console.log(`📸 [SNAPSHOT-PRINT]    - numero_impresion: ${snapshotExistente.numero_impresion}`);
            console.log(`📸 [SNAPSHOT-PRINT]    - diferencias_detalles: ${snapshotExistente.diferencias_detalles ? 'CON DIFERENCIAS' : 'NULL'}`);
            
            // Opcional: actualizar solo fecha_snapshot
            const updateFechaQuery = `
                UPDATE presupuestos_snapshots
                SET fecha_snapshot = NOW()
                WHERE id = $1
                RETURNING id, fecha_snapshot
            `;
            
            const updateResult = await client.query(updateFechaQuery, [snapshotExistente.id]);
            
            await client.query('COMMIT');
            
            console.log(`✅ [SNAPSHOT-PRINT] Snapshot reutilizado (solo actualizada fecha_snapshot)`);
            
            return {
                success: true,
                snapshot_id: snapshotExistente.id,
                fecha_snapshot: updateResult.rows[0].fecha_snapshot,
                reused: true
            };
            
        } else {
            // NO EXISTE SNAPSHOT - Primera impresión, crear nuevo
            console.log(`📸 [SNAPSHOT-PRINT] Primera impresión (creando snapshot nuevo)`);
            
            // Construir snapshot_detalles como array JSON
            const snapshot_detalles = detalles.map(item => ({
                articulo: item.articulo_numero || item.articulo,
                cantidad: item.cantidad || 0,
                valor1: item.valor1 || 0,
                precio1: item.precio1 || item.valor1 || 0,
                descripcion: item.descripcion || ''
            }));
            
            // Para primera impresión, SIEMPRE usar 'Armar_Pedido'
            const secuencia_en_snapshot = 'Armar_Pedido';
            const motivo = 'primera_impresion';
            
            console.log(`📸 [SNAPSHOT-PRINT] Motivo: ${motivo} -> secuencia_en_snapshot = '${secuencia_en_snapshot}'`);
            
            // Insertar nuevo snapshot
            const insertQuery = `
                INSERT INTO presupuestos_snapshots (
                    id_presupuesto,
                    id_presupuesto_ext,
                    snapshot_detalles,
                    secuencia_en_snapshot,
                    motivo,
                    activo,
                    numero_impresion
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, fecha_snapshot
            `;
            
            const insertValues = [
                id_presupuesto,
                id_presupuesto_ext,
                JSON.stringify(snapshot_detalles),
                secuencia_en_snapshot,
                motivo,
                true,
                1 // numero_impresion inicial
            ];
            
            const insertResult = await client.query(insertQuery, insertValues);
            const snapshot = insertResult.rows[0];
            
            await client.query('COMMIT');
            
            console.log(`✅ [SNAPSHOT-PRINT] Snapshot nuevo guardado - ID: ${snapshot.id}, Fecha: ${snapshot.fecha_snapshot}`);
            console.log(`📸 [SNAPSHOT-PRINT] Detalles: ${snapshot_detalles.length} artículos`);
            
            return {
                success: true,
                snapshot_id: snapshot.id,
                fecha_snapshot: snapshot.fecha_snapshot,
                reused: false
            };
        }
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [SNAPSHOT-PRINT] Error al guardar snapshot:', error.message);
        console.error('❌ [SNAPSHOT-PRINT] Stack:', error.stack);
        // No lanzar error - la impresión debe continuar
        return {
            success: false,
            error: error.message
        };
    } finally {
        client.release();
    }
}

/**
 * Genera impresión de presupuesto por cliente en formato remito rediseñado (PDF o HTML)
 * REDISEÑO: Formato R compacto, moderno y minimalista
 */
const imprimirPresupuestoCliente = async (req, res) => {
    try {
        console.log('🔍 [REMITO-R] Iniciando impresión de remito rediseñado...');
        
        const { 
            cliente_id, 
            presupuesto_id,
            presupuestos_ext_ids,
            fecha,
            fecha_desde, 
            fecha_hasta, 
            formato = 'html',
            pendiente_compra = 'false',
            contexto = ''
        } = req.query;
        
        const esPendienteCompra = pendiente_compra === 'true';
        const esContextoProduccion = contexto === 'produccion';
        
        let kilosOverride = {};
        if (req.query.kilos_override) {
            try {
                kilosOverride = JSON.parse(decodeURIComponent(req.query.kilos_override));
                console.log('⚖️ [REMITO-R] Overrides de kilos detectados:', kilosOverride);
            } catch (e) {
                console.error('❌ [REMITO-R] Error parseando kilos_override:', e);
            }
        }
        
        const applyKilosOverrides = (clientesArray) => {
            if (Object.keys(kilosOverride).length === 0) return;
            clientesArray.forEach(cliente => {
                if (cliente.presupuestos) {
                    cliente.presupuestos.forEach(presupuesto => {
                        if (presupuesto.articulos) {
                            presupuesto.articulos.forEach(art => {
                                const codeToMatch = art.articulo_numero || art.codigo_barras || art.articulo;
                                if (kilosOverride[codeToMatch] !== undefined) {
                                    art.kilos_unidad = kilosOverride[codeToMatch];
                                }
                            });
                        }
                    });
                }
            });
        };

        if (esPendienteCompra) {
            console.log('🛒 [REMITO-R] MODO PENDIENTE DE COMPRA activado');
        }
        
        // Validaciones - cliente_id es opcional si se proporciona fecha o presupuestos_ext_ids
        if (!cliente_id && !fecha && !presupuestos_ext_ids) {
            console.log('❌ [REMITO-R] Debe proporcionar cliente_id, fecha o presupuestos_ext_ids');
            return res.status(400).json({
                success: false,
                error: 'Debe proporcionar cliente_id, fecha o presupuestos_ext_ids',
                timestamp: new Date().toISOString()
            });
        }
        
        if (cliente_id && isNaN(parseInt(cliente_id))) {
            console.log('❌ [REMITO-R] cliente_id inválido:', cliente_id);
            return res.status(400).json({
                success: false,
                error: 'cliente_id debe ser un número válido',
                timestamp: new Date().toISOString()
            });
        }
        
        if (fecha && !fecha.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return res.status(400).json({
                success: false,
                error: 'fecha debe tener formato YYYY-MM-DD',
                timestamp: new Date().toISOString()
            });
        }
        
        if (fecha_desde && !fecha_desde.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return res.status(400).json({
                success: false,
                error: 'fecha_desde debe tener formato YYYY-MM-DD',
                timestamp: new Date().toISOString()
            });
        }
        
        if (fecha_hasta && !fecha_hasta.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return res.status(400).json({
                success: false,
                error: 'fecha_hasta debe tener formato YYYY-MM-DD',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('📋 [REMITO-R] Parámetros impresión:', { cliente_id, presupuesto_id, fecha, fecha_desde, fecha_hasta, formato });
        
        // Determinar el tipo de consulta según los parámetros
        let query, params, result;
        
        if (cliente_id) {
            // CASO 1 y 2: Por cliente (con o sin presupuesto_id específico)
            query = `
                WITH presupuestos_filtrados AS (
                    SELECT 
                        p.id,
                        p.id_presupuesto_ext,
                        p.id_cliente,
                        p.fecha,
                        COALESCE(p.descuento, 0) as descuento
                    FROM public.presupuestos p
                    WHERE p.activo = true 
                      AND CAST(p.id_cliente AS integer) = $1
                      AND p.estado NOT IN ('Sin Confirmar', 'Standby', 'Muestra de Fraccionados')
                      AND COALESCE(p.secuencia, '') NOT IN ('Standby')
                      AND ($2::text IS NOT NULL OR REPLACE(LOWER(TRIM(p.estado)), ' ', '') = 'presupuesto/orden' OR LOWER(p.estado) = 'facturado')
                      AND ($2::text IS NULL OR LOWER(p.id_presupuesto_ext) = LOWER($2) OR p.id::text = $2)
                      AND ($3::date IS NULL OR p.fecha <= $3)
                )
                SELECT 
                    c.cliente_id,
                    COALESCE(
                        NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''),
                        NULLIF(TRIM(c.nombre), ''),
                        'Cliente ' || c.cliente_id
                    ) as cliente_nombre,
                    COALESCE(cpi.perfil_id, 'DEFAULT') as perfil_id,
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'id', pf.id,
                            'id_presupuesto_ext', pf.id_presupuesto_ext,
                            'fecha', pf.fecha,
                            'descuento', pf.descuento,
                            'articulos', (
                                SELECT JSON_AGG(
                                    JSON_BUILD_OBJECT(
                                        'articulo_numero', pd.articulo,
                                        'codigo_barras', COALESCE(NULLIF(TRIM(a.codigo_barras), ''), NULLIF(TRIM(ba.codigo_barras::text), ''), NULLIF(TRIM(src.codigo_barras), ''), ''),
                                        'sku_canonico', COALESCE(NULLIF(TRIM(a.numero), ''), NULLIF(TRIM(ba.articulo_id::text), ''), NULLIF(TRIM(src.articulo_numero), ''), pd.articulo),
                                        'descripcion', CASE
                                            WHEN COALESCE(pd.es_saldo_ingrediente, false) = true AND COALESCE(pd.kilos_saldo, 0) > 0 THEN
                                                COALESCE(
                                                    NULLIF(TRIM(ba.descripcion_generada), ''),
                                                    NULLIF(TRIM(ba.descripcion), ''),
                                                    NULLIF(TRIM(a.nombre), ''),
                                                    NULLIF(TRIM(ing.nombre), ''),
                                                    pd.articulo
                                                ) || ' (Saldo: ' || TRIM(TO_CHAR(pd.kilos_saldo, 'FM999990D999')) || ' kg)'
                                            ELSE
                                                COALESCE(
                                                    NULLIF(TRIM(ba.descripcion_generada), ''),
                                                    NULLIF(TRIM(ba.descripcion), ''),
                                                    NULLIF(TRIM(a.nombre), ''),
                                                    NULLIF(TRIM(ing.nombre), ''),
                                                    pd.articulo
                                                )
                                        END,
                                        'cantidad', COALESCE(pd.cantidad, 0),
                                        'precio1', pd.precio1,
                                        'valor1', pd.valor1,
                                        'descuento', pd.camp4,
                                        'iva_tasa', pd.camp2,
                                        'kilos_unidad', src.kilos_unidad,
                                        'es_pack', src.es_pack,
                                        'pack_unidades', src.pack_unidades,
                                        'es_ingrediente', CASE WHEN ing.id IS NOT NULL THEN true ELSE false END
                                    ) ORDER BY pd.articulo
                                )
                                FROM public.presupuestos_detalles pd
                                LEFT JOIN LATERAL (
                                    SELECT a_inner.numero, a_inner.codigo_barras, a_inner.nombre
                                    FROM public.articulos a_inner
                                    WHERE a_inner.numero = pd.articulo OR a_inner.codigo_barras = pd.articulo
                                    ORDER BY (a_inner.codigo_barras = pd.articulo) DESC
                                    LIMIT 1
                                ) a ON true
                                LEFT JOIN LATERAL (
                                    SELECT ba_inner.articulo_id, ba_inner.codigo_barras, ba_inner.descripcion_generada, ba_inner.descripcion
                                    FROM public.bunker_articulos ba_inner
                                    WHERE ba_inner.articulo_id::text = pd.articulo
                                       OR ba_inner.codigo_barras::text = pd.articulo
                                       OR (a.numero IS NOT NULL AND ba_inner.articulo_id::text = a.numero)
                                    ORDER BY (ba_inner.articulo_id::text = pd.articulo) DESC
                                    LIMIT 1
                                ) ba ON true
                                LEFT JOIN LATERAL (
                                    SELECT src_inner.articulo_numero, src_inner.codigo_barras, src_inner.kilos_unidad, src_inner.es_pack, src_inner.pack_unidades
                                    FROM public.stock_real_consolidado src_inner
                                    WHERE src_inner.articulo_numero = pd.articulo
                                       OR src_inner.codigo_barras = pd.articulo
                                       OR (a.numero IS NOT NULL AND src_inner.articulo_numero = a.numero)
                                       OR (ba.articulo_id IS NOT NULL AND src_inner.articulo_numero = ba.articulo_id::text)
                                    ORDER BY (src_inner.codigo_barras = pd.articulo) DESC
                                    LIMIT 1
                                ) src ON true
                                LEFT JOIN LATERAL (
                                    SELECT ing_inner.id, ing_inner.codigo, ing_inner.nombre
                                    FROM public.ingredientes ing_inner
                                    WHERE a.numero IS NULL AND ba.articulo_id IS NULL
                                      AND (ing_inner.id::text = pd.articulo OR ing_inner.codigo::text = pd.articulo)
                                    LIMIT 1
                                ) ing ON true
                                WHERE pd.id_presupuesto = pf.id
                            )
                        ) ORDER BY pf.fecha DESC
                    ) as presupuestos
                FROM public.clientes c
                LEFT JOIN clientes_perfiles_impresion cpi ON cpi.id_cliente_ext = c.cliente_id::text
                CROSS JOIN presupuestos_filtrados pf
                WHERE c.cliente_id = $1
                GROUP BY c.cliente_id, c.nombre, c.apellido, cpi.perfil_id;
            `;
            
            params = [
                parseInt(cliente_id),
                presupuesto_id || null,
                fecha || fecha_hasta || null
            ];
            
            console.log('🔍 [REMITO-R] Consulta por cliente con parámetros:', params);
            result = await pool.query(query, params);
            
            if (result.rows.length === 0) {
                console.log('❌ [REMITO-R] Cliente no encontrado o sin presupuestos confirmados:', cliente_id);
                return res.status(404).json({
                    success: false,
                    error: 'Cliente no encontrado o sin presupuestos confirmados',
                    detalle: 'No se encontraron presupuestos con estado "Presupuesto/Orden" para este cliente',
                    cliente_id: parseInt(cliente_id),
                    timestamp: new Date().toISOString()
                });
            }
            
            const clienteData = result.rows[0];
            console.log(`✅ [REMITO-R] Datos obtenidos para cliente: ${clienteData.cliente_nombre}`);
            console.log(`📊 [REMITO-R] Total presupuestos encontrados: ${clienteData.presupuestos.length}`);
            
            // 📸 GUARDAR SNAPSHOTS Y OBTENER DATOS DE MODIFICACIÓN para cada presupuesto
            console.log('📸 [SNAPSHOT] Iniciando guardado de snapshots para presupuestos a imprimir...');
            for (const presupuesto of clienteData.presupuestos) {
                try {
                    // Obtener id_presupuesto y secuencia desde la BD
                    const presupuestoQuery = `
                        SELECT id, secuencia 
                        FROM public.presupuestos 
                        WHERE (id = $1 OR id_presupuesto_ext = $2) AND activo = true
                        ORDER BY (id = $1) DESC
                        LIMIT 1
                    `;
                    const presupuestoResult = await pool.query(presupuestoQuery, [presupuesto.id || 0, presupuesto.id_presupuesto_ext]);
                    
                    if (presupuestoResult.rows.length > 0) {
                        const { id: id_presupuesto, secuencia } = presupuestoResult.rows[0];
                        
                        // Agregar ID presupuesto al objeto para usar en generación
                        presupuesto._id_presupuesto = id_presupuesto;
                        
                        // Guardar snapshot (no bloquea la impresión si falla)
                        await guardarSnapshotImpresion(
                            id_presupuesto,
                            presupuesto.id_presupuesto_ext,
                            presupuesto.articulos || [],
                            secuencia
                        );
                        
                        // Obtener datos del snapshot para mostrar en impresión
                        const snapshotQuery = `
                            SELECT 
                                id,
                                motivo,
                                secuencia_en_snapshot,
                                numero_impresion,
                                fecha_snapshot,
                                diferencias_detalles
                            FROM presupuestos_snapshots
                            WHERE id_presupuesto = $1 AND activo = true
                            ORDER BY fecha_snapshot DESC
                            LIMIT 1
                        `;
                        
                        const snapshotResult = await pool.query(snapshotQuery, [id_presupuesto]);
                        
                        if (snapshotResult.rows.length > 0) {
                            const snapshot = snapshotResult.rows[0];
                            
                            console.log(`🔍 [SNAPSHOT-DEBUG] Snapshot encontrado para presupuesto ${presupuesto.id_presupuesto_ext}:`);
                            console.log(`   - id: ${snapshot.id}`);
                            console.log(`   - motivo: "${snapshot.motivo}"`);
                            console.log(`   - secuencia_en_snapshot: "${snapshot.secuencia_en_snapshot}"`);
                            console.log(`   - numero_impresion: ${snapshot.numero_impresion}`);
                            console.log(`   - diferencias_detalles: ${snapshot.diferencias_detalles ? JSON.stringify(snapshot.diferencias_detalles).substring(0, 100) + '...' : 'NULL'}`);
                            
                            // Agregar datos del snapshot al presupuesto para usar en la vista
                            presupuesto._snapshot = {
                                motivo: snapshot.motivo,
                                secuencia_en_snapshot: snapshot.secuencia_en_snapshot,
                                numero_impresion: snapshot.numero_impresion,
                                fecha_snapshot: snapshot.fecha_snapshot,
                                diferencias_detalles: snapshot.diferencias_detalles
                            };
                            
                            const esModificado = snapshot.motivo === 'modificado' || 
                                                snapshot.secuencia_en_snapshot === 'Imprimir_Modificado';
                            
                            console.log(`🔍 [SNAPSHOT-DEBUG] Evaluación esModificado:`);
                            console.log(`   - motivo === 'modificado': ${snapshot.motivo === 'modificado'}`);
                            console.log(`   - secuencia_en_snapshot === 'Imprimir_Modificado': ${snapshot.secuencia_en_snapshot === 'Imprimir_Modificado'}`);
                            console.log(`   - RESULTADO esModificado: ${esModificado}`);
                            
                            if (esModificado) {
                                console.log(`✅ [PRINT-MOD] PRESUPUESTO MODIFICADO DETECTADO (id_snapshot=${snapshot.id}, id_presupuesto=${id_presupuesto}, numero_impresion=${snapshot.numero_impresion}, motivo=${snapshot.motivo}, fecha_snapshot=${snapshot.fecha_snapshot})`);
                                console.log(`   - presupuesto._snapshot asignado:`, presupuesto._snapshot);
                            } else {
                                console.log(`ℹ️ [PRINT-MOD] Snapshot encontrado pero NO es modificado (motivo="${snapshot.motivo}", secuencia="${snapshot.secuencia_en_snapshot}")`);
                            }
                        } else {
                            console.log(`⚠️ [PRINT-MOD] Sin snapshot activo para presupuesto ${presupuesto.id_presupuesto_ext}, impresión normal`);
                        }
                    } else {
                        console.log(`⚠️ [SNAPSHOT] No se encontró presupuesto con id_ext: ${presupuesto.id_presupuesto_ext}`);
                    }
                } catch (snapshotError) {
                    console.error(`❌ [SNAPSHOT] Error al guardar snapshot para ${presupuesto.id_presupuesto_ext}:`, snapshotError.message);
                    // Continuar con la impresión aunque falle el snapshot
                }
            }
            console.log('📸 [SNAPSHOT] Proceso de snapshots completado');
            
            // Si es pendiente de compra, obtener artículos en falta
            // IMPORTANTE: Usar la misma lógica que comprasPendientes.js con codigo_barras_real
            let articulosEnFalta = [];
            if (esPendienteCompra && presupuesto_id) {
                console.log('🛒 [REMITO-R] Obteniendo artículos en falta para presupuesto:', presupuesto_id);
                try {
                    const faltantesQuery = `
                        SELECT DISTINCT 
                            fpc.articulo_numero,
                            fpc.codigo_barras,
                            a.numero AS art_sku,
                            a.codigo_barras AS art_barcode,
                            ba.articulo_id::text AS ba_sku,
                            ba.codigo_barras::text AS ba_barcode,
                            src.articulo_numero AS src_sku,
                            src.codigo_barras AS src_barcode,
                            COALESCE(a.codigo_barras, ba.codigo_barras::text, src.codigo_barras, fpc.codigo_barras, fpc.articulo_numero) as codigo_barras_real
                        FROM faltantes_pendientes_compra fpc
                        LEFT JOIN LATERAL (
                            SELECT a_inner.numero, a_inner.codigo_barras
                            FROM public.articulos a_inner
                            WHERE a_inner.numero = fpc.articulo_numero
                               OR a_inner.codigo_barras = fpc.articulo_numero
                               OR (fpc.codigo_barras IS NOT NULL AND (a_inner.codigo_barras = fpc.codigo_barras OR a_inner.numero = fpc.codigo_barras))
                            ORDER BY (a_inner.numero = fpc.articulo_numero) DESC
                            LIMIT 1
                        ) a ON true
                        LEFT JOIN LATERAL (
                            SELECT ba_inner.articulo_id, ba_inner.codigo_barras
                            FROM public.bunker_articulos ba_inner
                            WHERE ba_inner.articulo_id::text = fpc.articulo_numero
                               OR ba_inner.codigo_barras::text = fpc.articulo_numero
                               OR (fpc.codigo_barras IS NOT NULL AND (ba_inner.codigo_barras::text = fpc.codigo_barras OR ba_inner.articulo_id::text = fpc.codigo_barras))
                               OR (a.numero IS NOT NULL AND ba_inner.articulo_id::text = a.numero)
                            ORDER BY (ba_inner.articulo_id::text = fpc.articulo_numero) DESC
                            LIMIT 1
                        ) ba ON true
                        LEFT JOIN LATERAL (
                            SELECT src_inner.articulo_numero, src_inner.codigo_barras
                            FROM public.stock_real_consolidado src_inner
                            WHERE src_inner.articulo_numero = fpc.articulo_numero
                               OR src_inner.codigo_barras = fpc.articulo_numero
                               OR (fpc.codigo_barras IS NOT NULL AND (src_inner.codigo_barras = fpc.codigo_barras OR src_inner.articulo_numero = fpc.codigo_barras))
                               OR (a.numero IS NOT NULL AND src_inner.articulo_numero = a.numero)
                            ORDER BY (src_inner.articulo_numero = fpc.articulo_numero) DESC
                            LIMIT 1
                        ) src ON true
                        WHERE (fpc.id_presupuesto_ext = $1 OR fpc.id_presupuesto_local::text = $1)
                          AND fpc.estado = 'En espera'
                    `;
                    const faltantesResult = await pool.query(faltantesQuery, [presupuesto_id]);
                    // Incluir tanto SKU como codigo_barras para soportar pedidos Web, Movil y B2B
                    const setFaltantes = new Set();
                    faltantesResult.rows.forEach(r => {
                        [r.articulo_numero, r.codigo_barras, r.art_sku, r.art_barcode, r.ba_sku, r.ba_barcode, r.src_sku, r.src_barcode, r.codigo_barras_real]
                            .filter(Boolean)
                            .map(v => String(v).trim())
                            .filter(Boolean)
                            .forEach(v => setFaltantes.add(v));
                    });
                    articulosEnFalta = Array.from(setFaltantes);
                    console.log('🛒 [REMITO-R] Artículos en falta encontrados (dual SKU + barcode):', articulosEnFalta);
                } catch (error) {
                    console.error('❌ [REMITO-R] Error al obtener artículos en falta:', error.message);
                    // Continuar sin artículos en falta si hay error
                    articulosEnFalta = [];
                }
            }
            
            // APLICAR OVERRIDES EFÍMEROS ANTES DE RENDERIZAR
            applyKilosOverrides([clienteData]);
            
            if (formato === 'pdf') {
                return generarPDF_Rediseñado(res, clienteData, esPendienteCompra, articulosEnFalta, esContextoProduccion);
            } else {
                return generarHTML_Rediseñado(res, clienteData, esPendienteCompra, articulosEnFalta);
            }
            
        } else if (presupuestos_ext_ids) {
            // CASO 3: Por lista de IDs externos (para "Imprimir todos" del acordeón o presupuesto individual por ID)
            const idsArray = presupuestos_ext_ids.split(',').map(id => id.trim().toLowerCase()).filter(id => id);
            console.log(`📋 [REMITO-R] Filtrando por ${idsArray.length} IDs externos:`, idsArray);
            
            query = `
                WITH presupuestos_filtrados AS (
                    SELECT 
                        p.id,
                        p.id_presupuesto_ext,
                        p.id_cliente,
                        p.fecha,
                        CAST(p.id_cliente AS integer) as cliente_id_int,
                        COALESCE(p.descuento, 0) as descuento
                    FROM public.presupuestos p
                    WHERE p.activo = true 
                      AND (
                        LOWER(p.id_presupuesto_ext) = ANY($1::text[])
                        OR p.id::text = ANY($1::text[])
                        OR REPLACE(LOWER(p.id_presupuesto_ext), 'b', 'v') = ANY(SELECT REPLACE(x, 'b', 'v') FROM UNNEST($1::text[]) x)
                      )
                )
                SELECT 
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'cliente_id', c.cliente_id,
                            'cliente_nombre', COALESCE(
                                NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''),
                                NULLIF(TRIM(c.nombre), ''),
                                'Cliente ' || c.cliente_id
                            ),
                            'perfil_id', COALESCE(cpi.perfil_id, 'DEFAULT'),
                            'presupuestos', (
                                SELECT JSON_AGG(
                                    JSON_BUILD_OBJECT(
                                        'id', pf2.id,
                                        'id_presupuesto_ext', pf2.id_presupuesto_ext,
                                        'fecha', pf2.fecha,
                                        'descuento', pf2.descuento,
                                        'articulos', (
                                            SELECT JSON_AGG(
                                                JSON_BUILD_OBJECT(
                                                    'articulo_numero', pd.articulo,
                                                    'codigo_barras', COALESCE(NULLIF(TRIM(a.codigo_barras), ''), NULLIF(TRIM(ba.codigo_barras::text), ''), NULLIF(TRIM(src.codigo_barras), ''), ''),
                                                    'sku_canonico', COALESCE(NULLIF(TRIM(a.numero), ''), NULLIF(TRIM(ba.articulo_id::text), ''), NULLIF(TRIM(src.articulo_numero), ''), pd.articulo),
                                                    'descripcion', CASE
                                                        WHEN COALESCE(pd.es_saldo_ingrediente, false) = true AND COALESCE(pd.kilos_saldo, 0) > 0 THEN
                                                            COALESCE(
                                                                NULLIF(TRIM(ba.descripcion_generada), ''),
                                                                NULLIF(TRIM(ba.descripcion), ''),
                                                                NULLIF(TRIM(a.nombre), ''),
                                                                NULLIF(TRIM(ing.nombre), ''),
                                                                pd.articulo
                                                            ) || ' (Saldo: ' || TRIM(TO_CHAR(pd.kilos_saldo, 'FM999990D999')) || ' kg)'
                                                        ELSE
                                                            COALESCE(
                                                                NULLIF(TRIM(ba.descripcion_generada), ''),
                                                                NULLIF(TRIM(ba.descripcion), ''),
                                                                NULLIF(TRIM(a.nombre), ''),
                                                                NULLIF(TRIM(ing.nombre), ''),
                                                                pd.articulo
                                                            )
                                                    END,
                                                    'cantidad', COALESCE(pd.cantidad, 0),
                                                    'precio1', pd.precio1,
                                                    'valor1', pd.valor1,
                                                    'descuento', pd.camp4,
                                                    'iva_tasa', pd.camp2,
                                                    'kilos_unidad', src.kilos_unidad,
                                                    'es_pack', src.es_pack,
                                                    'pack_unidades', src.pack_unidades,
                                                    'es_ingrediente', CASE WHEN ing.id IS NOT NULL THEN true ELSE false END
                                                ) ORDER BY pd.articulo
                                            )
                                            FROM public.presupuestos_detalles pd
                                            LEFT JOIN LATERAL (
                                                SELECT a_inner.numero, a_inner.codigo_barras, a_inner.nombre
                                                FROM public.articulos a_inner
                                                WHERE a_inner.numero = pd.articulo OR a_inner.codigo_barras = pd.articulo
                                                ORDER BY (a_inner.codigo_barras = pd.articulo) DESC
                                                LIMIT 1
                                            ) a ON true
                                            LEFT JOIN LATERAL (
                                                SELECT ba_inner.articulo_id, ba_inner.codigo_barras, ba_inner.descripcion_generada, ba_inner.descripcion
                                                FROM public.bunker_articulos ba_inner
                                                WHERE ba_inner.articulo_id::text = pd.articulo
                                                   OR ba_inner.codigo_barras::text = pd.articulo
                                                   OR (a.numero IS NOT NULL AND ba_inner.articulo_id::text = a.numero)
                                                ORDER BY (ba_inner.articulo_id::text = pd.articulo) DESC
                                                LIMIT 1
                                            ) ba ON true
                                            LEFT JOIN LATERAL (
                                                SELECT src_inner.articulo_numero, src_inner.codigo_barras, src_inner.kilos_unidad, src_inner.es_pack, src_inner.pack_unidades
                                                FROM public.stock_real_consolidado src_inner
                                                WHERE src_inner.articulo_numero = pd.articulo
                                                   OR src_inner.codigo_barras = pd.articulo
                                                   OR (a.numero IS NOT NULL AND src_inner.articulo_numero = a.numero)
                                                   OR (ba.articulo_id IS NOT NULL AND src_inner.articulo_numero = ba.articulo_id::text)
                                                ORDER BY (src_inner.codigo_barras = pd.articulo) DESC
                                                LIMIT 1
                                            ) src ON true
                                            LEFT JOIN LATERAL (
                                                SELECT ing_inner.id, ing_inner.codigo, ing_inner.nombre
                                                FROM public.ingredientes ing_inner
                                                WHERE a.numero IS NULL AND ba.articulo_id IS NULL
                                                  AND (ing_inner.id::text = pd.articulo OR ing_inner.codigo::text = pd.articulo)
                                                LIMIT 1
                                            ) ing ON true
                                            WHERE pd.id_presupuesto = pf2.id
                                        )
                                    ) ORDER BY pf2.fecha DESC
                                )
                                FROM presupuestos_filtrados pf2
                                WHERE pf2.cliente_id_int = c.cliente_id
                            )
                        ) ORDER BY c.cliente_id
                    ) as clientes_data
                FROM public.clientes c
                LEFT JOIN clientes_perfiles_impresion cpi ON cpi.id_cliente_ext = c.cliente_id::text
                WHERE EXISTS (
                    SELECT 1 FROM presupuestos_filtrados pf3
                    WHERE pf3.cliente_id_int = c.cliente_id
                );
            `;
            
            params = [idsArray];
            
            console.log('🔍 [REMITO-R] Consulta por IDs externos con parámetros:', params);
            result = await pool.query(query, params);
            
            if (result.rows.length === 0 || !result.rows[0].clientes_data) {
                console.log('❌ [REMITO-R] No se encontraron presupuestos para los IDs externos');
                return res.status(404).json({
                    success: false,
                    error: 'No se encontraron presupuestos confirmados',
                    detalle: 'No hay presupuestos con estado "Presupuesto/Orden" para los IDs externos especificados',
                    presupuestos_ext_ids: idsArray,
                    timestamp: new Date().toISOString()
                });
            }
            
            const clientesData = result.rows[0].clientes_data;
            console.log(`✅ [REMITO-R] Datos obtenidos para ${clientesData.length} clientes con IDs externos`);
            
            // 📸 GUARDAR SNAPSHOTS Y OBTENER DATOS DE MODIFICACIÓN para cada presupuesto
            console.log('📸 [SNAPSHOT] Iniciando guardado de snapshots para "Imprimir Todos"...');
            for (const cliente of clientesData) {
                for (const presupuesto of cliente.presupuestos) {
                    try {
                        // Obtener id_presupuesto y secuencia desde la BD
                        const presupuestoQuery = `
                            SELECT id, secuencia 
                            FROM public.presupuestos 
                            WHERE (id = $1 OR id_presupuesto_ext = $2) AND activo = true
                            ORDER BY (id = $1) DESC
                            LIMIT 1
                        `;
                        const presupuestoResult = await pool.query(presupuestoQuery, [presupuesto.id || 0, presupuesto.id_presupuesto_ext]);
                        
                        if (presupuestoResult.rows.length > 0) {
                            const { id: id_presupuesto, secuencia } = presupuestoResult.rows[0];
                            
                            // Agregar ID presupuesto al objeto para usar en generación
                            presupuesto._id_presupuesto = id_presupuesto;
                            
                            // Guardar snapshot (no bloquea la impresión si falla)
                            await guardarSnapshotImpresion(
                                id_presupuesto,
                                presupuesto.id_presupuesto_ext,
                                presupuesto.articulos || [],
                                secuencia
                            );
                            
                            // Obtener datos del snapshot para mostrar en impresión
                            const snapshotQuery = `
                                SELECT 
                                    id,
                                    motivo,
                                    secuencia_en_snapshot,
                                    numero_impresion,
                                    fecha_snapshot,
                                    diferencias_detalles
                                FROM presupuestos_snapshots
                                WHERE id_presupuesto = $1 AND activo = true
                                ORDER BY fecha_snapshot DESC
                                LIMIT 1
                            `;
                            
                            const snapshotResult = await pool.query(snapshotQuery, [id_presupuesto]);
                            
                            if (snapshotResult.rows.length > 0) {
                                const snapshot = snapshotResult.rows[0];
                                
                                // Agregar datos del snapshot al presupuesto para usar en la vista
                                presupuesto._snapshot = {
                                    motivo: snapshot.motivo,
                                    secuencia_en_snapshot: snapshot.secuencia_en_snapshot,
                                    numero_impresion: snapshot.numero_impresion,
                                    fecha_snapshot: snapshot.fecha_snapshot,
                                    diferencias_detalles: snapshot.diferencias_detalles
                                };
                                
                                const esModificado = snapshot.motivo === 'modificado' || 
                                                    snapshot.secuencia_en_snapshot === 'Imprimir_Modificado';
                                
                                if (esModificado) {
                                    console.log(`[PRINT-MOD] Usando snapshot modificado (id_snapshot=${snapshot.id}, id_presupuesto=${id_presupuesto}, numero_impresion=${snapshot.numero_impresion}, motivo=${snapshot.motivo}, fecha_snapshot=${snapshot.fecha_snapshot})`);
                                }
                            }
                        } else {
                            console.log(`⚠️ [SNAPSHOT] No se encontró presupuesto con id_ext: ${presupuesto.id_presupuesto_ext}`);
                        }
                    } catch (snapshotError) {
                        console.error(`❌ [SNAPSHOT] Error al guardar snapshot para ${presupuesto.id_presupuesto_ext}:`, snapshotError.message);
                        // Continuar con la impresión aunque falle el snapshot
                    }
                }
            }
            console.log('📸 [SNAPSHOT] Proceso de snapshots completado para "Imprimir Todos"');
            
            // APLICAR OVERRIDES EFÍMEROS ANTES DE RENDERIZAR
            applyKilosOverrides(clientesData);
            
            if (formato === 'pdf') {
                return generarPDF_TodosLosClientes(res, clientesData, fecha, esContextoProduccion);
            } else {
                return generarHTML_TodosLosClientes(res, clientesData, fecha, esContextoProduccion);
            }
            
        } else {
            // CASO 4: Todos los presupuestos por fecha (sin cliente específico)
            query = `
                WITH presupuestos_filtrados AS (
                    SELECT 
                        p.id,
                        p.id_presupuesto_ext,
                        p.id_cliente,
                        p.fecha,
                        CAST(p.id_cliente AS integer) as cliente_id_int,
                        COALESCE(p.descuento, 0) as descuento
                    FROM public.presupuestos p
                    WHERE p.activo = true 
                      AND REPLACE(LOWER(TRIM(p.estado)), ' ', '') = 'presupuesto/orden'
                      AND p.fecha::date <= $1::date
                )
                SELECT 
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'cliente_id', c.cliente_id,
                            'cliente_nombre', COALESCE(
                                NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''),
                                NULLIF(TRIM(c.nombre), ''),
                                'Cliente ' || c.cliente_id
                            ),
                            'presupuestos', (
                                SELECT JSON_AGG(
                                    JSON_BUILD_OBJECT(
                                        'id', pf2.id,
                                        'id_presupuesto_ext', pf2.id_presupuesto_ext,
                                        'fecha', pf2.fecha,
                                        'descuento', pf2.descuento,
                                        'articulos', (
                                            SELECT JSON_AGG(
                                                JSON_BUILD_OBJECT(
                                                    'articulo_numero', pd.articulo,
                                                    'codigo_barras', COALESCE(NULLIF(TRIM(a.codigo_barras), ''), NULLIF(TRIM(ba.codigo_barras::text), ''), NULLIF(TRIM(src.codigo_barras), ''), ''),
                                                    'sku_canonico', COALESCE(NULLIF(TRIM(a.numero), ''), NULLIF(TRIM(ba.articulo_id::text), ''), NULLIF(TRIM(src.articulo_numero), ''), pd.articulo),
                                                    'descripcion', CASE
                                                        WHEN COALESCE(pd.es_saldo_ingrediente, false) = true AND COALESCE(pd.kilos_saldo, 0) > 0 THEN
                                                            COALESCE(
                                                                NULLIF(TRIM(ba.descripcion_generada), ''),
                                                                NULLIF(TRIM(ba.descripcion), ''),
                                                                NULLIF(TRIM(a.nombre), ''),
                                                                NULLIF(TRIM(ing.nombre), ''),
                                                                pd.articulo
                                                            ) || ' (Saldo: ' || TRIM(TO_CHAR(pd.kilos_saldo, 'FM999990D999')) || ' kg)'
                                                        ELSE
                                                            COALESCE(
                                                                NULLIF(TRIM(ba.descripcion_generada), ''),
                                                                NULLIF(TRIM(ba.descripcion), ''),
                                                                NULLIF(TRIM(a.nombre), ''),
                                                                NULLIF(TRIM(ing.nombre), ''),
                                                                pd.articulo
                                                            )
                                                    END,
                                                    'cantidad', COALESCE(pd.cantidad, 0),
                                                    'precio1', pd.precio1,
                                                    'valor1', pd.valor1,
                                                    'descuento', pd.camp4,
                                                    'iva_tasa', pd.camp2,
                                                    'kilos_unidad', src.kilos_unidad,
                                                    'es_pack', src.es_pack,
                                                    'pack_unidades', src.pack_unidades,
                                                    'es_ingrediente', CASE WHEN ing.id IS NOT NULL THEN true ELSE false END
                                                ) ORDER BY pd.articulo
                                            )
                                            FROM public.presupuestos_detalles pd
                                            LEFT JOIN LATERAL (
                                                SELECT a_inner.numero, a_inner.codigo_barras, a_inner.nombre
                                                FROM public.articulos a_inner
                                                WHERE a_inner.numero = pd.articulo OR a_inner.codigo_barras = pd.articulo
                                                ORDER BY (a_inner.codigo_barras = pd.articulo) DESC
                                                LIMIT 1
                                            ) a ON true
                                            LEFT JOIN LATERAL (
                                                SELECT ba_inner.articulo_id, ba_inner.codigo_barras, ba_inner.descripcion_generada, ba_inner.descripcion
                                                FROM public.bunker_articulos ba_inner
                                                WHERE ba_inner.articulo_id::text = pd.articulo
                                                   OR ba_inner.codigo_barras::text = pd.articulo
                                                   OR (a.numero IS NOT NULL AND ba_inner.articulo_id::text = a.numero)
                                                ORDER BY (ba_inner.articulo_id::text = pd.articulo) DESC
                                                LIMIT 1
                                            ) ba ON true
                                            LEFT JOIN LATERAL (
                                                SELECT src_inner.articulo_numero, src_inner.codigo_barras, src_inner.kilos_unidad, src_inner.es_pack, src_inner.pack_unidades
                                                FROM public.stock_real_consolidado src_inner
                                                WHERE src_inner.articulo_numero = pd.articulo
                                                   OR src_inner.codigo_barras = pd.articulo
                                                   OR (a.numero IS NOT NULL AND src_inner.articulo_numero = a.numero)
                                                   OR (ba.articulo_id IS NOT NULL AND src_inner.articulo_numero = ba.articulo_id::text)
                                                ORDER BY (src_inner.codigo_barras = pd.articulo) DESC
                                                LIMIT 1
                                            ) src ON true
                                            LEFT JOIN LATERAL (
                                                SELECT ing_inner.id, ing_inner.codigo, ing_inner.nombre
                                                FROM public.ingredientes ing_inner
                                                WHERE a.numero IS NULL AND ba.articulo_id IS NULL
                                                  AND (ing_inner.id::text = pd.articulo OR ing_inner.codigo::text = pd.articulo)
                                                LIMIT 1
                                            ) ing ON true
                                            WHERE pd.id_presupuesto = pf2.id
                                        )
                                    ) ORDER BY pf2.fecha DESC
                                )
                                FROM presupuestos_filtrados pf2
                                WHERE pf2.cliente_id_int = c.cliente_id
                            )
                        ) ORDER BY c.cliente_id
                    ) as clientes_data
                FROM public.clientes c
                WHERE EXISTS (
                    SELECT 1 FROM presupuestos_filtrados pf3
                    WHERE pf3.cliente_id_int = c.cliente_id
                );
            `;
            
            params = [fecha || new Date().toISOString().split('T')[0]];
            
            console.log('🔍 [REMITO-R] Consulta general por fecha con parámetros:', params);
            result = await pool.query(query, params);
            
            if (result.rows.length === 0 || !result.rows[0].clientes_data) {
                console.log('❌ [REMITO-R] No se encontraron presupuestos confirmados para la fecha:', fecha);
                return res.status(404).json({
                    success: false,
                    error: 'No se encontraron presupuestos confirmados',
                    detalle: 'No hay presupuestos con estado "Presupuesto/Orden" para la fecha especificada',
                    fecha: fecha || new Date().toISOString().split('T')[0],
                    timestamp: new Date().toISOString()
                });
            }
            
            const clientesData = result.rows[0].clientes_data;
            console.log(`✅ [REMITO-R] Datos obtenidos para ${clientesData.length} clientes`);
            
            // 📸 GUARDAR SNAPSHOTS Y OBTENER DATOS DE MODIFICACIÓN para cada presupuesto
            console.log('📸 [SNAPSHOT] Iniciando guardado de snapshots para impresión por fecha...');
            for (const cliente of clientesData) {
                for (const presupuesto of cliente.presupuestos) {
                    try {
                        // Obtener id_presupuesto y secuencia desde la BD
                        const presupuestoQuery = `
                            SELECT id, secuencia 
                            FROM public.presupuestos 
                            WHERE (id = $1 OR id_presupuesto_ext = $2) AND activo = true
                            ORDER BY (id = $1) DESC
                            LIMIT 1
                        `;
                        const presupuestoResult = await pool.query(presupuestoQuery, [presupuesto.id || 0, presupuesto.id_presupuesto_ext]);
                        
                        if (presupuestoResult.rows.length > 0) {
                            const { id: id_presupuesto, secuencia } = presupuestoResult.rows[0];
                            
                            // Agregar ID presupuesto al objeto para usar en generación
                            presupuesto._id_presupuesto = id_presupuesto;
                            
                            // Guardar snapshot (no bloquea la impresión si falla)
                            await guardarSnapshotImpresion(
                                id_presupuesto,
                                presupuesto.id_presupuesto_ext,
                                presupuesto.articulos || [],
                                secuencia
                            );
                            
                            // Obtener datos del snapshot para mostrar en impresión
                            const snapshotQuery = `
                                SELECT 
                                    id,
                                    motivo,
                                    secuencia_en_snapshot,
                                    numero_impresion,
                                    fecha_snapshot,
                                    diferencias_detalles
                                FROM presupuestos_snapshots
                                WHERE id_presupuesto = $1 AND activo = true
                                ORDER BY fecha_snapshot DESC
                                LIMIT 1
                            `;
                            
                            const snapshotResult = await pool.query(snapshotQuery, [id_presupuesto]);
                            
                            if (snapshotResult.rows.length > 0) {
                                const snapshot = snapshotResult.rows[0];
                                
                                // Agregar datos del snapshot al presupuesto para usar en la vista
                                presupuesto._snapshot = {
                                    motivo: snapshot.motivo,
                                    secuencia_en_snapshot: snapshot.secuencia_en_snapshot,
                                    numero_impresion: snapshot.numero_impresion,
                                    fecha_snapshot: snapshot.fecha_snapshot,
                                    diferencias_detalles: snapshot.diferencias_detalles
                                };
                                
                                const esModificado = snapshot.motivo === 'modificado' || 
                                                    snapshot.secuencia_en_snapshot === 'Imprimir_Modificado';
                                
                                if (esModificado) {
                                    console.log(`[PRINT-MOD] Usando snapshot modificado (id_snapshot=${snapshot.id}, id_presupuesto=${id_presupuesto}, numero_impresion=${snapshot.numero_impresion}, motivo=${snapshot.motivo}, fecha_snapshot=${snapshot.fecha_snapshot})`);
                                }
                            }
                        } else {
                            console.log(`⚠️ [SNAPSHOT] No se encontró presupuesto con id_ext: ${presupuesto.id_presupuesto_ext}`);
                        }
                    } catch (snapshotError) {
                        console.error(`❌ [SNAPSHOT] Error al guardar snapshot para ${presupuesto.id_presupuesto_ext}:`, snapshotError.message);
                        // Continuar con la impresión aunque falle el snapshot
                    }
                }
            }
            console.log('📸 [SNAPSHOT] Proceso de snapshots completado para impresión por fecha');
            
            // APLICAR OVERRIDES EFÍMEROS ANTES DE RENDERIZAR
            applyKilosOverrides(clientesData);
            
            if (formato === 'pdf') {
                return generarPDF_TodosLosClientes(res, clientesData, fecha, esContextoProduccion);
            } else {
                return generarHTML_TodosLosClientes(res, clientesData, fecha, esContextoProduccion);
            }
        }
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error en impresión:', error);
        console.error('❌ [REMITO-R] Stack trace:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * ==========================================
 * FUNCIONES COMPARTIDAS DE RENDERIZADO (DRY)
 * ==========================================
 * Estas funciones son consumidas tanto por la impresión individual como por la impresión por lote,
 * garantizando que el documento generado sea visual y estructuralmente idéntico.
 */

/**
 * Genera la cadena CSS completa para el remito formato R.
 * Fuente única de estilos para todas las variantes de impresión HTML.
 * @returns {string} CSS para incluir en el <style> del HTML
 */
function generarCSSRemito() {
    return `
        @page {
            size: A4;
            margin: 1.5cm;
        }
        
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 0;
            line-height: 1.3; 
            color: #000;
            font-size: 11px;
        }
        
        .remito-container {
            max-width: 100%;
            margin: 0 auto;
            padding: 15px;
        }
        
        .page-break {
            page-break-after: always;
        }
        
        /* ENCABEZADO MODERNO Y MINIMALISTA */
        .header { 
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px; 
            border-bottom: 1px solid #333; 
            padding-bottom: 12px; 
        }
        
        .header-left {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 15px;
            flex: 0 1 auto;
        }
        
        .modificacion-container {
            flex: 1 1 auto;
            text-align: center;
        }

        .modificacion-container h3 {
            font-size: 14px;
            color: #dc3545;
            font-weight: bold;
            margin: 0;
            line-height: 1;
        }
        
        .modificacion-container p {
            font-size: 9px;
            color: #666;
            margin: 2px 0 0 0;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: relative;
            margin-bottom: 10px;
        }
        
        .header-left {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: flex-start;
        }

        .header-center {
            flex: 1;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .header-right {
            flex: 1;
            text-align: right;
        }
        
        .logo-lamda-img {
            height: 30px;
            width: auto;
            display: block;
        }
        
        .letra-r {
            font-size: 20px;
            font-weight: bold;
            color: #000;
            border: 2px solid #000;
            width: 34px;
            height: 34px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            text-align: center;
            line-height: 1;
            margin: 0 auto;
        }
        
        /* ESTILOS PARA ORDEN EN ESPERA */
        .orden-espera {
            font-size: 9px;
            font-weight: bold;
            color: #dc3545;
            border: 2px solid #dc3545;
            background: #fff3cd;
            padding: 6px 10px;
            border-radius: 4px;
            text-align: center;
            line-height: 1.2;
            letter-spacing: 0.5px;
        }
        
        /* Artículos en falta - fondo amarillo */
        .articulo-en-falta {
            background-color: #fff3cd !important;
            border-left: 4px solid #ffc107 !important;
        }
        
        .articulo-en-falta td {
            font-weight: 600 !important;
            color: #856404 !important;
        }
        
        /* Separador de secciones */
        .seccion-titulo {
            background: #f8f9fa;
            padding: 6px 8px;
            margin: 12px 0 5px 0;
            border-left: 4px solid #6c757d;
            font-weight: bold;
            font-size: 10px;
            text-transform: uppercase;
        }
        
        .seccion-titulo.en-falta {
            background: #fff3cd;
            border-left-color: #ffc107;
            color: #856404;
        }
        
        .fecha-emision { 
            font-size: 10px; 
            text-align: right;
            color: #666;
            white-space: nowrap;
        }
        
        .header-right {
            text-align: right;
            flex: 0 1 auto;
        }
        
        .empresa-alias {
            font-weight: bold;
            font-size: 12px;
            margin-bottom: 4px;
            white-space: nowrap;
        }
        
        /* DATOS DEL PEDIDO - COMPACTOS */
        .datos-pedido { 
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px; 
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        
        .numero-cliente {
            font-size: 14px;
            font-weight: bold;
        }
        
        .nombre-cliente {
            font-size: 12px;
            color: #333;
        }
        
        .codigo-presupuesto {
            font-size: 11px;
            font-family: monospace;
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 3px;
        }
        
        /* TABLA DE ARTÍCULOS - COMPACTA */
        .articulos-tabla { 
            width: 100%; 
            border-collapse: collapse; 
            margin: 10px 0; 
            font-size: 10px;
        }
        
        .articulos-tabla th { 
            background-color: #f8f9fa; 
            font-weight: 600; 
            text-align: left;
            padding: 6px 4px;
            border: 1px solid #dee2e6;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .articulos-tabla td { 
            padding: 4px; 
            border: 1px solid #dee2e6; 
            vertical-align: top;
        }
        
        .articulos-tabla .col-codigo {
            width: 20%;
            font-family: monospace;
            font-size: 9px;
            background: #fafafa;
        }
        
        .articulos-tabla .col-descripcion {
            width: 65%;
            word-wrap: break-word;
        }
        
        .articulos-tabla .col-cantidad {
            width: 15%;
            text-align: center;
            font-weight: 600;
        }
        
        /* CONTROL DE ENTREGA - REDISEÑADO */
        .control-entrega {
            margin-top: 25px;
            border: 1px solid #333;
            padding: 12px;
            background: #fafafa;
        }
        
        .control-entrega h4 {
            margin: 0 0 12px 0;
            font-size: 11px;
            text-align: center;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .campos-control {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-bottom: 12px;
        }
        
        .campo-firma {
            border-bottom: 1px solid #333;
            padding-bottom: 3px;
            min-height: 20px;
        }
        
        .campo-firma label {
            font-size: 9px;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
        }
        
        .campo-entregado {
            grid-column: 1 / -1;
            border-bottom: 1px solid #333;
            padding-bottom: 3px;
            min-height: 20px;
        }
        
        .nota-importante {
            margin-top: 10px;
            padding: 6px;
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 3px;
            font-size: 8px;
            text-align: justify;
            color: #856404;
        }
        
        /* BLOQUE DE CAMBIOS */
        .bloque-cambios {
            margin-top: 20px;
            margin-bottom: 15px;
            border: 2px solid #ffc107;
            background: #fffbf0;
            padding: 10px;
            border-radius: 4px;
        }
        
        .bloque-cambios h4 {
            margin: 0 0 10px 0;
            font-size: 11px;
            font-weight: bold;
            color: #856404;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .cambio-item {
            font-size: 9px;
            padding: 4px 0;
            border-bottom: 1px dashed #ffeaa7;
            color: #333;
        }
        
        .cambio-item:last-child {
            border-bottom: none;
        }
        
        .cambio-tipo {
            font-weight: bold;
            text-transform: uppercase;
            margin-right: 5px;
        }
        
        .cambio-tipo.modificado {
            color: #0066cc;
        }
        
        .cambio-tipo.agregado {
            color: #28a745;
        }
        
        .cambio-tipo.eliminado {
            color: #dc3545;
        }
        
        /* PIE DE PÁGINA MINIMALISTA */
        .pie-pagina {
            margin-top: 15px;
            text-align: center;
            font-size: 8px;
            color: #999;
            border-top: 1px solid #eee;
            padding-top: 8px;
        }
        
        /* ESTILOS DE IMPRESIÓN */
        @media print {
            body { 
                margin: 0; 
                font-size: 10px;
            }
            
            .remito-container {
                padding: 0;
            }
            
            .header {
                margin-bottom: 15px;
                padding-bottom: 8px;
            }
            
            .control-entrega {
                page-break-inside: avoid;
                margin-top: 20px;
            }
        }
    `;
}

/**
 * Genera el HTML de un presupuesto individual (una "página" del remito).
 * Función canónica consumida tanto por impresión individual como por lote.
 * @param {Object} params
 * @param {number|string} params.clienteId - ID del cliente
 * @param {string} params.clienteNombre - Nombre del cliente
 * @param {Object} params.presupuesto - Datos del presupuesto (con _snapshot, _id_presupuesto, articulos, id_presupuesto_ext, fecha)
 * @param {boolean} [params.esPendienteCompra=false] - Si es true, muestra "ORDEN EN ESPERA"
 * @param {Array} [params.articulosEnFalta=[]] - Array de códigos de artículos en falta
 * @param {string} params.fechaHoy - Fecha formateada
 * @param {string} params.horaHoy - Hora formateada
 * @param {number} params.paginaActual - Número de página actual
 * @param {number} params.totalPaginas - Total de páginas
 * @param {boolean} [params.agregarPageBreak=false] - Si debe agregar salto de página
 * @returns {string} HTML del presupuesto
 */
function generarHTMLPresupuestoUnico({
    clienteId,
    clienteNombre,
    perfilId = 'DEFAULT',
    presupuesto,
    esPendienteCompra = false,
    articulosEnFalta = [],
    fechaHoy,
    horaHoy,
    paginaActual,
    totalPaginas,
    agregarPageBreak = false,
    esContextoProduccion = false
}) {
    const fechaPresupuesto = new Date(presupuesto.fecha).toLocaleDateString('es-AR');
    
    // Calcular datos para código de barras y total de artículos
    const idPresupuesto = presupuesto._id_presupuesto || 0;
    const numeroImpresion = presupuesto._snapshot?.numero_impresion || 1;
    const codigoBarras = `${idPresupuesto}-${numeroImpresion}`;
    
    // Configuración de Perfiles Activos Dinámicos
    const esPerfilEmilio = (perfilId === 'PERFIL_EMILIO' || perfilId === 'PERFIL_PRECIO_KILO' || clienteId == 1 || clienteId === '001');
    const esPerfilGreenCorner = (perfilId === 'TOTALIZADOR_MENS' || perfilId === 'PERFIL_GREEN_CORNER' || clienteId == 577 || clienteId === '577');

    // CORRECCIÓN: Se usa .length para contar items distintos
    const totalArticulos = calcularTotalArticulos(presupuesto.articulos || []);
    const svgCodigoBarras = generarSVGCodigoBarras(codigoBarras);
    
    console.log(`📊 [BARCODE] Código de barras generado: ${codigoBarras}, Total artículos: ${totalArticulos}`);

    // Determinar si el presupuesto fue modificado y generar el HTML correspondiente
    let modificacionHtml = '';
    if (presupuesto._snapshot) {
        const esModificado = presupuesto._snapshot.motivo === 'modificado' || 
                           presupuesto._snapshot.secuencia_en_snapshot === 'Imprimir_Modificado';
        
        if (esModificado) {
            const numeroModificacion = (presupuesto._snapshot.numero_impresion || 1) - 1;
            const fechaModificacion = new Date(presupuesto._snapshot.fecha_snapshot).toLocaleDateString('es-AR', {
                year: 'numeric', month: '2-digit', day: '2-digit'
            });

            modificacionHtml = `
                <div class="modificacion-container">
                    <h3>MODIFICADO ${numeroModificacion}</h3>
                    <p>Fecha de modificación: ${fechaModificacion}</p>
                </div>
`;
        }
    }
    
    let html = `
    <div class="remito-container${agregarPageBreak ? ' page-break' : ''}">
        <!-- ENCABEZADO MODERNO -->
        <div class="header">
            <div class="header-left">
                <img src="/img/logo_LAMDA_grande.png" class="logo-lamda-img" alt="LAMDA" onerror="this.style.display='none'">
            </div>
            
            <div class="header-center">
                ${esPendienteCompra ? 
                    '<div class="orden-espera">ORDEN EN ESPERA</div>' : 
                    '<div class="letra-r">R</div>'
                }
            </div>
            
            ${modificacionHtml}

            <div class="header-right">
                <div class="empresa-alias">ALIAS: LAMDA.SER.MARTIN</div>
                <div class="fecha-emision" style="margin-bottom: 2px;">
                    ${fechaHoy} - ${horaHoy}
                </div>
                <div style="font-size: 10px; color: #666;">
                    WhatsApp: 221 6615746
                </div>
            </div>
        </div>
        
        <!-- DATOS DEL PEDIDO -->
        <div class="datos-pedido">
            <div>
                <div class="numero-cliente">N° de Cliente: ${clienteId}</div>
                <div class="nombre-cliente">${clienteNombre}</div>
            </div>
            <div>
                <div class="codigo-presupuesto">${presupuesto.id_presupuesto_ext}</div>
                <div style="font-size: 10px; color: #666; margin-top: 4px;">Fecha: ${fechaPresupuesto}</div>
                <div style="font-size: 14px; font-weight: bold; color: #2c3e50; margin-top: 10px; text-align: right;">
                    Total Items Distintos: ${totalArticulos}
                </div>
            </div>
        </div>
        
        </div>
        
        <!-- TABLA DE ARTÍCULOS -->
        <table class="articulos-tabla">
            <thead>
                <tr>
                    <th class="col-codigo">Código</th>
                    <th class="col-descripcion" ${esPerfilEmilio ? 'style="width: 35%;"' : ''}>Descripción del Artículo</th>
                    <th class="col-cantidad" ${esPerfilEmilio ? 'style="width: 10%;"' : ''}>Cantidad</th>
                    ${esPerfilEmilio ? `
                    <th style="width: 15%; text-align: center;">$/UNID (FINAL)</th>
                    <th style="width: 15%; text-align: center;">$/KILO (FINAL)</th>
                    ` : ''}
                </tr>
            </thead>
            <tbody>
`;
    
    // Función auxiliar para renderizar celdas extra de Emilio
    const generarCeldasEmilio = (articulo) => {
        if (!esPerfilEmilio) return '';
        let metricas = motorCalculadoraFiscal.extraerCostoFinanciero(articulo, presupuesto);
        let txtUnidad = '-';
        let txtKilo = '-';
        if (metricas.validez) {
            if (metricas.precioUnidad !== null && metricas.precioUnidad > 0) {
                txtUnidad = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(metricas.precioUnidad);
            }
            if (metricas.precioPorKilo !== null && metricas.precioPorKilo > 0) {
                txtKilo = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(metricas.precioPorKilo);
            }
        }
        return `
            <td style="text-align: center; font-weight: bold;">${txtUnidad}</td>
            <td style="text-align: center; font-weight: bold;">${txtKilo}</td>
        `;
    };

    // Mostrar artículos de ESTE presupuesto
    if (presupuesto.articulos && presupuesto.articulos.length > 0) {
        const articulosSorted = presupuesto.articulos.sort((a, b) => a.articulo_numero.localeCompare(b.articulo_numero));
        
        // Si es pendiente de compra, separar artículos en falta (comparación dual SKU + codigo_barras)
        if (esPendienteCompra && articulosEnFalta.length > 0) {
            const estaEnFalta = (a) => {
                const candidatos = [a.articulo_numero, a.codigo_barras, a.sku_canonico, a.articulo]
                    .filter(Boolean)
                    .map(v => String(v).trim());
                return candidatos.some(c => articulosEnFalta.includes(c));
            };
            const articulosConStock = articulosSorted.filter(a => !estaEnFalta(a));
            const articulosSinStock = articulosSorted.filter(a => estaEnFalta(a));
            
            console.log(`🛒 [REMITO-R-HTML] Artículos CON stock:`, articulosConStock.length);
            console.log(`🛒 [REMITO-R-HTML] Artículos SIN stock:`, articulosSinStock.length);
            
            // Primero mostrar artículos CON stock (si hay)
            if (articulosConStock.length > 0) {
                html += `
                <tr>
                    <td colspan="${esPerfilEmilio ? '5' : '3'}" class="seccion-titulo">Artículos Disponibles</td>
                </tr>
`;
                articulosConStock.forEach(articulo => {
                    const tdExtra = generarCeldasEmilio(articulo);
                    const descFormateada = articulo.es_ingrediente 
                        ? `${articulo.descripcion} <span style="font-size: 0.8em; color: #64748b; font-style: italic; font-weight: normal;">(Ingrediente / Stock Cliente)</span>`
                        : articulo.descripcion;
                    html += `
                <tr>
                    <td class="col-codigo">${articulo.articulo_numero}</td>
                    <td class="col-descripcion">${descFormateada}</td>
                    <td class="col-cantidad">${articulo.cantidad}</td>
                    ${tdExtra}
                </tr>
`;
                });
            }
            
            // Luego mostrar artículos EN FALTA (destacados)
            if (articulosSinStock.length > 0) {
                html += `
                <tr>
                    <td colspan="${esPerfilEmilio ? '5' : '3'}" class="seccion-titulo en-falta">⚠️ Artículos en Falta</td>
                </tr>
`;
                articulosSinStock.forEach(articulo => {
                    const tdExtra = generarCeldasEmilio(articulo);
                    const descFormateada = articulo.es_ingrediente 
                        ? `${articulo.descripcion} <span style="font-size: 0.8em; color: #64748b; font-style: italic; font-weight: normal;">(Ingrediente / Stock Cliente)</span>`
                        : articulo.descripcion;
                    html += `
                <tr class="articulo-en-falta">
                    <td class="col-codigo">${articulo.articulo_numero}</td>
                    <td class="col-descripcion">${descFormateada}</td>
                    <td class="col-cantidad">${articulo.cantidad}</td>
                    ${tdExtra}
                </tr>
`;
                });
            }
        } else {
            // Modo normal (sin pendientes de compra)
            articulosSorted.forEach(articulo => {
                const tdExtra = generarCeldasEmilio(articulo);
                const descFormateada = articulo.es_ingrediente 
                    ? `${articulo.descripcion} <span style="font-size: 0.8em; color: #64748b; font-style: italic; font-weight: normal;">(Ingrediente / Stock Cliente)</span>`
                    : articulo.descripcion;
                html += `
                <tr>
                    <td class="col-codigo">${articulo.articulo_numero}</td>
                    <td class="col-descripcion">${descFormateada}</td>
                    <td class="col-cantidad">${articulo.cantidad}</td>
                    ${tdExtra}
                </tr>
`;
            });
        }
    } else {
        html += `
                <tr>
                    <td colspan="${perfilId === 'PERFIL_PRECIO_KILO' ? '4' : '3'}" style="text-align: center; font-style: italic; color: #666; padding: 15px;">
                        No hay artículos registrados
                    </td>
                </tr>
`;
    }
    
    html += `
            </tbody>
        </table>
`;

    if (perfilId === 'PERFIL_TOTAL_FACTURA' || esPerfilGreenCorner) {
        const totalRemito = motorCalculadoraFiscal.calcularTotalRemitoAcumulado(presupuesto.articulos || [], presupuesto);
        const fmtTotal = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(totalRemito);
        const txtTotal = esPerfilGreenCorner ? 'TOTAL A PAGAR:' : 'TOTAL REMITO NETO:';
        
        html += `
        <div style="background: #f0f0f0; border: 1px solid #ccc; padding: 8px 15px; text-align: right; margin-top: 10px; border-radius: 4px;">
            <span style="font-size: 13px; font-weight: bold; margin-right: 15px; color: #333;">${txtTotal}</span>
            <span style="font-size: 15px; font-weight: bold; color: #000;">${fmtTotal}</span>
        </div>
`;
    }
    
    // BLOQUE DE CAMBIOS (solo si el presupuesto fue modificado)
    if (presupuesto._snapshot) {
        const esModificado = presupuesto._snapshot.motivo === 'modificado' || 
                           presupuesto._snapshot.secuencia_en_snapshot === 'Imprimir_Modificado';
        
        if (esModificado && presupuesto._snapshot.diferencias_detalles) {
            const diferencias = presupuesto._snapshot.diferencias_detalles;
            
            // Filtrar solo diferencias relevantes (cambios de cantidad)
            const diferenciasRelevantes = diferencias.filter(dif => {
                if (dif.tipo_cambio === 'agregado' || dif.tipo_cambio === 'eliminado') {
                    return true;
                }
                if (dif.tipo_cambio === 'modificado') {
                    const cantAntes = parseFloat(dif.cantidad_antes || 0);
                    const cantDespues = parseFloat(dif.cantidad_despues || 0);
                    return cantAntes !== cantDespues;
                }
                return false;
            });
            
            if (diferenciasRelevantes.length > 0) {
                console.log(`[PRINT-MOD] Bloque de cambios agregado a impresión (${diferenciasRelevantes.length} diferencias relevantes)`);
                
                html += `
        <!-- BLOQUE DE CAMBIOS -->
        <div class="bloque-cambios">
            <h4>CAMBIOS:</h4>
`;
                
                diferenciasRelevantes.forEach(dif => {
                    const tipoClase = dif.tipo_cambio.toLowerCase();
                    let textoCambio = '';
                    
                    if (dif.tipo_cambio === 'modificado') {
                        textoCambio = `<span class="cambio-tipo ${tipoClase}">MODIFICADO:</span> ${dif.descripcion} – cantidad antes: ${dif.cantidad_antes}, cantidad después: ${dif.cantidad_despues}`;
                    } else if (dif.tipo_cambio === 'agregado') {
                        textoCambio = `<span class="cambio-tipo ${tipoClase}">AGREGADO:</span> ${dif.descripcion} – cantidad: ${dif.cantidad_despues}`;
                    } else if (dif.tipo_cambio === 'eliminado') {
                        textoCambio = `<span class="cambio-tipo ${tipoClase}">ELIMINADO:</span> ${dif.descripcion} – cantidad antes: ${dif.cantidad_antes}`;
                    }
                    
                    html += `
            <div class="cambio-item">${textoCambio}</div>
`;
                });
                
                html += `
        </div>
`;
            } else {
                console.log(`[PRINT-MOD] Snapshot modificado sin diferencias relevantes -> no se muestra bloque de cambios`);
            }
        }
    }
    
    html += `
        
        <!-- CONTROL DE ENTREGA REDISEÑADO -->
        <div class="control-entrega">
            <h4>Control de Entrega</h4>
            
            <div class="campos-control">
                <div class="campo-firma">
                    <label>Nombre legible de quien recibe</label>
                </div>
                
                <div class="campo-firma">
                    <label>Firma (opcional)</label>
                </div>
                
                <div class="campo-entregado">
                    <label>Entregado por</label>
                </div>
            </div>
            
            <div class="nota-importante">
                <strong>IMPORTANTE:</strong> Este comprobante se usa para armar el pedido y controlarlo en destino. 
                Al entregar, se puede sacar una foto del papel con el nombre escrito por quien recibe.
            </div>
        </div>
        
        <!-- CÓDIGO DE BARRAS AL FINAL -->
        <div style="text-align: center; margin: 15px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;">
            ${svgCodigoBarras}
        </div>

        <div class="pie-pagina">
            Sistema LAMDA - Presupuesto ${paginaActual} de ${totalPaginas} - ${new Date().toLocaleString('es-AR')}
        </div>
        
        ${esContextoProduccion && !esPendienteCompra ? `
        <!-- COMANDOS HARDWARE ON/OFF -->
        <div style="display: flex; justify-content: space-between; padding: 0 40px; margin-top: 20px;">
            <div style="text-align: center;">
                <div style="height: 35px; overflow: hidden; display: flex; justify-content: center;">
                    ${generarIMGComando('CMD-ON')}
                </div>
                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; font-family: sans-serif;">ON</div>
            </div>
            
            <div style="text-align: center;">
                <div style="height: 35px; overflow: hidden; display: flex; justify-content: center;">
                    ${generarIMGComando('CMD-OFF')}
                </div>
                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; font-family: sans-serif;">OFF</div>
            </div>
        </div>
        ` : ''}
    </div>
`;
    
    return html;
}

/**
 * Renderiza un presupuesto individual en un documento PDFKit.
 * Función canónica consumida tanto por impresión individual como por lote.
 * @param {Object} doc - Instancia de PDFKit
 * @param {Object} params - Parámetros del presupuesto
 * @param {number|string} params.clienteId
 * @param {string} params.clienteNombre
 * @param {Object} params.presupuesto
 * @param {boolean} [params.esPendienteCompra=false]
 * @param {Array} [params.articulosEnFalta=[]]
 * @param {string} params.fechaHoy
 * @param {string} params.horaHoy
 * @param {number} params.paginaActual
 * @param {number} params.totalPaginas
 */
function renderizarPDFPresupuestoUnico(doc, {
    clienteId,
    clienteNombre,
    perfilId = 'DEFAULT',
    presupuesto,
    esPendienteCompra = false,
    articulosEnFalta = [],
    fechaHoy,
    horaHoy,
    paginaActual,
    totalPaginas,
    esContextoProduccion = false,
    qrBuffer = null
}) {
    const fechaPresupuesto = new Date(presupuesto.fecha).toLocaleDateString('es-AR');
    
    // Calcular datos para código de barras y total de artículos
    const idPresupuesto = presupuesto._id_presupuesto || 0;
    const numeroImpresion = presupuesto._snapshot?.numero_impresion || 1;
    const codigoBarras = `${idPresupuesto}-${numeroImpresion}`;
    // CORRECCIÓN: Se usa .length para contar items distintos
    const totalArticulos = calcularTotalArticulos(presupuesto.articulos || []);
    const bufferCodigoBarras = generarBufferCodigoBarras(codigoBarras);
    
    let bufferComandoON = null;
    let bufferComandoOFF = null;
    
    // Solo generar e inyectar inyectores de hardware ON/OFF en contexto de Producción
    // y si no es un "Pendiente de Compra"
    if (esContextoProduccion && !esPendienteCompra) {
        bufferComandoON = generarBufferComando('CMD-ON');
        bufferComandoOFF = generarBufferComando('CMD-OFF');
        console.log(`📊 [BARCODE-PDF] Código principal: ${codigoBarras}, Total: ${totalArticulos}, Comandos On/Off: Generados`);
    } else {
        console.log(`📊 [BARCODE-PDF] Código principal: ${codigoBarras}, Total: ${totalArticulos}, Comandos On/Off: OMITIDOS (Contexto Comercial)`);
    }
    
    // ENCABEZADO
    const pathLogo = require('path').join(__dirname, '..', '..', 'facturacion', 'img', 'logo_LAMDA_grande.png');
    if (require('fs').existsSync(pathLogo)) {
        doc.image(pathLogo, 50, 42, { height: 30 });
    } else {
        doc.fontSize(20).font('Helvetica-Bold').fillColor('black').text('LAMDA', 50, 50);
    }
    
    // R normal / ORDEN EN ESPERA / INDICADOR MODIFICADO en el centro del encabezado
    const esModificadoDoc = presupuesto._snapshot && (
        presupuesto._snapshot.motivo === 'modificado' || 
        presupuesto._snapshot.secuencia_en_snapshot === 'Imprimir_Modificado'
    );

    if (esPendienteCompra) {
        doc.fillColor('#dc3545').strokeColor('#dc3545').lineWidth(2)
           .roundedRect(237, 42, 120, 34, 4).stroke();
        doc.fillColor('#fff3cd').rect(238, 43, 118, 32).fill();
        doc.fillColor('#dc3545').fontSize(9).font('Helvetica-Bold')
           .text('ORDEN EN ESPERA', 237, 54, { width: 120, align: 'center' });
        doc.fillColor('black');
    } else if (esModificadoDoc) {
        const numeroModificacion = (presupuesto._snapshot.numero_impresion || 1) - 1;
        const fechaModificacion = new Date(presupuesto._snapshot.fecha_snapshot).toLocaleDateString('es-AR');
        
        // R versión compacta en X = 285, Y = 36 (arriba del texto MODIFICADO)
        doc.lineWidth(1.2).strokeColor('black')
           .roundedRect(285, 36, 25, 23, 3).stroke();
        doc.fontSize(13).font('Helvetica-Bold').fillColor('black')
           .text('R', 285, 40, { width: 25, align: 'center' });

        // Texto MODIFICADO N centrado debajo de la R (Y = 63)
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#dc3545')
            .text(`MODIFICADO ${numeroModificacion}`, doc.page.margins.left, 63, {
               width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
               align: 'center'
            });
        
        // Fecha de modificación centrada debajo (Y = 76)
        doc.fontSize(7.5).font('Helvetica').fillColor('#666666')
            .text(`Fecha de modificación: ${fechaModificacion}`, doc.page.margins.left, 76, {
               width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
               align: 'center'
            });

        console.log(`[PRINT-MOD] PDF: Agregado indicador Modificado ${numeroModificacion} para presupuesto ${presupuesto.id_presupuesto_ext}`);
    } else {
        // R normal centrada en X = 280 (Centro del papel A4)
        doc.lineWidth(1.5).strokeColor('black')
           .roundedRect(280, 42, 34, 34, 4).stroke();
        doc.fontSize(20).font('Helvetica-Bold').fillColor('black')
           .text('R', 280, 49, { width: 34, align: 'center' });
    }
    
    doc.fontSize(10).font('Helvetica-Bold').fillColor('black')
       .text('ALIAS: LAMDA.SER.MARTIN', 395, 40, { width: 150, align: 'right' });
    doc.fontSize(10).font('Helvetica').fillColor('#666666')
       .text(`${fechaHoy} - ${horaHoy}`, 395, 55, { width: 150, align: 'right' });
    doc.fontSize(10).font('Helvetica').fillColor('#666666')
       .text('WhatsApp: 221 6615746', 395, 68, { width: 150, align: 'right' });
    doc.fillColor('black');
    
    doc.strokeColor('#cccccc').lineWidth(0.5)
       .moveTo(50, 90).lineTo(545, 90).stroke()
       .strokeColor('black').lineWidth(1);
    
    // DATOS DEL PEDIDO
    doc.fontSize(11).font('Helvetica').text(`N° de Cliente:`, 50, 105);
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#2c3e50')
       .text(`${clienteId}`, 140, 100);
    doc.fontSize(11).font('Helvetica').fillColor('black')
       .text(clienteNombre, 50, 125);
    
    // Código de presupuesto y fecha
    doc.fontSize(9).font('Helvetica').fillColor('#7f8c8d')
       .text(presupuesto.id_presupuesto_ext, 450, 105);
    doc.fontSize(8).fillColor('#999999')
       .text(`Fecha: ${fechaPresupuesto}`, 450, 118);
    
    // TOTAL ARTÍCULOS
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#2c3e50')
       .text(`Items Distintos: ${totalArticulos}`, 395, 134, { width: 150, align: 'right' });
    
    doc.fillColor('black');
    
    // TABLA DE ARTÍCULOS
    const tablaY = 150;
    
    const esPerfilEmilio = (perfilId === 'PERFIL_EMILIO' || perfilId === 'PERFIL_PRECIO_KILO' || clienteId == 1 || clienteId === '001');
    const esPerfilGreenCorner = (perfilId === 'TOTALIZADOR_MENS' || perfilId === 'PERFIL_GREEN_CORNER' || clienteId == 577 || clienteId === '577');
    
    let hasPrecioKilo = esPerfilEmilio;
    let colWidths = [85, 340, 65];
    if (hasPrecioKilo) {
        colWidths = [65, 225, 50, 75, 75]; // Total 490
    }
    
    const rowHeight = 22;
    
    // Encabezados
    doc.fillColor('#f8f9fa').rect(50, tablaY, colWidths.reduce((a,b)=>a+b, 0), rowHeight).fill();
    doc.fillColor('black').fontSize(9).font('Helvetica-Bold');
    doc.rect(50, tablaY, colWidths[0], rowHeight).stroke();
    doc.text('CÓDIGO', 55, tablaY + 8);
    doc.rect(50 + colWidths[0], tablaY, colWidths[1], rowHeight).stroke();
    doc.text('DESCRIPCIÓN DEL ARTÍCULO', 55 + colWidths[0], tablaY + 8);
    doc.rect(50 + colWidths[0] + colWidths[1], tablaY, colWidths[2], rowHeight).stroke();
    doc.text('CANT.', 55 + colWidths[0] + colWidths[1], tablaY + 8, { align: 'center', width: colWidths[2] });

    if (hasPrecioKilo) {
        doc.rect(50 + colWidths[0] + colWidths[1] + colWidths[2], tablaY, colWidths[3], rowHeight).stroke();
        doc.text('$/UNID (FINAL)', 55 + colWidths[0] + colWidths[1] + colWidths[2], tablaY + 8, { align: 'center', width: colWidths[3] });
        
        doc.rect(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], tablaY, colWidths[4], rowHeight).stroke();
        doc.text('$/KILO (FINAL)', 55 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], tablaY + 8, { align: 'center', width: colWidths[4] });
    }
    
    // Artículos de ESTE presupuesto solamente
    let currentY = tablaY + rowHeight;
    
    if (presupuesto.articulos && presupuesto.articulos.length > 0) {
        const articulosSorted = presupuesto.articulos.sort((a, b) => a.articulo_numero.localeCompare(b.articulo_numero));
        
        // Si es pendiente de compra, separar artículos (comparación dual SKU + codigo_barras)
        if (esPendienteCompra && articulosEnFalta.length > 0) {
            const estaEnFalta = (a) => {
                const candidatos = [a.articulo_numero, a.codigo_barras, a.sku_canonico, a.articulo]
                    .filter(Boolean)
                    .map(v => String(v).trim());
                return candidatos.some(c => articulosEnFalta.includes(c));
            };
            const articulosConStock = articulosSorted.filter(a => !estaEnFalta(a));
            const articulosSinStock = articulosSorted.filter(a => estaEnFalta(a));
            
            // Artículos CON stock
            if (articulosConStock.length > 0) {
                // Título de sección
                doc.fillColor('#f8f9fa').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
                doc.fillColor('#6c757d').fontSize(10).font('Helvetica-Bold')
                   .text('ARTÍCULOS DISPONIBLES', 55, currentY + 7);
                doc.fillColor('black');
                currentY += rowHeight;
                
                articulosConStock.forEach((articulo, index) => {
                    if (index % 2 === 1) {
                        doc.fillColor('#f8f9fa').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
                    }
                    doc.fillColor('black');
                    
                    // Bordes
                    doc.moveTo(50, currentY).lineTo(50, currentY + rowHeight).stroke();
                    doc.moveTo(50 + colWidths[0], currentY).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                    doc.moveTo(50, currentY + rowHeight).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                    
                    doc.fontSize(9).font('Helvetica').fillColor('#495057')
                       .text(articulo.articulo_numero, 55, currentY + 7, { width: colWidths[0] - 10 });
                    
                    doc.moveTo(50 + colWidths[0] + colWidths[1], currentY).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                    doc.moveTo(50 + colWidths[0], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                    
                    let descripcion = articulo.es_ingrediente ? `${articulo.descripcion} (Stock Cliente)` : articulo.descripcion;
                    
                    let descFontSize = 12;
                    let descOffsetY = 5;
                    if (descripcion.length > 55) {
                        descFontSize = 7.5;
                        descOffsetY = 3.5;
                    } else if (descripcion.length > 40) {
                        descFontSize = 8.5;
                        descOffsetY = 4.5;
                    } else if (descripcion.length > 25) {
                        descFontSize = 9.5;
                        descOffsetY = 5.5;
                    } else if (descripcion.length > 18) {
                        descFontSize = 11;
                        descOffsetY = 5.5;
                    }
                    
                    doc.fontSize(descFontSize).font('Helvetica').fillColor('black')
                       .text(descripcion, 60 + colWidths[0], currentY + descOffsetY, { width: colWidths[1] - 20 });
                    
                    doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                    doc.moveTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                    
                    doc.fontSize(14).font('Helvetica-Bold').fillColor('#2c3e50')
                       .text(articulo.cantidad.toString(), 55 + colWidths[0] + colWidths[1], currentY + 4, { 
                           width: colWidths[2], 
                           align: 'center' 
                       });

                    // Columna especial Precio/Kilo
                    if (hasPrecioKilo) {
                        doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + rowHeight).stroke();
                        doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + rowHeight).stroke();
                        
                        doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], currentY + rowHeight).stroke();
                        doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], currentY + rowHeight).stroke();
                        
                        let metricas = motorCalculadoraFiscal.extraerCostoFinanciero(articulo, presupuesto);
                        let txtUnidad = '-';
                        let txtKilo = '-';
                        if (metricas.validez) {
                            if (metricas.precioUnidad !== null && metricas.precioUnidad > 0) {
                                txtUnidad = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(metricas.precioUnidad);
                            }
                            if (metricas.precioPorKilo !== null && metricas.precioPorKilo > 0) {
                                txtKilo = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(metricas.precioPorKilo);
                            }
                        }
                        
                        // Celda $/UNIDAD
                        doc.fontSize(10).font('Helvetica-Bold').fillColor('black')
                           .text(txtUnidad, 55 + colWidths[0] + colWidths[1] + colWidths[2], currentY + 6, { 
                               width: colWidths[3], align: 'center' 
                           });
                           
                        // Celda $/KILO
                        doc.fontSize(10).font('Helvetica-Bold').fillColor('black')
                           .text(txtKilo, 55 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + 6, { 
                               width: colWidths[4], align: 'center' 
                           });
                    }
                    
                    currentY += rowHeight;
                });
            }
            
            // Artículos SIN stock (EN FALTA)
            if (articulosSinStock.length > 0) {
                // Título de sección
                doc.fillColor('#fff3cd').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2] + (hasPrecioKilo ? colWidths[3] : 0), rowHeight).fill();
                doc.fillColor('#856404').fontSize(10).font('Helvetica-Bold')
                   .text('ARTÍCULOS EN FALTA', 55, currentY + 7);
                doc.fillColor('black');
                currentY += rowHeight;
                
                articulosSinStock.forEach((articulo, index) => {
                    // Fondo amarillo para artículos en falta
                    doc.fillColor('#fff3cd').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
                    doc.fillColor('black');
                    
                    // Borde izquierdo naranja
                    doc.strokeColor('#ffc107').lineWidth(4)
                       .moveTo(50, currentY).lineTo(50, currentY + rowHeight).stroke();
                    doc.strokeColor('black').lineWidth(1);
                    
                    // Bordes normales
                    doc.moveTo(50 + colWidths[0], currentY).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                    doc.moveTo(50, currentY + rowHeight).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                    
                    doc.fontSize(9).font('Helvetica-Bold').fillColor('#856404')
                       .text(articulo.articulo_numero, 55, currentY + 7, { width: colWidths[0] - 10 });
                    
                    doc.moveTo(50 + colWidths[0] + colWidths[1], currentY).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                    doc.moveTo(50 + colWidths[0], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                    
                    let descripcion = articulo.descripcion;
                    
                    let descFontSize = 12;
                    let descOffsetY = 5;
                    if (descripcion.length > 55) {
                        descFontSize = 7.5;
                        descOffsetY = 3.5;
                    } else if (descripcion.length > 40) {
                        descFontSize = 8.5;
                        descOffsetY = 4.5;
                    } else if (descripcion.length > 25) {
                        descFontSize = 9.5;
                        descOffsetY = 5.5;
                    } else if (descripcion.length > 18) {
                        descFontSize = 11;
                        descOffsetY = 5.5;
                    }
                    
                    doc.fontSize(descFontSize).font('Helvetica-Bold').fillColor('#856404')
                       .text(descripcion, 60 + colWidths[0], currentY + descOffsetY, { width: colWidths[1] - 20 });
                    
                    doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                    doc.moveTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                    
                    doc.fontSize(14).font('Helvetica-Bold').fillColor('#856404')
                       .text(articulo.cantidad.toString(), 55 + colWidths[0] + colWidths[1], currentY + 4, { 
                           width: colWidths[2], 
                           align: 'center' 
                       });

                    // Columna especial Precio/Kilo
                    if (hasPrecioKilo) {
                        doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + rowHeight).stroke();
                        doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + rowHeight).stroke();
                        
                        doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], currentY + rowHeight).stroke();
                        doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], currentY + rowHeight).stroke();
                        
                        let metricas = motorCalculadoraFiscal.extraerCostoFinanciero(articulo, presupuesto);
                        let txtUnidad = '-';
                        let txtKilo = '-';
                        if (metricas.validez) {
                            if (metricas.precioUnidad !== null && metricas.precioUnidad > 0) {
                                txtUnidad = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(metricas.precioUnidad);
                            }
                            if (metricas.precioPorKilo !== null && metricas.precioPorKilo > 0) {
                                txtKilo = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(metricas.precioPorKilo);
                            }
                        }
                        
                        // Celda $/UNIDAD
                        doc.fontSize(10).font('Helvetica-Bold').fillColor('#856404')
                           .text(txtUnidad, 55 + colWidths[0] + colWidths[1] + colWidths[2], currentY + 6, { 
                               width: colWidths[3], align: 'center' 
                           });
                           
                        // Celda $/KILO
                        doc.fontSize(10).font('Helvetica-Bold').fillColor('#856404')
                           .text(txtKilo, 55 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + 6, { 
                               width: colWidths[4], align: 'center' 
                           });
                    }
                    
                    currentY += rowHeight;
                });
            }
        } else {
            // Modo normal (sin pendientes de compra)
            articulosSorted.forEach((articulo, index) => {
                if (index % 2 === 1) {
                    doc.fillColor('#f8f9fa').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2] + (hasPrecioKilo ? colWidths[3] : 0), rowHeight).fill();
                }
                doc.fillColor('black');
                
                // Bordes
                doc.moveTo(50, currentY).lineTo(50, currentY + rowHeight).stroke();
                doc.moveTo(50 + colWidths[0], currentY).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                doc.moveTo(50, currentY + rowHeight).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                
                doc.fontSize(9).font('Helvetica').fillColor('#495057')
                   .text(articulo.articulo_numero, 55, currentY + 7, { width: colWidths[0] - 10 });
                
                doc.moveTo(50 + colWidths[0] + colWidths[1], currentY).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                doc.moveTo(50 + colWidths[0], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                
                let descripcion = articulo.es_ingrediente ? `${articulo.descripcion} (Stock Cliente)` : articulo.descripcion;
                
                let descFontSize = 12;
                let descOffsetY = 5;
                if (descripcion.length > 55) {
                    descFontSize = 7.5;
                    descOffsetY = 3.5;
                } else if (descripcion.length > 40) {
                    descFontSize = 8.5;
                    descOffsetY = 4.5;
                } else if (descripcion.length > 25) {
                    descFontSize = 9.5;
                    descOffsetY = 5.5;
                } else if (descripcion.length > 18) {
                    descFontSize = 11;
                    descOffsetY = 5.5;
                }
                
                doc.fontSize(descFontSize).font('Helvetica').fillColor('black')
                   .text(descripcion, 60 + colWidths[0], currentY + descOffsetY, { width: colWidths[1] - 20 });
                
                doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                doc.moveTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                
                doc.fontSize(14).font('Helvetica-Bold').fillColor('#2c3e50')
                   .text(articulo.cantidad.toString(), 55 + colWidths[0] + colWidths[1], currentY + 4, { 
                       width: colWidths[2], 
                       align: 'center' 
                   });

                // Columna especial Precio/Kilo
                if (hasPrecioKilo) {
                    doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + rowHeight).stroke();
                    doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + rowHeight).stroke();
                    
                    doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], currentY + rowHeight).stroke();
                    doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], currentY + rowHeight).stroke();
                    
                    let metricas = motorCalculadoraFiscal.extraerCostoFinanciero(articulo, presupuesto);
                    let txtUnidad = '-';
                    let txtKilo = '-';
                    if (metricas.validez) {
                        if (metricas.precioUnidad !== null && metricas.precioUnidad > 0) {
                            txtUnidad = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(metricas.precioUnidad);
                        }
                        if (metricas.precioPorKilo !== null && metricas.precioPorKilo > 0) {
                            txtKilo = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(metricas.precioPorKilo);
                        }
                    }
                    
                    // Celda $/UNIDAD
                    doc.fontSize(10).font('Helvetica-Bold').fillColor('black')
                       .text(txtUnidad, 55 + colWidths[0] + colWidths[1] + colWidths[2], currentY + 6, { 
                           width: colWidths[3], align: 'center' 
                       });
                       
                    // Celda $/KILO
                    doc.fontSize(10).font('Helvetica-Bold').fillColor('black')
                       .text(txtKilo, 55 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY + 6, { 
                           width: colWidths[4], align: 'center' 
                       });
                }
                
                currentY += rowHeight;
            });
        }
    } else {
        doc.fillColor('#f8f9fa').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
        doc.fillColor('black');
        doc.moveTo(50, currentY).lineTo(50, currentY + rowHeight).stroke();
        doc.moveTo(50 + colWidths[0], currentY).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
        doc.moveTo(50 + colWidths[0] + colWidths[1], currentY).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
        doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
        doc.moveTo(50, currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
        
        doc.fontSize(12).font('Helvetica').fillColor('#6c757d')
           .text('No hay artículos registrados', 55, currentY + 8, { 
               width: colWidths[0] + colWidths[1] + colWidths[2] - 10, 
               align: 'center' 
           });
        currentY += rowHeight;
    }
    
    // BLOQUE DE CAMBIOS (solo si el presupuesto fue modificado)
    if (presupuesto._snapshot) {
        const esModificado = presupuesto._snapshot.motivo === 'modificado' || 
                           presupuesto._snapshot.secuencia_en_snapshot === 'Imprimir_Modificado';
        
        if (esModificado && presupuesto._snapshot.diferencias_detalles) {
            const diferencias = presupuesto._snapshot.diferencias_detalles;
            
            // Filtrar solo diferencias relevantes
            const diferenciasRelevantes = diferencias.filter(dif => {
                if (dif.tipo_cambio === 'agregado' || dif.tipo_cambio === 'eliminado') {
                    return true;
                }
                if (dif.tipo_cambio === 'modificado') {
                    const cantAntes = parseFloat(dif.cantidad_antes || 0);
                    const cantDespues = parseFloat(dif.cantidad_despues || 0);
                    return cantAntes !== cantDespues;
                }
                return false;
            });
            
            if (diferenciasRelevantes.length > 0) {
                currentY += 10;
                
                const boxHeight = 26 + (diferenciasRelevantes.length * 15);
                
                // Título del bloque y marco contenedor amarillo con padding holgado
                doc.strokeColor('#ffc107').lineWidth(1.5)
                   .roundedRect(50, currentY, 490, boxHeight, 4).stroke();
                doc.fillColor('#fffbf0').rect(51, currentY + 1, 488, boxHeight - 2).fill();
                doc.fillColor('#856404').fontSize(10).font('Helvetica-Bold')
                   .text('CAMBIOS:', 62, currentY + 6);
                
                let lineY = currentY + 22;
                
                // Mostrar cada cambio con tipografía destacada y sin superponer el borde inferior
                diferenciasRelevantes.forEach((dif) => {
                    let textoCambio = '';
                    let colorTexto = '#333333';
                    
                    if (dif.tipo_cambio === 'modificado') {
                        textoCambio = `MODIFICADO: ${dif.descripcion} – cantidad: ${dif.cantidad_antes} → ${dif.cantidad_despues}`;
                        colorTexto = '#0066cc';
                    } else if (dif.tipo_cambio === 'agregado') {
                        textoCambio = `AGREGADO: ${dif.descripcion} – cantidad: ${dif.cantidad_despues}`;
                        colorTexto = '#28a745';
                    } else if (dif.tipo_cambio === 'eliminado') {
                        textoCambio = `ELIMINADO: ${dif.descripcion} – cantidad antes: ${dif.cantidad_antes}`;
                        colorTexto = '#dc3545';
                    }
                    
                    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(colorTexto)
                       .text(`• ${textoCambio}`, 62, lineY, { width: 470 });
                    
                    lineY += 15;
                });
                
                currentY += boxHeight + 8;
                
                console.log(`[PRINT-MOD] PDF: Bloque de cambios agregado (${diferenciasRelevantes.length} diferencias)`);
            }
        }
    }
    
    // Green Corner (Total al final de la tabla)
    if (perfilId === 'PERFIL_TOTAL_FACTURA' || esPerfilGreenCorner) {
        currentY += 10;
        const totalRemito = motorCalculadoraFiscal.calcularTotalRemitoAcumulado(presupuesto.articulos || [], presupuesto);
        const fmtTotal = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(totalRemito);
        const txtTotal = esPerfilGreenCorner ? 'TOTAL A PAGAR:' : 'TOTAL REMITO NETO:';
        
        doc.fillColor('#f0f0f0').roundedRect(240, currentY, 300, 25, 4).fill();
        doc.strokeColor('#cccccc').roundedRect(240, currentY, 300, 25, 4).stroke();
        
        doc.fillColor('#333333').fontSize(11).font('Helvetica-Bold')
           .text(txtTotal, 250, currentY + 7);
        
        doc.fillColor('black').fontSize(12).font('Helvetica-Bold')
           .text(fmtTotal, 390, currentY + 6, { width: 140, align: 'right' });
           
        currentY += 35;
    }
    
    // CONTROL DE ENTREGA
    const tieneQr = !!qrBuffer;
    const controlY = tieneQr ? Math.min(currentY + 10, 630) : Math.min(currentY + 15, 720);
    const controlHeight = 35;
    
    doc.fillColor('black').strokeColor('#dee2e6').lineWidth(1)
       .roundedRect(50, controlY, 490, controlHeight, 3).stroke();
    
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#495057')
       .text('CONTROL DE ENTREGA', 50, controlY + 8, { width: 490, align: 'center' });
    
    const campoY = controlY + 22;
    doc.fontSize(8).font('Helvetica').fillColor('#6c757d')
       .text('Nombre legible de quien recibe:', 60, campoY);
    doc.strokeColor('#dee2e6').lineWidth(0.5)
       .moveTo(60, campoY + 8).lineTo(280, campoY + 8).stroke();
    
    doc.text('Firma (opcional):', 300, campoY);
    doc.moveTo(300, campoY + 8).lineTo(520, campoY + 8).stroke();
    

    // CÓDIGO DE BARRAS PRINCIPAL Y PIE DE PÁGINA (Aislados del resto del contenido)
    const pieY = tieneQr ? Math.min(controlY + controlHeight + 40, 690) : Math.min(controlY + controlHeight + 50, 780);
    
    if (bufferCodigoBarras) {
        try {
            // El principal queda debajo del control de entrega pero siempre arriba del footer
            doc.image(bufferCodigoBarras, 200, pieY - 35, { width: 140, height: 35 });
            console.log(`✅ [BARCODE-PDF] Código de barras central reubicado`);
        } catch (imgError) {
            console.error(`❌ [BARCODE-PDF] Error al insertar imagen central:`, imgError.message);
        }
    }

    doc.fontSize(7).font('Helvetica').fillColor('#adb5bd')
       .text(`Sistema LAMDA - Presupuesto ${paginaActual} de ${totalPaginas} - ${new Date().toLocaleString('es-AR')}`,
             50, pieY + 5, { width: 490, align: 'center' });
             
    // =========================================================
    // INYECCIÓN INCÓGNITA HARDWARE (RELATIVA AL PIE DE CONTENIDO)
    // =========================================================
    // Posición Y basada en el barcode principal + margen
    const bottomRelY = pieY - 5;
    
    // INYECCIÓN DE COMANDO START (LEFT)
    if (bufferComandoON) {
        try {
            doc.image(bufferComandoON, 50, bottomRelY, { width: 70, height: 20 });
            doc.fontSize(7).font('Helvetica-Bold').fillColor('black')
               .text('ON', 50, bottomRelY + 22, { width: 70, align: 'center' });
        } catch (imgError) {
            console.error(`❌ [BARCODE-PDF] Error inyectando Comando ON:`, imgError.message);
        }
    }

    // INYECCIÓN DE COMANDO STOP (RIGHT)
    if (bufferComandoOFF) {
        try {
            doc.image(bufferComandoOFF, 475, bottomRelY, { width: 70, height: 20 });
            doc.fontSize(7).font('Helvetica-Bold').fillColor('black')
               .text('OFF', 475, bottomRelY + 22, { width: 70, align: 'center' });
        } catch (imgError) {
            console.error(`❌ [BARCODE-PDF] Error al insertar Comando OFF:`, imgError.message);
        }
    }
    
    // =========================================================
    // INYECCIÓN DE CÓDIGO QR EN LA BASE DEL DOCUMENTO
    // =========================================================
    if (tieneQr) {
        try {
            // QR centrado en la base
            const qrSize = 80;
            const qrX = 257.5; // (595 - 80) / 2 para centrado exacto
            const qrY = pieY + 25;
            
            doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
            doc.fontSize(7).font('Helvetica-Bold').fillColor('#2563eb')
               .text('QR DE CONTROL', 50, qrY + qrSize + 5, { width: 495, align: 'center' });
            console.log(`✅ [QR-PDF] Código QR renderizado en el pie de página`);
        } catch (qrErr) {
            console.error('❌ Error al renderizar QR en pie de página:', qrErr.message);
        }
    }
    
    doc.fillColor('black');
}


/**
 * ==========================================
 * FUNCIONES WRAPPER DE RENDERIZADO
 * ==========================================
 * Cada wrapper genera el esqueleto del documento (head/body para HTML, doc setup para PDF)
 * e itera los presupuestos delegando el renderizado individual a las funciones compartidas.
 */

/**
 * Genera HTML en formato remito rediseñado (Formato R) - Impresión individual por cliente
 * @param {boolean} esPendienteCompra - Si es true, muestra "ORDEN EN ESPERA" y marca artículos en falta
 * @param {Array} articulosEnFalta - Array de códigos de artículos que están en falta
 */
function generarHTML_Rediseñado(res, clienteData, esPendienteCompra = false, articulosEnFalta = [], esContextoProduccion = false) {
    try {
        const fechaHoy = new Date().toLocaleDateString('es-AR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const horaHoy = new Date().toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Remito R - Cliente ${clienteData.cliente_id}</title>
    <style>${generarCSSRemito()}</style>
</head>
<body>
    <div class="remito-container">
        <div class="header">
            <div class="header-left">
                <img src="/img/logo_LAMDA_grande.png" class="logo-lamda-img" alt="LAMDA" onerror="this.style.display='none'">
            </div>
            <div class="header-center">
                <div class="letra-r">R</div>
            </div>
            <div class="fecha-emision">
                ${fechaHoy} - ${horaHoy}
            </div>
        </div>
        
`;
        
        // Log de debug
        console.log('🛒 [REMITO-R-HTML] esPendienteCompra:', esPendienteCompra);
        console.log('🛒 [REMITO-R-HTML] articulosEnFalta:', articulosEnFalta);
        console.log('🛒 [REMITO-R-HTML] articulosEnFalta.length:', articulosEnFalta.length);
        
        // Generar una página por cada presupuesto usando la función compartida
        clienteData.presupuestos.forEach((presupuesto, presupIndex) => {
            console.log(`🛒 [REMITO-R-HTML] Presupuesto ${presupIndex}: ${presupuesto.id_presupuesto_ext}`);
            console.log(`🛒 [REMITO-R-HTML] Aplicando título: ${esPendienteCompra ? 'ORDEN EN ESPERA' : 'R'}`);
            
            html += generarHTMLPresupuestoUnico({
                clienteId: clienteData.cliente_id,
                clienteNombre: clienteData.cliente_nombre,
                perfilId: clienteData.perfil_id,
                presupuesto,
                esPendienteCompra,
                articulosEnFalta,
                fechaHoy,
                horaHoy,
                paginaActual: presupIndex + 1,
                totalPaginas: clienteData.presupuestos.length,
                agregarPageBreak: presupIndex < clienteData.presupuestos.length - 1,
                esContextoProduccion
            });
        });
        
        html += `
</body>
</html>
`;
        
        console.log(`✅ [REMITO-R] HTML rediseñado generado para cliente: ${clienteData.cliente_nombre}`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error generando HTML rediseñado:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando remito HTML rediseñado',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Genera PDF en formato remito rediseñado (Formato R) - Impresión individual por cliente
 * @param {boolean} esPendienteCompra - Si es true, muestra "ORDEN EN ESPERA" y marca artículos en falta
 * @param {Array} articulosEnFalta - Array de códigos de artículos que están en falta
 */
async function generarPDF_Rediseñado(res, clienteData, esPendienteCompra = false, articulosEnFalta = [], esContextoProduccion = false) {
    try {
        let PDFDocument;
        try {
            PDFDocument = require('pdfkit');
        } catch (pdfError) {
            console.error('❌ [REMITO-R] PDFKit no disponible:', pdfError.message);
            return res.status(501).json({
                success: false,
                error: 'PDF no disponible - dependencia faltante',
                sugerencia: 'usar formato=html',
                timestamp: new Date().toISOString()
            });
        }
        
        const fechaHoy = new Date().toLocaleDateString('es-AR');
        const horaHoy = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const fechaArchivo = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const nombreArchivo = `remito-r-cliente-${clienteData.cliente_id}-${fechaArchivo}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
        
        const doc = new PDFDocument({ 
            margin: 40,
            size: 'A4',
            bufferPages: true
        });
        
        doc.pipe(res);
        
        // Generar una página por cada presupuesto usando la función compartida de forma asíncrona
        let presupIndex = 0;
        for (const presupuesto of clienteData.presupuestos) {
            if (presupIndex > 0) {
                doc.addPage();
            }
            
            let qrBuffer = null;
            try {
                const idLocal = presupuesto._id_presupuesto || presupuesto.id_presupuesto || 0;
                let supabasePedidoId = null;
                
                if (idLocal > 0) {
                    const resMap = await pool.query(
                        'SELECT supabase_pedido_id FROM public.b2b_pedidos_mapeo WHERE local_presupuesto_id = $1 LIMIT 1',
                        [idLocal]
                    );
                    const rawSupaId = resMap.rows[0]?.supabase_pedido_id;
                    if (rawSupaId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSupaId)) {
                        supabasePedidoId = rawSupaId;
                    }
                }
                
                // Fallback: Si no hay mapeo, pero id_presupuesto_ext es un UUID, lo usamos directamente
                if (!supabasePedidoId && presupuesto.id_presupuesto_ext) {
                    const esUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(presupuesto.id_presupuesto_ext);
                    if (esUUID) {
                        supabasePedidoId = presupuesto.id_presupuesto_ext;
                        console.log(`📲 [QR-PDF-FALLBACK] Usando id_presupuesto_ext como UUID para QR: ${supabasePedidoId}`);
                    }
                }
                
                // Sincronización on-the-fly si sigue sin mapeo
                if (!supabasePedidoId && idLocal > 0) {
                    try {
                        console.log(`📲 [QR-PDF] Pedido local #${idLocal} no sincronizado. Sincronizando on-the-fly...`);
                        const { subirPedidoEspecifico } = require('../../actualizaPrecios/syncB2BEstados');
                        supabasePedidoId = await subirPedidoEspecifico(pool, idLocal);
                    } catch (syncErr) {
                        console.error(`❌ Error en sincronización on-the-fly para presupuesto #${idLocal}:`, syncErr.message);
                    }
                }
                
                if (supabasePedidoId) {
                    const portalUrl = process.env.B2B_PORTAL_URL || 'https://proud-darkness-ac3d.miserrano75.workers.dev';
                    const qrUrl = `${portalUrl}/#/recepcion/${supabasePedidoId}`;
                    const QRCode = require('qrcode');
                    qrBuffer = await QRCode.toBuffer(qrUrl, { margin: 1, width: 85 });
                    console.log(`📲 [QR-PDF] QR generado con éxito para pedido B2B: ${supabasePedidoId}`);
                }
            } catch (qrErr) {
                console.error('❌ Error al generar QR para remito:', qrErr.message);
            }
            
            renderizarPDFPresupuestoUnico(doc, {
                clienteId: clienteData.cliente_id,
                clienteNombre: clienteData.cliente_nombre,
                perfilId: clienteData.perfil_id,
                presupuesto,
                esPendienteCompra,
                articulosEnFalta,
                fechaHoy,
                fechaHoy,
                horaHoy,
                paginaActual: presupIndex + 1,
                totalPaginas: clienteData.presupuestos.length,
                esContextoProduccion,
                qrBuffer
            });
            
            presupIndex++;
        }
        
        doc.end();
        
        console.log(`✅ [REMITO-R] PDF rediseñado generado: ${nombreArchivo} (${clienteData.presupuestos.length} páginas)`);
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error generando PDF rediseñado:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando remito PDF rediseñado',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Genera HTML para TODOS los clientes (impresión general / "Imprimir Todos")
 * Una hoja por cada presupuesto de cada cliente
 */
function generarHTML_TodosLosClientes(res, clientesData, fecha, esContextoProduccion = false) {
    try {
        const fechaHoy = new Date().toLocaleDateString('es-AR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const horaHoy = new Date().toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Remito R - Todos los Presupuestos</title>
    <style>${generarCSSRemito()}</style>
</head>
<body>
`;
        
        // Contar total de presupuestos
        let totalPresupuestos = 0;
        clientesData.forEach(cliente => {
            totalPresupuestos += cliente.presupuestos.length;
        });
        
        let presupuestoGlobalIndex = 0;
        
        // Iterar por cada cliente y cada presupuesto usando la función compartida
        clientesData.forEach((cliente, clienteIndex) => {
            cliente.presupuestos.forEach((presupuesto, presupIndex) => {
                presupuestoGlobalIndex++;
                const esUltimo = (clienteIndex === clientesData.length - 1) && (presupIndex === cliente.presupuestos.length - 1);
                
                html += generarHTMLPresupuestoUnico({
                    clienteId: cliente.cliente_id,
                    clienteNombre: cliente.cliente_nombre,
                    perfilId: cliente.perfil_id,
                    presupuesto,
                    esPendienteCompra: false,
                    articulosEnFalta: [],
                    fechaHoy,
                    horaHoy,
                    paginaActual: presupuestoGlobalIndex,
                    totalPaginas: totalPresupuestos,
                    agregarPageBreak: !esUltimo,
                    esContextoProduccion
                });
            });
        });
        
        html += `
</body>
</html>
`;
        
        console.log(`✅ [REMITO-R] HTML general generado: ${totalPresupuestos} presupuestos de ${clientesData.length} clientes`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error generando HTML general:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando remito HTML general',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Genera PDF para TODOS los clientes (impresión general / "Imprimir Todos")
 * Una página por cada presupuesto de cada cliente
 */
async function generarPDF_TodosLosClientes(res, clientesData, fecha, esContextoProduccion = false) {
    try {
        let PDFDocument;
        try {
            PDFDocument = require('pdfkit');
        } catch (pdfError) {
            console.error('❌ [REMITO-R] PDFKit no disponible:', pdfError.message);
            return res.status(501).json({
                success: false,
                error: 'PDF no disponible - dependencia faltante',
                sugerencia: 'usar formato=html',
                timestamp: new Date().toISOString()
            });
        }
        
        const fechaHoy = new Date().toLocaleDateString('es-AR');
        const horaHoy = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const fechaArchivo = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const nombreArchivo = `remito-r-todos-${fechaArchivo}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
        
        const doc = new PDFDocument({ 
            margin: 40,
            size: 'A4',
            bufferPages: true
        });
        
        doc.pipe(res);
        
        // Contar total de presupuestos
        let totalPresupuestos = 0;
        clientesData.forEach(cliente => {
            totalPresupuestos += cliente.presupuestos.length;
        });
        
        let presupuestoGlobalIndex = 0;
        
        // Iterar por cada cliente y cada presupuesto usando la función compartida de forma asíncrona
        for (const cliente of clientesData) {
            for (const presupuesto of cliente.presupuestos) {
                if (presupuestoGlobalIndex > 0) {
                    doc.addPage();
                }
                
                presupuestoGlobalIndex++;
                
                let qrBuffer = null;
                try {
                    const idLocal = presupuesto._id_presupuesto || presupuesto.id_presupuesto || 0;
                    let supabasePedidoId = null;
                    
                    if (idLocal > 0) {
                        const resMap = await pool.query(
                            'SELECT supabase_pedido_id FROM public.b2b_pedidos_mapeo WHERE local_presupuesto_id = $1 LIMIT 1',
                            [idLocal]
                        );
                        const rawSupaId = resMap.rows[0]?.supabase_pedido_id;
                        if (rawSupaId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSupaId)) {
                            supabasePedidoId = rawSupaId;
                        }
                    }
                    
                    // Fallback: Si no hay mapeo, pero id_presupuesto_ext es un UUID, lo usamos directamente
                    if (!supabasePedidoId && presupuesto.id_presupuesto_ext) {
                        const esUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(presupuesto.id_presupuesto_ext);
                        if (esUUID) {
                            supabasePedidoId = presupuesto.id_presupuesto_ext;
                            console.log(`📲 [QR-PDF-FALLBACK] Usando id_presupuesto_ext como UUID para QR: ${supabasePedidoId}`);
                        }
                    }
                    
                    // Sincronización on-the-fly si sigue sin mapeo
                    if (!supabasePedidoId && idLocal > 0) {
                        try {
                            console.log(`📲 [QR-PDF] Pedido local #${idLocal} no sincronizado. Sincronizando on-the-fly...`);
                            const { subirPedidoEspecifico } = require('../../actualizaPrecios/syncB2BEstados');
                            supabasePedidoId = await subirPedidoEspecifico(pool, idLocal);
                        } catch (syncErr) {
                            console.error(`❌ Error en sincronización on-the-fly para presupuesto #${idLocal}:`, syncErr.message);
                        }
                    }
                    
                    if (supabasePedidoId) {
                        const portalUrl = process.env.B2B_PORTAL_URL || 'https://proud-darkness-ac3d.miserrano75.workers.dev';
                        const qrUrl = `${portalUrl}/#/recepcion/${supabasePedidoId}`;
                        const QRCode = require('qrcode');
                        qrBuffer = await QRCode.toBuffer(qrUrl, { margin: 1, width: 85 });
                        console.log(`📲 [QR-PDF-GEN] QR generado para pedido B2B: ${supabasePedidoId}`);
                    }
                } catch (qrErr) {
                    console.error('❌ Error al generar QR para remito general:', qrErr.message);
                }
                
                renderizarPDFPresupuestoUnico(doc, {
                    clienteId: cliente.cliente_id,
                    clienteNombre: cliente.cliente_nombre,
                    perfilId: cliente.perfil_id,
                    presupuesto,
                    esPendienteCompra: false,
                    articulosEnFalta: [],
                    fechaHoy,
                    horaHoy,
                    paginaActual: presupuestoGlobalIndex,
                    totalPaginas: totalPresupuestos,
                    esContextoProduccion,
                    qrBuffer
                });
            }
        }
        
        doc.end();
        
        console.log(`✅ [REMITO-R] PDF general generado: ${nombreArchivo} (${totalPresupuestos} páginas)`);
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error generando PDF general:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando PDF general',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    imprimirPresupuestoCliente
};
