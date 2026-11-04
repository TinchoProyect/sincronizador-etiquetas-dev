import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { 
  Smartphone, 
  QrCode as QrIcon, 
  Copy, 
  Check, 
  Clock, 
  RefreshCw, 
  X, 
  MessageSquare, 
  ShieldCheck, 
  AlertCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { supabase } from '../supabaseClient';

const API_BASE_URL = import.meta.env.DEV 
  ? (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005') 
  : '';

export default function VincularDispositivoModal({ isOpen, onClose, profile, session }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [magicLink, setMagicLink] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutos
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showQrOnMobile, setShowQrOnMobile] = useState(false);
  
  const timerRef = useRef(null);

  // Detección de dispositivo móvil vs desktop
  useEffect(() => {
    const checkMobile = () => {
      const userAgent = typeof window !== 'undefined' ? (window.navigator.userAgent || '').toLowerCase() : '';
      const mobileUA = /android|iphone|ipad|ipod|mobile/.test(userAgent);
      const smallScreen = typeof window !== 'undefined' && window.innerWidth <= 768;
      setIsMobile(mobileUA || smallScreen);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Función principal para solicitar el Magic Link (API directa con fallback a Cloud Dispatcher)
  const solicitarVinculo = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setError(null);
    setMagicLink('');
    setQrDataUrl('');
    setCopied(false);

    try {
      let linkObtenido = null;
      let qrObtenido = null;

      // 1. Intento por API HTTP Local / Dominio configurado
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        const token = session?.access_token;
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE_URL}/api/b2b/generar-vinculo-dispositivo`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            clienteId: profile?.cliente_id,
            email: profile?.email
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.success && (data.magicLink || data.url)) {
            linkObtenido = data.magicLink || data.url;
            qrObtenido = data.qrDataUrl || null;
          }
        }
      } catch (httpErr) {
        console.warn('⚠️ [VincularModal] Falló API directa o timeout, intentando vía Cloud Dispatcher:', httpErr?.message);
      }

      // 2. Si no se obtuvo por HTTP (ej: PWA en Cloudflare Workers HTTPS contra HTTP local), usar Cloud Dispatcher en Supabase
      if (!linkObtenido) {
        console.log('📡 [VincularModal] Emitiendo solicitud al Cloud Dispatcher...');
        const reqId = Math.random().toString(36).substring(2, 9);
        const reqType = `DEVPAIR-REQ-${reqId}-${profile?.cliente_id || ''}`;

        const { error: insErr } = await supabase.from('telemetria_accesos').insert([{
          cliente_nombre: profile?.nombre_empresa || profile?.nombre_completo || 'Cliente B2B',
          dispositivo: isMobile ? 'Celular' : 'Escritorio',
          latencia_ms: 1,
          tipo_acceso: reqType
        }]);

        if (insErr) {
          throw new Error('No se pudo conectar con el servidor de autenticación cloud: ' + insErr.message);
        }

        // Sondeo cada 1.2 segundos (máximo 18 segundos)
        const doneType = `DEVPAIR-RES-${reqId}-DONE`;
        const errType = `DEVPAIR-RES-${reqId}-ERROR`;
        const startTime = Date.now();
        while (Date.now() - startTime < 18000) {
          await new Promise(r => setTimeout(r, 1200));
          const { data: rows } = await supabase
            .from('telemetria_accesos')
            .select('*')
            .in('tipo_acceso', [doneType, errType])
            .order('id', { ascending: false })
            .limit(1);

          if (rows && rows.length > 0) {
            const row = rows[0];
            if (row.tipo_acceso === errType) {
              throw new Error(row.dispositivo || 'El servidor reportó un error al generar el enlace.');
            }
            linkObtenido = row.dispositivo || row.datos_adicionales?.magicLink || row.datos_adicionales?.url;
            break;
          }
        }
      }

      if (!linkObtenido) {
        throw new Error('Tiempo de espera agotado. Verifique que el servicio de enlace esté en línea.');
      }

      // 3. Generar QR Code localmente si no vino generado o para máxima nitidez
      if (!qrObtenido) {
        qrObtenido = await QRCode.toDataURL(linkObtenido, {
          width: 320,
          margin: 2,
          color: {
            dark: '#0f172a',
            light: '#ffffff'
          }
        });
      }

      setMagicLink(linkObtenido);
      setQrDataUrl(qrObtenido);
      setTimeLeft(600); // 10 minutos
    } catch (err) {
      console.error('❌ [VincularModal] Error al generar vínculo:', err);
      setError(err?.message || 'No se pudo generar el enlace de vinculación.');
    } finally {
      setLoading(false);
    }
  }, [profile, session, isMobile]);

  // Generar enlace al abrir el modal si no hay uno activo
  useEffect(() => {
    if (isOpen) {
      if (!magicLink || timeLeft <= 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        solicitarVinculo();
      }
    }
  }, [isOpen, magicLink, timeLeft, solicitarVinculo]);

  // Manejo del temporizador de 10 minutos
  const isTimerActive = isOpen && Boolean(magicLink) && timeLeft > 0;
  useEffect(() => {
    if (isTimerActive) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isTimerActive]);

  // Formato mm:ss
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopiarEnlace = async () => {
    if (!magicLink) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(magicLink);
      } else {
        // Fallback textarea
        const textarea = document.createElement('textarea');
        textarea.value = magicLink;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.warn('Error al copiar al portapapeles:', err);
    }
  };

  const handleCompartirWhatsApp = () => {
    if (!magicLink) return;
    const texto = `¡Hola! Te comparto el enlace de acceso directo al Portal B2B LAMDA (válido por 10 minutos, un solo uso):\n\n${magicLink}`;
    const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
  };

  const handleModalClose = () => {
    setCopied(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div 
      className="b2b-modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(3, 7, 18, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '1rem',
        animation: 'modalFadeIn 0.25s ease-out'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleModalClose();
      }}
    >
      <div 
        className="b2b-modal-card"
        style={{
          background: 'linear-gradient(145deg, #111827 0%, #0b0f19 100%)',
          border: '1px solid rgba(142, 71, 133, 0.35)',
          borderRadius: '20px',
          width: '100%',
          maxWidth: isMobile ? '400px' : '460px',
          padding: '1.75rem 1.5rem',
          position: 'relative',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          color: 'var(--text-primary)',
          maxHeight: '92vh',
          overflowY: 'auto'
        }}
      >
        {/* Botón Cerrar */}
        <button
          onClick={handleModalClose}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'rgba(255, 255, 255, 0.05)',
            border: 'none',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; }}
          onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
          title="Cerrar ventana"
        >
          <X size={18} />
        </button>

        {/* Encabezado */}
        <div style={{
          background: 'rgba(142, 71, 133, 0.15)',
          border: '1px solid rgba(142, 71, 133, 0.4)',
          borderRadius: '50%',
          width: '56px',
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1rem',
          color: 'var(--accent)'
        }}>
          {isMobile ? <Smartphone size={28} /> : <QrIcon size={28} />}
        </div>

        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.35rem', letterSpacing: '-0.01em' }}>
          Vincular otro dispositivo
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', maxWidth: '340px' }}>
          {isMobile 
            ? 'Iniciá sesión en tu computadora u otro equipo sin necesidad de tipear contraseñas.'
            : 'Escaneá el código QR con tu celular o compartí el enlace para ingresar al instante.'}
        </p>

        {/* Estado de Carga */}
        {loading && (
          <div style={{ padding: '2.5rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.85rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              border: '3px solid rgba(142, 71, 133, 0.2)',
              borderTopColor: 'var(--accent)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite'
            }} />
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Generando credencial de acceso seguro...
            </p>
          </div>
        )}

        {/* Estado de Error */}
        {!loading && error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '12px',
            padding: '1rem',
            width: '100%',
            marginBottom: '1.25rem',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#ef4444', fontWeight: '600', fontSize: '0.88rem' }}>
              <AlertCircle size={18} />
              <span>No se pudo generar el vínculo</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{error}</p>
            <button
              onClick={solicitarVinculo}
              style={{
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: '8px',
                padding: '0.45rem 0.85rem',
                color: '#fca5a5',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                alignSelf: 'flex-start',
                marginTop: '0.25rem'
              }}
            >
              <RefreshCw size={14} />
              <span>Reintentar</span>
            </button>
          </div>
        )}

        {/* Contenido Principal Cuando Hay Enlace */}
        {!loading && !error && magicLink && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            
            {/* Si expiró */}
            {timeLeft <= 0 ? (
              <div style={{
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '14px',
                padding: '1.5rem 1rem',
                width: '100%',
                marginBottom: '1rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.75rem'
              }}>
                <Clock size={32} style={{ color: '#f59e0b' }} />
                <p style={{ fontSize: '0.9rem', fontWeight: '600', color: '#fde68a' }}>
                  El enlace ha expirado por seguridad
                </p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '280px' }}>
                  Cada enlace es de un solo uso y dura 10 minutos para proteger tu cuenta.
                </p>
                <button
                  onClick={solicitarVinculo}
                  style={{
                    background: 'var(--accent)',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.65rem 1.25rem',
                    color: '#ffffff',
                    fontWeight: '700',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginTop: '0.25rem'
                  }}
                >
                  <RefreshCw size={15} />
                  <span>Generar nuevo enlace</span>
                </button>
              </div>
            ) : (
              <>
                {/* 💻 MODO DESKTOP: QR Principal + Botones de Soporte */}
                {!isMobile && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                    {/* Caja Blanca para el Código QR */}
                    <div style={{
                      background: '#ffffff',
                      padding: '12px',
                      borderRadius: '16px',
                      boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)',
                      marginBottom: '1rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '3px solid rgba(255, 255, 255, 0.1)'
                    }}>
                      <img 
                        src={qrDataUrl} 
                        alt="Código QR de Vinculación" 
                        style={{ width: '220px', height: '220px', display: 'block', borderRadius: '8px' }} 
                      />
                    </div>

                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <ShieldCheck size={16} style={{ color: '#22c55e' }} />
                      <span>Acceso seguro de un solo uso • Cifrado de extremo a extremo</span>
                    </p>

                    {/* Botones de acción en Desktop */}
                    <div style={{ display: 'flex', gap: '0.75rem', width: '100%', marginBottom: '1rem' }}>
                      <button
                        onClick={handleCopiarEnlace}
                        style={{
                          flex: 1,
                          background: copied ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                          border: `1px solid ${copied ? 'rgba(34, 197, 94, 0.5)' : 'rgba(255, 255, 255, 0.12)'}`,
                          borderRadius: '12px',
                          padding: '0.75rem',
                          color: copied ? '#4ade80' : 'var(--text-primary)',
                          fontSize: '0.85rem',
                          fontWeight: '600',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.45rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        <span>{copied ? '¡Copiado!' : 'Copiar enlace'}</span>
                      </button>

                      <button
                        onClick={handleCompartirWhatsApp}
                        style={{
                          flex: 1,
                          background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)',
                          border: 'none',
                          borderRadius: '12px',
                          padding: '0.75rem',
                          color: '#ffffff',
                          fontSize: '0.85rem',
                          fontWeight: '700',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.45rem',
                          cursor: 'pointer',
                          boxShadow: '0 4px 15px rgba(37, 211, 102, 0.25)',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <MessageSquare size={16} />
                        <span>WhatsApp</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 📱 MODO MOBILE: WhatsApp Principal + Acordeón de QR */}
                {isMobile && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                    {/* Botón Destacado de WhatsApp */}
                    <button
                      onClick={handleCompartirWhatsApp}
                      style={{
                        width: '100%',
                        background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)',
                        border: 'none',
                        borderRadius: '14px',
                        padding: '0.95rem 1rem',
                        color: '#ffffff',
                        fontSize: '0.95rem',
                        fontWeight: '750',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.6rem',
                        cursor: 'pointer',
                        boxShadow: '0 6px 20px rgba(37, 211, 102, 0.35)',
                        marginBottom: '0.75rem',
                        transition: 'transform 0.2s ease'
                      }}
                      onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.98)'; }}
                      onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                    >
                      <MessageSquare size={20} />
                      <span>Enviar acceso a mi WhatsApp</span>
                    </button>

                    {/* Botón Secundario Copiar */}
                    <button
                      onClick={handleCopiarEnlace}
                      style={{
                        width: '100%',
                        background: copied ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        border: `1px solid ${copied ? 'rgba(34, 197, 94, 0.5)' : 'rgba(255, 255, 255, 0.12)'}`,
                        borderRadius: '14px',
                        padding: '0.8rem 1rem',
                        color: copied ? '#4ade80' : 'var(--text-primary)',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        cursor: 'pointer',
                        marginBottom: '1rem',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      <span>{copied ? '¡Enlace copiado al portapapeles!' : 'Copiar enlace de acceso'}</span>
                    </button>

                    {/* Acordeón para mostrar QR en pantalla de celular */}
                    <div style={{ width: '100%', marginBottom: '1rem' }}>
                      <button
                        onClick={() => setShowQrOnMobile(!showQrOnMobile)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem',
                          width: '100%',
                          cursor: 'pointer',
                          padding: '0.4rem'
                        }}
                      >
                        <QrIcon size={15} style={{ color: 'var(--accent)' }} />
                        <span>{showQrOnMobile ? 'Ocultar código QR' : 'O escanear código QR desde otro equipo'}</span>
                        {showQrOnMobile ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>

                      {showQrOnMobile && (
                        <div style={{
                          marginTop: '0.75rem',
                          background: '#ffffff',
                          padding: '10px',
                          borderRadius: '14px',
                          display: 'inline-block',
                          boxShadow: '0 8px 25px rgba(0, 0, 0, 0.5)',
                          animation: 'fadeIn 0.3s ease-out'
                        }}>
                          <img 
                            src={qrDataUrl} 
                            alt="Código QR" 
                            style={{ width: '180px', height: '180px', display: 'block', borderRadius: '6px' }} 
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Temporizador y Pie Común */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  fontSize: '0.78rem',
                  color: timeLeft <= 60 ? '#f87171' : 'var(--text-muted)',
                  background: timeLeft <= 60 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${timeLeft <= 60 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
                  padding: '0.35rem 0.85rem',
                  borderRadius: '999px',
                  fontWeight: '600',
                  transition: 'all 0.3s ease'
                }}>
                  <Clock size={13} />
                  <span>Válido por {formatTime(timeLeft)} (un solo uso)</span>
                </div>
              </>
            )}

          </div>
        )}

      </div>
    </div>
  );
}
