const { pool } = require('../config/database');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

/**
 * Helper para validar el cliente y resolver su usuario_id interno de colaborador
 */
async function resolverColaborador(req) {
    let targetClienteId = req.query.clienteId || req.body?.clienteId;

    // Si viene Bearer token de Supabase
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const { data: { user }, error: tokenErr } = await supabaseAdmin.auth.getUser(token);
            if (!tokenErr && user) {
                targetClienteId = user.app_metadata?.cliente_id || user.user_metadata?.cliente_id || targetClienteId;
            }
        } catch (e) {
            console.warn('⚠️ [COLABORADOR] No se pudo verificar JWT Bearer:', e.message);
        }
    }

    if (!targetClienteId) {
        return null;
    }

    // Buscar el usuario_id correspondiente en bunker_clientes
    const { rows: clientes } = await pool.query(
        `SELECT id, codigo_bunker_cliente, razon_social, usuario_id 
         FROM public.bunker_clientes 
         WHERE codigo_bunker_cliente = $1 
         LIMIT 1`,
        [targetClienteId]
    );

    if (clientes.length === 0 || !clientes[0].usuario_id) {
        // Fallback especial para Matías si no estuviera linkeado
        if (targetClienteId === 'CB-0006') {
            return {
                cliente_id: 'CB-0006',
                razon_social: 'FERRONATO, JOSE MATIAS',
                usuario_id: 5
            };
        }
        return null;
    }

    return {
        cliente_id: clientes[0].codigo_bunker_cliente,
        razon_social: clientes[0].razon_social,
        usuario_id: clientes[0].usuario_id
    };
}

/**
 * GET /api/b2b/colaborador/dashboard
 * Retorna todo el tablero de control exclusivo para el colaborador
 */
