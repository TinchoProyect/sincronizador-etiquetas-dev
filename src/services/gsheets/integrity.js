console.log('[INTEGRITY] Inicializando servicio de integridad referencial...');

/**
 * Servicio de Integridad Referencial
 * Verifica y mantiene la integridad entre presupuestos y detalles
 */

/**
 * Verificar integridad referencial entre presupuestos y detalles
 * @param {Array} presupuestos - Array de presupuestos válidos
 * @param {Array} detalles - Array de detalles válidos
 * @param {Object} db - Conexión a base de datos
 * @returns {Object} Resultado de verificación con datos corregidos
 */
async function verifyReferentialIntegrity(presupuestos, detalles, db) {
    console.log(`[INTEGRITY] Verificando integridad referencial...`);
    console.log(`[INTEGRITY] - Presupuestos: ${presupuestos.length}`);
    console.log(`[INTEGRITY] - Detalles: ${detalles.length}`);
    
    try {
        // PASO 1: Crear mapa de presupuestos existentes
        const presupuestosIds = new Set(presupuestos.map(p => p.id_ext));
        console.log(`[INTEGRITY] IDs de presupuestos en lote: ${Array.from(presupuestosIds).join(', ')}`);
        
        // PASO 2: Clasificar detalles
        const validDetails = [];
        const orphanDetails = [];
        
        for (const detalle of detalles) {
            if (presupuestosIds.has(detalle.id_presupuesto_ext)) {
                validDetails.push(detalle);
            } else {
                orphanDetails.push(detalle);
            }
        }
        
        console.log(`[INTEGRITY] - Detalles con padre en lote: ${validDetails.length}`);
        console.log(`[INTEGRITY] - Detalles huérfanos: ${orphanDetails.length}`);
        
        // PASO 3: Verificar presupuestos padre en base de datos para huérfanos
        const createdParents = [];
        const resolvedOrphans = [];
        
        for (const orphan of orphanDetails) {
            console.log(`[INTEGRITY] Verificando presupuesto padre para huérfano: ${orphan.id_presupuesto_ext}`);
            
            const parentExists = await checkPresupuestoExists(orphan.id_presupuesto_ext, db);
            
            if (parentExists) {
                console.log(`[INTEGRITY] ✅ Presupuesto padre existe en BD: ${orphan.id_presupuesto_ext}`);
                resolvedOrphans.push(orphan);
            } else {
                console.log(`[INTEGRITY] ⚠️ Creando presupuesto padre para huérfano: ${orphan.id_presupuesto_ext}`);
                
                const minimalParent = createMinimalParent(orphan.id_presupuesto_ext);
                createdParents.push(minimalParent);
                resolvedOrphans.push(orphan);
            }
        }
        
        // PASO 4: Verificar duplicados en presupuestos
        const uniquePresupuestos = removeDuplicatePresupuestos([...presupuestos, ...createdParents]);
        
        // PASO 5: Verificar duplicados en detalles
        const uniqueDetalles = removeDuplicateDetalles([...validDetails, ...resolvedOrphans]);
        
        const result = {
            validPresupuestos: uniquePresupuestos,
            validDetalles: uniqueDetalles,
            orphansFound: orphanDetails.length,
            orphansResolved: resolvedOrphans.length,
            parentsCreated: createdParents.length,
            duplicatesRemoved: {
                presupuestos: (presupuestos.length + createdParents.length) - uniquePresupuestos.length,
                detalles: (validDetails.length + resolvedOrphans.length) - uniqueDetalles.length
            },
            stats: {
                originalPresupuestos: presupuestos.length,
                originalDetalles: detalles.length,
                finalPresupuestos: uniquePresupuestos.length,
                finalDetalles: uniqueDetalles.length
            }
        };
        
        console.log(`[INTEGRITY] ✅ Integridad verificada:`);
        console.log(`[INTEGRITY] - Presupuestos finales: ${result.stats.finalPresupuestos}`);
        console.log(`[INTEGRITY] - Detalles finales: ${result.stats.finalDetalles}`);
        console.log(`[INTEGRITY] - Padres creados: ${result.parentsCreated}`);
        console.log(`[INTEGRITY] - Huérfanos resueltos: ${result.orphansResolved}`);
        
        return result;
        
    } catch (error) {
        console.error('[INTEGRITY] ❌ Error verificando integridad referencial:', error.message);
        throw new Error(`Error en verificación de integridad: ${error.message}`);
    }
}

/**
 * Verificar si un presupuesto existe en la base de datos
 * @param {string} id_ext - ID externo del presupuesto
 * @param {Object} db - Conexión a base de datos
 * @returns {boolean} True si existe
 */
async function checkPresupuestoExists(id_ext, db) {
    console.log(`[INTEGRITY] Verificando existencia de presupuesto: ${id_ext}`);
    
    try {
        const query = 'SELECT id FROM public.presupuestos WHERE id_ext = $1 LIMIT 1';
        const result = await db.query(query, [id_ext]);
        
        const exists = result.rows.length > 0;
        console.log(`[INTEGRITY] Presupuesto ${id_ext} ${exists ? 'existe' : 'no existe'} en BD`);
        
        return exists;
        
    } catch (error) {
        console.error(`[INTEGRITY] ❌ Error verificando existencia de ${id_ext}:`, error.message);
        return false;
    }
}

