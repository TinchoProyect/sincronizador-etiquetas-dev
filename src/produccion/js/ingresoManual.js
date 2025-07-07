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
        tipo: 'ingreso a producción',
        origenIngreso: esIngredienteCompuesto ? 'mix' : 'simple'
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

// Función para actualizar el informe visual de ingresos manuales
async function actualizarInformeIngresosManuales() {
  try {
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

    // Obtener ingresos manuales desde el backend
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
        
        // Log de depuración: mostrar datos del backend
        console.log('\n📊 INGRESOS DEL BACKEND:');
        console.table(ingresosDelBackend.map(ing => ({
          articulo_nombre: ing.articulo_nombre || 'Sin nombre',
          tipo_articulo: ing.tipo_articulo,
          fuente_datos: ing.fuente_datos,
          kilos: ing.kilos,
          carro_id: ing.carro_id
        })));
      }
    } catch (error) {
      console.warn('⚠️ Error al obtener ingresos del backend:', error);
    }

    // Filtrar ingresos en memoria del carro actual que NO estén ya persistidos
    const ingresosEnMemoria = ingresosManualesDelCarro.filter(ingreso => {
      // Solo incluir si es del carro actual
      if (ingreso.carroId.toString() !== carroId) return false;
      
      // Verificar si ya existe en el backend (por artículo y fecha aproximada)
      const existeEnBackend = ingresosDelBackend.some(backendIngreso => {
        const mismoArticulo = backendIngreso.articulo_numero === ingreso.articuloNumero;
        const kilosSimilares = Math.abs((parseFloat(backendIngreso.kilos) || 0) - (parseFloat(ingreso.kilosTotales) || 0)) < 0.01;
        return mismoArticulo && kilosSimilares;
      });
      
      return !existeEnBackend; // Solo incluir si NO existe en backend
    });

    // Log de depuración: mostrar datos en memoria
    if (ingresosEnMemoria.length > 0) {
      console.log('\n💾 INGRESOS EN MEMORIA:');
      console.table(ingresosEnMemoria.map(ing => ({
        articuloNombre: ing.articuloNombre || 'Sin nombre',
        tipoArticulo: 'simple',
        fuente_datos: 'memoria',
        kilosTotales: ing.kilosTotales,
        carroId: ing.carroId
      })));
    }

    // Combinar: priorizar backend, luego memoria sin duplicados
    const todosLosIngresos = [...ingresosDelBackend, ...ingresosEnMemoria];

    // Filtrar duplicados basados en combinación de campos clave
    const ingresosUnicosMap = new Map();
    todosLosIngresos.forEach(ing => {
      const key = `${ing.articulo_numero || ing.articuloNumero}-${ing.kilos || ing.kilosTotales}-${ing.fecha || ing.fechaIngreso}-${ing.fuente_datos || ing.fuenteDatos}`;
      if (!ingresosUnicosMap.has(key)) {
        ingresosUnicosMap.set(key, ing);
      }
    });
    const ingresosUnicos = Array.from(ingresosUnicosMap.values());

    // Log de depuración: mostrar combinación final sin duplicados
    console.log('\n🔄 COMBINACIÓN FINAL SIN DUPLICADOS:');
    console.table(ingresosUnicos.map(ing => ({
      articulo_nombre: ing.articulo_nombre || ing.articuloNombre || 'Sin nombre',
      tipo_articulo: ing.tipo_articulo || 'simple',
      fuente_datos: ing.fuente_datos || 'memoria',
      kilos: ing.kilos || ing.kilosTotales,
      carro_id: ing.carro_id || ing.carroId
    })));

    if (ingresosUnicos.length === 0) {
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

    ingresosUnicos.forEach(ingreso => {
      try {
        // Determinar si es un ingreso del backend o en memoria
        const esIngresoBackend = ingreso.hasOwnProperty('articulo_nombre') || ingreso.hasOwnProperty('ingrediente_nombre');
        
        let kilos, nombreArticulo, fecha, ingresoId, tipoIngreso, tipoArticulo;
        
        if (esIngresoBackend) {
          // Ingreso del backend
          kilos = parseFloat(ingreso.kilos) || 0;
          nombreArticulo = ingreso.articulo_nombre || ingreso.ingrediente_nombre || 'Sin nombre';
          try {
            fecha = ingreso.fecha ? new Date(ingreso.fecha).toLocaleString() : '-';
          } catch (e) {
            fecha = '-';
          }
          ingresoId = `db_${ingreso.id || 0}`;
          tipoIngreso = 'backend';
          tipoArticulo = ingreso.tipo_articulo || 'simple'; // Usar el campo del backend
        } else {
          // Ingreso en memoria
          kilos = parseFloat(ingreso.kilosTotales) || 0;
          nombreArticulo = ingreso.articuloNombre || 'Sin nombre';
          fecha = ingreso.fechaIngreso || '-';
          ingresoId = `mem_${ingreso.id || 0}`;
          tipoIngreso = 'memoria';
          tipoArticulo = 'simple'; // Los ingresos en memoria son siempre simples
        }

        // Determinar iconografía y texto según el tipo de artículo
        const esMix = tipoArticulo === 'mix';
        const icono = esMix ? '🧪' : '📦';
        const tipoBadge = esMix ? 'MIX' : 'Simple';
        
        // Para MIX, omitir las columnas de stock anterior y nuevo
        const columnasStock = esMix ? 
          '<td colspan="2" class="mix-info">Artículo compuesto</td>' : 
          '<td class="stock-anterior">-</td><td class="stock-nuevo">-</td>';

        html += `
          <tr data-tipo="${tipoIngreso}" data-articulo-tipo="${tipoArticulo}">
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
            </td>
          </tr>
        `;
      } catch (err) {
        console.warn('Error al procesar ingreso:', err, ingreso);
      }
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

        const result = await response.json();
        console.log('✅ Respuesta del servidor:', result);
      }
      
    } else {
      console.warn('⚠️ Tipo de ingreso inválido:', tipo);
      await actualizarInformeIngresosManuales();
      return;
    }

    // Actualizar la UI inmediatamente después de la eliminación exitosa
    console.log('🔄 Actualizando UI después de eliminación exitosa...');
    await actualizarInformeIngresosManuales();
    
  } catch (error) {
    console.error('❌ Error al eliminar ingreso manual:', error);
    
    // Si hay error, al menos actualizar la UI para reflejar el estado real
    try {
      await actualizarInformeIngresosManuales();
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

// Hacer funciones disponibles globalmente
window.eliminarIngresoManual = eliminarIngresoManual;
window.actualizarInformeIngresosManuales = actualizarInformeIngresosManuales;
window.abrirModalIngresoManual = abrirModalIngresoManual;
