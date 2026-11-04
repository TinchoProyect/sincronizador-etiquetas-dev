// controllers/tiemposCarro.js
const pool = require('../config/database');
const { validarPropiedadCarro } = require('./carro');

function mapEtapa(etapaStr) {
  const e = String(etapaStr);
  const maps = {
    '1': { inicio: 'etapa1_inicio', fin: 'etapa1_fin', dur: 'etapa1_duracion_ms' },
    '2': { inicio: 'etapa2_inicio', fin: 'etapa2_fin', dur: 'etapa2_duracion_ms' },
    '3': { inicio: 'etapa3_inicio', fin: 'etapa3_fin', dur: 'etapa3_duracion_ms' }
  };
  return maps[e] || null;
}

/**
 * Prorrateo Justo de Métricas:
 * Calcula la atribución exacta por unidad para todos los artículos del carro,
 * garantizando la regla de conservación (suma de las partes == total neto del carro).
 */
async function calcularYGuardarProrrateoJusto(carroId, clientOrPool) {
  const db = clientOrPool || pool;

  // 1. Obtener datos del carro y operario
  const carroRes = await db.query(`
    SELECT cp.id, cp.usuario_id, u.nombre_completo AS usuario_nombre,
           COALESCE(cp.tiempo_pausa_ms, 0) AS tiempo_pausa_ms,
           cp.etapa1_inicio, cp.etapa1_fin, COALESCE(cp.etapa1_duracion_ms, 0) AS etapa1_duracion_ms,
           cp.etapa2_inicio, cp.etapa2_fin, COALESCE(cp.etapa2_duracion_ms, 0) AS etapa2_duracion_ms,
           cp.etapa3_inicio, cp.etapa3_fin, COALESCE(cp.etapa3_duracion_ms, 0) AS etapa3_duracion_ms
    FROM carros_produccion cp
    LEFT JOIN usuarios u ON u.id = cp.usuario_id
    WHERE cp.id = $1
  `, [carroId]);

  if (carroRes.rowCount === 0) return null;
  const carro = carroRes.rows[0];

  const durE1 = Math.max(0, Number(carro.etapa1_duracion_ms || 0));
  const durE2 = Math.max(0, Number(carro.etapa2_duracion_ms || 0));
  const durE3 = Math.max(0, Number(carro.etapa3_duracion_ms || 0));
  const durPausa = Math.max(0, Number(carro.tiempo_pausa_ms || 0));

  const durBruto = durE1 + durE2 + durE3;
  const durNetoTotal = Math.max(0, durBruto - durPausa);

  // 2. Obtener artículos del carro
  const artRes = await db.query(`
    SELECT articulo_numero, descripcion, COALESCE(cantidad, 1) AS cantidad
    FROM carros_articulos
    WHERE carro_id = $1
  `, [carroId]);

  if (artRes.rowCount === 0) {
    return { durNetoTotal, articulosAfectados: 0 };
  }

  // Sumar unidades totales
  let totalUnidades = 0;
  artRes.rows.forEach(r => {
    const cant = parseFloat(r.cantidad) || 0;
    totalUnidades += cant > 0 ? cant : 1;
  });
  if (totalUnidades <= 0) totalUnidades = 1;

  // Minutos netos totales y unitarios
  const totalMinutosNetos = durNetoTotal / 60000;
  const minutosUnitariosTotal = totalMinutosNetos / totalUnidades;

  // Factor de descuento de pausas proporcional por etapa
  const factorNeto = durBruto > 0 ? (durNetoTotal / durBruto) : 1;
  const minE1Neto = (durE1 * factorNeto) / 60000;
  const minE2Neto = (durE2 * factorNeto) / 60000;
  const minE3Neto = (durE3 * factorNeto) / 60000;

  const minE1Unit = minE1Neto / totalUnidades;
  const minE2Unit = minE2Neto / totalUnidades;
  const minE3Unit = minE3Neto / totalUnidades;

  // Limpiar cualquier métrica previa de este carro para ser idempotente
  await db.query(`DELETE FROM produccion_metricas_articulos WHERE carro_id = $1`, [carroId]);

  // Insertar registros con prorrateo justo
  for (const art of artRes.rows) {
    const cant = parseFloat(art.cantidad) || 1;
    await db.query(`
      INSERT INTO produccion_metricas_articulos (
        carro_id, usuario_id, usuario_nombre,
        articulo_numero, descripcion, unidades_producidas,
        minutos_etapa1_unitario, minutos_etapa2_unitario, minutos_etapa3_unitario,
        minutos_unitarios_total,
        duracion_etapa1_ms, duracion_etapa2_ms, duracion_etapa3_ms,
        duracion_pausa_carro_ms, duracion_total_carro_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      carroId,
      carro.usuario_id,
      carro.usuario_nombre || 'Operario',
      art.articulo_numero,
      art.descripcion || '',
      cant,
      minE1Unit,
      minE2Unit,
      minE3Unit,
      minutosUnitariosTotal,
      durE1,
      durE2,
      durE3,
      durPausa,
      durNetoTotal
    ]);
  }

  return {
    ok: true,
    carroId,
    totalUnidades,
    durNetoTotal,
    totalMinutosNetos,
    minutosUnitariosTotal,
    articulosCount: artRes.rows.length
  };
}

/* ==========================================================================
   NUEVOS CONTROLADORES PARA MODO MEDICIÓN TEMPORAL (3 ETAPAS + PAUSA)
   ========================================================================== */

/**
 * POST /api/tiempos/carro/:carroId/modo-medicion
 * Activa o desactiva voluntariamente el modo de medición para el carro
 */
exports.setModoMedicion = async (req, res) => {
  const { carroId } = req.params;
  const { activar, usuarioId } = req.body;

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const q = `
      UPDATE carros_produccion
      SET modo_medicion = $2,
          medicion_etapa_actual = CASE WHEN $2 = false THEN 0 ELSE medicion_etapa_actual END
      WHERE id = $1
      RETURNING id, modo_medicion, medicion_etapa_actual
    `;
    const r = await pool.query(q, [carroId, !!activar]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Carro no encontrado' });

    return res.json({ ok: true, carro_id: carroId, modo_medicion: r.rows[0].modo_medicion });
  } catch (err) {
    console.error('Error setModoMedicion:', err);
    return res.status(500).json({ error: 'No se pudo actualizar el modo de medición' });
  }
};

/**
 * POST /api/tiempos/carro/:carroId/pausa
 * Pausa o reanuda la medición temporal acumulando pausas
 */
exports.togglePausaMedicion = async (req, res) => {
  const { carroId } = req.params;
  const { pausar, usuarioId, congelarPausa } = req.body;

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const carroRes = await pool.query(
      `SELECT medicion_etapa_actual, medicion_pausada, medicion_pausada_inicio,
              COALESCE(tiempo_pausa_ms, 0) AS tiempo_pausa_ms,
              CASE WHEN medicion_pausada AND medicion_pausada_inicio IS NOT NULL
                   THEN (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - medicion_pausada_inicio)) * 1000)::bigint
                   ELSE 0
              END AS delta_pausa_actual_ms
       FROM carros_produccion WHERE id = $1`,
      [carroId]
    );
    if (carroRes.rowCount === 0) return res.status(404).json({ error: 'Carro no encontrado' });
    const c = carroRes.rows[0];

    if (pausar) {
      // Iniciar pausa si no estaba pausada (guarda la "foto temporal" en medicion_pausada_inicio)
      if (!c.medicion_pausada) {
        await pool.query(`
          UPDATE carros_produccion
          SET medicion_pausada = TRUE,
              medicion_pausada_inicio = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [carroId]);
      }
      return res.json({ ok: true, pausado: true, tiempo_pausa_ms: c.tiempo_pausa_ms });
    } else {
      // Reanudar pausa: si se retoma desde "Foto Temporal" (congelarPausa = true) o si estuvo pausado > 1h (entre jornadas),
      // desplazamos el inicio de la etapa activa para congelar las horas de taller cerrado sin inflar las pausas operativas.
      if (c.medicion_pausada && c.medicion_pausada_inicio) {
        const deltaMs = Number(c.delta_pausa_actual_ms || 0);
        const esCongelamientoJornada = !!congelarPausa || deltaMs > 3600000;

        if (esCongelamientoJornada) {
          const deltaRes = await pool.query(`
            UPDATE carros_produccion
            SET medicion_pausada = FALSE,
                etapa1_inicio = CASE WHEN medicion_etapa_actual = 1 AND etapa1_inicio IS NOT NULL THEN etapa1_inicio + (CURRENT_TIMESTAMP - medicion_pausada_inicio) ELSE etapa1_inicio END,
                etapa2_inicio = CASE WHEN medicion_etapa_actual = 2 AND etapa2_inicio IS NOT NULL THEN etapa2_inicio + (CURRENT_TIMESTAMP - medicion_pausada_inicio) ELSE etapa2_inicio END,
                etapa3_inicio = CASE WHEN medicion_etapa_actual = 3 AND etapa3_inicio IS NOT NULL THEN etapa3_inicio + (CURRENT_TIMESTAMP - medicion_pausada_inicio) ELSE etapa3_inicio END,
                medicion_pausada_inicio = NULL
            WHERE id = $1
            RETURNING COALESCE(tiempo_pausa_ms, 0) AS tiempo_pausa_ms
          `, [carroId]);

          return res.json({ ok: true, pausado: false, tiempo_pausa_ms: deltaRes.rows[0].tiempo_pausa_ms, foto_retomada: true });
        } else {
          const deltaRes = await pool.query(`
            UPDATE carros_produccion
            SET medicion_pausada = FALSE,
                tiempo_pausa_ms = COALESCE(tiempo_pausa_ms, 0) + (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - medicion_pausada_inicio)) * 1000)::bigint,
                medicion_pausada_inicio = NULL
            WHERE id = $1
            RETURNING tiempo_pausa_ms
          `, [carroId]);

          return res.json({ ok: true, pausado: false, tiempo_pausa_ms: deltaRes.rows[0].tiempo_pausa_ms, foto_retomada: false });
        }
      }
      return res.json({ ok: true, pausado: false, tiempo_pausa_ms: c.tiempo_pausa_ms });
    }
  } catch (err) {
    console.error('Error togglePausaMedicion:', err);
    return res.status(500).json({ error: 'Error al cambiar estado de pausa' });
  }
};

