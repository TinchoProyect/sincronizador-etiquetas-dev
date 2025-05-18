const API_BASE = '/api';

// Cargar roles existentes
async function cargarRoles() {
  try {
    const res = await fetch(`${API_BASE}/roles`);
    const roles = await res.json();
    const tbody = document.getElementById('tabla-roles');
    tbody.innerHTML = '';

    roles.forEach(rol => {
      const fila = document.createElement('tr');
      fila.innerHTML = `
        <td>${rol.id}</td>
        <td>${rol.nombre}</td>
        <td>${rol.descripcion || ''}</td>
      `;
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

// Inicialización
cargarRoles();
