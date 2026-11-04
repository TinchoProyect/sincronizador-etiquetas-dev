// filepath: src/presupuestos/services/ofertasDinamicasService.js
'use strict';

const pool = require('../../usuarios/pool');

/**
 * Servicio Centralizado de Ofertas Dinámicas y Cuotas de Stock Promocional (LAMDA)
 * Single Source of Truth para Cotizadores, Presupuestos, CRM y Portal B2B.
 */
class OfertasDinamicasService {

    /**
     * Obtiene todas las ofertas configuradas con sus artículos, listas y excepciones
     */
    /**
     * Devuelve la consulta CTE base que unifica presupuestos locales y pedidos en bandeja
     * para calcular en tiempo real los kilos reservados, consumidos y disponibles.
     */
    static _getQueryBaseCTE() {
        return `
            WITH consumos_presupuestos AS (
                SELECT 
                    oa.oferta_id,
                    p.id AS presupuesto_id,
                    p.id_cliente,
                    COALESCE(NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''), 'Cliente #' || p.id_cliente) AS cliente_nombre,
                    p.estado,
                    p.secuencia,
                    p.fecha AS fecha_presupuesto,
                    p.fecha_actualizacion,
                    pd.articulo AS articulo_codigo,
                    COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre) AS articulo_descripcion,
                    pd.cantidad AS unidades,
                    oa.factor_conversion_cuota,
                    ROUND((pd.cantidad * oa.factor_conversion_cuota)::numeric, 2) AS kilos,
                    CASE 
                        WHEN p.estado IN ('Facturado', 'Entregado') OR p.secuencia = 'Entregado' THEN 'CONSUMIDO'
                        ELSE 'RESERVADO'
                    END AS tipo_cuota
                FROM public.bunker_ofertas_dinamicas od
                JOIN public.bunker_oferta_articulos oa ON oa.oferta_id = od.id
                JOIN public.articulos a ON (a.numero = oa.articulo_numero OR a.codigo_barras = oa.articulo_numero)
                JOIN public.presupuestos_detalles pd ON (pd.articulo = a.codigo_barras OR pd.articulo = a.numero)
                JOIN public.presupuestos p ON p.id = pd.id_presupuesto
                LEFT JOIN public.clientes c ON c.cliente_id::text = p.id_cliente::text
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = oa.articulo_numero
                WHERE p.activo = true 
                  AND p.estado NOT IN ('Anulado por el Cliente', 'ANULADO', 'Cancelado', 'Eliminado', 'Sin Confirmar', 'Standby', 'Muestra de Fraccionados')
                  AND COALESCE(p.secuencia, '') NOT IN ('Standby', 'Sin_Confirmar')
                  AND COALESCE(p.fecha_actualizacion, p.fecha) >= od.fecha_inicio
                  AND (od.fecha_fin IS NULL OR COALESCE(p.fecha_actualizacion, p.fecha) <= od.fecha_fin)
            ),
            totales_oferta AS (
                SELECT 
                    oferta_id,
                    COALESCE(SUM(CASE WHEN tipo_cuota = 'RESERVADO' THEN kilos ELSE 0 END), 0) AS kilos_reservados,
                    COALESCE(SUM(CASE WHEN tipo_cuota = 'CONSUMIDO' THEN kilos ELSE 0 END), 0) AS kilos_consumidos,
                    COALESCE(SUM(kilos), 0) AS kilos_totales_comprometidos,
                    json_agg(json_build_object(
                        'presupuesto_id', presupuesto_id,
                        'id_cliente', id_cliente,
                        'cliente_nombre', cliente_nombre,
                        'estado', estado,
                        'secuencia', secuencia,
                        'articulo_codigo', articulo_codigo,
                        'articulo_descripcion', articulo_descripcion,
                        'unidades', unidades,
                        'factor_conversion_cuota', factor_conversion_cuota,
                        'kilos', kilos,
                        'tipo_cuota', tipo_cuota,
                        'fecha', COALESCE(fecha_actualizacion, fecha_presupuesto)
                    ) ORDER BY presupuesto_id DESC) AS pedidos_detalle
                FROM consumos_presupuestos
                GROUP BY oferta_id
            )
            SELECT 
                od.*,
                COALESCE(t.kilos_reservados, 0) AS kilos_reservados,
                COALESCE(t.kilos_consumidos, 0) AS kilos_consumidos,
                (COALESCE(t.kilos_totales_comprometidos, 0) + COALESCE((SELECT SUM(cuota_debitada) FROM public.bunker_oferta_consumos boc WHERE boc.oferta_id = od.id AND boc.presupuesto_id IS NULL), 0)) AS cuota_comprometida_total,
                GREATEST(0, od.cuota_total - (COALESCE(t.kilos_totales_comprometidos, 0) + COALESCE((SELECT SUM(cuota_debitada) FROM public.bunker_oferta_consumos boc WHERE boc.oferta_id = od.id AND boc.presupuesto_id IS NULL), 0))) AS cuota_disponible,
                COALESCE(t.pedidos_detalle, '[]'::json) AS pedidos_detalle
            FROM public.bunker_ofertas_dinamicas od
            LEFT JOIN totales_oferta t ON t.oferta_id = od.id
        `;
    }