exports.obtenerDashboardColaborador = async (req, res) => {
    try {
        const colab = await resolverColaborador(req);
        if (!colab) {
            return res.status(403).json({
                success: false,
                error: 'Acceso no autorizado',
                message: 'Su cuenta no posee permisos de colaborador o prestador de servicios.'
            });
        }

        const usuarioId = colab.usuario_id;

        // 1. Tarifa horaria activa e histórica
        const qTarifasHora = await pool.query(`
            SELECT id, valor_hora, fecha_desde, fecha_hasta, activo, creado_en
            FROM public.colaboradores_tarifas
            WHERE usuario_id = $1
            ORDER BY activo DESC, id DESC
        `, [usuarioId]);

        const tarifaHoraActiva = qTarifasHora.rows.find(t => t.activo) || null;

        // 2. Tarifas por rendimiento de elaboración
        const qTarifasRend = await pool.query(`
            SELECT 
                ctr.id,
                ctr.articulo_numero,
                COALESCE(ba.descripcion, ctr.articulo_numero) as articulo_descripcion,
                ctr.valor_por_unidad,
                ctr.unidad_medida,
                ctr.fecha_desde,
                ctr.fecha_hasta,
                ctr.activo,
                ctr.creado_en
            FROM public.colaboradores_tarifas_rendimiento ctr
            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ctr.articulo_numero
            WHERE ctr.usuario_id = $1
            ORDER BY ctr.activo DESC, ba.descripcion ASC
        `, [usuarioId]);

        // 3. Jornadas de Depósito / Taller
        const qJornadas = await pool.query(`
            SELECT 
                id,
                fecha_ingreso,
                fecha_egreso,
                horas_totales,
                minutos_totales,
                valor_hora_aplicado,
                monto_total,
                estado,
                liquidada_en,
                cuenta_corriente_movimiento_id,
                observacion_ingreso,
                observacion_egreso
            FROM public.colaboradores_jornadas
            WHERE usuario_id = $1
            ORDER BY fecha_ingreso DESC
        `, [usuarioId]);

        const jornadas = qJornadas.rows;
        const enCurso = jornadas.find(j => j.estado === 'EN_CURSO') || null;
        const pendientes = jornadas.filter(j => j.estado === 'FINALIZADA');
        const liquidadas = jornadas.filter(j => j.estado === 'LIQUIDADA');

        const totalHorasPendientes = pendientes.reduce((acc, j) => acc + (parseFloat(j.horas_totales) || 0), 0);
        const totalMontoPendiente = pendientes.reduce((acc, j) => acc + (parseFloat(j.monto_total) || 0), 0);

        // Calcular totales del mes actual
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const liquidadasMes = liquidadas.filter(j => new Date(j.liquidada_en || j.fecha_egreso) >= startOfMonth);
        const totalHorasMes = liquidadasMes.reduce((acc, j) => acc + (parseFloat(j.horas_totales) || 0), 0);
        const totalMontoMes = liquidadasMes.reduce((acc, j) => acc + (parseFloat(j.monto_total) || 0), 0);

        // 4. Producciones externas / Carros
        const qProd = await pool.query(`
            SELECT 
                peh.id,
                peh.carro_id,
                peh.articulo_padre_id,
                COALESCE(bap.descripcion, peh.articulo_padre_id) as articulo_padre_descripcion,
                peh.articulo_fraccionado_id,
                COALESCE(baf.descripcion, peh.articulo_fraccionado_id) as articulo_fraccionado_descripcion,
                peh.kilos_entrada,
                peh.kilos_salida,
                peh.kilos_producidos,
                peh.porcentaje_merma,
                peh.fecha_registro
            FROM public.produccion_externa_historial peh
            LEFT JOIN public.bunker_articulos bap ON bap.articulo_id = peh.articulo_padre_id
            LEFT JOIN public.bunker_articulos baf ON baf.articulo_id = peh.articulo_fraccionado_id
            WHERE peh.usuario_id = $1
            ORDER BY peh.fecha_registro DESC
            LIMIT 25
        `, [usuarioId]);

        res.json({
            success: true,
            data: {
                colaborador: {
                    cliente_id: colab.cliente_id,
                    razon_social: colab.razon_social,
                    usuario_id: colab.usuario_id
                },
                tarifas: {
                    hora_activa: tarifaHoraActiva,
                    historico_horas: qTarifasHora.rows,
                    rendimiento: qTarifasRend.rows
                },
                jornadas: {
                    en_curso: enCurso,
                    pendientes: pendientes,
                    liquidadas: liquidadas,
                    resumen: {
                        total_horas_pendientes: Number(totalHorasPendientes.toFixed(2)),
                        total_monto_pendiente: Number(totalMontoPendiente.toFixed(2)),
                        total_horas_mes: Number(totalHorasMes.toFixed(2)),
                        total_monto_mes: Number(totalMontoMes.toFixed(2)),
                        cantidad_pendientes: pendientes.length,
                        cantidad_liquidadas: liquidadas.length
                    }
                },
                producciones_externas: qProd.rows
            }
        });

    } catch (error) {
        console.error('❌ [B2B-COLABORADOR] Error al obtener dashboard:', error);
        res.status(500).json({ success: false, error: 'Error interno', message: error.message });
    }
};

/**
 * POST /api/b2b/colaborador/actualizar-tarifa-hora
 * Actualiza la tarifa por hora de forma inmediata
 */
