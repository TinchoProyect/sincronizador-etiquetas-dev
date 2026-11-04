import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase credentials missing in Vite environment variables.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Exportar misma instancia para evitar duplicación de GoTrueClient en el navegador
export const supabasePublica = supabase

// Instancia aislada sin sesión persistida para consultas públicas (ej. recepción de remito por QR sin ser bloqueado por RLS del usuario logueado)
export const supabaseAnonimaPublica = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
})
