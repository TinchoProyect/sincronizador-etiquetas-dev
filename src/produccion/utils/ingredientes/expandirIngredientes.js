const pool = require('../../config/database');

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
 * Verifica si un ingrediente es un mix consultando la tabla ingrediente_composicion
 * @param {number} ingredienteId - ID del ingrediente a verificar
 * @returns {Promise<boolean>} true si el ingrediente es un mix
 */
async function esMix(ingredienteId) {
    const query = `
        SELECT COUNT(*)::integer as count 
        FROM ingrediente_composicion 
        WHERE mix_id = $1
    `;
    const result = await pool.query(query, [ingredienteId]);
    return result.rows[0].count > 0;
}

/**
 * Expande recursivamente un ingrediente mix en sus ingredientes base
 * @param {number} ingredienteId - ID del ingrediente a expandir
 * @param {number} cantidadBase - Cantidad base para multiplicar
 * @param {Set} procesados - Set de ingredientes ya procesados para evitar ciclos
 * @returns {Promise<Array>} Lista de ingredientes base con cantidades ajustadas
 */
async function expandirIngrediente(articuloId, cantidadBase = 1, procesados = new Set()) {
    // Primero verificar si es un número de artículo y obtener su ingrediente asociado
    try {
        const ingredienteQuery = `
            SELECT i.id, i.nombre, i.unidad_medida
            FROM ingredientes i
            JOIN articulos a ON a.ingrediente_id = i.id
            WHERE a.numero = $1
        `;
        const ingredienteResult = await pool.query(ingredienteQuery, [articuloId]);
        
        if (ingredienteResult.rows.length > 0) {
            // Si es un artículo, usar su ingrediente asociado
            const ingrediente = ingredienteResult.rows[0];
            return [{
                id: ingrediente.id,
                nombre: ingrediente.nombre,
                unidad_medida: ingrediente.unidad_medida,
                cantidad: cantidadBase,
                es_primario: true
            }];
        }
    } catch (error) {
        console.log('No es un número de artículo, tratando como ID de ingrediente');
    }

    // Si no es un artículo, proceder con la lógica de ingredientes
    if (procesados.has(articuloId)) {
        console.log(`Ciclo detectado para ingrediente ${articuloId}, retornando array vacío`);
        return [];
    }
    procesados.add(articuloId);

    try {
        // Verificar si es un mix
        const tieneMix = await esMix(articuloId);
        console.log(`Ingrediente ${articuloId}: es mix = ${tieneMix}, cantidad = ${cantidadBase}`);
        
        if (!tieneMix) {
            // Si no es mix, obtener datos del ingrediente base
            const query = `
                SELECT nombre, unidad_medida
                FROM ingredientes
                WHERE id = $1
            `;
            const result = await pool.query(query, [articuloId]);
            if (result.rows.length === 0) {
                console.log(`No se encontró ingrediente con ID ${articuloId}`);
                return [];
            }

            const ingredienteBase = {
                id: articuloId,  // Agregar ID para consolidación
                nombre: result.rows[0].nombre,
                unidad_medida: result.rows[0].unidad_medida,
                cantidad: cantidadBase,
                es_primario: true  // Marcar como ingrediente primario
            };
            console.log(`Retornando ingrediente base:`, ingredienteBase);
            return [ingredienteBase];
        }

        // Si es mix, obtener su composición y receta_base_kg
        console.log(`\n🔍 DIAGNÓSTICO DE MIX ${articuloId}:`);
        console.log(`===============================`);
        console.log(`Cantidad solicitada: ${cantidadBase}`);

        const composicionQuery = `
            SELECT 
                ic.ingrediente_id,
                ic.cantidad,
                i.nombre,
                i.unidad_medida,
                m.receta_base_kg
            FROM ingrediente_composicion ic
            JOIN ingredientes i ON i.id = ic.ingrediente_id
            JOIN ingredientes m ON m.id = ic.mix_id
            WHERE ic.mix_id = $1
        `;
        const composicionResult = await pool.query(composicionQuery, [articuloId]);

        // Obtener y validar receta_base_kg
        const recetaBaseKg = composicionResult.rows[0]?.receta_base_kg;
        console.log(`receta_base_kg encontrado: ${recetaBaseKg}`);

        const baseKg = (recetaBaseKg && recetaBaseKg > 0) ? recetaBaseKg : 1;
        if (recetaBaseKg === null || recetaBaseKg === 0) {
            console.warn(`⚠️ Mix ${articuloId} tiene receta_base_kg nulo o 0. Usando base = 1 por defecto`);
        }

        // Obtener el peso unitario del nombre del mix
        const nombreMixQuery = `
            SELECT nombre
            FROM ingredientes
            WHERE id = $1
        `;
        const nombreMixResult = await pool.query(nombreMixQuery, [articuloId]);
        const nombreMix = nombreMixResult.rows[0]?.nombre || '';
        const pesoUnitario = extraerPesoUnitario(nombreMix);

        // Calcular factor de proporción con alta precisión
        const factorProporcion = Number(((cantidadBase * pesoUnitario) / baseKg).toPrecision(10));
        
        console.log(`\n🔍 EXPANSIÓN DE MIX - CANTIDADES`);
        console.log(`=======================================`);
        console.log(`Mix: ${nombreMix} (ID: ${articuloId})`);
        console.log(`1️⃣ DATOS:`);
        console.log(`- Cantidad base: ${cantidadBase}kg`);
        console.log(`- Peso unitario: ${pesoUnitario}kg`);
        console.log(`- receta_base_kg: ${baseKg}kg`);
        console.log(`2️⃣ CÁLCULO:`);
        console.log(`- Factor = (${cantidadBase} × ${pesoUnitario}) ÷ ${baseKg} = ${factorProporcion}`);
        
        if (factorProporcion <= 0) {
            console.error(`❌ ERROR: Factor de proporción inválido (${factorProporcion})`);
        }

        console.log(`\n📋 COMPOSICIÓN DEL MIX:`);
        
        // Expandir recursivamente cada ingrediente de la composición
        let ingredientesExpandidos = [];
        for (const ing of composicionResult.rows) {
            // Logs de diagnóstico detallado
            console.log(`📦 Ingrediente hijo ID ${ing.ingrediente_id}: ${ing.nombre}`);
            console.log(`- Cantidad en composición: ${ing.cantidad}`);
            console.log(`- receta_base_kg del mix: ${baseKg}`);
            
            // Usar números decimales de alta precisión para los cálculos
            const porcentaje = Number((ing.cantidad / baseKg * 100).toPrecision(10));
            console.log(`🧮 Porcentaje del ingrediente en el mix: ${porcentaje}%`);
            
            console.log(`🧪 Cantidad solicitada del mix: ${cantidadBase} kg`);
            console.log(`🧮 Cálculo: (${ing.cantidad} / ${baseKg}) * ${cantidadBase}`);
            
            // Mantener alta precisión en los cálculos intermedios
            const cantidadAjustada = Number((ing.cantidad * factorProporcion).toPrecision(10));
            
            console.log(`\n📊 CÁLCULO DETALLADO PARA ${ing.nombre}:`);
            console.log(`----------------------------------------`);
            console.log(`1️⃣ Cantidad en receta: ${ing.cantidad} ${ing.unidad_medida}`);
            console.log(`2️⃣ receta_base_kg: ${baseKg} kg`);
            console.log(`3️⃣ Cantidad solicitada del mix: ${cantidadBase} kg`);
            console.log(`4️⃣ Factor de proporción: ${cantidadBase} / ${baseKg} = ${factorProporcion}`);
            console.log(`5️⃣ Cantidad ajustada: ${ing.cantidad} × ${factorProporcion} = ${cantidadAjustada}`);
            console.log(`✅ Resultado final para ${ing.nombre}: ${cantidadAjustada} ${ing.unidad_medida}`);
            console.log(`----------------------------------------`);
            
            const subIngredientes = await expandirIngrediente(
                ing.ingrediente_id,
                cantidadAjustada,
                procesados
            );
            ingredientesExpandidos = ingredientesExpandidos.concat(subIngredientes);
        }

        return ingredientesExpandidos;
    } catch (error) {
        console.error(`Error expandiendo ingrediente ${articuloId}:`, error);
        return [];
    }
}

module.exports = {
    expandirIngrediente,
    esMix
};
