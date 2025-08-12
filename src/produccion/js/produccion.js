// Configuración inicial
const API_BASE = '/api';

// Función para cargar la lista de usuarios con permiso de Produccion
async function cargarUsuariosProduccion() {
    try {
        const response = await fetch(`${API_BASE}/usuarios/con-permiso/Produccion`);
        const usuarios = await response.json();
        
        const listaColaboradores = document.getElementById('lista-colaboradores');
        listaColaboradores.innerHTML = '';

        if (usuarios.length === 0) {
            listaColaboradores.innerHTML = '<p class="mensaje-info">No hay usuarios disponibles con permiso de producción.</p>';
            return;
        }

        usuarios.forEach(usuario => {
            const card = document.createElement('div');
            card.className = 'colaborador-card';
            card.innerHTML = `
                <span class="colaborador-icon">👤</span>
                <p class="colaborador-nombre">${usuario.nombre_completo}</p>
            `;
            card.onclick = () => seleccionarUsuario(usuario);
            listaColaboradores.appendChild(card);
        });
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        document.getElementById('lista-colaboradores').innerHTML = 
            '<p class="mensaje-error">Error al cargar la lista de usuarios.</p>';
    }
}

// Función para manejar la selección de un usuario
function seleccionarUsuario(usuario) {
    // Guardar el colaborador seleccionado en localStorage incluyendo rol_id
    localStorage.setItem('colaboradorActivo', JSON.stringify({
        id: usuario.id,
        nombre: usuario.nombre_completo,
        rol_id: usuario.rol_id,
        timestamp: new Date().toISOString()
    }));
    
    // Abrir la página personal en una nueva pestaña
    //window.open('/pages/produccion_personal.html', '_blank');
    window.open('/pages/produccion_personal.html', `ventanaProduccion_${usuario.id}`);

}

// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    cargarUsuariosProduccion();

    // Setear fecha corte hoy si está vacio para ambas vistas
    const fechaCorteInput = document.getElementById('fecha-corte');
    const fechaCorteArticulosInput = document.getElementById('fecha-corte-articulos');
    const hoy = new Date().toISOString().slice(0, 10);
    
    if (fechaCorteInput && !fechaCorteInput.value) {
        fechaCorteInput.value = hoy;
    }
    if (fechaCorteArticulosInput && !fechaCorteArticulosInput.value) {
        fechaCorteArticulosInput.value = hoy;
    }

    // Cargar ambas vistas
    cargarPedidosPorCliente();
    cargarPedidosArticulos();

    // Listeners para vista por cliente
    const refreshBtn = document.getElementById('refresh-pedidos');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            cargarPedidosPorCliente();
        });
    }

    const buscarClienteInput = document.getElementById('buscar-cliente');
    if (buscarClienteInput) {
        buscarClienteInput.addEventListener('input', () => {
            filtrarPedidosPorCliente();
        });
    }

    // Listeners para vista de artículos consolidados
    const refreshArticulosBtn = document.getElementById('refresh-articulos');
    if (refreshArticulosBtn) {
        refreshArticulosBtn.addEventListener('click', () => {
            cargarPedidosArticulos();
        });
    }

    const buscarArticuloInput = document.getElementById('buscar-articulo');
    if (buscarArticuloInput) {
        buscarArticuloInput.addEventListener('input', () => {
            filtrarPedidosArticulos();
        });
    }

    const filtroEstadoSelect = document.getElementById('filtro-estado-articulos');
    if (filtroEstadoSelect) {
        filtroEstadoSelect.addEventListener('change', () => {
            filtrarPedidosArticulos();
        });
    }

    // Sincronizar fechas entre vistas
    if (fechaCorteInput) {
        fechaCorteInput.addEventListener('change', () => {
            if (fechaCorteArticulosInput) {
                fechaCorteArticulosInput.value = fechaCorteInput.value;
            }
            cargarPedidosArticulos();
        });
    }

    if (fechaCorteArticulosInput) {
        fechaCorteArticulosInput.addEventListener('change', () => {
            if (fechaCorteInput) {
                fechaCorteInput.value = fechaCorteArticulosInput.value;
            }
            cargarPedidosPorCliente();
        });
    }

    // Listener para cerrar modal con Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            cerrarModalAsignar();
        }
    });

    // Eventos para botones del modal
    const confirmarBtn = document.getElementById('confirmar-asignacion');
    if (confirmarBtn) {
        confirmarBtn.addEventListener('click', confirmarAsignacionFaltantes);
    }
});

// Base URL para fetch
const base = (window.API_BASE || API_BASE || '/api') + '/produccion';

