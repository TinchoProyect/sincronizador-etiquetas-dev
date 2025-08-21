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
//Temporizacion - Mari

import {
  startEtapa1, stopEtapa1, startEtapa2, stopEtapa2,
  startEtapa3, stopEtapa3, showEtapa3Button
} from './temporizador_carro.js';





window.carroIdGlobal = null;


// ✅ Carro listo: corta etapa 1, inicia etapa 2 y luego marca el carro como preparado
window.carroPreparadoConTemporizador = async (carroId) => {
  try{
    const colab = JSON.parse(localStorage.getItem('colaboradorActivo')||'{}');
    if (!carroId || !colab?.id) return;

     console.log('[MEDICION] Carro listo → stop E1, start E2');
    await stopEtapa1(carroId, colab.id).catch(()=>{});
    await startEtapa2(carroId, colab.id);

    await marcarCarroPreparado(carroId); // tu función existente
  }catch(err){
    console.error(err);
    alert('No se pudo iniciar la Etapa 2 o marcar el carro como preparado.');
  }
};

// ✅ Asentar producción: corta etapa 2, inicia etapa 3 y luego finaliza producción
window.asentarProduccionConTemporizador = async (carroId) => {
  try{
    const colab = JSON.parse(localStorage.getItem('colaboradorActivo')||'{}');
    if (!carroId || !colab?.id) return;

     console.log('[MEDICION] Asentar prod. → stop E2, start E3');
    await stopEtapa2(carroId, colab.id).catch(()=>{});
    await startEtapa3(carroId, colab.id);
    showEtapa3Button(true);

    await finalizarProduccion(carroId); // tu función existente
  }catch(err){
    console.error(err);
    alert('No se pudo iniciar la Etapa 3 o asentar la producción.');
  }
};

//Modificacion etapa 2

// --------- ENSURE + REBIND de BOTONES (evita que vuelvan a lo viejo) ----------
function ensureBadgeEtapa2() {
  let badge = document.getElementById('badge-etapa2');
  if (!badge) {
    const actions = document.querySelector('.workspace-actions');
    if (actions) {
      badge = document.createElement('span');
      badge.id = 'badge-etapa2';
      badge.style.cssText = 'display:none;margin-left:8px;padding:4px 10px;border-radius:16px;background:#f0f0f0;';
      badge.textContent = 'Etapa 2: 00:00';
      actions.appendChild(badge);
      console.log('[MEDICION] badge-etapa2 creado');
    }
  }
}

function bindActionButtons() {
  // Carro listo para producir
  const prep = document.getElementById('carro-preparado');
  if (prep && prep.dataset.bound !== '1') {
    prep.onclick = (ev) => {
      ev.preventDefault();
      ev.stopImmediatePropagation(); // bloquea handlers viejos
      console.log('[MEDICION] Click Carro listo para producir');
      window.carroPreparadoConTemporizador?.(localStorage.getItem('carroActivo'));
      return false;
    };
    prep.dataset.bound = '1';
    console.log('[MEDICION] Reemplazado handler de #carro-preparado');
  }

  // Asentar producción
  const fin = document.getElementById('finalizar-produccion');
  if (fin && fin.dataset.bound !== '1') {
    fin.onclick = (ev) => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      console.log('[MEDICION] Click Asentar producción');
      window.asentarProduccionConTemporizador?.(localStorage.getItem('carroActivo'));
      return false;
    };
    fin.dataset.bound = '1';
    console.log('[MEDICION] Reemplazado handler de #finalizar-produccion');
  }

  ensureBadgeEtapa2();
}

// Corre al cargar…
document.addEventListener('DOMContentLoaded', bindActionButtons);

// …y se vuelve a correr cuando el DOM cambia (por re-renders)
const _btnObserver = new MutationObserver(() => bindActionButtons());
_btnObserver.observe(document.body, { childList: true, subtree: true });

// También ejecutalo tras tus re-renders grandes si querés:
window._bindActionButtons = bindActionButtons;

//Fin modificacion etapa 2

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
window.imprimirOrdenProduccion = imprimirOrdenProduccion;
// 🚀 [DIAGNÓSTICO] Agregar log para verificar que la función está disponible globalmente
console.log('🔍 [DIAGNÓSTICO] Función abrirModalGuardadoIngredientes disponible globalmente:', typeof window.abrirModalGuardadoIngredientes);

window.abrirModalGuardadoIngredientes = abrirModalGuardadoIngredientes;

// 🚀 [DIAGNÓSTICO] Verificar después de asignar
console.log('🔍 [DIAGNÓSTICO] Función asignada correctamente:', typeof window.abrirModalGuardadoIngredientes);

// Importar y hacer disponibles las funciones del modal simplificado
import { cerrarModalEditarVinculo, procesarGuardadoVinculo } from './carro.js';
window.cerrarModalEditarVinculo = cerrarModalEditarVinculo;
window.procesarGuardadoVinculo = procesarGuardadoVinculo;

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
        
        window.carroIdGlobal = localStorage.getItem('carroActivo');
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

    // Agregar evento al switch de filtro de producción
    const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
    if (filtroProduccionSwitch) {
        filtroProduccionSwitch.addEventListener('change', () => aplicarFiltros(0));
    }
    
    // Agregar evento al input de código de barras
    document.getElementById('codigo-barras').addEventListener('change', (e) => {
        buscarPorCodigoBarras(e.target.value);
    });

    // Cerrar modales al hacer clic fuera
    window.addEventListener('click', (e) => {
        const modalArticulos = document.getElementById('modal-articulos');
        const modalReceta = document.getElementById('modal-receta');
        const modalEditarVinculo = document.getElementById('modal-editar-vinculo');
        
        if (e.target === modalArticulos) {
            cerrarModalArticulos();
        } else if (e.target === modalReceta) {
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



