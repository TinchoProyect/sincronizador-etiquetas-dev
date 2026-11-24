const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const axios = require('axios');

//Temporizacion - Mari
const tiemposCtrl = require('../controllers/tiemposCarro');

// ✅ alias (mantener compatibilidad con front viejo)
router.post('/carro/:carroId/articulo/:numero/iniciar', tiemposCtrl.iniciarTemporizadorArticulo);
router.post('/carro/:carroId/articulo/:numero/finalizar', tiemposCtrl.finalizarTemporizadorArticulo);
router.get('/carro/:carroId/tiempo-total', tiemposCtrl.obtenerTiempoTotalCarro);



const { dbMiddleware } = require('../middleware');
// Aplicar middleware de base de datos a todas las rutas
router.use(dbMiddleware);
const {
    construirCatalogoIngredientesComerciales,
    construirCatalogoPreviewB2BLaboratorio,
    sincronizarManifestIngredientesB2B
} = require('../services/desgloseIngredientesComercialService');
const produccionPropiaCostosService = require('../services/produccionPropiaCostosService');

// 🥣 Catálogo comercial dinámico de ingredientes resueltos recursivamente (sin pesos, porcentajes ni costos)
router.get('/catalogo/ingredientes-comerciales', async (req, res) => {
    try {
        const catalogo = await construirCatalogoIngredientesComerciales();
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.json({
            ok: true,
            updated_at: catalogo.updated_at,
            total_articulos: catalogo.total_articulos,
            items: catalogo.items
        });
    } catch (error) {
        console.error('❌ [INGREDIENTES-COMERCIALES] Error al resolver desglose dinámico:', error);
        res.status(500).json({
            ok: false,
            error: 'No se pudo resolver el desglose comercial de ingredientes.'
        });
    }
});

// 🧪 Vista Espejo Local del Catálogo B2B Mayorista en Modo Laboratorio (100% sobre etiquetas_pruebas, sin tocar Supabase)
router.get('/catalogo/b2b-preview-lab', async (req, res) => {
    try {
        const esLab =
            process.env.LAMDA_MODO_LABORATORIO === 'true' ||
            process.env.MODO_LABORATORIO === 'true' ||
            String(process.env.DB_NAME || '').trim().toLowerCase() === 'etiquetas_pruebas';
        if (!esLab) {
            return res.status(403).json({ ok: false, error: 'Disponible únicamente en Modo Laboratorio.' });
        }
        const data = await construirCatalogoPreviewB2BLaboratorio();
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.json(data);
    } catch (error) {
        console.error('❌ [B2B-PREVIEW-LAB] Error construyendo catálogo B2B local:', error);
        res.status(500).json({ ok: false, error: 'No se pudo cargar el catálogo B2B de Laboratorio.' });
    }
});
const {
    crearReceta,
    obtenerEstadoRecetas,
    validarIntegridadRecetas,
    obtenerReceta,
    actualizarReceta,
    obtenerIngredientesExpandidos,
    eliminarReceta,
    // Endpoints de sugerencias de producción
    obtenerSugerencia,
    guardarSugerencia,
    eliminarSugerencia
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
const { obtenerArticulos, obtenerArticulosPuente, buscarArticuloPorCodigo, actualizarProduccionLambda, actualizarProduccionExterna, actualizarKilosUnidad, buscarArticulos } = require('../controllers/articulos');

// Controladores para pedidos por cliente
const { obtenerPedidosPorCliente, obtenerPedidosArticulos, asignarFaltantes, actualizarPackMapping } = require('../controllers/pedidosPorCliente');
const { imprimirPresupuestoCliente } = require('../controllers/impresionPresupuestos');
const { imprimirEtiquetaIngrediente, imprimirEtiquetaArticulo } = require('../controllers/impresionEtiquetasIngredientes');

// Controladores para compras pendientes
const { crearPendienteCompra, obtenerPendientesCompra } = require('../controllers/comprasPendientes');

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
    buildSqlCostoNetoKiloBunker,
    obtenerIngredientes,
    obtenerIngrediente,
    crearIngrediente,
    actualizarIngrediente,
    eliminarIngrediente,
    obtenerNuevoCodigo,
    obtenerUsuariosConStock,
    obtenerStockPorUsuario,
    obtenerSectores,
    obtenerIngredientesPorSectores,
    obtenerNutrientes,
    actualizarVinculo,
    obtenerTrazabilidadIngrediente
} = require('../controllers/ingredientes');

const mixesRouter = require('./mixes'); // ← Incorporación del router de mixes
const carroIngredientesRouter = require('./carroIngredientes'); // ← Incorporación del router de ingredientes de carro
const historialInventariosRouter = require('./historialInventarios'); // ← Incorporación del router de historial de inventarios

router.use('/mixes', mixesRouter);     // ← Montar rutas para mixes
router.use('/carro', carroIngredientesRouter); // ← Montar rutas para ingredientes de carro
router.use('/', historialInventariosRouter); // ← Montar rutas para historial de inventarios

const mantenimientoRouter = require('./mantenimiento'); // ← Router de Mantenimiento
router.use('/mantenimiento', mantenimientoRouter); // ← /api/produccion/mantenimiento

// Rutas para Conciliación de Artículos con Tabla Maestra (IA)
const conciliacionCtrl = require('../controllers/conciliacionController');
router.post('/conciliacion/articulos/match', (req, res) => conciliacionCtrl.buscarCandidatos(req, res));
router.post('/conciliacion/articulos/refinar-paso', (req, res) => conciliacionCtrl.refinarPaso(req, res));
router.post('/conciliacion/articulos/auditar-ia', (req, res) => conciliacionCtrl.auditarConIA(req, res));
router.post('/conciliacion/articulos/guardar-estrategia', (req, res) => conciliacionCtrl.guardarEstrategia(req, res));
router.delete('/conciliacion/articulos/eliminar-estrategia', (req, res) => conciliacionCtrl.eliminarEstrategia(req, res));
router.post('/conciliacion/articulos/confirmar', (req, res) => conciliacionCtrl.confirmarConciliacion(req, res));
router.post('/simulacion/sincronizar-ingrediente', (req, res) => conciliacionCtrl.sincronizarIngredienteDesdeArticulo(req, res));
router.post('/simulacion/propagar-ingrediente-a-fracciones', (req, res) => conciliacionCtrl.propagarIngredienteAFracciones(req, res));

// Rutas para el Salvavidas de Producción
const salvavidasController = require('../controllers/salvavidas');
router.post('/salvavidas/ajuste-fantasma', salvavidasController.registrarAjusteFantasma);

// Ruta para imprimir etiqueta de ingrediente y de artículo
router.post('/ingredientes/imprimir-etiqueta', imprimirEtiquetaIngrediente);
router.post('/articulos/imprimir-etiqueta', imprimirEtiquetaArticulo);

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

// ==========================================
// RUTAS PARA CATEGORÍAS
// ==========================================