/**
 * Crear presupuesto padre mínimo para detalle huérfano
 * @param {string} id_ext - ID externo del presupuesto
 * @returns {Object} Presupuesto mínimo
 */
function createMinimalParent(id_ext) {
    console.log(`[INTEGRITY] Creando presupuesto padre mínimo: ${id_ext}`);
    
    const minimalParent = {
        id_ext: id_ext,
        fecha: new Date(),
        cliente: null,
        agente: 'SISTEMA',
        fecha_entrega: null,
        factura_efectivo: null,
        nota: `Presupuesto creado automáticamente por detalle huérfano - ${new Date().toISOString()}`,
        estado: 'IMPORTADO_AUTOMATICO',
        informe_generado: null,
        cliente_nuevo_id: null,
        estado_imprime_pdf: null,
        punto_entrega: null,
        descuento: 0.00
    };
    
    console.log(`[INTEGRITY] ✅ Presupuesto padre mínimo creado: ${id_ext}`);
    
    return minimalParent;
}

/**
 * Remover presupuestos duplicados basado en id_ext
 * @param {Array} presupuestos - Array de presupuestos
 * @returns {Array} Array sin duplicados
 */
function removeDuplicatePresupuestos(presupuestos) {
    console.log(`[INTEGRITY] Removiendo duplicados de ${presupuestos.length} presupuestos...`);
    
    const seen = new Map();
    const unique = [];
    
    for (const presupuesto of presupuestos) {
        const key = presupuesto.id_ext;
        
        if (!seen.has(key)) {
            seen.set(key, true);
            unique.push(presupuesto);
        } else {
            console.log(`[INTEGRITY] ⚠️ Presupuesto duplicado removido: ${key}`);
        }
    }
    
    console.log(`[INTEGRITY] ✅ Duplicados removidos: ${presupuestos.length - unique.length} presupuestos`);
    
    return unique;
}

/**
 * Remover detalles duplicados basado en id_presupuesto_ext + articulo
 * @param {Array} detalles - Array de detalles
 * @returns {Array} Array sin duplicados
 */
function removeDuplicateDetalles(detalles) {
    console.log(`[INTEGRITY] Removiendo duplicados de ${detalles.length} detalles...`);
    
    const seen = new Map();
    const unique = [];
    
    for (const detalle of detalles) {
        const key = `${detalle.id_presupuesto_ext}|${detalle.articulo}`;
        
        if (!seen.has(key)) {
            seen.set(key, true);
            unique.push(detalle);
        } else {
            console.log(`[INTEGRITY] ⚠️ Detalle duplicado removido: ${detalle.id_presupuesto_ext} - ${detalle.articulo}`);
        }
    }
    
    console.log(`[INTEGRITY] ✅ Duplicados removidos: ${detalles.length - unique.length} detalles`);
    
    return unique;
}

/**
 * Verificar consistencia de datos entre presupuestos y detalles
 * @param {Array} presupuestos - Array de presupuestos
 * @param {Array} detalles - Array de detalles
 * @returns {Object} Reporte de consistencia
 */
function verifyDataConsistency(presupuestos, detalles) {
    console.log('[INTEGRITY] Verificando consistencia de datos...');
    
    const presupuestosMap = new Map();
    const detallesMap = new Map();
    
    // Mapear presupuestos
    for (const presupuesto of presupuestos) {
        presupuestosMap.set(presupuesto.id_ext, presupuesto);
    }
    
    // Agrupar detalles por presupuesto
    for (const detalle of detalles) {
        if (!detallesMap.has(detalle.id_presupuesto_ext)) {
            detallesMap.set(detalle.id_presupuesto_ext, []);
        }
        detallesMap.get(detalle.id_presupuesto_ext).push(detalle);
    }
    
    const inconsistencies = [];
    const presupuestosSinDetalles = [];
    const detallesSinPresupuesto = [];
    
    // Verificar presupuestos sin detalles
    for (const [id_ext, presupuesto] of presupuestosMap) {
        if (!detallesMap.has(id_ext)) {
            presupuestosSinDetalles.push(id_ext);
        }
    }
    
    // Verificar detalles sin presupuesto
    for (const [id_ext, detallesArray] of detallesMap) {
        if (!presupuestosMap.has(id_ext)) {
            detallesSinPresupuesto.push(id_ext);
        }
    }
    
    const report = {
        totalPresupuestos: presupuestos.length,
        totalDetalles: detalles.length,
        presupuestosSinDetalles: presupuestosSinDetalles.length,
        detallesSinPresupuesto: detallesSinPresupuesto.length,
        inconsistencies: inconsistencies,
        details: {
            presupuestosSinDetalles: presupuestosSinDetalles,
            detallesSinPresupuesto: detallesSinPresupuesto
        },
        isConsistent: presupuestosSinDetalles.length === 0 && detallesSinPresupuesto.length === 0
    };
    
    console.log(`[INTEGRITY] ✅ Consistencia verificada:`);
    console.log(`[INTEGRITY] - Presupuestos sin detalles: ${report.presupuestosSinDetalles}`);
    console.log(`[INTEGRITY] - Detalles sin presupuesto: ${report.detallesSinPresupuesto}`);
    console.log(`[INTEGRITY] - Es consistente: ${report.isConsistent}`);
    
    return report;
}

