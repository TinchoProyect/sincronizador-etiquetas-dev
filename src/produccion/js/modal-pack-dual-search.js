// ===== MODAL PACK CON BÚSQUEDA DUAL (CÓDIGO Y DESCRIPCIÓN) =====

// Variables globales para el modal
let articulosDisponibles = [];
let hijoSeleccionado = null;
let indiceSeleccionado = -1;
let busquedaTimeout = null;
let modoActual = 'codigo';

// Normalizar texto (quitar acentos, minúsculas y ñ→n)
function normalizarTexto(texto) {
    if (!texto) return '';
    return texto.toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ñ/g, 'n');
}

// Detectar si parece código de barras (solo dígitos)
function pareceCodigoBarras(texto) {
    return /^\d+$/.test(texto.trim());
}

// Cambiar modo de búsqueda
function cambiarModoBusqueda(nuevoModo) {
    modoActual = nuevoModo;
    const btnCodigo = document.getElementById('btn-busqueda-codigo');
    const btnDescripcion = document.getElementById('btn-busqueda-descripcion');
    const containerCodigo = document.getElementById('search-codigo-container');
    const containerDescripcion = document.getElementById('search-descripcion-container');
    const inputCodigo = document.getElementById('pack-hijo-codigo-input');
    const inputDescripcion = document.getElementById('pack-hijo-busqueda');
    const ayudaCodigo = document.getElementById('ayuda-busqueda-codigo');
    const avisoCodigoBarras = document.getElementById('aviso-codigo-barras');
    if (!btnCodigo || !btnDescripcion) { console.log('[PACK-ERR] Botones no encontrados'); return; }
    if (nuevoModo === 'codigo') {
        btnCodigo.classList.add('active'); btnDescripcion.classList.remove('active');
        if (containerCodigo) containerCodigo.style.display = 'block';
        if (containerDescripcion) containerDescripcion.style.display = 'none';
        if (ayudaCodigo) ayudaCodigo.style.display = 'none';
        if (avisoCodigoBarras) avisoCodigoBarras.style.display = 'none';
        if (inputCodigo) setTimeout(() => inputCodigo.focus(), 100);
        console.log('[PACK-MODO] Activo: codigo');
    } else {
        btnCodigo.classList.remove('active'); btnDescripcion.classList.add('active');
        if (containerCodigo) containerCodigo.style.display = 'none';
        if (containerDescripcion) containerDescripcion.style.display = 'block';
        if (ayudaCodigo) ayudaCodigo.style.display = 'none';
        if (avisoCodigoBarras) avisoCodigoBarras.style.display = 'none';
        if (inputDescripcion) setTimeout(() => inputDescripcion.focus(), 100);
        console.log('[PACK-MODO] Activo: descripcion');
    }
    limpiarResultados();
}

// Buscar por código
async function buscarPorCodigo(codigo) {
    const ayudaCodigo = document.getElementById('ayuda-busqueda-codigo');
    if (!codigo || codigo.trim().length === 0) { limpiarResultados(); if (ayudaCodigo) ayudaCodigo.style.display = 'none'; return; }
    const codigoTrim = codigo.trim();
    if (!/^\d+$/.test(codigoTrim)) {
        if (ayudaCodigo) { ayudaCodigo.textContent = 'Para buscar por texto, usa "Busqueda por descripcion"'; ayudaCodigo.style.display = 'block'; }
        limpiarResultados(); return;
    }
    if (ayudaCodigo) ayudaCodigo.style.display = 'none';
    try {
        const response = await fetch(`/api/produccion/buscar-articulos?q=${encodeURIComponent(codigoTrim)}&exact=true`);
        if (response.ok) {
            const result = await response.json();
            if (result.success && result.articulos && result.articulos.length > 0) {
                articulosDisponibles = result.articulos;
                if (result.articulos.length === 1) { seleccionarHijo(0); } else { mostrarResultadosBusqueda(result.articulos); }
            } else { mostrarMensajeSinResultados('No se encontro ese codigo de barras'); articulosDisponibles = []; }
        }
    } catch (error) { mostrarMensajeSinResultados('Error de conexion'); }
}

