// Variables globales para el inventario y ajustes de ingredientes
let usuarioSeleccionado = null;
let usuarioAjustes = null;
let ingredientesInventario = new Map(); // Mapa para almacenar los ingredientes escaneados
let ingredientesSeleccionados = new Map(); // Mapa para almacenar los ingredientes seleccionados para ajuste
let socket = null;
let sessionId = null;
let modoSeleccion = false;

// Variables globales para filtrado
let todosLosIngredientes = []; // Array para almacenar todos los ingredientes cargados
let ingredientesFiltrados = []; // Array para almacenar los ingredientes filtrados

/**
 * Formatea un número para mostrar de forma legible
 * - Redondea a 2 decimales máximo
 * - Elimina decimales innecesarios (.00)
 * - Maneja valores muy pequeños como 0
 * @param {number} valor - El valor numérico a formatear
 * @returns {string} - El valor formateado como string
 */
function formatearNumero(valor) {
    if (valor === null || valor === undefined || isNaN(valor)) {
        return '0';
    }
    
    const numero = Number(valor);
    
    // Si el valor es prácticamente cero (debido a precisión de punto flotante)
    if (Math.abs(numero) < 0.001) {
        return '0';
    }
    
    // Redondear a 2 decimales y eliminar ceros innecesarios
    return numero.toFixed(2).replace(/\.?0+$/, '');
}

// Función para mostrar mensajes
function mostrarMensaje(mensaje, tipo = 'error') {
    const mensajeDiv = document.createElement('div');
    mensajeDiv.className = tipo === 'error' ? 'mensaje-error' : 'mensaje-info';
    mensajeDiv.textContent = mensaje;
    
    // Remover mensaje anterior si existe
    const mensajeAnterior = document.querySelector('.mensaje-error, .mensaje-info');
    if (mensajeAnterior) {
        mensajeAnterior.remove();
    }
    
    const contentSection = document.querySelector('.content-section');
    if (contentSection) {
        contentSection.insertBefore(mensajeDiv, contentSection.firstChild);
    }
    
    // Remover el mensaje después de 3 segundos
    setTimeout(() => {
        if (mensajeDiv.parentNode) {
            mensajeDiv.parentNode.removeChild(mensajeDiv);
        }
    }, 3000);
}

