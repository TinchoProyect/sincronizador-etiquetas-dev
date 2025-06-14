// Función para mostrar mensajes
function mostrarMensaje(mensaje, tipo = 'error') {
    const mensajeDiv = document.createElement('div');
    mensajeDiv.className = tipo === 'error' ? 'mensaje-error' : 'mensaje-info';
    mensajeDiv.textContent = mensaje;
    
    // Remover mensaje anterior si existe
    const mensajeAnterior = document.querySelector('.mensaje-error, .mensaje-info');
    if (mensajeAnterior) {
        mensajeAnterior.remove();
    }
    
    const contentSection = document.querySelector('.content-section');
    if (contentSection) {
        contentSection.insertBefore(mensajeDiv, contentSection.firstChild);
    }
    
    // Remover el mensaje después de 3 segundos
    setTimeout(() => {
        if (mensajeDiv.parentNode) {
            mensajeDiv.parentNode.removeChild(mensajeDiv);
        }
    }, 3000);
}

// Función para actualizar la tabla con los artículos
function actualizarTablaArticulos(articulos) {
    const tbody = document.getElementById('tabla-articulos-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!articulos || articulos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="mensaje-info">No hay artículos registrados</td></tr>';
        return;
    }

    articulos.forEach(articulo => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${articulo.numero}</td>
            <td>${articulo.nombre}</td>
            <td>${articulo.codigo_barras || '-'}</td>
            <td>${articulo.stock_ventas || 0}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Función para cargar los artículos
async function cargarArticulos() {
    try {
        console.log('Cargando artículos...');
        const response = await fetch('/api/produccion/articulos');
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener los artículos');
        }

        const articulos = await response.json();
        console.log('Artículos cargados:', articulos.length);
        
        // Mostrar los artículos en la tabla
        actualizarTablaArticulos(articulos);

    } catch (error) {
        console.error('Error al cargar artículos:', error);
        mostrarMensaje(error.message || 'No se pudieron cargar los artículos');
    }
}

// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    console.log('Página de gestión de artículos cargada');
    cargarArticulos();
});
