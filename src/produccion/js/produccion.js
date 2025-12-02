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
    
    // Evento para botón "Imprimir Todos los Presupuestos" (general)
    const btnImprimirTodosGeneral = document.getElementById('imprimir-todos-general');
    if (btnImprimirTodosGeneral) {
        btnImprimirTodosGeneral.addEventListener('click', () => {
            const fechaCorte = document.getElementById('fecha-corte').value;
            imprimirTodosLosPresupuestos(fechaCorte);
        });
    }
});

// Base URL para fetch
const base = (window.API_BASE || API_BASE || '/api') + '/produccion';

// Función para cargar pedidos por cliente
async function cargarPedidosPorCliente() {
    const fechaCorte = document.getElementById('fecha-corte').value;
    
    // Mostrar loading en todos los contenedores
    const containers = ['pedidos-imprimir', 'pedidos-armar', 'pedidos-listo'];
    containers.forEach(id => {
        const container = document.getElementById(id);
        if (container) {
            container.innerHTML = '<p class="mensaje-info">Cargando pedidos...</p>';
        }
    });

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
        
        // Guardar datos en variable global para funciones de impresión
        window.clientesPedidos = pedidos;
        
        renderPedidosCliente(pedidos);
    } catch (error) {
        console.error('❌ Error al cargar pedidos:', error);
        // Mostrar error en todos los contenedores
        containers.forEach(id => {
            const container = document.getElementById(id);
            if (container) {
                container.innerHTML = `<p class="mensaje-error">${error.message}</p>`;
            }
        });
        // Resetear contadores
        actualizarContadoresSecuencia({ imprimir: [], armar_pedido: [], pedido_listo: [] });
    }
}

/**
 * Agrupa presupuestos por secuencia
 * Retorna objeto con tres grupos: imprimir, armar_pedido, pedido_listo
 */
function agruparPresupuestosPorSecuencia(clientes) {
    const grupos = {
        imprimir: [],      // Imprimir + Imprimir_Modificado
        armar_pedido: [],  // Armar_Pedido
        pedido_listo: []   // Pedido_Listo
    };
    
    clientes.forEach(cliente => {
        // Crear versiones del cliente para cada grupo
        const clienteImprimir = { ...cliente, articulos: [], total_articulos: 0, total_presupuestos: 0 };
        const clienteArmar = { ...cliente, articulos: [], total_articulos: 0, total_presupuestos: 0 };
        const clienteListo = { ...cliente, articulos: [], total_articulos: 0, total_presupuestos: 0 };
        
        const presupuestosImprimir = new Set();
        const presupuestosArmar = new Set();
        const presupuestosListo = new Set();
        
        cliente.articulos.forEach(articulo => {
            const secuencia = (articulo.secuencia || 'Imprimir').trim();
            
            if (secuencia === 'Imprimir' || secuencia === 'Imprimir_Modificado') {
                clienteImprimir.articulos.push(articulo);
                presupuestosImprimir.add(articulo.presupuesto_id);
            } else if (secuencia === 'Armar_Pedido') {
                clienteArmar.articulos.push(articulo);
                presupuestosArmar.add(articulo.presupuesto_id);
            } else if (secuencia === 'Pedido_Listo') {
                clienteListo.articulos.push(articulo);
                presupuestosListo.add(articulo.presupuesto_id);
            } else {
                // Fallback: si no reconoce la secuencia, va a imprimir
                console.log(`⚠️ Secuencia no reconocida: "${secuencia}", usando Imprimir como fallback`);
                clienteImprimir.articulos.push(articulo);
                presupuestosImprimir.add(articulo.presupuesto_id);
            }
        });
        
        // Actualizar contadores y agregar a grupos solo si tienen artículos
        if (clienteImprimir.articulos.length > 0) {
            clienteImprimir.total_articulos = clienteImprimir.articulos.length;
            clienteImprimir.total_presupuestos = presupuestosImprimir.size;
            grupos.imprimir.push(clienteImprimir);
        }
        if (clienteArmar.articulos.length > 0) {
            clienteArmar.total_articulos = clienteArmar.articulos.length;
            clienteArmar.total_presupuestos = presupuestosArmar.size;
            grupos.armar_pedido.push(clienteArmar);
        }
        if (clienteListo.articulos.length > 0) {
            clienteListo.total_articulos = clienteListo.articulos.length;
            clienteListo.total_presupuestos = presupuestosListo.size;
            grupos.pedido_listo.push(clienteListo);
        }
    });
    
    console.log('📊 [SECUENCIA] Agrupación completada:', {
        imprimir: grupos.imprimir.length,
        armar_pedido: grupos.armar_pedido.length,
        pedido_listo: grupos.pedido_listo.length
    });
    
    return grupos;
}

/**
 * Actualiza los contadores en los títulos de los acordeones
 */
function actualizarContadoresSecuencia(grupos) {
    const contadorImprimir = document.getElementById('contador-imprimir');
    const contadorArmar = document.getElementById('contador-armar');
    const contadorListo = document.getElementById('contador-listo');
    
    // Contar total de presupuestos en cada grupo
    const totalImprimir = grupos.imprimir.reduce((sum, cliente) => sum + cliente.total_presupuestos, 0);
    const totalArmar = grupos.armar_pedido.reduce((sum, cliente) => sum + cliente.total_presupuestos, 0);
    const totalListo = grupos.pedido_listo.reduce((sum, cliente) => sum + cliente.total_presupuestos, 0);
    
    // Mostrar solo el número sin paréntesis
    if (contadorImprimir) contadorImprimir.textContent = totalImprimir;
    if (contadorArmar) contadorArmar.textContent = totalArmar;
    if (contadorListo) contadorListo.textContent = totalListo;
    
    console.log('🔢 [CONTADORES] Actualizados:', { totalImprimir, totalArmar, totalListo });
}

/**
 * Renderiza un grupo de clientes en un contenedor específico
 */
