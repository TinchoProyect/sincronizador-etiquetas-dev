// Función para mostrar mensajes de error
export function mostrarError(mensaje) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = mensaje;
    document.querySelector('.modal-content').appendChild(errorDiv);
    
    setTimeout(() => {
        errorDiv.remove();
    }, 3000);
}

// Función para cargar y mostrar los datos del colaborador
export function cargarDatosColaborador(validarCarroActivo) {
    try {
        // Obtener datos del colaborador del localStorage
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        
        if (!colaboradorData) {
            console.error('No hay colaborador seleccionado');
            window.location.href = '/produccion/pages/produccion.html';
            return;
        }

        const colaborador = JSON.parse(colaboradorData);
        console.log('Datos del colaborador:', colaborador);
        
        if (!colaborador.id) {
            console.error('El colaborador no tiene ID');
            limpiarDatosSesion();
            return;
        }

        // Verificar si los datos son recientes (menos de 24 horas)
        const timestamp = new Date(colaborador.timestamp);
        const ahora = new Date();
        const diferencia = ahora - timestamp;
        const horasTranscurridas = diferencia / (1000 * 60 * 60);

        if (horasTranscurridas > 24) {
            console.log('Sesión expirada');
            limpiarDatosSesion();
            return;
        }

        // Mostrar el nombre del colaborador
        const nombreElement = document.getElementById('nombre-colaborador');
        if (nombreElement) {
            nombreElement.textContent = colaborador.nombre || 'Usuario sin nombre';
        }

        // Validar el carro activo
        validarCarroActivo(colaborador.id);

    } catch (error) {
        console.error('Error al cargar datos del colaborador:', error);
        limpiarDatosSesion();
    }
}

// Función para limpiar datos de sesión
export function limpiarDatosSesion() {
    localStorage.removeItem('colaboradorActivo');
    sessionStorage.removeItem('carroActivo');
    window.location.href = '/produccion/pages/produccion.html';
}

/**
 * Obtiene información de la semana para una fecha dada
 * @param {Date|string} fecha - Fecha a analizar
 * @returns {Object} Información de la semana
 */
export function obtenerInfoSemana(fecha) {
    const ahora = new Date();
    const inicioSemanaActual = new Date(ahora);
    inicioSemanaActual.setDate(ahora.getDate() - ahora.getDay());
    inicioSemanaActual.setHours(0, 0, 0, 0);
    
    const fechaCarro = new Date(fecha);
    const inicioSemanaCarro = new Date(fechaCarro);
    inicioSemanaCarro.setDate(fechaCarro.getDate() - fechaCarro.getDay());
    inicioSemanaCarro.setHours(0, 0, 0, 0);
    
    const diferenciaSemanas = Math.floor((inicioSemanaActual - inicioSemanaCarro) / (7 * 24 * 60 * 60 * 1000));
    
    return {
        esHoy: fechaCarro.toDateString() === ahora.toDateString(),
        esSemanaActual: diferenciaSemanas === 0,
        diferenciaSemanas,
        inicioSemana: inicioSemanaCarro,
        etiquetaSemana: generarEtiquetaSemana(diferenciaSemanas, inicioSemanaCarro, fechaCarro)
    };
}

/**
 * Genera etiqueta descriptiva para la semana
 * @param {number} diferenciaSemanas - Diferencia en semanas
 * @param {Date} inicioSemana - Inicio de la semana
 * @param {Date} fechaCarro - Fecha del carro
 * @returns {string} Etiqueta descriptiva
 */
function generarEtiquetaSemana(diferenciaSemanas, inicioSemana, fechaCarro) {
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                   'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    
    if (diferenciaSemanas === 0) {
        return '📅 Esta semana';
    } else if (diferenciaSemanas === 1) {
        return '📆 Semana pasada';
    } else if (diferenciaSemanas <= 4) {
        const mesInicio = meses[inicioSemana.getMonth()];
        const diaInicio = inicioSemana.getDate();
        return `📋 ${diferenciaSemanas}ª semana de ${mesInicio} (${diaInicio})`;
    } else {
        const mes = meses[fechaCarro.getMonth()];
        return `📁 ${mes} ${fechaCarro.getFullYear()}`;
    }
}

/**
 * Agrupa carros por semanas manteniendo orden cronológico
 * @param {Array} carros - Array de carros ordenados por fecha desc
 * @returns {Array} Array de grupos de semanas
 */
export function agruparCarrosPorSemanas(carros) {
    const grupos = new Map();
    
    carros.forEach(carro => {
        const infoSemana = obtenerInfoSemana(carro.fecha_inicio);
        const claveSemana = `${infoSemana.diferenciaSemanas}-${infoSemana.inicioSemana.getTime()}`;
        
        if (!grupos.has(claveSemana)) {
            grupos.set(claveSemana, {
                etiqueta: infoSemana.etiquetaSemana,
                esActual: infoSemana.esSemanaActual,
                diferenciaSemanas: infoSemana.diferenciaSemanas,
                carros: []
            });
        }
        
        grupos.get(claveSemana).carros.push({
            ...carro,
            esHoy: infoSemana.esHoy
        });
    });
    
    // Convertir Map a Array y ordenar por diferencia de semanas (más reciente primero)
    return Array.from(grupos.values()).sort((a, b) => a.diferenciaSemanas - b.diferenciaSemanas);
}

