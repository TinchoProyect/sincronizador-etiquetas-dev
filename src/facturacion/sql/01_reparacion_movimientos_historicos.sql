-- Script de Reparación Histórica de Clasificación Bancaria
-- Sistema LAMDA - Facturación y Cuentas Bancarias
-- Fecha: 2026-09-07

BEGIN;

-- 1. Reparar cobros de clientes por "Servicio Pago a Proveedores" (Tito I SRL, Belgian City Bell)
-- Pasan de 'Gasto Comisión' a 'Transferencia'
UPDATE public.fin_movimientos_bancarios
SET tipo_operacion = 'Transferencia'
WHERE credito > 0 
  AND tipo_operacion = 'Gasto Comisión'
  AND concepto ILIKE '%SERVICIO PAGO A PROVEEDORES%';

-- 2. Reparar depósitos en cajero automático (que decían 'AUTOSERVICIO')
-- Pasan de 'Gasto Comisión' a 'Depósito'
UPDATE public.fin_movimientos_bancarios
SET tipo_operacion = 'Depósito'
WHERE credito > 0 
  AND tipo_operacion = 'Gasto Comisión'
  AND concepto ILIKE '%AUTOSERVICIO%';

-- 3. Reparar compras con tarjeta de débito en caja
-- Pasan de 'Depósito' a 'Otros'
UPDATE public.fin_movimientos_bancarios
SET tipo_operacion = 'Otros'
WHERE debito > 0 
  AND tipo_operacion = 'Depósito'
  AND concepto ILIKE '%COMPRA DEBITO%';

-- 4. Reparar acreditaciones de cheques electrónicos (eCheqs)
-- Pasan de 'Otros' a 'Depósito'
UPDATE public.fin_movimientos_bancarios
SET tipo_operacion = 'Depósito'
WHERE credito > 0 
  AND tipo_operacion = 'Otros'
  AND concepto ILIKE '%ECHEQ%';

COMMIT;