function renderizarGrupoSecuencia(containerId, clientes, titulo) {
    const contenedor = document.getElementById(containerId);
    if (!contenedor) {
        console.warn(`⚠️ Contenedor ${containerId} no encontrado`);
        return;
    }
    
    if (!clientes || clientes.length === 0) {
        contenedor.innerHTML = '<p class="mensaje-info">No hay presupuestos en esta etapa</p>';
        return;
    }

    console.log(`🔍 Renderizando ${titulo}: ${clientes.length} clientes`);
    contenedor.innerHTML = '';
    
    clientes.forEach(cliente => {
        console.log(`📋 Cliente: ${cliente.cliente_nombre} - ${cliente.total_presupuestos} presupuestos`);
        
        const clienteDiv = document.createElement('div');
        clienteDiv.className = 'cliente-acordeon';
        clienteDiv.setAttribute('data-cliente-id', cliente.cliente_id);

        // Calcular total de artículos (suma de todos los presupuestos)
        const totalArticulos = cliente.articulos.length;
        
        const header = document.createElement('div');
        header.className = 'cliente-header';
        header.textContent = `${cliente.cliente_nombre} [ID: ${cliente.cliente_id}] (${totalArticulos} artículos, ${cliente.total_presupuestos} presupuestos)`;
        // Pasar containerId para que toggleAcordeon busque en la sección correcta
        header.addEventListener('click', () => toggleAcordeon(cliente.cliente_id, containerId));
        clienteDiv.appendChild(header);

        const contenido = document.createElement('div');
        contenido.className = 'cliente-contenido';
        // ID único por sección para evitar conflictos cuando el mismo cliente está en múltiples secciones
        contenido.id = `contenido-${containerId}-${cliente.cliente_id}`;
        contenido.style.padding = '10px';

        // Agrupar artículos por presupuesto_id y extraer datos de snapshot
        const presupuestosMap = new Map();
        cliente.articulos.forEach(articulo => {
            const presupId = articulo.presupuesto_id;
            if (!presupuestosMap.has(presupId)) {
                presupuestosMap.set(presupId, {
                    presupuesto_id: presupId,
                    presupuesto_fecha: articulo.presupuesto_fecha,
                    articulos: [],
                    // Datos del snapshot (vienen en cada artículo, tomar del primero)
                    snapshot_motivo: articulo.snapshot_motivo,
                    snapshot_numero_impresion: articulo.snapshot_numero_impresion,
                    snapshot_secuencia: articulo.snapshot_secuencia
                });
            }
            presupuestosMap.get(presupId).articulos.push(articulo);
        });

        // Convertir a array y ordenar por fecha
        const presupuestos = Array.from(presupuestosMap.values()).sort((a, b) => 
            new Date(b.presupuesto_fecha) - new Date(a.presupuesto_fecha)
        );

        console.log(`   → ${presupuestos.length} presupuestos agrupados`);

        // Crear acordeón para cada presupuesto
        presupuestos.forEach((presupuesto, idx) => {
            // Calcular estado del presupuesto
            let faltantes = 0;
            let completos = 0;
            presupuesto.articulos.forEach(art => {
                if (art.faltante > 0) {
                    faltantes++;
                } else {
                    completos++;
                }
            });
            
            const estadoPresupuesto = faltantes > 0 ? 'FALTANTES' : 'COMPLETO';
            const estadoClass = faltantes > 0 ? 'indicador-faltantes' : 'indicador-completo';
            
            const presupuestoDiv = document.createElement('div');
            presupuestoDiv.style.marginBottom = '15px';
            presupuestoDiv.style.border = '1px solid #dee2e6';
            presupuestoDiv.style.borderRadius = '4px';
            presupuestoDiv.style.overflow = 'hidden';

            // Header del presupuesto
            const presupuestoHeader = document.createElement('div');
            presupuestoHeader.style.padding = '12px 15px';
            presupuestoHeader.style.backgroundColor = '#f8f9fa';
            presupuestoHeader.style.display = 'flex';
            presupuestoHeader.style.justifyContent = 'space-between';
            presupuestoHeader.style.alignItems = 'center';
            presupuestoHeader.style.gap = '10px';
            
            const fechaFormateada = new Date(presupuesto.presupuesto_fecha).toLocaleDateString('es-AR');
            
            // Verificar si el presupuesto está modificado
            const esModificado = presupuesto.snapshot_motivo === 'modificado' || 
                               presupuesto.snapshot_secuencia === 'Imprimir_Modificado';
            
            let textoModificado = '';
            if (esModificado && presupuesto.snapshot_numero_impresion) {
                const numeroModificacion = presupuesto.snapshot_numero_impresion - 1;
                textoModificado = ` <span style="color: #dc3545; font-weight: bold; margin-left: 10px;">📝 Modificado ${numeroModificacion}</span>`;
                console.log(`[MOD-LIST] Snapshot modificado detectado para presupuesto ${presupuesto.presupuesto_id} - Numero de modificacion: ${numeroModificacion}`);
            }
            
            // Parte clickeable (info + icono)
            const clickeableDiv = document.createElement('div');
            clickeableDiv.style.display = 'flex';
            clickeableDiv.style.alignItems = 'center';
            clickeableDiv.style.flex = '1';
            clickeableDiv.style.cursor = 'pointer';
            clickeableDiv.style.gap = '10px';
            
            const iconSpan = document.createElement('span');
            iconSpan.textContent = '▼';
            iconSpan.style.fontSize = '1.2em';
            iconSpan.style.transition = 'transform 0.3s ease';
            
            const estadoSpan = document.createElement('span');
            estadoSpan.className = `indicador-estado ${estadoClass}`;
            estadoSpan.textContent = estadoPresupuesto;
            estadoSpan.style.marginRight = '10px';
            
            const infoSpan = document.createElement('span');
            infoSpan.innerHTML = `<strong>Presupuesto ${presupuesto.presupuesto_id}</strong> <span style="color: #6c757d; margin-left: 10px;">📅 ${fechaFormateada}</span> <span style="color: #6c757d; margin-left: 10px;">(${presupuesto.articulos.length} artículos)</span>${textoModificado}`;
            
            clickeableDiv.appendChild(iconSpan);
            clickeableDiv.appendChild(estadoSpan);
            clickeableDiv.appendChild(infoSpan);
            
            // Contenedor de botones del presupuesto
            const botonesPresupuesto = document.createElement('div');
            botonesPresupuesto.style.display = 'flex';
            botonesPresupuesto.style.gap = '8px';
            
            // Botón imprimir (solo en acordeón "Imprimir")
            if (containerId === 'pedidos-imprimir') {
                const btnImprimirPresup = document.createElement('button');
                btnImprimirPresup.textContent = '📄 Imprimir';
                btnImprimirPresup.className = 'admin-button';
                btnImprimirPresup.style.padding = '6px 12px';
                btnImprimirPresup.style.fontSize = '12px';
                btnImprimirPresup.addEventListener('click', (e) => {
                    e.stopPropagation();
                    imprimirPresupuestoIndividual(cliente.cliente_id, presupuesto.presupuesto_id);
                });
                botonesPresupuesto.appendChild(btnImprimirPresup);
            }
            
            // Botón verificar (solo en acordeón "Armar Pedido")
            if (containerId === 'pedidos-armar') {
                const btnVerificarPresup = document.createElement('button');
                btnVerificarPresup.textContent = '🔍 Verificar';
                btnVerificarPresup.className = 'admin-button';
                btnVerificarPresup.style.padding = '6px 12px';
                btnVerificarPresup.style.fontSize = '12px';
                btnVerificarPresup.style.background = '#007bff';
                btnVerificarPresup.addEventListener('click', (e) => {
                    e.stopPropagation();
                    abrirModalArmarPedido(cliente.cliente_id, presupuesto.presupuesto_id);
                });
                botonesPresupuesto.appendChild(btnVerificarPresup);
            }
            
            const presupuestoId = `presupuesto-${containerId}-${cliente.cliente_id}-${idx}`;
            clickeableDiv.addEventListener('click', () => {
                const contenidoPresup = document.getElementById(presupuestoId);
                if (contenidoPresup.style.display === 'none' || contenidoPresup.style.display === '') {
                    contenidoPresup.style.display = 'block';
                    iconSpan.style.transform = 'rotate(180deg)';
                    presupuestoHeader.style.backgroundColor = '#e9ecef';
                } else {
                    contenidoPresup.style.display = 'none';
                    iconSpan.style.transform = 'rotate(0deg)';
                    presupuestoHeader.style.backgroundColor = '#f8f9fa';
                }
            });

            presupuestoHeader.appendChild(clickeableDiv);
            presupuestoHeader.appendChild(botonesPresupuesto);
            presupuestoDiv.appendChild(presupuestoHeader);

            // Contenido del presupuesto (tabla de artículos)
            const presupuestoContenido = document.createElement('div');
            presupuestoContenido.id = presupuestoId;
            presupuestoContenido.style.display = 'none';

            const tabla = document.createElement('table');
            tabla.className = 'articulos-tabla';

            const thead = document.createElement('thead');
            // Para el acordeón de Stand By, solo mostrar Artículo, Descripción y Cantidad
            // No mostrar Stock ni Faltante ya que no tenemos forma confiable de obtenerlos
            if (containerId === 'pedidos-standby-container') {
                thead.innerHTML = `
                    <tr>
                        <th>Artículo</th>
                        <th>Descripción</th>
                        <th>Cantidad</th>
                    </tr>
                `;
            } else {
                thead.innerHTML = `
                    <tr>
                        <th>Artículo</th>
                        <th>Descripción</th>
                        <th>Cantidad</th>
                        <th>Stock Disponible</th>
                        <th>Faltante</th>
                        <th>Estado</th>
                    </tr>
                `;
            }
            tabla.appendChild(thead);

            const tbody = document.createElement('tbody');
            presupuesto.articulos.forEach(articulo => {
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

                // Solo agregar columnas de stock para acordeones que NO sean Stand By
                if (containerId !== 'pedidos-standby-container') {
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
                }

                tbody.appendChild(tr);
            });

            tabla.appendChild(tbody);
            presupuestoContenido.appendChild(tabla);
            presupuestoDiv.appendChild(presupuestoContenido);
            contenido.appendChild(presupuestoDiv);
        });

        // Botones de acción por cliente (al final de todos los presupuestos) - FUERA DEL LOOP
        const accionesDiv = document.createElement('div');
        accionesDiv.style.padding = '15px';
        accionesDiv.style.textAlign = 'center';
        accionesDiv.style.borderTop = '2px solid #dee2e6';
        accionesDiv.style.marginTop = '10px';

        // Calcular artículos faltantes de todos los presupuestos
        const articulosFaltantes = cliente.articulos.filter(art => art.faltante > 0);
        
        if (articulosFaltantes.length > 0) {
            const btnAsignar = document.createElement('button');
            btnAsignar.textContent = `Asignar Faltantes (${articulosFaltantes.length})`;
            btnAsignar.className = 'admin-button';
            btnAsignar.addEventListener('click', () => mostrarModalAsignarFaltantes(cliente.cliente_id, articulosFaltantes));
            accionesDiv.appendChild(btnAsignar);
        }

        // Solo mostrar botón "Imprimir Todos" si hay más de 1 presupuesto y estamos en acordeón "Imprimir"
        if (containerId === 'pedidos-imprimir' && presupuestos.length > 1) {
            const btnImprimirTodos = document.createElement('button');
            btnImprimirTodos.textContent = '📄 Imprimir Todos de Este Cliente';
            btnImprimirTodos.className = 'admin-button';
            btnImprimirTodos.style.marginLeft = '10px';
            btnImprimirTodos.addEventListener('click', () => imprimirPresupuestoCliente(cliente.cliente_id));
            accionesDiv.appendChild(btnImprimirTodos);
        }

        contenido.appendChild(accionesDiv);
        clienteDiv.appendChild(contenido);
        contenedor.appendChild(clienteDiv);
    });
}

