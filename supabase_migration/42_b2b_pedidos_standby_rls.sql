-- Migración 42: Soporte explícito de Pedidos en Standby ("A Confirmar") y Archivados en Portal B2B
-- Nota arquitectónica: El flujo operativo utiliza `estado = 'Borrador' | 'Pendiente' | 'En Preparacion' | 'CANCELLED'`
-- combinado con marcadores deterministas en `sync_mensaje` (`[STANDBY_PORTAL]`, `[ARCHIVADO_PORTAL]`, `[CONFIRMADO_PORTAL]`)
-- para operar de forma 100% retrocompatible con la política RLS de Migración 12.
-- Esta migración amplía además la política RLS para cubrir explícitamente `Standby` y `Archivado` en entornos nuevos.

ALTER TABLE public.clientes_b2b_pedidos_cabecera ADD COLUMN IF NOT EXISTS facturado BOOLEAN DEFAULT false;
ALTER TABLE public.clientes_b2b_pedidos_cabecera ADD COLUMN IF NOT EXISTS es_edicion BOOLEAN DEFAULT false;

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
        AND estado IN ('Borrador', 'En Preparacion', 'Pendiente', 'Standby', 'Archivado')
        AND (facturado IS NULL OR facturado = false)
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND estado IN ('Borrador', 'En Preparacion', 'Pendiente', 'Standby', 'Archivado', 'CANCELLED', 'Cancelado')
    );
