// filepath: b2b-portal/src/components/InfoComercialModal.jsx
import React, { useState, useEffect } from 'react';
import { 
  X, 
  Flame, 
  CreditCard, 
  ShieldCheck, 
  Tag, 
  Copy, 
  Check, 
  Calendar, 
  AlertCircle, 
  CheckCircle2, 
  ArrowRight, 
  Clock, 
  Building2, 
  Banknote,
  Receipt,
  Info
} from 'lucide-react';

export default function InfoComercialModal({ 
  isOpen, 
  onClose, 
  data, 
  initialTab = 'promos',
  profile,
  onNavigateToTab 
}) {
  const promos = data?.promos || [];
  const politica = data?.politica_comercial || null;
  const formasPago = data?.formas_pago || {};
  const intereses = data?.politica_intereses || {};
  const hasPromosOrPolitica = (promos && promos.length > 0) || !!politica;

  const [activeTab, setActiveTab] = useState(() => {
    if (!hasPromosOrPolitica && initialTab === 'promos') return 'pagos';
    return initialTab;
  });
  const [copiedKey, setCopiedKey] = useState(null);

  useEffect(() => {
    if (!hasPromosOrPolitica && initialTab === 'promos') {
      setActiveTab('pagos');
    } else {
      setActiveTab(initialTab);
    }
  }, [initialTab, hasPromosOrPolitica]);

  if (!isOpen) return null;

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const primerTramo = politica?.tramos?.[0];
  const montoMinimoVolumen = primerTramo ? parseFloat(primerTramo.monto_minimo) : 300000;
  const pctDescVolumen = primerTramo ? parseFloat(primerTramo.descuento_porcentaje) : 5;
  const montoMinFmt = montoMinimoVolumen.toLocaleString('es-AR');

  const saldoCC = typeof politica?.saldo_cuenta_corriente === 'number' 
    ? politica.saldo_cuenta_corriente 
    : (parseFloat(profile?.saldo || 0) || 0);

  const tolerancia = parseFloat(politica?.tolerancia_saldo) || 500.00;
  const exigeSaldoCero = politica?.exige_saldo_cero !== false;
  const retenidoPorSaldo = exigeSaldoCero && (saldoCC > tolerancia);
  const saldoFmt = Math.abs(saldoCC).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tolFmt = tolerancia.toLocaleString('es-AR');

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.78)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      padding: '0.75rem',
      animation: 'fadeIn 0.25s ease-out'
    }}>
      <div style={{
        background: '#0f172a',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '20px',
        width: '100%',
        maxWidth: '560px',
        maxHeight: '92vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.65)',
        overflow: 'hidden',
        color: '#f8fafc'
      }}>
        
        {/* Cabecera del Modal */}
        <div style={{
          padding: '1.15rem 1.25rem 0.85rem 1.25rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.2) 100%)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#a855f7', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                Condiciones Oficiales LAMDA
              </span>
              <span style={{ fontSize: '0.65rem', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                Lista de Precios
              </span>
            </div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: '#f8fafc', letterSpacing: '-0.01em' }}>
              Condiciones y Beneficios
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
              {profile?.nombre_empresa || profile?.nombre_completo || 'Cliente B2B'}
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: 'none',
              borderRadius: '999px',
              padding: '0.45rem',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; e.currentTarget.style.color = '#fff'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; e.currentTarget.style.color = '#94a3b8'; }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Barra de Pestañas (Selector) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: hasPromosOrPolitica ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
          padding: '0.4rem 0.75rem',
          background: 'rgba(15, 23, 42, 0.95)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          gap: '0.35rem'
        }}>
          {/* Tab 1: Promos (Solo si el cliente tiene promociones o bonificación por volumen) */}
          {hasPromosOrPolitica && (
            <button
              onClick={() => setActiveTab('promos')}
              style={{
                background: activeTab === 'promos' ? 'rgba(245, 158, 11, 0.16)' : 'transparent',
                border: activeTab === 'promos' ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid transparent',
                borderRadius: '10px',
                padding: '0.55rem 0.25rem',
                color: activeTab === 'promos' ? '#fbbf24' : '#94a3b8',
                fontWeight: activeTab === 'promos' ? 700 : 500,
                fontSize: '0.78rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
                transition: 'all 0.2s'
              }}
            >
              <Flame size={15} style={{ color: activeTab === 'promos' ? '#f59e0b' : '#64748b' }} />
              <span>Promos</span>
              {promos.length > 0 && (
                <span style={{
                  background: '#f59e0b',
                  color: '#0f172a',
                  fontSize: '0.62rem',
                  fontWeight: 900,
                  padding: '1px 5px',
                  borderRadius: '999px'
                }}>
                  {promos.length}
                </span>
              )}
            </button>
          )}

          {/* Tab 2: Formas de Pago */}
          <button
            onClick={() => setActiveTab('pagos')}
            style={{
              background: activeTab === 'pagos' ? 'rgba(59, 130, 246, 0.16)' : 'transparent',
              border: activeTab === 'pagos' ? '1px solid rgba(59, 130, 246, 0.45)' : '1px solid transparent',
              borderRadius: '10px',
              padding: '0.55rem 0.25rem',
              color: activeTab === 'pagos' ? '#60a5fa' : '#94a3b8',
              fontWeight: activeTab === 'pagos' ? 700 : 500,
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
              transition: 'all 0.2s'
            }}
          >
            <CreditCard size={15} style={{ color: activeTab === 'pagos' ? '#3b82f6' : '#64748b' }} />
            <span>Formas de Pago</span>
          </button>

          {/* Tab 3: Asistencia Financiera */}
          <button
            onClick={() => setActiveTab('intereses')}
            style={{
              background: activeTab === 'intereses' ? 'rgba(168, 85, 247, 0.16)' : 'transparent',
              border: activeTab === 'intereses' ? '1px solid rgba(168, 85, 247, 0.45)' : '1px solid transparent',
              borderRadius: '10px',
              padding: '0.55rem 0.25rem',
              color: activeTab === 'intereses' ? '#c084fc' : '#94a3b8',
              fontWeight: activeTab === 'intereses' ? 700 : 500,
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
              transition: 'all 0.2s'
            }}
          >
            <ShieldCheck size={15} style={{ color: activeTab === 'intereses' ? '#a855f7' : '#64748b' }} />
            <span>Asistencia</span>
          </button>
        </div>

        {/* Contenedor con Scroll para el contenido */}
        <div style={{
          padding: '1rem',
          overflowY: 'auto',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>

          {/* ======================================================== */}
          {/* PESTAÑA 1: OFERTAS Y PROMOCIONES ACTIVAS                 */}
          {/* ======================================================== */}
          {activeTab === 'promos' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              
              {/* 1. Tarjeta Destacada: Bonificación por Volumen ($300k) - SOLO SI POSEE POLÍTICA COMERCIAL */}
              {politica && (
                <div style={{
                  background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.12) 0%, rgba(30, 27, 75, 0.25) 100%)',
                  border: '1px solid rgba(139, 92, 246, 0.35)',
                  borderRadius: '14px',
                  padding: '0.95rem 1rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <div style={{ background: 'rgba(139, 92, 246, 0.25)', padding: '5px', borderRadius: '8px', color: '#c084fc' }}>
                        <Tag size={16} />
                      </div>
                      <div>
                        <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#f8fafc', display: 'block' }}>
                          Bonificación Comercial por Volumen
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>
                          Superando ${montoMinFmt} netos de compra
                        </span>
                      </div>
                    </div>
                    <span style={{
                      background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                      color: '#fff',
                      padding: '3px 8px',
                      borderRadius: '8px',
                      fontSize: '0.76rem',
                      fontWeight: 900,
                      letterSpacing: '0.4px',
                      boxShadow: '0 2px 8px rgba(139, 92, 246, 0.35)'
                    }}>
                      {pctDescVolumen}% OFF
                    </span>
                  </div>

                  <p style={{ fontSize: '0.75rem', color: '#cbd5e1', lineHeight: '1.4', margin: '0 0 0.65rem 0' }}>
                    Aplica un <strong>{pctDescVolumen}% de descuento directo</strong> sobre artículos a precio estándar al superar ${montoMinFmt} netos en su pedido.
                  </p>

                  {/* Estado en Tiempo Real de la Cuenta Corriente para este beneficio */}
                  {retenidoPorSaldo ? (
                    <div style={{
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      borderRadius: '10px',
                      padding: '0.65rem 0.8rem'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertCircle size={14} /> Beneficio retenido por saldo pendiente
                        </span>
                        <span style={{ fontSize: '0.65rem', background: 'rgba(239, 68, 68, 0.25)', color: '#fca5a5', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                          RETENIDO
                        </span>
                      </div>
                      <p style={{ fontSize: '0.72rem', color: '#fecaca', lineHeight: '1.35', margin: 0 }}>
                        Su cuenta corriente registra un saldo pendiente de <strong>${saldoFmt}</strong> (Tolerancia: ${tolFmt}). 
                        Para activar el {pctDescVolumen}% de bonificación en compras mayores a ${montoMinFmt}, regularice su saldo pendiente.
                      </p>
                      {onNavigateToTab && (
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.55rem' }}>
                          <button
                            onClick={() => { onClose(); onNavigateToTab('cc'); }}
                            style={{
                              background: 'rgba(255, 255, 255, 0.1)',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              borderRadius: '6px',
                              color: '#fff',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              padding: '3px 8px',
                              cursor: 'pointer'
                            }}
                          >
                            Ver Cuenta Corriente ➔
                          </button>
                          <button
                            onClick={() => { onClose(); onNavigateToTab('pagos_efectivo'); }}
                            style={{
                              background: 'rgba(142, 71, 133, 0.3)',
                              border: '1px solid rgba(142, 71, 133, 0.6)',
                              borderRadius: '6px',
                              color: '#f0abfc',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              padding: '3px 8px',
                              cursor: 'pointer'
                            }}
                          >
                            Informar Pago Efectivo ➔
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{
                      background: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      borderRadius: '10px',
                      padding: '0.55rem 0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem'
                    }}>
                      <CheckCircle2 size={15} style={{ color: '#34d399', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.73rem', color: '#a7f3d0', lineHeight: '1.3' }}>
                        <strong>Cuenta al día:</strong> Al superar los ${montoMinFmt} netos en su borrador de pedido, el beneficio del {pctDescVolumen}% se aplicará de forma automática.
                      </span>
                    </div>
                  )}

                  {/* Letra Chica Comercial */}
                  <div style={{ marginTop: '0.5rem', fontSize: '0.68rem', color: '#94a3b8', lineHeight: '1.3' }}>
                    • <strong>No acumulable:</strong> No duplica descuento sobre artículos que ya posean oferta de precio especial activa.
                  </div>
                </div>
              )}

              {/* 2. Promociones Dinámicas de Artículos Asignados */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Flame size={14} /> Oportunidades en Artículos Vigentes
                  </span>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                    {promos.length} oferta{promos.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {promos.length === 0 ? (
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px dashed rgba(255, 255, 255, 0.1)',
                    borderRadius: '12px',
                    padding: '1.25rem 1rem',
                    textAlign: 'center',
                    color: '#94a3b8'
                  }}>
                    <p style={{ fontSize: '0.8rem', margin: 0 }}>
                      No se registran ofertas puntuales de artículos para su lista de precios en este momento.
                    </p>
                    {politica && (
                      <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0.35rem 0 0 0' }}>
                        Las compras estándar aplican con el beneficio de volumen al superar los ${montoMinFmt}.
                      </p>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    {promos.map(p => {
                      const descFmt = p.tipo_beneficio === 'PORCENTAJE'
                        ? `${parseFloat(p.descuento_porcentaje)}% OFF`
                        : (p.precio_fijo_oferta ? `$${parseFloat(p.precio_fijo_oferta).toLocaleString('es-AR')} Fijo` : 'Oferta');

                      let fechaFmt = '';
                      if (p.fecha_fin) {
                        try {
                          const f = new Date(p.fecha_fin);
                          fechaFmt = `${String(f.getUTCDate()).padStart(2, '0')}/${String(f.getUTCMonth() + 1).padStart(2, '0')}/${f.getUTCFullYear()}`;
                        } catch (e) {}
                      }

                      return (
                        <div key={p.id} style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          borderRadius: '12px',
                          padding: '0.85rem 0.95rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.45rem'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: '#fbbf24', textTransform: 'uppercase', display: 'block' }}>
                                {p.titulo}
                              </strong>
                              {p.descripcion && (
                                <p style={{ fontSize: '0.74rem', color: '#cbd5e1', margin: '2px 0 0 0', lineHeight: '1.3' }}>
                                  {p.descripcion}
                                </p>
                              )}
                            </div>
                            <span style={{
                              background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                              color: '#fff',
                              padding: '2px 7px',
                              borderRadius: '6px',
                              fontSize: '0.72rem',
                              fontWeight: 900,
                              whiteSpace: 'nowrap'
                            }}>
                              {descFmt}
                            </span>
                          </div>

                          {/* Artículos Participantes */}
                          {Array.isArray(p.articulos) && p.articulos.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.2rem' }}>
                              {p.articulos.map(art => (
                                <span key={art.articulo_numero} style={{
                                  background: 'rgba(255, 255, 255, 0.06)',
                                  border: '1px solid rgba(255, 255, 255, 0.12)',
                                  padding: '2px 7px',
                                  borderRadius: '6px',
                                  fontSize: '0.68rem',
                                  fontWeight: 600,
                                  color: '#e2e8f0'
                                }}>
                                  🏷️ {art.descripcion || art.articulo_numero}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Cuota y Vigencia */}
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '0.68rem',
                            color: '#94a3b8',
                            borderTop: '1px dashed rgba(255, 255, 255, 0.08)',
                            paddingTop: '0.4rem',
                            marginTop: '0.2rem'
                          }}>
                            <span>
                              ⏳ Cuota disponible: <strong style={{ color: '#fbbf24' }}>{p.cuota_disponible} {p.unidad_cuota || 'unidades'}</strong>
                            </span>
                            <span>
                              {fechaFmt ? `📅 Hasta: ${fechaFmt}` : 'Hasta agotar stock'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* PESTAÑA 2: FORMAS DE PAGO HABILITADAS                    */}
          {/* ======================================================== */}
          {activeTab === 'pagos' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              
              {/* Bloque 1: Transferencia Bancaria */}
              <div style={{
                background: 'rgba(37, 99, 235, 0.08)',
                border: '1px solid rgba(37, 99, 235, 0.3)',
                borderRadius: '14px',
                padding: '0.95rem 1rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Building2 size={16} /> Transferencia Bancaria
                  </span>
                  <span style={{ fontSize: '0.68rem', background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                    Inmediata
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(15, 23, 42, 0.6)', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Banco: <strong>Banco Galicia</strong></span>
                    <span style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>ALIAS: <strong style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: '0.92rem' }}>LAMDA.SER.MARTIN</strong></span>
                  </div>
                  <button
                    onClick={() => handleCopy('LAMDA.SER.MARTIN', 'alias')}
                    style={{
                      background: copiedKey === 'alias' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                      border: copiedKey === 'alias' ? '1px solid #22c55e' : '1px solid rgba(59, 130, 246, 0.5)',
                      borderRadius: '8px',
                      color: copiedKey === 'alias' ? '#4ade80' : '#93c5fd',
                      padding: '0.35rem 0.65rem',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}
                  >
                    {copiedKey === 'alias' ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedKey === 'alias' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
              </div>

              {/* Bloque 2: Pagos en Efectivo - Ensobrado LAMDA */}
              <div style={{
                background: 'rgba(142, 71, 133, 0.1)',
                border: '1px solid rgba(142, 71, 133, 0.35)',
                borderRadius: '14px',
                padding: '0.95rem 1rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#f0abfc', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Banknote size={16} /> Ensobrado (Servicio LAMDA)
                  </span>
                  <span style={{ fontSize: '0.68rem', background: 'rgba(142, 71, 133, 0.25)', color: '#f0abfc', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                    Asistido
                  </span>
                </div>

                <p style={{ fontSize: '0.74rem', color: '#cbd5e1', lineHeight: '1.35', margin: '0 0 0.55rem 0' }}>
                  Anotás el monto y el sistema acompaña el conteo de billetes, genera el número de sobre (<strong>ej: SOB-XXXX</strong>), cargás las fotos del sobre cerrado y emite confirmación automática.
                </p>

                {onNavigateToTab && (
                  <button
                    onClick={() => { onClose(); onNavigateToTab('pagos_efectivo'); }}
                    style={{
                      width: '100%',
                      background: 'rgba(142, 71, 133, 0.25)',
                      border: '1px solid rgba(142, 71, 133, 0.5)',
                      borderRadius: '8px',
                      color: '#f0abfc',
                      padding: '0.5rem',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem',
                      transition: 'all 0.2s'
                    }}
                  >
                    <span>Cargar Aviso de Ensobrado</span>
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>

              {/* Bloque 3: Cajeros y Terminales Autoservicio Galicia */}
              <div style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '14px',
                padding: '0.95rem 1rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Building2 size={16} /> Cajeros y Terminales Galicia
                  </span>
                  <span style={{ fontSize: '0.68rem', background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                    🕒 24 hs
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(15, 23, 42, 0.6)', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)', marginBottom: '0.55rem' }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Caja de Ahorro:</span>
                    <strong style={{ color: '#34d399', fontFamily: 'monospace', fontSize: '0.92rem' }}>4007844-1 373-4</strong>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'block' }}>Titular: Martin Ignacio Serrano</span>
                  </div>
                  <button
                    onClick={() => handleCopy('4007844-1 373-4', 'caja_ahorro')}
                    style={{
                      background: copiedKey === 'caja_ahorro' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                      border: copiedKey === 'caja_ahorro' ? '1px solid #22c55e' : '1px solid rgba(16, 185, 129, 0.5)',
                      borderRadius: '8px',
                      color: copiedKey === 'caja_ahorro' ? '#4ade80' : '#a7f3d0',
                      padding: '0.35rem 0.65rem',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}
                  >
                    {copiedKey === 'caja_ahorro' ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedKey === 'caja_ahorro' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>

                <div style={{ background: 'rgba(15, 23, 42, 0.4)', padding: '0.5rem 0.75rem', borderRadius: '8px', fontSize: '0.7rem', color: '#cbd5e1', lineHeight: '1.4' }}>
                  <strong style={{ color: '#6ee7b7', display: 'block', marginBottom: '2px' }}>Sucursales La Plata:</strong>
                  • <strong>Centro:</strong> Calle 7 N° 875 • Calle 13 N° 665 • Av. 7 N° 59<br />
                  • <strong>Los Hornos:</strong> Av. 44 N° 1724 (esq. 29)<br />
                  • <strong>City Bell / Gonnet:</strong> Plaza Gral. Belgrano N° 57/63
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* PESTAÑA 3: ASISTENCIA FINANCIERA Y SALVAVIDAS LAMDA      */}
          {/* ======================================================== */}
          {activeTab === 'intereses' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{
                background: 'rgba(168, 85, 247, 0.1)',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                borderRadius: '12px',
                padding: '0.8rem 0.95rem'
              }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <ShieldCheck size={15} /> Plazos de Entrega, Gracia Natural, Comodín y Salvavidas
                </span>
                <p style={{ fontSize: '0.74rem', color: '#e2e8f0', margin: '0.3rem 0 0 0', lineHeight: '1.35' }}>
                  Desde la entrega de la mercadería (<strong>Día 1</strong>), LAMDA acompaña tu operatoria con un esquema claro de <strong>4 etapas</strong> para que tengas previsibilidad total sobre tus fechas:
                </p>
              </div>

              {/* Las 4 Etapas + Pagos Parciales */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                
                {/* Etapa 1: Días 1 a 7 */}
                <div style={{
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  borderRadius: '10px',
                  padding: '0.75rem 0.85rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <span style={{ fontWeight: 800, color: '#34d399', fontSize: '0.8rem' }}>
                      🟢 1. Días 1 a {intereses?.dias_ventana_estandar || 7}: Plazo Habitual
                    </span>
                    <span style={{ fontSize: '0.68rem', background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      0% Interés · Sin Comodín
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, color: '#a7f3d0', fontSize: '0.73rem', marginBottom: '2px' }}>Compromiso Habitual del Cliente</div>
                  <p style={{ fontSize: '0.72rem', color: '#cbd5e1', margin: 0, lineHeight: '1.3' }}>
                    Plazo normal de pago desde la entrega de la mercadería. Abonando dentro de los 7 días, el costo financiero es <strong>$0,00 (100% bonificado)</strong>.
                  </p>
                </div>

                {/* Etapa 2: Días 8 a 10 (+3 días de gracia naturales) */}
                <div style={{
                  background: 'rgba(20, 184, 166, 0.08)',
                  border: '1px solid rgba(20, 184, 166, 0.28)',
                  borderRadius: '10px',
                  padding: '0.75rem 0.85rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <span style={{ fontWeight: 800, color: '#2dd4bf', fontSize: '0.8rem' }}>
                      ⏳ 2. Días 8 a {intereses?.dias_tope_sin_comodin || 10}: +3 Días de Gracia Naturales
                    </span>
                    <span style={{ fontSize: '0.68rem', background: 'rgba(20, 184, 166, 0.2)', color: '#5eead4', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      No usa Comodín · 0%
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, color: '#99f6e4', fontSize: '0.73rem', marginBottom: '2px' }}>Tolerancia Bancaria / Fin de Semana (Viernes a Lunes)</div>
                  <p style={{ fontSize: '0.72rem', color: '#cbd5e1', margin: 0, lineHeight: '1.3' }}>
                    Contás siempre con <strong>3 días de gracia naturales adicionales</strong> después del día 7 (por ejemplo, si transferís o depositás un viernes y acredita el lunes) <strong>a 0% de interés y SIN consumir tu comodín trimestral</strong>.
                  </p>
                </div>

                {/* Etapa 3: Días 11 a 14 (Comodín Trimestral) */}
                <div style={{
                  background: 'rgba(2, 132, 199, 0.08)',
                  border: '1px solid rgba(2, 132, 199, 0.25)',
                  borderRadius: '10px',
                  padding: '0.75rem 0.85rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <span style={{ fontWeight: 800, color: '#38bdf8', fontSize: '0.8rem' }}>
                      🎟️ 3. Días 11 a {intereses?.dias_total_cortesia || 14}: Comodín Trimestral
                    </span>
                    <span style={{ fontSize: '0.68rem', background: 'rgba(2, 132, 199, 0.2)', color: '#7dd3fc', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      1 cada 3 meses ({intereses?.cupo_cortesias_anual || 3}/año)
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, color: '#7dd3fc', fontSize: '0.73rem', marginBottom: '2px' }}>Flexibilidad Excepcional sin Interés</div>
                  <p style={{ fontSize: '0.72rem', color: '#cbd5e1', margin: 0, lineHeight: '1.3' }}>
                    Si una vez en el trimestre necesitás extenderte más allá del día 10, podés usar <strong>1 Comodín Trimestral</strong> (1 cada 3 meses / {intereses?.cupo_cortesias_anual || 3} en el año) que cubre hasta el <strong>Día 14 con 0% de interés ($0,00)</strong>.
                  </p>
                </div>

                {/* Etapa 4: Día 15 en adelante (Salvavidas) */}
                <div style={{
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                  borderRadius: '10px',
                  padding: '0.75rem 0.85rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <span style={{ fontWeight: 800, color: '#fbbf24', fontSize: '0.8rem' }}>
                      🛡️ 4. Día {(intereses?.dias_total_cortesia || 14) + 1} en adelante: Salvavidas LAMDA
                    </span>
                    <span style={{ fontSize: '0.68rem', background: 'rgba(245, 158, 11, 0.2)', color: '#fde68a', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      {intereses?.tasa_servicio_financiero || 3}% Mensual + IVA
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, color: '#fde68a', fontSize: '0.73rem', marginBottom: '2px' }}>Servicio de Financiación Activa sobre Saldo Pendiente</div>
                  <p style={{ fontSize: '0.72rem', color: '#cbd5e1', margin: 0, lineHeight: '1.3' }}>
                    Superado el Día 14 (o si ya utilizaste el comodín del trimestre), se activa el <strong>Salvavidas de Financiación ({intereses?.tasa_servicio_financiero || 3}% mensual + IVA = 0,1% diario + IVA)</strong> computado desde el Día 1 de entrega únicamente sobre el saldo pendiente, manteniendo tu <strong>cuenta habilitada</strong>.
                  </p>
                </div>

                {/* Pagos Parciales */}
                <div style={{
                  background: 'rgba(168, 85, 247, 0.08)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  borderRadius: '10px',
                  padding: '0.75rem 0.85rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <span style={{ fontWeight: 800, color: '#c084fc', fontSize: '0.8rem' }}>
                      💸 Pagos Parciales y Reactivación de Beneficios
                    </span>
                    <span style={{ fontSize: '0.68rem', background: 'rgba(168, 85, 247, 0.2)', color: '#e9d5ff', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      Descuento Inmediato
                    </span>
                  </div>
                  <p style={{ fontSize: '0.72rem', color: '#cbd5e1', margin: 0, lineHeight: '1.3' }}>
                    Podés realizar <strong>pagos parciales</strong> en cualquier momento: cada pago achica capital en el acto y reduce el interés diario futuro. Al regresar el saldo a <strong>$0,00 (Cuenta al Día)</strong>, se reactivan automáticamente el <strong>{pctDescVolumen}% OFF por volumen</strong> y las ofertas especiales.
                  </p>
                </div>

              </div>
            </div>
          )}

        </div>

        {/* Pie del Modal */}
        <div style={{
          padding: '0.85rem 1.25rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(15, 23, 42, 0.95)',
          display: 'flex',
          justifyContent: 'flex-end'
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '10px',
              padding: '0.5rem 1.2rem',
              color: '#f8fafc',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Entendido
          </button>
        </div>

      </div>
    </div>
  );
}
