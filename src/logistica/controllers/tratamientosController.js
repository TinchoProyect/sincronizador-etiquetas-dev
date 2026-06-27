const TratamientosModel = require('../models/tratamientosModel');

/**
 * Controller: Tratamientos y Devoluciones Especiales (Inmunización)
 */

async function generarQR(req, res) {
    try {
        const { id_cliente } = req.body;

        if (!id_cliente || isNaN(id_cliente)) {
            return res.status(400).json({ success: false, error: 'El id_cliente debe ser un valor numérico obligatorio' });
        }

        const orden = await TratamientosModel.crearQRPreCheckIn(id_cliente);
        
        res.status(201).json({
            success: true,
            data: {
                id_orden: orden.id,
                hash: orden.codigo_qr_hash,
                // El frontend Mobile app consumirá esta URL para dibujar el QR
                url_scan: `/tratamientos/scan/${orden.codigo_qr_hash}`
            }
        });
    } catch (error) {
        console.error('[TRATAMIENTOS] Error al generar QR:', error);
        res.status(500).json({ success: false, error: 'Error interno de base de datos', message: error.message });
    }
}

async function buscarClientes(req, res) {
    try {
        const busqueda = (req.query.q || '').trim();
        if (busqueda.length < 1) return res.json({ success: true, data: [] });

        const searchWildcard = `%${busqueda}%`;
        
        // Determinar si la búsqueda es puramente numérica para priorización
        const esNumerico = /^\d+$/.test(busqueda);
        const parsedInt = esNumerico ? parseInt(busqueda, 10) : null;
        const cleanNumString = esNumerico ? parsedInt.toString() : '';
        const prefixMatch = esNumerico ? `${cleanNumString}%` : '';

        const query = `
            SELECT cliente_id as id, nombre, apellido, otros, telefono 
            FROM clientes 
            WHERE nombre ILIKE $1 
               OR apellido ILIKE $1 
               OR otros ILIKE $1 
               OR CAST(cliente_id AS TEXT) ILIKE $1
               OR ($2::integer IS NOT NULL AND cliente_id = $2)
            ORDER BY
               CASE 
                   WHEN $2::integer IS NOT NULL AND cliente_id = $2 THEN 0
                   WHEN $2::integer IS NOT NULL AND CAST(cliente_id AS TEXT) LIKE $3 THEN 1
                   ELSE 2
               END ASC,
               apellido ASC, 
               nombre ASC
            LIMIT 20
        `;
        const { pool } = require('../config/database');
        const result = await pool.query(query, [searchWildcard, parsedInt, prefixMatch]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('[TRATAMIENTOS] Error al buscar clientes:', err);
        res.status(500).json({ success: false, error: 'Error de BD' });
    }
}

async function generarQRChofer(req, res) {
    try {
        const { id_cliente, id_ruta } = req.body;
        if (!id_cliente) {
            return res.status(400).json({ success: false, error: 'ID Cliente es requerido' });
        }

        // Generamos la orden y le insertamos la ruta si existe (puede ser unalta de retiro suelta/pendiente)
        const orden = await TratamientosModel.crearQRPreCheckIn(id_cliente);
        
        const { pool } = require('../config/database');
        if (id_ruta) {
            await pool.query('UPDATE ordenes_tratamiento SET id_ruta = $1 WHERE id = $2', [id_ruta, orden.id]);
        }

        const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${req.headers.host}`;
        const generatedLink = `${publicBaseUrl}/pages/tratamiento-checkin.html?hash=${orden.codigo_qr_hash}`;

        res.status(200).json({ 
            success: true, 
            data: {
                id_orden: orden.id,
                hash: orden.codigo_qr_hash,
                url: generatedLink
            }
        });
    } catch(err) {
        console.error('[TRATAMIENTOS] Error generarQRChofer:', err);
        res.status(500).json({ success: false, error: 'Error al forjar orden de chofer.' });
    }
}

async function obtenerSesion(req, res) {
    try {
        const { hash } = req.params;
        if (!hash) return res.status(400).json({ success: false, error: 'Falta proveer el parámetro hash' });

        const sesion = await TratamientosModel.obtenerInfoSesion(hash);
        
        if (!sesion) {
            return res.status(404).json({ success: false, error: 'Sesión no encontrada o QR expirado' });
        }

        res.status(200).json({
            success: true,
            data: {
                estado: sesion.estado_logistico,
                cliente_nombre: sesion.nombre ? `${sesion.nombre} ${sesion.apellido || ''}`.trim() : 'Cliente Anónimo',
                detalles: sesion.detalles,
                // Campos de trazabilidad del chofer (requeridos para pre-populación del modal de edición)
                responsable_nombre: sesion.responsable_nombre || null,
                responsable_apellido: sesion.responsable_apellido || null,
                responsable_celular: sesion.responsable_celular || null,
                chofer_nombre: sesion.chofer_nombre || null,
                fecha_validacion_chofer: sesion.fecha_validacion_chofer || null
            }
        });
    } catch(err) {
        console.error('[TRATAMIENTOS] Error al validar sesión frontend:', err);
        res.status(500).json({ success: false, error: 'Falla al validar el Hash en el servidor.' });
    }
}

async function procesarPreCheckin(req, res) {
    try {
        const { hash } = req.params;
        const {
            articulo_numero,
            descripcion_externa,
            kilos,
            bultos,
            motivo
        } = req.body;

        // Validaciones estrictas
        if (!hash) return res.status(400).json({ success: false, error: 'Proporción de Hash inválida o faltante' });
        if (!kilos || !bultos || !motivo) {
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios en el formulario: kilos, bultos y/o motivo' });
        }
        if (!articulo_numero && !descripcion_externa) {
            return res.status(400).json({ success: false, error: 'Exigencia de Trazabilidad: Debe proveer id de articulo interno o una descripción de producto de terceros' });
        }

        // Sanitización tipada
        const payload = {
            articulo_numero: articulo_numero ? String(articulo_numero).trim() : null,
            descripcion_externa: descripcion_externa ? String(descripcion_externa).trim() : null,
            kilos: parseFloat(kilos),
            bultos: parseInt(bultos),
            motivo: String(motivo).trim()
        };

        if (isNaN(payload.kilos) || isNaN(payload.bultos)) {
            return res.status(400).json({ success: false, error: 'Los valores de Kilos y Bultos deben ser matemáticamente operables (Números enteros/decimales)' });
        }

        await TratamientosModel.recibirDatosCliente(hash, payload);

        res.status(200).json({
            success: true,
            message: 'Información registrada y auditada correctamente. Aguarde la validación física del chofer presente.'
        });

    } catch (error) {
        console.error('[TRATAMIENTOS] Excepción en Pre-Checkin Frontal:', error);
        
        // Manejo de Negocio determinista
        if (error.message.includes('QR Inválido') || error.message.includes('completada')) {
            return res.status(400).json({ success: false, error: error.message });
        }

        res.status(500).json({ success: false, error: 'Falla al procesar y persistir los datos de tratamiento', message: error.message });
    }
}

/**
 * 4. Completar o Editar Check-in desde la App Móvil del Chofer
 */
async function checkInChofer(req, res) {
    try {
        const { hash } = req.params;
        const formData = req.body;

        if (!hash) {
            return res.status(400).json({ success: false, error: 'Faltan parámetros' });
        }

        // Validate minimal data
        if (!formData.responsable_nombre || formData.responsable_nombre.trim() === '') {
            return res.status(400).json({ success: false, error: 'El Nombre del Responsable es obligatorio para la trazabilidad.' });
        }
        if (!formData.kilos || formData.kilos <= 0) return res.status(400).json({ success: false, error: 'Kilos invalidos' });
        if (!formData.bultos || formData.bultos < 1) return res.status(400).json({ success: false, error: 'Bultos invalidos' });
        if (!formData.descripcion_externa) return res.status(400).json({ success: false, error: 'Descripción obligatoria' });
        if (!formData.motivo) return res.status(400).json({ success: false, error: 'Motivo obligatorio' });

        const localData = await TratamientosModel.guardarCheckinChofer(hash, formData);
        
        res.status(200).json({ 
            success: true, 
            message: 'Carga contingente registrada',
            data: localData 
        });

    } catch (err) {
        console.error('[TRATAMIENTOS] Error en checkInChofer:', err);
        res.status(500).json({ success: false, error: err.message || 'Error registrando contingencia' });
    }
}

async function asignarDomicilio(req, res) {
    try {
        const { id } = req.params;
        const { id_domicilio_entrega } = req.body;

        console.log(`[TRATAMIENTOS-LOG] Asignando domicilio ${id_domicilio_entrega} a orden de tratamiento ${id}`);

        if (!id_domicilio_entrega) {
            return res.status(400).json({
                success: false,
                error: 'El campo id_domicilio_entrega es requerido'
            });
        }

        // Validar que el domicilio existe y está activo
        const { pool } = require('../config/database');
        const domicilioCheck = await pool.query(
            'SELECT id FROM clientes_domicilios WHERE id = $1 AND activo = true',
            [id_domicilio_entrega]
        );

        if (domicilioCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Domicilio no encontrado'
            });
        }

        // Actualizar orden de tratamiento
        const result = await TratamientosModel.asignarDomicilio(id, id_domicilio_entrega);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'Orden de Tratamiento no encontrada'
            });
        }

        console.log(`[TRATAMIENTOS-LOG] ✅ Domicilio asignado correctamente`);

        res.json({
            success: true,
            message: 'Domicilio asignado correctamente',
            data: result
        });

    } catch (error) {
        console.error('[TRATAMIENTOS-LOG] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

async function revertirEnvio(req, res) {
    const { pool } = require('../config/database');
    const client = await pool.connect();
    try {
        const { id } = req.params; // ID de la orden de tratamiento (ej. 21)
        if (!id || isNaN(id)) {
            return res.status(400).json({ success: false, error: 'ID de orden de tratamiento inválido o no provisto' });
        }

        await client.query('BEGIN');

        // 1. Validar que la orden existe y está en estado PENDIENTE_CLIENTE con estado_tratamiento = COMPLETADO (ya devuelta a logística)
        const checkQuery = `
            SELECT id, estado_logistico, estado_tratamiento 
            FROM public.ordenes_tratamiento 
            WHERE id = $1 FOR UPDATE
        `;
        const checkRes = await client.query(checkQuery, [id]);
        if (checkRes.rows.length === 0) {
            throw new Error(`La Orden de Tratamiento #${id} no existe.`);
        }
        
        // 2. Buscar el último movimiento de RETORNO_TRATAMIENTO que esté FINALIZADO para esta orden
        const movQuery = `
            SELECT id, observaciones 
            FROM public.mantenimiento_movimientos 
            WHERE id_orden_tratamiento = $1 AND tipo_movimiento = 'RETORNO_TRATAMIENTO' AND estado = 'FINALIZADO'
            ORDER BY id DESC LIMIT 1 FOR UPDATE
        `;
        const movRes = await client.query(movQuery, [id]);
        if (movRes.rows.length === 0) {
            throw new Error(`No se encontró un movimiento de retorno finalizado para la Orden de Tratamiento #${id}.`);
        }
        
        const mov = movRes.rows[0];
        
        // 3. Retrotraer el movimiento en Mantenimiento: volverlo a PENDIENTE y quitar el sufijo " -> [Devuelto a Logística]"
        const cleanObs = mov.observaciones.replace(' -> [Devuelto a Logística]', '');
        await client.query(`
            UPDATE public.mantenimiento_movimientos
            SET estado = 'PENDIENTE',
                observaciones = $1
            WHERE id = $2
        `, [cleanObs, mov.id]);

        // 4. Retrotraer el estado de la Orden de Tratamiento en Logística
        // Debe reestablecerse en el almacén de mantenimiento (estado_logistico = 'INGRESADO_LOCAL', estado_tratamiento = 'RETIRO_PENDIENTE')
        await client.query(`
            UPDATE public.ordenes_tratamiento
            SET estado_logistico = 'INGRESADO_LOCAL',
                estado_tratamiento = 'RETIRO_PENDIENTE',
                id_ruta = NULL,
                orden_entrega = 999
            WHERE id = $1
        `, [id]);

        await client.query('COMMIT');
        
        console.log(`[TRATAMIENTOS-LOG] ✅ Envío de Orden de Tratamiento #${id} revertido con éxito.`);
        res.json({
            success: true,
            message: `El envío de la orden RT-${id} ha sido revertido con éxito, retornando al almacén de mantenimiento.`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[TRATAMIENTOS-LOG] Error en revertirEnvio:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error interno al revertir el envío'
        });
    } finally {
        client.release();
    }
}

module.exports = {
    generarQR,
    buscarClientes,
    generarQRChofer,
    obtenerSesion,
    procesarPreCheckin,
    checkInChofer,
    asignarDomicilio,
    revertirEnvio
};