// Función para renderizar pedidos por cliente (MODIFICADA para soportar agrupación por secuencia)
function renderPedidosCliente(pedidos) {
    if (!pedidos || pedidos.length === 0) {
        // Si no hay datos, limpiar todos los contenedores
        const containers = ['pedidos-imprimir', 'pedidos-armar', 'pedidos-listo'];
        containers.forEach(id => {
            const container = document.getElementById(id);
            if (container) {
                container.innerHTML = '<p class="mensaje-info">No hay pedidos pendientes para la fecha seleccionada.</p>';
            }
        });
        
        // Resetear contadores
        actualizarContadoresSecuencia({ imprimir: [], armar_pedido: [], pedido_listo: [] });
        return;
    }

    console.log('🔍 Renderizando pedidos por cliente con agrupación por secuencia...');
    
    // Agrupar por secuencia
    const grupos = agruparPresupuestosPorSecuencia(pedidos);
    
    // Renderizar cada grupo en su contenedor
    renderizarGrupoSecuencia('pedidos-imprimir', grupos.imprimir, 'Imprimir / Imprimir Modificado');
    renderizarGrupoSecuencia('pedidos-armar', grupos.armar_pedido, 'Armar Pedido');
    renderizarGrupoSecuencia('pedidos-listo', grupos.pedido_listo, 'Pedido Listo');
    
    // Actualizar contadores en títulos
    actualizarContadoresSecuencia(grupos);
}

// Función para calcular clase indicador estado
function calcularIndicadorEstado(articulo) {
    if (articulo.faltante === 0) return 'indicador-completo';
    if (articulo.faltante < articulo.pedido_total) return 'indicador-parcial';
    return 'indicador-faltantes';
}

// Función para toggle acordeon - MODIFICADA para buscar en el contexto correcto
function toggleAcordeon(clienteId, containerId) {
    // Buscar el contenido con ID único por sección
    const contenido = document.getElementById(`contenido-${containerId}-${clienteId}`);
    
    if (contenido) {
        if (contenido.style.display === 'block') {
            contenido.style.display = 'none';
        } else {
            contenido.style.display = 'block';
        }
    } else {
        console.warn(`⚠️ No se encontró contenido para cliente ${clienteId} en ${containerId}`);
    }
}

