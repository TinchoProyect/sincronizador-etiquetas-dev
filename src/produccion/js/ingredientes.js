import { esMix } from './mix.js';

// Variables globales
let ingredienteEditando = null;
let ingredientesOriginales = []; // Para mantener la lista completa
let filtrosActivos = new Set(); // Para rastrear filtros activos por categoría
let filtrosTipoActivos = new Set(); // Para rastrear filtros activos por tipo (Simple/Mix)
let filtrosStockActivos = new Set(); // Para rastrear filtros activos por stock (Con Stock/Sin Stock)
let filtrosSectorActivos = new Set(); // Para rastrear filtros activos por sector
let vistaActual = 'deposito'; // Para identificar la vista actual ('deposito' o 'usuario-X')
let sectoresDisponibles = []; // Para almacenar la lista de sectores

// ✅ NUEVAS VARIABLES PARA MANTENER ESTADO DE FILTROS
let estadoFiltrosGuardado = null; // Para guardar temporalmente el estado de filtros

// ✅ FUNCIONES PARA MANTENER ESTADO DE FILTROS
function guardarEstadoFiltros() {
    estadoFiltrosGuardado = {
        categorias: new Set(filtrosActivos),
        tipos: new Set(filtrosTipoActivos),
        stocks: new Set(filtrosStockActivos),
        sectores: new Set(filtrosSectorActivos)
    };
}

function restaurarEstadoFiltros() {
    if (!estadoFiltrosGuardado) {
        return;
    }

    // Restaurar los Sets de filtros
    filtrosActivos = new Set(estadoFiltrosGuardado.categorias);
    filtrosTipoActivos = new Set(estadoFiltrosGuardado.tipos);
    filtrosStockActivos = new Set(estadoFiltrosGuardado.stocks);
    filtrosSectorActivos = new Set(estadoFiltrosGuardado.sectores);

    // Restaurar estado visual de los botones
    restaurarEstadoVisualFiltros();
}

function restaurarEstadoVisualFiltros() {
    // Restaurar botones de categoría
    document.querySelectorAll('.categorias-botones .btn-filtro').forEach(btn => {
        if (filtrosActivos.has(btn.textContent)) {
            btn.classList.add('activo');
        } else {
            btn.classList.remove('activo');
        }
    });

    // Restaurar botones de tipo
    document.querySelectorAll('.tipos-botones .btn-filtro').forEach(btn => {
        const tipo = btn.dataset.tipo;
        if (filtrosTipoActivos.has(tipo)) {
            btn.classList.add('activo');
        } else {
            btn.classList.remove('activo');
        }
    });

    // Restaurar botones de stock
    document.querySelectorAll('.stock-botones .btn-filtro').forEach(btn => {
        const stock = btn.dataset.stock;
        if (filtrosStockActivos.has(stock)) {
            btn.classList.add('activo');
        } else {
            btn.classList.remove('activo');
        }
    });

    // Restaurar botones de sector
    document.querySelectorAll('.sectores-botones .btn-filtro').forEach(btn => {
        const sectorId = btn.dataset.sectorId;
        if (filtrosSectorActivos.has(sectorId)) {
            btn.classList.add('activo');
        } else {
            btn.classList.remove('activo');
        }
    });
}

// ✅ NUEVA FUNCIÓN PARA RECARGAR DATOS SIN PERDER FILTROS
async function recargarDatosMantenendoFiltros() {
    try {
        // Cargar datos frescos del servidor
        const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener los datos');
        }

        const datos = await response.json();

        // Actualizar lista completa y mix.js
        ingredientesOriginales = datos;
        window.actualizarListaIngredientes(datos);

        // Mapear es_mix a esMix para consistencia
        const ingredientesConEstado = datos.map(d => ({ ...d, esMix: d.es_mix }));

        ingredientesOriginales = ingredientesConEstado;

        // Aplicar filtros existentes sin reinicializar
        await actualizarTablaFiltrada();

    } catch (error) {
        console.error('❌ Error al recargar datos:', error);
        mostrarMensaje(error.message || 'No se pudieron recargar los datos');
    }
}

// Función para cargar sectores disponibles
async function cargarSectores() {
    try {
        const response = await fetch('http://localhost:3002/api/produccion/sectores');
        if (!response.ok) {
            throw new Error('Error al cargar sectores');
        }

        sectoresDisponibles = await response.json();

        // Actualizar selector de sectores en el modal
        actualizarSelectorSectores();

    } catch (error) {
        console.error('❌ Error al cargar sectores:', error);
        // No mostrar error al usuario, el selector quedará con opción por defecto
        sectoresDisponibles = [];
    }
}

// Función para actualizar el selector de sectores en el modal
function actualizarSelectorSectores() {
    const selectorSector = document.getElementById('sector');
    if (!selectorSector) return;

    // Limpiar opciones existentes
    selectorSector.innerHTML = '<option value="">Sin sector asignado</option>';

    // Agregar sectores disponibles
    sectoresDisponibles.forEach(sector => {
        const option = document.createElement('option');
        option.value = sector.id;
        option.textContent = sector.nombre;
        selectorSector.appendChild(option);
    });
}

