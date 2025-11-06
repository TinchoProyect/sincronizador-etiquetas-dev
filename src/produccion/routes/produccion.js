const express = require('express');
const router = express.Router();


//Temporizacion - Mari
const tiemposCtrl = require('../controllers/tiemposCarro');

// ✅ alias (mantener compatibilidad con front viejo)
router.post('/carro/:carroId/articulo/:numero/iniciar',  tiemposCtrl.iniciarTemporizadorArticulo);
router.post('/carro/:carroId/articulo/:numero/finalizar', tiemposCtrl.finalizarTemporizadorArticulo);
router.get('/carro/:carroId/tiempo-total', tiemposCtrl.obtenerTiempoTotalCarro);



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
const { obtenerArticulos, buscarArticuloPorCodigo, actualizarProduccionLambda, actualizarProduccionExterna, actualizarKilosUnidad, buscarArticulos } = require('../controllers/articulos');

// Controladores para pedidos por cliente
const { obtenerPedidosPorCliente, obtenerPedidosArticulos, asignarFaltantes, actualizarPackMapping } = require('../controllers/pedidosPorCliente');
const { imprimirPresupuestoCliente } = require('../controllers/impresionPresupuestos');

// Ruta para alternar estado de producción externa (toggle)
router.put('/articulos/:articuloId/toggle-produccion-externa', async (req, res) => {
    try {
        const { articuloId } = req.params;
        const { solo_produccion_externa } = req.body;

        if (!articuloId) {
            return res.status(400).json({ error: 'ID de artículo requerido' });
        }

        if (typeof solo_produccion_externa !== 'boolean') {
            return res.status(400).json({ error: 'El campo solo_produccion_externa debe ser un booleano' });
        }

        const resultado = await actualizarProduccionExterna(articuloId, solo_produccion_externa);
        res.json(resultado);
    } catch (error) {
        console.error('Error en ruta PUT /articulos/:articuloId/toggle-produccion-externa:', error);
        res.status(500).json({ error: 'Error al actualizar el estado de producción externa' });
    }
});

// Ruta para actualizar kilos por unidad de un artículo
router.put('/articulos/:articuloId/kilos-unidad', async (req, res) => {
    try {
        const { articuloId } = req.params;
        const { kilos_unidad } = req.body;

        if (!articuloId) {
            return res.status(400).json({ error: 'ID de artículo requerido' });
        }

        const resultado = await actualizarKilosUnidad(articuloId, kilos_unidad);
        res.json(resultado);
    } catch (error) {
        console.error('Error en ruta PUT /articulos/:articuloId/kilos-unidad:', error);
        res.status(500).json({ error: 'Error al actualizar kilos por unidad' });
    }
});
const {
    obtenerIngredientes,
    obtenerIngrediente,
    crearIngrediente,
    actualizarIngrediente,
    eliminarIngrediente,
    obtenerNuevoCodigo,
    obtenerUsuariosConStock,
    obtenerStockPorUsuario,
    obtenerSectores,
    obtenerIngredientesPorSectores
} = require('../controllers/ingredientes');

const mixesRouter = require('./mixes'); // ← Incorporación del router de mixes
const carroIngredientesRouter = require('./carroIngredientes'); // ← Incorporación del router de ingredientes de carro
const historialInventariosRouter = require('./historialInventarios'); // ← Incorporación del router de historial de inventarios

router.use('/mixes', mixesRouter);     // ← Montar rutas para mixes
router.use('/carro', carroIngredientesRouter); // ← Montar rutas para ingredientes de carro
router.use('/', historialInventariosRouter); // ← Montar rutas para historial de inventarios

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

