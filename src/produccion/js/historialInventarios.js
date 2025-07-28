/**
 * Módulo para gestionar el historial de inventarios
 * Maneja la visualización de inventarios realizados y sus detalles
 */

// Variables globales
let inventariosData = [];
let usuariosMap = new Map(); // Cache de usuarios para evitar múltiples consultas

/**
 * Formatea una fecha para mostrar de forma legible
 * @param {string} fechaString - Fecha en formato ISO
 * @returns {string} - Fecha formateada
 */
function formatearFecha(fechaString) {
    if (!fechaString) return 'N/A';
    
    try {
        const fecha = new Date(fechaString);
        return fecha.toLocaleString('es-AR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch (error) {
        console.error('Error al formatear fecha:', error);
        return fechaString;
    }
}

/**
 * Formatea un número para mostrar de forma legible
 * @param {number} valor - El valor numérico a formatear
 * @returns {string} - El valor formateado como string
 */
function formatearNumero(valor) {
    if (valor === null || valor === undefined || isNaN(valor)) {
        return '0';
    }
    
    const numero = Number(valor);
    
    // Si el valor es prácticamente cero
    if (Math.abs(numero) < 0.001) {
        return '0';
    }
    
    // Redondear a 2 decimales y eliminar ceros innecesarios
    return numero.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Muestra un mensaje de error en la interfaz
 * @param {string} mensaje - Mensaje de error a mostrar
 */
function mostrarError(mensaje) {
    console.error('Error en historial de inventarios:', mensaje);
    
    const loadingElement = document.getElementById('loading-message');
    const errorElement = document.getElementById('error-message');
    const tablaContainer = document.getElementById('tabla-container');
    const sinDatos = document.getElementById('sin-datos');
    
    loadingElement.style.display = 'none';
    tablaContainer.style.display = 'none';
    sinDatos.style.display = 'none';
    errorElement.style.display = 'block';
    errorElement.textContent = mensaje;
}

/**
 * Muestra mensaje cuando no hay datos
 */
function mostrarSinDatos() {
    const loadingElement = document.getElementById('loading-message');
    const errorElement = document.getElementById('error-message');
    const tablaContainer = document.getElementById('tabla-container');
    const sinDatos = document.getElementById('sin-datos');
    
    loadingElement.style.display = 'none';
    errorElement.style.display = 'none';
    tablaContainer.style.display = 'none';
    sinDatos.style.display = 'block';
}

/**
 * Muestra la tabla con datos
 */
function mostrarTabla() {
    const loadingElement = document.getElementById('loading-message');
    const errorElement = document.getElementById('error-message');
    const tablaContainer = document.getElementById('tabla-container');
    const sinDatos = document.getElementById('sin-datos');
    
    loadingElement.style.display = 'none';
    errorElement.style.display = 'none';
    sinDatos.style.display = 'none';
    tablaContainer.style.display = 'block';
}

/**
 * Carga la lista de usuarios y los almacena en cache
 */
async function cargarUsuarios() {
    try {
        console.log('🔄 Cargando usuarios para cache...');
        const response = await fetch('/api/usuarios');
        
        if (!response.ok) {
            throw new Error(`Error al cargar usuarios: ${response.status}`);
        }
        
        const usuarios = await response.json();
        
        // Crear mapa de usuarios para acceso rápido
        usuariosMap.clear();
        usuarios.forEach(usuario => {
            usuariosMap.set(usuario.id, usuario.nombre_completo || `Usuario ${usuario.id}`);
        });
        
        console.log(`✅ ${usuarios.length} usuarios cargados en cache`);
        
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        // No es crítico, continuamos sin nombres de usuario
    }
}

/**
 * Obtiene el nombre de un usuario por su ID
 * @param {number} usuarioId - ID del usuario
 * @returns {string} - Nombre del usuario o ID como fallback
 */
function obtenerNombreUsuario(usuarioId) {
    if (!usuarioId) return 'Usuario desconocido';
    
    const nombre = usuariosMap.get(usuarioId);
    return nombre || `Usuario ID: ${usuarioId}`;
}

/**
 * Carga el historial de inventarios desde el backend
 */
async function cargarHistorialInventarios() {
    try {
        console.log('🔄 [HISTORIAL] Iniciando carga de historial de inventarios...');
        
        // Primero cargar usuarios para el cache
        await cargarUsuarios();
        
        // Luego cargar el historial de inventarios
        console.log('🔄 [HISTORIAL] Consultando endpoint de historial...');
        
        // NOTA: Este endpoint debe ser implementado en el backend
        // Por ahora, propongo la estructura que debería tener
        const response = await fetch('/api/produccion/inventarios/historial');
        
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Endpoint de historial no implementado. Contacte al administrador del sistema.');
            }
            throw new Error(`Error del servidor: ${response.status} - ${response.statusText}`);
        }
        
        const historial = await response.json();
        console.log('✅ [HISTORIAL] Datos recibidos:', historial);
        
        if (!Array.isArray(historial)) {
            throw new Error('Formato de respuesta inválido: se esperaba un array');
        }
        
        inventariosData = historial;
        
        if (historial.length === 0) {
            mostrarSinDatos();
        } else {
            renderizarTablaHistorial(historial);
            mostrarTabla();
        }
        
    } catch (error) {
        console.error('❌ [HISTORIAL] Error al cargar historial:', error);
        
        // Mostrar mensaje específico según el tipo de error
        if (error.message.includes('Endpoint de historial no implementado')) {
            mostrarError('⚠️ Funcionalidad en desarrollo. El endpoint del historial de inventarios aún no está implementado en el backend.');
        } else if (error.message.includes('Failed to fetch')) {
            mostrarError('❌ Error de conexión. Verifique que el servidor esté funcionando.');
        } else {
            mostrarError(`❌ Error al cargar el historial: ${error.message}`);
        }
    }
}

