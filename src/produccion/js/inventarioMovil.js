/**
 * Inventario Móvil Full-Service - JavaScript
 * Versión 6.0 - Final Refinements (Sectors, Decimals, Printing)
 */

let socket = null;
let sessionId = null;
let articuloActual = null;
let listaIngredientes = [];
let sectoresSesion = [];
let usuarioSesion = null;
let codeReader = null;

// Cronómetro móvil
let intervalCronometroMovil = null;
let inicioTimestampMovil = null;

function iniciarCronometroMovil(timestampInicio) {
    if (intervalCronometroMovil) {
        clearInterval(intervalCronometroMovil);
        intervalCronometroMovil = null;
    }

    if (timestampInicio) {
        const parsed = new Date(timestampInicio).getTime();
        if (!isNaN(parsed) && parsed > 0) {
            inicioTimestampMovil = parsed;
        }
    }

    if (!inicioTimestampMovil && sessionId && sessionId.startsWith('inv_ing_')) {
        const parts = sessionId.split('_');
        const ts = parseInt(parts[2]);
        if (!isNaN(ts) && ts > 1700000000000) {
            inicioTimestampMovil = ts;
        }
    }

    if (!inicioTimestampMovil || isNaN(inicioTimestampMovil)) {
        inicioTimestampMovil = Date.now();
    }

    const displayEl = document.getElementById('display-tiempo-movil');
    const badgeEl = document.getElementById('cronometro-movil');
    if (badgeEl) badgeEl.style.display = 'inline-flex';

    const actualizar = () => {
        const diff = Math.max(0, Math.floor((Date.now() - inicioTimestampMovil) / 1000));
        const h = String(Math.floor(diff / 3600)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
        const s = String(diff % 60).padStart(2, '0');
        if (displayEl) displayEl.textContent = `${h}:${m}:${s}`;
    };

    actualizar();
    intervalCronometroMovil = setInterval(actualizar, 1000);
    console.log("⏱️ [CRONOMETRO-MOVIL] Cronómetro móvil iniciado a las:", new Date(inicioTimestampMovil).toLocaleTimeString());
}

function detenerCronometroMovil() {
    if (intervalCronometroMovil) {
        clearInterval(intervalCronometroMovil);
        intervalCronometroMovil = null;
    }
    if (inicioTimestampMovil) {
        return Math.max(0, Math.floor((Date.now() - inicioTimestampMovil) / 1000));
    }
    return 0;
}

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

// Utilidad universal para normalizar decimales con comas o puntos indistintamente
function normalizarDecimalUniversal(valor) {
    if (valor === null || valor === undefined) return 0;
    if (typeof valor === 'number') return isNaN(valor) ? 0 : valor;
    let str = String(valor).trim().replace(/,/g, '.');
    if (str === '') return 0;
    const partes = str.split('.');
    if (partes.length > 2) {
        str = partes[0] + '.' + partes.slice(1).join('');
    }
    str = str.replace(/[^0-9.-]/g, '');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}
const normalizarDecimal = normalizarDecimalUniversal; // Retrocompatibilidad
window.normalizarDecimalUniversal = normalizarDecimalUniversal;
window.normalizarDecimal = normalizarDecimalUniversal;

// Mapea un ingrediente asegurando estructura dual de kilos y lotes
function mapearItemBase(i) {
    const lotesBase = (i.lotes_cajas_cerradas || []).map(l => ({
        vinculo_id: l.vinculo_id,
        lote_id_supabase: l.lote_id_supabase,
        id_corto: l.id_corto || (l.lote_id_supabase ? l.lote_id_supabase.substring(0, 8) : 'LOTE'),
        cajas_sistema: normalizarDecimalUniversal(l.cajas_disponibles || l.cantidad_asignada || 0),
        cajas_contadas: l.cajas_contadas !== undefined ? normalizarDecimalUniversal(l.cajas_contadas) : 0,
        kilos_por_caja: normalizarDecimalUniversal(l.kilos_por_caja || 0),
        costo_kilo: l.costo_kilo || 0
    }));

    return {
        ...i,
        stock_actual: normalizarDecimalUniversal(i.stock_actual || 0),
        stock_bultos: normalizarDecimalUniversal(i.stock_bultos || 0),
        contado: i.contado || false,
        stock_contado: i.stock_contado !== undefined ? normalizarDecimalUniversal(i.stock_contado) : 0,
        kilos_sueltos_contados: i.kilos_sueltos_contados !== undefined ? normalizarDecimalUniversal(i.kilos_sueltos_contados) : (normalizarDecimalUniversal(i.stock_contado) || 0),
        lotes_contados: i.lotes_contados || lotesBase,
        lotes_cajas_cerradas: i.lotes_cajas_cerradas || [],
        total_bultos_contados: i.total_bultos_contados !== undefined ? normalizarDecimalUniversal(i.total_bultos_contados) : 0,
        stock_potencial_contado: i.stock_potencial_contado !== undefined ? normalizarDecimalUniversal(i.stock_potencial_contado) : 0
    };
}

// Merge inteligente que NUNCA pisa items ya contados localmente en el móvil
function mergeIngredientesPreservandoProgreso(nuevosIngredientes) {
    if (!nuevosIngredientes || !Array.isArray(nuevosIngredientes)) return;

    if (!listaIngredientes || listaIngredientes.length === 0) {
        listaIngredientes = nuevosIngredientes.map(mapearItemBase);
        return;
    }

    const mapaActual = new Map();
    listaIngredientes.forEach(i => mapaActual.set(String(i.id), i));

    listaIngredientes = nuevosIngredientes.map(nuevoRaw => {
        const nuevo = mapearItemBase(nuevoRaw);
        const actual = mapaActual.get(String(nuevo.id));

        if (actual && actual.contado) {
            // El colaborador ya contó este ingrediente en el móvil: PRESERVAR INTACTO
            return {
                ...nuevo,
                contado: true,
                stock_contado: actual.stock_contado,
                kilos_sueltos_contados: actual.kilos_sueltos_contados,
                lotes_contados: actual.lotes_contados || nuevo.lotes_contados,
                total_bultos_contados: actual.total_bultos_contados,
                stock_potencial_contado: actual.stock_potencial_contado
            };
        }
        return nuevo;
    });
}

// Persistencia asíncrona unitaria directa en BD PostgreSQL (POST /registrar)
async function persistirItemEnServidor(item, kilosSueltos, lotesContados, totalBultos) {
    if (!sessionId || !item || !item.id) return;
    try {
        const payload = {
            session_id: sessionId,
            ingrediente_id: item.id,
            stock_contado: kilosSueltos,
            kilos_sueltos_contados: kilosSueltos,
            lotes_contados: lotesContados || [],
            total_bultos_contados: totalBultos || 0,
            stock_potencial_contado: kilosSueltos + (totalBultos > 0 ? (item.stock_potencial_contado || kilosSueltos) : 0),
            codigo_barras: item.codigo || null
        };
        fetch(`/api/produccion/inventario-ingredientes/${sessionId}/registrar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(res => {
            if (res.ok) console.log(`💾 [PERSISTENCIA HTTP] Item ${item.nombre} registrado en BD con éxito`);
            else console.warn(`⚠️ [PERSISTENCIA HTTP] Status ${res.status}`);
        }).catch(err => {
            console.warn(`⚠️ [PERSISTENCIA HTTP] Error de red:`, err);
        });
    } catch (e) {
        console.warn(`⚠️ [PERSISTENCIA HTTP] Excepción:`, e);
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
        console.log("📥 [DEBUG MOVIL] Conexion Exitosa Payload:", data);
        const elSinInv = document.getElementById('sin-inventario');
        if (elSinInv) elSinInv.style.display = 'none';

        // Header Info
        if (data.sectores) {
            sectoresSesion = data.sectores;
            actualizarHeaderSectores(sectoresSesion);
        }

        // Iniciar cronómetro móvil sincronizado
        iniciarCronometroMovil(data.timestampCreacion || data.fechaInicio);

        // AUDITORÍA: Guardar lista maestra con merge no destructivo
        if (data.ingredientes && Array.isArray(data.ingredientes)) {
            console.log(`📥 [SYNC] Recibidos ${data.ingredientes.length} ingredientes base`);

            mergeIngredientesPreservandoProgreso(data.ingredientes);

            console.log("✅ [DEBUG MOVIL] listaIngredientes actualizada. Longitud:", listaIngredientes.length);

            // Renderizar inicial
            actualizarProgreso();
            renderizarHistorialLista();
        } else {
            console.error("❌ [DEBUG MOVIL] No llegaron ingredientes o no es array:", data.ingredientes);
        }

        if (data.usuario) {
            usuarioSesion = data.usuario;
            const badge = document.getElementById('usuario-badge');
            if (badge) {
                badge.textContent = data.usuario.nombre.split(' ')[0];
                badge.style.display = 'inline-block';
            }
        }
    });

    socket.on('datos_inventario', (data) => {
        console.log("📥 [DEBUG MOVIL] Evento datos_inventario:", data);
        if (data.usuario) {
            usuarioSesion = data.usuario;
        }
        if (data.sectores) {
            sectoresSesion = data.sectores;
            actualizarHeaderSectores(sectoresSesion);
        }
        if (data.ingredientes && Array.isArray(data.ingredientes)) {
            if (data.ingredientes.length > 0) {
                mergeIngredientesPreservandoProgreso(data.ingredientes);
                console.log("✅ [DEBUG MOVIL] listaIngredientes protegida via merge en datos_inventario. Longitud:", listaIngredientes.length);
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

        const localItem = listaIngredientes.find(i => i.id === item.id);

        if (localItem) {
            localItem.contado = true;
            localItem.stock_contado = normalizarDecimalUniversal(cant !== undefined ? cant : (item.stock_contado || item.kilos_sueltos_contados || 0));
            localItem.kilos_sueltos_contados = localItem.stock_contado;
            if (item.lotes_contados) localItem.lotes_contados = item.lotes_contados;
            if (item.total_bultos_contados !== undefined) localItem.total_bultos_contados = normalizarDecimalUniversal(item.total_bultos_contados);
            if (item.stock_potencial_contado !== undefined) localItem.stock_potencial_contado = normalizarDecimalUniversal(item.stock_potencial_contado);

            // Si la ficha activa en móvil es este artículo, refrescar sin pisar si el usuario está tipeando activamente
            if (articuloActual && String(articuloActual.id) === String(item.id)) {
                articuloActual.kilos_sueltos_contados = localItem.kilos_sueltos_contados;
                articuloActual.stock_contado = localItem.stock_contado;
                articuloActual.total_bultos_contados = localItem.total_bultos_contados;
                articuloActual.stock_potencial_contado = localItem.stock_potencial_contado;
                if (item.lotes_contados) articuloActual.lotes_contados = JSON.parse(JSON.stringify(item.lotes_contados));
                articuloActual.contado = true;

                const inputCant = document.getElementById('cantidad');
                if (inputCant && document.activeElement !== inputCant) {
                    inputCant.value = articuloActual.kilos_sueltos_contados || '';
                }
                renderizarLotesArticuloActual();
                calcularDiferenciaKilos();
                actualizarCalculoDual();
            }

            mostrarToast(`🔄 Sincronizado: ${localItem.nombre}`);
            actualizarProgreso();

            if (window.tabActual === 'pendientes') renderizarListaPendientes();
            if (window.tabActual === 'contados') renderizarListaContados();
        }
    });

    socket.on('articulo_confirmado', (data) => {
        mostrarToast("✅ Guardado");

        const itemObj = data.ingrediente || data.articulo;
        let local = null;
        if (itemObj && itemObj.id) {
            local = listaIngredientes.find(i => i.id === itemObj.id);
        }
        if (!local && (data.ingrediente || data.articulo || data.nombre)) {
            const nombre = (itemObj?.nombre || data.nombre || data.ingrediente || data.articulo).toString().trim();
            local = listaIngredientes.find(i => i.nombre.trim() === nombre);
        }

        if (local) {
            local.contado = true;
            if (itemObj && typeof itemObj === 'object') {
                local.kilos_sueltos_contados = itemObj.kilos_sueltos_contados !== undefined ? normalizarDecimalUniversal(itemObj.kilos_sueltos_contados) : normalizarDecimalUniversal(data.cantidad);
                local.stock_contado = local.kilos_sueltos_contados;
                if (itemObj.lotes_contados) local.lotes_contados = itemObj.lotes_contados;
                if (itemObj.total_bultos_contados !== undefined) local.total_bultos_contados = normalizarDecimalUniversal(itemObj.total_bultos_contados);
                if (itemObj.stock_potencial_contado !== undefined) local.stock_potencial_contado = normalizarDecimalUniversal(itemObj.stock_potencial_contado);
            } else {
                local.stock_contado = normalizarDecimalUniversal(data.cantidad);
                local.kilos_sueltos_contados = local.stock_contado;
            }
            console.log("✅ [SOCKET] Local update dual:", local.nombre, local.kilos_sueltos_contados, local.total_bultos_contados);
        }

        resetearFormulario();
        actualizarProgreso();

        if (window.tabActual === 'pendientes') renderizarListaPendientes();
        if (window.tabActual === 'contados') renderizarListaContados();
    });

    socket.on('inventario_finalizado', (data) => {
        if (data?.resultado) {
            mostrarModalFinInventarioMovil(data.resultado, data.sessionId || sessionId);
        }
    });

    socket.on('inventario_finalizado_con_reporte', (data) => {
        if (data?.resultado) {
            mostrarModalFinInventarioMovil(data.resultado, data.sessionId || sessionId);
        }
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
        detenerCronometroMovil();
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
    if (typeof autoFlushArticuloActual === 'function') {
        autoFlushArticuloActual();
    }
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

    // 2. INPUT CANTIDAD (CON PROTECCIÓN CONTRA ESCANEO DE LOTE)
    const inputCant = document.getElementById('cantidad');
    let valorPrevioKilos = '';
    let debounceSyncTimer = null;

    if (inputCant) {
        inputCant.addEventListener('input', (e) => {
            let val = e.target.value;
            // Si el operario escanea un lote o código mientras el cursor está en el input de kilos
            if (/[a-zA-Z]/.test(val) && val.length >= 3) {
                const escaneo = val.trim();
                inputCant.value = valorPrevioKilos; // Restaurar kilos previos
                console.log("⚡ [SCAN CAPTURADO EN KILOS] Procesando como escaneo directo:", escaneo);
                manejarBusquedaDirecta(escaneo);
                return;
            }

            valorPrevioKilos = val;
            calcularDiferenciaKilos();
            actualizarCalculoDual();

            // Sincronización en tiempo real reactiva con PC y auto-persistencia en PostgreSQL (debounce 250ms)
            if (debounceSyncTimer) clearTimeout(debounceSyncTimer);
            debounceSyncTimer = setTimeout(() => {
                emitirSincronizacionDual();
            }, 250);
        });

        inputCant.addEventListener('blur', (e) => {
            // Al salir del campo, normalizar estéticamente la coma si tiene formato válido
            const val = e.target.value.trim();
            if (val && !isNaN(normalizarDecimalUniversal(val))) {
                calcularDiferenciaKilos();
                actualizarCalculoDual();
            }
        });

        inputCant.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (debounceSyncTimer) clearTimeout(debounceSyncTimer);
                const val = inputCant.value.trim();
                if (/[a-zA-Z]/.test(val) && val.length >= 3) {
                    e.preventDefault();
                    inputCant.value = valorPrevioKilos;
                    manejarBusquedaDirecta(val);
                    return;
                }
                enviarDatos();
            }
        });
    }

    // 2.2 INPUT ESCANEO DE LOTE DEDICADO DENTRO DE TARJETA
    const inputScanLote = document.getElementById('input-scan-lote');
    if (inputScanLote) {
        let scanTimer = null;
        const ejecutarDisparoLote = (val) => {
            if (scanTimer) clearTimeout(scanTimer);
            const raw = val.trim();
            if (!raw) return;
            console.log("📦 [INPUT SCAN LOTE DISPARO]:", raw);
            procesarLoteArticuloActual(raw);
            inputScanLote.value = '';
            setTimeout(() => inputScanLote.focus(), 50);
        };

        inputScanLote.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                ejecutarDisparoLote(inputScanLote.value);
            }
        });

        inputScanLote.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (scanTimer) clearTimeout(scanTimer);
            if (val.length >= 4) {
                scanTimer = setTimeout(() => {
                    if (inputScanLote.value.trim().length >= 4) {
                        ejecutarDisparoLote(inputScanLote.value);
                    }
                }, 280);
            }
        });
    }

    // 2.3 INPUT ESCANEO DE LOTE GLOBAL (MODO BULTOS SUPERIOR)
    const buscadorLoteGlobal = document.getElementById('buscador-lote-global');
    if (buscadorLoteGlobal) {
        let timerGlobal = null;
        const ejecutarGlobal = (val) => {
            if (timerGlobal) clearTimeout(timerGlobal);
            const raw = val.trim();
            if (!raw) return;
            console.log("📦 [BUSCADOR LOTE GLOBAL]:", raw);
            manejarEscaneoBultosGlobal(raw);
            buscadorLoteGlobal.value = '';
        };

        buscadorLoteGlobal.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                ejecutarGlobal(buscadorLoteGlobal.value);
            }
        });

        buscadorLoteGlobal.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (timerGlobal) clearTimeout(timerGlobal);
            if (val.length >= 4) {
                timerGlobal = setTimeout(() => {
                    if (buscadorLoteGlobal.value.trim().length >= 4) {
                        ejecutarGlobal(buscadorLoteGlobal.value);
                    }
                }, 280);
            }
        });
    }

    // 3. BOTONES ACCION
    const btnCargar = document.getElementById('btn-cargar');
    if (btnCargar) btnCargar.addEventListener('click', enviarDatos);

    const btnCerrarTarjeta = document.getElementById('btn-cerrar-tarjeta');
    if (btnCerrarTarjeta) {
        btnCerrarTarjeta.addEventListener('click', () => {
            autoFlushArticuloActual();
            resetearFormulario();
        });
    }

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

        // Si parece un escaneo de código de barras o lote (sin espacios y de longitud >= 4)
        if (/^[a-zA-Z0-9_-]{4,}$/.test(val.trim())) {
            ocultarDropdown();
            return;
        }

        const valTrimmed = val.trim();
        if (valTrimmed.length >= 2) {
            buscarTextoAvanzado(valTrimmed);
        } else {
            ocultarDropdown();
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

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.input-group')) ocultarDropdown();
    });
}

function buscarNumerico(val) {
    const matches = listaIngredientes.filter(i =>
        String(i.codigo || '').trim().startsWith(val) || String(i.codigo_barras || '').trim().startsWith(val)
    ).slice(0, 10);

    mostrarResultadosBusqueda(matches);
}

function buscarTextoAvanzado(texto) {
    const terminos = texto.toLowerCase().split(' ').filter(t => t.length > 0);

    const matches = listaIngredientes.filter(ing => {
        const nombre = (ing.nombre || '').toLowerCase();
        return terminos.every(t => nombre.includes(t));
    }).slice(0, 10);

    mostrarResultadosBusqueda(matches);
}

function mostrarResultadosBusqueda(matches) {
    const list = document.getElementById('search-dropdown');
    list.innerHTML = '';

    if (!matches || matches.length === 0) {
        list.style.display = 'none';
        return;
    }

    matches.forEach(ing => {
        const div = document.createElement('div');
        div.className = 'dropdown-item';
        div.innerHTML = `
            <div><strong>${ing.nombre}</strong></div>
            <small style="color:#64748b">COD: ${ing.codigo || ing.id} | Sys: ${(ing.stock_actual || 0).toFixed(2)} kg | ${parseFloat(ing.stock_bultos || 0)} cj</small>
        `;
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
        const buscador = document.getElementById('buscador-movil');
        if (buscador) buscador.value = '';
    }
};

function ocultarDropdown() {
    const list = document.getElementById('search-dropdown');
    if (list) list.style.display = 'none';
}

function sonarBeep(frecuencia = 950, duracion = 0.08) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frecuencia, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duracion);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duracion);
    } catch (e) {}
}

function procesarLoteArticuloActual(codigo) {
    if (!articuloActual || !codigo) return;
    const term = codigo.trim().toLowerCase();
    const cleanTerm = term.replace(/^l[:\s-]*/i, '').trim();

    // 1. ¿Es el código de OTRO ingrediente? (El operario terminó este producto y disparó al siguiente pallet)
    const siguienteIngrediente = listaIngredientes.find(i =>
        i.id !== articuloActual.id && (
            String(i.codigo || '').toLowerCase() === term ||
            String(i.codigo_barras || '').toLowerCase() === term ||
            String(i.id) === term
        )
    );

    if (siguienteIngrediente) {
        console.log("🔄 [TRANSICION PRODUCTO] Detectado nuevo ingrediente:", siguienteIngrediente.nombre);
        enviarDatosSilencioso();
        sonarBeep(650, 0.12);
        mostrarToast(`🔄 Siguiente: ${siguienteIngrediente.nombre}`);
        cargarArticulo(siguienteIngrediente, 'lotes');
        return;
    }

    // 2. Buscar coincidencia en los lotes existentes de este artículo
    if (!articuloActual.lotes_contados) articuloActual.lotes_contados = [];

    let loteMatch = articuloActual.lotes_contados.find(l => {
        const loteId = String(l.lote_id_supabase || '').toLowerCase();
        const idCorto = String(l.id_corto || '').toLowerCase();
        const loteCodCorto = String(l.lote_codigo_corto || '').toLowerCase();
        return loteId === term || loteId === cleanTerm ||
               idCorto === term || idCorto === cleanTerm ||
               loteCodCorto === term || loteCodCorto === cleanTerm ||
               (cleanTerm.length >= 3 && (loteId.includes(cleanTerm) || idCorto.includes(cleanTerm)));
    });

    // 3. Si no existe, crear el lote dinámicamente
    if (!loteMatch) {
        const idDisplay = (cleanTerm || term).substring(0, 12).toUpperCase();
        console.log(`✨ [NUEVO LOTE DINAMICO] Registrando lote '${idDisplay}' en:`, articuloActual.nombre);

        let kgCaja = 25;
        if (articuloActual.kilos_por_bulto && parseFloat(articuloActual.kilos_por_bulto) > 0) {
            kgCaja = parseFloat(articuloActual.kilos_por_bulto);
        } else if (articuloActual.lotes_contados.length > 0) {
            const conKg = articuloActual.lotes_contados.find(l => parseFloat(l.kilos_por_caja) > 0);
            if (conKg) kgCaja = parseFloat(conKg.kilos_por_caja);
        } else if (parseFloat(articuloActual.stock_bultos) > 0 && parseFloat(articuloActual.stock_actual) > 0) {
            kgCaja = Math.round((parseFloat(articuloActual.stock_actual) / parseFloat(articuloActual.stock_bultos)) * 100) / 100;
        }

        loteMatch = {
            vinculo_id: 'lote_' + idDisplay,
            id_corto: idDisplay,
            lote_codigo_corto: idDisplay,
            lote_id_supabase: codigo.trim(),
            cajas_sistema: 0,
            cajas_contadas: 0,
            kilos_por_caja: kgCaja,
            costo_kilo: 0
        };
        articuloActual.lotes_contados.push(loteMatch);
        renderizarLotesArticuloActual();
    }

    // 4. Sumar +1 bulto
    sumarCajaLote(loteMatch.vinculo_id, 1);
    sonarBeep(1100, 0.09);
    if (navigator.vibrate) navigator.vibrate([70]);
}

function enviarDatosSilencioso() {
    if (!articuloActual) return;
    const input = document.getElementById('cantidad');
    let kilosSueltos = normalizarDecimalUniversal(input ? input.value : '');

    let totalCajas = 0;
    let totalKilosLotes = 0;
    if (articuloActual.lotes_contados) {
        articuloActual.lotes_contados.forEach(l => {
            const c = normalizarDecimalUniversal(l.cajas_contadas) || 0;
            totalCajas += c;
            totalKilosLotes += (c * (normalizarDecimalUniversal(l.kilos_por_caja) || 0));
        });
    }
    const stockPotencialContado = kilosSueltos + totalKilosLotes;

    articuloActual.kilos_sueltos_contados = kilosSueltos;
    articuloActual.stock_contado = kilosSueltos;
    articuloActual.total_bultos_contados = totalCajas;
    articuloActual.stock_potencial_contado = stockPotencialContado;
    articuloActual.contado = true;

    const idx = listaIngredientes.findIndex(i => i.id === articuloActual.id);
    if (idx !== -1) {
        listaIngredientes[idx].kilos_sueltos_contados = kilosSueltos;
        listaIngredientes[idx].stock_contado = kilosSueltos;
        listaIngredientes[idx].total_bultos_contados = totalCajas;
        listaIngredientes[idx].stock_potencial_contado = stockPotencialContado;
        listaIngredientes[idx].lotes_contados = JSON.parse(JSON.stringify(articuloActual.lotes_contados || []));
        listaIngredientes[idx].contado = true;
    }

    if (socket && socket.connected) {
        socket.emit('articulo_escaneado', {
            sessionId,
            ingrediente: {
                ...articuloActual,
                kilos_sueltos_contados: kilosSueltos,
                stock_contado: kilosSueltos,
                lotes_contados: articuloActual.lotes_contados || [],
                total_bultos_contados: totalCajas,
                stock_potencial_contado: stockPotencialContado,
                contado: true
            },
            cantidad: kilosSueltos,
            finalizar_item: true
        });
    }

    // Persistir directamente a PostgreSQL
    persistirItemEnServidor(articuloActual, kilosSueltos, articuloActual.lotes_contados, totalCajas);

    actualizarProgreso();
}

function manejarEscaneoBultosGlobal(texto) {
    if (!texto) return;
    const term = texto.trim().toLowerCase();
    console.log("📦 [BUSCADOR BULTOS GLOBAL] Analizando:", term);

    // 1. ¿Coincide con un ingrediente por código, código de barras o ID?
    const exacto = listaIngredientes.find(i =>
        String(i.codigo || '').toLowerCase() === term ||
        String(i.codigo_barras || '').toLowerCase() === term ||
        String(i.id) === term
    );

    if (exacto) {
        console.log("🎯 [MODO BULTOS] Ingrediente seleccionado:", exacto.nombre);
        cargarArticulo(exacto, 'lotes');
        sonarBeep(880, 0.08);
        mostrarToast(`📦 ${exacto.nombre}: Dispará a los lotes`);
        const inputLote = document.getElementById('buscador-lote-global');
        if (inputLote) inputLote.value = '';
        return;
    }

    // 2. Si ya hay un artículo activo abierto, delegar a procesarLoteArticuloActual
    if (articuloActual) {
        procesarLoteArticuloActual(texto);
        const inputLote = document.getElementById('buscador-lote-global');
        if (inputLote) inputLote.value = '';
        return;
    }

    // 3. Si no hay artículo abierto, buscar si el lote pertenece a algún ingrediente
    const cleanTerm = term.replace(/^l[:\s-]*/i, '').trim();
    for (const ing of listaIngredientes) {
        const lotes = ing.lotes_contados || ing.lotes_cajas_cerradas || [];
        const loteEncontrado = lotes.find(l => {
            const loteId = String(l.lote_id_supabase || '').toLowerCase();
            const idCorto = String(l.id_corto || '').toLowerCase();
            const loteCodCorto = String(l.lote_codigo_corto || '').toLowerCase();
            return loteId === term || loteId === cleanTerm ||
                   idCorto === term || idCorto === cleanTerm ||
                   loteCodCorto === term || loteCodCorto === cleanTerm;
        });

        if (loteEncontrado) {
            console.log(`📦 [SCAN LOTE DIRECTO] Lote '${term}' en:`, ing.nombre);
            cargarArticulo(ing, 'lotes');
            sumarCajaLote(loteEncontrado.vinculo_id, 1);
            sonarBeep(1100, 0.09);
            mostrarToast(`📦 ${ing.nombre} -> +1 caja Lote #${loteEncontrado.id_corto}`);
            const inputLote = document.getElementById('buscador-lote-global');
            if (inputLote) inputLote.value = '';
            return;
        }
    }

    // 4. Fallback a búsqueda de texto
    buscarTextoAvanzado(term);
    const inputLote = document.getElementById('buscador-lote-global');
    if (inputLote) inputLote.value = '';
}

function manejarBusquedaDirecta(texto) {
    if (!texto) return;
    const term = texto.trim().toLowerCase();
    console.log("🔍 [BUSQUEDA DIRECTA] Analizando:", term);

    // 1. Coincidencia exacta de ingrediente
    const exacto = listaIngredientes.find(i =>
        String(i.codigo || '').toLowerCase() === term ||
        String(i.codigo_barras || '').toLowerCase() === term ||
        String(i.id) === term
    );

    if (exacto) {
        console.log("🎯 [MATCH EXACTO] Ingrediente encontrado:", exacto.nombre);
        cargarArticulo(exacto, 'balanza');
        const buscador = document.getElementById('buscador-movil');
        if (buscador) buscador.value = '';
        return;
    }

    // 2. Si ya hay un artículo activo abierto, solo procesar como lote si coincide con un lote de este artículo
    if (articuloActual && Array.isArray(articuloActual.lotes_contados)) {
        const cleanTerm = term.replace(/^l[:\s-]*/i, '').trim();
        const esLoteDelArticulo = articuloActual.lotes_contados.some(l => {
            const loteId = String(l.lote_id_supabase || '').toLowerCase();
            const idCorto = String(l.id_corto || '').toLowerCase();
            const loteCodCorto = String(l.lote_codigo_corto || '').toLowerCase();
            return loteId === term || loteId === cleanTerm || idCorto === term || idCorto === cleanTerm || loteCodCorto === term || loteCodCorto === cleanTerm;
        });
        if (esLoteDelArticulo) {
            procesarLoteArticuloActual(texto);
            const buscador = document.getElementById('buscador-movil');
            if (buscador) buscador.value = '';
            return;
        }
    }

    // 3. Fallback a búsqueda de texto
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
        items = items.filter(i => i.nombre.toLowerCase().includes(t) || String(i.codigo || '').includes(t));
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
                    COD: ${i.codigo || '-'}
                </div>
                <div class="badge-dual-pendientes">
                    <span class="badge-dual-kilos">⚖️ Sys: ${(i.stock_actual || 0).toFixed(2)} kg</span>
                    <span class="badge-dual-cajas">📦 Sys: ${parseFloat(i.stock_bultos || 0)} cj</span>
                </div>
            </div>
            <button class="item-action" onclick="solicitarImpresionItemLista(${i.id})">🖨️</button>
        </div>
    `).join('');
}

function renderizarListaContados() {
    const container = document.getElementById('lista-contados-container');
    if (!container) return;

    let items = listaIngredientes.filter(i => i.contado);

    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state-placeholder">Empieza a escanear para ver resultados aquí</div>`;
        return;
    }

    const reversed = [...items].reverse();

    container.innerHTML = reversed.map(i => {
        const lotesTxt = (i.lotes_contados || []).filter(l => (parseFloat(l.cajas_contadas) || 0) > 0)
            .map(l => `#${l.id_corto}: ${l.cajas_contadas} cj`).join(', ');

        return `
        <div class="item-card contado" style="border-left: 4px solid #22c55e;">
            <div class="item-info" onclick="seleccionarSugerencia(${i.id})">
                <h4>${i.nombre}</h4>
                <div class="item-meta" style="margin-top: 4px;">
                    <div style="font-size: 0.85rem; font-weight: 700; color: #15803d;">
                        ⚖️ Kilos: ${(i.kilos_sueltos_contados !== undefined ? i.kilos_sueltos_contados : (i.stock_contado || 0)).toFixed(2)} kg
                        &nbsp;|&nbsp; 📦 Bultos: ${i.total_bultos_contados || 0} cj
                    </div>
                    ${lotesTxt ? `<div style="font-size: 0.78rem; color: #7e22ce; font-weight: 600; margin-top: 1px;">🏷️ Lotes: ${lotesTxt}</div>` : ''}
                    <div style="color: #1e40af; font-weight: 700; font-size: 0.82rem; margin-top: 2px;">
                        🎯 Potencial Total: ${(i.stock_potencial_contado || 0).toFixed(2)} kg
                    </div>
                </div>
            </div>
            <div style="display: flex; gap: 4px; align-items: center;">
                <button class="item-action" onclick="seleccionarSugerencia(${i.id})" title="Editar Conteo">✏️</button>
                <button class="item-action" onclick="solicitarImpresionItemLista(${i.id})" title="Imprimir Etiqueta">🖨️</button>
            </div>
        </div>
        `;
    }).join('');
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

// Auto-flush determinista de cualquier cambio pendiente en la tarjeta activa
function autoFlushArticuloActual() {
    if (!articuloActual) return;
    const inputCant = document.getElementById('cantidad');
    const rawVal = inputCant ? inputCant.value : '';
    const hasKilos = rawVal.trim() !== '';
    const kilos = normalizarDecimalUniversal(rawVal);

    let totalCajas = 0;
    let totalKilosLotes = 0;
    if (articuloActual.lotes_contados && Array.isArray(articuloActual.lotes_contados)) {
        articuloActual.lotes_contados.forEach(l => {
            const cajas = normalizarDecimalUniversal(l.cajas_contadas) || 0;
            totalCajas += cajas;
            totalKilosLotes += (cajas * (normalizarDecimalUniversal(l.kilos_por_caja) || 0));
        });
    }

    const stockPotencial = kilos + totalKilosLotes;

    if (hasKilos || totalCajas > 0 || articuloActual.contado) {
        console.log(`💾 [AUTO-FLUSH MOVIL] Guardando conteo de ${articuloActual.nombre}: Kilos=${kilos}, Cajas=${totalCajas}, Potencial=${stockPotencial.toFixed(2)}`);
        articuloActual.kilos_sueltos_contados = kilos;
        articuloActual.stock_contado = kilos;
        articuloActual.total_bultos_contados = totalCajas;
        articuloActual.stock_potencial_contado = stockPotencial;
        articuloActual.contado = true;

        const idx = listaIngredientes.findIndex(i => i.id === articuloActual.id);
        if (idx !== -1) {
            listaIngredientes[idx].kilos_sueltos_contados = kilos;
            listaIngredientes[idx].stock_contado = kilos;
            listaIngredientes[idx].total_bultos_contados = totalCajas;
            listaIngredientes[idx].stock_potencial_contado = stockPotencial;
            listaIngredientes[idx].lotes_contados = JSON.parse(JSON.stringify(articuloActual.lotes_contados || []));
            listaIngredientes[idx].contado = true;
        }

        if (socket && socket.connected) {
            socket.emit('articulo_escaneado', {
                sessionId,
                ingrediente: { ...articuloActual },
                cantidad: kilos,
                finalizar_item: true
            });
        }

        persistirItemEnServidor(articuloActual, kilos, articuloActual.lotes_contados, totalCajas);
        actualizarProgreso();
    }
}
window.autoFlushArticuloActual = autoFlushArticuloActual;

// ------------------------------------------
// 🧠 LOGICA DE NEGOCIO: CONTEO DUAL
// ------------------------------------------
function cargarArticulo(item, modo = 'balanza') {
    if (!item) return;

    // Si ya había un artículo activo en pantalla diferente al nuevo, hacer auto-flush antes de desmontar
    if (articuloActual && articuloActual.id !== item.id) {
        autoFlushArticuloActual();
    }

    // Asegurar estructura de lotes_contados
    if (!item.lotes_contados || item.lotes_contados.length === 0) {
        const lotesBase = (item.lotes_cajas_cerradas || []).map(l => ({
            vinculo_id: l.vinculo_id || ('lote_' + (l.id_corto || Math.random().toString(36).substr(2, 5))),
            lote_id_supabase: l.lote_id_supabase,
            id_corto: l.id_corto || (l.lote_id_supabase ? l.lote_id_supabase.substring(0, 8) : 'LOTE'),
            lote_codigo_corto: l.lote_codigo_corto || l.id_corto || (l.lote_id_supabase ? l.lote_id_supabase.substring(0, 8) : 'LOTE'),
            cajas_sistema: parseFloat(l.cajas_disponibles || l.cantidad_asignada || 0),
            cajas_contadas: l.cajas_contadas !== undefined ? parseFloat(l.cajas_contadas) : 0,
            kilos_por_caja: parseFloat(l.kilos_por_caja || 0),
            costo_kilo: l.costo_kilo || 0
        }));
        item.lotes_contados = lotesBase;
    }

    articuloActual = item; // GLOBAL reference

    // 1. Mostrar Panel Info
    const panel = document.getElementById('info-articulo');
    if (panel) panel.style.display = 'block';
    const placeholder = document.getElementById('placeholder-carga');
    if (placeholder) placeholder.style.display = 'none';

    // 2. Llenar Metadatos
    document.getElementById('nombre-articulo').textContent = item.nombre;
    document.getElementById('codigo-articulo').textContent = `COD: ${item.codigo || item.id}`;
    document.getElementById('stock-sistema-badge').textContent = `Sys: ${(item.stock_actual || 0).toFixed(2)} kg | ${parseFloat(item.stock_bultos || 0)} cj`;
    const kilosSysLabel = document.getElementById('kilos-sys-label');
    if (kilosSysLabel) kilosSysLabel.textContent = `Sys: ${(item.stock_actual || 0).toFixed(2)} kg`;
    const unidadLabel = document.getElementById('unidad-label');
    if (unidadLabel) unidadLabel.textContent = item.unidad_medida || 'kg';

    // 3. Input Kilos Sueltos
    const inputCant = document.getElementById('cantidad');
    const kilosValor = item.kilos_sueltos_contados !== undefined ? item.kilos_sueltos_contados : (item.stock_contado || '');
    if (inputCant) {
        inputCant.value = kilosValor !== '' && kilosValor !== 0 ? kilosValor : '';
        inputCant.placeholder = `${(item.stock_actual || 0).toFixed(2)}`;
    }

    // Botón confirmar sugerido móvil
    const btnSugeridoMovil = document.getElementById('btn-confirmar-sugerido-movil');
    const txtSugeridoMovil = document.getElementById('txt-sugerido-kilos-movil');
    if (btnSugeridoMovil && txtSugeridoMovil) {
        const pesoSugerido = parseFloat(item.stock_actual || 0);
        txtSugeridoMovil.textContent = pesoSugerido.toFixed(2);
        btnSugeridoMovil.style.display = 'block';
        btnSugeridoMovil.onclick = () => window.confirmarKilosSugeridosMovil();
    }

    // 4. Renderizar Lotes / Bultos Cerrados
    renderizarLotesArticuloActual();

    // 5. Calcular Inicial y Totales
    calcularDiferenciaKilos();
    actualizarCalculoDual();

    // 6. Habilitar Botón Confirmar
    const btn = document.getElementById('btn-cargar');
    if (btn) {
        btn.disabled = false;
        btn.textContent = "CONFIRMAR CONTEO";
        btn.classList.remove('btn-success');
        btn.classList.add('btn-primary-block');
    }

    // 7. Manejo del foco y banners según MODO
    const inputScanLote = document.getElementById('input-scan-lote');
    const bannerLotes = document.getElementById('banner-instruccion-lote-movil');
    const seccionLotesBlock = document.getElementById('seccion-lotes-block');

    if (modo === 'lotes') {
        if (bannerLotes) {
            bannerLotes.style.display = 'block';
            bannerLotes.innerHTML = `🎯 <strong>MODO BULTOS:</strong> Dispará a la etiqueta de lote de cada bulto de <strong>${item.nombre}</strong> (+1 por disparo)`;
        }
        if (seccionLotesBlock) {
            seccionLotesBlock.style.boxShadow = '0 0 0 3px rgba(147, 51, 234, 0.4)';
            setTimeout(() => { if (seccionLotesBlock) seccionLotesBlock.style.boxShadow = 'none'; }, 2000);
        }
        if (inputScanLote) {
            setTimeout(() => {
                inputScanLote.focus();
                inputScanLote.select();
            }, 120);
        }
    } else {
        if (bannerLotes) bannerLotes.style.display = 'none';
        if (inputCant) {
            setTimeout(() => {
                inputCant.focus();
                inputCant.select();
            }, 120);
        }
    }
}

function renderizarLotesArticuloActual() {
    const container = document.getElementById('contenedor-lotes-articulo');
    if (!container || !articuloActual) return;

    container.innerHTML = '';
    const lotes = articuloActual.lotes_contados || [];

    if (lotes.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: #94a3b8; font-size: 0.85rem; padding: 8px;">
                Sin bultos cerrados asignados en el sistema
            </div>
        `;
        return;
    }

    lotes.forEach(lote => {
        const row = document.createElement('div');
        row.className = 'lote-counter-row';
        row.innerHTML = `
            <div class="lote-info-col">
                <div>
                    <span class="badge-lote">#${lote.id_corto}</span>
                    <strong style="font-size: 0.9rem; margin-left: 4px;">${lote.kilos_por_caja ? lote.kilos_por_caja.toFixed(1) + ' kg/cj' : 'Caja'}</strong>
                </div>
                <div class="lote-meta">
                    Sys: <strong>${lote.cajas_sistema} cj</strong> (${(lote.cajas_sistema * lote.kilos_por_caja).toFixed(1)} kg)
                </div>
            </div>
            <div class="lote-counter-controls">
                <button type="button" class="btn-lote-qty" onclick="sumarCajaLote('${lote.vinculo_id}', -1)">-</button>
                <input type="number" class="input-lote-cajas" id="input-lote-${lote.vinculo_id}" value="${lote.cajas_contadas || 0}" min="0" onchange="cambiarCajasLoteManual('${lote.vinculo_id}', this.value)">
                <button type="button" class="btn-lote-qty" onclick="sumarCajaLote('${lote.vinculo_id}', 1)">+</button>
                <button type="button" class="btn-lote-qty" style="background:#fee2e2; color:#b91c1c; border-color:#fca5a5; margin-left:4px;" title="Eliminar este lote" onclick="eliminarLoteMovil('${lote.vinculo_id}')">🗑️</button>
            </div>
        `;
        container.appendChild(row);
    });
}

window.eliminarLoteMovil = (vinculoId) => {
    if (!articuloActual || !articuloActual.lotes_contados) return;
    const idx = articuloActual.lotes_contados.findIndex(l => String(l.vinculo_id) === String(vinculoId));
    if (idx !== -1) {
        const borrado = articuloActual.lotes_contados.splice(idx, 1)[0];
        renderizarLotesArticuloActual();
        actualizarCalculoDual();
        emitirSincronizacionDual();
        mostrarToast(`🗑️ Lote descartado: #${borrado.id_corto || vinculoId}`);
    }
};

function emitirSincronizacionDual() {
    if (!articuloActual) return;
    const inputKilos = document.getElementById('cantidad');
    let kilosSueltos = normalizarDecimalUniversal(inputKilos ? inputKilos.value : '');

    let totalCajas = 0;
    let totalKilosLotes = 0;
    (articuloActual.lotes_contados || []).forEach(l => {
        const c = normalizarDecimalUniversal(l.cajas_contadas) || 0;
        totalCajas += c;
        totalKilosLotes += (c * (normalizarDecimalUniversal(l.kilos_por_caja) || 0));
    });

    const stockPotencial = kilosSueltos + totalKilosLotes;

    articuloActual.kilos_sueltos_contados = kilosSueltos;
    articuloActual.stock_contado = kilosSueltos;
    articuloActual.total_bultos_contados = totalCajas;
    articuloActual.stock_potencial_contado = stockPotencial;
    articuloActual.contado = true;

    // Actualizar inmediatamente en el array maestro local del móvil
    const idx = listaIngredientes.findIndex(i => i.id === articuloActual.id);
    if (idx !== -1) {
        listaIngredientes[idx].kilos_sueltos_contados = kilosSueltos;
        listaIngredientes[idx].stock_contado = kilosSueltos;
        listaIngredientes[idx].total_bultos_contados = totalCajas;
        listaIngredientes[idx].stock_potencial_contado = stockPotencial;
        listaIngredientes[idx].lotes_contados = JSON.parse(JSON.stringify(articuloActual.lotes_contados));
        listaIngredientes[idx].contado = true;
    }

    console.log(`📤 [SYNC DUAL INSTANTANEO] Emitiendo a PC y BD: ${articuloActual.nombre} | Kilos: ${kilosSueltos} | Bultos: ${totalCajas} | Potencial: ${stockPotencial.toFixed(2)} kg`);

    // 1. Emitir por WebSocket para vista en vivo en PC
    if (socket && socket.connected) {
        socket.emit('articulo_escaneado', {
            sessionId,
            ingrediente: {
                ...articuloActual,
                kilos_sueltos_contados: kilosSueltos,
                stock_contado: kilosSueltos,
                lotes_contados: articuloActual.lotes_contados,
                total_bultos_contados: totalCajas,
                stock_potencial_contado: stockPotencial,
                contado: true
            },
            cantidad: kilosSueltos,
            finalizar_item: false
        });
    }

    // 2. Persistencia reactiva automática en PostgreSQL (evita pérdida de datos si no tocan 'Guardar')
    persistirItemEnServidor(articuloActual, kilosSueltos, articuloActual.lotes_contados, totalCajas);

    actualizarProgreso();
}

window.sumarCajaLote = (vinculoId, delta) => {
    if (!articuloActual) return;
    if (!articuloActual.lotes_contados) articuloActual.lotes_contados = [];
    const idx = articuloActual.lotes_contados.findIndex(l => String(l.vinculo_id) === String(vinculoId));
    if (idx === -1) return;
    const lote = articuloActual.lotes_contados[idx];

    let nuevaCantidad = (normalizarDecimalUniversal(lote.cajas_contadas) || 0) + delta;
    if (nuevaCantidad <= 0) {
        nuevaCantidad = 0;
        const esSintetico = !lote.cajas_sistema || lote.cajas_sistema === 0 || String(lote.vinculo_id).startsWith('lote_');
        if (esSintetico && delta < 0) {
            articuloActual.lotes_contados.splice(idx, 1);
            renderizarLotesArticuloActual();
            actualizarCalculoDual();
            emitirSincronizacionDual();
            mostrarToast(`🗑️ Lote descartado: #${lote.id_corto}`);
            return;
        }
    }
    lote.cajas_contadas = nuevaCantidad;

    const inputEl = document.getElementById(`input-lote-${vinculoId}`);
    if (inputEl) {
        inputEl.value = nuevaCantidad;
        inputEl.style.backgroundColor = '#dcfce7';
        setTimeout(() => inputEl.style.backgroundColor = '#ffffff', 800);
    }

    actualizarCalculoDual();
    emitirSincronizacionDual();

    mostrarToast(`📦 Lote #${lote.id_corto}: ${nuevaCantidad} cj (${(nuevaCantidad * lote.kilos_por_caja).toFixed(1)} kg)`);
    if (navigator.vibrate) navigator.vibrate(100);

    // Mantener siempre el foco en el input de lote para disparos continuos
    const scanInput = document.getElementById('input-scan-lote');
    if (scanInput) setTimeout(() => scanInput.focus(), 30);
};

window.cambiarCajasLoteManual = (vinculoId, valor) => {
    if (!articuloActual || !articuloActual.lotes_contados) return;
    const lote = articuloActual.lotes_contados.find(l => String(l.vinculo_id) === String(vinculoId));
    if (!lote) return;

    let valNum = normalizarDecimalUniversal(valor) || 0;
    if (valNum < 0) valNum = 0;
    lote.cajas_contadas = valNum;

    actualizarCalculoDual();
    emitirSincronizacionDual();
};

function calcularDiferenciaKilos() {
    if (!articuloActual) return;
    const input = document.getElementById('cantidad');
    const bar = document.getElementById('diff-bar');
    const text = document.getElementById('diff-text');

    if (!input || input.value.trim() === '') {
        bar.className = 'diff-bar neutral';
        text.textContent = 'Ingrese kilos sueltos...';
        return;
    }

    let val = normalizarDecimalUniversal(input.value);
    const sys = normalizarDecimalUniversal(articuloActual.stock_actual || 0);
    const diff = val - sys;

    bar.className = `diff-bar ${diff >= 0 ? 'positive' : 'negative'}`;
    text.textContent = diff >= 0 ? `Sobra: +${diff.toFixed(2)} kg` : `Falta: ${diff.toFixed(2)} kg`;
}

function actualizarCalculoDual() {
    if (!articuloActual) return;

    const inputKilos = document.getElementById('cantidad');
    const kilosSueltos = normalizarDecimalUniversal(inputKilos ? inputKilos.value : '');

    let totalCajas = 0;
    let totalKilosLotes = 0;

    if (articuloActual.lotes_contados && Array.isArray(articuloActual.lotes_contados)) {
        articuloActual.lotes_contados.forEach(l => {
            const cajas = normalizarDecimalUniversal(l.cajas_contadas) || 0;
            const kgCaja = normalizarDecimalUniversal(l.kilos_por_caja) || 0;
            totalCajas += cajas;
            totalKilosLotes += (cajas * kgCaja);
        });
    }

    const stockPotencialTotal = kilosSueltos + totalKilosLotes;

    articuloActual.kilos_sueltos_contados = kilosSueltos;
    articuloActual.stock_contado = kilosSueltos;
    articuloActual.total_bultos_contados = totalCajas;
    articuloActual.stock_potencial_contado = stockPotencialTotal;

    // Actualizar inmediatamente en listaIngredientes en memoria
    const idx = listaIngredientes.findIndex(i => i.id === articuloActual.id);
    if (idx !== -1) {
        listaIngredientes[idx].kilos_sueltos_contados = kilosSueltos;
        listaIngredientes[idx].stock_contado = kilosSueltos;
        listaIngredientes[idx].total_bultos_contados = totalCajas;
        listaIngredientes[idx].stock_potencial_contado = stockPotencialTotal;
        listaIngredientes[idx].lotes_contados = JSON.parse(JSON.stringify(articuloActual.lotes_contados || []));
        if ((inputKilos && inputKilos.value.trim() !== '') || totalCajas > 0 || articuloActual.contado) {
            listaIngredientes[idx].contado = true;
            articuloActual.contado = true;
        }
    }

    const badgeCajas = document.getElementById('badge-total-cajas-contadas');
    if (badgeCajas) badgeCajas.textContent = `${totalCajas} cj`;

    const liveTotal = document.getElementById('total-potencial-live');
    if (liveTotal) {
        liveTotal.textContent = `${stockPotencialTotal.toFixed(2)} kg`;
    }
}

function resetearFormulario() {
    articuloActual = null;

    // Ocultar panel de datos
    const panel = document.getElementById('info-articulo');
    if (panel) panel.style.display = 'none';

    // Ocultar banner de lote
    const bannerLotes = document.getElementById('banner-instruccion-lote-movil');
    if (bannerLotes) bannerLotes.style.display = 'none';

    // Ocultar botón sugerido
    const btnSugeridoMovil = document.getElementById('btn-confirmar-sugerido-movil');
    if (btnSugeridoMovil) btnSugeridoMovil.style.display = 'none';

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
    const valorStr = input ? input.value.trim() : '';
    let kilosSueltos = normalizarDecimalUniversal(valorStr);

    let totalCajas = 0;
    let totalKilosLotes = 0;

    if (articuloActual.lotes_contados) {
        articuloActual.lotes_contados.forEach(l => {
            const cajas = normalizarDecimalUniversal(l.cajas_contadas) || 0;
            totalCajas += cajas;
            totalKilosLotes += (cajas * (normalizarDecimalUniversal(l.kilos_por_caja) || 0));
        });
    }

    const stockPotencialContado = kilosSueltos + totalKilosLotes;

    console.log(`📤 [CONFIRMAR DUAL] ${articuloActual.nombre}: Kilos=${kilosSueltos}, Cajas=${totalCajas}, Potencial=${stockPotencialContado}`);

    const payload = {
        sessionId,
        ingrediente: {
            ...articuloActual,
            kilos_sueltos_contados: kilosSueltos,
            stock_contado: kilosSueltos,
            lotes_contados: articuloActual.lotes_contados || [],
            total_bultos_contados: totalCajas,
            stock_potencial_contado: stockPotencialContado,
            contado: true
        },
        cantidad: kilosSueltos,
        finalizar_item: true
    };

    if (socket && socket.connected) {
        socket.emit('articulo_escaneado', payload);
    }

    articuloActual.kilos_sueltos_contados = kilosSueltos;
    articuloActual.stock_contado = kilosSueltos;
    articuloActual.total_bultos_contados = totalCajas;
    articuloActual.stock_potencial_contado = stockPotencialContado;
    articuloActual.contado = true;

    // Actualizar array en memoria
    const idx = listaIngredientes.findIndex(i => i.id === articuloActual.id);
    if (idx !== -1) {
        listaIngredientes[idx].kilos_sueltos_contados = kilosSueltos;
        listaIngredientes[idx].stock_contado = kilosSueltos;
        listaIngredientes[idx].total_bultos_contados = totalCajas;
        listaIngredientes[idx].stock_potencial_contado = stockPotencialContado;
        listaIngredientes[idx].lotes_contados = JSON.parse(JSON.stringify(articuloActual.lotes_contados || []));
        listaIngredientes[idx].contado = true;
    }

    // Persistir directamente a PostgreSQL
    persistirItemEnServidor(articuloActual, kilosSueltos, articuloActual.lotes_contados, totalCajas);

    actualizarProgreso();

    const btn = document.getElementById('btn-cargar');
    if (btn) {
        btn.textContent = "✅ GUARDADO";
        btn.classList.remove('btn-primary-block');
        btn.classList.add('btn-success');
    }

    setTimeout(() => {
        resetearFormulario();
        focarInputPrincipal();
    }, 600);
}

// ==========================================
// 🏁 FINALIZACIÓN DEL INVENTARIO
// ==========================================
window.solicitarFinalizarInventario = async () => {
    if (window._finalizandoMovilActivo) {
        console.warn("⚠️ [MOVIL FINALIZAR] Ya hay una finalización en curso, ignorando llamada duplicada");
        return;
    }

    const noContados = listaIngredientes.filter(i => !i.contado);
    let msgConfirm = "¿Desea finalizar el inventario y consolidar los ajustes de stock?";
    if (noContados.length > 0) {
        msgConfirm = `⚠️ Atención: Hay ${noContados.length} ingrediente(s) de los sectores seleccionados que no fueron contados.\n\nTodo ingrediente no contado se sincronizará automáticamente a CERO (0 kg / 0 bultos) por no tener existencia física en el depósito.\n\n¿Desea finalizar el inventario y aplicar los ajustes?`;
    }

    if (!confirm(msgConfirm)) {
        return;
    }

    window._finalizandoMovilActivo = true;

    // Auto-flush obligatorio si hay una tarjeta activa en pantalla antes de finalizar
    if (typeof autoFlushArticuloActual === 'function') {
        autoFlushArticuloActual();
    }

    // Ocultar modal si estuviera abierto
    const modalResumen = document.getElementById('modal-resumen');
    if (modalResumen) modalResumen.style.display = 'none';

    const btnFinalizar = document.getElementById('btn-finalizar-movil');
    if (btnFinalizar) {
        btnFinalizar.disabled = true;
        btnFinalizar.textContent = "⏳ Finalizando...";
    }
    mostrarToast("⏳ Guardando inventario...");

    try {
        console.log("🏁 [MOVIL FINALIZAR] Iniciando consolidación de inventario...");
        console.log("🆔 [MOVIL FINALIZAR] Session ID:", sessionId);
        console.log("📊 [MOVIL FINALIZAR] Total ingredientes en lista:", listaIngredientes.length);

        const ingredientesParaProcesar = listaIngredientes.map(ing => {
            if (ing.contado) {
                const kilosContados = normalizarDecimalUniversal(ing.kilos_sueltos_contados !== undefined ? ing.kilos_sueltos_contados : (ing.stock_contado || 0));
                const bultosContados = ing.total_bultos_contados !== undefined ? normalizarDecimalUniversal(ing.total_bultos_contados) : normalizarDecimalUniversal(ing.stock_bultos || 0);
                const lotesLimpios = (ing.lotes_contados || []).filter(l => {
                    const c = normalizarDecimalUniversal(l.cajas_contadas);
                    const sis = normalizarDecimalUniversal(l.cajas_sistema);
                    return c > 0 || sis > 0;
                });
                return {
                    ingrediente_id: ing.id,
                    stock_actual: normalizarDecimalUniversal(ing.stock_actual !== undefined ? ing.stock_actual : (ing.stock_sistema || 0)),
                    stock_bultos: normalizarDecimalUniversal(ing.stock_bultos || 0),
                    stock_contado: kilosContados,
                    kilos_sueltos_contados: kilosContados,
                    lotes_contados: lotesLimpios,
                    total_bultos_contados: bultosContados,
                    stock_potencial_contado: ing.stock_potencial_contado,
                    nombre: ing.nombre,
                    contado: true,
                    no_tocado: false
                };
            } else {
                // Ingrediente del sector NO contado: no existe físicamente en el depósito -> CERO (0 kg, 0 bultos)
                const stockKilosActual = normalizarDecimalUniversal(ing.stock_actual !== undefined ? ing.stock_actual : (ing.stock_sistema || 0));
                const stockBultosActual = normalizarDecimalUniversal(ing.stock_bultos || 0);
                return {
                    ingrediente_id: ing.id,
                    stock_actual: stockKilosActual,
                    stock_bultos: stockBultosActual,
                    stock_contado: 0,
                    kilos_sueltos_contados: 0,
                    total_bultos_contados: 0,
                    stock_potencial_contado: 0,
                    lotes_contados: [],
                    nombre: ing.nombre,
                    contado: true,
                    no_tocado: false,
                    no_encontrado_cero: true
                };
            }
        });

        const duracionTotal = detenerCronometroMovil();
        const fechaInicio = inicioTimestampMovil ? new Date(inicioTimestampMovil).toISOString() : null;

        const resAplicar = await fetch(`/api/produccion/inventario-ingredientes/${sessionId}/aplicar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ingredientes_contados: ingredientesParaProcesar,
                usuario_id: usuarioSesion?.id || 1,
                sectores: sectoresSesion || "TODOS",
                duracion_segundos: duracionTotal,
                fecha_inicio: fechaInicio
            })
        });

        if (!resAplicar.ok) {
            const errData = await resAplicar.json().catch(() => ({}));
            const msg = (errData.error && errData.detalle)
                ? `${errData.error}: ${errData.detalle}`
                : (errData.error || errData.detalle || "Error HTTP " + resAplicar.status + " al aplicar inventario");
            throw new Error(msg);
        }

        const resultado = await resAplicar.json();
        console.log("✅ [MOVIL FINALIZAR] Inventario aplicado con éxito:", resultado);

        // Notificar al socket para sincronizar con la PC
        if (socket && socket.connected) {
            socket.emit('notificar_fin_inventario', {
                sessionId,
                resultado
            });
        }

        // Mostrar modal con resultados y botón de PDF en el móvil
        mostrarModalFinInventarioMovil(resultado, sessionId);

    } catch (err) {
        console.error("❌ [MOVIL FINALIZAR] Error:", err);
        alert("❌ Error al finalizar inventario: " + err.message);
        window._finalizandoMovilActivo = false;
        if (btnFinalizar) {
            btnFinalizar.disabled = false;
            btnFinalizar.textContent = "🏁 Finalizar";
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

window.confirmarKilosSugeridosMovil = function () {
    if (!articuloActual) return;
    const pesoSugerido = parseFloat(articuloActual.stock_actual || 0);
    const inputCant = document.getElementById('cantidad');
    if (inputCant) {
        inputCant.value = pesoSugerido.toFixed(2);
    }
    articuloActual.kilos_sueltos_contados = pesoSugerido;
    articuloActual.stock_contado = pesoSugerido;
    calcularDiferenciaKilos();
    actualizarCalculoDual();
    emitirSincronizacionDual();

    sonarBeep(880, 0.08);
    mostrarToast(`✅ Peso confirmado (${pesoSugerido.toFixed(2)} kg)`);

    const inputScanLote = document.getElementById('input-scan-lote');
    if (inputScanLote) {
        setTimeout(() => {
            inputScanLote.focus();
            inputScanLote.select();
        }, 80);
    }
};

function mostrarModalFinInventarioMovil(resultado, targetSessionId) {
    const modal = document.getElementById('modal-resultado-movil');
    const finalSessionId = targetSessionId || (resultado ? resultado.session_id : null) || sessionId;

    if (!modal) {
        alert("✅ Inventario finalizado exitosamente.");
        if (finalSessionId) {
            window.open(`/api/produccion/inventario-ingredientes/${finalSessionId}/informe-pdf`, '_blank');
        }
        location.reload();
        return;
    }

    const items = resultado?.resumen_items || resultado?.ingredientes_contados || [];
    let totalItems = items.length;
    let totalAjustados = 0;
    let totalBultos = 0;

    items.forEach(it => {
        const kgSis = normalizarDecimalUniversal(it.kilos_sistema !== undefined ? it.kilos_sistema : (it.stock_anterior || it.stock_actual || 0));
        const kgCont = normalizarDecimalUniversal(it.kilos_contados !== undefined ? it.kilos_contados : (it.stock_contado !== undefined ? it.stock_contado : it.kilos_sueltos_contados || 0));
        const difKg = Math.abs(normalizarDecimalUniversal(it.diferencia_kilos !== undefined ? it.diferencia_kilos : (kgCont - kgSis)));

        const cjSis = normalizarDecimalUniversal(it.bultos_sistema !== undefined ? it.bultos_sistema : (it.stock_bultos_anterior || it.stock_bultos || 0));
        const cjCont = normalizarDecimalUniversal(it.bultos_contados !== undefined ? it.bultos_contados : (it.total_bultos_contados || 0));
        const difCj = Math.abs(normalizarDecimalUniversal(it.diferencia_bultos !== undefined ? it.diferencia_bultos : (cjCont - cjSis)));

        if (difKg > 0.001 || difCj > 0) totalAjustados++;
        totalBultos += cjCont;
    });

    const elTotal = document.getElementById('res-movil-total');
    if (elTotal) elTotal.textContent = totalItems || (resultado?.total_articulos || 0);

    const elAjust = document.getElementById('res-movil-ajustados');
    if (elAjust) elAjust.textContent = totalAjustados || (resultado?.ajustes_aplicados || 0);

    const elBultos = document.getElementById('res-movil-bultos');
    if (elBultos) elBultos.textContent = `${totalBultos} cj`;

    const durSegundos = detenerCronometroMovil();
    const elDuracion = document.getElementById('res-movil-duracion');
    if (elDuracion) {
        let durTexto = resultado?.duracion_texto;
        if (!durTexto && (resultado?.duracion_segundos || durSegundos)) {
            const seg = resultado?.duracion_segundos || durSegundos;
            const m = Math.floor(seg / 60);
            const s = seg % 60;
            durTexto = m > 0 ? `${m} min ${s} seg` : `${s} seg`;
        }
        elDuracion.textContent = durTexto || '--';
    }

    const btnPdf = document.getElementById('btn-abrir-pdf-movil');
    if (btnPdf) {
        btnPdf.onclick = () => {
            if (finalSessionId) {
                window.open(`/api/produccion/inventario-ingredientes/${finalSessionId}/informe-pdf`, '_blank');
            } else {
                alert("No se encontró la sesión para generar el PDF");
            }
        };
    }

    const btnCerrar = document.getElementById('btn-cerrar-resultado-movil');
    if (btnCerrar) {
        btnCerrar.onclick = () => {
            modal.style.display = 'none';
            location.reload();
        };
    }

    modal.style.display = 'flex';
}

console.log("🚀 [MOVIL] Functions exposed to window.");
