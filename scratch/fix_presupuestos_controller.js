const fs = require('fs');

const filePath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/presupuestos/controllers/presupuestos.js';
console.log('Modifying:', filePath);

if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
}

let code = fs.readFileSync(filePath, 'utf8');

// Normalize line endings to LF
const hasCrlf = code.includes('\r\n');
code = code.replace(/\r\n/g, '\n');

// 1. Target code to modify (whereClause preparation and usarBunker)
const targetBlock = `        // Armado dinámico del WHERE con placeholders
        const fields = ['src.descripcion', 'src.articulo_numero', 'src.codigo_barras'];
        const whereParts = [];
        const params = [];
        let p = 0;

        if (isBarcode) {
            p += 1;
            whereParts.push(\`src.codigo_barras = $\${p}\`);
            params.push(qRaw);
        }

        if (tokens.length) {
            const andGroup = tokens.map(t => {
                p += 1;
                const ph = \`$\${p}\`;
                params.push(\`%\${t}%\`);
                return \`(\${fields.map(f => \`\${f} ILIKE \${ph}\`).join(' OR ')})\`;
            });
            // Si ya agregamos el OR de código de barras exacto, incluimos AND-group aparte
            if (isBarcode) {
                whereParts.push(\`(\${andGroup.join(' AND ')})\`);
            } else {
                whereParts.push(...andGroup);
            }
        }

        // Si no hay condiciones, devolvemos vacío (no debería ocurrir porque qRaw existe)
        if (!whereParts.length) {
            return res.json({ success: true, data: [], query: qRaw, total: 0, timestamp: new Date().toISOString() });
        }

        const whereClause = isBarcode
            ? \`WHERE (\${whereParts[0]}) OR (\${whereParts.slice(1).join(' AND ') || 'FALSE'})\`
            : \`WHERE \${whereParts.join(' AND ')}\`;

        let sql;
        const usarBunker = (req.query.usar_precios_bunker === 'true' || req.query.usar_precios_bunker === true) && clienteId > 0;

        if (usarBunker) {
            p += 1;
            params.push(String(clienteId).padStart(4, '0'));
            const clientPId = p;

            sql = \`
      SELECT
        src.codigo_barras,
        src.articulo_numero,
        COALESCE(ba.descripcion_generada, ba.descripcion, src.descripcion) AS descripcion,
        COALESCE(src.stock_consolidado, 0) AS stock_consolidado,
        COALESCE(bla.precio_final / (1 + COALESCE(bla.iva, pa.iva, 21) / 100.0), \${colPrecio}, 0) AS precio_venta,
        COALESCE(bla.iva, pa.iva, 21) AS iva
      FROM public.stock_real_consolidado src
      LEFT JOIN public.precios_articulos pa ON LOWER(pa.descripcion) = LOWER(src.descripcion)
      LEFT JOIN public.bunker_clientes bc ON bc.lomas_soft_id = \$\${clientPId}
      LEFT JOIN public.bunker_cliente_listas_precios bclp ON bclp.bunker_cliente_id = bc.id
      LEFT JOIN public.bunker_lista_articulos bla ON bla.lista_id = bclp.bunker_lista_precio_id 
        AND (bla.articulo_numero = src.articulo_numero OR bla.articulo_numero = src.codigo_barras)
      LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = src.articulo_numero
      \${whereClause}
      ORDER BY
        CASE WHEN COALESCE(src.stock_consolidado,0) > 0 THEN 0 ELSE 1 END ASC,
        COALESCE(ba.descripcion_generada, ba.descripcion, src.descripcion) ASC
      LIMIT \$\${p + 1}
    \`;`;

