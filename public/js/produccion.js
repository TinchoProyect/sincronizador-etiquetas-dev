// ===== VARIABLES GLOBALES =====
let colaboradores = [];
let usuariosColaboradores = [];
let articulosPedidos = [];
let clientesPedidos = [];

// ===== FUNCIONES DE INICIALIZACIÓN =====

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Inicializando página de producción...');
    
    // Establecer fecha por defecto (hoy)
    const hoy = new Date().toISOString().split('T')[0];
    const fechaCorte = document.getElementById('fecha-corte');
    const fechaCorteArticulos = document.getElementById('fecha-corte-articulos');
    
    if (fechaCorte) fechaCorte.value = hoy;
    if (fechaCorteArticulos) fechaCorteArticulos.value = hoy;
    
    // Cargar datos iniciales
    cargarColaboradores();
    cargarUsuariosColaboradores();
    
    // Configurar event listeners
    configurarEventListeners();
    
    // Cargar pedidos por cliente automáticamente
    setTimeout(() => {
        cargarPedidosPorCliente();
    }, 500);
    
    console.log('✅ Página de producción inicializada');
});

// ===== FUNCIONES DE CARGA DE DATOS =====

async function cargarColaboradores() {
    try {
        console.log('📥 Cargando colaboradores...');
        
        const response = await fetch('/api/produccion/usuarios?rol=2&activo=true');
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        colaboradores = await response.json();
        console.log('✅ Colaboradores cargados:', colaboradores.length);
        
        renderizarColaboradores();
        
    } catch (error) {
        console.error('❌ Error al cargar colaboradores:', error);
        mostrarErrorColaboradores();
    }
}

async function cargarUsuariosColaboradores() {
    try {
        console.log('📥 Cargando usuarios colaboradores para modal...');
        
        const response = await fetch('/api/produccion/usuarios?rol=2&activo=true');
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        usuariosColaboradores = await response.json();
        console.log('✅ Usuarios colaboradores cargados:', usuariosColaboradores.length);
        
        poblarSelectUsuarios();
        
    } catch (error) {
        console.error('❌ Error al cargar usuarios colaboradores:', error);
    }
}

// ===== FUNCIONES DE RENDERIZADO =====

function renderizarColaboradores() {
    const container = document.getElementById('lista-colaboradores');
    
    if (!container) {
        console.error('❌ No se encontró el contenedor de colaboradores');
        return;
    }
    
    if (colaboradores.length === 0) {
        container.innerHTML = '<div class="mensaje-info">No hay colaboradores disponibles</div>';
        return;
    }
    
    const html = colaboradores.map(colaborador => `
        <div class="colaborador-card" onclick="abrirEspacioTrabajo(${colaborador.id}, '${colaborador.nombre_completo}')">
            <div class="colaborador-icon">👤</div>
            <h3 class="colaborador-nombre">${colaborador.nombre_completo}</h3>
        </div>
    `).join('');
    
    container.innerHTML = html;
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
    
    if (contadorImprimir) contadorImprimir.textContent = `(${totalImprimir})`;
    if (contadorArmar) contadorArmar.textContent = `(${totalArmar})`;
    if (contadorListo) contadorListo.textContent = `(${totalListo})`;
    
    console.log('🔢 [CONTADORES] Actualizados:', { totalImprimir, totalArmar, totalListo });
}

/**
 * Renderiza pedidos por cliente agrupados por secuencia
 * MODIFICADA para soportar agrupación por secuencia
 */
