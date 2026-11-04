const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
  console.log('🧪 [TEST-FASE2.6] Iniciando prueba de incidencias y entregas parciales...');
  const client = await pool.connect();
  
  try {
    // Definir constantes de prueba
    const MOCK_BUDGET_ID = 999999;
    const MOCK_BUDGET_EXT_ID = 'test-ext-id-2.6';
    const MOCK_CLIENTE_ID = '196'; // Cliente Martin Ignacio Serrano
    
    await client.query('BEGIN');
    
    // 1. Limpieza preventiva
    await client.query('DELETE FROM public.entregas_eventos WHERE id_presupuesto = $1', [MOCK_BUDGET_ID]);
    await client.query('DELETE FROM public.presupuestos_detalles WHERE id_presupuesto_ext = $1', [MOCK_BUDGET_EXT_ID]);
    await client.query('DELETE FROM public.presupuestos WHERE id = $1', [MOCK_BUDGET_ID]);

    // Obtener o crear una ruta válida para evitar violar fk_presupuestos_ruta
    let routeId = null;
    const routeRes = await client.query('SELECT id FROM public.rutas LIMIT 1');
    if (routeRes.rowCount > 0) {
      routeId = routeRes.rows[0].id;
    } else {
      // Insertar una ruta temporal
      const newRoute = await client.query(`
        INSERT INTO public.rutas (nombre, estado, fecha_creacion)
        VALUES ('Ruta Mock Test', 'CREADA', NOW())
        RETURNING id
      `);
      routeId = newRoute.rows[0].id;
    }
    console.log(`Using Route ID: ${routeId} for testing.`);

    // 2. Insertar presupuesto mock
    console.log('➡️ Insertando presupuesto y detalles mock...');
    await client.query(`
      INSERT INTO public.presupuestos 
      (id, id_presupuesto_ext, id_cliente, fecha, secuencia, estado, estado_logistico, activo)
      VALUES ($1, $2, $3, NOW(), 'Pedido_Listo', 'Presupuesto/Orden', 'PENDIENTE_ASIGNAR', true)
    `, [MOCK_BUDGET_ID, MOCK_BUDGET_EXT_ID, MOCK_CLIENTE_ID]);

    // Detalles: 10 unidades de ART-TEST-1 (precio $100)
    await client.query(`
      INSERT INTO public.presupuestos_detalles
      (id_presupuesto, id_presupuesto_ext, articulo, cantidad, precio1, fecha_actualizacion)
      VALUES ($1, $2, 'ART-TEST-1', 10.0, 100.0, NOW())
    `, [MOCK_BUDGET_ID, MOCK_BUDGET_EXT_ID]);

    // --- TEST CASE 1: Registrar visita fallida (incidencia) ---
    console.log('\n🔥 [TEST CASE 1] Registrando visita fallida (incidencia)...');
    
    const motivoIncidencia = 'Local Cerrado/Ausente';
    
    // Simular API: insertar evento de incidencia
    await client.query(
        `INSERT INTO public.entregas_eventos 
         (id_presupuesto, receptor_nombre, receptor_vinculo, dni_receptor,
          fecha_entrega, observaciones, tipo_evento, motivo_incidencia)
         VALUES ($1, 'Chofer', 'Incidencia', null, NOW(), $2, 'INCIDENCIA', $2)`,
        [MOCK_BUDGET_ID, motivoIncidencia]
    );

    // Simular API: devolver a pendientes con motivo de no entrega
    await client.query(
        `UPDATE public.presupuestos 
         SET id_ruta = NULL,
             estado_logistico = 'PENDIENTE_ASIGNAR',
             secuencia = 'Pedido_Listo',
             orden_entrega = NULL,
             fecha_asignacion_ruta = NULL,
             motivo_no_entrega = $1,
             fecha_actualizacion = NOW()
         WHERE id = $2`,
        [motivoIncidencia, MOCK_BUDGET_ID]
    );

    // Verificar en BD
    const checkCase1 = await client.query(
      'SELECT motivo_no_entrega, estado_logistico, secuencia FROM public.presupuestos WHERE id = $1',
      [MOCK_BUDGET_ID]
    );
    const p1 = checkCase1.rows[0];
    
    console.log('Verificación Case 1:');
    console.log('  - motivo_no_entrega:', p1.motivo_no_entrega, '(esperado: Local Cerrado/Ausente)');
    console.log('  - estado_logistico:', p1.estado_logistico, '(esperado: PENDIENTE_ASIGNAR)');
    console.log('  - secuencia:', p1.secuencia, '(esperado: Pedido_Listo)');
    
    if (p1.motivo_no_entrega === motivoIncidencia && p1.estado_logistico === 'PENDIENTE_ASIGNAR') {
      console.log('✅ TEST CASE 1 exitoso!');
    } else {
      throw new Error('TEST CASE 1 falló: los datos no coinciden');
    }

    // --- TEST CASE 2: Re-intento y entrega parcial ---
    console.log('\n🔥 [TEST CASE 2] Simulando re-intento y entrega parcial (de 10 unidades a 8 unidades)...');

    // Simular re-asignación a ruta
    await client.query(
      `UPDATE public.presupuestos SET id_ruta = $1, estado_logistico = 'EN_CAMINO' WHERE id = $2`,
      [routeId, MOCK_BUDGET_ID]
    );

    // Simular API escanear-qr con itemsModificados (ART-TEST-1 -> 8 unidades)
    const itemsModificados = [{ codigo_barras: 'ART-TEST-1', cantidad: 8.0 }];
    const observacionesChofer = 'Cliente rechazó 2 unidades por caja mojada';

    // 1. Modificar cantidades en detalle
    for (const itemMod of itemsModificados) {
        const { codigo_barras, cantidad: nuevaCantidad } = itemMod;
        const qtyVal = parseFloat(nuevaCantidad);
        
        await client.query(
            `UPDATE public.presupuestos_detalles
             SET cantidad_original = COALESCE(cantidad_original, cantidad),
                 cantidad = $1,
                 diferencia = COALESCE(cantidad_original, cantidad) - $1,
                 fecha_actualizacion = NOW()
             WHERE id_presupuesto_ext = $2 AND articulo = $3`,
            [qtyVal, MOCK_BUDGET_EXT_ID, codigo_barras]
        );
    }

    // 2. Marcar como entregado y LIMPIAR motivo_no_entrega anterior
    await client.query(
        `UPDATE public.presupuestos 
         SET secuencia = 'Entregado',
             estado = 'Entregado',
             estado_logistico = 'ENTREGADO',
             fecha_entrega_real = NOW(),
             motivo_no_entrega = NULL, -- Limpiar motivo anterior
             fecha_actualizacion = NOW()
         WHERE id = $1`,
        [MOCK_BUDGET_ID]
    );

    // 3. Registrar evento de entrega parcial en public.entregas_eventos
    await client.query(
        `INSERT INTO public.entregas_eventos 
         (id_presupuesto, receptor_nombre, receptor_vinculo, dni_receptor,
          fecha_entrega, observaciones, tipo_evento)
         VALUES ($1, 'Chofer (QR)', 'Chofer', null, NOW(), $2, 'ENTREGA_PARCIAL')`,
        [MOCK_BUDGET_ID, observacionesChofer]
    );

    // Verificar en BD
    const checkCase2_Presupuesto = await client.query(
      'SELECT motivo_no_entrega, estado_logistico, secuencia FROM public.presupuestos WHERE id = $1',
      [MOCK_BUDGET_ID]
    );
    const checkCase2_Detalle = await client.query(
      'SELECT cantidad_original, cantidad, diferencia FROM public.presupuestos_detalles WHERE id_presupuesto_ext = $1 AND articulo = $2',
      [MOCK_BUDGET_EXT_ID, 'ART-TEST-1']
    );
    const checkCase2_Evento = await client.query(
      'SELECT tipo_evento, observaciones FROM public.entregas_eventos WHERE id_presupuesto = $1 AND tipo_evento = $2',
      [MOCK_BUDGET_ID, 'ENTREGA_PARCIAL']
    );

    const p2 = checkCase2_Presupuesto.rows[0];
    const d2 = checkCase2_Detalle.rows[0];
    const e2 = checkCase2_Evento.rows[0];

    console.log('Verificación Case 2:');
    console.log('  - motivo_no_entrega:', p2.motivo_no_entrega, '(esperado: null)');
    console.log('  - estado_logistico:', p2.estado_logistico, '(esperado: ENTREGADO)');
    console.log('  - cantidad_original:', d2.cantidad_original, '(esperado: 10)');
    console.log('  - cantidad:', d2.cantidad, '(esperado: 8)');
    console.log('  - diferencia:', d2.diferencia, '(esperado: 2)');
    console.log('  - tipo_evento:', e2.tipo_evento, '(esperado: ENTREGA_PARCIAL)');
    console.log('  - observaciones:', e2.observaciones, `(esperado: ${observacionesChofer})`);

    if (
      p2.motivo_no_entrega === null && 
      p2.estado_logistico === 'ENTREGADO' &&
      parseFloat(d2.cantidad_original) === 10.0 &&
      parseFloat(d2.cantidad) === 8.0 &&
      parseFloat(d2.diferencia) === 2.0 &&
      e2.tipo_evento === 'ENTREGA_PARCIAL'
    ) {
      console.log('✅ TEST CASE 2 exitoso!');
    } else {
      throw new Error('TEST CASE 2 falló: discrepancias en los valores guardados.');
    }

    // Rollback para no dejar basura en la BD
    await client.query('ROLLBACK');
    console.log('\n🏁 [TEST] Finalizado exitosamente. Todos los tests pasaron y la BD fue devuelta a su estado limpio.');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ [TEST] Error durante la ejecución de pruebas:', error.message);
  } finally {
    client.release();
    pool.end();
  }
}

run();
