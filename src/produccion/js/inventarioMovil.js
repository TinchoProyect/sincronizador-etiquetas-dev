/**
 * Inventario Móvil Full-Service - JavaScript
 * Versión 6.0 - Final Refinements (Sectors, Decimals, Printing)
 */

let socket = null;
let sessionId = null;
let articuloActual = null;
let listaIngredientes = [];
let sectoresSesion = [];
let codeReader = null;

const CONF = { RETRY: 2000, MAX: 5 };

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    sessionId = urlParams.get('session');

    if (sessionId) {
        inicializarWebSocket();
        configurarUI();
        focarInputPrincipal();
    } else {
        alert("Session ID faltante");
    }
});

// ==========================================
// 🔌 CONECTIVIDAD
// ==========================================
function inicializarWebSocket() {
    socket = io({ reconnection: true });

    socket.on('connect', () => {
        socket.emit('unirse_inventario', { sessionId });
    });

    socket.on('conexion_exitosa', (data) => {
        console.log("📥 [DEBUG MOVIL] Conexion Exitosa Payload:", data);
        const elSinInv = document.getElementById('sin-inventario');
        if (elSinInv) elSinInv.style.display = 'none';

        // No necesitamos 'vista-carga' porque usamos TABS (tab-carga está activo por default)
        // document.getElementById('vista-carga').style.display = 'block'; 


        // Header Info
        if (data.sectores) {
            sectoresSesion = data.sectores;
            actualizarHeaderSectores(sectoresSesion);
        }

        // AUDITORÍA: Guardar lista maestra
        if (data.ingredientes && Array.isArray(data.ingredientes)) {
            console.log(`📥 [SYNC] Recibidos ${data.ingredientes.length} ingredientes base`);

            if (data.ingredientes.length === 0) {
                console.warn("⚠️ [DEBUG MOVIL] Recibí array de ingredientes VACÍO");
            }

            // Mapear para asegurar campos
            listaIngredientes = data.ingredientes.map(i => ({
                ...i,
                contado: false,
                stock_contado: 0
            }));

            console.log("✅ [DEBUG MOVIL] listaIngredientes actualizada. Longitud:", listaIngredientes.length);

            // Renderizar inicial
            actualizarProgreso();
            renderizarHistorialLista();
        } else {
            console.error("❌ [DEBUG MOVIL] No llegaron ingredientes o no es array:", data.ingredientes);
        }

        if (data.usuario) {
            const badge = document.getElementById('usuario-badge');
            if (badge) {
                badge.textContent = data.usuario.nombre.split(' ')[0];
                badge.style.display = 'inline-block';
            }
        }
    });

    socket.on('datos_inventario', (data) => {
        console.log("📥 [DEBUG MOVIL] Evento datos_inventario:", data);
        // Fallback si el backend manda updates parciales
        // Pero en teoría usamos la lista local como verdad para la UI
        if (data.ingredientes && Array.isArray(data.ingredientes)) {
            if (data.ingredientes.length > 0) {
                listaIngredientes = data.ingredientes;
                console.log("✅ [DEBUG MOVIL] listaIngredientes actualizada via datos_inventario. Longitud:", listaIngredientes.length);
            } else {
                console.warn("⚠️ [DEBUG MOVIL] datos_inventario trajo lista VACÍA. Ignorando para no borrar local.");
            }
        }
        actualizarProgreso();
        renderizarHistorialLista();
    });

    socket.on('nuevo_articulo', (data) => {
        console.log("📥 [WS] Nuevo articulo recibido (Sync Mirror):", data);
        const item = data.articulo || data.ingrediente;
        const cant = data.cantidad;

        if (!item) return;

        // Actualizar modelo local
        // Buscar por ID para seguridad
        const localItem = listaIngredientes.find(i => i.id === item.id);

        if (localItem) {
            localItem.contado = true;
            localItem.stock_contado = parseFloat(cant);
            // Si el backend manda stock_sistema actualizado, lo tomamos
            if (item.stock_actual) localItem.stock_actual = item.stock_actual;

            // UI Feedback
            mostrarToast(`🔄 Sincronizado: ${localItem.nombre}`);
            actualizarProgreso();

            // Re-render activo si es necesario
            if (window.tabActual === 'pendientes') renderizarListaPendientes();
            if (window.tabActual === 'contados') renderizarListaContados();
        }
    });

    socket.on('articulo_confirmado', (data) => {
        mostrarToast("✅ Guardado");

        // Match robusto: ID primero, luego Nombre
        let local = null;
        if (data.ingrediente && data.ingrediente.id) {
            local = listaIngredientes.find(i => i.id === data.ingrediente.id);
        }
        if (!local && (data.ingrediente || data.articulo)) {
            const nombre = (data.ingrediente?.nombre || data.ingrediente || data.articulo).toString().trim();
            local = listaIngredientes.find(i => i.nombre.trim() === nombre);
        }

        if (local) {
            local.stock_contado = parseFloat(data.cantidad);
            local.contado = true;
            console.log("✅ [SOCKET] Local update:", local.nombre, local.stock_contado);
        } else {
            console.warn("⚠️ [SOCKET] No se encontró localmente item para actualizar:", data);
        }

        resetearFormulario();
        actualizarProgreso(); // Esto actualiza los contadores DE INMEDIATO

        // Si estamos en listados, refrescar
        if (window.tabActual === 'pendientes') renderizarListaPendientes();
        if (window.tabActual === 'contados') renderizarListaContados();
    });

    socket.on('inventario_finalizado', (data) => {
        alert(data.mensaje);
        location.reload();
    });

    socket.on('print_status', (data) => {
        if (data.success) {
            mostrarToast("🖨️ " + (data.msg || "Imprimiendo..."));
        } else {
            console.error("❌ Print error:", data.msg);
            mostrarToast("❌ " + (data.msg || "Error al imprimir"));
        }
    });

    // MOVIDO PARA EVITAR NULL ERROR
    socket.on('inventario_cancelado', () => {
        alert("⛔ El inventario ha sido cancelado.");
        window.location.reload();
    });
}
// FIX: Lógica de extracción de letras
function actualizarHeaderSectores(sectores) {
    const el = document.getElementById('info-sectores');
    if (!el || !sectores) return;

    // Si la lista está vacía, asumimos "TODOS"
    if (sectores.length === 0) {
        el.textContent = "TODOS";
        return;
    }

    // Intentar extraer letras de descripciones tipo 'Sector "G"'
    // Si son objetos { id, descripcion ... }
    // Si son strings directos ...
    const letras = sectores.map(s => {
        // Si es objeto
        let desc = typeof s === 'object' ? (s.descripcion || s.nombre || '') : String(s);

        // Regex para sacar contenido entre comillas: "G" o 'G'
        const match = desc.match(/["']([^"']+)["']/);
        if (match && match[1]) {
            return match[1].toUpperCase();
        }
        // Fallback: Si es un número (ID de sector), retornarlo tal cual o buscar la letra si supiéramos el mapa
        // Si desc es "Sector G" sin comillas, intentar sacar la última letra
        if (desc.includes('Sector')) {
            return desc.replace('Sector', '').trim();
        }
        return desc;
    }).filter(x => x);

    // Si detectamos que son muchos o todos, ajustar
    // Lógica simplificada:
    // Si detectamos que son muchos o todos, ajustar
    // Lógica simplificada:
    let textoSector = '';
    if (letras.length > 3) {
        textoSector = `Sec: ${letras.slice(0, 3).join(',')}...`;
    } else {
        textoSector = `Sec: ${letras.join(', ')}`;
    }

    // Inyectar HTML con botón de imprimir y CANCELAR (dentro de la función)
    el.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
            <span>${textoSector}</span>
            <button class="btn-xs" onclick="imprimirEtiquetaSector()" style="background:#444; color:#fff; border:none; padding:4px 8px; border-radius:4px;">
                🖨️
            </button>
            <button class="btn-xs" onclick="cancelarInventario()" style="background:#d32f2f; color:#fff; border:none; padding:4px 8px; border-radius:4px; margin-left:5px;">
                ❌
            </button>
        </div>
    `;
}

// NUEVO: Cancelar inventario desde móvil
window.cancelarInventario = () => {
    if (confirm("⚠️ ¿Estás seguro de CANCELAR el inventario?\n\nSe perderá todo el progreso y se cerrará la sesión.")) {
        if (confirm("Confirma por segunda vez: ¿CANCELAR definitivamente?")) {
            socket.emit('cancelar_inventario', { sessionId });
        }
    }
};

// FIX: Lógica de extracción de letras

// NUEVO: Función para imprimir etiqueta de sector (Abre Modal)
window.imprimirEtiquetaSector = () => {
    if (!sectoresSesion || !sectoresSesion.length) return;

    const modal = document.getElementById('modal-imprimir-sectores');
    const container = document.getElementById('lista-sectores-movil');
    if (!modal || !container) return;

    container.innerHTML = '';

    // "Todos" Header
    const divTodos = document.createElement('div');
    divTodos.style.padding = "8px";
    divTodos.style.borderBottom = "1px solid #eee";
    divTodos.style.marginBottom = "5px";
    divTodos.style.fontWeight = "bold";
    divTodos.innerHTML = `
        <label style="display:flex; align-items:center; gap:10px;">
            <input type="checkbox" id="check-todos-movil" checked style="transform:scale(1.3);"> 
            Seleccionar Todos
        </label>`;
    container.appendChild(divTodos);

    const checkTodos = divTodos.querySelector('input');

    // List Loop
    sectoresSesion.forEach((sect, index) => {
        const desc = typeof sect === 'object' ? (sect.descripcion || sect.nombre || '') : String(sect);

        let nombreMostrar = desc;
        const match = desc.match(/["']([^"']+)["']/);
        if (match && match[1]) nombreMostrar = `Sector ${match[1].toUpperCase()}`;

        const div = document.createElement('div');
        div.style.padding = "10px";
        div.style.borderBottom = "1px solid #f9f9f9";
        div.innerHTML = `
            <label style="display:flex; align-items:center; gap:10px;">
                <input type="checkbox" class="check-sector-print" value="${index}" checked style="transform:scale(1.3);"> 
                ${nombreMostrar}
            </label>`;
        container.appendChild(div);
    });

    checkTodos.onchange = (e) => {
        container.querySelectorAll('.check-sector-print').forEach(c => c.checked = e.target.checked);
    };

    modal.style.display = 'flex';
};

// ==========================================
// 📱 TABS LOGIC
// ==========================================
window.tabActual = 'carga'; // carga | pendientes | contados

function configurarTabs() {
    const tabs = document.querySelectorAll('.tab-link');
    tabs.forEach(t => {
        t.addEventListener('click', () => {
            const tabName = t.dataset.tab;
            cambiarTab(tabName);
        });
    });

    // Filtro Pendientes
    const filtroP = document.getElementById('filtro-pendientes');
    if (filtroP) {
        filtroP.addEventListener('input', (e) => {
            renderizarListaPendientes(e.target.value);
        });
    }
}

function cambiarTab(tabName) {
    window.tabActual = tabName;

    // 1. Update Buttons
    document.querySelectorAll('.tab-link').forEach(t => {
        if (t.dataset.tab === tabName) t.classList.add('active');
        else t.classList.remove('active');
    });

    // 2. Update Content
    document.querySelectorAll('.tab-content').forEach(c => {
        if (c.id === `tab-${tabName}`) c.classList.add('active');
        else c.classList.remove('active');
    });

    // 3. Logic specifics
    if (tabName === 'carga') {
        focarInputPrincipal();
    } else {
        // Renderizar on demand por si hubo updates minimos
        if (tabName === 'pendientes') renderizarListaPendientes();
        if (tabName === 'contados') renderizarListaContados();
    }
}

// ==========================================
// 📱 UI LOGIC REFACTORED
// ==========================================
function configurarUI() {
    configurarTabs();
    configurarBuscador(); // NUEVO: Lógica de búsqueda separada

    // 2. INPUT CANTIDAD
    const inputCant = document.getElementById('cantidad');
    if (inputCant) {
        inputCant.addEventListener('input', (e) => {
            let val = e.target.value;
            if (val.includes(',')) val = val.replace(/,/g, '.');
            inputCant.value = val;
            calcularDiferencia();
        });
        inputCant.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') enviarDatos();
        });
    }

    // 3. BOTONES ACCION
    const btnCargar = document.getElementById('btn-cargar');
    if (btnCargar) btnCargar.addEventListener('click', enviarDatos);

    const btnImp = document.getElementById('btn-imprimir');
    if (btnImp) btnImp.addEventListener('click', solicitarImpresion);

    const btnCam = document.getElementById('btn-camera-toggle');
    if (btnCam) btnCam.addEventListener('click', abrirCamara);

    const btnCloseCam = document.getElementById('btn-cerrar-scanner');
    if (btnCloseCam) btnCloseCam.addEventListener('click', () => {
        document.getElementById('modal-scanner').style.display = 'none';
        if (codeReader) codeReader.reset();
        focarInputPrincipal();
    });

    // 4. NUEVOS BOTONES GLOBALES
    const btnCancelGlobal = document.getElementById('btn-cancelar-global');
    if (btnCancelGlobal) btnCancelGlobal.addEventListener('click', window.cancelarInventario);

    const btnPrintSector = document.getElementById('btn-print-sector-movil');
    if (btnPrintSector) btnPrintSector.addEventListener('click', window.imprimirEtiquetaSector);

    const btnFinalizar = document.getElementById('btn-finalizar-movil');
    if (btnFinalizar) btnFinalizar.addEventListener('click', window.solicitarFinalizarInventario);

    // MODAL SECTORES
    const btnCancelPrint = document.getElementById('btn-cancelar-print-movil');
    if (btnCancelPrint) btnCancelPrint.addEventListener('click', () => {
        document.getElementById('modal-imprimir-sectores').style.display = 'none';
    });

    const btnConfirmPrint = document.getElementById('btn-confirmar-print-movil');
    if (btnConfirmPrint) {
        // Logica ya definida arriba, solo asegurarse que no se duplique listener si re-init
        // Mejor asignar onclick directo o limpiar antes.
        // Como 'configurarUI' corre una vez, esta bien addEventListener
        btnConfirmPrint.onclick = ejecutarImpresionMultipleMovil;
    }
}

async function ejecutarImpresionMultipleMovil() {
    const container = document.getElementById('lista-sectores-movil');
    const selectedIndices = Array.from(container.querySelectorAll('.check-sector-print:checked')).map(c => parseInt(c.value));

    if (selectedIndices.length === 0) {
        alert("⚠️ Selecciona al menos un sector.");
        return;
    }

    if (confirm(`¿Imprimir ${selectedIndices.length} sectores?`)) {
        mostrarToast(`🖨️ Iniciando impresión...`);
        for (let i = 0; i < selectedIndices.length; i++) {
            const idx = selectedIndices[i];
            const s = sectoresSesion[idx];
            let cleanDesc = typeof s === 'object' ? (s.descripcion || s.nombre || `Sector ${s.id}`) : String(s);

            console.log(`🖨️ [MOVIL PRINT ${i + 1}] Enviando:`, cleanDesc);
            socket.emit('imprimir_etiqueta_sector', { sector: cleanDesc });
            await new Promise(r => setTimeout(r, 500));
        }
        mostrarToast(`✅ Enviadas ${selectedIndices.length} ordenes.`);
        document.getElementById('modal-imprimir-sectores').style.display = 'none';
    }
}

// ------------------------------------------
// 🔍 BUSQUEDA Y SUGERENCIAS
// ------------------------------------------
function configurarBuscador() {
    const buscador = document.getElementById('buscador-movil');
    if (!buscador) return;

    buscador.addEventListener('input', (e) => {
        const val = e.target.value;

        // REGLA: Si empieza con número -> Asumir Barcode -> Silencio (Esperar Enter)
        if (/^\d/.test(val)) {
            ocultarDropdown();
            return;
        }

        const valTrimmed = val.trim();
        // REGLA: Si es texto (>2 chars) -> Buscador
        if (valTrimmed.length >= 2) {
            buscarTextoAvanzado(valTrimmed);
        } else {
            ocultarDropdown();
            // Si borró todo, restaurar lista original si estamos en pendientes
            if (valTrimmed.length === 0 && window.tabActual === 'pendientes') {
                renderizarListaPendientes();
            }
        }
    });

    buscador.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            ocultarDropdown();
            manejarBusquedaDirecta(buscador.value.trim());
        }
    });

    // Global click listener to close dropdown
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.input-group')) ocultarDropdown();
    });
}



function buscarNumerico(val) {
    // Buscar coincidencia exacta o parcial inicio en códigos
    // FIX: Convertir a String explícitamente y usar trim
    const matches = listaIngredientes.filter(i =>
        String(i.codigo).trim().startsWith(val) || String(i.codigo_barras || '').trim().startsWith(val)
    ).slice(0, 10);

    mostrarResultadosBusqueda(matches);
}

function buscarTextoAvanzado(texto) {
    // Búsqueda "Doble Filtro" por espacios (AND logic)
    const terminos = texto.toLowerCase().split(' ').filter(t => t.length > 0);

    const matches = listaIngredientes.filter(ing => {
        const nombre = (ing.nombre || '').toLowerCase();
        return terminos.every(t => nombre.includes(t));
    }).slice(0, 10);

    // DEBUG VISUAL PARA EL USUARIO (Temporal)
    console.log(`🔍 [DEBUG] Buscando '${texto}', encontrados: ${matches.length}`);
    const debugMsg = document.getElementById('diff-text');
    if (debugMsg && matches.length === 0) {
        debugMsg.innerText = `Debug: Buscando '${texto}' (0 hallazgos)`;
    }

    mostrarResultadosBusqueda(matches);
}

function mostrarResultadosBusqueda(matches) {
    const list = document.getElementById('search-dropdown');

    // Clear content
    list.innerHTML = '';

    if (!matches || matches.length === 0) {
        list.style.display = 'none';
        return;
    }

    // Generate elements
    matches.forEach(ing => {
        const div = document.createElement('div');
        div.className = 'dropdown-item';
        div.innerHTML = `
            <div>${ing.nombre}</div>
            <small style="color:#888">${ing.codigo || ''}</small>
        `;
        // Attach listener DIRECTLY to element logic
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log("🖱️ [CLICK] Sugerencia seleccionada:", ing.id);
            seleccionarSugerencia(ing.id);
        });
        list.appendChild(div);
    });

    list.style.display = 'block';
}

window.seleccionarSugerencia = (id) => {
    const item = listaIngredientes.find(i => i.id === id);
    if (item) {
        ocultarDropdown();
        cargarArticulo(item);
        // Limpiar buscador visualmente
        const buscador = document.getElementById('buscador-movil');
        if (buscador) buscador.value = '';
    }
};

function ocultarDropdown() {
    const list = document.getElementById('search-dropdown');
    if (list) list.style.display = 'none';
}

function manejarBusquedaDirecta(texto) {
    if (!texto) return;
    const term = texto.trim();

    // 1. Exacto
    const exacto = listaIngredientes.find(i =>
        String(i.codigo).trim() === term ||
        String(i.codigo_barras || '').trim() === term
    );

    if (exacto) {
        cargarArticulo(exacto);
        const buscador = document.getElementById('buscador-movil');
        if (buscador) buscador.value = '';
        return;
    }

    // 2. Fallback a texto avanzado si presionó enter
    buscarTextoAvanzado(term);
}

// ------------------------------------------
// 🔦 RENDERING LISTAS (Tabs)
// ------------------------------------------
function actualizarProgreso() {
    // Badges en Tabs
    const contados = listaIngredientes.filter(i => i.contado).length;
    const pendientes = listaIngredientes.length - contados;

    document.getElementById('badge-contados').textContent = contados;
    document.getElementById('badge-pendientes').textContent = pendientes;

    // Footer summary (opcional si se mantiene)
    const progCounter = document.getElementById('contador-progreso');
    if (progCounter) progCounter.textContent = `${contados}/${listaIngredientes.length}`;

    // Renderizar Tab Actual (Live Update)
    if (window.tabActual === 'pendientes') renderizarListaPendientes();
    if (window.tabActual === 'contados') renderizarListaContados();
}

function renderizarListaPendientes(filtro = "") {
    const container = document.getElementById('lista-pendientes-container');
    if (!container) return; // Si no existe aun

    let items = listaIngredientes.filter(i => !i.contado);

    // Filtro texto
    if (filtro) {
        const t = filtro.toLowerCase();
        items = items.filter(i => i.nombre.toLowerCase().includes(t) || String(i.codigo).includes(t));
    }

    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state-placeholder">✨ No hay pendientes ${filtro ? 'con ese filtro' : ''}</div>`;
        return;
    }

    container.innerHTML = items.map(i => `
        <div class="item-card pendiente">
            <div class="item-info" onclick="seleccionarSugerencia(${i.id})">
                <h4>${i.nombre}</h4>
                <div class="item-meta">
                    COD: ${i.codigo || '-'} | Sys: <strong>${i.stock_sistema || 0}</strong> ${i.unidad || ''}
                </div>
            </div>
            <button class="item-action" onclick="solicitarImpresionItemLista(${i.id})">🖨️</button>
        </div>
    `).join('');
}

