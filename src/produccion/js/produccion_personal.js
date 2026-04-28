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
    mostrarResumenMixes,
    obtenerResumenArticulosCarro,
    mostrarResumenArticulos
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
import { imprimirOrdenProduccion } from './ordenProduccion.js';
import { abrirModalGuardadoIngredientes } from './guardadoIngredientes.js';
import { abrirModalSalvavidas } from './salvavidasProduccion.js';



// Hacer funciones disponibles globalmente para los event handlers en el HTML
// NO envolver - dejar que carro.js maneje todo el flujo internamente
window.seleccionarCarro = seleccionarCarro;
window.deseleccionarCarro = deseleccionarCarro;

window.eliminarCarro = eliminarCarro;
window.agregarAlCarro = agregarAlCarro;
window.cerrarModalReceta = cerrarModalReceta;
window.abrirModalIngresoManual = abrirModalIngresoManual;
window.imprimirOrdenProduccion = imprimirOrdenProduccion;
// Exportar funciones unificadas de guardado de ingredientes
window.abrirModalGuardadoIngredientes = abrirModalGuardadoIngredientes;
window.abrirModalSalvavidas = abrirModalSalvavidas;

// === NUEVO: Ejecutor Unificado de Creación de Carros ===
window.ejecutarCreacionCarro = async function(tipoCarro) {
    try {
        const modal = document.getElementById('modal-tipo-carro');
        if (modal) modal.style.display = 'none';

        // Primero deseleccionar el carro actual
        await deseleccionarCarro();
        // Luego crear el nuevo carro con el tipo elegido
        await crearNuevoCarro(tipoCarro);
        // Finalmente mostrar los artículos
        await mostrarArticulosDelCarro();

        
        // Cargar y mostrar resumen de ingredientes y mixes
        await cargarResumenIngredientes();
    } catch (error) {
        console.error('Error al ejecutar creación unificada de carro:', error);
    }
};
// 🚀 [DIAGNÓSTICO] Verificar después de asignar
console.log('🔍 [DIAGNÓSTICO] Función asignada correctamente:', typeof window.abrirModalGuardadoIngredientes);

// Importar y hacer disponibles las funciones del modal simplificado
import { cerrarModalEditarVinculo, procesarGuardadoVinculo } from './carro.js';
window.cerrarModalEditarVinculo = cerrarModalEditarVinculo;
window.procesarGuardadoVinculo = procesarGuardadoVinculo;

// CONFIGURACIÓN: Artículos que permiten ingreso por unidades
// Key: Parte del nombre o ID del artículo (minúsculas)
// Value: Peso por unidad en KG
const CONVERSION_ARTICULOS = {
    'barra flor': 0.05,       // Barritas (4.8kg / 96u = 0.05kg)
    'alfajor': 0.06        // Ejemplo futuro
};

/**
 * Configura la entrada dual (Kilos <-> Unidades) si el artículo lo permite.
 * @param {string} nombreArticulo - Descripción del artículo principal del carro
 */
