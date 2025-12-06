// ═══════════════════════════════════════════════════════════
// INDICADOR DE ENTORNO
// ═══════════════════════════════════════════════════════════

/**
 * Consulta el estado del entorno y actualiza el indicador visual
 */
async function cargarIndicadorEntorno() {
  try {
    const response = await fetch('/api/config/status');
    
    if (!response.ok) {
      console.warn('No se pudo obtener el estado del entorno');
      return;
    }

    const data = await response.json();
    const indicator = document.getElementById('environment-indicator');
    const iconElement = indicator.querySelector('.icon');
    const textElement = indicator.querySelector('.text');
    const pulseElement = indicator.querySelector('.pulse');

    // Limpiar clases previas
    indicator.classList.remove('test', 'production');

    if (data.isTest) {
      // Modo PRUEBAS - Indicador llamativo
      indicator.classList.add('test');
      iconElement.textContent = '⚠️';
      textElement.textContent = `MODO PRUEBAS (${data.database})`;
      pulseElement.style.display = 'block';
      indicator.style.display = 'flex';
      
      console.log('%c🧪 MODO PRUEBAS ACTIVO', 'background: #ff6b6b; color: white; padding: 8px; font-weight: bold; font-size: 14px;');
      console.log(`📊 Base de datos: ${data.database}`);
      console.log(`🌍 Entorno: ${data.environment}`);
      console.log('%c⚠️ Puedes realizar operaciones destructivas sin riesgo', 'color: #ff8e53; font-weight: bold;');
      
    } else if (data.isProduction) {
      // Modo PRODUCCIÓN - Indicador sutil
      indicator.classList.add('production');
      iconElement.textContent = '●';
      textElement.textContent = 'Producción';
      pulseElement.style.display = 'none';
      indicator.style.display = 'flex';
      
      console.log('%c✅ MODO PRODUCCIÓN', 'background: #28a745; color: white; padding: 8px; font-weight: bold; font-size: 14px;');
      console.log(`📊 Base de datos: ${data.database}`);
      console.log(`🌍 Entorno: ${data.environment}`);
      console.log('%c⚠️ Ten cuidado con operaciones destructivas', 'color: #dc3545; font-weight: bold;');
    }

  } catch (error) {
    console.error('Error al cargar indicador de entorno:', error);
  }
}

// Cargar el indicador al iniciar la página
document.addEventListener('DOMContentLoaded', () => {
  cargarIndicadorEntorno();
});

// ═══════════════════════════════════════════════════════════
// MODAL DE LOGIN
// ═══════════════════════════════════════════════════════════

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
