// ===== VARIABLES GLOBALES =====
// Variables para el inventario y ajustes de ingredientes
let usuarioSeleccionado = null;
let usuarioAjustes = null;
let ingredientesInventario = new Map(); // Mapa para almacenar los ingredientes escaneados
let ingredientesSeleccionados = new Map(); // Mapa para almacenar los ingredientes seleccionados para ajuste
let socket = null;
let sessionId = null;
let modoSeleccion = false;

// Variables para filtrado
let todosLosIngredientes = []; // Array para almacenar todos los ingredientes cargados
let ingredientesFiltrados = []; // Array para almacenar los ingredientes filtrados

// Variables para sectores
let todosLosSectores = []; // Array para almacenar todos los sectores disponibles

// ===== FUNCIONES UTILITARIAS =====

/**
 * Formatea un numero para mostrar de forma legible
 * - Redondea a 2 decimales maximo
 * - Elimina decimales innecesarios (.00)
 * - Maneja valores muy pequenos como 0
 * @param {number} valor - El valor numerico a formatear
 * @returns {string} - El valor formateado como string
 */
function formatearNumero(valor) {
    if (valor === null || valor === undefined || isNaN(valor)) {
        return "0";
    }

    const numero = Number(valor);

    // Si el valor es practicamente cero (debido a precision de punto flotante)
    if (Math.abs(numero) < 0.001) {
        return "0";
    }

    // Redondear a 2 decimales y eliminar ceros innecesarios
    return numero.toFixed(2).replace(/\.?0+$/, "");
}

// Funcion para mostrar mensajes
function mostrarMensaje(mensaje, tipo = "error") {
    console.log("📢 [MENSAJE] " + tipo.toUpperCase() + ": " + mensaje);

    const mensajeDiv = document.createElement("div");
    mensajeDiv.className = tipo === "error" ? "mensaje-error" : "mensaje-info";
    mensajeDiv.textContent = mensaje;

    // Remover mensaje anterior si existe
    const mensajeAnterior = document.querySelector(".mensaje-error, .mensaje-info");
    if (mensajeAnterior) {
        mensajeAnterior.remove();
    }

    const contentSection = document.querySelector(".content-section");
    if (contentSection) {
        contentSection.insertBefore(mensajeDiv, contentSection.firstChild);
    }

    // Remover el mensaje despues de 3 segundos
    setTimeout(() => {
        if (mensajeDiv.parentNode) {
            mensajeDiv.parentNode.removeChild(mensajeDiv);
        }
    }, 3000);
}

// ===== FUNCIONES DE TABLA Y FILTRADO =====

// Funcion para actualizar la tabla con los ingredientes
function actualizarTablaIngredientes(ingredientes) {
    const tbody = document.getElementById("tabla-ingredientes-body");
    if (!tbody) {
        console.error("❌ No se encontro tbody con ID tabla-ingredientes-body");
        return;
    }

    tbody.innerHTML = "";

    if (!ingredientes || ingredientes.length === 0) {
        const colspan = modoSeleccion ? 6 : 5;
        tbody.innerHTML = "<tr><td colspan=\"" + colspan + "\" class=\"mensaje-info\">No hay ingredientes registrados</td></tr>";
        return;
    }

    ingredientes.forEach((ingrediente, index) => {
        const stockActual = ingrediente.stock_actual || 0;

        const tr = document.createElement("tr");
        const checkboxHtml = modoSeleccion ?
            "<td class=\"checkbox-cell\">" +
            "<input type=\"checkbox\" " +
            "class=\"checkbox-ingrediente\" " +
            "data-ingrediente=\"" + ingrediente.id + "\"" +
            (ingredientesSeleccionados.has(ingrediente.id.toString()) ? " checked" : "") + ">" +
            "</td>" : "";

        tr.innerHTML =
            checkboxHtml +
            "<td>" + ingrediente.id + "</td>" +
            "<td>" + ingrediente.nombre + "</td>" +
            "<td>" + (ingrediente.codigo || "-") + "</td>" +
            "<td>" + formatearNumero(stockActual) + " " + (ingrediente.unidad_medida || "kg") + "</td>";
        tbody.appendChild(tr);
    });

    // Actualizar eventos de los checkboxes si estamos en modo seleccion
    if (modoSeleccion) {
        const checkboxes = tbody.querySelectorAll(".checkbox-ingrediente");
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener("change", function () {
                const ingredienteId = this.dataset.ingrediente;
                const ingrediente = todosLosIngredientes.find(i => i.id.toString() === ingredienteId);

                if (this.checked) {
                    ingredientesSeleccionados.set(ingredienteId, ingrediente);
                } else {
                    ingredientesSeleccionados.delete(ingredienteId);
                }
            });
        });
    }
}

// Funciones de filtrado
// Funciones de filtrado (Space AND logic + Numeric/Barcode support)
function filtrarPorNombre(ingredientes, texto) {
    if (!texto) return ingredientes;
    const terminos = texto.toLowerCase().trim().split(' ').filter(t => t.length > 0);

    return ingredientes.filter(ing => {
        const nombre = (ing.nombre || '').toLowerCase();
        const codigo = String(ing.codigo || '').toLowerCase();

        // Si es numerico exacto, priorizar barcode/codigo (pistola)
        if (terminos.length === 1 && /^\d+$/.test(terminos[0])) {
            if (codigo === terminos[0]) return true;
        }

        // Búsqueda "Space AND" en Nombre
        return terminos.every(t => nombre.includes(t) || codigo.includes(t));
    });
}

function filtrarPorStock(ingredientes, condicion) {
    console.log("🔍 [DEBUG] filtrarPorStock - Iniciando filtrado");
    console.log("🔍 [DEBUG] Condicion de filtro:", condicion);
    console.log("🔍 [DEBUG] Cantidad de ingredientes a filtrar:", ingredientes.length);

    // Umbral para considerar un valor como "practicamente cero"
    const UMBRAL_CERO = 0.01;

    let resultado;
    switch (condicion) {
        case "igual-cero":
            resultado = ingredientes.filter(ingrediente => {
                const stock = ingrediente.stock_actual || 0;
                const esIgualCero = Math.abs(stock) <= UMBRAL_CERO;
                if (esIgualCero) {
                    console.log("📊 [DEBUG] Ingrediente con stock = 0: " + ingrediente.nombre + " (" + stock + ")");
                }
                return esIgualCero;
            });
            break;
        case "mayor-cero":
            resultado = ingredientes.filter(ingrediente => {
                const stock = ingrediente.stock_actual || 0;
                const esMayorCero = stock > UMBRAL_CERO;
                if (esMayorCero) {
                    console.log("📊 [DEBUG] Ingrediente con stock > 0: " + ingrediente.nombre + " (" + stock + ")");
                }
                return esMayorCero;
            });
            break;
        case "menor-cero":
            resultado = ingredientes.filter(ingrediente => {
                const stock = ingrediente.stock_actual || 0;
                const esMenorCero = stock < -UMBRAL_CERO;
                if (esMenorCero) {
                    console.log("📊 [DEBUG] Ingrediente con stock < 0: " + ingrediente.nombre + " (" + stock + ")");
                }
                return esMenorCero;
            });
            break;
        default:
            resultado = ingredientes;
    }

    console.log("✅ [DEBUG] filtrarPorStock - Filtrado completado");
    console.log("✅ [DEBUG] Ingredientes despues del filtro:", resultado.length);
    return resultado;
}

function aplicarFiltros() {
    console.log("🔍 [DEBUG] aplicarFiltros - Iniciando aplicacion de filtros");

    const textoFiltro = document.getElementById("filtro-nombre")?.value || "";
    const stockFiltro = document.getElementById("filtro-stock")?.value || "todos";

    console.log("🔍 [DEBUG] Filtros actuales:");
    console.log("- Texto:", textoFiltro);
    console.log("- Stock:", stockFiltro);
    console.log("- Total ingredientes antes de filtrar:", todosLosIngredientes.length);

    let ingredientesFiltrados = [...todosLosIngredientes];

    // Aplicar filtro de nombre
    if (textoFiltro) {
        console.log("📝 [DEBUG] Aplicando filtro por nombre:", textoFiltro);
        ingredientesFiltrados = filtrarPorNombre(ingredientesFiltrados, textoFiltro);
        console.log("📝 [DEBUG] Ingredientes despues de filtrar por nombre:", ingredientesFiltrados.length);
    }

    // Aplicar filtro de stock
    if (stockFiltro !== "todos") {
        console.log("📊 [DEBUG] Aplicando filtro por stock:", stockFiltro);
        ingredientesFiltrados = filtrarPorStock(ingredientesFiltrados, stockFiltro);
        console.log("📊 [DEBUG] Ingredientes despues de filtrar por stock:", ingredientesFiltrados.length);
    }

    console.log("✅ [DEBUG] Filtrado completado");
    console.log("✅ [DEBUG] Total ingredientes despues de filtrar:", ingredientesFiltrados.length);

    // Actualizar la tabla con los resultados filtrados
    actualizarTablaIngredientes(ingredientesFiltrados);
}

// ===== FUNCIONES DE CARGA DE DATOS =====

// Funcion para cargar los ingredientes
async function cargarIngredientes() {
    try {
        console.log("🔄 [CARGA] Cargando ingredientes...");
        const response = await fetch("/api/produccion/ingredientes");

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Error al obtener los ingredientes");
        }

        const ingredientes = await response.json();
        console.log("✅ [CARGA] Ingredientes cargados:", ingredientes.length);

        // Almacenar todos los ingredientes globalmente
        todosLosIngredientes = ingredientes;

        // Mostrar los ingredientes en la tabla
        actualizarTablaIngredientes(ingredientes);

    } catch (error) {
        console.error("❌ [CARGA] Error al cargar ingredientes:", error);
        mostrarMensaje(error.message || "No se pudieron cargar los ingredientes");
    }
}

async function cargarUsuarios() {
    try {
        console.log("🔄 [USUARIOS] Cargando usuarios...");

        const response = await fetch("/api/usuarios?rol=3&activo=true");
        if (!response.ok) throw new Error("Error al cargar usuarios");

        const usuarios = await response.json();
        const select = document.getElementById("select-usuario");
        if (select) {
            select.innerHTML = "<option value=\"\">-- Seleccionar usuario --</option>";

            usuarios.forEach(usuario => {
                const option = document.createElement("option");
                option.value = usuario.id;
                option.textContent = usuario.nombre_completo;
                select.appendChild(option);
            });
        }

        console.log("✅ [USUARIOS] Usuarios cargados:", usuarios.length);

    } catch (error) {
        console.error("❌ [USUARIOS] Error al cargar usuarios:", error);
        mostrarMensaje("No se pudieron cargar los usuarios");
    }
}

/**
 * Carga los sectores desde la API
 */