/**
 * POST /api/tiempos/carro/:carroId/avanzar-etapa
 * Controla el timón de etapas (1 -> 2 -> 3 -> 4)
 * etapa 1: Preparación (arranca con "Carro listo para producir")
 * etapa 2: Producción pura
 * etapa 3: Etiquetado y guardado
 * etapa 4: Finalizar y calcular Prorrateo Justo
 */
exports.avanzarEtapaMedicion = async (req, res) => {
  const { carroId } = req.params;
  const { siguienteEtapa, usuarioId, usuarioNombre } = req.body;

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const targetEtapa = parseInt(siguienteEtapa, 10);
    if (![1, 2, 3, 4].includes(targetEtapa)) {
      return res.status(400).json({ error: 'Siguiente etapa inválida (debe ser 1, 2, 3 o 4)' });
    }

    // Si estaba pausado, reanudar automáticamente (si la pausa fue > 1h entre jornadas, desplazar inicio de etapa; si fue corta, sumar a tiempo_pausa_ms)
    await pool.query(`
      UPDATE carros_produccion
      SET etapa1_inicio = CASE
            WHEN medicion_pausada AND medicion_pausada_inicio IS NOT NULL AND (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - medicion_pausada_inicio)) * 1000) > 3600000 AND medicion_etapa_actual = 1 AND etapa1_inicio IS NOT NULL
            THEN etapa1_inicio + (CURRENT_TIMESTAMP - medicion_pausada_inicio)
            ELSE etapa1_inicio
          END,
          etapa2_inicio = CASE
            WHEN medicion_pausada AND medicion_pausada_inicio IS NOT NULL AND (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - medicion_pausada_inicio)) * 1000) > 3600000 AND medicion_etapa_actual = 2 AND etapa2_inicio IS NOT NULL
            THEN etapa2_inicio + (CURRENT_TIMESTAMP - medicion_pausada_inicio)
            ELSE etapa2_inicio
          END,
          etapa3_inicio = CASE
            WHEN medicion_pausada AND medicion_pausada_inicio IS NOT NULL AND (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - medicion_pausada_inicio)) * 1000) > 3600000 AND medicion_etapa_actual = 3 AND etapa3_inicio IS NOT NULL
            THEN etapa3_inicio + (CURRENT_TIMESTAMP - medicion_pausada_inicio)
            ELSE etapa3_inicio
          END,
          tiempo_pausa_ms = CASE 
            WHEN medicion_pausada AND medicion_pausada_inicio IS NOT NULL AND (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - medicion_pausada_inicio)) * 1000) <= 3600000
            THEN COALESCE(tiempo_pausa_ms, 0) + (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - medicion_pausada_inicio)) * 1000)::bigint
            ELSE COALESCE(tiempo_pausa_ms, 0)
          END,
          medicion_pausada = FALSE,
          medicion_pausada_inicio = NULL
      WHERE id = $1
    `, [carroId]);

    if (targetEtapa === 1) {
      // Iniciar Etapa 1 (Preparación)
      const q = `
        UPDATE carros_produccion
        SET modo_medicion = TRUE,
            medicion_etapa_actual = 1,
            etapa1_inicio = COALESCE(etapa1_inicio, CURRENT_TIMESTAMP),
            etapa1_fin = NULL,
            etapa1_duracion_ms = NULL
        WHERE id = $1
        RETURNING id, medicion_etapa_actual, etapa1_inicio
      `;
      const r = await pool.query(q, [carroId]);
      return res.json({ ok: true, etapa_actual: 1, inicio: r.rows[0].etapa1_inicio });
    }

    if (targetEtapa === 2) {
      // Cerrar Etapa 1 e Iniciar Etapa 2 (Producción)
      const q = `
        UPDATE carros_produccion
        SET etapa1_fin = CURRENT_TIMESTAMP,
            etapa1_duracion_ms = (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(etapa1_inicio, CURRENT_TIMESTAMP))) * 1000)::bigint,
            medicion_etapa_actual = 2,
            etapa2_inicio = CURRENT_TIMESTAMP,
            etapa2_fin = NULL,
            etapa2_duracion_ms = NULL
        WHERE id = $1
        RETURNING id, medicion_etapa_actual, etapa1_duracion_ms, etapa2_inicio
      `;
      const r = await pool.query(q, [carroId]);
      return res.json({ ok: true, etapa_actual: 2, etapa1_duracion_ms: r.rows[0].etapa1_duracion_ms, inicio: r.rows[0].etapa2_inicio });
    }

    if (targetEtapa === 3) {
      // Cerrar Etapa 2 e Iniciar Etapa 3 (Etiquetado y Guardado)
      const q = `
        UPDATE carros_produccion
        SET etapa2_fin = CURRENT_TIMESTAMP,
            etapa2_duracion_ms = (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(etapa2_inicio, CURRENT_TIMESTAMP))) * 1000)::bigint,
            medicion_etapa_actual = 3,
            etapa3_inicio = CURRENT_TIMESTAMP,
            etapa3_fin = NULL,
            etapa3_duracion_ms = NULL
        WHERE id = $1
        RETURNING id, medicion_etapa_actual, etapa2_duracion_ms, etapa3_inicio
      `;
      const r = await pool.query(q, [carroId]);
      return res.json({ ok: true, etapa_actual: 3, etapa2_duracion_ms: r.rows[0].etapa2_duracion_ms, inicio: r.rows[0].etapa3_inicio });
    }

    if (targetEtapa === 4) {
      // Cerrar Etapa 3 y Finalizar Medición (Idempotente)
      const q = `
        UPDATE carros_produccion
        SET etapa3_fin = COALESCE(etapa3_fin, CURRENT_TIMESTAMP),
            etapa3_duracion_ms = COALESCE(etapa3_duracion_ms, (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(etapa3_inicio, CURRENT_TIMESTAMP))) * 1000)::bigint),
            medicion_etapa_actual = 4
        WHERE id = $1
        RETURNING id, medicion_etapa_actual, etapa3_duracion_ms
      `;
      const r = await pool.query(q, [carroId]);

      // Ejecutar Prorrateo Justo de inmediato
      const prorrateo = await calcularYGuardarProrrateoJusto(carroId, pool);

      return res.json({
        ok: true,
        etapa_actual: 4,
        finalizado: true,
        etapa3_duracion_ms: r.rows[0].etapa3_duracion_ms,
        prorrateo
      });
    }

  } catch (err) {
    console.error('Error avanzarEtapaMedicion:', err);
    return res.status(500).json({ error: 'No se pudo avanzar de etapa' });
  }
};

