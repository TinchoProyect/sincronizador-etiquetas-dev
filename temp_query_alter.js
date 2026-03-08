const pool = require('./src/produccion/config/database');
const query = `
    ALTER TABLE public.mantenimiento_movimientos DROP CONSTRAINT mantenimiento_movimientos_tipo_movimiento_check;
    ALTER TABLE public.mantenimiento_movimientos ADD CONSTRAINT mantenimiento_movimientos_tipo_movimiento_check 
    CHECK (tipo_movimiento::text = ANY (ARRAY[
        'INGRESO'::character varying, 
        'LIBERACION'::character varying, 
        'AJUSTE'::character varying, 
        'DESCARTE'::character varying, 
        'TRANSF_INGREDIENTE'::character varying, 
        'REVERSION'::character varying,
        'EMISION_NC'::character varying
    ]::text[]));
`;
pool.query(query)
    .then(() => { console.log('ALTER OK'); pool.end(); })
    .catch(err => { console.error('ERROR:', err.message); pool.end(); });
