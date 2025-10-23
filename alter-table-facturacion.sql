-- ============================================
-- ALTER TABLE para Módulo de Facturación
-- Sistema LAMDA - Presupuesto → Factura
-- ============================================
-- Fecha: 2025-10-16
-- Descripción: Agregar columnas de fechas de servicio,
--              constraints de validación y triggers de totales
-- ============================================

-- Conectar a la base de datos
\c etiquetas

-- ============================================
-- 1. AGREGAR COLUMNAS PARA FECHAS DE SERVICIO
-- ============================================

ALTER TABLE factura_facturas 
ADD COLUMN IF NOT EXISTS fch_serv_desde DATE,
ADD COLUMN IF NOT EXISTS fch_serv_hasta DATE,
ADD COLUMN IF NOT EXISTS fch_vto_pago DATE;

-- Verificar columnas agregadas
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'factura_facturas'
AND column_name IN ('fch_serv_desde', 'fch_serv_hasta', 'fch_vto_pago')
ORDER BY column_name;

-- ============================================
-- 2. AGREGAR CONSTRAINTS DE VALIDACIÓN
-- ============================================

-- 2.1 CHECK para concepto (1=Productos, 2=Servicios, 3=Ambos)
ALTER TABLE factura_facturas 
DROP CONSTRAINT IF EXISTS check_concepto;

ALTER TABLE factura_facturas 
ADD CONSTRAINT check_concepto 
CHECK (concepto IN (1, 2, 3));

-- 2.2 CHECK para moneda (solo PES, DOL, EUR)
ALTER TABLE factura_facturas 
DROP CONSTRAINT IF EXISTS check_moneda;

ALTER TABLE factura_facturas 
ADD CONSTRAINT check_moneda 
CHECK (moneda IN ('PES', 'DOL', 'EUR'));

-- 2.3 CHECK para cotización de pesos (debe ser 1)
ALTER TABLE factura_facturas 
DROP CONSTRAINT IF EXISTS check_mon_cotiz_pesos;

ALTER TABLE factura_facturas 
ADD CONSTRAINT check_mon_cotiz_pesos 
CHECK (moneda != 'PES' OR mon_cotiz = 1);

-- 2.4 CHECK para fechas de servicio (obligatorias si concepto = 2 o 3)
ALTER TABLE factura_facturas 
DROP CONSTRAINT IF EXISTS check_fechas_servicio;

ALTER TABLE factura_facturas 
ADD CONSTRAINT check_fechas_servicio 
CHECK (
    (concepto = 1) OR 
    (concepto IN (2, 3) AND fch_serv_desde IS NOT NULL AND fch_serv_hasta IS NOT NULL AND fch_vto_pago IS NOT NULL)
);

-- 2.5 CHECK para documento receptor (obligatorio si requiere AFIP)
ALTER TABLE factura_facturas 
DROP CONSTRAINT IF EXISTS check_doc_receptor;

ALTER TABLE factura_facturas 
ADD CONSTRAINT check_doc_receptor 
CHECK (
    (requiere_afip = false) OR 
    (requiere_afip = true AND doc_tipo IS NOT NULL AND doc_nro IS NOT NULL)
);

-- Verificar constraints agregados
SELECT conname, contype, pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'factura_facturas'::regclass
AND conname LIKE 'check_%'
ORDER BY conname;

-- ============================================
-- 3. FUNCIÓN Y TRIGGERS PARA RECALCULAR TOTALES
-- ============================================

-- 3.1 Crear función de recálculo
CREATE OR REPLACE FUNCTION recalcular_totales_factura()
RETURNS TRIGGER AS $$
DECLARE
    v_factura_id BIGINT;
