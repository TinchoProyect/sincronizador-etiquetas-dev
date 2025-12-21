/**
 * Módulo de Gestión de Filtros y Ordenamiento de Rubros
 * Maneja la estructura dinámica (plana o jerárquica) según la configuración
 */

console.log('📋 [FILTRO-RUBROS] Cargando módulo de filtros...');

// ✅ ORDEN DE PRIORIDAD DE RUBROS (Regla de Negocio LAMDA)
// Nombres exactos según base de datos
const ORDEN_PRIORIDAD_RUBROS = [
    'LAMDA-Productos',
    'Frutos Secos',
    'Frutas Disecadas',
    'Semillas y Especias',
    'Deshidratados',
    'Almacen',
    'Dulces'
];

/**
 * Obtener orden de prioridad para un rubro
 * @param {String} rubro - Nombre del rubro
 * @returns {Number} Orden de prioridad (menor = más prioritario)
 */
function obtenerOrdenPrioridad(rubro) {
    const index = ORDEN_PRIORIDAD_RUBROS.indexOf(rubro);
    return index >= 0 ? index : 1000;
}

/**
 * Estado global de filtros y ordenamiento
 */
const estadoFiltros = {
    // Estructura plana: { rubro: { visible: true, orden: 0 } }
    rubrosPlanos: {},
    
    // Estructura jerárquica: { mes: { visible: true, rubros: { rubro: { visible: true, orden: 0 } } } }
    rubrosJerarquicos: {},
    
    // Modo actual: 'plano' o 'jerarquico'
    modo: 'plano'
};

/**
 * Extraer rubros únicos de los productos
 * @param {Array} productos - Array de productos
 * @param {boolean} incluirMeses - Si debe agrupar por meses
 * @returns {Object} Estructura de rubros
 */
function extraerEstructuraRubros(productos, incluirMeses = false) {
    if (incluirMeses) {
        return extraerEstructuraJerarquica(productos);
    } else {
        return extraerEstructuraPlana(productos);
    }
}

/**
 * Extraer estructura plana de rubros con orden de prioridad
 * ✅ MEJORADO: Incluye sub-rubros dentro de cada rubro
 */
function extraerEstructuraPlana(productos) {
    const rubrosMap = new Map();
    
    // Extraer rubros y sus sub-rubros
    productos.forEach(p => {
        const rubro = p.rubro || 'Sin categoría';
        const subRubro = p.sub_rubro || 'Sin subcategoría';
        
        if (!rubrosMap.has(rubro)) {
            rubrosMap.set(rubro, new Set());
        }
        rubrosMap.get(rubro).add(subRubro);
    });
    
    // ✅ ORDENAR RUBROS SEGÚN PRIORIDAD DE NEGOCIO
    const rubrosOrdenados = Array.from(rubrosMap.keys()).sort((a, b) => {
        const ordenA = obtenerOrdenPrioridad(a);
        const ordenB = obtenerOrdenPrioridad(b);
        
        // Si ambos tienen prioridad, ordenar por prioridad
        if (ordenA < 1000 && ordenB < 1000) {
            return ordenA - ordenB;
        }
        
        // Si solo uno tiene prioridad, ese va primero
        if (ordenA < 1000) return -1;
        if (ordenB < 1000) return 1;
        
        // Si ninguno tiene prioridad, orden alfabético
        return a.localeCompare(b);
    });
    
    // Crear estructura con sub-rubros
    const estructura = {};
    rubrosOrdenados.forEach((rubro, index) => {
        const subRubrosSet = rubrosMap.get(rubro);
        const subRubrosOrdenados = Array.from(subRubrosSet).sort();
        
        // Crear objeto de sub-rubros
        const subRubros = {};
        subRubrosOrdenados.forEach(subRubro => {
            subRubros[subRubro] = {
                visible: subRubro !== 'Sin subcategoría', // "Sin subcategoría" oculto por defecto
                nombre: subRubro
            };
        });
        
        estructura[rubro] = {
            visible: rubro !== 'Sin categoría', // "Sin categoría" oculto por defecto
            orden: index,
            nombre: rubro,
            subRubros: subRubros
        };
    });
    
    console.log(`📋 [FILTRO-RUBROS] Orden aplicado con sub-rubros:`, rubrosOrdenados);
    return estructura;
}

