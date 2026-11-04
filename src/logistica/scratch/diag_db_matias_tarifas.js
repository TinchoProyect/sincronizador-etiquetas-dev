require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function testExactFileQuery() {
    const client = await pool.connect();
    try {
        console.log('🔍 Probando Query EXACTA del archivo bunkerController.js...');
        const queryInFile = `
            SELECT 
                ctr.id, 
                ctr.articulo_numero, 
                ctr.valor_por_unidad, 
                ctr.unidad_medida,
                CASE 
                    WHEN LOWER(ctr.unidad_medida) IN ('hr', 'hora', 'horas') OR ctr.articulo_numero = 'HORA' 
                        THEN 'Tarifa Base por Hora'
                    ELSE COALESCE(
                        ba.descripcion_generada,
                        ba.descripcion, 
                        a.nombre, 
                        src.articulo_descripcion, 
                        ctr.articulo_numero, 
                        'Servicio Parametrizado General'
                    )
                END AS descripcion
            FROM public.colaboradores_tarifas_rendimiento ctr
            LEFT JOIN public.bunker_articulos ba ON ctr.articulo_numero = CAST(ba.articulo_id AS VARCHAR)
            LEFT JOIN public.articulos a ON ctr.articulo_numero = a.numero
            LEFT JOIN public.stock_real_consolidado src ON ctr.articulo_numero = src.articulo_numero
            WHERE ctr.usuario_id = $1 AND ctr.activo = true
            ORDER BY ctr.articulo_numero ASC
        `;
        const resInFile = await client.query(queryInFile, [5]);
        console.log('Res:', resInFile.rows);
    } catch (err) {
        console.error('❌ ERROR EXACTO OCURRIENDO EN BACKEND:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

testExactFileQuery();
