/**
 * Script para agregar columnas y constraints a factura_facturas
 */

const { pool } = require('./src/facturacion/config/database');

async function ejecutar() {
    console.log('🔄 Agregando columnas y constraints a factura_facturas...\n');
    
    try {
        // 1. Agregar columnas
        console.log('1️⃣ Agregando columnas fch_serv_desde, fch_serv_hasta, fch_vto_pago...');
        await pool.query(`
            ALTER TABLE factura_facturas 
            ADD COLUMN IF NOT EXISTS fch_serv_desde DATE,
            ADD COLUMN IF NOT EXISTS fch_serv_hasta DATE,
            ADD COLUMN IF NOT EXISTS fch_vto_pago DATE
        `);
        console.log('✅ Columnas agregadas\n');
        
        // 2. Agregar constraints
        console.log('2️⃣ Agregando constraints...');
        
        await pool.query(`ALTER TABLE factura_facturas DROP CONSTRAINT IF EXISTS check_concepto`);
        await pool.query(`ALTER TABLE factura_facturas ADD CONSTRAINT check_concepto CHECK (concepto IN (1, 2, 3))`);
        console.log('✅ check_concepto');
        
        await pool.query(`ALTER TABLE factura_facturas DROP CONSTRAINT IF EXISTS check_fechas_servicio`);
        await pool.query(`
            ALTER TABLE factura_facturas ADD CONSTRAINT check_fechas_servicio 
            CHECK (
                (concepto = 1) OR 
                (concepto IN (2, 3) AND fch_serv_desde IS NOT NULL AND fch_serv_hasta IS NOT NULL AND fch_vto_pago IS NOT NULL)
            )
        `);
        console.log('✅ check_fechas_servicio\n');
        
        // 3. Crear función de recálculo
        console.log('3️⃣ Creando función recalcular_totales_factura...');
        await pool.query(`
            CREATE OR REPLACE FUNCTION recalcular_totales_factura()
            RETURNS TRIGGER AS $$
            DECLARE
                v_factura_id BIGINT;
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    v_factura_id := OLD.factura_id;
                ELSE
                    v_factura_id := NEW.factura_id;
                END IF;
                
                UPDATE factura_facturas f
                SET 
                    imp_neto = COALESCE((SELECT SUM(imp_neto) FROM factura_factura_items WHERE factura_id = v_factura_id), 0),
                    imp_iva = COALESCE((SELECT SUM(imp_iva) FROM factura_factura_items WHERE factura_id = v_factura_id), 0),
                    imp_total = COALESCE((SELECT SUM(imp_neto) + SUM(imp_iva) FROM factura_factura_items WHERE factura_id = v_factura_id), 0),
                    updated_at = NOW()
                WHERE id = v_factura_id;
                
                IF TG_OP = 'DELETE' THEN
                    RETURN OLD;
                ELSE
                    RETURN NEW;
                END IF;
            END;
            $$ LANGUAGE plpgsql
        `);
        console.log('✅ Función creada\n');
        
        // 4. Crear triggers
        console.log('4️⃣ Creando triggers...');
        
        await pool.query(`DROP TRIGGER IF EXISTS trigger_recalcular_totales_insert ON factura_factura_items`);
        await pool.query(`
            CREATE TRIGGER trigger_recalcular_totales_insert
            AFTER INSERT ON factura_factura_items
            FOR EACH ROW
            EXECUTE FUNCTION recalcular_totales_factura()
        `);
        console.log('✅ trigger_recalcular_totales_insert');
        
        await pool.query(`DROP TRIGGER IF EXISTS trigger_recalcular_totales_update ON factura_factura_items`);
        await pool.query(`
            CREATE TRIGGER trigger_recalcular_totales_update
            AFTER UPDATE ON factura_factura_items
            FOR EACH ROW
            EXECUTE FUNCTION recalcular_totales_factura()
        `);
        console.log('✅ trigger_recalcular_totales_update');
        
        await pool.query(`DROP TRIGGER IF EXISTS trigger_recalcular_totales_delete ON factura_factura_items`);
        await pool.query(`
            CREATE TRIGGER trigger_recalcular_totales_delete
            AFTER DELETE ON factura_factura_items
            FOR EACH ROW
            EXECUTE FUNCTION recalcular_totales_factura()
        `);
        console.log('✅ trigger_recalcular_totales_delete\n');
        
        console.log('============================================');
        console.log('✅ CAMBIOS COMPLETADOS EXITOSAMENTE');
        console.log('============================================\n');
        
        await pool.end();
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

ejecutar();
