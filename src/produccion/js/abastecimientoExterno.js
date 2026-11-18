// src/produccion/js/abastecimientoExterno.js

import { actualizarResumenIngredientes } from './carro.js';

let modal = null;
let inputCodigoBarras = null;
let btnBuscarCodigo = null;
let alertaEscaner = null;
let inputBusqueda = null;
let listaResultados = null;
let divSeleccionado = null;
let inputCantidad = null;
let btnConfirmar = null;
let nombreIngredienteDisplay = null;
let spanKilosTotales = null;
let divResumen = null;

let ingredienteDestinoId = null;
let ingredienteDestinoNombre = '';
let articuloSeleccionado = null;
let articulosDelIngrediente = [];

const DEFAULT_KILOS_FALLBACK = 1;

function escaparHtml(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizar(texto) {
    if (!texto) return '';
    return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function deducirKilosUnidadDesdeNombre(nombre) {
    if (!nombre) return 1;
    const norm = nombre.toLowerCase();

    const regex1 = /(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(litros|l|cc|ml|kg|g|unidades)?/i;
    const match1 = norm.match(regex1);
    if (match1) {
        const qty = parseFloat(match1[1]);
        const unitVal = parseFloat(match1[2].replace(',', '.'));
        const unitStr = (match1[3] || '').toLowerCase();
        let multiplier = 1;
        if (unitStr.startsWith('g') || unitStr === 'cc' || unitStr === 'ml') {
            multiplier = 0.001;
        }
        return qty * unitVal * multiplier;
    }

    const regex2 = /x\s*(\d+(?:[.,]\d+)?)\s*(litros|l|cc|ml|kg|g)/i;
    const match2 = norm.match(regex2);
    if (match2) {
        const unitVal = parseFloat(match2[1].replace(',', '.'));
        const unitStr = match2[2].toLowerCase();
        let multiplier = 1;
        if (unitStr.startsWith('g') || unitStr === 'cc' || unitStr === 'ml') {
            multiplier = 0.001;
        }
        return unitVal * multiplier;
    }

    const regex3 = /(\d+(?:[.,]\d+)?)\s*(litros|l|cc|ml|kg|g)\b/i;
    const match3 = norm.match(regex3);
    if (match3) {
        const unitVal = parseFloat(match3[1].replace(',', '.'));
        const unitStr = match3[2].toLowerCase();
        let multiplier = 1;
        if (unitStr.startsWith('g') || unitStr === 'cc' || unitStr === 'ml') {
            multiplier = 0.001;
        }
        return unitVal * multiplier;
    }

    return 1;
}

function deducirUnidadMedidaDesdeNombre(nombre) {
    if (!nombre) return 'kg';
    const norm = nombre.toLowerCase();
    if (norm.includes('litro') || norm.includes(' l ') || norm.endsWith(' l') || /\d+\s*l\b/.test(norm)) {
        return 'L';
    }
    return 'kg';
}

function mostrarAlertaEscaner(mensaje, tipo = 'warning') {
    if (!alertaEscaner) return;
    if (!mensaje) {
        alertaEscaner.style.display = 'none';
        alertaEscaner.innerHTML = '';
        return;
    }
    const estilos = tipo === 'error'
        ? { bg: '#fef2f2', bd: '#fca5a5', col: '#991b1b' }
        : tipo === 'success'
            ? { bg: '#ecfdf5', bd: '#6ee7b7', col: '#065f46' }
            : { bg: '#fffbeb', bd: '#fcd34d', col: '#92400e' };
    alertaEscaner.style.background = estilos.bg;
    alertaEscaner.style.border = `1px solid ${estilos.bd}`;
    alertaEscaner.style.color = estilos.col;
    alertaEscaner.innerHTML = mensaje;
    alertaEscaner.style.display = 'block';
}

function inicializarModal() {
    modal = document.getElementById('modalAbastecimientoExterno');
    if (!modal || modal.dataset.initialized === 'true') return;
    modal.dataset.initialized = 'true';

    inputCodigoBarras = document.getElementById('codigoBarrasAbastecer');
    btnBuscarCodigo = document.getElementById('btnBuscarCodigoAbastecer');
    alertaEscaner = document.getElementById('alerta-escaner-abastecer');
    inputBusqueda = document.getElementById('buscarArticuloAbastecer');
    listaResultados = document.getElementById('listaArticulosAbastecer');
    divSeleccionado = document.getElementById('articulo-seleccionado-abastecer');
    inputCantidad = document.getElementById('cantidadBultosAbastecer');
    btnConfirmar = document.getElementById('btnConfirmarAbastecimiento');
    nombreIngredienteDisplay = document.getElementById('nombre-ingrediente-abastecer');
    spanKilosTotales = document.getElementById('kilos-totales-abastecer');
    divResumen = document.getElementById('resumen-abastecimiento');

    const btnCloseElements = modal.querySelectorAll('.close-modal');
    btnCloseElements.forEach(btn => btn.addEventListener('click', cerrarModal));

    if (inputCodigoBarras) {
        inputCodigoBarras.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                procesarCodigoBarrasOSku(inputCodigoBarras.value, true);
            }
        });
        inputCodigoBarras.addEventListener('input', () => {
            mostrarAlertaEscaner(null);
            const val = inputCodigoBarras.value.trim();
            if (val.length >= 3) {
                // Selección instantánea si coincide exactamente con código de barras o SKU del ingrediente
                const matchDirecto = buscarCoincidenciaExactaEnLista(val);
                if (matchDirecto) {
                    seleccionarArticulo(matchDirecto, { desdeEscaner: true });
                }
            }
        });
    }

    if (btnBuscarCodigo) {
        btnBuscarCodigo.addEventListener('click', () => {
            if (inputCodigoBarras) {
                procesarCodigoBarrasOSku(inputCodigoBarras.value, true);
            }
        });
    }

    if (inputBusqueda) {
        inputBusqueda.addEventListener('input', renderizarListaFiltrada);
        inputBusqueda.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = inputBusqueda.value.trim();
                const matchExacto = buscarCoincidenciaExactaEnLista(val);
                if (matchExacto) {
                    seleccionarArticulo(matchExacto, { desdeEscaner: true });
                }
            }
        });
    }

    if (inputCantidad) {
        inputCantidad.addEventListener('input', calcularKilos);
        inputCantidad.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !btnConfirmar.disabled) {
                e.preventDefault();
                confirmarAbastecimiento();
            }
        });
    }

    if (btnConfirmar) {
        btnConfirmar.addEventListener('click', confirmarAbastecimiento);
    }
}

