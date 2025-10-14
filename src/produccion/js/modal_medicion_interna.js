// modal_medicion_interna.js - Sistema de medición centralizado para carros internos
// Solo funciona con carros de tipo 'interna', sin afectar carros externos

import { formatearTiempo } from './temporizador_carro.js';

// ==========================================
// ESTADO GLOBAL DEL MODAL
// ==========================================

let estadoModal = {
    carroId: null,
    usuarioId: null,
    etapaActual: 0, // 0=cerrado, 1=preparación, 2=medición, 3=finalización
    timers: {
        etapa1: { interval: null, start: null, elapsed: 0 },
        etapa3: { interval: null, start: null, elapsed: 0 },
        articulos: new Map() // key: articulo_numero, value: {interval, start, elapsed}
    },
    articulosMedidos: new Set(),
    totalArticulos: 0
};

// ==========================================
// FUNCIONES DE LOGGING
// ==========================================

function log(mensaje, tipo = 'info') {
    const timestamp = new Date().toISOString();
    const emoji = tipo === 'error' ? '❌' : tipo === 'success' ? '✅' : '📋';
    console.log(`${emoji} [MODAL-MEDICION] ${timestamp} - ${mensaje}`);
    
    // Agregar al log visual si está habilitado
    const logsContainer = document.getElementById('logs-content-medicion');
    if (logsContainer && logsContainer.parentElement.style.display !== 'none') {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${tipo}`;
        logEntry.textContent = `${timestamp} - ${mensaje}`;
        logsContainer.appendChild(logEntry);
        logsContainer.scrollTop = logsContainer.scrollHeight;
    }
}

// ==========================================
// FUNCIONES DE APERTURA/CIERRE DEL MODAL
// ==========================================

export async function abrirModalMedicion(carroId) {
    try {
        log(`Abriendo modal de medición para carro ${carroId}`);
        
        // Validar que sea carro interno
        const tipoCarro = await validarTipoCarroInterno(carroId);
        if (!tipoCarro) {
            throw new Error('Este modal solo funciona con carros internos');
        }
        
        // Obtener usuario activo
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }
        
        const colaborador = JSON.parse(colaboradorData);
        estadoModal.carroId = carroId;
        estadoModal.usuarioId = colaborador.id;
        
        // Cargar estado desde backend
        await cargarEstadoDesdeBackend(carroId, colaborador.id);
        
        // Mostrar modal
        const modal = document.getElementById('modalMedicionInterna');
        if (!modal) {
            throw new Error('No se encontró el modal de medición');
        }
        
        // Actualizar info del carro
        document.getElementById('carro-id-medicion').textContent = carroId;
        
        // Mostrar modal con animación
        modal.style.display = 'block';
        setTimeout(() => modal.classList.add('show'), 10);
        
        // Actualizar UI según estado actual
        await actualizarUIModal();
        
        log('Modal de medición abierto correctamente', 'success');
        
    } catch (error) {
        log(`Error al abrir modal: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
    }
}

export function cerrarModalMedicion() {
    try {
        log('Cerrando modal de medición');
        
        const modal = document.getElementById('modalMedicionInterna');
        if (!modal) return;
        
        // Detener todos los intervalos
        detenerTodosLosTimers();
        
        // Cerrar con animación
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
            
            // Limpiar estado
            estadoModal = {
                carroId: null,
                usuarioId: null,
                etapaActual: 0,
                timers: {
                    etapa1: { interval: null, start: null, elapsed: 0 },
                    etapa3: { interval: null, start: null, elapsed: 0 },
                    articulos: new Map()
                },
                articulosMedidos: new Set(),
                totalArticulos: 0
            };
            
            log('Modal cerrado correctamente', 'success');
        }, 300);
        
    } catch (error) {
        log(`Error al cerrar modal: ${error.message}`, 'error');
    }
}

// ==========================================
// VALIDACIÓN Y CARGA DE ESTADO
// ==========================================

