/**
 * Normaliza un texto eliminando tildes, espacios extra y unificando plurales
 * @param {string} texto - Texto a normalizar
 * @returns {string} Texto normalizado
 */
function normalizarTexto(texto) {
    if (!texto) return '';
    
    // Pasar a minúsculas y eliminar espacios extra
    let normalizado = texto.toLowerCase().trim().replace(/\s+/g, ' ');
    
    // Eliminar tildes
    normalizado = normalizado.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    // Unificar plurales comunes en unidades
    if (normalizado === 'kilos') normalizado = 'kilo';
    if (normalizado === 'gramos') normalizado = 'gramo';
    if (normalizado === 'litros') normalizado = 'litro';
    if (normalizado === 'unidades') normalizado = 'unidad';
    
    return normalizado;
}

/**
 * Consolida una lista de ingredientes sumando cantidades de ingredientes con el mismo nombre y unidad
 * @param {Array} ingredientes - Lista de ingredientes a consolidar
 * @returns {Array} Lista de ingredientes consolidados
 */
function consolidarIngredientes(ingredientes) {
    console.log(`\n📊 INICIANDO CONSOLIDACIÓN DE INGREDIENTES`);
    console.log(`=========================================`);
    console.log(`Total ingredientes a consolidar: ${ingredientes.length}`);

    const consolidados = {};
    const problematicos = [];

    ingredientes.forEach((ing, index) => {
        // Validar estructura del ingrediente
        if (!ing.nombre || !ing.unidad_medida || typeof ing.cantidad !== 'number') {
            console.error(`❌ Ingrediente #${index + 1} inválido:`, ing);
            problematicos.push(ing);
            return;
        }

        // Manejar ingredientes con y sin ID
        let key;
        if (ing.id) {
            key = `id_${ing.id}`;
        } else {
            // Para ingredientes sin ID, usar nombre y unidad normalizada como fallback
            const nombreNormalizado = normalizarTexto(ing.nombre);
            const unidadNormalizada = normalizarTexto(ing.unidad_medida);
            key = `nombre_${nombreNormalizado}_${unidadNormalizada}`;
            console.log(`⚠️ Ingrediente #${index + 1} sin ID, usando key por nombre: ${key}`);
        }

        console.log(`\n🔍 Procesando ingrediente #${index + 1}:`);
        console.log(`- ID: ${ing.id}`);
        console.log(`- Nombre: "${ing.nombre}"`);
        console.log(`- Unidad: "${ing.unidad_medida}"`);
        console.log(`- Cantidad: ${ing.cantidad}`);

        if (consolidados[key]) {
            const anterior = consolidados[key].cantidad;
            // Mantener alta precisión en las sumas
            consolidados[key].cantidad = Number((consolidados[key].cantidad + ing.cantidad).toPrecision(10));
            // Mantener es_primario si alguno de los ingredientes es primario
            consolidados[key].es_primario = consolidados[key].es_primario || ing.es_primario || false;
            // Preservar origen_mix_id (priorizar el existente, luego el nuevo)
            consolidados[key].origen_mix_id = consolidados[key].origen_mix_id || ing.origen_mix_id || null;
            console.log(`➕ SUMANDO cantidades para ID ${key}:`);
            console.log(`   ${anterior} + ${ing.cantidad} = ${consolidados[key].cantidad}`);
            console.log(`   es_primario: ${consolidados[key].es_primario}`);
            console.log(`   origen_mix_id: ${consolidados[key].origen_mix_id}`);
        } else {
            console.log(`🆕 NUEVO INGREDIENTE (ID: ${key})`);
            // Asegurar que la cantidad inicial tenga alta precisión
            consolidados[key] = {
                id: ing.id,
                nombre: ing.nombre,
                unidad_medida: ing.unidad_medida,
                cantidad: Number(ing.cantidad.toPrecision(10)),
                es_primario: ing.es_primario || false,
                origen_mix_id: ing.origen_mix_id || null // Preservar origen_mix_id
            };
        }
    });

    if (problematicos.length > 0) {
        console.warn(`\n⚠️ Se encontraron ${problematicos.length} ingredientes con formato inválido`);
    }

    console.log(`\n✅ CONSOLIDACIÓN COMPLETADA`);
    console.log(`- Ingredientes únicos: ${Object.keys(consolidados).length}`);
    console.log(`- Ingredientes ignorados: ${problematicos.length}`);

    // LOGS DE DIAGNÓSTICO - Análisis detallado antes del return
    console.log('\n🔍 DIAGNÓSTICO DE CONSOLIDACIÓN:');
    console.log('===============================');
    
    Object.keys(consolidados).forEach(key => {
        const ingrediente = consolidados[key];
        console.log(`📋 Key: "${key}"`);
        console.log(`   - Nombre: "${ingrediente.nombre}" (tipo: ${typeof ingrediente.nombre}, longitud: ${ingrediente.nombre?.length})`);
        console.log(`   - Unidad: "${ingrediente.unidad_medida}" (tipo: ${typeof ingrediente.unidad_medida}, longitud: ${ingrediente.unidad_medida?.length})`);
        console.log(`   - Cantidad total: ${ingrediente.cantidad} (tipo: ${typeof ingrediente.cantidad})`);
        
        // Verificar caracteres especiales en nombre
        if (ingrediente.nombre) {
            const tieneEspaciosExtra = ingrediente.nombre !== ingrediente.nombre.trim();
            const tieneTildes = /[áéíóúÁÉÍÓÚñÑ]/.test(ingrediente.nombre);
            const tieneCaracteresEspeciales = /[^\w\sáéíóúÁÉÍÓÚñÑ]/.test(ingrediente.nombre);
            
            if (tieneEspaciosExtra) console.log(`   ⚠️ ESPACIOS EXTRA detectados en nombre`);
            if (tieneTildes) console.log(`   📝 Contiene tildes/ñ: ${ingrediente.nombre.match(/[áéíóúÁÉÍÓÚñÑ]/g)}`);
            if (tieneCaracteresEspeciales) console.log(`   ⚠️ Caracteres especiales: ${ingrediente.nombre.match(/[^\w\sáéíóúÁÉÍÓÚñÑ]/g)}`);
        }
        
        // Verificar caracteres especiales en unidad
        if (ingrediente.unidad_medida) {
            const tieneEspaciosExtra = ingrediente.unidad_medida !== ingrediente.unidad_medida.trim();
            const tieneTildes = /[áéíóúÁÉÍÓÚñÑ]/.test(ingrediente.unidad_medida);
            
            if (tieneEspaciosExtra) console.log(`   ⚠️ ESPACIOS EXTRA detectados en unidad`);
            if (tieneTildes) console.log(`   📝 Unidad contiene tildes/ñ: ${ingrediente.unidad_medida.match(/[áéíóúÁÉÍÓÚñÑ]/g)}`);
        }
        
        console.log(''); // Línea en blanco para separar
    });
    
    console.log(`📊 Total de keys únicas generadas: ${Object.keys(consolidados).length}`);
    console.log('===============================\n');

    const resultado = Object.values(consolidados)
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    
    console.log(`✅ Consolidación completada. ${resultado.length} ingredientes únicos:`, resultado);
    return resultado;
}

module.exports = {
    consolidarIngredientes
};
