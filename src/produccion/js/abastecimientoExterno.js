// src/produccion/js/abastecimientoExterno.js

import { actualizarResumenIngredientes, obtenerResumenIngredientesCarro, mostrarResumenIngredientes } from './carro.js';

let modal = null;
let inputCodigoBarras = null;
let btnBuscarCodigo = null;
let alertaEscaner = null;
let inputBusqueda = null;
let listaResultados = null;
let divSeleccionado = null;
let subtextoEnvaseUnitario = null;
let inputCantidad = null;
let btnRestarBulto = null;
let btnSumarBulto = null;
let presetButtons = [];
let btnConfirmar = null;
let nombreIngredienteDisplay = null;
let divResumen = null;
let desgloseLinea1 = null;
let desgloseLinea2 = null;
let desgloseLinea3 = null;

let ingredienteDestinoId = null;
let ingredienteDestinoNombre = '';
let ingredienteUnidadBase = 'kg';
let saldoActualDomicilio = 0;
let consumoCarroActual = 0;
let articuloSeleccionado = null;
let articulosDelIngrediente = [];
let abastecimientoEnVuelo = false;
let currentAbastecimientoRequestId = null;

const DEFAULT_KILOS_FALLBACK = 1;

function generarRequestIdAbastecimiento() {
    return `abast_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

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

function formatearConSigno(valor) {
    const n = Number(valor) || 0;
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
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
    if (!nombre) return ingredienteUnidadBase || 'kg';
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

function actualizarPillsPresetActiva(cantEntera) {
    presetButtons.forEach(btn => {
        const n = parseInt(btn.dataset.cant || '0', 10);
        const activo = n === cantEntera;
        btn.style.background = activo ? '#1d4ed8' : '#ffffff';
        btn.style.color = activo ? '#ffffff' : '#334155';
        btn.style.borderColor = activo ? '#1d4ed8' : '#cbd5e1';
    });
}

function setearCantidadEntera(nuevaCant) {
    if (!inputCantidad || abastecimientoEnVuelo) return;
    const cantLimpia = Math.max(1, Math.round(Number(nuevaCant) || 1));
    inputCantidad.value = String(cantLimpia);
    currentAbastecimientoRequestId = generarRequestIdAbastecimiento();
    actualizarPillsPresetActiva(cantLimpia);
    calcularKilos();
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
    subtextoEnvaseUnitario = document.getElementById('subtexto-envase-unitario');
    inputCantidad = document.getElementById('cantidadBultosAbastecer');
    btnRestarBulto = document.getElementById('btnRestarBultoAbastecer');
    btnSumarBulto = document.getElementById('btnSumarBultoAbastecer');
    presetButtons = Array.from(modal.querySelectorAll('.btn-preset-bultos'));
    btnConfirmar = document.getElementById('btnConfirmarAbastecimiento');
    nombreIngredienteDisplay = document.getElementById('nombre-ingrediente-abastecer');
    divResumen = document.getElementById('resumen-abastecimiento');
    desgloseLinea1 = document.getElementById('desglose-retiro-linea1');
    desgloseLinea2 = document.getElementById('desglose-retiro-linea2');
    desgloseLinea3 = document.getElementById('desglose-retiro-linea3');

    const btnCloseElements = modal.querySelectorAll('.close-modal, .btn-cancelar-abastecer');
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
        inputBusqueda.addEventListener('input', () => {
            renderizarListaFiltrada({ autoSeleccionarPrimero: true });
        });
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

    if (btnRestarBulto) {
        btnRestarBulto.addEventListener('click', () => {
            const actual = parseInt(inputCantidad?.value || '1', 10) || 1;
            setearCantidadEntera(Math.max(1, actual - 1));
        });
    }

    if (btnSumarBulto) {
        btnSumarBulto.addEventListener('click', () => {
            const actual = parseInt(inputCantidad?.value || '1', 10) || 1;
            setearCantidadEntera(actual + 1);
        });
    }

    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const cant = parseInt(btn.dataset.cant || '1', 10) || 1;
            setearCantidadEntera(cant);
        });
    });

    if (inputCantidad) {
        inputCantidad.addEventListener('input', () => {
            currentAbastecimientoRequestId = generarRequestIdAbastecimiento();
            const n = parseInt(inputCantidad.value, 10);
            actualizarPillsPresetActiva(!isNaN(n) ? n : 0);
            calcularKilos();
        });
        inputCantidad.addEventListener('blur', () => {
            const n = parseInt(inputCantidad.value, 10);
            if (isNaN(n) || n < 1) {
                setearCantidadEntera(1);
            } else {
                setearCantidadEntera(n);
            }
        });
        inputCantidad.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !btnConfirmar.disabled) {
                e.preventDefault();
                confirmarAbastecimiento(false);
            }
        });
    }

    if (btnConfirmar) {
        btnConfirmar.addEventListener('click', () => confirmarAbastecimiento(false));
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

function leerContextoDomCardPersonal(ingredienteId) {
    saldoActualDomicilio = 0;
    consumoCarroActual = 0;
    ingredienteUnidadBase = 'kg';

    const card = document.querySelector(`#resumen-ingredientes .card-stock-personal[data-ingrediente-id="${ingredienteId}"]`);
    if (card) {
        const disp = parseFloat(card.dataset?.disponible);
        const cons = parseFloat(card.dataset?.consumo);
        if (!isNaN(disp)) saldoActualDomicilio = disp;
        if (!isNaN(cons)) consumoCarroActual = cons;
        if (card.dataset?.unidad) ingredienteUnidadBase = card.dataset.unidad;
    }
}