async function cargarSectores() {
    try {
        console.log("🔄 [SECTORES] ===== INICIANDO CARGA DE SECTORES =====");
        console.log("🔄 [SECTORES] Timestamp:", new Date().toISOString());
        console.log("🔄 [SECTORES] URL del endpoint:", "/api/produccion/sectores");
        console.log("🔄 [SECTORES] Realizando fetch...");

        const response = await fetch("/api/produccion/sectores");

        console.log("📡 [SECTORES] Respuesta recibida:");
        console.log("- Status:", response.status);
        console.log("- Status Text:", response.statusText);
        console.log("- OK:", response.ok);
        console.log("- Headers:", Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
            console.error("❌ [SECTORES] Respuesta no exitosa del servidor");
            console.error("❌ [SECTORES] Status completo:", response.status, response.statusText);

            // Intentar leer el cuerpo del error
            let errorBody = "No se pudo leer el cuerpo del error";
            try {
                errorBody = await response.text();
                console.error("❌ [SECTORES] Cuerpo del error:", errorBody);
            } catch (e) {
                console.error("❌ [SECTORES] Error al leer cuerpo del error:", e);
            }

            throw new Error("Error HTTP " + response.status + ": " + response.statusText + " - " + errorBody);
        }

        console.log("✅ [SECTORES] Respuesta exitosa, parseando JSON...");
        const sectores = await response.json();

        console.log("🎉 [SECTORES] ===== SECTORES CARGADOS EXITOSAMENTE =====");
        console.log("📊 [SECTORES] Total de sectores recibidos:", sectores.length);
        console.log("📋 [SECTORES] Lista completa de sectores:");

        sectores.forEach((sector, index) => {
            console.log("  " + (index + 1) + ". ID: " + sector.id + " | Nombre: \"" + sector.nombre + "\" | Descripcion: \"" + (sector.descripcion || "Sin descripcion") + "\"");
        });

        // Almacenar sectores en variable global
        todosLosSectores = sectores;
        console.log("💾 [SECTORES] Sectores almacenados en variable global todosLosSectores");
        console.log("💾 [SECTORES] Verificacion - todosLosSectores.length:", todosLosSectores.length);

        return sectores;
    } catch (error) {
        console.error("❌ [SECTORES] ===== ERROR AL CARGAR SECTORES =====");
        console.error("❌ [SECTORES] Tipo de error:", error.constructor.name);
        console.error("❌ [SECTORES] Mensaje de error:", error.message);
        console.error("❌ [SECTORES] Stack trace:", error.stack);

        // Informacion adicional para debugging
        console.error("🔍 [SECTORES] Informacion de debugging:");
        console.error("- URL intentada:", "/api/produccion/sectores");
        console.error("- Timestamp del error:", new Date().toISOString());
        console.error("- User Agent:", navigator.userAgent);
        console.error("- Location:", window.location.href);

        // Devolver array vacio en caso de error
        todosLosSectores = [];
        console.log("💾 [SECTORES] Variable global todosLosSectores reiniciada a array vacio");

        return [];
    }
}

// ===== FUNCIONES DE MODAL DE INVENTARIO =====

function mostrarModal() {
    console.log("🔄 [MODAL] Mostrando modal de inventario");

    const modal = document.getElementById("modal-inventario");
    if (modal) {
        modal.style.display = "block";

        const pasoUsuario = document.getElementById("paso-usuario");
        const pasoConteo = document.getElementById("paso-conteo");

        if (pasoUsuario) pasoUsuario.style.display = "block";
        if (pasoConteo) pasoConteo.style.display = "none";

        cargarUsuarios();
    }
}

function cerrarModal() {
    console.log("🔄 [MODAL] Cerrando modal de inventario");

    const modal = document.getElementById("modal-inventario");
    if (modal) {
        modal.style.display = "none";
    }
    reiniciarInventario();
}

function reiniciarInventario() {
    console.log("🧹 [INVENTARIO] Reiniciando inventario...");

    usuarioSeleccionado = null;
    ingredientesInventario.clear();

    const selectUsuario = document.getElementById("select-usuario");
    const inputCodigo = document.getElementById("input-codigo-barras");
    const contenedorIngredientes = document.getElementById("ingredientes-inventario");
    const btnContinuar = document.getElementById("btn-continuar-usuario");

    if (selectUsuario) selectUsuario.value = "";
    if (inputCodigo) inputCodigo.value = "";
    if (contenedorIngredientes) contenedorIngredientes.innerHTML = "";
    if (btnContinuar) btnContinuar.disabled = true;

    // Cerrar conexion WebSocket si existe
    if (socket) {
        console.log("🧹 [INVENTARIO] Cerrando conexion WebSocket");
        socket.emit("finalizar_inventario", { sessionId });
        socket.disconnect();
        socket = null;
    }
    sessionId = null;
    sessionStorage.removeItem("usuarioInventario");

    console.log("✅ [INVENTARIO] Inventario reiniciado completamente");
}

/**
 * Muestra el paso de seleccion de sectores
 */
async function mostrarPasoSectores() {
    console.log("🏢 [SECTORES] Mostrando paso de seleccion de sectores");

    // Ocultar paso de usuario y mostrar paso de sectores
    const pasoUsuario = document.getElementById("paso-usuario");
    const pasoSectores = document.getElementById("paso-sectores");

    if (pasoUsuario) pasoUsuario.style.display = "none";
    if (pasoSectores) pasoSectores.style.display = "block";

    try {
        // Cargar sectores desde backend
        console.log("🔄 [SECTORES] Cargando sectores desde API...");
        await cargarSectores();

        // Mostrar checkboxes de sectores
        console.log("🔄 [SECTORES] Llamando a mostrarCheckboxesSectores...");
        mostrarCheckboxesSectores();

        console.log("✅ [SECTORES] Paso de sectores mostrado correctamente");
    } catch (error) {
        console.error("❌ [SECTORES] Error al mostrar paso de sectores:", error);
        mostrarMensaje("Error al cargar sectores: " + error.message, "error");
    }
}

/**
 * Muestra los checkboxes de sectores en el contenedor correspondiente
 */
function mostrarCheckboxesSectores() {
    console.log("🔄 [SECTORES] mostrarCheckboxesSectores llamada");
    console.log("📊 [SECTORES] Sectores disponibles para mostrar: " + todosLosSectores.length);

    const contenedor = document.getElementById("sectores-checkboxes");
    if (!contenedor) {
        console.error("❌ [SECTORES] No se encontro el contenedor #sectores-checkboxes");
        return;
    }

    // Limpiar contenedor
    contenedor.innerHTML = "";

    if (todosLosSectores.length === 0) {
        console.log("⚠️ [SECTORES] No hay sectores para mostrar");
        contenedor.innerHTML = "<p style=\"color: #666; font-style: italic;\">No hay sectores disponibles</p>";
        return;
    }

    console.log("✅ [SECTORES] Renderizando sectores:", todosLosSectores.map(s => s.nombre));

    // Crear checkboxes para cada sector
    todosLosSectores.forEach(sector => {
        const checkboxDiv = document.createElement("div");
        checkboxDiv.className = "sector-checkbox-item";
        checkboxDiv.style.cssText = "margin-bottom: 8px; display: flex; align-items: center;";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = "sector-" + sector.id;
        checkbox.className = "sector-checkbox";
        checkbox.setAttribute("data-sector-id", sector.id);
        checkbox.style.cssText = "margin-right: 8px;";

        const label = document.createElement("label");
        label.htmlFor = "sector-" + sector.id;
        label.textContent = sector.nombre;
        label.style.cssText = "cursor: pointer; user-select: none;";

        // Agregar descripcion si existe
        if (sector.descripcion && sector.descripcion.trim() !== "") {
            const descripcion = document.createElement("small");
            descripcion.textContent = " (" + sector.descripcion + ")";
            descripcion.style.cssText = "color: #666; margin-left: 4px;";
            label.appendChild(descripcion);
        }

        checkboxDiv.appendChild(checkbox);
        checkboxDiv.appendChild(label);
        contenedor.appendChild(checkboxDiv);

        console.log("📋 [SECTORES] Checkbox creado: " + sector.nombre + " (ID: " + sector.id + ")");
    });

    // Agregar event listener para el checkbox "Todos los sectores"
    const checkboxTodos = document.getElementById("todos-sectores");
    if (checkboxTodos) {
        checkboxTodos.addEventListener("change", function () {
            const sectoresCheckboxes = document.querySelectorAll(".sector-checkbox");

            if (this.checked) {
                console.log("🔄 [SECTORES] 'Todos los sectores' marcado - Desmarcando específicos");
                // Desmarcar todos los específicos pero mantenerlos habilitados
                sectoresCheckboxes.forEach(checkbox => {
                    checkbox.checked = false;
                    checkbox.disabled = false; // Asegurar que estén habilitados
                });
            } else {
                console.log("🔄 [SECTORES] 'Todos los sectores' desmarcado");
                // No action needed, user can select manually
            }
        });
    }

    // Agregar listeners a los checkboxes individuales para desmarcar "Todos"
    const checkboxesIndividuales = document.querySelectorAll(".sector-checkbox");
    checkboxesIndividuales.forEach(cb => {
        cb.addEventListener('change', function () {
            if (this.checked && checkboxTodos && checkboxTodos.checked) {
                console.log("🔄 [SECTORES] Sector individual marcado - Desmarcando 'Todos'");
                checkboxTodos.checked = false;
            }
        });
    });


    console.log("✅ [SECTORES] " + todosLosSectores.length + " checkboxes de sectores renderizados correctamente");
}

function mostrarPasoConteo() {
    console.log("🔄 [CONTEO] Mostrando paso de conteo");

    // 1. Configurar UI del Panel (Tabs, Botones, mostrar div correcto)
    configurarPanelControlUI();

    // PRIMERO: Guardar el usuario seleccionado en la sesion
    const selectUsuario = document.getElementById("select-usuario");
    if (selectUsuario && selectUsuario.selectedIndex > 0) {
        const usuarioNombre = selectUsuario.options[selectUsuario.selectedIndex].text;
        sessionStorage.setItem("usuarioInventario", JSON.stringify({
            id: usuarioSeleccionado,
            nombre: usuarioNombre
        }));
    }

    // MOSTRAR INFORMACION DE SECTORES SELECCIONADOS
    mostrarInfoSectoresInventario();

    // DESPUES: Inicializar WebSocket para ingredientes
    inicializarWebSocketIngredientes();

    const inputCodigo = document.getElementById("input-codigo-barras");
    if (inputCodigo) {
        inputCodigo.focus();
    }
}

/**
 * Muestra la informacion de sectores seleccionados en el paso de conteo
 */
function mostrarInfoSectoresInventario() {
    console.log("🏢 [INFO-SECTORES] ===== MOSTRANDO INFORMACION DE SECTORES =====");

    const sectoresInfo = sessionStorage.getItem("sectoresInventario");
    const sectoresTextoElement = document.getElementById("sectores-inventario-texto");

    if (!sectoresTextoElement) {
        console.error("❌ [INFO-SECTORES] No se encontro elemento sectores-inventario-texto");
        return;
    }

    console.log("🏢 [INFO-SECTORES] Sectores en sessionStorage:", sectoresInfo);

    if (sectoresInfo === "TODOS") {
        console.log("🏢 [INFO-SECTORES] Mostrando: Todos los sectores");
        sectoresTextoElement.innerHTML = "📦 <strong>Todos los sectores</strong> - Inventario completo de ingredientes";
    } else {
        try {
            const sectoresSeleccionados = JSON.parse(sectoresInfo || "[]");
            console.log("🏢 [INFO-SECTORES] Sectores especificos:", sectoresSeleccionados);

            if (sectoresSeleccionados.length === 0) {
                console.log("🏢 [INFO-SECTORES] No hay sectores especificos seleccionados");
                sectoresTextoElement.innerHTML = "⚠️ <strong>Sin sectores especificos</strong> - Revise la configuracion";
            } else {
                // Buscar nombres de sectores
                const nombresSectores = sectoresSeleccionados.map(sectorId => {
                    const sector = todosLosSectores.find(s => s.id === sectorId);
                    return sector ? sector.nombre : "Sector " + sectorId;
                });

                console.log("🏢 [INFO-SECTORES] Nombres de sectores:", nombresSectores);

                const textoSectores = nombresSectores.join(", ");
                sectoresTextoElement.innerHTML = "🏢 <strong>Sectores seleccionados:</strong> " + textoSectores;
            }
        } catch (e) {
            console.error("❌ [INFO-SECTORES] Error al parsear sectores:", e);
            sectoresTextoElement.innerHTML = "❌ <strong>Error</strong> - No se pudo cargar informacion de sectores";
        }
    }

    console.log("✅ [INFO-SECTORES] Informacion de sectores mostrada correctamente");
}

// ===== FUNCIONES DE WEBSOCKET =====

