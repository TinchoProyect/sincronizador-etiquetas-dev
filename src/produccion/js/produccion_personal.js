// Función para actualizar la información visual del carro activo
async function actualizarEstadoCarro() {
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
                <tr class="${estaActivo ? 'carro-activo' : ''}">
                    <td>${carro.id}</td>
                    <td>${fecha}</td>
                    <td>${carro.total_articulos} artículos</td>
                    <td>${carro.en_auditoria ? 'En auditoría' : 'Completado'}</td>
                    <td>
                        <div class="btn-group">
                            ${estaActivo ? 
                                '<button class="btn-deseleccionar" onclick="deseleccionarCarro()">Deseleccionar</button>' :
                                `<button class="btn-seleccionar" onclick="seleccionarCarro(${carro.id})">Seleccionar</button>`
                            }
                            <button class="btn-eliminar" onclick="eliminarCarro(${carro.id})">Eliminar</button>
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
        style.textContent = `
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
        document.head.appendChild(style);

    } catch (error) {
        console.error('Error:', error);
        carroInfo.innerHTML = '<p>Error al cargar los carros</p>';
    }
}

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
function limpiarDatosSesion() {
    localStorage.removeItem('colaboradorActivo');
    localStorage.removeItem('carroActivo');
    window.location.href = '/produccion/pages/produccion.html';
}

// Función para validar el carro activo
async function validarCarroActivo(usuarioId) {
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
async function crearNuevoCarro() {
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

// Variables globales para los artículos y filtros
let todosLosArticulos = [];
let articulosFiltrados = [];

// Función para abrir el modal de artículos
async function abrirModalArticulos() {
    try {
        const modal = document.getElementById('modal-articulos');
        modal.style.display = 'block';

        // Cargar artículos si aún no se han cargado
        if (todosLosArticulos.length === 0) {
            const response = await fetch('http://localhost:3002/api/produccion/articulos');
            if (!response.ok) {
                throw new Error('Error al obtener artículos');
            }
            todosLosArticulos = await response.json();
            articulosFiltrados = [...todosLosArticulos];
            actualizarTablaArticulos(articulosFiltrados);
        }
    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
    }
}

// Función para cerrar el modal
function cerrarModalArticulos() {
    const modal = document.getElementById('modal-articulos');
    modal.style.display = 'none';
    // Limpiar filtros
    document.getElementById('filtro1').value = '';
    document.getElementById('filtro2').value = '';
    document.getElementById('filtro3').value = '';
    document.getElementById('codigo-barras').value = '';
}

// Función para actualizar la tabla de artículos
async function actualizarTablaArticulos(articulos) {
    const tbody = document.getElementById('tabla-articulos-body');
    tbody.innerHTML = '';

    try {
        console.log('Consultando estado de recetas para artículos:', articulos.map(art => art.numero));
        
        // Obtener el estado de las recetas para todos los artículos
        const response = await fetch('http://localhost:3002/api/produccion/articulos/estado-recetas', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                articulos: articulos.map(art => art.numero)
            })
        });

        if (!response.ok) {
            throw new Error('Error al obtener estado de recetas');
        }

        const estadoRecetas = await response.json();
        console.log('Estado de recetas recibido:', estadoRecetas);

        articulos.forEach(articulo => {
            const tr = document.createElement('tr');
            const tieneReceta = estadoRecetas[articulo.numero];
            
            tr.innerHTML = `
                <td>${articulo.numero}</td>
                <td>${articulo.nombre.replace(/'/g, "\\'")}</td>
                <td>${articulo.codigo_barras || '-'}</td>
                <td>
                    <input type="number" class="cantidad-input" min="1" value="1">
                    <button class="btn-agregar ${tieneReceta ? 'btn-verde' : 'btn-rojo'}" 
                            onclick="agregarAlCarro('${articulo.numero}', '${articulo.nombre.replace(/'/g, "\\'")}', this)">
                        Agregar al carro
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (error) {
        console.error('Error al actualizar tabla:', error);
        // Si hay error, mostrar los botones en rojo por defecto
        articulos.forEach(articulo => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${articulo.numero}</td>
                <td>${articulo.nombre.replace(/'/g, "\\'")}</td>
                <td>${articulo.codigo_barras || '-'}</td>
                <td>
                    <input type="number" class="cantidad-input" min="1" value="1">
                    <button class="btn-agregar btn-rojo" 
                            onclick="agregarAlCarro('${articulo.numero}', '${articulo.nombre.replace(/'/g, "\\'")}', this)">
                        Agregar al carro
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
}

// Función para aplicar filtros en cascada
function aplicarFiltros(filtroIndex) {
    const filtro1 = document.getElementById('filtro1').value.toLowerCase();
    const filtro2 = document.getElementById('filtro2').value.toLowerCase();
    const filtro3 = document.getElementById('filtro3').value.toLowerCase();

    // Resetear filtros posteriores
    if (filtroIndex === 1) {
        document.getElementById('filtro2').value = '';
        document.getElementById('filtro3').value = '';
    } else if (filtroIndex === 2) {
        document.getElementById('filtro3').value = '';
    }

    // Aplicar filtros en cascada
    let resultados = todosLosArticulos;

    if (filtro1) {
        resultados = resultados.filter(art => 
            art.nombre.toLowerCase().includes(filtro1)
        );
    }

    if (filtro2) {
        resultados = resultados.filter(art => 
            art.nombre.toLowerCase().includes(filtro2)
        );
    }

    if (filtro3) {
        resultados = resultados.filter(art => 
            art.nombre.toLowerCase().includes(filtro3)
        );
    }

    articulosFiltrados = resultados;
    actualizarTablaArticulos(resultados);
}

// Función para buscar por código de barras
function buscarPorCodigoBarras(codigo) {
    const articulo = todosLosArticulos.find(art => art.codigo_barras === codigo);
    if (articulo) {
        articulosFiltrados = [articulo];
        actualizarTablaArticulos(articulosFiltrados);
    }
}

// Función para mostrar mensajes de error
function mostrarError(mensaje) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = mensaje;
    document.querySelector('.modal-content').appendChild(errorDiv);
    
    setTimeout(() => {
        errorDiv.remove();
    }, 3000);
}

// Función para agregar artículo al carro
async function agregarAlCarro(articuloNumero, descripcion, btnElement) {
    try {
        const carroId = localStorage.getItem('carroActivo');
        if (!carroId) {
            throw new Error('No hay un carro de producción activo');
        }

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        const cantidadInput = btnElement.previousElementSibling;
        const cantidad = parseInt(cantidadInput.value);
        
        if (isNaN(cantidad) || cantidad <= 0) {
            throw new Error('La cantidad debe ser un número positivo');
        }

        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                articuloNumero,
                descripcion,
                cantidad,
                usuarioId: colaborador.id
            })
        });

        if (!response.ok) {
            throw new Error('Error al agregar el artículo al carro');
        }

        // Mostrar mensaje de éxito
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = 'Artículo agregado correctamente';
        document.querySelector('.modal-content').appendChild(successDiv);
        
        // Remover el mensaje después de 3 segundos
        setTimeout(() => {
            successDiv.remove();
        }, 3000);

        // Actualizar la lista de artículos en el carro
        await mostrarArticulosDelCarro();

        // Cerrar el modal después de agregar
        cerrarModalArticulos();

    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
    }
}

