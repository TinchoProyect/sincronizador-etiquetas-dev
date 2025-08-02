import {
  registrarMovimientoIngrediente,
  registrarMovimientoStockVentas
} from './apiMovimientos.js';
import { actualizarResumenIngredientes, obtenerResumenIngredientesCarro } from './carro.js';

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

let modal = null;
let inputBusqueda = null;
let listaResultados = null;
let inputKilos = null;
let inputCantidad = null;
let btnConfirmar = null;
let btnCancelar = null;
let nombreIngredienteDisplay = null;

let ingredienteSeleccionado = null;
let articuloSeleccionado = null;
let carroIdGlobal = null;

// 🔒 Variables para controlar el estado del botón y evitar clics múltiples
let procesamientoEnCurso = false;
let textoOriginalBoton = 'Confirmar';
let estadoOriginalBoton = {
  disabled: false,
  className: '',
  innerHTML: ''
};

export function abrirModalIngresoManual(ingredienteId, carroId, esMix = false) {
  console.log('✔️ Función abrirModalIngresoManual ejecutada');
  console.log(`Tipo de ingrediente: ${esMix ? 'Mix' : 'Simple'}`);
  ingredienteSeleccionado = ingredienteId;
  carroIdGlobal = carroId;

  if (!modal) inicializarModal();
  limpiarCamposModal();

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
    })
    .catch(err => {
      console.error('❌ Error al obtener ingrediente:', err);
      if (nombreIngredienteDisplay) {
        nombreIngredienteDisplay.textContent = 'Error al cargar ingrediente';
      }
    });

  modal.classList.add('show');
}

function inicializarModal() {
  try {
    // Verificar que el DOM esté completamente cargado
    if (document.readyState === 'loading') {
      console.log('⏳ DOM aún cargando, esperando...');
      document.addEventListener('DOMContentLoaded', inicializarModal);
      return;
    }

    console.log('🔧 Inicializando modal de ingreso manual...');
    
    // Obtener elementos del DOM con validación robusta
    modal = document.getElementById('modalIngresoManual');
    if (!modal) {
      console.error('❌ No se encontró el modal con id "modalIngresoManual"');
      return false;
    }

    inputBusqueda = document.getElementById('busquedaArticulo');
    if (!inputBusqueda) {
      console.error('❌ No se encontró el input de búsqueda');
      return false;
    }

    listaResultados = document.getElementById('listaArticulos');
    if (!listaResultados) {
      console.error('❌ No se encontró la lista de artículos');
      return false;
    }

    inputKilos = document.getElementById('inputKilos');
    if (!inputKilos) {
      console.error('❌ No se encontró el input de kilos');
      return false;
    }

    inputCantidad = document.getElementById('inputCantidad');
    if (!inputCantidad) {
      console.error('❌ No se encontró el input de cantidad');
      return false;
    }

    btnConfirmar = document.getElementById('btnConfirmarIngreso');
    if (!btnConfirmar) {
      console.error('❌ No se encontró el botón confirmar');
      return false;
    }

    btnCancelar = document.getElementById('btnCancelarIngreso');
    if (!btnCancelar) {
      console.error('❌ No se encontró el botón cancelar');
      return false;
    }

    // Buscar el elemento nombre-ingrediente de forma segura
    nombreIngredienteDisplay = modal.querySelector('.nombre-ingrediente');
    if (!nombreIngredienteDisplay) {
      console.warn('⚠️ No se encontró el elemento .nombre-ingrediente, creando uno temporal');
      // Crear elemento si no existe para evitar errores
      nombreIngredienteDisplay = document.createElement('p');
      nombreIngredienteDisplay.className = 'nombre-ingrediente';
      modal.insertBefore(nombreIngredienteDisplay, modal.firstChild);
    }

    // Agregar event listeners con manejo de errores
    try {
      inputBusqueda.addEventListener('input', manejarBusqueda);
      btnConfirmar.addEventListener('click', confirmarIngreso);
      btnCancelar.addEventListener('click', cerrarModal);

      // Event listener para cerrar modal al hacer click fuera
      window.addEventListener('click', (e) => {
        if (e.target === modal) cerrarModal();
      });

      console.log('✅ Modal de ingreso manual inicializado correctamente');
      return true;
      
    } catch (eventError) {
      console.error('❌ Error al agregar event listeners:', eventError);
      return false;
    }

  } catch (error) {
    console.error('❌ Error crítico al inicializar modal:', error);
    console.error('❌ Stack trace:', error.stack);
    return false;
  }
}

