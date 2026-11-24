/**
 * Rutina idempotente de saneamiento y sincronización:
 *   1) Asegura columna public.bunker_clientes.dni (VARCHAR(20) DEFAULT NULL) + índice parcial.
 *   2) Completa public.bunker_clientes.dni desde cuit_cuil en personas físicas (20/23/24/27)
 *      con condición Consumidor Final (o sin condición), PRESERVANDO cuit_cuil intacto.
 *   3) Inserta en public.clientes los clientes Búnker faltantes con lomas_soft_id numérico
 *      (ej. CB-0036..CB-0064) y completa dni / cuit / condicion_iva faltantes en espejos ya existentes.
 *
 * Uso CLI:
 *   node scripts/sincronizarClientesBunkerALegacyYDni.js [--dry-run]
 *
 * Idempotencia garantizada: una segunda ejecución inmediata debe reportar totalCambios = 0.
 */

const path = require('path');
const { Pool } = require('pg');

// Cargar .env del proyecto sin pisar variables de entorno explícitas (ej. DB_NAME=etiquetas_pruebas)
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false });
} catch (_) { /* dotenv opcional */ }

function crearPoolLocal() {
    const esLab =
        String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase() === 'true' ||
        String(process.env.MODO_LABORATORIO || '').trim().toLowerCase() === 'true' ||
        String(process.env.DB_NAME || '').trim().toLowerCase() === 'etiquetas_pruebas';

    const database = process.env.DB_NAME || (esLab ? 'etiquetas_pruebas' : 'etiquetas');
    return new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'taKionga'
    });
}

function esCuitPersonaFisica(cuitDigits) {
    return /^\d{11}$/.test(cuitDigits) && /^(20|23|24|27)/.test(cuitDigits);
}

function extraerDniDesdeCuit(cuitDigits) {
    if (!esCuitPersonaFisica(cuitDigits)) return null;
    const raw = cuitDigits.slice(2, 10);
    const sinCero = raw.replace(/^0+/, '');
    return sinCero.length >= 7 ? sinCero : raw;
}

function extraerContacto(raw, campo) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (s.startsWith('[')) {
        try {
            const arr = JSON.parse(s);
            if (Array.isArray(arr)) {
                const item = arr.find(x => x && String(x[campo] || '').trim());
                if (item) return String(item[campo]).trim();
            }
        } catch (_) { /* texto plano */ }
        return null;
    }
    return s;
}

function construirNombreYApellidoLegacy(clienteNombre, razonSocial, clienteIdInt) {
    const cn = String(clienteNombre || '').trim();
    const rs = String(razonSocial || '').trim();
    let nombre = cn || rs || `Cliente ${clienteIdInt}`;
    let apellido = null;
    if (cn && rs && rs.toLowerCase() !== cn.toLowerCase()) {
        if (rs.toLowerCase().startsWith(cn.toLowerCase() + ' ')) {
            nombre = cn;
            apellido = rs.slice(cn.length).trim() || null;
        } else {
            nombre = cn;
            apellido = rs;
        }
    }
    return { nombre, apellido };
}