// Función para abrir acordeon del cliente DENTRO de una sección específica
function abrirAcordeonEnSeccion(clienteId, containerId) {
    console.log(`🔍 [DEBUG] Iniciando abrirAcordeonEnSeccion(${clienteId}, ${containerId})`);
    
    // PASO 1: Expandir el acordeón del cliente
    const contenidoId = `contenido-${containerId}-${clienteId}`;
    const contenido = document.getElementById(contenidoId);
    
    console.log(`🔍 [DEBUG] Buscando contenido con ID: ${contenidoId}`);
    console.log(`🔍 [DEBUG] Contenido encontrado:`, contenido ? 'SÍ' : 'NO');
    
    if (contenido) {
        const displayAntes = contenido.style.display;
        contenido.style.display = 'block';
        const displayDespues = contenido.style.display;
        
        console.log(`✅ [DEBUG] Acordeón del cliente expandido - Display: ${displayAntes} → ${displayDespues}`);
        
        // PASO 2: Expandir todos los presupuestos dentro del cliente (solo en "Armar Pedido")
        if (containerId === 'pedidos-armar') {
            setTimeout(() => {
                // Buscar todos los divs de presupuesto dentro del contenido del cliente
                const presupuestoDivs = contenido.querySelectorAll('div[style*="margin-bottom: 15px"]');
                console.log(`🔍 [DEBUG] Divs de presupuesto encontrados: ${presupuestoDivs.length}`);
                
                // Buscar todos los contenidos de presupuesto con el patrón correcto (presupuesto-containerId-clienteId-*)
                const presupuestosContenido = contenido.querySelectorAll(`[id^="presupuesto-${containerId}-${clienteId}-"]`);
                console.log(`🔍 [DEBUG] Contenidos de presupuesto encontrados: ${presupuestosContenido.length}`);
                
                presupuestosContenido.forEach((presupuestoContenido, idx) => {
                    // Expandir el contenido del presupuesto
                    presupuestoContenido.style.display = 'block';
                    
                    // Buscar el header del presupuesto (es el previousElementSibling)
                    const presupuestoHeader = presupuestoContenido.previousElementSibling;
                    if (presupuestoHeader) {
                        // Buscar el div clickeable dentro del header (el primero)
                        const clickeableDiv = presupuestoHeader.querySelector('div[style*="cursor: pointer"]');
                        
                        // Buscar el icono dentro del clickeable div
                        const iconSpan = clickeableDiv ? clickeableDiv.querySelector('span') : presupuestoHeader.querySelector('span');
                        if (iconSpan) {
                            iconSpan.style.transform = 'rotate(180deg)';
                        }
                        presupuestoHeader.style.backgroundColor = '#e9ecef';
                    }
                    
                    console.log(`   ✅ [DEBUG] Presupuesto ${idx} expandido: ${presupuestoContenido.id}`);
                });
            }, 200);
        }
    } else {
        console.error(`❌ [DEBUG] No se encontró contenido con ID: ${contenidoId}`);
        
        // Listar todos los IDs de contenido en el DOM para debugging
        const todosLosContenidos = document.querySelectorAll('.cliente-contenido');
        console.log(`🔍 [DEBUG] Total de contenidos en el DOM: ${todosLosContenidos.length}`);
        todosLosContenidos.forEach((cont, idx) => {
            console.log(`   [${idx}] ID: ${cont.id}`);
        });
    }
}