function renderizarListaContados() {
    const container = document.getElementById('lista-contados-container');
    if (!container) return;

    // Ordenar: Ultimos contados arriba (si tuvieramos timestamp, por ahora reverse del array filtrado asumiendo orden de llegada)
    // Como 'listaIngredientes' no cambia orden, mejor no confiar en reverse puro.
    // Idealmente 'contado' deberia ser timestamp.
    let items = listaIngredientes.filter(i => i.contado);

    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state-placeholder">Empieza a escanear para ver resultados aquí</div>`;
        return;
    }

    // Reverse visual simple
    const reversed = [...items].reverse();

    container.innerHTML = reversed.map(i => `
        <div class="item-card contado">
            <div class="item-info" onclick="seleccionarSugerencia(${i.id})">
                <h4>${i.nombre}</h4>
                 <div class="item-meta">
                    <span style="color:#28a745; font-weight:bold;">Contado: ${i.stock_contado} ${i.unidad || ''}</span>
                    <br><small>Diferencia: ${(i.stock_contado - (i.stock_sistema || 0)).toFixed(2)}</small>
                </div>
            </div>
            <button class="item-action" onclick="solicitarImpresionItemLista(${i.id})">🖨️</button>
        </div>
    `).join('');
}

// Helper externo
window.solicitarImpresionItemLista = (id) => {
    console.log("🖨️ [UI] Solicitar impresion ID:", id, typeof id);
    // Usar loose equality por si id viene como string del HTML
    const item = listaIngredientes.find(i => i.id == id);

    if (item) {
        console.log("✅ [UI] Item encontrado:", item.nombre);

        const payload = {
            sessionId: sessionId,
            ingrediente: item,
            impresora: 'ZEBRA_FRENTE' // Paridad exacta con PC
        };

        console.log("📤 [SOCKET] Emitiendo imprimir_etiqueta_ingrediente:", payload);

        if (socket && socket.connected) {
            socket.emit('imprimir_etiqueta_ingrediente', payload);
            mostrarToast("🖨️ Solicitando...");
        } else {
            console.error("❌ [SOCKET] No hay conexión activa");
            mostrarToast("❌ Error: Sin conexión");
        }
    } else {
        console.error("❌ [UI] Item no encontrado en lista local para ID:", id);
        mostrarToast("❌ Error: Item no encontrado");
    }
};


