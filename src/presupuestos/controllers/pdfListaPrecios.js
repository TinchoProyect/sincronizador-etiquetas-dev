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
    
    // ✅ NUEVO: Leer parámetros de configuración desde query string
    const agruparMeses = req.query.agrupar_meses === '1';
    const mostrarPrecioKilo = req.query.mostrar_precio_kilo === '1';
    const modoIva = req.query.modo_iva || 'incluido'; // 'incluido' | 'discriminado'
    
    const requestId = `pdf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`📄 [PDF-LISTA-PRECIOS] ${requestId} - Generando PDF para cliente: ${id_cliente}`);
    console.log(`⚙️ [PDF-LISTA-PRECIOS] ${requestId} - Configuración:`, {
        agruparMeses,
        mostrarPrecioKilo,
        modoIva
    });
    
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
        // ✅ MEJORADO: Incluye rubro, sub_rubro y kilos_unidad para configuración avanzada
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
                COALESCE(pa.iva, 0) as iva,
                
                -- ✅ NUEVOS CAMPOS para configuración avanzada
                COALESCE(pa.rubro, 'Sin categoría') as rubro,
                COALESCE(pa.sub_rubro, 'Sin subcategoría') as sub_rubro,
                COALESCE(src.kilos_unidad, 0) as kilos_unidad
                
            FROM public.presupuestos p
            INNER JOIN public.presupuestos_detalles pd ON pd.id_presupuesto_ext = p.id_presupuesto_ext
            LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo
            LEFT JOIN public.precios_articulos pa ON LOWER(pa.descripcion) = LOWER(a.nombre)
            LEFT JOIN public.stock_real_consolidado src 
                ON src.codigo_barras = pd.articulo 
                OR src.articulo_numero = pd.articulo
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
        
        // 3. Procesar productos con datos enriquecidos
        const precioBase = (precios) => calcularPrecioSegunLista(listaPrecios, precios);
        
        const productos = historialResult.rows.map(p => {
            const precioBruto = precioBase({
                precio_neg: p.precio_lista1,
                mayorista: p.precio_lista2,
                especial_brus: p.precio_lista3,
                consumidor_final: p.precio_lista4,
                lista_5: p.precio_lista5
            });
            
            const ivaValor = parseFloat(p.iva || 0);
            const kilosUnidad = parseFloat(p.kilos_unidad || 0);
            
            // Calcular precio según modo IVA
            const precioFinal = modoIva === 'incluido' 
                ? precioBruto * (1 + ivaValor / 100)
                : precioBruto;
            
            // Calcular precio por kilo
            const precioPorKilo = kilosUnidad > 0 
                ? precioFinal / kilosUnidad 
                : 0;
            
            return {
                descripcion: p.descripcion,
                codigo_barras: p.codigo_barras,
                ultima_cantidad: parseFloat(p.ultima_cantidad || 0),
                ultima_fecha: p.ultima_fecha_entrega,
                precio_bruto: precioBruto,
                precio_final: precioFinal,
                iva: ivaValor,
                rubro: p.rubro || 'Sin categoría',
                sub_rubro: p.sub_rubro || 'Sin subcategoría',
                kilos_unidad: kilosUnidad,
                precio_por_kilo: precioPorKilo
            };
        });
        
        // Ordenar: por rubro primero, luego alfabéticamente
        productos.sort((a, b) => {
            const rubroCompare = a.rubro.localeCompare(b.rubro);
            if (rubroCompare !== 0) return rubroCompare;
            return a.descripcion.localeCompare(b.descripcion);
        });
        
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
        
        // === AGRUPAR POR RUBRO (siempre) ===
        const productosPorRubro = {};
        productos.forEach(p => {
            if (!productosPorRubro[p.rubro]) {
                productosPorRubro[p.rubro] = [];
            }
            productosPorRubro[p.rubro].push(p);
        });
        
        const rubros = Object.keys(productosPorRubro).sort();
        
        console.log(`📊 [PDF-LISTA-PRECIOS] ${requestId} - Rubros encontrados: ${rubros.length}`);
        
        // === CONFIGURAR COLUMNAS SEGÚN OPCIONES ===
        let colPositions, colWidths;
        
        if (mostrarPrecioKilo && modoIva === 'discriminado') {
            // 4 columnas: Producto | Cant | Precio | IVA | $/Kg
            colPositions = {
                descripcion: 50,
                cantidad: 300,
                precio: 360,
                iva: 430,
                precioKilo: 480
            };
            colWidths = {
                descripcion: 240,
                cantidad: 50,
                precio: 60,
                iva: 40,
                precioKilo: 50
            };
        } else if (mostrarPrecioKilo) {
            // 3 columnas: Producto | Cant | Precio | $/Kg
            colPositions = {
                descripcion: 50,
                cantidad: 330,
                precio: 400,
                precioKilo: 480
            };
            colWidths = {
                descripcion: 270,
                cantidad: 60,
                precio: 70,
                precioKilo: 50
            };
        } else if (modoIva === 'discriminado') {
            // 3 columnas: Producto | Cant | Precio | IVA
            colPositions = {
                descripcion: 50,
                cantidad: 350,
                precio: 420,
                iva: 490
            };
            colWidths = {
                descripcion: 290,
                cantidad: 60,
                precio: 60,
                iva: 40
            };
        } else {
            // 3 columnas básicas: Producto | Cant | Precio
            colPositions = {
                descripcion: 50,
                cantidad: 370,
                precio: 440
            };
            colWidths = {
                descripcion: 310,
                cantidad: 60,
                precio: 90
            };
        }
        
        // === RENDERIZAR PRODUCTOS ===
        let y = doc.y;
        let totalProductos = 0;
        let sumaPrecios = 0;
        let sumaPreciosSinIva = 0;
        let sumaIva = 0;
        
        // Función helper para dibujar headers
        const dibujarHeaders = (yPos) => {
            doc.fontSize(10)
               .font('Helvetica-Bold')
               .fillColor('#2563eb');
            
            doc.text('Producto', colPositions.descripcion, yPos);
            doc.text('Cant.', colPositions.cantidad, yPos, { width: colWidths.cantidad, align: 'center' });
            doc.text('Precio', colPositions.precio, yPos, { width: colWidths.precio, align: 'right' });
            
            if (modoIva === 'discriminado') {
                doc.text('IVA%', colPositions.iva, yPos, { width: colWidths.iva, align: 'center' });
            }
            
            if (mostrarPrecioKilo) {
                doc.text('$/Kg', colPositions.precioKilo, yPos, { width: colWidths.precioKilo, align: 'right' });
            }
            
            // Línea separadora
            doc.strokeColor('#2563eb')
               .lineWidth(2)
               .moveTo(50, yPos + 16)
               .lineTo(530, yPos + 16)
               .stroke();
            
            doc.fillColor('#000000')
               .strokeColor('#000000')
               .lineWidth(1);
            
            return yPos + 24;
        };
        
        // Iterar por rubros
        rubros.forEach((rubro, rubroIndex) => {
            const productosRubro = productosPorRubro[rubro];
            
            // Verificar espacio para header de rubro
            if (y > 700) {
                doc.addPage();
                y = 50;
            }
            
            // Header de rubro
            doc.fontSize(12)
               .font('Helvetica-Bold')
               .fillColor('#2c3e50')
               .text(`📦 ${rubro}`, 50, y);
            
            y += 20;
            
            // Headers de columnas
            y = dibujarHeaders(y);
            
            doc.font('Helvetica').fontSize(8);
            
            // Productos del rubro
            productosRubro.forEach((producto, index) => {
                // Verificar espacio
                if (y > 720) {
                    doc.addPage();
                    y = 50;
                    y = dibujarHeaders(y);
                    doc.font('Helvetica').fontSize(8);
                }
                
                // Fondo alternado
                if (index % 2 === 0) {
                    doc.rect(45, y - 2, 490, 18)
                       .fillAndStroke('#f8fafc', '#f8fafc');
                }
                
                // Descripción
                const maxLen = mostrarPrecioKilo ? 40 : 50;
                const desc = producto.descripcion.length > maxLen 
                    ? producto.descripcion.substring(0, maxLen - 3) + '...'
                    : producto.descripcion;
                
                doc.fillColor('#000000')
                   .text(desc, colPositions.descripcion, y, { 
                       width: colWidths.descripcion,
                       ellipsis: true
                   });
                
                // Cantidad
                doc.text(
                    producto.ultima_cantidad.toFixed(1), 
                    colPositions.cantidad, 
                    y, 
                    { width: colWidths.cantidad, align: 'center' }
                );
                
                // Precio
                const precioMostrar = modoIva === 'incluido' ? producto.precio_final : producto.precio_bruto;
                doc.fillColor('#10b981')
                   .font('Helvetica-Bold')
                   .text(
                       `$${precioMostrar.toFixed(2)}`, 
                       colPositions.precio, 
                       y, 
                       { width: colWidths.precio, align: 'right' }
                   );
                
                // IVA (si discriminado)
                if (modoIva === 'discriminado') {
                    doc.fillColor('#f39c12')
                       .font('Helvetica')
                       .text(
                           `${producto.iva.toFixed(0)}%`, 
                           colPositions.iva, 
                           y, 
                           { width: colWidths.iva, align: 'center' }
                       );
                }
                
                // Precio por Kilo (si activado y disponible)
                if (mostrarPrecioKilo && producto.precio_por_kilo > 0) {
                    doc.fillColor('#9b59b6')
                       .font('Helvetica')
                       .text(
                           `$${producto.precio_por_kilo.toFixed(2)}`, 
                           colPositions.precioKilo, 
                           y, 
                           { width: colWidths.precioKilo, align: 'right' }
                       );
                }
                
                doc.fillColor('#000000')
                   .font('Helvetica');
                
                y += 18;
                
                // Acumular totales
                totalProductos++;
                sumaPrecios += producto.precio_final;
                sumaPreciosSinIva += producto.precio_bruto;
                sumaIva += (producto.precio_final - producto.precio_bruto);
            });
            
            // Espacio entre rubros
            if (rubroIndex < rubros.length - 1) {
                y += 10;
            }
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
        
        if (modoIva === 'discriminado') {
            // Mostrar desglose de IVA
            doc.text(
                `Subtotal: $${sumaPreciosSinIva.toFixed(2)}`, 
                380, 
                y, 
                { width: 150, align: 'right' }
            );
            y += 15;
            doc.text(
                `IVA: $${sumaIva.toFixed(2)}`, 
                380, 
                y, 
                { width: 150, align: 'right' }
            );
            y += 15;
            doc.fillColor('#10b981')
               .text(
                   `TOTAL: $${sumaPrecios.toFixed(2)}`, 
                   380, 
                   y, 
                   { width: 150, align: 'right' }
               );
            doc.fillColor('#1e293b');
        } else {
            // Mostrar solo total
            doc.text(
                `Total: $${sumaPrecios.toFixed(2)}`, 
                380, 
                y, 
                { width: 150, align: 'right' }
            );
        }
        
        y += 25;
        
        // Nota informativa
        doc.fontSize(8)
           .font('Helvetica-Oblique')
           .fillColor('#64748b');
        
        let notaTexto = `Esta lista muestra los productos que el cliente compró en los últimos 6 meses con sus precios actualizados`;
        
        if (modoIva === 'incluido') {
            notaTexto += ` (IVA incluido)`;
        } else {
            notaTexto += ` (IVA discriminado)`;
        }
        
        notaTexto += `.`;
        
        doc.text(notaTexto, 50, y, { width: 480, align: 'justify' });
        
        y += 20;
        
        doc.text(
            `Los precios corresponden a la Lista ${listaPrecios} asignada al cliente.`,
            50,
            y,
            { width: 480, align: 'justify' }
        );
        
        if (mostrarPrecioKilo) {
            y += 20;
            doc.text(
                `Los precios por kilogramo ($/Kg) se muestran cuando están disponibles.`,
                50,
                y,
                { width: 480, align: 'justify' }
            );
        }
        
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
        
        console.log(`✅ [PDF-LISTA-PRECIOS] ${requestId} - PDF generado exitosamente: ${productos.length} productos, ${rubros.length} rubros`);
        
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
