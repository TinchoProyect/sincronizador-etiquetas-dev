import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { supabaseAnonimaPublica, isSupabaseOfflineLab } from '../supabaseClient';
import {
  Banknote, DollarSign, Camera, Truck, Store,
  CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft,
  Trash2, Plus, Minus, Loader2, User, Lock, Users,
  Copy, RefreshCw, Edit3, ShieldCheck
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
const LAB_API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005').replace(/\/+$/, '');

export default function EnsobradoPublico({ path }) {
  const extraerToken = () => {
    const hash = window.location.hash || '';
    const pathname = window.location.pathname || '';
    const search = window.location.search || '';
    const rawP = path || '';

    const params = new URLSearchParams(search);
    if (params.get('token')) return params.get('token').trim();

    const regexToken = /ensobrado[\/]+(?:colab[\/]+)?([a-zA-Z0-9_\-]+)/i;
    for (const fuente of [hash, pathname, rawP]) {
      const m = (fuente || '').match(regexToken);
      if (m && m[1]) return m[1].trim();
    }

    const parts = (hash || pathname || rawP).split(/ensobrado[\/#]/i);
    if (parts.length > 1) {
      const candidate = parts[parts.length - 1].replace(/^colab[\/]+/i, '').split('?')[0].split('/')[0].trim();
      if (candidate) return candidate;
    }

    return '';
  };

  const targetToken = extraerToken();

  const [loading, setLoading] = useState(true);
  const [sobre, setSobre] = useState(null);
  const [rolAcceso, setRolAcceso] = useState('DUENO'); // 'DUENO' | 'COLABORADOR'
  const [errorMsg, setErrorMsg] = useState('');

  // Wizard (Dueño: 1 Monto -> 2 Billetes -> 3 Sellado -> 4 Fotos; Colaborador: 2 -> 3 -> 4 directo)
  const [step, setStep] = useState(1);
  const [montoDeclarado, setMontoDeclarado] = useState('');
  const [cantidadesBilletes, setCantidadesBilletes] = useState({});
  const [confirmEnsobrado, setConfirmEnsobrado] = useState(false);
  const [modalidadEntrega, setModalidadEntrega] = useState('CHOFER');
  const [nombreColaborador, setNombreColaborador] = useState('');
  const [observaciones, setObservaciones] = useState('');

  // Delegación Dueño -> Colaborador (sobre el mismo sobre)
  const [modoDelegacion, setModoDelegacion] = useState(false);
  const [editandoMontoDelegado, setEditandoMontoDelegado] = useState(false);
  const [colabNombreDelegar, setColabNombreDelegar] = useState('');
  const [notaDelegar, setNotaDelegar] = useState('');
  const [delegando, setDelegando] = useState(false);
  const [qrColabDataUrl, setQrColabDataUrl] = useState('');
  const [copiadoColab, setCopiadoColab] = useState(false);

  // Fotos
  const [fotoFrente, setFotoFrente] = useState(null);
  const [fotoFrentePreview, setFotoFrentePreview] = useState(null);
  const [fotoDorso, setFotoDorso] = useState(null);
  const [fotoDorsoPreview, setFotoDorsoPreview] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [completadoExitoso, setCompletadoExitoso] = useState(false);

  const esColaborador = rolAcceso === 'COLABORADOR';

  const construirUrlColaborador = useCallback((tokColab) => {
    if (!tokColab) return '';
    return `${window.location.origin}/#ensobrado/colab/${tokColab}`;
  }, []);

  const actualizarQrDelegacion = useCallback(async (tokColab) => {
    if (!tokColab) {
      setQrColabDataUrl('');
      return;
    }
    try {
      const urlColab = construirUrlColaborador(tokColab);
      const dataUrl = await QRCode.toDataURL(urlColab, {
        width: 320,
        margin: 3,
        errorCorrectionLevel: 'M'
      });
      setQrColabDataUrl(dataUrl);
    } catch (e) {
      console.warn('No se pudo generar QR local para colaborador:', e);
    }
  }, [construirUrlColaborador]);

  const fetchSobrePublico = useCallback(async () => {
    if (isSupabaseOfflineLab) {
      const res = await fetch(`${LAB_API_BASE}/api/logistica/pagos-efectivo/publico/${encodeURIComponent(targetToken)}`);
      return await res.json();
    }
    const { data, error } = await supabaseAnonimaPublica.rpc('ensobrado_publico_obtener', {
      p_token: targetToken
    });
    if (error) throw error;
    return data;
  }, [targetToken]);

  const cargarSobrePorToken = useCallback(async ({ silencioso = false } = {}) => {
    try {
      if (!silencioso) {
        setLoading(true);
        setErrorMsg('');
      }

      const resp = await fetchSobrePublico();
      if (!resp || !resp.ok || !resp.sobre) {
        throw new Error(resp?.error || 'El enlace es inválido o el sobre ya no se encuentra disponible.');
      }

      const data = resp.sobre;
      const rol = resp.rol_acceso || 'DUENO';

      setSobre(data);
      setRolAcceso(rol);

      if (data.monto_declarado !== null && data.monto_declarado !== undefined && parseFloat(data.monto_declarado) > 0) {
        if (!silencioso || rol === 'COLABORADOR') {
          setMontoDeclarado(String(parseFloat(data.monto_declarado)));
        }
      } else if (!silencioso) {
        setMontoDeclarado('');
      }

      if (!silencioso) {
        if (data.modalidad_entrega) {
          setModalidadEntrega(data.modalidad_entrega);
        }
        if (data.colaborador_nombre && rol === 'COLABORADOR') {
          setNombreColaborador(data.colaborador_nombre === 'Titular / Encargado' ? '' : data.colaborador_nombre);
        } else if (data.colaborador_nombre) {
          setColabNombreDelegar(data.colaborador_nombre === 'Titular / Encargado' ? '' : data.colaborador_nombre);
        }
        if (data.observaciones_cliente) {
          setNotaDelegar(data.observaciones_cliente);
        }

        if (rol === 'COLABORADOR') {
          if (!data.monto_declarado || parseFloat(data.monto_declarado) <= 0) {
            setErrorMsg('El titular aún no definió el monto fijo para este sobre.');
          } else {
            setStep(2); // Arranque directo en Conteo de Billetes (3 pasos efectivos)
          }
        } else {
          setStep(1);
          if (data.token_colaborador && data.estado === 'PENDIENTE_ENSOBRADO') {
            setModoDelegacion(true);
            setEditandoMontoDelegado(false);
            actualizarQrDelegacion(data.token_colaborador);
          }
        }
      } else if (rol === 'DUENO' && data.token_colaborador) {
        actualizarQrDelegacion(data.token_colaborador);
      }

      if (data.estado !== 'PENDIENTE_ENSOBRADO') {
        if (['PREPARADO', 'ACREDITADO', 'EN_TRANSITO', 'RECIBIDO_LOCAL'].includes(data.estado)) {
          setCompletadoExitoso(true);
        } else if (!silencioso) {
          setErrorMsg(`Este sobre se encuentra en estado ${data.estado}.`);
        }
      }
    } catch (err) {
      console.error('Error al cargar sobre:', err);
      if (!silencioso) setErrorMsg(err.message || 'No se pudo cargar el sobre.');
    } finally {
      if (!silencioso) setLoading(false);
    }
  }, [fetchSobrePublico, actualizarQrDelegacion]);

  useEffect(() => {
    if (targetToken) {
      cargarSobrePorToken();
    } else {
      setLoading(false);
      setErrorMsg('No se proporcionó un enlace de derivación válido.');
    }
  }, [targetToken, cargarSobrePorToken]);

  // Polling de estado cada ~8s en vista de delegación activa del dueño
  useEffect(() => {
    if (rolAcceso !== 'DUENO' || !modoDelegacion || !sobre?.token_colaborador || sobre?.estado !== 'PENDIENTE_ENSOBRADO' || completadoExitoso) {
      return undefined;
    }
    const timer = setInterval(() => {
      cargarSobrePorToken({ silencioso: true });
    }, 8000);
    return () => clearInterval(timer);
  }, [rolAcceso, modoDelegacion, sobre?.token_colaborador, sobre?.estado, completadoExitoso, cargarSobrePorToken]);

  const handleMontoChange = (val) => {
    if (esColaborador) return;
    if (val !== montoDeclarado) {
      setCantidadesBilletes({});
      setConfirmEnsobrado(false);
    }
    setMontoDeclarado(val);
  };

  // Cálculo de totales
  const calcularTotalBilletes = () => {
    return DENOMINACIONES_BILLETES.reduce((acc, curr) => {
      const cant = parseInt(cantidadesBilletes[curr.valor] || 0, 10);
      return acc + (cant * curr.valor);
    }, 0);
  };

  const totalBilletes = calcularTotalBilletes();
  const montoDeclaradoNum = esColaborador
    ? (parseFloat(sobre?.monto_declarado || 0) || 0)
    : (parseFloat(montoDeclarado) || 0);
  const diferenciaArqueo = totalBilletes - montoDeclaradoNum;
  const arqueoExacto = montoDeclaradoNum > 0 && Math.abs(diferenciaArqueo) < 0.01;

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

  const uploadImageToStorage = async (file, previewDataUrl, pathSuffix) => {
    if (isSupabaseOfflineLab) {
      return previewDataUrl || `lab-local://${sobre.codigo_sobre}_${pathSuffix}_${Date.now()}.jpg`;
    }
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${sobre.cliente_id}/${sobre.codigo_sobre}_${pathSuffix}_${Date.now()}.${fileExt}`;

    const { error } = await supabaseAnonimaPublica.storage
      .from('sobres_efectivo')
      .upload(fileName, file, { cacheControl: '3600', upsert: true });

    if (error) throw error;

    const { data: publicUrlData } = supabaseAnonimaPublica.storage
      .from('sobres_efectivo')
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  };

  // Delegar desde pantalla del Dueño fijando el monto sobre el MISMO sobre
  const handleConfirmarDelegacion = async () => {
    if (esColaborador) return;
    if (montoDeclaradoNum <= 0) {
      Swal.fire('Monto requerido', 'Definí primero el monto exacto en pesos para fijar al colaborador.', 'warning');
      return;
    }

    try {
      setDelegando(true);
      let resp;
      if (isSupabaseOfflineLab) {
        const res = await fetch(`${LAB_API_BASE}/api/logistica/pagos-efectivo/publico/${encodeURIComponent(targetToken)}/delegar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            monto: montoDeclaradoNum,
            colaborador_nombre: colabNombreDelegar.trim() || null,
            nota: notaDelegar.trim(),
            fijado_por: sobre?.cliente_nombre || null
          })
        });
        resp = await res.json();
      } else {
        const { data, error } = await supabaseAnonimaPublica.rpc('ensobrado_dueno_delegar', {
          p_token_dueno: targetToken,
          p_monto: montoDeclaradoNum,
          p_colaborador_nombre: colabNombreDelegar.trim() || null,
          p_nota: notaDelegar.trim(),
          p_fijado_por: sobre?.cliente_nombre || null
        });
        if (error) throw error;
        resp = data;
      }

      if (!resp || !resp.ok) {
        if (resp?.code === 'YA_PROCESADO') {
          await cargarSobrePorToken();
          Swal.fire('Sobre ya preparado', resp.error || 'El sobre ya fue completado.', 'info');
          return;
        }
        throw new Error(resp?.error || 'No se pudo generar la delegación.');
      }

      setSobre(prev => ({
        ...prev,
        monto_declarado: resp.monto_declarado,
        monto_bloqueado: true,
        monto_fijado_por: resp.monto_fijado_por,
        delegado_at: resp.delegado_at,
        colaborador_nombre: resp.colaborador_nombre,
        observaciones_cliente: resp.observaciones_cliente,
        token_colaborador: resp.token_colaborador
      }));
      setEditandoMontoDelegado(false);
      setModoDelegacion(true);
      await actualizarQrDelegacion(resp.token_colaborador);
    } catch (err) {
      console.error('Error al delegar sobre:', err);
      Swal.fire('Error', err.message || 'No se pudo generar la delegación.', 'error');
    } finally {
      setDelegando(false);
    }
  };

  // Finalizar Ensobrado (Dueño o Colaborador)
  const handleFinalizar = async () => {
    if (!fotoFrente || !fotoDorso) {
      Swal.fire('Fotos Obligatorias', 'Debes cargar las fotografías de Frente y Dorso del sobre cerrado.', 'warning');
      return;
    }

    try {
      setSubiendo(true);

      const urlFrente = await uploadImageToStorage(fotoFrente, fotoFrentePreview, 'frente');
      const urlDorso = await uploadImageToStorage(fotoDorso, fotoDorsoPreview, 'dorso');

      let resp;
      if (isSupabaseOfflineLab) {
        const res = await fetch(`${LAB_API_BASE}/api/logistica/pagos-efectivo/publico/${encodeURIComponent(targetToken)}/completar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            monto: montoDeclaradoNum,
            desglose_billetes: cantidadesBilletes,
            foto_frente_url: urlFrente,
            foto_dorso_url: urlDorso,
            modalidad_entrega: modalidadEntrega,
            colaborador_nombre: nombreColaborador.trim() || null,
            observaciones: observaciones.trim() || null
          })
        });
        resp = await res.json();
      } else {
        const { data, error } = await supabaseAnonimaPublica.rpc('ensobrado_publico_completar', {
          p_token: targetToken,
          p_monto: montoDeclaradoNum,
          p_desglose: cantidadesBilletes,
          p_foto_frente_url: urlFrente,
          p_foto_dorso_url: urlDorso,
          p_modalidad_entrega: modalidadEntrega,
          p_colaborador_nombre: nombreColaborador.trim() || null,
          p_observaciones: observaciones.trim() || null
        });
        if (error) throw error;
        resp = data;
      }

      if (!resp || !resp.ok) {
        if (resp?.code === 'YA_PROCESADO' || resp?.code === 'MONTO_BLOQUEADO') {
          await cargarSobrePorToken();
        }
        throw new Error(resp?.error || 'No se pudo completar el sobre.');
      }

      setSobre(prev => ({
        ...prev,
        estado: 'PREPARADO',
        monto_declarado: resp.monto_declarado ?? montoDeclaradoNum,
        modalidad_entrega: resp.modalidad_entrega || modalidadEntrega,
        colaborador_nombre: resp.colaborador_nombre || nombreColaborador
      }));
      setCompletadoExitoso(true);
    } catch (err) {
      console.error('Error al completar ensobrado:', err);
      Swal.fire('Atención', `No se pudo registrar el sobre: ${err.message}`, 'error');
    } finally {
      setSubiendo(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val || 0);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#ffffff', padding: '1rem' }}>
        <Loader2 className="spinner" size={36} style={{ color: '#8e4785', marginBottom: '1rem' }} />
        <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Cargando asistente de ensobrado...</p>
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

  const clienteTitulo = sobre?.cliente_nombre || sobre?.cliente_id || 'Cliente';

  if (completadoExitoso) {
    const encargadoFinal = nombreColaborador || sobre?.colaborador_nombre || (esColaborador ? 'Colaborador' : 'Titular');
    const montoFinalMostrar = parseFloat(sobre?.monto_declarado || montoDeclaradoNum || 0);
    const mensajeWA = encodeURIComponent(
      `📦 *AVISO DE ENSOBRADO (EFECTIVO)*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏷️ *Código de Sobre:* ${sobre.codigo_sobre}\n` +
      `🏢 *Cliente:* ${clienteTitulo} (${sobre.cliente_id})\n` +
      `💵 *Monto Declarado:* $ ${montoFinalMostrar.toLocaleString('es-AR', { minimumFractionDigits: 2 })}\n` +
      `👤 *Preparado por:* ${encargadoFinal}\n` +
      `📦 *Modalidad:* ${modalidadEntrega === 'CHOFER' ? 'Retiro por Chofer' : 'Entrega en Mostrador LAMDA'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `El sobre ya fue sellado y registrado correctamente.`
    );
    const urlWA = `https://api.whatsapp.com/send?phone=${WHATSAPP_EMPRESA}&text=${mensajeWA}`;

    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#ffffff', padding: '1.5rem', textAlign: 'center' }}>
        <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '16px', padding: '2rem 1.5rem', maxWidth: '440px', width: '100%', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
          <CheckCircle2 size={54} style={{ color: '#16a34a', margin: '0 auto 1rem auto' }} />
          <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#ffffff', marginBottom: '0.35rem' }}>
            ¡Sobre Declarado Listo!
          </h2>
          <p style={{ color: '#cbd5e1', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
            El sobre <strong style={{ color: '#e879f9' }}>{sobre.codigo_sobre}</strong> de <strong>{clienteTitulo}</strong> por <strong style={{ color: '#4ade80' }}>{formatCurrency(montoFinalMostrar)}</strong> quedó registrado sin duplicados.
          </p>

          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.18)', borderRadius: '10px', padding: '0.85rem', marginBottom: '1.5rem', textAlign: 'left', fontSize: '0.82rem', lineHeight: 1.55 }}>
            <div><strong>Código:</strong> {sobre.codigo_sobre}</div>
            <div><strong>Estado:</strong> {sobre.estado}</div>
            <div><strong>Modalidad:</strong> {modalidadEntrega === 'CHOFER' ? '🚚 Retiro por Chofer' : '🏬 Entrega en Mostrador'}</div>
            <div><strong>Preparado por:</strong> {encargadoFinal}</div>
          </div>

          <button
            onClick={() => window.open(urlWA, '_blank')}
            style={{
              width: '100%',
              background: '#25D366',
              color: '#052e16',
              border: 'none',
              padding: '0.9rem',
              borderRadius: '10px',
              fontWeight: '800',
              fontSize: '0.94rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 14px rgba(37, 211, 102, 0.4)'
            }}
          >
            📲 Avisar a LAMDA por WhatsApp
          </button>
        </div>
      </div>
    );
  }

  const pasosProgreso = esColaborador
    ? [
        { num: 2, display: 1, label: 'Billetes' },
        { num: 3, display: 2, label: 'Sellado' },
        { num: 4, display: 3, label: 'Fotos' }
      ]
    : [
        { num: 1, display: 1, label: 'Monto' },
        { num: 2, display: 2, label: 'Billetes' },
        { num: 3, display: 3, label: 'Sellado' },
        { num: 4, display: 4, label: 'Fotos' }
      ];

  const urlDelegadoActual = sobre?.token_colaborador ? construirUrlColaborador(sobre.token_colaborador) : '';
  const mensajeWaColaborador = urlDelegadoActual
    ? encodeURIComponent(
        `📦 *TAREA DE ENSOBRADO DE EFECTIVO*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🏢 *Local:* ${clienteTitulo}\n` +
        `💵 *Monto Fijo a Preparar:* ${formatCurrency(parseFloat(sobre?.monto_declarado || montoDeclaradoNum))}\n` +
        `🏷️ *Sobre:* ${sobre.codigo_sobre}\n` +
        (sobre?.observaciones_cliente ? `📝 *Nota:* ${sobre.observaciones_cliente}\n` : '') +
        `\n👉 Abrí este enlace para contar los billetes y sacar las fotos del sobre:\n${urlDelegadoActual}`
      )
    : '';

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#ffffff', padding: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ maxWidth: '520px', width: '100%', paddingBottom: '2rem' }}>

        {/* Encabezado Institucional con Rol */}
        <div style={{ textAlign: 'center', marginBottom: '1rem', marginTop: '0.4rem' }}>
          <img src="/logo_LAMDA.png?v=4" alt="LAMDA" style={{ maxHeight: '40px', margin: '0 auto 0.45rem auto' }} />
          <h1 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', margin: 0 }}>
            <Banknote size={20} style={{ color: '#e879f9' }} /> {clienteTitulo}
          </h1>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.45rem' }}>
            <span style={{ background: 'rgba(142, 71, 133, 0.28)', border: '1px solid #a855f7', borderRadius: '999px', padding: '0.22rem 0.7rem', color: '#ffffff', fontSize: '0.74rem', fontWeight: '800' }}>
              {sobre.codigo_sobre} • {sobre.cliente_id}
            </span>
            {esColaborador ? (
              <span style={{ background: 'rgba(245, 158, 11, 0.2)', border: '1px solid #f59e0b', borderRadius: '999px', padding: '0.22rem 0.7rem', color: '#fde68a', fontSize: '0.74rem', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <Lock size={12} /> Monto fijado por {sobre.monto_fijado_por || clienteTitulo}
              </span>
            ) : (
              <span style={{ background: 'rgba(16, 185, 129, 0.18)', border: '1px solid #10b981', borderRadius: '999px', padding: '0.22rem 0.7rem', color: '#a7f3d0', fontSize: '0.74rem', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <ShieldCheck size={12} /> Vista Titular · Monto editable
              </span>
            )}
          </div>
        </div>

        {/* Card Contenedor Asistente */}
        <div style={{ background: '#1e293b', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.1)', padding: '1rem', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>

          {/* Banner Permanente de Monto Fijo para Colaborador Delegado */}
          {esColaborador && (
            <div data-testid="banner-monto-bloqueado" style={{ background: '#0f172a', border: '2px solid #f59e0b', borderRadius: '12px', padding: '0.8rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: '800', color: '#fde68a', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Lock size={13} /> Monto Fijo a Preparar
                </div>
                <div style={{ fontSize: '0.74rem', color: '#cbd5e1', marginTop: '0.15rem' }}>
                  Definido por {sobre.monto_fijado_por || clienteTitulo} (no editable)
                </div>
                {sobre.observaciones_cliente && (
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                    📝 {sobre.observaciones_cliente}
                  </div>
                )}
              </div>
              <div style={{ fontSize: '1.3rem', fontWeight: '900', color: '#4ade80', whiteSpace: 'nowrap' }}>
                {formatCurrency(montoDeclaradoNum)}
              </div>
            </div>
          )}

          {/* Barra de Progreso */}
          {!modoDelegacion && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', position: 'relative' }}>
              <div style={{ position: 'absolute', top: '50%', left: '8%', right: '8%', height: '2px', background: 'rgba(255,255,255,0.1)', zIndex: 0, transform: 'translateY(-50%)' }} />
              {pasosProgreso.map((s) => {
                const isPassed = step > s.num;
                const isCurrent = step === s.num;
                return (
                  <div key={s.num} style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: '800',
                      fontSize: '0.82rem',
                      background: isCurrent ? '#8e4785' : isPassed ? '#16a34a' : '#0f172a',
                      color: '#ffffff',
                      border: isCurrent ? '2px solid #e879f9' : isPassed ? '2px solid #16a34a' : '1px solid rgba(255,255,255,0.2)'
                    }}>
                      {isPassed ? '✓' : s.display}
                    </div>
                    <span style={{ fontSize: '0.7rem', fontWeight: isCurrent ? '800' : '600', color: isCurrent ? '#ffffff' : '#94a3b8' }}>
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* VISTA DE DELEGACIÓN DEL DUEÑO (QR GRANDE + WHATSAPP + ESTADO EN VIVO) */}
          {!esColaborador && modoDelegacion && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '0.9rem' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(13, 148, 136, 0.22)', border: '1px solid #14b8a6', borderRadius: '999px', padding: '0.25rem 0.8rem', fontSize: '0.75rem', fontWeight: '800', color: '#5eead4', marginBottom: '0.5rem' }}>
                  <Users size={14} /> Delegación a Colaborador · Sobre {sobre.codigo_sobre}
                </div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#ffffff', margin: '0 0 0.25rem 0' }}>
                  {sobre.token_colaborador && !editandoMontoDelegado ? 'Escaneá el QR o compartí por WhatsApp' : 'Fijar monto para tu colaborador'}
                </h2>
                <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: 0 }}>
                  El colaborador abrirá directo el conteo con este importe bloqueado.
                </p>
              </div>

              {(!sobre.token_colaborador || editandoMontoDelegado) ? (
                <div>
                  <div style={{ background: '#0f172a', border: '2px solid #8e4785', borderRadius: '12px', padding: '0.85rem', marginBottom: '0.9rem' }}>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', color: '#cbd5e1', marginBottom: '0.35rem' }}>
                      🔒 Monto exacto a fijar ($ ARS):
                    </label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <DollarSign size={20} style={{ position: 'absolute', left: '0.75rem', color: '#e879f9' }} />
                      <input
                        type="number"
                        inputMode="decimal"
                        min="1"
                        placeholder="Ej: 110000"
                        value={montoDeclarado}
                        onChange={(e) => handleMontoChange(e.target.value)}
                        style={{ width: '100%', padding: '0.75rem 0.75rem 0.75rem 2.3rem', fontSize: '1.3rem', fontWeight: '900', borderRadius: '8px', background: '#1e293b', border: '1px solid #a855f7', color: '#ffffff', outline: 'none' }}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', color: '#cbd5e1', marginBottom: '0.25rem' }}>
                      👤 Nombre del colaborador / cajero (Opcional):
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Lucas / Caja 1"
                      value={colabNombreDelegar}
                      onChange={(e) => setColabNombreDelegar(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '0.65rem 0.75rem', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: '#ffffff', fontSize: '0.9rem' }}
                    />
                  </div>

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', color: '#cbd5e1', marginBottom: '0.25rem' }}>
                      📝 Nota para el colaborador (Opcional):
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Dejar listo en caja para el chofer"
                      value={notaDelegar}
                      onChange={(e) => setNotaDelegar(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '0.65rem 0.75rem', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: '#ffffff', fontSize: '0.9rem' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={delegando}
                      onClick={() => {
                        setEditandoMontoDelegado(false);
                        if (!sobre.token_colaborador) setModoDelegacion(false);
                      }}
                      style={{ background: 'transparent', border: '1px solid #475569', color: '#cbd5e1', padding: '0.75rem 1rem', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '0.84rem' }}
                    >
                      ← Volver
                    </button>
                    <button
                      type="button"
                      disabled={delegando || montoDeclaradoNum <= 0}
                      onClick={handleConfirmarDelegacion}
                      style={{ flex: 1, background: montoDeclaradoNum > 0 ? '#0d9488' : '#334155', color: '#ffffff', border: 'none', padding: '0.8rem 1rem', borderRadius: '8px', fontWeight: '800', fontSize: '0.92rem', cursor: montoDeclaradoNum > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                    >
                      {delegando ? <Loader2 size={16} className="spinner" /> : <Lock size={16} />}
                      {sobre.token_colaborador ? 'Actualizar Monto Fijo y QR' : 'Fijar Monto y Generar QR / WhatsApp'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ background: '#0f172a', border: '2px solid #14b8a6', borderRadius: '12px', padding: '0.75rem 1rem', marginBottom: '0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '0.7rem', color: '#5eead4', fontWeight: '800', textTransform: 'uppercase' }}>
                        🔒 Monto Fijado al Colaborador
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#cbd5e1' }}>
                        {sobre.colaborador_nombre || 'Colaborador'} (no editable)
                      </div>
                    </div>
                    <strong style={{ fontSize: '1.35rem', color: '#4ade80' }}>
                      {formatCurrency(parseFloat(sobre.monto_declarado || montoDeclaradoNum))}
                    </strong>
                  </div>

                  {/* QR Grande en pantalla para escaneo en mostrador (>= 240x240) */}
                  {qrColabDataUrl && (
                    <div style={{ display: 'inline-block', background: '#ffffff', padding: '0.9rem', borderRadius: '14px', boxShadow: '0 8px 25px rgba(0,0,0,0.4)', marginBottom: '0.85rem' }}>
                      <img
                        data-testid="qr-colaborador-delegado"
                        src={qrColabDataUrl}
                        alt="QR para colaborador"
                        style={{ width: '248px', height: '248px', display: 'block' }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', marginBottom: '0.9rem' }}>
                    <a
                      href={`https://api.whatsapp.com/send?text=${mensajeWaColaborador}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ background: '#25D366', color: '#052e16', textDecoration: 'none', padding: '0.9rem 1rem', borderRadius: '10px', fontWeight: '900', fontSize: '0.96rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', boxShadow: '0 4px 14px rgba(37,211,102,0.35)' }}
                    >
                      📲 Compartir por WhatsApp al colaborador
                    </a>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(urlDelegadoActual);
                          setCopiadoColab(true);
                          setTimeout(() => setCopiadoColab(false), 2500);
                        }}
                        style={{ background: copiadoColab ? '#059669' : '#334155', color: '#ffffff', border: 'none', padding: '0.7rem', borderRadius: '8px', fontWeight: '700', fontSize: '0.82rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                      >
                        <Copy size={14} /> {copiadoColab ? '¡Copiado!' : 'Copiar enlace'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setMontoDeclarado(String(parseFloat(sobre.monto_declarado || montoDeclaradoNum)));
                          setEditandoMontoDelegado(true);
                        }}
                        style={{ background: '#0f172a', border: '1px solid #f59e0b', color: '#fde68a', padding: '0.7rem', borderRadius: '8px', fontWeight: '700', fontSize: '0.82rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                      >
                        <Edit3 size={14} /> Cambiar monto
                      </button>
                    </div>
                  </div>

                  {/* Estado en vivo + opción de armar el sobre él mismo */}
                  <div style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px dashed #f59e0b', borderRadius: '10px', padding: '0.65rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', fontSize: '0.76rem', color: '#fde68a', marginBottom: '0.8rem' }}>
                    <span>⏳ Esperando armado del colaborador...</span>
                    <button
                      type="button"
                      onClick={() => cargarSobrePorToken({ silencioso: true })}
                      style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ffffff', borderRadius: '6px', padding: '0.3rem 0.55rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', fontWeight: '700' }}
                    >
                      <RefreshCw size={12} /> Actualizar
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setModoDelegacion(false);
                      setEditandoMontoDelegado(false);
                      setStep(2);
                    }}
                    style={{ width: '100%', background: 'transparent', border: '1px solid #475569', color: '#cbd5e1', padding: '0.6rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
                  >
                    💵 Prefiero armar el sobre yo mismo
                  </button>
                </div>
              )}
            </div>
          )}

          {/* PASO 1 (SOLO DUEÑO): DEFINIR O EDITAR MONTO */}
          {!esColaborador && !modoDelegacion && step === 1 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '0.9rem' }}>
                <h2 style={{ fontSize: '1.12rem', fontWeight: '800', color: '#ffffff', marginBottom: '0.25rem' }}>
                  ¿Cuánto efectivo vas a entregar?
                </h2>
                <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: 0 }}>
                  {sobre.derivado_por ? `Solicitud iniciada por ${sobre.derivado_por}. Podés ajustar el importe libremente.` : 'Ingresá o editá el importe en pesos.'}
                </p>
              </div>

              {sobre.monto_sugerido_inicial > 0 && (
                <div style={{ background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.45)', borderRadius: '8px', padding: '0.5rem 0.75rem', marginBottom: '0.9rem', fontSize: '0.76rem', color: '#bae6fd', textAlign: 'center', fontWeight: '700' }}>
                  💡 Monto sugerido por LAMDA: {formatCurrency(parseFloat(sobre.monto_sugerido_inicial))} — podés modificarlo libremente
                </div>
              )}

              <div style={{ maxWidth: '400px', margin: '0 auto 1.25rem auto' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', color: '#e2e8f0', marginBottom: '0.35rem' }}>
                  Importe en Efectivo ($ ARS):
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <DollarSign size={22} style={{ position: 'absolute', left: '0.8rem', color: '#e879f9' }} />
                  <input
                    id="input-monto-dueno"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    placeholder="Ej: 110000"
                    value={montoDeclarado}
                    onChange={(e) => handleMontoChange(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.85rem 0.85rem 0.85rem 2.5rem',
                      fontSize: '1.35rem',
                      fontWeight: '900',
                      borderRadius: '10px',
                      background: 'rgba(0,0,0,0.35)',
                      border: '2px solid #a855f7',
                      color: '#ffffff',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.95rem' }}>
                <button
                  type="button"
                  disabled={montoDeclaradoNum <= 0}
                  onClick={() => setStep(2)}
                  style={{
                    width: '100%',
                    background: montoDeclaradoNum > 0 ? '#8e4785' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.88rem 1.25rem',
                    borderRadius: '10px',
                    fontWeight: '800',
                    fontSize: '0.95rem',
                    cursor: montoDeclaradoNum > 0 ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.45rem'
                  }}
                >
                  💵 Armar el sobre yo → Contar billetes <ArrowRight size={16} />
                </button>

                <button
                  type="button"
                  disabled={montoDeclaradoNum <= 0}
                  onClick={() => {
                    setEditandoMontoDelegado(!sobre.token_colaborador);
                    setModoDelegacion(true);
                  }}
                  style={{
                    width: '100%',
                    background: montoDeclaradoNum > 0 ? 'rgba(13, 148, 136, 0.22)' : 'rgba(255,255,255,0.05)',
                    color: montoDeclaradoNum > 0 ? '#5eead4' : '#64748b',
                    border: montoDeclaradoNum > 0 ? '2px solid #14b8a6' : '1px solid rgba(255,255,255,0.1)',
                    padding: '0.85rem 1.25rem',
                    borderRadius: '10px',
                    fontWeight: '800',
                    fontSize: '0.92rem',
                    cursor: montoDeclaradoNum > 0 ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.45rem'
                  }}
                >
                  <Users size={16} /> Delegar armado a un colaborador (monto fijo)
                </button>
              </div>
            </div>
          )}

          {/* PASO 2: CONTEO DE BILLETES */}
          {!modoDelegacion && step === 2 && (
            <div>
              <div style={{
                position: 'sticky',
                top: '0',
                zIndex: 999,
                background: '#0f172a',
                border: arqueoExacto ? '2px solid #16a34a' : '2px solid #8e4785',
                borderRadius: '10px',
                padding: '0.7rem 0.85rem',
                marginBottom: '0.85rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <span style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>
                    Objetivo: <strong>{formatCurrency(montoDeclaradoNum)}</strong>
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Contado:</span>
                    <strong style={{ fontSize: '1.1rem', color: arqueoExacto ? '#4ade80' : '#ffffff' }}>
                      {formatCurrency(totalBilletes)}
                    </strong>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <strong style={{
                    fontSize: '0.88rem',
                    color: arqueoExacto ? '#4ade80' : (diferenciaArqueo < 0 ? '#facc15' : '#f87171'),
                    background: arqueoExacto ? 'rgba(22, 163, 74, 0.22)' : 'rgba(234, 179, 8, 0.2)',
                    padding: '0.25rem 0.55rem',
                    borderRadius: '6px',
                    display: 'inline-block'
                  }}>
                    {arqueoExacto ? '✓ Exacto ($ 0)' : (diferenciaArqueo < 0 ? `Faltan ${formatCurrency(Math.abs(diferenciaArqueo))}` : `+ ${formatCurrency(diferenciaArqueo)}`)}
                  </strong>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '1.25rem' }}>
                {DENOMINACIONES_BILLETES.map((den) => {
                  const cant = cantidadesBilletes[den.valor] || 0;
                  const subtotalDen = cant * den.valor;
                  const puedeSumar = (totalBilletes + den.valor) <= montoDeclaradoNum;

                  return (
                    <div key={den.valor} style={{ background: cant > 0 ? 'rgba(142, 71, 133, 0.14)' : 'rgba(255,255,255,0.03)', border: cant > 0 ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '0.5rem 0.65rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                            <strong style={{ fontSize: '0.96rem', color: '#ffffff' }}>{den.label}</strong>
                            {subtotalDen > 0 && <span style={{ fontSize: '0.78rem', fontWeight: '800', color: '#4ade80' }}>= {formatCurrency(subtotalDen)}</span>}
                          </div>
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{den.subtitulo}</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <button
                            type="button"
                            disabled={cant === 0}
                            onClick={() => decrementarBillete(den.valor)}
                            style={{ width: '34px', height: '34px', borderRadius: '6px', background: cant > 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.18)', color: '#ffffff', cursor: cant > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Minus size={14} />
                          </button>

                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            data-denom={den.valor}
                            value={cant === 0 ? '' : cant}
                            placeholder="0"
                            onChange={(e) => handleCantidadChange(den.valor, e.target.value)}
                            style={{ width: '52px', textAlign: 'center', padding: '0.35rem 0.15rem', fontSize: '0.98rem', fontWeight: '800', borderRadius: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', color: '#ffffff' }}
                          />

                          <button
                            type="button"
                            disabled={!puedeSumar}
                            onClick={() => incrementarBillete(den.valor)}
                            style={{ width: '34px', height: '34px', borderRadius: '6px', background: puedeSumar ? 'rgba(142, 71, 133, 0.45)' : 'rgba(255,255,255,0.03)', border: puedeSumar ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.08)', color: '#ffffff', cursor: puedeSumar ? 'pointer' : 'not-allowed', opacity: puedeSumar ? 1 : 0.35, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: esColaborador ? 'flex-end' : 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.85rem' }}>
                {!esColaborador && (
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    style={{ background: 'none', border: '1px solid rgba(255,255,255,0.25)', color: '#cbd5e1', padding: '0.65rem 0.9rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <ArrowLeft size={14} /> Monto
                  </button>
                )}

                <button
                  type="button"
                  disabled={!arqueoExacto}
                  onClick={() => setStep(3)}
                  style={{
                    background: arqueoExacto ? '#16a34a' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.75rem 1.25rem',
                    borderRadius: '8px',
                    fontWeight: '800',
                    fontSize: '0.9rem',
                    cursor: arqueoExacto ? 'pointer' : 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  Arqueo Exacto → Sellar <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* PASO 3: PROTOCOLO DE SELLADO */}
          {!modoDelegacion && step === 3 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '0.85rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#ffffff', marginBottom: '0.2rem' }}>
                  Protocolo de Ensobrado y Sellado
                </h2>
                <p style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Prepara y cierra el paquete con cinta firme.</p>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '0.85rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.55rem', fontSize: '0.84rem' }}>
                <div>1️⃣ Colocá los billetes contados (<strong>{formatCurrency(montoDeclaradoNum)}</strong>) en el sobre o caja.</div>
                <div>2️⃣ Sellá todas las solapas con <strong>cinta adhesiva firme</strong>.</div>
                <div>3️⃣ Escribí con marcador en el frente: <strong style={{ color: '#e879f9' }}>{sobre.codigo_sobre}</strong> y <strong style={{ color: '#ffffff' }}>{clienteTitulo}</strong>.</div>
              </div>

              <div style={{ background: 'rgba(142, 71, 133, 0.16)', border: '1px solid #a855f7', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.82rem', color: '#ffffff', fontWeight: '600' }}>
                  <input
                    id="chk-confirm-sellado"
                    type="checkbox"
                    checked={confirmEnsobrado}
                    onChange={(e) => setConfirmEnsobrado(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: '#8e4785', cursor: 'pointer' }}
                  />
                  <span>He colocado los billetes y sellado el sobre con el código <strong>{sobre.codigo_sobre}</strong>.</span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.85rem' }}>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  style={{ background: 'none', border: '1px solid rgba(255,255,255,0.25)', color: '#cbd5e1', padding: '0.65rem 0.9rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <ArrowLeft size={14} /> Billetes
                </button>

                <button
                  type="button"
                  disabled={!confirmEnsobrado}
                  onClick={() => setStep(4)}
                  style={{
                    background: confirmEnsobrado ? '#8e4785' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.75rem 1.25rem',
                    borderRadius: '8px',
                    fontWeight: '800',
                    fontSize: '0.9rem',
                    cursor: confirmEnsobrado ? 'pointer' : 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  Continuar a Fotos <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* PASO 4: FOTOS Y FINALIZACIÓN */}
          {!modoDelegacion && step === 4 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '0.85rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#ffffff', marginBottom: '0.2rem' }}>
                  Fotos del Sobre Cerrado
                </h2>
                <p style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Toma 2 fotos claras del paquete sellado.</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '1rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '8px', padding: '0.5rem', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: '700', display: 'block', marginBottom: '0.35rem' }}>Frente (Código)</span>
                  {fotoFrentePreview ? (
                    <div style={{ position: 'relative' }}>
                      <img src={fotoFrentePreview} alt="Frente" style={{ width: '100%', height: '110px', objectFit: 'cover', borderRadius: '5px' }} />
                      <button type="button" onClick={() => { setFotoFrente(null); setFotoFrentePreview(null); }} style={{ position: 'absolute', top: '3px', right: '3px', background: '#ef4444', border: 'none', color: '#ffffff', padding: '4px', borderRadius: '4px', cursor: 'pointer' }}><Trash2 size={12} /></button>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '110px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px', cursor: 'pointer' }}>
                      <Camera size={24} style={{ color: '#e879f9', marginBottom: '0.2rem' }} />
                      <span style={{ fontSize: '0.74rem', fontWeight: '700' }}>Foto Frente</span>
                      <input id="input-foto-frente" type="file" accept="image/*" capture="environment" onChange={(e) => handleFotoChange('frente', e)} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '8px', padding: '0.5rem', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: '700', display: 'block', marginBottom: '0.35rem' }}>Dorso (Cinta)</span>
                  {fotoDorsoPreview ? (
                    <div style={{ position: 'relative' }}>
                      <img src={fotoDorsoPreview} alt="Dorso" style={{ width: '100%', height: '110px', objectFit: 'cover', borderRadius: '5px' }} />
                      <button type="button" onClick={() => { setFotoDorso(null); setFotoDorsoPreview(null); }} style={{ position: 'absolute', top: '3px', right: '3px', background: '#ef4444', border: 'none', color: '#ffffff', padding: '4px', borderRadius: '4px', cursor: 'pointer' }}><Trash2 size={12} /></button>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '110px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px', cursor: 'pointer' }}>
                      <Camera size={24} style={{ color: '#e879f9', marginBottom: '0.2rem' }} />
                      <span style={{ fontSize: '0.74rem', fontWeight: '700' }}>Foto Dorso</span>
                      <input id="input-foto-dorso" type="file" accept="image/*" capture="environment" onChange={(e) => handleFotoChange('dorso', e)} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>
              </div>

              <div style={{ marginBottom: '0.85rem' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: '700', color: '#cbd5e1', marginBottom: '0.25rem' }}>
                  Tu Nombre (Quien preparó el sobre):
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <User size={16} style={{ position: 'absolute', left: '0.65rem', color: '#94a3b8' }} />
                  <input
                    id="input-nombre-encargado"
                    type="text"
                    placeholder="Ej: Laura / Lucas (Cajero)"
                    value={nombreColaborador}
                    onChange={(e) => setNombreColaborador(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.6rem 0.6rem 2.2rem', borderRadius: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', color: '#ffffff', fontSize: '0.86rem' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: '700', color: '#cbd5e1', marginBottom: '0.35rem' }}>
                  Modalidad de Entrega a LAMDA:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div
                    onClick={() => setModalidadEntrega('CHOFER')}
                    style={{ border: modalidadEntrega === 'CHOFER' ? '2px solid #a855f7' : '1px solid rgba(255,255,255,0.15)', background: modalidadEntrega === 'CHOFER' ? 'rgba(142, 71, 133, 0.2)' : 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
                  >
                    <Truck size={16} style={{ color: modalidadEntrega === 'CHOFER' ? '#e879f9' : '#94a3b8' }} />
                    <span style={{ fontSize: '0.8rem', fontWeight: '700' }}>🚚 Chofer</span>
                  </div>

                  <div
                    onClick={() => setModalidadEntrega('LOCAL')}
                    style={{ border: modalidadEntrega === 'LOCAL' ? '2px solid #a855f7' : '1px solid rgba(255,255,255,0.15)', background: modalidadEntrega === 'LOCAL' ? 'rgba(142, 71, 133, 0.2)' : 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
                  >
                    <Store size={16} style={{ color: modalidadEntrega === 'LOCAL' ? '#e879f9' : '#94a3b8' }} />
                    <span style={{ fontSize: '0.8rem', fontWeight: '700' }}>🏬 Mostrador</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.85rem' }}>
                <button
                  type="button"
                  disabled={subiendo}
                  onClick={() => setStep(3)}
                  style={{ background: 'none', border: '1px solid rgba(255,255,255,0.25)', color: '#cbd5e1', padding: '0.65rem 0.9rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <ArrowLeft size={14} /> Sellado
                </button>

                <button
                  id="btn-declarar-sobre-listo"
                  type="button"
                  disabled={subiendo || !fotoFrente || !fotoDorso}
                  onClick={handleFinalizar}
                  style={{
                    background: (!subiendo && fotoFrente && fotoDorso) ? '#16a34a' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.75rem 1.25rem',
                    borderRadius: '8px',
                    fontWeight: '800',
                    fontSize: '0.9rem',
                    cursor: (!subiendo && fotoFrente && fotoDorso) ? 'pointer' : 'not-allowed',
                    display: 'inline-flex',
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
                      <CheckCircle2 size={16} /> Declarar Sobre Listo ({formatCurrency(montoDeclaradoNum)})
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
