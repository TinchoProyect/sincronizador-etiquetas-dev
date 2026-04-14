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
        const busqueda = req.query.q || '';
        if (busqueda.length < 2) return res.json({ success: true, data: [] });

        const searchWildcard = `%${busqueda}%`;
        const query = `
            SELECT cliente_id as id, nombre, apellido, otros, telefono 
            FROM clientes 
            WHERE nombre ILIKE $1 
               OR apellido ILIKE $1 
               OR otros ILIKE $1 
               OR CAST(cliente_id AS TEXT) ILIKE $1
            LIMIT 20
        `;
        const { pool } = require('../config/database');
        const result = await pool.query(query, [searchWildcard]);
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
                cliente_nombre: sesion.nombre ? `${sesion.nombre} ${sesion.apellido || ''}`.trim() : 'Cliente Anónimo'
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
        if (!formData.kilos || formData.kilos <= 0) return res.status(400).json({ success: false, error: 'Kilos inválidos' });
        if (!formData.bultos || formData.bultos < 1) return res.status(400).json({ success: false, error: 'Bultos inválidos' });
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

module.exports = {
    generarQR,
    buscarClientes,
    generarQRChofer,
    obtenerSesion,
    procesarPreCheckin,
    checkInChofer
};
