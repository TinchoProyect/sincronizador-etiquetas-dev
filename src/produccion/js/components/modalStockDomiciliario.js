// src/produccion/js/components/modalStockDomiciliario.js
// Modales exclusivos y aislados para el Stock Domiciliario de Colaboradores en Gestión de Ingredientes.
// Garantiza 0 escrituras accidentales sobre `public.ingredientes` (Depósito Central LAMDA).

function escHtml(val) {
    return String(val === null || val === undefined ? '' : val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normTxt(str) {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function fmtKg(val, dec = 2) {
    const n = Number(val) || 0;
    const fixed = Math.abs(n) < 0.0005 ? (0).toFixed(dec) : n.toFixed(dec);
    return fixed.replace('.', ',');
}

function fmtConSigno(val, dec = 2) {
    const n = Number(val) || 0;
    if (Math.abs(n) < 0.0005) return (0).toFixed(dec).replace('.', ',');
    return `${n > 0 ? '+' : ''}${n.toFixed(dec).replace('.', ',')}`;
}

function fmtFechaHora(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function badgeTipoMovimiento(tipo) {
    switch (tipo) {
        case 'abastecimiento_deposito':
            return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;font-size:11.5px;font-weight:700;background:#dcfce7;color:#166534;border:1px solid #86efac;">🚚 Retiro Depósito</span>`;
        case 'compra_externa':
            return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;font-size:11.5px;font-weight:700;background:#f3e8ff;color:#6b21a8;border:1px solid #d8b4fe;">🛒 Compra Externa</span>`;
        case 'consumo_produccion':
            return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;font-size:11.5px;font-weight:700;background:#ffedd5;color:#9a3412;border:1px solid #fdba74;">🔥 Consumo Producción</span>`;
        default:
            return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;font-size:11.5px;font-weight:700;background:#e0f2fe;color:#075985;border:1px solid #7dd3fc;">⚖️ Ajuste Domicilio</span>`;
    }
}

let stateDom = {
    usuarioId: null,
    usuarioNombre: '',
    ingredienteId: null,
    ingredienteCodigo: '',
    ingredienteNombre: '',
    unidadMedida: 'Kilo',
    stockEnCasa: 0,
    comprometidoAbiertos: 0,
    carrosAbiertosCount: 0,
    proyectadoPostCoccion: 0,
    stockDepositoCentral: 0,
    tabActiva: 'ajustar',
    articulosAbastecer: [],
    articuloSeleccionado: null,
    cantidadBultos: 1,
    enVuelo: false,
    onRefreshCallback: null
};

export function inicializarModalesStockDomiciliario(onRefreshCallback) {
    stateDom.onRefreshCallback = onRefreshCallback;
    if (document.getElementById('modal-stock-domiciliario-colaborador')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'contenedor-modales-stock-domiciliario';
    wrapper.innerHTML = `
        <style>
            .msd-overlay {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 10080;
                background: rgba(15, 23, 42, 0.62);
                align-items: center;
                justify-content: center;
                padding: 14px;
                box-sizing: border-box;
            }
            .msd-overlay.activo {
                display: flex !important;
            }
            .msd-dialog {
                background: #ffffff;
                border-radius: 14px;
                border: 1px solid #cbd5e1;
                box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.35);
                width: 100%;
                max-height: 92vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
            }
            .msd-tab-btn {
                flex: 1;
                padding: 10px 12px;
                border: 1.5px solid #cbd5e1;
                background: #f8fafc;
                color: #475569;
                font-size: 13px;
                font-weight: 700;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.18s ease;
                text-align: center;
            }
            .msd-tab-btn:hover {
                background: #f1f5f9;
                color: #0f172a;
            }
            .msd-tab-btn.activa-ajustar {
                background: #eff6ff;
                border-color: #2563eb;
                color: #1d4ed8;
                box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
            }
            .msd-tab-btn.activa-compra {
                background: #f5f3ff;
                border-color: #7c3aed;
                color: #6d28d9;
                box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.15);
            }
            .msd-tab-btn.activa-abastecer {
                background: #f0fdf4;
                border-color: #16a34a;
                color: #15803d;
                box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
            }
        </style>

        <!-- MODAL 1: GESTIONAR STOCK DOMICILIARIO (3 PESTAÑAS) -->
        <div id="modal-stock-domiciliario-colaborador" class="msd-overlay" role="dialog" aria-modal="true">
            <div class="msd-dialog" style="max-width: 680px;">
                <div style="padding: 14px 20px; background: #0f172a; color: #f8fafc; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                    <div>
                        <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #38bdf8;" id="msd-header-usuario">🏠 Depósito Domiciliario</div>
                        <h2 style="margin: 2px 0 0 0; font-size: 18px; font-weight: 800; color: #ffffff;" id="msd-header-ingrediente">Gestionar Stock</h2>
                    </div>
                    <button type="button" id="msd-btn-cerrar-gestion" style="background: rgba(255,255,255,0.1); border: none; color: #f8fafc; width: 34px; height: 34px; border-radius: 8px; font-size: 22px; cursor: pointer; line-height: 1;">&times;</button>
                </div>

                <div style="padding: 14px 20px; overflow-y: auto; flex: 1 1 auto; display: flex; flex-direction: column; gap: 12px;">
                    <!-- Resumen en vivo del colaborador + candado de aislamiento -->
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px;">
                        <div>
                            <div style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase;">Stock Físico en Casa</div>
                            <div id="msd-stat-casa" style="font-size: 18px; font-weight: 900; color: #0f172a; margin-top: 2px;">0,00 kg</div>
                        </div>
                        <div style="border-left: 1px solid #cbd5e1; padding-left: 12px;">
                            <div style="font-size: 11px; font-weight: 800; color: #92400e; text-transform: uppercase;" id="msd-stat-comp-label">Comprometido</div>
                            <div id="msd-stat-comp" style="font-size: 18px; font-weight: 900; color: #b45309; margin-top: 2px;">0,00 kg</div>
                        </div>
                        <div style="border-left: 1px solid #cbd5e1; padding-left: 12px;">
                            <div style="font-size: 11px; font-weight: 800; color: #166534; text-transform: uppercase;">Proyectado Post-Cocción</div>
                            <div id="msd-stat-proy" style="font-size: 18px; font-weight: 900; color: #15803d; margin-top: 2px;">0,00 kg</div>
                        </div>
                    </div>

                    <div style="font-size: 12px; color: #334155; background: #f1f5f9; border-left: 4px solid #0284c7; padding: 7px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                        <span>🔒 <strong>Vista aislada del colaborador:</strong> ninguna acción modifica <code>public.ingredientes</code> salvo el retiro explícito de bultos en la pestaña ③.</span>
                        <span id="msd-ref-central" style="font-weight: 700; color: #475569; white-space: nowrap;"></span>
                    </div>

                    <!-- 3 Pestañas Operativas -->
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button type="button" class="msd-tab-btn" data-tab="ajustar">① Ajustar stock en casa</button>
                        <button type="button" class="msd-tab-btn" data-tab="compra">② Compra externa comercio</button>
                        <button type="button" class="msd-tab-btn" data-tab="abastecer">③ Abastecer desde LAMDA</button>
                    </div>

                    <!-- PANEL ①: AJUSTAR STOCK FÍSICO EN CASA -->
                    <div id="msd-panel-ajustar" style="display: none; flex-direction: column; gap: 10px; border: 1.5px solid #bfdbfe; background: #f8fafc; border-radius: 10px; padding: 14px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label for="msd-input-ajuste-real" style="font-weight: 800; font-size: 13.5px; color: #0f172a;">Conteo físico real hoy en casa (<span class="msd-unidad-txt">kg</span>):</label>
                            <button type="button" id="msd-btn-poner-cero" style="padding: 4px 10px; font-size: 12px; font-weight: 700; border-radius: 6px; border: 1px solid #2563eb; background: #eff6ff; color: #1d4ed8; cursor: pointer;">Poner en 0,00</button>
                        </div>
                        <input type="text" inputmode="decimal" id="msd-input-ajuste-real" placeholder="Ej: 0,00 o 10,00" style="width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 17px; font-weight: 800; border: 1.5px solid #2563eb; border-radius: 8px; background: #fff; color: #0f172a;">
                        <div>
                            <label for="msd-input-ajuste-obs" style="font-weight: 700; font-size: 12.5px; color: #475569; display: block; margin-bottom: 4px;">Motivo / Observación:</label>
                            <input type="text" id="msd-input-ajuste-obs" placeholder="Ej: Control físico en domicilio del colaborador" style="width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff;">
                        </div>
                        <div id="msd-preview-ajustar" style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 9px 12px; font-size: 12.5px; color: #1e3a8a; line-height: 1.5;"></div>
                    </div>

                    <!-- PANEL ②: COMPRA EXTERNA EN COMERCIO -->
                    <div id="msd-panel-compra" style="display: none; flex-direction: column; gap: 10px; border: 1.5px solid #ddd6fe; background: #faf5ff; border-radius: 10px; padding: 14px;">
                        <div style="font-size: 12.5px; color: #5b21b6; font-weight: 600;">
                            🛒 Registra mercadería comprada directamente afuera por el colaborador (ej. Aceite de Coco). <strong>No descuenta nada del Depósito Central LAMDA.</strong>
                        </div>
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                <label for="msd-input-compra-cant" style="font-weight: 800; font-size: 13.5px; color: #0f172a;">Cantidad comprada (<span class="msd-unidad-txt">kg</span>) <span style="color:#dc2626;">*</span></label>
                                <button type="button" id="msd-btn-compra-faltante" style="display: none; padding: 4px 10px; font-size: 12px; font-weight: 700; border-radius: 6px; border: 1px solid #7c3aed; background: #ede9fe; color: #5b21b6; cursor: pointer;"></button>
                            </div>
                            <input type="text" inputmode="decimal" id="msd-input-compra-cant" placeholder="Ej: 1,50" style="width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 17px; font-weight: 800; border: 1.5px solid #7c3aed; border-radius: 8px; background: #fff; color: #0f172a;">
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                            <div>
                                <label for="msd-input-compra-comercio" style="font-weight: 700; font-size: 12px; color: #475569; display: block; margin-bottom: 3px;">Comercio / Proveedor (opcional)</label>
                                <input type="text" id="msd-input-compra-comercio" placeholder="Ej: Dietética / Mayorista" style="width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff;">
                            </div>
                            <div>
                                <label for="msd-input-compra-obs" style="font-weight: 700; font-size: 12px; color: #475569; display: block; margin-bottom: 3px;">Comprobante / Nota (opcional)</label>
                                <input type="text" id="msd-input-compra-obs" placeholder="Ej: Ticket / Botella 1,5 L" style="width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff;">
                            </div>
                        </div>
                        <div id="msd-preview-compra" style="background: #f3e8ff; border: 1px solid #c084fc; border-radius: 8px; padding: 9px 12px; font-size: 12.5px; color: #4c1d95; line-height: 1.5;"></div>
                    </div>

                    <!-- PANEL ③: ABASTECER DESDE DEPÓSITO LAMDA -->
                    <div id="msd-panel-abastecer" style="display: none; flex-direction: column; gap: 8px; border: 1.5px solid #bbf7d0; background: #f0fdf4; border-radius: 10px; padding: 12px 14px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <span style="font-size: 12px; font-weight: 800; color: #166534; text-transform: uppercase;">1️⃣ Elegí el bulto / envase que retira del Depósito LAMDA:</span>
                            <input type="text" id="msd-input-buscar-bulto" placeholder="🔍 Filtrar bulto (ej: 5kg, bidón)..." style="width: 230px; padding: 5px 9px; font-size: 12.5px; border: 1px solid #86efac; border-radius: 6px; background: #fff;">
                        </div>
                        <ul id="msd-lista-bultos" style="max-height: 150px; min-height: 75px; overflow-y: auto; margin: 0; padding: 0; list-style: none; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff;"></ul>

                        <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; background: #fff; border: 1px solid #86efac; border-radius: 8px; padding: 8px 12px;">
                            <div>
                                <div style="font-weight: 800; font-size: 13px; color: #0f172a;">2️⃣ Cantidad de envases / bultos a retirar:</div>
                                <div id="msd-bulto-subtexto" style="font-size: 12px; color: #475569;">Seleccioná un bulto arriba</div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div style="display: inline-flex; align-items: center; border: 1.5px solid #16a34a; border-radius: 8px; overflow: hidden; background: #fff;">
                                    <button type="button" id="msd-btn-bulto-menos" style="width: 34px; height: 34px; border: none; background: #dcfce7; color: #166534; font-size: 19px; font-weight: 800; cursor: pointer;">−</button>
                                    <input type="number" id="msd-input-bulto-cant" min="1" step="1" value="1" style="width: 56px; height: 34px; border: none; text-align: center; font-size: 16px; font-weight: 800; color: #0f172a; padding: 0 4px; box-sizing: border-box;">
                                    <button type="button" id="msd-btn-bulto-mas" style="width: 34px; height: 34px; border: none; background: #dcfce7; color: #166534; font-size: 19px; font-weight: 800; cursor: pointer;">+</button>
                                </div>
                                <div style="display: inline-flex; gap: 4px;">
                                    <button type="button" class="msd-preset-bulto" data-cant="1" style="padding: 5px 8px; font-size: 12px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer;">1 u.</button>
                                    <button type="button" class="msd-preset-bulto" data-cant="2" style="padding: 5px 8px; font-size: 12px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer;">2 u.</button>
                                    <button type="button" class="msd-preset-bulto" data-cant="3" style="padding: 5px 8px; font-size: 12px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer;">3 u.</button>
                                </div>
                            </div>
                        </div>

                        <div id="msd-preview-abastecer" style="background: #dcfce7; border: 1px solid #4ade80; border-radius: 8px; padding: 9px 12px; font-size: 12.5px; color: #064e3b; line-height: 1.5;"></div>
                    </div>
                </div>

                <div style="padding: 12px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                    <button type="button" id="msd-btn-ir-kardex" style="padding: 8px 14px; font-size: 13px; font-weight: 700; border-radius: 8px; border: 1px solid #0284c7; background: #e0f2fe; color: #0369a1; cursor: pointer;">🔎 Ver Kardex</button>
                    <div style="display: flex; gap: 10px;">
                        <button type="button" id="msd-btn-cancelar-gestion" style="padding: 9px 16px; font-size: 13.5px; font-weight: 600; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #475569; cursor: pointer;">Cancelar</button>
                        <button type="button" id="msd-btn-confirmar-accion" style="padding: 9px 20px; font-size: 13.5px; font-weight: 800; border-radius: 8px; border: none; background: #2563eb; color: #fff; cursor: pointer;">Guardar Ajuste en Casa</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- MODAL 2: KARDEX DOMICILIARIO Y COMPROMISOS ABIERTOS -->
        <div id="modal-kardex-domiciliario-colaborador" class="msd-overlay" role="dialog" aria-modal="true">
            <div class="msd-dialog" style="max-width: 880px;">
                <div style="padding: 14px 20px; background: #0f172a; color: #f8fafc; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                    <div>
                        <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #38bdf8;" id="mkd-header-usuario">🔎 Kardex Domiciliario</div>
                        <h2 style="margin: 2px 0 0 0; font-size: 18px; font-weight: 800; color: #ffffff;" id="mkd-header-ingrediente">Historial y Compromisos</h2>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <button type="button" id="mkd-btn-abrir-gestion" style="padding: 7px 14px; font-size: 12.5px; font-weight: 800; border-radius: 8px; border: none; background: #3b82f6; color: #fff; cursor: pointer;">✏️ Gestionar Stock</button>
                        <button type="button" id="mkd-btn-cerrar" style="background: rgba(255,255,255,0.1); border: none; color: #f8fafc; width: 34px; height: 34px; border-radius: 8px; font-size: 22px; cursor: pointer; line-height: 1;">&times;</button>
                    </div>
                </div>

                <div style="padding: 16px 20px; overflow-y: auto; flex: 1 1 auto; display: flex; flex-direction: column; gap: 16px;">
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px;">
                            <div style="font-size: 10.5px; font-weight: 800; color: #475569; text-transform: uppercase;">Stock Físico en Casa</div>
                            <div id="mkd-stat-casa" style="font-size: 18px; font-weight: 900; color: #0f172a; margin-top: 3px;">0,00 kg</div>
                        </div>
                        <div style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px; padding: 10px 12px;">
                            <div style="font-size: 10.5px; font-weight: 800; color: #92400e; text-transform: uppercase;" id="mkd-stat-comp-lbl">Comprometido Abiertos</div>
                            <div id="mkd-stat-comp" style="font-size: 18px; font-weight: 900; color: #b45309; margin-top: 3px;">0,00 kg</div>
                        </div>
                        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; padding: 10px 12px;">
                            <div style="font-size: 10.5px; font-weight: 800; color: #166534; text-transform: uppercase;">Proyectado Post-Cocción</div>
                            <div id="mkd-stat-proy" style="font-size: 18px; font-weight: 900; color: #15803d; margin-top: 3px;">0,00 kg</div>
                        </div>
                        <div style="background: #f1f5f9; border: 1px dashed #94a3b8; border-radius: 10px; padding: 10px 12px;">
                            <div style="font-size: 10.5px; font-weight: 800; color: #64748b; text-transform: uppercase;">Depósito Central (Ref.)</div>
                            <div id="mkd-stat-central" style="font-size: 16px; font-weight: 800; color: #475569; margin-top: 3px;">0,00 kg</div>
                        </div>
                    </div>

                    <!-- Carros Externos Abiertos -->
                    <div style="border: 1px solid #fed7aa; background: #fff7ed; border-radius: 10px; padding: 12px 14px;">
                        <div style="font-size: 13px; font-weight: 800; color: #9a3412; margin-bottom: 8px;">🚚 Carros Externos Abiertos que hoy comprometen este ingrediente</div>
                        <div id="mkd-carros-abiertos-container"></div>
                    </div>

                    <!-- Tabla Kardex -->
                    <div style="border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
                        <div style="background: #f8fafc; padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; font-weight: 800; color: #0f172a;">
                            📜 Historial Cronológico de Movimientos (Kardex Domiciliario)
                        </div>
                        <div style="max-height: 320px; overflow-y: auto;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left;">
                                <thead style="position: sticky; top: 0; background: #f1f5f9; z-index: 1;">
                                    <tr style="border-bottom: 1.5px solid #cbd5e1; color: #334155;">
                                        <th style="padding: 9px 12px;">Fecha / Hora</th>
                                        <th style="padding: 9px 12px;">Tipo</th>
                                        <th style="padding: 9px 12px;">Detalle / Referencia</th>
                                        <th style="padding: 9px 12px; text-align: right;">Variación</th>
                                        <th style="padding: 9px 12px; text-align: right;">Saldo en Casa</th>
                                    </tr>
                                </thead>
                                <tbody id="mkd-tabla-kardex-body"></tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div style="padding: 12px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end;">
                    <button type="button" id="mkd-btn-cerrar-footer" style="padding: 8px 18px; font-size: 13.5px; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #334155; cursor: pointer;">Cerrar</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(wrapper);

    // Eventos Modal Gestión
    document.getElementById('msd-btn-cerrar-gestion').onclick = cerrarModalGestion;
    document.getElementById('msd-btn-cancelar-gestion').onclick = cerrarModalGestion;
    document.getElementById('msd-btn-ir-kardex').onclick = () => {
        cerrarModalGestion();
        abrirModalKardexDomiciliario(stateDom.usuarioId, stateDom.ingredienteId, stateDom.usuarioNombre);
    };

    document.querySelectorAll('#modal-stock-domiciliario-colaborador .msd-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => activarPestanaGestion(btn.dataset.tab));
    });

    document.getElementById('msd-btn-poner-cero').addEventListener('click', () => {
        const inp = document.getElementById('msd-input-ajuste-real');
        inp.value = '0';
        actualizarPreviewsGestion();
        inp.focus();
    });

    document.getElementById('msd-input-ajuste-real').addEventListener('input', actualizarPreviewsGestion);
    document.getElementById('msd-input-compra-cant').addEventListener('input', actualizarPreviewsGestion);
    document.getElementById('msd-btn-compra-faltante').addEventListener('click', () => {
        const falt = Math.max(0, Number((stateDom.comprometidoAbiertos - stateDom.stockEnCasa).toFixed(2)));
        const inp = document.getElementById('msd-input-compra-cant');
        inp.value = falt.toFixed(2).replace('.', ',');
        actualizarPreviewsGestion();
        inp.focus();
    });

    document.getElementById('msd-input-buscar-bulto').addEventListener('input', () => renderizarBultosAbastecer(true));
    document.getElementById('msd-btn-bulto-menos').addEventListener('click', () => setCantidadBultos(stateDom.cantidadBultos - 1));
    document.getElementById('msd-btn-bulto-mas').addEventListener('click', () => setCantidadBultos(stateDom.cantidadBultos + 1));
    document.getElementById('msd-input-bulto-cant').addEventListener('input', (e) => {
        const n = parseInt(e.target.value, 10);
        if (!isNaN(n) && n >= 1) {
            stateDom.cantidadBultos = n;
            sincronizarBotonesPresetBulto(n);
            actualizarPreviewsGestion();
        }
    });
    document.querySelectorAll('.msd-preset-bulto').forEach(btn => {
        btn.addEventListener('click', () => setCantidadBultos(parseInt(btn.dataset.cant || '1', 10)));
    });

    document.getElementById('msd-btn-confirmar-accion').addEventListener('click', ejecutarAccionActiva);

    // Eventos Modal Kardex
    document.getElementById('mkd-btn-cerrar').onclick = cerrarModalKardex;
    document.getElementById('mkd-btn-cerrar-footer').onclick = cerrarModalKardex;
    document.getElementById('mkd-btn-abrir-gestion').onclick = () => {
        cerrarModalKardex();
        abrirModalGestionStockDomiciliario(stateDom.usuarioId, stateDom.ingredienteId, 'ajustar', stateDom.usuarioNombre);
    };
}

function cerrarModalGestion() {
    document.getElementById('modal-stock-domiciliario-colaborador')?.classList.remove('activo');
}

function cerrarModalKardex() {
    document.getElementById('modal-kardex-domiciliario-colaborador')?.classList.remove('activo');
}

function sincronizarBotonesPresetBulto(cant) {
    document.querySelectorAll('.msd-preset-bulto').forEach(btn => {
        const activo = parseInt(btn.dataset.cant || '0', 10) === cant;
        btn.style.background = activo ? '#16a34a' : '#ffffff';
        btn.style.color = activo ? '#ffffff' : '#334155';
        btn.style.borderColor = activo ? '#16a34a' : '#cbd5e1';
    });
}

function setCantidadBultos(nueva) {
    const limpia = Math.max(1, Math.round(Number(nueva) || 1));
    stateDom.cantidadBultos = limpia;
    const inp = document.getElementById('msd-input-bulto-cant');
    if (inp) inp.value = String(limpia);
    sincronizarBotonesPresetBulto(limpia);
    actualizarPreviewsGestion();
}

function activarPestanaGestion(tab) {
    stateDom.tabActiva = tab;
    document.querySelectorAll('#modal-stock-domiciliario-colaborador .msd-tab-btn').forEach(btn => {
        btn.classList.remove('activa-ajustar', 'activa-compra', 'activa-abastecer');
        if (btn.dataset.tab === tab) {
            btn.classList.add(tab === 'compra' ? 'activa-compra' : tab === 'abastecer' ? 'activa-abastecer' : 'activa-ajustar');
        }
    });

    document.getElementById('msd-panel-ajustar').style.display = tab === 'ajustar' ? 'flex' : 'none';
    document.getElementById('msd-panel-compra').style.display = tab === 'compra' ? 'flex' : 'none';
    document.getElementById('msd-panel-abastecer').style.display = tab === 'abastecer' ? 'flex' : 'none';

    const btnConfirmar = document.getElementById('msd-btn-confirmar-accion');
    if (tab === 'ajustar') {
        btnConfirmar.textContent = '⚖️ Guardar Stock en Casa';
        btnConfirmar.style.background = '#2563eb';
        btnConfirmar.disabled = false;
    } else if (tab === 'compra') {
        btnConfirmar.textContent = '🛒 Asentar Compra Externa';
        btnConfirmar.style.background = '#7c3aed';
        btnConfirmar.disabled = false;
    } else {
        btnConfirmar.textContent = '🚚 Confirmar Retiro desde LAMDA';
        btnConfirmar.style.background = '#16a34a';
        btnConfirmar.disabled = !stateDom.articuloSeleccionado;
        if (stateDom.articulosAbastecer.length === 0) {
            cargarArticulosAbastecerModal();
        }
    }
    actualizarPreviewsGestion();
}

async function cargarArticulosAbastecerModal() {
    const ul = document.getElementById('msd-lista-bultos');
    if (!ul) return;
    ul.innerHTML = `<li style="padding: 12px; color: #475569; font-size: 12.5px;">⏳ Cargando presentaciones habilitadas de ${escHtml(stateDom.ingredienteNombre)}...</li>`;
    try {
        const resp = await fetch(`/api/produccion/ingredientes/${encodeURIComponent(stateDom.ingredienteId)}/articulos-abastecimiento?usuario_id=${encodeURIComponent(stateDom.usuarioId)}`);
        const json = await resp.json().catch(() => ({}));
        stateDom.articulosAbastecer = Array.isArray(json.data) ? json.data : [];
        const preferido = stateDom.articulosAbastecer.find(a => (parseFloat(a.stock_consolidado) || 0) > 0) || stateDom.articulosAbastecer[0] || null;
        stateDom.articuloSeleccionado = preferido;
        renderizarBultosAbastecer(false);
        actualizarPreviewsGestion();
    } catch (err) {
        ul.innerHTML = `<li style="padding: 12px; color: #dc2626; font-size: 12.5px;">Error al cargar presentaciones: ${escHtml(err.message)}</li>`;
    }
}

function renderizarBultosAbastecer(autoSelect = false) {
    const ul = document.getElementById('msd-lista-bultos');
    if (!ul) return;
    const q = normTxt(document.getElementById('msd-input-buscar-bulto')?.value || '');
    const tokens = q.split(/\s+/).filter(Boolean);
    const filtrados = tokens.length === 0
        ? stateDom.articulosAbastecer
        : stateDom.articulosAbastecer.filter(a => {
            const bolsa = normTxt(`${a.numero || ''} ${a.nombre || ''} ${a.codigo_barras || ''}`);
            return tokens.every(t => bolsa.includes(t));
        });

    if (autoSelect && filtrados.length > 0 && (!stateDom.articuloSeleccionado || !filtrados.some(f => f.numero === stateDom.articuloSeleccionado.numero))) {
        stateDom.articuloSeleccionado = filtrados.find(f => (parseFloat(f.stock_consolidado) || 0) > 0) || filtrados[0];
    }

    ul.innerHTML = '';
    if (filtrados.length === 0) {
        ul.innerHTML = `<li style="padding: 12px; color: #64748b; font-size: 12.5px;">No hay presentaciones de ${escHtml(stateDom.ingredienteNombre)} para ese filtro.</li>`;
        if (stateDom.tabActiva === 'abastecer') {
            document.getElementById('msd-btn-confirmar-accion').disabled = true;
        }
        return;
    }

    filtrados.forEach(art => {
        const sel = stateDom.articuloSeleccionado && stateDom.articuloSeleccionado.numero === art.numero;
        const li = document.createElement('li');
        li.style.cssText = `padding: 8px 11px; border-bottom: 1px solid #e2e8f0; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; background: ${sel ? '#dcfce7' : '#ffffff'}; border-left: ${sel ? '4px solid #16a34a' : '4px solid transparent'};`;
        const stockBulto = parseFloat(art.stock_consolidado) || 0;
        const kgU = parseFloat(art.kilos_unidad) || 1;
        const badgeInsumo = art.es_bulto_insumo
            ? `<span style="font-size:10.5px;padding:1px 6px;border-radius:4px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;font-weight:800;">🏢 Bulto Insumo</span>`
            : '';
        li.innerHTML = `
            <div style="min-width: 0; flex: 1;">
                <div style="font-size: 12.5px; font-weight: 700; color: #0f172a; display: flex; flex-wrap: wrap; align-items: center; gap: 5px;">
                    <span style="font-family: monospace; background: #e2e8f0; padding: 1px 5px; border-radius: 4px;">${escHtml(art.numero)}</span>
                    <span>${escHtml(art.nombre)}</span>
                    ${badgeInsumo}
                </div>
                <div style="font-size: 11px; color: #475569; margin-top: 2px;">Peso unitario: <strong>${fmtKg(kgU)} kg/u.</strong></div>
            </div>
            <span style="font-size: 11.5px; font-weight: 800; padding: 2px 7px; border-radius: 999px; background: ${stockBulto > 0 ? '#dcfce7' : '#fee2e2'}; color: ${stockBulto > 0 ? '#166534' : '#991b1b'}; white-space: nowrap;">Stock: ${stockBulto} u.</span>
        `;
        li.onclick = () => {
            stateDom.articuloSeleccionado = art;
            renderizarBultosAbastecer(false);
            actualizarPreviewsGestion();
        };
        ul.appendChild(li);
    });
}

function actualizarPreviewsGestion() {
    const u = stateDom.unidadMedida || 'kg';
    const casa = stateDom.stockEnCasa;
    const comp = stateDom.comprometidoAbiertos;

    // Preview ① Ajustar
    const rawAj = document.getElementById('msd-input-ajuste-real')?.value || '';
    const valAj = parseFloat(String(rawAj).replace(',', '.'));
    const prevAj = document.getElementById('msd-preview-ajustar');
    if (prevAj) {
        if (isNaN(valAj) || valAj < 0) {
            prevAj.innerHTML = `Ingresá el stock físico real en casa (≥ 0 ${escHtml(u)}).`;
        } else {
            const diff = valAj - casa;
            const proy = valAj - comp;
            prevAj.innerHTML = `
                <div>⚖️ <strong>Saldo anterior en casa:</strong> ${fmtKg(casa)} ${escHtml(u)} · <strong>Ajuste neto:</strong> <strong>${fmtConSigno(diff)} ${escHtml(u)}</strong> → <strong>Nuevo en casa: ${fmtKg(valAj)} ${escHtml(u)}</strong></div>
                <div style="margin-top: 3px; color: ${proy >= -0.01 ? '#15803d' : '#b91c1c'}; font-weight: 700;">
                    📊 Proyectado tras carros abiertos (${fmtKg(comp)} ${escHtml(u)}): ${fmtConSigno(proy)} ${escHtml(u)}
                </div>
            `;
        }
    }

    // Preview ② Compra Externa
    const rawCe = document.getElementById('msd-input-compra-cant')?.value || '';
    const valCe = parseFloat(String(rawCe).replace(',', '.'));
    const sumaCe = (!isNaN(valCe) && valCe > 0) ? valCe : 0;
    const prevCe = document.getElementById('msd-preview-compra');
    if (prevCe) {
        const nuevoCasaCe = casa + sumaCe;
        const proyCe = nuevoCasaCe - comp;
        prevCe.innerHTML = `
            <div>🏠 <strong>En casa:</strong> ${fmtKg(casa)} + <strong>${fmtKg(sumaCe)}</strong> = <strong>${fmtKg(nuevoCasaCe)} ${escHtml(u)}</strong> (0 impacto en Depósito LAMDA)</div>
            <div style="margin-top: 3px; color: ${proyCe >= -0.01 ? '#15803d' : '#b91c1c'}; font-weight: 700;">
                📊 Proyectado tras carros abiertos (${fmtKg(comp)} ${escHtml(u)}): ${fmtConSigno(proyCe)} ${escHtml(u)}
            </div>
        `;
    }

    // Preview ③ Abastecer desde LAMDA
    const subBulto = document.getElementById('msd-bulto-subtexto');
    const prevAb = document.getElementById('msd-preview-abastecer');
    const btnConf = document.getElementById('msd-btn-confirmar-accion');
    if (stateDom.articuloSeleccionado) {
        const kgU = parseFloat(stateDom.articuloSeleccionado.kilos_unidad) || 1;
        const cantB = stateDom.cantidadBultos || 1;
        const kgRetiro = cantB * kgU;
        const nuevoCasaAb = casa + kgRetiro;
        const proyAb = nuevoCasaAb - comp;
        if (subBulto) {
            subBulto.innerHTML = `[<strong>${escHtml(stateDom.articuloSeleccionado.numero)}</strong>] · Cada envase suma <strong>${fmtKg(kgU)} kg</strong>`;
        }
        if (prevAb) {
            prevAb.innerHTML = `
                <div style="font-weight: 800;">📦 Retiro: ${cantB} × ${fmtKg(kgU)} kg = +${fmtKg(kgRetiro)} ${escHtml(u)}</div>
                <div style="margin-top: 2px;">🏠 <strong>Stock en casa:</strong> ${fmtKg(casa)} + ${fmtKg(kgRetiro)} = <strong>${fmtKg(nuevoCasaAb)} ${escHtml(u)}</strong></div>
                <div style="margin-top: 2px; color: ${proyAb >= -0.01 ? '#065f46' : '#b91c1c'}; font-weight: 700;">
                    📊 Proyectado tras carros abiertos (${fmtKg(comp)} ${escHtml(u)}): ${fmtConSigno(proyAb)} ${escHtml(u)}
                </div>
            `;
        }
        if (stateDom.tabActiva === 'abastecer' && btnConf) btnConf.disabled = false;
    } else {
        if (subBulto) subBulto.textContent = 'Seleccioná un bulto arriba';
        if (prevAb) prevAb.textContent = 'Seleccioná una presentación para ver el desglose matemático.';
        if (stateDom.tabActiva === 'abastecer' && btnConf) btnConf.disabled = true;
    }
}

export async function abrirModalGestionStockDomiciliario(usuarioId, ingredienteId, tabInicial = 'ajustar', usuarioNombre = '') {
    inicializarModalesStockDomiciliario(stateDom.onRefreshCallback);

    stateDom.usuarioId = parseInt(usuarioId, 10);
    stateDom.ingredienteId = parseInt(ingredienteId, 10);
    stateDom.usuarioNombre = usuarioNombre || obtenerNombreUsuarioActivoUI(usuarioId);
    stateDom.articulosAbastecer = [];
    stateDom.articuloSeleccionado = null;
    stateDom.cantidadBultos = 1;

    try {
        const resp = await fetch(`/api/produccion/ingredientes/stock-usuario/${stateDom.usuarioId}/${stateDom.ingredienteId}/kardex`);
        if (!resp.ok) throw new Error('No se pudo consultar el estado domiciliario del colaborador');
        const data = await resp.json();

        stateDom.usuarioNombre = data.usuario?.nombre_completo || stateDom.usuarioNombre;
        stateDom.ingredienteCodigo = data.ingrediente?.codigo || '';
        stateDom.ingredienteNombre = data.ingrediente?.nombre || `Ingrediente #${ingredienteId}`;
        stateDom.unidadMedida = data.ingrediente?.unidad_medida || 'Kilo';
        stateDom.stockDepositoCentral = data.ingrediente?.stock_deposito_central || 0;
        stateDom.stockEnCasa = data.resumen?.stock_en_casa || 0;
        stateDom.comprometidoAbiertos = data.resumen?.comprometido_abiertos || 0;
        stateDom.carrosAbiertosCount = data.resumen?.carros_abiertos_count || 0;
        stateDom.proyectadoPostCoccion = data.resumen?.proyectado_post_coccion || 0;
    } catch (err) {
        if (typeof Swal !== 'undefined') Swal.fire('Error', err.message, 'error');
        return;
    }

    const u = stateDom.unidadMedida;
    document.getElementById('msd-header-usuario').textContent = `🏠 Stock Domiciliario de ${stateDom.usuarioNombre}`;
    document.getElementById('msd-header-ingrediente').textContent = `${stateDom.ingredienteCodigo ? `[${stateDom.ingredienteCodigo}] ` : ''}${stateDom.ingredienteNombre}`;

    document.getElementById('msd-stat-casa').textContent = `${fmtKg(stateDom.stockEnCasa)} ${u}`;
    document.getElementById('msd-stat-comp-label').textContent = `Comprometido (${stateDom.carrosAbiertosCount} carro${stateDom.carrosAbiertosCount === 1 ? '' : 's'})`;
    document.getElementById('msd-stat-comp').textContent = `${fmtKg(stateDom.comprometidoAbiertos)} ${u}`;
    const proyEl = document.getElementById('msd-stat-proy');
    proyEl.textContent = `${fmtConSigno(stateDom.proyectadoPostCoccion)} ${u}`;
    proyEl.style.color = stateDom.proyectadoPostCoccion >= -0.01 ? '#15803d' : '#dc2626';

    document.getElementById('msd-ref-central').textContent = `Depósito Central: ${fmtKg(stateDom.stockDepositoCentral)} ${u}`;
    document.querySelectorAll('#modal-stock-domiciliario-colaborador .msd-unidad-txt').forEach(el => { el.textContent = u; });

    document.getElementById('msd-input-ajuste-real').value = Math.max(0, stateDom.stockEnCasa).toFixed(2).replace('.', ',');
    document.getElementById('msd-input-ajuste-obs').value = '';

    const faltante = Math.max(0, Number((stateDom.comprometidoAbiertos - stateDom.stockEnCasa).toFixed(2)));
    document.getElementById('msd-input-compra-cant').value = faltante > 0 ? faltante.toFixed(2).replace('.', ',') : '';
    document.getElementById('msd-input-compra-comercio').value = '';
    document.getElementById('msd-input-compra-obs').value = '';
    const btnFalt = document.getElementById('msd-btn-compra-faltante');
    if (faltante > 0) {
        btnFalt.style.display = 'inline-block';
        btnFalt.textContent = `⚡ Cubrir faltante (${fmtKg(faltante)} ${u})`;
    } else {
        btnFalt.style.display = 'none';
    }

    document.getElementById('msd-input-buscar-bulto').value = '';
    setCantidadBultos(1);

    activarPestanaGestion(tabInicial || 'ajustar');
    document.getElementById('modal-stock-domiciliario-colaborador').classList.add('activo');
}

async function ejecutarAccionActiva() {
    if (stateDom.enVuelo) return;
    const btn = document.getElementById('msd-btn-confirmar-accion');
    const txtOrig = btn.textContent;

    try {
        stateDom.enVuelo = true;
        btn.disabled = true;
        btn.textContent = '⏳ Procesando...';

        if (stateDom.tabActiva === 'ajustar') {
            const rawVal = document.getElementById('msd-input-ajuste-real').value;
            const stockReal = parseFloat(String(rawVal).replace(',', '.'));
            if (isNaN(stockReal) || stockReal < 0) {
                throw new Error('Ingresá un stock físico real mayor o igual a 0.');
            }
            const obs = document.getElementById('msd-input-ajuste-obs').value.trim();
            const resp = await fetch('/api/produccion/ingredientes/stock-usuario/ajustar-casa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usuario_id: stateDom.usuarioId,
                    ingrediente_id: stateDom.ingredienteId,
                    stock_fisico_real: stockReal,
                    observaciones: obs,
                    permitir_alta_en_cero: true
                })
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(json.error || 'No se pudo ajustar el stock domiciliario');

            cerrarModalGestion();
            if (typeof stateDom.onRefreshCallback === 'function') await stateDom.onRefreshCallback(stateDom.usuarioId);
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: 'Stock en casa actualizado',
                    html: `<strong>${escHtml(stateDom.ingredienteNombre)}</strong> en casa de <strong>${escHtml(stateDom.usuarioNombre)}</strong>: <strong>${fmtKg(json.stock_nuevo)} ${escHtml(stateDom.unidadMedida)}</strong>.`,
                    timer: 2200,
                    showConfirmButton: false
                });
            }
        } else if (stateDom.tabActiva === 'compra') {
            const rawCant = document.getElementById('msd-input-compra-cant').value;
            const cant = parseFloat(String(rawCant).replace(',', '.'));
            if (isNaN(cant) || cant <= 0) {
                throw new Error('Ingresá una cantidad comprada mayor a 0.');
            }
            const comercio = document.getElementById('msd-input-compra-comercio').value.trim();
            const obs = document.getElementById('msd-input-compra-obs').value.trim();

            const resp = await fetch('/api/produccion/ingredientes/stock-usuario/compra-externa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usuario_id: stateDom.usuarioId,
                    ingrediente_id: stateDom.ingredienteId,
                    cantidad: cant,
                    comercio_origen: comercio,
                    observaciones: obs,
                    request_id: `ce_gest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                })
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(json.error || 'No se pudo asentar la compra externa');

            cerrarModalGestion();
            if (typeof stateDom.onRefreshCallback === 'function') await stateDom.onRefreshCallback(stateDom.usuarioId);
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: 'Compra externa registrada',
                    html: `Se acreditaron <strong>+${fmtKg(json.kilos_sumados)} ${escHtml(stateDom.unidadMedida)}</strong> en casa de <strong>${escHtml(stateDom.usuarioNombre)}</strong> (Nuevo stock en casa: <strong>${fmtKg(json.saldo_nuevo)} ${escHtml(stateDom.unidadMedida)}</strong> · 0 impacto en Depósito LAMDA).`,
                    timer: 2600,
                    showConfirmButton: false
                });
            }
        } else if (stateDom.tabActiva === 'abastecer') {
            if (!stateDom.articuloSeleccionado) {
                throw new Error('Seleccioná un envase/bulto para abastecer.');
            }
            const cantEnvases = Math.max(1, parseInt(document.getElementById('msd-input-bulto-cant').value, 10) || 1);
            const resp = await fetch('/api/produccion/ingredientes/abastecer-stock-personal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usuario_id: stateDom.usuarioId,
                    ingrediente_id: stateDom.ingredienteId,
                    articulo_numero: stateDom.articuloSeleccionado.numero,
                    cantidad: cantEnvases,
                    carro_id: null,
                    request_id: `ab_gest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                })
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(json.error || 'No se pudo procesar el abastecimiento');

            cerrarModalGestion();
            if (typeof stateDom.onRefreshCallback === 'function') await stateDom.onRefreshCallback(stateDom.usuarioId);
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: 'Abastecimiento registrado',
                    html: `Retiro de <strong>${cantEnvases} u.</strong> de <strong>[${escHtml(json.articulo_numero)}]</strong> (<strong>+${fmtKg(json.kilos_acreditados)} ${escHtml(stateDom.unidadMedida)}</strong>).<br>Nuevo stock en casa: <strong>${fmtKg(json.saldo_actual)} ${escHtml(stateDom.unidadMedida)}</strong>.`,
                    timer: 2600,
                    showConfirmButton: false
                });
            }
        }
    } catch (err) {
        if (typeof Swal !== 'undefined') {
            Swal.fire('Atención', err.message, 'warning');
        } else {
            alert(err.message);
        }
    } finally {
        stateDom.enVuelo = false;
        btn.disabled = false;
        btn.textContent = txtOrig;
    }
}

