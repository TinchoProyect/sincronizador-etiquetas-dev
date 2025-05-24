import { cargarDatosColaborador } from './utils.js';
import { 
    actualizarEstadoCarro, 
    crearNuevoCarro, 
    mostrarArticulosDelCarro,
    validarCarroActivo,
    seleccionarCarro,
    deseleccionarCarro,
    eliminarCarro
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

// Hacer funciones disponibles globalmente para los event handlers en el HTML
window.seleccionarCarro = seleccionarCarro;
window.deseleccionarCarro = deseleccionarCarro;
window.eliminarCarro = eliminarCarro;
window.agregarAlCarro = agregarAlCarro;
window.cerrarModalReceta = cerrarModalReceta;

// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    actualizarTituloPagina();
    cargarDatosColaborador(validarCarroActivo);
    mostrarArticulosDelCarro();

    // Agregar evento al botón de crear carro
    const btnCrearCarro = document.getElementById('crear-carro');
    if (btnCrearCarro) {
        btnCrearCarro.addEventListener('click', async () => {
            await crearNuevoCarro();
            mostrarArticulosDelCarro();
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
