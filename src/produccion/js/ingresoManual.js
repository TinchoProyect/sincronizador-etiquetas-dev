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
  modal = document.getElementById('modalIngresoManual');
  inputBusqueda = document.getElementById('busquedaArticulo');
  listaResultados = document.getElementById('listaArticulos');
  inputKilos = document.getElementById('inputKilos');
  inputCantidad = document.getElementById('inputCantidad');
  btnConfirmar = document.getElementById('btnConfirmarIngreso');
  btnCancelar = document.getElementById('btnCancelarIngreso');
  nombreIngredienteDisplay = modal.querySelector('.nombre-ingrediente');

  if (!modal) {
    console.error('❌ No se encontró el modal con id "modalIngresoManual"');
    return;
  }

  inputBusqueda.addEventListener('input', manejarBusqueda);
  btnConfirmar.addEventListener('click', confirmarIngreso);
  btnCancelar.addEventListener('click', cerrarModal);

  window.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModal();
  });
}

function limpiarCamposModal() {
  inputBusqueda.value = '';
  inputKilos.value = '';
  inputCantidad.value = '1'; // Restablecer a valor por defecto
  listaResultados.innerHTML = '';
  articuloSeleccionado = null;
  if (nombreIngredienteDisplay) nombreIngredienteDisplay.textContent = '';
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
        // Mostrar nombre del artículo y stock disponible
        const stockDisplay = art.stock_consolidado !== undefined ? art.stock_consolidado : 0;
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

  if (!carroIdGlobal || !usuarioId) {
    alert('No hay carro o usuario válido disponible.');
    return;
  }

  if (!articuloSeleccionado.numero) {
    alert('Error interno: no se seleccionó un artículo válido.');
    return;
  }

  console.log('🔍 Artículo seleccionado:', articuloSeleccionado);

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
        tipo: 'ingreso a producción'
      };

      await registrarMovimientoStockVentas(movimientoStock);
      
    } else {
      console.log('🏭 PROCESANDO INGRESO MANUAL EN CARRO INTERNO');
      
      // Para carros internos, usar el flujo original
      const movimientoIngrediente = {
        ingredienteId: ingredienteSeleccionado,
        articuloNumero: articuloSeleccionado.numero,
        kilos: kilos * cantidad, // Multiplicar por cantidad
        carroId: parseInt(carroIdGlobal),
        usuarioId: parseInt(usuarioId)
      };

      const movimientoStock = {
        articuloNumero: articuloSeleccionado.numero,
        codigoBarras: articuloSeleccionado.codigo_barras,
        kilos: -kilos, // Kilos por unidad (sin multiplicar)
        carroId: parseInt(carroIdGlobal),
        usuarioId: parseInt(usuarioId),
        cantidad: cantidad, // Cantidad de unidades
        tipo: 'ingreso a producción'
      };

      console.log('📦 Guardando ingreso manual:', movimientoIngrediente);
      
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

    // Actualizar el informe de ingresos manuales
    await actualizarInformeIngresosManuales();

    alert('Ingreso registrado correctamente');
    cerrarModal();
    // Actualizar el resumen de ingredientes para reflejar el nuevo stock
    actualizarResumenIngredientes();
    
  } catch (error) {
    console.error('❌ Error al registrar ingreso:', error);
    alert('Hubo un error al registrar el ingreso: ' + error.message);
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
    
    console.log('✅ Ingreso registrado en informe local');
  } catch (error) {
    console.error('❌ Error al registrar ingreso en informe:', error);
  }
}

