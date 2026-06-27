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
  cargarIndicadorWhatsApp();
  // Polling activo cada 5 segundos para refrescar estado en tiempo real
  setInterval(cargarIndicadorWhatsApp, 5000);
});

/**
 * Consulta el estado de WhatsApp en el puerto 3004 y actualiza el indicador global en el header
 */
async function cargarIndicadorWhatsApp() {
  const container = document.getElementById('global-whatsapp-indicator');
  if (!container) return;

  const portFacturacion = 3004;
  const url = `${window.location.protocol}//${window.location.hostname}:${portFacturacion}/facturacion/whatsapp/status`;
  const configUrl = `${window.location.protocol}//${window.location.hostname}:${portFacturacion}/pages/whatsapp-config.html`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const result = await response.json();
    if (result.success && result.data) {
      const { status } = result.data;
      
      let badgeHTML = '';
      if (status === 'CONECTADO') {
        badgeHTML = `
          <a href="${configUrl}" class="whatsapp-badge connected" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px; border: 1px solid #10b981; background-color: #ecfdf5; color: #047857; text-decoration: none; font-size: 0.85em; font-weight: 600; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.1);">
            <span style="width: 8px; height: 8px; border-radius: 50%; background-color: #10b981; display: inline-block;"></span>
            🟢 WhatsApp Activo
          </a>
        `;
      } else if (status === 'CONECTANDO') {
        badgeHTML = `
          <a href="${configUrl}" class="whatsapp-badge connecting" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px; border: 1px solid #3b82f6; background-color: #eff6ff; color: #1d4ed8; text-decoration: none; font-size: 0.85em; font-weight: 600; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.1);">
            <span style="width: 8px; height: 8px; border-radius: 50%; background-color: #3b82f6; display: inline-block; animation: pulse 1s infinite;"></span>
            ⏳ WhatsApp Conectando...
          </a>
        `;
      } else if (status === 'ESPERANDO_QR') {
        badgeHTML = `
          <a href="${configUrl}" class="whatsapp-badge waiting" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px; border: 1px solid #f59e0b; background-color: #fffbeb; color: #b45309; text-decoration: none; font-size: 0.85em; font-weight: 600; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(245, 158, 11, 0.1);">
            <span style="width: 8px; height: 8px; border-radius: 50%; background-color: #f59e0b; display: inline-block; animation: pulse 1.5s infinite;"></span>
            🔑 WhatsApp Esperando QR
          </a>
        `;
      } else {
        badgeHTML = `
          <a href="${configUrl}" class="whatsapp-badge disconnected" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px; border: 1px solid #ef4444; background-color: #fef2f2; color: #b91c1c; text-decoration: none; font-size: 0.85em; font-weight: 600; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.1);">
            <span style="width: 8px; height: 8px; border-radius: 50%; background-color: #ef4444; display: inline-block; animation: pulse 2s infinite;"></span>
            🔴 WhatsApp Desconectado
          </a>
        `;
      }
      
      container.innerHTML = badgeHTML;
    } else {
      throw new Error('Formato de respuesta inválido');
    }
  } catch (error) {
    console.warn('No se pudo obtener el estado de WhatsApp:', error.message);
    container.innerHTML = `
      <a href="${configUrl}" class="whatsapp-badge disconnected" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px; border: 1px solid #ef4444; background-color: #fef2f2; color: #b91c1c; text-decoration: none; font-size: 0.85em; font-weight: 600; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.1);">
        <span style="width: 8px; height: 8px; border-radius: 50%; background-color: #ef4444; display: inline-block; animation: pulse 2s infinite;"></span>
        🔴 WhatsApp Desconectado
      </a>
    `;
  }
}

// ═══════════════════════════════════════════════════════════
// MODAL DE LOGIN
// ═══════════════════════════════════════════════════════════

let loginManualMode = false;

// Funciones para el modal de login
async function abrirModalLogin() {
  document.getElementById('modal-login').classList.add('active');
  
  // Resetear al modo dropdown por defecto al abrir
  loginManualMode = false;
  const container = document.getElementById('container-usuario');
  const btn = document.getElementById('btn-toggle-login-mode');
  if (container && btn) {
    container.innerHTML = `
      <select id="usuario" required>
        <option value="" disabled selected>Cargando usuarios...</option>
      </select>
    `;
    btn.textContent = 'Ingresar manualmente';
  }
  
  await cargarUsuariosAdmin();
  document.getElementById('usuario').focus();
}

function cerrarModalLogin() {
  document.getElementById('modal-login').classList.remove('active');
  document.getElementById('form-login').reset();
  document.getElementById('mensaje-error').textContent = '';
}

// Función para alternar entre selector desplegable e ingreso manual de usuario
function toggleLoginMode() {
  const container = document.getElementById('container-usuario');
  const btn = document.getElementById('btn-toggle-login-mode');
  if (!container || !btn) return;
  
  loginManualMode = !loginManualMode;
  
  if (loginManualMode) {
    container.innerHTML = '<input type="text" id="usuario" required placeholder="Escriba su usuario">';
    btn.textContent = 'Seleccionar de la lista';
    document.getElementById('usuario').focus();
  } else {
    container.innerHTML = `
      <select id="usuario" required>
        <option value="" disabled selected>Cargando usuarios...</option>
      </select>
    `;
    btn.textContent = 'Ingresar manualmente';
    cargarUsuariosAdmin().then(() => {
      document.getElementById('usuario').focus();
    });
  }
}

// Carga dinámica de los usuarios con permiso de configuración en el dropdown
async function cargarUsuariosAdmin() {
  const usuarioSelect = document.getElementById('usuario');
  if (!usuarioSelect || loginManualMode) return;
  
  const currentVal = usuarioSelect.value;
  
  try {
    usuarioSelect.innerHTML = '<option value="" disabled selected>Cargando usuarios...</option>';
    
    // Obtener los usuarios que tienen permiso 'Configuracion'
    const res = await fetch('/api/usuarios/con-permiso/Configuracion');
    if (!res.ok) throw new Error('Error al obtener usuarios con permiso');
    
    const usuarios = await res.json();
    
    if (usuarios.length === 0) {
      usuarioSelect.innerHTML = '<option value="" disabled selected>Sin usuarios administrativos</option>';
      return;
    }
    
    usuarioSelect.innerHTML = '<option value="" disabled selected>Seleccione un usuario...</option>';
    usuarios.forEach(u => {
      const option = document.createElement('option');
      option.value = u.usuario; // Se envía el identificador del usuario para el login
      option.textContent = `${u.nombre_completo} (${u.usuario})`;
      usuarioSelect.appendChild(option);
    });
    
    // Si existía un valor previamente seleccionado y sigue disponible, restaurarlo
    if (currentVal && Array.from(usuarioSelect.options).some(o => o.value === currentVal)) {
      usuarioSelect.value = currentVal;
    }
  } catch (error) {
    console.error('Error al cargar usuarios administradores:', error);
    usuarioSelect.innerHTML = '<option value="" disabled selected>Error al cargar usuarios</option>';
  }
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
