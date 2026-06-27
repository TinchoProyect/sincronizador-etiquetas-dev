import React, { useState, useEffect } from 'react';
import { Mail, Lock, Loader2 } from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../supabaseClient';

export default function Login({ onNavigate }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const prefilled = localStorage.getItem('prefilled_email');
    if (prefilled) {
      setEmail(prefilled);
      localStorage.removeItem('prefilled_email');
    }
  }, []);

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

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (error) {
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
      Swal.fire({
        title: 'Error de Acceso',
        text: err.message === 'Invalid login credentials' 
          ? 'Las credenciales proporcionadas no son válidas.' 
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
          <img src="/logo_LAMDA.png" alt="LAMDA Logo" style={{ maxHeight: '54px', maxWidth: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }} />
          <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--accent)', letterSpacing: '0.05em', marginTop: '-0.25rem', textTransform: 'lowercase' }}>servicios.com</span>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Correo Electrónico</label>
            <div className="input-wrapper">
              <Mail className="input-icon" size={18} />
              <input
                id="email"
                type="email"
                required
                disabled={loading}
                className="form-input"
                placeholder="ejemplo@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
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
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <label className="form-label" htmlFor="password" style={{ marginBottom: 0 }}>Contraseña</label>
              <a
                href="/activar"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('/activar');
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
            href="/activar"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/activar');
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