// Función para forzar expansión de sección principal
function forzarExpandirSeccion(sectionId) {
    const content = document.getElementById(sectionId);
    const button = document.querySelector(`[onclick="toggleSection('${sectionId}')"]`);
    
    if (content && content.style.display === 'none') {
        // Expandir
        content.style.display = 'block';
        content.classList.add('expanding');
        content.classList.remove('collapsing');
        if (button) {
            button.setAttribute('aria-expanded', 'true');
        }
        
        setTimeout(() => {
            content.classList.remove('expanding');
        }, 300);
        
        console.log(`📂 Sección ${sectionId} expandida`);
    } else if (content) {
        console.log(`📂 Sección ${sectionId} ya estaba expandida`);
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

/**
 * Actualiza la secuencia de presupuestos a "Armar_Pedido"
 */
async function actualizarSecuenciaPresupuestos(presupuestosIds) {
    try {
        console.log(`🔄 Actualizando secuencia de ${presupuestosIds.length} presupuestos a "Armar_Pedido"...`);
        
        const response = await fetch(`${base}/actualizar-secuencia`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                presupuestos_ids: presupuestosIds,
                nueva_secuencia: 'Armar_Pedido'
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            console.log(`✅ Secuencia actualizada: ${data.actualizados} presupuestos`);
            return true;
        } else {
            console.error('❌ Error al actualizar secuencia:', data.error);
            return false;
        }
    } catch (error) {
        console.error('❌ Error al actualizar secuencia:', error);
        return false;
    }
}

/**
 * Obtiene todos los IDs de presupuestos de un cliente desde los datos cargados
 * @param {number} clienteId - ID del cliente
 * @param {Array<string>} secuenciasFiltro - Opcional: filtrar por secuencias
 * @returns {Array<number>} Array de IDs internos de presupuestos
 */
function obtenerPresupuestosDeCliente(clienteId, secuenciasFiltro = null) {
    const presupuestosIds = new Set();
    
    // Buscar en los datos cargados
    if (window.clientesPedidos && window.clientesPedidos.length > 0) {
        const cliente = window.clientesPedidos.find(c => c.cliente_id === clienteId);
        if (cliente && cliente.articulos) {
            cliente.articulos.forEach(art => {
                // Aplicar filtro de secuencia si existe
                if (secuenciasFiltro && secuenciasFiltro.length > 0) {
                    const secuenciaArticulo = (art.secuencia || 'Imprimir').trim();
                    if (secuenciasFiltro.includes(secuenciaArticulo) && art.presupuesto_id) {
                        presupuestosIds.add(art.presupuesto_id);
                    }
                } else {
                    if (art.presupuesto_id) {
                        presupuestosIds.add(art.presupuesto_id);
                    }
                }
            });
        }
    }
    
    return Array.from(presupuestosIds);
}

/**
 * Obtiene todos los IDs EXTERNOS de presupuestos de todos los clientes desde los datos cargados
 * @param {Array<string>} secuenciasFiltro - Opcional: Array de secuencias para filtrar
 * @returns {Array<string>} Array de IDs externos de presupuestos (id_presupuesto_ext)
 */
function obtenerTodosLosPresupuestosExternos(secuenciasFiltro = null) {
    const presupuestosIdsExternos = new Set();
    
    console.log(`📋 [OBTENER-PRESUP-EXT] Filtro de secuencias:`, secuenciasFiltro || 'NINGUNO (todos)');
    
    if (window.clientesPedidos && window.clientesPedidos.length > 0) {
        window.clientesPedidos.forEach(cliente => {
            if (cliente.articulos) {
                // Agrupar por presupuesto_id para obtener id_presupuesto_ext único
                const presupuestosMap = new Map();
                
                cliente.articulos.forEach(art => {
                    // Si hay filtro de secuencias, verificar que el artículo pertenezca a alguna
                    const secuenciaArticulo = (art.secuencia || 'Imprimir').trim();
                    
                    if (secuenciasFiltro && secuenciasFiltro.length > 0) {
                        if (secuenciasFiltro.includes(secuenciaArticulo)) {
                            if (art.presupuesto_id && !presupuestosMap.has(art.presupuesto_id)) {
                                presupuestosMap.set(art.presupuesto_id, art.presupuesto_id);
                                presupuestosIdsExternos.add(art.presupuesto_id);
                            }
                        }
                    } else {
                        // Sin filtro: comportamiento original
                        if (art.presupuesto_id && !presupuestosMap.has(art.presupuesto_id)) {
                            presupuestosMap.set(art.presupuesto_id, art.presupuesto_id);
                            presupuestosIdsExternos.add(art.presupuesto_id);
                        }
                    }
                });
            }
        });
    }
    
    const resultado = Array.from(presupuestosIdsExternos);
    console.log(`📋 [OBTENER-PRESUP-EXT] IDs externos encontrados: ${resultado.length}`, resultado);
    
    return resultado;
}

// Función para imprimir todos los presupuestos de un cliente
async function imprimirPresupuestoCliente(clienteId) {
    console.log(`📄 Imprimiendo presupuestos del cliente ${clienteId}...`);
    
    // 1. Obtener IDs de presupuestos del cliente
    const presupuestosIds = obtenerPresupuestosDeCliente(clienteId);
    console.log(`📋 Presupuestos a imprimir: ${presupuestosIds.length}`);
    
    // 2. Abrir impresión
    const urlPdf = `${base}/impresion-presupuesto?cliente_id=${clienteId}&formato=pdf`;
    const urlHtml = `${base}/impresion-presupuesto?cliente_id=${clienteId}&formato=html`;

    const win = window.open(urlPdf, '_blank');

    setTimeout(() => {
        if (!win || win.closed || typeof win.closed == 'undefined') {
            window.open(urlHtml, '_blank');
        }
    }, 2000);
    
    // 3. Actualizar secuencia a "Armar_Pedido"
    if (presupuestosIds.length > 0) {
        const actualizado = await actualizarSecuenciaPresupuestos(presupuestosIds);
        if (actualizado) {
            // Recargar datos y expandir sección "Armar Pedido" + cliente
            setTimeout(() => {
                cargarPedidosPorCliente();
                
                setTimeout(() => {
                    console.log(`🔍 Expandiendo sección "Armar Pedido" y cliente ${clienteId}...`);
                    forzarExpandirSeccion('pedidos-armar-section');
                    
                    // Expandir el cliente DENTRO de la sección "Armar Pedido"
                    setTimeout(() => {
                        abrirAcordeonEnSeccion(clienteId, 'pedidos-armar');
                    }, 500);
                }, 800);
            }, 1000);
        }
    }
}

// Función para imprimir un presupuesto individual
async function imprimirPresupuestoIndividual(clienteId, presupuestoId) {
    console.log(`📄 Imprimiendo presupuesto individual: Cliente ${clienteId}, Presupuesto ${presupuestoId}`);
    
    // 1. Abrir impresión
    const urlPdf = `${base}/impresion-presupuesto?cliente_id=${clienteId}&presupuesto_id=${presupuestoId}&formato=pdf`;
    const urlHtml = `${base}/impresion-presupuesto?cliente_id=${clienteId}&presupuesto_id=${presupuestoId}&formato=html`;

    const win = window.open(urlPdf, '_blank');

    setTimeout(() => {
        if (!win || win.closed || typeof win.closed == 'undefined') {
            window.open(urlHtml, '_blank');
        }
    }, 2000);
    
    // 2. Actualizar secuencia a "Armar_Pedido"
    const actualizado = await actualizarSecuenciaPresupuestos([presupuestoId]);
    if (actualizado) {
        // Recargar datos y expandir sección "Armar Pedido" + cliente
        setTimeout(() => {
            cargarPedidosPorCliente();
            
            setTimeout(() => {
                console.log(`🔍 Expandiendo sección "Armar Pedido" y cliente ${clienteId}...`);
                forzarExpandirSeccion('pedidos-armar-section');
                
                // Expandir el cliente DENTRO de la sección "Armar Pedido"
                setTimeout(() => {
                    abrirAcordeonEnSeccion(clienteId, 'pedidos-armar');
                }, 500);
            }, 800);
        }, 1000);
    }
}

// Función para imprimir TODOS los presupuestos del acordeón "Imprimir / Imprimir Modificado"
async function imprimirTodosLosPresupuestos(fechaCorte) {
    console.log(`📄 [IMPRIMIR-TODOS] Imprimiendo presupuestos del acordeón "Imprimir / Imprimir Modificado"`);
    
    // 1. Obtener IDs EXTERNOS de presupuestos SOLO del acordeón "Imprimir / Imprimir Modificado"
    const secuenciasFiltro = ['Imprimir', 'Imprimir_Modificado'];
    const presupuestosIdsExternos = obtenerTodosLosPresupuestosExternos(secuenciasFiltro);
    
    console.log(`📋 [IMPRIMIR-TODOS] IDs externos filtrados: ${presupuestosIdsExternos.length}`, presupuestosIdsExternos);
    
    if (presupuestosIdsExternos.length === 0) {
        alert('No hay presupuestos para imprimir en el acordeón "Imprimir / Imprimir Modificado"');
        return;
    }
    
    // 2. Construir lista de IDs externos para pasar al backend (igual que botón individual)
    const idsParam = presupuestosIdsExternos.join(',');
    
    // 3. Abrir impresión usando el MISMO FORMATO que el botón individual
    // El botón individual usa: cliente_id + presupuesto_id (id_presupuesto_ext)
    // Para "todos", usamos: fecha + presupuestos_ext_ids
    const urlPdf = `${base}/impresion-presupuesto?fecha=${fechaCorte}&presupuestos_ext_ids=${encodeURIComponent(idsParam)}&formato=pdf`;
    const urlHtml = `${base}/impresion-presupuesto?fecha=${fechaCorte}&presupuestos_ext_ids=${encodeURIComponent(idsParam)}&formato=html`;

    console.log(`🔗 [IMPRIMIR-TODOS] URL: ${urlHtml}`);

    const win = window.open(urlPdf, '_blank');

    setTimeout(() => {
        if (!win || win.closed || typeof win.closed == 'undefined') {
            window.open(urlHtml, '_blank');
        }
    }, 2000);
    
    // 4. Actualizar secuencia a "Armar_Pedido" (usa IDs externos)
    if (presupuestosIdsExternos.length > 0) {
        const actualizado = await actualizarSecuenciaPresupuestos(presupuestosIdsExternos);
        if (actualizado) {
            console.log(`✅ [IMPRIMIR-TODOS] Secuencia actualizada para ${presupuestosIdsExternos.length} presupuestos`);
            setTimeout(() => {
                cargarPedidosPorCliente();
            }, 1000);
        }
    }
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
        tr.className = 'expandible-row';
        tr.setAttribute('data-articulo', articulo.articulo_numero);
        tr.setAttribute('data-articulo-numero', articulo.articulo_numero);
        tr.setAttribute('data-estado', articulo.estado.toLowerCase());
        tr.onclick = (e) => {
            if (typeof window.handleFilaClick === 'function') {
                window.handleFilaClick(articulo.articulo_numero, e);
            }
        };

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
        
        // Columna de acciones con botón Pack
        const tdAcciones = document.createElement('td');
        tdAcciones.onclick = (e) => e.stopPropagation();
        
        const btnPack = document.createElement('button');
        btnPack.className = 'pack-button pack-config-btn';
        btnPack.textContent = '🧩 Pack';
        btnPack.setAttribute('data-codigo', articulo.articulo_numero);
        btnPack.onclick = () => {
            if (typeof window.abrirModalPack === 'function') {
                window.abrirModalPack(articulo.articulo_numero);
            }
        };
        tdAcciones.appendChild(btnPack);
        tr.appendChild(tdAcciones);

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

// ==========================================
// FUNCIONES PARA MODAL DE ARMAR PEDIDO (VERIFICACIÓN INTERACTIVA)
// ==========================================

// Estado del modal de verificación
let estadoVerificacion = {
    presupuesto_id: null,
    cliente_id: null,
    articulos: [],
    articulosConfirmados: 0,
    totalArticulos: 0
};

/**
 * Abre el modal de verificación de pedido
 */
function abrirModalArmarPedido(clienteId, presupuestoId) {
    console.log(`🔍 Abriendo modal de verificación: Cliente ${clienteId}, Presupuesto ${presupuestoId}`);
    
    // Obtener artículos del presupuesto
    const articulos = obtenerArticulosPresupuesto(clienteId, presupuestoId);
    
    if (!articulos || articulos.length === 0) {
        alert('No se encontraron artículos para este presupuesto');
        return;
    }
    
    // Inicializar estado
    estadoVerificacion = {
        presupuesto_id: presupuestoId,
        cliente_id: clienteId,
        articulos: articulos.map(art => ({
            ...art,
            cantidad_confirmada: 0,
            confirmado: false
        })),
        articulosConfirmados: 0,
        totalArticulos: articulos.length
    };
    
    // Actualizar título del modal
    const titulo = document.getElementById('modal-presupuesto-titulo');
    if (titulo) {
        titulo.textContent = `Presupuesto ${presupuestoId}`;
    }
    
    // Renderizar tabla de artículos
    renderizarTablaVerificacion();
    
    // Actualizar progreso
    actualizarProgreso();
    
    // Limpiar campo de escaneo y feedback
    const scannerInput = document.getElementById('scanner-input');
    const feedback = document.getElementById('scanner-feedback');
    if (scannerInput) {
        scannerInput.value = '';
        scannerInput.focus();
    }
    if (feedback) {
        feedback.className = 'feedback-message';
        feedback.style.display = 'none';
    }
    
    // Configurar listener para el campo de escaneo
    configurarScannerInput();
    
    // Mostrar modal
    const modal = document.getElementById('modal-armar-pedido');
    if (modal) {
        modal.style.display = 'flex';
    }
}

/**
 * Obtiene los artículos de un presupuesto específico
 */
function obtenerArticulosPresupuesto(clienteId, presupuestoId) {
    if (!window.clientesPedidos) return [];
    
    const cliente = window.clientesPedidos.find(c => c.cliente_id === clienteId);
    if (!cliente || !cliente.articulos) return [];
    
    // Filtrar artículos que pertenecen al presupuesto
    return cliente.articulos.filter(art => art.presupuesto_id === presupuestoId);
}

/**
 * Renderiza la tabla de artículos para verificación
 */
function renderizarTablaVerificacion() {
    const tbody = document.getElementById('lista-articulos-verificacion');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    estadoVerificacion.articulos.forEach((articulo, index) => {
        const tr = document.createElement('tr');
        tr.className = articulo.confirmado ? 'articulo-confirmado' : 'articulo-pendiente';
        tr.id = `articulo-row-${index}`;
        
        // Estado
        const tdEstado = document.createElement('td');
        tdEstado.className = 'estado-check';
        tdEstado.textContent = articulo.confirmado ? '✅' : '⏳';
        tr.appendChild(tdEstado);
        
        // Código
        const tdCodigo = document.createElement('td');
        tdCodigo.textContent = articulo.articulo_numero;
        tr.appendChild(tdCodigo);
        
        // Descripción
        const tdDescripcion = document.createElement('td');
        tdDescripcion.textContent = articulo.descripcion || '-';
        tr.appendChild(tdDescripcion);
        
        // Cantidad Pedida
        const tdPedida = document.createElement('td');
        tdPedida.textContent = articulo.pedido_total;
        tdPedida.style.textAlign = 'center';
        tr.appendChild(tdPedida);
        
        // Cantidad Confirmada
        const tdConfirmada = document.createElement('td');
        const inputConfirmada = document.createElement('input');
        inputConfirmada.type = 'number';
        inputConfirmada.min = '0';
        inputConfirmada.max = articulo.pedido_total;
        inputConfirmada.value = articulo.cantidad_confirmada;
        inputConfirmada.style.width = '80px';
        inputConfirmada.style.textAlign = 'center';
        inputConfirmada.addEventListener('change', (e) => {
            const cantidad = parseInt(e.target.value) || 0;
            marcarArticuloConfirmado(index, cantidad);
        });
        tdConfirmada.appendChild(inputConfirmada);
        tr.appendChild(tdConfirmada);
        
        // Acciones
        const tdAcciones = document.createElement('td');
        const btnMarcar = document.createElement('button');
        btnMarcar.textContent = articulo.confirmado ? '✓' : '✓ OK';
        btnMarcar.className = 'btn-marcar-manual';
        btnMarcar.addEventListener('click', () => {
            marcarArticuloConfirmado(index, articulo.pedido_total);
        });
        tdAcciones.appendChild(btnMarcar);
        tr.appendChild(tdAcciones);
        
        tbody.appendChild(tr);
    });
}

/**
 * Configura el listener para el campo de escaneo
 */
function configurarScannerInput() {
    const scannerInput = document.getElementById('scanner-input');
    if (!scannerInput) return;
    
    // Remover listeners anteriores
    const newInput = scannerInput.cloneNode(true);
    scannerInput.parentNode.replaceChild(newInput, scannerInput);
    
    // Agregar nuevo listener
    newInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const codigo = newInput.value.trim();
            if (codigo) {
                procesarCodigoEscaneado(codigo);
                newInput.value = '';
            }
        }
    });
}

