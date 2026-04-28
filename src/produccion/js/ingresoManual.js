import {
  registrarMovimientoIngrediente,
  registrarMovimientoStockVentas
} from './apiMovimientos.js';

import { actualizarResumenIngredientes, obtenerResumenIngredientesCarro } from './carro.js';

// Función cliente para solicitar impresión de etiqueta
async function imprimirEtiquetaIngrediente(ingredienteId, nombre, cantidad, codigo, sector) {
  console.log(`🖨️ [CLIENTE] Solicitando impresión de etiqueta: ${nombre}, ${cantidad}kg`);
  try {
    const response = await fetch('/api/produccion/ingredientes/imprimir-etiqueta', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ingredienteId,
        nombre,
        cantidad,
        codigo,
        sector
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Error al imprimir etiqueta');
    }

    const data = await response.json();
    console.log('✅ [CLIENTE] Impresión solicitada correctamente:', data);
    return data;
  } catch (error) {
    console.error('❌ [CLIENTE] Error al solicitar impresión:', error);
    throw error;
  }
}

// Función para verificar si un ingrediente es compuesto (mix)
async function verificarSiEsIngredienteCompuesto(ingredienteId) {
  try {
    const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteId}/es-compuesto`);
    if (!response.ok) {
      throw new Error('Error al verificar el tipo de ingrediente');
    }
    const data = await response.json();
    return data.esCompuesto;
  } catch (error) {
    console.error('❌ Error al verificar si es ingrediente compuesto:', error);
    throw error;
  }
}

// Función para obtener la composición de un ingrediente
async function obtenerComposicionIngrediente(ingredienteId) {
  try {
    const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteId}/composicion`);
    if (!response.ok) {
      throw new Error('Error al obtener la composición del ingrediente');
    }
    const data = await response.json();
    // Retornar el objeto completo que incluye mix (con receta_base_kg) y composicion
    return data;
  } catch (error) {
    console.error('❌ Error al obtener composición del ingrediente:', error);
    throw error;
  }
}

// 🛡️ VARIABLES GLOBALES CON INICIALIZACIÓN SEGURA
let modal = null;
let inputBusqueda = null;
let listaResultados = null;
let inputKilos = null;
let inputCantidad = null;
let btnConfirmar = null;
let btnCancelar = null;
let nombreIngredienteDisplay = null;
let btnEditarKilos = null;
let btnToggleBusqueda = null;

let modoBusqueda = 'barras'; // 'barras' o 'texto'
let ingredienteSeleccionado = null;
let articuloSeleccionado = null;
let carroIdGlobal = null;

// 🆕 Variable para almacenar el valor original de kilos_unidad
let kilosUnidadOriginal = null;

// 🔒 Variables para controlar el estado del botón y prevenir clics múltiples
let procesamientoEnCurso = false;
let textoOriginalBoton = 'Confirmar';
let estadoOriginalBoton = {
  disabled: false,
  className: '',
  innerHTML: ''
};

// 🛡️ Flag para controlar si el modal está inicializado
let isModalInitialized = false;

export function abrirModalIngresoManual(ingredienteId, carroId, esMix = false) {
  ingredienteSeleccionado = ingredienteId;
  carroIdGlobal = carroId;

  if (!modal) inicializarModal();
  limpiarCamposModal();

  // Forzar modo 'barras' al abrir
  modoBusqueda = 'barras';
  actualizarModoBusquedaUI();
  inputBusqueda.focus();


  obtenerIngrediente(ingredienteId)
    .then(ingrediente => {
      if (nombreIngredienteDisplay) {
        nombreIngredienteDisplay.textContent = `${esMix ? '🧪 ' : ''}${ingrediente.nombre || 'Ingrediente sin nombre'}`;
      }
      // Actualizar el título del modal según el tipo
      const modalTitle = modal.querySelector('.modal-title');
      if (modalTitle) {
        modalTitle.textContent = esMix ? 'Ingreso Manual de Mix' : 'Ingreso Manual de Ingrediente';
      }

      // 🆕 Cargar artículos sugeridos basados en el nombre del ingrediente
      cargarArticulosSugeridos(ingrediente.nombre);
    })
    .catch(err => {
      console.error('❌ Error al obtener ingrediente:', err);
      if (nombreIngredienteDisplay) {
        nombreIngredienteDisplay.textContent = 'Error al cargar ingrediente';
      }
    });

  modal.classList.add('show');
  inputBusqueda.focus();
}

// 🛡️ FUNCIÓN DE INICIALIZACIÓN CON PROGRAMACIÓN DEFENSIVA
function inicializarModal() {
  // Prevenir inicialización múltiple
  if (isModalInitialized) {
    return;
  }

  try {
    // 🛡️ PASO 1: Obtener referencias a elementos del DOM con validación
    modal = document.getElementById('modalIngresoManual');
    if (!modal) {
      return; // Salir silenciosamente si el modal no existe
    }

    // Buscar elementos dentro del modal
    inputBusqueda = document.getElementById('busquedaArticulo');
    btnToggleBusqueda = document.getElementById('btnToggleBusqueda');

    // ✅ NUEVO: Checkbox de impresión automática (Layout Horizontal Flex)
    const checkboxImprimir = document.getElementById('checkImprimirEtiqueta');
    if (!checkboxImprimir) {
      const footerModal = modal.querySelector('.modal-footer');
      if (footerModal) {
        // 1. Configurar Footer para Alineación Horizontal Perfecta
        footerModal.style.display = 'flex';
        footerModal.style.flexDirection = 'row';
        footerModal.style.justifyContent = 'space-between';
        footerModal.style.alignItems = 'center';
        footerModal.style.padding = '8px 20px'; // Compacto
        footerModal.style.minHeight = '60px';

        // 2. Inyectar contenedor de opciones (Izquierda)
        const divCheck = document.createElement('div');
        divCheck.className = 'd-flex align-items-center';
        divCheck.innerHTML = `
            <style>
              .impresion-group { display: flex; align-items: center; gap: 20px; }
              .impresion-option { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
              .impresion-option input { width: 18px; height: 18px; margin: 0; cursor: pointer; accent-color: #0d6efd; }
              .impresion-option label { margin: 0; font-size: 0.9rem; font-weight: 500; color: #495057; cursor: pointer; }
              
              /* Estilos forzados para botón */
              #btnConfirmarIngreso { 
                  margin: 0 !important; 
                  height: 38px !important;
                  padding: 0 25px !important;
                  font-size: 1rem !important;
                  display: flex; align-items: center; justify-content: center;
              }
              #btnCancelarIngreso { display: none !important; } /* Ocultar cancelar */
              .botones-modal { margin: 0 !important; padding: 0 !important; }
            </style>
            <div class="impresion-group">
                <div class="impresion-option" onclick="document.getElementById('checkImprimirEtiqueta').click()">
                    <input class="form-check-input" type="checkbox" id="checkImprimirEtiqueta" checked onclick="event.stopPropagation()">
                    <label for="checkImprimirEtiqueta">📦 Bultos</label>
                </div>
                <div class="impresion-option" onclick="document.getElementById('checkImprimirPorKilos').click()">
                    <input class="form-check-input" type="checkbox" id="checkImprimirPorKilos" onclick="event.stopPropagation()">
                    <label for="checkImprimirPorKilos">⚖️ Kilos</label>
                </div>
            </div>
        `;

        // 3. Insertar al inicio del footer
        if (footerModal.firstChild) {
          footerModal.insertBefore(divCheck, footerModal.firstChild);
        } else {
          footerModal.appendChild(divCheck);
        }

        // 4. Lógica de Exclusividad Mutua (Radio Behavior)
        const checkBultos = document.getElementById('checkImprimirEtiqueta');
        const checkKilos = document.getElementById('checkImprimirPorKilos');

        if (checkBultos && checkKilos) {
          checkBultos.addEventListener('change', function () {
            if (this.checked) {
              checkKilos.checked = false;
            }
          });

          checkKilos.addEventListener('change', function () {
            if (this.checked) {
              checkBultos.checked = false;
            }
          });
        }
      }
    }

    listaResultados = document.getElementById('listaArticulos');
    inputKilos = document.getElementById('inputKilos');
    inputCantidad = document.getElementById('inputCantidad');
    btnConfirmar = document.getElementById('btnConfirmarIngreso');
    btnCancelar = document.getElementById('btnCancelarIngreso');
    nombreIngredienteDisplay = modal.querySelector('.nombre-ingrediente');

    // 🛡️ PASO 2: Crear botón editar kilos (solo si inputKilos existe)
    if (inputKilos) {
      crearBotonEditarKilos();
    }

    // 🛡️ PASO 3: Asignar event listeners con validación
    if (inputBusqueda) {
      inputBusqueda.addEventListener('input', manejarBusqueda);
      inputBusqueda.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (modoBusqueda === 'barras') {
            manejarBusqueda();
          }
        }
      });
    }

    if (btnToggleBusqueda) {
      btnToggleBusqueda.addEventListener('click', toggleModoBusqueda);
    }

    if (btnConfirmar) {
      btnConfirmar.addEventListener('click', confirmarIngreso);
    }

    // Agregar listener al botón X de cierre en el header
    const btnCloseHeader = modal.querySelector('.modal-header .close-modal');
    if (btnCloseHeader) {
      btnCloseHeader.addEventListener('click', cerrarModal);
    }

    // ✅ NUEVO: Hacer el modal DRAGGABLE desde el header
    hacerModalDraggable();

    // 🛡️ PASO 4: Marcar como inicializado
    isModalInitialized = true;

  } catch (error) {
    console.error('❌ [INIT] Error crítico durante la inicialización del modal:', error);
  }
}

// 🛡️ INICIALIZACIÓN SEGURA CON MÚLTIPLES ESTRATEGIAS
// Estrategia 1: DOMContentLoaded (preferida)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    inicializarModal();
  });
} else {
  // Estrategia 2: DOM ya cargado, inicializar inmediatamente
  inicializarModal();
}

// 🛡️ FUNCIÓN TOGGLE CON VALIDACIÓN
function toggleModoBusqueda() {
  try {
    modoBusqueda = modoBusqueda === 'barras' ? 'texto' : 'barras';
    actualizarModoBusquedaUI();
  } catch (error) {
    console.error('❌ Error en toggleModoBusqueda:', error);
  }
}

