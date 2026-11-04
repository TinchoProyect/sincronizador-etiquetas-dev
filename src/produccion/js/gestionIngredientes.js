// ===== VARIABLES GLOBALES =====
// Variables para el inventario y ajustes de ingredientes
let usuarioSeleccionado = null;
let usuarioAjustes = null;
let ingredientesInventario = new Map(); // Mapa para almacenar los ingredientes escaneados
let ingredientesSeleccionados = new Map(); // Mapa para almacenar los ingredientes seleccionados para ajuste
let socket = null;
let sessionId = null;
let modoSeleccion = false;

// Variables para filtrado
let todosLosIngredientes = []; // Array para almacenar todos los ingredientes cargados
let ingredientesFiltrados = []; // Array para almacenar los ingredientes filtrados

// Variables para sectores
let todosLosSectores = []; // Array para almacenar todos los sectores disponibles

// Variables para cronómetro de inventario PC
let intervalCronometroPC = null;
let inicioTimestampPC = null;

function iniciarCronometroPC() {
    if (intervalCronometroPC) {
        clearInterval(intervalCronometroPC);
        intervalCronometroPC = null;
    }

    const guardadoTs = sessionStorage.getItem("inventario_inicio_ts");
    if (guardadoTs && !isNaN(parseInt(guardadoTs))) {
        inicioTimestampPC = parseInt(guardadoTs);
    } else {
        inicioTimestampPC = Date.now();
        sessionStorage.setItem("inventario_inicio_ts", inicioTimestampPC.toString());
    }

    const container = document.getElementById("cronometro-inventario-pc");
    const display = document.getElementById("display-tiempo-inventario-pc");
    if (container) container.style.display = "flex";

    const actualizar = () => {
        const diff = Math.max(0, Math.floor((Date.now() - inicioTimestampPC) / 1000));
        const h = String(Math.floor(diff / 3600)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
        const s = String(diff % 60).padStart(2, '0');
        if (display) display.textContent = `${h}:${m}:${s}`;
    };

    actualizar();
    intervalCronometroPC = setInterval(actualizar, 1000);
    console.log("⏱️ [CRONOMETRO-PC] Cronómetro iniciado a las:", new Date(inicioTimestampPC).toLocaleTimeString());
}

function detenerCronometroPC() {
    if (intervalCronometroPC) {
        clearInterval(intervalCronometroPC);
        intervalCronometroPC = null;
    }

    let totalSegundos = 0;
    if (inicioTimestampPC) {
        totalSegundos = Math.max(0, Math.floor((Date.now() - inicioTimestampPC) / 1000));
    }
    console.log(`⏱️ [CRONOMETRO-PC] Cronómetro detenido. Duración: ${totalSegundos} segundos`);
    return totalSegundos;
}

function limpiarCronometroPC() {
    detenerCronometroPC();
    inicioTimestampPC = null;
    sessionStorage.removeItem("inventario_inicio_ts");
    const container = document.getElementById("cronometro-inventario-pc");
    const display = document.getElementById("display-tiempo-inventario-pc");
    if (container) container.style.display = "none";
    if (display) display.textContent = "00:00:00";
}

// ===== FUNCIONES UTILITARIAS =====

// Normalizador universal de decimales (admite cadenas con comas o puntos indistintamente)
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
const normalizarDecimal = normalizarDecimalUniversal;
window.normalizarDecimalUniversal = normalizarDecimalUniversal;
window.normalizarDecimal = normalizarDecimalUniversal;

// Persistencia asíncrona unitaria directa en BD PostgreSQL desde PC (POST /registrar)
async function persistirItemEnServidorPC(item, kilosSueltos, lotesContados, totalBultos) {
    const idSesion = sessionId || window.sessionId || sessionStorage.getItem("inventario_session_id");
    if (!idSesion || !item || !item.id) return;
    try {
        const payload = {
            session_id: idSesion,
            ingrediente_id: item.id,
            stock_contado: kilosSueltos,
            kilos_sueltos_contados: kilosSueltos,
            lotes_contados: lotesContados || [],
            total_bultos_contados: totalBultos || 0,
            stock_potencial_contado: kilosSueltos + (totalBultos > 0 ? (item.stock_potencial_contado || kilosSueltos) : 0),
            codigo_barras: item.codigo || null
        };
        fetch(`/api/produccion/inventario-ingredientes/${idSesion}/registrar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(res => {
            if (res.ok) console.log(`💾 [AUTO-REGISTRAR PC] Item ${item.nombre} persistido en BD`);
            else console.warn(`⚠️ [AUTO-REGISTRAR PC] Status ${res.status}`);
        }).catch(err => console.warn(`⚠️ [AUTO-REGISTRAR PC] Error de red:`, err));
    } catch (e) {
        console.warn("⚠️ [AUTO-REGISTRAR PC] Excepción:", e);
    }
}

/**
 * Formatea un numero para mostrar de forma legible
 * - Redondea a 2 decimales maximo
 * - Elimina decimales innecesarios (.00)
 * - Maneja valores muy pequenos como 0
 * @param {number} valor - El valor numerico a formatear
 * @returns {string} - El valor formateado como string
 */
function formatearNumero(valor) {
    if (valor === null || valor === undefined || isNaN(valor)) {
        return "0";
    }

    const numero = Number(valor);

    // Si el valor es practicamente cero (debido a precision de punto flotante)
    if (Math.abs(numero) < 0.001) {
        return "0";
    }

    // Redondear a 2 decimales y eliminar ceros innecesarios
    return numero.toFixed(2).replace(/\.?0+$/, "");
}

// Funcion para mostrar mensajes
function mostrarMensaje(mensaje, tipo = "error") {
    console.log("📢 [MENSAJE] " + tipo.toUpperCase() + ": " + mensaje);

    const mensajeDiv = document.createElement("div");
    mensajeDiv.className = tipo === "error" ? "mensaje-error" : "mensaje-info";
    mensajeDiv.textContent = mensaje;

    // Remover mensaje anterior si existe
    const mensajeAnterior = document.querySelector(".mensaje-error, .mensaje-info");
    if (mensajeAnterior) {
        mensajeAnterior.remove();
    }

    const contentSection = document.querySelector(".content-section");
    if (contentSection) {
        contentSection.insertBefore(mensajeDiv, contentSection.firstChild);
    }

    // Remover el mensaje despues de 3 segundos
    setTimeout(() => {
        if (mensajeDiv.parentNode) {
            mensajeDiv.parentNode.removeChild(mensajeDiv);
        }
    }, 3000);
}

// ===== FUNCIONES DE TABLA Y FILTRADO =====

// ===== GESTIÓN DE SECTORES Y ACORDEONES (FASE LAMDA) =====
// Estado de acordeones: inicialmente vacío -> TODOS CONTRAÍDOS POR DEFECTO
const sectoresAbiertos = new Set();

// Variable global para controlar la inclusión de precios y costos en los informes PDF (Por defecto: FALSE / DESACTIVADO)
let incluirPreciosEnReporte = false;
let ultimoSectorReporteAbierto = 'TODOS';

window.togglePreciosReporte = function () {
    incluirPreciosEnReporte = !incluirPreciosEnReporte;
    window.actualizarBotonesPreciosReporte();

    // Si el modal de impresión está abierto, refrescar la vista previa en caliente
    const modal = document.getElementById('modal-impresion-sector');
    if (modal && modal.style.display !== 'none') {
        window.abrirReporteImpresionSector(ultimoSectorReporteAbierto);
    }
};

window.actualizarBotonesPreciosReporte = function () {
    const btnToolbar = document.getElementById('btn-toggle-precios-toolbar');
    const lblToolbar = document.getElementById('lbl-status-precios-toolbar');
    const icoToolbar = document.getElementById('icono-precios-toolbar');

    const btnModal = document.getElementById('btn-toggle-precios-modal');
    const lblModal = document.getElementById('lbl-status-precios-modal');
    const icoModal = document.getElementById('icono-precios-modal');

    if (incluirPreciosEnReporte) {
        if (btnToolbar) {
            btnToolbar.classList.add('activo');
            btnToolbar.title = 'Precios y costos ACTIVADOS en informes PDF. Haga clic para desactivar.';
        }
        if (lblToolbar) {
            lblToolbar.innerText = 'SÍ';
            lblToolbar.style.color = '#15803d';
        }
        if (icoToolbar) icoToolbar.innerText = '💰';

        if (btnModal) {
            btnModal.classList.add('activo');
            btnModal.title = 'Precios y costos ACTIVADOS en este informe. Haga clic para ocultar.';
        }
        if (lblModal) lblModal.innerText = 'SÍ';
        if (icoModal) icoModal.innerText = '💰';
    } else {
        if (btnToolbar) {
            btnToolbar.classList.remove('activo');
            btnToolbar.title = 'Precios y costos DESACTIVADOS en informes PDF (Predeterminado). Haga clic para activar.';
        }
        if (lblToolbar) {
            lblToolbar.innerText = 'NO';
            lblToolbar.style.color = '#64748b';
        }
        if (icoToolbar) icoToolbar.innerText = '💵';

        if (btnModal) {
            btnModal.classList.remove('activo');
            btnModal.title = 'Precios y costos OCULTOS en el informe (Predeterminado). Haga clic para incluir.';
        }
        if (lblModal) lblModal.innerText = 'NO';
        if (icoModal) icoModal.innerText = '💵';
    }
};

/**
 * Normaliza y extrae letra, nombre y clave de ordenamiento del sector de un ingrediente
 */
function obtenerInfoSector(ing) {
    let letra = '';
    let nombre = ing.sector_nombre || 'Sin Sector';
    let clave = 'ZZ_SIN_SECTOR';
    let titulo = 'Sin Sector Asignado';

    if (ing.sector_letra) {
        const partes = ing.sector_letra.split(' - ');
        if (partes.length >= 2) {
            letra = partes[0].trim().toUpperCase();
            nombre = partes.slice(1).join(' - ').trim();
            clave = letra;
            titulo = `Sector ${letra} — ${nombre}`;
        } else {
            letra = ing.sector_letra.trim().toUpperCase();
            clave = letra;
            titulo = `Sector ${letra}`;
        }
    } else if (ing.sector_descripcion) {
        const m = ing.sector_descripcion.match(/Sector\s*["']?([A-Za-z0-9])/i);
        if (m) {
            letra = m[1].toUpperCase();
            clave = letra;
            titulo = `Sector ${letra}${nombre ? ' — ' + nombre : ''}`;
        }
    }

    if (!letra) {
        letra = '?';
        clave = 'ZZ_SIN_SECTOR';
        titulo = 'Sin Sector Asignado';
    }

    return { letra, nombre, clave, titulo, sector_id: ing.sector_id };
}

// Controladores globales de acordeones
window.toggleAcordeonSector = function (clave) {
    const body = document.getElementById(`sector-body-${clave}`);
    const header = document.getElementById(`sector-header-${clave}`);
    if (!body || !header) return;

    if (sectoresAbiertos.has(clave)) {
        sectoresAbiertos.delete(clave);
        body.style.display = 'none';
        header.classList.remove('abierto');
    } else {
        sectoresAbiertos.add(clave);
        body.style.display = 'block';
        header.classList.add('abierto');
    }
};

window.toggleTodosAcordeones = function (expandir) {
    const cards = document.querySelectorAll('.sector-accordion-card');
    cards.forEach(card => {
        const header = card.querySelector('.sector-accordion-header');
        const body = card.querySelector('.sector-accordion-body');
        if (!header || !body) return;
        const clave = header.dataset.sectorClave;
        if (expandir) {
            sectoresAbiertos.add(clave);
            header.classList.add('abierto');
            body.style.display = 'block';
        } else {
            sectoresAbiertos.delete(clave);
            header.classList.remove('abierto');
            body.style.display = 'none';
        }
    });
};

/**
 * Actualiza la vista de inventario agrupando ingredientes por sector en acordeones
 * REGLA ESTRICTA: Los acordeones nacen contraídos y al buscar SE MANTIENEN CONTRAÍDOS.
 */
function actualizarTablaIngredientes(ingredientes) {
    const contenedor = document.getElementById("contenedor-sectores-acordeon");
    if (!contenedor) {
        console.error("❌ No se encontró contenedor con ID contenedor-sectores-acordeon");
        return;
    }

    // Calcular estadísticas globales
    const lista = Array.isArray(ingredientes) ? ingredientes : [];
    let globalKilos = 0;
    let globalBultos = 0;
    let globalPotencial = 0;

    lista.forEach(ing => {
        const k = parseFloat(ing.stock_actual) || 0;
        const b = parseFloat(ing.stock_bultos) || 0;
        const p = parseFloat(ing.stock_potencial !== undefined ? ing.stock_potencial : k) || 0;
        globalKilos += k;
        globalBultos += b;
        globalPotencial += p;
    });

    // Actualizar badges globales en la toolbar
    const bTotal = document.getElementById("total-ingredientes-badge");
    const bKilos = document.getElementById("total-kilos-global-badge");
    const bBultos = document.getElementById("total-bultos-global-badge");
    const bPotencial = document.getElementById("total-potencial-global-badge");

    if (bTotal) bTotal.innerText = `📦 ${lista.length} ingredientes`;
    if (bKilos) bKilos.innerText = `⚖️ ${formatearNumero(globalKilos)} kg abiertos`;
    if (bBultos) bBultos.innerText = `📦 ${formatearNumero(globalBultos)} cj cerradas`;
    if (bPotencial) bPotencial.innerText = `⚡ ${formatearNumero(globalPotencial)} kg total`;

    // Sincronizar estado visual del botón de precios en toolbar
    window.actualizarBotonesPreciosReporte();

    if (lista.length === 0) {
        contenedor.innerHTML = `
            <div style="background: white; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 40px 20px; text-align: center; color: #64748b;">
                <span style="font-size: 2.2rem; display: block; margin-bottom: 10px;">🔍</span>
                <strong style="font-size: 1.1rem; color: #1e293b; display: block;">No se encontraron ingredientes</strong>
                <p style="margin: 6px 0 0 0; font-size: 0.9rem;">Pruebe ajustando el texto de búsqueda o los filtros de stock.</p>
            </div>
        `;
        return;
    }

    // Mapa de totales originales por sector en la BD completa
    const totalesOriginalesPorSector = new Map();
    todosLosIngredientes.forEach(i => {
        const info = obtenerInfoSector(i);
        totalesOriginalesPorSector.set(info.clave, (totalesOriginalesPorSector.get(info.clave) || 0) + 1);
    });

    // Agrupar los ingredientes filtrados por sector
    const mapaSectores = new Map();
    lista.forEach(ing => {
        const info = obtenerInfoSector(ing);
        if (!mapaSectores.has(info.clave)) {
            mapaSectores.set(info.clave, {
                clave: info.clave,
                letra: info.letra,
                nombre: info.nombre,
                titulo: info.titulo,
                items: []
            });
        }
        mapaSectores.get(info.clave).items.push(ing);
    });

    // Ordenar sectores alfabéticamente (A, B, C ... ZZ_SIN_SECTOR al final)
    const clavesOrdenadas = Array.from(mapaSectores.keys()).sort((a, b) => {
        if (a === 'ZZ_SIN_SECTOR') return 1;
        if (b === 'ZZ_SIN_SECTOR') return -1;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    const textoFiltro = document.getElementById("filtro-nombre")?.value?.trim() || "";
    const stockFiltro = document.getElementById("filtro-stock")?.value || "todos";
    const esFiltroActivo = Boolean(textoFiltro || (stockFiltro !== "todos"));

    contenedor.innerHTML = "";

    clavesOrdenadas.forEach(clave => {
        const sec = mapaSectores.get(clave);
        const itemsSector = sec.items;
        const totalOriginal = totalesOriginalesPorSector.get(clave) || itemsSector.length;

        // Calcular subtotales del sector
        let secKilos = 0;
        let secBultos = 0;
        let secPotencial = 0;

        itemsSector.forEach(i => {
            const k = parseFloat(i.stock_actual) || 0;
            const b = parseFloat(i.stock_bultos) || 0;
            const p = parseFloat(i.stock_potencial !== undefined ? i.stock_potencial : k) || 0;
            secKilos += k;
            secBultos += b;
            secPotencial += p;
        });

        // REGLA FUNDAMENTAL: Preservar estado. Si no estaba abierto previamente por el usuario, PERMANECE CONTRAÍDO.
        const estaAbierto = sectoresAbiertos.has(clave);

        // Crear tarjeta del acordeón
        const card = document.createElement("div");
        card.className = "sector-accordion-card";
        card.id = `card-sector-${clave}`;

        // Construir filas de la tabla de este sector
        let filasHtml = "";
        itemsSector.forEach(ingrediente => {
            const stockKilos = parseFloat(ingrediente.stock_actual) || 0;
            const stockBultos = parseFloat(ingrediente.stock_bultos) || 0;
            const stockPotencial = parseFloat(ingrediente.stock_potencial !== undefined ? ingrediente.stock_potencial : stockKilos) || 0;
            const lotes = Array.isArray(ingrediente.lotes_cajas_cerradas) ? ingrediente.lotes_cajas_cerradas : [];

            let claseKilos = "badge-kilos-stock";
            if (Math.abs(stockKilos) <= 0.001) claseKilos += " cero";
            else if (stockKilos < 0) claseKilos += " negativo";

            let claseBultos = "badge-bultos-stock";
            if (stockBultos <= 0) claseBultos += " cero";

            let lotesHtml = '';
            const lotesDisponibles = lotes.filter(l => (parseFloat(l.cajas_disponibles || l.cantidad_asignada) || 0) > 0);
            if (lotesDisponibles.length > 0) {
                lotesHtml = lotesDisponibles.map(l => {
                    const cj = parseFloat(l.cajas_disponibles || l.cantidad_asignada) || 0;
                    const idLote = l.id_corto || l.lote_codigo_corto || (l.lote_id_supabase ? l.lote_id_supabase.substring(0, 8) : 'Lote');
                    const kgCj = l.kilos_por_caja ? ` (${(cj * parseFloat(l.kilos_por_caja)).toFixed(1)} kg)` : '';
                    return `<span class="badge-lote-pill" title="Lote #${idLote} - ${cj} cajas (${l.kilos_por_caja ? l.kilos_por_caja.toFixed(1) + ' kg/cj' : ''})">#${idLote}: <strong>${cj} cj</strong>${kgCj}</span>`;
                }).join(' ');
            } else if (stockBultos > 0) {
                lotesHtml = `<span style="color: #64748b; font-size: 0.8rem; font-style: italic;">Sin lote asignado (${stockBultos} cj)</span>`;
            } else {
                lotesHtml = `<span style="color: #cbd5e1; font-size: 0.85rem;">-</span>`;
            }

            const estaCheckeado = ingredientesSeleccionados.has(ingrediente.id.toString());

            filasHtml += `
                <tr>
                    <td class="checkbox-cell">
                        <input type="checkbox" 
                               class="checkbox-ingrediente" 
                               data-ingrediente="${ingrediente.id}" 
                               data-sector="${clave}"
                               ${estaCheckeado ? " checked" : ""}>
                    </td>
                    <td><strong style="color: #64748b; font-size: 0.9rem;">${ingrediente.id}</strong></td>
                    <td><strong style="color: #1e293b; font-size: 0.95rem;">${ingrediente.nombre}</strong></td>
                    <td><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; color: #475569;">${ingrediente.codigo || "-"}</code></td>
                    <td style="text-align: right;">
                        <span class="${claseKilos}">${formatearNumero(stockKilos)} ${ingrediente.unidad_medida || "kg"}</span>
                    </td>
                    <td style="text-align: right;">
                        <span class="${claseBultos}">${formatearNumero(stockBultos)} cj</span>
                    </td>
                    <td>${lotesHtml}</td>
                    <td style="text-align: right;">
                        <span class="badge-potencial-stock">${formatearNumero(stockPotencial)} kg</span>
                    </td>
                </tr>
            `;
        });

        // Etiqueta de cantidad (revela coincidencias si hay búsqueda activa)
        const etiquetaConteo = esFiltroActivo 
            ? `${itemsSector.length} de ${totalOriginal}` 
            : `${itemsSector.length} ingredientes`;

        card.innerHTML = `
            <div class="sector-accordion-header ${estaAbierto ? 'abierto' : ''}" 
                 id="sector-header-${clave}" 
                 data-sector-clave="${clave}" 
                 onclick="window.toggleAcordeonSector('${clave}')">
                <div class="sector-header-left">
                    <span class="sector-chevron">▶</span>
                    <span class="badge-sector-letra">Sector ${sec.letra}</span>
                    <span class="sector-nombre-text">${sec.nombre}</span>
                    <span class="badge-sector-count" title="${itemsSector.length} artículos en este sector">${etiquetaConteo}</span>
                </div>
                <div class="sector-header-right">
                    <span class="sector-metric-pill kilos" title="Stock en Balanza">⚖️ ${formatearNumero(secKilos)} kg</span>
                    <span class="sector-metric-pill bultos" title="Stock en Cajas Cerradas">📦 ${formatearNumero(secBultos)} cj</span>
                    <span class="sector-metric-pill potencial" title="Stock Total (Balanza + Cajas)">⚡ ${formatearNumero(secPotencial)} kg total</span>
                    <button type="button" class="btn-imprimir-sector" onclick="event.stopPropagation(); window.abrirReporteImpresionSector('${clave}')" title="Emitir informe oficial en PDF del Sector ${sec.letra}">
                        🖨️ Imprimir PDF
                    </button>
                </div>
            </div>

            <div class="sector-accordion-body" id="sector-body-${clave}" style="display: ${estaAbierto ? 'block' : 'none'};">
                <div style="overflow-x: auto;">
                    <table class="tabla-ingredientes tabla-ingredientes-sector ${modoSeleccion ? 'modo-seleccion' : ''}">
                        <thead>
                            <tr>
                                <th class="checkbox-cell">
                                    <input type="checkbox" class="check-sector-todos" data-sector="${clave}" title="Seleccionar todos los de este sector">
                                </th>
                                <th style="width: 60px;">ID</th>
                                <th>Nombre del Ingrediente</th>
                                <th style="width: 110px;">Código</th>
                                <th style="text-align: right; width: 140px;">⚖️ Kilos Abiertos</th>
                                <th style="text-align: right; width: 130px;">📦 Bultos Cerrados</th>
                                <th style="width: 260px;">🏷️ N° de Lote / Cajas</th>
                                <th style="text-align: right; width: 140px;">⚖️ Stock Total (kg)</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-sector-${clave}">
                            ${filasHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        contenedor.appendChild(card);
    });

    // Eventos de Checkbox Sectorial (Seleccionar todos los de este sector)
    const checksSector = contenedor.querySelectorAll(".check-sector-todos");
    checksSector.forEach(ch => {
        ch.addEventListener("change", function (e) {
            e.stopPropagation();
            const sectorClave = this.dataset.sector;
            const checkboxesDelSector = contenedor.querySelectorAll(`.checkbox-ingrediente[data-sector="${sectorClave}"]`);
            checkboxesDelSector.forEach(itemCh => {
                itemCh.checked = this.checked;
                const ingredienteId = itemCh.dataset.ingrediente;
                const ing = todosLosIngredientes.find(i => i.id.toString() === ingredienteId);
                if (this.checked && ing) {
                    ingredientesSeleccionados.set(ingredienteId, ing);
                } else {
                    ingredientesSeleccionados.delete(ingredienteId);
                }
            });
            console.log(`🔘 [SELECCION-SECTOR] Sector ${sectorClave}: ${this.checked ? 'todos seleccionados' : 'deseleccionados'}. Total: ${ingredientesSeleccionados.size}`);
        });
    });

    // Eventos de Checkbox Individual
    const checkboxes = contenedor.querySelectorAll(".checkbox-ingrediente");
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener("change", function (e) {
            e.stopPropagation();
            const ingredienteId = this.dataset.ingrediente;
            const ingrediente = todosLosIngredientes.find(i => i.id.toString() === ingredienteId);

            if (this.checked && ingrediente) {
                ingredientesSeleccionados.set(ingredienteId, ingrediente);
            } else {
                ingredientesSeleccionados.delete(ingredienteId);
            }
            console.log(`🔘 [SELECCION] Ingrediente ${ingredienteId}: ${this.checked ? 'seleccionado' : 'deseleccionado'}. Total: ${ingredientesSeleccionados.size}`);
        });
    });
}

// ===== MOTOR DE EMISIÓN DE REPORTES E INFORMES PDF OFICIALES LAMDA =====

/**
 * Abre el visor de impresión formal para un sector determinado o para el inventario completo
 * @param {string} claveSector - Clave del sector ('A', 'B', 'TODOS', etc.)
 */
window.abrirReporteImpresionSector = function (claveSector) {
    ultimoSectorReporteAbierto = claveSector || 'TODOS';
    const modal = document.getElementById('modal-impresion-sector');
    if (!modal) return;

    window.actualizarBotonesPreciosReporte();

    let items = [];
    let tituloSector = '';
    let letraSector = '';

    if (claveSector === 'TODOS') {
        items = [...todosLosIngredientes];
        tituloSector = 'INVENTARIO GENERAL CONSOLIDADO (TODOS LOS SECTORES)';
        letraSector = 'TODOS';
    } else {
        items = todosLosIngredientes.filter(i => {
            const info = obtenerInfoSector(i);
            return info.clave === claveSector;
        });
        const info = items.length > 0 
            ? obtenerInfoSector(items[0]) 
            : { letra: claveSector, nombre: claveSector, titulo: `Sector ${claveSector}` };
        tituloSector = info.titulo;
        letraSector = info.letra;
    }

    // Calcular KPIs
    let totalKilos = 0;
    let totalBultos = 0;
    let totalPotencial = 0;
    let totalValor = 0;
    const lotesSet = new Set();

    items.forEach(i => {
        const k = parseFloat(i.stock_actual) || 0;
        const b = parseFloat(i.stock_bultos) || 0;
        const p = parseFloat(i.stock_potencial !== undefined ? i.stock_potencial : k) || 0;
        const costo = parseFloat(i.costo_patron) || 0;
        totalKilos += k;
        totalBultos += b;
        totalPotencial += p;
        totalValor += (costo * p);

        const lotes = Array.isArray(i.lotes_cajas_cerradas) ? i.lotes_cajas_cerradas : [];
        lotes.forEach(l => {
            if ((parseFloat(l.cajas_disponibles || l.cantidad_asignada) || 0) > 0) {
                lotesSet.add(l.lote_id_supabase || l.id_corto || l.lote_codigo_corto || Math.random());
            }
        });
    });

    // Inyectar en encabezado del visor
    const tbTitle = document.getElementById('print-sector-toolbar-title');
    if (tbTitle) tbTitle.innerText = `🖨️ Vista Previa de Impresión Oficial — ${tituloSector}`;

    const docSector = document.getElementById('print-doc-sector');
    if (docSector) docSector.innerText = tituloSector;

    const docFecha = document.getElementById('print-doc-fecha');
    if (docFecha) docFecha.innerText = new Date().toLocaleString('es-AR');

    const docResp = document.getElementById('print-doc-responsable');
    if (docResp) docResp.innerText = (usuarioAjustes?.nombre_completo || usuarioSeleccionado?.nombre_completo || 'Taller LAMDA');

    // Inyectar KPIs
    const elItems = document.getElementById('print-kpi-items');
    if (elItems) elItems.innerText = items.length;

    const elKilos = document.getElementById('print-kpi-kilos');
    if (elKilos) elKilos.innerText = `${formatearNumero(totalKilos)} kg`;

    const elBultos = document.getElementById('print-kpi-bultos');
    if (elBultos) elBultos.innerText = `${formatearNumero(totalBultos)} cj`;

    const elLotes = document.getElementById('print-kpi-lotes');
    if (elLotes) elLotes.innerText = lotesSet.size;

    const elPotencial = document.getElementById('print-kpi-potencial');
    if (elPotencial) elPotencial.innerText = `${formatearNumero(totalPotencial)} kg`;

    // Manejo de Valorización Total según switch de precios
    const elValor = document.getElementById('print-kpi-valor');
    const boxValor = document.getElementById('print-kpi-box-valor');
    const kpisGrid = document.querySelector('.sheet-kpis-grid');

    if (boxValor) {
        boxValor.style.display = incluirPreciosEnReporte ? 'block' : 'none';
    }
    if (kpisGrid) {
        if (incluirPreciosEnReporte) {
            kpisGrid.classList.add('con-precios');
        } else {
            kpisGrid.classList.remove('con-precios');
        }
    }
    if (elValor) {
        elValor.innerText = totalValor > 0 
            ? `$${totalValor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
            : '$0.00';
    }

    const footerTime = document.getElementById('print-timestamp-footer');
    if (footerTime) footerTime.innerText = `Documento emitido el ${new Date().toLocaleString('es-AR')} • Sistema LAMDA`;

    // Renderizar Thead Dinámico según switch de precios
    const thead = document.getElementById('print-table-thead');
    if (thead) {
        thead.innerHTML = `
            <tr>
                <th style="width: 45px; text-align: center;">ID</th>
                <th style="width: 85px;">Código</th>
                <th>Nombre del Ingrediente</th>
                <th style="width: 105px; text-align: right;">⚖️ Kilos Abiertos</th>
                <th style="width: 85px; text-align: right;">📦 Bultos</th>
                <th style="width: 230px;">🏷️ N° de Lote / Cajas</th>
                <th style="width: 115px; text-align: right;">⚖️ Stock Total (kg)</th>
                ${incluirPreciosEnReporte ? `
                    <th style="width: 95px; text-align: right;">💲 Costo Base</th>
                    <th style="width: 110px; text-align: right;">💰 Total Valor</th>
                ` : ''}
            </tr>
        `;
    }

    // Renderizar Filas de Tabla Imprimible
    const tbody = document.getElementById('print-table-tbody');
    if (tbody) {
        tbody.innerHTML = '';
        items.forEach(ing => {
            const k = parseFloat(ing.stock_actual) || 0;
            const b = parseFloat(ing.stock_bultos) || 0;
            const p = parseFloat(ing.stock_potencial !== undefined ? ing.stock_potencial : k) || 0;
            const costo = parseFloat(ing.costo_patron) || 0;
            const valorItem = costo * p;
            const lotes = Array.isArray(ing.lotes_cajas_cerradas) ? ing.lotes_cajas_cerradas : [];
            const lotesDisponibles = lotes.filter(l => (parseFloat(l.cajas_disponibles || l.cantidad_asignada) || 0) > 0);

            let lotesTxt = '-';
            if (lotesDisponibles.length > 0) {
                lotesTxt = lotesDisponibles.map(l => {
                    const cj = parseFloat(l.cajas_disponibles || l.cantidad_asignada) || 0;
                    const idLote = l.id_corto || l.lote_codigo_corto || (l.lote_id_supabase ? l.lote_id_supabase.substring(0, 8) : 'Lote');
                    const kgTxt = l.kilos_por_caja ? ` (${(cj * parseFloat(l.kilos_por_caja)).toFixed(1)} kg)` : '';
                    return `#${idLote}: ${cj} cj${kgTxt}`;
                }).join(' | ');
            } else if (b > 0) {
                lotesTxt = `${b} cj s/lote`;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center; color: #64748b; font-weight: bold;">${ing.id}</td>
                <td style="font-family: monospace; color: #475569;">${ing.codigo || '-'}</td>
                <td><strong>${ing.nombre}</strong></td>
                <td style="text-align: right; font-weight: 600; color: ${k > 0 ? '#166534' : '#64748b'};">${formatearNumero(k)} ${ing.unidad_medida || 'kg'}</td>
                <td style="text-align: right; font-weight: 600; color: ${b > 0 ? '#7e22ce' : '#64748b'};">${formatearNumero(b)} cj</td>
                <td style="font-size: 0.72rem; color: #334155;">${lotesTxt}</td>
                <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatearNumero(p)} kg</td>
                ${incluirPreciosEnReporte ? `
                    <td style="text-align: right; color: #64748b;">${costo > 0 ? `$${costo.toFixed(2)}` : '-'}</td>
                    <td style="text-align: right; font-weight: 700; color: #0284c7;">${valorItem > 0 ? `$${valorItem.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}</td>
                ` : ''}
            `;
            tbody.appendChild(tr);
        });
    }

    // Fila de Totales Dinámica
    const tfoot = document.getElementById('print-table-tfoot');
    if (tfoot) {
        tfoot.innerHTML = `
            <tr>
                <td colspan="3" style="font-weight: 800; text-transform: uppercase;">TOTALES CONSOLIDADOS (${items.length} artículos)</td>
                <td style="text-align: right; font-weight: 800; color: #166534;">${formatearNumero(totalKilos)} kg</td>
                <td style="text-align: right; font-weight: 800; color: #7e22ce;">${formatearNumero(totalBultos)} cj</td>
                <td></td>
                <td style="text-align: right; font-weight: 900; color: #0f172a;">${formatearNumero(totalPotencial)} kg</td>
                ${incluirPreciosEnReporte ? `
                    <td></td>
                    <td style="text-align: right; font-weight: 900; color: #0284c7;">${totalValor > 0 ? `$${totalValor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00'}</td>
                ` : ''}
            </tr>
        `;
    }

    modal.style.display = 'flex';
};

window.ejecutarImpresionSector = function () {
    window.print();
};

window.cerrarReporteImpresionSector = function () {
    const modal = document.getElementById('modal-impresion-sector');
    if (modal) modal.style.display = 'none';
};

window.imprimirInventarioCompleto = function () {
    window.abrirReporteImpresionSector('TODOS');
};

// Funciones de filtrado (Space AND logic + Numeric/Barcode support + Lotes)
function filtrarPorNombre(ingredientes, texto) {
    if (!texto) return ingredientes;
    const terminos = texto.toLowerCase().trim().split(' ').filter(t => t.length > 0);

    return ingredientes.filter(ing => {
        const nombre = (ing.nombre || '').toLowerCase();
        const codigo = String(ing.codigo || '').toLowerCase();
        const lotes = Array.isArray(ing.lotes_cajas_cerradas) ? ing.lotes_cajas_cerradas : [];
        const lotesTexto = lotes.map(l => `${l.id_corto || ''} ${l.lote_codigo_corto || ''} ${l.lote_id_supabase || ''}`).join(' ').toLowerCase();

        // Si es numérico exacto, priorizar barcode/código (pistola)
        if (terminos.length === 1 && /^\d+$/.test(terminos[0])) {
            if (codigo === terminos[0]) return true;
        }

        // Búsqueda "Space AND" en Nombre, Código y Lotes
        return terminos.every(t => nombre.includes(t) || codigo.includes(t) || lotesTexto.includes(t));
    });
}

function filtrarPorStock(ingredientes, condicion) {
    console.log("🔍 [DEBUG] filtrarPorStock - Iniciando filtrado:", condicion);

    const UMBRAL_CERO = 0.001;
    let resultado;

    switch (condicion) {
        case "igual-cero":
            resultado = ingredientes.filter(ingrediente => {
                const stockKilos = parseFloat(ingrediente.stock_actual) || 0;
                const stockBultos = parseFloat(ingrediente.stock_bultos) || 0;
                const stockPotencial = parseFloat(ingrediente.stock_potencial) || 0;
                return Math.abs(stockKilos) <= UMBRAL_CERO && stockBultos <= 0 && stockPotencial <= UMBRAL_CERO;
            });
            break;
        case "mayor-cero":
            resultado = ingredientes.filter(ingrediente => {
                const stockKilos = parseFloat(ingrediente.stock_actual) || 0;
                const stockBultos = parseFloat(ingrediente.stock_bultos) || 0;
                const stockPotencial = parseFloat(ingrediente.stock_potencial) || 0;
                return stockKilos > UMBRAL_CERO || stockBultos > 0 || stockPotencial > UMBRAL_CERO;
            });
            break;
        case "menor-cero":
            resultado = ingredientes.filter(ingrediente => {
                const stockKilos = parseFloat(ingrediente.stock_actual) || 0;
                return stockKilos < -UMBRAL_CERO;
            });
            break;
        default:
            resultado = ingredientes;
    }

    console.log("✅ [DEBUG] filtrarPorStock - Resultados:", resultado.length);
    return resultado;
}

function aplicarFiltros() {
    console.log("🔍 [DEBUG] aplicarFiltros - Iniciando aplicacion de filtros");

    const textoFiltro = document.getElementById("filtro-nombre")?.value || "";
    const stockFiltro = document.getElementById("filtro-stock")?.value || "todos";

    console.log("🔍 [DEBUG] Filtros actuales:");
    console.log("- Texto:", textoFiltro);
    console.log("- Stock:", stockFiltro);
    console.log("- Total ingredientes antes de filtrar:", todosLosIngredientes.length);

    let ingredientesFiltrados = [...todosLosIngredientes];

    // Aplicar filtro de nombre
    if (textoFiltro) {
        console.log("📝 [DEBUG] Aplicando filtro por nombre:", textoFiltro);
        ingredientesFiltrados = filtrarPorNombre(ingredientesFiltrados, textoFiltro);
        console.log("📝 [DEBUG] Ingredientes despues de filtrar por nombre:", ingredientesFiltrados.length);
    }

    // Aplicar filtro de stock
    if (stockFiltro !== "todos") {
        console.log("📊 [DEBUG] Aplicando filtro por stock:", stockFiltro);
        ingredientesFiltrados = filtrarPorStock(ingredientesFiltrados, stockFiltro);
        console.log("📊 [DEBUG] Ingredientes despues de filtrar por stock:", ingredientesFiltrados.length);
    }

    console.log("✅ [DEBUG] Filtrado completado");
    console.log("✅ [DEBUG] Total ingredientes despues de filtrar:", ingredientesFiltrados.length);

    // Actualizar la tabla con los resultados filtrados
    actualizarTablaIngredientes(ingredientesFiltrados);
}

// ===== FUNCIONES DE CARGA DE DATOS =====

// Funcion para cargar los ingredientes
async function cargarIngredientes() {
    try {
        console.log("🔄 [CARGA] Cargando ingredientes...");
        const response = await fetch("/api/produccion/ingredientes");

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Error al obtener los ingredientes");
        }

        const ingredientes = await response.json();
        console.log("✅ [CARGA] Ingredientes cargados:", ingredientes.length);

        // Almacenar todos los ingredientes globalmente
        todosLosIngredientes = ingredientes;

        // Mostrar los ingredientes en la tabla
        actualizarTablaIngredientes(ingredientes);

    } catch (error) {
        console.error("❌ [CARGA] Error al cargar ingredientes:", error);
        mostrarMensaje(error.message || "No se pudieron cargar los ingredientes");
    }
}

async function cargarUsuarios() {
    try {
        console.log("🔄 [USUARIOS] Cargando usuarios...");

        const response = await fetch("/api/usuarios?rol=3&activo=true");
        if (!response.ok) throw new Error("Error al cargar usuarios");

        const usuarios = await response.json();
        const select = document.getElementById("select-usuario");
        if (select) {
            select.innerHTML = "<option value=\"\">-- Seleccionar usuario --</option>";

            usuarios.forEach(usuario => {
                const option = document.createElement("option");
                option.value = usuario.id;
                option.textContent = usuario.nombre_completo;
                select.appendChild(option);
            });
        }

        console.log("✅ [USUARIOS] Usuarios cargados:", usuarios.length);

    } catch (error) {
        console.error("❌ [USUARIOS] Error al cargar usuarios:", error);
        mostrarMensaje("No se pudieron cargar los usuarios");
    }
}

/**
 * Carga los sectores desde la API
 */
async function cargarSectores() {
    try {
        console.log("🔄 [SECTORES] ===== INICIANDO CARGA DE SECTORES =====");
        console.log("🔄 [SECTORES] Timestamp:", new Date().toISOString());
        console.log("🔄 [SECTORES] URL del endpoint:", "/api/produccion/sectores");
        console.log("🔄 [SECTORES] Realizando fetch...");

        const response = await fetch("/api/produccion/sectores");

        console.log("📡 [SECTORES] Respuesta recibida:");
        console.log("- Status:", response.status);
        console.log("- Status Text:", response.statusText);
        console.log("- OK:", response.ok);
        console.log("- Headers:", Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
            console.error("❌ [SECTORES] Respuesta no exitosa del servidor");
            console.error("❌ [SECTORES] Status completo:", response.status, response.statusText);

            // Intentar leer el cuerpo del error
            let errorBody = "No se pudo leer el cuerpo del error";
            try {
                errorBody = await response.text();
                console.error("❌ [SECTORES] Cuerpo del error:", errorBody);
            } catch (e) {
                console.error("❌ [SECTORES] Error al leer cuerpo del error:", e);
            }

            throw new Error("Error HTTP " + response.status + ": " + response.statusText + " - " + errorBody);
        }

        console.log("✅ [SECTORES] Respuesta exitosa, parseando JSON...");
        const sectores = await response.json();

        console.log("🎉 [SECTORES] ===== SECTORES CARGADOS EXITOSAMENTE =====");
        console.log("📊 [SECTORES] Total de sectores recibidos:", sectores.length);
        console.log("📋 [SECTORES] Lista completa de sectores:");

        sectores.forEach((sector, index) => {
            console.log("  " + (index + 1) + ". ID: " + sector.id + " | Nombre: \"" + sector.nombre + "\" | Descripcion: \"" + (sector.descripcion || "Sin descripcion") + "\"");
        });

        // Almacenar sectores en variable global
        todosLosSectores = sectores;
        console.log("💾 [SECTORES] Sectores almacenados en variable global todosLosSectores");
        console.log("💾 [SECTORES] Verificacion - todosLosSectores.length:", todosLosSectores.length);

        return sectores;
    } catch (error) {
        console.error("❌ [SECTORES] ===== ERROR AL CARGAR SECTORES =====");
        console.error("❌ [SECTORES] Tipo de error:", error.constructor.name);
        console.error("❌ [SECTORES] Mensaje de error:", error.message);
        console.error("❌ [SECTORES] Stack trace:", error.stack);

        // Informacion adicional para debugging
        console.error("🔍 [SECTORES] Informacion de debugging:");
        console.error("- URL intentada:", "/api/produccion/sectores");
        console.error("- Timestamp del error:", new Date().toISOString());
        console.error("- User Agent:", navigator.userAgent);
        console.error("- Location:", window.location.href);

        // Devolver array vacio en caso de error
        todosLosSectores = [];
        console.log("💾 [SECTORES] Variable global todosLosSectores reiniciada a array vacio");

        return [];
    }
}

// ===== FUNCIONES DE MODAL DE INVENTARIO =====

function mostrarModal() {
    console.log("🔄 [MODAL] Mostrando modal de inventario");

    const modal = document.getElementById("modal-inventario");
    if (modal) {
        modal.style.display = "block";

        const pasoUsuario = document.getElementById("paso-usuario");
        const pasoConteo = document.getElementById("paso-conteo");

        if (pasoUsuario) pasoUsuario.style.display = "block";
        if (pasoConteo) pasoConteo.style.display = "none";

        cargarUsuarios();
    }
}

function cerrarModal() {
    console.log("🔄 [MODAL] Cerrando modal de inventario");

    const modal = document.getElementById("modal-inventario");
    if (modal) {
        modal.style.display = "none";
    }
    reiniciarInventario();
}

function reiniciarInventario() {
    console.log("🧹 [INVENTARIO] Reiniciando inventario...");

    usuarioSeleccionado = null;
    ingredientesInventario.clear();

    const selectUsuario = document.getElementById("select-usuario");
    const inputCodigo = document.getElementById("input-codigo-barras");
    const contenedorIngredientes = document.getElementById("ingredientes-inventario");
    const btnContinuar = document.getElementById("btn-continuar-usuario");

    if (selectUsuario) selectUsuario.value = "";
    if (inputCodigo) inputCodigo.value = "";
    if (contenedorIngredientes) contenedorIngredientes.innerHTML = "";
    if (btnContinuar) btnContinuar.disabled = true;

    // Cerrar conexion WebSocket si existe
    if (socket) {
        console.log("🧹 [INVENTARIO] Cerrando conexion WebSocket");
        socket.emit("finalizar_inventario", { sessionId });
        socket.disconnect();
        socket = null;
    }
    sessionId = null;
    sessionStorage.removeItem("usuarioInventario");
    limpiarCronometroPC();

    console.log("✅ [INVENTARIO] Inventario reiniciado completamente");
}

/**
 * Muestra el paso de seleccion de sectores
 */
async function mostrarPasoSectores() {
    console.log("🏢 [SECTORES] Mostrando paso de seleccion de sectores");

    // Ocultar paso de usuario y mostrar paso de sectores
    const pasoUsuario = document.getElementById("paso-usuario");
    const pasoSectores = document.getElementById("paso-sectores");

    if (pasoUsuario) pasoUsuario.style.display = "none";
    if (pasoSectores) pasoSectores.style.display = "block";

    try {
        // Cargar sectores desde backend
        console.log("🔄 [SECTORES] Cargando sectores desde API...");
        await cargarSectores();

        // Mostrar checkboxes de sectores
        console.log("🔄 [SECTORES] Llamando a mostrarCheckboxesSectores...");
        mostrarCheckboxesSectores();

        console.log("✅ [SECTORES] Paso de sectores mostrado correctamente");
    } catch (error) {
        console.error("❌ [SECTORES] Error al mostrar paso de sectores:", error);
        mostrarMensaje("Error al cargar sectores: " + error.message, "error");
    }
}

/**
 * Muestra los checkboxes de sectores en el contenedor correspondiente
 */
function mostrarCheckboxesSectores() {
    console.log("🔄 [SECTORES] mostrarCheckboxesSectores llamada");
    console.log("📊 [SECTORES] Sectores disponibles para mostrar: " + todosLosSectores.length);

    const contenedor = document.getElementById("sectores-checkboxes");
    if (!contenedor) {
        console.error("❌ [SECTORES] No se encontro el contenedor #sectores-checkboxes");
        return;
    }

    // Limpiar contenedor
    contenedor.innerHTML = "";

    if (todosLosSectores.length === 0) {
        console.log("⚠️ [SECTORES] No hay sectores para mostrar");
        contenedor.innerHTML = "<p style=\"color: #666; font-style: italic;\">No hay sectores disponibles</p>";
        return;
    }

    console.log("✅ [SECTORES] Renderizando sectores agrupados");

    // Agrupar sectores por fecha de ultimo inventario
    const grupos = {};
    const opcionesFecha = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const formateador = new Intl.DateTimeFormat('es-AR', opcionesFecha);

    todosLosSectores.forEach(sector => {
        let claveGrupo = "Sin inventario previo";
        let responsableGrupo = null;
        let timestamp = 0;
        
        if (sector.fecha_ultimo_inventario) {
            const fecha = new Date(sector.fecha_ultimo_inventario);
            timestamp = fecha.getTime();
            // Formatear nativo
            const formateado = formateador.format(fecha).replace(/,/g, '');
            // Capitalizar ("sábado 2 de mayo" -> "Sábado 2 de Mayo")
            const palabras = formateado.split(' ').map(p => {
                if(p.toLowerCase() === 'de' || p.toLowerCase() === 'el' || p.toLowerCase() === 'la') return p.toLowerCase();
                return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
            });
            const fechaCapitalizada = palabras.join(' ');
            responsableGrupo = sector.usuario_ultimo_inventario || "Desconocido";
            claveGrupo = `${fechaCapitalizada}|${responsableGrupo}`;
        }

        if (!grupos[claveGrupo]) {
            grupos[claveGrupo] = {
                sectores: [],
                timestamp: timestamp,
                fechaFormateada: claveGrupo.split('|')[0],
                responsable: responsableGrupo
            };
        }
        grupos[claveGrupo].sectores.push(sector);
    });

    // Ordenar grupos por fecha descendente (los más recientes primero) y "Sin inventario" al final
    const clavesOrdenadas = Object.keys(grupos).sort((a, b) => {
        if (a === "Sin inventario previo") return 1;
        if (b === "Sin inventario previo") return -1;
        return grupos[b].timestamp - grupos[a].timestamp;
    });

    // Renderizar grupos
    clavesOrdenadas.forEach(clave => {
        const grupo = grupos[clave];
        
        // Encabezado de grupo
        const headerGrupo = document.createElement("h5");
        headerGrupo.style.cssText = "margin-top: 15px; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px; color: #444; font-size: 14px;";
        
        if (clave === "Sin inventario previo") {
            headerGrupo.innerHTML = "⚠️ " + clave;
        } else {
            headerGrupo.innerHTML = `📅 Último inventario: ${grupo.fechaFormateada} - <span style="color: #666; font-size: 0.9em;">👤 Responsable: ${grupo.responsable}</span>`;
        }
        contenedor.appendChild(headerGrupo);

        // Crear checkboxes para cada sector del grupo
        grupo.sectores.forEach(sector => {
            const checkboxDiv = document.createElement("div");
            checkboxDiv.className = "sector-checkbox-item";
            checkboxDiv.style.cssText = "margin-bottom: 8px; display: flex; align-items: center;";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.id = "sector-" + sector.id;
            checkbox.className = "sector-checkbox";
            checkbox.setAttribute("data-sector-id", sector.id);
            checkbox.style.cssText = "margin-right: 8px;";

            const label = document.createElement("label");
            label.htmlFor = "sector-" + sector.id;
            label.textContent = sector.nombre;
            label.style.cssText = "cursor: pointer; user-select: none; font-weight: 500;";

            // Agregar descripcion si existe
            if (sector.descripcion && sector.descripcion.trim() !== "") {
                const descripcion = document.createElement("small");
                descripcion.textContent = " (" + sector.descripcion + ")";
                descripcion.style.cssText = "color: #666; margin-left: 4px; font-weight: normal;";
                label.appendChild(descripcion);
            }

            checkboxDiv.appendChild(checkbox);
            checkboxDiv.appendChild(label);
            contenedor.appendChild(checkboxDiv);
            
            console.log("📋 [SECTORES] Checkbox creado: " + sector.nombre + " (ID: " + sector.id + ")");
        });
    });

    // Agregar event listener para el checkbox "Todos los sectores"
    const checkboxTodos = document.getElementById("todos-sectores");
    if (checkboxTodos) {
        checkboxTodos.addEventListener("change", function () {
            const sectoresCheckboxes = document.querySelectorAll(".sector-checkbox");

            if (this.checked) {
                console.log("🔄 [SECTORES] 'Todos los sectores' marcado - Desmarcando específicos");
                // Desmarcar todos los específicos pero mantenerlos habilitados
                sectoresCheckboxes.forEach(checkbox => {
                    checkbox.checked = false;
                    checkbox.disabled = false; // Asegurar que estén habilitados
                });
            } else {
                console.log("🔄 [SECTORES] 'Todos los sectores' desmarcado");
                // No action needed, user can select manually
            }
        });
    }

    // Agregar listeners a los checkboxes individuales para desmarcar "Todos"
    const checkboxesIndividuales = document.querySelectorAll(".sector-checkbox");
    checkboxesIndividuales.forEach(cb => {
        cb.addEventListener('change', function () {
            if (this.checked && checkboxTodos && checkboxTodos.checked) {
                console.log("🔄 [SECTORES] Sector individual marcado - Desmarcando 'Todos'");
                checkboxTodos.checked = false;
            }
        });
    });


    console.log("✅ [SECTORES] " + todosLosSectores.length + " checkboxes de sectores renderizados correctamente");
}

function mostrarPasoConteo() {
    console.log("🔄 [CONTEO] Mostrando paso de conteo");
    window._finalizandoInventarioActivo = false;

    // 1. Configurar UI del Panel (Tabs, Botones, mostrar div correcto)
    configurarPanelControlUI();
    configurarEscaneoDualPC();

    // PRIMERO: Guardar el usuario seleccionado en la sesion
    const selectUsuario = document.getElementById("select-usuario");
    if (selectUsuario && selectUsuario.selectedIndex > 0) {
        const usuarioNombre = selectUsuario.options[selectUsuario.selectedIndex].text;
        sessionStorage.setItem("usuarioInventario", JSON.stringify({
            id: usuarioSeleccionado,
            nombre: usuarioNombre
        }));
    }

    // MOSTRAR INFORMACION DE SECTORES SELECCIONADOS
    mostrarInfoSectoresInventario();

    // DESPUES: Inicializar WebSocket para ingredientes
    inicializarWebSocketIngredientes();

    // Iniciar cronómetro de inventario en vivo PC
    iniciarCronometroPC();

    const inputBalanza = document.getElementById("buscador-pc");
    if (inputBalanza) {
        setTimeout(() => inputBalanza.focus(), 150);
    }
}

/**
 * Muestra la informacion de sectores seleccionados en el paso de conteo
 */
function mostrarInfoSectoresInventario() {
    console.log("🏢 [INFO-SECTORES] ===== MOSTRANDO INFORMACION DE SECTORES =====");

    const sectoresInfo = sessionStorage.getItem("sectoresInventario");
    const sectoresTextoElement = document.getElementById("sectores-inventario-texto");

    if (!sectoresTextoElement) {
        console.error("❌ [INFO-SECTORES] No se encontro elemento sectores-inventario-texto");
        return;
    }

    console.log("🏢 [INFO-SECTORES] Sectores en sessionStorage:", sectoresInfo);

    if (sectoresInfo === "TODOS") {
        console.log("🏢 [INFO-SECTORES] Mostrando: Todos los sectores");
        sectoresTextoElement.innerHTML = "📦 <strong>Todos los sectores</strong> - Inventario completo de ingredientes";
    } else {
        try {
            const sectoresSeleccionados = JSON.parse(sectoresInfo || "[]");
            console.log("🏢 [INFO-SECTORES] Sectores especificos:", sectoresSeleccionados);

            if (sectoresSeleccionados.length === 0) {
                console.log("🏢 [INFO-SECTORES] No hay sectores especificos seleccionados");
                sectoresTextoElement.innerHTML = "⚠️ <strong>Sin sectores especificos</strong> - Revise la configuracion";
            } else {
                // Buscar nombres de sectores
                const nombresSectores = sectoresSeleccionados.map(sectorId => {
                    const sector = todosLosSectores.find(s => s.id === sectorId);
                    return sector ? sector.nombre : "Sector " + sectorId;
                });

                console.log("🏢 [INFO-SECTORES] Nombres de sectores:", nombresSectores);

                const textoSectores = nombresSectores.join(", ");
                sectoresTextoElement.innerHTML = "🏢 <strong>Sectores seleccionados:</strong> " + textoSectores;
            }
        } catch (e) {
            console.error("❌ [INFO-SECTORES] Error al parsear sectores:", e);
            sectoresTextoElement.innerHTML = "❌ <strong>Error</strong> - No se pudo cargar informacion de sectores";
        }
    }

    console.log("✅ [INFO-SECTORES] Informacion de sectores mostrada correctamente");
}

// ===== FUNCIONES DE WEBSOCKET =====

/**
 * Inicializa la conexion WebSocket para inventario de ingredientes
 */
function inicializarWebSocketIngredientes() {
    try {
        console.log("🚀 [WEBSOCKET] ===== INICIANDO WEBSOCKET PARA INVENTARIO DE INGREDIENTES =====");
        console.log("📅 [WEBSOCKET] Timestamp:", new Date().toISOString());

        // Verificar si io esta disponible
        if (typeof io === "undefined") {
            console.error("❌ [WEBSOCKET] Socket.IO no esta disponible");
            mostrarMensaje("Error: Socket.IO no esta cargado", "error");
            return;
        }

        // Conectar a WebSocket con opciones de reconexion
        socket = io({
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        // Generar ID de sesion unico con timestamp para debugging
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        sessionId = "inv_ing_" + timestamp + "_" + random;
        window.sessionId = sessionId;
        sessionStorage.setItem("inventario_session_id", sessionId);

        console.log("🆔 [WEBSOCKET] ===== GENERACION DE SESSION ID =====");
        console.log("- Timestamp:", timestamp);
        console.log("- Random:", random);
        console.log("- Session ID completo:", sessionId);

        socket.on("connect", () => {
            console.log("✅ [WEBSOCKET] Conectado a WebSocket con socket ID:", socket.id);

            // Obtener informacion del usuario y sectores
            const usuarioInfo = JSON.parse(sessionStorage.getItem("usuarioInventario") || "{}");
            const sectoresInfo = sessionStorage.getItem("sectoresInventario");

            let sectores;
            if (sectoresInfo === "TODOS") {
                sectores = "TODOS";
            } else {
                try {
                    const sectoresIds = JSON.parse(sectoresInfo || "[]");
                    // Enriquecer con descripcion para el movil
                    if (Array.isArray(sectoresIds) && typeof todosLosSectores !== 'undefined') {
                        sectores = sectoresIds.map(id => {
                            const idNum = parseInt(id);
                            const sec = todosLosSectores.find(s => s.id === idNum);
                            return sec ? { id: sec.id, descripcion: sec.descripcion || sec.nombre } : { id, descripcion: `Sector ${id}` };
                        });
                    } else {
                        sectores = sectoresIds;
                    }
                } catch (e) {
                    console.error("❌ [WEBSOCKET] Error al parsear sectores:", e);
                    sectores = [];
                }
            }

            // EXPOSE GLOBALLY FOR PRINTING
            window.sectoresSesionActiva = sectores;
            console.log("🌍 [GLOBAL] Sectores guardados en window.sectoresSesionActiva:", window.sectoresSesionActiva);

            // Iniciar sesion de inventario de ingredientes
            // CORRECCION: Enviar objeto usuario completo con id y nombre

            // 1. Filtrar y Enriquecer Ingredientes para Auditoría Móvil
            let ingredientesParaMovil = [];
            if (typeof todosLosIngredientes !== 'undefined' && Array.isArray(todosLosIngredientes)) {
                console.log("📦 [WEBSOCKET] Preparando lista maestra de ingredientes para móvil...");

                ingredientesParaMovil = todosLosIngredientes.filter(ing => {
                    if (sectores === 'TODOS') return true;
                    // sectores es array de objetos {id, descripcion} o strings '7'
                    // Si sectores contiene objetos, mapear a IDs primero
                    const idsPermitidos = Array.isArray(sectores) ? sectores.map(s => (s.id || s).toString()) : [];
                    // FIX: Check if sector_id exists before toString
                    return ing.sector_id && idsPermitidos.includes(ing.sector_id.toString());
                }).map(ing => {
                    // Lógica robusta de extracción de letra (Centralizada)
                    let sectorLetra = null;
                    if (ing.sector_id) {
                        // Buscar descripción del sector
                        let descripcionSector = "";
                        if (typeof todosLosSectores !== 'undefined') {
                            const sec = todosLosSectores.find(s => s.id === ing.sector_id);
                            if (sec) descripcionSector = sec.descripcion || sec.nombre;
                        }

                        if (descripcionSector) {
                            const match = descripcionSector.match(/["']([^"']+)["']/);
                            if (match) sectorLetra = match[1];
                            else if (descripcionSector.includes('Sector')) sectorLetra = descripcionSector.replace('Sector', '').replace(/["']/g, '').trim();
                            else sectorLetra = descripcionSector;
                        }
                    }

                    return {
                        ...ing,
                        id: ing.id,
                        nombre: ing.nombre,
                        codigo: ing.codigo,
                        sector_id: ing.sector_id,
                        sector_letra: sectorLetra || ing.sector_id, // Fallback
                        stock_actual: parseFloat(ing.stock_actual || 0),
                        stock_sistema: parseFloat(ing.stock_actual || 0),
                        stock_bultos: parseFloat(ing.stock_bultos || 0),
                        lotes_cajas_cerradas: ing.lotes_cajas_cerradas || [],
                        stock_potencial: parseFloat(ing.stock_potencial || ing.stock_actual || 0),
                        unidad: ing.unidad_medida,
                        unidad_medida: ing.unidad_medida
                    };
                });
                console.log(`📦 [WEBSOCKET] ${ingredientesParaMovil.length} ingredientes listos para enviar con lotes.`);

                // --- NUEVO PARA SIMETRÍA PC ---
                window.listaMaestraPC = ingredientesParaMovil;
                ingredientesInventario.clear(); // Reiniciar contados locales
                window.ingredientesInventario = ingredientesInventario; // Sincronizar referencia
                // -----------------------------
            }

            const datosInicioSesion = {
                sessionId: sessionId,
                usuario: {
                    id: usuarioSeleccionado,
                    nombre: usuarioInfo.nombre || "Usuario Desconocido"
                },
                sectores: sectores,
                ingredientes: ingredientesParaMovil, // <--- NUEVO: Lista Maestra
                tipo: "ingredientes"
            };

            console.log("📤 [WEBSOCKET] Enviando iniciar_inventario (UNIFICADO) con datos:", datosInicioSesion);

            socket.emit("iniciar_inventario", datosInicioSesion);

            // Iniciar Panel de Control PC: Actualizar listas ahora que tenemos datos
            if (typeof renderizarListasPC === 'function') {
                console.log("📡 [WEBSOCKET] Renderizando listas iniciales en PC...");
                renderizarListasPC();
            }
        });

        socket.on("inventario_iniciado", (data) => {
            console.log("🎉 [WEBSOCKET] SESION DE INVENTARIO INICIADA EXITOSAMENTE (UNIFICADO)");
            console.log("🎉 [WEBSOCKET] Datos de respuesta:", data);

            // Generar codigo QR para movil
            generarCodigoQR();
        });

        socket.on('inventario_cancelado', () => {
            alert("⛔ EL INVENTARIO HA SIDO CANCELADO.");
            window.location.reload();
        });

        socket.on("nuevo_articulo", (data) => {
            console.log("📦 [WEBSOCKET] Nuevo item recibido desde movil:", data);

            // Determinar si es un ingrediente o un articulo (unificacion)
            const item = data.ingrediente || data.articulo;

            if (!item || !item.id) {
                console.warn("⚠️ [WEBSOCKET] Datos recibidos sin item valido:", data);
                return;
            }

            const itemIdStr = item.id.toString();
            const cantNum = normalizarDecimalUniversal(data.cantidad);
            const kilosSueltosNum = normalizarDecimalUniversal(item.kilos_sueltos_contados !== undefined ? item.kilos_sueltos_contados : cantNum);
            const bultosNum = normalizarDecimalUniversal(item.total_bultos_contados || 0);
            const lotesContados = item.lotes_contados || [];
            
            let totalKilosLotes = 0;
            if (Array.isArray(lotesContados)) {
                lotesContados.forEach(l => {
                    totalKilosLotes += (normalizarDecimalUniversal(l.cajas_contadas) * normalizarDecimalUniversal(l.kilos_por_caja));
                });
            }
            const potencialNum = normalizarDecimalUniversal(item.stock_potencial_contado !== undefined ? item.stock_potencial_contado : (kilosSueltosNum + totalKilosLotes));

            let itemInventario = ingredientesInventario.get(itemIdStr);
            if (!itemInventario) {
                itemInventario = {
                    ...item,
                    id: item.id,
                    nombre: item.nombre,
                    codigo: item.codigo,
                    sector_id: item.sector_id,
                    unidad_medida: item.unidad_medida || item.unidad || 'kg',
                    stock_actual: normalizarDecimalUniversal(item.stock_actual || 0),
                    stock_bultos: normalizarDecimalUniversal(item.stock_bultos || 0)
                };
                ingredientesInventario.set(itemIdStr, itemInventario);
            }

            itemInventario.stock_contado = kilosSueltosNum;
            itemInventario.kilos_sueltos_contados = kilosSueltosNum;
            itemInventario.lotes_contados = lotesContados;
            itemInventario.total_bultos_contados = bultosNum;
            itemInventario.stock_potencial_contado = potencialNum;
            itemInventario.contado = true;
            itemInventario.no_tocado = false;

            window.ingredientesInventario = ingredientesInventario;

            if (typeof renderizarListasPC === 'function') renderizarListasPC();
            if (typeof renderizarListasModalPC === 'function') renderizarListasModalPC();

            // Si la ficha activa en PC corresponde a este item, refrescarla en vivo sin resetear campos ajenos
            if (window.articuloActualPC && String(window.articuloActualPC.id) === itemIdStr) {
                window.articuloActualPC.kilos_sueltos_contados = kilosSueltosNum;
                window.articuloActualPC.stock_contado = kilosSueltosNum;
                window.articuloActualPC.lotes_contados = JSON.parse(JSON.stringify(lotesContados));
                window.articuloActualPC.total_bultos_contados = bultosNum;
                window.articuloActualPC.stock_potencial_contado = potencialNum;
                window.articuloActualPC.contado = true;

                const inputCant = document.getElementById('cantidad-pc');
                if (inputCant && document.activeElement !== inputCant) {
                    inputCant.value = kilosSueltosNum > 0 ? kilosSueltosNum : '';
                }
                if (typeof renderizarLotesArticuloActualPC === 'function') renderizarLotesArticuloActualPC();
                if (typeof actualizarCalculoDualPC === 'function') actualizarCalculoDualPC();
            }

            // Actualizar tarjeta de actividad en vivo en la PC
            const livePanel = document.getElementById('live-activity-pc');
            const liveNombre = document.getElementById('live-activity-nombre');
            const liveDetalles = document.getElementById('live-activity-detalles');
            if (livePanel && liveNombre && liveDetalles) {
                livePanel.style.display = 'block';
                liveNombre.textContent = item.nombre;
                
                let lotesTxt = '';
                if (lotesContados && lotesContados.length > 0) {
                    lotesTxt = lotesContados.filter(l => (normalizarDecimalUniversal(l.cajas_contadas) || 0) > 0).map(l => `#${l.id_corto}: ${l.cajas_contadas} cj`).join(', ');
                }

                liveDetalles.innerHTML = `
                    <div>⚖️ Kilos sueltos: <strong>${kilosSueltosNum.toFixed(2)} kg</strong> | 📦 Bultos: <strong>${bultosNum} cj</strong> ${lotesTxt ? `(${lotesTxt})` : ''}</div>
                    <div style="margin-top: 2px; color: #166534; font-weight: 700;">Stock Potencial Total: ${potencialNum.toFixed(2)} kg</div>
                `;
            }
        });

        socket.on("movil_conectado", (data) => {
            console.log("📱 [WEBSOCKET] Movil conectado:", data);
            mostrarMensaje("Dispositivo móvil conectado", "info");

            const badgeQR = document.getElementById("badge-qr-estado");
            if (badgeQR) {
                badgeQR.textContent = "✅ Móvil Conectado";
                badgeQR.style.background = "#dcfce7";
                badgeQR.style.color = "#166534";
            }

            // DEBUG: Trace data availability
            console.log("🔍 [DEBUG SYNC] Triggered movil_conectado");
            console.log("🔍 [DEBUG SYNC] window.listaMaestraPC:", window.listaMaestraPC ? window.listaMaestraPC.length + " items" : "UNDEFINED");
            console.log("🔍 [DEBUG SYNC] todosLosIngredientes:", typeof todosLosIngredientes !== 'undefined' ? todosLosIngredientes.length + " items" : "UNDEFINED");

            // REFACTOR (Fase 2): Cruzar la lista maestra con el progreso actual de la PC
            const listaBase = window.listaMaestraPC || todosLosIngredientes;

            if (listaBase && listaBase.length > 0) {
                // Clonar y mapear inyectando el estado real de la sesión (PC como Master)
                const listaParaEnviar = listaBase.map(ing => {
                    const ingCopia = { ...ing };
                    if (ingredientesInventario.has(ingCopia.id.toString())) {
                        const itemContado = ingredientesInventario.get(ingCopia.id.toString());
                        ingCopia.contado = true;
                        ingCopia.stock_contado = itemContado.stock_contado;
                        ingCopia.kilos_sueltos_contados = itemContado.kilos_sueltos_contados !== undefined ? itemContado.kilos_sueltos_contados : itemContado.stock_contado;
                        ingCopia.total_bultos_contados = itemContado.total_bultos_contados !== undefined ? itemContado.total_bultos_contados : (itemContado.stock_bultos || 0);
                        ingCopia.lotes_contados = itemContado.lotes_contados || [];
                        ingCopia.stock_potencial_contado = itemContado.stock_potencial_contado !== undefined ? itemContado.stock_potencial_contado : itemContado.stock_contado;
                    } else if (ingCopia.contado) {
                        // Preservar si ya venía contado previamente
                        ingCopia.stock_contado = ingCopia.stock_contado || ingCopia.kilos_sueltos_contados || 0;
                    } else {
                        ingCopia.contado = false;
                        ingCopia.stock_contado = 0;
                        ingCopia.kilos_sueltos_contados = 0;
                        ingCopia.total_bultos_contados = 0;
                        ingCopia.lotes_contados = [];
                    }
                    return ingCopia;
                });

                console.log("📤 [SYNC] Enviando estado consolidado al móvil (" + listaParaEnviar.length + " items)");
                socket.emit("sincronizar_datos_inventario", {
                    sessionId: sessionId,
                    ingredientes: listaParaEnviar
                });
            } else {
                console.error("❌ [DEBUG SYNC] No hay lista base para procesar y enviar");
            }
        });

        socket.on("imprimir_etiqueta_ingrediente", (data) => {
            console.log("🖨️ [WEBSOCKET] Solicitud de impresión recibida para ID:", data.ingredienteId);
            mostrarMensaje("🖨️ Imprimiendo etiqueta...", "info");

            // Intento 1: Función específica de ingredientes (definida en ingredientes.js o global)
            if (typeof window.imprimirEtiquetaIngrediente === 'function') {
                window.imprimirEtiquetaIngrediente(data.ingredienteId);
                return;
            }
            if (typeof imprimirEtiquetaIngrediente === 'function') {
                imprimirEtiquetaIngrediente(data.ingredienteId);
                return;
            }

            // Intento 2: Función genérica de etiquetas
            if (typeof window.imprimirEtiqueta === 'function') {
                window.imprimirEtiqueta(data.ingredienteId);
                return;
            }
            if (typeof imprimirEtiqueta === 'function') {
                imprimirEtiqueta(data.ingredienteId);
                return;
            }

            // Fallback: Error visual
            console.error("❌ Función de impresión no encontrada (imprimirEtiquetaIngrediente)");
            mostrarMensaje("Error: No se encontró la función de impresión en la PC", "error");
        });

        // NUEVO: Listener para cierre remoto desde móvil
        socket.on("solicitud_cierre_remoto", (data) => {
            console.log("🏁 [WEBSOCKET] Solicitud de cierre remoto recibida");
            if (window._finalizandoInventarioActivo) {
                console.warn("⚠️ [WEBSOCKET] Cierre ya en curso, omitiendo solicitud_cierre_remoto redundante");
                return;
            }
            if (typeof finalizarInventario === 'function') {
                finalizarInventario();
            } else if (typeof window.finalizarInventario === 'function') {
                window.finalizarInventario();
            } else {
                console.error("❌ Función finalizarInventario no encontrada");
            }
        });

        // NUEVO: Listener cuando el inventario es finalizado (desde móvil o servidor)
        socket.on("inventario_finalizado_con_reporte", (data) => {
            console.log("🎉 [WEBSOCKET] Inventario finalizado con reporte recibido en PC:", data);
            detenerCronometroPC();
            if (data?.resultado && typeof window.mostrarModalResultadoInventarioPC === 'function') {
                const pasoConteo = document.getElementById('paso-conteo');
                if (pasoConteo) pasoConteo.style.display = 'none';
                window.mostrarModalResultadoInventarioPC(data.resultado);
            }
        });

        socket.on("movil_desconectado", (data) => {
            console.log("📱 [WEBSOCKET] Movil desconectado:", data);
            mostrarMensaje("Dispositivo movil desconectado", "info");
        });

        socket.on("error_conexion", (data) => {
            console.error("❌ [WEBSOCKET] Error de conexion:", data);
            mostrarMensaje("Error de conexion: " + data.mensaje, "error");
        });

        socket.on("disconnect", () => {
            console.log("🔌 [WEBSOCKET] Desconectado del servidor");
        });

        socket.onAny((eventName, ...args) => {
            if (!["connect", "inventario_ingredientes_iniciado", "movil_conectado", "movil_desconectado", "nuevo_ingrediente", "disconnect"].includes(eventName)) {
                console.log("🔔 [WEBSOCKET] Evento WebSocket no manejado:", eventName, args);
            }
        });

    } catch (error) {
        console.error("❌ [WEBSOCKET] Error al inicializar WebSocket:", error);
        mostrarMensaje("Error al conectar con el servidor: " + error.message, "error");
    }
}