// Buscar por descripción
async function buscarPorDescripcion(texto) {
    const avisoCodigoBarras = document.getElementById('aviso-codigo-barras');
    
    // Si está vacío, limpiar
    if (!texto || texto.trim().length < 1) {
        limpiarResultados();
        if (avisoCodigoBarras) avisoCodigoBarras.style.display = 'none';
        return;
    }
    
    // Normalizar espacios múltiples a uno solo
    const textoTrim = texto.trim().replace(/\s+/g, ' ');
    
    // Detectar si parece código de barras
    if (pareceCodigoBarras(textoTrim)) {
        if (avisoCodigoBarras) {
            avisoCodigoBarras.style.display = 'block';
            avisoCodigoBarras.dataset.codigo = textoTrim;
        }
    } else {
        if (avisoCodigoBarras) avisoCodigoBarras.style.display = 'none';
    }
    
    // Tokenizar: dividir por espacios y normalizar cada token
    const tokens = textoTrim.split(/\s+/)
        .map(t => normalizarTexto(t))
        .filter(t => t.length > 0);
    
    if (tokens.length === 0) {
        limpiarResultados();
        return;
    }
    
    try {
        // Usar el primer token para obtener candidatos del servidor
        const primerToken = tokens[0];
        const response = await fetch(`/api/produccion/buscar-articulos?q=${encodeURIComponent(primerToken)}`);
        
        if (response.ok) {
            const result = await response.json();
            if (result.success && result.articulos) {
                const candidatos = result.articulos.length;
                
                // Filtrar con lógica AND: todos los tokens deben estar presentes como subcadena
                const articulosFiltrados = result.articulos.filter(art => {
                    if (!art.descripcion) return false;
                    const descripcionNorm = normalizarTexto(art.descripcion);
                    // Cada token debe estar presente en la descripción (lógica AND con includes)
                    return tokens.every(token => descripcionNorm.includes(token));
                });
                
                // Log único por búsqueda
                console.log(`[DESC-SEARCH] tokens=[${tokens.map(t => "'" + t + "'").join(',')}], candidatos=${candidatos}, resultados=${articulosFiltrados.length}`);
                
                articulosDisponibles = articulosFiltrados;
                
                if (articulosFiltrados.length > 0) {
                    mostrarResultadosBusqueda(articulosFiltrados);
                } else {
                    mostrarMensajeSinResultados('No se encontraron articulos que coincidan');
                }
            } else {
                mostrarMensajeSinResultados('No se encontraron articulos que coincidan');
            }
        }
    } catch (error) {
        console.error('[DESC-SEARCH] Error de conexion:', error);
        mostrarMensajeSinResultados('Error de conexion');
    }
}

// Cambiar a modo código desde aviso
function cambiarAModoCodigo() {
    const avisoCodigoBarras = document.getElementById('aviso-codigo-barras');
    const codigo = avisoCodigoBarras?.dataset.codigo || '';
    cambiarModoBusqueda('codigo');
    if (codigo) {
        const inputCodigo = document.getElementById('pack-hijo-codigo-input');
        if (inputCodigo) { inputCodigo.value = codigo; buscarPorCodigo(codigo); }
    }
}

// Limpiar resultados
function limpiarResultados() {
    const resultadosDiv = document.getElementById('pack-hijo-resultados');
    if (resultadosDiv) { resultadosDiv.style.display = 'none'; resultadosDiv.innerHTML = ''; }
    articulosDisponibles = []; indiceSeleccionado = -1;
}

// Mostrar mensaje sin resultados
function mostrarMensajeSinResultados(mensaje) {
    const resultadosDiv = document.getElementById('pack-hijo-resultados');
    if (!resultadosDiv) return;
    resultadosDiv.innerHTML = '<div style="padding: 15px; text-align: center; color: #6c757d; font-style: italic;">' + mensaje + '</div>';
    resultadosDiv.style.display = 'block';
}

