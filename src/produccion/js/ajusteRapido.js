/**
 * Módulo de Ajuste Rápido de Stock Reversible
 * Permite corregir el stock de ingredientes directamente desde la pantalla de producción
 * Los ajustes se vinculan al carro_id para reversión automática al eliminar el carro
 */

import { registrarMovimientoIngrediente } from './apiMovimientos.js';
import { actualizarResumenIngredientes } from './carro.js';

// Variables globales del modal
let modalAjuste = null;
let ingredienteIdActual = null;
let stockSistemaActual = null;
let carroIdActual = null;
let nombreIngredienteActual = null;

/**
 * Inicializa el modal de ajuste rápido
 */
function inicializarModalAjuste() {

  modalAjuste = document.getElementById('modalAjusteKilos');

  if (!modalAjuste) {
    return;
  }

  // Configurar listeners
  const btnCerrar = modalAjuste.querySelectorAll('.close-modal');
  btnCerrar.forEach(btn => {
    btn.addEventListener('click', cerrarModalAjuste);
  });

  const btnConfirmar = document.getElementById('btn-confirmar-ajuste');
  if (btnConfirmar) {
    btnConfirmar.addEventListener('click', confirmarAjuste);
  }

  // Input de nuevos kilos - validación en tiempo real
  const inputNuevosKilos = document.getElementById('nuevos-kilos');
  if (inputNuevosKilos) {
    inputNuevosKilos.addEventListener('input', validarAjuste);
  }

}

/**
 * Abre el modal de ajuste rápido
 * @param {number} ingredienteId - ID del ingrediente
 * @param {string} nombreIngrediente - Nombre del ingrediente
 * @param {number} stockActual - Stock actual del sistema
 * @param {number} carroId - ID del carro activo
 */
export function abrirModalAjusteRapido(ingredienteId, nombreIngrediente, stockActual, carroId) {

  if (!modalAjuste) {
    inicializarModalAjuste();
  }

  // 🔧 FIX: Resetear estado del botón de confirmación
  const btnConfirmar = document.getElementById('btn-confirmar-ajuste');
  if (btnConfirmar) {
    btnConfirmar.disabled = false;
    btnConfirmar.textContent = 'Confirmar Ajuste';
  }

  // Guardar datos actuales
  ingredienteIdActual = ingredienteId;
  stockSistemaActual = parseFloat(stockActual);
  carroIdActual = carroId;
  nombreIngredienteActual = nombreIngrediente;

  // Actualizar información en el modal
  const nombreDisplay = document.getElementById('nombre-ingrediente-ajuste');
  const kilosActualesInput = document.getElementById('kilos-actuales');
  const nuevosKilosInput = document.getElementById('nuevos-kilos');
  const motivoTextarea = document.getElementById('motivo-ajuste');

  if (nombreDisplay) nombreDisplay.textContent = nombreIngrediente;
  if (kilosActualesInput) kilosActualesInput.value = stockActual.toFixed(2);
  if (nuevosKilosInput) {
    nuevosKilosInput.value = '';
    nuevosKilosInput.focus();
  }
  if (motivoTextarea) motivoTextarea.value = '';

  // Ocultar sector (no es relevante para este contexto)
  const sectorDisplay = document.getElementById('sector-ingrediente-ajuste');
  if (sectorDisplay) {
    sectorDisplay.closest('.ingrediente-info').querySelector('p').style.display = 'none';
  }

  // Mostrar modal
  modalAjuste.style.display = 'block';
  setTimeout(() => {
    modalAjuste.classList.add('show');
  }, 10);

}

/**
 * Cierra el modal de ajuste rápido
 */
function cerrarModalAjuste() {

  if (!modalAjuste) return;

  modalAjuste.classList.remove('show');
  setTimeout(() => {
    modalAjuste.style.display = 'none';

    // Limpiar datos
    ingredienteIdActual = null;
    stockSistemaActual = null;
    carroIdActual = null;
    nombreIngredienteActual = null;

    // 🔧 LIMPIAR CONTEXTO: Remover data-attributes para evitar contaminación entre pantallas
    if (modalAjuste.dataset.usuarioActivo) {
      delete modalAjuste.dataset.usuarioActivo;
    }
    if (modalAjuste.dataset.origenContexto) {
      delete modalAjuste.dataset.origenContexto;
    }

    // Limpiar campos
    const nuevosKilosInput = document.getElementById('nuevos-kilos');
    const motivoTextarea = document.getElementById('motivo-ajuste');
    if (nuevosKilosInput) nuevosKilosInput.value = '';
    if (motivoTextarea) motivoTextarea.value = '';
  }, 300);

}

