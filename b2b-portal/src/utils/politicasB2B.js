// filepath: b2b-portal/src/utils/politicasB2B.js
import { supabase } from '../supabaseClient';

let cachedPolitica = null;
let cachedProfileKey = null;

let cachedOfertas = null;
let cachedOfertasKey = null;

/**
 * Consulta las ofertas dinámicas activas y cuotas remanentes para el perfil
 */
export async function fetchOfertasB2B(profile) {
  if (!profile) return {};

  const listasIds = Array.isArray(profile.listas_precios) ? profile.listas_precios : [];
  if (listasIds.length === 0) return {};

  const profileKey = `${profile.cliente_id}_${listasIds.join(',')}`;
  if (cachedOfertas && cachedOfertasKey === profileKey) {
    return cachedOfertas;
  }

  // 1. Intentar consultar Supabase Cloud (si la tabla existe)
  try {
    const { data, error } = await supabase
      .from('clientes_b2b_ofertas_activas')
      .select('*')
      .eq('activo', true)
      .eq('estado', 'ACTIVA')
      .gt('cuota_disponible', 0);

    if (!error && data && data.length > 0) {
      const mapaArticulosOferta = {};
      const clienteIdStr = String(profile.cliente_id || '').trim().toUpperCase();

      for (const ofr of data) {
        // Verificar si la oferta aplica a alguna de las listas del cliente
        const aplicaLista = ofr.listas_ids && ofr.listas_ids.some(lid => listasIds.includes(lid));
        if (!aplicaLista) continue;

        // Verificar excepciones
        if (Array.isArray(ofr.excepciones)) {
          const exc = ofr.excepciones.find(e => {
            const eId = String(e.cliente_id || '').trim().toUpperCase();
            const eCode = String(e.codigo_bunker_cliente || '').trim().toUpperCase();
            return eId === clienteIdStr || eCode === clienteIdStr;
          });
          if (exc && exc.tipo_excepcion === 'EXCLUIDO') continue;
        }

        // Mapear artículos participantes
        for (const art of ofr.articulos || []) {
          mapaArticulosOferta[art.articulo_numero] = {
            oferta_id: ofr.oferta_id,
            titulo: ofr.titulo,
            descripcion: ofr.descripcion,
            descuento_porcentaje: parseFloat(ofr.descuento_porcentaje) || 5.0,
            cuota_disponible: parseFloat(ofr.cuota_disponible) || 0,
            condicion_cierre: ofr.condicion_cierre,
            fecha_fin: ofr.fecha_fin,
            unidad_cuota: ofr.unidad_cuota,
            factor_conversion_cuota: parseFloat(art.factor_conversion_cuota) || 1.0,
            precio_fijo_oferta: art.precio_fijo_oferta ? parseFloat(art.precio_fijo_oferta) : null
          };
        }
      }

      if (Object.keys(mapaArticulosOferta).length > 0) {
        cachedOfertas = mapaArticulosOferta;
        cachedOfertasKey = profileKey;
        console.log(`✅ [OFERTAS-B2B] ${Object.keys(mapaArticulosOferta).length} artículo(s) con oferta activa cargados desde Supabase.`);
        return cachedOfertas;
      }
    }
  } catch (err) {
    console.warn('ℹ️ [OFERTAS-B2B] Supabase no disponible, intentando backend local:', err.message);
  }

  // 2. Fallback resiliente: Consultar endpoint local (/api/ofertas-dinamicas/contexto)
  try {
    const primerLista = listasIds[0];
    const clienteParam = encodeURIComponent(profile.cliente_id || '');
    const urlLocal = `/api/ofertas-dinamicas/contexto?cliente_id=${clienteParam}&lista_id=${primerLista}`;
    
    let res = null;
    try {
      res = await fetch(urlLocal);
    } catch {
      res = await fetch(`http://localhost:3000${urlLocal}`);
    }

    if (res && res.ok) {
      const json = await res.json();
      if (json.success && json.data && Object.keys(json.data).length > 0) {
        cachedOfertas = json.data;
        cachedOfertasKey = profileKey;
        console.log(`✅ [OFERTAS-B2B] ${Object.keys(json.data).length} artículo(s) con oferta activa cargados desde Backend Local.`);
        return cachedOfertas;
      }
    }
  } catch (errLocal) {
    console.warn('⚠️ [OFERTAS-B2B] Fallo al consultar ofertas en backend local:', errLocal.message);
  }

  return {};
}