// Refrescar UI después de cambios en pack
async function refrescarUIPostPack(codigoPadre) {
    console.log('[PACK-UI] Guardado OK | disparando refresco');
    
    // Invalidar caché
    if (typeof window.invalidarCachePackMappings === 'function') {
        window.invalidarCachePackMappings(codigoPadre);
        console.log('[PACK-UI] Cache de pack invalidada');
    }
    
    // Actualizar resumen
    if (typeof window.actualizarResumenFaltantes === 'function') {
        setTimeout(() => {
            window.actualizarResumenFaltantes();
            console.log('[PACK-UI] Resumen actualizado');
        }, 300);
    }
    
    // Actualizar panel principal
    if (typeof window.cargarPedidosArticulos === 'function') {
        setTimeout(() => {
            window.cargarPedidosArticulos();
            console.log('[PACK-UI] Panel principal actualizado');
        }, 600);
    }
    
    // Actualizar íconos de expansión
    if (typeof window.actualizarIconosExpansion === 'function') {
        setTimeout(() => {
            window.actualizarIconosExpansion();
            console.log('[PACK-UI] Refresco completo');
        }, 1200);
    } else {
        setTimeout(() => {
            console.log('[PACK-UI] Refresco completo');
        }, 1000);
    }
}




/**
 * Función para mostrar resultados de búsqueda
 */
function mostrarResultadosBusqueda(articulos) {
    const resultadosDiv = document.getElementById('pack-hijo-resultados');
    if (!resultadosDiv) return;
    
    if (articulos.length === 0) {
        resultadosDiv.style.display = 'none';
        return;
    }
    
    const html = articulos.map((art, index) => {
        // ✅ Usar codigo_barras en lugar de codigo
        const codigoBarras = art.codigo_barras || art.codigo;
        return `
        <div class="resultado-item" 
             data-index="${index}"
             data-codigo-barras="${codigoBarras}"
             data-descripcion="${art.descripcion}"
             style="padding: 10px; cursor: pointer; border-bottom: 1px solid #eee; transition: background-color 0.2s;"
             onmouseover="this.style.backgroundColor='#f0f0f0'"
             onmouseout="if(!this.classList.contains('selected')) this.style.backgroundColor='white'"
             onclick="seleccionarHijo(${index})">
            <div style="font-weight: 600; color: #333;">${art.descripcion}</div>
            <div style="font-size: 12px; color: #6c757d; font-family: monospace;">Codigo: ${codigoBarras}</div>
        </div>
    `;
    }).join('');
    
    resultadosDiv.innerHTML = html;
    resultadosDiv.style.display = 'block';
    indiceSeleccionado = -1;
}

/**
 * Función para seleccionar un hijo de la lista
 */
window.seleccionarHijo = function(index) {
    if (index < 0 || index >= articulosDisponibles.length) return;
    
    const articulo = articulosDisponibles[index];
    
    // ✅ Usar codigo_barras en lugar de codigo
    const codigoBarras = articulo.codigo_barras || articulo.codigo;
    
    hijoSeleccionado = {
        codigo_barras: codigoBarras,
        descripcion: articulo.descripcion
    };
    
    const hijoCodigo = document.getElementById('pack-hijo-codigo');
    const hijoBusqueda = document.getElementById('pack-hijo-busqueda');
    const hijoSeleccionadoDiv = document.getElementById('pack-hijo-seleccionado');
    const hijoSeleccionadoTexto = document.getElementById('pack-hijo-seleccionado-texto');
    const resultadosDiv = document.getElementById('pack-hijo-resultados');
    
    if (hijoCodigo) hijoCodigo.value = codigoBarras;
    if (hijoBusqueda) hijoBusqueda.value = '';
    if (hijoSeleccionadoDiv) hijoSeleccionadoDiv.style.display = 'block';
    if (hijoSeleccionadoTexto) {
        hijoSeleccionadoTexto.innerHTML = `${articulo.descripcion} <span style="font-family: monospace; color: #6c757d;">(${codigoBarras})</span>`;
    }
    if (resultadosDiv) resultadosDiv.style.display = 'none';
    
    console.log(`👶 Hijo seleccionado ${codigoBarras}`);
    
    // Validar formulario
    validarFormulario();
    
    // Dar foco a unidades
    const unidades = document.getElementById('pack-unidades');
    if (unidades) unidades.focus();
};

/**
 * Función para validar el formulario y habilitar/deshabilitar botón guardar
 */
