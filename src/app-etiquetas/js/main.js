// ═══════════════════════════════════════════════════════════
// INDICADOR DE ENTORNO Y RELOJ PIZARRA
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
      indicator.setAttribute('data-tooltip', `Conectado a Base de Datos de Pruebas (${data.database})`);
      if (iconElement) iconElement.textContent = '⚠️';
      if (textElement) textElement.textContent = `Pruebas: ${data.database}`;
      if (pulseElement) pulseElement.style.display = 'block';
      indicator.style.display = 'inline-block';
      
      console.log('%c🧪 MODO PRUEBAS ACTIVO', 'background: #ff6b6b; color: white; padding: 8px; font-weight: bold; font-size: 14px;');
      console.log(`📊 Base de datos: ${data.database}`);
      console.log(`🌍 Entorno: ${data.environment}`);
      console.log('%c⚠️ Puedes realizar operaciones destructivas sin riesgo', 'color: #ff8e53; font-weight: bold;');
      
    } else if (data.isProduction) {
      // Modo PRODUCCIÓN - Indicador sutil
      indicator.classList.add('production');
      indicator.setAttribute('data-tooltip', 'Conectado a Base de Datos de Producción');
      if (iconElement) iconElement.textContent = '●';
      if (textElement) textElement.textContent = 'Producción';
      if (pulseElement) pulseElement.style.display = 'block';
      indicator.style.display = 'inline-block';
      
      console.log('%c✅ MODO PRODUCCIÓN', 'background: #28a745; color: white; padding: 8px; font-weight: bold; font-size: 14px;');
      console.log(`📊 Base de datos: ${data.database}`);
      console.log(`🌍 Entorno: ${data.environment}`);
      console.log('%c⚠️ Ten cuidado con operaciones destructivas', 'color: #dc3545; font-weight: bold;');
    }

  } catch (error) {
    console.error('Error al cargar indicador de entorno:', error);
  }
}

/**
 * Actualiza la fecha y la hora en el canvas de la pizarra central
 */
function actualizarPizarraDateTime() {
  const timeEl = document.getElementById('pizarra-time');
  const dateEl = document.getElementById('pizarra-date');
  if (!timeEl || !dateEl) return;

  const ahora = new Date();
  
  // Formato Hora: HH:MM:SS
  timeEl.textContent = ahora.toLocaleTimeString('es-AR', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit', 
    hour12: false 
  });
  
  // Formato Fecha: viernes, 3 de julio de 2026
  const opcionesFecha = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const fechaFormateada = ahora.toLocaleDateString('es-AR', opcionesFecha);
  
  // Capitalizar primer letra
  dateEl.textContent = fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1);
}

// Cargar el indicador al iniciar la página
document.addEventListener('DOMContentLoaded', () => {
  cargarIndicadorEntorno();
  cargarIndicadorWhatsApp();
  
  // Inicializar y actualizar la pizarra central (fecha/hora)
  actualizarPizarraDateTime();
  setInterval(actualizarPizarraDateTime, 1000);

  // Inicializar y actualizar alertas dinámicas de la pizarra
  actualizarAlertasPizarra();
  setInterval(actualizarAlertasPizarra, 5000);

  // Polling activo cada 5 segundos para refrescar estado en tiempo real
  setInterval(cargarIndicadorWhatsApp, 5000);
});

/**
 * Limpia y normaliza la descripción del artículo para la visualización en la Pizarra
 */