// 🛡️ FUNCIÓN ACTUALIZAR UI CON VALIDACIÓN
function actualizarModoBusquedaUI() {
  try {
    if (!btnToggleBusqueda || !inputBusqueda || !listaResultados) {
      console.warn('⚠️ No se pueden actualizar elementos del modo de búsqueda (elementos no disponibles)');
      return;
    }

    if (modoBusqueda === 'barras') {
      btnToggleBusqueda.textContent = '🔍 Buscar por Nombre';
      inputBusqueda.placeholder = 'Escanear código de barras...';
    } else {
      btnToggleBusqueda.textContent = '🔫 Modo Lector';
      inputBusqueda.placeholder = 'Escribir nombre del artículo...';
    }

    inputBusqueda.value = '';
    listaResultados.innerHTML = '';
    inputBusqueda.focus();
  } catch (error) {
    console.error('❌ Error en actualizarModoBusquedaUI:', error);
  }
}

// 🛡️ FUNCIÓN LIMPIAR CAMPOS CON VALIDACIÓN
function limpiarCamposModal() {
  try {
    if (inputBusqueda) inputBusqueda.value = '';
    if (inputKilos) inputKilos.value = '';
    if (inputCantidad) inputCantidad.value = '1';
    if (listaResultados) listaResultados.innerHTML = '';
    if (nombreIngredienteDisplay) nombreIngredienteDisplay.textContent = '';

    articuloSeleccionado = null;
    kilosUnidadOriginal = null;

    // Resetear el estado del campo kilos y botón editar
    resetearEstadoCampoKilos();

    // Resetear el estado del botón
    reactivarBotonConfirmar();
  } catch (error) {
    console.error('❌ Error en limpiarCamposModal:', error);
  }
}

// 🆕 Función para crear el botón "Editar" junto al campo kilos
function crearBotonEditarKilos() {
  try {
    console.log('🔧 [BOTÓN_EDITAR] Creando botón "Editar" para campo kilos...');

    // Verificar si el botón ya existe
    if (btnEditarKilos) {
      console.log('ℹ️ [BOTÓN_EDITAR] Botón ya existe, no se crea duplicado');
      return;
    }

    // Buscar el contenedor del input kilos
    const inputKilosContainer = inputKilos.parentElement;
    if (!inputKilosContainer) {
      console.warn('⚠️ [BOTÓN_EDITAR] No se encontró el contenedor del input kilos');
      return;
    }

    // Crear el botón "Editar"
    btnEditarKilos = document.createElement('button');
    btnEditarKilos.type = 'button';
    btnEditarKilos.className = 'btn-editar-kilos';
    btnEditarKilos.innerHTML = '✎ Editar';
    btnEditarKilos.title = 'Habilitar edición manual del campo kilos';

    // Estilos inline para el botón (discreto pero visible)
    btnEditarKilos.style.marginLeft = '8px';
    btnEditarKilos.style.padding = '4px 8px';
    btnEditarKilos.style.fontSize = '12px';
    btnEditarKilos.style.backgroundColor = '#f8f9fa';
    btnEditarKilos.style.border = '1px solid #dee2e6';
    btnEditarKilos.style.borderRadius = '4px';
    btnEditarKilos.style.cursor = 'pointer';
    btnEditarKilos.style.color = '#6c757d';

    // Event listener para el botón
    btnEditarKilos.addEventListener('click', habilitarEdicionKilos);

    // Insertar el botón después del input kilos
    inputKilosContainer.appendChild(btnEditarKilos);

    console.log('✅ [BOTÓN_EDITAR] Botón "Editar" creado correctamente');

  } catch (error) {
    console.error('❌ [BOTÓN_EDITAR] Error al crear botón "Editar":', error);
  }
}

// 🆕 Función para habilitar la edición del campo kilos
function habilitarEdicionKilos() {
  try {
    console.log('✎ [EDICIÓN_KILOS] Habilitando edición manual del campo kilos...');

    // Habilitar el input
    inputKilos.disabled = false;
    inputKilos.style.backgroundColor = '';
    inputKilos.style.color = '';
    inputKilos.style.cursor = '';

    // Ocultar el botón "Editar"
    if (btnEditarKilos) {
      btnEditarKilos.style.display = 'none';
    }

    // Enfocar el input para facilitar la edición
    inputKilos.focus();
    inputKilos.select();

    console.log('✅ [EDICIÓN_KILOS] Campo kilos habilitado para edición manual');

  } catch (error) {
    console.error('❌ [EDICIÓN_KILOS] Error al habilitar edición:', error);
  }
}

// 🆕 Función para configurar el campo kilos según el valor de kilos_unidad
function configurarCampoKilos(kilosUnidad) {
  try {
    console.log('⚙️ [CONFIG_KILOS] Configurando campo kilos:', {
      kilosUnidad: kilosUnidad,
      esNuloOCero: kilosUnidad === null || kilosUnidad === 0
    });

    if (kilosUnidad === null || kilosUnidad === 0) {
      // Caso: valor nulo o cero - mostrar "No está configurado"
      inputKilos.value = 'No está configurado';
      inputKilos.disabled = true;
      inputKilos.style.backgroundColor = '#f8f9fa';
      inputKilos.style.color = '#6c757d';
      inputKilos.style.cursor = 'not-allowed';

      // Mostrar botón "Editar"
      if (btnEditarKilos) {
        btnEditarKilos.style.display = 'inline-block';
        btnEditarKilos.innerHTML = '✎ Editar';
      }

      console.log('📝 [CONFIG_KILOS] Campo configurado como "No está configurado"');

    } else {
      // Caso: valor existe - mostrar valor y deshabilitar
      inputKilos.value = kilosUnidad.toString();
      inputKilos.disabled = true;
      inputKilos.style.backgroundColor = '#f8f9fa';
      inputKilos.style.color = '#495057';
      inputKilos.style.cursor = 'not-allowed';

      // Mostrar botón "Editar"
      if (btnEditarKilos) {
        btnEditarKilos.style.display = 'inline-block';
        btnEditarKilos.innerHTML = '✎ Editar';
      }

      console.log('📝 [CONFIG_KILOS] Campo configurado con valor:', kilosUnidad);
    }

  } catch (error) {
    console.error('❌ [CONFIG_KILOS] Error al configurar campo kilos:', error);
  }
}

// 🆕 Función para resetear el estado del campo kilos
function resetearEstadoCampoKilos() {
  try {
    console.log('🔄 [RESET_KILOS] Reseteando estado del campo kilos...');

    // Resetear input kilos
    inputKilos.value = '';
    inputKilos.disabled = false;
    inputKilos.style.backgroundColor = '';
    inputKilos.style.color = '';
    inputKilos.style.cursor = '';

    // Ocultar botón "Editar"
    if (btnEditarKilos) {
      btnEditarKilos.style.display = 'none';
    }

    console.log('✅ [RESET_KILOS] Estado del campo kilos reseteado');

  } catch (error) {
    console.error('❌ [RESET_KILOS] Error al resetear estado:', error);
  }
}

// 🆕 Función para consultar kilos_unidad de un artículo
async function consultarKilosUnidad(articuloNumero) {
  try {
    console.log('🔍 [KILOS_UNIDAD] Consultando kilos_unidad para artículo:', articuloNumero);

    const response = await fetch(`http://localhost:3002/api/produccion/articulos`);
    if (!response.ok) {
      throw new Error('Error al consultar artículos');
    }

    const responseData = await response.json();
    // ✅ CORRECCIÓN: Manejar nuevo formato de respuesta { success, data, total }
    const articulos = responseData.data || responseData;
    const articulo = articulos.find(art => art.numero === articuloNumero);

    if (articulo && articulo.kilos_unidad !== null && articulo.kilos_unidad !== undefined) {
      console.log('✅ [KILOS_UNIDAD] Valor encontrado:', articulo.kilos_unidad);
      return parseFloat(articulo.kilos_unidad);
    } else {
      console.log('⚠️ [KILOS_UNIDAD] Valor no encontrado o es null, usando 0');
      return 0;
    }
  } catch (error) {
    console.error('❌ [KILOS_UNIDAD] Error al consultar kilos_unidad:', error);
    return 0; // Valor por defecto en caso de error
  }
}

// 🆕 Función para actualizar kilos_unidad si cambió
async function actualizarKilosUnidadSiCambio(articuloNumero, nuevoValor) {
  try {
    // Solo actualizar si el valor cambió
    if (kilosUnidadOriginal !== null && Math.abs(kilosUnidadOriginal - nuevoValor) < 0.001) {
      console.log('ℹ️ [KILOS_UNIDAD] Valor no cambió, no se actualiza');
      return;
    }

    console.log('🔄 [KILOS_UNIDAD] Actualizando valor:', {
      articuloNumero,
      valorOriginal: kilosUnidadOriginal,
      nuevoValor: nuevoValor
    });

    const response = await fetch(`http://localhost:3002/api/produccion/articulos/${articuloNumero}/kilos-unidad`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ kilos_unidad: nuevoValor })
    });

    if (!response.ok) {
      throw new Error('Error al actualizar kilos_unidad');
    }

    const result = await response.json();
    console.log('✅ [KILOS_UNIDAD] Actualizado correctamente:', result);

  } catch (error) {
    console.error('❌ [KILOS_UNIDAD] Error al actualizar:', error);
    // No lanzar error para no interrumpir el flujo principal
  }
}

// 🔒 Función para desactivar el botón "Confirmar" y prevenir clics múltiples
function desactivarBotonConfirmar() {
  if (!btnConfirmar) return;

  console.log('🔒 DESACTIVANDO BOTÓN CONFIRMAR - Previniendo clics múltiples');

  // Guardar el estado original del botón si no se ha guardado ya
  if (!estadoOriginalBoton.innerHTML) {
    estadoOriginalBoton.disabled = btnConfirmar.disabled;
    estadoOriginalBoton.className = btnConfirmar.className;
    estadoOriginalBoton.innerHTML = btnConfirmar.innerHTML;
    textoOriginalBoton = btnConfirmar.textContent || 'Confirmar';
  }

  // Desactivar el botón visual y funcionalmente
  btnConfirmar.disabled = true;
  btnConfirmar.style.opacity = '0.6';
  btnConfirmar.style.cursor = 'not-allowed';
  btnConfirmar.innerHTML = '⏳ Procesando...';

  // Marcar que el procesamiento está en curso
  procesamientoEnCurso = true;

  console.log('🔒 Botón desactivado correctamente:', {
    disabled: btnConfirmar.disabled,
    innerHTML: btnConfirmar.innerHTML,
    procesamientoEnCurso: procesamientoEnCurso
  });
}