/**
 * Consulta la política comercial activa para las listas de precios del perfil
 */
export async function fetchPoliticaB2B(profile) {
  if (!profile) return null;

  const listasIds = Array.isArray(profile.listas_precios) ? profile.listas_precios : [];
  if (listasIds.length === 0) return null;

  const profileKey = `${profile.cliente_id}_${listasIds.join(',')}`;
  if (cachedPolitica && cachedProfileKey === profileKey) {
    return cachedPolitica;
  }

  try {
    const { data, error } = await supabase
      .from('clientes_b2b_politicas_comerciales')
      .select('*')
      .eq('activo', true)
      .in('lista_id', listasIds);

    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
        console.warn('ℹ️ [POLITICAS-B2B] Tabla clientes_b2b_politicas_comerciales no disponible aún en Supabase.');
      } else {
        console.warn('⚠️ [POLITICAS-B2B] Error al consultar políticas comerciales:', error.message);
      }
      return null;
    }

    if (data && data.length > 0) {
      cachedPolitica = data[0];
      cachedProfileKey = profileKey;
      console.log('✅ [POLITICAS-B2B] Política comercial activa cargada:', cachedPolitica.nombre);
    }
  } catch (err) {
    console.warn('⚠️ [POLITICAS-B2B] Fallo de red consultando políticas:', err.message);
  }

  // 2. Fallback resiliente: Consultar endpoint local (/api/presupuestos/politicas/cliente/:id)
  if (!cachedPolitica || cachedProfileKey !== profileKey) {
    try {
      const clienteParam = encodeURIComponent(profile.cliente_id || '');
      const urlLocal = `/api/presupuestos/politicas/cliente/${clienteParam}`;
      let res = null;
      try {
        res = await fetch(urlLocal);
      } catch {
        res = await fetch(`http://localhost:3000${urlLocal}`).catch(() => null) 
           || await fetch(`http://localhost:3003${urlLocal}`).catch(() => null);
      }
      if (res && res.ok) {
        const json = await res.json();
        if (json.success && json.data && json.data.politica) {
          cachedPolitica = {
            ...json.data.politica,
            lista_id: json.data.lista_id,
            lista_nombre: json.data.lista_nombre,
            saldo_cliente: parseFloat(json.data.saldo_cuenta_corriente) || 0,
            excepciones: json.data.excepcion ? [json.data.excepcion] : []
          };
          cachedProfileKey = profileKey;
          console.log('✅ [POLITICAS-B2B] Política comercial cargada desde Backend Local:', cachedPolitica.nombre);
        }
      }
    } catch (errLocal) {
      console.warn('⚠️ [POLITICAS-B2B] Fallo al consultar política en backend local:', errLocal.message);
    }
  }

  // 3. Consultar saldo actual de la cuenta corriente si aún no está asignado
  if (cachedPolitica && typeof cachedPolitica.saldo_cliente !== 'number' && profile?.cliente_id) {
    try {
      const { data: ccData } = await supabase
        .from('clientes_b2b_cuentas_corrientes')
        .select('saldo')
        .eq('cliente_id', profile.cliente_id)
        .order('created_at', { ascending: false })
        .order('local_movimiento_id', { ascending: false })
        .limit(1);
      if (ccData && ccData.length > 0) {
        cachedPolitica.saldo_cliente = parseFloat(ccData[0].saldo) || 0;
      } else {
        cachedPolitica.saldo_cliente = 0;
      }
    } catch (e) {
      cachedPolitica.saldo_cliente = 0;
    }
  }

  return cachedPolitica || null;
}

