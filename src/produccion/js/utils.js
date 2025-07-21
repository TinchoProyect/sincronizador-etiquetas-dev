// Función para mostrar mensajes de error
export function mostrarError(mensaje) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = mensaje;
    document.querySelector('.modal-content').appendChild(errorDiv);
    
    setTimeout(() => {
        errorDiv.remove();
    }, 3000);
}

// Función para cargar y mostrar los datos del colaborador
export function cargarDatosColaborador(validarCarroActivo) {
    try {
        // Obtener datos del colaborador del localStorage
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        
        if (!colaboradorData) {
            console.error('No hay colaborador seleccionado');
            window.location.href = '/produccion/pages/produccion.html';
            return;
        }

        const colaborador = JSON.parse(colaboradorData);
        console.log('Datos del colaborador:', colaborador);
        
        if (!colaborador.id) {
            console.error('El colaborador no tiene ID');
            limpiarDatosSesion();
            return;
        }

        // Verificar si los datos son recientes (menos de 24 horas)
        const timestamp = new Date(colaborador.timestamp);
        const ahora = new Date();
        const diferencia = ahora - timestamp;
        const horasTranscurridas = diferencia / (1000 * 60 * 60);

        if (horasTranscurridas > 24) {
            console.log('Sesión expirada');
            limpiarDatosSesion();
            return;
        }

        // Mostrar el nombre del colaborador
        const nombreElement = document.getElementById('nombre-colaborador');
        if (nombreElement) {
            nombreElement.textContent = colaborador.nombre || 'Usuario sin nombre';
        }

        // Validar el carro activo
        validarCarroActivo(colaborador.id);

    } catch (error) {
        console.error('Error al cargar datos del colaborador:', error);
        limpiarDatosSesion();
    }
}

// Función para limpiar datos de sesión
export function limpiarDatosSesion() {
    localStorage.removeItem('colaboradorActivo');
    localStorage.removeItem('carroActivo');
    window.location.href = '/produccion/pages/produccion.html';
}

// Estilos CSS para la tabla de carros
export const estilosTablaCarros = `
    .carros-lista {
        margin: 20px 0;
    }
    .carros-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
    }
    .carros-table th, .carros-table td {
        padding: 8px;
        border: 1px solid #ddd;
        text-align: left;
    }
    .carros-table th {
        background-color: #f5f5f5;
    }
    .carro-activo {
        background-color: #e8f5e9;
    }
    .carro-externo {
        background-color: #fff3cd;
        border-left: 4px solid #ffc107;
    }
    .carro-externo.carro-activo {
        background-color: #d4edda;
        border-left: 4px solid #28a745;
    }
    .btn-group {
        display: flex;
        gap: 5px;
    }
    .btn-seleccionar, .btn-deseleccionar, .btn-eliminar {
        padding: 5px 10px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    }
    .btn-seleccionar {
        background-color: #4caf50;
        color: white;
    }
    .btn-deseleccionar {
        background-color: #f44336;
        color: white;
    }
    .btn-eliminar {
        background-color: #ff9800;
        color: white;
    }
    .no-carros {
        text-align: center;
        padding: 20px;
        background-color: #f5f5f5;
        border-radius: 4px;
        margin: 20px 0;
    }
`;
