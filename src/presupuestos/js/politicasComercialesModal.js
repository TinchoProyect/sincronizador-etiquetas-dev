// filepath: src/presupuestos/js/politicasComercialesModal.js
'use strict';

/**
 * Controlador del Modal de Políticas Comerciales y Descuentos Escalonados (LAMDA)
 */
(function () {
    let politicasCargadas = [];
    let listasPrecios = [];
    let politicaActual = null;

    /**
     * Inicializar y abrir modal
     */
    window.abrirModalPoliticasComerciales = async function () {
        const modal = document.getElementById('modal-politicas-comerciales');
        if (!modal) {
            console.error('❌ Modal de políticas comerciales no encontrado en el DOM');
            return;
        }

        modal.style.display = 'flex';

        try {
            // Cargar listas de precios
            const resListas = await fetch('/api/presupuestos/listas-precios');
            const dataListas = await resListas.json();
            listasPrecios = dataListas.success ? dataListas.data : [];

            // Cargar políticas existentes
            await cargarYListarPoliticas();
        } catch (err) {
            console.error('❌ Error al inicializar modal de políticas:', err);
            Swal.fire('Error', 'No se pudieron cargar las políticas comerciales: ' + err.message, 'error');
        }
    };

    /**
     * Alternar maximizado / pantalla completa del modal
     */
    window.toggleMaximizarModalPoliticas = function () {
        const modal = document.getElementById('modal-politicas-comerciales');
        const btn = document.getElementById('btn-maximizar-modal-politicas');
        if (!modal) return;

        const isMax = modal.classList.toggle('is-maximized');
        if (btn) {
            btn.innerHTML = isMax ? '🗗' : '⛶';
            btn.title = isMax ? 'Restaurar tamaño' : 'Maximizar pantalla completa';
        }
    };

    /**
     * Cerrar modal
     */
    window.cerrarModalPoliticasComerciales = function () {
        const modal = document.getElementById('modal-politicas-comerciales');
        if (modal) modal.style.display = 'none';
    };

    // Atajo de teclado: Escape cierra el modal si no hay SweetAlert abierto
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('modal-politicas-comerciales');
            const swal = document.querySelector('.swal2-container');
            if (modal && modal.style.display !== 'none' && !swal) {
                window.cerrarModalPoliticasComerciales();
            }
        }
    });

    // Auto-apertura si se solicita por parámetro en la URL (?politicas=true)
    document.addEventListener('DOMContentLoaded', () => {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('politicas') === 'true' || urlParams.get('modal') === 'politicas') {
            setTimeout(() => {
                if (typeof window.abrirModalPoliticasComerciales === 'function') {
                    window.abrirModalPoliticasComerciales();
                }
            }, 300);
        }
    });

    /**
     * Cargar políticas desde la API y renderizar lista lateral
     */
    async function cargarYListarPoliticas() {
        const container = document.getElementById('politicas-lista-items');
        if (!container) return;

        container.innerHTML = '<div style="padding:15px; text-align:center; color:#64748b;">Cargando políticas...</div>';

        const res = await fetch('/api/presupuestos/politicas');
        const data = await res.json();
        politicasCargadas = data.success ? data.data : [];

        if (politicasCargadas.length === 0) {
            container.innerHTML = '<div style="padding:15px; text-align:center; color:#94a3b8; font-size:0.9em;">No hay políticas configuradas.<br>Haz clic en "+ Nueva Política".</div>';
            nuevaPolitica();
            return;
        }

        container.innerHTML = '';
        politicasCargadas.forEach(p => {
            const item = document.createElement('div');
            item.className = `politica-nav-item ${politicaActual && politicaActual.id === p.id ? 'active' : ''}`;
            item.style.padding = '10px 14px';
            item.style.borderBottom = '1px solid #e2e8f0';
            item.style.cursor = 'pointer';
            item.style.transition = 'background 0.2s';
            item.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong style="font-size:0.95em; color:#1e293b;">${escapeHtml(p.nombre)}</strong>
                    <span style="font-size:0.75em; padding:2px 6px; border-radius:4px; font-weight:600; ${p.activo ? 'background:#dcfce7; color:#15803d;' : 'background:#fee2e2; color:#b91c1c;'}">
                        ${p.activo ? 'Activa' : 'Inactiva'}
                    </span>
                </div>
                <div style="font-size:0.82em; color:#64748b; margin-top:3px;">
                    📋 ${p.aplica_a_todas ? '🌐 <b>Todas las listas (Universal)</b>' : `Listas: <b>${escapeHtml(p.lista_nombre || 'Sin lista')}</b>`}
                </div>
                <div style="font-size:0.78em; color:#0284c7; margin-top:2px;">
                    🎯 ${p.tramos ? p.tramos.length : 0} tramo(s) | 🚫 ${p.excepciones ? p.excepciones.length : 0} excepción(es)
                </div>
            `;
            item.onclick = () => seleccionarPolitica(p.id);
            container.appendChild(item);
        });

        // Si no hay política actual seleccionada, seleccionar la primera
        if (!politicaActual || !politicasCargadas.some(p => p.id === politicaActual.id)) {
            seleccionarPolitica(politicasCargadas[0].id);
        } else {
            seleccionarPolitica(politicaActual.id);
        }
    }

    /**
     * Alternar modo aplica a todas las listas
     */
    window.toggleAplicaTodasPolitica = function (isChecked) {
        const container = document.getElementById('pol-listas-checkboxes-container');
        const quickActions = document.getElementById('pol-quick-actions');
        const hint = document.getElementById('pol-listas-hint');

        if (container) {
            container.style.opacity = isChecked ? '0.35' : '1';
            container.style.pointerEvents = isChecked ? 'none' : 'auto';
        }
        if (quickActions) {
            quickActions.style.display = isChecked ? 'none' : 'flex';
        }
        if (hint) {
            hint.innerHTML = isChecked 
                ? '🌐 <strong>Modo Universal Activo:</strong> Esta bonificación aplica automáticamente a cualquier pedido sin importar la lista de precios asignada al cliente.'
                : '💡 Marque una sola lista para exclusividad, varias para compartir la regla, o active "Todas las listas" para aplicación universal.';
            hint.style.color = isChecked ? '#0369a1' : '#64748b';
        }
    };

    /**
     * Marcar / desmarcar todas las listas
     */
    window.seleccionarTodasLasListas = function (check) {
        document.querySelectorAll('.chk-pol-lista').forEach(el => {
            el.checked = !!check;
            const parent = el.closest('label');
            if (parent) {
                parent.style.border = check ? '1.5px solid #0284c7' : '1px solid #cbd5e1';
                parent.style.color = check ? '#0369a1' : '#334155';
                parent.style.fontWeight = check ? '600' : '500';
            }
        });
    };

    /**
     * Seleccionar una política para ver/editar
     */
    function seleccionarPolitica(id) {
        politicaActual = politicasCargadas.find(p => p.id === id);
        if (!politicaActual) return;

        // Actualizar visual de items seleccionados
        document.querySelectorAll('.politica-nav-item').forEach(el => el.classList.remove('active'));
        // Marcar activo en lista
        const items = document.querySelectorAll('#politicas-lista-items > div');
        const idx = politicasCargadas.findIndex(p => p.id === id);
        if (items[idx]) {
            items[idx].style.background = '#f0f9ff';
            items[idx].style.borderLeft = '3px solid #0284c7';
        }

        renderizarFormularioPolitica(politicaActual);
    }

    /**
     * Preparar formulario para nueva política
     */
    window.nuevaPolitica = function () {
        politicaActual = {
            id: null,
            nombre: 'Nueva Política Comercial',
            descripcion: '',
            aplica_a_todas: false,
            bunker_lista_precio_id: '',
            listas_ids: [],
            listas: [],
            activo: true,
            tipo_calculo: 'ESCALA_DIRECTA',
            aplica_sobre: 'NETO',
            exige_saldo_cero: true,
            tolerancia_saldo: 150.00,
            no_acumulable: true,
            tramos: [
                { monto_minimo: 300000, monto_maximo: null, descuento_porcentaje: 5.0, etiqueta: 'Supera $300.000', orden: 1 }
            ],
            excepciones: []
        };
        renderizarFormularioPolitica(politicaActual);
    };

    /**
     * Renderizar el formulario con los datos de una política
     */
    function renderizarFormularioPolitica(p) {
        document.getElementById('pol-id').value = p.id || '';
        document.getElementById('pol-nombre').value = p.nombre || '';
        document.getElementById('pol-descripcion').value = p.descripcion || '';
        document.getElementById('pol-activo').checked = p.activo !== false;
        document.getElementById('pol-tipo-calculo').value = p.tipo_calculo || 'ESCALA_DIRECTA';
        document.getElementById('pol-aplica-sobre').value = p.aplica_sobre || 'NETO';

        const chkSaldo = document.getElementById('pol-exige-saldo-cero');
        if (chkSaldo) chkSaldo.checked = p.exige_saldo_cero !== false;
        const inputTol = document.getElementById('pol-tolerancia-saldo');
        if (inputTol) inputTol.value = (p.tolerancia_saldo !== undefined && p.tolerancia_saldo !== null) ? parseFloat(p.tolerancia_saldo) : 150;
        const chkNoAcum = document.getElementById('pol-no-acumulable');
        if (chkNoAcum) chkNoAcum.checked = p.no_acumulable !== false;

        // Configurar selector de listas (Universal vs Específicas)
        const chkAplicaTodas = document.getElementById('pol-aplica-todas');
        const isUniversal = p.aplica_a_todas === true;
        if (chkAplicaTodas) chkAplicaTodas.checked = isUniversal;

        const containerListas = document.getElementById('pol-listas-checkboxes-container');
        if (containerListas) {
            containerListas.innerHTML = '';
            
            // Determinar IDs de listas seleccionadas
            let selectedIds = new Set();
            if (Array.isArray(p.listas_ids)) {
                p.listas_ids.forEach(id => selectedIds.add(parseInt(id, 10)));
            } else if (Array.isArray(p.listas)) {
                p.listas.forEach(l => selectedIds.add(parseInt(l.id, 10)));
            } else if (p.bunker_lista_precio_id) {
                selectedIds.add(parseInt(p.bunker_lista_precio_id, 10));
            }

            listasPrecios.forEach(lp => {
                const isSelected = selectedIds.has(parseInt(lp.id, 10));
                const card = document.createElement('label');
                card.style.display = 'flex';
                card.style.alignItems = 'center';
                card.style.gap = '8px';
                card.style.background = 'white';
                card.style.border = isSelected ? '1.5px solid #0284c7' : '1px solid #cbd5e1';
                card.style.padding = '7px 10px';
                card.style.borderRadius = '6px';
                card.style.cursor = 'pointer';
                card.style.fontSize = '0.85em';
                card.style.color = isSelected ? '#0369a1' : '#334155';
                card.style.fontWeight = isSelected ? '600' : '500';
                card.style.transition = 'all 0.15s ease';

                card.innerHTML = `
                    <input type="checkbox" class="chk-pol-lista" value="${lp.id}" ${isSelected ? 'checked' : ''} style="accent-color: #0284c7; width: 15px; height: 15px; cursor: pointer;">
                    <span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(lp.nombre)}">${escapeHtml(lp.nombre)}</span>
                `;

                const chk = card.querySelector('input');
                chk.addEventListener('change', () => {
                    if (chk.checked) {
                        card.style.border = '1.5px solid #0284c7';
                        card.style.color = '#0369a1';
                        card.style.fontWeight = '600';
                    } else {
                        card.style.border = '1px solid #cbd5e1';
                        card.style.color = '#334155';
                        card.style.fontWeight = '500';
                    }
                });

                containerListas.appendChild(card);
            });

            window.toggleAplicaTodasPolitica(isUniversal);
        }

        // Renderizar Tramos
        renderizarTramos(p.tramos || []);

        // Renderizar Excepciones
        renderizarExcepciones(p.excepciones || []);

        // Actualizar simulador
        ejecutarSimulador();

        // Mostrar/ocultar botón eliminar
        const btnDel = document.getElementById('btn-eliminar-politica');
        if (btnDel) btnDel.style.display = p.id ? 'inline-block' : 'none';
    }

    /**
     * Renderizar tabla de tramos
     */
    function renderizarTramos(tramos) {
        const tbody = document.getElementById('tramos-tbody');
        tbody.innerHTML = '';

        if (tramos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:10px;">No hay tramos configurados. Agrega al menos uno.</td></tr>`;
            return;
        }

        tramos.forEach((t, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding:6px;">
                    <div style="display:flex; align-items:center; gap:4px;">
                        <span>$</span>
                        <input type="number" class="form-input tramo-min" value="${t.monto_minimo ?? 0}" step="1000" min="0" style="width:110px; padding:4px 6px; font-size:0.9em;" oninput="window.onPoliticaChanged()">
                    </div>
                </td>
                <td style="padding:6px;">
                    <div style="display:flex; align-items:center; gap:4px;">
                        <span>$</span>
                        <input type="number" class="form-input tramo-max" value="${t.monto_maximo ?? ''}" placeholder="Sin límite" step="1000" min="0" style="width:110px; padding:4px 6px; font-size:0.9em;" oninput="window.onPoliticaChanged()">
                    </div>
                </td>
                <td style="padding:6px;">
                    <div style="display:flex; align-items:center; gap:4px;">
                        <input type="number" class="form-input tramo-desc" value="${t.descuento_porcentaje ?? 0}" step="0.5" min="0" max="100" style="width:70px; padding:4px 6px; font-size:0.9em; font-weight:bold; color:#15803d;" oninput="window.onPoliticaChanged()">
                        <span>%</span>
                    </div>
                </td>
                <td style="padding:6px;">
                    <input type="text" class="form-input tramo-etiqueta" value="${escapeHtml(t.etiqueta || '')}" placeholder="Ej: Mayor a $300k" style="width:100%; padding:4px 6px; font-size:0.9em;" oninput="window.onPoliticaChanged()">
                </td>
                <td style="padding:6px; text-align:center;">
                    <button type="button" class="btn-icon" onclick="window.eliminarTramo(${idx})" title="Eliminar tramo" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1em;">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    /**
     * Agregar fila de tramo
     */
    window.agregarTramo = function () {
        const tramos = recolectarTramos();
        const ultimoMin = tramos.length > 0 ? (tramos[tramos.length - 1].monto_minimo || 0) : 0;
        const nuevoMin = ultimoMin > 0 ? ultimoMin + 150000 : 300000;

        tramos.push({
            monto_minimo: nuevoMin,
            monto_maximo: null,
            descuento_porcentaje: 5.0,
            etiqueta: `Supera $${nuevoMin.toLocaleString('es-AR')}`,
            orden: tramos.length + 1
        });

        renderizarTramos(tramos);
        ejecutarSimulador();
    };

    /**
     * Eliminar tramo
     */
    window.eliminarTramo = function (idx) {
        const tramos = recolectarTramos();
        tramos.splice(idx, 1);
        renderizarTramos(tramos);
        ejecutarSimulador();
    };

    /**
     * Recolectar tramos actuales del DOM
     */
    function recolectarTramos() {
        const rows = document.querySelectorAll('#tramos-tbody tr');
        const tramos = [];
        rows.forEach((row, i) => {
            const minInput = row.querySelector('.tramo-min');
            const maxInput = row.querySelector('.tramo-max');
            const descInput = row.querySelector('.tramo-desc');
            const etiquetaInput = row.querySelector('.tramo-etiqueta');

            if (!minInput) return;

            const min = parseFloat(minInput.value) || 0;
            const maxVal = maxInput.value.trim();
            const max = maxVal !== '' ? parseFloat(maxVal) : null;
            const desc = parseFloat(descInput.value) || 0;
            const etiqueta = etiquetaInput.value.trim();

            tramos.push({
                monto_minimo: min,
                monto_maximo: max,
                descuento_porcentaje: desc,
                etiqueta: etiqueta || `Supera $${min.toLocaleString('es-AR')}`,
                orden: i + 1
            });
        });
        return tramos;
    }

    /**
     * Renderizar excepciones de clientes
     */
    function renderizarExcepciones(excepciones) {
        const tbody = document.getElementById('excepciones-tbody');
        tbody.innerHTML = '';

        if (excepciones.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:10px;">Sin excepciones. Todos los clientes de la lista aplican la política por defecto.</td></tr>`;
            return;
        }

        excepciones.forEach((e, idx) => {
            const tr = document.createElement('tr');
            const nombreMostrar = e.cliente_nombre ? `${e.cliente_id} - ${e.cliente_nombre} ${e.cliente_apellido || ''}` : `Cliente ID ${e.cliente_id}`;
            tr.innerHTML = `
                <td style="padding:6px; font-weight:600; color:#1e293b;">
                    ${escapeHtml(nombreMostrar)}
                    <input type="hidden" class="exc-cliente-id" value="${e.cliente_id}">
                </td>
                <td style="padding:6px;">
                    <select class="form-input exc-tipo" style="padding:4px 6px; font-size:0.85em;" onchange="window.onTipoExcepcionChanged(this, ${idx})">
                        <option value="EXCLUIDO" ${e.tipo_excepcion === 'EXCLUIDO' ? 'selected' : ''}>🚫 Excluido (0% bonificación)</option>
                        <option value="PORCENTAJE_FIJO" ${e.tipo_excepcion === 'PORCENTAJE_FIJO' ? 'selected' : ''}>⭐ Porcentaje Fijo</option>
                    </select>
                </td>
                <td style="padding:6px;">
                    <div style="display:${e.tipo_excepcion === 'PORCENTAJE_FIJO' ? 'flex' : 'none'}; align-items:center; gap:3px;" class="exc-fijo-container">
                        <input type="number" class="form-input exc-fijo" value="${e.descuento_fijo ?? ''}" placeholder="0" step="0.5" min="0" max="100" style="width:65px; padding:4px 6px; font-size:0.85em;">
                        <span>%</span>
                    </div>
                </td>
                <td style="padding:6px;">
                    <input type="text" class="form-input exc-motivo" value="${escapeHtml(e.motivo || '')}" placeholder="Motivo o acuerdo comercial..." style="width:100%; padding:4px 6px; font-size:0.85em;">
                </td>
                <td style="padding:6px; text-align:center;">
                    <button type="button" class="btn-icon" onclick="window.eliminarExcepcion(${idx})" title="Eliminar excepción" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1em;">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    /**
     * Modal para agregar una excepción de cliente con búsqueda
     */
    window.agregarExcepcionModal = async function () {
        const { value: formValues } = await Swal.fire({
            title: 'Agregar Excepción de Cliente',
            html: `
                <div style="text-align:left;">
                    <label style="display:block; font-size:0.85em; font-weight:bold; color:#475569; margin-bottom:4px;">Buscar Cliente (ID o Nombre):</label>
                    <input id="swal-input-cliente" class="swal2-input" placeholder="Ej: 504 o Florencia..." style="margin:0 0 10px 0; width:100%;">
                    <div id="swal-cliente-resultados" style="max-height:140px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:6px; display:none; margin-bottom:10px;"></div>
                    
                    <input type="hidden" id="swal-cliente-id-sel" value="">
                    <input type="hidden" id="swal-cliente-nombre-sel" value="">

                    <label style="display:block; font-size:0.85em; font-weight:bold; color:#475569; margin-bottom:4px;">Tipo de Excepción:</label>
                    <select id="swal-tipo-exc" class="swal2-select" style="margin:0 0 10px 0; width:100%;">
                        <option value="EXCLUIDO">🚫 Excluido de Bonificaciones (0%)</option>
                        <option value="PORCENTAJE_FIJO">⭐ Porcentaje Fijo Acordado</option>
                    </select>

                    <div id="swal-fijo-box" style="display:none; margin-bottom:10px;">
                        <label style="display:block; font-size:0.85em; font-weight:bold; color:#475569; margin-bottom:4px;">Porcentaje Fijo (%):</label>
                        <input type="number" id="swal-desc-fijo" class="swal2-input" placeholder="Ej: 3.5" step="0.5" style="margin:0; width:100%;">
                    </div>

                    <label style="display:block; font-size:0.85em; font-weight:bold; color:#475569; margin-bottom:4px;">Motivo:</label>
                    <input type="text" id="swal-motivo-exc" class="swal2-input" placeholder="Ej: Cuenta corriente especial..." style="margin:0; width:100%;">
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Agregar Excepción',
            cancelButtonText: 'Cancelar',
            didOpen: () => {
                const inputCliente = document.getElementById('swal-input-cliente');
                const boxRes = document.getElementById('swal-cliente-resultados');
                const selTipo = document.getElementById('swal-tipo-exc');
                const fijoBox = document.getElementById('swal-fijo-box');

                selTipo.onchange = () => {
                    fijoBox.style.display = selTipo.value === 'PORCENTAJE_FIJO' ? 'block' : 'none';
                };

                let timer;
                inputCliente.oninput = () => {
                    clearTimeout(timer);
                    const q = inputCliente.value.trim();
                    if (q.length < 2) {
                        boxRes.style.display = 'none';
                        return;
                    }
                    timer = setTimeout(async () => {
                        try {
                            const res = await fetch(`/api/presupuestos/clientes/sugerencias?q=${encodeURIComponent(q)}`);
                            const body = await res.json();
                            const lista = body.data || [];
                            boxRes.innerHTML = '';
                            if (lista.length === 0) {
                                boxRes.innerHTML = '<div style="padding:6px; font-size:0.85em; color:#94a3b8;">No se encontraron clientes</div>';
                            } else {
                                lista.forEach(c => {
                                    const d = document.createElement('div');
                                    d.style.padding = '6px 10px';
                                    d.style.cursor = 'pointer';
                                    d.style.fontSize = '0.85em';
                                    d.style.borderBottom = '1px solid #f1f5f9';
                                    d.innerHTML = `<b>#${c.cliente_id}</b> ${c.nombre} ${c.apellido || ''}`;
                                    d.onclick = () => {
                                        document.getElementById('swal-cliente-id-sel').value = c.cliente_id;
                                        document.getElementById('swal-cliente-nombre-sel').value = `${c.nombre} ${c.apellido || ''}`;
                                        inputCliente.value = `#${c.cliente_id} - ${c.nombre}`;
                                        boxRes.style.display = 'none';
                                    };
                                    boxRes.appendChild(d);
                                });
                            }
                            boxRes.style.display = 'block';
                        } catch (e) {
                            console.error(e);
                        }
                    }, 250);
                };
            },
            preConfirm: () => {
                const cId = document.getElementById('swal-cliente-id-sel').value;
                if (!cId) {
                    Swal.showValidationMessage('Debes seleccionar un cliente de la lista');
                    return false;
                }
                const tipo = document.getElementById('swal-tipo-exc').value;
                const fijo = document.getElementById('swal-desc-fijo').value;
                const motivo = document.getElementById('swal-motivo-exc').value;
                const nombre = document.getElementById('swal-cliente-nombre-sel').value;

                return {
                    cliente_id: parseInt(cId, 10),
                    cliente_nombre: nombre,
                    tipo_excepcion: tipo,
                    descuento_fijo: tipo === 'PORCENTAJE_FIJO' ? parseFloat(fijo) : null,
                    motivo: motivo
                };
            }
        });

        if (formValues) {
            const excepciones = recolectarExcepciones();
            // Evitar duplicados
            if (excepciones.some(e => e.cliente_id === formValues.cliente_id)) {
                Swal.fire('Atención', 'Este cliente ya tiene una excepción cargada', 'warning');
                return;
            }
            excepciones.push(formValues);
            renderizarExcepciones(excepciones);
        }
    };

    window.onTipoExcepcionChanged = function (selectEl, idx) {
        const row = selectEl.closest('tr');
        const fijoBox = row.querySelector('.exc-fijo-container');
        if (fijoBox) {
            fijoBox.style.display = selectEl.value === 'PORCENTAJE_FIJO' ? 'flex' : 'none';
        }
    };

    window.eliminarExcepcion = function (idx) {
        const excepciones = recolectarExcepciones();
        excepciones.splice(idx, 1);
        renderizarExcepciones(excepciones);
    };

    function recolectarExcepciones() {
        const rows = document.querySelectorAll('#excepciones-tbody tr');
        const excepciones = [];
        rows.forEach(row => {
            const idInput = row.querySelector('.exc-cliente-id');
            const tipoSelect = row.querySelector('.exc-tipo');
            const fijoInput = row.querySelector('.exc-fijo');
            const motivoInput = row.querySelector('.exc-motivo');

            if (!idInput) return;

            const cId = parseInt(idInput.value, 10);
            const tipo = tipoSelect.value;
            const fijo = fijoInput ? parseFloat(fijoInput.value) : null;
            const motivo = motivoInput ? motivoInput.value.trim() : null;

            excepciones.push({
                cliente_id: cId,
                tipo_excepcion: tipo,
                descuento_fijo: tipo === 'PORCENTAJE_FIJO' ? fijo : null,
                motivo: motivo
            });
        });
        return excepciones;
    }

    /**
     * Callback para eventos de cambio en inputs
     */
    window.onPoliticaChanged = function () {
        ejecutarSimulador();
    };

    /**
     * Simulador interactivo en tiempo real
     */
    function ejecutarSimulador() {
        const inputMonto = document.getElementById('sim-monto');
        const resEl = document.getElementById('sim-resultado');
        if (!inputMonto || !resEl) return;

        const monto = parseFloat(inputMonto.value) || 0;
        const tramos = recolectarTramos().sort((a, b) => a.monto_minimo - b.monto_minimo);

        if (tramos.length === 0) {
            resEl.innerHTML = `<span style="color:#94a3b8;">Configura al menos un tramo para simular</span>`;
            return;
        }

        let tramoActual = null;
        let proximoTramo = null;

        for (const t of tramos) {
            const min = t.monto_minimo;
            const max = t.monto_maximo !== null ? t.monto_maximo : Infinity;

            if (monto >= min) {
                if (monto <= max || max === Infinity) {
                    tramoActual = t;
                }
            } else if (!proximoTramo && monto < min) {
                proximoTramo = t;
            }
        }

        if (tramoActual) {
            const desc = tramoActual.descuento_porcentaje;
            const ahorro = monto * (desc / 100);
            let extra = '';
            if (proximoTramo) {
                const falta = proximoTramo.monto_minimo - monto;
                extra = ` <span style="color:#64748b; font-size:0.85em;">(Faltan $${falta.toLocaleString('es-AR')} para alcanzar el ${proximoTramo.descuento_porcentaje}%)</span>`;
            }
            resEl.innerHTML = `
                <div style="background:#dcfce7; border:1px solid #86efac; border-radius:6px; padding:6px 12px; color:#15803d; font-weight:600;">
                    🎉 Aplica <b>${desc}% de Descuento</b> (${escapeHtml(tramoActual.etiqueta)}) — Ahorro: <b>$${ahorro.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</b>${extra}
                </div>
            `;
        } else {
            const primer = tramos[0];
            const falta = Math.max(0, primer.monto_minimo - monto);
            resEl.innerHTML = `
                <div style="background:#fef9c3; border:1px solid #fde047; border-radius:6px; padding:6px 12px; color:#854d0e; font-size:0.9em;">
                    💡 No alcanza umbral (0% descuento). <b>Faltan $${falta.toLocaleString('es-AR')}</b> para el primer escalón (${primer.descuento_porcentaje}%).
                </div>
            `;
        }
    }

    /**
     * Guardar política en la base de datos
     */
    window.guardarPoliticaModal = async function () {
        const idVal = document.getElementById('pol-id').value;
        const nombre = document.getElementById('pol-nombre').value.trim();
        const descripcion = document.getElementById('pol-descripcion').value.trim();
        const aplicaATodas = document.getElementById('pol-aplica-todas')?.checked || false;
        const checkedListas = Array.from(document.querySelectorAll('.chk-pol-lista:checked')).map(el => parseInt(el.value, 10));

        const activo = document.getElementById('pol-activo').checked;
        const tipoCalculo = document.getElementById('pol-tipo-calculo').value;
        const aplicaSobre = document.getElementById('pol-aplica-sobre').value;
        const exigeSaldoCero = document.getElementById('pol-exige-saldo-cero')?.checked ?? true;
        const toleranciaSaldo = parseFloat(document.getElementById('pol-tolerancia-saldo')?.value) || 150.00;
        const noAcumulable = document.getElementById('pol-no-acumulable')?.checked ?? true;

        if (!nombre) {
            Swal.fire('Atención', 'El nombre de la política es obligatorio', 'warning');
            return;
        }

        if (!aplicaATodas && checkedListas.length === 0) {
            Swal.fire('Atención', 'Debe seleccionar al menos una lista de precios asignada o activar la opción "Todas las listas (Universal)"', 'warning');
            return;
        }

        const tramos = recolectarTramos();
        if (tramos.length === 0) {
            Swal.fire('Atención', 'Debes configurar al menos un tramo de descuento', 'warning');
            return;
        }

        const excepciones = recolectarExcepciones();

        const payload = {
            id: idVal ? parseInt(idVal, 10) : null,
            nombre: nombre,
            descripcion: descripcion,
            aplica_a_todas: aplicaATodas,
            listas_ids: checkedListas,
            bunker_lista_precio_id: checkedListas.length > 0 ? checkedListas[0] : null,
            activo: activo,
            tipo_calculo: tipoCalculo,
            aplica_sobre: aplicaSobre,
            exige_saldo_cero: exigeSaldoCero,
            tolerancia_saldo: toleranciaSaldo,
            no_acumulable: noAcumulable,
            tramos: tramos,
            excepciones: excepciones
        };

        const btnSave = document.getElementById('btn-guardar-politica');
        btnSave.disabled = true;
        btnSave.textContent = 'Guardando...';

        try {
            const res = await fetch('/api/presupuestos/politicas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Error al guardar la política');
            }

            Swal.fire({
                icon: 'success',
                title: '¡Guardado!',
                text: 'La política comercial ha sido actualizada correctamente.',
                timer: 1800,
                showConfirmButton: false
            });

            politicaActual = data.data;
            await cargarYListarPoliticas();
        } catch (err) {
            console.error('❌ Error guardando política:', err);
            Swal.fire('Error', err.message, 'error');
        } finally {
            btnSave.disabled = false;
            btnSave.textContent = '💾 Guardar Política';
        }
    };

    /**
     * Eliminar política actual
     */
    window.eliminarPoliticaModal = async function () {
        if (!politicaActual || !politicaActual.id) {
            Swal.fire('Atención', 'No hay ninguna política seleccionada para eliminar.', 'warning');
            return;
        }

        const confirm = await Swal.fire({
            title: '¿Eliminar política comercial?',
            html: `Se eliminará permanentemente la política <b>"${escapeHtml(politicaActual.nombre)}"</b> junto con todas sus escalas y excepciones.<br><br><span style="color:#dc2626; font-size:0.9em; font-weight:600;">Esta acción no se puede deshacer.</span>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            confirmButtonText: '🗑️ Sí, eliminar política',
            cancelButtonText: 'Cancelar'
        });

        if (!confirm.isConfirmed) return;

        try {
            const res = await fetch(`/api/presupuestos/politicas/${politicaActual.id}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'No se pudo eliminar la política');

            await Swal.fire({
                icon: 'success',
                title: '¡Política Eliminada!',
                text: 'La política comercial ha sido removida con éxito.',
                timer: 1800,
                showConfirmButton: false
            });

            politicaActual = null;
            await cargarYListarPoliticas();
        } catch (err) {
            console.error('❌ Error al eliminar política:', err);
            Swal.fire('Error', 'No se pudo eliminar la política: ' + err.message, 'error');
        }
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

})();
