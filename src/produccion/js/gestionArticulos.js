// Variables globales para el inventario
let usuarioSeleccionado = null;
let articulosInventario = new Map(); // Mapa para almacenar los artículos escaneados

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

// Funciones para el modal de inventario
function mostrarModal() {
    const modal = document.getElementById('modal-inventario');
    modal.style.display = 'block';
    document.getElementById('paso-usuario').style.display = 'block';
    document.getElementById('paso-conteo').style.display = 'none';
    cargarUsuarios();
}

function cerrarModal() {
    const modal = document.getElementById('modal-inventario');
    modal.style.display = 'none';
    reiniciarInventario();
}

function reiniciarInventario() {
    usuarioSeleccionado = null;
    articulosInventario.clear();
    document.getElementById('select-usuario').value = '';
    document.getElementById('input-codigo-barras').value = '';
    document.getElementById('articulos-inventario').innerHTML = '';
    document.getElementById('btn-continuar-usuario').disabled = true;
}

async function cargarUsuarios() {
    try {
        const response = await fetch('/api/usuarios?rol=3&activo=true');
        if (!response.ok) throw new Error('Error al cargar usuarios');
        
        const usuarios = await response.json();
        const select = document.getElementById('select-usuario');
        select.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
        
        usuarios.forEach(usuario => {
            const option = document.createElement('option');
            option.value = usuario.id;
            option.textContent = usuario.nombre_completo;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        mostrarMensaje('No se pudieron cargar los usuarios');
    }
}

function mostrarPasoConteo() {
    document.getElementById('paso-usuario').style.display = 'none';
    document.getElementById('paso-conteo').style.display = 'block';
    document.getElementById('input-codigo-barras').focus();
}

async function buscarArticuloPorCodigo(codigoBarras) {
    try {
        const response = await fetch(`/api/produccion/articulos/buscar?codigo_barras=${codigoBarras}`);
        if (!response.ok) throw new Error('Artículo no encontrado');
        return await response.json();
    } catch (error) {
        console.error('Error al buscar artículo:', error);
        mostrarMensaje('Artículo no encontrado');
        return null;
    }
}

function agregarArticuloAInventario(articulo) {
    if (articulosInventario.has(articulo.numero)) {
        mostrarMensaje('Este artículo ya fue agregado al inventario', 'info');
        return;
    }

    const div = document.createElement('div');
    div.className = 'inventario-item';
    div.innerHTML = `
        <h4>${articulo.nombre}</h4>
        <div class="info-row">
            <span>Código: ${articulo.numero}</span>
            <span>Código de Barras: ${articulo.codigo_barras || '-'}</span>
        </div>
        <div class="info-row">
            <span>Stock Actual: ${articulo.stock_consolidado || 0}</span>
        </div>
        <div class="stock-input">
            <label>Stock Físico:</label>
            <input type="number" min="0" step="1" class="stock-fisico" 
                   data-articulo="${articulo.numero}" value="0">
        </div>
    `;

    document.getElementById('articulos-inventario').appendChild(div);
    articulosInventario.set(articulo.numero, articulo);
}

async function finalizarInventario() {
    if (articulosInventario.size === 0) {
        mostrarMensaje('No hay artículos para registrar', 'error');
        return;
    }

    const ajustes = [];
    const inputs = document.querySelectorAll('.stock-fisico');
    
    inputs.forEach(input => {
        const articuloNumero = input.dataset.articulo;
        const articulo = articulosInventario.get(articuloNumero);
        const stockFisico = parseInt(input.value) || 0;
        const ajuste = stockFisico - (articulo.stock_consolidado || 0);
        
        if (ajuste !== 0) {
            ajustes.push({
                articulo_numero: articuloNumero,
                codigo_barras: articulo.codigo_barras,
                usuario_id: usuarioSeleccionado,
                tipo: 'registro de ajuste',
                kilos: ajuste,
                cantidad: 1
            });
        }
    });

    if (ajustes.length === 0) {
        mostrarMensaje('No hay ajustes para registrar', 'info');
        cerrarModal();
        return;
    }

    try {
        const response = await fetch('/api/produccion/stock-ventas-movimientos/batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ajustes })
        });

        if (!response.ok) throw new Error('Error al registrar los ajustes');

        mostrarMensaje('Inventario registrado correctamente', 'info');
        cerrarModal();
        cargarArticulos(); // Recargar la tabla de artículos
    } catch (error) {
        console.error('Error al finalizar inventario:', error);
        mostrarMensaje('Error al registrar el inventario');
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('Página de gestión de artículos cargada');
    cargarArticulos();

    // Botón para iniciar inventario
    document.getElementById('btn-iniciar-inventario').addEventListener('click', mostrarModal);

    // Cerrar modal
    document.getElementById('close-modal').addEventListener('click', cerrarModal);
    window.addEventListener('click', (e) => {
        if (e.target.className === 'modal') cerrarModal();
    });

    // Select de usuario
    document.getElementById('select-usuario').addEventListener('change', (e) => {
        usuarioSeleccionado = e.target.value;
        document.getElementById('btn-continuar-usuario').disabled = !usuarioSeleccionado;
    });

    // Botón continuar después de seleccionar usuario
    document.getElementById('btn-continuar-usuario').addEventListener('click', mostrarPasoConteo);

    // Input de código de barras
    document.getElementById('input-codigo-barras').addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const codigo = e.target.value.trim();
            if (!codigo) return;

            const articulo = await buscarArticuloPorCodigo(codigo);
            if (articulo) {
                agregarArticuloAInventario(articulo);
                e.target.value = '';
            }
        }
    });

    // Botones de finalizar y cancelar
    document.getElementById('btn-finalizar-inventario').addEventListener('click', finalizarInventario);
    document.getElementById('btn-cancelar-inventario').addEventListener('click', cerrarModal);
});