function renderizarPedidosPorCliente(clientes) {
    if (!clientes || clientes.length === 0) {
        // Si no hay datos, limpiar todos los contenedores
        const containers = ['pedidos-imprimir', 'pedidos-armar', 'pedidos-listo'];
        containers.forEach(id => {
            const container = document.getElementById(id);
            if (container) {
                container.innerHTML = '<div class="mensaje-info">No se encontraron pedidos para los criterios especificados</div>';
            }
        });
        
        // Resetear contadores
        actualizarContadoresSecuencia({ imprimir: [], armar_pedido: [], pedido_listo: [] });
        return;
    }
    
    // Agrupar por secuencia
    const grupos = agruparPresupuestosPorSecuencia(clientes);
    
    // Renderizar cada grupo en su contenedor
    renderizarGrupoSecuencia('pedidos-imprimir', grupos.imprimir, 'Imprimir / Imprimir Modificado');
    renderizarGrupoSecuencia('pedidos-armar', grupos.armar_pedido, 'Armar Pedido');
    renderizarGrupoSecuencia('pedidos-listo', grupos.pedido_listo, 'Pedido Listo');
    
    // Actualizar contadores en títulos
    actualizarContadoresSecuencia(grupos);
}

function mostrarErrorColaboradores() {
    const container = document.getElementById('lista-colaboradores');
    if (container) {
        container.innerHTML = '<div class="mensaje-error">Error al cargar colaboradores. Intente recargar la página.</div>';
    }
}

function poblarSelectUsuarios() {
    const select = document.getElementById('usuario-asignar');
    if (!select) return;
    
    select.innerHTML = '<option value="">Seleccione un usuario...</option>';
    
    usuariosColaboradores.forEach(usuario => {
        const option = document.createElement('option');
        option.value = usuario.id;
        option.textContent = usuario.nombre_completo;
        select.appendChild(option);
    });
}

// ===== FUNCIONES DE NAVEGACIÓN =====

function abrirEspacioTrabajo(usuarioId, nombreUsuario) {
    console.log(`🔗 Abriendo espacio de trabajo para: ${nombreUsuario} (ID: ${usuarioId})`);
    
    // Construir URL del espacio de trabajo personal
    const url = `http://localhost:3002/pages/produccion_personal.html?usuario=${usuarioId}&nombre=${encodeURIComponent(nombreUsuario)}`;
    
    // Abrir en nueva pestaña
    window.open(url, '_blank');
}

// ===== FUNCIONES DE EVENT LISTENERS =====

function configurarEventListeners() {
    // Botones de actualización
    const refreshPedidos = document.getElementById('refresh-pedidos');
    const refreshArticulos = document.getElementById('refresh-articulos');
    
    if (refreshPedidos) {
        refreshPedidos.addEventListener('click', cargarPedidosPorCliente);
    }
    
    if (refreshArticulos) {
        refreshArticulos.addEventListener('click', cargarArticulosPedidos);
    }
    
    // Campos de búsqueda
    const buscarCliente = document.getElementById('buscar-cliente');
    const buscarArticulo = document.getElementById('buscar-articulo');
    
    if (buscarCliente) {
        buscarCliente.addEventListener('input', debounce(cargarPedidosPorCliente, 500));
    }
    
    if (buscarArticulo) {
        buscarArticulo.addEventListener('input', debounce(cargarArticulosPedidos, 500));
    }
    
    // Campos de fecha
    const fechaCorte = document.getElementById('fecha-corte');
    const fechaCorteArticulos = document.getElementById('fecha-corte-articulos');
    
    if (fechaCorte) {
        fechaCorte.addEventListener('change', cargarPedidosPorCliente);
    }
    
    if (fechaCorteArticulos) {
        fechaCorteArticulos.addEventListener('change', cargarArticulosPedidos);
    }
    
    // Filtro de estado
    const filtroEstado = document.getElementById('filtro-estado-articulos');
    if (filtroEstado) {
        filtroEstado.addEventListener('change', cargarArticulosPedidos);
    }
    
    // Modal de asignación
    const confirmarAsignacion = document.getElementById('confirmar-asignacion');
    if (confirmarAsignacion) {
        confirmarAsignacion.addEventListener('click', confirmarAsignacionFaltantes);
    }
    
    // Modal de pack
    configurarEventListenersPack();
}

