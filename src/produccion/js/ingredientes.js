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
    console.log('💾 Guardando estado actual de filtros antes de la acción');
    estadoFiltrosGuardado = {
        categorias: new Set(filtrosActivos),
        tipos: new Set(filtrosTipoActivos),
        stocks: new Set(filtrosStockActivos),
        sectores: new Set(filtrosSectorActivos)
    };
    console.log('✅ Estado guardado:', {
        categorias: Array.from(estadoFiltrosGuardado.categorias),
        tipos: Array.from(estadoFiltrosGuardado.tipos),
        stocks: Array.from(estadoFiltrosGuardado.stocks),
        sectores: Array.from(estadoFiltrosGuardado.sectores)
    });
}

function restaurarEstadoFiltros() {
    if (!estadoFiltrosGuardado) {
        console.log('⚠️ No hay estado de filtros guardado para restaurar');
        return;
    }
    
    console.log('🔄 Restaurando estado de filtros después de la acción');
    
    // Restaurar los Sets de filtros
    filtrosActivos = new Set(estadoFiltrosGuardado.categorias);
    filtrosTipoActivos = new Set(estadoFiltrosGuardado.tipos);
    filtrosStockActivos = new Set(estadoFiltrosGuardado.stocks);
    filtrosSectorActivos = new Set(estadoFiltrosGuardado.sectores);
    
    // Restaurar estado visual de los botones
    restaurarEstadoVisualFiltros();
    
    console.log('✅ Estado de filtros restaurado:', {
        categorias: Array.from(filtrosActivos),
        tipos: Array.from(filtrosTipoActivos),
        stocks: Array.from(filtrosStockActivos),
        sectores: Array.from(filtrosSectorActivos)
    });
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
        console.log('🔄 Recargando datos y manteniendo filtros activos...');
        
        // Cargar datos frescos del servidor
        const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener los datos');
        }

        const datos = await response.json();
        console.log('✅ Datos frescos recibidos:', datos.length, 'ingredientes');
        
        // Actualizar lista completa y mix.js
        ingredientesOriginales = datos;
        window.actualizarListaIngredientes(datos);
        
        // Verificar estado de mix para todos los ingredientes
        const ingredientesConEstado = await Promise.all(datos.map(async (ingrediente) => {
            const tieneMix = await esMix(ingrediente.id);
            return { ...ingrediente, esMix: tieneMix };
        }));
        
        ingredientesOriginales = ingredientesConEstado;
        
        // Aplicar filtros existentes sin reinicializar
        await actualizarTablaFiltrada();
        
        console.log('✅ Datos recargados manteniendo filtros activos');
        
    } catch (error) {
        console.error('❌ Error al recargar datos:', error);
        mostrarMensaje(error.message || 'No se pudieron recargar los datos');
    }
}

// Función para cargar sectores disponibles
async function cargarSectores() {
    try {
        console.log('🔄 Cargando sectores disponibles...');
        const response = await fetch('http://localhost:3002/api/produccion/sectores');
        if (!response.ok) {
            throw new Error('Error al cargar sectores');
        }
        
        sectoresDisponibles = await response.json();
        console.log('✅ Sectores cargados:', sectoresDisponibles);
        
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

// Función para inicializar los filtros de categorías, tipo y stock (ADAPTADA AL NUEVO LAYOUT)
function inicializarFiltros(ingredientes) {
    console.log('🔧 Inicializando filtros en panel lateral con acordeones');

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

    console.log('✅ Filtros inicializados en panel lateral');
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
            console.log('🔄 No hay filtros activos - mostrando todos los ingredientes');
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
            return pasaCategoria && pasaTipo && pasaStock && pasaSector && pasaNombre; //Modificacion Mari &&pasaNombre
        });

        // Log detallado de filtros activos
        const filtrosInfo = [];
        if (filtrosActivos.size > 0) {
            filtrosInfo.push(`Categorías: ${Array.from(filtrosActivos).join(', ')}`);
        }
        if (filtrosTipoActivos.size > 0) {
            filtrosInfo.push(`Tipos: ${Array.from(filtrosTipoActivos).join(', ')}`);
        }
        if (filtrosStockActivos.size > 0) {
            filtrosInfo.push(`Stock: ${Array.from(filtrosStockActivos).join(', ')}`);
        }
        if (filtrosSectorActivos.size > 0) {
            filtrosInfo.push(`Sectores: ${Array.from(filtrosSectorActivos).join(', ')}`);
        }
        
        console.log(`🔄 Filtros combinados activos: ${filtrosInfo.join(' | ')} - mostrando ${ingredientesFiltrados.length} ingredientes`);
        await actualizarTablaIngredientes(ingredientesFiltrados);
    }
}