window.modoConexionQR = 'cloud'; // 'cloud' (https://inventario.lamdaser.com) | 'lan' (IP local)

window.cambiarModoQR = function (nuevoModo) {
    window.modoConexionQR = nuevoModo;
    generarCodigoQR();
};

async function generarCodigoQR() {
    try {
        console.log("📱 [QR] Generando codigo QR para inventario de ingredientes");
        console.log("📱 [QR] Session ID:", sessionId, "| Modo:", window.modoConexionQR);

        const cloudBaseUrl = "https://inventario.lamdaser.com";
        let lanBaseUrl = window.location.origin;

        try {
            // Obtener también la IP local por si el usuario alterna a modo Red Local
            const response = await fetch('/api/config/network-ip');
            if (response.ok) {
                const data = await response.json();
                if (data.ip && data.ip !== 'localhost' && !String(data.ip).startsWith('169.254.')) {
                    const protocol = window.location.protocol;
                    const port = window.location.port ? ':' + window.location.port : '';
                    lanBaseUrl = `${protocol}//${data.ip}${port}`;
                    console.log("🌐 [QR] IP de red local detectada:", lanBaseUrl);
                }
            }
        } catch (e) {
            console.warn("⚠️ [QR] No se pudo obtener IP de red, usando origen local:", e);
        }

        const baseUrl = (window.modoConexionQR === 'lan') ? lanBaseUrl : cloudBaseUrl;

        // URL corregida para apuntar directamente a la página móvil
        const urlMovil = baseUrl + "/pages/inventario-movil.html?session=" + encodeURIComponent(sessionId);

        console.log("📱 [QR] URL generada final:", urlMovil);

        const urlElement = document.getElementById("url-movil");
        if (urlElement) {
            urlElement.textContent = urlMovil;
        }

        const qrContainer = document.getElementById("qr-canvas");
        if (qrContainer && typeof QRCode !== "undefined") {
            qrContainer.innerHTML = "";

            const qr = new QRCode(qrContainer, {
                text: urlMovil,
                width: 180,
                height: 180,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.M
            });

            console.log("✅ [QR] Codigo QR generado exitosamente");

            // Asegurar que la sección y contenido QR estén visibles
            const contenidoQR = document.getElementById("contenido-qr-pc");
            if (contenidoQR) contenidoQR.style.display = "block";
            const btnToggleQR = document.getElementById("btn-toggle-qr");
            if (btnToggleQR) btnToggleQR.textContent = "Minimizar";

            // INJECT: Selector de modo de conexión y enlace visible de diagnóstico
            let urlTextContainer = document.getElementById("qr-url-text");
            if (!urlTextContainer) {
                urlTextContainer = document.createElement("div");
                urlTextContainer.id = "qr-url-text";
                urlTextContainer.style.marginTop = "8px";
                urlTextContainer.style.padding = "8px";
                urlTextContainer.style.background = "#f8fafc";
                urlTextContainer.style.border = "1px solid #e2e8f0";
                urlTextContainer.style.borderRadius = "6px";
                urlTextContainer.style.fontSize = "11px";
                urlTextContainer.style.wordBreak = "break-all";
                urlTextContainer.style.textAlign = "center";
                urlTextContainer.style.color = "#475569";
                if (contenidoQR) {
                    contenidoQR.appendChild(urlTextContainer);
                } else {
                    qrContainer.parentNode.appendChild(urlTextContainer);
                }
            }

            const esCloud = window.modoConexionQR !== 'lan';
            const estiloActivo = "background:#4f46e5; color:#ffffff; border:1px solid #4338ca; font-weight:700;";
            const estiloInactivo = "background:#ffffff; color:#475569; border:1px solid #cbd5e1; font-weight:600;";

            urlTextContainer.innerHTML = `
                <div style="display:flex; justify-content:center; gap:6px; margin-bottom:6px; flex-wrap:wrap; font-family:sans-serif;">
                    <button type="button" onclick="window.cambiarModoQR('cloud')" style="padding:4px 10px; border-radius:6px; font-size:11px; cursor:pointer; ${esCloud ? estiloActivo : estiloInactivo}">
                        🌐 Depósito / HTTPS (Recomendado)
                    </button>
                    <button type="button" onclick="window.cambiarModoQR('lan')" style="padding:4px 10px; border-radius:6px; font-size:11px; cursor:pointer; ${!esCloud ? estiloActivo : estiloInactivo}">
                        🏠 Red Local (${lanBaseUrl.replace(/^https?:\/\//, '')})
                    </button>
                </div>
                <div style="font-family:monospace; font-size:11px; color:#334155; margin-bottom:4px;">${urlMovil}</div>
                <a href="${urlMovil}" target="_blank" style="font-family:sans-serif; text-decoration:none; color:#4f46e5; font-weight:600;">🔗 Abrir enlace directo</a>
            `;

        } else {
            console.error("❌ [QR] No se pudo generar el codigo QR - elemento o libreria no disponible");
        }

    } catch (error) {
        console.error("❌ [QR] Error al generar codigo QR:", error);
    }
}