function configurarEventListenersPack() {
    const packGuardar = document.getElementById('pack-guardar');
    const packQuitar = document.getElementById('pack-quitar');
    
    if (packGuardar) {
        packGuardar.addEventListener('click', guardarPackMapping);
    }
    
    if (packQuitar) {
        packQuitar.addEventListener('click', quitarPackMapping);
    }
}

// ===== FUNCIONES DE PEDIDOS POR CLIENTE =====

async function cargarPedidosPorCliente() {
    try {
        console.log('📥 Cargando pedidos por cliente...');
        
        const fechaCorte = document.getElementById('fecha-corte')?.value || '';
        const busqueda = document.getElementById('buscar-cliente')?.value || '';
        
        let url = '/api/produccion/pedidos-por-cliente';
        const params = new URLSearchParams();
        
        if (fechaCorte) params.append('fecha', fechaCorte);
        if (busqueda) params.append('cliente_id', busqueda);
        
        if (params.toString()) {
            url += '?' + params.toString();
        }
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ Pedidos por cliente cargados:', data.total_clientes);
        
        clientesPedidos = data.data || [];
        renderizarPedidosPorCliente(clientesPedidos);
        
    } catch (error) {
        console.error('❌ Error al cargar pedidos por cliente:', error);
        mostrarErrorPedidos();
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
 * Renderiza un grupo de clientes en un contenedor específico
 */
function renderizarGrupoSecuencia(containerId, clientes, titulo) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`⚠️ Contenedor ${containerId} no encontrado`);
        return;
    }
    
    if (!clientes || clientes.length === 0) {
        container.innerHTML = '<div class="mensaje-info">No hay presupuestos en esta etapa</div>';
        return;
    }
    
    // Reutilizar la misma lógica de renderizado
    const html = clientes.map(cliente => {
        // DEBUG: Log para ver datos del cliente
        console.log(`🔍 DEBUG Cliente: ${cliente.cliente_nombre}`);
        console.log(`   - total_presupuestos: ${cliente.total_presupuestos}`);
        console.log(`   - total_articulos: ${cliente.total_articulos}`);
        console.log(`   - articulos.length: ${cliente.articulos.length}`);
        
        // Agrupar artículos por presupuesto_id
        const presupuestosMap = new Map();
        
        cliente.articulos.forEach(articulo => {
            const presupId = articulo.presupuesto_id;
            console.log(`   - Artículo ${articulo.articulo_numero}: presupuesto_id = ${presupId}`);
            if (!presupuestosMap.has(presupId)) {
                presupuestosMap.set(presupId, {
                    presupuesto_id: presupId,
                    presupuesto_fecha: articulo.presupuesto_fecha,
                    articulos: []
                });
            }
            presupuestosMap.get(presupId).articulos.push(articulo);
        });
        
        // Convertir Map a array y ordenar por fecha descendente
        const presupuestos = Array.from(presupuestosMap.values()).sort((a, b) => 
            new Date(b.presupuesto_fecha) - new Date(a.presupuesto_fecha)
        );
        
        console.log(`   - Presupuestos agrupados: ${presupuestos.length}`);
        presupuestos.forEach((p, i) => {
            console.log(`     ${i+1}. Presupuesto ${p.presupuesto_id}: ${p.articulos.length} artículos`);
        });
        
        return `
            <div class="cliente-acordeon">
                <div class="cliente-header" onclick="toggleCliente('cliente-${cliente.cliente_id}')">
                    <span class="indicador-estado indicador-${cliente.indicador_estado.toLowerCase()}">${cliente.indicador_estado}</span>
                    ${cliente.cliente_nombre} (${cliente.total_articulos} artículos, ${cliente.total_presupuestos} presupuestos)
                </div>
                <div id="cliente-${cliente.cliente_id}" class="cliente-contenido" style="padding: 10px;">
                    ${presupuestos.map((presupuesto, idx) => {
                        // Calcular estado del presupuesto
                        let faltantes = 0;
                        let parciales = 0;
                        let completos = 0;
                        
                        presupuesto.articulos.forEach(art => {
                            if (art.faltante === 0) {
                                completos++;
                            } else if (art.stock_disponible > 0) {
                                parciales++;
                            } else {
                                faltantes++;
                            }
                        });
                        
                        let estadoPresupuesto;
                        if (faltantes > 0) {
                            estadoPresupuesto = 'FALTANTES';
                        } else if (parciales > 0) {
                            estadoPresupuesto = 'PARCIAL';
                        } else {
                            estadoPresupuesto = 'COMPLETO';
                        }
                        
                        const fechaFormateada = new Date(presupuesto.presupuesto_fecha).toLocaleDateString('es-AR');
                        
                        return `
                            <div class="presupuesto-acordeon" style="margin-bottom: 15px; border: 1px solid #dee2e6; border-radius: 4px; overflow: hidden;">
                                <div class="presupuesto-header" onclick="togglePresupuesto('presupuesto-${cliente.cliente_id}-${idx}')" style="padding: 12px 15px; background-color: #f8f9fa; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: background-color 0.3s ease;">
                                    <div>
                                        <span class="indicador-estado indicador-${estadoPresupuesto.toLowerCase()}" style="margin-right: 10px;">${estadoPresupuesto}</span>
                                        <strong>Presupuesto ${presupuesto.presupuesto_id}</strong>
                                        <span style="color: #6c757d; margin-left: 10px;">📅 ${fechaFormateada}</span>
                                        <span style="color: #6c757d; margin-left: 10px;">(${presupuesto.articulos.length} artículos)</span>
                                    </div>
                                    <span class="toggle-icon" style="font-size: 1.2em; transition: transform 0.3s ease;">▼</span>
                                </div>
                                <div id="presupuesto-${cliente.cliente_id}-${idx}" class="presupuesto-contenido" style="display: none;">
                                    <table class="articulos-tabla">
                                        <thead>
                                            <tr>
                                                <th>Artículo</th>
                                                <th>Descripción</th>
                                                <th>Cantidad</th>
                                                <th>Stock Disponible</th>
                                                <th>Faltante</th>
                                                <th>Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${presupuesto.articulos.map(articulo => `
                                                <tr>
                                                    <td>${articulo.articulo_numero}</td>
                                                    <td>${articulo.descripcion}</td>
                                                    <td>${formatearNumero(articulo.pedido_total)}</td>
                                                    <td>${formatearNumero(articulo.stock_disponible)}</td>
                                                    <td class="${articulo.faltante > 0 ? 'cantidad-faltante' : 'cantidad-completa'}">${formatearNumero(articulo.faltante)}</td>
                                                    <td>
                                                        ${articulo.faltante > 0 ? `<button class="admin-button" onclick="abrirModalAsignar(${cliente.cliente_id}, '${cliente.cliente_nombre}', [${JSON.stringify(articulo).replace(/"/g, '"')}])">Asignar</button>` : ''}
                                                    </td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = html;
}

