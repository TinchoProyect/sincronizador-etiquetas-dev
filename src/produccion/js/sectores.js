// Variables globales
let sectoresList = [];
let sectorEditando = null;

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

// Función para cargar sectores
async function cargarSectores() {
    try {
        const response = await fetch('http://localhost:3002/api/produccion/sectores');

        if (!response.ok) {
            throw new Error('Error al cargar sectores');
        }

        sectoresList = await response.json();

        actualizarTablaSectores();

    } catch (error) {
        console.error('❌ Error al cargar sectores:', error);
        mostrarMensaje('No se pudieron cargar los sectores');
    }
}

// Función para actualizar la tabla de sectores
function actualizarTablaSectores() {
    const tbody = document.getElementById('tabla-sectores-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!sectoresList || sectoresList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center">No hay sectores registrados</td></tr>';
        return;
    }

    sectoresList.forEach(sector => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${sector.nombre}</td>
            <td>${sector.descripcion || '-'}</td>
            <td>
                <button class="btn-editar" onclick="editarSector(${sector.id})">Editar</button>
                <button class="btn-eliminar" onclick="eliminarSector(${sector.id})">Eliminar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Función para abrir el modal
function abrirModal(titulo = 'Nuevo Sector') {
    const modal = document.getElementById('modal-sector');
    const modalTitulo = document.getElementById('modal-titulo');
    modalTitulo.textContent = titulo;
    modal.style.display = 'block';
}

// Función para cerrar el modal
function cerrarModal() {
    const modal = document.getElementById('modal-sector');
    modal.style.display = 'none';
    document.getElementById('form-sector').reset();
    sectorEditando = null;
}

// Función para crear un nuevo sector
async function crearSector(datos) {
    try {
        const response = await fetch('http://localhost:3002/api/produccion/sectores', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datos)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al crear el sector');
        }

        await cargarSectores();
        mostrarMensaje('Sector creado exitosamente', 'exito');
        cerrarModal();

    } catch (error) {
        console.error('❌ Error:', error);
        mostrarMensaje(error.message || 'No se pudo crear el sector');
    }
}

// Función para actualizar un sector
async function actualizarSector(id, datos) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/sectores/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datos)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al actualizar el sector');
        }

        await cargarSectores();
        mostrarMensaje('Sector actualizado exitosamente', 'exito');
        cerrarModal();

    } catch (error) {
        console.error('❌ Error:', error);
        mostrarMensaje(error.message || 'No se pudo actualizar el sector');
    }
}

// Función para editar un sector
async function editarSector(id) {
    try {
        const sector = sectoresList.find(s => s.id === id);

        if (!sector) {
            throw new Error('Sector no encontrado');
        }

        sectorEditando = sector;

        // Llenar el formulario con los datos del sector
        document.getElementById('sector-id').value = sector.id;
        document.getElementById('nombre').value = sector.nombre;
        document.getElementById('descripcion').value = sector.descripcion || '';

        abrirModal('Editar Sector');

    } catch (error) {
        console.error('❌ Error:', error);
        mostrarMensaje(error.message || 'No se pudo cargar el sector para editar');
    }
}

// Función para eliminar un sector
async function eliminarSector(id) {
    const sector = sectoresList.find(s => s.id === id);
    if (!sector) {
        mostrarMensaje('Sector no encontrado');
        return;
    }

    if (!confirm(`¿Estás seguro de que quieres eliminar el sector "${sector.nombre}"?`)) {
        return;
    }

    try {
        const response = await fetch(`http://localhost:3002/api/produccion/sectores/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al eliminar el sector');
        }

        await cargarSectores();
        mostrarMensaje('Sector eliminado exitosamente', 'exito');

    } catch (error) {
        console.error('❌ Error:', error);
        mostrarMensaje(error.message || 'No se pudo eliminar el sector');
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {

    // Cargar sectores al iniciar
    cargarSectores();

    // Botón para abrir modal de nuevo sector
    document.getElementById('btn-nuevo-sector').addEventListener('click', () => {
        abrirModal();
    });

    // Botón para cerrar modal
    document.querySelector('.close-modal').addEventListener('click', cerrarModal);
    document.getElementById('btn-cancelar').addEventListener('click', cerrarModal);

    // Cerrar modal al hacer clic fuera
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('modal-sector');
        if (e.target === modal) {
            cerrarModal();
        }
    });

    // Manejar envío del formulario
    document.getElementById('form-sector').addEventListener('submit', async (e) => {
        e.preventDefault();

        const datos = {
            nombre: document.getElementById('nombre').value.trim(),
            descripcion: document.getElementById('descripcion').value.trim() || null
        };

        if (sectorEditando) {
            await actualizarSector(sectorEditando.id, datos);
        } else {
            await crearSector(datos);
        }
    });
});

// Hacer funciones disponibles globalmente
window.editarSector = editarSector;
window.eliminarSector = eliminarSector;
