-- 20. Creación de tablas de cuenta corriente de clientes búnker
CREATE TABLE IF NOT EXISTS public.factura_cuentas_corrientes (
    id SERIAL PRIMARY KEY,
    codigo_bunker_cliente VARCHAR(50) NOT NULL REFERENCES public.bunker_clientes(codigo_bunker_cliente) ON DELETE CASCADE,
    nombre_cuenta VARCHAR(255) NOT NULL DEFAULT 'Cuenta Principal',
    moneda VARCHAR(10) NOT NULL DEFAULT 'ARS',
    saldo NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA',
    creada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(codigo_bunker_cliente, nombre_cuenta)
);

CREATE TABLE IF NOT EXISTS public.factura_cuenta_corriente_movimientos (
    id SERIAL PRIMARY KEY,
    cuenta_corriente_id INTEGER NOT NULL REFERENCES public.factura_cuentas_corrientes(id) ON DELETE CASCADE,
    tipo_movimiento VARCHAR(10) NOT NULL, -- 'DEBITO' o 'CREDITO'
    monto NUMERIC(15, 2) NOT NULL,
    saldo_resultante NUMERIC(15, 2) NOT NULL,
    tipo_comprobante VARCHAR(50), -- 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'NOTA_CREDITO', 'RECIBO_PAGO', 'AJUSTE_MANUAL'
    comprobante_id bigint REFERENCES public.factura_facturas(id) ON DELETE SET NULL,
    descripcion VARCHAR(500) NOT NULL,
    fecha_movimiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_factura_cc_cliente ON public.factura_cuentas_corrientes(codigo_bunker_cliente);
CREATE INDEX IF NOT EXISTS idx_factura_cc_movs_cuenta ON public.factura_cuenta_corriente_movimientos(cuenta_corriente_id);
