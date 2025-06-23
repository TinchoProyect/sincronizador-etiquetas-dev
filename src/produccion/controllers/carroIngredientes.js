const pool = require('../../usuarios/pool');
const { expandirIngrediente } = require('../utils/ingredientes/expandirIngredientes');
const { consolidarIngredientes } = require('../utils/ingredientes/consolidarIngredientes');
const { validarPropiedadCarro } = require('./carro');

/**
 * Verifica si un ingrediente es un mix consultando la tabla ingrediente_composicion
 * @param {number} ingredienteId - ID del ingrediente a verificar
 * @returns {Promise<boolean>} true si es mix, false si es ingrediente simple
 */
async function verificarSiEsMix(ingredienteId) {
    try {
        const query = `
            SELECT COUNT(*)::integer as count 
            FROM ingrediente_composicion 
            WHERE mix_id = $1
        `;
        const result = await pool.query(query, [ingredienteId]);
        return result.rows[0].count > 0;
    } catch (error) {
        console.error(`Error verificando si ingrediente ${ingredienteId} es mix:`, error);
        return false;
    }
}


/**
 * Busca un ingrediente por nombre y retorna su ID
 * @param {string} nombre - Nombre del ingrediente a buscar
 * @returns {Promise<number|null>} ID del ingrediente o null si no se encuentra
 */
async function buscarIngredientePorNombre(nombre) {
    try {
        const query = `
            SELECT id 
            FROM ingredientes 
            WHERE LOWER(nombre) = LOWER($1)
        `;
        const result = await pool.query(query, [nombre]);
        return result.rows[0]?.id || null;
    } catch (error) {
        console.error(`Error buscando ingrediente por nombre ${nombre}:`, error);
        return null;
    }
}

/**
 * Obtiene todos los ingredientes base necesarios para un carro,
 * expandiendo mixes y consolidando cantidades
 * @param {number} carroId - ID del carro
 * @param {number} usuarioId - ID del usuario que solicita los ingredientes
 * @returns {Promise<Array>} Lista de ingredientes base consolidados
 */
