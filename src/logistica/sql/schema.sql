-- ===================================
-- ESQUEMA DE BASE DE DATOS
-- MÓDULO DE LOGÍSTICA Y REPARTO - SISTEMA LAMDA
-- ===================================

-- 🔍 [LOGISTICA] Script de creación de tablas para el módulo de logística
-- Este archivo contiene la estructura de base de datos necesaria para el funcionamiento del módulo
-- NOTA: Las tablas ya fueron creadas manualmente en PgAdmin. Este archivo es solo documentación.

-- ===================================
-- TABLA: vehiculos (NUEVA)
-- ===================================
CREATE TABLE IF NOT EXISTS vehiculos (
    id SERIAL PRIMARY KEY,
    patente VARCHAR(10) UNIQUE NOT NULL,
    marca VARCHAR(50),
    modelo VARCHAR(50),
    capacidad_kg NUMERIC(8,2),
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT NOW(),
    fecha_modificacion TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE vehiculos IS 'Vehículos disponibles para rutas de reparto';
COMMENT ON COLUMN vehiculos.patente IS 'Patente única del vehículo';
COMMENT ON COLUMN vehiculos.capacidad_kg IS 'Capacidad de carga en kilogramos';

-- ===================================
-- TABLA: rutas (YA EXISTE - MEJORAS)
-- ===================================
-- Tabla base ya creada, agregar columnas adicionales si no existen

ALTER TABLE rutas ADD COLUMN IF NOT EXISTS nombre_ruta VARCHAR(100);
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMP DEFAULT NOW();
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS fecha_finalizacion TIMESTAMP;
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS usuario_creador_id INTEGER REFERENCES usuarios(id);
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS distancia_total_km NUMERIC(8,2);
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS tiempo_estimado_min INTEGER;

COMMENT ON COLUMN rutas.nombre_ruta IS 'Nombre descriptivo de la ruta (ej: Zona Norte - 15/01/2025)';
COMMENT ON COLUMN rutas.distancia_total_km IS 'Distancia total calculada de la ruta';
COMMENT ON COLUMN rutas.tiempo_estimado_min IS 'Tiempo estimado de recorrido en minutos';

-- Índices para rutas
CREATE INDEX IF NOT EXISTS idx_rutas_estado_fecha ON rutas(estado, fecha_salida);
CREATE INDEX IF NOT EXISTS idx_rutas_chofer ON rutas(id_chofer) WHERE id_chofer IS NOT NULL;

-- ===================================
-- TABLA: rutas_tracking (YA EXISTE - MEJORAS)
-- ===================================
-- Tabla base ya creada, agregar columnas adicionales si no existen

ALTER TABLE rutas_tracking ADD COLUMN IF NOT EXISTS velocidad NUMERIC(5,2);
ALTER TABLE rutas_tracking ADD COLUMN IF NOT EXISTS precision_gps NUMERIC(6,2);
ALTER TABLE rutas_tracking ADD COLUMN IF NOT EXISTS bateria_dispositivo INTEGER;

COMMENT ON COLUMN rutas_tracking.velocidad IS 'Velocidad en km/h al momento del registro';
COMMENT ON COLUMN rutas_tracking.precision_gps IS 'Precisión del GPS en metros';
COMMENT ON COLUMN rutas_tracking.bateria_dispositivo IS 'Nivel de batería del dispositivo (0-100)';

-- Índices para tracking
CREATE INDEX IF NOT EXISTS idx_rutas_tracking_ruta_timestamp ON rutas_tracking(id_ruta, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_rutas_tracking_timestamp ON rutas_tracking(timestamp DESC);

-- ===================================
-- TABLA: clientes_domicilios (YA EXISTE - MEJORAS)
-- ===================================
-- Tabla base ya creada, agregar columnas adicionales si no existen

ALTER TABLE clientes_domicilios ADD COLUMN IF NOT EXISTS localidad VARCHAR(100);
ALTER TABLE clientes_domicilios ADD COLUMN IF NOT EXISTS provincia VARCHAR(100);
ALTER TABLE clientes_domicilios ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(10);
ALTER TABLE clientes_domicilios ADD COLUMN IF NOT EXISTS telefono_contacto VARCHAR(20);
ALTER TABLE clientes_domicilios ADD COLUMN IF NOT EXISTS instrucciones_entrega TEXT;
ALTER TABLE clientes_domicilios ADD COLUMN IF NOT EXISTS horario_atencion_desde TIME;
ALTER TABLE clientes_domicilios ADD COLUMN IF NOT EXISTS horario_atencion_hasta TIME;
ALTER TABLE clientes_domicilios ADD COLUMN IF NOT EXISTS coordenadas_validadas BOOLEAN DEFAULT FALSE;
ALTER TABLE clientes_domicilios ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMP DEFAULT NOW();
ALTER TABLE clientes_domicilios ADD COLUMN IF NOT EXISTS fecha_modificacion TIMESTAMP DEFAULT NOW();
ALTER TABLE clientes_domicilios ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;

COMMENT ON TABLE clientes_domicilios IS 'Domicilios de entrega de los clientes (múltiples por cliente)';
COMMENT ON COLUMN clientes_domicilios.alias IS 'Nombre descriptivo del domicilio (ej: Sucursal Centro)';
COMMENT ON COLUMN clientes_domicilios.instrucciones_entrega IS 'Instrucciones especiales para la entrega';
COMMENT ON COLUMN clientes_domicilios.coordenadas_validadas IS 'Indica si las coordenadas fueron validadas por geocoding';

-- Constraint: solo un domicilio predeterminado por cliente
CREATE UNIQUE INDEX IF NOT EXISTS idx_un_domicilio_predeterminado 
ON clientes_domicilios(id_cliente) 
WHERE es_predeterminado = TRUE;

-- Índices para domicilios
CREATE INDEX IF NOT EXISTS idx_domicilios_cliente ON clientes_domicilios(id_cliente) WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_domicilios_coordenadas ON clientes_domicilios(latitud, longitud) WHERE latitud IS NOT NULL;

-- ===================================
-- TABLA: pagos_sobres (YA EXISTE - MEJORAS)
-- ===================================
-- Tabla base ya creada, agregar columnas adicionales si no existen

ALTER TABLE pagos_sobres ADD COLUMN IF NOT EXISTS fecha_declaracion TIMESTAMP DEFAULT NOW();
ALTER TABLE pagos_sobres ADD COLUMN IF NOT EXISTS fecha_recoleccion TIMESTAMP;
ALTER TABLE pagos_sobres ADD COLUMN IF NOT EXISTS fecha_conciliacion TIMESTAMP;
ALTER TABLE pagos_sobres ADD COLUMN IF NOT EXISTS usuario_conciliador_id INTEGER REFERENCES usuarios(id);
ALTER TABLE pagos_sobres ADD COLUMN IF NOT EXISTS monto_real NUMERIC(12,2);
ALTER TABLE pagos_sobres ADD COLUMN IF NOT EXISTS diferencia NUMERIC(12,2);
ALTER TABLE pagos_sobres ADD COLUMN IF NOT EXISTS observaciones TEXT;

COMMENT ON TABLE pagos_sobres IS 'Registro de pagos en efectivo (sobres) declarados por chofer o cliente';
COMMENT ON COLUMN pagos_sobres.origen_carga IS 'Quién declaró el pago: CHOFER o CLIENTE';
COMMENT ON COLUMN pagos_sobres.monto_declarado IS 'Monto declarado por quien cargó el pago';
COMMENT ON COLUMN pagos_sobres.monto_real IS 'Monto real verificado en conciliación';
COMMENT ON COLUMN pagos_sobres.diferencia IS 'Diferencia entre monto declarado y real';

-- Índices para pagos
CREATE INDEX IF NOT EXISTS idx_pagos_presupuesto ON pagos_sobres(id_presupuesto);
CREATE INDEX IF NOT EXISTS idx_pagos_estado ON pagos_sobres(estado);

-- ===================================
-- TABLA: entregas_eventos (YA EXISTE - MEJORAS)
-- ===================================
-- Tabla base ya creada, agregar columnas adicionales si no existen

ALTER TABLE entregas_eventos ADD COLUMN IF NOT EXISTS longitud_confirmacion NUMERIC(11,8);
ALTER TABLE entregas_eventos ADD COLUMN IF NOT EXISTS fecha_entrega TIMESTAMP DEFAULT NOW();
ALTER TABLE entregas_eventos ADD COLUMN IF NOT EXISTS firma_digital TEXT;
ALTER TABLE entregas_eventos ADD COLUMN IF NOT EXISTS dni_receptor VARCHAR(20);
ALTER TABLE entregas_eventos ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE entregas_eventos ADD COLUMN IF NOT EXISTS tiempo_entrega_min INTEGER;

COMMENT ON TABLE entregas_eventos IS 'Registro de eventos de entrega (confirmaciones, rechazos, etc.)';
COMMENT ON COLUMN entregas_eventos.receptor_nombre IS 'Nombre de quien recibió el pedido';
COMMENT ON COLUMN entregas_eventos.receptor_vinculo IS 'Relación con el cliente (ej: Encargado, Dueño)';
COMMENT ON COLUMN entregas_eventos.firma_digital IS 'Firma digital en formato base64';
COMMENT ON COLUMN entregas_eventos.tiempo_entrega_min IS 'Tiempo que tomó la entrega en minutos';

-- Índices para entregas
CREATE INDEX IF NOT EXISTS idx_entregas_presupuesto ON entregas_eventos(id_presupuesto);
CREATE INDEX IF NOT EXISTS idx_entregas_fecha ON entregas_eventos(fecha_entrega DESC);

-- ===================================
-- MODIFICACIONES EN TABLA: presupuestos
-- ===================================
-- Agregar columnas logísticas si no existen

ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS fecha_asignacion_ruta TIMESTAMP;
ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS fecha_entrega_estimada TIMESTAMP;
ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS fecha_entrega_real TIMESTAMP;
ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS motivo_no_entrega TEXT;

COMMENT ON COLUMN presupuestos.id_ruta IS 'Ruta asignada para la entrega';
COMMENT ON COLUMN presupuestos.id_domicilio_entrega IS 'Domicilio específico de entrega';
COMMENT ON COLUMN presupuestos.orden_entrega IS 'Orden de entrega dentro de la ruta';
COMMENT ON COLUMN presupuestos.estado_logistico IS 'Estado del proceso logístico';
COMMENT ON COLUMN presupuestos.bloqueo_entrega IS 'Indica si la entrega está bloqueada (ej: pago pendiente)';

-- Índices para presupuestos logísticos
CREATE INDEX IF NOT EXISTS idx_presupuestos_estado_logistico 
ON presupuestos(estado_logistico) WHERE estado_logistico IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_presupuestos_id_ruta 
ON presupuestos(id_ruta) WHERE id_ruta IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_presupuestos_bloqueo 
ON presupuestos(bloqueo_entrega) WHERE bloqueo_entrega = TRUE;

-- ===================================
-- TABLA: presupuestos_estados_historial (NUEVA)
-- ===================================
CREATE TABLE IF NOT EXISTS presupuestos_estados_historial (
    id SERIAL PRIMARY KEY,
    id_presupuesto INTEGER REFERENCES presupuestos(id) ON DELETE CASCADE,
    estado_anterior VARCHAR(50),
    estado_nuevo VARCHAR(50) NOT NULL,
    metadata JSONB,
    usuario_id INTEGER REFERENCES usuarios(id),
    fecha_cambio TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE presupuestos_estados_historial IS 'Historial de cambios de estado logístico de presupuestos';
COMMENT ON COLUMN presupuestos_estados_historial.metadata IS 'Información adicional del cambio (JSON)';

CREATE INDEX IF NOT EXISTS idx_estados_historial_presupuesto 
ON presupuestos_estados_historial(id_presupuesto, fecha_cambio DESC);

CREATE INDEX IF NOT EXISTS idx_estados_historial_fecha 
ON presupuestos_estados_historial(fecha_cambio DESC);

-- ===================================
-- FUNCIONES Y TRIGGERS
-- ===================================

-- Función para actualizar fecha_modificacion automáticamente
CREATE OR REPLACE FUNCTION update_fecha_modificacion()
RETURNS TRIGGER AS $$
BEGIN
    NEW.fecha_modificacion = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para vehiculos
DROP TRIGGER IF EXISTS trigger_update_vehiculos_fecha ON vehiculos;
CREATE TRIGGER trigger_update_vehiculos_fecha
    BEFORE UPDATE ON vehiculos
    FOR EACH ROW
    EXECUTE FUNCTION update_fecha_modificacion();

-- Trigger para clientes_domicilios
DROP TRIGGER IF EXISTS trigger_update_domicilios_fecha ON clientes_domicilios;
CREATE TRIGGER trigger_update_domicilios_fecha
    BEFORE UPDATE ON clientes_domicilios
    FOR EACH ROW
    EXECUTE FUNCTION update_fecha_modificacion();

-- ===================================
-- VISTAS ÚTILES
-- ===================================

-- Vista de rutas con información completa
CREATE OR REPLACE VIEW vista_rutas_completas AS
SELECT 
    r.id,
    r.nombre_ruta,
    r.fecha_salida,
    r.estado,
    r.distancia_total_km,
    r.tiempo_estimado_min,
    u.nombre as chofer_nombre,
    v.patente as vehiculo_patente,
    v.marca as vehiculo_marca,
    v.modelo as vehiculo_modelo,
    COUNT(p.id) as total_entregas,
    SUM(CASE WHEN p.estado_logistico = 'ENTREGADO' THEN 1 ELSE 0 END) as entregas_completadas
FROM rutas r
LEFT JOIN usuarios u ON r.id_chofer = u.id
LEFT JOIN vehiculos v ON r.id_vehiculo::integer = v.id
LEFT JOIN presupuestos p ON p.id_ruta = r.id
GROUP BY r.id, r.nombre_ruta, r.fecha_salida, r.estado, r.distancia_total_km, 
         r.tiempo_estimado_min, u.nombre, v.patente, v.marca, v.modelo;

COMMENT ON VIEW vista_rutas_completas IS 'Vista con información completa de rutas incluyendo chofer, vehículo y estadísticas';

-- Vista de domicilios con información del cliente
CREATE OR REPLACE VIEW vista_domicilios_clientes AS
SELECT 
    cd.id,
    cd.id_cliente,
    c.nombre as cliente_nombre,
    cd.alias,
    cd.direccion,
    cd.localidad,
    cd.provincia,
    cd.codigo_postal,
    cd.latitud,
    cd.longitud,
    cd.coordenadas_validadas,
    cd.es_predeterminado,
    cd.telefono_contacto,
    cd.instrucciones_entrega,
    cd.activo
FROM clientes_domicilios cd
INNER JOIN clientes c ON cd.id_cliente = c.id
WHERE cd.activo = TRUE;

COMMENT ON VIEW vista_domicilios_clientes IS 'Vista de domicilios activos con información del cliente';

-- ===================================
-- DATOS INICIALES (OPCIONAL)
-- ===================================

-- Insertar vehículo de ejemplo (comentado por defecto)
-- INSERT INTO vehiculos (patente, marca, modelo, capacidad_kg, activo)
-- VALUES ('ABC123', 'Ford', 'Ranger', 1000.00, true)
-- ON CONFLICT (patente) DO NOTHING;

-- ===================================
-- FIN DEL SCRIPT
-- ===================================

-- 🔍 [LOGISTICA] Script completado
-- Este archivo es solo documentación. Las tablas ya fueron creadas manualmente.
-- Para aplicar mejoras: ejecutar solo las secciones ALTER TABLE necesarias.
