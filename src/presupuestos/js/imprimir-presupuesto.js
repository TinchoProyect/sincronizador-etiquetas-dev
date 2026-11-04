/**
 * MÓDULO DE IMPRESIÓN DE PRESUPUESTOS
 * Gestiones Lamda - Vista de impresión profesional
 */

console.log('🖨️ [IMPRIMIR-PRESUPUESTO] Inicializando módulo de impresión...');

// Configuración
const CONFIG = {
    API_BASE_URL: '/api/presupuestos'
};

// Estado de la aplicación
let presupuestoData = null;
let presupuestoId = null;
let formatoActual = null; // 'IVA_DISCRIMINADO' | 'IVA_INCLUIDO'
let extrasData = null;

/**
 * Inicialización al cargar el DOM
 */
document.addEventListener('DOMContentLoaded', function () {
    console.log('📋 [IMPRIMIR-PRESUPUESTO] DOM cargado, inicializando...');

    // Obtener ID del presupuesto desde URL
    const urlParams = new URLSearchParams(window.location.search);
    presupuestoId = urlParams.get('id');

    if (!presupuestoId) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] No se proporcionó ID de presupuesto');
        mostrarError('No se especificó qué presupuesto imprimir');
        return;
    }

    console.log(`🔍 [IMPRIMIR-PRESUPUESTO] ID de presupuesto: ${presupuestoId}`);

    // Cargar datos del presupuesto
    cargarPresupuesto(presupuestoId);
});

/**
 * Determinar formato por defecto según condición IVA del cliente
 */
function determinarFormatoPorDefecto(condicionIva) {
    console.log(`🔍 [FORMATO] Determinando formato por defecto para condición IVA: "${condicionIva}"`);

    // Si es "Responsable Inscripto" → IVA_DISCRIMINADO
    if (condicionIva && condicionIva.trim() === 'Responsable Inscripto') {
        console.log('📊 [FORMATO] Formato por defecto: IVA_DISCRIMINADO (Responsable Inscripto)');
        return 'IVA_DISCRIMINADO';
    }

    // Para cualquier otro caso → IVA_INCLUIDO
    console.log(`💰 [FORMATO] Formato por defecto: IVA_INCLUIDO (condición: "${condicionIva || 'sin especificar'}")`);
    return 'IVA_INCLUIDO';
}

/**
 * Cargar datos del presupuesto desde la API
 */
async function cargarPresupuesto(id) {
    console.log(`🔍 [IMPRIMIR-PRESUPUESTO] Cargando presupuesto ID: ${id}...`);

    try {
        // Mostrar loading
        mostrarLoading();

        // Cargar datos del presupuesto
        const responsePresupuesto = await fetch(`${CONFIG.API_BASE_URL}/${id}`);
        if (!responsePresupuesto.ok) {
            throw new Error(`Error HTTP ${responsePresupuesto.status}: ${responsePresupuesto.statusText}`);
        }

        const dataPresupuesto = await responsePresupuesto.json();
        if (!dataPresupuesto.success) {
            throw new Error(dataPresupuesto.message || 'Error al cargar presupuesto');
        }

        // Cargar detalles de artículos
        const responseDetalles = await fetch(`${CONFIG.API_BASE_URL}/${id}/detalles`);
        if (!responseDetalles.ok) {
            throw new Error(`Error HTTP ${responseDetalles.status}: ${responseDetalles.statusText}`);
        }

        const dataDetalles = await responseDetalles.json();
        if (!dataDetalles.success) {
            throw new Error(dataDetalles.message || 'Error al cargar detalles');
        }

        // Combinar datos
        presupuestoData = {
            presupuesto: dataPresupuesto.data,
            detalles: dataDetalles.data.detalles || [],
            detalles_sin_stock: dataDetalles.data.detalles_sin_stock || [],
            totales: dataDetalles.data.totales || {}
        };

        console.log('✅ [IMPRIMIR-PRESUPUESTO] Datos cargados:', presupuestoData);

        // Cargar complementos opcionales (promos activas, formas de pago, política de intereses)
        try {
            const responseExtras = await fetch(`/api/presupuestos/${id}/impresion-extras`);
            if (responseExtras.ok) {
                const dataExtras = await responseExtras.json();
                if (dataExtras.success && dataExtras.data) {
                    extrasData = dataExtras.data;
                    console.log('✅ [IMPRIMIR-PRESUPUESTO] Extras cargados:', extrasData);
                    if (typeof renderizarContenidoPromos === 'function') {
                        renderizarContenidoPromos(extrasData.promos, extrasData.politica_comercial, presupuestoData.totales);
                    }
                    if (typeof actualizarInfoPoliticaIntereses === 'function') {
                        actualizarInfoPoliticaIntereses(extrasData.politica_intereses);
                    }
                }
            }
        } catch (errExtras) {
            console.warn('⚠️ [IMPRIMIR-PRESUPUESTO] Error al obtener complementos:', errExtras);
        }

        // Fallback resiliente para promociones si el backend en puerto 3003 aún no fue reiniciado
        if (!extrasData || !extrasData.promos || extrasData.promos.length === 0) {
            try {
                let respOfr = await fetch('/api/ofertas-dinamicas?solo_activas=true').catch(() => null);
                if (!respOfr || !respOfr.ok) {
                    const host = window.location.hostname || 'localhost';
                    respOfr = await fetch(`http://${host}:3000/api/ofertas-dinamicas?solo_activas=true`).catch(() => null);
                }
                if (respOfr && respOfr.ok) {
                    const jsonOfr = await respOfr.json();
                    if (jsonOfr.success && Array.isArray(jsonOfr.data)) {
                        extrasData = extrasData || {};
                        extrasData.promos = jsonOfr.data;
                        console.log('✅ [IMPRIMIR-PRESUPUESTO] Promos cargadas vía fallback:', extrasData.promos);
                        if (typeof renderizarContenidoPromos === 'function') {
                            renderizarContenidoPromos(extrasData.promos, extrasData.politica_comercial, presupuestoData.totales);
                        }
                    }
                }
            } catch (eOfr) {
                console.warn('⚠️ [IMPRIMIR-PRESUPUESTO] Fallback de ofertas falló:', eOfr);
            }
        }

        // Fallback resiliente para política comercial si no vino en extras
        if (!extrasData?.politica_comercial && presupuestoData?.presupuesto?.id_cliente) {
            try {
                const cliId = presupuestoData.presupuesto.id_cliente;
                const respPol = await fetch(`/api/presupuestos/politicas/cliente/${cliId}`);
                if (respPol.ok) {
                    const dataPol = await respPol.json();
                    if (dataPol.success && dataPol.data && dataPol.data.tiene_politica && dataPol.data.politica) {
                        extrasData = extrasData || {};
                        extrasData.politica_comercial = {
                            id: dataPol.data.politica.id,
                            nombre: dataPol.data.politica.nombre,
                            lista_nombre: dataPol.data.lista_nombre,
                            lista_id: dataPol.data.lista_id,
                            tipo_calculo: dataPol.data.politica.tipo_calculo,
                            aplica_sobre: dataPol.data.politica.aplica_sobre,
                            tramos: dataPol.data.politica.tramos,
                            excepcion: dataPol.data.excepcion
                        };
                        console.log('✅ [IMPRIMIR-PRESUPUESTO] Política comercial cargada vía fallback:', extrasData.politica_comercial);
                        if (typeof renderizarContenidoPromos === 'function') {
                            renderizarContenidoPromos(extrasData.promos, extrasData.politica_comercial, presupuestoData.totales);
                        }
                    }
                }
            } catch (ePol) {
                console.warn('⚠️ [IMPRIMIR-PRESUPUESTO] Fallback de política comercial falló:', ePol);
            }
        }

        // Validar que hay datos mínimos
        if (!presupuestoData.detalles || presupuestoData.detalles.length === 0) {
            console.warn('⚠️ [IMPRIMIR-PRESUPUESTO] Presupuesto sin artículos');
            // Continuar de todas formas, mostrar presupuesto vacío
        }

        // DETERMINAR FORMATO DE IMPRESIÓN
        const presupuesto = presupuestoData.presupuesto;

        const urlParamsOverride = new URLSearchParams(window.location.search);
        
        if (urlParamsOverride.has('formato')) {
            // Override absoluto vía PWA Móvil
            formatoActual = urlParamsOverride.get('formato');
            console.log(`📱 [FORMATO] Override por PWA URL: ${formatoActual}`);
        } else if (presupuesto.formato_impresion) {
            // Si ya tiene formato guardado, usarlo
            formatoActual = presupuesto.formato_impresion;
            console.log(`📋 [FORMATO] Usando formato guardado: ${formatoActual}`);
        } else {
            // Si no tiene formato, determinarlo por condición IVA
            const condicionIva = presupuesto.condicion_iva;
            formatoActual = determinarFormatoPorDefecto(condicionIva);
            console.log(`📋 [FORMATO] Formato determinado automáticamente: ${formatoActual}`);
        }

        // Actualizar UI del selector
        actualizarSelectorFormato(formatoActual);

        // Renderizar presupuesto con el formato determinado
        renderizarPresupuesto(presupuestoData);

        // PWA Override: Modo Solo Lista Automático
        if (urlParamsOverride.get('sololista') === 'true') {
            const chk = document.getElementById('chk-solo-lista');
            if(chk) {
                chk.checked = true;
                if(typeof window.toggleSoloLista === 'function') window.toggleSoloLista();
            }
        }

        // Override: Modo Faltantes Automático (Default es true en HTML, se puede desactivar con ?faltantes=false)
        if (urlParamsOverride.get('faltantes') === 'false') {
            const chk = document.getElementById('chk-faltantes');
            if(chk) {
                chk.checked = false;
                if(typeof window.toggleFaltantes === 'function') window.toggleFaltantes();
            }
        }

        // Override: Modo Promociones y Ofertas
        if (urlParamsOverride.get('promos') === 'true') {
            const chk = document.getElementById('chk-promos');
            if(chk) {
                chk.checked = true;
                if(typeof window.togglePromos === 'function') window.togglePromos(true);
            }
        }

        // Override: Modo Formas de Pago
        if (urlParamsOverride.get('pagos') === 'true') {
            const chk = document.getElementById('chk-pagos');
            if(chk) {
                chk.checked = true;
                if(typeof window.togglePagos === 'function') window.togglePagos(true);
            }
        }

        // Override: Modo Política de Intereses
        if (urlParamsOverride.get('intereses') === 'true') {
            const chk = document.getElementById('chk-intereses');
            if(chk) {
                chk.checked = true;
                if(typeof window.toggleIntereses === 'function') window.toggleIntereses(true);
            }
        }

    } catch (error) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] Error al cargar presupuesto:', error);
        mostrarError(`Error al cargar el presupuesto: ${error.message}`);
    }
}

/**
 * Actualizar UI del selector de formato
 */
function actualizarSelectorFormato(formato) {
    const btnDiscriminado = document.getElementById('btn-formato-discriminado');
    const btnIncluido = document.getElementById('btn-formato-incluido');

    if (!btnDiscriminado || !btnIncluido) {
        console.warn('⚠️ [FORMATO] Botones de formato no encontrados');
        return;
    }

    if (formato === 'IVA_DISCRIMINADO') {
        btnDiscriminado.classList.add('active');
        btnIncluido.classList.remove('active');
    } else {
        btnDiscriminado.classList.remove('active');
        btnIncluido.classList.add('active');
    }

    console.log(`✅ [FORMATO] Selector actualizado a: ${formato}`);
}

/**
 * Cambiar formato de impresión
 */
async function cambiarFormato(nuevoFormato) {
    console.log(`🔄 [FORMATO] Cambiando formato a: ${nuevoFormato}`);

    if (formatoActual === nuevoFormato) {
        console.log(`ℹ️ [FORMATO] Ya está en formato: ${nuevoFormato}`);
        return;
    }

    // Actualizar formato actual
    formatoActual = nuevoFormato;

    // Actualizar UI del selector
    actualizarSelectorFormato(nuevoFormato);

    // Re-renderizar presupuesto con nuevo formato
    renderizarPresupuesto(presupuestoData);

    // Guardar formato en BD (fire-and-forget)
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/${presupuestoId}/formato-impresion`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ formato_impresion: nuevoFormato })
        });

        if (response.ok) {
            console.log(`✅ [FORMATO] Formato guardado en BD: ${nuevoFormato}`);
        } else {
            console.warn(`⚠️ [FORMATO] No se pudo guardar formato en BD (no crítico)`);
        }
    } catch (error) {
        console.warn(`⚠️ [FORMATO] Error al guardar formato (no crítico):`, error);
    }
}

/**
 * Alternar visibilidad del bloque de totales (Modo Solo Lista)
 */
window.toggleSoloLista = function() {
    const isChecked = document.getElementById('chk-solo-lista')?.checked;
    const totalesSection = document.getElementById('totales-section-container') || document.querySelector('.totales-section');
    const barcodeLeft = document.querySelector('.barcode-left');
    const hardwareCmds = document.querySelector('.comandos-hardware-relativos');
    const docTitulo = document.querySelector('.documento-titulo');

    const cabeceraTitulo = document.getElementById('cabecera-titulo');
    const documentoTipo = document.getElementById('documento-tipo');
    const condicionSec = document.getElementById('condicion-comercial-section');

    // Determinar título original según estado del documento
    const tituloDoc = (presupuestoData && presupuestoData.presupuesto && presupuestoData.presupuesto.estado === 'Orden de Retiro')
        ? 'ORDEN DE RETIRO / DEVOLUCIÓN'
        : 'PRESUPUESTO';

    if (totalesSection) {
        totalesSection.style.display = isChecked ? 'none' : 'block';
    }
    if (barcodeLeft) {
        barcodeLeft.style.display = isChecked ? 'none' : 'flex';
    }
    if (hardwareCmds) {
        hardwareCmds.style.display = isChecked ? 'none' : 'flex';
    }
    if (docTitulo) {
        docTitulo.style.display = isChecked ? 'none' : 'flex';
    }

    if (isChecked) {
        if (cabeceraTitulo) cabeceraTitulo.textContent = 'CONSULTA DE PRECIOS';
        if (documentoTipo) documentoTipo.textContent = 'CONSULTA DE PRECIOS';
        if (condicionSec && presupuestoData && presupuestoData.presupuesto) {
            cargarCondicionComercial(presupuestoData.presupuesto);
        }
    } else {
        if (cabeceraTitulo) cabeceraTitulo.textContent = tituloDoc;
        if (documentoTipo) documentoTipo.textContent = tituloDoc;
        // En presupuesto consolidado regular se oculta siempre la sección de condición comercial / bonificaciones
        if (condicionSec) {
            condicionSec.style.display = 'none';
        }
    }

    console.log(`👁️ [UI] Modo Solo Lista: ${isChecked ? 'Activado (Consulta de Precios)' : 'Desactivado (Presupuesto completo)'}`);
};

/**
 * Alternar visibilidad de Promociones y Ofertas Activas
 */
window.togglePromos = function(forceState) {
    const chk = document.getElementById('chk-promos');
    const btn = document.getElementById('btn-toggle-promos');
    const badge = document.getElementById('badge-promos-status');
    const sec = document.getElementById('promos-section');
    if (!chk || !sec) return;

    const newState = (typeof forceState === 'boolean') ? forceState : !chk.checked;
    chk.checked = newState;

    if (newState) {
        if (!extrasData || !extrasData.promos || extrasData.promos.length === 0) {
            try {
                const host = window.location.hostname || 'localhost';
                fetch(`http://${host}:3000/api/ofertas-dinamicas?solo_activas=true`)
                    .then(r => r.json())
                    .then(res => {
                        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
                            extrasData = extrasData || {};
                            extrasData.promos = res.data;
                            renderizarContenidoPromos(extrasData.promos);
                        }
                    })
                    .catch(() => {});
            } catch(e) {}

            if (typeof forceState !== 'boolean' && (!extrasData || !extrasData.promos || extrasData.promos.length === 0)) {
                Swal.fire({
                    icon: 'info',
                    title: 'Sin Promociones Activas',
                    text: 'No se encontraron ofertas o promociones activas vigentes para este cliente en este momento.',
                    timer: 3000,
                    showConfirmButton: false
                });
            }
        }
        sec.style.display = 'block';
        if (btn) btn.classList.add('active-promos');
        if (badge) badge.textContent = 'ON ✓';
    } else {
        sec.style.display = 'none';
        if (btn) btn.classList.remove('active-promos');
        if (badge) badge.textContent = 'OFF';
    }
    console.log(`🏷️ [UI] Promos y Ofertas: ${newState ? 'Activado' : 'Desactivado'}`);
};

