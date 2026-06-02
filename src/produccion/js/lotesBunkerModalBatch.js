/**
 * Lógica Frontend Premium para Vinculación Múltiple (Batch) y Buscador LAMDA
 */

const BunkerModalBatch = {
    lotesDraft: [],
    _searchTimeouts: {},
    _latestSearchTokens: {},

    abrir(lotes) {
        this.lotesDraft = lotes.map(lote => {
            const item = lote.pedidos_b2b_items || {};
            const bult = parseFloat(item.cant_bult) || 1;
            const val = parseFloat(item.cant_valor) || 1;
            const vu = parseFloat(item.valor_unitario_ref) || 0;
            const cantRecibida = parseFloat(lote.cantidad_recibida) || 1;
            
            const kilosPorBultoFisico = bult * val;
            const costOriginal = vu * kilosPorBultoFisico * cantRecibida;
            const totalKilos = cantRecibida * kilosPorBultoFisico;
            
            const uniqueLoteTempId = 'lote_' + Math.random().toString(36).substr(2, 9);
            const defaultDestIdTemp = 'dest_' + Math.random().toString(36).substr(2, 9);

            return {
                idTemp: uniqueLoteTempId,
                loteRaw: lote,
                lote_id_supabase: lote.id,
                sku: item.producto_codigo || '',
                producto_descripcion: item.producto_descripcion || 'Sin descripción',
                cantidad_recibida: cantRecibida,
                kilosPorBulto: kilosPorBultoFisico || 1,
                costo_bruto_ingresado: costOriginal,
                cantidad_total_lote: totalKilos,
                iva: item.iva_porcentaje || 21,
                destinos: [
                    {
                        idTemp: defaultDestIdTemp,
                        tipo_destino: 'INGREDIENTE_PRODUCCION', // Por defecto "Ingredientes"
                        id: '',
                        descripcion: '',
                        cantidad_asignada: cantRecibida, // Por defecto asigna todo el lote
                        kilos_asignados: totalKilos
                    }
                ]
            };
        });

        document.getElementById('bmb-validacion-manual').checked = false;
        this.renderLotesBatch();
        
        // Trigger de búsqueda vacía inicial para todos los destinos cargados
        this.lotesDraft.forEach(l => {
            l.destinos.forEach(d => {
                this.buscarDestinoRemotoBatch('', l.idTemp, d.idTemp);
            });
        });

        this.verificarBotonGuardar();
        document.getElementById('modal-bunker-batch').classList.add('show');
    },

    cerrar() {
        document.getElementById('modal-bunker-batch').classList.remove('show');
    },

    renderLotesBatch() {
        const container = document.getElementById('bmb-lotes-container');
        container.innerHTML = '';

        let hasAnyInconsistency = false;

        this.lotesDraft.forEach((lote, index) => {
            const idCorto = (lote.lote_id_supabase || '').substring(0, 8).toUpperCase();
            
            // Verificar si este lote es inconsistente
            const bult = parseFloat(lote.loteRaw.pedidos_b2b_items?.cant_bult) || 1;
            const val = parseFloat(lote.loteRaw.pedidos_b2b_items?.cant_valor) || 1;
            const vu = parseFloat(lote.loteRaw.pedidos_b2b_items?.valor_unitario_ref) || 0;
            const isInconsistent = (bult === 1 && val === 1 && lote.loteRaw.pedidos_b2b_items?.unidad_ref === 'Kilogramo' && vu > 1000);
            
            if (isInconsistent) {
                hasAnyInconsistency = true;
            }

            const card = document.createElement('div');
            card.className = 'lote-card-batch';
            card.style.cssText = 'background: white; border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; gap: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.02);';
            
            // Layout de 2 columnas para el lote (Datos Costeo vs Destinos)
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="background: #1e293b; color: white; padding: 4px 10px; border-radius: 4px; font-family: monospace; font-weight: bold; font-size: 13px;">${idCorto}</span>
                        <span style="font-weight: bold; color: #334155; font-size: 14px;">${lote.sku} - ${lote.producto_descripcion}</span>
                        ${isInconsistent ? '<span style="background-color: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">⚠️ Inconsistente (1x1)</span>' : ''}
                    </div>
                    <button onclick="BunkerModalBatch.removerLote('${lote.idTemp}')" style="background: none; border: none; color: #ef4444; font-weight: bold; cursor: pointer; font-size: 13px;">❌ Quitar</button>
                </div>
                
                <div style="display: grid; grid-template-columns: 2fr 3fr; gap: 20px;">
                    <!-- Columna Izquierda: Costeo -->
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 10px;">
                        <div style="display: flex; gap: 10px; justify-content: space-between; font-size: 12px; color: #475569;">
                            <span><b>Bultos:</b> ${lote.cantidad_recibida} cj</span>
                            <span><b>Equiv:</b> ${lote.kilosPorBulto} kg/cj</span>
                        </div>
                        
                        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <label style="font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase;">Costo Bruto ($)</label>
                                <input type="number" id="costo-${lote.idTemp}" value="${lote.costo_bruto_ingresado.toFixed(2)}" step="0.01" style="padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px;" oninput="BunkerModalBatch.recalcularCostosBatch('${lote.idTemp}')">
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <label style="font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase;">Kilos Totales</label>
                                <input type="number" id="kilos-totales-${lote.idTemp}" value="${lote.cantidad_total_lote.toFixed(2)}" style="padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; background: #e2e8f0;" readonly>
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; align-items: center;">
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <label style="font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase;">IVA (%)</label>
                                <input type="number" id="iva-${lote.idTemp}" value="${lote.iva}" step="0.1" style="padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px;">
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 2px; text-align: center; background: #e0f2fe; padding: 4px; border-radius: 4px; border: 1px solid #bae6fd; margin-top: 13px;">
                                <span style="font-size: 9px; color: #0369a1; font-weight: bold;">COSTO X KG</span>
                                <span id="lbl-costokg-${lote.idTemp}" style="font-size: 12px; font-weight: bold; color: #0284c7;">$ 0.00</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Columna Derecha: Destinos (Split) -->
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 11px; font-weight: bold; color: #475569; text-transform: uppercase;">Destinos de Asignación</span>
                            <button onclick="BunkerModalBatch.agregarDestinoBatch('${lote.idTemp}')" style="background: #10b981; color: white; border: none; padding: 3px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold;">➕ Agregar</button>
                        </div>
                        
                        <div id="destinos-container-${lote.idTemp}" style="display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto;">
                            <!-- Renglones de destinos dinámicos -->
                        </div>
                        
                        <div style="text-align: right; font-size: 12px; font-weight: bold; color: #64748b; margin-top: 4px;">
                            Asignado: <span id="lbl-asignado-${lote.idTemp}" style="color: #10b981;">0.00</span> / <span id="lbl-total-${lote.idTemp}">0.00</span> kg
                        </div>
                    </div>
                </div>
            `;
            
            container.appendChild(card);
            this.recalcularCostosBatch(lote.idTemp);
            this.renderDestinosBatch(lote.idTemp);
        });

        // Mostrar u ocultar la advertencia general de inconsistencia
        const warningDiv = document.getElementById('bmb-warning-general');
        if (warningDiv) {
            warningDiv.style.display = hasAnyInconsistency ? 'block' : 'none';
        }
    },

    removerLote(loteIdTemp) {
        this.lotesDraft = this.lotesDraft.filter(l => l.idTemp !== loteIdTemp);
        if (this.lotesDraft.length === 0) {
            this.cerrar();
            // Deseleccionar todos los checkboxes en la grilla principal
            document.querySelectorAll('.lote-select-chk').forEach(c => {
                c.checked = false;
            });
            window.onLoteSelectChange(null);
        } else {
            this.renderLotesBatch();
            this.verificarBotonGuardar();
        }
    },

    recalcularCostosBatch(loteIdTemp) {
        const lote = this.lotesDraft.find(l => l.idTemp === loteIdTemp);
        if (lote) {
            const costBruto = parseFloat(document.getElementById(`costo-${loteIdTemp}`).value) || 0;
            const cant = parseFloat(document.getElementById(`kilos-totales-${loteIdTemp}`).value) || 1;
            
            lote.costo_bruto_ingresado = costBruto;
            const costKg = costBruto / cant;
            document.getElementById(`lbl-costokg-${loteIdTemp}`).innerText = '$ ' + costKg.toFixed(2);
        }
        this.verificarBotonGuardar();
    },

    agregarDestinoBatch(loteIdTemp) {
        const lote = this.lotesDraft.find(l => l.idTemp === loteIdTemp);
        if (lote) {
            const destIdTemp = 'dest_' + Math.random().toString(36).substr(2, 9);
            lote.destinos.push({
                idTemp: destIdTemp,
                tipo_destino: 'INGREDIENTE_PRODUCCION', // Default Ingredients
                id: '',
                descripcion: '',
                cantidad_asignada: 0,
                kilos_asignados: 0
            });
            this.renderDestinosBatch(loteIdTemp);
            this.buscarDestinoRemotoBatch('', loteIdTemp, destIdTemp);
        }
    },

    eliminarDestinoBatch(loteIdTemp, destIdTemp) {
        const lote = this.lotesDraft.find(l => l.idTemp === loteIdTemp);
        if (lote) {
            lote.destinos = lote.destinos.filter(d => d.idTemp !== destIdTemp);
            this.renderDestinosBatch(loteIdTemp);
        }
    },

    setTipoDestinoBatch(loteIdTemp, destIdTemp, tipo) {
        const lote = this.lotesDraft.find(l => l.idTemp === loteIdTemp);
        if (lote) {
            const dest = lote.destinos.find(d => d.idTemp === destIdTemp);
            if (dest) {
                dest.tipo_destino = tipo;
                dest.id = '';
                dest.descripcion = '';
                dest.cantidad_asignada = 0;
                dest.kilos_asignados = 0;
                
                // Limpiar select y re-poblar inicialmente según el tipo
                const select = document.getElementById(`sel-destino-${destIdTemp}`);
                if (select) select.innerHTML = '<option value="">-- Seleccionar Destino --</option>';
                const input = document.getElementById(`input-buscar-${destIdTemp}`);
                if (input) input.value = '';

                this.buscarDestinoRemotoBatch('', loteIdTemp, destIdTemp);
            }
        }
        this.verificarBotonGuardar();
    },

    actualizarPorCajasBatch(loteIdTemp, destIdTemp) {
        const lote = this.lotesDraft.find(l => l.idTemp === loteIdTemp);
        if (lote) {
            const dest = lote.destinos.find(d => d.idTemp === destIdTemp);
            if (dest) {
                const inputCj = document.getElementById(`cajas-${destIdTemp}`);
                const cajas = parseFloat(inputCj.value) || 0;
                const kilos = cajas * lote.kilosPorBulto;
                
                document.getElementById(`kilos-${destIdTemp}`).value = kilos % 1 === 0 ? kilos.toFixed(0) : kilos.toFixed(2);
                dest.cantidad_asignada = cajas;
                dest.kilos_asignados = kilos;
            }
        }
        this.recalcularCantidadesBatch(loteIdTemp);
    },

    actualizarPorKilosBatch(loteIdTemp, destIdTemp) {
        const lote = this.lotesDraft.find(l => l.idTemp === loteIdTemp);
        if (lote) {
            const dest = lote.destinos.find(d => d.idTemp === destIdTemp);
            if (dest) {
                const inputKg = document.getElementById(`kilos-${destIdTemp}`);
                const kilos = parseFloat(inputKg.value) || 0;
                const cajas = kilos / lote.kilosPorBulto;
                
                document.getElementById(`cajas-${destIdTemp}`).value = cajas % 1 === 0 ? cajas.toFixed(0) : cajas.toFixed(2);
                dest.cantidad_asignada = cajas;
                dest.kilos_asignados = kilos;
            }
        }
        this.recalcularCantidadesBatch(loteIdTemp);
    },

    async buscarDestinoRemotoBatch(query, loteIdTemp, destIdTemp) {
        const lote = this.lotesDraft.find(l => l.idTemp === loteIdTemp);
        if (!lote) return;
        const dest = lote.destinos.find(d => d.idTemp === destIdTemp);
        if (!dest) return;

        const currentToken = Date.now();
        this._latestSearchTokens[destIdTemp] = currentToken;

        try {
            // Buscador asincrónico por tokens LAMDA sensible a espacio y diacríticos
            const res = await fetch(`http://localhost:3005/api/logistica/bunker/destinos/buscar?q=${encodeURIComponent(query)}`);
            if (res.ok) {
                const result = await res.json();
                
                if (this._latestSearchTokens[destIdTemp] !== currentToken) return; // Race condition

                if (result.success) {
                    const select = document.getElementById(`sel-destino-${destIdTemp}`);
                    if (!select) return;

                    const currentVal = select.value;
                    select.innerHTML = '<option value="">-- Seleccionar Destino --</option>';

                    // Filtrar en frontend por el tipo pre-asignado a este renglón
                    const filteredData = result.data.filter(item => item.tipo_destino === dest.tipo_destino);

                    filteredData.forEach(item => {
                        const opt = document.createElement('option');
                        opt.value = item.id;
                        opt.dataset.tipo = item.tipo_destino;
                        
                        let displayDesc = '';
                        if (item.tipo_destino === 'INGREDIENTE_PRODUCCION') {
                            // Priorizar el nombre descriptivo del ingrediente (ej. Semilla de Zapallo...)
                            displayDesc = item.descripcion;
                            if (item.descripcion_generada) {
                                displayDesc += ` [${item.descripcion_generada}]`; // Mostrar código al final de forma elegante
                            }
                        } else {
                            // Para Búnker, priorizar la descripción generada con la presentación comercial (ej. NUEZ x 1kg)
                            displayDesc = item.descripcion_generada || item.descripcion;
                        }
                        
                        opt.dataset.desc = displayDesc;

                        const locationName = item.tipo_destino === 'ARTICULO_BUNKER' ? 'Depósito Búnker' : 'Almacén Ingredientes';
                        const stockText = `Stock: ${parseFloat(item.stock_actual).toFixed(1)} kg | ${parseFloat(item.stock_bultos).toFixed(0)} cj`;

                        // Inyección de descripción obligatoria prioritaria y saldo en caliente limpio
                        opt.textContent = `[${locationName}] ${displayDesc} (${stockText})`;
                        
                        if (item.id == currentVal) opt.selected = true;
                        select.appendChild(opt);
                    });
                }
            }
        } catch (e) {
            console.error('Error buscando destinos batch:', e);
        }
    },

    actualizarDestinoDataBatch(loteIdTemp, destIdTemp) {
        const select = document.getElementById(`sel-destino-${destIdTemp}`);
        const option = select.options[select.selectedIndex];
        const lote = this.lotesDraft.find(l => l.idTemp === loteIdTemp);
        if (lote) {
            const dest = lote.destinos.find(d => d.idTemp === destIdTemp);
            if (dest && option && option.value) {
                dest.id = option.value;
                dest.tipo_destino = option.dataset.tipo;
                dest.descripcion = option.dataset.desc;
            } else if (dest) {
                dest.id = '';
                dest.descripcion = '';
            }
        }
        this.verificarBotonGuardar();
    },

    renderDestinosBatch(loteIdTemp) {
        const lote = this.lotesDraft.find(l => l.idTemp === loteIdTemp);
        if (!lote) return;

        const container = document.getElementById(`destinos-container-${loteIdTemp}`);
        container.innerHTML = '';

        lote.destinos.forEach(d => {
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; gap: 8px; align-items: center; background: #fff; padding: 8px; border: 1px solid #e2e8f0; border-radius: 4px; margin-bottom: 2px;';
            
            // Generar Toggle select Premium (Switch)
            const toggleGroup = `
                <div style="display: flex; border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden; font-size: 10px; width: 120px; flex-shrink: 0; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);">
                    <button type="button" class="btn-tipo-${d.idTemp}" onclick="BunkerModalBatch.setTipoDestinoBatch('${loteIdTemp}', '${d.idTemp}', 'INGREDIENTE_PRODUCCION')" style="padding: 4px 6px; border: none; background: ${d.tipo_destino === 'INGREDIENTE_PRODUCCION' ? '#3b82f6' : '#f1f5f9'}; color: ${d.tipo_destino === 'INGREDIENTE_PRODUCCION' ? 'white' : '#475569'}; cursor: pointer; font-weight: bold; flex: 1; transition: background 0.1s;">ING</button>
                    <button type="button" class="btn-tipo-${d.idTemp}" onclick="BunkerModalBatch.setTipoDestinoBatch('${loteIdTemp}', '${d.idTemp}', 'ARTICULO_BUNKER')" style="padding: 4px 6px; border: none; background: ${d.tipo_destino === 'ARTICULO_BUNKER' ? '#3b82f6' : '#f1f5f9'}; color: ${d.tipo_destino === 'ARTICULO_BUNKER' ? 'white' : '#475569'}; cursor: pointer; font-weight: bold; flex: 1; transition: background 0.1s;">BUNKER</button>
                </div>
            `;

            div.innerHTML = `
                ${toggleGroup}
                
                <div style="flex: 2; display: flex; flex-direction: column;">
                    <input type="text" id="input-buscar-${d.idTemp}" placeholder="🔍 Buscar..." style="padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px;" onkeyup="BunkerModalBatch.buscarDestinoRemotoBatch(this.value, '${loteIdTemp}', '${d.idTemp}')">
                </div>
                
                <div style="flex: 3; display: flex; flex-direction: column;">
                    <select id="sel-destino-${d.idTemp}" style="padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; width: 100%;" onchange="BunkerModalBatch.actualizarDestinoDataBatch('${loteIdTemp}', '${d.idTemp}')">
                        <option value="">-- Seleccionar --</option>
                    </select>
                </div>
                
                <div style="display: flex; gap: 4px; align-items: center; background: #f8fafc; padding: 4px; border-radius: 4px; border: 1px solid #e2e8f0;">
                    <div style="display: flex; flex-direction: column; align-items: center;">
                        <span style="font-size: 8px; color: #64748b; font-weight: bold;">Cajas</span>
                        <input type="number" id="cajas-${d.idTemp}" style="width: 50px; padding: 2px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; text-align: center; font-weight: bold;" value="${d.cantidad_asignada}" oninput="BunkerModalBatch.actualizarPorCajasBatch('${loteIdTemp}', '${d.idTemp}')">
                    </div>
                    <span style="font-size: 9px; color: #94a3b8; font-weight: bold; margin-top: 10px;">⇄</span>
                    <div style="display: flex; flex-direction: column; align-items: center;">
                        <span style="font-size: 8px; color: #64748b; font-weight: bold;">Kilos</span>
                        <input type="number" id="kilos-${d.idTemp}" style="width: 60px; padding: 2px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; text-align: center; font-weight: bold;" value="${d.kilos_asignados}" oninput="BunkerModalBatch.actualizarPorKilosBatch('${loteIdTemp}', '${d.idTemp}')">
                    </div>
                </div>
                
                <button onclick="BunkerModalBatch.eliminarDestinoBatch('${loteIdTemp}', '${d.idTemp}')" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 11px; padding: 4px;">❌</button>
            `;
            container.appendChild(div);

            // Rehidratar selección si ya existía
            if (d.id) {
                const select = document.getElementById(`sel-destino-${d.idTemp}`);
                if (select) {
                    const prefix = d.tipo_destino === 'ARTICULO_BUNKER' ? 'Depósito Búnker' : 'Almacén Ingredientes';
                    select.innerHTML = `<option value="${d.id}" data-tipo="${d.tipo_destino}" data-desc="${d.descripcion}" selected>[${prefix}] ${d.descripcion}</option>`;
                }
            }
        });
        this.recalcularCantidadesBatch(loteIdTemp);
    },

    recalcularCantidadesBatch(loteIdTemp) {
        const lote = this.lotesDraft.find(l => l.idTemp === loteIdTemp);
        if (lote) {
            const asignado = lote.destinos.reduce((acc, curr) => acc + (curr.kilos_asignados || 0), 0);
            
            const totalSpan = document.getElementById(`lbl-total-${loteIdTemp}`);
            const asignadoSpan = document.getElementById(`lbl-asignado-${loteIdTemp}`);
            
            if (totalSpan) totalSpan.innerText = lote.cantidad_total_lote.toFixed(2);
            if (asignadoSpan) {
                asignadoSpan.innerText = asignado.toFixed(2);
                if (asignado > lote.cantidad_total_lote) {
                    asignadoSpan.style.color = '#ef4444';
                } else {
                    asignadoSpan.style.color = '#10b981';
                }
            }
        }
        this.verificarBotonGuardar();
    },

    verificarBotonGuardar() {
        const btn = document.getElementById('bmb-btn-guardar');
        const validacionCheckbox = document.getElementById('bmb-validacion-manual').checked;
        
        let batchValido = this.lotesDraft.length > 0 && validacionCheckbox;

        this.lotesDraft.forEach(lote => {
            const total = lote.cantidad_total_lote;
            const asignado = lote.destinos.reduce((acc, curr) => acc + (curr.kilos_asignados || 0), 0);
            
            const tieneDestinosValidos = lote.destinos.length > 0 && lote.destinos.every(d => d.id && d.kilos_asignados > 0);
            
            // La asignación debe ser menor o igual al total del lote y tener todos los campos cargados
            if (asignado > total || !tieneDestinosValidos) {
                batchValido = false;
            }
        });

        if (btn) {
            if (batchValido) {
                btn.disabled = false;
                btn.style.opacity = '1';
            } else {
                btn.disabled = true;
                btn.style.opacity = '0.5';
            }
        }
    },

    async guardar() {
        if (document.getElementById('bmb-btn-guardar').disabled) return;
        
        Swal.fire({ 
            title: 'Guardando Vínculos...', 
            text: 'Procesando bloque atómico de transacciones...',
            allowOutsideClick: false, 
            didOpen: () => Swal.showLoading() 
        });

        // Construir la estructura del payload compuesto batch
        const payload = {
            lotes: this.lotesDraft.map(lote => {
                const costoBruto = parseFloat(document.getElementById(`costo-${lote.idTemp}`).value) || 0;
                const totalCant = parseFloat(document.getElementById(`kilos-totales-${lote.idTemp}`).value) || 1;
                const ivaVal = parseFloat(document.getElementById(`iva-${lote.idTemp}`).value) || 0;

                return {
                    lote_id_supabase: lote.lote_id_supabase,
                    costo_bruto_ingresado: costoBruto,
                    cantidad_total_lote: totalCant,
                    iva: ivaVal,
                    iibb: 0,
                    costo_kilo_calculado: costoBruto / totalCant,
                    destinos: lote.destinos.map(d => ({
                        tipo_destino: d.tipo_destino,
                        id: d.id,
                        cantidad_asignada: d.cantidad_asignada,
                        kilos_asignados: d.kilos_asignados
                    }))
                };
            })
        };

        try {
            const res = await fetch('http://localhost:3005/api/logistica/bunker/lotes_vinculos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();

            if (res.ok && result.success) {
                Swal.fire('Vínculos Creados', `Se han procesado ${payload.lotes.length} lotes de forma atómica y consistente con éxito.`, 'success');
                this.cerrar();
                
                // Limpiar selección de la grilla principal
                document.querySelectorAll('.lote-select-chk').forEach(c => {
                    c.checked = false;
                });
                window.onLoteSelectChange(null);

                // Refrescar grilla reactivamente
                if (window.cargarLotes) {
                    window.cargarLotes();
                }
            } else {
                throw new Error(result.error || 'Error al guardar bloque de lotes');
            }
        } catch (e) {
            console.error('Error al guardar vinculación batch:', e);
            Swal.fire('Error de Transacción', e.message || 'Error de conexión', 'error');
        }
    }
};

window.BunkerModalBatch = BunkerModalBatch;
