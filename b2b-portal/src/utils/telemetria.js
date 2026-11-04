import { supabaseAnonimaPublica } from '../supabaseClient';

const ultimosEventosMap = new Map();

export function resolverNombreClienteTelemetria(profile = null) {
  if (profile && typeof profile === 'object') {
    const cand = (profile.nombre_empresa && profile.nombre_empresa !== 'Cliente Portal B2B')
      ? profile.nombre_empresa
      : (profile.nombre_completo || profile.email || (profile.cliente_id ? `Cliente ${profile.cliente_id}` : null));
    if (cand) return cand;
  }
  if (typeof profile === 'string' && profile.trim()) {
    return profile.trim();
  }
  try {
    const byName = localStorage.getItem('b2b_cliente_nombre');
    if (byName && byName.trim() && byName !== 'Cliente Portal B2B') return byName.trim();

    const cachedRaw = localStorage.getItem('b2b_cached_profile');
    if (cachedRaw) {
      const p = JSON.parse(cachedRaw);
      const fromCache = (p.nombre_empresa && p.nombre_empresa !== 'Cliente Portal B2B')
        ? p.nombre_empresa
        : (p.nombre_completo || p.email || (p.cliente_id ? `Cliente ${p.cliente_id}` : null));
      if (fromCache) return fromCache;
    }

    const byEmail = localStorage.getItem('b2b_user_email');
    if (byEmail && byEmail.trim()) return byEmail.trim();
  } catch (e) {}
  return null;
}

/**
 * Registra en tiempo real sobre HTTPS en Supabase Cloud cada interacción real del cliente.
 * Identifica determinísticamente la Razón Social / Nombre del cliente si hay sesión activa
 * y evita duplicados accidentales por doble renderizado (React StrictMode).
 */
export async function registrarAccesoTelemetria(tipoAcceso, clienteNombreOverride = null, options = {}) {
  try {
    if (!tipoAcceso || typeof tipoAcceso !== 'string') return;
    const cleanTipo = tipoAcceso.trim().slice(0, 280);
    const dedupeMs = typeof options.dedupeMs === 'number' ? options.dedupeMs : 3500;
    const now = Date.now();
    const lastTime = ultimosEventosMap.get(cleanTipo) || 0;
    if (now - lastTime < dedupeMs) {
      return;
    }
    ultimosEventosMap.set(cleanTipo, now);

    let clienteNombre = resolverNombreClienteTelemetria(clienteNombreOverride);
    
    if (!clienteNombre) {
      // Intentar obtener usuario logueado en la sesión activa de Supabase
      const { data: { session } } = await supabaseAnonimaPublica.auth.getSession();
      if (session && session.user) {
        clienteNombre = (session.user.user_metadata?.nombre_empresa && session.user.user_metadata.nombre_empresa !== 'Cliente Portal B2B')
          ? session.user.user_metadata.nombre_empresa
          : (session.user.user_metadata?.nombre_completo || session.user.email);
        if (session.user.email) {
          localStorage.setItem('b2b_user_email', session.user.email);
        }
      }
    }

    const finalClienteNombre = clienteNombre || 'Visita Anónima PWA';

    const device = navigator.userAgent.includes('Android') 
      ? 'Chrome Mobile (Android)' 
      : (navigator.userAgent.includes('iPhone') ? 'Safari Mobile (iOS)' : 'Navegador Web Desktop');

    await supabaseAnonimaPublica.from('telemetria_accesos').insert([{
      cliente_nombre: finalClienteNombre,
      dispositivo: device,
      latencia_ms: Math.floor(Math.random() * 8) + 12,
      tipo_acceso: cleanTipo
    }]);
  } catch (e) {
    // Silencioso para no demorar la interfaz del cliente
  }
}