/**
 * Inicializa la conexion WebSocket para inventario de ingredientes
 */
function inicializarWebSocketIngredientes() {
    try {
        console.log("🚀 [WEBSOCKET] ===== INICIANDO WEBSOCKET PARA INVENTARIO DE INGREDIENTES =====");
        console.log("📅 [WEBSOCKET] Timestamp:", new Date().toISOString());

        // Verificar si io esta disponible
        if (typeof io === "undefined") {
            console.error("❌ [WEBSOCKET] Socket.IO no esta disponible");
            mostrarMensaje("Error: Socket.IO no esta cargado", "error");
            return;
        }

        // Conectar a WebSocket con opciones de reconexion
        socket = io({
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        // Generar ID de sesion unico con timestamp para debugging
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        sessionId = "inv_ing_" + timestamp + "_" + random;

        console.log("🆔 [WEBSOCKET] ===== GENERACION DE SESSION ID =====");
        console.log("- Timestamp:", timestamp);
        console.log("- Random:", random);
        console.log("- Session ID completo:", sessionId);

        socket.on("connect", () => {
            console.log("✅ [WEBSOCKET] Conectado a WebSocket con socket ID:", socket.id);

            // Obtener informacion del usuario y sectores
            const usuarioInfo = JSON.parse(sessionStorage.getItem("usuarioInventario") || "{}");
            const sectoresInfo = sessionStorage.getItem("sectoresInventario");

            let sectores;
            if (sectoresInfo === "TODOS") {
                sectores = "TODOS";
            } else {
                try {
                    const sectoresIds = JSON.parse(sectoresInfo || "[]");
                    // Enriquecer con descripcion para el movil
                    if (Array.isArray(sectoresIds) && typeof todosLosSectores !== 'undefined') {
                        sectores = sectoresIds.map(id => {
                            const idNum = parseInt(id);
                            const sec = todosLosSectores.find(s => s.id === idNum);
                            return sec ? { id: sec.id, descripcion: sec.descripcion || sec.nombre } : { id, descripcion: `Sector ${id}` };
                        });
                    } else {
                        sectores = sectoresIds;
                    }
                } catch (e) {
                    console.error("❌ [WEBSOCKET] Error al parsear sectores:", e);
                    sectores = [];
                }
            }

            // EXPOSE GLOBALLY FOR PRINTING
            window.sectoresSesionActiva = sectores;
            console.log("🌍 [GLOBAL] Sectores guardados en window.sectoresSesionActiva:", window.sectoresSesionActiva);

            // Iniciar sesion de inventario de ingredientes
            // CORRECCION: Enviar objeto usuario completo con id y nombre

            // 1. Filtrar y Enriquecer Ingredientes para Auditoría Móvil
            let ingredientesParaMovil = [];
            if (typeof todosLosIngredientes !== 'undefined' && Array.isArray(todosLosIngredientes)) {
                console.log("📦 [WEBSOCKET] Preparando lista maestra de ingredientes para móvil...");

                ingredientesParaMovil = todosLosIngredientes.filter(ing => {
                    if (sectores === 'TODOS') return true;
                    // sectores es array de objetos {id, descripcion} o strings '7'
                    // Si sectores contiene objetos, mapear a IDs primero
                    const idsPermitidos = Array.isArray(sectores) ? sectores.map(s => (s.id || s).toString()) : [];
                    // FIX: Check if sector_id exists before toString
                    return ing.sector_id && idsPermitidos.includes(ing.sector_id.toString());
                }).map(ing => {
                    // Lógica robusta de extracción de letra (Centralizada)
                    let sectorLetra = null;
                    if (ing.sector_id) {
                        // Buscar descripción del sector
                        let descripcionSector = "";
                        if (typeof todosLosSectores !== 'undefined') {
                            const sec = todosLosSectores.find(s => s.id === ing.sector_id);
                            if (sec) descripcionSector = sec.descripcion || sec.nombre;
                        }

                        if (descripcionSector) {
                            const match = descripcionSector.match(/["']([^"']+)["']/);
                            if (match) sectorLetra = match[1];
                            else if (descripcionSector.includes('Sector')) sectorLetra = descripcionSector.replace('Sector', '').replace(/["']/g, '').trim();
                            else sectorLetra = descripcionSector;
                        }
                    }

                    return {
                        id: ing.id,
                        nombre: ing.nombre,
                        codigo: ing.codigo,
                        sector_id: ing.sector_id,
                        sector_letra: sectorLetra || ing.sector_id, // Fallback
                        stock_sistema: ing.stock_actual, // Info para auditoría
                        unidad: ing.unidad_medida
                    };
                });
                console.log(`📦 [WEBSOCKET] ${ingredientesParaMovil.length} ingredientes listos para enviar.`);

                // --- NUEVO PARA SIMETRÍA PC ---
                window.listaMaestraPC = ingredientesParaMovil;
                window.ingredientesInventario = new Map(); // Reiniciar contados
                // -----------------------------
            }

            const datosInicioSesion = {
                sessionId: sessionId,
                usuario: {
                    id: usuarioSeleccionado,
                    nombre: usuarioInfo.nombre || "Usuario Desconocido"
                },
                sectores: sectores,
                ingredientes: ingredientesParaMovil, // <--- NUEVO: Lista Maestra
                tipo: "ingredientes"
            };

            console.log("📤 [WEBSOCKET] Enviando iniciar_inventario (UNIFICADO) con datos:", datosInicioSesion);

            socket.emit("iniciar_inventario", datosInicioSesion);

            // Iniciar Panel de Control PC: Actualizar listas ahora que tenemos datos
            if (typeof renderizarListasPC === 'function') {
                console.log("📡 [WEBSOCKET] Renderizando listas iniciales en PC...");
                renderizarListasPC();
            }
        });

        socket.on("inventario_iniciado", (data) => {
            console.log("🎉 [WEBSOCKET] SESION DE INVENTARIO INICIADA EXITOSAMENTE (UNIFICADO)");
            console.log("🎉 [WEBSOCKET] Datos de respuesta:", data);

            // Generar codigo QR para movil
            generarCodigoQR();

            mostrarMensaje("Sesion de inventario de ingredientes iniciada correctamente", "info");
        });

        // NUEVO: Listener de cancelación unificado (PC/Movil)
        socket.on('inventario_cancelado', () => {
            alert("⛔ EL INVENTARIO HA SIDO CANCELADO.");
            window.location.reload();
        });

        socket.on("nuevo_articulo", (data) => {
            console.log("📦 [WEBSOCKET] Nuevo item recibido desde movil:", data);

            // Determinar si es un ingrediente o un articulo (unificacion)
            const item = data.ingrediente || data.articulo;

            if (!item) {
                console.warn("⚠️ [WEBSOCKET] Datos recibidos sin item valido:", data);
                return;
            }

            if (ingredientesInventario.has(item.id.toString())) {
                console.log("🔄 [WEBSOCKET] Ingrediente existente, actualizando cantidad");
                const ingredienteExistente = ingredientesInventario.get(item.id.toString());
                ingredienteExistente.stock_contado = data.cantidad;

                const elementoExistente = document.querySelector(`[data-ingrediente-id="${item.id}"] .stock-input input`);
                if (elementoExistente) {
                    elementoExistente.value = data.cantidad;
                    // Efecto visual de actualizacion
                    elementoExistente.style.backgroundColor = "#d4edda";
                    setTimeout(() => elementoExistente.style.backgroundColor = "", 1000);

                    // Actualizar también la celda de diferencia si existe
                    const celdaDiff = document.querySelector(`[data-ingrediente-id="${item.id}"] .diferencia-stock`);
                    if (celdaDiff && ingredienteExistente.stock_sistema) {
                        const diff = data.cantidad - ingredienteExistente.stock_sistema;
                        celdaDiff.textContent = diff.toFixed(2);
                        celdaDiff.className = `diferencia-stock ${diff >= 0 ? 'text-success' : 'text-danger'}`;
                    }

                } else {
                    console.warn("⚠️ [WEBSOCKET] Elemento DOM no encontrado para ID:", item.id);
                }
            } else {
                console.log("➕ [WEBSOCKET] Ingrediente nuevo, agregando al inventario");
                agregarIngredienteAInventario(item, data.cantidad, true);
            }
        });

        socket.on("movil_conectado", (data) => {
            console.log("📱 [WEBSOCKET] Movil conectado:", data);
            mostrarMensaje("Dispositivo movil conectado", "info");

            // DEBUG: Trace data availability
            console.log("🔍 [DEBUG SYNC] Triggered movil_conectado");
            console.log("🔍 [DEBUG SYNC] window.listaMaestraPC:", window.listaMaestraPC ? window.listaMaestraPC.length + " items" : "UNDEFINED");
            console.log("🔍 [DEBUG SYNC] todosLosIngredientes:", typeof todosLosIngredientes !== 'undefined' ? todosLosIngredientes.length + " items" : "UNDEFINED");

            // AUTOMÁTICO: Enviar lista maestra de ingredientes al móvil
            // FIX: Enviar la lista FILTRADA (window.listaMaestraPC) no la global (todosLosIngredientes)
            const listaParaEnviar = window.listaMaestraPC || todosLosIngredientes;

            if (listaParaEnviar && listaParaEnviar.length > 0) {
                console.log("📤 [SYNC] Enviando lista maestra al móvil (" + listaParaEnviar.length + " items)");
                socket.emit("sincronizar_datos_inventario", {
                    sessionId: sessionId,
                    ingredientes: listaParaEnviar
                });
            } else {
                console.error("❌ [DEBUG SYNC] No hay lista para enviar. listaParaEnviar es empty/null");
            }
        });

        socket.on("imprimir_etiqueta_ingrediente", (data) => {
            console.log("🖨️ [WEBSOCKET] Solicitud de impresión recibida para ID:", data.ingredienteId);
            mostrarMensaje("🖨️ Imprimiendo etiqueta...", "info");

            // Intento 1: Función específica de ingredientes (definida en ingredientes.js o global)
            if (typeof window.imprimirEtiquetaIngrediente === 'function') {
                window.imprimirEtiquetaIngrediente(data.ingredienteId);
                return;
            }
            if (typeof imprimirEtiquetaIngrediente === 'function') {
                imprimirEtiquetaIngrediente(data.ingredienteId);
                return;
            }

            // Intento 2: Función genérica de etiquetas
            if (typeof window.imprimirEtiqueta === 'function') {
                window.imprimirEtiqueta(data.ingredienteId);
                return;
            }
            if (typeof imprimirEtiqueta === 'function') {
                imprimirEtiqueta(data.ingredienteId);
                return;
            }

            // Fallback: Error visual
            console.error("❌ Función de impresión no encontrada (imprimirEtiquetaIngrediente)");
            mostrarMensaje("Error: No se encontró la función de impresión en la PC", "error");
        });

        // NUEVO: Listener para cierre remoto desde móvil
        socket.on("solicitud_cierre_remoto", (data) => {
            console.log("🏁 [WEBSOCKET] Solicitud de cierre remoto recibida");
            mostrarMensaje("📱 El móvil ha solicitado finalizar el inventario. Procesando...", "info");

            // Ejecutar la función de cierre existente
            if (typeof finalizarInventario === 'function') {
                finalizarInventario();
            } else {
                console.error("❌ Función finalizarInventario no encontrada");
                mostrarMensaje("Error crítico: No se puede finalizar el inventario automáticmante", "error");
            }
        });

        socket.on("movil_desconectado", (data) => {
            console.log("📱 [WEBSOCKET] Movil desconectado:", data);
            mostrarMensaje("Dispositivo movil desconectado", "info");
        });

        socket.on("error_conexion", (data) => {
            console.error("❌ [WEBSOCKET] Error de conexion:", data);
            mostrarMensaje("Error de conexion: " + data.mensaje, "error");
        });

        socket.on("disconnect", () => {
            console.log("🔌 [WEBSOCKET] Desconectado del servidor");
        });

        socket.onAny((eventName, ...args) => {
            if (!["connect", "inventario_ingredientes_iniciado", "movil_conectado", "movil_desconectado", "nuevo_ingrediente", "disconnect"].includes(eventName)) {
                console.log("🔔 [WEBSOCKET] Evento WebSocket no manejado:", eventName, args);
            }
        });

    } catch (error) {
        console.error("❌ [WEBSOCKET] Error al inicializar WebSocket:", error);
        mostrarMensaje("Error al conectar con el servidor: " + error.message, "error");
    }
}

async function generarCodigoQR() {
    try {
        console.log("📱 [QR] Generando codigo QR para inventario de ingredientes");
        console.log("📱 [QR] Session ID:", sessionId);

        let baseUrl = window.location.origin;

        try {
            // Intentar obtener la IP real del servidor
            const response = await fetch('/api/config/network-ip');
            if (response.ok) {
                const data = await response.json();
                if (data.ip && data.ip !== 'localhost') {
                    const protocol = window.location.protocol;
                    const port = window.location.port ? ':' + window.location.port : '';
                    baseUrl = `${protocol}//${data.ip}${port}`;
                    console.log("🌐 [QR] IP de red detectada:", baseUrl);
                }
            }
        } catch (e) {
            console.warn("⚠️ [QR] No se pudo obtener IP de red, usando origen local:", e);
        }

        // URL corregida para apuntar directamente a la página
        const urlMovil = baseUrl + "/pages/inventario-movil.html?session=" + encodeURIComponent(sessionId);

        console.log("📱 [QR] URL generada final:", urlMovil);

        const urlElement = document.getElementById("url-movil");
        if (urlElement) {
            urlElement.textContent = urlMovil;
        }

        const qrContainer = document.getElementById("qr-canvas");
        if (qrContainer && typeof QRCode !== "undefined") {
            qrContainer.innerHTML = "";

            const qr = new QRCode(qrContainer, {
                text: urlMovil,
                width: 200,
                height: 200,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.M
            });

            console.log("✅ [QR] Codigo QR generado exitosamente");

            // INJECT: Visible URL for diagnostics
            let urlTextContainer = document.getElementById("qr-url-text");
            if (!urlTextContainer) {
                urlTextContainer = document.createElement("div");
                urlTextContainer.id = "qr-url-text";
                urlTextContainer.style.marginTop = "10px";
                urlTextContainer.style.padding = "8px";
                urlTextContainer.style.background = "#f0f0f0";
                urlTextContainer.style.border = "1px solid #ccc";
                urlTextContainer.style.borderRadius = "4px";
                urlTextContainer.style.fontFamily = "monospace";
                urlTextContainer.style.fontSize = "11px";
                urlTextContainer.style.wordBreak = "break-all";
                urlTextContainer.style.cursor = "text";
                urlTextContainer.style.userSelect = "text";
                urlTextContainer.style.textAlign = "center";
                urlTextContainer.style.color = "#333";
                qrContainer.parentNode.appendChild(urlTextContainer);
            }
            urlTextContainer.innerHTML = '<strong>Abre en tu navegador/móvil:</strong><br><a href="' + urlMovil + '" target="_blank" style="text-decoration:none; color:#0056b3;">' + urlMovil + '</a>';

        } else {
            console.error("❌ [QR] No se pudo generar el codigo QR - elemento o libreria no disponible");
        }

    } catch (error) {
        console.error("❌ [QR] Error al generar codigo QR:", error);
    }
}

async function agregarIngredienteAInventario(ingrediente, cantidadInicial = 0, esDesdeMovil = false) {
    console.log("🚀 [INVENTARIO] ===== AGREGANDO INGREDIENTE AL INVENTARIO =====");
    console.log("🚀 [INVENTARIO] Ingrediente:", ingrediente.nombre);
    console.log("🚀 [INVENTARIO] ID:", ingrediente.id);
    console.log("🚀 [INVENTARIO] Cantidad inicial:", cantidadInicial);
    console.log("🚀 [INVENTARIO] Ingredientes en inventario actual:", ingredientesInventario.size);

    const sectoresInfo = sessionStorage.getItem("sectoresInventario");
    if (sectoresInfo && sectoresInfo !== "TODOS") {
        try {
            const sectoresSeleccionados = JSON.parse(sectoresInfo);
            if (sectoresSeleccionados.length > 0) {
                const perteneceASector = sectoresSeleccionados.includes(ingrediente.sector_id);

                if (!perteneceASector) {
                    const nombresSectoresSeleccionados = sectoresSeleccionados.map(sectorId => {
                        const sector = todosLosSectores.find(s => s.id === sectorId);
                        return sector ? sector.nombre : "Sector " + sectorId;
                    }).join(", ");

                    const mensaje = "El ingrediente \"" + ingrediente.nombre + "\" no pertenece a los sectores seleccionados.\n\n" +
                        "• Sectores permitidos: " + nombresSectoresSeleccionados + "\n\n" +
                        "Este ingrediente no puede ser agregado al inventario.";

                    mostrarMensaje(mensaje, "error");
                    return;
                }
            }
        } catch (e) {
            console.error("❌ [INVENTARIO] Error al verificar sectores:", e);
        }
    }

    if (ingredientesInventario.has(ingrediente.id.toString())) {
        console.log("⚠️ [INVENTARIO] Ingrediente ya existe en inventario");
        if (esDesdeMovil) {
            const ingredienteExistente = ingredientesInventario.get(ingrediente.id.toString());
            ingredienteExistente.stock_contado = cantidadInicial;
            console.log("🔄 [INVENTARIO] Cantidad actualizada desde movil");
        } else {
            mostrarMensaje("Este ingrediente ya fue agregado al inventario", "info");
        }
        return;
    }

    const ingredienteInventario = {
        ...ingrediente,
        stock_contado: cantidadInicial
    };

    ingredientesInventario.set(ingrediente.id.toString(), ingredienteInventario);

    // --- NUEVO: SOPORTE PARA PANEL DE CONTROL ---
    if (window.listaMaestraPC) {
        console.log("📡 [INVENTARIO] Actualizando Panel de Control (Simetría PC-Movil)");
        renderizarListasPC();
        return; // Salir, no usar lógica legacy de DOM
    }
    // -------------------------------------------

    const div = document.createElement("div");
    div.className = "inventario-item";
    div.setAttribute("data-ingrediente-id", ingrediente.id);
    div.innerHTML =
        "<h4>" + ingrediente.nombre + "</h4>" +
        "<div class=\"info-row\">" +
        "<span><strong>ID:</strong> " + ingrediente.id + "</span>" +
        "<span><strong>Codigo:</strong> " + (ingrediente.codigo || "N/A") + "</span>" +
        "<span><strong>Stock actual:</strong> " + formatearNumero(ingrediente.stock_actual) + " " + (ingrediente.unidad_medida || "kg") + "</span>" +
        "</div>" +
        "<div class=\"stock-input\">" +
        "<label>Stock contado:</label>" +
        "<input type=\"number\" " +
        "step=\"0.01\" " +
        "min=\"0\" " +
        "value=\"" + cantidadInicial + "\" " +
        "data-ingrediente-id=\"" + ingrediente.id + "\">" +
        "<span>" + (ingrediente.unidad_medida || "kg") + "</span>" +
        "</div>";

    console.log("🔍 [INVENTARIO] Buscando contenedor ingredientes-inventario");
    const contenedor = document.getElementById("ingredientes-inventario");
    if (!contenedor) {
        console.error("❌ [INVENTARIO] ERROR CRITICO: No se encontro el contenedor ingredientes-inventario");
        mostrarMensaje("Error: No se pudo agregar el ingrediente al formulario", "error");
        return;
    }

    contenedor.insertBefore(div, contenedor.firstChild);

    const input = div.querySelector("input[type=\"number\"]");
    if (input) {
        input.addEventListener("input", function () {
            const nuevaCantidad = parseFloat(this.value) || 0;
            ingredientesInventario.get(ingrediente.id.toString()).stock_contado = nuevaCantidad;
            console.log("📝 [INVENTARIO] Cantidad actualizada para " + ingrediente.nombre + ": " + nuevaCantidad);
        });
    }

    const btnMostrarDiferencias = document.getElementById("btn-mostrar-diferencias");
    if (btnMostrarDiferencias && ingredientesInventario.size > 0) {
        btnMostrarDiferencias.style.display = "inline-block";
    }

    console.log("✅ [INVENTARIO] Ingrediente agregado exitosamente al inventario");
    console.log("✅ [INVENTARIO] Total ingredientes en inventario:", ingredientesInventario.size);
}

async function mostrarDiferencias() {
    try {
        console.log("📊 [DIFERENCIAS] ===== INICIANDO MOSTRAR DIFERENCIAS =====");

        const sectoresInfo = sessionStorage.getItem("sectoresInventario");
        let sectoresSeleccionados = [];

        if (sectoresInfo === "TODOS") {
            console.log("📊 [DIFERENCIAS] Procesando TODOS los sectores");
            sectoresSeleccionados = "TODOS";
        } else {
            try {
                sectoresSeleccionados = JSON.parse(sectoresInfo || "[]");
                console.log("📊 [DIFERENCIAS] Sectores especificos:", sectoresSeleccionados);
            } catch (e) {
                console.error("❌ [DIFERENCIAS] Error al parsear sectores:", e);
                mostrarMensaje("Error al obtener sectores seleccionados", "error");
                return;
            }
        }

        console.log("📊 [DIFERENCIAS] Obteniendo ingredientes de sectores...");
        const response = await fetch("/api/produccion/ingredientes/por-sectores", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ sectores: sectoresSeleccionados })
        });

        if (!response.ok) {
            throw new Error("Error al obtener ingredientes por sectores");
        }

        const ingredientesDeSectores = await response.json();
        console.log("📊 [DIFERENCIAS] Ingredientes obtenidos:", ingredientesDeSectores.length);

        const diferencias = [];

        ingredientesDeSectores.forEach(ingrediente => {
            const ingredienteContado = ingredientesInventario.get(ingrediente.id.toString());

            let stockContado = 0;
            let estado = "No contado";

            if (ingredienteContado) {
                stockContado = parseFloat(ingredienteContado.stock_contado) || 0;
                estado = "Contado";
            }

            const stockSistema = parseFloat(ingrediente.stock_actual) || 0;
            const diferencia = stockContado - stockSistema;

            diferencias.push({
                id: ingrediente.id,
                nombre: ingrediente.nombre,
                stock_sistema: stockSistema,
                stock_contado: stockContado,
                diferencia: diferencia,
                estado: estado,
                unidad_medida: ingrediente.unidad_medida || "kg"
            });
        });

        console.log("📊 [DIFERENCIAS] Total diferencias calculadas:", diferencias.length);

        mostrarModalDiferencias(diferencias);

    } catch (error) {
        console.error("❌ [DIFERENCIAS] Error al mostrar diferencias:", error);
        mostrarMensaje("Error al calcular diferencias: " + error.message, "error");
    }
}

function mostrarModalDiferencias(diferencias) {
    console.log("📊 [MODAL-DIFERENCIAS] Mostrando modal con " + diferencias.length + " diferencias");

    const modal = document.getElementById("modal-diferencias");
    const tbody = document.getElementById("tabla-diferencias-body");

    if (!modal || !tbody) {
        console.error("❌ [MODAL-DIFERENCIAS] No se encontraron elementos del modal");
        return;
    }

    tbody.innerHTML = "";

    if (diferencias.length === 0) {
        tbody.innerHTML = "<tr><td colspan=\"6\" class=\"mensaje-info\">No hay ingredientes en los sectores seleccionados</td></tr>";
    } else {
        diferencias.forEach(diferencia => {
            const tr = document.createElement("tr");

            let claseEstado = "";
            if (diferencia.estado === "No contado") {
                claseEstado = "stock-negativo";
            } else if (Math.abs(diferencia.diferencia) < 0.01) {
                claseEstado = "stock-cero";
            } else if (diferencia.diferencia > 0) {
                claseEstado = "stock-positivo";
            } else {
                claseEstado = "stock-negativo";
            }

            tr.innerHTML =
                "<td>" + diferencia.id + "</td>" +
                "<td>" + diferencia.nombre + "</td>" +
                "<td class=\"stock-cell\">" + formatearNumero(diferencia.stock_sistema) + " " + diferencia.unidad_medida + "</td>" +
                "<td class=\"stock-cell\">" + formatearNumero(diferencia.stock_contado) + " " + diferencia.unidad_medida + "</td>" +
                "<td class=\"stock-cell " + claseEstado + "\">" + formatearNumero(diferencia.diferencia) + " " + diferencia.unidad_medida + "</td>" +
                "<td><span class=\"" + (diferencia.estado === "Contado" ? "stock-positivo" : "stock-negativo") + "\">" + diferencia.estado + "</span></td>";

            tbody.appendChild(tr);
        });
    }

    modal.style.display = "block";
    console.log("✅ [MODAL-DIFERENCIAS] Modal mostrado correctamente");
}

document.addEventListener("DOMContentLoaded", function () {
    console.log("🚀 [INIT] Inicializando gestion de ingredientes... (VERSION FIX 4.1 - UI FIX)");
    console.log("🕒 [INIT] Timestamp de versión:", new Date().toISOString());

    cargarIngredientes();

    const filtroNombre = document.getElementById("filtro-nombre");
    const filtroStock = document.getElementById("filtro-stock");

    if (filtroNombre) {
        filtroNombre.addEventListener("input", aplicarFiltros);
    }

    if (filtroStock) {
        filtroStock.addEventListener("change", aplicarFiltros);
    }

    const selectUsuario = document.getElementById("select-usuario");
    if (selectUsuario) {
        selectUsuario.addEventListener("change", () => actualizarSeleccionUsuario(selectUsuario, "usuarioSeleccionado", "btn-continuar-usuario"));
    }

    const btnIniciarInventario = document.getElementById("btn-iniciar-inventario");
    if (btnIniciarInventario) {
        btnIniciarInventario.addEventListener("click", mostrarModal);
    }

    const btnContinuarUsuario = document.getElementById("btn-continuar-usuario");
    if (btnContinuarUsuario) {
        btnContinuarUsuario.addEventListener("click", mostrarPasoSectores);
    }

    const btnVolverUsuario = document.getElementById("btn-volver-usuario");
    if (btnVolverUsuario) {
        btnVolverUsuario.addEventListener("click", function () {
            document.getElementById("paso-sectores").style.display = "none";
            document.getElementById("paso-usuario").style.display = "block";
        });
    }

    const btnContinuarSectores = document.getElementById("btn-continuar-sectores");
    if (btnContinuarSectores) {
        btnContinuarSectores.addEventListener("click", function () {
            const checkboxTodos = document.getElementById("todos-sectores");

            if (checkboxTodos && checkboxTodos.checked) {
                sessionStorage.setItem("sectoresInventario", "TODOS");
                console.log("🏢 [SECTORES] Guardado: TODOS los sectores");
            } else {
                const sectoresCheckboxes = document.querySelectorAll(".sector-checkbox:checked");
                const sectoresSeleccionados = Array.from(sectoresCheckboxes).map(cb => parseInt(cb.dataset.sectorId));

                if (sectoresSeleccionados.length === 0) {
                    mostrarMensaje("Debe seleccionar al menos un sector o marcar \"Todos los sectores\"", "error");
                    return;
                }

                sessionStorage.setItem("sectoresInventario", JSON.stringify(sectoresSeleccionados));
                console.log("🏢 [SECTORES] Guardados sectores especificos:", sectoresSeleccionados);
            }

            mostrarPasoConteo();
        });
    }

    const inputCodigoBarras = document.getElementById("input-codigo-barras");
    if (inputCodigoBarras) {
        // 1. Enter key: Force Match (Barcode) or Action
        inputCodigoBarras.addEventListener("keypress", async (e) => {
            if (e.key === "Enter") {
                const codigo = e.target.value.trim();
                if (codigo) {
                    await buscarYAgregarIngrediente(codigo, true); // true = forceAction
                    // Input clearing is handled inside the function on success
                }
            }
        });

        // 2. Input event: Realtime Suggestions (Smart Mode)
        inputCodigoBarras.addEventListener("input", (e) => {
            const val = e.target.value.trim();

            // REGLA DE NEGOCIO: Discriminación de Entrada
            // Si empieza con número -> Asumir Código de Barras -> No hacer nada (esperar Enter)
            if (/^\d/.test(val)) {
                // Limpiar posibles sugerencias de texto previas
                const container = document.getElementById("resultados-busqueda-pc");
                if (container) container.innerHTML = "";
                return;
            }

            // Si es texto -> Modo Buscador Activo
            if (val.length >= 2) {
                buscarYAgregarIngrediente(val, false); // false = passive mode
            } else {
                const container = document.getElementById("resultados-busqueda-pc");
                if (container) container.innerHTML = "";
            }
        });
    }

    const btnFinalizarInventario = document.getElementById("btn-finalizar-inventario");
    if (btnFinalizarInventario) {
        btnFinalizarInventario.addEventListener("click", finalizarInventario);
    }

    // CORRECCIÓN: Usar delegación de eventos para los botones de cancelar
    // ya que hay múltiples botones con diferentes IDs en diferentes pasos
    document.addEventListener("click", function (e) {
        // Botón cancelar inventario (hay uno en cada paso del modal)
        if (e.target && e.target.id === "btn-cancelar-inventario") {
            console.log("🔘 [EVENTO] Botón cancelar inventario clickeado");
            cerrarModal();
        }

        // Botón X de cerrar modal de inventario
        if (e.target && e.target.id === "close-modal") {
            console.log("🔘 [EVENTO] Botón X de cerrar modal clickeado");
            cerrarModal();
        }
    });

    const btnMostrarDiferencias = document.getElementById("btn-mostrar-diferencias");
    if (btnMostrarDiferencias) {
        btnMostrarDiferencias.addEventListener("click", mostrarDiferencias);
    }

    // CORRECCIÓN: Usar delegación de eventos para modal de diferencias
    document.addEventListener("click", function (e) {
        // Botón cerrar diferencias
        if (e.target && e.target.id === "btn-cerrar-diferencias") {
            console.log("🔘 [EVENTO] Botón cerrar diferencias clickeado");
            document.getElementById("modal-diferencias").style.display = "none";
        }

        // Botón X de cerrar modal de diferencias
        if (e.target && e.target.id === "close-modal-diferencias") {
            console.log("🔘 [EVENTO] Botón X de cerrar diferencias clickeado");
            document.getElementById("modal-diferencias").style.display = "none";
        }
    });

    const btnGuardarCorrecciones = document.getElementById("btn-guardar-correcciones");
    if (btnGuardarCorrecciones) {
        btnGuardarCorrecciones.addEventListener("click", () => {
            document.getElementById("modal-diferencias").style.display = "none";
            mostrarMensaje("Las diferencias se aplicaran al finalizar el inventario", "info");
        });
    }

    // Botón para ajustes puntuales
    const btnAjustesPuntuales = document.getElementById("btn-ajustes-puntuales");
    if (btnAjustesPuntuales) {
        btnAjustesPuntuales.addEventListener("click", iniciarAjustesPuntuales);
    }

    const btnConfirmarSeleccion = document.getElementById("btn-confirmar-seleccion");
    if (btnConfirmarSeleccion) {
        btnConfirmarSeleccion.addEventListener("click", confirmarSeleccionIngredientes);
    }

    // Event listeners del modal de ajustes
    const btnContinuarAjustes = document.getElementById("btn-continuar-ajustes");
    if (btnContinuarAjustes) {
        btnContinuarAjustes.addEventListener("click", mostrarPasoAjuste);
    }

    // CORRECCIÓN: Usar delegación de eventos para modal de ajustes
    document.addEventListener("click", function (e) {
        // Botón cancelar ajustes (hay uno en cada paso)
        if (e.target && e.target.id === "btn-cancelar-ajustes") {
            console.log("🔘 [EVENTO] Botón cancelar ajustes clickeado");
            cerrarModalAjustes(true);
        }

        // Botón finalizar ajustes
        if (e.target && e.target.id === "btn-finalizar-ajustes") {
            console.log("🔘 [EVENTO] Botón finalizar ajustes clickeado");
            finalizarAjustesPuntuales();
        }

        // Botón X de cerrar modal de ajustes
        if (e.target && e.target.id === "close-modal-ajustes") {
            console.log("🔘 [EVENTO] Botón X de cerrar ajustes clickeado");
            cerrarModalAjustes(true);
        }
    });

    // Event listener para select de usuario de ajustes
    const selectUsuarioAjustes = document.getElementById("select-usuario-ajustes");
    if (selectUsuarioAjustes) {
        selectUsuarioAjustes.addEventListener("change", () => actualizarSeleccionUsuario(selectUsuarioAjustes, "usuarioAjustes", "btn-continuar-ajustes"));
    }

    // Event listener para seleccionar todos los ingredientes
    const seleccionarTodos = document.getElementById("seleccionar-todos");
    if (seleccionarTodos) {
        seleccionarTodos.addEventListener("change", function () {
            if (modoSeleccion) {
                const checkboxes = document.querySelectorAll(".checkbox-ingrediente");
                checkboxes.forEach(checkbox => {
                    checkbox.checked = this.checked;
                    const ingredienteId = checkbox.dataset.ingrediente;
                    const ingrediente = todosLosIngredientes.find(i => i.id.toString() === ingredienteId);

                    if (this.checked && ingrediente) {
                        ingredientesSeleccionados.set(ingredienteId, ingrediente);
                    } else {
                        ingredientesSeleccionados.delete(ingredienteId);
                    }
                });

                console.log("🔄 [SELECCION] Seleccionar todos:", this.checked ? "activado" : "desactivado");
                console.log("🔄 [SELECCION] Total seleccionados:", ingredientesSeleccionados.size);
            }
        });
    }

    console.log("✅ [INIT] Gestion de ingredientes inicializada correctamente");
});

// ===== FUNCIONES DE AJUSTES PUNTUALES =====

/**
 * Inicia el modo de ajustes puntuales
 */
function iniciarAjustesPuntuales() {
    console.log("⚙️ [AJUSTES] Iniciando ajustes puntuales");

    // Limpiar selecciones previas
    ingredientesSeleccionados.clear();

    // Activar modo selección en la tabla principal
    modoSeleccion = true;

    // Cambiar interfaz para modo selección
    const tabla = document.querySelector(".tabla-ingredientes");
    if (tabla) {
        tabla.classList.add("modo-seleccion");
    }

    // Cambiar botones del header
    document.getElementById("btn-ajustes-puntuales").style.display = "none";
    document.getElementById("btn-confirmar-seleccion").style.display = "inline-block";

    // Actualizar tabla para mostrar checkboxes
    actualizarTablaIngredientes(todosLosIngredientes);

    // Mostrar mensaje informativo
    mostrarMensaje("Seleccione los ingredientes que desea ajustar y luego presione 'Confirmar Selección'", "info");

    console.log("✅ [AJUSTES] Modo selección activado - Usuario puede seleccionar ingredientes");
}

/**
 * Confirma la selección de ingredientes y abre el modal de ajustes
 */
function confirmarSeleccionIngredientes() {
    console.log("✅ [SELECCION] Confirmando selección de ingredientes");
    console.log("✅ [SELECCION] Total seleccionados:", ingredientesSeleccionados.size);

    if (ingredientesSeleccionados.size === 0) {
        mostrarMensaje("Debe seleccionar al menos un ingrediente para ajustar", "error");
        return;
    }

    // Salir del modo selección visual
    const tabla = document.querySelector(".tabla-ingredientes");
    if (tabla) {
        tabla.classList.remove("modo-seleccion");
    }

    // Restaurar botones del header
    document.getElementById("btn-ajustes-puntuales").style.display = "inline-block";
    document.getElementById("btn-confirmar-seleccion").style.display = "none";

    // Actualizar tabla sin checkboxes
    modoSeleccion = false;
    actualizarTablaIngredientes(todosLosIngredientes);

    // AHORA SÍ mostrar modal de ajustes con ingredientes ya seleccionados
    const modal = document.getElementById("modal-ajustes");
    if (modal) {
        modal.style.display = "block";

        // Mostrar paso de selección de usuario
        document.getElementById("paso-usuario-ajustes").style.display = "block";
        document.getElementById("paso-ajuste").style.display = "none";

        // Cargar usuarios para ajustes
        cargarUsuariosAjustes();
    }

    console.log("✅ [SELECCION] Selección confirmada, modal de ajustes abierto");
}

/**
 * Muestra el paso de ajuste de ingredientes
 */
function mostrarPasoAjuste() {
    console.log("📝 [AJUSTES] Mostrando paso de ajuste");

    // Cambiar pasos del modal
    document.getElementById("paso-usuario-ajustes").style.display = "none";
    document.getElementById("paso-ajuste").style.display = "block";

    // Mostrar ingredientes seleccionados
    mostrarIngredientesSeleccionados();

    console.log("✅ [AJUSTES] Paso de ajuste mostrado");
}

/**
 * Muestra los ingredientes seleccionados en el modal de ajustes
 */
function mostrarIngredientesSeleccionados() {
    console.log("📋 [AJUSTES] Mostrando ingredientes seleccionados");

    const contenedor = document.getElementById("ingredientes-seleccionados");
    if (!contenedor) {
        console.error("❌ [AJUSTES] No se encontró contenedor ingredientes-seleccionados");
        return;
    }

    contenedor.innerHTML = "";

    if (ingredientesSeleccionados.size === 0) {
        contenedor.innerHTML = "<p class='mensaje-info'>No hay ingredientes seleccionados</p>";
        return;
    }

    ingredientesSeleccionados.forEach((ingrediente, id) => {
        const div = document.createElement("div");
        div.className = "inventario-item";
        div.setAttribute("data-ingrediente-id", ingrediente.id);

        div.innerHTML = `
            <h4>${ingrediente.nombre}</h4>
            <div class="info-row">
                <span><strong>ID:</strong> ${ingrediente.id}</span>
                <span><strong>Código:</strong> ${ingrediente.codigo || "N/A"}</span>
                <span><strong>Stock actual:</strong> ${formatearNumero(ingrediente.stock_actual)} ${ingrediente.unidad_medida || "kg"}</span>
            </div>
            <div class="stock-input">
                <label>Nuevo stock:</label>
                <input type="number" 
                       step="0.01" 
                       min="0" 
                       value="${ingrediente.stock_actual || 0}" 
                       data-ingrediente-id="${ingrediente.id}"
                       placeholder="Ingrese nuevo stock">
                <span>${ingrediente.unidad_medida || "kg"}</span>
            </div>
        `;

        contenedor.appendChild(div);

        // Agregar event listener al input
        const input = div.querySelector("input[type='number']");
        if (input) {
            input.addEventListener("input", function () {
                const nuevoStock = parseFloat(this.value) || 0;
                ingrediente.nuevo_stock = nuevoStock;
                console.log(`📝 [AJUSTES] Stock actualizado para ${ingrediente.nombre}: ${nuevoStock}`);
            });
        }
    });

    console.log(`✅ [AJUSTES] ${ingredientesSeleccionados.size} ingredientes mostrados para ajuste`);
}

/**
 * Carga usuarios para ajustes puntuales
 */
async function cargarUsuariosAjustes() {
    try {
        console.log("🔄 [USUARIOS-AJUSTES] Cargando usuarios para ajustes...");

        const response = await fetch("/api/usuarios?rol=3&activo=true");
        if (!response.ok) throw new Error("Error al cargar usuarios");

        const usuarios = await response.json();
        const select = document.getElementById("select-usuario-ajustes");
        if (select) {
            select.innerHTML = "<option value=''>-- Seleccionar usuario --</option>";

            usuarios.forEach(usuario => {
                const option = document.createElement("option");
                option.value = usuario.id;
                option.textContent = usuario.nombre_completo;
                select.appendChild(option);
            });
        }

        console.log("✅ [USUARIOS-AJUSTES] Usuarios cargados:", usuarios.length);

    } catch (error) {
        console.error("❌ [USUARIOS-AJUSTES] Error al cargar usuarios:", error);
        mostrarMensaje("No se pudieron cargar los usuarios para ajustes", "error");
    }
}

/**
 * Finaliza los ajustes puntuales aplicando los cambios
 */
async function finalizarAjustesPuntuales() {
    try {
        console.log("🏁 [AJUSTES] ===== FINALIZANDO AJUSTES PUNTUALES =====");

        if (!usuarioAjustes) {
            mostrarMensaje("Debe seleccionar un usuario responsable", "error");
            return;
        }

        if (ingredientesSeleccionados.size === 0) {
            mostrarMensaje("No hay ingredientes seleccionados para ajustar", "error");
            return;
        }

        // Preparar ajustes
        const ajustes = [];

        ingredientesSeleccionados.forEach((ingrediente, id) => {
            const stockActual = parseFloat(ingrediente.stock_actual) || 0;
            const nuevoStock = parseFloat(ingrediente.nuevo_stock) || 0;
            const ajuste = nuevoStock - stockActual;

            // Solo registrar si hay diferencia significativa
            if (Math.abs(ajuste) > 0.001) {
                ajustes.push({
                    articulo_numero: ingrediente.codigo || ingrediente.id.toString(),
                    usuario_id: usuarioAjustes,
                    tipo: "ajuste puntual",
                    kilos: ajuste,
                    cantidad: ajuste,
                    observacion: `Ajuste puntual - Stock anterior: ${stockActual}, Stock nuevo: ${nuevoStock}`
                });

                console.log(`📝 [AJUSTES] Ajuste preparado: ${ingrediente.nombre} = ${ajuste}`);
            }
        });

        if (ajustes.length === 0) {
            mostrarMensaje("No hay cambios significativos para aplicar", "info");
            return;
        }

        console.log(`📤 [AJUSTES] Enviando ${ajustes.length} ajustes al servidor...`);
        mostrarMensaje("Aplicando ajustes...", "info");

        // Enviar ajustes al servidor usando el endpoint específico para ingredientes
        const response = await fetch("/api/produccion/ingredientes-ajustes/batch", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ajustes })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Error al aplicar ajustes");
        }

        const resultado = await response.json();
        console.log("✅ [AJUSTES] Ajustes aplicados exitosamente:", resultado);

        mostrarMensaje(`Ajustes aplicados correctamente. ${ajustes.length} ingredientes actualizados.`, "info");

        // Cerrar modal y limpiar
        cerrarModalAjustes(true);

        // Recargar ingredientes para mostrar cambios
        await cargarIngredientes();

    } catch (error) {
        console.error("❌ [AJUSTES] Error al finalizar ajustes:", error);
        mostrarMensaje("Error al aplicar ajustes: " + error.message, "error");
    }
}

