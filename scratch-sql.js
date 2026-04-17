const pool = require('./src/produccion/config/database');

async function test() {
    try {
        const query = `
            SELECT 
                i.id as ingrediente_id,
                i.codigo,
                i.nombre as nombre_ingrediente,
                i.descripcion,
                i.unidad_medida,
                i.categoria,
                COALESCE(SUM(isu.cantidad), 0) as stock_total,
                (
                    SELECT contexto_envase
                    FROM ingredientes_stock_usuarios 
                    WHERE ingrediente_id = i.id AND usuario_id = $1 AND contexto_envase IS NOT NULL
                    ORDER BY fecha_registro DESC LIMIT 1
                ) as capacidad_base,
                CASE 
                    WHEN EXISTS (
                        SELECT 1 FROM ingrediente_composicion ic 
                        WHERE ic.mix_id = i.id
                    ) THEN 'Mix'
                    ELSE 'Simple'
                END as tipo
            FROM public.ingredientes i
            INNER JOIN public.ingredientes_stock_usuarios isu ON i.id = isu.ingrediente_id
            WHERE isu.usuario_id = $1
            GROUP BY i.id, i.codigo, i.nombre, i.descripcion, i.unidad_medida, i.categoria
            ORDER BY i.nombre ASC;
        `;
        const result = await pool.query(query, [5]);
        console.log("SUCCESS length:", result.rows.length);
    } catch (e) {
        console.error("SQL ERROR IS:");
        console.error(e.message);
    } finally {
        pool.end();
    }
}
test();