// (Mantenemos renderizarHistorialLista por compatibilidad si algo lo llama, pero redirigimos)
function renderizarHistorialLista() {
    actualizarProgreso();
}

// Funciones Globales para la UI
window.cambiarTab = (tab) => {
    tabActual = tab;
    renderizarHistorialLista();
    focarInputPrincipal();
};

window.cargarDesdeLista = (id) => {
    const item = listaIngredientes.find(x => x.id === id);
    if (item) {
        document.getElementById('vista-historial').style.display = 'none';
        cargarArticulo(item);
    }
};

window.imprimirItemLista = (id) => {
    const item = listaIngredientes.find(x => x.id === id);
    if (item) {
        socket.emit('imprimir_etiqueta_ingrediente', {
            sessionId,
            ingrediente: item
        });
        mostrarToast(`🖨️ Imprimiendo ${item.nombre}...`);
        focarInputPrincipal();
    }
};

function mostrarModalCierre() {
    const total = listaIngredientes.length;
    // FIX: Usar la bandera 'contado' verdadera, no la existencia de stock_contado (que inicia en 0)
    const contados = listaIngredientes.filter(i => i.contado === true).length;
    const pendientes = total - contados;

    document.getElementById('res-total').textContent = total;
    document.getElementById('res-contados').textContent = contados;
    document.getElementById('res-pendientes').textContent = pendientes;
    document.getElementById('modal-resumen').style.display = 'flex';
}

