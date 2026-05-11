/**
 * Inventario Móvil Artículos - JavaScript
 * Módulo exclusivo para Artículos (Totalmente desacoplado de Ingredientes)
 */

let socket = null;
let sessionId = null;
let articuloActual = null;
let listaArticulos = []; // Lista maestra cacheada
let codeReader = null;

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    sessionId = urlParams.get('session');

    if (sessionId) {
        await cargarArticulosMaestra();
        inicializarWebSocket();
        configurarUI();
        focarInputPrincipal();
    } else {
        alert("Session ID faltante");
    }
});

async function cargarArticulosMaestra() {
    try {
        const response = await fetch('/api/produccion/articulos');
        if (!response.ok) throw new Error('Error al obtener artículos');
        const data = await response.json();
        // Soportar ambas estructuras ({ success, data } o array directo)
        const articulosRaw = data.data || data;
        
        listaArticulos = articulosRaw.map(a => ({
            ...a,
            contado: false,
            stock_contado: 0
        }));
        
        console.log(`📦 [MOVIL] ${listaArticulos.length} artículos cargados localmente.`);
    } catch (error) {
        console.error('Error cargando artículos maestros:', error);
        alert("No se pudieron cargar los artículos. Refresca la página.");
    }
}

// ==========================================
// 🔌 CONECTIVIDAD
// ==========================================
function inicializarWebSocket() {
    socket = io({ reconnection: true });

    socket.on('connect', () => {
        socket.emit('unirse_inventario', { sessionId });
    });

    socket.on('conexion_exitosa', (data) => {
        console.log("✅ [MOVIL] Conexión Exitosa");
        const elSinInv = document.getElementById('sin-inventario');
        if (elSinInv) elSinInv.style.display = 'none';

        // Sincronizar estado (tolerancia a fallos o reconexión)
        if (data.articulosContados && Array.isArray(data.articulosContados)) {
            console.log(`📦 [MOVIL] Sincronizando ${data.articulosContados.length} artículos ya contados.`);
            data.articulosContados.forEach(item => {
                if (item.articulo && item.articulo.numero) {
                    const index = listaArticulos.findIndex(a => a.numero === item.articulo.numero);
                    if (index !== -1) {
                        listaArticulos[index].contado = true;
                        listaArticulos[index].stock_contado = item.cantidad;
                    }
                }
            });
        }

        actualizarProgreso();
        renderizarPendientes();
        renderizarContados();
    });

    socket.on('nuevo_articulo', (data) => {
        // Mirroring: Si otro dispositivo o la PC cuenta un artículo, reflejarlo acá.
        if (data.articulo && data.articulo.numero) {
            const index = listaArticulos.findIndex(a => a.numero === data.articulo.numero);
            if (index !== -1) {
                listaArticulos[index].contado = true;
                listaArticulos[index].stock_contado = data.cantidad;
                actualizarProgreso();
                renderizarPendientes();
                renderizarContados();
            }
        }
    });

    socket.on('error_conexion', (data) => {
        alert(data.mensaje || "Error de conexión con la PC");
    });
    
    socket.on('desconectado', () => {
        const elSinInv = document.getElementById('sin-inventario');
        if (elSinInv) {
            elSinInv.style.display = 'block';
            elSinInv.innerHTML = '<p>Conexión perdida con la PC</p>';
        }
    });
}

// ==========================================
// 📱 INTERFAZ DE USUARIO (UI)
// ==========================================
function configurarUI() {
    // 1. Scanner y Búsqueda
    document.getElementById('btn-camera-toggle').addEventListener('click', () => {
        abrirScanner();
    });

    document.getElementById('buscador-movil').addEventListener('input', (e) => {
        buscarArticuloEnLista(e.target.value);
    });

    // 2. Teclado Virtual (Enter)
    document.getElementById('buscador-movil').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Prevenir submit de form
            const val = e.target.value.trim();
            if (val.length > 0) {
                // Seleccionar el primer resultado si hay, o buscar directamente
                const dropDownItems = document.querySelectorAll('.dropdown-item');
                if (dropDownItems.length === 1) {
                    dropDownItems[0].click();
                } else {
                    buscarArticuloEnLista(val, true);
                }
            }
        }
    });

    document.getElementById('cantidad').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const btnCargar = document.getElementById('btn-cargar');
            if (!btnCargar.disabled) {
                btnCargar.click();
            }
        }
    });

    // Validar input de cantidad
    document.getElementById('cantidad').addEventListener('input', (e) => {
        // Reemplazar coma por punto para floats
        e.target.value = e.target.value.replace(/,/g, '.');
        validarFormulario();
    });

    // 3. Acciones de Carga
    document.getElementById('btn-cargar').addEventListener('click', confirmarConteoArticulo);
    
    // 4. Finalizar
    document.getElementById('btn-finalizar-movil').addEventListener('click', () => {
        document.getElementById('modal-finalizar-opciones').style.display = 'flex';
    });
    
    document.getElementById('btn-cancelar-finalizar-modal').addEventListener('click', () => {
        document.getElementById('modal-finalizar-opciones').style.display = 'none';
    });
    
    document.getElementById('btn-modalidad-parcial').addEventListener('click', () => solicitarFinalizacion('PARCIAL'));
    document.getElementById('btn-modalidad-total').addEventListener('click', () => solicitarFinalizacion('TOTAL'));

    // 5. Cancelar todo
    document.getElementById('btn-cancelar-global').addEventListener('click', () => {
        if (confirm("¿Seguro que deseas salir del inventario? Perderás el progreso.")) {
            window.location.href = '/pages/articulos.html';
        }
    });

    // 6. Tabs
    const tabs = document.querySelectorAll('.tab-link');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const targetId = `tab-${tab.dataset.tab}`;
            document.querySelectorAll('.tab-content').forEach(c => {
                c.classList.remove('active');
            });
            document.getElementById(targetId).classList.add('active');

            if (tab.dataset.tab === 'carga') {
                focarInputPrincipal();
            }
        });
    });

    // Filtro pendientes
    document.getElementById('filtro-pendientes').addEventListener('input', (e) => {
        renderizarPendientes(e.target.value);
    });
}

