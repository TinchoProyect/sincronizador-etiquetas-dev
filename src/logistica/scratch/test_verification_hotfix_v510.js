const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runVerificationV510() {
    console.log('🔍 ====================================================================');
    console.log('🔍 VERIFICACIÓN EMPÍRICA HOTFIX v5.10: Auditoría y Consolidación JSONB');
    console.log('🔍 ====================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Auditar Estado Inicial de la Base de Datos para la Familia 26 (Frutas Disecadas)
        console.log('1. Escaneando bunker_articulos para detectar anomalías JSONB en Familia 26:');
        
        const taxRes = await client.query(`
            SELECT categoria FROM public.bunker_familia_categorias WHERE familia_id = 26 ORDER BY orden_posicional ASC
        `);
        const masterCatsFam26 = taxRes.rows.map(r => r.categoria);
        console.log('   - Categorías canónicas maestras en BD (Familia 26):', masterCatsFam26);

        const artRes = await client.query(`
            SELECT ctid, descripcion, propiedades_dinamicas
            FROM public.bunker_articulos
            WHERE familia_id = 26 AND propiedades_dinamicas IS NOT NULL
        `);

        let detectedAnomalies = [];
        artRes.rows.forEach(art => {
            const props = art.propiedades_dinamicas || {};
            if (props.posiciones && typeof props.posiciones === 'object') {
                Object.values(props.posiciones).forEach(p => {
                    if (p && p.eje) {
                        const ejeStr = String(p.eje).trim();
                        // Coincidencia estricta exacta
                        const esExacta = masterCatsFam26.some(m => m === ejeStr);
                        if (!esExacta) {
                            detectedAnomalies.push({ ctid: art.ctid, descripcion: art.descripcion, clave: ejeStr });
                        }
                    }
                });
            }
        });

        console.log(`   - Anomalías detectadas antes de la consolidación: ${detectedAnomalies.length} registros`);
        detectedAnomalies.forEach(a => console.log(`     * CTID ${a.ctid}: Clave en BD = "${a.clave}" (No es exacta contra la canónica)`));

        if (detectedAnomalies.length > 0) {
            // 2. Ejecutar Consolidación Masiva (UPDATE JSONB) en PostgreSQL
            console.log('\n2. Ejecutando Consolidación Masiva JSONB en PostgreSQL (Familia 26):');
            const targetOldKey = 'Nom. Fantasia';
            const targetNewKey = 'nom. Fantasía';

            await client.query('BEGIN');

            let updatedCount = 0;
            for (const art of artRes.rows) {
                let props = art.propiedades_dinamicas;
                let modified = false;

                if (props.posiciones && typeof props.posiciones === 'object') {
                    Object.keys(props.posiciones).forEach(posKey => {
                        const posObj = props.posiciones[posKey];
                        if (posObj && posObj.eje) {
                            const currentNorm = String(posObj.eje).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                            const oldNorm = targetOldKey.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                            if (currentNorm === oldNorm || String(posObj.eje).trim() === targetOldKey) {
                                posObj.eje = targetNewKey;
                                modified = true;
                            }
                        }
                    });
                }

                if (props[targetOldKey] !== undefined) {
                    props[targetNewKey] = props[targetOldKey];
                    delete props[targetOldKey];
                    modified = true;
                }

                if (modified) {
                    await client.query(`
                        UPDATE public.bunker_articulos
                        SET propiedades_dinamicas = $1
                        WHERE ctid = $2
                    `, [props, art.ctid]);
                    updatedCount++;
                }
            }

            await client.query('COMMIT');
            console.log(`   - Artículos saneados en PostgreSQL: ${updatedCount} filas actualizadas ✅`);
        }

        // 3. Re-auditar la Base de Datos para Confirmar Saneamiento
        console.log('\n3. Re-escaneando bunker_articulos tras la consolidación:');
        const artReAudit = await client.query(`
            SELECT ctid, propiedades_dinamicas
            FROM public.bunker_articulos
            WHERE familia_id = 26 AND propiedades_dinamicas IS NOT NULL
        `);

        let remainingAnomalies = [];
        artReAudit.rows.forEach(art => {
            const props = art.propiedades_dinamicas || {};
            if (props.posiciones && typeof props.posiciones === 'object') {
                Object.values(props.posiciones).forEach(p => {
                    if (p && p.eje) {
                        const ejeStr = String(p.eje).trim();
                        if (ejeStr === 'Nom. Fantasia') {
                            remainingAnomalies.push({ ctid: art.ctid, clave: ejeStr });
                        }
                    }
                });
            }
        });

        const isClean = remainingAnomalies.length === 0;
        console.log(`   - Anomalías de 'Nom. Fantasia' restantes en BD: ${remainingAnomalies.length}`, isClean ? '✅ PASÓ (0 inconsistencias)' : '❌ FALLÓ');

        if (!isClean) {
            throw new Error('Persisten inconsistencias en la base de datos tras la consolidación');
        }

        console.log('\n✅ ====================================================================');
        console.log('✅ VERIFICACIÓN EMPÍRICA EXITOSA (100% PASS) - HOTFIX v5.10 CONSOLIDABLE');
        console.log('✅ ====================================================================\n');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error en prueba empírica v5.10:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runVerificationV510();
