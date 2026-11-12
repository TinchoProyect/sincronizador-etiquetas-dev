// Función para verificar si los artículos del carro requieren entrada dual (Unidades <-> Kilos)
export function verificarYConfigurarModoDual() {
    const containerUnidades = document.getElementById('container-unidades-helper');
    const inputKilos = document.getElementById('kilos-producidos');
    const inputUnidades = document.getElementById('unidades-producidas');
    const labelFactor = document.getElementById('factor-conversion-texto');

    if (!containerUnidades || !inputKilos || !inputUnidades) return false;

    let factorConversion = null;
    let descCoincidencia = '';

    // 1. Chequeo determinista por Línea de Negocio 5 (Barritas)
    const ldnActiva = Number(window.carroActivoMetadata?.linea_negocio || window._carroActivoInfo?.linea_negocio || 0);
    if (ldnActiva === 5) {
        factorConversion = 0.05;
        descCoincidencia = 'Línea 5: Barritas (50g / 20u por kg)';
    }

    // 2. Fallback por inspección de códigos y descripciones de artículos en el DOM
    if (!factorConversion) {
        const elementos = document.querySelectorAll(
            '#lista-articulos .articulo-descripcion, #lista-articulos .articulo-codigo, ' +
            '.seccion-articulos-vinculados-editable .articulo-descripcion, .seccion-articulos-vinculados-editable .articulo-codigo, ' +
            '.articulo-vinculado .articulo-descripcion, .articulo-vinculado .articulo-codigo, ' +
            '.articulo-secundario-editable .articulo-descripcion, .articulo-secundario-editable .articulo-codigo, ' +
            '.articulo-container .articulo-descripcion, .articulo-container .articulo-codigo, ' +
            '.articulo-descripcion'
        );

        const textos = Array.from(elementos).map(el => (el.textContent || '').toLowerCase().trim());

        for (const txt of textos) {
            if (txt.includes('barra flor') || txt.includes('barrita') || txt.includes('barra') || txt.includes('bfx') || txt.startsWith('bf')) {
                factorConversion = 0.05;
                descCoincidencia = 'Barritas (50g / 20u por kg)';
                break;
            } else if (txt.includes('alfajor')) {
                factorConversion = 0.06;
                descCoincidencia = 'Alfajor (60g)';
                break;
            }
        }
    }

    if (!factorConversion) {
        containerUnidades.style.display = 'none';
        return false;
    }

    console.log(`⚖️ [MODO DUAL] Activado para ${descCoincidencia} - Factor: ${factorConversion}`);
    containerUnidades.style.display = 'block';
    const labelUnidadesEl = containerUnidades.querySelector('label[for="unidades-producidas"]');
    if (labelUnidadesEl) {
        labelUnidadesEl.textContent = factorConversion === 0.05 ? 'O cantidad de Barritas (unidades):' : 'O cantidad de unidades:';
    }
    if (labelFactor) {
        labelFactor.textContent = factorConversion === 0.05
            ? '1 barrita = 0.05 kg (20 barritas = 1 kg · Ej: 96 u = 4.80 kg)'
            : `1 unidad ≈ ${factorConversion} kg`;
    }

    // Si ya hay kilos cargados pero no unidades, sincronizar unidades
    if (inputKilos.value && !inputUnidades.value) {
        const k = parseFloat(inputKilos.value.replace(',', '.'));
        if (!isNaN(k) && k > 0) {
            inputUnidades.value = Math.round(k / factorConversion);
        }
    }

    // Configurar listeners bidireccionales sin duplicar llamadas a calcularMermaProduccion
    inputUnidades.oninput = function () {
        const u = parseFloat(this.value.replace(',', '.'));
        if (!isNaN(u) && u > 0) {
            inputKilos.value = (u * factorConversion).toFixed(2);
        } else {
            inputKilos.value = '';
        }
        const carroId = document.getElementById('workspace-container')?.dataset?.carroId || window.carroIdGlobal || sessionStorage.getItem('carroActivo') || localStorage.getItem('carroActivo');
        if (window.calcularMermaProduccion && carroId) {
            window.calcularMermaProduccion(carroId, true);
        }
        if (typeof window._recalcularVinculados === 'function') {
            window._recalcularVinculados.call(inputKilos);
        }
    };

    inputKilos.oninput = function () {
        const k = parseFloat(this.value.replace(',', '.'));
        if (!isNaN(k) && k > 0) {
            inputUnidades.value = Math.round(k / factorConversion);
        } else {
            inputUnidades.value = '';
        }
        const carroId = document.getElementById('workspace-container')?.dataset?.carroId || window.carroIdGlobal || sessionStorage.getItem('carroActivo') || localStorage.getItem('carroActivo');
        if (window.calcularMermaProduccion && carroId) {
            window.calcularMermaProduccion(carroId, true);
        }
    };

    return true;
}
window.verificarYConfigurarModoDual = verificarYConfigurarModoDual;

