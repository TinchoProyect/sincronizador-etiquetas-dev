-- 21. Agregar columna whatsapp_facturas a la tabla bunker_clientes
ALTER TABLE public.bunker_clientes 
ADD COLUMN IF NOT EXISTS whatsapp_facturas VARCHAR(255) DEFAULT NULL;
