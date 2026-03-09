const fetch = require('node-fetch');

const buscarCandidatasLomasoft = async (req, res) => {
    const { id } = req.params;

    try {
        console.log(`🔍 [LOMASOFT] Buscando candidatas para el presupuesto ID: ${id}`);
        // 1. Extraer el Presupuesto y sus Detalles convirtiendo los artículos al código principal (alfanumérico)
        const sql = `
            SELECT 
                p.id_cliente, 
                p.fecha, 
                SUM(pd.cantidad * COALESCE(pd.precio1, pd.valor1, 0)) AS monto_total,
                json_agg(
                    COALESCE(a.numero, pd.articulo)
                ) FILTER (WHERE pd.articulo IS NOT NULL) as codigos_articulos
            FROM presupuestos p
            LEFT JOIN presupuestos_detalles pd ON pd.id_presupuesto = p.id
            LEFT JOIN articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
            WHERE p.id = $1
            GROUP BY p.id, p.id_cliente, p.fecha
            LIMIT 1;
        `;

        const dbResult = await req.db.query(sql, [id]);
        if (dbResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Presupuesto no encontrado' });
        }

        const localData = dbResult.rows[0];

        // 2. Armar el contrato estricto de Lomasoft
        const payloadLomasoft = {
            cliente_id: String(localData.id_cliente),
            monto_total: parseFloat(localData.monto_total || 0),
            fecha_creacion: new Date(localData.fecha).toISOString().split('T')[0], // YYYY-MM-DD
            articulos: localData.codigos_articulos || [] // Asegurados que son alfanuméricos mediante COALESCE
        };

        console.log("🚀 [LOMASOFT] Payload a enviar al ERP:", JSON.stringify(payloadLomasoft, null, 2));

        // 3. Obtener la URL del Túnel
        // El túnel o servicio local que conecta con Lomasoft
        const baseUrl = process.env.NGROK_URL || "http://localhost:3000";
        const urlLomasoft = `${baseUrl}/api/facturas/candidatas`;

        // 4. Llamada al túnel
        const lomaRes = await fetch(urlLomasoft, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadLomasoft)
        });

        // Parseamos la respuesta de Lomasoft
        const jsonText = await lomaRes.text();
        let lomasoftData;
        try {
            lomasoftData = JSON.parse(jsonText);
        } catch (e) {
            console.error(`[LOMASOFT] Error parseando respuesta: ${jsonText.substring(0, 100)}...`);
            throw new Error('Respuesta inválida del ERP Lomasoft al buscar candidatas.');
        }

        if (!lomaRes.ok || lomasoftData.ok === false) {
            throw new Error(lomasoftData.message || 'Error del ERP Lomasoft al buscar candidatas');
        }

        console.log(`✅ [LOMASOFT] Encontradas ${lomasoftData.total} candidatas para pres. ${id}`);

        // 5. Devolver resultados limpios al Frontend
        return res.json({
            success: true,
            data: lomasoftData.data || [],
            total: lomasoftData.total || (lomasoftData.data || []).length
        });

    } catch (error) {
        console.error(`❌ [LOMASOFT] Error en buscarCandidatasLomasoft:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    buscarCandidatasLomasoft
};