// 🔓 Función para reactivar el botón "Confirmar" 
function reactivarBotonConfirmar() {
  if (!btnConfirmar) return;

  console.log('🔓 REACTIVANDO BOTÓN CONFIRMAR');

  // Restaurar el estado original del botón
  btnConfirmar.disabled = estadoOriginalBoton.disabled;
  btnConfirmar.className = estadoOriginalBoton.className;
  btnConfirmar.innerHTML = estadoOriginalBoton.innerHTML || textoOriginalBoton;
  btnConfirmar.style.opacity = '';
  btnConfirmar.style.cursor = '';

  // Marcar que el procesamiento ha terminado
  procesamientoEnCurso = false;

  console.log('🔓 Botón reactivado correctamente:', {
    disabled: btnConfirmar.disabled,
    innerHTML: btnConfirmar.innerHTML,
    procesamientoEnCurso: procesamientoEnCurso
  });
}

// 🛡️ FUNCIÓN CERRAR MODAL CON VALIDACIÓN
function cerrarModal() {
  try {
    if (modal) {
      modal.classList.remove('show');
    } else {
      console.warn('⚠️ No se puede cerrar el modal (elemento no disponible)');
    }
  } catch (error) {
    console.error('❌ Error en cerrarModal:', error);
  }
}

// 🚀 FUNCIÓN DE BÚSQUEDA MEJORADA - Lógica Multi-Criterio
function normalizar(texto) {
  if (!texto) return '';
  return texto
    .normalize("NFD") // Descompone caracteres acentuados en letra + acento
    .replace(/[\u0300-\u036f]/g, "") // Elimina los diacríticos (acentos)
    .toLowerCase(); // Convierte a minúsculas
}

// 🛡️ FUNCIÓN MANEJAR BÚSQUEDA CON VALIDACIÓN
function manejarBusqueda() {
  try {
    if (!inputBusqueda || !listaResultados) {
      console.warn('⚠️ No se puede realizar búsqueda (elementos no disponibles)');
      return;
    }

    const query = inputBusqueda.value.trim();

    if (modoBusqueda === 'texto' && query.length < 2) {
      listaResultados.innerHTML = '';
      return;
    }

    fetch('http://localhost:3002/api/produccion/articulos')
      .then(response => {
        if (!response.ok) throw new Error('Error al buscar artículos');
        return response.json();
      })
      .then(responseData => {
        // ✅ CORRECCIÓN: Manejar nuevo formato de respuesta { success, data, total }
        const data = responseData.data || responseData;
        let resultados;

        if (modoBusqueda === 'barras') {
          resultados = data.filter(art => art.codigo_barras === query);
        } else { // modo 'texto'
          const tokens = normalizar(query).split(' ').filter(t => t.length > 0);
          if (tokens.length === 0) {
            resultados = [];
          } else {
            resultados = data.filter(art => {
              const nombreNormalizado = normalizar(art.nombre);
              return tokens.every(token => nombreNormalizado.includes(token));
            });
          }
        }

        if (!listaResultados) return; // Validación adicional

        listaResultados.innerHTML = '';

        if (resultados.length === 0) {
          listaResultados.innerHTML = '<li>No se encontraron artículos</li>';
          return;
        }

        resultados.forEach(art => {
          const li = document.createElement('li');
          const stockDisplay = art.stock_consolidado !== undefined ? Number(art.stock_consolidado).toFixed(2) : '0.00';

          // 🆕 Mostrar nombre + stock en el resultado
          const stockClass = parseFloat(stockDisplay) > 0 ? 'stock-disponible' : 'stock-cero';
          const sectorDisplay = art.sector_letra ? ` [Sector ${art.sector_letra}]` : '';
          li.innerHTML = `
            <span class="articulo-nombre">${art.nombre}${sectorDisplay}</span>
            <span class="articulo-stock ${stockClass}">Stock: ${stockDisplay} kg</span>
          `;

          li.addEventListener('click', () => seleccionarArticulo(art));
          listaResultados.appendChild(li);
        });

        // Auto-selección si hay un solo resultado en modo 'barras' y la consulta no está vacía
        if (modoBusqueda === 'barras' && query.length > 0 && resultados.length === 1) {
          seleccionarArticulo(resultados[0]);
        }
      })
      .catch(error => {
        console.error('❌ Error al buscar artículos:', error);
        if (listaResultados) {
          listaResultados.innerHTML = '<li>Error al buscar artículos</li>';
        }
      });
  } catch (error) {
    console.error('❌ Error en manejarBusqueda:', error);
  }
}

async function seleccionarArticulo(art) {
  articuloSeleccionado = art;
  inputBusqueda.value = art.nombre;
  listaResultados.innerHTML = '';

  try {
    console.log('🔍 [ARTÍCULO_SELECCIONADO] Consultando kilos_unidad para:', art.numero);
    const kilosUnidad = await consultarKilosUnidad(art.numero);
    kilosUnidadOriginal = kilosUnidad;
    configurarCampoKilos(kilosUnidad);
    console.log('✅ [ARTÍCULO_SELECCIONADO] Campo kilos configurado:', {
      articuloNumero: art.numero,
      kilosUnidad: kilosUnidad,
      comportamiento: kilosUnidad === null || kilosUnidad === 0 ? 'No configurado' : 'Valor existente'
    });
  } catch (error) {
    console.error('❌ [ARTÍCULO_SELECCIONADO] Error al consultar kilos_unidad:', error);
    kilosUnidadOriginal = 0;
    configurarCampoKilos(0);
  }

  // 🆕 LOGICA DUAL DE ETIQUETAS "POR KILO"
  const checkBultos = document.getElementById('checkImprimirEtiqueta');
  const checkKilos = document.getElementById('checkImprimirPorKilos');

  if (checkBultos && checkKilos) {
    const descripcion = art.descripcion || '';
    const nombre = art.nombre || '';

    // Regla: Si dice "x kilo" o "por kilo" (insensitive) -> activar Kilos
    // Usuario especificó secuencia "X Kilo"
    const regexKilo = /(x|por)\s+kilo/i;

    const esPorKilo = regexKilo.test(descripcion) || regexKilo.test(nombre);

    if (esPorKilo) {
      console.log('⚖️ [ETIQUETAS] Detectado patró "X Kilo" -> Activando impresión por kilos');
      checkBultos.checked = false;
      checkKilos.checked = true;
    } else {
      // Default: Bultos activo
      console.log('📦 [ETIQUETAS] Artículo estándar -> Activando impresión por bultos');
      checkBultos.checked = true;
      checkKilos.checked = false;
    }
  }

  // 🆕 AUTO-FILL: Detectar patrón "x kilo" y sugerir stock disponible
  try {
    // Regex para detectar "x kilo" (case insensitive)
    const patronXKilo = /x\s+kilo/i;

    // Buscar el patrón en nombre o descripción
    const textoNombre = art.nombre || '';
    const textoDescripcion = art.descripcion || '';

    const tienePatronEnNombre = patronXKilo.test(textoNombre);
    const tienePatronEnDescripcion = patronXKilo.test(textoDescripcion);

    if (tienePatronEnNombre || tienePatronEnDescripcion) {
      // Patrón encontrado - auto-fill con stock disponible
      const stockDisponible = parseFloat(art.stock_consolidado) || 0;

      console.log('🎯 [AUTO-FILL] Patrón "x kilo" detectado:', {
        articuloNombre: art.nombre,
        articuloDescripcion: art.descripcion,
        encontradoEnNombre: tienePatronEnNombre,
        encontradoEnDescripcion: tienePatronEnDescripcion,
        stockDisponible: stockDisponible
      });

      if (stockDisponible > 0) {
        inputCantidad.value = stockDisponible;
        console.log(`✅ [AUTO-FILL] Campo "Cantidad" auto-completado con stock: ${stockDisponible}`);
      } else {
        inputCantidad.value = 1;
        console.log('⚠️ [AUTO-FILL] Stock es 0, manteniendo valor default: 1');
      }
    } else {
      // Patrón NO encontrado - mantener valor default
      inputCantidad.value = 1;
      console.log('ℹ️ [AUTO-FILL] Patrón "x kilo" NO detectado, valor default: 1');
    }
  } catch (error) {
    console.error('❌ [AUTO-FILL] Error al procesar auto-fill:', error);
    inputCantidad.value = 1; // Fallback seguro
  }
}

