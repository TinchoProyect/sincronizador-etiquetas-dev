import {
  registrarMovimientoIngrediente,
  registrarMovimientoStockVentas
} from './apiMovimientos.js';

let modal = null;
let inputBusqueda = null;
let listaResultados = null;
let inputKilos = null;
let btnConfirmar = null;
let btnCancelar = null;
let nombreIngredienteDisplay = null;

let ingredienteSeleccionado = null;
let articuloSeleccionado = null;
let carroIdGlobal = null;

export function abrirModalIngresoManual(ingredienteId, carroId) {
  console.log('✔️ Función abrirModalIngresoManual ejecutada');
  ingredienteSeleccionado = ingredienteId;
  carroIdGlobal = carroId;

  if (!modal) inicializarModal();
  limpiarCamposModal();

  obtenerIngrediente(ingredienteId)
    .then(ingrediente => {
      if (nombreIngredienteDisplay) {
        nombreIngredienteDisplay.textContent = ingrediente.nombre || 'Ingrediente sin nombre';
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

  fetch('/api/produccion/articulos')
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
        li.textContent = `${art.nombre} - ${art.codigo_barras || ''}`;
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

function confirmarIngreso() {
  if (!articuloSeleccionado || !inputKilos.value) {
    alert('Seleccioná un artículo y completá los kilos.');
    return;
  }

  const kilos = parseFloat(inputKilos.value);
  if (isNaN(kilos) || kilos <= 0) {
    alert('Ingresá una cantidad válida de kilos.');
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

  console.log('🔍 artículoSeleccionado:', articuloSeleccionado);

  const movimientoIngrediente = {
    ingredienteId: ingredienteSeleccionado,
    articuloNumero: articuloSeleccionado.numero,
    kilos,
    carroId: parseInt(carroIdGlobal)
  };

  const movimientoStock = {
    articuloNumero: articuloSeleccionado.numero,
    codigoBarras: articuloSeleccionado.codigo_barras,
    kilos: -kilos,
    carroId: parseInt(carroIdGlobal),
    usuarioId: parseInt(usuarioId)
  };

  console.log('📦 Guardando ingreso manual:', movimientoIngrediente);
  console.log('✅ movimientoIngrediente (detalle):', JSON.stringify(movimientoIngrediente, null, 2));

  registrarMovimientoIngrediente(movimientoIngrediente)
    .then(() => registrarMovimientoStockVentas(movimientoStock))
    .then(() => {
      alert('Ingreso registrado correctamente');
      cerrarModal();
    })
    .catch(error => {
      console.error('❌ Error al registrar ingreso:', error);
      alert('Hubo un error al registrar el ingreso');
    });
}

function obtenerIngrediente(id) {
  return fetch(`/api/produccion/ingredientes/${id}`)
    .then(res => {
      if (!res.ok) throw new Error('No se pudo obtener el ingrediente');
      return res.json();
    });
}

window.abrirModalIngresoManual = abrirModalIngresoManual;