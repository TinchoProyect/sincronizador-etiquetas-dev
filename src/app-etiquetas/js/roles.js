const API_BASE = '/api';

// --- UTILIDADES DE MODALES DINÁMICOS Y ARRASTRABLES ---
function makeModalDraggable(modalEl) {
  const header = modalEl.querySelector('.modal-header');
  const content = modalEl.querySelector('.modal-content');
  if (!header || !content) return;

  header.style.cursor = 'grab';

  let isDragging = false;
  let startX, startY;
  let initialLeft, initialTop;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.modal-close') || e.target.closest('input') || e.target.closest('button')) {
      return;
    }

    isDragging = true;
    header.style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';

    const rect = content.getBoundingClientRect();
    content.style.transform = 'none';
    content.style.left = `${rect.left}px`;
    content.style.top = `${rect.top}px`;
    content.style.margin = '0';

    startX = e.clientX;
    startY = e.clientY;
    initialLeft = rect.left;
    initialTop = rect.top;

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = content.getBoundingClientRect();

    newLeft = Math.max(0, Math.min(newLeft, viewportWidth - rect.width));
    newTop = Math.max(0, Math.min(newTop, viewportHeight - rect.height));

    content.style.left = `${newLeft}px`;
    content.style.top = `${newTop}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      header.style.cursor = 'grab';
      document.body.style.cursor = 'default';
    }
  });
}

function resetModalPosition(contentEl) {
  if (!contentEl) return;
  contentEl.style.transform = '';
  contentEl.style.left = '';
  contentEl.style.top = '';
  contentEl.style.margin = '';
}

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('modal-editar-rol');
  if (modal) {
    makeModalDraggable(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cerrarModal();
      }
    });
  }
});

// Cargar roles existentes
async function cargarRoles() {
  try {
    const res = await fetch(`${API_BASE}/roles`);
    const roles = await res.json();
    const tbody = document.getElementById('tabla-roles');
    tbody.innerHTML = '';

    roles.forEach(r => {
      const fila = document.createElement('tr');
      fila.innerHTML = `
        <td>${r.id}</td>
        <td>${r.nombre}</td>
        <td>${r.descripcion || '-'}</td>
        <td>
          <button 
            onclick="event.stopPropagation(); eliminarRol(${r.id}, '${r.nombre}')" 
            class="btn-danger"
          >
            🗑️ Eliminar
          </button>
        </td>
      `;
      
      // Hacer la fila clickeable para editar
      fila.style.cursor = 'pointer';
      fila.addEventListener('click', () => cargarDatosRol(r.id));
      
      tbody.appendChild(fila);
    });
  } catch (error) {
    console.error('Error al cargar roles:', error);
  }
}

// Enviar nuevo rol
document.getElementById('form-nuevo-rol').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('nombre').value;
  const descripcion = document.getElementById('descripcion').value;

  try {
    const res = await fetch(`${API_BASE}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, descripcion })
    });

    if (res.ok) {
      alert('Rol creado correctamente');
      document.getElementById('form-nuevo-rol').reset();
      cargarRoles();
    } else {
      const data = await res.json();
      alert(data.error || 'Error al crear rol');
    }
  } catch (error) {
    console.error('Error al crear rol:', error);
  }
});

// Funciones del modal
function abrirModal() {
  const modal = document.getElementById('modal-editar-rol');
  const content = modal.querySelector('.modal-content');
  resetModalPosition(content);
  modal.classList.add('active');
  document.body.style.overflow = 'hidden'; // Bloquear scroll de la página de atrás
}

function cerrarModal() {
  const modal = document.getElementById('modal-editar-rol');
  modal.classList.remove('active');
  document.getElementById('form-editar-rol').reset();
  document.body.style.overflow = ''; // Restaurar scroll de la página de atrás
}

// Cargar datos del rol en el modal
async function cargarDatosRol(id) {
  try {
    const res = await fetch(`${API_BASE}/roles/${id}`);
    if (!res.ok) throw new Error('Error al obtener rol');
    
    const rol = await res.json();
    
    // Llenar el formulario
    document.getElementById('editar_id').value = rol.id;
    document.getElementById('editar_nombre').value = rol.nombre;
    document.getElementById('editar_descripcion').value = rol.descripcion || '';
    
    abrirModal();
  } catch (error) {
    console.error('Error al cargar datos del rol:', error);
    alert('Error al cargar los datos del rol');
  }
}

// Guardar cambios del rol
document.getElementById('form-editar-rol').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const id = document.getElementById('editar_id').value;
  const nombre = document.getElementById('editar_nombre').value;
  const descripcion = document.getElementById('editar_descripcion').value;

  // Validaciones
  if (!nombre) {
    alert('El nombre del rol es obligatorio');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/roles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, descripcion })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al actualizar rol');
    }

    alert('Rol actualizado correctamente');
    cerrarModal();
    cargarRoles();
  } catch (error) {
    console.error('Error al actualizar rol:', error);
    alert(error.message || 'Error al actualizar rol');
  }
});

// Eliminar rol
async function eliminarRol(id, nombre) {
  if (!confirm(`¿Está seguro que desea eliminar el rol "${nombre}"?`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/roles/${id}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al eliminar rol');
    }

    alert('Rol eliminado correctamente');
    cargarRoles();
  } catch (error) {
    console.error('Error al eliminar rol:', error);
    alert(error.message || 'Error al eliminar rol');
  }
}

// Inicialización
cargarRoles();
