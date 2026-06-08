// src/produccion/js/abastecimientoExterno.js

import { actualizarResumenIngredientes } from './carro.js';

let modal = null;
let inputBusqueda = null;
let listaResultados = null;
let inputCantidad = null;
let btnConfirmar = null;
let nombreIngredienteDisplay = null;
let spanKilosTotales = null;
let divResumen = null;

let ingredienteDestinoId = null;
let articuloSeleccionado = null;

function inicializarModal() {
    modal = document.getElementById('modalAbastecimientoExterno');
    if (!modal) return;

    inputBusqueda = document.getElementById('buscarArticuloAbastecer');
    listaResultados = document.getElementById('listaArticulosAbastecer');
    inputCantidad = document.getElementById('cantidadBultosAbastecer');
    btnConfirmar = document.getElementById('btnConfirmarAbastecimiento');
    nombreIngredienteDisplay = document.getElementById('nombre-ingrediente-abastecer');
    spanKilosTotales = document.getElementById('kilos-totales-abastecer');
    divResumen = document.getElementById('resumen-abastecimiento');

    // Mapeo de eventos
    const btnCloseElements = modal.querySelectorAll('.close-modal');
    btnCloseElements.forEach(btn => btn.addEventListener('click', cerrarModal));

    inputBusqueda.addEventListener('input', manejarBusqueda);
    inputCantidad.addEventListener('input', calcularKilos);
    btnConfirmar.addEventListener('click', confirmarAbastecimiento);
}

let todosLosArticulos = null;

// Función expuesta globalmente para que `carro.js` la pueda invocar
window.abrirModalAbastecimientoExterno = async function(ingredienteId, nombreIngrediente) {
    if (!modal) inicializarModal();
    if (!modal) return;

    ingredienteDestinoId = ingredienteId;
    articuloSeleccionado = null;
    
    // Limpieza de campos
    inputBusqueda.value = '';
    inputCantidad.value = '';
    listaResultados.innerHTML = '';
    divResumen.style.display = 'none';
    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = 'Confirmar Retiro';

    if (!todosLosArticulos) {
        inputBusqueda.placeholder = "Cargando catálogo central...";
        inputBusqueda.disabled = true;
        try {
            const response = await fetch('http://localhost:3002/api/produccion/articulos');
            if (response.ok) {
                let data = await response.json();
                todosLosArticulos = data.data || data;
            } else {
                todosLosArticulos = [];
            }
        } catch (error) {
            console.error('Error cargando catálogo:', error);
            todosLosArticulos = [];
        }
        inputBusqueda.disabled = false;
        inputBusqueda.placeholder = "Escriba el nombre del artículo...";
    }

    // Sugerencia inicial
    nombreIngredienteDisplay.textContent = `Abasteciendo: ${nombreIngrediente}`;
    inputBusqueda.value = nombreIngrediente; 
    
    modal.classList.add('show');
    manejarBusqueda(); // Dispara la búsqueda automática con el nombre sugerido
};

function cerrarModal() {
    if (modal) {
        modal.classList.remove('show');
    }
}

