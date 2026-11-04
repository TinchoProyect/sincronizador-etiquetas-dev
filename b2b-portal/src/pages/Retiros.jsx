import React, { useState, useEffect, useMemo } from 'react';
import { Truck, Loader2, AlertCircle, FileText, CheckCircle, Clock, Calendar, User, Phone, Clipboard, ArrowRight, ArrowLeft, Search, Plus, Minus, Check, Package, Scale, HelpCircle, Trash2, X, Share2, Copy, Send } from 'lucide-react';
import { supabase } from '../supabaseClient';
import Swal from 'sweetalert2';

// Formateador de Celular en Argentina (ej: 221 661-5746 o 11 2345-6789)
const formatCelularArg = (raw) => {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  
  if (digits.startsWith('11')) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 2)} ${digits.slice(2)}`;
    return `${digits.slice(0, 2)} ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

// Extractor y formateador limpio del nombre del titular evitando términos genéricos como "Cliente B2B"
const obtenerNombreTitularLimpio = (prof) => {
  if (!prof) return null;
  
  let cand = prof.nombre_completo || '';
  const esGenerico = !cand || /cliente(\s+b2b|\s+portal)?/i.test(cand) || cand.trim().toUpperCase() === 'B2B' || cand.trim().toUpperCase() === 'CLIENTE';
  
  if (esGenerico && prof.nombre_empresa && !/cliente/i.test(prof.nombre_empresa)) {
    cand = prof.nombre_empresa;
  }
  
  if (!cand || /cliente(\s+b2b|\s+portal)?/i.test(cand) || cand.trim().toUpperCase() === 'B2B') {
    return null;
  }
  
  const cap = (s) => s.toLowerCase().split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  // Formato "APELLIDO, NOMBRE"
  if (cand.includes(',')) {
    const parts = cand.split(',');
    if (parts.length === 2) {
      const apellido = cap(parts[0].trim());
      const nombre = cap(parts[1].trim());
      return {
        nombre: nombre,
        apellido: apellido,
        nombreCompleto: `${nombre} ${apellido}`
      };
    }
  }

  const words = cand.trim().split(/\s+/);
  if (words.length === 1) {
    return { nombre: cap(words[0]), apellido: '', nombreCompleto: cap(words[0]) };
  }
  return {
    nombre: cap(words.slice(0, -1).join(' ')),
    apellido: cap(words[words.length - 1]),
    nombreCompleto: cap(cand.trim())
  };
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

export default function Retiros({ profile }) {
  const [retiros, setRetiros] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Estado para el modal de Check-in (Wizard Asistido de 3 Pasos)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRetiro, setSelectedRetiro] = useState(null);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  
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
    if (profile) {
      fetchRetiros();
      fetchCatalogo();
    }
  }, [profile]);

  const fetchRetiros = async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('clientes_b2b_retiros')
        .select('*');

      if (profile?.cliente_id) {
        query = query.eq('cliente_id', profile.cliente_id);
      }

      const { data, error: fetchError } = await query
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
      // 🚀 Corrección de nombres de columnas y limpieza de presentaciones
      const { data, error: catError } = await supabase
        .from('clientes_b2b_catalogo_precios')
        .select('producto_codigo, producto_descripcion')
        .order('producto_descripcion', { ascending: true });
        
      if (!catError && data) {
        const unique = [];
        const seen = new Set();
        for (const item of data) {
          const rawDesc = (item.producto_descripcion || '').trim();
          const cleanDesc = limpiarDescripcionProducto(rawDesc);
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
      console.warn('Error al cargar catálogo para autocompletado:', err.message);
    }
  };

  // Extraer lista única de responsables frecuentes conocidos
  const responsablesFrecuentes = useMemo(() => {
    const map = new Map();
    
    // 1. Datos limpios del titular
    const titular = obtenerNombreTitularLimpio(profile);
    if (titular) {
      const key = `${titular.nombre.toLowerCase()}_${titular.apellido.toLowerCase()}`;
      map.set(key, {
        nombre: titular.nombre,
        apellido: titular.apellido,
        celular: formatCelularArg(profile?.celular || profile?.telefono || ''),
        label: `${titular.nombreCompleto} (Titular)`
      });
    }

    // 2. Historial de retiros anteriores
    (retiros || []).forEach(r => {
      const nom = (r.responsable_nombre || '').trim();
      const ape = (r.responsable_apellido || '').trim();
      if (nom && !/cliente(\s+b2b)?/i.test(nom)) {
        const key = `${nom.toLowerCase()}_${ape.toLowerCase()}`;
        if (!map.has(key)) {
          map.set(key, {
            nombre: nom,
            apellido: ape,
            celular: formatCelularArg(r.responsable_celular || ''),
            label: ape ? `${nom} ${ape}` : nom
          });
        } else if (r.responsable_celular && !map.get(key).celular) {
          map.get(key).celular = formatCelularArg(r.responsable_celular);
        }
      }
    });

    return Array.from(map.values());
  }, [profile, retiros]);

  const handleOpenCheckin = (retiro) => {
    setSelectedRetiro(retiro);
    setStep(1);
    const initialDesc = retiro.descripcion_externa || '';
    setSearchCatalogo(initialDesc);
    setShowCatalogoDropdown(false);
    
    // Si no hay responsable previo en el ticket, intentar sugerir el titular limpio
    const titular = obtenerNombreTitularLimpio(profile);
    const nombreInicial = retiro.responsable_nombre || titular?.nombre || '';
    const apellidoInicial = retiro.responsable_apellido || (retiro.responsable_nombre ? '' : titular?.apellido || '');

    setFormData({
      nombre: /cliente(\s+b2b)?/i.test(nombreInicial) ? '' : nombreInicial,
      apellido: /cliente(\s+b2b)?/i.test(apellidoInicial) ? '' : apellidoInicial,
      celular: formatCelularArg(retiro.responsable_celular || ''),
      descripcionExterna: initialDesc,
      kilos: retiro.kilos !== null && retiro.kilos !== undefined ? String(retiro.kilos) : '',
      bultos: retiro.bultos !== null && retiro.bultos !== undefined ? String(retiro.bultos) : '1',
      motivo: retiro.motivo || ''
    });
    setIsModalOpen(true);
  };

  const handleCloseCheckin = () => {
    setIsModalOpen(false);
    setSelectedRetiro(null);
    setStep(1);
    setShowCatalogoDropdown(false);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name === 'celular') {
      setFormData(prev => ({
        ...prev,
        celular: formatCelularArg(value)
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleSelectResponsableChip = (resp) => {
    setFormData(prev => ({
      ...prev,
      nombre: resp.nombre,
      apellido: resp.apellido,
      celular: resp.celular || prev.celular
    }));
  };

  // Delegar Check-in a colaborador por WhatsApp
  const handleDelegarWhatsApp = (retiro) => {
    const origin = window.location.origin;
    const checkinUrl = `${origin}/#/checkin/${retiro.codigo_qr_hash}`;
    const textoMensaje = `¡Hola! Te comparto el link para completar el check-in del retiro *#${retiro.id}* de LAMDA.\n\nPor favor ingresá acá para cargar los datos antes de que pase el chofer:\n${checkinUrl}\n\n¡Muchas gracias!`;
    
    try {
      navigator.clipboard.writeText(checkinUrl);
    } catch {}

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(textoMensaje)}`;
    window.open(whatsappUrl, '_blank');
  };

  // Copiar link de check-in al portapapeles
  const handleCopiarEnlace = (retiro) => {
    const origin = window.location.origin;
    const checkinUrl = `${origin}/#/checkin/${retiro.codigo_qr_hash}`;
    navigator.clipboard.writeText(checkinUrl);
    Swal.fire({
      icon: 'success',
      title: '¡Enlace copiado!',
      text: 'El link para completar el check-in fue copiado al portapapeles. Puedes enviarlo por cualquier medio.',
      timer: 2500,
      showConfirmButton: false,
      toast: true,
      position: 'top-end'
    });
  };

  const handleBultosDelta = (delta) => {
    const current = parseInt(formData.bultos || '1', 10);
    const nextVal = Math.max(1, isNaN(current) ? 1 : current + delta);
    setFormData(prev => ({ ...prev, bultos: String(nextVal) }));
  };

  const handleSelectProductoCatalogo = (desc) => {
    setSearchCatalogo(desc);
    setFormData(prev => ({ ...prev, descripcionExterna: desc }));
    setShowCatalogoDropdown(false);
  };

  const handleSelectMotivoChip = (motivoTexto) => {
    setFormData(prev => ({ ...prev, motivo: motivoTexto }));
  };

  // Anular / Cancelar un retiro pendiente
  const handleCancelarRetiro = async (retiro) => {
    const result = await Swal.fire({
      title: `¿Anular Retiro #${retiro.id}?`,
      text: 'Esta solicitud quedará anulada y no será retirada por el chofer.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Sí, anular retiro',
      cancelButtonText: 'Mantener solicitud'
    });

    if (result.isConfirmed) {
      try {
        const { error: cancelError } = await supabase
          .from('clientes_b2b_retiros')
          .update({
            estado_logistico: 'CANCELADO',
            sincronizado_local: false
          })
          .eq('id', retiro.id);

        if (cancelError) throw cancelError;

        Swal.fire({
          icon: 'success',
          title: 'Retiro Anulado',
          text: `La solicitud #${retiro.id} fue anulada correctamente.`,
          timer: 2500,
          showConfirmButton: false
        });

        fetchRetiros();
      } catch (err) {
        console.error('Error al anular retiro:', err.message);
        Swal.fire('Error', err.message || 'No se pudo anular la solicitud.', 'error');
      }
    }
  };

  // Validaciones y avance de pasos
  const handleNextStep = () => {
    if (step === 1) {
      if (!formData.nombre.trim()) {
        Swal.fire('Atención', 'Por favor ingrese el nombre del responsable que entrega la mercadería.', 'warning');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!formData.descripcionExterna.trim()) {
        Swal.fire('Atención', 'Por favor indique qué producto o mercadería se va a retirar.', 'warning');
        return;
      }
      const parsedKilos = parseFloat(String(formData.kilos).replace(',', '.'));
      if (isNaN(parsedKilos) || parsedKilos <= 0) {
        Swal.fire('Atención', 'Por favor ingrese los kilos estimados (debe ser mayor a 0).', 'warning');
        return;
      }
      const parsedBultos = parseInt(formData.bultos, 10);
      if (isNaN(parsedBultos) || parsedBultos < 1) {
        Swal.fire('Atención', 'La cantidad de bultos (cajas/bolsas) debe ser al menos 1.', 'warning');
        return;
      }
      setStep(3);
    }
  };

  const handlePrevStep = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleSubmitCheckin = async (e) => {
    if (e) e.preventDefault();
    
    if (!formData.nombre || !formData.kilos || !formData.bultos || !formData.descripcionExterna) {
      Swal.fire('Atención', 'Por favor complete todos los datos requeridos antes de confirmar.', 'warning');
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

      const esModificacion = selectedRetiro.estado_logistico === 'PENDIENTE_VALIDACION';

      const { error: updateError } = await supabase
        .from('clientes_b2b_retiros')
        .update({
          responsable_nombre: formData.nombre.trim(),
          responsable_apellido: formData.apellido ? formData.apellido.trim() : null,
          responsable_celular: formData.celular ? formData.celular.trim() : null,
          articulo_numero: null,
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
        title: esModificacion ? '✅ Check-in Actualizado' : '✅ Check-in Completado',
        text: esModificacion 
          ? 'Los datos de la devolución fueron actualizados y sincronizados con logística.' 
          : 'Los datos del retiro se registraron con éxito. El chofer validará estas cantidades al llegar.',
        timer: 3500,
        showConfirmButton: true,
        confirmButtonColor: '#d97706'
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
        return <span style={{ background: '#dcfce7', color: '#16a34a', padding: '4px 10px', borderRadius: '20px', fontSize: '0.8em', fontWeight: 'bold' }}>✅ Recibido por chofer</span>;
      case 'CANCELADO':
        return <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', padding: '4px 10px', borderRadius: '20px', fontSize: '0.8em', fontWeight: 'bold' }}>🚫 Anulado</span>;
      default:
        return <span style={{ background: '#e2e8f0', color: '#475569', padding: '4px 10px', borderRadius: '20px', fontSize: '0.8em', fontWeight: 'bold' }}>{status}</span>;
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/D';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' hs';
  };

  // Filtrado de sugerencias de catálogo
  const filteredCatalogo = searchCatalogo.trim().length > 0
    ? catalogo.filter(item => 
        (item.producto_descripcion || '').toLowerCase().includes(searchCatalogo.toLowerCase())
      ).slice(0, 8)
    : [];

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
      
      {/* Header Principal */}
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

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  
                  {/* Botón Delegar por WhatsApp */}
                  <button 
                    onClick={() => handleDelegarWhatsApp(retiro)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.65rem 1rem',
                      borderRadius: '8px',
                      background: 'rgba(37, 211, 102, 0.12)',
                      color: '#25D366',
                      border: '1px solid rgba(37, 211, 102, 0.3)',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(37, 211, 102, 0.22)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(37, 211, 102, 0.12)'}
                    title="Enviar enlace por WhatsApp a un encargado o colaborador"
                  >
                    <Send size={15} /> Delegar por WhatsApp
                  </button>

                  {/* Botón Copiar Link */}
                  <button 
                    onClick={() => handleCopiarEnlace(retiro)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      background: 'var(--bg-glass)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-glass)',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-glass)'}
                    title="Copiar enlace directo al portapapeles"
                  >
                    <Copy size={15} /> Copiar Link
                  </button>

                  {/* Botón Anular */}
                  <button 
                    onClick={() => handleCancelarRetiro(retiro)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#ef4444',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                    title="Anular solicitud si ya no se va a retirar"
                  >
                    <Trash2 size={15} /> Anular
                  </button>

                  {/* Botón Principal: Realizar Check-in */}
                  <button 
                    onClick={() => handleOpenCheckin(retiro)}
                    className="btn-primary"
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem', 
                      padding: '0.75rem 1.25rem', 
                      borderRadius: '8px', 
                      background: 'linear-gradient(to right, #d97706, #b45309)',
                      border: 'none',
                      fontWeight: 'bold',
                      fontSize: '0.92rem',
                      boxShadow: '0 4px 10px rgba(217, 119, 6, 0.2)'
                    }}
                  >
                    Realizar Check-in <ArrowRight size={17} />
                  </button>
                </div>
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
                  gap: '1rem',
                  opacity: retiro.estado_logistico === 'CANCELADO' ? 0.6 : 1
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)' }}>Retiro #{retiro.id}</span>
                    {getStatusBadge(retiro.estado_logistico)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {retiro.estado_logistico === 'PENDIENTE_VALIDACION' && (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleCancelarRetiro(retiro)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            padding: '0.4rem 0.75rem',
                            borderRadius: '6px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: '#ef4444',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            cursor: 'pointer'
                          }}
                        >
                          <Trash2 size={13} /> Anular
                        </button>
                        <button
                          onClick={() => handleOpenCheckin(retiro)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            padding: '0.45rem 1rem',
                            borderRadius: '8px',
                            background: 'rgba(217, 119, 6, 0.15)',
                            color: '#f59e0b',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            fontSize: '0.85rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(217, 119, 6, 0.25)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(217, 119, 6, 0.15)'}
                        >
                          ✏️ Modificar Datos
                        </button>
                      </div>
                    )}
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Calendar size={14} /> {formatDate(retiro.fecha_creacion)}
                    </span>
                  </div>
                </div>

                {retiro.estado_logistico !== 'CANCELADO' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '0.3rem' }}>📦 Detalle Declarado</div>
                      <div style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: '600' }}>{retiro.descripcion_externa || 'N/D'}</div>
                      <div style={{ fontSize: '0.85rem', color: '#f59e0b', marginTop: '0.2rem', fontWeight: '500' }}>
                        {retiro.bultos} bulto(s) • {retiro.kilos} kg
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
                          <Phone size={12} /> {formatCelularArg(retiro.responsable_celular)}
                        </div>
                      )}
                    </div>
                    {retiro.chofer_nombre && (
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '0.3rem' }}>🚚 Recibido por chofer</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '600' }}>{retiro.chofer_nombre}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
                          <Clock size={12} /> {formatDate(retiro.fecha_validacion_chofer)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL WIZARD ASISTIDO: CHECK-IN EN 3 PASOS SECUENCIALES Y TÁCTILES      */}
      {/* ========================================================================= */}
      {isModalOpen && (
        <div 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            background: 'rgba(0,0,0,0.75)', 
            backdropFilter: 'blur(8px)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            zIndex: 1100, 
            padding: '1rem',
            overflowY: 'auto'
          }}
          onClick={(e) => { if (e.target === e.currentTarget) handleCloseCheckin(); }}
        >
          <div 
            style={{ 
              background: 'var(--bg-sidebar)', 
              border: '1px solid var(--border-glass)', 
              borderRadius: '18px', 
              maxWidth: '620px', 
              width: '100%', 
              maxHeight: 'min(94vh, 760px)',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 30px 70px rgba(0,0,0,0.7)', 
              overflow: 'hidden',
              margin: 'auto'
            }}
          >
            
            {/* 1. Header del Modal (Compacto para no restar espacio) */}
            <div style={{ padding: '0.75rem 1.25rem', background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.05rem', fontWeight: '800', fontFamily: 'Outfit' }}>
                  📋 Check-in Retiro #{selectedRetiro?.id}
                </span>
                <span style={{ fontSize: '0.75rem', background: 'rgba(0,0,0,0.2)', padding: '2px 8px', borderRadius: '10px', fontWeight: '600' }}>
                  {selectedRetiro?.estado_logistico === 'PENDIENTE_VALIDACION' ? 'Modificación' : 'Nuevo'}
                </span>
              </div>
              <button 
                onClick={handleCloseCheckin} 
                style={{ background: 'rgba(0,0,0,0.15)', border: 'none', color: 'white', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1, padding: '0.35rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                aria-label="Cerrar modal"
              >
                <X size={16} />
              </button>
            </div>

            {/* 2. Barra de Progreso del Stepper (3 Pasos) */}
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.65rem 1.25rem', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div 
                onClick={() => setStep(1)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', opacity: step === 1 ? 1 : 0.6, transition: 'all 0.2s' }}
              >
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: step >= 1 ? '#d97706' : 'rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  {step > 1 ? <Check size={13} /> : '1'}
                </div>
                <span style={{ fontSize: '0.8rem', fontWeight: step === 1 ? '700' : '500', color: step === 1 ? '#fcd34d' : 'var(--text-muted)' }}>Responsable</span>
              </div>

              <div style={{ flex: 1, height: '2px', background: step >= 2 ? '#d97706' : 'var(--border-glass)', margin: '0 0.5rem' }} />

              <div 
                onClick={() => { if (formData.nombre.trim()) setStep(2); }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: formData.nombre.trim() ? 'pointer' : 'default', opacity: step === 2 ? 1 : 0.6, transition: 'all 0.2s' }}
              >
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: step >= 2 ? '#d97706' : 'rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  {step > 2 ? <Check size={13} /> : '2'}
                </div>
                <span style={{ fontSize: '0.8rem', fontWeight: step === 2 ? '700' : '500', color: step === 2 ? '#fcd34d' : 'var(--text-muted)' }}>Mercadería</span>
              </div>

              <div style={{ flex: 1, height: '2px', background: step >= 3 ? '#d97706' : 'var(--border-glass)', margin: '0 0.5rem' }} />

              <div 
                onClick={() => { if (formData.nombre.trim() && formData.descripcionExterna.trim() && formData.kilos) setStep(3); }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: (formData.nombre.trim() && formData.descripcionExterna.trim() && formData.kilos) ? 'pointer' : 'default', opacity: step === 3 ? 1 : 0.6, transition: 'all 0.2s' }}
              >
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: step === 3 ? '#d97706' : 'rgba(255,255,255,0.1)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  3
                </div>
                <span style={{ fontSize: '0.8rem', fontWeight: step === 3 ? '700' : '500', color: step === 3 ? '#fcd34d' : 'var(--text-muted)' }}>Confirmar</span>
              </div>
            </div>

            {/* 3. Cuerpo del Asistente (Scrollable) */}
            <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              
              {/* ========================================================================= */}
              {/* PASO 1: RESPONSABLE DE ENTREGA                                            */}
              {/* ========================================================================= */}
              {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem', animation: 'fadeIn 0.25s ease' }}>
                  <div>
                    <h4 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)', margin: '0 0 0.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <User size={18} style={{ color: '#d97706' }} /> ¿Quién entrega la mercadería?
                    </h4>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                      Indique el nombre de la persona que estará presente para entregar la mercadería al chofer.
                    </p>
                  </div>

                  {/* Chips de Responsables Habituales / Titular */}
                  {responsablesFrecuentes.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        ⚡ Seleccionar contacto rápido:
                      </span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                        {responsablesFrecuentes.map((resp, idx) => {
                          const isCurrent = formData.nombre.toLowerCase() === resp.nombre.toLowerCase();
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleSelectResponsableChip(resp)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                background: isCurrent ? 'linear-gradient(135deg, #d97706, #b45309)' : 'rgba(217, 119, 6, 0.1)',
                                border: isCurrent ? '1px solid #f59e0b' : '1px solid rgba(245, 158, 11, 0.3)',
                                borderRadius: '16px',
                                padding: '0.45rem 0.85rem',
                                color: isCurrent ? 'white' : '#fcd34d',
                                fontSize: '0.85rem',
                                fontWeight: isCurrent ? '700' : '600',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <span>👤 {resp.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Campos de Nombre, Apellido y Celular */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                        Nombre Responsable *
                      </label>
                      <input 
                        type="text" 
                        name="nombre" 
                        placeholder="Ej: Martín"
                        value={formData.nombre} 
                        onChange={handleInputChange}
                        className="form-control" 
                        required 
                        style={{ width: '100%', padding: '0.75rem 0.9rem', fontSize: '0.95rem', borderRadius: '10px', boxSizing: 'border-box' }}
                        autoFocus
                      />
                    </div>
                    
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                        Apellido Responsable
                      </label>
                      <input 
                        type="text" 
                        name="apellido" 
                        placeholder="Ej: Serrano"
                        value={formData.apellido} 
                        onChange={handleInputChange}
                        className="form-control" 
                        style={{ width: '100%', padding: '0.75rem 0.9rem', fontSize: '0.95rem', borderRadius: '10px', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                      Celular / Teléfono (con código de área)
                    </label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input 
                        type="tel" 
                        name="celular" 
                        placeholder="Ej: 221 661-5746"
                        value={formData.celular} 
                        onChange={handleInputChange}
                        className="form-control" 
                        style={{ width: '100%', padding: '0.75rem 0.9rem 0.75rem 2.4rem', fontSize: '0.95rem', borderRadius: '10px', boxSizing: 'border-box' }}
                      />
                      <Phone size={16} style={{ position: 'absolute', left: '0.85rem', color: 'var(--text-muted)' }} />
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                      Formato automático: código de área + número (ej: 221 661-5746)
                    </span>
                  </div>
                </div>
              )}

              {/* ========================================================================= */}
              {/* PASO 2: MERCADERÍA, BULTOS Y KILOS                                       */}
              {/* ========================================================================= */}
              {step === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem', animation: 'fadeIn 0.25s ease' }}>
                  <div>
                    <h4 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)', margin: '0 0 0.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Package size={18} style={{ color: '#d97706' }} /> Mercadería a Retirar
                    </h4>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                      Indique el producto y diferencie claramente entre cantidad de bultos y el peso total.
                    </p>
                  </div>

                  {/* Buscador / Selector Inteligente de Producto */}
                  <div style={{ position: 'relative' }}>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                      Descripción del Producto *
                    </label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input 
                        type="text" 
                        placeholder="Escriba o busque el producto (ej: Semillas, Mix, Almendras...)"
                        value={searchCatalogo} 
                        onChange={(e) => {
                          setSearchCatalogo(e.target.value);
                          setFormData(prev => ({ ...prev, descripcionExterna: e.target.value }));
                          setShowCatalogoDropdown(true);
                        }}
                        onFocus={() => setShowCatalogoDropdown(true)}
                        className="form-control" 
                        required 
                        style={{ width: '100%', padding: '0.75rem 0.9rem 0.75rem 2.4rem', fontSize: '0.95rem', borderRadius: '10px', boxSizing: 'border-box' }}
                        autoFocus
                      />
                      <Search size={16} style={{ position: 'absolute', left: '0.85rem', color: 'var(--text-muted)' }} />
                    </div>

                    {/* Desplegable de Sugerencias del Catálogo */}
                    {showCatalogoDropdown && filteredCatalogo.length > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'hsl(222, 47%, 11%)',
                        border: '1px solid var(--border-glass)',
                        borderRadius: '10px',
                        marginTop: '0.35rem',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.7)',
                        zIndex: 100,
                        maxHeight: '220px',
                        overflowY: 'auto'
                      }}>
                        <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-glass)', fontWeight: 'bold' }}>
                          💡 Sugerencias del Catálogo (Toque para seleccionar):
                        </div>
                        {filteredCatalogo.map((cat, idx) => (
                          <div 
                            key={idx}
                            onClick={() => handleSelectProductoCatalogo(cat.producto_descripcion)}
                            style={{
                              padding: '0.65rem 0.85rem',
                              borderBottom: '1px solid rgba(255,255,255,0.04)',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                              color: 'var(--text-primary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              transition: 'background 0.15s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(217, 119, 6, 0.15)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <span>{cat.producto_descripcion}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: '600' }}>Seleccionar ➔</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* CONTROLES TÁCTILES DIFERENCIADOS: BULTOS VS KILOS */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', marginTop: '0.25rem' }}>
                    
                    {/* Tarjeta A: BULTOS (Cajas / Bolsas) */}
                    <div style={{ background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: '800', color: '#fcd34d', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Package size={16} /> 1. Bultos Físicos *
                      </span>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.3 }}>
                        ¿Cuántas <strong>cajas, bolsas o paquetes</strong> cerrados entrega?
                      </p>

                      {/* Control táctil + / - */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.65rem', marginTop: '0.35rem' }}>
                        <button
                          type="button"
                          onClick={() => handleBultosDelta(-1)}
                          style={{
                            width: '42px',
                            height: '42px',
                            borderRadius: '10px',
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid var(--border-glass)',
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                          }}
                        >
                          <Minus size={18} />
                        </button>
                        
                        <input 
                          type="number" 
                          name="bultos" 
                          min="1" 
                          step="1"
                          value={formData.bultos} 
                          onChange={handleInputChange}
                          className="form-control" 
                          required 
                          style={{ width: '75px', height: '42px', textAlign: 'center', fontSize: '1.2rem', fontWeight: '800', borderRadius: '10px', color: '#fcd34d' }}
                        />

                        <button
                          type="button"
                          onClick={() => handleBultosDelta(1)}
                          style={{
                            width: '42px',
                            height: '42px',
                            borderRadius: '10px',
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid var(--border-glass)',
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                          }}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                    </div>

                    {/* Tarjeta B: KILOS TOTALES */}
                    <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: '800', color: '#93c5fd', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Scale size={16} /> 2. Kilos Totales *
                      </span>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.3 }}>
                        ¿Cuánto <strong>pesa en total</strong> toda la mercadería a retirar?
                      </p>

                      {/* Input de peso táctil */}
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginTop: '0.35rem' }}>
                        <input 
                          type="text" 
                          inputMode="decimal"
                          name="kilos" 
                          placeholder="Ej: 5.0"
                          value={formData.kilos} 
                          onChange={handleInputChange}
                          className="form-control" 
                          required 
                          style={{ width: '100%', height: '42px', padding: '0.5rem 3.2rem 0.5rem 1rem', fontSize: '1.2rem', fontWeight: '800', borderRadius: '10px', color: '#93c5fd', boxSizing: 'border-box' }}
                        />
                        <span style={{ position: 'absolute', right: '0.85rem', fontWeight: '800', color: '#60a5fa', fontSize: '0.95rem' }}>
                          KG
                        </span>
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* ========================================================================= */}
              {/* PASO 3: MOTIVO Y RESUMEN FINAL                                            */}
              {/* ========================================================================= */}
              {step === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem', animation: 'fadeIn 0.25s ease' }}>
                  <div>
                    <h4 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)', margin: '0 0 0.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <HelpCircle size={18} style={{ color: '#d97706' }} /> Motivo de la Devolución
                    </h4>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                      Seleccione una causa para que el taller prepare el tratamiento correspondiente.
                    </p>
                  </div>

                  {/* Píldoras de Motivos Frecuentes (1 toque) */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                    {MOTIVOS_FRECUENTES.map(m => {
                      const isSelected = formData.motivo === m.valor;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleSelectMotivoChip(m.valor)}
                          style={{
                            padding: '0.5rem 0.85rem',
                            borderRadius: '20px',
                            background: isSelected ? 'linear-gradient(135deg, #d97706, #b45309)' : 'rgba(255,255,255,0.04)',
                            color: isSelected ? 'white' : 'var(--text-secondary)',
                            border: isSelected ? '1px solid #f59e0b' : '1px solid var(--border-glass)',
                            fontSize: '0.85rem',
                            fontWeight: isSelected ? '700' : '500',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.35rem'
                          }}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Campo de Detalle Adicional */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                      Detalle adicional u observación (opcional):
                    </label>
                    <input 
                      type="text" 
                      name="motivo" 
                      placeholder="Escriba otra observación o detalle..."
                      value={formData.motivo} 
                      onChange={handleInputChange}
                      className="form-control" 
                      style={{ width: '100%', padding: '0.75rem 0.9rem', fontSize: '0.9rem', borderRadius: '10px', boxSizing: 'border-box' }}
                    />
                  </div>

                  {/* TARJETA DE RESUMEN FINAL ("TICKET PREVIO") */}
                  <div style={{ 
                    background: 'linear-gradient(135deg, rgba(217, 119, 6, 0.08) 0%, rgba(142, 71, 133, 0.08) 100%)',
                    border: '1px solid rgba(245, 158, 11, 0.3)', 
                    borderRadius: '14px', 
                    padding: '1.1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.65rem'
                  }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: '800', color: '#fcd34d', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      📋 Resumen del Retiro a Confirmar
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.9rem' }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Mercadería:</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{formData.descripcionExterna || 'N/D'}</strong>
                      </div>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Cantidad Declarada:</span>
                        <strong style={{ color: '#fcd34d' }}>{formData.bultos} bulto(s) • {formData.kilos} kg</strong>
                      </div>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Responsable:</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{formData.nombre} {formData.apellido}</strong>
                      </div>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Motivo:</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{formData.motivo || 'General'}</strong>
                      </div>
                    </div>
                  </div>

                </div>
              )}

            </div>

            {/* 4. Footer Fijo con Botones Táctiles de Navegación */}
            <div style={{ padding: '0.85rem 1.25rem', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              {step > 1 ? (
                <button 
                  type="button" 
                  onClick={handlePrevStep} 
                  className="btn-secondary"
                  disabled={submitting}
                  style={{ 
                    padding: '0.6rem 1.15rem', 
                    borderRadius: '10px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.4rem',
                    fontSize: '0.88rem',
                    fontWeight: '600'
                  }}
                >
                  <ArrowLeft size={15} /> Volver
                </button>
              ) : (
                <button 
                  type="button" 
                  onClick={handleCloseCheckin} 
                  className="btn-secondary"
                  disabled={submitting}
                  style={{ padding: '0.6rem 1.15rem', borderRadius: '10px', fontSize: '0.88rem' }}
                >
                  Cancelar
                </button>
              )}

              {step < 3 ? (
                <button 
                  type="button" 
                  onClick={handleNextStep} 
                  className="btn-primary"
                  style={{ 
                    padding: '0.65rem 1.6rem', 
                    borderRadius: '10px', 
                    background: 'linear-gradient(to right, #d97706, #b45309)',
                    border: 'none',
                    fontWeight: 'bold',
                    fontSize: '0.92rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 12px rgba(217, 119, 6, 0.3)'
                  }}
                >
                  Continuar <ArrowRight size={17} />
                </button>
              ) : (
                <button 
                  type="button" 
                  onClick={handleSubmitCheckin} 
                  className="btn-primary" 
                  disabled={submitting}
                  style={{ 
                    padding: '0.7rem 1.85rem', 
                    borderRadius: '10px', 
                    background: 'linear-gradient(to right, #16a34a, #15803d)',
                    border: 'none',
                    fontWeight: '800',
                    fontSize: '0.95rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 16px rgba(22, 163, 74, 0.35)'
                  }}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="spinner" size={16} /> Guardando...
                    </>
                  ) : (
                    '💾 Confirmar Check-in'
                  )}
                </button>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
