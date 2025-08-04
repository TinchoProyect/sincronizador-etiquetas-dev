// Función para actualizar la visibilidad de los botones según el estado del carro
export async function actualizarVisibilidadBotones() {
    const carroId = localStorage.getItem('carroActivo');
    const btnCarroPreparado = document.getElementById('carro-preparado');
    const btnFinalizarProduccion = document.getElementById('finalizar-produccion');
    const btnAgregarArticulo = document.getElementById('agregar-articulo');
    const btnImprimirEtiquetas = document.getElementById('imprimir-etiquetas');
    const btnImprimirOrden = document.getElementById('imprimir-orden-produccion');
    const btnGuardadoIngredientes = document.getElementById('guardado-ingredientes');
    
    if (!carroId) {
        // No hay carro activo - ocultar todos los botones de acción
        if (btnCarroPreparado) btnCarroPreparado.style.display = 'none';
        if (btnFinalizarProduccion) btnFinalizarProduccion.style.display = 'none';
        if (btnAgregarArticulo) btnAgregarArticulo.style.display = 'none';
        if (btnImprimirEtiquetas) btnImprimirEtiquetas.style.display = 'none';
        if (btnImprimirOrden) btnImprimirOrden.style.display = 'none';
        if (btnGuardadoIngredientes) btnGuardadoIngredientes.style.display = 'none';
        return;
    }

    try {
        const response = await fetch(`/api/produccion/carro/${carroId}/estado`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Estado del carro:', data);

        // Manejar visibilidad según el estado
        switch (data.estado) {
            case 'en_preparacion':
                // Carro en preparación - mostrar botón de preparar y agregar artículos
                if (btnCarroPreparado) {
                    btnCarroPreparado.style.display = 'inline-block';
                    btnCarroPreparado.disabled = false;
                    btnCarroPreparado.textContent = 'Carro listo para producir';
                    btnCarroPreparado.classList.remove('procesando');
                }
                if (btnFinalizarProduccion) {
                    btnFinalizarProduccion.style.display = 'none';
                }
                if (btnAgregarArticulo) {
                    btnAgregarArticulo.style.display = 'inline-block';
                }
                if (btnImprimirOrden) {
                    btnImprimirOrden.style.display = 'none';
                }
                if (btnGuardadoIngredientes) {
                    btnGuardadoIngredientes.style.display = 'none';
                }
                break;

            case 'preparado':
                // Carro preparado - mostrar botón de finalizar y orden de producción, ocultar agregar artículos
                if (btnCarroPreparado) {
                    btnCarroPreparado.style.display = 'none';
                }
                if (btnFinalizarProduccion) {
                    btnFinalizarProduccion.style.display = 'inline-block';
                    btnFinalizarProduccion.disabled = false;
                    btnFinalizarProduccion.textContent = 'Asentar producción';
                    btnFinalizarProduccion.classList.remove('procesando');
                }
                if (btnImprimirOrden) {
                    btnImprimirOrden.style.display = 'inline-block';
                }
                if (btnAgregarArticulo) {
                    btnAgregarArticulo.style.display = 'none';
                }
                if (btnGuardadoIngredientes) {
                    btnGuardadoIngredientes.style.display = 'none';
                }
                
                // Mostrar campo de kilos producidos solo para carros de producción externa
                const kilosProducidosContainer = document.getElementById('kilos-producidos-container');
                if (data.tipo_carro === 'externa') {
                    if (kilosProducidosContainer) {
                        kilosProducidosContainer.style.display = 'flex';
                    }
                } else {
                    if (kilosProducidosContainer) {
                        kilosProducidosContainer.style.display = 'none';
                    }
                }
                
                // ✅ NUEVA FUNCIONALIDAD: Activar transición visual para carros externos
                if (data.tipo_carro === 'externa' && data.fase_actual === 'articulos_secundarios') {
                    console.log('🔄 Activando modo artículos secundarios para carro externo');
                    await activarModoArticulosSecundarios();
                }
                break;

            case 'confirmado':
                // Producción confirmada - mostrar botón de imprimir etiquetas y guardado de ingredientes
                if (btnCarroPreparado) btnCarroPreparado.style.display = 'none';
                if (btnFinalizarProduccion) btnFinalizarProduccion.style.display = 'none';
                if (btnAgregarArticulo) btnAgregarArticulo.style.display = 'none';
                if (btnImprimirEtiquetas) btnImprimirEtiquetas.style.display = 'inline-block';
                if (btnImprimirOrden) btnImprimirOrden.style.display = 'none';
                
                // 📦 Mostrar botón de guardado de ingredientes solo para carros internos
                if (btnGuardadoIngredientes) {
                    if (data.tipo_carro === 'interna') {
                        btnGuardadoIngredientes.style.display = 'inline-block';
                        console.log('✅ Botón "Guardado de ingredientes" mostrado para carro interno confirmado');
                    } else {
                        btnGuardadoIngredientes.style.display = 'none';
                    }
                }
                break;

            default:
                console.warn('Estado de carro desconocido:', data.estado);
                // Por defecto, ocultar todos los botones
                if (btnCarroPreparado) btnCarroPreparado.style.display = 'none';
                if (btnFinalizarProduccion) btnFinalizarProduccion.style.display = 'none';
                if (btnAgregarArticulo) btnAgregarArticulo.style.display = 'none';
                if (btnImprimirOrden) btnImprimirOrden.style.display = 'none';
                if (btnGuardadoIngredientes) btnGuardadoIngredientes.style.display = 'none';
        }

    } catch (error) {
        console.error('Error al verificar estado del carro:', error);
        // En caso de error, ocultar todos los botones
        if (btnCarroPreparado) btnCarroPreparado.style.display = 'none';
        if (btnFinalizarProduccion) btnFinalizarProduccion.style.display = 'none';
        if (btnAgregarArticulo) btnAgregarArticulo.style.display = 'none';
        if (btnImprimirOrden) btnImprimirOrden.style.display = 'none';
        if (btnGuardadoIngredientes) btnGuardadoIngredientes.style.display = 'none';
    }
}

/**
 * Activa el modo de artículos secundarios para carros de producción externa
 * Atenúa artículos padres y activa artículos secundarios editables
 */
async function activarModoArticulosSecundarios() {
    try {
        console.log('🔄 Iniciando transición a modo artículos secundarios');
        
        // 1. Atenuar artículos padres visualmente
        const articulosPadres = document.querySelectorAll('.articulo-container');
        articulosPadres.forEach(articulo => {
            articulo.classList.add('segundo-plano');
        });
        console.log(`✅ ${articulosPadres.length} artículos padres atenuados`);
        
        // 2. Minimizar informes de ingredientes padres
        const resumenIngredientes = document.getElementById('resumen-ingredientes');
        const resumenMixes = document.getElementById('resumen-mixes');
        
        if (resumenIngredientes) {
            resumenIngredientes.classList.add('minimizado');
            console.log('✅ Resumen de ingredientes minimizado');
        }
        
        if (resumenMixes) {
            resumenMixes.classList.add('minimizado');
            console.log('✅ Resumen de mixes minimizado');
        }
        
        // 3. Activar sección de artículos secundarios
        await mostrarArticulosSecundariosEditables();
        
        // 4. Mostrar informes de ingredientes vinculados
        await mostrarInformesIngredientesVinculados();
        
        console.log('✅ Transición a modo artículos secundarios completada');
        
    } catch (error) {
        console.error('❌ Error en transición a modo artículos secundarios:', error);
    }
}

/**
 * Muestra los artículos secundarios en estado editable
 */
async function mostrarArticulosSecundariosEditables() {
    try {
        const carroId = localStorage.getItem('carroActivo');
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        
        if (!carroId || !colaboradorData) {
            console.warn('⚠️ No hay carro activo o colaborador para mostrar artículos secundarios');
            return;
        }
        
        const colaborador = JSON.parse(colaboradorData);
        
        // Obtener artículos vinculados del carro
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/relaciones-articulos?usuarioId=${colaborador.id}`);
        
        if (!response.ok) {
            console.warn('⚠️ No se pudieron obtener artículos vinculados');
            return;
        }
        
        const articulosVinculados = await response.json();
        console.log(`🔗 Artículos vinculados encontrados: ${articulosVinculados.length}`);
        
        if (articulosVinculados.length === 0) {
            console.log('ℹ️ No hay artículos vinculados para mostrar');
            return;
        }
        
        // Crear o actualizar sección de artículos secundarios
        let seccionSecundarios = document.getElementById('seccion-articulos-secundarios');
        if (!seccionSecundarios) {
            seccionSecundarios = document.createElement('div');
            seccionSecundarios.id = 'seccion-articulos-secundarios';
            seccionSecundarios.className = 'seccion-articulos-secundarios';
            
            // Insertar después de la sección de artículos principales
            const listaArticulos = document.getElementById('lista-articulos');
            if (listaArticulos && listaArticulos.parentNode) {
                listaArticulos.parentNode.insertBefore(seccionSecundarios, listaArticulos.nextSibling);
            }
        }
        
        // Generar HTML para artículos secundarios editables
        let html = `
            <div class="header-articulos-secundarios">
                <h3>🔗 Artículos Vinculados (Editables)</h3>
                <p class="descripcion-fase">Los artículos padres han sido procesados. Ahora puedes gestionar los artículos vinculados.</p>
            </div>
            <div class="lista-articulos-secundarios">
        `;
        
        articulosVinculados.forEach(vinculo => {
            const multiplicador = vinculo.multiplicador_ingredientes || 1;
            const multiplicadorTexto = multiplicador === 1 ? '' : ` (×${multiplicador})`;
            
            html += `
                <div class="articulo-secundario-editable" data-relacion-id="${vinculo.id}">
                    <div class="articulo-info">
                        <span class="vinculo-icono">🔗</span>
                        <span class="articulo-codigo">${vinculo.articulo_kilo_codigo}</span>
                        <span class="articulo-descripcion" title="${vinculo.articulo_kilo_nombre || 'Artículo vinculado'}">${vinculo.articulo_kilo_nombre || 'Artículo vinculado'}</span>
                        ${vinculo.articulo_kilo_codigo_barras ? `<span class="codigo-barras" title="Código de barras: ${vinculo.articulo_kilo_codigo_barras}">📊 ${vinculo.articulo_kilo_codigo_barras}</span>` : ''}
                        <span class="vinculo-etiqueta">Vinculado a: ${vinculo.articulo_produccion_codigo}${multiplicadorTexto}</span>
                    </div>
                    <div class="articulo-actions">
                        <button class="btn-editar-vinculo-secundario" 
                                data-relacion-id="${vinculo.id}"
                                data-articulo-padre="${vinculo.articulo_produccion_codigo}">
                            ✏️ Editar vínculo
                        </button>
                        <button class="btn-eliminar-vinculo-secundario" 
                                data-relacion-id="${vinculo.id}"
                                data-articulo-padre="${vinculo.articulo_produccion_codigo}">
                            🗑️ Eliminar vínculo
                        </button>
                    </div>
                </div>
            `;
        });
        
        html += `</div>`;
        
        seccionSecundarios.innerHTML = html;
        seccionSecundarios.style.display = 'block';
        seccionSecundarios.classList.add('activa');
        
        console.log('✅ Sección de artículos secundarios activada');
        
    } catch (error) {
        console.error('❌ Error al mostrar artículos secundarios:', error);
    }
}

/**
 * Muestra los informes de ingredientes de artículos vinculados
 */
async function mostrarInformesIngredientesVinculados() {
    try {
        const carroId = localStorage.getItem('carroActivo');
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        
        if (!carroId || !colaboradorData) {
            console.warn('⚠️ No hay carro activo o colaborador para mostrar informes vinculados');
            return;
        }
        
        const colaborador = JSON.parse(colaboradorData);
        
        // Obtener ingredientes de artículos vinculados
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingredientes-vinculados?usuarioId=${colaborador.id}`);
        
        if (!response.ok) {
            console.warn('⚠️ No se pudieron obtener ingredientes vinculados');
            return;
        }
        
        const ingredientesVinculados = await response.json();
        console.log(`🔗 Ingredientes vinculados encontrados: ${ingredientesVinculados.length}`);
        
        // Crear o actualizar sección de informes vinculados
        let seccionInformesVinculados = document.getElementById('resumen-ingredientes-vinculados');
        if (!seccionInformesVinculados) {
            seccionInformesVinculados = document.createElement('div');
            seccionInformesVinculados.id = 'resumen-ingredientes-vinculados';
            seccionInformesVinculados.className = 'seccion-resumen';
            
            // Insertar en el área derecha después de los informes principales
            const workspaceRight = document.querySelector('.workspace-right');
            if (workspaceRight) {
                workspaceRight.appendChild(seccionInformesVinculados);
            }
        }
        
        // Generar HTML para el informe
        let html = `
            <h3>🔗 Ingredientes de Artículos Vinculados</h3>
            <div class="descripcion-informe">
                <p>Estos ingredientes corresponden a los artículos vinculados y se obtienen del stock general de producción.</p>
            </div>
        `;
        
        if (ingredientesVinculados.length === 0) {
            html += '<p>No hay ingredientes vinculados para mostrar</p>';
        } else {
            html += `
                <table class="tabla-resumen tabla-vinculados">
                    <thead>
                        <tr>
                            <th>Ingrediente</th>
                            <th>Cantidad Necesaria</th>
                            <th>Stock General</th>
                            <th>Estado</th>
                            <th>Unidad</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            ingredientesVinculados.forEach(ing => {
                // Validación robusta para evitar errores con .toFixed()
                const stockActualRaw = ing.stock_actual;
                const cantidadNecesariaRaw = ing.cantidad;
                
                // Convertir a números de forma segura
                let stockActual = 0;
                let cantidadNecesaria = 0;
                
                if (stockActualRaw !== null && stockActualRaw !== undefined && stockActualRaw !== '') {
                    const stockParsed = parseFloat(stockActualRaw);
                    stockActual = isNaN(stockParsed) ? 0 : stockParsed;
                }
                
                if (cantidadNecesariaRaw !== null && cantidadNecesariaRaw !== undefined && cantidadNecesariaRaw !== '') {
                    const cantidadParsed = parseFloat(cantidadNecesariaRaw);
                    cantidadNecesaria = isNaN(cantidadParsed) ? 0 : cantidadParsed;
                }
                
                const diferencia = stockActual - cantidadNecesaria;
                const tieneStock = diferencia >= -0.01;
                const faltante = tieneStock ? 0 : Math.abs(diferencia);
                
                let indicadorEstado = '';
                if (tieneStock) {
                    indicadorEstado = `<span class="stock-suficiente">✅ Suficiente</span>`;
                } else {
                    indicadorEstado = `<span class="stock-insuficiente">❌ Faltan ${faltante.toFixed(2)} ${ing.unidad_medida || ''}</span>`;
                }
                
                html += `
                    <tr class="${tieneStock ? 'stock-ok' : 'stock-faltante'} ingrediente-vinculado">
                        <td>${ing.nombre || 'Sin nombre'}</td>
                        <td>${cantidadNecesaria.toFixed(2)}</td>
                        <td>${stockActual.toFixed(2)}</td>
                        <td>${indicadorEstado}</td>
                        <td>${ing.unidad_medida || ''}</td>
                    </tr>
                `;
            });
            
            html += `
                    </tbody>
                </table>
            `;
        }
        
        seccionInformesVinculados.innerHTML = html;
        seccionInformesVinculados.style.display = 'block';
        seccionInformesVinculados.classList.add('activa');
        
        console.log('✅ Informes de ingredientes vinculados activados');
        
    } catch (error) {
        console.error('❌ Error al mostrar informes vinculados:', error);
    }
}

// Función para marcar un carro como preparado
export async function marcarCarroPreparado(carroId) {
    if (!carroId) {
        console.error('No hay carro seleccionado');
        return;
    }

    const btnCarroPreparado = document.getElementById('carro-preparado');
    if (!btnCarroPreparado) return;

    try {
        // Deshabilitar el botón y mostrar estado de procesamiento
        btnCarroPreparado.disabled = true;
        btnCarroPreparado.classList.add('procesando');
        btnCarroPreparado.textContent = 'Procesando...';

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;
        
        if (!colaborador || !colaborador.id) {
            throw new Error('No se encontró información del colaborador activo');
        }
        
        const response = await fetch(`/api/produccion/carro/${carroId}/preparado`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuarioId: colaborador.id
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Error HTTP ${response.status}`);
        }

        // Mostrar notificación de éxito
        mostrarNotificacion('Carro marcado como preparado exitosamente');
        
        // Actualizar la visibilidad de los botones
        await actualizarVisibilidadBotones();
        
        // Actualizar el estado del carro en la interfaz si es necesario
        if (window.actualizarEstadoCarro) {
            window.actualizarEstadoCarro();
        }

    } catch (error) {
        console.error('Error al marcar carro como preparado:', error);
        btnCarroPreparado.disabled = false;
        btnCarroPreparado.classList.remove('procesando');
        btnCarroPreparado.textContent = 'Carro listo para producir';
        mostrarNotificacion(`Error: ${error.message}`, true);
    }
}

