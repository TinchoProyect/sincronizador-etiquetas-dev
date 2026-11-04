import React, { useState, useEffect } from 'react';
import { Download, Loader2, AlertCircle, DollarSign, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../supabaseClient';
import { getCache, setCache } from '../utils/cacheStore';
import { registrarAccesoTelemetria } from '../utils/telemetria';

export default function CuentaCorriente({ profile, highlightDocId, onClearHighlight }) {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [simuladorAbierto, setSimuladorAbierto] = useState(false);
  const [diagnosticoAbierto, setDiagnosticoAbierto] = useState(false);
  const [diasSimulados, setDiasSimulados] = useState(null);
  const [pagoParcialSimulado, setPagoParcialSimulado] = useState('');

  useEffect(() => {
    fetchMovements();
    const clientIdent = profile?.nombre_empresa || profile?.nombre_completo || profile?.email || (profile?.cliente_id ? `Cliente ${profile.cliente_id}` : null);
    registrarAccesoTelemetria('Consulta de Cuentas Corrientes', clientIdent, { dedupeMs: 15000 });
  }, [profile?.cliente_id]);

  const fetchMovements = async () => {
    const cacheKey = `cc_${profile?.id || 'user'}`;
    const cachedMovs = getCache(cacheKey);
    if (cachedMovs && cachedMovs.length > 0) {
      setMovements(cachedMovs);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      let query = supabase
        .from('clientes_b2b_cuentas_corrientes')
        .select('id, local_movimiento_id, fecha, tipo_comprobante, numero_comprobante, debe, haber, saldo, comprobante_url, metadatos, cliente_id, created_at');

      if (profile?.cliente_id) {
        query = query.eq('cliente_id', profile.cliente_id);
      }

      const { data, error: fetchError } = await query
        .order('created_at', { ascending: false })
        .order('local_movimiento_id', { ascending: false });

      if (fetchError) throw fetchError;
      const finalData = data || [];
      setCache(cacheKey, finalData, 180);
      setMovements(finalData);
    } catch (err) {
      console.error('Error al cargar movimientos contables:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Efecto para abrir el comprobante en modal flotante si se provee highlightDocId (Deep Link)
  useEffect(() => {
    if (highlightDocId && movements.length > 0) {
      const mov = movements.find(m => String(m.local_movimiento_id) === String(highlightDocId));
      if (mov) {
        console.log('🔍 [CC] Movimiento detectado para Deep Link:', mov);
        const timer = setTimeout(() => {
          showDocumentModal(mov);
          if (onClearHighlight) onClearHighlight();
        }, 300);
        return () => clearTimeout(timer);
      } else {
        console.warn('⚠️ [CC] No se encontró el movimiento con ID local:', highlightDocId);
      }
    }
  }, [highlightDocId, movements]);

  const imprimirComprobanteGenerico = (
    tituloVentana,
    bannerBg,
    bannerSub,
    bannerNum,
    fecha,
    nombreCliente,
    boxTitle,
    boxBg,
    boxBorder,
    boxColor,
    boxContentHtml,
    montoLabel,
    montoVal,
    saldoVal,
    notaPie
  ) => {
    const printWindow = window.open('', '_blank', 'width=600,height=700');
    if (!printWindow) {
      window.print();
      return;
    }
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${tituloVentana} - ${bannerNum}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; color: #1e293b; line-height: 1.5; }
            .ticket-box { max-width: 460px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 10px; padding: 24px; }
            .header-banner { background: ${bannerBg}; color: white; padding: 16px; border-radius: 8px; text-align: center; margin-bottom: 20px; }
            .header-banner .sub { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; opacity: 0.9; }
            .header-banner .num { font-size: 18px; font-weight: 700; margin-top: 4px; }
            .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; font-size: 13px; }
            .label-muted { color: #64748b; font-size: 10px; font-weight: 600; text-transform: uppercase; display: block; margin-bottom: 2px; }
            .info-box { background: ${boxBg}; border: 1px solid ${boxBorder}; border-radius: 8px; padding: 12px 14px; margin-bottom: 20px; font-size: 13px; color: ${boxColor}; }
            .info-box-title { font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
            .totals-row { border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 14px 0; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
            .footer-note { font-size: 10px; color: #64748b; text-align: center; line-height: 1.4; background: #f8fafc; border-radius: 6px; padding: 8px; }
            @media print {
              body { padding: 0; }
              .ticket-box { border: none; padding: 10px; }
            }
          </style>
        </head>
        <body>
          <div class="ticket-box">
            <div class="header-banner">
              <div class="sub">${bannerSub}</div>
              <div class="num">${bannerNum}</div>
            </div>
            <div class="grid-2">
              <div>
                <span class="label-muted">FECHA</span>
                <strong>${fecha}</strong>
              </div>
              <div>
                <span class="label-muted">CLIENTE / COLABORADOR</span>
                <strong>${nombreCliente}</strong>
              </div>
            </div>
            <div class="info-box">
              <div class="info-box-title">${boxTitle}</div>
              ${boxContentHtml}
            </div>
            <div class="totals-row">
              <div>
                <span class="label-muted">${montoLabel}</span>
                <span style="font-size: 20px; font-weight: 750; color: #16a34a;">${montoVal}</span>
              </div>
              <div style="text-align: right;">
                <span class="label-muted">SALDO CUENTA</span>
                <span style="font-size: 16px; font-weight: 700; color: #1e293b;">${saldoVal}</span>
              </div>
            </div>
            <div class="footer-note">${notaPie}</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const showDocumentModal = (mov) => {
    const currentBalance = movements.length > 0 ? parseFloat(movements[0].saldo) : parseFloat(mov.saldo);
    const isDebe = parseFloat(mov.debe) > 0;
    const montoDisplay = isDebe ? formatCurrency(mov.debe) : formatCurrency(mov.haber);
    const clientName = profile?.nombre_empresa || profile?.nombre_completo || mov.cliente_id;
    registrarAccesoTelemetria(`📄 Consultó comprobante: ${mov.tipo_comprobante || 'Doc'} ${mov.numero_comprobante || '#' + (mov.local_movimiento_id || mov.id)} (${montoDisplay})`, profile);

    let meta = {};
    if (mov.metadatos) {
      try {
        meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
      } catch (e) {
        console.error('Error parseando metadatos:', e);
      }
    }

    // Modal para Liquidación de Horas (CH)
    if (mov.tipo_comprobante === 'CH') {
      const horasTexto = meta.horas_totales ? `${meta.horas_totales} hs` : '';
      const colaboradorNombre = meta.colaborador || clientName;
      const jornadasIds = Array.isArray(meta.jornadas_ids) ? meta.jornadas_ids.map(j => `#${j}`).join(', ') : '';
      const nroComprobante = `LIQ-HORAS-${String(mov.local_movimiento_id || mov.id).padStart(6, '0')}`;

      Swal.fire({
        title: `<span style="color: #7e22ce; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 1.35rem;">Ticket de Liquidación de Horas</span>`,
        html: `
          <div style="text-align: left; font-family: 'Inter', sans-serif; color: #1e293b; padding: 0.25rem;">
            <div style="background: #7e22ce; color: white; padding: 1.15rem; border-radius: 8px; margin-bottom: 1.25rem; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
              <div style="font-size: 0.8rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Comprobante de Horas en Depósito</div>
              <div style="font-size: 1.25rem; font-weight: 700; margin-top: 0.25rem;">${nroComprobante}</div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem; font-size: 0.85rem;">
              <div>
                <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">FECHA DE LIQUIDACIÓN</span>
                <strong style="color: #1e293b;">${new Date(mov.fecha).toLocaleDateString('es-AR')}</strong>
              </div>
              <div>
                <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">COLABORADOR / CLIENTE</span>
                <strong style="color: #1e293b;">${colaboradorNombre}</strong>
              </div>
            </div>

            <div style="background: #fdf4ff; border-radius: 6px; padding: 0.75rem 0.85rem; font-size: 0.85rem; color: #581c87; border: 1px solid #f0abfc; margin-bottom: 1.25rem; text-align: left;">
              <div style="font-weight: 700; color: #7e22ce; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;">Detalle del Desempeño</div>
              <div><span style="font-weight: 600;">Concepto:</span> ${mov.numero_comprobante || 'Liquidación de horas en depósito'}</div>
              ${horasTexto ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Tiempo Liquidado:</span> <strong>${horasTexto}</strong></div>` : ''}
              ${jornadasIds ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Jornadas enlazadas:</span> ${jornadasIds}</div>` : ''}
            </div>

            <div style="border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 1rem 0; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Monto Acreditado (Haber)</span>
                <span style="font-size: 1.4rem; font-weight: 750; color: #16a34a">${montoDisplay}</span>
              </div>
              <div style="text-align: right;">
                <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Saldo de Cuenta</span>
                <span style="font-size: 1.1rem; font-weight: 700; color: #1e293b">${formatCurrency(currentBalance)}</span>
              </div>
            </div>

            <div style="font-size: 0.75rem; color: #64748b; text-align: center; line-height: 1.45; background: #f8fafc; border-radius: 6px; padding: 0.65rem; margin-bottom: 1.25rem;">
              Este comprobante está sincronizado desde el registro de jornadas del sistema LAMDA.
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; border-top: 1px solid #e2e8f0; padding-top: 1.15rem;">
              <button id="btn-swal-wa" class="swal-action-button wa-btn">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.457L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.37 9.864-9.799.002-2.63-1.023-5.101-2.885-6.965C16.59 1.977 14.113.953 11.5.953c-5.44 0-9.866 4.372-9.87 9.802 0 1.696.463 3.35 1.337 4.79L1.93 21.02l5.717-1.866zM17.487 14.39c-.3-.15-1.774-.875-2.05-.975-.275-.1-.475-.15-.675.15-.2.3-.775.975-.95 1.175-.175.2-.35.225-.65.075-.3-.15-1.267-.467-2.413-1.49-.893-.797-1.496-1.782-1.67-2.083-.175-.3-.018-.463.13-.612.135-.133.3-.35.45-.525.15-.175.2-.3.3-.5s.05-.375-.025-.525c-.075-.15-.675-1.625-.925-2.225-.244-.589-.492-.51-.675-.518-.173-.008-.373-.01-.573-.01-.2 0-.525.075-.8.375-.275.3-1.05 1.025-1.05 2.5s1.025 2.9 1.175 3.1c.15.2 2.013 3.074 4.877 4.31.683.295 1.218.472 1.635.604.686.218 1.312.187 1.806.114.55-.082 1.774-.725 2.025-1.425.25-.7.25-1.3 0-1.425-.075-.125-.275-.2-.575-.35z"/></svg>
                <span>WhatsApp</span>
              </button>
              <button id="btn-swal-print" class="swal-action-button print-btn">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                <span>Imprimir</span>
              </button>
            </div>
          </div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Cerrar',
        cancelButtonColor: '#475569',
        background: '#ffffff',
        color: '#1e293b',
        customClass: {
          popup: 'swal-b2b-popup',
          cancelButton: 'swal-b2b-btn'
        },
        didOpen: () => {
          const btnWa = document.getElementById('btn-swal-wa');
          const btnPrint = document.getElementById('btn-swal-print');
          if (btnWa) {
            btnWa.addEventListener('click', () => {
              const text = encodeURIComponent(`Hola! Comparto mi comprobante de liquidación de horas en LAMDA:\n*${nroComprobante}*\nColaborador: ${colaboradorNombre}\nFecha: ${new Date(mov.fecha).toLocaleDateString('es-AR')}\nTiempo: ${horasTexto || '-'}\nMonto Acreditado: ${montoDisplay}\nSaldo Actual: ${formatCurrency(currentBalance)}`);
              window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
            });
          }
          if (btnPrint) {
            btnPrint.addEventListener('click', () => {
              imprimirComprobanteGenerico(
                'Ticket de Liquidación de Horas',
                '#7e22ce',
                'Comprobante de Horas en Depósito',
                nroComprobante,
                new Date(mov.fecha).toLocaleDateString('es-AR'),
                colaboradorNombre,
                'Detalle del Desempeño',
                '#fdf4ff',
                '#f0abfc',
                '#581c87',
                `<div><strong>Concepto:</strong> ${mov.numero_comprobante || 'Liquidación de horas'}</div>` +
                (horasTexto ? `<div style="margin-top: 4px;"><strong>Tiempo Liquidado:</strong> ${horasTexto}</div>` : '') +
                (jornadasIds ? `<div style="margin-top: 4px;"><strong>Jornadas enlazadas:</strong> ${jornadasIds}</div>` : ''),
                'Monto Acreditado (Haber)',
                montoDisplay,
                formatCurrency(currentBalance),
                'Este comprobante está sincronizado desde el registro de jornadas del sistema LAMDA.'
              );
            });
          }
        }
      });
      return;
    }

    // Modal para Rendimiento de Producción Externa (CR)
    if (mov.tipo_comprobante === 'CR') {
      let nroCarro = meta.carro_id || null;
      let detalleProduccion = null;
      let articuloNombre = meta.articulo_nombre || null;
      let articuloCodigo = meta.articulo_codigo || null;
      if (meta.cantidad && meta.unidad_medida) {
        detalleProduccion = `${meta.cantidad} ${meta.unidad_medida}`;
      }

      if (!nroCarro || !detalleProduccion) {
        const match = (mov.numero_comprobante || '').match(/carro externo #(\d+)(?:\s*\(([^)]+)\))?/i);
        if (match) {
          if (!nroCarro) nroCarro = match[1];
          if (!detalleProduccion && match[2]) detalleProduccion = match[2];
        }
      }

      const productorNombre = meta.colaborador || clientName;
      const tarifaDetalle = meta.tarifa_unitaria ? `$${meta.tarifa_unitaria.toLocaleString('es-AR')}/${meta.unidad_medida || 'un'}` : null;
      const nroComprobante = `LIQ-REND-${String(mov.local_movimiento_id || mov.id).padStart(6, '0')}`;

      Swal.fire({
        title: `<span style="color: #047857; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 1.35rem;">Ticket de Rendimiento Externo</span>`,
        html: `
          <div style="text-align: left; font-family: 'Inter', sans-serif; color: #1e293b; padding: 0.25rem;">
            <div style="background: #047857; color: white; padding: 1.15rem; border-radius: 8px; margin-bottom: 1.25rem; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
              <div style="font-size: 0.8rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Liquidación de Carro Externo</div>
              <div style="font-size: 1.25rem; font-weight: 700; margin-top: 0.25rem;">${nroComprobante}</div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem; font-size: 0.85rem;">
              <div>
                <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">FECHA LIQUIDACIÓN</span>
                <strong style="color: #1e293b;">${new Date(mov.fecha).toLocaleDateString('es-AR')}</strong>
              </div>
              <div>
                <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">PRODUCTOR / CLIENTE</span>
                <strong style="color: #1e293b;">${productorNombre}</strong>
              </div>
            </div>

            <div style="background: #ecfdf5; border-radius: 6px; padding: 0.75rem 0.85rem; font-size: 0.85rem; color: #065f46; border: 1px solid #a7f3d0; margin-bottom: 1.25rem; text-align: left;">
              <div style="font-weight: 700; color: #047857; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;">Información del Lote / Carro</div>
              <div><span style="font-weight: 600;">Concepto:</span> ${mov.numero_comprobante || 'Crédito por rendimiento carro'}</div>
              ${nroCarro ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Carro de Producción:</span> <strong>#${nroCarro}</strong></div>` : ''}
              ${articuloNombre ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Producto Elaborado:</span> <strong style="color: #047857;">${articuloNombre} ${articuloCodigo ? `(${articuloCodigo})` : ''}</strong></div>` : (articuloCodigo ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Código Producto:</span> <strong>${articuloCodigo}</strong></div>` : '')}
              ${detalleProduccion ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Rendimiento Obtenido:</span> <strong>${detalleProduccion}</strong></div>` : ''}
              ${tarifaDetalle ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Tarifa Aplicada:</span> ${tarifaDetalle}</div>` : ''}
            </div>

            <div style="border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 1rem 0; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Monto Acreditado (Haber)</span>
                <span style="font-size: 1.4rem; font-weight: 750; color: #16a34a">${montoDisplay}</span>
              </div>
              <div style="text-align: right;">
                <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Saldo de Cuenta</span>
                <span style="font-size: 1.1rem; font-weight: 700; color: #1e293b">${formatCurrency(currentBalance)}</span>
              </div>
            </div>

            <div style="font-size: 0.75rem; color: #64748b; text-align: center; line-height: 1.45; background: #f8fafc; border-radius: 6px; padding: 0.65rem; margin-bottom: 1.25rem;">
              Este comprobante está sincronizado desde la Pizarra de Producción del sistema LAMDA.
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; border-top: 1px solid #e2e8f0; padding-top: 1.15rem;">
              <button id="btn-swal-wa" class="swal-action-button wa-btn">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.457L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.37 9.864-9.799.002-2.63-1.023-5.101-2.885-6.965C16.59 1.977 14.113.953 11.5.953c-5.44 0-9.866 4.372-9.87 9.802 0 1.696.463 3.35 1.337 4.79L1.93 21.02l5.717-1.866zM17.487 14.39c-.3-.15-1.774-.875-2.05-.975-.275-.1-.475-.15-.675.15-.2.3-.775.975-.95 1.175-.175.2-.35.225-.65.075-.3-.15-1.267-.467-2.413-1.49-.893-.797-1.496-1.782-1.67-2.083-.175-.3-.018-.463.13-.612.135-.133.3-.35.45-.525.15-.175.2-.3.3-.5s.05-.375-.025-.525c-.075-.15-.675-1.625-.925-2.225-.244-.589-.492-.51-.675-.518-.173-.008-.373-.01-.573-.01-.2 0-.525.075-.8.375-.275.3-1.05 1.025-1.05 2.5s1.025 2.9 1.175 3.1c.15.2 2.013 3.074 4.877 4.31.683.295 1.218.472 1.635.604.686.218 1.312.187 1.806.114.55-.082 1.774-.725 2.025-1.425.25-.7.25-1.3 0-1.425-.075-.125-.275-.2-.575-.35z"/></svg>
                <span>WhatsApp</span>
              </button>
              <button id="btn-swal-print" class="swal-action-button print-btn">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                <span>Imprimir</span>
              </button>
            </div>
          </div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Cerrar',
        cancelButtonColor: '#475569',
        background: '#ffffff',
        color: '#1e293b',
        customClass: {
          popup: 'swal-b2b-popup',
          cancelButton: 'swal-b2b-btn'
        },
        didOpen: () => {
          const btnWa = document.getElementById('btn-swal-wa');
          const btnPrint = document.getElementById('btn-swal-print');
          if (btnWa) {
            btnWa.addEventListener('click', () => {
              const text = encodeURIComponent(`Hola! Comparto mi comprobante de rendimiento de producción en LAMDA:\n*${nroComprobante}*\nProductor: ${productorNombre}\nFecha: ${new Date(mov.fecha).toLocaleDateString('es-AR')}\nCarro: #${nroCarro || '-'}\nProducto: ${articuloNombre || articuloCodigo || '-'}\nCantidad: ${detalleProduccion || '-'}\nMonto Acreditado: ${montoDisplay}\nSaldo Actual: ${formatCurrency(currentBalance)}`);
              window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
            });
          }
          if (btnPrint) {
            btnPrint.addEventListener('click', () => {
              imprimirComprobanteGenerico(
                'Ticket de Rendimiento Externo',
                '#047857',
                'Liquidación de Carro Externo',
                nroComprobante,
                new Date(mov.fecha).toLocaleDateString('es-AR'),
                productorNombre,
                'Información del Lote / Carro',
                '#ecfdf5',
                '#a7f3d0',
                '#065f46',
                `<div><strong>Concepto:</strong> ${mov.numero_comprobante || 'Crédito por rendimiento'}</div>` +
                (nroCarro ? `<div style="margin-top: 4px;"><strong>Carro de Producción:</strong> #${nroCarro}</div>` : '') +
                (articuloNombre ? `<div style="margin-top: 4px;"><strong>Producto Elaborado:</strong> ${articuloNombre} ${articuloCodigo ? `(${articuloCodigo})` : ''}</div>` : '') +
                (detalleProduccion ? `<div style="margin-top: 4px;"><strong>Rendimiento Obtenido:</strong> ${detalleProduccion}</div>` : '') +
                (tarifaDetalle ? `<div style="margin-top: 4px;"><strong>Tarifa Aplicada:</strong> ${tarifaDetalle}</div>` : ''),
                'Monto Acreditado (Haber)',
                montoDisplay,
                formatCurrency(currentBalance),
                'Este comprobante está sincronizado desde la Pizarra de Producción del sistema LAMDA.'
              );
            });
          }
        }
      });
      return;
    }

    const tipoLabel = mov.tipo_comprobante === 'FC' ? 'Factura' : 
                      mov.tipo_comprobante === 'NC' ? 'Nota de Crédito' : 
                      mov.tipo_comprobante === 'RC' ? 'Recibo' : 
                      mov.tipo_comprobante === 'ND' ? 'Nota de Débito' : 
                      mov.tipo_comprobante === 'AP' ? 'Ajuste de Apertura' : 'Documento';

    let metadataHtml = '';
    if (mov.tipo_comprobante === 'RC' && mov.metadatos) {
      const tipoPago = meta.tipo_pago || 'Transferencia';
      const banco = meta.banco_origen ? `<div style="margin-top: 0.35rem;"><span style="color: #64748b; font-weight: 600;">Banco de Origen:</span> ${meta.banco_origen}</div>` : '';
      const operacion = meta.nro_operacion ? `<div style="margin-top: 0.35rem;"><span style="color: #64748b; font-weight: 600;">Operación:</span> #${meta.nro_operacion}</div>` : '';
      metadataHtml = `
        <div style="background: #f8fafc; border-radius: 6px; padding: 0.65rem 0.85rem; font-size: 0.8rem; color: #475569; border: 1px solid #e2e8f0; margin-bottom: 1.25rem;">
          <div style="font-weight: 700; color: #8e4785; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem;">Información del Pago</div>
          <div><span style="color: #64748b; font-weight: 600;">Método:</span> ${tipoPago}</div>
          ${banco}
          ${operacion}
        </div>
      `;
    } else if (['FC', 'ND'].includes(mov.tipo_comprobante)) {
      const movKey = String(mov.id || mov.local_movimiento_id);
      const capa = capasAbiertasMap[movKey];
      const canceladoInfo = comprobantesCanceladosMap[movKey];
      if (capa && capa.saldo_pendiente_capa > 1) {
        const esEst = capa.estado_capa === 'VENTANA_ESTANDAR';
        const esGra = capa.estado_capa === 'GRACIA_NATURAL';
        const esCor = capa.estado_capa === 'VENTANA_CORTESIA';
        const boxBg = esEst ? '#ecfdf5' : esGra ? '#f0fdfa' : esCor ? '#f0f9ff' : '#fffbeb';
        const boxBdr = esEst ? '#a7f3d0' : esGra ? '#99f6e4' : esCor ? '#bae6fd' : '#fde68a';
        const boxClr = esEst ? '#065f46' : esGra ? '#115e59' : esCor ? '#0369a1' : '#92400e';
        const badgeTxt = esEst
          ? `🟢 Plazo Habitual (Día ${capa.dias_transcurridos} de ${capa.dias_estandar}) — 0% Interés`
          : esGra
          ? `⏳ +${capa.dias_gracia_natural}d Gracia Natural (Día ${capa.dias_transcurridos} de ${capa.dias_tope_sin_comodin}) — 0% y Sin Usar Comodín`
          : esCor
          ? `🎟️ Comodín Trimestral (Día ${capa.dias_transcurridos} de ${capa.dias_limite_cortesia}) — 0% Interés`
          : `🛡️ SALVAVIDAS DE FINANCIACIÓN ACTIVO (Día ${capa.dias_transcurridos}) — 3,0% mensual + IVA`;
        metadataHtml = `
          <div style="background: ${boxBg}; border-radius: 8px; padding: 0.75rem 0.9rem; font-size: 0.79rem; color: ${boxClr}; border: 1px solid ${boxBdr}; margin-bottom: 1.25rem; line-height: 1.45;">
            <div style="font-weight: 800; font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.35rem;">${badgeTxt}</div>
            <div><strong>Saldo pendiente de este comprobante:</strong> ${formatCurrency(capa.saldo_pendiente_capa)}</div>
            <div style="margin-top: 4px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; background: rgba(255,255,255,0.65); padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.06); font-size: 0.74rem;">
              <div>📦 <strong>Entrega (Día 1):</strong> ${capa.fecha_entrega_fmt}</div>
              <div>🟢 <strong>Compromiso (${capa.dias_estandar}d):</strong> ${capa.fecha_vto_compromiso_fmt}</div>
              <div>⏳ <strong>+${capa.dias_gracia_natural}d Gracia (${capa.dias_tope_sin_comodin}d):</strong> ${capa.fecha_vto_gracia_natural_fmt}</div>
              <div>🎟️ <strong>Tope Comodín (${capa.dias_limite_cortesia}d):</strong> ${capa.fecha_vto_comodin_fmt}</div>
            </div>
            <div style="margin-top: 6px;">
              ${capa.interes_bonificado
                ? `<strong>Interés desde Día 1:</strong> ${formatCurrency(capa.interes_acumulado_desde_dia_1)} <span style="font-weight:800; color:#047857;">(100% BONIFICADO · $ 0,00)</span>`
                : `<div><strong>Interés Salvavidas (3% mensual · ${capa.dias_transcurridos}d):</strong> ${formatCurrency(capa.interes_devengado_capa)} + IVA 21% (${formatCurrency(capa.iva_financiacion_capa)}) = <strong>${formatCurrency(capa.interes_con_iva_capa)}</strong></div>
                   <div style="margin-top: 2px;"><strong>Total actualizado del comprobante (c/IVA):</strong> ${formatCurrency(capa.saldo_proyectado_con_iva)} <span style="font-size:0.72rem;">(${formatCurrency(capa.costo_diario_neto)} + IVA / día)</span></div>`
              }
            </div>
          </div>
        `;
      } else if (canceladoInfo) {
        const esComodin = canceladoInfo.tramo_cancelacion === 'COMODIN_USADO';
        const esGracia = canceladoInfo.tramo_cancelacion === 'GRACIA_NATURAL';
        const boxBg = esComodin ? '#f0f9ff' : '#ecfdf5';
        const boxBdr = esComodin ? '#bae6fd' : '#a7f3d0';
        const boxClr = esComodin ? '#0369a1' : '#065f46';
        metadataHtml = `
          <div style="background: ${boxBg}; border-radius: 8px; padding: 0.75rem 0.9rem; font-size: 0.79rem; color: ${boxClr}; border: 1px solid ${boxBdr}; margin-bottom: 1.25rem; line-height: 1.45;">
            <div style="font-weight: 800; font-size: 0.75rem; text-transform: uppercase; margin-bottom: 0.3rem;">
              ${esComodin
                ? `🎟️ Comprobante Cancelado al Día ${canceladoInfo.dias_hasta_cancelacion} — Utilizó Comodín Trimestral (0% Interés)`
                : esGracia
                ? `⏳ Comprobante Cancelado al Día ${canceladoInfo.dias_hasta_cancelacion} — Dentro de +3d Gracia Natural (Sin usar comodín · 0% Interés)`
                : `🟢 Comprobante Cancelado al Día ${canceladoInfo.dias_hasta_cancelacion} — En Plazo Habitual (0% Interés)`}
            </div>
            <div style="font-size: 0.74rem;">
              📦 <strong>Entrega:</strong> ${canceladoInfo.fecha_entrega_fmt} · ✅ <strong>Cancelado el:</strong> ${canceladoInfo.fecha_cancelacion_fmt}
            </div>
          </div>
        `;
      }
    }

    Swal.fire({
      title: `<span style="color: #8e4785; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 1.35rem;">Detalle de Comprobante</span>`,
      html: `
        <div style="text-align: left; font-family: 'Inter', sans-serif; color: #1e293b; padding: 0.25rem;">
          <div style="background: hsl(185, 68%, 20%); color: white; padding: 1.15rem; border-radius: 8px; margin-bottom: 1.25rem; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
            <div style="font-size: 0.8rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">${tipoLabel}</div>
            <div style="font-size: 1.25rem; font-weight: 700; margin-top: 0.25rem;">${mov.numero_comprobante || `REC-PAGO-${String(mov.local_movimiento_id || mov.id).padStart(8, '0')}`}</div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem; font-size: 0.85rem;">
            <div>
              <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">FECHA EMISIÓN</span>
              <strong style="color: #1e293b;">${new Date(mov.fecha).toLocaleDateString()}</strong>
            </div>
            <div>
              <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">CÓDIGO CLIENTE</span>
              <strong style="color: #1e293b;">${mov.cliente_id}</strong>
            </div>
          </div>
          ${metadataHtml}
          <div style="border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 1rem 0; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">${isDebe ? 'Monto Facturado' : 'Monto Recibido'}</span>
              <span style="font-size: 1.4rem; font-weight: 750; color: ${isDebe ? '#e11d48' : '#16a34a'}">${montoDisplay}</span>
            </div>
            <div style="text-align: right;">
              <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Saldo de Cuenta</span>
              <span style="font-size: 1.1rem; font-weight: 700; color: #1e293b">${formatCurrency(currentBalance)}</span>
            </div>
          </div>
          <div style="font-size: 0.75rem; color: #64748b; text-align: center; line-height: 1.45; background: #f8fafc; border-radius: 6px; padding: 0.65rem; margin-bottom: 1.25rem;">
            Este documento está sincronizado desde la base de datos local del sistema de administración LAMDA.
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; border-top: 1px solid #e2e8f0; padding-top: 1.15rem;">
            <button id="btn-swal-wa" class="swal-action-button wa-btn">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.457L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.37 9.864-9.799.002-2.63-1.023-5.101-2.885-6.965C16.59 1.977 14.113.953 11.5.953c-5.44 0-9.866 4.372-9.87 9.802 0 1.696.463 3.35 1.337 4.79L1.93 21.02l5.717-1.866zM17.487 14.39c-.3-.15-1.774-.875-2.05-.975-.275-.1-.475-.15-.675.15-.2.3-.775.975-.95 1.175-.175.2-.35.225-.65.075-.3-.15-1.267-.467-2.413-1.49-.893-.797-1.496-1.782-1.67-2.083-.175-.3-.018-.463.13-.612.135-.133.3-.35.45-.525.15-.175.2-.3.3-.5s.05-.375-.025-.525c-.075-.15-.675-1.625-.925-2.225-.244-.589-.492-.51-.675-.518-.173-.008-.373-.01-.573-.01-.2 0-.525.075-.8.375-.275.3-1.05 1.025-1.05 2.5s1.025 2.9 1.175 3.1c.15.2 2.013 3.074 4.877 4.31.683.295 1.218.472 1.635.604.686.218 1.312.187 1.806.114.55-.082 1.774-.725 2.025-1.425.25-.7.25-1.3 0-1.425-.075-.125-.275-.2-.575-.35z"/></svg>
              <span>WhatsApp</span>
            </button>
            <button id="btn-swal-print" class="swal-action-button print-btn">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
              <span>Imprimir</span>
            </button>
            <button id="btn-swal-download" class="swal-action-button dl-btn">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>Descargar</span>
            </button>
          </div>
        </div>
      `,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: 'Cerrar',
      cancelButtonColor: '#475569',
      background: '#ffffff',
      color: '#1e293b',
      customClass: {
        popup: 'swal-b2b-popup',
        cancelButton: 'swal-b2b-btn'
      },
      didOpen: () => {
        const btnWa = document.getElementById('btn-swal-wa');
        const btnPrint = document.getElementById('btn-swal-print');
        const btnDownload = document.getElementById('btn-swal-download');

        if (btnWa) {
          btnWa.addEventListener('click', () => {
            if (!mov.comprobante_url) {
              Swal.fire({
                title: 'No disponible',
                text: 'El comprobante PDF aún se está procesando.',
                icon: 'info',
                confirmButtonColor: '#8e4785'
              });
              return;
            }
            const cleanUrl = mov.comprobante_url ? `${mov.comprobante_url}?t=${Date.now()}` : '';
            const text = encodeURIComponent(`Hola! Comparto el comprobante de pago de mi cuenta corriente en LAMDA: ${cleanUrl}`);
            window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
          });
        }

        if (btnPrint) {
          btnPrint.addEventListener('click', () => {
            if (!mov.comprobante_url) {
              Swal.fire({
                title: 'No disponible',
                text: 'El comprobante PDF aún se está procesando.',
                icon: 'info',
                confirmButtonColor: '#8e4785'
              });
              return;
            }
            const cleanUrl = mov.comprobante_url ? `${mov.comprobante_url}?t=${Date.now()}` : '';
            window.open(cleanUrl, '_blank');
          });
        }

        if (btnDownload) {
          btnDownload.addEventListener('click', () => {
            handleDownload(mov);
          });
        }
      }
    });
  };

  // Cálculos de saldo
  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS'
    }).format(val);
  };

  // Helpers de fecha en zona horaria Argentina para hitos exactos
  const parseDateMidnightAR = (dateInput) => {
    if (!dateInput) return new Date();
    const s = String(dateInput).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(dt);
      const y = Number(parts.find(p => p.type === 'year')?.value);
      const m = Number(parts.find(p => p.type === 'month')?.value);
      const d = Number(parts.find(p => p.type === 'day')?.value);
      if (y && m && d) return new Date(y, m - 1, d);
    } catch (e) {}
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  };

  const formatDateAR = (dateInput, addDays = 0) => {
    const base = parseDateMidnightAR(dateInput);
    if (addDays) base.setDate(base.getDate() + addDays);
    return base.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  // El saldo consolidado es el saldo del movimiento más reciente
  const saldoConsolidado = movements.length > 0 ? parseFloat(movements[0].saldo) : 0;

  // Cálculo en vivo del Esquema de 4 Etapas (Compromiso 7d + 3d Gracia Natural + Comodín 11-14d + Salvavidas 15d+ 3% + IVA)
  const { resumenFinanciacion, capasAbiertasMap, capasAbiertasList, comprobantesCanceladosMap, comodinesHistorial } = React.useMemo(() => {
    const mapaAbiertas = {};
    const mapaCancelados = {};
    let metaCuenta = null;

    for (const m of movements) {
      if (m.metadatos) {
        try {
          const parsed = typeof m.metadatos === 'string' ? JSON.parse(m.metadatos) : m.metadatos;
          if (parsed?.salvavidas_cuenta && !metaCuenta) {
            metaCuenta = parsed.salvavidas_cuenta;
          }
          const sc = parsed?.salvavidas_comprobante;
          if (sc && sc.estado_comprobante === 'CANCELADO') {
            const keyMov = String(m.id || m.local_movimiento_id);
            const fPtoCero = sc.punto_cero || sc.punto_cero_fecha || m.fecha;
            mapaCancelados[keyMov] = {
              ...sc,
              key: keyMov,
              numero_comprobante: m.numero_comprobante,
              fecha_entrega_fmt: formatDateAR(fPtoCero, 0),
              fecha_vto_compromiso_fmt: formatDateAR(fPtoCero, 7),
              fecha_vto_gracia_natural_fmt: formatDateAR(fPtoCero, 10),
              fecha_vto_comodin_fmt: formatDateAR(fPtoCero, 14),
              fecha_cancelacion_fmt: sc.fecha_cancelacion ? formatDateAR(sc.fecha_cancelacion, 0) : '-'
            };
          }
        } catch (e) {}
      }
    }

    const modoSwitch = metaCuenta?.modo_switch || (metaCuenta?.habilitado === false ? 'EXCLUIDO' : 'ACTIVO');
    const esExcluido = modoSwitch === 'EXCLUIDO' || metaCuenta?.habilitado === false;
    const esModoSombra = modoSwitch === 'SOMBRA';
    const cupoAnual = metaCuenta?.cupo_cortesias_anual != null ? Number(metaCuenta.cupo_cortesias_anual) : 3;
    const histComodines = Array.isArray(metaCuenta?.comodines_historial) ? metaCuenta.comodines_historial : [];
    const usadasAnio = Math.max(
      metaCuenta?.cortesias_usadas_anio != null ? Number(metaCuenta.cortesias_usadas_anio) : 0,
      histComodines.length
    );
    const comodinesRestantes = Math.max(0, cupoAnual - usadasAnio);
    const tasaMensual = metaCuenta?.tasa_mensual_pct != null ? Number(metaCuenta.tasa_mensual_pct) : 3.0;
    const tasaDiaria = (tasaMensual / 30) / 100; // 0,1% diario (3,0% mensual)
    const ivaPct = 21;
    const diasEst = metaCuenta?.dias_ventana_estandar != null ? Number(metaCuenta.dias_ventana_estandar) : 7;
    const diasGraciaNat = metaCuenta?.dias_gracia_natural != null ? Number(metaCuenta.dias_gracia_natural) : 3;
    const diasTopeSinComodin = metaCuenta?.dias_tope_sin_comodin != null ? Number(metaCuenta.dias_tope_sin_comodin) : (diasEst + diasGraciaNat);
    const diasLimCortesia = metaCuenta?.dias_total_cortesia != null ? Number(metaCuenta.dias_total_cortesia) : 14;

    if (saldoConsolidado <= 1) {
      return {
        capasAbiertasMap: mapaAbiertas,
        capasAbiertasList: [],
        comprobantesCanceladosMap: mapaCancelados,
        comodinesHistorial: histComodines,
        resumenFinanciacion: {
          modo_switch: modoSwitch,
          es_modo_sombra: esModoSombra,
          es_excluido: esExcluido,
          estado_general: 'AL_DIA',
          salvavidas_activo: false,
          dias_estandar: diasEst,
          dias_gracia_natural: diasGraciaNat,
          dias_tope_sin_comodin: diasTopeSinComodin,
          dias_limite_cortesia: diasLimCortesia,
          tasa_mensual_pct: tasaMensual,
          iva_porcentaje: ivaPct,
          cupo_cortesias_anual: cupoAnual,
          cortesias_usadas_anio: usadasAnio,
          cortesias_restantes_anio: comodinesRestantes,
          interes_activo_total: 0,
          iva_activo_total: 0,
          interes_activo_con_iva_total: 0,
          saldo_total_con_salvavidas: saldoConsolidado,
          costo_diario_neto_total: 0,
          costo_diario_con_iva_total: 0,
          interes_bonificado_total: 0,
          interes_reloj_dia_1_total: 0,
          max_dias: 0,
          capas_count: 0
        }
      };
    }

    // Reconstruir capas abiertas desde el último comprobante hacia atrás hasta cubrir saldoConsolidado
    let restante = saldoConsolidado;
    const hoyMidnight = parseDateMidnightAR(new Date()).getTime();
    const cargos = movements.filter(m => parseFloat(m.debe) > 0);
    const capas = [];

    for (const c of cargos) {
      if (restante <= 0.01) break;
      const importeOriginal = parseFloat(c.debe) || 0;
      const saldoCapa = Math.round(Math.min(restante, importeOriginal) * 100) / 100;
      restante = Math.round((restante - saldoCapa) * 100) / 100;

      let metaC = {};
      if (c.metadatos) {
        try {
          metaC = typeof c.metadatos === 'string' ? JSON.parse(c.metadatos) : c.metadatos;
        } catch (e) {}
      }
      const sc = metaC?.salvavidas_comprobante || {};
      const fechaBaseStr = sc.punto_cero || sc.punto_cero_fecha || c.fecha;
      const baseMs = parseDateMidnightAR(fechaBaseStr).getTime();
      const diasTrans = Math.max(1, Math.round((hoyMidnight - baseMs) / (1000 * 60 * 60 * 24)));

      const interesDesdeDia1 = Math.round(saldoCapa * tasaDiaria * diasTrans * 100) / 100;
      const costoDiarioNeto = Math.round(saldoCapa * tasaDiaria * 100) / 100;
      const costoDiarioConIva = Math.round(costoDiarioNeto * 1.21 * 100) / 100;

      let estadoCapa = 'VENTANA_ESTANDAR';
      let interesActivo = 0;
      let ivaCapa = 0;
      let interesConIvaCapa = 0;
      let interesBonif = true;

      if (esExcluido) {
        estadoCapa = 'VENTANA_ESTANDAR';
        interesBonif = true;
      } else if (diasTrans <= diasEst) {
        estadoCapa = 'VENTANA_ESTANDAR';
        interesBonif = true;
      } else if (diasTrans <= diasTopeSinComodin) {
        estadoCapa = 'GRACIA_NATURAL';
        interesBonif = true;
      } else if (diasTrans <= diasLimCortesia && comodinesRestantes > 0) {
        estadoCapa = 'VENTANA_CORTESIA';
        interesBonif = true;
      } else {
        estadoCapa = 'FINANCIACION_ACTIVA';
        interesBonif = false;
        interesActivo = interesDesdeDia1;
        ivaCapa = Math.round(interesActivo * 0.21 * 100) / 100;
        interesConIvaCapa = Math.round((interesActivo + ivaCapa) * 100) / 100;
      }

      const objCapa = {
        key: String(c.id || c.local_movimiento_id),
        numero_comprobante: c.numero_comprobante,
        importe_original: importeOriginal,
        saldo_pendiente_capa: saldoCapa,
        dias_transcurridos: diasTrans,
        dias_estandar: diasEst,
        dias_gracia_natural: diasGraciaNat,
        dias_tope_sin_comodin: diasTopeSinComodin,
        dias_limite_cortesia: diasLimCortesia,
        fecha_entrega_fmt: formatDateAR(fechaBaseStr, 0),
        fecha_vto_compromiso_fmt: formatDateAR(fechaBaseStr, diasEst),
        fecha_vto_gracia_natural_fmt: formatDateAR(fechaBaseStr, diasTopeSinComodin),
        fecha_vto_comodin_fmt: formatDateAR(fechaBaseStr, diasLimCortesia),
        estado_capa: estadoCapa,
        interes_acumulado_desde_dia_1: interesDesdeDia1,
        interes_devengado_capa: interesActivo,
        iva_financiacion_capa: ivaCapa,
        interes_con_iva_capa: interesConIvaCapa,
        costo_diario_neto: costoDiarioNeto,
        costo_diario_con_iva: costoDiarioConIva,
        saldo_proyectado_con_iva: Math.round((saldoCapa + interesConIvaCapa) * 100) / 100,
        interes_bonificado: interesBonif
      };
      mapaAbiertas[objCapa.key] = objCapa;
      capas.push(objCapa);
    }

    // Ordenar capas cronológicamente (más antigua primero) para el cuadro de diagnóstico
    const capasCronologicas = [...capas].reverse();

    let estadoGral = 'VENTANA_ESTANDAR';
    let intActivoTot = 0;
    let ivaActivoTot = 0;
    let intConIvaTot = 0;
    let costoDiarioNetoTot = 0;
    let costoDiarioConIvaTot = 0;
    let intBonifTot = 0;
    let maxDias = 0;

    for (const cp of capas) {
      if (cp.dias_transcurridos > maxDias) maxDias = cp.dias_transcurridos;
      if (cp.estado_capa === 'FINANCIACION_ACTIVA') {
        estadoGral = 'FINANCIACION_ACTIVA';
        intActivoTot += cp.interes_devengado_capa;
        ivaActivoTot += cp.iva_financiacion_capa;
        intConIvaTot += cp.interes_con_iva_capa;
        costoDiarioNetoTot += cp.costo_diario_neto;
        costoDiarioConIvaTot += cp.costo_diario_con_iva;
      } else {
        if (cp.estado_capa === 'VENTANA_CORTESIA' && estadoGral !== 'FINANCIACION_ACTIVA') {
          estadoGral = 'VENTANA_CORTESIA';
        } else if (cp.estado_capa === 'GRACIA_NATURAL' && estadoGral === 'VENTANA_ESTANDAR') {
          estadoGral = 'GRACIA_NATURAL';
        }
        intBonifTot += cp.interes_acumulado_desde_dia_1;
      }
    }

    intActivoTot = Math.round(intActivoTot * 100) / 100;
    ivaActivoTot = Math.round(ivaActivoTot * 100) / 100;
    intConIvaTot = Math.round((intActivoTot + ivaActivoTot) * 100) / 100;
    costoDiarioNetoTot = Math.round(costoDiarioNetoTot * 100) / 100;
    costoDiarioConIvaTot = Math.round(costoDiarioConIvaTot * 100) / 100;

    return {
      capasAbiertasMap: mapaAbiertas,
      capasAbiertasList: capasCronologicas,
      comprobantesCanceladosMap: mapaCancelados,
      comodinesHistorial: histComodines,
      resumenFinanciacion: {
        modo_switch: modoSwitch,
        es_modo_sombra: esModoSombra,
        es_excluido: esExcluido,
        estado_general: estadoGral,
        salvavidas_activo: !esModoSombra && !esExcluido && estadoGral === 'FINANCIACION_ACTIVA',
        dias_estandar: diasEst,
        dias_gracia_natural: diasGraciaNat,
        dias_tope_sin_comodin: diasTopeSinComodin,
        dias_limite_cortesia: diasLimCortesia,
        tasa_mensual_pct: tasaMensual,
        iva_porcentaje: ivaPct,
        cupo_cortesias_anual: cupoAnual,
        cortesias_usadas_anio: usadasAnio,
        cortesias_restantes_anio: comodinesRestantes,
        interes_activo_total: intActivoTot,
        iva_activo_total: ivaActivoTot,
        interes_activo_con_iva_total: intConIvaTot,
        saldo_total_con_salvavidas: (esModoSombra || esExcluido)
          ? saldoConsolidado
          : Math.round((saldoConsolidado + intConIvaTot) * 100) / 100,
        saldo_simulado_sombra: Math.round((saldoConsolidado + intConIvaTot) * 100) / 100,
        costo_diario_neto_total: costoDiarioNetoTot,
        costo_diario_con_iva_total: costoDiarioConIvaTot,
        interes_bonificado_total: Math.round(intBonifTot * 100) / 100,
        interes_reloj_dia_1_total: Math.round((intActivoTot + intBonifTot) * 100) / 100,
        max_dias: maxDias,
        capas_count: capas.length
      }
    };
  }, [movements, saldoConsolidado]);
  
  // Total facturado (compras)
  const totalFacturado = movements.reduce((acc, mov) => {
    if (mov.tipo_comprobante === 'FC' || mov.tipo_comprobante === 'ND') {
      return acc + parseFloat(mov.debe);
    }
    return acc;
  }, 0);

  // Total pagado (pagos y créditos de colaborador/productor)
  const totalPagado = movements.reduce((acc, mov) => {
    if (['RC', 'NC', 'CH', 'CR'].includes(mov.tipo_comprobante)) {
      return acc + parseFloat(mov.haber);
    }
    return acc;
  }, 0);

  const handleDownload = (mov) => {
    registrarAccesoTelemetria(`📥 Descargó PDF comprobante: ${mov.numero_comprobante || '#' + (mov.local_movimiento_id || mov.id)}`, profile);
    if (!mov.comprobante_url) {
      Swal.fire({
        title: 'Documento No Disponible',
        text: 'El PDF de este comprobante se está procesando en segundo plano y estará disponible en breve.',
        icon: 'info',
        confirmButtonColor: '#8e4785',
        background: '#ffffff',
        color: '#1e293b'
      });
      return;
    }
    
    const cleanUrl = mov.comprobante_url ? `${mov.comprobante_url}?t=${Date.now()}` : '';
    window.open(cleanUrl, '_blank');

    Swal.fire({
      title: 'Descarga Iniciada',
      text: `Se inició la descarga del documento ${mov.numero_comprobante || mov.local_movimiento_id || mov.id}.`,
      icon: 'success',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 2000,
      background: 'hsl(222, 47%, 11%)',
      color: 'var(--text-primary)',
      iconColor: 'var(--success)'
    });
  };

  if (loading) {
    return (
      <div className="spinner-container">
        <Loader2 className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Cargando cuenta corriente...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Estado de Cuenta Corriente</h1>
      </div>

      {error ? (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1rem', borderRadius: '8px', display: 'flex', gap: '0.75rem', alignItems: 'center', color: 'var(--danger)', marginBottom: '2rem' }}>
          <AlertCircle size={20} />
          <p>Error al cargar movimientos: {error}</p>
        </div>
      ) : (
        <>
          <div className="dashboard-cards cc-top-cards">
            {/* Tarjeta 1: Saldo Total Consolidado (Destaca el Total Real con Salvavidas + IVA cuando está activo) */}
            <div className="stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span className="stat-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontWeight: 800 }}>
                  <DollarSign size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  {resumenFinanciacion.salvavidas_activo ? 'Saldo Total Consolidado (c/IVA)' : 'Saldo Consolidado'}
                </span>
                {resumenFinanciacion.salvavidas_activo && (
                  <span style={{
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: 'rgba(245, 158, 11, 0.18)',
                    color: '#fbbf24',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    whiteSpace: 'nowrap'
                  }}>
                    🛡️ SALVAVIDAS ACTIVO
                  </span>
                )}
              </div>

              {/* Número principal destacado en rojo: el Total Real que debe hoy */}
              <span className={`stat-value ${saldoConsolidado > 0 ? 'negative' : 'positive'}`} style={{ marginTop: '0.2rem' }}>
                {formatCurrency(resumenFinanciacion.salvavidas_activo ? resumenFinanciacion.saldo_total_con_salvavidas : saldoConsolidado)}
              </span>

              {resumenFinanciacion.salvavidas_activo ? (
                <div className="cc-breakdown-box">
                  <div className="cc-breakdown-row" style={{ color: '#cbd5e1' }}>
                    <span>Capital de comprobantes:</span>
                    <strong>{formatCurrency(saldoConsolidado)}</strong>
                  </div>
                  <div className="cc-breakdown-row" style={{ color: '#fde68a' }}>
                    <span>
                      + Salvavidas {resumenFinanciacion.tasa_mensual_pct}% ({formatCurrency(resumenFinanciacion.interes_activo_total)}) + IVA ({formatCurrency(resumenFinanciacion.iva_activo_total)}):
                    </span>
                    <strong>+ {formatCurrency(resumenFinanciacion.interes_activo_con_iva_total)}</strong>
                  </div>
                  <div className="cc-breakdown-row" style={{ color: '#ffffff', fontWeight: 800, borderTop: '1px dashed rgba(255,255,255,0.18)', marginTop: '4px', paddingTop: '4px', fontSize: '0.8rem' }}>
                    <span>Total Real a Pagar Hoy (c/IVA):</span>
                    <span className="cc-breakdown-amount" style={{ color: '#f87171' }}>{formatCurrency(resumenFinanciacion.saldo_total_con_salvavidas)}</span>
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {saldoConsolidado > 0 ? 'Pendiente de pago (admite pagos parciales sin cargo en término)' : 'Cuenta al día — Beneficios 5% OFF por volumen activos'}
                </span>
              )}
            </div>

            {/* Tarjeta 2: Estado de Plazos, +3d Gracia Natural, Comodín Trimestral, Salvavidas y Botón de Simulador */}
            <div className="stat-card" style={{
              borderLeft: resumenFinanciacion.estado_general === 'FINANCIACION_ACTIVA'
                ? '4px solid #f59e0b'
                : resumenFinanciacion.estado_general === 'VENTANA_CORTESIA'
                ? '4px solid #0284c7'
                : resumenFinanciacion.estado_general === 'GRACIA_NATURAL'
                ? '4px solid #14b8a6'
                : '4px solid #10b981'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span className="stat-title" style={{ margin: 0, fontWeight: 800 }}>
                  {resumenFinanciacion.estado_general === 'AL_DIA' && '🟢 Estado de Plazos: Al Día'}
                  {resumenFinanciacion.estado_general === 'VENTANA_ESTANDAR' && `🟢 Plazo Habitual (Día ${resumenFinanciacion.max_dias} de ${resumenFinanciacion.dias_estandar})`}
                  {resumenFinanciacion.estado_general === 'GRACIA_NATURAL' && `⏳ +${resumenFinanciacion.dias_gracia_natural}d Gracia Natural (Día ${resumenFinanciacion.max_dias} de ${resumenFinanciacion.dias_tope_sin_comodin})`}
                  {resumenFinanciacion.estado_general === 'VENTANA_CORTESIA' && `🎟️ Comodín Trimestral (Día ${resumenFinanciacion.max_dias} de ${resumenFinanciacion.dias_limite_cortesia})`}
                  {resumenFinanciacion.estado_general === 'FINANCIACION_ACTIVA' && `🛡️ Salvavidas de Financiación: ACTIVO (Día ${resumenFinanciacion.max_dias})`}
                </span>
                <span style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: 'rgba(56, 189, 248, 0.14)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  whiteSpace: 'nowrap'
                }}>
                  🎟️ Comodines Año: {resumenFinanciacion.cortesias_restantes_anio}/{resumenFinanciacion.cupo_cortesias_anual} disp. ({resumenFinanciacion.cortesias_usadas_anio} usado{resumenFinanciacion.cortesias_usadas_anio === 1 ? '' : 's'})
                </span>
              </div>

              {saldoConsolidado <= 1 ? (
                <div style={{ marginTop: '0.45rem' }}>
                  <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#34d399', display: 'block' }}>
                    $ 0,00 (Sin cargo financiero)
                  </span>
                  <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.2rem', lineHeight: 1.35 }}>
                    Compromiso habitual: 7 días + 3 días de gracia naturales (10d sin comodín). Comodín trimestral hasta 14 días ({resumenFinanciacion.cortesias_restantes_anio}/{resumenFinanciacion.cupo_cortesias_anual} disponibles).
                  </span>
                </div>
              ) : resumenFinanciacion.estado_general === 'FINANCIACION_ACTIVA' ? (
                <div style={{ marginTop: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1.18rem', fontWeight: 800, color: '#fbbf24' }}>
                      {formatCurrency(resumenFinanciacion.interes_activo_con_iva_total)}
                    </span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#fde68a' }}>
                      ({formatCurrency(resumenFinanciacion.interes_activo_total)} neto + IVA {formatCurrency(resumenFinanciacion.iva_activo_total)})
                    </span>
                  </div>
                  <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.22rem', lineHeight: 1.35 }}>
                    Superados los 14 días (7d compromiso + 3d gracia natural + 4d comodín), corre el <strong>Salvavidas LAMDA ({resumenFinanciacion.tasa_mensual_pct}% mensual + IVA = 0,1%/día + IVA · {formatCurrency(resumenFinanciacion.costo_diario_con_iva_total)}/día c/IVA)</strong> desde el Día 1 sobre el capital pendiente.
                  </span>
                </div>
              ) : (
                <div style={{ marginTop: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1.18rem', fontWeight: 800, color: '#38bdf8' }}>
                      {formatCurrency(resumenFinanciacion.interes_bonificado_total)}
                    </span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#34d399', background: 'rgba(16, 185, 129, 0.14)', padding: '2px 7px', borderRadius: '6px' }}>
                      100% BONIFICADO ($ 0,00 a pagar)
                    </span>
                  </div>
                  <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.22rem', lineHeight: 1.35 }}>
                    {resumenFinanciacion.estado_general === 'VENTANA_ESTANDAR' &&
                      'Dentro de los 7 días de compromiso habitual: 0% de interés y sin uso de comodín.'}
                    {resumenFinanciacion.estado_general === 'GRACIA_NATURAL' &&
                      'Dentro de los +3 días de gracia naturales (Días 8 a 10 por demoras bancarias / viernes a lunes): 0% de interés y SIN consumir tu comodín trimestral.'}
                    {resumenFinanciacion.estado_general === 'VENTANA_CORTESIA' &&
                      'Dentro de la ventana de Comodín Trimestral (Días 11 a 14): abonando hasta el Día 14 con comodín disponible, el interés queda 100% bonificado ($ 0,00).'}
                  </span>
                </div>
              )}

              {/* Botón de Simulador de Días e Interés (replegado por default) */}
              {saldoConsolidado > 1 && (
                <div style={{ marginTop: 'auto', paddingTop: '0.55rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (diasSimulados === null) setDiasSimulados(Math.min(60, Math.max(1, (resumenFinanciacion.max_dias || 15) + 10)));
                      const nextState = !simuladorAbierto;
                      setSimuladorAbierto(nextState);
                      if (nextState) {
                        registrarAccesoTelemetria('🧮 Abrió Simulador de Días e Interés (Cta. Corriente)', profile);
                        setTimeout(() => {
                          const el = document.getElementById('panel-simulador-financiacion');
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }, 80);
                      }
                    }}
                    style={{
                      background: simuladorAbierto
                        ? 'rgba(245, 158, 11, 0.14)'
                        : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                      color: simuladorAbierto ? '#fbbf24' : '#0f172a',
                      border: '1px solid rgba(245, 158, 11, 0.55)',
                      borderRadius: '8px',
                      padding: '0.52rem 0.85rem',
                      fontSize: '0.77rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      width: '100%',
                      transition: 'all 0.2s ease',
                      boxShadow: simuladorAbierto ? 'none' : '0 4px 12px rgba(245, 158, 11, 0.22)'
                    }}
                  >
                    <span style={{ textAlign: 'left', lineHeight: 1.25 }}>
                      🧮 {simuladorAbierto
                        ? 'Ocultar Simulador de Días e Interés'
                        : 'Simulador de Días e Interés sobre el Capital (hasta 60 días)'}
                    </span>
                    {simuladorAbierto ? <ChevronUp size={16} style={{ flexShrink: 0 }} /> : <ChevronDown size={16} style={{ flexShrink: 0 }} />}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 🧮 SIMULADOR INTERACTIVO DE INTERÉS POR DÍAS SOBRE EL CAPITAL (MÁX. 60 DÍAS / 2 MESES — REPLEGADO POR DEFAULT) */}
          {saldoConsolidado > 1 && simuladorAbierto && (() => {
            const diasHoy = Math.max(1, resumenFinanciacion.max_dias || 15);
            const diasEval = Math.min(60, Math.max(1, diasSimulados != null ? Number(diasSimulados) : diasHoy));
            const pagoParcialNum = Math.max(0, Math.min(saldoConsolidado, parseFloat(String(pagoParcialSimulado).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0));
            const capitalBaseSim = Math.round(Math.max(0, saldoConsolidado - pagoParcialNum) * 100) / 100;
            const tasaDiariaSim = ((resumenFinanciacion.tasa_mensual_pct || 3) / 30) / 100; // 0.001 (0,1%/día)

            const diasEstSim = resumenFinanciacion.dias_estandar || 7;
            const diasGraciaSim = resumenFinanciacion.dias_tope_sin_comodin || 10;
            const diasComodinSim = resumenFinanciacion.dias_limite_cortesia || 14;
            const tieneComodinSim = (resumenFinanciacion.cortesias_restantes_anio || 0) > 0;

            let tramoSim = 'SALVAVIDAS';
            let bonificadoSim = false;
            if (diasEval <= diasEstSim) {
              tramoSim = 'COMPROMISO';
              bonificadoSim = true;
            } else if (diasEval <= diasGraciaSim) {
              tramoSim = 'GRACIA_NATURAL';
              bonificadoSim = true;
            } else if (diasEval <= diasComodinSim && tieneComodinSim) {
              tramoSim = 'COMODIN';
              bonificadoSim = true;
            }

            const interesBrutoSim = Math.round(capitalBaseSim * tasaDiariaSim * diasEval * 100) / 100;
            const interesNetoExigibleSim = bonificadoSim ? 0 : interesBrutoSim;
            const ivaInteresSim = bonificadoSim ? 0 : Math.round(interesNetoExigibleSim * 0.21 * 100) / 100;
            const interesTotalConIvaSim = Math.round((interesNetoExigibleSim + ivaInteresSim) * 100) / 100;
            const totalPagarSim = Math.round((capitalBaseSim + interesTotalConIvaSim) * 100) / 100;

            const costoDiarioNetoSim = Math.round(capitalBaseSim * tasaDiariaSim * 100) / 100;
            const costoDiarioConIvaSim = Math.round(costoDiarioNetoSim * 1.21 * 100) / 100;
            const difDiasRespectoHoy = diasEval - diasHoy;
            const difInteresConIvaRespectoHoy = Math.round((interesTotalConIvaSim - (resumenFinanciacion.interes_activo_con_iva_total || 0)) * 100) / 100;

            const fechaMasAntigua = capasAbiertasList.length > 0 ? capasAbiertasList[0].fecha_entrega_fmt : null;
            let fechaSimuladaStr = '';
            if (fechaMasAntigua && /^\d{2}\/\d{2}\/\d{4}$/.test(fechaMasAntigua)) {
              const [dd, mm, yyyy] = fechaMasAntigua.split('/').map(Number);
              const dtSim = new Date(yyyy, mm - 1, dd);
              dtSim.setDate(dtSim.getDate() + diasEval);
              fechaSimuladaStr = dtSim.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            }

            return (
              <div id="panel-simulador-financiacion" className="cc-sim-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.8rem' }}>
                  <div style={{ flex: '1 1 240px' }}>
                    <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fbbf24', lineHeight: 1.3 }}>
                      🧮 Simulador de Días e Interés sobre tu Capital (Máx. 60 días / 2 meses)
                    </div>
                    <div style={{ fontSize: '0.73rem', color: '#cbd5e1', marginTop: '2px', lineHeight: 1.35 }}>
                      Mové los días o simulá un pago parcial para ver cómo se comporta el interés (0,1%/día + IVA) y tu compromiso total.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setDiasSimulados(diasHoy);
                        setPagoParcialSimulado('');
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.16)',
                        color: '#e2e8f0',
                        borderRadius: '6px',
                        padding: '5px 10px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      ↺ Hoy (Día {diasHoy})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimuladorAbierto(false)}
                      style={{
                        background: 'rgba(245, 158, 11, 0.15)',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        color: '#fbbf24',
                        borderRadius: '6px',
                        padding: '5px 10px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                    >
                      ✕ Ocultar
                    </button>
                  </div>
                </div>

                {/* Controles: Slider de Días (1 a 60) + Botones rápidos + Pago Parcial Opcional */}
                <div className="cc-sim-controls-grid">
                  {/* Control 1: Días a simular (1 a 60 días) */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                      <label style={{ fontSize: '0.76rem', fontWeight: 800, color: '#f8fafc' }}>
                        ⏱️ Días desde la entrega (1 a 60 máx.):
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <button
                          type="button"
                          onClick={() => setDiasSimulados(Math.max(1, diasEval - 1))}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#fff', borderRadius: '6px', width: '32px', height: '30px', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer' }}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={diasEval}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (isNaN(v)) setDiasSimulados(1);
                            else setDiasSimulados(Math.min(60, Math.max(1, v)));
                          }}
                          style={{
                            width: '56px',
                            height: '30px',
                            textAlign: 'center',
                            background: '#0f172a',
                            border: '1px solid #fbbf24',
                            borderRadius: '6px',
                            color: '#fbbf24',
                            fontWeight: 900,
                            fontSize: '0.9rem',
                            padding: '2px 4px'
                          }}
                        />
                        <span style={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 700 }}>días</span>
                        <button
                          type="button"
                          onClick={() => setDiasSimulados(Math.min(60, diasEval + 1))}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#fff', borderRadius: '6px', width: '32px', height: '30px', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer' }}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <input
                      type="range"
                      min={1}
                      max={60}
                      value={diasEval}
                      onChange={(e) => setDiasSimulados(Number(e.target.value))}
                      style={{ width: '100%', height: '24px', accentColor: '#f59e0b', cursor: 'pointer', marginBottom: '0.45rem' }}
                    />

                    {/* Botones rápidos de días */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {[
                        { label: '🟢 7d ($0)', val: 7 },
                        { label: '⏳ 10d Gracia ($0)', val: 10 },
                        { label: `📍 Hoy (${diasHoy}d)`, val: diasHoy },
                        { label: `+5d (${Math.min(60, diasHoy + 5)}d)`, val: Math.min(60, diasHoy + 5) },
                        { label: `+10d (${Math.min(60, diasHoy + 10)}d)`, val: Math.min(60, diasHoy + 10) },
                        { label: '30d (1 mes)', val: 30 },
                        { label: '45d', val: 45 },
                        { label: '60d (2 meses)', val: 60 }
                      ].map((btn, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setDiasSimulados(btn.val)}
                          style={{
                            background: diasEval === btn.val ? '#f59e0b' : 'rgba(255, 255, 255, 0.06)',
                            color: diasEval === btn.val ? '#0f172a' : '#cbd5e1',
                            border: diasEval === btn.val ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '0.69rem',
                            fontWeight: diasEval === btn.val ? 800 : 600,
                            cursor: 'pointer'
                          }}
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Control 2: Simular Pago Parcial Opcional */}
                  <div>
                    <label style={{ fontSize: '0.76rem', fontWeight: 800, color: '#f8fafc', display: 'block', marginBottom: '0.45rem' }}>
                      💸 ¿Simular un pago parcial hoy? (Opcional):
                    </label>
                    <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                      <input
                        type="number"
                        min={0}
                        max={saldoConsolidado}
                        step={1000}
                        placeholder="Ej: 150000 (0 = evaluar saldo total)"
                        value={pagoParcialSimulado}
                        onChange={(e) => setPagoParcialSimulado(e.target.value)}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          background: '#0f172a',
                          border: '1px solid rgba(56, 189, 248, 0.45)',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          padding: '0.45rem 0.65rem',
                          fontSize: '0.82rem',
                          fontWeight: 700
                        }}
                      />
                      {pagoParcialSimulado && (
                        <button
                          type="button"
                          onClick={() => setPagoParcialSimulado('')}
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            color: '#fca5a5',
                            borderRadius: '8px',
                            padding: '0.45rem 0.65rem',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.45rem' }}>
                      {[
                        { label: 'Sin pago parcial ($0)', val: '' },
                        { label: 'Abonar 25%', val: String(Math.round(saldoConsolidado * 0.25)) },
                        { label: 'Abonar 50%', val: String(Math.round(saldoConsolidado * 0.5)) },
                        { label: 'Abonar $100.000', val: '100000' },
                        { label: 'Abonar $150.000', val: '150000' }
                      ].map((b, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setPagoParcialSimulado(b.val)}
                          style={{
                            background: String(pagoParcialSimulado) === b.val ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                            color: String(pagoParcialSimulado) === b.val ? '#38bdf8' : '#94a3b8',
                            border: String(pagoParcialSimulado) === b.val ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '0.68rem',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Resultados en Vivo de la Simulación */}
                <div className="cc-sim-results-grid">
                  <div style={{ background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '10px', padding: '0.65rem 0.75rem' }}>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Capital Base Evaluado</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', marginTop: '2px' }}>
                      {formatCurrency(capitalBaseSim)}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#cbd5e1', marginTop: '2px', lineHeight: 1.3 }}>
                      {pagoParcialNum > 0
                        ? `Descontando pago parcial de ${formatCurrency(pagoParcialNum)}`
                        : `Por día: ${formatCurrency(costoDiarioNetoSim)} + IVA (${formatCurrency(costoDiarioConIvaSim)}/día)`}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '10px', padding: '0.65rem 0.75rem' }}>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Plazo y Tramo Simulado</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: bonificadoSim ? '#34d399' : '#fbbf24', marginTop: '2px' }}>
                      Día {diasEval} {fechaSimuladaStr ? `(${fechaSimuladaStr})` : ''}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#cbd5e1', marginTop: '2px', lineHeight: 1.3 }}>
                      {tramoSim === 'COMPROMISO' && '🟢 Plazo Habitual (1 a 7d) · 0%'}
                      {tramoSim === 'GRACIA_NATURAL' && '⏳ +3d Gracia Natural (8 a 10d) · 0%'}
                      {tramoSim === 'COMODIN' && '🎟️ Comodín Trimestral (11 a 14d) · 0%'}
                      {tramoSim === 'SALVAVIDAS' && (
                        difDiasRespectoHoy === 0
                          ? `🛡️ Estado de Hoy (Día ${diasHoy})`
                          : difDiasRespectoHoy > 0
                          ? `🛡️ +${difDiasRespectoHoy} día(s) adicionales vs hoy`
                          : `🛡️ ${Math.abs(difDiasRespectoHoy)} día(s) antes que hoy`
                      )}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.28)', borderRadius: '10px', padding: '0.65rem 0.75rem' }}>
                    <div style={{ fontSize: '0.68rem', color: '#fde68a', fontWeight: 700, textTransform: 'uppercase' }}>
                      Interés Salvavidas ({ (diasEval * 0.1).toFixed(1).replace('.', ',') }% + IVA)
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: bonificadoSim ? '#34d399' : '#fbbf24', marginTop: '2px' }}>
                      {bonificadoSim ? '$ 0,00 (100% Bonif.)' : `${formatCurrency(interesTotalConIvaSim)} c/IVA`}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#fde68a', marginTop: '2px', lineHeight: 1.3 }}>
                      {bonificadoSim
                        ? `Reloj (${formatCurrency(interesBrutoSim)}) bonificado al 100%`
                        : `Neto: ${formatCurrency(interesNetoExigibleSim)} + IVA: ${formatCurrency(ivaInteresSim)}${difInteresConIvaRespectoHoy > 0 ? ` (+${formatCurrency(difInteresConIvaRespectoHoy)} vs hoy)` : ''}`}
                    </div>
                  </div>

                  <div className="cc-sim-total-card" style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.42)', borderRadius: '10px', padding: '0.65rem 0.8rem' }}>
                    <div style={{ fontSize: '0.68rem', color: '#fca5a5', fontWeight: 800, textTransform: 'uppercase' }}>
                      Total Consolidado al Día {diasEval}
                    </div>
                    <div style={{ fontSize: '1.22rem', fontWeight: 900, color: '#f87171', marginTop: '2px' }}>
                      {formatCurrency(totalPagarSim)}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#fecaca', marginTop: '2px', lineHeight: 1.3 }}>
                      Capital ({formatCurrency(capitalBaseSim)}) + Interés c/IVA ({formatCurrency(interesTotalConIvaSim)})
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Acordeón Replegado por Default: Diagnóstico de tu Cuenta y Esquema de Financiación LAMDA */}
          <div
            className="cc-accordion-panel"
            style={{
              border: resumenFinanciacion.salvavidas_activo
                ? '1px solid rgba(245, 158, 11, 0.4)'
                : '1px solid rgba(255, 255, 255, 0.1)'
            }}
          >
            <button
              type="button"
              className="cc-accordion-header"
              onClick={() => setDiagnosticoAbierto(prev => !prev)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1.3 }}>
                  📌 Diagnóstico de tu Cuenta y Esquema de Financiación LAMDA
                </div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.35 }}>
                  4 tramos (7d Compromiso · +3d Gracia Natural · 14d Comodín · Salvavidas) ·{' '}
                  <strong style={{ color: '#cbd5e1' }}>
                    {capasAbiertasList.length} comprobante{capasAbiertasList.length === 1 ? '' : 's'} pendiente{capasAbiertasList.length === 1 ? '' : 's'}
                  </strong>
                  {' '}· Comodines: {resumenFinanciacion.cortesias_restantes_anio}/{resumenFinanciacion.cupo_cortesias_anual} disp.
                </div>
              </div>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.72rem',
                fontWeight: 800,
                padding: '5px 10px',
                borderRadius: '8px',
                background: diagnosticoAbierto ? 'rgba(245, 158, 11, 0.18)' : 'rgba(255, 255, 255, 0.07)',
                color: diagnosticoAbierto ? '#fbbf24' : '#e2e8f0',
                border: diagnosticoAbierto ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(255, 255, 255, 0.14)',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}>
                <span>{diagnosticoAbierto ? 'Ocultar' : 'Ver detalle'}</span>
                {diagnosticoAbierto ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </span>
            </button>

            {diagnosticoAbierto && (
              <div className="cc-accordion-body">
                {/* Línea de Tiempo de las 4 Etapas LAMDA */}
                <div
                  className="cc-etapas-grid"
                  style={{ marginBottom: capasAbiertasList.length > 0 || comodinesHistorial.length > 0 ? '0.85rem' : '0' }}
                >
                  <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '10px', padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#34d399' }}>🟢 1. Días 1 a {resumenFinanciacion.dias_estandar}: Compromiso</div>
                    <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: '2px', lineHeight: 1.35 }}>
                      Plazo habitual del cliente desde la entrega. <strong>0% interés</strong> y sin usar comodín.
                    </div>
                  </div>

                  <div style={{ background: 'rgba(20, 184, 166, 0.08)', border: '1px solid rgba(20, 184, 166, 0.28)', borderRadius: '10px', padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#2dd4bf' }}>⏳ 2. Días {resumenFinanciacion.dias_estandar + 1} a {resumenFinanciacion.dias_tope_sin_comodin}: +{resumenFinanciacion.dias_gracia_natural}d Gracia Natural</div>
                    <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: '2px', lineHeight: 1.35 }}>
                      Tolerancia natural (ej: pago viernes que acredita lunes). <strong>0% interés y NO usa comodín</strong>.
                    </div>
                  </div>

                  <div style={{ background: 'rgba(2, 132, 199, 0.08)', border: '1px solid rgba(2, 132, 199, 0.25)', borderRadius: '10px', padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#38bdf8' }}>🎟️ 3. Días {resumenFinanciacion.dias_tope_sin_comodin + 1} a {resumenFinanciacion.dias_limite_cortesia}: Comodín Trimestral</div>
                    <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: '2px', lineHeight: 1.35 }}>
                      <strong>1 cada 3 meses ({resumenFinanciacion.cupo_cortesias_anual} al año)</strong> por excepción hasta el día {resumenFinanciacion.dias_limite_cortesia} a <strong>0% interés</strong>.
                    </div>
                  </div>

                  <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.28)', borderRadius: '10px', padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#fbbf24' }}>🛡️ 4. Día {resumenFinanciacion.dias_limite_cortesia + 1}+: Salvavidas LAMDA</div>
                    <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: '2px', lineHeight: 1.35 }}>
                      Financiación activa al <strong>{resumenFinanciacion.tasa_mensual_pct}% mensual + IVA</strong> (0,1%/día + IVA desde Día 1 sobre saldo pendiente).
                    </div>
                  </div>
                </div>

                {/* Cronograma de Comprobantes Abiertos hoy */}
                {capasAbiertasList.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#e2e8f0', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      📅 Cronograma de Fechas de tus Comprobantes Pendientes ({capasAbiertasList.length}):
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                      {capasAbiertasList.map((cp) => {
                        const isSalv = cp.estado_capa === 'FINANCIACION_ACTIVA';
                        const isCor = cp.estado_capa === 'VENTANA_CORTESIA';
                        const isGra = cp.estado_capa === 'GRACIA_NATURAL';
                        return (
                          <div key={cp.key} style={{
                            background: isSalv ? 'rgba(245, 158, 11, 0.07)' : 'rgba(255, 255, 255, 0.03)',
                            border: isSalv ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '10px',
                            padding: '0.65rem 0.8rem',
                            fontSize: '0.75rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.35rem' }}>
                              <strong style={{ color: '#f8fafc', fontSize: '0.8rem' }}>
                                {cp.numero_comprobante} <span style={{ color: '#94a3b8', fontWeight: 500 }}>· Capital pendiente: {formatCurrency(cp.saldo_pendiente_capa)}</span>
                              </strong>
                              <span style={{
                                fontSize: '0.69rem',
                                fontWeight: 800,
                                padding: '3px 8px',
                                borderRadius: '6px',
                                background: isSalv ? 'rgba(245, 158, 11, 0.2)' : isCor ? 'rgba(56, 189, 248, 0.16)' : isGra ? 'rgba(20, 184, 166, 0.16)' : 'rgba(16, 185, 129, 0.16)',
                                color: isSalv ? '#fbbf24' : isCor ? '#38bdf8' : isGra ? '#2dd4bf' : '#34d399',
                                lineHeight: 1.3
                              }}>
                                {isSalv && `🛡️ Día ${cp.dias_transcurridos} · Salvavidas Activo (+${formatCurrency(cp.interes_devengado_capa)} + IVA ${formatCurrency(cp.iva_financiacion_capa)} = ${formatCurrency(cp.interes_con_iva_capa)})`}
                                {isCor && `🎟️ Día ${cp.dias_transcurridos}/${cp.dias_limite_cortesia} · Comodín Trimestral (0% Interés)`}
                                {isGra && `⏳ Día ${cp.dias_transcurridos}/${cp.dias_tope_sin_comodin} · +3d Gracia Natural (0% · Sin comodín)`}
                                {!isSalv && !isCor && !isGra && `🟢 Día ${cp.dias_transcurridos}/${cp.dias_estandar} · Compromiso Habitual (0% Interés)`}
                              </span>
                            </div>
                            <div className="cc-fechas-hitos-grid">
                              <div className="cc-hito-pill">
                                <span style={{ color: '#94a3b8', fontSize: '0.65rem' }}>📦 Entrega (Día 1)</span>
                                <strong style={{ color: '#f8fafc' }}>{cp.fecha_entrega_fmt}</strong>
                              </div>
                              <div className="cc-hito-pill">
                                <span style={{ color: '#34d399', fontSize: '0.65rem' }}>🟢 Compromiso (7d)</span>
                                <strong style={{ color: '#f8fafc' }}>{cp.fecha_vto_compromiso_fmt}</strong>
                              </div>
                              <div className="cc-hito-pill">
                                <span style={{ color: '#2dd4bf', fontSize: '0.65rem' }}>⏳ +3d Gracia (10d)</span>
                                <strong style={{ color: '#f8fafc' }}>{cp.fecha_vto_gracia_natural_fmt}</strong>
                              </div>
                              <div className="cc-hito-pill">
                                <span style={{ color: '#38bdf8', fontSize: '0.65rem' }}>🎟️ Tope Comodín (14d)</span>
                                <strong style={{ color: '#f8fafc' }}>{cp.fecha_vto_comodin_fmt}</strong>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Registro transparente de Comodines Trimestrales usados en el año */}
                {comodinesHistorial.length > 0 && (
                  <div style={{
                    marginTop: '0.7rem',
                    paddingTop: '0.65rem',
                    borderTop: '1px dashed rgba(255, 255, 255, 0.1)',
                    fontSize: '0.73rem',
                    color: '#cbd5e1',
                    lineHeight: 1.4
                  }}>
                    <strong style={{ color: '#38bdf8' }}>🎟️ Registro de Comodín Trimestral en tu cuenta ({resumenFinanciacion.cortesias_usadas_anio} usado / {resumenFinanciacion.cortesias_restantes_anio} disponibles en el año):</strong>{' '}
                    {comodinesHistorial.map((ch, idx) => (
                      <span key={ch.mov_id || idx}>
                        {idx > 0 ? ' · ' : ''}
                        <strong>{ch.descripcion}</strong> (entregada el {formatDateAR(ch.punto_cero, 0)} y cancelada el {formatDateAR(ch.fecha_cancelacion, 0)} al <strong>Día {ch.dias_hasta_cancelacion}</strong> — bonificada al 100% con comodín trimestral).
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {movements.length === 0 ? (
            <div className="table-wrapper" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>No hay movimientos registrados.</p>
            </div>
          ) : (
            <>
              {/* Vista Desktop (Tabla) */}
              <div className="table-wrapper desktop-only">
                <table className="cc-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Comprobante</th>
                      <th style={{ textAlign: 'right' }}>Debe</th>
                      <th style={{ textAlign: 'right' }}>Haber</th>
                      <th style={{ textAlign: 'right' }}>Saldo</th>
                      <th style={{ textAlign: 'center' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((mov, index) => (
                      <tr key={mov.id || index}>
                        <td>{new Date(mov.fecha).toLocaleDateString()}</td>
                        <td>
                          <span className={`doc-badge ${mov.tipo_comprobante.toLowerCase()}`}>
                            {mov.tipo_comprobante === 'CH' ? 'HORAS' : mov.tipo_comprobante === 'CR' ? 'REND' : mov.tipo_comprobante}
                          </span>
                        </td>
                        <td>
                          <div>{mov.numero_comprobante}</div>
                          {(() => {
                            const movKey = String(mov.id || mov.local_movimiento_id);
                            const cp = capasAbiertasMap[movKey];
                            if (cp) {
                              const isEst = cp.estado_capa === 'VENTANA_ESTANDAR';
                              const isGra = cp.estado_capa === 'GRACIA_NATURAL';
                              const isCor = cp.estado_capa === 'VENTANA_CORTESIA';
                              return (
                                <div style={{
                                  fontSize: '0.68rem',
                                  marginTop: '3px',
                                  fontWeight: 600,
                                  lineHeight: 1.35,
                                  color: isEst ? '#34d399' : isGra ? '#2dd4bf' : isCor ? '#38bdf8' : '#fbbf24'
                                }}>
                                  <div>
                                    {isEst && `🟢 Día ${cp.dias_transcurridos}/${cp.dias_estandar} (Compromiso) · 0% Interés`}
                                    {isGra && `⏳ Día ${cp.dias_transcurridos}/${cp.dias_tope_sin_comodin} (+3d Gracia Natural · Sin usar comodín) · 0% Interés`}
                                    {isCor && `🎟️ Día ${cp.dias_transcurridos}/${cp.dias_limite_cortesia} (Comodín Trimestral) · 0% Interés`}
                                    {!isEst && !isGra && !isCor && `🛡️ SALVAVIDAS ACTIVO (Día ${cp.dias_transcurridos}) · +${formatCurrency(cp.interes_devengado_capa)} + IVA ${formatCurrency(cp.iva_financiacion_capa)} = ${formatCurrency(cp.interes_con_iva_capa)}`}
                                  </div>
                                  <div style={{ color: '#94a3b8', fontWeight: 500, fontSize: '0.65rem' }}>
                                    Entrega: {cp.fecha_entrega_fmt} · 7d: {cp.fecha_vto_compromiso_fmt} · +3d Gracia: {cp.fecha_vto_gracia_natural_fmt} · Tope 14d: {cp.fecha_vto_comodin_fmt}
                                  </div>
                                </div>
                              );
                            }
                            const canc = comprobantesCanceladosMap[movKey];
                            if (canc) {
                              const esComodin = canc.tramo_cancelacion === 'COMODIN_USADO';
                              const esGracia = canc.tramo_cancelacion === 'GRACIA_NATURAL';
                              return (
                                <div style={{
                                  fontSize: '0.66rem',
                                  marginTop: '2px',
                                  fontWeight: 600,
                                  color: esComodin ? '#38bdf8' : esGracia ? '#2dd4bf' : '#64748b'
                                }}>
                                  {esComodin && `🎟️ Cancelada al Día ${canc.dias_hasta_cancelacion} (${canc.fecha_cancelacion_fmt}) · Usó 1° Comodín Trimestral (0% interés)`}
                                  {esGracia && `⏳ Cancelada al Día ${canc.dias_hasta_cancelacion} (${canc.fecha_cancelacion_fmt}) · Dentro de +3d Gracia Natural (Sin usar comodín · 0%)`}
                                  {!esComodin && !esGracia && `🟢 Cancelada al Día ${canc.dias_hasta_cancelacion} (${canc.fecha_cancelacion_fmt}) · En plazo habitual (0%)`}
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </td>
                        <td style={{ textAlign: 'right', color: parseFloat(mov.debe) > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {parseFloat(mov.debe) > 0 ? formatCurrency(mov.debe) : '-'}
                        </td>
                        <td style={{ textAlign: 'right', color: parseFloat(mov.haber) > 0 ? 'hsl(142, 76%, 45%)' : 'var(--text-muted)' }}>
                          {parseFloat(mov.haber) > 0 ? formatCurrency(mov.haber) : '-'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: '500' }}>
                          {formatCurrency(mov.saldo)}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {['FC', 'NC', 'ND', 'RC', 'CH', 'CR'].includes(mov.tipo_comprobante) ? (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                              <button 
                                className="btn-action-icon"
                                onClick={() => showDocumentModal(mov)}
                                title="Ver Detalle"
                                style={{ color: mov.tipo_comprobante === 'CH' ? '#7e22ce' : mov.tipo_comprobante === 'CR' ? '#047857' : '#8e4785' }}
                              >
                                <Eye size={16} />
                              </button>
                              {['FC', 'NC', 'ND', 'RC'].includes(mov.tipo_comprobante) && (
                                <button 
                                  className="btn-action-icon"
                                  onClick={() => handleDownload(mov)}
                                  title="Descargar Comprobante PDF"
                                >
                                  <Download size={16} />
                                </button>
                              )}
                            </div>
                          ) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Vista Mobile (Tarjetas) */}
              <div className="mobile-only CC-cards-container">
                {movements.map((mov, index) => {
                  const debeVal = parseFloat(mov.debe) || 0;
                  const haberVal = parseFloat(mov.haber) || 0;
                  const isDebe = debeVal > 0;
                  const monto = isDebe ? debeVal : haberVal;

                  return (
                    <div className="cc-mov-card" key={mov.id || index}>
                      <div className="cc-card-header">
                        <span className="cc-card-date">{new Date(mov.fecha).toLocaleDateString()}</span>
                        <span className={`doc-badge ${mov.tipo_comprobante.toLowerCase()}`}>
                          {mov.tipo_comprobante === 'CH' ? 'HORAS' : mov.tipo_comprobante === 'CR' ? 'REND' : mov.tipo_comprobante}
                        </span>
                      </div>
                      <div className="cc-card-body">
                        <div className="cc-card-row">
                          <span className="cc-card-label">Comprobante:</span>
                          <strong className="cc-card-value">{mov.numero_comprobante}</strong>
                        </div>
                        <div className="cc-card-row">
                          <span className="cc-card-label">Monto:</span>
                          <strong className="cc-card-value" style={{ color: isDebe ? 'var(--danger)' : 'hsl(142, 76%, 45%)' }}>
                            {isDebe ? '+' : '-'} {formatCurrency(monto)}
                          </strong>
                        </div>
                        <div className="cc-card-row">
                          <span className="cc-card-label">Saldo:</span>
                          <strong className="cc-card-value">{formatCurrency(mov.saldo)}</strong>
                        </div>
                        {(() => {
                          const movKey = String(mov.id || mov.local_movimiento_id);
                          const cp = capasAbiertasMap[movKey];
                          if (cp) {
                            const isEst = cp.estado_capa === 'VENTANA_ESTANDAR';
                            const isGra = cp.estado_capa === 'GRACIA_NATURAL';
                            const isCor = cp.estado_capa === 'VENTANA_CORTESIA';
                            return (
                              <div style={{
                                marginTop: '6px',
                                padding: '7px 9px',
                                borderRadius: '8px',
                                fontSize: '0.71rem',
                                fontWeight: 600,
                                lineHeight: 1.35,
                                background: isEst ? 'rgba(16, 185, 129, 0.12)' : isGra ? 'rgba(20, 184, 166, 0.12)' : isCor ? 'rgba(56, 189, 248, 0.12)' : 'rgba(245, 158, 11, 0.14)',
                                border: isEst ? '1px solid rgba(16, 185, 129, 0.25)' : isGra ? '1px solid rgba(20, 184, 166, 0.25)' : isCor ? '1px solid rgba(56, 189, 248, 0.25)' : '1px solid rgba(245, 158, 11, 0.3)',
                                color: isEst ? '#34d399' : isGra ? '#2dd4bf' : isCor ? '#38bdf8' : '#fbbf24'
                              }}>
                                <div style={{ marginBottom: '4px' }}>
                                  {isEst && `🟢 Día ${cp.dias_transcurridos}/${cp.dias_estandar} (Compromiso) · 0% Interés`}
                                  {isGra && `⏳ Día ${cp.dias_transcurridos}/${cp.dias_tope_sin_comodin} (+3d Gracia Natural · Sin comodín) · 0%`}
                                  {isCor && `🎟️ Día ${cp.dias_transcurridos}/${cp.dias_limite_cortesia} (Comodín Trimestral) · 0%`}
                                  {!isEst && !isGra && !isCor && `🛡️ SALVAVIDAS ACTIVO (Día ${cp.dias_transcurridos}) · +${formatCurrency(cp.interes_devengado_capa)} + IVA ${formatCurrency(cp.iva_financiacion_capa)} = ${formatCurrency(cp.interes_con_iva_capa)}`}
                                </div>
                                <div className="cc-fechas-hitos-grid">
                                  <div className="cc-hito-pill">
                                    <span style={{ color: '#94a3b8', fontSize: '0.62rem' }}>📦 Entrega</span>
                                    <strong style={{ color: '#f8fafc', fontSize: '0.68rem' }}>{cp.fecha_entrega_fmt}</strong>
                                  </div>
                                  <div className="cc-hito-pill">
                                    <span style={{ color: '#34d399', fontSize: '0.62rem' }}>🟢 7d Compromiso</span>
                                    <strong style={{ color: '#f8fafc', fontSize: '0.68rem' }}>{cp.fecha_vto_compromiso_fmt}</strong>
                                  </div>
                                  <div className="cc-hito-pill">
                                    <span style={{ color: '#2dd4bf', fontSize: '0.62rem' }}>⏳ +3d Gracia (10d)</span>
                                    <strong style={{ color: '#f8fafc', fontSize: '0.68rem' }}>{cp.fecha_vto_gracia_natural_fmt}</strong>
                                  </div>
                                  <div className="cc-hito-pill">
                                    <span style={{ color: '#38bdf8', fontSize: '0.62rem' }}>🎟️ Tope 14d Comodín</span>
                                    <strong style={{ color: '#f8fafc', fontSize: '0.68rem' }}>{cp.fecha_vto_comodin_fmt}</strong>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          const canc = comprobantesCanceladosMap[movKey];
                          if (canc) {
                            const esComodin = canc.tramo_cancelacion === 'COMODIN_USADO';
                            const esGracia = canc.tramo_cancelacion === 'GRACIA_NATURAL';
                            return (
                              <div style={{
                                marginTop: '6px',
                                padding: '5px 8px',
                                borderRadius: '6px',
                                fontSize: '0.68rem',
                                fontWeight: 600,
                                background: esComodin ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255, 255, 255, 0.04)',
                                color: esComodin ? '#38bdf8' : esGracia ? '#2dd4bf' : '#94a3b8'
                              }}>
                                {esComodin && `🎟️ Cancelada al Día ${canc.dias_hasta_cancelacion} (${canc.fecha_cancelacion_fmt}) · Usó 1° Comodín Trimestral (0%)`}
                                {esGracia && `⏳ Cancelada al Día ${canc.dias_hasta_cancelacion} (${canc.fecha_cancelacion_fmt}) · +3d Gracia Natural (Sin comodín · 0%)`}
                                {!esComodin && !esGracia && `🟢 Cancelada al Día ${canc.dias_hasta_cancelacion} (${canc.fecha_cancelacion_fmt}) · En plazo habitual (0%)`}
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      {['FC', 'NC', 'ND', 'RC', 'CH', 'CR'].includes(mov.tipo_comprobante) && (
                        <div className="cc-card-actions">
                          <button 
                            className="btn-card-action detail-btn"
                            onClick={() => showDocumentModal(mov)}
                            style={mov.tipo_comprobante === 'CH' ? { background: '#7e22ce', borderColor: '#7e22ce' } : mov.tipo_comprobante === 'CR' ? { background: '#047857', borderColor: '#047857' } : {}}
                          >
                            <Eye size={14} /> Ver Detalle
                          </button>
                          {['FC', 'NC', 'ND', 'RC'].includes(mov.tipo_comprobante) && (
                            <button 
                              className="btn-card-action download-btn"
                              onClick={() => handleDownload(mov)}
                            >
                              <Download size={14} /> Descargar
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