// Función para actualizar la tabla con los ingredientes
function actualizarTablaIngredientes(ingredientes) {
    console.log('🔄 [DEBUG] actualizarTablaIngredientes - Iniciando actualización de tabla');
    console.log('🔄 [DEBUG] Cantidad de ingredientes recibidos:', ingredientes?.length || 0);
    
    const tbody = document.getElementById('tabla-ingredientes-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!ingredientes || ingredientes.length === 0) {
        const colspan = modoSeleccion ? 6 : 5;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="mensaje-info">No hay ingredientes registrados</td></tr>`;
        return;
    }

    ingredientes.forEach((ingrediente, index) => {
        const stockActual = ingrediente.stock_actual || 0;
        console.log(`📊 [DEBUG] Ingrediente ${index + 1}: ${ingrediente.nombre} - Stock Actual: ${stockActual}`);
        
        const tr = document.createElement('tr');
        const checkboxHtml = modoSeleccion ? `
            <td class="checkbox-cell">
                <input type="checkbox" 
                       class="checkbox-ingrediente" 
                       data-ingrediente="${ingrediente.id}"
                       ${ingredientesSeleccionados.has(ingrediente.id.toString()) ? 'checked' : ''}>
            </td>` : '';
        
        tr.innerHTML = `
            ${checkboxHtml}
            <td>${ingrediente.id}</td>
            <td>${ingrediente.nombre}</td>
            <td>${ingrediente.codigo || '-'}</td>
            <td>${formatearNumero(stockActual)} ${ingrediente.unidad_medida || 'kg'}</td>
        `;
        tbody.appendChild(tr);
    });
    
    console.log('✅ [DEBUG] actualizarTablaIngredientes - Tabla actualizada correctamente');

    // Actualizar eventos de los checkboxes si estamos en modo selección
    if (modoSeleccion) {
        const checkboxes = tbody.querySelectorAll('.checkbox-ingrediente');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                const ingredienteId = this.dataset.ingrediente;
                const ingrediente = todosLosIngredientes.find(i => i.id.toString() === ingredienteId);
                
                if (this.checked) {
                    ingredientesSeleccionados.set(ingredienteId, ingrediente);
                } else {
                    ingredientesSeleccionados.delete(ingredienteId);
                }
            });
        });
    }
}

// Funciones de filtrado
function filtrarPorNombre(ingredientes, texto) {
    if (!texto) return ingredientes;
    const textoLower = texto.toLowerCase();
    return ingredientes.filter(ingrediente => 
        ingrediente.nombre.toLowerCase().includes(textoLower)
    );
}

function filtrarPorStock(ingredientes, condicion) {
    console.log('🔍 [DEBUG] filtrarPorStock - Iniciando filtrado');
    console.log('🔍 [DEBUG] Condición de filtro:', condicion);
    console.log('🔍 [DEBUG] Cantidad de ingredientes a filtrar:', ingredientes.length);
    
    // Umbral para considerar un valor como "prácticamente cero"
    const UMBRAL_CERO = 0.01;

    let resultado;
    switch (condicion) {
        case 'igual-cero':
            resultado = ingredientes.filter(ingrediente => {
                const stock = ingrediente.stock_actual || 0;
                const esIgualCero = Math.abs(stock) <= UMBRAL_CERO;
                if (esIgualCero) {
                    console.log(`📊 [DEBUG] Ingrediente con stock = 0: ${ingrediente.nombre} (${stock})`);
                }
                return esIgualCero;
            });
            break;
        case 'mayor-cero':
            resultado = ingredientes.filter(ingrediente => {
                const stock = ingrediente.stock_actual || 0;
                const esMayorCero = stock > UMBRAL_CERO;
                if (esMayorCero) {
                    console.log(`📊 [DEBUG] Ingrediente con stock > 0: ${ingrediente.nombre} (${stock})`);
                }
                return esMayorCero;
            });
            break;
        case 'menor-cero':
            resultado = ingredientes.filter(ingrediente => {
                const stock = ingrediente.stock_actual || 0;
                const esMenorCero = stock < -UMBRAL_CERO;
                if (esMenorCero) {
                    console.log(`📊 [DEBUG] Ingrediente con stock < 0: ${ingrediente.nombre} (${stock})`);
                }
                return esMenorCero;
            });
            break;
        default:
            resultado = ingredientes;
    }
    
    console.log('✅ [DEBUG] filtrarPorStock - Filtrado completado');
    console.log('✅ [DEBUG] Ingredientes después del filtro:', resultado.length);
    return resultado;
}

function aplicarFiltros() {
    console.log('🔍 [DEBUG] aplicarFiltros - Iniciando aplicación de filtros');
    
    const textoFiltro = document.getElementById('filtro-nombre').value;
    const stockFiltro = document.getElementById('filtro-stock').value;
    
    console.log('🔍 [DEBUG] Filtros actuales:');
    console.log('- Texto:', textoFiltro);
    console.log('- Stock:', stockFiltro);
    console.log('- Total ingredientes antes de filtrar:', todosLosIngredientes.length);
    
    let ingredientesFiltrados = [...todosLosIngredientes];
    
    // Aplicar filtro de nombre
    if (textoFiltro) {
        console.log('📝 [DEBUG] Aplicando filtro por nombre:', textoFiltro);
        ingredientesFiltrados = filtrarPorNombre(ingredientesFiltrados, textoFiltro);
        console.log('📝 [DEBUG] Ingredientes después de filtrar por nombre:', ingredientesFiltrados.length);
    }
    
    // Aplicar filtro de stock
    if (stockFiltro !== 'todos') {
        console.log('📊 [DEBUG] Aplicando filtro por stock:', stockFiltro);
        ingredientesFiltrados = filtrarPorStock(ingredientesFiltrados, stockFiltro);
        console.log('📊 [DEBUG] Ingredientes después de filtrar por stock:', ingredientesFiltrados.length);
    }
    
    console.log('✅ [DEBUG] Filtrado completado');
    console.log('✅ [DEBUG] Total ingredientes después de filtrar:', ingredientesFiltrados.length);
    
    // Actualizar la tabla con los resultados filtrados
    actualizarTablaIngredientes(ingredientesFiltrados);
}

// Función para cargar los ingredientes
async function cargarIngredientes() {
    try {
        console.log('Cargando ingredientes...');
        const response = await fetch('/api/produccion/ingredientes');
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener los ingredientes');
        }

        const ingredientes = await response.json();
        console.log('Ingredientes cargados:', ingredientes.length);
        
        // Almacenar todos los ingredientes globalmente
        todosLosIngredientes = ingredientes;
        
        // Mostrar los ingredientes en la tabla
        actualizarTablaIngredientes(ingredientes);

    } catch (error) {
        console.error('Error al cargar ingredientes:', error);
        mostrarMensaje(error.message || 'No se pudieron cargar los ingredientes');
    }
}

// Funciones para el modal de inventario
function mostrarModal() {
    const modal = document.getElementById('modal-inventario');
    modal.style.display = 'block';
    document.getElementById('paso-usuario').style.display = 'block';
    document.getElementById('paso-conteo').style.display = 'none';
    cargarUsuarios();
}

function cerrarModal() {
    const modal = document.getElementById('modal-inventario');
    modal.style.display = 'none';
    reiniciarInventario();
}

function reiniciarInventario() {
    console.log('🧹 Reiniciando inventario...');
    usuarioSeleccionado = null;
    ingredientesInventario.clear();
    document.getElementById('select-usuario').value = '';
    document.getElementById('input-codigo-barras').value = '';
    document.getElementById('ingredientes-inventario').innerHTML = '';
    document.getElementById('btn-continuar-usuario').disabled = true;
    
    // Limpiar botones de prueba si existen
    const testButtons = document.getElementById('test-buttons');
    if (testButtons) {
        console.log('🧹 Eliminando botones de prueba existentes');
        testButtons.remove();
    }
    
    // Cerrar conexión WebSocket si existe
    if (socket) {
        console.log('🧹 Cerrando conexión WebSocket');
        socket.emit('finalizar_inventario', { sessionId });
        socket.disconnect();
        socket = null;
    }
    sessionId = null;
    sessionStorage.removeItem('usuarioInventario');
    console.log('🧹 Inventario reiniciado completamente');
}

async function cargarUsuarios() {
    try {
        console.log('🔄 Cargando usuarios...');
        
        // Limpiar botones de prueba existentes antes de cargar nuevos
        const testButtonsExistentes = document.getElementById('test-buttons');
        if (testButtonsExistentes) {
            console.log('🧹 Eliminando botones de prueba existentes antes de cargar');
            testButtonsExistentes.remove();
        }
        
        const response = await fetch('/api/usuarios?rol=3&activo=true');
        if (!response.ok) throw new Error('Error al cargar usuarios');
        
        const usuarios = await response.json();
        const select = document.getElementById('select-usuario');
        select.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
        
        usuarios.forEach(usuario => {
            const option = document.createElement('option');
            option.value = usuario.id;
            option.textContent = usuario.nombre_completo;
            select.appendChild(option);
        });
        
        console.log('✅ Usuarios cargados:', usuarios.length);
        
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        mostrarMensaje('No se pudieron cargar los usuarios');
    }
}

function mostrarPasoConteo() {
    document.getElementById('paso-usuario').style.display = 'none';
    document.getElementById('paso-conteo').style.display = 'block';
    
    // PRIMERO: Guardar el usuario seleccionado en la sesión
    const usuarioNombre = document.getElementById('select-usuario').options[document.getElementById('select-usuario').selectedIndex].text;
    sessionStorage.setItem('usuarioInventario', JSON.stringify({
        id: usuarioSeleccionado,
        nombre: usuarioNombre
    }));
    
    // DESPUÉS: Inicializar sesión de inventario de ingredientes
    inicializarSesionInventario();
    
    document.getElementById('input-codigo-barras').focus();
}

/**
 * Inicializa una nueva sesión de inventario de ingredientes
 */
async function inicializarSesionInventario() {
    try {
        console.log('🚀 [INVENTARIO] Iniciando sesión de inventario de ingredientes');
        
        // Generar ID de sesión único
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        sessionId = `inv_ing_${timestamp}_${random}`;
        
        console.log('🆔 [INVENTARIO] Session ID generado:', sessionId);
        
        // Obtener información del usuario
        const usuarioInfo = JSON.parse(sessionStorage.getItem('usuarioInventario') || '{}');
        console.log('👤 [INVENTARIO] Usuario seleccionado:', usuarioInfo);
        
        // Iniciar sesión en el backend
        const response = await fetch('/api/produccion/inventario-ingredientes/iniciar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuario_id: usuarioInfo.id,
                session_id: sessionId
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al iniciar sesión de inventario');
        }
        
        const resultado = await response.json();
        console.log('✅ [INVENTARIO] Sesión iniciada exitosamente:', resultado);
        
        // Generar código QR para acceso móvil
        generarCodigoQR();
        
        mostrarMensaje('Sesión de inventario iniciada correctamente', 'info');
        
    } catch (error) {
        console.error('❌ [INVENTARIO] Error al iniciar sesión:', error);
        mostrarMensaje('Error al iniciar sesión de inventario: ' + error.message);
    }
}

/**
 * Genera el código QR para acceso móvil al inventario
 */
function generarCodigoQR() {
    try {
        console.log('🔗 [PC] ===== GENERANDO CÓDIGO QR =====');
        console.log('🔗 [PC] Timestamp:', new Date().toISOString());
        console.log('🔗 [PC] Session ID actual:', sessionId);
        console.log('🔗 [PC] Tipo de sessionId:', typeof sessionId);
        console.log('🔗 [PC] Longitud sessionId:', sessionId?.length);
        
        // Validar sessionId antes de generar QR
        if (!sessionId) {
            console.error('❌ [PC] ERROR: sessionId es null/undefined');
            mostrarMensaje('Error: No hay ID de sesión válido', 'error');
            return;
        }
        
        if (!sessionId.startsWith('inv_ing_')) {
            console.error('❌ [PC] ERROR: sessionId no tiene formato válido:', sessionId);
            mostrarMensaje('Error: Formato de sesión inválido', 'error');
            return;
        }
        
        // Usar la URL de Cloudflare para acceso externo
        const baseUrl = 'https://inventario.lamdaser.com';
        // Mantener la ruta original a /pages/inventario-movil.html (reutilizar la misma página móvil)
        const urlMovil = `${baseUrl}/pages/inventario-movil.html?session=${encodeURIComponent(sessionId)}`;
        
        console.log('🔗 [PC] URL base (Cloudflare):', baseUrl);
        console.log('🔗 [PC] URL generada para el QR:', urlMovil);
        console.log('🔗 [PC] Session ID en URL:', sessionId);
        console.log('🔗 [PC] Verificando formato URL...');
        
        // Verificar que la URL se construyó correctamente
        try {
            const testUrl = new URL(urlMovil);
            const testSessionId = testUrl.searchParams.get('session');
            console.log('🔗 [PC] URL parseada correctamente');
            console.log('🔗 [PC] Session ID extraído de URL de prueba:', testSessionId);
            
            if (testSessionId !== sessionId) {
                console.error('❌ [PC] ERROR: Session ID no coincide en URL');
                console.error('❌ [PC] Original:', sessionId);
                console.error('❌ [PC] Extraído:', testSessionId);
                mostrarMensaje('Error: Problema al generar URL', 'error');
                return;
            }
        } catch (urlError) {
            console.error('❌ [PC] ERROR: URL malformada:', urlError);
            mostrarMensaje('Error: URL inválida generada', 'error');
            return;
        }
        
        // Mostrar la URL en texto para debugging
        document.getElementById('url-movil').textContent = urlMovil;
        
        // Verificar si la librería QRCode está disponible
        if (typeof QRCode === 'undefined') {
            console.error('❌ [PC] La librería QRCode no está cargada');
            mostrarMensaje('Error: Librería QR no disponible', 'error');
            return;
        }
        
        // Verificar si el contenedor existe
        const qrContainer = document.getElementById('qr-canvas');
        if (!qrContainer) {
            console.error('❌ [PC] Contenedor qr-canvas no encontrado');
            mostrarMensaje('Error: Contenedor QR no encontrado', 'error');
            return;
        }
        
        // Limpiar contenido anterior
        qrContainer.innerHTML = '';
        
        console.log('Contenedor encontrado:', qrContainer);
        console.log('QRCode disponible:', typeof QRCode);
        
        // Generar el código QR usando la API de qrcodejs
        const qrcode = new QRCode(qrContainer, {
            text: urlMovil,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#FFFFFF',
            correctLevel: QRCode.CorrectLevel.M
        });
        
        console.log('✅ [PC] Código QR generado correctamente');
        
    } catch (error) {
        console.error('❌ [PC] Error en generarCodigoQR:', error);
        mostrarMensaje('Error al generar código QR: ' + error.message, 'error');
    }
}

async function buscarIngredientePorCodigo(codigoBarras) {
    try {
        const response = await fetch(`/api/produccion/ingredientes/buscar?codigo=${codigoBarras}`);
        if (!response.ok) throw new Error('Ingrediente no encontrado');
        return await response.json();
    } catch (error) {
        console.error('Error al buscar ingrediente:', error);
        mostrarMensaje('Ingrediente no encontrado');
        return null;
    }
}

function agregarIngredienteAInventario(ingrediente, cantidadInicial = 0) {
    console.log('🚀 EJECUTANDO agregarIngredienteAInventario');
    console.log('🚀 Ingrediente recibido:', ingrediente);
    console.log('🚀 Cantidad inicial:', cantidadInicial);
    console.log('🚀 Ingredientes en inventario actual:', ingredientesInventario.size);
    
    if (ingredientesInventario.has(ingrediente.id.toString())) {
        console.log('⚠️ Ingrediente ya existe en inventario');
        // Si el ingrediente ya existe, actualizar la cantidad si viene del móvil
        if (cantidadInicial > 0) {
            const input = document.querySelector(`input[data-ingrediente="${ingrediente.id}"]`);
            if (input) {
                input.value = cantidadInicial;
                mostrarMensaje(`Cantidad actualizada para ${ingrediente.nombre}: ${cantidadInicial}`, 'info');
                console.log('✅ Cantidad actualizada en input existente');
            } else {
                console.error('❌ No se encontró el input para actualizar');
            }
        } else {
            mostrarMensaje('Este ingrediente ya fue agregado al inventario', 'info');
        }
        return;
    }

    console.log('➕ Creando nuevo elemento para el ingrediente');
    const div = document.createElement('div');
    div.className = 'inventario-item';
    div.innerHTML = `
        <h4>${ingrediente.nombre}</h4>
        <div class="info-row">
            <span>ID: ${ingrediente.id}</span>
            <span>Código: ${ingrediente.codigo || '-'}</span>
            <span>Stock Actual: ${formatearNumero(ingrediente.stock_actual || 0)} ${ingrediente.unidad_medida || 'kg'}</span>
        </div>
        <div class="stock-input">
            <label>Stock Físico (${ingrediente.unidad_medida || 'kg'}):</label>
            <input type="number" min="0" step="0.01" class="stock-fisico" 
                   data-ingrediente="${ingrediente.id}" value="${cantidadInicial}">
        </div>
    `;

    console.log('🔍 Buscando contenedor ingredientes-inventario');
    // Insertar al principio del contenedor para que aparezca arriba
    const contenedor = document.getElementById('ingredientes-inventario');
    if (!contenedor) {
        console.error('❌ ERROR CRÍTICO: No se encontró el contenedor ingredientes-inventario');
        mostrarMensaje('Error: No se pudo agregar el ingrediente al formulario', 'error');
        return;
    }
    
    console.log('✅ Contenedor encontrado, insertando elemento');
    contenedor.insertBefore(div, contenedor.firstChild);
    ingredientesInventario.set(ingrediente.id.toString(), ingrediente);
    
    console.log('✅ Ingrediente agregado al Map. Total ingredientes:', ingredientesInventario.size);
    
    // Mostrar el botón "Mostrar Diferencias" si hay ingredientes
    if (ingredientesInventario.size > 0) {
        document.getElementById('btn-mostrar-diferencias').style.display = 'inline-block';
    }
    
    // Si viene del móvil, mostrar mensaje
    if (cantidadInicial > 0) {
        mostrarMensaje(`Ingrediente agregado desde móvil: ${ingrediente.nombre}`, 'info');
        console.log('✅ Mensaje de confirmación mostrado');
    }
    
    console.log('🎉 agregarIngredienteAInventario completado exitosamente');
}

async function finalizarInventario() {
    if (ingredientesInventario.size === 0) {
        mostrarMensaje('No hay ingredientes para registrar', 'error');
        return;
    }

    try {
        console.log('🔧 [INVENTARIO] Finalizando inventario de ingredientes...');
        
        // Registrar cada ingrediente contado
        const inputs = document.querySelectorAll('.stock-fisico');
        
        for (const input of inputs) {
            const ingredienteId = input.dataset.ingrediente;
            const ingrediente = ingredientesInventario.get(ingredienteId);
            const stockContado = parseFloat(input.value) || 0;
            
            console.log(`📝 [INVENTARIO] Registrando: ${ingrediente.nombre} - Stock contado: ${stockContado}`);
            
            // Registrar ingrediente contado
            const response = await fetch('/api/produccion/inventario-ingredientes/contar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: sessionId,
                    ingrediente_id: parseInt(ingredienteId),
                    stock_contado: stockContado,
                    codigo_barras: ingrediente.codigo
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Error al registrar ${ingrediente.nombre}: ${errorData.error}`);
            }
        }
        
        // Aplicar ajustes de inventario
        const ajustesResponse = await fetch(`/api/produccion/inventario-ingredientes/${sessionId}/aplicar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!ajustesResponse.ok) {
            const errorData = await ajustesResponse.json();
            throw new Error(errorData.error || 'Error al aplicar ajustes');
        }
        
        const resultado = await ajustesResponse.json();
        console.log('✅ [INVENTARIO] Inventario finalizado:', resultado);
        
        mostrarMensaje(`Inventario registrado correctamente. ${resultado.ajustes_aplicados} ajustes aplicados.`, 'info');
        cerrarModal();
        cargarIngredientes(); // Recargar la tabla de ingredientes
        
    } catch (error) {
        console.error('❌ [INVENTARIO] Error al finalizar inventario:', error);
        mostrarMensaje('Error al registrar el inventario: ' + error.message);
    }
}

// Funciones para ajustes puntuales
function iniciarAjustesPuntuales() {
    mostrarModalAjustes();
}

function mostrarModalAjustes() {
    const modal = document.getElementById('modal-ajustes');
    modal.style.display = 'block';
    document.getElementById('paso-usuario-ajustes').style.display = 'block';
    document.getElementById('paso-ajuste').style.display = 'none';
    cargarUsuariosAjustes();
}

function activarModoSeleccion() {
    modoSeleccion = true;
    ingredientesSeleccionados.clear();
    document.querySelector('.tabla-ingredientes').classList.add('modo-seleccion');
    document.getElementById('btn-ajustes-puntuales').style.display = 'none';
    document.getElementById('btn-confirmar-seleccion').style.display = 'inline-block';
    actualizarTablaIngredientes(ingredientesFiltrados.length > 0 ? ingredientesFiltrados : todosLosIngredientes);
}

function cerrarModalAjustes(reiniciarTodo = true) {
    const modal = document.getElementById('modal-ajustes');
    modal.style.display = 'none';
    
    if (reiniciarTodo) {
        reiniciarAjustes();
    }
}

function reiniciarAjustes() {
    usuarioAjustes = null;
    ingredientesSeleccionados.clear();
    modoSeleccion = false;
    document.querySelector('.tabla-ingredientes').classList.remove('modo-seleccion');
    document.getElementById('select-usuario-ajustes').value = '';
    document.getElementById('btn-continuar-ajustes').disabled = true;
    document.getElementById('ingredientes-seleccionados').innerHTML = '';
    document.getElementById('btn-ajustes-puntuales').style.display = 'inline-block';
    document.getElementById('btn-confirmar-seleccion').style.display = 'none';
    actualizarTablaIngredientes(ingredientesFiltrados.length > 0 ? ingredientesFiltrados : todosLosIngredientes);
}

async function cargarUsuariosAjustes() {
    try {
        const response = await fetch('/api/usuarios?rol=3&activo=true');
        if (!response.ok) throw new Error('Error al cargar usuarios');
        
        const usuarios = await response.json();
        const select = document.getElementById('select-usuario-ajustes');
        select.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
        
        usuarios.forEach(usuario => {
            const option = document.createElement('option');
            option.value = usuario.id;
            option.textContent = usuario.nombre_completo;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        mostrarMensaje('No se pudieron cargar los usuarios');
    }
}

function mostrarPasoAjuste() {
    document.getElementById('paso-usuario-ajustes').style.display = 'none';
    document.getElementById('paso-ajuste').style.display = 'block';
    mostrarIngredientesSeleccionados();
}

function mostrarIngredientesSeleccionados() {
    const contenedor = document.getElementById('ingredientes-seleccionados');
    contenedor.innerHTML = '';

    ingredientesSeleccionados.forEach(ingrediente => {
        const div = document.createElement('div');
        div.className = 'ajuste-item';
        const stockActual = ingrediente.stock_actual || 0;
        
        div.innerHTML = `
            <h4>${ingrediente.nombre}</h4>
            <div class="info-row">
                <span>ID: ${ingrediente.id}</span>
                <span>Código: ${ingrediente.codigo || '-'}</span>
                <span>Stock Actual: ${formatearNumero(stockActual)} ${ingrediente.unidad_medida || 'kg'}</span>
            </div>
            <div class="stock-input">
                <label>Stock Físico (${ingrediente.unidad_medida || 'kg'}):</label>
                <input type="number" 
                       min="0" 
                       step="0.01" 
                       class="stock-nuevo" 
                       data-ingrediente="${ingrediente.id}"
                       data-stock-actual="${stockActual}"
                       value="${stockActual}">
            </div>
        `;
        contenedor.appendChild(div);
    });

    // Agregar listeners para validación de inputs
    const inputs = contenedor.querySelectorAll('.stock-nuevo');
    inputs.forEach(input => {
        input.addEventListener('change', function() {
            const valor = parseFloat(this.value) || 0;
            if (valor < 0) {
                this.value = 0;
                mostrarMensaje('El stock no puede ser negativo', 'error');
            }
        });
    });
}

async function finalizarAjustes() {
    if (ingredientesSeleccionados.size === 0) {
        mostrarMensaje('No hay ingredientes seleccionados para ajustar', 'error');
        return;
    }

    try {
        console.log('🔧 [AJUSTES] Finalizando ajustes de ingredientes...');
        console.log('🔧 [AJUSTES] Usuario de ajustes:', usuarioAjustes, typeof usuarioAjustes);
        
        const inputs = document.querySelectorAll('.stock-nuevo');
        let hayAjustes = false;
        
        for (const input of inputs) {
            const ingredienteId = input.dataset.ingrediente;
            const ingrediente = ingredientesSeleccionados.get(ingredienteId);
            
            // 🔧 VALIDACIÓN CRÍTICA: Verificar que el ingrediente existe
            if (!ingrediente) {
                console.error(`❌ [AJUSTES] ERROR: No se encontró ingrediente con ID ${ingredienteId}`);
                continue;
            }
            
            // 🔧 VALIDACIÓN CRÍTICA: Verificar que el ingrediente tiene nombre
            if (!ingrediente.nombre || ingrediente.nombre.trim() === '') {
                console.error(`❌ [AJUSTES] ERROR: Ingrediente ${ingredienteId} no tiene nombre válido:`, ingrediente);
                continue;
            }
            
            const stockNuevo = parseFloat(input.value) || 0;
            const stockActual = ingrediente.stock_actual || 0;
            const diferencia = stockNuevo - stockActual;
            
            console.log(`🔍 [AJUSTES] Procesando ingrediente:`, {
                id: ingredienteId,
                nombre: ingrediente.nombre,
                stockActual: stockActual,
                stockNuevo: stockNuevo,
                diferencia: diferencia
            });
            
            // Solo registrar si hay diferencia significativa
            if (Math.abs(diferencia) > 0.001) {
                hayAjustes = true;
                
                console.log(`📝 [AJUSTES] Registrando ajuste: ${ingrediente.nombre} - Diferencia: ${diferencia}`);
                
                // Usar el endpoint existente ingredientes_movimientos
                const tipoMovimiento = diferencia > 0 ? 'ingreso' : 'egreso';
                const cantidadAjuste = Math.abs(diferencia);
                
                // 🔧 VALIDACIÓN CRÍTICA: Verificar que cantidadAjuste es válida
                if (isNaN(cantidadAjuste) || cantidadAjuste <= 0) {
                    console.error(`❌ [AJUSTES] ERROR: Cantidad de ajuste inválida para ${ingrediente.nombre}:`, cantidadAjuste);
                    continue;
                }
                
                // 🔧 VALIDACIÓN CRÍTICA: Verificar que ingredienteId es válido
                const ingredienteIdNum = parseInt(ingredienteId);
                if (isNaN(ingredienteIdNum) || ingredienteIdNum <= 0) {
                    console.error(`❌ [AJUSTES] ERROR: ID de ingrediente inválido:`, ingredienteId);
                    continue;
                }
                
                const payload = {
                    ingrediente_id: ingredienteIdNum,
                    kilos: cantidadAjuste,
                    tipo: tipoMovimiento,
                    carro_id: null,
                    observaciones: `Ajuste puntual - Usuario: ${usuarioAjustes}`
                };
                
                console.log(`📤 [AJUSTES] Enviando payload:`, payload);
                
                const response = await fetch('/api/produccion/ingredientes_movimientos', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    console.error(`❌ [AJUSTES] Error del servidor para ${ingrediente.nombre}:`, errorData);
                    throw new Error(`Error al ajustar ${ingrediente.nombre}: ${errorData.error}`);
                }
                
                console.log(`✅ [AJUSTES] Ajuste registrado exitosamente para ${ingrediente.nombre}`);
            }
        }

        if (!hayAjustes) {
            mostrarMensaje('No hay ajustes para registrar', 'info');
            cerrarModalAjustes();
            return;
        }

        mostrarMensaje('Ajustes registrados correctamente', 'info');
        cerrarModalAjustes();
        await cargarIngredientes(); // Recargar ingredientes después de ajustes
        
    } catch (error) {
        console.error('❌ [AJUSTES] Error al finalizar ajustes:', error);
        mostrarMensaje('Error al registrar los ajustes: ' + error.message);
    }
}

/**
 * Compara el stock contado vs el stock del sistema
 */
async function compararStock() {
    console.log('🔍 [DIFERENCIAS] Iniciando comparación de stock...');
    
    if (ingredientesInventario.size === 0) {
        mostrarMensaje('No hay ingredientes contados para comparar', 'error');
        return;
    }

    try {
        // Obtener todos los ingredientes del sistema
        console.log('📊 [DIFERENCIAS] Obteniendo ingredientes del sistema...');
        const response = await fetch('/api/produccion/ingredientes');
        if (!response.ok) throw new Error('Error al obtener ingredientes del sistema');
        
        const ingredientesDelSistema = await response.json();
        console.log(`📊 [DIFERENCIAS] Ingredientes del sistema obtenidos: ${ingredientesDelSistema.length}`);
        
        // Generar lista de diferencias
        const diferencias = [];
        
        // Procesar ingredientes contados
        console.log('🔄 [DIFERENCIAS] Procesando ingredientes contados...');
        ingredientesInventario.forEach((ingrediente, ingredienteId) => {
            const input = document.querySelector(`input[data-ingrediente="${ingredienteId}"]`);
            const stockContado = parseFloat(input?.value || 0);
            const stockSistema = ingrediente.stock_actual || 0;
            const diferencia = stockContado - stockSistema;
            
            console.log(`📝 [DIFERENCIAS] ${ingrediente.nombre}: Sistema=${stockSistema}, Contado=${stockContado}, Diferencia=${diferencia}`);
            
            diferencias.push({
                id: ingredienteId,
                descripcion: ingrediente.nombre,
                unidad_medida: ingrediente.unidad_medida || 'kg',
                stockSistema: stockSistema,
                stockContado: stockContado,
                diferencia: diferencia,
                estado: diferencia === 0 ? 'sin-diferencia' : 'con-diferencia',
                esContado: true
            });
        });
        
        // Procesar ingredientes no contados (solo los que tienen stock en el sistema)
        console.log('🔄 [DIFERENCIAS] Procesando ingredientes no contados...');
        ingredientesDelSistema.forEach(ingrediente => {
            if (!ingredientesInventario.has(ingrediente.id.toString())) {
                const stockSistema = ingrediente.stock_actual || 0;
                if (stockSistema !== 0) { // Solo mostrar ingredientes con stock diferente de 0
                    console.log(`📝 [DIFERENCIAS] No contado: ${ingrediente.nombre}, Stock Sistema=${stockSistema}`);
                    
                    diferencias.push({
                        id: ingrediente.id.toString(),
                        descripcion: ingrediente.nombre,
                        unidad_medida: ingrediente.unidad_medida || 'kg',
                        stockSistema: stockSistema,
                        stockContado: 0,
                        diferencia: -stockSistema,
                        estado: 'no-contado',
                        esContado: false
                    });
                }
            }
        });
        
        console.log(`✅ [DIFERENCIAS] Comparación completada. Total diferencias: ${diferencias.length}`);
        
        // Ordenar diferencias
        const diferenciasOrdenadas = diferencias.sort((a, b) => {
            const getPrioridad = (item) => {
                const stockSistema = Number(item.stockSistema) || 0;
                const stockContado = Number(item.stockContado) || 0;
                const MARGEN_TOLERANCIA = 0.001;
                const esSinDiferencia = Math.abs(stockContado - stockSistema) <= MARGEN_TOLERANCIA;
                
                if (item.esContado) {
                    if (esSinDiferencia) {
                        return 1; // 🟩 Contados sin diferencia
                    } else {
                        return 2; // 🟥 Contados con diferencia
                    }
                } else {
                    if (Math.abs(stockSistema) <= MARGEN_TOLERANCIA && Math.abs(stockContado) <= MARGEN_TOLERANCIA) {
                        return 3; // 🟨 No contados sin diferencia (ambos cero)
                    } else {
                        return 4; // 🟥 No contados con diferencia
                    }
                }
            };
            
            const prioridadA = getPrioridad(a);
            const prioridadB = getPrioridad(b);
            
            if (prioridadA !== prioridadB) {
                return prioridadA - prioridadB;
            } else {
                return a.descripcion.localeCompare(b.descripcion);
            }
        });
        
        console.log(`🎯 [DIFERENCIAS] Ordenamiento aplicado. Mostrando ${diferenciasOrdenadas.length} diferencias ordenadas`);
        
        // Mostrar modal con diferencias ordenadas
        mostrarModalDiferencias(diferenciasOrdenadas);
        
    } catch (error) {
        console.error('❌ [DIFERENCIAS] Error al comparar stock:', error);
        mostrarMensaje('Error al comparar stock: ' + error.message, 'error');
    }
}

/**
 * Muestra el modal con las diferencias de stock
 */
function mostrarModalDiferencias(diferencias) {
    console.log('🎯 [DIFERENCIAS] Mostrando modal de diferencias...');
    
    const modal = document.getElementById('modal-diferencias');
    const tbody = document.getElementById('tabla-diferencias-body');
    
    // Limpiar tabla
    tbody.innerHTML = '';
    
    if (diferencias.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="mensaje-info">No hay diferencias de stock</td></tr>';
    } else {
        diferencias.forEach(diferencia => {
            const tr = document.createElement('tr');
            tr.dataset.id = diferencia.id;
            tr.dataset.esContado = diferencia.esContado;
            
            // Asegurar que los valores sean números para comparación correcta
            const stockSistema = Number(diferencia.stockSistema) || 0;
            const stockContado = Number(diferencia.stockContado) || 0;
            const diferenciaCalculada = stockContado - stockSistema;
            
            // Margen de tolerancia para comparaciones de punto flotante
            const MARGEN_TOLERANCIA = 0.001;
            const esSinDiferencia = Math.abs(diferenciaCalculada) <= MARGEN_TOLERANCIA;
            
            // Asignar clase de fila
            let claseFila = '';
            if (diferencia.esContado) {
                if (esSinDiferencia) {
                    claseFila = 'sin-diferencia'; // Verde
                } else {
                    claseFila = 'con-diferencia'; // Rojo
                }
            } else {
                if (Math.abs(stockSistema) <= MARGEN_TOLERANCIA && Math.abs(stockContado) <= MARGEN_TOLERANCIA) {
                    claseFila = 'sin-diferencia'; // Amarillo (neutral) - ambos son cero
                } else {
                    claseFila = 'con-diferencia'; // Rojo (diferencia real)
                }
            }
            tr.className = `diferencia-row ${claseFila}`;
            
            // Determinar clase de diferencia para celda
            let claseDiferencia = 'diferencia-cero';
            if (diferenciaCalculada > MARGEN_TOLERANCIA) claseDiferencia = 'diferencia-positiva';
            if (diferenciaCalculada < -MARGEN_TOLERANCIA) claseDiferencia = 'diferencia-negativa';
            
            // Determinar estado badge
            let estadoBadge = '';
            if (claseFila === 'sin-diferencia' && diferencia.esContado) {
                estadoBadge = '<span class="estado-badge estado-contado">Contado</span>';
            } else if (claseFila === 'sin-diferencia' && !diferencia.esContado) {
                estadoBadge = '<span class="estado-badge estado-no-contado">No Contado</span>';
            } else {
                estadoBadge = '<span class="estado-badge estado-diferencia">Diferencia</span>';
            }
            
            // Formatear diferencia para mostrar
            const diferenciaFormateada = Math.abs(diferenciaCalculada) <= MARGEN_TOLERANCIA ? 
                '0' : 
                (diferenciaCalculada > 0 ? '+' : '') + diferenciaCalculada.toFixed(2).replace(/\.?0+$/, '');
            
            tr.innerHTML = `
                <td>${diferencia.id}</td>
                <td>${diferencia.descripcion}</td>
                <td>${formatearNumero(stockSistema)} ${diferencia.unidad_medida}</td>
                <td>
                    <input type="number" 
                           class="stock-contado-input" 
                           value="${stockContado}" 
                           min="0" 
                           step="0.01"
                           data-id="${diferencia.id}"
                           data-stock-sistema="${stockSistema}">
                    <span class="unidad-medida">${diferencia.unidad_medida}</span>
                </td>
                <td class="${claseDiferencia}">${diferenciaFormateada} ${diferencia.unidad_medida}</td>
                <td>${estadoBadge}</td>
            `;
            
            tbody.appendChild(tr);
        });
        
        // Agregar eventos a los inputs
        const inputs = tbody.querySelectorAll('.stock-contado-input');
        inputs.forEach(input => {
            input.addEventListener('input', actualizarDiferencia);
        });
    }
    
    // Mostrar modal
    modal.style.display = 'block';
    console.log('✅ [DIFERENCIAS] Modal de diferencias mostrado');
}

/**
 * Actualiza la diferencia cuando se cambia el stock contado
 */
function actualizarDiferencia(event) {
    const input = event.target;
    
    // Asegurar que los valores sean números para comparación correcta
    const stockContado = Number(input.value) || 0;
    const stockSistema = Number(input.dataset.stockSistema) || 0;
    const diferencia = stockContado - stockSistema;
    
    // Margen de tolerancia para comparaciones de punto flotante
    const MARGEN_TOLERANCIA = 0.001;
    const esSinDiferencia = Math.abs(diferencia) <= MARGEN_TOLERANCIA;
    
    // Actualizar celda de diferencia
    const tr = input.closest('tr');
    const celdaDiferencia = tr.querySelector('td:nth-child(5)');
    const unidadMedida = input.nextElementSibling.textContent;
    
    // Actualizar clase y contenido con margen de tolerancia
    celdaDiferencia.className = '';
    if (diferencia > MARGEN_TOLERANCIA) {
        celdaDiferencia.className = 'diferencia-positiva';
        celdaDiferencia.textContent = '+' + diferencia.toFixed(2).replace(/\.?0+$/, '') + ' ' + unidadMedida;
    } else if (diferencia < -MARGEN_TOLERANCIA) {
        celdaDiferencia.className = 'diferencia-negativa';
        celdaDiferencia.textContent = diferencia.toFixed(2).replace(/\.?0+$/, '') + ' ' + unidadMedida;
    } else {
        celdaDiferencia.className = 'diferencia-cero';
        celdaDiferencia.textContent = '0 ' + unidadMedida;
    }
    
    // Actualizar clase de fila
    const esContado = tr.dataset.esContado === 'true';
    let claseFila = '';
    
    if (esContado) {
        if (esSinDiferencia) {
            claseFila = 'sin-diferencia'; // Verde
        } else {
            claseFila = 'con-diferencia'; // Rojo
        }
    } else {
        if (Math.abs(stockSistema) <= MARGEN_TOLERANCIA && Math.abs(stockContado) <= MARGEN_TOLERANCIA) {
            claseFila = 'sin-diferencia'; // Amarillo (neutral) - ambos son cero
        } else {
            claseFila = 'con-diferencia'; // Rojo (diferencia real)
        }
    }
    
    tr.className = `diferencia-row ${claseFila}`;
}

/**
 * Guarda las correcciones realizadas en el modal de diferencias
 */
async function guardarCorrecciones() {
    console.log('💾 [CORRECCIONES] Iniciando guardado de correcciones...');
    
    const inputs = document.querySelectorAll('.stock-contado-input');
    let ingredientesAgregados = 0;
    let ingredientesModificados = 0;
    
    inputs.forEach(input => {
        const ingredienteId = input.dataset.id;
        const stockContado = parseFloat(input.value) || 0;
        const tr = input.closest('tr');
        const esContado = tr.dataset.esContado === 'true';
        
        if (esContado) {
            // Ingrediente ya contado - actualizar si fue modificado
            const inputOriginal = document.querySelector(`input[data-ingrediente="${ingredienteId}"]`);
            if (inputOriginal && parseFloat(inputOriginal.value) !== stockContado) {
                inputOriginal.value = stockContado;
                ingredientesModificados++;
                console.log(`✏️ [CORRECCIONES] Modificado: ${ingredienteId} -> ${stockContado}`);
            }
        } else {
            // Ingrediente no contado - agregar al inventario
            const ingrediente = todosLosIngredientes.find(i => i.id.toString() === ingredienteId);
            if (ingrediente) {
                agregarIngredienteAInventario(ingrediente, stockContado);
                ingredientesAgregados++;
                console.log(`➕ [CORRECCIONES] Agregado: ${ingredienteId} -> ${stockContado}`);
            }
        }
    });
    
    // Mostrar el botón "Mostrar Diferencias" si hay ingredientes
    if (ingredientesInventario.size > 0) {
        document.getElementById('btn-mostrar-diferencias').style.display = 'inline-block';
    }
    
    // Cerrar modal
    document.getElementById('modal-diferencias').style.display = 'none';
    
    // Mostrar resumen
    const mensaje = `Correcciones aplicadas: ${ingredientesAgregados} ingredientes agregados, ${ingredientesModificados} ingredientes modificados`;
    mostrarMensaje(mensaje, 'info');
    
    console.log(`✅ [CORRECCIONES] Guardado completado: +${ingredientesAgregados} agregados, ~${ingredientesModificados} modificados`);
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('Página de gestión de ingredientes cargada');
    cargarIngredientes();

    // Botón para iniciar inventario
    document.getElementById('btn-iniciar-inventario').addEventListener('click', mostrarModal);

    // Botones para ajustes puntuales
    document.getElementById('btn-ajustes-puntuales').addEventListener('click', iniciarAjustesPuntuales);
    document.getElementById('btn-confirmar-seleccion').addEventListener('click', () => {
        if (ingredientesSeleccionados.size === 0) {
            mostrarMensaje('Debe seleccionar al menos un ingrediente', 'error');
            return;
        }
        document.getElementById('paso-ajuste').style.display = 'block';
        mostrarIngredientesSeleccionados();
        document.getElementById('modal-ajustes').style.display = 'block';
    });

    // Cerrar modales
    document.getElementById('close-modal').addEventListener('click', cerrarModal);
    document.getElementById('close-modal-ajustes').addEventListener('click', () => cerrarModalAjustes(true));

    // Selects de usuario
    const selectUsuario = document.getElementById('select-usuario');
    const selectUsuarioAjustes = document.getElementById('select-usuario-ajustes');
    
    function actualizarSeleccionUsuario(select, variable, btnId) {
        const valor = select.value;
        if (variable === 'usuarioSeleccionado') {
            usuarioSeleccionado = valor;
        } else {
            usuarioAjustes = valor;
        }
        const btnContinuar = document.getElementById(btnId);
        btnContinuar.disabled = !valor;
    }
    
    // Eventos del select de inventario
    selectUsuario.addEventListener('change', () => actualizarSeleccionUsuario(selectUsuario, 'usuarioSeleccionado', 'btn-continuar-usuario'));
    selectUsuario.addEventListener('input', () => actualizarSeleccionUsuario(selectUsuario, 'usuarioSeleccionado', 'btn-continuar-usuario'));
    selectUsuario.addEventListener('keydown', (e) => setTimeout(() => actualizarSeleccionUsuario(selectUsuario, 'usuarioSeleccionado', 'btn-continuar-usuario'), 10));
    
    // Eventos del select de ajustes
    selectUsuarioAjustes.addEventListener('change', () => actualizarSeleccionUsuario(selectUsuarioAjustes, 'usuarioAjustes', 'btn-continuar-ajustes'));
    selectUsuarioAjustes.addEventListener('input', () => actualizarSeleccionUsuario(selectUsuarioAjustes, 'usuarioAjustes', 'btn-continuar-ajustes'));
    selectUsuarioAjustes.addEventListener('keydown', (e) => setTimeout(() => actualizarSeleccionUsuario(selectUsuarioAjustes, 'usuarioAjustes', 'btn-continuar-ajustes'), 10));

    // Botones continuar
    document.getElementById('btn-continuar-usuario').addEventListener('click', () => {
        if (usuarioSeleccionado) {
            mostrarPasoConteo();
        } else {
            mostrarMensaje('Por favor selecciona un usuario', 'error');
        }
    });

    document.getElementById('btn-continuar-ajustes').addEventListener('click', () => {
        if (usuarioAjustes) {
            cerrarModalAjustes(false);
            activarModoSeleccion();
        } else {
            mostrarMensaje('Por favor selecciona un usuario', 'error');
        }
    });

    // Input de código de barras y botones de inventario
    document.getElementById('input-codigo-barras').addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const codigo = e.target.value.trim();
            if (!codigo) return;

            const ingrediente = await buscarIngredientePorCodigo(codigo);
            if (ingrediente) {
                agregarIngredienteAInventario(ingrediente);
                e.target.value = '';
            }
        }
    });

    // Botones de finalizar y cancelar inventario
    document.getElementById('btn-finalizar-inventario').addEventListener('click', finalizarInventario);
    document.getElementById('btn-cancelar-inventario').addEventListener('click', cerrarModal);

    // Botones de finalizar y cancelar ajustes
    document.getElementById('btn-finalizar-ajustes').addEventListener('click', finalizarAjustes);
    document.getElementById('btn-cancelar-ajustes').addEventListener('click', cerrarModalAjustes);

    // Botones del modal de diferencias
    document.getElementById('btn-mostrar-diferencias').addEventListener('click', compararStock);
    document.getElementById('btn-guardar-correcciones').addEventListener('click', guardarCorrecciones);
    document.getElementById('btn-cerrar-diferencias').addEventListener('click', () => {
        document.getElementById('modal-diferencias').style.display = 'none';
    });
    document.getElementById('close-modal-diferencias').addEventListener('click', () => {
        document.getElementById('modal-diferencias').style.display = 'none';
    });

    // Checkbox seleccionar todos
    document.getElementById('seleccionar-todos').addEventListener('change', function() {
        const checkboxes = document.querySelectorAll('.checkbox-ingrediente');
        checkboxes.forEach(checkbox => {
            checkbox.checked = this.checked;
            const ingredienteId = checkbox.dataset.ingrediente;
            const ingrediente = todosLosIngredientes.find(i => i.id.toString() === ingredienteId);
            
            if (this.checked) {
                ingredientesSeleccionados.set(ingredienteId, ingrediente);
            } else {
                ingredientesSeleccionados.delete(ingredienteId);
            }
        });
    });

    // Filtros
    const filtroNombre = document.getElementById('filtro-nombre');
    const filtroStock = document.getElementById('filtro-stock');
    
    filtroNombre.addEventListener('input', aplicarFiltros);
    filtroStock.addEventListener('change', aplicarFiltros);
});