async function obtenerIngredientesBaseCarro(carroId, usuarioId) {
    try {
        console.log(`\n🚀 INICIANDO ANÁLISIS DE CARRO ${carroId}`);
        console.log(`===============================================`);
        
        // Validar que el carro pertenece al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // 1. Obtener artículos del carro
        const queryArticulos = `
            SELECT 
                ca.articulo_numero,
                ca.cantidad
            FROM carros_articulos ca
            WHERE ca.carro_id = $1
        `;
        const articulosResult = await pool.query(queryArticulos, [carroId]);
        console.log(`📦 ARTÍCULOS EN EL CARRO: ${articulosResult.rows.length}`);
        articulosResult.rows.forEach((art, index) => {
            console.log(`  ${index + 1}. ${art.articulo_numero} - Cantidad: ${art.cantidad}`);
        });

        // 2. Por cada artículo, obtener sus ingredientes
        let todosLosIngredientes = [];
        for (const articulo of articulosResult.rows) {
            console.log(`\n🔍 PROCESANDO ARTÍCULO: ${articulo.articulo_numero}`);
            console.log(`Cantidad solicitada: ${articulo.cantidad}`);
            // Obtener la receta del artículo
            const queryReceta = `
                SELECT 
                    ri.ingrediente_id,
                    CAST(ri.cantidad AS DECIMAL(20,10)) as cantidad,
                    COALESCE(i.nombre, ri.nombre_ingrediente) as nombre_ingrediente,
                    COALESCE(i.unidad_medida, 'Kilo') as unidad_medida
                FROM recetas r
                JOIN receta_ingredientes ri ON r.id = ri.receta_id
                LEFT JOIN ingredientes i ON i.id = ri.ingrediente_id
                WHERE r.articulo_numero = $1
            `;
            const recetaResult = await pool.query(queryReceta, [articulo.articulo_numero]);
            console.log("🔎 recetaResult para", articulo.articulo_numero, recetaResult.rows);

            // Por cada ingrediente en la receta
            for (const ing of recetaResult.rows) {
                // Mantener alta precisión en el cálculo de cantidad total
                const cantidadTotal = Number((ing.cantidad * articulo.cantidad).toPrecision(10));
                
                console.log(`\n🔍 ANÁLISIS DE CANTIDADES - ${articulo.articulo_numero}`);
                console.log(`=====================================================`);
                console.log(`1️⃣ DATOS DE ENTRADA:`);
                console.log(`- Cantidad en receta: ${ing.cantidad}kg`);
                console.log(`- Unidades pedidas: ${articulo.cantidad}`);
                console.log(`2️⃣ CÁLCULO CORREGIDO:`);
                console.log(`${ing.cantidad} × ${articulo.cantidad} = ${cantidadTotal}kg`);
                console.log(`✅ El peso unitario se manejará en expandirIngrediente via receta_base_kg`);
                console.log(`=====================================================\n`);
                
                let ingredienteIdParaExpandir = ing.ingrediente_id;
                
                // Si ingrediente_id es null, buscar por nombre
                if (!ingredienteIdParaExpandir) {
                    console.log(`🔍 ingrediente_id es NULL para ${ing.nombre_ingrediente}, buscando por nombre...`);
                    ingredienteIdParaExpandir = await buscarIngredientePorNombre(ing.nombre_ingrediente);
                    if (ingredienteIdParaExpandir) {
                        console.log(`✅ ID encontrado por nombre: ${ingredienteIdParaExpandir} para ${ing.nombre_ingrediente}`);
                    } else {
                        console.log(`⚠️ No se encontró ID para ${ing.nombre_ingrediente}, omitiendo expansión`);
                    }
                }
                
                let ingredientesExpandidos = [];
                if (ingredienteIdParaExpandir) {
                    const esMix = await verificarSiEsMix(ingredienteIdParaExpandir);
                    
                    if (esMix) {
                        console.log(`✅ Ingrediente ${ing.nombre_ingrediente} (ID: ${ingredienteIdParaExpandir}) es un MIX - procediendo a expandir`);
                        ingredientesExpandidos = await expandirIngrediente(
                            ingredienteIdParaExpandir,
                            cantidadTotal,
                            new Set(),
                            ingredienteIdParaExpandir // Pasar el ID del mix como origen_mix_id
                        );
                        
                        if (ingredientesExpandidos.length > 0) {
                            todosLosIngredientes = todosLosIngredientes.concat(ingredientesExpandidos);
                        } else {
                            console.log(`⚠️ Error: No se obtuvieron ingredientes expandidos para el mix ${ing.nombre_ingrediente}`);
                        }
                    } else {
                        console.log(`ℹ️ Ingrediente ${ing.nombre_ingrediente} (ID: ${ingredienteIdParaExpandir}) es un ingrediente simple - agregando directamente`);
                        // Para ingredientes simples, agregar directamente
                        todosLosIngredientes.push({
                            id: ingredienteIdParaExpandir,
                            nombre: ing.nombre_ingrediente,
                            unidad_medida: ing.unidad_medida,
                            cantidad: cantidadTotal
                        });
                    }
                } else {
                    console.log(`⚠️ No se encontró ID para ${ing.nombre_ingrediente} - agregando sin ID`);
                    // Si no se encontró ID, agregar sin ID (fallback)
                    todosLosIngredientes.push({
                        id: null,
                        nombre: ing.nombre_ingrediente,
                        unidad_medida: ing.unidad_medida,
                        cantidad: cantidadTotal
                    });
                }
            }

            // Si el artículo no tiene receta, verificar si es un mix o ingrediente primario
            if (recetaResult.rows.length === 0) {
                console.log(`📦 Artículo ${articulo.articulo_numero} sin receta - verificando tipo`);
                const queryIngredientePrimario = `
                    SELECT id, nombre, unidad_medida
                    FROM ingredientes
                    WHERE LOWER(nombre) = LOWER($1)
                `;
                const ingredientePrimario = await pool.query(queryIngredientePrimario, [articulo.articulo_numero]);

                if (ingredientePrimario.rows.length > 0) {
                    const ingredienteId = ingredientePrimario.rows[0].id;
                    const esMix = await verificarSiEsMix(ingredienteId);

                    if (esMix) {
                        console.log(`✅ Artículo ${articulo.articulo_numero} es un MIX - expandiendo componentes`);
                        const ingredientesExpandidos = await expandirIngrediente(
                            ingredienteId,
                            articulo.cantidad
                        );
                        if (ingredientesExpandidos.length > 0) {
                            todosLosIngredientes = todosLosIngredientes.concat(ingredientesExpandidos);
                        } else {
                            console.log(`⚠️ Error: No se obtuvieron ingredientes expandidos para el mix ${articulo.articulo_numero}`);
                        }
                    } else {
                        console.log(`✅ Artículo ${articulo.articulo_numero} es ingrediente primario - agregando directamente`);
                        todosLosIngredientes.push({
                            id: ingredienteId,
                            nombre: ingredientePrimario.rows[0].nombre,
                            unidad_medida: ingredientePrimario.rows[0].unidad_medida,
                            cantidad: articulo.cantidad
                        });
                    }
                } else {
                    console.log(`⚠️ No se encontró ingrediente para artículo ${articulo.articulo_numero}`);
                }
            }
        }

        // 3. Consolidar todos los ingredientes
        const ingredientesConsolidados = consolidarIngredientes(todosLosIngredientes);

        // Obtener el tipo de carro
        const queryTipoCarro = `
            SELECT tipo_carro, usuario_id
            FROM carros_produccion
            WHERE id = $1
        `;
        const tipoCarroResult = await pool.query(queryTipoCarro, [carroId]);
        const tipoCarro = tipoCarroResult.rows[0]?.tipo_carro || 'interna';
        const carroUsuarioId = tipoCarroResult.rows[0]?.usuario_id;

        console.log(`\n🔍 TIPO DE CARRO: ${tipoCarro}`);
        console.log(`Usuario del carro: ${carroUsuarioId}`);

        // 4. Agregar stock_actual a cada ingrediente consolidado según el tipo de carro
        const ingredientesConStock = await Promise.all(
            ingredientesConsolidados.map(async (ingrediente) => {
                if (ingrediente.id) {
                    try {
                        let stockActual = 0;

                        if (tipoCarro === 'externa') {
                            console.log(`\n📦 Obteniendo stock de usuario para ingrediente ${ingrediente.id}`);
                            // Consultar stock del usuario para carros externos
                            const queryStockUsuario = `
                                SELECT SUM(cantidad) as stock_usuario
                                FROM ingredientes_stock_usuarios
                                WHERE usuario_id = $1 AND ingrediente_id = $2
                                GROUP BY ingrediente_id
                            `;
                            const stockUsuarioResult = await pool.query(queryStockUsuario, [carroUsuarioId, ingrediente.id]);
                            stockActual = stockUsuarioResult.rows[0]?.stock_usuario || 0;
                            console.log(`Stock usuario encontrado: ${stockActual}`);
                        } else {
                            console.log(`\n📦 Obteniendo stock central para ingrediente ${ingrediente.id}`);
                            // Consultar stock central para carros internos
                            const queryStock = `
                                SELECT stock_actual 
                                FROM ingredientes 
                                WHERE id = $1
                            `;
                            const stockResult = await pool.query(queryStock, [ingrediente.id]);
                            stockActual = stockResult.rows[0]?.stock_actual || 0;
                            console.log(`Stock central encontrado: ${stockActual}`);
                        }
                        
                        return {
                            ...ingrediente,
                            stock_actual: Number(parseFloat(stockActual).toPrecision(10)),
                            origen_mix_id: ingrediente.origen_mix_id // Preservar origen_mix_id
                        };
                    } catch (error) {
                        console.error(`Error obteniendo stock para ingrediente ${ingrediente.id}:`, error);
                    return {
                        ...ingrediente,
                        stock_actual: 0,
                        origen_mix_id: ingrediente.origen_mix_id // Preservar origen_mix_id también en caso de error
                    };
                    }
                } else {
                    // Si no tiene ID, no podemos obtener stock
                    return {
                        ...ingrediente,
                        stock_actual: 0
                    };
                }
            })
        );

        console.log(`\n📊 INGREDIENTES CON STOCK AGREGADO:`);
        ingredientesConStock.forEach((ing, index) => {
            const estado = ing.stock_actual >= ing.cantidad ? '✅' : '❌';
            console.log(`  ${index + 1}. ${ing.nombre}: Necesario ${ing.cantidad}, Stock ${ing.stock_actual} ${estado}`);
        });

        return ingredientesConStock;

    } catch (error) {
        console.error('Error al obtener ingredientes base del carro:', error);
        throw new Error('No se pudieron obtener los ingredientes del carro');
    }
}

