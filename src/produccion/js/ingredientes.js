import { esMix } from './mix.js';

// Variables globales
let ingredienteEditando = null;
let ingredientesOriginales = []; // Para mantener la lista completa
let filtrosActivos = new Set(); // Para rastrear filtros activos por categoría
let filtrosTipoActivos = new Set(); // Para rastrear filtros activos por tipo (Simple/Mix)
let filtrosStockActivos = new Set(); // Para rastrear filtros activos por stock (Con Stock/Sin Stock)
let vistaActual = 'deposito'; // Para identificar la vista actual ('deposito' o 'usuario-X')



// Funciones para gestionar el modal
async function abrirModal(titulo = 'Nuevo Ingrediente') {
    const modal = document.getElementById('modal-ingrediente');
    const modalTitulo = document.getElementById('modal-titulo');
    modalTitulo.textContent = titulo;
    modal.style.display = 'block';

    // Si es un nuevo ingrediente, obtener el código automáticamente
    if (titulo === 'Nuevo Ingrediente') {
        try {
            const response = await fetch('http://localhost:3002/api/produccion/ingredientes/nuevo-codigo');
            if (response.ok) {
                const data = await response.json();
                document.getElementById('codigo').value = data.codigo;
            }
        } catch (error) {
            console.error('Error al obtener nuevo código:', error);
            // No mostrar error al usuario, el código se generará al guardar
        }
    }
}

function cerrarModal() {
    const modal = document.getElementById('modal-ingrediente');
    modal.style.display = 'none';
    document.getElementById('form-ingrediente').reset();
    ingredienteEditando = null;
}

// Función para mostrar mensajes
function mostrarMensaje(mensaje, tipo = 'error') {
    const contenedor = document.querySelector('.content-section');
    const mensajeDiv = document.createElement('div');
    mensajeDiv.className = tipo === 'error' ? 'mensaje-error' : 'mensaje-exito';
    mensajeDiv.textContent = mensaje;
    
    // Remover mensaje anterior si existe
    const mensajeAnterior = document.querySelector('.mensaje-error, .mensaje-exito');
    if (mensajeAnterior) {
        mensajeAnterior.remove();
    }
    
    contenedor.insertBefore(mensajeDiv, contenedor.firstChild);
    
    // Remover el mensaje después de 3 segundos
    setTimeout(() => {
        mensajeDiv.remove();
    }, 3000);
}