exports.actualizarTarifaHora = async (req, res) => {
    const client = await pool.connect();
    try {
        const colab = await resolverColaborador(req);
        if (!colab) {
            return res.status(403).json({ success: false, error: 'No autorizado' });
        }

        const { nuevo_valor } = req.body;
        const valorNumerico = parseFloat(nuevo_valor);
        if (isNaN(valorNumerico) || valorNumerico <= 0) {
            return res.status(400).json({ success: false, error: 'El valor de la tarifa debe ser un importe numérico mayor a 0.' });
        }

        await client.query('BEGIN');

        // 1. Desactivar tarifa anterior
        await client.query(`
            UPDATE public.colaboradores_tarifas 
            SET activo = false, fecha_hasta = NOW() 
            WHERE usuario_id = $1 AND activo = true
        `, [colab.usuario_id]);

        // 2. Insertar nueva tarifa activa
        const { rows } = await client.query(`
            INSERT INTO public.colaboradores_tarifas 
                (usuario_id, valor_hora, fecha_desde, fecha_hasta, activo, creado_en)
            VALUES 
                ($1, $2, NOW(), NULL, true, NOW())
            RETURNING id, valor_hora, fecha_desde, activo
        `, [colab.usuario_id, valorNumerico]);

        await client.query('COMMIT');

        console.log(`✅ [B2B-COLABORADOR] Tarifa horaria actualizada para ${colab.razon_social}: $${valorNumerico}`);

        res.json({
            success: true,
            message: 'Tarifa horaria actualizada con éxito.',
            tarifa: rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [B2B-COLABORADOR] Error al actualizar tarifa hora:', error);
        res.status(500).json({ success: false, error: 'Error interno', message: error.message });
    } finally {
        client.release();
    }
};

/**
 * POST /api/b2b/colaborador/actualizar-tarifa-rendimiento
 * Actualiza la tarifa por rendimiento de un artículo
 */
exports.actualizarTarifaRendimiento = async (req, res) => {
    const client = await pool.connect();
    try {
        const colab = await resolverColaborador(req);
        if (!colab) {
            return res.status(403).json({ success: false, error: 'No autorizado' });
        }

        const { articulo_numero, nuevo_valor, unidad_medida } = req.body;
        const valorNumerico = parseFloat(nuevo_valor);
        if (!articulo_numero || isNaN(valorNumerico) || valorNumerico <= 0) {
            return res.status(400).json({ success: false, error: 'Artículo y valor válido requeridos.' });
        }

        await client.query('BEGIN');

        // 1. Desactivar tarifa previa del artículo
        await client.query(`
            UPDATE public.colaboradores_tarifas_rendimiento 
            SET activo = false, fecha_hasta = NOW() 
            WHERE usuario_id = $1 AND articulo_numero = $2 AND activo = true
        `, [colab.usuario_id, articulo_numero]);

        // 2. Insertar nueva tarifa
        const { rows } = await client.query(`
            INSERT INTO public.colaboradores_tarifas_rendimiento 
                (usuario_id, articulo_numero, valor_por_unidad, unidad_medida, fecha_desde, fecha_hasta, activo, creado_en)
            VALUES 
                ($1, $2, $3, COALESCE($4, 'kg'), NOW(), NULL, true, NOW())
            RETURNING id, articulo_numero, valor_por_unidad, unidad_medida, fecha_desde, activo
        `, [colab.usuario_id, articulo_numero, valorNumerico, unidad_medida]);

        await client.query('COMMIT');

        console.log(`✅ [B2B-COLABORADOR] Tarifa de rendimiento para ${articulo_numero} actualizada a $${valorNumerico}`);

        res.json({
            success: true,
            message: 'Tarifa de rendimiento actualizada con éxito.',
            tarifa: rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [B2B-COLABORADOR] Error al actualizar tarifa rendimiento:', error);
        res.status(500).json({ success: false, error: 'Error interno', message: error.message });
    } finally {
        client.release();
    }
};

/**
 * 🔄 Bucle automático para responder solicitudes de Colaborador vía Cloud Dispatcher
 */
exports.procesarSolicitudesColaboradorCloud = async () => {
    try {
        const { data: pendingReqs } = await supabaseAdmin
            .from('telemetria_accesos')
            .select('*')
            .like('tipo_acceso', 'COLAB-REQ-%')
            .not('tipo_acceso', 'like', '%-DONE')
            .not('tipo_acceso', 'like', '%-ERROR')
            .order('created_at', { ascending: false })
            .limit(5);

        if (pendingReqs && pendingReqs.length > 0) {
            for (const item of pendingReqs) {
                // Formato: COLAB-REQ-<reqId>-<clienteId>
                const parts = item.tipo_acceso.split('-');
                if (parts.length >= 4) {
                    const reqId = parts[2];
                    const clienteId = parts.slice(3).join('-');

                    console.log(`🛠️ [B2B-COLAB-DISPATCHER] Despachando dashboard para ${clienteId} (Req: ${reqId})...`);

                    const dummyReq = {
                        query: { clienteId },
                        body: {},
                        headers: {}
                    };

                    const colab = await resolverColaborador(dummyReq);
                    if (!colab) {
                        await supabaseAdmin.from('telemetria_accesos').update({
                            tipo_acceso: `COLAB-RES-${reqId}-ERROR`,
                            dispositivo: 'Colaborador no encontrado o sin permisos'
                        }).eq('id', item.id);
                        continue;
                    }

                    const usuarioId = colab.usuario_id;

                    // Consultas
                    const [qHora, qRend, qJorn, qProd] = await Promise.all([
                        pool.query(`SELECT id, valor_hora, fecha_desde, fecha_hasta, activo, creado_en FROM public.colaboradores_tarifas WHERE usuario_id = $1 ORDER BY activo DESC, id DESC`, [usuarioId]),
                        pool.query(`SELECT ctr.id, ctr.articulo_numero, COALESCE(ba.descripcion, ctr.articulo_numero) as articulo_descripcion, ctr.valor_por_unidad, ctr.unidad_medida, ctr.fecha_desde, ctr.fecha_hasta, ctr.activo, ctr.creado_en FROM public.colaboradores_tarifas_rendimiento ctr LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ctr.articulo_numero WHERE ctr.usuario_id = $1 ORDER BY ctr.activo DESC, ba.descripcion ASC`, [usuarioId]),
                        pool.query(`SELECT id, fecha_ingreso, fecha_egreso, horas_totales, minutos_totales, valor_hora_aplicado, monto_total, estado, liquidada_en, cuenta_corriente_movimiento_id, observacion_ingreso, observacion_egreso FROM public.colaboradores_jornadas WHERE usuario_id = $1 ORDER BY fecha_ingreso DESC`, [usuarioId]),
                        pool.query(`SELECT peh.id, peh.carro_id, peh.articulo_padre_id, COALESCE(bap.descripcion, peh.articulo_padre_id) as articulo_padre_descripcion, peh.articulo_fraccionado_id, COALESCE(baf.descripcion, peh.articulo_fraccionado_id) as articulo_fraccionado_descripcion, peh.kilos_entrada, peh.kilos_salida, peh.kilos_producidos, peh.porcentaje_merma, peh.fecha_registro FROM public.produccion_externa_historial peh LEFT JOIN public.bunker_articulos bap ON bap.articulo_id = peh.articulo_padre_id LEFT JOIN public.bunker_articulos baf ON baf.articulo_id = peh.articulo_fraccionado_id WHERE peh.usuario_id = $1 ORDER BY peh.fecha_registro DESC LIMIT 25`, [usuarioId])
                    ]);

                    const jornadas = qJorn.rows;
                    const enCurso = jornadas.find(j => j.estado === 'EN_CURSO') || null;
                    const pendientes = jornadas.filter(j => j.estado === 'FINALIZADA');
                    const liquidadas = jornadas.filter(j => j.estado === 'LIQUIDADA');

                    const totalHorasPendientes = pendientes.reduce((acc, j) => acc + (parseFloat(j.horas_totales) || 0), 0);
                    const totalMontoPendiente = pendientes.reduce((acc, j) => acc + (parseFloat(j.monto_total) || 0), 0);

                    const now = new Date();
                    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                    const liquidadasMes = liquidadas.filter(j => new Date(j.liquidada_en || j.fecha_egreso) >= startOfMonth);
                    const totalHorasMes = liquidadasMes.reduce((acc, j) => acc + (parseFloat(j.horas_totales) || 0), 0);
                    const totalMontoMes = liquidadasMes.reduce((acc, j) => acc + (parseFloat(j.monto_total) || 0), 0);

                    const payloadData = {
                        colaborador: {
                            cliente_id: colab.cliente_id,
                            razon_social: colab.razon_social,
                            usuario_id: colab.usuario_id
                        },
                        tarifas: {
                            hora_activa: qHora.rows.find(t => t.activo) || null,
                            historico_horas: qHora.rows,
                            rendimiento: qRend.rows
                        },
                        jornadas: {
                            en_curso: enCurso,
                            pendientes: pendientes,
                            liquidadas: liquidadas,
                            resumen: {
                                total_horas_pendientes: Number(totalHorasPendientes.toFixed(2)),
                                total_monto_pendiente: Number(totalMontoPendiente.toFixed(2)),
                                total_horas_mes: Number(totalHorasMes.toFixed(2)),
                                total_monto_mes: Number(totalMontoMes.toFixed(2)),
                                cantidad_pendientes: pendientes.length,
                                cantidad_liquidadas: liquidadas.length
                            }
                        },
                        producciones_externas: qProd.rows
                    };

                    await supabaseAdmin.from('telemetria_accesos').update({
                        tipo_acceso: `COLAB-RES-${reqId}-DONE`,
                        dispositivo: JSON.stringify(payloadData)
                    }).eq('id', item.id);

                    console.log(`✅ [B2B-COLAB-DISPATCHER] Dashboard enviado a Cloud para ${clienteId} (${reqId})!`);
                }
            }
        }

        // 2. Procesar solicitudes de actualización de tarifa enviadas desde Cloud
        const { data: pendingUpdates } = await supabaseAdmin
            .from('telemetria_accesos')
            .select('*')
            .like('tipo_acceso', 'COLAB-UPDATE-%')
            .not('tipo_acceso', 'like', '%-DONE')
            .not('tipo_acceso', 'like', '%-ERROR')
            .order('created_at', { ascending: false })
            .limit(5);

        if (pendingUpdates && pendingUpdates.length > 0) {
            for (const item of pendingUpdates) {
                // Formato: COLAB-UPDATE-<reqId>-<clienteId>
                const parts = item.tipo_acceso.split('-');
                if (parts.length >= 4) {
                    const reqId = parts[2];
                    const clienteId = parts.slice(3).join('-');

                    try {
                        const bodyData = JSON.parse(item.dispositivo || '{}');
                        const colab = await resolverColaborador({ query: { clienteId } });
                        if (!colab) throw new Error('Colaborador no encontrado');

                        if (bodyData.tipo === 'HORA') {
                            const nuevoValor = parseFloat(bodyData.valor);
                            await pool.query('UPDATE public.colaboradores_tarifas SET activo = false, fecha_hasta = NOW() WHERE usuario_id = $1 AND activo = true', [colab.usuario_id]);
                            await pool.query('INSERT INTO public.colaboradores_tarifas (usuario_id, valor_hora, fecha_desde, activo, creado_en) VALUES ($1, $2, NOW(), true, NOW())', [colab.usuario_id, nuevoValor]);
                        } else if (bodyData.tipo === 'RENDIMIENTO') {
                            const nuevoValor = parseFloat(bodyData.valor);
                            await pool.query('UPDATE public.colaboradores_tarifas_rendimiento SET activo = false, fecha_hasta = NOW() WHERE usuario_id = $1 AND articulo_numero = $2 AND activo = true', [colab.usuario_id, bodyData.articulo_numero]);
                            await pool.query('INSERT INTO public.colaboradores_tarifas_rendimiento (usuario_id, articulo_numero, valor_por_unidad, unidad_medida, fecha_desde, activo, creado_en) VALUES ($1, $2, $3, $4, NOW(), true, NOW())', [colab.usuario_id, bodyData.articulo_numero, nuevoValor, bodyData.unidad_medida || 'kg']);
                        }

                        await supabaseAdmin.from('telemetria_accesos').update({
                            tipo_acceso: `COLAB-UPDATE-${reqId}-DONE`,
                            dispositivo: 'Tarifa actualizada con éxito'
                        }).eq('id', item.id);
                        console.log(`✅ [B2B-COLAB-DISPATCHER] Actualización de tarifa procesada para ${clienteId} (${reqId})`);
                    } catch (updErr) {
                        await supabaseAdmin.from('telemetria_accesos').update({
                            tipo_acceso: `COLAB-UPDATE-${reqId}-ERROR`,
                            dispositivo: updErr.message
                        }).eq('id', item.id);
                    }
                }
            }
        }

    } catch (err) {
        console.warn('⚠️ [B2B-COLAB-DISPATCHER] Warning:', err.message);
    }
};

// Iniciar bucle de despacho en background cada 3.5 segundos
setInterval(exports.procesarSolicitudesColaboradorCloud, 3500);
