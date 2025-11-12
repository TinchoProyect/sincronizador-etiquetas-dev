// modal_medicion_interna.js - Sistema de medición centralizado para carros internos
// Solo funciona con carros de tipo 'interna', sin afectar carros externos

import { formatearTiempo, formatearTiempoCompleto } from './utils/formatearTiempo.js';

// ==========================================
// ESTADO GLOBAL DEL MODAL
// ==========================================

let estadoModal = {
    carroId: null,
    usuarioId: null,
    etapaActual: 0, // 0=cerrado, 1=preparación, 2=medición, 3=finalización, 4=resumen
    modalMinimizado: false, // Estado de minimización del modal
    etapa1Pausada: false, // Estado de pausa de Etapa 1
    etapa1TiempoAcumulado: 0, // Tiempo acumulado antes de pausar
    timers: {
        etapa1: { interval: null, start: null, elapsed: 0 },
        etapa2: { interval: null, start: null, elapsed: 0 },
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
        
        // Actualizar info del carro en ambas vistas
        document.getElementById('carro-id-medicion').textContent = carroId;
        const carroIdMinimizado = document.getElementById('carro-id-minimizado');
        if (carroIdMinimizado) {
            carroIdMinimizado.textContent = carroId;
        }
        
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
        
        // Ocultar vista minimizada si está visible
        const vistaMinimizada = document.getElementById('modal-medicion-minimizado');
        if (vistaMinimizada) {
            vistaMinimizada.style.display = 'none';
        }
        
        // Cerrar con animación
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
            
            // Limpiar estado
            estadoModal = {
                carroId: null,
                usuarioId: null,
                etapaActual: 0,
                modalMinimizado: false,
                etapa1Pausada: false,
                etapa1TiempoAcumulado: 0,
                timers: {
                    etapa1: { interval: null, start: null, elapsed: 0 },
                    etapa2: { interval: null, start: null, elapsed: 0 },
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
    } else if (estado.etapa3_fin) {
        // ✅ NUEVO: Si E3 está finalizada, mostrar resumen completo
        estadoModal.etapaActual = 4;  // 4 = Resumen completo
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
    if (estado.etapa2_duracion_ms) {
        estadoModal.timers.etapa2.elapsed = estado.etapa2_duracion_ms;
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
        const resumenElement = document.getElementById('resumen-completo-medicion');
        if (resumenElement) {
            resumenElement.style.display = 'none';
        }
        
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
            case 4:
                await mostrarResumenCompleto();
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
        timerDisplay.classList.add('corriendo');
        timerDisplay.classList.remove('finalizado');
        iniciarIntervalEtapa1();
        
        // Sincronizar botones en todas las vistas
        sincronizarBotonesCarroListo(true);
    } else if (timer.elapsed > 0) {
        // Timer finalizado
        btnInicio.style.display = 'none';
        btnCarroListo.style.display = 'inline-block';
        timerDisplay.textContent = formatearTiempo(timer.elapsed);
        timerDisplay.classList.remove('corriendo');
        timerDisplay.classList.add('finalizado');
        
        // Sincronizar botones en todas las vistas
        sincronizarBotonesCarroListo(true);
    } else {
        // Sin iniciar
        btnInicio.style.display = 'inline-block';
        btnCarroListo.style.display = 'none';
        timerDisplay.textContent = '00:00';
        timerDisplay.classList.remove('corriendo', 'finalizado');
        
        // Ocultar botones en todas las vistas
        sincronizarBotonesCarroListo(false);
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
        timerDisplay.classList.add('corriendo');
        timerDisplay.classList.remove('finalizado');
        iniciarIntervalEtapa3();
    } else if (timer.elapsed > 0) {
        // Timer finalizado
        timerDisplay.textContent = formatearTiempo(timer.elapsed);
        timerDisplay.classList.remove('corriendo');
        timerDisplay.classList.add('finalizado');
    } else {
        timerDisplay.textContent = '00:00';
        timerDisplay.classList.remove('corriendo', 'finalizado');
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
        estadoModal.etapa1Pausada = false;
        estadoModal.etapa1TiempoAcumulado = 0;
        
        await actualizarUIModal();
        
        // Sincronizar botones en todas las vistas
        sincronizarBotonesCarroListo(true);
        
        // Minimizar modal automáticamente después de iniciar
        minimizarModal();
        
        log('Etapa 1 iniciada correctamente', 'success');
        
    } catch (error) {
        log(`Error iniciando Etapa 1: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
    }
};

function iniciarIntervalEtapa1() {
    const timer = estadoModal.timers.etapa1;
    if (timer.interval) clearInterval(timer.interval);

    const el = document.getElementById('timer-etapa1');
    if (el) { el.classList.add('corriendo'); el.classList.remove('finalizado');}

    const display = document.getElementById('timer-etapa1'); 
    if (display) display.textContent = '⏱ 00:00';
    
    timer.interval = setInterval(() => {
        if (!estadoModal.etapa1Pausada) {
            const elapsed = estadoModal.etapa1TiempoAcumulado + (Date.now() - timer.start);
            const tiempoFormateado = formatearTiempo(elapsed);
            
            // Actualizar timer en vista normal
            const displayNormal = document.getElementById('timer-etapa1');
            if (displayNormal) {
                displayNormal.textContent = tiempoFormateado;
            }
            
            // Actualizar timer en vista minimizada
            const displayMinimizado = document.getElementById('timer-etapa1-minimizado');
            if (displayMinimizado) {
                displayMinimizado.textContent = tiempoFormateado;
            }
        }
    }, 1000);
}

window.carroListoParaProducirMedicion = async function() {
    try {
        log('Finalizando Etapa 1 e iniciando Etapa 2...');
        
        // Ocultar botones inmediatamente en todas las vistas
        sincronizarBotonesCarroListo(false);
        
        // Detener timer de Etapa 1
        const timer = estadoModal.timers.etapa1;
        if (timer.interval) {
            clearInterval(timer.interval);
            timer.interval = null;
        }
        
        // Calcular tiempo total incluyendo pausas
        timer.elapsed = estadoModal.etapa1TiempoAcumulado + (Date.now() - timer.start);
        
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
        
        // ✅ MANTENER CONCATENACIÓN: Marcar carro como preparado sin actualizar botones del workspace
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;
        
        if (colaborador && colaborador.id) {
            log('Marcando carro como preparado en backend...');
            const response3 = await fetch(`/api/produccion/carro/${estadoModal.carroId}/preparado`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuarioId: colaborador.id })
            });
            
            if (!response3.ok) {
                log('Advertencia: No se pudo marcar el carro como preparado', 'error');
            } else {
                log('Carro marcado como preparado exitosamente', 'success');
                
                // ✅ Actualizar estado del carro en la interfaz si existe la función
                if (window.actualizarEstadoCarro) {
                    await window.actualizarEstadoCarro();
                }
            }
        }
        
        estadoModal.etapaActual = 2;
        
        // Restaurar modal si está minimizado
        if (estadoModal.modalMinimizado) {
            restaurarModal();
        }
        
        await actualizarUIModal();
        
        log('Transición E1→E2 completada correctamente', 'success');
        
    } catch (error) {
        log(`Error en transición E1→E2: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
        
        // Restaurar botones en caso de error
        sincronizarBotonesCarroListo(true);
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
    
    // ✅ CORRECCIÓN: Solo sumar artículos finalizados (no incluir artículos en curso)
    estadoModal.timers.articulos.forEach((timer, key) => {
        if (estadoModal.articulosMedidos.has(key)) {
            totalMs += timer.elapsed;
        }
        // Se eliminó el else if que sumaba artículos en curso
    });
    
    const display = document.getElementById('timer-total-etapa2');
    if (display) {
        // ✅ USAR FORMATO HH:MM:SS PARA ETAPA 2
        display.textContent = formatearTiempoCompleto(totalMs);
    }
    
    // Ya no es necesario actualizar cada segundo porque solo mostramos finalizados
    // El total solo cambia cuando se finaliza un artículo
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

    const el = document.getElementById('timer-etapa3');
    if (el) { el.classList.add('corriendo'); el.classList.remove('finalizado'); }
    
    const display = document.getElementById('timer-etapa3'); 
    if (display) display.textContent = '⏱ 00:00';

    // ✅ VALIDAR que timer.start existe antes de iniciar el interval
    if (!timer.start) {
        log('Error: timer.start no está definido en Etapa 3', 'error');
        return;
    }

    timer.interval = setInterval(() => {
        const elapsed = Date.now() - timer.start;
        const displayElement = document.getElementById('timer-etapa3');
        if (displayElement) {
            displayElement.textContent = formatearTiempo(elapsed);
        }
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
        
        const el = document.getElementById('timer-etapa3');
        if (el) { el.classList.remove('corriendo'); el.classList.add('finalizado'); }

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

// ==========================================
// RESUMEN COMPLETO (ETAPA 4)
// ==========================================

async function mostrarResumenCompleto() {
    const resumen = document.getElementById('resumen-completo-medicion');
    if (!resumen) {
        log('No se encontró el elemento de resumen completo', 'error');
        return;
    }
    
    resumen.style.display = 'block';
    
    // Calcular tiempos (con optional chaining para mayor robustez)
    const tiempoEtapa1 = parseInt(estadoModal.timers.etapa1?.elapsed) || 0;
    const tiempoEtapa2 = parseInt(estadoModal.timers.etapa2?.elapsed) || 0;
    const tiempoEtapa3 = parseInt(estadoModal.timers.etapa3?.elapsed) || 0;
    const tiempoTotal = tiempoEtapa1 + tiempoEtapa2 + tiempoEtapa3;
    
    // Log para debugging
    log(`Tiempos cargados - E1: ${tiempoEtapa1}ms, E2: ${tiempoEtapa2}ms, E3: ${tiempoEtapa3}ms, Total: ${tiempoTotal}ms`);
    
    // Actualizar tiempos de etapas
    document.getElementById('resumen-etapa1').textContent = formatearTiempo(tiempoEtapa1);
    // ✅ USAR FORMATO HH:MM:SS PARA ETAPA 2 EN RESUMEN
    document.getElementById('resumen-etapa2').textContent = formatearTiempoCompleto(tiempoEtapa2);
    document.getElementById('resumen-etapa3').textContent = formatearTiempo(tiempoEtapa3);
    document.getElementById('resumen-total').textContent = formatearTiempoCompleto(tiempoTotal);
    
    // Cargar detalles de artículos de Etapa 2
    await cargarDetallesArticulosResumen();
    
    log('Resumen completo mostrado correctamente', 'success');
}

async function cargarDetallesArticulosResumen() {
    try {
        const response = await fetch(
            `http://localhost:3002/api/produccion/carro/${estadoModal.carroId}/articulos?usuarioId=${estadoModal.usuarioId}`
        );
        
        if (!response.ok) {
            throw new Error('Error al cargar artículos para resumen');
        }
        
        const articulos = await response.json();
        const container = document.getElementById('resumen-articulos-detalle');
        
        if (!container) return;
        
        container.innerHTML = '';
        
        // Filtrar solo artículos medidos
        const articulosMedidos = articulos.filter(art => 
            estadoModal.articulosMedidos.has(art.numero)
        );
        
        if (articulosMedidos.length === 0) {
            container.innerHTML = '<p class="no-data">No hay artículos medidos</p>';
            return;
        }
        
        articulosMedidos.forEach(art => {
            const timer = estadoModal.timers.articulos.get(art.numero);
            const elapsed = timer ? timer.elapsed : 0;
            
            const articuloDiv = document.createElement('div');
            articuloDiv.className = 'resumen-articulo-item';
            articuloDiv.innerHTML = `
                <div class="resumen-articulo-info">
                    <span class="resumen-articulo-codigo">${art.numero}</span>
                    <span class="resumen-articulo-desc">${art.descripcion}</span>
                    <span class="resumen-articulo-cant">×${art.cantidad}</span>
                </div>
                <div class="resumen-articulo-tiempo">
                    <span class="tiempo-medido">⏱ ${formatearTiempo(elapsed)}</span>
                </div>
            `;
            container.appendChild(articuloDiv);
        });
        
        log(`${articulosMedidos.length} artículos cargados en resumen`);
        
    } catch (error) {
        log(`Error cargando detalles de artículos: ${error.message}`, 'error');
    }
}

// ==========================================
// FUNCIONES DE MINIMIZACIÓN Y RESTAURACIÓN
// ==========================================

function minimizarModal() {
    try {
        log('Minimizando modal...');
        
        const modalContent = document.querySelector('#modalMedicionInterna .modal-medicion-content');
        const vistaMinimizada = document.getElementById('modal-medicion-minimizado');
        
        if (!modalContent || !vistaMinimizada) {
            log('No se encontraron elementos para minimizar', 'error');
            return;
        }
        
        // Ocultar contenido del modal
        modalContent.style.display = 'none';
        
        // Mostrar vista minimizada
        vistaMinimizada.style.display = 'flex';
        
        // Actualizar estado
        estadoModal.modalMinimizado = true;
        
        // Actualizar botón de pausa/continuar
        actualizarBotonPausaContinuar();
        
        // Sincronizar visibilidad del botón "Carro listo" en vista minimizada
        const timer = estadoModal.timers.etapa1;
        const mostrarBoton = (timer.start && !timer.elapsed) || timer.elapsed > 0;
        sincronizarBotonesCarroListo(mostrarBoton);
        
        log('Modal minimizado correctamente', 'success');
        
    } catch (error) {
        log(`Error minimizando modal: ${error.message}`, 'error');
    }
}

function restaurarModal() {
    try {
        log('Restaurando modal...');
        
        const modalContent = document.querySelector('#modalMedicionInterna .modal-medicion-content');
        const vistaMinimizada = document.getElementById('modal-medicion-minimizado');
        
        if (!modalContent || !vistaMinimizada) {
            log('No se encontraron elementos para restaurar', 'error');
            return;
        }
        
        // Mostrar contenido del modal
        modalContent.style.display = 'block';
        
        // Ocultar vista minimizada
        vistaMinimizada.style.display = 'none';
        
        // Actualizar estado
        estadoModal.modalMinimizado = false;
        
        log('Modal restaurado correctamente', 'success');
        
    } catch (error) {
        log(`Error restaurando modal: ${error.message}`, 'error');
    }
}

// Hacer funciones disponibles globalmente
window.minimizarModal = minimizarModal;
window.restaurarModal = restaurarModal;

// ==========================================
// FUNCIONES DE PAUSA/CONTINUAR ETAPA 1
// ==========================================

function pausarEtapa1() {
    try {
        log('Pausando Etapa 1...');
        
        if (estadoModal.etapa1Pausada) {
            log('Etapa 1 ya está pausada', 'info');
            return;
        }
        
        const timer = estadoModal.timers.etapa1;
        
        // Acumular tiempo transcurrido
        estadoModal.etapa1TiempoAcumulado += (Date.now() - timer.start);
        
        // Marcar como pausada
        estadoModal.etapa1Pausada = true;
        
        // Actualizar botón
        actualizarBotonPausaContinuar();
        
        log('Etapa 1 pausada correctamente', 'success');
        
    } catch (error) {
        log(`Error pausando Etapa 1: ${error.message}`, 'error');
    }
}

function continuarEtapa1() {
    try {
        log('Continuando Etapa 1...');
        
        if (!estadoModal.etapa1Pausada) {
            log('Etapa 1 no está pausada', 'info');
            return;
        }
        
        const timer = estadoModal.timers.etapa1;
        
        // Reiniciar el punto de inicio
        timer.start = Date.now();
        
        // Desmarcar pausa
        estadoModal.etapa1Pausada = false;
        
        // Actualizar botón
        actualizarBotonPausaContinuar();
        
        log('Etapa 1 continuada correctamente', 'success');
        
    } catch (error) {
        log(`Error continuando Etapa 1: ${error.message}`, 'error');
    }
}

function actualizarBotonPausaContinuar() {
    // Actualizar botón en vista minimizada
    const btnPausaContinuarMin = document.getElementById('btn-pausa-continuar-etapa1-minimizado');
    
    if (btnPausaContinuarMin) {
        if (estadoModal.etapa1Pausada) {
            btnPausaContinuarMin.textContent = '▶️ Continuar';
            btnPausaContinuarMin.classList.remove('btn-warning');
            btnPausaContinuarMin.classList.add('btn-success');
        } else {
            btnPausaContinuarMin.textContent = '⏸️ Pausar';
            btnPausaContinuarMin.classList.remove('btn-success');
            btnPausaContinuarMin.classList.add('btn-warning');
        }
    }
}

window.togglePausaContinuarEtapa1 = function() {
    if (estadoModal.etapa1Pausada) {
        continuarEtapa1();
    } else {
        pausarEtapa1();
    }
};

// ==========================================
// SINCRONIZACIÓN DE BOTONES
// ==========================================

/**
 * Sincroniza la visibilidad del botón "Carro listo para producir" SOLO en el modal
 * NO toca el botón del workspace (#carro-preparado) que es controlado por carroPreparado.js
 * @param {boolean} mostrar - true para mostrar, false para ocultar
 */
function sincronizarBotonesCarroListo(mostrar) {
    try {
        // ✅ CRÍTICO: Solo sincronizar si el modal de medición está activo
        if (!estadoModal.carroId) {
            log('Modal de medición no activo, no se sincronizan botones', 'info');
            return;
        }
        
        // ✅ NO TOCAR el botón del workspace - es controlado por carroPreparado.js
        // const btnWorkspace = document.getElementById('carro-preparado'); // REMOVIDO
        
        // Botón en el modal normal
        const btnModalNormal = document.getElementById('btn-carro-listo-medicion');
        
        // Botón en la vista minimizada
        const btnMinimizado = document.getElementById('btn-carro-listo-minimizado');
        
        const displayValue = mostrar ? 'inline-block' : 'none';
        
        // Solo sincronizar botones del modal de medición
        if (btnModalNormal) {
            btnModalNormal.style.display = displayValue;
        }
        
        if (btnMinimizado) {
            btnMinimizado.style.display = displayValue;
        }
        
        log(`Botones del modal "Carro listo" sincronizados: ${mostrar ? 'VISIBLE' : 'OCULTO'}`, 'info');
        
    } catch (error) {
        log(`Error sincronizando botones: ${error.message}`, 'error');
    }
}

// Hacer función disponible globalmente
window.sincronizarBotonesCarroListo = sincronizarBotonesCarroListo;

// ==========================================
// ACTUALIZACIÓN DINÁMICA DE VISTA MINIMIZADA
// ==========================================

/**
 * Actualiza la vista minimizada según la etapa actual
 * Cambia título, timer, botones e instructivo dinámicamente
 */
function actualizarVistaMinimizada() {
    if (!estadoModal.modalMinimizado) return;
    
    const titulo = document.getElementById('minimizado-titulo-etapa');
    const timer = document.getElementById('timer-minimizado');
    const instructivo = document.getElementById('minimizado-instructivo-texto');
    const btnPausaContinuar = document.getElementById('btn-pausa-continuar-minimizado');
    const btnCarroListo = document.getElementById('btn-carro-listo-minimizado');
    const btnCompletarE2 = document.getElementById('btn-completar-etapa2-minimizado');
    const btnFinalizar = document.getElementById('btn-finalizar-minimizado');
    
    // Ocultar todos los botones de acción primero
    if (btnCarroListo) btnCarroListo.style.display = 'none';
    if (btnCompletarE2) btnCompletarE2.style.display = 'none';
    if (btnFinalizar) btnFinalizar.style.display = 'none';
    if (btnPausaContinuar) btnPausaContinuar.style.display = 'none';
    
    switch (estadoModal.etapaActual) {
        case 1:
            if (titulo) titulo.textContent = '⏱️ Etapa 1: Preparación';
            if (instructivo) instructivo.textContent = '💡 Preparar ingredientes y materiales necesarios';
            
            // Actualizar timer
            if (timer) {
                const elapsed = estadoModal.etapa1TiempoAcumulado + (Date.now() - estadoModal.timers.etapa1.start);
                timer.textContent = formatearTiempo(elapsed);
                timer.classList.add('corriendo');
                timer.classList.remove('finalizado');
            }
            
            // Mostrar botón pausa/continuar y carro listo
            if (btnPausaContinuar) btnPausaContinuar.style.display = 'inline-block';
            if (btnCarroListo) btnCarroListo.style.display = 'inline-block';
            
            // Iniciar actualización del timer
            iniciarActualizacionTimerMinimizado();
            break;
            
        case 2:
            if (titulo) titulo.textContent = '📦 Etapa 2: Medición por Artículo';
            if (instructivo) instructivo.textContent = '💡 Medir cada artículo individualmente';
            
            // Mostrar total de E2
            if (timer) {
                let totalMs = 0;
                estadoModal.timers.articulos.forEach((t, key) => {
                    if (estadoModal.articulosMedidos.has(key)) {
                        totalMs += t.elapsed;
                    }
                });
                timer.textContent = formatearTiempo(totalMs);
                timer.classList.remove('corriendo', 'finalizado');
            }
            
            // Mostrar botón completar E2 si todos los artículos están medidos
            const todosMedidos = estadoModal.articulosMedidos.size === estadoModal.totalArticulos;
            if (btnCompletarE2 && todosMedidos) {
                btnCompletarE2.style.display = 'inline-block';
            }
            break;
            
        case 3:
            if (titulo) titulo.textContent = '✅ Etapa 3: Finalización';
            if (instructivo) instructivo.textContent = '💡 Completar y cerrar la producción';
            
            // Actualizar timer
            if (timer && estadoModal.timers.etapa3.start) {
                const elapsed = estadoModal.etapa3TiempoAcumulado + (Date.now() - estadoModal.timers.etapa3.start);
                timer.textContent = formatearTiempo(elapsed);
                timer.classList.add('corriendo');
                timer.classList.remove('finalizado');
            }
            
            // Mostrar botón pausa/continuar y finalizar
            if (btnPausaContinuar) btnPausaContinuar.style.display = 'inline-block';
            if (btnFinalizar) btnFinalizar.style.display = 'inline-block';
            
            // Iniciar actualización del timer
            iniciarActualizacionTimerMinimizado();
            break;
    }
    
    log(`Vista minimizada actualizada para Etapa ${estadoModal.etapaActual}`, 'info');
}

// Variable para el interval del timer minimizado
let intervalTimerMinimizado = null;

/**
 * Inicia la actualización automática del timer en vista minimizada
 */
function iniciarActualizacionTimerMinimizado() {
    // Limpiar interval anterior si existe
    if (intervalTimerMinimizado) {
        clearInterval(intervalTimerMinimizado);
    }
    
    const timer = document.getElementById('timer-minimizado');
    if (!timer) return;
    
    intervalTimerMinimizado = setInterval(() => {
        if (!estadoModal.modalMinimizado) {
            clearInterval(intervalTimerMinimizado);
            return;
        }
        
        let elapsed = 0;
        
        if (estadoModal.etapaActual === 1 && !estadoModal.etapa1Pausada) {
            elapsed = estadoModal.etapa1TiempoAcumulado + (Date.now() - estadoModal.timers.etapa1.start);
        } else if (estadoModal.etapaActual === 3 && !estadoModal.etapa3Pausada) {
            elapsed = estadoModal.etapa3TiempoAcumulado + (Date.now() - estadoModal.timers.etapa3.start);
        } else {
            return; // No actualizar si está pausado o no es E1/E3
        }
        
        timer.textContent = formatearTiempo(elapsed);
    }, 1000);
}

// ==========================================
// PAUSA/CONTINUAR PARA ETAPA 3
// ==========================================

// Variables de estado para Etapa 3 (reutilizando patrón de E1)
let etapa3Pausada = false;
let etapa3TiempoAcumulado = 0;

// Agregar al estado global
estadoModal.etapa3Pausada = false;
estadoModal.etapa3TiempoAcumulado = 0;

function pausarEtapa3() {
    try {
        log('Pausando Etapa 3...');
        
        if (estadoModal.etapa3Pausada) {
            log('Etapa 3 ya está pausada', 'info');
            return;
        }
        
        const timer = estadoModal.timers.etapa3;
        
        // Acumular tiempo transcurrido
        estadoModal.etapa3TiempoAcumulado += (Date.now() - timer.start);
        
        // Marcar como pausada
        estadoModal.etapa3Pausada = true;
        
        // Actualizar botón
        actualizarBotonPausaContinuarGenerico();
        
        log('Etapa 3 pausada correctamente', 'success');
        
    } catch (error) {
        log(`Error pausando Etapa 3: ${error.message}`, 'error');
    }
}

function continuarEtapa3() {
    try {
        log('Continuando Etapa 3...');
        
        if (!estadoModal.etapa3Pausada) {
            log('Etapa 3 no está pausada', 'info');
            return;
        }
        
        const timer = estadoModal.timers.etapa3;
        
        // Reiniciar el punto de inicio
        timer.start = Date.now();
        
        // Desmarcar pausa
        estadoModal.etapa3Pausada = false;
        
        // Actualizar botón
        actualizarBotonPausaContinuarGenerico();
        
        log('Etapa 3 continuada correctamente', 'success');
        
    } catch (error) {
        log(`Error continuando Etapa 3: ${error.message}`, 'error');
    }
}

function actualizarBotonPausaContinuarGenerico() {
    const btnPausaContinuar = document.getElementById('btn-pausa-continuar-minimizado');
    
    if (!btnPausaContinuar) return;
    
    const estaPausada = estadoModal.etapaActual === 1 ? estadoModal.etapa1Pausada : estadoModal.etapa3Pausada;
    
    if (estaPausada) {
        btnPausaContinuar.textContent = '▶️ Continuar';
        btnPausaContinuar.classList.remove('btn-warning');
        btnPausaContinuar.classList.add('btn-success');
    } else {
        btnPausaContinuar.textContent = '⏸️ Pausar';
        btnPausaContinuar.classList.remove('btn-success');
        btnPausaContinuar.classList.add('btn-warning');
    }
}

window.togglePausaContinuarGenerico = function() {
    if (estadoModal.etapaActual === 1) {
        if (estadoModal.etapa1Pausada) {
            continuarEtapa1();
        } else {
            pausarEtapa1();
        }
    } else if (estadoModal.etapaActual === 3) {
        if (estadoModal.etapa3Pausada) {
            continuarEtapa3();
        } else {
            pausarEtapa3();
        }
    }
};

// ==========================================
// ACTUALIZAR FUNCIONES EXISTENTES
// ==========================================

// Actualizar minimizarModal para usar la nueva función
const minimizarModalOriginal = minimizarModal;
window.minimizarModal = minimizarModal = function() {
    minimizarModalOriginal();
    actualizarVistaMinimizada();
};

// Actualizar transiciones de etapa para actualizar vista minimizada
const carroListoOriginal = window.carroListoParaProducirMedicion;
window.carroListoParaProducirMedicion = async function() {
    await carroListoOriginal();
    if (estadoModal.modalMinimizado) {
        actualizarVistaMinimizada();
    }
};

const completarE2Original = window.completarEtapa2Medicion;
window.completarEtapa2Medicion = async function() {
    await completarE2Original();
    if (estadoModal.modalMinimizado) {
        actualizarVistaMinimizada();
    }
};

// Log de inicialización
log('Módulo de medición interna inicializado correctamente', 'success');
