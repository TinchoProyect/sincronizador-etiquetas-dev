/**
 * Servicio de Cuenta Corriente (Módulo Logística)
 * Gestiona el acceso al maestro de cuentas corrientes y el registro de movimientos manuales.
 */

const { pool, ejecutarTransaccion } = require('../config/database');

class CuentaCorrienteService {
    /**
     * Obtiene todas las cuentas corrientes asociadas a un cliente.
     * Si no tiene ninguna, abre automáticamente la "Cuenta Principal".
     * 
     * @param {string} codigoBunkerCliente - Código local del cliente
     * @returns {Promise<Array>} Cuentas corrientes del cliente
     */
    static async obtenerCuentasPorCliente(codigoBunkerCliente) {
        console.log(`🔍 [CC-SERVICE] Buscando cuentas corrientes para cliente: ${codigoBunkerCliente}`);
        
        const res = await pool.query(
            `SELECT id, codigo_bunker_cliente, nombre_cuenta, moneda, saldo, saldo_apertura, estado, creada_en, actualizada_en 
             FROM public.factura_cuentas_corrientes 
             WHERE codigo_bunker_cliente = $1 
             ORDER BY creada_en ASC`,
            [codigoBunkerCliente]
        );

        if (res.rows.length === 0) {
            // Auto-apertura: Verificar si el cliente existe en el maestro
            const checkCliente = await pool.query(
                `SELECT codigo_bunker_cliente FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1`,
                [codigoBunkerCliente]
            );

            if (checkCliente.rows.length > 0) {
                console.log(`💳 [CC-SERVICE] Creando Cuenta Principal por auto-apertura para cliente: ${codigoBunkerCliente}`);
                const insertCC = await pool.query(
                    `INSERT INTO public.factura_cuentas_corrientes (codigo_bunker_cliente, nombre_cuenta, moneda, saldo, saldo_apertura) 
                     VALUES ($1, 'Cuenta Principal', 'ARS', 0.00, 0.00) 
                     RETURNING *`,
                    [codigoBunkerCliente]
                );
                return [insertCC.rows[0]];
            }
        }

        return res.rows;
    }

    /**
     * Crea una nueva cuenta corriente para un cliente.
     * 
     * @param {string} codigoBunkerCliente - Código local del cliente
     * @param {string} nombreCuenta - Nombre descriptivo de la cuenta
     * @returns {Promise<Object>} Cuenta corriente creada
     */
    static async crearCuentaCorriente(codigoBunkerCliente, nombreCuenta) {
        console.log(`➕ [CC-SERVICE] Creando cuenta corriente "${nombreCuenta}" para cliente: ${codigoBunkerCliente}`);
        
        // Validar si el cliente existe
        const checkCliente = await pool.query(
            `SELECT codigo_bunker_cliente FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1`,
            [codigoBunkerCliente]
        );
        if (checkCliente.rows.length === 0) {
            throw new Error(`El cliente con código "${codigoBunkerCliente}" no existe.`);
        }

        // Crear la cuenta
        const res = await pool.query(
            `INSERT INTO public.factura_cuentas_corrientes (codigo_bunker_cliente, nombre_cuenta, moneda, saldo, saldo_apertura) 
             VALUES ($1, $2, 'ARS', 0.00, 0.00) 
             RETURNING *`,
            [codigoBunkerCliente, nombreCuenta.trim()]
        );
        return res.rows[0];
    }