function validarFormulario() {
    const hijoCodigo = document.getElementById('pack-hijo-codigo');
    const unidades = document.getElementById('pack-unidades');
    const guardarBtn = document.getElementById('pack-guardar');
    
    if (!guardarBtn) return;
    
    const hijoValido = hijoCodigo && hijoCodigo.value.trim() !== '';
    const unidadesValidas = unidades && unidades.value && parseInt(unidades.value) > 0;
    
    guardarBtn.disabled = !(hijoValido && unidadesValidas);
    
    console.log('🔍 [PACK-VALIDACION]', { hijoValido, unidadesValidas, botonHabilitado: !guardarBtn.disabled });
}

/**
 * Función para navegar con teclado en los resultados
 */
function navegarResultados(direccion) {
    const resultados = document.querySelectorAll('.resultado-item');
    if (resultados.length === 0) return;
    
    // Limpiar selección anterior
    resultados.forEach(r => {
        r.classList.remove('selected');
        r.style.backgroundColor = 'white';
    });
    
    // Calcular nuevo índice
    if (direccion === 'down') {
        indiceSeleccionado = (indiceSeleccionado + 1) % resultados.length;
    } else if (direccion === 'up') {
        indiceSeleccionado = indiceSeleccionado <= 0 ? resultados.length - 1 : indiceSeleccionado - 1;
    }
    
    // Aplicar selección
    if (indiceSeleccionado >= 0 && indiceSeleccionado < resultados.length) {
        const itemSeleccionado = resultados[indiceSeleccionado];
        itemSeleccionado.classList.add('selected');
        itemSeleccionado.style.backgroundColor = '#e7f3ff';
        itemSeleccionado.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

/**
 * Función para confirmar selección con Enter
 */
function confirmarSeleccion() {
    if (indiceSeleccionado >= 0 && indiceSeleccionado < articulosDisponibles.length) {
        seleccionarHijo(indiceSeleccionado);
    }
}

/**
 * Función para mostrar mensajes en el modal
 */
function mostrarMensajePack(texto, tipo) {
    const mensaje = document.getElementById('pack-mensaje');
    if (!mensaje) return;
    
    mensaje.innerHTML = texto;
    mensaje.className = tipo === 'error' ? 'mensaje-error' : 
                       tipo === 'success' ? 'mensaje-exito' : 'mensaje-info';
    mensaje.style.display = 'block';
}

/**
 * Función para mostrar toast
 */
function mostrarToast(texto, tipo = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${tipo === 'error' ? 'error' : ''}`;
    toast.textContent = texto;
    
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, 3000);
}

/**
 * Configurar event listeners del modal pack
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('[INIT] PASO 3 - Configurando modal pack mejorado');
    
    const hijoBusqueda = document.getElementById('pack-hijo-busqueda');
    const unidades = document.getElementById('pack-unidades');
    const guardarBtn = document.getElementById('pack-guardar');
    const quitarBtn = document.getElementById('pack-quitar');
    const modal = document.getElementById('modal-pack');
    
    // ===== BÚSQUEDA DUAL =====
    const btnCodigo = document.getElementById('btn-busqueda-codigo');
    const btnDescripcion = document.getElementById('btn-busqueda-descripcion');
    const inputCodigo = document.getElementById('pack-hijo-codigo-input');
    const inputDescripcion = document.getElementById('pack-hijo-busqueda');
    
    if (btnCodigo) btnCodigo.addEventListener('click', () => cambiarModoBusqueda('codigo'));
    if (btnDescripcion) btnDescripcion.addEventListener('click', () => cambiarModoBusqueda('descripcion'));
    
    if (inputCodigo) {
        inputCodigo.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); buscarPorCodigo(this.value); }
            const resultadosDiv = document.getElementById('pack-hijo-resultados');
            const resultadosVisibles = resultadosDiv && resultadosDiv.style.display !== 'none' && articulosDisponibles.length > 0;
            if (resultadosVisibles) {
                if (e.key === 'ArrowDown') { e.preventDefault(); navegarResultados('down'); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); navegarResultados('up'); }
                else if (e.key === 'Enter') { e.preventDefault(); confirmarSeleccion(); }
            }
        });
    }
    
    // ===== BÚSQUEDA EN VIVO =====
    if (inputDescripcion) {
        inputDescripcion.addEventListener('input', function(e) {
            const termino = e.target.value;
            
            // Limpiar timeout anterior
            if (busquedaTimeout) clearTimeout(busquedaTimeout);
            
            // Buscar después de 300ms de inactividad
            busquedaTimeout = setTimeout(() => {
                buscarPorDescripcion(this.value);
            }, 300);
        });
        
        // Navegación con teclado
        inputDescripcion.addEventListener('keydown', function(e) {
            const resultadosDiv = document.getElementById('pack-hijo-resultados');
            const resultadosVisibles = resultadosDiv && resultadosDiv.style.display !== 'none';
            
            if (resultadosVisibles) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    navegarResultados('down');
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    navegarResultados('up');
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmarSeleccion();
                } else if (e.key === 'Escape') {
                    resultadosDiv.style.display = 'none';
                }
            }
        });
    }
    
    // ===== VALIDACIÓN DE UNIDADES =====
    if (unidades) {
        unidades.addEventListener('input', function() {
            validarFormulario();
            
            // Validación en tiempo real
            const valor = parseInt(this.value);
            if (this.value && (isNaN(valor) || valor <= 0)) {
                mostrarMensajePack('⚠️ Las unidades deben ser un numero entero mayor a 0', 'error');
            } else {
                const msgEl = document.getElementById('pack-mensaje');
                if (msgEl) {
                    msgEl.style.display = 'none';
                }
            }
        });
        
        // Validar al perder foco
        unidades.addEventListener('blur', function() {
            const valor = parseInt(this.value);
            if (this.value && (isNaN(valor) || valor <= 0)) {
                mostrarMensajePack('❌ Ingrese un numero valido de unidades (mayor a 0)', 'error');
            }
        });
    }
    
    // ===== BOTÓN GUARDAR =====
    if (guardarBtn) {
        guardarBtn.addEventListener('click', async function() {
            const padreCodigo = document.getElementById('pack-padre-codigo');
            const hijoCodigo = document.getElementById('pack-hijo-codigo');
            const unidades = document.getElementById('pack-unidades');
            
            if (!padreCodigo || !hijoCodigo || !unidades) return;
            
            // Validaciones finales
            if (!hijoCodigo.value.trim()) {
                mostrarMensajePack('❌ Debe seleccionar un articulo hijo', 'error');
                return;
            }
            
            const unidadesValor = parseInt(unidades.value);
            if (!unidades.value || isNaN(unidadesValor) || unidadesValor <= 0) {
                mostrarMensajePack('❌ Las unidades deben ser un numero entero mayor a 0', 'error');
                return;
            }
            
            try {
                // ✅ Usar nombres con _codigo_barras para claridad
                const payload = {
                    padre_codigo_barras: padreCodigo.value.trim(),
                    hijo_codigo_barras: hijoCodigo.value.trim(),
                    unidades: unidadesValor
                };
                
                console.log('💾 Pack enviado (padre/hijo por código de barras):', payload);
                
                const response = await fetch('/api/produccion/pack-map', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                const data = await response.json();
                
                if (response.ok && data.success) {
                    mostrarMensajePack('✅ Pack guardado correctamente', 'success');
                    mostrarToast('Pack guardado correctamente', 'success');
                    
                    // Cerrar modal con transición breve y refrescar UI
                    setTimeout(() => {
                        window.cerrarModalPack();
                        refrescarUIPostPack(padreCodigo.value.trim());
                    }, 500);
                } else {
                    mostrarMensajePack(`❌ ${data.error || 'Error al guardar'}`, 'error');
                }
            } catch (error) {
                console.error('❌ [PACK] Error:', error);
                mostrarMensajePack('❌ Error de conexion', 'error');
            }
        });
    }
    
    // ===== BOTÓN QUITAR =====
    if (quitarBtn) {
        quitarBtn.addEventListener('click', async function() {
            const padreCodigo = document.getElementById('pack-padre-codigo');
            if (!padreCodigo) return;
            
            if (!confirm('¿Esta seguro de quitar el pack?')) return;
            
            try {
                // ✅ Usar nombres con _codigo_barras para claridad
                const payload = {
                    padre_codigo_barras: padreCodigo.value.trim(),
                    hijo_codigo_barras: null,
                    unidades: null
                };
                
                const response = await fetch('/api/produccion/pack-map', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                const data = await response.json();
                
                if (response.ok && data.success) {
                    mostrarMensajePack('✅ Pack eliminado correctamente', 'success');
                    mostrarToast('Pack eliminado correctamente', 'success');
                    
                    // Cerrar modal con transición breve y refrescar UI
                    setTimeout(() => {
                        window.cerrarModalPack();
                        refrescarUIPostPack(padreCodigo.value.trim());
                    }, 500);
                } else {
                    mostrarMensajePack(`❌ ${data.error || 'Error al eliminar'}`, 'error');
                }
            } catch (error) {
                console.error('❌ [PACK] Error:', error);
                mostrarMensajePack('❌ Error de conexion', 'error');
            }
        });
    }
    
    // ===== ATAJOS DE TECLADO GLOBALES DEL MODAL =====
    if (modal) {
        modal.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                window.cerrarModalPack();
            } else if (e.key === 'Enter' && !guardarBtn.disabled) {
                const hijoBusqueda = document.getElementById('pack-hijo-busqueda');
                const resultadosDiv = document.getElementById('pack-hijo-resultados');
                
                // Si no está en el campo de búsqueda o no hay resultados visibles
                if (document.activeElement !== hijoBusqueda || 
                    !resultadosDiv || resultadosDiv.style.display === 'none') {
                    guardarBtn.click();
                }
            }
        });
    }
    
    // ===== CERRAR RESULTADOS AL HACER CLIC FUERA =====
    document.addEventListener('click', function(e) {
        const resultadosDiv = document.getElementById('pack-hijo-resultados');
        const hijoBusqueda = document.getElementById('pack-hijo-busqueda');
        
        if (resultadosDiv && hijoBusqueda) {
            if (!resultadosDiv.contains(e.target) && e.target !== hijoBusqueda) {
                resultadosDiv.style.display = 'none';
            }
        }
    });
    
    console.log('✅ [INIT] Modal pack mejorado configurado');
});



/**
 * Función para abrir modal pack mejorado
 */
window.abrirModalPack = async function(codigoPadre) {
    const modal = document.getElementById('modal-pack');
    const padreCodigo = document.getElementById('pack-padre-codigo');
    const padreDescripcion = document.getElementById('pack-padre-descripcion');
    const padreCodigoDisplay = document.getElementById('pack-padre-codigo-display');
    const hijoBusqueda = document.getElementById('pack-hijo-busqueda');
    const hijoCodigo = document.getElementById('pack-hijo-codigo');
    const hijoSeleccionadoDiv = document.getElementById('pack-hijo-seleccionado');
    const hijoSeleccionadoTexto = document.getElementById('pack-hijo-seleccionado-texto');
    const unidades = document.getElementById('pack-unidades');
    const mensaje = document.getElementById('pack-mensaje');
    const quitarBtn = document.getElementById('pack-quitar');
    const guardarBtn = document.getElementById('pack-guardar');
    const tituloModal = document.getElementById('modal-pack-titulo');
    
    if (!modal) return;
    
    // Resetear estado
    hijoSeleccionado = null;
    indiceSeleccionado = -1;
    articulosDisponibles = [];
    modoActual = 'codigo';
    
    // Limpiar formulario
    if (padreCodigo) padreCodigo.value = codigoPadre;
    if (padreCodigoDisplay) padreCodigoDisplay.textContent = codigoPadre;
    if (hijoBusqueda) hijoBusqueda.value = '';
    if (hijoCodigo) hijoCodigo.value = '';
    if (hijoSeleccionadoDiv) hijoSeleccionadoDiv.style.display = 'none';
    if (unidades) unidades.value = '';
    if (mensaje) { mensaje.style.display = 'none'; mensaje.innerHTML = ''; }
    if (quitarBtn) quitarBtn.style.display = 'none';
    if (guardarBtn) guardarBtn.disabled = true;
    
    const inputCodigo = document.getElementById('pack-hijo-codigo-input');
    const inputDescripcion = document.getElementById('pack-hijo-busqueda');
    if (inputCodigo) inputCodigo.value = '';
    if (inputDescripcion) inputDescripcion.value = '';
    
    // Mostrar modal
    modal.style.display = 'flex';
    
    console.log('[PACK-INIT] Modal abierto para:', codigoPadre);
    
    // Inicializar modo dual
    setTimeout(() => {
        const btnCodigo = document.getElementById('btn-busqueda-codigo');
        const btnDescripcion = document.getElementById('btn-busqueda-descripcion');
        const containerCodigo = document.getElementById('search-codigo-container');
        const containerDescripcion = document.getElementById('search-descripcion-container');
        if (btnCodigo && btnDescripcion && containerCodigo && containerDescripcion && inputCodigo) {
            console.log('[PACK-INIT] Buscador dual disponible');
            cambiarModoBusqueda('codigo');
        } else {
            console.log('[PACK-INIT] Fallback');
            if (containerDescripcion) containerDescripcion.style.display = 'block';
            if (inputDescripcion) inputDescripcion.focus();
        }
    }, 50);
    
    // Cargar datos del padre
    try {
        const response = await fetch(`/api/produccion/buscar-articulos?q=${encodeURIComponent(codigoPadre)}&exact=true`);
        if (response.ok) {
            const result = await response.json();
            if (result.success && result.articulos && result.articulos.length > 0) {
                const articulo = result.articulos[0];
                const padreCodigoBarras = articulo.codigo_barras || codigoPadre;
                if (padreCodigo) padreCodigo.value = padreCodigoBarras;
                if (padreCodigoDisplay) padreCodigoDisplay.textContent = padreCodigoBarras;
                if (padreDescripcion) padreDescripcion.textContent = articulo.descripcion || codigoPadre;
                if (articulo.pack_hijo_codigo && articulo.pack_unidades) {
                    if (tituloModal) tituloModal.textContent = 'Editar pack existente';
                    if (quitarBtn) quitarBtn.style.display = 'inline-block';
                    const hijoResp = await fetch(`/api/produccion/buscar-articulos?q=${encodeURIComponent(articulo.pack_hijo_codigo)}&exact=true`);
                    if (hijoResp.ok) {
                        const hijoResult = await hijoResp.json();
                        if (hijoResult.success && hijoResult.articulos && hijoResult.articulos.length > 0) {
                            const hijoArt = hijoResult.articulos[0];
                            const hijoCodigoBarras = hijoArt.codigo_barras || hijoArt.codigo;
                            hijoSeleccionado = { codigo_barras: hijoCodigoBarras, descripcion: hijoArt.descripcion };
                            if (hijoCodigo) hijoCodigo.value = hijoCodigoBarras;
                            if (hijoSeleccionadoDiv) {
                                hijoSeleccionadoDiv.style.display = 'block';
                                const hijoSeleccionadoTexto = document.getElementById('pack-hijo-seleccionado-texto');
                                if (hijoSeleccionadoTexto) hijoSeleccionadoTexto.textContent = `${hijoArt.descripcion} (${hijoCodigoBarras})`;
                            }
                        }
                    }
                    if (unidades) unidades.value = articulo.pack_unidades;
                    validarFormulario();
                    mostrarMensajePack(`Pack configurado: ${articulo.pack_unidades} unidades`, 'info');
                } else {
                    if (tituloModal) tituloModal.textContent = 'Crear nuevo pack';
                }
            }
        }
    } catch (error) {
        console.error('[PACK-ERR] Error al cargar padre:', error);
        if (padreDescripcion) padreDescripcion.textContent = `Articulo ${codigoPadre}`;
    }
};

/**
 * Función para cerrar modal pack
 */
window.cerrarModalPack = function() {
    const modal = document.getElementById('modal-pack');
    const resultados = document.getElementById('pack-hijo-resultados');
    if (modal) modal.style.display = 'none';
    if (resultados) resultados.style.display = 'none';
    if (busquedaTimeout) { clearTimeout(busquedaTimeout); busquedaTimeout = null; }
};

console.log('[PACK-INIT] Modulo con busqueda dual cargado');
window.cambiarAModoCodigo = cambiarAModoCodigo;
