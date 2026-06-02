-- Script para crear tablas aisladas de vinculación entre Lotes (Supabase) y Búnker/Ingredientes

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla de Cabecera del Vínculo (Costeo y Origen)
CREATE TABLE IF NOT EXISTS public.bunker_lotes_vinculos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lote_id_supabase VARCHAR(255) NOT NULL,
    costo_bruto_ingresado NUMERIC(15,2) NOT NULL DEFAULT 0,
    costo_kilo_calculado NUMERIC(15,2) NOT NULL DEFAULT 0,
    cantidad_total_lote NUMERIC(15,2) NOT NULL DEFAULT 0,
    impuesto_iva NUMERIC(5,2) NOT NULL DEFAULT 21.00,
    impuesto_iibb NUMERIC(5,2) NOT NULL DEFAULT 4.00,
    fecha_vinculacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    usuario_vinculador VARCHAR(100)
);

-- Índice para búsquedas rápidas por ID de Lote Supabase
CREATE INDEX IF NOT EXISTS idx_bunker_lotes_vinculos_supabase ON public.bunker_lotes_vinculos(lote_id_supabase);

-- Tabla de Detalle del Vínculo (Destinos y Asignación)
CREATE TABLE IF NOT EXISTS public.bunker_lotes_destinos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vinculo_id UUID NOT NULL REFERENCES public.bunker_lotes_vinculos(id) ON DELETE CASCADE,
    tipo_destino VARCHAR(50) NOT NULL CHECK (tipo_destino IN ('ARTICULO_BUNKER', 'INGREDIENTE_PRODUCCION')),
    destino_id VARCHAR(100) NOT NULL,
    cantidad_asignada NUMERIC(15,2) NOT NULL DEFAULT 0,
    kilos_asignados NUMERIC(15,2) NOT NULL DEFAULT 0,
    -- Registramos el costo de inserción para la política de "Motor de Alertas"
    costo_kilo_al_momento NUMERIC(15,2) NOT NULL DEFAULT 0
);

-- Índices de destinos
CREATE INDEX IF NOT EXISTS idx_bunker_lotes_destinos_vinculo ON public.bunker_lotes_destinos(vinculo_id);
CREATE INDEX IF NOT EXISTS idx_bunker_lotes_destinos_tipo ON public.bunker_lotes_destinos(tipo_destino, destino_id);
