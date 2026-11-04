-- Migración: Incorporación de campos de facturación por email
-- Agrega columnas para destinatarios de correo electrónico y canal de envío preferido

ALTER TABLE public.bunker_clientes 
ADD COLUMN IF NOT EXISTS email_facturas TEXT,
ADD COLUMN IF NOT EXISTS canal_envio_preferido VARCHAR(50) DEFAULT 'whatsapp';
