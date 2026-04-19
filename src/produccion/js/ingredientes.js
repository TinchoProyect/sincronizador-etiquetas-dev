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
            { id: 'sin-stock', label: 'Sin Stock' },
            { id: 'stock-negativo', label: 'Con Stock Negativo' }
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
        // Revisar dinámicamente si existe algún ingrediente huérfano antes de ofrecer el botón
        const hayIngredientesRotos = ingredientesOriginales.some(ing => !ing.sector_id);

        if (hayIngredientesRotos) {
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
        }


        // Botones para sectores disponibles ordenados alfabéticamente
        const sectoresOrdenados = [...sectoresDisponibles].sort((a, b) => {
            const labelA = (window.extraerLetraPura(a.descripcion) || a.nombre).toUpperCase();
            const labelB = (window.extraerLetraPura(b.descripcion) || b.nombre).toUpperCase();
            return labelA.localeCompare(labelB);
        });

        sectoresOrdenados.forEach(sector => {
            const btn = document.createElement('button');
            const letraPura = window.extraerLetraPura(sector.descripcion);
            btn.textContent = letraPura ? letraPura : sector.nombre;
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

// ✅ FUNCIÓN AUXILIAR: Extraer Letra Pura Limpia de un Sector (Ej: 'Sector "J"' -> 'J')
window.extraerLetraPura = function(descripcion) {
    if (!descripcion) return '';
    const texto = descripcion.replace(/["']/g, '').trim();
    if (!texto) return '';

    // Nivel 1: Regex permisivo que soporta errores como "Sectro G"
    const matchSector = texto.match(/Sect[a-z]*\s+([A-Z0-9]{1,2})/i);
    if (matchSector) {
        return matchSector[1].toUpperCase();
    }

    // Nivel 2: Texto de longitud exacta (Ej: "G")
    if (texto.length > 0 && texto.length <= 2) {
        return texto.toUpperCase();
    }

    // Nivel 3: Aislado, una letra o 2 en el contexto de la oracion
    const matchLetra = texto.match(/\b([A-Z0-9]{1,2})\b/i);
    if (matchLetra) {
        return matchLetra[1].toUpperCase();
    }

    // Nivel 4: Ultima instancia, primer character de "Mix Salado" -> "M"
    return texto.charAt(0).toUpperCase();
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

// ✅ FUNCIÓN AUXILIAR: Determinar color semántico posterior a redondeo matemático
window.obtenerColorStock = function(valor) {
    if (valor === null || valor === undefined || valor === '') return '#3b82f6';
    
    let strVal = String(valor).replace(',', '.');
    let num = parseFloat(strVal);
    
    // Neutralidad por defecto
    if (isNaN(num)) return '#3b82f6';

    // Sincronía estricta con el renderizado visual (Si la pantalla muestra un Cero visual, forzar el Azul)
    let textoRenderizado = window.formatearStock ? window.formatearStock(valor) : num.toFixed(3);
    if (textoRenderizado === "0" || textoRenderizado === "0,000" || textoRenderizado === "-0" || 
        textoRenderizado === "-0,000" || textoRenderizado === "0.000" || textoRenderizado === "-0.000") {
        return '#3b82f6';
    }
    
    // Eliminación del "cero fantasmal": Todo número infinitesimal menor al rango visual de 3 decimales se trata como cero
    if (Math.abs(num) < 0.0005) {
        return '#3b82f6'; // Azul = Neutral / Cero
    }
    
    if (num > 0) return '#16a34a';   // Verde = Positivo
    return '#dc2626';                // Rojo = Negativo / Alerta
};

// ✅ FUNCIÓN AUXILIAR: Formatear stock (máximo 3 decimales, coma estructurada)
function formatearStock(valor) {
    if (valor === null || valor === undefined || valor === '') return "0";
    // Convertir a número y limitar a 3 decimales
    let numero = parseFloat(Number(valor).toFixed(3));
    // Corrección del bug del "cero negativo" proveniente de matemáticas de coma flotante
    if (Object.is(numero, -0)) numero = 0;
    // Retornar en string con coma como separador decimal
    return numero.toString().replace('.', ',');
}
// Exportamos para que los template literals de HTML inyectado puedan usarlo
window.formatearStock = formatearStock;

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
                // Alineación simétrica ABSOLUTA con window.obtenerColorStock para consistencia visual
                let colorAsignado = window.obtenerColorStock ? window.obtenerColorStock(ing.stock_actual) : '';

                if (filtrosStockActivos.has('con-stock') && colorAsignado === '#16a34a') {
                    pasaStock = true;
                }
                if (filtrosStockActivos.has('sin-stock') && colorAsignado === '#3b82f6') {
                    pasaStock = true;
                }
                if (filtrosStockActivos.has('stock-negativo') && colorAsignado === '#dc2626') {
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
    const container = document.getElementById('tabla-ingredientes-body');
    if (!container) return;

    container.innerHTML = '';

    if (!ingredientes || ingredientes.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:2rem; color:#6c757d;">No hay ingredientes disponibles</div>';
        return;
    }

    const fragment = document.createDocumentFragment();

    if (esVistaUsuario) {
        const groupContent = document.createElement('div');
        groupContent.className = 'sector-group-content';

        ingredientes.forEach(ingrediente => {
            const ingredienteIdReal = ingrediente.ingrediente_id || ingrediente.id;
            const esMix = ingrediente.esMix || ingrediente.tipo_origen === 'Mix';
            const mixButtons = esMix
                ? `<button class="btn-tarjeta primary" onclick="if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})">📋 Fórmula</button>`
                : `<button class="btn-tarjeta primary" style="padding: 8px 12px;" onclick="if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})" title="Crear Fórmula">➕🧪</button>`;
                
            const card = document.createElement('div');
            const isChecked = window.ingredientesAjusteSeleccionados && window.ingredientesAjusteSeleccionados.has(ingredienteIdReal);
            card.className = `tarjeta-ingrediente ${ingrediente.stock_total <= 0 ? 'con-stock-cero' : ''} ${isChecked ? 'tarjeta-seleccionada' : ''}`;
            
            card.innerHTML = `
            <div class="tarjeta-cuerpo" style="position: relative; padding: 6px 10px;">
                <div class="tarjeta-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; padding: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
                        <input type="checkbox" class="checkbox-ajuste" data-id="${ingredienteIdReal}" onchange="window.toggleSeleccionAjuste(this)" ${isChecked ? "checked" : ""}>
                        <h3 class="tarjeta-titulo" style="margin: 0; font-size: 1rem; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${ingrediente.nombre_ingrediente || ingrediente.nombre}">${ingrediente.nombre_ingrediente || ingrediente.nombre}</h3>
                    </div>
                    <span class="tarjeta-codigo" style="margin: 0 0 0 8px; font-size: 0.8rem; flex-shrink: 0;">${ingrediente.codigo || '-'}</span>
                </div>
                ${ingrediente.descripcion ? `<p class="tarjeta-descripcion" title="${ingrediente.descripcion}" style="margin-bottom: 4px; font-size: 0.75rem; line-height: 1.1;">${ingrediente.descripcion}</p>` : `<p class="tarjeta-descripcion" style="display: none;">-</p>`}

                <div class="tarjeta-stats" style="margin: 0; padding: 0;">
                    <div class="stat-item ${parseFloat(ingrediente.stock_total) <= 0 ? 'stock-cero' : ''}" style="display: flex; flex-direction: row; flex-wrap: nowrap; justify-content: space-between; align-items: baseline; margin-bottom: 0px; padding: 2px 4px;">
                        <span class="stat-label" style="font-size: 0.70rem; color: #64748b; font-weight: 700; margin: 0; width: auto !important; flex-shrink: 0; display: inline-block;">STOCK ASIGNADO</span>
                        <span class="stat-value" style="font-size: 1.5rem; font-weight: 900; line-height: 1; margin: 0; width: auto !important; text-align: right; display: inline-block; white-space: nowrap;">
                            ${window.formatearStock ? window.formatearStock(ingrediente.stock_total) : parseFloat(ingrediente.stock_total).toFixed(3)} 
                            <small style="font-size: 0.85rem; font-weight: 600; color: #64748b;">${ingrediente.unidad_medida}</small>
                        </span>
                    </div>
                </div>
            </div>
            
            <div class="tarjeta-footer">
                ${mixButtons}
                <button class="btn-tarjeta action" onclick="if(window.editarIngrediente) editarIngrediente(${ingredienteIdReal})" title="Editar Detalles y Stock Restante">✏️ Editar</button>
                <button class="btn-tarjeta" style="background:#fef2f2; color:#b91c1c;" onclick="window.iniciarTrasladoIngrediente('${ingredienteIdReal}', '${(ingrediente.nombre_ingrediente || ingrediente.nombre).replace(/'/g, "\\'")}')" title="Enviar a Cuarentena">🏥 Mover</button>
            </div>`;
            groupContent.appendChild(card);
        });
        fragment.appendChild(groupContent);
    } else {
        // Vista de depósito: Agrupar por sector
        const grupos = {};
        
        ingredientes.forEach(ingrediente => {
            const nombreSector = ingrediente.sector_nombre || 'Sin asignar';
            if (!grupos[nombreSector]) {
                grupos[nombreSector] = [];
            }
            grupos[nombreSector].push(ingrediente);
        });

        const gruposArray = Object.entries(grupos).map(([nombreSector, items]) => {
            const letraBackend = items[0] && items[0].sector_letra ? items[0].sector_letra : '';
            return { nombreSector, items, sector_letra: letraBackend };
        });
        
        // Ordenar alfabéticamente priorizando la letra pura del sector (A, B, C...)
        gruposArray.sort((a, b) => {
            const letraA = window.extraerLetraPura(a.items[0] && a.items[0].sector_descripcion) || a.nombreSector;
            const letraB = window.extraerLetraPura(b.items[0] && b.items[0].sector_descripcion) || b.nombreSector;
            return letraA.localeCompare(letraB);
        });

        for (const {nombreSector, items, sector_letra} of gruposArray) {
            const groupHeader = document.createElement('div');
            groupHeader.className = 'sector-group-header';
            
            const nombreLimpio = nombreSector.replace(/'/g, "\\'");
            let displayIzquierda = "";
            let displayCentro = "";
            let isLetter = false;

            // Extraer la letra limpita si está presente en la base de datos
            const desc = items[0] ? items[0].sector_descripcion : '';
            const letraPura = window.extraerLetraPura(desc);

            if (letraPura) {
                displayIzquierda = letraPura;
                displayCentro = nombreSector; // título al medio
                isLetter = true;
            } else {
                displayIzquierda = "";  // vacío si no hay letra
                displayCentro = nombreSector; 
            }

            groupHeader.innerHTML = `
                <div class="sector-header-flex" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div class="header-izq" style="font-size: 1.8rem; font-weight: 900; color: #0f172a; min-width: 120px; text-align: left;">
                        ${displayIzquierda}
                    </div>
                    <div class="header-centro" style="font-size: 1.4rem; font-weight: 700; color: #334155; text-align: center; flex: 1; text-transform: uppercase;">
                        ${displayCentro}
                    </div>
                    <div class="header-der" style="min-width: 120px; text-align: right;">
                        <button class="btn-imprimir-cartel" onclick="if(window.imprimirCartelSector) window.imprimirCartelSector('${isLetter ? letraPura : ''}', '${nombreLimpio}')">
                            🖨️ Cartel A4
                        </button>
                    </div>
                </div>`;

            fragment.appendChild(groupHeader);

            const groupContent = document.createElement('div');
            groupContent.className = 'sector-group-content';
            
            items.forEach(ingrediente => {
                const ingredienteIdReal = ingrediente.ingrediente_id || ingrediente.id;
                
                const card = document.createElement('div');
                const isChecked = window.ingredientesAjusteSeleccionados && window.ingredientesAjusteSeleccionados.has(ingredienteIdReal);
                card.className = `tarjeta-ingrediente ${(ingrediente.stock_actual <= 0 && ingrediente.stock_potencial <= 0) ? 'con-stock-cero' : ''} ${isChecked ? 'tarjeta-seleccionada' : ''}`;
                
                card.innerHTML = `
                <div class="tarjeta-cuerpo" style="position: relative; padding: 6px 10px;">
                    <div class="tarjeta-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; padding: 0;">
                        <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
                            <input type="checkbox" class="checkbox-ajuste" data-id="${ingredienteIdReal}" onchange="window.toggleSeleccionAjuste(this)" ${isChecked ? "checked" : ""}>
                            <h3 class="tarjeta-titulo" style="margin: 0; font-size: 1rem; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${ingrediente.nombre_ingrediente || ingrediente.nombre}">${ingrediente.nombre_ingrediente || ingrediente.nombre}</h3>
                        </div>
                        <span class="tarjeta-codigo" style="margin: 0 0 0 8px; font-size: 0.8rem; flex-shrink: 0;">${ingrediente.codigo || '-'}</span>
                    </div>
                    ${ingrediente.descripcion ? `<p class="tarjeta-descripcion" title="${ingrediente.descripcion}" style="margin-bottom: 4px; font-size: 0.75rem; line-height: 1.1;">${ingrediente.descripcion}</p>` : `<p class="tarjeta-descripcion" style="display: none;">-</p>`}

                    <div class="tarjeta-stats" style="display: flex; flex-direction: column; gap: 0; margin: 0; padding: 0;">
                        <!-- STOCK FÍSICO: Header y Valor Horizontal -->
                        <div class="stat-item ${ingrediente.stock_actual < 0 ? 'stock-cero' : ''}" style="display: flex; flex-direction: row; flex-wrap: nowrap; justify-content: space-between; align-items: baseline; margin-bottom: 0px; padding: 2px 4px;">
                            <span class="stat-label" style="font-size: 0.70rem; color: #64748b; font-weight: 700; letter-spacing: 0.5px; margin: 0; width: auto !important; flex-shrink: 0; display: inline-block;">STOCK FÍSICO</span>
                            <span class="stat-value" style="font-size: 1.6rem; font-weight: 900; color: ${window.obtenerColorStock ? window.obtenerColorStock(ingrediente.stock_actual) : '#3b82f6'}; line-height: 1; margin: 0; width: auto !important; text-align: right; display: inline-block; white-space: nowrap;">
                                ${window.formatearStock ? window.formatearStock(ingrediente.stock_actual) : ingrediente.stock_actual} 
                                <small style="font-size: 0.85rem; font-weight: 600; color: #64748b;">${ingrediente.unidad_medida}</small>
                            </span>
                        </div>
                        <!-- STOCK POTENCIAL: Texto descriptivo y numérico forzados en una única línea block -->
                        <div style="display: flex; flex-direction: row; flex-wrap: nowrap; justify-content: space-between; align-items: baseline; padding: 2px 4px; border-top: 1px dashed #cbd5e1;">
                            <span style="font-size: 0.65rem; color: #94a3b8; font-weight: 600; margin: 0; width: auto !important; flex-shrink: 0; display: inline-block;">STOCK POTENCIAL</span>
                            <div style="text-align: right; width: auto !important; display: inline-block; white-space: nowrap;">
                                <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 700;">${window.formatearStock ? window.formatearStock(ingrediente.stock_potencial) : ingrediente.stock_potencial}</span>
                                <span style="font-size: 0.70rem; font-weight: 600; color: #94a3b8;">${ingrediente.unidad_medida}</span>
                            </div>
                        </div>
                    </div>
                </div>
                        </div>
                    </div>
                </div>
                
                <div class="tarjeta-footer">
                                        ${(ingrediente.esMix || ingrediente.tipo_origen === 'Mix') ? `<button class="btn-tarjeta primary" onclick="if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})">📋 Fórmula</button>` : `<button class="btn-tarjeta primary" style="padding: 8px 12px;" onclick="if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})" title="Crear Fórmula">➕🧪</button>`}
                    <button class="btn-tarjeta-sector" onclick="if(window.abrirModalSector) abrirModalSector(${ingredienteIdReal}, ${ingrediente.sector_id || 'null'})" title="Cambiar Sector">📍</button>
                    <button class="btn-tarjeta action" onclick="if(window.abrirModalImpresionGeneral) abrirModalImpresionGeneral(${ingredienteIdReal}, '${(ingrediente.nombre_ingrediente || ingrediente.nombre).replace(/'/g, "\\'")}')">🖨️ Etiquetas</button>
                    <button class="btn-tarjeta adjust" onclick="if(window.editarIngrediente) editarIngrediente(${ingredienteIdReal})" title="Editar Detalles y Stock Restante">✏️ Editar</button>
                </div>`;
                groupContent.appendChild(card);
            });
            fragment.appendChild(groupContent);
        }
    }

    container.appendChild(fragment);
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
            
            // Si el modal está centrado via transform (nuestra config default), 
            // cambiar eso a top/left exacto absoluto ANTES de arrastrar para que NO HAGA UN SALTO (-50% transform elimina la estetica).
            if (modal.style.position !== 'absolute' || modal.style.transform === 'translate(-50%, -50%)') {
                const rect = modal.getBoundingClientRect();
                modal.style.position = 'absolute';
                modal.style.margin = '0';
                modal.style.transform = 'none'; // Aquí la clave: al desactivarlo, top/left asumen control total de la fisica
                // Asignamos la ubicacion exacta que tenia en pantalla visualmente gracias a getBoundingClientRect:
                modal.style.top = rect.top + 'px';
                modal.style.left = rect.left + 'px';
            }
            
            // Obtener la posición del cursor al inicio
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            // Calcular la nueva posición via diferencia
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            
            // Establecer la nueva posición. Usamos offsetTop porque acabamos de volverlo puramente absoluto en el mousedown.
            let nextTop = modal.offsetTop - pos2;
            let nextLeft = modal.offsetLeft - pos1;
            
            // Prevenir pérdida del modal fuera de la pantalla (Left o Top negativos)
            if (nextTop < 0) nextTop = 0;
            if (nextLeft < 0) nextLeft = 0;
            
            modal.style.top = nextTop + "px";
            modal.style.left = nextLeft + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    });

    // Configurar cerrado de modales
    const modalesConfig = [
        { id: 'modal-ingrediente', closeHandler: cerrarModal }
        // modal-mix purgado de aquí, su ciclo de vida y eventos de cierre los maneja exclusivamente mix.js
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

// ==========================================
// FUNCIÓN GLOBAL: TRASLADO MANTENIMIENTO
// ==========================================
window.iniciarTrasladoIngrediente = async function(ingredienteId, nombreIngredienteRaw) {
    const nombre = nombreIngredienteRaw.replace(/\'/g, "'").replace(/'/g, "\'");
    
    let operariosValidos = [];
    try {
        Swal.fire({ title: 'Cargando datos...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const resOps = await fetch('/api/produccion/operarios');
        const ops = await resOps.json();
        operariosValidos = ops.data || ops;
        Swal.close();
    } catch(e) {
        operariosValidos = []; // Fallback silencioso en caso de error
    }

    const { value: formValues } = await Swal.fire({
        title: 'Mover Kilos a Cuarentena',
        icon: 'warning',
        html:
            '<p style="margin-bottom: 15px;">¿Cuántos <b>KILOS (⚖️)</b> de <span style="color: #d33;">['+nombre+']</span> declarará en cuarentena?</p>' +
            '<input id="swal-ing-cantidad" type="number" step="0.001" min="0.001" class="swal2-input" placeholder="Cantidad (Kg)" value="">' +
            '<select id="swal-ing-responsable" class="swal2-select" style="display: flex;">' +
            '    <option value="" disabled selected>Seleccione el Responsable...</option>' +
            operariosValidos.map(op => `    <option value="${op.id}">${op.nombre}</option>`).join('') +
            '    <option value="-1">SISTEMA</option>' +
            '</select>' +
            '<input id="swal-ing-motivo" type="text" class="swal2-input" placeholder="Motivo de la cuarentena (Opcional)">',
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Trasladar a Mantenimiento',
        cancelButtonText: 'Cancelar',
        didOpen: () => {
            document.getElementById('swal-ing-cantidad').focus();
        },
        preConfirm: () => {
            const cantidad = document.getElementById('swal-ing-cantidad').value;
            const responsable = document.getElementById('swal-ing-responsable').value;
            const motivo = document.getElementById('swal-ing-motivo').value;

            if (!cantidad || isNaN(cantidad) || Number(cantidad) <= 0) {
                Swal.showValidationMessage('Debe ingresar una cantidad válida mayor a 0');
                return false;
            }
            if (!responsable) {
                Swal.showValidationMessage('Debe seleccionar un responsable para el movimiento');
                return false;
            }

            return { cantidad: parseFloat(cantidad), motivo: motivo, responsable: responsable };
        }
    });

    if (formValues) {
        try {
            const res = await fetch('/api/produccion/mantenimiento/traslado-ingredientes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    ingrediente_id: ingredienteId, 
                    cantidad: formValues.cantidad, 
                    motivo: formValues.motivo,
                    responsable: formValues.responsable
                })
            });
            const data = await res.json();
            if (data.success) {
                Swal.fire('¡Éxito!', 'Traslado del granel exitoso.', 'success');
                if (window.cargarIngredientes) {
                    window.cargarIngredientes();
                }
            } else {
                Swal.fire('Error', data.error || 'Falló el traslado', 'error');
            }
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'Error técnico al comunicar con el servidor', 'error');
        }
    }
};

// ============================================
// FUNCIONES UI DE SECTOR
// ============================================
window.abrirModalSector = async function(ingredienteId, sectorActualId) {
    if (typeof sectoresDisponibles === 'undefined' || sectoresDisponibles.length === 0) {
        Swal.fire('Error', 'No hay sectores cargados. Por favor refresque la página.', 'error');
        return;
    }

    let sectorActualNombre = "Sin asignar";
    if (sectorActualId) {
        const sectorObj = sectoresDisponibles.find(s => s.id == sectorActualId);
        if (sectorObj) sectorActualNombre = sectorObj.nombre;
    }

    let html = `<div style="margin-bottom: 15px; font-weight: bold; color: #555;">Sector actual: <span style="color: #333;">${sectorActualNombre}</span></div>`;
    html += '<select id="swal-sectores" class="swal2-select" style="max-width: 100%;">';
    html += '<option value="">Sin asignar</option>';
    sectoresDisponibles.forEach(s => {
        let sel = s.id == sectorActualId ? 'selected' : '';
        html += `<option value="${s.id}" ${sel}>${s.nombre}${s.descripcion ? ' (' + s.descripcion + ')' : ''}</option>`;
    });
    html += '</select>';

    const res = await Swal.fire({
        title: 'Reasignar Sector',
        html: html,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: async () => {
            const val = document.getElementById('swal-sectores').value;
            Swal.showLoading();
            try {
                let r = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sector_id: val || null })
                });
                
                if (!r.ok) {
                    const data = await r.json();
                    throw new Error(data.error || 'Error al guardar sector');
                }
                return true;
            } catch (err) {
                Swal.showValidationMessage(err.message);
                return false;
            }
        }
    });

    if (res.isConfirmed) {
        Swal.fire({
            icon: 'success',
            title: 'Sector actualizado',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 2000
        });
        if (window.actualizarTablaFiltrada) {
            await window.cargarSectores(); // Reload sectors just in case
            await window.cargarIngredientes(); // Need full reload to catch sector_id and object relations mapping
        }
    }
};


// ==========================================
// MÓDULO DE AJUSTE PUNTUAL DE STOCK FÍSICO
// ==========================================

window.modoAjusteActivo = false;
window.usuarioAjusteGlobal = null;
window.ingredientesAjusteSeleccionados = new Map(); // Mapa id => {nombre, stock_actual}

// FASE 1: INICIAR Y ELEGIR USUARIO
window.iniciarFlujoAjuste = async () => {
    try {
        const response = await fetch('http://localhost:3002/api/usuarios');
        if (!response.ok) throw new Error('Error al cargar usuarios');
        const usuarios = await response.json();
        
        const select = document.getElementById('ajuste-usuario-select');
        select.innerHTML = '<option value="">-- Seleccione el operario --</option>';
        usuarios.forEach(u => {
            if (u.activo) {
                select.innerHTML += `<option value="${u.id}">${u.nombre_completo} (${u.usuario})</option>`;
            }
        });
        
        document.getElementById('modal-seleccion-usuario').style.display = 'flex';
    } catch (e) {
        Swal.fire('Error', 'No se pudieron cargar los responsables. ' + e.message, 'error');
    }
};

window.confirmarUsuarioYPasarAFase2 = () => {
    const select = document.getElementById('ajuste-usuario-select');
    if (!select.value) {
        Swal.fire('Inválido', 'Debe seleccionar un responsable.', 'warning');
        return;
    }
    
    window.usuarioAjusteGlobal = { id: select.value, nombre: select.options[select.selectedIndex].text };
    document.getElementById('modal-seleccion-usuario').style.display = 'none';
    
    // Activar FASE 2
    window.modoAjusteActivo = true;
    window.ingredientesAjusteSeleccionados.clear();
    
    document.body.classList.add('modo-ajuste-general');
    
    // Mutar el botón principal
    const btn = document.getElementById('btn-iniciar-ajuste');
    if (btn) {
        btn.textContent = '✅ Finalizar Selección (0)';
        btn.style.backgroundColor = '#10b981'; // Verde
        
        // HACK: El css ".modo-ajuste-general .btn-agregar { display: none !important; }" ocultaba permanentemente a btn-iniciar-ajuste. 
        // Le sacamos la clase temporalmente.
        btn.classList.remove('btn-agregar');
        btn.classList.add('btn-sticky-flotante');
        
        // Agregar botón de cancelar si no existe
        if (!document.getElementById('btn-cancelar-ajuste')) {
            // Se inyecta como fixed body-child superior derecho
            document.body.insertAdjacentHTML('beforeend', '<button id="btn-cancelar-ajuste" class="btn-secundario" style="position: fixed; top: 20px; right: 20px; z-index: 2147483647; padding: 12px 20px; border-radius: 8px; font-weight: bold; background-color: white; color: #ef4444; border: 2px solid #ef4444; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" onclick="window.cancelarModoAjuste()">❌ Cancelar Modo Ajuste</button>');
        }
        
        btn.onclick = window.confirmarSeleccionAjuste;
    }
    
    // Resetear estados visuales
    document.querySelectorAll('.tarjeta-ingrediente').forEach(t => t.classList.remove('tarjeta-seleccionada'));
    document.querySelectorAll('.checkbox-ajuste').forEach(cb => cb.checked = false);
};

// FASE 2: SELECCIÓN DE TARJETAS
window.cancelarModoAjuste = () => {
    window.modoAjusteActivo = false;
    window.usuarioAjusteGlobal = null;
    document.body.classList.remove('modo-ajuste-general');
    
    // Restaurar el botón
    const btn = document.getElementById('btn-iniciar-ajuste');
    if (btn) {
        btn.innerHTML = '⚖️ Ajuste Puntual';
        btn.style.backgroundColor = '#6366f1';
        btn.classList.add('btn-agregar'); // Volvemos a colocar su clase natural
        btn.classList.remove('btn-sticky-flotante');
        btn.onclick = window.iniciarFlujoAjuste;
        
        const btnCancel = document.getElementById('btn-cancelar-ajuste');
        if (btnCancel) btnCancel.remove();
    }
    
    document.querySelectorAll('.tarjeta-ingrediente').forEach(t => t.classList.remove('tarjeta-seleccionada'));
    document.querySelectorAll('.checkbox-ajuste').forEach(cb => cb.checked = false);
};

window.toggleSeleccionAjuste = (checkbox) => {
    const ingredienteId = parseInt(checkbox.dataset.id);
    const tarjeta = checkbox.closest('.tarjeta-ingrediente');
    
    if (checkbox.checked) {
        tarjeta.classList.add('tarjeta-seleccionada');
        // Extraer datos visualmente por seguridad ante cambio de contextos
        const tituloEl = tarjeta.querySelector('.tarjeta-titulo');
        const stockEl = tarjeta.querySelector('.stat-value');
        
        const nombreStr = tituloEl ? tituloEl.textContent.trim() : 'Desconocido';
        // El stock físico visual incluye la unidad (ej: "49,880 KG" o "49.880 KG"), capturamos solo el numero
        let stockNum = 0;
        if (stockEl) {
            let numTxt = stockEl.textContent.trim().split(' ')[0];
            // Normalizar coma a punto si la vista usa comas por configuración
            numTxt = numTxt.replace(',', '.');
            stockNum = parseFloat(numTxt) || 0;
        }

        window.ingredientesAjusteSeleccionados.set(ingredienteId, {
            id: ingredienteId,
            nombre: nombreStr,
            stock_actual: stockNum
        });
    } else {
        tarjeta.classList.remove('tarjeta-seleccionada');
        window.ingredientesAjusteSeleccionados.delete(ingredienteId);
    }
    
    // Actualizar el contador en el botón
    const btn = document.getElementById('btn-iniciar-ajuste');
    if (btn && window.modoAjusteActivo) {
        btn.textContent = `✅ Finalizar Selección (${window.ingredientesAjusteSeleccionados.size})`;
    }
};

// FASE 3: VISTA DE EJECUCIÓN (MODAL)
window.confirmarSeleccionAjuste = () => {
    if (window.ingredientesAjusteSeleccionados.size === 0) {
        Swal.fire('Inválido', 'Debe seleccionar al menos un ingrediente.', 'info');
        return;
    }
    
    const tbody = document.getElementById('ajuste-ejecucion-tbody');
    tbody.innerHTML = '';
    
    window.ingredientesAjusteSeleccionados.forEach(ing => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #e2e8f0';
        tr.innerHTML = `
            <td style="padding: 12px; font-weight: 500;">${ing.nombre}</td>
            <td style="padding: 12px; color: #64748b;">${ing.stock_actual.toFixed(3).replace('.', ',')}</td>
            <td style="padding: 12px;">
                <input type="text" class="ajuste-input-nuevo-stock" data-id="${ing.id}" data-stock-actual="${ing.stock_actual}" placeholder="Ej: 5,500" style="width: 100%; padding: 8px; border: 1px solid #94a3b8; border-radius: 4px;" oninput="window.calcularDiferencialAjuste(this)">
            </td>
            <td style="padding: 12px; font-weight: bold;" class="ajuste-diff-cell" id="diff-${ing.id}">-</td>
        `;
        tbody.appendChild(tr);
    });
    
    document.getElementById('ajuste-observacion').value = '';
    document.getElementById('modal-ejecucion-ajuste').style.display = 'flex';
};

