import React, { useState, useEffect } from 'react';
import { Truck, Loader2, AlertCircle, FileText, CheckCircle, Clock, Calendar, User, Phone, Clipboard, ArrowRight } from 'lucide-react';
import { supabase } from '../supabaseClient';
import Swal from 'sweetalert2';

export default function Retiros({ profile }) {
  const [retiros, setRetiros] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Estado para el modal de Check-in
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRetiro, setSelectedRetiro] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    nombre: '',
    apellido: '',
    celular: '',
    descripcionExterna: '',
    kilos: '',
    bultos: '',
    motivo: ''
  });

  useEffect(() => {
    if (profile) {
      fetchRetiros();
      fetchCatalogo();
    }
  }, [profile]);

  const fetchRetiros = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('clientes_b2b_retiros')
        .select('*')
        .order('fecha_creacion', { ascending: false });

      if (fetchError) throw fetchError;
      setRetiros(data || []);
    } catch (err) {
      console.error('Error al cargar retiros:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalogo = async () => {
    try {
      const { data, error: catError } = await supabase
        .from('clientes_b2b_catalogo_precios')
        .select('articulo_numero, producto_descripcion')
        .order('producto_descripcion', { ascending: true });
        
      if (!catError) {
        setCatalogo(data || []);
      }
    } catch (err) {
      console.warn('Error al cargar catálogo para autocompletado:', err.message);
    }
  };

  const handleOpenCheckin = (retiro) => {
    setSelectedRetiro(retiro);
    setFormData({
      nombre: profile.nombre_completo?.split(' ')[0] || '',
      apellido: profile.nombre_completo?.split(' ').slice(1).join(' ') || '',
      celular: '',
      descripcionExterna: '',
      kilos: '',
      bultos: '',
      motivo: ''
    });
    setIsModalOpen(true);
  };

  const handleCloseCheckin = () => {
    setIsModalOpen(false);
    setSelectedRetiro(null);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmitCheckin = async (e) => {
    e.preventDefault();
    if (!formData.nombre || !formData.kilos || !formData.bultos || !formData.descripcionExterna) {
      Swal.fire('Atención', 'Por favor complete todos los campos obligatorios (Nombre, Kilos, Bultos y Descripción).', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const parsedKilos = parseFloat(String(formData.kilos).replace(',', '.'));
      
      if (isNaN(parsedKilos) || parsedKilos <= 0) {
        Swal.fire('Atención', 'Los kilos deben ser un valor numérico mayor a 0.', 'warning');
        setSubmitting(false);
        return;
      }

      const { error: updateError } = await supabase
        .from('clientes_b2b_retiros')
        .update({
          responsable_nombre: formData.nombre.trim(),
          responsable_apellido: formData.apellido ? formData.apellido.trim() : null,
          responsable_celular: formData.celular ? formData.celular.trim() : null,
          articulo_numero: null, // Ya no se asocia a artículo comercial
          descripcion_externa: formData.descripcionExterna.trim(),
          kilos: parsedKilos,
          bultos: parseInt(formData.bultos, 10),
          motivo: formData.motivo ? formData.motivo.trim() : null,
          estado_logistico: 'PENDIENTE_VALIDACION',
          sincronizado_local: false
        })
        .eq('id', selectedRetiro.id);

      if (updateError) throw updateError;

      Swal.fire({
        icon: 'success',
        title: 'Check-in Completado',
        text: 'Los datos del retiro se registraron con éxito y fueron enviados a logística para la asignación del chofer.',
        timer: 3000,
        showConfirmButton: false
      });

      handleCloseCheckin();
      fetchRetiros();
    } catch (err) {
      console.error('Error al realizar check-in:', err.message);
      Swal.fire('Error', err.message || 'Ocurrió un error al registrar el check-in.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'PENDIENTE_CLIENTE':
        return <span style={{ background: '#fef3c7', color: '#d97706', padding: '4px 10px', borderRadius: '20px', fontSize: '0.8em', fontWeight: 'bold' }}>⚠️ Pendiente Check-in</span>;
      case 'PENDIENTE_VALIDACION':
        return <span style={{ background: '#e0e7ff', color: '#4f46e5', padding: '4px 10px', borderRadius: '20px', fontSize: '0.8em', fontWeight: 'bold' }}>🕒 Pendiente Validación</span>;
      case 'EN_CAMINO':
        return <span style={{ background: '#e0f2fe', color: '#0284c7', padding: '4px 10px', borderRadius: '20px', fontSize: '0.8em', fontWeight: 'bold' }}>🚚 Chofer en Camino</span>;
      case 'RETIRADO':
        return <span style={{ background: '#dcfce7', color: '#16a34a', padding: '4px 10px', borderRadius: '20px', fontSize: '0.8em', fontWeight: 'bold' }}>✅ Retirado</span>;
      default:
        return <span style={{ background: '#e2e8f0', color: '#475569', padding: '4px 10px', borderRadius: '20px', fontSize: '0.8em', fontWeight: 'bold' }}>{status}</span>;
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/D';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' hs';
  };

  // Separar retiros en pendientes de check-in y en camino/completados
  const retirosPendientes = retiros.filter(r => r.estado_logistico === 'PENDIENTE_CLIENTE');
  const retirosHistorial = retiros.filter(r => r.estado_logistico !== 'PENDIENTE_CLIENTE');

  if (loading) {
    return (
      <div className="spinner-container" style={{ minHeight: '50vh' }}>
        <Loader2 className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Cargando solicitudes de retiro...</p>
      </div>
    );
  }

  return (
    <div className="devoluciones-container" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      
      {/* Header Premium */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2.5rem' }}>
        <div style={{ background: 'linear-gradient(135deg, var(--accent) 0%, #4f46e5 100%)', borderRadius: '12px', padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)' }}>
          <Truck size={28} style={{ color: 'white' }} />
        </div>
        <div>
          <h1 style={{ fontSize: '1.85rem', fontWeight: '700', color: 'var(--text-primary)', margin: 0, fontFamily: 'Outfit' }}>Devoluciones y Retiros</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0.2rem 0 0 0' }}>Declare y gestione el retiro físico de insumos o mercadería en su local.</p>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', padding: '1rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
          <AlertCircle size={20} />
          <span>Error al conectar con la base de aduana: {error}</span>
        </div>
      )}

      {/* SECCIÓN 1: ACCIÓN REQUERIDA (Check-in Pendiente) */}
      <div style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Clipboard size={18} style={{ color: '#d97706' }} /> Check-in de Retiro Pendiente
        </h2>
        
        {retirosPendientes.length === 0 ? (
          <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-glass)', borderRadius: '8px', padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No tiene tickets de retiro pendientes de check-in en este momento.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
            {retirosPendientes.map(retiro => (
              <div 
                key={retiro.id} 
                style={{ 
                  background: 'linear-gradient(135deg, rgba(254, 243, 199, 0.05) 0%, rgba(254, 243, 199, 0.02) 100%)',
                  border: '1px solid #fcd34d', 
                  borderRadius: '12px', 
                  padding: '1.5rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '1rem'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)' }}>Retiro #{retiro.id}</span>
                    {getStatusBadge(retiro.estado_logistico)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Calendar size={14} /> Creado: {formatDate(retiro.fecha_creacion)}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><FileText size={14} /> QR: <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{retiro.codigo_qr_hash.substring(0, 8).toUpperCase()}</span></span>
                  </div>
                </div>
                <button 
                  onClick={() => handleOpenCheckin(retiro)}
                  className="btn-primary"
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem', 
                    padding: '0.6rem 1.2rem', 
                    borderRadius: '8px', 
                    background: 'linear-gradient(to right, #d97706, #b45309)',
                    border: 'none',
                    fontWeight: 'bold',
                    boxShadow: '0 4px 10px rgba(217, 119, 6, 0.2)'
                  }}
                >
                  Realizar Check-in <ArrowRight size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECCIÓN 2: HISTORIAL DE RETIROS */}
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={18} style={{ color: 'var(--accent)' }} /> Historial de Devoluciones / Retiros
        </h2>

        {retirosHistorial.length === 0 ? (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-glass)', borderRadius: '8px', padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No se registran retiros anteriores en su cuenta.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {retirosHistorial.map(retiro => (
              <div 
                key={retiro.id} 
                className="cc-movement-card"
                style={{ 
                  background: 'var(--bg-card)', 
                  border: '1px solid var(--border-glass)', 
                  borderRadius: '12px', 
                  padding: '1.25rem 1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)' }}>Retiro #{retiro.id}</span>
                    {getStatusBadge(retiro.estado_logistico)}
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Calendar size={14} /> {formatDate(retiro.fecha_creacion)}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '0.3rem' }}>📦 Detalle Declarado</div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: '600' }}>{retiro.descripcion_externa || 'N/D'}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      Bultos: {retiro.bultos} • Kilos: {retiro.kilos} kg
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '0.3rem' }}>❓ Motivo / Observación</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{retiro.motivo || 'N/D'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '0.3rem' }}>👤 Responsable</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <User size={14} style={{ color: 'var(--accent)' }} /> {retiro.responsable_nombre} {retiro.responsable_apellido}
                    </div>
                    {retiro.responsable_celular && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
                        <Phone size={12} /> {retiro.responsable_celular}
                      </div>
                    )}
                  </div>
                  {retiro.chofer_nombre && (
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '0.3rem' }}>🚚 Validación Chofer</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '600' }}>{retiro.chofer_nombre}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
                        <Clock size={12} /> {formatDate(retiro.fecha_validacion_chofer)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MODAL DE CHECK-IN FLOATING (GLASSMORPHISM) */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
          <div style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border-glass)', borderRadius: '16px', maxWidth: '650px', width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            
            <div style={{ padding: '1.25rem 1.5rem', background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0, fontFamily: 'Outfit' }}>📋 Completar Check-in de Retiro #{selectedRetiro.id}</h3>
              <button onClick={handleCloseCheckin} style={{ background: 'none', border: 'none', color: 'white', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
            </div>

            <form onSubmit={handleSubmitCheckin} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: '8px', padding: '0.85rem 1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Ingrese los detalles reales de la mercadería que tiene preparada para retirar. El chofer validará estas cantidades contra el ticket físico al llegar a su local.
              </div>

              {/* Responsable de Retiro */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Nombre Responsable *</label>
                  <input 
                    type="text" 
                    name="nombre" 
                    value={formData.nombre} 
                    onChange={handleInputChange}
                    className="form-control" 
                    required 
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Apellido Responsable</label>
                  <input 
                    type="text" 
                    name="apellido" 
                    value={formData.apellido} 
                    onChange={handleInputChange}
                    className="form-control" 
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Celular Contacto</label>
                  <input 
                    type="tel" 
                    name="celular" 
                    placeholder="ej: 1123456789"
                    value={formData.celular} 
                    onChange={handleInputChange}
                    className="form-control" 
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Artículo / Descripción */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Descripción del Producto a Devolver *</label>
                  <input 
                    type="text" 
                    name="descripcionExterna" 
                    placeholder="Describa el producto a devolver (ej: Semillas Mix x 5kg)"
                    value={formData.descripcionExterna} 
                    onChange={handleInputChange}
                    className="form-control" 
                    required 
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Bultos, Kilos y Motivo */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Bultos (Cajas/Bolsas) *</label>
                  <input 
                    type="number" 
                    name="bultos" 
                    min="1" 
                    step="1"
                    value={formData.bultos} 
                    onChange={handleInputChange}
                    className="form-control" 
                    required 
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Kilos Estimados *</label>
                  <input 
                    type="text" 
                    inputMode="decimal"
                    name="kilos" 
                    placeholder="0.00"
                    value={formData.kilos} 
                    onChange={handleInputChange}
                    className="form-control" 
                    required 
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Motivo de la Devolución / A tratar</label>
                  <input 
                    type="text" 
                    name="motivo" 
                    placeholder="Escriba el motivo (ej: mal estado, excedente de pedido, etc.)"
                    value={formData.motivo} 
                    onChange={handleInputChange}
                    className="form-control" 
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Botones de Acción */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem', borderTop: '1px solid var(--border-glass)', paddingTop: '1.25rem' }}>
                <button 
                  type="button" 
                  onClick={handleCloseCheckin} 
                  className="btn-secondary"
                  disabled={submitting}
                  style={{ padding: '0.6rem 1.5rem', borderRadius: '8px' }}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  disabled={submitting}
                  style={{ 
                    padding: '0.6rem 2rem', 
                    borderRadius: '8px', 
                    background: 'linear-gradient(to right, #d97706, #b45309)',
                    border: 'none',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="spinner" size={16} /> Guardando...
                    </>
                  ) : (
                    '💾 Enviar Check-in'
                  )}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