// Función para actualizar la visibilidad de los botones según el estado del carro
export async function actualizarVisibilidadBotones() {
    const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    const btnCarroPreparado = document.getElementById('carro-preparado');
    const btnRevertirPreparado = document.getElementById('revertir-preparado');
    const btnFinalizarProduccion = document.getElementById('finalizar-produccion');
    const btnAgregarArticulo = document.getElementById('agregar-articulo');
    const btnImprimirEtiquetas = document.getElementById('imprimir-etiquetas');
    const btnImprimirEtiquetasLote = document.getElementById('imprimir-etiquetas-lote');
    const btnImprimirOrden = document.getElementById('imprimir-orden-produccion');
    const btnGuardadoIngredientes = document.getElementById('guardado-ingredientes');
    const btnToggleModoMedicion = document.getElementById('btn-toggle-modo-medicion');

    // Ocultar por defecto al iniciar chequeo
    if (btnImprimirEtiquetasLote) btnImprimirEtiquetasLote.style.display = 'none';
    const checkFechasLoteContainer = document.getElementById('check-fechas-lote-container');
    if (checkFechasLoteContainer) checkFechasLoteContainer.style.display = 'none';

    if (!carroId) {
        // No hay carro activo - ocultar todos los botones de acción
        if (btnCarroPreparado) btnCarroPreparado.style.display = 'none';
        if (btnRevertirPreparado) btnRevertirPreparado.style.display = 'none';
        if (btnFinalizarProduccion) btnFinalizarProduccion.style.display = 'none';
        if (btnAgregarArticulo) btnAgregarArticulo.style.display = 'none';
        if (btnImprimirEtiquetas) btnImprimirEtiquetas.style.display = 'none';
        if (btnImprimirEtiquetasLote) btnImprimirEtiquetasLote.style.display = 'none';
        if (btnImprimirOrden) btnImprimirOrden.style.display = 'none';
        if (btnGuardadoIngredientes) btnGuardadoIngredientes.style.display = 'none';
        if (checkFechasLoteContainer) checkFechasLoteContainer.style.display = 'none';
        document.querySelectorAll('.btn-imprimir-padre').forEach(btn => btn.remove());
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
                if (btnRevertirPreparado) {
                    btnRevertirPreparado.style.display = 'none';
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
                if (btnRevertirPreparado) {
                    btnRevertirPreparado.style.display = 'inline-block';
                    btnRevertirPreparado.disabled = false;
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

                    // Guardar metadatos de Línea de Negocio (Regla 5 AGENTS.md)
                    window.carroActivoMetadata = data;
                    const ldnNum = data.linea_negocio || 4;
                    const ldnNombre = data.nombre_linea_negocio || (ldnNum === 4 ? 'Línea de Negocio 4: Tostadero (UP Externa Simple)' : ldnNum === 5 ? 'Línea de Negocio 5: Barritas (Mezcla Interna + UP Externa)' : 'Línea de Negocio 6: Granolas (Doble Mezcla / UP Externa)');
                    const ldnIcono = data.icono_linea_negocio || (ldnNum === 4 ? '🔥' : ldnNum === 5 ? '🍫' : '🥣');
                    const ldnSubtitulo = data.subtitulo_linea_negocio || (ldnNum === 4 ? 'Tostadero (UP Externa Simple — Bulto Crudo Directo)' : ldnNum === 5 ? 'Barritas (Mezcla Interna + UP Externa)' : 'Granolas (Doble Mezcla / UP Externa)');
                    
                    const ldnStyles = ldnNum === 4 ? {
                        bg: '#fff7ed', border: '#fdba74', text: '#9a3412', badgeBg: '#ffedd5', badgeBorder: '#f97316'
                    } : ldnNum === 5 ? {
                        bg: '#f5f3ff', border: '#c4b5fd', text: '#5b21b6', badgeBg: '#ede9fe', badgeBorder: '#8b5cf6'
                    } : {
                        bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46', badgeBg: '#d1fae5', badgeBorder: '#10b981'
                    };

                    const bannerLdnHtml = `
                        <div id="banner-linea-negocio-carro" style="background: ${ldnStyles.bg}; border: 1px solid ${ldnStyles.border}; border-left: 4px solid ${ldnStyles.badgeBorder}; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 1.4em;">${ldnIcono}</span>
                                <div>
                                    <div style="font-weight: bold; color: ${ldnStyles.text}; font-size: 0.92em;">${ldnNombre}</div>
                                    <div style="font-size: 0.78em; color: #64748b;">${ldnSubtitulo}</div>
                                </div>
                            </div>
                            <span style="background: ${ldnStyles.badgeBg}; color: ${ldnStyles.text}; border: 1px solid ${ldnStyles.badgeBorder}; font-size: 0.75em; font-weight: 800; padding: 2px 8px; border-radius: 9999px;">
                                FLUJO ${ldnNum}
                            </span>
                        </div>
                    `;

                    let kilosProducidosContainer = document.getElementById('kilos-producidos-container');

                    // Si no existe, crearlo dinámicamente
                    if (!kilosProducidosContainer) {
                        kilosProducidosContainer = document.createElement('div');
                        kilosProducidosContainer.id = 'kilos-producidos-container';
                        kilosProducidosContainer.className = 'kilos-producidos-container';
                        kilosProducidosContainer.style.cssText = 'margin: 15px 0;';

                        // 1. GENERAR HTML (Con soporte para Unidades, Merma y Línea de Negocio)
                        kilosProducidosContainer.innerHTML = `
                            ${bannerLdnHtml}
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

                        // Insertar después del botón de finalizar producción
                        if (btnFinalizarProduccion && btnFinalizarProduccion.parentElement) {
                            btnFinalizarProduccion.parentElement.insertBefore(kilosProducidosContainer, btnFinalizarProduccion.nextSibling);
                            console.log('✅ Campo de kilos producidos creado e insertado en el DOM');
                        }
                    } else {
                        // Si ya existe, solo mostrarlo y refrescar banner de línea de negocio
                        kilosProducidosContainer.style.display = 'block';
                        console.log('✅ Campo de kilos producidos mostrado (ya existía)');
                        const bannerExistente = document.getElementById('banner-linea-negocio-carro');
                        if (bannerExistente) {
                            bannerExistente.outerHTML = bannerLdnHtml;
                        } else {
                            kilosProducidosContainer.insertAdjacentHTML('afterbegin', bannerLdnHtml);
                        }

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

                    // 🎯 AGREGAR EVENT LISTENER para cálculo dinámico de merma (para nuevo o ya existente)
                    const inputKilos = document.getElementById('kilos-producidos');
                    if (inputKilos && !inputKilos.hasMermaListener) {
                        inputKilos.addEventListener('input', () => {
                            if (typeof inputKilos.oninput === 'function') return; // Evitar doble disparo cuando Modo Dual está activo
                            console.log('🎯 [EVENT] Input detectado en kilos-producidos');
                            calcularMermaProduccion(carroId, true);
                        });
                        inputKilos.addEventListener('blur', () => {
                            console.log('🎯 [EVENT] Blur detectado en kilos-producidos');
                            calcularMermaProduccion(carroId, true);
                        });
                        inputKilos.hasMermaListener = true;
                        console.log('✅ Event listeners para cálculo de merma agregados');
                    }

                    // 🎯 Activar calculadora dual (Unidades <-> Kilos) inmediatamente y pre-mostrar peso crudo
                    verificarYConfigurarModoDual();
                    calcularMermaProduccion(carroId, true);
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
                    verificarYConfigurarModoDual();
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
                        
                        // Mostrar también botón de etiquetas con lote
                        if (btnImprimirEtiquetasLote) {
                            btnImprimirEtiquetasLote.style.display = 'inline-block';
                            const checkFechasLoteContainer = document.getElementById('check-fechas-lote-container');
                            if (checkFechasLoteContainer) checkFechasLoteContainer.style.display = 'inline-flex';
                        }

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
                                                
                                                const packPayload = {
                                                    articulo: {
                                                        numero: padre.padre_articulo_numero,
                                                        nombre: padre.padre_descripcion,
                                                        codigo_barras: padre.padre_codigo_barras
                                                    },
                                                    cantidad: qty
                                                };
                                                let resPrint = await fetch('/api/produccion/articulos/imprimir-etiqueta', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify(packPayload)
                                                }).catch(() => null);
                                                if (!resPrint || !resPrint.ok) {
                                                    resPrint = await fetch('http://localhost:3000/api/imprimir', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify(packPayload)
                                                    });
                                                }
                                                
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
        const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
        const colaboradorData = localStorage.getItem('colaboradorActivo');

        if (!carroId || !colaboradorData) {
            console.warn('⚠️ No hay carro activo o colaborador para mostrar artículos secundarios');
            return;
        }

        const colaborador = JSON.parse(colaboradorData);

        // Obtener artículos vinculados del carro
        const response = await fetch(`/api/produccion/carro/${carroId}/relaciones-articulos?usuarioId=${colaborador.id}`);

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
                const codPuenteSafe = String(vinculo.articulo_kilo_codigo || '').replace(/'/g, "\\'");
                const nomPuenteSafe = String(vinculo.articulo_kilo_nombre || '').replace(/'/g, "\\'");
                const barPuenteSafe = String(vinculo.articulo_kilo_codigo_barras || '').replace(/'/g, "\\'");
                html += `
                    <div class="articulo-secundario-editable" data-relacion-id="${vinculo.id}">
                        <div class="articulo-info">
                            <span class="vinculo-icono">🔗</span>
                            <span class="articulo-codigo">${vinculo.articulo_kilo_codigo}</span>
                            <span class="articulo-descripcion" title="${vinculo.articulo_kilo_nombre || 'Artículo vinculado'}">${vinculo.articulo_kilo_nombre || 'Artículo vinculado'}</span>
                            ${vinculo.articulo_kilo_codigo_barras ? `<span class="codigo-barras" title="Código de barras: ${vinculo.articulo_kilo_codigo_barras}">📊 ${vinculo.articulo_kilo_codigo_barras}</span>` : ''}
                            <span class="vinculo-etiqueta">Vinculado a: ${vinculo.articulo_produccion_codigo}</span>
                        </div>
                        <div class="articulo-actions" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                            <button type="button"
                                    class="btn-imprimir-etiqueta-puente"
                                    onclick="window.imprimirEtiquetaArticuloPuente && window.imprimirEtiquetaArticuloPuente('${codPuenteSafe}', '${nomPuenteSafe}', '${barPuenteSafe}', '${carroId}')"
                                    style="background: #16a34a; color: white; border: none; padding: 5px 10px; border-radius: 4px; font-size: 0.85em; font-weight: bold; cursor: pointer;">
                                🏷️ Imprimir Etiqueta
                            </button>
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
        const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
        const colaboradorData = localStorage.getItem('colaboradorActivo');

        if (!carroId || !colaboradorData) {
            console.warn('⚠️ No hay carro activo o colaborador para mostrar informes vinculados');
            return;
        }

        const colaborador = JSON.parse(colaboradorData);

        console.group('🕵️‍♂️ VIGÍA DEPURADOR: Flujo de Ingredientes Locales (Secundarios)');
        console.log(`[Petición] Consultando API -> /api/produccion/carro/${carroId}/ingredientes-vinculados`);
        
        // Obtener ingredientes de artículos vinculados (post-cocción) E insumos/mezclas base de Receta UP
        const [response, resArticulosUp] = await Promise.all([
            fetch(`/api/produccion/carro/${carroId}/ingredientes-vinculados?usuarioId=${colaborador.id}`),
            fetch(`/api/produccion/carro/${carroId}/articulos-resumen?usuarioId=${colaborador.id}`).catch(() => null)
        ]);

        if (!response.ok) {
            console.error(`❌ [FALLA API] HTTP Error: ${response.status} - El endpoint de ingredientes vinculados colapsó o no encontró datos.`);
            alert(`Error de Sistema: No se pudieron cargar los ingredientes locales. Código: ${response.status}. Por favor contactar a soporte técnico.`);
            console.groupEnd();
            return;
        }

        const ingredientesVinculados = await response.json();
        const articulosUpResumen = (resArticulosUp && resArticulosUp.ok) ? (await resArticulosUp.json()) : [];
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

        // Si no hay ni insumos UP ni ingredientes post-cocción, ocultar la caja para no mostrar un mensaje vacío engañoso
        if ((!articulosUpResumen || articulosUpResumen.length === 0) && (!ingredientesVinculados || ingredientesVinculados.length === 0)) {
            seccionInformesVinculados.style.display = 'none';
            seccionInformesVinculados.classList.remove('activa');
            return;
        }

        let html = '';

        // 1. Mostrar Insumo Base / Mezcla de la Receta UP retirado de depósito (ej: MPB Mezcla p/ Barritas x 4 kg)
        if (articulosUpResumen && articulosUpResumen.length > 0) {
            html += `
                <div style="margin-bottom: ${ingredientesVinculados.length > 0 ? '18px' : '0'};">
                    <h3 style="color: #4c1d95; display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                        📦 Mezcla / Insumo Base de Receta UP (Cargado en Carro)
                    </h3>
                    <div class="descripcion-informe" style="background: #f5f3ff; border-left: 4px solid #8b5cf6; padding: 8px 12px; border-radius: 4px; margin-bottom: 10px;">
                        <p style="margin: 0; color: #4c1d95; font-size: 0.9em;">
                            Este artículo/mezcla forma parte de la receta de la Unidad Productiva (UP) y <strong>ya fue cargado y descontado automáticamente</strong> del stock general de depósito al preparar el carro.
                        </p>
                    </div>
                    <table class="tabla-resumen">
                        <thead>
                            <tr>
                                <th>Código</th>
                                <th>Mezcla / Insumo Base</th>
                                <th>Cant. Cargada</th>
                                <th>Peso Total</th>
                                <th>Stock Restante</th>
                                <th>Estado en este Carro</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            articulosUpResumen.forEach(art => {
                const cantU = parseFloat(art.cantidad_total) || 1;
                const kUnidad = parseFloat(art.kilos_unidad) || 1;
                const kTot = parseFloat(art.kilos_totales) || (cantU * kUnidad);
                const stockAct = parseFloat(art.stock_actual) || 0;

                html += `
                    <tr class="stock-ok" style="background: #faf5ff;">
                        <td><strong>${art.articulo_numero}</strong></td>
                        <td><strong>${art.nombre || art.articulo_numero}</strong></td>
                        <td><strong>${cantU.toFixed(2)} u</strong></td>
                        <td style="color: #5b21b6; font-weight: 700;">${kTot.toFixed(2)} kg</td>
                        <td>${stockAct.toFixed(2)} u</td>
                        <td>
                            <span class="stock-suficiente" style="background: #dcfce7; color: #15803d; padding: 3px 8px; border-radius: 9999px; font-weight: 700; font-size: 0.85em;">
                                ✅ Cargado automáticamente (Receta UP)
                            </span>
                        </td>
                    </tr>
                `;
            });

            html += `
                        </tbody>
                    </table>
                </div>
            `;
        }

        // 2. Mostrar Ingredientes de Artículos Vinculados (Post-Cocción, ej: Línea 6 Granolas) SOLO si existen
        if (ingredientesVinculados && ingredientesVinculados.length > 0) {
            html += `
                <h3>🔗 Ingredientes de Artículos Vinculados (Agregados Post-Cocción)</h3>
                <div class="descripcion-informe">
                    <p>Estos ingredientes corresponden al artículo vinculado de salida y se obtienen del stock general de producción según los kilos producidos.</p>
                </div>
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
                    <tr class="ingrediente-vinculado" data-base-kilo="${cantidadBase}" data-stock="${stockActual}" data-unidad="${ing.unidad_medida || ''}" data-id="${ing.id}" data-es-post-coccion="${ing.es_post_coccion ? 'true' : 'false'}">
                        <td>${ing.nombre || 'Sin nombre'}</td>
                        <td class="cell-proporcion font-weight-bold" style="color: #17a2b8;">${cantidadBase.toFixed(3)}</td>
                        <td class="cell-requerido font-weight-bold" style="color: #6c757d;">0.000 <span style="font-size: 14px; font-weight: 500; opacity: 0.8; color: #5d6d7e;">${ing.unidad_medida || 'kg'}</span></td>
                        <td>${stockActual.toFixed(2)}</td>
                        <td class="cell-estado">-</td>
                        <td>${ing.unidad_medida || ''}</td>
                        <td>
                            <div style="display: flex; gap: 8px; justify-content: center;">
                                <button onclick="window.abrirModalIngresoManual(${ing.id}, ${document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo')})">Ingreso manual</button>
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

function normalizarTextoBusqueda(texto) {
    if (!texto) return '';
    return String(texto)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

// Motor de Búsqueda Universal LAMDA (Regla 3: 9 campos estáticos + propiedades_dinamicas)
if (typeof window.obtenerTextoBusquedaArticulo !== 'function') {
    window.obtenerTextoBusquedaArticulo = function (art) {
        if (!art) return '';
        const camposEstaticos = [
            art.codigo || art.numero || art.articulo_numero,
            art.descripcion || art.nombre || art.nombre_legacy || art.descripcion_generada,
            art.codigo_barras,
            art.familia_nombre || art.familia,
            art.articulo_principal || art.ingrediente_base,
            art.subfamilia,
            art.marca,
            art.proveedor,
            art.presentacion
        ].filter(Boolean).join(' ');

        let camposDinamicos = '';
        if (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') {
            camposDinamicos = Object.values(art.propiedades_dinamicas)
                .map(v => (v && typeof v === 'object') ? (v.valor || v.texto || v.nombre || JSON.stringify(v)) : v)
                .filter(Boolean)
                .join(' ');
        }
        return normalizarTextoBusqueda(`${camposEstaticos} ${camposDinamicos}`);
    };
}

/**
 * Solicita al colaborador el artículo físico real que se lleva a tostar (Línea 4 - Producción de Tostadero),
 * trayendo pre-cargado el último artículo configurado en la UP para selección rápida, y separando las dos opciones
 * de búsqueda igual que en el resto del sistema:
 *  1) Escaneo con lector de código de barras (📷)
 *  2) Búsqueda por texto por grupo de caracteres (🔍)
 */
async function solicitarArticuloLlevadoTostadero(carroId, usuarioId) {
    // 1. Obtener el artículo configurado en la UP (articulos-resumen) y los artículos del carro
    let resumenDefault = [];
    let articulosCarro = [];
    try {
        const [resResumen, resCarro] = await Promise.all([
            fetch(`/api/produccion/carro/${carroId}/articulos-resumen?usuarioId=${usuarioId}`),
            fetch(`/api/produccion/carro/${carroId}/articulos?usuarioId=${usuarioId}`)
        ]);
        if (resResumen.ok) resumenDefault = await resResumen.json();
        if (resCarro.ok) articulosCarro = await resCarro.json();
    } catch (e) {
        console.warn('No se pudo precargar resumen default de Tostadero:', e);
    }

    // 2. Cargar catálogo completo de artículos ({ success, data, total })
    let catalogoArticulos = [];
    try {
        const resCat = await fetch('/api/produccion/articulos');
        if (resCat.ok) {
            const dataCat = await resCat.json();
            catalogoArticulos = Array.isArray(dataCat) ? dataCat : (dataCat.data || dataCat.articulos || []);
        }
    } catch (e) {
        console.error('Error al cargar catálogo de artículos:', e);
    }

    const defaultArt = resumenDefault[0] || null;
    const upPrincipal = articulosCarro[0] || null;
    const cantidadSugerida = defaultArt
        ? (parseFloat(defaultArt.cantidad_total || defaultArt.cantidad) || 1)
        : (upPrincipal ? (parseFloat(upPrincipal.cantidad) || 1) : 1);

    // Armar objeto normalizado a partir de un item del catálogo o del resumen
    const normalizarItemArticulo = (rawArt) => {
        if (!rawArt) return null;
        const cod = String(rawArt.numero || rawArt.codigo || rawArt.articulo_numero || '').trim();
        const matchCat = catalogoArticulos.find(a =>
            String(a.numero || a.codigo || a.articulo_numero || '').trim() === cod
        );
        const desc = rawArt.nombre || rawArt.descripcion || (matchCat && (matchCat.nombre || matchCat.descripcion)) || cod;
        const bar = rawArt.codigo_barras || (matchCat && matchCat.codigo_barras) || '';
        const stock = parseFloat(
            rawArt.stock_actual ?? rawArt.stock_consolidado ?? (matchCat && matchCat.stock_consolidado) ?? 0
        );
        const kilosU = parseFloat(
            rawArt.kilos_unidad || (matchCat && matchCat.kilos_unidad) || 1
        );
        return {
            numero: cod,
            descripcion: desc,
            codigo_barras: bar,
            stock_consolidado: isNaN(stock) ? 0 : stock,
            kilos_unidad: isNaN(kilosU) || kilosU <= 0 ? 1 : kilosU
        };
    };

    const ultimoArticuloUP = normalizarItemArticulo(defaultArt);
    let articuloSeleccionado = ultimoArticuloUP ? { ...ultimoArticuloUP } : null;

    if (typeof Swal === 'undefined') {
        const codPrompt = prompt(
            `🔥 PRODUCCIÓN DE TOSTADERO\nIngrese o escanee el código/código de barras del artículo que se lleva a tostar:`,
            articuloSeleccionado ? articuloSeleccionado.numero : ''
        );
        if (!codPrompt) return null;
        return {
            articulo_numero: codPrompt.trim(),
            cantidad: cantidadSugerida
        };
    }

    const upInfoHtml = upPrincipal
        ? `<div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px 14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
             <div>
                 <div style="font-size:11px; font-weight:800; text-transform:uppercase; color:#1e40af; letter-spacing:0.4px;">🔥 Unidad Productiva a Producir (Carro #${carroId})</div>
                 <div style="font-size:14.5px; font-weight:700; color:#1e3a8a; margin-top:2px;">[${upPrincipal.numero}] ${upPrincipal.descripcion}</div>
             </div>
             <span style="background:#dbeafe; color:#1e40af; font-weight:800; font-size:13px; padding:4px 10px; border-radius:6px;">Cantidad UP: ${upPrincipal.cantidad} u</span>
           </div>`
        : '';

    const ultimoConfiguradoCardHtml = ultimoArticuloUP
        ? `<div id="swal-card-ultimo-up"
                style="background:#fffbeb; border:2px solid #f59e0b; border-radius:8px; padding:10px 14px; margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
             <div style="flex:1; min-width:220px;">
                 <div style="font-size:11px; font-weight:800; text-transform:uppercase; color:#b45309; letter-spacing:0.4px;">
                     ⭐ Último artículo configurado en esta UP (Selección Rápida)
                 </div>
                 <div style="font-size:14.5px; font-weight:700; color:#0f172a; margin-top:3px;">
                     [${ultimoArticuloUP.numero}] ${ultimoArticuloUP.descripcion}
                 </div>
                 <div style="font-size:12px; color:#475569; margin-top:2px;">
                     📷 Cód. Barras: <strong>${ultimoArticuloUP.codigo_barras || 'Sin código'}</strong> &nbsp;|&nbsp;
                     ⚖️ Peso/u: <strong>${ultimoArticuloUP.kilos_unidad} kg</strong> &nbsp;|&nbsp;
                     📦 Stock: <strong style="color:${ultimoArticuloUP.stock_consolidado > 0 ? '#15803d' : '#dc2626'};">${ultimoArticuloUP.stock_consolidado} u</strong>
                 </div>
             </div>
             <button type="button" id="swal-btn-seleccionar-ultimo"
                     style="background:#16a34a; color:#ffffff; border:none; border-radius:6px; padding:8px 14px; font-size:13px; font-weight:700; cursor:pointer; white-space:nowrap; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
                 ✅ Seleccionado
             </button>
           </div>`
        : '';

    return await new Promise((resolve) => {
        Swal.fire({
            title: '🔥 ¿Qué artículo te llevás a tostar?',
            width: '780px',
            html: `
                <div style="text-align: left; font-family: inherit;">
                    ${upInfoHtml}
                    ${ultimoConfiguradoCardHtml}

                    <!-- Toolbar con las 2 opciones separadas igual que en #modal-articulos -->
                    <div class="modal-toolbar-minimalist" style="padding:12px 14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:10px; display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
                        <div class="toolbar-search-group" style="position:relative; flex:1.3; min-width:230px;">
                            <div style="font-size:11.5px; font-weight:700; color:#334155; margin-bottom:4px;">🔍 Buscar por texto (grupo de caracteres):</div>
                            <div style="position:relative;">
                                <span style="position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:14px; pointer-events:none;">🔍</span>
                                <input type="text"
                                       id="swal-busqueda-texto-tostadero"
                                       placeholder="Buscar artículo (ej: almend non 10)..."
                                       autocomplete="off"
                                       style="width:100%; padding:9px 10px 9px 34px; border:1.5px solid #cbd5e1; border-radius:6px; font-size:13.5px; outline:none; background:#ffffff; box-sizing:border-box;" />
                            </div>
                        </div>

                        <div class="toolbar-barcode-group" style="position:relative; flex:1; min-width:200px;">
                            <div style="font-size:11.5px; font-weight:700; color:#334155; margin-bottom:4px;">📷 Escanear con lector de código de barras:</div>
                            <div style="position:relative;">
                                <span style="position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:14px; pointer-events:none;">📷</span>
                                <input type="text"
                                       id="swal-codigo-barras-tostadero"
                                       placeholder="Código de barras..."
                                       autocomplete="off"
                                       style="width:100%; padding:9px 10px 9px 34px; border:1.5px solid #2563eb; border-radius:6px; font-size:13.5px; outline:none; background:#ffffff; box-sizing:border-box;" />
                            </div>
                        </div>
                    </div>

                    <!-- Tabla de artículos estilo modal-articulos -->
                    <div class="table-responsive" style="max-height:220px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:12px; background:#ffffff;">
                        <table class="tabla-minimalista tabla-articulos" style="width:100%; border-collapse:collapse; font-size:13px;">
                            <thead style="position:sticky; top:0; background:#f1f5f9; z-index:1;">
                                <tr>
                                    <th style="padding:8px 10px; text-align:left; border-bottom:1px solid #cbd5e1;">Código</th>
                                    <th style="padding:8px 10px; text-align:left; border-bottom:1px solid #cbd5e1;">Descripción</th>
                                    <th style="padding:8px 10px; text-align:center; border-bottom:1px solid #cbd5e1;">Cód. Barras</th>
                                    <th style="padding:8px 10px; text-align:center; border-bottom:1px solid #cbd5e1;">Stock</th>
                                    <th style="padding:8px 10px; text-align:center; border-bottom:1px solid #cbd5e1;">Acción</th>
                                </tr>
                            </thead>
                            <tbody id="swal-tbody-articulos-tostadero">
                            </tbody>
                        </table>
                    </div>

                    <!-- Tarjeta resumen del artículo actualmente seleccionado -->
                    <div id="swal-seleccionado-card"
                         style="background: #f0fdf4; border: 2px solid #22c55e; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; display: ${articuloSeleccionado ? 'flex' : 'none'}; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                        <div>
                            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #15803d; letter-spacing: 0.5px;">
                                ✅ Artículo Seleccionado para Llevar a Tostar
                            </div>
                            <div id="swal-sel-titulo" style="font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 2px;">
                                ${articuloSeleccionado ? `[${articuloSeleccionado.numero}] ${articuloSeleccionado.descripcion}` : ''}
                            </div>
                            <div id="swal-sel-meta" style="font-size: 12px; color: #475569; margin-top: 2px;">
                                ${articuloSeleccionado ? `Cód. Barras: <strong>${articuloSeleccionado.codigo_barras || 'S/D'}</strong> | Peso/u: <strong>${articuloSeleccionado.kilos_unidad || 1} kg</strong> | Stock actual: <strong>${articuloSeleccionado.stock_consolidado} u</strong>` : ''}
                            </div>
                        </div>
                    </div>

                    <div style="display:flex; align-items:center; justify-content:space-between; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px;">
                        <div>
                            <label for="swal-input-cantidad-tostadero" style="font-weight:700; font-size:13.5px; color:#0f172a;">
                                📦 Cantidad de Unidades / Bultos que se lleva:
                            </label>
                            <div id="swal-kilos-estimados" style="font-size:12px; color:#0369a1; font-weight:600; margin-top:2px;">
                                ${articuloSeleccionado ? `Equivalente en kilos de entrada: ${(cantidadSugerida * (articuloSeleccionado.kilos_unidad || 1)).toFixed(2)} kg` : ''}
                            </div>
                        </div>
                        <input id="swal-input-cantidad-tostadero"
                               type="number"
                               step="0.01"
                               min="0.01"
                               value="${cantidadSugerida}"
                               style="width:110px; padding:8px 10px; border:1.5px solid #94a3b8; border-radius:6px; font-size:15px; font-weight:700; text-align:center;" />
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '✅ Confirmar y Preparar Carro',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#16a34a',
            cancelButtonColor: '#64748b',
            focusConfirm: false,
            didOpen: () => {
                const inputTexto = document.getElementById('swal-busqueda-texto-tostadero');
                const inputBarcode = document.getElementById('swal-codigo-barras-tostadero');
                const tbody = document.getElementById('swal-tbody-articulos-tostadero');
                const cardSel = document.getElementById('swal-seleccionado-card');
                const selTitulo = document.getElementById('swal-sel-titulo');
                const selMeta = document.getElementById('swal-sel-meta');
                const inputCant = document.getElementById('swal-input-cantidad-tostadero');
                const divKilos = document.getElementById('swal-kilos-estimados');
                const btnUltimo = document.getElementById('swal-btn-seleccionar-ultimo');
                const cardUltimo = document.getElementById('swal-card-ultimo-up');

                const actualizarEstadoBotonUltimo = () => {
                    if (!btnUltimo || !ultimoArticuloUP) return;
                    const esElUltimo = articuloSeleccionado && String(articuloSeleccionado.numero) === String(ultimoArticuloUP.numero);
                    if (esElUltimo) {
                        btnUltimo.textContent = '✅ Seleccionado';
                        btnUltimo.style.background = '#16a34a';
                        if (cardUltimo) cardUltimo.style.borderColor = '#16a34a';
                    } else {
                        btnUltimo.textContent = '⚡ Seleccionar este artículo';
                        btnUltimo.style.background = '#2563eb';
                        if (cardUltimo) cardUltimo.style.borderColor = '#f59e0b';
                    }
                };

                const seleccionarArticulo = (artObj) => {
                    articuloSeleccionado = normalizarItemArticulo(artObj);
                    if (!articuloSeleccionado) {
                        cardSel.style.display = 'none';
                        divKilos.textContent = '';
                        actualizarEstadoBotonUltimo();
                        return;
                    }
                    cardSel.style.display = 'flex';
                    selTitulo.textContent = `[${articuloSeleccionado.numero}] ${articuloSeleccionado.descripcion}`;
                    selMeta.innerHTML = `Cód. Barras: <strong>${articuloSeleccionado.codigo_barras || 'S/D'}</strong> | Peso/u: <strong>${articuloSeleccionado.kilos_unidad || 1} kg</strong> | Stock actual: <strong>${articuloSeleccionado.stock_consolidado ?? 0} u</strong>`;
                    const cantVal = parseFloat(inputCant.value) || 0;
                    divKilos.textContent = `Equivalente en kilos de entrada: ${(cantVal * (articuloSeleccionado.kilos_unidad || 1)).toFixed(2)} kg`;
                    actualizarEstadoBotonUltimo();
                    aplicarFiltrosTabla();
                };

                const renderizarTabla = (lista) => {
                    if (!tbody) return;
                    if (!lista || lista.length === 0) {
                        tbody.innerHTML = `<tr><td colspan="5" style="padding:14px; text-align:center; color:#64748b;">No se encontraron artículos coincidentes.</td></tr>`;
                        return;
                    }

                    tbody.innerHTML = lista.slice(0, 60).map(a => {
                        const item = normalizarItemArticulo(a);
                        const esSel = articuloSeleccionado && String(articuloSeleccionado.numero) === String(item.numero);
                        const esUltimo = ultimoArticuloUP && String(ultimoArticuloUP.numero) === String(item.numero);
                        const colorStock = item.stock_consolidado > 0 ? '#15803d' : '#dc2626';

                        return `
                            <tr class="fila-articulo-tostadero"
                                data-codigo="${String(item.numero).replace(/"/g, '&quot;')}"
                                style="border-bottom:1px solid #f1f5f9; background:${esSel ? '#dcfce7' : (esUltimo ? '#fffbeb' : '#ffffff')}; cursor:pointer;">
                                <td style="padding:8px 10px; font-weight:700; color:#0f172a; white-space:nowrap;">
                                    ${item.numero}
                                    ${esUltimo ? `<div style="font-size:10px; color:#b45309; font-weight:800;">⭐ Último en UP</div>` : ''}
                                </td>
                                <td style="padding:8px 10px; color:#1e293b;">
                                    ${item.descripcion}
                                    <span style="color:#64748b; font-size:11.5px; margin-left:4px;">(${item.kilos_unidad} kg/u)</span>
                                </td>
                                <td style="padding:8px 10px; text-align:center; color:#475569; font-family:monospace; font-size:12px;">
                                    ${item.codigo_barras || '-'}
                                </td>
                                <td style="padding:8px 10px; text-align:center; font-weight:700; color:${colorStock};">
                                    ${item.stock_consolidado}
                                </td>
                                <td style="padding:8px 10px; text-align:center;">
                                    <button type="button"
                                            class="btn-sel-fila-tostadero"
                                            data-codigo="${String(item.numero).replace(/"/g, '&quot;')}"
                                            style="background:${esSel ? '#16a34a' : '#2563eb'}; color:#ffffff; border:none; border-radius:5px; padding:5px 10px; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap;">
                                        ${esSel ? '✅ Seleccionado' : 'Seleccionar'}
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('');

                    tbody.querySelectorAll('.fila-articulo-tostadero').forEach(tr => {
                        tr.addEventListener('click', () => {
                            const cod = tr.getAttribute('data-codigo');
                            const found = catalogoArticulos.find(x => String(x.numero || x.codigo || x.articulo_numero) === String(cod))
                                || (ultimoArticuloUP && String(ultimoArticuloUP.numero) === String(cod) ? ultimoArticuloUP : null);
                            if (found) seleccionarArticulo(found);
                        });
                    });
                };

                const aplicarFiltrosTabla = () => {
                    const queryTexto = inputTexto ? inputTexto.value.trim() : '';
                    const queryBarcode = inputBarcode ? inputBarcode.value.trim() : '';

                    // 1. Si hay código de barras escrito/escaneado, filtrar por código de barras (o código exacto)
                    if (queryBarcode) {
                        const barNorm = queryBarcode.toLowerCase();
                        const porBarra = catalogoArticulos.filter(art =>
                            (art.codigo_barras && String(art.codigo_barras).trim().toLowerCase().includes(barNorm)) ||
                            String(art.numero || art.codigo || '').trim().toLowerCase() === barNorm
                        );
                        renderizarTabla(porBarra);
                        return;
                    }

                    // 2. Si hay búsqueda por texto (grupo de caracteres separados por espacios = AND)
                    if (queryTexto) {
                        const terminos = normalizarTextoBusqueda(queryTexto).split(/\s+/).filter(Boolean);
                        let filtrados = catalogoArticulos;
                        for (const t of terminos) {
                            filtrados = filtrados.filter(art => window.obtenerTextoBusquedaArticulo(art).includes(t));
                        }
                        renderizarTabla(filtrados);
                        return;
                    }

                    // 3. Sin filtros activos: mostrar primero el último artículo configurado en la UP + el seleccionado + artículos con stock
                    const listaInicial = [];
                    const vistos = new Set();

                    if (ultimoArticuloUP) {
                        listaInicial.push(ultimoArticuloUP);
                        vistos.add(String(ultimoArticuloUP.numero));
                    }
                    if (articuloSeleccionado && !vistos.has(String(articuloSeleccionado.numero))) {
                        listaInicial.push(articuloSeleccionado);
                        vistos.add(String(articuloSeleccionado.numero));
                    }
                    for (const art of catalogoArticulos) {
                        const c = String(art.numero || art.codigo || '');
                        if (!vistos.has(c)) {
                            listaInicial.push(art);
                            vistos.add(c);
                        }
                        if (listaInicial.length >= 40) break;
                    }
                    renderizarTabla(listaInicial);
                };

                // Inicializar tabla y estado al abrir el modal
                actualizarEstadoBotonUltimo();
                aplicarFiltrosTabla();

                // Foco inicial en el lector de código de barras (o buscador)
                if (inputBarcode) {
                    setTimeout(() => inputBarcode.focus(), 80);

                    const procesarEscaneoCodigoBarras = (valor) => {
                        const codigo = String(valor || '').trim();
                        if (!codigo) {
                            aplicarFiltrosTabla();
                            return;
                        }
                        const matchExacto = catalogoArticulos.find(art =>
                            (art.codigo_barras && String(art.codigo_barras).trim().toLowerCase() === codigo.toLowerCase()) ||
                            String(art.numero || art.codigo || '').trim().toLowerCase() === codigo.toLowerCase()
                        );
                        if (matchExacto) {
                            if (inputTexto) inputTexto.value = '';
                            seleccionarArticulo(matchExacto);
                        } else {
                            aplicarFiltrosTabla();
                        }
                    };

                    inputBarcode.addEventListener('change', (e) => {
                        procesarEscaneoCodigoBarras(e.target.value);
                    });

                    inputBarcode.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            procesarEscaneoCodigoBarras(inputBarcode.value);
                        }
                    });

                    inputBarcode.addEventListener('input', () => {
                        const val = inputBarcode.value.trim();
                        if (!val) {
                            aplicarFiltrosTabla();
                            return;
                        }
                        // Si coincide exactamente con un código de barras, auto-seleccionar al instante
                        const exacto = catalogoArticulos.find(art =>
                            art.codigo_barras && String(art.codigo_barras).trim() === val
                        );
                        if (exacto) {
                            if (inputTexto) inputTexto.value = '';
                            seleccionarArticulo(exacto);
                        } else {
                            aplicarFiltrosTabla();
                        }
                    });
                }

                // Buscador por texto (por grupo de caracteres)
                if (inputTexto) {
                    inputTexto.addEventListener('input', () => {
                        if (inputBarcode && inputBarcode.value) {
                            inputBarcode.value = '';
                        }
                        aplicarFiltrosTabla();
                    });

                    inputTexto.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            const queryTexto = inputTexto.value.trim();
                            if (!queryTexto) return;
                            const terminos = normalizarTextoBusqueda(queryTexto).split(/\s+/).filter(Boolean);
                            let filtrados = catalogoArticulos;
                            for (const t of terminos) {
                                filtrados = filtrados.filter(art => window.obtenerTextoBusquedaArticulo(art).includes(t));
                            }
                            if (filtrados.length > 0) {
                                seleccionarArticulo(filtrados[0]);
                            }
                        }
                    });
                }

                // Botón de Selección Rápida del último artículo configurado en la UP
                if (btnUltimo && ultimoArticuloUP) {
                    btnUltimo.addEventListener('click', () => {
                        if (inputTexto) inputTexto.value = '';
                        if (inputBarcode) inputBarcode.value = '';
                        seleccionarArticulo(ultimoArticuloUP);
                    });
                }

                if (inputCant) {
                    inputCant.addEventListener('input', () => {
                        if (articuloSeleccionado) {
                            const cantVal = parseFloat(inputCant.value) || 0;
                            divKilos.textContent = `Equivalente en kilos de entrada: ${(cantVal * (articuloSeleccionado.kilos_unidad || 1)).toFixed(2)} kg`;
                        }
                    });
                }
            },
            preConfirm: () => {
                if (!articuloSeleccionado || !articuloSeleccionado.numero) {
                    Swal.showValidationMessage('Debe escanear o seleccionar el artículo que se lleva a tostar.');
                    return false;
                }
                const inputCant = document.getElementById('swal-input-cantidad-tostadero');
                const cant = parseFloat(inputCant?.value);
                if (!cant || isNaN(cant) || cant <= 0) {
                    Swal.showValidationMessage('Ingrese una cantidad válida mayor a 0.');
                    return false;
                }
                return {
                    articulo_numero: articuloSeleccionado.numero,
                    descripcion: articuloSeleccionado.descripcion,
                    codigo_barras: articuloSeleccionado.codigo_barras,
                    cantidad: cant
                };
            }
        }).then((result) => {
            if (result.isConfirmed && result.value) {
                resolve(result.value);
            } else {
                resolve(null);
            }
        });
    });
}