/**
 * Renderiza la tabla principal con el historial de inventarios
 * @param {Array} inventarios - Lista de inventarios
 */
function renderizarTablaHistorial(inventarios) {
    console.log('🎨 [HISTORIAL] Renderizando tabla con', inventarios.length, 'inventarios');
    
    const tbody = document.getElementById('tabla-historial-body');
    tbody.innerHTML = '';
    
    inventarios.forEach((inventario, index) => {
        const tr = document.createElement('tr');
        tr.dataset.inventarioId = inventario.inventario_id;
        
        // Calcular totales
        const totalArticulos = inventario.total_articulos || 0;
        const totalDiferencias = inventario.total_diferencias || 0;
        
        // Determinar badge para diferencias
        let badgeDiferencias = '';
        if (totalDiferencias === 0) {
            badgeDiferencias = '<span class="badge badge-success">Sin diferencias</span>';
        } else if (totalDiferencias <= 5) {
            badgeDiferencias = `<span class="badge badge-warning">${totalDiferencias} diferencias</span>`;
        } else {
            badgeDiferencias = `<span class="badge badge-danger">${totalDiferencias} diferencias</span>`;
        }
        
        tr.innerHTML = `
            <td><strong>#${inventario.inventario_id}</strong></td>
            <td>${formatearFecha(inventario.fecha_creacion)}</td>
            <td>${obtenerNombreUsuario(inventario.usuario_id)}</td>
            <td>${totalArticulos}</td>
            <td>${badgeDiferencias}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-detalle" onclick="toggleStockRegistrado(${inventario.inventario_id})">
                        📋 Ver Stock Registrado
                    </button>
                    <button class="btn-diferencias" onclick="toggleDiferencias(${inventario.inventario_id})">
                        ⚠️ Ver Diferencias
                    </button>
                </div>
                <div id="detalle-stock-${inventario.inventario_id}" class="detalle-section">
                    <h4>📋 Stock Registrado - Inventario #${inventario.inventario_id}</h4>
                    <div id="contenido-stock-${inventario.inventario_id}">
                        <div class="loading">Cargando datos...</div>
                    </div>
                </div>
                <div id="detalle-diferencias-${inventario.inventario_id}" class="detalle-section">
                    <h4>⚠️ Diferencias Encontradas - Inventario #${inventario.inventario_id}</h4>
                    <div id="contenido-diferencias-${inventario.inventario_id}">
                        <div class="loading">Cargando datos...</div>
                    </div>
                </div>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
    
    console.log('✅ [HISTORIAL] Tabla renderizada correctamente');
}

/**
 * Alterna la visibilidad de la sección de stock registrado
 * @param {number} inventarioId - ID del inventario
 */
async function toggleStockRegistrado(inventarioId) {
    console.log('🔄 [DETALLE] Toggle stock registrado para inventario:', inventarioId);
    
    const detalleElement = document.getElementById(`detalle-stock-${inventarioId}`);
    const contenidoElement = document.getElementById(`contenido-stock-${inventarioId}`);
    
    if (detalleElement.classList.contains('active')) {
        // Si ya está activo, ocultarlo
        detalleElement.classList.remove('active');
        return;
    }
    
    // Mostrar la sección
    detalleElement.classList.add('active');
    
    // Si ya se cargaron los datos, no volver a cargar
    if (contenidoElement.dataset.loaded === 'true') {
        return;
    }
    
    try {
        // Cargar datos del stock registrado
        console.log('🔄 [DETALLE] Cargando stock registrado...');
        
        // NOTA: Este endpoint debe ser implementado en el backend
        const response = await fetch(`/api/produccion/inventarios/${inventarioId}/stock-registrado`);
        
        if (!response.ok) {
            throw new Error(`Error al cargar stock registrado: ${response.status}`);
        }
        
        const stockData = await response.json();
        console.log('✅ [DETALLE] Stock registrado cargado:', stockData);
        
        renderizarStockRegistrado(contenidoElement, stockData);
        contenidoElement.dataset.loaded = 'true';
        
    } catch (error) {
        console.error('❌ [DETALLE] Error al cargar stock registrado:', error);
        contenidoElement.innerHTML = `
            <div class="mensaje-error">
                ❌ Error al cargar los datos: ${error.message}
                <br><small>Endpoint sugerido: /api/produccion/inventarios/${inventarioId}/stock-registrado</small>
            </div>
        `;
    }
}

/**
 * Alterna la visibilidad de la sección de diferencias
 * @param {number} inventarioId - ID del inventario
 */
async function toggleDiferencias(inventarioId) {
    console.log('🔄 [DIFERENCIAS] Toggle diferencias para inventario:', inventarioId);
    
    const detalleElement = document.getElementById(`detalle-diferencias-${inventarioId}`);
    const contenidoElement = document.getElementById(`contenido-diferencias-${inventarioId}`);
    
    if (detalleElement.classList.contains('active')) {
        // Si ya está activo, ocultarlo
        detalleElement.classList.remove('active');
        return;
    }
    
    // Mostrar la sección
    detalleElement.classList.add('active');
    
    // Si ya se cargaron los datos, no volver a cargar
    if (contenidoElement.dataset.loaded === 'true') {
        return;
    }
    
    try {
        // Cargar datos de las diferencias
        console.log('🔄 [DIFERENCIAS] Cargando diferencias...');
        
        // NOTA: Este endpoint debe ser implementado en el backend
        const response = await fetch(`/api/produccion/inventarios/${inventarioId}/diferencias`);
        
        if (!response.ok) {
            throw new Error(`Error al cargar diferencias: ${response.status}`);
        }
        
        const diferenciasData = await response.json();
        console.log('✅ [DIFERENCIAS] Diferencias cargadas:', diferenciasData);
        
        renderizarDiferencias(contenidoElement, diferenciasData);
        contenidoElement.dataset.loaded = 'true';
        
    } catch (error) {
        console.error('❌ [DIFERENCIAS] Error al cargar diferencias:', error);
        contenidoElement.innerHTML = `
            <div class="mensaje-error">
                ❌ Error al cargar los datos: ${error.message}
                <br><small>Endpoint sugerido: /api/produccion/inventarios/${inventarioId}/diferencias</small>
            </div>
        `;
    }
}

/**
 * Renderiza la tabla de stock registrado
 * @param {HTMLElement} contenedor - Elemento contenedor
 * @param {Array} stockData - Datos del stock registrado
 */
function renderizarStockRegistrado(contenedor, stockData) {
    console.log('🎨 [DETALLE] Renderizando stock registrado:', stockData.length, 'registros');
    
    if (!Array.isArray(stockData) || stockData.length === 0) {
        contenedor.innerHTML = '<div class="mensaje-info">No hay registros de stock para este inventario.</div>';
        return;
    }
    
    let html = `
        <table class="tabla-detalle">
            <thead>
                <tr>
                    <th>Código Artículo</th>
                    <th>Nombre</th>
                    <th>Stock Sistema</th>
                    <th>Stock Contado</th>
                    <th>Fecha Registro</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    stockData.forEach(registro => {
        html += `
            <tr>
                <td><strong>${registro.articulo_numero}</strong></td>
                <td>${registro.nombre_articulo || 'N/A'}</td>
                <td>${formatearNumero(registro.stock_sistema)}</td>
                <td>${formatearNumero(registro.stock_contado)}</td>
                <td>${formatearFecha(registro.fecha_registro)}</td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    `;
    
    contenedor.innerHTML = html;
}

/**
 * Renderiza la tabla de diferencias
 * @param {HTMLElement} contenedor - Elemento contenedor
 * @param {Array} diferenciasData - Datos de las diferencias
 */
function renderizarDiferencias(contenedor, diferenciasData) {
    console.log('🎨 [DIFERENCIAS] Renderizando diferencias:', diferenciasData.length, 'registros');
    
    if (!Array.isArray(diferenciasData) || diferenciasData.length === 0) {
        contenedor.innerHTML = '<div class="mensaje-info">✅ No se encontraron diferencias en este inventario.</div>';
        return;
    }
    
    let html = `
        <table class="tabla-detalle">
            <thead>
                <tr>
                    <th>Código Artículo</th>
                    <th>Nombre</th>
                    <th>Stock Sistema</th>
                    <th>Stock Contado</th>
                    <th>Diferencia</th>
                    <th>Fecha Registro</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    diferenciasData.forEach(diferencia => {
        const stockSistema = Number(diferencia.stock_sistema) || 0;
        const stockContado = Number(diferencia.stock_contado) || 0;
        const diferenciaCalculada = stockContado - stockSistema;
        
        // Determinar clase CSS para la diferencia
        let claseDiferencia = 'diferencia-cero';
        let simboloDiferencia = '';
        
        if (diferenciaCalculada > 0) {
            claseDiferencia = 'diferencia-positiva';
            simboloDiferencia = '+';
        } else if (diferenciaCalculada < 0) {
            claseDiferencia = 'diferencia-negativa';
        }
        
        html += `
            <tr>
                <td><strong>${diferencia.articulo_numero}</strong></td>
                <td>${diferencia.nombre_articulo || 'N/A'}</td>
                <td>${formatearNumero(stockSistema)}</td>
                <td>${formatearNumero(stockContado)}</td>
                <td class="${claseDiferencia}">
                    ${simboloDiferencia}${formatearNumero(Math.abs(diferenciaCalculada))}
                </td>
                <td>${formatearFecha(diferencia.fecha_registro)}</td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    `;
    
    contenedor.innerHTML = html;
}

// Hacer las funciones globales para que puedan ser llamadas desde el HTML
window.toggleStockRegistrado = toggleStockRegistrado;
window.toggleDiferencias = toggleDiferencias;

// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    console.log('📋 [HISTORIAL] Página de historial de inventarios cargada');
    cargarHistorialInventarios();
});

// Exportar funciones para testing si es necesario
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        cargarHistorialInventarios,
        formatearFecha,
        formatearNumero,
        obtenerNombreUsuario
    };
}
