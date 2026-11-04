-- =========================================================================
-- Migración 39: Kits de Insumos para Producción Externa (UP / Barritas)
-- Vinculación a nivel USUARIO ESPECÍFICO (clientes_b2b_perfiles)
-- =========================================================================

-- 1. Agregar flag de habilitación de kits a nivel perfil de usuario
ALTER TABLE public.clientes_b2b_perfiles 
ADD COLUMN IF NOT EXISTS habilitar_kits_produccion BOOLEAN DEFAULT false;

-- Habilitar exclusivamente para Matías (CB-0006)
UPDATE public.clientes_b2b_perfiles 
SET habilitar_kits_produccion = true,
    permisos = array_append(array_remove(permisos, 'habilitar_kits_produccion'), 'habilitar_kits_produccion')
WHERE cliente_id = 'CB-0006';

-- 2. Tabla maestra de definición de kits de insumos
CREATE TABLE IF NOT EXISTS public.clientes_b2b_articulos_kits (
    id SERIAL PRIMARY KEY,
    producto_codigo TEXT NOT NULL,
    up_codigo TEXT,
    ingrediente_id INTEGER NOT NULL,
    ingrediente_codigo TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    unidad_medida TEXT NOT NULL DEFAULT 'Kilo',
    cantidad_ratio NUMERIC(12, 4) NOT NULL,
    costo_base NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    iva_porcentaje NUMERIC(6, 2) NOT NULL DEFAULT 21.00,
    precio_unitario NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unq_b2b_kit_producto_ingrediente UNIQUE (producto_codigo, ingrediente_id)
);

CREATE INDEX IF NOT EXISTS idx_b2b_articulos_kits_prod ON public.clientes_b2b_articulos_kits(producto_codigo, activo);

-- 3. Habilitar RLS
ALTER TABLE public.clientes_b2b_articulos_kits ENABLE ROW LEVEL SECURITY;

-- 4. Política de lectura: abierta para lectura de kits de catálogo
DROP POLICY IF EXISTS "Lectura de kits para usuarios autenticados" ON public.clientes_b2b_articulos_kits;
DROP POLICY IF EXISTS "Lectura de kits para todos" ON public.clientes_b2b_articulos_kits;
CREATE POLICY "Lectura de kits para todos" 
ON public.clientes_b2b_articulos_kits 
FOR SELECT 
USING (true);

-- Política de escritura: service_role / postgres
DROP POLICY IF EXISTS "Escritura completa para service_role" ON public.clientes_b2b_articulos_kits;
CREATE POLICY "Escritura completa para service_role" 
ON public.clientes_b2b_articulos_kits 
FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);
