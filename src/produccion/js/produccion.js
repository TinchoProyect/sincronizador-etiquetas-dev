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

// Objeto global para mantener referencias de ventanas abiertas por usuario
const ventanasProduccionPersonal = {};

// Función para manejar la selección de un usuario
function seleccionarUsuario(usuario) {
    // Guardar el colaborador seleccionado en localStorage incluyendo rol_id
    localStorage.setItem('colaboradorActivo', JSON.stringify({
        id: usuario.id,
        nombre: usuario.nombre_completo,
        rol_id: usuario.rol_id,
        timestamp: new Date().toISOString()
    }));

    const userId = usuario.id;

    // Verificar si ya existe una ventana abierta para este usuario y que no esté cerrada
    if (ventanasProduccionPersonal[userId] && !ventanasProduccionPersonal[userId].closed) {
        ventanasProduccionPersonal[userId].focus();
        ventanasProduccionPersonal[userId].postMessage({
            type: 'actualizarUsuario',
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre_completo,
                rol_id: usuario.rol_id
            }
        }, window.location.origin);
    } else {
        // Abrir la página personal en una nueva pestaña y guardar la referencia
        ventanasProduccionPersonal[userId] = window.open('/pages/produccion_personal.html', '_blank');
    }
}

// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', cargarUsuariosProduccion);
