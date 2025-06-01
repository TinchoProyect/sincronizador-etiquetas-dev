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
 * Extrae el peso unitario de un artículo a partir de su nombre
 * @param {string} nombreArticulo - Nombre del artículo (ej: "Mix Premium x 5")
 * @returns {number} Peso unitario extraído o 1 si no se encuentra
 */
function extraerPesoUnitario(nombreArticulo) {
    const match = nombreArticulo.match(/x\s*(\d+(\.\d+)?)/i);
    return match ? parseFloat(match[1]) : 1;
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
                    ri.cantidad,
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
                // CORRECCIÓN: No multiplicar por pesoUnitario aquí - se manejará en expandirIngrediente
                const cantidadTotal = ing.cantidad * articulo.cantidad;
                
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
                            cantidadTotal
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

            // Si el artículo no tiene receta, tratarlo como ingrediente primario
            if (recetaResult.rows.length === 0) {
                console.log(`📦 Artículo ${articulo.articulo_numero} sin receta - buscando como ingrediente primario`);
                const queryIngredientePrimario = `
                    SELECT id, nombre, unidad_medida
                    FROM ingredientes
                    WHERE LOWER(nombre) = LOWER($1)
                `;
                const ingredientePrimario = await pool.query(queryIngredientePrimario, [articulo.articulo_numero]);

                if (ingredientePrimario.rows.length > 0) {
                    console.log(`✅ Ingrediente primario encontrado: ${ingredientePrimario.rows[0].nombre} para artículo ${articulo.articulo_numero}`);
                    todosLosIngredientes.push({
                        id: ingredientePrimario.rows[0].id,
                        nombre: ingredientePrimario.rows[0].nombre,
                        unidad_medida: ingredientePrimario.rows[0].unidad_medida,
                        cantidad: articulo.cantidad
                    });
                } else {
                    console.log(`⚠️ No se encontró ingrediente primario para artículo ${articulo.articulo_numero}`);
                }
            }
        }

        // 3. Consolidar todos los ingredientes
        const ingredientesConsolidados = consolidarIngredientes(todosLosIngredientes);

        return ingredientesConsolidados;

    } catch (error) {
        console.error('Error al obtener ingredientes base del carro:', error);
        throw new Error('No se pudieron obtener los ingredientes del carro');
    }
}

module.exports = {
    obtenerIngredientesBaseCarro
};