function mostrarToast(msg) {
    const t = document.getElementById('confirmacion');
    t.textContent = msg;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 2000);
}

// ------------------------------------------
// 🧠 LOGICA DE NEGOCIO (Selección y Calculo)
// ------------------------------------------
function cargarArticulo(item) {
    articuloActual = item; // GLOBAL reference

    // 1. Mostrar Panel Info
    const panel = document.getElementById('info-articulo');
    if (panel) panel.style.display = 'block';
    const placeholder = document.getElementById('placeholder-carga');
    if (placeholder) placeholder.style.display = 'none';

    // 2. Llenar Datos
    document.getElementById('nombre-articulo').textContent = item.nombre;
    document.getElementById('codigo-articulo').textContent = `COD: ${item.codigo || item.id}`;
    document.getElementById('stock-sistema-badge').textContent = `Sys: ${item.stock_sistema || 0}`;

    // 3. Reset Inputs
    const inputCant = document.getElementById('cantidad');
    inputCant.value = ''; // Limpiar para que el usuario ingrese
    inputCant.placeholder = `${item.stock_contado || '0.00'}`;

    // 4. Habilitar Botón Confirmar (Se habilita al seleccionar para permitir workflows rápidos, o validamos 0?)
    // Requerimiento: "no veo el boton de confirmar... igual no selecciona"
    // Habilitamos inicialmente pero requerimos input para acción real si se desea.
    const btn = document.getElementById('btn-cargar');
    if (btn) {
        btn.disabled = false;
        btn.textContent = "CONFIRMAR PESO";
        btn.classList.remove('btn-success');
        btn.classList.add('btn-primary-block');
    }

    // 5. Calcular Inicial (mostrar diferencia vs 0 o vs lo que había)
    calcularDiferencia();

    // 6. Focus Teclado numerico
    setTimeout(() => inputCant.focus(), 100);
}