/**
 * Agrupa carros por semanas recientes y luego por meses calendario para registros más antiguos
 * @param {Array} carros - Array de carros ordenados por fecha desc
 * @returns {Array} Array de grupos mixtos (semanas y meses)
 */
export function agruparCarrosPorSemanasYMeses(carros) {
    const gruposSemanales = new Map();
    const gruposMensuales = new Map();

    carros.forEach(carro => {
        const infoSemana = obtenerInfoSemana(carro.fecha_inicio);
        const diferenciaSemanas = infoSemana.diferenciaSemanas;

        if (diferenciaSemanas <= 1) {
            // Agrupar en semanas "Esta semana" y "Semana pasada"
            const claveSemana = `${diferenciaSemanas}-${infoSemana.inicioSemana.getTime()}`;
            if (!gruposSemanales.has(claveSemana)) {
                gruposSemanales.set(claveSemana, {
                    etiqueta: infoSemana.etiquetaSemana,
                    esActual: infoSemana.esSemanaActual,
                    diferenciaSemanas: diferenciaSemanas,
                    carros: []
                });
            }
            gruposSemanales.get(claveSemana).carros.push({
                ...carro,
                esHoy: infoSemana.esHoy
            });
        } else {
            // Agrupar por mes y año calendario para registros más antiguos
            const fechaCarro = new Date(carro.fecha_inicio);
            const mes = fechaCarro.getMonth();
            const anio = fechaCarro.getFullYear();
            const claveMes = `${anio}-${mes}`;

            if (!gruposMensuales.has(claveMes)) {
                const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                                      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
                gruposMensuales.set(claveMes, {
                    etiqueta: `📁 ${mesesNombres[mes]} ${anio}`,
                    esActual: false,
                    anio: anio,
                    mes: mes,
                    carros: []
                });
            }
            gruposMensuales.get(claveMes).carros.push({
                ...carro,
                esHoy: infoSemana.esHoy
            });
        }
    });

    // Ordenar carros dentro de cada grupo por fecha descendente
    gruposSemanales.forEach(grupo => {
        grupo.carros.sort((a, b) => new Date(b.fecha_inicio) - new Date(a.fecha_inicio));
    });
    gruposMensuales.forEach(grupo => {
        grupo.carros.sort((a, b) => new Date(b.fecha_inicio) - new Date(a.fecha_inicio));
    });

    // Convertir Map a Array y ordenar grupos
    const arraySemanales = Array.from(gruposSemanales.values()).sort((a, b) => a.diferenciaSemanas - b.diferenciaSemanas);
    const arrayMensuales = Array.from(gruposMensuales.values()).sort((a, b) => {
        if (a.anio !== b.anio) return b.anio - a.anio;
        return b.mes - a.mes;
    });

    // Combinar: semanas primero, luego meses
    return [...arraySemanales, ...arrayMensuales];
}

// Estilos CSS para la tabla de carros

export const estilosTablaCarros = `
    .carros-lista {
        margin: 20px 0;
    }

    .tabla-carros-grupo {
        width: 100%;
        border-collapse: collapse;
        transition: max-height 0.3s ease, opacity 0.3s ease;
        overflow: visible;
        position: relative;
    }

    .tabla-carros-grupo tr {
        cursor: pointer;
        transition: background-color 0.15s ease;
        border-bottom: 1px solid #e2e8f0;
    }

    .tabla-carros-grupo th, .tabla-carros-grupo td {
        padding: 9px 12px;
        text-align: left;
        font-size: 12.5px;
    }

    .tabla-carros-grupo th {
        background-color: #f8fafc;
        color: #475569;
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        border-bottom: 2px solid #cbd5e1;
    }

    /* Carro Interno Activo */
    .carro-activo {
        background-color: #f0fdf4 !important;
        border-left: 4px solid #10b981 !important;
    }

    .carro-finalizado {
        background-color: #f8fafc;
        color: #64748b;
    }

    .carro-finalizado.carro-activo {
        background-color: #f1f5f9 !important;
    }

    /* ---------------------------------------------------
       IDENTIDAD VISUAL EXCLUSIVA: PRODUCCIÓN EXTERNA
       --------------------------------------------------- */
       
    .carro-externo {
        background-color: #f8fafc;
        border-left: 4px solid #94a3b8;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }

    .carro-externo:hover {
        background-color: #eff6ff;
    }

    .carro-externo.carro-activo {
        background-color: #eff6ff !important;
        border-left: 4px solid #2563eb !important;
    }

    .carro-externo.carro-finalizado {
        background-color: #f8fafc;
        border-left: 4px solid #64748b;
    }

    .btn-group {
        display: inline-flex;
        align-items: center;
        gap: 8px;
    }

    .btn-eliminar {
        padding: 4px 8px;
        background-color: #fee2e2;
        color: #b91c1c;
        border: 1px solid #fecaca;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .btn-eliminar:hover {
        background-color: #ef4444;
        color: white;
        border-color: #dc2626;
    }

    .no-carros {
        text-align: center;
        padding: 30px 20px;
        background-color: #f8fafc;
        border: 1px dashed #cbd5e1;
        border-radius: 8px;
        margin: 20px 0;
        color: #64748b;
    }
`;
