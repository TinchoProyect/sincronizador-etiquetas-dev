const express = require('express');
const router = express.Router();
const { dbMiddleware } = require('../middleware');

// Aplicar middleware de base de datos a todas las rutas
router.use(dbMiddleware);
const { 
    crearReceta, 
    obtenerEstadoRecetas, 
    validarIntegridadRecetas,
    obtenerReceta, 
    actualizarReceta,
    obtenerIngredientesExpandidos,
    eliminarReceta
} = require('../controllers/recetas');
const {
    crearCarro,
    agregarArticulo,
    obtenerArticulosDeCarro,
    obtenerCarrosDeUsuario,
    eliminarCarro,
    eliminarArticuloDeCarro,
    modificarCantidadDeArticulo,
    obtenerInfoEliminacion
} = require('../controllers/carro');
const { obtenerArticulos, buscarArticuloPorCodigo, actualizarProduccionLambda } = require('../controllers/articulos');
const {
    obtenerIngredientes,
    obtenerIngrediente,
    crearIngrediente,
    actualizarIngrediente,
    eliminarIngrediente,
    obtenerNuevoCodigo,
    obtenerUsuariosConStock,
    obtenerStockPorUsuario
} = require('../controllers/ingredientes');

const mixesRouter = require('./mixes'); // ← Incorporación del router de mixes
const carroIngredientesRouter = require('./carroIngredientes'); // ← Incorporación del router de ingredientes de carro

router.use('/mixes', mixesRouter);     // ← Montar rutas para mixes
router.use('/carro', carroIngredientesRouter); // ← Montar rutas para ingredientes de carro