// Función para cargar los ingredientes según la vista actual
async function cargarIngredientes(usuarioId = null) {
    try {
        let response;
        console.log(`🔄 Cargando ${usuarioId ? 'stock de usuario' : 'ingredientes del depósito'}...`);
        
        if (usuarioId) {
            vistaActual = `usuario-${usuarioId}`;
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
        console.log('✅ Datos recibidos:', datos);
        
        if (vistaActual === 'deposito') {
            // Guardar lista completa y actualizar mix.js
            ingredientesOriginales = datos;
            window.actualizarListaIngredientes(datos);
            
            // Inicializar filtros
            inicializarFiltros(datos);
            
            // Verificar estado de mix para todos los ingredientes
            const ingredientesConEstado = await Promise.all(datos.map(async (ingrediente) => {
                const tieneMix = await esMix(ingrediente.id);
                return { ...ingrediente, esMix: tieneMix };
            }));
            
            ingredientesOriginales = ingredientesConEstado;
            await actualizarTablaFiltrada();
        } else {
            // Vista de usuario: mostrar directamente sin filtros
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
        console.log(`🔄 Actualizando sector del ingrediente ${ingredienteId} a sector ${nuevoSectorId || 'sin asignar'}`);
        
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
        
        console.log(`✅ Sector actualizado exitosamente para ingrediente ${ingredienteId}`);
        
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

// Función para actualizar la tabla con los ingredientes
async function actualizarTablaIngredientes(ingredientes, esVistaUsuario = false) {
    const tbody = document.getElementById('tabla-ingredientes-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!ingredientes || ingredientes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No hay ingredientes disponibles</td></tr>';
        return;
    }

    ingredientes.forEach(ingrediente => {
        const tr = document.createElement('tr');
        tr.dataset.id = ingrediente.id;
        
        if (esVistaUsuario) {
            // Vista de usuario: mostrar stock personal
            tr.innerHTML = `
                <td>${ingrediente.nombre_ingrediente}</td>
                <td>${ingrediente.unidad_medida || '-'}</td>
                <td>${ingrediente.categoria || '-'}</td>
                <td>${parseFloat(ingrediente.stock_total).toFixed(3)}</td>
                <td>-</td>
                <td>${ingrediente.descripcion || '-'}</td>
                <td>${ingrediente.tipo_origen || 'Simple'}</td>
                <td>-</td>
                <td><span style="color: #6c757d; font-style: italic;">Solo lectura</span></td>
            `;
        } else {
            // Vista de depósito: funcionalidad completa
            const nombreSector = ingrediente.sector_nombre || 'Sin asignar';
            
            // Crear fila
            tr.innerHTML = `
                <td>${ingrediente.nombre}</td>
                <td>${ingrediente.unidad_medida}</td>
                <td>${ingrediente.categoria}</td>
                <td>${formatearStock(ingrediente.stock_actual)}</td>
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
        }
        
        tbody.appendChild(tr);
    });
}

// Función para crear un nuevo ingrediente
async function crearIngrediente(datos) {
    try {
        console.log('Creando ingrediente:', datos);
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
        console.log('Actualizando ingrediente:', id, datos);
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
        console.log('Eliminando ingrediente:', id);
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
        console.log('Obteniendo ingrediente para editar:', id);
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
                codigo: ingrediente.codigo
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
    console.log('Página cargada, inicializando...');

    // Configurar botón de impresión
    const btnImprimir = document.getElementById('btn-imprimir');
    if (btnImprimir) {
        btnImprimir.addEventListener('click', () => {
            const codigo = document.getElementById('codigo').value;
            const nombre = document.getElementById('nombre').value;
            
            if (codigo && nombre) {
                imprimirEtiqueta({ codigo, nombre });
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
        console.log('Formulario enviado');

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

        console.log('Datos a enviar:', datos);

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
        console.log('🗑️ Eliminando composición del mix:', id);
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