function limpiarDescripcionArticulo(desc) {
  if (!desc) return '';
  let limpia = desc;
  if (limpia.includes('Mix/F/Secas/Premium')) {
    limpia = limpia.replace('Mix/F/Secas/Premium', 'Mix Frutos Secos Premium');
  }
  // Reemplazar " x " o " x" por " por "
  limpia = limpia.replace(/\s+x\s*/g, ' por ');
  // Reemplazar barras inclinadas sobrantes
  limpia = limpia.replace(/\//g, ' ');
  return limpia.trim();
}

/**
 * Consulta las alertas activas en segundo plano e inyecta la información en #pizarra-extra-widgets
 */
async function actualizarAlertasPizarra() {
  const container = document.getElementById('pizarra-extra-widgets');
  const btnLimpiar = document.getElementById('btn-limpiar-pizarra');
  if (!container) return;

  try {
    // 1. Consultar resumen_faltantes_parciales del módulo Producción
    const resProd = await fetch('/api/pizarra/resumen_faltantes_parciales');
    const dataProd = await resProd.json();
    const activeProd = dataProd.success && Array.isArray(dataProd.data) ? dataProd.data : [];

    // 2. Consultar bandeja_imprimir_modificado del módulo Logística/Impresión
    const resLog = await fetch('/api/pizarra/bandeja_imprimir_modificado');
    const dataLog = await resLog.json();
    const activeLogCount = dataLog.success && typeof dataLog.count === 'number' ? dataLog.count : 0;

    // 3. Consultar tratamientos activos (carpas) del módulo Mantenimiento
    const resCarpas = await fetch('/api/pizarra/mantenimiento_carpas');
    const dataCarpas = await resCarpas.json();
    const activeCarpas = dataCarpas.success && Array.isArray(dataCarpas.data) ? dataCarpas.data : [];

    // 4. Cargar tareas almacenadas en localStorage para persistencia
    let storedTasks = [];
    try {
      const stored = localStorage.getItem('pizarra_tasks');
      if (stored) storedTasks = JSON.parse(stored);
    } catch (e) {
      console.warn('Error al leer pizarra_tasks desde localStorage:', e);
    }

    // 5. Vía A: Evaporación Automática (Eliminar completados hace más de 24 horas)
    const limite24h = 24 * 60 * 60 * 1000;
    const ahora = Date.now();
    storedTasks = storedTasks.filter(t => {
      if (!t.completed) return true;
      return (ahora - t.completedAt) < limite24h;
    });

    // 6. Preparar mapa de tareas del ciclo actual
    const updatedTasks = [];

    // --- PROCESAR PRODUCCIÓN ---
    activeProd.forEach(item => {
      const taskId = `prod-${item.articulo_numero}`;
      const cant = Math.round(item.faltante);
      const descLimpia = limpiarDescripcionArticulo(item.descripcion);
      const taskText = `${cant} unidad — ${descLimpia}`;
      
      updatedTasks.push({
        id: taskId,
        type: 'produccion',
        text: taskText,
        completed: false,
        completedAt: null
      });
    });

    // Detectar si alguna tarea de producción se completó
    storedTasks.forEach(st => {
      if (st.type === 'produccion') {
        const stillActive = activeProd.some(item => `prod-${item.articulo_numero}` === st.id);
        if (!stillActive) {
          if (!st.completed) {
            updatedTasks.push({
              ...st,
              completed: true,
              completedAt: Date.now()
            });
          } else {
            updatedTasks.push(st);
          }
        }
      }
    });

    // --- PROCESAR LOGÍSTICA ---
    const logActiveTask = storedTasks.find(t => t.id === 'log-active');
    let prevLogCount = 0;
    if (logActiveTask) {
      const match = logActiveTask.text.match(/^(\d+)/);
      if (match) prevLogCount = parseInt(match[1]) || 0;
    }

    if (activeLogCount > 0) {
      updatedTasks.push({
        id: 'log-active',
        type: 'logistica',
        text: `${activeLogCount} pedidos para armar`,
        completed: false,
        completedAt: null
      });

      // Si disminuyó el contador, registrar la diferencia como completada
      if (prevLogCount > activeLogCount) {
        const dif = prevLogCount - activeLogCount;
        updatedTasks.push({
          id: `log-completed-${Date.now()}`,
          type: 'logistica',
          text: `${dif} pedidos para armar`,
          completed: true,
          completedAt: Date.now()
        });
      }
    } else if (prevLogCount > 0) {
      // El contador llegó a cero, registrar todo el remanente como completado
      updatedTasks.push({
        id: `log-completed-${Date.now()}`,
        type: 'logistica',
        text: `${prevLogCount} pedidos para armar`,
        completed: true,
        completedAt: Date.now()
      });
    }

    // Conservar las tareas de logística ya completadas anteriormente
    storedTasks.forEach(st => {
      if (st.type === 'logistica' && st.completed) {
        updatedTasks.push(st);
      }
    });

    // --- PROCESAR MANTENIMIENTO (CARPAS) ---
    activeCarpas.forEach(carpa => {
      const taskId = `carpa-${carpa.id}`;
      const carpaFecha = new Date(carpa.fecha_inicio_cuarentena);
      const diffMs = Date.now() - carpaFecha;
      const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const kilos = Math.round(carpa.kilos_brutos_totales);
      const descLimpia = limpiarDescripcionArticulo(carpa.item_nombre);
      const taskText = `1 carpa activa (hace ${dias} días): ${kilos} kg de ${descLimpia}`;

      updatedTasks.push({
        id: taskId,
        type: 'mantenimiento',
        text: taskText,
        completed: false,
        completedAt: null
      });
    });

    // Detectar si alguna carpa se completó
    storedTasks.forEach(st => {
      if (st.type === 'mantenimiento') {
        const stillActive = activeCarpas.some(carpa => `carpa-${carpa.id}` === st.id);
        if (!stillActive) {
          if (!st.completed) {
            updatedTasks.push({
              ...st,
              completed: true,
              completedAt: Date.now()
            });
          } else {
            updatedTasks.push(st);
          }
        }
      }
    });

    // 7. Guardar tareas en localStorage
    localStorage.setItem('pizarra_tasks', JSON.stringify(updatedTasks));

    // 8. Separar tareas activas y completadas para el renderizado
    const activeProdTasks = updatedTasks.filter(t => !t.completed && (t.type === 'produccion' || t.id === 'log-active'));
    const completedProdTasks = updatedTasks.filter(t => t.completed && (t.type === 'produccion' || t.type === 'logistica'));

    const activeMantenimiento = updatedTasks.filter(t => !t.completed && t.type === 'mantenimiento');
    const completedMantenimiento = updatedTasks.filter(t => t.completed && t.type === 'mantenimiento');

    const totalProdCount = activeProdTasks.length + completedProdTasks.length;
    const totalMantenimientoCount = activeMantenimiento.length + completedMantenimiento.length;

    // Condición de Pantalla Limpia
    if (totalProdCount === 0 && totalMantenimientoCount === 0) {
      container.innerHTML = '';
      if (btnLimpiar) btnLimpiar.style.display = 'none';
      return;
    }

    // Mostrar u ocultar el botón de limpieza manual (Vía B) si hay tareas completadas
    const hasCompleted = updatedTasks.some(t => t.completed);
    if (btnLimpiar) {
      btnLimpiar.style.display = hasCompleted ? 'flex' : 'none';
    }

    // 9. Construir y Renderizar HTML
    let html = '';

    // Renderizar sección de Producción
    if (totalProdCount > 0) {
      html += `<div class="pizarra-alert-title">Producción:</div>`;
      
      // Renderizar activas primero
      activeProdTasks.forEach(t => {
        html += `<div class="pizarra-alert-item">• ${t.text}</div>`;
      });

      // Renderizar separador sutil de Producción
      const hasActiveFaltantes = activeProdTasks.some(t => t.type === 'produccion');
      const hasActiveLog = activeProdTasks.some(t => t.id === 'log-active');
      if (hasActiveFaltantes && hasActiveLog) {
        html += `<div class="pizarra-production-divider"></div>`;
      }

      // Renderizar completadas después
      completedProdTasks.forEach(t => {
        html += `<div class="pizarra-alert-item completed">✅ ${t.text}</div>`;
      });
    }

    // Renderizar sección de Mantenimiento
    if (totalMantenimientoCount > 0) {
      html += `<div class="pizarra-alert-title">Mantenimiento:</div>`;
      
      // Activas
      activeMantenimiento.forEach(t => {
        html += `<div class="pizarra-alert-item">• ${t.text}</div>`;
      });

      // Completadas
      completedMantenimiento.forEach(t => {
        html += `<div class="pizarra-alert-item completed">✅ ${t.text}</div>`;
      });
    }

    container.innerHTML = html;

  } catch (error) {
    console.error('Error al actualizar alertas de la pizarra:', error);
  }
}

/**
 * Vía B: Purga Manual Directa (Eliminar elementos completados con tilde verde de inmediato)
 */
function purgaManualAlertas() {
  try {
    const stored = localStorage.getItem('pizarra_tasks');
    if (!stored) return;
    
    let tasks = JSON.parse(stored);
    // Filtrar conservando únicamente las tareas que sigan activas
    tasks = tasks.filter(t => !t.completed);
    
    localStorage.setItem('pizarra_tasks', JSON.stringify(tasks));
    
    // Forzar actualización inmediata de la interfaz
    actualizarAlertasPizarra();
  } catch (error) {
    console.error('Error al purgar alertas de la pizarra:', error);
  }
}

// Exponer la función globalmente para onclick de index.html
window.purgaManualAlertas = purgaManualAlertas;



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
      
      let dotClass = '';
      let tooltipText = '';
      if (status === 'CONECTADO') {
        dotClass = 'connected';
        tooltipText = 'WhatsApp Activo';
      } else if (status === 'CONECTANDO') {
        dotClass = 'connecting';
        tooltipText = 'WhatsApp Conectando...';
      } else if (status === 'ESPERANDO_QR') {
        dotClass = 'waiting';
        tooltipText = 'WhatsApp Esperando QR';
      } else {
        dotClass = 'disconnected';
        tooltipText = 'WhatsApp Desconectado';
      }
      
      container.className = `whatsapp-status-indicator tooltip ${dotClass}`;
      container.setAttribute('data-tooltip', tooltipText);
      container.innerHTML = `
        <a href="${configUrl}" class="whatsapp-dot-link" style="display: block; width: 100%; height: 100%; border-radius: 50%;"></a>
      `;
    } else {
      throw new Error('Formato de respuesta inválido');
    }
  } catch (error) {
    console.warn('No se pudo obtener el estado de WhatsApp:', error.message);
    container.className = 'whatsapp-status-indicator tooltip disconnected';
    container.setAttribute('data-tooltip', 'WhatsApp Desconectado');
    container.innerHTML = `
      <a href="${configUrl}" class="whatsapp-dot-link" style="display: block; width: 100%; height: 100%; border-radius: 50%;"></a>
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

// Cerrar modal y sidebar con Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cerrarModalLogin();
    closeSidebar();
  }
});

// Cerrar modal al hacer clic fuera
document.getElementById('modal-login').addEventListener('click', (e) => {
  if (e.target.id === 'modal-login') {
    cerrarModalLogin();
  }
});

// ═══════════════════════════════════════════════════════════
// LÓGICA DE MENÚ LATERAL (SIDEBAR DRAWER & ACCORDION)
// ═══════════════════════════════════════════════════════════

function openSidebar() {
  const drawer = document.getElementById('sidebar-drawer');
  const overlay = document.getElementById('sidebar-overlay');
  if (drawer && overlay) {
    drawer.classList.add('open');
    overlay.classList.add('open');
  }
}

function closeSidebar() {
  const drawer = document.getElementById('sidebar-drawer');
  const overlay = document.getElementById('sidebar-overlay');
  if (drawer && overlay) {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }
}

function toggleBranch(headerElement) {
  const branchItem = headerElement.parentElement;
  if (branchItem) {
    branchItem.classList.toggle('expanded');
  }
}