    /**
     * Obtiene todas las ofertas configuradas con sus artículos, listas, excepciones
     * y cálculo dinámico de cuota comprometida (reservada en bandeja + facturada)
     */
    static async obtenerOfertas(db = pool, soloActivas = false) {
        let query = this._getQueryBaseCTE();
        if (soloActivas) {
            query += ` WHERE od.activo = true AND od.estado = 'ACTIVA' 
                       AND (
                           (od.condicion_cierre = 'HASTA_AGOTAR_STOCK' AND (od.cuota_total - (COALESCE(t.kilos_totales_comprometidos, 0) + COALESCE((SELECT SUM(cuota_debitada) FROM public.bunker_oferta_consumos boc WHERE boc.oferta_id = od.id AND boc.presupuesto_id IS NULL), 0)) > 0)) OR
                           (od.condicion_cierre = 'FECHA_LIMITE' AND (od.fecha_fin IS NULL OR od.fecha_fin >= NOW())) OR
                           (od.condicion_cierre = 'AMBAS' AND (od.fecha_fin IS NULL OR od.fecha_fin >= NOW()) AND (od.cuota_total - (COALESCE(t.kilos_totales_comprometidos, 0) + COALESCE((SELECT SUM(cuota_debitada) FROM public.bunker_oferta_consumos boc WHERE boc.oferta_id = od.id AND boc.presupuesto_id IS NULL), 0)) > 0)) OR
                           (od.condicion_cierre NOT IN ('HASTA_AGOTAR_STOCK', 'FECHA_LIMITE', 'AMBAS') AND (od.cuota_total - (COALESCE(t.kilos_totales_comprometidos, 0) + COALESCE((SELECT SUM(cuota_debitada) FROM public.bunker_oferta_consumos boc WHERE boc.oferta_id = od.id AND boc.presupuesto_id IS NULL), 0)) > 0))
                       )`;
        }
        query += ` ORDER BY od.id DESC`;

        const res = await db.query(query);
        const ofertas = res.rows;

        for (const ofr of ofertas) {
            ofr.cuota_total = parseFloat(ofr.cuota_total) || 0;
            ofr.kilos_reservados = parseFloat(ofr.kilos_reservados) || 0;
            ofr.kilos_consumidos = parseFloat(ofr.kilos_consumidos) || 0;
            ofr.cuota_comprometida_total = parseFloat(ofr.cuota_comprometida_total) || 0;
            ofr.cuota_disponible = parseFloat(ofr.cuota_disponible) || 0;
            ofr.cuota_consumida = ofr.cuota_comprometida_total;
            if (!Array.isArray(ofr.pedidos_detalle)) ofr.pedidos_detalle = [];

            // Auto-agotamiento o reactivación según cuota disponible
            if (ofr.cuota_disponible <= 0 && ofr.estado === 'ACTIVA' && (ofr.condicion_cierre === 'HASTA_AGOTAR_STOCK' || ofr.condicion_cierre === 'AMBAS')) {
                try {
                    await db.query(`UPDATE public.bunker_ofertas_dinamicas SET estado = 'AGOTADA', cuota_consumida = $2, updated_at = NOW() WHERE id = $1`, [ofr.id, ofr.cuota_comprometida_total]);
                    ofr.estado = 'AGOTADA';
                } catch (eAuto) {}
            } else if (ofr.estado === 'AGOTADA' && ofr.cuota_disponible > 0 && ofr.activo && (ofr.condicion_cierre === 'HASTA_AGOTAR_STOCK' || (ofr.condicion_cierre === 'AMBAS' && (!ofr.fecha_fin || new Date(ofr.fecha_fin) >= new Date())))) {
                try {
                    await db.query(`UPDATE public.bunker_ofertas_dinamicas SET estado = 'ACTIVA', cuota_consumida = $2, updated_at = NOW() WHERE id = $1`, [ofr.id, ofr.cuota_comprometida_total]);
                    ofr.estado = 'ACTIVA';
                } catch (eAuto) {}
            } else {
                // Sincronizar cuota_consumida en la base de datos física para que cualquier lector directo vea el total comprometido
                try {
                    await db.query(`UPDATE public.bunker_ofertas_dinamicas SET cuota_consumida = $2, updated_at = NOW() WHERE id = $1 AND ABS(cuota_consumida - $2) > 0.001`, [ofr.id, ofr.cuota_comprometida_total]);
                } catch (eSync) {}
            }

            // Artículos vinculados con descripción completa y kilos
            const resArt = await db.query(`
                SELECT oa.id, oa.oferta_id, oa.articulo_numero, oa.factor_conversion_cuota, oa.precio_fijo_oferta,
                       ba.descripcion AS articulo_descripcion, ba.descripcion_generada, ba.kilos_unidad,
                       ba.propiedades_dinamicas, bf.nombre AS familia_nombre
                FROM public.bunker_oferta_articulos oa
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = oa.articulo_numero
                LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
                WHERE oa.oferta_id = $1
                ORDER BY oa.articulo_numero ASC
            `, [ofr.id]);
            ofr.articulos = resArt.rows;

            // Listas de precios vinculadas
            const resListas = await db.query(`
                SELECT ol.id, ol.oferta_id, ol.bunker_lista_precio_id, blp.nombre AS lista_nombre
                FROM public.bunker_oferta_listas ol
                JOIN public.bunker_listas_precios blp ON blp.id = ol.bunker_lista_precio_id
                WHERE ol.oferta_id = $1
                ORDER BY blp.nombre ASC
            `, [ofr.id]);
            ofr.listas = resListas.rows;

            // Excepciones de clientes
            const resExc = await db.query(`
                SELECT oe.id, oe.oferta_id, oe.cliente_id, oe.tipo_excepcion, oe.motivo,
                       COALESCE(bc.cliente_nombre, c.nombre || ' ' || COALESCE(c.apellido, '')) AS cliente_nombre
                FROM public.bunker_oferta_excepciones oe
                LEFT JOIN public.bunker_clientes bc ON bc.id = oe.cliente_id
                LEFT JOIN public.clientes c ON c.cliente_id = oe.cliente_id
                WHERE oe.oferta_id = $1
                ORDER BY oe.id ASC
            `, [ofr.id]);
            ofr.excepciones = resExc.rows;
        }

        return ofertas;
    }

