-- 23. Migración para Onboarding y Verificación Dinámica B2B

-- Agregar la columna email_portal a la tabla bunker_clientes
ALTER TABLE public.bunker_clientes 
ADD COLUMN IF NOT EXISTS email_portal VARCHAR(255) UNIQUE DEFAULT NULL;

-- Tabla para almacenar los tokens de invitación del portal
CREATE TABLE IF NOT EXISTS public.portal_invitaciones (
    id SERIAL PRIMARY KEY,
    token VARCHAR(64) UNIQUE NOT NULL,
    cliente_id VARCHAR(50) NOT NULL REFERENCES public.bunker_clientes(codigo_bunker_cliente),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    usado BOOLEAN DEFAULT FALSE
);

-- Tabla para almacenar los códigos OTP de verificación por WhatsApp
CREATE TABLE IF NOT EXISTS public.portal_otp (
    id SERIAL PRIMARY KEY,
    cliente_id VARCHAR(50) NOT NULL REFERENCES public.bunker_clientes(codigo_bunker_cliente),
    whatsapp VARCHAR(50) NOT NULL,
    codigo VARCHAR(6) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    intentos INTEGER DEFAULT 0
);
