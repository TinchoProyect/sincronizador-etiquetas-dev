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
 */
function extraerEstructuraPlana(productos) {
    const rubrosSet = new Set();
    
    productos.forEach(p => {
        const rubro = p.rubro || 'Sin categoría';
        rubrosSet.add(rubro);
    });
    
    // ✅ ORDENAR SEGÚN PRIORIDAD DE NEGOCIO
    const rubros = Array.from(rubrosSet).sort((a, b) => {
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
    
    // Crear estructura con estado inicial
    const estructura = {};
    rubros.forEach((rubro, index) => {
        estructura[rubro] = {
            visible: rubro !== 'Sin categoría', // "Sin categoría" oculto por defecto
            orden: index,
            nombre: rubro
        };
    });
    
    console.log(`📋 [FILTRO-RUBROS] Orden aplicado:`, rubros);
    return estructura;
}

/**
 * Extraer estructura jerárquica (Mes → Rubros) con orden de prioridad
 * ✅ FIX: Agrupa meses antiguos (>6 meses) en "Más de 6 meses"
 */
function extraerEstructuraJerarquica(productos) {
    const estructura = {};
    const ahora = new Date();
    
    // Agrupar por mes (con lógica de 6 meses)
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
                nombre: rubro
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
            rubrosReordenados[rubro] = {
                ...rubros[rubro],
                orden: idx
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
 */
function toggleVisibilidadRubro(rubro, mesKey = null) {
    if (estadoFiltros.modo === 'plano') {
        if (estadoFiltros.rubrosPlanos[rubro]) {
            estadoFiltros.rubrosPlanos[rubro].visible = !estadoFiltros.rubrosPlanos[rubro].visible;
            console.log(`👁️ [FILTRO-RUBROS] ${rubro}: ${estadoFiltros.rubrosPlanos[rubro].visible ? 'visible' : 'oculto'}`);
        }
    } else {
        if (mesKey && estadoFiltros.rubrosJerarquicos[mesKey]) {
            if (estadoFiltros.rubrosJerarquicos[mesKey].rubros[rubro]) {
                const estado = estadoFiltros.rubrosJerarquicos[mesKey].rubros[rubro];
                estado.visible = !estado.visible;
                console.log(`👁️ [FILTRO-RUBROS] ${mesKey} → ${rubro}: ${estado.visible ? 'visible' : 'oculto'}`);
            }
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
 * Reordenar rubros (intercambiar posiciones)
 */
function reordenarRubros(rubro1, rubro2, mesKey = null) {
    if (estadoFiltros.modo === 'plano') {
        const orden1 = estadoFiltros.rubrosPlanos[rubro1].orden;
        const orden2 = estadoFiltros.rubrosPlanos[rubro2].orden;
        
        estadoFiltros.rubrosPlanos[rubro1].orden = orden2;
        estadoFiltros.rubrosPlanos[rubro2].orden = orden1;
        
        console.log(`🔄 [FILTRO-RUBROS] Intercambiado: ${rubro1} ↔ ${rubro2}`);
    } else if (mesKey) {
        const rubros = estadoFiltros.rubrosJerarquicos[mesKey].rubros;
        const orden1 = rubros[rubro1].orden;
        const orden2 = rubros[rubro2].orden;
        
        rubros[rubro1].orden = orden2;
        rubros[rubro2].orden = orden1;
        
        console.log(`🔄 [FILTRO-RUBROS] Intercambiado en ${mesKey}: ${rubro1} ↔ ${rubro2}`);
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
    toggleVisibilidadMes,
    reordenarRubros,
    obtenerRubrosOrdenados,
    obtenerMesesOrdenados,
    esRubroVisible,
    esMesVisible,
    obtenerEstado,
    estadoFiltros
};