    /**
     * Obtiene una oferta por su ID con desglose dinámico de cuota
     */
    static async obtenerOfertaPorId(id, db = pool) {
        let query = this._getQueryBaseCTE();
        query += ` WHERE od.id = $1`;

        const res = await db.query(query, [id]);
        if (res.rows.length === 0) return null;

        const ofr = res.rows[0];
        ofr.cuota_total = parseFloat(ofr.cuota_total) || 0;
        ofr.kilos_reservados = parseFloat(ofr.kilos_reservados) || 0;
        ofr.kilos_consumidos = parseFloat(ofr.kilos_consumidos) || 0;
        ofr.cuota_comprometida_total = parseFloat(ofr.cuota_comprometida_total) || 0;
        ofr.cuota_disponible = parseFloat(ofr.cuota_disponible) || 0;
        ofr.cuota_consumida = ofr.cuota_comprometida_total;
        if (!Array.isArray(ofr.pedidos_detalle)) ofr.pedidos_detalle = [];

        // Auto-agotamiento o reactivación según cuota disponible
        if (ofr.cuota_disponible <= 0 && ofr.estado === 'ACTIVA' && (ofr.condicion_cierre === 'HASTA_AGOTAR_STOCK' || ofr.condicion_cierre === 'AMBAS')) {
            try {
                await db.query(`UPDATE public.bunker_ofertas_dinamicas SET estado = 'AGOTADA', cuota_consumida = $2, updated_at = NOW() WHERE id = $1`, [ofr.id, ofr.cuota_comprometida_total]);
                ofr.estado = 'AGOTADA';
            } catch (eAuto) {}
        } else if (ofr.estado === 'AGOTADA' && ofr.cuota_disponible > 0 && ofr.activo && (ofr.condicion_cierre === 'HASTA_AGOTAR_STOCK' || (ofr.condicion_cierre === 'AMBAS' && (!ofr.fecha_fin || new Date(ofr.fecha_fin) >= new Date())))) {
            try {
                await db.query(`UPDATE public.bunker_ofertas_dinamicas SET estado = 'ACTIVA', cuota_consumida = $2, updated_at = NOW() WHERE id = $1`, [ofr.id, ofr.cuota_comprometida_total]);
                ofr.estado = 'ACTIVA';
            } catch (eAuto) {}
        } else {
            try {
                await db.query(`UPDATE public.bunker_ofertas_dinamicas SET cuota_consumida = $2, updated_at = NOW() WHERE id = $1 AND ABS(cuota_consumida - $2) > 0.001`, [ofr.id, ofr.cuota_comprometida_total]);
            } catch (eSync) {}
        }

        const resArt = await db.query(`
            SELECT oa.id, oa.oferta_id, oa.articulo_numero, oa.factor_conversion_cuota, oa.precio_fijo_oferta,
                   ba.descripcion AS articulo_descripcion, ba.descripcion_generada, ba.kilos_unidad,
                   ba.propiedades_dinamicas, bf.nombre AS familia_nombre
            FROM public.bunker_oferta_articulos oa
            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = oa.articulo_numero
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            WHERE oa.oferta_id = $1
            ORDER BY oa.articulo_numero ASC
        `, [ofr.id]);
        ofr.articulos = resArt.rows;

        const resListas = await db.query(`
            SELECT ol.id, ol.oferta_id, ol.bunker_lista_precio_id, blp.nombre AS lista_nombre
            FROM public.bunker_oferta_listas ol
            JOIN public.bunker_listas_precios blp ON blp.id = ol.bunker_lista_precio_id
            WHERE ol.oferta_id = $1
            ORDER BY blp.nombre ASC
        `, [ofr.id]);
        ofr.listas = resListas.rows;

        const resExc = await db.query(`
            SELECT oe.id, oe.oferta_id, oe.cliente_id, oe.tipo_excepcion, oe.motivo,
                   COALESCE(bc.cliente_nombre, c.nombre || ' ' || COALESCE(c.apellido, '')) AS cliente_nombre
            FROM public.bunker_oferta_excepciones oe
            LEFT JOIN public.bunker_clientes bc ON bc.id = oe.cliente_id
            LEFT JOIN public.clientes c ON c.cliente_id = oe.cliente_id
            WHERE oe.oferta_id = $1
            ORDER BY oe.id ASC
        `, [ofr.id]);
        ofr.excepciones = resExc.rows;

        return ofr;
    }

