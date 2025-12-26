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
  console.log('🔧 [AJUSTE] Inicializando modal de ajuste rápido...');
  
  modalAjuste = document.getElementById('modalAjusteKilos');
  
  if (!modalAjuste) {
    console.error('❌ [AJUSTE] Modal no encontrado');
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

  console.log('✅ [AJUSTE] Modal inicializado correctamente');
}

/**
 * Abre el modal de ajuste rápido
 * @param {number} ingredienteId - ID del ingrediente
 * @param {string} nombreIngrediente - Nombre del ingrediente
 * @param {number} stockActual - Stock actual del sistema
 * @param {number} carroId - ID del carro activo
 */
export function abrirModalAjusteRapido(ingredienteId, nombreIngrediente, stockActual, carroId) {
  console.log('🔧 [AJUSTE] Abriendo modal de ajuste rápido...');
  console.log(`   - Ingrediente: ${nombreIngrediente} (ID: ${ingredienteId})`);
  console.log(`   - Stock actual: ${stockActual}`);
  console.log(`   - Carro ID: ${carroId}`);

  if (!modalAjuste) {
    inicializarModalAjuste();
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

  console.log('✅ [AJUSTE] Modal abierto correctamente');
}

/**
 * Cierra el modal de ajuste rápido
 */
function cerrarModalAjuste() {
  console.log('🔧 [AJUSTE] Cerrando modal...');
  
  if (!modalAjuste) return;

  modalAjuste.classList.remove('show');
  setTimeout(() => {
    modalAjuste.style.display = 'none';
    
    // Limpiar datos
    ingredienteIdActual = null;
    stockSistemaActual = null;
    carroIdActual = null;
    nombreIngredienteActual = null;
    
    // Limpiar campos
    const nuevosKilosInput = document.getElementById('nuevos-kilos');
    const motivoTextarea = document.getElementById('motivo-ajuste');
    if (nuevosKilosInput) nuevosKilosInput.value = '';
    if (motivoTextarea) motivoTextarea.value = '';
  }, 300);

  console.log('✅ [AJUSTE] Modal cerrado');
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
    console.log('\n🔧 [AJUSTE] Procesando ajuste de stock...');
    console.log('================================================================');

    const inputNuevosKilos = document.getElementById('nuevos-kilos');
    const motivoTextarea = document.getElementById('motivo-ajuste');
    const btnConfirmar = document.getElementById('btn-confirmar-ajuste');

    if (!inputNuevosKilos) {
      throw new Error('No se encontró el input de nuevos kilos');
    }

    const stockReal = parseFloat(inputNuevosKilos.value);
    
    if (isNaN(stockReal) || stockReal < 0) {
      alert('❌ Ingrese un valor válido para el stock real');
      return;
    }

    // Calcular diferencia
    const diferencia = stockReal - stockSistemaActual;
    
    console.log(`📊 [AJUSTE] Cálculo de diferencia:`);
    console.log(`   - Stock Sistema: ${stockSistemaActual} kg`);
    console.log(`   - Stock Real: ${stockReal} kg`);
    console.log(`   - Diferencia: ${diferencia} kg`);

    // Si no hay diferencia, no hacer nada
    if (Math.abs(diferencia) < 0.01) {
      alert('ℹ️ El stock real coincide con el stock del sistema. No se requiere ajuste.');
      cerrarModalAjuste();
      return;
    }

    // Deshabilitar botón durante procesamiento
    if (btnConfirmar) {
      btnConfirmar.disabled = true;
      btnConfirmar.textContent = 'Procesando...';
    }

    // 🎯 DETECCIÓN DE CONTEXTO: Determinar si es carro externo
    let esStockUsuario = false;
    let usuarioId = null;
    
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
          }
        }
        
        console.log(`🎯 [CONTEXTO] Tipo de carro: ${tipoCarro}`);
        console.log(`🎯 [CONTEXTO] Es stock de usuario: ${esStockUsuario}`);
        console.log(`🎯 [CONTEXTO] Usuario ID: ${usuarioId || 'N/A'}`);
      }
    } catch (error) {
      console.warn('⚠️ [CONTEXTO] No se pudo determinar tipo de carro, usando stock general');
    }

    // Determinar tipo de movimiento
    const tipoMovimiento = diferencia > 0 ? 'ingreso' : 'egreso';
    const kilosMovimiento = Math.abs(diferencia);

    // Preparar observaciones
    const motivoUsuario = motivoTextarea?.value.trim() || '';
    const observaciones = motivoUsuario 
      ? `Ajuste rápido - Stock real: ${stockReal} kg - Motivo: ${motivoUsuario}`
      : `Ajuste rápido - Stock real: ${stockReal} kg`;

    console.log(`📝 [AJUSTE] Registrando movimiento:`);
    console.log(`   - Tipo: ${tipoMovimiento}`);
    console.log(`   - Kilos: ${kilosMovimiento}`);
    console.log(`   - Es stock usuario: ${esStockUsuario}`);
    console.log(`   - Observaciones: ${observaciones}`);

    // 🎯 PAYLOAD CONTEXTUAL: Incluir información de contexto
    const payload = {
      ingrediente_id: ingredienteIdActual,
      stock_real: stockReal,
      carro_id: carroIdActual,
      observaciones: observaciones,
      es_stock_usuario: esStockUsuario,  // 🆕 Indicador de contexto
      usuario_id: usuarioId               // 🆕 ID del usuario (solo para externos)
    };

    console.log(`📤 [AJUSTE] Payload enviado:`, payload);

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
    
    console.log('✅ [AJUSTE] Ajuste procesado exitosamente:', resultado);
    console.log('================================================================\n');

    // Mostrar confirmación contextual
    const contextoMensaje = esStockUsuario ? ' (Stock Personal)' : ' (Stock General)';
    const mensaje = diferencia > 0 
      ? `✅ Stock ajustado${contextoMensaje}: +${kilosMovimiento.toFixed(2)} kg agregados\nNuevo stock: ${stockReal.toFixed(2)} kg`
      : `✅ Stock ajustado${contextoMensaje}: -${kilosMovimiento.toFixed(2)} kg descontados\nNuevo stock: ${stockReal.toFixed(2)} kg`;
    
    alert(mensaje);

    // Cerrar modal
    cerrarModalAjuste();

    // Actualizar resumen de ingredientes
    await actualizarResumenIngredientes();

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