window.toggleSeccionQR = function () {
    const contenido = document.getElementById('contenido-qr-pc');
    const btn = document.getElementById('btn-toggle-qr');
    if (!contenido || !btn) return;
    if (contenido.style.display === 'none') {
        contenido.style.display = 'block';
        btn.textContent = 'Minimizar';
    } else {
        contenido.style.display = 'none';
        btn.textContent = 'Mostrar QR';
    }
};

async function agregarIngredienteAInventario(ingrediente, cantidadInicial = 0, esDesdeMovil = false) {
    console.log("🚀 [INVENTARIO] ===== AGREGANDO INGREDIENTE AL INVENTARIO =====");
    console.log("🚀 [INVENTARIO] Ingrediente:", ingrediente.nombre);
    console.log("🚀 [INVENTARIO] ID:", ingrediente.id);
    console.log("🚀 [INVENTARIO] Cantidad inicial:", cantidadInicial);
    console.log("🚀 [INVENTARIO] Ingredientes en inventario actual:", ingredientesInventario.size);

    // Si viene desde móvil o ya está en listaMaestraPC, se permite siempre sin bloquear por sector
    const yaEnListaMaestra = window.listaMaestraPC && window.listaMaestraPC.some(m => String(m.id) === String(ingrediente.id));
    if (!esDesdeMovil && !yaEnListaMaestra) {
        const sectoresInfo = sessionStorage.getItem("sectoresInventario");
        if (sectoresInfo && sectoresInfo !== "TODOS") {
            try {
                const sectoresSeleccionados = JSON.parse(sectoresInfo);
                if (sectoresSeleccionados.length > 0) {
                    const perteneceASector = sectoresSeleccionados.some(sid => String(sid) === String(ingrediente.sector_id));

                    if (!perteneceASector) {
                        const nombresSectoresSeleccionados = sectoresSeleccionados.map(sectorId => {
                            const sector = todosLosSectores.find(s => s.id === sectorId);
                            return sector ? sector.nombre : "Sector " + sectorId;
                        }).join(", ");

                        const mensaje = "El ingrediente \"" + ingrediente.nombre + "\" no pertenece a los sectores seleccionados.\n\n" +
                            "• Sectores permitidos: " + nombresSectoresSeleccionados + "\n\n" +
                            "Este ingrediente no puede ser agregado al inventario.";

                        mostrarMensaje(mensaje, "error");
                        return;
                    }
                }
            } catch (e) {
                console.error("❌ [INVENTARIO] Error al verificar sectores:", e);
            }
        }
    }

    const cantNorm = normalizarDecimalUniversal(cantidadInicial);
    const kilosSueltosNorm = normalizarDecimalUniversal(ingrediente.kilos_sueltos_contados !== undefined ? ingrediente.kilos_sueltos_contados : cantNorm);
    const totalBultosNorm = normalizarDecimalUniversal(ingrediente.total_bultos_contados || 0);
    const potencialNorm = normalizarDecimalUniversal(ingrediente.stock_potencial_contado !== undefined ? ingrediente.stock_potencial_contado : kilosSueltosNorm);

    if (ingredientesInventario.has(ingrediente.id.toString())) {
        console.log("⚠️ [INVENTARIO] Ingrediente ya existe en inventario");
        const ingredienteExistente = ingredientesInventario.get(ingrediente.id.toString());
        ingredienteExistente.stock_contado = kilosSueltosNorm;
        ingredienteExistente.kilos_sueltos_contados = kilosSueltosNorm;
        ingredienteExistente.total_bultos_contados = totalBultosNorm;
        ingredienteExistente.stock_potencial_contado = potencialNorm;
        ingredienteExistente.contado = true;
        ingredienteExistente.no_tocado = false;
        window.ingredientesInventario = ingredientesInventario;
        return;
    }

    const ingredienteInventario = {
        ...ingrediente,
        stock_actual: normalizarDecimalUniversal(ingrediente.stock_actual || 0),
        stock_bultos: normalizarDecimalUniversal(ingrediente.stock_bultos || 0),
        stock_contado: kilosSueltosNorm,
        kilos_sueltos_contados: kilosSueltosNorm,
        total_bultos_contados: totalBultosNorm,
        stock_potencial_contado: potencialNorm,
        lotes_contados: ingrediente.lotes_contados ? JSON.parse(JSON.stringify(ingrediente.lotes_contados)) : (ingrediente.lotes_cajas_cerradas || []),
        contado: true,
        no_tocado: false
    };

    ingredientesInventario.set(ingrediente.id.toString(), ingredienteInventario);
    window.ingredientesInventario = ingredientesInventario;

    // --- NUEVO: SOPORTE PARA PANEL DE CONTROL ---
    if (window.listaMaestraPC) {
        console.log("📡 [INVENTARIO] Actualizando Panel de Control (Simetría PC-Movil)");
        renderizarListasPC();
        if (typeof renderizarListasModalPC === 'function') renderizarListasModalPC();
        return; // Salir, no usar lógica legacy de DOM
    }
    // -------------------------------------------

    const div = document.createElement("div");
    div.className = "inventario-item";
    div.setAttribute("data-ingrediente-id", ingrediente.id);
    div.innerHTML =
        "<h4>" + ingrediente.nombre + "</h4>" +
        "<div class=\"info-row\">" +
        "<span><strong>ID:</strong> " + ingrediente.id + "</span>" +
        "<span><strong>Codigo:</strong> " + (ingrediente.codigo || "N/A") + "</span>" +
        "<span><strong>Stock actual:</strong> " + formatearNumero(ingrediente.stock_actual) + " " + (ingrediente.unidad_medida || "kg") + "</span>" +
        "</div>" +
        "<div class=\"stock-input\">" +
        "<label>Stock contado:</label>" +
        "<input type=\"number\" " +
        "step=\"0.01\" " +
        "min=\"0\" " +
        "value=\"" + cantidadInicial + "\" " +
        "data-ingrediente-id=\"" + ingrediente.id + "\">" +
        "<span>" + (ingrediente.unidad_medida || "kg") + "</span>" +
        "</div>";

    console.log("🔍 [INVENTARIO] Buscando contenedor ingredientes-inventario");
    const contenedor = document.getElementById("ingredientes-inventario");
    if (!contenedor) {
        console.error("❌ [INVENTARIO] ERROR CRITICO: No se encontro el contenedor ingredientes-inventario");
        mostrarMensaje("Error: No se pudo agregar el ingrediente al formulario", "error");
        return;
    }

    contenedor.insertBefore(div, contenedor.firstChild);

    const input = div.querySelector("input[type=\"number\"]");
    if (input) {
        input.addEventListener("input", function () {
            const nuevaCantidad = parseFloat(this.value) || 0;
            ingredientesInventario.get(ingrediente.id.toString()).stock_contado = nuevaCantidad;
            console.log("📝 [INVENTARIO] Cantidad actualizada para " + ingrediente.nombre + ": " + nuevaCantidad);
        });
    }

    const btnMostrarDiferencias = document.getElementById("btn-mostrar-diferencias");
    if (btnMostrarDiferencias && ingredientesInventario.size > 0) {
        btnMostrarDiferencias.style.display = "inline-block";
    }

    console.log("✅ [INVENTARIO] Ingrediente agregado exitosamente al inventario");
    console.log("✅ [INVENTARIO] Total ingredientes en inventario:", ingredientesInventario.size);
}