// Ruta para obtener categorías
router.get('/categorias', async (req, res) => {
    try {
        const { obtenerCategorias } = require('../controllers/ingredientes');
        const categorias = await obtenerCategorias();
        res.json(categorias);
    } catch (error) {
        console.error('❌ [CATEGORIAS] Error en GET /categorias:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para crear una nueva categoría
router.post('/categorias', async (req, res) => {
    try {
        const { crearCategoria } = require('../controllers/ingredientes');
        const nuevaCategoria = await crearCategoria(req.body);
        res.status(201).json(nuevaCategoria);
    } catch (error) {
        console.error('❌ [CATEGORIAS] Error en POST /categorias:', error);
        const statusCode = error.message.includes('requerido') || error.message.includes('existe') ? 400 : 500;
        res.status(statusCode).json({ error: error.message });
    }
});

// Ruta para actualizar una categoría
router.put('/categorias/:id', async (req, res) => {
    try {
        const { actualizarCategoria } = require('../controllers/ingredientes');
        const categoriaActualizada = await actualizarCategoria(req.params.id, req.body);
        res.json(categoriaActualizada);
    } catch (error) {
        console.error('❌ [CATEGORIAS] Error en PUT /categorias/:id:', error);
        let statusCode = 500;
        if (error.message.includes('requerido') || error.message.includes('existe')) {
            statusCode = 400;
        } else if (error.message.includes('no encontrada')) {
            statusCode = 404;
        }
        res.status(statusCode).json({ error: error.message });
    }
});

// ==========================================
// RUTAS PARA NUTRIENTES (STOCK POTENCIAL)
// ==========================================

/**
 * Obtener artículos nutrientes de un ingrediente
 * GET /api/produccion/ingredientes/:id/nutrientes
 */
router.get('/ingredientes/:id/nutrientes', async (req, res) => {
    try {
        const ingredienteId = parseInt(req.params.id);

        if (isNaN(ingredienteId)) {
            return res.status(400).json({ error: 'ID de ingrediente inválido' });
        }

        console.log(`🔍 [NUTRIENTES] Solicitando nutrientes para ingrediente ${ingredienteId}`);
        const nutrientes = await obtenerNutrientes(ingredienteId);
        res.json(nutrientes);
    } catch (error) {
        console.error('❌ [NUTRIENTES] Error al obtener nutrientes:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Activar/Desactivar vínculo de nutriente
 * PATCH /api/produccion/ingredientes/nutrientes/:id
 */
router.patch('/ingredientes/nutrientes/:id', async (req, res) => {
    try {
        const vinculoId = parseInt(req.params.id);
        const { activo } = req.body;

        if (isNaN(vinculoId)) {
            return res.status(400).json({ error: 'ID de vínculo inválido' });
        }

        if (typeof activo !== 'boolean') {
            return res.status(400).json({
                error: 'El campo activo debe ser booleano'
            });
        }

        console.log(`🔄 [NUTRIENTES] Actualizando vínculo ${vinculoId} a estado: ${activo}`);
        const vinculo = await actualizarVinculo(vinculoId, activo);

        res.json({
            message: `Vínculo ${activo ? 'activado' : 'desactivado'} correctamente`,
            vinculo: vinculo
        });
    } catch (error) {
        console.error('❌ [NUTRIENTES] Error al actualizar vínculo:', error);
        const statusCode = error.message.includes('no encontrado') ? 404 : 500;
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

router.delete('/ingredientes/stock-usuario/:usuarioId/:ingredienteId', async (req, res) => {
    try {
        const usuarioId = parseInt(req.params.usuarioId);
        const ingredienteId = parseInt(req.params.ingredienteId);

        if (isNaN(usuarioId) || isNaN(ingredienteId)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }

        console.log(`🗑️ Procesando solicitud DELETE para desactivar control de ingrediente ${ingredienteId} del usuario ${usuarioId}`);

        // Eliminar todos los registros de ese ingrediente para el usuario
        const deleteQuery = 'DELETE FROM ingredientes_stock_usuarios WHERE usuario_id = $1 AND ingrediente_id = $2';
        await req.db.query(deleteQuery, [usuarioId, ingredienteId]);

        res.json({ message: 'Ingrediente desactivado correctamente del stock visual' });
    } catch (error) {
        console.error(`❌ Error al eliminar el stock del usuario ${req.params.usuarioId} para el ingrediente ${req.params.ingredienteId}:`, error);
        res.status(500).json({
            error: 'Error al eliminar el stock del usuario',
            detalle: error.message
        });
    }
});

// ==========================================
// GESTIÓN DEDICADA Y KARDEX DE STOCK DOMICILIARIO POR COLABORADOR
// ==========================================
const compraExternaRequestIds = new Map();

router.get('/ingredientes/stock-usuario/:usuarioId/:ingredienteId/kardex', async (req, res) => {
    try {
        const usuarioId = parseInt(req.params.usuarioId, 10);
        const ingredienteId = parseInt(req.params.ingredienteId, 10);
        if (isNaN(usuarioId) || isNaN(ingredienteId)) {
            return res.status(400).json({ error: 'IDs de usuario o ingrediente inválidos' });
        }

        const [{ rows: [usr] }, { rows: [ing] }] = await Promise.all([
            pool.query('SELECT id, nombre_completo, usuario FROM public.usuarios WHERE id = $1 LIMIT 1', [usuarioId]),
            pool.query('SELECT id, codigo, nombre, unidad_medida, stock_actual AS stock_deposito_central FROM public.ingredientes WHERE id = $1 LIMIT 1', [ingredienteId])
        ]);

        if (!usr) return res.status(404).json({ error: 'Colaborador no encontrado' });
        if (!ing) return res.status(404).json({ error: 'Ingrediente no encontrado' });

        const { obtenerCompromisosCarrosExternos } = require('../utils/stockDomiciliarioHelper');
        const compromisosMap = await obtenerCompromisosCarrosExternos(pool, usuarioId);
        const compIng = compromisosMap.get(ingredienteId);

        const { rows: movRows } = await pool.query(
            `SELECT sub.*,
                    cp.fecha_preparado AS carro_fecha_preparado,
                    cp.fecha_confirmacion AS carro_fecha_confirmacion
               FROM (
                   SELECT isu.id,
                          isu.ingrediente_id,
                          isu.usuario_id,
                          ROUND(isu.cantidad::numeric, 4) AS cantidad,
                          isu.origen_carro_id,
                          isu.carro_referencia_id,
                          isu.fecha_registro,
                          isu.contexto_envase,
                          isu.articulo_origen_numero,
                          isu.observaciones,
                          COALESCE(
                              isu.tipo_movimiento,
                              CASE
                                  WHEN isu.cantidad < 0 AND isu.origen_carro_id IS NOT NULL THEN 'consumo_produccion'
                                  WHEN isu.cantidad > 0 AND isu.contexto_envase IS NOT NULL THEN 'abastecimiento_deposito'
                                  ELSE 'ajuste_inventario'
                              END
                          ) AS tipo_movimiento,
                          ROUND(SUM(isu.cantidad) OVER (ORDER BY isu.fecha_registro ASC, isu.id ASC)::numeric, 4) AS saldo_acumulado
                     FROM public.ingredientes_stock_usuarios isu
                    WHERE isu.usuario_id = $1
                      AND isu.ingrediente_id = $2
               ) sub
               LEFT JOIN public.carros_produccion cp
                 ON cp.id = COALESCE(sub.origen_carro_id, sub.carro_referencia_id)
              ORDER BY sub.fecha_registro DESC, sub.id DESC
              LIMIT 150`,
            [usuarioId, ingredienteId]
        );

        const { rows: [saldoRow] } = await pool.query(
            'SELECT COALESCE(ROUND(SUM(cantidad)::numeric, 4), 0) AS stock_en_casa FROM public.ingredientes_stock_usuarios WHERE usuario_id = $1 AND ingrediente_id = $2',
            [usuarioId, ingredienteId]
        );

        const stockEnCasa = Number(parseFloat(saldoRow?.stock_en_casa || 0).toFixed(4));
        const comprometidoAbiertos = Number((compIng?.kilos_comprometidos || 0).toFixed(4));
        const proyectadoPostCoccion = Number((stockEnCasa - comprometidoAbiertos).toFixed(4));

        return res.json({
            success: true,
            usuario: usr,
            ingrediente: {
                id: ing.id,
                codigo: ing.codigo,
                nombre: ing.nombre,
                unidad_medida: ing.unidad_medida || 'Kilo',
                stock_deposito_central: Number(parseFloat(ing.stock_deposito_central || 0).toFixed(4))
            },
            resumen: {
                stock_en_casa: stockEnCasa,
                comprometido_abiertos: comprometidoAbiertos,
                carros_abiertos_count: compIng?.carros_count || 0,
                proyectado_post_coccion: proyectadoPostCoccion
            },
            carros_abiertos: compIng?.carros_detalle || [],
            movimientos: movRows.map(m => ({
                ...m,
                cantidad: Number(parseFloat(m.cantidad || 0).toFixed(4)),
                saldo_acumulado: Number(parseFloat(m.saldo_acumulado || 0).toFixed(4))
            }))
        });
    } catch (error) {
        console.error('❌ Error al obtener Kardex domiciliario:', error);
        return res.status(500).json({ error: 'No se pudo obtener el Kardex domiciliario', detalle: error.message });
    }
});

router.post('/ingredientes/stock-usuario/ajustar-casa', async (req, res) => {
    const client = await pool.connect();
    try {
        const { usuario_id, ingrediente_id, stock_fisico_real, observaciones, carro_referencia_id, permitir_alta_en_cero } = req.body || {};
        const usuarioIdNum = parseInt(usuario_id, 10);
        const ingredienteIdNum = parseInt(ingrediente_id, 10);
        const stockRealNum = parseFloat(String(stock_fisico_real ?? '').replace(',', '.'));

        if (isNaN(usuarioIdNum) || isNaN(ingredienteIdNum) || isNaN(stockRealNum) || stockRealNum < 0) {
            return res.status(400).json({ error: 'Indicá un colaborador, ingrediente y un stock físico real mayor o igual a 0.' });
        }
        if (stockRealNum > 500) {
            return res.status(400).json({ error: `El stock ingresado (${stockRealNum} kg) parece excesivo o un código de barras. Verificá el número.` });
        }

        await client.query('BEGIN');

        const { rows: [ing] } = await client.query(
            'SELECT id, nombre, unidad_medida FROM public.ingredientes WHERE id = $1 LIMIT 1',
            [ingredienteIdNum]
        );
        if (!ing) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Ingrediente no encontrado' });
        }

        const { rows: [prev] } = await client.query(
            `SELECT COALESCE(ROUND(SUM(cantidad)::numeric, 4), 0) AS stock_anterior,
                    COUNT(*)::int AS filas
               FROM public.ingredientes_stock_usuarios
              WHERE usuario_id = $1 AND ingrediente_id = $2`,
            [usuarioIdNum, ingredienteIdNum]
        );
        const stockAnterior = Number(parseFloat(prev?.stock_anterior || 0).toFixed(4));
        const filasPrevias = Number(prev?.filas || 0);
        const diferencia = Number((stockRealNum - stockAnterior).toFixed(4));
        const carroRef = (carro_referencia_id && !isNaN(parseInt(carro_referencia_id, 10))) ? parseInt(carro_referencia_id, 10) : null;

        let movimientoId = null;
        if (Math.abs(diferencia) >= 0.0005 || (filasPrevias === 0 && permitir_alta_en_cero)) {
            const obsTexto = String(observaciones || '').trim() || `Conteo físico en domicilio fijado en ${stockRealNum.toFixed(2)} ${ing.unidad_medida || 'kg'}`;
            const { rows: [ins] } = await client.query(
                `INSERT INTO public.ingredientes_stock_usuarios
                    (usuario_id, ingrediente_id, cantidad, origen_carro_id, carro_referencia_id, fecha_registro, origen_mix_id, tipo_movimiento, observaciones)
                 VALUES ($1, $2, $3, NULL, $4, NOW(), NULL, 'ajuste_inventario', $5)
                 RETURNING id`,
                [usuarioIdNum, ingredienteIdNum, diferencia, carroRef, obsTexto]
            );
            movimientoId = ins.id;
        }

        await client.query('COMMIT');

        const { obtenerCompromisosCarrosExternos } = require('../utils/stockDomiciliarioHelper');
        const compMap = await obtenerCompromisosCarrosExternos(pool, usuarioIdNum);
        const comprometido = Number((compMap.get(ingredienteIdNum)?.kilos_comprometidos || 0).toFixed(4));

        return res.json({
            success: true,
            movimiento_id: movimientoId,
            stock_anterior: stockAnterior,
            stock_nuevo: Number(stockRealNum.toFixed(4)),
            diferencia,
            comprometido_abiertos: comprometido,
            proyectado_post_coccion: Number((stockRealNum - comprometido).toFixed(4))
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en POST /ingredientes/stock-usuario/ajustar-casa:', error);
        return res.status(500).json({ error: 'No se pudo ajustar el stock domiciliario', detalle: error.message });
    } finally {
        client.release();
    }
});

router.post('/ingredientes/stock-usuario/compra-externa', async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            usuario_id,
            ingrediente_id,
            cantidad,
            comercio_origen,
            comprobante_ref,
            observaciones,
            carro_referencia_id,
            request_id
        } = req.body || {};

        const usuarioIdNum = parseInt(usuario_id, 10);
        const ingredienteIdNum = parseInt(ingrediente_id, 10);
        const cantNum = parseFloat(String(cantidad ?? '').replace(',', '.'));

        if (isNaN(usuarioIdNum) || isNaN(ingredienteIdNum) || isNaN(cantNum) || cantNum <= 0) {
            return res.status(400).json({ error: 'Indicá una cantidad comprada mayor a 0.' });
        }
        if (cantNum > 500) {
            return res.status(400).json({ error: `La cantidad ingresada (${cantNum} kg) parece excesiva o un código de barras. Verificá el número.` });
        }

        const nowTs = Date.now();
        for (const [k, ts] of compraExternaRequestIds.entries()) {
            if (nowTs - ts > 120000) compraExternaRequestIds.delete(k);
        }
        const reqKey = request_id ? String(request_id).trim() : '';
        if (reqKey && compraExternaRequestIds.has(reqKey)) {
            return res.status(409).json({ error: 'Esta compra externa ya fue asentada recientemente (doble envío bloqueado).' });
        }

        await client.query('BEGIN');

        const { rows: [ing] } = await client.query(
            'SELECT id, nombre, unidad_medida FROM public.ingredientes WHERE id = $1 LIMIT 1',
            [ingredienteIdNum]
        );
        if (!ing) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Ingrediente no encontrado' });
        }

        const { rows: [prev] } = await client.query(
            'SELECT COALESCE(ROUND(SUM(cantidad)::numeric, 4), 0) AS saldo_anterior FROM public.ingredientes_stock_usuarios WHERE usuario_id = $1 AND ingrediente_id = $2',
            [usuarioIdNum, ingredienteIdNum]
        );
        const saldoAnterior = Number(parseFloat(prev?.saldo_anterior || 0).toFixed(4));
        const kilosSumados = Number(cantNum.toFixed(4));
        const carroRef = (carro_referencia_id && !isNaN(parseInt(carro_referencia_id, 10))) ? parseInt(carro_referencia_id, 10) : null;

        const partesObs = ['Compra externa en comercio'];
        if (comercio_origen && String(comercio_origen).trim()) partesObs.push(`Comercio: ${String(comercio_origen).trim()}`);
        if (comprobante_ref && String(comprobante_ref).trim()) partesObs.push(`Comp.: ${String(comprobante_ref).trim()}`);
        if (observaciones && String(observaciones).trim()) partesObs.push(String(observaciones).trim());
        const obsFinal = partesObs.join(' · ');

        const { rows: [ins] } = await client.query(
            `INSERT INTO public.ingredientes_stock_usuarios
                (usuario_id, ingrediente_id, cantidad, origen_carro_id, carro_referencia_id, fecha_registro, origen_mix_id, tipo_movimiento, observaciones)
             VALUES ($1, $2, $3, NULL, $4, NOW(), NULL, 'compra_externa', $5)
             RETURNING id`,
            [usuarioIdNum, ingredienteIdNum, kilosSumados, carroRef, obsFinal]
        );

        const saldoNuevo = Number((saldoAnterior + kilosSumados).toFixed(4));
        await client.query('COMMIT');

        if (reqKey) compraExternaRequestIds.set(reqKey, Date.now());

        const { obtenerCompromisosCarrosExternos } = require('../utils/stockDomiciliarioHelper');
        const compMap = await obtenerCompromisosCarrosExternos(pool, usuarioIdNum);
        const comprometido = Number((compMap.get(ingredienteIdNum)?.kilos_comprometidos || 0).toFixed(4));

        return res.json({
            success: true,
            movimiento_id: ins.id,
            ingrediente_nombre: ing.nombre,
            unidad_medida: ing.unidad_medida || 'Kilo',
            saldo_anterior: saldoAnterior,
            kilos_sumados: kilosSumados,
            saldo_nuevo: saldoNuevo,
            comprometido_abiertos: comprometido,
            proyectado_post_coccion: Number((saldoNuevo - comprometido).toFixed(4))
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en POST /ingredientes/stock-usuario/compra-externa:', error);
        return res.status(500).json({ error: 'No se pudo registrar la compra externa', detalle: error.message });
    } finally {
        client.release();
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
            let result = await req.db.query(query, [nombre]);

            if (result.rows.length === 0) {
                const nombreLimpio = nombre.replace(/\s*\((mix|simple)\)\s*$/i, '').trim();
                const fallbackQuery = `
                    SELECT id 
                    FROM ingredientes 
                    WHERE LOWER(nombre) = LOWER($1)
                       OR LOWER(nombre) LIKE LOWER($1) || '%'
                       OR LOWER(nombre) LIKE '%' || LOWER($1) || '%'
                       OR LOWER(nombre) = LOWER($2)
                       OR LOWER(nombre) LIKE LOWER($2) || '%'
                       OR LOWER(nombre) LIKE '%' || LOWER($2) || '%'
                    ORDER BY 
                       CASE 
                           WHEN LOWER(nombre) = LOWER($1) THEN 1
                           WHEN LOWER(nombre) = LOWER($2) THEN 2
                           WHEN LOWER(nombre) LIKE '%(mix)%' THEN 3
                           ELSE 4
                       END, id ASC
                    LIMIT 1
                `;
                result = await req.db.query(fallbackQuery, [nombre, nombreLimpio]);
            }

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

// ==========================================
// ESPACIO MAMUS — AUTOGESTIÓN DE RETIRO DE INGREDIENTES (ANTES DE /ingredientes/:id)
// ==========================================

router.get('/ingredientes/retiros-mamus', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                im.id,
                im.ingrediente_id,
                i.nombre AS ingrediente_nombre,
                i.codigo AS ingrediente_codigo,
                ABS(im.kilos) AS kilos_retirados,
                ROUND(ABS(im.kilos) * 1000) AS gramos_retirados,
                im.stock_anterior,
                i.stock_actual AS stock_actual_vigente,
                im.observaciones,
                im.fecha
            FROM ingredientes_movimientos im
            JOIN ingredientes i ON i.id = im.ingrediente_id
            WHERE im.observaciones ILIKE 'RETIRO MAMUS:%'
            ORDER BY im.fecha DESC
            LIMIT 25
        `);
        res.json({ success: true, retiros: result.rows });
    } catch (error) {
        console.error('❌ [MAMUS] Error al obtener retiros:', error);
        res.status(500).json({ error: 'No se pudieron obtener los retiros recientes' });
    }
});

router.post('/ingredientes/retiro-mamus', async (req, res) => {
    const client = await pool.connect();
    try {
        const { ingrediente_id, cantidad, unidad, usuario_id } = req.body || {};
        const ingId = parseInt(ingrediente_id, 10);
        const cantNum = parseFloat(String(cantidad).replace(',', '.'));

        if (!ingId || isNaN(cantNum) || cantNum <= 0) {
            return res.status(400).json({ error: 'Indicá un ingrediente y una cantidad mayor a cero.' });
        }

        const unidadNorm = String(unidad || 'g').toLowerCase().trim();
        const esGramos = unidadNorm === 'g' || unidadNorm === 'gr' || unidadNorm === 'gramos';
        const kilosRetirados = esGramos ? Number((cantNum / 1000).toFixed(4)) : Number(cantNum.toFixed(4));

        if (kilosRetirados > 30) {
            return res.status(400).json({
                error: `La cantidad ingresada (${kilosRetirados} kg) parece demasiado alta o un código de barras. Por favor revisá el número.`
            });
        }

        await client.query('BEGIN');

        const resActual = await client.query(
            'SELECT id, nombre, codigo, stock_actual, unidad_medida FROM ingredientes WHERE id = $1 FOR UPDATE',
            [ingId]
        );

        if (resActual.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Ingrediente no encontrado.' });
        }

        const ing = resActual.rows[0];
        const stockAnterior = parseFloat(ing.stock_actual) || 0;
        const diferencia = -Math.abs(kilosRetirados);
        const stockNuevoEsperado = Number((stockAnterior + diferencia).toFixed(4));

        const etiquetaCantidad = esGramos || kilosRetirados < 1
            ? `${Math.round(kilosRetirados * 1000)} g (${kilosRetirados.toFixed(3)} kg)`
            : `${Number(kilosRetirados.toFixed(3))} kg (${Math.round(kilosRetirados * 1000)} g)`;

        const observacion = `RETIRO MAMUS: ${etiquetaCantidad} de ${ing.nombre}`;

        await client.query(
            `INSERT INTO ingredientes_ajustes 
             (fecha, ingrediente_id, usuario_id, stock_anterior, stock_nuevo, tipo_ajuste, observacion)
             VALUES (NOW(), $1, $2, $3, $4, 'ajuste_puntual', $5)`,
            [ingId, usuario_id || null, stockAnterior, stockNuevoEsperado, observacion]
        );

        const movRes = await client.query(
            `INSERT INTO ingredientes_movimientos 
             (fecha, ingrediente_id, kilos, tipo, observaciones, stock_anterior)
             VALUES (NOW(), $1, $2, 'egreso', $3, $4)
             RETURNING id, fecha`,
            [ingId, diferencia, observacion, stockAnterior]
        );

        const resFinal = await client.query('SELECT stock_actual FROM ingredientes WHERE id = $1', [ingId]);
        const stockFinal = parseFloat(resFinal.rows[0]?.stock_actual ?? stockNuevoEsperado);

        await client.query('COMMIT');

        res.json({
            success: true,
            movimiento_id: movRes.rows[0].id,
            fecha: movRes.rows[0].fecha,
            ingrediente_id: ingId,
            ingrediente_nombre: ing.nombre,
            ingrediente_codigo: ing.codigo,
            kilos_retirados: kilosRetirados,
            gramos_retirados: Math.round(kilosRetirados * 1000),
            etiqueta_cantidad: etiquetaCantidad,
            stock_anterior: stockAnterior,
            stock_nuevo: stockFinal,
            observacion
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [MAMUS] Error al registrar retiro:', error);
        res.status(500).json({ error: error.message || 'No se pudo registrar el retiro.' });
    } finally {
        client.release();
    }
});

router.delete('/ingredientes/retiro-mamus/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const movId = parseInt(req.params.id, 10);
        if (isNaN(movId)) {
            return res.status(400).json({ error: 'ID de movimiento inválido.' });
        }

        await client.query('BEGIN');

        const checkRes = await client.query(
            `SELECT im.id, im.ingrediente_id, im.kilos, im.observaciones, i.nombre AS ingrediente_nombre
             FROM ingredientes_movimientos im
             JOIN ingredientes i ON i.id = im.ingrediente_id
             WHERE im.id = $1 AND im.observaciones ILIKE 'RETIRO MAMUS:%'
             FOR UPDATE`,
            [movId]
        );

        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'No se encontró el retiro para anular.' });
        }

        const mov = checkRes.rows[0];
        await client.query('DELETE FROM ingredientes_movimientos WHERE id = $1', [movId]);
        await client.query(
            `DELETE FROM ingredientes_ajustes
             WHERE id = (
                 SELECT id FROM ingredientes_ajustes
                 WHERE ingrediente_id = $1 AND observacion = $2
                 ORDER BY fecha DESC LIMIT 1
             )`,
            [mov.ingrediente_id, mov.observaciones]
        );

        const resFinal = await client.query('SELECT stock_actual FROM ingredientes WHERE id = $1', [mov.ingrediente_id]);
        const stockRestaurado = parseFloat(resFinal.rows[0]?.stock_actual || 0);

        await client.query('COMMIT');

        res.json({
            success: true,
            mensaje: `Se anuló el retiro de ${mov.ingrediente_nombre} y se devolvió el stock.`,
            stock_restaurado: stockRestaurado
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [MAMUS] Error al anular retiro:', error);
        res.status(500).json({ error: 'No se pudo anular el retiro.' });
    } finally {
        client.release();
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
                i.unidad_medida,
                COALESCE(i.costo_patron, 0.00) as costo_patron
            FROM ingrediente_composicion ic
            JOIN ingredientes i ON i.id = ic.ingrediente_id
            WHERE ic.mix_id = $1
            ORDER BY i.nombre
        `;
        const composicionResult = await req.db.query(composicionQuery, [mixId]);

        // ✅ CÁLCULO EN VIVO: Rendimiento económico de la fórmula activa (Comentarios en español según políticas)
        let costoTotalConsolidado = 0;
        const recetaBaseKg = parseFloat(mixResult.rows[0].receta_base_kg || 1.00) || 1.00;
        
        composicionResult.rows.forEach(comp => {
            const cantidadComp = parseFloat(comp.cantidad || 0);
            const costoComp = parseFloat(comp.costo_patron || 0);
            costoTotalConsolidado += cantidadComp * costoComp;
        });

        const costoFormulaUnitario = costoTotalConsolidado / recetaBaseKg;

        res.json({
            mix: mixResult.rows[0],
            composicion: composicionResult.rows,
            costoFormulaUnitario: costoFormulaUnitario
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

router.get('/ingredientes/:id/trazabilidad', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        await obtenerTrazabilidadIngrediente(req, res);
    } catch (error) {
        console.error('Error en ruta GET /ingredientes/:id/trazabilidad:', error);
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

// ✅ BUSCADOR DE ARTÍCULOS BÚNKER (Métrica neta de adquisición por kg, sin márgenes ni IVA)
router.get('/bunker-articulos/buscar', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim() === '') {
            return res.json([]);
        }

        const normalizarTokenBusqueda = (txt) => String(txt || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();

        const terminos = q.split(/\s+/).map(normalizarTokenBusqueda).filter(Boolean);
        const whereConds = [];
        const params = [];
        const exprNormalizada = `translate(LOWER(COALESCE(ba.descripcion, '') || ' ' || COALESCE(ba.descripcion_generada, '') || ' ' || COALESCE(ba.articulo_id, '')), 'áéíóúüñ', 'aeiouun')`;

        terminos.forEach((term) => {
            if (term === 'ap') {
                params.push('%ap%', '%articulo puente%');
                const p1 = params.length - 1;
                const p2 = params.length;
                whereConds.push(`(${exprNormalizada} LIKE $${p1} OR ${exprNormalizada} LIKE $${p2})`);
                return;
            }
            const stem = term.length >= 5 ? term.replace(/(as|os|[ao])$/, '') : term;
            const patron = stem.length >= 4 ? stem : term;
            params.push(`%${patron}%`);
            whereConds.push(`${exprNormalizada} LIKE $${params.length}`);
        });

        const filterSQL = whereConds.length > 0 ? whereConds.join(' AND ') : '1=1';
        const costoNetoKiloSQL = buildSqlCostoNetoKiloBunker('ba', 'pa');

        const query = `
            SELECT 
                ba.articulo_id AS codigo,
                ba.descripcion,
                COALESCE(ba.descripcion_generada, ba.descripcion) AS descripcion_generada,
                ${costoNetoKiloSQL} AS costo_base
            FROM public.bunker_articulos ba
            LEFT JOIN public.precios_articulos pa ON ba.articulo_id = pa.articulo
            WHERE ${filterSQL}
            ORDER BY COALESCE(ba.descripcion_generada, ba.descripcion) ASC
            LIMIT 50
        `;

        const result = await req.db.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Error en GET /bunker-articulos/buscar:', error);
        res.status(500).json({ error: 'Error al buscar artículos del Búnker' });
    }
});

// ✅ VINCULAR ARTÍCULO BÚNKER A UN INGREDIENTE (Soporte multi-vinculación)
router.post('/ingredientes/:id/bunker-articulos', async (req, res) => {
    try {
        const ingredienteId = parseInt(req.params.id);
        const { bunker_articulo_id } = req.body;

        if (isNaN(ingredienteId) || !bunker_articulo_id) {
            return res.status(400).json({ error: 'Datos de vinculación inválidos' });
        }

        const query = `
            INSERT INTO public.ingrediente_bunker_articulos (ingrediente_id, bunker_articulo_id)
            VALUES ($1, $2)
            ON CONFLICT (ingrediente_id, bunker_articulo_id) DO NOTHING
        `;
        await req.db.query(query, [ingredienteId, bunker_articulo_id]);

        // Mantener espejo determinista en ingredientes.articulo_vinculado_numero si aún estaba vacío
        await req.db.query(`
            UPDATE public.ingredientes
            SET articulo_vinculado_numero = $2
            WHERE id = $1
              AND NULLIF(BTRIM(COALESCE(articulo_vinculado_numero, '')), '') IS NULL
        `, [ingredienteId, bunker_articulo_id]);

        res.json({ success: true, message: 'Artículo vinculado correctamente' });
    } catch (error) {
        console.error('❌ Error en POST /ingredientes/:id/bunker-articulos:', error);
        res.status(500).json({ error: 'Error al vincular el artículo del Búnker' });
    }
});

// ✅ DESVINCULAR ARTÍCULO BÚNKER DE UN INGREDIENTE (Individualizado)
router.delete('/ingredientes/:id/bunker-articulos/:articulo_id', async (req, res) => {
    try {
        const ingredienteId = parseInt(req.params.id);
        const { articulo_id } = req.params;

        if (isNaN(ingredienteId) || !articulo_id) {
            return res.status(400).json({ error: 'Datos de desvinculación inválidos' });
        }

        const query = `
            DELETE FROM public.ingrediente_bunker_articulos
            WHERE ingrediente_id = $1 AND bunker_articulo_id = $2
        `;
        const result = await req.db.query(query, [ingredienteId, articulo_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Vínculo no encontrado' });
        }

        await req.db.query(`
            UPDATE public.ingredientes
            SET articulo_vinculado_numero = (
                SELECT bunker_articulo_id
                FROM public.ingrediente_bunker_articulos
                WHERE ingrediente_id = $1
                LIMIT 1
            )
            WHERE id = $1 AND articulo_vinculado_numero = $2
        `, [ingredienteId, articulo_id]);

        res.json({ success: true, message: 'Artículo desvinculado correctamente' });
    } catch (error) {
        console.error('❌ Error en DELETE /ingredientes/:id/bunker-articulos/:articulo_id:', error);
        res.status(500).json({ error: 'Error al desvincular el artículo del Búnker' });
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
        const vistaHdr = String(req.headers['x-lamda-vista'] || req.body?.vista_origen || '').toLowerCase();
        if (vistaHdr.startsWith('usuario') || req.body?.es_stock_usuario === true) {
            return res.status(409).json({
                error: 'Operación bloqueada: no está permitido modificar datos ni stock del Depósito Central desde la solapa de un colaborador.'
            });
        }
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

// Ruta simple para obtener operarios/usuarios activos (Traceability Modals)
router.get('/operarios', async (req, res) => {
    try {
        const query = `
            SELECT id, nombre_completo as nombre
            FROM public.usuarios
            WHERE activo = true
            ORDER BY nombre_completo ASC
        `;
        const result = await req.db.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Error en ruta GET /operarios:', error);
        res.status(500).json({ error: error.message });
    }
});


// Rutas para artículos
router.get('/articulos', async (req, res) => {
    try {
        const { tipo_carro, codigo_barras } = req.query;

        // Validación del parámetro tipo_carro
        if (tipo_carro && !['interna', 'externa'].includes(tipo_carro)) {
            return res.status(400).json({ error: 'El tipo de carro debe ser "interna" o "externa"' });
        }

        console.log('Recibida solicitud GET /articulos con filtros:', { tipo_carro: tipo_carro || 'sin filtro', codigo_barras: codigo_barras || 'sin filtro' });
        const articulos = await obtenerArticulos(tipo_carro, codigo_barras);
        console.log(`Enviando respuesta con ${articulos.length} artículos`);

        // Formato de respuesta consistente con otros endpoints
        res.json({
            success: true,
            data: articulos,
            total: articulos.length
        });
    } catch (error) {
        console.error('Error en ruta GET /articulos:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Ruta determinista para Artículos Puente (Familia Producción + Artículo Principal "Articulo Puente")
router.get('/articulos-puente', async (req, res) => {
    try {
        console.log('Recibida solicitud GET /articulos-puente (determinista)');
        const articulos = await obtenerArticulosPuente();
        res.json({
            success: true,
            data: articulos,
            total: articulos.length
        });
    } catch (error) {
        console.error('Error en ruta GET /articulos-puente:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/articulos/puente', async (req, res) => {
    try {
        const articulos = await obtenerArticulosPuente();
        res.json({
            success: true,
            data: articulos,
            total: articulos.length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
    const articulo_numero = req.params.numero_articulo || req.query.codigo || req.body.articulo_numero;

    console.log('🔍 validarReceta - esProduccionExternaConArticuloPrincipal:', esProduccionExternaConArticuloPrincipal);
    console.log('🔍 validarReceta - ingredientes:', ingredientes);

    if (!articulo_numero || typeof articulo_numero !== 'string' || !articulo_numero.trim()) {
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

// Ruta para obtener ingredientes expandidos de una receta (Mantenida por retrocompatibilidad)
router.get('/recetas/:numero_articulo/ingredientes-expandido', obtenerIngredientesExpandidos);

// Ruta robusta para obtener ingredientes expandidos a través de query params (previene errores de slash %2F)
router.get('/receta-expandida', obtenerIngredientesExpandidos);

// Ruta para calcular la receta externa sugerida de una mezcla a partir de su relación con el producto final
router.get('/recetas/hibridas/calcular-desde-relacion/:mezclaCodigo', async (req, res) => {
    try {
        const mezclaCodigo = req.params.mezclaCodigo;

        // 1. Buscar la relación en la tabla articulos_produccion_externa_relacion
        const relacionRes = await pool.query(`
            SELECT 
                articulo_produccion_codigo, 
                COALESCE(multiplicador_ingredientes, 1.0000) as factor_conversion
            FROM public.articulos_produccion_externa_relacion
            WHERE articulo_kilo_codigo = $1
            LIMIT 1
        `, [mezclaCodigo]);

        if (relacionRes.rows.length === 0) {
            return res.json({ 
                enlazado: false,
                error: 'No se encontró una relación de producción externa activa para el SKU de mezcla provisto.' 
            });
        }

        const { articulo_produccion_codigo, factor_conversion } = relacionRes.rows[0];

        // 2. Buscar ingredientes de fase externa en la receta del producto padre/final, cruzando con ingredientes para costos patrones
        const ingredientesRes = await pool.query(`
            SELECT 
                ri.ingrediente_id,
                ri.nombre_ingrediente,
                ri.unidad_medida,
                (ri.cantidad * $2)::numeric(15,4) as cantidad,
                COALESCE(i.costo_patron, 0.00) as costo_patron
            FROM public.recetas r
            JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
            LEFT JOIN public.ingredientes i ON ri.ingrediente_id = i.id
            WHERE r.articulo_numero = $1 AND ri.fase_produccion = 'externa'
            ORDER BY ri.id
        `, [articulo_produccion_codigo, factor_conversion]);

        res.json({
            enlazado: true,
            articulo_produccion_codigo,
            factor_conversion,
            ingredientes: ingredientesRes.rows
        });
    } catch (error) {
        console.error('Error al calcular receta desde relación:', error);
        res.status(500).json({ error: 'Error interno al calcular receta desde relación' });
    }
});

// Ruta unificada para resolver la receta externa nativa (fase externa) de una UP a partir del artículo base (fase interna)
// Funciona como SSOT para Presupuestos y Simulador Tostadero
router.get('/recetas/hibridas/nativa/:articuloBase', async (req, res) => {
    try {
        const articuloBase = req.params.articuloBase;
        console.log(`[KIT-DEBUG] Endpoint nativa invocado con articuloBase: "${articuloBase}"`);

        // 1. Buscar la UP que contiene este artículo base en su receta interna
        const queryUP = `
            SELECT 
                r.id as receta_id, 
                r.articulo_numero as up_codigo, 
                COALESCE(ra.cantidad, 1.0) as multiplicador_base
            FROM recetas r
            JOIN receta_articulos ra ON r.id = ra.receta_id
            LEFT JOIN stock_real_consolidado src ON src.articulo_numero = ra.articulo_numero OR src.codigo_barras = ra.articulo_numero
            LEFT JOIN bunker_articulos ba ON ba.articulo_id = ra.articulo_numero
            WHERE ra.articulo_numero = $1 OR src.codigo_barras = $1 OR src.articulo_numero = $1 OR src.descripcion ILIKE $1 OR ba.descripcion ILIKE $1 OR ba.descripcion_generada ILIKE $1
            LIMIT 1
        `;
        const upRes = await pool.query(queryUP, [articuloBase]);

        let recetaId, upCodigo, multiplicadorBase;

        if (upRes.rows.length > 0) {
            recetaId = upRes.rows[0].receta_id;
            upCodigo = upRes.rows[0].up_codigo;
            multiplicadorBase = parseFloat(upRes.rows[0].multiplicador_base) || 1.0;
        } else {
            // Fallback Legacy
            const relacionRes = await pool.query(`
                SELECT 
                    rel.articulo_produccion_codigo as up_codigo, 
                    COALESCE(rel.multiplicador_ingredientes, 1.0) as multiplicador_base
                FROM articulos_produccion_externa_relacion rel
                LEFT JOIN stock_real_consolidado src ON src.articulo_numero = rel.articulo_kilo_codigo OR src.codigo_barras = rel.articulo_kilo_codigo
                LEFT JOIN bunker_articulos ba ON ba.articulo_id = rel.articulo_kilo_codigo
                WHERE rel.articulo_kilo_codigo = $1 OR src.codigo_barras = $1 OR src.articulo_numero = $1 OR src.descripcion ILIKE $1 OR ba.descripcion ILIKE $1 OR ba.descripcion_generada ILIKE $1
                LIMIT 1
            `, [articuloBase]);

            if (relacionRes.rows.length === 0) {
                return res.json({ enlazado: false, error: 'No se encontró UP vinculada.' });
            }
            upCodigo = relacionRes.rows[0].up_codigo;
            multiplicadorBase = parseFloat(relacionRes.rows[0].multiplicador_base) || 1.0;
            
            const recRes = await pool.query(`SELECT id FROM recetas WHERE articulo_numero = $1 LIMIT 1`, [upCodigo]);
            if (recRes.rows.length > 0) recetaId = recRes.rows[0].id;
        }

        if (!recetaId) {
            return res.json({ enlazado: false, error: 'La UP vinculada no tiene receta configurada.' });
        }

        // 2. Extraer ingredientes externos de la UP (Miel, Coco)
        // Y aplicar cálculo de Precio: Costo Patron * (1 + (IVA / 100))
        const ingredientesRes = await pool.query(`
            SELECT 
                ri.ingrediente_id as articulo_id, /* Retornamos como articulo_id para consistencia en la UI de presupuestos */
                COALESCE(i.nombre, ri.nombre_ingrediente) as descripcion,
                ri.unidad_medida,
                (ri.cantidad / $2)::numeric(15,4) as cantidad_por_kilo_base,
                COALESCE(i.costo_patron, 0.00) as costo_base,
                21.00 as iva_porcentaje,
                (COALESCE(i.costo_patron, 0.00) * 1.21)::numeric(15,2) as precio_presupuesto
            FROM receta_ingredientes ri
            LEFT JOIN ingredientes i ON ri.ingrediente_id = i.id
            WHERE ri.receta_id = $1 AND ri.fase_produccion = 'externa'
        `, [recetaId, multiplicadorBase]);

        res.json({
            enlazado: true,
            up_codigo: upCodigo,
            factor_conversion: multiplicadorBase,
            ingredientes: ingredientesRes.rows
        });

    } catch (error) {
        console.error('Error al resolver receta nativa:', error);
        res.status(500).json({ error: 'Error interno al calcular receta nativa', details: error.message, stack: error.stack });
    }
});

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

// ==========================================
// RUTAS PARA SUGERENCIAS DE PRODUCCIÓN
// ==========================================

/**
 * Obtener sugerencia de producción para un artículo
 * GET /api/produccion/recetas/:numero_articulo/sugerencia
 */
router.get('/recetas/:numero_articulo/sugerencia', async (req, res) => {
    try {
        console.log('[SUGERENCIAS] Ruta GET /recetas/:numero_articulo/sugerencia');
        await obtenerSugerencia(req, res);
    } catch (error) {
        console.error('[SUGERENCIAS] Error en ruta GET sugerencia:', error);
        res.status(500).json({
            error: 'Error al obtener sugerencia',
            detalle: error.message
        });
    }
});

/**
 * Guardar o actualizar sugerencia de producción
 * PUT /api/produccion/recetas/:numero_articulo/sugerencia
 */
router.put('/recetas/:numero_articulo/sugerencia', async (req, res) => {
    try {
        console.log('[SUGERENCIAS] Ruta PUT /recetas/:numero_articulo/sugerencia');
        await guardarSugerencia(req, res);
    } catch (error) {
        console.error('[SUGERENCIAS] Error en ruta PUT sugerencia:', error);
        res.status(500).json({
            error: 'Error al guardar sugerencia',
            detalle: error.message
        });
    }
});

/**
 * Eliminar sugerencia de producción
 * DELETE /api/produccion/recetas/:numero_articulo/sugerencia
 */
router.delete('/recetas/:numero_articulo/sugerencia', async (req, res) => {
    try {
        console.log('[SUGERENCIAS] Ruta DELETE /recetas/:numero_articulo/sugerencia');
        await eliminarSugerencia(req, res);
    } catch (error) {
        console.error('[SUGERENCIAS] Error en ruta DELETE sugerencia:', error);
        res.status(500).json({
            error: 'Error al eliminar sugerencia',
            detalle: error.message
        });
    }
});

/**
 * Rutas robustas por query param (?codigo=...) para SKUs con barra "/" (ej: APN25/27X250G)
 * compatibles detrás de cualquier reverse proxy o túnel externo.
 */
router.get('/receta-detalle', async (req, res) => {
    try {
        const numero_articulo = req.query.codigo;
        if (!numero_articulo) return res.status(400).json({ error: 'El parámetro codigo es requerido' });
        const receta = await obtenerReceta(numero_articulo);
        res.json(receta);
    } catch (error) {
        res.status(error.message === 'Receta no encontrada' ? 404 : 500).json({ error: error.message });
    }
});

router.put('/receta-detalle', validarReceta, async (req, res) => {
    try {
        await actualizarReceta(req, res);
    } catch (error) {
        console.error('Error al actualizar receta (query):', error);
        res.status(500).json({ error: 'Error al actualizar la receta' });
    }
});

router.delete('/receta-detalle', async (req, res) => {
    try {
        await eliminarReceta(req, res);
    } catch (error) {
        console.error('Error al eliminar receta (query):', error);
        res.status(500).json({ error: 'Error al eliminar la receta' });
    }
});

router.get('/receta-sugerencia', async (req, res) => {
    try {
        await obtenerSugerencia(req, res);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener sugerencia', detalle: error.message });
    }
});

router.put('/receta-sugerencia', async (req, res) => {
    try {
        await guardarSugerencia(req, res);
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar sugerencia', detalle: error.message });
    }
});

router.delete('/receta-sugerencia', async (req, res) => {
    try {
        await eliminarSugerencia(req, res);
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar sugerencia', detalle: error.message });
    }
});

// Rutas para carros de producción
router.post('/carro', async (req, res) => {
    try {
        const { usuarioId, enAuditoria, tipoCarro, lineaNegocio } = req.body;

        if (!usuarioId || isNaN(parseInt(usuarioId))) {
            return res.status(400).json({ error: 'Se requiere un ID de usuario válido' });
        }

        // Validar tipo de carro
        if (tipoCarro && !['interna', 'externa'].includes(tipoCarro)) {
            return res.status(400).json({ error: 'El tipo de carro debe ser "interna" o "externa"' });
        }

        const carroId = await crearCarro(parseInt(usuarioId), enAuditoria, tipoCarro, lineaNegocio);
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

// ✅ Ruta para editar un ingreso manual atómicamente
const { editarIngresoManual } = require('../controllers/editarIngresoManual');
router.put('/carro/:carroId/ingreso-manual-editar/:uuid', editarIngresoManual);

// ==========================================
// RUTAS PARA ABRIR CAJA
// ==========================================

const {
    obtenerCatalogoAbrirCaja,
    obtenerAprendizajeCaja,
    obtenerSugerenciasCajas,
    buscarCajas,
    obtenerLoteSugerido,
    registrarAperturaCaja
} = require('../controllers/abrirCaja');

/**
 * Obtener catálogo indexable + aprendizajes + últimas cajas con stock
 * GET /api/produccion/abrir-caja/catalogo
 */
router.get('/abrir-caja/catalogo', async (req, res) => {
    try {
        await obtenerCatalogoAbrirCaja(req, res);
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error en ruta /abrir-caja/catalogo:', error);
        res.status(500).json({
            error: 'Error al obtener catálogo de Abrir Caja',
            detalle: error.message
        });
    }
});

/**
 * Obtener aprendizaje automático para una caja específica
 * GET /api/produccion/abrir-caja/aprendizaje?codigo_caja=XXX
 */
router.get('/abrir-caja/aprendizaje', async (req, res) => {
    try {
        await obtenerAprendizajeCaja(req, res);
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error en ruta /abrir-caja/aprendizaje:', error);
        res.status(500).json({
            error: 'Error al obtener aprendizaje de caja',
            detalle: error.message
        });
    }
});

/**
 * Obtener o generar lote sugerido para apertura de caja
 * GET /api/produccion/abrir-caja/lote-sugerido?codigo_caja=XXX&codigo_unidad=YYY
 */
router.get('/abrir-caja/lote-sugerido', async (req, res) => {
    try {
        console.log('🔍 [ABRIR-CAJA] Ruta GET /abrir-caja/lote-sugerido');
        await obtenerLoteSugerido(req, res);
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error en ruta /abrir-caja/lote-sugerido:', error);
        res.status(500).json({
            error: 'Error al obtener lote sugerido',
            detalle: error.message
        });
    }
});

/**
 * Obtener sugerencias inteligentes de cajas basadas en historial
 * GET /api/produccion/abrir-caja/sugerencias?articulo_unidad=CODIGO
 */
router.get('/abrir-caja/sugerencias', async (req, res) => {
    try {
        console.log('🔍 [ABRIR-CAJA] Ruta GET /abrir-caja/sugerencias');
        await obtenerSugerenciasCajas(req, res);
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error en ruta /abrir-caja/sugerencias:', error);
        res.status(500).json({
            error: 'Error al obtener sugerencias',
            detalle: error.message
        });
    }
});

/**
 * Buscar cajas por código de barras o descripción
 * GET /api/produccion/abrir-caja/buscar?codigo_barras=XXX
 * GET /api/produccion/abrir-caja/buscar?descripcion=texto
 */
router.get('/abrir-caja/buscar', async (req, res) => {
    try {
        console.log('🔍 [ABRIR-CAJA] Ruta GET /abrir-caja/buscar');
        await buscarCajas(req, res);
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error en ruta /abrir-caja/buscar:', error);
        res.status(500).json({
            error: 'Error al buscar cajas',
            detalle: error.message
        });
    }
});

/**
 * Registrar apertura de caja (transacción completa)
 * POST /api/produccion/abrir-caja
 * Body: { codigo_caja, codigo_unidad, cantidad_unidades, usuario_id, kilos_caja, kilos_unidad }
 */
router.post('/abrir-caja', async (req, res) => {
    try {
        console.log('🔓 [ABRIR-CAJA] Ruta POST /abrir-caja');
        await registrarAperturaCaja(req, res);
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error en ruta /abrir-caja:', error);
        res.status(500).json({
            error: 'Error al registrar apertura de caja',
            detalle: error.message
        });
    }
});

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

// Ruta para obtener kilos_unidad de un artículo desde stock_real_consolidado
router.get('/stock/:codigo', async (req, res) => {
    try {
        const { codigo } = req.params;

        if (!codigo) {
            return res.status(400).json({ error: 'Se requiere el código del artículo' });
        }

        console.log(`🔍 [STOCK] Consultando kilos_unidad para artículo: ${codigo}`);

        const query = `
            SELECT 
                articulo_numero,
                descripcion,
                kilos_unidad,
                stock_consolidado
            FROM stock_real_consolidado
            WHERE articulo_numero = $1
        `;

        const result = await req.db.query(query, [codigo]);

        if (result.rows.length === 0) {
            console.warn(`⚠️ [STOCK] Artículo no encontrado en stock_real_consolidado: ${codigo}`);
            return res.status(404).json({
                error: 'Artículo no encontrado en stock',
                kilos_unidad: 0
            });
        }

        const articulo = result.rows[0];
        console.log(`✅ [STOCK] Artículo encontrado:`, articulo);

        res.json({
            articulo_numero: articulo.articulo_numero,
            descripcion: articulo.descripcion,
            kilos_unidad: parseFloat(articulo.kilos_unidad || 0),
            stock_consolidado: parseFloat(articulo.stock_consolidado || 0)
        });

    } catch (error) {
        console.error('❌ [STOCK] Error al obtener kilos_unidad:', error);
        res.status(500).json({
            error: 'Error al consultar stock del artículo',
            detalle: error.message
        });
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
const { eliminarIngresoManual, eliminarIngresoManualPorUUID } = require('../controllers/eliminarIngresoManual');

// Importar el controlador de guardado de ingredientes
const { obtenerIngredientesConsolidadosCarro, ajustarStockIngrediente } = require('../controllers/guardadoIngredientes');

// Ruta para eliminar físicamente un ingreso manual (antigua)
router.delete('/carro/:carroId/ingreso-manual/:ingresoId', eliminarIngresoManual);

// Ruta para eliminar físicamente un ingreso manual por UUID
router.delete('/carro/:carroId/ingreso-manual-uuid/:uuid', eliminarIngresoManualPorUUID);

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
        const crypto = require('crypto');

        console.log(`\n🔧 [AJUSTES-INGREDIENTES] ===== PROCESANDO BATCH DE AJUSTES PUNTUALES DUAL (KILOS + BULTO/LOTE) =====`);
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

                const { 
                    articulo_numero, 
                    ingrediente_id,
                    usuario_id, 
                    tipo, 
                    kilos, 
                    cantidad, 
                    stock_nuevo_kilos,
                    stock_nuevo_bultos,
                    lotes_ajustes,
                    nuevo_lote_codigo,
                    nuevo_lote_cajas,
                    nuevo_lote_kg_caja,
                    observacion 
                } = ajuste;

                try {
                    const ident = ingrediente_id || articulo_numero;
                    console.log(`🎯 [AJUSTE-PUNTUAL] Ingrediente identificador: ${ident}`);
                    console.log(`🎯 [AJUSTE-PUNTUAL] Usuario: ${usuario_id}`);

                    // 🔍 BUSCAR INGREDIENTE CON BLOQUEO FOR UPDATE
                    const articuloStr = (ident || '').toString();
                    const esNumerico = /^\d+$/.test(articuloStr);
                    const articuloInt = esNumerico ? parseInt(articuloStr) : null;

                    const buscarQuery = `
                        SELECT id, nombre, codigo, stock_actual, COALESCE(stock_bultos, 0) as stock_bultos 
                        FROM ingredientes 
                        WHERE (id = $2 AND $3 = true) OR codigo = $1
                        FOR UPDATE
                    `;
                    const buscarResult = await req.db.query(buscarQuery, [articuloStr, articuloInt, esNumerico]);

                    if (buscarResult.rows.length === 0) {
                        const error = `Ingrediente no encontrado: ${ident}`;
                        console.error(`❌ [ERROR] ${error}`);
                        erroresEncontrados.push(error);
                        continue;
                    }

                    const ingrediente = buscarResult.rows[0];
                    const stockAnteriorKilos = parseFloat(ingrediente.stock_actual) || 0;
                    const stockAnteriorBultos = parseFloat(ingrediente.stock_bultos) || 0;

                    console.log(`✅ [ENCONTRADO] ${ingrediente.nombre} (ID: ${ingrediente.id}) | Sys Kilos: ${stockAnteriorKilos} | Sys Bultos: ${stockAnteriorBultos}`);

                    // 1. DETERMINAR NUEVO STOCK DE KILOS ABIERTOS (Balanza)
                    let nuevoStockKilos = stockAnteriorKilos;
                    let diffKilos = 0;

                    if (stock_nuevo_kilos !== undefined && stock_nuevo_kilos !== null && stock_nuevo_kilos !== '') {
                        nuevoStockKilos = parseFloat(stock_nuevo_kilos) || 0;
                        diffKilos = nuevoStockKilos - stockAnteriorKilos;
                    } else if (kilos !== undefined || cantidad !== undefined) {
                        let valorRecibido = kilos !== undefined && kilos !== null ? kilos : cantidad;
                        if (typeof valorRecibido === 'string') valorRecibido = valorRecibido.replace(',', '.');
                        diffKilos = parseFloat(valorRecibido) || 0;
                        nuevoStockKilos = stockAnteriorKilos + diffKilos;
                    }

                    diffKilos = Math.round(diffKilos * 1000) / 1000;
                    nuevoStockKilos = Math.round(nuevoStockKilos * 1000) / 1000;

                    // 2. DETERMINAR NUEVO STOCK DE BULTOS / LOTES CERRADOS
                    let nuevoStockBultos = stockAnteriorBultos;
                    let diffBultos = 0;
                    const detalleLotesTexto = [];

                    // 2.a. Procesar ajustes a lotes existentes en bunker_lotes_destinos
                    if (Array.isArray(lotes_ajustes) && lotes_ajustes.length > 0) {
                        let sumaCajasLotes = 0;
                        for (const loteItem of lotes_ajustes) {
                            const vinculoId = loteItem.vinculo_id;
                            const cajasNuevas = parseFloat(loteItem.cajas_nuevas) || 0;
                            sumaCajasLotes += cajasNuevas;

                            if (vinculoId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vinculoId)) {
                                const destQuery = `
                                    SELECT id, cantidad_asignada, COALESCE(cantidad_abierta, 0) as cantidad_abierta
                                    FROM public.bunker_lotes_destinos
                                    WHERE vinculo_id = $1 AND destino_id = $2 AND tipo_destino = 'INGREDIENTE_PRODUCCION'
                                    FOR UPDATE
                                `;
                                const destRes = await req.db.query(destQuery, [vinculoId, String(ingrediente.id)]);

                                if (destRes.rows.length > 0) {
                                    const destRow = destRes.rows[0];
                                    const cantAsignada = parseFloat(destRow.cantidad_asignada) || 0;

                                    let nuevaCantidadAbierta = 0;
                                    let nuevaCantidadAsignada = cantAsignada;

                                    if (cajasNuevas <= cantAsignada) {
                                        nuevaCantidadAbierta = cantAsignada - cajasNuevas;
                                    } else {
                                        nuevaCantidadAsignada = cajasNuevas;
                                        nuevaCantidadAbierta = 0;
                                    }

                                    await req.db.query(`
                                        UPDATE public.bunker_lotes_destinos
                                        SET cantidad_asignada = $1, cantidad_abierta = $2
                                        WHERE id = $3
                                    `, [nuevaCantidadAsignada, nuevaCantidadAbierta, destRow.id]);

                                    console.log(`📦 [LOTE-UPDATE] Lote vinculo ${vinculoId}: Cajas asignadas=${nuevaCantidadAsignada}, abiertas=${nuevaCantidadAbierta} (Disponibles: ${cajasNuevas})`);
                                    detalleLotesTexto.push(`#${loteItem.lote_codigo_corto || 'Lote'}: ${cajasNuevas} cj`);
                                }
                            }
                        }

                        nuevoStockBultos = (stock_nuevo_bultos !== undefined && stock_nuevo_bultos !== null)
                            ? (parseFloat(stock_nuevo_bultos) || 0)
                            : sumaCajasLotes;
                    } else if (stock_nuevo_bultos !== undefined && stock_nuevo_bultos !== null) {
                        nuevoStockBultos = parseFloat(stock_nuevo_bultos) || 0;
                    }

                    // 2.b. Si el usuario ingresó un nuevo número de lote manual
                    if (nuevo_lote_codigo && nuevo_lote_codigo.trim() && parseFloat(nuevo_lote_cajas) > 0) {
                        const cantCajasNueva = parseFloat(nuevo_lote_cajas);
                        const kgPorCaja = parseFloat(nuevo_lote_kg_caja || 0);
                        const codLoteLimpio = nuevo_lote_codigo.trim().toUpperCase();
                        const nuevoVinculoId = crypto.randomUUID();

                        console.log(`🏷️ [NUEVO-LOTE-AJUSTE] Registrando lote ${codLoteLimpio} con ${cantCajasNueva} cj para ${ingrediente.nombre}`);

                        await req.db.query(`
                            INSERT INTO public.bunker_lotes_vinculos
                            (id, lote_id_supabase, lote_codigo_corto, fecha_vinculacion, articulo_descripcion, usuario_vinculador)
                            VALUES ($1, $2, $3, NOW(), $4, $5)
                        `, [nuevoVinculoId, nuevoVinculoId, codLoteLimpio, ingrediente.nombre, usuario_id ? String(usuario_id) : 'SISTEMA']);

                        await req.db.query(`
                            INSERT INTO public.bunker_lotes_destinos
                            (vinculo_id, tipo_destino, destino_id, cantidad_asignada, cantidad_abierta, kilos_asignados)
                            VALUES ($1, 'INGREDIENTE_PRODUCCION', $2, $3, 0, $4)
                        `, [nuevoVinculoId, String(ingrediente.id), cantCajasNueva, cantCajasNueva * kgPorCaja]);

                        // Si no venía en el total, sumarlo
                        if (stock_nuevo_bultos === undefined) {
                            nuevoStockBultos += cantCajasNueva;
                        }
                        detalleLotesTexto.push(`+Nuevo #${codLoteLimpio}: ${cantCajasNueva} cj`);
                    }

                    diffBultos = Math.round((nuevoStockBultos - stockAnteriorBultos) * 1000) / 1000;
                    nuevoStockBultos = Math.round(nuevoStockBultos * 1000) / 1000;

                    console.log(`🧮 [CÁLCULOS DUAL] Kilos: ${stockAnteriorKilos} -> ${nuevoStockKilos} (Diff: ${diffKilos}) | Bultos: ${stockAnteriorBultos} -> ${nuevoStockBultos} (Diff: ${diffBultos})`);

                    const hayCambio = Math.abs(diffKilos) > 0.001 || Math.abs(diffBultos) > 0.001 || detalleLotesTexto.length > 0;

                    if (!hayCambio) {
                        console.log(`ℹ️ [SKIP] Sin cambios significativos para ${ingrediente.nombre}`);
                        ajustesAplicados++;
                        continue;
                    }

                    // 3. REGISTRAR MOVIMIENTO EN INGREDIENTES_MOVIMIENTOS (kilos + bultos)
                    const obsMov = observacion || `Ajuste puntual dual - Kilos: ${stockAnteriorKilos}->${nuevoStockKilos} | Bultos: ${stockAnteriorBultos}->${nuevoStockBultos}${detalleLotesTexto.length > 0 ? ' [' + detalleLotesTexto.join(', ') + ']' : ''}`;

                    const insertMovimientoQuery = `
                        INSERT INTO ingredientes_movimientos 
                        (ingrediente_id, tipo, kilos, bultos, fecha, observaciones)
                        VALUES ($1, 'ajuste', $2, $3, NOW(), $4)
                        RETURNING id
                    `;
                    const movResult = await req.db.query(insertMovimientoQuery, [
                        ingrediente.id,
                        diffKilos,
                        diffBultos,
                        obsMov
                    ]);
                    const movimientoId = movResult.rows[0].id;
                    console.log(`✅ [MOVIMIENTO] Registrado ID ${movimientoId} (kilos: ${diffKilos}, bultos: ${diffBultos})`);

                    // 4. ASEGURAR STOCK EN TABLA INGREDIENTES
                    await req.db.query(`
                        UPDATE ingredientes
                        SET stock_actual = $1,
                            stock_bultos = $2
                        WHERE id = $3
                    `, [nuevoStockKilos, nuevoStockBultos, ingrediente.id]);
                    console.log(`✅ [STOCK-DIRECTO] ingredientes actualizado: stock_actual=${nuevoStockKilos}, stock_bultos=${nuevoStockBultos}`);

                    // 5. REGISTRAR EN INGREDIENTES_AJUSTES PARA AUDITORÍA
                    const insertAjusteQuery = `
                        INSERT INTO ingredientes_ajustes 
                        (ingrediente_id, usuario_id, tipo_ajuste, stock_anterior, stock_nuevo, observacion, fecha)
                        VALUES ($1, $2, 'ajuste_puntual', $3, $4, $5, NOW())
                    `;
                    await req.db.query(insertAjusteQuery, [
                        ingrediente.id,
                        usuario_id || 1,
                        stockAnteriorKilos,
                        nuevoStockKilos,
                        obsMov
                    ]);
                    console.log(`✅ [AUDITORÍA] ingredientes_ajustes registrado`);

                    ajustesAplicados++;
                    console.log(`🎯 [AJUSTE-PUNTUAL] Completado exitosamente para ${ingrediente.nombre}`);

                } catch (ajusteError) {
                    console.error(`❌ [AJUSTE-PUNTUAL] Error procesando ingrediente ${articulo_numero || ingrediente_id}:`, ajusteError);
                    erroresEncontrados.push(`Error en ajuste puntual de ${articulo_numero || ingrediente_id}: ${ajusteError.message}`);
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
            await req.db.query('ROLLBACK');
            console.error('❌ [ERROR] Error en batch de ajustes puntuales:', error);
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
const { revertirCarroPreparado } = require('../controllers/revertirCarroPreparado');
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
    obtenerEstadoSesion,
    obtenerHistorialInventarios,
    obtenerDetalleSesionInventario,
    generarInformePDFInventario
} = require('../controllers/inventarioIngredientesSimple');

// Controlador para inventario de artículos
const {
    finalizarInventarioArticulos
} = require('../controllers/inventarioArticulos');

// ==========================================
// RUTAS PARA INVENTARIO DE INGREDIENTES
// ==========================================

// Ruta para obtener el historial de inventarios finalizados
router.get('/inventario-ingredientes/historial', async (req, res) => {
    try {
        console.log('📜 [RUTA] Consultando historial de inventarios');
        await obtenerHistorialInventarios(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /inventario-ingredientes/historial:', error);
        res.status(500).json({
            error: 'Error al obtener historial de inventarios',
            detalle: error.message
        });
    }
});

// Ruta para obtener el informe de inventario en PDF
router.get('/inventario-ingredientes/:session_id/informe-pdf', async (req, res) => {
    try {
        console.log('🖨️ [RUTA] Generando informe de inventario en PDF:', req.params.session_id);
        await generarInformePDFInventario(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /inventario-ingredientes/:session_id/informe-pdf:', error);
        res.status(500).json({
            error: 'Error al generar informe PDF de inventario',
            detalle: error.message
        });
    }
});

// Ruta para obtener el detalle de una sesión de inventario
router.get('/inventario-ingredientes/:session_id/detalle', async (req, res) => {
    try {
        console.log('🔍 [RUTA] Obteniendo detalle de sesión de inventario:', req.params.session_id);
        await obtenerDetalleSesionInventario(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /inventario-ingredientes/:session_id/detalle:', error);
        res.status(500).json({
            error: 'Error al obtener detalle de sesión',
            detalle: error.message
        });
    }
});

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

// Ruta para registrar un ingrediente contado por session_id (REST)
router.post('/inventario-ingredientes/:session_id/registrar', async (req, res) => {
    try {
        req.body.session_id = req.params.session_id || req.body.session_id;
        console.log('📝 [RUTA] Registrando ingrediente contado para sesión:', req.body.session_id);
        await registrarIngredienteContado(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /inventario-ingredientes/:session_id/registrar:', error);
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

// ==========================================
// RUTAS PARA AJUSTES MANUALES DE ARTÍCULOS
// ==========================================

const { registrarAjusteManual, registrarAjustesBatch } = require('../controllers/ajustesArticulos');

/**
 * Ruta para registrar un ajuste manual individual de stock de artículo
 * POST /api/produccion/articulos/ajuste-manual
 * Body: { articulo_numero, stock_nuevo, observacion, usuario_id }
 */
router.post('/articulos/ajuste-manual', async (req, res) => {
    try {
        console.log('🔧 [RUTA] Registrando ajuste manual de artículo');
        await registrarAjusteManual(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /articulos/ajuste-manual:', error);
        res.status(500).json({
            error: 'Error al registrar ajuste manual',
            detalle: error.message
        });
    }
});

/**
 * Ruta para registrar múltiples ajustes manuales en lote
 * POST /api/produccion/articulos/ajustes-batch
 * Body: { ajustes: [{ articulo_numero, stock_nuevo, observacion }], usuario_id }
 */
router.post('/articulos/ajustes-batch', async (req, res) => {
    try {
        console.log('🔧 [RUTA] Registrando ajustes en lote de artículos');
        await registrarAjustesBatch(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /articulos/ajustes-batch:', error);
        res.status(500).json({
            error: 'Error al registrar ajustes en lote',
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

        // Blindaje de stock personal domicilio: excluir insumos y excluir ingredientes exclusivos de Planta/Depósito
        // que no forman parte de ninguna receta de Unidad Productiva externa ni de un despacho personal con envase.
        const valIngDomicilio = await req.db.query(`
            SELECT i.id, i.nombre, COALESCE(i.es_insumo, false) AS es_insumo,
                   EXISTS (
                       SELECT 1
                       FROM public.articulos_produccion_externa_relacion rel
                       JOIN public.recetas r_up ON UPPER(BTRIM(r_up.articulo_numero)) = UPPER(BTRIM(rel.articulo_produccion_codigo))
                       JOIN public.receta_ingredientes ri_up ON ri_up.receta_id = r_up.id
                       WHERE ri_up.ingrediente_id = i.id
                   ) AS pertenece_a_up,
                   EXISTS (
                       SELECT 1
                       FROM public.ingredientes_stock_usuarios isu_env
                       WHERE isu_env.usuario_id = $2
                         AND isu_env.ingrediente_id = i.id
                         AND isu_env.contexto_envase IS NOT NULL
                   ) AS tiene_envase_personal
            FROM public.ingredientes i
            WHERE i.id = $1
            LIMIT 1
        `, [ingrediente_id, usuario_id]);

        const infoDom = valIngDomicilio.rows[0];
        if (!infoDom || infoDom.es_insumo || (!infoDom.pertenece_a_up && !infoDom.tiene_envase_personal)) {
            console.log(`⏭️ Ingrediente #${ingrediente_id} (${infoDom?.nombre || 'desconocido'}) omitido de stock personal domicilio (exclusivo de Depósito/Planta).`);
            return res.json({
                message: 'Ingrediente exclusivo de Depósito/Planta omitido de stock personal domicilio',
                omitido_planta: true,
                id: null
            });
        }

        const cantNum = parseFloat(cantidad);
        const esEgresoConsumo = cantNum < 0;
        const query = `
            INSERT INTO ingredientes_stock_usuarios 
            (usuario_id, ingrediente_id, cantidad, origen_carro_id, carro_referencia_id, fecha_registro, origen_mix_id, tipo_movimiento)
            VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
            RETURNING id
        `;

        const params = [
            usuario_id,
            ingrediente_id,
            cantNum,
            esEgresoConsumo ? origen_carro_id : null,
            !esEgresoConsumo ? (origen_carro_id || null) : null,
            origen_mix_id || null,
            req.body.tipo_movimiento || (esEgresoConsumo ? 'consumo_produccion' : 'abastecimiento_deposito')
        ];
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
 * Ruta: POST /api/produccion/carro/:id/revertir-preparado
 * Descripción: Revierte la fase de preparación, eliminando egresos y devolviendo a fase de edición.
 */
router.post('/carro/:id/revertir-preparado', async (req, res, next) => {
    try {
        if (!req.db) {
            throw new Error('No hay conexión a la base de datos disponible');
        }
        await revertirCarroPreparado(req, res);
    } catch (error) {
        console.error('Error en ruta /carro/:id/revertir-preparado:', error);
        res.status(500).json({
            error: 'Error al revertir la preparación del carro',
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

// Ruta local para consultar tarifa de rendimiento de colaborador sin depender de otro puerto
router.get('/colaboradores/tarifa-rendimiento', async (req, res) => {
    try {
        const colaboradorId = parseInt(req.query.colaborador_id);
        const sku = (req.query.sku || '').trim();
        if (isNaN(colaboradorId) || !sku) {
            return res.status(400).json({ success: false, error: 'Parámetros inválidos' });
        }
        const query = `
            SELECT 
                ctr.id,
                ctr.valor_por_unidad,
                ctr.unidad_medida,
                ctr.articulo_numero,
                COALESCE(src.descripcion, a.nombre, ctr.articulo_numero) as articulo_nombre
            FROM public.colaboradores_tarifas_rendimiento ctr
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ctr.articulo_numero
            LEFT JOIN public.articulos a ON a.numero = ctr.articulo_numero
            WHERE ctr.usuario_id = $1 AND ctr.articulo_numero = $2 AND ctr.activo = true
            ORDER BY ctr.id DESC
            LIMIT 1
        `;
        const result = await req.db.query(query, [colaboradorId, sku]);
        return res.json({
            success: true,
            data: result.rows[0] || null
        });
    } catch (error) {
        console.error('Error en /colaboradores/tarifa-rendimiento:', error);
        return res.status(500).json({ success: false, error: error.message });
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
            SELECT tipo_carro, fecha_preparado
            FROM carros_produccion
            WHERE id = $1 AND usuario_id = $2
        `;
        const carroResult = await req.db.query(carroQuery, [carroId, usuarioId]);

        if (carroResult.rows.length === 0) {
            return res.status(404).json({ error: 'Carro no encontrado' });
        }

        const tipoCarro = carroResult.rows[0].tipo_carro;
        const fechaPreparado = carroResult.rows[0].fecha_preparado;

        if (tipoCarro === 'externa') {
            // Si el carro ya está preparado/confirmado, verificar si hay artículos efectivamente retirados en stock_ventas_movimientos
            if (fechaPreparado) {
                const movsQuery = `
                    SELECT 
                        svm.articulo_numero,
                        COALESCE(
                            NULLIF(TRIM(src.descripcion), ''),
                            NULLIF(TRIM(a.nombre), ''),
                            svm.articulo_numero
                        ) as nombre,
                        a.codigo_barras,
                        SUM(ABS(svm.cantidad)) as cantidad_total,
                        COALESCE(src.stock_consolidado, 0) as stock_actual,
                        COALESCE(NULLIF(src.kilos_unidad, 0), NULLIF(ba.kilos_unidad, 0), 1.0) as kilos_unidad,
                        SUM(
                            CASE
                                WHEN ABS(COALESCE(svm.kilos, 0)) > 0 THEN ABS(svm.kilos)
                                ELSE ABS(svm.cantidad) * COALESCE(NULLIF(src.kilos_unidad, 0), NULLIF(ba.kilos_unidad, 0), 1.0)
                            END
                        ) as kilos_totales
                    FROM stock_ventas_movimientos svm
                    LEFT JOIN stock_real_consolidado src ON src.articulo_numero = svm.articulo_numero
                    LEFT JOIN articulos a ON (a.numero = svm.articulo_numero OR a.codigo_barras = svm.articulo_numero)
                    LEFT JOIN bunker_articulos ba ON ba.articulo_id = svm.articulo_numero
                    WHERE svm.carro_id = $1 AND svm.tipo = 'egreso por receta externa'
                    GROUP BY svm.articulo_numero, src.descripcion, a.nombre, a.codigo_barras, src.stock_consolidado, src.kilos_unidad, ba.kilos_unidad
                    ORDER BY svm.articulo_numero
                `;
                const movsResult = await req.db.query(movsQuery, [carroId]);
                if (movsResult.rows.length > 0) {
                    return res.json(movsResult.rows);
                }
            }

            // Para carros externos en preparación (o sin movimientos específicos): obtener artículos por defecto de recetas
            const articulosQuery = `
                SELECT 
                    ra.articulo_numero,
                    COALESCE(
                        NULLIF(TRIM(src.descripcion), ''),
                        NULLIF(TRIM(a.nombre), ''),
                        ra.articulo_numero
                    ) as nombre,
                    a.codigo_barras,
                    SUM(ra.cantidad * ca.cantidad) as cantidad_total,
                    COALESCE(src.stock_consolidado, 0) as stock_actual,
                    COALESCE(NULLIF(src.kilos_unidad, 0), NULLIF(ba.kilos_unidad, 0), 1.0) as kilos_unidad,
                    SUM(ra.cantidad * ca.cantidad * COALESCE(NULLIF(src.kilos_unidad, 0), NULLIF(ba.kilos_unidad, 0), 1.0)) as kilos_totales
                FROM carros_articulos ca
                JOIN recetas r ON r.articulo_numero = ca.articulo_numero
                JOIN receta_articulos ra ON ra.receta_id = r.id
                LEFT JOIN stock_real_consolidado src ON src.articulo_numero = ra.articulo_numero
                LEFT JOIN articulos a ON (a.numero = ra.articulo_numero OR a.codigo_barras = ra.articulo_numero)
                LEFT JOIN bunker_articulos ba ON ba.articulo_id = ra.articulo_numero
                WHERE ca.carro_id = $1
                GROUP BY ra.articulo_numero, src.descripcion, a.nombre, a.codigo_barras, src.stock_consolidado, src.kilos_unidad, ba.kilos_unidad
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
const { obtenerPadresParaImpresion } = require('../controllers/obtenerArticulosParaEtiquetas');
router.get('/carro/:id/articulos-etiquetas', obtenerArticulosParaEtiquetas);
router.get('/carro/:id/padres-impresion', obtenerPadresParaImpresion);

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

// 🆕 Ruta para obtener artículos sugeridos basados en vinculaciones maestras, bunker, recetas e historial de uso
router.get('/ingredientes/:id/articulos-sugeridos', async (req, res) => {
    try {
        const ingredienteId = parseInt(req.params.id);

        if (isNaN(ingredienteId)) {
            return res.status(400).json({ error: 'ID de ingrediente inválido' });
        }

        console.log(`⚡ [SUGERIDOS] Obteniendo artículos sugeridos para ingrediente ${ingredienteId}`);

        // 🔧 CONSULTA MULTI-TIER DETERMINISTA:
        // Tier 1: Vinculaciones explícitas maestras (articulo_vinculado_numero, bunker_articulos, recetas)
        // Tier 2: Historial real en carros de producción (vía carro_id + observaciones / UUID)
        // Tier 3: Historial clásico directo (im.observaciones = articulo_numero)
        const query = `
            WITH 
            -- 1. Vinculación directa maestra (ingredientes.articulo_vinculado_numero)
            vinculado_maestro AS (
                SELECT 
                    i.articulo_vinculado_numero AS articulo_numero,
                    1 AS tier,
                    'Insumo Maestro' AS origen,
                    NULL::timestamp with time zone AS ultima_fecha_uso,
                    100::bigint AS frecuencia_uso
                FROM ingredientes i
                WHERE i.id = $1 
                  AND i.articulo_vinculado_numero IS NOT NULL 
                  AND i.articulo_vinculado_numero != ''
            ),
            -- 2. Vinculación en Bunker (ingrediente_bunker_articulos)
            vinculado_bunker AS (
                SELECT 
                    iba.bunker_articulo_id AS articulo_numero,
                    1 AS tier,
                    'Bunker Mapeado' AS origen,
                    iba.created_at AS ultima_fecha_uso,
                    50::bigint AS frecuencia_uso
                FROM ingrediente_bunker_articulos iba
                WHERE iba.ingrediente_id = $1
            ),
            -- 3. Artículo sugerido en recetas (recetas.articulo_sugerido_numero)
            vinculado_receta AS (
                SELECT 
                    r.articulo_sugerido_numero AS articulo_numero,
                    1 AS tier,
                    'Receta Sugerido' AS origen,
                    r.fecha_creacion AS ultima_fecha_uso,
                    40::bigint AS frecuencia_uso
                FROM receta_ingredientes ri
                JOIN recetas r ON r.id = ri.receta_id
                WHERE ri.ingrediente_id = $1 
                  AND r.articulo_sugerido_numero IS NOT NULL 
                  AND r.articulo_sugerido_numero != ''
            ),
            -- 4. Historial de uso en carros (vinculado por carro_id y observaciones/UUID)
            historial_carro AS (
                SELECT 
                    svm.articulo_numero,
                    2 AS tier,
                    'Historial Carro' AS origen,
                    MAX(im.fecha) AS ultima_fecha_uso,
                    COUNT(*)::bigint AS frecuencia_uso
                FROM ingredientes_movimientos im
                JOIN stock_ventas_movimientos svm ON im.carro_id = svm.carro_id 
                    AND (im.observaciones = svm.observaciones OR im.observaciones = svm.articulo_numero)
                WHERE im.ingrediente_id = $1
                GROUP BY svm.articulo_numero
            ),
            -- 5. Historial directo tradicional (im.observaciones = a.numero)
            historial_directo AS (
                SELECT 
                    im.observaciones AS articulo_numero,
                    3 AS tier,
                    'Historial Directo' AS origen,
                    MAX(im.fecha) AS ultima_fecha_uso,
                    COUNT(*)::bigint AS frecuencia_uso
                FROM ingredientes_movimientos im
                WHERE im.ingrediente_id = $1
                  AND im.observaciones IS NOT NULL
                  AND im.observaciones != ''
                  AND im.observaciones NOT LIKE '%[UUID:%'
                  AND im.observaciones NOT LIKE '%SUSTITUCIÓN%'
                  AND im.observaciones NOT LIKE '%Ajuste%'
                GROUP BY im.observaciones
            ),
            candidatos_unificados AS (
                SELECT * FROM vinculado_maestro
                UNION ALL
                SELECT * FROM vinculado_bunker
                UNION ALL
                SELECT * FROM vinculado_receta
                UNION ALL
                SELECT * FROM historial_carro
                UNION ALL
                SELECT * FROM historial_directo
            ),
            candidatos_agrupados AS (
                SELECT 
                    c.articulo_numero,
                    MIN(c.tier) AS tier,
                    MAX(c.ultima_fecha_uso) AS ultima_fecha_uso,
                    SUM(c.frecuencia_uso) AS frecuencia_uso,
                    STRING_AGG(DISTINCT c.origen, ', ') AS origenes
                FROM candidatos_unificados c
                GROUP BY c.articulo_numero
            )
            SELECT 
                ca.articulo_numero,
                a.nombre AS articulo_nombre,
                a.codigo_barras,
                COALESCE(src.stock_consolidado, 0) AS stock_actual,
                ca.tier,
                ca.origenes,
                ca.ultima_fecha_uso,
                ca.frecuencia_uso,
                CASE WHEN ca.tier = 1 THEN 1 ELSE 2 END AS prioridad
            FROM candidatos_agrupados ca
            JOIN articulos a ON a.numero = ca.articulo_numero
            LEFT JOIN stock_real_consolidado src ON src.articulo_numero = ca.articulo_numero
            ORDER BY 
                prioridad ASC,
                (COALESCE(src.stock_consolidado, 0) > 0) DESC,
                stock_actual DESC,
                ca.ultima_fecha_uso DESC NULLS LAST,
                ca.frecuencia_uso DESC
            LIMIT 6;
        `;

        const result = await req.db.query(query, [ingredienteId]);

        console.log(`⚡ [SUGERIDOS] Encontrados ${result.rows.length} artículos sugeridos para ingrediente ${ingredienteId}`);

        if (result.rows.length > 0) {
            console.log('📊 [SUGERIDOS] Detalle:');
            result.rows.forEach((art, index) => {
                console.log(`  ${index + 1}. [Tier ${art.tier}] ${art.articulo_nombre} (${art.articulo_numero}) - Stock: ${art.stock_actual} - Origen: ${art.origenes}`);
            });
        }

        res.json(result.rows);
    } catch (error) {
        console.error('❌ [SUGERIDOS] Error al obtener artículos sugeridos:', error);
        res.status(500).json({
            error: 'Error al obtener artículos sugeridos',
            detalle: error.message
        });
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
            // 🏭 CARROS INTERNOS: Artículos + Sustituciones
            // 🔧 CORRECCIÓN: Agregar UNION ALL para incluir sustituciones
            query = `
                -- Parte 1: Movimientos de artículos (ingresos manuales tradicionales)
                SELECT
                    svm.id,
                    svm.fecha,
                    ABS(svm.kilos) as kilos,
                    svm.carro_id,
                    COALESCE(
                        im.ingrediente_id,
                        (SELECT ian.ingrediente_id FROM ingrediente_articulos_nutrientes ian WHERE ian.articulo_numero = svm.articulo_numero AND ian.activo = true LIMIT 1),
                        (SELECT i2.id FROM ingredientes i2 WHERE i2.articulo_vinculado_numero = svm.articulo_numero LIMIT 1)
                    ) as ingrediente_id,
                    svm.articulo_numero,
                    a.nombre as articulo_nombre,
                    svm.codigo_barras,
                    COALESCE(i.nombre, a.nombre) as ingrediente_nombre,
                    COALESCE(svm.origen_ingreso, 'simple') as tipo_articulo,
                    'stock_ventas_movimientos' as fuente_datos,
                    svm.observaciones,
                    NULL as ingrediente_destino_nombre
                FROM stock_ventas_movimientos svm
                LEFT JOIN articulos a ON a.numero = svm.articulo_numero
                LEFT JOIN ingredientes_movimientos im ON im.carro_id = svm.carro_id 
                    AND (im.observaciones = svm.articulo_numero OR (im.observaciones LIKE '%[UUID:%' AND im.observaciones = svm.observaciones))
                    AND im.tipo = 'ingreso'
                    AND ABS(im.kilos - ABS(svm.kilos)) < 0.01
                LEFT JOIN ingredientes i ON i.id = im.ingrediente_id
                WHERE svm.carro_id = $1 
                  AND svm.tipo = 'ingreso a producción'

                UNION ALL

                -- Parte 2: Sustituciones de ingredientes (movimientos cruzados)
                -- 🔧 SIMPLIFICADO: Solo buscar egresos y extraer destino de observaciones
                SELECT
                    im_egreso.id,
                    im_egreso.fecha,
                    ABS(im_egreso.kilos) as kilos,
                    im_egreso.carro_id,
                    im_egreso.ingrediente_id,
                    NULL as articulo_numero,
                    NULL as articulo_nombre,
                    NULL as codigo_barras,
                    i_origen.nombre as ingrediente_nombre,
                    'sustitucion' as tipo_articulo,
                    'ingredientes_movimientos' as fuente_datos,
                    im_egreso.observaciones,
                    NULL as ingrediente_destino_nombre
                FROM ingredientes_movimientos im_egreso
                JOIN ingredientes i_origen ON i_origen.id = im_egreso.ingrediente_id
                WHERE im_egreso.carro_id = $1 
                  AND im_egreso.tipo = 'egreso'
                  AND im_egreso.observaciones LIKE 'SUSTITUCIÓN:%'

                ORDER BY fecha DESC
            `;
            console.log('🏭 Usando consulta para CARRO INTERNO - INCLUYE SUSTITUCIONES');
        } else {
            // 🌐 CARROS EXTERNOS: Ambas fuentes (ingredientes_movimientos + stock_ventas_movimientos)
            query = `
                SELECT 
                    im.id,
                    im.fecha,
                    im.kilos,
                    im.carro_id,
                    im.ingrediente_id,
                    SPLIT_PART(im.observaciones, ' ', 1) as articulo_numero,
                    a.nombre as articulo_nombre,
                    a.codigo_barras,
                    i.nombre as ingrediente_nombre,
                    'simple' as tipo_articulo,
                    'ingredientes_movimientos' as fuente_datos,
                    im.observaciones
                FROM ingredientes_movimientos im
                JOIN ingredientes i ON i.id = im.ingrediente_id
                LEFT JOIN articulos a ON a.numero = SPLIT_PART(im.observaciones, ' ', 1)
                WHERE im.carro_id = $1 AND im.tipo = 'ingreso'

                UNION ALL

                SELECT
                    svm.id,
                    svm.fecha,
                    ABS(svm.kilos) as kilos,
                    svm.carro_id,
                    COALESCE(
                        (SELECT ian.ingrediente_id FROM ingrediente_articulos_nutrientes ian WHERE ian.articulo_numero = svm.articulo_numero AND ian.activo = true LIMIT 1),
                        (SELECT i2.id FROM ingredientes i2 WHERE i2.articulo_vinculado_numero = svm.articulo_numero LIMIT 1)
                    ) as ingrediente_id,
                    svm.articulo_numero,
                    a.nombre as articulo_nombre,
                    svm.codigo_barras,
                    a.nombre as ingrediente_nombre,
                    COALESCE(svm.origen_ingreso, 'simple') as tipo_articulo,
                    'stock_ventas_movimientos' as fuente_datos,
                    svm.observaciones

                FROM stock_ventas_movimientos svm
                LEFT JOIN articulos a ON a.numero = svm.articulo_numero
                WHERE svm.carro_id = $1 
                  AND svm.tipo = 'ingreso a producción'
                  AND svm.origen_ingreso IS NOT NULL

                UNION ALL

                SELECT
                    svm.id,
                    svm.fecha,
                    ABS(svm.cantidad) * COALESCE(NULLIF(src.kilos_unidad, 0), NULLIF(ba.kilos_unidad, 0), 1.0) as kilos,
                    svm.carro_id,
                    NULL::integer as ingrediente_id,
                    svm.articulo_numero,
                    COALESCE(NULLIF(TRIM(src.descripcion), ''), NULLIF(TRIM(a.nombre), ''), svm.articulo_numero) as articulo_nombre,
                    COALESCE(svm.codigo_barras, a.codigo_barras) as codigo_barras,
                    COALESCE(NULLIF(TRIM(src.descripcion), ''), NULLIF(TRIM(a.nombre), ''), svm.articulo_numero) as ingrediente_nombre,
                    'receta_up' as tipo_articulo,
                    'stock_ventas_movimientos' as fuente_datos,
                    svm.observaciones
                FROM stock_ventas_movimientos svm
                LEFT JOIN stock_real_consolidado src ON src.articulo_numero = svm.articulo_numero
                LEFT JOIN articulos a ON a.numero = svm.articulo_numero
                LEFT JOIN bunker_articulos ba ON ba.articulo_id = svm.articulo_numero
                WHERE svm.carro_id = $1
                  AND svm.tipo = 'egreso por receta externa'

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
            SELECT fecha_preparado, fecha_confirmacion, usuario_id, fecha_inicio, tipo_carro, linea_negocio, nombre_linea_negocio
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

        // Determinar Línea de Negocio para carros externos (Flujos 4, 5 y 6) e internos (Flujos 2 y 3)
        let lineaNegocio = carro.linea_negocio ? parseInt(carro.linea_negocio, 10) : null;
        let nombreLineaNegocio = carro.nombre_linea_negocio || null;
        let iconoLineaNegocio = tipoCarro === 'externa' ? '🥜' : '🏭';
        let subtituloLineaNegocio = '';
        let articuloPadreCodigo = null;
        let articuloPadreNombre = null;

        if (tipoCarro === 'externa') {
            const artRes = await req.db.query(`
                SELECT ca.articulo_numero, COALESCE(NULLIF(TRIM(src.descripcion), ''), a.nombre, ca.articulo_numero) as nombre
                FROM carros_articulos ca
                LEFT JOIN stock_real_consolidado src ON src.articulo_numero = ca.articulo_numero
                LEFT JOIN articulos a ON a.numero = ca.articulo_numero
                WHERE ca.carro_id = $1
                LIMIT 1
            `, [id]);
            if (artRes.rows.length > 0) {
                articuloPadreCodigo = artRes.rows[0].articulo_numero;
                articuloPadreNombre = artRes.rows[0].nombre;
                // Si aún no tenía linea_negocio definida en BD, la inferimos
                if (!lineaNegocio) {
                    const codeUp = (articuloPadreCodigo || '').toUpperCase();
                    const descUp = (articuloPadreNombre || '').toUpperCase();
                    if (codeUp.startsWith('BF') || descUp.includes('BARRA')) {
                        lineaNegocio = 5;
                    } else if (codeUp.includes('GN') || descUp.includes('GRANA') || descUp.includes('GRANOLA')) {
                        lineaNegocio = 6;
                    } else {
                        lineaNegocio = 4;
                    }
                }
            } else if (!lineaNegocio) {
                lineaNegocio = 4;
            }

            if (lineaNegocio === 5) {
                nombreLineaNegocio = 'Producción de Barritas';
                iconoLineaNegocio = '🍫';
                subtituloLineaNegocio = 'Flujo 5 — Mezcla Interna Previa + UP Externa';
            } else if (lineaNegocio === 6) {
                nombreLineaNegocio = 'Producción de Granolas';
                iconoLineaNegocio = '🥣';
                subtituloLineaNegocio = 'Flujo 6 — Doble Mezcla: Horneado UP + Ensamble Seco Taller';
            } else {
                lineaNegocio = 4;
                nombreLineaNegocio = 'Producción de Tostadero';
                iconoLineaNegocio = '🥜';
                subtituloLineaNegocio = 'Flujo 4 — Bulto Crudo Directo / UP Externa Simple';
            }
        } else {
            // Carro Interno: Línea 3 (Artículos Puente / Mixes a Granel) vs Línea 2 (Fracciones Comerciales)
            if (!lineaNegocio) {
                const artIntRes = await req.db.query(`
                    SELECT 
                        ca.articulo_numero,
                        COALESCE(ba.descripcion_generada, ba.descripcion, ca.descripcion, a.nombre, '') as descripcion,
                        ba.familia_id,
                        EXISTS (
                            SELECT 1 FROM public.recetas r2
                            JOIN public.receta_ingredientes ri2 ON ri2.receta_id = r2.id
                            JOIN public.ingrediente_composicion ic ON ic.mix_id = ri2.ingrediente_id
                            WHERE r2.articulo_numero = ca.articulo_numero
                        ) as tiene_ingrediente_compuesto,
                        EXISTS (
                            SELECT 1 FROM public.recetas r3
                            WHERE r3.articulo_sugerido_numero = ca.articulo_numero
                        ) as es_articulo_sugerido
                    FROM carros_articulos ca
                    LEFT JOIN articulos a ON a.numero = ca.articulo_numero
                    LEFT JOIN bunker_articulos ba ON ba.articulo_id = ca.articulo_numero
                    WHERE ca.carro_id = $1
                    ORDER BY ca.id ASC
                    LIMIT 1
                `, [id]);

                if (artIntRes.rows.length > 0) {
                    const row = artIntRes.rows[0];
                    const descUp = (row.descripcion || '').toUpperCase();
                    if (
                        row.es_articulo_sugerido === true ||
                        row.tiene_ingrediente_compuesto === true ||
                        descUp.includes('PROD AP INTERNO') ||
                        descUp.startsWith('MEZCLA ') ||
                        (Number(row.familia_id) === 42 && !descUp.includes('PROD AP EXT'))
                    ) {
                        lineaNegocio = 3;
                    } else {
                        lineaNegocio = 2;
                    }
                    const nomAuto = lineaNegocio === 3 ? 'Producción de Artículos Puente (Mixes)' : 'Producción de Fracciones';
                    await req.db.query(`
                        UPDATE carros_produccion
                        SET linea_negocio = $1, nombre_linea_negocio = $2
                        WHERE id = $3 AND linea_negocio IS NULL
                    `, [lineaNegocio, nomAuto, id]);
                }
            }

            if (lineaNegocio === 3) {
                nombreLineaNegocio = 'Producción de Artículos Puente (Mixes a Granel x Kilo)';
                iconoLineaNegocio = '🥣';
                subtituloLineaNegocio = '1° Etapa (Línea 3) — Elaboración de Mix con ingredientes de sectores (A/B) → Se almacena como Artículo Puente por kilo';
            } else if (lineaNegocio === 2) {
                nombreLineaNegocio = 'Producción de Fracciones (Envasado Comercial)';
                iconoLineaNegocio = '📦';
                subtituloLineaNegocio = '2° Etapa (Línea 2) — Armado de fracciones (ej: x 2kg, x 5kg) → Se nutre de Ingrediente Simple (abastecido por Artículo Puente o Bulto) + Envase';
            } else {
                nombreLineaNegocio = 'Producción Interna';
                iconoLineaNegocio = '🏭';
                subtituloLineaNegocio = 'Elaboración de mixes a granel (Línea 3) o fraccionado comercial (Línea 2)';
            }
        }

        res.json({
            estado: estado,
            fecha_preparado: carro.fecha_preparado,
            fecha_confirmacion: carro.fecha_confirmacion,
            preparado: preparado,
            confirmado: confirmado,
            tipo_carro: tipoCarro,
            fase_actual: faseActual,
            usuario_id: carro.usuario_id,
            linea_negocio: lineaNegocio,
            nombre_linea_negocio: nombreLineaNegocio,
            icono_linea_negocio: iconoLineaNegocio,
            subtitulo_linea_negocio: subtituloLineaNegocio,
            articulo_padre_codigo: articuloPadreCodigo,
            articulo_padre_nombre: articuloPadreNombre,
            mostrar_artículos_padres: faseActual === 'articulos_padres',
            mostrar_artículos_secundarios: faseActual === 'articulos_secundarios'
        });

    } catch (error) {
        console.error('Error al obtener estado del carro:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

/**
 * Ruta: GET /api/produccion/carro/:id/resumen-externo-finalizado
 * Descripción: Obtiene el resumen consolidado de producción externa asentada para un carro
 */
router.get('/carro/:id/resumen-externo-finalizado', async (req, res) => {
    try {
        const { id } = req.params;

        const query = `
            SELECT 
                h.id,
                h.carro_id,
                h.usuario_id,
                h.kilos_entrada,
                h.kilos_salida,
                h.kilos_producidos,
                h.porcentaje_merma,
                h.ingredientes_sumados,
                h.articulo_padre_id,
                COALESCE(ap.nombre, h.articulo_padre_id) as articulo_padre_nombre,
                h.articulo_fraccionado_id,
                COALESCE(af.nombre, h.articulo_fraccionado_id) as articulo_fraccionado_nombre,
                af.codigo_barras as articulo_fraccionado_codigo_barras,
                h.fecha_registro
            FROM produccion_externa_historial h
            LEFT JOIN articulos ap ON ap.numero = h.articulo_padre_id
            LEFT JOIN articulos af ON af.numero = h.articulo_fraccionado_id
            WHERE h.carro_id = $1
            ORDER BY h.id DESC
            LIMIT 1
        `;

        const result = await req.db.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No se encontró registro de producción externa para este carro' });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error('Error al obtener resumen externo finalizado:', error);
        res.status(500).json({ error: 'Error interno al consultar resumen externo' });
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
        const { ingrediente_id, kilos, carro_id, tipo, observaciones, articulo_numero, articuloNumero } = req.body;

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
        (ingrediente_id, usuario_id, tipo_ajuste, stock_anterior, stock_nuevo, observacion, fecha)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `;

            console.log(`🔄 [DEBUG] Registrando ajuste en tabla ingredientes_ajustes...`);
            console.log(`   - ingrediente_id: ${ingrediente_id}`);
            console.log(`   - usuario_id: ${usuario_id || 'NULL'}`);
            console.log(`   - tipo_ajuste: 'ajuste_puntual'`);
            console.log(`   - stock_anterior: ${stockActualReal}`);
            console.log(`   - stock_nuevo: ${stockNuevo}`);
            console.log(`   - observacion: "${observaciones}"`);

            const insertResult = await client.query(insertAjusteQuery, [
                ingrediente_id,
                usuario_id,
                'ajuste_puntual',
                stockActualReal,
                stockNuevo,
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
                observaciones: observaciones || null,
                articuloNumero: articulo_numero || articuloNumero || null
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

        const { articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes, ingredientes_custom } = req.body;

        console.log('\n📋 CAMPOS EXTRAÍDOS:');
        console.log('- articulo_produccion_codigo:', articulo_produccion_codigo);
        console.log('- articulo_kilo_codigo:', articulo_kilo_codigo);
        console.log('- multiplicador_ingredientes:', multiplicador_ingredientes, typeof multiplicador_ingredientes);
        console.log('- ingredientes_custom:', ingredientes_custom ? `${ingredientes_custom.length} items` : 'No');

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
        const nuevaRelacion = await crearRelacion(articulo_produccion_codigo, articulo_kilo_codigo, multiplicador, ingredientes_custom);

        console.log('✅ RELACIÓN CREADA:', JSON.stringify(nuevaRelacion, null, 2));

        res.status(201).json({
            message: 'Relación creada correctamente',
            relacion: nuevaRelacion
        });
    } catch (error) {
        console.error('❌ Error al crear relación:', error);
        if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.message.includes('Ya existe una relación')) {
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
        const { articulo_kilo_codigo, multiplicador_ingredientes, ingredientes_custom } = req.body;

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
        const relacionActualizada = await actualizarRelacion(relacionId, articulo_kilo_codigo, multiplicador, ingredientes_custom);

        console.log('✅ RELACIÓN ACTUALIZADA:', JSON.stringify(relacionActualizada, null, 2));

        res.json({
            message: 'Relación actualizada correctamente',
            relacion: relacionActualizada
        });
    } catch (error) {
        console.error('❌ Error al actualizar relación:', error);
        if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.message.includes('no encontrada') || error.message.includes('no existe')) {
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
 * Ruta para la Pizarra Inteligente (Resumen operativo en vivo: pedidos activos, armados en 12h y compras en espera)
 * GET /api/produccion/pizarra-resumen
 */
router.get('/pizarra-resumen', async (req, res) => {
    try {
        const pool = req.db || require('../config/database');

        // 1. Pedidos activos para armar (excluyendo presupuestos con compras en espera)
        const activosQuery = `
            SELECT 
                p.id,
                p.id_presupuesto_ext,
                p.id_cliente,
                COALESCE(NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''), NULLIF(TRIM(c.nombre), ''), 'Cliente ' || p.id_cliente) as cliente_nombre,
                p.agente,
                p.secuencia,
                CASE 
                    WHEN p.agente = 'Portal B2B' OR p.modificado_portal = true THEN 'Portal'
                    ELSE 'Presupuestos'
                END as origen
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id::text = p.id_cliente::text
            WHERE p.activo = true
              AND p.estado = 'Presupuesto/Orden'
              AND p.secuencia IN ('Imprimir', 'Imprimir_Modificado', 'Armar_Pedido')
              AND p.id NOT IN (
                  SELECT id_presupuesto_local 
                  FROM public.faltantes_pendientes_compra 
                  WHERE estado = 'En espera'
              )
            ORDER BY p.fecha DESC
        `;
        const activosResult = await pool.query(activosQuery);

        // 2. Pedidos armados/listos en las últimas 12 horas
        const listosQuery = `
            SELECT 
                p.id,
                p.id_presupuesto_ext,
                p.id_cliente,
                COALESCE(NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''), NULLIF(TRIM(c.nombre), ''), 'Cliente ' || p.id_cliente) as cliente_nombre,
                p.secuencia,
                p.fecha_actualizacion
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id::text = p.id_cliente::text
            WHERE p.activo = true
              AND p.secuencia IN ('Pedido_Listo', 'Retira_Deposito', 'Entregado')
              AND p.fecha_actualizacion >= NOW() - INTERVAL '12 hours'
            ORDER BY p.fecha_actualizacion DESC
            LIMIT 15
        `;
        const listosResult = await pool.query(listosQuery);

        // 3. Artículos derivados en espera de compra
        const esperaQuery = `
            SELECT 
                fpc.articulo_numero,
                COALESCE(src.descripcion, a.nombre, fpc.articulo_numero) as descripcion,
                SUM(fpc.cantidad_faltante::numeric) as cantidad_faltante
            FROM public.faltantes_pendientes_compra fpc
            INNER JOIN public.presupuestos p ON p.id = fpc.id_presupuesto_local
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = fpc.articulo_numero
            LEFT JOIN public.articulos a ON (a.numero = fpc.articulo_numero OR a.codigo_barras = fpc.articulo_numero)
            WHERE fpc.estado = 'En espera'
              AND p.estado = 'Presupuesto/Orden'
              AND p.activo = true
            GROUP BY fpc.articulo_numero, src.descripcion, a.nombre
            ORDER BY fpc.articulo_numero
        `;
        const esperaResult = await pool.query(esperaQuery);

        res.json({
            success: true,
            pedidos_activos: activosResult.rows,
            pedidos_armados_12h: listosResult.rows,
            compras_en_espera: esperaResult.rows
        });
    } catch (error) {
        console.error('❌ [PIZARRA-RESUMEN] Error en /pizarra-resumen:', error);
        res.status(500).json({ success: false, error: error.message });
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
 * Ruta para pre-validar impresión (Hard Fallback de Kilos)
 */
router.get('/validar-impresion', async (req, res) => {
    try {
        console.log('🔍 [VALIDAR-IMPRESION] Validando: ', req.query);
        const { cliente_id, presupuesto_id, presupuestos_ext_ids, fecha } = req.query;
        let whereConditions = ["p.activo = true", "REPLACE(LOWER(TRIM(p.estado)), ' ', '') = 'presupuesto/orden'"];
        let params = [];

        if (presupuestos_ext_ids) {
            const idsList = presupuestos_ext_ids.split(',').map(id => id.trim()).filter(Boolean);
            const placeholders = idsList.map((_, i) => `$${params.length + i + 1}`).join(',');
            whereConditions.push(`(p.id_presupuesto_ext IN (${placeholders}) OR p.id::text IN (${placeholders}))`);
            params.push(...idsList);
        } else if (cliente_id) {
            whereConditions.push(`CAST(p.id_cliente AS integer) = $${params.length + 1}`);
            params.push(parseInt(cliente_id));
            if (presupuesto_id) {
                whereConditions.push(`(p.id_presupuesto_ext = $${params.length + 1} OR p.id::text = $${params.length + 1})`);
                params.push(presupuesto_id);
            }
            if (fecha) {
                whereConditions.push(`p.fecha <= $${params.length + 1}`);
                params.push(fecha);
            }
        } else if (fecha) {
            whereConditions.push(`p.fecha::date <= $${params.length + 1}`);
            params.push(fecha);
        } else {
            return res.json({ success: true, requireKilos: false });
        }

        const query = `
            SELECT DISTINCT 
                pd.articulo,
                COALESCE(
                    NULLIF(TRIM(ba.descripcion_generada), ''),
                    NULLIF(TRIM(ba.descripcion), ''),
                    NULLIF(TRIM(a.nombre), ''),
                    pd.articulo
                ) as descripcion
            FROM public.presupuestos p
            JOIN public.presupuestos_detalles pd ON pd.id_presupuesto = p.id
            JOIN public.clientes_perfiles_impresion cpi ON cpi.id_cliente_ext = CAST(p.id_cliente AS text)
            LEFT JOIN public.articulos a ON (a.codigo_barras = pd.articulo OR a.numero = pd.articulo)
            LEFT JOIN public.bunker_articulos ba ON (ba.articulo_id::text = pd.articulo OR ba.codigo_barras::text = pd.articulo OR (a.numero IS NOT NULL AND ba.articulo_id::text = a.numero))
            LEFT JOIN public.stock_real_consolidado src ON (src.codigo_barras = pd.articulo OR src.articulo_numero = pd.articulo OR (a.numero IS NOT NULL AND src.articulo_numero = a.numero))
            WHERE ${whereConditions.join(' AND ')}
              AND TRIM(cpi.perfil_id) = 'PERFIL_PRECIO_KILO'
              AND (src.kilos_unidad IS NULL OR src.kilos_unidad <= 0)
        `;
        
        console.log('🔍 [VALIDAR-IMPRESION] QUERY SQL EXACTA:', { query, params });

        const result = await pool.query(query, params);
        
        console.log('🔍 [VALIDAR-IMPRESION] ROW RESULT:', result.rows);

        if (result.rows.length > 0) {
            console.log('✅ [VALIDAR-IMPRESION] DETECTADOS LOS SIGUIENTES FATALES:', result.rows);
            return res.json({ success: true, requireKilos: true, missing: result.rows });
        }
        console.log('🚫 [VALIDAR-IMPRESION] TODO OK. NO HAY FATALES.');
        res.json({ success: true, requireKilos: false });
    } catch (error) {
        console.error('❌ Error en /validar-impresion:', error);
        res.status(500).json({ success: false, error: error.message });
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
 * Ruta para revertir un pendiente de compra
 */
router.patch('/compras/pendientes/:id/revertir', async (req, res) => {
    try {
        delete require.cache[require.resolve('../controllers/comprasPendientes')];
        const { revertirPendienteCompra } = require('../controllers/comprasPendientes');
        await revertirPendienteCompra(req, res);
    } catch (error) {
        console.error('❌ [COMPRAS] Error en ruta /compras/pendientes/:id/revertir:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de reversión',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Ruta para marcar un pendiente como obsoleto (presupuesto eliminado/modificado)
 */
router.patch('/compras/pendientes/:id/obsoleto', async (req, res) => {
    try {
        const { marcarPendienteObsoleto } = require('../controllers/comprasPendientes');
        await marcarPendienteObsoleto(req, res);
    } catch (error) {
        console.error('❌ [COMPRAS] Error en ruta /compras/pendientes/:id/obsoleto:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de marcado obsoleto',
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

// ==========================================
// RUTAS PARA COMPRAS PENDIENTES
// ==========================================

/**
 * Crear un nuevo pendiente de compra
 * POST /api/produccion/compras/pendientes
 */
router.post('/compras/pendientes', async (req, res) => {
    try {
        console.log('🛒 [COMPRAS] Ruta POST /compras/pendientes');
        await crearPendienteCompra(req, res);
    } catch (error) {
        console.error('❌ [COMPRAS] Error en ruta /compras/pendientes:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de compras pendientes',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Obtener todos los pendientes de compra
 * GET /api/produccion/compras/pendientes
 */
router.get('/compras/pendientes', async (req, res) => {
    try {
        console.log('🛒 [COMPRAS] Ruta GET /compras/pendientes');
        delete require.cache[require.resolve('../controllers/comprasPendientes')];
        const { obtenerPendientesCompra } = require('../controllers/comprasPendientes');
        await obtenerPendientesCompra(req, res);
    } catch (error) {
        console.error('❌ [COMPRAS] Error en ruta /compras/pendientes:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de compras pendientes',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Obtener pendientes agrupados por secuencia
 * GET /api/produccion/compras/pendientes-agrupados
 */
router.get('/compras/pendientes-agrupados', async (req, res) => {
    try {
        console.log('🛒 [COMPRAS] Ruta GET /compras/pendientes-agrupados');
        delete require.cache[require.resolve('../controllers/comprasPendientes')];
        const { obtenerPendientesAgrupados } = require('../controllers/comprasPendientes');
        await obtenerPendientesAgrupados(req, res);
    } catch (error) {
        console.error('❌ [COMPRAS] Error en ruta /compras/pendientes-agrupados:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de pendientes agrupados',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Marcar pendiente como impreso (cambiar secuencia del presupuesto)
 * PATCH /api/produccion/compras/pendientes/presupuesto/:id_presupuesto_local/marcar-impreso
 */
router.patch('/compras/pendientes/presupuesto/:id_presupuesto_local/marcar-impreso', async (req, res) => {
    try {
        console.log('🛒 [COMPRAS] Ruta PATCH /compras/pendientes/presupuesto/:id/marcar-impreso');
        delete require.cache[require.resolve('../controllers/comprasPendientes')];
        const { marcarPendienteImpreso } = require('../controllers/comprasPendientes');
        await marcarPendienteImpreso(req, res);
    } catch (error) {
        console.error('❌ [COMPRAS] Error en ruta /compras/pendientes/presupuesto/:id/marcar-impreso:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de marcar impreso',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Validar que presupuestos existan y estén activos
 * POST /api/produccion/validar-presupuestos
 */
router.post('/validar-presupuestos', async (req, res) => {
    try {
        const { validarPresupuestos } = require('../controllers/comprasPendientes');
        await validarPresupuestos(req, res);
    } catch (error) {
        console.error('❌ [VALIDAR-PRES] Error en ruta /validar-presupuestos:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de validación',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Dividir presupuesto para entrega parcial
 * POST /api/produccion/compras/dividir-presupuesto
 */
router.post('/compras/dividir-presupuesto', async (req, res) => {
    try {
        console.log('✂️ [COMPRAS] Ruta POST /compras/dividir-presupuesto');
        const { dividirPresupuesto } = require('../controllers/comprasPendientes');
        await dividirPresupuesto(req, res);
    } catch (error) {
        console.error('❌ [COMPRAS] Error en ruta /compras/dividir-presupuesto:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de división',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==========================================
// RUTAS PARA SUSTITUCIÓN DE INGREDIENTES
// ==========================================

const {
    obtenerIngredientesConStock,
    sustituirIngrediente
} = require('../controllers/sustitucionIngredientes');

/**
 * Obtener ingredientes con stock disponible para sustitución
 * GET /api/produccion/ingredientes-con-stock?carroId=X
 */
router.get('/ingredientes-con-stock', async (req, res) => {
    try {
        const { carroId } = req.query;

        if (!carroId) {
            return res.status(400).json({ error: 'Se requiere el parámetro carroId' });
        }

        console.log(`🔍 [SUSTITUCION] Obteniendo ingredientes con stock para carro ${carroId}`);
        const ingredientes = await obtenerIngredientesConStock(parseInt(carroId));
        res.json(ingredientes);
    } catch (error) {
        console.error('❌ [SUSTITUCION] Error al obtener ingredientes con stock:', error);
        res.status(500).json({
            error: 'Error al obtener ingredientes con stock',
            detalle: error.message
        });
    }
});

/**
 * Realizar sustitución de ingredientes
 * POST /api/produccion/sustituir-ingrediente
 * Body: { ingredienteOrigenId, ingredienteDestinoId, cantidad, carroId, usuarioId }
 */
router.post('/sustituir-ingrediente', async (req, res) => {
    try {
        const { ingredienteOrigenId, ingredienteDestinoId, cantidad, carroId, usuarioId } = req.body;

        console.log('\n🔄 [SUSTITUCION] Solicitud de sustitución recibida');
        console.log('==========================================');
        console.log('Datos:', {
            ingredienteOrigenId,
            ingredienteDestinoId,
            cantidad,
            carroId,
            usuarioId
        });

        const cantidadNumerica = parseFloat(String(cantidad || '').replace(',', '.'));

        // Validar datos de entrada
        if (!ingredienteOrigenId || !ingredienteDestinoId || isNaN(cantidadNumerica) || !carroId || !usuarioId) {
            return res.status(400).json({
                error: 'Faltan datos requeridos para la sustitución'
            });
        }

        if (cantidadNumerica <= 0) {
            return res.status(400).json({
                error: 'La cantidad debe ser mayor a 0'
            });
        }

        // Realizar la sustitución
        const resultado = await sustituirIngrediente({
            ingredienteOrigenId: parseInt(ingredienteOrigenId),
            ingredienteDestinoId: parseInt(ingredienteDestinoId),
            cantidad: cantidadNumerica,
            carroId: parseInt(carroId),
            usuarioId: parseInt(usuarioId)
        });

        res.json(resultado);
    } catch (error) {
        console.error('❌ [SUSTITUCION] Error al sustituir ingrediente:', error);
        res.status(500).json({
            error: error.message || 'Error al realizar la sustitución',
            detalle: error.message
        });
    }
});

/**
 * Eliminar una sustitución de ingredientes
 * DELETE /api/produccion/sustitucion/:id
 * Body: { carro_id }
 */
router.delete('/sustitucion/:id', async (req, res) => {
    try {
        const movimientoId = parseInt(req.params.id);
        const { carro_id } = req.body;

        console.log('🗑️ [SUSTITUCION] Eliminando sustitución:', { movimientoId, carro_id });

        // Obtener el movimiento de egreso para encontrar su par de ingreso
        const queryMovimiento = `
            SELECT 
                im.id,
                im.ingrediente_id,
                im.kilos,
                im.observaciones
            FROM ingredientes_movimientos im
            WHERE im.id = $1 
              AND im.carro_id = $2
              AND im.tipo = 'egreso'
              AND im.observaciones LIKE 'SUSTITUCIÓN:%'
        `;

        const movimientoResult = await req.db.query(queryMovimiento, [movimientoId, carro_id]);

        if (movimientoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Movimiento de sustitución no encontrado' });
        }

        const movimientoEgreso = movimientoResult.rows[0];

        // Extraer el ID del ingrediente destino de las observaciones
        const match = movimientoEgreso.observaciones.match(/\(ID: (\d+)\)/);
        const ingredienteDestinoId = match ? parseInt(match[1]) : null;

        if (!ingredienteDestinoId) {
            return res.status(400).json({ error: 'No se pudo determinar el ingrediente destino' });
        }

        console.log('🔍 Movimiento de egreso encontrado:', {
            id: movimientoEgreso.id,
            ingrediente_origen_id: movimientoEgreso.ingrediente_id,
            ingrediente_destino_id: ingredienteDestinoId,
            kilos: movimientoEgreso.kilos
        });

        // Buscar el movimiento de ingreso correspondiente
        const queryMovimientoIngreso = `
            SELECT id
            FROM ingredientes_movimientos
            WHERE ingrediente_id = $1
              AND carro_id = $2
              AND tipo = 'ingreso'
              AND ABS(kilos - $3) < 0.01
              AND observaciones LIKE '%SUSTITUCIÓN:%'
              AND fecha >= (SELECT fecha FROM ingredientes_movimientos WHERE id = $4) - INTERVAL '1 minute'
              AND fecha <= (SELECT fecha FROM ingredientes_movimientos WHERE id = $4) + INTERVAL '1 minute'
            ORDER BY fecha ASC
            LIMIT 1
        `;

        const movimientoIngresoResult = await req.db.query(queryMovimientoIngreso, [
            ingredienteDestinoId,
            carro_id,
            Math.abs(movimientoEgreso.kilos),
            movimientoId
        ]);

        if (movimientoIngresoResult.rows.length === 0) {
            return res.status(404).json({ error: 'No se encontró el movimiento de ingreso correspondiente' });
        }

        const movimientoIngresoId = movimientoIngresoResult.rows[0].id;
        console.log('🔍 Movimiento de ingreso encontrado:', movimientoIngresoId);

        // Eliminar ambos movimientos en una transacción
        await req.db.query('BEGIN');

        try {
            // Eliminar movimiento de egreso
            await req.db.query('DELETE FROM ingredientes_movimientos WHERE id = $1', [movimientoId]);
            console.log('✅ Movimiento de egreso eliminado');

            // Eliminar movimiento de ingreso
            await req.db.query('DELETE FROM ingredientes_movimientos WHERE id = $1', [movimientoIngresoId]);
            console.log('✅ Movimiento de ingreso eliminado');

            await req.db.query('COMMIT');
            console.log('✅ Transacción confirmada');

            res.json({
                success: true,
                mensaje: 'Sustitución eliminada correctamente',
                movimientos_eliminados: {
                    egreso: movimientoId,
                    ingreso: movimientoIngresoId
                }
            });

        } catch (error) {
            await req.db.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('❌ [SUSTITUCION] Error al eliminar sustitución:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ENDPOINT: Ajuste Rápido de Stock Reversible CONTEXTUAL
// ==========================================
/**
 * POST /api/produccion/ingredientes/ajuste-rapido
 * Registra un ajuste rápido de stock vinculado a un carro
 * 🎯 CONTEXTUAL: Ajusta stock general O stock de usuario según el tipo de carro
 */
router.post('/ingredientes/ajuste-rapido', async (req, res) => {
    try {
        console.log('\n🔧 [AJUSTE RÁPIDO CONTEXTUAL] Nueva solicitud de ajuste');
        console.log('================================================================');
        console.log('Body recibido:', JSON.stringify(req.body, null, 2));

        const { ingrediente_id, stock_real, carro_id, observaciones, es_stock_usuario, usuario_id, origen_contexto } = req.body;

        // Validaciones
        if (!ingrediente_id || stock_real === undefined) {
            console.log('❌ [AJUSTE] Datos incompletos');
            return res.status(400).json({
                error: 'Faltan datos requeridos: ingrediente_id, stock_real'
            });
        }

        // Validación adicional para stock de usuario
        if (es_stock_usuario && !usuario_id) {
            console.log('❌ [AJUSTE] Falta usuario_id para ajuste de stock personal');
            return res.status(400).json({
                error: 'Se requiere usuario_id para ajustes de stock personal'
            });
        }

        const stockRealNum = parseFloat(stock_real);
        if (isNaN(stockRealNum) || stockRealNum < 0) {
            console.log('❌ [AJUSTE] Stock real inválido:', stock_real);
            return res.status(400).json({
                error: 'El stock real debe ser un número mayor o igual a 0'
            });
        }

        console.log(`🎯 [CONTEXTO] Es stock de usuario: ${es_stock_usuario}`);
        console.log(`🎯 [CONTEXTO] Usuario ID: ${usuario_id || 'N/A'}`);

        // 🎯 BIFURCACIÓN CONTEXTUAL: Stock de usuario vs Stock general
        if (es_stock_usuario && usuario_id) {
            // ==========================================
            // RAMA 1: AJUSTE DE STOCK PERSONAL (Carro Externo)
            // ==========================================
            console.log('\n👤 [STOCK PERSONAL] Procesando ajuste de stock de usuario...');

            // Obtener stock actual del usuario para este ingrediente
            const queryStockUsuario = `
        SELECT COALESCE(SUM(cantidad), 0) as stock_actual
        FROM ingredientes_stock_usuarios
        WHERE usuario_id = $1 AND ingrediente_id = $2
      `;
            const resultStockUsuario = await req.db.query(queryStockUsuario, [usuario_id, ingrediente_id]);
            const stockUsuarioActual = parseFloat(resultStockUsuario.rows[0].stock_actual);

            const diferenciaUsuario = stockRealNum - stockUsuarioActual;

            console.log(`📊 [STOCK PERSONAL] Cálculo:`);
            console.log(`   - Stock Usuario Actual: ${stockUsuarioActual} kg`);
            console.log(`   - Stock Real Deseado: ${stockRealNum} kg`);
            console.log(`   - Diferencia: ${diferenciaUsuario} kg`);

            // Si no hay diferencia significativa, no hacer nada
            if (Math.abs(diferenciaUsuario) < 0.01) {
                console.log('ℹ️ [STOCK PERSONAL] No hay diferencia significativa');
                return res.json({
                    mensaje: 'No se requiere ajuste (diferencia menor a 0.01 kg)',
                    stock_anterior: stockUsuarioActual,
                    stock_nuevo: stockUsuarioActual,
                    diferencia: 0,
                    tipo_ajuste: 'stock_usuario'
                });
            }

            // Registrar movimiento de ajuste en ingredientes_stock_usuarios
            // 🆕 FIX CRÍTICO: Los ajustes manuales al stock personal de domicilio NO deben estar 
            // vinculados a un origen_carro_id, de lo contrario se borrarán si el operario 
            // cierra/elimina el carro desde donde invocó funcionalmente el ajuste.
            const carroIdFinal = null;
            const carroRefId = (carro_id && !isNaN(parseInt(carro_id, 10))) ? parseInt(carro_id, 10) : null;
            const obsBase = observaciones && String(observaciones).trim()
                ? String(observaciones).trim()
                : `Ajuste rápido a ${stockRealNum.toFixed(2)} kg`;
            const observacionesFinal = carroRefId
                ? `${obsBase} (vía carro externo #${carroRefId})`
                : `${obsBase}`;

            const queryAjusteUsuario = `
        INSERT INTO ingredientes_stock_usuarios (
          usuario_id,
          ingrediente_id,
          cantidad,
          origen_carro_id,
          carro_referencia_id,
          fecha_registro,
          origen_mix_id,
          tipo_movimiento,
          observaciones
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NULL, 'ajuste_inventario', $6)
        RETURNING id
      `;

            console.log(`🔍 [DEBUG] Ejecutando INSERT en ingredientes_stock_usuarios...`);
            console.log(`🔍 [DEBUG] Parámetros:`, [usuario_id, ingrediente_id, diferenciaUsuario, carroIdFinal, carroRefId]);

            const resultAjuste = await req.db.query(queryAjusteUsuario, [
                usuario_id,
                ingrediente_id,
                diferenciaUsuario,  // Cantidad con signo (+ o -)
                carroIdFinal,       // Regla dura: SIEMPRE NULL en ajustes
                carroRefId,
                observacionesFinal
            ]);

            console.log(`📝 [STOCK PERSONAL] Observaciones: ${observacionesFinal}`);
            console.log(`📝 [STOCK PERSONAL] Origen contexto: ${origen_contexto || 'no especificado'}`);

            console.log(`✅ [STOCK PERSONAL] Ajuste registrado con ID: ${resultAjuste.rows[0].id}`);
            console.log(`   - Stock anterior: ${stockUsuarioActual} kg`);
            console.log(`   - Stock nuevo: ${stockRealNum} kg`);
            console.log(`   - Diferencia aplicada: ${diferenciaUsuario} kg`);

            // 🔍 VERIFICACIÓN: Consultar el stock después del INSERT
            const verificacionQuery = `
        SELECT COALESCE(SUM(cantidad), 0) as stock_verificado
        FROM ingredientes_stock_usuarios
        WHERE usuario_id = $1 AND ingrediente_id = $2
      `;
            const verificacionResult = await req.db.query(verificacionQuery, [usuario_id, ingrediente_id]);
            const stockVerificado = parseFloat(verificacionResult.rows[0].stock_verificado);

            console.log(`🔍 [VERIFICACIÓN] Stock después del INSERT: ${stockVerificado} kg`);
            console.log(`🔍 [VERIFICACIÓN] ¿Coincide con esperado?: ${Math.abs(stockVerificado - stockRealNum) < 0.01 ? 'SÍ ✅' : 'NO ❌'}`);

            res.json({
                mensaje: 'Ajuste de stock personal procesado correctamente',
                stock_anterior: stockUsuarioActual,
                stock_nuevo: stockRealNum,
                stock_verificado: stockVerificado,
                diferencia: diferenciaUsuario,
                tipo_ajuste: 'stock_usuario',
                movimiento_id: resultAjuste.rows[0].id
            });

        } else {
            // ==========================================
            // RAMA 2: AJUSTE DE STOCK GENERAL (Carro Interno o Inventario General)
            // ==========================================
            console.log('\n🏢 [STOCK GENERAL] Procesando ajuste de stock general...');

            // Obtener stock actual del sistema
            const queryStockActual = `
        SELECT stock_actual 
        FROM ingredientes 
        WHERE id = $1
      `;
            const resultStock = await pool.query(queryStockActual, [ingrediente_id]);

            if (resultStock.rows.length === 0) {
                console.log('❌ [AJUSTE] Ingrediente no encontrado:', ingrediente_id);
                return res.status(404).json({ error: 'Ingrediente no encontrado' });
            }

            const stockSistema = parseFloat(resultStock.rows[0].stock_actual);
            const diferencia = stockRealNum - stockSistema;

            console.log(`📊 [STOCK GENERAL] Cálculo:`);
            console.log(`   - Stock Sistema: ${stockSistema} kg`);
            console.log(`   - Stock Real: ${stockRealNum} kg`);
            console.log(`   - Diferencia: ${diferencia} kg`);

            // Si no hay diferencia significativa, no hacer nada
            if (Math.abs(diferencia) < 0.01) {
                console.log('ℹ️ [STOCK GENERAL] No hay diferencia significativa');
                return res.json({
                    mensaje: 'No se requiere ajuste (diferencia menor a 0.01 kg)',
                    stock_anterior: stockSistema,
                    stock_nuevo: stockSistema,
                    diferencia: 0,
                    tipo_ajuste: 'stock_general'
                });
            }

            // Determinar tipo de movimiento
            const tipoMovimiento = diferencia > 0 ? 'ingreso' : 'egreso';
            const kilosMovimiento = diferencia; // Mantener el signo para el registro

            // Preparar observaciones
            const observacionesFinal = observaciones || `Ajuste rápido - Stock real: ${stockRealNum} kg`;

            console.log(`📝 [STOCK GENERAL] Registrando movimiento:`);
            console.log(`   - Tipo: ${tipoMovimiento}`);
            console.log(`   - Kilos: ${kilosMovimiento}`);
            console.log(`   - Carro ID: ${carro_id}`);

            // Registrar movimiento en ingredientes_movimientos
            const queryMovimiento = `
        INSERT INTO ingredientes_movimientos (
          ingrediente_id,
          kilos,
          tipo,
          carro_id,
          observaciones,
          fecha
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id
      `;

            const resultMovimiento = await pool.query(queryMovimiento, [
                ingrediente_id,
                kilosMovimiento,
                tipoMovimiento,
                carro_id,
                observacionesFinal
            ]);

            console.log(`✅ [STOCK GENERAL] Movimiento registrado con ID: ${resultMovimiento.rows[0].id}`);

            // El trigger actualizar_stock_ingrediente se encargará de actualizar el stock automáticamente

            // Obtener el nuevo stock después del ajuste
            const resultNuevoStock = await pool.query(queryStockActual, [ingrediente_id]);
            const nuevoStock = parseFloat(resultNuevoStock.rows[0].stock_actual);

            console.log(`✅ [STOCK GENERAL] Ajuste completado exitosamente`);
            console.log(`   - Stock anterior: ${stockSistema} kg`);
            console.log(`   - Stock nuevo: ${nuevoStock} kg`);
            console.log('================================================================\n');

            res.json({
                mensaje: 'Ajuste procesado correctamente',
                stock_anterior: stockSistema,
                stock_nuevo: nuevoStock,
                diferencia: diferencia,
                tipo_movimiento: tipoMovimiento,
                tipo_ajuste: 'stock_general',
                movimiento_id: resultMovimiento.rows[0].id
            });
        }

    } catch (error) {
        console.error('❌ [AJUSTE] Error al procesar ajuste rápido:', error);
        res.status(500).json({
            error: 'Error al procesar el ajuste de stock',
            detalles: error.message
        });
    }
});

// ==========================================
// RUTAS PARA INFORME DE PRODUCCIÓN INTERNA
// ==========================================

const {
    obtenerHistorialProduccion,
    obtenerProduccionPorPeriodo,
    obtenerRubrosSubrubros,
    obtenerProduccionMensual,
    obtenerPlanificacionLunes,
    obtenerInformeCompras
} = require('../controllers/informeProduccionInterna');

/**
 * Diagnóstico y Planificación Determinista de Producción y Abastecimiento (Informe del Lunes)
 * GET /api/produccion/informe/planificacion-lunes?dias_demanda=14&dias_objetivo=21
 */
router.get('/informe/planificacion-lunes', async (req, res) => {
    try {
        console.log('📊 [RUTA] GET /informe/planificacion-lunes');
        delete require.cache[require.resolve('../controllers/informeProduccionInterna')];
        const { obtenerPlanificacionLunes } = require('../controllers/informeProduccionInterna');
        await obtenerPlanificacionLunes(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /informe/planificacion-lunes:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de planificación lunes',
            message: error.message
        });
    }
});

/**
 * Informe Especializado para el Área de Compras a Proveedores (Demanda Trimestral -> Proyección 30 Días)
 * GET /api/produccion/informe/compras-proveedores?demanda=90&objetivo=30&solo_faltantes=true
 */
router.get('/informe/compras-proveedores', async (req, res) => {
    try {
        console.log('🛒 [RUTA] GET /informe/compras-proveedores');
        delete require.cache[require.resolve('../controllers/informeProduccionInterna')];
        const { obtenerInformeCompras } = require('../controllers/informeProduccionInterna');
        await obtenerInformeCompras(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /informe/compras-proveedores:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de compras proveedores',
            message: error.message
        });
    }
});


/**
 * Obtener historial completo de producción interna
 * GET /api/produccion/informe/historial
 */
router.get('/informe/historial', async (req, res) => {
    try {
        console.log('📊 [RUTA] GET /informe/historial');
        await obtenerHistorialProduccion(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /informe/historial:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de historial',
            message: error.message
        });
    }
});

/**
 * Obtener producción filtrada por periodo
 * GET /api/produccion/informe/periodo?fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD
 */
router.get('/informe/periodo', async (req, res) => {
    try {
        console.log('📊 [RUTA] GET /informe/periodo');
        await obtenerProduccionPorPeriodo(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /informe/periodo:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de periodo',
            message: error.message
        });
    }
});

/**
 * Obtener jerarquía de Rubros y Subrubros
 * GET /api/produccion/informe/rubros
 */
router.get('/informe/rubros', async (req, res) => {
    try {
        console.log('📊 [RUTA] GET /informe/rubros');
        await obtenerRubrosSubrubros(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /informe/rubros:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de rubros',
            message: error.message
        });
    }
});

/**
 * Obtener producción agrupada por mes
 * GET /api/produccion/informe/mensual
 */
router.get('/informe/mensual', async (req, res) => {
    try {
        console.log('📊 [RUTA] GET /informe/mensual');
        await obtenerProduccionMensual(req, res);
    } catch (error) {
        console.error('❌ [RUTA] Error en /informe/mensual:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en ruta de producción mensual',
            message: error.message
        });
    }
});

/**
 * Obtiene el perfil de impresión asignado al cliente.
 * GET /api/produccion/clientes/:id/perfil-impresion
 */
router.get('/clientes/:id/perfil-impresion', async (req, res) => {
    try {
        const id_cliente_ext = req.params.id;
        
        const query = `
            SELECT perfil_id 
            FROM clientes_perfiles_impresion 
            WHERE id_cliente_ext = $1
        `;
        
        const result = await pool.query(query, [id_cliente_ext]);
        
        if (result.rows.length > 0) {
            res.json({ success: true, perfil_id: result.rows[0].perfil_id });
        } else {
            // Devuelve DEFAULT si no hay asignación
            res.json({ success: true, perfil_id: 'DEFAULT' });
        }
    } catch (error) {
        console.error(`[API] Error obteniendo perfil de cliente ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

/**
 * Asigna y persiste el perfil de impresión seleccionado por el cliente.
 * POST /api/produccion/clientes/:id/perfil-impresion
 */
router.post('/clientes/:id/perfil-impresion', async (req, res) => {
    try {
        const id_cliente_ext = req.params.id;
        const { perfil_id } = req.body;
        
        console.log(`[API] Guardando perfil dinámico ${perfil_id} para cliente ${id_cliente_ext}`);
        
        if (!id_cliente_ext || !perfil_id) {
            return res.status(400).json({ success: false, error: 'Faltan parámetros id o perfil_id.' });
        }
        
        const upsertQuery = `
            INSERT INTO clientes_perfiles_impresion (id_cliente_ext, perfil_id)
            VALUES ($1, $2)
            ON CONFLICT (id_cliente_ext) 
            DO UPDATE SET perfil_id = $2, updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;
        
        const result = await pool.query(upsertQuery, [id_cliente_ext, perfil_id]);
        
        res.json({
            success: true,
            message: 'Perfil de impresión guardado con éxito',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ [API] Fallo al inyectar perfil dinámico:', error);
        res.status(500).json({
            success: false,
            error: 'Incapacidad de resolver la base de datos externa para perfiles',
            message: error.message
        });
    }
});

/**
 * Obtiene determinísticamente los artículos de depósito habilitados para abastecer
 * un ingrediente específico en domicilio (ej: Miel -> solo presentaciones de Miel;
 * Aceite de Coco -> solo presentaciones de Aceite de Coco), excluyendo productos
 * secundarios saborizados o compuestos (ej: Maíz Frito Mostaza y Miel).
 * GET /api/produccion/ingredientes/:id/articulos-abastecimiento
 */
router.get('/ingredientes/:id/articulos-abastecimiento', async (req, res) => {
    try {
        const ingredienteId = parseInt(req.params.id, 10);
        if (!ingredienteId || isNaN(ingredienteId)) {
            return res.status(400).json({ error: 'ID de ingrediente inválido' });
        }

        const normalizarTexto = (txt) =>
            String(txt || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .trim();

        const { rows: [ing] } = await pool.query(
            'SELECT id, codigo, nombre, unidad_medida, articulo_vinculado_numero FROM public.ingredientes WHERE id = $1',
            [ingredienteId]
        );

        if (!ing) {
            return res.status(404).json({ error: 'Ingrediente no encontrado' });
        }

        const usuarioIdQuery = req.query.usuario_id ? parseInt(req.query.usuario_id, 10) : null;
        let saldoPersonalActual = null;
        if (usuarioIdQuery && !isNaN(usuarioIdQuery)) {
            const { rows: saldoRows } = await pool.query(
                'SELECT COALESCE(ROUND(SUM(cantidad)::numeric, 4), 0) AS saldo FROM public.ingredientes_stock_usuarios WHERE usuario_id = $1 AND ingrediente_id = $2',
                [usuarioIdQuery, ingredienteId]
            );
            saldoPersonalActual = parseFloat(saldoRows[0]?.saldo || 0);
        }

        // Referencia canónica en Búnker (por artículo vinculado directo o nutriente activo)
        const { rows: refRows } = await pool.query(`
            SELECT
                ba.familia_id,
                LOWER(BTRIM(COALESCE(ba.propiedades_dinamicas->>'articulo_principal', ''))) AS art_principal,
                LOWER(BTRIM(COALESCE(ba.propiedades_dinamicas->'posiciones'->'pos_1'->>'valor', ''))) AS pos_1
            FROM public.bunker_articulos ba
            WHERE ba.familia_id IS NOT NULL
              AND (
                  UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(COALESCE($2, '')))
                  OR EXISTS (
                      SELECT 1 FROM public.ingrediente_articulos_nutrientes ian
                      WHERE ian.ingrediente_id = $1
                        AND COALESCE(ian.activo, true) = true
                        AND UPPER(BTRIM(ian.articulo_numero)) = UPPER(BTRIM(ba.articulo_id))
                  )
              )
            ORDER BY CASE WHEN UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(COALESCE($2, ''))) THEN 0 ELSE 1 END
            LIMIT 1
        `, [ingredienteId, ing.articulo_vinculado_numero || '']);

        const refBunker = refRows[0] || null;
        const ingNombreNorm = normalizarTexto(ing.nombre).replace(/\s*\((simple|mix)\)\s*$/i, '').trim();
        const refPos1Norm = refBunker ? normalizarTexto(refBunker.pos_1) : '';
        const exigirPos1 = Boolean(refBunker && refPos1Norm && ingNombreNorm.includes(refPos1Norm));

        const { rows: allCandidates } = await pool.query(`
            SELECT
                a.numero,
                COALESCE(NULLIF(BTRIM(ba.descripcion_generada), ''), NULLIF(BTRIM(ba.descripcion), ''), a.nombre) AS nombre,
                a.nombre AS nombre_legacy,
                a.codigo_barras,
                ba.familia_id,
                LOWER(BTRIM(COALESCE(ba.propiedades_dinamicas->>'articulo_principal', ''))) AS art_principal,
                LOWER(BTRIM(COALESCE(ba.propiedades_dinamicas->'posiciones'->'pos_1'->>'valor', ''))) AS pos_1,
                COALESCE(src.stock_consolidado, 0) AS stock_consolidado,
                COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0)) AS kilos_unidad,
                COALESCE(ba.es_pack, src.es_pack, false) AS es_pack,
                (UPPER(BTRIM(a.numero)) = UPPER(BTRIM(COALESCE($2, '')))) AS es_vinculado_directo,
                (
                    UPPER(BTRIM(a.numero)) = UPPER(BTRIM(COALESCE($2, '')))
                    OR EXISTS (
                        SELECT 1 FROM public.ingrediente_articulos_nutrientes ian
                        WHERE ian.ingrediente_id = $1
                          AND COALESCE(ian.activo, true) = true
                          AND UPPER(BTRIM(ian.articulo_numero)) = UPPER(BTRIM(a.numero))
                    )
                    OR EXISTS (
                        SELECT 1 FROM public.ingrediente_bunker_articulos iba
                        WHERE iba.ingrediente_id = $1
                          AND UPPER(BTRIM(iba.bunker_articulo_id::text)) = UPPER(BTRIM(a.numero))
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM public.recetas r
                        JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                        WHERE UPPER(BTRIM(r.articulo_numero)) = UPPER(BTRIM(a.numero))
                          AND ri.ingrediente_id = $1
                          AND NOT EXISTS (
                              SELECT 1
                              FROM public.receta_ingredientes ri_otro
                              JOIN public.ingredientes i_otro ON i_otro.id = ri_otro.ingrediente_id
                              WHERE ri_otro.receta_id = r.id
                                AND ri_otro.ingrediente_id <> $1
                                AND COALESCE(i_otro.es_insumo, false) = false
                          )
                    )
                ) AS vinculo_explicito
            FROM public.articulos a
            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = a.numero
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = a.numero
            WHERE COALESCE(src.solo_produccion_externa, false) = false
        `, [ingredienteId, ing.articulo_vinculado_numero || '']);

        const stopwords = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'en', 'con', 'sin', 'por', 'para', 'y', 'o', 'a', 'x', 'simple', 'mix']);
        const tokensIng = ingNombreNorm
            .split(/[^a-z0-9]+/)
            .filter(t => t.length >= 2 && !stopwords.has(t));
        const stemsIng = tokensIng.map(t => (t.length >= 6 ? t.slice(0, 5) : t));
        const primerStem = stemsIng[0] || '';

        const filtrados = allCandidates.filter(art => {
            if (art.vinculo_explicito) return true;

            if (art.familia_id != null) {
                if (refBunker && refBunker.familia_id != null && refBunker.art_principal) {
                    if (Number(art.familia_id) !== Number(refBunker.familia_id)) return false;
                    if (normalizarTexto(art.art_principal) !== normalizarTexto(refBunker.art_principal)) return false;
                    if (exigirPos1) {
                        return normalizarTexto(art.pos_1) === refPos1Norm;
                    }
                    return true;
                }
                const apNorm = normalizarTexto(art.art_principal);
                const nomNorm = normalizarTexto(art.nombre);
                if (!primerStem || !apNorm.startsWith(primerStem)) return false;
                return stemsIng.every(st => nomNorm.includes(st));
            }

            const legacyNorm = normalizarTexto(art.nombre_legacy || art.nombre);
            if (!primerStem || !legacyNorm.startsWith(primerStem)) return false;
            return stemsIng.every(st => legacyNorm.includes(st));
        });

        const esPackComercial = (art) =>
            Boolean(art.es_pack) || /\b\d+\s*x\s*\d+/i.test(String(art.nombre || ''));

        const esBultoInsumoIndustrial = (art) => {
            if (esPackComercial(art)) return false;
            const skuUpper = String(art.numero || '').trim().toUpperCase();
            const nomLower = normalizarTexto(art.nombre || '');
            const kg = parseFloat(art.kilos_unidad) || 0;
            return (
                skuUpper.startsWith('EMB-') ||
                /\b(bidon|balde|tambor|bulto|bolsa|caja)\b/.test(nomLower) ||
                kg >= 2
            );
        };

        const filtradosConMeta = filtrados.map(art => ({
            ...art,
            es_pack_comercial: esPackComercial(art),
            es_bulto_insumo: esBultoInsumoIndustrial(art)
        }));

        filtradosConMeta.sort((a, b) => {
            const stkA = parseFloat(a.stock_consolidado) > 0 ? 1 : 0;
            const stkB = parseFloat(b.stock_consolidado) > 0 ? 1 : 0;
            if (stkA !== stkB) return stkB - stkA;

            // Priorizar bultos/envases industriales unitarios (ej. EMB-P2VF21 Bidón 5kg) sobre packs comerciales multi-frasco (6x1kg, 12x500g) o frascos chicos (400g)
            if (a.es_bulto_insumo !== b.es_bulto_insumo) return a.es_bulto_insumo ? -1 : 1;

            if (a.vinculo_explicito !== b.vinculo_explicito) return a.vinculo_explicito ? -1 : 1;

            if (a.es_pack_comercial !== b.es_pack_comercial) return a.es_pack_comercial ? 1 : -1;

            const kgA = parseFloat(a.kilos_unidad) || 0;
            const kgB = parseFloat(b.kilos_unidad) || 0;
            if (Math.abs(kgB - kgA) > 0.001) return kgB - kgA;

            return String(a.nombre || '').localeCompare(String(b.nombre || ''));
        });

        res.json({
            success: true,
            ingrediente: {
                id: ing.id,
                codigo: ing.codigo,
                nombre: ing.nombre,
                unidad_medida: ing.unidad_medida,
                saldo_personal_actual: saldoPersonalActual
            },
            data: filtradosConMeta
        });
    } catch (error) {
        console.error('❌ [ABASTECIMIENTO EXTERNO] Error consultando artículos del ingrediente:', error);
        res.status(500).json({ error: 'No se pudieron obtener las presentaciones del ingrediente' });
    }
});

/**
 * Abastecimiento Atómico de Domicilio
 * Retira un artículo de ventas y lo transfiere a ingredientes_stock_usuarios
 * POST /api/produccion/ingredientes/abastecer-stock-personal
 */
const abastecimientoInFlightSet = new Set();
const abastecimientoRequestIdMap = new Map();
const abastecimientoRecienteMap = new Map();

function limpiarCachesGuardiaAbastecimiento(now) {
    for (const [k, ts] of abastecimientoRequestIdMap.entries()) {
        if (now - ts > 120000) abastecimientoRequestIdMap.delete(k);
    }
    for (const [k, ts] of abastecimientoRecienteMap.entries()) {
        if (now - ts > 60000) abastecimientoRecienteMap.delete(k);
    }
}

router.post('/ingredientes/abastecer-stock-personal', async (req, res) => {
    const { articulo_numero, cantidad, ingrediente_id, usuario_id, carro_id, request_id, confirmar_repetido } = req.body || {};

    if (!articulo_numero || !cantidad || !ingrediente_id || !usuario_id) {
        return res.status(400).json({ error: 'Faltan parámetros obligatorios para el abastecimiento atómico' });
    }

    const cantNum = parseFloat(cantidad);
    const usuarioIdNum = parseInt(usuario_id, 10);
    const ingredienteIdNum = parseInt(ingrediente_id, 10);
    const artNorm = String(articulo_numero).trim().toUpperCase();

    if (isNaN(cantNum) || cantNum <= 0 || isNaN(usuarioIdNum) || isNaN(ingredienteIdNum)) {
        return res.status(400).json({ error: 'Parámetros numéricos inválidos en el abastecimiento' });
    }

    const nowTs = Date.now();
    limpiarCachesGuardiaAbastecimiento(nowTs);

    const reqIdNorm = request_id ? String(request_id).trim() : '';
    if (reqIdNorm && abastecimientoRequestIdMap.has(reqIdNorm)) {
        return res.status(409).json({
            codigo: 'REQUEST_DUPLICADO',
            error: 'Este retiro ya fue procesado recientemente (doble envío bloqueado).'
        });
    }

    const inFlightKey = `${usuarioIdNum}:${ingredienteIdNum}:${artNorm}`;
    if (abastecimientoInFlightSet.has(inFlightKey)) {
        return res.status(409).json({
            codigo: 'EN_PROCESO',
            error: 'Ya hay un retiro en curso para este ingrediente; aguardá unos segundos.'
        });
    }

    const dupSignature = `${usuarioIdNum}:${ingredienteIdNum}:${artNorm}:${cantNum.toFixed(4)}`;
    const ultimoTs = abastecimientoRecienteMap.get(dupSignature);
    if (!confirmar_repetido && ultimoTs && (nowTs - ultimoTs) < 20000) {
        const segHace = Math.max(1, Math.round((nowTs - ultimoTs) / 1000));
        return res.status(409).json({
            codigo: 'POSIBLE_DUPLICADO_RECIENTE',
            error: `Hace ${segHace}s ya se acreditó un retiro idéntico (${cantNum} u. de [${articulo_numero}]).`
        });
    }

    abastecimientoInFlightSet.add(inFlightKey);
    try {
        console.log(`\n🚚 [ABASTECIMIENTO EXTERNO] Solicitud de Usuario ${usuario_id}`);
        console.log(` > Retirando ${cantidad} unidades del Articulo: ${articulo_numero}`);
        console.log(` > Destino: Ingrediente ${ingrediente_id}`);
        if (carro_id) console.log(` > Vinculado a Carro ID: ${carro_id}`);

        // 1. Obtener los kilos por unidad del artículo seleccionado (priorizando Búnker y stock_real_consolidado)
        const checkArtQuery = `
            SELECT
                COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0)) AS kilos_unidad,
                COALESCE(NULLIF(BTRIM(ba.descripcion_generada), ''), NULLIF(BTRIM(ba.descripcion), ''), NULLIF(BTRIM(src.descripcion), ''), a.nombre) AS descripcion,
                a.codigo_barras
            FROM public.articulos a
            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = a.numero
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = a.numero
            WHERE a.numero = $1
            LIMIT 1
        `;
        const arts = await pool.query(checkArtQuery, [articulo_numero]);
        
        let kilosUnidad = 1; // Default de emergencia
        let nombreArt = 'Desconocido';
        let codigoBarrasArt = null;
        
        if (arts.rows.length > 0) {
            if (arts.rows[0].kilos_unidad) kilosUnidad = parseFloat(arts.rows[0].kilos_unidad);
            if (arts.rows[0].descripcion) nombreArt = arts.rows[0].descripcion;
            if (arts.rows[0].codigo_barras) codigoBarrasArt = arts.rows[0].codigo_barras;
        }

        const kilosTotales = parseFloat(cantidad) * kilosUnidad;
        console.log(` ⚖️ Conversión: ${cantidad} un * ${kilosUnidad} kg/un = ${kilosTotales.toFixed(2)} kg`);

        let carroIdValido = null;
        if (carro_id && !isNaN(parseInt(carro_id, 10))) {
            const chkCarro = await pool.query('SELECT id FROM public.carros_produccion WHERE id = $1 LIMIT 1', [parseInt(carro_id, 10)]);
            if (chkCarro.rows.length > 0) {
                carroIdValido = chkCarro.rows[0].id;
            }
        }

        // INICIO DE LA TRANSACCIÓN
        const client = await pool.connect();
        await client.query('BEGIN');

        try {
            // A) Declarar la BAJA de `stock_ventas_movimientos` (desacoplado de carro_id para que borrar un borrador no revierta retiros reales a domicilio)
            const obsAbastecimiento = `Retiro abastecimiento domicilio: ${cantNum} u. de [${articulo_numero}] ${nombreArt} (${kilosTotales.toFixed(2)} kg)${carroIdValido ? ` [ref carro #${carroIdValido}]` : ''}`;
            const outQuery = `
                INSERT INTO stock_ventas_movimientos (
                    articulo_numero, codigo_barras, kilos, carro_id, usuario_id, cantidad, tipo, origen_ingreso, observaciones, fecha
                ) VALUES ($1, $2, $3, NULL, $4, $5, 'egreso', 'abastecimiento_domicilio', $6, NOW())
                RETURNING id;
            `;
            await client.query(outQuery, [
                articulo_numero, 
                codigoBarrasArt,
                kilosTotales, 
                parseInt(usuario_id, 10), 
                parseFloat(cantidad),
                obsAbastecimiento
            ]);

            // A.2) Descontar la cantidad directamente del stock_movimientos consolidado
            const updateConsolidado = `
                INSERT INTO stock_real_consolidado (articulo_numero, stock_movimientos, ultima_actualizacion)
                VALUES ($2::text, -($1::numeric), NOW())
                ON CONFLICT (articulo_numero)
                DO UPDATE SET 
                  stock_movimientos = COALESCE(stock_real_consolidado.stock_movimientos, 0) - ($1::numeric),
                  ultima_actualizacion = NOW()
            `;
            await client.query(updateConsolidado, [
                parseFloat(cantidad),
                String(articulo_numero)
            ]);

            // A.3) Recalcular stock_consolidado usando la herramienta unificada
            const { recalcularStockConsolidado } = require('../utils/recalcularStock');
            await recalcularStockConsolidado(client, articulo_numero);

            // B.0) Consultar saldo domiciliario anterior para devolver desglose matemático exacto
            const prevSaldoRes = await client.query(
                'SELECT COALESCE(ROUND(SUM(cantidad)::numeric, 4), 0) AS saldo_anterior FROM public.ingredientes_stock_usuarios WHERE usuario_id = $1::int AND ingrediente_id = $2::int',
                [usuarioIdNum, ingredienteIdNum]
            );
            const saldoAnterior = parseFloat(prevSaldoRes.rows[0]?.saldo_anterior || 0);

            // B) Declarar el ALTA de stock personal en el domicilio para ese operario
            // Regla dura: origen_carro_id = NULL siempre en ingresos; carro_referencia_id guarda el carro solo como metadato informativo
            const inQuery = `
                INSERT INTO ingredientes_stock_usuarios (
                    usuario_id, ingrediente_id, cantidad, origen_carro_id, carro_referencia_id, fecha_registro, origen_mix_id, contexto_envase, tipo_movimiento, articulo_origen_numero, observaciones
                ) VALUES ($1, $2, $3, NULL, $4, NOW(), NULL, $5, 'abastecimiento_deposito', $6, $7)
                RETURNING id;
            `;
            await client.query(inQuery, [
                usuarioIdNum,
                ingredienteIdNum,
                kilosTotales,
                carroIdValido,
                kilosUnidad,
                String(articulo_numero),
                obsAbastecimiento
            ]);

            const postSaldoRes = await client.query(
                'SELECT COALESCE(ROUND(SUM(cantidad)::numeric, 4), 0) AS saldo_actual FROM public.ingredientes_stock_usuarios WHERE usuario_id = $1::int AND ingrediente_id = $2::int',
                [usuarioIdNum, ingredienteIdNum]
            );
            const saldoActual = parseFloat(postSaldoRes.rows[0]?.saldo_actual || 0);

            // C) Auto-vincular de forma permanente el ingrediente al artículo de compras SOLO si no posee vínculo previo
            await client.query(`
                UPDATE public.ingredientes
                SET articulo_vinculado_numero = $1::text
                WHERE id = $2::int
                  AND NULLIF(BTRIM(COALESCE(articulo_vinculado_numero, '')), '') IS NULL
            `, [String(articulo_numero), parseInt(ingrediente_id, 10)]);

            // C.2) Registrar relación nutriente idempotente para trazabilidad futura
            await client.query(`
                INSERT INTO public.ingrediente_articulos_nutrientes (ingrediente_id, articulo_numero, activo, manual)
                SELECT $1::int, $2::text, true, true
                WHERE NOT EXISTS (
                    SELECT 1 FROM public.ingrediente_articulos_nutrientes
                    WHERE ingrediente_id = $1::int AND UPPER(BTRIM(articulo_numero)) = UPPER(BTRIM($2::text))
                )
            `, [parseInt(ingrediente_id, 10), String(articulo_numero)]);

            await client.query('COMMIT');
            client.release();

            const commitTs = Date.now();
            if (reqIdNorm) abastecimientoRequestIdMap.set(reqIdNorm, commitTs);
            abastecimientoRecienteMap.set(dupSignature, commitTs);
            
            console.log(`✅ [ABASTECIMIENTO EXTERNO] Transacción Atómica Exitosa (Saldo: ${saldoAnterior.toFixed(2)} -> ${saldoActual.toFixed(2)}).`);
            res.json({
                success: true,
                articulo_numero: String(articulo_numero),
                articulo_descripcion: nombreArt,
                cantidad_envases: cantNum,
                kilos_unidad: kilosUnidad,
                kilos_acreditados: Number(kilosTotales.toFixed(4)),
                saldo_anterior: saldoAnterior,
                saldo_actual: saldoActual
            });
            
        } catch (trxError) {
            await client.query('ROLLBACK');
            client.release();
            console.error('❌ [ABASTECIMIENTO EXTERNO] Falló la transacción SQL:', trxError);
            throw trxError;
        }

    } catch (error) {
        console.error('❌ [ABASTECIMIENTO EXTERNO] Error general:', error);
        res.status(500).json({ error: 'Hubo un problema al procesar el mandato de abastecimiento' });
    } finally {
        abastecimientoInFlightSet.delete(inFlightKey);
    }
});


// ==========================================
// MÓDULO DE AJUSTE PUNTUAL DE STOCK FÍSICO
// ==========================================
router.post('/ingredientes/ajustar-stock', async (req, res) => {
    const vistaHdr = String(req.headers['x-lamda-vista'] || req.body?.vista_origen || '').toLowerCase();
    if (vistaHdr.startsWith('usuario') || req.body?.es_stock_usuario === true) {
        return res.status(409).json({
            error: 'Operación bloqueada: el Ajuste Puntual masivo es exclusivo del Depósito Central LAMDA. Para un colaborador usá "Gestionar Stock" sobre su tarjeta.'
        });
    }
    const { usuario_id, ajustes } = req.body;
    
    if (!usuario_id || !ajustes || !Array.isArray(ajustes) || ajustes.length === 0) {
        return res.status(400).json({ error: 'Datos incompletos para el ajuste.' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        for (const ajuste of ajustes) {
            const { ingrediente_id, nuevo_stock, observacion } = ajuste;
            
            // 1. Obtener y bloquear la fila actual
            const resultActual = await client.query('SELECT stock_actual FROM ingredientes WHERE id = $1 FOR UPDATE', [ingrediente_id]);
            if (resultActual.rows.length === 0) {
                throw new Error(`El ingrediente ID ${ingrediente_id} no existe.`);
            }
            
            const stockAnterior = parseFloat(resultActual.rows[0].stock_actual);
            const diferencia = parseFloat(nuevo_stock) - stockAnterior;
            
            // 2. Configurar el vector de movimiento (el Trigger hará el update)
            const tipoMovimiento = diferencia >= 0 ? 'ingreso' : 'egreso';
            
            // 3. Registrar auditoría innegociable en ingredientes_ajustes (excluyendo "diferencia" que es GENERATED ALWAYS)
            await client.query(
                `INSERT INTO ingredientes_ajustes 
                (fecha, ingrediente_id, usuario_id, stock_anterior, stock_nuevo, tipo_ajuste, observacion) 
                VALUES (NOW(), $1, $2, $3, $4, $5, $6)`,
                [ingrediente_id, usuario_id, stockAnterior, nuevo_stock, 'ajuste_puntual', observacion || 'Ajuste Manual']
            );
            
            // 4. Registrar en movimientos (dispara Trigger de actualización de stock físico)
            await client.query(
                `INSERT INTO ingredientes_movimientos 
                (fecha, ingrediente_id, kilos, tipo, observaciones, stock_anterior) 
                VALUES (NOW(), $1, $2, $3, $4, $5)`,
                [ingrediente_id, diferencia, tipoMovimiento, observacion || 'Ajuste Manual', stockAnterior]
            );
        }
        
        await client.query('COMMIT');
        res.json({ message: 'Ajustes impactados correctamente', registros: ajustes.length });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error detallado en POST /ingredientes/ajustar-stock:', e);
        res.status(500).json({ error: 'Error transaccional: ' + e.message });
    } finally {
        client.release();
    }
});


// Ruta para eliminar una categoría
router.delete('/categorias/:id', async (req, res) => {
    try {
        const { eliminarCategoria } = require('../controllers/ingredientes');
        const resultado = await eliminarCategoria(req.params.id);
        res.json(resultado);
    } catch (error) {
        console.error('❌ [CATEGORIAS] Error en DELETE /categorias/:id:', error);
        let statusCode = 500;
        if (error.message.includes('No se puede eliminar')) {
            statusCode = 400;
        } else if (error.message.includes('no encontrada')) {
            statusCode = 404;
        }
        res.status(statusCode).json({ error: error.message });
    }
});

// =========================================================================
// MÓDULO DE SIMULACIÓN DE PRECIOS Y COSTOS
// =========================================================================

/**
 * GET /api/produccion/simulacion/inicializar
 * Consolida en un único payload JSON los catálogos y tablas de PostgreSQL local para simulación.
 */
router.get('/simulacion/inicializar', async (req, res) => {
    try {
        const db = req.db || pool;
        const [
            ingredientes,
            composicionMix,
            recetas,
            recetaIngredientes,
            recetaArticulos,
            articulosBunker,
            listasPrecios,
            articulosListas,
            insumosListas,
            lotes,
            familiasBunker,
            articulosProduccionExternaRelacion,
            tarifasRendimiento,
            mermasHistorial,
            conciliacionesRecientes,
            combosComponentes
        ] = await Promise.all([
            obtenerIngredientes(),
            db.query(`SELECT mix_id, ingrediente_id, cantidad FROM public.ingrediente_composicion`),
            db.query(`SELECT id, articulo_numero, descripcion, enlazado_externo FROM public.recetas`),
            db.query(`SELECT receta_id, ingrediente_id, cantidad, fase_produccion FROM public.receta_ingredientes`),
            db.query(`SELECT receta_id, articulo_numero, cantidad FROM public.receta_articulos`),
            db.query(`
                WITH reservas_crudas AS (
                  SELECT
                    COALESCE(src_res.articulo_numero, ba_res.articulo_id, a_res.numero, pd.articulo) AS articulo_numero,
                    SUM(pd.cantidad) AS cantidad_reservada
                  FROM public.presupuestos_detalles pd
                  JOIN public.presupuestos p ON p.id = pd.id_presupuesto
                  LEFT JOIN public.stock_real_consolidado src_res ON (src_res.articulo_numero = pd.articulo OR src_res.codigo_barras = pd.articulo)
                  LEFT JOIN public.bunker_articulos ba_res ON (ba_res.articulo_id = pd.articulo OR ba_res.codigo_barras = pd.articulo)
                  LEFT JOIN public.articulos a_res ON (a_res.numero = pd.articulo OR a_res.codigo_barras = pd.articulo)
                  WHERE p.activo = true
                    AND COALESCE(p.archivado, false) = false
                    AND COALESCE(p.tipo_comprobante, '') != 'Orden de Retiro'
                    AND COALESCE(p.estado, '') NOT IN ('Anulado', 'Anulado por el Cliente', 'ANULADO', 'Facturado', 'Entregado', 'Conciliado', 'Retirado', 'Recibido', 'Administrativa NC', 'Muestra de Fraccionados', 'Orden de Retiro')
                    AND COALESCE(p.secuencia, 'Imprimir') NOT IN ('Entregado', 'Finalizado', 'Cancelado')
                    AND COALESCE(p.estado_logistico, '') NOT IN ('ENTREGADO', 'ENTREGADO_DEPOSITO')
                    AND p.factura_id IS NULL
                    AND p.id_factura_lomasoft IS NULL
                    AND (p.comprobante_lomasoft IS NULL OR p.comprobante_lomasoft = '')
                  GROUP BY COALESCE(src_res.articulo_numero, ba_res.articulo_id, a_res.numero, pd.articulo)
                )
                SELECT 
                    ba.articulo_id, 
                    ba.descripcion, 
                    ba.descripcion_generada, 
                    ba.costo_base, 
                    ba.updated_at AS costo_updated_at,
                    ba.porcentaje_iva, 
                    ba.kilos_unidad, 
                    ba.pack_hijo_codigo,
                    ba.pack_unidades,
                    ba.es_pack,
                    COALESCE(ba.es_combo, false) AS es_combo,
                    ba.firma_combo,
                    COALESCE(ba.no_producido_por_lambda, false) AS no_producido_por_lambda,
                    COALESCE(src.no_producido_por_lambda, false) AS src_no_producido_por_lambda,
                    COALESCE(src.solo_produccion_externa, false) AS solo_produccion_externa,
                    ba.familia_id,
                    ba.propiedades_dinamicas,
                    ba.rubro,
                    ba.sub_rubro,
                    f.nombre AS familia_nombre,
                    art.nombre as nombre_lomasoft,
                    -- Stock Físico (Consolidado)
                    CASE
                      WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL)
                           AND COALESCE(ba.pack_unidades, 1) > 1
                      THEN
                        COALESCE(src.stock_consolidado, 0) + FLOOR(COALESCE(src_hijo.stock_consolidado, 0) / COALESCE(ba.pack_unidades, 1))
                      ELSE
                        COALESCE(src.stock_consolidado, 0)
                    END AS stock_fisico,
                    -- Stock Reservado (en pedidos activos)
                    CASE
                      WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL)
                           AND COALESCE(ba.pack_unidades, 1) > 1
                      THEN
                        COALESCE(res_art.cantidad_reservada, 0) + CEIL(COALESCE(res_hijo.cantidad_reservada, 0) / COALESCE(ba.pack_unidades, 1)::numeric)
                      ELSE
                        COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)
                    END AS stock_reservado,
                    -- Stock Disponible Real
                    CASE
                      WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL)
                           AND COALESCE(ba.pack_unidades, 1) > 1
                      THEN
                        GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
                        FLOOR(
                          GREATEST(0, 
                            COALESCE(src_hijo.stock_consolidado, 0) - (
                              COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(ba.pack_unidades, 1))
                            )
                          ) / COALESCE(ba.pack_unidades, 1)
                        )
                      ELSE
                        GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
                    END AS stock_disponible,
                    -- Stock Consolidado (disponible para retrocompatibilidad)
                    CASE
                      WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL)
                           AND COALESCE(ba.pack_unidades, 1) > 1
                      THEN
                        GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
                        FLOOR(
                          GREATEST(0, 
                            COALESCE(src_hijo.stock_consolidado, 0) - (
                              COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(ba.pack_unidades, 1))
                            )
                          ) / COALESCE(ba.pack_unidades, 1)
                        )
                      ELSE
                        GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
                    END AS stock_consolidado,
                    EXISTS (
                        SELECT 1 FROM public.recetas r WHERE r.articulo_numero = ba.articulo_id
                    ) AS tiene_receta
                FROM public.bunker_articulos ba
                LEFT JOIN public.bunker_familias f ON ba.familia_id = f.id
                LEFT JOIN public.articulos art ON ba.articulo_id = art.numero
                LEFT JOIN public.stock_real_consolidado src ON (src.articulo_numero = ba.articulo_id OR src.codigo_barras = ba.articulo_id)
                LEFT JOIN public.stock_real_consolidado src_hijo ON (
                    src_hijo.articulo_numero = ba.pack_hijo_codigo
                    OR src_hijo.codigo_barras = ba.pack_hijo_codigo
                )
                LEFT JOIN reservas_crudas res_art ON (res_art.articulo_numero = ba.articulo_id)
                LEFT JOIN reservas_crudas res_hijo ON (res_hijo.articulo_numero = src_hijo.articulo_numero)
                LEFT JOIN LATERAL (
                    SELECT SUM(rc_padre.cantidad_reservada * COALESCE(bp.pack_unidades, 1)) AS reservado_en_packs
                    FROM public.bunker_articulos bp
                    JOIN reservas_crudas rc_padre ON rc_padre.articulo_numero = bp.articulo_id
                    WHERE (bp.es_pack = true OR bp.pack_unidades > 1)
                      AND (bp.pack_hijo_codigo = ba.articulo_id OR bp.pack_hijo_codigo = art.codigo_barras)
                ) res_padres ON true
            `),
            db.query(`SELECT id, nombre, COALESCE(canal_comercial, 'MAYORISTA') AS canal_comercial FROM public.bunker_listas_precios WHERE activa = true ORDER BY id ASC`),
            db.query(`SELECT id, lista_id, articulo_numero, margen_ganancia, costo_base_sobrescrito, costo_tiempo, iva, precio_final, modo_calculo, modo_iva, es_patron, disponible, exencion_operativa, COALESCE(mano_obra_activa, true) as mano_obra_activa FROM public.bunker_lista_articulos`),
            db.query(`
                SELECT li.id, li.lista_articulo_id, li.insumo_articulo_numero, li.cantidad, 
                       COALESCE(ing.costo_patron, ba.costo_base, p.costo, li.costo_unitario_capturado, 0) as costo_unitario_capturado,
                       COALESCE(ing.costo_patron, ba.costo_base, p.costo, li.costo_unitario_capturado, 0) as costo_unitario_en_vivo,
                       COALESCE(ing.nombre, ba.descripcion_generada, ba.descripcion, a.nombre, li.insumo_articulo_numero) as descripcion,
                       li.incluido 
                FROM public.bunker_lista_insumos li
                LEFT JOIN public.ingredientes ing ON ing.id::text = li.insumo_articulo_numero
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = li.insumo_articulo_numero
                LEFT JOIN public.precios_articulos p ON p.articulo = li.insumo_articulo_numero
                LEFT JOIN public.articulos a ON a.numero = li.insumo_articulo_numero
            `),
            db.query(`
                SELECT d.destino_id, d.costo_kilo_al_momento, v.lote_id_supabase, v.lote_codigo_corto, v.fecha_vinculacion,
                       v.impuesto_iva, v.costo_bruto_ingresado, v.cantidad_total_lote,
                       v.proveedor_nombre, v.articulo_descripcion, v.producto_codigo, v.numero_remito
                FROM public.bunker_lotes_destinos d
                JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                ORDER BY v.fecha_vinculacion DESC
            `),
            db.query(`SELECT id, nombre FROM public.bunker_familias`),
            db.query(`SELECT id, articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes, ingredientes_custom FROM public.articulos_produccion_externa_relacion WHERE UPPER(BTRIM(articulo_produccion_codigo)) <> UPPER(BTRIM(articulo_kilo_codigo))`),
            db.query(`SELECT id, usuario_id, articulo_numero, valor_por_unidad, unidad_medida FROM public.colaboradores_tarifas_rendimiento WHERE activo = true`),
            db.query(`
                WITH base_mermas AS (
                    SELECT
                        peh.id,
                        peh.carro_id,
                        peh.articulo_padre_id,
                        peh.articulo_fraccionado_id,
                        COALESCE(
                            peh.linea_negocio,
                            CASE
                                WHEN peh.articulo_padre_id ILIKE 'BF%' OR peh.articulo_fraccionado_id ILIKE 'BF%' THEN 5
                                WHEN peh.articulo_padre_id ILIKE 'G%GN%' OR peh.articulo_fraccionado_id ILIKE 'G%GN%' THEN 6
                                ELSE 4
                            END
                        ) AS ldn_res,
                        CASE
                            WHEN NOT (peh.articulo_padre_id ILIKE 'BF%' OR peh.articulo_fraccionado_id ILIKE 'BF%' OR peh.articulo_padre_id ILIKE 'G%GN%' OR peh.articulo_fraccionado_id ILIKE 'G%GN%')
                            THEN COALESCE(NULLIF(svm_rec.kilos_egresados_reales, 0), NULLIF(peh.kilos_entrada, 0))
                            WHEN (peh.articulo_padre_id ILIKE 'G%GN%' OR peh.articulo_fraccionado_id ILIKE 'G%GN%')
                            THEN CASE
                                WHEN COALESCE(peh.kilos_entrada, 0) > COALESCE(svm_rec.kilos_egresados_reales, 0) + 0.01
                                THEN peh.kilos_entrada
                                WHEN COALESCE(svm_rec.kilos_egresados_reales, 0) > 0
                                THEN svm_rec.kilos_egresados_reales + COALESCE(NULLIF(isu_rec.kilos_domicilio_reales, 0), NULLIF(bp_up.masa_agregados_bp, 0), 2.78)
                                ELSE NULLIF(COALESCE(bp_up.masa_base_bp, 0) + COALESCE(bp_up.masa_agregados_bp, 0), 0)
                            END
                            ELSE COALESCE(NULLIF(peh.kilos_entrada, 0), NULLIF(svm_rec.kilos_egresados_reales, 0))
                        END AS ent_res,
                        COALESCE(NULLIF(peh.kilos_salida, 0), peh.kilos_producidos) AS sal_res,
                        peh.kilos_producidos,
                        peh.fecha_registro
                    FROM public.produccion_externa_historial peh
                    LEFT JOIN LATERAL (
                        SELECT SUM(
                            CASE
                                WHEN ABS(COALESCE(svm.kilos, 0)) > 0 THEN ABS(svm.kilos)
                                ELSE ABS(COALESCE(svm.cantidad, 0)) * COALESCE(NULLIF(ba_s.kilos_unidad, 0), NULLIF(src_s.kilos_unidad, 0), 1.00)
                            END
                        ) AS kilos_egresados_reales
                        FROM public.stock_ventas_movimientos svm
                        LEFT JOIN public.bunker_articulos ba_s ON ba_s.articulo_id = svm.articulo_numero
                        LEFT JOIN public.stock_real_consolidado src_s ON src_s.articulo_numero = svm.articulo_numero
                        WHERE svm.carro_id = peh.carro_id
                          AND LOWER(COALESCE(svm.tipo, '')) LIKE '%egreso por receta externa%'
                    ) svm_rec ON true
                    LEFT JOIN LATERAL (
                        SELECT COALESCE(SUM(ABS(isu.cantidad)), 0) AS kilos_domicilio_reales
                        FROM public.ingredientes_stock_usuarios isu
                        WHERE isu.origen_carro_id = peh.carro_id
                          AND isu.cantidad < 0
                    ) isu_rec ON true
                    LEFT JOIN LATERAL (
                        SELECT
                            COALESCE((
                                SELECT SUM(CAST(ra.cantidad AS DECIMAL(20,10)) * COALESCE(NULLIF(CAST(src_b.kilos_unidad AS DECIMAL(20,10)), 0), NULLIF(ba_b.kilos_unidad, 0), 1.00))
                                FROM public.receta_articulos ra
                                LEFT JOIN public.stock_real_consolidado src_b ON src_b.articulo_numero = ra.articulo_numero
                                LEFT JOIN public.bunker_articulos ba_b ON ba_b.articulo_id = ra.articulo_numero
                                WHERE ra.receta_id = r_up.id
                            ), 0) AS masa_base_bp,
                            COALESCE((
                                SELECT SUM(CAST(ri.cantidad AS DECIMAL(20,10)))
                                FROM public.receta_ingredientes ri
                                WHERE ri.receta_id = r_up.id
                            ), 0) AS masa_agregados_bp
                        FROM public.recetas r_up
                        WHERE UPPER(BTRIM(r_up.articulo_numero)) = UPPER(BTRIM(peh.articulo_padre_id))
                        LIMIT 1
                    ) bp_up ON true
                    WHERE UPPER(BTRIM(COALESCE(peh.articulo_padre_id, ''))) <> UPPER(BTRIM(COALESCE(peh.articulo_fraccionado_id, '')))
                    ORDER BY peh.fecha_registro DESC
                    LIMIT 500
                )
                SELECT
                    id,
                    carro_id,
                    articulo_padre_id,
                    articulo_fraccionado_id,
                    ent_res AS kilos_entrada,
                    sal_res AS kilos_salida,
                    kilos_producidos,
                    CASE
                        WHEN COALESCE(ent_res, 0) > 0
                             AND COALESCE(sal_res, 0) > 0
                             AND COALESCE(kilos_producidos, 0) <= ent_res + 0.0001
                             AND sal_res <= ent_res + 0.0001
                             AND (ldn_res <> 4 OR (((ent_res - sal_res) / ent_res) * 100 BETWEEN 0 AND 25))
                             AND (ldn_res <> 6 OR (((ent_res - sal_res) / ent_res) * 100 BETWEEN 0 AND 30))
                        THEN ROUND(((ent_res - sal_res) / ent_res) * 100, 2)
                        ELSE NULL
                    END AS porcentaje_merma,
                    CASE
                        WHEN COALESCE(ent_res, 0) <= 0
                             OR COALESCE(sal_res, 0) <= 0
                             OR COALESCE(kilos_producidos, 0) > ent_res + 0.0001
                             OR sal_res > ent_res + 0.0001
                             OR (ldn_res = 4 AND NOT (((ent_res - sal_res) / ent_res) * 100 BETWEEN 0 AND 25))
                             OR (ldn_res = 6 AND NOT (((ent_res - sal_res) / ent_res) * 100 BETWEEN 0 AND 30))
                        THEN true
                        ELSE false
                    END AS es_invalida,
                    fecha_registro
                FROM base_mermas
                ORDER BY fecha_registro DESC
            `),
            db.query(`
                SELECT DISTINCT ON (UPPER(BTRIM(COALESCE(articulo_id, ''))), ingrediente_id)
                       id, articulo_id, ingrediente_id, proveedor_nombre, codigo_proveedor,
                       descripcion_proveedor, precio_costo, costo_kilo_calculado,
                       fecha_actualizacion_oferta, fecha_conciliacion
                FROM public.bunker_conciliacion_articulos
                ORDER BY UPPER(BTRIM(COALESCE(articulo_id, ''))), ingrediente_id, fecha_conciliacion DESC NULLS LAST, id DESC
            `),
            db.query(`
                SELECT combo_articulo_id, componente_articulo_id, cantidad, orden
                FROM public.bunker_combos_componentes
                ORDER BY combo_articulo_id ASC, orden ASC, id ASC
            `).catch(() => ({ rows: [] }))
        ]);

        res.json({
            ingredientes: ingredientes,
            composicionMix: composicionMix.rows,
            recetas: recetas.rows,
            recetaIngredientes: recetaIngredientes.rows,
            recetaArticulos: recetaArticulos.rows,
            articulosBunker: articulosBunker.rows,
            listasPrecios: listasPrecios.rows,
            articulosListas: articulosListas.rows,
            insumosListas: insumosListas.rows,
            lotes: lotes.rows,
            familiasBunker: familiasBunker.rows,
            articulosProduccionExternaRelacion: articulosProduccionExternaRelacion.rows,
            tarifasRendimiento: tarifasRendimiento.rows,
            mermasHistorial: mermasHistorial.rows,
            conciliacionesRecientes: conciliacionesRecientes.rows,
            combosComponentes: combosComponentes.rows
        });
    } catch (error) {
        console.error('❌ Error en GET /simulacion/inicializar:', error);
        res.status(500).json({ error: 'Error al inicializar los datos de simulación', detalle: error.message });
    }
});

/**
 * GET /api/produccion/produccion-propia/insumo-crudo/:sku
 * Devuelve costo de reposición, stock y último lote físico de un bulto crudo alternativo
 * para el selector interactivo de la Solapa 5 (Producción Propia LAMDA) en Mesa Integrada.
 */
router.get('/produccion-propia/insumo-crudo/:sku', async (req, res) => {
    try {
        const db = req.db || pool;
        const sku = String(req.params.sku || '').trim();
        if (!sku) {
            return res.status(400).json({ success: false, error: 'SKU requerido.' });
        }
        const detalle = await produccionPropiaCostosService.obtenerDetalleInsumoCrudo({ sku, db });
        if (!detalle) {
            return res.status(404).json({ success: false, error: `Artículo ${sku} no encontrado.` });
        }
        res.json({ success: true, data: detalle });
    } catch (error) {
        console.error('❌ Error en GET /produccion-propia/insumo-crudo:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/produccion/ldn4/fuente-abastecimiento/:apCodigo
 * Persiste en propiedades_dinamicas->fuente_abastecimiento_ldn4 del Artículo Puente la decisión
 * explícita del usuario (Producción UP vs Compra Proveedor vs Manual) y su benchmark de proveedor,
 * sin alterar precios ni costo_base hasta que el operador confirme la propagación.
 */
router.post('/ldn4/fuente-abastecimiento/:apCodigo', async (req, res) => {
    try {
        const db = req.db || pool;
        const apCodigo = String(req.params.apCodigo || '').trim();
        if (!apCodigo) {
            return res.status(400).json({ success: false, error: 'Código de Artículo Puente requerido.' });
        }

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const modosValidos = new Set(['PRODUCCION_UP', 'COMPRA_PROVEEDOR', 'MANUAL']);
        const patch = { updated_at: new Date().toISOString() };

        if (body.modo_rector !== undefined) {
            const modoNorm = String(body.modo_rector || '').trim().toUpperCase();
            if (!modosValidos.has(modoNorm)) {
                return res.status(400).json({ success: false, error: 'modo_rector inválido.' });
            }
            patch.modo_rector = modoNorm;
        }
        if (body.compra_origen !== undefined) patch.compra_origen = body.compra_origen ? String(body.compra_origen).trim().toUpperCase() : null;
        if (body.compra_sku_bulto !== undefined) patch.compra_sku_bulto = body.compra_sku_bulto ? String(body.compra_sku_bulto).trim() : null;
        if (body.compra_costo_kg !== undefined) {
            const val = parseFloat(body.compra_costo_kg);
            patch.compra_costo_kg = Number.isFinite(val) && val >= 0 ? Number(val.toFixed(2)) : null;
        }
        if (body.compra_aplica_mo_ap !== undefined) patch.compra_aplica_mo_ap = Boolean(body.compra_aplica_mo_ap);
        if (body.compra_proveedor_nombre !== undefined) patch.compra_proveedor_nombre = body.compra_proveedor_nombre ? String(body.compra_proveedor_nombre).trim() : null;
        if (body.compra_proveedor_codigo !== undefined) patch.compra_proveedor_codigo = body.compra_proveedor_codigo ? String(body.compra_proveedor_codigo).trim() : null;
        if (body.compra_descripcion !== undefined) patch.compra_descripcion = body.compra_descripcion ? String(body.compra_descripcion).trim() : null;
        if (body.compra_updated_at !== undefined) patch.compra_updated_at = body.compra_updated_at || new Date().toISOString();
        if (body.manual_costo_kg !== undefined) {
            const valM = parseFloat(body.manual_costo_kg);
            patch.manual_costo_kg = Number.isFinite(valM) && valM >= 0 ? Number(valM.toFixed(2)) : null;
        }
        if (body.manual_nota !== undefined) patch.manual_nota = body.manual_nota ? String(body.manual_nota).trim() : null;

        const upd = await db.query(
            `UPDATE public.bunker_articulos
             SET propiedades_dinamicas = jsonb_set(
                 COALESCE(propiedades_dinamicas, '{}'::jsonb),
                 '{fuente_abastecimiento_ldn4}',
                 COALESCE(propiedades_dinamicas->'fuente_abastecimiento_ldn4', '{}'::jsonb) || $1::jsonb,
                 true
             ),
             updated_at = CURRENT_TIMESTAMP
             WHERE UPPER(BTRIM(articulo_id)) = UPPER(BTRIM($2))
             RETURNING articulo_id, propiedades_dinamicas->'fuente_abastecimiento_ldn4' AS fuente_abastecimiento_ldn4`,
            [JSON.stringify(patch), apCodigo]
        );

        if (upd.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Artículo Puente ${apCodigo} no encontrado.` });
        }

        res.json({
            success: true,
            articulo_id: upd.rows[0].articulo_id,
            fuente_abastecimiento_ldn4: upd.rows[0].fuente_abastecimiento_ldn4
        });
    } catch (error) {
        console.error('❌ Error en POST /ldn4/fuente-abastecimiento:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/produccion/simulacion/aplicar-precios
 * Procesa transaccionalmente un array de actualizaciones de precios de artículos de listas de búnker.
 */
router.post('/simulacion/aplicar-precios', async (req, res) => {
    const actualizaciones = Array.isArray(req.body) ? req.body : (req.body && req.body.actualizaciones);

    if (!actualizaciones || !Array.isArray(actualizaciones)) {
        return res.status(400).json({ error: 'Se requiere un array de actualizaciones de precios en el cuerpo de la petición (bajo "actualizaciones" o directo).' });
    }

    if (actualizaciones.length === 0) {
        return res.json({ success: true, count: 0 });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const query = `
            INSERT INTO public.bunker_lista_articulos (
                lista_id, articulo_numero, margen_ganancia, costo_base_sobrescrito,
                costo_tiempo, iva, precio_final, modo_calculo, modo_iva, disponible, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
            ON CONFLICT (lista_id, articulo_numero) DO UPDATE SET
                margen_ganancia = EXCLUDED.margen_ganancia,
                costo_base_sobrescrito = EXCLUDED.costo_base_sobrescrito,
                costo_tiempo = COALESCE(EXCLUDED.costo_tiempo, bunker_lista_articulos.costo_tiempo),
                iva = COALESCE(EXCLUDED.iva, bunker_lista_articulos.iva),
                precio_final = EXCLUDED.precio_final,
                modo_calculo = EXCLUDED.modo_calculo,
                modo_iva = EXCLUDED.modo_iva,
                disponible = EXCLUDED.disponible,
                updated_at = CURRENT_TIMESTAMP;
        `;

        const listasNodosRes = await client.query(
            `SELECT id FROM public.bunker_listas_precios WHERE COALESCE(canal_comercial, 'MAYORISTA') = 'NODOS'`
        );
        const listasNodosSet = new Set(listasNodosRes.rows.map(r => Number(r.id)));
        const articulosNodosActualizados = new Set();
        const articulosCostoBaseFijadoLista1 = new Set();

        const cambiosHistorial = [];

        for (const item of actualizaciones) {
            const {
                lista_id,
                articulo_numero,
                margen_ganancia,
                costo_base_sobrescrito,
                costo_tiempo,
                iva,
                precio_final,
                disponible
            } = item;

            // Validación mínima de campos indispensables
            if (lista_id === undefined || lista_id === null || !articulo_numero) {
                throw new Error(`Datos incompletos en el registro: lista_id y articulo_numero son requeridos.`);
            }

            // Consultar si ya existe el registro en la lista para recuperar sus configuraciones operativas
            const resExist = await client.query(
                `SELECT modo_calculo, modo_iva, disponible, precio_final, costo_base_sobrescrito FROM public.bunker_lista_articulos WHERE lista_id = $1 AND articulo_numero = $2`,
                [lista_id, articulo_numero]
            );

            const esListaNodos = listasNodosSet.has(Number(lista_id));
            // Regla Variante 2: En listas con canal_comercial = 'NODOS', actualizar solo si el artículo ya existe con disponible = true;
            // omitir/bloquear cualquier artículo mayorista que no esté habilitado en el canal Nodos.
            if (esListaNodos) {
                if (resExist.rows.length === 0 || resExist.rows[0].disponible === false) {
                    continue;
                }
                articulosNodosActualizados.add(String(articulo_numero));
            }

            let modoCalculoFinal = item.modo_calculo || 'AUTOMATIC';
            let modoIvaFinal = item.modo_iva || 'COMPLETO';
            let disponibleFinal = (disponible !== undefined && disponible !== null) ? Boolean(disponible) : true;

            if (resExist.rows.length > 0) {
                modoCalculoFinal = resExist.rows[0].modo_calculo || modoCalculoFinal;
                modoIvaFinal = resExist.rows[0].modo_iva || modoIvaFinal;
                if (disponible === undefined || disponible === null) {
                    disponibleFinal = resExist.rows[0].disponible !== false;
                }
            }

            // Preparar registro para historial si hubo cambio
            const pAnt = resExist.rows[0] ? parseFloat(resExist.rows[0].precio_final || 0) : 0;
            const cAnt = resExist.rows[0] ? parseFloat(resExist.rows[0].costo_base_sobrescrito || 0) : 0;
            cambiosHistorial.push({
                articulo_numero,
                lista_id,
                costo_anterior: cAnt,
                costo_nuevo: parseFloat(costo_base_sobrescrito || 0),
                precio_anterior: pAnt,
                precio_nuevo: parseFloat(precio_final || 0),
                porcentaje_iva: parseFloat(iva || 21),
                origen_cambio: 'APLICAR_LISTAS',
                usuario: req.user ? (req.user.username || req.user.nombre) : 'OPERADOR'
            });

            const values = [
                lista_id,
                articulo_numero,
                margen_ganancia !== undefined && margen_ganancia !== null ? margen_ganancia : null,
                costo_base_sobrescrito !== undefined && costo_base_sobrescrito !== null ? costo_base_sobrescrito : null,
                costo_tiempo !== undefined && costo_tiempo !== null ? costo_tiempo : null,
                iva !== undefined && iva !== null ? iva : null,
                precio_final !== undefined && precio_final !== null ? precio_final : null,
                modoCalculoFinal,
                modoIvaFinal,
                disponibleFinal
            ];

            await client.query(query, values);

            // Sincronizar también el costo_base oficial en bunker_articulos si se proporcionó costo_base_sobrescrito
            // Priorizando siempre Lista 1 cuando se impactan múltiples listas en un mismo lote
            if (costo_base_sobrescrito !== undefined && costo_base_sobrescrito !== null && parseFloat(costo_base_sobrescrito) > 0) {
                const artKeyLower = String(articulo_numero || '').trim().toLowerCase();
                if (Number(lista_id) === 1 || !articulosCostoBaseFijadoLista1.has(artKeyLower)) {
                    await client.query(
                        `UPDATE public.bunker_articulos 
                         SET costo_base = ROUND(($1::numeric * COALESCE(kilos_unidad, 1)), 2),
                             porcentaje_iva = COALESCE($2::numeric, porcentaje_iva),
                             updated_at = CURRENT_TIMESTAMP
                         WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($3))`,
                        [costo_base_sobrescrito, iva, articulo_numero]
                    );
                    if (Number(lista_id) === 1) {
                        articulosCostoBaseFijadoLista1.add(artKeyLower);
                    }
                }
            }
        }

        // Registrar auditoría de variaciones en la base de datos
        if (cambiosHistorial.length > 0) {
            await historialPreciosService.registrarCambiosLote({
                client,
                cambios: cambiosHistorial,
                origen_cambio: 'APLICAR_LISTAS',
                usuario: req.user ? (req.user.username || req.user.nombre) : 'OPERADOR'
            });
        }

        await client.query('COMMIT');

        // Sincronizar en cascada con nodos_articulos_catalogo y nodos_ofertas_gestor los artículos habilitados en Nodos
        if (articulosNodosActualizados.size > 0) {
            const nodosBarrialesService = require('../services/nodosBarrialesService');
            for (const artId of articulosNodosActualizados) {
                await nodosBarrialesService.sincronizarCatalogoNodoDesdeBunker(artId);
            }
        }
        try {
            const combosCompuestosService = require('../services/combosCompuestosService');
            const skusToc = Array.from(new Set(actualizaciones.map(u => String(u.articulo_numero || '').trim()).filter(Boolean)));
            if (skusToc.length > 0) {
                await combosCompuestosService.recalcularCombosAfectadosPorCambio(pool, { skusModificados: skusToc });
            }
        } catch (comboSyncErr) {
            console.warn('[PIZARRA->COMBOS] Aviso recalculando combos en cascada:', comboSyncErr.message);
        }

        res.json({ success: true, count: cambiosHistorial.length });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en transacción POST /simulacion/aplicar-precios:', error);
        res.status(500).json({ error: 'Error al aplicar las actualizaciones de precios en la base de datos', detalle: error.message });
    } finally {
        client.release();
    }
});

// =========================================================================
// MÓDULO DE BÚSQUEDA SEMÁNTICA DE PROVEEDORES (IA GEMINI)
// =========================================================================

// =========================================================================
// DICCIONARIOS GLOBALES DE TRADUCCIÓN DE SKUs DE BUNKER
// =========================================================================
const dictMP = {
    'NUEZ': 'Nuez',
    'ALM': 'Almendra',
    'CAJU': 'Castaña de Cajú',
    'MANI': 'Maní',
    'SEMI': 'Semillas',
    'ZAPA': 'Semilla de Zapallo',
    'GIRA': 'Semilla de Girasol',
    'CHIA': 'Semilla de Chía',
    'LINO': 'Semilla de Lino',
    'SEMA': 'Semilla de Sésamo',
    'MAIZ': 'Maíz',
    'PISIG': 'Maíz Pisingallo',
    'PISINGALLO': 'Maíz Pisingallo',
    'PASA': 'Pasa de Uva',
    'MIX': 'Mix de Frutos Secos',
    'HIGO': 'Higo desecado',
    'DURA': 'Durazno desecado',
    'COCO': 'Coco rallado',
    'CIRU': 'Ciruela desecada',
    'ARAN': 'Arándano desecado',
    'ANAN': 'Ananá desecado',
    'AVELL': 'Avellana Repelada'
};

const dictMorf = {
    'MPSA': 'Mariposa Entera (mitades)',
    'MARIPOSA': 'Mariposa Entera (mitades)',
    'PED': 'Pedazos / Trozos',
    'CUART': 'Cuartillo / Cuartos',
    '4TA': 'Cuarta (trozos chicos)',
    '1/4': 'Cuarta / Cuarto',
    'ENT': 'Entero',
    'PEL': 'Pelado',
    'CRU': 'Crudo',
    'TOST': 'Tostado',
    'FRITO': 'Frito y Salado (Snack procesado)',
    'SAL': 'Salado (Snack procesado)',
    'JUMBO': 'Jumbo / Grande',
    'MED': 'Mediano',
    'CHICO': 'Chico / Calibre pequeño',
    'W3': 'Calibre W3 (Castaña entera mediana)',
    'W4': 'Calibre W4 (Castaña entera chica)',
    'W180': 'Calibre W180 (Castaña entera súper jumbo)',
    'W240': 'Calibre W240 (Castaña entera jumbo)',
    'W320': 'Calibre W320 (Castaña entera grande)',
    'W450': 'Calibre W450 (Castaña entera estándar)',
    'LWP': 'LWP (Pedazos grandes de castaña)',
    'SWP': 'SWP (Pedazos medianos de castaña)'
};

const dictCal = {
    'AMLGHT': 'Amarillo Light (coloración clara estándar)',
    'LIGHT': 'Light (coloración amarilla estándar)',
    'EXLGHT': 'Extra Light (coloración blanca / extra clara premium)',
    'AMBAR': 'Ámbar (coloración oscura / marrón)',
    'STD': 'Estándar',
    'PREM': 'Premium',
    'FLAME': 'Flame (variedad roja oscura)',
    'RUBIA': 'Rubia (variedad clara)',
    'NEGRA': 'Negra / Flame'
};

/**
 * Traduce semánticamente el SKU del artículo Bunker a sus componentes legibles.
 */
function traducirSkuBunker(articulo_id, descripcion) {
    const parts = String(articulo_id).toUpperCase().split('.');
    const materiaPrima = parts[0] || '';
    const morfologia = parts[1] || '';
    const calidad = parts[2] || '';

    const mpTrad = dictMP[materiaPrima] || materiaPrima;
    const morfTrad = dictMorf[morfologia] || morfologia;
    const calTrad = dictCal[calidad] || calidad;

    return `Materia Prima: ${mpTrad} | Morfología/Formato: ${morfTrad} | Calidad/Color: ${calTrad} (Descripción del Catálogo: ${descripcion})`;
}

/**
 * GET /api/produccion/simulacion/proveedores-semanticos
 * Consulta y clasifica semánticamente las ofertas de proveedores remotos utilizando Gemini.
 */
router.get('/simulacion/proveedores-semanticos', async (req, res) => {
    const { articulo_id, descripcion } = req.query;
    if (!articulo_id || !descripcion) {
        return res.status(400).json({ error: 'Faltan parámetros indispensables: articulo_id y descripcion.' });
    }

    try {
        const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
        const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

        // 1. Obtener cotizaciones de Supabase de forma paginada
        let cotizaciones = [];
        let offset = 0;
        let hasMore = true;
        
        while (hasMore && cotizaciones.length < 5000) {
            const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=id,proveedor_id,nombre_proveedor,timestamp_extraccion,datos_maestros&limit=1000&offset=${offset}`;
            const response = await axios.get(url, { headers });
            if (!response.data) throw new Error("Error de conexión al obtener cotizaciones de Supabase");
            
            const rows = response.data;
            cotizaciones = cotizaciones.concat(rows);
            
            if (rows.length < 1000) {
                hasMore = false;
            } else {
                offset += 1000;
            }
        }

        if (cotizaciones.length === 0) {
            return res.json([]);
        }

        // 2. Normalizar datos y resolver casteo de tipo mixto (String vs. Number)
        const cotizacionesNormalizadas = cotizaciones.map(row => {
            const dm = { ...row.datos_maestros };
            const skuProveedorRaw = dm.codigo || dm.sku || dm.código || "";
            
            let precioUnitarioVal = 0;
            if (dm.precio !== undefined && dm.precio !== null) {
                if (typeof dm.precio === 'number') {
                    precioUnitarioVal = dm.precio;
                } else {
                    const cleanPrice = String(dm.precio).replace(/\./g, '').replace(',', '.');
                    precioUnitarioVal = parseFloat(cleanPrice) || 0;
                }
            }

            let precioPromoVal = 0;
            if (dm.promo !== undefined && dm.promo !== null) {
                if (typeof dm.promo === 'number') {
                    precioPromoVal = dm.promo;
                } else {
                    const cleanPromo = String(dm.promo).replace(/\./g, '').replace(',', '.');
                    precioPromoVal = parseFloat(cleanPromo) || 0;
                }
            }
            
            let cantBultVal = 1;
            if (dm.cant_bult !== undefined && dm.cant_bult !== null) {
                if (typeof dm.cant_bult === 'number') {
                    cantBultVal = dm.cant_bult;
                } else {
                    cantBultVal = parseFloat(String(dm.cant_bult).replace(',', '.')) || 1;
                }
            }

            let cantValorVal = 1;
            if (dm.cant_valor !== undefined && dm.cant_valor !== null) {
                if (typeof dm.cant_valor === 'number') {
                    cantValorVal = dm.cant_valor;
                } else {
                    cantValorVal = parseFloat(String(dm.cant_valor).replace(',', '.')) || 1;
                }
            }
            
            const now = new Date();
            const fechaActualizacionRaw = dm.ultima_actualizacion_origen || row.timestamp_extraccion;
            const diasActualizacion = Math.max(0, Math.floor((now - new Date(fechaActualizacionRaw)) / (1000 * 60 * 60 * 24)));

            return {
                oferta_id: row.id,
                proveedor_id: row.proveedor_id,
                nombre_proveedor: row.nombre_proveedor,
                sku_proveedor: skuProveedorRaw,
                descripcion: dm.descripcion || "",
                precio_unitario: precioUnitarioVal,
                precio_promocional: precioPromoVal,
                unidad_medida: dm.unidad || "kilo",
                dias_actualizacion: diasActualizacion,
                valido_hasta: String(fechaActualizacionRaw).split('T')[0],
                rubro: dm.rubro || "",
                cant_bult: cantBultVal,
                cant_valor: cantValorVal
            };
        });

        // ETAPA 1: Guardarraíles Deterministas (Filtro Duro / Corte de Raíz)
        const desgloseSemantico = traducirSkuBunker(articulo_id, descripcion);
        const esMariposa = desgloseSemantico.toLowerCase().includes('mariposa') || articulo_id.toLowerCase().includes('mpsa');
        const esArticuloMoscada = desgloseSemantico.toLowerCase().includes('moscada');
        const esArticuloMix = desgloseSemantico.toLowerCase().includes('mix');

        // Determinar palabras clave de la materia prima principal basadas en el prefijo del SKU
        const parts = String(articulo_id).toUpperCase().split('.');
        const prefijo = parts[0] || '';
        
        const mapeoPalabrasClave = {
            'NUEZ': ['nuez', 'nueces'],
            'ALM': ['almendra', 'almendras'],
            'ALME': ['almendra', 'almendras'],
            'PASA': ['pasa', 'pasas'],
            'MIX': ['mix', 'mixes'],
            'CIRU': ['ciruela', 'ciruelas'],
            'COCO': ['coco'],
            'CAJU': ['cajú', 'caju', 'castaña', 'castañas'],
            'MANI': ['maní', 'mani'],
            'ANAN': ['ananá', 'anana'],
            'DURA': ['durazno', 'duraznos'],
            'ARAN': ['arándano', 'arandano', 'arándanos', 'arandanos'],
            'AVELL': ['avellana', 'avellanas'],
            'MAIZ': ['maíz', 'maiz', 'pisingallo']
        };

        let palabrasRequeridas = mapeoPalabrasClave[prefijo] || [];
        if (palabrasRequeridas.length === 0) {
            // Generación automática de palabras requeridas para artículos nuevos o no catalogados
            const trad = dictMP[prefijo];
            if (trad) {
                palabrasRequeridas.push(trad.toLowerCase());
            } else if (prefijo.length >= 3) {
                palabrasRequeridas.push(prefijo.toLowerCase());
            }
            // Agregar palabras de más de 4 letras de la descripción original
            descripcion.toLowerCase()
                .replace(/[.\/()x\-,+]/g, ' ')
                .split(' ')
                .filter(w => w.length > 4)
                .forEach(w => {
                    if (!palabrasRequeridas.includes(w)) palabrasRequeridas.push(w);
                });
        }

        const cotizacionesValidas = cotizacionesNormalizadas.filter(o => {
            // Guardarraíl 1: Exclusión absoluta de registros vacíos o en cero
            if (!o.precio_unitario || o.precio_unitario <= 0) return false;

            // Guardarraíl 2: Volumen Mayorista Duro (Volumen Total >= 9.5 kg neto)
            const volumenNeto = o.cant_bult * o.cant_valor;
            if (volumenNeto < 9.5) return false;

            const descLower = (o.descripcion || '').toLowerCase();

            // Guardarraíl 3: Exclusión de Rubros y Especies
            if (!esArticuloMoscada && descLower.includes('moscada')) return false;
            if (!esArticuloMix && descLower.includes('mix')) return false;

            // Guardarraíl 4: Exclusión Morfológica Rígida para Mariposa (Bloquea cuartos/pedazos/rotas)
            if (esMariposa) {
                if (
                    descLower.includes('cuarto') || 
                    descLower.includes('cuarta') || 
                    descLower.includes('1/4') || 
                    descLower.includes('cuartillo') || 
                    descLower.includes('pedazo') ||
                    descLower.includes('roto') ||
                    descLower.includes('rota') ||
                    descLower.includes('picado') ||
                    descLower.includes('granilla')
                ) {
                    return false;
                }
            }

            // Guardarraíl 5: Exclusión Temática por Familia de Materia Prima (Corte cruzado)
            if (palabrasRequeridas.length > 0) {
                const tienePalabra = palabrasRequeridas.some(p => descLower.includes(p));
                if (!tienePalabra) return false;
            }

            return true;
        });

        // 3. Pre-filtrado Heurístico con Scoring de Descriptores Críticos
        const mpTrad = dictMP[prefijo] || prefijo;
        const morfologia = parts[1] || '';
        const calidad = parts[2] || '';
        const morfTrad = dictMorf[morfologia] || morfologia;
        const calTrad = dictCal[calidad] || calidad;

        // Construir texto de búsqueda limpio excluyendo palabras estáticas de la plantilla
        const textoBusquedaLimpio = `${mpTrad} ${morfTrad} ${calTrad} ${descripcion}`;

        const keywords = textoBusquedaLimpio.toLowerCase()
            .replace(/[.\/()x\-,+]/g, ' ')
            .split(' ')
            .filter(w => w.length > 3 && !['materia', 'prima', 'morfologia', 'formato', 'calidad', 'color', 'descripcion', 'catalogo'].includes(w));

        const cotizacionesConScore = cotizacionesValidas.map(o => {
            const desc = (o.descripcion || '').toLowerCase();
            
            // Score base: coincidencia de palabras clave
            let score = keywords.reduce((sum, kw) => sum + (desc.includes(kw) ? 1 : 0), 0);
            
            // Prioridad morfológica y de calidad
            const terminosCriticos = ['mariposa', 'cuarto', 'pedazo', 'entera', 'rotas', 'light', 'extra light', 'amber', 'pelada', 'con cascara', 'cruda', 'tostada', 'pisingallo', 'bananas', 'banana', 'chips', 'garbanzos', 'garbanzo'];
            terminosCriticos.forEach(term => {
                if (textoBusquedaLimpio.toLowerCase().includes(term) && desc.includes(term)) {
                    score += 5;
                }
            });

            // Coincidencia exacta de SKU
            if (o.sku_proveedor && String(o.sku_proveedor).toLowerCase() === String(articulo_id).toLowerCase()) {
                score += 50;
            }

            return { ...o, _score: score };
        });

        // ETAPA 2: Resolución de la Saturación (Distribución Red-Robin)
        const cotizacionesPorProveedor = {};
        cotizacionesConScore.forEach(c => {
            const prov = c.nombre_proveedor;
            if (!cotizacionesPorProveedor[prov]) {
                cotizacionesPorProveedor[prov] = [];
            }
            cotizacionesPorProveedor[prov].push(c);
        });

        // Ordenar por afinidad/recencia dentro de cada proveedor
        for (const prov in cotizacionesPorProveedor) {
            cotizacionesPorProveedor[prov].sort((a, b) => b._score - a._score || a.dias_actualizacion - b.dias_actualizacion);
        }

        // Distribución Red-Robin hasta un máximo de 30 candidatos
        const subLote = [];
        const proveedoresActivos = Object.keys(cotizacionesPorProveedor);
        let iteracion = 0;
        let huboExtraccion = true;

        while (subLote.length < 30 && huboExtraccion) {
            huboExtraccion = false;
            for (const prov of proveedoresActivos) {
                if (subLote.length >= 30) break;
                
                const lista = cotizacionesPorProveedor[prov];
                if (lista.length > iteracion) {
                    subLote.push(lista[iteracion]);
                    huboExtraccion = true;
                }
            }
            iteracion++;
        }

        if (subLote.length === 0) {
            return res.json([]);
        }

        // ETAPA 3: Gemini como Re-Ranker Semántico (Ordenación Dinámica)
        const iaMonitor = require('../../services/iaCreditoMonitorService');
        const credIa = iaMonitor.leerCredencialesGeminiEnCaliente();
        const apiKey = credIa.apiKey || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.log('🤖 [B采购AI] Fallback activo: Retornando candidatos distribuidos equitativamente.');
            return res.json(subLote);
        }

        const modeloGeminiProd = credIa.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
        const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/${modeloGeminiProd}:generateContent?key=${apiKey}`;

        const promptText = `
Actúa como un Re-Ranker comercial de frutos secos. Ordena la siguiente lista de ofertas de proveedores (candidatos mayoristas) en base a su afinidad semántica y equivalencia de calidad comercial con el artículo de catálogo (Búnker) solicitado:

Artículo Catálogo Búnker:
- Código: "${articulo_id}"
- Atributos Expandidos: "${desgloseSemantico}"

REGLAS DE ORDENACIÓN Y CONFIDENCIA (USO OBLIGATORIO):
1. JERARQUÍA DE COLORACIÓN DE NUECES:
   - La escala de color de nuez es: Extra Light (Blanca) > Light (Amarilla) > Amber (Marrón/Oscura).
   - Se permite reponer entregando una calidad SUPERIOR o IGUAL:
     - Si el artículo bunker es "Light", una oferta "Extra Light" (calidad superior) SÍ es compatible y debe ir arriba con confianza alta (0.9 a 1.0).
     - Si el artículo bunker es "Amber", una oferta "Light" o "Extra Light" SÍ es compatible.
   - NO se permite reponer entregando una calidad INFERIOR:
     - Si el artículo bunker es "Extra Light", una oferta "Light" o "Amber" NO es compatible (confianza = 0.0).
     - Si el artículo bunker es "Light", una oferta "Amber" NO es compatible (confianza = 0.0).
2. CALIBRACIÓN DE CONFIANZA:
   - Retorna un puntaje de confianza de 0.0 a 1.0 para cada oferta. Las ofertas que tengan concordancia exacta de color y morfología deben tener confianza >= 0.9.
   - Las ofertas que representen un desvío o calidad inferior deben tener confianza = 0.0.

Cotizaciones Candidatas a ordenar (máximo 30):
${JSON.stringify(subLote.map(o => ({ 
    oferta_id: o.oferta_id, 
    proveedor: o.nombre_proveedor, 
    descripcion: o.descripcion, 
    precio: o.precio_unitario, 
    unidad: o.unidad_medida,
    rubro: o.rubro,
    presentacion: `${o.cant_bult} x ${o.cant_valor} kg`
})), null, 2)}
`;

        const responseSchema = {
            type: "OBJECT",
            properties: {
                ofertas_clasificadas: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            oferta_id: { type: "STRING", description: "El ID de la oferta clasificada." },
                            confianza: { type: "NUMBER", description: "Puntuación de equivalencia semántica de 0.0 a 1.0." }
                        },
                        required: ["oferta_id", "confianza"]
                    }
                }
            },
            required: ["ofertas_clasificadas"]
        };

        const payload = {
            contents: [{
                parts: [{ text: promptText }]
            }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
                temperature: 0.1
            }
        };

        const geminiRes = await axios.post(urlGemini, payload, { timeout: 15000 });
        iaMonitor.registrarEventoIaSistema({
            modulo: 'PRODUCCION_LOTES',
            detalle: `Re-Ranker Ofertas (${articulo_id})`,
            rawResponseData: geminiRes.data,
            modelo: modeloGeminiProd
        });
        if (!geminiRes.data || !geminiRes.data.candidates || !geminiRes.data.candidates[0].content) {
            throw new Error('Respuesta vacía o inválida de la API de Gemini');
        }

        const textResponse = geminiRes.data.candidates[0].content.parts[0].text;
        const parsed = JSON.parse(textResponse);

        const clasificados = parsed.ofertas_clasificadas || [];
        const confianzaMap = {};
        clasificados.forEach(c => {
            confianzaMap[String(c.oferta_id)] = parseFloat(c.confianza) || 0;
        });

        // Filtrar aquellos que superen el umbral de confianza (> 0.5) y ordenarlos descendentemente por afinidad
        const resultadoFinal = subLote
            .filter(o => (confianzaMap[String(o.oferta_id)] || 0) > 0.5)
            .map(o => ({ ...o, confianza: confianzaMap[String(o.oferta_id)] }))
            .sort((a, b) => b.confianza - a.confianza);

        res.json(resultadoFinal);
    } catch (error) {
        console.error('❌ Error en Re-Ranker de Ofertas IA:', error);
        res.status(500).json({ error: error.message });
    }
});

// =========================================================================
// MÓDULO: HISTORIAL DE CAMBIOS DE PRECIOS Y NOTIFICACIONES A CLIENTES
// =========================================================================
const historialPreciosService = require('../services/historialPreciosService');

/**
 * GET /api/produccion/precios/historial-cambios
 * Devuelve el listado de variaciones de precios histórico agrupado/filtrado
 */
router.get('/precios/historial-cambios', async (req, res) => {
    try {
        const { dias, search } = req.query;
        const data = await historialPreciosService.obtenerHistorial({ dias, search });
        res.json({ success: true, count: data.length, data });
    } catch (err) {
        console.error('❌ Error en GET /precios/historial-cambios:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/produccion/precios/cambios/:articulo_id/clientes-afectados
 * Devuelve los clientes que compraron este artículo en los últimos N días
 */
router.get('/precios/cambios/:articulo_id/clientes-afectados', async (req, res) => {
    try {
        const { articulo_id } = req.params;
        const { dias } = req.query;
        const data = await historialPreciosService.obtenerClientesAfectadosPorArticulo({
            articulo_numero: articulo_id,
            dias: dias || 90
        });
        res.json({ success: true, ...data });
    } catch (err) {
        console.error(`❌ Error en GET /precios/cambios/${req.params.articulo_id}/clientes-afectados:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/produccion/precios/cambios-por-cliente/:cliente_id
 * Devuelve los artículos que cambiaron de precio que son consumidos por este cliente
 */
router.get('/precios/cambios-por-cliente/:cliente_id', async (req, res) => {
    try {
        const { cliente_id } = req.params;
        const { dias } = req.query;
        const data = await historialPreciosService.obtenerArticulosAfectadosPorCliente({
            cliente_id,
            dias: dias || 90
        });
        res.json({ success: true, ...data });
    } catch (err) {
        console.error(`❌ Error en GET /precios/cambios-por-cliente/${req.params.cliente_id}:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/produccion/precios/clientes-afectados-resumen
 * Devuelve el listado proactivo de todos los clientes afectados por los cambios de precios en los últimos N días
 */
router.get('/precios/clientes-afectados-resumen', async (req, res) => {
    try {
        const { dias, search } = req.query;
        const data = await historialPreciosService.obtenerListadoClientesAfectados({
            dias: dias || 90,
            search: search || ''
        });
        res.json({ success: true, count: data.length, data });
    } catch (err) {
        console.error('❌ Error en GET /precios/clientes-afectados-resumen:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/produccion/precios/buscar-clientes
 * Autocompletado de clientes por código legacy, código búnker, nombre o cuit
 */
router.get('/precios/buscar-clientes', async (req, res) => {
    try {
        const { q } = req.query;
        const data = await historialPreciosService.buscarClientes(q || '');
        res.json({ success: true, data });
    } catch (err) {
        console.error('❌ Error en GET /precios/buscar-clientes:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/produccion/precios/notificaciones/actualizar
 * Actualiza el estado de aviso al cliente (PENDIENTE, NOTIFICADO, OMITIDO)
 */
router.post('/precios/notificaciones/actualizar', async (req, res) => {
    try {
        const {
            historial_cambio_id,
            articulo_numero,
            cliente_id,
            codigo_bunker_cliente,
            cliente_nombre,
            estado,
            canal,
            notas
        } = req.body;

        if (!articulo_numero || cliente_id === undefined) {
            return res.status(400).json({ success: false, message: 'articulo_numero y cliente_id son requeridos' });
        }

        const data = await historialPreciosService.actualizarEstadoNotificacion({
            historial_cambio_id: historial_cambio_id || null,
            articulo_numero,
            cliente_id,
            codigo_bunker_cliente,
            cliente_nombre,
            estado: estado || 'NOTIFICADO',
            canal: canal || 'WHATSAPP',
            notas
        });

        res.json(data);
    } catch (err) {
        console.error('❌ Error en POST /precios/notificaciones/actualizar:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/produccion/precios/informe-config/:cliente_id
 * Obtiene la configuración personalizada del informe PDF para un cliente
 */
router.get('/precios/informe-config/:cliente_id', async (req, res) => {
    try {
        const { cliente_id } = req.params;
        const config = await historialPreciosService.obtenerConfigInformeCliente(cliente_id);
        res.json({ success: true, cliente_id, config });
    } catch (err) {
        console.error(`❌ Error en GET /precios/informe-config/${req.params.cliente_id}:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/produccion/precios/informe-config/:cliente_id
 * Guarda la configuración personalizada del informe PDF para un cliente
 */
router.post('/precios/informe-config/:cliente_id', async (req, res) => {
    try {
        const { cliente_id } = req.params;
        const config = await historialPreciosService.guardarConfigInformeCliente(cliente_id, req.body || {});
        res.json({ success: true, cliente_id, config });
    } catch (err) {
        console.error(`❌ Error en POST /precios/informe-config/${req.params.cliente_id}:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

function extraerConfigOverrideQuery(query = {}) {
    const keys = [
        'agrupar_jerarquia_b2b',
        'mostrar_alternativas_stock',
        'mostrar_precio_anterior',
        'mostrar_porcentaje_variacion',
        'mostrar_bulto',
        'mostrar_ultima_compra',
        'mostrar_diferencia_pesos',
        'mostrar_codigos',
        'mostrar_metricas_pie',
        'mostrar_nombre_lista'
    ];
    let override = null;
    for (const k of keys) {
        if (query[k] !== undefined) {
            if (!override) override = {};
            override[k] = query[k] === 'true' || query[k] === '1' || query[k] === true;
        }
    }
    return override;
}

/**
 * GET /api/produccion/precios/informe-html/:cliente_id
 * Devuelve el documento HTML oficial renderizado para previsualización directa o iframe
 */
router.get('/precios/informe-html/:cliente_id', async (req, res) => {
    try {
        const { cliente_id } = req.params;
        const { dias } = req.query;
        const configOverride = extraerConfigOverrideQuery(req.query);
        const html = await historialPreciosService.generarHTMLInformePreciosCliente({
            cliente_id,
            dias: dias || 90,
            configOverride
        });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error(`❌ Error en GET /precios/informe-html/${req.params.cliente_id}:`, err);
        res.status(500).send(`<h3>Error al generar informe: ${err.message}</h3>`);
    }
});

/**
 * GET /api/produccion/precios/informe-pdf/:cliente_id
 * Genera y transmite el PDF binario oficial para descarga o impresión
 */
router.get('/precios/informe-pdf/:cliente_id', async (req, res) => {
    try {
        const { cliente_id } = req.params;
        const { dias } = req.query;
        const configOverride = extraerConfigOverrideQuery(req.query);
        const pdfBuffer = await historialPreciosService.generarPDFInformePreciosBuffer(cliente_id, {
            dias: dias || 90,
            configOverride
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Informe_Precios_LAMDA_Cliente_${cliente_id}.pdf"`);
        res.end(pdfBuffer);
    } catch (err) {
        console.error(`❌ Error en GET /precios/informe-pdf/${req.params.cliente_id}:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/produccion/precios/cliente-contactos/:cliente_id
 * Obtiene los contactos de WhatsApp y Correo Electrónico del cliente para el modal de pre-envío omnicanal
 */
router.get('/precios/cliente-contactos/:cliente_id', async (req, res) => {
    try {
        const { cliente_id } = req.params;
        const data = await historialPreciosService.obtenerContactosClienteOmnicanal(cliente_id);
        res.json({ success: true, data });
    } catch (err) {
        console.error(`❌ Error en GET /precios/cliente-contactos/${req.params.cliente_id}:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PATCH /api/produccion/precios/cliente-contactos/:cliente_id
 * Guarda los contactos predeterminados (WhatsApp y Correo) en Búnker Clientes / Configuración
 */
router.patch('/precios/cliente-contactos/:cliente_id', async (req, res) => {
    try {
        const { cliente_id } = req.params;
        const result = await historialPreciosService.guardarContactosClienteOmnicanal(cliente_id, req.body || {});
        res.json(result);
    } catch (err) {
        console.error(`❌ Error en PATCH /precios/cliente-contactos/${req.params.cliente_id}:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/produccion/precios/informe-enviar/:cliente_id
 * Genera el informe PDF y lo despacha por WhatsApp y/o Correo Electrónico usando el servicio del puerto 3004
 */
router.post('/precios/informe-enviar/:cliente_id', async (req, res) => {
    try {
        const { cliente_id } = req.params;
        const {
            dias,
            configOverride,
            destinatariosWp,
            destinatariosEmail,
            mensajeTexto,
            marcarNotificado
        } = req.body || {};

        const result = await historialPreciosService.enviarInformePreciosOmnicanal(cliente_id, {
            dias: dias || 90,
            configOverride: configOverride || null,
            destinatariosWp,
            destinatariosEmail,
            mensajeTexto,
            marcarNotificado: marcarNotificado !== false
        });
        res.json(result);
    } catch (err) {
        console.error(`❌ Error en POST /precios/informe-enviar/${req.params.cliente_id}:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/produccion/articulos/cable-ingrediente
 * Resuelve el "Cable" Artículo <-> Ingrediente y los kilos por unidad comercial del artículo
 * para la operatoria "Cargar Saldo de Ingrediente" en Presupuestos.
 */
router.get('/articulos/cable-ingrediente', async (req, res) => {
    try {
        const codigoRaw = (req.query.codigo || '').toString().trim();
        const descripcionRaw = (req.query.descripcion || '').toString().trim();

        if (!codigoRaw && !descripcionRaw) {
            return res.status(400).json({ success: false, error: 'Se requiere código o descripción del artículo' });
        }

        // 1. Buscar metadatos del artículo (numero interno, codigo_barras, descripcion, kilos_unidad)
        const artQuery = `
            SELECT 
                COALESCE(a.numero, ba.articulo_id, src.articulo_numero, $1) AS articulo_numero,
                COALESCE(a.codigo_barras, src.codigo_barras, ba.articulo_id, $1) AS codigo_barras,
                COALESCE(ba.descripcion, src.descripcion, a.nombre, $2) AS descripcion,
                COALESCE(
                    NULLIF(ba.kilos_unidad::numeric, 0),
                    NULLIF(src.kilos_unidad::numeric, 0),
                    0
                ) AS kilos_unidad_bd
            FROM (SELECT 1) dummy
            LEFT JOIN public.articulos a ON (TRIM(a.codigo_barras) = $1 OR TRIM(a.numero) = $1)
            LEFT JOIN public.bunker_articulos ba ON (TRIM(ba.articulo_id) = COALESCE(a.numero, $1) OR TRIM(ba.articulo_id) = $1)
            LEFT JOIN public.stock_real_consolidado src ON (TRIM(src.articulo_numero) = COALESCE(a.numero, $1) OR TRIM(src.codigo_barras) = $1)
            LIMIT 1
        `;
        const artRes = await pool.query(artQuery, [codigoRaw, descripcionRaw]);
        const artRow = artRes.rows[0] || {
            articulo_numero: codigoRaw,
            codigo_barras: codigoRaw,
            descripcion: descripcionRaw,
            kilos_unidad_bd: 0
        };

        // Determinar kilos_unidad (priorizando regex si en BD dice 0 o 1 pero la descripción explicita "x 5 kg", etc.)
        let kilosUnidad = parseFloat(artRow.kilos_unidad_bd) || 0;
        const descParaRegex = `${artRow.descripcion || ''} ${descripcionRaw || ''}`;
        const matchPeso = descParaRegex.match(/(?:x|por|\*)\s*(\d+(?:[.,]\d+)?)\s*(kg|kilo|kilos|g|gr|gramos)\b/i)
            || descParaRegex.match(/\b(\d+(?:[.,]\d+)?)\s*(kg|kilo|kilos)\b/i);

        let kilosRegex = 0;
        if (matchPeso) {
            const valor = parseFloat(matchPeso[1].replace(',', '.'));
            const unidad = matchPeso[2].toLowerCase();
            if (!isNaN(valor) && valor > 0) {
                kilosRegex = (unidad === 'g' || unidad === 'gr' || unidad === 'gramos') ? (valor / 1000) : valor;
            }
        }

        if (kilosUnidad <= 0 || (kilosUnidad === 1 && kilosRegex > 0 && kilosRegex !== 1)) {
            if (kilosRegex > 0) kilosUnidad = kilosRegex;
        }
        if (kilosUnidad <= 0) kilosUnidad = 1;

        // 2. Buscar ingredientes vinculados por el "Cable" (4 fuentes en orden de prioridad)
        const cableQuery = `
            WITH codigos_art AS (
                SELECT DISTINCT unnest(ARRAY[
                    NULLIF(TRIM($1::text), ''),
                    NULLIF(TRIM($2::text), ''),
                    NULLIF(TRIM($3::text), '')
                ]) AS cod
            ),
            vinculos AS (
                -- Prioridad 1: ingrediente_articulos_nutrientes (El artículo nutre al ingrediente)
                SELECT 
                    i.id, i.codigo, i.nombre, COALESCE(i.stock_actual, 0) AS stock_actual,
                    COALESCE(i.unidad_medida, 'KG') AS unidad_medida, COALESCE(s.nombre, s.descripcion) AS sector_letra,
                    'Artículo Nutriente de Ingrediente' AS origen_vinculo,
                    1 AS prioridad
                FROM public.ingrediente_articulos_nutrientes ian
                JOIN public.ingredientes i ON i.id = ian.ingrediente_id
                LEFT JOIN public.sectores_ingredientes s ON s.id = i.sector_id
                WHERE TRIM(ian.articulo_numero) IN (SELECT cod FROM codigos_art WHERE cod IS NOT NULL)
                  AND COALESCE(ian.activo, true) = true

                UNION ALL

                -- Prioridad 2: ingrediente_bunker_articulos (Vínculo Búnker <-> Ingrediente)
                SELECT 
                    i.id, i.codigo, i.nombre, COALESCE(i.stock_actual, 0) AS stock_actual,
                    COALESCE(i.unidad_medida, 'KG') AS unidad_medida, COALESCE(s.nombre, s.descripcion) AS sector_letra,
                    'Vínculo Búnker-Ingrediente' AS origen_vinculo,
                    2 AS prioridad
                FROM public.ingrediente_bunker_articulos iba
                JOIN public.ingredientes i ON i.id = iba.ingrediente_id
                LEFT JOIN public.sectores_ingredientes s ON s.id = i.sector_id
                WHERE TRIM(iba.bunker_articulo_id::text) IN (SELECT cod FROM codigos_art WHERE cod IS NOT NULL)

                UNION ALL

                -- Prioridad 3: ingredientes.articulo_vinculado_numero
                SELECT 
                    i.id, i.codigo, i.nombre, COALESCE(i.stock_actual, 0) AS stock_actual,
                    COALESCE(i.unidad_medida, 'KG') AS unidad_medida, COALESCE(s.nombre, s.descripcion) AS sector_letra,
                    'Artículo Vinculado Directo' AS origen_vinculo,
                    3 AS prioridad
                FROM public.ingredientes i
                LEFT JOIN public.sectores_ingredientes s ON s.id = i.sector_id
                WHERE TRIM(i.articulo_vinculado_numero) IN (SELECT cod FROM codigos_art WHERE cod IS NOT NULL)

                UNION ALL

                -- Prioridad 4: Receta del artículo (Mono-ingrediente o ingredientes de su receta)
                SELECT 
                    i.id, i.codigo, i.nombre, COALESCE(i.stock_actual, 0) AS stock_actual,
                    COALESCE(i.unidad_medida, 'KG') AS unidad_medida, COALESCE(s.nombre, s.descripcion) AS sector_letra,
                    'Receta del Artículo' AS origen_vinculo,
                    4 AS prioridad
                FROM public.recetas r
                JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                JOIN public.ingredientes i ON i.id = ri.ingrediente_id
                LEFT JOIN public.sectores_ingredientes s ON s.id = i.sector_id
                WHERE TRIM(r.articulo_numero) IN (SELECT cod FROM codigos_art WHERE cod IS NOT NULL)
            )
            SELECT DISTINCT ON (id)
                id, codigo, nombre, stock_actual, unidad_medida, sector_letra, origen_vinculo, prioridad
            FROM vinculos
            ORDER BY id, prioridad ASC
        `;

        const cableRes = await pool.query(cableQuery, [
            codigoRaw,
            artRow.articulo_numero || '',
            artRow.codigo_barras || ''
        ]);

        // Ordenar por prioridad y mayor stock
        const candidatos = cableRes.rows.sort((a, b) => {
            if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
            return parseFloat(b.stock_actual || 0) - parseFloat(a.stock_actual || 0);
        });

        res.json({
            success: true,
            articulo: {
                codigo_enviado: codigoRaw,
                articulo_numero: artRow.articulo_numero,
                codigo_barras: artRow.codigo_barras,
                descripcion: artRow.descripcion || descripcionRaw,
                kilos_unidad: kilosUnidad
            },
            candidatos_cable: candidatos
        });
    } catch (err) {
        console.error('❌ Error en GET /articulos/cable-ingrediente:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/produccion/etiquetas/saldo-ingrediente
 * Imprime la etiqueta Zebra de identificación para el paquete de saldo fraccionado de ingrediente,
 * manteniendo el código de barras del artículo del presupuesto para que escanee en Bandeja de Verificación.
 */
router.post('/etiquetas/saldo-ingrediente', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const { exec } = require('child_process');

        const {
            nombre,
            codigo_barras,
            kilos_saldo,
            cantidad_equivalente,
            ingrediente_nombre,
            cantidad_etiquetas
        } = req.body || {};

        if (!nombre || !codigo_barras) {
            return res.status(400).json({ success: false, error: 'Faltan datos de artículo o código de barras para imprimir' });
        }

        const kilosFmt = parseFloat(kilos_saldo || 0).toFixed(3).replace(/\.?0+$/, '');
        const cantEqFmt = parseFloat(cantidad_equivalente || 0).toFixed(3).replace(/\.?0+$/, '');
        const datosEtiqueta = {
            nombre: `${nombre}`.substring(0, 65),
            numero: `SALDO: ${kilosFmt} KG (${cantEqFmt} u)`,
            codigo_barras: String(codigo_barras).trim()
        };

        const cantCopias = Math.max(1, parseInt(cantidad_etiquetas, 10) || 1);
        const scriptPath = path.resolve(__dirname, '../../scripts/imprimirEtiqueta.js');
        const tempDir = path.resolve(__dirname, '../../app-etiquetas/temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        const tempDataPath = path.join(tempDir, 'temp-data.json');
        fs.writeFileSync(tempDataPath, JSON.stringify(datosEtiqueta, null, 2));

        const srcDir = path.resolve(__dirname, '../..');
        const command = `cd "${srcDir}" && node "${scriptPath}" ${cantCopias}`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Error al imprimir etiqueta de saldo:', error);
                return res.status(500).json({ success: false, error: 'Error al enviar impresión a Zebra' });
            }
            console.log(`🖨️ Etiqueta de saldo enviada correctamente:`, datosEtiqueta);
            res.json({ success: true, message: 'Etiqueta de saldo enviada a impresora Zebra', datos: datosEtiqueta });
        });
    } catch (err) {
        console.error('❌ Error en POST /etiquetas/saldo-ingrediente:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =========================================================================
// EDITOR DIRECTO Y NO DESTRUCTIVO DE UPs / RECETAS + FRACCIONADO POST-ASENTADO
// =========================================================================
const {
    obtenerConfiguracionUpRecetaDirecta,
    guardarConfiguracionUpRecetaDirecta
} = require('../controllers/upRecetaDirectaController');
const {
    obtenerFraccionesDeterministasPorAp,
    crearCarroInternoFraccionadoDesdeAp
} = require('../controllers/fraccionadoPostAsentadoController');

router.get('/ui/editor-up-receta-directo.js', (req, res) => {
    const path = require('path');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(path.resolve(__dirname, '../js/components/editorUpRecetaDirecto.js'));
});

router.get('/up-receta-directa/:codigo', obtenerConfiguracionUpRecetaDirecta);
router.put('/up-receta-directa/:codigo', guardarConfiguracionUpRecetaDirecta);
router.get('/articulos-puente/:sku/fracciones-deterministas', obtenerFraccionesDeterministasPorAp);
router.post('/articulos-puente/:sku/crear-carro-fraccionado', crearCarroInternoFraccionadoDesdeAp);

module.exports = router;