    /**
     * Obtiene el historial de movimientos de una cuenta corriente específica.
     * Incluye datos opcionales de facturas enlazadas.
     * 
     * @param {number} cuentaId - ID de la cuenta corriente
     * @returns {Promise<Array>} Historial de movimientos
     */
    static async obtenerMovimientos(cuentaId) {
        console.log(`🔍 [CC-SERVICE] Obteniendo movimientos para cuenta corriente ID: ${cuentaId}`);
        
        const query = `
            SELECT 
                m.id, m.cuenta_corriente_id, m.tipo_movimiento, m.monto, m.saldo_resultante, 
                m.tipo_comprobante, m.comprobante_id, m.presupuesto_id, m.descripcion, m.fecha_movimiento, m.creado_en, m.metadatos,
                f.estado as factura_estado, f.pto_vta
            FROM public.factura_cuenta_corriente_movimientos m
            LEFT JOIN public.factura_facturas f ON m.comprobante_id = f.id
            WHERE m.cuenta_corriente_id = $1 
            ORDER BY m.fecha_movimiento DESC, m.id DESC
        `;
        const res = await pool.query(query, [cuentaId]);
        const rows = res.rows;

        // Inyectar fila virtual para el Saldo de Apertura si existe y no es cero
        try {
            const ccRes = await pool.query(
                'SELECT saldo_apertura, creada_en FROM public.factura_cuentas_corrientes WHERE id = $1',
                [cuentaId]
            );
            if (ccRes.rows.length > 0) {
                const cc = ccRes.rows[0];
                const saldoApertura = parseFloat(cc.saldo_apertura) || 0;
                if (saldoApertura !== 0) {
                    rows.push({
                        id: `apertura-${cuentaId}`,
                        cuenta_corriente_id: cuentaId,
                        tipo_movimiento: saldoApertura > 0 ? 'DEBITO' : 'CREDITO',
                        monto: Math.abs(saldoApertura),
                        saldo_resultante: saldoApertura,
                        tipo_comprobante: 'AJUSTE_APERTURA',
                        comprobante_id: null,
                        presupuesto_id: null,
                        descripcion: 'Ajuste de Apertura / Saldo Inicial de Cuenta',
                        fecha_movimiento: cc.creada_en || new Date(),
                        creado_en: cc.creada_en || new Date(),
                        metadatos: null
                    });
                }
            }
        } catch (e) {
            console.error('❌ [CC-SERVICE] Error al inyectar saldo de apertura virtual:', e.message);
        }

        return rows;
    }

    /**
     * Registra un movimiento manual (tipo cobro/pago o ajuste) en una cuenta corriente.
     * Recalcula el saldo actual de forma transaccional.
     * 
     * @param {Object} datos - Atributos del movimiento
     * @param {number} datos.cuenta_corriente_id - ID de la cuenta
     * @param {string} datos.tipo_movimiento - 'DEBITO' o 'CREDITO'
     * @param {number} datos.monto - Monto del movimiento (positivo)
     * @param {string} datos.descripcion - Razón o concepto
     * @param {string} [datos.tipo_comprobante] - Opcional (e.g. 'RECIBO_PAGO', 'AJUSTE_MANUAL')
     * @param {string} [datos.fecha_movimiento] - Opcional (por defecto, ahora)
     * @returns {Promise<Object>} Movimiento registrado
     */
    static async registrarMovimientoManual(datos) {
        const { cuenta_corriente_id, tipo_movimiento, monto, descripcion, tipo_comprobante, fecha_movimiento, metadatos } = datos;
        
        console.log(`📝 [CC-SERVICE] Registrando movimiento manual para CC ID: ${cuenta_corriente_id}`);
        console.log(`   - Tipo: ${tipo_movimiento}, Monto: ${monto}, Desc: "${descripcion}"`);

        // Validaciones básicas
        if (!cuenta_corriente_id) throw new Error('El ID de cuenta corriente es obligatorio.');
        if (!tipo_movimiento || !['DEBITO', 'CREDITO'].includes(tipo_movimiento)) {
            throw new Error('El tipo de movimiento debe ser DEBITO o CREDITO.');
        }
        const montoNum = parseFloat(monto);
        if (isNaN(montoNum) || montoNum <= 0) {
            throw new Error('El monto debe ser un número positivo mayor que cero.');
        }
        
        // La descripción es opcional. Si está vacía, se asigna una cadena vacía.
        const descFinal = (descripcion && descripcion.trim()) ? descripcion.trim() : '';

        return await ejecutarTransaccion(async (client) => {
            // 1. Obtener saldo actual y bloquear la fila para evitar escrituras concurrentes
            const ccRes = await client.query(
                `SELECT saldo FROM public.factura_cuentas_corrientes WHERE id = $1 FOR UPDATE`,
                [cuenta_corriente_id]
            );

            if (ccRes.rows.length === 0) {
                throw new Error('La cuenta corriente especificada no existe.');
            }

            const saldoActual = parseFloat(ccRes.rows[0].saldo);
            const esCredito = tipo_movimiento === 'CREDITO';
            const nuevoSaldo = esCredito ? (saldoActual - montoNum) : (saldoActual + montoNum);

            // 2. Insertar movimiento
            const queryInsertMov = `
                INSERT INTO public.factura_cuenta_corriente_movimientos (
                    cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
                    tipo_comprobante, descripcion, fecha_movimiento, metadatos
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `;
            const resInsert = await client.query(queryInsertMov, [
                cuenta_corriente_id,
                tipo_movimiento,
                montoNum,
                nuevoSaldo,
                tipo_comprobante || 'AJUSTE_MANUAL',
                descFinal,
                fecha_movimiento || new Date(),
                metadatos || null
            ]);

            // 3. Recalcular saldos de toda la cuenta (garantiza orden cronológico en saldo_resultante)
            await this.recalcularSaldos(cuenta_corriente_id, client);

            console.log(`✅ [CC-SERVICE] Movimiento registrado y saldo recalculado.`);
            return resInsert.rows[0];
        });
    }