// Función para finalizar la producción de un carro
export async function finalizarProduccion(carroId) {
    if (!carroId) {
        console.error('No hay carro seleccionado');
        return;
    }

    const btnFinalizarProduccion = document.getElementById('finalizar-produccion');
    if (!btnFinalizarProduccion) return;

    try {
        // Deshabilitar el botón y mostrar estado de procesamiento
        btnFinalizarProduccion.disabled = true;
        btnFinalizarProduccion.classList.add('procesando');
        btnFinalizarProduccion.textContent = 'Procesando...';

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;

        if (!colaborador || !colaborador.id) {
            throw new Error('No se encontró información del colaborador activo');
        }

        // 🔍 OBTENER TIPO DE CARRO ANTES DE VALIDAR KILOS PRODUCIDOS
        console.log('🔍 Obteniendo tipo de carro antes de validar kilos producidos...');
        const estadoResponse = await fetch(`/api/produccion/carro/${carroId}/estado`);
        
        if (!estadoResponse.ok) {
            throw new Error('No se pudo obtener el estado del carro');
        }
        
        const estadoCarro = await estadoResponse.json();
        const tipoCarro = estadoCarro.tipo_carro || 'interna';
        
        console.log(`🔍 Tipo de carro detectado: ${tipoCarro}`);

        // Obtener kilos producidos del input (SOLO para carros externos)
        let kilosProducidos = null;
        const kilosProducidosInput = document.getElementById('kilos-producidos');
        
        console.log('🔍 Estado del input kilos-producidos:', {
            existe: !!kilosProducidosInput,
            display: kilosProducidosInput?.style.display,
            valor: kilosProducidosInput?.value,
            tipoCarro: tipoCarro
        });
        
        // ✅ VALIDACIÓN CORREGIDA: Solo validar si es carro externo
        if (tipoCarro === 'externa') {
            console.log('🚚 Carro externo: validando kilos producidos...');
            
            if (kilosProducidosInput && kilosProducidosInput.style.display !== 'none') {
                const kilosProducidosStr = kilosProducidosInput.value;
                kilosProducidos = parseFloat(kilosProducidosStr);

                if (isNaN(kilosProducidos) || kilosProducidos <= 0) {
                    throw new Error('Debe ingresar un valor numérico válido para kilos producidos mayor a cero.');
                }
                
                console.log(`✅ Kilos producidos validados: ${kilosProducidos}`);
            } else {
                throw new Error('Para carros de producción externa es obligatorio ingresar los kilos producidos.');
            }
        } else {
            console.log('🏭 Carro interno: saltando validación de kilos producidos');
            kilosProducidos = null; // Asegurar que sea null para carros internos
        }

        console.log(`🔍 Enviando al backend - Tipo: ${tipoCarro}, Kilos: ${kilosProducidos}`);

        const response = await fetch(`/api/produccion/carro/${carroId}/finalizar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuarioId: colaborador.id,
                kilos_producidos: kilosProducidos
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Error HTTP ${response.status}`);
        }

        // Mostrar notificación de éxito
        mostrarNotificacion('Producción finalizada exitosamente');

        // Actualizar la visibilidad de los botones
        await actualizarVisibilidadBotones();

        // Actualizar el estado del carro en la interfaz si es necesario
        if (window.actualizarEstadoCarro) {
            window.actualizarEstadoCarro();
        }

    } catch (error) {
        console.error('Error al finalizar producción:', error);
        btnFinalizarProduccion.disabled = false;
        btnFinalizarProduccion.classList.remove('procesando');
        btnFinalizarProduccion.textContent = 'Asentar producción';
        mostrarNotificacion(`Error: ${error.message}`, true);
    }
}