function calcularDiferencia() {
    if (!articuloActual) return;

    const input = document.getElementById('cantidad');
    let val = parseFloat(input.value);
    if (isNaN(val)) val = 0; // Si está vacío asumimos 0 visualmente para el calculo de diferencia? 
    // Mmm, mejor si vacío no mostramos diferencia engañosa.
    if (input.value.trim() === '') {
        // Estado neutro
        updateDiffBar(0, true);
        return;
    }

    const sys = parseFloat(articuloActual.stock_sistema || 0);
    const diff = val - sys;

    updateDiffBar(diff);
}

function updateDiffBar(diff, neutral = false) {
    const bar = document.getElementById('diff-bar');
    const text = document.getElementById('diff-text');

    // Reset classes
    bar.classList.remove('positive', 'negative', 'neutral');

    if (neutral) {
        bar.classList.add('neutral');
        text.textContent = "Ingrese cantidad...";
        return;
    }

    if (diff >= 0) {
        bar.classList.add('positive');
        text.textContent = `Sobra: +${diff.toFixed(2)}`;
    } else {
        bar.classList.add('negative');
        text.textContent = `Falta: ${diff.toFixed(2)}`;
    }
}

function resetearFormulario() {
    articuloActual = null;

    // Ocultar panel de datos
    const panel = document.getElementById('info-articulo');
    if (panel) panel.style.display = 'none';

    // Mostrar placeholder
    const placeholder = document.getElementById('placeholder-carga');
    if (placeholder) placeholder.style.display = 'block';

    // Limpiar input de busqueda principal
    const buscador = document.getElementById('buscador-movil');
    if (buscador) {
        buscador.value = '';
    }

    // Foco el input principal
    focarInputPrincipal();
}

