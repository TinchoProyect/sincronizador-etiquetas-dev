// ===== MODAL PACK MEJORADO CON BÚSQUEDA EN VIVO =====

// Variables globales para el modal
let articulosDisponibles = [];
let hijoSeleccionado = null;
let indiceSeleccionado = -1;
let busquedaTimeout = null;

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
    
    // Limpiar formulario
    if (padreCodigo) padreCodigo.value = codigoPadre;
    if (padreCodigoDisplay) padreCodigoDisplay.textContent = codigoPadre;
    if (hijoBusqueda) hijoBusqueda.value = '';
    if (hijoCodigo) hijoCodigo.value = '';
    if (hijoSeleccionadoDiv) hijoSeleccionadoDiv.style.display = 'none';
    if (unidades) unidades.value = '';
    if (mensaje) {
        mensaje.style.display = 'none';
        mensaje.innerHTML = '';
    }
    if (quitarBtn) quitarBtn.style.display = 'none';
    if (guardarBtn) guardarBtn.disabled = true;
    
    // Mostrar modal
    modal.style.display = 'flex';
    
    console.log('🧩 [MODAL-PACK] Modal abierto para:', codigoPadre);
    
    // Cargar datos del padre
    try {
        console.log('🔍 [PADRE] Buscando datos para:', codigoPadre);
        const response = await fetch(`/api/produccion/buscar-articulos?q=${encodeURIComponent(codigoPadre)}&exact=true`);
        
        console.log('📡 [PADRE] Response status:', response.status, response.ok);
        
        if (response.ok) {
            const result = await response.json();
            console.log('📦 [PADRE] Datos recibidos:', result);
            
            if (result.success && result.articulos && result.articulos.length > 0) {
                const articulo = result.articulos[0];
                console.log('✅ [PADRE] Artículo encontrado:', {
                    descripcion: articulo.descripcion,
                    codigo_barras: articulo.codigo_barras,
                    codigo: articulo.codigo
                });
                
                // ✅ Usar codigo_barras del padre
                const padreCodigoBarras = articulo.codigo_barras || codigoPadre;
                if (padreCodigo) padreCodigo.value = padreCodigoBarras;
                if (padreCodigoDisplay) padreCodigoDisplay.textContent = padreCodigoBarras;
                
                // Mostrar descripción del padre
                if (padreDescripcion) {
                    padreDescripcion.textContent = articulo.descripcion || codigoPadre;
                    console.log(`👤 PADRE listo: desc="${articulo.descripcion}", codigo_barras="${padreCodigoBarras}"`);
                } else {
                    console.warn('⚠️ [PADRE] Elemento padreDescripcion no encontrado en DOM');
                }
                
                // Verificar si tiene pack configurado (modo editar)
                if (articulo.pack_hijo_codigo && articulo.pack_unidades) {
                    // MODO EDITAR
                    if (tituloModal) tituloModal.textContent = 'Editar pack existente';
                    if (quitarBtn) quitarBtn.style.display = 'inline-block';
                    
                    console.log('📝 [MODAL-PACK] Modo EDITAR detectado, pack_hijo_codigo:', articulo.pack_hijo_codigo);
                    
                    // Precargar hijo usando pack_hijo_codigo (que ya es codigo_barras)
                    const hijoResp = await fetch(`/api/produccion/buscar-articulos?q=${encodeURIComponent(articulo.pack_hijo_codigo)}&exact=true`);
                    if (hijoResp.ok) {
                        const hijoResult = await hijoResp.json();
                        if (hijoResult.success && hijoResult.articulos && hijoResult.articulos.length > 0) {
                            const hijoArt = hijoResult.articulos[0];
                            
                            // ✅ Usar codigo_barras del hijo
                            const hijoCodigoBarras = hijoArt.codigo_barras || hijoArt.codigo;
                            
                            // Seleccionar hijo
                            hijoSeleccionado = {
                                codigo_barras: hijoCodigoBarras,
                                descripcion: hijoArt.descripcion
                            };
                            
                            if (hijoCodigo) hijoCodigo.value = hijoCodigoBarras;
                            if (hijoSeleccionadoDiv) hijoSeleccionadoDiv.style.display = 'block';
                            if (hijoSeleccionadoTexto) {
                                hijoSeleccionadoTexto.textContent = `${hijoArt.descripcion} (${hijoCodigoBarras})`;
                            }
                            
                            console.log('👶 [MODAL-PACK] Hijo precargado:', hijoCodigoBarras);
                        }
                    }
                    
                    // Precargar unidades
                    if (unidades) unidades.value = articulo.pack_unidades;
                    
                    // Habilitar guardar si hay datos válidos
                    validarFormulario();
                    
                    mostrarMensajePack(`📦 Pack configurado: ${articulo.pack_unidades} unidades`, 'info');
                    
                    console.log(`🧩 MODAL PACK listo (modo=editar, padre=${padreCodigoBarras})`);
                } else {
                    // MODO CREAR
                    if (tituloModal) tituloModal.textContent = 'Crear nuevo pack';
                    console.log(`🧩 MODAL PACK listo (modo=crear, padre=${padreCodigoBarras})`);
                }
            } else {
                console.warn('⚠️ [PADRE] sin datos: No se encontraron artículos en la respuesta');
                if (padreDescripcion) {
                    padreDescripcion.textContent = `Artículo ${codigoPadre}`;
                }
            }
        } else {
            console.error('❌ [PADRE] Error en respuesta HTTP:', response.status);
            if (padreDescripcion) {
                padreDescripcion.textContent = `Artículo ${codigoPadre}`;
            }
        }
    } catch (error) {
        console.error('❌ [PADRE] Error al cargar datos:', error);
        console.error('❌ [PADRE] sin datos: motivo="Error de red o servidor"', error.message);
        if (padreDescripcion) {
            padreDescripcion.textContent = `Artículo ${codigoPadre}`;
        }
    }
    
    // Dar foco al campo de búsqueda
    setTimeout(() => {
        if (hijoBusqueda) hijoBusqueda.focus();
    }, 100);
};

