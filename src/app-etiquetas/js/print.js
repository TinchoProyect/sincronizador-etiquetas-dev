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
    // Elementos de búsqueda
    this.busquedaInteligente = document.getElementById('busqueda-inteligente');
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
    // Evento de búsqueda inteligente
    this.busquedaInteligente.addEventListener('input', () => this.aplicarBusquedaInteligente());
    
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

  /**
   * Normaliza un texto para búsqueda: minúsculas y sin acentos
   * @param {string} texto - Texto a normalizar
   * @returns {string} Texto normalizado
   */
  normalizarTexto(texto) {
    if (!texto) return '';
    return texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  /**
   * Aplica búsqueda inteligente multi-término con lógica AND estricta
   * Los artículos deben contener TODOS los términos ingresados (sin importar el orden)
   * CORREGIDO: Solo busca en campos VISIBLES (nombre y número)
   */
  aplicarBusquedaInteligente() {
    // Resetear código de barras
    this.barcodeInput.value = '';
    
    const textoBusqueda = this.busquedaInteligente.value.trim();
    
    if (!textoBusqueda) {
      // Si no hay texto, mostrar todos los artículos
      this.mostrarArticulos(this.articulos);
      return;
    }
    
    // Normalizar el texto de búsqueda y dividir por espacios
    const textoNormalizado = this.normalizarTexto(textoBusqueda);
    
    // Sanitización: filtrar términos vacíos
    const terminos = textoNormalizado.split(/\s+/).filter(t => t.trim().length > 0);
    
    console.log(`🔍 [BÚSQUEDA INTELIGENTE] Términos de búsqueda:`, terminos);
    
    if (terminos.length === 0) {
      this.mostrarArticulos(this.articulos);
      return;
    }
    
    // Filtrar artículos con lógica AND estricta
    const resultados = this.articulos.filter(art => {
      // SOLO buscar en campos VISIBLES: nombre (descripción)
      // NO incluir código_barras, numero, ni otros campos internos
      const descripcionNormalizada = this.normalizarTexto(art.nombre || '');
      
      // LÓGICA AND ESTRICTA: TODOS los términos deben estar en la descripción
      const cumpleConTodos = terminos.every(termino => 
        descripcionNormalizada.includes(termino)
      );
      
      // Debug: Log de artículos que cumplen
      if (cumpleConTodos) {
        console.log(`✅ [MATCH] "${art.nombre}" cumple con términos:`, terminos);
      }
      
      return cumpleConTodos;
    });
    
    console.log(`🔍 [BÚSQUEDA INTELIGENTE] Resultados encontrados: ${resultados.length} de ${this.articulos.length}`);
    
    // Debug detallado del primer resultado
    if (resultados.length > 0) {
      console.log(`🔍 [PRIMER RESULTADO]:`, {
        nombre: resultados[0].nombre,
        nombre_normalizado: this.normalizarTexto(resultados[0].nombre),
        terminos_buscados: terminos,
        todos_presentes: terminos.map(t => ({
          termino: t,
          presente: this.normalizarTexto(resultados[0].nombre).includes(t)
        }))
      });
    } else {
      console.log(`ℹ️ [SIN RESULTADOS] Ningún artículo contiene TODOS los términos:`, terminos);
    }
    
    this.mostrarArticulos(resultados);
  }

  seleccionarArticulo(art) {
    this.articuloSeleccionado = art;
    modal.updatePreview(art);
    modal.open();
  }

  manejarEscaneo() {
    // Resetear búsqueda inteligente
    this.busquedaInteligente.value = '';

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
          articulo: datosImpresion,
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
