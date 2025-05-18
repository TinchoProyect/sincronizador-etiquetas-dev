// Funciones para el modal de login
function abrirModalLogin() {
  document.getElementById('modal-login').classList.add('active');
  document.getElementById('usuario').focus();
}

function cerrarModalLogin() {
  document.getElementById('modal-login').classList.remove('active');
  document.getElementById('form-login').reset();
  document.getElementById('mensaje-error').textContent = '';
}

// Función para autenticar al usuario
async function autenticar(event) {
  event.preventDefault();
  const usuario = document.getElementById('usuario').value;
  const contraseña = document.getElementById('contraseña').value;
  const mensajeError = document.getElementById('mensaje-error');

  try {
    // Intentar autenticar
    const loginRes = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, contraseña })
    });

    const loginData = await loginRes.json();

    if (!loginRes.ok) {
      mensajeError.textContent = loginData.error || 'Error de autenticación';
      return false;
    }

    // Guardar el token de autenticación
    localStorage.setItem('token', loginData.token);

    // Obtener información del usuario autenticado
    const userRes = await fetch('/api/usuarios/me', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (!userRes.ok) {
      mensajeError.textContent = 'Error al obtener información del usuario';
      return false;
    }

    const userData = await userRes.json();
    
    // Verificar si el usuario tiene el permiso de configuración
    const tienePermiso = userData.permisos.some(p => p.toLowerCase() === 'configuracion');
    
    if (tienePermiso) {
      // Redirigir a la página de administración
      window.location.href = 'pages/usuarios.html';
    } else {
      mensajeError.textContent = 'Acceso denegado: No tiene los permisos necesarios';
    }

  } catch (error) {
    console.error('Error:', error);
    mensajeError.textContent = 'Error de conexión';
  }

  return false;
}

// Cerrar modal con Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cerrarModalLogin();
  }
});

// Cerrar modal al hacer clic fuera
document.getElementById('modal-login').addEventListener('click', (e) => {
  if (e.target.id === 'modal-login') {
    cerrarModalLogin();
  }
});