/**
 * Extraer estructura jerárquica (Mes → Rubros → Sub-Rubros) con orden de prioridad
 * ✅ MEJORADO: Incluye sub-rubros dentro de cada rubro
 * ✅ FIX: Agrupa meses antiguos (>6 meses) en "Más de 6 meses"
 */
function extraerEstructuraJerarquica(productos) {
    const estructura = {};
    const ahora = new Date();
    
    // Agrupar por mes y extraer sub-rubros
    productos.forEach(p => {
        const fecha = new Date(p.fecha_entrega);
        const mesesAtras = (ahora.getFullYear() - fecha.getFullYear()) * 12 + (ahora.getMonth() - fecha.getMonth());
        
        let mesKey, mesNombre;
        
        if (mesesAtras <= 5) {
            // Meses recientes: crear entrada individual
            mesKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
            mesNombre = obtenerNombreMes(p.fecha_entrega);
        } else {
            // Meses antiguos: agrupar en "historico"
            mesKey = 'historico';
            mesNombre = 'Más de 6 meses';
        }
        
        const rubro = p.rubro || 'Sin categoría';
        const subRubro = p.sub_rubro || 'Sin subcategoría';
        
        if (!estructura[mesKey]) {
            estructura[mesKey] = {
                nombre: mesNombre,
                visible: true,
                orden: 0,
                rubros: {}
            };
        }
        
        if (!estructura[mesKey].rubros[rubro]) {
            estructura[mesKey].rubros[rubro] = {
                visible: rubro !== 'Sin categoría',
                orden: Object.keys(estructura[mesKey].rubros).length,
                nombre: rubro,
                subRubros: {}
            };
        }
        
        // Agregar sub-rubro si no existe
        if (!estructura[mesKey].rubros[rubro].subRubros[subRubro]) {
            estructura[mesKey].rubros[rubro].subRubros[subRubro] = {
                visible: subRubro !== 'Sin subcategoría',
                nombre: subRubro
            };
        }
    });
    
    // Ordenar meses: recientes primero, "historico" al final
    const mesesOrdenados = Object.keys(estructura)
        .filter(k => k !== 'historico')
        .sort()
        .reverse();
    
    if (estructura['historico']) {
        mesesOrdenados.push('historico');
    }
    
    const estructuraOrdenada = {};
    
    mesesOrdenados.forEach((mesKey, index) => {
        // ✅ ORDENAR RUBROS DENTRO DE CADA MES SEGÚN PRIORIDAD
        const rubros = estructura[mesKey].rubros;
        const rubrosOrdenados = Object.keys(rubros).sort((a, b) => {
            const ordenA = obtenerOrdenPrioridad(a);
            const ordenB = obtenerOrdenPrioridad(b);
            
            if (ordenA < 1000 && ordenB < 1000) return ordenA - ordenB;
            if (ordenA < 1000) return -1;
            if (ordenB < 1000) return 1;
            return a.localeCompare(b);
        });
        
        const rubrosReordenados = {};
        rubrosOrdenados.forEach((rubro, idx) => {
            // Ordenar sub-rubros alfabéticamente
            const subRubros = rubros[rubro].subRubros;
            const subRubrosOrdenados = {};
            Object.keys(subRubros).sort().forEach(subRubro => {
                subRubrosOrdenados[subRubro] = subRubros[subRubro];
            });
            
            rubrosReordenados[rubro] = {
                ...rubros[rubro],
                orden: idx,
                subRubros: subRubrosOrdenados
            };
        });
        
        estructuraOrdenada[mesKey] = {
            ...estructura[mesKey],
            orden: index,
            rubros: rubrosReordenados
        };
    });
    
    return estructuraOrdenada;
}

/**
 * Helper: Obtener nombre del mes
 */
