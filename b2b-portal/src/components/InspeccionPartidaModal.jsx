import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Plus, Minus, ZoomIn, ZoomOut, Camera, Info, PackageCheck } from 'lucide-react';
import { supabaseAnonimaPublica, isSupabaseOfflineLab } from '../supabaseClient';

/**
 * Obtiene en vivo el manifiesto de fotografías de partidas activas desde Supabase Storage.
 * No depende del caché de 5 minutos del catálogo para reflejar capturas de depósito al instante.
 */
export async function fetchMapaFotosLotesB2B() {
  try {
    if (isSupabaseOfflineLab) return {};
    const { data } = supabaseAnonimaPublica
      .storage
      .from('b2b_lotes_fotos')
      .getPublicUrl('manifest.json');

    if (!data?.publicUrl) return {};

    const resp = await fetch(`${data.publicUrl}?t=${Date.now()}`, {
      cache: 'no-store'
    });
    if (!resp.ok) return {};

    const json = await resp.json();
    return (json && typeof json.items === 'object' && json.items !== null) ? json.items : {};
  } catch (err) {
    console.warn('[B2B-FOTOS-LOTE] No se pudo consultar manifest de partidas:', err.message);
    return {};
  }
}

/**
 * Visor Sobrio de Inspección Visual de Partida en Depósito (Portal B2B LAMDA).
 * Combina la agilidad de galería tipo Mercado Libre (carrusel táctil, miniaturas, zoom)
 * con una impronta estrictamente técnica, objetiva y servicial para el comerciante B2B.
 */