function buscarCoincidenciaExactaEnLista(codigoRaw) {
    const q = String(codigoRaw || '').trim().toLowerCase();
    if (!q) return null;
    return articulosDelIngrediente.find(art =>
        (art.codigo_barras && String(art.codigo_barras).trim().toLowerCase() === q) ||
        (art.numero && String(art.numero).trim().toLowerCase() === q)
    ) || null;
}

async function procesarCodigoBarrasOSku(codigoRaw, mostrarErrorSiNoExiste = true) {
    const query = String(codigoRaw || '').trim();
    if (!query) return;

    const matchValido = buscarCoincidenciaExactaEnLista(query);
    if (matchValido) {
        seleccionarArticulo(matchValido, { desdeEscaner: true });
        return;
    }

    if (!mostrarErrorSiNoExiste) return;

    // Consultar si ese código pertenece a OTRO artículo del depósito que no corresponde al ingrediente
    try {
        const resp = await fetch(`/api/produccion/articulos?codigo_barras=${encodeURIComponent(query)}`);
        if (resp.ok) {
            const payload = await resp.json();
            const lista = payload.data || payload || [];
            if (Array.isArray(lista) && lista.length > 0) {
                const otro = lista[0];
                mostrarAlertaEscaner(
                    `⛔ El código <strong>${escaparHtml(query)}</strong> corresponde a <strong>[${escaparHtml(otro.numero)}] ${escaparHtml(otro.nombre || '')}</strong>, que no es una presentación de <strong>${escaparHtml(ingredienteDestinoNombre)}</strong>.`,
                    'error'
                );
                return;
            }
        }
    } catch (_) {}

    mostrarAlertaEscaner(
        `⚠️ No se encontró ninguna presentación de <strong>${escaparHtml(ingredienteDestinoNombre)}</strong> con el código <strong>${escaparHtml(query)}</strong>.`,
        'warning'
    );
}