async function mostrarDiferencias() {
    try {
        console.log("📊 [DIFERENCIAS] ===== INICIANDO MOSTRAR DIFERENCIAS =====");

        const sectoresInfo = sessionStorage.getItem("sectoresInventario");
        let sectoresSeleccionados = [];

        if (sectoresInfo === "TODOS") {
            console.log("📊 [DIFERENCIAS] Procesando TODOS los sectores");
            sectoresSeleccionados = "TODOS";
        } else {
            try {
                sectoresSeleccionados = JSON.parse(sectoresInfo || "[]");
                console.log("📊 [DIFERENCIAS] Sectores especificos:", sectoresSeleccionados);
            } catch (e) {
                console.error("❌ [DIFERENCIAS] Error al parsear sectores:", e);
                mostrarMensaje("Error al obtener sectores seleccionados", "error");
                return;
            }
        }

        console.log("📊 [DIFERENCIAS] Obteniendo ingredientes de sectores...");
        const response = await fetch("/api/produccion/ingredientes/por-sectores", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ sectores: sectoresSeleccionados })
        });

        if (!response.ok) {
            throw new Error("Error al obtener ingredientes por sectores");
        }

        const ingredientesDeSectores = await response.json();
        console.log("📊 [DIFERENCIAS] Ingredientes obtenidos:", ingredientesDeSectores.length);

        const diferencias = [];

        ingredientesDeSectores.forEach(ingrediente => {
            const ingredienteContado = ingredientesInventario.get(ingrediente.id.toString());

            let stockContado = 0;
            let estado = "No contado";

            if (ingredienteContado) {
                stockContado = parseFloat(ingredienteContado.stock_contado) || 0;
                estado = "Contado";
            }

            const stockSistema = parseFloat(ingrediente.stock_actual) || 0;
            const diferencia = stockContado - stockSistema;

            diferencias.push({
                id: ingrediente.id,
                nombre: ingrediente.nombre,
                stock_sistema: stockSistema,
                stock_contado: stockContado,
                diferencia: diferencia,
                estado: estado,
                unidad_medida: ingrediente.unidad_medida || "kg"
            });
        });

        console.log("📊 [DIFERENCIAS] Total diferencias calculadas:", diferencias.length);

        mostrarModalDiferencias(diferencias);

    } catch (error) {
        console.error("❌ [DIFERENCIAS] Error al mostrar diferencias:", error);
        mostrarMensaje("Error al calcular diferencias: " + error.message, "error");
    }
}

function mostrarModalDiferencias(diferencias) {
    console.log("📊 [MODAL-DIFERENCIAS] Mostrando modal con " + diferencias.length + " diferencias");

    const modal = document.getElementById("modal-diferencias");
    const tbody = document.getElementById("tabla-diferencias-body");

    if (!modal || !tbody) {
        console.error("❌ [MODAL-DIFERENCIAS] No se encontraron elementos del modal");
        return;
    }

    tbody.innerHTML = "";

    if (diferencias.length === 0) {
        tbody.innerHTML = "<tr><td colspan=\"6\" class=\"mensaje-info\">No hay ingredientes en los sectores seleccionados</td></tr>";
    } else {
        diferencias.forEach(diferencia => {
            const tr = document.createElement("tr");

            let claseEstado = "";
            if (diferencia.estado === "No contado") {
                claseEstado = "stock-negativo";
            } else if (Math.abs(diferencia.diferencia) < 0.01) {
                claseEstado = "stock-cero";
            } else if (diferencia.diferencia > 0) {
                claseEstado = "stock-positivo";
            } else {
                claseEstado = "stock-negativo";
            }

            tr.innerHTML =
                "<td>" + diferencia.id + "</td>" +
                "<td>" + diferencia.nombre + "</td>" +
                "<td class=\"stock-cell\">" + formatearNumero(diferencia.stock_sistema) + " " + diferencia.unidad_medida + "</td>" +
                "<td class=\"stock-cell\">" + formatearNumero(diferencia.stock_contado) + " " + diferencia.unidad_medida + "</td>" +
                "<td class=\"stock-cell " + claseEstado + "\">" + formatearNumero(diferencia.diferencia) + " " + diferencia.unidad_medida + "</td>" +
                "<td><span class=\"" + (diferencia.estado === "Contado" ? "stock-positivo" : "stock-negativo") + "\">" + diferencia.estado + "</span></td>";

            tbody.appendChild(tr);
        });
    }

    modal.style.display = "block";
    console.log("✅ [MODAL-DIFERENCIAS] Modal mostrado correctamente");
}

document.addEventListener("DOMContentLoaded", function () {
    console.log("🚀 [INIT] Inicializando gestion de ingredientes... (VERSION FIX 4.1 - UI FIX)");
    console.log("🕒 [INIT] Timestamp de versión:", new Date().toISOString());

    cargarIngredientes();

    const filtroNombre = document.getElementById("filtro-nombre");
    const filtroStock = document.getElementById("filtro-stock");

    if (filtroNombre) {
        filtroNombre.addEventListener("input", aplicarFiltros);
    }

    if (filtroStock) {
        filtroStock.addEventListener("change", aplicarFiltros);
    }

    const selectUsuario = document.getElementById("select-usuario");
    if (selectUsuario) {
        selectUsuario.addEventListener("change", () => actualizarSeleccionUsuario(selectUsuario, "usuarioSeleccionado", "btn-continuar-usuario"));
    }

    const btnIniciarInventario = document.getElementById("btn-iniciar-inventario");
    if (btnIniciarInventario) {
        btnIniciarInventario.addEventListener("click", mostrarModal);
    }

    const btnHistorialInventarios = document.getElementById("btn-historial-inventarios");
    if (btnHistorialInventarios) {
        btnHistorialInventarios.addEventListener("click", () => {
            if (typeof window.abrirHistorialInventariosPC === 'function') {
                window.abrirHistorialInventariosPC();
            }
        });
    }

    const btnContinuarUsuario = document.getElementById("btn-continuar-usuario");
    if (btnContinuarUsuario) {
        btnContinuarUsuario.addEventListener("click", mostrarPasoSectores);
    }

    const btnVolverUsuario = document.getElementById("btn-volver-usuario");
    if (btnVolverUsuario) {
        btnVolverUsuario.addEventListener("click", function () {
            document.getElementById("paso-sectores").style.display = "none";
            document.getElementById("paso-usuario").style.display = "block";
        });
    }

    const btnContinuarSectores = document.getElementById("btn-continuar-sectores");
    if (btnContinuarSectores) {
        btnContinuarSectores.addEventListener("click", function () {
            const checkboxTodos = document.getElementById("todos-sectores");

            if (checkboxTodos && checkboxTodos.checked) {
                sessionStorage.setItem("sectoresInventario", "TODOS");
                console.log("🏢 [SECTORES] Guardado: TODOS los sectores");
            } else {
                const sectoresCheckboxes = document.querySelectorAll(".sector-checkbox:checked");
                const sectoresSeleccionados = Array.from(sectoresCheckboxes).map(cb => parseInt(cb.dataset.sectorId));

                if (sectoresSeleccionados.length === 0) {
                    mostrarMensaje("Debe seleccionar al menos un sector o marcar \"Todos los sectores\"", "error");
                    return;
                }

                sessionStorage.setItem("sectoresInventario", JSON.stringify(sectoresSeleccionados));
                console.log("🏢 [SECTORES] Guardados sectores especificos:", sectoresSeleccionados);
            }

            mostrarPasoConteo();
        });
    }

    // Configurar Escaneo Dual en PC (Modo Balanza y Modo Bultos Cerrados)
    configurarEscaneoDualPC();

    const btnFinalizarInventario = document.getElementById("btn-finalizar-inventario");
    if (btnFinalizarInventario) {
        btnFinalizarInventario.addEventListener("click", finalizarInventario);
    }

    const btnFinalizarHeader = document.getElementById("btn-finalizar-inventario-pc-header");
    if (btnFinalizarHeader) {
        btnFinalizarHeader.addEventListener("click", finalizarInventario);
    }

    // CORRECCIÓN: Usar delegación de eventos para los botones de cancelar
    // ya que hay múltiples botones con diferentes IDs en diferentes pasos
    document.addEventListener("click", function (e) {
        // Botón cancelar inventario (hay uno en cada paso del modal)
        if (e.target && e.target.id === "btn-cancelar-inventario") {
            console.log("🔘 [EVENTO] Botón cancelar inventario clickeado");
            cerrarModal();
        }

        // Botón X de cerrar modal de inventario
        if (e.target && e.target.id === "close-modal") {
            console.log("🔘 [EVENTO] Botón X de cerrar modal clickeado");
            cerrarModal();
        }
    });

    const btnMostrarDiferencias = document.getElementById("btn-mostrar-diferencias");
    if (btnMostrarDiferencias) {
        btnMostrarDiferencias.addEventListener("click", mostrarDiferencias);
    }

    // CORRECCIÓN: Usar delegación de eventos para modal de diferencias
    document.addEventListener("click", function (e) {
        // Botón cerrar diferencias
        if (e.target && e.target.id === "btn-cerrar-diferencias") {
            console.log("🔘 [EVENTO] Botón cerrar diferencias clickeado");
            document.getElementById("modal-diferencias").style.display = "none";
        }

        // Botón X de cerrar modal de diferencias
        if (e.target && e.target.id === "close-modal-diferencias") {
            console.log("🔘 [EVENTO] Botón X de cerrar diferencias clickeado");
            document.getElementById("modal-diferencias").style.display = "none";
        }
    });

    const btnGuardarCorrecciones = document.getElementById("btn-guardar-correcciones");
    if (btnGuardarCorrecciones) {
        btnGuardarCorrecciones.addEventListener("click", () => {
            document.getElementById("modal-diferencias").style.display = "none";
            mostrarMensaje("Las diferencias se aplicaran al finalizar el inventario", "info");
        });
    }

    // Botón para ajustes puntuales
    const btnAjustesPuntuales = document.getElementById("btn-ajustes-puntuales");
    if (btnAjustesPuntuales) {
        btnAjustesPuntuales.addEventListener("click", iniciarAjustesPuntuales);
    }

    const btnConfirmarSeleccion = document.getElementById("btn-confirmar-seleccion");
    if (btnConfirmarSeleccion) {
        btnConfirmarSeleccion.addEventListener("click", confirmarSeleccionIngredientes);
    }

    // Event listeners del modal de ajustes
    const btnContinuarAjustes = document.getElementById("btn-continuar-ajustes");
    if (btnContinuarAjustes) {
        btnContinuarAjustes.addEventListener("click", mostrarPasoAjuste);
    }

    // CORRECCIÓN: Usar delegación de eventos para modal de ajustes
    document.addEventListener("click", function (e) {
        // Botón cancelar ajustes (hay uno en cada paso)
        if (e.target && e.target.id === "btn-cancelar-ajustes") {
            console.log("🔘 [EVENTO] Botón cancelar ajustes clickeado");
            cerrarModalAjustes(true);
        }

        // Botón finalizar ajustes
        if (e.target && e.target.id === "btn-finalizar-ajustes") {
            console.log("🔘 [EVENTO] Botón finalizar ajustes clickeado");
            finalizarAjustesPuntuales();
        }

        // Botón X de cerrar modal de ajustes
        if (e.target && e.target.id === "close-modal-ajustes") {
            console.log("🔘 [EVENTO] Botón X de cerrar ajustes clickeado");
            cerrarModalAjustes(true);
        }
    });

    // Event listener para select de usuario de ajustes
    const selectUsuarioAjustes = document.getElementById("select-usuario-ajustes");
    if (selectUsuarioAjustes) {
        selectUsuarioAjustes.addEventListener("change", () => actualizarSeleccionUsuario(selectUsuarioAjustes, "usuarioAjustes", "btn-continuar-ajustes"));
    }

    // Event listener para seleccionar todos los ingredientes
    const seleccionarTodos = document.getElementById("seleccionar-todos");
    if (seleccionarTodos) {
        seleccionarTodos.addEventListener("change", function () {
            if (modoSeleccion) {
                const checkboxes = document.querySelectorAll(".checkbox-ingrediente");
                checkboxes.forEach(checkbox => {
                    checkbox.checked = this.checked;
                    const ingredienteId = checkbox.dataset.ingrediente;
                    const ingrediente = todosLosIngredientes.find(i => i.id.toString() === ingredienteId);

                    if (this.checked && ingrediente) {
                        ingredientesSeleccionados.set(ingredienteId, ingrediente);
                    } else {
                        ingredientesSeleccionados.delete(ingredienteId);
                    }
                });

                console.log("🔄 [SELECCION] Seleccionar todos:", this.checked ? "activado" : "desactivado");
                console.log("🔄 [SELECCION] Total seleccionados:", ingredientesSeleccionados.size);
            }
        });
    }

    console.log("✅ [INIT] Gestion de ingredientes inicializada correctamente");
});

// ===== FUNCIONES DE AJUSTES PUNTUALES =====

/**
 * Inicia el modo de ajustes puntuales
 */
function iniciarAjustesPuntuales() {
    console.log("⚙️ [AJUSTES] Iniciando ajustes puntuales");

    // Limpiar selecciones previas
    ingredientesSeleccionados.clear();

    // Activar modo selección en la tabla principal
    modoSeleccion = true;

    // Cambiar interfaz para modo selección
    document.querySelectorAll(".tabla-ingredientes").forEach(t => t.classList.add("modo-seleccion"));
    const container = document.getElementById("contenedor-sectores-acordeon");
    if (container) container.classList.add("modo-seleccion");
    const lblTodos = document.getElementById("label-seleccionar-todos");
    if (lblTodos) lblTodos.style.display = "inline-flex";

    // Cambiar botones del header
    document.getElementById("btn-ajustes-puntuales").style.display = "none";
    document.getElementById("btn-confirmar-seleccion").style.display = "inline-block";

    // Actualizar tabla para mostrar checkboxes
    actualizarTablaIngredientes(todosLosIngredientes);

    // Mostrar mensaje informativo
    mostrarMensaje("Seleccione los ingredientes que desea ajustar y luego presione 'Confirmar Selección'", "info");

    console.log("✅ [AJUSTES] Modo selección activado - Usuario puede seleccionar ingredientes");
}

/**
 * Confirma la selección de ingredientes y abre el modal de ajustes
 */
function confirmarSeleccionIngredientes() {
    console.log("✅ [SELECCION] Confirmando selección de ingredientes");
    console.log("✅ [SELECCION] Total seleccionados:", ingredientesSeleccionados.size);

    if (ingredientesSeleccionados.size === 0) {
        mostrarMensaje("Debe seleccionar al menos un ingrediente para ajustar", "error");
        return;
    }

    // Salir del modo selección visual
    document.querySelectorAll(".tabla-ingredientes").forEach(t => t.classList.remove("modo-seleccion"));
    const container = document.getElementById("contenedor-sectores-acordeon");
    if (container) container.classList.remove("modo-seleccion");
    const lblTodos = document.getElementById("label-seleccionar-todos");
    if (lblTodos) lblTodos.style.display = "none";

    // Restaurar botones del header
    document.getElementById("btn-ajustes-puntuales").style.display = "inline-block";
    document.getElementById("btn-confirmar-seleccion").style.display = "none";

    // Actualizar tabla sin checkboxes
    modoSeleccion = false;
    actualizarTablaIngredientes(todosLosIngredientes);

    // AHORA SÍ mostrar modal de ajustes con ingredientes ya seleccionados
    const modal = document.getElementById("modal-ajustes");
    if (modal) {
        modal.style.display = "block";

        // Mostrar paso de selección de usuario
        document.getElementById("paso-usuario-ajustes").style.display = "block";
        document.getElementById("paso-ajuste").style.display = "none";

        // Cargar usuarios para ajustes
        cargarUsuariosAjustes();
    }

    console.log("✅ [SELECCION] Selección confirmada, modal de ajustes abierto");
}

/**
 * Muestra el paso de ajuste de ingredientes
 */
function mostrarPasoAjuste() {
    console.log("📝 [AJUSTES] Mostrando paso de ajuste");

    // Cambiar pasos del modal
    document.getElementById("paso-usuario-ajustes").style.display = "none";
    document.getElementById("paso-ajuste").style.display = "block";

    // Mostrar ingredientes seleccionados
    mostrarIngredientesSeleccionados();

    console.log("✅ [AJUSTES] Paso de ajuste mostrado");
}

/**
 * Muestra los ingredientes seleccionados en el modal de ajustes con arquitectura DUAL (Kilos + Lotes/Bultos)
 */
