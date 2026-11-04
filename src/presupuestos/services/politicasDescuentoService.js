// filepath: src/presupuestos/services/politicasDescuentoService.js
'use strict';

const { pool } = require('../config/database');

/**
 * Servicio Centralizado de Políticas Comerciales y Descuentos Escalonados (LAMDA)
 * Single Source of Truth para Presupuestos, Edición, Móvil, Portal B2B e Informes.
 */
class PoliticasDescuentoService {

    /**
     * Obtiene todas las políticas configuradas con sus tramos y excepciones
     */
    static async obtenerPoliticas(db = pool) {
        const queryPols = `
            SELECT p.*,
                   CASE 
                       WHEN p.aplica_a_todas = true THEN 'Todas las listas (General)'
                       ELSE COALESCE(
                           (SELECT string_agg(blp.nombre, ', ') 
                            FROM public.bunker_politica_listas bpl 
                            JOIN public.bunker_listas_precios blp ON blp.id = bpl.bunker_lista_precio_id 
                            WHERE bpl.politica_id = p.id),
                           blp_legacy.nombre,
                           'Sin lista asignada'
                       )
                   END AS lista_nombre
            FROM public.bunker_politicas_descuento p
            LEFT JOIN public.bunker_listas_precios blp_legacy ON blp_legacy.id = p.bunker_lista_precio_id
            ORDER BY p.id ASC
        `;
        const resPols = await db.query(queryPols);
        const politicas = resPols.rows;

        for (const pol of politicas) {
            // Listas asociadas
            const resListas = await db.query(`
                SELECT bpl.bunker_lista_precio_id AS id, blp.nombre, blp.descripcion
                FROM public.bunker_politica_listas bpl
                JOIN public.bunker_listas_precios blp ON blp.id = bpl.bunker_lista_precio_id
                WHERE bpl.politica_id = $1
                ORDER BY blp.id ASC
            `, [pol.id]);
            pol.listas = resListas.rows;
            pol.listas_ids = resListas.rows.map(l => l.id);

            // Tramos
            const resTramos = await db.query(`
                SELECT id, politica_id, monto_minimo, monto_maximo, descuento_porcentaje, etiqueta, orden
                FROM public.bunker_politica_descuento_tramos
                WHERE politica_id = $1
                ORDER BY orden ASC, monto_minimo ASC
            `, [pol.id]);
            pol.tramos = resTramos.rows;

            // Excepciones
            const resExc = await db.query(`
                SELECT e.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
                FROM public.bunker_politica_descuento_excepciones e
                JOIN public.clientes c ON c.cliente_id = e.cliente_id
                WHERE e.politica_id = $1
                ORDER BY e.id ASC
            `, [pol.id]);
            pol.excepciones = resExc.rows;
        }

        return politicas;
    }

    /**
     * Obtiene una política por su ID
     */
    static async obtenerPoliticaPorId(id, db = pool) {
        const query = `
            SELECT p.*,
                   CASE 
                       WHEN p.aplica_a_todas = true THEN 'Todas las listas (General)'
                       ELSE COALESCE(
                           (SELECT string_agg(blp.nombre, ', ') 
                            FROM public.bunker_politica_listas bpl 
                            JOIN public.bunker_listas_precios blp ON blp.id = bpl.bunker_lista_precio_id 
                            WHERE bpl.politica_id = p.id),
                           blp_legacy.nombre,
                           'Sin lista asignada'
                       )
                   END AS lista_nombre
            FROM public.bunker_politicas_descuento p
            LEFT JOIN public.bunker_listas_precios blp_legacy ON blp_legacy.id = p.bunker_lista_precio_id
            WHERE p.id = $1
        `;
        const res = await db.query(query, [id]);
        if (res.rows.length === 0) return null;

        const pol = res.rows[0];

        // Listas asociadas
        const resListas = await db.query(`
            SELECT bpl.bunker_lista_precio_id AS id, blp.nombre, blp.descripcion
            FROM public.bunker_politica_listas bpl
            JOIN public.bunker_listas_precios blp ON blp.id = bpl.bunker_lista_precio_id
            WHERE bpl.politica_id = $1
            ORDER BY blp.id ASC
        `, [pol.id]);
        pol.listas = resListas.rows;
        pol.listas_ids = resListas.rows.map(l => l.id);

        const resTramos = await db.query(`
            SELECT id, politica_id, monto_minimo, monto_maximo, descuento_porcentaje, etiqueta, orden
            FROM public.bunker_politica_descuento_tramos
            WHERE politica_id = $1
            ORDER BY orden ASC, monto_minimo ASC
        `, [pol.id]);
        pol.tramos = resTramos.rows;

        const resExc = await db.query(`
            SELECT e.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
            FROM public.bunker_politica_descuento_excepciones e
            JOIN public.clientes c ON c.cliente_id = e.cliente_id
            WHERE e.politica_id = $1
            ORDER BY e.id ASC
        `, [pol.id]);
        pol.excepciones = resExc.rows;

        return pol;
    }