/**
 * Alternar visibilidad de Formas de Pago
 */
window.togglePagos = function(forceState) {
    const chk = document.getElementById('chk-pagos');
    const btn = document.getElementById('btn-toggle-pagos');
    const badge = document.getElementById('badge-pagos-status');
    const sec = document.getElementById('formas-pago-section');
    if (!chk || !sec) return;

    const newState = (typeof forceState === 'boolean') ? forceState : !chk.checked;
    chk.checked = newState;

    if (newState) {
        sec.style.display = 'block';
        if (btn) btn.classList.add('active-pagos');
        if (badge) badge.textContent = 'ON ✓';
    } else {
        sec.style.display = 'none';
        if (btn) btn.classList.remove('active-pagos');
        if (badge) badge.textContent = 'OFF';
    }
    console.log(`💳 [UI] Formas de Pago: ${newState ? 'Activado' : 'Desactivado'}`);
};

/**
 * Alternar visibilidad de Política de Intereses (Modo Sombra)
 */
window.toggleIntereses = function(forceState) {
    const chk = document.getElementById('chk-intereses');
    const btn = document.getElementById('btn-toggle-intereses');
    const badge = document.getElementById('badge-intereses-status');
    const sec = document.getElementById('politica-intereses-section');
    if (!chk || !sec) return;

    const newState = (typeof forceState === 'boolean') ? forceState : !chk.checked;
    chk.checked = newState;

    if (newState) {
        sec.style.display = 'block';
        if (btn) btn.classList.add('active-intereses');
        if (badge) badge.textContent = 'ON ✓';
    } else {
        sec.style.display = 'none';
        if (btn) btn.classList.remove('active-intereses');
        if (badge) badge.textContent = 'OFF';
    }
    console.log(`🛡️ [UI] Política de Intereses: ${newState ? 'Activado' : 'Desactivado'}`);
};

/**
 * Renderiza el listado visual de promociones y ofertas en el contenedor del documento
 * Incluye tanto ofertas dinámicas de productos como la Bonificación Comercial por Volumen (Escalas de Pedidos).
 */