async function ejecutarSaneamiento({ pool: customPool = null, dryRun = false } = {}) {
    const pool = customPool || crearPoolLocal();
    const debeCerrarPool = !customPool;

    const resumen = {
        database: pool.options?.database || process.env.DB_NAME || 'desconocida',
        dryRun: Boolean(dryRun),
        columnaDniCreada: false,
        dniCompletadosBunker: 0,
        clientesLegacyInsertados: 0,
        clientesLegacyActualizados: 0,
        totalCambios: 0,
        detalles: []
    };

    try {
        // 1. Verificar / asegurar columna dni en public.bunker_clientes
        const colCheck = await pool.query(`
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'bunker_clientes'
              AND column_name = 'dni'
            LIMIT 1
        `);

        if (colCheck.rowCount === 0) {
            if (!dryRun) {
                await pool.query(`
                    ALTER TABLE public.bunker_clientes
                        ADD COLUMN IF NOT EXISTS dni VARCHAR(20) DEFAULT NULL;
                    CREATE INDEX IF NOT EXISTS idx_bunker_clientes_dni
                        ON public.bunker_clientes (dni) WHERE dni IS NOT NULL;
                `);
            }
            resumen.columnaDniCreada = true;
            resumen.totalCambios += 1;
        } else if (!dryRun) {
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_bunker_clientes_dni
                    ON public.bunker_clientes (dni) WHERE dni IS NOT NULL;
            `);
        }

        // 2. Leer todos los registros de bunker_clientes
        const resBunker = await pool.query(`
            SELECT
                id,
                codigo_bunker_cliente,
                cliente_nombre,
                razon_social,
                lomas_soft_id,
                cuit_cuil,
                ${colCheck.rowCount > 0 || !dryRun ? 'dni' : 'NULL::varchar AS dni'},
                condicion_iva,
                domicilio_fiscal,
                provincia,
                whatsapp_facturas,
                email_facturas,
                email_portal,
                preferencia_facturacion
            FROM public.bunker_clientes
            ORDER BY id ASC
        `);

        // 3. Backfill de dni en bunker_clientes desde cuit_cuil en personas físicas Consumidor Final
        for (const row of resBunker.rows) {
            const dniActual = String(row.dni || '').replace(/\D/g, '');
            const tieneDniValido = /^\d{7,8}$/.test(dniActual) && !/^0+$/.test(dniActual);
            const cuitDigits = String(row.cuit_cuil || '').replace(/\D/g, '');
            const condStr = String(row.condicion_iva || '').trim().toLowerCase();
            const esCF = !condStr || condStr.includes('consumidor') || condStr.includes('final');

            const dniExtraido = extraerDniDesdeCuit(cuitDigits);
            if (!tieneDniValido && esCF && dniExtraido) {
                if (!dryRun) {
                    await pool.query(
                        `UPDATE public.bunker_clientes SET dni = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                        [dniExtraido, row.id]
                    );
                }
                row.dni = dniExtraido;
                resumen.dniCompletadosBunker += 1;
                resumen.totalCambios += 1;
                resumen.detalles.push({
                    accion: 'BACKFILL_DNI_BUNKER',
                    codigo: row.codigo_bunker_cliente,
                    nombre: row.cliente_nombre,
                    cuit_preservado: cuitDigits,
                    dni_asignado: dniExtraido
                });
            }
        }

        // 4. Sincronizar hacia public.clientes todos los clientes Búnker con lomas_soft_id numérico
        const resLegacy = await pool.query(`
            SELECT cliente_id, nombre, apellido, cuit, dni, condicion_iva, domicilio, provincia, celular, email, preferencia_facturacion
            FROM public.clientes
        `);
        const mapaLegacy = new Map();
        for (const c of resLegacy.rows) {
            mapaLegacy.set(Number(c.cliente_id), c);
        }

        for (const row of resBunker.rows) {
            const rawLomas = String(row.lomas_soft_id || '').trim();
            if (!/^\d+$/.test(rawLomas) || rawLomas.length >= 10) continue;

            const clienteIdInt = parseInt(rawLomas, 10);
            if (!Number.isFinite(clienteIdInt) || clienteIdInt <= 0) continue;

            const cuitDigits = String(row.cuit_cuil || '').replace(/\D/g, '');
            const cuitVal = cuitDigits.length === 11 ? cuitDigits : null;
            const dniDigits = String(row.dni || '').replace(/\D/g, '');
            const dniVal = /^\d{7,8}$/.test(dniDigits) && !/^0+$/.test(dniDigits) ? dniDigits : null;
            const condVal = String(row.condicion_iva || '').trim() || 'Consumidor Final';
            const domVal = String(row.domicilio_fiscal || '').trim() || null;
            const provVal = String(row.provincia || '').trim() || null;
            const celVal = extraerContacto(row.whatsapp_facturas, 'numero');
            const mailVal = extraerContacto(row.email_facturas, 'email') || (String(row.email_portal || '').trim() || null);
            const prefVal = ['ARCA', 'INTERNO', 'PREGUNTAR'].includes(row.preferencia_facturacion)
                ? row.preferencia_facturacion
                : 'PREGUNTAR';

            const existente = mapaLegacy.get(clienteIdInt);
            if (!existente) {
                const { nombre, apellido } = construirNombreYApellidoLegacy(row.cliente_nombre, row.razon_social, clienteIdInt);
                if (!dryRun) {
                    await pool.query(
                        `INSERT INTO public.clientes (
                            cliente_id, nombre, apellido, cuit, dni, condicion_iva,
                            domicilio, provincia, celular, email, preferencia_facturacion,
                            created_at, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6,
                            $7, $8, $9, $10, $11,
                            NOW(), NOW()
                        )
                        ON CONFLICT (cliente_id) DO NOTHING`,
                        [clienteIdInt, nombre, apellido, cuitVal, dniVal, condVal, domVal, provVal, celVal, mailVal, prefVal]
                    );
                }
                mapaLegacy.set(clienteIdInt, {
                    cliente_id: clienteIdInt,
                    nombre,
                    apellido,
                    cuit: cuitVal,
                    dni: dniVal,
                    condicion_iva: condVal
                });
                resumen.clientesLegacyInsertados += 1;
                resumen.totalCambios += 1;
                resumen.detalles.push({
                    accion: 'INSERT_LEGACY_CLIENTE',
                    codigo: row.codigo_bunker_cliente,
                    cliente_id: clienteIdInt,
                    nombre,
                    apellido,
                    cuit: cuitVal,
                    dni: dniVal
                });
            } else {
                // Actualizar SOLO campos fiscales faltantes (dni vacío/'0', cuit vacío, condicion_iva vacía)
                const legacyDniLimpio = String(existente.dni || '').replace(/\D/g, '');
                const legacyTieneDni = /^\d{7,8}$/.test(legacyDniLimpio) && !/^0+$/.test(legacyDniLimpio);
                const legacyCuitLimpio = String(existente.cuit || '').replace(/\D/g, '');
                const legacyTieneCuit = legacyCuitLimpio.length === 11;
                const legacyCond = String(existente.condicion_iva || '').trim();

                const sets = [];
                const vals = [];
                let idx = 1;

                if (!legacyTieneDni && dniVal) {
                    sets.push(`dni = $${idx++}`);
                    vals.push(dniVal);
                }
                if (!legacyTieneCuit && cuitVal) {
                    sets.push(`cuit = $${idx++}`);
                    vals.push(cuitVal);
                }
                if (!legacyCond && condVal) {
                    sets.push(`condicion_iva = $${idx++}`);
                    vals.push(condVal);
                }

                if (sets.length > 0) {
                    sets.push('updated_at = NOW()');
                    vals.push(clienteIdInt);
                    if (!dryRun) {
                        await pool.query(
                            `UPDATE public.clientes SET ${sets.join(', ')} WHERE cliente_id = $${idx}`,
                            vals
                        );
                    }
                    resumen.clientesLegacyActualizados += 1;
                    resumen.totalCambios += 1;
                    resumen.detalles.push({
                        accion: 'UPDATE_LEGACY_CAMPOS_FALTANTES',
                        codigo: row.codigo_bunker_cliente,
                        cliente_id: clienteIdInt,
                        campos: sets.filter(s => !s.startsWith('updated_at'))
                    });
                }
            }
        }

        return resumen;
    } finally {
        if (debeCerrarPool) {
            await pool.end();
        }
    }
}

if (require.main === module) {
    const dryRun = process.argv.includes('--dry-run');
    ejecutarSaneamiento({ dryRun })
        .then((resumen) => {
            console.log(JSON.stringify(resumen, null, 2));
            process.exit(0);
        })
        .catch((err) => {
            console.error('❌ [SANEAMIENTO-CLIENTES] Error:', err);
            process.exit(1);
        });
}

module.exports = {
    ejecutarSaneamiento,
    esCuitPersonaFisica,
    construirNombreYApellidoLegacy
};
