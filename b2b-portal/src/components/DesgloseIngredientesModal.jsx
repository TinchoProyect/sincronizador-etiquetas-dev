import React, { useEffect } from 'react';
import { X, Plus, Minus, Sparkles, CheckCircle2 } from 'lucide-react';
import { supabaseAnonimaPublica } from '../supabaseClient';

function esEntornoLocalDev() {
  if (typeof window === 'undefined') return false;
  const h = String(window.location.hostname || '').toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h.startsWith('192.168.') ||
    h.startsWith('10.') ||
    h.startsWith('100.')
  );
}

/**
 * Indexa el diccionario de ingredientes tanto por clave exacta como en mayúsculas
 * para tolerar variantes de capitalización entre listas (ej. MFSPx300 vs MFSPX300).
 */
function normalizarMapaItems(rawItems) {
  const out = {};
  if (!rawItems || typeof rawItems !== 'object') return out;
  for (const [k, val] of Object.entries(rawItems)) {
    const cleanKey = String(k || '').trim();
    if (!cleanKey || !val || !Array.isArray(val.ingredientes) || val.ingredientes.length < 2) continue;
    out[cleanKey] = val;
    out[cleanKey.toUpperCase()] = val;
  }
  return out;
}

/**
 * Obtiene dinámicamente el mapa comercial de ingredientes:
 * 1) En entorno local / Laboratorio consulta directo al motor recursivo de PostgreSQL (`/api/produccion/catalogo/ingredientes-comerciales`).
 * 2) En Producción (Cloudflare) consulta el manifiesto en tiempo real en Supabase Storage (`b2b_lotes_fotos/ingredientes_comerciales.json`).
 */
export async function fetchMapaIngredientesComercialesB2B() {
  if (esEntornoLocalDev()) {
    const endpointsLocales = [
      '/api/produccion/catalogo/ingredientes-comerciales',
      'http://localhost:3000/api/produccion/catalogo/ingredientes-comerciales'
    ];
    for (const url of endpointsLocales) {
      try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (resp.ok) {
          const json = await resp.json();
          if (json?.ok && json.items) {
            return normalizarMapaItems(json.items);
          }
        }
      } catch {
        // Intentar siguiente endpoint o fallback a Storage
      }
    }
  }

  try {
    const { data } = supabaseAnonimaPublica
      .storage
      .from('b2b_lotes_fotos')
      .getPublicUrl('ingredientes_comerciales.json');

    if (!data?.publicUrl) return {};

    const resp = await fetch(`${data.publicUrl}?t=${Date.now()}`, {
      cache: 'no-store'
    });
    if (!resp.ok) return {};

    const json = await resp.json();
    return normalizarMapaItems(json?.items);
  } catch (err) {
    console.warn('[B2B-INGREDIENTES] No se pudo consultar manifest de ingredientes comerciales:', err.message);
    return {};
  }
}

/**
 * Resuelve la ficha comercial de ingredientes para un artículo de Línea 3 (Mixes) o Línea 6 (Granolas).
 * Incluye respaldo instantáneo embebido en `busqueda_metadata` (`__ING_L3:...__` / `__ING_L6:...__`).
 */
export function resolverInfoIngredientesProductoB2B(product, mapaIngredientes = {}) {
  if (!product) return null;
  const codExacto = String(product.producto_codigo || '').trim();
  if (!codExacto) return null;

  const directo = mapaIngredientes[codExacto] || mapaIngredientes[codExacto.toUpperCase()] || null;
  if (directo && [3, 5, 6].includes(Number(directo.linea_negocio)) && Array.isArray(directo.ingredientes) && directo.ingredientes.length >= 2) {
    return directo;
  }

  const meta = String(product.busqueda_metadata || '');
  const match = meta.match(/__ING_L(\d+):([^_]+?)__/);
  if (match) {
    const linea = parseInt(match[1], 10);
    if ([3, 5, 6].includes(linea)) {
      const lista = match[2].split('|').map((s) => s.trim()).filter(Boolean);
      if (lista.length >= 2) {
        return {
          codigo: codExacto,
          linea_negocio: linea,
          linea_etiqueta: linea === 6 ? 'Granola' : 'Mix',
          ingredientes: lista
        };
      }
    }
  }

  return null;
}

