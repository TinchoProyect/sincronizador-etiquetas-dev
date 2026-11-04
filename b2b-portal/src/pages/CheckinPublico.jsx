import React, { useState, useEffect } from 'react';
import { supabaseAnonimaPublica } from '../supabaseClient';
import { 
  Package, User, Phone, CheckCircle2, AlertCircle, ArrowLeft, ArrowRight, 
  RotateCcw, Sparkles, Check, FileText, ChevronRight 
} from 'lucide-react';
import Swal from 'sweetalert2';

// Formateador de celular argentino en vivo
const formatCelularArg = (val) => {
  if (!val) return '';
  const digits = val.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  if (digits.length <= 8) return `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
};

// Limpiador de descripciones de producto para remover presentaciones (ej: "x 5kg", "x 10kg", "3x4")
const limpiarDescripcionProducto = (raw) => {
  if (!raw) return '';
  let clean = raw;
  clean = clean.replace(/\s*x\s*\d+(\.\d+)?\s*(kg|g|gr|kilo|kilos|un|uni|u|l|lt|cc)?\b/gi, '');
  clean = clean.replace(/\s*\d+\s*x\s*\d+\b/gi, '');
  clean = clean.replace(/\s*\(\s*.*?\s*\)/g, '');
  clean = clean.replace(/\s*-\s*\d+(\.\d+)?\s*(kg|g|gr)\b/gi, '');
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean;
};

export default function CheckinPublico({ path }) {
  // Extraer hash de la ruta (soporta pathname /checkin/:hash, hash #/checkin/:hash o ?hash=...)
  const rawPath = path || window.location.hash || window.location.pathname || '';
  const params = new URLSearchParams(window.location.search);
  const hashFromParam = params.get('hash');
  
  let targetHash = hashFromParam || '';
  if (!targetHash) {
    const parts = rawPath.split('/checkin/');
    if (parts.length > 1) {
      targetHash = parts[1].split('?')[0].split('#')[0].split('/')[0].trim();
    }
  }

  const [loading, setLoading] = useState(true);
  const [retiro, setRetiro] = useState(null);
  const [catalogo, setCatalogo] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Asistente de 3 Pasos
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [completadoExitoso, setCompletadoExitoso] = useState(false);

  // Autocompletado de Catálogo
  const [searchCatalogo, setSearchCatalogo] = useState('');
  const [showCatalogoDropdown, setShowCatalogoDropdown] = useState(false);

  const [formData, setFormData] = useState({
    nombre: '',
    apellido: '',
    celular: '',
    descripcionExterna: '',
    kilos: '',
    bultos: '1',
    motivo: ''
  });

  const MOTIVOS_FRECUENTES = [
    { id: 'excedente', label: '📦 Excedente de pedido', valor: 'Excedente de pedido' },
    { id: 'mal_estado', label: '⚠️ Mal estado / Plaga', valor: 'Mal estado / Plaga' },
    { id: 'humedad', label: '💧 Humedad u Olor', valor: 'Olor o Humedad' },
    { id: 'error_despacho', label: '🔄 Error en despacho', valor: 'Error en despacho' },
    { id: 'vencimiento', label: '⏳ Próximo a vencer', valor: 'Próximo a vencer' },
    { id: 'inmunizar', label: '🛡️ Tratamiento preventivo', valor: 'Tratamiento preventivo' },
    { id: 'otros', label: '✏️ Otro motivo...', valor: 'Otro motivo' }
  ];

  useEffect(() => {
    if (targetHash) {
      cargarRetiroYCatalogo();
    } else {
      setLoading(false);
      setErrorMsg('No se proporcionó un código de retiro válido.');
    }
  }, [targetHash]);

  const cargarRetiroYCatalogo = async () => {
    try {
      setLoading(true);
      setErrorMsg('');

      // 1. Cargar Retiro por Hash Criptográfico
      const { data: retData, error: retError } = await supabaseAnonimaPublica
        .from('clientes_b2b_retiros')
        .select('*')
        .eq('codigo_qr_hash', targetHash)
        .single();

      if (retError || !retData) {
        throw new Error('El enlace de retiro no existe, ha expirado o ya no está disponible.');
      }

      setRetiro(retData);

      // Pre-cargar formulario si ya tenía datos cargados
      setFormData({
        nombre: retData.responsable_nombre || '',
        apellido: retData.responsable_apellido || '',
        celular: formatCelularArg(retData.responsable_celular || ''),
        descripcionExterna: retData.descripcion_externa || '',
        kilos: retData.kilos ? String(retData.kilos) : '',
        bultos: retData.bultos ? String(retData.bultos) : '1',
        motivo: retData.motivo || ''
      });
      setSearchCatalogo(retData.descripcion_externa || '');

      // 2. Cargar Catálogo de Artículos para Autocompletado
      const { data: catData } = await supabaseAnonimaPublica
        .from('clientes_b2b_catalogo_precios')
        .select('producto_codigo, producto_descripcion')
        .order('producto_descripcion', { ascending: true });

      if (catData && catData.length > 0) {
        const unique = [];
        const seen = new Set();
        for (const item of catData) {
          const cleanDesc = limpiarDescripcionProducto(item.producto_descripcion || '');
          if (cleanDesc && !seen.has(cleanDesc.toLowerCase())) {
            seen.add(cleanDesc.toLowerCase());
            unique.push({
              ...item,
              producto_descripcion: cleanDesc
            });
          }
        }
        setCatalogo(unique);
      }

    } catch (err) {
      console.error('Error cargando check-in público:', err.message);
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const catalogoFiltrado = catalogo.filter(item => {
    if (!searchCatalogo.trim()) return false;
    const terminos = searchCatalogo.toLowerCase().split(/\s+/).filter(Boolean);
    const desc = (item.producto_descripcion || '').toLowerCase();
    const cod = (item.producto_codigo || '').toLowerCase();
    return terminos.every(t => desc.includes(t) || cod.includes(t));
  });

  const handleConfirmarCheckin = async () => {
    if (!formData.nombre.trim()) {
      Swal.fire('Atención', 'Por favor ingresa el nombre de quien entrega.', 'warning');
      setStep(1);
      return;
    }
    if (!formData.descripcionExterna.trim()) {
      Swal.fire('Atención', 'Por favor selecciona o escribe el producto a devolver.', 'warning');
      setStep(2);
      return;
    }
    if (!formData.kilos || parseFloat(formData.kilos) <= 0) {
      Swal.fire('Atención', 'Por favor indica los kilos aproximados.', 'warning');
      setStep(2);
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        responsable_nombre: formData.nombre.trim(),
        responsable_apellido: formData.apellido.trim(),
        responsable_celular: formData.celular.trim(),
        descripcion_externa: formData.descripcionExterna.trim(),
        kilos: parseFloat(formData.kilos),
        bultos: parseInt(formData.bultos || '1', 10),
        motivo: formData.motivo.trim() || 'Excedente / A revisar',
        estado_logistico: 'PENDIENTE_VALIDACION',
        sincronizado_local: false
      };

      const { error: updErr } = await supabaseAnonimaPublica
        .from('clientes_b2b_retiros')
        .update(payload)
        .eq('codigo_qr_hash', targetHash);

      if (updErr) throw updErr;

      setCompletadoExitoso(true);
      setRetiro(prev => ({ ...prev, ...payload }));

      Swal.fire({
        icon: 'success',
        title: '¡Check-in Registrado!',
        text: 'La información del retiro fue guardada con éxito. El chofer de LAMDA ya tiene los datos para retirar.',
        confirmButtonColor: '#2563eb'
      });

    } catch (err) {
      console.error('Error al guardar check-in público:', err.message);
      Swal.fire('Error', 'No se pudo guardar el check-in: ' + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#f8fafc', padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ width: '48px', height: '48px', border: '4px solid #334155', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ marginTop: '1rem', color: '#94a3b8', fontSize: '1rem' }}>Cargando asistente de retiro...</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (errorMsg || !retiro) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#f8fafc', padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid #334155', borderRadius: '1rem', padding: '2rem', maxWidth: '450px', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)' }}>
          <AlertCircle size={48} color="#ef4444" style={{ margin: '0 auto 1rem auto' }} />
          <h2 style={{ fontSize: '1.35rem', fontWeight: 'bold', marginBottom: '0.75rem', color: '#f8fafc' }}>Enlace no disponible</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
            {errorMsg || 'El enlace que intentas abrir no es válido o ha expirado.'}
          </p>
        </div>
      </div>
    );
  }

  // Pantalla de Éxito / Confirmación
  if (completadoExitoso || (retiro.estado_logistico === 'PENDIENTE_VALIDACION' && step === 0)) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', padding: '1.5rem', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '1.25rem', padding: '2rem', maxWidth: '480px', width: '100%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{ width: '64px', height: '64px', background: 'rgba(34, 197, 94, 0.15)', border: '2px solid #22c55e', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
              <CheckCircle2 size={36} color="#22c55e" />
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#f8fafc', margin: '0 0 0.25rem 0' }}>
              ¡Check-in Completado!
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: 0 }}>
              Retiro #{retiro.id} • Guardado exitosamente
            </p>
          </div>

          <div style={{ background: '#0f172a', borderRadius: '0.85rem', padding: '1.25rem', border: '1px solid #334155', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', fontWeight: 'bold' }}>
              Resumen Registrado
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.9rem' }}>
              <div>
                <span style={{ color: '#64748b' }}>Responsable:</span> <strong style={{ color: '#f8fafc' }}>{formData.nombre} {formData.apellido}</strong>
              </div>
              {formData.celular && (
                <div>
                  <span style={{ color: '#64748b' }}>Celular:</span> <strong style={{ color: '#f8fafc' }}>{formData.celular}</strong>
                </div>
              )}
              <div>
                <span style={{ color: '#64748b' }}>Mercadería:</span> <strong style={{ color: '#38bdf8' }}>{formData.descripcionExterna}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Cantidad:</span> <strong style={{ color: '#f8fafc' }}>{formData.bultos} bulto(s) • {formData.kilos} kg</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Motivo:</span> <span style={{ background: '#334155', color: '#f8fafc', padding: '2px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>{formData.motivo || 'Excedente'}</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => setStep(1)}
            style={{ width: '100%', padding: '0.85rem', background: '#334155', color: '#f8fafc', border: 'none', borderRadius: '0.75rem', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', transition: 'all 0.2s' }}
          >
            <RotateCcw size={16} /> Modificar datos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', padding: '1.25rem', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      
      {/* Header Marca */}
      <div style={{ textAlign: 'center', marginTop: '0.5rem', marginBottom: '1.25rem' }}>
        <img 
          src="/isotipo_L_LAMDA.png?v=5" 
          alt="LAMDA" 
          style={{ height: '36px', objectFit: 'contain', marginBottom: '0.5rem' }} 
        />
        <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#f8fafc', margin: 0 }}>
          Asistente de Retiro
        </h1>
        <p style={{ color: '#38bdf8', fontSize: '0.85rem', margin: '2px 0 0 0', fontWeight: '600' }}>
          Ticket de Retiro #{retiro.id}
        </p>
      </div>

      {/* Tarjeta Principal del Asistente */}
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '1.25rem', padding: '1.5rem', maxWidth: '480px', width: '100%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
        
        {/* Barra de Progreso de 3 Pasos */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid #334155' }}>
          {[
            { n: 1, label: 'Responsable' },
            { n: 2, label: 'Mercadería' },
            { n: 3, label: 'Confirmar' }
          ].map((s) => (
            <div 
              key={s.n} 
              onClick={() => s.n < step && setStep(s.n)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: s.n < step ? 'pointer' : 'default' }}
            >
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                fontSize: '0.85rem',
                background: step === s.n ? '#2563eb' : (step > s.n ? '#10b981' : '#334155'),
                color: '#fff'
              }}>
                {step > s.n ? '✓' : s.n}
              </div>
              <span style={{ fontSize: '0.8rem', color: step >= s.n ? '#f8fafc' : '#64748b', fontWeight: step === s.n ? 'bold' : 'normal' }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {/* PASO 1: RESPONSABLE / QUIEN ENTREGA */}
        {step === 1 && (
          <div>
            <div style={{ marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#f8fafc', margin: '0 0 0.35rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <User size={20} color="#38bdf8" /> ¿Quién entrega la mercadería?
              </h2>
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>
                Indica el nombre del titular o encargado presente en el local para que el chofer lo identifique.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#94a3b8', marginBottom: '0.35rem' }}>
                  Nombre <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="Ej: Lucas"
                  value={formData.nombre}
                  onChange={(e) => setFormData(prev => ({ ...prev, nombre: e.target.value }))}
                  style={{ width: '100%', padding: '0.75rem 0.9rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.65rem', color: '#fff', fontSize: '0.95rem', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#94a3b8', marginBottom: '0.35rem' }}>
                  Apellido
                </label>
                <input
                  type="text"
                  placeholder="Ej: Pérez"
                  value={formData.apellido}
                  onChange={(e) => setFormData(prev => ({ ...prev, apellido: e.target.value }))}
                  style={{ width: '100%', padding: '0.75rem 0.9rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.65rem', color: '#fff', fontSize: '0.95rem', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#94a3b8', marginBottom: '0.35rem' }}>
                  Celular de contacto
                </label>
                <div style={{ position: 'relative' }}>
                  <Phone size={18} color="#64748b" style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    type="tel"
                    placeholder="221 661-5746"
                    value={formData.celular}
                    onChange={(e) => setFormData(prev => ({ ...prev, celular: formatCelularArg(e.target.value) }))}
                    style={{ width: '100%', padding: '0.75rem 0.9rem 0.75rem 2.6rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.65rem', color: '#fff', fontSize: '0.95rem', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                if (!formData.nombre.trim()) {
                  Swal.fire('Falta Nombre', 'Por favor ingresa tu nombre para continuar.', 'warning');
                  return;
                }
                setStep(2);
              }}
              style={{ width: '100%', padding: '0.85rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.75rem', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              Continuar <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* PASO 2: MERCADERÍA */}
        {step === 2 && (
          <div>
            <div style={{ marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#f8fafc', margin: '0 0 0.35rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Package size={20} color="#38bdf8" /> ¿Qué producto vas a devolver?
              </h2>
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>
                Busca el artículo en el catálogo o escribe su nombre descriptivo.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', marginBottom: '1.5rem' }}>
              
              {/* Buscador de Producto */}
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#94a3b8', marginBottom: '0.35rem' }}>
                  Producto / Mercadería <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="Buscar ej: Mix Semillas, Almendra..."
                  value={searchCatalogo}
                  onChange={(e) => {
                    setSearchCatalogo(e.target.value);
                    setFormData(prev => ({ ...prev, descripcionExterna: e.target.value }));
                    setShowCatalogoDropdown(true);
                  }}
                  onFocus={() => setShowCatalogoDropdown(true)}
                  style={{ width: '100%', padding: '0.75rem 0.9rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.65rem', color: '#fff', fontSize: '0.95rem', boxSizing: 'border-box' }}
                />

                {showCatalogoDropdown && catalogoFiltrado.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid #475569', borderRadius: '0.65rem', marginTop: '4px', maxHeight: '180px', overflowY: 'auto', zIndex: 100, boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
                    {catalogoFiltrado.slice(0, 10).map((prod, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          setSearchCatalogo(prod.producto_descripcion);
                          setFormData(prev => ({ ...prev, descripcionExterna: prod.producto_descripcion }));
                          setShowCatalogoDropdown(false);
                        }}
                        style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid #334155', cursor: 'pointer', fontSize: '0.9rem', color: '#f8fafc', transition: 'background 0.15s' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#334155'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        {prod.producto_descripcion}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bultos Físicos y Kilos */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#94a3b8', marginBottom: '0.35rem' }}>
                    Bultos (Bolsas/Cajas)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.65rem', overflow: 'hidden' }}>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, bultos: String(Math.max(1, parseInt(prev.bultos || '1', 10) - 1)) }))}
                      style={{ padding: '0.75rem 0.85rem', background: '#334155', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={formData.bultos}
                      onChange={(e) => setFormData(prev => ({ ...prev, bultos: e.target.value }))}
                      style={{ width: '100%', textAlign: 'center', background: 'transparent', border: 'none', color: '#fff', fontSize: '1rem', fontWeight: 'bold', outline: 'none' }}
                    />
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, bultos: String(parseInt(prev.bultos || '1', 10) + 1) }))}
                      style={{ padding: '0.75rem 0.85rem', background: '#334155', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      +
                    </button>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#94a3b8', marginBottom: '0.35rem' }}>
                    Kilos aprox. <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="Ej: 3.5"
                    value={formData.kilos}
                    onChange={(e) => setFormData(prev => ({ ...prev, kilos: e.target.value }))}
                    style={{ width: '100%', padding: '0.75rem 0.9rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.65rem', color: '#fff', fontSize: '0.95rem', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setStep(1)}
                style={{ flex: 1, padding: '0.85rem', background: '#334155', color: '#f8fafc', border: 'none', borderRadius: '0.75rem', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              >
                <ArrowLeft size={16} /> Atrás
              </button>
              <button
                onClick={() => {
                  if (!formData.descripcionExterna.trim()) {
                    Swal.fire('Falta Producto', 'Indica qué mercadería vas a devolver.', 'warning');
                    return;
                  }
                  if (!formData.kilos || parseFloat(formData.kilos) <= 0) {
                    Swal.fire('Falta Peso', 'Ingresa los kilos aproximados.', 'warning');
                    return;
                  }
                  setStep(3);
                }}
                style={{ flex: 2, padding: '0.85rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.75rem', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              >
                Continuar <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* PASO 3: MOTIVO & CONFIRMAR */}
        {step === 3 && (
          <div>
            <div style={{ marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#f8fafc', margin: '0 0 0.35rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={20} color="#38bdf8" /> Motivo del Retiro
              </h2>
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>
                Selecciona la causa principal para que el taller prepare el tratamiento adecuado.
              </p>
            </div>

            {/* Chips de Motivos */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' }}>
              {MOTIVOS_FRECUENTES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, motivo: m.valor }))}
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: '2rem',
                    border: '1px solid',
                    borderColor: formData.motivo === m.valor ? '#38bdf8' : '#334155',
                    background: formData.motivo === m.valor ? 'rgba(56, 189, 248, 0.2)' : '#0f172a',
                    color: formData.motivo === m.valor ? '#38bdf8' : '#94a3b8',
                    fontSize: '0.8rem',
                    fontWeight: formData.motivo === m.valor ? 'bold' : 'normal',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Resumen Final */}
            <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '0.75rem', padding: '1rem', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
              <div style={{ fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                Confirmación de Datos
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div>👤 <strong>{formData.nombre} {formData.apellido}</strong> ({formData.celular || 'Sin cel'})</div>
                <div>📦 <strong>{formData.descripcionExterna}</strong></div>
                <div>⚖️ <strong>{formData.bultos} bulto(s) • {formData.kilos} kg</strong></div>
                <div>🏷️ Motivo: <strong style={{ color: '#38bdf8' }}>{formData.motivo || 'Excedente de pedido'}</strong></div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setStep(2)}
                disabled={submitting}
                style={{ flex: 1, padding: '0.85rem', background: '#334155', color: '#f8fafc', border: 'none', borderRadius: '0.75rem', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              >
                <ArrowLeft size={16} /> Atrás
              </button>
              <button
                onClick={handleConfirmarCheckin}
                disabled={submitting}
                style={{ flex: 2, padding: '0.85rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '0.75rem', fontWeight: 'bold', fontSize: '1rem', cursor: submitting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.4)' }}
              >
                {submitting ? 'Guardando...' : 'Confirmar Check-in ✅'}
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
