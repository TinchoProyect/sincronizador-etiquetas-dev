-- 26. Agregar preferencia_facturacion a la tabla bunker_clientes
ALTER TABLE public.bunker_clientes 
ADD COLUMN IF NOT EXISTS preferencia_facturacion VARCHAR(20) DEFAULT 'PREGUNTAR';

-- Sincronizar preferencia_facturacion existente desde clientes hacia bunker_clientes
UPDATE public.bunker_clientes bc
SET preferencia_facturacion = c.preferencia_facturacion
FROM public.clientes c
WHERE ltrim(bc.lomas_soft_id, '0') = ltrim(c.cliente_id::text, '0')
  AND c.preferencia_facturacion IS NOT NULL
  AND c.preferencia_facturacion != '';