function limpiarCamposModal() {
  inputBusqueda.value = '';
  inputKilos.value = '';
  inputCantidad.value = '1'; // Restablecer a valor por defecto
  listaResultados.innerHTML = '';
  articuloSeleccionado = null;
  if (nombreIngredienteDisplay) nombreIngredienteDisplay.textContent = '';
  
  // 🔒 Resetear el estado del botón al limpiar el modal
  reactivarBotonConfirmar();
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

function cerrarModal() {
  if (modal) {
    modal.classList.remove('show');
  }
}

function manejarBusqueda() {
  const query = inputBusqueda.value.trim().toLowerCase();
  if (query.length < 2) {
    listaResultados.innerHTML = '';
    return;
  }

  fetch('http://localhost:3002/api/produccion/articulos')
    .then(response => {
      if (!response.ok) throw new Error('Error al buscar artículos');
      return response.json();
    })
    .then(data => {
      const resultados = data.filter(art =>
        (art.nombre && art.nombre.toLowerCase().includes(query)) ||
        (art.codigo_barras && art.codigo_barras.toLowerCase().includes(query))
      );

      listaResultados.innerHTML = '';

      if (resultados.length === 0) {
        listaResultados.innerHTML = '<li>No se encontraron artículos</li>';
        return;
      }

      resultados.forEach(art => {
        const li = document.createElement('li');
        // Mostrar nombre del artículo y stock disponible con 2 decimales
        const stockDisplay = art.stock_consolidado !== undefined ? Number(art.stock_consolidado).toFixed(2) : '0.00';
        li.textContent = `${art.nombre} — Stock: ${stockDisplay}`;
        li.addEventListener('click', () => {
          articuloSeleccionado = art;
          inputBusqueda.value = art.nombre;
          listaResultados.innerHTML = '';
        });
        listaResultados.appendChild(li);
      });
    })
    .catch(error => {
      console.error('❌ Error al buscar artículos:', error);
      listaResultados.innerHTML = '<li>Error al buscar artículos</li>';
    });
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

    if (tipoCarro === 'externa') {
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

        const stockResponse = await fetch('http://localhost:3002/api/produccion/ingredientes-stock-usuarios', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(stockUsuarioPayload)
        });

        if (!stockResponse.ok) {
          const errorData = await stockResponse.json();
          throw new Error(errorData.error || 'Error al registrar stock de usuario');
        }
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
        origenIngreso: esIngredienteCompuesto ? 'mix' : 'simple'
      };

      await registrarMovimientoStockVentas(movimientoStock);
      
    } else {
      console.log('🏭 PROCESANDO INGRESO MANUAL EN CARRO INTERNO');
      
      // 🔧 CORRECCIÓN CRÍTICA: Para carros internos, NO duplicar la multiplicación
      // El backend ya maneja la multiplicación por cantidad en el endpoint /ingredientes_movimientos
      
      const movimientoIngrediente = {
        ingredienteId: ingredienteSeleccionado,
        articuloNumero: articuloSeleccionado.numero,
        kilos: kilos * cantidad, // Kilos totales para el ingrediente
        carroId: parseInt(carroIdGlobal)
      };

      const movimientoStock = {
        articuloNumero: articuloSeleccionado.numero,
        codigoBarras: articuloSeleccionado.codigo_barras,
        kilos: -(kilos * cantidad), // 🔧 CORRECCIÓN CRÍTICA: Kilos totales (multiplicar por cantidad)
        carroId: parseInt(carroIdGlobal),
        usuarioId: parseInt(usuarioId),
        cantidad: cantidad, // La cantidad se maneja por separado
        tipo: 'ingreso a producción'
      };

      console.log('📦 Guardando ingreso manual CORREGIDO:', {
        movimientoIngrediente,
        movimientoStock,
        kilosUnitarios: kilos,
        cantidad: cantidad,
        kilosTotales: kilos * cantidad
      });
      
      await registrarMovimientoIngrediente(movimientoIngrediente);
      await registrarMovimientoStockVentas(movimientoStock);
    }

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
      ingredienteId: ingredienteSeleccionado // Guardar el ID del ingrediente
    });

    console.log('🔍 DEBUG - ingresosManualesDelCarro después de registrar:', ingresosManualesDelCarro);

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
    const carroId = localStorage.getItem('carroActivo');
    if (!carroId) {
      contenedor.innerHTML = '<p>No hay carro activo</p>';
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
        
        // Determinar iconografía y texto según el tipo de artículo
        const esMix = tipoArticulo === 'mix';
        const icono = esMix ? '🧪' : '📦';
        const tipoBadge = esMix ? 'MIX' : 'Simple';
        
        // Para MIX, omitir las columnas de stock anterior y nuevo
        const columnasStock = esMix ? 
          '<td colspan="2" class="mix-info">Artículo compuesto</td>' : 
          '<td class="stock-anterior">-</td><td class="stock-nuevo">-</td>';

        html += `
          <tr data-tipo="backend" data-articulo-tipo="${tipoArticulo}" data-ingreso-id="${ingreso.id}">
            <td>
              ${icono} ${nombreArticulo} 
              <span class="tipo-badge tipo-${tipoArticulo}">${tipoBadge}</span>
            </td>
            <td>1</td>
            <td>${kilos.toFixed(2)}</td>
            ${columnasStock}
            <td>${fecha}</td>
            <td>
              <button class="btn-eliminar-ingreso" onclick="eliminarIngresoManual('${ingresoId}')">
                Eliminar
              </button>
              <button class="btn-imprimir-etiqueta-ingrediente" 
                      onclick="imprimirEtiquetaIngredienteDesdeIngreso('${ingreso.ingrediente_id}', '${(ingreso.ingrediente_nombre || nombreArticulo).replace(/'/g, "\\'")}', '${ingreso.articulo_numero}')"
                      title="Imprimir etiqueta del ingrediente">
                🏷️ Etiqueta
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
    } else if (tipo === 'db') {
      console.log('🗑️ Eliminando ingreso de base de datos físicamente');
      
      // Obtener información del ingreso para determinar el tipo de eliminación
      const carroId = localStorage.getItem('carroActivo');
      const ingresoIdReal = id;
      
      // Primero obtener los datos del ingreso para saber si es MIX o simple
      const ingresosResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingresos-manuales`);
      if (!ingresosResponse.ok) {
        throw new Error('Error al obtener información del ingreso');
      }
      
      const ingresos = await ingresosResponse.json();
      const ingresoAEliminar = ingresos.find(ing => ing.id.toString() === ingresoIdReal);
      
      if (!ingresoAEliminar) {
        throw new Error('Ingreso no encontrado');
      }
      
      const esMix = ingresoAEliminar.tipo_articulo === 'mix';
      console.log(`🔍 Tipo de artículo a eliminar: ${esMix ? 'MIX' : 'Simple'}`);
      
      if (esMix) {
        // Para MIX: eliminar de stock_ventas_movimientos y registros relacionados en ingredientes_stock_usuarios
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
        // Para ingredientes simples: usar el endpoint existente
        console.log('📦 Eliminando ingrediente simple...');
        console.log(`🌐 URL del endpoint: http://localhost:3002/api/produccion/carro/${carroId}/ingreso-manual/${ingresoIdReal}`);
        console.log(`📋 Método: DELETE`);
        console.log(`🆔 Carro ID: ${carroId}`);
        console.log(`🆔 Ingreso ID Real: ${ingresoIdReal}`);
        
        console.log('🚀 ENVIANDO REQUEST DELETE AL BACKEND...');
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingreso-manual/${ingresoIdReal}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        console.log(`📡 Respuesta recibida del servidor:`);
        console.log(`- Status: ${response.status}`);
        console.log(`- Status Text: ${response.statusText}`);
        console.log(`- OK: ${response.ok}`);

        if (!response.ok) {
          console.error('❌ ERROR EN RESPUESTA DEL SERVIDOR');
          const errorData = await response.json();
          console.error('📋 Datos del error:', errorData);
          throw new Error(`Error al eliminar ingreso: ${errorData.error || 'Error desconocido'}`);
        }

        const result = await response.json();
        console.log('✅ RESPUESTA EXITOSA DEL SERVIDOR:', result);
        console.log('🎯 Eliminación completada en el backend');
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
      const carroId = localStorage.getItem('carroActivo');
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
  const carroId = localStorage.getItem('carroActivo');
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
    console.log('📋 Datos recibidos:', {
      ingredienteId,
      ingredienteNombre,
      articuloNumero
    });

    // Validar datos de entrada
    if (!ingredienteNombre || !articuloNumero) {
      throw new Error('Faltan datos necesarios para imprimir la etiqueta');
    }

    console.log('📡 Enviando solicitud al servidor de etiquetas...');

    // Llamar al endpoint de impresión de etiquetas de ingredientes
    const response = await fetch('http://localhost:3000/api/etiquetas/ingrediente', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        nombre: ingredienteNombre,
        codigo: articuloNumero // Usar el código del artículo como código de barras
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
    alert(`✅ Etiqueta del ingrediente "${ingredienteNombre}" enviada a imprimir correctamente`);
    
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

// Hacer funciones disponibles globalmente
window.eliminarIngresoManual = eliminarIngresoManual;
window.actualizarInformeIngresosManuales = actualizarInformeIngresosManuales;
window.abrirModalIngresoManual = abrirModalIngresoManual;
window.imprimirEtiquetaIngredienteDesdeIngreso = imprimirEtiquetaIngredienteDesdeIngreso;