export function InspeccionPartidaModal({
  isOpen,
  onClose,
  product,
  infoPartida,
  currentQty = 0,
  onChangeQty,
  displayPrecioBulto,
  displayPrecioKilo,
  esModoNeto = false,
  mostrarPrecios = true,
  ofertaActiva = null,
  descOfertaPct = 0,
  formatCurrency
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [touchStartX, setTouchStartX] = useState(null);

  const imagenes = Array.isArray(infoPartida?.imagenes) ? infoPartida.imagenes : [];

  useEffect(() => {
    setActiveIndex(0);
    setZoomed(false);
  }, [product?.producto_codigo, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && imagenes.length > 1) {
        setActiveIndex((prev) => (prev + 1) % imagenes.length);
        setZoomed(false);
      }
      if (e.key === 'ArrowLeft' && imagenes.length > 1) {
        setActiveIndex((prev) => (prev - 1 + imagenes.length) % imagenes.length);
        setZoomed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, imagenes.length, onClose]);

  if (!isOpen || !product || imagenes.length === 0) return null;

  const currentImg = imagenes[activeIndex] || imagenes[0];
  const kilosUnidad = parseFloat(product.kilos_unidad) || 1.0;

  let fechaCapturaStr = null;
  const rawDate = currentImg?.created_at || infoPartida?.updated_at;
  if (rawDate) {
    try {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        fechaCapturaStr = d.toLocaleDateString('es-AR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
      }
    } catch {}
  }

  const handleTouchStart = (e) => {
    if (zoomed) return;
    if (e.touches && e.touches.length === 1) {
      setTouchStartX(e.touches[0].clientX);
    }
  };

  const handleTouchEnd = (e) => {
    if (zoomed || touchStartX === null) return;
    if (e.changedTouches && e.changedTouches.length === 1) {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(deltaX) > 45 && imagenes.length > 1) {
        if (deltaX < 0) {
          setActiveIndex((prev) => (prev + 1) % imagenes.length);
        } else {
          setActiveIndex((prev) => (prev - 1 + imagenes.length) % imagenes.length);
        }
      }
    }
    setTouchStartX(null);
  };

  const fmt = typeof formatCurrency === 'function'
    ? formatCurrency
    : (v) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(2, 6, 23, 0.86)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0.75rem'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '1rem',
          width: '100%',
          maxWidth: '620px',
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.7)',
          color: '#f8fafc'
        }}
      >
        {/* CABECERA TÉCNICA SOBRIA */}
        <div
          style={{
            padding: '0.85rem 1.1rem',
            borderBottom: '1px solid #1e293b',
            backgroundColor: '#090f1d',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '0.75rem'
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                flexWrap: 'wrap',
                marginBottom: '0.3rem'
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.66rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#5eead4',
                  backgroundColor: 'rgba(20, 184, 166, 0.14)',
                  border: '1px solid rgba(20, 184, 166, 0.35)',
                  padding: '2px 7px',
                  borderRadius: '6px'
                }}
              >
                <PackageCheck size={12} />
                Inspección de Partida en Depósito
              </span>

              <span
                style={{
                  fontSize: '0.68rem',
                  fontFamily: 'monospace',
                  color: '#94a3b8',
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  padding: '1px 6px',
                  borderRadius: '5px',
                  fontWeight: 700
                }}
              >
                #{product.producto_codigo}
              </span>

              {infoPartida?.lote_codigo && (
                <span
                  style={{
                    fontSize: '0.68rem',
                    color: '#cbd5e1',
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    padding: '1px 7px',
                    borderRadius: '5px',
                    fontWeight: 600
                  }}
                >
                  Partida: {infoPartida.lote_codigo}
                </span>
              )}

              {fechaCapturaStr && (
                <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>
                  • Captura: {fechaCapturaStr}
                </span>
              )}
            </div>

            <h3
              style={{
                margin: 0,
                fontSize: '0.98rem',
                fontWeight: 800,
                color: '#f8fafc',
                lineHeight: 1.25
              }}
            >
              {product.producto_descripcion}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Cerrar inspección"
            style={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              color: '#cbd5e1',
              width: '32px',
              height: '32px',
              borderRadius: '999px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            <X size={17} />
          </button>
        </div>

        {/* CUERPO SCROLLABLE */}
        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* AVISO TRANSPARENTE SI ES FRACCIÓN DERIVADA DE LÍNEA 2 */}
          {(infoPartida?.es_referencia_caja_madre || String(imagenes[0]?.id || '').startsWith('HEREDADO_MADRE:')) && (() => {
            const rawId0 = String(imagenes[0]?.id || '');
            const madreNombre = rawId0.startsWith('HEREDADO_MADRE:')
              ? rawId0.split('::')[0].replace('HEREDADO_MADRE:', '')
              : infoPartida?.articulo_madre_nombre;
            return (
              <div
                style={{
                  margin: '0.75rem 1rem 0',
                  padding: '0.55rem 0.75rem',
                  backgroundColor: 'rgba(14, 165, 233, 0.1)',
                  border: '1px solid rgba(14, 165, 233, 0.3)',
                  borderRadius: '0.6rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  fontSize: '0.75rem',
                  color: '#bae6fd',
                  lineHeight: 1.35
                }}
              >
                <Info size={15} style={{ flexShrink: 0, marginTop: '1px', color: '#38bdf8' }} />
                <div>
                  <strong>Referencia de Caja Madre (Línea 1):</strong> Fotografía tomada en depósito sobre el bulto original de entrada
                  {madreNombre ? ` (${madreNombre})` : ''} del cual se fracciona este artículo.
                </div>
              </div>
            );
          })()}

          {/* OBSERVACIÓN TÉCNICA DEL LOTE SI EXISTE */}
          {infoPartida?.observacion_tecnica && (
            <div
              style={{
                margin: '0.65rem 1rem 0',
                padding: '0.5rem 0.75rem',
                backgroundColor: 'rgba(30, 41, 59, 0.75)',
                borderLeft: '3px solid #14b8a6',
                borderRadius: '0.4rem',
                fontSize: '0.78rem',
                color: '#e2e8f0'
              }}
            >
              <span style={{ color: '#5eead4', fontWeight: 700 }}>Nota de depósito: </span>
              {infoPartida.observacion_tecnica}
            </div>
          )}

          {/* ESCENARIO PRINCIPAL DE LA FOTOGRAFÍA (CARRUSEL TÁCTIL + ZOOM) */}
          <div
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            style={{
              position: 'relative',
              backgroundColor: '#050811',
              margin: '0.75rem 1rem 0.5rem',
              borderRadius: '0.85rem',
              border: '1px solid #1e293b',
              overflow: zoomed ? 'auto' : 'hidden',
              height: zoomed ? '54vh' : '44vh',
              minHeight: '260px',
              maxHeight: '440px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none'
            }}
          >
            <img
              src={currentImg?.url}
              alt={`${product.producto_descripcion} - Imagen ${activeIndex + 1}`}
              onClick={() => setZoomed(!zoomed)}
              style={{
                width: zoomed ? '175%' : '100%',
                height: zoomed ? 'auto' : '100%',
                maxWidth: zoomed ? 'none' : '100%',
                maxHeight: zoomed ? 'none' : '100%',
                objectFit: 'contain',
                cursor: zoomed ? 'zoom-out' : 'zoom-in',
                transition: 'transform 0.2s ease'
              }}
            />

            {/* Contador superior izquierdo (1 / N) */}
            <div
              style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                backgroundColor: 'rgba(15, 23, 42, 0.82)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#f8fafc',
                fontSize: '0.72rem',
                fontWeight: 800,
                padding: '3px 9px',
                borderRadius: '999px',
                pointerEvents: 'none'
              }}
            >
              {activeIndex + 1} / {imagenes.length}
            </div>

            {/* Botón de Lupa / Zoom superior derecho */}
            <button
              type="button"
              onClick={() => setZoomed(!zoomed)}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                backgroundColor: 'rgba(15, 23, 42, 0.82)',
                border: '1px solid rgba(255,255,255,0.18)',
                color: '#e2e8f0',
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '4px 9px',
                borderRadius: '999px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer'
              }}
            >
              {zoomed ? <ZoomOut size={13} /> : <ZoomIn size={13} />}
              <span>{zoomed ? 'Ajustar' : 'Ampliar'}</span>
            </button>

            {/* Flechas de navegación si hay más de 1 foto */}
            {imagenes.length > 1 && !zoomed && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveIndex((prev) => (prev - 1 + imagenes.length) % imagenes.length)}
                  aria-label="Foto anterior"
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '36px',
                    height: '36px',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveIndex((prev) => (prev + 1) % imagenes.length)}
                  aria-label="Foto siguiente"
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '36px',
                    height: '36px',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <ChevronRight size={20} />
                </button>
              </>
            )}
          </div>

          {/* TIRA DE MINIATURAS */}
          {imagenes.length > 1 && (
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                padding: '0 1rem 0.65rem',
                overflowX: 'auto'
              }}
            >
              {imagenes.map((img, idx) => {
                const isSelected = idx === activeIndex;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setActiveIndex(idx);
                      setZoomed(false);
                    }}
                    style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: '0.55rem',
                      overflow: 'hidden',
                      padding: 0,
                      border: isSelected ? '2px solid #14b8a6' : '1px solid #334155',
                      opacity: isSelected ? 1 : 0.6,
                      cursor: 'pointer',
                      flexShrink: 0,
                      backgroundColor: '#090f1d'
                    }}
                  >
                    <img
                      src={img.url}
                      alt={`Miniatura ${idx + 1}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* NOTA DE TRANSPARENCIA COMERCIAL */}
          <div
            style={{
              padding: '0 1.1rem 0.75rem',
              fontSize: '0.7rem',
              color: '#64748b',
              lineHeight: 1.35
            }}
          >
            Fotografía real capturada en depósito sobre la partida vigente en stock para referencia técnica del comercio.
          </div>
        </div>

        {/* PIE DE ACCIÓN DIRECTA (PRECIO + AGREGAR AL PEDIDO) */}
        <div
          style={{
            padding: '0.8rem 1.1rem',
            borderTop: '1px solid #1e293b',
            backgroundColor: '#090f1d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap'
          }}
        >
          <div>
            {mostrarPrecios ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                  <span style={{ fontSize: '1.08rem', fontWeight: 800, color: ofertaActiva ? '#4ade80' : '#f8fafc' }}>
                    {fmt(displayPrecioKilo)}/kg
                  </span>
                  {esModoNeto && (
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700 }}>Neto s/IVA</span>
                  )}
                  {ofertaActiva && (
                    <span
                      style={{
                        fontSize: '0.66rem',
                        backgroundColor: 'rgba(245, 158, 11, 0.2)',
                        color: '#fcd34d',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontWeight: 800
                      }}
                    >
                      🔥 {descOfertaPct}% OFF
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  Bulto ({kilosUnidad} kg): {fmt(displayPrecioBulto)}{esModoNeto ? ' s/IVA' : ''}
                </span>
              </div>
            ) : (
              <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 600 }}>
                Presentación: {kilosUnidad > 1 ? `${kilosUnidad} kg` : 'Unidad'}
              </span>
            )}
          </div>

          {typeof onChangeQty === 'function' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {currentQty > 0 ? (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.55rem',
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '0.65rem',
                    padding: '0.3rem 0.5rem'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onChangeQty(currentQty - 1)}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '0.45rem',
                      border: 'none',
                      backgroundColor: '#0f172a',
                      color: '#f8fafc',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer'
                    }}
                  >
                    <Minus size={14} />
                  </button>
                  <span style={{ fontWeight: 800, fontSize: '0.92rem', minWidth: '22px', textAlign: 'center' }}>
                    {currentQty}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChangeQty(currentQty + 1)}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '0.45rem',
                      border: 'none',
                      backgroundColor: '#0d9488',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer'
                    }}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onChangeQty(1)}
                  style={{
                    backgroundColor: '#0d9488',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '0.65rem',
                    padding: '0.55rem 1rem',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer'
                  }}
                >
                  <Plus size={15} />
                  <span>Agregar al pedido</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
