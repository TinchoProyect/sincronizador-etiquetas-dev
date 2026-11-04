/**
 * Servicio de Cuenta Corriente (Módulo Facturación)
 * Se encarga de la integración automática de facturas emitidas con la cuenta corriente de Clientes Búnker.
 */

const TIPO_COMPROBANTE_MAP = {
    1: 'Factura A',
    2: 'Nota de Débito A',
    3: 'Nota de Crédito A',
    6: 'Factura B',
    7: 'Nota de Débito B',
    8: 'Nota de Crédito B',
    11: 'Factura C',
    12: 'Nota de Débito C',
    13: 'Nota de Crédito C'
};

/**
 * Registra una factura (aprobada oficial o local) en la cuenta corriente del cliente correspondiente.
 * Ejecutado dentro de la transacción de emisión de la factura.
 * 
 * @param {Object} factura - Objeto factura devuelto por la base de datos
 * @param {Object} dbClient - Cliente de base de datos de la transacción activa (pg.Client)
 */
const registrarFactura = async (factura, dbClient) => {
    console.log(`🔌 [CC-VINCULACION] Evaluando factura ID: ${factura.id} para registro en Cuenta Corriente...`);

    if (!factura.cliente_id) {
        console.log('⚠️ [CC-VINCULACION] Factura sin cliente_id. Se omite registro en cuenta corriente.');
        return;
    }

    try {
        // 1. Resolver el cliente búnker asociado por lomas_soft_id (conversión de string a entero)
        const queryCliente = `
            SELECT id, codigo_bunker_cliente, cliente_nombre 
            FROM public.bunker_clientes 
            WHERE (CASE WHEN lomas_soft_id ~ '^\\d+$' THEN lomas_soft_id::integer ELSE NULL END) = $1
            LIMIT 1
        `;
        const resCliente = await dbClient.query(queryCliente, [factura.cliente_id]);

        if (resCliente.rows.length === 0) {
            console.log(`⚠️ [CC-VINCULACION] No se encontró cliente Búnker para lomas_soft_id/cliente_id: ${factura.cliente_id}. Se omite registro.`);
            return;
        }

        const cliente = resCliente.rows[0];
        console.log(`👤 [CC-VINCULACION] Cliente Búnker identificado: ${cliente.cliente_nombre} (${cliente.codigo_bunker_cliente})`);

        // 2. Obtener o crear cuenta corriente "Cuenta Principal" para este cliente
        let ccId;
        let saldoActual = 0;

        const queryCC = `
            SELECT id, saldo 
            FROM public.factura_cuentas_corrientes 
            WHERE codigo_bunker_cliente = $1 AND nombre_cuenta = 'Cuenta Principal'
            FOR UPDATE
        `; // FOR UPDATE bloquea la fila para evitar race conditions en cálculos de saldo
        const resCC = await dbClient.query(queryCC, [cliente.codigo_bunker_cliente]);

        if (resCC.rows.length === 0) {
            // Auto-apertura de la cuenta corriente principal
            const queryCrearCC = `
                INSERT INTO public.factura_cuentas_corrientes (codigo_bunker_cliente, nombre_cuenta, moneda, saldo)
                VALUES ($1, 'Cuenta Principal', 'ARS', 0.00)
                RETURNING id, saldo
            `;
            const resNuevaCC = await dbClient.query(queryCrearCC, [cliente.codigo_bunker_cliente]);
            ccId = resNuevaCC.rows[0].id;
            saldoActual = 0;
            console.log(`💳 [CC-VINCULACION] Cuenta Corriente creada automáticamente para el cliente: ${cliente.codigo_bunker_cliente}`);
        } else {
            ccId = resCC.rows[0].id;
            saldoActual = parseFloat(resCC.rows[0].saldo);
            console.log(`💳 [CC-VINCULACION] Cuenta Corriente existente (ID: ${ccId}), Saldo Actual: ${saldoActual}`);
        }

        // 3. Determinar tipo de comprobante, movimiento y monto
        const esNotaCredito = [3, 8, 13].includes(parseInt(factura.tipo_cbte));
        const tipoMovimiento = esNotaCredito ? 'CREDITO' : 'DEBITO';
        const monto = parseFloat(factura.imp_total);

        // Control de IDEMPOTENCIA / ACTUALIZACIÓN: Verificar si ya existe movimiento para esta factura
        const queryMovExistente = `
            SELECT id, tipo_comprobante, fecha_movimiento, metadatos FROM public.factura_cuenta_corriente_movimientos 
            WHERE cuenta_corriente_id = $1 AND comprobante_id = $2
        `;
        const resMovExistente = await dbClient.query(queryMovExistente, [ccId, factura.id]);

        let tipoCompText = TIPO_COMPROBANTE_MAP[factura.tipo_cbte] || 'Factura';
        let desc = '';
        if (factura.pto_vta === 90) {
            const cbtePad = String(factura.nro_interno || factura.cbte_nro || '0').padStart(8, '0');
            const prefix = esNotaCredito ? 'Rem' : 'Fac';
            desc = `${prefix} X0090-${cbtePad}`;
        } else if (factura.estado === 'APROBADA') {
            const ptoVtaPad = String(factura.pto_vta).padStart(4, '0');
            const cbtePad = String(factura.cbte_nro).padStart(8, '0');
            desc = `${tipoCompText} ${ptoVtaPad}-${cbtePad} (CAE: ${factura.cae || 'N/A'})`;
        } else {
            // Emisión local (interna)
            const ptoVtaPad = String(factura.pto_vta || '0').padStart(4, '0');
            const cbtePad = String(factura.nro_interno || factura.cbte_nro || '0').padStart(8, '0');
            desc = `${tipoCompText} Interna ${ptoVtaPad}-${cbtePad}`;
        }

        if (resMovExistente.rows.length > 0) {
            const movPrevio = resMovExistente.rows[0];
            console.log(`ℹ️ [CC-VINCULACION] La factura ID ${factura.id} ya posee movimiento en CC (ID: ${movPrevio.id}, Tipo: ${movPrevio.tipo_comprobante}). Actualizando datos oficiales...`);
            
            const metaPrev = movPrevio.metadatos
                ? (typeof movPrevio.metadatos === 'string' ? JSON.parse(movPrevio.metadatos) : movPrevio.metadatos)
                : {};
            let descFinal = desc;
            let fechaMovFinal = factura.fecha_emision || new Date();
            if (metaPrev && metaPrev.es_cargo_financiacion) {
                const refFin = metaPrev.codigo_sobre ? `Sobre #${metaPrev.codigo_sobre}` : `Pago #${metaPrev.pago_origen_id || ''}`;
                descFinal = `${desc} — Servicio Financiación (${refFin})`;
                fechaMovFinal = movPrevio.fecha_movimiento || fechaMovFinal;
            }

            await dbClient.query(`
                UPDATE public.factura_cuenta_corriente_movimientos
                SET tipo_comprobante = $1,
                    descripcion = $2,
                    fecha_movimiento = $3
                WHERE id = $4
            `, [
                esNotaCredito ? 'NOTA_CREDITO' : 'FACTURA',
                descFinal,
                fechaMovFinal,
                movPrevio.id
            ]);
            console.log(`✅ [CC-VINCULACION] Movimiento previo ${movPrevio.id} actualizado a comprobante oficial sin duplicar saldo.`);
            return;
        }

        // Recalcular saldo resultante
        const nuevoSaldo = esNotaCredito ? (saldoActual - monto) : (saldoActual + monto);

        // 4. Insertar movimiento (con saldo_resultante temporal 0, luego recalculado)
        const queryInsertMov = `
            INSERT INTO public.factura_cuenta_corriente_movimientos (
                cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
                tipo_comprobante, comprobante_id, descripcion, fecha_movimiento
            ) VALUES ($1, $2, $3, 0.00, $4, $5, $6, $7)
            RETURNING id
        `;
        const fechaEmision = factura.fecha_emision || new Date();
        await dbClient.query(queryInsertMov, [
            ccId,
            tipoMovimiento,
            monto,
            esNotaCredito ? 'NOTA_CREDITO' : 'FACTURA',
            factura.id,
            desc,
            fechaEmision
        ]);
        console.log(`➕ [CC-VINCULACION] Movimiento de ${tipoMovimiento} insertado. Monto: ${monto}.`);

        // 7. Recalcular robustamente todos los saldos de la cuenta de forma cronológica
        await recalcularSaldosCC(ccId, dbClient);

    } catch (error) {
        console.error(`❌ [CC-VINCULACION] Error al registrar factura en cuenta corriente:`, error);
        // Lanzamos el error para hacer rollback de la transacción de facturación
        throw error;
    }
};