/**
 * POST /api/tiempos/carro/:carroId/cancelar-medicion
 * Cancela y descarta la medición sin alterar el contenido del carro
 */
exports.cancelarMedicion = async (req, res) => {
  const { carroId } = req.params;
  const { usuarioId } = req.body;

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    // Resetear columnas de medición y etapas en el carro
    await pool.query(`
      UPDATE carros_produccion
      SET modo_medicion = FALSE,
          medicion_etapa_actual = 0,
          medicion_pausada = FALSE,
          medicion_pausada_inicio = NULL,
          tiempo_pausa_ms = 0,
          etapa1_inicio = NULL, etapa1_fin = NULL, etapa1_duracion_ms = NULL,
          etapa2_inicio = NULL, etapa2_fin = NULL, etapa2_duracion_ms = NULL,
          etapa3_inicio = NULL, etapa3_fin = NULL, etapa3_duracion_ms = NULL
      WHERE id = $1
    `, [carroId]);

    // Eliminar registros de métricas si se hubieran guardado
    await pool.query(`DELETE FROM produccion_metricas_articulos WHERE carro_id = $1`, [carroId]);

    return res.json({ ok: true, mensaje: 'Medición cancelada y descartada exitosamente' });
  } catch (err) {
    console.error('Error cancelarMedicion:', err);
    return res.status(500).json({ error: 'No se pudo cancelar la medición' });
  }
};

