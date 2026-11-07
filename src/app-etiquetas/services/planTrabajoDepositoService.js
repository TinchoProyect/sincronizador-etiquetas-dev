/**
 * Servicio de Planificación Finita de Trabajo en Depósito (Pizarra Principal LAMDA)
 *
 * Reglas operativas de depósito para el colaborador:
 * 1. Horizontes claros: Esta Semana (7 días) -> Adelantar 15 días -> Adelantar Mes (30 días).
 * 2. Línea 3 (Mixes): Secuencia en 2 pasos explícitos:
 *    - Paso 1: Hacer el carro de 10 kg y cargarlo al Artículo Puente (ej: MFSXK, MFSSOXK).
 *    - Paso 2: Fraccionar el total del carro para que el Artículo Puente quede en 0 kg.
 *    - Los artículos hijos de pack (ej: 300g en packs de 10) SIEMPRE van en múltiplos cerrados de pack (10, 20, 30...),
 *      y el sobrante del carro de 10 kg (ej: 1 kg cuando se hacen 30 x 300g = 9 kg) se absorbe en una fracción de 1 kg.
 * 3. Línea 2 (Fraccionados Puros):
 *    - Primero verificar si alcanza con lo que ya está abierto en taller.
 *    - Si hay que abrir una caja/bolsa cerrada (ej: 10 kg, 20 kg, 25 kg), sugerir cómo fraccionar toda la caja
 *      para que no quede la caja abierta con saldo en ingrediente.
 * 4. Líneas 5 y 6 (Mezclas Pre-Pesadas):
 *    - Las pre-mezclas tienen peso fijo por bolsa (MPB = 4 kg, MPGDSX7 = 7 kg, MPGDFX6,9 = 6,9 kg) y se arman por unidad.
 */

const fs = require('fs');
const path = require('path');
const { obtenerAnalisisPlanificacionLunes } = require('../../produccion/services/planificacionProduccionService');
const { calcularEstimacionArticulos } = require('../../produccion/controllers/tiemposCarro');

let cachedPlanData = null;
let cachedPlanTimestamp = 0;
const CACHE_TTL_MS = 15 * 1000;

function formatearFechaLocalYYYYMMDD(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Extrae la fecha real de creación embebida dentro del binario PDF por PDFKit (`(D:YYYYMMDDHHmmssZ)`).
 * Si el archivo fue restaurado por Git, copiado o tocado en el sistema de archivos hoy pero su
 * contenido interno corresponde a un día anterior, prevalece siempre la fecha real más antigua
 * para impedir que reaparezcan informes vencidos tras un `git checkout`, `git pull` o reinicio.
 */
function obtenerFechaCreacionRealPdf(fullPath, stat) {
  let fechaefectivaMs = stat.mtimeMs;
  try {
    const rawStr = fs.readFileSync(fullPath).toString('latin1');
    const m = /\(D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}'?\d{2}'?)?\)/.exec(rawStr);
    if (m) {
      const yyyy = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10) - 1;
      const dd = parseInt(m[3], 10);
      const hh = parseInt(m[4], 10);
      const mi = parseInt(m[5], 10);
      const ss = parseInt(m[6], 10);
      const tz = m[7] || 'Z';
      const pdfTimeMs = tz === 'Z'
        ? Date.UTC(yyyy, mm, dd, hh, mi, ss)
        : new Date(yyyy, mm, dd, hh, mi, ss).getTime();
      if (Number.isFinite(pdfTimeMs) && pdfTimeMs > 0) {
        fechaefectivaMs = Math.min(stat.mtimeMs, pdfTimeMs);
      }
    }
  } catch (_) {
    // Fallback a stat.mtimeMs si no se pudo leer el buffer
  }
  return new Date(fechaefectivaMs);
}

/**
 * Verifica de manera determinista si los informes PDF de la Pizarra (Plan de Hoy, Retiro Externa y Plan 3 Jornadas)
 * fueron generados realmente en la fecha calendario de HOY (o preparados la noche anterior >= 18:00 hs).
 * Si pertenecen a un día anterior, caducan automáticamente (se eliminan del directorio público
 * y dejan de mostrarse en la Pizarra Principal).
 */
function verificarVigenciaInformesHoy() {
  const docsDir = path.join(__dirname, '..', 'documentos');
  const hoyStr = formatearFechaLocalYYYYMMDD(new Date());

  const evaluarArchivoDiario = (fileName) => {
    const fullPath = path.join(docsDir, fileName);
    try {
      if (!fs.existsSync(fullPath)) return { vigente: false, mtimeMs: 0 };
      const stat = fs.statSync(fullPath);
      const realDate = obtenerFechaCreacionRealPdf(fullPath, stat);
      const realMs = realDate.getTime();
      const fechaArchivo = formatearFechaLocalYYYYMMDD(realDate);
      // Es vigente únicamente si se generó hoy mismo, o si se dejó preparado la noche anterior (>= 18:00 hs) dentro de las últimas 20 horas
      const horasDesdeCreacion = (Date.now() - realMs) / (1000 * 60 * 60);
      const preparadoNocheAnteriorParaHoy = (horasDesdeCreacion <= 20 && realDate.getHours() >= 18);
      if (fechaArchivo !== hoyStr && !preparadoNocheAnteriorParaHoy) {
        // Venció al cambiar de día: eliminar automáticamente el PDF vencido
        try { fs.unlinkSync(fullPath); } catch (_) { /* ignore */ }
        return { vigente: false, mtimeMs: 0 };
      }
      return { vigente: true, mtimeMs: Math.round(realMs) };
    } catch (_) {
      return { vigente: false, mtimeMs: 0 };
    }
  };

  const planJornada = evaluarArchivoDiario('Plan_Jornada_Hoy_Deposito.pdf');
  const fundamentalsHoy = evaluarArchivoDiario('Fundamentals_Jornada_Hoy_Deposito.pdf');
  const retiroExterna = evaluarArchivoDiario('Plan_Retiro_Produccion_Externa_Hoy.pdf');
  const fundamentalsExterna = evaluarArchivoDiario('Fundamentals_Retiro_Produccion_Externa_Hoy.pdf');
  const plan3Jornadas = evaluarArchivoDiario('Plan_Semanal_3_Jornadas_Deposito.pdf');
  const fundamentals3Jornadas = evaluarArchivoDiario('Fundamentals_Semanal_3_Jornadas_Deposito.pdf');

  return {
    fecha_hoy: hoyStr,
    plan_jornada_hoy_vigente: planJornada.vigente,
    url_plan_jornada_hoy: planJornada.vigente ? `/documentos/Plan_Jornada_Hoy_Deposito.pdf?v=${planJornada.mtimeMs}` : null,
    fundamentals_hoy_vigente: fundamentalsHoy.vigente,
    url_fundamentals_hoy: fundamentalsHoy.vigente ? `/documentos/Fundamentals_Jornada_Hoy_Deposito.pdf?v=${fundamentalsHoy.mtimeMs}` : null,
    retiro_externa_hoy_vigente: retiroExterna.vigente,
    url_retiro_externa_hoy: retiroExterna.vigente ? `/documentos/Plan_Retiro_Produccion_Externa_Hoy.pdf?v=${retiroExterna.mtimeMs}` : null,
    fundamentals_externa_hoy_vigente: fundamentalsExterna.vigente,
    url_fundamentals_externa_hoy: fundamentalsExterna.vigente ? `/documentos/Fundamentals_Retiro_Produccion_Externa_Hoy.pdf?v=${fundamentalsExterna.mtimeMs}` : null,
    plan_3_jornadas_vigente: plan3Jornadas.vigente,
    url_plan_3_jornadas: plan3Jornadas.vigente ? `/documentos/Plan_Semanal_3_Jornadas_Deposito.pdf?v=${plan3Jornadas.mtimeMs}` : null,
    fundamentals_3_jornadas_vigente: fundamentals3Jornadas.vigente,
    url_fundamentals_3_jornadas: fundamentals3Jornadas.vigente ? `/documentos/Fundamentals_Semanal_3_Jornadas_Deposito.pdf?v=${fundamentals3Jornadas.mtimeMs}` : null
  };
}