function configurarInputDual(nombreArticulo) {
    const containerUnidades = document.getElementById('container-unidades-helper');
    const inputKilos = document.getElementById('kilos-producidos');
    const inputUnidades = document.getElementById('unidades-producidas');
    const labelFactor = document.getElementById('factor-conversion-texto');

    if (!nombreArticulo || !containerUnidades || !inputKilos || !inputUnidades) return;

    // 1. Buscar si el artículo coincide con alguna configuración
    const nombreNormalizado = nombreArticulo.toLowerCase();
    let factorConversion = null;

    for (const [clave, factor] of Object.entries(CONVERSION_ARTICULOS)) {
        if (nombreNormalizado.includes(clave)) {
            factorConversion = factor;
            break;
        }
    }

    // 2. Si no hay configuración, ocultar el helper y salir
    if (!factorConversion) {
        containerUnidades.style.display = 'none';
        // Limpiamos listeners previos clonando el nodo
        const newKilos = inputKilos.cloneNode(true);
        inputKilos.parentNode.replaceChild(newKilos, inputKilos);
        return;
    }

    // 3. Activar modo dual
    console.log(`⚖️ Activando modo unidades para: ${nombreArticulo} (Factor: ${factorConversion})`);
    containerUnidades.style.display = 'block';
    labelFactor.textContent = `1 unidad ≈ ${factorConversion} kg`;

    // Limpiar input de unidades
    inputUnidades.value = '';

    // Si ya hay kilos cargados, calcular las unidades iniciales
    if (inputKilos.value) {
        inputUnidades.value = Math.round(parseFloat(inputKilos.value) / factorConversion);
    }

    // --- EVENT LISTENERS (Bidireccionales) ---

    // A. Si Matías escribe Unidades -> Calculamos Kilos
    inputUnidades.oninput = function () {
        const unidades = parseFloat(this.value);
        if (!isNaN(unidades)) {
            const kilos = (unidades * factorConversion).toFixed(2);
            inputKilos.value = kilos;
        } else {
            inputKilos.value = '';
        }
    };

    // B. Si Matías escribe Kilos -> Calculamos Unidades
    // Reemplazamos el nodo de kilos primero para asegurar un listener limpio (ya hecho arriba si no aplica, pero aqui lo asignamos directo)
    inputKilos.oninput = function () {
        const kilos = parseFloat(this.value);
        if (!isNaN(kilos)) {
            const unidades = Math.round(kilos / factorConversion);
            inputUnidades.value = unidades;
        } else {
            inputUnidades.value = '';
        }
    };
}

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

        // Los permisos se verifican automáticamente en actualizarEstadoCarro()

        await cargarDatosColaborador(async () => {
            await validarCarroActivo(colaborador.id);
        });

        // Solo después de validar el carro, mostrar los artículos
        await mostrarArticulosDelCarro();

        
        // Cargar y mostrar resumen de ingredientes y mixes
        await cargarResumenIngredientes();

        // Inicializar el informe de ingresos manuales
        if (typeof window.actualizarInformeIngresosManuales === 'function') {
            await window.actualizarInformeIngresosManuales();
        }

    } catch (error) {
        console.error('Error al inicializar espacio de trabajo:', error);
    }
}

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

    // Agregar evento al botón principal de Crear Carro (Abre el Modal Selector)
    const btnCrearCarro = document.getElementById('crear-carro');
    if (btnCrearCarro) {
        btnCrearCarro.addEventListener('click', () => {
            const modal = document.getElementById('modal-tipo-carro');
            if (modal) {
                modal.style.display = 'flex';
                // User Efficiency: Foco predeterminado en Producción Interna
                setTimeout(() => {
                    const btnInterna = document.getElementById('btn-opcion-interna');
                    if (btnInterna) btnInterna.focus();
                }, 50); // Mínimo retardo para garantizar el reflow del display:flex
            }
        });
    }

    // El event listener para el botón de agregar artículo se manejará 
    // después de que se muestre en mostrarArticulosDelCarro()

    // Observar cambios en el DOM para agregar el event listener al botón cuando aparezca
    // Y detectar si hay artículos especiales (Barritas) para habilitar el input dual
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length) {
                // 1. Configurar botón de agregar (Lógica original)
                const btnAgregarArticulo = document.getElementById('agregar-articulo');
                if (btnAgregarArticulo && !btnAgregarArticulo.hasEventListener) {
                    btnAgregarArticulo.addEventListener('click', abrirModalArticulos);
                    btnAgregarArticulo.hasEventListener = true;
                }

                // 2. NUEVO: Detectar artículo para conversión de unidades (Barritas)
                // Buscamos si se renderizó la descripción del artículo en el carro
                const descripcionElement = document.querySelector('.articulo-descripcion');
                if (descripcionElement) {
                    configurarInputDual(descripcionElement.textContent);
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

    // Agregar evento al campo de búsqueda inteligente
    const busquedaInteligente = document.getElementById('busqueda-inteligente');
    if (busquedaInteligente) {
        busquedaInteligente.addEventListener('input', () => aplicarFiltros(0));
        console.log('🔍 [BÚSQUEDA INTELIGENTE] Event listener configurado');
    }

    // Agregar evento al switch de filtro de producción
    const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
    if (filtroProduccionSwitch) {
        filtroProduccionSwitch.addEventListener('change', () => aplicarFiltros(0));
    }

    // Agregar evento al input de código de barras
    document.getElementById('codigo-barras').addEventListener('change', (e) => {
        buscarPorCodigoBarras(e.target.value);
    });

    // ELIMINADO: Cerrar modales al hacer clic fuera
    // El modal de artículos ahora es PERSISTENTE (backdrop estático)
    // Solo se cierra con el botón X o botón Cerrar
    // La funcionalidad de arrastre está manejada por modal-draggable.js

    // Mantener cierre para modal de receta (comportamiento original)
    window.addEventListener('click', (e) => {
        const modalReceta = document.getElementById('modal-receta');
        const modalEditarVinculo = document.getElementById('modal-editar-vinculo');

        if (e.target === modalReceta) {
            cerrarModalReceta();
        } else if (e.target === modalEditarVinculo) {
            window.cerrarModalEditarVinculo();
        }
    });

    // Event listeners para el modal simplificado de edición de vínculos
    document.addEventListener('click', (e) => {
        // Botón cerrar modal simplificado
        if (e.target.closest('#modal-editar-vinculo .close-modal')) {
            window.cerrarModalEditarVinculo();
        }

        // Botón guardar vínculo
        if (e.target.id === 'btn-guardar-vinculo') {
            window.procesarGuardadoVinculo();
        }
    });

    // Mostrar estado inicial del carro
    actualizarEstadoCarro();
});

async function cargarResumenIngredientes() {
    try {
        const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
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

            // Limpiar sección de artículos
            const contenedorArticulos = document.getElementById('tabla-resumen-articulos');
            if (contenedorArticulos) {
                contenedorArticulos.innerHTML = '<p>No hay carro activo</p>';
            }

            // Ocultar sección de artículos
            const seccionArticulos = document.getElementById('resumen-articulos');
            if (seccionArticulos) {
                seccionArticulos.style.display = 'none';
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

        // Obtener y mostrar el resumen de artículos (solo para carros externos)
        const articulos = await obtenerResumenArticulosCarro(carroId, colaborador.id);
        if (articulos && articulos.length > 0) {
            mostrarResumenArticulos(articulos);
            const seccionArticulos = document.getElementById('resumen-articulos');
            if (seccionArticulos) {
                seccionArticulos.style.display = 'block';
            }
        } else {
            const seccionArticulos = document.getElementById('resumen-articulos');
            if (seccionArticulos) {
                seccionArticulos.style.display = 'none';
            }
        }

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

        const contenedorArticulos = document.getElementById('tabla-resumen-articulos');
        if (contenedorArticulos) {
            contenedorArticulos.innerHTML = '<p>Error al cargar el resumen de artículos</p>';
        }
    }
}



