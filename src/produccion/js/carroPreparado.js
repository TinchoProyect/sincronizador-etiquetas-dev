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

                // 🚚 CREAR Y MOSTRAR campo de kilos producidos para carros externos
                if (data.tipo_carro === 'externa') {
                    console.log('🚚 Carro externo en estado preparado - creando campo de kilos producidos...');

                    let kilosProducidosContainer = document.getElementById('kilos-producidos-container');

                    // Si no existe, crearlo dinámicamente
                    if (!kilosProducidosContainer) {
                        kilosProducidosContainer = document.createElement('div');
                        kilosProducidosContainer.id = 'kilos-producidos-container';
                        kilosProducidosContainer.className = 'kilos-producidos-container';
                        kilosProducidosContainer.style.cssText = 'margin: 15px 0;';

                        // 1. GENERAR HTML (Con soporte para Unidades y Merma)
                        kilosProducidosContainer.innerHTML = `
                            <div class="inputs-produccion-wrapper" style="display: flex; gap: 15px; align-items: flex-start; background: #f8f9fa; padding: 10px; border-radius: 4px;">
                                <div class="input-group-produccion" style="flex: 1;">
                                    <label for="kilos-producidos" style="display: block; margin-bottom: 5px; font-weight: bold;">Kilos Producidos:</label>
                                    <div style="display: flex; align-items: center; gap: 5px;">
                                        <input type="text" inputmode="decimal" id="kilos-producidos" placeholder="0.00" style="width: 100%; padding: 5px; border: 1px solid #ced4da; border-radius: 4px;" required>
                                        <span style="color: #6c757d; font-size: 0.9em;">kg</span>
                                    </div>
                                </div>
                                <div id="container-unidades-helper" class="input-group-produccion" style="display: none; flex: 1; border-left: 1px solid #ccc; padding-left: 15px;">
                                    <label for="unidades-producidas" style="color: #007bff; display: block; margin-bottom: 5px; font-weight: bold;">O Unidades:</label>
                                    <input type="number" id="unidades-producidas" min="1" step="1" placeholder="Ej: 96" style="width: 100%; padding: 5px; border: 1px solid #007bff; border-radius: 4px;">
                                    <small class="conversion-badge" id="factor-conversion-texto" style="color: #666; font-size: 0.8em; display:block; margin-top:5px;">
                                        1 unidad = 0.05 kg
                                    </small>
                                </div>
                            </div>

                            <div id="calculo-merma" style="display: none; margin-top: 10px; padding: 12px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                                <h4 style="margin: 0 0 8px 0; color: #856404; font-size: 14px;">📊 Análisis de Reducción por Cocción</h4>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px;">
                                    <div>
                                        <strong>Total Mezcla en Crudo:</strong>
                                        <span id="total-crudo" style="font-weight: bold; color: #495057;">0.00 kg</span>
                                    </div>
                                    <div>
                                        <strong>Kilos Producidos:</strong>
                                        <span id="kilos-final" style="font-weight: bold; color: #495057;">0.00 kg</span>
                                    </div>
                                    <div>
                                        <strong>Diferencia de Peso:</strong>
                                        <span id="diferencia-peso" style="font-weight: bold;">0.00 kg</span>
                                    </div>
                                    <div>
                                        <strong>% de Reducción:</strong>
                                        <span id="porcentaje-reduccion" style="font-weight: bold;">0.00%</span>
                                    </div>
                                </div>
                                <p style="margin: 8px 0 0 0; font-size: 11px; color: #856404; font-style: italic;">
                                    💡 La reducción es normal debido a la evaporación de líquidos durante la cocción.
                                </p>
                            </div>
                        `;

                        // 2. ACTIVAR LÓGICA DE BARRITAS (Calculadora de Unidades)
                        setTimeout(() => {
                            const descripcionElement = document.querySelector('.articulo-descripcion');
                            // Verificamos si hay algún artículo que sea "Barra Flor"
                            if (descripcionElement && descripcionElement.textContent.toLowerCase().includes('barra flor')) {
                                const containerUnidades = document.getElementById('container-unidades-helper');
                                const inputUnidades = document.getElementById('unidades-producidas');
                                const inputKilos = document.getElementById('kilos-producidos');
                                const factor = 0.05; // 4.8kg / 96u

                                if (containerUnidades && inputUnidades && inputKilos) {
                                    console.log('⚖️ Activando calculadora de unidades para Barra Flor en Carro Preparado');
                                    containerUnidades.style.display = 'block';

                                    // A. Escribe Unidades -> Calcula Kilos
                                    inputUnidades.addEventListener('input', function () {
                                        const uStr = this.value.replace(',', '.');
                                        const u = parseFloat(uStr);
                                        if (!isNaN(u)) {
                                            inputKilos.value = (u * factor).toFixed(2);
                                            // Disparar evento para que se actualice la merma también
                                            inputKilos.dispatchEvent(new Event('input'));
                                        } else {
                                            inputKilos.value = '';
                                        }
                                    });

                                    // B. Escribe Kilos -> Calcula Unidades
                                    inputKilos.addEventListener('input', function () {
                                        const kStr = this.value.replace(',', '.');
                                        const k = parseFloat(kStr);
                                        if (!isNaN(k)) {
                                            inputUnidades.value = Math.round(k / factor);
                                        } else {
                                            inputUnidades.value = '';
                                        }
                                    });
                                }
                            }
                        }, 500); // Pequeño delay para asegurar que el DOM cargó

                        // Insertar después del botón de finalizar producción
                        if (btnFinalizarProduccion && btnFinalizarProduccion.parentElement) {
                            btnFinalizarProduccion.parentElement.insertBefore(kilosProducidosContainer, btnFinalizarProduccion.nextSibling);
                            console.log('✅ Campo de kilos producidos creado e insertado en el DOM');
                        }

                        // 🎯 AGREGAR EVENT LISTENER para cálculo dinámico de merma
                        const inputKilos = document.getElementById('kilos-producidos');
                        if (inputKilos) {
                            inputKilos.addEventListener('input', () => {
                                console.log('🎯 [EVENT] Input detectado en kilos-producidos');
                                calcularMermaProduccion(carroId);
                            });
                            inputKilos.addEventListener('blur', () => {
                                console.log('🎯 [EVENT] Blur detectado en kilos-producidos');
                                calcularMermaProduccion(carroId);
                            });
                            console.log('✅ Event listeners para cálculo de merma agregados');
                        }
                    } else {
                        // Si ya existe, solo mostrarlo
                        kilosProducidosContainer.style.display = 'block';
                        console.log('✅ Campo de kilos producidos mostrado (ya existía)');

                        // ⚠️ NO CLONAR - Solo verificar que el panel exista
                        const panelMerma = document.getElementById('calculo-merma');
                        if (!panelMerma) {
                            console.warn('⚠️ Panel de merma no existe, recreando container completo...');
                            // Si el panel se perdió, recrear todo el container
                            kilosProducidosContainer.remove();
                            // Llamar recursivamente para recrear
                            await actualizarVisibilidadBotones();
                            return;
                        }
                        console.log('✅ Panel de merma verificado en DOM');
                    }
                } else {
                    // Ocultar para carros internos
                    const kilosProducidosContainer = document.getElementById('kilos-producidos-container');
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
                // Producción confirmada - mostrar botón de imprimir etiquetas SOLO para carros internos
                if (btnCarroPreparado) btnCarroPreparado.style.display = 'none';
                if (btnFinalizarProduccion) btnFinalizarProduccion.style.display = 'none';
                if (btnAgregarArticulo) btnAgregarArticulo.style.display = 'none';
                if (btnImprimirOrden) btnImprimirOrden.style.display = 'none';

                // 🏭 Botón "Imprimir Etiquetas" SOLO para carros internos
                if (btnImprimirEtiquetas) {
                    if (data.tipo_carro === 'interna') {
                        btnImprimirEtiquetas.style.display = 'inline-block';
                        console.log('✅ Botón "Imprimir Etiquetas" mostrado para carro interno confirmado');

                        // LIMPIAR BOTONES ANTERIORES DE PADRES para evitar duplicados
                        document.querySelectorAll('.btn-imprimir-padre').forEach(btn => btn.remove());

                        // FETCH PADRES PARA IMPRESIÓN DINÁMICA DE PACKS EN FILA
                        fetch(`/api/produccion/carro/${carroId}/padres-impresion`)
                            .then(res => res.json())
                            .then(padres => {
                                if (padres && padres.length > 0) {
                                    console.log(`🔗 Se encontraron ${padres.length} padres vinculados para impresión opcional por fila.`);
                                    padres.forEach(padre => {
                                        // Buscar la fila del artículo "Hijo" en el DOM
                                        const filaHijo = document.querySelector(`.articulo-container[data-numero="${padre.hijo_articulo_numero}"]`);
                                        if (!filaHijo) return;
                                        
                                        // Buscar o crear el contenedor secundario para packs
                                        let packsContainer = filaHijo.querySelector('.articulo-packs-container');
                                        if (!packsContainer) {
                                            // Permitir que el contenedor se expanda en múltiples líneas
                                            filaHijo.style.flexWrap = 'wrap';
                                            
                                            packsContainer = document.createElement('div');
                                            packsContainer.className = 'articulo-packs-container';
                                            packsContainer.style.flexBasis = '100%';
                                            packsContainer.style.width = '100%';
                                            packsContainer.style.marginTop = '10px';
                                            packsContainer.style.paddingTop = '8px';
                                            packsContainer.style.borderTop = '1px dashed #dee2e6';
                                            packsContainer.style.display = 'flex';
                                            packsContainer.style.gap = '8px';
                                            packsContainer.style.justifyContent = 'flex-end';
                                            packsContainer.style.alignItems = 'center';
                                            
                                            filaHijo.appendChild(packsContainer);
                                        }
                                        
                                        const btnPadre = document.createElement('button');
                                        btnPadre.className = 'btn btn-info btn-imprimir-padre';
                                        btnPadre.style.padding = '6px 12px';
                                        btnPadre.style.fontSize = '0.9em';
                                        btnPadre.style.fontWeight = 'bold';
                                        btnPadre.style.minWidth = '120px';
                                        // Texto de presentación para lectura rápida
                                        const textoBoton = padre.presentacion_padre || padre.padre_articulo_numero;
                                        btnPadre.innerHTML = `🏷️ Pack: ${textoBoton}`;
                                        // Tooltip con la descripción completa
                                        btnPadre.title = `Imprimir etiquetas de Pack para:\n${padre.padre_descripcion}`;
                                        
                                        btnPadre.onclick = async () => {
                                            const qtyStr = prompt(`Ingrese la cantidad de etiquetas a imprimir para el pack:\n${padre.padre_descripcion}`, '1');
                                            if (!qtyStr) return; // Se canceló el prompt
                                            
                                            const qty = parseInt(qtyStr, 10);
                                            if (isNaN(qty) || qty <= 0) {
                                                alert('⚠️ Cantidad inválida ingresada. Operación cancelada.');
                                                return;
                                            }
                                            
                                            try {
                                                btnPadre.disabled = true;
                                                btnPadre.textContent = 'Imprimiendo...';
                                                
                                                const resPrint = await fetch('http://localhost:3000/api/imprimir', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({
                                                        articulo: {
                                                            numero: padre.padre_articulo_numero,
                                                            nombre: padre.padre_descripcion,
                                                            codigo_barras: padre.padre_codigo_barras
                                                        },
                                                        cantidad: qty
                                                    })
                                                });
                                                
                                                if (!resPrint.ok) throw new Error('Error de comunicación con el motor de impresión');
                                                
                                                if (typeof mostrarNotificacion === 'function') {
                                                    mostrarNotificacion(`✅ ${qty} etiquetas enviadas a imprimir para ${padre.padre_descripcion}`);
                                                } else {
                                                    alert(`✅ ${qty} etiquetas enviadas a imprimir para ${padre.padre_descripcion}`);
                                                }
                                                
                                            } catch (e) {
                                                console.error('❌ Error al imprimir pack:', e);
                                                alert('Error al imprimir: ' + e.message);
                                            } finally {
                                                btnPadre.disabled = false;
                                                btnPadre.innerHTML = `🏷️ Pack: ${textoBoton}`;
                                            }
                                        };
                                        // Insertar el botón en el contenedor secundario inferior
                                        packsContainer.appendChild(btnPadre);
                                    });
                                }
                            })
                            .catch(err => console.error('Error al obtener padres para impresión:', err));
                    } else {
                        btnImprimirEtiquetas.style.display = 'none';
                        console.log('🚚 Botón "Imprimir Etiquetas" ocultado para carro externo');
                        // LIMPIAR BOTONES ANTERIORES DE PADRES si el carro cambió de tipo (higiene)
                        document.querySelectorAll('.btn-imprimir-padre').forEach(btn => btn.remove());
                    }
                }

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

        // 2. Mantener informes de ingredientes padres y mixes visibles horizontalmente sin minimizar
        const resumenIngredientes = document.getElementById('resumen-ingredientes');
        const resumenMixes = document.getElementById('resumen-mixes');

        if (resumenIngredientes) {
            // Removida la opacidad/minimizado a pedido de QA (Mantiene Stock Domicilio a la vista)
            resumenIngredientes.classList.remove('minimizado');
            console.log('✅ Resumen de ingredientes mantenido activo');
        }

        if (resumenMixes) {
            resumenMixes.classList.remove('minimizado');
            console.log('✅ Resumen de mixes mantenido activo');
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

        // Iterar sobre los artículos padre del DOM para asegurar que mostremos botón de "Vincular" si falta
        const articulosPadresElementos = document.querySelectorAll('.articulo-container');
        if (articulosPadresElementos.length === 0 && articulosVinculados.length === 0) {
             console.log('ℹ️ No hay artículos vinculados ni padres para mostrar');
             return;
        }

        articulosPadresElementos.forEach(padreEl => {
            const numeroPadre = padreEl.getAttribute('data-numero');
            const descripcionPadreElement = padreEl.querySelector('.articulo-descripcion');
            const descripcionPadre = descripcionPadreElement ? descripcionPadreElement.textContent : 'Artículo Padre';

            // Buscar si tiene vínculo
            const vinculo = articulosVinculados.find(v => v.articulo_produccion_codigo === numeroPadre);

            if (vinculo) {
                html += `
                    <div class="articulo-secundario-editable" data-relacion-id="${vinculo.id}">
                        <div class="articulo-info">
                            <span class="vinculo-icono">🔗</span>
                            <span class="articulo-codigo">${vinculo.articulo_kilo_codigo}</span>
                            <span class="articulo-descripcion" title="${vinculo.articulo_kilo_nombre || 'Artículo vinculado'}">${vinculo.articulo_kilo_nombre || 'Artículo vinculado'}</span>
                            ${vinculo.articulo_kilo_codigo_barras ? `<span class="codigo-barras" title="Código de barras: ${vinculo.articulo_kilo_codigo_barras}">📊 ${vinculo.articulo_kilo_codigo_barras}</span>` : ''}
                            <span class="vinculo-etiqueta">Vinculado a: ${vinculo.articulo_produccion_codigo}</span>
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
            } else {
                html += `
                    <div class="articulo-secundario-editable" style="background-color: #fff3cd; border-left-color: #ffc107;">
                        <div class="articulo-info">
                            <span class="vinculo-icono" style="opacity: 0.5;">⚠️</span>
                            <span class="articulo-codigo" style="color: #666;">Falta relacionar</span>
                            <span class="articulo-descripcion" style="color: #666;">El artículo de cocina precisa vínculo final</span>
                            <span class="vinculo-etiqueta" style="color: #856404; background-color: #ffeeba;">Padre crudo: ${numeroPadre}</span>
                        </div>
                        <div class="articulo-actions">
                            <button class="btn-vincular-articulo" 
                                    data-articulo="${numeroPadre}"
                                    title="Vincular con artículo por kilo">
                                ➕ Vincular artículo final
                            </button>
                        </div>
                    </div>
                `;
            }
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

        console.group('🕵️‍♂️ VIGÍA DEPURADOR: Flujo de Ingredientes Locales (Secundarios)');
        console.log(`[Petición] Consultando API -> /api/produccion/carro/${carroId}/ingredientes-vinculados`);
        
        // Obtener ingredientes de artículos vinculados
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingredientes-vinculados?usuarioId=${colaborador.id}`);

        if (!response.ok) {
            console.error(`❌ [FALLA API] HTTP Error: ${response.status} - El endpoint de ingredientes vinculados colapsó o no encontró datos.`);
            alert(`Error de Sistema: No se pudieron cargar los ingredientes locales. Código: ${response.status}. Por favor contactar a soporte técnico.`);
            console.groupEnd();
            return;
        }

        const ingredientesVinculados = await response.json();
        console.log(`✅ [VIGÍA A] Payload crudo recibido del Backend:`);
        console.table(ingredientesVinculados);
        console.groupEnd();

        // Crear o actualizar sección de informes vinculados
        let seccionInformesVinculados = document.getElementById('resumen-ingredientes-vinculados');
        if (!seccionInformesVinculados) {
            seccionInformesVinculados = document.createElement('div');
            seccionInformesVinculados.id = 'resumen-ingredientes-vinculados';
            seccionInformesVinculados.className = 'seccion-resumen';

            // Insertar debajo de los artículos secundarios o de la lista de artículos principal
            const seccionSecundarios = document.getElementById('seccion-articulos-secundarios');
            const listaArticulos = document.getElementById('lista-articulos');
            
            if (seccionSecundarios && seccionSecundarios.parentNode) {
                seccionSecundarios.parentNode.insertBefore(seccionInformesVinculados, seccionSecundarios.nextSibling);
            } else if (listaArticulos && listaArticulos.parentNode) {
                listaArticulos.parentNode.insertBefore(seccionInformesVinculados, listaArticulos.nextSibling);
            } else {
                const workspaceLeft = document.querySelector('.workspace-left');
                if (workspaceLeft) {
                    workspaceLeft.appendChild(seccionInformesVinculados);
                }
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
                            <th>Proporción (por kilo)</th>
                            <th>Cantidad Necesaria</th>
                            <th>Stock General</th>
                            <th>Estado</th>
                            <th>Unidad</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            ingredientesVinculados.forEach(ing => {
                // Convertir a números de forma segura
                let stockActual = parseFloat(ing.stock_actual) || 0;
                let cantidadBase = parseFloat(ing.cantidad_base_por_kilo) || parseFloat(ing.cantidad) || 0;
                
                console.log(`✅ [VIGÍA B] Estado almacenado antes de renderizar para ${ing.nombre}: Base=${cantidadBase}, Stock=${stockActual}`);

                html += `
                    <tr class="ingrediente-vinculado" data-base-kilo="${cantidadBase}" data-stock="${stockActual}" data-unidad="${ing.unidad_medida || ''}" data-id="${ing.id}">
                        <td>${ing.nombre || 'Sin nombre'}</td>
                        <td class="cell-proporcion font-weight-bold" style="color: #17a2b8;">${cantidadBase.toFixed(3)}</td>
                        <td class="cell-requerido font-weight-bold" style="color: #6c757d;">0.000 <span style="font-size: 14px; font-weight: 500; opacity: 0.8; color: #5d6d7e;">${ing.unidad_medida || 'kg'}</span></td>
                        <td>${stockActual.toFixed(2)}</td>
                        <td class="cell-estado">-</td>
                        <td>${ing.unidad_medida || ''}</td>
                        <td>
                            <div style="display: flex; gap: 8px; justify-content: center;">
                                <button onclick="window.abrirModalIngresoManual(${ing.id}, window.carroIdGlobal)">Ingreso manual</button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            html += `
                    </tbody>
                </table>
            `;
            
            // Instalar el recalculador en tiempo real si el input existe
            setTimeout(() => {
                const inputKilos = document.getElementById('kilos-producidos');
                if (inputKilos) {
                    // Remover listeners viejos para evitar duplicación
                    inputKilos.removeEventListener('input', window._recalcularVinculados);
                    window._recalcularVinculados = function() {
                        const kilosStr = this.value.replace(',', '.');
                        const kilos = parseFloat(kilosStr) || 0;
                        const filas = document.querySelectorAll('.ingrediente-vinculado');
                        
                        filas.forEach(fila => {
                            const baseKilo = parseFloat(fila.dataset.baseKilo) || 0;
                            const stockActual = parseFloat(fila.dataset.stock) || 0;
                            const unidad = fila.dataset.unidad || '';
                            
                            const cellRequerido = fila.querySelector('.cell-requerido');
                            const cellEstado = fila.querySelector('.cell-estado');
                            
                            if (kilos <= 0) {
                                cellRequerido.innerHTML = `0.000 <span style="font-size: 14px; font-weight: 500; opacity: 0.8; color: #5d6d7e;">${unidad || 'kg'}</span>`;
                                cellRequerido.style.color = '#6c757d';
                                cellEstado.innerHTML = '-';
                                fila.className = 'ingrediente-vinculado';
                                return;
                            }
                            
                            console.log(`✅ [VIGÍA C] Mapeo de tabla en tiempo real: Kilos Producidos=${kilos}, Base/Kilo=${baseKilo}`);
                            
                            const cantidadNecesaria = baseKilo * kilos;
                            console.log(`✅ [VIGÍA D] Valor inyectado en celda de DOM (Requerido): ${cantidadNecesaria}`);
                            
                            cellRequerido.innerHTML = `${cantidadNecesaria.toFixed(3)} <span style="font-size: 14px; font-weight: 500; opacity: 0.8; color: #555;">${unidad || 'kg'}</span>`;
                            cellRequerido.style.color = '';
                            
                            const diferencia = stockActual - cantidadNecesaria;
                            const tieneStock = diferencia >= -0.01;
                            const faltante = tieneStock ? 0 : Math.abs(diferencia);
                            
                            if (tieneStock) {
                                cellEstado.innerHTML = `<span class="stock-suficiente">✅ Suficiente</span>`;
                                fila.className = 'ingrediente-vinculado stock-ok';
                            } else {
                                cellEstado.innerHTML = `<span class="stock-insuficiente">❌ Faltan ${faltante.toFixed(2)} ${unidad}</span>`;
                                fila.className = 'ingrediente-vinculado stock-faltante';
                            }
                        });
                    };
                    inputKilos.addEventListener('input', window._recalcularVinculados);
                    
                    // Disparar inmediatamente por si ya hay un valor
                    if (inputKilos.value) {
                        window._recalcularVinculados.call(inputKilos);
                    }
                }
            }, 100);
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

        console.log('🔄 [PREPARADO] Iniciando actualización completa de la UI...');

        // 1. Actualizar la visibilidad de los botones (esto crea el campo de kilos)
        await actualizarVisibilidadBotones();
        console.log('✅ [PREPARADO] Botones actualizados');

        // 2. Actualizar el estado del carro en la lista
        if (window.actualizarEstadoCarro) {
            await window.actualizarEstadoCarro();
            console.log('✅ [PREPARADO] Estado del carro actualizado');
        }

        // 3. 🔄 FORZAR RECARGA COMPLETA del panel derecho
        console.log('🔄 [PREPARADO] Forzando recarga completa del panel derecho...');

        // Obtener y mostrar ingredientes
        if (window.obtenerResumenIngredientesCarro && window.mostrarResumenIngredientes) {
            const ingredientes = await window.obtenerResumenIngredientesCarro(carroId, colaborador.id);
            await window.mostrarResumenIngredientes(ingredientes);
            console.log('✅ [PREPARADO] Resumen de ingredientes actualizado');
        }

        // Obtener y mostrar mixes
        if (window.obtenerResumenMixesCarro && window.mostrarResumenMixes) {
            const mixes = await window.obtenerResumenMixesCarro(carroId, colaborador.id);
            window.mostrarResumenMixes(mixes);
            console.log('✅ [PREPARADO] Resumen de mixes actualizado');
        }

        // Obtener y mostrar artículos externos (si aplica)
        if (window.obtenerResumenArticulosCarro && window.mostrarResumenArticulos) {
            const articulos = await window.obtenerResumenArticulosCarro(carroId, colaborador.id);
            if (articulos && articulos.length > 0) {
                window.mostrarResumenArticulos(articulos);
                const seccionArticulos = document.getElementById('resumen-articulos');
                if (seccionArticulos) {
                    seccionArticulos.style.display = 'block';
                }
                console.log('✅ [PREPARADO] Resumen de artículos externos actualizado');
            }
        }

        console.log('✅ [PREPARADO] Actualización completa de UI finalizada');

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
                const kilosProducidosStr = kilosProducidosInput.value.replace(',', '.');
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

        console.log('🔄 [FINALIZADO] Iniciando actualización completa de la UI...');

        // 1. Actualizar la visibilidad de los botones
        await actualizarVisibilidadBotones();
        console.log('✅ [FINALIZADO] Botones actualizados');

        // 2. Actualizar el estado del carro en la lista
        if (window.actualizarEstadoCarro) {
            await window.actualizarEstadoCarro();
            console.log('✅ [FINALIZADO] Estado del carro actualizado');
        }

        // 3. 🔄 FORZAR RECARGA COMPLETA del panel derecho
        console.log('🔄 [FINALIZADO] Forzando recarga completa del panel derecho...');

        // Obtener y mostrar ingredientes
        if (window.obtenerResumenIngredientesCarro && window.mostrarResumenIngredientes) {
            const ingredientes = await window.obtenerResumenIngredientesCarro(carroId, colaborador.id);
            await window.mostrarResumenIngredientes(ingredientes);
            console.log('✅ [FINALIZADO] Resumen de ingredientes actualizado');
        }

        // Obtener y mostrar mixes
        if (window.obtenerResumenMixesCarro && window.mostrarResumenMixes) {
            const mixes = await window.obtenerResumenMixesCarro(carroId, colaborador.id);
            window.mostrarResumenMixes(mixes);
            console.log('✅ [FINALIZADO] Resumen de mixes actualizado');
        }

        // Obtener y mostrar artículos externos (si aplica)
        if (window.obtenerResumenArticulosCarro && window.mostrarResumenArticulos) {
            const articulos = await window.obtenerResumenArticulosCarro(carroId, colaborador.id);
            if (articulos && articulos.length > 0) {
                window.mostrarResumenArticulos(articulos);
                const seccionArticulos = document.getElementById('resumen-articulos');
                if (seccionArticulos) {
                    seccionArticulos.style.display = 'block';
                }
                console.log('✅ [FINALIZADO] Resumen de artículos externos actualizado');
            }
        }

        console.log('✅ [FINALIZADO] Actualización completa de UI finalizada');

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
window.asentarProduccion = finalizarProduccion; // Alias para compatibilidad
window.imprimirEtiquetasCarro = imprimirEtiquetasCarro;
window.actualizarVisibilidadBotones = actualizarVisibilidadBotones;

// Mantener compatibilidad con el nombre anterior
export const actualizarVisibilidadBotonPreparado = actualizarVisibilidadBotones;

/**
 * 📊 FUNCIÓN PARA CALCULAR MERMA/REDUCCIÓN POR COCCIÓN
 * Calcula dinámicamente la diferencia entre el peso en crudo y el peso final
 * Solo para carros de producción externa
 * 
 * ⚠️ VERSIÓN CON DEPURACIÓN AGRESIVA Y VISUALIZACIÓN FORZADA
 */
async function calcularMermaProduccion(carroId) {
    console.log('🚀 [MERMA] ========================================');
    console.log('🚀 [MERMA] FUNCIÓN calcularMermaProduccion INICIADA');
    console.log('🚀 [MERMA] Carro ID:', carroId);
    console.log('🚀 [MERMA] ========================================');

    try {
        // PASO 1: Verificar elementos del DOM
        console.log('🔍 [MERMA-PASO-1] Buscando elementos del DOM...');
        const inputKilos = document.getElementById('kilos-producidos');
        const calculoMerma = document.getElementById('calculo-merma');

        console.log('🔍 [MERMA-PASO-1] Input encontrado:', !!inputKilos);
        console.log('🔍 [MERMA-PASO-1] Panel encontrado:', !!calculoMerma);

        if (!inputKilos || !calculoMerma) {
            console.error('❌ [MERMA-PASO-1] FALLO: Elementos del DOM no encontrados');
            return;
        }

        // PASO 2: Obtener valor del input
        console.log('🔍 [MERMA-PASO-2] Obteniendo valor del input...');
        const valorInput = inputKilos.value.replace(',', '.');
        console.log('🔍 [MERMA-PASO-2] Valor raw del input:', valorInput);

        const kilosProducidos = parseFloat(valorInput);
        console.log('🔍 [MERMA-PASO-2] Valor parseado:', kilosProducidos);
        console.log('🔍 [MERMA-PASO-2] Es NaN?:', isNaN(kilosProducidos));
        console.log('🔍 [MERMA-PASO-2] Es <= 0?:', kilosProducidos <= 0);

        // Si no hay valor válido, ocultar el cálculo
        if (isNaN(kilosProducidos) || kilosProducidos <= 0) {
            console.log('⚠️ [MERMA-PASO-2] Valor inválido, ocultando panel');
            calculoMerma.style.display = 'none';
            return;
        }

        console.log('✅ [MERMA-PASO-2] Valor válido, continuando...');

        // PASO 3: Obtener colaborador
        console.log('🔍 [MERMA-PASO-3] Obteniendo colaborador...');
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        console.log('🔍 [MERMA-PASO-3] Colaborador data:', colaboradorData);

        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;
        console.log('🔍 [MERMA-PASO-3] Colaborador parseado:', colaborador);

        if (!colaborador) {
            console.error('❌ [MERMA-PASO-3] FALLO: No hay colaborador activo');
            // ⚠️ MOSTRAR PANEL AUNQUE FALLE
            calculoMerma.style.display = 'block';
            document.getElementById('total-crudo').textContent = 'N/A';
            document.getElementById('kilos-final').textContent = `${kilosProducidos.toFixed(2)} kg`;
            document.getElementById('diferencia-peso').textContent = 'N/A';
            document.getElementById('porcentaje-reduccion').textContent = 'N/A';
            return;
        }

        console.log('✅ [MERMA-PASO-3] Colaborador OK, ID:', colaborador.id);

        // PASO 4: Obtener peso del artículo base (INSUMOS A RETIRAR)
        console.log('🔍 [MERMA-PASO-4] Obteniendo peso artículo base (insumos a retirar)...');
        let pesoArticuloBase = 0;

        try {
            // 🎯 ESTRATEGIA: Consultar stock_real_consolidado.kilos_unidad directamente
            console.log('🔍 [MERMA-PASO-4] Consultando kilos_unidad desde stock_real_consolidado...');

            // Primero obtener los códigos de artículos del carro
            const tablaArticulos = document.querySelector('#resumen-articulos table tbody');

            if (tablaArticulos) {
                const filas = tablaArticulos.querySelectorAll('tr');
                console.log('🔍 [MERMA-PASO-4] Artículos en tabla:', filas.length);

                for (const fila of filas) {
                    const celdas = fila.querySelectorAll('td');
                    if (celdas.length >= 1) {
                        const codigo = celdas[0]?.textContent.trim();
                        console.log(`🔍 [MERMA-PASO-4] Consultando kilos_unidad para: ${codigo}`);

                        // 🔧 CODIFICAR URL para manejar caracteres especiales como /
                        const codigoCodificado = encodeURIComponent(codigo);
                        const stockResponse = await fetch(`http://localhost:3002/api/produccion/stock/${codigoCodificado}`);

                        console.log(`🔍 [MERMA-PASO-4] URL: http://localhost:3002/api/produccion/stock/${codigoCodificado}`);
                        console.log(`🔍 [MERMA-PASO-4] Response status: ${stockResponse.status}`);

                        if (stockResponse.ok) {
                            const stockData = await stockResponse.json();
                            const kilosUnidad = parseFloat(stockData.kilos_unidad || 0);

                            console.log(`✅ [MERMA-PASO-4] ${codigo}:`);
                            console.log(`   - kilos_unidad: ${kilosUnidad} kg`);
                            console.log(`   - stock_consolidado: ${stockData.stock_consolidado} kg`);

                            pesoArticuloBase += kilosUnidad;
                        } else {
                            console.warn(`⚠️ [MERMA-PASO-4] Error ${stockResponse.status} para ${codigo}`);
                            // Intentar leer el error
                            try {
                                const errorData = await stockResponse.json();
                                console.warn(`⚠️ [MERMA-PASO-4] Detalle error:`, errorData);
                            } catch (e) {
                                console.warn(`⚠️ [MERMA-PASO-4] No se pudo leer el error`);
                            }
                        }
                    }
                }

                console.log(`✅ [MERMA-PASO-4] Peso total desde stock_real_consolidado: ${pesoArticuloBase} kg`);
            } else {
                console.warn('⚠️ [MERMA-PASO-4] No se encontró tabla de artículos externos');
            }

            console.log(`✅ [MERMA-PASO-4] Peso total artículos base: ${pesoArticuloBase} kg`);

        } catch (error) {
            console.error('❌ [MERMA-PASO-4] ERROR:', error);
            console.error('❌ [MERMA-PASO-4] Stack:', error.stack);
            // Continuar con peso 0
        }

        // PASO 5: Obtener peso de ingredientes
        console.log('🔍 [MERMA-PASO-5] Obteniendo ingredientes personales...');
        let pesoIngredientes = 0;

        try {
            const urlIngredientes = `http://localhost:3002/api/produccion/carro/${carroId}/ingredientes?usuarioId=${colaborador.id}`;
            console.log('🔍 [MERMA-PASO-5] URL ingredientes:', urlIngredientes);

            const ingredientesResponse = await fetch(urlIngredientes);
            console.log('🔍 [MERMA-PASO-5] Response status:', ingredientesResponse.status);

            if (ingredientesResponse.ok) {
                const ingredientes = await ingredientesResponse.json();
                console.log('🔍 [MERMA-PASO-5] Total ingredientes:', ingredientes.length);

                const ingredientesPersonales = ingredientes.filter(ing => !ing.es_de_articulo_vinculado);
                console.log('🔍 [MERMA-PASO-5] Ingredientes personales:', ingredientesPersonales.length);

                pesoIngredientes = ingredientesPersonales.reduce((sum, ing) => {
                    const peso = parseFloat(ing.cantidad || 0);
                    console.log(`   - ${ing.nombre}: ${peso} kg`);
                    return sum + peso;
                }, 0);

                console.log(`✅ [MERMA-PASO-5] Peso total ingredientes: ${pesoIngredientes} kg`);
            }
        } catch (error) {
            console.error('❌ [MERMA-PASO-5] ERROR:', error);
            // Continuar con peso 0
        }

        // PASO 6: Calcular totales
        console.log('🔍 [MERMA-PASO-6] Calculando totales...');
        const totalCrudo = pesoArticuloBase + pesoIngredientes;
        const diferenciaPeso = kilosProducidos - totalCrudo;
        const porcentajeReduccion = totalCrudo > 0 ? (Math.abs(diferenciaPeso) / totalCrudo) * 100 : 0;

        console.log('📊 [MERMA-PASO-6] RESULTADOS:');
        console.log(`   - Peso artículos base: ${pesoArticuloBase} kg`);
        console.log(`   - Peso ingredientes: ${pesoIngredientes} kg`);
        console.log(`   - Total en crudo: ${totalCrudo} kg`);
        console.log(`   - Kilos producidos: ${kilosProducidos} kg`);
        console.log(`   - Diferencia: ${diferenciaPeso} kg`);
        console.log(`   - % Reducción: ${porcentajeReduccion}%`);

        // PASO 7: Actualizar UI (SIEMPRE)
        console.log('🔍 [MERMA-PASO-7] Actualizando UI...');

        document.getElementById('total-crudo').textContent = `${totalCrudo.toFixed(2)} kg`;
        document.getElementById('kilos-final').textContent = `${kilosProducidos.toFixed(2)} kg`;

        const spanDiferencia = document.getElementById('diferencia-peso');
        spanDiferencia.textContent = `${diferenciaPeso.toFixed(2)} kg`;
        spanDiferencia.style.color = diferenciaPeso < 0 ? '#dc3545' : '#28a745';

        const spanPorcentaje = document.getElementById('porcentaje-reduccion');
        spanPorcentaje.textContent = `${porcentajeReduccion.toFixed(2)}%`;
        spanPorcentaje.style.color = porcentajeReduccion > 15 ? '#dc3545' : porcentajeReduccion > 10 ? '#ffc107' : '#28a745';

        // ⚠️ FORZAR VISUALIZACIÓN DEL PANEL
        calculoMerma.style.display = 'block';
        console.log('✅ [MERMA-PASO-7] Panel mostrado con display: block');

        console.log('🎉 [MERMA] ========================================');
        console.log('🎉 [MERMA] CÁLCULO COMPLETADO EXITOSAMENTE');
        console.log('🎉 [MERMA] ========================================');

    } catch (error) {
        console.error('💥 [MERMA] ERROR CRÍTICO EN FUNCIÓN:', error);
        console.error('💥 [MERMA] Stack trace:', error.stack);

        // ⚠️ INCLUSO EN ERROR, MOSTRAR ALGO
        try {
            const calculoMerma = document.getElementById('calculo-merma');
            if (calculoMerma) {
                calculoMerma.style.display = 'block';
                document.getElementById('total-crudo').textContent = 'ERROR';
                document.getElementById('kilos-final').textContent = 'ERROR';
                document.getElementById('diferencia-peso').textContent = 'ERROR';
                document.getElementById('porcentaje-reduccion').textContent = 'ERROR';
            }
        } catch (e) {
            console.error('💥 [MERMA] No se pudo mostrar panel de error:', e);
        }
    }
}

// Hacer la función disponible globalmente
window.calcularMermaProduccion = calcularMermaProduccion;