async function validarTipoCarroInterno(carroId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
        if (!response.ok) return false;
        
        const data = await response.json();
        const esInterno = data.tipo_carro === 'interna';
        
        log(`Tipo de carro validado: ${data.tipo_carro} (interno: ${esInterno})`);
        return esInterno;
        
    } catch (error) {
        log(`Error validando tipo de carro: ${error.message}`, 'error');
        return false;
    }
}

async function cargarEstadoDesdeBackend(carroId, usuarioId) {
    try {
        log('Cargando estado desde backend...');
        
        // Cargar estado de etapas
        const responseEtapas = await fetch(
            `http://localhost:3002/api/tiempos/carro/${carroId}/etapas/estado?usuarioId=${usuarioId}`
        );
        
        if (responseEtapas.ok) {
            const estadoEtapas = await responseEtapas.json();
            procesarEstadoEtapas(estadoEtapas);
        }
        
        // Cargar estado de artículos
        const responseArticulos = await fetch(
            `http://localhost:3002/api/tiempos/carro/${carroId}/articulos/estado?usuarioId=${usuarioId}`
        );
        
        if (responseArticulos.ok) {
            const estadoArticulos = await responseArticulos.json();
            procesarEstadoArticulos(estadoArticulos);
        }
        
        log('Estado cargado correctamente', 'success');
        
    } catch (error) {
        log(`Error cargando estado: ${error.message}`, 'error');
    }
}

function procesarEstadoEtapas(estado) {
    // Determinar etapa actual
    if (estado.etapa3_inicio && !estado.etapa3_fin) {
        estadoModal.etapaActual = 3;
        if (estado.etapa3_inicio) {
            estadoModal.timers.etapa3.start = Date.parse(estado.etapa3_inicio);
        }
    } else if (estado.etapa2_inicio && !estado.etapa2_fin) {
        estadoModal.etapaActual = 2;
    } else if (estado.etapa1_inicio && !estado.etapa1_fin) {
        estadoModal.etapaActual = 1;
        if (estado.etapa1_inicio) {
            estadoModal.timers.etapa1.start = Date.parse(estado.etapa1_inicio);
        }
    } else if (estado.etapa1_fin) {
        estadoModal.etapaActual = 2; // Si E1 terminó, estamos en E2
    }
    
    // Cargar duraciones finalizadas
    if (estado.etapa1_duracion_ms) {
        estadoModal.timers.etapa1.elapsed = estado.etapa1_duracion_ms;
    }
    if (estado.etapa3_duracion_ms) {
        estadoModal.timers.etapa3.elapsed = estado.etapa3_duracion_ms;
    }
    
    log(`Etapa actual determinada: ${estadoModal.etapaActual}`);
}

function procesarEstadoArticulos(articulos) {
    articulos.forEach(art => {
        const key = art.articulo_numero;
        
        if (art.tiempo_fin) {
            // Artículo ya medido
            estadoModal.articulosMedidos.add(key);
            estadoModal.timers.articulos.set(key, {
                interval: null,
                start: null,
                elapsed: art.duracion_ms || 0
            });
        } else if (art.tiempo_inicio) {
            // Artículo en medición
            estadoModal.timers.articulos.set(key, {
                interval: null,
                start: Date.parse(art.tiempo_inicio),
                elapsed: 0
            });
        }
    });
    
    log(`Artículos procesados: ${articulos.length} (medidos: ${estadoModal.articulosMedidos.size})`);
}

// ==========================================
// ACTUALIZACIÓN DE UI
// ==========================================

async function actualizarUIModal() {
    try {
        log('Actualizando UI del modal...');
        
        // Ocultar todas las etapas primero
        document.getElementById('etapa1-medicion').style.display = 'none';
        document.getElementById('etapa2-medicion').style.display = 'none';
        document.getElementById('etapa3-medicion').style.display = 'none';
        
        // Mostrar etapa actual
        switch (estadoModal.etapaActual) {
            case 0:
            case 1:
                await mostrarEtapa1();
                break;
            case 2:
                await mostrarEtapa2();
                break;
            case 3:
                await mostrarEtapa3();
                break;
        }
        
        log('UI actualizada correctamente', 'success');
        
    } catch (error) {
        log(`Error actualizando UI: ${error.message}`, 'error');
    }
}

