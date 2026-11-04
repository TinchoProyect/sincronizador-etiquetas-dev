-- 19. Creación de la tabla bunker_clientes
CREATE TABLE IF NOT EXISTS public.bunker_clientes (
    id SERIAL PRIMARY KEY,
    codigo_bunker_cliente VARCHAR(50) UNIQUE NOT NULL,
    cliente_nombre VARCHAR(255) NOT NULL,
    razon_social VARCHAR(255) NOT NULL,
    lomas_soft_id VARCHAR(50) UNIQUE DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índice para búsquedas rápidas por nombre y códigos
CREATE INDEX IF NOT EXISTS idx_bunker_clientes_busqueda 
ON public.bunker_clientes(codigo_bunker_cliente, cliente_nombre, lomas_soft_id);