// Función para inicializar los filtros de categorías, tipo y stock
function inicializarFiltros(ingredientes) {
    const filtrosContainer = document.getElementById('filtros-categorias');
    if (!filtrosContainer) return;

    console.log('🔧 Inicializando filtros con nuevo comportamiento: filtros desactivados por defecto');

    // ✅ Evitar duplicados: limpiar el contenedor antes de agregar elementos
    filtrosContainer.innerHTML = '';

    // Crear contenedor para botones globales
    const botonesGlobales = document.createElement('div');
    botonesGlobales.className = 'botones-globales';

    // Botón "Mostrar Todos"
    const btnTodos = document.createElement('button');
    btnTodos.textContent = 'Mostrar Todos';
    btnTodos.className = 'btn-filtro';
    botonesGlobales.appendChild(btnTodos);

    // Botón "Ocultar Todos"
    const btnOcultar = document.createElement('button');
    btnOcultar.textContent = 'Ocultar Todos';
    btnOcultar.className = 'btn-filtro';
    botonesGlobales.appendChild(btnOcultar);

    // Insertar botones globales
    filtrosContainer.appendChild(botonesGlobales);

    // ===== FILTROS POR CATEGORÍA =====
    const categoriasTitulo = document.createElement('h4');
    categoriasTitulo.textContent = 'Filtrar por Categoría:';
    categoriasTitulo.style.cssText = 'margin: 15px 0 5px 0; font-size: 14px; color: #495057;';
    filtrosContainer.appendChild(categoriasTitulo);

    // Contenedor para botones de categoría
    const categoriasBotones = document.createElement('div');
    categoriasBotones.className = 'categorias-botones';
    filtrosContainer.appendChild(categoriasBotones);

    // Obtener categorías únicas y ordenadas
    const categorias = [...new Set(ingredientes.map(ing => ing.categoria))]
        .filter(Boolean)
        .sort();

    // Crear botones de categoría - INICIALMENTE DESACTIVADOS
    const botonesCategorias = categorias.map(cat => {
        const btn = document.createElement('button');
        btn.textContent = cat;
        btn.className = 'btn-filtro'; // Sin 'activo' - inician desactivados
        categoriasBotones.appendChild(btn);
        return btn;
    });

    // ===== FILTROS POR TIPO DE INGREDIENTE =====
    const tipoTitulo = document.createElement('h4');
    tipoTitulo.textContent = 'Filtrar por Tipo:';
    tipoTitulo.style.cssText = 'margin: 15px 0 5px 0; font-size: 14px; color: #495057;';
    filtrosContainer.appendChild(tipoTitulo);

    const tiposBotones = document.createElement('div');
    tiposBotones.className = 'tipos-botones';
    tiposBotones.style.cssText = 'display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px;';
    filtrosContainer.appendChild(tiposBotones);

    // Crear botones de tipo
    const btnTipoSimple = document.createElement('button');
    btnTipoSimple.textContent = 'Ingrediente Simple';
    btnTipoSimple.className = 'btn-filtro';
    btnTipoSimple.dataset.tipo = 'simple';
    tiposBotones.appendChild(btnTipoSimple);

    const btnTipoMix = document.createElement('button');
    btnTipoMix.textContent = 'Ingrediente Mix';
    btnTipoMix.className = 'btn-filtro';
    btnTipoMix.dataset.tipo = 'mix';
    tiposBotones.appendChild(btnTipoMix);

    const botonesTipo = [btnTipoSimple, btnTipoMix];

    // ===== FILTROS POR STOCK =====
    const stockTitulo = document.createElement('h4');
    stockTitulo.textContent = 'Filtrar por Stock:';
    stockTitulo.style.cssText = 'margin: 15px 0 5px 0; font-size: 14px; color: #495057;';
    filtrosContainer.appendChild(stockTitulo);

    const stockBotones = document.createElement('div');
    stockBotones.className = 'stock-botones';
    stockBotones.style.cssText = 'display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px;';
    filtrosContainer.appendChild(stockBotones);

    // Crear botones de stock
    const btnConStock = document.createElement('button');
    btnConStock.textContent = 'Con Stock';
    btnConStock.className = 'btn-filtro';
    btnConStock.dataset.stock = 'con-stock';
    stockBotones.appendChild(btnConStock);

    const btnSinStock = document.createElement('button');
    btnSinStock.textContent = 'Sin Stock';
    btnSinStock.className = 'btn-filtro';
    btnSinStock.dataset.stock = 'sin-stock';
    stockBotones.appendChild(btnSinStock);

    const botonesStock = [btnConStock, btnSinStock];

    // ✅ INICIALIZAR TODOS LOS FILTROS VACÍOS
    filtrosActivos = new Set();
    filtrosTipoActivos = new Set();
    filtrosStockActivos = new Set();
    console.log('✅ Todos los filtros inicializados vacíos - tabla se mostrará sin ingredientes');

    // ===== EVENTOS PARA BOTONES GLOBALES =====
    btnTodos.onclick = async () => {
        console.log('🔄 Activando todos los filtros');
        // Activar todas las categorías
        filtrosActivos = new Set(categorias);
        botonesCategorias.forEach(btn => btn.classList.add('activo'));
        
        // Activar todos los tipos
        filtrosTipoActivos = new Set(['simple', 'mix']);
        botonesTipo.forEach(btn => btn.classList.add('activo'));
        
        // Activar todos los stocks
        filtrosStockActivos = new Set(['con-stock', 'sin-stock']);
        botonesStock.forEach(btn => btn.classList.add('activo'));
        
        await actualizarTablaFiltrada();
    };

    btnOcultar.onclick = async () => {
        console.log('🔄 Desactivando todos los filtros');
        // Limpiar todos los filtros
        filtrosActivos.clear();
        filtrosTipoActivos.clear();
        filtrosStockActivos.clear();
        
        // Remover clases activas
        botonesCategorias.forEach(btn => btn.classList.remove('activo'));
        botonesTipo.forEach(btn => btn.classList.remove('activo'));
        botonesStock.forEach(btn => btn.classList.remove('activo'));
        
        await actualizarTablaFiltrada();
    };

    // ===== EVENTOS PARA FILTROS POR CATEGORÍA =====
    botonesCategorias.forEach(btn => {
        btn.onclick = async () => {
            if (btn.classList.contains('activo')) {
                console.log(`🔄 Desactivando filtro categoría: ${btn.textContent}`);
                btn.classList.remove('activo');
                filtrosActivos.delete(btn.textContent);
            } else {
                console.log(`🔄 Activando filtro categoría: ${btn.textContent}`);
                btn.classList.add('activo');
                filtrosActivos.add(btn.textContent);
            }
            await actualizarTablaFiltrada();
        };
    });

    // ===== EVENTOS PARA FILTROS POR TIPO =====
    botonesTipo.forEach(btn => {
        btn.onclick = async () => {
            const tipo = btn.dataset.tipo;
            if (btn.classList.contains('activo')) {
                console.log(`🔄 Desactivando filtro tipo: ${btn.textContent}`);
                btn.classList.remove('activo');
                filtrosTipoActivos.delete(tipo);
            } else {
                console.log(`🔄 Activando filtro tipo: ${btn.textContent}`);
                btn.classList.add('activo');
                filtrosTipoActivos.add(tipo);
            }
            await actualizarTablaFiltrada();
        };
    });

    // ===== EVENTOS PARA FILTROS POR STOCK =====
    botonesStock.forEach(btn => {
        btn.onclick = async () => {
            const stock = btn.dataset.stock;
            if (btn.classList.contains('activo')) {
                console.log(`🔄 Desactivando filtro stock: ${btn.textContent}`);
                btn.classList.remove('activo');
                filtrosStockActivos.delete(stock);
            } else {
                console.log(`🔄 Activando filtro stock: ${btn.textContent}`);
                btn.classList.add('activo');
                filtrosStockActivos.add(stock);
            }
            await actualizarTablaFiltrada();
        };
    });
}