    /**
     * Registra un ajuste automático para neutralizar saldos mínimos.
     * Cierra el saldo de la cuenta a exactamente $ 0,00 de forma natural.
     * 
     * @param {number} cuentaId - ID de la cuenta corriente
     * @param {string} operador - Nombre del operador que ejecuta la acción
     * @returns {Promise<Object>} Movimiento de ajuste registrado
     */
    static async registrarAjusteAutomatico(cuentaId, operador = 'Sistema') {
        const umbral = parseFloat(process.env.UMBRAL_AJUSTE_MINIMO) || 50.00;
        console.log(`⚡ [CC-SERVICE] Registrando ajuste automático para CC ID: ${cuentaId} (Operador: ${operador}, Umbral: $${umbral})`);

        return await ejecutarTransaccion(async (client) => {
            // 1. Obtener saldo actual y bloquear la fila
            const ccRes = await client.query(
                `SELECT saldo FROM public.factura_cuentas_corrientes WHERE id = $1 FOR UPDATE`,
                [cuentaId]
            );

            if (ccRes.rows.length === 0) {
                throw new Error('La cuenta corriente especificada no existe.');
            }

            const saldoActual = parseFloat(ccRes.rows[0].saldo);
            if (saldoActual === 0) {
                throw new Error('La cuenta ya se encuentra con saldo en cero ($ 0,00).');
            }

            const absSaldo = Math.abs(saldoActual);
            if (absSaldo > umbral) {
                throw new Error(`El saldo actual ($ ${saldoActual}) supera el umbral máximo de ajuste automático ($ ${umbral}).`);
            }

            // Para llegar a cero de forma matemática natural:
            // Si saldoActual > 0 (deudor): hacemos un CREDITO (pago) para restar y llegar a 0.
            // Si saldoActual < 0 (a favor): hacemos un DEBITO (cargo) para sumar y llegar a 0.
            const tipo_movimiento = saldoActual > 0 ? 'CREDITO' : 'DEBITO';
            const esCredito = tipo_movimiento === 'CREDITO';
            const nuevoSaldo = esCredito ? (saldoActual - absSaldo) : (saldoActual + absSaldo);
            const nuevoSaldoSanitizado = parseFloat(nuevoSaldo.toFixed(2));

            // 2. Insertar movimiento
            const queryInsertMov = `
                INSERT INTO public.factura_cuenta_corriente_movimientos (
                    cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
                    tipo_comprobante, descripcion, fecha_movimiento
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `;
            const resInsert = await client.query(queryInsertMov, [
                cuentaId,
                tipo_movimiento,
                absSaldo,
                nuevoSaldoSanitizado,
                'AJUSTE_AUTOMATICO',
                `Ajuste automático por saldo mínimo [Operador: ${operador.trim()}]`,
                new Date()
            ]);

            // 3. Actualizar saldo en cuenta corriente
            await client.query(
                `UPDATE public.factura_cuentas_corrientes 
                 SET saldo = $1, actualizada_en = CURRENT_TIMESTAMP 
                 WHERE id = $2`,
                [nuevoSaldoSanitizado, cuentaId]
            );

            console.log(`✅ [CC-SERVICE] Ajuste automático registrado. Nuevo Saldo: ${nuevoSaldoSanitizado}`);
            return resInsert.rows[0];
        });
    }