async function mostrarEtapa1() {
    const etapa1 = document.getElementById('etapa1-medicion');
    etapa1.style.display = 'block';
    
    const btnInicio = document.getElementById('btn-inicio-etapa1');
    const btnCarroListo = document.getElementById('btn-carro-listo-medicion');
    const timerDisplay = document.getElementById('timer-etapa1');
    
    const timer = estadoModal.timers.etapa1;
    
    if (timer.start && !timer.elapsed) {
        // Timer corriendo
        btnInicio.style.display = 'none';
        btnCarroListo.style.display = 'inline-block';
        iniciarIntervalEtapa1();
    } else if (timer.elapsed > 0) {
        // Timer finalizado
        btnInicio.style.display = 'none';
        btnCarroListo.style.display = 'inline-block';
        timerDisplay.textContent = formatearTiempo(timer.elapsed);
    } else {
        // Sin iniciar
        btnInicio.style.display = 'inline-block';
        btnCarroListo.style.display = 'none';
        timerDisplay.textContent = '00:00';
    }
}

async function mostrarEtapa2() {
    const etapa2 = document.getElementById('etapa2-medicion');
    etapa2.style.display = 'block';
    
    // Cargar artículos del carro
    await cargarArticulosParaMedicion();
    
    // Actualizar timer total
    actualizarTimerTotalEtapa2();
    
    // Verificar si todos los artículos están medidos
    verificarCompletitudEtapa2();
}

async function mostrarEtapa3() {
    const etapa3 = document.getElementById('etapa3-medicion');
    etapa3.style.display = 'block';
    
    const timer = estadoModal.timers.etapa3;
    const timerDisplay = document.getElementById('timer-etapa3');
    
    if (timer.start && !timer.elapsed) {
        // Timer corriendo
        iniciarIntervalEtapa3();
    } else if (timer.elapsed > 0) {
        // Timer finalizado
        timerDisplay.textContent = formatearTiempo(timer.elapsed);
    } else {
        timerDisplay.textContent = '00:00';
    }
}

// ==========================================
// ETAPA 1: PREPARACIÓN
// ==========================================

window.iniciarEtapa1Medicion = async function() {
    try {
        log('Iniciando Etapa 1...');
        
        const response = await fetch(
            `http://localhost:3002/api/tiempos/carro/${estadoModal.carroId}/etapa/1/iniciar?usuarioId=${estadoModal.usuarioId}`,
            { method: 'POST' }
        );
        
        if (!response.ok) {
            throw new Error('Error al iniciar Etapa 1');
        }
        
        estadoModal.etapaActual = 1;
        estadoModal.timers.etapa1.start = Date.now();
        
        await actualizarUIModal();
        
        log('Etapa 1 iniciada correctamente', 'success');
        
    } catch (error) {
        log(`Error iniciando Etapa 1: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
    }
};

function iniciarIntervalEtapa1() {
    const timer = estadoModal.timers.etapa1;
    if (timer.interval) clearInterval(timer.interval);
    
    timer.interval = setInterval(() => {
        const elapsed = Date.now() - timer.start;
        document.getElementById('timer-etapa1').textContent = formatearTiempo(elapsed);
    }, 1000);
}

window.carroListoParaProducirMedicion = async function() {
    try {
        log('Finalizando Etapa 1 e iniciando Etapa 2...');
        
        // Detener timer de Etapa 1
        const timer = estadoModal.timers.etapa1;
        if (timer.interval) {
            clearInterval(timer.interval);
            timer.interval = null;
        }
        timer.elapsed = Date.now() - timer.start;
        
        // Finalizar Etapa 1 en backend
        const response1 = await fetch(
            `http://localhost:3002/api/tiempos/carro/${estadoModal.carroId}/etapa/1/finalizar?usuarioId=${estadoModal.usuarioId}`,
            { method: 'POST' }
        );
        
        if (!response1.ok) {
            throw new Error('Error al finalizar Etapa 1');
        }
        
        // Iniciar Etapa 2 en backend
        const response2 = await fetch(
            `http://localhost:3002/api/tiempos/carro/${estadoModal.carroId}/etapa/2/iniciar?usuarioId=${estadoModal.usuarioId}`,
            { method: 'POST' }
        );
        
        if (!response2.ok) {
            throw new Error('Error al iniciar Etapa 2');
        }
        
        // Invocar handler del carro para marcar como preparado
        if (typeof window.marcarCarroPreparado === 'function') {
            await window.marcarCarroPreparado(estadoModal.carroId);
        }
        
        estadoModal.etapaActual = 2;
        await actualizarUIModal();
        
        log('Transición E1→E2 completada correctamente', 'success');
        
    } catch (error) {
        log(`Error en transición E1→E2: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
    }
};

// ==========================================
// ETAPA 2: MEDICIÓN POR ARTÍCULO
// ==========================================

async function cargarArticulosParaMedicion() {
    try {
        const response = await fetch(
            `http://localhost:3002/api/produccion/carro/${estadoModal.carroId}/articulos?usuarioId=${estadoModal.usuarioId}`
        );
        
        if (!response.ok) {
            throw new Error('Error al cargar artículos');
        }
        
        const articulos = await response.json();
        estadoModal.totalArticulos = articulos.length;
        
        const container = document.getElementById('articulos-medicion-lista');
        container.innerHTML = '';
        
        articulos.forEach(art => {
            const articuloDiv = crearElementoArticuloMedicion(art);
            container.appendChild(articuloDiv);
        });
        
        log(`${articulos.length} artículos cargados para medición`);
        
    } catch (error) {
        log(`Error cargando artículos: ${error.message}`, 'error');
    }
}