// Función para actualizar la tabla según los filtros activos combinados
async function actualizarTablaFiltrada() {
    // Solo aplicar filtros en la vista de depósito
    if (vistaActual === 'deposito') {
        // ✅ Si NO hay ningún filtro activo en ninguna categoría, mostrar tabla vacía
        if (filtrosActivos.size === 0 && filtrosTipoActivos.size === 0 && filtrosStockActivos.size === 0) {
            console.log('🔄 No hay filtros activos en ninguna categoría - mostrando tabla vacía');
            await actualizarTablaIngredientes([]);
            return;
        }

        // Aplicar filtros combinados (AND lógico entre tipos de filtros, OR dentro de cada tipo)
        const ingredientesFiltrados = ingredientesOriginales.filter(ing => {
            // Filtro por categoría (si hay filtros de categoría activos)
            const pasaCategoria = filtrosActivos.size === 0 || filtrosActivos.has(ing.categoria);
            
            // Filtro por tipo (si hay filtros de tipo activos)
            let pasaTipo = filtrosTipoActivos.size === 0;
            if (filtrosTipoActivos.size > 0) {
                const esMixIngrediente = ing.esMix;
                if (filtrosTipoActivos.has('simple') && !esMixIngrediente) {
                    pasaTipo = true;
                }
                if (filtrosTipoActivos.has('mix') && esMixIngrediente) {
                    pasaTipo = true;
                }
            }
            
            // Filtro por stock (si hay filtros de stock activos)
            let pasaStock = filtrosStockActivos.size === 0;
            if (filtrosStockActivos.size > 0) {
                const stockActual = parseFloat(ing.stock_actual) || 0;
                const tolerancia = 0.001;
                
                if (filtrosStockActivos.has('con-stock') && stockActual > tolerancia) {
                    pasaStock = true;
                }
                if (filtrosStockActivos.has('sin-stock') && stockActual <= tolerancia) {
                    pasaStock = true;
                }
            }
            
            // El ingrediente pasa si cumple TODOS los tipos de filtros activos
            return pasaCategoria && pasaTipo && pasaStock;
        });

        // Log detallado de filtros activos
        const filtrosInfo = [];
        if (filtrosActivos.size > 0) {
            filtrosInfo.push(`Categorías: ${Array.from(filtrosActivos).join(', ')}`);
        }
        if (filtrosTipoActivos.size > 0) {
            filtrosInfo.push(`Tipos: ${Array.from(filtrosTipoActivos).join(', ')}`);
        }
        if (filtrosStockActivos.size > 0) {
            filtrosInfo.push(`Stock: ${Array.from(filtrosStockActivos).join(', ')}`);
        }
        
        console.log(`🔄 Filtros combinados activos: ${filtrosInfo.join(' | ')} - mostrando ${ingredientesFiltrados.length} ingredientes`);
        await actualizarTablaIngredientes(ingredientesFiltrados);
    }
}