/**
 * Procesa un código escaneado
 */
function procesarCodigoEscaneado(codigo) {
    console.log(`🔍 Código escaneado: ${codigo}`);
    
    // Buscar artículo en la lista
    const index = estadoVerificacion.articulos.findIndex(art => 
        art.articulo_numero === codigo || art.articulo_numero.toString() === codigo
    );
    
    const feedback = document.getElementById('scanner-feedback');
    
    if (index !== -1) {
        // Artículo encontrado
        const articulo = estadoVerificacion.articulos[index];
        
        // Incrementar cantidad confirmada en 1 (no marcar completo directamente)
        const nuevaCantidad = articulo.cantidad_confirmada + 1;
        
        if (nuevaCantidad > articulo.pedido_total) {
            // Ya se escaneó la cantidad completa
            mostrarFeedback(`⚠️ Artículo ${codigo} ya tiene ${articulo.cantidad_confirmada}/${articulo.pedido_total} confirmados`, 'error');
        } else {
            // Incrementar en 1
            marcarArticuloConfirmado(index, nuevaCantidad);
            
            // Feedback diferenciado según si completó o no
            if (nuevaCantidad >= articulo.pedido_total) {
                mostrarFeedback(`✅ Artículo ${codigo} COMPLETO (${nuevaCantidad}/${articulo.pedido_total})`, 'success');
            } else {
                mostrarFeedback(`✅ Artículo ${codigo} +1 → ${nuevaCantidad}/${articulo.pedido_total}`, 'success');
            }
        }
    } else {
        // Artículo no encontrado
        mostrarFeedback(`❌ Artículo ${codigo} no pertenece a este presupuesto`, 'error');
    }
}

