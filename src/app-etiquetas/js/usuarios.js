const API_BASE = '/api';

// Cargar roles en el select
async function cargarRoles() {
  try {
    const res = await fetch(`${API_BASE}/roles`);
    const roles = await res.json();
    const select = document.getElementById('rol_id');
    roles.forEach(rol => {
      const option = document.createElement('option');
      option.value = rol.id;
      option.textContent = rol.nombre;
      select.appendChild(option);
    });
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
      `;
      tbody.appendChild(fila);
    });
  } catch (error) {
    console.error('Error al cargar usuarios:', error);
  }
}

// Inicialización
cargarRoles();
cargarUsuarios();
