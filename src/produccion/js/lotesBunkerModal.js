const BunkerModal = {
    loteActual: null,
    destinos: [],
    _searchTimeouts: {},
    _latestSearchTokens: {},

    abrir(lote) {
        this.loteActual = lote;
        this.destinos = [];
        
        const cabecera = lote.recepciones_fisicas_cabecera || {};
        const item = lote.pedidos_b2b_items || {};
        const idCorto = (lote.id || '').substring(0, 8).toUpperCase();
        
        document.getElementById('bm-lote-id').innerText = idCorto;
        document.getElementById('bm-producto').innerText = item.producto_descripcion || 'Sin descripción';
        
        const bult = parseFloat(item.cant_bult) || 1;
        const val = parseFloat(item.cant_valor) || 1;
        const vu = parseFloat(item.valor_unitario_ref) || 0;
        const cantRecibida = parseFloat(lote.cantidad_recibida) || 1;
        
        const kilosPorBultoFisico = bult * val; // El peso de cada caja/bulto físico (ej. 10x1 = 10kg)
        this.kilosPorBultoLote = kilosPorBultoFisico || 1;
        
        const costoOriginal = vu * kilosPorBultoFisico * cantRecibida;
        const cantidadTotalKilos = cantRecibida * kilosPorBultoFisico; // bultos físicos recibidos * kilos por bulto
        
        document.getElementById('bm-bultos').innerText = cantRecibida.toString();
        document.getElementById('bm-kilos-unidad').innerText = kilosPorBultoFisico.toString() + ' kg';
        
        // Alerta de Inconsistencia Flagrante
        const isInconsistent = (bult === 1 && val === 1 && item.unidad_ref === 'Kilogramo' && vu > 1000);
        const warningDiv = document.getElementById('bm-warning-inconsistente');
        if (warningDiv) {
            if (isInconsistent) {
                warningDiv.style.display = 'block';
                warningDiv.innerHTML = `⚠️ ADVERTENCIA CRÍTICA: Se ha detectado una inconsistencia flagrante de factor de conversión (1x1) en este artículo mayorista premium ($ ${vu.toLocaleString('es-AR')}/kg). Por favor, verifique el maestro de conversión antes de vincular para evitar balances de inventario erróneos.`;
            } else {
                warningDiv.style.display = 'none';
            }
        }
        
        document.getElementById('bm-costo-bruto').value = costoOriginal.toFixed(2);
        document.getElementById('bm-cantidad-total').value = cantidadTotalKilos.toFixed(2);
        
        document.getElementById('bm-destinos-container').innerHTML = '';
        document.getElementById('bm-validacion-manual').checked = false;
        
        this.recalcularCostos();
        this.renderDestinos();
        this.verificarBotonGuardar();
        
        document.getElementById('bm-validacion-manual').addEventListener('change', () => this.verificarBotonGuardar());
        
        document.getElementById('modal-bunker').classList.add('show');
    },

    cerrar() {
        document.getElementById('modal-bunker').classList.remove('show');
    },

    recalcularCostos() {
        const costoBruto = parseFloat(document.getElementById('bm-costo-bruto').value) || 0;
        const cantidad = parseFloat(document.getElementById('bm-cantidad-total').value) || 1;
        const iva = parseFloat(document.getElementById('bm-iva').value) || 0;

        // Costo por Kilo = Costo Bruto / Cantidad (Antes de impuestos, el impuesto es aparte para el margen)
        const costoKilo = costoBruto / cantidad;
        document.getElementById('bm-costo-kilo').innerText = '$ ' + costoKilo.toFixed(2);
        
        this.verificarBotonGuardar();
    },

    agregarDestino() {
        this.destinos.push({
            idTemp: Date.now(),
            tipo_destino: 'ARTICULO_BUNKER',
            id: '',
            descripcion: '',
            cantidad_asignada: 0,
            kilos_asignados: 0
        });
        this.renderDestinos();
    },

    eliminarDestino(idTemp) {
        this.destinos = this.destinos.filter(d => d.idTemp !== idTemp);
        this.renderDestinos();
    },

    async buscarDestinoRemoto(query, idTemp) {
        console.log(`[VIGÍA FRONTEND] -> Disparo de buscarDestinoRemoto. Query tipeada: "${query}" | idTemp: ${idTemp}`);
        if (!query || query.length < 3) {
            console.log(`[VIGÍA FRONTEND] -> Cancelado: query demasiado corta (<3).`);
            return;
        }
        
        // Debounce: cancel pending timeout for this input
        if (this._searchTimeouts[idTemp]) {
            clearTimeout(this._searchTimeouts[idTemp]);
            console.log(`[VIGÍA FRONTEND] -> Petición anterior abortada (Debounce)`);
        }

        this._searchTimeouts[idTemp] = setTimeout(async () => {
            // Generate a unique token for this specific fetch
            const currentToken = Date.now();
            this._latestSearchTokens[idTemp] = currentToken;
            console.log(`[VIGÍA FRONTEND] -> Ejecutando fetch a /buscar?q=${encodeURIComponent(query)} [Token: ${currentToken}]`);

            try {
                const res = await fetch(`http://localhost:3005/api/logistica/bunker/destinos/buscar?q=${encodeURIComponent(query)}`);
                console.log(`[VIGÍA FRONTEND] -> Fetch completado con status: ${res.status}`);
                const result = await res.json();
                
                // Race condition guard: If a newer request was made, ignore this response
                if (this._latestSearchTokens[idTemp] !== currentToken) {
                    console.warn(`[VIGÍA FRONTEND] -> Respuesta descartada por obsolescencia de token (Race Condition Guard).`);
                    return;
                }

                if (result.success) {
                    console.log(`[VIGÍA FRONTEND] -> Renderizando ${result.data.length} opciones en el select.`);
                    const select = document.getElementById(`sel-destino-${idTemp}`);
                    // Preserve current selection if it still exists in the new results
                    const currentVal = select.value;
                    
                    select.innerHTML = '<option value="">-- Seleccionar Destino --</option>';
                    result.data.forEach(item => {
                        const opt = document.createElement('option');
                        opt.value = item.id;
                        opt.dataset.tipo = item.tipo_destino;
                        
                        let displayDesc = '';
                        if (item.tipo_destino === 'INGREDIENTE_PRODUCCION') {
                            // Priorizar el nombre descriptivo del ingrediente (ej. Semilla de Zapallo...)
                            displayDesc = item.descripcion;
                            if (item.descripcion_generada) {
                                displayDesc += ` [${item.descripcion_generada}]`; // Mostrar código al final
                            }
                        } else {
                            // Para Búnker, priorizar la descripción generada con la presentación comercial (ej. NUEZ x 1kg)
                            displayDesc = item.descripcion_generada || item.descripcion;
                        }
                        
                        opt.dataset.desc = displayDesc;
                        
                        const prefix = item.tipo_destino === 'ARTICULO_BUNKER' ? 'Depósito Búnker' : 'Almacén Ingredientes';
                        const stockInfo = `Stock: ${parseFloat(item.stock_actual).toFixed(1)} kg | ${parseFloat(item.stock_bultos).toFixed(0)} cajas`;
                        
                        opt.textContent = `[${prefix}] ${displayDesc} (${stockInfo})`;
                        if (item.id == currentVal) opt.selected = true;
                        select.appendChild(opt);
                    });
                    console.log(`[VIGÍA FRONTEND] -> Renderizado en DOM finalizado.`);
                }
            } catch(e) {
                console.error('[VIGÍA FRONTEND] -> ERROR CRÍTICO CAPTURADO:', e);
            }
        }, 300); // 300ms debounce
    },

    actualizarDestinoData(idTemp) {
        const select = document.getElementById(`sel-destino-${idTemp}`);
        const option = select.options[select.selectedIndex];
        const destino = this.destinos.find(d => d.idTemp === idTemp);
        if (destino && option && option.value) {
            destino.id = option.value;
            destino.tipo_destino = option.dataset.tipo;
            destino.descripcion = option.dataset.desc;
        }
        this.verificarBotonGuardar();
    },

    actualizarPorCajas(idTemp) {
        const destino = this.destinos.find(d => d.idTemp === idTemp);
        if (destino) {
            const cajasInput = document.getElementById(`cajas-${idTemp}`);
            const cajasVal = parseFloat(cajasInput.value) || 0;
            const kilosVal = cajasVal * this.kilosPorBultoLote;
            
            document.getElementById(`kilos-${idTemp}`).value = kilosVal % 1 === 0 ? kilosVal.toFixed(0) : kilosVal.toFixed(2);
            destino.cantidad_asignada = cajasVal;
            destino.kilos_asignados = kilosVal;
        }
        this.renderCantidades();
    },

    actualizarPorKilos(idTemp) {
        const destino = this.destinos.find(d => d.idTemp === idTemp);
        if (destino) {
            const kilosInput = document.getElementById(`kilos-${idTemp}`);
            const kilosVal = parseFloat(kilosInput.value) || 0;
            const cajasVal = kilosVal / this.kilosPorBultoLote;
            
            document.getElementById(`cajas-${idTemp}`).value = cajasVal % 1 === 0 ? cajasVal.toFixed(0) : cajasVal.toFixed(2);
            destino.cantidad_asignada = cajasVal;
            destino.kilos_asignados = kilosVal;
        }
        this.renderCantidades();
    },

    renderDestinos() {
        const container = document.getElementById('bm-destinos-container');
        container.innerHTML = '';
        this.destinos.forEach(d => {
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; gap: 10px; align-items: center; background: #fff; padding: 10px; border: 1px solid #e2e8f0; border-radius: 4px;';
            div.innerHTML = `
                <div style="flex: 2; display: flex; flex-direction: column; gap: 4px;">
                    <input type="text" placeholder="🔍 Buscar Búnker / Ingrediente..." style="padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px;" onkeyup="BunkerModal.buscarDestinoRemoto(this.value, ${d.idTemp})">
                </div>
                <div style="flex: 3; display: flex; flex-direction: column; gap: 4px;">
                    <select id="sel-destino-${d.idTemp}" style="padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; width: 100%;" onchange="BunkerModal.actualizarDestinoData(${d.idTemp})">
                        <option value="">-- Seleccionar Destino --</option>
                    </select>
                </div>
                <div style="display: flex; gap: 8px; align-items: center; background: #f8fafc; padding: 6px; border-radius: 4px; border: 1px solid #e2e8f0;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        <span style="font-size: 9px; color: #64748b; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px;">Cajas Cerradas</span>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <input type="number" id="cajas-${d.idTemp}" placeholder="Bultos" style="width: 70px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; text-align: center; font-weight: 600; color: #1e293b;" value="${d.cantidad_asignada}" oninput="BunkerModal.actualizarPorCajas(${d.idTemp})">
                            <span style="font-size: 11px; color: #64748b; font-weight: 600;">cj</span>
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #94a3b8; font-weight: bold; margin-top: 12px;">⇄</div>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        <span style="font-size: 9px; color: #64748b; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px;">Kilos Netos Equiv.</span>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <input type="number" id="kilos-${d.idTemp}" placeholder="Kilos" style="width: 80px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; text-align: center; font-weight: 600; color: #1e293b;" value="${d.kilos_asignados}" oninput="BunkerModal.actualizarPorKilos(${d.idTemp})">
                            <span style="font-size: 11px; color: #64748b; font-weight: 600;">kg</span>
                        </div>
                    </div>
                </div>
                <button onclick="BunkerModal.eliminarDestino(${d.idTemp})" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='#ef4444'">❌</button>
            `;
            container.appendChild(div);
            
            if (d.id) {
                const select = document.getElementById(`sel-destino-${d.idTemp}`);
                const prefix = d.tipo_destino === 'ARTICULO_BUNKER' ? 'Depósito Búnker' : 'Almacén Ingredientes';
                select.innerHTML = `<option value="${d.id}" data-tipo="${d.tipo_destino}" data-desc="${d.descripcion}" selected>[${prefix}] ${d.descripcion}</option>`;
            }
        });
        this.renderCantidades();
    },

    renderCantidades() {
        const total = parseFloat(document.getElementById('bm-cantidad-total').value) || 0;
        const asignado = this.destinos.reduce((acc, curr) => acc + (curr.kilos_asignados || 0), 0);
        
        document.getElementById('bm-disponible-total').innerText = total.toFixed(2);
        document.getElementById('bm-asignado-total').innerText = asignado.toFixed(2);
        
        if (asignado > total) {
            document.getElementById('bm-asignado-total').style.color = '#ef4444'; // Red
        } else {
            document.getElementById('bm-asignado-total').style.color = '#10b981'; // Green
        }
        
        this.verificarBotonGuardar();
    },

    verificarBotonGuardar() {
        const btn = document.getElementById('bm-btn-guardar');
        const validacionCheckbox = document.getElementById('bm-validacion-manual').checked;
        const total = parseFloat(document.getElementById('bm-cantidad-total').value) || 0;
        const asignado = this.destinos.reduce((acc, curr) => acc + (curr.kilos_asignados || 0), 0);
        
        const tieneDestinosValidos = this.destinos.length > 0 && this.destinos.every(d => d.id && d.kilos_asignados > 0);
        
        if (validacionCheckbox && asignado <= total && tieneDestinosValidos) {
            btn.disabled = false;
            btn.style.opacity = '1';
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.5';
        }
    },

    async guardar() {
        if (document.getElementById('bm-btn-guardar').disabled) return;
        
        Swal.fire({ title: 'Guardando Vínculo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        const payload = {
            lote_id_supabase: this.loteActual.id,
            costo_bruto_ingresado: parseFloat(document.getElementById('bm-costo-bruto').value),
            cantidad_total_lote: parseFloat(document.getElementById('bm-cantidad-total').value),
            iva: parseFloat(document.getElementById('bm-iva').value),
            iibb: 0, // Removed UI field, default 0 for DB
            costo_kilo_calculado: parseFloat(document.getElementById('bm-costo-bruto').value) / parseFloat(document.getElementById('bm-cantidad-total').value),
            destinos: this.destinos
        };

        try {
            const res = await fetch('http://localhost:3005/api/logistica/bunker/lotes_vinculos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            
            if (res.ok && result.success) {
                Swal.fire('Vínculo Creado', 'El lote fue ingresado al ecosistema Búnker en modo sombra.', 'success');
                this.cerrar();
            } else {
                throw new Error(result.error);
            }
        } catch(e) {
            Swal.fire('Error', e.message || 'Error de conexión', 'error');
        }
    }
};

window.BunkerModal = BunkerModal;
