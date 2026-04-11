/**
 * Verifición Continua ("Manos Libres") - Módulo de Producción
 * Máquina de estados gobernada por emulación de escáner de códigos de barras.
 */

// ==========================================
// 1. VARIABLE DE ESTADO GLOBAL Y DEFINICIONES
// ==========================================

const ESTADOS_VC = {
    ESPERANDO_PEDIDO: 'ESPERANDO_PEDIDO',
    ESPERANDO_ARTICULOS: 'ESPERANDO_ARTICULOS'
};

// Códigos de hardware (comandos del sistema)
const SYSTEM_COMMANDS = {
    EXIT: 'CMD-OFF',
    ENTER: 'CMD-ON'
};

const vc_estado_actual = {
    estado: ESTADOS_VC.ESPERANDO_PEDIDO, // Estado inicial
    cliente_id: null,
    cliente_nombre: '',
    presupuesto_id_local: null,
    presupuesto_id_ext: null,
    articulos: [],
    errores: {}, // Contenedor persistente de fallos
    // Contadores
    total_pedidos: 0,
    total_escaneados: 0
};

// ==========================================
// 2. SISTEMA DE AUDIO NATIVO (Beeps sin librerías externas)
// ==========================================

let vc_audioCtx = null;

function initAudioSystem() {
    if (!vc_audioCtx) {
        vc_audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (vc_audioCtx.state === 'suspended') {
        vc_audioCtx.resume();
    }
}

function vc_playTone(frequency, type, duration, vol = 0.5) {
    try {
        initAudioSystem();
        const oscillator = vc_audioCtx.createOscillator();
        const gainNode = vc_audioCtx.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, vc_audioCtx.currentTime);

        gainNode.gain.setValueAtTime(vol, vc_audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, vc_audioCtx.currentTime + duration);

        oscillator.connect(gainNode);
        gainNode.connect(vc_audioCtx.destination);

        oscillator.start();
        oscillator.stop(vc_audioCtx.currentTime + duration);
    } catch (e) {
        console.warn("AudioContext bloqueado o no soportado:", e);
    }
}

function vc_beepSuccess() {
    vc_playTone(850, 'sine', 0.2);
}

function vc_beepError() {
    // Sonido más grave y áspero para alerta
    vc_playTone(150, 'sawtooth', 0.4);
    setTimeout(() => vc_playTone(150, 'sawtooth', 0.4), 150);
}

function vc_beepVictory() {
    // Fanfarria simple
    vc_playTone(440, 'sine', 0.1);
    setTimeout(() => vc_playTone(554, 'sine', 0.1), 100);
    setTimeout(() => vc_playTone(659, 'sine', 0.1), 200);
    setTimeout(() => vc_playTone(880, 'sine', 0.3), 300);
}


// ==========================================
// 3. INICIALIZACIÓN Y EVENTOS DE DOM
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    const btnIniciar = document.getElementById('btn-iniciar-verificacion-continua');
    if (btnIniciar) {
        btnIniciar.addEventListener('click', vc_abrirModal);
    }

    const modalInput = document.getElementById('vc-scanner-input');
    if (modalInput) {
        // Interceptar tecla Enter del lector de código de barras
        modalInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                
                const rawInput = modalInput.value;
                
                // Sanitización estricta requerida por QA
                // Limpia apóstrofes del Mismatch de Layout y todo caracter de control/espacio (incluyendo el \r\n)
                let codigoSanitizado = rawInput.replace(/'/g, '-');
                codigoSanitizado = codigoSanitizado.replace(/[\s\r\n]+/g, '');
                codigoSanitizado = codigoSanitizado.trim();
                
                // Parseo (simulado para el log, la máquina luego lo procesa dependiend si es presupuesto o articulo)
                let codigoParseado = codigoSanitizado.split('-')[0];

                console.log(`[VIGÍA] 1. RAW INPUT: [${rawInput}]`);
                console.log(`[VIGÍA] 2. SANITIZADO: [${codigoSanitizado}]`);
                console.log(`[VIGÍA] 3. PARSEADO: [${codigoParseado}]`);
                
                if (codigoSanitizado) {
                    vc_procesarEscaneo(codigoSanitizado);
                }
                modalInput.value = ''; // Limpiar input SIEMPRE
            }
        });

        // Focus Management: Forzar retención del foco, para operación "Manos Libres"
        modalInput.addEventListener('blur', () => {
            const modal = document.getElementById('modal-verificacion-continua');
            if (modal && modal.style.display !== 'none') {
                setTimeout(() => {
                    modalInput.focus();
                }, 10);
            }
        });
    }
});