/**
 * Registra una entrega con facturación diferida (débito provisorio en Cuenta Corriente)
 * @param {Object} factura - Objeto factura en estado BORRADOR que pasa a PENDIENTE_FACTURACION
 * @param {Object} dbClient - Cliente de base de datos de la transacción activa (pg.Client)
 */
const registrarEntregaDiferida = async (factura, dbClient) => {
    console.log(`🔌 [CC-VINCULACION] Registrando entrega con facturación diferida para factura ID: ${factura.id}...`);

    if (!factura.cliente_id) {
        console.log('⚠️ [CC-VINCULACION] Factura sin cliente_id. Se omite registro en cuenta corriente.');
        return;
    }

    try {
        const queryCliente = `
            SELECT id, codigo_bunker_cliente, cliente_nombre 
            FROM public.bunker_clientes 
            WHERE (CASE WHEN lomas_soft_id ~ '^\\d+$' THEN lomas_soft_id::integer ELSE NULL END) = $1
            LIMIT 1
        `;
        const resCliente = await dbClient.query(queryCliente, [factura.cliente_id]);

        if (resCliente.rows.length === 0) {
            console.log(`⚠️ [CC-VINCULACION] No se encontró cliente Búnker para cliente_id: ${factura.cliente_id}.`);
            return;
        }

        const cliente = resCliente.rows[0];

        // Obtener o crear cuenta corriente
        const queryCC = `
            SELECT id, saldo 
            FROM public.factura_cuentas_corrientes 
            WHERE codigo_bunker_cliente = $1 AND nombre_cuenta = 'Cuenta Principal'
            FOR UPDATE
        `;
        let resCC = await dbClient.query(queryCC, [cliente.codigo_bunker_cliente]);
        let ccId;

        if (resCC.rows.length === 0) {
            const resNuevaCC = await dbClient.query(`
                INSERT INTO public.factura_cuentas_corrientes (codigo_bunker_cliente, nombre_cuenta, moneda, saldo)
                VALUES ($1, 'Cuenta Principal', 'ARS', 0.00)
                RETURNING id, saldo
            `, [cliente.codigo_bunker_cliente]);
            ccId = resNuevaCC.rows[0].id;
        } else {
            ccId = resCC.rows[0].id;
        }

        // Control de idempotencia
        const resMovExistente = await dbClient.query(`
            SELECT id FROM public.factura_cuenta_corriente_movimientos 
            WHERE cuenta_corriente_id = $1 AND comprobante_id = $2
        `, [ccId, factura.id]);

        if (resMovExistente.rows.length > 0) {
            console.log(`⚠️ [CC-VINCULACION] Ya existe movimiento de cuenta corriente para comprobante ID: ${factura.id}`);
            return;
        }

        const monto = parseFloat(factura.imp_total);
        const desc = `Entrega Mercadería (Pendiente Facturación AFIP) - Borrador #${factura.id}`;

        await dbClient.query(`
            INSERT INTO public.factura_cuenta_corriente_movimientos (
                cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
                tipo_comprobante, comprobante_id, descripcion, fecha_movimiento
            ) VALUES ($1, 'DEBITO', $2, 0.00, 'PENDIENTE_FACTURACION', $3, $4, NOW())
        `, [ccId, monto, factura.id, desc]);

        console.log(`➕ [CC-VINCULACION] Débito de Entrega Diferida insertado: $${monto}`);

        // Recalcular saldo
        await recalcularSaldosCC(ccId, dbClient);

    } catch (error) {
        console.error(`❌ [CC-VINCULACION] Error registrando entrega diferida:`, error);
        throw error;
    }
};

