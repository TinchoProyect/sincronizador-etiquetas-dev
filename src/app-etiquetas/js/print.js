import { modal } from './modal.js';

class PrintManager {
  constructor() {
    this.initializeElements();
    this.setupEventListeners();
    this.articulos = [];
    this.articuloSeleccionado = null;
    this.cargarArticulos();
  }

  initializeElements() {
    // Elementos de filtros de texto
    this.filtro1 = document.getElementById('filtro1');
    this.filtro2 = document.getElementById('filtro2');
    this.filtro3 = document.getElementById('filtro3');
    this.barcodeInput = document.getElementById('barcodeInput');
    
    // Elementos de la tabla
    this.articulosTableBody = document.querySelector('#articulosTable tbody');
    
    // Elementos de fechas
    this.incluirFechasCheck = document.getElementById('incluirFechas');
    this.fechasGroup = document.getElementById('fechasGroup');
    this.fechaElaboracionInput = document.getElementById('fechaElaboracion');
    this.fechaVencimientoInput = document.getElementById('fechaVencimiento');
    
    // Elementos de impresión
    this.cantidadInput = document.getElementById('cantidad');
    this.printBtn = document.getElementById('printBtn');
    
    // Elementos de etiqueta personalizada
    this.etLamdaBtn = document.getElementById('etLamdaBtn');
    this.textoPrincipalInput = document.getElementById('textoPrincipal');
    this.textoSecundarioInput = document.getElementById('textoSecundario');
    this.textoAdicionalInput = document.getElementById('textoAdicional');
    this.cantidadPersonalizadaInput = document.getElementById('cantidadPersonalizada');
    this.printBtnPersonalizado = document.getElementById('printBtnPersonalizado');

    // Pestañas
    this.tabButtons = document.querySelectorAll('.tab-button');
    this.tabContents = document.querySelectorAll('.tab-content');
  }

  setupEventListeners() {
    // Eventos de filtros de texto
    this.filtro1.addEventListener('input', () => this.manejarFiltro1());
    this.filtro2.addEventListener('input', () => this.manejarFiltro2());
    this.filtro3.addEventListener('input', () => this.manejarFiltro3());
    
    // Evento de código de barras
    this.barcodeInput.addEventListener('input', () => this.manejarEscaneo());
    
    // Eventos de impresión
    this.printBtn.addEventListener('click', () => this.imprimir());
    this.printBtnPersonalizado.addEventListener('click', () => this.imprimirEtiquetaPersonalizada());
    
    // Evento de plantilla ET-LAMDA
    this.etLamdaBtn.addEventListener('click', () => this.aplicarPlantillaLamda());
    
    // Evento de fechas
    this.incluirFechasCheck.addEventListener('change', () => {
      this.fechasGroup.style.display = this.incluirFechasCheck.checked ? 'block' : 'none';
      if (this.incluirFechasCheck.checked) {
        this.inicializarFechas();
      }
    });

    // Manejo de pestañas
    this.tabButtons.forEach(button => {
      button.addEventListener('click', () => this.cambiarPestana(button));
    });
  }

  async cargarArticulos() {
    try {
      const res = await fetch('../api/articulos');
      this.articulos = await res.json();
      this.mostrarArticulos(this.articulos);
    } catch (error) {
      console.error('Error al cargar artículos:', error);
    }
  }