/**
 * Cierra el modal de ajustes y limpia el estado
 */
function cerrarModalAjustes(reiniciarTodo = true) {
    console.log("🔄 [AJUSTES] Cerrando modal de ajustes");

    const modal = document.getElementById("modal-ajustes");
    if (modal) {
        modal.style.display = "none";
    }

    if (reiniciarTodo) {
        // Limpiar selecciones
        ingredientesSeleccionados.clear();
        usuarioAjustes = null;

        // Salir del modo selección
        modoSeleccion = false;
        const tabla = document.querySelector(".tabla-ingredientes");
        if (tabla) {
            tabla.classList.remove("modo-seleccion");
        }

        // Restaurar botones del header
        document.getElementById("btn-ajustes-puntuales").style.display = "inline-block";
        document.getElementById("btn-confirmar-seleccion").style.display = "none";

        // Limpiar contenedor
        const contenedor = document.getElementById("ingredientes-seleccionados");
        if (contenedor) {
            contenedor.innerHTML = "";
        }

        // Resetear pasos del modal
        document.getElementById("paso-usuario-ajustes").style.display = "block";
        document.getElementById("paso-ajuste").style.display = "none";

        // Resetear select de usuario
        const selectUsuario = document.getElementById("select-usuario-ajustes");
        if (selectUsuario) {
            selectUsuario.value = "";
        }

        const btnContinuar = document.getElementById("btn-continuar-ajustes");
        if (btnContinuar) {
            btnContinuar.disabled = true;
        }

        // Actualizar tabla sin checkboxes
        actualizarTablaIngredientes(todosLosIngredientes);

        console.log("✅ [AJUSTES] Modal cerrado y estado limpiado");
    }
}