    /**
     * Recalcula cronológicamente los saldos resultantes de todos los movimientos
     * y actualiza el saldo consolidado de la cuenta corriente.
     * 
     * @param {number} cuentaId - ID de la cuenta corriente
     * @param {Object} client - Cliente de transacción pg
     */
    static async recalcularSaldos(cuentaId, client) {
        console.log(`🔄 [CC-SERVICE] Recalculando saldos para cuenta corriente ID: ${cuentaId}`);
        
        // 0. Obtener el saldo de apertura
        const resCC = await client.query(
            `SELECT saldo_apertura FROM public.factura_cuentas_corrientes WHERE id = $1`,
            [cuentaId]
        );
        const saldoApertura = resCC.rows.length > 0 ? parseFloat(resCC.rows[0].saldo_apertura) || 0 : 0;
        console.log(`   - Saldo de Apertura registrado: $${saldoApertura}`);

        // 1. Obtener todos los movimientos ordenados por fecha y ID
        const resMovs = await client.query(
            `SELECT id, tipo_movimiento, monto 
             FROM public.factura_cuenta_corriente_movimientos 
             WHERE cuenta_corriente_id = $1 
             ORDER BY fecha_movimiento ASC, id ASC`,
            [cuentaId]
        );

        let saldoAcumulado = saldoApertura;

        // 2. Iterar y actualizar cada movimiento
        for (const mov of resMovs.rows) {
            const monto = parseFloat(mov.monto) || 0;
            if (mov.tipo_movimiento === 'DEBITO') {
                saldoAcumulado += monto;
            } else if (mov.tipo_movimiento === 'CREDITO') {
                saldoAcumulado -= monto;
            }
            saldoAcumulado = parseFloat(saldoAcumulado.toFixed(2));

            await client.query(
                `UPDATE public.factura_cuenta_corriente_movimientos 
                 SET saldo_resultante = $1 
                 WHERE id = $2`,
                [saldoAcumulado, mov.id]
            );
        }

        // 3. Actualizar el saldo final consolidado
        await client.query(
            `UPDATE public.factura_cuentas_corrientes 
             SET saldo = $1, actualizada_en = CURRENT_TIMESTAMP 
             WHERE id = $2`,
            [saldoAcumulado, cuentaId]
        );

        console.log(`✅ [CC-SERVICE] Recálculo completado. Saldo resultante consolidado: $${saldoAcumulado}`);
        return saldoAcumulado;
    }