/**
 * GET /api/tiempos/carro/:carroId/estado-medicion
 * Obtiene el estado integral de la medición para alimentar el HUD flotante
 */
exports.obtenerEstadoMedicion = async (req, res) => {
  const { carroId } = req.params;
  const usuarioId = req.query.usuarioId || (req.body && req.body.usuarioId);

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const q = `
      SELECT 
        id,
        tipo_carro,
        modo_medicion,
        medicion_etapa_actual,
        medicion_pausada,
        medicion_pausada_inicio,
        COALESCE(tiempo_pausa_ms, 0) AS tiempo_pausa_ms,
        etapa1_inicio, etapa1_fin, COALESCE(etapa1_duracion_ms, 0) AS etapa1_duracion_ms,
        etapa2_inicio, etapa2_fin, COALESCE(etapa2_duracion_ms, 0) AS etapa2_duracion_ms,
        etapa3_inicio, etapa3_fin, COALESCE(etapa3_duracion_ms, 0) AS etapa3_duracion_ms,
        CASE
          WHEN medicion_etapa_actual = 1 AND etapa1_inicio IS NOT NULL
            THEN (EXTRACT(EPOCH FROM (COALESCE(CASE WHEN medicion_pausada THEN medicion_pausada_inicio END, CURRENT_TIMESTAMP) - etapa1_inicio)) * 1000)::bigint
          WHEN medicion_etapa_actual = 2 AND etapa2_inicio IS NOT NULL
            THEN (EXTRACT(EPOCH FROM (COALESCE(CASE WHEN medicion_pausada THEN medicion_pausada_inicio END, CURRENT_TIMESTAMP) - etapa2_inicio)) * 1000)::bigint
          WHEN medicion_etapa_actual = 3 AND etapa3_inicio IS NOT NULL
            THEN (EXTRACT(EPOCH FROM (COALESCE(CASE WHEN medicion_pausada THEN medicion_pausada_inicio END, CURRENT_TIMESTAMP) - etapa3_inicio)) * 1000)::bigint
          ELSE 0
        END AS bruto_etapa_actual_ms,
        fecha_preparado IS NOT NULL AS preparado,
        fecha_confirmacion IS NOT NULL AS asentado
      FROM carros_produccion
      WHERE id = $1
    `;
    const r = await pool.query(q, [carroId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Carro no encontrado' });

    const row = r.rows[0];
    const brutoEtapaActualMs = Math.max(0, Number(row.bruto_etapa_actual_ms || 0));
    const tiempoPausaMs = Math.max(0, Number(row.tiempo_pausa_ms || 0));
    const etapaActualNetoMs = Math.max(0, brutoEtapaActualMs - tiempoPausaMs);

    const etapaNum = Number(row.medicion_etapa_actual || 0);
    const durE1Done = etapaNum > 1 ? Math.max(0, Number(row.etapa1_duracion_ms || 0)) : 0;
    const durE2Done = etapaNum > 2 ? Math.max(0, Number(row.etapa2_duracion_ms || 0)) : 0;
    const durE3Done = etapaNum > 3 ? Math.max(0, Number(row.etapa3_duracion_ms || 0)) : 0;
    const totalNetoAcumuladoMs = etapaNum === 4
      ? Math.max(0, durE1Done + durE2Done + durE3Done - tiempoPausaMs)
      : Math.max(0, durE1Done + durE2Done + brutoEtapaActualMs - tiempoPausaMs);

    // Consultar desglose de métricas registradas de artículos
    const mq = `
      SELECT 
        id,
        articulo_numero,
        descripcion,
        unidades_producidas,
        minutos_etapa1_unitario,
        minutos_etapa2_unitario,
        minutos_etapa3_unitario,
        minutos_unitarios_total,
        duracion_etapa1_ms,
        duracion_etapa2_ms,
        duracion_etapa3_ms,
        duracion_pausa_carro_ms,
        duracion_total_carro_ms,
        fecha_medicion
      FROM produccion_metricas_articulos
      WHERE carro_id = $1
      ORDER BY id ASC
    `;
    const mRes = await pool.query(mq, [carroId]);

    return res.json({ 
      ok: true, 
      carro_id: carroId, 
      ...row,
      etapa_actual_neto_ms: etapaActualNetoMs,
      total_neto_acumulado_ms: totalNetoAcumuladoMs,
      tiene_metricas: mRes.rowCount > 0,
      metricas: mRes.rows
    });
  } catch (err) {
    console.error('Error obtenerEstadoMedicion:', err);
    return res.status(500).json({ error: 'No se pudo obtener el estado de medición' });
  }
};

/* ==========================================================================
   ENDPOINTS PARA GESTOR DE PRECIOS BÚNKER (CONSULTA DE MÉTRICAS DE CAMPO)
   ========================================================================== */

/**
 * GET /api/tiempos/articulo/:articuloNumero/metricas-campo
 * Provee la estadística empírica de campo para el asistente de mano de obra en Búnker
 */
exports.obtenerMetricasCampoArticulo = async (req, res) => {
  const { articuloNumero } = req.params;

  try {
    const q = `
      SELECT 
        pma.id,
        pma.carro_id,
        pma.usuario_id,
        pma.usuario_nombre,
        pma.articulo_numero,
        pma.descripcion,
        pma.unidades_producidas,
        pma.minutos_etapa1_unitario,
        pma.minutos_etapa2_unitario,
        pma.minutos_etapa3_unitario,
        pma.minutos_unitarios_total,
        pma.duracion_total_carro_ms,
        pma.fecha_medicion
      FROM produccion_metricas_articulos pma
      WHERE pma.articulo_numero = $1
      ORDER BY pma.fecha_medicion DESC
    `;
    const r = await pool.query(q, [articuloNumero]);

    if (r.rowCount === 0) {
      return res.json({
        tiene_metricas: false,
        cantidad_mediciones: 0,
        promedio_minutos_unitario: null,
        promedio_etapa1: null,
        promedio_etapa2: null,
        promedio_etapa3: null,
        ultima_medicion: null,
        historial: []
      });
    }

    const rows = r.rows;
    const count = rows.length;

    let sumMinutosPonderados = 0;
    let sumE1Ponderados = 0;
    let sumE2Ponderados = 0;
    let sumE3Ponderados = 0;
    let sumUnidades = 0;

    rows.forEach(row => {
      const u = parseFloat(row.unidades_producidas) || 1;
      const mTot = parseFloat(row.minutos_unitarios_total) || 0;
      const mE1 = parseFloat(row.minutos_etapa1_unitario) || 0;
      const mE2 = parseFloat(row.minutos_etapa2_unitario) || 0;
      const mE3 = parseFloat(row.minutos_etapa3_unitario) || 0;

      sumMinutosPonderados += (mTot * u);
      sumE1Ponderados += (mE1 * u);
      sumE2Ponderados += (mE2 * u);
      sumE3Ponderados += (mE3 * u);
      sumUnidades += u;
    });

    const promedioMinutos = sumUnidades > 0 ? (sumMinutosPonderados / sumUnidades) : 0;
    const promedioE1 = sumUnidades > 0 ? (sumE1Ponderados / sumUnidades) : 0;
    const promedioE2 = sumUnidades > 0 ? (sumE2Ponderados / sumUnidades) : 0;
    const promedioE3 = sumUnidades > 0 ? (sumE3Ponderados / sumUnidades) : 0;

    return res.json({
      tiene_metricas: true,
      cantidad_mediciones: count,
      total_unidades_medidas: sumUnidades,
      promedio_minutos_unitario: parseFloat(promedioMinutos.toFixed(2)),
      promedio_etapa1: parseFloat(promedioE1.toFixed(2)),
      promedio_etapa2: parseFloat(promedioE2.toFixed(2)),
      promedio_etapa3: parseFloat(promedioE3.toFixed(2)),
      ultima_medicion: {
        fecha: rows[0].fecha_medicion,
        usuario_nombre: rows[0].usuario_nombre,
        minutos_unitarios: parseFloat(parseFloat(rows[0].minutos_unitarios_total).toFixed(2)),
        unidades_producidas: parseFloat(rows[0].unidades_producidas),
        carro_id: rows[0].carro_id
      },
      historial: rows.slice(0, 10).map(row => ({
        id: row.id,
        carro_id: row.carro_id,
        usuario_nombre: row.usuario_nombre,
        unidades: parseFloat(row.unidades_producidas),
        minutos_unitarios: parseFloat(parseFloat(row.minutos_unitarios_total).toFixed(2)),
        etapa1: parseFloat(parseFloat(row.minutos_etapa1_unitario).toFixed(2)),
        etapa2: parseFloat(parseFloat(row.minutos_etapa2_unitario).toFixed(2)),
        etapa3: parseFloat(parseFloat(row.minutos_etapa3_unitario).toFixed(2)),
        fecha: row.fecha_medicion
      }))
    });
  } catch (err) {
    console.error('Error obtenerMetricasCampoArticulo:', err);
    return res.status(500).json({ error: 'No se pudieron obtener las métricas de campo' });
  }
};

/**
 * GET /api/tiempos/articulos/metricas-disponibles
 * Devuelve en batch los códigos de artículos que poseen métricas de campo
 */
exports.obtenerMetricasDisponiblesBatch = async (req, res) => {
  try {
    const q = `
      SELECT articulo_numero, COUNT(*)::int AS total_mediciones, AVG(minutos_unitarios_total) AS promedio_minutos
      FROM produccion_metricas_articulos
      GROUP BY articulo_numero
    `;
    const r = await pool.query(q);
    const mapa = {};
    r.rows.forEach(row => {
      mapa[row.articulo_numero] = {
        total_mediciones: row.total_mediciones,
        promedio_minutos: parseFloat(parseFloat(row.promedio_minutos || 0).toFixed(2))
      };
    });
    return res.json({ ok: true, metricas: mapa });
  } catch (err) {
    console.error('Error obtenerMetricasDisponiblesBatch:', err);
    return res.status(500).json({ error: 'Error al consultar disponibilidad de métricas' });
  }
};

/* ==========================================================================
   CONTROLADORES PREVIOS (PRESERVADOS PARA COMPATIBILIDAD REGRESIVA)
   ========================================================================== */

exports.iniciarEtapaCarro = async (req, res) => {
  const { carroId, etapa } = req.params;
  const usuarioId = req.query.usuarioId || (req.body && req.body.usuarioId);

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const map = mapEtapa(etapa);
    if (!map) return res.status(400).json({ error: 'Etapa inválida' });

    const r0 = await pool.query(
      `SELECT fecha_preparado, ${map.inicio} AS inicio, ${map.fin} AS fin
         FROM carros_produccion WHERE id = $1`,
      [carroId]
    );
    if (!r0.rowCount) return res.status(404).json({ error: 'Carro no encontrado' });
    const row = r0.rows[0];

    if (row.fin) {
      return res.status(409).json({ error: 'La etapa ya fue finalizada. No se puede reiniciar.' });
    }

    const q = `
      UPDATE carros_produccion
         SET ${map.inicio} = COALESCE(${map.inicio}, CURRENT_TIMESTAMP),
             ${map.fin}    = NULL,
             ${map.dur}    = NULL
       WHERE id = $1
       RETURNING id, ${map.inicio} AS inicio
    `;
    const r = await pool.query(q, [carroId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Carro no encontrado' });

    return res.json({ ok: true, carro_id: r.rows[0].id, etapa, inicio: r.rows[0].inicio });
  } catch (err) {
    console.error('Error iniciarEtapaCarro:', err);
    return res.status(500).json({ error: 'No se pudo iniciar la etapa' });
  }
};

exports.finalizarEtapaCarro = async (req, res) => {
  const { carroId, etapa } = req.params;
  const usuarioId = req.query.usuarioId || (req.body && req.body.usuarioId);
  if (!usuarioId) return res.status(400).json({ error: 'usuarioId requerido' });

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const map = mapEtapa(etapa);
    if (!map) return res.status(400).json({ error: 'Etapa inválida' });

    const r0 = await pool.query(
      `SELECT fecha_preparado, ${map.inicio} AS inicio, ${map.fin} AS fin
        FROM carros_produccion WHERE id = $1`,
      [carroId]
    );
    if (r0.rowCount === 0) return res.status(404).json({ error: 'Carro no encontrado' });

    const { inicio, fin } = r0.rows[0];
    if (!inicio) return res.status(400).json({ error: 'La etapa no fue iniciada' });

    if (fin) {
      const r1 = await pool.query(
        `SELECT ${map.dur} AS duracion_ms FROM carros_produccion WHERE id=$1`,
        [carroId]
      );
      return res.json({
        ok: true,
        carro_id: carroId,
        etapa,
        duracion_ms: r1.rows[0]?.duracion_ms || 0,
        ya_finalizada: true
      });
    }

    const q = `
      UPDATE carros_produccion
         SET ${map.fin}  = CURRENT_TIMESTAMP,
             ${map.dur}  = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ${map.inicio})) * 1000
       WHERE id = $1
       RETURNING id, ${map.inicio} AS inicio, ${map.fin} AS fin, ${map.dur} AS duracion_ms
    `;
    const r = await pool.query(q, [carroId]);
    return res.json({ ok: true, carro_id: r.rows[0].id, etapa, ...r.rows[0] });
  } catch (err) {
    console.error('Error finalizarEtapaCarro:', err);
    return res.status(500).json({ error: 'No se pudo finalizar la etapa' });
  }
};

exports.iniciarTemporizadorArticulo = async (req, res) => {
  const { carroId, numero } = req.params;
  const { usuarioId } = req.query;
  if (!usuarioId) return res.status(400).json({ error: 'usuarioId requerido' });

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) {
      return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });
    }

    const q = `
      UPDATE carros_articulos
         SET tiempo_inicio = CURRENT_TIMESTAMP,
             tiempo_fin    = NULL,
             duracion_ms   = NULL
       WHERE carro_id = $1 AND articulo_numero = $2
       RETURNING carro_id, articulo_numero, tiempo_inicio
    `;
    const r = await pool.query(q, [carroId, numero]);

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'No se encontró el artículo en el carro' });
    }

    return res.json({ ok: true, ...r.rows[0] });
  } catch (err) {
    console.error('Error iniciarTemporizadorArticulo:', err);
    return res.status(500).json({ error: 'No se pudo iniciar el temporizador' });
  }
};