function actualizarSeleccionUsuario(selectElement, variableGlobal, botonId) {
    const valorSeleccionado = selectElement.value;
    const boton = document.getElementById(botonId);

    if (valorSeleccionado) {
        if (variableGlobal === "usuarioSeleccionado") {
            usuarioSeleccionado = parseInt(valorSeleccionado);
        } else if (variableGlobal === "usuarioAjustes") {
            usuarioAjustes = parseInt(valorSeleccionado);
        }

        if (boton) boton.disabled = false;
        console.log("✅ [USUARIO] " + variableGlobal + " seleccionado:", valorSeleccionado);
    } else {
        if (variableGlobal === "usuarioSeleccionado") {
            usuarioSeleccionado = null;
        } else if (variableGlobal === "usuarioAjustes") {
            usuarioAjustes = null;
        }

        if (boton) boton.disabled = true;
        console.log("❌ [USUARIO] " + variableGlobal + " deseleccionado");
    }
}

// Buscador Inteligente PC (Local + Space AND)
// Buscador Inteligente PC (Local + Space AND)
async function buscarYAgregarIngrediente(texto, forceAction = false) {
    // console.log("🔍 [BUSCAR] Iniciando búsqueda inteligente:", texto, "Force:", forceAction);

    let lista = window.listaMaestraPC || [];
    if (lista.length === 0 && typeof todosLosIngredientes !== 'undefined') {
        lista = todosLosIngredientes;
    }

    if (lista.length === 0) {
        if (forceAction) mostrarMensaje("⚠️ Lista de ingredientes vacía o cargando...", "warning");
        return;
    }

    // 2. Filtrar
    const resultados = filtrarPorNombre(lista, texto);

    // (OPCIONAL) Visual Sync: Filtrar tab pendientes si es la activa
    const tabPendientes = document.getElementById("view-pendientes-pc");
    if (tabPendientes && tabPendientes.style.display !== 'none' && !forceAction) {
        renderizarListasModalPC('pendientes', texto);
    }

    // Limpiar resultados anteriores
    const container = document.getElementById("resultados-busqueda-pc");
    if (container) container.innerHTML = "";

    // 3. Lógica de coincidencias
    if (resultados.length === 0) {
        if (forceAction) mostrarMensaje("❌ No se encontraron ingredientes con: " + texto, "error");
        return;
    }

    // Si es Enter (Force Action) y hay 1 resultado, actuar Directamente
    if (forceAction && resultados.length === 1) {
        const ing = resultados[0];
        window.actualizarStockDesdePC(ing.id, prompt(`Ingresar Stock para ${ing.nombre}:`, parseFloat(ing.stock_actual || 0)));

        // Limpieza de Campo (Requisito: Clean Slate)
        const input = document.getElementById("input-codigo-barras");
        if (input) input.value = "";
        return;
    }

    // Múltiples coincidencias -> Mostrar sugerencias
    mostrarSugerenciasBusquedaPC(resultados);
}