window.calcularDiferencialAjuste = (input) => {
    // 1. Sanear visual e intelectualmente la entrada (Prohibir símbolos negativos o caracteres extraños)
    let sanitized = input.value.replace(/[^0-9.,]/g, '');
    if (input.value !== sanitized) {
        input.value = sanitized;
    }
    
    // 2. Reemplazar comas por puntos para parsing matemático
    let valStr = sanitized.replace(',', '.');
    
    const id = input.dataset.id;
    const actual = parseFloat(input.dataset.stockActual);
    const nuevo = parseFloat(valStr);
    const diffCell = document.getElementById('diff-' + id);
    
    if (isNaN(nuevo) || nuevo < 0) {
        diffCell.textContent = '-';
        diffCell.style.color = 'black';
        return;
    }
    
    const diff = nuevo - actual;
    if (diff > 0) {
        diffCell.textContent = '+' + diff.toFixed(3).replace('.', ',');
        diffCell.style.color = '#10b981'; // Verde
    } else if (diff < 0) {
        diffCell.textContent = diff.toFixed(3).replace('.', ',');
        diffCell.style.color = '#ef4444'; // Rojo
    } else {
        diffCell.textContent = '0,000';
        diffCell.style.color = '#3b82f6'; // Azul
    }
};

window.procesarAjustes = async () => {
    const inputs = document.querySelectorAll('.ajuste-input-nuevo-stock');
    const observacion = document.getElementById('ajuste-observacion').value.trim();
    
    // Observacion es OPCIONAL ahora
    // if (!observacion) { ... }
    
    let ajustesValidar = [];
    let errores = false;
    
    inputs.forEach(input => {
        const id = parseInt(input.dataset.id);
        const valStr = input.value.replace(',', '.').replace(/[^0-9.]/g, '');
        const nuevo = parseFloat(valStr);
        if (isNaN(nuevo)) {
            errores = true;
        } else {
            ajustesValidar.push({ ingrediente_id: id, nuevo_stock: nuevo, observacion: observacion });
        }
    });
    
    if (errores || ajustesValidar.length === 0) {
        Swal.fire('Inválido', 'Falta cargar el nuevo stock en uno o más ítems.', 'error');
        return;
    }
    
    const boton = document.getElementById('btn-procesar-ajuste');
    boton.disabled = true;
    boton.textContent = '⏱️ Procesando...';
    
    try {
        const res = await fetch('/api/produccion/ingredientes/ajustar-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                usuario_id: window.usuarioAjusteGlobal.id,
                ajustes: ajustesValidar
            })
        });
        
        if (!res.ok) throw new Error((await res.json()).error || 'Error en servidor');
        
        // 1. Ocultar modal de ejecución de inmediato
        document.getElementById('modal-ejecucion-ajuste').style.display = 'none';
        
        // 2. Dar alerta de éxito
        Swal.fire('Éxito', 'Ajustes de inventario impactados correctamente.', 'success');
        
        // 3. Salir del modo y aniquilar memoria
        window.cancelarModoAjuste();
        
        // 4. Refrescar la base local
        document.getElementById('filtro-nombre').value = '';
        await window.cargarIngredientes();
        
    } catch(e) {
        // En caso de error, el modal se debe cerrar y el estado (Fase 2) se resguarda por detrás.
        document.getElementById('modal-ejecucion-ajuste').style.display = 'none';
        Swal.fire('Error Transaccional', e.message, 'error');
    } finally {
        boton.disabled = false;
        boton.textContent = '💾 Impactar Ajuste';
    }
};