// ==========================================
// 🔍 BUSQUEDA Y SELECCIÓN
// ==========================================
function buscarArticuloEnLista(texto, exactMatch = false) {
    const dropdown = document.getElementById('search-dropdown');
    dropdown.innerHTML = '';
    const query = texto.toLowerCase().trim();

    if (query.length < 2) {
        dropdown.style.display = 'none';
        return;
    }

    const resultados = listaArticulos.filter(a => {
        return (a.codigo_barras && a.codigo_barras.toLowerCase() === query) ||
               (a.numero && a.numero.toLowerCase().includes(query)) ||
               (a.nombre && a.nombre.toLowerCase().includes(query));
    });

    if (exactMatch && resultados.length === 1) {
        dropdown.style.display = 'none';
        seleccionarArticulo(resultados[0]);
        return;
    }

    if (resultados.length > 0) {
        resultados.slice(0, 50).forEach(a => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            
            // Highlight si ya fue contado
            if (a.contado) {
                item.style.borderLeft = '4px solid #28a745';
            }

            item.innerHTML = `
                <div style="font-weight: 500">${a.nombre}</div>
                <div style="font-size: 12px; color: #666">
                    COD: ${a.numero} | Barras: ${a.codigo_barras || '-'} | Sys: ${a.stock_consolidado || 0}
                    ${a.contado ? ' <span style="color:#28a745; font-weight:bold;">(Ya contado)</span>' : ''}
                </div>
            `;
            item.onclick = () => {
                seleccionarArticulo(a);
                dropdown.style.display = 'none';
                document.getElementById('buscador-movil').value = '';
            };
            dropdown.appendChild(item);
        });
        dropdown.style.display = 'block';
    } else {
        dropdown.innerHTML = '<div class="dropdown-item text-muted">No encontrado</div>';
        dropdown.style.display = 'block';
    }
}

function seleccionarArticulo(articulo) {
    articuloActual = articulo;
    document.getElementById('placeholder-carga').style.display = 'none';
    document.getElementById('info-articulo').style.display = 'block';

    document.getElementById('nombre-articulo').textContent = articulo.nombre;
    document.getElementById('codigo-articulo').textContent = `COD: ${articulo.numero}`;
    
    const stockSys = articulo.stock_consolidado || 0;
    document.getElementById('stock-sistema-badge').textContent = `Sys: ${stockSys}`;

    const inputCant = document.getElementById('cantidad');
    if (articulo.contado) {
        inputCant.value = articulo.stock_contado;
        mostrarToast("Artículo ya contado previamente", "info");
    } else {
        inputCant.value = '';
    }

    actualizarDiferenciaVisual();
    validarFormulario();
    
    // Focus auto
    setTimeout(() => {
        inputCant.focus();
    }, 100);
}

// ==========================================
// ⚖️ LOGICA DE CONTEO
// ==========================================
function validarFormulario() {
    const cantidadStr = document.getElementById('cantidad').value.trim();
    const btnCargar = document.getElementById('btn-cargar');

    if (!articuloActual) {
        btnCargar.disabled = true;
        return;
    }

    const cantidad = parseFloat(cantidadStr);
    
    if (isNaN(cantidad) || cantidad < 0 || cantidadStr === '') {
        btnCargar.disabled = true;
    } else {
        btnCargar.disabled = false;
        actualizarDiferenciaVisual();
    }
}

