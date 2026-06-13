// Variables globales
let sectoresList = [];
let sectorEditando = null;

// ==============================================================================
// HELPERS ALFABÉTICOS Y DESENSAMBLADO
// ==============================================================================

// Convierte letras a número (ej: A -> 1, Z -> 26, AA -> 27)
function letterToNumber(str) {
    let num = 0;
    for (let i = 0; i < str.length; i++) {
        num = num * 26 + (str.charCodeAt(i) - 64);
    }
    return num;
}

// Convierte número a letras (ej: 1 -> A, 26 -> Z, 27 -> AA)
function numberToLetter(num) {
    let str = '';
    while (num > 0) {
        let rem = (num - 1) % 26;
        str = String.fromCharCode(65 + rem) + str;
        num = Math.floor((num - 1) / 26);
    }
    return str;
}

// Extrae la letra pura de la descripción del sector (ej: 'sector "J"' -> 'J')
function obtenerLetraDeSector(descripcion) {
    if (!descripcion) return '';
    const texto = descripcion.replace(/["']/g, '').trim();
    if (!texto) return '';

    // Nivel 1: Regex que soporta 'sector [LETRA]' o 'Sector [LETRA]'
    const matchSector = texto.match(/Sect[a-z]*\s+([A-Z0-9]{1,2})/i);
    if (matchSector) {
        return matchSector[1].toUpperCase();
    }

    // Nivel 2: Si el texto completo es de 1 o 2 letras/números
    if (texto.length > 0 && texto.length <= 2) {
        return texto.toUpperCase();
    }

    return '';
}

// Calcula la siguiente letra disponible y autocompleta el input
function autocompletarSiguienteLetra() {
    let maxVal = 0;
    sectoresList.forEach(sector => {
        const letra = obtenerLetraDeSector(sector.descripcion);
        if (letra && /^[A-Z]+$/.test(letra)) { // Asegurar que sean letras para la progresión infinita
            const val = letterToNumber(letra);
            if (val > maxVal) {
                maxVal = val;
            }
        }
    });
    const siguienteLetra = numberToLetter(maxVal + 1);
    const letraInput = document.getElementById('sector-letra-input');
    if (letraInput) {
        letraInput.value = siguienteLetra;
    }
}

// Valida si la letra ingresada colisiona con otro sector
function validarColisionSector(letraIngresada) {
    const alerta = document.getElementById('alerta-colision-sector');
    const submitBtn = document.querySelector('#form-sector button[type="submit"]');
    if (!alerta || !submitBtn) return false;

    if (!letraIngresada) {
        alerta.style.display = 'none';
        submitBtn.disabled = false;
        return false;
    }

    const letraNormalizada = letraIngresada.toUpperCase().trim();
    const sectorIdActual = document.getElementById('sector-id').value;

    const colisiona = sectoresList.some(sector => {
        // Excluir el sector que estamos editando
        if (sectorIdActual && String(sector.id) === String(sectorIdActual)) {
            return false;
        }
        const letraSector = obtenerLetraDeSector(sector.descripcion);
        return letraSector === letraNormalizada;
    });

    if (colisiona) {
        alerta.textContent = `⚠️ El identificador de sector "${letraNormalizada}" ya se encuentra registrado.`;
        alerta.style.display = 'block';
        submitBtn.disabled = true;
        return true;
    } else {
        alerta.style.display = 'none';
        submitBtn.disabled = false;
        return false;
    }
}

// ==============================================================================
// CORE LOGIC DE SECTORES
// ==============================================================================

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
    
    // Limpiar alertas de colisión y habilitar botón
    const alerta = document.getElementById('alerta-colision-sector');
    if (alerta) alerta.style.display = 'none';
    const submitBtn = document.querySelector('#form-sector button[type="submit"]');
    if (submitBtn) submitBtn.disabled = false;
    
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

        // Llenar el formulario con los datos del sector desensamblados
        document.getElementById('sector-id').value = sector.id;
        document.getElementById('nombre').value = sector.nombre;
        
        const letra = obtenerLetraDeSector(sector.descripcion);
        document.getElementById('sector-letra-input').value = letra;

        // Validar colisión inicial del valor del sector (debe ser falso porque se excluye a sí mismo)
        validarColisionSector(letra);

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
        document.getElementById('sector-id').value = '';
        autocompletarSiguienteLetra();
        abrirModal();
    });

    // Validar colisiones y normalizar entrada en tiempo real
    const letraInput = document.getElementById('sector-letra-input');
    if (letraInput) {
        letraInput.addEventListener('input', (e) => {
            const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
            e.target.value = val;
            validarColisionSector(val);
        });
    }

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

        const nombre = document.getElementById('nombre').value.trim();
        const letra = document.getElementById('sector-letra-input').value.toUpperCase().trim();

        // Ensamblado
        const datos = {
            nombre: nombre,
            descripcion: letra ? `sector "${letra}"` : null
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