// Función para cargar los ingredientes según la vista actual
async function cargarIngredientes(usuarioId = null) {
    try {
        let response;
        console.log(`🔄 Cargando ${usuarioId ? 'stock de usuario' : 'ingredientes del depósito'}...`);
        
        if (usuarioId) {
            vistaActual = `usuario-${usuarioId}`;
            response = await fetch(`http://localhost:3002/api/produccion/ingredientes/stock-usuario/${usuarioId}`);
        } else {
            vistaActual = 'deposito';
            response = await fetch('http://localhost:3002/api/produccion/ingredientes');
        }
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener los datos');
        }

        const datos = await response.json();
        console.log('✅ Datos recibidos:', datos);
        
        if (vistaActual === 'deposito') {
            // Guardar lista completa y actualizar mix.js
            ingredientesOriginales = datos;
            window.actualizarListaIngredientes(datos);
            
            // Inicializar filtros
            inicializarFiltros(datos);
            
            // Verificar estado de mix para todos los ingredientes
            const ingredientesConEstado = await Promise.all(datos.map(async (ingrediente) => {
                const tieneMix = await window.esMix(ingrediente.id);
                return { ...ingrediente, esMix: tieneMix };
            }));
            
            ingredientesOriginales = ingredientesConEstado;
            await actualizarTablaFiltrada();
        } else {
            // Vista de usuario: mostrar directamente sin filtros
            await actualizarTablaIngredientes(datos, true);
        }

    } catch (error) {
        console.error('❌ Error:', error);
        mostrarMensaje(error.message || 'No se pudieron cargar los datos');
    }
}

// Función para actualizar la tabla con los ingredientes
async function actualizarTablaIngredientes(ingredientes, esVistaUsuario = false) {
    const tbody = document.getElementById('tabla-ingredientes-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!ingredientes || ingredientes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No hay ingredientes disponibles</td></tr>';
        return;
    }

    ingredientes.forEach(ingrediente => {
        const tr = document.createElement('tr');
        tr.dataset.id = ingrediente.id;
        
        if (esVistaUsuario) {
            // Vista de usuario: mostrar stock personal
            tr.innerHTML = `
                <td>${ingrediente.nombre_ingrediente}</td>
                <td>${ingrediente.unidad_medida || '-'}</td>
                <td>${ingrediente.categoria || '-'}</td>
                <td>${parseFloat(ingrediente.stock_total).toFixed(3)}</td>
                <td>${ingrediente.descripcion || '-'}</td>
                <td>${ingrediente.tipo_origen || 'Simple'}</td>
                <td>-</td>
                <td><span style="color: #6c757d; font-style: italic;">Solo lectura</span></td>
            `;
        } else {
            // Vista de depósito: funcionalidad completa
            tr.innerHTML = `
                <td>${ingrediente.nombre}</td>
                <td>${ingrediente.unidad_medida}</td>
                <td>${ingrediente.categoria}</td>
                <td>${ingrediente.stock_actual}</td>
                <td>${ingrediente.descripcion || '-'}</td>
                <td class="tipo-col">${ingrediente.esMix ? 'Ingrediente Mix' : 'Ingrediente Simple'}</td>
                <td>
                    ${ingrediente.esMix 
                        ? `<div class="btn-group">
                            <button class="btn-editar" onclick="gestionarComposicionMix(${ingrediente.id})">Gestionar composición</button>
                            <button class="btn-eliminar" onclick="eliminarComposicionMix(${ingrediente.id})">Eliminar composición</button>
                           </div>` 
                        : (!ingrediente.padre_id 
                            ? `<button class="btn-editar" onclick="gestionarComposicionMix(${ingrediente.id})">Crear composición</button>`
                            : '-')}
                </td>
                <td>
                    <button class="btn-editar" onclick="editarIngrediente(${ingrediente.id})">Editar</button>
                    <button class="btn-eliminar" onclick="eliminarIngrediente(${ingrediente.id})">Eliminar</button>
                </td>
            `;
        }
        
        tbody.appendChild(tr);
    });
}