// Funciones para gestionar el modal
async function abrirModal(titulo = 'Nuevo Ingrediente') {
    const modal = document.getElementById('modal-ingrediente');
    const modalTitulo = document.getElementById('modal-titulo');
    modalTitulo.textContent = titulo;
    modal.style.display = 'block';

    // Cargar sectores si no están cargados
    if (sectoresDisponibles.length === 0) {
        await cargarSectores();
    }

    // Si es un nuevo ingrediente, obtener el código automáticamente
    if (titulo === 'Nuevo Ingrediente') {
        try {
            const response = await fetch('http://localhost:3002/api/produccion/ingredientes/nuevo-codigo');
            if (response.ok) {
                const data = await response.json();
                document.getElementById('codigo').value = data.codigo;
            }
        } catch (error) {
            console.error('Error al obtener nuevo código:', error);
            // No mostrar error al usuario, el código se generará al guardar
        }
    }
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

// Función para inicializar los filtros de categorías, tipo y stock
function inicializarFiltros(ingredientes) {
    // ✅ INICIALIZAR TODOS LOS FILTROS VACÍOS
    filtrosActivos = new Set();
    filtrosTipoActivos = new Set();
    filtrosStockActivos = new Set();
    filtrosSectorActivos = new Set();

    // ===== FILTROS POR CATEGORÍA =====
    const categoriasContainer = document.getElementById('filtros-categorias-container');
    if (categoriasContainer) {
        categoriasContainer.innerHTML = '';

        // Obtener categorías únicas y ordenadas
        const categorias = [...new Set(ingredientes.map(ing => ing.categoria))]
            .filter(Boolean)
            .sort();

        // Crear botones de categoría
        const botonesCategorias = categorias.map(cat => {
            const btn = document.createElement('button');
            btn.textContent = cat;
            btn.className = 'btn-filtro';
            btn.onclick = async () => {
                if (btn.classList.contains('activo')) {
                    btn.classList.remove('activo');
                    filtrosActivos.delete(cat);
                } else {
                    btn.classList.add('activo');
                    filtrosActivos.add(cat);
                }
                await actualizarTablaFiltrada();
            };
            categoriasContainer.appendChild(btn);
            return btn;
        });

        // Botones globales de categorías
        const btnTodasCategorias = document.getElementById('btn-todas-categorias');
        const btnNingunaCategoria = document.getElementById('btn-ninguna-categoria');

        if (btnTodasCategorias) {
            btnTodasCategorias.onclick = async () => {
                filtrosActivos = new Set(categorias);
                botonesCategorias.forEach(btn => btn.classList.add('activo'));
                await actualizarTablaFiltrada();
            };
        }

        if (btnNingunaCategoria) {
            btnNingunaCategoria.onclick = async () => {
                filtrosActivos.clear();
                botonesCategorias.forEach(btn => btn.classList.remove('activo'));
                await actualizarTablaFiltrada();
            };
        }
    }

    // ===== FILTROS POR TIPO =====
    const tipoContainer = document.getElementById('filtros-tipo-container');
    if (tipoContainer) {
        tipoContainer.innerHTML = '';

        const tipos = [
            { id: 'simple', label: 'Ingrediente Simple' },
            { id: 'mix', label: 'Ingrediente Mix' }
        ];

        tipos.forEach(tipo => {
            const btn = document.createElement('button');
            btn.textContent = tipo.label;
            btn.className = 'btn-filtro';
            btn.dataset.tipo = tipo.id;
            btn.onclick = async () => {
                if (btn.classList.contains('activo')) {
                    btn.classList.remove('activo');
                    filtrosTipoActivos.delete(tipo.id);
                } else {
                    btn.classList.add('activo');
                    filtrosTipoActivos.add(tipo.id);
                }
                await actualizarTablaFiltrada();
            };
            tipoContainer.appendChild(btn);
        });
    }

    // ===== FILTROS POR STOCK =====
    const stockContainer = document.getElementById('filtros-stock-container');
    if (stockContainer) {
        stockContainer.innerHTML = '';

        const stocks = [
            { id: 'con-stock', label: 'Con Stock' },
            { id: 'sin-stock', label: 'Sin Stock' }
        ];

        stocks.forEach(stock => {
            const btn = document.createElement('button');
            btn.textContent = stock.label;
            btn.className = 'btn-filtro';
            btn.dataset.stock = stock.id;
            btn.onclick = async () => {
                if (btn.classList.contains('activo')) {
                    btn.classList.remove('activo');
                    filtrosStockActivos.delete(stock.id);
                } else {
                    btn.classList.add('activo');
                    filtrosStockActivos.add(stock.id);
                }
                await actualizarTablaFiltrada();
            };
            stockContainer.appendChild(btn);
        });
    }

    // ===== FILTROS POR SECTOR DE ALMACENAMIENTO =====
    const sectoresContainer = document.getElementById('filtros-sectores-container');
    if (sectoresContainer) {
        sectoresContainer.innerHTML = '';

        // Botón para "Sin sector asignado"
        const btnSinSector = document.createElement('button');
        btnSinSector.textContent = 'Sin Sector';
        btnSinSector.className = 'btn-filtro';
        btnSinSector.dataset.sectorId = 'sin-sector';
        btnSinSector.onclick = async () => {
            if (btnSinSector.classList.contains('activo')) {
                btnSinSector.classList.remove('activo');
                filtrosSectorActivos.delete('sin-sector');
            } else {
                btnSinSector.classList.add('activo');
                filtrosSectorActivos.add('sin-sector');
            }
            await actualizarTablaFiltrada();
        };
        sectoresContainer.appendChild(btnSinSector);

        // Botones para sectores disponibles
        sectoresDisponibles.forEach(sector => {
            const btn = document.createElement('button');
            btn.textContent = sector.nombre;
            btn.className = 'btn-filtro';
            btn.dataset.sectorId = sector.id.toString();
            btn.onclick = async () => {
                const sectorId = sector.id.toString();
                if (btn.classList.contains('activo')) {
                    btn.classList.remove('activo');
                    filtrosSectorActivos.delete(sectorId);
                } else {
                    btn.classList.add('activo');
                    filtrosSectorActivos.add(sectorId);
                }
                await actualizarTablaFiltrada();
            };
            sectoresContainer.appendChild(btn);
        });
    }
}

// ✅ FUNCIÓN AUXILIAR: Normalizar texto (eliminar tildes y caracteres especiales)
function normalizarTexto(texto) {
    if (!texto) return '';
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Eliminar tildes
        .trim();
}

// ✅ FUNCIÓN AUXILIAR: Formatear stock (máximo 3 decimales, sin ceros innecesarios)
function formatearStock(valor) {
    // Convertir a número y limitar a 3 decimales
    const numero = parseFloat(Number(valor).toFixed(3));
    // Retornar como string, eliminando ceros innecesarios a la derecha
    return numero.toString();
}

// Función para actualizar la tabla según los filtros activos combinados
async function actualizarTablaFiltrada() {
    // Solo aplicar filtros en la vista de depósito
    if (vistaActual === 'deposito') {
        const nombreFiltro = document.getElementById('filtro-nombre')?.value.trim() || '';

        // Si no hay filtros activos ni búsqueda, mostrar TODOS los ingredientes
        if (
            filtrosActivos.size === 0 &&
            filtrosTipoActivos.size === 0 &&
            filtrosStockActivos.size === 0 &&
            filtrosSectorActivos.size === 0 &&
            !nombreFiltro
        ) {
            await actualizarTablaIngredientes(ingredientesOriginales);
            return;
        }

        // Aplicar filtros combinados (AND lógico entre tipos de filtros, OR dentro de cada tipo)
        const ingredientesFiltrados = ingredientesOriginales.filter(ing => {
            // ✅ FILTRO POR NOMBRE: Búsqueda multi-término SOLO en nombre (sin descripción ni código)
            let pasaNombre = true;
            if (nombreFiltro) {
                // Dividir el input en términos (separados por espacios)
                const terminos = nombreFiltro
                    .split(/\s+/) // Dividir por uno o más espacios
                    .filter(t => t.length > 0) // Eliminar términos vacíos
                    .map(t => normalizarTexto(t)); // Normalizar cada término

                if (terminos.length > 0) {
                    // Normalizar SOLO el nombre del ingrediente
                    const nombreNormalizado = normalizarTexto(ing.nombre);

                    // Verificar que TODOS los términos estén presentes en el nombre
                    pasaNombre = terminos.every(termino => nombreNormalizado.includes(termino));
                }
            }

            // Filtro por categoría (si hay filtros de categoría activos)
            const pasaCategoria = filtrosActivos.size === 0 || filtrosActivos.has(ing.categoria);

            // Filtro por tipo (si hay filtros de tipo activos)
            let pasaTipo = filtrosTipoActivos.size === 0;
            if (filtrosTipoActivos.size > 0) {
                const esMixIngrediente = ing.esMix;
                if (filtrosTipoActivos.has('simple') && !esMixIngrediente) {
                    pasaTipo = true;
                }
                if (filtrosTipoActivos.has('mix') && esMixIngrediente) {
                    pasaTipo = true;
                }
            }

            // Filtro por stock (si hay filtros de stock activos)
            let pasaStock = filtrosStockActivos.size === 0;
            if (filtrosStockActivos.size > 0) {
                const stockActual = parseFloat(ing.stock_actual) || 0;
                const tolerancia = 0.001;

                if (filtrosStockActivos.has('con-stock') && stockActual > tolerancia) {
                    pasaStock = true;
                }
                if (filtrosStockActivos.has('sin-stock') && stockActual <= tolerancia) {
                    pasaStock = true;
                }
            }

            // Filtro por sector (si hay filtros de sector activos)
            let pasaSector = filtrosSectorActivos.size === 0;
            if (filtrosSectorActivos.size > 0) {
                const sectorId = ing.sector_id ? ing.sector_id.toString() : 'sin-sector';
                if (filtrosSectorActivos.has(sectorId)) {
                    pasaSector = true;
                }
            }

            // El ingrediente pasa si cumple TODOS los tipos de filtros activos
            return pasaCategoria && pasaTipo && pasaStock && pasaSector && pasaNombre;
        });

        await actualizarTablaIngredientes(ingredientesFiltrados);
    }
}

// Función para cargar los ingredientes según la vista actual
async function cargarIngredientes(usuarioId = null) {
    try {
        let response;

        if (usuarioId) {
            vistaActual = `usuario-${usuarioId}`;

            // 🛡️ LIMPIEZA DE ESTADO: Limpiar todos los filtros al cambiar a vista usuario
            filtrosActivos.clear();
            filtrosTipoActivos.clear();
            filtrosStockActivos.clear();
            filtrosSectorActivos.clear();

            // 🛡️ LIMPIEZA DE ESTADO: Limpiar campo de búsqueda por nombre
            const inputFiltroNombre = document.getElementById('filtro-nombre');
            if (inputFiltroNombre) {
                inputFiltroNombre.value = '';
            }

            response = await fetch(`http://localhost:3002/api/produccion/ingredientes/stock-usuario/${usuarioId}`);
        } else {
            vistaActual = 'deposito';
            response = await fetch('http://localhost:3002/api/produccion/ingredientes');
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener los datos');
        }

        const datos = await response.json();

        if (vistaActual === 'deposito') {
            // ==========================================
            // RAMA 1: VISTA DEPÓSITO (Inventario General)
            // ==========================================

            // Guardar lista completa y actualizar mix.js
            ingredientesOriginales = datos;
            window.actualizarListaIngredientes(datos);

            // Inicializar filtros
            inicializarFiltros(datos);

            // Verificar estado de mix para todos los ingredientes
            // OPTIMIZACIÓN: Backend calc
            const ingredientesConEstado = datos.map(d => ({ ...d, esMix: d.es_mix }));

            ingredientesOriginales = ingredientesConEstado;
            await actualizarTablaFiltrada();
        } else {
            // ==========================================
            // RAMA 2: VISTA USUARIO (Stock Personal)
            // ==========================================

            // 🛡️ NO guardar en ingredientesOriginales para evitar contaminación
            // 🛡️ NO llamar a inicializarFiltros()
            // 🛡️ NO llamar a actualizarTablaFiltrada()

            // Renderizar directamente la tabla con los datos del usuario
            await actualizarTablaIngredientes(datos, true);
        }

    } catch (error) {
        console.error('❌ Error:', error);
        mostrarMensaje(error.message || 'No se pudieron cargar los datos');
    }
}

// Función para crear selector de sectores inline
function crearSelectorSectorInline(ingredienteId, sectorActualId, sectorActualNombre) {
    const select = document.createElement('select');
    select.className = 'selector-sector-inline';
    select.dataset.ingredienteId = ingredienteId;
    select.dataset.sectorOriginal = sectorActualId || '';

    // Estilos inline para el selector
    select.style.cssText = `
        width: 100%;
        padding: 4px 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
        background-color: #fff;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
    `;

    // Opción por defecto
    const optionDefault = document.createElement('option');
    optionDefault.value = '';
    optionDefault.textContent = 'Sin asignar';
    select.appendChild(optionDefault);

    // Agregar sectores disponibles
    sectoresDisponibles.forEach(sector => {
        const option = document.createElement('option');
        option.value = sector.id;
        option.textContent = sector.nombre;
        select.appendChild(option);
    });

    // Establecer valor actual
    select.value = sectorActualId || '';

    // Evento de cambio para actualización inmediata
    select.addEventListener('change', async (e) => {
        await actualizarSectorIngrediente(ingredienteId, e.target.value, e.target);
    });

    // Efectos visuales
    select.addEventListener('focus', () => {
        select.style.borderColor = '#007bff';
        select.style.boxShadow = '0 0 0 0.2rem rgba(0,123,255,.25)';
    });

    select.addEventListener('blur', () => {
        select.style.borderColor = '#ddd';
        select.style.boxShadow = 'none';
    });

    return select;
}

// Función para actualizar sector de ingrediente con feedback visual
async function actualizarSectorIngrediente(ingredienteId, nuevoSectorId, selectorElement) {
    const sectorOriginal = selectorElement.dataset.sectorOriginal;

    try {
        // Feedback visual: deshabilitar selector y mostrar loading
        selectorElement.disabled = true;
        selectorElement.style.opacity = '0.6';
        selectorElement.style.cursor = 'wait';

        // Crear indicador de carga
        const loadingIndicator = document.createElement('span');
        loadingIndicator.textContent = '⏳';
        loadingIndicator.style.marginLeft = '5px';
        selectorElement.parentNode.appendChild(loadingIndicator);

        // Preparar datos para actualización
        const datos = {
            sector_id: nuevoSectorId || null
        };

        // Realizar petición de actualización
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteId}`, {
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

        // Éxito: actualizar estado y mostrar feedback
        selectorElement.dataset.sectorOriginal = nuevoSectorId || '';

        // Feedback visual de éxito
        selectorElement.style.borderColor = '#28a745';
        selectorElement.style.backgroundColor = '#f8fff9';

        // Mostrar mensaje de éxito discreto
        mostrarMensajeDiscretoSector('Sector actualizado', 'exito');

    } catch (error) {
        console.error('❌ Error al actualizar sector:', error);

        // Revertir cambio en caso de error
        selectorElement.value = sectorOriginal;

        // Feedback visual de error
        selectorElement.style.borderColor = '#dc3545';
        selectorElement.style.backgroundColor = '#fff5f5';

        // Mostrar mensaje de error
        mostrarMensajeDiscretoSector(error.message || 'Error al actualizar sector', 'error');

    } finally {
        // Restaurar estado del selector
        selectorElement.disabled = false;
        selectorElement.style.opacity = '1';
        selectorElement.style.cursor = 'pointer';

        // Remover indicador de carga
        const loadingIndicator = selectorElement.parentNode.querySelector('span');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }

        // Restaurar estilos después de 2 segundos
        setTimeout(() => {
            selectorElement.style.borderColor = '#ddd';
            selectorElement.style.backgroundColor = '#fff';
        }, 2000);
    }
}

// Función para mostrar mensajes discretos específicos para sectores
function mostrarMensajeDiscretoSector(mensaje, tipo = 'info') {
    // Remover mensaje anterior si existe
    const mensajeAnterior = document.querySelector('.mensaje-sector-discreto');
    if (mensajeAnterior) {
        mensajeAnterior.remove();
    }

    const mensajeDiv = document.createElement('div');
    mensajeDiv.className = 'mensaje-sector-discreto';

    // Estilos según el tipo
    const colores = {
        exito: { bg: '#d4edda', border: '#c3e6cb', text: '#155724' },
        error: { bg: '#f8d7da', border: '#f5c6cb', text: '#721c24' },
        info: { bg: '#d1ecf1', border: '#bee5eb', text: '#0c5460' }
    };

    const color = colores[tipo] || colores.info;

    mensajeDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: ${color.bg};
        border: 1px solid ${color.border};
        color: ${color.text};
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 14px;
        z-index: 1050;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        animation: slideInRight 0.3s ease-out;
    `;

    mensajeDiv.textContent = mensaje;
    document.body.appendChild(mensajeDiv);

    // Remover después de 3 segundos
    setTimeout(() => {
        mensajeDiv.style.animation = 'slideOutRight 0.3s ease-in';
        setTimeout(() => mensajeDiv.remove(), 300);
    }, 3000);
}

// Caché de nutrientes cargados
const cacheNutrientes = new Map();

// Función para invalidar caché de nutrientes
function invalidarCacheNutrientes(ingredienteId) {
    cacheNutrientes.delete(ingredienteId);
}

// Función para cargar nutrientes de un ingrediente
async function cargarNutrientes(ingredienteId) {
    // Verificar caché
    if (cacheNutrientes.has(ingredienteId)) {
        return cacheNutrientes.get(ingredienteId);
    }

    // Cargar del servidor
    const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteId}/nutrientes`);

    if (!response.ok) {
        throw new Error('Error al cargar nutrientes');
    }

    const nutrientes = await response.json();

    // Guardar en caché
    cacheNutrientes.set(ingredienteId, nutrientes);

    return nutrientes;
}

// Función para toggle de expandir/colapsar detalles de nutrientes
async function toggleDetallesNutrientes(ingredienteId, filaActual) {
    const filaDetalles = document.querySelector(`tr[data-detalles-id="${ingredienteId}"]`);
    const btnExpandir = filaActual.querySelector('.btn-expandir');
    const iconoExpandir = btnExpandir.querySelector('.icono-expandir');

    if (filaDetalles) {
        // Ya está expandido, colapsar
        filaDetalles.remove();
        iconoExpandir.textContent = '▶';
        iconoExpandir.style.transform = 'rotate(0deg)';
    } else {
        // Expandir y cargar datos
        iconoExpandir.textContent = '▼';
        iconoExpandir.style.transform = 'rotate(90deg)';

        try {
            // Cargar nutrientes del servidor
            const nutrientes = await cargarNutrientes(ingredienteId);

            // Crear fila de detalles
            const trDetalles = document.createElement('tr');
            trDetalles.dataset.detallesId = ingredienteId;
            trDetalles.className = 'fila-detalles-nutrientes';

            trDetalles.innerHTML = `
                <td colspan="11">
                    <div class="contenedor-detalles-nutrientes">
                        <h4>📦 Artículos que abastecen este ingrediente:</h4>
                        ${renderizarTablaNutrientes(nutrientes, ingredienteId)}
                    </div>
                </td>
            `;

            // Insertar después de la fila actual
            filaActual.after(trDetalles);
        } catch (error) {
            console.error('Error al cargar nutrientes:', error);
            mostrarMensaje('Error al cargar los artículos nutrientes');
            iconoExpandir.textContent = '▶';
            iconoExpandir.style.transform = 'rotate(0deg)';
        }
    }
}

// Función para renderizar tabla de nutrientes (diferencia entre SIMPLE y MIX)
function renderizarTablaNutrientes(respuesta, ingredienteId) {
    if (!respuesta || !respuesta.datos || respuesta.datos.length === 0) {
        return '<p class="sin-nutrientes">No hay datos disponibles para este ingrediente</p>';
    }

    const { tipo, datos } = respuesta;

    if (tipo === 'mix') {
        // Renderizar tabla para ingredientes MIX (componentes)
        return renderizarTablaMix(datos);
    } else {
        // Renderizar tabla para ingredientes SIMPLE (artículos)
        return renderizarTablaSimple(datos, ingredienteId);
    }
}

// Función para renderizar tabla de ingredientes SIMPLE (artículos nutrientes)
function renderizarTablaSimple(nutrientes, ingredienteId) {
    const totalPotencial = nutrientes
        .filter(n => n.activo)
        .reduce((sum, n) => sum + (parseFloat(n.kilos_potenciales) || 0), 0);

    return `
        <table class="tabla-nutrientes">
            <thead>
                <tr>
                    <th>Artículo</th>
                    <th>Stock (Bultos)</th>
                    <th>Kg/Bulto</th>
                    <th>Kilos Potenciales</th>
                    <th>Estado</th>
                    <th>Tipo</th>
                </tr>
            </thead>
            <tbody>
                ${nutrientes.map(n => `
                    <tr class="${!n.activo ? 'vinculo-inactivo' : ''}">
                        <td>${n.articulo_nombre || n.articulo_numero}</td>
                        <td>${formatearStock(n.stock_bultos || 0)}</td>
                        <td>${formatearStock(n.kilos_unidad || 0)}</td>
                        <td><strong>${formatearStock(n.kilos_potenciales || 0)}</strong></td>
                        <td>
                            <label class="switch-vinculo">
                                <input type="checkbox" 
                                       ${n.activo ? 'checked' : ''}
                                       onchange="toggleVinculo(${n.id}, this.checked, ${ingredienteId})">
                                <span class="slider"></span>
                            </label>
                        </td>
                        <td>
                            <span class="badge-tipo ${n.manual ? 'badge-manual' : 'badge-auto'}">
                                ${n.manual ? 'Manual' : 'Auto'}
                            </span>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
            <tfoot>
                <tr class="fila-total-potencial">
                    <td colspan="3"><strong>TOTAL POTENCIAL:</strong></td>
                    <td><strong>${formatearStock(totalPotencial)}</strong></td>
                    <td colspan="2"></td>
                </tr>
            </tfoot>
        </table>
    `;
}

// Función para renderizar tabla de ingredientes MIX (componentes)
function renderizarTablaMix(componentes) {
    // Encontrar el componente limitante (menor kilos_mix_posibles)
    const limitante = componentes.reduce((min, comp) => {
        const kilosPosibles = parseFloat(comp.kilos_mix_posibles) || 0;
        const minKilos = parseFloat(min.kilos_mix_posibles) || 0;
        return kilosPosibles < minKilos ? comp : min;
    }, componentes[0]);

    const stockPotencialMix = parseFloat(limitante?.kilos_mix_posibles) || 0;

    return `
        <div class="info-mix-producibilidad">
            <p class="info-limitante">
                ⚠️ <strong>Factor Limitante:</strong> ${limitante.componente_nombre} 
                (permite producir <strong>${formatearStock(stockPotencialMix)} kg</strong> de mix)
            </p>
        </div>
        <table class="tabla-nutrientes tabla-mix-componentes">
            <thead>
                <tr>
                    <th>Componente</th>
                    <th>Requerido en Receta</th>
                    <th>Stock Disponible</th>
                    <th>Kilos de Mix Posibles</th>
                </tr>
            </thead>
            <tbody>
                ${componentes.map(comp => {
        const esLimitante = comp.componente_id === limitante.componente_id;
        return `
                        <tr class="${esLimitante ? 'componente-limitante' : ''}">
                            <td>
                                ${esLimitante ? '🔴 ' : ''}
                                ${comp.componente_nombre}
                            </td>
                            <td>${formatearStock(comp.cantidad_requerida || 0)}</td>
                            <td>${formatearStock(comp.disponible_componente || 0)}</td>
                            <td>
                                <strong class="${esLimitante ? 'valor-limitante' : ''}">
                                    ${formatearStock(comp.kilos_mix_posibles || 0)}
                                </strong>
                            </td>
                        </tr>
                    `;
    }).join('')}
            </tbody>
            <tfoot>
                <tr class="fila-total-potencial">
                    <td colspan="3"><strong>PRODUCCIÓN MÁXIMA POSIBLE:</strong></td>
                    <td><strong>${formatearStock(stockPotencialMix)}</strong></td>
                </tr>
            </tfoot>
        </table>
    `;
}

// Función para toggle de vínculo activo/inactivo
async function toggleVinculo(vinculoId, nuevoEstado, ingredienteId) {
    try {
        const response = await fetch(
            `http://localhost:3002/api/produccion/ingredientes/nutrientes/${vinculoId}`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activo: nuevoEstado })
            }
        );

        if (!response.ok) {
            throw new Error('Error al actualizar vínculo');
        }

        // Invalidar caché de nutrientes
        invalidarCacheNutrientes(ingredienteId);

        // Recargar datos del ingrediente para actualizar stock potencial
        await recargarDatosMantenendoFiltros();

        // Actualizar la tabla de nutrientes expandida
        const filaActual = document.querySelector(`tr[data-id="${ingredienteId}"]`);
        if (filaActual) {
            // Colapsar y volver a expandir para refrescar datos
            await toggleDetallesNutrientes(ingredienteId, filaActual);
            await toggleDetallesNutrientes(ingredienteId, filaActual);
        }

        mostrarMensaje(
            `Vínculo ${nuevoEstado ? 'activado' : 'desactivado'} correctamente`,
            'exito'
        );
    } catch (error) {
        console.error('❌ [VINCULO] Error al toggle vínculo:', error);
        mostrarMensaje('Error al actualizar el vínculo');
    }
}