    /**
     * Obtiene la política activa para una lista de precios (con fallback a política general sin lista exclusiva)
     */
    static async obtenerPoliticaPorLista(listaPrecioId, db = pool) {
        if (!listaPrecioId) return null;

        const query = `
            SELECT p.*,
                   CASE 
                       WHEN p.aplica_a_todas = true THEN 'Todas las listas (General)'
                       ELSE COALESCE(
                           (SELECT string_agg(blp.nombre, ', ') 
                            FROM public.bunker_politica_listas bpl 
                            JOIN public.bunker_listas_precios blp ON blp.id = bpl.bunker_lista_precio_id 
                            WHERE bpl.politica_id = p.id),
                           blp_legacy.nombre
                       )
                   END AS lista_nombre
            FROM public.bunker_politicas_descuento p
            LEFT JOIN public.bunker_listas_precios blp_legacy ON blp_legacy.id = p.bunker_lista_precio_id
            WHERE p.activo = true
              AND (
                  p.aplica_a_todas = true
                  OR p.bunker_lista_precio_id = $1
                  OR EXISTS (
                      SELECT 1 FROM public.bunker_politica_listas bpl
                      WHERE bpl.politica_id = p.id AND bpl.bunker_lista_precio_id = $1
                  )
                  OR (p.bunker_lista_precio_id IS NULL AND NOT EXISTS (
                      SELECT 1 FROM public.bunker_politica_listas bpl WHERE bpl.politica_id = p.id
                  ))
              )
            ORDER BY 
              -- Prioridad 1: Políticas asignadas específicamente a la lista vía bunker_politica_listas o columna legacy
              CASE 
                  WHEN EXISTS (SELECT 1 FROM public.bunker_politica_listas bpl WHERE bpl.politica_id = p.id AND bpl.bunker_lista_precio_id = $1) THEN 1
                  WHEN p.bunker_lista_precio_id = $1 THEN 1
                  ELSE 2
              END ASC,
              p.id ASC
            LIMIT 1
        `;
        const res = await db.query(query, [listaPrecioId]);
        if (res.rows.length === 0) return null;

        const pol = res.rows[0];

        // Listas asociadas
        const resListas = await db.query(`
            SELECT bpl.bunker_lista_precio_id AS id, blp.nombre
            FROM public.bunker_politica_listas bpl
            JOIN public.bunker_listas_precios blp ON blp.id = bpl.bunker_lista_precio_id
            WHERE bpl.politica_id = $1
            ORDER BY blp.id ASC
        `, [pol.id]);
        pol.listas = resListas.rows;
        pol.listas_ids = resListas.rows.map(l => l.id);

        const resTramos = await db.query(`
            SELECT id, politica_id, monto_minimo, monto_maximo, descuento_porcentaje, etiqueta, orden
            FROM public.bunker_politica_descuento_tramos
            WHERE politica_id = $1
            ORDER BY orden ASC, monto_minimo ASC
        `, [pol.id]);
        pol.tramos = resTramos.rows;

        const resExc = await db.query(`
            SELECT cliente_id, tipo_excepcion, descuento_fijo, motivo
            FROM public.bunker_politica_descuento_excepciones
            WHERE politica_id = $1
        `, [pol.id]);
        pol.excepciones = resExc.rows;

        return pol;
    }