function mostrarSugerenciasBusquedaPC(resultados) {
    // Buscar donde inyectar. Idealmente en view-carga-pc
    const parent = document.getElementById("view-carga-pc");
    if (!parent) return;

    let container = document.getElementById("resultados-busqueda-pc");
    if (!container) {
        container = document.createElement("div");
        container.id = "resultados-busqueda-pc";
        container.style.marginTop = "20px";
        container.style.textAlign = "left";
        container.style.maxHeight = "200px";
        container.style.overflowY = "auto";
        container.style.border = "1px solid #ddd"; // Visual Frame

        // Insertar después del input
        const input = document.getElementById("input-codigo-barras");
        if (input && input.parentElement) {
            input.parentElement.appendChild(container);
        } else {
            parent.appendChild(container);
        }
    }

    container.innerHTML = resultados.map(ing => `
        <div onclick="window.actualizarStockDesdePC(${ing.id}, prompt('Cantidad para ${ing.nombre}:', '${parseFloat(ing.stock_actual || 0) || 0}'))"
             style="padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; background: white; transition: background 0.2s;">
            <div style="font-weight: bold;">${ing.nombre}</div>
            <div style="font-size: 0.8em; color: #666;">
                COD: ${ing.codigo || '-'} | Stock Sys: ${ing.stock_actual || 0}
            </div>
        </div>
    `).join('');

    // Scroll to results
    container.scrollIntoView({ behavior: 'smooth' });
}