// Función para actualizar la tabla con los ingredientes
async function actualizarTablaIngredientes(ingredientes, esVistaUsuario = false) {
    const tbody = document.getElementById('tabla-ingredientes-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!ingredientes || ingredientes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center">No hay ingredientes disponibles</td></tr>';
        return;
    }

    // OPTIMIZACIÓN DOM: Usar DocumentFragment para evitar reflows por cada fila
    const fragment = document.createDocumentFragment();

    ingredientes.forEach(ingrediente => {
        const tr = document.createElement('tr');
        tr.dataset.id = ingrediente.id;

        if (esVistaUsuario) {
            // Vista de usuario: mostrar stock personal (sin botón expandir ni stock potencial)
            // 🔧 FIX: Usar ingrediente_id en lugar de id para vista de usuario
            const ingredienteIdReal = ingrediente.ingrediente_id || ingrediente.id;

            tr.innerHTML = `
                <td></td>
                <td>${ingrediente.nombre_ingrediente}</td>
                <td>${ingrediente.unidad_medida || '-'}</td>
                <td>${ingrediente.categoria || '-'}</td>
                <td>${parseFloat(ingrediente.stock_total).toFixed(3)}</td>
                <td>-</td>
                <td>-</td>
                <td>${ingrediente.descripcion || '-'}</td>
                <td>${ingrediente.tipo_origen || 'Simple'}</td>
                <td>-</td>
                
                <td style="text-align: center;">
                    <button class="btn-icon" 
                            onclick="window.abrirModalAjusteDesdeTabla(${ingredienteIdReal}, '${ingrediente.nombre_ingrediente.replace(/'/g, "\\'")}', ${ingrediente.stock_total}, ${ingredienteIdReal})"
                            title="Ajustar Stock Manualmente"
                            style="cursor:pointer; background:none; border:none; font-size:1.4em; transition: transform 0.2s;">
                          ✏️
                      
                    </button>
                </td>
            `;
        } else {
            // Vista de depósito: funcionalidad completa con stock potencial
            const nombreSector = ingrediente.sector_nombre || 'Sin asignar';
            const stockPotencial = parseFloat(ingrediente.stock_potencial) || parseFloat(ingrediente.stock_actual) || 0;
            const vinculosActivos = parseInt(ingrediente.vinculos_activos) || 0;

            // Crear fila
            tr.innerHTML = `
                <td class="td-expandir">
                    <button class="btn-expandir" data-ingrediente-id="${ingrediente.id}">
                        <span class="icono-expandir">▶</span>
                    </button>
                </td>
                <td>${ingrediente.nombre}</td>
                <td>${ingrediente.unidad_medida}</td>
                <td>${ingrediente.categoria}</td>
                <td>${formatearStock(ingrediente.stock_actual)}</td>
                <td class="stock-potencial">
                    ${formatearStock(stockPotencial)}
                    ${vinculosActivos > 0
                    ? `<span class="badge-vinculos">${vinculosActivos}</span>`
                    : ''}
                </td>
                <td class="sector-cell"></td>
                <td>${ingrediente.descripcion || '-'}</td>
                <td class="tipo-col">${ingrediente.esMix ? 'Ingrediente Mix' : 'Ingrediente Simple'}</td>
                <td>
                    ${ingrediente.esMix
                    ? `<div class="btn-group">
                            <button class="btn-editar" onclick="gestionarComposicionMix(${ingrediente.id})">Gestionar composición</button>
                            <button class="btn-eliminar" onclick="eliminarComposicionMix(${ingrediente.id})">Eliminar composición</button>
                           </div>`
                    : (!ingrediente.padre_id
                        ? `<button class="btn-editar" onclick="gestionarComposicionMix(${ingrediente.id})">Crear composición</button>`
                        : '-')}
                </td>
                <td>
                    <button class="btn-editar" onclick="editarIngrediente(${ingrediente.id})">Editar</button>
                    <button class="btn-eliminar" onclick="eliminarIngrediente(${ingrediente.id})">Eliminar</button>
                </td>
            `;

            // Agregar selector de sector inline en la celda correspondiente
            const sectorCell = tr.querySelector('.sector-cell');
            const selectorSector = crearSelectorSectorInline(
                ingrediente.id,
                ingrediente.sector_id,
                nombreSector
            );
            sectorCell.appendChild(selectorSector);

            // Agregar evento de expansión al botón
            const btnExpandir = tr.querySelector('.btn-expandir');
            btnExpandir.addEventListener('click', () => toggleDetallesNutrientes(ingrediente.id, tr));
        }

        fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);
}

// Función para crear un nuevo ingrediente
async function crearIngrediente(datos) {
    try {
        const response = await fetch('http://localhost:3002/api/produccion/ingredientes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datos)
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (errorData.error === 'El ingrediente ya existe') {
                mostrarMensaje('El ingrediente ya existe', 'error');
                return;
            }
            throw new Error(errorData.error || 'Error al crear el ingrediente');
        }

        const nuevoIngrediente = await response.json();
        await cargarIngredientes();
        mostrarMensaje('Ingrediente creado exitosamente', 'exito');

        // Mostrar botón de impresión después de crear
        document.getElementById('codigo').value = nuevoIngrediente.codigo;
        actualizarBotonImpresion();
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo crear el ingrediente');
    }
}

// Función para actualizar un ingrediente
async function actualizarIngrediente(id, datos) {
    try {
        guardarEstadoFiltros();
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${id}`, {
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

        await recargarDatosMantenendoFiltros();
        mostrarMensaje('Ingrediente actualizado exitosamente', 'exito');
        cerrarModal();
        restaurarEstadoFiltros();
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
        guardarEstadoFiltros();
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al eliminar el ingrediente');
        }

        await recargarDatosMantenendoFiltros();
        mostrarMensaje('Ingrediente eliminado exitosamente', 'exito');
        restaurarEstadoFiltros();
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo eliminar el ingrediente');
    }
}

// Función para editar un ingrediente
async function editarIngrediente(id) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${id}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener el ingrediente');
        }

        const ingrediente = await response.json();
        ingredienteEditando = ingrediente;

        // Llenar el formulario con los datos del ingrediente
        document.getElementById('ingrediente-id').value = ingrediente.id;
        document.getElementById('codigo').value = ingrediente.codigo || '';
        document.getElementById('nombre').value = ingrediente.nombre;
        document.getElementById('unidad-medida').value = ingrediente.unidad_medida;
        document.getElementById('categoria').value = ingrediente.categoria;
        document.getElementById('stock').value = ingrediente.stock_actual;
        document.getElementById('descripcion').value = ingrediente.descripcion || '';

        // Cargar sector si existe
        const selectorSector = document.getElementById('sector');
        if (selectorSector) {
            selectorSector.value = ingrediente.sector_id || '';
        }

        abrirModal('Editar Ingrediente');
        actualizarBotonImpresion();
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo cargar el ingrediente para editar');
    }
}

// Función para imprimir etiqueta
async function imprimirEtiqueta(ingrediente) {
    try {
        // Llamar a App Etiquetas en puerto 3000
        const response = await fetch('http://localhost:3000/api/etiquetas/ingrediente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nombre: ingrediente.nombre,
                codigo: ingrediente.codigo,
                sector: ingrediente.sector // Enviar la letra del sector procesada
            })
        });

        if (!response.ok) {
            throw new Error('Error al imprimir etiqueta');
        }

        mostrarMensaje('Etiqueta enviada a imprimir', 'exito');
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo imprimir la etiqueta');
    }
}

// Función para actualizar visibilidad del botón de impresión
function actualizarBotonImpresion() {
    const btnImprimir = document.getElementById('btn-imprimir');
    const codigo = document.getElementById('codigo').value;

    if (btnImprimir) {
        btnImprimir.style.display = codigo ? 'block' : 'none';
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {

    // Configurar botón de impresión
    const btnImprimir = document.getElementById('btn-imprimir');
    if (btnImprimir) {
        btnImprimir.addEventListener('click', () => {
            const codigo = document.getElementById('codigo').value;
            const nombre = document.getElementById('nombre').value;
            const sectorId = document.getElementById('sector').value;

            // Lógica de extracción de letra (replicada de mantenimiento.js y guardadoIngredientes.js)
            let sectorLetra = '';

            if (sectorId && sectoresDisponibles.length > 0) {
                const sectorObj = sectoresDisponibles.find(s => s.id == sectorId);
                if (sectorObj) {
                    // 1. Intentar extrar de descripción ("Sector K") o comillas
                    const extraerLetra = (desc, nombre) => {
                        if (desc) {
                            const match = desc.match(/["']([^"']+)["']/);
                            if (match && match[1]) return match[1].toUpperCase();
                        }
                        if (nombre) {
                            const matchNombre = nombre.match(/Sector\s*["']?([A-Z0-9]{1,2})["']?/i);
                            if (matchNombre && matchNombre[1]) return matchNombre[1].toUpperCase();
                        }
                        return null;
                    };

                    sectorLetra = extraerLetra(sectorObj.descripcion, sectorObj.nombre) || sectorObj.nombre;
                }
            }

            if (codigo && nombre) {
                imprimirEtiqueta({ codigo, nombre, sector: sectorLetra });
            }
        });
    }

    //Filtro por nombre -Mari
    document.getElementById('filtro-nombre').addEventListener('input', () => {
        actualizarTablaFiltrada();
    });


    // Cargar sectores disponibles al inicializar
    await cargarSectores();

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

        // Obtener valor del sector
        const sectorValue = document.getElementById('sector').value;

        const datos = {
            codigo: document.getElementById('codigo').value,
            nombre: document.getElementById('nombre').value,
            unidad_medida: document.getElementById('unidad-medida').value,
            categoria: document.getElementById('categoria').value,
            stock_actual: Number(document.getElementById('stock').value.replace(',', '.')),
            descripcion: document.getElementById('descripcion').value,
            padre_id: ingredienteEditando ? ingredienteEditando.padre_id : null,
            sector_id: sectorValue || null // Incluir sector_id, null si no hay selección
        };

        if (ingredienteEditando) {
            await actualizarIngrediente(ingredienteEditando.id, datos);
        } else {
            await crearIngrediente(datos);
        }
    });
});

// Función para eliminar la composición de un mix
async function eliminarComposicionMix(id) {
    if (!confirm('¿Está seguro de eliminar la composición de este mix? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        guardarEstadoFiltros();

        // Usar el nuevo endpoint que elimina toda la composición y actualiza receta_base_kg
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${id}/composicion`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error al eliminar la composición');
        }

        // Recargar la tabla manteniendo filtros
        await recargarDatosMantenendoFiltros();
        mostrarMensaje('Composición eliminada exitosamente', 'exito');
        restaurarEstadoFiltros();
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo eliminar la composición');
    }
}