/**
 * Función para cerrar modal pack
 */
window.cerrarModalPack = function() {
    const modal = document.getElementById('modal-pack');
    const resultados = document.getElementById('pack-hijo-resultados');
    
    if (modal) modal.style.display = 'none';
    if (resultados) resultados.style.display = 'none';
    
    // Limpiar timeout de búsqueda
    if (busquedaTimeout) {
        clearTimeout(busquedaTimeout);
        busquedaTimeout = null;
    }
};

/**
 * Función para buscar artículos hijos
 */
async function buscarArticulosHijo(termino) {
    if (!termino || termino.trim().length < 2) {
        articulosDisponibles = [];
        mostrarResultadosBusqueda([]);
        return;
    }
    
    try {
        const response = await fetch(`/api/produccion/buscar-articulos?q=${encodeURIComponent(termino.trim())}`);
        
        if (response.ok) {
            const result = await response.json();
            if (result.success && result.articulos) {
                articulosDisponibles = result.articulos;
                mostrarResultadosBusqueda(result.articulos);
            }
        }
    } catch (error) {
        console.error('❌ [PACK-BUSQUEDA] Error:', error);
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
    
    // ===== BÚSQUEDA EN VIVO =====
    if (hijoBusqueda) {
        hijoBusqueda.addEventListener('input', function(e) {
            const termino = e.target.value;
            
            // Limpiar timeout anterior
            if (busquedaTimeout) clearTimeout(busquedaTimeout);
            
            // Buscar después de 300ms de inactividad
            busquedaTimeout = setTimeout(() => {
                buscarArticulosHijo(termino);
            }, 300);
        });
        
        // Navegación con teclado
        hijoBusqueda.addEventListener('keydown', function(e) {
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
            } else if (mensaje) {
                mensaje.style.display = 'none';
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
                    
                    // Invalidar caché
                    if (typeof window.invalidarCachePackMappings === 'function') {
                        window.invalidarCachePackMappings(padreCodigo.value.trim());
                    }
                    
                    setTimeout(() => {
                        window.cerrarModalPack();
                        if (typeof window.actualizarResumenFaltantes === 'function') {
                            setTimeout(window.actualizarResumenFaltantes, 800);
                        }
                    }, 2000);
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
                    
                    if (typeof window.invalidarCachePackMappings === 'function') {
                        window.invalidarCachePackMappings(padreCodigo.value.trim());
                    }
                    
                    setTimeout(() => {
                        window.cerrarModalPack();
                        if (typeof window.actualizarResumenFaltantes === 'function') {
                            setTimeout(window.actualizarResumenFaltantes, 800);
                        }
                    }, 2000);
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

console.log('✅ [MODAL-PACK] Módulo mejorado cargado');
