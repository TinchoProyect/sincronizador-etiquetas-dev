/**
 * Script de Regularización - Caso Testigo (Fiorella Zitti)
 * 
 * Este script:
 * 1. Inspecciona la factura original #121 (Factura B 00032-2) y su presupuesto #8234391.
 * 2. Genera un borrador de Nota de Crédito espejo usando facturaService.anular.
 * 3. Emite la Nota de Crédito espejo usando facturaService.emitir (autorización ante AFIP,
 *    reversión automática de stock, ajuste de cuenta corriente y liberación de presupuesto).
 * 4. Valida los resultados.
 */

const path = require('path');
// Cargar dotenv con la ruta de la configuración de facturación
require('dotenv').config({ path: path.join(__dirname, '../src/facturacion/.env'), override: true });

const { pool } = require('../src/facturacion/config/database');
const facturaService = require('../src/facturacion/services/facturaService');

async function run() {
    console.log('================================================================');
    console.log('🚀 INICIANDO SCRIPT DE REGULARIZACIÓN - CASO TESTIGO');
    console.log('================================================================');
    console.log(`Entorno configurado: ${process.env.ENTORNO || 'No especificado'}`);
    console.log(`DB Host: ${process.env.DB_HOST || 'localhost'}`);
    console.log(`DB Database: ${process.env.DB_DATABASE || 'No especificada'}`);

    try {
        // 1. INSPECCIÓN PREVIA
        console.log('\n🔍 [1/4] Inspeccionando registros actuales en base de datos...');
        
        // Factura
        const resFact = await pool.query('SELECT * FROM factura_facturas WHERE id = 121');
        if (resFact.rows.length === 0) {
            throw new Error('No se encontró la factura original con ID 121.');
        }
        const facturaOrig = resFact.rows[0];
        console.log(`📄 Factura original encontrada:`);
        console.log(`   - ID: ${facturaOrig.id}`);
        console.log(`   - Tipo: ${facturaOrig.tipo_cbte} (Factura B)`);
        console.log(`   - Pto Vta: ${facturaOrig.pto_vta}`);
        console.log(`   - Nº Cbte: ${facturaOrig.cbte_nro}`);
        console.log(`   - Total: $${facturaOrig.imp_total}`);
        console.log(`   - Estado actual: ${facturaOrig.estado}`);
        console.log(`   - Presupuesto asociado: ${facturaOrig.presupuesto_id}`);

        // Presupuesto
        let presupuestoId = facturaOrig.presupuesto_id || 8234391;
        const resPresup = await pool.query('SELECT * FROM public.presupuestos WHERE id = $1', [presupuestoId]);
        if (resPresup.rows.length === 0) {
            console.warn(`⚠️ Advertencia: Presupuesto ID ${presupuestoId} no encontrado en public.presupuestos.`);
        } else {
            const pres = resPresup.rows[0];
            console.log(`🔗 Presupuesto origen encontrado:`);
            console.log(`   - ID: ${pres.id}`);
            console.log(`   - ID Ext: ${pres.id_presupuesto_ext}`);
            console.log(`   - Estado actual: ${pres.estado}`);
            console.log(`   - factura_id: ${pres.factura_id}`);
        }

        // Cuenta corriente
        const resCCMov = await pool.query(
            `SELECT * FROM public.factura_cuenta_corriente_movimientos 
             WHERE comprobante_id = 121`
        );
        console.log(`💳 Movimiento de cuenta corriente original:`);
        if (resCCMov.rows.length === 0) {
            console.log('   - Ninguno encontrado para factura ID 121');
        } else {
            resCCMov.rows.forEach(mov => {
                console.log(`   - ID Mov: ${mov.id} | Tipo: ${mov.tipo_movimiento} | Monto: $${mov.monto} | Saldo: $${mov.saldo_resultante} | Desc: ${mov.descripcion}`);
            });
        }

        if (facturaOrig.estado === 'ANULADA') {
            console.log('\n⚠️ La factura #121 ya se encuentra en estado ANULADA. Comprobando si tiene Nota de Crédito asociada...');
            const resNC = await pool.query('SELECT * FROM factura_facturas WHERE factura_asociada_id = 121 AND estado != \'RECHAZADA\'');
            if (resNC.rows.length > 0) {
                console.log(`   - Nota de Crédito espejo encontrada: ID ${resNC.rows[0].id} | Nº: ${resNC.rows[0].pto_vta}-${resNC.rows[0].cbte_nro} | CAE: ${resNC.rows[0].cae} | Estado: ${resNC.rows[0].estado}`);
            }
            return;
        }

        // 2. CREACIÓN DEL BORRADOR DE NOTA DE CRÉDITO
        console.log('\n📝 [2/4] Creando borrador de Nota de Crédito espejo...');
        const ncDraftId = await facturaService.anular(121, 'Regularización Caso Testigo');
        console.log(`✅ Borrador de Nota de Crédito espejo creado con ID: ${ncDraftId}`);

        // 3. EMISIÓN Y AUTORIZACIÓN ANTE AFIP
        console.log('\n📤 [3/4] Emitiendo Nota de Crédito espejo (autorización AFIP, stock y CC)...');
        const ncEmitida = await facturaService.emitir(ncDraftId);
        console.log(`✅ Nota de Crédito emitida exitosamente:`);
        console.log(`   - ID: ${ncEmitida.id}`);
        console.log(`   - Tipo: ${ncEmitida.tipo_cbte} (Nota de Crédito B)`);
        console.log(`   - Pto Vta: ${ncEmitida.pto_vta}`);
        console.log(`   - Nº Cbte Asignado: ${ncEmitida.cbte_nro} (Dinamizado por AFIP)`);
        console.log(`   - CAE: ${ncEmitida.cae}`);
        console.log(`   - Estado: ${ncEmitida.estado}`);

        // 4. VERIFICACIÓN DE INTEGRIDAD Y COMPENSACIONES
        console.log('\n🔄 [4/4] Verificando compensaciones e integridad en base de datos...');
        
        // Verificar factura original
        const resFactFinal = await pool.query('SELECT estado FROM factura_facturas WHERE id = 121');
        console.log(`📄 Estado final factura #121: ${resFactFinal.rows[0].estado} (Debería ser ANULADA)`);

        // Verificar presupuesto
        const resPresupFinal = await pool.query('SELECT estado, factura_id FROM public.presupuestos WHERE id = $1', [presupuestoId]);
        if (resPresupFinal.rows.length > 0) {
            const pres = resPresupFinal.rows[0];
            console.log(`🔗 Presupuesto #8234391 final:`);
            console.log(`   - Estado: ${pres.estado} (Debería ser Presupuesto/Orden)`);
            console.log(`   - factura_id: ${pres.factura_id} (Debería ser null)`);
        }

        // Verificar movimientos de stock
        const resStockMov = await pool.query(
            `SELECT sm.*, a.nombre as articulo_nombre 
             FROM public.stock_ventas_movimientos sm
             LEFT JOIN public.articulos a ON sm.articulo_numero = a.numero
             WHERE sm.observaciones ILIKE $1`,
            [`%Nota de Crédito%#32-${ncEmitida.cbte_nro}%`]
        );
        console.log(`📦 Movimiento de stock de reingreso:`);
        if (resStockMov.rows.length === 0) {
            console.log('   ❌ No se encontró el movimiento de reingreso de stock.');
        } else {
            resStockMov.rows.forEach(mov => {
                console.log(`   - Artículo: ${mov.articulo_nombre} (${mov.articulo_numero}) | Tipo: ${mov.tipo} | Cantidad: ${mov.cantidad} | Obs: ${mov.observaciones}`);
            });
        }

        // Verificar saldo de cuenta corriente
        const resCCMovFinal = await pool.query(
            `SELECT m.*, cc.saldo as saldo_cabecera 
             FROM public.factura_cuenta_corriente_movimientos m
             JOIN public.factura_cuentas_corrientes cc ON m.cuenta_corriente_id = cc.id
             WHERE m.comprobante_id = $1`,
            [ncEmitida.id]
        );
        console.log(`💳 Movimiento de cuenta corriente de crédito (N/C):`);
        if (resCCMovFinal.rows.length === 0) {
            console.log('   ❌ No se encontró el movimiento de cuenta corriente de la N/C.');
        } else {
            resCCMovFinal.rows.forEach(mov => {
                console.log(`   - ID Mov: ${mov.id} | Tipo: ${mov.tipo_movimiento} | Monto: $${mov.monto} | Saldo Resultante: $${mov.saldo_resultante} | Desc: ${mov.descripcion}`);
                console.log(`   - Saldo final de la Cuenta Corriente: $${mov.saldo_cabecera}`);
            });
        }

        console.log('\n================================================================');
        console.log('✅ PROCESO DE REGULARIZACIÓN COMPLETADO CON ÉXITO');
        console.log('================================================================');

    } catch (error) {
        console.error('\n💥 ERROR DURANTE EL PROCESO DE REGULARIZACIÓN:');
        console.error(error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
        console.log('\n🔌 Conexión de base de datos cerrada.');
    }
}

run();