    /**
     * Parsea de manera segura y defensiva un string de comprobante Lomasoft.
     * Soporta formatos como 'E-0002-00016726', '7-154', 'A-007-123', etc.
     * 
     * @param {string} comp - Cadena del comprobante a parsear
     */
    static parseComprobante(comp) {
        if (!comp || typeof comp !== 'string') {
            return { letra: '-', puesto: '-', numero: '-' };
        }
        
        const clean = comp.trim();
        if (!clean) {
            return { letra: '-', puesto: '-', numero: '-' };
        }

        // Split by dash/spaces
        const parts = clean.split(/[- ]+/).map(p => p.trim()).filter(Boolean);
        
        // Case 1: Standard 3 parts (e.g., E-0002-00016726, A-007-123)
        if (parts.length >= 3) {
            let letra = parts[0].toUpperCase();
            let puesto = parts[1];
            let numero = parts[2];
            
            // If the first part contains a letter and digits (e.g. E03-12-34)
            const firstPartMatch = parts[0].match(/^([A-Za-z]+)(\d+)$/);
            if (firstPartMatch) {
                letra = firstPartMatch[1].toUpperCase();
                puesto = firstPartMatch[2];
                // Combine the remaining numeric parts
                numero = parts.slice(1).join('');
            }
            
            return {
                letra,
                puesto: puesto.padStart(4, '0'),
                numero: numero.padStart(8, '0')
            };
        }
        
        // Case 2: 2 parts (e.g., 7-154, E-000200016726, E0002-00016726)
        if (parts.length === 2) {
            const p1 = parts[0];
            const p2 = parts[1];
            
            // Check if first part is letter only (e.g. E-000200016726)
            const isP1Letter = /^[A-Za-z]+$/.test(p1);
            if (isP1Letter) {
                const letra = p1.toUpperCase();
                if (p2.length === 12) {
                    return {
                        letra,
                        puesto: p2.substring(0, 4),
                        numero: p2.substring(4)
                    };
                } else if (p2.length > 8) {
                    return {
                        letra,
                        puesto: p2.substring(0, p2.length - 8).padStart(4, '0'),
                        numero: p2.substring(p2.length - 8)
                    };
                }
                return {
                    letra,
                    puesto: '-',
                    numero: p2.padStart(8, '0')
                };
            }
            
            // Check if first part contains letter + digits (e.g., E0002-00016726)
            const p1LetterDigits = p1.match(/^([A-Za-z]+)(\d+)$/);
            if (p1LetterDigits) {
                return {
                    letra: p1LetterDigits[1].toUpperCase(),
                    puesto: p1LetterDigits[2].padStart(4, '0'),
                    numero: p2.padStart(8, '0')
                };
            }
            
            // If both are numeric (e.g., 7-154)
            if (/^\d+$/.test(p1) && /^\d+$/.test(p2)) {
                return {
                    letra: 'A',
                    puesto: p1.padStart(4, '0'),
                    numero: p2.padStart(8, '0')
                };
            }
        }
        
        // Case 3: 1 part (e.g., E000200016726, 12345)
        if (parts.length === 1) {
            const p = parts[0];
            const matchSingle = p.match(/^([A-Za-z]+)(\d+)$/);
            if (matchSingle) {
                const letra = matchSingle[1].toUpperCase();
                const rest = matchSingle[2];
                if (rest.length === 12) {
                    return {
                        letra,
                        puesto: rest.substring(0, 4),
                        numero: rest.substring(4)
                    };
                } else if (rest.length > 8) {
                    return {
                        letra,
                        puesto: rest.substring(0, rest.length - 8).padStart(4, '0'),
                        numero: rest.substring(rest.length - 8)
                    };
                }
                return {
                    letra,
                    puesto: '-',
                    numero: rest.padStart(8, '0')
                };
            }
            
            // Numeric only
            if (/^\d+$/.test(p)) {
                if (p.length > 8) {
                    return {
                        letra: 'A',
                        puesto: p.substring(0, p.length - 8).padStart(4, '0'),
                        numero: p.substring(p.length - 8)
                    };
                }
                return {
                    letra: 'A',
                    puesto: '-',
                    numero: p.padStart(8, '0')
                };
            }
        }

        return { letra: '-', puesto: '-', numero: clean };
    }