async function confirmarIngreso() {
  // 🔒 PROTECCIÓN CONTRA CLICS MÚLTIPLES - Verificar si ya hay un procesamiento en curso
  if (procesamientoEnCurso) {
    console.log('🔒 CLIC MÚLTIPLE BLOQUEADO - Ya hay un procesamiento en curso');
    console.log('🔒 Estado actual del botón:', {
      procesamientoEnCurso: procesamientoEnCurso,
      disabled: btnConfirmar ? btnConfirmar.disabled : 'N/A',
      innerHTML: btnConfirmar ? btnConfirmar.innerHTML : 'N/A'
    });
    return;
  }

  // Validaciones iniciales (antes de desactivar el botón)
  if (!articuloSeleccionado || !inputKilos.value) {
    alert('Seleccioná un artículo y completá los kilos.');
    return;
  }

  // 🆕 Validación mejorada para manejar el texto "No está configurado"
  if (inputKilos.value === 'No está configurado') {
    alert('Debe configurar los kilos antes de confirmar. Haga clic en "Editar" para ingresar un valor.');
    return;
  }

  const kilos = Number(inputKilos.value.replace(',', '.'));
  const cantidad = parseFloat(inputCantidad.value) || 1;

  if (isNaN(kilos) || kilos <= 0) {
    alert('Ingresá una cantidad válida de kilos.');
    return;
  }

  if (isNaN(cantidad) || cantidad < 1) {
    alert('La cantidad de artículos debe ser al menos 1.');
    return;
  }

  const usuarioData = localStorage.getItem('colaboradorActivo');
  const usuarioId = usuarioData ? JSON.parse(usuarioData).id : null;

  if (!carroIdGlobal || !usuarioId) {
    alert('No hay carro o usuario válido disponible.');
    return;
  }

  if (!articuloSeleccionado.numero) {
    alert('Error interno: no se seleccionó un artículo válido.');
    return;
  }

  // 🔒 DESACTIVAR BOTÓN INMEDIATAMENTE DESPUÉS DE LAS VALIDACIONES
  desactivarBotonConfirmar();

  console.log('🔍 Artículo seleccionado:', articuloSeleccionado);

  // Generar UUID Transaccional para anclar movimientos
  const transaccionUUID = crypto.randomUUID ? crypto.randomUUID() : 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);


  // Obtener el stock actual del ingrediente desde el resumen
  let stockAnteriorIngrediente = 0;
  try {
    const resumenIngredientes = await obtenerResumenIngredientesCarro(carroIdGlobal, usuarioId);
    const ingredienteEnResumen = resumenIngredientes.find(ing => ing.id === ingredienteSeleccionado);
    stockAnteriorIngrediente = ingredienteEnResumen ? ingredienteEnResumen.stock_actual : 0;
    console.log('🔍 DEBUG - Stock del ingrediente obtenido:', stockAnteriorIngrediente);
  } catch (error) {
    console.warn('⚠️ No se pudo obtener el stock del ingrediente, usando 0:', error);
  }

  try {
    // Obtener información del carro para determinar su tipo
    const carroResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroIdGlobal}/estado`);
    if (!carroResponse.ok) {
      throw new Error('Error al obtener información del carro');
    }
    const carroData = await carroResponse.json();
    const tipoCarro = carroData.tipo_carro;

    console.log(`🔍 Tipo de carro detectado: ${tipoCarro || 'interna'}`);

    const esCierreExterna = (tipoCarro === 'externa' && estadoCarro === 'preparado');

    // 🎯 TICKET #9B: Si es externa pero estamos en la etapa de cierre ('preparado' - Fase 3),
    // el stock sumado se debe inyectar EN FÁBRICA (ingredientes_movimientos), no en la camioneta,
    // garantizando la deducción de 'artículos' e inyección a 'ingredientes' vía Trigger DB.
    if (tipoCarro === 'externa' && !esCierreExterna) {
      // Verificar si el ingrediente es un mix (ingrediente compuesto)
      const esIngredienteCompuesto = await verificarSiEsIngredienteCompuesto(ingredienteSeleccionado);

      if (esIngredienteCompuesto) {
        console.log('🧪 Procesando ingrediente compuesto - descomponiendo en ingredientes simples');

        // Obtener la composición del ingrediente compuesto
        const data = await obtenerComposicionIngrediente(ingredienteSeleccionado);

        if (!data.mix || !data.mix.receta_base_kg) {
          throw new Error('El ingrediente compuesto no tiene definida la receta base');
        }

        if (!data.composicion || data.composicion.length === 0) {
          throw new Error('El ingrediente compuesto no tiene composición definida');
        }

        const totalKilos = kilos * cantidad;
        const recetaBaseKg = data.mix.receta_base_kg;
        console.log(`📊 Total de kilos a descomponer: ${totalKilos} (Receta base: ${recetaBaseKg}kg)`);

        // Registrar cada ingrediente simple por separado
        for (const componente of data.composicion) {
          // Calcular la proporción basada en la receta base
          const proporcion = componente.cantidad / recetaBaseKg;
          const cantidadIngredienteSimple = proporcion * totalKilos;

          console.log(`🔹 Ingrediente ${componente.ingrediente_id}:
            Cantidad en receta: ${componente.cantidad}kg
            Proporción: ${(proporcion * 100).toFixed(2)}%
            Cantidad final: ${cantidadIngredienteSimple}kg`);

          const stockUsuarioPayload = {
            usuario_id: parseInt(usuarioId),
            ingrediente_id: componente.ingrediente_id,
            cantidad: cantidadIngredienteSimple,
            origen_carro_id: parseInt(carroIdGlobal),
            origen_mix_id: ingredienteSeleccionado // El mix del que proviene este ingrediente
          };

          console.log('\n🔍 DEPURACIÓN DETALLADA - PAYLOAD COMPONENTE DE MIX:');
          console.log('=======================================================');
          console.log('📋 Payload completo que se enviará al backend:');
          console.log('- usuario_id:', stockUsuarioPayload.usuario_id, '(tipo:', typeof stockUsuarioPayload.usuario_id, ')');
          console.log('- ingrediente_id:', stockUsuarioPayload.ingrediente_id, '(tipo:', typeof stockUsuarioPayload.ingrediente_id, ')');
          console.log('- cantidad:', stockUsuarioPayload.cantidad, '(tipo:', typeof stockUsuarioPayload.cantidad, ')');
          console.log('- origen_carro_id:', stockUsuarioPayload.origen_carro_id, '(tipo:', typeof stockUsuarioPayload.origen_carro_id, ')');
          console.log('- origen_mix_id:', stockUsuarioPayload.origen_mix_id, '(tipo:', typeof stockUsuarioPayload.origen_mix_id, ')');
          console.log('📤 JSON que se enviará:', JSON.stringify(stockUsuarioPayload, null, 2));
          console.log('=======================================================\n');

          const stockResponse = await fetch('http://localhost:3002/api/produccion/ingredientes-stock-usuarios', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(stockUsuarioPayload)
          });

          if (!stockResponse.ok) {
            const errorData = await stockResponse.json();
            throw new Error(`Error al registrar ingrediente simple ${componente.ingrediente_id}: ${errorData.error || 'Error desconocido'}`);
          }
        }

        console.log('✅ Todos los ingredientes simples registrados correctamente');
      } else {
        // Ingrediente simple - verificar si proviene de un mix
        console.log('🔸 Procesando ingrediente simple');

        // Buscar si este ingrediente proviene de algún mix en el carro
        let origenMixId = null;
        try {
          const mixesResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroIdGlobal}/mixes?usuarioId=${usuarioId}`);
          if (mixesResponse.ok) {
            const mixes = await mixesResponse.json();

            // Por cada mix, verificar si contiene este ingrediente
            for (const mix of mixes) {
              const composicionResponse = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mix.id}/composicion`);
              if (composicionResponse.ok) {
                const composicionData = await composicionResponse.json();

                // Verificar si el ingrediente está en la composición de este mix
                const ingredienteEnMix = composicionData.composicion?.find(comp =>
                  comp.ingrediente_id === ingredienteSeleccionado
                );

                if (ingredienteEnMix) {
                  origenMixId = mix.id;
                  console.log(`🧪 Ingrediente ${ingredienteSeleccionado} proviene del mix ${mix.id} (${mix.nombre})`);
                  break;
                }
              }
            }
          }
        } catch (error) {
          console.warn('⚠️ No se pudo determinar el origen del mix:', error);
        }

        const stockUsuarioPayload = {
          usuario_id: parseInt(usuarioId),
          ingrediente_id: ingredienteSeleccionado,
          cantidad: kilos * cantidad,
          origen_carro_id: parseInt(carroIdGlobal),
          origen_mix_id: origenMixId // Incluir el origen_mix_id si se encontró
        };

        console.log('\n🔍 DEPURACIÓN DETALLADA - PAYLOAD INGREDIENTE SIMPLE:');
        console.log('=======================================================');
        console.log('📋 Payload completo que se enviará al backend:');
        console.log('- usuario_id:', stockUsuarioPayload.usuario_id, '(tipo:', typeof stockUsuarioPayload.usuario_id, ')');
        console.log('- ingrediente_id:', stockUsuarioPayload.ingrediente_id, '(tipo:', typeof stockUsuarioPayload.ingrediente_id, ')');
        console.log('- cantidad:', stockUsuarioPayload.cantidad, '(tipo:', typeof stockUsuarioPayload.cantidad, ')');
        console.log('- origen_carro_id:', stockUsuarioPayload.origen_carro_id, '(tipo:', typeof stockUsuarioPayload.origen_carro_id, ')');
        console.log('- origen_mix_id:', stockUsuarioPayload.origen_mix_id, '(tipo:', typeof stockUsuarioPayload.origen_mix_id, ')');
        console.log('📤 JSON que se enviará:', JSON.stringify(stockUsuarioPayload, null, 2));
        console.log('=======================================================\n');

        // Asignarlo a una variable global al bloque del if/else para enviarlo después
        window.tempStockUsuarioPayload = stockUsuarioPayload;
      }

      // Registrar el movimiento de stock de ventas para el artículo (siempre se hace)
      const movimientoStock = {
        articuloNumero: articuloSeleccionado.numero,
        codigoBarras: articuloSeleccionado.codigo_barras,
        kilos: -kilos,
        carroId: parseInt(carroIdGlobal),
        usuarioId: parseInt(usuarioId),
        cantidad: cantidad,
        tipo: 'ingreso a producción',
        origenIngreso: esIngredienteCompuesto ? 'mix' : 'simple',
        observaciones: `Ingreso manual [UUID: ${transaccionUUID}]`
      };

      // Guardarlo temporalmente
      window.tempMovimientoStock = movimientoStock;

    } else {
      console.log(`🏭 PROCESANDO INGRESO MANUAL EN CARRO ${esCierreExterna ? 'EXTERNO (FASE 3 - CIERRE)' : 'INTERNO'}`);

      // 🔧 CORRECCIÓN CRÍTICA: NO duplicar la multiplicación
      const movimientoIngrediente = {
        ingredienteId: ingredienteSeleccionado,
        articuloNumero: articuloSeleccionado.numero,
        kilos: kilos * cantidad, // Kilos totales para el ingrediente
        carroId: parseInt(carroIdGlobal),
        observaciones: `Ingreso manual [UUID: ${transaccionUUID}]`
      };

      const movimientoStock = {
        articuloNumero: articuloSeleccionado.numero,
        codigoBarras: articuloSeleccionado.codigo_barras,
        kilos: -(kilos * cantidad), // 🔧 CORRECCIÓN CRÍTICA: Kilos totales (multiplicar por cantidad)
        carroId: parseInt(carroIdGlobal),
        usuarioId: parseInt(usuarioId),
        cantidad: cantidad, // La cantidad se maneja por separado
        tipo: 'ingreso a producción',
        observaciones: `Ingreso manual [UUID: ${transaccionUUID}]`
      };

      window.tempMovimientoIngrediente = movimientoIngrediente;
      window.tempMovimientoStock = movimientoStock;
    }

    // ==========================================
    // 🚀 ENVÍO DE DATOS (NUEVO o EDICIÓN)
    // ==========================================
    if (window.edicionUUIDActual) {
      console.log('🔄 Ejecutando EDICIÓN ATÓMICA de Ingreso Manual', window.edicionUUIDActual);
      const payloadEdicion = {
        movimientoIngrediente: window.tempMovimientoIngrediente || null,
        movimientoStock: window.tempMovimientoStock || null,
        stockUsuario: window.tempStockUsuarioPayload || null
      };

      const putResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroIdGlobal}/ingreso-manual-editar/${window.edicionUUIDActual}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadEdicion)
      });

      if (!putResponse.ok) {
        const errorData = await putResponse.json();
        throw new Error(errorData.error || 'Error al editar ingreso manual');
      }

      // Limpiar estado de edición
      window.edicionUUIDActual = null;
      const btn = document.getElementById('btnConfirmarIngreso');
      if (btn) {
        btn.innerText = 'Confirmar';
        btn.style.backgroundColor = '';
      }
    } else {
      // Flujo tradicional de CREACIÓN (múltiples requests)
      if (window.tempStockUsuarioPayload) {
        const stockResponse = await fetch('http://localhost:3002/api/produccion/ingredientes-stock-usuarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(window.tempStockUsuarioPayload)
        });
        if (!stockResponse.ok) throw new Error('Error al registrar stock de usuario');
      }

      if (window.tempMovimientoIngrediente) {
        await registrarMovimientoIngrediente(window.tempMovimientoIngrediente);
      }
      
      if (window.tempMovimientoStock) {
        await registrarMovimientoStockVentas(window.tempMovimientoStock);
      }
    }

    // Limpiar variables temporales
    delete window.tempStockUsuarioPayload;
    delete window.tempMovimientoIngrediente;
    delete window.tempMovimientoStock;


    // Asegurar que los valores numéricos sean números
    const stockAnteriorNum = parseFloat(stockAnteriorIngrediente) || 0;
    const kilosTotales = kilos * cantidad;
    const stockNuevoNum = stockAnteriorNum + kilosTotales;

    console.log('🔍 DEBUG - Registrando ingreso manual:', {
      articuloNombre: articuloSeleccionado.nombre,
      cantidadUnidades: parseFloat(cantidad),
      kilosTotales: kilosTotales,
      stockAnterior: stockAnteriorNum,
      stockNuevo: stockNuevoNum,
      carroId: parseInt(carroIdGlobal),
      usuarioId: parseInt(usuarioId),
      articuloNumero: articuloSeleccionado.numero
    });

    await registrarIngresoManualEnInforme({
      articuloNombre: articuloSeleccionado.nombre,
      cantidadUnidades: parseFloat(cantidad),
      kilosTotales: kilosTotales,
      stockAnterior: stockAnteriorNum,
      stockNuevo: stockNuevoNum,
      carroId: parseInt(carroIdGlobal),
      usuarioId: parseInt(usuarioId),
      articuloNumero: articuloSeleccionado.numero,
      codigoBarras: articuloSeleccionado.codigo_barras || '',
      ingredienteId: ingredienteSeleccionado, // Guardar el ID del ingrediente
      uuid: transaccionUUID // Guardar el UUID transaccional para poder editarlo
    });

    console.log('🔍 DEBUG - ingresosManualesDelCarro después de registrar:', ingresosManualesDelCarro);

    // 🆕 FUNCIONALIDAD: Actualizar kilos_unidad si cambió
    try {
      await actualizarKilosUnidadSiCambio(articuloSeleccionado.numero, kilos);
    } catch (error) {
      console.warn('⚠️ [KILOS_UNIDAD] Error al actualizar, pero continuando con el flujo:', error);
    }

    // Actualizar el informe de ingresos manuales con delay para evitar duplicados
    await actualizarInformeIngresosManuales(1500); // 1.5 segundos de delay

    alert('Ingreso registrado correctamente');
    cerrarModal();
    // Actualizar el resumen de ingredientes para reflejar el nuevo stock
    actualizarResumenIngredientes();

  } catch (error) {
    console.error('❌ Error al registrar ingreso:', error);
    alert('Hubo un error al registrar el ingreso: ' + error.message);

    // 🔓 REACTIVAR BOTÓN EN CASO DE ERROR
    reactivarBotonConfirmar();
  }
}

function obtenerIngrediente(id) {
  return fetch(`http://localhost:3002/api/produccion/ingredientes/${id}`)
    .then(res => {
      if (!res.ok) throw new Error('No se pudo obtener el ingrediente');
      return res.json();
    });
}