window.abrirModalAbastecimientoExterno = async function(ingredienteId, nombreIngrediente) {
    if (!modal) inicializarModal();
    if (!modal) return;

    ingredienteDestinoId = ingredienteId;
    ingredienteDestinoNombre = nombreIngrediente || '';
    articuloSeleccionado = null;
    articulosDelIngrediente = [];
    currentAbastecimientoRequestId = null;

    leerContextoDomCardPersonal(ingredienteId);

    if (inputCodigoBarras) inputCodigoBarras.value = '';
    if (inputBusqueda) inputBusqueda.value = '';
    if (inputCantidad) inputCantidad.value = '1';
    actualizarPillsPresetActiva(1);

    if (divSeleccionado) {
        divSeleccionado.style.display = 'none';
        divSeleccionado.innerHTML = '';
    }
    if (subtextoEnvaseUnitario) {
        subtextoEnvaseUnitario.textContent = 'Seleccioná un envase arriba';
    }
    mostrarAlertaEscaner(null);
    if (divResumen) divResumen.style.display = 'none';
    if (btnConfirmar) {
        btnConfirmar.disabled = true;
        btnConfirmar.innerHTML = 'Confirmar Retiro';
    }

    let usuarioId = null;
    try {
        const colabRaw = localStorage.getItem('colaboradorActivo');
        if (colabRaw) usuarioId = JSON.parse(colabRaw)?.id || null;
    } catch (_) {}

    nombreIngredienteDisplay.textContent = `Ingrediente: ${nombreIngrediente} · Saldo actual en domicilio: ${saldoActualDomicilio.toFixed(2)} ${ingredienteUnidadBase || 'kg'}`;
    listaResultados.style.display = 'block';
    listaResultados.innerHTML = '<li style="padding: 12px; color: #475569; font-size: 13px;">⏳ Cargando presentaciones de ' + escaparHtml(nombreIngrediente) + '...</li>';

    modal.classList.add('show');
    setTimeout(() => {
        if (inputCodigoBarras) inputCodigoBarras.focus();
    }, 40);

    try {
        const qs = usuarioId ? `?usuario_id=${encodeURIComponent(usuarioId)}` : '';
        const response = await fetch(`/api/produccion/ingredientes/${encodeURIComponent(ingredienteId)}/articulos-abastecimiento${qs}`);
        if (response.ok) {
            const payload = await response.json();
            articulosDelIngrediente = Array.isArray(payload.data) ? payload.data : [];
            if (payload.ingrediente && payload.ingrediente.saldo_personal_actual !== null && payload.ingrediente.saldo_personal_actual !== undefined) {
                const saldoDb = parseFloat(payload.ingrediente.saldo_personal_actual);
                if (!isNaN(saldoDb)) {
                    saldoActualDomicilio = saldoDb;
                }
            }
            if (payload.ingrediente && payload.ingrediente.unidad_medida) {
                ingredienteUnidadBase = payload.ingrediente.unidad_medida;
            }
            nombreIngredienteDisplay.textContent = `Ingrediente: ${nombreIngrediente} · Saldo actual en domicilio: ${saldoActualDomicilio.toFixed(2)} ${ingredienteUnidadBase || 'kg'}`;
        } else {
            articulosDelIngrediente = [];
        }
    } catch (error) {
        console.error('Error cargando presentaciones del ingrediente:', error);
        articulosDelIngrediente = [];
    }

    // Preseleccionar por defecto el primer bulto/envase prioritario con stock (o el primero de la lista)
    if (articulosDelIngrediente.length > 0 && !articuloSeleccionado) {
        const preferido = articulosDelIngrediente.find(a => (parseFloat(a.stock_consolidado) || 0) > 0) || articulosDelIngrediente[0];
        seleccionarArticulo(preferido, { desdeEscaner: false, mantenerFocoEscaner: true });
    } else {
        renderizarListaFiltrada({ autoSeleccionarPrimero: false });
    }
};