/**
 * Marca un artículo como confirmado
 */
function marcarArticuloConfirmado(index, cantidad) {
    const articulo = estadoVerificacion.articulos[index];
    const cantidadAnterior = articulo.cantidad_confirmada;
    
    articulo.cantidad_confirmada = cantidad;
    articulo.confirmado = (cantidad >= articulo.pedido_total);
    
    // Si cambió el estado de confirmación, actualizar contador
    if (!articulo.confirmado && cantidadAnterior >= articulo.pedido_total) {
        estadoVerificacion.articulosConfirmados--;
    } else if (articulo.confirmado && cantidadAnterior < articulo.pedido_total) {
        estadoVerificacion.articulosConfirmados++;
    }
    
    // Actualizar fila en la tabla
    const row = document.getElementById(`articulo-row-${index}`);
    if (row) {
        row.className = articulo.confirmado ? 'articulo-confirmado' : 'articulo-pendiente';
        const estadoCell = row.querySelector('.estado-check');
        if (estadoCell) {
            estadoCell.textContent = articulo.confirmado ? '✅' : '⏳';
        }
        
        // Actualizar input de cantidad
        const input = row.querySelector('input[type="number"]');
        if (input) {
            input.value = cantidad;
        }
    }
    
    // Actualizar progreso
    actualizarProgreso();
    
    // Verificar si se puede habilitar el botón de confirmar
    verificarEstadoCompleto();
}

/**
 * Actualiza la barra de progreso
 */
function actualizarProgreso() {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    const porcentaje = (estadoVerificacion.articulosConfirmados / estadoVerificacion.totalArticulos) * 100;
    
    if (progressFill) {
        progressFill.style.width = `${porcentaje}%`;
    }
    
    if (progressText) {
        progressText.textContent = `${estadoVerificacion.articulosConfirmados} de ${estadoVerificacion.totalArticulos} artículos confirmados`;
    }
}

/**
 * Verifica si todos los artículos están confirmados
 */
function verificarEstadoCompleto() {
    const btnConfirmar = document.getElementById('btn-confirmar-pedido-completo');
    if (!btnConfirmar) return;
    
    const todosConfirmados = estadoVerificacion.articulosConfirmados === estadoVerificacion.totalArticulos;
    btnConfirmar.disabled = !todosConfirmados;
    
    if (todosConfirmados) {
        console.log('✅ Todos los artículos confirmados - Botón habilitado');
    }
}

/**
 * Muestra feedback al usuario
 */
function mostrarFeedback(mensaje, tipo) {
    const feedback = document.getElementById('scanner-feedback');
    if (!feedback) return;
    
    feedback.textContent = mensaje;
    feedback.className = `feedback-message feedback-${tipo}`;
    feedback.style.display = 'block';
    
    // Ocultar después de 3 segundos
    setTimeout(() => {
        feedback.style.display = 'none';
    }, 3000);
}

/**
 * Confirma el pedido completo y cambia secuencia a "Pedido_Listo"
 */
async function confirmarPedidoCompleto() {
    console.log('✅ Confirmando pedido completo...');
    
    // Verificar que todos estén confirmados
    if (estadoVerificacion.articulosConfirmados !== estadoVerificacion.totalArticulos) {
        alert('Debe confirmar todos los artículos antes de completar el pedido');
        return;
    }
    
    // Actualizar secuencia a "Pedido_Listo"
    try {
        const response = await fetch(`${base}/actualizar-secuencia`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                presupuestos_ids: [estadoVerificacion.presupuesto_id],
                nueva_secuencia: 'Pedido_Listo'
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            console.log(`✅ Pedido marcado como listo`);
            
            // Cerrar modal
            cerrarModalArmarPedido();
            
            // Mostrar mensaje de éxito
            mostrarToast('✅ Pedido verificado y marcado como listo', 'success');
            
            // Recargar datos
            setTimeout(() => {
                cargarPedidosPorCliente();
            }, 500);
        } else {
            alert(`Error al actualizar secuencia: ${data.error}`);
        }
    } catch (error) {
        console.error('❌ Error al confirmar pedido:', error);
        alert('Error al confirmar pedido. Intente nuevamente.');
    }
}

/**
 * Cierra el modal de armar pedido
 */
function cerrarModalArmarPedido() {
    const modal = document.getElementById('modal-armar-pedido');
    if (modal) {
        modal.style.display = 'none';
    }
    
    // Limpiar estado
    estadoVerificacion = {
        presupuesto_id: null,
        cliente_id: null,
        articulos: [],
        articulosConfirmados: 0,
        totalArticulos: 0
    };
}

// Configurar event listener para el botón de confirmar pedido completo
document.addEventListener('DOMContentLoaded', () => {
    const btnConfirmarCompleto = document.getElementById('btn-confirmar-pedido-completo');
    if (btnConfirmarCompleto) {
        btnConfirmarCompleto.addEventListener('click', confirmarPedidoCompleto);
    }
});

/**
 * Muestra un toast notification
 */