// Función para cargar pedidos por cliente
async function cargarPedidosPorCliente() {
    const contenedor = document.getElementById('pedidos-container');
    const fechaCorte = document.getElementById('fecha-corte').value;
    contenedor.innerHTML = '<p class="mensaje-info">Cargando pedidos...</p>';

    try {
        const response = await fetch(`${base}/pedidos-por-cliente?fecha=${fechaCorte}`);
        if (!response.ok) {
            throw new Error(`Error al cargar pedidos: ${response.statusText}`);
        }
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Error en la respuesta del servidor');
        }
        const pedidos = data.data;
        renderPedidosCliente(pedidos);
    } catch (error) {
        contenedor.innerHTML = `<p class="mensaje-error">${error.message}</p>`;
    }
}

// Función para renderizar pedidos por cliente
function renderPedidosCliente(pedidos) {
    const contenedor = document.getElementById('pedidos-container');
    if (!pedidos || pedidos.length === 0) {
        contenedor.innerHTML = '<p class="mensaje-info">No hay pedidos pendientes para la fecha seleccionada.</p>';
        return;
    }

    contenedor.innerHTML = '';
    pedidos.forEach(cliente => {
        const clienteDiv = document.createElement('div');
        clienteDiv.className = 'cliente-acordeon';
        clienteDiv.setAttribute('data-cliente-id', cliente.cliente_id);

        const header = document.createElement('div');
        header.className = 'cliente-header';
        header.textContent = cliente.cliente_nombre + ' [ID: ' + cliente.cliente_id + '] (' + cliente.total_articulos + ' artículos)';
        header.addEventListener('click', () => toggleAcordeon(cliente.cliente_id));
        clienteDiv.appendChild(header);

        const contenido = document.createElement('div');
        contenido.className = 'cliente-contenido';
        contenido.id = `contenido-${cliente.cliente_id}`;

        const tabla = document.createElement('table');
        tabla.className = 'articulos-tabla';

        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th>Artículo</th>
                <th>Descripción</th>
                <th>Pedido Total</th>
                <th>Stock Disponible</th>
                <th>Faltante</th>
                <th>Estado</th>
            </tr>
        `;
        tabla.appendChild(thead);

        const tbody = document.createElement('tbody');
        cliente.articulos.forEach(articulo => {
            const tr = document.createElement('tr');

            const tdArticulo = document.createElement('td');
            tdArticulo.textContent = articulo.articulo_numero;
            tr.appendChild(tdArticulo);

            const tdDescripcion = document.createElement('td');
            tdDescripcion.textContent = articulo.descripcion || '-';
            tr.appendChild(tdDescripcion);

            const tdPedidoTotal = document.createElement('td');
            tdPedidoTotal.textContent = articulo.pedido_total;
            tr.appendChild(tdPedidoTotal);

            const tdStockDisponible = document.createElement('td');
            tdStockDisponible.textContent = articulo.stock_disponible;
            tr.appendChild(tdStockDisponible);

            const tdFaltante = document.createElement('td');
            tdFaltante.textContent = articulo.faltante;
            tdFaltante.className = articulo.faltante > 0 ? 'cantidad-faltante' : 'cantidad-completa';
            tr.appendChild(tdFaltante);

            const tdEstado = document.createElement('td');
            const indicador = document.createElement('span');
            indicador.className = 'indicador-estado ' + calcularIndicadorEstado(articulo);
            indicador.textContent = articulo.faltante > 0 ? 'Faltante' : 'Completo';
            tdEstado.appendChild(indicador);
            tr.appendChild(tdEstado);

            tbody.appendChild(tr);
        });

        tabla.appendChild(tbody);
        contenido.appendChild(tabla);

        // Botones de acción por cliente
        const accionesDiv = document.createElement('div');
        accionesDiv.style.padding = '15px';
        accionesDiv.style.textAlign = 'center';
        accionesDiv.style.borderTop = '1px solid #dee2e6';

        // Calcular artículos faltantes
        const articulosFaltantes = cliente.articulos.filter(art => art.faltante > 0);
        
        if (articulosFaltantes.length > 0) {
            const btnAsignar = document.createElement('button');
            btnAsignar.textContent = `Asignar Faltantes (${articulosFaltantes.length})`;
            btnAsignar.className = 'admin-button';
            btnAsignar.addEventListener('click', () => mostrarModalAsignarFaltantes(cliente.cliente_id, articulosFaltantes));
            accionesDiv.appendChild(btnAsignar);
        }

        const btnImprimir = document.createElement('button');
        btnImprimir.textContent = 'Imprimir';
        btnImprimir.className = 'admin-button';
        btnImprimir.style.marginLeft = '10px';
        btnImprimir.addEventListener('click', () => imprimirPresupuestoCliente(cliente.cliente_id));
        accionesDiv.appendChild(btnImprimir);

        contenido.appendChild(accionesDiv);
        clienteDiv.appendChild(contenido);
        contenedor.appendChild(clienteDiv);
    });
}

// Función para calcular clase indicador estado
function calcularIndicadorEstado(articulo) {
    if (articulo.faltante === 0) return 'indicador-completo';
    if (articulo.faltante < articulo.pedido_total) return 'indicador-parcial';
    return 'indicador-faltantes';
}

// Función para toggle acordeon
function toggleAcordeon(clienteId) {
    const contenido = document.getElementById(`contenido-${clienteId}`);
    if (contenido.style.display === 'block') {
        contenido.style.display = 'none';
    } else {
        contenido.style.display = 'block';
    }
}

// Función para mostrar modal asignar faltantes
function mostrarModalAsignarFaltantes(clienteId, articulosFaltantes) {
    const modal = document.getElementById('modal-asignar-faltantes');
    const usuarioSelect = document.getElementById('usuario-asignar');
    const mensaje = document.getElementById('modal-mensaje');
    const listaFaltantes = document.getElementById('articulos-faltantes-lista');
    
    mensaje.textContent = '';
    usuarioSelect.innerHTML = '';
    listaFaltantes.innerHTML = '';
    modal.style.display = 'block';

    // Guardar datos para asignacion
    modal.dataset.clienteId = clienteId;
    modal.dataset.articulosFaltantes = JSON.stringify(articulosFaltantes);

    // Renderizar lista de artículos faltantes con inputs
    articulosFaltantes.forEach(articulo => {
        const itemDiv = document.createElement('div');
        itemDiv.style.marginBottom = '10px';
        itemDiv.style.padding = '10px';
        itemDiv.style.border = '1px solid #ccc';
        itemDiv.style.borderRadius = '4px';

        const label = document.createElement('label');
        label.textContent = `${articulo.articulo_numero} - ${articulo.descripcion || 'Sin descripción'}`;
        label.style.display = 'block';
        label.style.fontWeight = 'bold';
        label.style.marginBottom = '5px';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = articulo.faltante;
        input.value = articulo.faltante;
        input.dataset.articuloNumero = articulo.articulo_numero;
        input.dataset.descripcion = articulo.descripcion || '';
        input.style.width = '100px';

        const spanInfo = document.createElement('span');
        spanInfo.textContent = ` (Faltante: ${articulo.faltante})`;
        spanInfo.style.color = '#666';
        spanInfo.style.fontSize = '12px';

        itemDiv.appendChild(label);
        itemDiv.appendChild(input);
        itemDiv.appendChild(spanInfo);
        listaFaltantes.appendChild(itemDiv);
    });

    cargarUsuariosParaModal();
}

// Función para cerrar modal asignar
function cerrarModalAsignar() {
    const modal = document.getElementById('modal-asignar-faltantes');
    modal.style.display = 'none';
}

// Función para confirmar asignacion de faltantes
async function confirmarAsignacionFaltantes() {
    const modal = document.getElementById('modal-asignar-faltantes');
    const usuarioSelect = document.getElementById('usuario-asignar');
    const mensaje = document.getElementById('modal-mensaje');
    const listaFaltantes = document.getElementById('articulos-faltantes-lista');

    const clienteId = parseInt(modal.dataset.clienteId);
    const usuarioId = parseInt(usuarioSelect.value);

    if (!usuarioId) {
        mensaje.textContent = 'Seleccione un usuario para asignar.';
        mensaje.className = 'mensaje-error';
        return;
    }

    // Recopilar artículos faltantes de los inputs
    const inputs = listaFaltantes.querySelectorAll('input[type="number"]');
    const articulosFaltantes = [];
    
    inputs.forEach(input => {
        const cantidadFaltante = parseInt(input.value);
        if (cantidadFaltante > 0) {
            articulosFaltantes.push({
                articulo_numero: input.dataset.articuloNumero,
                descripcion: input.dataset.descripcion,
                cantidad_faltante: cantidadFaltante
            });
        }
    });

    if (articulosFaltantes.length === 0) {
        mensaje.textContent = 'Debe asignar al menos un artículo con cantidad mayor a 0.';
        mensaje.className = 'mensaje-error';
        return;
    }

    mensaje.textContent = 'Asignando...';
    mensaje.className = 'mensaje-info';

    try {
        const response = await fetch(`${base}/asignar-faltantes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                usuario_id: usuarioId,
                cliente_id: clienteId,
                articulos_faltantes: articulosFaltantes,
                observaciones: 'Asignacion desde pedidos por cliente'
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al asignar faltantes');
        }

        mensaje.textContent = 'Asignación exitosa.';
        mensaje.className = 'mensaje-exito';

        // Refrescar pedidos
        cargarPedidosPorCliente();

        setTimeout(() => {
            cerrarModalAsignar();
        }, 1500);
    } catch (error) {
        mensaje.textContent = error.message;
        mensaje.className = 'mensaje-error';
    }
}

