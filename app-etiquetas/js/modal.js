// Gestión del modal
export class Modal {
  constructor() {
    this.modal = document.getElementById('printModal');
    this.modalContent = this.modal.querySelector('.modal-content');
    this.closeBtn = this.modal.querySelector('.close-modal');
    this.isDragging = false;
    this.currentX;
    this.currentY;
    this.initialX;
    this.initialY;
    this.xOffset = 0;
    this.yOffset = 0;

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Cerrar modal
    this.closeBtn.addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });

    // Eventos para arrastrar
    this.modalContent.addEventListener('mousedown', (e) => this.dragStart(e));
    document.addEventListener('mousemove', (e) => this.drag(e));
    document.addEventListener('mouseup', () => this.dragEnd());

    // Prevenir que el contenido del modal sea arrastrable
    this.modalContent.addEventListener('dragstart', (e) => e.preventDefault());
  }

  dragStart(e) {
    if (e.target === this.modalContent || e.target.closest('.modal-header')) {
      this.initialX = e.clientX - this.xOffset;
      this.initialY = e.clientY - this.yOffset;
      this.isDragging = true;
      this.modalContent.classList.add('dragging');
    }
  }

  drag(e) {
    if (this.isDragging) {
      e.preventDefault();
      this.currentX = e.clientX - this.initialX;
      this.currentY = e.clientY - this.initialY;
      this.xOffset = this.currentX;
      this.yOffset = this.currentY;
      this.setTranslate(this.currentX, this.currentY, this.modalContent);
    }
  }

  dragEnd() {
    this.isDragging = false;
    this.modalContent.classList.remove('dragging');
  }

  setTranslate(xPos, yPos, el) {
    el.style.transform = `translate(${xPos}px, ${yPos}px)`;
  }

  open() {
    this.modal.classList.add('show');
    // Resetear posición al abrir
    this.xOffset = 0;
    this.yOffset = 0;
    this.modalContent.style.transform = '';
  }

  close() {
    this.modal.classList.remove('show');
  }

  // Actualizar contenido del modal
  updatePreview(articulo) {
    document.getElementById('previewNumero').textContent = articulo.numero;
    document.getElementById('previewNombre').textContent = articulo.nombre;
    document.getElementById('previewCodigoBarras').textContent = articulo.codigo_barras;
  }
}

// Exportar una instancia única del modal
export const modal = new Modal();
