-- 43. Soporte nativo de DNI en public.bunker_clientes (Consumidor Final ágil y Factura B RG 5700/2025)
ALTER TABLE public.bunker_clientes
    ADD COLUMN IF NOT EXISTS dni VARCHAR(20) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_bunker_clientes_dni
    ON public.bunker_clientes (dni)
    WHERE dni IS NOT NULL;