/**
 * Revierte la entrega diferida eliminando el movimiento provisorio de la cuenta corriente
 * @param {Object} factura - Objeto factura
 * @param {Object} dbClient - Cliente de base de datos
 */
const revertirEntregaDiferida = async (factura, dbClient) => {
    console.log(`🔌 [CC-VINCULACION] Revirtiendo entrega diferida para factura ID: ${factura.id}...`);

    try {
        const resMov = await dbClient.query(`
            SELECT id, cuenta_corriente_id 
            FROM public.factura_cuenta_corriente_movimientos 
            WHERE comprobante_id = $1 AND tipo_comprobante = 'PENDIENTE_FACTURACION'
        `, [factura.id]);

        if (resMov.rows.length === 0) {
            console.log(`ℹ️ [CC-VINCULACION] No se encontró movimiento diferido previo para revertir.`);
            return;
        }

        const ccId = resMov.rows[0].cuenta_corriente_id;

        await dbClient.query(`
            DELETE FROM public.factura_cuenta_corriente_movimientos 
            WHERE id = $1
        `, [resMov.rows[0].id]);

        console.log(`🗑️ [CC-VINCULACION] Movimiento diferido eliminado de CC. Recalculando saldos...`);
        await recalcularSaldosCC(ccId, dbClient);

    } catch (error) {
        console.error(`❌ [CC-VINCULACION] Error revirtiendo entrega diferida en CC:`, error);
        throw error;
    }
};

