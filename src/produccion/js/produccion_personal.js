import { cargarDatosColaborador } from './utils.js';
import { 
    actualizarEstadoCarro, 
    crearNuevoCarro, 
    mostrarArticulosDelCarro,
    validarCarroActivo,
    seleccionarCarro,
    deseleccionarCarro,
    eliminarCarro,
    obtenerResumenIngredientesCarro,
    mostrarResumenIngredientes,
    obtenerResumenMixesCarro,
    mostrarResumenMixes
} from './carro.js';
import {
    abrirModalArticulos,
    cerrarModalArticulos,
    aplicarFiltros,
    buscarPorCodigoBarras,
    agregarAlCarro,
    actualizarTituloPagina,
    cerrarModalReceta
} from './articulos.js';

import { abrirModalIngresoManual } from './ingresoManual.js';
import { actualizarVisibilidadBotones } from './carroPreparado.js';
window.carroIdGlobal = null;

// Hacer funciones disponibles globalmente para los event handlers en el HTML
// Envolver las funciones originales para agregar la actualización de botones
window.seleccionarCarro = async (...args) => {
    await seleccionarCarro(...args);
    await actualizarVisibilidadBotones();
};

window.deseleccionarCarro = async (...args) => {
    await deseleccionarCarro(...args);
    await actualizarVisibilidadBotones();
};

window.eliminarCarro = eliminarCarro;
window.agregarAlCarro = agregarAlCarro;
window.cerrarModalReceta = cerrarModalReceta;
window.abrirModalIngresoManual = abrirModalIngresoManual;

// Función asíncrona para inicializar el espacio de trabajo
async function inicializarEspacioTrabajo() {
    try {
        actualizarTituloPagina();
        
        // Cargar datos del colaborador y esperar la validación del carro
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            window.location.href = '/pages/produccion.html';
            return;
        }
        
        const colaborador = JSON.parse(colaboradorData);
        await cargarDatosColaborador(async () => {
            await validarCarroActivo(colaborador.id);
        });
        
        // Solo después de validar el carro, mostrar los artículos
        await mostrarArticulosDelCarro();
        
        window.carroIdGlobal = localStorage.getItem('carroActivo');
        // Cargar y mostrar resumen de ingredientes y mixes
        await cargarResumenIngredientes();
        
    } catch (error) {
        console.error('Error al inicializar espacio de trabajo:', error);
    }
}

// Inicializar cuando se carga la página
// Función para mostrar/ocultar el campo cantidad
function toggleCantidadField() {
    const selector = document.getElementById('selector-ingrediente');
    const cantidadContainer = document.getElementById('cantidad-container');
    if (!selector || !cantidadContainer) return;

    if (selector.value) {
        cantidadContainer.style.display = 'block';
    } else {
        cantidadContainer.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Iniciar el espacio de trabajo de forma asíncrona
    inicializarEspacioTrabajo();

    // Configurar el evento change para el selector de ingredientes
    const selectorIngrediente = document.getElementById('selector-ingrediente');
    if (selectorIngrediente) {
        selectorIngrediente.addEventListener('change', toggleCantidadField);
        // Ejecutar una vez al inicio para establecer el estado correcto
        toggleCantidadField();
    }

    // Agregar evento al botón de crear carro
    const btnCrearCarro = document.getElementById('crear-carro');
    if (btnCrearCarro) {
        btnCrearCarro.addEventListener('click', async () => {
            // Primero deseleccionar el carro actual
            await deseleccionarCarro();
            // Luego crear el nuevo carro
            await crearNuevoCarro();
            // Finalmente mostrar los artículos
            await mostrarArticulosDelCarro();

            window.carroIdGlobal = localStorage.getItem('carroActivo');
            // Cargar y mostrar resumen de ingredientes y mixes
            await cargarResumenIngredientes();
        });
    }

    // El event listener para el botón de agregar artículo se manejará 
    // después de que se muestre en mostrarArticulosDelCarro()

    // Observar cambios en el DOM para agregar el event listener al botón cuando aparezca
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length) {
                const btnAgregarArticulo = document.getElementById('agregar-articulo');
                if (btnAgregarArticulo && !btnAgregarArticulo.hasEventListener) {
                    btnAgregarArticulo.addEventListener('click', abrirModalArticulos);
                    btnAgregarArticulo.hasEventListener = true;
                }
            }
        });
    });

    // Observar el contenedor de artículos para detectar cuando se agrega el botón
    const listaArticulos = document.getElementById('lista-articulos');
    if (listaArticulos) {
        observer.observe(listaArticulos, { childList: true, subtree: true });
    }

    // Agregar evento al botón de cerrar modal
    const closeModal = document.querySelector('.close-modal');
    if (closeModal) {
        closeModal.addEventListener('click', cerrarModalArticulos);
    }

    // Agregar eventos a los filtros
    document.getElementById('filtro1').addEventListener('input', () => aplicarFiltros(1));
    document.getElementById('filtro2').addEventListener('input', () => aplicarFiltros(2));
    document.getElementById('filtro3').addEventListener('input', () => aplicarFiltros(3));
    
    // Agregar evento al input de código de barras
    document.getElementById('codigo-barras').addEventListener('change', (e) => {
        buscarPorCodigoBarras(e.target.value);
    });

    // Cerrar modales al hacer clic fuera
    window.addEventListener('click', (e) => {
        const modalArticulos = document.getElementById('modal-articulos');
        const modalReceta = document.getElementById('modal-receta');
        
        if (e.target === modalArticulos) {
            cerrarModalArticulos();
        } else if (e.target === modalReceta) {
            cerrarModalReceta();
        }
    });

    // Mostrar estado inicial del carro
    actualizarEstadoCarro();
});

// Función para cargar y mostrar el resumen de ingredientes del carro activo
async function cargarResumenIngredientes() {
    try {
        const carroId = localStorage.getItem('carroActivo');
        if (!carroId) {
            // Limpiar la sección de resumen si no hay carro activo
            const contenedor = document.getElementById('tabla-resumen-ingredientes');
            if (contenedor) {
                contenedor.innerHTML = '<p>No hay carro activo</p>';
            }
            
            // También limpiar la sección de mixes
            const contenedorMixes = document.getElementById('tabla-resumen-mixes');
            if (contenedorMixes) {
                contenedorMixes.innerHTML = '<p>No hay carro activo</p>';
            }
            return;
        }

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            return;
        }

        const colaborador = JSON.parse(colaboradorData);
        
        // Obtener el resumen consolidado de ingredientes
        const ingredientes = await obtenerResumenIngredientesCarro(carroId, colaborador.id);
        
        // Mostrar el resumen en la UI
        mostrarResumenIngredientes(ingredientes);
        
        // Obtener y mostrar el resumen de mixes
        const mixes = await obtenerResumenMixesCarro(carroId, colaborador.id);
        mostrarResumenMixes(mixes);
        
        // Actualizar visibilidad de los botones después de cargar ingredientes
        await actualizarVisibilidadBotones();
        
    } catch (error) {
        console.error('Error al cargar resumen de ingredientes:', error);
        const contenedor = document.getElementById('tabla-resumen-ingredientes');
        if (contenedor) {
            contenedor.innerHTML = '<p>Error al cargar el resumen de ingredientes</p>';
        }
        
        const contenedorMixes = document.getElementById('tabla-resumen-mixes');
        if (contenedorMixes) {
            contenedorMixes.innerHTML = '<p>Error al cargar el resumen de mixes</p>';
        }
    }
}