const replacementBlock = `        const usarBunker = (req.query.usar_precios_bunker === 'true' || req.query.usar_precios_bunker === true) && clienteId > 0;

        // Armado dinámico del WHERE con placeholders
        const fields = usarBunker
            ? [
                'COALESCE(ba.descripcion_generada, ba.descripcion, src.descripcion, pa.descripcion)',
                'bla.articulo_numero',
                'COALESCE(src.codigo_barras, ba.articulo_id, bla.articulo_numero)'
              ]
            : ['src.descripcion', 'src.articulo_numero', 'src.codigo_barras'];

        const whereParts = [];
        const params = [];
        let p = 0;

        if (isBarcode) {
            p += 1;
            const barcodeField = usarBunker ? 'COALESCE(src.codigo_barras, ba.articulo_id, bla.articulo_numero)' : 'src.codigo_barras';
            whereParts.push(\`\${barcodeField} = \$\${p}\`);
            params.push(qRaw);
        }

        if (tokens.length) {
            const andGroup = tokens.map(t => {
                p += 1;
                const ph = \`\$\${p}\`;
                params.push(\`%\${t}%\`);
                return \`(\${fields.map(f => \`\${f} ILIKE \${ph}\`).join(' OR ')})\`;
            });
            // Si ya agregamos el OR de código de barras exacto, incluimos AND-group aparte
            if (isBarcode) {
                whereParts.push(\`(\${andGroup.join(' AND ')})\`);
            } else {
                whereParts.push(...andGroup);
            }
        }

        // Si no hay condiciones, devolvemos vacío (no debería ocurrir porque qRaw existe)
        if (!whereParts.length) {
            return res.json({ success: true, data: [], query: qRaw, total: 0, timestamp: new Date().toISOString() });
        }

        let whereClause = isBarcode
            ? \`WHERE (\${whereParts[0]}) OR (\${whereParts.slice(1).join(' AND ') || 'FALSE'})\`
            : \`WHERE \${whereParts.join(' AND ')}\`;

        if (usarBunker) {
            whereClause += ' AND COALESCE(bla.disponible, true) = true';
        }

        let sql;

        if (usarBunker) {
            p += 1;
            params.push(String(clienteId).padStart(4, '0'));
            const clientPId = p;

            sql = \`
      SELECT
        COALESCE(src.codigo_barras, ba.articulo_id, bla.articulo_numero) AS codigo_barras,
        COALESCE(ba.articulo_id, src.articulo_numero, bla.articulo_numero) AS articulo_numero,
        COALESCE(ba.descripcion_generada, ba.descripcion, src.descripcion, pa.descripcion) AS descripcion,
        COALESCE(src.stock_consolidado, 0) AS stock_consolidado,
        COALESCE(bla.precio_final / (1 + COALESCE(bla.iva, pa.iva, 21) / 100.0), 0) AS precio_venta,
        COALESCE(bla.iva, pa.iva, 21) AS iva
      FROM public.bunker_lista_articulos bla
      INNER JOIN public.bunker_cliente_listas_precios bclp ON bclp.bunker_lista_precio_id = bla.lista_id
      INNER JOIN public.bunker_clientes bc ON bc.id = bclp.bunker_cliente_id AND bc.lomas_soft_id = \$\${clientPId}
      LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = bla.articulo_numero
      LEFT JOIN public.stock_real_consolidado src ON (src.articulo_numero = bla.articulo_numero OR src.codigo_barras = bla.articulo_numero)
      LEFT JOIN public.precios_articulos pa ON LOWER(pa.descripcion) = LOWER(src.descripcion) OR LOWER(pa.descripcion) = LOWER(ba.descripcion)
      \${whereClause}
      ORDER BY
        CASE WHEN COALESCE(src.stock_consolidado,0) > 0 THEN 0 ELSE 1 END ASC,
        COALESCE(ba.descripcion_generada, ba.descripcion, src.descripcion, pa.descripcion) ASC
      LIMIT \$\${p + 1}
    \`;`;

if (code.includes(targetBlock)) {
    code = code.replace(targetBlock, replacementBlock);
    console.log('✅ Replaced search SQL query block successfully.');
} else {
    console.error('❌ Target block not found in presupuestos.js!');
}

// Convert back to CRLF if required
if (hasCrlf) {
    code = code.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('Finished modifying presupuestos.js.');