// Función para toggle de presupuestos
function togglePresupuesto(presupuestoId) {
    const contenido = document.getElementById(presupuestoId);
    const header = document.querySelector(`[onclick="togglePresupuesto('${presupuestoId}')"]`);
    const icon = header ? header.querySelector('.toggle-icon') : null;
    
    if (contenido) {
        if (contenido.style.display === 'none' || contenido.style.display === '') {
            contenido.style.display = 'block';
            if (icon) icon.style.transform = 'rotate(180deg)';
            if (header) header.style.backgroundColor = '#e9ecef';
        } else {
            contenido.style.display = 'none';
            if (icon) icon.style.transform = 'rotate(0deg)';
            if (header) header.style.backgroundColor = '#f8f9fa';
        }
    }
}

function mostrarErrorPedidos() {
    // Mostrar error en todos los contenedores de pedidos
    const containers = ['pedidos-imprimir', 'pedidos-armar', 'pedidos-listo'];
    containers.forEach(id => {
        const container = document.getElementById(id);
        if (container) {
            container.innerHTML = '<div class="mensaje-error">Error al cargar pedidos. Intente actualizar.</div>';
        }
    });
    
    // Resetear contadores
    actualizarContadoresSecuencia({ imprimir: [], armar_pedido: [], pedido_listo: [] });
}