// Función para crear un nuevo ingrediente
async function crearIngrediente(datos) {
    try {
        console.log('Creando ingrediente:', datos);
        const response = await fetch('http://localhost:3002/api/produccion/ingredientes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datos)
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (errorData.error === 'El ingrediente ya existe') {
                mostrarMensaje('El ingrediente ya existe', 'error');
                return;
            }
            throw new Error(errorData.error || 'Error al crear el ingrediente');
        }

        const nuevoIngrediente = await response.json();
        await cargarIngredientes();
        mostrarMensaje('Ingrediente creado exitosamente', 'exito');
        
        // Mostrar botón de impresión después de crear
        document.getElementById('codigo').value = nuevoIngrediente.codigo;
        actualizarBotonImpresion();
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo crear el ingrediente');
    }
}

// Función para actualizar un ingrediente
async function actualizarIngrediente(id, datos) {
    try {
        console.log('Actualizando ingrediente:', id, datos);
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datos)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al actualizar el ingrediente');
        }

        await cargarIngredientes();
        mostrarMensaje('Ingrediente actualizado exitosamente', 'exito');
        cerrarModal();
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo actualizar el ingrediente');
    }
}

// Función para eliminar un ingrediente
async function eliminarIngrediente(id) {
    if (!confirm('¿Estás seguro de que quieres eliminar este ingrediente?')) {
        return;
    }

    try {
        console.log('Eliminando ingrediente:', id);
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al eliminar el ingrediente');
        }

        await cargarIngredientes();
        mostrarMensaje('Ingrediente eliminado exitosamente', 'exito');
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo eliminar el ingrediente');
    }
}

// Función para editar un ingrediente
async function editarIngrediente(id) {
    try {
        console.log('Obteniendo ingrediente para editar:', id);
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${id}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener el ingrediente');
        }

        const ingrediente = await response.json();
        ingredienteEditando = ingrediente;

        // Llenar el formulario con los datos del ingrediente
        document.getElementById('ingrediente-id').value = ingrediente.id;
        document.getElementById('codigo').value = ingrediente.codigo || '';
        document.getElementById('nombre').value = ingrediente.nombre;
        document.getElementById('unidad-medida').value = ingrediente.unidad_medida;
        document.getElementById('categoria').value = ingrediente.categoria;
        document.getElementById('stock').value = ingrediente.stock_actual;
        document.getElementById('descripcion').value = ingrediente.descripcion || '';

        abrirModal('Editar Ingrediente');
        actualizarBotonImpresion();
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo cargar el ingrediente para editar');
    }
}

// Función para imprimir etiqueta
async function imprimirEtiqueta(ingrediente) {
    try {
        // Llamar a App Etiquetas en puerto 3000
        const response = await fetch('http://localhost:3000/api/etiquetas/ingrediente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nombre: ingrediente.nombre,
                codigo: ingrediente.codigo
            })
        });

        if (!response.ok) {
            throw new Error('Error al imprimir etiqueta');
        }

        mostrarMensaje('Etiqueta enviada a imprimir', 'exito');
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo imprimir la etiqueta');
    }
}