/**
 * Generar estadísticas de integridad
 * @param {Object} integrityResult - Resultado de verificación de integridad
 * @returns {Object} Estadísticas detalladas
 */
function generateIntegrityStats(integrityResult) {
    console.log('[INTEGRITY] Generando estadísticas de integridad...');
    
    const stats = {
        timestamp: new Date().toISOString(),
        processing: {
            originalPresupuestos: integrityResult.stats.originalPresupuestos,
            originalDetalles: integrityResult.stats.originalDetalles,
            finalPresupuestos: integrityResult.stats.finalPresupuestos,
            finalDetalles: integrityResult.stats.finalDetalles
        },
        integrity: {
            orphansFound: integrityResult.orphansFound,
            orphansResolved: integrityResult.orphansResolved,
            parentsCreated: integrityResult.parentsCreated,
            duplicatesRemovedPresupuestos: integrityResult.duplicatesRemoved.presupuestos,
            duplicatesRemovedDetalles: integrityResult.duplicatesRemoved.detalles
        },
        ratios: {
            orphanRate: integrityResult.stats.originalDetalles > 0 ? 
                (integrityResult.orphansFound / integrityResult.stats.originalDetalles * 100).toFixed(2) + '%' : '0%',
            duplicateRatePresupuestos: integrityResult.stats.originalPresupuestos > 0 ? 
                (integrityResult.duplicatesRemoved.presupuestos / integrityResult.stats.originalPresupuestos * 100).toFixed(2) + '%' : '0%',
            duplicateRateDetalles: integrityResult.stats.originalDetalles > 0 ? 
                (integrityResult.duplicatesRemoved.detalles / integrityResult.stats.originalDetalles * 100).toFixed(2) + '%' : '0%'
        },
        quality: {
            dataIntegrityScore: calculateIntegrityScore(integrityResult),
            recommendedActions: generateRecommendations(integrityResult)
        }
    };
    
    console.log(`[INTEGRITY] ✅ Estadísticas generadas - Score: ${stats.quality.dataIntegrityScore}`);
    
    return stats;
}

/**
 * Calcular score de integridad de datos
 * @param {Object} integrityResult - Resultado de verificación
 * @returns {number} Score de 0 a 100
 */
function calculateIntegrityScore(integrityResult) {
    let score = 100;
    
    // Penalizar por huérfanos
    if (integrityResult.orphansFound > 0) {
        const orphanPenalty = (integrityResult.orphansFound / integrityResult.stats.originalDetalles) * 30;
        score -= orphanPenalty;
    }
    
    // Penalizar por duplicados
    const totalDuplicates = integrityResult.duplicatesRemoved.presupuestos + integrityResult.duplicatesRemoved.detalles;
    const totalRecords = integrityResult.stats.originalPresupuestos + integrityResult.stats.originalDetalles;
    
    if (totalDuplicates > 0) {
        const duplicatePenalty = (totalDuplicates / totalRecords) * 20;
        score -= duplicatePenalty;
    }
    
    return Math.max(0, Math.round(score));
}

/**
 * Generar recomendaciones basadas en integridad
 * @param {Object} integrityResult - Resultado de verificación
 * @returns {Array} Array de recomendaciones
 */
function generateRecommendations(integrityResult) {
    const recommendations = [];
    
    if (integrityResult.orphansFound > 0) {
        recommendations.push(`Se encontraron ${integrityResult.orphansFound} detalles huérfanos. Revisar proceso de creación de presupuestos.`);
    }
    
    if (integrityResult.duplicatesRemoved.presupuestos > 0) {
        recommendations.push(`Se removieron ${integrityResult.duplicatesRemoved.presupuestos} presupuestos duplicados. Verificar fuente de datos.`);
    }
    
    if (integrityResult.duplicatesRemoved.detalles > 0) {
        recommendations.push(`Se removieron ${integrityResult.duplicatesRemoved.detalles} detalles duplicados. Revisar lógica de importación.`);
    }
    
    if (integrityResult.parentsCreated > 0) {
        recommendations.push(`Se crearon ${integrityResult.parentsCreated} presupuestos padre automáticamente. Revisar estos registros manualmente.`);
    }
    
    if (recommendations.length === 0) {
        recommendations.push('Los datos tienen excelente integridad referencial.');
    }
    
    return recommendations;
}

console.log('[INTEGRITY] ✅ Servicio de integridad referencial configurado');

module.exports = {
    verifyReferentialIntegrity,
    checkPresupuestoExists,
    createMinimalParent,
    removeDuplicatePresupuestos,
    removeDuplicateDetalles,
    verifyDataConsistency,
    generateIntegrityStats,
    calculateIntegrityScore,
    generateRecommendations
};
