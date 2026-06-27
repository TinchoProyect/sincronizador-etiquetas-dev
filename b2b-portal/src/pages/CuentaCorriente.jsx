import React, { useState, useEffect } from 'react';
import { Download, Loader2, AlertCircle, DollarSign, Eye } from 'lucide-react';
import { supabase } from '../supabaseClient';
import Swal from 'sweetalert2';

export default function CuentaCorriente({ profile, highlightDocId, onClearHighlight }) {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMovements();
  }, [profile]);

  const fetchMovements = async () => {
    setLoading(true);
    setError(null);
    try {
      // Supabase aplicará RLS automáticamente filtrando por el cliente_id
      const { data, error: fetchError } = await supabase
        .from('clientes_b2b_cuentas_corrientes')
        .select('*')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setMovements(data || []);
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

  const showDocumentModal = (mov) => {
    const isDebe = parseFloat(mov.debe) > 0;
    const montoDisplay = isDebe ? formatCurrency(mov.debe) : formatCurrency(mov.haber);
    const tipoLabel = mov.tipo_comprobante === 'FC' ? 'Factura' : 
                      mov.tipo_comprobante === 'NC' ? 'Nota de Crédito' : 
                      mov.tipo_comprobante === 'RC' ? 'Recibo' : 
                      mov.tipo_comprobante === 'ND' ? 'Nota de Débito' : 
                      mov.tipo_comprobante === 'AP' ? 'Ajuste de Apertura' : 'Documento';

    let metadataHtml = '';
    if (mov.tipo_comprobante === 'RC' && mov.metadatos) {
      const tipoPago = mov.metadatos.tipo_pago || 'Transferencia';
      const banco = mov.metadatos.banco_origen ? `<div style="margin-top: 0.35rem;"><span style="color: #64748b; font-weight: 600;">Banco de Origen:</span> ${mov.metadatos.banco_origen}</div>` : '';
      const operacion = mov.metadatos.nro_operacion ? `<div style="margin-top: 0.35rem;"><span style="color: #64748b; font-weight: 600;">Operación:</span> #${mov.metadatos.nro_operacion}</div>` : '';
      metadataHtml = `
        <div style="background: #f8fafc; border-radius: 6px; padding: 0.65rem 0.85rem; font-size: 0.8rem; color: #475569; border: 1px solid #e2e8f0; margin-bottom: 1.25rem;">
          <div style="font-weight: 700; color: #8e4785; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem;">Información del Pago</div>
          <div><span style="color: #64748b; font-weight: 600;">Método:</span> ${tipoPago}</div>
          ${banco}
          ${operacion}
        </div>
      `;
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
              <span style="font-size: 1.1rem; font-weight: 700; color: #1e293b">${formatCurrency(mov.saldo)}</span>
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

  // El saldo consolidado es el saldo del movimiento más reciente
  const saldoConsolidado = movements.length > 0 ? parseFloat(movements[0].saldo) : 0;
  
  // Total facturado (compras)
  const totalFacturado = movements.reduce((acc, mov) => {
    if (mov.tipo_comprobante === 'FC' || mov.tipo_comprobante === 'ND') {
      return acc + parseFloat(mov.debe);
    }
    return acc;
  }, 0);

  // Total pagado (pagos)
  const totalPagado = movements.reduce((acc, mov) => {
    if (mov.tipo_comprobante === 'RC' || mov.tipo_comprobante === 'NC') {
      return acc + parseFloat(mov.haber);
    }
    return acc;
  }, 0);

  const handleDownload = (mov) => {
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
          <div className="dashboard-cards single-card">
            <div className="stat-card">
              <span className="stat-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <DollarSign size={16} style={{ color: 'var(--accent)' }} /> Saldo Consolidado
              </span>
              <span className={`stat-value ${saldoConsolidado > 0 ? 'negative' : 'positive'}`}>
                {formatCurrency(saldoConsolidado)}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {saldoConsolidado > 0 ? 'Pendiente de pago' : 'Cuenta al día'}
              </span>
            </div>
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
                            {mov.tipo_comprobante}
                          </span>
                        </td>
                        <td>{mov.numero_comprobante}</td>
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
                          {(mov.tipo_comprobante === 'FC' || mov.tipo_comprobante === 'NC' || mov.tipo_comprobante === 'ND' || mov.tipo_comprobante === 'RC') ? (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                              <button 
                                className="btn-action-icon"
                                onClick={() => showDocumentModal(mov)}
                                title="Ver Detalle"
                                style={{ color: '#8e4785' }}
                              >
                                <Eye size={16} />
                              </button>
                              <button 
                                className="btn-action-icon"
                                onClick={() => handleDownload(mov)}
                                title="Descargar Comprobante PDF"
                              >
                                <Download size={16} />
                              </button>
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
                          {mov.tipo_comprobante}
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
                      </div>
                      {(mov.tipo_comprobante === 'FC' || mov.tipo_comprobante === 'NC' || mov.tipo_comprobante === 'ND' || mov.tipo_comprobante === 'RC') && (
                        <div className="cc-card-actions">
                          <button 
                            className="btn-card-action detail-btn"
                            onClick={() => showDocumentModal(mov)}
                          >
                            <Eye size={14} /> Ver Detalle
                          </button>
                          <button 
                            className="btn-card-action download-btn"
                            onClick={() => handleDownload(mov)}
                          >
                            <Download size={14} /> Descargar
                          </button>
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