function formatearMinutos(minutos) {
  const mTotal = Math.round(Number(minutos) || 0);
  if (mTotal <= 0) return '0 min';
  const h = Math.floor(mTotal / 60);
  const m = mTotal % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m} min`;
}

function etiquetaPesoPresentacion(kilosUnidad) {
  const k = Number(kilosUnidad) || 1;
  if (k < 1) {
    return `${Math.round(k * 1000)}g`;
  }
  return `${Number(k.toFixed(2))} kg`;
}

function formatearFraccionOperario(pres, cantidad) {
  const cant = Math.round(Number(cantidad) || 0);
  if (cant <= 0) return '';
  const kU = Number(pres.kilos_unidad) || 1;
  const pesoTxt = etiquetaPesoPresentacion(kU);
  const desc = (pres.descripcion || pres.sku || '').trim();
  const sku = (pres.sku || '').trim();

  // Si es hijo de pack (ej: 300g en pack de 10, o 500g en pack de 5)
  const packU = pres.es_hijo && pres.pack_unidades > 1
    ? (kU === 0.5 && pres.pack_unidades === 10 && cant % 5 === 0 ? 5 : pres.pack_unidades)
    : 1;

  if (packU > 1 && cant % packU === 0) {
    const cantPacks = Math.round(cant / packU);
    return `<span class="pizarra-fracc-item"><span class="pizarra-fracc-desc">${desc}</span> <span class="pizarra-fracc-sku">(${sku})</span>: <strong class="pizarra-num-relevante">${cant} u.</strong> <span class="pizarra-fracc-pack">(${cantPacks} ${cantPacks === 1 ? 'pack' : 'packs'} de ${packU} x ${pesoTxt})</span></span>`;
  }

  return `<span class="pizarra-fracc-item"><span class="pizarra-fracc-desc">${desc}</span> <span class="pizarra-fracc-sku">(${sku})</span>: <strong class="pizarra-num-relevante">${cant} u.</strong></span>`;
}

/**
 * Calcula el tiempo estimado (en minutos) para una presentación y cantidad dada.
 * Usa mediciones reales de planta ('planta'), y para teóricas/estimadas aplica
 * tiempos realistas según el peso de la bolsa.
 */
function estimarMinutosPresentacion(sku, cantidad, kilosUnidad, tiemposMap, esPadre = false) {
  const cant = Math.max(0, Number(cantidad) || 0);
  if (cant <= 0) return { minutos: 0, origen: 'sin_datos' };

  const kgU = Number(kilosUnidad) || 1;
  const key = String(sku || '').trim().toUpperCase();
  const medido = tiemposMap.get(key);

  // Usar medición de Búnker si es empírica de planta, o si es arbitraria pero razonable para el tamaño de bolsa
  if (medido && medido.minutos_unitarios > 0) {
    const esArbitrariaInflada = medido.origen !== 'planta' && kgU <= 1.0 && medido.minutos_unitarios >= 3.5;
    if (!esArbitrariaInflada) {
      return {
        minutos: Math.max(1, Math.round(medido.minutos_unitarios * cant)),
        origen: medido.origen
      };
    }
  }

  if (esPadre) {
    return { minutos: Math.max(2, Math.round(cant * 2.0)), origen: 'estimado' };
  }

  let minPorBolsa = 1.6;
  if (kgU <= 0.5) minPorBolsa = 0.9;      // 200g, 300g, 500g (~9 min cada pack de 10)
  else if (kgU <= 1.2) minPorBolsa = 1.5; // 1kg
  else if (kgU <= 2.5) minPorBolsa = 2.0; // 2kg
  else minPorBolsa = 3.0;                 // 5kg

  const setupMesa = 2.0;
  return {
    minutos: Math.max(3, Math.round(setupMesa + cant * minPorBolsa)),
    origen: 'estimado'
  };
}

/**
 * Para Línea 2 (Fraccionados Puros):
 * Calcula cómo aprovechar la bolsa abierta o la caja que se va a abrir (ej: 10 kg, 20 kg, 25 kg)
 * para no dejar la caja abierta con saldo en ingrediente.
 */
function calcularPlanVaciadoCajaLdn2(presentacionesAll, abiertoKg, bultoKg, totalBultos, hKey) {
  const sugKey = `sug_${hKey}`;
  const kgMin = parseFloat(presentacionesAll.reduce((acc, p) => acc + ((p[sugKey] || 0) * p.kilos_unidad), 0).toFixed(1));
  if (kgMin <= 0) return null;

  // Caso A: Ya alcanza con lo que está abierto en taller (no hay que abrir caja nueva)
  if (abiertoKg >= kgMin) {
    const sobranteAbierto = parseFloat((abiertoKg - kgMin).toFixed(1));
    // Ver si con lo que sobra abierto en taller se puede hacer alguna bolsa más (de las que pide 15d/30d o de las presentaciones del grupo)
    let sugerenciaExtraAbierto = null;
    if (sobranteAbierto >= 1.0) {
      const copia = presentacionesAll.map(p => ({ ...p, cant_vaciado: p[sugKey] || 0 }));
      let rest = sobranteAbierto;
      // Primero cubrir lo que pide 15d / 30d si entra en lo que ya está abierto
      for (const p of copia) {
        const meta30 = Math.max(p.sug_30d || 0, p.sug_15d || 0);
        while (p.cant_vaciado < meta30 && p.kilos_unidad <= rest + 0.15) {
          p.cant_vaciado += 1;
          rest -= p.kilos_unidad;
        }
      }
      // Si todavía queda saldo abierto y cabe en alguna presentación activa, vaciarlo priorizando bolsas grandes (ej: 5kg antes que 1kg)
      const candidatas = [...copia].sort((a, b) => {
        const actA = (a.sug_30d || 0) > 0 ? 1 : 0;
        const actB = (b.sug_30d || 0) > 0 ? 1 : 0;
        if (actA !== actB) return actB - actA;
        return b.kilos_unidad - a.kilos_unidad;
      });
      for (const p of candidatas) {
        while (p.kilos_unidad >= 1 && p.kilos_unidad <= rest + 0.15) {
          p.cant_vaciado += 1;
          rest -= p.kilos_unidad;
        }
      }
      const kgVaciado = parseFloat(copia.reduce((s, p) => s + p.cant_vaciado * p.kilos_unidad, 0).toFixed(1));
      if (kgVaciado > kgMin + 0.5) {
        const partes = copia
          .filter(p => p.cant_vaciado > 0)
          .map(p => `${p.cant_vaciado} ${p.cant_vaciado === 1 ? 'bolsa' : 'bolsas'} × ${etiquetaPesoPresentacion(p.kilos_unidad)}`);
        sugerenciaExtraAbierto = `💡 Para terminar los ${abiertoKg} kg abiertos y dejar ingrediente en 0: hacé <strong>${partes.join(' + ')}</strong> (${kgVaciado} kg)`;
      }
    }

    return {
      abre_caja: false,
      estado_ingrediente_html: `🟢 <strong>Usar bolsa abierta en taller</strong> (hay ${abiertoKg} kg abiertos — no abrir caja)`,
      sugerencia_vaciado_html: sugerenciaExtraAbierto
    };
  }

  // Caso B: No alcanza lo abierto en taller -> Hay que abrir 1 (o más) cajas/bolsas cerradas
  if (totalBultos <= 0) {
    return {
      abre_caja: false,
      estado_ingrediente_html: `🔴 <strong>Falta materia prima en depósito</strong> (solo hay ${abiertoKg} kg abiertos)`,
      sugerencia_vaciado_html: null
    };
  }

  const cajasAAbrir = Math.max(1, Math.ceil((kgMin - abiertoKg) / bultoKg));
  const dispMesaKg = parseFloat((abiertoKg + cajasAAbrir * bultoKg).toFixed(1));
  const sobranteEnCaja = parseFloat((dispMesaKg - kgMin).toFixed(1));

  const estadoIngHtml = abiertoKg >= 0.4
    ? `📦 <strong>Usar ${abiertoKg} kg abiertos + abrir ${cajasAAbrir} ${cajasAAbrir === 1 ? 'caja/bolsa' : 'cajas/bolsas'} de ${bultoKg} kg</strong> (${dispMesaKg} kg en total)`
    : `📦 <strong>Abrir ${cajasAAbrir} ${cajasAAbrir === 1 ? 'caja/bolsa' : 'cajas/bolsas'} de ${bultoKg} kg</strong>`;

  if (sobranteEnCaja < 1.0) {
    return {
      abre_caja: true,
      cajas_a_abrir: cajasAAbrir,
      bulto_kg: bultoKg,
      estado_ingrediente_html: estadoIngHtml,
      sugerencia_vaciado_html: `✓ Con esta tanda ya usás toda la caja de ${bultoKg} kg (queda en ~0 kg)`
    };
  }

  // Calcular cómo fraccionar toda la caja abierta (dispMesaKg) para no dejar la caja abierta en ingrediente
  const copia = presentacionesAll.map(p => ({ ...p, cant_vaciado: p[sugKey] || 0 }));
  let rest = sobranteEnCaja;

  // 1) Priorizar lo que va a pedir a 15 días
  for (const p of copia) {
    const meta15 = p.sug_15d || 0;
    while (p.cant_vaciado < meta15 && p.kilos_unidad <= rest + 0.2) {
      p.cant_vaciado += 1;
      rest -= p.kilos_unidad;
    }
  }

  // 2) Priorizar lo que va a pedir a 30 días (mes)
  for (const p of copia) {
    const meta30 = p.sug_30d || 0;
    while (p.cant_vaciado < meta30 && p.kilos_unidad <= rest + 0.2) {
      p.cant_vaciado += 1;
      rest -= p.kilos_unidad;
    }
  }

  // 3) Si todavía queda saldo en la caja abierta (ej: abriste caja de 10 kg o 20 kg y el mes pedía 5 kg o 15 kg),
  // completar con la presentación activa para vaciar la caja entera y no dejar ingrediente suelto
  const candidatasCierre = [...copia]
    .filter(p => !p.es_hijo && p.kilos_unidad >= 1)
    .sort((a, b) => {
      const actA = (a.sug_30d || 0) > 0 ? 1 : 0;
      const actB = (b.sug_30d || 0) > 0 ? 1 : 0;
      if (actA !== actB) return actB - actA;
      return b.kilos_unidad - a.kilos_unidad;
    });

  for (const p of candidatasCierre) {
    while (p.kilos_unidad <= rest + 0.2) {
      p.cant_vaciado += 1;
      rest -= p.kilos_unidad;
    }
  }

  const kgVaciado = parseFloat(copia.reduce((s, p) => s + p.cant_vaciado * p.kilos_unidad, 0).toFixed(1));
  let sugerenciaVaciadoHtml = null;

  if (kgVaciado > kgMin + 0.5) {
    const partes = copia
      .filter(p => p.cant_vaciado > 0)
      .map(p => `${p.cant_vaciado} ${p.cant_vaciado === 1 ? 'bolsa' : 'bolsas'} × ${etiquetaPesoPresentacion(p.kilos_unidad)}`);
    sugerenciaVaciadoHtml = `💡 <strong>Si abrís la caja de ${bultoKg} kg, para usarla toda</strong> (y no dejar caja abierta en ingrediente): hacé <strong>${partes.join(' + ')}</strong> (${kgVaciado} kg)`;
  }

  return {
    abre_caja: true,
    cajas_a_abrir: cajasAAbrir,
    bulto_kg: bultoKg,
    estado_ingrediente_html: estadoIngHtml,
    sugerencia_vaciado_html: sugerenciaVaciadoHtml
  };
}

function invalidarCachePlanDeposito() {
  cachedPlanData = null;
  cachedPlanTimestamp = 0;
}

async function obtenerPlanTrabajoDeposito(pool, options = {}) {
  const ahora = Date.now();
  if (!options.forceRefresh && cachedPlanData && (ahora - cachedPlanTimestamp) < CACHE_TTL_MS) {
    cachedPlanData.informes_hoy = verificarVigenciaInformesHoy();
    return cachedPlanData;
  }

  const [
    plan7,
    plan15,
    plan30,
    preMixesCompRes,
    ingIntermediosRes,
    prodHoyRes,
    faltantesPedidosRes
  ] = await Promise.all([
    obtenerAnalisisPlanificacionLunes({ ventanaDias: 30, diasObjetivo: 7, tandaMixKg: 10 }, pool),
    obtenerAnalisisPlanificacionLunes({ ventanaDias: 30, diasObjetivo: 15, tandaMixKg: 10 }, pool),
    obtenerAnalisisPlanificacionLunes({ ventanaDias: 30, diasObjetivo: 30, tandaMixKg: 10 }, pool),
    pool.query(`
      SELECT ic.mix_id, m.nombre AS mix_nombre, ic.ingrediente_id, i.nombre AS componente_nombre,
             ic.cantidad, i.stock_actual, COALESCE(vp.potencial_total, i.stock_actual, 0) AS disponible_total_kg
      FROM public.ingrediente_composicion ic
      JOIN public.ingredientes m ON m.id = ic.mix_id
      JOIN public.ingredientes i ON i.id = ic.ingrediente_id
      LEFT JOIN public.v_potencial_ingredientes_simples vp ON vp.ingrediente_id = ic.ingrediente_id
      WHERE ic.mix_id IN (109, 132, 134)
      ORDER BY ic.mix_id, ic.cantidad DESC
    `),
    pool.query(`
      SELECT i.id, i.nombre, COALESCE(i.stock_actual, 0) AS stock_taller_kg,
             i.articulo_vinculado_numero,
             COALESCE(src.stock_consolidado, 0) AS stock_art_vinculado
      FROM public.ingredientes i
      LEFT JOIN public.stock_real_consolidado src ON UPPER(TRIM(src.articulo_numero)) = UPPER(TRIM(i.articulo_vinculado_numero))
      WHERE i.id IN (109, 122, 123, 129, 131, 132, 134, 141, 55, 29)
    `),
    pool.query(`
      SELECT ca.id, ca.carro_id, ca.articulo_numero,
             COALESCE(NULLIF(TRIM(ba.descripcion_generada), ''), NULLIF(TRIM(ba.descripcion), ''), ca.descripcion) AS descripcion,
             ca.cantidad, COALESCE(ba.kilos_unidad, 1) AS kilos_unidad, cp.fecha_confirmacion
      FROM public.carros_articulos ca
      JOIN public.carros_produccion cp ON cp.id = ca.carro_id
      LEFT JOIN public.bunker_articulos ba ON UPPER(TRIM(ba.articulo_id)) = UPPER(TRIM(ca.articulo_numero))
      WHERE cp.fecha_confirmacion >= CURRENT_DATE
      ORDER BY cp.fecha_confirmacion DESC
    `),
    pool.query(`
      SELECT COUNT(DISTINCT p.id)::int AS pedidos_activos_count
      FROM public.presupuestos p
      WHERE p.activo = true
        AND p.estado = 'Presupuesto/Orden'
        AND p.secuencia IN ('Imprimir', 'Imprimir_Modificado', 'Armar_Pedido')
        AND p.id NOT IN (
          SELECT id_presupuesto_local FROM public.faltantes_pendientes_compra WHERE estado = 'En espera'
        )
    `)
  ]);

  const skusParaTiempos = new Set();
  [plan7, plan15, plan30].forEach(pl => {
    (pl.plan_semanal_priorizado || []).forEach(a => {
      if ((a.cantidad_sugerida || 0) > 0 || (a.packs_a_armar || 0) > 0) {
        skusParaTiempos.add(a.articulo_id);
      }
    });
  });
  ['MPB', 'MPGDSX7', 'MPGDFX6,9'].forEach(s => skusParaTiempos.add(s));

  const listaSkusTiempos = Array.from(skusParaTiempos).map(sku => ({ articulo_numero: sku, cantidad: 1 }));
  const estimacionTiemposRes = await calcularEstimacionArticulos(listaSkusTiempos, pool).catch(() => ({ articulos: [] }));
  const tiemposMap = new Map();
  (estimacionTiemposRes.articulos || []).forEach(t => {
    if (t.minutos_unitarios > 0) {
      tiemposMap.set(String(t.articulo_numero).trim().toUpperCase(), {
        minutos_unitarios: t.minutos_unitarios,
        origen: t.origen
      });
    }
  });

  const map7 = new Map();
  const map15 = new Map();
  const map30 = new Map();
  (plan7.plan_semanal_priorizado || []).forEach(a => map7.set(a.articulo_id, a));
  (plan15.plan_semanal_priorizado || []).forEach(a => map15.set(a.articulo_id, a));
  (plan30.plan_semanal_priorizado || []).forEach(a => map30.set(a.articulo_id, a));

  const mixMap7 = new Map();
  const mixMap15 = new Map();
  const mixMap30 = new Map();
  (plan7.carros_mixes_detallados || []).forEach(m => mixMap7.set(m.mix_id, m));
  (plan15.carros_mixes_detallados || []).forEach(m => mixMap15.set(m.mix_id, m));
  (plan30.carros_mixes_detallados || []).forEach(m => mixMap30.set(m.mix_id, m));

  const estaciones = [];

  // =========================================================================
  // 1. LÍNEA 3: MIXES INTERNOS (Secuencia Paso 1 Puente 10kg -> Paso 2 Fracciones)
  // =========================================================================
  for (const [mixId, m30] of mixMap30.entries()) {
    const m7 = mixMap7.get(mixId) || m30;
    const m15 = mixMap15.get(mixId) || m30;
    const apSku = m30.ap_sku || 'PUENTE';

    const presSkus = (m30.presentaciones || [])
      .filter(p => !p.es_padre && !p.articulo_id.includes('AP') && !p.articulo_id.endsWith('XK'))
      .map(p => p.articulo_id);

    const presentacionesDetalle = [];
    let kg7 = 0, kg15 = 0, kg30 = 0;
    let uds7 = 0, uds15 = 0, uds30 = 0;
    let minFracc7 = 0, minFracc15 = 0, minFracc30 = 0;
    let minCobertura = 999;
    let tieneQuiebreHoy = false;
    let tienePedidoComprometido = false;

    presSkus.forEach(sku => {
      const a7 = (m7.presentaciones || []).find(x => x.articulo_id === sku) || map7.get(sku);
      const a15 = (m15.presentaciones || []).find(x => x.articulo_id === sku) || map15.get(sku);
      const a30 = (m30.presentaciones || []).find(x => x.articulo_id === sku) || map30.get(sku);
      if (!a30) return;

      const s7 = a7 ? (a7.cantidad_sugerida || 0) : 0;
      const s15 = Math.max(s7, a15 ? (a15.cantidad_sugerida || 0) : 0);
      const s30 = Math.max(s15, a30 ? (a30.cantidad_sugerida || 0) : 0);

      if (s7 === 0 && s15 === 0 && s30 === 0) return;

      const kU = a30.kilos_unidad || 1;
      const k7 = parseFloat((s7 * kU).toFixed(1));
      const k15 = parseFloat((s15 * kU).toFixed(1));
      const k30 = parseFloat((s30 * kU).toFixed(1));

      kg7 += k7;
      kg15 += k15;
      kg30 += k30;
      uds7 += s7;
      uds15 += s15;
      uds30 += s30;

      const t7 = estimarMinutosPresentacion(sku, s7, kU, tiemposMap, false);
      const t15 = estimarMinutosPresentacion(sku, s15, kU, tiemposMap, false);
      const t30 = estimarMinutosPresentacion(sku, s30, kU, tiemposMap, false);
      minFracc7 += t7.minutos;
      minFracc15 += t15.minutos;
      minFracc30 += t30.minutos;

      const cob = a7 ? a7.dias_cobertura : a30.dias_cobertura;
      if (cob < minCobertura && (s7 > 0 || s15 > 0 || s30 > 0)) minCobertura = cob;
      if (s7 > 0 && ((a7.stock_neto_disponible !== undefined ? a7.stock_neto_disponible <= 0 : a7.stock_actual <= 0) || cob === 0)) {
        tieneQuiebreHoy = true;
      }
      if ((a7?.comprometido_presupuestos || 0) > 0 && (a7?.stock_neto_disponible || 0) < 0) {
        tienePedidoComprometido = true;
      }

      presentacionesDetalle.push({
        sku,
        descripcion: a30.descripcion,
        kilos_unidad: kU,
        etiqueta_peso: etiquetaPesoPresentacion(kU),
        es_hijo: !!a30.es_hijo,
        pack_unidades: a30.pack_unidades || null,
        pack_padre_codigo: a30.pack_padre_codigo || null,
        es_fraccion_cierre_puente: !!(a7?.es_fraccion_cierre_puente || a15?.es_fraccion_cierre_puente || a30?.es_fraccion_cierre_puente),
        stock_actual: a7 ? a7.stock_actual : a30.stock_actual,
        dias_cobertura: cob,
        sug_7d: s7,
        kg_7d: k7,
        min_7d: t7.minutos,
        sug_15d: s15,
        kg_15d: k15,
        min_15d: t15.minutos,
        sug_30d: s30,
        kg_30d: k30,
        min_30d: t30.minutos
      });
    });

    if (kg7 === 0 && kg15 === 0 && kg30 === 0) continue;

    const carroKg7 = m7.kilos_carro_sugeridos || 0;
    const carroKg15 = Math.max(carroKg7, m15.kilos_carro_sugeridos || 0);
    const carroKg30 = Math.max(carroKg15, m30.kilos_carro_sugeridos || 0);

    const tandas7 = m7.tandas_carro || 0;
    const tandas15 = Math.max(tandas7, m15.tandas_carro || 0);
    const tandas30 = Math.max(tandas15, m30.tandas_carro || 0);

    const totalMin7 = tandas7 * 12 + minFracc7;
    const totalMin15 = tandas15 * 12 + minFracc15;
    const totalMin30 = tandas30 * 12 + minFracc30;

    let horizonteActivacion = '30d';
    if (kg7 > 0) horizonteActivacion = '7d';
    else if (kg15 > 0) horizonteActivacion = '15d';

    const stockGranelKg = m7.stock_granel_taller_kg || 0;
    const factible = m7.factibilidad ? m7.factibilidad.factible : true;

    const apArt = map30.get(apSku);
    const apDesc = apArt && apArt.descripcion ? apArt.descripcion.trim() : m30.mix_nombre;

    const construirPasosMix = (hKey, tandas, carroKg, kgTot) => {
      const sugField = `sug_${hKey}`;
      const kgPuente = carroKg > 0 ? carroKg : Math.round(kgTot);
      const paso1 = `<span class="pizarra-label-paso">Artículo puente:</span> <span class="pizarra-fracc-desc">${apDesc}</span> <span class="pizarra-fracc-sku">(${apSku})</span>: <strong class="pizarra-num-relevante">${kgPuente} kg</strong>`;

      const itemsFracc = presentacionesDetalle
        .filter(p => (p[sugField] || 0) > 0)
        .map(p => formatearFraccionOperario(p, p[sugField]));

      const paso2 = itemsFracc.join(' &nbsp;·&nbsp; ');
      return { paso1, paso2, sugerencia_caja: null };
    };

    const pasosPorHorizonte = {
      '7d': construirPasosMix('7d', tandas7, carroKg7, kg7),
      '15d': construirPasosMix('15d', tandas15, carroKg15, kg15),
      '30d': construirPasosMix('30d', tandas30, carroKg30, kg30)
    };

    const pillTxt = `Receta`;

    estaciones.push({
      id: `estacion-ldn3-mix-${mixId}`,
      tipo_estacion: 'LDN3_MIX',
      ldn: 3,
      icono: '🥣',
      etiqueta_ldn: 'Mix',
      ap_sku: apSku,
      titulo: m30.mix_nombre,
      pasos_horizonte: pasosPorHorizonte,
      subtitulo_stock: stockGranelKg > 0 ? `Saldo actual en puente (${apSku}): ${stockGranelKg} kg` : '',
      horizonte_activacion: horizonteActivacion,
      urgente_hoy: tieneQuiebreHoy || tienePedidoComprometido,
      tiene_pedido_comprometido: tienePedidoComprometido,
      dias_cobertura_min: minCobertura,
      factible,
      metricas_horizonte: {
        '7d': { unidades: uds7, kilos: parseFloat(kg7.toFixed(1)), carro_kg: carroKg7, tandas_carro: tandas7, minutos: totalMin7, tiempo_formateado: formatearMinutos(totalMin7) },
        '15d': { unidades: uds15, kilos: parseFloat(kg15.toFixed(1)), carro_kg: carroKg15, tandas_carro: tandas15, minutos: totalMin15, tiempo_formateado: formatearMinutos(totalMin15) },
        '30d': { unidades: uds30, kilos: parseFloat(kg30.toFixed(1)), carro_kg: carroKg30, tandas_carro: tandas30, minutos: totalMin30, tiempo_formateado: formatearMinutos(totalMin30) }
      },
      presentaciones: presentacionesDetalle,
      mirada_consciente: {
        pill: pillTxt,
        explicacion: kg30 > kg7 + 0.5 && horizonteActivacion === '7d'
          ? `Para esta semana alcanza con ${carroKg7 || kg7} kg. Si querés aprovechar que ya armás la mesa de ingredientes para cubrir todo el mes, son ${carroKg30 || kg30} kg (${tandas30} carros de 10 kg).`
          : `Con esta tanda de ${m30.mix_nombre} dejás cubierto el mes y el artículo puente (${apSku}) en 0 kg.`,
        stock_granel_taller_kg: stockGranelKg,
        receta_pesaje: (m30.receta_pesaje || []).map(r => ({
          componente_nombre: r.componente_nombre,
          proporcion_pct: r.proporcion_pct,
          kilos_por_tanda_10kg: parseFloat((10 * (parseFloat(r.proporcion_pct) / 100)).toFixed(2)),
          stock_disponible_kg: r.stock_disponible_kg,
          alcanza: r.alcanza
        }))
      }
    });
  }

  // =========================================================================
  // MAPEO DE PRODUCCIÓN REALIZADA HOY (Para check verde ✅ y evitar re-pedir)
  // =========================================================================
  const prodHoyRows = prodHoyRes.rows || [];
  const prodHoyPorSku = new Map();
  prodHoyRows.forEach(r => {
    const skuKey = String(r.articulo_numero || '').trim().toUpperCase();
    if (!skuKey) return;
    const prev = prodHoyPorSku.get(skuKey) || { sku: r.articulo_numero, descripcion: r.descripcion, cantidad: 0, kilos_unidad: parseFloat(r.kilos_unidad) || 1 };
    prev.cantidad += (parseFloat(r.cantidad) || 0);
    prodHoyPorSku.set(skuKey, prev);
  });

  // =========================================================================
  // REGLA 1 (LÍNEA 2): EXCLUSIÓN ESTRICTA DE ABRECAJAS Y BULTOS MADRE
  // =========================================================================
  const SKUS_EXCLUIDOS_LDN2 = new Set([
    // Abrecajas (cajas subdivididas de fábrica 2x5kg que se abren en despacho)
    'NMELCHX5', 'NCECAMX5', 'NMALX5', 'NCC34/36X5', 'NCC36+X5',
    // Bultos madre cerrados / Packs directos que no pasan por fraccionamiento
    'PTSX5', 'PTSX2', 'PTS10X150G', 'PTSX150G',
    'PAX5', 'PALUX5', 'LNX5', 'SLX5', 'TSEX5', 'ADAX5', 'HAX5', 'HDAX5', 'HIOX5', 'MCR50/60X5'
  ]);

  // =========================================================================
  // 2. LÍNEA 2: FRACCIONADOS PUROS (Vaciar abierto en taller / Lote completo de bulto)
  // =========================================================================
  const gruposLdn2 = new Map();
  (plan30.lineas_de_negocio?.ldn2_fraccionados || []).forEach(art30 => {
    if (art30.es_padre) return;
    const skuUp = String(art30.articulo_id || '').trim().toUpperCase();
    if (SKUS_EXCLUIDOS_LDN2.has(skuUp)) return;
    const kU = parseFloat(art30.kilos_unidad || 1);
    const bultoKgRef = parseFloat(art30.kilos_por_bulto || 25);
    if (bultoKgRef >= 5 && kU >= bultoKgRef - 0.1) return; // Es el propio bulto madre

    const mpNombre = (art30.materia_prima_nombre && art30.materia_prima_nombre !== 'Insumo Puro')
      ? art30.materia_prima_nombre.trim()
      : (art30.familia_nombre || art30.descripcion);
    const key = art30.ingrediente_id ? `ing-${art30.ingrediente_id}` : `mp-${mpNombre.toLowerCase()}`;

    if (!gruposLdn2.has(key)) {
      gruposLdn2.set(key, {
        key,
        ingrediente_id: art30.ingrediente_id || null,
        materia_prima_nombre: mpNombre,
        stock_taller_kg: art30.stock_taller_kg || 0,
        bultos_taller: art30.bultos_taller || 0,
        bultos_deposito: art30.bultos_deposito || 0,
        total_bultos_cerrados: art30.total_bultos_cerrados || 0,
        kilos_por_bulto: art30.kilos_por_bulto || 25,
        bulto_desc: art30.bulto_desc || null,
        stock_total_materia_prima_kg: art30.stock_total_materia_prima_kg || 0,
        skus: []
      });
    }
    gruposLdn2.get(key).skus.push(art30.articulo_id);
  });

  // REGLA 2 (LÍNEA 2): Lote mínimo lógico de taller (prohibido pedir 1 bolsita suelta de reposición)
  const redondearLoteTallerLdn2 = (cantRaw, kU, abiertoKgDisp, bultoKgMadre, totalMpKg, stockActual, comprometido, fueProducidoHoy) => {
    if (cantRaw <= 0) return 0;
    const faltaParaPedido = comprometido > stockActual;
    if (!faltaParaPedido && fueProducidoHoy && stockActual > 0) return 0;
    // Si pide 1 sola unidad de bolsa chica (<=1kg) pero ya hay stock en estantería, no hay pedidos pendientes y no hay saldo abierto en taller, omitir micro-tarea
    if (!faltaParaPedido && cantRaw <= 1 && stockActual >= 1 && kU <= 1 && abiertoKgDisp < kU) return 0;

    // Prioridad A: Si hay stock abierto en taller suficiente para al menos 2 bolsas, envasar todo el contenedor abierto (hasta un tope operativo de 15 bolsas)
    if (abiertoKgDisp >= kU * 2) {
      const bolsasDeAbierto = Math.min(15, Math.floor((abiertoKgDisp + 0.05) / kU));
      if (bolsasDeAbierto >= cantRaw) return bolsasDeAbierto;
    }

    // Prioridad B: Si hay que abrir un bulto cerrado madre (ej: 25 kg, 10 kg, 5 kg), redondear al lote completo o tanda lógica
    let loteObjetivo = cantRaw;
    if (kU >= 5) {
      const bolsasPorBulto = bultoKgMadre >= 10 ? Math.max(2, Math.round(bultoKgMadre / kU)) : 3;
      loteObjetivo = Math.max(cantRaw, bolsasPorBulto); // Ej: 25kg / 5kg = 5 bolsas de 5kg
    } else if (kU >= 2) {
      loteObjetivo = Math.max(cantRaw, 5); // Ej: 5 bolsas de 2kg = 10kg (1 caja entera)
    } else if (kU >= 1) {
      const lote1kg = bultoKgMadre <= 5 ? 5 : 10; // Caja de 5kg (ej. Dátil) -> 5 u.; Caja >=10kg -> 10 u.
      loteObjetivo = Math.max(cantRaw, lote1kg);
    } else {
      loteObjetivo = Math.max(cantRaw, 10); // Presentaciones de 500g o menores -> mínimo 10 u.
    }

    // Si hay materia prima disponible pero no alcanza para el lote estándar completo (ej. 8.8 kg de Higo Turco = 4 bolsas de 2kg), ajustar al máximo factible real
    if (totalMpKg >= kU) {
      const maxFactibleMp = Math.floor((totalMpKg + 0.05) / kU);
      if (maxFactibleMp < loteObjetivo) {
        return Math.max(cantRaw, maxFactibleMp);
      }
    }
    return loteObjetivo;
  };

  for (const [, grp] of gruposLdn2.entries()) {
    const presentacionesAll = [];
    const presentacionesDetalle = [];
    let kg7 = 0, kg15 = 0, kg30 = 0;
    let uds7 = 0, uds15 = 0, uds30 = 0;
    let min7 = 0, min15 = 0, min30 = 0;
    let minCobertura = 999;
    let tieneQuiebreHoy = false;
    let tienePedidoComprometido = false;

    const abiertoKg = parseFloat((grp.stock_taller_kg || 0).toFixed(1));
    const bultoKg = parseFloat((grp.kilos_por_bulto || 25).toFixed(1));
    const totalBultos = (grp.bultos_taller || 0) + (grp.bultos_deposito || 0);
    const totalMpKg = parseFloat((grp.stock_total_materia_prima_kg || 0).toFixed(1));

    grp.skus.forEach(sku => {
      const a7 = map7.get(sku);
      const a15 = map15.get(sku);
      const a30 = map30.get(sku);
      if (!a30) return;

      const skuUp = String(sku).trim().toUpperCase();
      const fueProdHoy = prodHoyPorSku.has(skuUp);
      const kU = a30.kilos_unidad || 1;
      const stockAct = a7 ? a7.stock_actual : a30.stock_actual;
      const compAct = a7 ? (a7.comprometido_presupuestos || 0) : 0;

      let raw7 = a7 ? (a7.cantidad_sugerida || 0) : 0;
      const raw15 = Math.max(raw7, a15 ? (a15.cantidad_sugerida || 0) : 0);
      const raw30 = Math.max(raw15, a30 ? (a30.cantidad_sugerida || 0) : 0);

      // Si hay >= 10 kg abiertos en taller (ej. 15 kg de Semilla de Zapallo AA) y la presentación de 5kg pide en 15d/30d, adelantar el vaciado del tacho a Esta Semana (7d)
      if (raw7 === 0 && raw15 > 0 && abiertoKg >= Math.max(10, kU * 2) && !fueProdHoy) {
        raw7 = raw15;
      }

      const s7 = redondearLoteTallerLdn2(raw7, kU, abiertoKg, bultoKg, totalMpKg, stockAct, compAct, fueProdHoy);
      const s15 = Math.max(s7, redondearLoteTallerLdn2(raw15, kU, abiertoKg, bultoKg, totalMpKg, stockAct, compAct, false));
      const s30 = Math.max(s15, redondearLoteTallerLdn2(raw30, kU, abiertoKg, bultoKg, totalMpKg, stockAct, compAct, false));

      const k7 = parseFloat((s7 * kU).toFixed(1));
      const k15 = parseFloat((s15 * kU).toFixed(1));
      const k30 = parseFloat((s30 * kU).toFixed(1));

      const cob = a7 ? a7.dias_cobertura : a30.dias_cobertura;
      const objPres = {
        sku,
        descripcion: a30.descripcion,
        kilos_unidad: kU,
        etiqueta_peso: etiquetaPesoPresentacion(kU),
        es_hijo: !!a30.es_hijo,
        pack_unidades: a30.pack_unidades || null,
        stock_actual: stockAct,
        dias_cobertura: cob,
        sug_7d: s7, kg_7d: k7, min_7d: 0,
        sug_15d: s15, kg_15d: k15, min_15d: 0,
        sug_30d: s30, kg_30d: k30, min_30d: 0
      };
      presentacionesAll.push(objPres);

      if (s7 === 0 && s15 === 0 && s30 === 0) return;

      kg7 += k7; kg15 += k15; kg30 += k30;
      uds7 += s7; uds15 += s15; uds30 += s30;

      const t7 = estimarMinutosPresentacion(sku, s7, kU, tiemposMap, false);
      const t15 = estimarMinutosPresentacion(sku, s15, kU, tiemposMap, false);
      const t30 = estimarMinutosPresentacion(sku, s30, kU, tiemposMap, false);
      objPres.min_7d = t7.minutos;
      objPres.min_15d = t15.minutos;
      objPres.min_30d = t30.minutos;
      min7 += t7.minutos; min15 += t15.minutos; min30 += t30.minutos;

      if (cob < minCobertura) minCobertura = cob;
      if (s7 > 0 && ((a7?.stock_neto_disponible !== undefined ? a7.stock_neto_disponible <= 0 : stockAct <= 0) || cob === 0)) {
        tieneQuiebreHoy = true;
      }
      if (compAct > 0 && (a7?.stock_neto_disponible || 0) < 0) {
        tienePedidoComprometido = true;
      }

      presentacionesDetalle.push(objPres);
    });

    if (kg7 === 0 && kg15 === 0 && kg30 === 0) continue;

    let horizonteActivacion = '30d';
    if (kg7 > 0) horizonteActivacion = '7d';
    else if (kg15 > 0) horizonteActivacion = '15d';

    const kgObjetivoActivo = horizonteActivacion === '7d' ? kg7 : (horizonteActivacion === '15d' ? kg15 : kg30);
    const factible = grp.stock_total_materia_prima_kg >= kgObjetivoActivo || abiertoKg >= kgObjetivoActivo;

    const construirPasosLdn2 = (hKey) => {
      const sugField = `sug_${hKey}`;
      const itemsFracc = presentacionesDetalle
        .filter(p => (p[sugField] || 0) > 0)
        .map(p => formatearFraccionOperario(p, p[sugField]));

      return {
        paso1: '',
        paso2: itemsFracc.join(' &nbsp;·&nbsp; '),
        sugerencia_caja: null
      };
    };

    const pasosPorHorizonte = {
      '7d': construirPasosLdn2('7d'),
      '15d': construirPasosLdn2('15d'),
      '30d': construirPasosLdn2('30d')
    };

    const pillTxt = `Detalle`;

    estaciones.push({
      id: `estacion-ldn2-${grp.key}`,
      tipo_estacion: 'LDN2_PURO',
      ldn: 2,
      icono: '📦',
      etiqueta_ldn: 'Fraccionado',
      titulo: grp.materia_prima_nombre,
      pasos_horizonte: pasosPorHorizonte,
      subtitulo_stock: '',
      horizonte_activacion: horizonteActivacion,
      urgente_hoy: tieneQuiebreHoy || tienePedidoComprometido,
      tiene_pedido_comprometido: tienePedidoComprometido,
      dias_cobertura_min: minCobertura,
      factible,
      metricas_horizonte: {
        '7d': { unidades: uds7, kilos: parseFloat(kg7.toFixed(1)), minutos: min7, tiempo_formateado: formatearMinutos(min7) },
        '15d': { unidades: uds15, kilos: parseFloat(kg15.toFixed(1)), minutos: min15, tiempo_formateado: formatearMinutos(min15) },
        '30d': { unidades: uds30, kilos: parseFloat(kg30.toFixed(1)), minutos: min30, tiempo_formateado: formatearMinutos(min30) }
      },
      presentaciones: presentacionesDetalle,
      mirada_consciente: {
        pill: pillTxt,
        explicacion: `Bulto cerrado de ${bultoKg} kg (${abiertoKg} kg abiertos en taller).`,
        stock_taller_kg: abiertoKg,
        kilos_por_bulto: bultoKg
      }
    });
  }

  // =========================================================================
  // 3. MEZCLAS PRE-PESADAS Y TAREAS LOCALES DE LÍNEAS 4, 5 Y 6
  // =========================================================================
  const ingIntermediosMap = new Map();
  (ingIntermediosRes.rows || []).forEach(r => {
    ingIntermediosMap.set(Number(r.id), {
      id: Number(r.id),
      nombre: r.nombre,
      stock_taller_kg: parseFloat(r.stock_taller_kg || 0),
      stock_art_vinculado: parseFloat(r.stock_art_vinculado || 0),
      total_disp_kg: parseFloat(r.stock_taller_kg || 0) + parseFloat(r.stock_art_vinculado || 0)
    });
  });

  const preMixRecetasMap = new Map();
  (preMixesCompRes.rows || []).forEach(r => {
    const mId = Number(r.mix_id);
    if (!preMixRecetasMap.has(mId)) preMixRecetasMap.set(mId, []);
    preMixRecetasMap.get(mId).push({
      componente_nombre: r.componente_nombre,
      kilos_por_tanda: parseFloat(parseFloat(r.cantidad || 0).toFixed(2)),
      stock_disponible_kg: parseFloat(parseFloat(r.disponible_total_kg || 0).toFixed(1)),
      alcanza: parseFloat(r.disponible_total_kg || 0) >= parseFloat(r.cantidad || 0)
    });
  });

  // 3.A) LÍNEA 6: GRANOLA SOL y GRANOLA FLOR (Pre-Mezclas Crudas MPGDSX7 / MPGDFX6,9 + Fracciones)
  const granolasLineas = [
    {
      key: 'grana-sol',
      nombre: 'Granola del Sol',
      skus: ['GSX500G', 'GSX1', 'GSX200G'],
      ing_final_id: 131,
      ing_base_up_id: 123,
      premix_sku: 'MPGDSX7',
      premix_desc: 'Mezcla GRANA Sol x 7kg',
      premix_nombre: 'Mezcla GRANA Sol x 7kg (MPGDSX7)',
      premix_mix_id: 132,
      premix_kilos: 7.0,
      target_premix_7d: 2,
      target_premix_15d: 3,
      target_premix_30d: 4,
      agregados_secos_nota: 'Por cada 1 kg de base horneada sumar 125g de Coco en Escamas + 125g de Pasa de Uva Rubia.'
    },
    {
      key: 'grana-flor',
      nombre: 'Granola de la Flor',
      skus: ['GDFX500G', 'GDFX1', 'GDFX200G'],
      ing_final_id: 122,
      ing_base_up_id: 129,
      premix_sku: 'MPGDFX6,9',
      premix_desc: 'Mezcla GRANA Flor x 6.9kg',
      premix_nombre: 'Mezcla GRANA Flor x 6.9kg (MPGDFX6,9)',
      premix_mix_id: 134,
      premix_kilos: 6.9,
      target_premix_7d: 3,
      target_premix_15d: 3,
      target_premix_30d: 4,
      agregados_secos_nota: 'Combinar base horneada con agregado seco antes de fraccionar.'
    }
  ];

  granolasLineas.forEach(gCfg => {
    const presentacionesDetalle = [];
    let kg7 = 0, kg15 = 0, kg30 = 0;
    let uds7 = 0, uds15 = 0, uds30 = 0;
    let min7 = 0, min15 = 0, min30 = 0;
    let minCobertura = 999;
    let tieneQuiebreHoy = false;

    const ingFinal = ingIntermediosMap.get(gCfg.ing_final_id);
    const ingBaseUp = ingIntermediosMap.get(gCfg.ing_base_up_id);
    const artPremix = map30.get(gCfg.premix_sku);
    const stockPremixUnidades = artPremix ? (artPremix.stock_actual || 0) : 0;
    // Solo contar como base horneada disponible para fraccionar lo que está en el ingrediente de taller a granel (no las bolsas de 1kg ya envasadas)
    const stockBaseDisponibleKg = parseFloat(((ingFinal?.stock_taller_kg || 0) + (ingBaseUp?.stock_taller_kg || 0)).toFixed(1));

    // REGLA 4: Incluir explícitamente las Pre-Mezclas Crudas (MPGDSX7 / MPGDFX6,9) cuando el stock de pre-mezcla es bajo (< target)
    const premixReq7 = Math.max(0, gCfg.target_premix_7d - stockPremixUnidades);
    const premixReq15 = Math.max(premixReq7, gCfg.target_premix_15d - stockPremixUnidades);
    const premixReq30 = Math.max(premixReq15, gCfg.target_premix_30d - stockPremixUnidades);

    if (premixReq7 > 0 || premixReq15 > 0 || premixReq30 > 0) {
      const kP7 = parseFloat((premixReq7 * gCfg.premix_kilos).toFixed(1));
      const kP15 = parseFloat((premixReq15 * gCfg.premix_kilos).toFixed(1));
      const kP30 = parseFloat((premixReq30 * gCfg.premix_kilos).toFixed(1));
      const mP7 = premixReq7 * 14;
      const mP15 = premixReq15 * 14;
      const mP30 = premixReq30 * 14;

      kg7 += kP7; kg15 += kP15; kg30 += kP30;
      uds7 += premixReq7; uds15 += premixReq15; uds30 += premixReq30;
      min7 += mP7; min15 += mP15; min30 += mP30;
      if (stockPremixUnidades <= 0) {
        tieneQuiebreHoy = true;
        minCobertura = 0;
      } else {
        minCobertura = Math.min(minCobertura, 3);
      }

      presentacionesDetalle.push({
        sku: gCfg.premix_sku,
        descripcion: gCfg.premix_desc,
        kilos_unidad: gCfg.premix_kilos,
        etiqueta_peso: `${gCfg.premix_kilos} kg`,
        es_hijo: false,
        pack_unidades: null,
        stock_actual: stockPremixUnidades,
        dias_cobertura: stockPremixUnidades <= 0 ? 0 : 3,
        sug_7d: premixReq7, kg_7d: kP7, min_7d: mP7,
        sug_15d: premixReq15, kg_15d: kP15, min_15d: mP15,
        sug_30d: premixReq30, kg_30d: kP30, min_30d: mP30
      });
    }

    gCfg.skus.forEach(sku => {
      const a7 = map7.get(sku);
      const a15 = map15.get(sku);
      const a30 = map30.get(sku);
      if (!a30) return;

      // Si hoy hay que armar la pre-mezcla cruda para enviar al horno (premixReq7 > 0, demora ~2,5 a 3 días en UP),
      // no pedir en simultáneo el fraccionamiento de bolsas finales hoy: se agenda en 15d cuando regresa horneada.
      const s7Raw = a7 ? (a7.cantidad_sugerida || 0) : 0;
      const s7 = (premixReq7 === 0 && stockBaseDisponibleKg >= 5.0) ? s7Raw : 0;
      const s15 = Math.max(s7, s7Raw, a15 ? (a15.cantidad_sugerida || 0) : 0);
      const s30 = Math.max(s15, a30 ? (a30.cantidad_sugerida || 0) : 0);
      if (s7 === 0 && s15 === 0 && s30 === 0) return;

      const kU = a30.kilos_unidad || 1;
      const k7 = parseFloat((s7 * kU).toFixed(1));
      const k15 = parseFloat((s15 * kU).toFixed(1));
      const k30 = parseFloat((s30 * kU).toFixed(1));

      kg7 += k7; kg15 += k15; kg30 += k30;
      uds7 += s7; uds15 += s15; uds30 += s30;

      const t7 = estimarMinutosPresentacion(sku, s7, kU, tiemposMap, false);
      const t15 = estimarMinutosPresentacion(sku, s15, kU, tiemposMap, false);
      const t30 = estimarMinutosPresentacion(sku, s30, kU, tiemposMap, false);
      min7 += t7.minutos; min15 += t15.minutos; min30 += t30.minutos;

      const cob = a7 ? a7.dias_cobertura : a30.dias_cobertura;
      if (cob < minCobertura) minCobertura = cob;
      if (s7 > 0 && cob === 0) tieneQuiebreHoy = true;

      presentacionesDetalle.push({
        sku,
        descripcion: a30.descripcion,
        kilos_unidad: kU,
        etiqueta_peso: etiquetaPesoPresentacion(kU),
        es_hijo: !!a30.es_hijo,
        pack_unidades: a30.pack_unidades || null,
        stock_actual: a7 ? a7.stock_actual : a30.stock_actual,
        dias_cobertura: cob,
        sug_7d: s7, kg_7d: k7, min_7d: t7.minutos,
        sug_15d: s15, kg_15d: k15, min_15d: t15.minutos,
        sug_30d: s30, kg_30d: k30, min_30d: t30.minutos
      });
    });

    if (kg7 === 0 && kg15 === 0 && kg30 === 0) return;

    let horizonteActivacion = '30d';
    if (kg7 > 0) horizonteActivacion = '7d';
    else if (kg15 > 0) horizonteActivacion = '15d';

    const construirPasosGranola = (hKey) => {
      const sugField = `sug_${hKey}`;
      const itemsFracc = presentacionesDetalle
        .filter(p => (p[sugField] || 0) > 0)
        .map(p => formatearFraccionOperario(p, p[sugField]));
      return {
        paso1: '',
        paso2: itemsFracc.join(' &nbsp;·&nbsp; '),
        sugerencia_caja: null
      };
    };

    estaciones.push({
      id: `estacion-ldn6-${gCfg.key}`,
      tipo_estacion: 'LDN6_GRANOLA_DEPOSITO',
      ldn: 6,
      icono: '🍯',
      etiqueta_ldn: 'Granola',
      titulo: gCfg.nombre,
      pasos_horizonte: {
        '7d': construirPasosGranola('7d'),
        '15d': construirPasosGranola('15d'),
        '30d': construirPasosGranola('30d')
      },
      subtitulo_stock: '',
      horizonte_activacion: horizonteActivacion,
      urgente_hoy: tieneQuiebreHoy,
      tiene_pedido_comprometido: false,
      dias_cobertura_min: minCobertura,
      factible: true,
      metricas_horizonte: {
        '7d': { unidades: uds7, kilos: parseFloat(kg7.toFixed(1)), minutos: min7, tiempo_formateado: formatearMinutos(min7) },
        '15d': { unidades: uds15, kilos: parseFloat(kg15.toFixed(1)), minutos: min15, tiempo_formateado: formatearMinutos(min15) },
        '30d': { unidades: uds30, kilos: parseFloat(kg30.toFixed(1)), minutos: min30, tiempo_formateado: formatearMinutos(min30) }
      },
      presentaciones: presentacionesDetalle,
      mirada_consciente: {
        pill: `Receta`,
        explicacion: `${gCfg.agregados_secos_nota} Cada bolsa de Pre-Mezcla Cruda (${gCfg.premix_nombre}) tiene un peso fijo de ${gCfg.premix_kilos} kg.`,
        premix_sku: gCfg.premix_sku,
        premix_nombre: gCfg.premix_nombre,
        premix_stock_unidades: stockPremixUnidades,
        receta_pesaje: (preMixRecetasMap.get(gCfg.premix_mix_id) || []).map(r => ({
          componente_nombre: r.componente_nombre,
          proporcion_pct: ((r.kilos_por_tanda / gCfg.premix_kilos) * 100).toFixed(1),
          kilos_por_tanda_10kg: r.kilos_por_tanda,
          etiqueta_peso: `${r.kilos_por_tanda} kg / bolsa`,
          stock_disponible_kg: r.stock_disponible_kg,
          alcanza: r.alcanza
        }))
      }
    });
  });

  // 3.B) LÍNEA 5: MEZCLA BARRA FLOR (MPB — bolsas de 4 kg fijos) + Encajado BF24X50
  const bf7 = map7.get('BF24X50');
  const bf15 = map15.get('BF24X50');
  const bf30 = map30.get('BF24X50');
  if (bf30) {
    const mpbArt = map30.get('MPB');
    const stockMpb = mpbArt ? (mpbArt.stock_actual || 0) : 0;
    const barritaIng = ingIntermediosMap.get(141);
    const stockBarritasSueltasKg = barritaIng ? barritaIng.total_disp_kg : 0;

    const s7Raw = bf7 ? (bf7.cantidad_sugerida || 0) : 0;
    // Si no hay barritas sueltas horneadas en taller (< 1.2 kg), en 7d se arma la pre-mezcla MPB para enviar a UP
    const s7 = stockBarritasSueltasKg >= 1.2 ? s7Raw : 0;
    const s15 = Math.max(s7, s7Raw, bf15 ? (bf15.cantidad_sugerida || 0) : 0);
    const s30 = Math.max(s15, bf30 ? (bf30.cantidad_sugerida || 0) : 0);

    const kU = bf30.kilos_unidad || 1.2;
    const k7 = parseFloat((s7 * kU).toFixed(1));
    const k15 = parseFloat((s15 * kU).toFixed(1));
    const k30 = parseFloat((s30 * kU).toFixed(1));

    // REGLA 4: Considerar el lead time de la UP externa de Barritas y los pedidos comprometidos de BF24X50:
    // Si stockMpb < 4 (hoy está en 0 u.) o el stock neto de BF24X50 es <= 3 cajas, pedir armar 4 bolsas de MPB (16 kg) en Esta Semana (7d)
    const stockNetoBf = bf7?.stock_neto_disponible !== undefined ? bf7.stock_neto_disponible : bf30.stock_actual;
    const calcMpb7 = k7 > stockBarritasSueltasKg ? Math.max(0, Math.ceil((k7 - stockBarritasSueltasKg) / 3.6) - stockMpb) : 0;
    const calcMpb15 = k15 > stockBarritasSueltasKg ? Math.max(0, Math.ceil((k15 - stockBarritasSueltasKg) / 3.6) - stockMpb) : 0;
    const calcMpb30 = k30 > stockBarritasSueltasKg ? Math.max(0, Math.ceil((k30 - stockBarritasSueltasKg) / 3.6) - stockMpb) : 0;

    const mpbReq7 = stockMpb < 4 ? Math.max(4 - stockMpb, calcMpb7) : calcMpb7;
    const mpbReq15 = Math.max(mpbReq7, stockMpb < 5 ? (5 - stockMpb) : 0, calcMpb15);
    const mpbReq30 = Math.max(mpbReq15, calcMpb30);

    if (mpbReq7 > 0 || mpbReq15 > 0 || mpbReq30 > 0 || s7 > 0 || s15 > 0 || s30 > 0) {
      const min7 = (mpbReq7 * 12) + (s7 * 3);
      const min15 = (mpbReq15 * 12) + (s15 * 3);
      const min30 = (mpbReq30 * 12) + (s30 * 3);

      let horizonteActivacion = '30d';
      if (mpbReq7 > 0 || s7 > 0) horizonteActivacion = '7d';
      else if (mpbReq15 > 0 || s15 > 0) horizonteActivacion = '15d';

      const cob = stockMpb <= 0 ? 0 : (bf7 ? bf7.dias_cobertura : bf30.dias_cobertura);

      const construirPasosBarrita = (bolsasMpb, cajasBf) => {
        const partes = [];
        if (bolsasMpb > 0) {
          partes.push(`<span class="pizarra-fracc-item"><span class="pizarra-fracc-desc">Mezcla BARRA Flor x 4kg</span> <span class="pizarra-fracc-sku">(MPB)</span>: <strong class="pizarra-num-relevante">${bolsasMpb} u.</strong></span>`);
        }
        if (cajasBf > 0) {
          partes.push(`<span class="pizarra-fracc-item"><span class="pizarra-fracc-desc">BARRA DE CEREAL DE LA FLOR 24 X 50G</span> <span class="pizarra-fracc-sku">(BF24X50)</span>: <strong class="pizarra-num-relevante">${cajasBf} u.</strong></span>`);
        }
        return {
          paso1: '',
          paso2: partes.join(' &nbsp;·&nbsp; '),
          sugerencia_caja: null
        };
      };

      estaciones.push({
        id: `estacion-ldn5-barritas`,
        tipo_estacion: 'LDN5_BARRITAS_DEPOSITO',
        ldn: 5,
        icono: '🍫',
        etiqueta_ldn: 'Pre-Mezcla 4 kg',
        titulo: `Mezcla Barra Flor x 4 kg`,
        pasos_horizonte: {
          '7d': construirPasosBarrita(mpbReq7, s7),
          '15d': construirPasosBarrita(mpbReq15, s15),
          '30d': construirPasosBarrita(mpbReq30, s30)
        },
        subtitulo_stock: '',
        horizonte_activacion: horizonteActivacion,
        urgente_hoy: mpbReq7 > 0 && stockMpb === 0,
        tiene_pedido_comprometido: (bf7?.comprometido_presupuestos || 0) > 0,
        dias_cobertura_min: cob,
        factible: true,
        metricas_horizonte: {
          '7d': { unidades: mpbReq7 + s7, kilos: parseFloat((mpbReq7 * 4 + k7).toFixed(1)), carro_kg: mpbReq7 * 4, tandas_carro: mpbReq7, minutos: min7, tiempo_formateado: formatearMinutos(min7) },
          '15d': { unidades: mpbReq15 + s15, kilos: parseFloat((mpbReq15 * 4 + k15).toFixed(1)), carro_kg: mpbReq15 * 4, tandas_carro: mpbReq15, minutos: min15, tiempo_formateado: formatearMinutos(min15) },
          '30d': { unidades: mpbReq30 + s30, kilos: parseFloat((mpbReq30 * 4 + k30).toFixed(1)), carro_kg: mpbReq30 * 4, tandas_carro: mpbReq30, minutos: min30, tiempo_formateado: formatearMinutos(min30) }
        },
        presentaciones: [
          {
            sku: 'MPB',
            descripcion: 'MEZCLA PARA BARRA DE CEREAL DE LA FLOR X 4 KG',
            kilos_unidad: 4.0,
            etiqueta_peso: '4 kg',
            stock_actual: stockMpb,
            dias_cobertura: cob,
            sug_7d: mpbReq7, kg_7d: mpbReq7 * 4, min_7d: mpbReq7 * 12,
            sug_15d: mpbReq15, kg_15d: mpbReq15 * 4, min_15d: mpbReq15 * 12,
            sug_30d: mpbReq30, kg_30d: mpbReq30 * 4, min_30d: mpbReq30 * 12
          },
          {
            sku: 'BF24X50',
            descripcion: 'BARRA DE CEREAL DE LA FLOR 24 X 50G',
            kilos_unidad: kU,
            etiqueta_peso: '1.2 kg',
            stock_actual: bf30.stock_actual,
            dias_cobertura: bf7 ? bf7.dias_cobertura : bf30.dias_cobertura,
            sug_7d: s7, kg_7d: k7, min_7d: s7 * 3,
            sug_15d: s15, kg_15d: k15, min_15d: s15 * 3,
            sug_30d: s30, kg_30d: k30, min_30d: s30 * 3
          }
        ],
        mirada_consciente: {
          pill: `Receta`,
          explicacion: `Cada bolsa de Mezcla BARRA Flor (MPB) tiene un peso fijo de 4 kg.`,
          premix_sku: 'MPB',
          premix_nombre: 'Mezcla BARRA Flor x 4 kg (MPB)',
          premix_stock_unidades: stockMpb,
          receta_pesaje: (preMixRecetasMap.get(109) || []).map(r => ({
            componente_nombre: r.componente_nombre,
            proporcion_pct: ((r.kilos_por_tanda / 4.0) * 100).toFixed(1),
            kilos_por_tanda_10kg: r.kilos_por_tanda,
            etiqueta_peso: `${r.kilos_por_tanda} kg / bolsa`,
            stock_disponible_kg: r.stock_disponible_kg,
            alcanza: r.alcanza
          }))
        }
      });
    }
  }

  // 3.C) LÍNEA 4: TOSTADOS EN DEPÓSITO
  const gruposLdn4 = new Map();
  (plan30.lineas_de_negocio?.ldn4_tostaderos || []).forEach(art30 => {
    if (art30.es_padre || art30.articulo_id.includes('UP') || art30.articulo_id.startsWith('EMB-')) return;
    const key = art30.ingrediente_tostado_id ? `tost-${art30.ingrediente_tostado_id}` : `tost-${art30.articulo_id}`;
    if (!gruposLdn4.has(key)) {
      gruposLdn4.set(key, {
        key,
        ingrediente_tostado_id: art30.ingrediente_tostado_id,
        tostado_nombre: art30.ingrediente_tostado_nombre || art30.descripcion,
        stock_tostado_taller_kg: art30.stock_tostado_taller_kg || 0,
        crudo_nombre: art30.materia_prima_nombre || 'Materia Prima Cruda',
        crudo_sku: art30.materia_prima_cruda_codigo,
        stock_crudo_disponible_kg: art30.stock_crudo_disponible_kg || 0,
        skus: []
      });
    }
    gruposLdn4.get(key).skus.push(art30.articulo_id);
  });

  for (const [, grp] of gruposLdn4.entries()) {
    const presentacionesDetalle = [];
    let kg7 = 0, kg15 = 0, kg30 = 0;
    let uds7 = 0, uds15 = 0, uds30 = 0;
    let min7 = 0, min15 = 0, min30 = 0;
    let minCobertura = 999;
    let tieneQuiebreHoy = false;

    grp.skus.forEach(sku => {
      const a7 = map7.get(sku);
      const a15 = map15.get(sku);
      const a30 = map30.get(sku);
      if (!a30) return;

      const kU = a30.kilos_unidad || 1;
      const stockAct4 = a7 ? a7.stock_actual : a30.stock_actual;
      const s7Raw4 = a7 ? (a7.cantidad_sugerida || 0) : 0;
      const loteMin4 = kU <= 1 ? 5 : (kU <= 2 ? 5 : 3);
      const s7 = (s7Raw4 <= 1 && stockAct4 >= 1 && kU <= 1) ? 0 : (s7Raw4 > 0 ? Math.max(s7Raw4, loteMin4) : 0);
      const s15 = Math.max(s7, (a15?.cantidad_sugerida || 0) > 0 ? Math.max(a15.cantidad_sugerida, loteMin4) : 0);
      const s30 = Math.max(s15, (a30?.cantidad_sugerida || 0) > 0 ? Math.max(a30.cantidad_sugerida, loteMin4) : 0);
      if (s7 === 0 && s15 === 0 && s30 === 0) return;
      const k7 = parseFloat((s7 * kU).toFixed(1));
      const k15 = parseFloat((s15 * kU).toFixed(1));
      const k30 = parseFloat((s30 * kU).toFixed(1));

      kg7 += k7; kg15 += k15; kg30 += k30;
      uds7 += s7; uds15 += s15; uds30 += s30;

      const t7 = estimarMinutosPresentacion(sku, s7, kU, tiemposMap, false);
      const t15 = estimarMinutosPresentacion(sku, s15, kU, tiemposMap, false);
      const t30 = estimarMinutosPresentacion(sku, s30, kU, tiemposMap, false);
      min7 += t7.minutos; min15 += t15.minutos; min30 += t30.minutos;

      const cob = a7 ? a7.dias_cobertura : a30.dias_cobertura;
      if (cob < minCobertura) minCobertura = cob;
      if (s7 > 0 && cob === 0) tieneQuiebreHoy = true;

      presentacionesDetalle.push({
        sku,
        descripcion: a30.descripcion,
        kilos_unidad: kU,
        etiqueta_peso: etiquetaPesoPresentacion(kU),
        es_hijo: !!a30.es_hijo,
        pack_unidades: a30.pack_unidades || null,
        stock_actual: a7 ? a7.stock_actual : a30.stock_actual,
        dias_cobertura: cob,
        sug_7d: s7, kg_7d: k7, min_7d: t7.minutos,
        sug_15d: s15, kg_15d: k15, min_15d: t15.minutos,
        sug_30d: s30, kg_30d: k30, min_30d: t30.minutos
      });
    });

    if (kg7 === 0 && kg15 === 0 && kg30 === 0) continue;

    let horizonteActivacion = '30d';
    if (kg7 > 0) horizonteActivacion = '7d';
    else if (kg15 > 0) horizonteActivacion = '15d';

    const kgReqActivo = horizonteActivacion === '7d' ? kg7 : (horizonteActivacion === '15d' ? kg15 : kg30);
    const tostadoEnTallerAlcanza = grp.stock_tostado_taller_kg >= kgReqActivo;

    const construirPasosLdn4 = (hKey) => {
      const sugField = `sug_${hKey}`;
      const itemsFracc = presentacionesDetalle
        .filter(p => (p[sugField] || 0) > 0)
        .map(p => formatearFraccionOperario(p, p[sugField]));
      return {
        paso1: '',
        paso2: itemsFracc.join(' &nbsp;·&nbsp; '),
        sugerencia_caja: null
      };
    };

    estaciones.push({
      id: `estacion-ldn4-${grp.key}`,
      tipo_estacion: 'LDN4_TOSTADERO_DEPOSITO',
      ldn: 4,
      icono: tostadoEnTallerAlcanza ? '🥜' : '🚚',
      etiqueta_ldn: tostadoEnTallerAlcanza ? 'Fraccionado' : 'Separar p/ Tostar',
      titulo: grp.tostado_nombre.trim(),
      pasos_horizonte: {
        '7d': construirPasosLdn4('7d'),
        '15d': construirPasosLdn4('15d'),
        '30d': construirPasosLdn4('30d')
      },
      subtitulo_stock: '',
      horizonte_activacion: horizonteActivacion,
      urgente_hoy: tieneQuiebreHoy && tostadoEnTallerAlcanza,
      tiene_pedido_comprometido: false,
      dias_cobertura_min: minCobertura,
      factible: tostadoEnTallerAlcanza || grp.stock_crudo_disponible_kg >= kgReqActivo,
      requiere_paso_up_previo: !tostadoEnTallerAlcanza,
      metricas_horizonte: {
        '7d': { unidades: uds7, kilos: parseFloat(kg7.toFixed(1)), minutos: min7, tiempo_formateado: formatearMinutos(min7) },
        '15d': { unidades: uds15, kilos: parseFloat(kg15.toFixed(1)), minutos: min15, tiempo_formateado: formatearMinutos(min15) },
        '30d': { unidades: uds30, kilos: parseFloat(kg30.toFixed(1)), minutos: min30, tiempo_formateado: formatearMinutos(min30) }
      },
      presentaciones: presentacionesDetalle,
      mirada_consciente: {
        pill: `Detalle`,
        explicacion: tostadoEnTallerAlcanza
          ? `Ya hay ${grp.stock_tostado_taller_kg} kg tostados en taller listos para fraccionar.`
          : `Separar crudo (${grp.crudo_nombre}) en depósito para enviar a tostar y fraccionar al recibir.`
      }
    });
  }

  const ordenarEstaciones = (a, b) => {
    if (!!a.completada_hoy !== !!b.completada_hoy) return a.completada_hoy ? 1 : -1;
    const listaEnTallerA = (a.factible && !a.requiere_paso_up_previo) ? 1 : 0;
    const listaEnTallerB = (b.factible && !b.requiere_paso_up_previo) ? 1 : 0;
    if (listaEnTallerA !== listaEnTallerB) return listaEnTallerB - listaEnTallerA;
    if (a.urgente_hoy !== b.urgente_hoy) return a.urgente_hoy ? -1 : 1;
    if (a.dias_cobertura_min !== b.dias_cobertura_min) return a.dias_cobertura_min - b.dias_cobertura_min;
    const h = a.horizonte_activacion;
    return (b.metricas_horizonte[h]?.kilos || 0) - (a.metricas_horizonte[h]?.kilos || 0);
  };

  // =========================================================================
  // 4. ESTACIONES YA PRODUCIDAS HOY (Check verde ✅ en la Pizarra)
  // =========================================================================
  const estacionesCompletadasHoy = [];
  const skusHoyUsados = new Set();

  // 4.A) Verificar si algún Mix de Línea 3 se produjo hoy
  for (const [mixId, m30] of mixMap30.entries()) {
    const apSku = String(m30.ap_sku || '').trim().toUpperCase();
    const prodAp = prodHoyPorSku.get(apSku);
    const hijasHoy = [];
    (m30.presentaciones || []).forEach(p => {
      const sKey = String(p.articulo_id || '').trim().toUpperCase();
      if (sKey === apSku) return;
      const pHoy = prodHoyPorSku.get(sKey);
      if (pHoy && pHoy.cantidad > 0) {
        skusHoyUsados.add(sKey);
        hijasHoy.push({
          sku: p.articulo_id,
          descripcion: p.descripcion,
          kilos_unidad: p.kilos_unidad || 1,
          es_hijo: !!p.es_hijo,
          pack_unidades: p.pack_unidades || null,
          stock_actual: p.stock_actual || 0,
          cant_hoy: pHoy.cantidad
        });
      }
    });
    if (prodAp) skusHoyUsados.add(apSku);
    if (prodAp || hijasHoy.length > 0) {
      const kgApHoy = prodAp ? Math.round(prodAp.cantidad) : Math.round(hijasHoy.reduce((s, h) => s + h.cant_hoy * h.kilos_unidad, 0));
      const paso1 = `<span class="pizarra-label-paso">Artículo puente</span> <span class="pizarra-fracc-sku">(${m30.ap_sku})</span> <strong class="pizarra-num-relevante">${kgApHoy} kg</strong>`;
      const itemsFracc = hijasHoy.map(h => formatearFraccionOperario(h, h.cant_hoy));
      const paso2 = itemsFracc.length > 0 ? `<span class="pizarra-label-paso">Fracciones:</span> ${itemsFracc.join(' &nbsp;·&nbsp; ')}` : '';
      estacionesCompletadasHoy.push({
        id: `estacion-hoy-mix-${mixId}`,
        tipo_estacion: 'HOY_COMPLETADA',
        completada_hoy: true,
        ldn: 3,
        titulo: m30.mix_nombre,
        pasos_horizonte: {
          '7d': { paso1, paso2 },
          '15d': { paso1, paso2 },
          '30d': { paso1, paso2 }
        },
        horizonte_activacion: '7d',
        factible: true,
        metricas_horizonte: {
          '7d': { unidades: hijasHoy.reduce((s, h) => s + h.cant_hoy, 0), kilos: kgApHoy, minutos: 0, tiempo_formateado: 'Completado hoy' }
        },
        presentaciones: hijasHoy.map(h => ({
          sku: h.sku,
          descripcion: h.descripcion,
          kilos_unidad: h.kilos_unidad,
          es_hijo: h.es_hijo,
          pack_unidades: h.pack_unidades,
          stock_actual: h.stock_actual,
          sug_7d: h.cant_hoy,
          sug_15d: 0,
          sug_30d: 0
        })),
        mirada_consciente: { pill: 'Detalle', receta_pesaje: [] }
      });
    }
  }

  // 4.B) Resto de artículos producidos hoy en Línea 2 y Línea 4/5/6 (agrupados por insumo/título)
  const hoyGruposMap = new Map();
  for (const [skuKey, pHoy] of prodHoyPorSku.entries()) {
    if (skusHoyUsados.has(skuKey)) continue;
    if (skuKey.endsWith('UP') || skuKey.endsWith('XK')) continue;
    const art30 = map30.get(pHoy.sku) || Array.from(map30.values()).find(x => String(x.articulo_id).trim().toUpperCase() === skuKey);
    const ldnHoy = art30 && [2, 3, 4, 5, 6].includes(art30.ldn) ? art30.ldn : 2;
    const objPres = {
      sku: pHoy.sku,
      descripcion: art30?.descripcion || pHoy.descripcion || pHoy.sku,
      kilos_unidad: art30?.kilos_unidad || pHoy.kilos_unidad || 1,
      es_hijo: !!art30?.es_hijo,
      pack_unidades: art30?.pack_unidades || null,
      stock_actual: art30 ? art30.stock_actual : pHoy.cantidad,
      sug_7d: pHoy.cantidad,
      sug_15d: 0,
      sug_30d: 0
    };
    const tituloGrupo = (art30?.materia_prima_nombre && art30.materia_prima_nombre !== 'Insumo Puro')
      ? art30.materia_prima_nombre
      : (art30?.ingrediente_tostado_nombre || objPres.descripcion);
    const gKey = `${ldnHoy}-${tituloGrupo.toLowerCase()}`;
    if (!hoyGruposMap.has(gKey)) {
      hoyGruposMap.set(gKey, {
        gKey,
        ldn: ldnHoy,
        titulo: tituloGrupo,
        items: []
      });
    }
    hoyGruposMap.get(gKey).items.push(objPres);
  }

  for (const [, gHoy] of hoyGruposMap.entries()) {
    const paso2 = `<span class="pizarra-label-paso">Fraccionado hoy:</span> ${gHoy.items.map(it => formatearFraccionOperario(it, it.sug_7d)).join(' &nbsp;·&nbsp; ')}`;
    const totUds = gHoy.items.reduce((s, it) => s + it.sug_7d, 0);
    const totKg = parseFloat(gHoy.items.reduce((s, it) => s + it.sug_7d * it.kilos_unidad, 0).toFixed(1));
    estacionesCompletadasHoy.push({
      id: `estacion-hoy-grp-${gHoy.gKey.replace(/[^a-z0-9]/gi, '-')}`,
      tipo_estacion: 'HOY_COMPLETADA',
      completada_hoy: true,
      ldn: gHoy.ldn,
      titulo: gHoy.titulo,
      pasos_horizonte: {
        '7d': { paso1: '', paso2 },
        '15d': { paso1: '', paso2 },
        '30d': { paso1: '', paso2 }
      },
      horizonte_activacion: '7d',
      factible: true,
      metricas_horizonte: {
        '7d': { unidades: totUds, kilos: totKg, minutos: 0, tiempo_formateado: 'Completado hoy' }
      },
      presentaciones: gHoy.items,
      mirada_consciente: { pill: 'Detalle', receta_pesaje: [] }
    });
  }

  const estaciones7dPendientes = estaciones.filter(e => e.horizonte_activacion === '7d').sort(ordenarEstaciones);
  const estaciones7d = [...estaciones7dPendientes, ...estacionesCompletadasHoy];
  const estaciones15dNuevas = estaciones.filter(e => e.horizonte_activacion === '15d').sort(ordenarEstaciones);
  const estaciones30dNuevas = estaciones.filter(e => e.horizonte_activacion === '30d').sort(ordenarEstaciones);

  const minSemana7d = estaciones7dPendientes.reduce((acc, e) => acc + (e.metricas_horizonte['7d']?.minutos || 0), 0);
  const kgSemana7d = parseFloat(estaciones7dPendientes.reduce((acc, e) => acc + (e.metricas_horizonte['7d']?.kilos || 0), 0).toFixed(1));

  const minNuevas15d = estaciones15dNuevas.reduce((acc, e) => acc + (e.metricas_horizonte['15d']?.minutos || 0), 0);
  const kgNuevas15d = parseFloat(estaciones15dNuevas.reduce((acc, e) => acc + (e.metricas_horizonte['15d']?.kilos || 0), 0).toFixed(1));

  const minNuevas30d = estaciones30dNuevas.reduce((acc, e) => acc + (e.metricas_horizonte['30d']?.minutos || 0), 0);
  const kgNuevas30d = parseFloat(estaciones30dNuevas.reduce((acc, e) => acc + (e.metricas_horizonte['30d']?.kilos || 0), 0).toFixed(1));

  const totalUnidadesHoy = prodHoyRows.reduce((acc, r) => acc + (parseFloat(r.cantidad) || 0), 0);
  const totalKilosHoy = parseFloat(prodHoyRows.reduce((acc, r) => acc + ((parseFloat(r.cantidad) || 0) * (parseFloat(r.kilos_unidad) || 1)), 0).toFixed(1));

  const resultado = {
    success: true,
    timestamp: new Date().toISOString(),
    informes_hoy: verificarVigenciaInformesHoy(),
    resumen_horizontes: {
      hoy: {
        pedidos_activos_count: faltantesPedidosRes.rows?.[0]?.pedidos_activos_count || 0,
        estaciones_quiebre_count: estaciones7dPendientes.filter(e => e.urgente_hoy && !e.requiere_paso_up_previo).length,
        produccion_realizada_hoy_unidades: Math.round(totalUnidadesHoy),
        produccion_realizada_hoy_kilos: totalKilosHoy
      },
      semana_7d: {
        pendiente: estaciones7dPendientes.length > 0,
        estaciones_count: estaciones7dPendientes.length,
        completadas_hoy_count: estacionesCompletadasHoy.length,
        kilos_totales: kgSemana7d,
        minutos_totales: minSemana7d,
        tiempo_formateado: formatearMinutos(minSemana7d)
      },
      quincena_15d: {
        estaciones_nuevas_count: estaciones15dNuevas.length,
        kilos_nuevos: kgNuevas15d,
        minutos_nuevos: minNuevas15d,
        tiempo_formateado: formatearMinutos(minNuevas15d)
      },
      mes_30d: {
        estaciones_nuevas_count: estaciones30dNuevas.length,
        kilos_nuevos: kgNuevas30d,
        minutos_nuevos: minNuevas30d,
        tiempo_formateado: formatearMinutos(minNuevas30d)
      }
    },
    estaciones_semana_7d: estaciones7d,
    estaciones_adelanto_15d: estaciones15dNuevas,
    estaciones_adelanto_30d: estaciones30dNuevas
  };

  cachedPlanData = resultado;
  cachedPlanTimestamp = Date.now();
  return resultado;
}

module.exports = {
  obtenerPlanTrabajoDeposito,
  invalidarCachePlanDeposito
};
