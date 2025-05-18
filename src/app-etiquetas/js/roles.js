const API_BASE = '/api';

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
  document.getElementById('modal-editar-rol').classList.add('active');
}

function cerrarModal() {
  document.getElementById('modal-editar-rol').classList.remove('active');
  document.getElementById('form-editar-rol').reset();
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