function mostrarIngredientesSeleccionados() {
    console.log("📋 [AJUSTES] Mostrando ingredientes seleccionados con arquitectura dual");

    const contenedor = document.getElementById("ingredientes-seleccionados");
    if (!contenedor) {
        console.error("❌ [AJUSTES] No se encontró contenedor ingredientes-seleccionados");
        return;
    }

    contenedor.innerHTML = "";

    if (ingredientesSeleccionados.size === 0) {
        contenedor.innerHTML = "<p class='mensaje-info'>No hay ingredientes seleccionados</p>";
        return;
    }

    ingredientesSeleccionados.forEach((ingrediente) => {
        // Inicializar objeto de ajuste si no existe
        if (!ingrediente._ajuste) {
            const lotesAjuste = (ingrediente.lotes_cajas_cerradas || []).map(l => ({
                vinculo_id: l.vinculo_id,
                lote_id_supabase: l.lote_id_supabase,
                lote_codigo_corto: l.lote_codigo_corto || l.id_corto || (l.lote_id_supabase ? l.lote_id_supabase.substring(0, 8) : 'Lote'),
                id_corto: l.id_corto || l.lote_codigo_corto || (l.lote_id_supabase ? l.lote_id_supabase.substring(0, 8) : 'Lote'),
                cajas_sistema: parseFloat(l.cajas_disponibles || l.cantidad_asignada || 0),
                cajas_nuevas: parseFloat(l.cajas_disponibles || l.cantidad_asignada || 0),
                kilos_por_caja: parseFloat(l.kilos_por_caja || 0)
            }));

            const stockActualKilos = parseFloat(ingrediente.stock_actual || 0);
            const stockActualBultos = parseFloat(ingrediente.stock_bultos || 0);

            ingrediente._ajuste = {
                kilos_nuevos: stockActualKilos,
                bultos_nuevos: stockActualBultos,
                total_bultos_final: stockActualBultos,
                lotes: lotesAjuste,
                nuevo_lote_codigo: '',
                nuevo_lote_cajas: 0,
                nuevo_lote_kg_caja: 0,
                observacion: ''
            };
        }

        const aj = ingrediente._ajuste;
        const stockActualKilos = parseFloat(ingrediente.stock_actual || 0);
        const stockActualBultos = parseFloat(ingrediente.stock_bultos || 0);
        const diffKilos = aj.kilos_nuevos - stockActualKilos;

        // Renderizar lotes
        let lotesSectionHtml = '';
        if (aj.lotes && aj.lotes.length > 0) {
            lotesSectionHtml = aj.lotes.map(lote => {
                const diffLote = lote.cajas_nuevas - lote.cajas_sistema;
                return `
                    <div class="ajuste-lote-row" id="lote-row-${ingrediente.id}-${lote.vinculo_id}">
                        <div style="flex: 1;">
                            <div>
                                <span class="badge-lote-pill">#${lote.id_corto}</span>
                                <strong style="font-size: 0.85rem; margin-left: 4px;">${lote.kilos_por_caja ? lote.kilos_por_caja.toFixed(1) + ' kg/cj' : 'Caja'}</strong>
                            </div>
                            <small style="color: #64748b;">Sys: <strong>${lote.cajas_sistema} cj</strong></small>
                            <span id="diff-lote-${ingrediente.id}-${lote.vinculo_id}" style="font-size: 0.75rem; font-weight: 700; margin-left: 6px; color: ${diffLote > 0 ? '#16a34a' : (diffLote < 0 ? '#dc2626' : '#64748b')};">
                                (${diffLote >= 0 ? '+' : ''}${diffLote} cj)
                            </span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button type="button" class="ajuste-btn-step" onclick="window.cambiarCajasLoteAjuste(${ingrediente.id}, '${lote.vinculo_id}', -1)">-</button>
                            <input type="number" min="0" step="1" class="ajuste-input-cajas" 
                                   id="input-lote-${ingrediente.id}-${lote.vinculo_id}" 
                                   value="${lote.cajas_nuevas}" 
                                   oninput="window.cambiarCajasLoteAjusteDirecto(${ingrediente.id}, '${lote.vinculo_id}', this.value)">
                            <button type="button" class="ajuste-btn-step" onclick="window.cambiarCajasLoteAjuste(${ingrediente.id}, '${lote.vinculo_id}', 1)">+</button>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            // Sin lotes asignados previamente
            lotesSectionHtml = `
                <div class="ajuste-lote-row" style="background: #ffffff;">
                    <div style="flex: 1;">
                        <span style="font-weight: 700; color: #475569; font-size: 0.85rem;">Bultos / Cajas Cerradas:</span>
                        <div style="font-size: 0.75rem; color: #64748b;">Sys: <strong>${stockActualBultos} cj</strong></div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <button type="button" class="ajuste-btn-step" onclick="window.cambiarBultosDirectosAjuste(${ingrediente.id}, -1)">-</button>
                        <input type="number" min="0" step="1" class="ajuste-input-cajas" 
                               id="input-bultos-${ingrediente.id}" 
                               value="${aj.bultos_nuevos}" 
                               oninput="window.cambiarBultosDirectosAjusteDirecto(${ingrediente.id}, this.value)">
                        <button type="button" class="ajuste-btn-step" onclick="window.cambiarBultosDirectosAjuste(${ingrediente.id}, 1)">+</button>
                    </div>
                </div>
            `;
        }

        const card = document.createElement("div");
        card.className = "ajuste-item-card";
        card.id = `ajuste-card-${ingrediente.id}`;

        card.innerHTML = `
            <div class="ajuste-card-header">
                <div>
                    <h4 style="margin: 0; font-size: 1.15rem; color: #1e293b;">${ingrediente.nombre}</h4>
                    <div style="display: flex; gap: 8px; align-items: center; margin-top: 4px;">
                        <span style="font-size: 0.78rem; font-weight: 700; background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px;">ID: ${ingrediente.id}</span>
                        <span style="font-size: 0.78rem; font-weight: 700; background: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 4px;">COD: ${ingrediente.codigo || "N/A"}</span>
                        ${ingrediente.sector_nombre ? `<span style="font-size: 0.78rem; font-weight: 600; background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px;">📍 ${ingrediente.sector_nombre}</span>` : ''}
                    </div>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 0.8rem; color: #64748b;">Stock Sys:</span>
                    <div style="font-size: 0.9rem; font-weight: 700; color: #334155;">${stockActualKilos.toFixed(2)} kg | ${stockActualBultos} cj</div>
                </div>
            </div>

            <!-- GRILLA DUAL DE AJUSTE -->
            <div class="ajuste-dual-grid">
                <!-- COLUMNA 1: KILOS ABIERTOS (BALANZA) -->
                <div class="ajuste-box-kilos">
                    <div class="ajuste-box-title" style="color: #166534;">
                        <span>⚖️ 1. Kilos Abiertos (Balanza)</span>
                        <small style="color: #15803d; font-weight: 600;">Sys: ${stockActualKilos.toFixed(2)} ${ingrediente.unidad_medida || 'kg'}</small>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <input type="number" 
                               step="0.01" 
                               min="0" 
                               class="form-control" 
                               style="font-size: 1.15rem; font-weight: 700; width: 140px; padding: 6px 10px; border: 1.5px solid #86efac; border-radius: 6px;" 
                               id="input-kilos-ajuste-${ingrediente.id}" 
                               value="${aj.kilos_nuevos}" 
                               placeholder="${stockActualKilos.toFixed(2)}"
                               oninput="window.cambiarKilosAjuste(${ingrediente.id}, this.value)">
                        <span style="font-weight: 700; color: #475569;">${ingrediente.unidad_medida || 'kg'}</span>
                        <span id="diff-kilos-ajuste-${ingrediente.id}" 
                              style="font-size: 0.82rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: ${diffKilos >= 0 ? '#dcfce7' : '#fee2e2'}; color: ${diffKilos >= 0 ? '#166534' : '#991b1b'};">
                            Diff: ${diffKilos >= 0 ? '+' : ''}${diffKilos.toFixed(2)} kg
                        </span>
                    </div>
                </div>

                <!-- COLUMNA 2: BULTOS CERRADOS Y LOTES -->
                <div class="ajuste-box-bultos">
                    <div class="ajuste-box-title" style="color: #6b21a8;">
                        <span>📦 2. Bultos Cerrados y Lotes</span>
                        <span id="badge-total-bultos-ajuste-${ingrediente.id}" style="background: #f3e8ff; color: #7e22ce; font-weight: 700; padding: 2px 7px; border-radius: 4px; font-size: 0.8rem;">
                            ${aj.total_bultos_final} cj
                        </span>
                    </div>

                    <!-- Lista de Lotes existentes o cajas directas -->
                    <div id="lotes-container-ajuste-${ingrediente.id}">
                        ${lotesSectionHtml}
                    </div>

                    <!-- Sección para incorporar o asociar número de lote -->
                    <div style="margin-top: 8px;">
                        <button type="button" 
                                onclick="window.toggleNuevoLoteForm(${ingrediente.id})" 
                                style="background: white; border: 1px dashed #a855f7; color: #7e22ce; font-weight: 600; font-size: 0.78rem; padding: 4px 10px; border-radius: 5px; cursor: pointer; display: flex; align-items: center; gap: 4px; width: 100%; justify-content: center;">
                            🏷️ + Incorporar / Asociar Nuevo Número de Lote
                        </button>
                        <div id="form-nuevo-lote-${ingrediente.id}" style="display: none; background: #ffffff; border: 1px solid #d8b4fe; border-radius: 6px; padding: 8px 10px; margin-top: 6px;">
                            <div style="font-size: 0.75rem; font-weight: 700; color: #6b21a8; margin-bottom: 4px;">Nuevo Lote a Ingresar:</div>
                            <div style="display: grid; grid-template-columns: 1fr 70px 70px; gap: 6px;">
                                <input type="text" placeholder="N° / Código Lote" 
                                       id="nuevo-lote-cod-${ingrediente.id}" 
                                       style="font-size: 0.8rem; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px;"
                                       oninput="window.actualizarNuevoLoteAjuste(${ingrediente.id}, 'codigo', this.value)">
                                <input type="number" min="0" step="1" placeholder="Cajas" 
                                       id="nuevo-lote-cj-${ingrediente.id}" 
                                       style="font-size: 0.8rem; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px;"
                                       oninput="window.actualizarNuevoLoteAjuste(${ingrediente.id}, 'cajas', this.value)">
                                <input type="number" min="0" step="0.1" placeholder="Kg/Cj" 
                                       id="nuevo-lote-kg-${ingrediente.id}" 
                                       style="font-size: 0.8rem; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px;"
                                       oninput="window.actualizarNuevoLoteAjuste(${ingrediente.id}, 'kg_caja', this.value)">
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- BARRA DE RESUMEN DEL INGREDIENTE -->
            <div class="ajuste-summary-bar">
                <span id="potencial-ajuste-${ingrediente.id}" style="font-size: 0.85rem; font-weight: 700; color: #1e40af;">
                    Stock Total Resultante: 0.00 kg
                </span>
                <input type="text" placeholder="Motivo u observación del ajuste (opcional)" 
                       id="obs-ajuste-${ingrediente.id}" 
                       value="${aj.observacion || ''}"
                       style="width: 50%; font-size: 0.8rem; padding: 4px 8px; border: 1px solid #bfdbfe; border-radius: 4px; background: #fff;"
                       oninput="window.actualizarObsAjuste(${ingrediente.id}, this.value)">
            </div>
        `;

        contenedor.appendChild(card);
        window.recalcularAjusteCard(ingrediente.id);
    });

    console.log(`✅ [AJUSTES] ${ingredientesSeleccionados.size} ingredientes mostrados con tarjeta dual`);
}

// ===== FUNCIONES GLOBALES PARA MANIPULACIÓN INTERACTIVA DE AJUSTE DUAL =====

window.cambiarKilosAjuste = function (ingredienteId, valor) {
    const ing = ingredientesSeleccionados.get(ingredienteId.toString());
    if (!ing || !ing._ajuste) return;
    ing._ajuste.kilos_nuevos = parseFloat(valor) || 0;
    window.recalcularAjusteCard(ingredienteId);
};

window.cambiarCajasLoteAjuste = function (ingredienteId, vinculoId, delta) {
    const ing = ingredientesSeleccionados.get(ingredienteId.toString());
    if (!ing || !ing._ajuste) return;
    const lote = (ing._ajuste.lotes || []).find(l => String(l.vinculo_id) === String(vinculoId));
    if (!lote) return;

    let nuevaCant = (parseFloat(lote.cajas_nuevas) || 0) + delta;
    if (nuevaCant < 0) nuevaCant = 0;
    lote.cajas_nuevas = nuevaCant;

    const input = document.getElementById(`input-lote-${ingredienteId}-${vinculoId}`);
    if (input) input.value = nuevaCant;

    window.recalcularAjusteCard(ingredienteId);
};

window.cambiarCajasLoteAjusteDirecto = function (ingredienteId, vinculoId, valor) {
    const ing = ingredientesSeleccionados.get(ingredienteId.toString());
    if (!ing || !ing._ajuste) return;
    const lote = (ing._ajuste.lotes || []).find(l => String(l.vinculo_id) === String(vinculoId));
    if (!lote) return;

    let nuevaCant = parseFloat(valor) || 0;
    if (nuevaCant < 0) nuevaCant = 0;
    lote.cajas_nuevas = nuevaCant;

    window.recalcularAjusteCard(ingredienteId);
};

window.cambiarBultosDirectosAjuste = function (ingredienteId, delta) {
    const ing = ingredientesSeleccionados.get(ingredienteId.toString());
    if (!ing || !ing._ajuste) return;

    let nuevaCant = (parseFloat(ing._ajuste.bultos_nuevos) || 0) + delta;
    if (nuevaCant < 0) nuevaCant = 0;
    ing._ajuste.bultos_nuevos = nuevaCant;

    const input = document.getElementById(`input-bultos-${ingredienteId}`);
    if (input) input.value = nuevaCant;

    window.recalcularAjusteCard(ingredienteId);
};

window.cambiarBultosDirectosAjusteDirecto = function (ingredienteId, valor) {
    const ing = ingredientesSeleccionados.get(ingredienteId.toString());
    if (!ing || !ing._ajuste) return;

    let nuevaCant = parseFloat(valor) || 0;
    if (nuevaCant < 0) nuevaCant = 0;
    ing._ajuste.bultos_nuevos = nuevaCant;

    window.recalcularAjusteCard(ingredienteId);
};

window.toggleNuevoLoteForm = function (ingredienteId) {
    const form = document.getElementById(`form-nuevo-lote-${ingredienteId}`);
    if (form) {
        form.style.display = (form.style.display === 'none' || !form.style.display) ? 'block' : 'none';
    }
};

window.actualizarNuevoLoteAjuste = function (ingredienteId, campo, valor) {
    const ing = ingredientesSeleccionados.get(ingredienteId.toString());
    if (!ing || !ing._ajuste) return;

    if (campo === 'codigo') ing._ajuste.nuevo_lote_codigo = valor;
    if (campo === 'cajas') ing._ajuste.nuevo_lote_cajas = parseFloat(valor) || 0;
    if (campo === 'kg_caja') ing._ajuste.nuevo_lote_kg_caja = parseFloat(valor) || 0;

    window.recalcularAjusteCard(ingredienteId);
};

window.actualizarObsAjuste = function (ingredienteId, valor) {
    const ing = ingredientesSeleccionados.get(ingredienteId.toString());
    if (!ing || !ing._ajuste) return;
    ing._ajuste.observacion = valor;
};

window.recalcularAjusteCard = function (ingredienteId) {
    const ing = ingredientesSeleccionados.get(ingredienteId.toString());
    if (!ing || !ing._ajuste) return;

    const aj = ing._ajuste;
    const stockActualKilos = parseFloat(ing.stock_actual || 0);
    const kilosNuevos = parseFloat(aj.kilos_nuevos) || 0;
    const diffKilos = kilosNuevos - stockActualKilos;

    // Actualizar badge diff kilos
    const diffKilosEl = document.getElementById(`diff-kilos-ajuste-${ingredienteId}`);
    if (diffKilosEl) {
        diffKilosEl.textContent = `Diff: ${diffKilos >= 0 ? '+' : ''}${diffKilos.toFixed(2)} kg`;
        diffKilosEl.style.background = diffKilos >= 0 ? '#dcfce7' : '#fee2e2';
        diffKilosEl.style.color = diffKilos >= 0 ? '#166534' : '#991b1b';
    }

    // Calcular bultos y kilos de lotes
    let totalBultos = 0;
    let totalKilosLotes = 0;

    if (aj.lotes && aj.lotes.length > 0) {
        aj.lotes.forEach(lote => {
            const cj = parseFloat(lote.cajas_nuevas) || 0;
            const kgCj = parseFloat(lote.kilos_por_caja) || 0;
            totalBultos += cj;
            totalKilosLotes += (cj * kgCj);

            const diffEl = document.getElementById(`diff-lote-${ingredienteId}-${lote.vinculo_id}`);
            if (diffEl) {
                const diffL = cj - (parseFloat(lote.cajas_sistema) || 0);
                diffEl.textContent = `(${diffL >= 0 ? '+' : ''}${diffL} cj)`;
                diffEl.style.color = diffL > 0 ? '#16a34a' : (diffL < 0 ? '#dc2626' : '#64748b');
            }
        });
    } else {
        totalBultos = parseFloat(aj.bultos_nuevos) || 0;
        // Si no tiene kilos por caja en lotes, usar receta_base_kg o 0
        totalKilosLotes = totalBultos * (parseFloat(ing.receta_base_kg || 0) || 0);
    }

    // Si tiene nuevo lote manual
    if (aj.nuevo_lote_codigo && aj.nuevo_lote_codigo.trim() && parseFloat(aj.nuevo_lote_cajas) > 0) {
        const cjNuevo = parseFloat(aj.nuevo_lote_cajas);
        const kgCjNuevo = parseFloat(aj.nuevo_lote_kg_caja || 0);
        totalBultos += cjNuevo;
        totalKilosLotes += (cjNuevo * kgCjNuevo);
    }

    aj.total_bultos_final = totalBultos;

    const badgeBultosEl = document.getElementById(`badge-total-bultos-ajuste-${ingredienteId}`);
    if (badgeBultosEl) {
        badgeBultosEl.textContent = `${totalBultos} cj`;
    }

    const potencialTotal = kilosNuevos + totalKilosLotes;
    const potencialEl = document.getElementById(`potencial-ajuste-${ingredienteId}`);
    if (potencialEl) {
        potencialEl.textContent = `Stock Total Resultante: ${potencialTotal.toFixed(2)} kg (${totalBultos} cj + ${kilosNuevos.toFixed(2)} kg abiertos)`;
    }
};

/**
 * Carga usuarios para ajustes puntuales
 */
async function cargarUsuariosAjustes() {
    try {
        console.log("🔄 [USUARIOS-AJUSTES] Cargando usuarios para ajustes...");

        const response = await fetch("/api/usuarios?rol=3&activo=true");
        if (!response.ok) throw new Error("Error al cargar usuarios");

        const usuarios = await response.json();
        const select = document.getElementById("select-usuario-ajustes");
        if (select) {
            select.innerHTML = "<option value=''>-- Seleccionar usuario --</option>";

            usuarios.forEach(usuario => {
                const option = document.createElement("option");
                option.value = usuario.id;
                option.textContent = usuario.nombre_completo;
                select.appendChild(option);
            });
        }

        console.log("✅ [USUARIOS-AJUSTES] Usuarios cargados:", usuarios.length);

    } catch (error) {
        console.error("❌ [USUARIOS-AJUSTES] Error al cargar usuarios:", error);
        mostrarMensaje("No se pudieron cargar los usuarios para ajustes", "error");
    }
}

/**
 * Finaliza los ajustes puntuales aplicando los cambios con arquitectura Dual
 */
async function finalizarAjustesPuntuales() {
    try {
        console.log("🏁 [AJUSTES] ===== FINALIZANDO AJUSTES PUNTUALES DUAL =====");

        if (!usuarioAjustes) {
            mostrarMensaje("Debe seleccionar un usuario responsable", "error");
            return;
        }

        if (ingredientesSeleccionados.size === 0) {
            mostrarMensaje("No hay ingredientes seleccionados para ajustar", "error");
            return;
        }

        // Preparar ajustes con arquitectura dual
        const ajustes = [];

        ingredientesSeleccionados.forEach((ingrediente) => {
            const aj = ingrediente._ajuste || {};
            const stockActualKilos = parseFloat(ingrediente.stock_actual) || 0;
            const stockActualBultos = parseFloat(ingrediente.stock_bultos) || 0;

            const nuevoKilos = aj.kilos_nuevos !== undefined ? parseFloat(aj.kilos_nuevos) : stockActualKilos;
            const nuevoBultos = aj.total_bultos_final !== undefined ? parseFloat(aj.total_bultos_final) : (aj.bultos_nuevos !== undefined ? parseFloat(aj.bultos_nuevos) : stockActualBultos);

            const diffKilos = Math.round((nuevoKilos - stockActualKilos) * 1000) / 1000;
            const diffBultos = Math.round((nuevoBultos - stockActualBultos) * 1000) / 1000;

            const lotesAjustes = (aj.lotes || []).map(l => ({
                vinculo_id: l.vinculo_id,
                lote_id_supabase: l.lote_id_supabase,
                lote_codigo_corto: l.lote_codigo_corto || l.id_corto,
                cajas_sistema: parseFloat(l.cajas_sistema) || 0,
                cajas_nuevas: parseFloat(l.cajas_nuevas) || 0,
                kilos_por_caja: parseFloat(l.kilos_por_caja) || 0
            }));

            const lotesModificados = lotesAjustes.filter(l => l.cajas_nuevas !== l.cajas_sistema);
            const hayNuevoLote = aj.nuevo_lote_codigo && aj.nuevo_lote_codigo.trim() && parseFloat(aj.nuevo_lote_cajas) > 0;

            const hayCambio = Math.abs(diffKilos) > 0.001 || Math.abs(diffBultos) > 0.001 || lotesModificados.length > 0 || hayNuevoLote;

            if (hayCambio) {
                ajustes.push({
                    ingrediente_id: ingrediente.id,
                    articulo_numero: ingrediente.codigo || ingrediente.id.toString(),
                    usuario_id: usuarioAjustes,
                    tipo: "ajuste puntual",
                    stock_anterior_kilos: stockActualKilos,
                    stock_nuevo_kilos: nuevoKilos,
                    diferencia_kilos: diffKilos,
                    stock_anterior_bultos: stockActualBultos,
                    stock_nuevo_bultos: nuevoBultos,
                    diferencia_bultos: diffBultos,
                    lotes_ajustes: lotesAjustes,
                    nuevo_lote_codigo: hayNuevoLote ? aj.nuevo_lote_codigo.trim().toUpperCase() : null,
                    nuevo_lote_cajas: hayNuevoLote ? parseFloat(aj.nuevo_lote_cajas) : 0,
                    nuevo_lote_kg_caja: hayNuevoLote ? (parseFloat(aj.nuevo_lote_kg_caja) || 0) : 0,
                    observacion: aj.observacion || `Ajuste puntual dual - Kilos: ${stockActualKilos}->${nuevoKilos} | Bultos: ${stockActualBultos}->${nuevoBultos}`
                });

                console.log(`📝 [AJUSTES DUAL] ${ingrediente.nombre}: Kilos (${stockActualKilos} -> ${nuevoKilos}), Bultos (${stockActualBultos} -> ${nuevoBultos})`);
            }
        });

        if (ajustes.length === 0) {
            mostrarMensaje("No hay cambios detectados en los ingredientes seleccionados", "info");
            return;
        }

        console.log(`📤 [AJUSTES] Enviando ${ajustes.length} ajustes duales al servidor...`);
        mostrarMensaje("Aplicando ajustes de stock dual...", "info");

        // Enviar ajustes al servidor usando el endpoint batch
        const response = await fetch("/api/produccion/ingredientes-ajustes/batch", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ajustes })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || errorData.detalle || "Error al aplicar ajustes");
        }

        const resultado = await response.json();
        console.log("✅ [AJUSTES] Ajustes duales aplicados exitosamente:", resultado);

        mostrarMensaje(`Ajustes aplicados correctamente. ${ajustes.length} ingrediente(s) actualizado(s).`, "info");

        // Cerrar modal y limpiar
        cerrarModalAjustes(true);

        // Recargar ingredientes para mostrar cambios en la tabla principal
        await cargarIngredientes();

    } catch (error) {
        console.error("❌ [AJUSTES] Error al finalizar ajustes:", error);
        mostrarMensaje("Error al aplicar ajustes: " + error.message, "error");
    }
}

/**
 * Cierra el modal de ajustes y limpia el estado
 */
function cerrarModalAjustes(reiniciarTodo = true) {
    console.log("🔄 [AJUSTES] Cerrando modal de ajustes");

    const modal = document.getElementById("modal-ajustes");
    if (modal) {
        modal.style.display = "none";
    }

    if (reiniciarTodo) {
        // Limpiar selecciones
        ingredientesSeleccionados.clear();
        usuarioAjustes = null;

        // Salir del modo selección
        modoSeleccion = false;
        document.querySelectorAll(".tabla-ingredientes").forEach(t => t.classList.remove("modo-seleccion"));
        const container = document.getElementById("contenedor-sectores-acordeon");
        if (container) container.classList.remove("modo-seleccion");
        const lblTodos = document.getElementById("label-seleccionar-todos");
        if (lblTodos) lblTodos.style.display = "none";

        // Restaurar botones del header
        document.getElementById("btn-ajustes-puntuales").style.display = "inline-block";
        document.getElementById("btn-confirmar-seleccion").style.display = "none";

        // Limpiar contenedor
        const contenedor = document.getElementById("ingredientes-seleccionados");
        if (contenedor) {
            contenedor.innerHTML = "";
        }

        // Resetear pasos del modal
        document.getElementById("paso-usuario-ajustes").style.display = "block";
        document.getElementById("paso-ajuste").style.display = "none";

        // Resetear select de usuario
        const selectUsuario = document.getElementById("select-usuario-ajustes");
        if (selectUsuario) {
            selectUsuario.value = "";
        }

        const btnContinuar = document.getElementById("btn-continuar-ajustes");
        if (btnContinuar) {
            btnContinuar.disabled = true;
        }

        // Actualizar tabla sin checkboxes
        actualizarTablaIngredientes(todosLosIngredientes);

        console.log("✅ [AJUSTES] Modal cerrado y estado limpiado");
    }
}

function actualizarSeleccionUsuario(selectElement, variableGlobal, botonId) {
    const valorSeleccionado = selectElement.value;
    const boton = document.getElementById(botonId);

    if (valorSeleccionado) {
        if (variableGlobal === "usuarioSeleccionado") {
            usuarioSeleccionado = parseInt(valorSeleccionado);
            sessionStorage.setItem("inventario_usuario_id", valorSeleccionado);
        } else if (variableGlobal === "usuarioAjustes") {
            usuarioAjustes = parseInt(valorSeleccionado);
        }

        if (boton) boton.disabled = false;
        console.log("✅ [USUARIO] " + variableGlobal + " seleccionado:", valorSeleccionado);
    } else {
        if (variableGlobal === "usuarioSeleccionado") {
            usuarioSeleccionado = null;
            sessionStorage.removeItem("inventario_usuario_id");
        } else if (variableGlobal === "usuarioAjustes") {
            usuarioAjustes = null;
        }

        if (boton) boton.disabled = true;
        console.log("❌ [USUARIO] " + variableGlobal + " deseleccionado");
    }
}

// ==========================================
// 🔍 BUSQUEDA Y ESCANEO PC (MODO DUAL)
// ==========================================
function sonarBeepPC(frecuencia = 950, duracion = 0.08) {
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

window.procesarLoteArticuloActualPC = function (codigo) {
    if (!window.articuloActualPC || !codigo) return;
    const term = codigo.trim().toLowerCase();
    const cleanTerm = term.replace(/^l[:\s-]*/i, '').trim();

    let lista = window.listaMaestraPC || [];
    if (lista.length === 0 && typeof todosLosIngredientes !== 'undefined') {
        lista = todosLosIngredientes;
    }

    // 1. ¿Es el código de OTRO ingrediente?
    const siguienteIngrediente = lista.find(i =>
        i.id !== window.articuloActualPC.id && (
            String(i.codigo || '').toLowerCase() === term ||
            String(i.codigo_barras || '').toLowerCase() === term ||
            String(i.id) === term
        )
    );

    if (siguienteIngrediente) {
        console.log("🔄 [TRANSICION PRODUCTO PC] Detectado nuevo ingrediente:", siguienteIngrediente.nombre);
        window.confirmarConteoPC();
        sonarBeepPC(650, 0.12);
        mostrarMensaje(`🔄 Siguiente: ${siguienteIngrediente.nombre}`, "info");
        window.cargarArticuloPC(siguienteIngrediente, 'lotes');
        return;
    }

    // 2. Buscar coincidencia en los lotes existentes de este artículo
    if (!window.articuloActualPC.lotes_contados) window.articuloActualPC.lotes_contados = [];

    let loteMatch = window.articuloActualPC.lotes_contados.find(l => {
        const loteId = String(l.lote_id_supabase || '').toLowerCase();
        const idCorto = String(l.id_corto || '').toLowerCase();
        const loteCodCorto = String(l.lote_codigo_corto || '').toLowerCase();
        return loteId === term || loteId === cleanTerm ||
               idCorto === term || idCorto === cleanTerm ||
               loteCodCorto === term || loteCodCorto === cleanTerm ||
               (cleanTerm.length >= 3 && (loteId.includes(cleanTerm) || idCorto.includes(cleanTerm)));
    });

    // 3. Si no existe, crearlo dinámicamente
    if (!loteMatch) {
        const idDisplay = (cleanTerm || term).substring(0, 12).toUpperCase();
        console.log(`✨ [NUEVO LOTE DINAMICO PC] Registrando lote '${idDisplay}' en:`, window.articuloActualPC.nombre);

        let kgCaja = 25;
        if (window.articuloActualPC.kilos_por_bulto && parseFloat(window.articuloActualPC.kilos_por_bulto) > 0) {
            kgCaja = parseFloat(window.articuloActualPC.kilos_por_bulto);
        } else if (window.articuloActualPC.lotes_contados.length > 0) {
            const conKg = window.articuloActualPC.lotes_contados.find(l => parseFloat(l.kilos_por_caja) > 0);
            if (conKg) kgCaja = parseFloat(conKg.kilos_por_caja);
        } else if (parseFloat(window.articuloActualPC.stock_bultos) > 0 && parseFloat(window.articuloActualPC.stock_actual) > 0) {
            kgCaja = Math.round((parseFloat(window.articuloActualPC.stock_actual) / parseFloat(window.articuloActualPC.stock_bultos)) * 100) / 100;
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
        window.articuloActualPC.lotes_contados.push(loteMatch);
        renderizarLotesArticuloActualPC();
    }

    // 4. Sumar +1 bulto
    sumarCajaLotePC(loteMatch.vinculo_id, 1);
    sonarBeepPC(1100, 0.09);
};

function manejarBusquedaDirectaPC(texto, modo = 'balanza') {
    if (!texto) return;
    const term = texto.trim().toLowerCase();
    const cleanTerm = term.replace(/^l[:\s-]*/i, '').trim();
    console.log(`🔍 [BUSQUEDA DIRECTA PC] [Modo: ${modo}] Término:`, term);

    let lista = window.listaMaestraPC || [];
    if (lista.length === 0 && typeof todosLosIngredientes !== 'undefined') {
        lista = todosLosIngredientes;
    }

    // 1. Coincidencia exacta de ingrediente (Código, ID, Código de barras)
    const exacto = lista.find(i =>
        String(i.codigo || '').toLowerCase() === term ||
        String(i.codigo_barras || '').toLowerCase() === term ||
        String(i.id) === term
    );

    if (exacto) {
        console.log("🎯 [MATCH EXACTO PC] Ingrediente:", exacto.nombre);
        cargarArticuloPC(exacto, modo === 'lote' ? 'lotes' : 'balanza');
        sonarBeepPC(880, 0.08);
        return;
    }

    // 2. Si el modo es explícitamente 'lote', o si coincide con un lote ya cargado en el artículo actual
    if (modo === 'lote') {
        if (window.articuloActualPC) {
            window.procesarLoteArticuloActualPC(texto);
            return;
        }
    } else if (window.articuloActualPC && Array.isArray(window.articuloActualPC.lotes_contados)) {
        const esLoteDelArticulo = window.articuloActualPC.lotes_contados.some(l => {
            const loteId = String(l.lote_id_supabase || '').toLowerCase();
            const idCorto = String(l.id_corto || '').toLowerCase();
            const loteCodCorto = String(l.lote_codigo_corto || '').toLowerCase();
            return loteId === term || loteId === cleanTerm || idCorto === term || idCorto === cleanTerm || loteCodCorto === term || loteCodCorto === cleanTerm;
        });
        if (esLoteDelArticulo) {
            window.procesarLoteArticuloActualPC(texto);
            return;
        }
    }

    // 3. Coincidencia por Código de Lote en cualquier ingrediente del inventario
    for (const ing of lista) {
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
            console.log(`📦 [SCAN LOTE GLOBAL PC] Coincidencia de lote '${term}' en:`, ing.nombre);
            cargarArticuloPC(ing, 'lotes');
            sumarCajaLotePC(loteEncontrado.vinculo_id, 1);
            sonarBeepPC(1100, 0.09);
            mostrarMensaje(`📦 ${ing.nombre} -> +1 bulto Lote #${loteEncontrado.id_corto}`, "info");
            return;
        }
    }

    // 4. Búsqueda por texto inteligente (espacios = AND)
    const terminos = term.split(' ').filter(t => t.length > 0);
    const matches = lista.filter(ing => {
        const nombre = (ing.nombre || '').toLowerCase();
        return terminos.every(t => nombre.includes(t));
    }).slice(0, 10);

    if (matches.length === 1) {
        cargarArticuloPC(matches[0], modo === 'lote' ? 'lotes' : 'balanza');
    } else if (matches.length > 1) {
        mostrarSugerenciasBusquedaPC(matches);
    } else {
        mostrarMensaje(`❌ No se encontraron ingredientes o lotes con: ${texto}`, "error");
    }
}

async function buscarYAgregarIngrediente(texto, forceAction = false) {
    manejarBusquedaDirectaPC(texto, 'balanza');
}

function mostrarSugerenciasBusquedaPC(matches) {
    const list = document.getElementById('search-dropdown-pc');
    if (!list) return;
    list.innerHTML = '';

    if (!matches || matches.length === 0) {
        list.style.display = 'none';
        return;
    }

    matches.forEach(ing => {
        const div = document.createElement('div');
        div.className = 'dropdown-item-pc';
        div.innerHTML = `
            <div style="font-weight: 700; color: #1e293b;">${ing.nombre}</div>
            <div style="font-size: 0.78rem; color: #64748b;">
                COD: ${ing.codigo || ing.id} | Sys: ${parseFloat(ing.stock_actual || 0).toFixed(2)} kg | ${parseFloat(ing.stock_bultos || 0)} cj
            </div>
        `;
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            seleccionarSugerenciaPC(ing.id);
        });
        list.appendChild(div);
    });

    list.style.display = 'block';
}

function ocultarDropdownPC() {
    const list = document.getElementById('search-dropdown-pc');
    if (list) list.style.display = 'none';
}

window.seleccionarSugerenciaPC = function (id) {
    ocultarDropdownPC();
    cargarArticuloPC(id);
    const buscador = document.getElementById('buscador-pc');
    if (buscador) buscador.value = '';
};



async function finalizarInventario() {
    if (window._finalizandoInventarioActivo) {
        console.warn("⚠️ [FINALIZAR] Ya existe una finalización en curso, ignorando llamada duplicada");
        return;
    }
    window._finalizandoInventarioActivo = true;

    const btnInferior = document.getElementById("btn-finalizar-inventario");
    const btnHeader = document.getElementById("btn-finalizar-inventario-pc-header");

    const deshabilitarBotones = (deshabilitar, texto) => {
        if (btnInferior) {
            btnInferior.disabled = deshabilitar;
            btnInferior.textContent = texto;
        }
        if (btnHeader) {
            btnHeader.disabled = deshabilitar;
            btnHeader.textContent = texto;
        }
    };

    try {
        console.log("🏁 [FINALIZAR] ===== INICIANDO FINALIZACION DE INVENTARIO =====");
        const idSesion = sessionId || window.sessionId || sessionStorage.getItem("inventario_session_id");
        console.log("🏁 [FINALIZAR] Session ID:", idSesion);
        console.log("🏁 [FINALIZAR] Ingredientes en inventario:", ingredientesInventario.size);

        if (!idSesion) {
            console.error("❌ [FINALIZAR] ERROR: No hay sesion activa");
            alert("⚠️ Error: No hay una sesión de inventario activa.");
            window._finalizandoInventarioActivo = false;
            return;
        }

        deshabilitarBotones(true, "⏳ Finalizando...");

        // Obtener todos los ingredientes del sector para procesar
        const sectoresInfo = sessionStorage.getItem("sectoresInventario");
        let sectoresSeleccionados = [];

        if (sectoresInfo === "TODOS" || !sectoresInfo) {
            sectoresSeleccionados = "TODOS";
        } else {
            try {
                sectoresSeleccionados = JSON.parse(sectoresInfo);
            } catch (e) {
                console.error("❌ [FINALIZAR] Error al parsear sectores:", e);
                sectoresSeleccionados = "TODOS";
            }
        }

        console.log("📊 [FINALIZAR] Obteniendo ingredientes de sectores para ajuste...");
        let ingredientesDeSectores = [];
        if (window.listaMaestraPC && window.listaMaestraPC.length > 0) {
            console.log("📦 [FINALIZAR] Utilizando listaMaestraPC capturada al inicio de la sesión:", window.listaMaestraPC.length);
            ingredientesDeSectores = window.listaMaestraPC;
        } else {
            try {
                const response = await fetch("/api/produccion/ingredientes/por-sectores", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ sectores: sectoresSeleccionados })
                });
                if (response.ok) {
                    ingredientesDeSectores = await response.json();
                }
            } catch (e) {
                console.warn("⚠️ [FINALIZAR] Error al obtener por-sectores vía API:", e);
            }
        }

        // Auto-flush obligatorio si la PC tiene una tarjeta activa en pantalla
        if (window.articuloActualPC && typeof window.autoFlushArticuloActualPC === 'function') {
            window.autoFlushArticuloActualPC();
        }

        // Confirmación determinista al usuario con aviso de ítems del sector no contados
        const noContados = ingredientesDeSectores.filter(ing => !ingredientesInventario.has(ing.id.toString()));
        let msgConfirm = "¿Desea finalizar el inventario y consolidar los ajustes de stock?";
        if (noContados.length > 0) {
            msgConfirm = `⚠️ Atención: Hay ${noContados.length} ingrediente(s) de los sectores seleccionados que no fueron contados.\n\nTodo ingrediente no contado se sincronizará automáticamente a CERO (0 kg / 0 bultos) por no tener existencia física en el depósito.\n\n¿Desea finalizar el inventario y aplicar los ajustes?`;
        }
        if (!confirm(msgConfirm)) {
            deshabilitarBotones(false, "🏁 Finalizar Inventario");
            window._finalizandoInventarioActivo = false;
            return;
        }

        // Crear array con TODOS los ingredientes del sector (contados y no contados) con estructura DUAL
        const ingredientesParaProcesar = [];

        ingredientesDeSectores.forEach(ingrediente => {
            const ingredienteContado = ingredientesInventario.get(ingrediente.id.toString());

            if (ingredienteContado) {
                // Ingrediente fue contado - usar desglose dual
                const kilosContados = normalizarDecimalUniversal(ingredienteContado.kilos_sueltos_contados !== undefined ? ingredienteContado.kilos_sueltos_contados : ingredienteContado.stock_contado);
                const bultosContados = ingredienteContado.total_bultos_contados !== undefined ? normalizarDecimalUniversal(ingredienteContado.total_bultos_contados) : normalizarDecimalUniversal(ingrediente.stock_bultos || 0);
                const lotesLimpios = (ingredienteContado.lotes_contados || []).filter(l => {
                    const c = normalizarDecimalUniversal(l.cajas_contadas);
                    const sis = normalizarDecimalUniversal(l.cajas_sistema);
                    return c > 0 || sis > 0;
                });

                ingredientesParaProcesar.push({
                    ingrediente_id: ingrediente.id,
                    stock_actual: normalizarDecimalUniversal(ingrediente.stock_actual || 0),
                    stock_bultos: normalizarDecimalUniversal(ingrediente.stock_bultos || 0),
                    stock_contado: kilosContados,
                    kilos_sueltos_contados: kilosContados,
                    lotes_contados: lotesLimpios,
                    total_bultos_contados: bultosContados,
                    stock_potencial_contado: ingredienteContado.stock_potencial_contado,
                    nombre: ingrediente.nombre,
                    contado: true,
                    no_tocado: false
                });
                console.log(`📝 [FINALIZAR DUAL] Contado: ${ingrediente.nombre} | Kilos: ${kilosContados} | Bultos: ${bultosContados}`);
            } else {
                // Ingrediente del sector NO contado: no existe físicamente en el depósito -> CERO (0 kg, 0 bultos)
                const stockKilosActual = normalizarDecimalUniversal(ingrediente.stock_actual || 0);
                const stockBultosActual = normalizarDecimalUniversal(ingrediente.stock_bultos || 0);
                ingredientesParaProcesar.push({
                    ingrediente_id: ingrediente.id,
                    stock_actual: stockKilosActual,
                    stock_bultos: stockBultosActual,
                    stock_contado: 0,
                    kilos_sueltos_contados: 0,
                    total_bultos_contados: 0,
                    stock_potencial_contado: 0,
                    lotes_contados: [],
                    nombre: ingrediente.nombre,
                    contado: true,
                    no_tocado: false,
                    no_encontrado_cero: true
                });
                console.log(`🧹 [FINALIZAR SECTOR CERO] ${ingrediente.nombre}: no contado -> ajuste a 0 kg y 0 bultos`);
            }
        });

        // Añadir items contados en ingredientesInventario que no estaban en ingredientesDeSectores
        const idsProcesados = new Set(ingredientesParaProcesar.map(it => it.ingrediente_id.toString()));
        ingredientesInventario.forEach((invItem, idStr) => {
            if (!idsProcesados.has(idStr)) {
                const kilosContados = normalizarDecimalUniversal(invItem.kilos_sueltos_contados !== undefined ? invItem.kilos_sueltos_contados : invItem.stock_contado);
                const bultosContados = invItem.total_bultos_contados !== undefined ? normalizarDecimalUniversal(invItem.total_bultos_contados) : normalizarDecimalUniversal(invItem.stock_bultos || 0);
                const lotesLimpios = (invItem.lotes_contados || []).filter(l => {
                    const c = normalizarDecimalUniversal(l.cajas_contadas);
                    const sis = normalizarDecimalUniversal(l.cajas_sistema);
                    return c > 0 || sis > 0;
                });
                ingredientesParaProcesar.push({
                    ingrediente_id: parseInt(idStr),
                    stock_actual: normalizarDecimalUniversal(invItem.stock_actual || 0),
                    stock_bultos: normalizarDecimalUniversal(invItem.stock_bultos || 0),
                    stock_contado: kilosContados,
                    kilos_sueltos_contados: kilosContados,
                    lotes_contados: lotesLimpios,
                    total_bultos_contados: bultosContados,
                    stock_potencial_contado: invItem.stock_potencial_contado,
                    nombre: invItem.nombre,
                    contado: true,
                    no_tocado: false
                });
            }
        });

        console.log("📋 [FINALIZAR] Preparando datos para envio...");
        console.log("📋 [FINALIZAR] Total ingredientes del sector a procesar:", ingredientesParaProcesar.length);
        console.log("📋 [FINALIZAR] Ingredientes contados/modificados:", ingredientesInventario.size);

        const idUsuarioFinal = usuarioSeleccionado 
            || parseInt(sessionStorage.getItem("inventario_usuario_id"))
            || (document.getElementById("select-usuario") ? parseInt(document.getElementById("select-usuario").value) : null)
            || 1;

        const duracionTotal = detenerCronometroPC();
        const fechaInicio = inicioTimestampPC ? new Date(inicioTimestampPC).toISOString() : (sessionStorage.getItem("inventario_inicio_ts") ? new Date(parseInt(sessionStorage.getItem("inventario_inicio_ts"))).toISOString() : null);

        console.log("📤 [FINALIZAR] Enviando request a API /aplicar...");
        const responseAplicar = await fetch("/api/produccion/inventario-ingredientes/" + idSesion + "/aplicar", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                ingredientes_contados: ingredientesParaProcesar,
                usuario_id: idUsuarioFinal,
                sectores: sectoresSeleccionados,
                duracion_segundos: duracionTotal,
                fecha_inicio: fechaInicio
            })
        });

        if (!responseAplicar.ok) {
            const errorData = await responseAplicar.json().catch(() => ({}));
            const msg = (errorData.error && errorData.detalle)
                ? `${errorData.error}: ${errorData.detalle}`
                : (errorData.error || errorData.detalle || "Error HTTP " + responseAplicar.status + " al aplicar inventario");
            throw new Error(msg);
        }

        const resultado = await responseAplicar.json();
        console.log("✅ [FINALIZAR] Inventario finalizado exitosamente:", resultado);

        // Notificar al socket para sincronizar con el móvil
        if (socket && socket.connected) {
            socket.emit('notificar_fin_inventario', {
                sessionId: idSesion,
                resultado
            });
        }

        // Ocultar panel de conteo
        const pasoConteo = document.getElementById('paso-conteo');
        if (pasoConteo) {
            pasoConteo.style.display = 'none';
        }

        // Desplegar Modal de Resultados y Auditoría con opción de descargar PDF
        if (typeof window.mostrarModalResultadoInventarioPC === 'function') {
            window.mostrarModalResultadoInventarioPC(resultado);
        } else {
            cerrarModal();
            await cargarIngredientes();
        }

    } catch (error) {
        console.error("❌ [FINALIZAR] Error al finalizar inventario:", error);
        alert("❌ Error al finalizar inventario: " + error.message);
        deshabilitarBotones(false, "🏁 Finalizar Inventario");
        window._finalizandoInventarioActivo = false;
    }
}
window.finalizarInventario = finalizarInventario;