    /**
     * Guarda o actualiza una oferta dinámica en una sola transacción SQL
     */
    static async guardarOferta(datos, db = pool) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const {
                id,
                titulo,
                descripcion,
                unidad_cuota = 'KILOS',
                cuota_total,
                condicion_cierre = 'HASTA_AGOTAR_STOCK',
                fecha_inicio = new Date(),
                fecha_fin = null,
                tipo_beneficio = 'PORCENTAJE',
                descuento_porcentaje = 5.00,
                no_acumulable_con_politica = true,
                activo = true,
                estado = 'ACTIVA',
                articulos = [],
                listas = [],
                excepciones = []
            } = datos;

            if (!titulo || !titulo.trim()) {
                throw new Error('El título de la oferta es obligatorio');
            }
            const cuotaNum = parseFloat(cuota_total);
            if (isNaN(cuotaNum) || cuotaNum <= 0) {
                throw new Error('La cuota total debe ser un número mayor a 0');
            }

            let ofertaId = id ? parseInt(id, 10) : null;

            if (ofertaId) {
                const updateQ = `
                    UPDATE public.bunker_ofertas_dinamicas
                    SET titulo = $1, descripcion = $2, unidad_cuota = $3, cuota_total = $4,
                        condicion_cierre = $5, fecha_inicio = $6, fecha_fin = $7,
                        tipo_beneficio = $8, descuento_porcentaje = $9,
                        no_acumulable_con_politica = $10, activo = $11, estado = $12,
                        updated_at = NOW()
                    WHERE id = $13
                    RETURNING id
                `;
                const resUp = await client.query(updateQ, [
                    titulo.trim(),
                    descripcion ? descripcion.trim() : null,
                    unidad_cuota,
                    cuotaNum,
                    condicion_cierre,
                    fecha_inicio,
                    fecha_fin || null,
                    tipo_beneficio,
                    parseFloat(descuento_porcentaje) || 0,
                    no_acumulable_con_politica,
                    activo,
                    estado,
                    ofertaId
                ]);
                if (resUp.rows.length === 0) throw new Error(`Oferta con ID ${ofertaId} no encontrada`);
            } else {
                const insertQ = `
                    INSERT INTO public.bunker_ofertas_dinamicas (
                        titulo, descripcion, unidad_cuota, cuota_total, cuota_consumida,
                        condicion_cierre, fecha_inicio, fecha_fin, tipo_beneficio,
                        descuento_porcentaje, no_acumulable_con_politica, activo, estado
                    ) VALUES ($1, $2, $3, $4, 0.00, $5, $6, $7, $8, $9, $10, $11, $12)
                    RETURNING id
                `;
                const resIn = await client.query(insertQ, [
                    titulo.trim(),
                    descripcion ? descripcion.trim() : null,
                    unidad_cuota,
                    cuotaNum,
                    condicion_cierre,
                    fecha_inicio,
                    fecha_fin || null,
                    tipo_beneficio,
                    parseFloat(descuento_porcentaje) || 0,
                    no_acumulable_con_politica,
                    activo,
                    estado
                ]);
                ofertaId = resIn.rows[0].id;
            }

