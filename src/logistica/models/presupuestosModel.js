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
                    bc.id as bc_id,
                    c.id as c_id,
                    bc.lomas_soft_id,
                    c.cliente_id
                FROM presupuestos p
                LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = p.id_cliente 
                     OR (bc.lomas_soft_id IS NOT NULL AND bc.lomas_soft_id ~ '^[0-9]+$' AND p.id_cliente ~ '^[0-9]+$' AND bc.lomas_soft_id::integer = p.id_cliente::integer)
                     OR bc.lomas_soft_id = p.id_cliente
                LEFT JOIN clientes c ON c.cliente_id::text = ltrim(p.id_cliente, '0') OR c.cliente_id::text = p.id_cliente
                WHERE 
                    p.secuencia = 'Pedido_Listo'
                    AND p.estado IN ('Presupuesto/Orden', 'Orden de Tratamiento', 'Orden de Retiro', 'Facturado', 'Administrativa NC', 'Enviado a Facturación')
                    AND p.activo = true
                    AND p.id_domicilio_entrega IS NULL
                    AND (p.estado_logistico IS NULL OR p.estado_logistico != 'OMITIDO')
            ),
            domicilios_candidatos AS (
                SELECT DISTINCT ON (ph.presupuesto_id)
                    ph.presupuesto_id,
                    cd.id as domicilio_id,
                    cd.alias,
                    cd.es_predeterminado
                FROM presupuestos_huerfanos ph
                INNER JOIN clientes_domicilios cd ON (
                    cd.id_cliente = ph.bc_id
                    OR cd.id_cliente = ph.c_id
                    OR cd.id_cliente::text = ph.lomas_soft_id
                    OR cd.id_cliente::text = ph.cliente_id::text
                    OR cd.id_cliente::text = ph.id_cliente
                )
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

        // Auto-asignar domicilios a sobres de efectivo activos sin domicilio
        const querySobres = `
            WITH sobres_huerfanos AS (
                SELECT 
                    p.id as sobre_id,
                    p.cliente_id as raw_cliente_id,
                    bc.id as bc_id,
                    c.id as c_id,
                    bc.lomas_soft_id,
                    c.cliente_id
                FROM public.factura_pagos_efectivo p
                LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = p.cliente_id OR bc.lomas_soft_id = p.cliente_id
                LEFT JOIN public.clientes c ON (bc.lomas_soft_id IS NOT NULL AND c.cliente_id::text = ltrim(bc.lomas_soft_id, '0'))
                                            OR (bc.id IS NULL AND c.cliente_id::text = ltrim(p.cliente_id, '0'))
                WHERE p.id_domicilio_entrega IS NULL
                  AND p.modalidad_entrega = 'CHOFER'
                  AND p.estado IN ('PREPARADO', 'EN_TRANSITO')
            ),
            domicilios_sobres AS (
                SELECT DISTINCT ON (sh.sobre_id)
                    sh.sobre_id,
                    COALESCE(
                        (
                            SELECT pr.id_domicilio_entrega
                            FROM public.presupuestos pr
                            WHERE pr.activo = true
                              AND pr.id_domicilio_entrega IS NOT NULL
                              AND ltrim(pr.id_cliente, '0') = COALESCE(sh.cliente_id::text, ltrim(sh.lomas_soft_id, '0'))
                            ORDER BY (pr.secuencia IN ('Pedido_Listo', 'Asignado_Ruta')) DESC, pr.id DESC
                            LIMIT 1
                        ),
                        cd.id
                    ) as domicilio_id,
                    cd.alias
                FROM sobres_huerfanos sh
                LEFT JOIN public.clientes_domicilios cd ON (
                    cd.id_cliente = sh.bc_id
                    OR cd.id_cliente = sh.c_id
                    OR cd.id_cliente::text = sh.lomas_soft_id
                    OR cd.id_cliente::text = sh.cliente_id::text
                    OR cd.id_cliente::text = sh.raw_cliente_id
                ) AND cd.activo = true
                ORDER BY 
                    sh.sobre_id,
                    cd.es_predeterminado DESC,
                    cd.fecha_creacion ASC,
                    cd.id ASC
            )
            UPDATE public.factura_pagos_efectivo fpe
            SET id_domicilio_entrega = ds.domicilio_id
            FROM domicilios_sobres ds
            WHERE fpe.id = ds.sobre_id AND ds.domicilio_id IS NOT NULL
            RETURNING fpe.id, fpe.codigo_sobre, ds.domicilio_id, ds.alias
        `;
        const resSobres = await pool.query(querySobres);
        if (resSobres.rowCount > 0) {
            console.log(`[AUTO-HEALING] 💵 ${resSobres.rowCount} sobre(s) de efectivo auto-asignado(s) con domicilio.`);
        }

        return result.rowCount + (resSobres.rowCount || 0);

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
            p.factura_id,
            p.motivo_no_entrega,
            f.estado AS factura_estado,
            
            -- Datos del cliente (JOIN con conversión explícita de tipos TEXT vs INTEGER)
            c.cliente_id,
            c.nombre as cliente_nombre,
            c.telefono as cliente_telefono,
            c.localidad as cliente_localidad,
            COALESCE(bc.preferencia_facturacion, c.preferencia_facturacion, 'PREGUNTAR') as preferencia_facturacion,
            
            -- Datos del domicilio (opcional)
            cd.direccion as domicilio_direccion,
            cd.localidad as domicilio_localidad,
            cd.provincia as domicilio_provincia,
            cd.latitud as domicilio_latitud,
            cd.longitud as domicilio_longitud,
            cd.coordenadas_validadas,
            
            -- Calcular totales resolviendo la ceguera de descuentos (Ticket #8)
            COALESCE(
                (SELECT SUM(pd.cantidad * pd.precio1)
                 FROM presupuestos_detalles pd
                 WHERE pd.id_presupuesto = p.id),
                0
            ) as subtotal_bruto,
            COALESCE(p.descuento, 0) as descuento_aplicado,
            (COALESCE(
                (SELECT SUM(pd.cantidad * pd.precio1)
                 FROM presupuestos_detalles pd
                 WHERE pd.id_presupuesto = p.id),
                0
            ) * (1 - (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN p.descuento / 100.0 ELSE COALESCE(p.descuento, 0) END))) as total,
            p.comprobante_lomasoft,
            p.id_factura_lomasoft,
            NULL as estado_tratamiento
            
        FROM presupuestos p
        
        -- JOIN con clientes: conversión explícita de tipos (cliente_id es INTEGER, id_cliente es TEXT)
        INNER JOIN clientes c ON c.cliente_id::text = ltrim(p.id_cliente, '0')
        
        -- LEFT JOIN con bunker_clientes
        LEFT JOIN bunker_clientes bc ON (
            (bc.lomas_soft_id IS NOT NULL AND ltrim(bc.lomas_soft_id, '0') = ltrim(p.id_cliente, '0'))
            OR bc.codigo_bunker_cliente = p.id_cliente
            -- Eliminado cruce por bc.id para evitar colisión entre lomas_soft_id y PK de bunker_clientes
        )
        
        -- LEFT JOIN con domicilios (puede no tener domicilio asignado)
        LEFT JOIN clientes_domicilios cd ON cd.id = p.id_domicilio_entrega
        
        -- LEFT JOIN con facturas
        LEFT JOIN factura_facturas f ON p.factura_id = f.id
        
        WHERE 
            -- Filtro 1: Secuencia exacta (valor real en BD)
            p.secuencia = 'Pedido_Listo'
            
            -- Filtro 2: Estado exacto (Whitelisting de estados válidos para reparto)
            AND p.estado IN ('Presupuesto/Orden', 'Orden de Tratamiento', 'Orden de Retiro', 'Facturado', 'Administrativa NC', 'Enviado a Facturación')
            
            -- Filtro 3: Solo activos
            AND p.activo = true
            
            -- Filtro 4: EXCLUIR mercadería que el cliente traerá directamente al mostrador o trámites administrativos (sin retiro físico)
            AND (p.estado_logistico IS NULL OR (p.estado_logistico != 'ESPERANDO_MOSTRADOR' AND p.estado_logistico != 'OMITIDO'))
            
            -- NOTA: Ignoramos id_ruta para mostrar todos (incluso los ya asignados)
            
        ORDER BY 
            CASE WHEN p.id_presupuesto_ext LIKE 'CAN-%' THEN 0 ELSE 1 END,
            p.fecha DESC,
            p.id DESC
    `;

    const result = await pool.query(query);

    // FASE 3: Anexar Retiros de Tratamiento Huérfanos
    const queryTreatments = `
        SELECT 
            'RT-' || p.id as id,
            p.id as id_presupuesto_ext,
            p.fecha_creacion as fecha,
            NULL as fecha_entrega,
            'Orden de Tratamiento' as estado,
            p.estado_logistico,
            'Pedido_Listo' as secuencia,
            p.id_domicilio_entrega,
            false as bloqueo_entrega,
            p.id_cliente,
            NULL as agente,
            'Retiro de Mantenimiento' as nota,
            p.estado_tratamiento,
            c.cliente_id,
            COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin nombre') as cliente_nombre,
            c.telefono as cliente_telefono,
            COALESCE(cd.direccion, 'Retiro Mantenimiento') as domicilio_direccion,
            COALESCE(cd.localidad, c.localidad) as domicilio_localidad,
            '' as domicilio_provincia,
            cd.latitud as domicilio_latitud,
            cd.longitud as domicilio_longitud,
            false as coordenadas_validadas,
            0 as subtotal_bruto,
            0 as descuento_aplicado,
            0 as total,
            NULL as comprobante_lomasoft,
            NULL as id_factura_lomasoft,
            p.codigo_qr_hash as hash,
            EXISTS(SELECT 1 FROM ordenes_tratamiento_detalles otd WHERE otd.id_orden_tratamiento = p.id) as tiene_checkin
        FROM ordenes_tratamiento p
        LEFT JOIN clientes c ON p.id_cliente = c.cliente_id
        LEFT JOIN clientes_domicilios cd ON cd.id = COALESCE(
            p.id_domicilio_entrega,
            (
                SELECT id 
                FROM clientes_domicilios 
                WHERE id_cliente = c.id AND activo = true
                ORDER BY es_predeterminado DESC, id ASC
                LIMIT 1
            )
        )
        WHERE p.id_ruta IS NULL 
        AND p.estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
    `;
    const treatResult = await pool.query(queryTreatments);

    // FASE 4: Anexar Sobres de Efectivo Cerrados (estado = 'PREPARADO', modalidad = 'CHOFER', sin ruta asignada)
    const querySobres = `
        SELECT 
            'SOB-' || p.id as id,
            p.codigo_sobre as id_presupuesto_ext,
            p.fecha_creacion as fecha,
            NULL as fecha_entrega,
            'Sobre de Efectivo' as estado,
            'PENDIENTE_ASIGNAR' as estado_logistico,
            'Pedido_Listo' as secuencia,
            COALESCE(p.id_domicilio_entrega, cd.id) as id_domicilio_entrega,
            false as bloqueo_entrega,
            COALESCE(c.cliente_id::text, NULLIF(LTRIM(TRIM(bc.lomas_soft_id), '0'), ''), p.cliente_id) as id_cliente,
            NULL as agente,
            COALESCE(NULLIF(TRIM(p.observaciones_cliente), ''), 'Retiro de Sobre ' || p.codigo_sobre) as nota,
            NULL as factura_id,
            NULL as motivo_no_entrega,
            NULL as factura_estado,
            NULL as estado_tratamiento,
            c.cliente_id as cliente_id,
            COALESCE(c.nombre, bc.cliente_nombre, bc.razon_social, p.cliente_id) as cliente_nombre,
            COALESCE(c.telefono, bc.whatsapp_facturas, p.colaborador_telefono) as cliente_telefono,
            COALESCE(cd.localidad, c.localidad) as cliente_localidad,
            COALESCE(bc.preferencia_facturacion, c.preferencia_facturacion, 'PREGUNTAR') as preferencia_facturacion,
            cd.direccion as domicilio_direccion,
            COALESCE(cd.localidad, c.localidad) as domicilio_localidad,
            COALESCE(cd.provincia, bc.provincia, '') as domicilio_provincia,
            cd.latitud as domicilio_latitud,
            cd.longitud as domicilio_longitud,
            COALESCE(cd.coordenadas_validadas, false) as coordenadas_validadas,
            0 as subtotal_bruto,
            0 as descuento_aplicado,
            COALESCE(p.monto_declarado, 0) as total,
            NULL as comprobante_lomasoft,
            NULL as id_factura_lomasoft,
            true as es_sobre_efectivo,
            p.id as sobre_id_numerico,
            p.codigo_sobre,
            p.cliente_id as codigo_bunker_cliente,
            COALESCE(p.monto_declarado, 0) as monto_declarado,
            p.foto_frente_url,
            p.foto_dorso_url,
            p.estado as estado_sobre
        FROM public.factura_pagos_efectivo p
        LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = p.cliente_id OR bc.lomas_soft_id = p.cliente_id
        LEFT JOIN public.clientes c ON (bc.lomas_soft_id IS NOT NULL AND c.cliente_id::text = ltrim(bc.lomas_soft_id, '0'))
                                    OR (bc.id IS NULL AND c.cliente_id::text = ltrim(p.cliente_id, '0'))
        LEFT JOIN public.clientes_domicilios cd ON cd.id = COALESCE(
            p.id_domicilio_entrega,
            (
                SELECT cd_sub.id 
                FROM public.clientes_domicilios cd_sub
                WHERE (
                    cd_sub.id_cliente = bc.id
                    OR cd_sub.id_cliente = c.id
                    OR cd_sub.id_cliente::text = bc.lomas_soft_id
                    OR cd_sub.id_cliente::text = c.cliente_id::text
                ) AND cd_sub.activo = true
                ORDER BY cd_sub.es_predeterminado DESC, cd_sub.fecha_creacion ASC, cd_sub.id ASC
                LIMIT 1
            )
        )
        WHERE p.id_ruta IS NULL
          AND p.modalidad_entrega = 'CHOFER'
          AND p.estado = 'PREPARADO'
        ORDER BY p.fecha_creacion DESC, p.id DESC
    `;
    const sobresResult = await pool.query(querySobres);

    // FASE 5: Anexar Visitas Comerciales de Preventa disponibles para sumar a ruta
    const queryProspectos = `
        SELECT 
            'PR-' || p.id as id,
            p.codigo_prospecto as id_presupuesto_ext,
            p.created_at as fecha,
            p.fecha_revisita as fecha_entrega,
            'Visita Comercial' as estado,
            'PENDIENTE_ASIGNAR' as estado_logistico,
            'Pedido_Listo' as secuencia,
            p.id as id_domicilio_entrega,
            false as bloqueo_entrega,
            p.codigo_prospecto as id_cliente,
            NULL as agente,
            COALESCE(p.notas, 'Presentación comercial (' || COALESCE(p.rubro, 'Comercio') || ')') as nota,
            NULL as factura_id,
            NULL as motivo_no_entrega,
            NULL as factura_estado,
            NULL as estado_tratamiento,
            p.codigo_prospecto as cliente_id,
            p.nombre_fantasia as cliente_nombre,
            p.telefono_whatsapp as cliente_telefono,
            COALESCE(p.zona, p.localidad, 'Gran La Plata') as cliente_localidad,
            'PREGUNTAR' as preferencia_facturacion,
            COALESCE(p.direccion, 'Sin dirección') as domicilio_direccion,
            COALESCE(p.zona, p.localidad, 'Gran La Plata') as domicilio_localidad,
            'Buenos Aires' as domicilio_provincia,
            p.latitud as domicilio_latitud,
            p.longitud as domicilio_longitud,
            (p.latitud IS NOT NULL AND p.longitud IS NOT NULL) as coordenadas_validadas,
            0 as subtotal_bruto,
            0 as descuento_aplicado,
            0 as total,
            NULL as comprobante_lomasoft,
            NULL as id_factura_lomasoft,
            true as es_visita_preventa,
            p.id as prospecto_id_numerico,
            p.codigo_prospecto,
            p.origen_contacto,
            p.cliente_activo_id,
            p.cliente_domicilio_id,
            p.rubro,
            p.contacto_nombre,
            p.contacto_rol,
            p.email,
            p.estado as estado_prospecto
        FROM public.bunker_prospectos p
        WHERE p.id_ruta IS NULL
          AND p.activo = true
          AND COALESCE(p.en_pool_logistica, false) = true
          AND p.estado NOT IN ('CONVERTIDO', 'DESCARTADO')
        ORDER BY 
            CASE 
                WHEN p.origen_contacto = 'CLIENTE_ACTIVO' THEN 1
                WHEN p.origen_contacto = 'CALLE' THEN 2 
                ELSE 3 
            END ASC,
            p.updated_at DESC
    `;
    const prospectosResult = await pool.query(queryProspectos);

    return [...result.rows, ...treatResult.rows, ...sobresResult.rows, ...prospectosResult.rows];
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
            p.comprobante_lomasoft,
            p.id_factura_lomasoft,
            p.factura_id,
            f.estado AS factura_estado,
            NULL as estado_tratamiento,
            
            -- Datos del cliente (cliente_id es el código visual, no el PK)
            c.cliente_id,
            c.nombre_completo as cliente_nombre,
            c.telefono as cliente_telefono,
            COALESCE(bc.preferencia_facturacion, c.preferencia_facturacion, 'PREGUNTAR') as preferencia_facturacion,
            
            -- Datos del domicilio
            cd.direccion as domicilio_direccion,
            cd.localidad as domicilio_localidad,
            cd.provincia as domicilio_provincia,
            cd.latitud as domicilio_latitud,
            cd.longitud as domicilio_longitud
            
        FROM presupuestos p
        
        -- JOIN con clientes: conversión explícita de tipos (cliente_id es INTEGER, id_cliente es TEXT)
        INNER JOIN clientes c ON c.cliente_id::text = ltrim(p.id_cliente, '0')
        
        -- LEFT JOIN con bunker_clientes
        LEFT JOIN bunker_clientes bc ON (
            (bc.lomas_soft_id IS NOT NULL AND ltrim(bc.lomas_soft_id, '0') = ltrim(p.id_cliente, '0'))
            OR bc.codigo_bunker_cliente = p.id_cliente
            -- Eliminado cruce por bc.id para evitar colisión entre lomas_soft_id y PK de bunker_clientes
        )
        
        LEFT JOIN clientes_domicilios cd ON p.id_domicilio_entrega = cd.id
        
        -- LEFT JOIN con facturas
        LEFT JOIN factura_facturas f ON p.factura_id = f.id
        
        WHERE p.id_ruta = $1
        
        ORDER BY 
            p.orden_entrega ASC NULLS LAST,
            p.id ASC
    `;

    const result = await pool.query(query, [rutaId]);

    // FASE 3: Anexar Retiros Asignados a la Ruta
    const queryTreatments = `
        SELECT 
            'RT-' || p.id as id,
            p.id::text as numero_presupuesto,
            p.fecha_creacion as fecha,
            0 as total,
            'Orden de Tratamiento' as estado,
            p.estado_logistico,
            p.orden_entrega,
            NULL as comprobante_lomasoft,
            NULL as id_factura_lomasoft,
            p.estado_tratamiento,
            c.cliente_id,
            COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin nombre') as cliente_nombre,
            c.telefono as cliente_telefono,
            COALESCE(cd.direccion, 'Retiro Mantenimiento') as domicilio_direccion,
            COALESCE(cd.localidad, c.localidad) as domicilio_localidad,
            '' as domicilio_provincia,
            cd.latitud as domicilio_latitud,
            cd.longitud as domicilio_longitud,
            p.id_domicilio_entrega
        FROM ordenes_tratamiento p
        LEFT JOIN clientes c ON p.id_cliente = c.cliente_id
        LEFT JOIN clientes_domicilios cd ON cd.id = COALESCE(
            p.id_domicilio_entrega,
            (
                SELECT id 
                FROM clientes_domicilios 
                WHERE id_cliente = c.id AND activo = true
                ORDER BY es_predeterminado DESC, id ASC
                LIMIT 1
            )
        )
        WHERE p.id_ruta = $1
    `;
    const treatResult = await pool.query(queryTreatments, [rutaId]);

    const querySobresRuta = `
        SELECT 
            'SOB-' || p.id as id,
            p.codigo_sobre as numero_presupuesto,
            p.fecha_creacion as fecha,
            COALESCE(p.monto_declarado, 0) as total,
            'Sobre de Efectivo' as estado,
            CASE 
                WHEN p.estado IN ('EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO') THEN 'RETIRADO'
                ELSE 'ASIGNADO'
            END as estado_logistico,
            p.orden_entrega,
            NULL as comprobante_lomasoft,
            NULL as id_factura_lomasoft,
            NULL as estado_tratamiento,
            c.cliente_id as cliente_id,
            COALESCE(c.nombre, bc.cliente_nombre, bc.razon_social, p.cliente_id) as cliente_nombre,
            COALESCE(c.telefono, bc.whatsapp_facturas, p.colaborador_telefono) as cliente_telefono,
            COALESCE(cd.direccion, bc.domicilio_fiscal, 'Retiro de Sobre') as domicilio_direccion,
            COALESCE(cd.localidad, c.localidad) as domicilio_localidad,
            COALESCE(cd.provincia, bc.provincia, '') as domicilio_provincia,
            cd.latitud as domicilio_latitud,
            cd.longitud as domicilio_longitud,
            COALESCE(p.id_domicilio_entrega, cd.id) as id_domicilio_entrega,
            true as es_sobre_efectivo,
            p.id as sobre_id_numerico,
            p.codigo_sobre,
            p.cliente_id as codigo_bunker_cliente,
            COALESCE(p.monto_declarado, 0) as monto_declarado,
            p.foto_frente_url,
            p.foto_dorso_url,
            p.estado as estado_sobre
        FROM public.factura_pagos_efectivo p
        LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = p.cliente_id OR bc.lomas_soft_id = p.cliente_id
        LEFT JOIN public.clientes c ON (bc.lomas_soft_id IS NOT NULL AND c.cliente_id::text = ltrim(bc.lomas_soft_id, '0'))
                                    OR (bc.id IS NULL AND c.cliente_id::text = ltrim(p.cliente_id, '0'))
        LEFT JOIN public.clientes_domicilios cd ON cd.id = COALESCE(
            p.id_domicilio_entrega,
            (
                SELECT cd_sub.id 
                FROM public.clientes_domicilios cd_sub
                WHERE (
                    cd_sub.id_cliente = bc.id
                    OR cd_sub.id_cliente = c.id
                    OR cd_sub.id_cliente::text = bc.lomas_soft_id
                    OR cd_sub.id_cliente::text = c.cliente_id::text
                ) AND cd_sub.activo = true
                ORDER BY cd_sub.es_predeterminado DESC, cd_sub.fecha_creacion ASC, cd_sub.id ASC
                LIMIT 1
            )
        )
        WHERE p.id_ruta = $1
    `;
    const sobresResult = await pool.query(querySobresRuta, [rutaId]);

    const queryProspectosRuta = `
        SELECT 
            'PR-' || p.id as id,
            p.codigo_prospecto as numero_presupuesto,
            p.created_at as fecha,
            0 as total,
            'Visita Comercial' as estado,
            CASE 
                WHEN p.estado_ruta = 'VISITADO' THEN 'ENTREGADO'
                WHEN p.estado_ruta IN ('NO_ENCONTRADO', 'NO_CONCRETADA') THEN 'RECHAZADO'
                ELSE 'ASIGNADO'
            END as estado_logistico,
            p.estado_ruta,
            p.orden_entrega,
            NULL as comprobante_lomasoft,
            NULL as id_factura_lomasoft,
            NULL as estado_tratamiento,
            p.codigo_prospecto as cliente_id,
            p.nombre_fantasia as cliente_nombre,
            p.telefono_whatsapp as cliente_telefono,
            COALESCE(p.direccion, 'Presentación Comercial') as domicilio_direccion,
            COALESCE(p.zona, p.localidad, 'Gran La Plata') as domicilio_localidad,
            'Buenos Aires' as domicilio_provincia,
            p.latitud as domicilio_latitud,
            p.longitud as domicilio_longitud,
            p.id as id_domicilio_entrega,
            true as es_visita_preventa,
            p.id as prospecto_id_numerico,
            p.codigo_prospecto,
            p.rubro,
            p.contacto_nombre,
            p.contacto_rol,
            p.email,
            p.notas,
            p.estado as estado_prospecto
        FROM public.bunker_prospectos p
        WHERE p.id_ruta = $1 AND p.activo = true
    `;
    const prospectosRutaResult = await pool.query(queryProspectosRuta, [rutaId]);

    const presupuestosHibridos = [...result.rows, ...treatResult.rows, ...sobresResult.rows, ...prospectosRutaResult.rows];
    presupuestosHibridos.sort((a, b) => {
        const ordenA = a.orden_entrega ?? 999;
        const ordenB = b.orden_entrega ?? 999;
        if (ordenA === ordenB) return a.id < b.id ? -1 : 1;
        return ordenA - ordenB;
    });

    return presupuestosHibridos;
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