// ==========================================
// 3.B. LISTENER GLOBAL DE HARDWARE (ON COMMAND)
// ==========================================
let vc_globalScannerBuffer = '';
let vc_globalScannerTimer = null;

document.addEventListener('keydown', (e) => {
    const modalVC = document.getElementById('modal-verificacion-continua');
    const isModalOpen = modalVC && modalVC.style.display !== 'none';
    
    // Si el modal está abierto, su propio input maneja el escáner
    if (isModalOpen) return;

    if (e.key === 'Enter') {
        console.log("[VC-GLOBAL] Escáner disparó Enter. Buffer actual:", JSON.stringify(vc_globalScannerBuffer));
        
        // Limpiamos saltos reales y también caracteres de puntuación conflictivos por teclados desconfigurados
        const cleanBuffer = vc_globalScannerBuffer.toUpperCase().trim().replace(/['\-_\n\r\s]/g, '');
        const targetEnter = SYSTEM_COMMANDS.ENTER.replace(/[-]/g, ''); // "CMDON"
        
        if (cleanBuffer.includes(targetEnter)) {
            e.preventDefault();
            e.stopPropagation(); // Aniquilar event bubbling
            
            // Destrucción Forzada del Foco (Blur)
            if (document.activeElement) {
                document.activeElement.blur();
            }
            
            console.log(`[VC] COMANDO HARDWARE GLOBAL DETECTADO: INICIAR (${SYSTEM_COMMANDS.ENTER})`);
            
            vc_abrirModal();
        }
        vc_globalScannerBuffer = '';
    } else if (e.key.length === 1) {
        // Solo acumular si el escáner escribe rápido y el flag activo (ej. en 50ms)
        vc_globalScannerBuffer += e.key;

        const partialClean = vc_globalScannerBuffer.toUpperCase().trim().replace(/['\-_\n\r\s]/g, '');
        const targetEnterPartial = SYSTEM_COMMANDS.ENTER.replace(/[-]/g, '');
        // Aniquilar el foco si empezamos a matar un comando global (Protege frente a enters fantasmas)
        if (partialClean && targetEnterPartial.startsWith(partialClean)) {
            if (document.activeElement) {
                document.activeElement.blur();
            }
        }

        clearTimeout(vc_globalScannerTimer);
        vc_globalScannerTimer = setTimeout(() => {
            // El usuario tecleó manual, limpiamos el buffer
            vc_globalScannerBuffer = '';
        }, 50);
    }
}, true); // <- Fase de Captura (Event Capturing) en lugar de Bubbling

// ==========================================
// 4. LÓGICA DE TRANSICIÓN DE UI
// ==========================================

function vc_abrirModal() {
    // Inicializar Motor de Audio ante primer interacción real de usuario (para saltear políticas de autoplay del navegador)
    initAudioSystem();
    
    const modal = document.getElementById('modal-verificacion-continua');
    if (modal) {
        modal.style.display = 'flex';
    }
    
    vc_resetearMaquinaDeEstados();
}

window.cerrarVerificacionContinua = function() {
    const modal = document.getElementById('modal-verificacion-continua');
    if (modal) {
        modal.style.display = 'none';
    }
    // Liberar estado visual y memoria
    vc_resetearMaquinaDeEstados();
};

window.vc_forzarCancelacion = window.cerrarVerificacionContinua;


function vc_actualizarUI_PorEstado() {
    const headerDiv = document.getElementById('vc-modal-header');
    const headerIcon = document.getElementById('vc-header-icon');
    const estadoTexto = document.getElementById('vc-estado-texto');
    const scannerBox = document.getElementById('vc-scanner-box');
    const scannerLabel = document.getElementById('vc-scanner-label');
    const scannerInput = document.getElementById('vc-scanner-input');
    
    const infoPedidoContainer = document.getElementById('vc-info-pedido');
    const progresoSection = document.getElementById('vc-progress-section');
    const tablaContainer = document.getElementById('vc-articulos-container');

    if (vc_estado_actual.estado === ESTADOS_VC.ESPERANDO_PEDIDO) {
        // Estilos ESPERANDO PEDIDO (Gris, neutro)
        headerDiv.style.backgroundColor = '#6c757d'; // Secondary
        headerIcon.textContent = '📄';
        estadoTexto.textContent = 'ESPERANDO HOJA DE PEDIDO';
        scannerBox.style.borderColor = '#6c757d';
        scannerBox.style.backgroundColor = '#f8f9fa';
        scannerLabel.textContent = 'Escanear Hoja de Pedido (ID de Presupuesto):';
        scannerLabel.style.color = '#6c757d';
        scannerInput.placeholder = 'Escanee el presupuesto...';

        // Ocultar zonas inactivas
        infoPedidoContainer.style.display = 'none';
        progresoSection.style.display = 'none';
        tablaContainer.style.display = 'none';
        
        vc_limpiarFeedback();
        
    } else if (vc_estado_actual.estado === ESTADOS_VC.ESPERANDO_ARTICULOS) {
        // Estilos ESPERANDO ARTICULOS (Azul/Verde, activo)
        headerDiv.style.backgroundColor = '#007bff'; // Primary
        headerIcon.textContent = '📦';
        estadoTexto.textContent = 'ESPERANDO ARTÍCULOS';
        scannerBox.style.borderColor = '#007bff';
        scannerBox.style.backgroundColor = '#e9f2ff';
        scannerBox.style.padding = '10px'; // UI Compactada
        scannerInput.style.padding = '10px'; // UI Compactada
        scannerInput.style.fontSize = '18px'; // UI Compactada
        scannerLabel.textContent = 'Escanear Código de Barras de Artículo:';
        scannerLabel.style.color = '#0056b3';
        scannerInput.placeholder = 'Escanee los artículos del pedido...';

        // Mostrar zonas activas y mapear info cliente
        document.getElementById('vc-cliente-nombre').textContent = vc_estado_actual.cliente_nombre;
        document.getElementById('vc-presupuesto-id-local').textContent = vc_estado_actual.presupuesto_id_local;
        document.getElementById('vc-presupuesto-id-ext').textContent = vc_estado_actual.presupuesto_id_ext || 'N/A';
        
        infoPedidoContainer.style.display = 'flex';
        infoPedidoContainer.style.padding = '10px 15px'; // UI Compactada
        infoPedidoContainer.style.marginTop = '10px'; // UI Compactada
        
        progresoSection.style.display = 'block';
        progresoSection.style.marginTop = '10px'; // UI Compactada
        
        tablaContainer.style.display = 'block';
        tablaContainer.style.marginTop = '10px'; // UI Compactada
        
        vc_renderizarTablaArticulos();
        vc_actualizarBarraDeProgreso();
        vc_limpiarFeedback();
    }
    
    // Forzar foco en transición
    setTimeout(() => scannerInput.focus(), 50);
}

function vc_mostrarFeedback(mensaje, tipo) {
    const feedbackEl = document.getElementById('vc-scanner-feedback');
    const headerDiv = document.getElementById('vc-modal-header');
    
    feedbackEl.textContent = mensaje;
    feedbackEl.style.display = 'block';
    
    if (tipo === 'error') {
        feedbackEl.style.color = '#721c24';
        feedbackEl.style.backgroundColor = '#f8d7da';
        feedbackEl.style.border = '2px solid #f5c6cb';
        feedbackEl.style.padding = '10px';
        feedbackEl.style.borderRadius = '5px';
        
        // Flash rojo en el header visual
        const colorOriginal = headerDiv.style.backgroundColor;
        headerDiv.style.backgroundColor = '#dc3545';
        setTimeout(() => {
            headerDiv.style.backgroundColor = colorOriginal;
        }, 300);
        
    } else if (tipo === 'success') {
        feedbackEl.style.color = '#155724';
        feedbackEl.style.backgroundColor = '#d4edda';
        feedbackEl.style.border = '2px solid #c3e6cb';
        feedbackEl.style.padding = '10px';
        feedbackEl.style.borderRadius = '5px';
    } else if (tipo === 'victory') {
         feedbackEl.style.color = '#fff';
         feedbackEl.style.backgroundColor = '#28a745';
         feedbackEl.style.border = '2px solid #28a745';
         feedbackEl.style.padding = '15px';
         feedbackEl.style.fontSize = '1.5em';
         feedbackEl.style.fontWeight = 'bold';
         feedbackEl.style.borderRadius = '5px';
    }
}

function vc_limpiarFeedback() {
    const feedbackEl = document.getElementById('vc-scanner-feedback');
    feedbackEl.textContent = '';
    feedbackEl.style.display = 'none';
    feedbackEl.style.border = 'none';
}


// ==========================================
// 5. MÁQUINA DE ESTADOS (Core Business Logic)
// ==========================================

function vc_resetearMaquinaDeEstados() {
     vc_estado_actual.estado = ESTADOS_VC.ESPERANDO_PEDIDO;
     vc_estado_actual.cliente_id = null;
     vc_estado_actual.cliente_nombre = '';
     vc_estado_actual.presupuesto_id_local = null;
     vc_estado_actual.presupuesto_id_ext = null;
     vc_estado_actual.articulos = [];
     vc_estado_actual.total_pedidos = 0;
     vc_estado_actual.total_escaneados = 0;
     
     vc_actualizarUI_PorEstado();
}

function vc_procesarEscaneo(codigo) {
    // === GUARDA LÓGICA DE HARDWARE ===
    if (codigo.toUpperCase() === SYSTEM_COMMANDS.EXIT) {
        console.warn(`[VC] COMANDO HARDWARE DETECTADO: SALIR (${SYSTEM_COMMANDS.EXIT})`);
        // Opcional: vc_beepVictory() o algún feedback audible?
        if (typeof vc_beepSuccess === 'function') vc_beepSuccess(); // Usar beep de exito para salida limpia
        window.cerrarVerificacionContinua();
        return;
    }

    if (vc_estado_actual.estado === ESTADOS_VC.ESPERANDO_PEDIDO) {
        vc_buscarYActivarPedido(codigo);
    } else if (vc_estado_actual.estado === ESTADOS_VC.ESPERANDO_ARTICULOS) {
        vc_procesarArticuloFisico(codigo);
    }
}

function vc_buscarYActivarPedido(codigo_escaneado) {
    console.log(`[VC] Buscando pedido: ${codigo_escaneado}`);
    
    // Buscar el presupuesto en los datos globales parseados por la vista normal (window.clientesPedidos)
    if (!window.clientesPedidos || window.clientesPedidos.length === 0) {
        vc_beepError();
        vc_mostrarFeedback("ERROR CRÍTICO: No hay datos de pedidos cargados de fondo.", "error");
        return;
    }

    let encontrado = false;
    let presupuestoSeleccionado = null;
    let clienteAsociado = null;
    
    // Normalizar entrada de escáner a String seguro
    let term = codigo_escaneado.toString().trim().toLowerCase();

    // Paso 2 (Parseo / Recorte): Extraer la porción base
    let termObj = term.split('-')[0];
    
    // Purga brutal: Todo lo que no sea [0-9, a-z] se destruye. Zero-width chars, BOMs, tabs, etc.
    const termLimpio = termObj.replace(/[^\w]/g, '');

    console.log(`[VIGÍA SEARCH] Term Original: "${term}" -> Term Limpio (Buscando esto en memoria): "${termLimpio}"`);

    // Loop profundo: buscar entre todos los clientes
    for (const cliente of window.clientesPedidos) {
        for (const art of cliente.articulos) {
            const secuencia = (art.secuencia || 'Imprimir').trim();
            if (secuencia === 'Armar_Pedido') {
                // BUGFIX: No usar `||` para short-circuit porque `presupuesto_id` (UUID) oculta el `id_presupuesto_local` (Numérico).
                const posiblesIDs = [
                    art.presupuesto_id,
                    art.id_presupuesto_local,
                    art.presupuesto_ext,
                    art.id_presupuesto_ext
                ].filter(Boolean).map(id => id.toString().toLowerCase().replace(/[^\w-]/g, ''));
                
                // Si encontramos a la víctima en cualquiera de sus posibles IDs
                if (posiblesIDs.includes(termLimpio)) {
                    encontrado = true;
                    presupuestoSeleccionado = art.presupuesto_id; // id base para agrupar internamente
                    clienteAsociado = cliente;
                    console.log(`✅ [VIGÍA SEARCH] MATCH PERFECTO! Pedido en memoria: UUID/Local/Ext(${posiblesIDs.join(' | ')}) concuerda con ${termLimpio}`);
                    break;
                }
            }
        }
        if (encontrado) break;
    }

    if (!encontrado) {
        vc_beepError();
        vc_mostrarFeedback(`ERROR: Pedido "${codigo_escaneado}" NO encontrado o no está en estado "Armar Pedido".`, "error");
        return;
    }

    // Pedido encontrado -> Cargar todos los artículos de dicho presupuesto y armar snapshot de estado
    console.log(`[VC] Pedido ${presupuestoSeleccionado} encontrado. Procesando cliente ${clienteAsociado.cliente_nombre}`);
    
    const articulosAProcesar = clienteAsociado.articulos.filter(a => a.presupuesto_id === presupuestoSeleccionado);
    
    // Inicializar contadores del pedido
    vc_estado_actual.cliente_id = clienteAsociado.cliente_id;
    vc_estado_actual.cliente_nombre = clienteAsociado.cliente_nombre;
    vc_estado_actual.presupuesto_id_local = presupuestoSeleccionado;
    vc_estado_actual.presupuesto_id_ext = articulosAProcesar[0].presupuesto_ext || articulosAProcesar[0].id_presupuesto_ext || '';
    
    let subtotalLineasPedidas = 0;
    
    vc_estado_actual.articulos = articulosAProcesar.map(art => {
        const pedida = art.pedido_total || art.cantidad || 0;
        subtotalLineasPedidas += pedida;
        return {
            codigo_principal: art.articulo_numero || art.codigo,
            codigo_barras: (art.codigo_barras || '').toString().trim(),
            descripcion: art.descripcion,
            pedido_total: pedida,
            cantidad_escaneada: 0,
            completado: false
        };
    });
    
    vc_estado_actual.total_pedidos = subtotalLineasPedidas;
    vc_estado_actual.total_escaneados = 0;
    vc_estado_actual.errores = {}; // Reset de matriz de errores
    window.rejectedScans = []; // Reset Inmutable
    vc_renderizarErrores(); // Purga visual del modal
    
    vc_beepSuccess();
    
    // Avanzar de fase
    vc_estado_actual.estado = ESTADOS_VC.ESPERANDO_ARTICULOS;
    vc_actualizarUI_PorEstado();
}


function vc_procesarArticuloFisico(codigo_escaneado) {
    const term = codigo_escaneado.toString().trim().toLowerCase();
    console.log(`[VC] Evaluando código artículo: ${term}`);

    // UI Compacta: Limpieza instantánea para escanear a máxima velocidad
    const scannerInput = document.getElementById('vc-scanner-input');
    if (scannerInput) scannerInput.value = '';

    // Buscar el artículo en el presupuesto cargado
    // Soporta esaneo nativo por código del sistema o por código de barras.
    let itemAsociado = null;
    let indexEnArray = -1;

    for (let i = 0; i < vc_estado_actual.articulos.length; i++) {
        const art = vc_estado_actual.articulos[i];
        if (
            (art.codigo_principal && art.codigo_principal.toString().toLowerCase() === term) ||
            (art.codigo_barras && art.codigo_barras.toLowerCase() === term)
        ) {
            itemAsociado = art;
            indexEnArray = i;
            break;
        }
    }

    if (!itemAsociado) {
        // EXCEPCIÓN 2: ARTÍCULO FORÁNEO
        vc_beepError();
        
        // Bloqueo Optimista: Registrar Foráneo Inmediato
        vc_registrarError(term, 'Buscando descripción...', false, false);
        
        // Fetch background: Hidratar descripción real buscando en el stock general
        fetch(`/api/produccion/articulos?codigo_barras=${encodeURIComponent(term)}`)
            .then(res => res.json())
            .then(data => {
                let nombreReal = 'Artículo Desconocido';
                if (data && data.success && data.data && data.data.length > 0) {
                    nombreReal = data.data[0].descripcion || data.data[0].nombre;
                }
                const descripcionVisual = `${nombreReal} - Foráneo`;
                // isUpdateInfo = true, actualiza descripción sin subir el contador
                vc_registrarError(term, descripcionVisual, false, true); 
            })
            .catch(() => {
                vc_registrarError(term, 'Artículo Desconocido / Foráneo', false, true);
            });

        vc_mostrarFeedback(`ERROR LECTURA: El código "${codigo_escaneado}" NO pertenece a este pedido.`, "error");
        return;
    }

    // EXCEPCIÓN 1: OVERSCANNING
    if (itemAsociado.cantidad_escaneada >= itemAsociado.pedido_total) {
        vc_beepError();
        vc_registrarError(itemAsociado.codigo_principal || term, itemAsociado.descripcion, true, false);
        vc_mostrarFeedback(`EXCESO (Overscan): El artículo "${itemAsociado.descripcion}" ya está completo (${itemAsociado.pedido_total}/${itemAsociado.pedido_total}).`, "error");
        return;
    }

    // FLUJO FELIZ: Incremento de unidad
    itemAsociado.cantidad_escaneada += 1;
    vc_estado_actual.total_escaneados += 1;
    
    if (itemAsociado.cantidad_escaneada === itemAsociado.pedido_total) {
        itemAsociado.completado = true;
    }

    vc_beepSuccess();
    vc_mostrarFeedback(`✅ +1 ${itemAsociado.descripcion} (${itemAsociado.cantidad_escaneada}/${itemAsociado.pedido_total})`, "success");
    
    // Re-render UI
    vc_actualizarFilaArticulo(indexEnArray);
    vc_actualizarBarraDeProgreso();
    
    // Comprobación de final de pedido
    if (vc_estado_actual.total_escaneados === vc_estado_actual.total_pedidos) {
        vc_cerrarPedidoAutomáticamente();
    }
}


// === ESTADO INMUTABLE GLOBAL (Auditoría QA) ===
window.rejectedScans = window.rejectedScans || [];

function vc_registrarError(codigo, descripcion, isOverscan = false, isUpdateInfo = false) {
    // Mutación Inmutable solicitada por QA
    const prevScans = [...window.rejectedScans];
    const index = prevScans.findIndex(s => s.codigo === codigo);
    
    if (index >= 0) {
        // Actualizar datos sin acumular conteo si solo es hidratación de texto (isUpdateInfo)
        const nuevaCantidad = isUpdateInfo ? prevScans[index].cantidad : prevScans[index].cantidad + 1;
        const nuevaDesc = isUpdateInfo ? descripcion : prevScans[index].descripcion;
        prevScans[index] = { ...prevScans[index], cantidad: nuevaCantidad, descripcion: nuevaDesc };
        window.rejectedScans = prevScans;
    } else {
        window.rejectedScans = [...prevScans, { codigo: codigo, descripcion: descripcion, cantidad: 1, overscan: isOverscan }];
    }
    
    vc_renderizarErrores();
}

function vc_renderizarErrores() {
    // 1. Desbloqueo de Colapso CSS (Flexbox / Overflow)
    // El modal body original tenía {overflow: hidden; flex: 1} lo que en pantallas chicas colapsaba
    // el espacio sobrante a 0px de altura, ocultando toda la tabla dinámicamente.
    const modalBody = document.querySelector('#modal-verificacion-continua .modal-body');
    if (modalBody) {
        modalBody.style.overflowY = 'auto'; // Habilitar scroll del modal en laptop/monitores chicos
        modalBody.style.padding = '10px 15px'; // QA Fallo 1: Padding mas chico
    }
    
    const tablaArticulos = document.getElementById('vc-articulos-container');
    if (tablaArticulos) {
        tablaArticulos.style.minHeight = '100px'; 
        tablaArticulos.style.maxHeight = '28vh'; // QA Fallo 1: Bloquear expansión infinita, delegar en scroll interno
        tablaArticulos.style.overflowY = 'auto'; // Habilitar scroll interno de tabla principal
    }

    // 2. Extender contenedor seguro en DOM
    let container = document.getElementById('vc-errores-container-force');
    if (!container) {
        container = document.createElement('div');
        container.id = 'vc-errores-container-force';
        container.style.marginTop = '15px';
        container.style.border = '3px solid #dc3545';
        container.style.borderRadius = '8px';
        container.style.backgroundColor = '#fff8f8';
        container.style.padding = '10px';
        container.style.marginBottom = '15px';
        container.style.flexShrink = '0';
        
        // Lo insertamos encima de la tabla principal para que los errores nunca se pierdan de vista
        if (tablaArticulos && tablaArticulos.parentNode) {
            tablaArticulos.parentNode.insertBefore(container, tablaArticulos);
        } else if (modalBody) {
            modalBody.appendChild(container);
        }
    }
    
    // 3. Renderizado Condicional
    if (!window.rejectedScans || window.rejectedScans.length === 0) {
        container.style.display = 'none';
        return;
    }

    // Activar vista
    container.style.display = 'block';
    
    let html = `
        <div style="background-color: #dc3545; color: white; padding: 4px 10px; font-weight: bold; font-size: 0.9em; display: flex; align-items: center; justify-content: space-between; border-radius: 4px;">
            <span>⚠️ Historial de Artículos Rechazados / Fuera de Pedido</span>
            <span style="background: white; color: #dc3545; padding: 1px 6px; border-radius: 12px; font-size: 0.8em;">Total SKUs: ${window.rejectedScans.length}</span>
        </div>
        <table style="width: 100%; margin-top: 5px; border-collapse: collapse;">
            <thead>
                <tr style="border-bottom: 2px solid #f5c6cb;">
                    <th style="padding: 4px 6px; color: #dc3545; text-align: left; font-size: 0.85em;">Código Escaneado</th>
                    <th style="padding: 4px 6px; color: #dc3545; text-align: left; font-size: 0.85em;">Descripción / Razón</th>
                    <th style="padding: 4px 6px; color: #dc3545; text-align: center; font-size: 0.85em;">Cant.</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    window.rejectedScans.forEach(err => {
        html += `
            <tr style="border-bottom: 1px solid #f5c6cb;">
                <td style="padding: 4px 6px; font-weight: bold; color: #dc3545; font-size: 0.9em;">${err.codigo}</td>
                <td style="padding: 4px 6px; color: #dc3545; font-weight: 500; font-size: 0.9em;">
                    ${err.descripcion} 
                    ${err.overscan ? '<span style="font-size: 0.7em; background: #dc3545; color: white; padding: 1px 4px; border-radius: 3px; margin-left: 6px;">Exceso</span>' : ''}
                </td>
                <td style="padding: 4px 6px; text-align: center; font-weight: bold; font-size: 1em; color: #dc3545;">${err.cantidad}</td>
            </tr>
        `;
    });
    
    html += `</tbody></table>`;
    container.innerHTML = html;
}

// ==========================================
// 6. OPERACIONES FINALES Y RENDERIZADO DOM
// ==========================================

function vc_renderizarTablaArticulos() {
    const tbody = document.getElementById('vc-lista-articulos');
    tbody.innerHTML = '';

    vc_estado_actual.articulos.forEach((art, index) => {
        const tr = document.createElement('tr');
        tr.id = `vc-row-${index}`;
        tr.style.backgroundColor = art.completado ? '#d4edda' : '#ffffff';

        // Estado
        const tdEstado = document.createElement('td');
        tdEstado.id = `vc-cell-estado-${index}`;
        tdEstado.style.textAlign = 'center';
        tdEstado.textContent = art.completado ? '✅' : '⏳';
        
        // Detalles
        const tdCod = document.createElement('td');
        tdCod.textContent = art.codigo_principal;
        
        const tdDesc = document.createElement('td');
        tdDesc.textContent = art.descripcion;
        
        // Pedido Total
        const tdPed = document.createElement('td');
        tdPed.style.textAlign = 'center';
        tdPed.style.fontWeight = 'bold';
        tdPed.textContent = art.pedido_total;
        
        // Escaneada Activa
        const tdEsc = document.createElement('td');
        tdEsc.id = `vc-cell-escaneado-${index}`;
        tdEsc.style.textAlign = 'center';
        tdEsc.style.fontWeight = 'bold';
        tdEsc.style.color = art.completado ? '#155724' : '#0056b3';
        tdEsc.style.fontSize = '1.2em';
        tdEsc.textContent = art.cantidad_escaneada;

        tr.appendChild(tdEstado);
        tr.appendChild(tdCod);
        tr.appendChild(tdDesc);
        tr.appendChild(tdPed);
        tr.appendChild(tdEsc);
        
        tbody.appendChild(tr);
    });
}

function vc_actualizarFilaArticulo(index) {
    const art = vc_estado_actual.articulos[index];
    const tr = document.getElementById(`vc-row-${index}`);
    const tdEstado = document.getElementById(`vc-cell-estado-${index}`);
    const tdEsc = document.getElementById(`vc-cell-escaneado-${index}`);
    
    if (!tr || !tdEstado || !tdEsc) return;

    tdEsc.textContent = art.cantidad_escaneada;
    
    if (art.completado) {
        tr.style.backgroundColor = '#d4edda'; // Verde éxito
        tdEstado.textContent = '✅';
        tdEsc.style.color = '#155724';
    } else {
        // Animación sutil de pulso al contar un artículo sin completar la línea
        tr.style.backgroundColor = '#fff3cd'; // Amarillo tenue de flash
        setTimeout(() => { if (!art.completado) tr.style.backgroundColor = '#ffffff'; }, 300);
    }
}

function vc_actualizarBarraDeProgreso() {
    const barra = document.getElementById('vc-progress-fill');
    const texto = document.getElementById('vc-progress-text');
    
    let porcentaje = 0;
    if (vc_estado_actual.total_pedidos > 0) {
        porcentaje = (vc_estado_actual.total_escaneados / vc_estado_actual.total_pedidos) * 100;
    }
    
    barra.style.width = `${porcentaje}%`;
    barra.textContent = ``; // Quitamos el texto interno para que la barra de 10px no se desborde
    texto.textContent = `${Math.floor(porcentaje)}% - ${vc_estado_actual.total_escaneados} de ${vc_estado_actual.total_pedidos} artículos totales`;
    
    if (porcentaje >= 100) {
        barra.style.backgroundColor = '#28a745';
        barra.style.color = 'white';
    } else {
        barra.style.backgroundColor = '#17a2b8';
    }
}


function vc_cerrarPedidoAutomáticamente() {
    console.log(`[VC] Finalizando Pedido local ${vc_estado_actual.presupuesto_id_local}`);
    
    vc_beepVictory();
    vc_mostrarFeedback(`¡PEDIDO ${vc_estado_actual.presupuesto_id_local} COMPLETADO AL 100%!`, "victory");
    
    // Bloquear inputs temporalmente
    document.getElementById('vc-scanner-input').disabled = true;

    // Disparar red endpoint hacia "Pedido_Listo" (Mantiene backend sincronizado)
    fetch(`${base}/actualizar-secuencia`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            presupuestos_ids: [vc_estado_actual.presupuesto_id_local],
            nueva_secuencia: 'Pedido_Listo'
        })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            console.log(`[VC] Actualización backend exitosa para pedido ${vc_estado_actual.presupuesto_id_local}`);
        } else {
            console.error(`[VC] Warning del controlador en /actualizar-secuencia: ${data.error}`);
        }
    })
    .catch(err => {
        console.error(`[VC] HTTP Failure updating completion context:`, err);
    })
    .finally(() => {
        // En cualquier caso, luego de 2 segundos, vaciamos la lógica y permitimos el siguiente escaneo (Manos Libres)
        setTimeout(() => {
            // Repoblar data visual principal silenciando para evitar desvío de atención
            if (typeof cargarPedidosPorCliente === 'function') {
                cargarPedidosPorCliente();
            }
            
            document.getElementById('vc-scanner-input').disabled = false;
            vc_resetearMaquinaDeEstados();
        }, 2200);
    });
}
