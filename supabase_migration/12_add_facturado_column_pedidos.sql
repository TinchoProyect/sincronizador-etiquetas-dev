-- Migración 12: Agregar columna de facturación para control de inmutabilidad en el portal .com
ALTER TABLE public.clientes_b2b_pedidos_cabecera ADD COLUMN IF NOT EXISTS facturado BOOLEAN DEFAULT false;
ALTER TABLE public.clientes_b2b_pedidos_cabecera ADD COLUMN IF NOT EXISTS es_edicion BOOLEAN DEFAULT false;

-- Actualizar política RLS para permitir modificación (incluyendo anulación) de pedidos activos no facturados
DROP POLICY IF EXISTS "Clientes pueden modificar sus propios pedidos en borrador" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Clientes pueden modificar sus propios pedidos en borrador o pendientes de facturar" ON public.clientes_b2b_pedidos_cabecera;

CREATE POLICY "Clientes pueden modificar sus propios pedidos en borrador o pendientes de facturar" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND (estado = 'Borrador' OR estado = 'En Preparacion' OR estado = 'Pendiente')
        AND (facturado IS NULL OR facturado = false)
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND (estado = 'Borrador' OR estado = 'En Preparacion' OR estado = 'Pendiente' OR estado = 'CANCELLED' OR estado = 'Cancelado')
    );