// Función para imprimir presupuesto cliente
function imprimirPresupuestoCliente(clienteId) {
    const urlPdf = `${base}/impresion-presupuesto?cliente_id=${clienteId}&formato=pdf`;
    const urlHtml = `${base}/impresion-presupuesto?cliente_id=${clienteId}&formato=html`;

    // Abrir PDF en nueva pestaña
    const win = window.open(urlPdf, '_blank');

    // Si el PDF no se puede abrir (por ejemplo, error 501), abrir fallback HTML
    setTimeout(() => {
        if (!win || win.closed || typeof win.closed == 'undefined') {
            window.open(urlHtml, '_blank');
        }
    }, 2000);
}

// Función para filtrar pedidos por cliente
function filtrarPedidosPorCliente() {
    const filtro = document.getElementById('buscar-cliente').value.toLowerCase();
    const contenedor = document.getElementById('pedidos-container');
    const clientes = contenedor.querySelectorAll('.cliente-acordeon');

    clientes.forEach(cliente => {
        const nombre = cliente.querySelector('.cliente-header').textContent.toLowerCase();
        const clienteId = cliente.getAttribute('data-cliente-id');
        if (nombre.includes(filtro) || clienteId.includes(filtro)) {
            cliente.style.display = '';
        } else {
            cliente.style.display = 'none';
        }
    });
}

