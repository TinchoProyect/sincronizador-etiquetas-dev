const pool = require('../../usuarios/pool');
const { validarPropiedadCarro } = require('./carro');
const { obtenerIngredientesBaseCarro, obtenerMixesCarro } = require('./carroIngredientes');

/**
 * Obtiene todos los ingredientes consolidados de un carro (recetas + ingresos manuales)
 * ordenados por sector para el modal de guardado de ingredientes
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function obtenerIngredientesConsolidadosCarro(req, res) {
    try {
        const { carroId } = req.params;
        const { usuarioId } = req.query;

        console.log(`\n🔍 INICIANDO CONSOLIDACIÓN DE INGREDIENTES PARA GUARDADO`);
        console.log(`===============================================`);
        console.log(`📦 Carro ID: ${carroId}`);
        console.log(`👤 Usuario ID: ${usuarioId}`);

        // Validar parámetros
        if (!carroId || !usuarioId) {
            return res.status(400).json({ 
                error: 'Faltan parámetros obligatorios: carroId y usuarioId' 
            });
        }

        // Validar que el carro pertenece al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            return res.status(403).json({ 
                error: 'El carro no pertenece al usuario especificado' 
            });
        }

        // Verificar que el carro está finalizado
        const queryEstadoCarro = `
            SELECT fecha_confirmacion, tipo_carro
            FROM carros_produccion 
            WHERE id = $1
        `;
        const estadoResult = await pool.query(queryEstadoCarro, [carroId]);
        
        if (estadoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Carro no encontrado' });
        }

        const carro = estadoResult.rows[0];
        if (!carro.fecha_confirmacion) {
            return res.status(400).json({ 
                error: 'El carro debe estar finalizado para acceder al guardado de ingredientes' 
            });
        }

        console.log(`✅ Carro validado - Tipo: ${carro.tipo_carro}, Finalizado: ${carro.fecha_confirmacion}`);

        // PASO 1: Obtener ingredientes de recetas (ya consolidados)
        console.log(`\n📋 PASO 1: Obteniendo ingredientes de recetas...`);
        let ingredientesRecetas = [];
        try {
            ingredientesRecetas = await obtenerIngredientesBaseCarro(carroId, usuarioId);
            console.log(`✅ Ingredientes de recetas obtenidos: ${ingredientesRecetas.length}`);
        } catch (error) {
            console.warn(`⚠️ Error obteniendo ingredientes de recetas: ${error.message}`);
        }

        // PASO 2: Obtener ingredientes de ingresos manuales
        console.log(`\n📋 PASO 2: Obteniendo ingredientes de ingresos manuales...`);
        const queryIngresosManuales = `
            SELECT DISTINCT 
                im.ingrediente_id,
                i.nombre,
                i.unidad_medida,
                i.stock_actual,
                i.codigo,
                i.sector_id,
                s.nombre as sector_nombre,
                SUM(im.kilos) as cantidad_ingresada
            FROM ingredientes_movimientos im
            JOIN ingredientes i ON i.id = im.ingrediente_id
            LEFT JOIN sectores_ingredientes s ON s.id = i.sector_id
            WHERE im.carro_id = $1 AND im.tipo = 'ingreso'
            GROUP BY im.ingrediente_id, i.nombre, i.unidad_medida, i.stock_actual, i.codigo, i.sector_id, s.nombre
            ORDER BY s.nombre ASC NULLS LAST, i.nombre ASC
        `;
        
        const ingresosResult = await pool.query(queryIngresosManuales, [carroId]);
        const ingredientesIngresos = ingresosResult.rows;
        
        console.log(`✅ Ingredientes de ingresos manuales obtenidos: ${ingredientesIngresos.length}`);
        ingredientesIngresos.forEach((ing, index) => {
            console.log(`  ${index + 1}. ${ing.nombre} - Ingresado: ${ing.cantidad_ingresada}kg - Sector: ${ing.sector_nombre || 'Sin sector'}`);
        });

        // PASO 3: Consolidar ingredientes eliminando duplicados
        console.log(`\n📋 PASO 3: Consolidando ingredientes...`);
        const ingredientesConsolidados = new Map();

        // Agregar ingredientes de recetas
        ingredientesRecetas.forEach(ing => {
            if (ing.id) {
                ingredientesConsolidados.set(ing.id, {
                    id: ing.id,
                    nombre: ing.nombre,
                    unidad_medida: ing.unidad_medida,
                    cantidad_necesaria: Number(parseFloat(ing.cantidad).toFixed(3)),
                    stock_actual: Number(parseFloat(ing.stock_actual).toFixed(3)),
                    codigo: null, // Se obtendrá en el siguiente paso
                    sector_id: null, // Se obtendrá en el siguiente paso
                    sector_nombre: null,
                    origen: 'receta',
                    cantidad_ingresada: 0
                });
            }
        });

        // Agregar/actualizar con ingredientes de ingresos manuales
        ingredientesIngresos.forEach(ing => {
            const existente = ingredientesConsolidados.get(ing.ingrediente_id);
            if (existente) {
                // Si ya existe, actualizar cantidad ingresada, sector y código
                existente.cantidad_ingresada = Number(parseFloat(ing.cantidad_ingresada).toFixed(3));
                existente.codigo = ing.codigo;
                existente.sector_id = ing.sector_id;
                existente.sector_nombre = ing.sector_nombre;
                existente.origen = 'ambos';
            } else {
                // Si no existe, agregar como nuevo
                ingredientesConsolidados.set(ing.ingrediente_id, {
                    id: ing.ingrediente_id,
                    nombre: ing.nombre,
                    unidad_medida: ing.unidad_medida,
                    cantidad_necesaria: 0,
                    stock_actual: Number(parseFloat(ing.stock_actual).toFixed(3)),
                    codigo: ing.codigo,
                    sector_id: ing.sector_id,
                    sector_nombre: ing.sector_nombre,
                    origen: 'ingreso_manual',
                    cantidad_ingresada: Number(parseFloat(ing.cantidad_ingresada).toFixed(3))
                });
            }
        });

        // PASO 4: Obtener información de sectores y códigos para ingredientes de recetas
        console.log(`\n📋 PASO 4: Completando información de sectores y códigos...`);
        const ingredientesSinInfo = Array.from(ingredientesConsolidados.values())
            .filter(ing => (ing.sector_id === null || ing.codigo === null) && ing.id);

        if (ingredientesSinInfo.length > 0) {
            const idsIngredientes = ingredientesSinInfo.map(ing => ing.id);
            const querySectores = `
                SELECT 
                    i.id,
                    i.codigo,
                    i.sector_id,
                    s.nombre as sector_nombre
                FROM ingredientes i
                LEFT JOIN sectores_ingredientes s ON s.id = i.sector_id
                WHERE i.id = ANY($1)
            `;
            
            const sectoresResult = await pool.query(querySectores, [idsIngredientes]);
            
            sectoresResult.rows.forEach(sector => {
                const ingrediente = ingredientesConsolidados.get(sector.id);
                if (ingrediente) {
                    ingrediente.codigo = sector.codigo;
                    ingrediente.sector_id = sector.sector_id;
                    ingrediente.sector_nombre = sector.sector_nombre;
                }
            });
        }

        // PASO 5: Convertir a array y ordenar por sector
        const ingredientesFinales = Array.from(ingredientesConsolidados.values())
            .sort((a, b) => {
                // Primero por sector (sin sector al final)
                if (a.sector_nombre && !b.sector_nombre) return -1;
                if (!a.sector_nombre && b.sector_nombre) return 1;
                if (a.sector_nombre && b.sector_nombre) {
                    const sectorCompare = a.sector_nombre.localeCompare(b.sector_nombre);
                    if (sectorCompare !== 0) return sectorCompare;
                }
                // Luego por nombre de ingrediente
                return a.nombre.localeCompare(b.nombre);
            });

        console.log(`\n✅ CONSOLIDACIÓN COMPLETADA`);
        console.log(`📊 Total ingredientes consolidados: ${ingredientesFinales.length}`);
        console.log(`📋 Resumen por origen:`);
        
        const resumenOrigen = ingredientesFinales.reduce((acc, ing) => {
            acc[ing.origen] = (acc[ing.origen] || 0) + 1;
            return acc;
        }, {});
        
        Object.entries(resumenOrigen).forEach(([origen, cantidad]) => {
            console.log(`  - ${origen}: ${cantidad} ingredientes`);
        });

        console.log(`\n📋 Ingredientes por sector:`);
        const ingredientesPorSector = ingredientesFinales.reduce((acc, ing) => {
            const sector = ing.sector_nombre || 'Sin sector';
            if (!acc[sector]) acc[sector] = [];
            acc[sector].push(ing.nombre);
            return acc;
        }, {});

        Object.entries(ingredientesPorSector).forEach(([sector, ingredientes]) => {
            console.log(`  🏢 ${sector}: ${ingredientes.length} ingredientes`);
            ingredientes.forEach((nombre, index) => {
                console.log(`    ${index + 1}. ${nombre}`);
            });
        });

        console.log(`===============================================\n`);

        res.json({
            success: true,
            carro_id: parseInt(carroId),
            total_ingredientes: ingredientesFinales.length,
            ingredientes: ingredientesFinales
        });

    } catch (error) {
        console.error('❌ Error al obtener ingredientes consolidados:', error);
        console.error('❌ Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Error interno al obtener ingredientes consolidados',
            detalle: error.message 
        });
    }
}

/**
 * Realiza un ajuste manual de stock para un ingrediente
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function ajustarStockIngrediente(req, res) {
    try {
        const { ingredienteId } = req.params;
        const { cantidad_ajuste, observaciones, usuario_id, carro_id } = req.body;

        console.log(`\n🔧 INICIANDO AJUSTE MANUAL DE STOCK`);
        console.log(`===============================================`);
        console.log(`🧪 Ingrediente ID: ${ingredienteId}`);
        console.log(`📊 Cantidad ajuste: ${cantidad_ajuste}`);
        console.log(`👤 Usuario ID: ${usuario_id}`);
        console.log(`📦 Carro ID: ${carro_id}`);
        console.log(`📝 Observaciones: ${observaciones || 'Sin observaciones'}`);

        // Validar parámetros
        if (!ingredienteId || cantidad_ajuste === undefined || !usuario_id) {
            return res.status(400).json({ 
                error: 'Faltan parámetros obligatorios: ingredienteId, cantidad_ajuste, usuario_id' 
            });
        }

        const cantidadNumerica = parseFloat(cantidad_ajuste);
        if (isNaN(cantidadNumerica)) {
            return res.status(400).json({ 
                error: 'La cantidad de ajuste debe ser un número válido' 
            });
        }

        // Si la cantidad es 0, no hacer nada
        if (cantidadNumerica === 0) {
            console.log(`ℹ️ Cantidad de ajuste es 0, no se registra movimiento`);
            return res.json({ 
                success: true, 
                mensaje: 'No se realizó ajuste (cantidad = 0)',
                stock_actualizado: null
            });
        }

        // Verificar que el ingrediente existe
        const queryIngrediente = `
            SELECT id, nombre, stock_actual 
            FROM ingredientes 
            WHERE id = $1
        `;
        const ingredienteResult = await pool.query(queryIngrediente, [ingredienteId]);
        
        if (ingredienteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ingrediente no encontrado' });
        }

        const ingrediente = ingredienteResult.rows[0];
        const stockAnterior = parseFloat(ingrediente.stock_actual) || 0;

        console.log(`✅ Ingrediente encontrado: ${ingrediente.nombre}`);
        console.log(`📊 Stock anterior: ${stockAnterior}`);
        console.log(`📊 Stock después del ajuste: ${stockAnterior + cantidadNumerica}`);

        // Validar que no se genere stock negativo
        if (stockAnterior + cantidadNumerica < 0) {
            return res.status(400).json({ 
                error: `El ajuste generaría stock negativo. Stock actual: ${stockAnterior}, Ajuste: ${cantidadNumerica}` 
            });
        }

        // 🔧 CORRECCIÓN: Siempre usar "ajuste" para movimientos desde guardado de ingredientes
        const tipoMovimiento = 'ajuste';
        const observacionesCompletas = `Ajuste manual desde guardado de ingredientes${carro_id ? ` - Carro #${carro_id}` : ''}${observaciones ? ` - ${observaciones}` : ''}`;

        // Log de depuración para auditoría
        console.log("🔍 DEBUG - Guardando ajuste de ingrediente", {
            ingrediente_id: ingredienteId,
            cantidadNumerica,
            tipo: tipoMovimiento,
            carro_id: carro_id || null
        });

        const queryMovimiento = `
            INSERT INTO ingredientes_movimientos (
                ingrediente_id, 
                tipo, 
                kilos, 
                fecha, 
                carro_id, 
                observaciones
            ) VALUES ($1, $2, $3, NOW(), $4, $5)
            RETURNING id
        `;

        console.log(`📝 Registrando movimiento de ${tipoMovimiento}...`);
        const movimientoResult = await pool.query(queryMovimiento, [
            ingredienteId,
            tipoMovimiento,
            cantidadNumerica, // Usar valor con signo original
            carro_id || null,
            observacionesCompletas
        ]);

        const movimientoId = movimientoResult.rows[0].id;
        console.log(`✅ Movimiento registrado con ID: ${movimientoId}`);

        // Obtener el stock actualizado (el trigger ya lo habrá actualizado)
        const queryStockActualizado = `
            SELECT stock_actual 
            FROM ingredientes 
            WHERE id = $1
        `;
        const stockActualizadoResult = await pool.query(queryStockActualizado, [ingredienteId]);
        const stockNuevo = parseFloat(stockActualizadoResult.rows[0].stock_actual) || 0;

        console.log(`📊 Stock actualizado por trigger: ${stockNuevo}`);
        console.log(`✅ Diferencia aplicada: ${stockNuevo - stockAnterior}`);
        console.log(`===============================================\n`);

        res.json({
            success: true,
            mensaje: 'Ajuste de stock realizado correctamente',
            ingrediente_id: parseInt(ingredienteId),
            ingrediente_nombre: ingrediente.nombre,
            movimiento_id: movimientoId,
            stock_anterior: stockAnterior,
            stock_nuevo: stockNuevo,
            cantidad_ajustada: cantidadNumerica,
            tipo_movimiento: tipoMovimiento
        });

    } catch (error) {
        console.error('❌ Error al ajustar stock de ingrediente:', error);
        console.error('❌ Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Error interno al ajustar stock',
            detalle: error.message 
        });
    }
}

module.exports = {
    obtenerIngredientesConsolidadosCarro,
    ajustarStockIngrediente
};
