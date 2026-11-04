import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

import { supabaseAnonimaPublica } from './supabaseClient'

// Telemetría pasiva de conexión de cliente en vivo sobre HTTPS
try {
  const startTime = window.__PWA_PERF_START__ || performance.now();
  const latencyMs = Math.max(2, Math.round(performance.now() - startTime));
  const device = navigator.userAgent.includes('Android') ? 'Chrome Mobile (Android)' : (navigator.userAgent.includes('iPhone') ? 'Safari Mobile (iOS)' : 'Navegador Web Desktop');
  
  let clienteNombre = localStorage.getItem('b2b_cliente_nombre') || localStorage.getItem('b2b_user_email');
  if (!clienteNombre) {
    try {
      const cached = localStorage.getItem('b2b_cached_profile');
      if (cached) {
        const p = JSON.parse(cached);
        clienteNombre = p.nombre_empresa || p.nombre_completo || p.email || p.cliente_id;
      }
    } catch (e) {}
  }
  
  const finalNombre = clienteNombre || 'Ingreso Portal B2B';

  supabaseAnonimaPublica.from('telemetria_accesos').insert([{
    cliente_nombre: finalNombre,
    dispositivo: device,
    latencia_ms: latencyMs,
    tipo_acceso: window.location.hash.includes('recepcion') ? 'Lectura QR Pedido (Calle)' : 'Apertura Instantánea PWA'
  }]).then(() => {}).catch(() => {});
} catch (e) {}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
