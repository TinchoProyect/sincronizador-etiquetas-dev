import React, { useState, useEffect } from 'react';
import { Mail, Lock, Loader2, ArrowLeft, User, Eye, EyeOff } from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../supabaseClient';
import {
  sincronizarDirectorioCloud,
  encontrarClienteB2BAsync,
  buscarInvitacionActivaCloud
} from '../utils/clientesB2B';

const API_BASE_URL = import.meta.env.DEV 
  ? (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005') 
  : '';

export default function Onboarding({ onNavigate }) {
  const [tokenInput, setTokenInput] = useState(''); // Estado para la clave corta (6 caracteres) o código de cliente
  const [token, setToken] = useState(''); // Estado para la clave de 64 caracteres final de registro
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
  const [submitting, setSubmitting] = useState(false);

  // Leer token o código corto (?t=...) de la URL en el montaje
  useEffect(() => {
    sincronizarDirectorioCloud(supabase).catch(() => {});

    let urlToken = null;
    const params = new URLSearchParams(window.location.search);
    urlToken = params.get('token');

    if (!urlToken && window.location.hash.includes('?')) {
      const hashQuery = window.location.hash.split('?')[1];
      const hashParams = new URLSearchParams(hashQuery);
      urlToken = hashParams.get('token') || hashParams.get('t');
    }

    if (!urlToken) {
      const shortT = params.get('t');
      if (shortT && /^[a-f0-9]{6,64}$/i.test(shortT.trim())) {
        urlToken = shortT.trim();
      }
    }
    
    if (urlToken) {
      const cleanToken = urlToken.trim();
      setTokenInput(cleanToken.substring(0, 6));
      validarTokenInvitacion(cleanToken);
    }
  }, []);

  const validarTokenInvitacion = async (tokenParaValidar) => {
    setValidating(true);
    try {
      const cleanInput = (tokenParaValidar || '').trim();
      console.log(`📡 [Supabase Cloud] Validando código o cliente en Onboarding: ${cleanInput}`);

      // Buscar invitación activa por código corto (6 chars), token completo (64 chars) o Nº de Cliente / Legacy / CUIT
      let supaData = await buscarInvitacionActivaCloud(cleanInput, supabase);

      if (!supaData) {
        // Intento directo adicional por prefijo de token
        const isShortCode = cleanInput.length === 6;
        let query = supabase
          .from('clientes_b2b_invitaciones')
          .select('*')
          .eq('usado', false);

        if (isShortCode) {
          query = query.ilike('token', `${cleanInput}%`);
        } else {
          query = query.eq('token', cleanInput);
        }

        const { data: fallbackInv } = await query
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fallbackInv && new Date(fallbackInv.expires_at) > new Date()) {
          supaData = fallbackInv;
        }
      }

      if (!supaData) {
        // Si ingresó un código de cliente válido (ej: 010 o CB-0059) pero no hay invitación sin usar, ofrecer validación por WhatsApp
        const clienteMatch = await encontrarClienteB2BAsync(cleanInput, supabase);
        if (clienteMatch) {
          setValidating(false);
          const resSwal = await Swal.fire({
            title: `Hola, ${clienteMatch.razon_social || clienteMatch.nombre}`,
            text: 'No encontramos un código de invitación pendiente, pero podemos enviarte un código de 4 números a tu WhatsApp ahora mismo para activar tu cuenta.',
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: 'Activar por WhatsApp',
            cancelButtonText: 'Probar otro código',
            confirmButtonColor: 'var(--accent)',
            background: 'hsl(222, 47%, 11%)',
            color: 'var(--text-primary)',
          });
          if (resSwal.isConfirmed) {
            localStorage.setItem('prefilled_identifier', clienteMatch.bunker_id);
            onNavigate('#/activar');
          }
          return;
        }
        throw new Error('El código de activación no es válido, ya fue utilizado o ha expirado.');
      }

      if (new Date(supaData.expires_at) < new Date()) {
        throw new Error('El código de activación ha expirado.');
      }

      setClientData(supaData);
      if (supaData.token) {
        setToken(supaData.token);
      }
      if (supaData.email_portal && !supaData.email_portal.endsWith('@lamdaclientes.com')) {
        setEmail(supaData.email_portal.trim());
      }

      let inferredName = (supaData.email_portal_nombre || '').trim();
      if (!inferredName && supaData.email_portal_cargo && String(supaData.email_portal_cargo).trim().startsWith('{')) {
        try {
          const meta = JSON.parse(supaData.email_portal_cargo);
          if (meta.contact_name) inferredName = String(meta.contact_name).trim();
        } catch (e) {}
      }

      if (
        inferredName &&
        !inferredName.includes('@') &&
        !inferredName.toLowerCase().endsWith('.com') &&
        !inferredName.toLowerCase().endsWith('.com.ar') &&
        inferredName.toLowerCase() !== 'cliente b2b'
      ) {
        setNombreContacto(inferredName);
      } else {
        setNombreContacto('');
      }

      setIsValid(true);
      setStep(2);

    } catch (err) {
      console.error('Error validando token en la nube:', err.message);
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
    const cleanEmail = email.trim().toLowerCase();
    const cleanNombre = nombreContacto.trim();

    if (!cleanEmail || !password || !confirmPassword || !cleanNombre) {
      Swal.fire({
        title: 'Campos Incompletos',
        text: 'Por favor, ingrese su nombre, correo y contraseña.',
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
      const cargoFinal = 'Dueño / Titular';
      let onboardingCompleted = false;

      // 1. Si estamos en red local / desarrollo, intentar directamente con el backend local
      if (import.meta.env.DEV) {
        try {
          console.log('📡 [Onboarding] Intentando completar registro vía backend local...');
          const response = await fetch(`${API_BASE_URL}/api/logistica/b2b-onboarding/completar-onboarding`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              email: cleanEmail,
              password,
              nombre_contacto: cleanNombre,
              cargo_contacto: cargoFinal
            })
          });

          const resJson = await response.json();
          if (response.ok && resJson.success) {
            onboardingCompleted = true;
            console.log('✅ [Onboarding] Registro completado en backend local.');
          }
        } catch (localErr) {
          console.warn('⚠️ [Onboarding] Backend local no disponible en DEV:', localErr.message);
        }
      }

      // 2. Canal Cloud Dispatcher (ONBOARD-REQ vía telemetria_accesos): provisiona Auth, Perfil y Listas Reales con Service Key
      if (!onboardingCompleted && clientData?.cliente_id) {
        try {
          const reqId = Math.random().toString(36).substring(2, 8).toUpperCase();
          const payloadB64 = btoa(unescape(encodeURIComponent(JSON.stringify({
            token,
            email: cleanEmail,
            password,
            nombre_contacto: cleanNombre,
            cargo_contacto: cargoFinal
          }))));

          const { error: insErr } = await supabase
            .from('telemetria_accesos')
            .insert([{
              cliente_nombre: clientData.cliente_id,
              dispositivo: payloadB64,
              tipo_acceso: `ONBOARD-REQ-${reqId}-${clientData.cliente_id}`
            }]);

          if (!insErr) {
            for (let attempt = 1; attempt <= 8; attempt++) {
              await new Promise(r => setTimeout(r, 600));
              const { data: resRow } = await supabase
                .from('telemetria_accesos')
                .select('tipo_acceso, dispositivo')
                .or(`tipo_acceso.eq.ONBOARD-RES-${reqId}-DONE,tipo_acceso.eq.ONBOARD-RES-${reqId}-ERROR`)
                .limit(1)
                .maybeSingle();

              if (resRow) {
                if (resRow.tipo_acceso.endsWith('-DONE')) {
                  onboardingCompleted = true;
                  console.log('✅ [Onboarding] Alta aprovisionada vía Cloud Dispatcher (Service Key).');
                }
                break;
              }
            }
          }
        } catch (dispErr) {
          console.warn('⚠️ [Onboarding] Advertencia en Cloud Dispatcher:', dispErr.message);
        }
      }

      // 3. Fallback autónomo 24/7 en Supabase Cloud (por si el servidor de la oficina está apagado)
      if (!onboardingCompleted) {
        console.log('☁️ [Onboarding] Ejecutando alta autónoma en Supabase Auth...');
        const { error: signUpErr } = await supabase.auth.signUp({
          email: cleanEmail,
          password: password,
          options: {
            data: {
              cliente_id: clientData.cliente_id,
              nombre_completo: cleanNombre,
              nombre_empresa: clientData.razon_social,
              invitation_token: token
            }
          }
        });

        if (signUpErr && !String(signUpErr.message || '').toLowerCase().includes('already registered')) {
          throw signUpErr;
        }
        onboardingCompleted = true;
      }

      localStorage.setItem('prefilled_email', cleanEmail);

      // Autologin en Supabase Auth
      console.log('☁️  [Onboarding] Autologin iniciado...');
      let loginSuccess = false;
      try {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: password,
        });
        if (authError) throw authError;
        await supabase.auth.refreshSession().catch(() => {});
        loginSuccess = true;
      } catch (authErr) {
        console.warn('⚠️ Autologin falló, redirigiendo a login manual:', authErr.message);
      }

      if (loginSuccess) {
        sessionStorage.setItem('just_activated', 'true');
        localStorage.removeItem('pwa_install_dismissed');
        await Swal.fire({
          title: '¡Cuenta Activada!',
          text: 'Tu cuenta ha sido activada con éxito. Ingresando al portal...',
          icon: 'success',
          timer: 1500,
          showConfirmButton: false,
          background: 'hsl(222, 47%, 11%)',
          color: 'var(--text-primary)',
          iconColor: 'var(--success)'
        });
        onNavigate('/');
      } else {
        sessionStorage.setItem('just_activated', 'true');
        localStorage.removeItem('pwa_install_dismissed');
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

  // Paso 1: Introducir / Confirmar el Código de Acceso o Nº de Cliente
  if (step === 1) {
    return (
      <div className="login-wrapper">
        <div className="login-card">
          <div className="login-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '2.5rem' }}>
            <img src="/logo_LAMDA.png?v=4" alt="LAMDA Logo" style={{ maxHeight: '54px', maxWidth: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }} />
            <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--accent)', letterSpacing: '0.05em', marginTop: '-0.25rem', textTransform: 'lowercase' }}>activación de cuenta</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: '700' }}>
                Activá tu Cuenta Comercial
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Ingresá el código de activación recibido por WhatsApp o tu Nº de Cliente (ej: 010 o CB-0059).
              </p>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="token-input">Código de Activación o Nº de Cliente</label>
              <div className="input-wrapper">
                <Lock className="input-icon" size={18} />
                <input
                  id="token-input"
                  type="text"
                  required
                  className="form-input"
                  placeholder="Código de WhatsApp o Nº de cliente"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tokenInput.trim()) {
                      e.preventDefault();
                      validarTokenInvitacion(tokenInput.trim());
                    }
                  }}
                  style={{ textTransform: 'none' }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!tokenInput.trim()) {
                  Swal.fire({
                    title: 'Código Requerido',
                    text: 'Por favor, ingrese su código de activación o número de cliente.',
                    icon: 'warning',
                    confirmButtonColor: 'var(--accent)',
                    background: 'hsl(222, 47%, 11%)',
                    color: 'var(--text-primary)',
                  });
                  return;
                }
                validarTokenInvitacion(tokenInput.trim());
              }}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
            >
              <span>Validar y Continuar</span>
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
  return (
    <div className="login-wrapper">
      <div className="login-card">
        {/* Encabezado */}
        <div className="login-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', marginBottom: '1.75rem' }}>
          <img src="/logo_LAMDA.png?v=4" alt="LAMDA Logo" style={{ maxHeight: '48px', maxWidth: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--accent)', letterSpacing: '0.04em' }}>
            activar cuenta comercial
          </span>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '0.5rem', paddingBottom: '0.65rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <h3 style={{ color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: '700', margin: 0 }}>
              {clientData?.razon_social || 'Cliente Comercial'}
            </h3>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.2rem', display: 'inline-block' }}>
              Código de Cliente: {clientData?.cliente_id}
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="nombreContacto">Nombre y Apellido</label>
            <div className="input-wrapper">
              <User className="input-icon" size={18} />
              <input
                id="nombreContacto"
                type="text"
                required
                disabled={submitting}
                className="form-input"
                placeholder="Tu nombre y apellido"
                value={nombreContacto}
                onChange={(e) => setNombreContacto(e.target.value)}
                autoComplete="name"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="email">Correo Electrónico</label>
            <div className="input-wrapper">
              <Mail className="input-icon" size={18} />
              <input
                id="email"
                type="email"
                required
                disabled={submitting}
                className="form-input"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Contraseña</label>
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
            <label className="form-label" htmlFor="confirmPassword">Confirmar Contraseña</label>
            <div className="input-wrapper" style={{ position: 'relative' }}>
              <Lock className="input-icon" size={18} />
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                required
                disabled={submitting}
                className="form-input"
                style={{ paddingRight: '40px' }}
                placeholder="Repetí tu contraseña"
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
                <span>Activando cuenta...</span>
              </>
            ) : (
              <span>Activar mi Cuenta</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setStep(1)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              marginTop: '0.25rem'
            }}
          >
            <ArrowLeft size={15} />
            <span>Volver</span>
          </button>
        </form>
      </div>
    </div>
  );
}
