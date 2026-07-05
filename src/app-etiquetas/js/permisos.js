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
  const modal = document.getElementById('modal-editar-permiso');
  if (modal) {
    makeModalDraggable(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cerrarModal();
      }
    });
  }
});

// Cargar todos los roles en el <select>
async function cargarRoles() {
  try {
    const res = await fetch(`${API_BASE}/roles`);
    const roles = await res.json();
    const select = document.getElementById('rol_select');
    select.innerHTML = '';
    roles.forEach(rol => {
      const option = document.createElement('option');
      option.value = rol.id;
      option.textContent = rol.nombre;
      select.appendChild(option);
    });

    // Cargar permisos del primer rol por defecto
    if (roles.length > 0) {
      cargarPermisosPorRol(roles[0].id);
    }
  } catch (error) {
    console.error('Error al cargar roles:', error);
  }
}

// Crear nuevo permiso
document.getElementById('form-nuevo-permiso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('permiso_nombre').value;
  const descripcion = document.getElementById('permiso_descripcion').value;

  try {
    const res = await fetch(`${API_BASE}/permisos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, descripcion })
    });

    if (res.ok) {
      alert('Permiso creado correctamente');
      document.getElementById('form-nuevo-permiso').reset();
      const rolId = document.getElementById('rol_select').value;
      cargarPermisosPorRol(rolId);
    } else {
      const data = await res.json();
      alert(data.error || 'Error al crear permiso');
    }
  } catch (error) {
    console.error('Error al crear permiso:', error);
  }
});

// Al cambiar el rol, cargar sus permisos
document.getElementById('rol_select').addEventListener('change', (e) => {
  const rolId = e.target.value;
  cargarPermisosPorRol(rolId);
});

// Cargar todos los permisos y marcar los asignados al rol
async function cargarPermisosPorRol(rolId) {
  try {
    const [todosRes, asignadosRes] = await Promise.all([
      fetch(`${API_BASE}/permisos`),
      fetch(`${API_BASE}/roles/${rolId}/permisos`)
    ]);

    const todos = await todosRes.json();
    const asignados = await asignadosRes.json();
    const permisosAsignados = new Set(asignados.map(p => p.id));

    const tbody = document.getElementById('tabla-permisos-por-rol');
    tbody.innerHTML = '';

    todos.forEach(p => {
      const fila = document.createElement('tr');
      const estaAsignado = permisosAsignados.has(p.id);

      fila.innerHTML = `
        <td>${p.nombre}</td>
        <td>${p.descripcion || ''}</td>
        <td class="asignado-toggle" onclick="togglePermiso(${rolId}, ${p.id}, ${!estaAsignado})">${estaAsignado ? '✅' : '—'}</td>
        <td>
          <button type="button" class="btn-accion" onclick="abrirModalEditar(${p.id}, '${p.nombre}', '${p.descripcion || ''}')">✏️</button>
          <button type="button" class="btn-accion" onclick="eliminarPermiso(${p.id})">🗑</button>
        </td>
      `;

      tbody.appendChild(fila);
    });

  } catch (error) {
    console.error('Error al cargar permisos por rol:', error);
  }
}

// Asignar o quitar permiso a un rol
async function togglePermiso(rolId, permisoId, permitir) {
  try {
    const res = await fetch(`${API_BASE}/roles/${rolId}/permisos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permisoId, permitir })
    });

    if (res.ok) {
      cargarPermisosPorRol(rolId);
    } else {
      const data = await res.json();
      alert(data.error || 'Error al actualizar permiso');
    }
  } catch (error) {
    console.error('Error al actualizar permiso:', error);
  }
}

// Funciones para el modal de edición
function abrirModalEditar(id, nombre, descripcion) {
  document.getElementById('editar_id').value = id;
  document.getElementById('editar_nombre').value = nombre;
  document.getElementById('editar_descripcion').value = descripcion || '';
  
  const modal = document.getElementById('modal-editar-permiso');
  const content = modal.querySelector('.modal-content');
  resetModalPosition(content);
  modal.classList.add('active');
  document.body.style.overflow = 'hidden'; // Bloquear scroll de la página de atrás
}

function cerrarModal() {
  const modal = document.getElementById('modal-editar-permiso');
  modal.classList.remove('active');
  document.body.style.overflow = ''; // Restaurar scroll de la página de atrás
}

// Editar permiso
document.getElementById('form-editar-permiso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('editar_id').value;
  const nombre = document.getElementById('editar_nombre').value;
  const descripcion = document.getElementById('editar_descripcion').value;

  try {
    const res = await fetch(`${API_BASE}/permisos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, descripcion })
    });

    if (res.ok) {
      cerrarModal();
      const rolId = document.getElementById('rol_select').value;
      cargarPermisosPorRol(rolId);
    } else {
      const data = await res.json();
      alert(data.error || 'Error al actualizar permiso');
    }
  } catch (error) {
    console.error('Error al actualizar permiso:', error);
  }
});

// Eliminar permiso
async function eliminarPermiso(id) {
  if (!confirm('¿Está seguro de que desea eliminar este permiso?')) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/permisos/${id}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      const rolId = document.getElementById('rol_select').value;
      cargarPermisosPorRol(rolId);
    } else {
      const data = await res.json();
      alert(data.error || 'Error al eliminar permiso');
    }
  } catch (error) {
    console.error('Error al eliminar permiso:', error);
  }
}

// Inicializar
cargarRoles();