window.tabActualPC = 'carga'; // Default tab

function configurarPanelControlUI() {
    console.log("🎨 [PANEL] Configurando UI del Panel de Control");

    // Reset steps
    document.querySelectorAll('.paso-modal').forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
    });

    const pasoConteo = document.getElementById('paso-conteo');
    if (pasoConteo) {
        pasoConteo.classList.add('active');
        pasoConteo.style.display = 'block';
    }

    // Init Defaults
    cambiarTabPC('carga');

    // Bind global buttons
    const btnImpSector = document.getElementById('btn-imprimir-sector-pc');
    if (btnImpSector) btnImpSector.onclick = imprimirEtiquetaSectorPC;

    const btnCancel = document.getElementById('btn-cancelar-inventario-pc');
    if (btnCancel) btnCancel.onclick = cancelarInventarioPC;
}

window.cambiarTabPC = function (tab) {
    window.tabActualPC = tab;

    // 1. Update Buttons
    document.querySelectorAll('.tab-btn').forEach(b => {
        if (b.id === `tab-${tab}-pc`) {
            b.classList.add('active');
            b.style.background = 'white';
            b.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            b.style.color = '#333';
        } else {
            b.classList.remove('active');
            b.style.background = 'none';
            b.style.boxShadow = 'none';
            b.style.color = '#666';
        }
    });

    // 2. Update Views
    // Hide all
    ['carga', 'pendientes', 'contados'].forEach(t => {
        const v = document.getElementById(`view-${t}-pc`);
        if (v) v.style.display = 'none';
    });

    // Show active
    const activeView = document.getElementById(`view-${tab}-pc`);
    if (activeView) activeView.style.display = 'block';

    // 3. Render lists if needed
    if (tab === 'pendientes' || tab === 'contados') {
        renderizarListasPC();
    }
};

// ==========================================
// 🖥️ CONTROLADORES DE ESCANEO DUAL Y FICHA PC
// ==========================================
window.articuloActualPC = null;
let escaneoDualPCConfigurado = false;

function configurarEscaneoDualPC() {
    if (escaneoDualPCConfigurado) return;
    escaneoDualPCConfigurado = true;
    console.log("🛠️ [PC SCAN] Inicializando controladores de Escaneo Dual PC...");

    // 1. Buscador Balanza PC (Modo Kilos)
    const buscadorPC = document.getElementById('buscador-pc');
    if (buscadorPC) {
        buscadorPC.addEventListener('input', (e) => {
            const val = e.target.value;
            if (/^[a-zA-Z0-9_-]{6,}$/.test(val.trim())) {
                ocultarDropdownPC();
                return;
            }
            const valTrimmed = val.trim();
            if (valTrimmed.length >= 2) {
                const lista = window.listaMaestraPC || todosLosIngredientes || [];
                const terminos = valTrimmed.toLowerCase().split(' ').filter(t => t.length > 0);
                const matches = lista.filter(ing => {
                    const nombre = (ing.nombre || '').toLowerCase();
                    return terminos.every(t => nombre.includes(t));
                }).slice(0, 10);
                mostrarSugerenciasBusquedaPC(matches);
            } else {
                ocultarDropdownPC();
            }
        });

        buscadorPC.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                ocultarDropdownPC();
                manejarBusquedaDirectaPC(buscadorPC.value.trim(), 'balanza');
                buscadorPC.value = '';
            }
        });
    }

    // 2. Buscador Lote Global PC (Modo Bultos)
    const buscadorLotePC = document.getElementById('buscador-lote-pc');
    if (buscadorLotePC) {
        buscadorLotePC.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val.length >= 6) {
                console.log("📦 [BUSCADOR LOTE PC] Escaneo recibido:", val);
                manejarBusquedaDirectaPC(val, 'lote');
                buscadorLotePC.value = '';
            }
        });

        buscadorLotePC.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = buscadorLotePC.value.trim();
                if (val) {
                    console.log("📦 [BUSCADOR LOTE PC ENTER] Escaneo:", val);
                    manejarBusquedaDirectaPC(val, 'lote');
                    buscadorLotePC.value = '';
                }
            }
        });
    }

    // 3. Ficha Activa: Input Kilos Sueltos
    const inputCantPC = document.getElementById('cantidad-pc');
    if (inputCantPC) {
        inputCantPC.addEventListener('input', (e) => {
            if (e.target.value.includes(',')) {
                const pos = e.target.selectionStart;
                e.target.value = e.target.value.replace(/,/g, '.');
                e.target.setSelectionRange(pos, pos);
            }
            actualizarCalculoDualPC();
            emitirSincronizacionDualPC();
        });
        inputCantPC.addEventListener('blur', (e) => {
            e.target.value = e.target.value.replace(/,/g, '.');
            actualizarCalculoDualPC();
            emitirSincronizacionDualPC();
        });
        inputCantPC.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.confirmarConteoPC();
            }
        });
    }

    // 4. Ficha Activa: Input Lote Directo en Ficha
    const inputScanLotePC = document.getElementById('input-scan-lote-pc');
    if (inputScanLotePC) {
        let scanTimerPC = null;
        const ejecutarDisparoLotePC = (val) => {
            if (scanTimerPC) clearTimeout(scanTimerPC);
            const raw = val.trim();
            if (!raw) return;
            console.log("📦 [INPUT SCAN LOTE PC DISPARO]:", raw);
            window.procesarLoteArticuloActualPC(raw);
            inputScanLotePC.value = '';
            setTimeout(() => inputScanLotePC.focus(), 30);
        };

        inputScanLotePC.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                ejecutarDisparoLotePC(inputScanLotePC.value);
            }
        });

        inputScanLotePC.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (scanTimerPC) clearTimeout(scanTimerPC);
            if (val.length >= 4) {
                scanTimerPC = setTimeout(() => {
                    if (inputScanLotePC.value.trim().length >= 4) {
                        ejecutarDisparoLotePC(inputScanLotePC.value);
                    }
                }, 280);
            }
        });
    }

    // 5. Botones de Acción de Ficha
    const btnCargarPC = document.getElementById('btn-cargar-pc');
    if (btnCargarPC) btnCargarPC.onclick = window.confirmarConteoPC;

    const btnCerrarTarjetaPC = document.getElementById('btn-cerrar-tarjeta-pc');
    if (btnCerrarTarjetaPC) btnCerrarTarjetaPC.onclick = window.cerrarTarjetaPC;

    // Cerrar dropdown al hacer click afuera
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#buscador-pc') && !e.target.closest('#search-dropdown-pc')) {
            ocultarDropdownPC();
        }
    });
}