function normalizar(texto) {
    if (!texto) return '';
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Parseador inteligente de unidades físicas desde la descripción (para fallback)
function deducirKilosUnidadDesdeNombre(nombre) {
    if (!nombre) return 1;
    const norm = nombre.toLowerCase();
    
    // 1. Coincidencia del tipo "X x Y litros/l/kg/g/unidades" o "X x Y"
    const regex1 = /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(litros|l|kg|g|unidades)?/i;
    const match1 = norm.match(regex1);
    if (match1) {
        const qty = parseFloat(match1[1]);
        const unitVal = parseFloat(match1[2]);
        const unitStr = match1[3] || '';
        
        let multiplier = 1;
        if (unitStr.startsWith('g')) {
            multiplier = 0.001;
        }
        return qty * unitVal * multiplier;
    }

    // 2. Coincidencia del tipo "x Y litros/l/kg/g"
    const regex2 = /x\s*(\d+(?:\.\d+)?)\s*(litros|l|kg|g)/i;
    const match2 = norm.match(regex2);
    if (match2) {
        const unitVal = parseFloat(match2[1]);
        const unitStr = match2[2];
        let multiplier = 1;
        if (unitStr.startsWith('g')) {
            multiplier = 0.001;
        }
        return unitVal * multiplier;
    }

    // 3. Coincidencia del tipo "Y litros/l/kg/g"
    const regex3 = /(\d+(?:\.\d+)?)\s*(litros|l|kg|g)\b/i;
    const match3 = norm.match(regex3);
    if (match3) {
        const unitVal = parseFloat(match3[1]);
        const unitStr = match3[2];
        let multiplier = 1;
        if (unitStr.startsWith('g')) {
            multiplier = 0.001;
        }
        return unitVal * multiplier;
    }

    return 1;
}

// Deducir unidad de medida L o kg para la UI
function deducirUnidadMedidaDesdeNombre(nombre) {
    if (!nombre) return 'kg';
    const norm = nombre.toLowerCase();
    if (norm.includes('litro') || norm.includes(' l ') || norm.endsWith(' l') || norm.includes(' l\b') || /\d+\s*l\b/.test(norm)) {
        return 'L';
    }
    return 'kg';
}

function manejarBusqueda() {
    const query = inputBusqueda.value.trim();
    listaResultados.innerHTML = '';

    if (query.length < 2 || !todosLosArticulos) {
        listaResultados.style.display = 'none';
        return;
    }

    // Evaluación de escaneo: coincidencia exacta por código de barras o SKU/Número
    const exactMatch = todosLosArticulos.find(art => 
        (art.codigo_barras && art.codigo_barras.trim() === query) || 
        (art.numero && art.numero.trim() === query)
    );

    if (exactMatch) {
        console.log('[ABASTECIMIENTO] Coincidencia exacta detectada (Escáner):', query);
        seleccionarArticulo(exactMatch);
        return;
    }

    const tokens = normalizar(query).split(' ').filter(t => t.length > 0);
    let resultados = todosLosArticulos.filter(art => {
        const nombreNorm = normalizar(art.nombre || art.descripcion || '');
        const codigoNorm = normalizar(art.codigo_barras || '');
        const numeroNorm = normalizar(art.numero || '');
        
        return tokens.every(token => 
            nombreNorm.includes(token) || 
            codigoNorm.includes(token) || 
            numeroNorm.includes(token)
        );
    });

    listaResultados.style.display = 'block';

    if (resultados.length === 0) {
        listaResultados.innerHTML = '<li style="padding: 10px; color: #666;">No se encontraron artículos</li>';
        return;
    }

    // Limitar a los mejores 10 resultados para no sobrecargar el dom
    resultados.slice(0, 10).forEach(art => {
        const li = document.createElement('li');
        li.style.padding = '8px 12px';
        li.style.cursor = 'pointer';
        li.style.borderBottom = '1px solid #eee';
        
        const stockNum = parseFloat(art.stock_consolidado) || 0;
        const statusColor = stockNum > 0 ? '#2e7d32' : '#c62828';
        
        li.innerHTML = `
            <div style="font-weight: 500; font-size: 14px; text-transform: uppercase;">📦 ${art.nombre || art.descripcion || 'Sin nombre'}</div>
            <div style="font-size: 13px; color: ${statusColor}; margin-top: 3px; font-weight: bold;">📊 Stock Depósito: ${stockNum.toFixed(2)}</div>
        `;
        
        li.addEventListener('click', () => seleccionarArticulo(art));
        listaResultados.appendChild(li);
    });
}

// Fallback por defecto si el artículo no tiene kilos_unidad declarado (muy raro, pero posible)
const DEFAULT_KILOS_FALLBACK = 1;

async function seleccionarArticulo(art) {
    articuloSeleccionado = art;
    inputBusqueda.value = art.nombre || art.descripcion || '';
    listaResultados.innerHTML = '';
    listaResultados.style.display = 'none';
    
    inputCantidad.value = '1';
    
    // Obtenemos los kilos unidad frescos
    try {
        const resp = await fetch(`http://localhost:3002/api/produccion/articulos`);
        let arts = await resp.json();
        arts = arts.data || arts;
        const target = arts.find(a => a.numero === art.numero);
        if (target && target.kilos_unidad) {
            articuloSeleccionado.kilos_unidad = parseFloat(target.kilos_unidad);
        } else {
            console.warn('Artículo no posee kilos_unidad explicito en base de datos. Autodeduciendo...');
            articuloSeleccionado.kilos_unidad = deducirKilosUnidadDesdeNombre(art.nombre || art.descripcion);
        }
    } catch(e) {
        console.warn('Error fetching fresh weight. Autodeduciendo...');
        articuloSeleccionado.kilos_unidad = deducirKilosUnidadDesdeNombre(art.nombre || art.descripcion);
    }

    // Actualizar unidad física en UI
    const unidadMedida = deducirUnidadMedidaDesdeNombre(art.nombre || art.descripcion);
    articuloSeleccionado.unidad_medida = unidadMedida;
    
    const labelUnidad = document.getElementById('unidad-abastecer-label');
    if (labelUnidad) {
        labelUnidad.textContent = unidadMedida;
    }

    calcularKilos();
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

    // Obtener carroId de la interfaz o de la sesión
    const workspaceContainer = document.getElementById('workspace-container');
    const carroId = workspaceContainer?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    const parsedCarroId = carroId ? parseInt(carroId) : null;

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
        const response = await fetch('http://localhost:3002/api/produccion/ingredientes/abastecer-stock-personal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || err.detalles || 'Fallo interno en el servidor');
        }

        const totalKilos = cantidad * (articuloSeleccionado.kilos_unidad || DEFAULT_KILOS_FALLBACK);
        const u = articuloSeleccionado.unidad_medida || 'kg';
        const mensajeExito = `✅ Retiro confirmado: ${cantidad} x ${articuloSeleccionado.kilos_unidad} ${u} (Total: ${totalKilos.toFixed(2)} ${u})`;
        console.log(mensajeExito);
        cerrarModal();
        
        // Brindar feedback visual nativo
        if (typeof window.mostrarNotificacionExito === 'function') {
            window.mostrarNotificacionExito(mensajeExito);
        } else {
            alert(mensajeExito);
        }
        
        // Actualizar UI llamando directamente a la macro exportada del módulo carro.js
        if (typeof actualizarResumenIngredientes === 'function') {
            await actualizarResumenIngredientes();
        }

    } catch (error) {
        alert('Hubo un error al confirmar el abastecimiento: ' + error.message);
        btnConfirmar.disabled = false;
        btnConfirmar.innerHTML = 'Confirmar Retiro';
    }
}

// Inicialización asincrónica para asegurar el binding de eventos si la página cargó defer mode
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarModal);
} else {
    inicializarModal();
}