// Hacer funciones disponibles globalmente
window.editarIngrediente = editarIngrediente;
window.eliminarIngrediente = eliminarIngrediente;
window.gestionarComposicionMix = gestionarComposicionMix;
window.eliminarComposicionMix = eliminarComposicionMix;
window.cargarIngredientes = cargarIngredientes;
window.toggleVinculo = toggleVinculo;

// Funciones para gestionar el modal de mix
function gestionarComposicionMix(id) {
    const modalMix = document.getElementById('modal-mix');
    modalMix.style.display = 'block';

    // Llamar a la función de mix.js para cargar la composición
    window.abrirEdicionMix(id);
}


//Funcion para gestionar la apertura reiterada de ventanas - Mari
// Objeto para guardar referencias a las ventanas abiertas
const ventanasAbiertas = {};



// Función general para abrir o reutilizar ventanas
function abrirVentana(url, nombreVentana) {
    if (ventanasAbiertas[nombreVentana] && !ventanasAbiertas[nombreVentana].closed) {
        // Si ya está abierta y no fue cerrada, simplemente la enfocamos
        ventanasAbiertas[nombreVentana].focus();
    } else {
        // Si no existe o fue cerrada, la abrimos y guardamos la referencia
        ventanasAbiertas[nombreVentana] = window.open(url, nombreVentana);
    }
}
//Hago global la funcion abrirVentana 
window.abrirVentana = abrirVentana;