function enviarDatos() {
    if (!articuloActual) return;

    const input = document.getElementById('cantidad');
    let cantidad = parseFloat(input.value);

    // Permitir 0 si explícitamente se escribe "0"
    if (isNaN(cantidad) && input.value.trim() !== '') {
        alert("Ingrese una cantidad válida");
        return;
    }
    // Si está vacío, ¿asumimos lo contado prev? No, mejor obligar input.
    if (input.value.trim() === '') {
        alert("Ingrese la cantidad contada.");
        return;
    }

    console.log(`📤 [ACCION] Confirmando ${articuloActual.nombre}: ${cantidad}`);

    socket.emit('articulo_escaneado', {
        sessionId,
        ingrediente: articuloActual, // Enviar objeto completo actualizado? Mejor el ref
        cantidad: cantidad
    });

    // Feedback inmediato UI (Optimistic update)
    // El socket 'articulo_confirmado' hara el resto, pero podemos avanzar UI
    articuloActual.stock_contado = cantidad;
    articuloActual.contado = true;

    // Feedback inmediato UI (Optimistic update)
    // El socket 'articulo_confirmado' hara el resto, pero podemos avanzar UI
    articuloActual.stock_contado = cantidad;
    articuloActual.contado = true;

    const btn = document.getElementById('btn-cargar');
    if (btn) {
        btn.textContent = "✅ GUARDADO";
        btn.classList.remove('btn-primary-block');
        btn.classList.add('btn-success');
    }

    // AUTO-FOCUS / SCANNER FIRST
    // Esperar un momento visual y resetear para permitir input inmediato
    setTimeout(() => {
        resetearFormulario(); // Esto debería borrar el articuloActual y mostrar el input de busqueda
        focarInputPrincipal();
    }, 800);
}