/**
 * Muestra los artículos agregados al carro activo en el área de trabajo
 */
async function mostrarArticulosDelCarro() {
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

// Función para seleccionar un carro
async function seleccionarCarro(carroId) {
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
async function deseleccionarCarro() {
    localStorage.removeItem('carroActivo');
    await actualizarEstadoCarro();
    document.getElementById('lista-articulos').innerHTML = '<p>No hay carro activo</p>';
}

// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    cargarDatosColaborador();
    
    // Mostrar artículos del carro si hay uno activo
    mostrarArticulosDelCarro();

    // Agregar evento al botón de crear carro
    const btnCrearCarro = document.getElementById('crear-carro');
    if (btnCrearCarro) {
        btnCrearCarro.addEventListener('click', async () => {
            await crearNuevoCarro();
            mostrarArticulosDelCarro();
        });
    }

    // Agregar evento al botón de agregar artículo
    const btnAgregarArticulo = document.getElementById('agregar-articulo');
    if (btnAgregarArticulo) {
        btnAgregarArticulo.addEventListener('click', abrirModalArticulos);
    }

    // Agregar evento al botón de cerrar modal
    const closeModal = document.querySelector('.close-modal');
    if (closeModal) {
        closeModal.addEventListener('click', cerrarModalArticulos);
    }

    // Agregar eventos a los filtros
    document.getElementById('filtro1').addEventListener('input', () => aplicarFiltros(1));
    document.getElementById('filtro2').addEventListener('input', () => aplicarFiltros(2));
    document.getElementById('filtro3').addEventListener('input', () => aplicarFiltros(3));
    
    // Agregar evento al input de código de barras
    document.getElementById('codigo-barras').addEventListener('change', (e) => {
        buscarPorCodigoBarras(e.target.value);
    });

    // Cerrar modal al hacer clic fuera
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('modal-articulos');
        if (e.target === modal) {
            cerrarModalArticulos();
        }
    });

// Mostrar estado inicial del carro
    actualizarEstadoCarro();
});

// Función para eliminar un carro
async function eliminarCarro(carroId) {
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