window.abrirModalAbastecimientoExterno = async function(ingredienteId, nombreIngrediente) {
    if (!modal) inicializarModal();
    if (!modal) return;

    ingredienteDestinoId = ingredienteId;
    ingredienteDestinoNombre = nombreIngrediente || '';
    articuloSeleccionado = null;
    articulosDelIngrediente = [];

    if (inputCodigoBarras) inputCodigoBarras.value = '';
    if (inputBusqueda) inputBusqueda.value = '';
    if (inputCantidad) inputCantidad.value = '';
    if (divSeleccionado) {
        divSeleccionado.style.display = 'none';
        divSeleccionado.innerHTML = '';
    }
    mostrarAlertaEscaner(null);
    if (divResumen) divResumen.style.display = 'none';
    if (btnConfirmar) {
        btnConfirmar.disabled = true;
        btnConfirmar.innerHTML = 'Confirmar Retiro';
    }

    nombreIngredienteDisplay.textContent = `Abasteciendo: ${nombreIngrediente}`;
    listaResultados.style.display = 'block';
    listaResultados.innerHTML = '<li style="padding: 12px; color: #475569; font-size: 13px;">⏳ Cargando presentaciones de ' + escaparHtml(nombreIngrediente) + '...</li>';

    modal.classList.add('show');
    setTimeout(() => {
        if (inputCodigoBarras) inputCodigoBarras.focus();
    }, 40);

    try {
        const response = await fetch(`/api/produccion/ingredientes/${encodeURIComponent(ingredienteId)}/articulos-abastecimiento`);
        if (response.ok) {
            const payload = await response.json();
            articulosDelIngrediente = Array.isArray(payload.data) ? payload.data : [];
        } else {
            articulosDelIngrediente = [];
        }
    } catch (error) {
        console.error('Error cargando presentaciones del ingrediente:', error);
        articulosDelIngrediente = [];
    }

    renderizarListaFiltrada();

    // Si solo existe 1 única presentación válida, preseleccionarla para ahorrar un clic
    if (articulosDelIngrediente.length === 1 && !articuloSeleccionado) {
        seleccionarArticulo(articulosDelIngrediente[0], { desdeEscaner: false });
    }
};

function cerrarModal() {
    if (modal) {
        modal.classList.remove('show');
    }
}

