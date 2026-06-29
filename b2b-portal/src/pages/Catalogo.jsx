import React, { useState, useEffect } from 'react';
import { Search, SlidersHorizontal, Loader2, AlertCircle, Plus, Minus, Trash2, ShoppingBag } from 'lucide-react';
import { supabase } from '../supabaseClient';
import Swal from 'sweetalert2';

export default function Catalogo({ profile, cart = [], addToCart, removeFromCart, clearCart }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [selectedRubro, setSelectedRubro] = useState('');
  const [selectedSubrubro, setSelectedSubrubro] = useState('');
  const [error, setError] = useState(null);
  
  const [submitting, setSubmitting] = useState(false);
  const [nota, setNota] = useState('');

  useEffect(() => {
    fetchCatalogo();
  }, [profile]);

  const fetchCatalogo = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Obtener la asignación de listas y prioridad del cliente
      const { data: userLists, error: listsError } = await supabase
        .from('clientes_b2b_perfiles_listas')
        .select('lista_id, es_principal');

      if (listsError) throw listsError;

      // Si el cliente no tiene ninguna lista asignada, se retorna un catálogo vacío de inmediato
      if (!userLists || userLists.length === 0) {
        setProducts([]);
        setLoading(false);
        return;
      }

      const listIds = userLists.map(ul => ul.lista_id);
      const listPriorityMap = new Map();
      for (const ul of userLists) {
        // es_principal = false (Lista custom Bunker) -> Prioridad 2 (Alta)
        // es_principal = true (Lista general Legacy) -> Prioridad 1 (Normal)
        listPriorityMap.set(ul.lista_id, ul.es_principal ? 1 : 2);
      }

      // 2. Obtener precios del catálogo filtrados estrictamente por las listas asignadas
      const { data, error: fetchError } = await supabase
        .from('clientes_b2b_catalogo_precios')
        .select('*')
        .in('lista_id', listIds)
        .order('producto_descripcion', { ascending: true });

      if (fetchError) throw fetchError;

      const prodMap = new Map();
      for (const item of data || []) {
        const existing = prodMap.get(item.producto_codigo);
        const itemPrice = parseFloat(item.precio_final);
        
        if (!existing) {
          prodMap.set(item.producto_codigo, { ...item });
        } else {
          const existingPrice = parseFloat(existing.precio_final);
          const existingPriority = listPriorityMap.get(existing.lista_id) || 0;
          const itemPriority = listPriorityMap.get(item.lista_id) || 0;

          let shouldUpdatePrice = false;
          if (existingPrice <= 0 && itemPrice > 0) {
            shouldUpdatePrice = true;
          } else if (itemPrice > 0) {
            if (itemPriority > existingPriority) {
              shouldUpdatePrice = true;
            } else if (itemPriority === existingPriority) {
              if (itemPrice < existingPrice) {
                shouldUpdatePrice = true;
              }
            }
          }

          if (shouldUpdatePrice) {
            existing.precio_final = item.precio_final;
            existing.lista_id = item.lista_id;
          }
          existing.stock_disponible = Math.max(parseFloat(existing.stock_disponible), parseFloat(item.stock_disponible));
        }
      }

      setProducts(Array.from(prodMap.values()));
    } catch (err) {
      console.error('Error al cargar catálogo:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Normalization helpers to group empty / missing classifications
  const getNormalizedRubro = (product) => {
    const r = product.rubro?.trim();
    return r && r !== '' ? r.toUpperCase() : 'SIN CLASIFICAR';
  };

  const getNormalizedSubrubro = (product) => {
    const sr = product.sub_rubro?.trim();
    return sr && sr !== '' ? sr.toUpperCase() : 'OTROS';
  };

  // Extract unique rubros
  const rubros = Array.from(
    new Set(products.map(product => getNormalizedRubro(product)))
  ).sort((a, b) => a.localeCompare(b));

  // Extract unique subrubros dependently based on selectedRubro
  const subrubros = selectedRubro
    ? Array.from(
        new Set(
          products
            .filter(product => getNormalizedRubro(product) === selectedRubro)
            .map(product => getNormalizedSubrubro(product))
        )
      ).sort((a, b) => a.localeCompare(b))
    : [];

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.producto_descripcion.toLowerCase().includes(search.toLowerCase()) ||
                          product.producto_codigo.toLowerCase().includes(search.toLowerCase());
    const matchesStock = !onlyInStock || parseFloat(product.stock_disponible) > 0;
    const matchesRubro = !selectedRubro || getNormalizedRubro(product) === selectedRubro;
    const matchesSubrubro = !selectedSubrubro || getNormalizedSubrubro(product) === selectedSubrubro;
    return matchesSearch && matchesStock && matchesRubro && matchesSubrubro;
  });

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS'
    }).format(val);
  };

  // Calcular total del carrito
  const cartTotal = cart.reduce((acc, item) => acc + item.subtotal, 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    
    try {
      const subtotal = cartTotal;
      const total = subtotal; // en desarrollo no aplicamos descuento en frontend

      // 1. Insertar cabecera del pedido
      const { data: header, error: headerErr } = await supabase
        .from('clientes_b2b_pedidos_cabecera')
        .insert({
          cliente_id: profile.cliente_id,
          subtotal: subtotal,
          descuento: 0.00,
          total: total,
          observaciones: nota.trim() || null,
          estado: 'Borrador',
          sync_estado: 'Pendiente'
        })
        .select()
        .single();

      if (headerErr) throw headerErr;

      // 2. Insertar ítems del pedido
      const itemsPayload = cart.map(item => ({
        pedido_id: header.id,
        producto_codigo: item.producto_codigo,
        producto_descripcion: item.producto_descripcion,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        subtotal: item.subtotal
      }));

      const { error: itemsErr } = await supabase
        .from('clientes_b2b_pedidos_items')
        .insert(itemsPayload);

      if (itemsErr) throw itemsErr;

      // Alerta SweetAlert2
      Swal.fire({
        title: '¡Pedido Confirmado!',
        text: `Su orden ha sido registrada con éxito (ID: ${header.id.slice(0, 8)}). Se ingresará a la grilla logística en breve.`,
        icon: 'success',
        confirmButtonText: 'Listo',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
        iconColor: 'var(--success)'
      });

      clearCart();
      setNota('');
    } catch (err) {
      console.error('Error al enviar pedido:', err.message);
      Swal.fire({
        title: 'Error al enviar pedido',
        text: err.message,
        icon: 'error',
        confirmButtonText: 'Entendido',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)'
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="spinner-container">
        <Loader2 className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Cargando catálogo de precios...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <h1 className="page-title">Catálogo de Artículos</h1>
        
        <div className="filters-container">
          <div className="search-input-wrapper" style={{ flex: '1 1 240px', minWidth: '200px' }}>
            <Search className="input-icon" size={18} style={{ left: '0.85rem' }} />
            <input
              type="text"
              placeholder="Buscar por descripción o código..."
              className="search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="filter-select"
            value={selectedRubro}
            onChange={(e) => {
              setSelectedRubro(e.target.value);
              setSelectedSubrubro(''); // Reset subrubro when rubro changes
            }}
            style={{ flex: '1 1 180px', minWidth: '150px' }}
          >
            <option value="">Todos los Rubros</option>
            {rubros.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          <select
            className="filter-select"
            value={selectedSubrubro}
            onChange={(e) => setSelectedSubrubro(e.target.value)}
            disabled={!selectedRubro}
            style={{ flex: '1 1 180px', minWidth: '150px' }}
          >
            <option value="">Todos los Subrubros</option>
            {subrubros.map(sr => (
              <option key={sr} value={sr}>{sr}</option>
            ))}
          </select>

          <button 
            className={`filter-btn ${onlyInStock ? 'active' : ''}`}
            onClick={() => setOnlyInStock(!onlyInStock)}
            style={{ flex: '0 0 auto' }}
          >
            <SlidersHorizontal size={16} />
            <span>Con Stock</span>
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1rem', borderRadius: '8px', display: 'flex', gap: '0.75rem', alignItems: 'center', color: 'var(--danger)', marginBottom: '1.5rem' }}>
          <AlertCircle size={20} />
          <p>Error al cargar catálogo: {error}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        
        {/* Lado Izquierdo: Grilla de Productos */}
        <div style={{ flex: '1', minWidth: '320px' }}>
          {filteredProducts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', border: '1px dashed var(--border-glass)', borderRadius: '12px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>No se encontraron artículos.</p>
            </div>
          ) : (
            <div className="catalogo-grid">
              {filteredProducts.map(product => {
                const stock = parseFloat(product.stock_disponible);
                const hasStock = stock > 0;
                
                // Buscar si el producto ya está en el carrito
                const cartItem = cart.find(item => item.producto_codigo === product.producto_codigo);
                const currentQty = cartItem ? cartItem.cantidad : 0;

                return (
                  <div key={product.producto_codigo} className="product-card">
                    <div>
                      <span className="product-code">COD: {product.producto_codigo}</span>
                      <h3 className="product-name" style={{ marginTop: '0.25rem' }}>{product.producto_descripcion}</h3>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: 'auto' }}>
                      <div className="product-meta">
                        <div className="product-price">
                          {formatCurrency(product.precio_final)}
                        </div>
                        <span className={`stock-badge ${hasStock ? 'in-stock' : 'out-stock'}`}>
                          {hasStock ? `Stock: ${stock}` : 'Sin Stock'}
                        </span>
                      </div>

                      {/* Controles de Carrito */}
                      <div style={{ marginTop: '0.5rem' }}>
                        {!hasStock ? (
                          <button 
                            disabled 
                            className="btn-primary" 
                            style={{ opacity: 0.4, background: 'var(--text-muted)', boxShadow: 'none' }}
                          >
                            No Disponible
                          </button>
                        ) : currentQty === 0 ? (
                          <button 
                            className="btn-primary"
                            onClick={() => addToCart(product, 1)}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                          >
                            <Plus size={16} /> Agregar al pedido
                          </button>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(2, 6, 23, 0.5)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)', padding: '0.25rem' }}>
                            <button 
                              className="btn-action-icon"
                              onClick={() => addToCart(product, currentQty - 1)}
                              style={{ border: 'none' }}
                            >
                              <Minus size={14} />
                            </button>
                            <span style={{ fontWeight: '600', fontSize: '1rem', color: 'var(--text-primary)' }}>
                              {currentQty}
                            </span>
                            <button 
                              className="btn-action-icon"
                              onClick={() => {
                                if (currentQty < stock) {
                                  addToCart(product, currentQty + 1);
                                } else {
                                  Swal.fire({
                                    title: 'Límite de Stock',
                                    text: `Solo hay ${stock} unidades disponibles en inventario.`,
                                    icon: 'warning',
                                    toast: true,
                                    position: 'top-end',
                                    showConfirmButton: false,
                                    timer: 2000,
                                    background: 'hsl(222, 47%, 11%)',
                                    color: 'var(--text-primary)'
                                  });
                                }
                              }}
                              style={{ border: 'none' }}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Lado Derecho: Carrito Panel Lateral (Sticky) */}
        {cart.length > 0 && (
          <div 
            className="login-card" 
            style={{ 
              width: '380px', 
              position: 'sticky', 
              top: '2rem', 
              padding: '1.75rem', 
              margin: '0', 
              animation: 'none', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '1.25rem',
              boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem' }}>
              <ShoppingBag size={22} className="text-secondary" style={{ color: 'var(--accent)' }} />
              <h2 style={{ fontSize: '1.25rem', fontWeight: '700' }}>Mi Pedido</h2>
              <span style={{ marginLeft: 'auto', background: 'rgba(59,130,246,0.1)', color: 'var(--accent)', borderRadius: '999px', padding: '0.1rem 0.6rem', fontSize: '0.8rem', fontWeight: '600' }}>
                {cart.length} {cart.length === 1 ? 'ítem' : 'ítems'}
              </span>
            </div>

            {/* Listado de ítems */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '300px', overflowY: 'auto', paddingRight: '0.25rem' }}>
              {cart.map(item => (
                <div key={item.producto_codigo} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '0.75rem' }}>
                  <div style={{ flex: '1', overflow: 'hidden' }}>
                    <p style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.producto_descripcion}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {item.cantidad} x {formatCurrency(item.precio_unitario)}
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {formatCurrency(item.subtotal)}
                    </span>
                    <button 
                      onClick={() => removeFromCart(item.producto_codigo)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', transition: 'var(--transition-smooth)' }}
                      title="Quitar"
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Notas / Observaciones */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Observaciones de entrega</label>
              <textarea 
                placeholder="Ej: Horario de entrega por la mañana, indicaciones para el chofer..."
                className="form-input"
                style={{ resize: 'none', height: '64px', padding: '0.5rem', fontSize: '0.85rem' }}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                disabled={submitting}
              />
            </div>

            {/* Total */}
            <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Total Estimado:</span>
              <span style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>{formatCurrency(cartTotal)}</span>
            </div>

            {/* Confirmar botón */}
            <button
              onClick={handleCheckout}
              disabled={submitting}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
            >
              {submitting ? (
                <>
                  <Loader2 className="spinner" style={{ width: '18px', height: '18px', borderTopColor: 'var(--text-primary)' }} />
                  <span>Procesando pedido...</span>
                </>
              ) : (
                <span>Confirmar Compra</span>
              )}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
