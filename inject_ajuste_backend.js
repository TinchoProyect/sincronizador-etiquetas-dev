const fs = require('fs');

const routeStr = `
// ==========================================
// MÓDULO DE AJUSTE PUNTUAL DE STOCK FÍSICO
// ==========================================
router.post('/ingredientes/ajustar-stock', async (req, res) => {
    const { usuario_id, ajustes } = req.body;
    
    if (!usuario_id || !ajustes || !Array.isArray(ajustes) || ajustes.length === 0) {
        return res.status(400).json({ error: 'Datos incompletos para el ajuste.' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        for (const ajuste of ajustes) {
            const { ingrediente_id, nuevo_stock, observacion } = ajuste;
            
            // 1. Obtener y bloquear la fila actual
            const resultActual = await client.query('SELECT stock_actual FROM ingredientes WHERE id = $1 FOR UPDATE', [ingrediente_id]);
            if (resultActual.rows.length === 0) {
                throw new Error(\`El ingrediente ID \${ingrediente_id} no existe.\`);
            }
            
            const stockAnterior = parseFloat(resultActual.rows[0].stock_actual);
            const diferencia = parseFloat(nuevo_stock) - stockAnterior;
            
            // 2. Actualizar stock físico general
            await client.query('UPDATE ingredientes SET stock_actual = $1 WHERE id = $2', [nuevo_stock, ingrediente_id]);
            
            // 3. Registrar auditoría innegociable en ingredientes_ajustes
            await client.query(
                \`INSERT INTO ingredientes_ajustes 
                (fecha, ingrediente_id, usuario_id, stock_anterior, stock_nuevo, diferencia, tipo_ajuste, observacion) 
                VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7)\`,
                [ingrediente_id, usuario_id, stockAnterior, nuevo_stock, diferencia, 'MANUAL_DEPOSITO', observacion]
            );
            
            // 4. Registrar en movimientos para consistencia del ABM
            await client.query(
                \`INSERT INTO ingredientes_movimientos 
                (fecha, ingrediente_id, kilos, tipo, observaciones, stock_anterior) 
                VALUES (NOW(), $1, $2, $3, $4, $5)\`,
                [ingrediente_id, diferencia, 'AJUSTE', observacion, stockAnterior]
            );
        }
        
        await client.query('COMMIT');
        res.json({ message: 'Ajustes impactados correctamente', registros: ajustes.length });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error detallado en POST /ingredientes/ajustar-stock:', e);
        res.status(500).json({ error: 'Error transaccional: ' + e.message });
    } finally {
        client.release();
    }
});
`;

let content = fs.readFileSync('src/produccion/routes/produccion.js', 'utf8');
// Insert before `module.exports = router;`
content = content.replace('module.exports = router;', routeStr + '\nmodule.exports = router;');
fs.writeFileSync('src/produccion/routes/produccion.js', content);
console.log('Backend route injected.');