// Rutas para ingredientes
router.get('/ingredientes', async (req, res) => {
    try {
        console.log('Recibida solicitud GET /ingredientes');
        const ingredientes = await obtenerIngredientes();
        console.log(`Enviando respuesta con ${ingredientes.length} ingredientes`);
        res.json(ingredientes);
    } catch (error) {
        console.error('Error en ruta GET /ingredientes:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para obtener usuarios con stock - DEBE IR ANTES DE /ingredientes/:id
router.get('/ingredientes/usuarios-con-stock', async (req, res) => {
    try {
        console.log('🔄 Procesando solicitud GET /ingredientes/usuarios-con-stock');
        const usuarios = await obtenerUsuariosConStock();
        console.log('✅ Usuarios con stock obtenidos:', usuarios);
        res.json(usuarios);
    } catch (error) {
        console.error('❌ Error al obtener usuarios con stock:', error);
        res.status(500).json({ 
            error: 'Error al obtener usuarios con stock',
            detalle: error.message 
        });
    }
});

// Ruta para obtener stock por usuario - DEBE IR ANTES DE /ingredientes/:id
router.get('/ingredientes/stock-usuario/:usuarioId', async (req, res) => {
    try {
        const usuarioId = parseInt(req.params.usuarioId);
        console.log(`🔄 Procesando solicitud GET /ingredientes/stock-usuario/${usuarioId}`);
        
        if (isNaN(usuarioId)) {
            console.warn('⚠️ ID de usuario inválido:', req.params.usuarioId);
            return res.status(400).json({ error: 'ID de usuario inválido' });
        }
        
        const stock = await obtenerStockPorUsuario(usuarioId);
        console.log(`✅ Stock obtenido para usuario ${usuarioId}:`, stock);
        res.json(stock);
    } catch (error) {
        console.error(`❌ Error al obtener stock para usuario ${req.params.usuarioId}:`, error);
        res.status(500).json({ 
            error: 'Error al obtener stock por usuario',
            detalle: error.message 
        });
    }
});

router.get('/ingredientes/nuevo-codigo', async (req, res) => {
    try {
        console.log('Recibida solicitud GET /ingredientes/nuevo-codigo');
        const codigo = await obtenerNuevoCodigo();
        console.log(`Generado nuevo código: ${codigo}`);
        res.json({ codigo });
    } catch (error) {
        console.error('Error en ruta GET /ingredientes/nuevo-codigo:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/ingredientes/buscar', async (req, res) => {
    try {
        const { nombre } = req.query;
        if (!nombre) {
            return res.status(400).json({ error: 'Se requiere el parámetro nombre' });
        }
        
        const query = `
            SELECT id 
            FROM ingredientes 
            WHERE LOWER(nombre) = LOWER($1)
        `;
        const result = await req.db.query(query, [nombre]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ingrediente no encontrado' });
        }
        
        res.json({ id: result.rows[0].id });
    } catch (error) {
        console.error('Error en ruta GET /ingredientes/buscar:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/ingredientes/:id/es-mix', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        
        const query = `
            SELECT COUNT(*)::integer as count 
            FROM ingrediente_composicion 
            WHERE mix_id = $1
        `;
        const result = await req.db.query(query, [id]);
        const es_mix = result.rows[0].count > 0;
        
        res.json({ es_mix });
    } catch (error) {
        console.error('Error en ruta GET /ingredientes/:id/es-mix:', error);
        res.status(500).json({ error: error.message });
    }
});

// Rutas para composición de ingredientes (mixes)
// Verificar si un ingrediente es compuesto (mix)
router.get('/ingredientes/:id/es-compuesto', async (req, res) => {
    try {
        const ingredienteId = req.params.id;
        
        // Consultar si el ingrediente es un mix verificando si tiene composición
        const query = `
            SELECT COUNT(*)::integer as count
            FROM ingrediente_composicion
            WHERE mix_id = $1
        `;
        
        const result = await req.db.query(query, [ingredienteId]);
        const esCompuesto = result.rows[0].count > 0;
        
        res.json({ esCompuesto });
    } catch (error) {
        console.error('Error al verificar si el ingrediente es compuesto:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/ingredientes/:id/composicion', async (req, res) => {
    try {
        const mixId = parseInt(req.params.id);
        if (isNaN(mixId)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        
        // Obtener información del mix
        const mixQuery = `
            SELECT id, nombre, unidad_medida, receta_base_kg
            FROM ingredientes 
            WHERE id = $1
        `;
        const mixResult = await req.db.query(mixQuery, [mixId]);
        
        if (mixResult.rows.length === 0) {
            return res.status(404).json({ error: 'Mix no encontrado' });
        }
        
        // Obtener composición del mix
        const composicionQuery = `
            SELECT 
                ic.ingrediente_id,
                ic.cantidad,
                i.nombre as nombre_ingrediente,
                i.unidad_medida
            FROM ingrediente_composicion ic
            JOIN ingredientes i ON i.id = ic.ingrediente_id
            WHERE ic.mix_id = $1
            ORDER BY i.nombre
        `;
        const composicionResult = await req.db.query(composicionQuery, [mixId]);
        
        res.json({
            mix: mixResult.rows[0],
            composicion: composicionResult.rows
        });
    } catch (error) {
        console.error('Error en ruta GET /ingredientes/:id/composicion:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/ingredientes/:id/composicion', async (req, res) => {
    try {
        const mixId = parseInt(req.params.id);
        const { ingrediente_id, cantidad } = req.body;
        
        if (isNaN(mixId) || !ingrediente_id || !cantidad) {
            return res.status(400).json({ error: 'Datos inválidos' });
        }
        
        // Verificar que el ingrediente no sea el mismo mix (evitar ciclos)
        if (parseInt(ingrediente_id) === mixId) {
            return res.status(400).json({ error: 'Un mix no puede contenerse a sí mismo' });
        }
        
        const query = `
            INSERT INTO ingrediente_composicion (mix_id, ingrediente_id, cantidad)
            VALUES ($1, $2, $3)
            ON CONFLICT (mix_id, ingrediente_id) 
            DO UPDATE SET cantidad = $3
        `;
        await req.db.query(query, [mixId, ingrediente_id, cantidad]);
        
        res.json({ message: 'Ingrediente agregado a la composición' });
    } catch (error) {
        console.error('Error en ruta POST /ingredientes/:id/composicion:', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/ingredientes/:mixId/composicion/:ingredienteId', async (req, res) => {
    try {
        const mixId = parseInt(req.params.mixId);
        const ingredienteId = parseInt(req.params.ingredienteId);
        const { cantidad } = req.body;
        
        if (isNaN(mixId) || isNaN(ingredienteId) || !cantidad) {
            return res.status(400).json({ error: 'Datos inválidos' });
        }
        
        const query = `
            UPDATE ingrediente_composicion 
            SET cantidad = $1
            WHERE mix_id = $2 AND ingrediente_id = $3
        `;
        const result = await req.db.query(query, [cantidad, mixId, ingredienteId]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Composición no encontrada' });
        }
        
        res.json({ message: 'Cantidad actualizada' });
    } catch (error) {
        console.error('Error en ruta PUT /ingredientes/:mixId/composicion/:ingredienteId:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para eliminar toda la composición de un mix
router.delete('/ingredientes/:mixId/composicion', async (req, res) => {
    try {
        const mixId = parseInt(req.params.mixId);
        
        if (isNaN(mixId)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        
        // 1. Eliminar toda la composición
        const deleteQuery = `
            DELETE FROM ingrediente_composicion 
            WHERE mix_id = $1
        `;
        await req.db.query(deleteQuery, [mixId]);
        
        // 2. Actualizar receta_base_kg a null
        const updateQuery = `
            UPDATE ingredientes 
            SET receta_base_kg = NULL 
            WHERE id = $1
        `;
        await req.db.query(updateQuery, [mixId]);
        
        res.json({ message: 'Composición eliminada completamente' });
    } catch (error) {
        console.error('Error en ruta DELETE /ingredientes/:mixId/composicion:', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/ingredientes/:mixId/composicion/:ingredienteId', async (req, res) => {
    try {
        const mixId = parseInt(req.params.mixId);
        const ingredienteId = parseInt(req.params.ingredienteId);
        
        if (isNaN(mixId) || isNaN(ingredienteId)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }
        
        const query = `
            DELETE FROM ingrediente_composicion 
            WHERE mix_id = $1 AND ingrediente_id = $2
        `;
        const result = await req.db.query(query, [mixId, ingredienteId]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Composición no encontrada' });
        }
        
        res.json({ message: 'Ingrediente eliminado de la composición' });
    } catch (error) {
        console.error('Error en ruta DELETE /ingredientes/:mixId/composicion/:ingredienteId:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/ingredientes/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        const ingrediente = await obtenerIngrediente(id);
        res.json(ingrediente);
    } catch (error) {
        console.error('Error en ruta GET /ingredientes/:id:', error);
        res.status(error.message.includes('no encontrado') ? 404 : 500)
           .json({ error: error.message });
    }
});

router.post('/ingredientes', async (req, res) => {
    try {
        const nuevoIngrediente = await crearIngrediente(req.body);
        res.status(201).json(nuevoIngrediente);
    } catch (error) {
        console.error('Error en ruta POST /ingredientes:', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/ingredientes/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        const ingredienteActualizado = await actualizarIngrediente(id, req.body);
        res.json(ingredienteActualizado);
    } catch (error) {
        console.error('Error en ruta PUT /ingredientes/:id:', error);
        res.status(error.message.includes('no encontrado') ? 404 : 500)
           .json({ error: error.message });
    }
});

router.delete('/ingredientes/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        await eliminarIngrediente(id);
        res.json({ message: 'Ingrediente eliminado correctamente' });
    } catch (error) {
        console.error('Error en ruta DELETE /ingredientes/:id:', error);
        res.status(error.message.includes('no encontrado') ? 404 : 500)
           .json({ error: error.message });
    }
});

// Ruta para obtener usuarios colaboradores activos
router.get('/usuarios', async (req, res) => {
    try {
        const { rol, activo } = req.query;
        const rolId = parseInt(rol);
        const esActivo = activo === 'true';

        if (isNaN(rolId)) {
            return res.status(400).json({ error: 'Se requiere un ID de rol válido' });
        }

        const query = `
            SELECT id, nombre_completo
            FROM public.usuarios
            WHERE rol_id = $1 AND activo = $2
            ORDER BY nombre_completo ASC
        `;
        
        const result = await req.db.query(query, [rolId, esActivo]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error en ruta GET /usuarios:', error);
        res.status(500).json({ error: error.message });
    }
});


// Rutas para artículos
router.get('/articulos', async (req, res) => {
    try {
        const { tipo_carro } = req.query;
        
        // Validación del parámetro tipo_carro
        if (tipo_carro && !['interna', 'externa'].includes(tipo_carro)) {
            return res.status(400).json({ error: 'El tipo de carro debe ser "interna" o "externa"' });
        }
        
        console.log('Recibida solicitud GET /articulos con filtro:', tipo_carro || 'sin filtro');
        const articulos = await obtenerArticulos(tipo_carro);
        console.log(`Enviando respuesta con ${articulos.length} artículos`);
        res.json(articulos);
    } catch (error) {
        console.error('Error en ruta GET /articulos:', error);
        res.status(500).json({ error: error.message });
    }
});

// Middleware de validación para estado de recetas
const validarEstadoRecetas = (req, res, next) => {
    const { articulos } = req.body;

    if (!articulos) {
        return res.status(400).json({ error: 'Se requiere la lista de artículos' });
    }

    if (!Array.isArray(articulos)) {
        return res.status(400).json({ error: 'El campo articulos debe ser un array' });
    }

    if (articulos.length === 0) {
        return res.status(400).json({ error: 'La lista de artículos no puede estar vacía' });
    }

    if (!articulos.every(art => typeof art === 'string' && art.trim())) {
        return res.status(400).json({ error: 'Todos los artículos deben ser códigos válidos' });
    }

    // Limpiar espacios en blanco y asegurar que son strings
    req.body.articulos = articulos.map(art => art.trim());
    next();
};

// Middleware de validación para recetas
const validarReceta = (req, res, next) => {
    const { descripcion, ingredientes } = req.body;
    const articulo_numero = req.method === 'POST' ? req.body.articulo_numero : req.params.numero_articulo;

    if (req.method === 'POST' && (!articulo_numero || typeof articulo_numero !== 'string' || !articulo_numero.trim())) {
        return res.status(400).json({ error: 'El número de artículo es requerido y debe ser un texto válido' });
    }

    if (!Array.isArray(ingredientes) || ingredientes.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos un ingrediente' });
    }

    const ingredientesValidos = ingredientes.every(ing => {
        const cantidadNumerica = parseFloat(ing.cantidad);
        return ing.nombre_ingrediente && 
               typeof ing.nombre_ingrediente === 'string' && 
               ing.nombre_ingrediente.trim() &&
               ing.unidad_medida && 
               typeof ing.unidad_medida === 'string' &&
               ing.unidad_medida.trim() &&
               !isNaN(cantidadNumerica) && 
               cantidadNumerica > 0;
    });

    if (!ingredientesValidos) {
        return res.status(400).json({ 
            error: 'Cada ingrediente debe tener nombre válido, unidad de medida y cantidad mayor a 0' 
        });
    }

    // Limpiar datos
    req.body.articulo_numero = articulo_numero.trim();
    req.body.descripcion = descripcion ? descripcion.trim() : '';
    req.body.ingredientes = ingredientes.map(ing => ({
        ...ing,
        nombre_ingrediente: ing.nombre_ingrediente.trim(),
        unidad_medida: ing.unidad_medida.trim(),
        cantidad: parseFloat(ing.cantidad)
    }));

    next();
};

// Ruta para obtener estado de recetas
router.post('/articulos/estado-recetas', validarEstadoRecetas, async (req, res) => {
    try {
        await obtenerEstadoRecetas(req, res);
    } catch (error) {
        console.error('Error al obtener estado de recetas:', error);
        res.status(500).json({ error: 'Error al procesar la solicitud de estado de recetas' });
    }
});

// Ruta para validar integridad de recetas
router.post('/articulos/integridad-recetas', validarEstadoRecetas, async (req, res) => {
    try {
        await validarIntegridadRecetas(req, res);
    } catch (error) {
        console.error('Error al validar integridad de recetas:', error);
        res.status(500).json({ error: 'Error al procesar la solicitud de integridad de recetas' });
    }
});

// Ruta para crear recetas
router.post('/recetas', validarReceta, async (req, res) => {
    try {
        await crearReceta(req, res);
    } catch (error) {
        console.error('Error al crear receta:', error);
        res.status(500).json({ error: 'Error al crear la receta' });
    }
});

// Ruta para obtener una receta específica
router.get('/recetas/:numero_articulo', async (req, res) => {
    try {
        const numero_articulo = req.params.numero_articulo;
        const receta = await obtenerReceta(numero_articulo);
        res.json(receta);
    } catch (error) {
        console.error('Error al obtener receta:', error);
        res.status(error.message === 'Receta no encontrada' ? 404 : 500)
           .json({ error: error.message });
    }
});

// Ruta para obtener ingredientes expandidos de una receta
router.get('/recetas/:numero_articulo/ingredientes-expandido', obtenerIngredientesExpandidos);

// Ruta para actualizar una receta existente
router.put('/recetas/:numero_articulo', validarReceta, async (req, res) => {
    try {
        await actualizarReceta(req, res);
    } catch (error) {
        console.error('Error al actualizar receta:', error);
        res.status(500).json({ error: 'Error al actualizar la receta' });
    }
});

// Ruta para eliminar una receta
router.delete('/recetas/:numero_articulo', async (req, res) => {
    try {
        await eliminarReceta(req, res);
    } catch (error) {
        console.error('Error al eliminar receta:', error);
        res.status(500).json({ error: 'Error al eliminar la receta' });
    }
});

// Rutas para carros de producción
router.post('/carro', async (req, res) => {
    try {
        const { usuarioId, enAuditoria, tipoCarro } = req.body;
        
        if (!usuarioId || isNaN(parseInt(usuarioId))) {
            return res.status(400).json({ error: 'Se requiere un ID de usuario válido' });
        }

        // Validar tipo de carro
        if (tipoCarro && !['interna', 'externa'].includes(tipoCarro)) {
            return res.status(400).json({ error: 'El tipo de carro debe ser "interna" o "externa"' });
        }

        const carroId = await crearCarro(parseInt(usuarioId), enAuditoria, tipoCarro);
        res.json({ id: carroId });
    } catch (error) {
        console.error('Error al crear carro:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/usuario/:usuarioId/carros', async (req, res) => {
    try {
        const usuarioId = parseInt(req.params.usuarioId);
        
        if (!usuarioId || isNaN(usuarioId)) {
            return res.status(400).json({ error: 'ID de usuario inválido' });
        }

        const carros = await obtenerCarrosDeUsuario(usuarioId);
        res.json(carros);
    } catch (error) {
        console.error('Error al obtener carros del usuario:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/carro/:id/articulos', async (req, res) => {
    try {
        const carroId = parseInt(req.params.id);
        const usuarioId = parseInt(req.query.usuarioId);

        if (!usuarioId) {
            return res.status(400).json({ error: 'Se requiere el ID del usuario' });
        }

        if (isNaN(carroId) || isNaN(usuarioId)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }

        const articulos = await obtenerArticulosDeCarro(carroId, usuarioId);
        res.json(articulos);
    } catch (error) {
        console.error('Error al obtener artículos del carro:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/carro/:id/articulo', async (req, res) => {
    try {
        const carroId = parseInt(req.params.id);
        const { articulo_numero, descripcion, cantidad, usuarioId } = req.body;

        if (!carroId || isNaN(carroId)) {
            return res.status(400).json({ error: 'ID de carro inválido' });
        }

        if (!articulo_numero || !descripcion || !cantidad || !usuarioId) {
            return res.status(400).json({ error: 'Faltan datos requeridos del artículo' });
        }

        await agregarArticulo(carroId, articulo_numero, descripcion, cantidad, usuarioId);
        res.json({ message: 'Artículo agregado correctamente' });
    } catch (error) {
        console.error('Error al agregar artículo:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para obtener información antes de eliminar un carro
router.get('/carro/:id/info-eliminacion', async (req, res) => {
    try {
        const carroId = parseInt(req.params.id);
        const usuarioId = parseInt(req.query.usuarioId);

        if (!usuarioId) {
            return res.status(400).json({ error: 'Se requiere el ID del usuario' });
        }

        if (isNaN(carroId) || isNaN(usuarioId)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }

        const info = await obtenerInfoEliminacion(carroId, usuarioId);
        res.json(info);
    } catch (error) {
        console.error('Error al obtener información de eliminación:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para eliminar un carro
router.delete('/carro/:id', async (req, res) => {
    try {
        const carroId = parseInt(req.params.id);
        const usuarioId = parseInt(req.query.usuarioId);

        if (!usuarioId) {
            return res.status(400).json({ error: 'Se requiere el ID del usuario' });
        }

        if (isNaN(carroId) || isNaN(usuarioId)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }

        const resultado = await eliminarCarro(carroId, usuarioId);
        res.json(resultado);
    } catch (error) {
        console.error('Error al eliminar carro:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para eliminar un artículo específico de un carro
router.delete('/carro/:carroId/articulo/:articuloId', async (req, res) => {
    try {
        const carroId = parseInt(req.params.carroId);
        const articuloId = req.params.articuloId;
        const usuarioId = parseInt(req.query.usuarioId);

        if (!usuarioId) {
            return res.status(400).json({ error: 'Se requiere el ID del usuario' });
        }

        if (isNaN(carroId) || !articuloId || isNaN(usuarioId)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }

        await eliminarArticuloDeCarro(carroId, articuloId, usuarioId);
        res.json({ message: 'Artículo eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar artículo del carro:', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/carro/:carroId/articulo/:articuloId', async (req, res) => {
    try {
        const carroId = parseInt(req.params.carroId);
        const articuloId = req.params.articuloId;
        const usuarioId = parseInt(req.query.usuarioId);
        const { cantidad } = req.body;

        if (!usuarioId) {
            return res.status(400).json({ error: 'Se requiere el ID del usuario' });
        }

        if (isNaN(carroId) || !articuloId || isNaN(usuarioId) || !cantidad || isNaN(cantidad)) {
            return res.status(400).json({ error: 'Datos inválidos o faltantes' });
        }

        await modificarCantidadDeArticulo(carroId, articuloId, usuarioId, cantidad);
        res.json({ message: 'Cantidad modificada correctamente' });
    } catch (error) {
        console.error('Error al modificar cantidad del artículo:', error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ Ruta para registrar movimiento de stock de ventas
const { registrarMovimientoStockVentas } = require('../controllers/stockVentasMovimientos');
router.post('/stock-ventas-movimientos', registrarMovimientoStockVentas);

// Ruta para buscar artículo por código de barras
router.get('/articulos/buscar', async (req, res) => {
    try {
        const { codigo_barras } = req.query;
        if (!codigo_barras) {
            return res.status(400).json({ error: 'Se requiere el parámetro codigo_barras' });
        }
        
        const articulo = await buscarArticuloPorCodigo(codigo_barras);
        res.json(articulo);
    } catch (error) {
        console.error('Error en ruta GET /articulos/buscar:', error);
        if (error.message === 'Artículo no encontrado') {
            res.status(404).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Ruta para actualizar campo no_producido_por_lambda
router.patch('/articulos/:articulo_numero/produccion', async (req, res) => {
    try {
        const { articulo_numero } = req.params;
        const { no_producido_por_lambda } = req.body;
        
        if (!articulo_numero) {
            return res.status(400).json({ error: 'Número de artículo requerido' });
        }

        if (typeof no_producido_por_lambda !== 'boolean') {
            return res.status(400).json({ error: 'El valor no_producido_por_lambda debe ser booleano' });
        }

        const resultado = await actualizarProduccionLambda(articulo_numero, no_producido_por_lambda);
        res.json(resultado);
    } catch (error) {
        console.error('Error en ruta PATCH /articulos/:articulo_numero/produccion:', error);
        if (error.message.includes('no encontrado')) {
            res.status(404).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Ruta para alternar estado de producción (toggle)
router.put('/articulos/:articuloId/toggle-produccion', async (req, res) => {
    try {
        const { articuloId } = req.params;
        const { no_producido_por_lambda } = req.body;
        
        if (!articuloId) {
            return res.status(400).json({ error: 'ID de artículo requerido' });
        }

        if (typeof no_producido_por_lambda !== 'boolean') {
            return res.status(400).json({ error: 'El campo no_producido_por_lambda debe ser un booleano' });
        }

        const resultado = await actualizarProduccionLambda(articuloId, no_producido_por_lambda);
        res.json(resultado);
    } catch (error) {
        console.error('Error en ruta PUT /articulos/:articuloId/toggle-produccion:', error);
        if (error.message.includes('no encontrado')) {
            res.status(404).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Importar el controlador de eliminación de ingresos manuales
const { eliminarIngresoManual } = require('../controllers/eliminarIngresoManual');

// Ruta para eliminar físicamente un ingreso manual
router.delete('/carro/:carroId/ingreso-manual/:ingresoId', eliminarIngresoManual);

// Ruta para registrar múltiples movimientos de stock (inventario)
router.post('/stock-ventas-movimientos/batch', async (req, res) => {
    try {
        const { ajustes } = req.body;
        
        if (!ajustes || !Array.isArray(ajustes) || ajustes.length === 0) {
            return res.status(400).json({ error: 'Se requiere una lista de ajustes' });
        }

        console.log(`📥 Procesando inventario batch con ${ajustes.length} ajustes`);
        console.log('📋 Datos completos recibidos:', JSON.stringify(req.body, null, 2));

        // Iniciar transacción
        await req.db.query('BEGIN');

        try {
            for (let i = 0; i < ajustes.length; i++) {
                const ajuste = ajustes[i];
                
                console.log(`🔄 Procesando ajuste ${i + 1}/${ajustes.length}:`, JSON.stringify(ajuste, null, 2));

                // Validar y convertir datos requeridos para cada ajuste
                if (!ajuste.articulo_numero || !ajuste.usuario_id || ajuste.cantidad === undefined || ajuste.cantidad === null) {
                    const error = `Ajuste ${i + 1}: Faltan datos requeridos - articulo_numero: ${ajuste.articulo_numero}, usuario_id: ${ajuste.usuario_id}, cantidad: ${ajuste.cantidad}`;
                    console.error('❌ Validación fallida:', error);
                    throw new Error(error);
                }

                // Validar y convertir datos
                const usuarioId = parseInt(ajuste.usuario_id);
                if (isNaN(usuarioId)) {
                    const error = `Ajuste ${i + 1}: ID de usuario inválido - usuario_id: ${ajuste.usuario_id}`;
                    console.error('❌ Validación fallida:', error);
                    throw new Error(error);
                }

                // Mantener cantidad como decimal
                const cantidad = ajuste.cantidad;
                if (cantidad === undefined || cantidad === null) {
                    const error = `Ajuste ${i + 1}: Cantidad no especificada`;
                    console.error('❌ Validación fallida:', error);
                    throw new Error(error);
                }

                // Usar cantidad para kilos si no está definido
                const kilos = ajuste.kilos ?? cantidad;

                console.log(`📊 Datos procesados - Usuario: ${usuarioId}, Cantidad: ${cantidad}, Kilos: ${kilos}`);

                // Insertar movimiento en stock_ventas_movimientos
                const insertQuery = `
                    INSERT INTO public.stock_ventas_movimientos 
                    (articulo_numero, codigo_barras, fecha, usuario_id, carro_id, tipo, kilos, cantidad)
                    VALUES ($1, $2, NOW(), $3, NULL, $4, $5, $6)
                `;
                
                const insertParams = [
                    ajuste.articulo_numero,
                    ajuste.codigo_barras || null,
                    usuarioId,
                    ajuste.tipo || 'registro de ajuste',
                    kilos,
                    cantidad
                ];

                console.log(`🔄 Ejecutando INSERT con parámetros:`, insertParams);
                await req.db.query(insertQuery, insertParams);
                console.log(`✅ Movimiento insertado para artículo ${ajuste.articulo_numero}`);

                // Usar UPSERT para stock_real_consolidado (INSERT con ON CONFLICT)
                const upsertQuery = `
                    INSERT INTO public.stock_real_consolidado 
                    (articulo_numero, stock_ajustes, stock_consolidado, ultima_actualizacion)
                    VALUES ($1, $2, $2, NOW())
                    ON CONFLICT (articulo_numero) 
                    DO UPDATE SET 
                        stock_ajustes = COALESCE(stock_real_consolidado.stock_ajustes, 0) + $2,
                        stock_consolidado = COALESCE(stock_real_consolidado.stock_consolidado, 0) + $2,
                        ultima_actualizacion = NOW()
                `;
                
                const upsertParams = [ajuste.articulo_numero, cantidad];
                console.log(`🔄 Ejecutando UPSERT con parámetros:`, upsertParams);
                await req.db.query(upsertQuery, upsertParams);
                console.log(`✅ Stock consolidado actualizado para artículo ${ajuste.articulo_numero}`);
            }

            await req.db.query('COMMIT');
            console.log('✅ Inventario batch completado exitosamente');
            res.json({ message: 'Inventario registrado correctamente' });
        } catch (error) {
            await req.db.query('ROLLBACK');
            console.error('❌ Error en transacción, rollback ejecutado:', error);
            console.error('❌ Stack trace:', error.stack);
            throw error;
        }
    } catch (error) {
        console.error('❌ Error en ruta POST /stock-ventas-movimientos/batch:', error);
        console.error('❌ Error completo:', error.stack);
        res.status(500).json({ 
            error: 'Error al registrar el inventario',
            detalle: error.message 
        });
    }
});

// =========================

const { marcarCarroPreparado } = require('../controllers/marcarCarroPreparado');
const { finalizarProduccion } = require('../controllers/finalizarProduccion');
const { registrarMovimientoIngrediente } = require('../controllers/ingredientesMovimientos');
const { obtenerArticulosParaEtiquetas } = require('../controllers/obtenerArticulosParaEtiquetas');
const { agregarStockUsuario } = require('../controllers/ingredientesStockUsuarios');

// Ruta para agregar stock de ingrediente a un usuario
router.post('/ingredientes-usuarios/agregar', async (req, res) => {
    try {
        await agregarStockUsuario(req, res);
    } catch (error) {
        console.error('Error en ruta /ingredientes-usuarios/agregar:', error);
        res.status(500).json({
            error: 'Error al agregar stock de usuario',
            detalle: error.message
        });
    }
});

// Ruta para registrar movimientos en stock de usuarios (carros externos)
router.post('/ingredientes-stock-usuarios', async (req, res) => {
    try {
        console.log('\n🔍 DEPURACIÓN ENDPOINT /ingredientes-stock-usuarios:');
        console.log('=======================================================');
        console.log('📥 PAYLOAD RECIBIDO:', JSON.stringify(req.body, null, 2));
        
        const { usuario_id, ingrediente_id, cantidad, origen_carro_id, origen_mix_id } = req.body;
        
        console.log('\n📋 VALIDACIÓN DE CAMPOS:');
        console.log('- usuario_id:', usuario_id, typeof usuario_id);
        console.log('- ingrediente_id:', ingrediente_id, typeof ingrediente_id);
        console.log('- cantidad:', cantidad, typeof cantidad);
        console.log('- origen_carro_id:', origen_carro_id, typeof origen_carro_id);
        console.log('- origen_mix_id:', origen_mix_id, typeof origen_mix_id);
        
        if (!usuario_id || !ingrediente_id || cantidad === undefined || !origen_carro_id) {
            console.log('❌ ERROR: Faltan datos requeridos');
            return res.status(400).json({ error: 'Faltan datos requeridos' });
        }

        const query = `
            INSERT INTO ingredientes_stock_usuarios 
            (usuario_id, ingrediente_id, cantidad, origen_carro_id, fecha_registro, origen_mix_id)
            VALUES ($1, $2, $3, $4, NOW(), $5)
            RETURNING id
        `;
        
        const params = [usuario_id, ingrediente_id, cantidad, origen_carro_id, origen_mix_id];
        console.log('\n📝 QUERY A EJECUTAR:', query);
        console.log('📊 PARÁMETROS:', params);
        
        const result = await req.db.query(query, params);
        
        console.log(`\n✅ REGISTRO EXITOSO:`);
        console.log(`- ID generado: ${result.rows[0].id}`);
        console.log(`- origen_mix_id guardado: ${origen_mix_id || 'NULL'}`);
        
        res.json({ 
            message: 'Movimiento registrado correctamente',
            id: result.rows[0].id
        });
    } catch (error) {
        console.error('❌ Error en ruta /ingredientes-stock-usuarios:', error);
        console.error('❌ Error completo:', error.message);
        res.status(500).json({
            error: 'Error al registrar movimiento en stock de usuarios',
            detalle: error.message
        });
    }
});

/**
 * Ruta: POST /api/produccion/carro/:id/preparado
 * Descripción: Marca un carro como preparado y registra los movimientos de ingredientes
 */
router.post('/carro/:id/preparado', async (req, res, next) => {
    try {
        // Asegurarse de que req.db esté disponible
        if (!req.db) {
            throw new Error('No hay conexión a la base de datos disponible');
        }
        await marcarCarroPreparado(req, res);
    } catch (error) {
        console.error('Error en ruta /carro/:id/preparado:', error);
        res.status(500).json({
            error: 'Error al marcar el carro como preparado',
            detalle: error.message
        });
    }
});

/**
 * Ruta: POST /api/produccion/carro/:id/finalizar
 * Descripción: Finaliza la producción de un carro y registra los movimientos de stock de ventas
 */
router.post('/carro/:id/finalizar', async (req, res, next) => {
    try {
        // Asegurarse de que req.db esté disponible
        if (!req.db) {
            throw new Error('No hay conexión a la base de datos disponible');
        }
        await finalizarProduccion(req, res);
    } catch (error) {
        console.error('Error en ruta /carro/:id/finalizar:', error);
        res.status(500).json({
            error: 'Error al finalizar la producción del carro',
            detalle: error.message
        });
    }
});

// Ruta para obtener el estado de un carro
// Ruta para obtener artículos para impresión de etiquetas
router.get('/carro/:id/articulos-etiquetas', obtenerArticulosParaEtiquetas);

// Ruta para obtener ingresos manuales de un carro
router.get('/carro/:id/ingresos-manuales', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 🔍 PASO 1: Obtener el tipo de carro para determinar qué consulta usar
        const carroQuery = `
            SELECT tipo_carro 
            FROM carros_produccion 
            WHERE id = $1
        `;
        const carroResult = await req.db.query(carroQuery, [id]);
        
        if (carroResult.rows.length === 0) {
            return res.status(404).json({ error: 'Carro no encontrado' });
        }
        
        const tipoCarro = carroResult.rows[0].tipo_carro || 'interna';
        console.log(`🔍 Tipo de carro detectado: ${tipoCarro}`);
        
        let query;
        
        if (tipoCarro === 'interna') {
            // 🏭 CARROS INTERNOS: Solo movimientos de artículos (stock_ventas_movimientos)
            query = `
                SELECT
                    svm.id,
                    svm.fecha,
                    ABS(svm.kilos) as kilos,
                    svm.carro_id,
                    NULL as ingrediente_id,
                    svm.articulo_numero,
                    a.nombre as articulo_nombre,
                    svm.codigo_barras,
                    a.nombre as ingrediente_nombre,
                    COALESCE(svm.origen_ingreso, 'simple') as tipo_articulo,
                    'stock_ventas_movimientos' as fuente_datos
                FROM stock_ventas_movimientos svm
                LEFT JOIN articulos a ON a.numero = svm.articulo_numero
                WHERE svm.carro_id = $1 
                  AND svm.tipo = 'ingreso a producción'
                ORDER BY svm.fecha DESC
            `;
            console.log('🏭 Usando consulta para CARRO INTERNO (solo stock_ventas_movimientos)');
        } else {
            // 🌐 CARROS EXTERNOS: Ambas fuentes (ingredientes_movimientos + stock_ventas_movimientos)
            query = `
                SELECT 
                    im.id,
                    im.fecha,
                    im.kilos,
                    im.carro_id,
                    im.ingrediente_id,
                    im.observaciones as articulo_numero,
                    a.nombre as articulo_nombre,
                    a.codigo_barras,
                    i.nombre as ingrediente_nombre,
                    'simple' as tipo_articulo,
                    'ingredientes_movimientos' as fuente_datos
                FROM ingredientes_movimientos im
                JOIN ingredientes i ON i.id = im.ingrediente_id
                LEFT JOIN articulos a ON a.numero = im.observaciones
                WHERE im.carro_id = $1 AND im.tipo = 'ingreso'

                UNION ALL

                SELECT
                    svm.id,
                    svm.fecha,
                    ABS(svm.kilos) as kilos,
                    svm.carro_id,
                    NULL as ingrediente_id,
                    svm.articulo_numero,
                    a.nombre as articulo_nombre,
                    svm.codigo_barras,
                    a.nombre as ingrediente_nombre,
                    COALESCE(svm.origen_ingreso, 'simple') as tipo_articulo,
                    'stock_ventas_movimientos' as fuente_datos
                FROM stock_ventas_movimientos svm
                LEFT JOIN articulos a ON a.numero = svm.articulo_numero
                WHERE svm.carro_id = $1 
                  AND svm.tipo = 'ingreso a producción'
                  AND svm.origen_ingreso IS NOT NULL

                ORDER BY fecha DESC
            `;
            console.log('🌐 Usando consulta para CARRO EXTERNO (ambas fuentes)');
        }
        
        try {
            console.log('📋 Consulta SQL para ingresos manuales:', query);
            console.log('📋 Parámetros:', [id]);
            const result = await req.db.query(query, [id]);
            
            // Log de depuración para ingresos manuales
            console.log(`\n📋 INGRESOS MANUALES - Carro ${id} (${tipoCarro}):`);
            console.log(`Total de registros encontrados: ${result.rows.length}`);
            
            // Logs específicos para depuración de MIX
            const registrosMix = result.rows.filter(row => row.tipo_articulo === 'mix');
            const registrosSimple = result.rows.filter(row => row.tipo_articulo === 'simple');
            console.log(`🔍 MIX - Registros encontrados: ${registrosMix.length}`);
            console.log(`🔍 SIMPLE - Registros encontrados: ${registrosSimple.length}`);
            
            if (registrosMix.length > 0) {
                console.log(`🧪 Detalle de registros MIX:`);
                registrosMix.forEach((mix, index) => {
                    console.log(`  ${index + 1}. ${mix.articulo_nombre} - ${mix.kilos}kg - Fuente: ${mix.fuente_datos}`);
                });
            }
            
            if (result.rows.length > 0) {
                console.table(result.rows.map(row => ({
                    id: row.id,
                    articulo_nombre: row.articulo_nombre || 'Sin nombre',
                    tipo_articulo: row.tipo_articulo,
                    fuente_datos: row.fuente_datos,
                    kilos: parseFloat(row.kilos).toFixed(2),
                    fecha: new Date(row.fecha).toLocaleString('es-AR')
                })));
            }
            
            res.json(result.rows);
        } catch (error) {
            console.error('❌ Error al obtener ingresos manuales:', error);
            console.error('❌ Stack trace:', error.stack);
            res.status(500).json({ error: 'Error al obtener ingresos manuales' });
        }
    } catch (error) {
        console.error('❌ Error general en endpoint ingresos-manuales:', error);
        res.status(500).json({ error: 'Error al obtener ingresos manuales' });
    }
});

router.get('/carro/:id/estado', async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            SELECT fecha_preparado, fecha_confirmacion, usuario_id, fecha_inicio, tipo_carro
            FROM carros_produccion 
            WHERE id = $1
        `;
        
        const result = await req.db.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Carro no encontrado' });
        }
        
        const carro = result.rows[0];
        const preparado = carro.fecha_preparado !== null;
        const confirmado = carro.fecha_confirmacion !== null;
        
        let estado = 'en_preparacion';
        if (confirmado) {
            estado = 'confirmado';
        } else if (preparado) {
            estado = 'preparado';
        }
        
        res.json({
            estado: estado,
            fecha_preparado: carro.fecha_preparado,
            fecha_confirmacion: carro.fecha_confirmacion,
            preparado: preparado,
            confirmado: confirmado,
            tipo_carro: carro.tipo_carro || 'interna' // Si no tiene tipo, asumir interna
        });
        
    } catch (error) {
        console.error('Error al obtener estado del carro:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

/**
 * Ruta: POST /api/produccion/ingredientes_movimientos
 * Descripción: Registra un movimiento manual de ingreso de stock
 * en la tabla ingredientes_movimientos.
 */
router.post('/ingredientes_movimientos', async (req, res) => {
  try {
    console.log('📥 Solicitud POST /ingredientes_movimientos recibida');
    const { ingrediente_id, kilos, carro_id, tipo, observaciones } = req.body;

    console.log('🔍 Datos recibidos:', req.body);

    if (
      ingrediente_id == null ||
      carro_id == null ||
      kilos == null ||
      isNaN(Number(kilos))
    ) {
      console.warn('⚠️ Validación fallida en POST /ingredientes_movimientos');
      return res.status(400).json({ error: 'Faltan campos obligatorios o kilos inválidos' });
    }

    const movimiento = {
      ingrediente_id,
      kilos: Number(kilos),
      tipo: tipo || 'ingreso',
      carro_id,
      observaciones: observaciones || null
    };

    console.log('📦 Movimiento armado para registrar:', movimiento);

    await registrarMovimientoIngrediente(movimiento, req.db);

    console.log('✅ Movimiento registrado correctamente');
    return res.status(201).json({ message: 'Movimiento registrado correctamente' });

  } catch (error) {
    console.error('❌ Error en POST /ingredientes_movimientos:', error);
    return res.status(500).json({ error: 'Error al registrar el movimiento' });
  }
});

module.exports = router;
