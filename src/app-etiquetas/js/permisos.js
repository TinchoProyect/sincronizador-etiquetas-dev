const API_BASE = '/api';

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
  document.getElementById('modal-editar-permiso').classList.add('active');
}

function cerrarModal() {
  document.getElementById('modal-editar-permiso').classList.remove('active');
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
