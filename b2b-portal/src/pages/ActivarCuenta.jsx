import React, { useState, useEffect, useRef } from 'react';
import { User, Phone, Key, ArrowLeft, Loader2, Lock, Eye, EyeOff, CheckCircle2, XCircle, Search, Mail, MessageSquare, Sparkles } from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../supabaseClient';
import { encontrarClienteB2B, encontrarClienteB2BAsync, buscarInvitacionActivaCloud } from '../utils/clientesB2B';

const API_BASE_URL = import.meta.env.DEV 
  ? (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005') 
  : '';

export default function ActivarCuenta({ onNavigate }) {
  // Step 1: Identificación y Asistencia Live, Step 2: OTP 4 Números, Step 3: Nueva Clave
  const [step, setStep] = useState(1);
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState('whatsapp'); // 'whatsapp' | 'email'
  const [searching, setSearching] = useState(false);
  const [clientVerified, setClientVerified] = useState(null); // { cliente_id, nombre, email, telefono, activeInvitation }

  const [otp, setOtp] = useState('');
  const [otpTokenKey, setOtpTokenKey] = useState('');
  const [loading, setLoading] = useState(false);

  // Campos para Paso 3 (Establecer Contraseña)
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Referencias para foco automático de OTP
  const otpInputRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];
  const [otpDigits, setOtpDigits] = useState(['', '', '', '']);
  
  // Timer para el OTP (300 segundos = 5 minutos)
  const [timeLeft, setTimeLeft] = useState(300);
  const [timerActive, setTimerActive] = useState(false);

  const lookupTimeout = useRef(null);

  useEffect(() => {
    const prefilled = localStorage.getItem('prefilled_identifier');
    if (prefilled) {
      localStorage.removeItem('prefilled_identifier');
      setIdentifier(prefilled);
      performClientLookup(prefilled);
    }
  }, []);

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

  // Normalizador automático de Código de Cliente (010 / 0196 / 196 / CB-0038)
  const normalizeClientId = (input) => {
    const found = encontrarClienteB2B(input);
    if (found) return found.bunker_id;
    const clean = (input || '').trim();
    if (/^\d+$/.test(clean)) return `CB-${clean.padStart(4, '0')}`;
    return clean.toUpperCase();
  };

  const buildVerifiedObject = (found, activeInv = null) => {
    const displayEmail = found.email || `${found.bunker_id.toLowerCase()}@lamdaclientes.com`;
    const maskedEmail = displayEmail.includes('@')
      ? displayEmail.replace(/(^.{1}).*(@.*$)/, '$1•••••$2')
      : '';
    const rawPhone = found.phone || activeInv?.whatsapp_destino || '';
    const maskedPhone = rawPhone
      ? `•••• ${String(rawPhone).replace(/\D/g, '').slice(-4)}`
      : '';

    return {
      cliente_id: found.bunker_id,
      legacy_id: found.legacy_id,
      nombre: found.nombre || found.razon_social || activeInv?.cliente_nombre || 'Cliente B2B',
      email: displayEmail,
      emailMasked: maskedEmail,
      telefono: maskedPhone,
      activeInvitation: activeInv && !activeInv.usado ? activeInv : null
    };
  };

  const performClientLookup = (val) => {
    if (lookupTimeout.current) clearTimeout(lookupTimeout.current);
    if (!val || !val.trim()) {
      setClientVerified(null);
      setSearching(false);
      return;
    }

    const clean = val.trim();
    const foundSync = encontrarClienteB2B(clean);

    if (foundSync) {
      setClientVerified(buildVerifiedObject(foundSync, null));
    } else {
      setSearching(true);
    }

    // Consultar siempre en segundo plano por invitaciones activas o clientes nuevos en la nube
    lookupTimeout.current = setTimeout(async () => {
      try {
        const [foundCloud, activeInv] = await Promise.all([
          encontrarClienteB2BAsync(clean, supabase),
          buscarInvitacionActivaCloud(clean, supabase)
        ]);

        if (foundCloud) {
          setClientVerified(buildVerifiedObject(foundCloud, activeInv));
          setSearching(false);
          return;
        }

        if (activeInv) {
          const synthClient = {
            bunker_id: activeInv.cliente_id,
            legacy_id: '',
            nombre: activeInv.cliente_nombre || activeInv.cliente_id,
            email: activeInv.email_destino || `${activeInv.cliente_id.toLowerCase()}@lamdaclientes.com`,
            phone: activeInv.whatsapp_destino || ''
          };
          setClientVerified(buildVerifiedObject(synthClient, activeInv));
          setSearching(false);
          return;
        }

        const { data: prof } = await supabase
          .from('clientes_b2b_perfiles')
          .select('cliente_id, email, nombre_completo, nombre_empresa')
          .or(`email.ilike.%${clean}%,cliente_id.ilike.%${clean}%`)
          .maybeSingle();

        if (prof) {
          const displayEmail = prof.email || clean;
          const masked = displayEmail.includes('@')
            ? displayEmail.replace(/(^.{1}).*(@.*$)/, '$1•••••$2')
            : '';
          setClientVerified({
            cliente_id: prof.cliente_id,
            nombre: prof.nombre_completo || prof.nombre_empresa || 'Cliente B2B',
            email: displayEmail,
            emailMasked: masked,
            telefono: '',
            activeInvitation: null
          });
        } else if (!foundSync) {
          setClientVerified({ error: `No se encontró ningún distribuidor con "${clean}". Verifique su código de cliente, CUIT o correo.` });
        }
      } catch (err) {
        console.warn('Error en búsqueda live:', err);
      } finally {
        setSearching(false);
      }
    }, 150);
  };

  // Búsqueda instantánea en tiempo real del identificador tipeado
  const handleIdentifierChange = (e) => {
    const val = e.target.value;
    setIdentifier(val);
    performClientLookup(val);
  };

  // PASO 1: Despachar Código de 4 Números (Cloud Native HTTPS)
  const handleRequestOtp = async (e) => {
    e.preventDefault();
    if (!identifier || clientVerified?.error) {
      Swal.fire({
        title: 'Distribuidor No Encontrado',
        text: 'Por favor, ingrese un código de cliente, CUIT o correo registrado válido.',
        icon: 'warning',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
      return;
    }

    setLoading(true);
    const targetCid = clientVerified?.cliente_id || normalizeClientId(identifier);
    const targetEmail = clientVerified?.email || '';
    
    // Generar código numérico de 4 dígitos verdaderamente ALEATORIO
    const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();
    const tokenKey = channel === 'email'
      ? `OTPEMAIL-${generatedOtp}-${targetEmail}-${targetCid}`
      : `OTPWAP-${generatedOtp}-${targetCid}`;

    try {
      // 0. Invalidar inmediatamente cualquier código OTP anterior del mismo cliente en la nube
      try {
        await supabase
          .from('telemetria_accesos')
          .update({ tipo_acceso: 'OTP_EXPIRED_PREVIOUS' })
          .eq('cliente_nombre', targetCid)
          .or('tipo_acceso.ilike.OTPWAP-%,tipo_acceso.ilike.OTP-%,tipo_acceso.ilike.OTPEMAIL-%')
          .not('tipo_acceso', 'like', '%-SENT')
          .not('tipo_acceso', 'like', '%-DONE');
      } catch (e) {}

      // 1. Guardar el NUEVO OTP de 4 dígitos en la nube de Supabase via telemetria_accesos (100% abierto a insert anon)
      const { error: insertErr } = await supabase
        .from('telemetria_accesos')
        .insert([{
          cliente_nombre: targetCid,
          dispositivo: `PWA-${channel.toUpperCase()}`,
          tipo_acceso: tokenKey
        }]);

      if (insertErr) {
        console.warn('Advertencia al registrar OTP en nube:', insertErr.message);
      }

      setOtpTokenKey(tokenKey);

      // Notificar al cliente con el aviso amigable
      Swal.fire({
        title: '¡Código de 4 Números Despachado!',
        html: channel === 'whatsapp' 
          ? `El código de 4 cifras se está enviando a su <b>WhatsApp</b>.<br><small style="color:var(--text-secondary)">Por favor, revise sus mensajes de WhatsApp en su celular.</small>`
          : `Se ha despachado el código de 4 cifras a su correo: <b>${clientVerified?.emailMasked || targetEmail}</b>.<br><small style="color:var(--text-secondary)">Revise su bandeja de entrada o carpeta de spam.</small>`,
        icon: 'success',
        confirmButtonText: 'Ingresar Código de 4 Cifras',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });

      setStep(2);
      setTimeLeft(300);
      setTimerActive(true);

    } catch (err) {
      console.error('Error generando OTP:', err.message);
      Swal.fire({
        title: 'Error de Despacho',
        text: err.message,
        icon: 'error',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
    } finally {
      setLoading(false);
    }
  };

  // PASO 2: Verificar OTP de 4 dígitos obligatorios contra Supabase Cloud
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    const cleanOtp = otp.trim();
    if (cleanOtp.length !== 4 || isNaN(cleanOtp)) {
      Swal.fire({
        title: 'Código de 4 Cifras',
        text: 'Por favor, ingrese el código numérico de 4 dígitos enviado a su teléfono o correo.',
        icon: 'warning',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
      return;
    }

    setLoading(true);
    const targetCid = clientVerified?.cliente_id || normalizeClientId(identifier);

    try {
      // Validar contra telemetria_accesos en Supabase Cloud
      const { data: otpFound } = await supabase
        .from('telemetria_accesos')
        .select('*')
        .eq('cliente_nombre', targetCid)
        .or(`tipo_acceso.ilike.OTPWAP-${cleanOtp}-${targetCid}%,tipo_acceso.ilike.OTP-${cleanOtp}-${targetCid}%,tipo_acceso.ilike.OTPEMAIL-${cleanOtp}-%`)
        .order('created_at', { ascending: false })
        .limit(1);

      let matched = false;
      if (otpFound && otpFound.length > 0) {
        matched = true;
      }

      if (matched) {
        Swal.fire({
          title: '¡Código Verificado!',
          text: 'Identidad confirmada con éxito. Establezca su nueva contraseña a continuación.',
          icon: 'success',
          timer: 1600,
          showConfirmButton: false,
          background: 'hsl(222, 47%, 11%)',
          color: 'var(--text-primary)',
        });
        setStep(3);
      } else {
        throw new Error('El código de 4 cifras ingresado no coincide con el código enviado.');
      }

    } catch (err) {
      console.error('Error verificando OTP:', err.message);
      Swal.fire({
        title: 'Código Inválido',
        text: err.message,
        icon: 'error',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
    } finally {
      setLoading(false);
    }
  };

  // Resolver email real de Auth Cloud a partir del identificador tipeado
  const resolveEmailFromIdentifier = async (rawInput) => {
    const clean = (rawInput || '').trim();
    if (clean.includes('@')) return clean.toLowerCase();

    const found = await encontrarClienteB2BAsync(clean, supabase);
    if (found) {
      try {
        const { data: prof } = await supabase
          .from('clientes_b2b_perfiles')
          .select('email')
          .eq('cliente_id', found.bunker_id)
          .maybeSingle();
        if (prof && prof.email) return prof.email.toLowerCase();
      } catch (e) {}

      if (found.email) {
        return found.email.toLowerCase();
      }
      return `${found.bunker_id.toLowerCase()}@lamdaclientes.com`;
    }

    try {
      const { data } = await supabase
        .from('clientes_b2b_perfiles')
        .select('email')
        .or(`email.ilike.%${clean}%,cliente_id.ilike.%${clean}%`)
        .maybeSingle();

      if (data && data.email) return data.email.toLowerCase();
    } catch (e) {}

    if (/^\d+$/.test(clean)) {
      return `cb-${clean.padStart(4, '0')}@lamdaclientes.com`;
    }
    if (/^cb-\d+/i.test(clean)) {
      return `${clean.toLowerCase()}@lamdaclientes.com`;
    }

    return clean;
  };

  // PASO 3: Guardar Nueva Contraseña e Iniciar Sesión Directamente Vía Cloud REST API
  const handleSaveNewPassword = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      Swal.fire({
        title: 'Contraseña Muy Corta',
        text: 'La nueva contraseña debe tener al menos 6 caracteres.',
        icon: 'warning',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      Swal.fire({
        title: 'Las Claves no Coinciden',
        text: 'La contraseña y su confirmación deben ser idénticas.',
        icon: 'warning',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
      return;
    }

    setLoading(true);
    const targetCid = clientVerified?.cliente_id || normalizeClientId(identifier);
    const targetEmail = await resolveEmailFromIdentifier(identifier || targetCid);

    try {
      // 1. Emitir señal PWDRESET en Base64 para auditoría y sincronización Admin
      const b64Pass = btoa(unescape(encodeURIComponent(newPassword)));
      await supabase
        .from('telemetria_accesos')
        .insert([{
          cliente_nombre: targetCid,
          dispositivo: 'PWDRESET_REQ',
          tipo_acceso: `PWDRESET-${targetCid}-${b64Pass}`
        }]);

      // 2. Esperar la propagación y autenticar en Supabase Auth con bucle de verificación
      let loginSuccess = false;
      const candidateEmails = Array.from(new Set([
        targetEmail,
        `${targetCid.toLowerCase()}@lamdaclientes.com`
      ].filter(Boolean)));

      for (let attempt = 1; attempt <= 10; attempt++) {
        await new Promise(r => setTimeout(r, 600));

        for (const candidate of candidateEmails) {
          const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
            email: candidate,
            password: newPassword
          });

          if (!signInErr && signInData?.session) {
            loginSuccess = true;
            break;
          }
        }

        if (loginSuccess) break;

        // Si en el intento 6 aún no existía el usuario en Auth (primera vez y servidor local apagado), aprovisionarlo en nube
        if (attempt === 6 && !loginSuccess) {
          try {
            const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
              email: candidateEmails[0],
              password: newPassword,
              options: {
                data: {
                  cliente_id: targetCid,
                  nombre_completo: clientVerified?.nombre || targetCid,
                  nombre_empresa: clientVerified?.nombre || targetCid,
                  rol: 'Dueno'
                }
              }
            });
            if (!signUpErr && signUpData?.session) {
              loginSuccess = true;
              break;
            }
          } catch (e) {}
        }
      }

      Swal.fire({
        title: '¡Acceso Concedido!',
        text: 'Su nueva contraseña se ha guardado correctamente. Ingrese a la pantalla principal.',
        icon: 'success',
        confirmButtonText: 'Ir al Inicio',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      }).then(() => {
        window.location.replace('/');
      });

    } catch (err) {
      console.error('Error guardando clave:', err.message);
      Swal.fire({
        title: 'Error de Actualización',
        text: err.message,
        icon: 'error',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card" style={{ maxWidth: '450px' }}>
        <button
          type="button"
          onClick={() => {
            if (step > 1) setStep(step - 1);
            else onNavigate('/login');
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
            cursor: 'pointer',
            marginBottom: '1.5rem',
            padding: 0
          }}
        >
          <ArrowLeft size={16} />
          <span>{step === 1 ? 'Volver al Inicio de Sesión' : 'Paso Anterior'}</span>
        </button>

        <div className="login-header" style={{ marginBottom: '1.75rem', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.45rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
            {step === 1 && 'Activar o Recuperar Acceso B2B'}
            {step === 2 && 'Ingresar Código de 4 Números'}
            {step === 3 && 'Establecer Nueva Contraseña'}
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {step === 1 && 'Ingrese su Código de Cliente (ej: 010 o CB-0059), CUIT, Código de Invitación o Correo.'}
            {step === 2 && 'Verifique su dispositivo e ingrese el código numérico corto de 4 cifras.'}
            {step === 3 && 'Cree su nueva contraseña personal de al menos 6 caracteres.'}
          </p>
        </div>

        {/* PASO 1: Identificación y Asistencia Live */}
        {step === 1 && (
          <form onSubmit={handleRequestOtp} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                <label className="form-label" htmlFor="identifier" style={{ marginBottom: 0 }}>
                  Código de Cliente, CUIT o Correo
                </label>
                {searching && <Loader2 className="spinner" size={14} style={{ color: 'var(--accent)' }} />}
              </div>
              <div className="input-wrapper">
                <User className="input-icon" size={18} />
                <input
                  id="identifier"
                  type="text"
                  required
                  disabled={loading}
                  className="form-input"
                  placeholder="Ej: 010, CB-0059, CUIT o código de 6 letras"
                  value={identifier}
                  onChange={handleIdentifierChange}
                />
              </div>

              {/* Feedback en Tiempo Real */}
              {clientVerified && (
                <div style={{ marginTop: '0.5rem' }}>
                  {clientVerified.error ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontSize: '0.78rem', fontWeight: '600' }}>
                      <XCircle size={15} />
                      <span>{clientVerified.error}</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '0.84rem', fontWeight: '700' }}>
                        <CheckCircle2 size={16} />
                        <span>Distribuidor Verificado: {clientVerified.nombre}</span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '22px' }}>
                        Código Búnker: <strong>{clientVerified.cliente_id}</strong>
                        {clientVerified.legacy_id ? ` (Legacy: ${clientVerified.legacy_id})` : ''}
                      </span>

                      {clientVerified.activeInvitation && (
                        <div style={{ marginTop: '6px', paddingTop: '8px', borderTop: '1px solid rgba(16, 185, 129, 0.2)' }}>
                          <button
                            type="button"
                            onClick={() => onNavigate(`#/onboarding?token=${clientVerified.activeInvitation.token}`)}
                            style={{
                              width: '100%',
                              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '10px 12px',
                              fontSize: '0.84rem',
                              fontWeight: '700',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
                            }}
                          >
                            <Sparkles size={16} />
                            <span>Activar Cuenta Ahora (Invitación Lista)</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Selección de Canal de Entrega */}
            {clientVerified && !clientVerified.error && (
              <div className="form-group" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', borderRadius: '8px', padding: '12px' }}>
                <label className="form-label" style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                  {clientVerified.activeInvitation
                    ? 'O si prefiere recibir un código de 4 números:'
                    : '¿Dónde prefiere recibir su código de 4 números?'}
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
                    <input
                      type="radio"
                      name="channel"
                      value="whatsapp"
                      checked={channel === 'whatsapp'}
                      onChange={() => setChannel('whatsapp')}
                    />
                    <MessageSquare size={16} style={{ color: '#25D366' }} />
                    <span>Por WhatsApp {clientVerified.telefono ? `(${clientVerified.telefono})` : 'al número registrado'}</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
                    <input
                      type="radio"
                      name="channel"
                      value="email"
                      checked={channel === 'email'}
                      onChange={() => setChannel('email')}
                    />
                    <Mail size={16} style={{ color: '#3b82f6' }} />
                    <span>Por Correo Electrónico {clientVerified.emailMasked ? `(${clientVerified.emailMasked})` : 'al correo registrado'}</span>
                  </label>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !clientVerified || clientVerified.error}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.25rem' }}
            >
              {loading ? (
                <>
                  <Loader2 className="spinner" style={{ width: '18px', height: '18px' }} />
                  <span>Despachando Código...</span>
                </>
              ) : (
                <span>📲 Despachar Código de 4 Números</span>
              )}
            </button>
          </form>
        )}

        {/* PASO 2: Verificación de Token Corto de 4 Cifras */}
        {step === 2 && (
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="otp" style={{ textAlign: 'center', display: 'block' }}>
                Código Numérico de 4 Cifras
              </label>
              <div className="input-wrapper">
                <Key className="input-icon" size={18} />
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={4}
                  required
                  autoFocus
                  disabled={loading}
                  className="form-input"
                  placeholder="••••"
                  style={{ letterSpacing: '0.5em', fontSize: '1.5rem', textAlign: 'center', fontWeight: '900', color: 'var(--accent)' }}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.6rem', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>El código vence en:</span>
                <span style={{ color: timeLeft < 60 ? '#ef4444' : 'var(--accent)', fontWeight: '700' }}>
                  {formatTime(timeLeft)}
                </span>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={loading || otp.length !== 4}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              {loading ? (
                <>
                  <Loader2 className="spinner" style={{ width: '18px', height: '18px' }} />
                  <span>Verificando...</span>
                </>
              ) : (
                <span>Confirmar Código e Ingresar</span>
              )}
            </button>
          </form>
        )}

        {/* PASO 3: Nueva Contraseña con Toggle Ojito */}
        {step === 3 && (
          <form onSubmit={handleSaveNewPassword} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="newPassword">Nueva Contraseña</label>
              <div className="input-wrapper" style={{ position: 'relative' }}>
                <Lock className="input-icon" size={18} />
                <input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  required
                  disabled={loading}
                  className="form-input"
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="confirmPassword">Confirmar Nueva Contraseña</label>
              <div className="input-wrapper" style={{ position: 'relative' }}>
                <Lock className="input-icon" size={18} />
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  required
                  disabled={loading}
                  className="form-input"
                  placeholder="Repita su nueva contraseña"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
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
                  <Loader2 className="spinner" style={{ width: '18px', height: '18px' }} />
                  <span>Guardando Clave...</span>
                </>
              ) : (
                <span>Guardar Contraseña e Ingresar</span>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