/**
 * Función auxiliar para recalcular saldos de forma cronológica
 */
const recalcularSaldosCC = async (ccId, dbClient) => {
    const resCCInfo = await dbClient.query(
        `SELECT saldo_apertura FROM public.factura_cuentas_corrientes WHERE id = $1`,
        [ccId]
    );
    const saldoApertura = resCCInfo.rows.length > 0 ? parseFloat(resCCInfo.rows[0].saldo_apertura) || 0 : 0;

    const resMovs = await dbClient.query(
        `SELECT id, tipo_movimiento, monto 
         FROM public.factura_cuenta_corriente_movimientos 
         WHERE cuenta_corriente_id = $1 
         ORDER BY fecha_movimiento ASC, id ASC`,
        [ccId]
    );

    let saldoAcumulado = saldoApertura;
    for (const mov of resMovs.rows) {
        const m = parseFloat(mov.monto) || 0;
        if (mov.tipo_movimiento === 'DEBITO') {
            saldoAcumulado += m;
        } else if (mov.tipo_movimiento === 'CREDITO') {
            saldoAcumulado -= m;
        }
        saldoAcumulado = parseFloat(saldoAcumulado.toFixed(2));

        await dbClient.query(
            `UPDATE public.factura_cuenta_corriente_movimientos 
             SET saldo_resultante = $1 
             WHERE id = $2`,
            [saldoAcumulado, mov.id]
        );
    }

    const queryUpdateCC = `
        UPDATE public.factura_cuentas_corrientes 
        SET saldo = $1, actualizada_en = CURRENT_TIMESTAMP
        WHERE id = $2
    `;
    await dbClient.query(queryUpdateCC, [saldoAcumulado, ccId]);
    console.log(`✅ [CC-VINCULACION] Cuenta Corriente ID ${ccId} recalculada. Saldo final: ${saldoAcumulado}`);
};

module.exports = {
    registrarFactura,
    registrarEntregaDiferida,
    revertirEntregaDiferida
};