exports.finalizarTemporizadorArticulo = async (req, res) => {
  const { carroId, numero } = req.params;
  const { usuarioId } = req.query;
  const { elapsedMs } = req.body || {};

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) {
      return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });
    }

    if (!elapsedMs) {
      const qRead = `
        SELECT tiempo_inicio
          FROM carros_articulos
         WHERE carro_id = $1 AND articulo_numero = $2
      `;
      const rRead = await pool.query(qRead, [carroId, numero]);
      if (rRead.rowCount === 0) {
        return res.status(404).json({ error: 'No se encontró el artículo en el carro' });
      }
      const { tiempo_inicio } = rRead.rows[0];
      if (!tiempo_inicio) {
        return res.status(400).json({ error: 'El temporizador no fue iniciado' });
      }

      const qUpdate = `
        UPDATE carros_articulos
           SET tiempo_fin  = CURRENT_TIMESTAMP,
               duracion_ms = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - tiempo_inicio)) * 1000
         WHERE carro_id = $1 AND articulo_numero = $2
         RETURNING carro_id, articulo_numero, tiempo_inicio, tiempo_fin, duracion_ms
      `;
      const rUpdate = await pool.query(qUpdate, [carroId, numero]);
      return res.json({ ok: true, ...rUpdate.rows[0] });
    }

    const q = `
      UPDATE carros_articulos
         SET tiempo_fin  = CURRENT_TIMESTAMP,
             duracion_ms = $3
       WHERE carro_id = $1 AND articulo_numero = $2
       RETURNING carro_id, articulo_numero, tiempo_inicio, tiempo_fin, duracion_ms
    `;
    const r = await pool.query(q, [carroId, numero, Math.max(0, parseInt(elapsedMs, 10) || 0)]);
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'No se encontró el artículo en el carro' });
    }

    return res.json({ ok: true, ...r.rows[0] });
  } catch (err) {
    console.error('Error finalizarTemporizadorArticulo:', err);
    return res.status(500).json({ error: 'No se pudo finalizar el temporizador' });
  }
};