// Función para actualizar el informe visual de ingresos manuales
async function actualizarInformeIngresosManuales() {
  try {
    const contenedor = document.getElementById('tabla-ingresos-manuales');
    if (!contenedor) {
      console.warn('⚠️ No se encontró el contenedor del informe de ingresos manuales');
      return;
    }

    // Filtrar ingresos del carro actual
    const carroId = localStorage.getItem('carroActivo');
    console.log('🔍 DEBUG - Filtrando ingresos para carro:', carroId);
    console.log('🔍 DEBUG - Ingresos totales:', ingresosManualesDelCarro);
    
    const ingresosDelCarroActual = ingresosManualesDelCarro.filter(ingreso => {
      console.log('🔍 Comparando:', {
        ingresoCarroId: ingreso.carroId,
        carroActivo: carroId,
        sonIguales: ingreso.carroId.toString() === carroId
      });
      return ingreso.carroId.toString() === carroId;
    });
    
    console.log('🔍 DEBUG - Ingresos filtrados:', ingresosDelCarroActual);

    if (ingresosDelCarroActual.length === 0) {
      contenedor.innerHTML = '<p>No se han realizado ingresos manuales en este carro</p>';
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

    ingresosDelCarroActual.forEach(ingreso => {
      html += `
        <tr>
          <td>${ingreso.articuloNombre}</td>
          <td>${ingreso.cantidadUnidades}</td>
          <td>${ingreso.kilosTotales.toFixed(2)}</td>
          <td class="stock-anterior">${ingreso.stockAnterior.toFixed(2)}</td>
          <td class="stock-nuevo">${ingreso.stockNuevo.toFixed(2)}</td>
          <td>${ingreso.fechaIngreso}</td>
          <td>
            <button class="btn-eliminar-ingreso" onclick="eliminarIngresoManual('${ingreso.id}')">
              Eliminar
            </button>
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    contenedor.innerHTML = html;
    console.log('✅ Informe de ingresos manuales actualizado');
  } catch (error) {
    console.error('❌ Error al actualizar informe de ingresos manuales:', error);
  }
}

// Función para eliminar un ingreso manual
async function eliminarIngresoManual(ingresoId) {
  try {
    if (!confirm('¿Estás seguro de que querés eliminar este ingreso manual? Esta acción no se puede deshacer.')) {
      return;
    }

    console.log('🗑️ Eliminando ingreso manual:', ingresoId);

    // Encontrar el ingreso en el array
    const ingresoIndex = ingresosManualesDelCarro.findIndex(ingreso => ingreso.id.toString() === ingresoId.toString());
    
    if (ingresoIndex === -1) {
      throw new Error('Ingreso no encontrado');
    }

    const ingreso = ingresosManualesDelCarro[ingresoIndex];
    const carroId = ingreso.carroId;
    const articuloNumero = ingreso.articuloNumero;
    const kilos = ingreso.kilosTotales;
    const cantidad = ingreso.cantidadUnidades;

    // Revertir movimientos en las tablas
    try {
      // Obtener datos del usuario actual
      const usuarioData = localStorage.getItem('colaboradorActivo');
      const usuarioId = usuarioData ? JSON.parse(usuarioData).id : null;

      if (!usuarioId) {
        throw new Error('No hay usuario activo para revertir el movimiento');
      }

      // 1. Revertir movimiento en stock_ventas_movimientos
      const movimientoStock = {
        articuloNumero: articuloNumero,
        codigoBarras: ingreso.codigoBarras || '', // Usar el código de barras guardado en el registro
        kilos: kilos, // Kilos positivos para revertir
        carroId: parseInt(carroId),
        usuarioId: parseInt(usuarioId),
        cantidad: cantidad,
        tipo: 'reversion_ingreso_manual'
      };
      await registrarMovimientoStockVentas(movimientoStock);

      // 2. Revertir movimiento en ingredientes_movimientos
      const movimientoIngrediente = {
        ingredienteId: ingreso.ingredienteId, // Usar el ID guardado en el registro
        articuloNumero: articuloNumero,
        kilos: -kilos, // Kilos negativos para revertir
        carroId: parseInt(carroId)
      };
      await registrarMovimientoIngrediente(movimientoIngrediente);

    // Eliminar del array local
    ingresosManualesDelCarro.splice(ingresoIndex, 1);
    console.log('🔍 DEBUG - Array ingresosManualesDelCarro después de eliminar:', ingresosManualesDelCarro);

    // Actualizar el informe visual
    await actualizarInformeIngresosManuales();
    
    // Actualizar el resumen de ingredientes
    await actualizarResumenIngredientes();

    console.log('✅ Ingreso manual y movimientos relacionados eliminados correctamente');
    alert('Ingreso eliminado correctamente');
    } catch (dbError) {
      console.error('❌ Error al revertir movimientos:', dbError);
      throw new Error('No se pudieron revertir los movimientos de stock');
    }

  } catch (error) {
    console.error('❌ Error al eliminar ingreso manual:', error);
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

// Hacer funciones disponibles globalmente
window.eliminarIngresoManual = eliminarIngresoManual;
window.actualizarInformeIngresosManuales = actualizarInformeIngresosManuales;
window.abrirModalIngresoManual = abrirModalIngresoManual;