            // Reemplazar artículos
            await client.query(`DELETE FROM public.bunker_oferta_articulos WHERE oferta_id = $1`, [ofertaId]);
            for (const art of articulos) {
                const artNumero = (art.articulo_numero || art.articulo_id || '').trim();
                if (!artNumero) continue;
                const factor = parseFloat(art.factor_conversion_cuota || art.kilos_unidad) || 1.00;
                const precioFijo = art.precio_fijo_oferta ? parseFloat(art.precio_fijo_oferta) : null;

                await client.query(`
                    INSERT INTO public.bunker_oferta_articulos (
                        oferta_id, articulo_numero, factor_conversion_cuota, precio_fijo_oferta
                    ) VALUES ($1, $2, $3, $4)
                    ON CONFLICT (oferta_id, articulo_numero) DO UPDATE
                    SET factor_conversion_cuota = EXCLUDED.factor_conversion_cuota,
                        precio_fijo_oferta = EXCLUDED.precio_fijo_oferta
                `, [ofertaId, artNumero, factor, precioFijo]);
            }

            // Reemplazar listas
            await client.query(`DELETE FROM public.bunker_oferta_listas WHERE oferta_id = $1`, [ofertaId]);
            for (const lst of listas) {
                const listaId = parseInt(lst.bunker_lista_precio_id || lst.lista_id || lst, 10);
                if (!listaId) continue;

                await client.query(`
                    INSERT INTO public.bunker_oferta_listas (oferta_id, bunker_lista_precio_id)
                    VALUES ($1, $2)
                    ON CONFLICT (oferta_id, bunker_lista_precio_id) DO NOTHING
                `, [ofertaId, listaId]);
            }