    /**
     * Obtiene presupuestos entregados de Lomasoft que no hayan sido incorporados a la CC.
     * 
     * @param {number} cuentaId - ID de la cuenta corriente
     */
    static async obtenerPresupuestosPendientesLomasoft(cuentaId) {
        console.log(`🔍 [CC-SERVICE] Buscando presupuestos Lomasoft pendientes para cuenta ID: ${cuentaId}`);
        
        // Obtener codigo_bunker_cliente
        const ccRes = await pool.query(
            `SELECT codigo_bunker_cliente FROM public.factura_cuentas_corrientes WHERE id = $1`,
            [cuentaId]
        );
        if (ccRes.rows.length === 0) {
            throw new Error('La cuenta corriente especificada no existe.');
        }
        const codigoBunker = ccRes.rows[0].codigo_bunker_cliente;

        // Consultar presupuestos que cumplan las condiciones y calcular su total aplicando descuento
        const query = `
            SELECT 
                p.id, p.fecha, p.comprobante_lomasoft, p.tipo_comprobante,
                COALESCE(
                    (SELECT SUM(cantidad * precio1) FROM public.presupuestos_detalles WHERE id_presupuesto = p.id) * 
                    CASE 
                        WHEN p.descuento IS NULL OR p.descuento = 0 THEN 1
                        WHEN p.descuento >= 1 THEN (1 - p.descuento / 100)
                        ELSE (1 - p.descuento)
                    END,
                    0
                ) as total
            FROM public.presupuestos p
            WHERE p.id_cliente::integer = (
                SELECT lomas_soft_id::integer 
                FROM public.bunker_clientes 
                WHERE codigo_bunker_cliente = $1
            )
            AND p.tipo_comprobante IN ('Factura', 'Orden de Retiro')
            AND p.estado IN ('Entregado', 'Administrativa NC', 'Conciliado')
            AND p.comprobante_lomasoft IS NOT NULL
            AND p.comprobante_lomasoft <> ''
            AND p.id NOT IN (
                SELECT presupuesto_id 
                FROM public.factura_cuenta_corriente_movimientos 
                WHERE cuenta_corriente_id = $2 AND presupuesto_id IS NOT NULL
            )
            ORDER BY p.fecha DESC, p.id DESC
        `;
        const res = await pool.query(query, [codigoBunker, cuentaId]);
        return res.rows.map(r => {
            const parsed = this.parseComprobante(r.comprobante_lomasoft);
            const tipo = r.tipo_comprobante === 'Orden de Retiro' ? 'CREDITO' : 'DEBITO';
            return {
                id: r.id,
                fecha: r.fecha,
                comprobante_lomasoft: r.comprobante_lomasoft,
                letra: parsed.letra,
                puesto: parsed.puesto,
                numero: parsed.numero,
                total: parseFloat(r.total),
                tipo: tipo
            };
        });
    }

