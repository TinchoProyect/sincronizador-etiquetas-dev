import React, { useState, useEffect } from 'react';
import { Mail, Lock, Loader2, ArrowLeft, User, Briefcase, Eye, EyeOff } from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../supabaseClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005';

export default function Onboarding({ onNavigate }) {
  const [token, setToken] = useState('');
  const [validating, setValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [clientData, setClientData] = useState(null);

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

  // Leer token de URL en el montaje
  useEffect(() => {
    let urlToken = null;
    const params = new URLSearchParams(window.location.search);
    urlToken = params.get('token');

    if (!urlToken && window.location.hash.includes('?')) {
      const hashQuery = window.location.hash.split('?')[1];
      const hashParams = new URLSearchParams(hashQuery);
      urlToken = hashParams.get('token');
    }
    
    if (!urlToken) {
      setValidating(false);
      setIsValid(false);
      Swal.fire({
        title: 'Token Ausente',
        text: 'No se especificó un token de activación en el enlace.',
        icon: 'error',
        confirmButtonText: 'Ir a Activación',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      }).then(() => {
        onNavigate('/activar');
      });
      return;
    }

    setToken(urlToken);
    validarTokenInvitacion(urlToken);
  }, []);

  const validarTokenInvitacion = async (tokenParaValidar) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/logistica/b2b-onboarding/validar-token?token=${tokenParaValidar}`);
      const resJson = await response.json();

      if (!response.ok || !resJson.success) {
        throw new Error(resJson.message || 'El enlace de invitación no es válido o ha expirado.');
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

    } catch (err) {
      console.error('Error validando token:', err.message);
      Swal.fire({
        title: 'Enlace Inválido',
        text: err.message,
        icon: 'error',
        confirmButtonText: 'Obtener nuevo código',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      }).then(() => {
        onNavigate('/activar');
      });
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

      // Guardar en localStorage por si acaso se requiera manual en algún momento (Opción B)
      localStorage.setItem('prefilled_email', email.trim());

      // Logueo Directo (Opción A): Intentamos iniciar sesión automáticamente en Supabase Auth
      console.log('☁️  [Onboarding] Autologin iniciado...');
      try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });
        if (authError) throw authError;

        Swal.fire({
          title: '¡Cuenta Activada!',
          text: 'Su cuenta ha sido activada y se ha iniciado sesión de forma automática.',
          icon: 'success',
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 3000,
          background: 'hsl(222, 47%, 11%)',
          color: 'var(--text-primary)',
          iconColor: 'var(--success)',
        });
        
        onNavigate('/');
        return; // Éxito completo con autologin
      } catch (authErr) {
        console.warn('⚠️  Autologin falló, redirigiendo a login manual:', authErr.message);
      }

      // Fallback si falla autologin
      Swal.fire({
        title: '¡Activación Exitosa!',
        text: 'Su cuenta ha sido vinculada correctamente. Ingrese su contraseña para acceder.',
        icon: 'success',
        confirmButtonText: 'Ingresar al Portal',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      }).then(() => {
        onNavigate('/');
      });

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
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>Validando enlace de activación...</p>
        </div>
      </div>
    );
  }

  if (!isValid) {
    return null; // Redirige en useEffect
  }

  const isReactivation = !!(clientData && clientData.email_portal);

  return (
    <div className="login-wrapper">
      <div className="login-card">
        {/* Encabezado */}
        <div className="login-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '2rem' }}>
          <img src="/logo_LAMDA.png" alt="LAMDA Logo" style={{ height: '54px', width: 'auto', objectFit: 'contain' }} />
          <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--accent)', letterSpacing: '0.05em', marginTop: '-0.25rem', textTransform: 'lowercase' }}>{isReactivation ? 'restablecer contraseña b2b' : 'configurar credenciales b2b'}</span>
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
                ? 'Este correo ya está registrado y se utilizará para ingresar al portal B2B.'
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

          <div className="form-group">
            <label className="form-label" htmlFor="password">Crea tu nueva contraseña para el portal</label>
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
            <label className="form-label" htmlFor="confirmPassword">Repite tu nueva contraseña</label>
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
              <span>{isReactivation ? 'Actualizar mi Cuenta B2B' : 'Activar mi Cuenta B2B'}</span>
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
            Cancelar y volver
          </button>
        </form>
      </div>
    </div>
  );
}