function crearElementoArticuloMedicion(articulo) {
    const div = document.createElement('div');
    div.className = 'articulo-medicion-item';
    div.dataset.numero = articulo.numero;
    
    const timer = estadoModal.timers.articulos.get(articulo.numero);
    const estaMedido = estadoModal.articulosMedidos.has(articulo.numero);
    const estaCorriendo = timer && timer.start && !estaMedido;
    
    let estadoHTML = '';
    let botonHTML = '';
    
    if (estaMedido) {
        const elapsed = timer ? timer.elapsed : 0;
        estadoHTML = `<span class="timer-articulo finalizado">✅ ${formatearTiempo(elapsed)}</span>`;
        botonHTML = '<button class="btn btn-secondary btn-sm" disabled>Finalizado</button>';
    } else if (estaCorriendo) {
        estadoHTML = `<span class="timer-articulo corriendo" id="timer-art-${articulo.numero}">⏱ 00:00</span>`;
        botonHTML = `<button class="btn btn-danger btn-sm" onclick="detenerMedicionArticulo('${articulo.numero}')">⏹ Detener</button>`;
    } else {
        estadoHTML = '<span class="timer-articulo">⏱ 00:00</span>';
        botonHTML = `<button class="btn btn-primary btn-sm" onclick="iniciarMedicionArticulo('${articulo.numero}')">▶️ Iniciar</button>`;
    }
    
    div.innerHTML = `
        <div class="articulo-info-medicion">
            <span class="articulo-codigo-medicion">${articulo.numero}</span>
            <span class="articulo-desc-medicion">${articulo.descripcion}</span>
            <span class="articulo-cant-medicion">×${articulo.cantidad}</span>
        </div>
        <div class="articulo-timer-medicion">
            ${estadoHTML}
        </div>
        <div class="articulo-actions-medicion">
            ${botonHTML}
        </div>
    `;
    
    // Si está corriendo, iniciar interval
    if (estaCorriendo) {
        iniciarIntervalArticulo(articulo.numero);
    }
    
    return div;
}