function toggleCliente(clienteId) {
    const contenido = document.getElementById(clienteId);
    if (contenido) {
        contenido.style.display = contenido.style.display === 'none' ? 'block' : 'none';
    }
}

// ===== FUNCIONES DE ARTÍCULOS PEDIDOS =====

async function cargarArticulosPedidos() {
    try {
        console.log('📥 Cargando artículos de pedidos...');
        
        const fechaCorte = document.getElementById('fecha-corte-articulos')?.value || '';
        const busqueda = document.getElementById('buscar-articulo')?.value || '';
        const filtroEstado = document.getElementById('filtro-estado-articulos')?.value || 'todos';
        
        let url = '/api/produccion/pedidos-articulos';
        const params = new URLSearchParams();
        
        if (fechaCorte) params.append('fecha', fechaCorte);
        if (busqueda) params.append('q', busqueda);
        if (filtroEstado && filtroEstado !== 'todos') params.append('estado_filtro', filtroEstado);
        
        if (params.toString()) {
            url += '?' + params.toString();
        }
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ Artículos de pedidos cargados:', data.total_articulos);
        
        articulosPedidos = data.data || [];
        renderizarArticulosPedidos(articulosPedidos, data.totales);
        
        // Actualizar resumen si existe la función
        if (typeof window.actualizarResumenFaltantes === 'function') {
            setTimeout(window.actualizarResumenFaltantes, 500);
        }
        
    } catch (error) {
        console.error('❌ Error al cargar artículos de pedidos:', error);
        mostrarErrorArticulos();
    }
}

function renderizarArticulosPedidos(articulos, totales) {
    const container = document.getElementById('articulos-container');
    const totalesContainer = document.getElementById('totales-articulos');
    
    if (!container) return;
    
    // Renderizar totales
    if (totalesContainer && totales) {
        totalesContainer.innerHTML = `
            <span style="color: #dc3545;">Faltantes: ${totales.faltantes}</span> | 
            <span style="color: #856404;">Parciales: ${totales.parciales}</span> | 
            <span style="color: #155724;">Completos: ${totales.completos}</span> | 
            <strong>Total: ${totales.faltantes + totales.parciales + totales.completos}</strong>
        `;
    }
    
    if (!articulos || articulos.length === 0) {
        container.innerHTML = '<div class="mensaje-info">No se encontraron artículos para los criterios especificados</div>';
        return;
    }
    
    const html = `
        <table class="articulos-tabla">
            <thead>
                <tr>
                    <th>Artículo</th>
                    <th>Descripción</th>
                    <th>Pedido Total</th>
                    <th>Stock Disponible</th>
                    <th>Faltante</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${articulos.map(articulo => `
                    <tr class="expandible-row" data-articulo="${articulo.articulo_numero}" onclick="handleFilaClick('${articulo.articulo_numero}', event)">
                        <td>${articulo.articulo_numero}</td>
                        <td>${articulo.descripcion}</td>
                        <td>${formatearNumero(articulo.pedido_total)}</td>
                        <td>${formatearNumero(articulo.stock_disponible)}</td>
                        <td class="${articulo.faltante > 0 ? 'cantidad-faltante' : 'cantidad-completa'}">${formatearNumero(articulo.faltante)}</td>
                        <td><span class="indicador-estado indicador-${articulo.estado.toLowerCase()}">${articulo.estado}</span></td>
                        <td onclick="event.stopPropagation()">
                            <button class="pack-button pack-config-btn" data-codigo="${articulo.articulo_numero}" onclick="abrirModalPack('${articulo.articulo_numero}')">🧩 Pack</button>
                            ${articulo.faltante > 0 ? `<button class="admin-button" onclick="abrirModalAsignarArticulo('${articulo.articulo_numero}', '${articulo.descripcion}', ${articulo.faltante})" style="margin-left: 5px; font-size: 10px; padding: 2px 6px;">Asignar</button>` : ''}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
    
    // Después de renderizar, actualizar los iconos de expansión
    if (typeof window.actualizarIconosExpansion === 'function') {
        setTimeout(() => {
            console.log('🔄 Llamando a actualizarIconosExpansion desde renderizarArticulosPedidos');
            window.actualizarIconosExpansion();
        }, 100);
    }
}