// ==========================================
// FUNCIÓN GLOBAL: ABRIR MODAL DE AJUSTE (INYECTADA)
// ==========================================
window.abrirModalAjusteDesdeTabla = async function (dummy, nombreIngrediente, stockActual, ingredienteIdReal) {

    let usuarioId = null;

    if (vistaActual.startsWith('usuario-')) {
        usuarioId = parseInt(vistaActual.replace('usuario-', ''));
    } else {
        const sectorActivo = document.querySelector('.sector-item.activo[data-usuario-id]');
        if (sectorActivo) {
            usuarioId = parseInt(sectorActivo.dataset.usuarioId);
        }
    }

    if (!usuarioId) {
        alert('❌ Error: No se pudo detectar el usuario activo.');
        return;
    }

    // 🔧 NUEVO ENFOQUE: Usar data-attributes en el modal en lugar de selector global
    const modalAjuste = document.getElementById('modalAjusteKilos');
    if (modalAjuste) {
        modalAjuste.dataset.usuarioActivo = usuarioId;
        modalAjuste.dataset.origenContexto = 'vista_stock_personal';
    }

    // 🔧 MANTENER COMPATIBILIDAD: Crear selector solo si no existe (para no romper código existente)
    let selectorFiltro = document.getElementById('filtro-usuario');
    if (!selectorFiltro) {
        selectorFiltro = document.createElement('select');
        selectorFiltro.id = 'filtro-usuario';
        selectorFiltro.style.display = 'none';
        selectorFiltro.dataset.origen = 'ingredientes-vista'; // Marcar origen
        document.body.appendChild(selectorFiltro);
    }

    // Solo actualizar si el selector es de esta vista
    if (selectorFiltro.dataset.origen === 'ingredientes-vista' || !selectorFiltro.dataset.origen) {
        let optionExistente = Array.from(selectorFiltro.options).find(opt => opt.value === usuarioId.toString());

        if (!optionExistente) {
            selectorFiltro.innerHTML = '';
            const option = document.createElement('option');
            option.value = usuarioId;
            option.textContent = usuarioId;
            option.selected = true;
            selectorFiltro.appendChild(option);
        } else {
            optionExistente.selected = true;
        }
        selectorFiltro.value = usuarioId;
    }

    if (typeof window.abrirModalAjusteRapido === 'function') {
        window.abrirModalAjusteRapido(ingredienteIdReal, nombreIngrediente, stockActual, null);

        const actualizarOriginal = window.actualizarResumenIngredientes;
        window.actualizarResumenIngredientes = async function () {
            await cargarIngredientes(usuarioId);
            window.actualizarResumenIngredientes = actualizarOriginal;
        };
    } else {
        console.error('❌ window.abrirModalAjusteRapido no está definida.');
        alert('❌ Error: El módulo de ajustes no está cargado correctamente. Recarga la página con Ctrl+F5.');
    }
};