/**
 * Obtiene todos los ingredientes compuestos (mixes) necesarios para un carro,
 * consolidando cantidades sin expandir a ingredientes primarios
 * @param {number} carroId - ID del carro
 * @param {number} usuarioId - ID del usuario que solicita los ingredientes
 * @returns {Promise<Array>} Lista de mixes consolidados
 */
async function obtenerMixesCarro(carroId, usuarioId) {
    try {
        console.log(`\n🧪 INICIANDO ANÁLISIS DE MIXES DEL CARRO ${carroId}`);
        console.log(`===============================================`);
        
        // Validar que el carro pertenece al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // 1. Obtener artículos del carro
        const queryArticulos = `
            SELECT 
                ca.articulo_numero,
                ca.cantidad
            FROM carros_articulos ca
            WHERE ca.carro_id = $1
        `;
        const articulosResult = await pool.query(queryArticulos, [carroId]);
        console.log(`📦 ARTÍCULOS EN EL CARRO: ${articulosResult.rows.length}`);

        // 2. Por cada artículo, obtener sus ingredientes que sean mixes
        let todosLosMixes = [];
        for (const articulo of articulosResult.rows) {
            console.log(`\n🔍 PROCESANDO ARTÍCULO: ${articulo.articulo_numero}`);
            
            // Obtener la receta del artículo
            const queryReceta = `
                SELECT 
                    ri.ingrediente_id,
                    CAST(ri.cantidad AS DECIMAL(20,10)) as cantidad,
                    COALESCE(i.nombre, ri.nombre_ingrediente) as nombre_ingrediente,
                    COALESCE(i.unidad_medida, 'Kilo') as unidad_medida
                FROM recetas r
                JOIN receta_ingredientes ri ON r.id = ri.receta_id
                LEFT JOIN ingredientes i ON i.id = ri.ingrediente_id
                WHERE r.articulo_numero = $1
            `;
            const recetaResult = await pool.query(queryReceta, [articulo.articulo_numero]);

            // Por cada ingrediente en la receta, verificar si es un mix
            for (const ing of recetaResult.rows) {
                let ingredienteIdParaVerificar = ing.ingrediente_id;
                
                // Si ingrediente_id es null, buscar por nombre
                if (!ingredienteIdParaVerificar) {
                    ingredienteIdParaVerificar = await buscarIngredientePorNombre(ing.nombre_ingrediente);
                }
                
                if (ingredienteIdParaVerificar) {
                    const esMix = await verificarSiEsMix(ingredienteIdParaVerificar);
                    
                    if (esMix) {
                        console.log(`✅ Ingrediente ${ing.nombre_ingrediente} (ID: ${ingredienteIdParaVerificar}) es un MIX`);
                        
                        // Mantener alta precisión en el cálculo de cantidad total para mixes
                        const cantidadTotal = Number((ing.cantidad * articulo.cantidad).toPrecision(10));
                        
                        console.log(`\n📊 CÁLCULO DE CANTIDAD PARA MIX EN RECETA:`);
                        console.log(`- Artículo: ${articulo.articulo_numero}`);
                        console.log(`- Cantidad en receta: ${ing.cantidad}kg`);
                        console.log(`- Unidades pedidas: ${articulo.cantidad}`);
                        console.log(`- Cantidad total: ${cantidadTotal}kg`);
                        
                        todosLosMixes.push({
                            id: ingredienteIdParaVerificar,
                            nombre: ing.nombre_ingrediente,
                            unidad_medida: ing.unidad_medida,
                            cantidad: cantidadTotal
                        });
                    }
                }
            }

            // Si el artículo no tiene receta, verificar si el artículo mismo es un mix
            if (recetaResult.rows.length === 0) {
                console.log(`📦 Artículo ${articulo.articulo_numero} sin receta - verificando si es mix`);
                const queryIngrediente = `
                    SELECT id, nombre, unidad_medida
                    FROM ingredientes
                    WHERE LOWER(nombre) = LOWER($1)
                `;
                const ingredienteResult = await pool.query(queryIngrediente, [articulo.articulo_numero]);

                if (ingredienteResult.rows.length > 0) {
                    const ingredienteId = ingredienteResult.rows[0].id;
                    const esMix = await verificarSiEsMix(ingredienteId);
                    
                    if (esMix) {
                        console.log(`✅ Artículo ${articulo.articulo_numero} es un MIX`);
                        
                        // Obtener receta_base_kg del mix
                        const queryRecetaBase = `
                            SELECT receta_base_kg 
                            FROM ingredientes 
                            WHERE id = $1
                        `;
                        const recetaBaseResult = await pool.query(queryRecetaBase, [ingredienteId]);
                        const recetaBaseKg = recetaBaseResult.rows[0]?.receta_base_kg || 10;
                        
                        // Mantener alta precisión en el cálculo de cantidad total para mixes directos
                        const cantidadTotal = Number((articulo.cantidad * 0.3).toPrecision(10)); // 0.3kg por unidad
                        
                        console.log(`\n📊 CÁLCULO DE CANTIDAD PARA MIX DIRECTO:`);
                        console.log(`- Nombre del mix: ${ingredienteResult.rows[0].nombre}`);
                        console.log(`- Unidades pedidas: ${articulo.cantidad}`);
                        console.log(`- Cantidad por unidad: 0.3kg`);
                        console.log(`- Cantidad total: ${cantidadTotal}kg`);
                        
                        todosLosMixes.push({
                            id: ingredienteId,
                            nombre: ingredienteResult.rows[0].nombre,
                            unidad_medida: ingredienteResult.rows[0].unidad_medida,
                            cantidad: cantidadTotal
                        });
                    }
                }
            }
        }

        // 3. Consolidar todos los mixes por ID
        const mixesConsolidados = consolidarIngredientes(todosLosMixes);
        
        // Obtener el tipo de carro
        const queryTipoCarro = `
            SELECT tipo_carro, usuario_id
            FROM carros_produccion
            WHERE id = $1
        `;
        const tipoCarroResult = await pool.query(queryTipoCarro, [carroId]);
        const tipoCarro = tipoCarroResult.rows[0]?.tipo_carro || 'interna';
        const carroUsuarioId = tipoCarroResult.rows[0]?.usuario_id;

        console.log(`\n🔍 TIPO DE CARRO: ${tipoCarro}`);
        console.log(`Usuario del carro: ${carroUsuarioId}`);

        // Agregar stock a los mixes según el tipo de carro
        const mixesConStock = await Promise.all(
            mixesConsolidados.map(async (mix) => {
                try {
                    let stockActual = 0;

                    if (tipoCarro === 'externa') {
                        console.log(`\n📦 Obteniendo stock de usuario para mix ${mix.id}`);
                        // Consultar stock del usuario para carros externos
                        const queryStockUsuario = `
                            SELECT SUM(cantidad) as stock_usuario
                            FROM ingredientes_stock_usuarios
                            WHERE usuario_id = $1 AND ingrediente_id = $2
                            GROUP BY ingrediente_id
                        `;
                        const stockUsuarioResult = await pool.query(queryStockUsuario, [carroUsuarioId, mix.id]);
                        stockActual = stockUsuarioResult.rows[0]?.stock_usuario || 0;
                        console.log(`Stock usuario encontrado: ${stockActual}`);
                    } else {
                        console.log(`\n📦 Obteniendo stock central para mix ${mix.id}`);
                        // Consultar stock central para carros internos
                        const queryStock = `
                            SELECT stock_actual 
                            FROM ingredientes 
                            WHERE id = $1
                        `;
                        const stockResult = await pool.query(queryStock, [mix.id]);
                        stockActual = stockResult.rows[0]?.stock_actual || 0;
                        console.log(`Stock central encontrado: ${stockActual}`);
                    }

                    return {
                        ...mix,
                        stock_actual: Number(parseFloat(stockActual).toPrecision(10))
                    };
                } catch (error) {
                    console.error(`Error obteniendo stock para mix ${mix.id}:`, error);
                    return {
                        ...mix,
                        stock_actual: 0
                    };
                }
            })
        );
        
        console.log(`\n✅ MIXES CONSOLIDADOS CON STOCK: ${mixesConStock.length}`);
        if (mixesConStock.length > 0) {
            mixesConStock.forEach((mix, index) => {
                const estado = mix.stock_actual >= mix.cantidad ? '✅' : '❌';
                console.log(`  ${index + 1}. ${mix.nombre}: Necesario ${mix.cantidad}, Stock ${mix.stock_actual} ${estado}`);
            });
        } else {
            console.log(`⚠️ No se encontraron mixes en el carro ${carroId}`);
        }

        console.log(`\n🔍 DIAGNÓSTICO FINAL - MIXES:`);
        console.log(`- Total de artículos procesados: ${articulosResult.rows.length}`);
        console.log(`- Total de mixes encontrados antes de consolidar: ${todosLosMixes.length}`);
        console.log(`- Total de mixes después de consolidar: ${mixesConsolidados.length}`);
        console.log(`===============================================\n`);

        return mixesConsolidados;

    } catch (error) {
        console.error('Error al obtener mixes del carro:', error);
        throw new Error('No se pudieron obtener los mixes del carro');
    }
}

module.exports = {
    obtenerIngredientesBaseCarro,
    obtenerMixesCarro
};
