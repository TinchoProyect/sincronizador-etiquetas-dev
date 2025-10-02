-- Agregar columnas para configuración Forward-Only a tabla existente
ALTER TABLE public.presupuestos_config 
ADD COLUMN IF NOT EXISTS forward_only_mode boolean DEFAULT false;

ALTER TABLE public.presupuestos_config 
ADD COLUMN IF NOT EXISTS cutoff_at timestamp with time zone;

ALTER TABLE public.presupuestos_config 
ADD COLUMN IF NOT EXISTS last_seen_local_id integer DEFAULT 0;

ALTER TABLE public.presupuestos_config 
ADD COLUMN IF NOT EXISTS last_seen_sheet_row integer DEFAULT 0;

-- Actualizar registro activo con valores por defecto
UPDATE public.presupuestos_config 
SET 
    forward_only_mode = false,
    cutoff_at = NULL,
    last_seen_local_id = 0,
    last_seen_sheet_row = 0
WHERE activo = true 
AND forward_only_mode IS NULL;
