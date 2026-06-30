import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { 
  ClipboardList, 
  Clock, 
  Package, 
  Truck, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  Loader2, 
  Calendar, 
  AlertCircle,
  FileText
} from 'lucide-react';

export default function Pedidos({ profile }) {
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedPedidoId, setExpandedPedidoId] = useState(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [openMonthKey, setOpenMonthKey] = useState(null);

  useEffect(() => {
    if (profile?.cliente_id) {
      fetchPedidos();
    }
  }, [profile]);

  const fetchPedidos = async () => {
    setLoading(true);
    setError(null);
    try {
      // Consultamos la cabecera e inyectamos los items correspondientes mediante un JOIN en PostgREST
      const { data, error: fetchError } = await supabase
        .from('clientes_b2b_pedidos_cabecera')
        .select(`
          *,
          clientes_b2b_pedidos_items (
            id,
            producto_codigo,
            producto_descripcion,
            cantidad,
            precio_unitario,
            subtotal
          )
        `)
        .not('estado', 'eq', 'Cancelado')
        .not('estado', 'eq', 'Eliminado')
        .order('fecha_pedido', { ascending: false });

      if (fetchError) throw fetchError;
      setPedidos(data || []);
    } catch (err) {
      console.error('Error al cargar pedidos:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS'
    }).format(val);
  };

  const getStepIndex = (estado) => {
    const est = (estado || '').toLowerCase().trim();
    if (est === 'borrador' || est === 'pendiente' || est === 'en preparacion') {
      return 1;
    }
    if (est === 'en proceso') {
      return 2;
    }
    if (est === 'listo para entregar') {
      return 3;
    }
    if (est === 'en ruta' || est === 'listo para retirar') {
      return 4;
    }
    if (est === 'entregado') {
      return 5;
    }
    return 1; // Default
  };

  const toggleExpand = (id) => {
    setExpandedPedidoId(expandedPedidoId === id ? null : id);
  };

  const stepsConfig = [
    { label: 'Preparación', sublabel: 'En cola de armado', icon: ClipboardList },
    { label: 'Producción', sublabel: 'Armando pedido', icon: Clock },
    { label: 'Listo para Entregar', sublabel: 'Control de bultos', icon: Package },
    { label: 'Logística', sublabel: 'Despacho / Retiro', icon: Truck },
    { label: 'Entregado', sublabel: 'Circuito finalizado', icon: CheckCircle2 }
  ];

  if (loading) {
    return (
      <div className="spinner-container">
        <Loader2 className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Cargando su historial de pedidos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state" style={{ borderColor: 'var(--danger)' }}>
        <AlertCircle size={48} style={{ color: 'var(--danger)' }} />
        <p className="empty-state-title">Ocurrió un error al obtener los pedidos</p>
        <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
        <button onClick={fetchPedidos} className="filter-btn" style={{ marginTop: '1rem' }}>
          Reintentar Carga
        </button>
      </div>
    );
  }

  const pedidosActivos = pedidos.filter(p => getStepIndex(p.estado) !== 5);
  const pedidosEntregados = pedidos.filter(p => getStepIndex(p.estado) === 5);

  const groupHistoricalPedidos = (historicalList) => {
    const groups = {};
    historicalList.forEach(pedido => {
      const date = new Date(pedido.fecha_pedido);
      const monthName = date.toLocaleDateString('es-AR', { month: 'long' });
      const year = date.getFullYear();
      const groupKey = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;
      
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(pedido);
    });
    return groups;
  };

  const historicalGroups = groupHistoricalPedidos(pedidosEntregados);

  return (
    <div className="pedidos-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mis Pedidos</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Seguimiento de compras y estado de despacho en tiempo real
          </p>
        </div>
        <button onClick={fetchPedidos} className="filter-btn">
          Actualizar
        </button>
      </div>

      {pedidos.length === 0 ? (
        <div className="empty-state">
          <FileText size={48} style={{ color: 'var(--text-muted)' }} />
          <p className="empty-state-title">No hay pedidos registrados</p>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '400px' }}>
            Aún no has realizado pedidos desde el portal. Cuando confirmes un carrito de compras, podrás seguir su estado desde aquí.
          </p>
        </div>
      ) : (
        <>
          {/* Listado de Pedidos Activos */}
          {pedidosActivos.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 1.5rem', background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-glass)', borderRadius: 'var(--radius-lg)' }}>
              <Clock size={36} style={{ color: 'var(--text-muted)' }} />
              <p className="empty-state-title" style={{ fontSize: '1rem', marginTop: '0.5rem' }}>No tienes pedidos activos</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: '350px', margin: '0 auto' }}>
                Todos tus pedidos han sido entregados y archivados en el listado histórico inferior.
              </p>
            </div>
          ) : (
            <div className="pedidos-grid">
              {pedidosActivos.map((pedido) => {
                const currentStep = getStepIndex(pedido.estado);
                const isExpanded = expandedPedidoId === pedido.id;
                const items = pedido.clientes_b2b_pedidos_items || [];
                
                let logisticaLabel = 'Logística';
                let logisticaSublabel = 'Despacho / Retiro';
                const rawEstado = (pedido.estado || '').toLowerCase().trim();
                if (rawEstado === 'en ruta') {
                  logisticaLabel = 'En Reparto';
                  logisticaSublabel = 'Asignado a reparto';
                } else if (rawEstado === 'listo para retirar') {
                  logisticaLabel = 'Listo para Retirar';
                  logisticaSublabel = 'En depósito local';
                }

                return (
                  <div key={pedido.id} className="pedido-card">
                    {/* Cabecera de la Tarjeta */}
                    <div className="pedido-header">
                      <div className="pedido-info-main">
                        <span className="pedido-number">
                          <ClipboardList size={18} style={{ color: 'var(--accent)' }} />
                          Pedido: #{pedido.id.substring(0, 8).toUpperCase()}
                        </span>
                        <span className="pedido-date">
                          Fecha: {new Date(pedido.fecha_pedido).toLocaleDateString('es-AR', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      
                      <div className="pedido-totals">
                        <div className="pedido-total-amount">
                          Total: {formatCurrency(pedido.total)}
                        </div>
                        <span className={`badge-status ${
                          currentStep === 5 ? 'entregado' : 
                          currentStep === 4 ? 'logistica' : 
                          currentStep === 3 ? 'listo' : 
                          currentStep === 2 ? 'proceso' : 'pendiente'
                        }`}>
                          {pedido.estado || 'Recibido'}
                        </span>
                      </div>
                    </div>

                    {/* Stepper de 5 Pasos */}
                    <div className="stepper-container">
                      <div className="stepper-progress-bar">
                        <div 
                          className="stepper-progress-line"
                          style={{ 
                            width: `${((currentStep - 1) / 4) * 100}%`
                          }}
                        />
                      </div>

                      {stepsConfig.map((step, idx) => {
                        const stepNum = idx + 1;
                        const isCompleted = stepNum < currentStep;
                        const isActive = stepNum === currentStep;
                        
                        const StepIcon = step.icon;
                        const label = stepNum === 4 ? logisticaLabel : step.label;
                        const sublabel = stepNum === 4 ? logisticaSublabel : step.sublabel;

                        return (
                          <div 
                            key={idx} 
                            className={`step-item ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}
                          >
                            <div className="step-icon-wrapper">
                              <StepIcon size={18} />
                            </div>
                            <span className="step-label">{label}</span>
                            <span className="step-sublabel">{sublabel}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Acciones y Detalle */}
                    <div className="pedido-action-bar">
                      <button 
                        onClick={() => toggleExpand(pedido.id)} 
                        className="btn-toggle-details"
                      >
                        <span>{isExpanded ? 'Ocultar Detalle' : 'Ver Detalle'}</span>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="pedido-details">
                        <div className="details-table-wrapper">
                          <table className="details-table">
                            <thead>
                              <tr>
                                <th>Código</th>
                                <th>Descripción</th>
                                <th style={{ textAlign: 'right' }}>Cant.</th>
                                <th style={{ textAlign: 'right' }}>Precio Unit.</th>
                                <th style={{ textAlign: 'right' }}>Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.length === 0 ? (
                                <tr>
                                  <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                                    No se encontraron ítems en este pedido.
                                  </td>
                                </tr>
                              ) : (
                                items.map((item) => (
                                  <tr key={item.id}>
                                    <td style={{ color: 'var(--accent)', fontWeight: '600' }}>
                                      {item.producto_codigo}
                                    </td>
                                    <td>{item.producto_descripcion}</td>
                                    <td style={{ textAlign: 'right', fontWeight: '500' }}>
                                      {parseFloat(item.cantidad)}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                      {formatCurrency(item.precio_unitario)}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: '600', color: 'var(--text-primary)' }}>
                                      {formatCurrency(item.subtotal)}
                                    </td>
                                  </tr>
                                ))
                              )}
                              <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                <td colSpan="3"></td>
                                <td style={{ textAlign: 'right', color: 'var(--text-secondary)', fontWeight: '500' }}>Subtotal:</td>
                                <td style={{ textAlign: 'right', fontWeight: '600' }}>{formatCurrency(pedido.subtotal)}</td>
                              </tr>
                              {parseFloat(pedido.descuento) > 0 && (
                                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                  <td colSpan="3"></td>
                                  <td style={{ textAlign: 'right', color: 'var(--danger)', fontWeight: '500' }}>Descuento:</td>
                                  <td style={{ textAlign: 'right', fontWeight: '600', color: 'var(--danger)' }}>-{formatCurrency(pedido.descuento)}</td>
                                </tr>
                              )}
                              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                                <td colSpan="3"></td>
                                <td style={{ textAlign: 'right', color: 'var(--text-primary)', fontWeight: '700' }}>Total Final:</td>
                                <td style={{ textAlign: 'right', fontWeight: '700', color: 'var(--text-primary)', fontSize: '1.05rem' }}>{formatCurrency(pedido.total)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        {pedido.observaciones && (
                          <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Observaciones del Cliente:</span>
                            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0 }}>{pedido.observaciones}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Acordeón de Pedidos Históricos (Entregados) */}
          {pedidosEntregados.length > 0 && (
            <div className="historical-accordion-container" style={{ marginTop: '2.5rem' }}>
              <button 
                onClick={() => setIsHistoryOpen(!isHistoryOpen)} 
                className="historical-accordion-header"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  padding: '1.15rem 1.5rem',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: 'var(--radius-lg)',
                  color: 'var(--text-primary)',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
                  <span>Pedidos Históricos (Entregados) ({pedidosEntregados.length})</span>
                </div>
                {isHistoryOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>

              {isHistoryOpen && (
                <div className="historical-months-list" style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {Object.entries(historicalGroups).map(([monthKey, monthPedidos]) => {
                    const isMonthOpen = openMonthKey === monthKey;
                    return (
                      <div 
                        key={monthKey} 
                        className="historical-month-group" 
                        style={{
                          border: '1px solid var(--border-glass)',
                          borderRadius: 'var(--radius-md)',
                          overflow: 'hidden',
                          background: 'rgba(255, 255, 255, 0.01)'
                        }}
                      >
                        <button
                          onClick={() => setOpenMonthKey(isMonthOpen ? null : monthKey)}
                          className="historical-month-header"
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            width: '100%',
                            padding: '0.85rem 1.25rem',
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            fontWeight: '550',
                            fontSize: '0.85rem',
                            cursor: 'pointer'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
                            <span>{monthKey} ({monthPedidos.length} {monthPedidos.length === 1 ? 'pedido' : 'pedidos'})</span>
                          </div>
                          {isMonthOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>

                        {isMonthOpen && (
                          <div 
                            className="historical-month-content" 
                            style={{ 
                              padding: '1rem', 
                              display: 'flex', 
                              flexDirection: 'column', 
                              gap: '1rem',
                              background: 'rgba(0,0,0,0.15)'
                            }}
                          >
                            {monthPedidos.map((pedido) => {
                              const isExpanded = expandedPedidoId === pedido.id;
                              const items = pedido.clientes_b2b_pedidos_items || [];
                              return (
                                <div key={pedido.id} className="pedido-card historical-card" style={{ margin: 0, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
                                  <div className="pedido-header" style={{ paddingBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                    <div className="pedido-info-main">
                                      <span className="pedido-number" style={{ fontSize: '0.85rem' }}>
                                        <ClipboardList size={16} style={{ color: 'var(--text-muted)' }} />
                                        Pedido: #{pedido.id.substring(0, 8).toUpperCase()}
                                      </span>
                                      <span className="pedido-date" style={{ fontSize: '0.8rem' }}>
                                        Fecha: {new Date(pedido.fecha_pedido).toLocaleDateString('es-AR')}
                                      </span>
                                    </div>
                                    <div className="pedido-totals">
                                      <div className="pedido-total-amount" style={{ fontSize: '0.9rem' }}>
                                        Total: {formatCurrency(pedido.total)}
                                      </div>
                                      <span className="badge-status entregado" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                                        Entregado
                                      </span>
                                    </div>
                                  </div>

                                  <div className="pedido-action-bar" style={{ padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.01)' }}>
                                    <button 
                                      onClick={() => toggleExpand(pedido.id)} 
                                      className="btn-toggle-details"
                                      style={{ fontSize: '0.8rem' }}
                                    >
                                      <span>{isExpanded ? 'Ocultar Detalle' : 'Ver Detalle'}</span>
                                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    </button>
                                  </div>

                                  {isExpanded && (
                                    <div className="pedido-details" style={{ padding: '0.75rem', background: 'transparent' }}>
                                      <div className="details-table-wrapper" style={{ border: '1px solid rgba(255,255,255,0.03)' }}>
                                        <table className="details-table" style={{ fontSize: '0.8rem' }}>
                                          <thead>
                                            <tr>
                                              <th>Código</th>
                                              <th>Descripción</th>
                                              <th style={{ textAlign: 'right' }}>Cant.</th>
                                              <th style={{ textAlign: 'right' }}>Precio Unit.</th>
                                              <th style={{ textAlign: 'right' }}>Subtotal</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {items.map((item) => (
                                              <tr key={item.id}>
                                                <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{item.producto_codigo}</td>
                                                <td>{item.producto_descripcion}</td>
                                                <td style={{ textAlign: 'right' }}>{parseFloat(item.cantidad)}</td>
                                                <td style={{ textAlign: 'right' }}>{formatCurrency(item.precio_unitario)}</td>
                                                <td style={{ textAlign: 'right', fontWeight: '600' }}>{formatCurrency(item.subtotal)}</td>
                                              </tr>
                                            ))}
                                            <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                                              <td colSpan="3"></td>
                                              <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>Subtotal:</td>
                                              <td style={{ textAlign: 'right' }}>{formatCurrency(pedido.subtotal)}</td>
                                            </tr>
                                            {parseFloat(pedido.descuento) > 0 && (
                                              <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                                                <td colSpan="3"></td>
                                                <td style={{ textAlign: 'right', color: 'var(--danger)' }}>Descuento:</td>
                                                <td style={{ textAlign: 'right', color: 'var(--danger)' }}>-{formatCurrency(pedido.descuento)}</td>
                                              </tr>
                                            )}
                                            <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                                              <td colSpan="3"></td>
                                              <td style={{ textAlign: 'right', fontWeight: '700' }}>Total Final:</td>
                                              <td style={{ textAlign: 'right', fontWeight: '700', fontSize: '0.95rem' }}>{formatCurrency(pedido.total)}</td>
                                            </tr>
                                          </tbody>
                                        </table>
                                      </div>
                                      {pedido.observaciones && (
                                        <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.01)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)', fontSize: '0.8rem' }}>
                                          <span style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>Observaciones:</span> {pedido.observaciones}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
