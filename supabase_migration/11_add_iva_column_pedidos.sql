ALTER TABLE public.clientes_b2b_pedidos_cabecera ADD COLUMN IF NOT EXISTS iva NUMERIC(15, 2) DEFAULT 0.00;