    /**
     * Resuelve la lista de precios asignada a un cliente y retorna su política activa (si existe)
     */
    static async obtenerPoliticaPorCliente(clienteId, db = pool) {
        if (!clienteId) return null;

        const strId = String(clienteId).trim();
        const strLower = strId.toLowerCase();

        // Caso especial: prospecto o cotización libre sin cliente registrado
        if (strLower === 'prospecto' || strLower === 'libre') {
            return {
                cliente_id: 'prospecto',
                lista_id: 5,
                lista_nombre: 'Dietetica',
                tiene_politica: false,
                politica: null,
                excepcion: null,
                es_prospecto: true,
                texto_beneficio_generico: 'Consulte por bonificaciones y escalas de descuento comercial por volumen.'
            };
        }

        const numId = parseInt(strId, 10);
        const cleanId = (!isNaN(numId) && numId > 0) ? numId : null;

        // 1. Resolver asignación Búnker oficial (busca por código Búnker, lomas_soft_id o ID numérico)
        let listaId = null;
        let listaNombre = null;
        let resolvedClienteId = cleanId;

        const resBunker = await db.query(`
            SELECT 
                blp.id AS lista_id, 
                blp.nombre AS lista_nombre,
                COALESCE(c.cliente_id, bc.id) as resolved_cliente_id,
                bc.id as bunker_cliente_id,
                bc.codigo_bunker_cliente,
                bc.lomas_soft_id
            FROM public.bunker_clientes bc
            LEFT JOIN public.clientes c ON (
                bc.lomas_soft_id = LPAD(c.cliente_id::text, 4, '0') 
                OR bc.lomas_soft_id = c.cliente_id::text 
                OR bc.id = c.cliente_id
            )
            LEFT JOIN public.bunker_cliente_listas_precios bclp ON bclp.bunker_cliente_id = bc.id
            LEFT JOIN public.bunker_listas_precios blp ON blp.id = bclp.bunker_lista_precio_id
            WHERE bc.codigo_bunker_cliente ILIKE $1
               OR bc.lomas_soft_id = $1
               OR bc.lomas_soft_id = LPAD($1, 4, '0')
               OR ($2::integer IS NOT NULL AND (bc.id = $2::integer OR c.cliente_id = $2::integer))
            LIMIT 1
        `, [strId, cleanId]);

        if (resBunker.rows.length > 0) {
            listaId = resBunker.rows[0].lista_id;
            listaNombre = resBunker.rows[0].lista_nombre;
            resolvedClienteId = resBunker.rows[0].resolved_cliente_id || resBunker.rows[0].bunker_cliente_id || cleanId;
        }

        let saldoCuentaCorriente = 0;
        let codigoBunkerCliente = null;
        if (resBunker.rows.length > 0) {
            codigoBunkerCliente = resBunker.rows[0].codigo_bunker_cliente;
        }
        if (codigoBunkerCliente) {
            const resCC = await db.query(`
                SELECT COALESCE(saldo, 0.00) as saldo FROM public.factura_cuentas_corrientes 
                WHERE codigo_bunker_cliente = $1 LIMIT 1
            `, [codigoBunkerCliente]);
            if (resCC.rows.length > 0) {
                saldoCuentaCorriente = parseFloat(resCC.rows[0].saldo) || 0;
            }
        }

        // Intento B: Si aún no tiene lista y hay cleanId, buscar en tabla legacy clientes
        if (!listaId && cleanId) {
            const resLegacy = await db.query(`
                SELECT lista_precios FROM public.clientes WHERE cliente_id = $1 LIMIT 1
            `, [cleanId]);
            if (resLegacy.rows.length > 0 && resLegacy.rows[0].lista_precios) {
                const rawLista = String(resLegacy.rows[0].lista_precios).trim();
                const num = parseInt(rawLista, 10);
                if (!isNaN(num) && num > 0) {
                    listaId = num;
                    const resNombre = await db.query(`SELECT nombre FROM public.bunker_listas_precios WHERE id = $1`, [listaId]);
                    if (resNombre.rows.length > 0) {
                        listaNombre = resNombre.rows[0].nombre;
                    }
                } else if (rawLista) {
                    const resNombre = await db.query(`SELECT id, nombre FROM public.bunker_listas_precios WHERE LOWER(nombre) = LOWER($1)`, [rawLista]);
                    if (resNombre.rows.length > 0) {
                        listaId = resNombre.rows[0].id;
                        listaNombre = resNombre.rows[0].nombre;
                    }
                }
            }
        }

        if (!listaId) {
            return {
                cliente_id: clienteId,
                codigo_bunker_cliente: codigoBunkerCliente,
                saldo_cuenta_corriente: saldoCuentaCorriente,
                lista_id: null,
                lista_nombre: null,
                tiene_politica: false,
                politica: null,
                excepcion: null,
                texto_beneficio_generico: 'Consulte por bonificaciones y escalas de descuento comercial por volumen.'
            };
        }

        const politica = await this.obtenerPoliticaPorLista(listaId, db);
        if (!politica) {
            return {
                cliente_id: clienteId,
                codigo_bunker_cliente: codigoBunkerCliente,
                saldo_cuenta_corriente: saldoCuentaCorriente,
                lista_id: listaId,
                lista_nombre: listaNombre,
                tiene_politica: false,
                politica: null,
                excepcion: null,
                texto_beneficio_generico: 'Consulte por bonificaciones y escalas de descuento comercial por volumen.'
            };
        }

        // Verificar excepción cruzando por cleanId y resolvedClienteId
        const excepcion = politica.excepciones.find(e => 
            (cleanId && e.cliente_id === cleanId) || 
            (resolvedClienteId && e.cliente_id === resolvedClienteId)
        ) || null;

        return {
            cliente_id: clienteId,
            codigo_bunker_cliente: codigoBunkerCliente,
            saldo_cuenta_corriente: saldoCuentaCorriente,
            lista_id: listaId,
            lista_nombre: listaNombre,
            tiene_politica: true,
            politica: {
                id: politica.id,
                nombre: politica.nombre,
                descripcion: politica.descripcion,
                tipo_calculo: politica.tipo_calculo,
                aplica_sobre: politica.aplica_sobre,
                exige_saldo_cero: politica.exige_saldo_cero !== false,
                tolerancia_saldo: parseFloat(politica.tolerancia_saldo) || 150.00,
                no_acumulable: politica.no_acumulable !== false,
                tramos: politica.tramos
            },
            excepcion: excepcion
        };
    }