exports.obtenerTiempoTotalCarro = async (req, res) => {
  const { carroId } = req.params;
  const { usuarioId } = req.query;

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) {
      return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });
    }

    const q = `
      SELECT COALESCE(SUM(duracion_ms), 0)::bigint AS total_ms
        FROM carros_articulos
       WHERE carro_id = $1
    `;
    const r = await pool.query(q, [carroId]);
    return res.json({ ok: true, carro_id: carroId, total_ms: r.rows[0].total_ms });
  } catch (err) {
    console.error('Error obtenerTiempoTotalCarro:', err);
    return res.status(500).json({ error: 'No se pudo obtener el tiempo total' });
  }
};

exports.estadoEtapasCarro = async (req, res) => {
  const { carroId } = req.params;
  const usuarioId = req.query.usuarioId || (req.body && req.body.usuarioId);

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const q = `
      SELECT
        fecha_preparado IS NOT NULL AS preparado,
        etapa1_inicio, etapa1_fin, etapa1_duracion_ms,
        etapa2_inicio, etapa2_fin, etapa2_duracion_ms,
        etapa3_inicio, etapa3_fin, etapa3_duracion_ms
      FROM carros_produccion
      WHERE id = $1
    `;
    const r = await pool.query(q, [carroId]);
    if (!r.rowCount) return res.status(404).json({ error: 'Carro no encontrado' });

    return res.json({ ok: true, carro_id: carroId, ...r.rows[0] });
  } catch (err) {
    console.error('Error estadoEtapasCarro:', err);
    return res.status(500).json({ error: 'No se pudo obtener el estado de etapas' });
  }
};