            // Reemplazar excepciones
            await client.query(`DELETE FROM public.bunker_oferta_excepciones WHERE oferta_id = $1`, [ofertaId]);
            for (const exc of excepciones) {
                const cId = parseInt(exc.cliente_id, 10);
                if (!cId) continue;
                const tipo = exc.tipo_excepcion || 'EXCLUIDO';
                const motivo = exc.motivo ? exc.motivo.trim() : null;

                await client.query(`
                    INSERT INTO public.bunker_oferta_excepciones (oferta_id, cliente_id, tipo_excepcion, motivo)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (oferta_id, cliente_id) DO UPDATE
                    SET tipo_excepcion = EXCLUDED.tipo_excepcion, motivo = EXCLUDED.motivo
                `, [ofertaId, cId, tipo, motivo]);
            }

            await client.query('COMMIT');
            return await this.obtenerOfertaPorId(ofertaId, client);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Cambia el estado de una oferta ('ACTIVA', 'PAUSADA', 'CANCELADA')
     */
    static async cambiarEstado(id, nuevoEstado, db = pool) {
        const query = `
            UPDATE public.bunker_ofertas_dinamicas
            SET estado = $2, updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        const res = await db.query(query, [id, nuevoEstado]);
        return res.rows.length > 0 ? res.rows[0] : null;
    }

    /**
     * Elimina una oferta por ID
     */
    static async eliminarOferta(id, db = pool) {
        const res = await db.query(`DELETE FROM public.bunker_ofertas_dinamicas WHERE id = $1 RETURNING id`, [id]);
        return res.rows.length > 0;
    }

    /**
     * Consulta las ofertas activas aplicables a un cliente y/o lista de precios
     * Retorna un mapa indexado por articulo_numero con las condiciones y descuentos
     */
    static async obtenerOfertasActivasParaContexto({ clienteId = null, listaPrecioId = null }, db = pool) {
        const ofertas = await this.obtenerOfertas(db, true);
        const mapOfertasPorArticulo = {};

        const numClienteId = clienteId ? parseInt(String(clienteId).replace(/[^0-9]/g, ''), 10) : null;
        const numListaId = listaPrecioId ? parseInt(listaPrecioId, 10) : null;

        for (const ofr of ofertas) {
            // 1. Filtrar por lista de precios (si la oferta especifica listas)
            if (numListaId && ofr.listas.length > 0) {
                const aplicaLista = ofr.listas.some(l => l.bunker_lista_precio_id === numListaId);
                if (!aplicaLista) continue;
            }

            // 2. Filtrar por excepciones de cliente
            if (numClienteId && ofr.excepciones.length > 0) {
                const exc = ofr.excepciones.find(e => e.cliente_id === numClienteId);
                if (exc && exc.tipo_excepcion === 'EXCLUIDO') {
                    continue; // Cliente expresamente excluido de esta oferta
                }
            }

            // 3. Vincular artículos participantes
            for (const art of ofr.articulos) {
                // Si el artículo ya tenía una oferta, priorizar la que mayor descuento ofrezca
                const existente = mapOfertasPorArticulo[art.articulo_numero];
                if (!existente || ofr.descuento_porcentaje > existente.descuento_porcentaje) {
                    mapOfertasPorArticulo[art.articulo_numero] = {
                        oferta_id: ofr.id,
                        titulo: ofr.titulo,
                        unidad_cuota: ofr.unidad_cuota,
                        cuota_disponible: ofr.cuota_disponible,
                        cuota_total: ofr.cuota_total,
                        cuota_consumida: ofr.cuota_consumida,
                        kilos_reservados: ofr.kilos_reservados,
                        kilos_consumidos: ofr.kilos_consumidos,
                        condicion_cierre: ofr.condicion_cierre,
                        fecha_fin: ofr.fecha_fin,
                        tipo_beneficio: ofr.tipo_beneficio,
                        descuento_porcentaje: parseFloat(ofr.descuento_porcentaje),
                        no_acumulable_con_politica: ofr.no_acumulable_con_politica,
                        factor_conversion_cuota: parseFloat(art.factor_conversion_cuota),
                        precio_fijo_oferta: art.precio_fijo_oferta ? parseFloat(art.precio_fijo_oferta) : null
                    };
                }
            }
        }

        return mapOfertasPorArticulo;
    }

    /**
     * Registra el consumo de cuota de una oferta cuando se concreta un pedido/presupuesto
     */
    static async registrarConsumo({ ofertaId, articuloNumero, cantidadUnidades, pedidoId = null, presupuestoId = null, clienteId = null, origen = 'SISTEMA_LOCAL' }, db = pool) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // Obtener factor de conversión
            const resArt = await client.query(`
                SELECT factor_conversion_cuota 
                FROM public.bunker_oferta_articulos 
                WHERE oferta_id = $1 AND articulo_numero = $2
            `, [ofertaId, articuloNumero]);

            const factor = (resArt.rows.length > 0) ? parseFloat(resArt.rows[0].factor_conversion_cuota) : 1.00;
            const cuotaDebitada = Math.round((parseFloat(cantidadUnidades) * factor) * 100) / 100;

            // Insertar registro de consumo
            await client.query(`
                INSERT INTO public.bunker_oferta_consumos (
                    oferta_id, articulo_numero, cantidad_unidades, cuota_debitada,
                    pedido_id, presupuesto_id, cliente_id, origen
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [ofertaId, articuloNumero, cantidadUnidades, cuotaDebitada, pedidoId, presupuestoId, String(clienteId || ''), origen]);

            // Actualizar acumulador en la cabecera
            const resUp = await client.query(`
                UPDATE public.bunker_ofertas_dinamicas
                SET cuota_consumida = cuota_consumida + $2,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING cuota_total, cuota_consumida, condicion_cierre
            `, [ofertaId, cuotaDebitada]);

            if (resUp.rows.length > 0) {
                const { cuota_total, cuota_consumida, condicion_cierre } = resUp.rows[0];
                // Si la condición incluye agotar stock y ya se alcanzó o superó
                if (parseFloat(cuota_consumida) >= parseFloat(cuota_total) && 
                    (condicion_cierre === 'HASTA_AGOTAR_STOCK' || condicion_cierre === 'AMBAS')) {
                    await client.query(`
                        UPDATE public.bunker_ofertas_dinamicas
                        SET estado = 'AGOTADA', updated_at = NOW()
                        WHERE id = $1
                    `, [ofertaId]);
                    console.log(`🔒 [OFERTAS-DINAMICAS] Oferta #${ofertaId} marcada automáticamente como AGOTADA.`);
                }
            }

            await client.query('COMMIT');
            return true;
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('❌ [OFERTAS-DINAMICAS] Error al registrar consumo:', err);
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Calcula el stock real disponible para un conjunto de artículos:
     * - Bultos cerrados en depósito (LDN 1)
     * - Fraccionados listos en góndola/depósito (LDN 2)
     * - Materia prima abierta en taller (ingrediente suelto)
     */
    static async calcularStockArticulos(articulosCodigos, db = pool) {
        if (!articulosCodigos || !Array.isArray(articulosCodigos) || articulosCodigos.length === 0) {
            return {
                total_kilos_disponibles: 0,
                bultos_cerrados_kg: 0,
                bultos_cerrados_unidades: 0,
                fracciones_listas_kg: 0,
                kilos_abiertos_taller: 0,
                ingrediente_nombre: '',
                desglose: []
            };
        }

        // 1. Stock físico consolidado de los artículos seleccionados
        const resStockDirecto = await db.query(`
            SELECT src.articulo_numero, COALESCE(src.stock_consolidado, 0) as stock_unidades,
                   COALESCE(ba.kilos_unidad, 1.0) as kilos_unidad,
                   COALESCE(ba.descripcion_generada, ba.descripcion) as descripcion
            FROM public.stock_real_consolidado src
            JOIN public.bunker_articulos ba ON ba.articulo_id = src.articulo_numero
            WHERE src.articulo_numero = ANY($1::varchar[])
        `, [articulosCodigos]);

        // 2. Buscar si alguno es fraccionado y tiene receta con ingrediente de producción
        const resRecetas = await db.query(`
            SELECT r.articulo_numero, ri.ingrediente_id, i.nombre as ingrediente_nombre,
                   COALESCE(i.stock_actual, 0) as stock_abierto_taller,
                   i.articulo_vinculado_numero
            FROM public.recetas r
            JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
            JOIN public.ingredientes i ON i.id = ri.ingrediente_id
            WHERE r.articulo_numero = ANY($1::varchar[])
              AND COALESCE(i.es_insumo, false) = false
              AND ri.unidad_medida ILIKE '%kilo%'
        `, [articulosCodigos]);

        // 3. Ingredientes únicos involucrados
        const ingredientesMap = new Map();
        for (const row of resRecetas.rows) {
            if (!ingredientesMap.has(row.ingrediente_id)) {
                ingredientesMap.set(row.ingrediente_id, {
                    id: row.ingrediente_id,
                    nombre: row.ingrediente_nombre,
                    stock_abierto: parseFloat(row.stock_abierto_taller || 0),
                    articulo_vinculado: row.articulo_vinculado_numero
                });
            }
        }

        // Si alguno de los artículos es directamente el artículo_vinculado_numero de un ingrediente:
        const resIngDirecto = await db.query(`
            SELECT id, nombre, COALESCE(stock_actual, 0) as stock_abierto, articulo_vinculado_numero
            FROM public.ingredientes
            WHERE articulo_vinculado_numero = ANY($1::varchar[])
        `, [articulosCodigos]);

        for (const row of resIngDirecto.rows) {
            if (!ingredientesMap.has(row.id)) {
                ingredientesMap.set(row.id, {
                    id: row.id,
                    nombre: row.nombre,
                    stock_abierto: parseFloat(row.stock_abierto || 0),
                    articulo_vinculado: row.articulo_vinculado_numero
                });
            }
        }

        // 4. Calcular desglose y subtotales
        let bultosCerradosKg = 0;
        let bultosCerradosUnidades = 0;
        let fraccionesListasKg = 0;
        const desglose = [];

        for (const row of resStockDirecto.rows) {
            const unidades = parseFloat(row.stock_unidades || 0);
            const kilosUnidad = parseFloat(row.kilos_unidad || 1.0);
            const kilosTotales = unidades * kilosUnidad;
            const esBultoCerrado = kilosUnidad >= 10; // Convenio taller: >= 10kg suele ser bulto industrial

            if (esBultoCerrado) {
                bultosCerradosKg += kilosTotales;
                bultosCerradosUnidades += unidades;
            } else {
                fraccionesListasKg += kilosTotales;
            }

            desglose.push({
                articulo_numero: row.articulo_numero,
                descripcion: row.descripcion,
                stock_unidades: unidades,
                kilos_unidad: kilosUnidad,
                kilos_total: kilosTotales,
                tipo: esBultoCerrado ? 'BULTO_CERRADO' : 'FRACCION'
            });
        }

        // 5. Kilos abiertos en taller de materia prima
        let kilosAbiertosTaller = 0;
        let ingredienteNombre = '';
        for (const ing of ingredientesMap.values()) {
            kilosAbiertosTaller += ing.stock_abierto;
            if (!ingredienteNombre) ingredienteNombre = ing.nombre;
        }

        const totalKilosDisponibles = bultosCerradosKg + fraccionesListasKg + kilosAbiertosTaller;

        return {
            total_kilos_disponibles: parseFloat(totalKilosDisponibles.toFixed(2)),
            bultos_cerrados_kg: parseFloat(bultosCerradosKg.toFixed(2)),
            bultos_cerrados_unidades: bultosCerradosUnidades,
            fracciones_listas_kg: parseFloat(fraccionesListasKg.toFixed(2)),
            kilos_abiertos_taller: parseFloat(kilosAbiertosTaller.toFixed(2)),
            ingrediente_nombre: ingredienteNombre,
            desglose
        };
    }
}

module.exports = OfertasDinamicasService;