    /**
     * Guarda o actualiza una política con sus tramos y excepciones en una sola transacción SQL
     */
    static async guardarPolitica(datos, db = pool) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const {
                id,
                nombre,
                descripcion,
                bunker_lista_precio_id,
                listas_ids = [],
                aplica_a_todas = false,
                activo = true,
                tipo_calculo = 'ESCALA_DIRECTA',
                aplica_sobre = 'NETO',
                exige_saldo_cero = true,
                tolerancia_saldo = 150.00,
                no_acumulable = true,
                tramos = [],
                excepciones = []
            } = datos;

            if (!nombre || !nombre.trim()) {
                throw new Error('El nombre de la política es obligatorio');
            }

            const isAplicaATodas = aplica_a_todas === true || aplica_a_todas === 'true' || aplica_a_todas === 1 || aplica_a_todas === '1';

            let listasArray = [];
            if (!isAplicaATodas) {
                if (Array.isArray(listas_ids)) {
                    listasArray = listas_ids.map(x => parseInt(x, 10)).filter(x => !isNaN(x) && x > 0);
                } else if (bunker_lista_precio_id) {
                    const parsed = parseInt(bunker_lista_precio_id, 10);
                    if (!isNaN(parsed) && parsed > 0) listasArray = [parsed];
                }
            }

            const targetLegacyListaId = (!isAplicaATodas && listasArray.length > 0) ? listasArray[0] : null;

            let politicaId = id ? parseInt(id, 10) : null;

            if (politicaId) {
                // Actualizar cabecera
                const updateQ = `
                    UPDATE public.bunker_politicas_descuento
                    SET nombre = $1, descripcion = $2, bunker_lista_precio_id = $3,
                        activo = $4, tipo_calculo = $5, aplica_sobre = $6,
                        exige_saldo_cero = $7, tolerancia_saldo = $8, no_acumulable = $9,
                        aplica_a_todas = $10, updated_at = NOW()
                    WHERE id = $11
                    RETURNING id
                `;
                const resUp = await client.query(updateQ, [
                    nombre.trim(),
                    descripcion ? descripcion.trim() : null,
                    targetLegacyListaId,
                    activo,
                    tipo_calculo,
                    aplica_sobre,
                    exige_saldo_cero,
                    parseFloat(tolerancia_saldo) || 150.00,
                    no_acumulable,
                    isAplicaATodas,
                    politicaId
                ]);
                if (resUp.rows.length === 0) throw new Error(`Política con ID ${politicaId} no encontrada`);
            } else {
                // Crear cabecera
                const insertQ = `
                    INSERT INTO public.bunker_politicas_descuento (
                        nombre, descripcion, bunker_lista_precio_id, activo, tipo_calculo, aplica_sobre,
                        exige_saldo_cero, tolerancia_saldo, no_acumulable, aplica_a_todas
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING id
                `;
                const resIn = await client.query(insertQ, [
                    nombre.trim(),
                    descripcion ? descripcion.trim() : null,
                    targetLegacyListaId,
                    activo,
                    tipo_calculo,
                    aplica_sobre,
                    exige_saldo_cero,
                    parseFloat(tolerancia_saldo) || 150.00,
                    no_acumulable,
                    isAplicaATodas
                ]);
                politicaId = resIn.rows[0].id;
            }

