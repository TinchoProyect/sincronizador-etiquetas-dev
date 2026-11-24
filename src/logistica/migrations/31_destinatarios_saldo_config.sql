-- Migración 31: Persistencia permanente de destinatarios y canales para Reportes de Saldo
-- Independiente del navegador/PC y aislada de las preferencias de Facturación ARCA (default_factura).

ALTER TABLE public.bunker_clientes
    ADD COLUMN IF NOT EXISTS destinatarios_saldo_config JSONB DEFAULT NULL;

COMMENT ON COLUMN public.bunker_clientes.destinatarios_saldo_config IS
    'Configuración permanente de canales y destinatarios para envío de reportes de saldo/cuenta corriente ({ configurado: boolean, whatsapp: string[], email: string[], actualizado_en: ISOString }).';