// Array para almacenar los ingresos manuales del carro actual
let ingresosManualesDelCarro = [];

// Hacer el array accesible globalmente para el informe de impresión
window.ingresosManualesDelCarro = ingresosManualesDelCarro;

// Función para sincronizar el array global
function sincronizarArrayGlobal() {
  window.ingresosManualesDelCarro = ingresosManualesDelCarro;
}

// Función para registrar un ingreso manual en el informe
async function registrarIngresoManualEnInforme(datosIngreso) {
  try {
    console.log('📝 Registrando ingreso manual en informe:', datosIngreso);

    // Agregar timestamp y ID único
    const ingresoConId = {
      ...datosIngreso,
      id: Date.now() + Math.random(), // ID único temporal
      fechaIngreso: new Date().toLocaleString()
    };

    // Agregar al array de ingresos del carro
    ingresosManualesDelCarro.push(ingresoConId);

    // Sincronizar con el array global
    sincronizarArrayGlobal();

    console.log('✅ Ingreso registrado en informe local y sincronizado globalmente');

    // 🖨️ IMPRESIÓN AUTOMÁTICA DE ETIQUETA
    // 🖨️ IMPRESIÓN AUTOMÁTICA DE ETIQUETA
    const checkImprimirBultos = document.getElementById('checkImprimirEtiqueta');
    const checkImprimirKilos = document.getElementById('checkImprimirPorKilos');

    // Determinar EXACTAMENTE qué modo usar
    // Prioridad: Si Kilos está marcado, usamos Kilos. Si no, si Bultos está marcado, usamos Bultos.
    const modoKilosActivo = checkImprimirKilos && checkImprimirKilos.checked;
    const modoBultosActivo = checkImprimirBultos && checkImprimirBultos.checked;

    if (modoKilosActivo || modoBultosActivo) {
      console.log('🖨️ INICIANDO IMPRESIÓN DE ETIQUETA');

      try {
        let cantidadEtiquetas = 1;

        // ⚠️ LÓGICA EXCLUYENTE ESTRICTA
        if (modoKilosActivo) {
          console.log('⚖️ MODO KILOS DETECTADO: Usando valor del campo kilos.');
          const kilosRaw = parseFloat(datosIngreso.kilosTotales); // Este es el valor del inputKilos
          cantidadEtiquetas = Math.round(kilosRaw);
          if (cantidadEtiquetas < 1) cantidadEtiquetas = 1;
          console.log(`⚖️ Cantidad a imprimir: ${cantidadEtiquetas} etiquetas (Input Kilos: ${kilosRaw})`);
        } else if (modoBultosActivo) {
          console.log('📦 MODO BULTOS DETECTADO: Usando valor del campo cantidad.');
          cantidadEtiquetas = parseFloat(datosIngreso.cantidadUnidades);
          console.log(`📦 Cantidad a imprimir: ${cantidadEtiquetas} etiquetas`);
        } else {
          console.warn('⚠️ Ningún modo de impresión activo (lógica redundante).');
          return;
        }

        // 🔧 CORRECCIÓN: Usar código del artículo seleccionado
        const codigoArticulo = datosIngreso.articuloNumero;

        // 🔧 CORRECCIÓN: Extraer letra del sector si existe
        let sectorLetra = '';
        try {
          const ingredienteData = await obtenerIngrediente(datosIngreso.ingredienteId);
          if (ingredienteData && ingredienteData.sector_descripcion) {
            const match = ingredienteData.sector_descripcion.match(/"([^"]+)"/);
            if (match && match[1]) {
              sectorLetra = match[1];
            } else {
              sectorLetra = '';
            }
          }
        } catch (err) {
          console.warn('⚠️ No se pudo obtener sector para etiqueta:', err);
        }

        let nombreIngredienteEtiqueta = datosIngreso.articuloNombre || 'Ingrediente Manual';
        try {
          const infoIng = await obtenerIngrediente(datosIngreso.ingredienteId);
          if (infoIng && infoIng.nombre) {
            nombreIngredienteEtiqueta = infoIng.nombre;
          }
        } catch (e) { console.warn('No se pudo obtener nombre ingrediente exacto'); }

        await imprimirEtiquetaIngrediente(
          datosIngreso.ingredienteId,
          nombreIngredienteEtiqueta, // ✅ Nombre exacto del ingrediente
          cantidadEtiquetas, // ✅ Cantidad calculada estrictamente
          codigoArticulo,
          sectorLetra
        );
        console.log('✅ Orden de impresión enviada con cantidad:', cantidadEtiquetas);
      } catch (printError) {
        console.error('❌ Error al intentar imprimir etiqueta:', printError);
      }
    }
  } catch (error) {
    console.error('❌ Error al registrar ingreso en informe:', error);
  }
}

// 🔧 CORRECCIÓN 2: Función específica para filtrar duplicados en carros internos
function filtrarDuplicadosCarrosInternos(ingresosBackend, ingresosMemoria) {
  const ingresosUnicosMap = new Map();

  // Procesar ingresos del backend primero (tienen prioridad)
  ingresosBackend.forEach(ing => {
    const key = `${ing.articulo_numero}-${Math.round(parseFloat(ing.kilos) * 100)}`; // Redondear para evitar diferencias decimales mínimas
    if (!ingresosUnicosMap.has(key)) {
      ingresosUnicosMap.set(key, { ...ing, fuente: 'backend' });
    }
  });

  // Procesar ingresos en memoria solo si NO existen en backend
  ingresosMemoria.forEach(ing => {
    const key = `${ing.articuloNumero}-${Math.round(parseFloat(ing.kilosTotales) * 100)}`;
    if (!ingresosUnicosMap.has(key)) {
      ingresosUnicosMap.set(key, { ...ing, fuente: 'memoria' });
    }
  });

  return Array.from(ingresosUnicosMap.values());
}