async function finalizarInventario() {
    try {
        console.log("🏁 [FINALIZAR] ===== INICIANDO FINALIZACION DE INVENTARIO =====");
        console.log("🏁 [FINALIZAR] Session ID:", sessionId);
        console.log("🏁 [FINALIZAR] Ingredientes en inventario:", ingredientesInventario.size);

        if (!sessionId) {
            console.error("❌ [FINALIZAR] ERROR: No hay sesion activa");
            mostrarMensaje("Error: No hay una sesion de inventario activa", "error");
            return;
        }

        // CAMBIO IMPORTANTE: Obtener todos los ingredientes del sector para procesar
        const sectoresInfo = sessionStorage.getItem("sectoresInventario");
        let sectoresSeleccionados = [];

        if (sectoresInfo === "TODOS") {
            sectoresSeleccionados = "TODOS";
        } else {
            try {
                sectoresSeleccionados = JSON.parse(sectoresInfo || "[]");
            } catch (e) {
                console.error("❌ [FINALIZAR] Error al parsear sectores:", e);
                mostrarMensaje("Error al obtener sectores seleccionados", "error");
                return;
            }
        }

        console.log("📊 [FINALIZAR] Obteniendo todos los ingredientes de sectores para ajuste...");
        const response = await fetch("/api/produccion/ingredientes/por-sectores", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ sectores: sectoresSeleccionados })
        });

        if (!response.ok) {
            throw new Error("Error al obtener ingredientes por sectores");
        }

        const ingredientesDeSectores = await response.json();
        console.log("📊 [FINALIZAR] Ingredientes del sector obtenidos:", ingredientesDeSectores.length);

        // Crear array con TODOS los ingredientes del sector (contados y no contados)
        const ingredientesParaProcesar = [];

        ingredientesDeSectores.forEach(ingrediente => {
            const ingredienteContado = ingredientesInventario.get(ingrediente.id.toString());

            if (ingredienteContado) {
                // Ingrediente fue contado - usar cantidad contada
                ingredientesParaProcesar.push({
                    ingrediente_id: ingrediente.id,
                    stock_actual: ingrediente.stock_actual,
                    stock_contado: parseFloat(ingredienteContado.stock_contado) || 0,
                    nombre: ingrediente.nombre
                });
                console.log("📝 [FINALIZAR] Ingrediente contado: " + ingrediente.nombre + " = " + ingredienteContado.stock_contado);
            } else {
                // Ingrediente NO fue contado - ajustar a 0 (protocolo: no contado = físicamente 0)
                ingredientesParaProcesar.push({
                    ingrediente_id: ingrediente.id,
                    stock_actual: ingrediente.stock_actual,
                    stock_contado: 0,
                    nombre: ingrediente.nombre
                });
                console.log("📝 [FINALIZAR] Ingrediente NO contado (ajustar a 0): " + ingrediente.nombre);
            }
        });

        console.log("📋 [FINALIZAR] Preparando datos para envio...");
        console.log("📋 [FINALIZAR] Total ingredientes a procesar:", ingredientesParaProcesar.length);
        console.log("📋 [FINALIZAR] Ingredientes contados:", ingredientesInventario.size);
        console.log("📋 [FINALIZAR] Ingredientes a ajustar a 0:", ingredientesParaProcesar.length - ingredientesInventario.size);

        mostrarMensaje("Procesando inventario...", "info");

        console.log("📤 [FINALIZAR] Enviando request a API...");
        console.log("📤 [FINALIZAR] URL:", "/api/produccion/inventario-ingredientes/" + sessionId + "/aplicar");

        const responseAplicar = await fetch("/api/produccion/inventario-ingredientes/" + sessionId + "/aplicar", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                ingredientes_contados: ingredientesParaProcesar,
                usuario_id: usuarioSeleccionado
            })
        });

        console.log("📥 [FINALIZAR] Respuesta recibida - Status:", responseAplicar.status);

        if (!responseAplicar.ok) {
            const errorData = await responseAplicar.json();
            throw new Error(errorData.error || "Error al finalizar inventario");
        }

        const resultado = await responseAplicar.json();
        console.log("✅ [FINALIZAR] Inventario finalizado exitosamente:", resultado);

        const mensajeExito = "Inventario finalizado correctamente.\n" +
            "• Ajustes aplicados: " + resultado.ajustes_aplicados + "\n" +
            "• Ingredientes procesados: " + ingredientesParaProcesar.length + "\n" +
            "• Ingredientes contados: " + ingredientesInventario.size + "\n" +
            "• Ingredientes ajustados a 0: " + (ingredientesParaProcesar.length - ingredientesInventario.size);

        mostrarMensaje(mensajeExito, "info");

        cerrarModal();

        await cargarIngredientes();

    } catch (error) {
        console.error("❌ [FINALIZAR] Error al finalizar inventario:", error);
        console.error("❌ [FINALIZAR] Stack trace:", error.stack);
        mostrarMensaje("Error al finalizar inventario: " + error.message, "error");
    }
}


window.tabActualPC = 'carga'; // Default tab

function configurarPanelControlUI() {
    console.log("🎨 [PANEL] Configurando UI del Panel de Control");

    // Reset steps
    document.querySelectorAll('.paso-modal').forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
    });

    const pasoConteo = document.getElementById('paso-conteo');
    if (pasoConteo) {
        pasoConteo.classList.add('active');
        pasoConteo.style.display = 'block';
    }

    // Init Defaults
    cambiarTabPC('carga');

    // Bind global buttons
    const btnImpSector = document.getElementById('btn-imprimir-sector-pc');
    if (btnImpSector) btnImpSector.onclick = imprimirEtiquetaSectorPC;

    const btnCancel = document.getElementById('btn-cancelar-inventario-pc');
    if (btnCancel) btnCancel.onclick = cancelarInventarioPC;
}

window.cambiarTabPC = function (tab) {
    window.tabActualPC = tab;

    // 1. Update Buttons
    document.querySelectorAll('.tab-btn').forEach(b => {
        if (b.id === `tab-${tab}-pc`) {
            b.classList.add('active');
            b.style.background = 'white';
            b.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            b.style.color = '#333';
        } else {
            b.classList.remove('active');
            b.style.background = 'none';
            b.style.boxShadow = 'none';
            b.style.color = '#666';
        }
    });

    // 2. Update Views
    // Hide all
    ['carga', 'pendientes', 'contados'].forEach(t => {
        const v = document.getElementById(`view-${t}-pc`);
        if (v) v.style.display = 'none';
    });

    // Show active
    const activeView = document.getElementById(`view-${tab}-pc`);
    if (activeView) activeView.style.display = 'block';

    // 3. Render lists if needed
    if (tab === 'pendientes' || tab === 'contados') {
        renderizarListasPC();
    }
};

function renderizarListasPC() {
    if (!window.listaMaestraPC) {
        console.warn("⚠️ [PANEL] No hay lista maestra para renderizar");
        return;
    }

    // 1. Filtrar Contados vs Pendientes
    const contadosIds = new Set(window.ingredientesInventario.keys());

    const pendientes = window.listaMaestraPC.filter(i => !contadosIds.has(i.id.toString()));
    const contados = Array.from(window.ingredientesInventario.values());

    // 2. Actualizar Contadores
    const countP = document.getElementById('count-pendientes-pc');
    const countC = document.getElementById('count-contados-pc');
    if (countP) countP.textContent = pendientes.length;
    if (countC) countC.textContent = contados.length;

    // 3. Renderizar Pendientes
    const divPendientes = document.getElementById('lista-pendientes-pc');
    if (divPendientes) {
        if (pendientes.length === 0) {
            divPendientes.innerHTML = `<div style="text-align:center; padding:20px; color:#999;">✨ ¡Todo contado!</div>`;
        } else {
            divPendientes.innerHTML = pendientes.map(i => `
                <div class="inventario-item" style="border-left: 4px solid #ffc107; padding: 10px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <div>
                        <strong style="color: #333;">${i.nombre}</strong><br>
                        <small style="color: #666;">ID: ${i.id} | Stock Sys: ${formatearNumero(i.stock_sistema || 0)} ${i.unidad}</small>
                    </div>
                    <button class="btn-xs" onclick="imprimirEtiquetaIngrediente('${i.id}')" style="background: none; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; padding: 5px;">🖨️</button>
                </div>
            `).join('');
        }
    }

    // 4. Renderizar Contados
    const divContados = document.getElementById('lista-contados-pc');
    if (divContados) {
        const contadosReverse = [...contados].reverse(); // Ver los ultimos primero

        divContados.innerHTML = contadosReverse.map(i => `
            <div class="inventario-item" style="border-left: 4px solid #28a745; padding: 10px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <div>
                    <strong style="color: #333;">${i.nombre}</strong><br>
                    <span style="color: #28a745; font-weight: bold;">Contado: ${formatearNumero(i.stock_contado)} ${i.unidad || 'kg'}</span>
                </div>
                 <button class="btn-xs" onclick="imprimirEtiquetaIngrediente('${i.id}')" style="background: none; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; padding: 5px;">🖨️</button>
            </div>
        `).join('');
    }
}

function cancelarInventarioPC() {
    if (confirm("⛔ ¿ESTÁS SEGURO DE CANCELAR EL INVENTARIO?\n\nEsta acción cerrará la sesión para TODOS (PC y Móvil) y perderá los datos no guardados.")) {
        socket.emit('cancelar_inventario', { sessionId });
    }
}


/**
 * Renderiza la tabla de ingredientes basada en la lista maestra (Modo Unificado con Movil)
 * Reemplaza la logica antigua que usaba arrays separados.
 */
