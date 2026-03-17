-- Parche SQL: Restricción Única Parcial para Conciliación 1:1
-- Este índice previene colisiones y duplicados asegurando que ningún par (punto de venta / nro de factura) Lomasoft sea asociado más de una vez a presupuestos/retiros válidos.

CREATE UNIQUE INDEX uk_presupuestos_origen 
ON public.presupuestos (origen_punto_venta, origen_numero_factura) 
WHERE origen_numero_factura IS NOT NULL AND origen_numero_factura != '';