// 🔧 CORRECCIÓN 5: Función completamente reescrita para eliminar duplicados definitivamente
async function actualizarInformeIngresosManuales(delayMs = 0) {
  try {
    console.log('\n🔄 INICIANDO ACTUALIZACIÓN DE INFORME DE INGRESOS MANUALES');
    console.log('================================================================');

    // Agregar delay opcional para permitir que el backend procese
    if (delayMs > 0) {
      console.log(`⏳ Esperando ${delayMs}ms para que el backend procese...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const contenedor = document.getElementById('tabla-ingresos-manuales');
    if (!contenedor) {
      console.warn('⚠️ No se encontró el contenedor del informe de ingresos manuales');
      return;
    }

    // Obtener el carro activo
    const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    if (!carroId) {
      // 🎯 MEJORA UX: Mensaje más amigable mientras se carga el carro
      contenedor.innerHTML = '<p style="color: #6c757d; font-style: italic;">⏳ Esperando selección de carro...</p>';
      return;
    }

    console.log(`🚚 Procesando carro ID: ${carroId}`);

    // PASO 1: Limpiar completamente la memoria local para evitar acumulación
    console.log('🧹 PASO 1: Limpiando memoria local...');
    ingresosManualesDelCarro = ingresosManualesDelCarro.filter(ing =>
      ing.carroId.toString() !== carroId
    );
    sincronizarArrayGlobal();
    console.log(`✅ Memoria local limpiada. Ingresos restantes: ${ingresosManualesDelCarro.length}`);

    // PASO 2: Obtener SOLO datos del backend (fuente única de verdad)
    console.log('📡 PASO 2: Obteniendo datos del backend...');
    let ingresosDelBackend = [];
    try {
      const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingresos-manuales`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      if (response.ok) {
        ingresosDelBackend = await response.json();
        console.log(`📊 Ingresos obtenidos del backend: ${ingresosDelBackend.length}`);

        // Log detallado de cada ingreso
        ingresosDelBackend.forEach((ing, index) => {
          console.log(`  ${index + 1}. ID: ${ing.id} | Artículo: ${ing.articulo_nombre} | Kilos: ${ing.kilos} | Fecha: ${ing.fecha}`);
        });
      } else {
        console.warn('⚠️ Error al obtener ingresos del backend:', response.status);
      }
    } catch (error) {
      console.error('❌ Error al obtener ingresos del backend:', error);
    }

    // PASO 3: Aplicar filtrado robusto para eliminar duplicados absolutos
    console.log('🔍 PASO 3: Aplicando filtrado anti-duplicados...');
    const ingresosUnicos = new Map();

    ingresosDelBackend.forEach((ing, index) => {
      // Crear clave única basada en múltiples campos
      const clave = `${ing.articulo_numero}-${ing.ingrediente_id}-${Math.round(parseFloat(ing.kilos || 0) * 1000)}-${ing.fecha}`;

      if (!ingresosUnicos.has(clave)) {
        ingresosUnicos.set(clave, {
          ...ing,
          fuente: 'backend',
          indiceOriginal: index
        });
        console.log(`  ✅ Agregado: ${ing.articulo_nombre} (${ing.kilos}kg) - Clave: ${clave}`);
      } else {
        console.log(`  🚫 Duplicado eliminado: ${ing.articulo_nombre} (${ing.kilos}kg) - Clave: ${clave}`);
      }
    });

    const ingresosFiltrados = Array.from(ingresosUnicos.values());
    console.log(`🎯 Resultado del filtrado: ${ingresosFiltrados.length} ingresos únicos`);

    // PASO 4: Generar HTML
    console.log('🎨 PASO 4: Generando HTML...');
    if (ingresosFiltrados.length === 0) {
      contenedor.innerHTML = '<p>No se han realizado ingresos manuales en este carro</p>';
      console.log('📝 No hay ingresos para mostrar');
      return;
    }

    let html = `
      <table>
        <thead>
          <tr>
            <th>Artículo</th>
            <th>Cantidad</th>
            <th>Kilos Totales</th>
            <th>Stock Anterior</th>
            <th>Stock Nuevo</th>
            <th>Fecha</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
    `;

    ingresosFiltrados.forEach((ingreso, index) => {
      try {
        const kilos = parseFloat(ingreso.kilos) || 0;
        const nombreArticulo = ingreso.articulo_nombre || ingreso.ingrediente_nombre || 'Sin nombre';
        const fecha = ingreso.fecha ? new Date(ingreso.fecha).toLocaleString() : '-';
        const ingresoId = `db_${ingreso.id}`;
        const tipoArticulo = ingreso.tipo_articulo || 'simple';

        // 🔧 CORRECCIÓN: Extraer UUID de observaciones si existe
        const uuidMatch = ingreso.observaciones ? ingreso.observaciones.match(/\[UUID: (.*?)\]/) : null;
        const uuid = uuidMatch ? uuidMatch[1] : '';

        // Determinar iconografía y texto según el tipo de artículo
        const esMix = tipoArticulo === 'mix';
        const esSustitucion = tipoArticulo === 'sustitucion';

        // 🔧 CORRECCIÓN: Íconos diferenciados
        let icono, tipoBadge;
        if (esSustitucion) {
          icono = '🌾'; // Ícono de ingrediente/grano para sustituciones
          tipoBadge = 'Sustitución';
        } else if (esMix) {
          icono = '🧪'; // Ícono de mix
          tipoBadge = 'MIX';
        } else {
          icono = '📦'; // Ícono de artículo/caja
          tipoBadge = 'Simple';
        }

        // Para MIX, omitir las columnas de stock anterior y nuevo
        const columnasStock = esMix ?
          '<td colspan="2" class="mix-info">Artículo compuesto</td>' :
          '<td class="stock-anterior">-</td><td class="stock-nuevo">-</td>';

        html += `
          <tr data-tipo="backend" data-articulo-tipo="${tipoArticulo}" data-ingreso-id="${ingreso.id}" data-ingreso-uuid="${uuid}">
            <td>
              ${icono} ${nombreArticulo} 
              <span class="tipo-badge tipo-${tipoArticulo}">${tipoBadge}</span>
            </td>
            <td>1</td>
            <td>${kilos.toFixed(2)}</td>
            ${columnasStock}
            <td>${fecha}</td>
            <td style="white-space: nowrap;">
              ${uuid && !esMix && !esSustitucion ? `
              <button class="btn-editar-ingreso" style="cursor:pointer; background:none; border:none; font-size:1.2rem; margin-right:5px;" onclick="iniciarEdicionIngresoManual('${uuid}', '${ingreso.articulo_numero}', ${kilos}, '${nombreArticulo.replace(/'/g, "\\'")}')" title="Editar ingreso">
                ✏️
              </button>
              ` : ''}
              <button class="btn-eliminar-ingreso" style="cursor:pointer; background:none; border:none; font-size:1.2rem; margin-right:5px;" onclick="eliminarIngresoManual('${uuid ? 'uuid_' + uuid : ingresoId}')" title="Eliminar ingreso">
                🗑️
              </button>
              <button class="btn-imprimir-etiqueta-ingrediente" style="cursor:pointer; background:none; border:none; font-size:1.2rem;"
                      onclick="imprimirEtiquetaIngredienteDesdeIngreso('${ingreso.ingrediente_id}', '${(ingreso.ingrediente_nombre || nombreArticulo).replace(/'/g, "\\'")}', '${ingreso.articulo_numero}')"
                      title="Imprimir etiqueta del ingrediente">
                🏷️
              </button>
            </td>
          </tr>
        `;

        console.log(`  ${index + 1}. Fila generada: ${nombreArticulo} (${kilos}kg)`);
      } catch (err) {
        console.error('❌ Error al procesar ingreso:', err, ingreso);
      }
    });

    html += `
        </tbody>
      </table>
    `;

    // PASO 5: Actualizar DOM
    console.log('🖥️ PASO 5: Actualizando DOM...');
    contenedor.innerHTML = html;

    console.log('✅ INFORME DE INGRESOS MANUALES ACTUALIZADO EXITOSAMENTE');
    console.log(`📊 Total de filas mostradas: ${ingresosFiltrados.length}`);
    console.log('================================================================\n');

  } catch (error) {
    console.error('❌ ERROR CRÍTICO al actualizar informe de ingresos manuales:', error);
    console.error('❌ Stack trace:', error.stack);
  }
}