function renderizarListaFiltrada() {
    if (!listaResultados) return;
    listaResultados.innerHTML = '';
    listaResultados.style.display = 'block';

    const query = (inputBusqueda ? inputBusqueda.value : '').trim();
    const tokens = normalizar(query).split(/\s+/).filter(Boolean);

    const resultados = tokens.length === 0
        ? articulosDelIngrediente
        : articulosDelIngrediente.filter(art => {
            const bolsa = normalizar(`${art.numero || ''} ${art.nombre || ''} ${art.codigo_barras || ''}`);
            return tokens.every(t => bolsa.includes(t));
        });

    if (resultados.length === 0) {
        listaResultados.innerHTML = `<li style="padding: 12px; color: #64748b; font-size: 13px;">No hay presentaciones de <strong>${escaparHtml(ingredienteDestinoNombre)}</strong> que coincidan con el filtro.</li>`;
        return;
    }

    resultados.forEach(art => {
        const li = document.createElement('li');
        const esSeleccionado = articuloSeleccionado && articuloSeleccionado.numero === art.numero;
        li.style.padding = '9px 12px';
        li.style.cursor = 'pointer';
        li.style.borderBottom = '1px solid #e2e8f0';
        li.style.background = esSeleccionado ? '#dbeafe' : '#ffffff';
        li.style.transition = 'background 0.15s';

        const stockNum = parseFloat(art.stock_consolidado) || 0;
        const statusColor = stockNum > 0 ? '#15803d' : '#b91c1c';
        const kgU = parseFloat(art.kilos_unidad) || deducirKilosUnidadDesdeNombre(art.nombre);
        const unidadTxt = deducirUnidadMedidaDesdeNombre(art.nombre);
        const barrasTxt = art.codigo_barras ? `🔖 ${escaparHtml(art.codigo_barras)}` : 'Sin cód. barras';

        li.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <div style="font-weight: 700; font-size: 13.5px; color: #0f172a;">
                    <span style="font-family: monospace; color: #1d4ed8;">[${escaparHtml(art.numero)}]</span> ${escaparHtml(art.nombre || 'Sin nombre')}
                </div>
                ${esSeleccionado ? '<span style="font-size: 11px; font-weight: 800; color: #1d4ed8; background: #eff6ff; border: 1px solid #93c5fd; padding: 1px 7px; border-radius: 999px;">✓ Seleccionado</span>' : ''}
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; margin-top: 4px; color: #475569;">
                <span>${barrasTxt}</span>
                <span>⚖️ <strong>${kgU.toFixed(2)} ${unidadTxt}</strong> / u</span>
                <span style="color: ${statusColor}; font-weight: 700;">📊 Stock Depósito: ${stockNum.toFixed(2)}</span>
            </div>
        `;

        li.addEventListener('click', () => seleccionarArticulo(art, { desdeEscaner: false }));
        listaResultados.appendChild(li);
    });
}

function seleccionarArticulo(art, { desdeEscaner = false } = {}) {
    const kgU = parseFloat(art.kilos_unidad) > 0
        ? parseFloat(art.kilos_unidad)
        : deducirKilosUnidadDesdeNombre(art.nombre || art.descripcion);
    const unidadMedida = deducirUnidadMedidaDesdeNombre(art.nombre || art.descripcion);

    articuloSeleccionado = {
        ...art,
        kilos_unidad: kgU,
        unidad_medida: unidadMedida
    };

    if (desdeEscaner) {
        mostrarAlertaEscaner(
            `✅ Código reconocido: <strong>[${escaparHtml(art.numero)}] ${escaparHtml(art.nombre || '')}</strong>`,
            'success'
        );
    } else {
        mostrarAlertaEscaner(null);
    }

    if (divSeleccionado) {
        divSeleccionado.innerHTML = `
            ✅ <strong>Artículo a retirar:</strong> <span style="font-family: monospace;">[${escaparHtml(art.numero)}]</span> ${escaparHtml(art.nombre || '')}
            ${art.codigo_barras ? `<span style="color:#475569; margin-left:6px;">(🔖 ${escaparHtml(art.codigo_barras)})</span>` : ''}
            — <strong>${kgU.toFixed(2)} ${unidadMedida}/u</strong>
        `;
        divSeleccionado.style.display = 'block';
    }

    if (!inputCantidad.value || parseFloat(inputCantidad.value) <= 0) {
        inputCantidad.value = '1';
    }

    const labelUnidad = document.getElementById('unidad-abastecer-label');
    if (labelUnidad) {
        labelUnidad.textContent = unidadMedida;
    }

    renderizarListaFiltrada();
    calcularKilos();

    if (desdeEscaner && inputCantidad) {
        inputCantidad.focus();
        inputCantidad.select();
    }
}

function calcularKilos() {
    if (!articuloSeleccionado) {
        btnConfirmar.disabled = true;
        divResumen.style.display = 'none';
        return;
    }

    const cant = parseFloat(inputCantidad.value);
    if (isNaN(cant) || cant <= 0) {
        btnConfirmar.disabled = true;
        divResumen.style.display = 'none';
        return;
    }

    const totalKilos = cant * (articuloSeleccionado.kilos_unidad || DEFAULT_KILOS_FALLBACK);
    spanKilosTotales.textContent = totalKilos.toFixed(2);
    divResumen.style.display = 'block';
    btnConfirmar.disabled = false;
}

async function confirmarAbastecimiento() {
    if (!articuloSeleccionado || !ingredienteDestinoId) return;

    const cantidad = parseFloat(inputCantidad.value);
    const colaboradorData = localStorage.getItem('colaboradorActivo');

    if (!colaboradorData) {
        alert('Debe tener un colaborador seleccionado');
        return;
    }

    const usuarioId = JSON.parse(colaboradorData).id;

    const workspaceContainer = document.getElementById('workspace-container');
    const carroId = workspaceContainer?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    const parsedCarroId = carroId ? parseInt(carroId, 10) : null;

    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = 'Procesando...';

    const payload = {
        articulo_numero: articuloSeleccionado.numero,
        cantidad: cantidad,
        ingrediente_id: ingredienteDestinoId,
        usuario_id: usuarioId,
        carro_id: parsedCarroId
    };

    try {
        const response = await fetch('/api/produccion/ingredientes/abastecer-stock-personal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || err.detalles || 'Fallo interno en el servidor');
        }

        if (typeof window.invalidarCacheCarro === 'function') {
            window.invalidarCacheCarro();
        }

        const totalKilos = cantidad * (articuloSeleccionado.kilos_unidad || DEFAULT_KILOS_FALLBACK);
        const u = articuloSeleccionado.unidad_medida || 'kg';
        const mensajeExito = `✅ Retiro confirmado: ${cantidad} x ${articuloSeleccionado.kilos_unidad} ${u} (Total: ${totalKilos.toFixed(2)} ${u})`;
        cerrarModal();

        if (typeof window.mostrarNotificacionExito === 'function') {
            window.mostrarNotificacionExito(mensajeExito);
        } else if (typeof Swal !== 'undefined') {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: mensajeExito,
                showConfirmButton: false,
                timer: 3000
            });
        } else {
            alert(mensajeExito);
        }

        if (typeof actualizarResumenIngredientes === 'function') {
            await actualizarResumenIngredientes();
        }
    } catch (error) {
        alert('Hubo un error al confirmar el abastecimiento: ' + error.message);
        btnConfirmar.disabled = false;
        btnConfirmar.innerHTML = 'Confirmar Retiro';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarModal);
} else {
    inicializarModal();
}