// Función para cargar usuarios para modal asignar faltantes
async function cargarUsuariosParaModal() {
    const usuarioSelect = document.getElementById('usuario-asignar');
    usuarioSelect.innerHTML = '';

    try {
        const response = await fetch(`${base}/usuarios?rol=2&activo=true`);
        if (!response.ok) {
            throw new Error('Error al cargar usuarios');
        }
        const usuarios = await response.json();

        usuarios.forEach(usuario => {
            const option = document.createElement('option');
            option.value = usuario.id;
            option.textContent = usuario.nombre_completo;
            usuarioSelect.appendChild(option);
        });
    } catch (error) {
        const mensaje = document.getElementById('modal-mensaje');
        mensaje.textContent = error.message;
        mensaje.className = 'mensaje-error';
    }
}

// ==========================================
// FUNCIONES PARA VISTA DE ARTÍCULOS CONSOLIDADOS
// ==========================================

/**
 * Cargar artículos consolidados desde presupuestos confirmados
 * Reutiliza los mismos flujos que la vista por cliente para descripción y stock
 */
async function cargarPedidosArticulos() {
    const contenedor = document.getElementById('articulos-container');
    const totalesDiv = document.getElementById('totales-articulos');
    const fechaCorte = document.getElementById('fecha-corte-articulos').value;
    
    contenedor.innerHTML = '<p class="mensaje-info">Cargando artículos...</p>';
    totalesDiv.innerHTML = '';

    try {
        // Usar el nuevo endpoint que reutiliza los flujos existentes
        const response = await fetch(`${base}/pedidos-articulos?fecha=${fechaCorte}`);
        if (!response.ok) {
            throw new Error(`Error al cargar artículos: ${response.statusText}`);
        }
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Error en la respuesta del servidor');
        }
        
        // Guardar datos originales para filtrado
        window.articulosOriginales = data.data;
        window.totalesOriginales = data.totales;
        
        renderPedidosArticulos(data.data, data.totales);
    } catch (error) {
        contenedor.innerHTML = `<p class="mensaje-error">${error.message}</p>`;
        totalesDiv.innerHTML = '';
    }
}

/**
 * Renderizar tabla de artículos consolidados
 * Usa los mismos estilos y estructura que la vista por cliente
 */
