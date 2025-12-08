/**
 * Modelo de Presupuestos
 * Consultas relacionadas con presupuestos para logística
 */

/**
 * Obtener presupuestos disponibles para asignar a rutas
 * Criterios:
 * - Secuencia: 'Pedido listo' (CRÍTICO)
 * - Estado logístico: PENDIENTE_ASIGNAR, PENDIENTE o NULL
 * - Tiene domicilio de entrega asignado
 * - Activo: true
 */
async function obtenerPresupuestosDisponibles(pool) {
    const query = `
        SELECT 
            p.id,
            p.id_presupuesto_ext,
            p.fecha,
            p.fecha_entrega,
            p.estado,
            p.estado_logistico,
            p.secuencia,
            p.id_domicilio_entrega,
            p.bloqueo_entrega,
            p.id_cliente,
            p.agente,
            p.nota,
            
            -- Datos del cliente (JOIN con conversión explícita de tipos TEXT vs INTEGER)
            c.cliente_id,
            c.nombre as cliente_nombre,
            c.telefono as cliente_telefono,
            c.localidad as cliente_localidad,
            
            -- Datos del domicilio (opcional)
            cd.direccion as domicilio_direccion,
            cd.localidad as domicilio_localidad,
            cd.provincia as domicilio_provincia,
            cd.latitud as domicilio_latitud,
            cd.longitud as domicilio_longitud,
            cd.coordenadas_validadas,
            
            -- Calcular total desde presupuestos_detalles (cantidad * precio1)
            COALESCE(
                (SELECT SUM(pd.cantidad * pd.precio1)
                 FROM presupuestos_detalles pd
                 WHERE pd.id_presupuesto = p.id),
                0
            ) as total
            
        FROM presupuestos p
        
        -- JOIN con clientes: conversión explícita de tipos (cliente_id es INTEGER, id_cliente es TEXT)
        INNER JOIN clientes c ON c.cliente_id::text = p.id_cliente
        
        -- LEFT JOIN con domicilios (puede no tener domicilio asignado)
        LEFT JOIN clientes_domicilios cd ON cd.id = p.id_domicilio_entrega
        
        WHERE 
            -- Filtro 1: Secuencia exacta (valor real en BD)
            p.secuencia = 'Pedido_Listo'
            
            -- Filtro 2: Estado exacto (valor real en BD)
            AND p.estado = 'Presupuesto/Orden'
            
            -- Filtro 3: Solo activos
            AND p.activo = true
            
            -- NOTA: Ignoramos estado_logistico para mostrar todos los pedidos listos
            -- NOTA: Ignoramos id_ruta para mostrar todos (incluso los ya asignados)
            
        ORDER BY 
            p.fecha DESC,
            p.id DESC
    `;
    
    const result = await pool.query(query);
    return result.rows;
}

/**
 * Obtener presupuestos de una ruta específica
 */
async function obtenerPresupuestosPorRuta(pool, rutaId) {
    const query = `
        SELECT 
            p.id,
            p.numero_presupuesto,
            p.fecha,
            p.total,
            p.estado,
            p.estado_logistico,
            p.orden_entrega,
            
            -- Datos del cliente
            c.id as cliente_id,
            c.nombre_completo as cliente_nombre,
            c.telefono as cliente_telefono,
            
            -- Datos del domicilio
            cd.direccion as domicilio_direccion,
            cd.localidad as domicilio_localidad,
            cd.provincia as domicilio_provincia,
            cd.latitud as domicilio_latitud,
            cd.longitud as domicilio_longitud
            
        FROM presupuestos p
        INNER JOIN clientes c ON p.id_cliente = c.id
        LEFT JOIN clientes_domicilios cd ON p.id_domicilio_entrega = cd.id
        
        WHERE p.id_ruta = $1
        
        ORDER BY 
            p.orden_entrega ASC NULLS LAST,
            p.id ASC
    `;
    
    const result = await pool.query(query, [rutaId]);
    return result.rows;
}

/**
 * Contar presupuestos disponibles
 */
async function contarPresupuestosDisponibles(pool) {
    const query = `
        SELECT COUNT(*) as total
        FROM presupuestos p
        WHERE 
            p.estado IN ('APROBADO', 'FACTURADO')
            AND (p.estado_logistico IS NULL OR p.estado_logistico = 'PENDIENTE_ASIGNAR')
            AND p.id_domicilio_entrega IS NOT NULL
    `;
    
    const result = await pool.query(query);
    return parseInt(result.rows[0].total);
}

module.exports = {
    obtenerPresupuestosDisponibles,
    obtenerPresupuestosPorRuta,
    contarPresupuestosDisponibles
};