// ==========================================
// 🏁 FINALIZACIÓN DEL INVENTARIO
// ==========================================
window.solicitarFinalizarInventario = () => {
    // 1. Calcular resumen de cambios a CERO
    // Items que tienen stock en sistema > 0 pero NO fueron contados
    const itemsAZero = listaIngredientes.filter(i => !i.contado && (i.stock_sistema || i.stock_actual) > 0);

    let mensaje = "⚠️ ¿Finalizar Inventario?\n\n";

    if (itemsAZero.length > 0) {
        mensaje += `📉 SE PONDRÁN A CERO (${itemsAZero.length}) ARTÍCULOS:\n`;
        // Mostrar los primeros 5 como ejemplo
        itemsAZero.slice(0, 5).forEach(i => {
            mensaje += ` - ${i.nombre} (Sys: ${i.stock_sistema || i.stock_actual})\n`;
        });
        if (itemsAZero.length > 5) mensaje += `... y ${itemsAZero.length - 5} más.\n`;
    } else {
        mensaje += "✅ Todo parece en orden. No hay items con stock que queden sin contar.\n";
    }

    mensaje += "\nEsta acción es irreversible. Se generará el informe y cerrará la sesión.";

    // 2. Confirmación Nativa
    if (confirm(mensaje)) {
        if (confirm("¿Estás 100% seguro?")) {
            socket.emit('finalizar_inventario', {
                sessionId,
                confirmado: true
            });
            mostrarToast("🏁 Finalizando...");
        }
    }
};