export function BotonVerIngredientesB2B({ onClick, compact = false }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof onClick === 'function') onClick(e);
      }}
      title="Ver ingredientes de la receta"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? '3px' : '4px',
        backgroundColor: 'rgba(245, 158, 11, 0.13)',
        color: '#fbbf24',
        border: '1px solid rgba(245, 158, 11, 0.38)',
        borderRadius: '8px',
        padding: compact ? '2px 7px' : '3px 8px',
        fontSize: compact ? '0.68rem' : '0.72rem',
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        marginLeft: compact ? 'auto' : undefined,
        transition: 'all 0.15s ease'
      }}
    >
      <span>🥣</span>
      <span>¿Qué contiene?</span>
    </button>
  );
}

export function DesgloseIngredientesModal({
  isOpen,
  onClose,
  product,
  infoIngredientes,
  currentQty = 0,
  onChangeQty
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !product || !infoIngredientes || !Array.isArray(infoIngredientes.ingredientes) || infoIngredientes.ingredientes.length === 0) {
    return null;
  }

  const lineaNum = Number(infoIngredientes.linea_negocio);
  const esGranola = lineaNum === 6;
  const esBarrita = lineaNum === 5;
  const etiquetaTipo = esGranola ? 'Granola Elaborada' : (esBarrita ? 'Barrita / Elaborado UP' : 'Mix Elaborado');

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(4, 8, 18, 0.78)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Ingredientes de ${product.producto_descripcion}`}
        style={{
          width: '100%',
          maxWidth: '460px',
          background: 'linear-gradient(180deg, #131c2e 0%, #0f172a 100%)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          borderRadius: '16px',
          boxShadow: '0 24px 50px rgba(0, 0, 0, 0.55)',
          overflow: 'hidden',
          color: '#f8fafc'
        }}
      >
        {/* Cabecera */}
        <div
          style={{
            padding: '1rem 1.15rem 0.85rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '0.75rem'
          }}
        >
          <div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '0.68rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#fbbf24',
                backgroundColor: 'rgba(245, 158, 11, 0.14)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '999px',
                padding: '2px 9px',
                marginBottom: '0.45rem'
              }}
            >
              <Sparkles size={11} />
              <span>{etiquetaTipo}</span>
            </span>
            <h3
              style={{
                margin: 0,
                fontSize: '1.02rem',
                fontWeight: 800,
                lineHeight: 1.3,
                color: '#f8fafc'
              }}
            >
              {product.producto_descripcion}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#cbd5e1',
              borderRadius: '9px',
              width: '32px',
              height: '32px',
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

        {/* Cuerpo: Listado limpio de ingredientes */}
        <div style={{ padding: '1rem 1.15rem 1.1rem' }}>
          <div
            style={{
              fontSize: '0.76rem',
              fontWeight: 700,
              color: '#94a3b8',
              marginBottom: '0.65rem',
              letterSpacing: '0.01em'
            }}
          >
            Ingredientes ({infoIngredientes.ingredientes.length}):
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.45rem'
            }}
          >
            {infoIngredientes.ingredientes.map((ing) => (
              <span
                key={ing}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: 'rgba(30, 41, 59, 0.9)',
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                  color: '#f1f5f9',
                  padding: '0.38rem 0.72rem',
                  borderRadius: '999px',
                  fontSize: '0.83rem',
                  fontWeight: 600
                }}
              >
                <CheckCircle2 size={13} style={{ color: '#fbbf24', flexShrink: 0 }} />
                <span>{ing}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Pie con acción rápida de pedido + Cerrar */}
        <div
          style={{
            padding: '0.8rem 1.15rem',
            backgroundColor: 'rgba(9, 13, 24, 0.65)',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem'
          }}
        >
          {typeof onChangeQty === 'function' ? (
            currentQty > 0 ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                <div className="quantity-controls">
                  <button
                    type="button"
                    className="qty-btn"
                    onClick={() => onChangeQty(currentQty - 1)}
                    title="Disminuir"
                  >
                    <Minus size={13} />
                  </button>
                  <span className="qty-value">{currentQty}</span>
                  <button
                    type="button"
                    className="qty-btn"
                    onClick={() => onChangeQty(currentQty + 1)}
                    title="Aumentar"
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <span style={{ fontSize: '0.76rem', color: '#34d399', fontWeight: 700 }}>En tu pedido</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onChangeQty(1)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: 'rgba(16, 185, 129, 0.16)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  borderRadius: '9px',
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <Plus size={15} />
                <span>Agregar al pedido</span>
              </button>
            )
          ) : <div />}

          <button
            type="button"
            onClick={onClose}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#e2e8f0',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: '9px',
              padding: '0.45rem 0.95rem',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
