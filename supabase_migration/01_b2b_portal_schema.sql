-- =====================================================================
-- 01_b2b_portal_schema.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- DDL para la estructura de datos en Supabase (Fase 1 - Escalabilidad Jerárquica y Multi-Listas)
-- =====================================================================

-- Habilitar extensión uuid-ossp si no está habilitada
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Perfiles de Clientes B2B (Soporta múltiples usuarios por empresa/tenant)
-- Vincula usuarios de Supabase Auth con los clientes del sistema local.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_perfiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    cliente_id TEXT NOT NULL, -- Código de cliente de la distribuidora (no es UNIQUE para permitir sub-usuarios/colaboradores)
    rol TEXT NOT NULL DEFAULT 'Dueno', -- 'Dueno', 'Colaborador'
    permisos TEXT[] NOT NULL DEFAULT '{}', -- Permisos granulares: 'compras', 'pagos', etc.
    nombre_completo TEXT,
    nombre_empresa TEXT,
    cuit TEXT,
    email TEXT,
    creado_por UUID REFERENCES public.clientes_b2b_perfiles(id) ON DELETE SET NULL, -- Referencia al dueño que lo creó
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS en perfiles
ALTER TABLE public.clientes_b2b_perfiles ENABLE ROW LEVEL SECURITY;

-- 1b. Tabla Relacional de Listas de Precios Asignadas por Empresa
-- Vincula directamente el cliente_id (empresa) con las listas de precios autorizadas.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_perfiles_listas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id TEXT NOT NULL, -- Vinculado a la empresa (cliente_id de perfiles)
    lista_id INTEGER NOT NULL, -- ID de lista de precios local
    es_principal BOOLEAN DEFAULT false, -- Identifica la lista base
    fecha_inicio DATE, -- Opcional: Fecha de vigencia desde
    fecha_fin DATE, -- Opcional: Fecha de vigencia hasta
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cliente_id, lista_id)
);

-- Habilitar RLS en la tabla de asignación de listas
ALTER TABLE public.clientes_b2b_perfiles_listas ENABLE ROW LEVEL SECURITY;

-- Indexar por cliente_id y fechas para filtrado rápido
CREATE INDEX IF NOT EXISTS idx_clientes_b2b_perfiles_listas_cliente ON public.clientes_b2b_perfiles_listas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_clientes_b2b_perfiles_listas_vigencia ON public.clientes_b2b_perfiles_listas(fecha_inicio, fecha_fin);

-- 2. Cuentas Corrientes de Clientes
-- Guarda el historial de facturas, pagos, notas de crédito/débito y saldos.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_cuentas_corrientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id TEXT NOT NULL, -- Código de cliente local
    fecha DATE NOT NULL,
    tipo_comprobante TEXT NOT NULL, -- 'FC', 'RC', 'NC', 'ND'
    numero_comprobante TEXT NOT NULL, -- ej: '0001-00001234'
    debe NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    haber NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    saldo NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    comprobante_url TEXT, -- Enlace de descarga del PDF en storage
    local_movimiento_id INTEGER UNIQUE, -- ID único del movimiento en la base local para sincronización
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS en cuentas corrientes
ALTER TABLE public.clientes_b2b_cuentas_corrientes ENABLE ROW LEVEL SECURITY;

-- Indexar por cliente_id y fecha para optimizar consultas de la grilla
CREATE INDEX IF NOT EXISTS idx_clientes_b2b_cc_cliente_id ON public.clientes_b2b_cuentas_corrientes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_clientes_b2b_cc_fecha ON public.clientes_b2b_cuentas_corrientes(fecha DESC);

-- 3. Pedidos Cabecera (Autogestión y Carrito)
-- Órdenes generadas por los clientes en el portal.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_pedidos_cabecera (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id TEXT NOT NULL, -- Código de cliente local
    fecha_pedido TIMESTAMPTZ DEFAULT NOW(),
    estado TEXT NOT NULL DEFAULT 'Borrador', -- 'Borrador', 'Confirmado', 'En Preparacion', 'Asignado a Chofer', 'En Camino', 'Entregado'
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    descuento NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    observaciones TEXT,
    sync_estado TEXT NOT NULL DEFAULT 'Pendiente', -- 'Pendiente', 'Sincronizado', 'Error'
    sync_mensaje TEXT, -- Detalle de error si falla la sincronización a la oficina local
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS en pedidos cabecera
ALTER TABLE public.clientes_b2b_pedidos_cabecera ENABLE ROW LEVEL SECURITY;

-- Indexar pedidos para consultas eficientes
CREATE INDEX IF NOT EXISTS idx_pedidos_b2b_cliente_id ON public.clientes_b2b_pedidos_cabecera(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_b2b_sync_estado ON public.clientes_b2b_pedidos_cabecera(sync_estado);

-- 4. Pedidos Detalles / Ítems
-- Detalle de los artículos pedidos.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_pedidos_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id UUID NOT NULL REFERENCES public.clientes_b2b_pedidos_cabecera(id) ON DELETE CASCADE,
    producto_codigo TEXT NOT NULL, -- Código de artículo local (ej: '20647')
    producto_descripcion TEXT NOT NULL,
    cantidad NUMERIC(12, 2) NOT NULL,
    precio_unitario NUMERIC(12, 2) NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS en pedidos items
ALTER TABLE public.clientes_b2b_pedidos_items ENABLE ROW LEVEL SECURITY;

-- Indexar detalles por pedido_id
CREATE INDEX IF NOT EXISTS idx_pedidos_b2b_items_pedido ON public.clientes_b2b_pedidos_items(pedido_id);

-- 5. Catálogo de Artículos y Precios Personalizados
-- Contiene los artículos del sistema local mapeados a su precio y stock correspondiente a cada lista.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_catalogo_precios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lista_id INTEGER NOT NULL, -- ID de lista de precio local
    producto_codigo TEXT NOT NULL,
    producto_descripcion TEXT NOT NULL,
    precio_final NUMERIC(12, 2) NOT NULL,
    stock_disponible NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    rubro TEXT,
    sub_rubro TEXT,
    busqueda_metadata TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(lista_id, producto_codigo)
);

-- Habilitar RLS en catalogo precios
ALTER TABLE public.clientes_b2b_catalogo_precios ENABLE ROW LEVEL SECURITY;

-- Indexar por lista_id para carga veloz del catálogo
CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_lista ON public.clientes_b2b_catalogo_precios(lista_id);

-- =====================================================================
-- 6. Tabla de Invitaciones de Onboarding
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.clientes_b2b_invitaciones (
    token VARCHAR(64) PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT false,
    razon_social TEXT NOT NULL,
    email_portal TEXT NOT NULL,
    email_portal_nombre TEXT,
    email_portal_cargo TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS en invitaciones
ALTER TABLE public.clientes_b2b_invitaciones ENABLE ROW LEVEL SECURITY;