function actualizarDiferenciaVisual() {
    if (!articuloActual) return;
    
    const inputCant = document.getElementById('cantidad').value;
    const stockContado = parseFloat(inputCant) || 0;
    const stockSistema = articuloActual.stock_consolidado || 0;
    
    const diff = stockContado - stockSistema;
    
    const diffBar = document.getElementById('diff-bar');
    const diffText = document.getElementById('diff-text');
    
    // Tolerancia por punto flotante
    if (Math.abs(diff) < 0.01) {
        diffBar.className = 'diff-bar neutral';
        diffText.textContent = 'Diferencia: 0 (OK)';
    } else if (diff > 0) {
        diffBar.className = 'diff-bar positive';
        diffText.textContent = `Diferencia: +${diff.toFixed(2)}`;
    } else {
        diffBar.className = 'diff-bar negative';
        diffText.textContent = `Diferencia: ${diff.toFixed(2)}`;
    }
}

function confirmarConteoArticulo() {
    if (!articuloActual) return;

    const btnCargar = document.getElementById('btn-cargar');
    const inputCant = document.getElementById('cantidad');
    const cantidad = parseFloat(inputCant.value);

    if (isNaN(cantidad) || cantidad < 0) return;

    // Deshabilitar botón durante el proceso
    btnCargar.disabled = true;
    btnCargar.textContent = "ENVIANDO...";

    // 1. Actualizar memoria local
    const index = listaArticulos.findIndex(a => a.numero === articuloActual.numero);
    if (index !== -1) {
        listaArticulos[index].contado = true;
        listaArticulos[index].stock_contado = cantidad;
    }

    // 2. Emitir a PC vía Socket
    const payload = {
        sessionId: sessionId,
        articulo: articuloActual,
        cantidad: cantidad
    };

    console.log("📤 [MOVIL] Emitiendo articulo_escaneado:", payload);
    socket.emit('articulo_escaneado', payload);

    // 3. Feedback UI
    mostrarToast("✅ Guardado", "success");
    
    // 4. Reset UI
    setTimeout(() => {
        articuloActual = null;
        document.getElementById('info-articulo').style.display = 'none';
        document.getElementById('placeholder-carga').style.display = 'block';
        inputCant.value = '';
        btnCargar.textContent = "CONFIRMAR CONTEO";
        
        actualizarProgreso();
        renderizarPendientes();
        renderizarContados();
        
        focarInputPrincipal();
    }, 500);
}

// ==========================================
// 📊 RENDERIZADO DE LISTAS Y PROGRESO
// ==========================================
function actualizarProgreso() {
    const contados = listaArticulos.filter(a => a.contado).length;
    // Solo contar pendientes aquellos que tienen stock en el sistema > 0
    const pendientes = listaArticulos.filter(a => !a.contado && (a.stock_consolidado || 0) > 0).length;

    document.getElementById('badge-pendientes').textContent = pendientes;
    document.getElementById('badge-contados').textContent = contados;
}

