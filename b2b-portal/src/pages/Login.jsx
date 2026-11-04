import React, { useState, useEffect } from 'react';
import { Mail, Lock, Loader2 } from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../supabaseClient';
import { encontrarClienteB2B, encontrarClienteB2BAsync, buscarInvitacionActivaCloud } from '../utils/clientesB2B';

export default function Login({ onNavigate }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const prefilled = localStorage.getItem('prefilled_email');
    if (prefilled) {
      setEmail(prefilled);
      localStorage.removeItem('prefilled_email');
    }
  }, []);

  const resolveEmailFromIdentifier = async (rawInput) => {
    if (!rawInput) return '';
    const clean = rawInput.trim();
    if (clean.includes('@')) return clean.toLowerCase();

    const found = await encontrarClienteB2BAsync(clean, supabase);
    if (found) {
      // Primero verificar si ya tiene un perfil activo en la nube con correo personalizado
      try {
        const { data: prof } = await supabase
          .from('clientes_b2b_perfiles')
          .select('email')
          .eq('cliente_id', found.bunker_id)
          .maybeSingle();

        if (prof && prof.email) {
          return prof.email.toLowerCase();
        }
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

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    try {
      const cleanUser = email.trim();
      const cleanPass = password.trim();

      // 0. Si el cliente ingresó su código corto de invitación de 6 caracteres (ej: 1e9c76) como usuario o clave
      if (/^[0-9a-f]{6}$/i.test(cleanUser) || /^[0-9a-f]{6}$/i.test(cleanPass)) {
        const codeCandidate = /^[0-9a-f]{6}$/i.test(cleanUser) ? cleanUser : cleanPass;
        const inv = await buscarInvitacionActivaCloud(codeCandidate, supabase);
        if (inv && !inv.usado) {
          await Swal.fire({
            title: 'Invitación Detectada',
            text: `Bienvenido ${inv.cliente_nombre || inv.cliente_id}. Vamos a activar su contraseña por primera vez.`,
            icon: 'info',
            confirmButtonText: 'Activar mi Cuenta',
            confirmButtonColor: 'var(--accent)',
            background: 'hsl(222, 47%, 11%)',
            color: 'var(--text-primary)',
          });
          onNavigate(`#/onboarding?token=${inv.token}`);
          return;
        }
      }

      const targetEmail = await resolveEmailFromIdentifier(cleanUser);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password: password,
      });

      if (error) {
        // También probar con el correo institucional cb-xxxx@lamdaclientes.com si tenía otro email en directorio
        const foundClient = await encontrarClienteB2BAsync(cleanUser, supabase);
        if (foundClient) {
          const fallbackSynthetic = `${foundClient.bunker_id.toLowerCase()}@lamdaclientes.com`;
          if (fallbackSynthetic !== targetEmail) {
            const retry = await supabase.auth.signInWithPassword({
              email: fallbackSynthetic,
              password: password,
            });
            if (!retry.error && retry.data?.session) {
              Swal.fire({
                title: '¡Bienvenido!',
                text: 'Inicio de sesión exitoso.',
                icon: 'success',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2000,
                background: 'hsl(222, 47%, 11%)',
                color: 'var(--text-primary)',
                iconColor: 'var(--success)',
              });
              return;
            }
          }
        }
        throw error;
      }

      // Alerta de éxito con SweetAlert2
      Swal.fire({
        title: '¡Bienvenido!',
        text: 'Inicio de sesión exitoso.',
        icon: 'success',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000,
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
        iconColor: 'var(--success)',
      });

    } catch (err) {
      console.error('Error de autenticación:', err.message);

      // Verificar si el cliente tiene una invitación pendiente de activar por primera vez
      try {
        const activeInv = await buscarInvitacionActivaCloud(email.trim(), supabase);
        if (activeInv && !activeInv.usado) {
          const res = await Swal.fire({
            title: 'Activación Inicial Pendiente',
            html: `Su cuenta de distribuidor <b>${activeInv.cliente_nombre || activeInv.cliente_id}</b> tiene una invitación lista para configurar su contraseña.<br><br>¿Desea activarla e ingresar ahora?`,
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: 'Sí, Activar Ahora',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: 'var(--accent)',
            background: 'hsl(222, 47%, 11%)',
            color: 'var(--text-primary)',
          });
          if (res.isConfirmed) {
            onNavigate(`#/onboarding?token=${activeInv.token}`);
            return;
          }
        }
      } catch (e) {}

      Swal.fire({
        title: 'Error de Acceso',
        text: err.message === 'Invalid login credentials' 
          ? 'Las credenciales proporcionadas no son válidas. Si es su primera vez, toque "¿Primera vez aquí? Activar mi cuenta B2B" debajo.' 
          : err.message,
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

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div className="login-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '2.5rem' }}>
          <img src="/logo_LAMDA.png?v=4" alt="LAMDA Logo" style={{ maxHeight: '54px', maxWidth: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }} />
          <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--accent)', letterSpacing: '0.05em', marginTop: '-0.25rem', textTransform: 'lowercase' }}>servicios.com</span>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Correo Electrónico, CUIT o Código de Cliente</label>
            <div className="input-wrapper">
              <Mail className="input-icon" size={18} />
              <input
                id="email"
                type="text"
                required
                disabled={loading}
                className="form-input"
                placeholder="Ej: 010, CB-0059, CUIT o correo"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <label className="form-label" htmlFor="password" style={{ marginBottom: 0 }}>Contraseña</label>
              <a
                href="#/activar"
                onClick={(e) => {
                  e.preventDefault();
                  if (email.trim()) localStorage.setItem('prefilled_identifier', email.trim());
                  onNavigate('#/activar');
                }}
                style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none', fontWeight: '500', transition: 'var(--transition-smooth)' }}
                onMouseOver={(e) => { e.target.style.textDecoration = 'underline'; }}
                onMouseOut={(e) => { e.target.style.textDecoration = 'none'; }}
              >
                ¿Olvidó su contraseña?
              </a>
            </div>
            <div className="input-wrapper">
              <Lock className="input-icon" size={18} />
              <input
                id="password"
                type="password"
                required
                disabled={loading}
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
          >
            {loading ? (
              <>
                <Loader2 className="spinner" style={{ width: '18px', height: '18px', borderTopColor: 'var(--text-primary)' }} />
                <span>Ingresando...</span>
              </>
            ) : (
              <span>Ingresar</span>
            )}
          </button>
        </form>

        <div style={{ marginTop: '1.75rem', textAlign: 'center', borderTop: '1px solid var(--border-glass)', paddingTop: '1.25rem' }}>
          <a
            href="#/onboarding"
            onClick={(e) => {
              e.preventDefault();
              if (email.trim()) localStorage.setItem('prefilled_identifier', email.trim());
              onNavigate('#/onboarding');
            }}
            style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textDecoration: 'none', fontWeight: '500', transition: 'var(--transition-smooth)' }}
            onMouseOver={(e) => { e.target.style.color = 'var(--text-primary)'; e.target.style.textDecoration = 'underline'; }}
            onMouseOut={(e) => { e.target.style.color = 'var(--text-secondary)'; e.target.style.textDecoration = 'none'; }}
          >
            ¿Primera vez aquí? Activar mi cuenta B2B
          </a>
        </div>
      </div>
    </div>
  );
}
