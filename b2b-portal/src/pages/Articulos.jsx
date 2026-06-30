import React, { useState, useEffect } from 'react';
import { Search, SlidersHorizontal, Loader2, AlertCircle, Plus, Minus, Trash2, ShoppingBag } from 'lucide-react';
import { supabase } from '../supabaseClient';

export default function Articulos({ profile, cart = [], addToCart, removeFromCart, clearCart, setCurrentTab }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [selectedRubro, setSelectedRubro] = useState('');
  const [selectedSubrubro, setSelectedSubrubro] = useState('');
  const [error, setError] = useState(null);

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
      console.error('Error al cargar artículos:', err.message);
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
    const searchLower = search.toLowerCase();
    const matchesSearch = product.producto_descripcion.toLowerCase().includes(searchLower) ||
                          product.producto_codigo.toLowerCase().includes(searchLower) ||
                          (product.busqueda_metadata ? product.busqueda_metadata.toLowerCase().includes(searchLower) : false);
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

  if (loading) {
    return (
      <div className="spinner-container">
        <Loader2 className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Cargando lista de artículos...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <h1 className="page-title">Artículos</h1>
        
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
          <p>Error al cargar artículos: {error}</p>
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
                const cartItem = cart.find(item => item.producto_codigo === product.producto_codigo);
                const currentQty = cartItem ? cartItem.cantidad : 0;
                const hasStock = parseFloat(product.stock_disponible) > 0;
                
                return (
                  <div key={product.id} className="producto-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span className="producto-codigo">{product.producto_codigo}</span>
                      <span className={`stock-badge ${hasStock ? 'in-stock' : 'no-stock'}`}>
                        {hasStock ? `${parseFloat(product.stock_disponible)} disp.` : 'Sin stock'}
                      </span>
                    </div>

                    <h3 className="producto-descripcion">{product.producto_descripcion}</h3>
                    
                    {/* Rubros y Subrubros */}
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                      <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', padding: '0.1rem 0.35rem', borderRadius: '4px', border: '1px solid var(--border-glass)' }}>
                        {getNormalizedRubro(product)}
                      </span>
                      <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', padding: '0.1rem 0.35rem', borderRadius: '4px', border: '1px solid var(--border-glass)' }}>
                        {getNormalizedSubrubro(product)}
                      </span>
                    </div>

                    <div className="producto-actions">
                      <span className="producto-precio">{formatCurrency(product.precio_final)}</span>
                      
                      {currentQty > 0 ? (
                        <div className="quantity-controls">
                          <button 
                            className="qty-btn"
                            onClick={() => addToCart(product, currentQty - 1)}
                          >
                            <Minus size={14} />
                          </button>
                          <span className="qty-value">{currentQty}</span>
                          <button 
                            className="qty-btn"
                            onClick={() => addToCart(product, currentQty + 1)}
                            disabled={currentQty >= parseFloat(product.stock_disponible)}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      ) : (
                        <button 
                          className="btn-add-cart"
                          disabled={!hasStock}
                          onClick={() => addToCart(product, 1)}
                        >
                          <ShoppingBag size={14} />
                          <span>Añadir</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Lado Derecho: Carrito Panel Lateral (Sticky en Escritorio) */}
        {cart.length > 0 && (
          <div 
            className="login-card desktop-cart-sidebar" 
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
              boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
              border: '1px solid var(--border-glass)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem' }}>
              <ShoppingBag size={22} className="text-secondary" style={{ color: 'var(--accent)' }} />
              <h2 style={{ fontSize: '1.25rem', fontWeight: '700' }}>Revisar Pedido</h2>
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

            {/* Total */}
            <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Total Estimado:</span>
              <span style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>{formatCurrency(cartTotal)}</span>
            </div>

            {/* Confirmar botón */}
            <button
              onClick={() => setCurrentTab('pedidos')}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
            >
              <span>Definir Pedido</span>
            </button>
          </div>
        )}

      </div>

      {/* Carrito Flotante Sticky (para Mobile/Tablet) */}
      {cart.length > 0 && (
        <div className="mobile-cart-floating-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ position: 'relative' }}>
              <ShoppingBag size={20} style={{ color: 'var(--accent)' }} />
              <span 
                style={{ 
                  position: 'absolute', 
                  top: '-8px', 
                  right: '-8px', 
                  background: 'var(--accent)', 
                  color: 'white', 
                  borderRadius: '50%', 
                  width: '18px', 
                  height: '18px', 
                  fontSize: '0.65rem', 
                  fontWeight: 'bold', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}
              >
                {cart.reduce((sum, item) => sum + item.cantidad, 0)}
              </span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '500' }}>Total Estimado</p>
              <p style={{ margin: 0, fontSize: '1rem', fontWeight: '800', color: 'var(--text-primary)' }}>
                {formatCurrency(cartTotal)}
              </p>
            </div>
          </div>
          
          <button
            onClick={() => setCurrentTab('pedidos')}
            className="btn-primary"
            style={{
              borderRadius: '999px',
              padding: '0.45rem 1.15rem',
              fontSize: '0.8rem',
              fontWeight: '600',
              background: 'var(--accent)',
              border: 'none',
              color: 'white',
              cursor: 'pointer'
            }}
          >
            Revisar Orden
          </button>
        </div>
      )}
    </div>
  );
}