function mostrarErrorArticulos() {
    const container = document.getElementById('articulos-container');
    if (container) {
        container.innerHTML = '<div class="mensaje-error">Error al cargar artículos. Intente actualizar.</div>';
    }
}

// ===== FUNCIONES DE MODAL DE ASIGNACIÓN =====

function abrirModalAsignar(clienteId, clienteNombre, articulos) {
    const modal = document.getElementById('modal-asignar-faltantes');
    const lista = document.getElementById('articulos-faltantes-lista');
    const mensaje = document.getElementById('modal-mensaje');
    
    if (!modal || !lista) return;
    
    // Limpiar mensaje
    mensaje.innerHTML = '';
    mensaje.className = 'mensaje-info';
    
    // Renderizar lista de artículos faltantes
    const articulosArray = Array.isArray(articulos) ? articulos : [articulos];
    const html = articulosArray.map(art => `
        <div style="padding: 10px; border: 1px solid #dee2e6; margin: 5px 0; border-radius: 4px;">
            <strong>${art.articulo_numero}</strong> - ${art.descripcion}<br>
            <small>Faltante: ${art.faltante} unidades</small>
        </div>
    `).join('');
    
    lista.innerHTML = html;
    
    // Guardar datos para la asignación
    modal.dataset.clienteId = clienteId;
    modal.dataset.clienteNombre = clienteNombre;
    modal.dataset.articulos = JSON.stringify(articulosArray);
    
    // Mostrar modal
    modal.style.display = 'flex';
}

function abrirModalAsignarArticulo(articuloNumero, descripcion, faltante) {
    const articulo = {
        articulo_numero: articuloNumero,
        descripcion: descripcion,
        faltante: faltante
    };
    
    abrirModalAsignar(null, 'Artículo Individual', [articulo]);
}

