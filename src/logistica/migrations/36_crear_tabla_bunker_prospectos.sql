-- =========================================================================
-- Migración 36: Creación de la Tabla bunker_prospectos (CRM Preventa de Calle y Depósito)
-- Sistema LAMDA - Módulo de Prospección Comercial & Preventa
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.bunker_prospectos (
    id SERIAL PRIMARY KEY,
    codigo_prospecto VARCHAR(30) UNIQUE NOT NULL,
    origen_contacto VARCHAR(30) NOT NULL DEFAULT 'CALLE', -- 'CALLE', 'MOSTRADOR_DEPOSITO', 'TELEFONICO', 'REFERIDO'
    nombre_fantasia VARCHAR(255) NOT NULL,
    rubro VARCHAR(100) DEFAULT 'Dietética',
    direccion VARCHAR(255),
    localidad VARCHAR(100),
    zona VARCHAR(100),
    latitud NUMERIC(10, 7) DEFAULT NULL,
    longitud NUMERIC(10, 7) DEFAULT NULL,
    contacto_nombre VARCHAR(150),
    contacto_rol VARCHAR(50) DEFAULT 'OTRO', -- 'DUEÑO', 'ENCARGADO', 'REPOSITOR', 'EMPLEADO', 'COMPRADOR', 'OTRO'
    telefono_whatsapp VARCHAR(50),
    email VARCHAR(150) DEFAULT NULL,
    estado VARCHAR(50) NOT NULL DEFAULT 'CONTACTO_INICIAL', -- 'CONTACTO_INICIAL', 'LISTA_ENVIADA', 'VISITA_AGENDADA', 'EN_NEGOCIACION', 'CONVERTIDO', 'DESCARTADO'
    fecha_revisita TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    notas TEXT DEFAULT NULL,
    lista_precios_sugerida_id INTEGER DEFAULT NULL,
    creado_por VARCHAR(100) DEFAULT 'sistema',
    convertido_cliente_id INTEGER REFERENCES public.bunker_clientes(id) ON DELETE SET NULL DEFAULT NULL,
    convertido_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices estratégicos para búsqueda rápida, filtrado por zona y agenda
CREATE INDEX IF NOT EXISTS idx_bunker_prospectos_busqueda 
ON public.bunker_prospectos (LOWER(nombre_fantasia), LOWER(contacto_nombre), LOWER(direccion));

CREATE INDEX IF NOT EXISTS idx_bunker_prospectos_telefono 
ON public.bunker_prospectos (telefono_whatsapp);

CREATE INDEX IF NOT EXISTS idx_bunker_prospectos_zona 
ON public.bunker_prospectos (zona);

CREATE INDEX IF NOT EXISTS idx_bunker_prospectos_estado 
ON public.bunker_prospectos (estado);

CREATE INDEX IF NOT EXISTS idx_bunker_prospectos_fecha_revisita 
ON public.bunker_prospectos (fecha_revisita);

CREATE INDEX IF NOT EXISTS idx_bunker_prospectos_origen 
ON public.bunker_prospectos (origen_contacto);

-- Secuencia para códigos amigables (ej: PROSP-001) si no se especifica manualmente
CREATE SEQUENCE IF NOT EXISTS public.seq_bunker_prospectos_cod START WITH 1 INCREMENT BY 1;
