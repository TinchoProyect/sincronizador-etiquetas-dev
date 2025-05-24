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
    actualizarTituloPagina
} from './articulos.js';

// Hacer funciones disponibles globalmente para los event handlers en el HTML
window.seleccionarCarro = seleccionarCarro;
window.deseleccionarCarro = deseleccionarCarro;
window.eliminarCarro = eliminarCarro;
window.agregarAlCarro = agregarAlCarro;

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

    // Agregar evento al botón de agregar artículo
    const btnAgregarArticulo = document.getElementById('agregar-articulo');
    if (btnAgregarArticulo) {
        btnAgregarArticulo.addEventListener('click', abrirModalArticulos);
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

    // Cerrar modal al hacer clic fuera
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('modal-articulos');
        if (e.target === modal) {
            cerrarModalArticulos();
        }
    });

    // Mostrar estado inicial del carro
    actualizarEstadoCarro();
});
