const express = require('express');
const router = express.Router();
const { dbMiddleware } = require('../middleware');

// Aplicar middleware de base de datos a todas las rutas
router.use(dbMiddleware);
const { 
    crearReceta, 
    obtenerEstadoRecetas, 
    obtenerReceta, 
    actualizarReceta,
    obtenerIngredientesExpandidos 
} = require('../controllers/recetas');
const {
    crearCarro,
    agregarArticulo,
    obtenerArticulos,
    obtenerArticulosDeCarro,
    obtenerCarrosDeUsuario,
    eliminarCarro,
    eliminarArticuloDeCarro,
    modificarCantidadDeArticulo,
    obtenerInfoEliminacion
} = require('../controllers/carro');
const {
    obtenerIngredientes,
    obtenerIngrediente,
    crearIngrediente,
    actualizarIngrediente,
    eliminarIngrediente
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

// Rutas para artículos
router.get('/articulos', async (req, res) => {
    try {
        console.log('Recibida solicitud GET /articulos');
        const articulos = await obtenerArticulos();
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

// Rutas para carros de producción
router.post('/carro', async (req, res) => {
    try {
        const { usuarioId, enAuditoria } = req.body;
        
        if (!usuarioId || isNaN(parseInt(usuarioId))) {
            return res.status(400).json({ error: 'Se requiere un ID de usuario válido' });
        }

        const carroId = await crearCarro(parseInt(usuarioId), enAuditoria);
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



// =========================

const { marcarCarroPreparado } = require('../controllers/marcarCarroPreparado');
const { finalizarProduccion } = require('../controllers/finalizarProduccion');
const { registrarMovimientoIngrediente } = require('../controllers/ingredientesMovimientos');

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
router.get('/carro/:id/estado', async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            SELECT fecha_preparado, fecha_confirmacion, usuario_id, fecha_inicio
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
            confirmado: confirmado
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