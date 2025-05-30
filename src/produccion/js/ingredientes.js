import { esMix } from './mix.js';

// Variables globales
let ingredienteEditando = null;

// Funciones para gestionar el modal
function abrirModal(titulo = 'Nuevo Ingrediente') {
    const modal = document.getElementById('modal-ingrediente');
    const modalTitulo = document.getElementById('modal-titulo');
    modalTitulo.textContent = titulo;
    modal.style.display = 'block';
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
        window.actualizarListaIngredientes(ingredientes);
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

        await cargarIngredientes();
        mostrarMensaje('Ingrediente creado exitosamente', 'exito');
        cerrarModal();
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
        document.getElementById('nombre').value = ingrediente.nombre;
        document.getElementById('unidad-medida').value = ingrediente.unidad_medida;
        document.getElementById('categoria').value = ingrediente.categoria;
        document.getElementById('stock').value = ingrediente.stock_actual;
        document.getElementById('descripcion').value = ingrediente.descripcion || '';

        abrirModal('Editar Ingrediente');
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo cargar el ingrediente para editar');
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('Página cargada, inicializando...');
    
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
