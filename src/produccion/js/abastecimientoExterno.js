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

function manejarBusqueda() {
    const query = inputBusqueda.value.trim();
    listaResultados.innerHTML = '';

    if (query.length < 2 || !todosLosArticulos) {
        listaResultados.style.display = 'none';
        return;
    }

    const tokens = normalizar(query).split(' ').filter(t => t.length > 0);
    let resultados = todosLosArticulos.filter(art => {
        const nombreNorm = normalizar(art.nombre || art.descripcion || '');
        return tokens.every(token => nombreNorm.includes(token));
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
            console.warn('Artículo no posee kilos_unidad explicito. Usando default de fallback.');
            articuloSeleccionado.kilos_unidad = DEFAULT_KILOS_FALLBACK;
        }
    } catch(e) {
         articuloSeleccionado.kilos_unidad = DEFAULT_KILOS_FALLBACK;
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

    const totalKilos = cant * articuloSeleccionado.kilos_unidad;
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

    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = 'Procesando...';

    const payload = {
        articulo_numero: articuloSeleccionado.numero,
        cantidad: cantidad,
        ingrediente_id: ingredienteDestinoId,
        usuario_id: usuarioId
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

        const totalKilos = cantidad * articuloSeleccionado.kilos_unidad;
        const mensajeExito = `✅ Retiro confirmado: ${cantidad} x ${articuloSeleccionado.kilos_unidad} kg (Total: ${totalKilos.toFixed(2)} kg)`;
        console.log(mensajeExito);
        cerrarModal();
        
        // Brindar feedback visual nativo (si mostrarNotificacionExito está global o usar alert como fallback)
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