// Función para actualizar visibilidad del botón de impresión
function actualizarBotonImpresion() {
    const btnImprimir = document.getElementById('btn-imprimir');
    const codigo = document.getElementById('codigo').value;
    
    if (btnImprimir) {
        btnImprimir.style.display = codigo ? 'block' : 'none';
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('Página cargada, inicializando...');

    // Configurar botón de impresión
    const btnImprimir = document.getElementById('btn-imprimir');
    if (btnImprimir) {
        btnImprimir.addEventListener('click', () => {
            const codigo = document.getElementById('codigo').value;
            const nombre = document.getElementById('nombre').value;
            
            if (codigo && nombre) {
                imprimirEtiqueta({ codigo, nombre });
            }
        });
    }
    
    // Cargar ingredientes al iniciar
    cargarIngredientes();

    // Botón para abrir modal de nuevo ingrediente
    document.getElementById('btn-nuevo-ingrediente').addEventListener('click', () => {
        abrirModal();
    });

    // Hacer los modales arrastrables
    const modales = document.querySelectorAll('.modal-content');
    modales.forEach(modal => {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = modal.querySelector('.modal-header');
        
        if (header) {
            header.onmousedown = dragMouseDown;
        }

        function dragMouseDown(e) {
            e.preventDefault();
            // Obtener la posición del cursor al inicio
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            // Llamar a función cada vez que el cursor se mueva
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            // Calcular la nueva posición
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            // Establecer la nueva posición
            modal.style.top = (modal.offsetTop - pos2) + "px";
            modal.style.left = (modal.offsetLeft - pos1) + "px";
            modal.style.transform = 'none'; // Remover transform para permitir el arrastre
        }

        function closeDragElement() {
            // Detener el movimiento cuando se suelte el mouse
            document.onmouseup = null;
            document.onmousemove = null;
        }
    });

    // Configurar cerrado de modales
    const modalesConfig = [
        { id: 'modal-ingrediente', closeHandler: cerrarModal },
        { id: 'modal-mix', closeHandler: (modal) => modal.style.display = 'none' }
    ];

    modalesConfig.forEach(({ id, closeHandler }) => {
        const modal = document.getElementById(id);
        const closeBtn = modal.querySelector('.close-modal');
        
        // Botón de cerrar
        closeBtn.addEventListener('click', () => closeHandler(modal));
        
        // Cerrar al hacer clic fuera
        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeHandler(modal);
            }
        });
    });

    // Manejar envío del formulario
    document.getElementById('form-ingrediente').addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('Formulario enviado');

        const datos = {
            codigo: document.getElementById('codigo').value,
            nombre: document.getElementById('nombre').value,
            unidad_medida: document.getElementById('unidad-medida').value,
            categoria: document.getElementById('categoria').value,
            stock_actual: Number(document.getElementById('stock').value.replace(',', '.')),
            descripcion: document.getElementById('descripcion').value,
            padre_id: ingredienteEditando ? ingredienteEditando.padre_id : null
        };

        if (ingredienteEditando) {
            await actualizarIngrediente(ingredienteEditando.id, datos);
        } else {
            await crearIngrediente(datos);
        }
    });
});

// Función para eliminar la composición de un mix
async function eliminarComposicionMix(id) {
    if (!confirm('¿Está seguro de eliminar la composición de este mix? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        console.log('🗑️ Eliminando composición del mix:', id);
        
        // Usar el nuevo endpoint que elimina toda la composición y actualiza receta_base_kg
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${id}/composicion`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error al eliminar la composición');
        }

        // Recargar la tabla
        await cargarIngredientes();
        mostrarMensaje('Composición eliminada exitosamente', 'exito');
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo eliminar la composición');
    }
}

// Hacer funciones disponibles globalmente
window.editarIngrediente = editarIngrediente;
window.eliminarIngrediente = eliminarIngrediente;
window.gestionarComposicionMix = gestionarComposicionMix;
window.eliminarComposicionMix = eliminarComposicionMix;
window.cargarIngredientes = cargarIngredientes;

// Funciones para gestionar el modal de mix
function gestionarComposicionMix(id) {
    const modalMix = document.getElementById('modal-mix');
    modalMix.style.display = 'block';
    
    // Llamar a la función de mix.js para cargar la composición
    window.abrirEdicionMix(id);
}