// Ruta para obtener sectores disponibles
router.get('/sectores', async (req, res) => {
    try {
        console.log('🔍 [SECTORES] Solicitando lista de sectores...');
        const sectores = await obtenerSectores();
        res.json(sectores);
    } catch (error) {
        console.error('❌ [SECTORES] Error al obtener sectores:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para obtener ingredientes por sectores específicos (para diferencias de inventario)
router.post('/ingredientes/por-sectores', async (req, res) => {
    try {
        console.log('🔍 [DIFERENCIAS] Solicitando ingredientes por sectores...');
        const { sectores } = req.body;
        
        if (!sectores) {
            return res.status(400).json({ error: 'Se requiere el parámetro sectores' });
        }
        
        console.log('🔍 [DIFERENCIAS] Sectores recibidos:', sectores);
        const ingredientes = await obtenerIngredientesPorSectores(sectores);
        console.log(`✅ [DIFERENCIAS] Enviando ${ingredientes.length} ingredientes`);
        res.json(ingredientes);
    } catch (error) {
        console.error('❌ [DIFERENCIAS] Error al obtener ingredientes por sectores:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para crear un nuevo sector
router.post('/sectores', async (req, res) => {
    try {
        const { crearSector } = require('../controllers/ingredientes');
        const nuevoSector = await crearSector(req.body);
        res.status(201).json(nuevoSector);
    } catch (error) {
        console.error('❌ [SECTORES] Error en POST /sectores:', error);
        const statusCode = error.message.includes('requerido') || error.message.includes('existe') ? 400 : 500;
        res.status(statusCode).json({ error: error.message });
    }
});

// Ruta para actualizar un sector
router.put('/sectores/:id', async (req, res) => {
    try {
        const { actualizarSector } = require('../controllers/ingredientes');
        const sectorActualizado = await actualizarSector(req.params.id, req.body);
        res.json(sectorActualizado);
    } catch (error) {
        console.error('❌ [SECTORES] Error en PUT /sectores/:id:', error);
        let statusCode = 500;
        if (error.message.includes('requerido') || error.message.includes('existe')) {
            statusCode = 400;
        } else if (error.message.includes('no encontrado')) {
            statusCode = 404;
        }
        res.status(statusCode).json({ error: error.message });
    }
});

// Ruta para eliminar un sector
router.delete('/sectores/:id', async (req, res) => {
    try {
        const { eliminarSector } = require('../controllers/ingredientes');
        const resultado = await eliminarSector(req.params.id);
        res.json(resultado);
    } catch (error) {
        console.error('❌ [SECTORES] Error en DELETE /sectores/:id:', error);
        let statusCode = 500;
        if (error.message.includes('no se puede eliminar')) {
            statusCode = 400;
        } else if (error.message.includes('no encontrado')) {
            statusCode = 404;
        }
        res.status(statusCode).json({ error: error.message });
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
        const { nombre, codigo } = req.query;
        
        if (codigo) {
            // Buscar por código usando el controlador
            const { buscarIngredientePorCodigo } = require('../controllers/ingredientes');
            const ingrediente = await buscarIngredientePorCodigo(codigo);
            return res.json(ingrediente);
        }
        
        if (nombre) {
            // Buscar por nombre (lógica original)
            const query = `
                SELECT id 
                FROM ingredientes 
                WHERE LOWER(nombre) = LOWER($1)
            `;
            const result = await req.db.query(query, [nombre]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Ingrediente no encontrado' });
            }
            
            return res.json({ id: result.rows[0].id });
        }
        
        return res.status(400).json({ error: 'Se requiere el parámetro nombre o codigo' });
    } catch (error) {
        console.error('Error en ruta GET /ingredientes/buscar:', error);
        if (error.message === 'Ingrediente no encontrado') {
            res.status(404).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
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
    console.log('🔍 validarReceta - Body recibido:', req.body);
    const { descripcion, ingredientes, esProduccionExternaConArticuloPrincipal } = req.body;
    const articulo_numero = req.method === 'POST' ? req.body.articulo_numero : req.params.numero_articulo;

    console.log('🔍 validarReceta - esProduccionExternaConArticuloPrincipal:', esProduccionExternaConArticuloPrincipal);
    console.log('🔍 validarReceta - ingredientes:', ingredientes);

    if (req.method === 'POST' && (!articulo_numero || typeof articulo_numero !== 'string' || !articulo_numero.trim())) {
        console.log('❌ validarReceta - Error: número de artículo inválido');
        return res.status(400).json({ error: 'El número de artículo es requerido y debe ser un texto válido' });
    }

    // Permitir ingredientes vacíos si es producción externa con artículo principal
    if (!Array.isArray(ingredientes) || (ingredientes.length === 0 && !esProduccionExternaConArticuloPrincipal)) {
        console.log('❌ validarReceta - Error: ingredientes vacíos sin flag de producción externa');
        return res.status(400).json({ error: 'Se requiere al menos un ingrediente, excepto para producción externa con artículo principal' });
    }

    // Solo validar ingredientes si existen
    if (ingredientes.length > 0) {
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
            console.log('❌ validarReceta - Error: ingredientes inválidos');
            return res.status(400).json({ 
                error: 'Cada ingrediente debe tener nombre válido, unidad de medida y cantidad mayor a 0' 
            });
        }
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

    console.log('✅ validarReceta - Validación exitosa, pasando al controlador');
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

        const articulos = await obtenerArticulosDeCarro(carroId, usuarioId, req.db);
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

// Importar el controlador de guardado de ingredientes
const { obtenerIngredientesConsolidadosCarro, ajustarStockIngrediente } = require('../controllers/guardadoIngredientes');

// Ruta para eliminar físicamente un ingreso manual
router.delete('/carro/:carroId/ingreso-manual/:ingresoId', eliminarIngresoManual);

// ==========================================
// RUTAS PARA GUARDADO DE INGREDIENTES
// ==========================================

// Ruta para obtener ingredientes consolidados de un carro para el modal de guardado
router.get('/carro/:carroId/ingredientes-consolidados', async (req, res) => {
    try {
        console.log('🔍 [GUARDADO] Solicitando ingredientes consolidados para guardado');
        await obtenerIngredientesConsolidadosCarro(req, res);
    } catch (error) {
        console.error('❌ [GUARDADO] Error en /carro/:carroId/ingredientes-consolidados:', error);
        res.status(500).json({
            error: 'Error al obtener ingredientes consolidados',
            detalle: error.message
        });
    }
});

// Ruta para realizar ajuste manual de stock de ingrediente
router.post('/ingredientes/:ingredienteId/ajustar-stock', async (req, res) => {
    try {
        console.log('🔧 [GUARDADO] Realizando ajuste manual de stock');
        await ajustarStockIngrediente(req, res);
    } catch (error) {
        console.error('❌ [GUARDADO] Error en /ingredientes/:ingredienteId/ajustar-stock:', error);
        res.status(500).json({
            error: 'Error al ajustar stock de ingrediente',
            detalle: error.message
        });
    }
});

// Ruta para ajustes puntuales de ingredientes (batch)
router.post('/ingredientes-ajustes/batch', async (req, res) => {
    try {
        const { ajustes } = req.body;
        
        console.log(`\n🔧 [AJUSTES-INGREDIENTES] ===== PROCESANDO BATCH DE AJUSTES PUNTUALES =====`);
        console.log(`📥 [DATOS] Total ajustes recibidos: ${ajustes?.length || 0}`);
        console.log(`📋 [DATOS] Datos completos:`, JSON.stringify(req.body, null, 2));
        
        if (!ajustes || !Array.isArray(ajustes) || ajustes.length === 0) {
            console.error('❌ [ERROR] No se recibió array de ajustes válido');
            return res.status(400).json({ error: 'Se requiere una lista de ajustes' });
        }

        // Iniciar transacción
        await req.db.query('BEGIN');
        console.log('🔄 [TRANSACCIÓN] Iniciada');

        try {
            let ajustesAplicados = 0;
            let erroresEncontrados = [];

            for (let i = 0; i < ajustes.length; i++) {
                const ajuste = ajustes[i];
                console.log(`\n📦 [AJUSTE ${i + 1}/${ajustes.length}] ===== PROCESANDO =====`);
                console.log(`📦 [AJUSTE ${i + 1}] Datos:`, ajuste);
                
                const { articulo_numero, usuario_id, tipo, kilos, cantidad, observacion } = ajuste;
                
                try {
                    console.log(`🎯 [AJUSTE-PUNTUAL] Iniciando procesamiento`);
                    console.log(`🎯 [AJUSTE-PUNTUAL] Ingrediente: ${articulo_numero}`);
                    console.log(`🎯 [AJUSTE-PUNTUAL] Ajuste: ${kilos} kg`);
                    console.log(`🎯 [AJUSTE-PUNTUAL] Usuario: ${usuario_id}`);
                    
                    // 🔍 BUSCAR INGREDIENTE
                    console.log(`🔍 [BUSCAR] Buscando ingrediente...`);
                    
                    const articuloStr = articulo_numero.toString();
                    const esNumerico = /^\d+$/.test(articuloStr);
                    const articuloInt = esNumerico ? parseInt(articuloStr) : null;
                    
                    const buscarQuery = `
                        SELECT id, nombre, codigo, stock_actual 
                        FROM ingredientes 
                        WHERE codigo = $1 OR (id = $2 AND $3 = true)
                    `;
                    console.log(`🔍 [BUSCAR] Query: ${buscarQuery}`);
                    console.log(`🔍 [BUSCAR] Parámetros: ["${articuloStr}", ${articuloInt}, ${esNumerico}]`);
                    
                    const buscarResult = await req.db.query(buscarQuery, [articuloStr, articuloInt, esNumerico]);
                    console.log(`🔍 [BUSCAR] Filas encontradas: ${buscarResult.rows.length}`);
                    
                    if (buscarResult.rows.length === 0) {
                        const error = `Ingrediente no encontrado: ${articulo_numero}`;
                        console.error(`❌ [ERROR] ${error}`);
                        erroresEncontrados.push(error);
                        continue;
                    }
                    
                    const ingrediente = buscarResult.rows[0];
                    console.log(`✅ [ENCONTRADO] Ingrediente completo:`, ingrediente);
                    console.log(`✅ [ENCONTRADO] ID: ${ingrediente.id}`);
                    console.log(`✅ [ENCONTRADO] Nombre: ${ingrediente.nombre}`);
                    console.log(`✅ [ENCONTRADO] Código: ${ingrediente.codigo}`);
                    console.log(`✅ [ENCONTRADO] Stock actual: ${ingrediente.stock_actual}`);
                    
                    // 🧮 CALCULAR DIFERENCIA PARA TRIGGER
                    const stockAnterior = parseFloat(ingrediente.stock_actual) || 0;
                    const nuevoStockDeseado = parseFloat(kilos) || 0;
                    const diferencia = nuevoStockDeseado - stockAnterior;
                    
                    console.log(`🧮 [CÁLCULO] ===== CALCULANDO AJUSTE PARA TRIGGER =====`);
                    console.log(`🧮 [CÁLCULO] Stock anterior: ${stockAnterior}`);
                    console.log(`🧮 [CÁLCULO] Nuevo stock deseado: ${nuevoStockDeseado}`);
                    console.log(`🧮 [CÁLCULO] Diferencia calculada: ${diferencia}`);
                    console.log(`🔧 [CORRECCIÓN] Usando trigger actualizar_stock_ingrediente`);
                    
                    // Si la diferencia es 0, no hacer nada
                    if (Math.abs(diferencia) < 0.001) {
                        console.log(`ℹ️ [SKIP] Diferencia es 0, no se registra movimiento`);
                        ajustesAplicados++;
                        continue;
                    }
                    
                    // 🔧 CORRECCIÓN: Siempre usar "ajuste" para movimientos desde guardado de ingredientes
                    const tipoMovimiento = 'ajuste';
                    const kilosParaTrigger = diferencia; // El trigger suma/resta según el valor (+ o -)
                    
                    // Log de depuración para auditoría
                    console.log("🔍 DEBUG - Guardando ajuste de ingrediente desde batch", {
                        ingrediente_id: ingrediente.id,
                        diferencia: kilosParaTrigger,
                        tipo: tipoMovimiento,
                        carro_id: ajuste.carro_id || null
                    });
                    
                    const insertMovimientoQuery = `
                        INSERT INTO ingredientes_movimientos 
                        (ingrediente_id, tipo, kilos, fecha, carro_id, observaciones)
                        VALUES ($1, $2, $3, NOW(), $4, $5)
                        RETURNING id
                    `;
                    
                    console.log(`🔄 [MOVIMIENTO] Registrando en ingredientes_movimientos...`);
                    console.log(`🔄 [MOVIMIENTO] Tipo: ${tipoMovimiento}, Kilos: ${kilosParaTrigger}, Carro: ${ajuste.carro_id || 'NULL'}`);
                    
                    const movimientoResult = await req.db.query(insertMovimientoQuery, [
                        ingrediente.id,
                        tipoMovimiento,
                        kilosParaTrigger,
                        ajuste.carro_id || null,
                        observacion || `Ajuste puntual desde guardado - De ${stockAnterior} a ${nuevoStockDeseado}`
                    ]);
                    
                    const movimientoId = movimientoResult.rows[0].id;
                    console.log(`✅ [MOVIMIENTO] Movimiento registrado con ID: ${movimientoId}`);
                    console.log(`✅ [TRIGGER] El trigger actualizar_stock_ingrediente actualizará stock_actual automáticamente`);
                    
                    // 📝 REGISTRAR EN INGREDIENTES_AJUSTES para auditoría
                    const insertAjusteQuery = `
                        INSERT INTO ingredientes_ajustes 
                        (ingrediente_id, usuario_id, tipo_ajuste, stock_anterior, stock_nuevo, observacion, fecha)
                        VALUES ($1, $2, $3, $4, $5, $6, NOW())
                    `;
                    
                    console.log(`📝 [AUDITORÍA] Registrando en ingredientes_ajustes...`);
                    
                    const insertResult = await req.db.query(insertAjusteQuery, [
                        ingrediente.id,
                        usuario_id,
                        'ajuste_puntual',
                        stockAnterior,
                        nuevoStockDeseado,
                        observacion || `Ajuste puntual - Movimiento ID: ${movimientoId}`
                    ]);
                    
                    console.log(`✅ [AUDITORÍA] Ajuste registrado para auditoría`);
                    
                    ajustesAplicados++;
                    console.log(`🎯 [AJUSTE-PUNTUAL] Completado exitosamente para ${ingrediente.nombre}`);
                    
                } catch (ajusteError) {
                    console.error(`❌ [AJUSTE-PUNTUAL] Error procesando ingrediente ${articulo_numero}:`, ajusteError);
                    erroresEncontrados.push(`Error en ajuste puntual de ${articulo_numero}: ${ajusteError.message}`);
                }
            }

            // Confirmar transacción
            await req.db.query('COMMIT');
            console.log('✅ [TRANSACCIÓN] Confirmada exitosamente');

            const respuesta = {
                message: `Ajustes puntuales aplicados: ${ajustesAplicados} ingredientes actualizados`,
                ajustes_aplicados: ajustesAplicados,
                errores: erroresEncontrados.length > 0 ? erroresEncontrados : undefined
            };

            console.log(`🎉 [ÉXITO] Batch de ajustes puntuales completado:`, respuesta);
            res.json(respuesta);

        } catch (error) {
            // Revertir transacción en caso de error
            await req.db.query('ROLLBACK');
            console.error('❌ [ERROR] Error en batch de ajustes puntuales:', error);
            console.error('❌ [ERROR] Stack trace:', error.stack);
            
            res.status(500).json({
                error: 'Error al aplicar ajustes puntuales',
                detalle: error.message
            });
        }

        console.log(`🏁 [FIN] ===== BATCH DE AJUSTES PUNTUALES COMPLETADO =====\n`);
        
    } catch (error) {
        console.error('❌ [FATAL] Error crítico en batch de ajustes puntuales:', error);
        res.status(500).json({
            error: 'Error crítico al procesar ajustes puntuales',
            detalle: error.message
        });
    }
});

// Ruta para registrar múltiples movimientos de stock (inventario de artículos únicamente)
router.post('/stock-ventas-movimientos/batch', async (req, res) => {
    try {
        const { ajustes } = req.body;
        
        console.log('[ARTÍCULOS-DEBUG] Ingreso al endpoint /stock-ventas-movimientos/batch con', ajustes.length, 'ajustes recibidos');
        
        if (!ajustes || !Array.isArray(ajustes) || ajustes.length === 0) {
            return res.status(400).json({ error: 'Se requiere una lista de ajustes' });
        }

        // 🛑 VALIDACIÓN: Rechazar datos de ingredientes
        const tieneIngredientes = ajustes.some(ajuste => 
            ajuste.tipo === 'ajuste puntual' || 
            ajuste.ingrediente_id || 
            (ajuste.observacion && ajuste.observacion.includes('ingrediente'))
        );
        
        console.log('[ARTÍCULOS-DEBUG] ¿Contiene ingredientes? →', tieneIngredientes);
        
        if (tieneIngredientes) {
            ajustes.forEach(a => {
                if (a.tipo === 'ajuste puntual' || a.ingrediente_id || (a.observacion && a.observacion.includes('ingrediente'))) {
                    console.log('[ARTÍCULOS-DEBUG] Ajuste rechazado por ingrediente:', {
                        tipo: a.tipo,
                        ingrediente_id: a.ingrediente_id,
                        observacion: a.observacion
                    });
                }
            });
            
            return res.status(400).json({ 
                error: 'Este endpoint procesa exclusivamente movimientos de artículos. Use /ingredientes-ajustes/batch para ingredientes.' 
            });
        }

        // Iniciar transacción
        await req.db.query('BEGIN');

        try {
            const { recalcularStockConsolidado } = require('../utils/recalcularStock');
            let movimientosRegistrados = 0;
            let erroresEncontrados = [];
            const articulosAfectados = new Set(); // Para evitar duplicados

            for (let i = 0; i < ajustes.length; i++) {
                const ajuste = ajustes[i];
                const { articulo_numero, usuario_id, tipo, kilos, cantidad, observacion } = ajuste;
                
                try {
                    console.log('[ARTÍCULOS-DEBUG] Procesando artículo:', { articulo_numero, cantidad });
                    
                    // 1. Registrar movimiento en stock_ventas_movimientos
                    const insertMovimientoQuery = `
                        INSERT INTO stock_ventas_movimientos 
                        (articulo_numero, usuario_id, tipo, kilos, cantidad, fecha)
                        VALUES ($1, $2, $3, $4, $5, NOW())
                    `;
                    
                    const params = [articulo_numero, usuario_id, tipo, kilos, cantidad];
                    await req.db.query(insertMovimientoQuery, params);
                    
                    // 2. Actualizar stock_ajustes en stock_real_consolidado
                    const updateStockQuery = `
                        INSERT INTO stock_real_consolidado (
                            articulo_numero, 
                            stock_ajustes,
                            ultima_actualizacion
                        )
                        VALUES ($1, $2, NOW())
                        ON CONFLICT (articulo_numero) 
                        DO UPDATE SET 
                            stock_ajustes = COALESCE(stock_real_consolidado.stock_ajustes, 0) + $2,
                            ultima_actualizacion = NOW()
                    `;
                    
                    // Para ajustes de inventario, usar la cantidad como ajuste
                    const ajusteStock = parseFloat(cantidad) || 0;
                    await req.db.query(updateStockQuery, [articulo_numero, ajusteStock]);
                    
                    // Agregar artículo a la lista para recalcular
                    articulosAfectados.add(articulo_numero);
                    
                    movimientosRegistrados++;
                    console.log('[ARTÍCULOS-DEBUG] Artículo procesado exitosamente:', articulo_numero);
                    
                } catch (articuloError) {
                    console.error('[ARTÍCULOS-DEBUG] Error procesando artículo:', articulo_numero, articuloError);
                    erroresEncontrados.push(`Error en movimiento de artículo ${articulo_numero}: ${articuloError.message}`);
                }
            }

            // 3. Recalcular stock_consolidado para todos los artículos afectados
            if (articulosAfectados.size > 0) {
                const articulosArray = Array.from(articulosAfectados);
                console.log('[ARTÍCULOS-DEBUG] Recalculando stock consolidado para', articulosArray.length, 'artículos');
                await recalcularStockConsolidado(req.db, articulosArray);
                console.log('[ARTÍCULOS-DEBUG] Stock consolidado recalculado exitosamente');
            }

            // Confirmar transacción
            await req.db.query('COMMIT');

            const respuesta = {
                message: `Inventario de artículos registrado: ${movimientosRegistrados} movimientos procesados`,
                movimientos_registrados: movimientosRegistrados,
                articulos_actualizados: articulosAfectados.size,
                errores: erroresEncontrados.length > 0 ? erroresEncontrados : undefined
            };

            console.log('[ARTÍCULOS-DEBUG] Proceso completado exitosamente:', respuesta);
            res.json(respuesta);

        } catch (error) {
            // Revertir transacción en caso de error
            await req.db.query('ROLLBACK');
            console.error('[ARTÍCULOS-DEBUG] Error en transacción, realizando rollback:', error);
            
            res.status(500).json({
                error: 'Error al registrar movimientos de artículos',
                detalle: error.message
            });
        }
        
    } catch (error) {
        console.error('[ARTÍCULOS-DEBUG] Error crítico:', error);
        res.status(500).json({
            error: 'Error crítico al procesar movimientos de artículos',
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
const {
    obtenerRelacionesCarro,
    obtenerRelacionPorArticulo,
    obtenerRelacionesPorArticulos,
    crearRelacion,
    actualizarRelacion,
    eliminarRelacion,
    eliminarRelacionPorArticulo
} = require('../controllers/relacionesArticulos');

// Controlador para inventario de ingredientes
const {
    iniciarSesionInventario,
    registrarIngredienteContado,
    aplicarAjustesInventario,
    obtenerEstadoSesion
} = require('../controllers/inventarioIngredientesSimple');

// Controlador para inventario de artículos
const {
    finalizarInventarioArticulos
} = require('../controllers/inventarioArticulos');

// ==========================================
// RUTAS PARA INVENTARIO DE INGREDIENTES
// ==========================================

// Ruta para iniciar una nueva sesión de inventario de ingredientes
router.post('/inventario-ingredientes/iniciar', async (req, res) => {
    try {
        console.log('🚀 [RUTA] Iniciando sesión de inventario de ingredientes');
        await iniciarSesionInventario(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /inventario-ingredientes/iniciar:', error);
        res.status(500).json({
            error: 'Error al iniciar sesión de inventario',
            detalle: error.message
        });
    }
});

// Ruta para registrar un ingrediente contado en la sesión
router.post('/inventario-ingredientes/contar', async (req, res) => {
    try {
        console.log('📝 [RUTA] Registrando ingrediente contado');
        await registrarIngredienteContado(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /inventario-ingredientes/contar:', error);
        res.status(500).json({
            error: 'Error al registrar ingrediente contado',
            detalle: error.message
        });
    }
});

// Ruta para aplicar los ajustes de inventario
router.post('/inventario-ingredientes/:session_id/aplicar', async (req, res) => {
    try {
        console.log('🔧 [RUTA] Aplicando ajustes de inventario');
        await aplicarAjustesInventario(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /inventario-ingredientes/:session_id/aplicar:', error);
        res.status(500).json({
            error: 'Error al aplicar ajustes de inventario',
            detalle: error.message
        });
    }
});

// Ruta para obtener el estado de una sesión de inventario
router.get('/inventario-ingredientes/:session_id/estado', async (req, res) => {
    try {
        console.log('📊 [RUTA] Obteniendo estado de sesión de inventario');
        await obtenerEstadoSesion(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /inventario-ingredientes/:session_id/estado:', error);
        res.status(500).json({
            error: 'Error al obtener estado de sesión',
            detalle: error.message
        });
    }
});

// ==========================================
// RUTAS PARA INVENTARIO DE ARTÍCULOS
// ==========================================

// Ruta para finalizar inventario de artículos
router.post('/inventario-articulos/finalizar', async (req, res) => {
    try {
        console.log('🚀 [RUTA] Finalizando inventario de artículos');
        await finalizarInventarioArticulos(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /inventario-articulos/finalizar:', error);
        res.status(500).json({
            error: 'Error al finalizar inventario de artículos',
            detalle: error.message
        });
    }
});

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

// Ruta para obtener el resumen de artículos de un carro
router.get('/carro/:id/articulos-resumen', async (req, res) => {
    try {
        const carroId = parseInt(req.params.id);
        const usuarioId = parseInt(req.query.usuarioId);

        if (isNaN(carroId) || isNaN(usuarioId)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }

        // Verificar que el carro pertenezca al usuario
        const carroQuery = `
            SELECT tipo_carro
            FROM carros_produccion
            WHERE id = $1 AND usuario_id = $2
        `;
        const carroResult = await req.db.query(carroQuery, [carroId, usuarioId]);

        if (carroResult.rows.length === 0) {
            return res.status(404).json({ error: 'Carro no encontrado' });
        }

        const tipoCarro = carroResult.rows[0].tipo_carro;

        if (tipoCarro === 'externa') {
            // Para carros externos: obtener artículos de recetas
            const articulosQuery = `
                SELECT 
                    ra.articulo_numero,
                    COALESCE(
                        NULLIF(TRIM(src.descripcion), ''),
                        NULLIF(TRIM(a.nombre), ''),
                        ra.articulo_numero
                    ) as nombre,
                    SUM(ra.cantidad * ca.cantidad) as cantidad_total,
                    COALESCE(src.stock_consolidado, 0) as stock_actual
                FROM carros_articulos ca
                JOIN recetas r ON r.articulo_numero = ca.articulo_numero
                JOIN receta_articulos ra ON ra.receta_id = r.id
                LEFT JOIN stock_real_consolidado src ON src.articulo_numero = ra.articulo_numero
                LEFT JOIN articulos a ON a.codigo_barras = ra.articulo_numero
                WHERE ca.carro_id = $1
                GROUP BY ra.articulo_numero, src.descripcion, a.nombre, src.stock_consolidado
                ORDER BY ra.articulo_numero
            `;

            const result = await req.db.query(articulosQuery, [carroId]);
            res.json(result.rows);
        } else {
            // Para carros internos: devolver array vacío (no tienen artículos de recetas)
            console.log(`📦 Carro interno ${carroId} - devolviendo array vacío para articulos-resumen`);
            res.json([]);
        }

    } catch (error) {
        console.error('Error al obtener resumen de artículos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ruta para obtener el estado de un carro
// Ruta para obtener artículos para impresión de etiquetas
router.get('/carro/:id/articulos-etiquetas', obtenerArticulosParaEtiquetas);

// Ruta para obtener artículos de recetas de un carro (solo para carros externos)
router.get('/carro/:id/articulos-recetas', async (req, res) => {
    try {
        const carroId = parseInt(req.params.id);
        const usuarioId = parseInt(req.query.usuarioId);

        if (isNaN(carroId) || isNaN(usuarioId)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }

        // Importar la función del controlador
        const { obtenerArticulosDeRecetas } = require('../controllers/carroIngredientes');
        
        const articulos = await obtenerArticulosDeRecetas(carroId, usuarioId);
        res.json(articulos);
    } catch (error) {
        console.error('Error al obtener artículos de recetas del carro:', error);
        res.status(500).json({ error: error.message });
    }
});

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
            // 🔧 CORRECCIÓN CRÍTICA: NO multiplicar por cantidad porque el frontend ya lo hizo
            // 🆕 CORRECCIÓN ETIQUETAS: Obtener ingrediente_id desde ingredientes_movimientos relacionados
            query = `
                SELECT
                    svm.id,
                    svm.fecha,
                    ABS(svm.kilos) as kilos,
                    svm.carro_id,
                    COALESCE(im.ingrediente_id, NULL) as ingrediente_id,
                    svm.articulo_numero,
                    a.nombre as articulo_nombre,
                    svm.codigo_barras,
                    COALESCE(i.nombre, a.nombre) as ingrediente_nombre,
                    COALESCE(svm.origen_ingreso, 'simple') as tipo_articulo,
                    'stock_ventas_movimientos' as fuente_datos
                FROM stock_ventas_movimientos svm
                LEFT JOIN articulos a ON a.numero = svm.articulo_numero
                LEFT JOIN ingredientes_movimientos im ON im.carro_id = svm.carro_id 
                    AND im.observaciones = svm.articulo_numero 
                    AND im.tipo = 'ingreso'
                    AND ABS(im.kilos - ABS(svm.kilos)) < 0.01
                LEFT JOIN ingredientes i ON i.id = im.ingrediente_id
                WHERE svm.carro_id = $1 
                  AND svm.tipo = 'ingreso a producción'
                ORDER BY svm.fecha DESC
            `;
            console.log('🏭 Usando consulta para CARRO INTERNO - CORRECCIÓN: con ingrediente_id para etiquetas');
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
        const tipoCarro = carro.tipo_carro || 'interna';
        
        let estado = 'en_preparacion';
        if (confirmado) {
            estado = 'confirmado';
        } else if (preparado) {
            estado = 'preparado';
        }
        
        // Determinar fase actual para carros externos
        let faseActual = 'articulos_padres';
        if (tipoCarro === 'externa' && preparado && !confirmado) {
            faseActual = 'articulos_secundarios';
        }
        
        res.json({
            estado: estado,
            fecha_preparado: carro.fecha_preparado,
            fecha_confirmacion: carro.fecha_confirmacion,
            preparado: preparado,
            confirmado: confirmado,
            tipo_carro: tipoCarro,
            fase_actual: faseActual,
            mostrar_artículos_padres: faseActual === 'articulos_padres',
            mostrar_artículos_secundarios: faseActual === 'articulos_secundarios'
        });
        
    } catch (error) {
        console.error('Error al obtener estado del carro:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

/**
 * Ruta: POST /api/produccion/ingredientes_movimientos
 * Descripción: Registra un movimiento manual de ingreso de stock
 * 🔧 NUEVA ESTRATEGIA: Usa ingredientes_ajustes para ajustes puntuales
 */
router.post('/ingredientes_movimientos', async (req, res) => {
  const client = await req.db.connect();
  try {
    console.log('📥 Solicitud POST /ingredientes_movimientos recibida');
    const { ingrediente_id, kilos, carro_id, tipo, observaciones } = req.body;

    console.log('🔍 Datos recibidos:', req.body);

    if (
      ingrediente_id == null ||
      kilos == null ||
      isNaN(Number(kilos))
    ) {
      console.warn('⚠️ Validación fallida en POST /ingredientes_movimientos');
      return res.status(400).json({ error: 'Faltan campos obligatorios o kilos inválidos' });
    }

    // Iniciar transacción
    await client.query('BEGIN');

    // 🔧 DETECCIÓN DE AJUSTE PUNTUAL: Si las observaciones contienen "Ajuste puntual"
    const esAjustePuntual = observaciones && observaciones.includes('Ajuste puntual');
    
    if (esAjustePuntual) {
      console.log('🔧 [AJUSTE PUNTUAL] Detectado ajuste puntual - Iniciando proceso de depuración');
      
      // Obtener información del ingrediente
      const ingredienteQuery = `
        SELECT nombre, unidad_medida, stock_actual 
        FROM ingredientes 
        WHERE id = $1
      `;
      console.log(`🔍 [DEBUG] Consultando ingrediente con ID: ${ingrediente_id}`);
      const ingredienteResult = await client.query(ingredienteQuery, [ingrediente_id]);
      
      if (ingredienteResult.rows.length === 0) {
        console.error(`❌ [DEBUG] ERROR CRÍTICO: Ingrediente con ID ${ingrediente_id} no encontrado en la base de datos`);
        throw new Error(`Ingrediente con ID ${ingrediente_id} no encontrado`);
      }
      
      const ingredienteInfo = ingredienteResult.rows[0];
      console.log(`✅ [DEBUG] Ingrediente encontrado exitosamente`);
      
      console.log(`\n🔍 ===== DEPURACIÓN AJUSTE PUNTUAL =====`);
      console.log(`📋 [DEBUG] INGREDIENTE SELECCIONADO:`);
      console.log(`   - ID: ${ingrediente_id}`);
      console.log(`   - Nombre: "${ingredienteInfo.nombre}"`);
      console.log(`   - Unidad de medida: ${ingredienteInfo.unidad_medida}`);
      console.log(`📊 [DEBUG] STOCK ACTUAL ANTES DEL AJUSTE: ${ingredienteInfo.stock_actual}`);
      
      const stockActualReal = parseFloat(ingredienteInfo.stock_actual);
      const tipoMovimiento = tipo.toLowerCase();
      const cantidadMovimiento = Number(kilos);
      
      console.log(`🔢 [DEBUG] VALORES PROCESADOS:`);
      console.log(`   - Stock actual (parseado): ${stockActualReal}`);
      console.log(`   - Tipo de movimiento: "${tipoMovimiento}"`);
      console.log(`   - Cantidad del movimiento: ${cantidadMovimiento}`);
      
      // Calcular el stock nuevo deseado
      const stockNuevo = tipoMovimiento === 'ingreso' 
        ? stockActualReal + cantidadMovimiento 
        : stockActualReal - cantidadMovimiento;
      
      const diferencia = stockNuevo - stockActualReal;
      
      console.log(`📊 [DEBUG] STOCK NUEVO INGRESADO: ${stockNuevo}`);
      console.log(`📊 [DEBUG] DIFERENCIA CALCULADA: ${diferencia}`);
      console.log(`⚡ [DEBUG] OPERACIÓN: ${stockActualReal} ${tipoMovimiento === 'ingreso' ? '+' : '-'} ${cantidadMovimiento} = ${stockNuevo}`);
      
      // 1. Actualizar directamente el stock_actual en la tabla ingredientes
      const updateStockQuery = `
        UPDATE ingredientes 
        SET stock_actual = $1 
        WHERE id = $2
      `;
      
      console.log(`🔄 [DEBUG] Ejecutando actualización de stock en tabla ingredientes...`);
      console.log(`   - Query: UPDATE ingredientes SET stock_actual = ${stockNuevo} WHERE id = ${ingrediente_id}`);
      
      const updateResult = await client.query(updateStockQuery, [stockNuevo, ingrediente_id]);
      console.log(`✅ [DEBUG] Actualización ejecutada - Filas afectadas: ${updateResult.rowCount}`);
      
      if (updateResult.rowCount === 0) {
        console.error(`❌ [DEBUG] ERROR: No se actualizó ninguna fila. El ingrediente ID ${ingrediente_id} podría no existir.`);
      } else {
        console.log(`✅ [DEBUG] Stock actualizado correctamente: ${stockActualReal} → ${stockNuevo}`);
      }
      
      // 2. Extraer usuario_id de las observaciones si está disponible
      let usuario_id = null;
      const usuarioMatch = observaciones.match(/Usuario:\s*(\d+)/);
      if (usuarioMatch) {
        usuario_id = parseInt(usuarioMatch[1]);
        console.log(`👤 [DEBUG] Usuario extraído de observaciones: ${usuario_id}`);
      } else {
        console.log(`⚠️ [DEBUG] No se pudo extraer usuario_id de las observaciones: "${observaciones}"`);
      }
      
      // 3. Registrar el ajuste en la nueva tabla ingredientes_ajustes
      const insertAjusteQuery = `
        INSERT INTO ingredientes_ajustes 
        (ingrediente_id, usuario_id, tipo_ajuste, stock_anterior, stock_nuevo, diferencia, observacion, fecha)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `;
      
      console.log(`🔄 [DEBUG] Registrando ajuste en tabla ingredientes_ajustes...`);
      console.log(`   - ingrediente_id: ${ingrediente_id}`);
      console.log(`   - usuario_id: ${usuario_id || 'NULL'}`);
      console.log(`   - tipo_ajuste: 'ajuste_puntual'`);
      console.log(`   - stock_anterior: ${stockActualReal}`);
      console.log(`   - stock_nuevo: ${stockNuevo}`);
      console.log(`   - diferencia: ${diferencia}`);
      console.log(`   - observacion: "${observaciones}"`);
      
      const insertResult = await client.query(insertAjusteQuery, [
        ingrediente_id,
        usuario_id,
        'ajuste_puntual',
        stockActualReal,
        stockNuevo,
        diferencia,
        observaciones
      ]);
      
      console.log(`✅ [DEBUG] Ajuste registrado exitosamente en ingredientes_ajustes`);
      console.log(`   - Filas insertadas: ${insertResult.rowCount}`);
      
      // 4. Verificación post-ajuste
      console.log(`🔍 [DEBUG] Verificando stock final en base de datos...`);
      const verificacionQuery = `SELECT stock_actual FROM ingredientes WHERE id = $1`;
      const verificacionResult = await client.query(verificacionQuery, [ingrediente_id]);
      const stockFinal = parseFloat(verificacionResult.rows[0].stock_actual);
      
      console.log(`📊 [DEBUG] RESULTADO DE LA OPERACIÓN:`);
      console.log(`   - Stock esperado: ${stockNuevo}`);
      console.log(`   - Stock final en BD: ${stockFinal}`);
      console.log(`   - Diferencia entre esperado y real: ${Math.abs(stockFinal - stockNuevo)}`);
      
      const operacionExitosa = Math.abs(stockFinal - stockNuevo) < 0.001;
      console.log(`🎯 [DEBUG] ¿OPERACIÓN EXITOSA?: ${operacionExitosa ? 'SÍ ✅' : 'NO ❌'}`);
      
      if (!operacionExitosa) {
        console.error(`❌ [DEBUG] ERROR: El stock final no coincide con el esperado`);
        console.error(`   - Esto indica un problema en la actualización de la base de datos`);
      }
      
      console.log(`===============================================\n`);
      
    } else {
      // 🔄 MOVIMIENTO NORMAL: Usar lógica original para movimientos de producción
      console.log('🔄 [MOVIMIENTO NORMAL] Aplicando lógica estándar para movimientos de producción');
      
      const movimiento = {
        ingrediente_id,
        kilos: Number(kilos),
        tipo: tipo || 'ingreso',
        carro_id,
        observaciones: observaciones || null
      };
      
      // Obtener stock antes para logs
      const stockAntesQuery = `SELECT stock_actual, nombre FROM ingredientes WHERE id = $1`;
      const stockAntesResult = await client.query(stockAntesQuery, [ingrediente_id]);
      const stockAntes = stockAntesResult.rows[0]?.stock_actual || 0;
      const nombreIngrediente = stockAntesResult.rows[0]?.nombre || 'Desconocido';
      
      console.log(`📋 INGREDIENTE: "${nombreIngrediente}" - STOCK ANTES: ${stockAntes}`);
      
      await registrarMovimientoIngrediente(movimiento, client);
    }

    // 🔍 VERIFICACIÓN POST-MOVIMIENTO
    const verificacionQuery = `SELECT stock_actual FROM ingredientes WHERE id = $1`;
    const verificacionResult = await client.query(verificacionQuery, [ingrediente_id]);
    const stockFinal = verificacionResult.rows[0]?.stock_actual || 0;
    
    console.log(`✅ STOCK FINAL DESPUÉS DEL MOVIMIENTO: ${stockFinal}`);
    console.log(`===============================================\n`);

    // Confirmar transacción
    await client.query('COMMIT');
    console.log('✅ Transacción completada exitosamente');

    return res.status(201).json({ 
      message: 'Movimiento registrado correctamente',
      stock_final: stockFinal
    });

  } catch (error) {
    // Revertir transacción en caso de error
    await client.query('ROLLBACK');
    console.error('❌ Error en POST /ingredientes_movimientos:', error);
    console.error('❌ Stack trace:', error.stack);
    return res.status(500).json({ 
      error: 'Error al registrar el movimiento',
      detalle: error.message 
    });
  } finally {
    client.release();
  }
});


// ==========================================
// RUTAS PARA RELACIONES DE ARTÍCULOS
// ==========================================

// Ruta para obtener relaciones de artículos de un carro específico
router.get('/carro/:id/relaciones-articulos', async (req, res) => {
    try {
        const carroId = parseInt(req.params.id);
        const usuarioId = parseInt(req.query.usuarioId);

        if (isNaN(carroId) || isNaN(usuarioId)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }

        console.log(`🔗 Obteniendo relaciones para carro ${carroId}, usuario ${usuarioId}`);
        const relaciones = await obtenerRelacionesCarro(carroId, usuarioId);
        res.json(relaciones);
    } catch (error) {
        console.error('Error al obtener relaciones del carro:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para obtener una relación específica por código de artículo
router.get('/relacion-articulo/:articuloCodigo', async (req, res) => {
    try {
        const articuloCodigo = req.params.articuloCodigo;
        
        if (!articuloCodigo) {
            return res.status(400).json({ error: 'Código de artículo requerido' });
        }

        console.log(`🔍 Buscando relación para artículo ${articuloCodigo}`);
        const relacion = await obtenerRelacionPorArticulo(articuloCodigo);
        
        if (!relacion) {
            return res.status(404).json({ error: 'No se encontró relación para este artículo' });
        }
        
        res.json(relacion);
    } catch (error) {
        console.error('Error al obtener relación por artículo:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para crear una nueva relación artículo-kilo
router.post('/relacion-articulo', async (req, res) => {
    try {
        console.log('\n🔍 DEPURACIÓN POST /relacion-articulo:');
        console.log('===========================================');
        console.log('📥 PAYLOAD COMPLETO RECIBIDO:', JSON.stringify(req.body, null, 2));
        
        const { articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes } = req.body;
        
        console.log('\n📋 CAMPOS EXTRAÍDOS:');
        console.log('- articulo_produccion_codigo:', articulo_produccion_codigo);
        console.log('- articulo_kilo_codigo:', articulo_kilo_codigo);
        console.log('- multiplicador_ingredientes:', multiplicador_ingredientes, typeof multiplicador_ingredientes);
        
        if (!articulo_produccion_codigo || !articulo_kilo_codigo) {
            console.log('❌ ERROR: Faltan códigos requeridos');
            return res.status(400).json({ 
                error: 'Se requieren ambos códigos: articulo_produccion_codigo y articulo_kilo_codigo' 
            });
        }

        // Validar y convertir multiplicador_ingredientes
        const multiplicador = multiplicador_ingredientes ? parseFloat(multiplicador_ingredientes) : 1;
        console.log('🔢 MULTIPLICADOR PROCESADO:', multiplicador);

        console.log(`➕ Creando relación: ${articulo_produccion_codigo} -> ${articulo_kilo_codigo} (multiplicador: ${multiplicador})`);
        const nuevaRelacion = await crearRelacion(articulo_produccion_codigo, articulo_kilo_codigo, multiplicador);
        
        console.log('✅ RELACIÓN CREADA:', JSON.stringify(nuevaRelacion, null, 2));
        
        res.status(201).json({
            message: 'Relación creada correctamente',
            relacion: nuevaRelacion
        });
    } catch (error) {
        console.error('❌ Error al crear relación:', error);
        if (error.message.includes('Ya existe una relación')) {
            res.status(409).json({ error: error.message });
        } else if (error.message.includes('no existe')) {
            res.status(404).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Ruta para actualizar una relación existente
router.put('/relacion-articulo/:id', async (req, res) => {
    try {
        console.log('\n🔍 DEPURACIÓN PUT /relacion-articulo/:id');
        console.log('============================================');
        console.log('📥 PAYLOAD COMPLETO RECIBIDO:', JSON.stringify(req.body, null, 2));
        console.log('📋 ID DE RELACIÓN:', req.params.id);
        
        const relacionId = parseInt(req.params.id);
        const { articulo_kilo_codigo, multiplicador_ingredientes } = req.body;
        
        console.log('\n📋 CAMPOS EXTRAÍDOS:');
        console.log('- relacionId:', relacionId);
        console.log('- articulo_kilo_codigo:', articulo_kilo_codigo);
        console.log('- multiplicador_ingredientes:', multiplicador_ingredientes, typeof multiplicador_ingredientes);
        
        if (isNaN(relacionId)) {
            console.log('❌ ERROR: ID de relación inválido');
            return res.status(400).json({ error: 'ID de relación inválido' });
        }
        
        if (!articulo_kilo_codigo) {
            console.log('❌ ERROR: Falta código del artículo por kilo');
            return res.status(400).json({ error: 'Se requiere el código del artículo por kilo' });
        }

        // Procesar multiplicador_ingredientes
        const multiplicador = multiplicador_ingredientes !== undefined ? parseFloat(multiplicador_ingredientes) : null;
        console.log('🔢 MULTIPLICADOR PROCESADO:', multiplicador);

        console.log(`✏️ Actualizando relación ${relacionId} con artículo: ${articulo_kilo_codigo} y multiplicador: ${multiplicador}`);
        const relacionActualizada = await actualizarRelacion(relacionId, articulo_kilo_codigo, multiplicador);
        
        console.log('✅ RELACIÓN ACTUALIZADA:', JSON.stringify(relacionActualizada, null, 2));
        
        res.json({
            message: 'Relación actualizada correctamente',
            relacion: relacionActualizada
        });
    } catch (error) {
        console.error('❌ Error al actualizar relación:', error);
        if (error.message.includes('no encontrada') || error.message.includes('no existe')) {
            res.status(404).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Ruta para eliminar una relación por ID
router.delete('/relacion-articulo/:id', async (req, res) => {
    try {
        const relacionId = parseInt(req.params.id);
        
        if (isNaN(relacionId)) {
            return res.status(400).json({ error: 'ID de relación inválido' });
        }

        console.log(`🗑️ Eliminando relación ${relacionId}`);
        await eliminarRelacion(relacionId);
        
        res.json({ message: 'Relación eliminada correctamente' });
    } catch (error) {
        console.error('Error al eliminar relación:', error);
        if (error.message.includes('no encontrada')) {
            res.status(404).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Ruta para eliminar una relación por código de artículo de producción
router.delete('/relacion-articulo/por-articulo/:articuloCodigo', async (req, res) => {
    try {
        const articuloCodigo = req.params.articuloCodigo;
        
        if (!articuloCodigo) {
            return res.status(400).json({ error: 'Código de artículo requerido' });
        }

        console.log(`🗑️ Eliminando relación para artículo ${articuloCodigo}`);
        await eliminarRelacionPorArticulo(articuloCodigo);
        
        res.json({ message: 'Relación eliminada correctamente' });
    } catch (error) {
        console.error('Error al eliminar relación por artículo:', error);
        if (error.message.includes('No se encontró relación')) {
            res.status(404).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// ==========================================
// RUTAS PARA PEDIDOS POR CLIENTE
// ==========================================

/**
 * Ruta para obtener pedidos consolidados por cliente
 */
router.get('/pedidos-por-cliente', async (req, res) => {
    try {
        console.log('🔍 [PROD_PED] Ruta GET /pedidos-por-cliente');
        await obtenerPedidosPorCliente(req, res);
    } catch (error) {
        console.error('❌ [PROD_PED] Error en ruta /pedidos-por-cliente:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de pedidos por cliente',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Ruta para obtener artículos consolidados (vista por artículo)
 */
router.get('/pedidos-articulos', async (req, res) => {
    try {
        console.log('🔍 [PROD_ART] Ruta GET /pedidos-articulos');
        await obtenerPedidosArticulos(req, res);
    } catch (error) {
        console.error('❌ [PROD_ART] Error en ruta /pedidos-articulos:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de artículos consolidados',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Ruta para asignar faltantes a carro de producción
 */
router.post('/asignar-faltantes', async (req, res) => {
    try {
        console.log('🔍 [PROD_PED] Ruta POST /asignar-faltantes');
        await asignarFaltantes(req, res);
    } catch (error) {
        console.error('❌ [PROD_PED] Error en ruta /asignar-faltantes:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de asignación de faltantes',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Ruta para impresión de presupuestos por cliente
 */
router.get('/impresion-presupuesto', async (req, res) => {
    try {
        console.log('🔍 [PROD_PED] Ruta GET /impresion-presupuesto');
        await imprimirPresupuestoCliente(req, res);
    } catch (error) {
        console.error('❌ [PROD_PED] Error en ruta /impresion-presupuesto:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de impresión',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Ruta para buscar artículos con búsqueda exacta o parcial
 * GET /api/produccion/buscar-articulos?q=texto&exact=true
 */
router.get('/buscar-articulos', async (req, res) => {
    try {
        console.log('🔍 [BUSCAR-ART] Ruta GET /buscar-articulos');
        await buscarArticulos(req, res);
    } catch (error) {
        console.error('❌ [BUSCAR-ART] Error en ruta /buscar-articulos:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de búsqueda de artículos',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Ruta para actualizar mapeo de pack
 */
router.patch('/pack-map', async (req, res) => {
    try {
        console.log('🧩 [PACK-MAP] Ruta PATCH /pack-map');
        await actualizarPackMapping(req, res);
    } catch (error) {
        console.error('❌ [PACK-MAP] Error en ruta /pack-map:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de mapeo pack',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Ruta para actualizar secuencia de presupuestos
 * POST /api/produccion/actualizar-secuencia
 * Body: { presupuestos_ids: ['id1', 'id2'], nueva_secuencia: 'Armar_Pedido' }
 */
router.post('/actualizar-secuencia', async (req, res) => {
    try {
        console.log('🔄 [SECUENCIA] Ruta POST /actualizar-secuencia');
        const { actualizarSecuenciaPresupuestos } = require('../controllers/pedidosPorCliente');
        await actualizarSecuenciaPresupuestos(req, res);
    } catch (error) {
        console.error('❌ [SECUENCIA] Error en ruta /actualizar-secuencia:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de actualización de secuencia',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;