export async function abrirModalKardexDomiciliario(usuarioId, ingredienteId, usuarioNombre = '') {
    inicializarModalesStockDomiciliario(stateDom.onRefreshCallback);
    stateDom.usuarioId = parseInt(usuarioId, 10);
    stateDom.ingredienteId = parseInt(ingredienteId, 10);
    stateDom.usuarioNombre = usuarioNombre || obtenerNombreUsuarioActivoUI(usuarioId);

    try {
        const resp = await fetch(`/api/produccion/ingredientes/stock-usuario/${stateDom.usuarioId}/${stateDom.ingredienteId}/kardex`);
        if (!resp.ok) throw new Error('No se pudo cargar el Kardex domiciliario');
        const data = await resp.json();

        const u = data.ingrediente?.unidad_medida || 'Kilo';
        stateDom.usuarioNombre = data.usuario?.nombre_completo || stateDom.usuarioNombre;
        stateDom.ingredienteNombre = data.ingrediente?.nombre || '';

        document.getElementById('mkd-header-usuario').textContent = `🔎 Kardex Domiciliario de ${stateDom.usuarioNombre}`;
        document.getElementById('mkd-header-ingrediente').textContent = `${data.ingrediente?.codigo ? `[${data.ingrediente.codigo}] ` : ''}${data.ingrediente?.nombre || ''}`;

        const r = data.resumen || {};
        document.getElementById('mkd-stat-casa').textContent = `${fmtKg(r.stock_en_casa)} ${u}`;
        document.getElementById('mkd-stat-comp-lbl').textContent = `Comprometido (${r.carros_abiertos_count || 0} carro${r.carros_abiertos_count === 1 ? '' : 's'})`;
        document.getElementById('mkd-stat-comp').textContent = `${fmtKg(r.comprometido_abiertos)} ${u}`;
        const proyEl = document.getElementById('mkd-stat-proy');
        proyEl.textContent = `${fmtConSigno(r.proyectado_post_coccion)} ${u}`;
        proyEl.style.color = (r.proyectado_post_coccion || 0) >= -0.01 ? '#15803d' : '#dc2626';
        document.getElementById('mkd-stat-central').textContent = `${fmtKg(data.ingrediente?.stock_deposito_central || 0)} ${u}`;

        // Renderizar carros externos abiertos
        const carrosCont = document.getElementById('mkd-carros-abiertos-container');
        const carros = Array.isArray(data.carros_abiertos) ? data.carros_abiertos : [];
        if (carros.length === 0) {
            carrosCont.innerHTML = `<div style="font-size: 12.5px; color: #78350f; font-style: italic;">No hay carros externos preparados pendientes de confirmar para este ingrediente.</div>`;
        } else {
            carrosCont.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    ${carros.map(c => `
                        <div style="display: flex; justify-content: space-between; align-items: center; background: #ffffff; border: 1px solid #fed7aa; border-radius: 7px; padding: 7px 11px; font-size: 12.5px;">
                            <div>
                                <strong style="color: #9a3412;">Carro Externo #${c.carro_id}</strong>
                                <span style="color: #64748b; margin-left: 6px;">(${fmtFechaHora(c.fecha_preparado)})</span>
                                <div style="font-size: 11.5px; color: #475569; margin-top: 1px;">${escHtml(c.articulos_resumen || 'Unidad Productiva Externa')}</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-weight: 800; color: #b45309; font-size: 13.5px;">${fmtKg(c.cantidad_requerida)} ${escHtml(u)}</div>
                                <span style="font-size: 10.5px; font-weight: 700; color: #1d4ed8;">⏳ Se descuenta al confirmar</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // Renderizar movimientos Kardex
        const tbody = document.getElementById('mkd-tabla-kardex-body');
        const movs = Array.isArray(data.movimientos) ? data.movimientos : [];
        if (movs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: #64748b; font-style: italic;">Sin movimientos registrados en el stock domiciliario.</td></tr>`;
        } else {
            tbody.innerHTML = movs.map(m => {
                const cant = Number(m.cantidad) || 0;
                const saldo = Number(m.saldo_acumulado) || 0;
                let detalle = m.observaciones ? escHtml(m.observaciones) : '';
                if (!detalle) {
                    if (m.origen_carro_id) detalle = `Consumo en Carro Externo #${m.origen_carro_id}`;
                    else if (m.articulo_origen_numero) detalle = `Retiro bulto [${escHtml(m.articulo_origen_numero)}]`;
                    else if (m.contexto_envase) detalle = `Abastecimiento (envase ${fmtKg(m.contexto_envase)} ${escHtml(u)})`;
                    else detalle = 'Ajuste de inventario en domicilio';
                } else if (m.origen_carro_id && !detalle.includes(`#${m.origen_carro_id}`)) {
                    detalle += ` (Carro #${m.origen_carro_id})`;
                }

                return `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 8px 12px; color: #475569; white-space: nowrap;">${fmtFechaHora(m.fecha_registro)}</td>
                        <td style="padding: 8px 12px; white-space: nowrap;">${badgeTipoMovimiento(m.tipo_movimiento)}</td>
                        <td style="padding: 8px 12px; color: #1e293b;">${detalle}</td>
                        <td style="padding: 8px 12px; text-align: right; font-weight: 800; font-family: monospace; font-size: 13px; color: ${cant >= 0 ? '#15803d' : '#dc2626'}; white-space: nowrap;">
                            ${fmtConSigno(cant)} ${escHtml(u)}
                        </td>
                        <td style="padding: 8px 12px; text-align: right; font-weight: 800; font-family: monospace; font-size: 13px; color: ${saldo < -0.001 ? '#dc2626' : '#0f172a'}; white-space: nowrap;">
                            ${fmtKg(saldo)} ${escHtml(u)}
                        </td>
                    </tr>
                `;
            }).join('');
        }

        document.getElementById('modal-kardex-domiciliario-colaborador').classList.add('activo');
    } catch (err) {
        if (typeof Swal !== 'undefined') Swal.fire('Error', err.message, 'error');
    }
}

export async function abrirModalAsignarIngredienteColaborador(usuarioId, usuarioNombre = '') {
    inicializarModalesStockDomiciliario(stateDom.onRefreshCallback);
    const uid = parseInt(usuarioId, 10);
    const uNombre = usuarioNombre || obtenerNombreUsuarioActivoUI(uid);

    try {
        const resp = await fetch('/api/produccion/ingredientes');
        if (!resp.ok) throw new Error('No se pudo cargar el padrón de ingredientes');
        const todos = (await resp.json()).filter(i => !i.es_insumo);

        const { value: selectedId } = await Swal.fire({
            title: `➕ Asignar / Abastecer Ingrediente a ${escHtml(uNombre)}`,
            width: 560,
            html: `
                <div style="text-align: left; font-size: 13px;">
                    <p style="margin: 0 0 8px 0; color: #475569;">Buscá y elegí el ingrediente para gestionar en el depósito domiciliario de <strong>${escHtml(uNombre)}</strong>:</p>
                    <input id="swal-buscar-asig-ing" type="text" placeholder="🔍 Buscar ingrediente (ej: miel, aceite de coco, sal)..." style="width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1.5px solid #2563eb; border-radius: 7px; font-size: 13.5px; margin-bottom: 8px;">
                    <select id="swal-select-asig-ing" size="8" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 13px;"></select>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Continuar a Gestionar Stock ➔',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#2563eb',
            didOpen: () => {
                const inp = document.getElementById('swal-buscar-asig-ing');
                const sel = document.getElementById('swal-select-asig-ing');
                const renderOpts = () => {
                    const terms = normTxt(inp.value).split(/\s+/).filter(Boolean);
                    const fil = todos.filter(item => {
                        const b = normTxt(`${item.codigo || ''} ${item.nombre || ''}`);
                        return terms.every(t => b.includes(t));
                    });
                    sel.innerHTML = fil.map((item, idx) =>
                        `<option value="${item.id}" ${idx === 0 ? 'selected' : ''}>[${escHtml(item.codigo || item.id)}] ${escHtml(item.nombre)} (${escHtml(item.unidad_medida || 'kg')})</option>`
                    ).join('');
                };
                inp.addEventListener('input', renderOpts);
                sel.addEventListener('dblclick', () => Swal.clickConfirm());
                renderOpts();
                setTimeout(() => inp.focus(), 40);
            },
            preConfirm: () => {
                const val = document.getElementById('swal-select-asig-ing')?.value;
                if (!val) {
                    Swal.showValidationMessage('Seleccioná un ingrediente de la lista.');
                    return false;
                }
                return parseInt(val, 10);
            }
        });

        if (selectedId) {
            await abrirModalGestionStockDomiciliario(uid, selectedId, 'ajustar', uNombre);
        }
    } catch (err) {
        Swal.fire('Error', err.message, 'error');
    }
}

function obtenerNombreUsuarioActivoUI(usuarioId) {
    const item = document.querySelector(`.sector-item[data-usuario-id="${usuarioId}"]`);
    if (item) {
        return item.textContent.replace(/^👤\s*/, '').trim();
    }
    return `Colaborador #${usuarioId}`;
}