/**
 * Escapa texto plano para insertarlo de forma segura dentro de HTML.
 */
function escaparHtmlPreparado(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Restaura el estado visual habilitado del botón "Carro listo para producir".
 */
function restaurarBotonPreparado(btnCarroPreparado) {
    if (!btnCarroPreparado) return;
    btnCarroPreparado.disabled = false;
    btnCarroPreparado.classList.remove('procesando');
    btnCarroPreparado.textContent = 'Carro listo para producir';
}

/**
 * Extrae el texto numérico directo de una celda sin arrastrar badges/botones hijos.
 */
function extraerValorDirectoCelda(celda) {
    if (!celda) return '';
    return Array.from(celda.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .filter(Boolean)
        .join(' ');
}

/**
 * Inspecciona el DOM del carro y recolecta ingredientes/insumos/mixes en rojo
 * y cualquier condición que indique que el carro aún no está listo para producir.
 */
function recolectarPendientesPreparacionCarro(esExterno, lineaNegocio) {
    const pendientes = [];
    let primerElementoFaltante = null;
    const registrarPrimerElemento = (el) => {
        if (!primerElementoFaltante && el) primerElementoFaltante = el;
    };

    const listaArticulos = document.getElementById('lista-articulos');
    const articulosDOM = listaArticulos ? listaArticulos.querySelectorAll('.articulo-container') : [];
    if (listaArticulos && articulosDOM.length === 0) {
        registrarPrimerElemento(listaArticulos);
        pendientes.push({
            categoria: 'Carro sin artículos',
            nombre: 'No hay artículos cargados en el carro',
            detalle: 'Agregá al menos un artículo antes de iniciar la producción'
        });
    }

    document.querySelectorAll('#lista-articulos .toggle-ingredientes.sin-receta').forEach(btn => {
        const cont = btn.closest('.articulo-container');
        registrarPrimerElemento(cont || btn);
        const codigo = cont?.querySelector('.articulo-codigo')?.textContent?.trim() || '';
        const desc = cont?.querySelector('.articulo-descripcion')?.textContent?.trim() || 'Artículo';
        pendientes.push({
            categoria: 'Sin receta configurada',
            nombre: codigo ? `${codigo} — ${desc}` : desc,
            detalle: 'Falta crear/vincular su receta (botón "Ver" en rojo)'
        });
    });

    document.querySelectorAll('#resumen-ingredientes tr.stock-faltante').forEach(tr => {
        registrarPrimerElemento(tr);
        const celdas = tr.querySelectorAll('td');
        const nombre = celdas[0]?.textContent?.trim() || 'Ingrediente';
        const requerido = celdas[1]?.textContent?.trim() || '';
        const stockActual = extraerValorDirectoCelda(celdas[2]) || '0.00';
        const cajasTexto = celdas[2]?.querySelector('.cajas-cerradas-badge span')?.textContent?.trim() || '';
        const estadoLimpio = (celdas[3]?.textContent || '').replace(/[❌⚠️]/g, '').trim();
        const unidad = celdas[4]?.textContent?.trim() || '';
        const detalleStock = requerido
            ? `${estadoLimpio || 'Stock insuficiente'} (Requerido: ${requerido} ${unidad} · En stock: ${stockActual} ${unidad})`
            : (estadoLimpio || 'Stock insuficiente');
        pendientes.push({
            categoria: 'Ingrediente / Insumo en rojo',
            nombre,
            detalle: cajasTexto ? `${detalleStock} — tenés ${cajasTexto} disponibles para ingresar` : detalleStock
        });
    });

    const seccionMixes = document.getElementById('resumen-mixes');
    if (seccionMixes && getComputedStyle(seccionMixes).display !== 'none') {
        seccionMixes.querySelectorAll('tr.stock-faltante').forEach(tr => {
            registrarPrimerElemento(tr);
            const celdas = tr.querySelectorAll('td');
            const nombre = celdas[0]?.textContent?.trim() || 'Mix compuesto';
            const reqTxt = celdas[1]?.textContent?.trim() || '0';
            const unidad = celdas[2]?.textContent?.trim() || '';
            const stockTxt = celdas[3]?.textContent?.trim() || '0';
            const diff = Math.max(0, (parseFloat(reqTxt) || 0) - (parseFloat(stockTxt) || 0));
            pendientes.push({
                categoria: 'Mix en rojo',
                nombre,
                detalle: `Faltan ${diff.toFixed(2)} ${unidad} (Requerido: ${reqTxt} ${unidad} · En stock: ${stockTxt} ${unidad})`
            });
        });
    }

    const seccionArticulosUp = document.getElementById('resumen-articulos');
    if (seccionArticulosUp && getComputedStyle(seccionArticulosUp).display !== 'none') {
        seccionArticulosUp.querySelectorAll('tr.stock-faltante').forEach(tr => {
            registrarPrimerElemento(tr);
            const celdas = tr.querySelectorAll('td');
            const codigo = celdas[0]?.textContent?.trim() || '';
            const desc = celdas[1]?.textContent?.trim() || 'Insumo UP';
            const estadoLimpio = (celdas[5]?.textContent || '').replace(/[❌⚠️]/g, '').trim() || 'Stock insuficiente';
            pendientes.push({
                categoria: 'Insumo Receta UP en rojo',
                nombre: codigo ? `${codigo} — ${desc}` : desc,
                detalle: estadoLimpio
            });
        });
    }

    if (esExterno && Number(lineaNegocio) !== 4) {
        document.querySelectorAll('#lista-articulos .articulo-vinculado-banner .btn-vincular-articulo').forEach(btn => {
            registrarPrimerElemento(btn.closest('.articulo-vinculado-banner') || btn);
            const codigo = btn.dataset?.articulo || 'Artículo';
            pendientes.push({
                categoria: 'Artículo Puente pendiente',
                nombre: codigo,
                detalle: 'Falta vincular su Artículo Puente (AP)'
            });
        });
    }

    return { pendientes, primerElementoFaltante };
}

/**
 * Muestra un modal de confirmación "¿Estás seguro?" detallando lo que falta cuando
 * el carro tiene ingredientes en rojo o configuraciones pendientes.
 * Devuelve true solo si el operario decide continuar igual.
 */
async function confirmarPreparacionConFaltantes(pendientes, primerElementoFaltante) {
    if (!pendientes || pendientes.length === 0) return true;

    let seguirAdelante = false;
    if (typeof Swal !== 'undefined') {
        const itemsHtml = pendientes.map(p => `
            <li style="margin-bottom:6px;">
                <span style="display:inline-block;font-size:0.78em;font-weight:700;color:#991b1b;background:#fee2e2;padding:1px 6px;border-radius:4px;margin-right:4px;">${escaparHtmlPreparado(p.categoria)}</span>
                <strong>${escaparHtmlPreparado(p.nombre)}</strong>:
                <span style="color:#b91c1c;font-weight:600;">${escaparHtmlPreparado(p.detalle)}</span>
            </li>
        `).join('');

        const warnRes = await Swal.fire({
            title: '⚠️ ¿Estás seguro?',
            html: `
                <div style="text-align:left;font-size:0.94em;line-height:1.45;">
                    <p style="margin-bottom:8px;">El carro <strong>todavía no está listo para producir</strong> porque figuran pendientes los siguientes puntos:</p>
                    <ul style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 14px 10px 24px;margin-bottom:10px;max-height:240px;overflow-y:auto;">
                        ${itemsHtml}
                    </ul>
                    <p style="margin:0;color:#475569;font-size:0.9em;">Podés volver para revisar y cargar lo que falta (por ejemplo con <strong>Ingreso manual</strong>), o elegir <strong>Seguir adelante igual</strong> si querés iniciar la producción con este desajuste.</p>
                </div>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '✅ Seguir adelante igual',
            cancelButtonText: '🔍 Revisar qué falta',
            confirmButtonColor: '#d97706',
            cancelButtonColor: '#2563eb',
            reverseButtons: true,
            focusCancel: true
        });
        seguirAdelante = !!warnRes.isConfirmed;
    } else {
        const resumenTexto = pendientes.map(p => `• [${p.categoria}] ${p.nombre}: ${p.detalle}`).join('\n');
        seguirAdelante = window.confirm(
            `⚠️ ¿Estás seguro? El carro aún no está listo para producir:\n\n${resumenTexto}\n\nAceptar = Seguir adelante igual\nCancelar = Revisar qué falta`
        );
    }

    if (!seguirAdelante && primerElementoFaltante) {
        try {
            // Si la tabla faltante está colapsada en el panel, expandirla antes de scrollear
            const seccionColapsada = primerElementoFaltante.closest('.seccion-resumen.collapsed');
            if (seccionColapsada) {
                seccionColapsada.classList.remove('collapsed');
            }
            primerElementoFaltante.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (_) {}
    }

    return seguirAdelante;
}

// Función para marcar un carro como preparado
export async function marcarCarroPreparado(carroIdParam) {
    const carroId = carroIdParam || document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');

    if (!carroId || carroId === 'null' || carroId === 'undefined') {
        console.error('No hay carro seleccionado (Dual-State)');
        return false;
    }

    const btnCarroPreparado = document.getElementById('carro-preparado');
    if (!btnCarroPreparado) return false;

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

        // Consultar estado y línea de negocio sin dejar que un error de red saltee la validación local de faltantes
        let esExterno = false;
        let lineaNegocio = 4;
        let articuloLlevadoPayload = null;
        try {
            const estadoRes = await fetch(`/api/produccion/carro/${carroId}/estado`);
            if (estadoRes.ok) {
                const estadoCarro = await estadoRes.json();
                esExterno = estadoCarro.tipo_carro === 'externa';
                lineaNegocio = Number(estadoCarro.linea_negocio || 4);
            }
        } catch (errCheck) {
            console.warn('Aviso al verificar línea de negocio del carro:', errCheck);
        }

        const { pendientes, primerElementoFaltante } = recolectarPendientesPreparacionCarro(esExterno, lineaNegocio);
        const confirmarPendientes = await confirmarPreparacionConFaltantes(pendientes, primerElementoFaltante);
        if (!confirmarPendientes) {
            restaurarBotonPreparado(btnCarroPreparado);
            return false;
        }

        if (esExterno && lineaNegocio === 4) {
            try {
                const seleccion = await solicitarArticuloLlevadoTostadero(carroId, colaborador.id);
                if (!seleccion) {
                    // Usuario canceló el modal: restaurar botón y abortar sin error
                    restaurarBotonPreparado(btnCarroPreparado);
                    return false;
                }
                articuloLlevadoPayload = seleccion;
            } catch (errTostadero) {
                console.warn('Aviso al solicitar artículo llevado a tostadero:', errTostadero);
            }
        }

        const bodyPayload = {
            usuarioId: colaborador.id
        };
        if (articuloLlevadoPayload) {
            bodyPayload.articulo_llevado = articuloLlevadoPayload;
        }

        const response = await fetch(`/api/produccion/carro/${carroId}/preparado`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyPayload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Error HTTP ${response.status}`);
        }

        // Mostrar notificación de éxito
        mostrarNotificacion('Carro marcado como preparado exitosamente');

        // ⏱️ Sincronizar automáticamente el avance a Etapa 2 si la medición temporal estaba en preparación (Etapa 1)
        if (window.hudMedicion && window.hudMedicion.modoActivo && window.hudMedicion.etapaActual === 1) {
            console.log('⏱️ Sincronizando avance a Etapa 2 (Producción) desde marcarCarroPreparado...');
            try {
                await window.hudMedicion.avanzarEtapaBackend(2);
            } catch (errMed) {
                console.warn('Aviso al sincronizar avance a Etapa 2:', errMed);
            }
        }

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

        // 4. Actualizar lista de artículos del carro y el informe de ingresos manuales/receta UP
        if (window.mostrarArticulosDelCarro) {
            await window.mostrarArticulosDelCarro();
        }
        if (window.actualizarInformeIngresosManuales) {
            await window.actualizarInformeIngresosManuales();
        }

        console.log('✅ [PREPARADO] Actualización completa de UI finalizada');
        return true;

    } catch (error) {
        console.error('Error al marcar carro como preparado:', error);
        btnCarroPreparado.disabled = false;
        btnCarroPreparado.classList.remove('procesando');
        btnCarroPreparado.textContent = 'Carro listo para producir';
        mostrarNotificacion(`Error: ${error.message}`, true);
        return false;
    }
}

// Función para revertir la preparación de un carro
export async function revertirCarroPreparado(carroIdParam) {
    const carroId = carroIdParam || document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');

    if (!carroId || carroId === 'null' || carroId === 'undefined') {
        console.error('No hay carro seleccionado (Dual-State)');
        return;
    }

    // Confirmación del usuario
    if (!confirm('¿Estás seguro de que deseas revertir este carro a estado de edición?\n\nLos insumos descontados serán devueltos temporalmente al inventario.')) {
        return;
    }

    const btnRevertir = document.getElementById('revertir-preparado');
    if (btnRevertir) {
        btnRevertir.disabled = true;
        btnRevertir.classList.add('procesando');
        btnRevertir.textContent = 'Revirtiendo...';
    }

    try {
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;

        if (!colaborador) {
            throw new Error('No hay colaborador activo');
        }

        const response = await fetch(`/api/produccion/carro/${carroId}/revertir-preparado`, {
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

        mostrarNotificacion('Preparación revertida exitosamente. El carro vuelve a estar en edición.', false);

        // Actualizar UI y paneles de resumen
        await actualizarVisibilidadBotones();
        
        if (window.obtenerResumenIngredientesCarro && window.mostrarResumenIngredientes) {
            const ingredientes = await window.obtenerResumenIngredientesCarro(carroId, colaborador.id);
            await window.mostrarResumenIngredientes(ingredientes);
            console.log('✅ [REVERSIÓN] Resumen de ingredientes actualizado');
        }

        if (window.obtenerResumenMixesCarro && window.mostrarResumenMixes) {
            const mixes = await window.obtenerResumenMixesCarro(carroId, colaborador.id);
            window.mostrarResumenMixes(mixes);
            console.log('✅ [REVERSIÓN] Resumen de mixes actualizado');
        }

        if (window.obtenerResumenArticulosCarro && window.mostrarResumenArticulos) {
            const articulos = await window.obtenerResumenArticulosCarro(carroId, colaborador.id);
            if (articulos && articulos.length > 0) {
                window.mostrarResumenArticulos(articulos);
                const seccionArticulos = document.getElementById('resumen-articulos');
                if (seccionArticulos) {
                    seccionArticulos.style.display = 'block';
                }
                console.log('✅ [REVERSIÓN] Resumen de artículos externos actualizado');
            }
        }

        // Disparar evento personalizado para que carro.js actualice la vista (artículos e ingresos manuales)
        const event = new CustomEvent('carroEstadoCambiado', { detail: { carroId } });
        document.dispatchEvent(event);

    } catch (error) {
        console.error('Error al revertir la preparación del carro:', error);
        mostrarNotificacion(`Error: ${error.message}`, true);
    } finally {
        if (btnRevertir) {
            btnRevertir.disabled = false;
            btnRevertir.classList.remove('procesando');
            btnRevertir.innerHTML = '<i class="fas fa-undo"></i>';
        }
    }
}

// Función para finalizar la producción de un carro
export async function finalizarProduccion(carroIdParam) {
    const carroId = carroIdParam || document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');

    if (!carroId || carroId === 'null' || carroId === 'undefined') {
        console.error('No hay carro seleccionado (Dual-State)');
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

        // 🌐 PRE-CÁLCULO Y CONFIRMACIÓN DE LIQUIDACIÓN PARA CARRO EXTERNO
        let totalCrudoVal = null;
        if (tipoCarro === 'externa') {
            let relacion = null;
            let tarifa = null;
            let creditoCalculado = 0;
            
            // Leer valores de merma del DOM
            const txtCrudo = document.getElementById('total-crudo')?.textContent || '0.00 kg';
            const txtDiferencia = document.getElementById('diferencia-peso')?.textContent || '0.00 kg';
            const txtPorcentaje = document.getElementById('porcentaje-reduccion')?.textContent || '0.00%';
            totalCrudoVal = parseFloat(txtCrudo.replace(' kg', '')) || 0;
            
            // Calcular suma de ingredientes vinculados agregados en caliente (únicamente post-cocción)
            let sumaVinculadosVal = 0;
            const filasVinculadas = document.querySelectorAll('.ingrediente-vinculado');
            filasVinculadas.forEach(fila => {
                if (fila.dataset.esPostCoccion === 'true') {
                    const baseKilo = parseFloat(fila.dataset.baseKilo) || 0;
                    sumaVinculadosVal += baseKilo * kilosProducidos;
                }
            });
            sumaVinculadosVal = Number(sumaVinculadosVal.toFixed(3));
            
            try {
                // 1. Consultar relaciones de artículos del carro para saber el SKU de salida
                const relRes = await fetch(`/api/produccion/carro/${carroId}/relaciones-articulos?usuarioId=${colaborador.id}`);
                if (relRes.ok) {
                    const rels = await relRes.json();
                    if (rels && rels.length > 0) {
                        relacion = rels[0];
                    }
                }
                
                // 2. Si hay relación, buscar tarifa de rendimiento activa (mismo origen primero, fallback puerto 3005)
                if (relacion && relacion.articulo_kilo_codigo) {
                    const skuEncoded = encodeURIComponent(relacion.articulo_kilo_codigo);
                    let tarRes = await fetch(`/api/produccion/colaboradores/tarifa-rendimiento?colaborador_id=${colaborador.id}&sku=${skuEncoded}`).catch(() => null);
                    if (!tarRes || !tarRes.ok) {
                        const host = window.location.hostname || 'localhost';
                        tarRes = await fetch(`http://${host}:3005/api/logistica/bunker/colaboradores/tarifa-rendimiento?colaborador_id=${colaborador.id}&sku=${skuEncoded}`).catch(() => null);
                    }
                    if (tarRes && tarRes.ok) {
                        const tarData = await tarRes.json();
                        if (tarData && tarData.success && tarData.data) {
                            tarifa = tarData.data;
                        }
                    }
                }
            } catch (err) {
                console.warn('No se pudo pre-consultar tarifas para confirmación:', err);
            }
            
            let htmlConfirm = '';
            let confirmBtnColor = '#10b981';
            let iconType = 'question';

            const ldnMeta = window.carroActivoMetadata || {};
            const ldnNum = ldnMeta.linea_negocio || 4;
            const ldnNombre = ldnMeta.nombre_linea_negocio || `Línea de Negocio ${ldnNum}`;
            const ldnIcono = ldnMeta.icono_linea_negocio || (ldnNum === 4 ? '🔥' : ldnNum === 5 ? '🍫' : '🥣');
            const ldnSubtitulo = ldnMeta.subtitulo_linea_negocio || (ldnNum === 4 ? 'Tostadero (UP Externa Simple)' : ldnNum === 5 ? 'Barritas (Mezcla Interna + UP Externa)' : 'Granolas (Doble Mezcla / UP Externa)');
            
            const ldnBadgeModal = `
                <div style="display: flex; align-items: center; justify-content: space-between; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 1.3em;">${ldnIcono}</span>
                        <div>
                            <div style="font-weight: bold; color: #1e293b; font-size: 0.9em;">${ldnNombre}</div>
                            <div style="font-size: 0.75em; color: #64748b;">${ldnSubtitulo}</div>
                        </div>
                    </div>
                    <span style="background: #e2e8f0; color: #334155; font-size: 0.72em; font-weight: 800; padding: 2px 7px; border-radius: 9999px;">FLUJO ${ldnNum}</span>
                </div>
            `;
            
            if (tarifa && relacion) {
                let v_cantidad = kilosProducidos;
                let calculoTexto = '';
                
                if (tarifa.unidad_medida === 'un') {
                    const unidadesInput = document.getElementById('unidades-producidas');
                    if (unidadesInput && !isNaN(parseFloat(unidadesInput.value))) {
                        v_cantidad = parseFloat(unidadesInput.value);
                    } else {
                        v_cantidad = kilosProducidos * 20; // fallback standard
                    }
                    creditoCalculado = Number((v_cantidad * parseFloat(tarifa.valor_por_unidad)).toFixed(2));
                    calculoTexto = `Cálculo: ${v_cantidad.toLocaleString('es-AR')} un × $ ${parseFloat(tarifa.valor_por_unidad).toLocaleString('es-AR')}/un`;
                } else {
                    v_cantidad = kilosProducidos + sumaVinculadosVal;
                    creditoCalculado = Number((v_cantidad * parseFloat(tarifa.valor_por_unidad)).toFixed(2));
                    calculoTexto = `Cálculo: (${kilosProducidos.toLocaleString('es-AR')} kg cocido + ${sumaVinculadosVal.toLocaleString('es-AR')} kg agregados) × $ ${parseFloat(tarifa.valor_por_unidad).toLocaleString('es-AR')}/kg`;
                }

                htmlConfirm = `
                    <div style="text-align: left; font-size: 0.95em; line-height: 1.5;">
                        ${ldnBadgeModal}
                        <p style="margin: 4px 0;"><strong>Colaborador:</strong> ${colaborador.nombre_completo || 'Matías'}</p>
                        <p style="margin: 4px 0;"><strong>Artículo:</strong> ${relacion.articulo_kilo_nombre || relacion.articulo_kilo_codigo} (${relacion.articulo_kilo_codigo})</p>
                        
                        <h4 style="margin-top: 15px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 3px; font-size: 1.05em; color: #1e293b; font-weight: bold;">⚖️ Rendimiento y Merma Física</h4>
                        <table style="width: 100%; font-size: 0.9em; margin-bottom: 15px; border-collapse: collapse;">
                            <tr><td style="color:#64748b; padding: 4px 0;">Mezcla Cruda (Entrada):</td><td style="text-align: right; font-weight: bold;">${txtCrudo}</td></tr>
                            <tr><td style="color:#64748b; padding: 4px 0;">Salida de Cocción (Tostado):</td><td style="text-align: right; font-weight: bold; color: #2563eb;">${kilosProducidos.toFixed(2)} kg</td></tr>
                            <tr><td style="color:#64748b; padding: 4px 0;">Ingredientes Vinculados Agregados:</td><td style="text-align: right; font-weight: bold; color: #16a34a;">+ ${sumaVinculadosVal.toFixed(3)} kg</td></tr>
                            <tr><td style="color:#64748b; padding: 4px 0;">Diferencia de Peso Cocción:</td><td style="text-align: right; font-weight: bold; color: #dc2626;">${txtDiferencia}</td></tr>
                            <tr><td style="color:#64748b; padding: 4px 0;">Reducción por Cocción:</td><td style="text-align: right; font-weight: bold; color: #b45309;">${txtPorcentaje}</td></tr>
                        </table>
 
                        <h4 style="border-bottom: 1px dashed #cbd5e1; padding-bottom: 3px; font-size: 1.05em; color: #1e293b; font-weight: bold;">💰 Liquidación (Cuenta Corriente)</h4>
                        <div style="background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; text-align: center; margin-top: 5px;">
                            <span style="font-size: 0.85em; color: #64748b; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Monto a Acreditar</span>
                            <div style="font-size: 1.8em; font-weight: bold; color: #15803d; margin-top: 4px;">
                                $ ${creditoCalculado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ARS
                            </div>
                            <div style="font-size: 0.85em; color: #475569; margin-top: 4px; font-weight: 500;">
                                ${calculoTexto}
                            </div>
                        </div>
                        <p style="margin-top: 12px; font-size: 0.85em; color: #64748b; text-align: center; font-style: italic;">
                            Se generará una orden de pago automática en su cuenta corriente.
                        </p>
                    </div>
                `;
            } else {
                iconType = 'warning';
                confirmBtnColor = '#f59e0b';
                htmlConfirm = `
                    <div style="text-align: left; font-size: 0.95em; line-height: 1.5;">
                        ${ldnBadgeModal}
                        <p style="margin: 4px 0;"><strong>Colaborador:</strong> ${colaborador.nombre_completo || 'Matías'}</p>
                        <p style="margin: 4px 0;"><strong>Rendimiento Neto:</strong> ${kilosProducidos} kg</p>
                        
                        <h4 style="margin-top: 15px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 3px; font-size: 1.05em; color: #1e293b; font-weight: bold;">⚖️ Rendimiento y Merma Física</h4>
                        <table style="width: 100%; font-size: 0.9em; margin-bottom: 15px; border-collapse: collapse;">
                            <tr><td style="color:#64748b; padding: 4px 0;">Mezcla Cruda (Entrada):</td><td style="text-align: right; font-weight: bold;">${txtCrudo}</td></tr>
                            <tr><td style="color:#64748b; padding: 4px 0;">Salida de Cocción (Tostado):</td><td style="text-align: right; font-weight: bold; color: #2563eb;">${kilosProducidos.toFixed(2)} kg</td></tr>
                            <tr><td style="color:#64748b; padding: 4px 0;">Ingredientes Vinculados Agregados:</td><td style="text-align: right; font-weight: bold; color: #16a34a;">+ ${sumaVinculadosVal.toFixed(3)} kg</td></tr>
                            <tr><td style="color:#64748b; padding: 4px 0;">Diferencia de Peso Cocción:</td><td style="text-align: right; font-weight: bold; color: #dc2626;">${txtDiferencia}</td></tr>
                            <tr><td style="color:#64748b; padding: 4px 0;">Reducción por Cocción:</td><td style="text-align: right; font-weight: bold; color: #b45309;">${txtPorcentaje}</td></tr>
                        </table>
                        
                        <div style="margin-top: 12px; background: #fffbeb; padding: 12px; border-radius: 6px; border: 1px solid #fef3c7; color: #b45309; font-size: 0.85em;">
                            ⚠️ <strong>Aviso:</strong> No se encontró tarifa de rendimiento activa para este artículo. La producción se asentará <strong>sin liquidación</strong> de pago en cuenta corriente.
                        </div>
                    </div>
                `;
            }
            
            const confirmResult = await Swal.fire({
                title: tarifa ? '¿Confirmar liquidación y producción?' : '¿Confirmar producción?',
                html: htmlConfirm,
                icon: iconType,
                showCancelButton: true,
                confirmButtonText: tarifa ? '💾 Sí, asentar y liquidar' : '💾 Sí, asentar igualmente',
                cancelButtonText: '❌ Cancelar y modificar',
                confirmButtonColor: confirmBtnColor,
                cancelButtonColor: '#64748b',
                allowOutsideClick: false
            });
            
            if (!confirmResult.isConfirmed) {
                btnFinalizarProduccion.disabled = false;
                btnFinalizarProduccion.classList.remove('procesando');
                btnFinalizarProduccion.textContent = 'Asentar producción';
                return;
            }
        } else {
            const confirmResult = await Swal.fire({
                title: '¿Asentar producción?',
                text: 'Se registrarán los movimientos de stock central correspondientes.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Sí, asentar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#3b82f6',
                cancelButtonColor: '#64748b'
            });
            
            if (!confirmResult.isConfirmed) {
                btnFinalizarProduccion.disabled = false;
                btnFinalizarProduccion.classList.remove('procesando');
                btnFinalizarProduccion.textContent = 'Asentar producción';
                return;
            }
        }

        const unidadesInput = document.getElementById('unidades-producidas');
        const unidadesVal = (unidadesInput && !isNaN(parseFloat(unidadesInput.value))) ? parseFloat(unidadesInput.value) : undefined;

        console.log(`🔍 Enviando al backend - Tipo: ${tipoCarro}, Kilos: ${kilosProducidos}, Unidades: ${unidadesVal}, Entrada: ${totalCrudoVal}`);

        const response = await fetch(`/api/produccion/carro/${carroId}/finalizar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuarioId: colaborador.id,
                kilos_producidos: kilosProducidos,
                unidades_producidas: unidadesVal,
                kilos_entrada: totalCrudoVal
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const msg = errorData.detalle ? `${errorData.error}: ${errorData.detalle}` : (errorData.error || `Error HTTP ${response.status}`);
            throw new Error(msg);
        }

        // Mostrar notificación de éxito
                // Mostrar notificación de éxito
        mostrarNotificacion('Producción finalizada exitosamente');

        // ⏱️ Sincronizar automáticamente el avance a Etapa 3 si la medición estaba en producción (Etapa 2)
        if (window.hudMedicion && window.hudMedicion.modoActivo && window.hudMedicion.etapaActual === 2) {
            console.log('⏱️ Sincronizando avance a Etapa 3 (Etiquetado y Guardado) desde finalizarProduccion...');
            try {
                await window.hudMedicion.avanzarEtapaBackend(3);
            } catch (errMed) {
                console.warn('Aviso al sincronizar avance a Etapa 3:', errMed);
            }
        }

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

        if (window.mostrarArticulosDelCarro) {
            await window.mostrarArticulosDelCarro();
        }
        if (window.actualizarInformeIngresosManuales) {
            await window.actualizarInformeIngresosManuales();
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
export async function imprimirEtiquetasCarro(carroIdParam) {
    const carroId = carroIdParam || document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');

    if (!carroId || carroId === 'null' || carroId === 'undefined') {
        console.error('No hay carro seleccionado (Dual-State)');
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
            const payloadArt = {
                articulo: {
                    numero: articulo.articulo_numero,
                    nombre: articulo.descripcion,
                    codigo_barras: articulo.codigo_barras
                },
                cantidad: articulo.cantidad
            };
            let imprimirResponse = await fetch('/api/produccion/articulos/imprimir-etiqueta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadArt)
            }).catch(() => null);

            if (!imprimirResponse || !imprimirResponse.ok) {
                imprimirResponse = await fetch('http://localhost:3000/api/imprimir', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payloadArt)
                });
            }

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
async function calcularMermaProduccion(carroId, mostrarPreviaCrudo = false) {
    console.log('🚀 [MERMA] ========================================');
    console.log('🚀 [MERMA] FUNCIÓN calcularMermaProduccion INICIADA');
    console.log('🚀 [MERMA] Carro ID:', carroId, 'Previa:', mostrarPreviaCrudo);
    console.log('🚀 [MERMA] ========================================');

    try {
        // PASO 1: Verificar elementos del DOM
        const inputKilos = document.getElementById('kilos-producidos');
        const calculoMerma = document.getElementById('calculo-merma');

        if (!inputKilos || !calculoMerma) {
            return;
        }

        // PASO 2: Obtener valor del input
        const valorInput = inputKilos.value.replace(',', '.');
        const kilosProducidos = parseFloat(valorInput);
        const tieneKilosValidos = !isNaN(kilosProducidos) && kilosProducidos > 0;

        // Si no hay valor válido y no estamos mostrando la previa en crudo, ocultar el cálculo
        if (!tieneKilosValidos && !mostrarPreviaCrudo) {
            calculoMerma.style.display = 'none';
            return;
        }

        console.log('✅ [MERMA-PASO-2] Continuando (tieneKilosValidos:', tieneKilosValidos, ')...');

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
        console.log('🔍 [MERMA-PASO-4] Obteniendo peso artículo base mediante API articulos-resumen...');
        let pesoArticuloBase = 0;

        try {
            // 🎯 ESTRATEGIA PRINCIPAL: Consultar /api/produccion/carro/${carroId}/articulos-resumen directamente
            const resumenResponse = await fetch(`/api/produccion/carro/${carroId}/articulos-resumen?usuarioId=${colaborador.id}`);
            if (resumenResponse.ok) {
                const insumos = await resumenResponse.json();
                console.log(`✅ [MERMA-PASO-4] Insumos de receta obtenidos: ${insumos.length}`, insumos);
                for (const ins of insumos) {
                    const kTotales = parseFloat(ins.kilos_totales) || (parseFloat(ins.cantidad_total || 0) * (parseFloat(ins.kilos_unidad) || 1));
                    pesoArticuloBase += kTotales;
                    console.log(`   - Insumo ${ins.articulo_numero} (${ins.nombre}): ${kTotales} kg`);
                }
            } else {
                console.warn(`⚠️ [MERMA-PASO-4] Falló articulos-resumen (${resumenResponse.status}), intentando fallback`);
            }

            // Fallback si pesoArticuloBase sigue en 0: consultar stock_real_consolidado de la tabla del DOM
            if (pesoArticuloBase <= 0) {
                const tablaArticulos = document.querySelector('#resumen-articulos table tbody');
                if (tablaArticulos) {
                    const filas = tablaArticulos.querySelectorAll('tr');
                    console.log('🔍 [MERMA-PASO-4 Fallback] Artículos en tabla:', filas.length);
                    for (const fila of filas) {
                        const celdas = fila.querySelectorAll('td');
                        if (celdas.length >= 1) {
                            const codigo = celdas[0]?.textContent.trim();
                            const codigoCodificado = encodeURIComponent(codigo);
                            const stockResponse = await fetch(`/api/produccion/stock/${codigoCodificado}`);
                            if (stockResponse.ok) {
                                const stockData = await stockResponse.json();
                                const kilosUnidad = parseFloat(stockData.kilos_unidad || 0);
                                pesoArticuloBase += kilosUnidad;
                            }
                        }
                    }
                }
            }

            console.log(`✅ [MERMA-PASO-4] Peso total insumos base: ${pesoArticuloBase} kg`);
        } catch (error) {
            console.error('❌ [MERMA-PASO-4] ERROR:', error);
            console.error('❌ [MERMA-PASO-4] Stack:', error.stack);
        }

        // PASO 5: Obtener peso de ingredientes
        console.log('🔍 [MERMA-PASO-5] Obteniendo ingredientes personales...');
        let pesoIngredientes = 0;

        try {
            const urlIngredientes = `/api/produccion/carro/${carroId}/ingredientes?usuarioId=${colaborador.id}`;
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
        const totalCrudo = pesoArticuloBase + pesoIngredientes;
        const diferenciaPeso = tieneKilosValidos ? (kilosProducidos - totalCrudo) : 0;
        const porcentajeReduccion = (tieneKilosValidos && totalCrudo > 0) ? (Math.abs(diferenciaPeso) / totalCrudo) * 100 : 0;

        // PASO 7: Actualizar UI (SIEMPRE)
        document.getElementById('total-crudo').textContent = `${totalCrudo.toFixed(2)} kg`;
        document.getElementById('kilos-final').textContent = tieneKilosValidos ? `${kilosProducidos.toFixed(2)} kg` : 'Pendiente (ingrese kilos o barritas)';

        const spanDiferencia = document.getElementById('diferencia-peso');
        if (tieneKilosValidos) {
            spanDiferencia.textContent = `${diferenciaPeso.toFixed(2)} kg`;
            spanDiferencia.style.color = diferenciaPeso < 0 ? '#dc3545' : '#28a745';
        } else {
            spanDiferencia.textContent = '-';
            spanDiferencia.style.color = '#6c757d';
        }

        const spanPorcentaje = document.getElementById('porcentaje-reduccion');
        if (tieneKilosValidos) {
            spanPorcentaje.textContent = `${porcentajeReduccion.toFixed(2)}%`;
            spanPorcentaje.style.color = porcentajeReduccion > 15 ? '#dc3545' : porcentajeReduccion > 10 ? '#ffc107' : '#28a745';
        } else {
            spanPorcentaje.textContent = '-';
            spanPorcentaje.style.color = '#6c757d';
        }

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
window.revertirCarroPreparado = revertirCarroPreparado;

// Función para imprimir etiquetas con Lote del carro
export async function imprimirEtiquetasCarroConLote(carroIdParam) {
    const carroId = carroIdParam || document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');

    if (!carroId || carroId === 'null' || carroId === 'undefined') {
        console.error('No hay carro seleccionado (Dual-State)');
        return;
    }

    const btnImprimirEtiquetasLote = document.getElementById('imprimir-etiquetas-lote');
    if (!btnImprimirEtiquetasLote) return;

    try {
        // Deshabilitar el botón y mostrar estado de procesamiento
        btnImprimirEtiquetasLote.disabled = true;
        btnImprimirEtiquetasLote.classList.add('procesando');
        btnImprimirEtiquetasLote.textContent = 'Imprimiendo...';

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

        const checkFechasLote = document.getElementById('check-fechas-lote');
        const incluirFechas = checkFechasLote ? checkFechasLote.checked : false;
        
        let fechasPayload = null;
        if (incluirFechas) {
            // Calcular fechas (Elaboración: hoy, Vencimiento: hoy + 8 meses)
            const d = new Date();
            const dia = String(d.getDate()).padStart(2, '0');
            const mes = String(d.getMonth() + 1).padStart(2, '0');
            const año = d.getFullYear();
            const elaboracion = `${dia}/${mes}/${año}`;
            
            const v = new Date();
            v.setMonth(v.getMonth() + 8);
            const diaV = String(v.getDate()).padStart(2, '0');
            const mesV = String(v.getMonth() + 1).padStart(2, '0');
            const añoV = v.getFullYear();
            const vencimiento = `${diaV}/${mesV}/${añoV}`;
            
            fechasPayload = {
                elaboracion: elaboracion,
                vencimiento: vencimiento
            };
            console.log('📅 Fechas calculadas para impresión con lote:', fechasPayload);
        }

        // Imprimir etiquetas para cada artículo según su cantidad con lote
        for (const articulo of articulos) {
            const payloadLote = {
                articulo: {
                    numero: articulo.articulo_numero,
                    nombre: articulo.descripcion,
                    codigo_barras: articulo.codigo_barras
                },
                cantidad: articulo.cantidad,
                lote: `L-${carroId}`,
                fechas: fechasPayload
            };
            let imprimirResponse = await fetch('/api/produccion/articulos/imprimir-etiqueta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadLote)
            }).catch(() => null);

            if (!imprimirResponse || !imprimirResponse.ok) {
                imprimirResponse = await fetch('http://localhost:3000/api/imprimir', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payloadLote)
                });
            }

            if (!imprimirResponse.ok) {
                throw new Error(`Error al imprimir etiqueta para ${articulo.descripcion}`);
            }
        }

        // Mostrar notificación de éxito
        mostrarNotificacion('Etiquetas impresas con lote correctamente');

    } catch (error) {
        console.error('Error al imprimir etiquetas con lote:', error);
        mostrarNotificacion(`Error: ${error.message}`, true);
    } finally {
        // Restaurar el botón
        if (btnImprimirEtiquetasLote) {
            btnImprimirEtiquetasLote.disabled = false;
            btnImprimirEtiquetasLote.classList.remove('procesando');
            btnImprimirEtiquetasLote.textContent = 'Imprimir con lote';
        }
    }
}

window.imprimirEtiquetasCarroConLote = imprimirEtiquetasCarroConLote;

/**
 * Imprime la etiqueta del Artículo Puente (ej: APTSPGXKPM) vinculado al carro de producción externa.
 */
export async function imprimirEtiquetaArticuloPuente(codigo, nombre, codigoBarras, carroIdParam) {
    try {
        const carroId = carroIdParam || document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
        let cod = String(codigo || '').trim();
        let nom = String(nombre || '').trim();
        let bar = String(codigoBarras || '').trim();

        if (!cod) {
            mostrarNotificacion('No se encontró el código del Artículo Puente', true);
            return;
        }

        // Si falta el código de barras o el nombre, consultarlo en el catálogo de artículos
        if (!bar || !nom) {
            try {
                const resCat = await fetch('/api/produccion/articulos');
                if (resCat.ok) {
                    const dataCat = await resCat.json();
                    const lista = Array.isArray(dataCat) ? dataCat : (dataCat.data || dataCat.articulos || []);
                    const match = lista.find(a => String(a.codigo || a.numero || a.articulo_numero || '').trim() === cod);
                    if (match) {
                        bar = bar || match.codigo_barras || cod;
                        nom = nom || match.descripcion || match.nombre || cod;
                    }
                }
            } catch (e) {
                console.warn('No se pudo completar datos del Artículo Puente desde catálogo:', e);
            }
        }
        if (!bar) bar = cod;
        if (!nom) nom = cod;

        let cantidadImprimir = 1;
        let incluirLote = !!carroId;
        let incluirFechas = false;

        if (typeof Swal !== 'undefined') {
            const result = await Swal.fire({
                title: '🏷️ Imprimir Etiqueta — Artículo Puente',
                width: '480px',
                html: `
                    <div style="text-align:left; font-family:inherit;">
                        <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px 12px; margin-bottom:14px;">
                            <div style="font-size:11.5px; font-weight:800; color:#1e40af; text-transform:uppercase;">🔗 Artículo Puente (Stock de Ventas)</div>
                            <div style="font-size:15px; font-weight:700; color:#0f172a; margin-top:3px;">[${cod}] ${nom}</div>
                            <div style="font-size:12px; color:#475569; margin-top:2px;">Código de barras: <strong>${bar}</strong></div>
                        </div>

                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px;">
                            <label for="swal-cant-etiquetas-puente" style="font-weight:700; font-size:13.5px; color:#0f172a;">
                                🔢 Cantidad de etiquetas:
                            </label>
                            <input id="swal-cant-etiquetas-puente"
                                   type="number"
                                   min="1"
                                   step="1"
                                   value="1"
                                   style="width:90px; padding:6px 10px; border:1.5px solid #94a3b8; border-radius:6px; font-size:15px; font-weight:700; text-align:center;" />
                        </div>

                        ${carroId ? `
                            <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:#1e293b; cursor:pointer; margin-bottom:8px;">
                                <input type="checkbox" id="swal-check-lote-puente" checked style="width:16px; height:16px; cursor:pointer;" />
                                <span>Incluir número de lote (<strong>L-${carroId}</strong>)</span>
                            </label>
                        ` : ''}

                        <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:#1e293b; cursor:pointer;">
                            <input type="checkbox" id="swal-check-fechas-puente" style="width:16px; height:16px; cursor:pointer;" />
                            <span>Incluir fecha de elaboración y vencimiento (+8 meses)</span>
                        </label>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: '🖨️ Imprimir Etiqueta',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#16a34a',
                cancelButtonColor: '#64748b',
                preConfirm: () => {
                    const cant = parseInt(document.getElementById('swal-cant-etiquetas-puente')?.value, 10);
                    if (!cant || isNaN(cant) || cant < 1) {
                        Swal.showValidationMessage('Ingrese una cantidad válida (mínimo 1).');
                        return false;
                    }
                    const chkLote = document.getElementById('swal-check-lote-puente');
                    const chkFechas = document.getElementById('swal-check-fechas-puente');
                    return {
                        cantidad: cant,
                        lote: chkLote ? chkLote.checked : false,
                        fechas: chkFechas ? chkFechas.checked : false
                    };
                }
            });

            if (!result.isConfirmed || !result.value) return;
            cantidadImprimir = result.value.cantidad;
            incluirLote = result.value.lote;
            incluirFechas = result.value.fechas;
        }

        let fechasPayload = null;
        if (incluirFechas) {
            const d = new Date();
            const elaboracion = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            const v = new Date();
            v.setMonth(v.getMonth() + 8);
            const vencimiento = `${String(v.getDate()).padStart(2, '0')}/${String(v.getMonth() + 1).padStart(2, '0')}/${v.getFullYear()}`;
            fechasPayload = { elaboracion, vencimiento };
        }

        const payload = {
            articulo: {
                numero: cod,
                nombre: nom,
                codigo_barras: bar
            },
            cantidad: cantidadImprimir
        };

        if (incluirLote && carroId) {
            payload.lote = `L-${carroId}`;
            if (fechasPayload) payload.fechas = fechasPayload;
        }

        let imprimirResponse = await fetch('/api/produccion/articulos/imprimir-etiqueta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => null);

        if (!imprimirResponse || !imprimirResponse.ok) {
            imprimirResponse = await fetch('http://localhost:3000/api/imprimir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (!imprimirResponse.ok) {
            throw new Error(`Error al enviar etiqueta de ${cod} al servidor de impresión`);
        }

        mostrarNotificacion(`Etiqueta de ${cod} enviada a imprimir correctamente`);
    } catch (error) {
        console.error('Error al imprimir etiqueta del Artículo Puente:', error);
        mostrarNotificacion(`Error al imprimir etiqueta: ${error.message}`, true);
    }
}

window.imprimirEtiquetaArticuloPuente = imprimirEtiquetaArticuloPuente;
