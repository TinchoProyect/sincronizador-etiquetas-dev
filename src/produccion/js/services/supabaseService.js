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
   */
  async fetchUltimosLotes() {
    try {
      const response = await fetch('/api/supabase/lotes');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      
      console.log("📡 [Supabase PROXY - fetchUltimosLotes] Respuesta:", data);
      return data;
    } catch (err) {
      console.error("🚨 [Supabase PROXY - fetchUltimosLotes] Error:", err);
      return [];
    }
  },

  /**
   * Consulta la trazabilidad completa de un lote por su ID corto (Escaneado) mediante el proxy local.
   * @param {string} id_corto ID del lote
   */
  async fetchTrazabilidadLote(id_corto) {
    try {
      const response = await fetch(`/api/supabase/lotes/${id_corto}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();

      console.log(`📡 [Supabase PROXY - fetchTrazabilidadLote] Respuesta para ID ${id_corto}:`, data);
      return data;
    } catch (err) {
      console.error(`🚨 [Supabase PROXY - fetchTrazabilidadLote] Error para ID ${id_corto}:`, err);
      return null;
    }
  }
};

window.SupabaseService = SupabaseService;
