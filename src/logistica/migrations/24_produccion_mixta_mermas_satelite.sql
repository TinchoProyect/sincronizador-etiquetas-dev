-- Migración 24: Ecosistema de Producción Mixta, Mermas por Cocción, Depósitos Satélites y Tarifario
-- Fecha: 5 de Julio de 2026

BEGIN;

-- 1. Vincular cliente comercial con el usuario del sistema (operario/colaborador)
ALTER TABLE public.bunker_clientes 
ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL;

-- 2. Registrar pesos de entrada y salida para el historial de mermas
ALTER TABLE public.produccion_externa_historial
ADD COLUMN IF NOT EXISTS kilos_entrada NUMERIC(15,4),
ADD COLUMN IF NOT EXISTS kilos_salida NUMERIC(15,4),
ADD COLUMN IF NOT EXISTS porcentaje_merma NUMERIC(5,2);

-- 3. Identificar etapa de adición de ingredientes en recetas
ALTER TABLE public.receta_ingredientes
ADD COLUMN IF NOT EXISTS fase_produccion VARCHAR(20) DEFAULT 'externa' 
CHECK (fase_produccion IN ('externa', 'interna'));

-- 4. Crear tabla de stock satélite (en el domicilio del colaborador)
CREATE TABLE IF NOT EXISTS public.colaborador_stock_satelite (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    ingrediente_id INTEGER NOT NULL REFERENCES public.ingredientes(id) ON DELETE CASCADE,
    stock_actual NUMERIC(15, 4) NOT NULL DEFAULT 0.0000,
    ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(usuario_id, ingrediente_id)
);

CREATE INDEX IF NOT EXISTS idx_colab_stock_sat_user ON public.colaborador_stock_satelite(usuario_id);

-- 5. Crear tabla de tarifario por rendimiento
CREATE TABLE IF NOT EXISTS public.colaboradores_tarifas_rendimiento (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    articulo_numero TEXT NOT NULL,
    valor_por_unidad NUMERIC(15, 2) NOT NULL,
    unidad_medida VARCHAR(10) DEFAULT 'kg', -- 'kg' o 'un'
    fecha_desde TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_hasta TIMESTAMP,
    activo BOOLEAN DEFAULT true,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índice único parcial para permitir infinitas tarifas inactivas pero solo una activa
CREATE UNIQUE INDEX IF NOT EXISTS uidx_colab_tarifas_rend_activa 
ON public.colaboradores_tarifas_rendimiento (usuario_id, articulo_numero) 
WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_colab_tarifas_rend_user ON public.colaboradores_tarifas_rendimiento(usuario_id);

COMMIT;