            // Reemplazar listas asociadas en bunker_politica_listas
            await client.query(`DELETE FROM public.bunker_politica_listas WHERE politica_id = $1`, [politicaId]);
            if (!isAplicaATodas && listasArray.length > 0) {
                for (const lid of listasArray) {
                    await client.query(`
                        INSERT INTO public.bunker_politica_listas (politica_id, bunker_lista_precio_id)
                        VALUES ($1, $2)
                        ON CONFLICT (politica_id, bunker_lista_precio_id) DO NOTHING
                    `, [politicaId, lid]);
                }
            }

            // Reemplazar tramos
            await client.query(`DELETE FROM public.bunker_politica_descuento_tramos WHERE politica_id = $1`, [politicaId]);
            for (let i = 0; i < tramos.length; i++) {
                const t = tramos[i];
                const min = parseFloat(t.monto_minimo) || 0;
                const max = (t.monto_maximo !== null && t.monto_maximo !== undefined && t.monto_maximo !== '')
                    ? parseFloat(t.monto_maximo) : null;
                const desc = parseFloat(t.descuento_porcentaje) || 0;
                const etiqueta = t.etiqueta ? t.etiqueta.trim() : `Escala >= $${min.toLocaleString('es-AR')}`;
                const orden = t.orden ? parseInt(t.orden, 10) : (i + 1);

                await client.query(`
                    INSERT INTO public.bunker_politica_descuento_tramos (
                        politica_id, monto_minimo, monto_maximo, descuento_porcentaje, etiqueta, orden
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                `, [politicaId, min, max, desc, etiqueta, orden]);
            }

            // Reemplazar excepciones
            await client.query(`DELETE FROM public.bunker_politica_descuento_excepciones WHERE politica_id = $1`, [politicaId]);
            for (const e of excepciones) {
                const cId = parseInt(e.cliente_id, 10);
                if (!cId) continue;
                const tipo = e.tipo_excepcion || 'EXCLUIDO';
                const descFijo = (tipo === 'PORCENTAJE_FIJO' && e.descuento_fijo) ? parseFloat(e.descuento_fijo) : null;
                const motivo = e.motivo ? e.motivo.trim() : null;

                await client.query(`
                    INSERT INTO public.bunker_politica_descuento_excepciones (
                        politica_id, cliente_id, tipo_excepcion, descuento_fijo, motivo
                    ) VALUES ($1, $2, $3, $4, $5)
                `, [politicaId, cId, tipo, descFijo, motivo]);
            }

            await client.query('COMMIT');
            return await this.obtenerPoliticaPorId(politicaId, client);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Elimina una política por ID
     */
    static async eliminarPolitica(id, db = pool) {
        const res = await db.query(`DELETE FROM public.bunker_politicas_descuento WHERE id = $1 RETURNING id`, [id]);
        return res.rows.length > 0;
    }