function renderPedidosArticulos(articulos, totales) {
    const contenedor = document.getElementById('articulos-container');
    const totalesDiv = document.getElementById('totales-articulos');
    
    // Renderizar totales por estado
    if (totales) {
        totalesDiv.innerHTML = `
            <span class="indicador-estado indicador-faltantes">Faltantes: ${totales.faltantes}</span>
            <span class="indicador-estado indicador-parcial" style="margin-left: 10px;">Parciales: ${totales.parciales}</span>
            <span class="indicador-estado indicador-completo" style="margin-left: 10px;">Completos: ${totales.completos}</span>
            <span style="margin-left: 20px; color: #666;">Total: ${articulos.length} artículos</span>
        `;
    }
    
    if (!articulos || articulos.length === 0) {
        contenedor.innerHTML = '<p class="mensaje-info">No hay artículos para la fecha seleccionada.</p>';
        return;
    }

    // Crear tabla con la misma estructura que la vista por cliente
    const tabla = document.createElement('table');
    tabla.className = 'articulos-tabla';

    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th>Artículo</th>
            <th>Descripción</th>
            <th>Pedido Total</th>
            <th>Stock Disponible</th>
            <th>Faltante</th>
            <th>Estado</th>
        </tr>
    `;
    tabla.appendChild(thead);

    const tbody = document.createElement('tbody');
    articulos.forEach(articulo => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-articulo-numero', articulo.articulo_numero);
        tr.setAttribute('data-estado', articulo.estado.toLowerCase());

        const tdArticulo = document.createElement('td');
        tdArticulo.textContent = articulo.articulo_numero;
        tr.appendChild(tdArticulo);

        const tdDescripcion = document.createElement('td');
        tdDescripcion.textContent = articulo.descripcion || '-';
        tr.appendChild(tdDescripcion);

        const tdPedidoTotal = document.createElement('td');
        tdPedidoTotal.textContent = articulo.pedido_total;
        tr.appendChild(tdPedidoTotal);

        const tdStockDisponible = document.createElement('td');
        tdStockDisponible.textContent = articulo.stock_disponible;
        tr.appendChild(tdStockDisponible);

        const tdFaltante = document.createElement('td');
        tdFaltante.textContent = articulo.faltante;
        tdFaltante.className = articulo.faltante > 0 ? 'cantidad-faltante' : 'cantidad-completa';
        tr.appendChild(tdFaltante);

        const tdEstado = document.createElement('td');
        const indicador = document.createElement('span');
        indicador.className = 'indicador-estado ' + calcularIndicadorEstadoArticulo(articulo);
        indicador.textContent = articulo.estado;
        tdEstado.appendChild(indicador);
        tr.appendChild(tdEstado);

        tbody.appendChild(tr);
    });

    tabla.appendChild(tbody);
    contenedor.innerHTML = '';
    contenedor.appendChild(tabla);
}

/**
 * Calcular clase CSS para indicador de estado de artículo
 * Reutiliza la misma lógica que la vista por cliente
 */
function calcularIndicadorEstadoArticulo(articulo) {
    switch (articulo.estado.toUpperCase()) {
        case 'COMPLETO':
            return 'indicador-completo';
        case 'PARCIAL':
            return 'indicador-parcial';
        case 'FALTANTE':
            return 'indicador-faltantes';
        default:
            return 'indicador-faltantes';
    }
}

/**
 * Filtrar artículos por texto y estado
 * Aplica filtros sobre los datos originales y re-renderiza
 */
function filtrarPedidosArticulos() {
    if (!window.articulosOriginales) {
        return;
    }

    const filtroTexto = document.getElementById('buscar-articulo').value.toLowerCase();
    const filtroEstado = document.getElementById('filtro-estado-articulos').value;
    
    let articulosFiltrados = window.articulosOriginales;

    // Filtro por texto (artículo o descripción)
    if (filtroTexto.trim()) {
        articulosFiltrados = articulosFiltrados.filter(art => 
            art.articulo_numero.toLowerCase().includes(filtroTexto) ||
            (art.descripcion && art.descripcion.toLowerCase().includes(filtroTexto))
        );
    }

    // Filtro por estado
    if (filtroEstado && filtroEstado !== 'todos') {
        articulosFiltrados = articulosFiltrados.filter(art => 
            art.estado.toLowerCase() === filtroEstado.toLowerCase()
        );
    }

    // Recalcular totales para los artículos filtrados
    const totalesFiltrados = articulosFiltrados.reduce((acc, art) => {
        switch (art.estado.toUpperCase()) {
            case 'COMPLETO':
                acc.completos++;
                break;
            case 'PARCIAL':
                acc.parciales++;
                break;
            case 'FALTANTE':
                acc.faltantes++;
                break;
        }
        return acc;
    }, { faltantes: 0, parciales: 0, completos: 0 });

    renderPedidosArticulos(articulosFiltrados, totalesFiltrados);
}
