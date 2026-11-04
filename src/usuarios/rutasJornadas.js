const express = require('express');
const router = express.Router();
const pool = require('./pool');
const CuentaCorrienteService = require('../logistica/services/cuentaCorrienteService');

/**
 * GET /api/colaboradores/jornadas/elegibles
 * Obtiene la lista de usuarios activos que califican como colaboradores
 * (Rol Proveedor de servicios, Colaborador o que posean tarifa activa declarada).
 */
router.get('/colaboradores/jornadas/elegibles', async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id as usuario_id,
        u.nombre_completo,
        u.usuario,
        r.id as rol_id,
        r.nombre as rol_nombre,
        t.valor_hora,
        t.id as tarifa_id,
        bc.codigo_bunker_cliente,
        bc.razon_social as cliente_razon_social,
        cc.id as cuenta_corriente_id,
        cc.saldo as cuenta_corriente_saldo
      FROM public.usuarios u
      LEFT JOIN public.roles r ON u.rol_id = r.id
      LEFT JOIN public.colaboradores_tarifas t ON u.id = t.usuario_id AND t.activo = true
      LEFT JOIN public.bunker_clientes bc ON u.id = bc.usuario_id
      LEFT JOIN public.factura_cuentas_corrientes cc ON bc.codigo_bunker_cliente = cc.codigo_bunker_cliente AND cc.estado = 'ACTIVA'
      WHERE u.activo = true 
        AND (
          r.nombre ILIKE '%Proveedor%' 
          OR r.nombre ILIKE '%Colaborador%' 
          OR t.valor_hora IS NOT NULL
        )
      ORDER BY u.nombre_completo ASC;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error('❌ Error al obtener colaboradores elegibles:', error);
    res.status(500).json({ error: 'Error interno al consultar colaboradores elegibles' });
  }
});

/**
 * GET /api/colaboradores/jornadas/activas
 * Obtiene las jornadas actualmente en curso (estado = 'EN_CURSO')
 * Calcula en tiempo real los segundos y horas transcurridas.
 */
router.get('/colaboradores/jornadas/activas', async (req, res) => {
  try {
    const queryActivas = `
      SELECT 
        j.id,
        j.usuario_id,
        j.fecha_ingreso,
        j.estado,
        j.observacion_ingreso,
        u.nombre_completo,
        u.usuario,
        r.nombre as rol_nombre,
        COALESCE(j.valor_hora_aplicado, t.valor_hora, 0.00) as tarifa_hora_actual,
        ROUND(EXTRACT(EPOCH FROM (NOW() - j.fecha_ingreso))::numeric, 0) as segundos_transcurridos,
        ROUND((EXTRACT(EPOCH FROM (NOW() - j.fecha_ingreso)) / 3600.0)::numeric, 2) as horas_transcurridas_actuales,
        bc.codigo_bunker_cliente,
        cc.id as cuenta_corriente_id
      FROM public.colaboradores_jornadas j
      JOIN public.usuarios u ON j.usuario_id = u.id
      LEFT JOIN public.roles r ON u.rol_id = r.id
      LEFT JOIN public.colaboradores_tarifas t ON u.id = t.usuario_id AND t.activo = true
      LEFT JOIN public.bunker_clientes bc ON u.id = bc.usuario_id
      LEFT JOIN public.factura_cuentas_corrientes cc ON bc.codigo_bunker_cliente = cc.codigo_bunker_cliente AND cc.estado = 'ACTIVA'
      WHERE j.estado = 'EN_CURSO'
      ORDER BY j.fecha_ingreso ASC;
    `;

    const queryCompletadas = `
      SELECT 
        j.id,
        j.usuario_id,
        j.fecha_ingreso,
        j.fecha_egreso,
        j.minutos_totales,
        j.horas_totales,
        j.estado,
        j.observacion_ingreso,
        j.observacion_egreso,
        u.nombre_completo,
        u.usuario
      FROM public.colaboradores_jornadas j
      JOIN public.usuarios u ON j.usuario_id = u.id
      WHERE j.estado IN ('FINALIZADA', 'LIQUIDADA')
        AND j.fecha_egreso >= NOW() - INTERVAL '12 hours'
      ORDER BY j.fecha_egreso DESC;
    `;

    const [activasRes, completadasRes] = await Promise.all([
      pool.query(queryActivas),
      pool.query(queryCompletadas)
    ]);

    res.json({
      activas: activasRes.rows,
      completadas_recientes: completadasRes.rows
    });
  } catch (error) {
    console.error('❌ Error al obtener jornadas activas y completadas:', error);
    res.status(500).json({ error: 'Error interno al consultar jornadas activas' });
  }
});

