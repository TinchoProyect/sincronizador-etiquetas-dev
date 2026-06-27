import React, { useState, useEffect } from 'react';
import { User, Phone, Key, ArrowLeft, Loader2 } from 'lucide-react';
import Swal from 'sweetalert2';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005';

export default function ActivarCuenta({ onNavigate }) {
  const [step, setStep] = useState(1); // 1: Solicitar, 2: Verificar
  const [clientId, setClientId] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Timer para el OTP (300 segundos = 5 minutos)
  const [timeLeft, setTimeLeft] = useState(300);
  const [timerActive, setTimerActive] = useState(false);

  useEffect(() => {
    let interval = null;
    if (timerActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (timeLeft === 0) {
      setTimerActive(false);
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [timerActive, timeLeft]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    if (!clientId || !whatsapp) return;

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/logistica/b2b-onboarding/otp/solicitar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: clientId.trim(),
          whatsapp: whatsapp.trim()
        })
      });

      const resJson = await response.json();

      if (!response.ok || !resJson.success) {
        throw new Error(resJson.message || 'Error al solicitar el código OTP.');
      }

      Swal.fire({
        title: 'Código Enviado',
        text: 'Hemos despachado un código OTP de 6 dígitos a su WhatsApp registrado.',
        icon: 'success',
        confirmButtonText: 'Continuar',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });

      setStep(2);
      setTimeLeft(300);
      setTimerActive(true);

    } catch (err) {
      console.error('Error solicitando OTP:', err.message);
      Swal.fire({
        title: 'Error de Activación',
        text: err.message,
        icon: 'error',
        confirmButtonText: 'Entendido',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp || otp.trim().length !== 6) {
      Swal.fire({
        title: 'Formato Incorrecto',
        text: 'El código OTP debe ser de 6 dígitos numéricos.',
        icon: 'warning',
        confirmButtonText: 'Entendido',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/logistica/b2b-onboarding/otp/verificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: clientId.trim(),
          otp: otp.trim()
        })
      });

      const resJson = await response.json();

      if (!response.ok || !resJson.success) {
        throw new Error(resJson.message || 'Código incorrecto o inválido.');
      }

      Swal.fire({
        title: '¡Verificación Exitosa!',
        text: 'Código correcto. Proceda a configurar sus credenciales de acceso.',
        icon: 'success',
        timer: 2000,
        showConfirmButton: false,
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });

      // Redirigir a onboarding con el token de activación
      onNavigate(`/onboarding?token=${resJson.token}`);

    } catch (err) {
      console.error('Error verificando OTP:', err.message);
      Swal.fire({
        title: 'Error de Código',
        text: err.message,
        icon: 'error',
        confirmButtonText: 'Volver a intentar',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBackToRequest = () => {
    setStep(1);
    setOtp('');
    setTimerActive(false);
  };

  return (
    <div className="login-wrapper">
      <div className="login-card">
        {/* Encabezado */}
        <div className="login-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '2.5rem' }}>
          <img src="/logo_LAMDA.png" alt="LAMDA Logo" style={{ maxHeight: '54px', maxWidth: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }} />
          <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--accent)', letterSpacing: '0.05em', marginTop: '-0.25rem', textTransform: 'lowercase' }}>activar cuenta b2b</span>
        </div>

        {step === 1 ? (
          /* Paso 1: Formulario de solicitud */
          <form onSubmit={handleRequestOtp} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '0.5rem' }}>
              Ingrese su código de cliente y teléfono celular registrado para solicitar un código OTP vía WhatsApp.
            </p>

            <div className="form-group">
              <label className="form-label" htmlFor="clientId">Código de Cliente</label>
              <div className="input-wrapper">
                <User className="input-icon" size={18} />
                <input
                  id="clientId"
                  type="text"
                  required
                  disabled={loading}
                  className="form-input"
                  placeholder="Ej: CB-0002 o 387"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="whatsapp">WhatsApp Registrado</label>
              <div className="input-wrapper">
                <Phone className="input-icon" size={18} />
                <input
                  id="whatsapp"
                  type="tel"
                  required
                  disabled={loading}
                  className="form-input"
                  placeholder="Ej: 2216699400"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={loading}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
            >
              {loading ? (
                <>
                  <Loader2 className="spinner" style={{ width: '18px', height: '18px', borderTopColor: 'var(--text-primary)' }} />
                  <span>Enviando código...</span>
                </>
              ) : (
                <span>Enviar código</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/')}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                marginTop: '0.5rem',
                textDecoration: 'none'
              }}
              onMouseOver={(e) => e.target.style.color = 'var(--text-primary)'}
              onMouseOut={(e) => e.target.style.color = 'var(--text-secondary)'}
            >
              <ArrowLeft size={16} />
              Volver al inicio de sesión
            </button>
          </form>
        ) : (
          /* Paso 2: Entrada del código OTP */
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '0.5rem' }}>
              Código enviado a WhatsApp. Ingrese los 6 dígitos a continuación.
            </p>

            <div className="form-group">
              <label className="form-label" htmlFor="otp">Código OTP</label>
              <div className="input-wrapper">
                <Key className="input-icon" size={18} />
                <input
                  id="otp"
                  type="text"
                  required
                  maxLength={6}
                  disabled={loading || timeLeft === 0}
                  className="form-input"
                  style={{ letterSpacing: '0.3em', textAlign: 'center', fontSize: '1.25rem', fontWeight: 'bold' }}
                  placeholder="••••••"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
            </div>

            {/* Contador de tiempo */}
            <div style={{ textAlign: 'center', fontSize: '0.875rem' }}>
              {timeLeft > 0 ? (
                <span style={{ color: 'var(--text-secondary)' }}>
                  El código expira en: <strong style={{ color: 'var(--accent)' }}>{formatTime(timeLeft)}</strong>
                </span>
              ) : (
                <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>
                  El código ha expirado. Solicite uno nuevo.
                </span>
              )}
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={loading || timeLeft === 0}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              {loading ? (
                <>
                  <Loader2 className="spinner" style={{ width: '18px', height: '18px', borderTopColor: 'var(--text-primary)' }} />
                  <span>Verificando...</span>
                </>
              ) : (
                <span>Verificar código</span>
              )}
            </button>

            {/* Botón para solicitar otro código si el actual expiró */}
            {timeLeft === 0 && (
              <button
                type="button"
                className="btn-primary"
                onClick={handleBackToRequest}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--accent)',
                  boxShadow: 'none',
                  color: 'var(--text-primary)',
                  cursor: 'pointer'
                }}
              >
                Solicitar nuevo código
              </button>
            )}

            <button
              type="button"
              onClick={handleBackToRequest}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                textDecoration: 'none'
              }}
              onMouseOver={(e) => e.target.style.color = 'var(--text-primary)'}
              onMouseOut={(e) => e.target.style.color = 'var(--text-secondary)'}
            >
              <ArrowLeft size={16} />
              Volver a ingresar datos
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
