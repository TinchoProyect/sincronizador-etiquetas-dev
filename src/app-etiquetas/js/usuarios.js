const API_BASE = '/api';

// Manejo del menú desplegable y eventos iniciales
document.addEventListener('DOMContentLoaded', () => {
  // Configuración del menú desplegable
  const dropdownToggle = document.querySelector('.dropdown-toggle');
  const dropdownMenu = document.querySelector('.dropdown-menu');

  // Cerrar el menú al hacer clic fuera
  document.addEventListener('click', (e) => {
    if (!dropdownMenu.contains(e.target)) {
      dropdownMenu.classList.remove('active');
    }
  });

  // Toggle del menú
  dropdownToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('active');
  });
});


// Cargar roles en los selects
async function cargarRoles(rolIdSeleccionado = null) {
  try {
    const res = await fetch(`${API_BASE}/roles`);
    const roles = await res.json();
    
    // Cargar roles en el select de nuevo usuario
    const selectNuevo = document.getElementById('rol_id');
    selectNuevo.innerHTML = '<option value="">Seleccione un rol</option>';
    
    // Cargar roles en el select de edición
    const selectEditar = document.getElementById('editar_rol_id');
    selectEditar.innerHTML = '<option value="">Seleccione un rol</option>';
    
    roles.forEach(rol => {
      // Agregar al select de nuevo usuario
      const optionNuevo = document.createElement('option');
      optionNuevo.value = rol.id;
      optionNuevo.textContent = rol.nombre;
      selectNuevo.appendChild(optionNuevo);
      
      // Agregar al select de edición
      const optionEditar = document.createElement('option');
      optionEditar.value = rol.id;
      optionEditar.textContent = rol.nombre;
      selectEditar.appendChild(optionEditar);
    });

    // Si hay un rol seleccionado, establecerlo en el select de edición
    if (rolIdSeleccionado) {
      selectEditar.value = rolIdSeleccionado;
    }
  } catch (error) {
    console.error('Error al cargar roles:', error);
  }
}

// Enviar nuevo usuario
document.getElementById('form-nuevo-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre_completo = document.getElementById('nombre_completo').value;
  const usuario = document.getElementById('usuario').value;
  const contraseña = document.getElementById('contraseña').value;
  const rol_id = document.getElementById('rol_id').value;

  try {
    const res = await fetch(`${API_BASE}/usuarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre_completo, usuario, contraseña, rol_id })
    });

    if (res.ok) {
      alert('Usuario creado correctamente');
      document.getElementById('form-nuevo-usuario').reset();
      cargarUsuarios();
    } else {
      const data = await res.json();
      alert(data.error || 'Error al crear usuario');
    }
  } catch (error) {
    console.error('Error al crear usuario:', error);
  }
});

// Funciones del modal
function abrirModal() {
  document.getElementById('modal-editar-usuario').classList.add('active');
}

function cerrarModal() {
  document.getElementById('modal-editar-usuario').classList.remove('active');
  document.getElementById('form-editar-usuario').reset();
}

// Toggle de contraseña
function togglePassword() {
  const input = document.getElementById('editar_contraseña');
  const button = document.querySelector('.password-toggle');
  
  if (input.type === 'password') {
    input.type = 'text';
    button.textContent = '🔒';
  } else {
    input.type = 'password';
    button.textContent = '👁️';
  }
}

// Cargar datos del usuario en el modal
async function cargarDatosUsuario(id) {
  try {
    const res = await fetch(`${API_BASE}/usuarios/${id}`);
    if (!res.ok) throw new Error('Error al obtener usuario');
    
    const usuario = await res.json();
    
    // Llenar el formulario
    document.getElementById('editar_id').value = usuario.id;
    document.getElementById('editar_nombre_completo').value = usuario.nombre_completo;
    document.getElementById('editar_usuario').value = usuario.usuario;
    document.getElementById('editar_rol_id').value = usuario.rol_id || '';
    document.getElementById('editar_comentario').value = usuario.comentario || '';
    document.getElementById('editar_activo').checked = usuario.activo;
    
    // Limpiar contraseña ya que es opcional
    document.getElementById('editar_contraseña').value = '';
    
    // Cargar roles y seleccionar el rol actual
    await cargarRoles(usuario.rol_id);
    abrirModal();
  } catch (error) {
    console.error('Error al cargar datos del usuario:', error);
    alert('Error al cargar los datos del usuario');
  }
}

// Guardar cambios del usuario
document.getElementById('form-editar-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const id = document.getElementById('editar_id').value;
  const nombre_completo = document.getElementById('editar_nombre_completo').value;
  const usuario = document.getElementById('editar_usuario').value;
  const contraseña = document.getElementById('editar_contraseña').value;
  const rol_id = document.getElementById('editar_rol_id').value;
  const comentario = document.getElementById('editar_comentario').value;
  const activo = document.getElementById('editar_activo').checked;

  // Validaciones
  if (!nombre_completo || !usuario) {
    alert('Nombre completo y usuario son obligatorios');
    return;
  }

  if (contraseña && contraseña.length < 6) {
    alert('La contraseña debe tener al menos 6 caracteres');
    return;
  }

  try {
    const datos = {
      nombre_completo,
      usuario,
      rol_id,
      comentario,
      activo
    };

    // Solo incluir contraseña si se modificó
    if (contraseña) {
      datos.contraseña = contraseña;
    }

    const res = await fetch(`${API_BASE}/usuarios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos)
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al actualizar usuario');
    }

    alert('Usuario actualizado correctamente');
    cerrarModal();
    cargarUsuarios();
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    alert(error.message || 'Error al actualizar usuario');
  }
});

// Mostrar usuarios existentes
async function cargarUsuarios() {
  try {
    const res = await fetch(`${API_BASE}/usuarios`);
    const usuarios = await res.json();
    const tbody = document.getElementById('tabla-usuarios');
    tbody.innerHTML = '';

    usuarios.forEach(u => {
      const fila = document.createElement('tr');
      fila.innerHTML = `
        <td>${u.id}</td>
        <td>${u.nombre_completo}</td>
        <td>${u.usuario}</td>
        <td>${u.rol_nombre || '-'}</td>
        <td>${u.activo ? 'Sí' : 'No'}</td>
        <td>
          <button 
            onclick="event.stopPropagation(); eliminarUsuario(${u.id}, '${u.nombre_completo}')" 
            class="btn-danger"
            style="padding: 4px 8px; font-size: 0.9em; background-color: #dc3545; color: white;"
          >
            🗑️ Eliminar
          </button>
        </td>
      `;
      
      // Hacer la fila clickeable
      fila.style.cursor = 'pointer';
      fila.addEventListener('click', () => cargarDatosUsuario(u.id));
      
      tbody.appendChild(fila);
    });
  } catch (error) {
    console.error('Error al cargar usuarios:', error);
  }
}

// Eliminar usuario
async function eliminarUsuario(id, nombre) {
  if (!confirm(`¿Está seguro que desea eliminar al usuario "${nombre}"?`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/usuarios/${id}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al eliminar usuario');
    }

    alert('Usuario eliminado correctamente');
    cargarUsuarios();
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    alert(error.message || 'Error al eliminar usuario');
  }
}

// Inicialización
cargarRoles();
cargarUsuarios();