/**
 * POST /api/colaboradores/jornadas/iniciar
 * Inicia una nueva jornada para el colaborador en depósito
 */
router.post('/colaboradores/jornadas/iniciar', async (req, res) => {
  const { usuario_id, observacion_ingreso } = req.body;

  if (!usuario_id) {
    return res.status(400).json({ error: 'Debe especificar el usuario_id del colaborador' });
  }

  try {
    // 1. Verificar si el usuario ya tiene una jornada activa
    const { rows: activas } = await pool.query(
      `SELECT id, fecha_ingreso FROM public.colaboradores_jornadas WHERE usuario_id = $1 AND estado = 'EN_CURSO'`,
      [usuario_id]
    );

    if (activas.length > 0) {
      const hora = new Date(activas[0].fecha_ingreso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      return res.status(400).json({ 
        error: `El colaborador ya tiene una jornada en curso iniciada a las ${hora}. Debe cerrarla antes de iniciar una nueva.` 
      });
    }

    // 2. Obtener tarifa activa vigente si existe
    const { rows: tarifas } = await pool.query(
      `SELECT valor_hora FROM public.colaboradores_tarifas WHERE usuario_id = $1 AND activo = true LIMIT 1`,
      [usuario_id]
    );
    const tarifaAplicada = tarifas.length > 0 ? tarifas[0].valor_hora : 0.00;

    // 3. Crear jornada
    const insertQuery = `
      INSERT INTO public.colaboradores_jornadas 
        (usuario_id, fecha_ingreso, valor_hora_aplicado, estado, observacion_ingreso)
      VALUES ($1, NOW(), $2, 'EN_CURSO', $3)
      RETURNING *;
    `;
    const { rows: nuevaJornada } = await pool.query(insertQuery, [
      usuario_id,
      tarifaAplicada,
      observacion_ingreso || null
    ]);

    res.json({
      success: true,
      message: 'Jornada iniciada correctamente',
      jornada: nuevaJornada[0]
    });
  } catch (error) {
    console.error('❌ Error al iniciar jornada:', error);
    res.status(500).json({ error: 'Error interno al iniciar jornada' });
  }
});

/**
 * POST /api/colaboradores/jornadas/:id/cerrar
 * Cierra una jornada activa, calculando horas, minutos y monto total acumulado.
 */
router.post('/colaboradores/jornadas/:id/cerrar', async (req, res) => {
  const jornadaId = req.params.id;
  const { observacion_egreso, fecha_egreso } = req.body;

  try {
    // 1. Buscar la jornada activa
    const { rows: jornadas } = await pool.query(
      `SELECT * FROM public.colaboradores_jornadas WHERE id = $1`,
      [jornadaId]
    );

    if (jornadas.length === 0) {
      return res.status(404).json({ error: 'Jornada no encontrada' });
    }

    const jornada = jornadas[0];
    if (jornada.estado !== 'EN_CURSO') {
      return res.status(400).json({ error: 'Esta jornada ya se encuentra cerrada o liquidada' });
    }

    // 2. Determinar fecha de egreso
    const egresoTimestamp = fecha_egreso ? new Date(fecha_egreso) : new Date();
    const ingresoTimestamp = new Date(jornada.fecha_ingreso);

    if (egresoTimestamp <= ingresoTimestamp) {
      return res.status(400).json({ error: 'La fecha/hora de egreso debe ser posterior al ingreso' });
    }

    // 3. Calcular tiempo exacto
    const diferenciaMs = egresoTimestamp.getTime() - ingresoTimestamp.getTime();
    const minutosTotales = Math.round(diferenciaMs / 60000);
    const horasTotales = Number((diferenciaMs / 3600000).toFixed(2));

    // 4. Tarifa a aplicar (si no la tenía fijada, buscar la actual activa)
    let valorHora = parseFloat(jornada.valor_hora_aplicado);
    if (isNaN(valorHora) || valorHora <= 0) {
      const { rows: tarifas } = await pool.query(
        `SELECT valor_hora FROM public.colaboradores_tarifas WHERE usuario_id = $1 AND activo = true LIMIT 1`,
        [jornada.usuario_id]
      );
      valorHora = tarifas.length > 0 ? parseFloat(tarifas[0].valor_hora) : 0.00;
    }

    const montoTotal = Number((horasTotales * valorHora).toFixed(2));

    // 5. Actualizar la jornada a FINALIZADA
    const updateQuery = `
      UPDATE public.colaboradores_jornadas
      SET 
        fecha_egreso = $1,
        minutos_totales = $2,
        horas_totales = $3,
        valor_hora_aplicado = $4,
        monto_total = $5,
        estado = 'FINALIZADA',
        observacion_egreso = COALESCE($6, observacion_egreso),
        actualizado_en = NOW()
      WHERE id = $7
      RETURNING *;
    `;
    const { rows: jornadaActualizada } = await pool.query(updateQuery, [
      egresoTimestamp,
      minutosTotales,
      horasTotales,
      valorHora,
      montoTotal,
      observacion_egreso || null,
      jornadaId
    ]);

    res.json({
      success: true,
      message: 'Jornada cerrada correctamente',
      jornada: jornadaActualizada[0]
    });
  } catch (error) {
    console.error('❌ Error al cerrar jornada:', error);
    res.status(500).json({ error: 'Error interno al cerrar jornada' });
  }
});

/**
 * GET /api/colaboradores/jornadas
 * Consulta el listado histórico de jornadas con filtros de usuario, estado y rango de fechas.
 */
router.get('/colaboradores/jornadas', async (req, res) => {
  const { usuario_id, estado, fecha_desde, fecha_hasta } = req.query;

  try {
    let whereClauses = [];
    let params = [];
    let paramIndex = 1;

    if (usuario_id) {
      whereClauses.push(`j.usuario_id = $${paramIndex++}`);
      params.push(usuario_id);
    }

    if (estado) {
      if (estado.includes(',')) {
        const estados = estado.split(',').map(e => e.trim());
        whereClauses.push(`j.estado = ANY($${paramIndex++})`);
        params.push(estados);
      } else {
        whereClauses.push(`j.estado = $${paramIndex++}`);
        params.push(estado);
      }
    }

    if (fecha_desde) {
      whereClauses.push(`j.fecha_ingreso >= $${paramIndex++}`);
      params.push(fecha_desde);
    }

    if (fecha_hasta) {
      whereClauses.push(`j.fecha_ingreso <= $${paramIndex++}`);
      params.push(fecha_hasta);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const query = `
      SELECT 
        j.*,
        u.nombre_completo,
        u.usuario,
        r.nombre as rol_nombre,
        bc.codigo_bunker_cliente,
        bc.razon_social as cliente_razon_social,
        cc.id as cuenta_corriente_id,
        cc.saldo as cuenta_corriente_saldo,
        m.id as movimiento_id,
        m.monto as movimiento_monto,
        m.descripcion as movimiento_descripcion
      FROM public.colaboradores_jornadas j
      JOIN public.usuarios u ON j.usuario_id = u.id
      LEFT JOIN public.roles r ON u.rol_id = r.id
      LEFT JOIN public.bunker_clientes bc ON u.id = bc.usuario_id
      LEFT JOIN public.factura_cuentas_corrientes cc ON bc.codigo_bunker_cliente = cc.codigo_bunker_cliente AND cc.estado = 'ACTIVA'
      LEFT JOIN public.factura_cuenta_corriente_movimientos m ON j.cuenta_corriente_movimiento_id = m.id
      ${whereSql}
      ORDER BY j.fecha_ingreso DESC, j.id DESC;
    `;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('❌ Error al consultar listado de jornadas:', error);
    res.status(500).json({ error: 'Error interno al consultar jornadas' });
  }
});

/**
 * POST /api/colaboradores/jornadas/manual
 * Carga manual de una jornada pasada (para registrar olvidos)
 */
router.post('/colaboradores/jornadas/manual', async (req, res) => {
  const { usuario_id, fecha_ingreso, fecha_egreso, observacion_ingreso, observacion_egreso, valor_hora } = req.body;

  if (!usuario_id || !fecha_ingreso || !fecha_egreso) {
    return res.status(400).json({ error: 'usuario_id, fecha_ingreso y fecha_egreso son obligatorios' });
  }

  const ingresoTimestamp = new Date(fecha_ingreso);
  const egresoTimestamp = new Date(fecha_egreso);

  if (isNaN(ingresoTimestamp.getTime()) || isNaN(egresoTimestamp.getTime())) {
    return res.status(400).json({ error: 'Fechas u horas inválidas' });
  }

  if (egresoTimestamp <= ingresoTimestamp) {
    return res.status(400).json({ error: 'La hora de egreso debe ser posterior a la de ingreso' });
  }

  try {
    const diferenciaMs = egresoTimestamp.getTime() - ingresoTimestamp.getTime();
    const minutosTotales = Math.round(diferenciaMs / 60000);
    const horasTotales = Number((diferenciaMs / 3600000).toFixed(2));

    let valorHoraAplicado = parseFloat(valor_hora);
    if (isNaN(valorHoraAplicado) || valorHoraAplicado < 0) {
      const { rows: tarifas } = await pool.query(
        `SELECT valor_hora FROM public.colaboradores_tarifas WHERE usuario_id = $1 AND activo = true LIMIT 1`,
        [usuario_id]
      );
      valorHoraAplicado = tarifas.length > 0 ? parseFloat(tarifas[0].valor_hora) : 0.00;
    }

    const montoTotal = Number((horasTotales * valorHoraAplicado).toFixed(2));

    const insertQuery = `
      INSERT INTO public.colaboradores_jornadas 
        (usuario_id, fecha_ingreso, fecha_egreso, minutos_totales, horas_totales, 
         valor_hora_aplicado, monto_total, estado, observacion_ingreso, observacion_egreso)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'FINALIZADA', $8, $9)
      RETURNING *;
    `;
    const { rows } = await pool.query(insertQuery, [
      usuario_id,
      ingresoTimestamp,
      egresoTimestamp,
      minutosTotales,
      horasTotales,
      valorHoraAplicado,
      montoTotal,
      observacion_ingreso || 'Carga manual administrativa',
      observacion_egreso || null
    ]);

    res.json({
      success: true,
      message: 'Jornada cargada manualmente con éxito',
      jornada: rows[0]
    });
  } catch (error) {
    console.error('❌ Error al cargar jornada manual:', error);
    res.status(500).json({ error: 'Error interno al registrar jornada manual' });
  }
});

/**
 * PUT /api/colaboradores/jornadas/:id
 * Edición o corrección administrativa de una jornada existente
 */
router.put('/colaboradores/jornadas/:id', async (req, res) => {
  const jornadaId = req.params.id;
  const { fecha_ingreso, fecha_egreso, observacion_ingreso, observacion_egreso, valor_hora_aplicado } = req.body;

  try {
    const { rows: existentes } = await pool.query(
      `SELECT * FROM public.colaboradores_jornadas WHERE id = $1`,
      [jornadaId]
    );

    if (existentes.length === 0) {
      return res.status(404).json({ error: 'Jornada no encontrada' });
    }

    const jornada = existentes[0];
    if (jornada.estado === 'LIQUIDADA') {
      return res.status(400).json({ error: 'No se puede modificar una jornada que ya fue liquidada a Cuenta Corriente.' });
    }

    const nuevoIngreso = fecha_ingreso ? new Date(fecha_ingreso) : new Date(jornada.fecha_ingreso);
    let nuevoEgreso = null;
    let minutosTotales = jornada.minutos_totales;
    let horasTotales = jornada.horas_totales;
    let montoTotal = jornada.monto_total;
    let nuevoValorHora = valor_hora_aplicado !== undefined ? parseFloat(valor_hora_aplicado) : parseFloat(jornada.valor_hora_aplicado);

    if (jornada.fecha_egreso || fecha_egreso) {
      nuevoEgreso = fecha_egreso ? new Date(fecha_egreso) : new Date(jornada.fecha_egreso);
      if (nuevoEgreso <= nuevoIngreso) {
        return res.status(400).json({ error: 'La hora de egreso debe ser posterior a la de ingreso' });
      }
      const diferenciaMs = nuevoEgreso.getTime() - nuevoIngreso.getTime();
      minutosTotales = Math.round(diferenciaMs / 60000);
      horasTotales = Number((diferenciaMs / 3600000).toFixed(2));
      montoTotal = Number((horasTotales * nuevoValorHora).toFixed(2));
    }

    const updateQuery = `
      UPDATE public.colaboradores_jornadas
      SET 
        fecha_ingreso = $1,
        fecha_egreso = $2,
        minutos_totales = $3,
        horas_totales = $4,
        valor_hora_aplicado = $5,
        monto_total = $6,
        observacion_ingreso = COALESCE($7, observacion_ingreso),
        observacion_egreso = COALESCE($8, observacion_egreso),
        actualizado_en = NOW()
      WHERE id = $9
      RETURNING *;
    `;
    const { rows: rowsUpdated } = await pool.query(updateQuery, [
      nuevoIngreso,
      nuevoEgreso,
      minutosTotales,
      horasTotales,
      nuevoValorHora,
      montoTotal,
      observacion_ingreso,
      observacion_egreso,
      jornadaId
    ]);

    res.json({
      success: true,
      message: 'Jornada modificada exitosamente',
      jornada: rowsUpdated[0]
    });
  } catch (error) {
    console.error('❌ Error al actualizar jornada:', error);
    res.status(500).json({ error: 'Error interno al actualizar jornada' });
  }
});

/**
 * DELETE /api/colaboradores/jornadas/:id
 * Elimina una jornada si no ha sido liquidada.
 */
router.delete('/colaboradores/jornadas/:id', async (req, res) => {
  const jornadaId = req.params.id;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM public.colaboradores_jornadas WHERE id = $1`,
      [jornadaId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Jornada no encontrada' });
    }

    if (rows[0].estado === 'LIQUIDADA') {
      return res.status(400).json({ error: 'No se puede eliminar una jornada que ya fue liquidada a Cuenta Corriente.' });
    }

    await pool.query(`DELETE FROM public.colaboradores_jornadas WHERE id = $1`, [jornadaId]);
    res.json({ success: true, message: 'Jornada eliminada correctamente' });
  } catch (error) {
    console.error('❌ Error al eliminar jornada:', error);
    res.status(500).json({ error: 'Error interno al eliminar jornada' });
  }
});

/**
 * POST /api/colaboradores/jornadas/liquidar
 * Liquida un conjunto de jornadas a la Cuenta Corriente del colaborador.
 * Transacción atómica en PostgreSQL.
 */
router.post('/colaboradores/jornadas/liquidar', async (req, res) => {
  const { jornada_ids, descripcion_personalizada } = req.body;

  if (!Array.isArray(jornada_ids) || jornada_ids.length === 0) {
    return res.status(400).json({ error: 'Debe proporcionar al menos una jornada para liquidar' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Obtener y bloquear las jornadas a liquidar
    const { rows: jornadas } = await client.query(`
      SELECT j.*, u.nombre_completo, u.usuario
      FROM public.colaboradores_jornadas j
      JOIN public.usuarios u ON j.usuario_id = u.id
      WHERE j.id = ANY($1::int[])
      FOR UPDATE
    `, [jornada_ids]);

    if (jornadas.length !== jornada_ids.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Algunas de las jornadas seleccionadas no existen.' });
    }

    // 2. Validar que todas estén FINALIZADAS
    const noFinalizadas = jornadas.filter(j => j.estado !== 'FINALIZADA');
    if (noFinalizadas.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `Hay ${noFinalizadas.length} jornada(s) que están en curso o ya fueron liquidadas previamente.` 
      });
    }

    // 3. Agrupar por colaborador (usuario_id)
    const jornadasPorUsuario = {};
    jornadas.forEach(j => {
      if (!jornadasPorUsuario[j.usuario_id]) {
        jornadasPorUsuario[j.usuario_id] = {
          usuario_id: j.usuario_id,
          nombre_completo: j.nombre_completo,
          jornadas: [],
          totalHoras: 0,
          totalMonto: 0
        };
      }
      jornadasPorUsuario[j.usuario_id].jornadas.push(j);
      jornadasPorUsuario[j.usuario_id].totalHoras += parseFloat(j.horas_totales) || 0;
      jornadasPorUsuario[j.usuario_id].totalMonto += parseFloat(j.monto_total) || 0;
    });

    const resultadosLiquidacion = [];

    // 4. Procesar cada colaborador
    for (const uId of Object.keys(jornadasPorUsuario)) {
      const grupo = jornadasPorUsuario[uId];
      const totalMontoRedondeado = Number(grupo.totalMonto.toFixed(2));
      const totalHorasRedondeadas = Number(grupo.totalHoras.toFixed(2));

      if (totalMontoRedondeado <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `El importe a liquidar para ${grupo.nombre_completo} debe ser mayor a $0.00 (Total: $${totalMontoRedondeado})` 
        });
      }

      // Buscar cuenta corriente vinculada en bunker_clientes
      const { rows: clientes } = await client.query(`
        SELECT bc.codigo_bunker_cliente, bc.razon_social, cc.id as cuenta_corriente_id, cc.saldo
        FROM public.bunker_clientes bc
        JOIN public.factura_cuentas_corrientes cc ON bc.codigo_bunker_cliente = cc.codigo_bunker_cliente
        WHERE bc.usuario_id = $1 AND cc.estado = 'ACTIVA'
        LIMIT 1
      `, [grupo.usuario_id]);

      if (clientes.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `El colaborador "${grupo.nombre_completo}" (Usuario #${grupo.usuario_id}) no tiene una Cuenta Corriente activa vinculada en Clientes Búnker. Por favor asigne el usuario en Clientes Búnker antes de liquidar.`
        });
      }

      const cliente = clientes[0];

      // Armar descripción del movimiento
      const idsStr = grupo.jornadas.map(j => `#${j.id}`).join(', ');
      const descMov = descripcion_personalizada || 
        `Crédito por liquidación de ${totalHorasRedondeadas} hs en depósito (Jornadas ${idsStr})`;

      // Insertar movimiento de Crédito (saldo_resultante temporal que se recalcula cronológicamente)
      const metadatosMov = {
        origen: 'LIQUIDACION_JORNADAS_DEPOSITO',
        jornadas_ids: grupo.jornadas.map(j => j.id),
        horas_totales: totalHorasRedondeadas,
        monto_total: totalMontoRedondeado,
        usuario_id: grupo.usuario_id,
        colaborador: grupo.nombre_completo,
        liquidado_en: new Date().toISOString()
      };

      const { rows: movRows } = await client.query(`
        INSERT INTO public.factura_cuenta_corriente_movimientos 
          (cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
           tipo_comprobante, comprobante_id, descripcion, fecha_movimiento, creado_en, metadatos)
        VALUES 
          ($1, 'CREDITO', $2, 0.00, 'CREDITO_HORAS', NULL, $3, NOW(), NOW(), $4)
        RETURNING id;
      `, [
        cliente.cuenta_corriente_id,
        totalMontoRedondeado,
        descMov,
        JSON.stringify(metadatosMov)
      ]);

      const movimientoId = movRows[0].id;

      // Recalcular saldo y movimientos formalmente de forma transaccional
      const nuevoSaldo = await CuentaCorrienteService.recalcularSaldos(cliente.cuenta_corriente_id, client);

      // Actualizar el estado de las jornadas de este colaborador
      const idsGrupo = grupo.jornadas.map(j => j.id);
      await client.query(`
        UPDATE public.colaboradores_jornadas
        SET 
          estado = 'LIQUIDADA',
          liquidada_en = NOW(),
          cuenta_corriente_movimiento_id = $1,
          actualizado_en = NOW()
        WHERE id = ANY($2::int[]);
      `, [movimientoId, idsGrupo]);

      resultadosLiquidacion.push({
        colaborador: grupo.nombre_completo,
        cliente: cliente.razon_social,
        codigo_bunker_cliente: cliente.codigo_bunker_cliente,
        cuenta_corriente_id: cliente.cuenta_corriente_id,
        movimiento_id: movimientoId,
        horas_liquidadas: totalHorasRedondeadas,
        monto_acreditado: totalMontoRedondeado,
        nuevo_saldo_cc: nuevoSaldo
      });
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Se liquidaron exitosamente ${jornadas.length} jornada(s).`,
      detalle: resultadosLiquidacion
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error al liquidar jornadas a Cuenta Corriente:', error);
    res.status(500).json({ error: 'Error interno al liquidar jornadas a Cuenta Corriente' });
  } finally {
    client.release();
  }
});

module.exports = router;
