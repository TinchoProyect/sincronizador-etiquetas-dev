/**
 * Modelo de Presupuestos
 * Consultas relacionadas con presupuestos para logística
 */

/**
 * Auto-asignar domicilios a presupuestos huérfanos
 * Busca presupuestos sin domicilio y les asigna el domicilio predeterminado del cliente
 */
async function autoAsignarDomicilios(pool) {
    try {
        console.log('[AUTO-HEALING] Iniciando auto-asignación de domicilios...');
        
        // Query para auto-asignar domicilios predeterminados
        const query = `
            WITH presupuestos_huerfanos AS (
                SELECT 
                    p.id as presupuesto_id,
                    p.id_cliente,
                    c.id as cliente_id_interno
                FROM presupuestos p
                INNER JOIN clientes c ON c.cliente_id::text = p.id_cliente
                WHERE 
                    p.secuencia = 'Pedido_Listo'
                    AND p.estado = 'Presupuesto/Orden'
                    AND p.activo = true
                    AND p.id_domicilio_entrega IS NULL
            ),
            domicilios_candidatos AS (
                SELECT DISTINCT ON (ph.presupuesto_id)
                    ph.presupuesto_id,
                    cd.id as domicilio_id,
                    cd.alias,
                    cd.es_predeterminado
                FROM presupuestos_huerfanos ph
                INNER JOIN clientes_domicilios cd ON cd.id_cliente = ph.cliente_id_interno
                WHERE cd.activo = true
                ORDER BY 
                    ph.presupuesto_id,
                    cd.es_predeterminado DESC,
                    cd.fecha_creacion ASC
            )
            UPDATE presupuestos p
            SET id_domicilio_entrega = dc.domicilio_id
            FROM domicilios_candidatos dc
            WHERE p.id = dc.presupuesto_id
            RETURNING p.id, p.id_cliente, dc.domicilio_id, dc.alias
        `;
        
        const result = await pool.query(query);
        
        if (result.rowCount > 0) {
            console.log(`[AUTO-HEALING] ✅ ${result.rowCount} presupuesto(s) auto-asignado(s):`);
            result.rows.forEach(row => {
                console.log(`  - Presupuesto ${row.id} → Domicilio "${row.alias}" (ID: ${row.domicilio_id})`);
            });
        } else {
            console.log('[AUTO-HEALING] ℹ️ No hay presupuestos huérfanos para auto-asignar');
        }
        
        return result.rowCount;
        
    } catch (error) {
        console.error('[AUTO-HEALING] ❌ Error en auto-asignación:', error);
        // No lanzar error, solo loguear (es un proceso auxiliar)
        return 0;
    }
}

/**
 * Obtener presupuestos disponibles para asignar a rutas
 * Criterios:
 * - Secuencia: 'Pedido listo' (CRÍTICO)
 * - Estado logístico: PENDIENTE_ASIGNAR, PENDIENTE o NULL
 * - Tiene domicilio de entrega asignado
 * - Activo: true
 * 
 * INCLUYE AUTO-HEALING: Asigna automáticamente domicilios antes de retornar
 */
async function obtenerPresupuestosDisponibles(pool) {
    // PASO 1: Auto-asignar domicilios a presupuestos huérfanos
    await autoAsignarDomicilios(pool);
    
    // PASO 2: Obtener presupuestos disponibles
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
            
            -- Datos del cliente (cliente_id es el código visual, no el PK)
            c.cliente_id,
            c.nombre_completo as cliente_nombre,
            c.telefono as cliente_telefono,
            
            -- Datos del domicilio
            cd.direccion as domicilio_direccion,
            cd.localidad as domicilio_localidad,
            cd.provincia as domicilio_provincia,
            cd.latitud as domicilio_latitud,
            cd.longitud as domicilio_longitud
            
        FROM presupuestos p
        
        -- JOIN con clientes: conversión explícita de tipos (cliente_id es INTEGER, id_cliente es TEXT)
        INNER JOIN clientes c ON c.cliente_id::text = p.id_cliente
        
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
    contarPresupuestosDisponibles,
    autoAsignarDomicilios
};