/**
 * Evalúa reactivamente el carrito contra la política comercial
 * Blindaje 300k: Los artículos en oferta suman al volumen para el umbral,
 * pero están excluidos de recibir el 5% duplicado.
 */
export function evaluarPoliticaB2B(politica, cart = [], profile = null) {
  const subtotalBruto = cart.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);
  
  // Subtotal de artículos en oferta
  const subtotalOfertas = cart
    .filter(i => i.es_oferta)
    .reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);

  // Base bonificable: solo artículos a precio estándar
  const baseBonificable = Math.max(0, subtotalBruto - subtotalOfertas);

  // Cálculo de subtotal neto con desglose de IVA por ítem
  const subtotalNeto = cart.reduce((acc, item) => {
    const sub = parseFloat(item.subtotal) || 0;
    const alicuota = parseFloat(item.iva_porcentaje || 21) / 100;
    return acc + (sub / (1 + alicuota));
  }, 0);

  if (!politica || !Array.isArray(politica.tramos) || politica.tramos.length === 0 || cart.length === 0) {
    return {
      aplica: false,
      porcentaje: 0,
      montoDescuento: 0,
      subtotalNeto,
      subtotalBruto,
      subtotalOfertas,
      baseBonificable,
      totalEstimado: subtotalBruto,
      tramoActual: null,
      proximoTramo: null,
      faltaParaProximo: 0,
      proximoPorcentaje: 0,
      mensaje: null
    };
  }

  // 1. Verificar excepciones de cliente
  if (Array.isArray(politica.excepciones) && profile) {
    const clienteIdStr = String(profile.cliente_id || '').trim().toUpperCase();
    const cleanNum = clienteIdStr.replace(/[^0-9]/g, '');

    const excepcion = politica.excepciones.find(exc => {
      const excId = String(exc.cliente_id || '').trim().toUpperCase();
      const excCode = String(exc.codigo_bunker_cliente || '').trim().toUpperCase();
      return excId === clienteIdStr || excCode === clienteIdStr || (cleanNum && excId === cleanNum);
    });

    if (excepcion) {
      if (excepcion.tipo_excepcion === 'EXCLUIDO') {
        return {
          aplica: false,
          porcentaje: 0,
          montoDescuento: 0,
          subtotalNeto,
          subtotalBruto,
          subtotalOfertas,
          baseBonificable,
          totalEstimado: subtotalBruto,
          esExcluido: true,
          motivo: excepcion.motivo,
          mensaje: `Cliente con bonificaciones excluidas${excepcion.motivo ? ': ' + excepcion.motivo : ''}`
        };
      } else if (excepcion.tipo_excepcion === 'PORCENTAJE_FIJO') {
        const fijo = parseFloat(excepcion.descuento_fijo) || 0;
        const monto = Math.round(baseBonificable * (fijo / 100) * 100) / 100;
        return {
          aplica: true,
          porcentaje: fijo,
          montoDescuento: monto,
          subtotalNeto,
          subtotalBruto,
          subtotalOfertas,
          baseBonificable,
          totalEstimado: subtotalBruto - monto,
          esFijo: true,
          motivo: excepcion.motivo,
          etiqueta: 'Bonificación fija acordada',
          mensaje: `Bonificación especial acordada del ${fijo}%`
        };
      }
    }
  }

  // 1b. Condición Comercial: Exigencia de cuenta al día (saldo cero con tolerancia configurable, default $500)
  const exigeSaldoCero = politica.exige_saldo_cero !== false;
  const toleranciaSaldo = parseFloat(politica.tolerancia_saldo) || 500.00;
  const saldoActual = (typeof politica.saldo_cliente === 'number') 
    ? politica.saldo_cliente 
    : (parseFloat(profile?.saldo || profile?.saldo_actual || 0) || 0);

  const saldoBloqueante = saldoActual > toleranciaSaldo;

  if (exigeSaldoCero && saldoBloqueante) {
    const primerTramo = Array.isArray(politica.tramos) && politica.tramos.length > 0 ? politica.tramos[0] : null;
    const descPotencial = primerTramo ? parseFloat(primerTramo.descuento_porcentaje) : 5;
    const saldoFmt = saldoActual.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const tolFmt = toleranciaSaldo.toLocaleString('es-AR');

    return {
      aplica: false,
      bloqueadoPorSaldo: true,
      saldoActual: saldoActual,
      toleranciaSaldo: toleranciaSaldo,
      porcentaje: 0,
      montoDescuento: 0,
      subtotalNeto,
      subtotalBruto,
      subtotalOfertas,
      baseBonificable,
      totalEstimado: subtotalBruto,
      tramoActual: null,
      proximoTramo: null,
      faltaParaProximo: 0,
      proximoPorcentaje: 0,
      etiqueta: 'Descuento retenido por saldo pendiente',
      motivo: `Saldo pendiente de $${saldoFmt} en cuenta corriente`,
      mensaje: `Para acceder al ${descPotencial}% de bonificación por volumen, debe regularizar o cancelar el saldo pendiente en su cuenta corriente ($${saldoFmt}). Tolerancia: $${tolFmt}.`
    };
  }

  // 2. Determinar base de evaluación para el umbral (NETO o BRUTO, incluye la oferta)
  const montoBase = (politica.aplica_sobre === 'BRUTO') ? subtotalBruto : subtotalNeto;

  // Ordenar tramos ascendentemente por monto mínimo
  const tramos = [...politica.tramos].sort((a, b) => parseFloat(a.monto_minimo) - parseFloat(a.monto_minimo));

  let tramoActual = null;
  let proximoTramo = null;

  for (const t of tramos) {
    const min = parseFloat(t.monto_minimo) || 0;
    const max = (t.monto_maximo !== null && t.monto_maximo !== undefined && t.monto_maximo !== '')
      ? parseFloat(t.monto_maximo) : Infinity;

    if (montoBase >= min) {
      if (montoBase <= max || max === Infinity) {
        tramoActual = t;
      }
    } else if (!proximoTramo && montoBase < min) {
      proximoTramo = t;
    }
  }

  if (tramoActual) {
    const descPct = parseFloat(tramoActual.descuento_porcentaje) || 0;
    // El descuento de volumen se aplica estrictamente sobre baseBonificable (sin duplicar ofertas)
    const montoDesc = Math.round(baseBonificable * (descPct / 100) * 100) / 100;
    const faltaProximo = proximoTramo ? Math.max(0, parseFloat(proximoTramo.monto_minimo) - montoBase) : 0;

    return {
      aplica: true,
      porcentaje: descPct,
      montoDescuento: montoDesc,
      subtotalNeto,
      subtotalBruto,
      subtotalOfertas,
      baseBonificable,
      totalEstimado: subtotalBruto - montoDesc,
      tramoActual,
      proximoTramo,
      faltaParaProximo: faltaProximo,
      proximoPorcentaje: proximoTramo ? parseFloat(proximoTramo.descuento_porcentaje) : 0,
      etiqueta: subtotalOfertas > 0 ? `${tramoActual.etiqueta || politica.nombre} (sobre artículos estándar)` : (tramoActual.etiqueta || politica.nombre),
      aplicaSobre: politica.aplica_sobre
    };
  } else {
    // No alcanza el primer escalón
    const primerTramo = tramos[0];
    const falta = primerTramo ? Math.max(0, parseFloat(primerTramo.monto_minimo) - montoBase) : 0;
    const proximoPct = primerTramo ? parseFloat(primerTramo.descuento_porcentaje) : 5;

    return {
      aplica: false,
      porcentaje: 0,
      montoDescuento: 0,
      subtotalNeto,
      subtotalBruto,
      subtotalOfertas,
      baseBonificable,
      totalEstimado: subtotalBruto,
      tramoActual: null,
      proximoTramo: primerTramo,
      faltaParaProximo: falta,
      proximoPorcentaje: proximoPct,
      etiqueta: primerTramo?.etiqueta || politica.nombre,
      aplicaSobre: politica.aplica_sobre
    };
  }
}
