import {
  registrarMovimientoIngrediente,
  registrarMovimientoStockVentas
} from './apiMovimientos.js';
import { actualizarResumenIngredientes } from './carro.js';

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

window.abrirModalIngresoManual = abrirModalIngresoManual;
