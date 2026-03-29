const pool = require('./src/produccion/config/database');

async function fixConstraint() {
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        
        await client.query('ALTER TABLE public.mantenimiento_movimientos DROP CONSTRAINT mantenimiento_movimientos_estado_check');
        
        const addConstraint = `
            ALTER TABLE public.mantenimiento_movimientos ADD CONSTRAINT mantenimiento_movimientos_estado_check CHECK (
                estado::text = ANY (ARRAY[
                    'PENDIENTE'::character varying, 
                    'FINALIZADO'::character varying, 
                    'CANCELADO'::character varying, 
                    'REVERTIDO'::character varying, 
                    'AUTOMATICO'::character varying, 
                    'CONCILIADO'::character varying, 
                    'CUARENTENA_INTERNA'::character varying, 
                    'ANULADO'::character varying,
                    'EN_TRATAMIENTO'::character varying,
                    'FINALIZADO_TRATAMIENTO'::character varying
                ]::text[])
            )
        `;
        await client.query(addConstraint);
        
        await client.query('COMMIT');
        console.log("✅ Check constraint succesfully updated.");
        process.exit(0);
    } catch(err) {
        if(client) await client.query('ROLLBACK');
        console.error("❌ Error:", err);
        process.exit(1);
    } finally {
        if(client) client.release();
    }
}
fixConstraint();