window.solicitarImpresion = () => {
    if (articuloActual) {
        socket.emit('imprimir_etiqueta_ingrediente', {
            sessionId,
            ingrediente: articuloActual
        });
        mostrarToast("🖨️ Imprimiendo...");
    }
};



// NUEVO: Función para abrir cámara con ZXing
window.abrirCamara = () => {
    const modal = document.getElementById('modal-scanner');
    if (!modal) return;

    modal.style.display = 'flex';

    if (codeReader) {
        codeReader.reset();
    } else {
        if (typeof ZXing === 'undefined') {
            alert("Librería de scanner no cargada");
            return;
        }
        codeReader = new ZXing.BrowserMultiFormatReader();
    }

    console.log("📷 [CAM] Iniciando scanner...");

    codeReader.decodeFromVideoDevice(null, 'reader', (result, err) => {
        if (result) {
            console.log("📷 [CAM] Scan Success:", result.text);

            // Feedback sonoro/vibración si fuera posible
            if (navigator.vibrate) navigator.vibrate(200);

            // Cerrar modal
            modal.style.display = 'none';
            codeReader.reset();

            // Procesar
            manejarBusquedaDirecta(result.text);

        }
        if (err && !(err instanceof ZXing.NotFoundException)) {
            console.warn("📷 [CAM] Scan Error:", err);
        }
    }).catch(err => {
        console.error("❌ [CAM] Error inicio:", err);
        alert("Error al iniciar cámara: " + err);
        modal.style.display = 'none';
    });
};

// NUEVO: Función para enfocar input principal
window.focarInputPrincipal = () => {
    const input = document.getElementById('buscador-movil');
    if (input) {
        // Pequeño timeout para asegurar que el teclado virtual no cierre otras cosas
        setTimeout(() => {
            input.focus();
        }, 100);
    }
};

/* 
 * ==========================================
 * EXPOSICIÓN GLOBAL
 * ==========================================
 */
window.seleccionarSugerencia = seleccionarSugerencia;
window.cargarDesdeLista = cargarDesdeLista;
window.imprimirItemLista = imprimirItemLista;
window.abrirCamara = abrirCamara;
window.focarInputPrincipal = focarInputPrincipal;
window.configurarUI = configurarUI;
window.actualizarProgreso = actualizarProgreso;
window.renderizarListaPendientes = renderizarListaPendientes;

console.log("🚀 [MOVIL] Functions exposed to window.");