window.iniciarMedicionArticulo = async function(numeroArticulo) {
    try {
        log(`Iniciando medición de artículo ${numeroArticulo}...`);
        
        const response = await fetch(
            `http://localhost:3002/api/tiempos/carro/${estadoModal.carroId}/articulo/${encodeURIComponent(numeroArticulo)}/iniciar?usuarioId=${estadoModal.usuarioId}`,
            { method: 'POST' }
        );
        
        if (!response.ok) {
            throw new Error('Error al iniciar medición de artículo');
        }
        
        // Actualizar estado
        estadoModal.timers.articulos.set(numeroArticulo, {
            interval: null,
            start: Date.now(),
            elapsed: 0
        });
        
        // Actualizar UI del artículo
        await cargarArticulosParaMedicion();
        
        log(`Medición de artículo ${numeroArticulo} iniciada`, 'success');
        
    } catch (error) {
        log(`Error iniciando medición de artículo: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
    }
};

window.detenerMedicionArticulo = async function(numeroArticulo) {
    try {
        log(`Deteniendo medición de artículo ${numeroArticulo}...`);
        
        const timer = estadoModal.timers.articulos.get(numeroArticulo);
        if (!timer) return;
        
        // Detener interval
        if (timer.interval) {
            clearInterval(timer.interval);
            timer.interval = null;
        }
        
        const elapsed = Date.now() - timer.start;
        
        const response = await fetch(
            `http://localhost:3002/api/tiempos/carro/${estadoModal.carroId}/articulo/${encodeURIComponent(numeroArticulo)}/finalizar?usuarioId=${estadoModal.usuarioId}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ elapsedMs: elapsed })
            }
        );
        
        if (!response.ok) {
            throw new Error('Error al finalizar medición de artículo');
        }
        
        // Actualizar estado
        timer.elapsed = elapsed;
        timer.start = null;
        estadoModal.articulosMedidos.add(numeroArticulo);
        
        // Actualizar UI
        await cargarArticulosParaMedicion();
        actualizarTimerTotalEtapa2();
        verificarCompletitudEtapa2();
        
        log(`Medición de artículo ${numeroArticulo} finalizada (${formatearTiempo(elapsed)})`, 'success');
        
    } catch (error) {
        log(`Error deteniendo medición de artículo: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
    }
};

function iniciarIntervalArticulo(numeroArticulo) {
    const timer = estadoModal.timers.articulos.get(numeroArticulo);
    if (!timer || !timer.start) return;
    
    if (timer.interval) clearInterval(timer.interval);
    
    timer.interval = setInterval(() => {
        const elapsed = Date.now() - timer.start;
        const display = document.getElementById(`timer-art-${numeroArticulo}`);
        if (display) {
            display.textContent = `⏱ ${formatearTiempo(elapsed)}`;
        }
    }, 1000);
}

function actualizarTimerTotalEtapa2() {
    let totalMs = 0;
    
    estadoModal.timers.articulos.forEach((timer, key) => {
        if (estadoModal.articulosMedidos.has(key)) {
            totalMs += timer.elapsed;
        } else if (timer.start) {
            totalMs += Date.now() - timer.start;
        }
    });
    
    const display = document.getElementById('timer-total-etapa2');
    if (display) {
        display.textContent = formatearTiempo(totalMs);
    }
    
    // Actualizar cada segundo si hay timers corriendo
    const hayTimersCorriendo = Array.from(estadoModal.timers.articulos.values())
        .some(t => t.start && !estadoModal.articulosMedidos.has(t.key));
    
    if (hayTimersCorriendo) {
        setTimeout(() => actualizarTimerTotalEtapa2(), 1000);
    }
}

function verificarCompletitudEtapa2() {
    const todosMedidos = estadoModal.articulosMedidos.size === estadoModal.totalArticulos;
    const btnCompletar = document.getElementById('btn-completar-etapa2');
    
    if (btnCompletar) {
        btnCompletar.style.display = todosMedidos ? 'inline-block' : 'none';
    }
    
    if (todosMedidos) {
        log(`Todos los artículos medidos (${estadoModal.totalArticulos}/${estadoModal.totalArticulos})`, 'success');
    }
}

window.completarEtapa2Medicion = async function() {
    try {
        log('Completando Etapa 2 e iniciando Etapa 3...');
        
        // Calcular duración total de Etapa 2 (sumatoria)
        let totalMs = 0;
        estadoModal.timers.articulos.forEach((timer, key) => {
            if (estadoModal.articulosMedidos.has(key)) {
                totalMs += timer.elapsed;
            }
        });
        
        log(`Duración total Etapa 2: ${formatearTiempo(totalMs)}`);
        
        // Finalizar Etapa 2 en backend
        const response2 = await fetch(
            `http://localhost:3002/api/tiempos/carro/${estadoModal.carroId}/etapa/2/finalizar?usuarioId=${estadoModal.usuarioId}`,
            { method: 'POST' }
        );
        
        if (!response2.ok) {
            throw new Error('Error al finalizar Etapa 2');
        }
        
        // Iniciar Etapa 3
        const response3 = await fetch(
            `http://localhost:3002/api/tiempos/carro/${estadoModal.carroId}/etapa/3/iniciar?usuarioId=${estadoModal.usuarioId}`,
            { method: 'POST' }
        );
        
        if (!response3.ok) {
            throw new Error('Error al iniciar Etapa 3');
        }
        
        estadoModal.etapaActual = 3;
        estadoModal.timers.etapa3.start = Date.now();
        
        await actualizarUIModal();
        
        log('Transición E2→E3 completada correctamente', 'success');
        
    } catch (error) {
        log(`Error en transición E2→E3: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
    }
};

// ==========================================
// ETAPA 3: FINALIZACIÓN
// ==========================================

function iniciarIntervalEtapa3() {
    const timer = estadoModal.timers.etapa3;
    if (timer.interval) clearInterval(timer.interval);
    
    timer.interval = setInterval(() => {
        const elapsed = Date.now() - timer.start;
        document.getElementById('timer-etapa3').textContent = formatearTiempo(elapsed);
    }, 1000);
}

window.finalizarMedicion = async function() {
    try {
        log('Finalizando medición completa...');
        
        // Detener timer de Etapa 3
        const timer = estadoModal.timers.etapa3;
        if (timer.interval) {
            clearInterval(timer.interval);
            timer.interval = null;
        }
        timer.elapsed = Date.now() - timer.start;
        
        // Finalizar Etapa 3 en backend
        const response = await fetch(
            `http://localhost:3002/api/tiempos/carro/${estadoModal.carroId}/etapa/3/finalizar?usuarioId=${estadoModal.usuarioId}`,
            { method: 'POST' }
        );
        
        if (!response.ok) {
            throw new Error('Error al finalizar Etapa 3');
        }
        
        // Invocar handler de asentar producción si existe
        if (typeof window.finalizarProduccion === 'function') {
            await window.finalizarProduccion(estadoModal.carroId);
        }
        
        log('Medición finalizada correctamente', 'success');
        
        // Cerrar modal
        setTimeout(() => {
            cerrarModalMedicion();
            alert('✅ Medición completada exitosamente');
        }, 1000);
        
    } catch (error) {
        log(`Error finalizando medición: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
    }
};

// ==========================================
// UTILIDADES
// ==========================================

function detenerTodosLosTimers() {
    // Detener timer Etapa 1
    if (estadoModal.timers.etapa1.interval) {
        clearInterval(estadoModal.timers.etapa1.interval);
        estadoModal.timers.etapa1.interval = null;
    }
    
    // Detener timer Etapa 3
    if (estadoModal.timers.etapa3.interval) {
        clearInterval(estadoModal.timers.etapa3.interval);
        estadoModal.timers.etapa3.interval = null;
    }
    
    // Detener timers de artículos
    estadoModal.timers.articulos.forEach(timer => {
        if (timer.interval) {
            clearInterval(timer.interval);
            timer.interval = null;
        }
    });
}

// Hacer funciones disponibles globalmente
window.abrirModalMedicion = abrirModalMedicion;
window.cerrarModalMedicion = cerrarModalMedicion;

// Log de inicialización
log('Módulo de medición interna inicializado correctamente', 'success');
