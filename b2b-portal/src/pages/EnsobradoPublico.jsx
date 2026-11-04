import React, { useState, useEffect } from 'react';
import { supabaseAnonimaPublica } from '../supabaseClient';
import { 
  Banknote, DollarSign, PackageCheck, Camera, Truck, Store, 
  CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft, Upload, 
  Trash2, Plus, Minus, Loader2, Check, User, Phone, FileText
} from 'lucide-react';
import Swal from 'sweetalert2';

// Denominaciones oficiales de billetes en Argentina
const DENOMINACIONES_BILLETES = [
  { valor: 20000, label: '$ 20.000', subtitulo: 'Alberdi' },
  { valor: 10000, label: '$ 10.000', subtitulo: 'Belgrano / Remedios' },
  { valor: 2000,  label: '$ 2.000',  subtitulo: 'Carrillo / Grierson' },
  { valor: 1000,  label: '$ 1.000',  subtitulo: 'Hornero / San Martín' },
  { valor: 500,   label: '$ 500',    subtitulo: 'Yaguareté' },
  { valor: 200,   label: '$ 200',    subtitulo: 'Ballena franca' },
  { valor: 100,   label: '$ 100',    subtitulo: 'Roca / Evita / Taruca' },
  { valor: 50,    label: '$ 50',     subtitulo: 'Cóndor / Malvinas' },
  { valor: 20,    label: '$ 20',     subtitulo: 'Guanaco' },
  { valor: 10,    label: '$ 10',     subtitulo: 'Manuel Belgrano' }
];

const WHATSAPP_EMPRESA = '5492216615746';