function cerrarModalAsignar() {
    const modal = document.getElementById('modal-asignar-faltantes');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function confirmarAsignacionFaltantes() {
    const modal = document.getElementById('modal-asignar-faltantes');
    const usuarioSelect = document.getElementById('usuario-asignar');
    const mensaje = document.getElementById('modal-mensaje');
    
    if (!modal || !usuarioSelect || !mensaje) return;
    
    const usuarioId = usuarioSelect.value;
    if (!usuarioId) {
        mostrarMensajeModal('Por favor seleccione un usuario', 'error');
        return;
    }
    
    try {
        const clienteId = modal.dataset.clienteId || 1; // Default para artículos individuales
        const articulos = JSON.parse(modal.dataset.articulos || '[]');
        
        // Preparar datos para la API
        const articulosFaltantes = articulos.map(art => ({
            articulo_numero: art.articulo_numero,
            descripcion: art.descripcion,
            cantidad_faltante: art.faltante
        }));
        
        const payload = {
            usuario_id: parseInt(usuarioId),
            cliente_id: parseInt(clienteId),
            articulos_faltantes: articulosFaltantes,
            observaciones: 'Asignación desde panel de producción'
        };
        
        console.log('📤 Enviando asignación:', payload);
        
        const response = await fetch('/api/produccion/asignar-faltantes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            mostrarMensajeModal(`✅ ${data.message}`, 'success');
            setTimeout(() => {
                cerrarModalAsignar();
                // Recargar datos si es necesario
                cargarArticulosPedidos();
            }, 2000);
        } else {
            mostrarMensajeModal(`❌ ${data.error || 'Error al asignar faltantes'}`, 'error');
        }
        
    } catch (error) {
        console.error('❌ Error al confirmar asignación:', error);
        mostrarMensajeModal('❌ Error de conexión', 'error');
    }
}

function mostrarMensajeModal(texto, tipo) {
    const mensaje = document.getElementById('modal-mensaje');
    if (!mensaje) return;
    
    mensaje.textContent = texto;
    mensaje.className = tipo === 'error' ? 'mensaje-error' : 
                       tipo === 'success' ? 'mensaje-exito' : 'mensaje-info';
}

// ===== FUNCIONES DE MODAL DE PACK =====

function abrirModalPack__legacy(codigoPadre) {
    const modal = document.getElementById('modal-pack');
    const padreCodigo = document.getElementById('pack-padre-codigo');
    const hijoCodigo = document.getElementById('pack-hijo-codigo');
    const unidades = document.getElementById('pack-unidades');
    const mensaje = document.getElementById('pack-mensaje');
    const quitarBtn = document.getElementById('pack-quitar');
    
    if (!modal || !padreCodigo) return;
    
    // Limpiar formulario
    padreCodigo.value = codigoPadre;
    hijoCodigo.value = '';
    unidades.value = '';
    mensaje.style.display = 'none';
    mensaje.innerHTML = '';
    quitarBtn.style.display = 'none';
    
    // Cargar datos existentes si los hay
    cargarDatosPackExistente(codigoPadre);
    
    // Mostrar modal
    modal.style.display = 'flex';
}

async function cargarDatosPackExistente(codigoPadre) {
    try {
        // Buscar en la tabla actual si hay información de pack
        const tabla = document.querySelector('#articulos-container .articulos-tabla tbody');
        if (tabla) {
            const filas = tabla.querySelectorAll('tr');
            for (const fila of filas) {
                const celdas = fila.querySelectorAll('td');
                if (celdas.length > 0 && celdas[0].textContent.trim() === codigoPadre) {
                    // Aquí podrías verificar si ya tiene configuración de pack
                    // Por ahora, simplemente mostramos el botón quitar si existe alguna configuración
                    const quitarBtn = document.getElementById('pack-quitar');
                    if (quitarBtn) {
                        quitarBtn.style.display = 'inline-block';
                    }
                    break;
                }
            }
        }
    } catch (error) {
        console.error('❌ Error al cargar datos de pack existente:', error);
    }
}

function cerrarModalPack() {
    const modal = document.getElementById('modal-pack');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function guardarPackMapping() {
    const padreCodigo = document.getElementById('pack-padre-codigo');
    const hijoCodigo = document.getElementById('pack-hijo-codigo');
    const unidades = document.getElementById('pack-unidades');
    const mensaje = document.getElementById('pack-mensaje');
    
    if (!padreCodigo || !hijoCodigo || !unidades || !mensaje) return;
    
    // Validaciones
    if (!hijoCodigo.value.trim()) {
        mostrarMensajePack('Por favor ingrese el código del artículo hijo', 'error');
        return;
    }
    
    if (!unidades.value || parseInt(unidades.value) <= 0) {
        mostrarMensajePack('Por favor ingrese una cantidad válida de unidades', 'error');
        return;
    }
    
    try {
        const payload = {
            padre_codigo_barras: padreCodigo.value.trim(),
            hijo_codigo_barras: hijoCodigo.value.trim(),
            unidades: parseInt(unidades.value)
        };
        
        console.log('📤 Guardando mapeo pack:', payload);
        
        const response = await fetch('/api/produccion/pack-map', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            mostrarMensajePack('✅ Mapeo pack guardado correctamente', 'success');
            mostrarToast('Mapeo pack guardado correctamente', 'success');
            
            // Mostrar botón quitar
            const quitarBtn = document.getElementById('pack-quitar');
            if (quitarBtn) {
                quitarBtn.style.display = 'inline-block';
            }
            
            setTimeout(() => {
                cerrarModalPack();
                // Recargar ambas vistas: panel principal y resumen
                refrescarVistasPack();
            }, 2000);
        } else {
            mostrarMensajePack(`❌ ${data.error || 'Error al guardar mapeo pack'}`, 'error');
        }
        
    } catch (error) {
        console.error('❌ Error al guardar mapeo pack:', error);
        mostrarMensajePack('❌ Error de conexión', 'error');
    }
}

async function quitarPackMapping() {
    const padreCodigo = document.getElementById('pack-padre-codigo');
    const mensaje = document.getElementById('pack-mensaje');
    
    if (!padreCodigo || !mensaje) return;
    
    if (!confirm('¿Está seguro de que desea quitar el mapeo de pack para este artículo?')) {
        return;
    }
    
    try {
        const payload = {
            padre_codigo_barras: padreCodigo.value.trim(),
            hijo_codigo_barras: null,
            unidades: null
        };
        
        console.log('📤 Quitando mapeo pack:', payload);
        
        const response = await fetch('/api/produccion/pack-map', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            mostrarMensajePack('✅ Mapeo pack eliminado correctamente', 'success');
            mostrarToast('Mapeo pack eliminado correctamente', 'success');
            
            // Ocultar botón quitar y limpiar campos
            const quitarBtn = document.getElementById('pack-quitar');
            const hijoCodigo = document.getElementById('pack-hijo-codigo');
            const unidades = document.getElementById('pack-unidades');
            
            if (quitarBtn) quitarBtn.style.display = 'none';
            if (hijoCodigo) hijoCodigo.value = '';
            if (unidades) unidades.value = '';
            
            setTimeout(() => {
                cerrarModalPack();
                // Recargar ambas vistas: panel principal y resumen
                refrescarVistasPack();
            }, 2000);
        } else {
            mostrarMensajePack(`❌ ${data.error || 'Error al quitar mapeo pack'}`, 'error');
        }
        
    } catch (error) {
        console.error('❌ Error al quitar mapeo pack:', error);
        mostrarMensajePack('❌ Error de conexión', 'error');
    }
}

function mostrarMensajePack(texto, tipo) {
    const mensaje = document.getElementById('pack-mensaje');
    if (!mensaje) return;
    
    mensaje.innerHTML = texto;
    mensaje.className = tipo === 'error' ? 'mensaje-error' : 
                       tipo === 'success' ? 'mensaje-exito' : 'mensaje-info';
    mensaje.style.display = 'block';
}

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

// ===== FUNCIONES UTILITARIAS =====

/**
 * Formatea un número a máximo 2 decimales
 * Ejemplos: 0.999999 → 1.00, 0.3333333 → 0.33, 1.000000 → 1.00
 */
function formatearNumero(valor) {
    if (valor === null || valor === undefined || valor === '') return '0.00';
    const numero = Number(valor);
    if (isNaN(numero)) return '0.00';
    return numero.toFixed(2);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Función para refrescar ambas vistas después de operaciones de pack
function refrescarVistasPack() {
    console.log('🔄 Refrescando vistas después de operación pack...');
    
    // Recargar el panel principal de artículos
    cargarArticulosPedidos();
    
    // Actualizar el resumen de faltantes y parciales si existe la función
    if (typeof window.actualizarResumenFaltantes === 'function') {
        setTimeout(window.actualizarResumenFaltantes, 800);
    }
}

// ===== FUNCIONES GLOBALES PARA EVENTOS DE CLICK =====

// Hacer funciones disponibles globalmente para onclick
window.abrirEspacioTrabajo = abrirEspacioTrabajo;
window.toggleCliente = toggleCliente;
window.togglePresupuesto = togglePresupuesto;
window.abrirModalAsignar = abrirModalAsignar;
window.abrirModalAsignarArticulo = abrirModalAsignarArticulo;
window.cerrarModalAsignar = cerrarModalAsignar;
// window.abrirModalPack = abrirModalPack; // deshabilitado: fuente �nica en produccion.html
window.cerrarModalPack = cerrarModalPack;

console.log('✅ Archivo produccion.js cargado completamente');
