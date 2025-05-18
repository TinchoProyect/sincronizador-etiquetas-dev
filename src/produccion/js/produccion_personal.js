// Función para cargar y mostrar los datos del colaborador
function cargarDatosColaborador() {
    try {
        // Obtener datos del colaborador del localStorage
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        
        if (!colaboradorData) {
            console.error('No hay colaborador seleccionado');
            window.location.href = '/produccion/pages/produccion.html';
            return;
        }

        const colaborador = JSON.parse(colaboradorData);
        
        // Verificar si los datos son recientes (menos de 24 horas)
        const timestamp = new Date(colaborador.timestamp);
        const ahora = new Date();
        const diferencia = ahora - timestamp;
        const horasTranscurridas = diferencia / (1000 * 60 * 60);

        if (horasTranscurridas > 24) {
            console.log('Sesión expirada');
            localStorage.removeItem('colaboradorActivo');
            window.location.href = '/produccion/pages/produccion.html';
            return;
        }

        // Mostrar el nombre del colaborador
        const nombreElement = document.getElementById('nombre-colaborador');
        if (nombreElement) {
            nombreElement.textContent = colaborador.nombre;
        }

    } catch (error) {
        console.error('Error al cargar datos del colaborador:', error);
        window.location.href = '/produccion/pages/produccion.html';
    }
}

// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', cargarDatosColaborador);