  mostrarArticulos(lista) {
    this.articulosTableBody.innerHTML = '';
    lista.forEach(art => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${art.numero}</td>
        <td>${art.nombre}</td>
        <td>${art.codigo_barras}</td>
      `;
      tr.addEventListener('click', () => this.seleccionarArticulo(art));
      this.articulosTableBody.appendChild(tr);
    });
  }

  // Funciones de filtrado
  filtrarArticulos(texto, listaArticulos) {
    return listaArticulos.filter(art =>
      art.numero.toLowerCase().includes(texto.toLowerCase()) ||
      art.nombre.toLowerCase().includes(texto.toLowerCase())
    );
  }

  manejarFiltro1() {
    // Resetear filtros 2 y 3
    this.filtro2.value = '';
    this.filtro3.value = '';
    this.filtro2.disabled = true;
    this.filtro3.disabled = true;
    
    // Resetear código de barras
    this.barcodeInput.value = '';
    
    const texto = this.filtro1.value;
    if (texto) {
      const filtrados = this.filtrarArticulos(texto, this.articulos);
      this.mostrarArticulos(filtrados);
      // Habilitar filtro2 solo si hay resultados
      this.filtro2.disabled = filtrados.length === 0;
    } else {
      this.mostrarArticulos(this.articulos);
    }
  }

  manejarFiltro2() {
    // Resetear filtro 3
    this.filtro3.value = '';
    this.filtro3.disabled = true;
    
    const texto1 = this.filtro1.value;
    const texto2 = this.filtro2.value;
    
    if (texto2) {
      const primerFiltro = this.filtrarArticulos(texto1, this.articulos);
      const segundoFiltro = this.filtrarArticulos(texto2, primerFiltro);
      this.mostrarArticulos(segundoFiltro);
      // Habilitar filtro3 solo si hay resultados
      this.filtro3.disabled = segundoFiltro.length === 0;
    } else {
      const primerFiltro = this.filtrarArticulos(texto1, this.articulos);
      this.mostrarArticulos(primerFiltro);
    }
  }

  manejarFiltro3() {
    const texto1 = this.filtro1.value;
    const texto2 = this.filtro2.value;
    const texto3 = this.filtro3.value;
    
    if (texto3) {
      const primerFiltro = this.filtrarArticulos(texto1, this.articulos);
      const segundoFiltro = this.filtrarArticulos(texto2, primerFiltro);
      const tercerFiltro = this.filtrarArticulos(texto3, segundoFiltro);
      this.mostrarArticulos(tercerFiltro);
    } else {
      const primerFiltro = this.filtrarArticulos(texto1, this.articulos);
      const segundoFiltro = this.filtrarArticulos(texto2, primerFiltro);
      this.mostrarArticulos(segundoFiltro);
    }
  }

  seleccionarArticulo(art) {
    this.articuloSeleccionado = art;
    modal.updatePreview(art);
    modal.open();
  }

  manejarEscaneo() {
    // Resetear filtros de texto
    this.filtro1.value = '';
    this.filtro2.value = '';
    this.filtro3.value = '';
    this.filtro2.disabled = true;
    this.filtro3.disabled = true;

    const codigo = this.barcodeInput.value.trim();
    if (!codigo) {
      this.mostrarArticulos(this.articulos);
      return;
    }
    
    const encontrado = this.articulos.find(art => art.codigo_barras === codigo);
    if (encontrado) {
      this.seleccionarArticulo(encontrado);
      this.barcodeInput.value = '';
    }
  }

  cambiarPestana(selectedButton) {
    this.tabButtons.forEach(button => button.classList.remove('active'));
    this.tabContents.forEach(content => content.classList.remove('active'));
    
    selectedButton.classList.add('active');
    const tabId = selectedButton.getAttribute('data-tab');
    document.getElementById(tabId).classList.add('active');
  }

  redondearPar(num) {
    const n = parseInt(num, 10);
    if (isNaN(n) || n < 2) return 2;
    return n % 2 === 0 ? n : n + 1;
  }

  formatearFecha(fecha) {
    const d = fecha ? new Date(fecha) : new Date();
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const año = d.getFullYear();
    return `${dia}/${mes}/${año}`;
  }

  calcularFechaVencimiento() {
    const fecha = new Date();
    fecha.setMonth(fecha.getMonth() + 8);
    return fecha.toISOString().split('T')[0];
  }

  inicializarFechas() {
    this.fechaElaboracionInput.value = this.formatearFecha();
    this.fechaVencimientoInput.value = this.calcularFechaVencimiento();
  }

  async imprimir() {
    if (!this.articuloSeleccionado) {
      alert('Seleccione un artículo para imprimir.');
      return;
    }

    const cantidad = this.redondearPar(this.cantidadInput.value);
    let datosImpresion = {
      ...this.articuloSeleccionado
    };

    if (this.incluirFechasCheck.checked) {
      datosImpresion = {
        ...datosImpresion,
        fechas: {
          elaboracion: this.formatearFecha(),
          vencimiento: this.formatearFecha(this.fechaVencimientoInput.value)
        }
      };
    }

    try {
      const res = await fetch('../api/imprimir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...datosImpresion,
          cantidad
        }),
      });
      
      const data = await res.json();
      if (res.ok) {
        // Mostrar mensaje de éxito
        const successMessage = document.createElement('div');
        successMessage.className = 'success-message';
        successMessage.textContent = data.message;
        document.body.appendChild(successMessage);
        
        // Cerrar mensaje y modal después de 2 segundos
        setTimeout(() => {
          successMessage.remove();
          modal.close();
        }, 2000);
      } else {
        alert('Error al imprimir: ' + data.error);
      }
    } catch (error) {
      alert('Error al imprimir: ' + error.message);
    }
  }

  // Función para aplicar la plantilla LAMDA
  aplicarPlantillaLamda() {
    this.textoPrincipalInput.value = 'LAMDA';
    this.textoSecundarioInput.value = '221-6615746';
    this.textoAdicionalInput.value = '';
  }

  async imprimirEtiquetaPersonalizada() {
    const textoPrincipal = this.textoPrincipalInput.value.trim();
    if (!textoPrincipal) {
      alert('El texto principal es obligatorio.');
      return;
    }

    const datos = {
      textoPrincipal,
      textoSecundario: this.textoSecundarioInput.value.trim(),
      textoAdicional: this.textoAdicionalInput.value.trim()
    };

    const cantidad = parseInt(this.cantidadPersonalizadaInput.value, 10);

    try {
      const res = await fetch('../api/imprimir-personalizada', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datos, cantidad }),
      });
      
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
      } else {
        alert('Error al imprimir: ' + data.error);
      }
    } catch (error) {
      alert('Error al imprimir: ' + error.message);
    }
  }
}

// Inicializar el gestor de impresión cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  new PrintManager();
});