    /**
     * Evalúa el descuento comercial aplicable en tiempo real para un cliente o subtotal dado
     * Soporta segregación de artículos en oferta para no duplicar bonificaciones.
     * @param {Object} params - { clienteId, listaPrecioId, subtotalNeto, subtotalBruto, subtotalOfertasNeto, subtotalOfertasBruto }
     * @returns {Object} Evaluación detallada con porcentaje sugerido, tramo activo y avance al siguiente escalón
     */
    static async evaluarDescuento({ clienteId, listaPrecioId, subtotalNeto = 0, subtotalBruto = 0, subtotalOfertasNeto = 0, subtotalOfertasBruto = 0, esRetiro = false }, db = pool) {
        let infoCliente = null;
        let politica = null;

        if (clienteId) {
            infoCliente = await this.obtenerPoliticaPorCliente(clienteId, db);
            if (infoCliente && infoCliente.tiene_politica) {
                politica = await this.obtenerPoliticaPorLista(infoCliente.lista_id, db);
            }
        } else if (listaPrecioId) {
            politica = await this.obtenerPoliticaPorLista(listaPrecioId, db);
        }

        // Si no hay política activa configurada para esta lista
        if (!politica || !politica.activo || !politica.tramos || politica.tramos.length === 0) {
            return {
                aplica: false,
                politica_id: null,
                politica_nombre: null,
                descuento_porcentaje: 0.00,
                descuento_decimal: 0.00,
                monto_descuento: 0.00,
                base_bonificable: 0.00,
                subtotal_ofertas_excluido: 0.00,
                tramo_actual: null,
                proximo_tramo: null,
                falta_para_proximo: 0,
                motivo: 'Sin política comercial configurada para esta lista',
                es_excepcion: false
            };
        }

        // Si el cliente tiene una excepción configurada
        if (infoCliente && infoCliente.excepcion) {
            const exc = infoCliente.excepcion;
            if (exc.tipo_excepcion === 'EXCLUIDO') {
                return {
                    aplica: false,
                    politica_id: politica.id,
                    politica_nombre: politica.nombre,
                    descuento_porcentaje: 0.00,
                    descuento_decimal: 0.00,
                    monto_descuento: 0.00,
                    base_bonificable: 0.00,
                    subtotal_ofertas_excluido: 0.00,
                    tramo_actual: null,
                    proximo_tramo: null,
                    falta_para_proximo: 0,
                    motivo: exc.motivo || 'Cliente excluido de bonificaciones de volumen',
                    es_excepcion: true,
                    tipo_excepcion: 'EXCLUIDO'
                };
            } else if (exc.tipo_excepcion === 'PORCENTAJE_FIJO') {
                const descFijo = parseFloat(exc.descuento_fijo) || 0;
                const baseFija = (politica.aplica_sobre === 'BRUTO') ? (parseFloat(subtotalBruto) || 0) : (parseFloat(subtotalNeto) || 0);
                const montoDesc = Math.round(baseFija * (descFijo / 100) * 100) / 100;
                return {
                    aplica: true,
                    politica_id: politica.id,
                    politica_nombre: politica.nombre,
                    descuento_porcentaje: descFijo,
                    descuento_decimal: parseFloat((descFijo / 100).toFixed(4)),
                    monto_descuento: montoDesc,
                    base_bonificable: baseFija,
                    subtotal_ofertas_excluido: 0.00,
                    tramo_actual: {
                        etiqueta: `Porcentaje Fijo por Excepción: ${descFijo}%`,
                        descuento_porcentaje: descFijo
                    },
                    proximo_tramo: null,
                    falta_para_proximo: 0,
                    motivo: exc.motivo || 'Cliente con porcentaje fijo acordado',
                    es_excepcion: true,
                    tipo_excepcion: 'PORCENTAJE_FIJO'
                };
            }
        }

        // Condición Comercial: Exige cuenta al día (saldo cero o inferior a la tolerancia de $150)
        // En notas de crédito u órdenes de retiro (esRetiro=true) NO aplica el bloqueo por saldo.
        const exigeSaldoCero = politica.exige_saldo_cero !== false;
        const toleranciaSaldo = parseFloat(politica.tolerancia_saldo) || 150.00;
        const saldoCliente = parseFloat(infoCliente?.saldo_cuenta_corriente) || 0;

        if (!esRetiro && exigeSaldoCero && saldoCliente > toleranciaSaldo) {
            return {
                aplica: false,
                bloqueado_por_saldo: true,
                saldo_actual: saldoCliente,
                tolerancia_saldo: toleranciaSaldo,
                politica_id: politica.id,
                politica_nombre: politica.nombre,
                descuento_porcentaje: 0.00,
                descuento_decimal: 0.00,
                monto_descuento: 0.00,
                base_bonificable: 0.00,
                subtotal_ofertas_excluido: 0.00,
                tramo_actual: null,
                proximo_tramo: null,
                falta_para_proximo: 0,
                motivo: `Descuento comercial bloqueado por saldo pendiente en cuenta corriente ($${saldoCliente.toLocaleString('es-AR', { minimumFractionDigits: 2 })}). Debe cancelar su saldo para acceder al beneficio (tolerancia: $${toleranciaSaldo.toLocaleString('es-AR')}).`,
                es_excepcion: false
            };
        }

        // Determinar monto base a evaluar para el umbral (NETO o BRUTO, incluye la oferta para ayudar al cliente)
        const montoBase = (politica.aplica_sobre === 'BRUTO')
            ? (parseFloat(subtotalBruto) || 0)
            : (parseFloat(subtotalNeto) || 0);

        // Monto de ítems en oferta a excluir de la base imponible del descuento
        const montoOfertas = (politica.aplica_sobre === 'BRUTO')
            ? (parseFloat(subtotalOfertasBruto) || 0)
            : (parseFloat(subtotalOfertasNeto) || 0);

        // Base bonificable estricta: solo artículos estándar
        const baseBonificable = Math.max(0, Math.round((montoBase - montoOfertas) * 100) / 100);

        // Ordenar tramos por monto_minimo ASC
        const tramosOrdenados = [...politica.tramos].sort((a, b) => parseFloat(a.monto_minimo) - parseFloat(b.monto_minimo));

        // Encontrar tramo actual alcanzado
        let tramoActual = null;
        let proximoTramo = null;

        for (const tramo of tramosOrdenados) {
            const min = parseFloat(tramo.monto_minimo);
            const max = tramo.monto_maximo !== null ? parseFloat(tramo.monto_maximo) : Infinity;

            if (montoBase >= min) {
                if (montoBase <= max || max === Infinity) {
                    tramoActual = tramo;
                }
            } else if (!proximoTramo && montoBase < min) {
                proximoTramo = tramo;
            }
        }

        // Si ya alcanzó el tramo actual más alto, proximoTramo sigue siendo null
        let faltaParaProximo = 0;
        if (proximoTramo) {
            faltaParaProximo = Math.max(0, parseFloat(proximoTramo.monto_minimo) - montoBase);
        }

        if (tramoActual) {
            const descPct = parseFloat(tramoActual.descuento_porcentaje) || 0;
            const montoDescuento = Math.round(baseBonificable * (descPct / 100) * 100) / 100;
            return {
                aplica: descPct > 0,
                politica_id: politica.id,
                politica_nombre: politica.nombre,
                aplica_sobre: politica.aplica_sobre,
                subtotal_evaluado: montoBase,
                base_bonificable: baseBonificable,
                subtotal_ofertas_excluido: montoOfertas,
                descuento_porcentaje: descPct,
                descuento_decimal: parseFloat((descPct / 100).toFixed(4)),
                monto_descuento: montoDescuento,
                tramo_actual: {
                    id: tramoActual.id,
                    monto_minimo: parseFloat(tramoActual.monto_minimo),
                    monto_maximo: tramoActual.monto_maximo !== null ? parseFloat(tramoActual.monto_maximo) : null,
                    descuento_porcentaje: descPct,
                    etiqueta: tramoActual.etiqueta
                },
                proximo_tramo: proximoTramo ? {
                    id: proximoTramo.id,
                    monto_minimo: parseFloat(proximoTramo.monto_minimo),
                    descuento_porcentaje: parseFloat(proximoTramo.descuento_porcentaje),
                    etiqueta: proximoTramo.etiqueta
                } : null,
                falta_para_proximo: faltaParaProximo,
                motivo: montoOfertas > 0 
                    ? `${tramoActual.etiqueta || `Supera $${tramoActual.monto_minimo}`} (aplicado sobre base estándar)`
                    : (tramoActual.etiqueta || `Supera $${tramoActual.monto_minimo}`),
                es_excepcion: false
            };
        } else {
            // No alcanzó ningún tramo (está por debajo del primer mínimo)
            const primerTramo = tramosOrdenados[0] || null;
            return {
                aplica: false,
                politica_id: politica.id,
                politica_nombre: politica.nombre,
                aplica_sobre: politica.aplica_sobre,
                subtotal_evaluado: montoBase,
                base_bonificable: baseBonificable,
                subtotal_ofertas_excluido: montoOfertas,
                descuento_porcentaje: 0.00,
                descuento_decimal: 0.00,
                monto_descuento: 0.00,
                tramo_actual: null,
                proximo_tramo: primerTramo ? {
                    id: primerTramo.id,
                    monto_minimo: parseFloat(primerTramo.monto_minimo),
                    descuento_porcentaje: parseFloat(primerTramo.descuento_porcentaje),
                    etiqueta: primerTramo.etiqueta
                } : null,
                falta_para_proximo: primerTramo ? Math.max(0, parseFloat(primerTramo.monto_minimo) - montoBase) : 0,
                motivo: 'No alcanza el monto mínimo de la política comercial',
                es_excepcion: false
            };
        }
    }
}

module.exports = PoliticasDescuentoService;
