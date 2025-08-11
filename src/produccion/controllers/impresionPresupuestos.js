const pool = require('../config/database');

/**
 * Genera impresión de presupuesto por cliente en PDF o HTML
 */
const imprimirPresupuestoCliente = async (req, res) => {
    try {
        console.log('🔍 [PROD_PED] Iniciando impresión de presupuesto...');
        
        const { 
            cliente_id, 
            fecha_desde, 
            fecha_hasta, 
            formato = 'pdf' 
        } = req.query;
        
        // Validaciones
        if (!cliente_id || isNaN(parseInt(cliente_id))) {
            return res.status(400).json({
                success: false,
                error: 'cliente_id es requerido',
                timestamp: new Date().toISOString()
            });
        }
        
        if (fecha_desde && !fecha_desde.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return res.status(400).json({
                success: false,
                error: 'fecha_desde debe tener formato YYYY-MM-DD',
                timestamp: new Date().toISOString()
            });
        }
        
        if (fecha_hasta && !fecha_hasta.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return res.status(400).json({
                success: false,
                error: 'fecha_hasta debe tener formato YYYY-MM-DD',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('📋 [PROD_PED] Parámetros impresión:', { cliente_id, fecha_desde, fecha_hasta, formato });
        
        // Obtener datos del cliente y sus presupuestos
        const query = `
            WITH presupuestos_cliente AS (
                SELECT 
                    p.id_presupuesto_ext,
                    p.fecha,
                    p.estado
                FROM public.presupuestos p
                WHERE p.activo = true 
                  AND CAST(p.id_cliente AS integer) = $1
                  AND p.estado = 'presupuesto/orden'
                  AND ($2::date IS NULL OR p.fecha >= $2)
                  AND ($3::date IS NULL OR p.fecha <= $3)
            )
            SELECT 
                c.cliente_id,
                COALESCE(
                    NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''),
                    NULLIF(TRIM(c.nombre), ''),
                    'Cliente ' || c.cliente_id
                ) as cliente_nombre,
                c.telefono,
                c.email,
                c.domicilio,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'id_presupuesto_ext', pc.id_presupuesto_ext,
                        'fecha', pc.fecha,
                        'articulos', (
                            SELECT JSON_AGG(
                                JSON_BUILD_OBJECT(
                                    'articulo_numero', pd.articulo,
                                    'descripcion', COALESCE(
                                        NULLIF(TRIM(src.descripcion), ''),
                                        NULLIF(TRIM(a.nombre), ''),
                                        pd.articulo
                                    ),
                                    'cantidad', COALESCE(pd.cantidad, 0),
                                    'stock_disponible', COALESCE(src.stock_consolidado, 0),
                                    'faltante', GREATEST(0, COALESCE(pd.cantidad, 0) - COALESCE(src.stock_consolidado, 0))
                                ) ORDER BY pd.articulo
                            )
                            FROM public.presupuestos_detalles pd
                            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = pd.articulo
                            LEFT JOIN public.articulos a ON a.numero = pd.articulo
                            WHERE pd.id_presupuesto_ext = pc.id_presupuesto_ext
                        )
                    ) ORDER BY pc.fecha DESC
                ) as presupuestos
            FROM public.clientes c
            JOIN presupuestos_cliente pc ON true
            WHERE c.cliente_id = $1
            GROUP BY c.cliente_id, c.nombre, c.apellido, c.telefono, c.email, c.domicilio;
        `;
        
        const params = [
            parseInt(cliente_id),
            fecha_desde || null,
            fecha_hasta || null
        ];
        
        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) {
            console.log('❌ [PROD_PED] Cliente no encontrado o sin presupuestos:', cliente_id);
            return res.status(404).json({
                success: false,
                error: 'Cliente no encontrado o sin presupuestos',
                cliente_id: parseInt(cliente_id),
                timestamp: new Date().toISOString()
            });
        }
        
        const clienteData = result.rows[0];
        console.log(`✅ [PROD_PED] Datos obtenidos para cliente: ${clienteData.cliente_nombre}`);
        
        if (formato === 'html') {
            return generarHTML(res, clienteData);
        } else {
            return generarPDF(res, clienteData);
        }
        
    } catch (error) {
        console.error('❌ [PROD_PED] Error en impresión:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Genera respuesta HTML
 */
function generarHTML(res, clienteData) {
    try {
        const fechaHoy = new Date().toLocaleDateString('es-AR');
        
        let html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Presupuesto - ${clienteData.cliente_nombre}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.4; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
        .cliente-info { margin-bottom: 20px; background: #f9f9f9; padding: 15px; border-radius: 5px; }
        .presupuesto { margin-bottom: 30px; border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f5f5f5; font-weight: bold; }
        .faltante { color: #dc3545; font-weight: bold; }
        .completo { color: #28a745; }
        .parcial { color: #ffc107; }
        @media print { body { margin: 0; } }
    </style>
</head>
<body>
    <div class="header">
        <h1>GESTIONES LAMDA</h1>
        <h2>Presupuesto de Produccion</h2>
        <p>Fecha: ${fechaHoy}</p>
    </div>
    
    <div class="cliente-info">
        <h3>Cliente: ${clienteData.cliente_nombre}</h3>
        <p><strong>ID:</strong> ${clienteData.cliente_id}</p>
        ${clienteData.telefono ? `<p><strong>Telefono:</strong> ${clienteData.telefono}</p>` : ''}
        ${clienteData.email ? `<p><strong>Email:</strong> ${clienteData.email}</p>` : ''}
        ${clienteData.domicilio ? `<p><strong>Domicilio:</strong> ${clienteData.domicilio}</p>` : ''}
    </div>
`;
        
        clienteData.presupuestos.forEach(presupuesto => {
            html += `
    <div class="presupuesto">
        <h4>Presupuesto: ${presupuesto.id_presupuesto_ext}</h4>
        <p><strong>Fecha:</strong> ${new Date(presupuesto.fecha).toLocaleDateString('es-AR')}</p>
        
        <table>
            <thead>
                <tr>
                    <th>Articulo</th>
                    <th>Descripcion</th>
                    <th>Pedido</th>
                    <th>Stock</th>
                    <th>Faltante</th>
                </tr>
            </thead>
            <tbody>
`;
            
            presupuesto.articulos.forEach(articulo => {
                const claseStock = articulo.faltante > 0 ? 'faltante' : 'completo';
                html += `
                <tr>
                    <td>${articulo.articulo_numero}</td>
                    <td>${articulo.descripcion}</td>
                    <td>${articulo.cantidad}</td>
                    <td>${articulo.stock_disponible}</td>
                    <td class="${claseStock}">${articulo.faltante}</td>
                </tr>
`;
            });
            
            html += `
            </tbody>
        </table>
    </div>
`;
        });
        
        html += `
    <div style="margin-top: 40px; text-align: center; font-size: 12px; color: #666;">
        <p>Generado el ${new Date().toLocaleString('es-AR')} - Sistema LAMDA</p>
    </div>
</body>
</html>
`;
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
        
    } catch (error) {
        console.error('❌ [PROD_PED] Error generando HTML:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando HTML',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Genera respuesta PDF usando PDFKit
 */
function generarPDF(res, clienteData) {
    try {
        // Intentar cargar PDFKit
        let PDFDocument;
        try {
            PDFDocument = require('pdfkit');
        } catch (pdfError) {
            console.error('❌ [PROD_PED] PDFKit no disponible:', pdfError.message);
            return res.status(501).json({
                success: false,
                error: 'PDF no disponible - dependencia faltante',
                sugerencia: 'usar formato=html',
                timestamp: new Date().toISOString()
            });
        }
        
        const fechaHoy = new Date().toLocaleDateString('es-AR');
        const fechaArchivo = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const nombreArchivo = `presupuesto-cliente-${clienteData.cliente_id}-${fechaArchivo}.pdf`;
        
        // Configurar headers de respuesta
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
        
        // Crear documento PDF
        const doc = new PDFDocument({ 
            margin: 50,
            size: 'A4'
        });
        
        // Pipe del documento a la respuesta
        doc.pipe(res);
        
        // Encabezado
        doc.fontSize(20).font('Helvetica-Bold').text('GESTIONES LAMDA', { align: 'center' });
        doc.fontSize(16).font('Helvetica').text('Presupuesto de Produccion', { align: 'center' });
        doc.fontSize(12).text(`Fecha: ${fechaHoy}`, { align: 'center' });
        doc.moveDown(2);
        
        // Información del cliente
        doc.fontSize(14).font('Helvetica-Bold').text('DATOS DEL CLIENTE');
        doc.fontSize(12).font('Helvetica');
        doc.text(`Cliente: ${clienteData.cliente_nombre}`);
        doc.text(`ID: ${clienteData.cliente_id}`);
        
        if (clienteData.telefono) {
            doc.text(`Telefono: ${clienteData.telefono}`);
        }
        if (clienteData.email) {
            doc.text(`Email: ${clienteData.email}`);
        }
        if (clienteData.domicilio) {
            doc.text(`Domicilio: ${clienteData.domicilio}`);
        }
        
        doc.moveDown(1);
        
        // Procesar cada presupuesto
        clienteData.presupuestos.forEach((presupuesto, index) => {
            // Verificar espacio disponible para nueva sección
            if (doc.y > 650) {
                doc.addPage();
            }
            
            doc.fontSize(14).font('Helvetica-Bold').text(`PRESUPUESTO: ${presupuesto.id_presupuesto_ext}`);
            doc.fontSize(12).font('Helvetica').text(`Fecha: ${new Date(presupuesto.fecha).toLocaleDateString('es-AR')}`);
            doc.moveDown(0.5);
            
            // Encabezados de tabla
            const startX = 50;
            const startY = doc.y;
            const rowHeight = 20;
            const colWidths = [80, 150, 60, 60, 60]; // Anchos de columnas
            
            // Dibujar encabezados
            doc.fontSize(10).font('Helvetica-Bold');
            doc.rect(startX, startY, colWidths[0], rowHeight).stroke();
            doc.text('Articulo', startX + 5, startY + 5, { width: colWidths[0] - 10 });
            
            doc.rect(startX + colWidths[0], startY, colWidths[1], rowHeight).stroke();
            doc.text('Descripcion', startX + colWidths[0] + 5, startY + 5, { width: colWidths[1] - 10 });
            
            doc.rect(startX + colWidths[0] + colWidths[1], startY, colWidths[2], rowHeight).stroke();
            doc.text('Pedido', startX + colWidths[0] + colWidths[1] + 5, startY + 5, { width: colWidths[2] - 10 });
            
            doc.rect(startX + colWidths[0] + colWidths[1] + colWidths[2], startY, colWidths[3], rowHeight).stroke();
            doc.text('Stock', startX + colWidths[0] + colWidths[1] + colWidths[2] + 5, startY + 5, { width: colWidths[3] - 10 });
            
            doc.rect(startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], startY, colWidths[4], rowHeight).stroke();
            doc.text('Faltante', startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, startY + 5, { width: colWidths[4] - 10 });
            
            let currentY = startY + rowHeight;
            
            // Dibujar filas de artículos
            presupuesto.articulos.forEach(articulo => {
                // Verificar si necesitamos nueva página
                if (currentY > 750) {
                    doc.addPage();
                    currentY = 50;
                }
                
                doc.fontSize(9).font('Helvetica');
                
                // Columna Artículo
                doc.rect(startX, currentY, colWidths[0], rowHeight).stroke();
                doc.text(articulo.articulo_numero, startX + 5, currentY + 5, { width: colWidths[0] - 10 });
                
                // Columna Descripción (puede ser larga)
                doc.rect(startX + colWidths[0], currentY, colWidths[1], rowHeight).stroke();
                const descripcionCorta = articulo.descripcion.length > 25 ? 
                    articulo.descripcion.substring(0, 22) + '...' : 
                    articulo.descripcion;
                doc.text(descripcionCorta, startX + colWidths[0] + 5, currentY + 5, { width: colWidths[1] - 10 });
                
                // Columna Pedido
                doc.rect(startX + colWidths[0] + colWidths[1], currentY, colWidths[2], rowHeight).stroke();
                doc.text(articulo.cantidad.toString(), startX + colWidths[0] + colWidths[1] + 5, currentY + 5, { width: colWidths[2] - 10 });
                
                // Columna Stock
                doc.rect(startX + colWidths[0] + colWidths[1] + colWidths[2], currentY, colWidths[3], rowHeight).stroke();
                doc.text(articulo.stock_disponible.toString(), startX + colWidths[0] + colWidths[1] + colWidths[2] + 5, currentY + 5, { width: colWidths[3] - 10 });
                
                // Columna Faltante (en rojo si > 0)
                doc.rect(startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY, colWidths[4], rowHeight).stroke();
                if (articulo.faltante > 0) {
                    doc.fillColor('red');
                }
                doc.text(articulo.faltante.toString(), startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, currentY + 5, { width: colWidths[4] - 10 });
                doc.fillColor('black'); // Resetear color
                
                currentY += rowHeight;
            });
            
            doc.y = currentY + 10;
            doc.moveDown(1);
        });
        
        // Pie de página
        doc.fontSize(8).text(
            `Generado el ${new Date().toLocaleString('es-AR')} - Sistema LAMDA`,
            50,
            doc.page.height - 50,
            { align: 'center' }
        );
        
        // Finalizar documento
        doc.end();
        
        console.log(`✅ [PROD_PED] PDF generado: ${nombreArchivo}`);
        
    } catch (error) {
        console.error('❌ [PROD_PED] Error generando PDF:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando PDF',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    imprimirPresupuestoCliente
};