BEGIN
    -- Determinar el ID de la factura según la operación
    IF TG_OP = 'DELETE' THEN
        v_factura_id := OLD.factura_id;
    ELSE
        v_factura_id := NEW.factura_id;
    END IF;
    
    -- Recalcular totales de la factura
    UPDATE factura_facturas f
    SET 
        imp_neto = COALESCE((
            SELECT SUM(imp_neto) 
            FROM factura_factura_items 
            WHERE factura_id = v_factura_id
        ), 0),
        imp_iva = COALESCE((
            SELECT SUM(imp_iva) 
            FROM factura_factura_items 
            WHERE factura_id = v_factura_id
        ), 0),
        imp_total = COALESCE((
            SELECT SUM(imp_neto) + SUM(imp_iva) 
            FROM factura_factura_items 
            WHERE factura_id = v_factura_id
        ), 0),
        updated_at = NOW()
    WHERE id = v_factura_id;
    
    -- Retornar según operación
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 3.2 Crear trigger para INSERT
DROP TRIGGER IF EXISTS trigger_recalcular_totales_insert ON factura_factura_items;

CREATE TRIGGER trigger_recalcular_totales_insert
AFTER INSERT ON factura_factura_items
FOR EACH ROW
EXECUTE FUNCTION recalcular_totales_factura();

-- 3.3 Crear trigger para UPDATE
DROP TRIGGER IF EXISTS trigger_recalcular_totales_update ON factura_factura_items;

CREATE TRIGGER trigger_recalcular_totales_update
AFTER UPDATE ON factura_factura_items
FOR EACH ROW
EXECUTE FUNCTION recalcular_totales_factura();

-- 3.4 Crear trigger para DELETE
DROP TRIGGER IF EXISTS trigger_recalcular_totales_delete ON factura_factura_items;

CREATE TRIGGER trigger_recalcular_totales_delete
AFTER DELETE ON factura_factura_items
FOR EACH ROW
EXECUTE FUNCTION recalcular_totales_factura();

-- Verificar triggers creados
SELECT tgname, tgtype, tgenabled
FROM pg_trigger
WHERE tgrelid = 'factura_factura_items'::regclass
AND tgname LIKE 'trigger_recalcular%'
ORDER BY tgname;

-- ============================================
-- 4. VERIFICACIÓN FINAL
-- ============================================

-- 4.1 Verificar estructura de factura_facturas
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'factura_facturas'
ORDER BY ordinal_position;

-- 4.2 Verificar constraints
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'factura_facturas'::regclass
ORDER BY conname;

-- 4.3 Verificar función y triggers
SELECT 
    p.proname as function_name,
    pg_get_functiondef(p.oid) as definition
FROM pg_proc p
WHERE p.proname = 'recalcular_totales_factura';

SELECT 
    t.tgname as trigger_name,
    t.tgenabled as enabled,
    pg_get_triggerdef(t.oid) as definition
FROM pg_trigger t
WHERE t.tgrelid = 'factura_factura_items'::regclass
AND t.tgname LIKE 'trigger_recalcular%'
ORDER BY t.tgname;

-- ============================================
-- RESUMEN DE CAMBIOS
-- ============================================

\echo ''
\echo '============================================'
\echo 'RESUMEN DE CAMBIOS APLICADOS'
\echo '============================================'
\echo ''
\echo '✅ Columnas agregadas:'
\echo '   - fch_serv_desde (DATE)'
\echo '   - fch_serv_hasta (DATE)'
\echo '   - fch_vto_pago (DATE)'
\echo ''
\echo '✅ Constraints agregados:'
\echo '   - check_concepto (1, 2, 3)'
\echo '   - check_moneda (PES, DOL, EUR)'
\echo '   - check_mon_cotiz_pesos (1 para PES)'
\echo '   - check_fechas_servicio (obligatorias si concepto 2/3)'
\echo '   - check_doc_receptor (obligatorio si requiere_afip)'
\echo ''
\echo '✅ Función creada:'
\echo '   - recalcular_totales_factura()'
\echo ''
\echo '✅ Triggers creados:'
\echo '   - trigger_recalcular_totales_insert'
\echo '   - trigger_recalcular_totales_update'
\echo '   - trigger_recalcular_totales_delete'
\echo ''
\echo '============================================'
\echo 'CAMBIOS COMPLETADOS EXITOSAMENTE'
\echo '============================================'
\echo ''