window.cargarArticuloPC = function (idOItem, modo = 'balanza') {
    // Si ya había un artículo activo en PC distinto, hacer auto-flush antes de cargar el nuevo
    if (window.articuloActualPC && typeof window.autoFlushArticuloActualPC === 'function') {
        const idNuevo = typeof idOItem === 'object' && idOItem !== null ? idOItem.id : idOItem;
        if (String(window.articuloActualPC.id) !== String(idNuevo)) {
            window.autoFlushArticuloActualPC();
        }
    }

    let item = null;
    if (typeof idOItem === 'object' && idOItem !== null) {
        item = idOItem;
    } else {
        const lista = window.listaMaestraPC || todosLosIngredientes || [];
        item = lista.find(i => String(i.id) === String(idOItem));
    }

    if (!item) {
        console.error("❌ [CARGAR ARTICULO PC] No se encontró el ingrediente:", idOItem);
        return;
    }

    // Si ya existe en inventario, usar datos guardados
    if (ingredientesInventario.has(item.id.toString())) {
        const existente = ingredientesInventario.get(item.id.toString());
        window.articuloActualPC = {
            ...item,
            ...existente,
            lotes_contados: existente.lotes_contados ? JSON.parse(JSON.stringify(existente.lotes_contados)) : []
        };
    } else {
        const lotesBase = (item.lotes_cajas_cerradas || []).map(l => ({
            vinculo_id: l.vinculo_id || ('lote_' + (l.id_corto || Math.random().toString(36).substr(2, 5))),
            lote_id_supabase: l.lote_id_supabase,
            id_corto: l.id_corto || (l.lote_id_supabase ? l.lote_id_supabase.substring(0, 8) : 'LOTE'),
            cajas_sistema: parseFloat(l.cajas_disponibles || l.cantidad_asignada || 0),
            cajas_contadas: l.cajas_contadas !== undefined ? parseFloat(l.cajas_contadas) : 0,
            kilos_por_caja: parseFloat(l.kilos_por_caja || 0),
            costo_kilo: l.costo_kilo || 0
        }));

        window.articuloActualPC = {
            ...item,
            kilos_sueltos_contados: 0,
            stock_contado: 0,
            lotes_contados: lotesBase,
            total_bultos_contados: 0,
            stock_potencial_contado: 0
        };
    }

    // Asegurarse de mostrar tab carga
    cambiarTabPC('carga');

    // Mostrar panel activo y ocultar placeholder
    const panel = document.getElementById('info-articulo-pc');
    if (panel) panel.style.display = 'block';
    const placeholder = document.getElementById('placeholder-carga-pc');
    if (placeholder) placeholder.style.display = 'none';

    // Rellenar cabecera
    const nombreEl = document.getElementById('nombre-articulo-pc');
    if (nombreEl) nombreEl.textContent = item.nombre;

    const codigoEl = document.getElementById('codigo-articulo-pc');
    if (codigoEl) codigoEl.textContent = `COD: ${item.codigo || item.id}`;

    const badgeEl = document.getElementById('stock-sistema-badge-pc');
    if (badgeEl) badgeEl.textContent = `Sys: ${parseFloat(item.stock_actual || 0).toFixed(2)} kg | ${parseFloat(item.stock_bultos || 0)} cj`;

    const kilosSysEl = document.getElementById('kilos-sys-label-pc');
    if (kilosSysEl) kilosSysEl.textContent = `Sys: ${parseFloat(item.stock_actual || 0).toFixed(2)} kg`;

    const unidadEl = document.getElementById('unidad-label-pc');
    if (unidadEl) unidadEl.textContent = item.unidad_medida || 'kg';

    // Input kilos
    const inputCant = document.getElementById('cantidad-pc');
    if (inputCant) {
        const kilosVal = window.articuloActualPC.kilos_sueltos_contados;
        inputCant.value = kilosVal !== undefined && kilosVal !== 0 ? kilosVal : '';
        inputCant.placeholder = `${parseFloat(item.stock_actual || 0).toFixed(2)}`;
    }

    // Botón confirmar peso sugerido PC
    const btnSugeridoPC = document.getElementById('btn-confirmar-sugerido-pc');
    const txtSugeridoPC = document.getElementById('txt-sugerido-kilos-pc');
    if (btnSugeridoPC && txtSugeridoPC) {
        const pesoSugerido = parseFloat(item.stock_actual || 0);
        txtSugeridoPC.textContent = pesoSugerido.toFixed(2);
        btnSugeridoPC.style.display = 'inline-flex';
        btnSugeridoPC.onclick = () => window.confirmarKilosSugeridosPC();
    }

    // Renderizar lotes y cálculos
    renderizarLotesArticuloActualPC();
    actualizarCalculoDualPC();

    // Botón imprimir
    const btnImpCard = document.getElementById('btn-imprimir-pc-card');
    if (btnImpCard) {
        btnImpCard.onclick = () => window.imprimirEtiquetaIngredientePC(item.id);
    }

    // Foco y banner guiado según modo
    const inputLotePC = document.getElementById('input-scan-lote-pc');
    const bannerLotePC = document.getElementById('banner-instruccion-lote-pc');
    if (modo === 'lotes' || modo === 'lote') {
        if (bannerLotePC) {
            bannerLotePC.style.display = 'block';
            bannerLotePC.innerHTML = `🎯 <strong>MODO BULTOS:</strong> Dispará a la etiqueta de lote de cada bolsa de <strong>${item.nombre}</strong> (+1 por disparo)`;
        }
        if (inputLotePC) {
            setTimeout(() => {
                inputLotePC.focus();
                inputLotePC.select();
            }, 100);
        }
    } else {
        if (bannerLotePC) bannerLotePC.style.display = 'none';
        if (inputCant) {
            setTimeout(() => {
                inputCant.focus();
                inputCant.select();
            }, 100);
        }
    }
};

function renderizarLotesArticuloActualPC() {
    const container = document.getElementById('contenedor-lotes-pc');
    if (!container || !window.articuloActualPC) return;

    container.innerHTML = '';
    const lotes = window.articuloActualPC.lotes_contados || [];

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
        row.className = 'lote-counter-row-pc';
        row.innerHTML = `
            <div style="flex: 1;">
                <div>
                    <span style="background: #f3e8ff; color: #7e22ce; font-weight: 700; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; border: 1px solid #d8b4fe;">#${lote.id_corto}</span>
                    <strong style="font-size: 0.85rem; margin-left: 5px;">${lote.kilos_por_caja ? lote.kilos_por_caja.toFixed(1) + ' kg/cj' : 'Caja'}</strong>
                </div>
                <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">
                    Sys: <strong>${lote.cajas_sistema || 0} cj</strong> (${((lote.cajas_sistema || 0) * (lote.kilos_por_caja || 0)).toFixed(1)} kg)
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
                <button type="button" class="btn-lote-qty-pc" onclick="window.sumarCajaLotePC('${lote.vinculo_id}', -1)">-</button>
                <input type="number" class="input-lote-cajas-pc" id="input-lote-pc-${lote.vinculo_id}" value="${lote.cajas_contadas || 0}" min="0" onchange="window.cambiarCajasLoteManualPC('${lote.vinculo_id}', this.value)">
                <button type="button" class="btn-lote-qty-pc" onclick="window.sumarCajaLotePC('${lote.vinculo_id}', 1)">+</button>
                <button type="button" class="btn btn-sm btn-outline-danger" style="padding: 2px 6px; font-size: 0.8rem; border: none; background: #fee2e2; border-radius: 4px; cursor: pointer;" title="Eliminar este lote" onclick="window.eliminarLotePC('${lote.vinculo_id}')">🗑️</button>
            </div>
        `;
        container.appendChild(row);
    });
}

window.eliminarLotePC = function (vinculoId) {
    if (!window.articuloActualPC || !window.articuloActualPC.lotes_contados) return;
    const idx = window.articuloActualPC.lotes_contados.findIndex(l => String(l.vinculo_id) === String(vinculoId));
    if (idx !== -1) {
        const borrado = window.articuloActualPC.lotes_contados.splice(idx, 1)[0];
        renderizarLotesArticuloActualPC();
        actualizarCalculoDualPC();
        emitirSincronizacionDualPC();
        mostrarMensaje(`🗑️ Lote descartado: #${borrado.id_corto || vinculoId}`, "info");
    }
};

window.sumarCajaLotePC = function (vinculoId, delta) {
    if (!window.articuloActualPC || !window.articuloActualPC.lotes_contados) return;
    const idx = window.articuloActualPC.lotes_contados.findIndex(l => String(l.vinculo_id) === String(vinculoId));
    if (idx === -1) return;
    const lote = window.articuloActualPC.lotes_contados[idx];

    let nuevaCantidad = (normalizarDecimalUniversal(lote.cajas_contadas) || 0) + delta;
    if (nuevaCantidad <= 0) {
        nuevaCantidad = 0;
        // Si es un lote sintético sin cajas de sistema y el usuario lo reduce a 0, eliminarlo
        const esSintetico = !lote.cajas_sistema || lote.cajas_sistema === 0 || String(lote.vinculo_id).startsWith('lote_');
        if (esSintetico && delta < 0) {
            window.articuloActualPC.lotes_contados.splice(idx, 1);
            renderizarLotesArticuloActualPC();
            actualizarCalculoDualPC();
            emitirSincronizacionDualPC();
            mostrarMensaje(`🗑️ Lote descartado: #${lote.id_corto}`, "info");
            return;
        }
    }
    lote.cajas_contadas = nuevaCantidad;

    const inputEl = document.getElementById(`input-lote-pc-${vinculoId}`);
    if (inputEl) {
        inputEl.value = nuevaCantidad;
        inputEl.style.backgroundColor = '#dcfce7';
        setTimeout(() => inputEl.style.backgroundColor = '#ffffff', 600);
    }

    actualizarCalculoDualPC();
    emitirSincronizacionDualPC();
    mostrarMensaje(`📦 Lote #${lote.id_corto}: ${nuevaCantidad} cj (${(nuevaCantidad * (normalizarDecimalUniversal(lote.kilos_por_caja) || 0)).toFixed(1)} kg)`, "info");

    // Mantener siempre el foco en el input de lote para disparos continuos en PC
    const inputLotePC = document.getElementById('input-scan-lote-pc');
    if (inputLotePC) setTimeout(() => inputLotePC.focus(), 30);
};

window.cambiarCajasLoteManualPC = function (vinculoId, valor) {
    if (!window.articuloActualPC || !window.articuloActualPC.lotes_contados) return;
    const lote = window.articuloActualPC.lotes_contados.find(l => String(l.vinculo_id) === String(vinculoId));
    if (!lote) return;

    let valNum = normalizarDecimalUniversal(valor) || 0;
    if (valNum < 0) valNum = 0;
    lote.cajas_contadas = valNum;

    actualizarCalculoDualPC();
    emitirSincronizacionDualPC();
};

function actualizarCalculoDualPC() {
    if (!window.articuloActualPC) return;

    const inputKilos = document.getElementById('cantidad-pc');
    const diffText = document.getElementById('diff-text-pc');
    const badgeCajas = document.getElementById('badge-total-cajas-contadas-pc');
    const liveTotal = document.getElementById('total-potencial-live-pc');

    let kilosSueltos = normalizarDecimalUniversal(inputKilos ? inputKilos.value : '');

    const sysKilos = normalizarDecimalUniversal(window.articuloActualPC.stock_actual || 0);
    const diffKilos = kilosSueltos - sysKilos;

    if (diffText) {
        diffText.textContent = `Diff: ${diffKilos >= 0 ? '+' : ''}${diffKilos.toFixed(2)} kg`;
        diffText.style.background = diffKilos >= 0 ? '#dcfce7' : '#fee2e2';
        diffText.style.color = diffKilos >= 0 ? '#166534' : '#991b1b';
    }

    let totalCajas = 0;
    let totalKilosLotes = 0;
    if (window.articuloActualPC.lotes_contados && Array.isArray(window.articuloActualPC.lotes_contados)) {
        window.articuloActualPC.lotes_contados.forEach(l => {
            const cajas = normalizarDecimalUniversal(l.cajas_contadas) || 0;
            const kgCaja = normalizarDecimalUniversal(l.kilos_por_caja) || 0;
            totalCajas += cajas;
            totalKilosLotes += (cajas * kgCaja);
        });
    }

    const stockPotencialTotal = kilosSueltos + totalKilosLotes;

    window.articuloActualPC.kilos_sueltos_contados = kilosSueltos;
    window.articuloActualPC.stock_contado = kilosSueltos;
    window.articuloActualPC.total_bultos_contados = totalCajas;
    window.articuloActualPC.stock_potencial_contado = stockPotencialTotal;

    if (badgeCajas) badgeCajas.textContent = `${totalCajas} cj`;
    if (liveTotal) liveTotal.textContent = `${stockPotencialTotal.toFixed(2)} kg`;
}

function emitirSincronizacionDualPC() {
    if (!window.articuloActualPC) return;
    const inputKilos = document.getElementById('cantidad-pc');
    let kilosSueltos = normalizarDecimalUniversal(inputKilos ? inputKilos.value : '');

    let totalCajas = 0;
    let totalKilosLotes = 0;
    (window.articuloActualPC.lotes_contados || []).forEach(l => {
        const c = normalizarDecimalUniversal(l.cajas_contadas) || 0;
        totalCajas += c;
        totalKilosLotes += (c * (normalizarDecimalUniversal(l.kilos_por_caja) || 0));
    });

    const stockPotencial = kilosSueltos + totalKilosLotes;

    window.articuloActualPC.kilos_sueltos_contados = kilosSueltos;
    window.articuloActualPC.stock_contado = kilosSueltos;
    window.articuloActualPC.total_bultos_contados = totalCajas;
    window.articuloActualPC.stock_potencial_contado = stockPotencial;
    window.articuloActualPC.contado = true;
    window.articuloActualPC.no_tocado = false;

    // Actualizar en mapa local y global
    ingredientesInventario.set(window.articuloActualPC.id.toString(), {
        ...window.articuloActualPC
    });
    window.ingredientesInventario = ingredientesInventario;

    console.log(`📤 [SYNC DUAL PC] Emitiendo a móvil y BD: ${window.articuloActualPC.nombre} | Bultos: ${totalCajas} | Potencial: ${stockPotencial.toFixed(2)} kg`);

    // 1. WebSocket a móviles
    if (socket && socket.connected) {
        socket.emit('articulo_escaneado', {
            sessionId,
            ingrediente: {
                ...window.articuloActualPC
            },
            cantidad: kilosSueltos,
            finalizar_item: false
        });
    }

    // 2. Persistir directamente en BD PostgreSQL
    persistirItemEnServidorPC(window.articuloActualPC, kilosSueltos, window.articuloActualPC.lotes_contados, totalCajas);

    actualizarContadoresPC();
    if (typeof renderizarListasModalPC === 'function') renderizarListasModalPC();
}

window.confirmarConteoPC = function () {
    if (!window.articuloActualPC) return;
    const inputCant = document.getElementById('cantidad-pc');
    let kilosSueltos = normalizarDecimalUniversal(inputCant ? inputCant.value : '');

    let totalCajas = 0;
    let totalKilosLotes = 0;
    (window.articuloActualPC.lotes_contados || []).forEach(l => {
        const c = normalizarDecimalUniversal(l.cajas_contadas) || 0;
        totalCajas += c;
        totalKilosLotes += (c * (normalizarDecimalUniversal(l.kilos_por_caja) || 0));
    });

    const stockPotencial = kilosSueltos + totalKilosLotes;

    window.articuloActualPC.kilos_sueltos_contados = kilosSueltos;
    window.articuloActualPC.stock_contado = kilosSueltos;
    window.articuloActualPC.total_bultos_contados = totalCajas;
    window.articuloActualPC.stock_potencial_contado = stockPotencial;
    window.articuloActualPC.contado = true;
    window.articuloActualPC.no_tocado = false;

    // Guardar en Map local y global
    ingredientesInventario.set(window.articuloActualPC.id.toString(), {
        ...window.articuloActualPC
    });
    window.ingredientesInventario = ingredientesInventario;

    if (socket && socket.connected) {
        socket.emit('articulo_escaneado', {
            sessionId,
            ingrediente: {
                ...window.articuloActualPC
            },
            cantidad: kilosSueltos,
            finalizar_item: true
        });
    }

    // Persistir directamente en BD PostgreSQL
    persistirItemEnServidorPC(window.articuloActualPC, kilosSueltos, window.articuloActualPC.lotes_contados, totalCajas);

    mostrarMensaje(`✅ ${window.articuloActualPC.nombre} guardado correctamente`, "success");
    window.cerrarTarjetaPC();
    renderizarListasPC();
    if (typeof renderizarListasModalPC === 'function') renderizarListasModalPC();
};

window.autoFlushArticuloActualPC = function () {
    if (!window.articuloActualPC) return;
    const inputCant = document.getElementById('cantidad-pc');
    const valorRaw = inputCant ? inputCant.value : '';
    const kilosSueltos = normalizarDecimalUniversal(valorRaw);

    let totalCajas = 0;
    let totalKilosLotes = 0;
    (window.articuloActualPC.lotes_contados || []).forEach(l => {
        const c = normalizarDecimalUniversal(l.cajas_contadas) || 0;
        totalCajas += c;
        totalKilosLotes += (c * (normalizarDecimalUniversal(l.kilos_por_caja) || 0));
    });

    const stockPotencial = kilosSueltos + totalKilosLotes;
    const tieneDatos = (inputCant && valorRaw.trim() !== '') || totalCajas > 0 || window.articuloActualPC.contado;
    if (!tieneDatos) return;

    console.log(`💾 [AUTO-FLUSH PC] Guardando conteo de ${window.articuloActualPC.nombre}: Kilos=${kilosSueltos}, Cajas=${totalCajas}`);

    window.articuloActualPC.kilos_sueltos_contados = kilosSueltos;
    window.articuloActualPC.stock_contado = kilosSueltos;
    window.articuloActualPC.total_bultos_contados = totalCajas;
    window.articuloActualPC.stock_potencial_contado = stockPotencial;
    window.articuloActualPC.contado = true;
    window.articuloActualPC.no_tocado = false;

    ingredientesInventario.set(window.articuloActualPC.id.toString(), {
        ...window.articuloActualPC
    });
    window.ingredientesInventario = ingredientesInventario;

    if (socket && socket.connected) {
        socket.emit('articulo_escaneado', {
            sessionId: sessionId || window.sessionId,
            ingrediente: { ...window.articuloActualPC },
            cantidad: kilosSueltos,
            finalizar_item: true
        });
    }

    persistirItemEnServidorPC(window.articuloActualPC, kilosSueltos, window.articuloActualPC.lotes_contados, totalCajas);
    actualizarContadoresPC();
};

window.cerrarTarjetaPC = function () {
    if (typeof window.autoFlushArticuloActualPC === 'function') {
        window.autoFlushArticuloActualPC();
    }
    window.articuloActualPC = null;
    const panel = document.getElementById('info-articulo-pc');
    if (panel) panel.style.display = 'none';
    const banner = document.getElementById('banner-instruccion-lote-pc');
    if (banner) banner.style.display = 'none';
    const btnSugeridoPC = document.getElementById('btn-confirmar-sugerido-pc');
    if (btnSugeridoPC) btnSugeridoPC.style.display = 'none';
    const placeholder = document.getElementById('placeholder-carga-pc');
    if (placeholder) placeholder.style.display = 'block';

    const buscadorPC = document.getElementById('buscador-pc');
    if (buscadorPC) {
        buscadorPC.value = '';
        buscadorPC.focus();
    }
};

window.confirmarKilosSugeridosPC = function () {
    if (!window.articuloActualPC) return;
    const pesoSugerido = parseFloat(window.articuloActualPC.stock_actual || 0);
    const inputCant = document.getElementById('cantidad-pc');
    if (inputCant) {
        inputCant.value = pesoSugerido.toFixed(2);
    }
    window.articuloActualPC.kilos_sueltos_contados = pesoSugerido;
    actualizarCalculoDualPC();
    emitirSincronizacionDualPC();

    mostrarMensaje(`✅ Peso confirmado (${pesoSugerido.toFixed(2)} kg). Listo para cargar bultos.`, "info");

    const inputLotePC = document.getElementById('input-scan-lote-pc');
    if (inputLotePC) {
        setTimeout(() => {
            inputLotePC.focus();
            inputLotePC.select();
        }, 80);
    }
};

function cancelarInventarioPC() {
    if (confirm("⛔ ¿ESTÁS SEGURO DE CANCELAR EL INVENTARIO?\n\nEsta acción cerrará la sesión para TODOS (PC y Móvil) y perderá los datos no guardados.")) {
        socket.emit('cancelar_inventario', { sessionId });
    }
}


/**
 * Renderiza la tabla de ingredientes basada en la lista maestra (Modo Unificado con Movil)
 * Reemplaza la logica antigua que usaba arrays separados.
 */
function renderizarListasPC(tab = 'carga') { // carga (default) | contados | pendientes
    const container = document.getElementById("tabla-ingredientes-body");
    if (!container) return;

    container.innerHTML = "";

    // Obtener lista base (window.listaMaestraPC es la fuente de verdad sincronizada)
    let lista = window.listaMaestraPC || [];

    // Si no hay lista maestra aun, intentar usar todosLosIngredientes si tiene ID
    if (lista.length === 0 && (typeof todosLosIngredientes !== 'undefined') && todosLosIngredientes.length > 0) {
        lista = todosLosIngredientes;
    }

    if (lista.length === 0) {
        container.innerHTML = `<tr><td colspan="6" class="mensaje-info">Esperando datos de ingredientes...</td></tr>`;
        return;
    }

    // Filtrar segun Tab
    if (tab === 'pendientes') {
        lista = lista.filter(i => {
            const enInv = ingredientesInventario.has(i.id.toString());
            return !enInv;
        });
    } else if (tab === 'contados') {
        lista = lista.filter(i => ingredientesInventario.has(i.id.toString()));
    }
    // 'carga' muestra TODO.

    lista.forEach(ing => {
        // Estado contado
        const enInventario = ingredientesInventario.has(ing.id.toString());
        const datosInv = enInventario ? ingredientesInventario.get(ing.id.toString()) : null;

        const stockSistemaKilos = normalizarDecimalUniversal(ing.stock_actual || ing.stock_sistema || 0);
        const stockSistemaBultos = normalizarDecimalUniversal(ing.stock_bultos || 0);
        
        const kilosContados = datosInv ? normalizarDecimalUniversal(datosInv.kilos_sueltos_contados !== undefined ? datosInv.kilos_sueltos_contados : (datosInv.stock_contado || 0)) : 0;
        const bultosContados = datosInv ? normalizarDecimalUniversal(datosInv.total_bultos_contados || 0) : 0;
        const potencialContado = datosInv ? normalizarDecimalUniversal(datosInv.stock_potencial_contado || kilosContados) : 0;
        
        const diffKilos = kilosContados - stockSistemaKilos;
        const diffBultos = bultosContados - stockSistemaBultos;

        const tr = document.createElement("tr");
        tr.setAttribute("data-ingrediente-id", ing.id);

        if (enInventario) {
            tr.classList.add("fila-contada");
            tr.style.backgroundColor = "#e8f5e9";
        }

        tr.innerHTML = `
            <td>${ing.id}</td>
            <td>
                <strong>${ing.nombre}</strong>
                ${bultosContados > 0 || stockSistemaBultos > 0 ? `<br><small style="color: #7e22ce; font-weight: 600;">📦 ${bultosContados} / ${stockSistemaBultos} cj</small>` : ''}
            </td>
            <td>${ing.codigo || ''}</td>
            <td>
                <div>${stockSistemaKilos.toFixed(2)} ${ing.unidad_medida || 'kg'}</div>
                <small style="color: #64748b;">${stockSistemaBultos} cj cerradas</small>
            </td>
            <td class="stock-input">
                <div style="display: flex; gap: 4px; align-items: center;">
                    <input type="text"
                           inputmode="decimal"
                           value="${enInventario ? kilosContados : ''}" 
                           placeholder="Kilos"
                           class="form-control form-control-sm"
                           style="width: 80px;"
                           onchange="actualizarStockDesdePC(${ing.id}, this.value)"
                           title="Kilos sueltos contados">
                    <span class="badge" style="background: #f3e8ff; color: #7e22ce; border: 1px solid #d8b4fe; font-size: 0.8rem; padding: 4px 6px;">
                        ${bultosContados} cj
                    </span>
                </div>
                ${enInventario ? `<small style="color: #166534; font-weight: 700;">Total: ${potencialContado.toFixed(2)} kg</small>` : ''}
            </td>
            <td class="diferencia-stock ${enInventario ? (diffKilos >= 0 ? 'text-success' : 'text-danger') : ''}">
                ${enInventario ? `<div>${diffKilos >= 0 ? '+' : ''}${diffKilos.toFixed(2)} kg</div><small style="color: #64748b;">${diffBultos >= 0 ? '+' : ''}${diffBultos} cj</small>` : '-'}
            </td>
        `;

        container.appendChild(tr);
    });

    // ... (Main Table logic remains) ...
    // NOTE: Keep previous logic for main table, append this:

    // --- LOGIC FOR MODAL TABS (If active) ---
    renderizarListasModalPC();
    actualizarContadoresPC();

    console.log(`📊 [RENDER PC] Tabla actualizada (${tab}). ${lista.length} items mostrados.`);
}

/**
 * Renderiza las listas dentro del Modal de Conteo (Inventario Activo)
 */
