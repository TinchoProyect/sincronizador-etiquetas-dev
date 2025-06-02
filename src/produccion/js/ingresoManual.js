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

let ingredienteSeleccionado = null;
let articuloSeleccionado = null;
let carroIdGlobal = null;

// ⚠️ Asegurate que en el HTML el modal tenga id="modalIngresoManual"
export function abrirModalIngresoManual(ingredienteId, carroId) {
  console.log('✔️ Función abrirModalIngresoManual ejecutada');
  ingredienteSeleccionado = ingredienteId;
  carroIdGlobal = carroId;

  if (!modal) inicializarModal();

  limpiarCamposModal();

  modal.classList.add('show');
}

function inicializarModal() {
  modal = document.getElementById('modalIngresoManual');
  inputBusqueda = document.getElementById('busquedaArticulo');
  listaResultados = document.getElementById('listaArticulos');
  inputKilos = document.getElementById('inputKilos');
  btnConfirmar = document.getElementById('btnConfirmarIngreso');
  btnCancelar = document.getElementById('btnCancelarIngreso');

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

  const movimiento = {
    ingredienteId: ingredienteSeleccionado,
    articuloId: articuloSeleccionado.id,
    kilos,
    carroId: carroIdGlobal
  };

  console.log('📦 Guardando ingreso manual:', movimiento);

  registrarMovimientoIngrediente(movimiento)
    .then(() => registrarMovimientoStockVentas(movimiento))
    .then(() => {
      alert('Ingreso registrado correctamente');
      cerrarModal();
    })
    .catch(error => {
      console.error('❌ Error al registrar ingreso:', error);
      alert('Hubo un error al registrar el ingreso');
    });
}

// ✅ Asegura disponibilidad global para el botón onclick
window.abrirModalIngresoManual = abrirModalIngresoManual;