    /**
     * Incorpora manualmente un presupuesto de Lomasoft como factura en la CC.
     * 
     * @param {number} cuentaId - ID de la cuenta corriente
     * @param {number} presupuestoId - ID del presupuesto
     */
    static async incorporarPresupuestoLomasoft(cuentaId, presupuestoId) {
        console.log(`➕ [CC-SERVICE] Incorporando presupuesto ID ${presupuestoId} en CC ID ${cuentaId}`);
        
        return await ejecutarTransaccion(async (client) => {
            // 1. Obtener datos del presupuesto
            const pRes = await client.query(
                `SELECT id, fecha, comprobante_lomasoft, tipo_comprobante FROM public.presupuestos WHERE id = $1`,
                [presupuestoId]
            );
            if (pRes.rows.length === 0) {
                throw new Error('El presupuesto especificado no existe.');
            }
            const p = pRes.rows[0];

            // 2. Calcular total aplicando descuento
            const tRes = await client.query(
                `SELECT 
                    COALESCE(
                        (SELECT SUM(cantidad * precio1) FROM public.presupuestos_detalles WHERE id_presupuesto = p.id) * 
                        CASE 
                            WHEN p.descuento IS NULL OR p.descuento = 0 THEN 1
                            WHEN p.descuento >= 1 THEN (1 - p.descuento / 100)
                            ELSE (1 - p.descuento)
                        END,
                        0
                    ) as total
                 FROM public.presupuestos p
                 WHERE p.id = $1`,
                [presupuestoId]
            );
            const total = parseFloat(tRes.rows[0].total) || 0;

            // 3. Insertar movimiento (con saldo_resultante temporal 0, luego recalculado)
            const esRetiro = p.tipo_comprobante === 'Orden de Retiro';
            const tipoMovimiento = esRetiro ? 'CREDITO' : 'DEBITO';
            const tipoComprobante = esRetiro ? 'NOTA_CREDITO' : 'FACTURA';
            const descripcion = esRetiro ? `Rem ${p.comprobante_lomasoft}` : `Fac ${p.comprobante_lomasoft}`;

            const queryInsert = `
                INSERT INTO public.factura_cuenta_corriente_movimientos (
                    cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
                    tipo_comprobante, presupuesto_id, descripcion, fecha_movimiento
                ) VALUES ($1, $2, $3, 0.00, $4, $5, $6, $7)
                RETURNING *
            `;
            const resInsert = await client.query(queryInsert, [
                cuentaId,
                tipoMovimiento,
                total,
                tipoComprobante,
                presupuestoId,
                descripcion,
                p.fecha || new Date()
            ]);

            // 4. Recalcular saldos de toda la cuenta
            await this.recalcularSaldos(cuentaId, client);

            return resInsert.rows[0];
        });
    }

    /**
     * Elimina físicamente un movimiento pero guardándolo en la tabla de auditoría.
     * Luego recalcula cronológicamente los saldos.
     * 
     * @param {number} movimientoId - ID del movimiento a eliminar
     * @param {string} motivo - Motivo o razón de la eliminación
     */
    static async eliminarMovimiento(movimientoId, motivo) {
        console.log(`🗑️ [CC-SERVICE] Solicitando eliminación del movimiento ID ${movimientoId} (Motivo: "${motivo}")`);
        
        return await ejecutarTransaccion(async (client) => {
            // 1. Obtener datos del movimiento
            const movRes = await client.query(
                `SELECT * FROM public.factura_cuenta_corriente_movimientos WHERE id = $1 FOR UPDATE`,
                [movimientoId]
            );
            if (movRes.rows.length === 0) {
                throw new Error('El movimiento especificado no existe.');
            }
            const m = movRes.rows[0];

            // 2. Insertar en tabla de auditoría de eliminados
            const queryAudit = `
                INSERT INTO public.factura_cuenta_corriente_movimientos_eliminados (
                    original_id, cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
                    tipo_comprobante, comprobante_id, presupuesto_id, descripcion, fecha_movimiento, creado_en, motivo_eliminacion
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `;
            await client.query(queryAudit, [
                m.id,
                m.cuenta_corriente_id,
                m.tipo_movimiento,
                parseFloat(m.monto),
                parseFloat(m.saldo_resultante),
                m.tipo_comprobante,
                m.comprobante_id ? parseInt(m.comprobante_id) : null,
                m.presupuesto_id ? parseInt(m.presupuesto_id) : null,
                m.descripcion,
                m.fecha_movimiento,
                m.creado_en,
                motivo
            ]);

            // 3. Eliminar registro original
            await client.query(
                `DELETE FROM public.factura_cuenta_corriente_movimientos WHERE id = $1`,
                [movimientoId]
            );

            // 4. Recalcular saldos
            await this.recalcularSaldos(m.cuenta_corriente_id, client);

            return true;
        });
    }
}

module.exports = CuentaCorrienteService;

