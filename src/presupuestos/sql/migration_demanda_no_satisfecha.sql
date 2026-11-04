-- Migración: Soporte para ciclo de vida dinámico de Demanda No Satisfecha
-- Módulo: Presupuestos y Pizarra Inteligente LAMDA

ALTER TABLE public.presupuestos_articulos_sin_stock 
ADD COLUMN IF NOT EXISTS estado VARCHAR(30) NOT NULL DEFAULT 'Pendiente',
ADD COLUMN IF NOT EXISTS fecha_resolucion TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS motivo_resolucion TEXT NULL,
ADD COLUMN IF NOT EXISTS origen_resolucion VARCHAR(50) NULL;

CREATE INDEX IF NOT EXISTS idx_pres_sin_stock_estado ON public.presupuestos_articulos_sin_stock(estado);
CREATE INDEX IF NOT EXISTS idx_pres_sin_stock_articulo ON public.presupuestos_articulos_sin_stock(articulo);
