import { createClient } from '@supabase/supabase-js'

const rawSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const rawSupabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const isSupabaseOfflineLab =
  !rawSupabaseUrl ||
  !rawSupabaseAnonKey ||
  rawSupabaseUrl.includes('127.0.0.1:59999') ||
  rawSupabaseUrl.includes('localhost:59999')

const effectiveSupabaseUrl = rawSupabaseUrl || 'http://127.0.0.1:59999'
const effectiveSupabaseAnonKey = rawSupabaseAnonKey || 'lab-offline-anon-key'

export const supabase = createClient(effectiveSupabaseUrl, effectiveSupabaseAnonKey)

// Exportar misma instancia para evitar duplicación de GoTrueClient en el navegador
export const supabasePublica = supabase

// Instancia aislada sin sesión persistida para consultas públicas (ej. recepción de remito por QR sin ser bloqueado por RLS del usuario logueado)
export const supabaseAnonimaPublica = createClient(effectiveSupabaseUrl, effectiveSupabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
})
