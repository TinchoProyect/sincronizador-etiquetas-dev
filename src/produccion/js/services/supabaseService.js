/**
 * Módulo Aislado de Supabase para Recepción de Lotes y Trazabilidad.
 * REGLA ESTRICTA DE AISLAMIENTO: Este archivo es la única puerta de entrada
 * a la base de datos en la nube. NO mezclar con la lógica local.
 * 
 * ⚠️ ADVERTENCIA DE ARQUITECTURA Y GOBERNANZA DE DATOS ⚠️
 * ESTRICTAMENTE PROHIBIDO: Bajo ningún concepto este módulo (ni el equipo de LAMDA)
 * debe realizar modificaciones directas (INSERT, UPDATE, DELETE) en esta base de datos.
 * Esta base de datos es de solo lectura (Trazabilidad). 
 * 
 * PROCEDIMIENTO: Cualquier modificación estructural o de datos en Supabase 
 * DEBE ser canalizada a través de una petición formal al taller principal ("Equipo Embudo").
 */

// NOTA TÉCNICA: Se implementó un Proxy en el backend Node (app.js) para sortear
// el error 401 (CORS/PAT) del navegador al usar la llave de servicio de administración.

const SupabaseService = {
  /**
   * Extrae los últimos lotes ingresados mediante el proxy local.
   * Lanza error explícito ante fallos de autenticación (HTTP 502 / SUPABASE_AUTH_ERROR) o error de red.
   */
  async fetchUltimosLotes() {
    const response = await fetch('/api/supabase/lotes');
    const fallbackMode = response.headers ? response.headers.get('X-Lamda-Supabase-Fallback') : null;
    const fallbackReason = response.headers ? response.headers.get('X-Lamda-Supabase-Fallback-Reason') : null;
    window.SupabaseLotesMeta = {
      fallback: Boolean(fallbackMode),
      mode: fallbackMode || 'SUPABASE_LIVE',
      reason: fallbackReason || null
    };

    if (!response.ok) {
      let errData = null;
      try { errData = await response.json(); } catch (_) {}
      const msg = errData?.message || errData?.error || `HTTP error! status: ${response.status}`;
      const err = new Error(msg);
      err.httpStatus = response.status;
      err.code = errData?.code || (response.status === 502 ? 'SUPABASE_AUTH_ERROR' : 'HTTP_ERROR');
      err.userMessage = msg;
      throw err;
    }

    const data = await response.json();
    console.log("📡 [Supabase PROXY - fetchUltimosLotes] Respuesta:", Array.isArray(data) ? data.length : data);
    return data;
  },

  /**
   * Consulta la trazabilidad completa de un lote por su ID corto (Escaneado) mediante el proxy local.
   * @param {string} id_corto ID del lote
   */
  async fetchTrazabilidadLote(id_corto) {
    try {
      const response = await fetch(`/api/supabase/lotes/${id_corto}`);
      if (!response.ok) {
        let errData = null;
        try { errData = await response.json(); } catch (_) {}
        const msg = errData?.message || errData?.error || `HTTP error! status: ${response.status}`;
        const err = new Error(msg);
        err.httpStatus = response.status;
        err.code = errData?.code || 'HTTP_ERROR';
        throw err;
      }
      const data = await response.json();

      console.log(`📡 [Supabase PROXY - fetchTrazabilidadLote] Respuesta para ID ${id_corto}:`, data);
      return data;
    } catch (err) {
      console.error(`🚨 [Supabase PROXY - fetchTrazabilidadLote] Error para ID ${id_corto}:`, err);
      if (err.code === 'SUPABASE_AUTH_ERROR' || err.httpStatus === 502) throw err;
      return null;
    }
  }
};

window.SupabaseService = SupabaseService;
