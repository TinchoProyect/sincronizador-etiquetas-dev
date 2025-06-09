import { esMix } from './mix.js';

// Variables globales
let ingredienteEditando = null;
let ingredientesOriginales = []; // Para mantener la lista completa
let filtrosActivos = new Set(); // Para rastrear filtros activos

// Funciones para gestionar el modal
async function abrirModal(titulo = 'Nuevo Ingrediente') {
    const modal = document.getElementById('modal-ingrediente');
    const modalTitulo = document.getElementById('modal-titulo');
    modalTitulo.textContent = titulo;
    modal.style.display = 'block';

    // Si es un nuevo ingrediente, obtener el código automáticamente
    if (titulo === 'Nuevo Ingrediente') {
        try {
            const response = await fetch('/api/produccion/ingredientes/nuevo-codigo');
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

// Función para inicializar los filtros de categorías
function inicializarFiltros(ingredientes) {
    const filtrosContainer = document.getElementById('filtros-categorias');
    if (!filtrosContainer) return;

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

    // Contenedor para botones de categoría
    const categoriasBotones = document.createElement('div');
    categoriasBotones.className = 'categorias-botones';
    filtrosContainer.appendChild(categoriasBotones);

    // Obtener categorías únicas y ordenadas
    const categorias = [...new Set(ingredientes.map(ing => ing.categoria))]
        .filter(Boolean)
        .sort();

    // Crear botones de categoría
    const botonesCategorias = categorias.map(cat => {
        const btn = document.createElement('button');
        btn.textContent = cat;
        btn.className = 'btn-filtro activo';
        categoriasBotones.appendChild(btn);
        return btn;
    });

    // Inicializar filtros activos con todas las categorías
    filtrosActivos = new Set(categorias);

    // Evento para "Mostrar Todos"
    btnTodos.onclick = () => {
        filtrosActivos = new Set(categorias);
        botonesCategorias.forEach(btn => {
            btn.classList.add('activo');
        });
        actualizarTablaFiltrada();
    };

    // Evento para "Ocultar Todos"
    btnOcultar.onclick = () => {
        filtrosActivos.clear();
        botonesCategorias.forEach(btn => {
            btn.classList.remove('activo');
        });
        actualizarTablaFiltrada();
    };

    // Eventos para cada botón de categoría
    botonesCategorias.forEach(btn => {
        btn.onclick = () => {
            if (btn.classList.contains('activo')) {
                btn.classList.remove('activo');
                filtrosActivos.delete(btn.textContent);
            } else {
                btn.classList.add('activo');
                filtrosActivos.add(btn.textContent);
            }
            actualizarTablaFiltrada();
        };
    });
}

// Función para actualizar la tabla según los filtros activos
function actualizarTablaFiltrada() {
    const ingredientesFiltrados = ingredientesOriginales.filter(ing => 
        filtrosActivos.size === 0 || filtrosActivos.has(ing.categoria)
    );
    actualizarTablaIngredientes(ingredientesFiltrados);
}

// Función para cargar los ingredientes
async function cargarIngredientes() {
    try {
        console.log('Solicitando ingredientes...');
        const response = await fetch('/api/produccion/ingredientes');
        console.log('Respuesta recibida:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener los ingredientes');
        }

        const ingredientes = await response.json();
        console.log('Ingredientes recibidos:', ingredientes);
        
        // Guardar lista completa
        ingredientesOriginales = ingredientes;
        
        // Actualizar lista en mix.js
        window.actualizarListaIngredientes(ingredientes);
        
        // Inicializar filtros
        inicializarFiltros(ingredientes);
        
        // Mostrar todos los ingredientes inicialmente
        actualizarTablaIngredientes(ingredientes);

    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudieron cargar los ingredientes');
    }
}

// Función para actualizar la tabla con los ingredientes
function actualizarTablaIngredientes(ingredientes) {
    const tbody = document.getElementById('tabla-ingredientes-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!ingredientes || ingredientes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay ingredientes registrados</td></tr>';
        return;
    }

    ingredientes.forEach(ingrediente => {
        const tr = document.createElement('tr');
        tr.dataset.id = ingrediente.id;
        tr.innerHTML = `
            <td>${ingrediente.nombre}</td>
            <td>${ingrediente.unidad_medida}</td>
            <td>${ingrediente.categoria}</td>
            <td>${ingrediente.stock_actual}</td>
            <td>${ingrediente.descripcion || '-'}</td>
<td class="tipo-col"></td>
<td>-</td>




            <td>
                <button class="btn-editar" onclick="editarIngrediente(${ingrediente.id})">Editar</button>

                <button class="btn-eliminar" onclick="eliminarIngrediente(${ingrediente.id})">Eliminar</button>
                <button class="btn-agregar" onclick="gestionarComposicionMix(${ingrediente.id})"
                        style="display: none">
                    Gestionar composición
                </button>
            </td>
        `;
        tbody.appendChild(tr);

        // Verificar estado de mix para cada ingrediente
        (async () => {
            try {
                const tieneMix = await window.esMix(ingrediente.id);
                const esMixStatus = tr.querySelector('.es-mix-status');
                const btnGestionar = tr.querySelector('.btn-agregar');
                
const tipoCell = tr.querySelector('.tipo-col');
tipoCell.textContent = tieneMix ? 'Ingrediente Mix' : 'Ingrediente Simple';

if (esMixStatus) {
    esMixStatus.textContent = tieneMix ? 'Sí' : 'No (aún)';
}

                
                if (btnGestionar) {
                    // Mostrar el botón si no tiene padre_id (puede ser mix)
                    btnGestionar.style.display = !ingrediente.padre_id ? 'inline-block' : 'none';
                }
            } catch (error) {
                console.error(`Error al verificar mix para ingrediente ${ingrediente.id}:`, error);
                const esMixStatus = tr.querySelector('.es-mix-status');
                if (esMixStatus) {
                    esMixStatus.textContent = 'Error';
                }
            }
        })();
    });
}

// Función para crear un nuevo ingrediente
async function crearIngrediente(datos) {
    try {
        console.log('Creando ingrediente:', datos);
        const response = await fetch('/api/produccion/ingredientes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datos)
        });

        if (!response.ok) {
            const errorData = await response.json();
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
        const response = await fetch(`/api/produccion/ingredientes/${id}`, {
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
        const response = await fetch(`/api/produccion/ingredientes/${id}`, {
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
        const response = await fetch(`/api/produccion/ingredientes/${id}`);
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
            stock_actual: parseFloat(document.getElementById('stock').value),
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

// Hacer funciones disponibles globalmente
window.editarIngrediente = editarIngrediente;
window.eliminarIngrediente = eliminarIngrediente;

// Funciones para gestionar el modal de mix
function gestionarComposicionMix(id) {
    const modalMix = document.getElementById('modal-mix');
    modalMix.style.display = 'block';
    
    // Llamar a la función de mix.js para cargar la composición
    window.abrirEdicionMix(id);
}


window.gestionarComposicionMix = gestionarComposicionMix;