function renderizarListasModalPC() {
    const pendientesDiv = document.getElementById("lista-pendientes-pc");
    const contadosDiv = document.getElementById("lista-contados-pc");

    // Solo si el modal existe
    if (!pendientesDiv || !contadosDiv) return;

    let lista = window.listaMaestraPC || [];
    if (lista.length === 0 && (typeof todosLosIngredientes !== 'undefined') && todosLosIngredientes.length > 0) {
        lista = todosLosIngredientes;
    }

    // 1. PENDIENTES
    const pendientes = lista.filter(i => !ingredientesInventario.has(i.id.toString()));
    pendientesDiv.innerHTML = pendientes.length === 0
        ? '<div style="text-align:center; padding:20px; color:#999;">¡Todo contado! 🎉</div>'
        : pendientes.map(ing => `
            <div class="item-pendiente" style="padding: 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="window.cargarArticuloPC(${ing.id})">
                <div>
                    <strong>${ing.nombre}</strong><br>
                    <small style="color:#888;">Cod: ${ing.codigo || '-'}</small>
                    <div style="margin-top: 2px;">
                        <span style="background: #e0f2fe; color: #0369a1; padding: 1px 6px; border-radius: 4px; font-size: 0.8em; font-weight: 600;">
                            Sys: ${normalizarDecimalUniversal(ing.stock_actual || 0).toFixed(2)} kg
                        </span>
                        <span style="background: #f3e8ff; color: #7e22ce; padding: 1px 6px; border-radius: 4px; font-size: 0.8em; font-weight: 600; margin-left: 4px;">
                            ${normalizarDecimalUniversal(ing.stock_bultos || 0)} cj
                        </span>
                    </div>
                </div>
                <div style="text-align: right; display: flex; gap: 5px; align-items: center;">
                    <button class="btn btn-sm btn-outline-secondary" onclick="event.stopPropagation(); window.imprimirEtiquetaIngredientePC(${ing.id})" title="Imprimir Etiqueta">
                        🖨️
                    </button>
                    <button class="btn-sm btn-primary" onclick="event.stopPropagation(); window.cargarArticuloPC(${ing.id})" title="Cargar Conteo">
                        📝
                    </button>
                </div>
            </div>
        `).join('');

    // 2. CONTADOS
    const contados = lista.filter(i => ingredientesInventario.has(i.id.toString()));
    contadosDiv.innerHTML = contados.length === 0
        ? '<div style="text-align:center; padding:20px; color:#999;">Aún no hay items contados</div>'
        : contados.map(ing => {
            const dataInv = ingredientesInventario.get(ing.id.toString());
            const kilos = normalizarDecimalUniversal(dataInv.kilos_sueltos_contados !== undefined ? dataInv.kilos_sueltos_contados : (dataInv.stock_contado || 0));
            const bultos = normalizarDecimalUniversal(dataInv.total_bultos_contados !== undefined ? dataInv.total_bultos_contados : 0);
            const pot = normalizarDecimalUniversal(dataInv.stock_potencial_contado !== undefined ? dataInv.stock_potencial_contado : kilos);

            let lotesTxt = '';
            if (dataInv.lotes_contados && dataInv.lotes_contados.length > 0) {
                lotesTxt = dataInv.lotes_contados.filter(l => (normalizarDecimalUniversal(l.cajas_contadas) || 0) > 0)
                    .map(l => `#${l.id_corto}: ${l.cajas_contadas} cj`).join(', ');
            }

            return `
            <div class="item-contado" style="padding: 10px; border-bottom: 1px solid #eee; background: #f9fff9; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="window.cargarArticuloPC(${ing.id})">
                <div>
                    <strong style="color: #15803d;">${ing.nombre}</strong><br>
                    <small style="color:#166534; font-weight: bold;">Contado: ${kilos.toFixed(2)} kg | ${bultos} cj</small>
                    ${lotesTxt ? `<br><small style="color: #7e22ce; font-weight: 600;">🏷️ Lotes: ${lotesTxt}</small>` : ''}
                    <br><small style="color: #1e40af; font-weight: 700;">Potencial: ${pot.toFixed(2)} kg</small>
                </div>
                 <div style="text-align: right; display: flex; gap: 5px; align-items: center;">
                    <button class="btn btn-sm btn-outline-secondary" onclick="event.stopPropagation(); window.imprimirEtiquetaIngredientePC(${ing.id})" title="Imprimir Etiqueta">
                        🖨️
                    </button>
                    <button class="btn-sm btn-secondary" onclick="event.stopPropagation(); window.cargarArticuloPC(${ing.id})" title="Editar Conteo">
                        ✏️
                    </button>
                </div>
            </div>
        `}).join('');
}

/**
 * Imprime etiqueta individual desde PC
 */
window.imprimirEtiquetaIngredientePC = (id) => {
    const item = window.listaMaestraPC.find(i => i.id === id);
    if (item) {
        console.log("🖨️ [PRINT PC] Solicitando impresión para:", item.nombre);
        socket.emit('imprimir_etiqueta_ingrediente', {
            sessionId,
            ingrediente: item,
            impresora: 'ZEBRA_FRENTE'
        });
        mostrarToast("🖨️ Enviando a impresora...");
    } else {
        mostrarMensaje("Error al encontrar ingrediente para imprimir", "error");
    }
};

function actualizarContadoresPC() {
    let lista = window.listaMaestraPC || [];
    if (lista.length === 0 && (typeof todosLosIngredientes !== 'undefined') && todosLosIngredientes.length > 0) {
        lista = todosLosIngredientes;
    }

    const total = lista.length;
    const contadosReal = lista.filter(i => ingredientesInventario.has(i.id.toString())).length;
    const pendientesCount = total - contadosReal;

    const elPend = document.getElementById("count-pendientes-pc");
    const elCont = document.getElementById("count-contados-pc");

    if (elPend) elPend.textContent = pendientesCount;
    if (elCont) elCont.textContent = contadosReal;

    console.log(`📊 [COUNTERS PC] Pend: ${pendientesCount}, Cont: ${contadosReal}`);
}

// Helper para input manual en PC (Bidireccionalidad)
window.actualizarStockDesdePC = (id, valor) => {
    if (valor === undefined || valor === null) {
        window.cargarArticuloPC(id);
        return;
    }

    let valClean = String(valor).replace(',', '.').trim();
    if (valClean === "") valClean = "0";
    const cantidad = parseFloat(valClean);
    if (isNaN(cantidad)) return;

    window.cargarArticuloPC(id);
    const inputCant = document.getElementById('cantidad-pc');
    if (inputCant) {
        inputCant.value = cantidad;
        actualizarCalculoDualPC();
        emitirSincronizacionDualPC();
    }
};


function imprimirEtiquetaSectorPC() {
    // Usar sectores global (Recuperado de window)
    const sectores = window.sectoresSesionActiva;

    if (typeof sectores === 'undefined' || !sectores || !sectores.length) {
        mostrarMensaje("⚠️ No hay sectores disponibles para imprimir.", "error");
        console.error("❌ [PRINT] window.sectoresSesionActiva es undefined o vacio", sectores);
        return;
    }

    const modal = document.getElementById('modal-imprimir-sectores');
    const container = document.getElementById('lista-sectores-imprimir');
    const btnConfirmar = document.getElementById('btn-confirmar-impresion-sectores');
    const btnCancelar = document.getElementById('btn-cancelar-impresion-sectores');
    const btnCerrar = document.getElementById('close-modal-imprimir-sectores');

    if (!modal || !container) {
        console.error("❌ Modal de impresion de sectores no encontrado");
        return;
    }

    // Limpiar y poblar lista
    container.innerHTML = '';

    // Header para "Marcar Todos"
    const divTodos = document.createElement('div');
    divTodos.style.padding = "5px";
    divTodos.style.borderBottom = "1px solid #eee";
    divTodos.style.marginBottom = "5px";
    divTodos.innerHTML = `
        <label style="font-weight: bold; display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="check-todos-sectores-print" checked> 
            <span style="margin-left: 8px;">Seleccionar Todos</span>
        </label>
    `;
    container.appendChild(divTodos);

    const checkTodos = divTodos.querySelector('input');

    // Listar sectores
    sectores.forEach((sect, index) => {
        const desc = typeof sect === 'object' ? (sect.descripcion || sect.nombre || '') : String(sect);

        // Intentar limpiar el nombre para mostrarlo bonito
        let nombreMostrar = desc;
        const match = desc.match(/["']([^"']+)["']/);
        if (match && match[1]) nombreMostrar = `Sector ${match[1].toUpperCase()}`;

        const div = document.createElement('div');
        div.className = 'sector-item-print';
        div.style.padding = "8px";
        div.style.borderBottom = "1px solid #f0f0f0";
        div.innerHTML = `
            <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox" class="check-sector-print" value="${index}" checked>
                <span style="margin-left: 10px;">${nombreMostrar}</span>
            </label>
        `;
        container.appendChild(div);
    });

    // Evento para "Marcar Todos"
    checkTodos.onchange = (e) => {
        const checks = container.querySelectorAll('.check-sector-print');
        checks.forEach(c => c.checked = e.target.checked);
    };

    // Mostrar Modal
    modal.style.display = 'block';

    // Handler Cancelar/Cerrar
    const cerrarModal = () => {
        modal.style.display = 'none';
    };
    btnCancelar.onclick = cerrarModal;
    btnCerrar.onclick = cerrarModal;

    // Handler Confirmar
    btnConfirmar.onclick = () => {
        const selectedIndices = Array.from(container.querySelectorAll('.check-sector-print:checked')).map(c => parseInt(c.value));

        if (selectedIndices.length === 0) {
            alert("⚠️ Selecciona al menos un sector para imprimir.");
            return;
        }

        if (confirm(`¿Imprimir etiquetas para ${selectedIndices.length} sectores seleccionados?`)) {
            let imprimidos = 0;

            selectedIndices.forEach(idx => {
                const s = sectores[idx];
                const cleanDesc = typeof s === 'object' ? (s.descripcion || s.nombre || '') : String(s);

                socket.emit('imprimir_etiqueta_sector', { sector: cleanDesc });
                imprimidos++;
            });

            mostrarMensaje(`🖨️ Enviando ${imprimidos} etiquetas de sector...`, "info");
            cerrarModal();
        }
    };
}

// ===== MODAL DE RESULTADOS / AUDITORÍA DE INVENTARIO (PC) =====

window.mostrarModalResultadoInventarioPC = function (resultado, esDesdeHistorial = false) {
    const modal = document.getElementById('modal-resultado-inventario-pc');
    if (!modal) {
        console.warn("⚠️ Modal de resultado no encontrado");
        return;
    }

    window.ultimoResultadoInventario = resultado;
    modal.style.zIndex = '2000';

    // Metadatos y título
    const tituloModal = document.getElementById('res-modal-titulo');
    if (tituloModal) {
        tituloModal.textContent = esDesdeHistorial ? '📸 Foto Histórica de Inventario' : 'Auditoría de Inventario Finalizado';
    }

    const elSectores = document.getElementById('res-modal-sectores');
    if (elSectores) {
        let secText = 'TODOS';
        if (Array.isArray(resultado.sectores)) {
            secText = resultado.sectores.join(', ');
        } else if (resultado.sectores) {
            secText = String(resultado.sectores);
        }
        elSectores.textContent = `Sectores: ${secText}`;
    }

    const elUsuario = document.getElementById('res-modal-usuario');
    if (elUsuario) {
        elUsuario.textContent = `Responsable: ${resultado.usuario_nombre || 'Sistema'}`;
    }

    const elFecha = document.getElementById('res-modal-fecha');
    if (elFecha) {
        const d = resultado.fecha_finalizacion ? new Date(resultado.fecha_finalizacion) : new Date();
        elFecha.textContent = `Fecha: ${d.toLocaleString()}`;
    }

    const elDuracion = document.getElementById('res-modal-duracion');
    if (elDuracion) {
        let durTexto = resultado.duracion_texto;
        if (!durTexto && resultado.duracion_segundos) {
            const m = Math.floor(resultado.duracion_segundos / 60);
            const s = resultado.duracion_segundos % 60;
            durTexto = m > 0 ? `${m} min ${s} seg` : `${s} seg`;
        }
        if (durTexto) {
            elDuracion.style.display = 'block';
            elDuracion.innerHTML = `⏱️ <strong>Duración Conteo:</strong> ${durTexto}`;
        } else {
            elDuracion.style.display = 'none';
        }
    }

    const sessionId = resultado.session_id;

    // Conectar botones PDF
    const abrirPDF = () => {
        if (sessionId) {
            window.open(`/api/produccion/inventario-ingredientes/${sessionId}/informe-pdf`, '_blank');
        } else {
            alert("No hay sesión disponible para generar el PDF");
        }
    };

    const btnPdfTop = document.getElementById('btn-imprimir-pdf-modal-res');
    if (btnPdfTop) btnPdfTop.onclick = abrirPDF;

    const btnPdfBottom = document.getElementById('btn-imprimir-pdf-modal-res-bottom');
    if (btnPdfBottom) btnPdfBottom.onclick = abrirPDF;

    // Items y KPIs
    const items = resultado.resumen_items || resultado.ingredientes_contados || [];

    const extraerDatosItem = (it) => {
        const nombre = it.nombre || ('Ingrediente #' + (it.ingrediente_id || it.id));
        const codigo = it.codigo || it.ingrediente_id || it.id || '-';

        const kgSis = parseFloat(
            it.kilos_sistema !== undefined ? it.kilos_sistema :
            it.stock_anterior_kilos !== undefined ? it.stock_anterior_kilos :
            it.stock_anterior !== undefined ? it.stock_anterior :
            (it.stock_actual || 0)
        );

        const kgCont = parseFloat(
            it.kilos_contados !== undefined ? it.kilos_contados :
            it.stock_nuevo_kilos !== undefined ? it.stock_nuevo_kilos :
            it.stock_contado !== undefined ? it.stock_contado :
            (it.kilos_sueltos_contados !== undefined ? it.kilos_sueltos_contados : 0)
        );

        const difKg = (it.diferencia_kilos !== undefined && it.diferencia_kilos !== null) ? parseFloat(it.diferencia_kilos) :
            (it.diff_kilos !== undefined && it.diff_kilos !== null) ? parseFloat(it.diff_kilos) :
            (kgCont - kgSis);

        const cjSis = parseFloat(
            it.bultos_sistema !== undefined ? it.bultos_sistema :
            it.stock_anterior_bultos !== undefined ? it.stock_anterior_bultos :
            it.stock_bultos_anterior !== undefined ? it.stock_bultos_anterior :
            (it.stock_bultos || 0)
        );

        const cjCont = parseFloat(
            it.bultos_contados !== undefined ? it.bultos_contados :
            it.stock_nuevo_bultos !== undefined ? it.stock_nuevo_bultos :
            it.total_bultos_contados !== undefined ? it.total_bultos_contados : 0
        );

        const difCj = (it.diferencia_bultos !== undefined && it.diferencia_bultos !== null) ? parseFloat(it.diferencia_bultos) :
            (it.diff_bultos !== undefined && it.diff_bultos !== null) ? parseFloat(it.diff_bultos) :
            (cjCont - cjSis);

        const esAjustado = it.ajustado !== undefined ? Boolean(it.ajustado) : (Math.abs(difKg) > 0.001 || Math.abs(difCj) > 0);

        let detalleLotesStr = '-';
        if (it.lotes_contados && Array.isArray(it.lotes_contados) && it.lotes_contados.length > 0) {
            const sub = it.lotes_contados
                .filter(l => parseFloat(l.cajas_contadas || 0) > 0)
                .map(l => `${l.id_corto || l.lote_codigo_corto || (l.lote_id_supabase ? l.lote_id_supabase.substring(0,8) : 'Lote')}: ${l.cajas_contadas} cj`);
            if (sub.length > 0) detalleLotesStr = sub.join(', ');
        } else if (it.detalle_lotes) {
            detalleLotesStr = it.detalle_lotes;
        }

        return {
            nombre,
            codigo,
            kgSis,
            kgCont,
            difKg,
            cjSis,
            cjCont,
            difCj,
            esAjustado,
            detalleLotesStr
        };
    };

    let totalItems = items.length;
    let totalAjustados = 0;
    let totalBultos = 0;

    items.forEach(it => {
        const d = extraerDatosItem(it);
        if (d.esAjustado) {
            totalAjustados++;
        }
        totalBultos += d.cjCont;
    });

    const totalSinCambio = totalItems - totalAjustados;

    const kpiTotal = document.getElementById('kpi-res-total');
    if (kpiTotal) kpiTotal.textContent = totalItems;

    const kpiAjustados = document.getElementById('kpi-res-ajustados');
    if (kpiAjustados) kpiAjustados.textContent = totalAjustados;

    const kpiSinCambio = document.getElementById('kpi-res-sin-cambio');
    if (kpiSinCambio) kpiSinCambio.textContent = totalSinCambio;

    const kpiBultos = document.getElementById('kpi-res-bultos');
    if (kpiBultos) kpiBultos.textContent = `${totalBultos} cj`;

    // Renderizar tabla con filtro
    let filtroTexto = '';
    let soloAjustados = false;

    const renderTabla = () => {
        const tbody = document.getElementById('tabla-resultado-pc-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const filtrados = items.filter(it => {
            const d = extraerDatosItem(it);
            const nom = d.nombre.toLowerCase();
            const cod = String(d.codigo).toLowerCase();
            const matchTxt = !filtroTexto || nom.includes(filtroTexto) || cod.includes(filtroTexto);

            if (soloAjustados) {
                return matchTxt && d.esAjustado;
            }
            return matchTxt;
        });

        if (filtrados.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 20px;">No se encontraron ingredientes con ese filtro</td></tr>`;
            return;
        }

        filtrados.forEach(it => {
            const d = extraerDatosItem(it);
            const colorDifKg = Math.abs(d.difKg) < 0.001 ? '#64748b' : (d.difKg > 0 ? '#16a34a' : '#dc2626');
            const colorDifCj = d.difCj === 0 ? '#64748b' : (d.difCj > 0 ? '#16a34a' : '#dc2626');

            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #e2e8f0';
            tr.innerHTML = `
                <td style="padding: 8px 10px; font-weight: 600; color: #1e293b;">${d.nombre}</td>
                <td style="padding: 8px 10px; color: #64748b; font-size: 0.85rem;">${d.codigo}</td>
                <td style="padding: 8px 10px; text-align: right; font-family: monospace; font-size: 0.9rem;">
                    <span style="color: #64748b;">${d.kgSis.toFixed(2)}</span> ➔ <strong>${d.kgCont.toFixed(2)}</strong>
                </td>
                <td style="padding: 8px 10px; text-align: right; font-family: monospace; font-weight: 700; color: ${colorDifKg}; font-size: 0.9rem;">
                    ${d.difKg >= 0 ? '+' : ''}${d.difKg.toFixed(2)} kg
                </td>
                <td style="padding: 8px 10px; text-align: right; font-family: monospace; font-size: 0.9rem;">
                    <span style="color: #64748b;">${d.cjSis}</span> ➔ <strong>${d.cjCont}</strong>
                </td>
                <td style="padding: 8px 10px; text-align: right; font-family: monospace; font-weight: 700; color: ${colorDifCj}; font-size: 0.9rem;">
                    ${d.difCj >= 0 ? '+' : ''}${d.difCj} cj
                </td>
                <td style="padding: 8px 10px; font-size: 0.8rem; color: #64748b; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${d.detalleLotesStr}">
                    ${d.detalleLotesStr}
                </td>
                <td style="padding: 8px 10px; text-align: center;">
                    <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; ${d.esAjustado ? 'background: #fee2e2; color: #991b1b;' : 'background: #dcfce7; color: #166534;'}">
                        ${d.esAjustado ? '⚠️ Ajustado' : '✅ Exacto'}
                    </span>
                </td>
            `;
            tbody.appendChild(tr);
        });
    };

    // Filtros listeners
    const inputFiltro = document.getElementById('filtro-tabla-res');
    if (inputFiltro) {
        inputFiltro.value = '';
        inputFiltro.oninput = (e) => {
            filtroTexto = e.target.value.trim().toLowerCase();
            renderTabla();
        };
    }

    const btnTodos = document.getElementById('btn-filtro-res-todos');
    const btnAjust = document.getElementById('btn-filtro-res-ajustados');
    if (btnTodos && btnAjust) {
        btnTodos.onclick = () => {
            soloAjustados = false;
            btnTodos.classList.add('active');
            btnAjust.classList.remove('active');
            renderTabla();
        };
        btnAjust.onclick = () => {
            soloAjustados = true;
            btnAjust.classList.add('active');
            btnTodos.classList.remove('active');
            renderTabla();
        };
    }

    renderTabla();

    // Botón de Cierre
    const btnCerrarBot = document.getElementById('btn-cerrar-resultado-pc');
    if (btnCerrarBot) {
        btnCerrarBot.textContent = esDesdeHistorial ? '⬅️ Volver al Historial' : '✕ Cerrar y Actualizar Stock';
    }

    // Handler de Cierre
    const cerrarModalRes = () => {
        modal.style.display = 'none';
        if (esDesdeHistorial) {
            const modalHist = document.getElementById('modal-historial-inventarios');
            if (modalHist) modalHist.style.display = 'block';
        } else {
            cerrarModal(); // Cierra el modal de inventario principal
            cargarIngredientes(); // Recarga los ingredientes con stock actualizado
        }
    };

    const btnCloseX = document.getElementById('close-modal-resultado-pc');
    if (btnCloseX) btnCloseX.onclick = cerrarModalRes;

    if (btnCerrarBot) btnCerrarBot.onclick = cerrarModalRes;

    // Mostrar modal
    modal.style.display = 'block';
};

// ===== HISTORIAL DE INVENTARIOS (PC) =====

window.abrirHistorialInventariosPC = async function () {
    const modal = document.getElementById('modal-historial-inventarios');
    if (!modal) return;

    modal.style.display = 'block';
    const tbody = document.getElementById('tabla-historial-body');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 25px; color: #64748b;">⏳ Cargando historial de inventarios...</td></tr>`;
    }

    // Handlers de cierre
    const cerrar = () => {
        modal.style.display = 'none';
    };
    const closeX = document.getElementById('close-modal-historial');
    if (closeX) closeX.onclick = cerrar;
    const btnCerrar = document.getElementById('btn-cerrar-historial');
    if (btnCerrar) btnCerrar.onclick = cerrar;

    try {
        const res = await fetch('/api/produccion/inventario-ingredientes/historial');
        if (!res.ok) throw new Error('Error al consultar historial');
        const data = await res.json();
        const sesiones = data.historial || (Array.isArray(data) ? data : []);

        if (!tbody) return;
        tbody.innerHTML = '';

        if (!sesiones || sesiones.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 25px; color: #94a3b8;">No hay sesiones de inventario finalizadas aún.</td></tr>`;
            return;
        }

        sesiones.forEach(s => {
            const fechaStr = s.fecha_finalizacion ? new Date(s.fecha_finalizacion).toLocaleString() : (s.fecha_inicio ? new Date(s.fecha_inicio).toLocaleString() : '-');
            let secBadge = 'TODOS';
            if (Array.isArray(s.sectores)) {
                secBadge = s.sectores.join(', ');
            } else if (s.sectores) {
                secBadge = String(s.sectores);
            }

            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #e2e8f0';
            tr.innerHTML = `
                <td style="padding: 10px; font-weight: 600; color: #1e293b;">
                    <div>${fechaStr}</div>
                    <div style="font-size: 0.78rem; color: #4338ca; font-weight: 700; margin-top: 2px;">⏱️ ${s.duracion_texto || '0 seg'}</div>
                </td>
                <td style="padding: 10px;">
                    <span style="background: #e0e7ff; color: #3730a3; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 600;">
                        ${secBadge}
                    </span>
                </td>
                <td style="padding: 10px; color: #334155;">${s.usuario_nombre || 'Sistema'}</td>
                <td style="padding: 10px; text-align: center; font-size: 0.85rem;">
                    <strong>${s.total_articulos || 0}</strong> art.
                    <span style="color: #dc2626; font-weight: 600;">(${s.total_ajustes || 0} ajustados)</span>
                </td>
                <td style="padding: 10px; text-align: center;">
                    <div style="display: flex; gap: 6px; justify-content: center;">
                        <button class="btn btn-sm btn-primary" style="background: #2563eb; padding: 4px 10px; font-size: 0.8rem;" onclick="window.imprimirPDFHistorial('${s.session_id}')" title="Descargar Informe PDF">
                            🖨️ PDF
                        </button>
                        <button class="btn btn-sm btn-secondary" style="padding: 4px 10px; font-size: 0.8rem;" onclick="window.verDetalleHistorial('${s.session_id}')" title="Ver Resultados en Pantalla">
                            👁️ Ver Foto
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error("❌ Error cargando historial de inventarios:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 20px;">Error al cargar historial: ${err.message}</td></tr>`;
        }
    }
};

window.imprimirPDFHistorial = function (sessionId) {
    if (!sessionId) return;
    window.open(`/api/produccion/inventario-ingredientes/${sessionId}/informe-pdf`, '_blank');
};

window.verDetalleHistorial = async function (sessionId) {
    if (!sessionId) return;
    try {
        mostrarMensaje("Cargando foto de sesión...", "info");
        const res = await fetch(`/api/produccion/inventario-ingredientes/${sessionId}/detalle`);
        if (!res.ok) throw new Error("No se pudo obtener el detalle de la sesión");
        const data = await res.json();
        const detalle = data.sesion || data;

        // Ocultar modal historial para que la foto se abra nítida en primer plano
        const modalHist = document.getElementById('modal-historial-inventarios');
        if (modalHist) modalHist.style.display = 'none';

        window.mostrarModalResultadoInventarioPC(detalle, true);
    } catch (err) {
        console.error("❌ Error al abrir detalle:", err);
        mostrarMensaje("Error al abrir detalle: " + err.message, "error");
    }
};