function cerrarModal() {
    if (modal) {
        modal.classList.remove('show');
    }
}

function obtenerResultadosFiltradosActuales() {
    const query = (inputBusqueda ? inputBusqueda.value : '').trim();
    const tokens = normalizar(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return articulosDelIngrediente;
    return articulosDelIngrediente.filter(art => {
        const bolsa = normalizar(`${art.numero || ''} ${art.nombre || ''} ${art.codigo_barras || ''}`);
        return tokens.every(t => bolsa.includes(t));
    });
}

function renderizarListaFiltrada({ autoSeleccionarPrimero = false } = {}) {
    if (!listaResultados) return;
    listaResultados.innerHTML = '';
    listaResultados.style.display = 'block';

    const resultados = obtenerResultadosFiltradosActuales();

    if (resultados.length === 0) {
        listaResultados.innerHTML = `<li style="padding: 12px; color: #64748b; font-size: 13px;">No hay presentaciones de <strong>${escaparHtml(ingredienteDestinoNombre)}</strong> que coincidan con el filtro.</li>`;
        return;
    }

    if (autoSeleccionarPrimero) {
        const sigueEnLista = articuloSeleccionado && resultados.some(r => r.numero === articuloSeleccionado.numero);
        if (!sigueEnLista) {
            const mejor = resultados.find(r => (parseFloat(r.stock_consolidado) || 0) > 0) || resultados[0];
            if (mejor) {
                seleccionarArticulo(mejor, { desdeEscaner: false, mantenerFocoBusqueda: true });
                return;
            }
        }
    }

    resultados.forEach(art => {
        const li = document.createElement('li');
        const esSeleccionado = articuloSeleccionado && articuloSeleccionado.numero === art.numero;
        li.style.padding = '8px 11px';
        li.style.cursor = 'pointer';
        li.style.borderBottom = '1px solid #e2e8f0';
        li.style.background = esSeleccionado ? '#dbeafe' : '#ffffff';
        li.style.borderLeft = esSeleccionado ? '4px solid #1d4ed8' : '4px solid transparent';
        li.style.transition = 'background 0.12s';

        li.addEventListener('mouseenter', () => {
            if (!esSeleccionado) li.style.background = '#f1f5f9';
        });
        li.addEventListener('mouseleave', () => {
            li.style.background = esSeleccionado ? '#dbeafe' : '#ffffff';
        });

        const stockNum = parseFloat(art.stock_consolidado) || 0;
        const statusColor = stockNum > 0 ? '#15803d' : '#b91c1c';
        const kgU = parseFloat(art.kilos_unidad) > 0
            ? parseFloat(art.kilos_unidad)
            : deducirKilosUnidadDesdeNombre(art.nombre);
        const unidadTxt = deducirUnidadMedidaDesdeNombre(art.nombre);

        const esPack = Boolean(art.es_pack_comercial) || /\b\d+\s*x\s*\d+/i.test(String(art.nombre || ''));
        const esBulto = Boolean(art.es_bulto_insumo) || (!esPack && kgU >= 2);

        let badgeTipoHtml = '';
        if (esBulto) {
            badgeTipoHtml = '<span style="font-size: 10.5px; font-weight: 800; color: #065f46; background: #d1fae5; border: 1px solid #6ee7b7; padding: 1px 6px; border-radius: 4px;">🏭 Bulto Insumo</span>';
        } else if (esPack) {
            badgeTipoHtml = '<span style="font-size: 10.5px; font-weight: 700; color: #475569; background: #f1f5f9; border: 1px solid #cbd5e1; padding: 1px 6px; border-radius: 4px;">📦 Pack multi-unid.</span>';
        } else if (kgU < 1) {
            badgeTipoHtml = '<span style="font-size: 10.5px; font-weight: 800; color: #92400e; background: #fef3c7; border: 1px solid #fcd34d; padding: 1px 6px; border-radius: 4px;">⚠️ Fracción chica</span>';
        }

        const colorPesoBg = kgU < 1 ? '#fffbeb' : '#eff6ff';
        const colorPesoBd = kgU < 1 ? '#f59e0b' : '#60a5fa';
        const colorPesoTx = kgU < 1 ? '#92400e' : '#1e40af';

        li.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                <div style="font-weight: 700; font-size: 13px; color: #0f172a; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span style="font-family: monospace; color: #1d4ed8;">[${escaparHtml(art.numero)}]</span>
                    <span>${escaparHtml(art.nombre || 'Sin nombre')}</span>
                    ${badgeTipoHtml}
                </div>
                ${esSeleccionado ? '<span style="font-size: 11px; font-weight: 800; color: #ffffff; background: #1d4ed8; padding: 2px 8px; border-radius: 999px;">✓ Seleccionado</span>' : ''}
            </div>
            <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; margin-top: 5px;">
                <span style="background: ${colorPesoBg}; border: 1px solid ${colorPesoBd}; color: ${colorPesoTx}; font-weight: 800; padding: 1px 8px; border-radius: 5px;">
                    ⚖️ 1 envase = ${kgU.toFixed(2)} ${unidadTxt}
                </span>
                <span style="color: ${statusColor}; font-weight: 800; background: ${stockNum > 0 ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${stockNum > 0 ? '#bbf7d0' : '#fecaca'}; padding: 1px 8px; border-radius: 5px;">
                    📊 Stock Depósito: ${Number.isInteger(stockNum) ? stockNum : stockNum.toFixed(2)} u.
                </span>
                ${art.codigo_barras ? `<span style="color: #64748b; font-size: 11.5px;">🔖 ${escaparHtml(art.codigo_barras)}</span>` : ''}
            </div>
        `;

        li.addEventListener('click', () => seleccionarArticulo(art, { desdeEscaner: false }));
        listaResultados.appendChild(li);
    });
}

function seleccionarArticulo(art, { desdeEscaner = false, mantenerFocoEscaner = false, mantenerFocoBusqueda = false } = {}) {
    const kgU = parseFloat(art.kilos_unidad) > 0
        ? parseFloat(art.kilos_unidad)
        : deducirKilosUnidadDesdeNombre(art.nombre || art.descripcion);
    const unidadMedida = deducirUnidadMedidaDesdeNombre(art.nombre || art.descripcion);

    articuloSeleccionado = {
        ...art,
        kilos_unidad: kgU,
        unidad_medida: unidadMedida
    };
    currentAbastecimientoRequestId = generarRequestIdAbastecimiento();

    if (desdeEscaner) {
        mostrarAlertaEscaner(
            `✅ Código reconocido: <strong>[${escaparHtml(art.numero)}] ${escaparHtml(art.nombre || '')}</strong> (1 envase = ${kgU.toFixed(2)} ${unidadMedida})`,
            'success'
        );
    } else {
        mostrarAlertaEscaner(null);
    }

    const stockDep = parseFloat(art.stock_consolidado) || 0;
    if (divSeleccionado) {
        divSeleccionado.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                <div>
                    ✅ <strong>Envase elegido:</strong>
                    <span style="font-family: monospace; font-weight: 800;">[${escaparHtml(art.numero)}]</span>
                    <strong>${escaparHtml(art.nombre || '')}</strong>
                </div>
                <span style="background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; font-weight: 800; font-size: 12px; padding: 2px 8px; border-radius: 6px;">
                    1 envase = ${kgU.toFixed(2)} ${unidadMedida} · Stock: ${Number.isInteger(stockDep) ? stockDep : stockDep.toFixed(2)} u.
                </span>
            </div>
        `;
        divSeleccionado.style.display = 'block';
    }

    if (subtextoEnvaseUnitario) {
        subtextoEnvaseUnitario.innerHTML = `Cada unidad equivale a <strong>${kgU.toFixed(2)} ${unidadMedida}</strong>`;
    }

    const cantActual = parseInt(inputCantidad?.value || '0', 10);
    if (!inputCantidad.value || isNaN(cantActual) || cantActual < 1) {
        inputCantidad.value = '1';
        actualizarPillsPresetActiva(1);
    } else {
        actualizarPillsPresetActiva(cantActual);
    }

    renderizarListaFiltrada({ autoSeleccionarPrimero: false });
    calcularKilos();

    if (desdeEscaner && inputCantidad && !mantenerFocoEscaner && !mantenerFocoBusqueda) {
        inputCantidad.focus();
        inputCantidad.select();
    }
}

function calcularKilos() {
    if (!articuloSeleccionado) {
        if (btnConfirmar) {
            btnConfirmar.disabled = true;
            btnConfirmar.innerHTML = 'Confirmar Retiro';
        }
        if (divResumen) divResumen.style.display = 'none';
        return;
    }

    const cantRaw = parseInt(inputCantidad.value, 10);
    if (isNaN(cantRaw) || cantRaw < 1) {
        if (btnConfirmar) {
            btnConfirmar.disabled = true;
            btnConfirmar.innerHTML = 'Confirmar Retiro';
        }
        if (divResumen) divResumen.style.display = 'none';
        return;
    }

    const kgUnidad = articuloSeleccionado.kilos_unidad || DEFAULT_KILOS_FALLBACK;
    const unidad = articuloSeleccionado.unidad_medida || ingredienteUnidadBase || 'kg';
    const totalKilos = cantRaw * kgUnidad;
    const nuevoSaldo = saldoActualDomicilio + totalKilos;
    const stockDep = parseFloat(articuloSeleccionado.stock_consolidado) || 0;

    if (desgloseLinea1) {
        const avisoStockDep = cantRaw > stockDep
            ? ` <span style="font-size: 11.5px; font-weight: 700; color: #b45309; background: #fef3c7; border: 1px solid #fcd34d; padding: 1px 6px; border-radius: 4px; margin-left: 6px;">⚠️ Supera stock en depósito (${Number.isInteger(stockDep) ? stockDep : stockDep.toFixed(2)} u.)</span>`
            : '';
        desgloseLinea1.innerHTML = `📦 Retiro actual: ${cantRaw} × ${kgUnidad.toFixed(2)} ${unidad} = <span style="color: #15803d; text-decoration: underline;">+${totalKilos.toFixed(2)} ${unidad}</span>${avisoStockDep}`;
    }

    if (desgloseLinea2) {
        const colPrev = saldoActualDomicilio < -0.001 ? '#b91c1c' : '#334155';
        const colNuevo = nuevoSaldo < -0.001 ? '#b91c1c' : '#15803d';
        desgloseLinea2.innerHTML = `🏠 Saldo actual en domicilio: <strong style="color: ${colPrev};">${saldoActualDomicilio.toFixed(2)} ${unidad}</strong> &nbsp;→&nbsp; Nuevo saldo resultante: <strong style="color: ${colNuevo}; font-size: 14px;">${nuevoSaldo.toFixed(2)} ${unidad}</strong>`;
    }

    if (desgloseLinea3) {
        if (consumoCarroActual > 0.001) {
            const restoTrasCarro = nuevoSaldo - consumoCarroActual;
            if (restoTrasCarro >= -0.005) {
                desgloseLinea3.innerHTML = `🎯 Consumo de este carro: <strong>${consumoCarroActual.toFixed(2)} ${unidad}</strong> · <span style="color: #065f46; font-weight: 700;">✅ Cubre el carro (quedarán ${restoTrasCarro.toFixed(2)} ${unidad} libres)</span>`;
            } else {
                desgloseLinea3.innerHTML = `🎯 Consumo de este carro: <strong>${consumoCarroActual.toFixed(2)} ${unidad}</strong> · <span style="color: #b45309; font-weight: 700;">⚠️ Aún faltarían ${Math.abs(restoTrasCarro).toFixed(2)} ${unidad} para cubrir este carro</span>`;
            }
            desgloseLinea3.style.display = 'block';
        } else {
            desgloseLinea3.innerHTML = '';
            desgloseLinea3.style.display = 'none';
        }
    }

    if (divResumen) {
        divResumen.style.display = 'block';
    }

    if (btnConfirmar && !abastecimientoEnVuelo) {
        btnConfirmar.disabled = false;
        btnConfirmar.innerHTML = `Confirmar retiro (+${totalKilos.toFixed(2)} ${unidad})`;
    }
}

async function confirmarAbastecimiento(forzarRepetido = false) {
    if (abastecimientoEnVuelo) {
        console.warn('⏳ [ABASTECIMIENTO] Envío en curso, ignorando clic/Enter duplicado');
        return;
    }
    if (!articuloSeleccionado || !ingredienteDestinoId) return;

    const cantidad = parseInt(inputCantidad.value, 10);
    if (isNaN(cantidad) || cantidad < 1) {
        alert('Ingresá una cantidad entera mayor o igual a 1 envase.');
        return;
    }

    const colaboradorData = localStorage.getItem('colaboradorActivo');

    if (!colaboradorData) {
        alert('Debe tener un colaborador seleccionado');
        return;
    }

    const usuarioId = JSON.parse(colaboradorData).id;

    const workspaceContainer = document.getElementById('workspace-container');
    const carroId = workspaceContainer?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    const parsedCarroId = carroId ? parseInt(carroId, 10) : null;

    if (!currentAbastecimientoRequestId) {
        currentAbastecimientoRequestId = generarRequestIdAbastecimiento();
    }

    abastecimientoEnVuelo = true;
    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = 'Procesando...';
    if (inputCantidad) inputCantidad.disabled = true;
    if (btnRestarBulto) btnRestarBulto.disabled = true;
    if (btnSumarBulto) btnSumarBulto.disabled = true;

    const payload = {
        articulo_numero: articuloSeleccionado.numero,
        cantidad: cantidad,
        ingrediente_id: ingredienteDestinoId,
        usuario_id: usuarioId,
        carro_id: parsedCarroId,
        request_id: currentAbastecimientoRequestId,
        confirmar_repetido: Boolean(forzarRepetido)
    };

    try {
        const response = await fetch('/api/produccion/ingredientes/abastecer-stock-personal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            if (response.status === 409 && err.codigo === 'POSIBLE_DUPLICADO_RECIENTE') {
                abastecimientoEnVuelo = false;
                if (inputCantidad) inputCantidad.disabled = false;
                if (btnRestarBulto) btnRestarBulto.disabled = false;
                if (btnSumarBulto) btnSumarBulto.disabled = false;
                calcularKilos();

                let deseaRepetir = false;
                if (typeof Swal !== 'undefined') {
                    const resDup = await Swal.fire({
                        icon: 'warning',
                        title: '⚠️ Retiro idéntico recién registrado',
                        html: `<p style="font-size:0.95em;line-height:1.45;">${escaparHtml(err.error || 'Hace pocos segundos ya acreditaste un retiro idéntico de este insumo.')}</p><p style="margin-top:8px;font-weight:600;">¿Confirmás retirar bultos adicionales?</p>`,
                        showCancelButton: true,
                        confirmButtonText: 'Sí, retirar adicional',
                        cancelButtonText: 'No, ya estaba cargado',
                        confirmButtonColor: '#d97706',
                        cancelButtonColor: '#2563eb',
                        focusCancel: true
                    });
                    deseaRepetir = !!resDup.isConfirmed;
                } else {
                    deseaRepetir = window.confirm(`${err.error || 'Hace pocos segundos ya acreditaste un retiro idéntico.'}\n\n¿Confirmás retirar bultos adicionales?`);
                }

                if (deseaRepetir) {
                    currentAbastecimientoRequestId = generarRequestIdAbastecimiento();
                    return await confirmarAbastecimiento(true);
                }
                cerrarModal();
                return;
            }
            throw new Error(err.error || err.detalles || 'Fallo interno en el servidor');
        }

        const respData = await response.json().catch(() => ({}));
        currentAbastecimientoRequestId = null;

        if (typeof window.invalidarCacheCarro === 'function') {
            window.invalidarCacheCarro();
        }

        const kgU = articuloSeleccionado.kilos_unidad || DEFAULT_KILOS_FALLBACK;
        const totalKilos = respData.kilos_acreditados !== undefined
            ? parseFloat(respData.kilos_acreditados)
            : (cantidad * kgU);
        const saldoAnt = respData.saldo_anterior !== undefined
            ? parseFloat(respData.saldo_anterior)
            : saldoActualDomicilio;
        const saldoNvo = respData.saldo_actual !== undefined
            ? parseFloat(respData.saldo_actual)
            : (saldoAnt + totalKilos);
        const u = articuloSeleccionado.unidad_medida || ingredienteUnidadBase || 'kg';

        const mensajeExito = `${formatearConSigno(totalKilos)} ${u} ingresados (${cantidad} × ${kgU.toFixed(2)} ${u}) · Saldo anterior: ${saldoAnt.toFixed(2)} ${u} → Saldo actual: ${saldoNvo.toFixed(2)} ${u}`;
        cerrarModal();

        if (typeof Swal !== 'undefined') {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: `✅ ${mensajeExito}`,
                showConfirmButton: false,
                timer: 4500
            });
        } else if (typeof window.mostrarNotificacionExito === 'function') {
            window.mostrarNotificacionExito(`✅ ${mensajeExito}`);
        } else {
            alert(`✅ ${mensajeExito}`);
        }

        // Refrescar inmediatamente sin esperar el debounce de 500ms para que el saldo domiciliario se vea al instante
        if (parsedCarroId && typeof obtenerResumenIngredientesCarro === 'function' && typeof mostrarResumenIngredientes === 'function') {
            const ingredientes = await obtenerResumenIngredientesCarro(parsedCarroId, usuarioId);
            await mostrarResumenIngredientes(ingredientes);
        } else if (typeof actualizarResumenIngredientes === 'function') {
            await actualizarResumenIngredientes();
        }
    } catch (error) {
        alert('Hubo un error al confirmar el abastecimiento: ' + error.message);
        calcularKilos();
    } finally {
        abastecimientoEnVuelo = false;
        if (inputCantidad) inputCantidad.disabled = false;
        if (btnRestarBulto) btnRestarBulto.disabled = false;
        if (btnSumarBulto) btnSumarBulto.disabled = false;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarModal);
} else {
    inicializarModal();
}
