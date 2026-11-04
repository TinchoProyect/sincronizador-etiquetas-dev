const API_BASE = '/api';
let clientesBunkerCargados = [];

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
    // No iniciar arrastre si se hace clic en elementos interactivos
    if (e.target.closest('.modal-close') || e.target.closest('input') || e.target.closest('select') || e.target.closest('button') || e.target.closest('.password-toggle')) {
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

    // Límites de pantalla seguros
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

// Manejo del menú desplegable y eventos iniciales
document.addEventListener('DOMContentLoaded', () => {
  // Configuración del menú desplegable
  const dropdownToggle = document.querySelector('.dropdown-toggle');
  const dropdownMenu = document.querySelector('.dropdown-menu');

  // Cerrar el menú al hacer clic fuera
  document.addEventListener('click', (e) => {
    if (dropdownMenu && !dropdownMenu.contains(e.target)) {
      dropdownMenu.classList.remove('active');
    }
  });

  // Toggle del menú
  if (dropdownToggle && dropdownMenu) {
    dropdownToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('active');
    });
  }

  // Configurar modal de edición como arrastrable
  const modal = document.getElementById('modal-editar-usuario');
  if (modal) {
    makeModalDraggable(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cerrarModal();
      }
    });
  }
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

/**
 * Carga los clientes Búnker para vincular cuentas híbridas
 * Deshabilita los ya vinculados a otros operarios para evitar colisiones
 */
async function cargarClientesBunker(userIdEditando = null) {
  try {
    const res = await fetch(`${API_BASE}/bunker_clientes`);
    if (!res.ok) throw new Error('Error al obtener clientes búnker');
    clientesBunkerCargados = await res.json();

    // 1. Cargar selector de nuevo usuario
    const selectNuevo = document.getElementById('cliente_bunker_id');
    if (selectNuevo) {
      selectNuevo.innerHTML = '<option value="">-- No vinculado (Solo Operario) --</option>';
      clientesBunkerCargados.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        if (c.usuario_id) {
          opt.textContent = `${c.cliente_nombre} (Ya vinculado)`;
          opt.disabled = true;
          opt.style.color = '#94a3b8';
        } else {
          opt.textContent = c.cliente_nombre;
        }
        selectNuevo.appendChild(opt);
      });
    }

    // 2. Cargar selector de edición de usuario
    const selectEditar = document.getElementById('editar_cliente_bunker_id');
    if (selectEditar) {
      selectEditar.innerHTML = '<option value="">-- No vinculado (Solo Operario) --</option>';
      clientesBunkerCargados.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        
        // Deshabilitar si ya está asignado a otro operario
        if (c.usuario_id && String(c.usuario_id) !== String(userIdEditando)) {
          opt.textContent = `${c.cliente_nombre} (Ya vinculado)`;
          opt.disabled = true;
          opt.style.color = '#94a3b8';
        } else {
          opt.textContent = c.cliente_nombre;
        }
        selectEditar.appendChild(opt);
      });
    }
  } catch (error) {
    console.error('Error al cargar clientes búnker:', error);
  }
}

// Enviar nuevo usuario
document.getElementById('form-nuevo-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre_completo = document.getElementById('nombre_completo').value;
  const usuario = document.getElementById('usuario').value;
  const contraseña = document.getElementById('contraseña').value;
  const rol_id = document.getElementById('rol_id').value;
  const cliente_bunker_id = document.getElementById('cliente_bunker_id').value || null;

  try {
    const res = await fetch(`${API_BASE}/usuarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre_completo, usuario, contraseña, rol_id, cliente_bunker_id })
    });

    if (res.ok) {
      alert('Usuario creado correctamente');
      document.getElementById('form-nuevo-usuario').reset();
      cargarUsuarios();
      cargarClientesBunker();
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
  const modal = document.getElementById('modal-editar-usuario');
  const content = modal.querySelector('.modal-content');
  resetModalPosition(content);
  modal.classList.add('active');
  document.body.style.overflow = 'hidden'; // Bloquear scroll de la página de atrás
}

function cerrarModal() {
  const modal = document.getElementById('modal-editar-usuario');
  modal.classList.remove('active');
  document.getElementById('form-editar-usuario').reset();
  document.body.style.overflow = ''; // Restaurar scroll de la página de atrás
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
    
    // Cargar selectores dependientes antes de poblar datos
    await cargarRoles(usuario.rol_id);
    await cargarClientesBunker(id);
    
    // Llenar el formulario
    document.getElementById('editar_id').value = usuario.id;
    document.getElementById('editar_nombre_completo').value = usuario.nombre_completo;
    document.getElementById('editar_usuario').value = usuario.usuario;
    document.getElementById('editar_rol_id').value = usuario.rol_id || '';
    document.getElementById('editar_cliente_bunker_id').value = usuario.cliente_bunker_id || '';
    document.getElementById('editar_comentario').value = usuario.comentario || '';
    document.getElementById('editar_activo').checked = usuario.activo;
    
    // Limpiar contraseña ya que es opcional
    document.getElementById('editar_contraseña').value = '';
    
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
  const cliente_bunker_id = document.getElementById('editar_cliente_bunker_id').value || null;

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
      activo,
      cliente_bunker_id
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
    cargarClientesBunker();
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
      
      const badgeCliente = u.cliente_bunker_nombre
        ? `<span style="background-color: #d1fae5; color: #065f46; padding: 4px 10px; border-radius: 9999px; font-size: 0.85em; font-weight: 600; display: inline-block;">${u.cliente_bunker_nombre}</span>`
        : '<span style="color: #94a3b8; font-style: italic;">Sin vincular</span>';

      fila.innerHTML = `
        <td>${u.id}</td>
        <td><strong>${u.nombre_completo}</strong></td>
        <td><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${u.usuario}</code></td>
        <td>${u.rol_nombre || '-'}</td>
        <td>${badgeCliente}</td>
        <td style="text-align: center;">${u.activo ? '✔️' : '❌'}</td>
        <td style="text-align: center;">
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
    cargarClientesBunker();
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    alert(error.message || 'Error al eliminar usuario');
  }
}

// Inicialización
cargarRoles();
cargarClientesBunker();
cargarUsuarios();
