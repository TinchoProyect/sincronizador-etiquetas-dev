/**
 * ⚖️ MÓDULO: CARGAR SALDO DE INGREDIENTE EN PRESUPUESTOS
 * Permite vender un saldo fraccionado de ingrediente (ej: 1.800 kg) bajo el código
 * y precio proporcional de un artículo comercial sin stock (ej: Caja x 5 kg -> cant 0.36).
 *
 * Cumple con:
 *  1. Prioridad 1: Cable Artículo <-> Ingrediente automático
 *  2. Prioridad 2: Escáner de código de barras de ingrediente
 *  3. Prioridad 3: Buscador manual por grupo de caracteres (Política Universal LAMDA) + Filtro por Sector
 *  4. Regla de 3 simple (Kilos Saldo / Kilos Unidad Comercial = Cantidad decimal)
 *  5. Cucarda visual en el renglón + Impresión de etiqueta Zebra con código del artículo comercial
 */

(function () {
    'use strict';

    let cacheIngredientes = [];
    let currentRow = null;
    let selectedIngrediente = null;
    let unidadIngreso = 'KG'; // 'KG' | 'GR'
    let sectorFiltroActivo = 'TODOS';
    let currentArticuloInfo = {
        codigo: '',
        codigo_barras: '',
        descripcion: '',
        kilos_unidad: 1,
        precio_unitario_con_iva: 0
    };

    /**
     * Bolsa de búsqueda combinada (Política Universal de Búsqueda LAMDA - Fase 49)
     */
    function obtenerTextoBusquedaIngrediente(ing) {
        if (!ing) return '';
        const campos = [
            ing.id,
            ing.codigo,
            ing.nombre,
            ing.unidad_medida,
            ing.sector_letra ? `sector ${ing.sector_letra}` : '',
            ing.sector_letra,
            ing.categoria,
            ing.nombre_categoria,
            ing.origen_cable
        ];
        if (ing.propiedades_dinamicas && typeof ing.propiedades_dinamicas === 'object') {
            Object.values(ing.propiedades_dinamicas).forEach(v => {
                if (v !== null && v !== undefined) campos.push(String(v));
            });
        }
        return campos
            .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
            .map(v => String(v).toLowerCase())
            .join(' ');
    }

    function asegurarEstilosYModal() {
        if (document.getElementById('modal-saldo-ingrediente-overlay')) return;

        const style = document.createElement('style');
        style.id = ' estilos-saldo-ingrediente';
        style.textContent = `
            .btn-saldo-ingrediente {
                background: #fffbeb;
                border: 1px solid #f59e0b;
                color: #b45309;
                border-radius: 4px;
                padding: 4px 7px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.15s ease;
            }
            .btn-saldo-ingrediente:hover {
                background: #fef3c7;
                border-color: #d97706;
                transform: translateY(-1px);
            }
            .btn-saldo-ingrediente.active-saldo {
                background: #f59e0b;
                color: #ffffff;
                border-color: #b45309;
                box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.25);
            }
            .cucarda-saldo-ingrediente {
                margin-top: 5px;
                padding: 5px 8px;
                background: linear-gradient(90deg, #fffbeb 0%, #fef3c7 100%);
                border: 1px solid #f59e0b;
                border-left: 4px solid #d97706;
                border-radius: 5px;
                font-size: 11.5px;
                color: #92400e;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                flex-wrap: wrap;
            }
            .cucarda-saldo-ingrediente .cucarda-actions {
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .cucarda-saldo-ingrediente button {
                border: 1px solid #d97706;
                background: #ffffff;
                color: #92400e;
                border-radius: 4px;
                padding: 2px 6px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
            }
            .cucarda-saldo-ingrediente button:hover {
                background: #fde68a;
            }
            #modal-saldo-ingrediente-overlay {
                position: fixed;
                inset: 0;
                background: rgba(15, 23, 42, 0.65);
                z-index: 99999;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 16px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            #modal-saldo-ingrediente-card {
                background: #ffffff;
                width: 100%;
                max-width: 780px;
                max-height: 92vh;
                border-radius: 12px;
                box-shadow: 0 20px 45px rgba(0, 0, 0, 0.3);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                border: 2px solid #f59e0b;
            }
            .msi-header {
                background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
                padding: 14px 20px;
                border-bottom: 1px solid #fde68a;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .msi-header h3 {
                margin: 0;
                font-size: 17px;
                color: #92400e;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .msi-body {
                padding: 16px 20px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 14px;
            }
            .msi-section {
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 12px 14px;
                background: #f8fafc;
            }
            .msi-section-title {
                font-size: 12px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.4px;
                color: #475569;
                margin-bottom: 8px;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .msi-cable-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                border-radius: 6px;
                border: 1px solid #cbd5e1;
                background: #ffffff;
                cursor: pointer;
                margin-bottom: 6px;
                transition: all 0.15s;
            }
            .msi-cable-item:hover {
                border-color: #f59e0b;
                background: #fffbeb;
            }
            .msi-cable-item.selected {
                border: 2px solid #d97706;
                background: #fef3c7;
            }
            .msi-sector-pills {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                margin-top: 8px;
            }
            .msi-sector-pill {
                border: 1px solid #cbd5e1;
                background: #ffffff;
                color: #334155;
                border-radius: 999px;
                padding: 3px 10px;
                font-size: 11.5px;
                font-weight: 600;
                cursor: pointer;
            }
            .msi-sector-pill.active {
                background: #0284c7;
                color: #ffffff;
                border-color: #0369a1;
            }
            .msi-ing-list {
                max-height: 155px;
                overflow-y: auto;
                margin-top: 8px;
                border: 1px solid #e2e8f0;
                border-radius: 6px;
                background: #ffffff;
            }
            .msi-ing-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 7px 10px;
                border-bottom: 1px solid #f1f5f9;
                cursor: pointer;
                font-size: 12.5px;
            }
            .msi-ing-row:hover {
                background: #f0f9ff;
            }
            .msi-ing-row.selected {
                background: #fef3c7;
                font-weight: 700;
            }
            .msi-calc-box {
                background: #fffbeb;
                border: 1.5px solid #f59e0b;
                border-radius: 8px;
                padding: 12px 14px;
            }
            .msi-footer {
                padding: 12px 20px;
                background: #f8fafc;
                border-top: 1px solid #e2e8f0;
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 10px;
                flex-wrap: wrap;
            }
            .msi-btn {
                padding: 9px 15px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                border: 1px solid transparent;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .msi-btn-cancel {
                background: #ffffff;
                border-color: #cbd5e1;
                color: #475569;
            }
            .msi-btn-apply {
                background: #0284c7;
                color: #ffffff;
            }
            .msi-btn-apply:hover {
                background: #0369a1;
            }
            .msi-btn-print {
                background: #d97706;
                color: #ffffff;
            }
            .msi-btn-print:hover {
                background: #b45309;
            }
        `;
        document.head.appendChild(style);

        const overlay = document.createElement('div');
        overlay.id = 'modal-saldo-ingrediente-overlay';
        overlay.innerHTML = `
            <div id="modal-saldo-ingrediente-card" role="dialog" aria-modal="true">
                <div class="msi-header">
                    <h3>⚖️ Cargar Saldo desde Ingrediente (Venta Fraccionada)</h3>
                    <button type="button" id="msi-close-btn" style="background:none;border:none;font-size:22px;cursor:pointer;color:#92400e;line-height:1;">&times;</button>
                </div>
                <div class="msi-body">
                    <!-- Info del Artículo Comercial -->
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;background:#f1f5f9;padding:10px 14px;border-radius:8px;border-left:4px solid #0284c7;">
                        <div style="flex:1;">
                            <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Artículo Comercial en Presupuesto</div>
                            <div id="msi-art-nombre" style="font-size:14.5px;font-weight:700;color:#0f172a;margin-top:2px;">-</div>
                            <div id="msi-art-codigo" style="font-size:11.5px;color:#475569;font-family:monospace;">-</div>
                        </div>
                        <div style="text-align:right;">
                            <label style="font-size:11px;color:#475569;font-weight:700;display:block;">Kilos x Unidad Comercial</label>
                            <div style="display:flex;align-items:center;gap:4px;margin-top:3px;">
                                <input type="number" id="msi-kilos-unidad" step="0.001" min="0.001" style="width:85px;padding:5px 7px;border:1px solid #cbd5e1;border-radius:5px;font-weight:700;text-align:right;font-size:13.5px;">
                                <span style="font-size:12px;font-weight:700;color:#334155;">KG</span>
                            </div>
                        </div>
                    </div>

                    <!-- PRIORIDAD 1: Cable Artículo <-> Ingrediente -->
                    <div class="msi-section" id="msi-cable-section">
                        <div class="msi-section-title">
                            <span>🔗 1. Ingrediente Vinculado al Artículo ("Cable" Automático)</span>
                            <span id="msi-cable-status" style="font-size:11px;font-weight:600;color:#0284c7;">Buscando vínculo...</span>
                        </div>
                        <div id="msi-cable-list"></div>
                    </div>

                    <!-- PRIORIDAD 2 Y 3: Escáner y Buscador Manual -->
                    <div class="msi-section">
                        <div class="msi-section-title">
                            <span>📷 2. Escanear Código de Barra / 🔍 3. Buscar Ingrediente Manual o por Sector</span>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:10px;">
                            <div>
                                <input type="text" id="msi-scanner-input" placeholder="📷 Escanear código de ingrediente + Enter..." autocomplete="off"
                                    style="width:100%;padding:7px 10px;border:1.5px solid #0284c7;border-radius:6px;font-size:12.5px;background:#f0f9ff;">
                            </div>
                            <div>
                                <input type="text" id="msi-search-input" placeholder="🔍 Buscar por palabras (ej: datil israel)..." autocomplete="off"
                                    style="width:100%;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:12.5px;">
                            </div>
                        </div>
                        <div class="msi-sector-pills" id="msi-sector-pills"></div>
                        <div class="msi-ing-list" id="msi-ing-list"></div>
                    </div>

                    <!-- CALCULADORA REGLA DE 3 SIMPLE -->
                    <div class="msi-calc-box">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
                            <div>
                                <span style="font-size:11.5px;font-weight:700;color:#92400e;text-transform:uppercase;">Ingrediente a Descontar:</span>
                                <span id="msi-selected-ing-label" style="font-size:13.5px;font-weight:800;color:#78350f;margin-left:6px;">Ninguno seleccionado</span>
                            </div>
                            <button type="button" id="msi-btn-usar-todo-stock" style="display:none;background:#fef3c7;border:1px solid #d97706;color:#92400e;padding:4px 9px;border-radius:5px;font-size:11.5px;font-weight:700;cursor:pointer;">
                                ⚡ Usar todo el stock disponible
                            </button>
                        </div>

                        <div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px;align-items:end;">
                            <div>
                                <label style="font-size:11.5px;font-weight:700;color:#78350f;display:block;margin-bottom:4px;">
                                    Peso Real del Saldo a Entregar:
                                </label>
                                <div style="display:flex;gap:5px;">
                                    <input type="number" id="msi-peso-saldo-input" step="0.001" min="0.001" placeholder="Ej: 1.800"
                                        style="flex:1;padding:7px 10px;border:2px solid #d97706;border-radius:6px;font-size:15px;font-weight:800;color:#0f172a;">
                                    <button type="button" id="msi-unit-kg" style="padding:6px 10px;border-radius:6px;border:1px solid #d97706;background:#d97706;color:#fff;font-weight:700;cursor:pointer;font-size:12px;">KG</button>
                                    <button type="button" id="msi-unit-gr" style="padding:6px 10px;border-radius:6px;border:1px solid #d97706;background:#fff;color:#92400e;font-weight:700;cursor:pointer;font-size:12px;">GR</button>
                                </div>
                            </div>

                            <div style="background:#ffffff;padding:8px 12px;border-radius:6px;border:1px solid #fde68a;text-align:center;">
                                <div style="font-size:10.5px;color:#64748b;font-weight:700;text-transform:uppercase;">Cantidad Equivalente (Factura)</div>
                                <div id="msi-preview-cantidad" style="font-size:18px;font-weight:800;color:#0284c7;margin-top:2px;">0.00 u.</div>
                                <div id="msi-preview-formula" style="font-size:10.5px;color:#64748b;">-</div>
                            </div>

                            <div style="background:#ffffff;padding:8px 12px;border-radius:6px;border:1px solid #fde68a;text-align:center;">
                                <div style="font-size:10.5px;color:#64748b;font-weight:700;text-transform:uppercase;">Subtotal Estimado c/IVA</div>
                                <div id="msi-preview-subtotal" style="font-size:16px;font-weight:800;color:#15803d;margin-top:2px;">$ 0,00</div>
                                <div style="font-size:10.5px;color:#64748b;">Proporcional exacto</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="msi-footer">
                    <button type="button" class="msi-btn msi-btn-cancel" id="msi-cancel-btn">Cancelar</button>
                    <button type="button" class="msi-btn msi-btn-apply" id="msi-apply-btn">✅ Aplicar Saldo al Renglón</button>
                    <button type="button" class="msi-btn msi-btn-print" id="msi-apply-print-btn">🖨️ Aplicar e Imprimir Etiqueta Zebra</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Eventos del modal
        document.getElementById('msi-close-btn').addEventListener('click', cerrarModal);
        document.getElementById('msi-cancel-btn').addEventListener('click', cerrarModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cerrarModal();
        });

        document.getElementById('msi-kilos-unidad').addEventListener('input', recalcularReglaDeTres);
        document.getElementById('msi-peso-saldo-input').addEventListener('input', recalcularReglaDeTres);

        document.getElementById('msi-unit-kg').addEventListener('click', () => cambiarUnidad('KG'));
        document.getElementById('msi-unit-gr').addEventListener('click', () => cambiarUnidad('GR'));

        document.getElementById('msi-btn-usar-todo-stock').addEventListener('click', () => {
            if (!selectedIngrediente) return;
            const stockKg = Number(selectedIngrediente.stock_actual) || 0;
            if (stockKg <= 0) {
                alert('El ingrediente seleccionado figura con stock 0. Podés ingresar manualmente el peso físico que pesaste en balanza.');
                return;
            }
            cambiarUnidad('KG');
            const inputPeso = document.getElementById('msi-peso-saldo-input');
            inputPeso.value = Number(stockKg.toFixed(3));
            recalcularReglaDeTres();
        });

        // Escáner de código de barras (Prioridad 2)
        document.getElementById('msi-scanner-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const code = e.target.value.trim();
                if (!code) return;
                const found = cacheIngredientes.find(i =>
                    String(i.codigo || '').trim().toLowerCase() === code.toLowerCase() ||
                    String(i.id) === code
                );
                if (found) {
                    seleccionarIngredienteModal(found);
                    e.target.value = '';
                    document.getElementById('msi-peso-saldo-input').focus();
                } else {
                    // Si no coincide exacto por código, volcamos al buscador manual
                    document.getElementById('msi-search-input').value = code;
                    renderListaIngredientesManual();
                }
            }
        });

        // Buscador manual (Prioridad 3 - LAMDA Universal Search)
        document.getElementById('msi-search-input').addEventListener('input', () => {
            renderListaIngredientesManual();
        });

        document.getElementById('msi-apply-btn').addEventListener('click', () => {
            aplicarSaldoAlRenglon(false);
        });

        document.getElementById('msi-apply-print-btn').addEventListener('click', () => {
            aplicarSaldoAlRenglon(true);
        });
    }

    function cambiarUnidad(nuevaUnidad) {
        if (unidadIngreso === nuevaUnidad) return;
        const input = document.getElementById('msi-peso-saldo-input');
        const valActual = parseFloat(input.value);
        if (Number.isFinite(valActual) && valActual > 0) {
            if (nuevaUnidad === 'GR' && unidadIngreso === 'KG') {
                input.value = Math.round(valActual * 1000);
            } else if (nuevaUnidad === 'KG' && unidadIngreso === 'GR') {
                input.value = Number((valActual / 1000).toFixed(3));
            }
        }
        unidadIngreso = nuevaUnidad;
        const btnKg = document.getElementById('msi-unit-kg');
        const btnGr = document.getElementById('msi-unit-gr');
        if (unidadIngreso === 'KG') {
            btnKg.style.background = '#d97706';
            btnKg.style.color = '#ffffff';
            btnGr.style.background = '#ffffff';
            btnGr.style.color = '#92400e';
            input.step = '0.001';
            input.placeholder = 'Ej: 1.800';
        } else {
            btnGr.style.background = '#d97706';
            btnGr.style.color = '#ffffff';
            btnKg.style.background = '#ffffff';
            btnKg.style.color = '#92400e';
            input.step = '1';
            input.placeholder = 'Ej: 1800';
        }
        recalcularReglaDeTres();
    }

    function obtenerKilosSaldoActual() {
        const raw = parseFloat(document.getElementById('msi-peso-saldo-input')?.value);
        if (!Number.isFinite(raw) || raw <= 0) return 0;
        return unidadIngreso === 'GR' ? (raw / 1000) : raw;
    }

    function recalcularReglaDeTres() {
        const kilosUnidad = parseFloat(document.getElementById('msi-kilos-unidad')?.value) || 1;
        const kilosSaldo = obtenerKilosSaldoActual();
        const cantEquiv = kilosUnidad > 0 ? (kilosSaldo / kilosUnidad) : 0;

        // Redondeo a 3 decimales para precisión comercial (ej: 1.8 / 5 = 0.36)
        const cantRedondeada = Math.round(cantEquiv * 1000) / 1000;
        const subtotalEstimado = cantRedondeada * (currentArticuloInfo.precio_unitario_con_iva || 0);

        const elCant = document.getElementById('msi-preview-cantidad');
        const elForm = document.getElementById('msi-preview-formula');
        const elSub = document.getElementById('msi-preview-subtotal');

        if (elCant) elCant.textContent = `${cantRedondeada} u.`;
        if (elForm) elForm.textContent = `${kilosSaldo.toFixed(3)} kg ÷ ${kilosUnidad} kg/u`;
        if (elSub) {
            elSub.textContent = new Intl.NumberFormat('es-AR', {
                style: 'currency',
                currency: 'ARS',
                minimumFractionDigits: 2
            }).format(subtotalEstimado);
        }
    }

    function seleccionarIngredienteModal(ing) {
        selectedIngrediente = ing;
        const label = document.getElementById('msi-selected-ing-label');
        const btnTodo = document.getElementById('msi-btn-usar-todo-stock');
        if (ing) {
            const stockNum = Number(ing.stock_actual) || 0;
            const sectorTxt = ing.sector_letra ? ` [Sector ${ing.sector_letra}]` : '';
            label.textContent = `${ing.nombre} (${ing.codigo || 'S/C'})${sectorTxt} — Stock: ${stockNum.toFixed(3)} ${ing.unidad_medida || 'KG'}`;
            if (btnTodo) {
                btnTodo.style.display = 'inline-block';
                btnTodo.textContent = `⚡ Usar stock actual (${stockNum.toFixed(3)} kg)`;
            }
            // Si el campo de peso está vacío y el stock es > 0, pre-cargarlo para ahorrarle tipeo al operador
            const inputPeso = document.getElementById('msi-peso-saldo-input');
            if (inputPeso && (!inputPeso.value || Number(inputPeso.value) <= 0) && stockNum > 0) {
                cambiarUnidad('KG');
                inputPeso.value = Number(stockNum.toFixed(3));
            }
        } else {
            label.textContent = 'Ninguno seleccionado';
            if (btnTodo) btnTodo.style.display = 'none';
        }

        // Actualizar clases .selected en cable y lista
        document.querySelectorAll('.msi-cable-item, .msi-ing-row').forEach(el => {
            const idEl = Number(el.dataset.ingId);
            if (ing && idEl === Number(ing.id)) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });

        recalcularReglaDeTres();
    }

    function renderPillsSectores() {
        const container = document.getElementById('msi-sector-pills');
        if (!container) return;
        const sectoresSet = new Set();
        cacheIngredientes.forEach(i => {
            if (i.sector_letra && String(i.sector_letra).trim()) {
                sectoresSet.add(String(i.sector_letra).trim().toUpperCase());
            }
        });
        const sectores = Array.from(sectoresSet).sort();

        let html = `<button type="button" class="msi-sector-pill ${sectorFiltroActivo === 'TODOS' ? 'active' : ''}" data-sector="TODOS">Todos (${cacheIngredientes.length})</button>`;
        sectores.forEach(sec => {
            html += `<button type="button" class="msi-sector-pill ${sectorFiltroActivo === sec ? 'active' : ''}" data-sector="${sec}">Sector ${sec}</button>`;
        });
        container.innerHTML = html;

        container.querySelectorAll('.msi-sector-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                sectorFiltroActivo = btn.dataset.sector;
                renderPillsSectores();
                renderListaIngredientesManual();
            });
        });
    }

    function renderListaIngredientesManual() {
        const listEl = document.getElementById('msi-ing-list');
        if (!listEl) return;

        const rawQuery = (document.getElementById('msi-search-input')?.value || '').toLowerCase().trim();
        const terminos = rawQuery ? rawQuery.split(/\s+/).filter(Boolean) : [];

        const filtrados = cacheIngredientes.filter(ing => {
            if (sectorFiltroActivo !== 'TODOS') {
                if (String(ing.sector_letra || '').trim().toUpperCase() !== sectorFiltroActivo) {
                    return false;
                }
            }
            if (terminos.length === 0) return true;
            const bolsa = obtenerTextoBusquedaIngrediente(ing);
            return terminos.every(t => bolsa.includes(t));
        });

        if (filtrados.length === 0) {
            listEl.innerHTML = `<div style="padding:12px;text-align:center;color:#64748b;font-size:12px;">No se encontraron ingredientes con ese criterio.</div>`;
            return;
        }

        listEl.innerHTML = filtrados.slice(0, 60).map(ing => {
            const isSel = selectedIngrediente && Number(selectedIngrediente.id) === Number(ing.id);
            const stockNum = Number(ing.stock_actual) || 0;
            const badgeColor = stockNum > 0 ? '#15803d' : '#dc2626';
            const sectorBadge = ing.sector_letra
                ? `<span style="background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:4px;font-size:10.5px;font-weight:700;margin-left:6px;">Sec ${ing.sector_letra}</span>`
                : '';
            return `
                <div class="msi-ing-row ${isSel ? 'selected' : ''}" data-ing-id="${ing.id}">
                    <div>
                        <span style="font-family:monospace;color:#475569;font-size:11.5px;">[${ing.codigo || ing.id}]</span>
                        <span style="margin-left:4px;color:#0f172a;">${ing.nombre}</span>
                        ${sectorBadge}
                    </div>
                    <div style="font-weight:700;color:${badgeColor};">
                        ${stockNum.toFixed(3)} ${ing.unidad_medida || 'KG'}
                    </div>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.msi-ing-row').forEach(rowEl => {
            rowEl.addEventListener('click', () => {
                const id = Number(rowEl.dataset.ingId);
                const found = cacheIngredientes.find(i => Number(i.id) === id);
                if (found) seleccionarIngredienteModal(found);
            });
        });
    }

    async function cargarDatosModal(codigo, descripcion, preselectedId, preselectedKilos) {
        const cableList = document.getElementById('msi-cable-list');
        const cableStatus = document.getElementById('msi-cable-status');
        cableList.innerHTML = `<div style="font-size:12px;color:#64748b;padding:6px;">Consultando vínculo Artículo ↔ Ingrediente...</div>`;

        try {
            const [resCable, resIngs] = await Promise.all([
                fetch(`/api/presupuestos/saldo-ingrediente/cable?codigo=${encodeURIComponent(codigo)}&descripcion=${encodeURIComponent(descripcion)}`).then(r => r.json()),
                fetch(`/api/presupuestos/saldo-ingrediente/ingredientes`).then(r => r.json())
            ]);

            if (resIngs && resIngs.success && Array.isArray(resIngs.data)) {
                cacheIngredientes = resIngs.data;
            }

            if (resCable && resCable.success && resCable.articulo) {
                currentArticuloInfo.kilos_unidad = Number(resCable.articulo.kilos_unidad) || 1;
                if (resCable.articulo.codigo_barras) {
                    currentArticuloInfo.codigo_barras = resCable.articulo.codigo_barras;
                }
                const inputKilosUnidad = document.getElementById('msi-kilos-unidad');
                if (inputKilosUnidad) inputKilosUnidad.value = currentArticuloInfo.kilos_unidad;
            }

            const vinculados = (resCable && Array.isArray(resCable.ingredientes_vinculados))
                ? resCable.ingredientes_vinculados
                : [];

            if (vinculados.length > 0) {
                cableStatus.textContent = `${vinculados.length} ingrediente(s) vinculado(s)`;
                cableStatus.style.color = '#15803d';
                cableList.innerHTML = vinculados.map(v => {
                    const stockNum = Number(v.stock_actual) || 0;
                    const secTxt = v.sector_letra ? ` · Sector ${v.sector_letra}` : '';
                    return `
                        <div class="msi-cable-item" data-ing-id="${v.id}">
                            <div>
                                <div style="font-weight:700;color:#0f172a;font-size:13.5px;">
                                    ✅ ${v.nombre} <span style="font-family:monospace;font-size:11.5px;color:#475569;">(${v.codigo || v.id})</span>
                                </div>
                                <div style="font-size:11px;color:#0369a1;font-weight:600;margin-top:2px;">
                                    🔗 ${v.origen_cable}${secTxt}
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:11px;color:#64748b;">Stock en Ingredientes</div>
                                <div style="font-size:14px;font-weight:800;color:${stockNum > 0 ? '#15803d' : '#dc2626'};">
                                    ${stockNum.toFixed(3)} ${v.unidad_medida || 'KG'}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                cableList.querySelectorAll('.msi-cable-item').forEach(el => {
                    el.addEventListener('click', () => {
                        const id = Number(el.dataset.ingId);
                        const ingObj = vinculados.find(x => Number(x.id) === id) || cacheIngredientes.find(x => Number(x.id) === id);
                        if (ingObj) seleccionarIngredienteModal(ingObj);
                    });
                });
            } else {
                cableStatus.textContent = 'Sin vínculo directo (use escáner o buscador manual)';
                cableStatus.style.color = '#d97706';
                cableList.innerHTML = `
                    <div style="font-size:12px;color:#78350f;background:#fffbeb;padding:8px 10px;border-radius:6px;border:1px dashed #f59e0b;">
                        Este artículo no tiene un ingrediente vinculado automáticamente. Podés escanear el código de barras del ingrediente o buscarlo abajo por nombre o sector.
                    </div>
                `;
            }

            renderPillsSectores();
            renderListaIngredientesManual();

            // Pre-selección inteligente:
            // 1. Si la fila ya tenía un ingrediente_id_saldo, usarlo
            // 2. Si no, usar el primer ingrediente del "Cable" automático
            if (preselectedId) {
                const prev = vinculados.find(x => Number(x.id) === Number(preselectedId))
                    || cacheIngredientes.find(x => Number(x.id) === Number(preselectedId));
                if (prev) seleccionarIngredienteModal(prev);
            } else if (vinculados.length > 0) {
                seleccionarIngredienteModal(vinculados[0]);
            }

            if (preselectedKilos && Number(preselectedKilos) > 0) {
                cambiarUnidad('KG');
                document.getElementById('msi-peso-saldo-input').value = Number(Number(preselectedKilos).toFixed(3));
            }

            recalcularReglaDeTres();
        } catch (err) {
            console.error('❌ [SALDO-INGREDIENTE] Error cargando modal:', err);
            cableStatus.textContent = 'Error al consultar';
        }
    }

    function cerrarModal() {
        const overlay = document.getElementById('modal-saldo-ingrediente-overlay');
        if (overlay) overlay.style.display = 'none';
        currentRow = null;
    }

    async function imprimirEtiquetaSaldoIngrediente(payload) {
        try {
            const resp = await fetch('/api/presupuestos/saldo-ingrediente/etiqueta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                throw new Error(data.error || 'Error al imprimir en Zebra');
            }
            if (typeof window.mostrarMensaje === 'function') {
                window.mostrarMensaje('🖨️ Etiqueta de saldo enviada a impresora Zebra', 'success');
            } else if (window.Detalles && typeof window.Detalles.mostrarMensaje === 'function') {
                window.Detalles.mostrarMensaje('🖨️ Etiqueta de saldo enviada a impresora Zebra', 'success');
            }
        } catch (err) {
            console.error('❌ [SALDO-INGREDIENTE] Error imprimiendo etiqueta:', err);
            alert('Se aplicó el saldo al renglón, pero no se pudo conectar con la impresora Zebra: ' + err.message);
        }
    }

    function aplicarSaldoAlRenglon(imprimirZebra) {
        if (!currentRow) return;
        if (!selectedIngrediente) {
            alert('Por favor seleccioná primero el ingrediente del cual se descontará el saldo.');
            return;
        }

        const kilosUnidad = parseFloat(document.getElementById('msi-kilos-unidad')?.value) || 0;
        const kilosSaldo = obtenerKilosSaldoActual();

        if (kilosUnidad <= 0) {
            alert('El peso de la unidad comercial debe ser mayor a 0.');
            return;
        }
        if (kilosSaldo <= 0) {
            alert('Ingresá la cantidad de kilos o gramos reales del saldo de ingrediente.');
            return;
        }

        // Regla de 3 simple: Kilos Saldo / Kilos Unidad Comercial
        const cantidadEquivalente = Math.round((kilosSaldo / kilosUnidad) * 1000) / 1000;
        if (cantidadEquivalente <= 0) {
            alert('La cantidad equivalente calculada es demasiado pequeña.');
            return;
        }

        const row = currentRow;

        // Si la fila estaba marcada como "Sin Stock" (🚫), quitarle esa marca porque se cubrirá con el saldo
        if (row.classList.contains('out-of-stock-row')) {
            const btnSinStock = row.querySelector('.btn-sin-stock');
            if (btnSinStock) btnSinStock.click();
        }

        // Actualizar input cantidad
        const cantInput = row.querySelector('input[name*="[cantidad]"]');
        if (cantInput) {
            cantInput.step = 'any';
            cantInput.min = '0.001';
            cantInput.value = String(cantidadEquivalente);
            cantInput.dispatchEvent(new Event('input', { bubbles: true }));
            cantInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Guardar metadata en dataset de la fila
        row.dataset.esSaldoIngrediente = 'true';
        row.dataset.ingredienteIdSaldo = String(selectedIngrediente.id);
        row.dataset.kilosSaldo = String(Number(kilosSaldo.toFixed(3)));
        row.dataset.ingredienteSaldoNombre = String(selectedIngrediente.nombre || '');

        // Renderizar cucarda visual en la fila
        window.renderCucardaSaldoIngrediente(row, {
            es_saldo_ingrediente: true,
            ingrediente_id_saldo: selectedIngrediente.id,
            kilos_saldo: Number(kilosSaldo.toFixed(3)),
            ingrediente_saldo_nombre: selectedIngrediente.nombre,
            cantidad_equivalente: cantidadEquivalente
        });

        // Recalcular totales de la página
        if (typeof window.recalcTotales === 'function') {
            window.recalcTotales();
        } else if (window.Detalles && typeof window.Detalles.recalcTotales === 'function') {
            window.Detalles.recalcTotales();
        }

        const payloadEtiqueta = {
            articulo_nombre: currentArticuloInfo.descripcion,
            codigo_barras: currentArticuloInfo.codigo_barras || currentArticuloInfo.codigo,
            kilos_saldo: Number(kilosSaldo.toFixed(3)),
            cantidad_equivalente: cantidadEquivalente,
            ingrediente_nombre: selectedIngrediente.nombre
        };

        cerrarModal();

        if (imprimirZebra) {
            imprimirEtiquetaSaldoIngrediente(payloadEtiqueta);
        }
    }

    /**
     * Abre el modal de Saldo de Ingrediente para el botón o fila indicada
     */
    window.abrirModalSaldoIngrediente = function (btnOrRow) {
        asegurarEstilosYModal();

        const row = (btnOrRow && btnOrRow.tagName === 'TR')
            ? btnOrRow
            : btnOrRow?.closest('tr');

        if (!row) return;

        const artInput = row.querySelector('input[name*="[articulo]"]');
        const descripcion = (artInput?.value || '').trim();
        if (!descripcion) {
            alert('Primero seleccioná el artículo comercial en el renglón (ej: Dátil de Israel x 5 kg) y luego tocá ⚖️ para cargar el saldo de ingrediente.');
            if (artInput) artInput.focus();
            return;
        }

        const codigo = (
            artInput?.dataset?.codigoBarras ||
            artInput?.dataset?.articuloNumero ||
            descripcion
        ).trim();

        const valor1 = parseFloat(row.querySelector('input[name*="[valor1]"]')?.value) || 0;
        const iva1 = parseFloat(row.querySelector('input[name*="[iva1]"]')?.value) || 0;
        const precioConIva = valor1 * (1 + iva1 / 100);

        currentRow = row;
        selectedIngrediente = null;
        sectorFiltroActivo = 'TODOS';
        unidadIngreso = 'KG';

        currentArticuloInfo = {
            codigo,
            codigo_barras: artInput?.dataset?.codigoBarras || codigo,
            descripcion,
            kilos_unidad: 1,
            precio_unitario_con_iva: precioConIva
        };

        document.getElementById('msi-art-nombre').textContent = descripcion;
        document.getElementById('msi-art-codigo').textContent = `Código: ${codigo}`;
        document.getElementById('msi-kilos-unidad').value = '1';
        document.getElementById('msi-scanner-input').value = '';
        document.getElementById('msi-search-input').value = '';
        document.getElementById('msi-peso-saldo-input').value = '';
        cambiarUnidad('KG');

        const preselectedId = row.dataset.esSaldoIngrediente === 'true' ? row.dataset.ingredienteIdSaldo : null;
        const preselectedKilos = row.dataset.esSaldoIngrediente === 'true' ? row.dataset.kilosSaldo : null;

        const overlay = document.getElementById('modal-saldo-ingrediente-overlay');
        overlay.style.display = 'flex';

        cargarDatosModal(codigo, descripcion, preselectedId, preselectedKilos);
    };

    /**
     * Renderiza o actualiza la "Cucarda" de Saldo de Ingrediente debajo del input de artículo
     */
    window.renderCucardaSaldoIngrediente = function (row, info) {
        if (!row) return;
        asegurarEstilosYModal();

        const firstTd = row.querySelector('td');
        if (!firstTd) return;

        let cucarda = firstTd.querySelector('.cucarda-saldo-ingrediente');
        const btnSaldo = row.querySelector('.btn-saldo-ingrediente');

        if (!info || !info.es_saldo_ingrediente) {
            if (cucarda) cucarda.remove();
            if (btnSaldo) btnSaldo.classList.remove('active-saldo');
            return;
        }

        if (btnSaldo) btnSaldo.classList.add('active-saldo');

        const kilos = Number(info.kilos_saldo) || 0;
        const nombreIng = info.ingrediente_saldo_nombre || `Ingrediente #${info.ingrediente_id_saldo || ''}`;
        const cantInput = row.querySelector('input[name*="[cantidad]"]');
        if (cantInput) {
            cantInput.step = 'any';
            cantInput.min = '0.001';
        }
        const cantEq = info.cantidad_equivalente || parseFloat(cantInput?.value) || 0;

        if (!cucarda) {
            cucarda = document.createElement('div');
            cucarda.className = 'cucarda-saldo-ingrediente';
            firstTd.appendChild(cucarda);
        }

        cucarda.innerHTML = `
            <div>
                <strong>⚖️ Saldo Ingrediente:</strong> ${kilos.toLocaleString('es-AR', { maximumFractionDigits: 3 })} kg de <em>${nombreIng}</em>
                <span style="margin-left:4px;color:#b45309;font-weight:700;">(Eq: ${cantEq} u.)</span>
            </div>
            <div class="cucarda-actions">
                <button type="button" onclick="window.imprimirEtiquetaSaldoDesdeFila(this)" title="Imprimir etiqueta Zebra para este saldo">🖨️ Etiqueta</button>
                <button type="button" onclick="window.abrirModalSaldoIngrediente(this)" title="Modificar kilos o ingrediente">✏️</button>
                <button type="button" onclick="window.quitarSaldoIngredienteFila(this)" title="Quitar modo Saldo de Ingrediente">&times;</button>
            </div>
        `;
    };

    /**
     * Imprime la etiqueta Zebra directamente desde la cucarda de una fila
     */
    window.imprimirEtiquetaSaldoDesdeFila = function (btnOrRow) {
        const row = (btnOrRow && btnOrRow.tagName === 'TR') ? btnOrRow : btnOrRow?.closest('tr');
        if (!row) return;

        const artInput = row.querySelector('input[name*="[articulo]"]');
        const descripcion = (artInput?.value || '').trim();
        const codigo = (artInput?.dataset?.codigoBarras || artInput?.dataset?.articuloNumero || descripcion).trim();
        const kilosSaldo = parseFloat(row.dataset.kilosSaldo) || 0;
        const cantEq = parseFloat(row.querySelector('input[name*="[cantidad]"]')?.value) || 0;
        const ingNombre = row.dataset.ingredienteSaldoNombre || '';

        imprimirEtiquetaSaldoIngrediente({
            articulo_nombre: descripcion,
            codigo_barras: codigo,
            kilos_saldo: kilosSaldo,
            cantidad_equivalente: cantEq,
            ingrediente_nombre: ingNombre
        });
    };

    /**
     * Limpia el modo Saldo de Ingrediente de una fila
     */
    window.quitarSaldoIngredienteFila = function (btnOrRow) {
        const row = (btnOrRow && btnOrRow.tagName === 'TR') ? btnOrRow : btnOrRow?.closest('tr');
        if (!row) return;

        delete row.dataset.esSaldoIngrediente;
        delete row.dataset.ingredienteIdSaldo;
        delete row.dataset.kilosSaldo;
        delete row.dataset.ingredienteSaldoNombre;

        const cucarda = row.querySelector('.cucarda-saldo-ingrediente');
        if (cucarda) cucarda.remove();

        const btnSaldo = row.querySelector('.btn-saldo-ingrediente');
        if (btnSaldo) btnSaldo.classList.remove('active-saldo');

        const cantInput = row.querySelector('input[name*="[cantidad]"]');
        if (cantInput && parseFloat(cantInput.value) < 1) {
            cantInput.value = '1';
            cantInput.dispatchEvent(new Event('input', { bubbles: true }));
            cantInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };
})();
