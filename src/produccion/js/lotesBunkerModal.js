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
        
        const estadoData = window.LotesTrazabilidadCache ? window.LotesTrazabilidadCache[lote.id] : null;
        let kilosPendientes = cantidadTotalKilos;
        let bultosPendientes = cantRecibida;
        
        if (estadoData && estadoData.estado === 'ASIGNADO_PARCIAL') {
            const kilosYaAsignados = parseFloat(estadoData.suma_asignada || 0);
            kilosPendientes = Math.max(0, cantidadTotalKilos - kilosYaAsignados);
            bultosPendientes = kilosPendientes / kilosPorBultoFisico;
        }

        document.getElementById('bm-bultos').innerText = estadoData && estadoData.estado === 'ASIGNADO_PARCIAL'
            ? `${cantRecibida} (${bultosPendientes} pend.)`
            : cantRecibida.toString();
        document.getElementById('bm-kilos-unidad').innerText = kilosPorBultoFisico.toString() + ' kg';
        
        // Alerta de Inconsistencia Flagrante
        const isInconsistent = (bult === 1 && val === 1 && item.unidad_ref === 'Kilogramo' && vu > 1000);
        const warningDiv = document.getElementById('bm-warning-inconsistente');
        if (warningDiv) {
            if (isInconsistent) {
                warningDiv.style.display = 'block';
                const safeDescEscaped = (item.producto_descripcion || 'Sin descripción').replace(/"/g, '&quot;').replace(/'/g, "\\'").replace(/\n/g, ' ');
                warningDiv.innerHTML = `⚠️ ADVERTENCIA CRÍTICA: Se ha detectado una inconsistencia de factor de conversión (1x1) en este artículo mayorista premium ($ ${vu.toLocaleString('es-AR')}/kg).<br>Por favor, <a href="#" onclick="BunkerModal.cerrar(); window.corregirPresentacion('${lote.id}', ${bult}, ${val}, '${safeDescEscaped}'); return false;" style="color: #ef4444; font-weight: bold; text-decoration: underline;">corrija la presentación manualmente aquí</a> antes de vincular para evitar balances de inventario erróneos.`;
            } else if (estadoData && estadoData.estado === 'ASIGNADO_PARCIAL') {
                warningDiv.style.display = 'block';
                warningDiv.style.backgroundColor = '#e0f2fe';
                warningDiv.style.color = '#0369a1';
                warningDiv.style.borderColor = '#bae6fd';
                warningDiv.innerHTML = `ℹ️ <b>Asignación Parcial Previa:</b> Se están vinculando los <b>${bultosPendientes} bultos remanentes</b> (${kilosPendientes} kg pendientes de un total de ${cantidadTotalKilos} kg).`;
            } else {
                warningDiv.style.display = 'none';
            }
        }
        
        document.getElementById('bm-costo-bruto').value = (vu * kilosPorBultoFisico * bultosPendientes).toFixed(2);
        document.getElementById('bm-cantidad-total').value = kilosPendientes.toFixed(2);
        
        document.getElementById('bm-destinos-container').innerHTML = '';
        document.getElementById('bm-validacion-manual').checked = false;
        
        this.recalcularCostos();
        
        // Auto-crear el primer destino con el 100% del saldo pendiente disponible
        this.agregarDestino();
        
        const checkValidacion = document.getElementById('bm-validacion-manual');
        if (checkValidacion) {
            checkValidacion.onchange = () => this.verificarBotonGuardar();
        }
        
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
        const totalKilos = parseFloat(document.getElementById('bm-cantidad-total').value) || 0;
        const yaAsignadoKilos = this.destinos.reduce((acc, curr) => acc + (parseFloat(curr.kilos_asignados) || 0), 0);
        const remanenteKilos = Math.max(0, totalKilos - yaAsignadoKilos);
        const factorInicial = this.kilosPorBultoLote > 0 ? this.kilosPorBultoLote : 1;
        const remanenteCajas = factorInicial > 0 ? (remanenteKilos / factorInicial) : 0;
        
        const autoCajas = remanenteCajas % 1 === 0 ? remanenteCajas : parseFloat(remanenteCajas.toFixed(2));
        const autoKilos = remanenteKilos % 1 === 0 ? remanenteKilos : parseFloat(remanenteKilos.toFixed(2));

        this.destinos.push({
            idTemp: Date.now() + Math.floor(Math.random() * 1000),
            tipo_destino: 'ARTICULO_BUNKER',
            id: '',
            descripcion: '',
            factor_pack: factorInicial,
            cantidad_asignada: autoCajas,
            kilos_asignados: autoKilos,
            _lastEdited: null
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
            destino._lastEdited = 'cajas';
            const cajasInput = document.getElementById(`cajas-${idTemp}`);
            const factorInput = document.getElementById(`factor-${idTemp}`);
            const cajasVal = parseFloat(cajasInput.value) || 0;
            const factorVal = (factorInput ? parseFloat(factorInput.value) : destino.factor_pack) || this.kilosPorBultoLote || 1;
            const kilosVal = cajasVal * factorVal;
            
            document.getElementById(`kilos-${idTemp}`).value = kilosVal % 1 === 0 ? kilosVal.toFixed(0) : kilosVal.toFixed(2);
            destino.factor_pack = factorVal;
            destino.cantidad_asignada = cajasVal;
            destino.kilos_asignados = kilosVal;
        }
        this.renderCantidades();
    },

    actualizarPorFactor(idTemp) {
        const destino = this.destinos.find(d => d.idTemp === idTemp);
        if (destino) {
            const factorInput = document.getElementById(`factor-${idTemp}`);
            const cajasInput = document.getElementById(`cajas-${idTemp}`);
            const kilosInput = document.getElementById(`kilos-${idTemp}`);
            const factorVal = parseFloat(factorInput.value) || 0;
            destino.factor_pack = factorVal;

            if (factorVal > 0) {
                if (destino._lastEdited === 'cajas') {
                    // Si el operador primero escribió los bultos/packs (ej: 5) y luego el factor (ej: 20), calcula 5 * 20 = 100
                    const cajasVal = parseFloat(cajasInput.value) || 0;
                    const kilosVal = cajasVal * factorVal;
                    kilosInput.value = kilosVal % 1 === 0 ? kilosVal.toFixed(0) : kilosVal.toFixed(2);
                    destino.cantidad_asignada = cajasVal;
                    destino.kilos_asignados = kilosVal;
                } else {
                    // Por defecto mantiene el total neto (ej: 100) y calcula cuántos packs físicos son (100 / 20 = 5)
                    const kilosVal = parseFloat(kilosInput.value) || 0;
                    const cajasVal = kilosVal / factorVal;
                    cajasInput.value = cajasVal % 1 === 0 ? cajasVal.toFixed(0) : cajasVal.toFixed(2);
                    destino.cantidad_asignada = cajasVal;
                    destino.kilos_asignados = kilosVal;
                }
            }
        }
        this.renderCantidades();
    },

    actualizarPorKilos(idTemp) {
        const destino = this.destinos.find(d => d.idTemp === idTemp);
        if (destino) {
            const kilosInput = document.getElementById(`kilos-${idTemp}`);
            const cajasInput = document.getElementById(`cajas-${idTemp}`);
            const factorInput = document.getElementById(`factor-${idTemp}`);
            const kilosVal = parseFloat(kilosInput.value) || 0;

            if (destino._lastEdited === 'cajas' && (parseFloat(cajasInput.value) || 0) > 0) {
                const cajasVal = parseFloat(cajasInput.value);
                const nuevoFactor = kilosVal > 0 ? (kilosVal / cajasVal) : 1;
                if (factorInput) {
                    factorInput.value = nuevoFactor % 1 === 0 ? nuevoFactor.toFixed(0) : nuevoFactor.toFixed(2);
                }
                destino.factor_pack = nuevoFactor;
                destino.cantidad_asignada = cajasVal;
                destino.kilos_asignados = kilosVal;
            } else {
                destino._lastEdited = 'kilos';
                const factorVal = (factorInput ? parseFloat(factorInput.value) : destino.factor_pack) || this.kilosPorBultoLote || 1;
                const cajasVal = factorVal > 0 ? (kilosVal / factorVal) : 0;
                
                cajasInput.value = cajasVal % 1 === 0 ? cajasVal.toFixed(0) : cajasVal.toFixed(2);
                destino.factor_pack = factorVal;
                destino.cantidad_asignada = cajasVal;
                destino.kilos_asignados = kilosVal;
            }
        }
        this.renderCantidades();
    },

    renderDestinos() {
        const container = document.getElementById('bm-destinos-container');
        container.innerHTML = '';
        this.destinos.forEach(d => {
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; gap: 10px; align-items: center; background: #fff; padding: 10px; border: 1px solid #e2e8f0; border-radius: 4px;';
            const factorMostrar = d.factor_pack !== undefined ? d.factor_pack : (this.kilosPorBultoLote || 1);
            div.innerHTML = `
                <div style="flex: 2; display: flex; flex-direction: column; gap: 4px;">
                    <input type="text" placeholder="🔍 Buscar Búnker / Ingrediente..." style="padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px;" onkeyup="BunkerModal.buscarDestinoRemoto(this.value, ${d.idTemp})">
                </div>
                <div style="flex: 3; display: flex; flex-direction: column; gap: 4px;">
                    <select id="sel-destino-${d.idTemp}" style="padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; width: 100%;" onchange="BunkerModal.actualizarDestinoData(${d.idTemp})">
                        <option value="">-- Seleccionar Destino --</option>
                    </select>
                </div>
                <div style="display: flex; gap: 6px; align-items: center; background: #f8fafc; padding: 6px; border-radius: 4px; border: 1px solid #e2e8f0;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        <span style="font-size: 9px; color: #64748b; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px;">Bultos / Packs</span>
                        <div style="display: flex; align-items: center; gap: 3px;">
                            <input type="number" id="cajas-${d.idTemp}" step="any" placeholder="Bultos" style="width: 62px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; text-align: center; font-weight: 600; color: #1e293b;" value="${d.cantidad_asignada}" onfocus="this.select()" oninput="BunkerModal.actualizarPorCajas(${d.idTemp})">
                            <span style="font-size: 11px; color: #64748b; font-weight: 600;">cj</span>
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #94a3b8; font-weight: bold; margin-top: 12px;">×</div>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        <span style="font-size: 9px; color: #0284c7; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px;" title="Unidades o Kilos agrupados en cada bulto/pack físico">x Pack</span>
                        <div style="display: flex; align-items: center; gap: 3px;">
                            <input type="number" id="factor-${d.idTemp}" step="any" placeholder="x Pack" style="width: 58px; padding: 4px; border: 1px solid #7dd3fc; background: #f0f9ff; border-radius: 4px; font-size: 13px; text-align: center; font-weight: 700; color: #0369a1;" value="${factorMostrar}" onfocus="this.select()" oninput="BunkerModal.actualizarPorFactor(${d.idTemp})">
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #94a3b8; font-weight: bold; margin-top: 12px;">=</div>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        <span style="font-size: 9px; color: #64748b; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px;">Total Neto</span>
                        <div style="display: flex; align-items: center; gap: 3px;">
                            <input type="number" id="kilos-${d.idTemp}" step="any" placeholder="Kilos/Unid" style="width: 72px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; text-align: center; font-weight: 600; color: #1e293b;" value="${d.kilos_asignados}" onfocus="this.select()" oninput="BunkerModal.actualizarPorKilos(${d.idTemp})">
                            <span style="font-size: 11px; color: #64748b; font-weight: 600;">kg/u</span>
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
        const totalKilos = parseFloat(document.getElementById('bm-cantidad-total').value) || 0;
        const asignadoKilos = this.destinos.reduce((acc, curr) => acc + (parseFloat(curr.kilos_asignados) || 0), 0);
        const totalCajas = this.kilosPorBultoLote > 0 ? (totalKilos / this.kilosPorBultoLote) : 0;
        const asignadoCajas = this.destinos.reduce((acc, curr) => acc + (parseFloat(curr.cantidad_asignada) || 0), 0);

        const fmtTotalCj = totalCajas % 1 === 0 ? totalCajas.toFixed(0) : totalCajas.toFixed(1);
        const fmtAsigCj = asignadoCajas % 1 === 0 ? asignadoCajas.toFixed(0) : asignadoCajas.toFixed(1);

        const dispEl = document.getElementById('bm-disponible-total');
        const asigEl = document.getElementById('bm-asignado-total');
        if (dispEl) dispEl.innerText = `${totalKilos.toFixed(2)} kg/u (${fmtTotalCj} bultos orig.)`;
        if (asigEl) asigEl.innerText = `${asignadoKilos.toFixed(2)} kg/u (${fmtAsigCj} packs/cj)`;
        
        const alertaParcialEl = document.getElementById('bm-alerta-parcial');
        if (asignadoKilos > (totalKilos + 0.001)) {
            if (asigEl) asigEl.style.color = '#ef4444'; // Red
            if (alertaParcialEl) {
                alertaParcialEl.style.display = 'block';
                alertaParcialEl.style.backgroundColor = '#fee2e2';
                alertaParcialEl.style.color = '#b91c1c';
                alertaParcialEl.style.borderColor = '#fca5a5';
                alertaParcialEl.innerHTML = `⚠️ Exceso: Se están asignando ${(asignadoKilos - totalKilos).toFixed(2)} kg/u de más.`;
            }
        } else if (asignadoKilos < (totalKilos - 0.001)) {
            if (asigEl) asigEl.style.color = '#f59e0b'; // Amber
            if (alertaParcialEl) {
                const remCj = (totalCajas - (this.kilosPorBultoLote > 0 ? (asignadoKilos / this.kilosPorBultoLote) : 0));
                const fmtRemCj = remCj % 1 === 0 ? remCj.toFixed(0) : remCj.toFixed(1);
                alertaParcialEl.style.display = 'block';
                alertaParcialEl.style.backgroundColor = '#fef3c7';
                alertaParcialEl.style.color = '#b45309';
                alertaParcialEl.style.borderColor = '#fde68a';
                alertaParcialEl.innerHTML = `⚠️ Asignación Parcial: Quedarán <b>${fmtRemCj} cj (${(totalKilos - asignadoKilos).toFixed(2)} kg/u)</b> pendientes.`;
            }
        } else {
            if (asigEl) asigEl.style.color = '#10b981'; // Green
            if (alertaParcialEl) {
                alertaParcialEl.style.display = 'block';
                alertaParcialEl.style.backgroundColor = '#f0fdf4';
                alertaParcialEl.style.color = '#15803d';
                alertaParcialEl.style.borderColor = '#bbf7d0';
                alertaParcialEl.innerHTML = `✅ Asignación Completa (100% asignado en ${fmtAsigCj} bultos/packs)`;
            }
        }
        
        this.verificarBotonGuardar();
    },

    verificarBotonGuardar() {
        const btn = document.getElementById('bm-btn-guardar');
        const validacionCheckbox = document.getElementById('bm-validacion-manual').checked;
        const total = parseFloat(document.getElementById('bm-cantidad-total').value) || 0;
        const asignado = this.destinos.reduce((acc, curr) => acc + (curr.kilos_asignados || 0), 0);
        
        const tieneDestinosValidos = this.destinos.length > 0 && this.destinos.every(d => d.id && d.kilos_asignados > 0);
        
        if (validacionCheckbox && asignado <= (total + 0.001) && tieneDestinosValidos) {
            btn.disabled = false;
            btn.style.opacity = '1';
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.5';
        }
    },

    async guardar() {
        if (document.getElementById('bm-btn-guardar').disabled) return;

        // 1. Sincronizar explícitamente desde los inputs del DOM por seguridad absoluta
        this.destinos.forEach(d => {
            const inputCajas = document.getElementById(`cajas-${d.idTemp}`);
            const inputFactor = document.getElementById(`factor-${d.idTemp}`);
            const inputKilos = document.getElementById(`kilos-${d.idTemp}`);
            if (inputCajas && inputKilos) {
                const cjVal = parseFloat(inputCajas.value) || 0;
                const kgVal = parseFloat(inputKilos.value) || 0;
                d.cantidad_asignada = cjVal;
                d.kilos_asignados = kgVal;
                if (inputFactor) {
                    d.factor_pack = parseFloat(inputFactor.value) || 1;
                }
            }
        });

        // 2. Control anti-distracción: si es asignación parcial, pedir confirmación al usuario
        const totalKilos = parseFloat(document.getElementById('bm-cantidad-total').value) || 0;
        const asignadoKilos = this.destinos.reduce((acc, curr) => acc + (curr.kilos_asignados || 0), 0);
        const remanenteKilos = totalKilos - asignadoKilos;
        if (remanenteKilos > 0.01) {
            const remanenteCajas = this.kilosPorBultoLote > 0 ? (remanenteKilos / this.kilosPorBultoLote) : 0;
            const fmtRemCj = remanenteCajas % 1 === 0 ? remanenteCajas.toFixed(0) : remanenteCajas.toFixed(1);
            const asigCj = this.kilosPorBultoLote > 0 ? (asignadoKilos / this.kilosPorBultoLote) : 0;
            const fmtAsigCj = asigCj % 1 === 0 ? asigCj.toFixed(0) : asigCj.toFixed(1);
            const totalCj = this.kilosPorBultoLote > 0 ? (totalKilos / this.kilosPorBultoLote) : 0;
            const fmtTotalCj = totalCj % 1 === 0 ? totalCj.toFixed(0) : totalCj.toFixed(1);

            const confirm = await Swal.fire({
                title: '¿Confirmar Asignación Parcial?',
                html: `<p style="margin-bottom: 8px;">Estás asignando <b>${fmtAsigCj} cj (${asignadoKilos.toFixed(1)} kg)</b> de un total de <b>${fmtTotalCj} cj (${totalKilos.toFixed(1)} kg)</b>.</p><p style="color: #ea580c; font-weight: bold; background: #fff7ed; padding: 8px; border-radius: 6px; border: 1px solid #ffedd5;">Quedarán ${fmtRemCj} cajas pendientes de asignación.</p>`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sí, guardar como parcial',
                cancelButtonText: 'Revisar y corregir',
                confirmButtonColor: '#fd7e14'
            });
            if (!confirm.isConfirmed) {
                return;
            }
        }
        
        Swal.fire({ title: 'Guardando Vínculo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        const payload = {
            lote_id_supabase: this.loteActual.id,
            costo_bruto_ingresado: parseFloat(document.getElementById('bm-costo-bruto').value),
            cantidad_total_lote: parseFloat(document.getElementById('bm-cantidad-total').value),
            iva: parseFloat(document.getElementById('bm-iva').value),
            iibb: 0, // Removed UI field, default 0 for DB
            costo_kilo_calculado: parseFloat(document.getElementById('bm-costo-bruto').value) / parseFloat(document.getElementById('bm-cantidad-total').value),
            proveedor_nombre: this.loteActual?.recepciones_fisicas_cabecera?.pedidos_b2b_cabecera?.proveedores?.nombre || '',
            articulo_descripcion: this.loteActual?.pedidos_b2b_items?.producto_descripcion || '',
            producto_codigo: this.loteActual?.pedidos_b2b_items?.producto_codigo || '',
            numero_remito: this.loteActual?.recepciones_fisicas_cabecera?.numero_remito || '',
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
                if (window.cargarLotes) {
                    window.cargarLotes();
                }
            } else {
                throw new Error(result.error);
            }
        } catch(e) {
            Swal.fire('Error', e.message || 'Error de conexión', 'error');
        }
    }
};

window.BunkerModal = BunkerModal;