// Función para eliminar un ingreso manual
async function eliminarIngresoManual(ingresoId) {
  try {
    console.log('\n🚨 INICIANDO ELIMINACIÓN DE INGRESO MANUAL');
    console.log('================================================================');
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    console.log(`🆔 ID del ingreso a eliminar: "${ingresoId}"`);
    console.log(`📋 Tipo de dato: ${typeof ingresoId}`);
    console.log(`📏 Longitud: ${ingresoId ? ingresoId.length : 'undefined'}`);

    if (!confirm('¿Estás seguro de que querés eliminar este ingreso manual? Esta acción no se puede deshacer.')) {
      console.log('❌ Usuario canceló la eliminación');
      return;
    }

    console.log('✅ Usuario confirmó la eliminación, procediendo...');
    console.log('🗑️ Eliminando ingreso manual:', ingresoId);

    // Determinar si es un ingreso del backend o en memoria
    const [tipo, id] = ingresoId.split('_');
    console.log('🔍 Tipo de ingreso:', tipo, 'ID:', id);

    if (tipo === 'mem') {
      // Ingreso en memoria - solo eliminar del array local
      const ingresoIndex = ingresosManualesDelCarro.findIndex(ingreso =>
        ingreso.id.toString() === id
      );

      if (ingresoIndex === -1) {
        console.warn('⚠️ Ingreso en memoria ya no existe, actualizando UI');
        await actualizarInformeIngresosManuales();
        return;
      }

      ingresosManualesDelCarro.splice(ingresoIndex, 1);
      sincronizarArrayGlobal();

      console.log('✅ Ingreso en memoria eliminado correctamente');
    } else if (tipo === 'uuid') {
      console.log('🗑️ Eliminando ingreso de base de datos físicamente por UUID');
      const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
      
      const deleteResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingreso-manual-uuid/${id}`, {
        method: 'DELETE'
      });
      
      if (!deleteResponse.ok) {
        throw new Error('Error al eliminar información del ingreso por UUID');
      }
      
      console.log('✅ Ingreso eliminado correctamente por UUID');
    } else if (tipo === 'db') {
      console.log('🗑️ Eliminando ingreso de base de datos físicamente por ID original');

      // Obtener información del ingreso para determinar el tipo de eliminación
      const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
      const ingresoIdReal = id;

      // Primero obtener los datos del ingreso para saber el tipo
      const ingresosResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingresos-manuales`);
      if (!ingresosResponse.ok) {
        throw new Error('Error al obtener información del ingreso');
      }

      const ingresos = await ingresosResponse.json();
      const ingresoAEliminar = ingresos.find(ing => ing.id.toString() === ingresoIdReal);

      if (!ingresoAEliminar) {
        throw new Error('Ingreso no encontrado');
      }

      const tipoArticulo = ingresoAEliminar.tipo_articulo || 'simple';
      console.log(`🔍 Tipo de artículo a eliminar: ${tipoArticulo}`);

      if (tipoArticulo === 'sustitucion') {
        // 🌾 SUSTITUCIÓN: Eliminar movimientos de ingredientes_movimientos
        console.log('🌾 Eliminando sustitución de ingredientes...');

        // Eliminar los movimientos de sustitución (egreso e ingreso)
        const response = await fetch(`http://localhost:3002/api/produccion/sustitucion/${ingresoIdReal}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            carro_id: carroId
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`Error al eliminar sustitución: ${errorData.error || 'Error desconocido'}`);
        }

        console.log('✅ Sustitución eliminada correctamente');

      } else if (tipoArticulo === 'mix') {
        // 🧪 MIX: eliminar de stock_ventas_movimientos y registros relacionados
        console.log('🧪 Eliminando artículo MIX y registros relacionados...');

        // Eliminar registros de ingredientes_stock_usuarios relacionados
        const deleteStockUsuariosQuery = await fetch(`http://localhost:3002/api/produccion/ingredientes-stock-usuarios/eliminar-por-mix`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            carro_id: carroId,
            origen_mix_id: ingresoAEliminar.ingrediente_id,
            articulo_numero: ingresoAEliminar.articulo_numero
          })
        });

        if (!deleteStockUsuariosQuery.ok) {
          console.warn('⚠️ Error al eliminar registros de ingredientes_stock_usuarios');
        }

        // Eliminar de stock_ventas_movimientos
        const deleteStockVentasQuery = await fetch(`http://localhost:3002/api/produccion/stock-ventas-movimientos/${ingresoIdReal}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (!deleteStockVentasQuery.ok) {
          console.warn('⚠️ Error al eliminar de stock_ventas_movimientos');
        }

      } else {
        // 📦 SIMPLE: usar el endpoint existente
        console.log('📦 Eliminando ingrediente simple...');

        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingreso-manual/${ingresoIdReal}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`Error al eliminar ingreso: ${errorData.error || 'Error desconocido'}`);
        }

        console.log('✅ Ingrediente simple eliminado correctamente');
      }

    } else {
      console.warn('⚠️ Tipo de ingreso inválido:', tipo);
      await actualizarInformeIngresosManuales();
      return;
    }

    // 🔧 CORRECCIÓN CRÍTICA: Esperar confirmación del backend antes de actualizar UI
    console.log('⏳ Esperando confirmación completa del backend...');
    await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 segundos para asegurar procesamiento completo

    // Actualizar la UI inmediatamente después de la eliminación exitosa
    console.log('🔄 Actualizando UI después de eliminación exitosa...');
    await actualizarInformeIngresosManuales();

    // 🔧 CORRECCIÓN CRÍTICA: Forzar recálculo completo y sincronizado del resumen de ingredientes
    console.log('🔄 INICIANDO RECÁLCULO COMPLETO DEL RESUMEN DE INGREDIENTES...');
    console.log('================================================================');
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    console.log(`🗑️ Ingreso eliminado: ${ingresoId}`);

    try {
      const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
      const colaboradorData = localStorage.getItem('colaboradorActivo');

      if (!carroId || !colaboradorData) {
        console.warn('⚠️ No hay carro activo o colaborador para actualizar resumen');
        return;
      }

      const colaborador = JSON.parse(colaboradorData);
      console.log(`🚚 Recalculando para carro ${carroId}, usuario ${colaborador.id}`);

      // PASO 1: Obtener resumen fresco desde el backend (fuerza recálculo en servidor)
      console.log('📡 PASO 1: Obteniendo resumen fresco desde el backend...');
      const { obtenerResumenIngredientesCarro, mostrarResumenIngredientes } = await import('./carro.js');

      // Forzar recarga completa con parámetros de cache
      const ingredientesActualizados = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingredientes?usuarioId=${colaborador.id}&_t=${Date.now()}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }).then(response => {
        if (!response.ok) {
          throw new Error('Error al obtener ingredientes actualizados');
        }
        return response.json();
      });

      console.log('📊 Ingredientes actualizados obtenidos del backend:', ingredientesActualizados.length);

      // Log detallado de cada ingrediente para verificar stock_actual
      console.log('\n🔍 VERIFICACIÓN DE STOCK_ACTUAL DESPUÉS DE ELIMINACIÓN:');
      ingredientesActualizados.forEach((ing, index) => {
        console.log(`${index + 1}. ${ing.nombre}: stock_actual = ${ing.stock_actual} (${typeof ing.stock_actual})`);
      });

      // PASO 2: Actualizar la UI con los datos frescos
      console.log('🎨 PASO 2: Actualizando UI con datos frescos...');
      mostrarResumenIngredientes(ingredientesActualizados);

      console.log('✅ Resumen de ingredientes recalculado y actualizado correctamente');

      // PASO 3: También actualizar resumen de mixes si existe
      console.log('🧪 PASO 3: Actualizando resumen de mixes...');
      try {
        const { obtenerResumenMixesCarro, mostrarResumenMixes } = await import('./carro.js');
        const mixesActualizados = await obtenerResumenMixesCarro(carroId, colaborador.id);
        mostrarResumenMixes(mixesActualizados);
        console.log('✅ Resumen de mixes también actualizado');
      } catch (mixError) {
        console.warn('⚠️ No se pudo actualizar resumen de mixes:', mixError);
      }

      console.log('✅ RECÁLCULO COMPLETO FINALIZADO EXITOSAMENTE');
      console.log('================================================================');

      // 🚀 TICKET #009: Emitir evento para refrescar componentes dinámicos
      window.dispatchEvent(new CustomEvent('carroEstadoCambiado', { 
        detail: { carroId: carroId, accion: 'ingresoManualEliminado' } 
      }));

    } catch (resumenError) {
      console.error('❌ ERROR CRÍTICO al recalcular resumen de ingredientes:', resumenError);
      console.error('❌ Stack trace completo:', resumenError.stack);

      // Fallback: intentar actualización básica
      console.log('🔄 Intentando fallback con actualización básica...');
      try {
        if (typeof actualizarResumenIngredientes === 'function') {
          await actualizarResumenIngredientes();
          console.log('✅ Fallback: Resumen actualizado con función básica');
        }
      } catch (fallbackError) {
        console.error('❌ Error en fallback de actualización:', fallbackError);
        alert('Error crítico: No se pudo actualizar el resumen de ingredientes. Por favor, recarga la página.');
      }
    }

  } catch (error) {
    console.error('❌ Error al eliminar ingreso manual:', error);

    // Si hay error, al menos actualizar la UI para reflejar el estado real
    try {
      await actualizarInformeIngresosManuales();
      // También intentar actualizar el resumen de ingredientes en caso de error
      if (typeof actualizarResumenIngredientes === 'function') {
        actualizarResumenIngredientes();
      }
    } catch (updateError) {
      console.error('❌ Error adicional al actualizar UI:', updateError);
    }

    alert('Error al eliminar el ingreso: ' + error.message);
  }
}

// Función para limpiar ingresos manuales al cambiar de carro
export function limpiarIngresosManualesDelCarro() {
  const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
  if (!carroId) {
    // Si no hay carro activo, limpiar todo
    ingresosManualesDelCarro = [];
  }
  // Si hay carro activo, mantener solo los ingresos de otros carros
  // (esto permite cambiar entre carros sin perder los datos)
}

// Función para limpiar visualmente el informe de ingresos manuales
export function limpiarInformeIngresosManuales() {
  try {
    const contenedor = document.getElementById('tabla-ingresos-manuales');
    if (!contenedor) {
      console.warn('⚠️ No se encontró el contenedor del informe de ingresos manuales');
      return;
    }

    console.log('🧹 Limpiando informe visual de ingresos manuales');
    contenedor.innerHTML = '<p>No se han realizado ingresos manuales en este carro</p>';

    // También limpiar el array en memoria
    ingresosManualesDelCarro = [];
    sincronizarArrayGlobal();

    console.log('✅ Informe de ingresos manuales limpiado correctamente');
  } catch (error) {
    console.error('❌ Error al limpiar informe de ingresos manuales:', error);
  }
}

// 🆕 Función para imprimir etiqueta de ingrediente desde ingreso manual
async function imprimirEtiquetaIngredienteDesdeIngreso(ingredienteId, ingredienteNombre, articuloNumero) {
  try {
    console.log('🏷️ INICIANDO IMPRESIÓN DE ETIQUETA DE INGREDIENTE');
    console.log('================================================================');
    console.log('📋 Datos recibidos (parámetros originales):', {
      ingredienteId,
      ingredienteNombre,
      articuloNumero
    });

    // Validar datos de entrada
    if (!ingredienteId) {
      throw new Error('ID del ingrediente es requerido para imprimir la etiqueta');
    }

    // 🔧 CORRECCIÓN: Consultar los datos correctos del ingrediente
    console.log('🔍 [ETIQUETA-DEBUG] Consultando datos del ingrediente para obtener nombre y código correctos...');

    const ingredienteData = await obtenerIngrediente(ingredienteId);

    if (!ingredienteData) {
      throw new Error(`No se encontraron datos para el ingrediente ID: ${ingredienteId}`);
    }

    // ✅ USAR DATOS CORRECTOS DEL INGREDIENTE (no del artículo)
    const nombreIngredienteCorrect = ingredienteData.nombre;
    // CORRECCIÓN: Usar el código del artículo pasado como parámetro, NO el del ingrediente
    // El usuario pidió: "Origen del código: Asegúrate de enviar el articuloSeleccionado.numero"
    const codigoIngredienteCorrect = articuloNumero || ingredienteData.codigo || ingredienteId.toString();

    console.log('🔍 [ETIQUETA-DEBUG] Comparación de datos:');
    console.log('❌ DATOS INCORRECTOS (artículo):');
    console.log(`   - Nombre del artículo: "${ingredienteNombre}"`);
    console.log(`   - Código del artículo: "${articuloNumero}"`);
    console.log('✅ DATOS CORRECTOS (ingrediente):');
    console.log(`   - Nombre del ingrediente: "${nombreIngredienteCorrect}"`);
    console.log(`   - Código del ingrediente: "${codigoIngredienteCorrect}"`);

    console.log('📡 Enviando solicitud al servidor de etiquetas...');

    // Llamar al endpoint de impresión de etiquetas de ingredientes
    const response = await fetch('http://localhost:3000/api/etiquetas/ingrediente', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        nombre: nombreIngredienteCorrect,
        codigo: codigoIngredienteCorrect,
        cantidad: 1, // Default 1 si se llama desde botón 'Etiqueta' (aunque este botón usa la función imprimirEtiquetaIngredienteDesdeIngreso normalmente con parámetros)
        sector: ingredienteData.sector_descripcion ? (ingredienteData.sector_descripcion.match(/"([^"]+)"/)?.[1] || '') : ''
      })
    });

    console.log(`📡 Respuesta del servidor: Status ${response.status}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Error del servidor: ${errorData.error || 'Error desconocido'}`);
    }

    const result = await response.json();
    console.log('✅ Respuesta exitosa del servidor:', result);

    // Mostrar confirmación visual
    alert(`✅ Etiqueta del ingrediente "${nombreIngredienteCorrect}" enviada a imprimir correctamente\nCódigo: ${codigoIngredienteCorrect}`);

    console.log('✅ IMPRESIÓN DE ETIQUETA COMPLETADA EXITOSAMENTE');
    console.log('================================================================');

  } catch (error) {
    console.error('❌ ERROR AL IMPRIMIR ETIQUETA DE INGREDIENTE');
    console.error('================================================================');
    console.error('❌ Detalles del error:', error);
    console.error('❌ Stack trace:', error.stack);
    console.error('================================================================');

    // Mostrar error al usuario
    alert(`❌ Error al imprimir etiqueta: ${error.message}`);
  }
}

// 🆕 NUEVA FUNCIÓN: Cargar artículos sugeridos basados en HISTORIAL REAL de uso
async function cargarArticulosSugeridos(nombreIngrediente) {
  try {
    console.log('⚡ [SUGERIDOS] Cargando artículos sugeridos basados en historial para ingrediente ID:', ingredienteSeleccionado);

    const container = document.getElementById('articulos-sugeridos-container');
    const grid = document.getElementById('articulos-sugeridos-grid');

    if (!container || !grid) {
      console.warn('⚠️ [SUGERIDOS] Contenedores no encontrados');
      return;
    }

    // ✅ CORRECCIÓN: Consultar el endpoint de historial real
    const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteSeleccionado}/articulos-sugeridos`);

    if (!response.ok) {
      throw new Error('Error al obtener artículos sugeridos del historial');
    }

    const articulosSugeridos = await response.json();

    console.log(`⚡ [SUGERIDOS] Encontrados ${articulosSugeridos.length} artículos del historial real`);

    if (articulosSugeridos.length === 0) {
      console.log('ℹ️ [SUGERIDOS] No hay historial de uso para este ingrediente - ocultando panel');
      container.style.display = 'none';
      return;
    }

    // Generar las tarjetas de sugeridos
    grid.innerHTML = '';
    articulosSugeridos.forEach((art, index) => {
      const stock = parseFloat(art.stock_actual) || 0;
      const stockClass = stock > 0 ? '' : 'sin-stock';
      const esMasReciente = index === 0; // El primero es el más reciente

      const card = document.createElement('div');
      card.className = 'articulo-sugerido-card';
      if (esMasReciente) {
        card.style.borderColor = '#007bff';
        card.style.backgroundColor = '#f8f9ff';
      }

      card.innerHTML = `
        <p class="articulo-sugerido-nombre">${esMasReciente ? '⭐ ' : ''}${art.articulo_nombre}</p>
        <p class="articulo-sugerido-stock ${stockClass}">Stock: ${stock.toFixed(2)} kg</p>
      `;

      // Al hacer clic, seleccionar el artículo automáticamente
      card.addEventListener('click', () => {
        console.log('⚡ [SUGERIDOS] Artículo seleccionado desde historial:', art.articulo_nombre);
        console.log(`📊 [SUGERIDOS] Última vez usado: ${art.ultima_fecha_uso}, Frecuencia: ${art.frecuencia_uso}`);

        // Crear objeto artículo compatible con seleccionarArticulo()
        const articuloParaSeleccionar = {
          numero: art.articulo_numero,
          nombre: art.articulo_nombre,
          codigo_barras: art.codigo_barras,
          stock_consolidado: art.stock_actual
        };

        seleccionarArticulo(articuloParaSeleccionar);
      });

      grid.appendChild(card);
    });

    // Mostrar el contenedor
    container.style.display = 'block';
    console.log('✅ [SUGERIDOS] Panel de sugeridos cargado correctamente desde historial real');

  } catch (error) {
    console.error('❌ [SUGERIDOS] Error al cargar artículos sugeridos:', error);
    // No mostrar el panel si hay error
    const container = document.getElementById('articulos-sugeridos-container');
    if (container) {
      container.style.display = 'none';
    }
  }
}

