import { mostrarError, estilosTablaCarros } from './utils.js';

// Función para actualizar la información visual del carro activo
export async function actualizarEstadoCarro() {
    const carroId = localStorage.getItem('carroActivo');
    const carroInfo = document.getElementById('carro-actual');
    const colaboradorData = localStorage.getItem('colaboradorActivo');
    
    if (!colaboradorData) {
        carroInfo.innerHTML = '<p>No hay colaborador seleccionado</p>';
        return;
    }

    const colaborador = JSON.parse(colaboradorData);
    
    try {
        console.log('Obteniendo carros para usuario:', colaborador.id);
        // Obtener todos los carros del usuario
        const response = await fetch(`http://localhost:3002/api/produccion/usuario/${colaborador.id}/carros`);
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Error response:', errorData);
            throw new Error(errorData.error || 'Error al obtener carros del usuario');
        }
        
        const carros = await response.json();
        
        if (carros.length === 0) {
            carroInfo.innerHTML = `
                <div class="no-carros">
                    <p>Este usuario aún no tiene carros activos.</p>
                    <p>Podés crear uno nuevo para comenzar.</p>
                </div>
            `;
            return;
        }

        // Construir la lista de carros
        let html = `
            <div class="carros-lista">
                <h3>Tus carros de producción</h3>
                <table class="carros-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Fecha de inicio</th>
                            <th>Artículos</th>
                            <th>Estado</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        carros.forEach(carro => {
            const fecha = new Date(carro.fecha_inicio).toLocaleString();
            const estaActivo = carro.id.toString() === carroId;
            
            html += `
                <tr class="${estaActivo ? 'carro-activo' : ''}" onclick="seleccionarCarro(${carro.id})">
                    <td>${carro.id}</td>
                    <td>${fecha}</td>
                    <td>${carro.total_articulos} artículos</td>
                    <td>${carro.en_auditoria ? 'En auditoría' : 'Completado'}</td>
                    <td>
                        <div class="btn-group">
                            ${estaActivo ? 
                                '<button class="btn-deseleccionar" onclick="event.stopPropagation(); deseleccionarCarro()">Deseleccionar</button>' :
                                ''
                            }
                            <button class="btn-eliminar" onclick="event.stopPropagation(); eliminarCarro(${carro.id})">Eliminar</button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        carroInfo.innerHTML = html;

        // Agregar estilos CSS inline para la tabla
        const style = document.createElement('style');
        style.textContent = estilosTablaCarros;
        document.head.appendChild(style);

    } catch (error) {
        console.error('Error:', error);
        carroInfo.innerHTML = '<p>Error al cargar los carros</p>';
    }
}

// Función para validar el carro activo
export async function validarCarroActivo(usuarioId) {
    const carroId = localStorage.getItem('carroActivo');
    if (!carroId) return;

    try {
        // Intentar obtener los artículos del carro para validar propiedad
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${usuarioId}`);
        
        if (!response.ok) {
            // Si hay error, probablemente el carro no pertenece al usuario
            console.log('El carro no pertenece al usuario actual');
            localStorage.removeItem('carroActivo');
            actualizarEstadoCarro();
        }
    } catch (error) {
        console.error('Error al validar carro:', error);
        localStorage.removeItem('carroActivo');
        actualizarEstadoCarro();
    }
}

// Función para crear un nuevo carro de producción
export async function crearNuevoCarro() {
    try {
        // Verificar si ya existe un carro activo
        const carroActivo = localStorage.getItem('carroActivo');
        if (carroActivo) {
            throw new Error(`Ya hay un carro activo (ID: ${carroActivo})`);
        }

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        const response = await fetch('http://localhost:3002/api/produccion/carro', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuarioId: colaborador.id,
                enAuditoria: true
            })
        });

        if (!response.ok) {
            throw new Error('Error al crear el carro de producción');
        }

        const data = await response.json();
        console.log('Carro de producción creado:', data.id);
        
        // Guardar el ID del carro en localStorage
        localStorage.setItem('carroActivo', data.id);
        
        // Actualizar la información visual del carro
        actualizarEstadoCarro();

    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
    }
}

// Función para seleccionar un carro
export async function seleccionarCarro(carroId) {
    try {
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        
        // Validar que el carro pertenezca al usuario antes de seleccionarlo
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${colaborador.id}`);
        if (!response.ok) {
            throw new Error('No se puede seleccionar este carro');
        }

        // Si la validación es exitosa, establecer como carro activo
        localStorage.setItem('carroActivo', carroId);
        
        // Actualizar la interfaz
        await actualizarEstadoCarro();
        await mostrarArticulosDelCarro();
    } catch (error) {
        console.error('Error al seleccionar carro:', error);
        mostrarError(error.message);
    }
}

// Función para deseleccionar el carro actual
export async function deseleccionarCarro() {
    localStorage.removeItem('carroActivo');
    await actualizarEstadoCarro();
    document.getElementById('lista-articulos').innerHTML = '<p>No hay carro activo</p>';
}

// Función para eliminar un carro
export async function eliminarCarro(carroId) {
    if (!confirm('¿Estás seguro de que querés eliminar este carro? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}?usuarioId=${colaborador.id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('No se pudo eliminar el carro');
        }

        // Si el carro eliminado era el activo, limpiarlo
        const carroActivo = localStorage.getItem('carroActivo');
        if (carroActivo === carroId.toString()) {
            localStorage.removeItem('carroActivo');
            document.getElementById('lista-articulos').innerHTML = '<p>No hay carro activo</p>';
        }

        // Actualizar la lista de carros
        await actualizarEstadoCarro();

    } catch (error) {
        console.error('Error al eliminar carro:', error);
        mostrarError(error.message);
    }
}

/**
 * Muestra los artículos agregados al carro activo en el área de trabajo
 */
export async function mostrarArticulosDelCarro() {
    try {
        const carroId = localStorage.getItem('carroActivo');
        if (!carroId) {
            document.getElementById('lista-articulos').innerHTML = '<p>No hay carro activo</p>';
            return;
        }

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${colaborador.id}`);
        
        if (!response.ok) {
            throw new Error('Error al obtener artículos del carro');
        }

        const articulos = await response.json();

        let html = `
            <div class="agregar-articulo-container">
                <button id="agregar-articulo" class="btn btn-secondary">
                    Agregar artículo al carro
                </button>
            </div>
            <h3>Artículos en el carro</h3>
            <table border="1" cellpadding="5" cellspacing="0">
                <thead>
                    <tr>
                        <th>Código</th>
                        <th>Descripción</th>
                        <th>Código de Barras</th>
                        <th>Cantidad cargada</th>
                    </tr>
                </thead>
                <tbody>
        `;

        articulos.forEach(art => {
            html += `
                <tr>
                    <td>${art.numero}</td>
                    <td>${art.descripcion}</td>
                    <td>${art.codigo_barras || '-'}</td>
                    <td>${art.cantidad}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        const contenedor = document.getElementById('lista-articulos');
        if (contenedor) {
            contenedor.innerHTML = html;
        } else {
            console.error('No se encontró el contenedor lista-articulos');
        }

    } catch (error) {
        console.error('Error al mostrar artículos del carro:', error);
        if (error.message.includes('No hay colaborador seleccionado')) {
            limpiarDatosSesion();
        }
    }
}