// Función para mostrar notificaciones
function mostrarNotificacion(mensaje, esError = false) {
    const notificacion = document.createElement('div');
    notificacion.className = esError ? 'preparado-error' : 'preparado-success';
    notificacion.textContent = mensaje;
    document.body.appendChild(notificacion);

    // Remover la notificación después de 3 segundos
    setTimeout(() => {
        notificacion.remove();
    }, 3000);
}

// Hacer disponibles las funciones globalmente
window.marcarCarroPreparado = marcarCarroPreparado;
window.finalizarProduccion = finalizarProduccion;

// Función para imprimir etiquetas del carro
export async function imprimirEtiquetasCarro(carroId) {
    if (!carroId) {
        console.error('No hay carro seleccionado');
        return;
    }

    const btnImprimirEtiquetas = document.getElementById('imprimir-etiquetas');
    if (!btnImprimirEtiquetas) return;

    try {
        // Deshabilitar el botón y mostrar estado de procesamiento
        btnImprimirEtiquetas.disabled = true;
        btnImprimirEtiquetas.classList.add('procesando');
        btnImprimirEtiquetas.textContent = 'Imprimiendo...';

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;
        
        if (!colaborador || !colaborador.id) {
            throw new Error('No se encontró información del colaborador activo');
        }

        // Obtener los artículos del carro para imprimir etiquetas
        const response = await fetch(`/api/produccion/carro/${carroId}/articulos-etiquetas`);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Error HTTP ${response.status}`);
        }

        const articulos = await response.json();

        // Imprimir etiquetas para cada artículo según su cantidad
        for (const articulo of articulos) {
            const imprimirResponse = await fetch('http://localhost:3000/api/imprimir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    articulo: {
                        numero: articulo.articulo_numero,
                        nombre: articulo.descripcion,
                        codigo_barras: articulo.codigo_barras
                    },
                    cantidad: articulo.cantidad
                })
            });

            if (!imprimirResponse.ok) {
                throw new Error(`Error al imprimir etiqueta para ${articulo.descripcion}`);
            }
        }

        // Mostrar notificación de éxito
        mostrarNotificacion('Etiquetas impresas correctamente');

    } catch (error) {
        console.error('Error al imprimir etiquetas:', error);
        mostrarNotificacion(`Error: ${error.message}`, true);
    } finally {
        // Restaurar el botón
        if (btnImprimirEtiquetas) {
            btnImprimirEtiquetas.disabled = false;
            btnImprimirEtiquetas.classList.remove('procesando');
            btnImprimirEtiquetas.textContent = 'Imprimir etiquetas';
        }
    }
}

// Hacer disponibles las funciones globalmente
window.marcarCarroPreparado = marcarCarroPreparado;
window.finalizarProduccion = finalizarProduccion;
window.imprimirEtiquetasCarro = imprimirEtiquetasCarro;
window.actualizarVisibilidadBotones = actualizarVisibilidadBotones;

// Mantener compatibilidad con el nombre anterior
export const actualizarVisibilidadBotonPreparado = actualizarVisibilidadBotones;