window.imprimirCartelSector = (letra, nombre) => {
    const textoPrincipal = letra ? letra : nombre;
    const ventanaImpresion = window.open('', '_blank', 'width=800,height=1000');
    
    if (!ventanaImpresion) {
        Swal.fire({
            title: 'Bloqueado',
            text: 'Por favor, permite las ventanas emergentes (pop-ups) para generar el cartel A4.',
            icon: 'warning'
        });
        return;
    }

    const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Cartel Sector ${textoPrincipal}</title>
            <style>
                @page {
                    size: A4 portrait;
                    margin: 1.5cm;
                }
                * {
                    box-sizing: border-box;
                }
                body, html {
                    margin: 0;
                    padding: 0;
                    width: 100vw;
                    height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    font-family: system-ui, -apple-system, sans-serif;
                    background: white;
                }
                .cartel-container {
                    text-align: center;
                    width: 95vw;
                    height: 95vh;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    border: 15px solid #0f172a;
                    border-radius: 20px;
                    padding: 2cm;
                }
                .cartel-titulo {
                    font-size: 14rem;
                    font-weight: 900;
                    color: #0f172a;
                    margin: 0;
                    text-transform: uppercase;
                    line-height: 1;
                    word-break: break-word;
                }
                .cartel-subtitulo {
                    font-size: 4rem;
                    font-weight: 800;
                    color: #475569;
                    margin-top: 2rem;
                    text-transform: uppercase;
                }
                @media print {
                    body {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        background: white !important;
                    }
                    .cartel-container { height: 98vh; width: 98vw; border-width: 10px; }
                }
            </style>
        </head>
        <body>
            <div class="cartel-container">
                <h1 class="cartel-titulo">${textoPrincipal}</h1>
                ${letra && nombre && letra !== nombre ? `<h2 class="cartel-subtitulo">${nombre}</h2>` : ''}
            </div>
            <script>
                window.onload = function() {
                    setTimeout(() => { 
                        window.print(); 
                        setTimeout(() => { window.close(); }, 500);
                    }, 800);
                };
            </script>
        </body>
        </html>
    `;

    ventanaImpresion.document.open();
    ventanaImpresion.document.write(html);
    ventanaImpresion.document.close();
};
