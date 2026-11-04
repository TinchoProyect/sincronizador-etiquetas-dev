const { pool } = require('../config/database');

function extraerDatosBancariosDeConcepto(concepto, cuitExistente = null) {
    if (!concepto) return { cuit: cuitExistente, cbu: null, titular: null };
    
    const lineas = concepto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    
    // 1. CUIT
    let cuit = cuitExistente ? String(cuitExistente).replace(/\D/g, '') : null;
    if (!cuit) {
        const matchCuit = concepto.match(/\b(20|23|24|27|30|33|34)[-]?(\d{8})[-]?(\d)\b/);
        if (matchCuit) {
            cuit = `${matchCuit[1]}${matchCuit[2]}${matchCuit[3]}`;
        }
    }
    
    // 2. CBU / CVU (22 dígitos numéricos)
    let cbu = null;
    const matchCbu = concepto.match(/\b\d{22}\b/);
    if (matchCbu) {
        cbu = matchCbu[0];
    }
    
    // 3. Titular (suele ser la 2da línea si no es genérica ni numérica)
    let titular = null;
    if (lineas.length > 1) {
        const candidatos = lineas.slice(1, 3);
        for (const cand of candidatos) {
            const soloDigitos = cand.replace(/\D/g, '');
            const esNumerico = soloDigitos.length > 8 && soloDigitos.length === cand.replace(/[\s-]/g, '').length;
            const esPalabraClave = /^(transferencia|credito|debito|factura|varios|afip|link|pago|servicio|no\b)/i.test(cand);
            if (!esNumerico && !esPalabraClave && cand.length >= 3) {
                titular = cand;
                break;
            }
        }
    }
    
    return { cuit, cbu, titular };
}

async function inicializarYMigrarAlias() {
    const client = await pool.connect();
    try {
        console.log('🚀 [ALIAS-BANCARIOS] Creando tabla de memoria/aprendizaje bancario...');
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS public.fin_alias_bancarios_clientes (
                id SERIAL PRIMARY KEY,
                cliente_id INTEGER NOT NULL REFERENCES public.bunker_clientes(id) ON DELETE CASCADE,
                cuit_origen VARCHAR(20) DEFAULT NULL,
                cbu_cvu_origen VARCHAR(30) DEFAULT NULL,
                titular_origen VARCHAR(255) DEFAULT NULL,
                veces_vinculado INTEGER NOT NULL DEFAULT 1,
                origen VARCHAR(50) DEFAULT 'MANUAL',
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE UNIQUE INDEX IF NOT EXISTS unq_fin_alias_cliente_cuit 
            ON public.fin_alias_bancarios_clientes (cliente_id, cuit_origen) 
            WHERE cuit_origen IS NOT NULL;

            CREATE UNIQUE INDEX IF NOT EXISTS unq_fin_alias_cliente_cbu 
            ON public.fin_alias_bancarios_clientes (cliente_id, cbu_cvu_origen) 
            WHERE cbu_cvu_origen IS NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_fin_alias_cuit ON public.fin_alias_bancarios_clientes(cuit_origen);
            CREATE INDEX IF NOT EXISTS idx_fin_alias_cbu ON public.fin_alias_bancarios_clientes(cbu_cvu_origen);
            CREATE INDEX IF NOT EXISTS idx_fin_alias_titular ON public.fin_alias_bancarios_clientes(titular_origen);
            CREATE INDEX IF NOT EXISTS idx_fin_alias_cliente ON public.fin_alias_bancarios_clientes(cliente_id);
        `);

        console.log('📚 [ALIAS-BANCARIOS] Leyendo historial de movimientos bancarios vinculados...');
        const movs = await client.query(`
            SELECT id, concepto, cuit_extraido, cliente_id
            FROM public.fin_movimientos_bancarios
            WHERE cliente_id IS NOT NULL
            ORDER BY id ASC
        `);

        console.log(`🔍 [ALIAS-BANCARIOS] Analizando ${movs.rowCount} movimientos históricos vinculados...`);
        let aliasCount = 0;

        for (const m of movs.rows) {
            const datos = extraerDatosBancariosDeConcepto(m.concepto, m.cuit_extraido);
            if (!datos.cuit && !datos.cbu && !datos.titular) continue;

            if (datos.cuit) {
                await client.query(`
                    INSERT INTO public.fin_alias_bancarios_clientes 
                        (cliente_id, cuit_origen, cbu_cvu_origen, titular_origen, veces_vinculado, origen)
                    VALUES ($1, $2, $3, $4, 1, 'HISTORICO')
                    ON CONFLICT (cliente_id, cuit_origen) WHERE cuit_origen IS NOT NULL
                    DO UPDATE SET 
                        veces_vinculado = fin_alias_bancarios_clientes.veces_vinculado + 1,
                        titular_origen = COALESCE(fin_alias_bancarios_clientes.titular_origen, EXCLUDED.titular_origen),
                        cbu_cvu_origen = COALESCE(fin_alias_bancarios_clientes.cbu_cvu_origen, EXCLUDED.cbu_cvu_origen),
                        actualizado_en = CURRENT_TIMESTAMP
                `, [m.cliente_id, datos.cuit, datos.cbu, datos.titular]);
                aliasCount++;
            } else if (datos.cbu) {
                await client.query(`
                    INSERT INTO public.fin_alias_bancarios_clientes 
                        (cliente_id, cuit_origen, cbu_cvu_origen, titular_origen, veces_vinculado, origen)
                    VALUES ($1, NULL, $2, $3, 1, 'HISTORICO')
                    ON CONFLICT (cliente_id, cbu_cvu_origen) WHERE cbu_cvu_origen IS NOT NULL
                    DO UPDATE SET 
                        veces_vinculado = fin_alias_bancarios_clientes.veces_vinculado + 1,
                        titular_origen = COALESCE(fin_alias_bancarios_clientes.titular_origen, EXCLUDED.titular_origen),
                        actualizado_en = CURRENT_TIMESTAMP
                `, [m.cliente_id, datos.cbu, datos.titular]);
                aliasCount++;
            }
        }

        const resTotal = await client.query('SELECT COUNT(*) FROM public.fin_alias_bancarios_clientes');
        console.log(`✅ [ALIAS-BANCARIOS] Migración completada con éxito. Total de alias únicos aprendidos: ${resTotal.rows[0].count}`);

    } catch (e) {
        console.error('❌ [ALIAS-BANCARIOS] Error en migración de alias bancarios:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

inicializarYMigrarAlias();
