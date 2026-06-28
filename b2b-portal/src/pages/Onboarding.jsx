import React, { useState, useEffect } from 'react';
import { Mail, Lock, Loader2, ArrowLeft, User, Briefcase, Eye, EyeOff } from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../supabaseClient';

const API_BASE_URL = import.meta.env.DEV 
  ? (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005') 
  : '';

export default function Onboarding({ onNavigate }) {
  const [token, setToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [clientData, setClientData] = useState(null);
  const [step, setStep] = useState(1); // Paso 1: Validar código, Paso 2: Datos y Contraseña

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [nombreContacto, setNombreContacto] = useState('');
  const [cargo, setCargo] = useState('Dueño / Titular');
  const [otroCargo, setOtroCargo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = ['@gmail.com', '@hotmail.com', '.com', '.com.ar'];

  const handleSuggestionClick = (suggestion) => {
    let current = email.trim();
    if (suggestion.startsWith('@')) {
      const atIndex = current.indexOf('@');
      if (atIndex > -1) {
        current = current.substring(0, atIndex) + suggestion;
      } else {
        current = current + suggestion;
      }
    } else {
      current = current + suggestion;
    }
    setEmail(current);
  };

  // Leer token de la URL en el montaje
  useEffect(() => {
    let urlToken = null;
    const params = new URLSearchParams(window.location.search);
    urlToken = params.get('token');

    if (!urlToken && window.location.hash.includes('?')) {
      const hashQuery = window.location.hash.split('?')[1];
      const hashParams = new URLSearchParams(hashQuery);
      urlToken = hashParams.get('token');
    }
    
    if (urlToken) {
      setToken(urlToken);
    }
  }, []);

  const validarTokenInvitacion = async (tokenParaValidar) => {
    setValidating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/logistica/b2b-onboarding/validar-token?token=${tokenParaValidar}`);
      const resJson = await response.json();

      if (!response.ok || !resJson.success) {
        throw new Error(resJson.message || 'El código de activación no es válido o ha expirado.');
      }

      setClientData(resJson.data);
      if (resJson.data) {
        if (resJson.data.email_portal) {
          setEmail(resJson.data.email_portal);
        }
        if (resJson.data.email_portal_nombre) {
          setNombreContacto(resJson.data.email_portal_nombre);
        }
        if (resJson.data.email_portal_cargo) {
          const c = resJson.data.email_portal_cargo;
          const opcionesPredeterminadas = ['Dueño / Titular', 'Socio', 'Encargado de Compras', 'Administración', 'Colaborador'];
          if (opcionesPredeterminadas.includes(c)) {
            setCargo(c);
          } else {
            setCargo('Otro');
            setOtroCargo(c);
          }
        }
      }
      setIsValid(true);
      setStep(2); // Avanzar al paso de contraseña

    } catch (err) {
      console.error('Error validando token:', err.message);
      Swal.fire({
        title: 'Código Inválido',
        text: err.message,
        icon: 'error',
        confirmButtonText: 'Entendido',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
      setIsValid(false);
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password || !confirmPassword || !nombreContacto) {
      Swal.fire({
        title: 'Campos Incompletos',
        text: 'Por favor, complete todos los campos obligatorios, incluyendo su nombre y apellido.',
        icon: 'warning',
        confirmButtonText: 'Entendido',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
      return;
    }

    if (cargo === 'Otro' && !otroCargo.trim()) {
      Swal.fire({
        title: 'Especificar Cargo',
        text: 'Por favor, especifique su cargo en la empresa.',
        icon: 'warning',
        confirmButtonText: 'Entendido',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
      return;
    }

    if (password !== confirmPassword) {
      Swal.fire({
        title: 'Claves Diferentes',
        text: 'La contraseña y su confirmación no coinciden.',
        icon: 'warning',
        confirmButtonText: 'Entendido',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
      return;
    }

    if (password.length < 6) {
      Swal.fire({
        title: 'Clave Corta',
        text: 'La contraseña de seguridad debe poseer al menos 6 caracteres.',
        icon: 'warning',
        confirmButtonText: 'Entendido',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
      return;
    }

    setSubmitting(true);
    try {
      const cargoFinal = cargo === 'Otro' ? otroCargo.trim() : cargo;
      const response = await fetch(`${API_BASE_URL}/api/logistica/b2b-onboarding/completar-onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          email: email.trim(),
          password,
          nombre_contacto: nombreContacto.trim(),
          cargo_contacto: cargoFinal
        })
      });

      const resJson = await response.json();

      if (!response.ok || !resJson.success) {
        throw new Error(resJson.message || 'Ocurrió un error al registrar la cuenta comercial.');
      }

      localStorage.setItem('prefilled_email', email.trim());

      // Autologin en Supabase Auth
      console.log('☁️  [Onboarding] Autologin iniciado...');
      let loginSuccess = false;
      try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });
        if (authError) throw authError;
        loginSuccess = true;
      } catch (authErr) {
        console.warn('⚠️ Autologin falló, redirigiendo a login manual:', authErr.message);
      }

      // Detectar si el dispositivo es un iPhone / iPad (iOS Safari)
      const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

      if (loginSuccess) {
        if (isiOS) {
          // Guía manual premium de instalación para iOS/Safari
          await Swal.fire({
            title: '¡Bienvenido a LAMDA!',
            html: `
              <div style="text-align: left; font-size: 14px; line-height: 1.6; color: var(--text-primary); font-family: sans-serif;">
                <p style="margin-top: 0; margin-bottom: 12px;">Tu cuenta ha sido activada y se inició sesión automáticamente.</p>
                <div style="background: rgba(142, 71, 133, 0.15); padding: 12px; border-radius: 8px; border-left: 4px solid var(--accent); margin-bottom: 12px;">
                  <p style="font-weight: bold; color: var(--accent); margin: 0 0 6px 0; display: flex; align-items: center; gap: 6px;">
                    📲 Acceso Directo en tu iPhone
                  </p>
                  <p style="margin: 0; font-size: 13px; color: var(--text-secondary);">
                    Para abrir el portal al instante como una aplicación:
                  </p>
                  <ol style="margin: 8px 0 0 0; padding-left: 20px; font-size: 13px; color: var(--text-primary);">
                    <li style="margin-bottom: 4px;">Tocá el botón <strong>Compartir</strong> 📤 en Safari.</li>
                    <li>Elegí la opción <strong>"Agregar a inicio"</strong> ➕.</li>
                  </ol>
                </div>
              </div>
            `,
            icon: 'success',
            confirmButtonText: 'Entrar al Portal',
            confirmButtonColor: 'var(--accent)',
            background: 'hsl(222, 47%, 11%)',
            color: 'var(--text-primary)',
            iconColor: 'var(--success)'
          });
        } else if (window.deferredPrompt) {
          // Promoción de instalación automatizada para Android/PC (bypasseando fricciones)
          const promptResult = await Swal.fire({
            title: '¡Bienvenido a LAMDA!',
            html: `
              <div style="text-align: left; font-size: 14px; line-height: 1.6; color: var(--text-primary); font-family: sans-serif;">
                <p style="margin-top: 0; margin-bottom: 12px;">Tu cuenta ha sido activada y se inició sesión automáticamente.</p>
                <p style="font-weight: 600; color: var(--accent); margin-bottom: 6px;">📲 ¿Querés crear un acceso directo en tu celular?</p>
                <p style="font-size: 13px; color: var(--text-secondary); margin: 0;">Esto instalará el portal de LAMDA en tu pantalla de inicio para un acceso 100% directo y sin demoras.</p>
              </div>
            `,
            icon: 'success',
            showCancelButton: true,
            confirmButtonText: '📲 Crear Acceso Directo',
            cancelButtonText: 'Ahora no',
            confirmButtonColor: 'var(--accent)',
            cancelButtonColor: '#64748b',
            background: 'hsl(222, 47%, 11%)',
            color: 'var(--text-primary)',
            iconColor: 'var(--success)'
          });

          if (promptResult.isConfirmed && window.deferredPrompt) {
            const promptEvent = window.deferredPrompt;
            promptEvent.prompt();
            const { outcome } = await promptEvent.userChoice;
            console.log(`[PWA] Install prompt outcome: ${outcome}`);
            window.deferredPrompt = null;
          }
        } else {
          // Fallback Toast
          Swal.fire({
            title: '¡Cuenta Activada!',
            text: 'Su cuenta ha sido activada y se ha iniciado sesión automáticamente.',
            icon: 'success',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            background: 'hsl(222, 47%, 11%)',
            color: 'var(--text-primary)',
            iconColor: 'var(--success)',
          });
        }
        onNavigate('/');
      } else {
        // Redirigir a login manual si falló autologin
        Swal.fire({
          title: '¡Activación Exitosa!',
          text: 'Su cuenta ha sido vinculada correctamente. Ingrese con su correo y contraseña.',
          icon: 'success',
          confirmButtonText: 'Ingresar al Portal',
          confirmButtonColor: 'var(--accent)',
          background: 'hsl(222, 47%, 11%)',
          color: 'var(--text-primary)',
        }).then(() => {
          onNavigate('/');
        });
      }

    } catch (err) {
      console.error('Error al registrar usuario:', err.message);
      Swal.fire({
        title: 'Error de Registro',
        text: err.message,
        icon: 'error',
        confirmButtonText: 'Volver a intentar',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (validating) {
    return (
      <div className="login-wrapper">
        <div className="login-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem' }}>
          <Loader2 className="spinner" style={{ width: '40px', height: '40px', color: 'var(--accent)', marginBottom: '1.5rem' }} />
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>Procesando código de activación...</p>
        </div>
      </div>
    );
  }

  // Paso 1: Introducir / Confirmar el Código de Acceso
  if (step === 1) {
    return (
      <div className="login-wrapper">
        <div className="login-card">
          <div className="login-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '2.5rem' }}>
            <img src="/logo_LAMDA.png" alt="LAMDA Logo" style={{ maxHeight: '54px', maxWidth: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }} />
            <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--accent)', letterSpacing: '0.05em', marginTop: '-0.25rem', textTransform: 'lowercase' }}>activación de cuenta</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: '700' }}>
                Ingresá tu Código de Acceso
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Introducí la clave de invitación recibida por WhatsApp o Correo para comenzar la activación.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="token-input">Código de Activación</label>
              <div className="input-wrapper">
                <Lock className="input-icon" size={18} />
                <input
                  id="token-input"
                  type="text"
                  required
                  className="form-input"
                  placeholder="Ingrese el código de seguridad"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  style={{ textTransform: 'none' }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!token.trim()) {
                  Swal.fire({
                    title: 'Código Requerido',
                    text: 'Por favor, ingrese el código de activación.',
                    icon: 'warning',
                    confirmButtonColor: 'var(--accent)',
                    background: 'hsl(222, 47%, 11%)',
                    color: 'var(--text-primary)',
                  });
                  return;
                }
                validarTokenInvitacion(token.trim());
              }}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
            >
              <span>Validar Código y Continuar</span>
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
              Cancelar y volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Paso 2: Completar Datos y Crear Contraseña
  const isReactivation = !!(clientData && clientData.email_portal);

  return (
    <div className="login-wrapper">
      <div className="login-card">
        {/* Encabezado */}
        <div className="login-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '2rem' }}>
          <img src="/logo_LAMDA.png" alt="LAMDA Logo" style={{ maxHeight: '54px', maxWidth: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }} />
          <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--accent)', letterSpacing: '0.05em', marginTop: '-0.25rem', textTransform: 'lowercase' }}>{isReactivation ? 'restablecer contraseña' : 'configurar credenciales'}</span>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Distribuidor Asociado</span>
            <h3 style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: '700', marginTop: '0.25rem' }}>
              {clientData?.razon_social || 'Cliente Comercial'}
            </h3>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Código: {clientData?.cliente_id}
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="email">{isReactivation ? 'Correo de Acceso (Confirmado)' : 'Correo de Acceso'}</label>
            <div className="input-wrapper">
              <Mail className="input-icon" size={18} />
              <input
                id="email"
                type="email"
                required
                disabled={submitting}
                readOnly={isReactivation}
                className="form-input"
                style={{ backgroundColor: isReactivation ? 'rgba(255, 255, 255, 0.05)' : '', cursor: isReactivation ? 'not-allowed' : '' }}
                placeholder="ejemplo@portal.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => !isReactivation && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                autoComplete="email"
              />
            </div>
            {showSuggestions && (
              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                {suggestions.map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => handleSuggestionClick(sug)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-glass)',
                      borderRadius: '4px',
                      color: 'var(--text-secondary)',
                      fontSize: '0.75rem',
                      padding: '0.2rem 0.45rem',
                      cursor: 'pointer',
                      transition: 'var(--transition-smooth)',
                      outline: 'none'
                    }}
                    onMouseOver={(e) => {
                      e.target.style.background = 'var(--accent)';
                      e.target.style.color = 'var(--text-primary)';
                    }}
                    onMouseOut={(e) => {
                      e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                      e.target.style.color = 'var(--text-secondary)';
                    }}
                  >
                    {sug}
                  </button>
                ))}
              </div>
            )}
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {isReactivation 
                ? 'Este correo ya está registrado y se utilizará para ingresar al portal.'
                : 'Este correo será su usuario para iniciar sesión en el portal.'}
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="nombreContacto">Nombre y Apellido del Responsable</label>
            <div className="input-wrapper">
              <User className="input-icon" size={18} />
              <input
                id="nombreContacto"
                type="text"
                required
                disabled={submitting}
                className="form-input"
                placeholder="Ej: Nicolás Serrano"
                value={nombreContacto}
                onChange={(e) => setNombreContacto(e.target.value)}
              />
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Nombre de la persona física encargada de operar la cuenta comercial.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="cargo">Cargo / Rol en la Empresa</label>
            <div className="input-wrapper">
              <Briefcase className="input-icon" size={18} />
              <select
                id="cargo"
                className="form-input"
                disabled={submitting}
                value={cargo}
                onChange={(e) => setCargo(e.target.value)}
                style={{ backgroundColor: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)' }}
              >
                <option value="Dueño / Titular" style={{ background: '#0f172a' }}>Dueño / Titular</option>
                <option value="Socio" style={{ background: '#0f172a' }}>Socio</option>
                <option value="Encargado de Compras" style={{ background: '#0f172a' }}>Encargado de Compras</option>
                <option value="Administración" style={{ background: '#0f172a' }}>Administración</option>
                <option value="Colaborador" style={{ background: '#0f172a' }}>Colaborador</option>
                <option value="Otro" style={{ background: '#0f172a' }}>Otro (Especificar)</option>
              </select>
            </div>
          </div>

          {cargo === 'Otro' && (
            <div className="form-group">
              <label className="form-label" htmlFor="otroCargo">Especifique su Cargo</label>
              <div className="input-wrapper">
                <input
                  id="otroCargo"
                  type="text"
                  required
                  disabled={submitting}
                  className="form-input"
                  placeholder="Ej: Gerente de Ventas"
                  value={otroCargo}
                  onChange={(e) => setOtroCargo(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Advertencia Humana de Encriptación y Seguridad */}
          <div style={{ background: 'rgba(142, 71, 133, 0.1)', borderLeft: '4px solid var(--accent)', padding: '12px', borderRadius: '6px', fontSize: '0.85rem', lineHeight: '1.45', color: 'var(--text-primary)', fontFamily: 'sans-serif' }}>
            Establecé tu contraseña. Esta clave es absolutamente personal, está encriptada de forma segura y nadie (ni en LAMDA, ni en ninguna parte del mundo) puede verla.
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Crea tu contraseña para el portal</label>
            <div className="input-wrapper" style={{ position: 'relative' }}>
              <Lock className="input-icon" size={18} />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                disabled={submitting}
                className="form-input"
                style={{ paddingRight: '40px' }}
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  outline: 'none'
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="confirmPassword">Repite tu contraseña</label>
            <div className="input-wrapper" style={{ position: 'relative' }}>
              <Lock className="input-icon" size={18} />
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                required
                disabled={submitting}
                className="form-input"
                style={{ paddingRight: '40px' }}
                placeholder="Repita la contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  outline: 'none'
                }}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={submitting}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
          >
            {submitting ? (
              <>
                <Loader2 className="spinner" style={{ width: '18px', height: '18px', borderTopColor: 'var(--text-primary)' }} />
                <span>{isReactivation ? 'Actualizando...' : 'Registrando...'}</span>
              </>
            ) : (
              <span>{isReactivation ? 'Actualizar mi Cuenta B2B' : 'Activar mi Cuenta'}</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setStep(1)}
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
            Volver al código
          </button>
        </form>
      </div>
    </div>
  );
}