// ✅ NUEVA FUNCIÓN: Hacer el modal DRAGGABLE
function hacerModalDraggable() {
  if (!modal) {
    console.warn('⚠️ [DRAGGABLE] Modal no disponible');
    return;
  }

  const modalContent = modal.querySelector('.modal-content');
  const modalHeader = modal.querySelector('.modal-header');

  if (!modalContent || !modalHeader) {
    console.warn('⚠️ [DRAGGABLE] Elementos necesarios no encontrados');
    return;
  }

  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  modalHeader.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);

  function dragStart(e) {
    // Solo permitir arrastrar si se hace clic en el header (no en el botón X)
    if (e.target.classList.contains('close-modal')) {
      return;
    }

    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;

    if (e.target === modalHeader || modalHeader.contains(e.target)) {
      isDragging = true;
      modalHeader.style.cursor = 'grabbing';
    }
  }

  function drag(e) {
    if (isDragging) {
      e.preventDefault();

      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      xOffset = currentX;
      yOffset = currentY;

      setTranslate(currentX, currentY, modalContent);
    }
  }

  function dragEnd(e) {
    if (isDragging) {
      initialX = currentX;
      initialY = currentY;
      isDragging = false;
      modalHeader.style.cursor = 'move';
    }
  }

  function setTranslate(xPos, yPos, el) {
    el.style.transform = `translate(${xPos}px, ${yPos}px)`;
  }

  console.log('✅ [DRAGGABLE] Modal configurado como draggable');
}

// ==========================================
// EDICION DE INGRESO MANUAL (TICKET #011)
// ==========================================
window.edicionUUIDActual = null;

window.iniciarEdicionIngresoManual = function(uuid, articuloNumero, kilos, nombreArticulo) {
  console.log('✏️ Iniciando edición de ingreso manual para UUID:', uuid);
  
  // Guardar estado
  window.edicionUUIDActual = uuid;
  
  // Reset UI del modal
  const modal = document.getElementById('modalIngresoManual');
  const inputKilos = document.getElementById('inputKilos');
  const inputCantidad = document.getElementById('inputCantidad');
  const busqueda = document.getElementById('busquedaArticulo');
  const btnConfirmar = document.getElementById('btnConfirmarIngreso');
  
  // Limpiar seleccion
  articuloSeleccionado = null;
  ingredienteSeleccionado = null;

  busqueda.value = nombreArticulo;
  inputKilos.value = kilos;
  inputCantidad.value = 1;
  
  // Buscar en el backend para pre-seleccionar
  buscarArticuloBackend(nombreArticulo).then(resultados => {
    if (resultados && resultados.length > 0) {
      // Intentar coincidir por número
      const art = resultados.find(r => r.numero == articuloNumero) || resultados[0];
      seleccionarArticulo(art);
      
      // Ajustar botón
      btnConfirmar.innerText = '💾 Guardar Edición';
      btnConfirmar.style.backgroundColor = '#28a745'; // Verde para edición
      btnConfirmar.disabled = false;
      modal.style.display = 'block';
    } else {
      alert('No se pudo encontrar el artículo original para editar.');
    }
  }).catch(err => {
    console.error('Error pre-cargando artículo:', err);
    alert('Error al intentar cargar la edición.');
  });
};

// Función nativa para limpiar la edición actual al cerrar modal
const origCerrarModal = window.cerrarModalIngresoManual;
window.cerrarModalIngresoManual = function() {
  window.edicionUUIDActual = null;
  const btnConfirmar = document.getElementById('btnConfirmarIngreso');
  if (btnConfirmar) {
    btnConfirmar.innerText = 'Confirmar';
    btnConfirmar.style.backgroundColor = '';
  }
  if (typeof origCerrarModal === 'function') origCerrarModal();
  else {
    const modal = document.getElementById('modalIngresoManual');
    if (modal) modal.style.display = 'none';
  }
};

// Hacer funciones disponibles globalmente
window.eliminarIngresoManual = eliminarIngresoManual;
window.actualizarInformeIngresosManuales = actualizarInformeIngresosManuales;
window.abrirModalIngresoManual = abrirModalIngresoManual;
window.imprimirEtiquetaIngredienteDesdeIngreso = imprimirEtiquetaIngredienteDesdeIngreso;
