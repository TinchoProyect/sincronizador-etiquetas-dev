#!/usr/bin/env node
/**
 * Script Idempotente y Auditable de Saneamiento Técnico Seguro — Pizarra de Costos LAMDA
 *
 * Alcance estricto (solo inconsistencias técnicas inequívocas, cero decisiones comerciales):
 *  1. NMECHAMX200G: alinear bunker_articulos.no_producido_por_lambda = false (coherente con
 *     stock_real_consolidado y Receta #290) y propagar el costo vigente de su receta
 *     (Ingrediente #25 + empaques) a costo_base y listas activas (incluida Lista 6 CF).
 *  2. NMELCHx10: eliminar filas huérfanas en bunker_lista_insumos cuyo insumo_articulo_numero
 *     es '760826b1-9bc8-422c-b349-e5d9737addd1' (inexistente en catálogo) sin alterar los
 *     precios vigentes de venta que ya excluyen ese fantasma.
 *  3. CHBx2: eliminar la bolsa duplicada en bunker_lista_insumos ('5dd2a902-3101-4434-a4c5-d5dfd813f62e')
 *     conservando la bolsa real de su receta (#177 Bolsa 30x40), alinear costo_base y
 *     recalcular precios de lista sin el doble cobro de empaque.
 *  4. ADP10X200G y APN25/2710X150G: quitar el residuo histórico de bolsa exterior ($159,40)
 *     incrustado dentro de costo_base / costo_base_sobrescrito dado que ambos packs ya cargan
 *     su bolsa exterior ('177') en bunker_lista_insumos (preservando sus precios finales).
 *
 * NO toca automáticamente: DTX2 (1kg vs 2kg), costos en $0 (#183, #156) ni mano_obra_activa
 * de terceros SKUs (señalados mediante badges de diagnóstico en LDN 2).
 *
 * Uso:
 *   node scripts/sanearInconsistenciasPizarraCostos.js --dry-run
 *   node scripts/sanearInconsistenciasPizarraCostos.js --aplicar
 *   (Si DB_NAME === 'etiquetas', exige además --confirmar-produccion)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const args = process.argv.slice(2);
const modoAplicar = args.includes('--aplicar');
const confirmarProduccion = args.includes('--confirmar-produccion');
const TOL = 0.015; // Tolerancia centesimal para idempotencia estricta

const DB_NAME = process.env.DB_NAME || 'etiquetas_pruebas';
const MODO_LAB = String(process.env.LAMDA_MODO_LABORATORIO || '').toLowerCase() === 'true';

if (modoAplicar && DB_NAME === 'etiquetas' && !confirmarProduccion) {
  console.error('⛔ BLOQUEO DE SEGURIDAD: DB_NAME="etiquetas" (Producción).');
  console.error('   Para ejecutar en Producción debés pasar explícitamente: --aplicar --confirmar-produccion');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: DB_NAME,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'taKionga'
});

const r2 = (n) => Number((Number(n) || 0).toFixed(2));
const r4 = (n) => Number((Number(n) || 0).toFixed(4));

function factorIvaLista(ivaBase, modoIva) {
  const iva = (ivaBase !== null && ivaBase !== undefined && !isNaN(parseFloat(ivaBase))) ? parseFloat(ivaBase) : 21;
  const m = String(modoIva || 'COMPLETO').toUpperCase();
  if (m === 'SIN' || m === 'EXENTO') return 1;
  if (m === 'MEDIO') return 1 + (iva / 200);
  return 1 + (iva / 100);
}

async function calcularCostoRecetaArticulo(client, articuloId) {
  const res = await client.query(`
    SELECT ri.ingrediente_id, ri.cantidad, i.nombre, i.costo_patron, i.es_insumo, i.unidad_medida
    FROM recetas r
    JOIN receta_ingredientes ri ON ri.receta_id = r.id
    JOIN ingredientes i ON i.id = ri.ingrediente_id
    WHERE LOWER(TRIM(r.articulo_numero)) = LOWER(TRIM($1))
  `, [articuloId]);
  if (res.rows.length === 0) return null;

  let total = 0;
  let tieneEmpaque = false;
  for (const row of res.rows) {
    const cant = parseFloat(row.cantidad) || 0;
    const costo = parseFloat(row.costo_patron) || 0;
    total += cant * costo;
    if (row.es_insumo === true || String(row.unidad_medida || '').trim().toLowerCase() === 'unidades') {
      tieneEmpaque = true;
    }
  }
  return { totalBulto: total, tieneEmpaque, items: res.rows };
}

async function registrarHistorialLista(client, art, la, costoAnt, costoNue, precioAnt, precioNue, motivo) {
  const varMonto = r2(precioNue - precioAnt);
  const varPct = precioAnt > 0 ? r2(((precioNue - precioAnt) / precioAnt) * 100) : 0;
  const ivaReg = (la.iva !== null && la.iva !== undefined && !isNaN(parseFloat(la.iva))) ? parseFloat(la.iva) : (parseFloat(art.porcentaje_iva) || 21);
  await client.query(`
    INSERT INTO bunker_historial_cambios_precios (
      articulo_numero, codigo_barras, descripcion, kilos_unidad,
      lista_id, lista_nombre, costo_anterior, costo_nuevo,
      precio_anterior, precio_nuevo, variacion_monto, variacion_porcentaje,
      porcentaje_iva, origen_cambio, usuario, estado_notificacion
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'PENDIENTE')
  `, [
    art.articulo_id,
    art.codigo_barras || null,
    art.descripcion_generada || art.descripcion || art.articulo_id,
    parseFloat(art.kilos_unidad) || 1,
    la.lista_id,
    la.lista_nombre || `Lista ${la.lista_id}`,
    r4(costoAnt),
    r4(costoNue),
    r4(precioAnt),
    r4(precioNue),
    varMonto,
    varPct,
    ivaReg,
    motivo,
    'script_saneamiento_pizarra'
  ]);
}

async function sanearDirectoConReceta(client, sku, { fijarNoProducidoFalse = false, eliminarInsumoDuplicado = null, motivoHistorial }, reporte) {
  const artRes = await client.query(`
    SELECT articulo_id, codigo_barras, descripcion_generada, descripcion, costo_base, kilos_unidad, porcentaje_iva, no_producido_por_lambda
    FROM bunker_articulos WHERE articulo_id = $1
  `, [sku]);
  if (artRes.rows.length === 0) {
    reporte.push({ sku, estado: 'OMITIDO', detalle: 'Artículo no encontrado en bunker_articulos' });
    return 0;
  }
  const art = artRes.rows[0];
  const kilos = parseFloat(art.kilos_unidad) > 0 ? parseFloat(art.kilos_unidad) : 1;
  const receta = await calcularCostoRecetaArticulo(client, sku);
  if (!receta) {
    reporte.push({ sku, estado: 'OMITIDO', detalle: 'Sin receta activa en public.recetas' });
    return 0;
  }

  let cambios = 0;

  // Paso opcional A: eliminar insumo duplicado en bunker_lista_insumos si la receta ya incluye empaque
  if (eliminarInsumoDuplicado && receta.tieneEmpaque) {
    const dupRes = await client.query(`
      SELECT bli.id, bla.lista_id, bli.insumo_articulo_numero, bli.cantidad, bli.costo_unitario_capturado
      FROM bunker_lista_insumos bli
      JOIN bunker_lista_articulos bla ON bla.id = bli.lista_articulo_id
      WHERE bla.articulo_numero = $1 AND bli.insumo_articulo_numero = $2
      ORDER BY bla.lista_id, bli.id
    `, [sku, eliminarInsumoDuplicado]);
    if (dupRes.rows.length > 0) {
      cambios += dupRes.rows.length;
      if (modoAplicar) {
        const ids = dupRes.rows.map(r => r.id);
        await client.query('DELETE FROM bunker_lista_insumos WHERE id = ANY($1)', [ids]);
      }
      reporte.push({
        sku,
        seccion: 'bunker_lista_insumos',
        antes: `${dupRes.rows.length} fila(s) duplicada(s) [${eliminarInsumoDuplicado}]`,
        despues: '0 filas duplicadas (conserva empaque real de receta)',
        cambios: dupRes.rows.length
      });
    }
  }

  // Paso opcional B: alinear no_producido_por_lambda = false
  const flagAntes = art.no_producido_por_lambda === true;
  if (fijarNoProducidoFalse && flagAntes) {
    cambios++;
    if (modoAplicar) {
      await client.query(`
        UPDATE bunker_articulos SET no_producido_por_lambda = false, updated_at = NOW()
        WHERE articulo_id = $1
      `, [sku]);
    }
    reporte.push({
      sku,
      seccion: 'no_producido_por_lambda',
      antes: 'true (desalineado con stock_real_consolidado)',
      despues: 'false',
      cambios: 1
    });
  }

  // Paso C: actualizar costo_base en bunker_articulos
  const costoBaseAntes = r2(art.costo_base);
  const costoBaseNuevo = r2(receta.totalBulto);
  const cbsNuevo = r4(costoBaseNuevo / kilos);

  if (Math.abs(costoBaseNuevo - costoBaseAntes) > TOL) {
    cambios++;
    if (modoAplicar) {
      await client.query(`
        UPDATE bunker_articulos SET costo_base = $1, updated_at = NOW()
        WHERE articulo_id = $2
      `, [costoBaseNuevo, sku]);
    }
    reporte.push({
      sku,
      seccion: 'bunker_articulos.costo_base',
      antes: `$${costoBaseAntes.toFixed(2)}`,
      despues: `$${costoBaseNuevo.toFixed(2)} (Δ ${(costoBaseNuevo - costoBaseAntes >= 0 ? '+' : '')}$${(costoBaseNuevo - costoBaseAntes).toFixed(2)})`,
      cambios: 1
    });
  }

  // Paso D: recalcular listas activas en bunker_lista_articulos
  const listasRes = await client.query(`
    SELECT bla.*, lp.nombre AS lista_nombre, lp.canal_comercial
    FROM bunker_lista_articulos bla
    JOIN bunker_listas_precios lp ON lp.id = bla.lista_id
    WHERE bla.articulo_numero = $1
    ORDER BY bla.lista_id
  `, [sku]);

  for (const la of listasRes.rows) {
    if (String(la.canal_comercial || '').toUpperCase() === 'NODOS' && la.disponible === false) continue;

    // Empaque de lista solo si la receta NO tiene empaque propio
    let extraInsumos = 0;
    if (!receta.tieneEmpaque) {
      const insRes = await client.query(`
        SELECT COALESCE(SUM(cantidad * costo_unitario_capturado), 0) AS total
        FROM bunker_lista_insumos
        WHERE lista_articulo_id = $1 AND incluido = true
      `, [la.id]);
      extraInsumos = parseFloat(insRes.rows[0]?.total) || 0;
    }

    const margen = parseFloat(la.margen_ganancia) || 0;
    const mo = la.mano_obra_activa !== false ? (parseFloat(la.costo_tiempo) || 0) : 0;
    const facIva = factorIvaLista(la.iva, la.modo_iva);
    const costoNetoBulto = costoBaseNuevo + extraInsumos;
    const precioNuevo = r2(((costoNetoBulto * (1 + margen / 100)) + mo) * facIva);

    const cbsAntes = r4(la.costo_base_sobrescrito);
    const precioAntes = r2(la.precio_final);
    const difCbs = Math.abs(cbsNuevo - cbsAntes);
    const difPrecio = Math.abs(precioNuevo - precioAntes);

    if (difCbs > 0.01 || difPrecio > TOL) {
      cambios++;
      if (modoAplicar) {
        await client.query(`
          UPDATE bunker_lista_articulos
          SET costo_base_sobrescrito = $1, precio_final = $2, updated_at = NOW()
          WHERE id = $3
        `, [cbsNuevo, precioNuevo, la.id]);
        await registrarHistorialLista(client, art, la, cbsAntes * kilos, costoBaseNuevo, precioAntes, precioNuevo, motivoHistorial);
      }
      reporte.push({
        sku,
        seccion: `Lista ${la.lista_id} (${la.lista_nombre})${la.disponible ? ' [ACTIVA]' : ''}`,
        antes: `cbs $${cbsAntes.toFixed(2)} | P.Final $${precioAntes.toFixed(2)}`,
        despues: `cbs $${cbsNuevo.toFixed(2)} | P.Final $${precioNuevo.toFixed(2)}`,
        cambios: 1
      });
    }
  }

  return cambios;
}

async function sanearPackResiduoBolsaExterior(client, packSku, reporte) {
  const packRes = await client.query(`
    SELECT articulo_id, codigo_barras, descripcion_generada, descripcion, costo_base, kilos_unidad, porcentaje_iva, es_pack, pack_unidades, pack_hijo_codigo
    FROM bunker_articulos WHERE articulo_id = $1
  `, [packSku]);
  if (packRes.rows.length === 0) {
    reporte.push({ sku: packSku, estado: 'OMITIDO', detalle: 'Pack no encontrado' });
    return 0;
  }
  const pack = packRes.rows[0];
  if (!pack.pack_hijo_codigo) {
    reporte.push({ sku: packSku, estado: 'OMITIDO', detalle: 'Sin pack_hijo_codigo configurado' });
    return 0;
  }

  const hijoRes = await client.query(`
    SELECT articulo_id, costo_base, kilos_unidad FROM bunker_articulos WHERE articulo_id = $1
  `, [pack.pack_hijo_codigo]);
  if (hijoRes.rows.length === 0) return 0;
  const hijo = hijoRes.rows[0];
  const recetaHijo = await calcularCostoRecetaArticulo(client, hijo.articulo_id);
  const costoBaseHijo = recetaHijo ? recetaHijo.totalBulto : (parseFloat(hijo.costo_base) || 0);

  const packKilos = parseFloat(pack.kilos_unidad) > 0 ? parseFloat(pack.kilos_unidad) : 1;
  const hijoKilos = parseFloat(hijo.kilos_unidad) > 0 ? parseFloat(hijo.kilos_unidad) : 1;
  const packUnidades = parseInt(pack.pack_unidades, 10) > 0 ? parseInt(pack.pack_unidades, 10) : Math.round(packKilos / hijoKilos);

  // Obtener lista patrón del hijo para MO de referencia del costo_base del pack
  const laHijoRefRes = await client.query(`
    SELECT id, lista_id, costo_tiempo, mano_obra_activa
    FROM bunker_lista_articulos
    WHERE articulo_numero = $1
    ORDER BY CASE WHEN lista_id = 1 THEN 0 ELSE 1 END, lista_id
    LIMIT 1
  `, [hijo.articulo_id]);
  const laHijoRef = laHijoRefRes.rows[0];
  const moHijoRef = (laHijoRef && laHijoRef.mano_obra_activa !== false) ? (parseFloat(laHijoRef.costo_tiempo) || 0) : 0;

  let extraHijoRef = 0;
  if (laHijoRef && (!recetaHijo || !recetaHijo.tieneEmpaque)) {
    const insH = await client.query(`
      SELECT COALESCE(SUM(cantidad * costo_unitario_capturado), 0) AS total
      FROM bunker_lista_insumos WHERE lista_articulo_id = $1 AND incluido = true
    `, [laHijoRef.id]);
    extraHijoRef = parseFloat(insH.rows[0]?.total) || 0;
  }

  const costoBasePackNuevo = r2((costoBaseHijo + extraHijoRef + moHijoRef) * packUnidades);
  const costoBasePackAntes = r2(pack.costo_base);
  let cambios = 0;

  if (Math.abs(costoBasePackNuevo - costoBasePackAntes) > TOL) {
    cambios++;
    if (modoAplicar) {
      await client.query(`
        UPDATE bunker_articulos SET costo_base = $1, updated_at = NOW()
        WHERE articulo_id = $2
      `, [costoBasePackNuevo, packSku]);
    }
    reporte.push({
      sku: packSku,
      seccion: 'bunker_articulos.costo_base (sin bolsa exterior duplicada)',
      antes: `$${costoBasePackAntes.toFixed(2)}`,
      despues: `$${costoBasePackNuevo.toFixed(2)} (Δ ${(costoBasePackNuevo - costoBasePackAntes >= 0 ? '+' : '')}$${(costoBasePackNuevo - costoBasePackAntes).toFixed(2)})`,
      cambios: 1
    });
  }

  const listasPackRes = await client.query(`
    SELECT bla.*, lp.nombre AS lista_nombre, lp.canal_comercial
    FROM bunker_lista_articulos bla
    JOIN bunker_listas_precios lp ON lp.id = bla.lista_id
    WHERE bla.articulo_numero = $1
    ORDER BY bla.lista_id
  `, [packSku]);

  for (const la of listasPackRes.rows) {
    if (String(la.canal_comercial || '').toUpperCase() === 'NODOS' && la.disponible === false) continue;

    // MO del hijo en esta misma lista (fallback a lista 1)
    const laHijoLRes = await client.query(`
      SELECT id, costo_tiempo, mano_obra_activa FROM bunker_lista_articulos
      WHERE articulo_numero = $1 AND lista_id = $2 LIMIT 1
    `, [hijo.articulo_id, la.lista_id]);
    const laHijoL = laHijoLRes.rows[0] || laHijoRef;
    const moHijoL = (laHijoL && laHijoL.mano_obra_activa !== false) ? (parseFloat(laHijoL.costo_tiempo) || 0) : 0;

    let extraHijoL = 0;
    if (laHijoL && (!recetaHijo || !recetaHijo.tieneEmpaque)) {
      const insHL = await client.query(`
        SELECT COALESCE(SUM(cantidad * costo_unitario_capturado), 0) AS total
        FROM bunker_lista_insumos WHERE lista_articulo_id = $1 AND incluido = true
      `, [laHijoL.id]);
      extraHijoL = parseFloat(insHL.rows[0]?.total) || 0;
    }

    // Bolsa exterior propia del pack en bunker_lista_insumos (sí se suma al costo neto del bulto, NO se incrusta en cbs)
    const insPackRes = await client.query(`
      SELECT COALESCE(SUM(cantidad * costo_unitario_capturado), 0) AS total
      FROM bunker_lista_insumos WHERE lista_articulo_id = $1 AND incluido = true
    `, [la.id]);
    const bolsaExteriorPack = parseFloat(insPackRes.rows[0]?.total) || 0;

    const baseSinBolsaExt = r2((costoBaseHijo + extraHijoL + moHijoL) * packUnidades);
    const cbsNuevo = r4(baseSinBolsaExt / packKilos);
    const costoNetoBulto = baseSinBolsaExt + bolsaExteriorPack;
    const margen = parseFloat(la.margen_ganancia) || 0;
    const moPack = la.mano_obra_activa !== false ? (parseFloat(la.costo_tiempo) || 0) : 0;
    const facIva = factorIvaLista(la.iva, la.modo_iva);
    const precioNuevo = r2(((costoNetoBulto * (1 + margen / 100)) + moPack) * facIva);

    const cbsAntes = r4(la.costo_base_sobrescrito);
    const precioAntes = r2(la.precio_final);
    if (Math.abs(cbsNuevo - cbsAntes) > 0.01 || Math.abs(precioNuevo - precioAntes) > TOL) {
      cambios++;
      if (modoAplicar) {
        await client.query(`
          UPDATE bunker_lista_articulos
          SET costo_base_sobrescrito = $1, precio_final = $2, updated_at = NOW()
          WHERE id = $3
        `, [cbsNuevo, precioNuevo, la.id]);
        await registrarHistorialLista(client, pack, la, cbsAntes * packKilos, baseSinBolsaExt, precioAntes, precioNuevo, 'SANEAMIENTO_RESIDUO_BOLSA_PACK');
      }
      reporte.push({
        sku: packSku,
        seccion: `Lista ${la.lista_id} (${la.lista_nombre})`,
        antes: `cbs $${cbsAntes.toFixed(4)} | P.Final $${precioAntes.toFixed(2)}`,
        despues: `cbs $${cbsNuevo.toFixed(4)} | P.Final $${precioNuevo.toFixed(2)} (+bolsa ext $${bolsaExteriorPack.toFixed(2)})`,
        cambios: 1
      });
    }
  }

  return cambios;
}

async function sanearInsumoHuerfanoNMELCHx10(client, reporte) {
  const orphanCode = '760826b1-9bc8-422c-b349-e5d9737addd1';
  // Verificar que realmente NO exista en bunker_articulos ni ingredientes
  const existsArt = await client.query('SELECT 1 FROM bunker_articulos WHERE articulo_id = $1 LIMIT 1', [orphanCode]);
  if (existsArt.rows.length > 0) {
    reporte.push({ sku: 'NMELCHx10', estado: 'OMITIDO', detalle: `El insumo ${orphanCode} existe en catálogo` });
    return 0;
  }

  const rowsRes = await client.query(`
    SELECT bli.id, bla.lista_id, bli.cantidad, bli.costo_unitario_capturado, bli.incluido
    FROM bunker_lista_insumos bli
    JOIN bunker_lista_articulos bla ON bla.id = bli.lista_articulo_id
    WHERE bla.articulo_numero = 'NMELCHx10' AND bli.insumo_articulo_numero = $1
    ORDER BY bla.lista_id, bli.id
  `, [orphanCode]);

  if (rowsRes.rows.length === 0) return 0;

  if (modoAplicar) {
    const ids = rowsRes.rows.map(r => r.id);
    await client.query('DELETE FROM bunker_lista_insumos WHERE id = ANY($1)', [ids]);
  }
  reporte.push({
    sku: 'NMELCHx10',
    seccion: 'bunker_lista_insumos (insumo huérfano inexistente)',
    antes: `${rowsRes.rows.length} fila(s) [${orphanCode}] en listas ${rowsRes.rows.map(r => r.lista_id).join(', ')}`,
    despues: '0 filas huérfanas (precios de venta intactos)',
    cambios: rowsRes.rows.length
  });
  return rowsRes.rows.length;
}

async function main() {
  console.log('========================================================================');
  console.log('🛠️  SANEAMIENTO TÉCNICO SEGURO — PIZARRA DE COSTOS LAMDA');
  console.log(`    Base de datos : ${DB_NAME} (${MODO_LAB ? 'LABORATORIO' : 'NO-LAB'})`);
  console.log(`    Modo ejecución: ${modoAplicar ? 'APLICAR EN BASE DE DATOS (TRANSACCIONAL)' : 'DRY-RUN (SOLO SIMULACIÓN)'}`);
  console.log('========================================================================\n');

  const client = await pool.connect();
  const reporte = [];
  let totalCambios = 0;

  try {
    await client.query('BEGIN');

    // 1. NMECHAMX200G: flag no_producido_por_lambda = false + propagar Ingrediente #25 vigente
    totalCambios += await sanearDirectoConReceta(client, 'NMECHAMX200G', {
      fijarNoProducidoFalse: true,
      motivoHistorial: 'SANEAMIENTO_NMECHAMX200G_ING25'
    }, reporte);

    // 2. NMELCHx10: eliminar insumo huérfano 760826b1-9bc8-422c-b349-e5d9737addd1
    totalCambios += await sanearInsumoHuerfanoNMELCHx10(client, reporte);

    // 3. CHBx2: eliminar bolsa duplicada en bunker_lista_insumos + alinear costo_base y listas
    totalCambios += await sanearDirectoConReceta(client, 'CHBx2', {
      fijarNoProducidoFalse: false,
      eliminarInsumoDuplicado: '5dd2a902-3101-4434-a4c5-d5dfd813f62e',
      motivoHistorial: 'SANEAMIENTO_DOBLE_BOLSA_CHBX2'
    }, reporte);

    // 4. ADP10X200G y APN25/2710X150G: alinear residuo -$159,40 en packs con bolsa exterior en lista
    totalCambios += await sanearPackResiduoBolsaExterior(client, 'ADP10X200G', reporte);
    totalCambios += await sanearPackResiduoBolsaExterior(client, 'APN25/2710X150G', reporte);

    if (modoAplicar) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }

    // Sincronización aguas abajo si hubo cambios aplicados
    if (modoAplicar && totalCambios > 0) {
      const skusSaneados = ['NMECHAMX200G', 'CHBx2', 'ADP10X200G', 'APN25/2710X150G'];
      try {
        const nodosBarrialesService = require('../src/produccion/services/nodosBarrialesService');
        if (typeof nodosBarrialesService.sincronizarCatalogoNodoDesdeBunker === 'function') {
          for (const s of skusSaneados) {
            await nodosBarrialesService.sincronizarCatalogoNodoDesdeBunker(s);
          }
          console.log('🔄 Sincronización aguas abajo con Nodos ejecutada.');
        }
      } catch (errN) {
        console.warn('⚠️ Aviso al sincronizar Nodos post-saneamiento:', errN.message);
      }
      try {
        const combosCompuestosService = require('../src/produccion/services/combosCompuestosService');
        if (typeof combosCompuestosService.recalcularCombosAfectadosPorCambio === 'function') {
          await combosCompuestosService.recalcularCombosAfectadosPorCambio(pool, { skusModificados: skusSaneados });
          console.log('🔄 Sincronización aguas abajo con Combos ejecutada.');
        }
      } catch (errC) {
        console.warn('⚠️ Aviso al sincronizar Combos post-saneamiento:', errC.message);
      }
    }

    if (reporte.length === 0) {
      console.log('✅ Base 100% saneada (0 cambios pendientes — idempotencia verificada).');
    } else {
      console.table(reporte);
      console.log(`\n📊 Total de ajustes ${modoAplicar ? 'APLICADOS' : 'DETECTADOS (dry-run)'}: ${totalCambios}`);
      if (!modoAplicar) {
        console.log('ℹ️  Para aplicar estos cambios ejecutá: node scripts/sanearInconsistenciasPizarraCostos.js --aplicar');
      }
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error durante el saneamiento (ROLLBACK ejecutado):', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