function renderizarContenidoPromos(promos, politicaComercial, totales = {}) {
    const container = document.getElementById('promos-container-body');
    if (!container) return;

    // Normalizar argumentos si se llama desde re-renderizados internos
    if (!politicaComercial && extrasData?.politica_comercial) {
        politicaComercial = extrasData.politica_comercial;
    }
    if (!promos && extrasData?.promos) {
        promos = extrasData.promos;
    }
    if ((!totales || !totales.neto_total) && presupuestoData?.totales) {
        totales = presupuestoData.totales;
    }

    const tienePromos = Array.isArray(promos) && promos.length > 0;
    const tienePolitica = politicaComercial && politicaComercial.tramos && politicaComercial.tramos.length > 0;

    if (!tienePromos && !tienePolitica) {
        container.innerHTML = `
            <div style="font-size: 0.85em; color: #78350f; font-style: italic; background: rgba(254, 243, 199, 0.5); padding: 8px 12px; border-radius: 4px;">
                Actualmente no se registran ofertas o promociones especiales vigentes para este cliente.
            </div>
        `;
        return;
    }

    let html = '';

    // 1. Renderizar Promociones Dinámicas de Artículos (si existen)
    if (tienePromos) {
        promos.forEach(p => {
            const badgeDesc = p.tipo_beneficio === 'PORCENTAJE'
                ? `${parseFloat(p.descuento_porcentaje)}% OFF`
                : (p.precio_fijo_oferta ? `$${parseFloat(p.precio_fijo_oferta).toLocaleString('es-AR')} Fijo` : 'Oferta Especial');

            let artsHtml = '';
            if (p.articulos && p.articulos.length > 0) {
                artsHtml = `<div style="margin-top: 6px; font-size: 0.8em; color: #451a03; display: flex; flex-wrap: wrap; gap: 6px;">`;
                p.articulos.forEach(a => {
                    artsHtml += `<span style="background: white; border: 1px solid #fde68a; padding: 2px 8px; border-radius: 12px; font-weight: 600;">🏷️ ${escapeHtml(a.descripcion || a.articulo_numero)}</span>`;
                });
                artsHtml += `</div>`;
            }

            // Limpiar descripción de menciones operativas internas (kilos, bolsones, etc.) y de lanzamiento
            let descLimpia = (p.descripcion || '').trim();
            descLimpia = descLimpia.replace(/de lanzamiento\s*/gi, '');
            descLimpia = descLimpia.replace(/hasta agotar\s+\d+[\s\w(),.]*$/i, 'hasta agotar stock.').trim();
            descLimpia = descLimpia.replace(/\s+/g, ' ');
            if (descLimpia && !descLimpia.endsWith('.')) descLimpia += '.';

            // Formateo fiel de fecha límite (sin desfase horario)
            let fechaFmt = '';
            if (p.fecha_fin) {
                try {
                    if (typeof p.fecha_fin === 'string' && p.fecha_fin.includes('T')) {
                        fechaFmt = p.fecha_fin.split('T')[0].split('-').reverse().join('/');
                    } else {
                        const f = new Date(p.fecha_fin);
                        fechaFmt = `${String(f.getUTCDate()).padStart(2, '0')}/${String(f.getUTCMonth() + 1).padStart(2, '0')}/${f.getUTCFullYear()}`;
                    }
                } catch(e) {}
            }

            let vigencia = '⏳ Condición: <strong>Hasta agotar stock</strong>';
            if (fechaFmt) {
                vigencia = `📅 Válido hasta el: <strong>${fechaFmt}</strong> (o hasta agotar stock)`;
            }

            html += `
                <div style="background: white; border: 1px solid #fde68a; border-radius: 6px; padding: 10px 14px; box-shadow: 0 1px 2px rgba(245, 158, 11, 0.08);">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                        <div>
                            <strong style="color: #92400e; font-size: 0.94em; text-transform: uppercase; letter-spacing: 0.3px;">${escapeHtml(p.titulo)}</strong>
                            ${descLimpia ? `<p style="font-size: 0.84em; color: #78350f; margin: 3px 0 0 0; line-height: 1.35;">${escapeHtml(descLimpia)}</p>` : ''}
                        </div>
                        <span style="background: linear-gradient(135deg, #f59e0b, #ef4444); color: white; padding: 3px 9px; border-radius: 12px; font-size: 0.78em; font-weight: 800; white-space: nowrap; box-shadow: 0 1px 3px rgba(239, 68, 68, 0.25);">
                            ${badgeDesc}
                        </span>
                    </div>
                    ${artsHtml}
                    
                    <div style="font-size: 0.76em; color: #b45309; margin-top: 8px; border-top: 1px dashed #fef3c7; padding-top: 6px;">
                        ${vigencia}
                    </div>

                    <!-- Letra chica y blindaje comercial -->
                    <div style="margin-top: 6px; padding: 6px 10px; background: #fffdf5; border: 1px dashed #fde68a; border-radius: 4px; font-size: 0.74em; color: #78350f;">
                        <strong style="color: #92400e; display: inline-flex; align-items: center; gap: 4px;">
                            <span>ℹ️</span> Condiciones comerciales:
                        </strong>
                        <div style="margin-top: 3px; line-height: 1.35; color: #854d0e;">
                            • <strong>No acumulable:</strong> No acumulable con la bonificación por volumen (5% en pedidos superiores a $300.000).<br>
                            • <strong>Cuenta al día:</strong> Beneficio comercial exclusivo para pedidos con cuenta al día (saldo $0 / no aplica ante saldos vencidos o deudas pendientes).
                        </div>
                    </div>
                </div>
            `;
        });
    }

    // 2. Renderizar Política Comercial General por Volumen (Escala de Pedidos)
    if (tienePolitica) {
        const pol = politicaComercial;
        const listaNombre = pol.lista_nombre || 'General';
        const primerTramo = pol.tramos[0];
        const montoMinimo = parseFloat(primerTramo.monto_minimo) || 300000;
        const pctDesc = parseFloat(primerTramo.descuento_porcentaje) || 5;

        // Subtotal neto actual del presupuesto para contextualizar al cliente
        const subtotalActual = (totales && totales.neto_total) ? parseFloat(totales.neto_total) : 0;
        const calificaPorMonto = subtotalActual >= montoMinimo;
        const montoMinFmt = montoMinimo.toLocaleString('es-AR');
        const subtotalActualFmt = subtotalActual.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const exigeSaldoCero = pol.exige_saldo_cero !== false;
        const toleranciaSaldo = parseFloat(pol.tolerancia_saldo) != null && !isNaN(parseFloat(pol.tolerancia_saldo)) ? parseFloat(pol.tolerancia_saldo) : 150.00;
        const saldoCC = parseFloat(pol.saldo_cuenta_corriente) || 0;
        const bloqueadoPorSaldo = exigeSaldoCero && (saldoCC > toleranciaSaldo);
        const saldoFmt = Math.abs(saldoCC).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        let estadoCalificacionHtml = '';
        if (subtotalActual > 0) {
            if (bloqueadoPorSaldo) {
                estadoCalificacionHtml = `
                    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; padding: 5px 8px; margin-top: 6px; font-size: 0.76em; color: #991b1b; display: flex; align-items: center; justify-content: space-between;">
                        <span>⛔ <strong>Beneficio retenido por saldo pendiente</strong> (Deuda en cuenta corriente: $${saldoFmt} — Debe regularizar saldo para acceder al descuento)</span>
                        <span style="font-weight: 700; color: #dc2626; background: white; padding: 1px 6px; border-radius: 10px; border: 1px solid #fca5a5;">RETENIDO</span>
                    </div>
                `;
            } else if (calificaPorMonto) {
                estadoCalificacionHtml = `
                    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; padding: 5px 8px; margin-top: 6px; font-size: 0.76em; color: #166534; display: flex; align-items: center; justify-content: space-between;">
                        <span>✅ <strong>¡Este pedido califica para la bonificación!</strong> (Subtotal neto: $${subtotalActualFmt} > $${montoMinFmt}) — Cuenta al día</span>
                        <span style="font-weight: 700; color: #15803d; background: white; padding: 1px 6px; border-radius: 10px; border: 1px solid #86efac;">${pctDesc}% APLICADO</span>
                    </div>
                `;
            } else {
                const restante = (montoMinimo - subtotalActual).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                estadoCalificacionHtml = `
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 5px 8px; margin-top: 6px; font-size: 0.76em; color: #475569; display: flex; align-items: center; justify-content: space-between;">
                        <span>💡 <em>Subtotal neto actual: $${subtotalActualFmt}</em> — Superando los $${montoMinFmt} accede automáticamente al <strong>${pctDesc}% OFF</strong></span>
                        <span style="font-weight: 600; color: #64748b; font-size: 0.9em;">Escala $${montoMinFmt}</span>
                    </div>
                `;
            }
        }

        html += `
            <div style="background: white; border: 1px solid #bfdbfe; border-left: 4px solid #2563eb; border-radius: 6px; padding: 10px 14px; box-shadow: 0 1px 2px rgba(37, 99, 235, 0.08);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <strong style="color: #1e40af; font-size: 0.94em; text-transform: uppercase; letter-spacing: 0.3px;">
                                Bonificación Comercial por Volumen (Lista ${escapeHtml(listaNombre)})
                            </strong>
                        </div>
                        <p style="font-size: 0.84em; color: #1e3a8a; margin: 3px 0 0 0; line-height: 1.35;">
                            Escala comercial automática: Los pedidos que superen los <strong>$${montoMinFmt}</strong> (neto) acceden a una bonificación directa del <strong>${pctDesc}%</strong> sobre productos a precio de lista.
                        </p>
                    </div>
                    <span style="background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 3px 10px; border-radius: 12px; font-size: 0.78em; font-weight: 800; white-space: nowrap; box-shadow: 0 1px 3px rgba(37, 99, 235, 0.25);">
                        ${pctDesc}% OFF
                    </span>
                </div>

                ${estadoCalificacionHtml}

                <!-- Condiciones comerciales obligatorias -->
                <div style="margin-top: 6px; padding: 6px 10px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px; font-size: 0.74em; color: #334155;">
                    <strong style="color: #0f172a; display: inline-flex; align-items: center; gap: 4px;">
                        <span>ℹ️</span> Condiciones comerciales:
                    </strong>
                    <div style="margin-top: 3px; line-height: 1.35; color: #475569;">
                        • <strong>Cuenta al día:</strong> ${exigeSaldoCero ? `Exige saldo en cuenta corriente cancelado (tolerancia hasta $${toleranciaSaldo.toLocaleString('es-AR')}). Estado actual del cliente: ${bloqueadoPorSaldo ? `<strong style="color: #dc2626;">Deuda pendiente de $${saldoFmt}</strong> (descuento bloqueado)` : `<strong style="color: #166534;">Al día ($${saldoCC <= 0 ? '0,00' : saldoFmt})</strong> (habilitado)`}.` : 'No condicionada a saldo de cuenta corriente.'}<br>
                        • <strong>No acumulable:</strong> ${pol.no_acumulable !== false ? 'Aplica sobre los artículos a precio regular de lista; no duplica bonificación sobre productos con ofertas especiales vigentes.' : 'Acumulable con otras promociones activas.'}
                    </div>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

/**
 * Actualiza la información dinámica de política de intereses
 */
function actualizarInfoPoliticaIntereses(politica) {
    if (!politica) return;
    const descEl = document.getElementById('intereses-tasa-descripcion');
    if (descEl && politica.tasa_tem) {
        const tasaDiaria = (politica.tasa_tem / 30).toFixed(2);
        descEl.innerHTML = `Superado el Día 14 (o sin comodines disponibles), se liquida el interés exacto <strong>desde el Día 1 de entrega (${politica.tasa_tem}% TEM mensual / ${tasaDiaria}% diario)</strong> sobre el saldo pendiente, manteniendo la cuenta <strong>habilitada</strong>.`;
    }
    const comEl = document.getElementById('intereses-comodines-descripcion');
    if (comEl && politica.cupo_cortesias_anual != null) {
        const cupo = parseInt(politica.cupo_cortesias_anual, 10) || 3;
        const disp = politica.cortesias_restantes_anio != null ? parseInt(politica.cortesias_restantes_anio, 10) : cupo;
        comEl.innerHTML = `Excepción no habitual (máx. <strong>${cupo} comodines al año</strong>, ~1 por trimestre · Disponibles: <strong>${disp}/${cupo}</strong>). Cancelando hasta el Día 14 con comodín, el interés desde el Día 1 se <strong>bonifica al 100% ($0,00)</strong>.`;
    }
}

/**
 * Normalizar texto para nombre de archivo (eliminar caracteres inválidos de Windows)
 */
function normalizarNombreArchivo(texto) {
    if (!texto) return 'Sin-Datos';

    // Convertir a string y eliminar espacios al inicio/final
    let normalizado = String(texto).trim();

    // Reemplazar caracteres inválidos en Windows: / \ : * ? " < > |
    normalizado = normalizado.replace(/[\/\\:*?"<>|]/g, '-');

    // Reemplazar múltiples espacios o guiones consecutivos por uno solo
    normalizado = normalizado.replace(/\s+/g, ' ').replace(/-+/g, '-');

    // Eliminar espacios y reemplazar por guiones
    normalizado = normalizado.replace(/\s/g, '-');

    // Limitar longitud para evitar nombres muy largos
    if (normalizado.length > 50) {
        normalizado = normalizado.substring(0, 50);
    }

    return normalizado;
}

/**
 * Normalizar fecha para nombre de archivo (formato YYYY-MM-DD)
 */
function normalizarFechaArchivo(fechaString) {
    if (!fechaString) return 'Sin-Fecha';

    try {
        // Si ya está en formato YYYY-MM-DD, usarlo directamente
        if (typeof fechaString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaString)) {
            return fechaString;
        }

        // Convertir a Date y formatear como YYYY-MM-DD
        const fecha = new Date(fechaString);
        const year = fecha.getFullYear();
        const month = String(fecha.getMonth() + 1).padStart(2, '0');
        const day = String(fecha.getDate()).padStart(2, '0');

        return `${year}-${month}-${day}`;
    } catch (error) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] Error al normalizar fecha:', error);
        return 'Fecha-Invalida';
    }
}

/**
 * Actualizar título del documento para nombre de archivo PDF
 */
function actualizarTituloDocumento(presupuesto) {
    console.log('📝 [IMPRIMIR-PRESUPUESTO] Actualizando título del documento para nombre de archivo...');

    // Obtener datos necesarios (NUEVO FORMATO: incluye número de cliente)
    const numeroCliente = presupuesto.id_cliente || 'SIN';
    const numeroPresupuesto = presupuesto.id_presupuesto || presupuesto.id || 'SN';
    const nombreCliente = presupuesto.nombre_cliente || presupuesto.concepto || 'Sin-Cliente';
    const fechaPresupuesto = presupuesto.fecha || null;

    console.log('📊 [IMPRIMIR-PRESUPUESTO] Datos originales para nombre de archivo:');
    console.log(`   - Número de cliente: ${numeroCliente}`);
    console.log(`   - Número de presupuesto: ${numeroPresupuesto}`);
    console.log(`   - Nombre del cliente (original): "${nombreCliente}"`);
    console.log(`   - Fecha del presupuesto (original): "${fechaPresupuesto}"`);

    // Normalizar datos
    // Número de cliente: rellenar con ceros a la izquierda (3 dígitos)
    const numeroClienteNormalizado = String(numeroCliente).padStart(3, '0');
    const numeroPresupuestoNormalizado = String(numeroPresupuesto);
    const clienteNormalizado = normalizarNombreArchivo(nombreCliente);
    const fechaNormalizada = normalizarFechaArchivo(fechaPresupuesto);

    console.log('📊 [IMPRIMIR-PRESUPUESTO] Datos normalizados para nombre de archivo:');
    console.log(`   - Número de cliente (normalizado): ${numeroClienteNormalizado}`);
    console.log(`   - Número de presupuesto: ${numeroPresupuestoNormalizado}`);
    console.log(`   - Nombre del cliente (normalizado): "${clienteNormalizado}"`);
    console.log(`   - Fecha del presupuesto (normalizada): "${fechaNormalizada}"`);

    // Construir nombre de archivo con NUEVO FORMATO:
    // Número de Cliente - Presu - Nombre del Cliente - Número de Presupuesto - Fecha
    const nombreArchivo = `${numeroClienteNormalizado}-Presu-${clienteNormalizado}-${numeroPresupuestoNormalizado}-${fechaNormalizada}`;

    console.log('📄 [IMPRIMIR-PRESUPUESTO] Nombre de archivo final sugerido (NUEVO FORMATO):');
    console.log(`   "${nombreArchivo}.pdf"`);

    // Actualizar título del documento (esto es lo que usa el navegador para el nombre del archivo)
    document.title = nombreArchivo;

    console.log('✅ [IMPRIMIR-PRESUPUESTO] Título del documento actualizado correctamente');
    console.log(`   document.title = "${document.title}"`);
}

/**
 * Renderizar presupuesto en la vista
 */
function renderizarPresupuesto(data) {
    console.log('🎨 [IMPRIMIR-PRESUPUESTO] Renderizando presupuesto...');

    const { presupuesto, detalles, totales } = data;

    // Ocultar loading y mostrar contenido
    ocultarLoading();

    // Título dinámico: "PRESUPUESTO" o "ORDEN DE RETIRO / DEVOLUCIÓN"
    const tituloDoc = presupuesto.estado === 'Orden de Retiro'
        ? 'ORDEN DE RETIRO / DEVOLUCIÓN'
        : 'PRESUPUESTO';

    const docTipoEl = document.getElementById('documento-tipo');
    if (docTipoEl) docTipoEl.textContent = tituloDoc;

    const cabeceraTituloEl = document.getElementById('cabecera-titulo');
    if (cabeceraTituloEl) {
        cabeceraTituloEl.textContent = tituloDoc;
    }

    // Opcional: Estilo diferenciado
    if (presupuesto.estado === 'Orden de Retiro') {
        if (docTipoEl) docTipoEl.style.color = '#d35400'; // Naranja oscuro para diferenciar
        if (cabeceraTituloEl) cabeceraTituloEl.style.color = '#d35400';
    } else {
        if (docTipoEl) docTipoEl.style.color = ''; // Reset
        if (cabeceraTituloEl) cabeceraTituloEl.style.color = ''; // Reset (use CSS Petrol default)
    }

    // NUEVO: Actualizar título del documento para nombre de archivo PDF
    actualizarTituloDocumento(presupuesto);

    // Número de presupuesto
    document.getElementById('presupuesto-numero').textContent =
        presupuesto.id_presupuesto || presupuesto.id || '-';

    // Información del presupuesto (solo fecha)
    document.getElementById('presupuesto-fecha').textContent =
        formatearFecha(presupuesto.fecha) || '-';

    // Información del cliente (solo número y nombre)
    document.getElementById('cliente-numero').textContent =
        presupuesto.id_cliente || '-';

    // Obtener nombre del cliente desde concepto o campo específico
    const nombreCliente = presupuesto.nombre_cliente ||
        presupuesto.concepto ||
        'Sin nombre';
    document.getElementById('cliente-nombre').textContent = nombreCliente;

    // Renderizar artículos
    renderizarArticulos(detalles);
    
    // Renderizar faltantes si los hay
    if (data.detalles_sin_stock && data.detalles_sin_stock.length > 0) {
        renderizarFaltantes(data.detalles_sin_stock);
        document.getElementById('faltantes-section').style.display = 'block';
    } else {
        document.getElementById('faltantes-section').style.display = 'none';
        // Hide the checkbox UI if no missing items exist
        const chkContainer = document.getElementById('chk-faltantes')?.closest('.formato-selector');
        if(chkContainer) chkContainer.style.display = 'none';
    }

    // Renderizar totales
    renderizarTotales(presupuesto, totales);

    // Renderizar condición comercial
    cargarCondicionComercial(presupuesto);

    // Observaciones (si existen)
    if (presupuesto.nota && presupuesto.nota.trim()) {
        document.getElementById('observaciones-section').style.display = 'block';
        document.getElementById('presupuesto-nota').textContent = presupuesto.nota;
    }

    // Fecha de generación
    document.getElementById('fecha-generacion').textContent =
        new Date().toLocaleDateString('es-AR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

    // Generar código de barras
    generarCodigoBarras(presupuesto.id_presupuesto || presupuesto.id);

    // Aplicar reactivamente el estado actual del checkbox de modo solo lista
    window.toggleSoloLista();

    console.log('✅ [IMPRIMIR-PRESUPUESTO] Presupuesto renderizado correctamente');
}

/**
 * Cargar y renderizar la condición comercial del cliente o consulta genérica para prospectos.
 * REGLA DE NEGOCIO: Esta sección SOLO aplica cuando se activa el Modo Solo Lista (Consulta de Precios).
 * En presupuestos consolidados (con totales y precios definidos), NO se muestra esta nota.
 */
async function cargarCondicionComercial(presupuesto) {
    const sec = document.getElementById('condicion-comercial-section');
    const txt = document.getElementById('condicion-comercial-texto');
    if (!sec || !txt) return;

    // Solo mostrar si está explícitamente activo el Modo Solo Lista (Consulta de Precios)
    const isSoloLista = document.getElementById('chk-solo-lista')?.checked;
    if (!isSoloLista) {
        sec.style.display = 'none';
        return;
    }

    const clienteId = presupuesto.id_cliente;
    const esProspecto = !clienteId || clienteId === '0' || String(clienteId).toLowerCase().includes('prospecto') || (presupuesto.concepto && presupuesto.concepto.toLowerCase().includes('prospecto'));

    if (esProspecto) {
        txt.textContent = 'Consulte por bonificaciones y escalas de descuento comercial por volumen.';
        sec.style.display = 'block';
        return;
    }

    try {
        const res = await fetch(`/api/presupuestos/politicas/cliente/${clienteId}`);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.data && data.data.tiene_politica && !data.data.excepcion) {
                const tramos = data.data.politica?.tramos || [];
                if (tramos.length > 0) {
                    const desc = tramos.map(t => {
                        const min = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(parseFloat(t.monto_minimo));
                        return `Superando ${min}: ${parseFloat(t.descuento_porcentaje).toFixed(1)}% de bonificación automática`;
                    }).join(' | ');
                    txt.textContent = desc;
                    sec.style.display = 'block';
                    return;
                }
            }
        }
    } catch (e) {
        console.warn('Error al cargar condición comercial en impresión:', e);
    }

    txt.textContent = 'Consulte por bonificaciones y escalas de descuento comercial por volumen.';
    sec.style.display = 'block';
}

/**
 * Generar código de barras del número de presupuesto
 */
function generarCodigoBarras(numeroPresupuesto) {
    try {
        console.log('📊 [IMPRIMIR-PRESUPUESTO] Generando código de barras:', numeroPresupuesto);

        const barcodeElement = document.getElementById('barcode');

        if (!barcodeElement) {
            console.warn('⚠️ [IMPRIMIR-PRESUPUESTO] Elemento barcode no encontrado');
            return;
        }

        // Verificar que JsBarcode esté disponible
        if (typeof JsBarcode === 'undefined') {
            console.error('❌ [IMPRIMIR-PRESUPUESTO] JsBarcode no está cargado');
            return;
        }

        // Generar código de barras CODE128 (Principal del Presupuesto)
        JsBarcode(barcodeElement, String(numeroPresupuesto), {
            format: 'CODE128',
            width: 2,
            height: 60,
            displayValue: true,
            fontSize: 14,
            margin: 10,
            background: '#ffffff',
            lineColor: '#000000'
        });
        
        // ==========================================
        // INYECCIÓN RELATIVA HARDWARE (SIN ROMPER PAGINACIÓN)
        // ==========================================
        const barcodeContainer = barcodeElement.parentElement;
        
        // Evitar inyecciones duplicadas si la función se llama varias veces para el mismo remito
        if (barcodeContainer && !barcodeContainer.parentElement.querySelector('.comandos-hardware-relativos')) {
            const footerRelativo = document.createElement('div');
            footerRelativo.className = 'comandos-hardware-relativos';
            // Verificar contexto para inyectar comandos ON/OFF de hardware
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('contexto') === 'produccion') {
                // Se incrementó 1cm extra a pedido de QA (Ahora 3cm total)
                footerRelativo.style.marginTop = '3cm';
                footerRelativo.style.display = 'flex';
                footerRelativo.style.justifyContent = 'space-between';
                footerRelativo.style.padding = '0 1cm';
                footerRelativo.style.boxSizing = 'border-box';
                footerRelativo.style.width = '100%';
                footerRelativo.style.pageBreakInside = 'avoid';

                // Contenedor IZQUIERDO (ON)
                const wrapperON = document.createElement('div');
                wrapperON.style.textAlign = 'center';
                
                const imgON = document.createElement('img');
                imgON.style.height = '25px';
                imgON.id = 'barcode-cmd-iniciar'; // Vigía depurador
                
                const textON = document.createElement('div');
                textON.textContent = 'ON';
                textON.style.fontSize = '8pt';
                textON.style.fontWeight = 'bold';

                wrapperON.appendChild(imgON);
                wrapperON.appendChild(textON);

                // Contenedor DERECHO (OFF)
                const wrapperOFF = document.createElement('div');
                wrapperOFF.style.textAlign = 'center';
                
                const imgOFF = document.createElement('img');
                imgOFF.style.height = '25px';
                imgOFF.id = 'barcode-cmd-finalizar'; // Vigía depurador
                
                const textOFF = document.createElement('div');
                textOFF.textContent = 'OFF';
                textOFF.style.fontSize = '8pt';
                textOFF.style.fontWeight = 'bold';

                wrapperOFF.appendChild(imgOFF);
                wrapperOFF.appendChild(textOFF);

                // Armar estructura
                footerRelativo.appendChild(wrapperON);
                footerRelativo.appendChild(wrapperOFF);
                
                // Inyectar justo después del contenedor del código de barras principal
                barcodeContainer.parentElement.appendChild(footerRelativo);

                // Renderizar Barcodes estandarizados a tamaño principal
                JsBarcode(imgON, "CMD-ON", {
                    format: 'CODE128',
                    width: 2, 
                    height: 60, 
                    displayValue: false, 
                    margin: 0
                });

                JsBarcode(imgOFF, "CMD-OFF", {
                    format: 'CODE128',
                    width: 2, 
                    height: 60, 
                    displayValue: false, 
                    margin: 0
                });
                
                console.log('✅ [IMPRIMIR-PRESUPUESTO] Footer relativo inyectado correctamente');
            } else {
                console.log('✅ [IMPRIMIR-PRESUPUESTO] Footer de comandos omitido (No es contexto de Producción)');
            }

        }

        console.log('✅ [IMPRIMIR-PRESUPUESTO] Código de barras generado correctamente');

    } catch (error) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] Error generando código de barras:', error);
    }
}

/**
 * Renderizar tabla de artículos según formato
 */
function renderizarArticulos(detalles) {
    console.log(`🔍 [IMPRIMIR-PRESUPUESTO] Renderizando ${detalles.length} artículos en formato: ${formatoActual}`);

    // Obtener referencias a ambas tablas
    const tablaDiscriminado = document.getElementById('tabla-discriminado');
    const tablaIncluido = document.getElementById('tabla-incluido');
    const tbodyDiscriminado = document.getElementById('articulos-tbody-discriminado');
    const tbodyIncluido = document.getElementById('articulos-tbody-incluido');

    if (!tablaDiscriminado || !tablaIncluido || !tbodyDiscriminado || !tbodyIncluido) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] No se encontraron las tablas de artículos');
        return;
    }

    // Mostrar/ocultar tablas según formato
    if (formatoActual === 'IVA_DISCRIMINADO') {
        tablaDiscriminado.style.display = 'table';
        tablaIncluido.style.display = 'none';
    } else {
        tablaDiscriminado.style.display = 'none';
        tablaIncluido.style.display = 'table';
    }

    if (!detalles || detalles.length === 0) {
        const mensajeVacio = `
            <tr>
                <td colspan="${formatoActual === 'IVA_DISCRIMINADO' ? '5' : '4'}" class="text-center">
                    No hay artículos en este presupuesto
                </td>
            </tr>
        `;
        tbodyDiscriminado.innerHTML = mensajeVacio;
        tbodyIncluido.innerHTML = mensajeVacio;
        return;
    }

    // -------------------------------------------------------------
    // HEURÍSTICA DE KIT: Detectar insumos que siguen a una mezcla
    // -------------------------------------------------------------
    let isAfterBase = false;
    const detallesProcesados = detalles.map(item => {
        let descripcion = item.descripcion_articulo || item.descripcion || item.articulo || 'Sin descripción';
        const descLower = descripcion.toLowerCase();
        let isKit = false;
        
        if (descLower.includes('mezcla') || descLower.includes('mix')) {
            isAfterBase = true;
        } else if (isAfterBase && (descLower.includes('miel') || descLower.includes('coco') || descLower.includes('insumo'))) {
            isKit = true;
            descripcion = `↳ [Kit] ${descripcion}`;
        } else {
            isAfterBase = false;
        }
        
        return {
            ...item,
            descripcionMostrar: descripcion,
            isKit: isKit
        };
    });

    const descGeneralPct = (parseFloat(presupuestoData.presupuesto?.descuento) || 0) * 100;

    if (formatoActual === 'IVA_DISCRIMINADO') {
        // FORMATO A: Con columna IVA
        tbodyDiscriminado.innerHTML = detallesProcesados.map(item => {
            const cantidad = parseFloat(item.cantidad) || 0;
            const valor1 = parseFloat(item.valor1) || 0; // Precio SIN IVA
            const camp2 = parseFloat(item.camp2) || 0; // Alícuota IVA decimal
            const descEsp = parseFloat(item.descuento_adicional) || 0;

            // Convertir camp2 a porcentaje para mostrar
            const ivaPorcentaje = camp2 * 100; // 0.210 -> 21, 0.105 -> 10.5

            // Precios SIN IVA
            const precioUnitario = valor1;
            const subtotalLinea = cantidad * valor1;

            const extraStyle = item.isKit ? 'color: #475569; font-style: italic;' : '';
            const badgeDescEsp = descEsp > 0
                ? `<span class="badge-descuento-linea" style="display: block; font-size: 0.82em; color: #15803d; font-weight: 600; margin-top: 3px;">🏷️ Bonificación especial: ${formatearNumero(descEsp)}% (Desc. total aplicado: ${formatearNumero(descGeneralPct + descEsp)}%)</span>`
                : '';

            return `
                <tr style="${extraStyle}">
                    <td>
                        <span class="articulo-descripcion">${escapeHtml(item.descripcionMostrar)}</span>
                        ${badgeDescEsp}
                    </td>
                    <td class="text-center">${formatearNumero(cantidad)}</td>
                    <td class="text-right">$ ${formatearNumero(precioUnitario)}</td>
                    <td class="text-center">${formatearNumero(ivaPorcentaje)}%</td>
                    <td class="text-right">$ ${formatearNumero(subtotalLinea)}</td>
                </tr>
            `;
        }).join('');

    } else {
        // FORMATO B: Sin columna IVA
        tbodyIncluido.innerHTML = detallesProcesados.map(item => {
            const cantidad = parseFloat(item.cantidad) || 0;
            const valor1 = parseFloat(item.valor1) || 0; // Precio SIN IVA
            const camp2 = parseFloat(item.camp2) || 0; // Alícuota IVA decimal
            const descEsp = parseFloat(item.descuento_adicional) || 0;

            // Precios CON IVA incluido
            const precioUnitario = valor1 * (1 + camp2);
            const subtotalLinea = cantidad * precioUnitario;

            const extraStyle = item.isKit ? 'color: #475569; font-style: italic;' : '';
            const badgeDescEsp = descEsp > 0
                ? `<span class="badge-descuento-linea" style="display: block; font-size: 0.82em; color: #15803d; font-weight: 600; margin-top: 3px;">🏷️ Bonificación especial: ${formatearNumero(descEsp)}% (Desc. total aplicado: ${formatearNumero(descGeneralPct + descEsp)}%)</span>`
                : '';

            return `
                <tr style="${extraStyle}">
                    <td>
                        <span class="articulo-descripcion">${escapeHtml(item.descripcionMostrar)}</span>
                        ${badgeDescEsp}
                    </td>
                    <td class="text-center">${formatearNumero(cantidad)}</td>
                    <td class="text-right">$ ${formatearNumero(precioUnitario)}</td>
                    <td class="text-right">$ ${formatearNumero(subtotalLinea)}</td>
                </tr>
            `;
        }).join('');
    }

    console.log(`✅ [IMPRIMIR-PRESUPUESTO] Artículos renderizados en formato: ${formatoActual}`);
}

/**
 * Renderiza la sección de Faltantes (Sin Disponibilidad)
 */
function renderizarFaltantes(detallesSinStock) {
    console.log('🎨 [IMPRIMIR-PRESUPUESTO] Renderizando faltantes...');
    const tbodyFaltantes = document.getElementById('articulos-tbody-faltantes');
    if (!tbodyFaltantes) return;

    if (!detallesSinStock || detallesSinStock.length === 0) {
        tbodyFaltantes.innerHTML = '<tr><td colspan="3" class="text-center">No hay artículos faltantes registrados.</td></tr>';
        return;
    }

    tbodyFaltantes.innerHTML = detallesSinStock.map(item => {
        const cantidad = parseFloat(item.cantidad) || 0;
        const descripcion = item.descripcion || item.articulo || 'Sin descripción';

        return `
            <tr>
                <td>
                    <span class="articulo-descripcion" style="color:#d35400;">${escapeHtml(descripcion)}</span>
                </td>
                <td class="text-center" style="color:#d35400;">${cantidad}</td>
                <td class="text-right" style="color:#7f8c8d; font-style: italic; font-size: 0.9em;">Sin disponibilidad</td>
            </tr>
        `;
    }).join('');
}

/**
 * Toggle section faltantes via checkbox
 */
window.toggleFaltantes = function() {
    const chk = document.getElementById('chk-faltantes');
    const seccionFaltantes = document.getElementById('faltantes-section');
    if (!chk || !seccionFaltantes) return;

    if (chk.checked && presupuestoData && presupuestoData.detalles_sin_stock && presupuestoData.detalles_sin_stock.length > 0) {
        seccionFaltantes.style.display = 'block';
    } else {
        seccionFaltantes.style.display = 'none';
    }
};

/**
 * Renderizar totales según formato seleccionado
 */
function renderizarTotales(presupuesto, totales) {
    console.log(`🔍 [IMPRIMIR-PRESUPUESTO] Renderizando totales en formato: ${formatoActual}`);

    const detalles = presupuestoData.detalles;

    if (formatoActual === 'IVA_DISCRIMINADO') {
        // FORMATO A: IVA DISCRIMINADO (modelo actual)
        renderizarTotalesDiscriminado(presupuesto, detalles);
    } else {
        // FORMATO B: IVA INCLUIDO (nuevo modelo)
        renderizarTotalesIncluido(presupuesto, detalles);
    }
}

/**
 * Renderizar totales con IVA DISCRIMINADO
 */
function renderizarTotalesDiscriminado(presupuesto, detalles) {
    console.log('📊 [TOTALES-DISCRIMINADO] Calculando totales con IVA discriminado...');

    // 1. SUBTOTAL GENERAL (suma de cantidad * valor1 de cada línea)
    const subtotalGeneral = detalles.reduce((total, item) => {
        const cantidad = parseFloat(item.cantidad) || 0;
        const valor1 = parseFloat(item.valor1) || 0;
        return total + (cantidad * valor1);
    }, 0);

    console.log('📊 [TOTALES-DISCRIMINADO] Subtotal General:', subtotalGeneral);

    // 2. DESCUENTOS
    const descuentoDecimal = parseFloat(presupuesto.descuento) || 0;
    const descuentoPorcentaje = descuentoDecimal * 100; // 0.05 -> 5%
    const montoDescuentoGeneral = subtotalGeneral * descuentoDecimal;

    let montoDescuentosEspeciales = 0;
    detalles.forEach(item => {
        const cantidad = parseFloat(item.cantidad) || 0;
        const valor1 = parseFloat(item.valor1) || 0;
        const descEsp = parseFloat(item.descuento_adicional) || 0;
        if (descEsp > 0) {
            montoDescuentosEspeciales += (cantidad * valor1) * (descEsp / 100);
        }
    });

    const baseConDescuento = subtotalGeneral - montoDescuentoGeneral - montoDescuentosEspeciales;

    console.log('📊 [TOTALES-DISCRIMINADO] Descuentos:', {
        generalPct: descuentoPorcentaje,
        montoGeneral: montoDescuentoGeneral,
        montoEspeciales: montoDescuentosEspeciales,
        baseConDescuento
    });

    // 3. IVA POR ALÍCUOTA (21% y 10.5%)
    let iva21Total = 0;
    let iva105Total = 0;

    detalles.forEach(item => {
        const cantidad = parseFloat(item.cantidad) || 0;
        const valor1 = parseFloat(item.valor1) || 0;
        const camp2 = parseFloat(item.camp2) || 0; // Alícuota IVA como decimal
        const descEsp = parseFloat(item.descuento_adicional) || 0;

        // Subtotal de la línea
        const subtotalLinea = cantidad * valor1;
        const descTotalLinea = (descuentoPorcentaje + descEsp) / 100;

        // Base de cálculo (con descuento total aplicado a esta línea)
        const baseLinea = descTotalLinea > 0
            ? subtotalLinea * (1 - descTotalLinea)
            : subtotalLinea;

        // IVA de la línea
        const ivaLinea = baseLinea * camp2;

        // Acumular por alícuota
        if (Math.abs(camp2 - 0.210) < 0.001) {
            // IVA 21%
            iva21Total += ivaLinea;
        } else if (Math.abs(camp2 - 0.105) < 0.001) {
            // IVA 10.5%
            iva105Total += ivaLinea;
        }
    });

    console.log('📊 [TOTALES-DISCRIMINADO] IVA:', {
        iva21: iva21Total,
        iva105: iva105Total
    });

    // 4. TOTAL FINAL
    const totalFinal = baseConDescuento + iva21Total + iva105Total;

    console.log('📊 [TOTALES-DISCRIMINADO] Total Final:', totalFinal);

    // ACTUALIZAR UI
    document.getElementById('total-subtotal').textContent = `$ ${formatearNumero(subtotalGeneral)}`;

    // Mostrar descuento general solo si existe
    if (descuentoPorcentaje > 0) {
        document.getElementById('descuento-row').style.display = 'flex';
        document.getElementById('descuento-porcentaje').textContent = formatearNumero(descuentoPorcentaje);
        document.getElementById('total-descuento').textContent = `-$ ${formatearNumero(montoDescuentoGeneral)}`;
    } else {
        document.getElementById('descuento-row').style.display = 'none';
    }

    // Mostrar descuentos especiales solo si existen
    const rowDescEsp = document.getElementById('descuentos-especiales-row');
    if (rowDescEsp) {
        if (montoDescuentosEspeciales > 0) {
            rowDescEsp.style.display = 'flex';
            document.getElementById('total-descuentos-especiales').textContent = `-$ ${formatearNumero(montoDescuentosEspeciales)}`;
        } else {
            rowDescEsp.style.display = 'none';
        }
    }

    // Mostrar IVA 21% solo si existe
    if (iva21Total > 0) {
        document.getElementById('iva-21-row').style.display = 'flex';
        document.getElementById('total-iva-21').textContent = `$ ${formatearNumero(iva21Total)}`;
    } else {
        document.getElementById('iva-21-row').style.display = 'none';
    }

    // Mostrar IVA 10.5% solo si existe
    if (iva105Total > 0) {
        document.getElementById('iva-105-row').style.display = 'flex';
        document.getElementById('total-iva-105').textContent = `$ ${formatearNumero(iva105Total)}`;
    } else {
        document.getElementById('iva-105-row').style.display = 'none';
    }

    document.getElementById('total-final').textContent = `$ ${formatearNumero(totalFinal)}`;

    console.log('✅ [TOTALES-DISCRIMINADO] Totales renderizados correctamente');
}

/**
 * Renderizar totales con IVA INCLUIDO
 */
function renderizarTotalesIncluido(presupuesto, detalles) {
    console.log('💰 [TOTALES-INCLUIDO] Calculando totales con IVA incluido...');

    // 1. SUBTOTAL GENERAL CON IVA (suma de cantidad * valor1 * (1 + camp2))
    const subtotalGeneral = detalles.reduce((total, item) => {
        const cantidad = parseFloat(item.cantidad) || 0;
        const valor1 = parseFloat(item.valor1) || 0;
        const camp2 = parseFloat(item.camp2) || 0;
        const precioConIva = valor1 * (1 + camp2);
        return total + (cantidad * precioConIva);
    }, 0);

    console.log('💰 [TOTALES-INCLUIDO] Subtotal General (con IVA):', subtotalGeneral);

    // 2. DESCUENTOS
    const descuentoDecimal = parseFloat(presupuesto.descuento) || 0;
    const descuentoPorcentaje = descuentoDecimal * 100; // 0.05 -> 5%
    const montoDescuentoGeneral = subtotalGeneral * descuentoDecimal;

    let montoDescuentosEspeciales = 0;
    detalles.forEach(item => {
        const cantidad = parseFloat(item.cantidad) || 0;
        const valor1 = parseFloat(item.valor1) || 0;
        const camp2 = parseFloat(item.camp2) || 0;
        const precioConIva = valor1 * (1 + camp2);
        const descEsp = parseFloat(item.descuento_adicional) || 0;
        if (descEsp > 0) {
            montoDescuentosEspeciales += (cantidad * precioConIva) * (descEsp / 100);
        }
    });

    const totalFinal = subtotalGeneral - montoDescuentoGeneral - montoDescuentosEspeciales;

    console.log('💰 [TOTALES-INCLUIDO] Descuentos:', {
        generalPct: descuentoPorcentaje,
        montoGeneral: montoDescuentoGeneral,
        montoEspeciales: montoDescuentosEspeciales,
        totalFinal
    });

    // ACTUALIZAR UI (solo subtotal, descuento y total - SIN filas de IVA)
    document.getElementById('total-subtotal').textContent = `$ ${formatearNumero(subtotalGeneral)}`;

    // Mostrar descuento general solo si existe
    if (descuentoPorcentaje > 0) {
        document.getElementById('descuento-row').style.display = 'flex';
        document.getElementById('descuento-porcentaje').textContent = formatearNumero(descuentoPorcentaje);
        document.getElementById('total-descuento').textContent = `-$ ${formatearNumero(montoDescuentoGeneral)}`;
    } else {
        document.getElementById('descuento-row').style.display = 'none';
    }

    // Mostrar descuentos especiales solo si existen
    const rowDescEsp = document.getElementById('descuentos-especiales-row');
    if (rowDescEsp) {
        if (montoDescuentosEspeciales > 0) {
            rowDescEsp.style.display = 'flex';
            document.getElementById('total-descuentos-especiales').textContent = `-$ ${formatearNumero(montoDescuentosEspeciales)}`;
        } else {
            rowDescEsp.style.display = 'none';
        }
    }

    // OCULTAR filas de IVA en formato incluido
    document.getElementById('iva-21-row').style.display = 'none';
    document.getElementById('iva-105-row').style.display = 'none';

    document.getElementById('total-final').textContent = `$ ${formatearNumero(totalFinal)}`;

    console.log('✅ [TOTALES-INCLUIDO] Totales renderizados correctamente');
}

/**
 * Disparar impresión del navegador
 */
function imprimirPresupuesto() {
    console.log('🖨️ [IMPRIMIR-PRESUPUESTO] Iniciando impresión...');

    // Verificar que hay datos cargados
    if (!presupuestoData) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] No hay datos para imprimir');
        alert('No hay datos cargados para imprimir');
        return;
    }

    // Delay controlado (500ms) para garantizar el dibujo y flush (Race-condition / batch fixes)
    setTimeout(() => {
        // --- VIGÍA DEPURADOR DE REDERIZADO DE COMANDOS (EVIDENCIA QA) ---
        console.log('🔍 [VIGÍA DEPURADOR] ESTADO DEL DOM ANTES DE IMPRESIÓN');
        
        const header = document.querySelector('.empresa-header');
        if (header) {
            console.log('📌 HEADER (Comando ON):', header.innerHTML.substring(0, 300) + '...');
            const imgStart = document.getElementById('barcode-cmd-iniciar');
            console.log('   -> Imagen START Base64 (Validez):', imgStart ? (imgStart.src.startsWith('data:image') ? 'OK (Base64 Generado)' : 'FALLA (Mala fuente)') : 'NO EXISTE');
        }

        const totalsContainer = document.querySelector('.totales-barcode-container .barcode-left');
        if (totalsContainer) {
            console.log('📌 FOOTER/TOTALES (Comando OFF):', totalsContainer.innerHTML.substring(0, 300) + '...');
            const imgEnd = document.getElementById('barcode-cmd-finalizar');
            console.log('   -> Imagen END Base64 (Validez):', imgEnd ? (imgEnd.src.startsWith('data:image') ? 'OK (Base64 Generado)' : 'FALLA (Mala fuente)') : 'NO EXISTE');
        }
        console.log('========================================================');

        // Disparar diálogo de impresión del navegador
        window.print();
        console.log('✅ [IMPRIMIR-PRESUPUESTO] Diálogo de impresión abierto');
    }, 500);
}

function volverALista() {
    console.log('🔙 [IMPRIMIR-PRESUPUESTO] Volviendo a lista de presupuestos...');

    // Soporte PWA: Volver al menú móvil si vinimos de ahí
    if (new URLSearchParams(window.location.search).get('origen') === 'mobile') {
        window.history.back();
        return;
    }

    // Volver a la página de presupuestos (modo Desktop)
    window.location.href = '/pages/presupuestos.html';
}

/**
 * Mostrar loading
 */
function mostrarLoading() {
    const loadingContainer = document.getElementById('loading-container');
    const contentContainer = document.getElementById('presupuesto-content');
    const errorContainer = document.getElementById('error-container');

    if (loadingContainer) loadingContainer.style.display = 'flex';
    if (contentContainer) contentContainer.style.display = 'none';
    if (errorContainer) errorContainer.style.display = 'none';
}

/**
 * Ocultar loading y mostrar contenido
 */
function ocultarLoading() {
    const loadingContainer = document.getElementById('loading-container');
    const contentContainer = document.getElementById('presupuesto-content');

    if (loadingContainer) loadingContainer.style.display = 'none';
    if (contentContainer) contentContainer.style.display = 'block';
}

/**
 * Mostrar error
 */
function mostrarError(mensaje) {
    console.error('❌ [IMPRIMIR-PRESUPUESTO] Mostrando error:', mensaje);

    const loadingContainer = document.getElementById('loading-container');
    const contentContainer = document.getElementById('presupuesto-content');
    const errorContainer = document.getElementById('error-container');
    const errorMessage = document.getElementById('error-message');

    if (loadingContainer) loadingContainer.style.display = 'none';
    if (contentContainer) contentContainer.style.display = 'none';
    if (errorContainer) errorContainer.style.display = 'flex';
    if (errorMessage) errorMessage.textContent = mensaje;
}

/**
 * Formatear fecha en formato DD/MM/YYYY
 */
function formatearFecha(fechaString) {
    if (!fechaString) return null;

    try {
        // Si es formato YYYY-MM-DD
        if (typeof fechaString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaString)) {
            const [year, month, day] = fechaString.split('-');
            return `${day}/${month}/${year}`;
        }

        // Fallback para otros formatos
        const fecha = new Date(fechaString);
        const day = String(fecha.getDate()).padStart(2, '0');
        const month = String(fecha.getMonth() + 1).padStart(2, '0');
        const year = fecha.getFullYear();

        return `${day}/${month}/${year}`;
    } catch (error) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] Error al formatear fecha:', error);
        return fechaString;
    }
}

/**
 * Formatear número con separadores de miles y decimales
 */
function formatearNumero(numero) {
    const num = parseFloat(numero);

    if (isNaN(num)) return '0,00';

    return new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
}

/**
 * Escapar HTML para prevenir XSS
 */
function escapeHtml(text) {
    if (!text) return '';

    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Exponer funciones globalmente para uso en HTML
 */
window.imprimirPresupuesto = imprimirPresupuesto;
window.volverALista = volverALista;
window.cambiarFormato = cambiarFormato;
window.enviarPresupuestoWhatsApp = enviarPresupuestoOmnicanal;
window.enviarPresupuestoOmnicanal = enviarPresupuestoOmnicanal;
/**
 * Formateo y Normalización de Teléfonos Argentinos (con soporte AMBA e interior)
 */
const PREFIJOS_3 = new Set([
    '221', '223', '261', '264', '280', '291', '299',
    '341', '342', '343', '351', '353', '358', '362', '370', '376', '379',
    '381', '383', '385', '387', '388'
]);

function stripLocal15(numberStr) {
    if (!numberStr) return '';
    if (numberStr.startsWith('11') && numberStr.length === 10 && numberStr.substring(2, 4) === '15') {
        return '11' + numberStr.substring(4);
    }
    const prefix3 = numberStr.substring(0, 3);
    if (numberStr.length === 12 && numberStr.substring(3, 5) === '15') {
        return prefix3 + numberStr.substring(5);
    }
    const prefix4 = numberStr.substring(0, 4);
    if (numberStr.length === 12 && numberStr.substring(4, 6) === '15') {
        return prefix4 + numberStr.substring(6);
    }
    return numberStr;
}

function cleanInputForFormatting(val) {
    let clean = (val || '').replace(/\D/g, '');
    if (clean.startsWith('540')) {
        clean = '549' + clean.substring(3);
    } else if (clean.startsWith('54') && clean.length > 2 && !clean.startsWith('549')) {
        clean = '549' + clean.substring(2);
    }
    if (!clean.startsWith('54') && clean.startsWith('0') && clean.length > 1) {
        clean = clean.substring(1);
    }
    clean = stripLocal15(clean);
    return clean;
}

function formatArgentinePhone(cleanDigits) {
    if (!cleanDigits) return '';
    let isInternational = false;
    let base = cleanDigits;
    
    if (cleanDigits.startsWith('549')) {
        isInternational = true;
        base = cleanDigits.substring(3);
    } else if (cleanDigits.startsWith('54')) {
        isInternational = true;
        base = cleanDigits.substring(2);
    }
    
    let formattedBase = '';
    if (base.startsWith('11')) {
        const area = base.substring(0, 2);
        const sub = base.substring(2);
        if (sub.length > 4) {
            formattedBase = `(${area}) ${sub.substring(0, 4)}-${sub.substring(4, 8)}`;
        } else if (sub.length > 0) {
            formattedBase = `(${area}) ${sub}`;
        } else {
            formattedBase = `(${area})`;
        }
    } else {
        let prefixLength = 4;
        if (base.length >= 3) {
            const prefix3 = base.substring(0, 3);
            if (PREFIJOS_3.has(prefix3)) {
                prefixLength = 3;
            }
        }
        
        const area = base.substring(0, prefixLength);
        const sub = base.substring(prefixLength);
        
        if (prefixLength === 3) {
            if (sub.length > 3) {
                formattedBase = `(${area}) ${sub.substring(0, 3)}-${sub.substring(3, 7)}`;
            } else if (sub.length > 0) {
                formattedBase = `(${area}) ${sub}`;
            } else if (area.length > 0) {
                formattedBase = `(${area})`;
            }
        } else {
            if (sub.length > 2) {
                formattedBase = `(${area}) ${sub.substring(0, 2)}-${sub.substring(2, 6)}`;
            } else if (sub.length > 0) {
                formattedBase = `(${area}) ${sub}`;
            } else if (area.length > 0) {
                formattedBase = `(${area})`;
            }
        }
    }
    
    if (isInternational) {
        return `+54 9 ${formattedBase}`;
    }
    return formattedBase;
}

/**
 * Resuelve el teléfono de WhatsApp del cliente
 */
function resolverTelefonoCliente(presupuesto) {
    let telefono = '';
    
    // 1. Preferir whatsapp configurado en Bunker
    if (presupuesto.whatsapp_bunker) {
        telefono = presupuesto.whatsapp_bunker;
    } else {
        // 2. Si no, celular o telefono de lomasoft
        telefono = presupuesto.celular || presupuesto.telefono || '';
    }

    // 3. Si es un JSON array de contactos múltiples
    if (telefono && telefono.trim().startsWith('[')) {
        try {
            const contactos = JSON.parse(telefono);
            telefono = contactos.map(c => c.numero || c.celular || '').filter(n => n && n.trim()).join(', ');
        } catch (e) {
            console.error('Error parseando JSON de contactos:', e);
        }
    }

    return telefono.trim();
}

/**
 * Genera el PDF del presupuesto en el backend y lo envía por WhatsApp y/o Email usando los servicios del puerto 3004/3003
 */
async function enviarPresupuestoOmnicanal() {
    console.log('📤 [OMNICANAL-FRONT] Iniciando flujo de despacho omnicanal...');

    if (!presupuestoData || !presupuestoData.presupuesto) {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No hay datos de presupuesto cargados'
        });
        return;
    }

    const presupuesto = presupuestoData.presupuesto;

    // Generar el mensaje por defecto con el Alias simplificado
    const isSoloLista = document.getElementById('chk-solo-lista')?.checked || false;
    const isPromos = document.getElementById('chk-promos')?.checked || false;
    const isPagos = document.getElementById('chk-pagos')?.checked || false;
    const isIntereses = document.getElementById('chk-intereses')?.checked || false;

    let defaultMensaje = '';
    if (isSoloLista) {
        defaultMensaje = `Hola, te enviamos la consulta de precios de LAMDA. Saludos.`;
    } else {
        let transferInfo = '\n\n*Datos para transferencia:*\n*ALIAS:* LAMDA.SER.MARTIN';
        if (isPagos) {
            transferInfo = '\n\n*Formas de pago:* Sobres (efectivo), Transferencia (Alias: LAMDA.SER.MARTIN) o Cajero Galicia.';
        }
        let promoInfo = '';
        if (isPromos) {
            promoInfo = '\n🏷️ *¡Incluye promociones y ofertas vigentes al final del documento!*';
        }
        const tituloDoc = presupuesto.estado === 'Orden de Retiro' ? 'Orden de Retiro / Devolución' : 'Presupuesto';
        defaultMensaje = `Hola, te enviamos el ${tituloDoc.toLowerCase()} N° ${presupuestoId} de LAMDA. Saludos.` + transferInfo + promoInfo;
    }

    // 1. Recuperar y parsear contactos de WhatsApp
    let contacts = [];
    const rawWp = (presupuesto.whatsapp_bunker || '').trim();
    if (rawWp.startsWith('[')) {
        try {
            contacts = JSON.parse(rawWp);
        } catch(e) {}
    }
    if (!Array.isArray(contacts) || contacts.length === 0) {
        const rawPhone = rawWp || presupuesto.celular || presupuesto.telefono || '';
        contacts = rawPhone.split(',').map(num => ({
            numero: num.trim(),
            nombre: '',
            cargo: ''
        })).filter(c => c.numero);
    }
    contacts = contacts.filter(c => c && c.numero && typeof c.numero === 'string' && c.numero.replace(/\D/g, '').length >= 6);

    // 2. Recuperar y parsear contactos de Email
    let emails = [];
    const rawEmail = (presupuesto.email_bunker || '').trim();
    if (rawEmail.startsWith('[')) {
        try {
            emails = JSON.parse(rawEmail);
        } catch(e) {}
    }
    if (!Array.isArray(emails) || emails.length === 0) {
        const rawEmailStr = rawEmail || presupuesto.email || '';
        emails = rawEmailStr.split(',').map(em => ({
            email: em.trim(),
            nombre: '',
            cargo: ''
        })).filter(e => e.email);
    }
    emails = emails.filter(e => e && e.email && typeof e.email === 'string' && e.email.includes('@') && e.email !== '[]' && e.email.trim().length > 0);

    // 3. Evaluar destinatarios predeterminados para el tildado inicial
    // ¿Existe configuración explícita guardada para presupuestos en los contactos?
    const hasWpPresupuestoConfig = contacts.some(c => typeof c.default_presupuesto === 'boolean');
    const hasEmailPresupuestoConfig = emails.some(e => typeof e.default_presupuesto === 'boolean');

    const hasWpGeneralConfig = !hasWpPresupuestoConfig && contacts.some(c => typeof c.default === 'boolean');
    const hasEmailGeneralConfig = !hasEmailPresupuestoConfig && emails.some(e => typeof e.default === 'boolean');

    const canalPreferido = (presupuesto.canal_envio_preferido || '').toLowerCase();

    // 4. Construir contenido HTML de selección (Diseño doble columna indexado por checkboxes)
    let htmlContent = `
        <div style="text-align: left; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
            <p style="margin-bottom: 15px; font-size: 14px; color: #4b5563; font-weight: 500;">
                Seleccione los canales y destinatarios para enviar el presupuesto:
            </p>
            <div style="display: flex; gap: 20px; margin-bottom: 15px;">
                <!-- Columna WhatsApp -->
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 12px; font-weight: 700; color: #10b981; text-transform: uppercase; margin-bottom: 8px; border-bottom: 2px solid #10b981; padding-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                        <span>📱 WhatsApp</span>
                    </div>
                    <div id="swal-wp-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; padding: 4px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f9fafb;">
    `;

    if (contacts.length === 0) {
        htmlContent += `
            <div class="empty-placeholder" style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">
                No hay contactos de WhatsApp cargados.
            </div>
        `;
    } else {
        contacts.forEach((c, index) => {
            let isChecked = false;
            if (hasWpPresupuestoConfig) {
                isChecked = (c.default_presupuesto === true);
            } else if (hasWpGeneralConfig) {
                isChecked = (c.default === true);
            } else {
                isChecked = (canalPreferido !== 'email');
            }

            const formattedNum = c.numero.replace(/\D/g, '');
            let displayNum = c.numero;
            if (formattedNum.length === 10) {
                displayNum = `(${formattedNum.substring(0,3)}) ${formattedNum.substring(3,6)}-${formattedNum.substring(6,10)}`;
            } else if (formattedNum.length === 13 && formattedNum.startsWith('549')) {
                displayNum = `+54 9 (${formattedNum.substring(3,6)}) ${formattedNum.substring(6,9)}-${formattedNum.substring(9,13)}`;
            }
            
            const labelText = c.nombre 
                ? `<strong>${c.nombre}</strong>${c.cargo ? ` <span style="font-size: 9px; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${c.cargo}</span>` : ''}`
                : `Contacto #${index + 1}`;

            htmlContent += `
                <label style="display: flex; align-items: flex-start; gap: 8px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer; margin-bottom: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                    <input type="checkbox" class="swal-contact-wp-chk" value="${c.numero}" ${isChecked ? 'checked' : ''} style="margin-top: 3px; cursor: pointer; width: 15px; height: 15px;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 12px; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${labelText}</div>
                        <div style="font-size: 11px; color: #6b7280;">📱 ${displayNum}</div>
                    </div>
                </label>
            `;
        });
    }

    htmlContent += `
                    </div>
                </div>
                
                <!-- Columna Correo -->
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 12px; font-weight: 700; color: #6366f1; text-transform: uppercase; margin-bottom: 8px; border-bottom: 2px solid #6366f1; padding-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                        <span>📧 Correo</span>
                    </div>
                    <div id="swal-email-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; padding: 4px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f9fafb;">
    `;

    if (emails.length === 0) {
        htmlContent += `
            <div class="empty-placeholder" style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">
                No hay correos cargados.
            </div>
        `;
    } else {
        emails.forEach((e, index) => {
            let isChecked = false;
            if (hasEmailPresupuestoConfig) {
                // Se respeta fielmente lo configurado por el usuario (si guardó false, NO se tilda)
                isChecked = (e.default_presupuesto === true);
            } else if (hasEmailGeneralConfig) {
                isChecked = (e.default === true);
            } else {
                if (canalPreferido === 'email' || canalPreferido === 'ambos') {
                    isChecked = true;
                } else if (canalPreferido === 'whatsapp') {
                    isChecked = false;
                } else {
                    isChecked = (contacts.length === 0);
                }
            }

            const labelText = e.nombre 
                ? `<strong>${e.nombre}</strong>${e.cargo ? ` <span style="font-size: 9px; background: #e0e7ff; color: #4338ca; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${e.cargo}</span>` : ''}`
                : `Correo #${index + 1}`;

            htmlContent += `
                <label style="display: flex; align-items: flex-start; gap: 8px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer; margin-bottom: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                    <input type="checkbox" class="swal-contact-email-chk" value="${e.email}" ${isChecked ? 'checked' : ''} style="margin-top: 3px; cursor: pointer; width: 15px; height: 15px;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 12px; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${labelText}</div>
                        <div style="font-size: 11px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📧 ${e.email}</div>
                    </div>
                </label>
            `;
        });
    }

    htmlContent += `
                    </div>
                </div>
            </div>
            
            <!-- Campos adicionales rápidos -->
            <div style="display: flex; gap: 20px; margin-top: 15px; padding-top: 10px; border-top: 1px dashed #cbd5e1;">
                <div style="flex: 1;">
                    <label style="display: block; font-size: 12px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">
                        Otro número (opcional para este envío):
                    </label>
                    <input type="text" id="swal-custom-phone" placeholder="Ej: (221) 661-5746" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                </div>
                <div style="flex: 1;">
                    <label style="display: block; font-size: 12px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">
                        Otro correo (opcional para este envío):
                    </label>
                    <input type="text" id="swal-custom-email" placeholder="Ej: admin@cliente.com" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                </div>
            </div>

            <!-- Sección: Cargar Nuevo Contacto Directo a la Ficha -->
            <div style="margin-top: 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
                <div id="toggle-nuevo-contacto-presupuesto" style="padding: 9px 12px; background: #f1f5f9; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none;">
                    <span style="font-size: 12px; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 6px;">
                        <span style="color: #6366f1;">➕</span> Cargar nuevo contacto para este cliente
                    </span>
                    <span id="icon-toggle-nuevo-contacto-presupuesto" style="font-size: 11px; color: #64748b; font-weight: 600;">▼ Desplegar</span>
                </div>
                <div id="form-nuevo-contacto-presupuesto" style="display: none; padding: 12px; flex-direction: column; gap: 8px;">
                    <div style="display: flex; gap: 8px;">
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 2px;">Nombre:</label>
                            <input type="text" id="swal-presupuesto-nuevo-nombre" placeholder="Ej: Micaela" style="width: 100%; font-size: 12px; height: 30px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 0 8px; box-sizing: border-box;">
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 2px;">Cargo / Rol:</label>
                            <input type="text" id="swal-presupuesto-nuevo-cargo" placeholder="Ej: Dueña, Administración" style="width: 100%; font-size: 12px; height: 30px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 0 8px; box-sizing: border-box;">
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 11px; font-weight: 600; color: #10b981; margin-bottom: 2px;">📱 WhatsApp (con máscara):</label>
                            <input type="text" id="swal-presupuesto-nuevo-wp" placeholder="(221) 305-1684" style="width: 100%; font-size: 12px; height: 30px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 0 8px; box-sizing: border-box;">
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 11px; font-weight: 600; color: #6366f1; margin-bottom: 2px;">📧 Correo (opcional):</label>
                            <input type="email" id="swal-presupuesto-nuevo-email" placeholder="ejemplo@cliente.com" style="width: 100%; font-size: 12px; height: 30px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 0 8px; box-sizing: border-box;">
                        </div>
                    </div>
                    <div style="display: flex; justify-content: flex-end; align-items: center; margin-top: 4px; padding-top: 4px;">
                        <button type="button" id="btn-guardar-nuevo-contacto-presupuesto" style="background: #10b981; color: white; border: none; border-radius: 5px; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                            <span>💾</span> Guardar en Búnker y seleccionar
                        </button>
                    </div>
                    <div id="swal-presupuesto-nuevo-feedback" style="display: none; font-size: 11.5px; font-weight: 600; padding: 6px 10px; border-radius: 4px; text-align: center; margin-top: 4px;"></div>
                </div>
            </div>
            
            <!-- Previsualizador y Editor de Mensaje de WhatsApp -->
            <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dashed #cbd5e1; text-align: left;">
                <label for="swal-mensaje-texto" style="display: block; font-size: 12px; font-weight: 600; color: #4b5563; margin-bottom: 6px;">
                    📝 Mensaje de WhatsApp (Editable):
                </label>
                <textarea id="swal-mensaje-texto" style="width: 100%; height: 90px; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12px; font-family: inherit; box-sizing: border-box; resize: vertical; line-height: 1.4;">${defaultMensaje}</textarea>
                <span style="font-size: 10px; color: #94a3b8; margin-top: 4px; display: block;">* Puede modificar este texto para personalizar el mensaje de WhatsApp.</span>
            </div>
            
            <p style="margin-top: 12px; font-size: 10.5px; color: #94a3b8; font-style: italic; line-height: 1.2; margin-bottom: 0;">
                * Si no selecciona ningún destinatario, se procederá con la descarga local directa del documento.
            </p>
    `;

    if (presupuesto && presupuesto.bunker_cliente_id) {
        htmlContent += `
            <div style="margin-top: 15px; padding-top: 12px; border-top: 1px dashed #cbd5e1; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: #475569; margin-bottom: 0;">
                        <input type="checkbox" id="swal-save-default" style="width: 16px; height: 16px; cursor: pointer;">
                        <span>Guardar esta selección como predeterminados al enviar</span>
                    </label>
                    <button type="button" id="btn-guardar-predeterminados-manual" style="background: #f8fafc; color: #334155; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s ease;">
                        <span>💾</span> Guardar como predeterminados
                    </button>
                </div>
                <div id="swal-save-feedback" style="display: none; font-size: 11.5px; font-weight: 500; padding: 6px 10px; border-radius: 4px; text-align: center;"></div>
            </div>
        `;
    }

    htmlContent += `</div>`;

    // Función auxiliar resiliente para persistir contactos predeterminados en Base de Datos (Logística Bunker)
    const guardarContactosPredeterminados = async (selectedWpArr, selectedEmailArr, customPhoneStr = '', customEmailStr = '') => {
        if (!presupuesto || !presupuesto.bunker_cliente_id) {
            console.warn('⚠️ [OMNICANAL-FRONT] No hay bunker_cliente_id disponible para guardar predeterminados.');
            return false;
        }

        // Mapear contactos existentes de WhatsApp
        const finalWpMap = new Map();
        contacts.forEach(c => {
            const isSelected = selectedWpArr.some(num => String(num).trim() === String(c.numero).trim() || String(num).replace(/\D/g, '') === String(c.numero).replace(/\D/g, ''));
            finalWpMap.set(c.numero, {
                ...c,
                default_presupuesto: isSelected
            });
        });

        // Si se ingresó otro número manual, agregarlo a la lista de contactos como predeterminado
        if (customPhoneStr) {
            const cleaned = customPhoneStr.replace(/[^\d,]/g, '');
            if (cleaned) {
                cleaned.split(',').map(n => n.trim()).filter(n => n.length >= 6).forEach(num => {
                    if (finalWpMap.has(num)) {
                        finalWpMap.get(num).default_presupuesto = true;
                    } else {
                        finalWpMap.set(num, {
                            numero: num,
                            nombre: '',
                            cargo: '',
                            default_factura: false,
                            default_presupuesto: true
                        });
                    }
                });
            }
        }

        // Mapear contactos existentes de Email
        const finalEmailMap = new Map();
        emails.forEach(e => {
            const key = (e.email || '').toLowerCase().trim();
            if (key) {
                const isSelected = selectedEmailArr.some(em => String(em).toLowerCase().trim() === key);
                finalEmailMap.set(key, {
                    ...e,
                    default_presupuesto: isSelected
                });
            }
        });

        // Si se ingresó otro correo manual, agregarlo a la lista de correos como predeterminado
        if (customEmailStr) {
            customEmailStr.split(',').map(em => em.trim()).filter(em => em.includes('@') && em !== '[]').forEach(em => {
                const key = em.toLowerCase();
                if (finalEmailMap.has(key)) {
                    finalEmailMap.get(key).default_presupuesto = true;
                } else {
                    finalEmailMap.set(key, {
                        email: em,
                        nombre: '',
                        cargo: '',
                        default_factura: false,
                        default_presupuesto: true
                    });
                }
            });
        }

        const updatedWpContacts = Array.from(finalWpMap.values());
        const updatedEmailContacts = Array.from(finalEmailMap.values());

        // Determinar canal preferido coherente
        let canalPreferido = 'ambos';
        const hasSelectedWp = updatedWpContacts.some(c => c.default_presupuesto === true);
        const hasSelectedEmail = updatedEmailContacts.some(e => e.default_presupuesto === true);
        if (hasSelectedWp && !hasSelectedEmail) {
            canalPreferido = 'whatsapp';
        } else if (!hasSelectedWp && hasSelectedEmail) {
            canalPreferido = 'email';
        } else if (!hasSelectedWp && !hasSelectedEmail) {
            canalPreferido = 'whatsapp';
        }

        const payload = {
            whatsapp_facturas: JSON.stringify(updatedWpContacts),
            email_facturas: JSON.stringify(updatedEmailContacts),
            canal_envio_preferido: canalPreferido
        };

        let response = null;
        // Intento 1: A través de ruta relativa (proxy Express en presupuestos)
        try {
            response = await fetch(`/api/logistica/bunker/clientes/${presupuesto.bunker_cliente_id}/whatsapp-contacts`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (fetchErr) {
            console.warn('⚠️ [OMNICANAL-FRONT] Error llamando a endpoint relativo:', fetchErr.message);
        }

        // Intento 2 (Fallback): Directo al puerto 3005 de Logística (CORS habilitado)
        if (!response || !response.ok) {
            try {
                const host = window.location.hostname || 'localhost';
                const directUrl = `${window.location.protocol}//${host}:3005/api/logistica/bunker/clientes/${presupuesto.bunker_cliente_id}/whatsapp-contacts`;
                console.log(`🔄 [OMNICANAL-FRONT] Reintentando persistencia directa en Logística (${directUrl})...`);
                response = await fetch(directUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } catch (directErr) {
                console.error('❌ [OMNICANAL-FRONT] Error al contactar puerto 3005 de Logística:', directErr);
            }
        }

        if (response && response.ok) {
            presupuesto.whatsapp_bunker = payload.whatsapp_facturas;
            presupuesto.email_bunker = payload.email_facturas;
            presupuesto.canal_envio_preferido = canalPreferido;
            if (presupuestoData && presupuestoData.presupuesto) {
                presupuestoData.presupuesto.whatsapp_bunker = payload.whatsapp_facturas;
                presupuestoData.presupuesto.email_bunker = payload.email_facturas;
                presupuestoData.presupuesto.canal_envio_preferido = canalPreferido;
            }
            contacts = updatedWpContacts;
            emails = updatedEmailContacts;
            console.log('✅ [OMNICANAL-FRONT] Contactos predeterminados persistidos exitosamente en BD.');
            return true;
        } else {
            const errStatus = response ? response.status : 'SIN_CONEXION';
            console.error(`❌ [OMNICANAL-FRONT] No se pudo persistir contactos predeterminados. Status: ${errStatus}`);
            return false;
        }
    };

    // 5. Mostrar SweetAlert2 Modal
    const { value: modalResult } = await Swal.fire({
        title: 'Enviar Presupuesto',
        html: htmlContent,
        icon: 'question',
        width: '650px',
        showCancelButton: true,
        confirmButtonText: '📤 Enviar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#6366f1',
        cancelButtonColor: '#6b7280',
        didOpen: (popup) => {
            // 1. Máscara en teléfono adicional rápido
            const customPhoneInput = popup.querySelector('#swal-custom-phone');
            if (customPhoneInput) {
                customPhoneInput.addEventListener('input', () => {
                    let cursorPosition = customPhoneInput.selectionStart;
                    const originalLength = customPhoneInput.value.length;
                    const clean = cleanInputForFormatting(customPhoneInput.value);
                    const formatted = formatArgentinePhone(clean);
                    customPhoneInput.value = formatted;
                    const newLength = formatted.length;
                    cursorPosition = cursorPosition + (newLength - originalLength);
                    customPhoneInput.setSelectionRange(cursorPosition, cursorPosition);
                });
            }

            // 2. Máscara en nuevo contacto directo
            const nuevoWpInput = popup.querySelector('#swal-presupuesto-nuevo-wp');
            if (nuevoWpInput) {
                nuevoWpInput.addEventListener('input', () => {
                    let cursorPosition = nuevoWpInput.selectionStart;
                    const originalLength = nuevoWpInput.value.length;
                    const clean = cleanInputForFormatting(nuevoWpInput.value);
                    const formatted = formatArgentinePhone(clean);
                    nuevoWpInput.value = formatted;
                    const newLength = formatted.length;
                    cursorPosition = cursorPosition + (newLength - originalLength);
                    nuevoWpInput.setSelectionRange(cursorPosition, cursorPosition);
                });
            }

            // 3. Toggle acordeón nuevo contacto
            const toggleNuevoBtn = popup.querySelector('#toggle-nuevo-contacto-presupuesto');
            const formNuevoContainer = popup.querySelector('#form-nuevo-contacto-presupuesto');
            const toggleNuevoIcon = popup.querySelector('#icon-toggle-nuevo-contacto-presupuesto');
            if (toggleNuevoBtn && formNuevoContainer) {
                toggleNuevoBtn.addEventListener('click', () => {
                    const isOpen = formNuevoContainer.style.display === 'flex';
                    formNuevoContainer.style.display = isOpen ? 'none' : 'flex';
                    if (toggleNuevoIcon) toggleNuevoIcon.textContent = isOpen ? '▼ Desplegar' : '▲ Plegar';
                    if (!isOpen) {
                        setTimeout(() => popup.querySelector('#swal-presupuesto-nuevo-nombre')?.focus(), 50);
                    }
                });
            }

            // 4. Guardar nuevo contacto directo en Bunker y preseleccionar
            const btnGuardarNuevo = popup.querySelector('#btn-guardar-nuevo-contacto-presupuesto');
            const feedbackNuevoEl = popup.querySelector('#swal-presupuesto-nuevo-feedback');
            if (btnGuardarNuevo) {
                btnGuardarNuevo.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const nombreVal = (popup.querySelector('#swal-presupuesto-nuevo-nombre')?.value || '').trim();
                    const cargoVal = (popup.querySelector('#swal-presupuesto-nuevo-cargo')?.value || '').trim();
                    const rawWp = (popup.querySelector('#swal-presupuesto-nuevo-wp')?.value || '').trim();
                    const cleanPhone = cleanInputForFormatting(rawWp);
                    const emailVal = (popup.querySelector('#swal-presupuesto-nuevo-email')?.value || '').trim();

                    if (!cleanPhone && !emailVal) {
                        if (feedbackNuevoEl) {
                            feedbackNuevoEl.style.display = 'block';
                            feedbackNuevoEl.style.background = '#fef2f2';
                            feedbackNuevoEl.style.color = '#991b1b';
                            feedbackNuevoEl.style.border = '1px solid #fecaca';
                            feedbackNuevoEl.textContent = 'Debe ingresar al menos un número de WhatsApp o un correo electrónico.';
                        }
                        return;
                    }

                    if (cleanPhone && cleanPhone.length < 8) {
                        if (feedbackNuevoEl) {
                            feedbackNuevoEl.style.display = 'block';
                            feedbackNuevoEl.style.background = '#fef2f2';
                            feedbackNuevoEl.style.color = '#991b1b';
                            feedbackNuevoEl.style.border = '1px solid #fecaca';
                            feedbackNuevoEl.textContent = 'El número de WhatsApp ingresado no parece ser un número válido.';
                        }
                        return;
                    }

                    btnGuardarNuevo.disabled = true;
                    btnGuardarNuevo.innerHTML = '<span>⏳</span> Guardando...';

                    try {
                        let wpAdded = null;
                        if (cleanPhone) {
                            const alreadyExists = contacts.some(c => c.numero && c.numero.replace(/\D/g, '') === cleanPhone);
                            if (!alreadyExists) {
                                wpAdded = {
                                    id: `cont_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`,
                                    numero: cleanPhone,
                                    nombre: nombreVal,
                                    cargo: cargoVal,
                                    enviar_alerta: true,
                                    default_presupuesto: true,
                                    default_factura: true,
                                    default_resumen: true,
                                    default: true
                                };
                                contacts.push(wpAdded);
                            }
                        }

                        let emailAdded = null;
                        if (emailVal && emailVal.includes('@')) {
                            const alreadyExists = emails.some(em => em.email && em.email.toLowerCase() === emailVal.toLowerCase());
                            if (!alreadyExists) {
                                emailAdded = {
                                    id: `em_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`,
                                    email: emailVal,
                                    nombre: nombreVal,
                                    cargo: cargoVal,
                                    enviar_alerta: true,
                                    default_presupuesto: true,
                                    default_factura: true,
                                    default_resumen: true,
                                    default: true
                                };
                                emails.push(emailAdded);
                            }
                        }

                        if (presupuesto && presupuesto.bunker_cliente_id) {
                            const payload = {
                                whatsapp_facturas: JSON.stringify(contacts),
                                email_facturas: JSON.stringify(emails),
                                canal_envio_preferido: canalPreferido
                            };

                            let resp = null;
                            try {
                                resp = await fetch(`/api/logistica/bunker/clientes/${presupuesto.bunker_cliente_id}/whatsapp-contacts`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(payload)
                                });
                            } catch (fErr) {
                                console.warn('Fetch relativo falló:', fErr);
                            }

                            if (!resp || !resp.ok) {
                                const host = window.location.hostname || 'localhost';
                                resp = await fetch(`${window.location.protocol}//${host}:3005/api/logistica/bunker/clientes/${presupuesto.bunker_cliente_id}/whatsapp-contacts`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(payload)
                                });
                            }

                            if (!resp || !resp.ok) {
                                throw new Error('No se pudo guardar el contacto en el servidor de Logística Bunker.');
                            }

                            presupuesto.whatsapp_bunker = payload.whatsapp_facturas;
                            presupuesto.email_bunker = payload.email_facturas;
                            if (presupuestoData && presupuestoData.presupuesto) {
                                presupuestoData.presupuesto.whatsapp_bunker = payload.whatsapp_facturas;
                                presupuestoData.presupuesto.email_bunker = payload.email_facturas;
                            }
                        }

                        // Inyectar visualmente en el modal
                        if (wpAdded) {
                            const wpContainer = popup.querySelector('#swal-wp-list');
                            if (wpContainer) {
                                const emptyPlaceholder = wpContainer.querySelector('.empty-placeholder');
                                if (emptyPlaceholder) emptyPlaceholder.remove();

                                const formattedDisplay = formatArgentinePhone(cleanPhone);
                                const labelText = wpAdded.nombre 
                                    ? `<strong>${wpAdded.nombre}</strong>${wpAdded.cargo ? ` <span style="font-size: 9px; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${wpAdded.cargo}</span>` : ''}`
                                    : 'Contacto nuevo';

                                const newLabel = document.createElement('label');
                                newLabel.style = 'display: flex; align-items: flex-start; gap: 8px; padding: 8px; border: 1px solid #10b981; border-radius: 6px; background: #ecfdf5; cursor: pointer; margin-bottom: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.05);';
                                newLabel.innerHTML = `
                                    <input type="checkbox" class="swal-contact-wp-chk" value="${wpAdded.numero}" checked style="margin-top: 3px; cursor: pointer; width: 15px; height: 15px;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 12px; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${labelText}</div>
                                        <div style="font-size: 11px; color: #059669; font-weight: 600;">📱 ${formattedDisplay}</div>
                                    </div>
                                `;
                                wpContainer.prepend(newLabel);
                            }
                        }

                        if (emailAdded) {
                            const emailContainer = popup.querySelector('#swal-email-list');
                            if (emailContainer) {
                                const emptyPlaceholder = emailContainer.querySelector('.empty-placeholder');
                                if (emptyPlaceholder) emptyPlaceholder.remove();

                                const labelText = emailAdded.nombre 
                                    ? `<strong>${emailAdded.nombre}</strong>${emailAdded.cargo ? ` <span style="font-size: 9px; background: #e0e7ff; color: #4338ca; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${emailAdded.cargo}</span>` : ''}`
                                    : 'Contacto nuevo';

                                const newLabel = document.createElement('label');
                                newLabel.style = 'display: flex; align-items: flex-start; gap: 8px; padding: 8px; border: 1px solid #6366f1; border-radius: 6px; background: #f5f3ff; cursor: pointer; margin-bottom: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.05);';
                                newLabel.innerHTML = `
                                    <input type="checkbox" class="swal-contact-email-chk" value="${emailAdded.email}" checked style="margin-top: 3px; cursor: pointer; width: 15px; height: 15px;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 12px; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${labelText}</div>
                                        <div style="font-size: 11px; color: #6366f1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📧 ${emailAdded.email}</div>
                                    </div>
                                `;
                                emailContainer.prepend(newLabel);
                            }
                        }

                        if (feedbackNuevoEl) {
                            feedbackNuevoEl.style.display = 'block';
                            feedbackNuevoEl.style.background = '#d1fae5';
                            feedbackNuevoEl.style.color = '#065f46';
                            feedbackNuevoEl.style.border = '1px solid #a7f3d0';
                            feedbackNuevoEl.textContent = '✔️ ¡Contacto guardado en la ficha de Búnker y preseleccionado!';
                        }

                        popup.querySelector('#swal-presupuesto-nuevo-nombre').value = '';
                        popup.querySelector('#swal-presupuesto-nuevo-cargo').value = '';
                        popup.querySelector('#swal-presupuesto-nuevo-wp').value = '';
                        popup.querySelector('#swal-presupuesto-nuevo-email').value = '';

                        setTimeout(() => {
                            btnGuardarNuevo.disabled = false;
                            btnGuardarNuevo.innerHTML = '<span>💾</span> Guardar en Búnker y seleccionar';
                        }, 2000);

                    } catch (err) {
                        console.error('Error guardando contacto nuevo en presupuesto:', err);
                        if (feedbackNuevoEl) {
                            feedbackNuevoEl.style.display = 'block';
                            feedbackNuevoEl.style.background = '#fef2f2';
                            feedbackNuevoEl.style.color = '#991b1b';
                            feedbackNuevoEl.style.border = '1px solid #fecaca';
                            feedbackNuevoEl.textContent = 'Error al guardar: ' + err.message;
                        }
                        btnGuardarNuevo.disabled = false;
                        btnGuardarNuevo.innerHTML = '<span>💾</span> Guardar en Búnker y seleccionar';
                    }
                });
            }

            const btnGuardarManual = popup.querySelector('#btn-guardar-predeterminados-manual');
            const feedbackEl = popup.querySelector('#swal-save-feedback');

            if (btnGuardarManual) {
                btnGuardarManual.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const curSelectedWp = Array.from(popup.querySelectorAll('.swal-contact-wp-chk:checked')).map(el => el.value);
                    const curSelectedEmail = Array.from(popup.querySelectorAll('.swal-contact-email-chk:checked')).map(el => el.value);
                    const customPhone = (popup.querySelector('#swal-custom-phone')?.value || '').trim();
                    const customEmail = (popup.querySelector('#swal-custom-email')?.value || '').trim();

                    btnGuardarManual.disabled = true;
                    btnGuardarManual.style.opacity = '0.7';
                    btnGuardarManual.innerHTML = '<span>⏳</span> Guardando...';

                    if (feedbackEl) {
                        feedbackEl.style.display = 'none';
                    }

                    try {
                        const ok = await guardarContactosPredeterminados(curSelectedWp, curSelectedEmail, customPhone, customEmail);
                        if (ok) {
                            btnGuardarManual.innerHTML = '<span>✅</span> ¡Guardado!';
                            btnGuardarManual.style.background = '#ecfdf5';
                            btnGuardarManual.style.color = '#065f46';
                            btnGuardarManual.style.borderColor = '#6ee7b7';

                            if (feedbackEl) {
                                feedbackEl.style.display = 'block';
                                feedbackEl.style.background = '#d1fae5';
                                feedbackEl.style.color = '#065f46';
                                feedbackEl.style.border = '1px solid #a7f3d0';
                                feedbackEl.innerHTML = '✔️ Selección guardada como contactos predeterminados para este cliente.';
                            }

                            setTimeout(() => {
                                btnGuardarManual.disabled = false;
                                btnGuardarManual.style.opacity = '1';
                                btnGuardarManual.innerHTML = '<span>💾</span> Guardar como predeterminados';
                                btnGuardarManual.style.background = '#f8fafc';
                                btnGuardarManual.style.color = '#334155';
                                btnGuardarManual.style.borderColor = '#cbd5e1';
                            }, 2500);
                        } else {
                            throw new Error('No se pudo guardar la configuración en el servidor.');
                        }
                    } catch (err) {
                        console.error('❌ Error guardando contactos manual:', err);
                        btnGuardarManual.disabled = false;
                        btnGuardarManual.style.opacity = '1';
                        btnGuardarManual.innerHTML = '<span>❌</span> Error';
                        btnGuardarManual.style.background = '#fef2f2';
                        btnGuardarManual.style.color = '#991b1b';
                        btnGuardarManual.style.borderColor = '#fecaca';

                        if (feedbackEl) {
                            feedbackEl.style.display = 'block';
                            feedbackEl.style.background = '#fee2e2';
                            feedbackEl.style.color = '#991b1b';
                            feedbackEl.style.border = '1px solid #fca5a5';
                            feedbackEl.innerHTML = `⚠️ ${err.message || 'Error al guardar contactos en la base de datos'}`;
                        }

                        setTimeout(() => {
                            btnGuardarManual.innerHTML = '<span>💾</span> Reintentar guardar';
                            btnGuardarManual.style.background = '#f8fafc';
                            btnGuardarManual.style.color = '#334155';
                            btnGuardarManual.style.borderColor = '#cbd5e1';
                        }, 3000);
                    }
                });
            }
        },
        preConfirm: async () => {
            const popup = Swal.getPopup();
            const selectedWp = Array.from(popup.querySelectorAll('.swal-contact-wp-chk:checked')).map(el => el.value);
            const selectedEmail = Array.from(popup.querySelectorAll('.swal-contact-email-chk:checked')).map(el => el.value);
            const customPhone = (popup.querySelector('#swal-custom-phone')?.value || '').trim();
            const customEmail = (popup.querySelector('#swal-custom-email')?.value || '').trim();
            const saveDefaultCheckbox = popup.querySelector('#swal-save-default');
            const saveDefault = saveDefaultCheckbox ? saveDefaultCheckbox.checked : false;

            // Si se marcó la casilla de guardar como predeterminados, persistir de forma atómica antes de cerrar
            if (saveDefault && presupuesto && presupuesto.bunker_cliente_id) {
                try {
                    await guardarContactosPredeterminados(selectedWp, selectedEmail, customPhone, customEmail);
                    console.log('✅ [OMNICANAL-FRONT] Persistencia predeterminada confirmada en preConfirm.');
                } catch (e) {
                    console.error('❌ [OMNICANAL-FRONT] Error al persistir en preConfirm:', e);
                }
            }

            const finalWp = [...selectedWp];
            if (customPhone) {
                const cleaned = customPhone.replace(/[^\d,]/g, '');
                if (cleaned) {
                    cleaned.split(',').forEach(num => {
                        if (num.trim()) finalWp.push(num.trim());
                    });
                }
            }

            const finalEmail = [...selectedEmail];
            if (customEmail) {
                customEmail.split(',').forEach(em => {
                    if (em.trim()) finalEmail.push(em.trim());
                });
            }

            const mensajeTexto = popup.querySelector('#swal-mensaje-texto')?.value || '';

            return {
                destinatariosWp: finalWp,
                destinatariosEmail: finalEmail,
                saveDefault,
                selectedWpRaw: selectedWp,
                selectedEmailRaw: selectedEmail,
                customPhone,
                customEmail,
                mensajeTexto
            };
        }
    });

    if (!modalResult) return;

    const { destinatariosWp, destinatariosEmail, saveDefault, selectedWpRaw, selectedEmailRaw, customPhone, customEmail, mensajeTexto } = modalResult;

    // 6. Si no hay destinatarios seleccionados, descargar localmente
    if (destinatariosWp.length === 0 && destinatariosEmail.length === 0) {
        console.log('📥 [OMNICANAL-FRONT] Sin destinatarios. Iniciando descarga local...');
        Swal.fire({
            icon: 'info',
            title: 'Descarga Local',
            text: 'Preparando la impresión/descarga del documento...',
            timer: 1500,
            showConfirmButton: false
        });
        imprimirPresupuesto();
        return;
    }

    // 7. Si se marca guardar por defecto, actualizar en base de datos
    if (saveDefault && presupuesto && presupuesto.bunker_cliente_id) {
        try {
            await guardarContactosPredeterminados(selectedWpRaw, selectedEmailRaw, customPhone, customEmail);
        } catch (err) {
            console.error('❌ [OMNICANAL-FRONT] Error al guardar contactos predeterminados al enviar:', err);
        }
    }

    // 8. Despachar a los servicios
    const destinatariosWpStr = destinatariosWp.join(', ');
    const destinatariosEmailStr = destinatariosEmail.join(', ');

    // Mostrar spinner de carga
    Swal.fire({
        title: 'Generando y enviando...',
        text: 'Por favor espera un momento.',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    let wpOk = false;
    let emailOk = false;
    let wpAttempted = destinatariosWp.length > 0;
    let emailAttempted = destinatariosEmail.length > 0;
    let errors = [];

    const sololista = document.getElementById('chk-solo-lista')?.checked || false;
    const faltantes = document.getElementById('chk-faltantes')?.checked || false;
    const promos = document.getElementById('chk-promos')?.checked || false;
    const pagos = document.getElementById('chk-pagos')?.checked || false;
    const intereses = document.getElementById('chk-intereses')?.checked || false;

    // A. Enviar por WhatsApp
    if (wpAttempted) {
        try {
            console.log(`📱 [OMNICANAL-FRONT] Despachando WhatsApp a: ${destinatariosWpStr}`);
            const response = await fetch(`/api/presupuestos/${presupuestoId}/whatsapp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: destinatariosWpStr,
                    formato: formatoActual,
                    sololista: sololista,
                    faltantes: faltantes,
                    promos: promos,
                    pagos: pagos,
                    intereses: intereses,
                    nombreCliente: presupuesto.nombre_cliente || presupuesto.concepto || '',
                    estado: presupuesto.estado,
                    mensajeTexto: mensajeTexto
                })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                wpOk = true;
            } else {
                errors.push(`WhatsApp: ${data.message || data.error || 'Error desconocido'}`);
            }
        } catch (err) {
            console.error('❌ [OMNICANAL-FRONT] Error en WhatsApp:', err);
            errors.push(`WhatsApp: ${err.message}`);
        }
    }

    // B. Enviar por Email
    if (emailAttempted) {
        try {
            console.log(`📧 [OMNICANAL-FRONT] Despachando Email a: ${destinatariosEmailStr}`);
            const response = await fetch(`/api/presupuestos/${presupuestoId}/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: destinatariosEmailStr,
                    formato: formatoActual,
                    sololista: sololista,
                    faltantes: faltantes,
                    promos: promos,
                    pagos: pagos,
                    intereses: intereses
                })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                emailOk = true;
            } else {
                errors.push(`Correo: ${data.message || data.error || 'Error desconocido'}`);
            }
        } catch (err) {
            console.error('❌ [OMNICANAL-FRONT] Error en Email:', err);
            errors.push(`Correo: ${err.message}`);
        }
    }

    // 9. Informar al usuario
    const totalAttempted = (wpAttempted ? 1 : 0) + (emailAttempted ? 1 : 0);
    const totalSuccess = (wpOk ? 1 : 0) + (emailOk ? 1 : 0);

    if (totalSuccess === totalAttempted) {
        let msgExito = 'El presupuesto fue enviado con éxito ';
        if (wpOk && emailOk) {
            msgExito += `por WhatsApp (${destinatariosWpStr}) y Correo (${destinatariosEmailStr}).`;
        } else if (wpOk) {
            msgExito += `por WhatsApp a: ${destinatariosWpStr}`;
        } else {
            msgExito += `por Correo a: ${destinatariosEmailStr}`;
        }

        Swal.fire({
            icon: 'success',
            title: '¡Enviado!',
            text: msgExito,
            confirmButtonColor: '#334155'
        });
        console.log('✅ [OMNICANAL-FRONT] Envío omnicanal completado con éxito.');
    } else if (totalSuccess > 0) {
        let partialMsg = 'Envío parcial:\n';
        if (wpOk) partialMsg += `✅ WhatsApp: Enviado a ${destinatariosWpStr}\n`;
        else if (wpAttempted) partialMsg += `❌ WhatsApp: Falló (${errors.filter(e => e.startsWith('WhatsApp')).join(', ')})\n`;
        
        if (emailOk) partialMsg += `✅ Correo: Enviado a ${destinatariosEmailStr}\n`;
        else if (emailAttempted) partialMsg += `❌ Correo: Falló (${errors.filter(e => e.startsWith('Correo')).join(', ')})\n`;

        Swal.fire({
            icon: 'warning',
            title: 'Envío Parcial',
            text: partialMsg,
            confirmButtonColor: '#f59e0b'
        });
        console.warn('⚠️ [OMNICANAL-FRONT] Envío parcial registrado:', errors);
    } else {
        Swal.fire({
            icon: 'error',
            title: 'Fallo al enviar',
            text: 'No se pudo enviar por ningún canal. Detalles de errores:\n' + errors.join('\n'),
            confirmButtonColor: '#e74c3c'
        });
        console.error('❌ [OMNICANAL-FRONT] Envío fallido totalmente:', errors);
    }
}

console.log('✅ [IMPRIMIR-PRESUPUESTO] Módulo de impresión inicializado con sistema de formatos e indexación omnicanal');