export default function EnsobradoPublico({ path }) {
  // Extraer token de la ruta (/ensobrado/:token o #ensobrado/:token o ?token=...)
  const extraerToken = () => {
    const hash = window.location.hash || '';
    const pathname = window.location.pathname || '';
    const search = window.location.search || '';
    const rawP = path || '';

    const params = new URLSearchParams(search);
    if (params.get('token')) return params.get('token').trim();

    // 1. Buscar en hash ej: #ensobrado/TOKEN o #/ensobrado/TOKEN
    const matchHash = (hash || '').match(/ensobrado[\/]+([a-zA-Z0-9_\-]+)/i);
    if (matchHash && matchHash[1]) return matchHash[1].trim();

    // 2. Buscar en pathname ej: /ensobrado/TOKEN
    const matchPath = (pathname || '').match(/ensobrado[\/]+([a-zA-Z0-9_\-]+)/i);
    if (matchPath && matchPath[1]) return matchPath[1].trim();

    // 3. Buscar en prop path
    const matchProp = (rawP || '').match(/ensobrado[\/]+([a-zA-Z0-9_\-]+)/i);
    if (matchProp && matchProp[1]) return matchProp[1].trim();

    // 4. Fallback: split
    const parts = (hash || pathname || rawP).split(/ensobrado[\/#]/i);
    if (parts.length > 1) {
      const candidate = parts[parts.length - 1].split('?')[0].split('/')[0].trim();
      if (candidate) return candidate;
    }

    return '';
  };

  const targetToken = extraerToken();

  const [loading, setLoading] = useState(true);
  const [sobre, setSobre] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Wizard de 4 Pasos
  const [step, setStep] = useState(1);
  const [montoDeclarado, setMontoDeclarado] = useState('');
  const [cantidadesBilletes, setCantidadesBilletes] = useState({});
  const [confirmEnsobrado, setConfirmEnsobrado] = useState(false);
  const [modalidadEntrega, setModalidadEntrega] = useState('CHOFER');
  const [nombreColaborador, setNombreColaborador] = useState('');
  const [observaciones, setObservaciones] = useState('');
  
  // Fotos
  const [fotoFrente, setFotoFrente] = useState(null);
  const [fotoFrentePreview, setFotoFrentePreview] = useState(null);
  const [fotoDorso, setFotoDorso] = useState(null);
  const [fotoDorsoPreview, setFotoDorsoPreview] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [completadoExitoso, setCompletadoExitoso] = useState(false);

  useEffect(() => {
    if (targetToken) {
      cargarSobrePorToken();
    } else {
      setLoading(false);
      setErrorMsg('No se proporcionó un enlace de derivación válido.');
    }
  }, [targetToken]);

  const cargarSobrePorToken = async () => {
    try {
      setLoading(true);
      setErrorMsg('');

      const { data, error } = await supabaseAnonimaPublica
        .from('clientes_b2b_pagos_efectivo')
        .select('*')
        .eq('token_publico', targetToken)
        .single();

      if (error || !data) {
        throw new Error('El enlace es inválido o el sobre ya no se encuentra disponible.');
      }

      setSobre(data);
      if (data.monto_declarado && parseFloat(data.monto_declarado) > 0) {
        setMontoDeclarado(data.monto_declarado.toString());
      }
      if (data.modalidad_entrega) {
        setModalidadEntrega(data.modalidad_entrega);
      }
      if (data.colaborador_nombre) {
        setNombreColaborador(data.colaborador_nombre);
      }

      if (data.estado !== 'PENDIENTE_ENSOBRADO') {
        if (data.estado === 'PREPARADO' || data.estado === 'ACREDITADO' || data.estado === 'EN_TRANSITO') {
          setCompletadoExitoso(true);
        } else {
          setErrorMsg(`Este sobre se encuentra en estado ${data.estado}.`);
        }
      }

    } catch (err) {
      console.error('Error al cargar sobre:', err);
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Cálculo de totales
  const calcularTotalBilletes = () => {
    return DENOMINACIONES_BILLETES.reduce((acc, curr) => {
      const cant = parseInt(cantidadesBilletes[curr.valor] || 0, 10);
      return acc + (cant * curr.valor);
    }, 0);
  };

  const totalBilletes = calcularTotalBilletes();
  const montoDeclaradoNum = parseFloat(montoDeclarado) || 0;
  const diferenciaArqueo = totalBilletes - montoDeclaradoNum;
  const arqueoExacto = montoDeclaradoNum > 0 && totalBilletes === montoDeclaradoNum;

  // Manejo de billetes con Bloqueo de Exceso
  const handleCantidadChange = (valor, cantidad) => {
    const cantIngresada = Math.max(0, parseInt(cantidad || 0, 10));
    const cantActual = cantidadesBilletes[valor] || 0;
    const subtotalSinEste = totalBilletes - (cantActual * valor);
    const espacioDisponible = montoDeclaradoNum - subtotalSinEste;
    const maxPermitido = Math.floor(Math.max(0, espacioDisponible) / valor);
    const cantFinal = Math.min(cantIngresada, maxPermitido);

    setCantidadesBilletes(prev => ({
      ...prev,
      [valor]: cantFinal
    }));
  };

  const incrementarBillete = (valor) => {
    const actual = cantidadesBilletes[valor] || 0;
    if (totalBilletes + valor > montoDeclaradoNum) return;
    setCantidadesBilletes(prev => ({
      ...prev,
      [valor]: actual + 1
    }));
  };

  const decrementarBillete = (valor) => {
    setCantidadesBilletes(prev => ({
      ...prev,
      [valor]: Math.max(0, (prev[valor] || 0) - 1)
    }));
  };

  // Manejo de fotos
  const handleFotoChange = (tipo, e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      Swal.fire('Formato Inválido', 'Por favor selecciona una imagen (JPG, PNG).', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      if (tipo === 'frente') {
        setFotoFrente(file);
        setFotoFrentePreview(reader.result);
      } else {
        setFotoDorso(file);
        setFotoDorsoPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // Subir imagen al Bucket público
  const uploadImageToStorage = async (file, pathSuffix) => {
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${sobre.cliente_id}/${sobre.codigo_sobre}_${pathSuffix}_${Date.now()}.${fileExt}`;
    
    const { data, error } = await supabaseAnonimaPublica.storage
      .from('sobres_efectivo')
      .upload(fileName, file, { cacheControl: '3600', upsert: true });

    if (error) throw error;

    const { data: publicUrlData } = supabaseAnonimaPublica.storage
      .from('sobres_efectivo')
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  };

  // Finalizar Ensobrado
  const handleFinalizar = async () => {
    if (!fotoFrente || !fotoDorso) {
      Swal.fire('Fotos Obligatorias', 'Debes cargar las fotografías de Frente y Dorso del sobre cerrado.', 'warning');
      return;
    }

    try {
      setSubiendo(true);

      const urlFrente = await uploadImageToStorage(fotoFrente, 'frente');
      const urlDorso = await uploadImageToStorage(fotoDorso, 'dorso');

      const notaCompleta = [
        observaciones.trim() ? `Nota: ${observaciones.trim()}` : null,
        nombreColaborador.trim() ? `Preparado por colaborador: ${nombreColaborador.trim()}` : null
      ].filter(Boolean).join(' | ');

      const { error } = await supabaseAnonimaPublica
        .from('clientes_b2b_pagos_efectivo')
        .update({
          monto_declarado: montoDeclaradoNum,
          desglose_billetes: cantidadesBilletes,
          foto_frente_url: urlFrente,
          foto_dorso_url: urlDorso,
          modalidad_entrega: modalidadEntrega,
          estado: 'PREPARADO',
          observaciones_cliente: notaCompleta || sobre.observaciones_cliente || null,
          colaborador_nombre: nombreColaborador.trim() || sobre.colaborador_nombre || 'Colaborador',
          sincronizado_local: false,
          updated_at: new Date().toISOString()
        })
        .eq('token_publico', targetToken);

      if (error) throw error;

      setCompletadoExitoso(true);

    } catch (err) {
      console.error('Error al completar ensobrado:', err);
      Swal.fire('Error', `No se pudo registrar el sobre: ${err.message}`, 'error');
    } finally {
      setSubiendo(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#ffffff', padding: '1rem' }}>
        <Loader2 className="spinner" size={36} style={{ color: '#8e4785', marginBottom: '1rem' }} />
        <p style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: '0.9rem' }}>Cargando asistente de ensobrado...</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#ffffff', padding: '1.5rem', textAlign: 'center' }}>
        <AlertTriangle size={48} style={{ color: '#ef4444', marginBottom: '1rem' }} />
        <h2 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '0.5rem' }}>No se pudo abrir el sobre</h2>
        <p style={{ color: '#94a3b8', fontSize: '0.88rem', maxWidth: '400px', marginBottom: '1.5rem' }}>{errorMsg}</p>
        <button
          onClick={() => window.location.href = '/'}
          style={{ background: '#8e4785', color: '#ffffff', border: 'none', padding: '0.65rem 1.25rem', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}
        >
          Ir al Inicio
        </button>
      </div>
    );
  }

  if (completadoExitoso) {
    const mensajeWA = encodeURIComponent(
      `📦 *AVISO DE ENSOBRADO (EFECTIVO)*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏷️ *Código de Sobre:* ${sobre.codigo_sobre}\n` +
      `🏢 *Cliente:* ${sobre.cliente_id}\n` +
      `💵 *Monto Declarado:* $ ${montoDeclaradoNum.toLocaleString('es-AR', { minimumFractionDigits: 2 })}\n` +
      `👤 *Preparado por:* ${nombreColaborador || 'Colaborador'}\n` +
      `📦 *Modalidad:* ${modalidadEntrega === 'CHOFER' ? 'Retiro por Chofer' : 'Entrega en Mostrador LAMDA'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `El sobre ya fue sellado y registrado correctamente.`
    );
    const urlWA = `https://api.whatsapp.com/send?phone=${WHATSAPP_EMPRESA}&text=${mensajeWA}`;

    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#ffffff', padding: '1.5rem', textAlign: 'center' }}>
        <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '2rem 1.5rem', maxWidth: '440px', width: '100%', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
          <CheckCircle2 size={54} style={{ color: '#16a34a', margin: '0 auto 1rem auto' }} />
          <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#ffffff', marginBottom: '0.35rem' }}>
            ¡Sobre Declarado Listo!
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            El paquete <strong style={{ color: '#e879f9' }}>{sobre.codigo_sobre}</strong> por <strong style={{ color: '#4ade80' }}>{formatCurrency(montoDeclaradoNum)}</strong> ha sido registrado con éxito.
          </p>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '10px', padding: '0.85rem', marginBottom: '1.5rem', textAlign: 'left', fontSize: '0.8rem' }}>
            <div><strong>Código:</strong> {sobre.codigo_sobre}</div>
            <div><strong>Modalidad:</strong> {modalidadEntrega === 'CHOFER' ? '🚚 Retiro por Chofer' : '🏬 Entrega en Mostrador'}</div>
            {nombreColaborador && <div><strong>Encargado:</strong> {nombreColaborador}</div>}
          </div>

          <button
            onClick={() => window.open(urlWA, '_blank')}
            style={{
              width: '100%',
              background: '#25D366',
              color: '#ffffff',
              border: 'none',
              padding: '0.85rem',
              borderRadius: '10px',
              fontWeight: '700',
              fontSize: '0.92rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 14px rgba(37, 211, 102, 0.4)'
            }}
          >
            📲 Enviar Aviso por WhatsApp
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#ffffff', padding: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      
      {/* Contenedor Principal */}
      <div style={{ maxWidth: '520px', width: '100%', paddingBottom: '2rem' }}>
        
        {/* Encabezado Institucional */}
        <div style={{ textAlign: 'center', marginBottom: '1rem', marginTop: '0.5rem' }}>
          <img src="/logo_LAMDA.png?v=4" alt="LAMDA" style={{ maxHeight: '42px', margin: '0 auto 0.5rem auto' }} />
          <h1 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
            <Banknote size={20} style={{ color: '#e879f9' }} /> Aviso de Ensobrado (Efectivo)
          </h1>
          <div style={{ display: 'inline-block', background: 'rgba(142, 71, 133, 0.25)', border: '1px solid #8e4785', borderRadius: '12px', padding: '0.2rem 0.65rem', color: '#ffffff', fontSize: '0.75rem', fontWeight: '700', marginTop: '0.35rem' }}>
            Sobre: {sobre.codigo_sobre} • Cliente {sobre.cliente_id}
          </div>
        </div>

        {/* Card Contenedor Asistente */}
        <div style={{ background: '#1e293b', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '1rem', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
          
          {/* Barra de Progreso */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '50%', left: '5%', right: '5%', height: '2px', background: 'rgba(255,255,255,0.1)', zIndex: 0, transform: 'translateY(-50%)' }} />
            {[
              { num: 1, label: 'Monto' },
              { num: 2, label: 'Billetes' },
              { num: 3, label: 'Sellado' },
              { num: 4, label: 'Fotos' }
            ].map((s) => {
              const isPassed = step > s.num;
              const isCurrent = step === s.num;
              return (
                <div key={s.num} style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                  <div style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: '700',
                    fontSize: '0.78rem',
                    background: isCurrent ? '#8e4785' : isPassed ? '#16a34a' : '#0f172a',
                    color: '#ffffff',
                    border: isCurrent ? '2px solid rgba(142, 71, 133, 0.5)' : isPassed ? '2px solid #16a34a' : '1px solid rgba(255,255,255,0.15)'
                  }}>
                    {isPassed ? '✓' : s.num}
                  </div>
                  <span style={{ fontSize: '0.68rem', fontWeight: isCurrent ? '700' : '500', color: isCurrent ? '#ffffff' : '#94a3b8' }}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* PASO 1: MONTO */}
          {step === 1 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#ffffff', marginBottom: '0.2rem' }}>
                  Monto a Colocar en el Sobre
                </h2>
                <p style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                  {sobre.derivado_por ? `Solicitado por ${sobre.derivado_por}.` : 'Ingresa el total en pesos a guardar en el sobre.'}
                </p>
              </div>

              <div style={{ maxWidth: '380px', margin: '0 auto 1.25rem auto' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#cbd5e1', marginBottom: '0.35rem' }}>
                  Importe Total ($ ARS):
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <DollarSign size={20} style={{ position: 'absolute', left: '0.75rem', color: '#8e4785' }} />
                  <input
                    type="number"
                    min="1"
                    placeholder="Ej: 50000"
                    value={montoDeclarado}
                    onChange={(e) => setMontoDeclarado(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.75rem 0.75rem 0.75rem 2.4rem',
                      fontSize: '1.2rem',
                      fontWeight: '700',
                      borderRadius: '8px',
                      background: 'rgba(0,0,0,0.3)',
                      border: '2px solid rgba(142, 71, 133, 0.6)',
                      color: '#ffffff',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.85rem' }}>
                <button
                  type="button"
                  disabled={montoDeclaradoNum <= 0}
                  onClick={() => setStep(2)}
                  style={{
                    background: montoDeclaradoNum > 0 ? '#8e4785' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.7rem 1.25rem',
                    borderRadius: '8px',
                    fontWeight: '700',
                    fontSize: '0.88rem',
                    cursor: montoDeclaradoNum > 0 ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  Continuar al Conteo <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* PASO 2: CONTEO DE BILLETES */}
          {step === 2 && (
            <div>
              {/* Header Fijo */}
              <div style={{
                position: 'sticky',
                top: '0',
                zIndex: 999,
                background: '#0f172a',
                border: arqueoExacto ? '2px solid #16a34a' : '2px solid #8e4785',
                borderRadius: '8px',
                padding: '0.65rem 0.8rem',
                marginBottom: '0.85rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <span style={{ fontSize: '0.62rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>
                    Declarado: <strong>{formatCurrency(montoDeclaradoNum)}</strong>
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Contado:</span>
                    <strong style={{ fontSize: '1.05rem', color: arqueoExacto ? '#4ade80' : '#ffffff' }}>
                      {formatCurrency(totalBilletes)}
                    </strong>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <strong style={{
                    fontSize: '0.88rem',
                    color: arqueoExacto ? '#4ade80' : (diferenciaArqueo < 0 ? '#facc15' : '#f87171'),
                    background: arqueoExacto ? 'rgba(22, 163, 74, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '5px',
                    display: 'inline-block'
                  }}>
                    {arqueoExacto ? '✓ Exacto ($ 0)' : (diferenciaArqueo < 0 ? `- ${formatCurrency(Math.abs(diferenciaArqueo))}` : `+ ${formatCurrency(diferenciaArqueo)}`)}
                  </strong>
                </div>
              </div>

              {/* Denominaciones */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '1.25rem' }}>
                {DENOMINACIONES_BILLETES.map((den) => {
                  const cant = cantidadesBilletes[den.valor] || 0;
                  const subtotalDen = cant * den.valor;
                  const puedeSumar = (totalBilletes + den.valor) <= montoDeclaradoNum;

                  return (
                    <div key={den.valor} style={{ background: cant > 0 ? 'rgba(142, 71, 133, 0.12)' : 'rgba(255,255,255,0.02)', border: cant > 0 ? '1px solid rgba(142, 71, 133, 0.5)' : '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '0.45rem 0.65rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                            <strong style={{ fontSize: '0.95rem', color: '#ffffff' }}>{den.label}</strong>
                            {subtotalDen > 0 && <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#4ade80' }}>= {formatCurrency(subtotalDen)}</span>}
                          </div>
                          <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>{den.subtitulo}</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <button
                            type="button"
                            disabled={cant === 0}
                            onClick={() => decrementarBillete(den.valor)}
                            style={{ width: '30px', height: '30px', borderRadius: '5px', background: cant > 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff', cursor: cant > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Minus size={13} />
                          </button>

                          <input
                            type="number"
                            min="0"
                            value={cant === 0 ? '' : cant}
                            placeholder="0"
                            onChange={(e) => handleCantidadChange(den.valor, e.target.value)}
                            style={{ width: '45px', textAlign: 'center', padding: '0.3rem 0.1rem', fontSize: '0.95rem', fontWeight: '700', borderRadius: '5px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff' }}
                          />

                          <button
                            type="button"
                            disabled={!puedeSumar}
                            onClick={() => incrementarBillete(den.valor)}
                            style={{ width: '30px', height: '30px', borderRadius: '5px', background: puedeSumar ? 'rgba(142, 71, 133, 0.4)' : 'rgba(255,255,255,0.03)', border: puedeSumar ? '1px solid #8e4785' : '1px solid rgba(255,255,255,0.08)', color: '#ffffff', cursor: puedeSumar ? 'pointer' : 'not-allowed', opacity: puedeSumar ? 1 : 0.35, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed rgba(255,255,255,0.06)', marginTop: '0.2rem', paddingTop: '0.15rem', fontSize: '0.68rem' }}>
                        {arqueoExacto ? (
                          <span style={{ color: '#4ade80', fontWeight: '700' }}>✅ Arqueo exacto</span>
                        ) : diferenciaArqueo < 0 ? (
                          <span style={{ color: '#facc15' }}>⚠️ Faltan: {formatCurrency(Math.abs(diferenciaArqueo))}</span>
                        ) : (
                          <span style={{ color: '#f87171' }}>🛑 Excedido: {formatCurrency(diferenciaArqueo)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.85rem' }}>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: '#94a3b8', padding: '0.55rem 0.85rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  <ArrowLeft size={13} /> Monto
                </button>

                <button
                  type="button"
                  disabled={!arqueoExacto}
                  onClick={() => setStep(3)}
                  style={{
                    background: arqueoExacto ? '#16a34a' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.65rem 1.15rem',
                    borderRadius: '6px',
                    fontWeight: '700',
                    fontSize: '0.85rem',
                    cursor: arqueoExacto ? 'pointer' : 'not-allowed'
                  }}
                >
                  Arqueo Exacto - Sellar <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* PASO 3: PROTOCOLO DE SELLADO */}
          {step === 3 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '0.85rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#ffffff', marginBottom: '0.2rem' }}>
                  Protocolo de Ensobrado y Sellado
                </h2>
                <p style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Prepara y cierra el paquete con cinta firme.</p>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
                <div>1️⃣ Mete los billetes contados (<strong>{formatCurrency(montoDeclaradoNum)}</strong>) en sobre o caja.</div>
                <div>2️⃣ Sella todas las solapas con <strong>cinta adhesiva firme</strong>.</div>
                <div>3️⃣ Escribe con marcador en el frente: <strong style={{ color: '#e879f9' }}>{sobre.codigo_sobre}</strong> y <strong style={{ color: '#ffffff' }}>Cliente {sobre.cliente_id}</strong>.</div>
              </div>

              <div style={{ background: 'rgba(142, 71, 133, 0.12)', border: '1px solid #8e4785', borderRadius: '8px', padding: '0.65rem', marginBottom: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.78rem', color: '#ffffff' }}>
                  <input
                    type="checkbox"
                    checked={confirmEnsobrado}
                    onChange={(e) => setConfirmEnsobrado(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: '#8e4785', cursor: 'pointer' }}
                  />
                  <span>He colocado los billetes y sellado el sobre con el código <strong>{sobre.codigo_sobre}</strong>.</span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.85rem' }}>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: '#94a3b8', padding: '0.55rem 0.85rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  <ArrowLeft size={13} /> Billetes
                </button>

                <button
                  type="button"
                  disabled={!confirmEnsobrado}
                  onClick={() => setStep(4)}
                  style={{
                    background: confirmEnsobrado ? '#8e4785' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.65rem 1.15rem',
                    borderRadius: '6px',
                    fontWeight: '700',
                    fontSize: '0.85rem',
                    cursor: confirmEnsobrado ? 'pointer' : 'not-allowed'
                  }}
                >
                  Continuar a Fotos <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* PASO 4: FOTOS Y FINALIZACIÓN */}
          {step === 4 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '0.85rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#ffffff', marginBottom: '0.2rem' }}>
                  Fotos del Sobre Cerrado
                </h2>
                <p style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Toma 2 fotos claras del paquete sellado.</p>
              </div>

              {/* Grid Fotos */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1rem' }}>
                
                {/* Frente */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '8px', padding: '0.5rem', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: '700', display: 'block', marginBottom: '0.35rem' }}>Frente (Código)</span>
                  {fotoFrentePreview ? (
                    <div style={{ position: 'relative' }}>
                      <img src={fotoFrentePreview} alt="Frente" style={{ width: '100%', height: '110px', objectFit: 'cover', borderRadius: '5px' }} />
                      <button type="button" onClick={() => { setFotoFrente(null); setFotoFrentePreview(null); }} style={{ position: 'absolute', top: '3px', right: '3px', background: '#ef4444', border: 'none', color: '#ffffff', padding: '3px', borderRadius: '3px', cursor: 'pointer' }}><Trash2 size={11} /></button>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '110px', background: 'rgba(0,0,0,0.2)', borderRadius: '5px', cursor: 'pointer' }}>
                      <Camera size={24} style={{ color: '#8e4785', marginBottom: '0.2rem' }} />
                      <span style={{ fontSize: '0.72rem', fontWeight: '600' }}>Foto Frente</span>
                      <input type="file" accept="image/*" capture="environment" onChange={(e) => handleFotoChange('frente', e)} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>

                {/* Dorso */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '8px', padding: '0.5rem', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: '700', display: 'block', marginBottom: '0.35rem' }}>Dorso (Cinta)</span>
                  {fotoDorsoPreview ? (
                    <div style={{ position: 'relative' }}>
                      <img src={fotoDorsoPreview} alt="Dorso" style={{ width: '100%', height: '110px', objectFit: 'cover', borderRadius: '5px' }} />
                      <button type="button" onClick={() => { setFotoDorso(null); setFotoDorsoPreview(null); }} style={{ position: 'absolute', top: '3px', right: '3px', background: '#ef4444', border: 'none', color: '#ffffff', padding: '3px', borderRadius: '3px', cursor: 'pointer' }}><Trash2 size={11} /></button>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '110px', background: 'rgba(0,0,0,0.2)', borderRadius: '5px', cursor: 'pointer' }}>
                      <Camera size={24} style={{ color: '#8e4785', marginBottom: '0.2rem' }} />
                      <span style={{ fontSize: '0.72rem', fontWeight: '600' }}>Foto Dorso</span>
                      <input type="file" accept="image/*" capture="environment" onChange={(e) => handleFotoChange('dorso', e)} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>

              </div>

              {/* Nombre del Encargado / Colaborador */}
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: '#cbd5e1', marginBottom: '0.25rem' }}>
                  Tu Nombre (Encargado que preparó el dinero):
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <User size={16} style={{ position: 'absolute', left: '0.65rem', color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="Ej: Laura / Lucas (Cajero)"
                    value={nombreColaborador}
                    onChange={(e) => setNombreColaborador(e.target.value)}
                    style={{ width: '100%', padding: '0.55rem 0.55rem 0.55rem 2.2rem', borderRadius: '6px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff', fontSize: '0.82rem' }}
                  />
                </div>
              </div>

              {/* Modalidad */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', color: '#cbd5e1', marginBottom: '0.35rem' }}>
                  Modalidad de Entrega a LAMDA:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div
                    onClick={() => setModalidadEntrega('CHOFER')}
                    style={{ border: modalidadEntrega === 'CHOFER' ? '2px solid #8e4785' : '1px solid rgba(255,255,255,0.1)', background: modalidadEntrega === 'CHOFER' ? 'rgba(142, 71, 133, 0.15)' : 'rgba(255,255,255,0.02)', borderRadius: '6px', padding: '0.55rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <Truck size={16} style={{ color: modalidadEntrega === 'CHOFER' ? '#c084fc' : '#94a3b8' }} />
                    <span style={{ fontSize: '0.78rem', fontWeight: '600' }}>🚚 Chofer</span>
                  </div>

                  <div
                    onClick={() => setModalidadEntrega('LOCAL')}
                    style={{ border: modalidadEntrega === 'LOCAL' ? '2px solid #8e4785' : '1px solid rgba(255,255,255,0.1)', background: modalidadEntrega === 'LOCAL' ? 'rgba(142, 71, 133, 0.15)' : 'rgba(255,255,255,0.02)', borderRadius: '6px', padding: '0.55rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <Store size={16} style={{ color: modalidadEntrega === 'LOCAL' ? '#c084fc' : '#94a3b8' }} />
                    <span style={{ fontSize: '0.78rem', fontWeight: '600' }}>🏬 Mostrador</span>
                  </div>
                </div>
              </div>

              {/* Botones Finales */}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.85rem' }}>
                <button
                  type="button"
                  disabled={subiendo}
                  onClick={() => setStep(3)}
                  style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: '#94a3b8', padding: '0.55rem 0.85rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  <ArrowLeft size={13} /> Sellado
                </button>

                <button
                  type="button"
                  disabled={subiendo || !fotoFrente || !fotoDorso}
                  onClick={handleFinalizar}
                  style={{
                    background: (!subiendo && fotoFrente && fotoDorso) ? '#16a34a' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.65rem 1.25rem',
                    borderRadius: '8px',
                    fontWeight: '700',
                    fontSize: '0.88rem',
                    cursor: (!subiendo && fotoFrente && fotoDorso) ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow: (!subiendo && fotoFrente && fotoDorso) ? '0 4px 14px rgba(22, 163, 74, 0.4)' : 'none'
                  }}
                >
                  {subiendo ? (
                    <>
                      <Loader2 size={15} className="spinner" /> Registrando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={15} /> Declarar Sobre Listo ({formatCurrency(montoDeclaradoNum)})
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
