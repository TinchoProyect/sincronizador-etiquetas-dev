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
    window.open('/pages/produccion_personal.html', '_blank');
}

// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    cargarUsuariosProduccion();

    // Setear fecha corte hoy si está vacio
    const fechaCorteInput = document.getElementById('fecha-corte');
    if (fechaCorteInput && !fechaCorteInput.value) {
        const hoy = new Date().toISOString().slice(0, 10);
        fechaCorteInput.value = hoy;
    }

    cargarPedidosPorCliente();

    // Listeners
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
        header.textContent = cliente.cliente_nombre + ' (' + cliente.total_articulos + ' artículos)';
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