function mostrarToast(texto, tipo = 'success') {
    // Crear elemento toast
    const toast = document.createElement('div');
    toast.className = `toast ${tipo === 'error' ? 'error' : ''}`;
    toast.textContent = texto;
    
    // Agregar al DOM
    document.body.appendChild(toast);
    
    // Mostrar con animación
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    // Ocultar y remover después de 3 segundos
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// Hacer funciones disponibles globalmente
window.abrirModalArmarPedido = abrirModalArmarPedido;
window.cerrarModalArmarPedido = cerrarModalArmarPedido;
window.mostrarToast = mostrarToast;
window.cargarPedidosArticulos = cargarPedidosArticulos;

// ==========================================
// FUNCIONES PARA PRESUPUESTOS SIN CONFIRMAR (STAND BY)
// ==========================================

/**
 * Cargar presupuestos sin confirmar (estado "Muestra de Fraccionados")
 * Usa el mismo formato de renderizado que los otros acordeones
 */
async function cargarPresupuestosStandBy() {
    console.log('🔍 [STANDBY] Cargando presupuestos sin confirmar...');
    
    const contenedor = document.getElementById('pedidos-standby-container');
    const contador = document.getElementById('contador-standby');
    
    if (!contenedor) {
        console.error('❌ [STANDBY] No se encontró contenedor pedidos-standby-container');
        return;
    }
    
    // Mostrar loading
    contenedor.innerHTML = '<p class="mensaje-info">Cargando presupuestos...</p>';
    if (contador) contador.textContent = '0';
    
    try {
        // Llamar al endpoint de presupuestos con filtro por estado
        // IMPORTANTE: El módulo de presupuestos corre en puerto 3003
        const response = await fetch('http://localhost:3003/api/presupuestos?estado=Muestra de Fraccionados');
        
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📊 [STANDBY] Respuesta del servidor:', data);
        
        if (!data.success) {
            throw new Error(data.message || 'Error al cargar presupuestos');
        }
        
        const presupuestos = data.data || [];
        console.log(`✅ [STANDBY] Presupuestos recibidos: ${presupuestos.length}`);
        
        // Actualizar contador
        if (contador) {
            contador.textContent = presupuestos.length;
        }
        
        // Si no hay presupuestos, mostrar mensaje
        if (presupuestos.length === 0) {
            contenedor.innerHTML = '<p class="mensaje-info">No hay presupuestos sin confirmar</p>';
            return;
        }
        
        // Obtener detalles de cada presupuesto (artículos)
        const presupuestosConDetalles = await Promise.all(
            presupuestos.map(async (presup) => {
                try {
                    const detallesResponse = await fetch(`http://localhost:3003/api/presupuestos/${presup.id}/detalles`);
                    const detallesData = await detallesResponse.json();
                    
                    if (detallesData.success && detallesData.data && detallesData.data.detalles) {
                        return {
                            ...presup,
                            articulos: detallesData.data.detalles
                        };
                    }
                    return { ...presup, articulos: [] };
                } catch (error) {
                    console.error(`❌ Error al obtener detalles del presupuesto ${presup.id}:`, error);
                    return { ...presup, articulos: [] };
                }
            })
        );
        
        console.log('📊 [STANDBY] Presupuestos con detalles obtenidos');
        
        // Obtener stock de todos los artículos en una sola consulta
        const todosLosArticulos = new Set();
        presupuestosConDetalles.forEach(presup => {
            if (presup.articulos) {
                presup.articulos.forEach(art => {
                    const codigo = art.articulo || art.codigo;
                    if (codigo) todosLosArticulos.add(codigo);
                });
            }
        });
        
        // Transformar al formato esperado por renderizarGrupoSecuencia
        // NO consultamos stock para Stand By - solo mostramos los artículos del presupuesto
        const clientesMap = new Map();
        
        presupuestosConDetalles.forEach(presup => {
            const clienteKey = presup.concepto || 'Sin cliente';
            
            if (!clientesMap.has(clienteKey)) {
                clientesMap.set(clienteKey, {
                    cliente_id: clienteKey,
                    cliente_nombre: clienteKey,
                    articulos: []
                });
            }
            
            // Agregar los artículos reales del presupuesto
            // Para Stand By: solo mostrar artículo, descripción y cantidad
            if (presup.articulos && presup.articulos.length > 0) {
                presup.articulos.forEach(art => {
                    const cantidad = art.cantidad || 0;
                    const codigoArticulo = art.articulo || art.codigo;
                    
                    clientesMap.get(clienteKey).articulos.push({
                        presupuesto_id: presup.id,
                        presupuesto_fecha: presup.fecha_registro,
                        articulo_numero: codigoArticulo || '-',
                        descripcion: art.descripcion_articulo || art.descripcion || '-',
                        pedido_total: cantidad,
                        stock_disponible: 0, // No mostrado en UI
                        faltante: 0, // No mostrado en UI
                        secuencia: 'Muestra de Fraccionados',
                        snapshot_motivo: null,
                        snapshot_numero_impresion: null,
                        snapshot_secuencia: null
                    });
                });
            }
        });
        
        const clientesArray = Array.from(clientesMap.values());
        
        // Calcular totales por cliente
        clientesArray.forEach(cliente => {
            const presupuestosUnicos = new Set(cliente.articulos.map(art => art.presupuesto_id));
            cliente.total_articulos = cliente.articulos.length;
            cliente.total_presupuestos = presupuestosUnicos.size;
        });
        
        // Renderizar usando la función existente
        renderizarGrupoSecuencia('pedidos-standby-container', clientesArray, 'Presupuestos sin Confirmar');
        
        console.log('✅ [STANDBY] Presupuestos renderizados con formato estándar y artículos reales');
        
    } catch (error) {
        console.error('❌ [STANDBY] Error al cargar presupuestos:', error);
        contenedor.innerHTML = `<p class="mensaje-error">Error: ${error.message}</p>`;
        if (contador) contador.textContent = '0';
    }
}

/**
 * Escapar HTML para prevenir XSS
 */
function escapeHtmlStandBy(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Formatear fecha en formato dd/mm/yyyy hh:mm
 */
function formatearFechaStandBy(dateString) {
    if (!dateString) return 'N/A';
    
    try {
        // Para fechas YYYY-MM-DD (solo fecha)
        if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            const [y, m, d] = dateString.split('-');
            return `${d}/${m}/${y} 00:00`;
        }
        
        // Para fechas con hora
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    } catch (error) {
        console.error('❌ Error al formatear fecha:', error);
        return 'Fecha inválida';
    }
}

/**
 * Ver detalles de un presupuesto
 */
function verDetallesPresupuesto(presupuestoId) {
    console.log(`👁️ [STANDBY] Ver detalles del presupuesto ${presupuestoId}`);
    // Redirigir a la página de presupuestos con el ID
    window.open(`/pages/presupuestos.html?id=${presupuestoId}`, '_blank');
}

/**
 * Imprimir presupuesto sin confirmar
 */
function imprimirPresupuestoStandBy(presupuestoId) {
    console.log(`📄 [STANDBY] Imprimir presupuesto ${presupuestoId}`);
    // Redirigir a la página de impresión de presupuestos
    window.open(`/pages/imprimir-presupuesto.html?id=${presupuestoId}`, '_blank');
}

/**
 * Editar presupuesto sin confirmar
 */
function editarPresupuestoStandBy(presupuestoId) {
    console.log(`✏️ [STANDBY] Editar presupuesto ${presupuestoId}`);
    // Redirigir a la página de edición de presupuestos
    window.open(`/pages/editar-presupuesto.html?id=${presupuestoId}`, '_blank');
}

// Cargar presupuestos sin confirmar al inicializar la página
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 [STANDBY] Inicializando carga de presupuestos sin confirmar...');
    
    // Cargar después de 2 segundos para no interferir con otras cargas
    setTimeout(() => {
        cargarPresupuestosStandBy();
    }, 2000);
    
    // Recargar cada 60 segundos para mantener actualizado
    setInterval(() => {
        cargarPresupuestosStandBy();
    }, 60000);
});

// Exponer función globalmente
window.cargarPresupuestosStandBy = cargarPresupuestosStandBy;

console.log('✅ [STANDBY] Módulo de presupuestos sin confirmar cargado');
