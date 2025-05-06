// Elementos del modal
const openModalBtn = document.getElementById('openModalBtn');
const printModal = document.getElementById('printModal');
const closeModalBtn = document.querySelector('.close-modal');

// Elementos de la interfaz principal
const searchInput = document.getElementById('search');
const barcodeInput = document.getElementById('barcodeInput');
const articulosTableBody = document.querySelector('#articulosTable tbody');
const preview = document.getElementById('preview');
const previewNumero = document.getElementById('previewNumero');
const previewNombre = document.getElementById('previewNombre');
const previewCodigoBarras = document.getElementById('previewCodigoBarras');
const cantidadInput = document.getElementById('cantidad');
const printBtn = document.getElementById('printBtn');

// Elementos de fechas
const incluirFechasCheck = document.getElementById('incluirFechas');
const fechasGroup = document.getElementById('fechasGroup');
const fechaElaboracionInput = document.getElementById('fechaElaboracion');
const fechaVencimientoInput = document.getElementById('fechaVencimiento');

// Elementos de la etiqueta personalizada
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');
const textoPrincipalInput = document.getElementById('textoPrincipal');
const textoSecundarioInput = document.getElementById('textoSecundario');
const textoAdicionalInput = document.getElementById('textoAdicional');
const cantidadPersonalizadaInput = document.getElementById('cantidadPersonalizada');
const printBtnPersonalizado = document.getElementById('printBtnPersonalizado');

let articulos = [];
let articuloSeleccionado = null;

// Funciones del modal
function openModal() {
  printModal.classList.add('show');
  // Recargar artículos al abrir el modal
  cargarArticulos();
}

function closeModal() {
  printModal.classList.remove('show');
  // Limpiar selección al cerrar
  articuloSeleccionado = null;
  preview.style.display = 'none';
}

// Cerrar modal al hacer clic fuera del contenido
window.onclick = function(event) {
  if (event.target === printModal) {
    closeModal();
  }
}

async function cargarArticulos() {
  try {
    const res = await fetch('/api/articulos');
    articulos = await res.json();
    mostrarArticulos(articulos);
  } catch (error) {
    console.error('Error al cargar artículos:', error);
  }
}

function mostrarArticulos(lista) {
  articulosTableBody.innerHTML = '';
  lista.forEach(art => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${art.numero}</td>
      <td>${art.nombre}</td>
      <td>${art.codigo_barras}</td>
    `;
    tr.addEventListener('click', () => {
      seleccionarArticulo(art);
    });
    articulosTableBody.appendChild(tr);
  });
}

function filtrarArticulos() {
  const texto = searchInput.value.toLowerCase();
  const filtrados = articulos.filter(art =>
    art.numero.toLowerCase().includes(texto) ||
    art.nombre.toLowerCase().includes(texto)
  );
  mostrarArticulos(filtrados);
}

function seleccionarArticulo(art) {
  articuloSeleccionado = art;
  previewNumero.textContent = art.numero;
  previewNombre.textContent = art.nombre;
  previewCodigoBarras.textContent = art.codigo_barras;
  cantidadInput.value = 2;
  preview.style.display = 'block';
}

function manejarEscaneo() {
  const codigo = barcodeInput.value.trim();
  if (!codigo) return;
  const encontrado = articulos.find(art => art.codigo_barras === codigo);
  if (encontrado) {
    seleccionarArticulo(encontrado);
    barcodeInput.value = '';
    // Abrir el modal si se encuentra un artículo por escaneo
    openModal();
  }
}

function redondearPar(num) {
  const n = parseInt(num, 10);
  if (isNaN(n) || n < 2) return 2;
  return n % 2 === 0 ? n : n + 1;
}

// Función para formatear fecha como DD/MM/YYYY
function formatearFecha(fecha) {
  const d = fecha ? new Date(fecha) : new Date();
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const año = d.getFullYear();
  return `${dia}/${mes}/${año}`;
}

// Función para calcular fecha de vencimiento por defecto (8 meses desde hoy)
function calcularFechaVencimiento() {
  const fecha = new Date();
  fecha.setMonth(fecha.getMonth() + 8);
  return fecha.toISOString().split('T')[0]; // Formato YYYY-MM-DD para input type="date"
}

// Inicializar fechas
function inicializarFechas() {
  fechaElaboracionInput.value = formatearFecha();
  fechaVencimientoInput.value = calcularFechaVencimiento();
}

// Manejador del checkbox de fechas
incluirFechasCheck.addEventListener('change', () => {
  fechasGroup.style.display = incluirFechasCheck.checked ? 'block' : 'none';
  if (incluirFechasCheck.checked) {
    inicializarFechas();
  }
});

async function imprimir() {
  if (!articuloSeleccionado) {
    alert('Seleccione un artículo para imprimir.');
    return;
  }
  const cantidad = redondearPar(cantidadInput.value);
  
  // Preparar datos de impresión
  let datosImpresion = {
    ...articuloSeleccionado // Expandir directamente el artículo seleccionado
  };

  // Agregar fechas solo si el checkbox está marcado
  if (incluirFechasCheck.checked) {
    datosImpresion = {
      ...datosImpresion,
      fechas: {
        elaboracion: formatearFecha(), // Fecha actual formateada
        vencimiento: formatearFecha(fechaVencimientoInput.value)
      }
    };
  }

  try {
    const res = await fetch('/api/imprimir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...datosImpresion,
        cantidad
      }),
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      closeModal(); // Cerrar el modal después de imprimir exitosamente
    } else {
      alert('Error al imprimir: ' + data.error);
    }
  } catch (error) {
    alert('Error al imprimir: ' + error.message);
  }
}

// Manejador de pestañas
tabButtons.forEach(button => {
  button.addEventListener('click', () => {
    // Remover clase active de todos los botones y contenidos
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    
    // Agregar clase active al botón clickeado y su contenido correspondiente
    button.classList.add('active');
    const tabId = button.getAttribute('data-tab');
    document.getElementById(tabId).classList.add('active');
  });
});

// Función para imprimir etiqueta personalizada
async function imprimirEtiquetaPersonalizada() {
  const textoPrincipal = textoPrincipalInput.value.trim();
  if (!textoPrincipal) {
    alert('El texto principal es obligatorio.');
    return;
  }

  const datos = {
    textoPrincipal,
    textoSecundario: textoSecundarioInput.value.trim(),
    textoAdicional: textoAdicionalInput.value.trim()
  };

  const cantidad = parseInt(cantidadPersonalizadaInput.value, 10);

  try {
    const res = await fetch('/api/imprimir-personalizada', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datos, cantidad }),
    });
    
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      closeModal(); // Cerrar el modal después de imprimir exitosamente
    } else {
      alert('Error al imprimir: ' + data.error);
    }
  } catch (error) {
    alert('Error al imprimir: ' + error.message);
  }
}

// Event listeners
openModalBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);
searchInput.addEventListener('input', filtrarArticulos);
barcodeInput.addEventListener('change', manejarEscaneo);
printBtn.addEventListener('click', imprimir);
printBtnPersonalizado.addEventListener('click', imprimirEtiquetaPersonalizada);

// Cargar artículos al inicio
cargarArticulos();
