const PDFDocument = require('pdfkit');

console.log('📄 [PDF-LISTA-PRECIOS] Cargando controlador de PDF...');

/**
 * Helper: Calcular precio según lista del cliente
 */
function calcularPrecioSegunLista(lista, precios) {
    const listaNum = parseInt(lista) || 1;
    
    switch(listaNum) {
        case 1: return parseFloat(precios.precio_neg || 0);
        case 2: return parseFloat(precios.mayorista || 0);
        case 3: return parseFloat(precios.especial_brus || 0);
        case 4: return parseFloat(precios.consumidor_final || 0);
        case 5: return parseFloat(precios.lista_5 || 0);
        default: return parseFloat(precios.precio_neg || 0);
    }
}

/**
 * Generar PDF con lista de precios personalizada basada en historial del cliente
 */
async function generarListaPreciosPDF(req, res) {
    const { id_cliente } = req.params;
    
    const requestId = `pdf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`📄 [PDF-LISTA-PRECIOS] ${requestId} - Generando PDF para cliente: ${id_cliente}`);
    
    try {
        // 1. Obtener datos del cliente
        const clienteQuery = `
            SELECT 
                cliente_id, 
                nombre, 
                apellido, 
                CAST(COALESCE(NULLIF(TRIM(CAST(lista_precios AS text)), ''), '1') AS integer) as lista_precios
            FROM public.clientes
            WHERE cliente_id = $1
            LIMIT 1
        `;
        
        const clienteResult = await req.db.query(clienteQuery, [parseInt(id_cliente)]);
        
        if (clienteResult.rows.length === 0) {
            console.log(`❌ [PDF-LISTA-PRECIOS] ${requestId} - Cliente no encontrado: ${id_cliente}`);
            return res.status(404).json({ 
                success: false,
                error: 'Cliente no encontrado' 
            });
        }
        
        const cliente = clienteResult.rows[0];
        const nombreCliente = `${cliente.apellido || ''} ${cliente.nombre || ''}`.trim() || `Cliente ${cliente.cliente_id}`;
        const listaPrecios = parseInt(cliente.lista_precios) || 1;
        
        console.log(`📊 [PDF-LISTA-PRECIOS] ${requestId} - Cliente: ${nombreCliente}, Lista: ${listaPrecios}`);
        
        // 2. Obtener historial con precios actuales (últimos 6 meses, productos únicos)
        const historialQuery = `
            SELECT DISTINCT ON (pd.articulo)
                pd.articulo as codigo_barras,
                COALESCE(a.nombre, pd.articulo) as descripcion,
                pd.cantidad as ultima_cantidad,
                COALESCE(p.fecha_entrega, p.fecha) as ultima_fecha_entrega,
                
                -- Precios actuales (todas las listas)
                COALESCE(pa.precio_neg, 0) as precio_lista1,
                COALESCE(pa.mayorista, 0) as precio_lista2,
                COALESCE(pa.especial_brus, 0) as precio_lista3,
                COALESCE(pa.consumidor_final, 0) as precio_lista4,
                COALESCE(pa.lista_5, 0) as precio_lista5,
                COALESCE(pa.iva, 0) as iva
                
            FROM public.presupuestos p
            INNER JOIN public.presupuestos_detalles pd ON pd.id_presupuesto_ext = p.id_presupuesto_ext
            LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo
            LEFT JOIN public.precios_articulos pa ON LOWER(pa.descripcion) = LOWER(a.nombre)
            WHERE p.id_cliente = $1
              AND p.activo = true
              AND LOWER(p.estado) = 'entregado'
              AND COALESCE(p.fecha_entrega, p.fecha) >= NOW() - INTERVAL '6 months'
            ORDER BY pd.articulo, COALESCE(p.fecha_entrega, p.fecha) DESC
        `;
        
        const historialResult = await req.db.query(historialQuery, [id_cliente.toString()]);
        
        console.log(`📦 [PDF-LISTA-PRECIOS] ${requestId} - Productos encontrados: ${historialResult.rows.length}`);
        
        if (historialResult.rows.length === 0) {
            console.log(`⚠️ [PDF-LISTA-PRECIOS] ${requestId} - Cliente sin historial de entregas`);
            return res.status(404).json({ 
                success: false,
                error: 'Cliente sin historial de entregas en los últimos 6 meses' 
            });
        }
        
        // 3. Calcular precio según lista del cliente y ordenar alfabéticamente
        const productos = historialResult.rows.map(p => ({
            descripcion: p.descripcion,
            codigo_barras: p.codigo_barras,
            ultima_cantidad: parseFloat(p.ultima_cantidad || 0),
            ultima_fecha: p.ultima_fecha_entrega,
            precio_actual: calcularPrecioSegunLista(listaPrecios, {
                precio_neg: p.precio_lista1,
                mayorista: p.precio_lista2,
                especial_brus: p.precio_lista3,
                consumidor_final: p.precio_lista4,
                lista_5: p.precio_lista5
            }),
            iva: parseFloat(p.iva || 0)
        })).sort((a, b) => a.descripcion.localeCompare(b.descripcion));
        
        console.log(`✅ [PDF-LISTA-PRECIOS] ${requestId} - Productos procesados y ordenados: ${productos.length}`);
        
        // 4. Generar PDF
        const doc = new PDFDocument({ 
            margin: 50,
            size: 'A4'
        });
        
        // Headers para descarga
        const fechaHoy = new Date().toISOString().split('T')[0];
        const nombreArchivo = `lista-precios-${nombreCliente.replace(/[^a-zA-Z0-9]/g, '-')}-${fechaHoy}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
        
        doc.pipe(res);
        
        // === ENCABEZADO ===
        doc.fontSize(20)
           .font('Helvetica-Bold')
           .text('LISTA DE PRECIOS PERSONALIZADA', { align: 'center' });
        
        doc.moveDown(0.5);
        
        doc.fontSize(14)
           .font('Helvetica')
           .text(`Cliente: ${nombreCliente}`, { align: 'center' });
        
        doc.fontSize(11)
           .text(`Fecha: ${new Date().toLocaleDateString('es-AR', { 
               day: '2-digit', 
               month: 'long', 
               year: 'numeric' 
           })}`, { align: 'center' });
        
        doc.fontSize(9)
           .fillColor('#666666')
           .text(`Basado en historial de compras de los últimos 6 meses`, { align: 'center' });
        
        doc.fillColor('#000000');
        doc.moveDown(1.5);
        
        // === TABLA DE PRODUCTOS ===
        const tableTop = doc.y;
        const colWidths = { 
            descripcion: 320, 
            cantidad: 70, 
            precio: 90 
        };
        
        const colPositions = {
            descripcion: 50,
            cantidad: 370,
            precio: 440
        };
        
        // Headers de tabla
        doc.fontSize(11)
           .font('Helvetica-Bold')
           .fillColor('#2563eb');
        
        doc.text('Producto', colPositions.descripcion, tableTop);
        doc.text('Últ. Cant.', colPositions.cantidad, tableTop, { width: colWidths.cantidad, align: 'center' });
        doc.text('Precio Actual', colPositions.precio, tableTop, { width: colWidths.precio, align: 'right' });
        
        // Línea separadora del header
        doc.strokeColor('#2563eb')
           .lineWidth(2)
           .moveTo(50, tableTop + 18)
           .lineTo(530, tableTop + 18)
           .stroke();
        
        // Resetear color
        doc.fillColor('#000000')
           .strokeColor('#000000')
           .lineWidth(1);
        
        // === PRODUCTOS ===
        let y = tableTop + 28;
        doc.font('Helvetica').fontSize(9);
        
        let totalProductos = 0;
        let sumaPrecios = 0;
        
        productos.forEach((producto, index) => {
            // Verificar si necesitamos nueva página
            if (y > 720) {
                doc.addPage();
                y = 50;
                
                // Re-dibujar headers en nueva página
                doc.fontSize(11)
                   .font('Helvetica-Bold')
                   .fillColor('#2563eb');
                
                doc.text('Producto', colPositions.descripcion, y);
                doc.text('Últ. Cant.', colPositions.cantidad, y, { width: colWidths.cantidad, align: 'center' });
                doc.text('Precio Actual', colPositions.precio, y, { width: colWidths.precio, align: 'right' });
                
                doc.strokeColor('#2563eb')
                   .lineWidth(2)
                   .moveTo(50, y + 18)
                   .lineTo(530, y + 18)
                   .stroke();
                
                doc.fillColor('#000000')
                   .strokeColor('#000000')
                   .lineWidth(1);
                
                y += 28;
                doc.font('Helvetica').fontSize(9);
            }
            
            // Alternar color de fondo para mejor legibilidad
            if (index % 2 === 0) {
                doc.rect(45, y - 3, 490, 22)
                   .fillAndStroke('#f8fafc', '#f8fafc');
            }
            
            // Descripción (truncar si es muy larga)
            const descripcionTruncada = producto.descripcion.length > 55 
                ? producto.descripcion.substring(0, 52) + '...'
                : producto.descripcion;
            
            doc.fillColor('#000000')
               .text(descripcionTruncada, colPositions.descripcion, y, { 
                   width: colWidths.descripcion,
                   ellipsis: true
               });
            
            // Cantidad
            doc.text(
                producto.ultima_cantidad.toFixed(2), 
                colPositions.cantidad, 
                y, 
                { width: colWidths.cantidad, align: 'center' }
            );
            
            // Precio (destacado en verde)
            doc.fillColor('#10b981')
               .font('Helvetica-Bold')
               .text(
                   `$ ${producto.precio_actual.toFixed(2)}`, 
                   colPositions.precio, 
                   y, 
                   { width: colWidths.precio, align: 'right' }
               );
            
            doc.fillColor('#000000')
               .font('Helvetica');
            
            y += 22;
            
            // Línea separadora sutil cada 5 productos
            if ((index + 1) % 5 === 0 && index < productos.length - 1) {
                doc.strokeColor('#e2e8f0')
                   .moveTo(50, y - 2)
                   .lineTo(530, y - 2)
                   .stroke();
                
                doc.strokeColor('#000000');
            }
            
            // Acumular totales
            totalProductos++;
            sumaPrecios += producto.precio_actual;
        });
        
        // === RESUMEN FINAL ===
        y += 15;
        
        // Línea separadora final
        doc.strokeColor('#2563eb')
           .lineWidth(2)
           .moveTo(50, y)
           .lineTo(530, y)
           .stroke();
        
        y += 15;
        
        // Totales
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor('#1e293b');
        
        doc.text(`Total de productos: ${totalProductos}`, 50, y);
        doc.text(
            `Suma de precios: $ ${sumaPrecios.toFixed(2)}`, 
            colPositions.precio - 50, 
            y, 
            { width: 180, align: 'right' }
        );
        
        y += 25;
        
        // Nota informativa
        doc.fontSize(8)
           .font('Helvetica-Oblique')
           .fillColor('#64748b')
           .text(
               `Nota: Esta lista muestra los productos que el cliente compró en los últimos 6 meses con sus precios actualizados.`,
               50,
               y,
               { width: 480, align: 'justify' }
           );
        
        y += 25;
        
        doc.text(
            `Los precios corresponden a la Lista ${listaPrecios} asignada al cliente.`,
            50,
            y,
            { width: 480, align: 'justify' }
        );
        
        // === FOOTER ===
        const footerY = 750;
        
        doc.fontSize(7)
           .font('Helvetica-Oblique')
           .fillColor('#94a3b8')
           .text(
               `Generado automáticamente por Sistema LAMDA - ${new Date().toLocaleString('es-AR')}`,
               50,
               footerY,
               { align: 'center', width: 500 }
           );
        
        // Finalizar PDF
        doc.end();
        
        console.log(`✅ [PDF-LISTA-PRECIOS] ${requestId} - PDF generado exitosamente: ${productos.length} productos`);
        
    } catch (error) {
        console.error(`❌ [PDF-LISTA-PRECIOS] ${requestId} - Error al generar PDF:`, error);
        
        // Si ya se empezó a enviar el PDF, no podemos enviar JSON
        if (res.headersSent) {
            console.error(`❌ [PDF-LISTA-PRECIOS] ${requestId} - Headers ya enviados, no se puede enviar error JSON`);
            return;
        }
        
        res.status(500).json({
            success: false,
            error: 'Error al generar PDF de lista de precios',
            message: error.message,
            requestId
        });
    }
}

console.log('✅ [PDF-LISTA-PRECIOS] Controlador configurado');

module.exports = {
    generarListaPreciosPDF
};