function obtenerNombreMes(fechaEntrega) {
    const fecha = new Date(fechaEntrega);
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${meses[fecha.getMonth()]} ${fecha.getFullYear()}`;
}

/**
 * Inicializar estado de filtros
 */
function inicializarFiltros(productos, incluirMeses) {
    const estructura = extraerEstructuraRubros(productos, incluirMeses);
    
    if (incluirMeses) {
        estadoFiltros.modo = 'jerarquico';
        estadoFiltros.rubrosJerarquicos = estructura;
        estadoFiltros.rubrosPlanos = {};
    } else {
        estadoFiltros.modo = 'plano';
        estadoFiltros.rubrosPlanos = estructura;
        estadoFiltros.rubrosJerarquicos = {};
    }
    
    console.log(`📋 [FILTRO-RUBROS] Inicializado en modo: ${estadoFiltros.modo}`);
    console.log(`📊 [FILTRO-RUBROS] Estructura:`, estructura);
    
    return estructura;
}

/**
 * Actualizar visibilidad de un rubro
 * ✅ MEJORADO: Cascada a todos los sub-rubros
 */
function toggleVisibilidadRubro(rubro, mesKey = null) {
    if (estadoFiltros.modo === 'plano') {
        if (estadoFiltros.rubrosPlanos[rubro]) {
            const nuevoEstado = !estadoFiltros.rubrosPlanos[rubro].visible;
            estadoFiltros.rubrosPlanos[rubro].visible = nuevoEstado;
            
            // ✅ CASCADA: Actualizar todos los sub-rubros
            const subRubros = estadoFiltros.rubrosPlanos[rubro].subRubros;
            if (subRubros) {
                Object.keys(subRubros).forEach(subRubro => {
                    subRubros[subRubro].visible = nuevoEstado;
                });
            }
            
            console.log(`👁️ [FILTRO-RUBROS] ${rubro}: ${nuevoEstado ? 'visible' : 'oculto'} (cascada a sub-rubros)`);
        }
    } else {
        if (mesKey && estadoFiltros.rubrosJerarquicos[mesKey]) {
            if (estadoFiltros.rubrosJerarquicos[mesKey].rubros[rubro]) {
                const estado = estadoFiltros.rubrosJerarquicos[mesKey].rubros[rubro];
                const nuevoEstado = !estado.visible;
                estado.visible = nuevoEstado;
                
                // ✅ CASCADA: Actualizar todos los sub-rubros
                const subRubros = estado.subRubros;
                if (subRubros) {
                    Object.keys(subRubros).forEach(subRubro => {
                        subRubros[subRubro].visible = nuevoEstado;
                    });
                }
                
                console.log(`👁️ [FILTRO-RUBROS] ${mesKey} → ${rubro}: ${nuevoEstado ? 'visible' : 'oculto'} (cascada a sub-rubros)`);
            }
        }
    }
}

/**
 * Actualizar visibilidad de un sub-rubro
 * ✅ NUEVO: Toggle individual de sub-rubros
 */
function toggleVisibilidadSubRubro(rubro, subRubro, mesKey = null) {
    if (estadoFiltros.modo === 'plano') {
        if (estadoFiltros.rubrosPlanos[rubro]?.subRubros?.[subRubro]) {
            const subRubroEstado = estadoFiltros.rubrosPlanos[rubro].subRubros[subRubro];
            subRubroEstado.visible = !subRubroEstado.visible;
            console.log(`👁️ [FILTRO-RUBROS] ${rubro} → ${subRubro}: ${subRubroEstado.visible ? 'visible' : 'oculto'}`);
        }
    } else {
        if (mesKey && estadoFiltros.rubrosJerarquicos[mesKey]?.rubros?.[rubro]?.subRubros?.[subRubro]) {
            const subRubroEstado = estadoFiltros.rubrosJerarquicos[mesKey].rubros[rubro].subRubros[subRubro];
            subRubroEstado.visible = !subRubroEstado.visible;
            console.log(`👁️ [FILTRO-RUBROS] ${mesKey} → ${rubro} → ${subRubro}: ${subRubroEstado.visible ? 'visible' : 'oculto'}`);
        }
    }
}

/**
 * Actualizar visibilidad de un mes completo
 */
function toggleVisibilidadMes(mesKey) {
    if (estadoFiltros.modo === 'jerarquico' && estadoFiltros.rubrosJerarquicos[mesKey]) {
        estadoFiltros.rubrosJerarquicos[mesKey].visible = !estadoFiltros.rubrosJerarquicos[mesKey].visible;
        console.log(`👁️ [FILTRO-RUBROS] Mes ${mesKey}: ${estadoFiltros.rubrosJerarquicos[mesKey].visible ? 'visible' : 'oculto'}`);
    }
}

/**
 * Reordenar rubros (inserción con desplazamiento)
 * ✅ MEJORADO: Implementa inserción tipo splice en lugar de intercambio
 * @param {String} rubro1 - Rubro arrastrado
 * @param {String} rubro2 - Rubro objetivo
 * @param {String} mesKey - Clave del mes (null en modo plano)
 * @param {Boolean} insertarAntes - Si true, inserta antes del target; si false, después
 */
function reordenarRubros(rubro1, rubro2, mesKey = null, insertarAntes = true) {
    if (estadoFiltros.modo === 'plano') {
        // ✅ MODO PLANO: Inserción con desplazamiento
        const rubros = estadoFiltros.rubrosPlanos;
        
        // Obtener array ordenado de rubros
        const rubrosOrdenados = Object.entries(rubros)
            .sort((a, b) => a[1].orden - b[1].orden)
            .map(([nombre, _]) => nombre);
        
        // Encontrar índices
        const indexOrigen = rubrosOrdenados.indexOf(rubro1);
        const indexDestino = rubrosOrdenados.indexOf(rubro2);
        
        if (indexOrigen === -1 || indexDestino === -1) {
            console.warn(`⚠️ [FILTRO-RUBROS] Rubros no encontrados: ${rubro1}, ${rubro2}`);
            return;
        }
        
        // Remover el rubro arrastrado
        rubrosOrdenados.splice(indexOrigen, 1);
        
        // Calcular nueva posición de inserción
        let nuevaPosicion;
        if (insertarAntes) {
            // Insertar ANTES del target
            nuevaPosicion = rubrosOrdenados.indexOf(rubro2);
        } else {
            // Insertar DESPUÉS del target
            nuevaPosicion = rubrosOrdenados.indexOf(rubro2) + 1;
        }
        
        // Insertar en la nueva posición
        rubrosOrdenados.splice(nuevaPosicion, 0, rubro1);
        
        // Recalcular todos los valores de orden secuencialmente
        rubrosOrdenados.forEach((rubro, index) => {
            rubros[rubro].orden = index;
        });
        
        console.log(`🔄 [FILTRO-RUBROS] Insertado: ${rubro1} ${insertarAntes ? 'ANTES' : 'DESPUÉS'} de ${rubro2}`);
        console.log(`📊 [FILTRO-RUBROS] Nuevo orden:`, rubrosOrdenados);
        
    } else if (mesKey) {
        // ✅ MODO JERÁRQUICO: Inserción con desplazamiento dentro del mes
        const rubros = estadoFiltros.rubrosJerarquicos[mesKey].rubros;
        
        // Obtener array ordenado de rubros del mes
        const rubrosOrdenados = Object.entries(rubros)
            .sort((a, b) => a[1].orden - b[1].orden)
            .map(([nombre, _]) => nombre);
        
        // Encontrar índices
        const indexOrigen = rubrosOrdenados.indexOf(rubro1);
        const indexDestino = rubrosOrdenados.indexOf(rubro2);
        
        if (indexOrigen === -1 || indexDestino === -1) {
            console.warn(`⚠️ [FILTRO-RUBROS] Rubros no encontrados en ${mesKey}: ${rubro1}, ${rubro2}`);
            return;
        }
        
        // Remover el rubro arrastrado
        rubrosOrdenados.splice(indexOrigen, 1);
        
        // Calcular nueva posición de inserción
        let nuevaPosicion;
        if (insertarAntes) {
            // Insertar ANTES del target
            nuevaPosicion = rubrosOrdenados.indexOf(rubro2);
        } else {
            // Insertar DESPUÉS del target
            nuevaPosicion = rubrosOrdenados.indexOf(rubro2) + 1;
        }
        
        // Insertar en la nueva posición
        rubrosOrdenados.splice(nuevaPosicion, 0, rubro1);
        
        // Recalcular todos los valores de orden secuencialmente
        rubrosOrdenados.forEach((rubro, index) => {
            rubros[rubro].orden = index;
        });
        
        console.log(`🔄 [FILTRO-RUBROS] Insertado en ${mesKey}: ${rubro1} ${insertarAntes ? 'ANTES' : 'DESPUÉS'} de ${rubro2}`);
        console.log(`📊 [FILTRO-RUBROS] Nuevo orden en ${mesKey}:`, rubrosOrdenados);
    }
}

/**
 * Obtener rubros ordenados y filtrados
 */
function obtenerRubrosOrdenados(mesKey = null) {
    if (estadoFiltros.modo === 'plano') {
        return Object.entries(estadoFiltros.rubrosPlanos)
            .filter(([_, data]) => data.visible)
            .sort((a, b) => a[1].orden - b[1].orden)
            .map(([rubro, _]) => rubro);
    } else if (mesKey) {
        const mes = estadoFiltros.rubrosJerarquicos[mesKey];
        if (!mes || !mes.visible) return [];
        
        return Object.entries(mes.rubros)
            .filter(([_, data]) => data.visible)
            .sort((a, b) => a[1].orden - b[1].orden)
            .map(([rubro, _]) => rubro);
    }
    return [];
}

/**
 * Obtener meses ordenados y visibles
 */
function obtenerMesesOrdenados() {
    if (estadoFiltros.modo !== 'jerarquico') return [];
    
    return Object.entries(estadoFiltros.rubrosJerarquicos)
        .filter(([_, data]) => data.visible)
        .sort((a, b) => a[1].orden - b[1].orden)
        .map(([mesKey, data]) => ({ key: mesKey, nombre: data.nombre }));
}

/**
 * Verificar si un rubro debe mostrarse
 */
function esRubroVisible(rubro, mesKey = null) {
    if (estadoFiltros.modo === 'plano') {
        return estadoFiltros.rubrosPlanos[rubro]?.visible ?? true;
    } else if (mesKey) {
        return estadoFiltros.rubrosJerarquicos[mesKey]?.rubros[rubro]?.visible ?? true;
    }
    return true;
}

/**
 * Verificar si un sub-rubro debe mostrarse
 * ✅ NUEVO: Considera tanto la visibilidad del rubro como del sub-rubro
 */
function esSubRubroVisible(rubro, subRubro, mesKey = null) {
    // Primero verificar si el rubro padre es visible
    if (!esRubroVisible(rubro, mesKey)) {
        return false;
    }
    
    // Luego verificar el sub-rubro específico
    if (estadoFiltros.modo === 'plano') {
        return estadoFiltros.rubrosPlanos[rubro]?.subRubros?.[subRubro]?.visible ?? true;
    } else if (mesKey) {
        return estadoFiltros.rubrosJerarquicos[mesKey]?.rubros[rubro]?.subRubros?.[subRubro]?.visible ?? true;
    }
    return true;
}

/**
 * Verificar si un mes debe mostrarse
 */
function esMesVisible(mesKey) {
    return estadoFiltros.rubrosJerarquicos[mesKey]?.visible ?? true;
}

/**
 * Obtener estado actual
 */
function obtenerEstado() {
    return {
        modo: estadoFiltros.modo,
        rubrosPlanos: { ...estadoFiltros.rubrosPlanos },
        rubrosJerarquicos: JSON.parse(JSON.stringify(estadoFiltros.rubrosJerarquicos))
    };
}

console.log('✅ [FILTRO-RUBROS] Módulo cargado correctamente');

// Exportar funciones
export {
    inicializarFiltros,
    toggleVisibilidadRubro,
    toggleVisibilidadSubRubro,
    toggleVisibilidadMes,
    reordenarRubros,
    obtenerRubrosOrdenados,
    obtenerMesesOrdenados,
    esRubroVisible,
    esSubRubroVisible,
    esMesVisible,
    obtenerEstado,
    estadoFiltros
};
