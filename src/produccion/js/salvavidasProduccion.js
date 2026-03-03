import { abrirModalIngresoManual } from './ingresoManual.js';
import { actualizarResumenIngredientes, obtenerResumenIngredientesCarro } from './carro.js';

let modalSalvavidas = null;
let inputKilosFaltantes = null;
let btnSincerarSalvavidas = null;
let currentIngredienteId = null;
let currentCarroId = null;

let currentNombreIngrediente = '';
let currentUnidadMedida = '';

let paso1Body = null;
let paso2Body = null;
let paso1Footer = null;
let paso2Footer = null;

let btnIngresarNuevo = null;
let btnSustituir = null;
let btnCerrarFin = null;

function inicializarModalSalvavidas() {
    if (modalSalvavidas) return;

    modalSalvavidas = document.getElementById('modal-salvavidas-produccion');
    if (!modalSalvavidas) return;

    inputKilosFaltantes = document.getElementById('salvavidas-kilos-faltantes');
    btnSincerarSalvavidas = document.getElementById('salvavidas-btn-sincerar');

    paso1Body = document.getElementById('salvavidas-paso-1-body');
    paso2Body = document.getElementById('salvavidas-paso-2-body');
    paso1Footer = document.getElementById('salvavidas-paso-1-footer');
    paso2Footer = document.getElementById('salvavidas-paso-2-footer');

    btnIngresarNuevo = document.getElementById('salvavidas-btn-ingreso');
    btnSustituir = document.getElementById('salvavidas-btn-sustituir');
    btnCerrarFin = document.getElementById('salvavidas-btn-cerrar-fin');

    if (btnSincerarSalvavidas) {
        btnSincerarSalvavidas.addEventListener('click', confirmarSalvavidas);
    }

    if (btnIngresarNuevo) {
        btnIngresarNuevo.addEventListener('click', () => {
            cerrarModalSalvavidas();
            abrirModalIngresoManual(currentIngredienteId, currentCarroId, false);
        });
    }

    if (btnSustituir) {
        btnSustituir.addEventListener('click', () => {
            cerrarModalSalvavidas();
            const kilosStr = parseFloat(inputKilosFaltantes.value.replace(',', '.'));
            if (window.abrirModalSustitucion) {
                window.abrirModalSustitucion(currentIngredienteId, kilosStr, currentNombreIngrediente, currentUnidadMedida);
            } else {
                console.error("No se encontró la función abrirModalSustitucion globalmente.");
            }
        });
    }

    if (btnCerrarFin) {
        btnCerrarFin.addEventListener('click', cerrarModalSalvavidas);
    }

    const btnCerrar = modalSalvavidas.querySelector('.close-modal');
    if (btnCerrar) {
        btnCerrar.addEventListener('click', cerrarModalSalvavidas);
    }

    const btnCancelar = document.getElementById('salvavidas-btn-cancelar');
    if (btnCancelar) {
        btnCancelar.addEventListener('click', cerrarModalSalvavidas);
    }

    // Inicializar drag and drop si existe la función global
    const header = modalSalvavidas.querySelector('.modal-header');
    if (header && typeof window.makeDraggable === 'function') {
        window.makeDraggable(modalSalvavidas.querySelector('.modal-content'), header);
    }
}

export function abrirModalSalvavidas(ingredienteId, nombreIngrediente, carroId, unidadMedida = '') {
    if (!modalSalvavidas) inicializarModalSalvavidas();
    if (!modalSalvavidas) {
        console.error('Modal salvavidas no encontrado en el DOM');
        return;
    }

    currentIngredienteId = ingredienteId;
    currentCarroId = carroId;
    currentNombreIngrediente = nombreIngrediente;
    currentUnidadMedida = unidadMedida;

    const nombreElement = document.getElementById('salvavidas-nombre-ingrediente');
    if (nombreElement) {
        nombreElement.textContent = nombreIngrediente;
    }

    if (inputKilosFaltantes) {
        inputKilosFaltantes.value = '';
    }

    // Resetear UI al Paso 1
    if (paso1Body && paso2Body && paso1Footer && paso2Footer) {
        paso1Body.style.display = 'block';
        paso1Footer.style.display = 'flex';
        paso2Body.style.display = 'none';
        paso2Footer.style.display = 'none';
    }

    modalSalvavidas.style.display = 'block';
    if (inputKilosFaltantes) inputKilosFaltantes.focus();
}

function cerrarModalSalvavidas() {
    if (modalSalvavidas) {
        modalSalvavidas.style.display = 'none';
    }
}

async function confirmarSalvavidas() {
    if (!inputKilosFaltantes) return;

    const kilosTxt = inputKilosFaltantes.value.replace(',', '.');
    const kilosStr = parseFloat(kilosTxt);

    if (isNaN(kilosStr) || kilosStr <= 0) {
        alert('Por favor ingresá una cantidad válida de kilos faltantes.');
        return;
    }

    if (!confirm(`¿Estás seguro de declarar ${kilosStr} kg como FALTANTE FANTASMA?\n\nEsto sincerará el inventario asumiendo que esa mercadería no existía físicamente.\nInmediatamente después podrás escanear un nuevo artículo para reponerla.`)) {
        return;
    }

    if (btnSincerarSalvavidas) {
        btnSincerarSalvavidas.disabled = true;
        btnSincerarSalvavidas.innerHTML = '⏳ Procesando...';
    }

    try {
        const response = await fetch('/api/produccion/salvavidas/ajuste-fantasma', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                carroId: currentCarroId,
                ingredienteId: currentIngredienteId,
                kilosFaltantes: kilosStr
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al procesar el ajuste fantasma');
        }

        // Finalizamos el Paso 1
        console.log(`✅ Paso 1 Salvavidas completado: ${kilosStr} kg deducidos.`);

        // Actualizamos UI de ingredientes para reflejar el cambio antes del Paso 2
        await actualizarResumenIngredientes();

        // Iniciamos el Paso 2 visualmente transicionando UI
        console.log(`🚀 Iniciando Paso 2 Salvavidas: Mostrando opciones.`);
        if (paso1Body && paso2Body && paso1Footer && paso2Footer) {
            paso1Body.style.display = 'none';
            paso1Footer.style.display = 'none';
            paso2Body.style.display = 'block';
            paso2Footer.style.display = 'flex';
        }

    } catch (error) {
        console.error('❌ Error en Salvavidas:', error);
        alert('Hubo un error al intentar ajustar el stock fantasma:\n' + error.message);
    } finally {
        if (btnSincerarSalvavidas) {
            btnSincerarSalvavidas.disabled = false;
            btnSincerarSalvavidas.innerHTML = 'Sí, Sincerar Falta y Reponer';
        }
    }
}

// Exponer globalmente para onclick desde HTML
window.abrirModalSalvavidas = abrirModalSalvavidas;