/**
 * Valida el ajuste en tiempo real
 */
function validarAjuste() {
  const inputNuevosKilos = document.getElementById('nuevos-kilos');
  const btnConfirmar = document.getElementById('btn-confirmar-ajuste');

  if (!inputNuevosKilos || !btnConfirmar) return;

  const stockReal = parseFloat(inputNuevosKilos.value);

  if (isNaN(stockReal) || stockReal < 0) {
    btnConfirmar.disabled = true;
    return;
  }

  btnConfirmar.disabled = false;
}

/**
 * Confirma y procesa el ajuste de stock
 */
async function confirmarAjuste() {
  try {
    const inputNuevosKilos = document.getElementById('nuevos-kilos');
    const motivoTextarea = document.getElementById('motivo-ajuste');
    const btnConfirmar = document.getElementById('btn-confirmar-ajuste');

    if (!inputNuevosKilos) {
      throw new Error('No se encontró el input de nuevos kilos');
    }

    // ------------------------------------------------------------------
    // 🛠️ CORRECCIÓN 1: Evitar el error de la coma en los decimales
    // Reemplazamos la coma por un punto antes de hacer el parseFloat
    // ------------------------------------------------------------------
    const valorLimpio = inputNuevosKilos.value.trim().replace(',', '.');
    const stockReal = parseFloat(valorLimpio);

    if (isNaN(stockReal) || stockReal < 0) {
      alert('❌ Ingrese un valor válido para el stock real');
      return;
    }

    // ------------------------------------------------------------------
    // 🛠️ CORRECCIÓN 2: Solucionar el problema de decimales de JS
    // Redondeamos la diferencia a 3 decimales exactos (gramos)
    // ------------------------------------------------------------------
    let diferencia = stockReal - stockSistemaActual;
    diferencia = Math.round(diferencia * 1000) / 1000;

    // ------------------------------------------------------------------
    // 🛠️ CORRECCIÓN 3: Mejorar la sensibilidad a 1 gramo (0.001)
    // ------------------------------------------------------------------
    if (Math.abs(diferencia) < 0.001) {
      alert('ℹ️ El stock real coincide con el stock del sistema. No se requiere ajuste.');
      cerrarModalAjuste();
      return;
    }

    // Deshabilitar botón durante procesamiento
    if (btnConfirmar) {
      btnConfirmar.disabled = true;
      btnConfirmar.textContent = 'Procesando...';
    }

    // 🎯 DETECCIÓN DE CONTEXTO MEJORADA: Determinar si es carro externo O vista de usuario
    let esStockUsuario = false;
    let usuarioId = null;
    let origenContexto = 'desconocido';

    // 🔧 PRIORIDAD 1: Verificar atributo data-usuario-activo en el modal (más confiable)
    const modalAjuste = document.getElementById('modalAjusteKilos');
    if (modalAjuste && modalAjuste.dataset.usuarioActivo) {
      usuarioId = parseInt(modalAjuste.dataset.usuarioActivo);
      if (!isNaN(usuarioId) && usuarioId > 0) {
        esStockUsuario = true;
        origenContexto = modalAjuste.dataset.origenContexto || 'vista_stock_personal';
      }
    }

    // 🔧 PRIORIDAD 2: Verificar selector filtro-usuario (fallback para compatibilidad)
    if (!esStockUsuario) {
      const selectorUsuario = document.getElementById('filtro-usuario');
      if (selectorUsuario && selectorUsuario.value) {
        const valorSelector = selectorUsuario.value.trim();
        if (valorSelector !== '' && valorSelector !== 'todos') {
          usuarioId = parseInt(valorSelector);
          if (!isNaN(usuarioId) && usuarioId > 0) {
            esStockUsuario = true;
            origenContexto = 'vista_stock_personal';
          }
        }
      }
    }

    // OPCIÓN 3: Detectar si estamos en un carro externo (solo si no se detectó usuario antes)
    if (!esStockUsuario && typeof carroIdActual !== 'undefined' && carroIdActual) {
      try {
        const carroResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroIdActual}/estado`);
        if (carroResponse.ok) {
          const carroData = await carroResponse.json();
          const tipoCarro = carroData.tipo_carro || 'interna';
          esStockUsuario = (tipoCarro === 'externa');
          if (esStockUsuario) {
            // Obtener usuario_id del carro
            const colaboradorData = localStorage.getItem('colaboradorActivo');
            if (colaboradorData) {
              const colaborador = JSON.parse(colaboradorData);
              usuarioId = colaborador.id;
              origenContexto = 'carro_externo';
            }
          }
        }
      } catch (error) {
        console.warn('⚠️ [CONTEXTO] No se pudo determinar tipo de carro');
      }
    }

    // Determinar tipo de movimiento
    const tipoMovimiento = diferencia > 0 ? 'ingreso' : 'egreso';
    const kilosMovimiento = Math.abs(diferencia);

    // Preparar observaciones
    const motivoUsuario = motivoTextarea?.value.trim() || '';
    const observaciones = motivoUsuario
      ? `Ajuste rápido - Stock real: ${stockReal} kg - Motivo: ${motivoUsuario}`
      : `Ajuste rápido - Stock real: ${stockReal} kg`;

    // 3. Preparación de la petición al backend (Payload)
    const payload = {
      ingrediente_id: typeof ingredienteIdActual !== 'undefined' ? ingredienteIdActual : null,
      stock_real: stockReal,
      carro_id: (typeof carroIdActual !== 'undefined' && carroIdActual) ? carroIdActual : null,
      observaciones: observaciones,
      es_stock_usuario: esStockUsuario,
      usuario_id: usuarioId,
      origen_contexto: origenContexto
    };

    // Registrar movimiento en el backend
    const response = await fetch('http://localhost:3002/api/produccion/ingredientes/ajuste-rapido', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error al procesar el ajuste');
    }

    const resultado = await response.json();

    // Mostrar confirmación contextual
    let contextoMensaje = '';
    if (esStockUsuario) {
      contextoMensaje = origenContexto === 'vista_stock_personal'
        ? ' (Stock Personal - Ajuste Manual)'
        : ' (Stock Personal - Carro Externo)';
    } else {
      contextoMensaje = ' (Stock General)';
    }

    // ------------------------------------------------------------------
    // 🛠️ CORRECCIÓN 4: Mostrar los números con 3 decimales (gramos) en la alerta
    // ------------------------------------------------------------------
    const mensaje = diferencia > 0
      ? `✅ Stock ajustado${contextoMensaje}: +${kilosMovimiento.toFixed(3)} kg agregados\nNuevo stock: ${stockReal.toFixed(3)} kg`
      : `✅ Stock ajustado${contextoMensaje}: -${kilosMovimiento.toFixed(3)} kg descontados\nNuevo stock: ${stockReal.toFixed(3)} kg`;
    alert(mensaje);

    // Cerrar modal
    if (typeof cerrarModalAjuste === 'function') {
      cerrarModalAjuste();
    }

    // 🔄 ACTUALIZAR TABLA: Recargar datos después del ajuste
    if (typeof window.actualizarResumenIngredientes === 'function') {
      await window.actualizarResumenIngredientes();
    }

    // Fallback: recargar vista de usuario si estamos en esa vista
    if (typeof window.cargarIngredientes === 'function') {
      const vistaActual = window.vistaActual || 'deposito';
      if (vistaActual.startsWith('usuario-')) {
        const usuarioIdVista = parseInt(vistaActual.replace('usuario-', ''));
        await window.cargarIngredientes(usuarioIdVista);
      }
    }

  } catch (error) {
    console.error('❌ [AJUSTE] Error al procesar ajuste:', error);
    alert(`❌ Error al procesar el ajuste: ${error.message}`);
    // Restaurar botón
    const btnConfirmar = document.getElementById('btn-confirmar-ajuste');
    if (btnConfirmar) {
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar Ajuste';
    }
  }
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarModalAjuste);
} else {
  inicializarModalAjuste();
}

// Exportar función para uso global
window.abrirModalAjusteRapido = abrirModalAjusteRapido;
