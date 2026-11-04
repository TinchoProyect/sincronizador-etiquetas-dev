-- 30. Creación de tabla para gestión y auditoría de pagos en efectivo ensobrados
CREATE TABLE IF NOT EXISTS public.factura_pagos_efectivo (
    id SERIAL PRIMARY KEY,
    codigo_sobre VARCHAR(50) NOT NULL UNIQUE,
    cliente_id VARCHAR(50) NOT NULL, -- Mapea a codigo_bunker_cliente
    monto_declarado NUMERIC(15, 2) NOT NULL,
    desglose_billetes JSONB NOT NULL DEFAULT '{}'::jsonb,
    foto_frente_url TEXT,
    foto_dorso_url TEXT,
    modalidad_entrega VARCHAR(20) NOT NULL DEFAULT 'CHOFER', -- 'CHOFER' | 'LOCAL'
    estado VARCHAR(30) NOT NULL DEFAULT 'PREPARADO', -- 'PREPARADO', 'EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO', 'OBSERVADO', 'CANCELADO'
    observaciones_cliente TEXT,
    observaciones_admin TEXT,
    local_movimiento_id INTEGER REFERENCES public.factura_cuenta_corriente_movimientos(id) ON DELETE SET NULL,
    recibo_url TEXT,
    monto_auditado NUMERIC(15, 2),
    auditado_por VARCHAR(100),
    fecha_auditoria TIMESTAMP,
    chofer_nombre VARCHAR(100),
    fecha_retiro_chofer TIMESTAMP,
    sincronizado_supabase BOOLEAN NOT NULL DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_factura_pagos_efectivo_cliente ON public.factura_pagos_efectivo(cliente_id);
CREATE INDEX IF NOT EXISTS idx_factura_pagos_efectivo_estado ON public.factura_pagos_efectivo(estado);
CREATE INDEX IF NOT EXISTS idx_factura_pagos_efectivo_codigo ON public.factura_pagos_efectivo(codigo_sobre);