function renderizarPendientes(filtroTexto = '') {
    const container = document.getElementById('lista-pendientes-container');
    container.innerHTML = '';

    // Solo los que NO están contados Y tienen stock en el sistema > 0 (porque son los críticos)
    let pendientes = listaArticulos.filter(a => !a.contado && (a.stock_consolidado || 0) > 0);

    if (filtroTexto) {
        const query = filtroTexto.toLowerCase();
        pendientes = pendientes.filter(a => 
            (a.nombre && a.nombre.toLowerCase().includes(query)) ||
            (a.numero && a.numero.toLowerCase().includes(query))
        );
    }

    // Ordenar de mayor stock a menor
    pendientes.sort((a, b) => (b.stock_consolidado || 0) - (a.stock_consolidado || 0));

    if (pendientes.length === 0) {
        container.innerHTML = '<div class="empty-state">No hay artículos pendientes.</div>';
        return;
    }

    pendientes.forEach(a => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="item-info">
                <strong>${a.nombre}</strong>
                <div class="item-meta">COD: ${a.numero}</div>
            </div>
            <div class="item-action">
                <span class="badge-neutral">Sys: ${a.stock_consolidado || 0}</span>
            </div>
        `;
        div.onclick = () => {
            // Cambiar a tab carga
            document.querySelector('[data-tab="carga"]').click();
            seleccionarArticulo(a);
        };
        container.appendChild(div);
    });
}

function renderizarContados() {
    const container = document.getElementById('lista-contados-container');
    container.innerHTML = '';

    const contados = listaArticulos.filter(a => a.contado);

    // Ordenar los más recientes primero (en este caso no tenemos timestamp, lo mostramos como están)
    if (contados.length === 0) {
        container.innerHTML = '<div class="empty-state">Aún no has contado ningún artículo.</div>';
        return;
    }

    contados.forEach(a => {
        const div = document.createElement('div');
        div.className = 'list-item';
        // Highlight en rojo si la diferencia es != 0
        const stockSistema = a.stock_consolidado || 0;
        const diff = a.stock_contado - stockSistema;
        const colorDiff = Math.abs(diff) > 0.01 ? 'color: #d32f2f;' : 'color: #28a745;';

        div.innerHTML = `
            <div class="item-info">
                <strong>${a.nombre}</strong>
                <div class="item-meta">Sys: ${stockSistema}</div>
            </div>
            <div class="item-action" style="text-align: right;">
                <span style="font-weight: bold; font-size: 16px;">${a.stock_contado}</span>
                <div style="font-size: 11px; ${colorDiff}">Diff: ${diff > 0 ? '+' : ''}${diff.toFixed(2)}</div>
            </div>
        `;
        div.onclick = () => {
            // Cambiar a tab carga
            document.querySelector('[data-tab="carga"]').click();
            seleccionarArticulo(a);
        };
        container.appendChild(div);
    });
}

// ==========================================
// 📷 ESCANER DE CÓDIGOS DE BARRAS (ZXING)
// ==========================================
async function abrirScanner() {
    const modal = document.getElementById('modal-scanner');
    modal.style.display = 'flex';

    if (!codeReader) {
        codeReader = new ZXing.BrowserMultiFormatReader();
    }

    try {
        const videoInputDevices = await codeReader.listVideoInputDevices();
        if (videoInputDevices.length === 0) {
            alert('No se detectó cámara');
            modal.style.display = 'none';
            return;
        }
        
        let selectedDeviceId = videoInputDevices[0].deviceId;
        const backCamera = videoInputDevices.find(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('trasera'));
        if (backCamera) {
            selectedDeviceId = backCamera.deviceId;
        }

        codeReader.decodeFromVideoDevice(selectedDeviceId, 'reader', (result, err) => {
            if (result) {
                console.log('✅ [SCANNER] Código leído:', result.text);
                cerrarScanner();
                buscarArticuloEnLista(result.text, true);
            }
            if (err && !(err instanceof ZXing.NotFoundException)) {
                console.warn('⚠️ [SCANNER] Error de lectura:', err);
            }
        });

        document.getElementById('btn-cerrar-scanner').onclick = cerrarScanner;

    } catch (err) {
        console.error('❌ [SCANNER] Error iniciando cámara:', err);
        alert('Error al acceder a la cámara');
        modal.style.display = 'none';
    }
}

function cerrarScanner() {
    if (codeReader) {
        codeReader.reset();
    }
    document.getElementById('modal-scanner').style.display = 'none';
}

// ==========================================
// 🏁 FINALIZACIÓN DEL INVENTARIO
// ==========================================
function solicitarFinalizacion(modalidad) {
    document.getElementById('modal-finalizar-opciones').style.display = 'none';
    
    // Si es TOTAL, pedir segunda confirmación por seguridad
    if (modalidad === 'TOTAL') {
        const itemsNoContados = listaArticulos.filter(a => !a.contado && (a.stock_consolidado || 0) > 0).length;
        if (itemsNoContados > 0) {
            const confirmacion = confirm(`⚠️ ADVERTENCIA CRÍTICA: \n\nHay ${itemsNoContados} artículos con stock en el sistema que NO has contado.\n\nAl elegir Modalidad TOTAL, el sistema pondrá el stock de estos ${itemsNoContados} artículos a CERO (0).\n\n¿Estás completamente seguro de continuar?`);
            if (!confirmacion) return;
        }
    }

    console.log(`📤 [MOVIL] Solicitando cierre a PC. Modalidad: ${modalidad}`);
    
    socket.emit('movil_solicitar_cierre', {
        sessionId: sessionId,
        modalidad: modalidad
    });

    mostrarToast("Solicitud de cierre enviada a la PC", "success");
    
    setTimeout(() => {
        window.location.href = '/pages/articulos.html';
    }, 1500);
}

// ==========================================
// 🛠️ UTILIDADES
// ==========================================
function mostrarToast(mensaje, tipo = 'info') {
    const t = document.getElementById('confirmacion');
    t.textContent = mensaje;
    if (tipo === 'error') {
        t.style.backgroundColor = '#d32f2f';
    } else if (tipo === 'success') {
        t.style.backgroundColor = '#4caf50';
    } else {
        t.style.backgroundColor = '#333';
    }
    
    t.style.display = 'block';
    
    setTimeout(() => {
        t.style.display = 'none';
    }, 2000);
}

function focarInputPrincipal() {
    const bus = document.getElementById('buscador-movil');
    if (bus) {
        setTimeout(() => bus.focus(), 100);
    }
}
