/**
 * ============================================================================
 * INTEGRACIÓN EN ÁRBOL DE NODOS BARRIALES EN EL CIRCUITO TRADICIONAL DE LAMDA
 * ============================================================================
 * Sin paneles paralelos ni salto de ventanas: toda la validación, impresión
 * de remito, etiquetas térmicas Zebra por vecino, QR Maestro de Canasto y
 * chequeo operan directamente dentro de los acordeones habituales de
 * produccion.html (1. Imprimir -> 2. Armar Pedido -> 3. Pedido Listo -> 4. Retira).
 */

(function () {
    let estadoCircuitoNodos = {
        canastos: [],
        resumen_deposito: null
    };

    function fmtMoneda(val) {
        return '$' + Math.round(Number(val || 0)).toLocaleString('es-AR');
    }

    async function cargarEstadoCircuitoNodos() {
        try {
            // Eliminar cualquier banner superior paralelo residual si existiera en caché DOM
            const oldPanel = document.getElementById('panel-circuito-nodos-lamda');
            if (oldPanel && oldPanel.parentNode) {
                oldPanel.parentNode.removeChild(oldPanel);
            }

            const res = await fetch('/api/produccion/nodos/circuito-lamda/estado');
            const data = await res.json();
            if (data && data.ok) {
                estadoCircuitoNodos = data;
            }
        } catch (err) {
            console.warn('⚠️ [NodosCircuito] No se pudo cargar el estado de Nodos:', err.message);
        }
    }

    window.irABandejaCanastoLamda = function (seccionId, contenedorId, clienteId) {
        if (typeof window.forzarExpandirSeccion === 'function') {
            window.forzarExpandirSeccion(seccionId);
        }
        setTimeout(() => {
            if (typeof window.abrirAcordeonEnSeccion === 'function') {
                window.abrirAcordeonEnSeccion(clienteId, contenedorId);
            }
            const cont = document.getElementById(seccionId);
            if (cont) cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 250);
    };

    window.enfocarCanastoDesdeHash = async function () {
        const hash = String(window.location.hash || '');
        if (!hash.includes('canasto=')) return;
        const params = new URLSearchParams(hash.replace(/^#/, ''));
        const codigoCanasto = params.get('canasto');
        if (!codigoCanasto) return;

        await cargarEstadoCircuitoNodos();
        const canasto = (estadoCircuitoNodos.canastos || []).find(
            c => String(c.codigo_canasto || '').toUpperCase() === String(codigoCanasto).toUpperCase()
        );
        if (!canasto) return;

        const clienteIdNum = 9000 + Number(canasto.nodo_id);
        const sec = String(canasto.presup_secuencia || canasto.secuencia_operativa_lamda || 'Imprimir').trim();
        let seccionId = 'pedidos-imprimir-section';
        let contenedorId = 'pedidos-imprimir';
        if (sec === 'Armar_Pedido') {
            seccionId = 'pedidos-armar-section';
            contenedorId = 'pedidos-armar';
        } else if (sec === 'Pedido_Listo') {
            seccionId = 'pedidos-listo-section';
            contenedorId = 'pedidos-listo';
        } else if (sec === 'Retira_Deposito') {
            seccionId = 'pedidos-retira-section';
            contenedorId = 'pedidos-retira';
        }

        setTimeout(() => {
            window.irABandejaCanastoLamda(seccionId, contenedorId, clienteIdNum);
        }, 450);
    };

    window.cambiarEtapaCanastoLamda = async function (codigoCanasto, nuevaEtapa) {
        try {
            const res = await fetch(`/api/produccion/nodos/circuito-lamda/canastos/${encodeURIComponent(codigoCanasto)}/etapa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ etapa: nuevaEtapa })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'No se pudo actualizar la etapa del Canasto');
            }

            estadoCircuitoNodos = data;

            if (typeof window.cargarPedidosPorCliente === 'function') {
                await window.cargarPedidosPorCliente();
            }
            if (typeof window.cargarPedidosArticulos === 'function') {
                await window.cargarPedidosArticulos();
            }
            if (typeof window.actualizarResumenFaltantes === 'function') {
                window.actualizarResumenFaltantes();
            }
        } catch (err) {
            alert('Error: ' + err.message);
        }
    };

    function imprimirImagenEtiquetaEnNavegador(titulo, previewDataUrl) {
        if (!previewDataUrl) return;
        const iframeId = 'iframe-impresion-etiqueta-nodo';
        let iframe = document.getElementById(iframeId);
        if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);

        iframe = document.createElement('iframe');
        iframe.id = iframeId;
        iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(`<!DOCTYPE html><html><head><title>${titulo}</title>
            <style>
                @page { margin: 4mm; }
                body { margin: 0; display: flex; justify-content: center; align-items: center; font-family: sans-serif; }
                img { max-width: 100%; height: auto; }
            </style></head>
            <body><img src="${previewDataUrl}" onload="setTimeout(function(){ window.focus(); window.print(); }, 120);" /></body></html>`);
        doc.close();
    }

    function mostrarPreviewEtiquetaZebraSwal(titulo, previewDataUrl, zplCode, onBack) {
        window.__ultimaEtiquetaPreviewNodo = { titulo, previewDataUrl };
        Swal.fire({
            title: `🖨️ ${titulo}`,
            width: '760px',
            html: `
                <div style="text-align: center;">
                    <div style="background: #f1f5f9; padding: 12px; border-radius: 8px; border: 1px solid #cbd5e1; margin-bottom: 10px;">
                        <img src="${previewDataUrl}" alt="Preview Etiqueta Zebra" style="max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.12);" />
                    </div>
                    <div style="margin-bottom: 10px;">
                        <button type="button" onclick="window.__imprimirUltimaEtiquetaPreviewNodo()"
                            style="background: #0f172a; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer;">
                            🖨️ Imprimir Etiqueta Ahora
                        </button>
                    </div>
                    <details style="text-align: left; font-size: 12px; color: #475569;">
                        <summary style="cursor: pointer; font-weight: 700;">Ver código térmico ZPL II generado</summary>
                        <pre style="background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 6px; max-height: 150px; overflow-y: auto; font-size: 11px; margin-top: 6px;">${(zplCode || '').replace(/</g, '&lt;')}</pre>
                    </details>
                </div>
            `,
            confirmButtonColor: '#16a34a',
            confirmButtonText: onBack ? '⬅️ Volver al Canasto' : 'Cerrar'
        }).then(() => {
            if (typeof onBack === 'function') onBack();
        });
    }

    window.__imprimirUltimaEtiquetaPreviewNodo = function () {
        const info = window.__ultimaEtiquetaPreviewNodo;
        if (info && info.previewDataUrl) {
            imprimirImagenEtiquetaEnNavegador(info.titulo || 'Etiqueta Zebra Nodo', info.previewDataUrl);
        }
    };

    /**
     * Modal en el mismo lugar para revisar/etiquetar todas las bolsas de los vecinos + QR Maestro del Canasto
     */
    window.abrirModalBolsasCanastoLamda = async function (codigoCanasto) {
        await cargarEstadoCircuitoNodos();
        const canasto = (estadoCircuitoNodos.canastos || []).find(
            c => c.codigo_canasto === codigoCanasto || String(c.id) === String(codigoCanasto)
        );
        if (!canasto) {
            alert('No se encontró información del Canasto ' + codigoCanasto);
            return;
        }

        const pedidos = canasto.pedidos_vecinos || [];
        const filasPedidos = pedidos.map(p => {
            const itemsTxt = (p.items || []).map(i => `<strong>${i.cantidad}x</strong> ${i.nombre_publico}${i.presentacion_etiqueta ? ` (${i.presentacion_etiqueta})` : ''}`).join(' · ');
            const lista = Boolean(p.bolsa_lista);
            return `
                <div style="border: 1px solid ${lista ? '#86efac' : '#cbd5e1'}; background: ${lista ? '#f0fdf4' : '#ffffff'}; border-radius: 8px; padding: 11px 12px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <div style="text-align: left; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span style="background: #0f172a; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 7px; border-radius: 4px;">#${p.codigo_pedido}</span>
                            <strong style="font-size: 13.5px; color: #0f172a;">👤 ${p.vecino_nombre}</strong>
                            <span style="font-size: 11px; padding: 2px 8px; border-radius: 99px; font-weight: 700; background: ${lista ? '#dcfce7' : '#fef3c7'}; color: ${lista ? '#166534' : '#92400e'};">
                                ${lista ? '✅ Bolsa Etiquetada' : '⏳ Por Etiquetar'}
                            </span>
                        </div>
                        <div style="font-size: 12.5px; color: #334155; margin-top: 4px;">${itemsTxt}</div>
                        <div style="font-size: 11.5px; color: #64748b; margin-top: 2px;">
                            ${p.modalidad_entrega === 'ENVIO_BARRIAL' ? `🛵 Envío Barrial (${p.direccion_entrega})` : `🏪 Retira en ${canasto.nombre_marca}`} · Pago: <strong>${p.medio_pago}</strong>
                        </div>
                    </div>
                    <div>
                        <button type="button" onclick="window.armarYVerEtiquetaVecinoDesdeProduccion(${p.id}, '${canasto.codigo_canasto}', true)"
                            style="background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 7px 11px; font-size: 12px; font-weight: 700; cursor: pointer;">
                            🏷️ ${lista ? 'Ver / Reimprimir Etiqueta' : 'Etiqueta Zebra Vecino'}
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        Swal.fire({
            title: `🏘️ ${canasto.nombre_marca} — Etiquetas del Canasto ${canasto.codigo_canasto}`,
            width: '800px',
            html: `
                <div style="text-align: left; font-size: 13px;">
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <div><strong>Gestor:</strong> ${canasto.gestor_nombre} · <strong>Entrega:</strong> ${canasto.fecha_entrega_label}</div>
                            <div style="color: #475569; margin-top: 2px;">Avance de bolsas vecinales: <strong>${canasto.bolsas_armadas}/${canasto.total_bolsas} etiquetadas</strong></div>
                        </div>
                        <button type="button" onclick="window.verQrMaestroCanastoDesdeProduccion(${canasto.id})"
                            style="background: #0f172a; color: #fff; border: none; border-radius: 6px; padding: 7px 12px; font-size: 12px; font-weight: 700; cursor: pointer;">
                            🖨️ Etiqueta QR Maestro Canasto
                        </button>
                    </div>
                    <div style="max-height: 350px; overflow-y: auto; padding-right: 4px;">
                        ${filasPedidos || '<p>No hay pedidos vecinales en este canasto.</p>'}
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonColor: '#16a34a',
            confirmButtonText: '✅ Etiquetar Todas + Ver QR Maestro',
            cancelButtonText: 'Cerrar'
        }).then(async (result) => {
            if (result.isConfirmed) {
                await window.armarTodasBolsasYVerQrDesdeProduccion(canasto.id, canasto.codigo_canasto);
            }
        });
    };

    window.armarTodasBolsasYVerQrDesdeProduccion = async function (canastoId, codigoCanasto) {
        try {
            const res = await fetch(`/api/produccion/nodos/deposito/canastos/${canastoId}/armar-todo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operario: 'Equipo Producción LAMDA' })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Error al etiquetar todas las bolsas');

            await cargarEstadoCircuitoNodos();
            if (typeof window.cargarPedidosPorCliente === 'function') window.cargarPedidosPorCliente();
            if (data.etiqueta_canasto) {
                mostrarPreviewEtiquetaZebraSwal(
                    `QR Maestro Canasto ${codigoCanasto}`,
                    data.etiqueta_canasto.preview_rollo_base64 || data.etiqueta_canasto.preview_data_url,
                    data.etiqueta_canasto.zpl || data.etiqueta_canasto.zpl_code
                );
            }
        } catch (err) {
            alert('Error al armar bolsas: ' + err.message);
        }
    };

    window.armarYVerEtiquetaVecinoDesdeProduccion = async function (pedidoId, codigoCanasto, volverAlModal = false) {
        try {
            const res = await fetch(`/api/produccion/nodos/deposito/pedidos/${pedidoId}/armar-bolsa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ desmarcar: false, operario: 'Equipo Producción LAMDA' })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Error al generar etiqueta');

            await cargarEstadoCircuitoNodos();
            if (typeof window.cargarPedidosPorCliente === 'function') window.cargarPedidosPorCliente();

            if (data.etiqueta) {
                mostrarPreviewEtiquetaZebraSwal(
                    `Etiqueta Zebra Par — Pedido #${data.codigo_pedido} (${data.vecino_nombre})`,
                    data.etiqueta.preview_rollo_base64 || data.etiqueta.preview_data_url,
                    data.etiqueta.zpl || data.etiqueta.zpl_code,
                    volverAlModal ? () => window.abrirModalBolsasCanastoLamda(codigoCanasto) : null
                );
            }
        } catch (err) {
            alert('Error: ' + err.message);
        }
    };

    window.verQrMaestroCanastoDesdeProduccion = async function (canastoId) {
        try {
            const res = await fetch(`/api/produccion/nodos/deposito/canastos/${canastoId}/etiqueta-qr`);
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo generar QR Maestro');

            mostrarPreviewEtiquetaZebraSwal(
                `Etiqueta QR Maestro — ${data.codigo_canasto || 'Canasto'}`,
                data.preview_rollo_base64 || data.preview_data_url,
                data.zpl || data.zpl_code
            );
        } catch (err) {
            alert('Error: ' + err.message);
        }
    };

    /**
     * Modal de Entrega por QR Maestro desde las bandejas "Pedido Listo" o "Retira por Depósito"
     */
    window.abrirModalEntregaQrCanastoLamda = async function (codigoCanasto) {
        await cargarEstadoCircuitoNodos();
        const canasto = (estadoCircuitoNodos.canastos || []).find(
            c => c.codigo_canasto === codigoCanasto || String(c.id) === String(codigoCanasto)
        );
        if (!canasto) {
            alert('Canasto no encontrado: ' + codigoCanasto);
            return;
        }

        const { value: formValues } = await Swal.fire({
            title: `📲 Entregar Canasto ${canasto.codigo_canasto} al Gestor`,
            width: '620px',
            html: `
                <div style="text-align: left; font-size: 13.5px;">
                    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                        <div><strong>Nodo:</strong> ${canasto.nombre_marca} (Gestor: <strong>${canasto.gestor_nombre}</strong>)</div>
                        <div style="margin-top: 4px;"><strong>Contenido:</strong> ${canasto.total_bolsas} pedidos vecinales (${Number(canasto.total_kilos_lote || 0)} kg)</div>
                        <div style="margin-top: 4px; color: #dc2626;"><strong>Impacto automático en Cuenta Corriente:</strong> Débito por Costo Base LAMDA de <strong>-${fmtMoneda(canasto.total_base_lamda)}</strong></div>
                    </div>
                    <label style="font-weight: 700; display: block; margin-bottom: 4px;">Código QR Maestro escaneado:</label>
                    <input id="swal-qr-canasto" class="swal2-input" style="margin: 0 0 12px 0; width: 100%; font-family: monospace; font-size: 13px;" value="${canasto.qr_maestro_payload || canasto.codigo_canasto}" />
                    <label style="font-weight: 700; display: block; margin-bottom: 4px;">Retirado / Recibido por:</label>
                    <input id="swal-retirado-por" class="swal2-input" style="margin: 0; width: 100%; font-size: 13px;" value="${canasto.gestor_nombre}" />
                </div>
            `,
            showCancelButton: true,
            confirmButtonColor: '#16a34a',
            confirmButtonText: '✅ Confirmar Entrega y Registrar Débito en Cta. Cte.',
            cancelButtonText: 'Cancelar',
            preConfirm: () => ({
                qr_escaneado: document.getElementById('swal-qr-canasto').value,
                retirado_por: document.getElementById('swal-retirado-por').value
            })
        });

        if (formValues) {
            await window.cambiarEtapaCanastoLamda(canasto.codigo_canasto, 'ENTREGADO_GESTOR');
        }
    };

    /**
     * Inyecta el Árbol de Vecinos y sus artículos dentro del modal habitual de Chequeo (#modal-armar-pedido)
     * cuando el operario hace clic en "🔍 Verificar" sobre un Canasto de Nodo Barrial.
     */
    window.inyectarResumenVecinosEnModalChequeo = async function (presupuestoId) {
        const modalBody = document.querySelector('#modal-armar-pedido .modal-body');
        if (!modalBody) return;

        let banner = document.getElementById('banner-chequeo-nodo-barrial');
        if (!String(presupuestoId || '').startsWith('CAN-')) {
            if (banner) banner.style.display = 'none';
            return;
        }

        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'banner-chequeo-nodo-barrial';
            modalBody.insertBefore(banner, modalBody.firstChild);
        }

        await cargarEstadoCircuitoNodos();
        const canasto = (estadoCircuitoNodos.canastos || []).find(c => c.codigo_canasto === presupuestoId);
        if (!canasto) {
            banner.style.display = 'none';
            return;
        }

        const vecinosTreeHtml = (canasto.pedidos_vecinos || []).map(p => {
            const lista = Boolean(p.bolsa_lista);
            const itemsHtml = (p.items || []).map(it =>
                `<span style="display:inline-block; background:#f8fafc; border:1px solid #cbd5e1; border-radius:4px; padding:1px 6px; margin:2px 4px 2px 0; font-size:11.5px; color:#1e293b;">
                    <strong>${it.cantidad}x</strong> ${it.nombre_publico}${it.presentacion_etiqueta ? ` (${it.presentacion_etiqueta})` : ''}
                </span>`
            ).join('');
            return `
                <div style="background:#ffffff; border:1px solid ${lista ? '#86efac' : '#cbd5e1'}; border-left:4px solid #16a34a; border-radius:6px; padding:7px 10px; margin-top:6px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:220px;">
                        <div style="font-size:12.5px; font-weight:700; color:#0f172a;">
                            👤 ${p.vecino_nombre} <span style="color:#15803d;">#${p.codigo_pedido}</span>
                            <span style="font-weight:600; font-size:11px; color:${lista ? '#166534' : '#92400e'}; margin-left:6px;">
                                ${lista ? '✅ Etiquetada' : '⏳ Sin etiqueta'}
                            </span>
                        </div>
                        <div style="margin-top:3px;">${itemsHtml}</div>
                    </div>
                    <button type="button" onclick="window.armarYVerEtiquetaVecinoDesdeProduccion(${p.id}, '${canasto.codigo_canasto}', false)"
                        style="background:#16a34a; color:#fff; border:none; border-radius:5px; padding:5px 9px; font-size:11.5px; font-weight:700; cursor:pointer;">
                        🏷️ Etiqueta Zebra
                    </button>
                </div>
            `;
        }).join('');

        banner.style.cssText = 'display: block; background: #f0fdf4; border: 1.5px solid #16a34a; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;';
        banner.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div>
                    <div style="font-weight: 800; color: #166534; font-size: 13.5px;">
                        🏘️ ${canasto.nombre_marca} — Canasto ${canasto.codigo_canasto} (${(canasto.pedidos_vecinos || []).length} vecinos)
                    </div>
                    <div style="font-size: 12px; color: #15803d; margin-top: 2px;">
                        Verificá abajo los artículos totales del Canasto con escáner o botón OK, e imprimí acá mismo las etiquetas Zebra de cada vecino.
                    </div>
                </div>
                <button type="button" onclick="window.verQrMaestroCanastoDesdeProduccion(${canasto.id})"
                    style="background: #0f172a; color: #fff; border: none; border-radius: 6px; padding: 6px 10px; font-size: 12px; font-weight: 700; cursor: pointer;">
                    🖨️ QR Maestro Canasto
                </button>
            </div>
            <div style="margin-top: 6px;">
                ${vecinosTreeHtml}
            </div>
        `;
    };

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(cargarEstadoCircuitoNodos, 300);
        setTimeout(window.enfocarCanastoDesdeHash, 650);
    });
    window.addEventListener('hashchange', () => {
        window.enfocarCanastoDesdeHash();
    });

    window.recargarCircuitoNodosLamda = cargarEstadoCircuitoNodos;
})();