exports.estadoTemporizadoresArticulos = async (req, res) => {
  const { carroId } = req.params;
  const usuarioId = req.query.usuarioId || (req.body && req.body.usuarioId);

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const q = `
      SELECT articulo_numero, tiempo_inicio, tiempo_fin, duracion_ms
      FROM carros_articulos
      WHERE carro_id = $1
      ORDER BY articulo_numero
    `;
    const r = await pool.query(q, [carroId]);
    return res.json(r.rows);
  } catch (err) {
    console.error('Error estadoTemporizadoresArticulos:', err);
    return res.status(500).json({ error: 'No se pudo obtener el estado de artículos' });
  }
};

// =========================================================================
// MOTOR DE ESTIMACIÓN PREDICTIVA AUTOMÁTICA DE TIEMPOS DE PRODUCCIÓN
// Jerarquía de 3 Niveles:
//  1. Evidencia Empírica de Planta (produccion_metricas_articulos)
//  2. Estimación Teórica / Arbitraria de Búnker (propiedades_dinamicas->>'asistente_minutos')
//  3. Sin datos
// =========================================================================

async function calcularEstimacionArticulos(articulos, clientOrPool) {
  const db = clientOrPool || pool;
  if (!articulos || articulos.length === 0) {
    return {
      articulos: [],
      tiempo_total_minutos: 0,
      tiempo_formateado: '0 min',
      origen_general: 'sin_datos',
      articulos_totales: 0,
      articulos_con_tiempo: 0,
      articulos_con_planta: 0,
      articulos_con_arbitraria: 0,
      articulos_sin_datos: 0
    };
  }

  const codigos = articulos
    .map(a => a.articulo_numero || a.numero || a.codigo || a.articulo_id)
    .filter(Boolean);

  if (codigos.length === 0) {
    return {
      articulos: [],
      tiempo_total_minutos: 0,
      tiempo_formateado: '0 min',
      origen_general: 'sin_datos',
      articulos_totales: 0,
      articulos_con_tiempo: 0,
      articulos_con_planta: 0,
      articulos_con_arbitraria: 0,
      articulos_sin_datos: 0
    };
  }

  // 1. Consultar métricas empíricas de planta (promedio ponderado por unidades producidas)
  const plantaRes = await db.query(`
    SELECT 
      articulo_numero,
      ROUND(COALESCE(SUM(minutos_unitarios_total * unidades_producidas) / NULLIF(SUM(unidades_producidas), 0), AVG(minutos_unitarios_total))::numeric, 2) AS promedio_minutos_unitario,
      COUNT(*) AS cantidad_mediciones
    FROM produccion_metricas_articulos
    WHERE articulo_numero = ANY($1)
    GROUP BY articulo_numero
  `, [codigos]);

  const plantaMap = {};
  plantaRes.rows.forEach(r => {
    plantaMap[r.articulo_numero] = {
      promedio: parseFloat(r.promedio_minutos_unitario) || 0,
      mediciones: parseInt(r.cantidad_mediciones, 10) || 0
    };
  });

  // 2. Consultar estimaciones arbitrarias / teóricas de Búnker (propiedades_dinamicas->>'asistente_minutos')
  const bunkerRes = await db.query(`
    SELECT 
      articulo_id,
      (propiedades_dinamicas->>'asistente_minutos')::numeric AS minutos_arbitrarios
    FROM bunker_articulos
    WHERE articulo_id = ANY($1)
  `, [codigos]);

  const bunkerMap = {};
  bunkerRes.rows.forEach(r => {
    const val = parseFloat(r.minutos_arbitrarios);
    if (!isNaN(val) && val > 0) {
      bunkerMap[r.articulo_id] = val;
    }
  });

  let tiempoTotalMinutos = 0;
  let conPlanta = 0;
  let conArbitraria = 0;
  let sinDatos = 0;

  const resultadoArticulos = articulos.map(art => {
    const cod = art.articulo_numero || art.numero || art.codigo || art.articulo_id;
    const desc = art.descripcion || '';
    const cant = parseFloat(art.cantidad) || 1;

    let origen = 'sin_datos';
    let minutosUnitarios = null;
    let minutosTotales = null;
    let detalle = null;

    if (plantaMap[cod] && plantaMap[cod].promedio > 0) {
      origen = 'planta';
      minutosUnitarios = plantaMap[cod].promedio;
      minutosTotales = Number((minutosUnitarios * cant).toFixed(2));
      const mCount = plantaMap[cod].mediciones;
      detalle = `${mCount} medición${mCount > 1 ? 'es' : ''} real${mCount > 1 ? 'es' : ''} de planta`;
      tiempoTotalMinutos += minutosTotales;
      conPlanta++;
    } else if (bunkerMap[cod] && bunkerMap[cod] > 0) {
      origen = 'arbitraria';
      minutosUnitarios = bunkerMap[cod];
      minutosTotales = Number((minutosUnitarios * cant).toFixed(2));
      detalle = 'Estimación teórica de Búnker';
      tiempoTotalMinutos += minutosTotales;
      conArbitraria++;
    } else {
      origen = 'sin_datos';
      detalle = 'Sin registros de tiempo';
      sinDatos++;
    }

    return {
      articulo_numero: cod,
      descripcion: desc,
      cantidad: cant,
      origen,
      minutos_unitarios: minutosUnitarios,
      minutos_totales: minutosTotales,
      detalle
    };
  });

  tiempoTotalMinutos = Number(tiempoTotalMinutos.toFixed(2));
  const articulosTotales = articulos.length;
  const articulosConTiempo = conPlanta + conArbitraria;

  let origenGeneral = 'sin_datos';
  if (articulosConTiempo > 0) {
    if (conPlanta === articulosTotales) {
      origenGeneral = 'planta';
    } else if (conPlanta > 0 && conArbitraria > 0) {
      origenGeneral = 'mixto';
    } else if (conPlanta > 0) {
      origenGeneral = 'planta_parcial';
    } else {
      origenGeneral = 'arbitraria';
    }
  }

  const formatearTiempoHumano = (minutos) => {
    if (!minutos || minutos <= 0) return '0 min';
    if (minutos < 1) {
      const segs = Math.round(minutos * 60);
      return `${segs} seg`;
    }
    const h = Math.floor(minutos / 60);
    const m = Math.floor(minutos % 60);
    const s = Math.round((minutos - Math.floor(minutos)) * 60);

    if (h > 0) {
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    if (s > 0 && m < 10) {
      return `${m}m ${s}s`;
    }
    return `${Math.round(minutos)} min`;
  };

  return {
    articulos: resultadoArticulos,
    tiempo_total_minutos: tiempoTotalMinutos,
    tiempo_formateado: formatearTiempoHumano(tiempoTotalMinutos),
    origen_general: origenGeneral,
    articulos_totales: articulosTotales,
    articulos_con_tiempo: articulosConTiempo,
    articulos_con_planta: conPlanta,
    articulos_con_arbitraria: conArbitraria,
    articulos_sin_datos: sinDatos
  };
}

exports.calcularEstimacionArticulos = calcularEstimacionArticulos;

/**
 * GET /api/tiempos/carro/:carroId/estimacion
 * Devuelve la estimación automática de tiempo para el carro consultado
 */
exports.obtenerEstimacionCarro = async (req, res) => {
  const { carroId } = req.params;
  try {
    const artRes = await pool.query(`
      SELECT articulo_numero, descripcion, COALESCE(cantidad, 1) AS cantidad
      FROM carros_articulos
      WHERE carro_id = $1
      ORDER BY id ASC
    `, [carroId]);

    const resultado = await calcularEstimacionArticulos(artRes.rows);
    return res.json({ ok: true, carro_id: parseInt(carroId, 10), ...resultado });
  } catch (err) {
    console.error('Error en obtenerEstimacionCarro:', err);
    return res.status(500).json({ ok: false, error: 'Error al calcular estimación de tiempo para el carro' });
  }
};

/**
 * POST /api/tiempos/estimacion-articulos
 * Body: { articulos: [ { articulo_numero, cantidad, descripcion } ] }
 * Devuelve la estimación en caliente para cualquier conjunto de artículos
 */
exports.calcularEstimacionArticulosPost = async (req, res) => {
  const { articulos } = req.body;
  try {
    const resultado = await calcularEstimacionArticulos(articulos || []);
    return res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error('Error en calcularEstimacionArticulosPost:', err);
    return res.status(500).json({ ok: false, error: 'Error al calcular estimación de tiempo para artículos' });
  }
};