function renderizarListasPC(tab = 'carga') { // carga (default) | contados | pendientes
    const container = document.getElementById("tabla-ingredientes-body");
    if (!container) return;

    container.innerHTML = "";

    // Obtener lista base (window.listaMaestraPC es la fuente de verdad sincronizada)
    let lista = window.listaMaestraPC || [];

    // Si no hay lista maestra aun, intentar usar todosLosIngredientes si tiene ID
    if (lista.length === 0 && (typeof todosLosIngredientes !== 'undefined') && todosLosIngredientes.length > 0) {
        lista = todosLosIngredientes;
    }

    if (lista.length === 0) {
        container.innerHTML = `<tr><td colspan="6" class="mensaje-info">Esperando datos de ingredientes...</td></tr>`;
        return;
    }

    // Filtrar segun Tab
    if (tab === 'pendientes') {
        lista = lista.filter(i => {
            const enInv = ingredientesInventario.has(i.id.toString());
            return !enInv;
        });
    } else if (tab === 'contados') {
        lista = lista.filter(i => ingredientesInventario.has(i.id.toString()));
    }
    // 'carga' muestra TODO.

    lista.forEach(ing => {
        // Estado contado
        const enInventario = ingredientesInventario.has(ing.id.toString());
        const datosInv = enInventario ? ingredientesInventario.get(ing.id.toString()) : null;

        const stockSistema = parseFloat(ing.stock_actual || ing.stock_sistema || 0);
        const stockContado = datosInv ? parseFloat(datosInv.stock_contado || 0) : 0;
        const diferencia = stockContado - stockSistema;

        const tr = document.createElement("tr");

        // CRITICAL FIX: Attribute for Real-time Selector
        tr.setAttribute("data-ingrediente-id", ing.id);

        if (enInventario) {
            tr.classList.add("fila-contada"); // Verde suave
            tr.style.backgroundColor = "#e8f5e9";
        }

        tr.innerHTML = `
            <td>${ing.id}</td>
            <td>${ing.nombre}</td>
            <td>${ing.codigo || ''}</td>
            <td>${stockSistema.toFixed(2)} ${ing.unidad_medida || 'kg'}</td>
            <td class="stock-input">
                <input type="number" 
                       step="0.01" 
                       value="${enInventario ? stockContado : ''}" 
                       placeholder="0.00"
                       class="form-control form-control-sm"
                       onchange="actualizarStockDesdePC(${ing.id}, this.value)"
                       title="Ingresar stock contado manualmente">
            </td>
            <td class="diferencia-stock ${enInventario ? (diferencia >= 0 ? 'text-success' : 'text-danger') : ''}">
                ${enInventario ? diferencia.toFixed(2) : '-'}
            </td>
        `;

        container.appendChild(tr);
    });

    // ... (Main Table logic remains) ...
    // NOTE: Keep previous logic for main table, append this:

    // --- LOGIC FOR MODAL TABS (If active) ---
    renderizarListasModalPC();
    actualizarContadoresPC();

    console.log(`📊 [RENDER PC] Tabla actualizada (${tab}). ${lista.length} items mostrados.`);
}

/**
 * Renderiza las listas dentro del Modal de Conteo (Inventario Activo)
 */
function renderizarListasModalPC() {
    const pendientesDiv = document.getElementById("lista-pendientes-pc");
    const contadosDiv = document.getElementById("lista-contados-pc");

    // Solo si el modal existe
    if (!pendientesDiv || !contadosDiv) return;

    let lista = window.listaMaestraPC || [];
    if (lista.length === 0 && (typeof todosLosIngredientes !== 'undefined') && todosLosIngredientes.length > 0) {
        lista = todosLosIngredientes;
    }

    // 1. PENDIENTES
    const pendientes = lista.filter(i => !ingredientesInventario.has(i.id.toString()));
    pendientesDiv.innerHTML = pendientes.length === 0
        ? '<div style="text-align:center; padding:20px; color:#999;">¡Todo contado! 🎉</div>'
        : pendientes.map(ing => `
            <div class="item-pendiente" style="padding: 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${ing.nombre}</strong><br>
                    <small style="color:#888;">Cod: ${ing.codigo || '-'}</small>
                </div>
                <div style="text-align: right; display: flex; gap: 5px; align-items: center;">
                    <span style="background: #eee; padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">
                        Sys: ${parseFloat(ing.stock_actual || 0).toFixed(2)}
                    </span>
                    <button class="btn btn-sm btn-outline-secondary" onclick="window.imprimirEtiquetaIngredientePC(${ing.id})" title="Imprimir Etiqueta">
                        🖨️
                    </button>
                    <button class="btn-sm btn-primary" onclick="window.actualizarStockDesdePC(${ing.id}, prompt('Cantidad para ${ing.nombre}:', '${parseFloat(ing.stock_actual || 0)}'))">
                        📝
                    </button>
                </div>
            </div>
        `).join('');

    // 2. CONTADOS
    const contados = lista.filter(i => ingredientesInventario.has(i.id.toString()));
    contadosDiv.innerHTML = contados.length === 0
        ? '<div style="text-align:center; padding:20px; color:#999;">Aún no hay items contados</div>'
        : contados.map(ing => {
            const dataInv = ingredientesInventario.get(ing.id.toString());
            const cant = parseFloat(dataInv.stock_contado || 0);
            return `
            <div class="item-contado" style="padding: 10px; border-bottom: 1px solid #eee; background: #f9fff9; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong style="color: green;">${ing.nombre}</strong><br>
                    <small style="color:#666;">Contado: <strong>${cant.toFixed(2)}</strong></small>
                </div>
                 <div style="text-align: right; display: flex; gap: 5px; align-items: center;">
                    <button class="btn btn-sm btn-outline-secondary" onclick="window.imprimirEtiquetaIngredientePC(${ing.id})" title="Imprimir Etiqueta">
                        🖨️
                    </button>
                    <button class="btn-sm btn-secondary" onclick="window.actualizarStockDesdePC(${ing.id}, prompt('Corregir cantidad ${ing.nombre}:', '${cant}'))">
                        ✏️
                    </button>
                </div>
            </div>
        `}).join('');
}

/**
 * Imprime etiqueta individual desde PC
 */
window.imprimirEtiquetaIngredientePC = (id) => {
    const item = window.listaMaestraPC.find(i => i.id === id);
    if (item) {
        console.log("🖨️ [PRINT PC] Solicitando impresión para:", item.nombre);
        socket.emit('imprimir_etiqueta_ingrediente', {
            sessionId,
            ingrediente: item,
            impresora: 'ZEBRA_FRENTE'
        });
        mostrarToast("🖨️ Enviando a impresora...");
    } else {
        mostrarMensaje("Error al encontrar ingrediente para imprimir", "error");
    }
};

function actualizarContadoresPC() {
    let lista = window.listaMaestraPC || [];
    if (lista.length === 0 && (typeof todosLosIngredientes !== 'undefined') && todosLosIngredientes.length > 0) {
        lista = todosLosIngredientes;
    }

    const total = lista.length;
    const contadosCount = ingredientesInventario.size; // Aproximado, mejor filtrar lista

    // Calculo exacto basado en lista maestra
    const contadosReal = lista.filter(i => ingredientesInventario.has(i.id.toString())).length;
    const pendientesCount = total - contadosReal;

    const elPend = document.getElementById("count-pendientes-pc");
    const elCont = document.getElementById("count-contados-pc");

    if (elPend) elPend.textContent = pendientesCount;
    if (elCont) elCont.textContent = contadosReal;

    console.log(`📊 [COUNTERS PC] Pend: ${pendientesCount}, Cont: ${contadosReal}`);
}

// Helper para input manual en PC (Bidireccionalidad)
// Helper para input manual en PC (Bidireccionalidad)
window.actualizarStockDesdePC = (id, valor) => {
    if (valor === null) return; // Prompt cancelado

    // 1. Limpieza de datos (Comas a puntos)
    let valClean = String(valor).replace(',', '.').trim();
    if (valClean === "") valClean = "0";

    const cantidad = parseFloat(valClean);

    if (isNaN(cantidad)) {
        alert("Por favor ingrese un número válido.");
        return;
    }

    const item = window.listaMaestraPC.find(i => i.id === id);
    if (item) {
        // Actualizar local (Optimistic)
        if (ingredientesInventario.has(id.toString())) {
            const exist = ingredientesInventario.get(id.toString());
            exist.stock_contado = cantidad;
        } else {
            ingredientesInventario.set(id.toString(), { ...item, stock_contado: cantidad });
        }

        // 2. Logging Requerido
        console.log(`📤 [PC GUARDADO] Enviando cantidad: ${cantidad} para el ingrediente: ${id} (${item.nombre})`);

        // 3. Emitir a Server
        socket.emit('articulo_escaneado', {
            sessionId,
            ingrediente: item,
            cantidad: cantidad
        });

        // Feedback visual inmediato (Renderizar)
        renderizarListasPC();
    }
};


function imprimirEtiquetaSectorPC() {
    // Usar sectores global (Recuperado de window)
    const sectores = window.sectoresSesionActiva;

    if (typeof sectores === 'undefined' || !sectores || !sectores.length) {
        mostrarMensaje("⚠️ No hay sectores disponibles para imprimir.", "error");
        console.error("❌ [PRINT] window.sectoresSesionActiva es undefined o vacio", sectores);
        return;
    }

    const modal = document.getElementById('modal-imprimir-sectores');
    const container = document.getElementById('lista-sectores-imprimir');
    const btnConfirmar = document.getElementById('btn-confirmar-impresion-sectores');
    const btnCancelar = document.getElementById('btn-cancelar-impresion-sectores');
    const btnCerrar = document.getElementById('close-modal-imprimir-sectores');

    if (!modal || !container) {
        console.error("❌ Modal de impresion de sectores no encontrado");
        return;
    }

    // Limpiar y poblar lista
    container.innerHTML = '';

    // Header para "Marcar Todos"
    const divTodos = document.createElement('div');
    divTodos.style.padding = "5px";
    divTodos.style.borderBottom = "1px solid #eee";
    divTodos.style.marginBottom = "5px";
    divTodos.innerHTML = `
        <label style="font-weight: bold; display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="check-todos-sectores-print" checked> 
            <span style="margin-left: 8px;">Seleccionar Todos</span>
        </label>
    `;
    container.appendChild(divTodos);

    const checkTodos = divTodos.querySelector('input');

    // Listar sectores
    sectores.forEach((sect, index) => {
        const desc = typeof sect === 'object' ? (sect.descripcion || sect.nombre || '') : String(sect);

        // Intentar limpiar el nombre para mostrarlo bonito
        let nombreMostrar = desc;
        const match = desc.match(/["']([^"']+)["']/);
        if (match && match[1]) nombreMostrar = `Sector ${match[1].toUpperCase()}`;

        const div = document.createElement('div');
        div.className = 'sector-item-print';
        div.style.padding = "8px";
        div.style.borderBottom = "1px solid #f0f0f0";
        div.innerHTML = `
            <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox" class="check-sector-print" value="${index}" checked>
                <span style="margin-left: 10px;">${nombreMostrar}</span>
            </label>
        `;
        container.appendChild(div);
    });

    // Evento para "Marcar Todos"
    checkTodos.onchange = (e) => {
        const checks = container.querySelectorAll('.check-sector-print');
        checks.forEach(c => c.checked = e.target.checked);
    };

    // Mostrar Modal
    modal.style.display = 'block';

    // Handler Cancelar/Cerrar
    const cerrarModal = () => {
        modal.style.display = 'none';
    };
    btnCancelar.onclick = cerrarModal;
    btnCerrar.onclick = cerrarModal;

    // Handler Confirmar
    btnConfirmar.onclick = () => {
        const selectedIndices = Array.from(container.querySelectorAll('.check-sector-print:checked')).map(c => parseInt(c.value));

        if (selectedIndices.length === 0) {
            alert("⚠️ Selecciona al menos un sector para imprimir.");
            return;
        }

        if (confirm(`¿Imprimir etiquetas para ${selectedIndices.length} sectores seleccionados?`)) {
            let imprimidos = 0;

            selectedIndices.forEach(idx => {
                const s = sectores[idx];
                const cleanDesc = typeof s === 'object' ? (s.descripcion || s.nombre || '') : String(s);

                socket.emit('imprimir_etiqueta_sector', { sector: cleanDesc });
                imprimidos++;
            });

            mostrarMensaje(`🖨️ Enviando ${imprimidos} etiquetas de sector...`, "info");
            cerrarModal();
        }
    };
}


