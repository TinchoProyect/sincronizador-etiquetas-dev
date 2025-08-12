const pool = require('../config/database');

/**
 * Genera impresión de presupuesto por cliente en formato remito rediseñado (PDF o HTML)
 * REDISEÑO: Formato R compacto, moderno y minimalista
 */
const imprimirPresupuestoCliente = async (req, res) => {
    try {
        console.log('🔍 [REMITO-R] Iniciando impresión de remito rediseñado...');
        
        const { 
            cliente_id, 
            fecha_desde, 
            fecha_hasta, 
            formato = 'html' 
        } = req.query;
        
        // Validaciones
        if (!cliente_id || isNaN(parseInt(cliente_id))) {
            console.log('❌ [REMITO-R] cliente_id inválido:', cliente_id);
            return res.status(400).json({
                success: false,
                error: 'cliente_id es requerido y debe ser un número válido',
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
        
        console.log('📋 [REMITO-R] Parámetros impresión:', { cliente_id, fecha_desde, fecha_hasta, formato });
        
        // 🔧 CONSULTA MEJORADA: Obtener descripciones reales de artículos
        const query = `
            WITH presupuestos_cliente AS (
                SELECT 
                    p.id_presupuesto_ext,
                    p.fecha
                FROM public.presupuestos p
                WHERE p.activo = true 
                  AND CAST(p.id_cliente AS integer) = $1
                  AND LOWER(TRIM(p.estado)) ILIKE '%presupuesto%orden%'
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
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'id_presupuesto_ext', pc.id_presupuesto_ext,
                        'fecha', pc.fecha,
                        'articulos', (
                            SELECT JSON_AGG(
                                JSON_BUILD_OBJECT(
                                    'articulo_numero', pd.articulo,
                                    'descripcion', COALESCE(
                                        NULLIF(TRIM(a.nombre), ''),
                                        NULLIF(TRIM(a.descripcion), ''),
                                        NULLIF(TRIM(src.descripcion), ''),
                                        'Artículo ' || pd.articulo
                                    ),
                                    'cantidad', COALESCE(pd.cantidad, 0)
                                ) ORDER BY pd.articulo
                            )
                            FROM public.presupuestos_detalles pd
                            LEFT JOIN public.articulos a ON (a.numero = pd.articulo OR a.codigo_barras = pd.articulo)
                            LEFT JOIN public.stock_real_consolidado src ON (src.articulo_numero = pd.articulo OR src.codigo_barras = pd.articulo)
                            WHERE pd.id_presupuesto_ext = pc.id_presupuesto_ext
                        )
                    ) ORDER BY pc.fecha DESC
                ) as presupuestos
            FROM public.clientes c
            JOIN presupuestos_cliente pc ON true
            WHERE c.cliente_id = $1
            GROUP BY c.cliente_id, c.nombre, c.apellido;
        `;
        
        const params = [
            parseInt(cliente_id),
            fecha_desde || null,
            fecha_hasta || null
        ];
        
        console.log('🔍 [REMITO-R] Ejecutando consulta con parámetros:', params);
        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) {
            console.log('❌ [REMITO-R] Cliente no encontrado o sin presupuestos confirmados:', cliente_id);
            return res.status(404).json({
                success: false,
                error: 'Cliente no encontrado o sin presupuestos confirmados',
                detalle: 'No se encontraron presupuestos con estado "Presupuesto/Orden" para este cliente',
                cliente_id: parseInt(cliente_id),
                timestamp: new Date().toISOString()
            });
        }
        
        const clienteData = result.rows[0];
        console.log(`✅ [REMITO-R] Datos obtenidos para cliente: ${clienteData.cliente_nombre}`);
        console.log(`📊 [REMITO-R] Total presupuestos encontrados: ${clienteData.presupuestos.length}`);
        
        if (formato === 'pdf') {
            return generarPDF_Rediseñado(res, clienteData);
        } else {
            return generarHTML_Rediseñado(res, clienteData);
        }
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error en impresión:', error);
        console.error('❌ [REMITO-R] Stack trace:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Genera HTML en formato remito rediseñado (Formato R)
 * REDISEÑO: Compacto, moderno, minimalista, una sola hoja
 */
function generarHTML_Rediseñado(res, clienteData) {
    try {
        const fechaHoy = new Date().toLocaleDateString('es-AR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const horaHoy = new Date().toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Remito R - Cliente ${clienteData.cliente_id}</title>
    <style>
        @page {
            size: A4;
            margin: 1.5cm;
        }
        
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 0;
            line-height: 1.3; 
            color: #000;
            font-size: 11px;
        }
        
        .remito-container {
            max-width: 100%;
            margin: 0 auto;
            padding: 15px;
        }
        
        /* ENCABEZADO MODERNO Y MINIMALISTA */
        .header { 
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px; 
            border-bottom: 1px solid #333; 
            padding-bottom: 12px; 
        }
        
        .header-left {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .logo-lamda { 
            font-size: 24px; 
            font-weight: 300; 
            letter-spacing: 2px;
            color: #000;
        }
        
        .letra-r {
            font-size: 36px;
            font-weight: bold;
            color: #000;
            border: 2px solid #000;
            width: 50px;
            height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
        }
        
        .fecha-emision { 
            font-size: 10px; 
            text-align: right;
            color: #666;
        }
        
        /* DATOS DEL PEDIDO - COMPACTOS */
        .datos-pedido { 
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px; 
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        
        .numero-cliente {
            font-size: 14px;
            font-weight: bold;
        }
        
        .nombre-cliente {
            font-size: 12px;
            color: #333;
        }
        
        .codigo-presupuesto {
            font-size: 11px;
            font-family: monospace;
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 3px;
        }
        
        /* TABLA DE ARTÍCULOS - COMPACTA */
        .articulos-tabla { 
            width: 100%; 
            border-collapse: collapse; 
            margin: 10px 0; 
            font-size: 10px;
        }
        
        .articulos-tabla th { 
            background-color: #f8f9fa; 
            font-weight: 600; 
            text-align: left;
            padding: 6px 4px;
            border: 1px solid #dee2e6;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .articulos-tabla td { 
            padding: 4px; 
            border: 1px solid #dee2e6; 
            vertical-align: top;
        }
        
        .articulos-tabla .col-codigo {
            width: 20%;
            font-family: monospace;
            font-size: 9px;
            background: #fafafa;
        }
        
        .articulos-tabla .col-descripcion {
            width: 65%;
            word-wrap: break-word;
        }
        
        .articulos-tabla .col-cantidad {
            width: 15%;
            text-align: center;
            font-weight: 600;
        }
        
        /* CONTROL DE ENTREGA - REDISEÑADO */
        .control-entrega {
            margin-top: 25px;
            border: 1px solid #333;
            padding: 12px;
            background: #fafafa;
        }
        
        .control-entrega h4 {
            margin: 0 0 12px 0;
            font-size: 11px;
            text-align: center;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .campos-control {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-bottom: 12px;
        }
        
        .campo-firma {
            border-bottom: 1px solid #333;
            padding-bottom: 3px;
            min-height: 20px;
        }
        
        .campo-firma label {
            font-size: 9px;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
        }
        
        .campo-entregado {
            grid-column: 1 / -1;
            border-bottom: 1px solid #333;
            padding-bottom: 3px;
            min-height: 20px;
        }
        
        .nota-importante {
            margin-top: 10px;
            padding: 6px;
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 3px;
            font-size: 8px;
            text-align: justify;
            color: #856404;
        }
        
        /* PIE DE PÁGINA MINIMALISTA */
        .pie-pagina {
            margin-top: 15px;
            text-align: center;
            font-size: 8px;
            color: #999;
            border-top: 1px solid #eee;
            padding-top: 8px;
        }
        
        /* ESTILOS DE IMPRESIÓN */
        @media print {
            body { 
                margin: 0; 
                font-size: 10px;
            }
            
            .remito-container {
                padding: 0;
            }
            
            .header {
                margin-bottom: 15px;
                padding-bottom: 8px;
            }
            
            .control-entrega {
                page-break-inside: avoid;
                margin-top: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="remito-container">
        <!-- ENCABEZADO MODERNO -->
        <div class="header">
            <div class="header-left">
                <div class="logo-lamda">LAMDA</div>
                <div class="letra-r">R</div>
            </div>
            <div class="fecha-emision">
                ${fechaHoy} - ${horaHoy}
            </div>
        </div>
        
        <!-- DATOS DEL PEDIDO -->
        <div class="datos-pedido">
            <div>
                <div class="numero-cliente">N° de Cliente: ${clienteData.cliente_id}</div>
                <div class="nombre-cliente">${clienteData.cliente_nombre}</div>
            </div>
            <div>
`;
        
        // Mostrar códigos de presupuesto
        clienteData.presupuestos.forEach((presupuesto, index) => {
            html += `<div class="codigo-presupuesto">${presupuesto.id_presupuesto_ext}</div>`;
        });
        
        html += `
            </div>
        </div>
        
        <!-- TABLA DE ARTÍCULOS -->
        <table class="articulos-tabla">
            <thead>
                <tr>
                    <th class="col-codigo">Código</th>
                    <th class="col-descripcion">Descripción del Artículo</th>
                    <th class="col-cantidad">Cantidad</th>
                </tr>
            </thead>
            <tbody>
`;
        
        // Consolidar todos los artículos de todos los presupuestos
        const articulosConsolidados = new Map();
        
        clienteData.presupuestos.forEach(presupuesto => {
            if (presupuesto.articulos && presupuesto.articulos.length > 0) {
                presupuesto.articulos.forEach(articulo => {
                    const key = articulo.articulo_numero;
                    if (articulosConsolidados.has(key)) {
                        // Sumar cantidades si el artículo ya existe
                        const existente = articulosConsolidados.get(key);
                        existente.cantidad += articulo.cantidad;
                    } else {
                        // Agregar nuevo artículo
                        articulosConsolidados.set(key, {
                            articulo_numero: articulo.articulo_numero,
                            descripcion: articulo.descripcion,
                            cantidad: articulo.cantidad
                        });
                    }
                });
            }
        });
        
        // Mostrar artículos consolidados
        if (articulosConsolidados.size > 0) {
            Array.from(articulosConsolidados.values())
                .sort((a, b) => a.articulo_numero.localeCompare(b.articulo_numero))
                .forEach(articulo => {
                    html += `
                <tr>
                    <td class="col-codigo">${articulo.articulo_numero}</td>
                    <td class="col-descripcion">${articulo.descripcion}</td>
                    <td class="col-cantidad">${articulo.cantidad}</td>
                </tr>
`;
                });
        } else {
            html += `
                <tr>
                    <td colspan="3" style="text-align: center; font-style: italic; color: #666; padding: 15px;">
                        No hay artículos registrados
                    </td>
                </tr>
`;
        }
        
        html += `
            </tbody>
        </table>
        
        <!-- CONTROL DE ENTREGA REDISEÑADO -->
        <div class="control-entrega">
            <h4>Control de Entrega</h4>
            
            <div class="campos-control">
                <div class="campo-firma">
                    <label>Nombre legible de quien recibe</label>
                </div>
                
                <div class="campo-firma">
                    <label>Firma (opcional)</label>
                </div>
                
                <div class="campo-entregado">
                    <label>Entregado por</label>
                </div>
            </div>
            
            <div class="nota-importante">
                <strong>IMPORTANTE:</strong> Este comprobante se usa para armar el pedido y controlarlo en destino. 
                Al entregar, se puede sacar una foto del papel con el nombre escrito por quien recibe.
            </div>
        </div>
        
        <!-- PIE DE PÁGINA -->
        <div class="pie-pagina">
            Sistema LAMDA - ${new Date().toLocaleString('es-AR')}
        </div>
    </div>
</body>
</html>
`;
        
        console.log(`✅ [REMITO-R] HTML rediseñado generado para cliente: ${clienteData.cliente_nombre}`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error generando HTML rediseñado:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando remito HTML rediseñado',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Genera PDF en formato remito rediseñado (Formato R)
 * REDISEÑO: Compacto, moderno, minimalista, una sola hoja
 */
function generarPDF_Rediseñado(res, clienteData) {
    try {
        // Intentar cargar PDFKit
        let PDFDocument;
        try {
            PDFDocument = require('pdfkit');
        } catch (pdfError) {
            console.error('❌ [REMITO-R] PDFKit no disponible:', pdfError.message);
            return res.status(501).json({
                success: false,
                error: 'PDF no disponible - dependencia faltante',
                sugerencia: 'usar formato=html',
                timestamp: new Date().toISOString()
            });
        }
        
        const fechaHoy = new Date().toLocaleDateString('es-AR');
        const horaHoy = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const fechaArchivo = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const nombreArchivo = `remito-r-cliente-${clienteData.cliente_id}-${fechaArchivo}.pdf`;
        
        // Configurar headers de respuesta
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
        
        // Crear documento PDF compacto
        const doc = new PDFDocument({ 
            margin: 30,
            size: 'A4'
        });
        
        // Pipe del documento a la respuesta
        doc.pipe(res);
        
        // ENCABEZADO MODERNO Y MINIMALISTA
        // Logo LAMDA
        doc.fontSize(20).font('Helvetica-Light').text('LAMDA', 50, 50);
        
        // Letra R en recuadro
        doc.rect(120, 45, 30, 30).stroke();
        doc.fontSize(24).font('Helvetica-Bold').text('R', 130, 52);
        
        // Fecha y hora
        doc.fontSize(9).font('Helvetica').text(`${fechaHoy} - ${horaHoy}`, 450, 55);
        
        // Línea separadora
        doc.moveTo(50, 85).lineTo(545, 85).stroke();
        
        // DATOS DEL PEDIDO - COMPACTOS
        doc.fontSize(12).font('Helvetica-Bold').text(`N° de Cliente: ${clienteData.cliente_id}`, 50, 100);
        doc.fontSize(10).font('Helvetica').text(clienteData.cliente_nombre, 50, 115);
        
        // Códigos de presupuesto (lado derecho)
        let presupuestoY = 100;
        clienteData.presupuestos.forEach(presupuesto => {
            doc.fontSize(9).font('Helvetica').text(presupuesto.id_presupuesto_ext, 450, presupuestoY);
            presupuestoY += 12;
        });
        
        // TABLA DE ARTÍCULOS - COMPACTA
        const tablaY = 140;
        const colWidths = [80, 350, 60]; // Código, Descripción, Cantidad
        const rowHeight = 15;
        
        // Encabezados
        doc.fontSize(8).font('Helvetica-Bold');
        doc.rect(50, tablaY, colWidths[0], rowHeight).stroke();
        doc.text('CÓDIGO', 55, tablaY + 4);
        
        doc.rect(50 + colWidths[0], tablaY, colWidths[1], rowHeight).stroke();
        doc.text('DESCRIPCIÓN DEL ARTÍCULO', 55 + colWidths[0], tablaY + 4);
        
        doc.rect(50 + colWidths[0] + colWidths[1], tablaY, colWidths[2], rowHeight).stroke();
        doc.text('CANT.', 55 + colWidths[0] + colWidths[1], tablaY + 4);
        
        // Consolidar artículos
        const articulosConsolidados = new Map();
        
        clienteData.presupuestos.forEach(presupuesto => {
            if (presupuesto.articulos && presupuesto.articulos.length > 0) {
                presupuesto.articulos.forEach(articulo => {
                    const key = articulo.articulo_numero;
                    if (articulosConsolidados.has(key)) {
                        const existente = articulosConsolidados.get(key);
                        existente.cantidad += articulo.cantidad;
                    } else {
                        articulosConsolidados.set(key, {
                            articulo_numero: articulo.articulo_numero,
                            descripcion: articulo.descripcion,
                            cantidad: articulo.cantidad
                        });
                    }
                });
            }
        });
        
        // Filas de artículos
        let currentY = tablaY + rowHeight;
        doc.fontSize(8).font('Helvetica');
        
        if (articulosConsolidados.size > 0) {
            Array.from(articulosConsolidados.values())
                .sort((a, b) => a.articulo_numero.localeCompare(b.articulo_numero))
                .forEach(articulo => {
                    // Verificar espacio disponible
                    if (currentY > 650) {
                        doc.addPage();
                        currentY = 50;
                    }
                    
                    // Código
                    doc.rect(50, currentY, colWidths[0], rowHeight).stroke();
                    doc.text(articulo.articulo_numero, 55, currentY + 4, { width: colWidths[0] - 10 });
                    
                    // Descripción (truncar si es muy larga)
                    doc.rect(50 + colWidths[0], currentY, colWidths[1], rowHeight).stroke();
                    let descripcion = articulo.descripcion;
                    if (descripcion.length > 70) {
                        descripcion = descripcion.substring(0, 67) + '...';
                    }
                    doc.text(descripcion, 55 + colWidths[0], currentY + 4, { width: colWidths[1] - 10 });
                    
                    // Cantidad
                    doc.rect(50 + colWidths[0] + colWidths[1], currentY, colWidths[2], rowHeight).stroke();
                    doc.text(articulo.cantidad.toString(), 55 + colWidths[0] + colWidths[1], currentY + 4, { 
                        width: colWidths[2] - 10, 
                        align: 'center' 
                    });
                    
                    currentY += rowHeight;
                });
        } else {
            doc.rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).stroke();
            doc.text('No hay artículos registrados', 55, currentY + 4, { 
                width: colWidths[0] + colWidths[1] + colWidths[2] - 10, 
                align: 'center' 
            });
            currentY += rowHeight;
        }
        
        // CONTROL DE ENTREGA REDISEÑADO
        const controlY = currentY + 20;
        const controlHeight = 80;
        
        // Recuadro principal
        doc.rect(50, controlY, 490, controlHeight).stroke();
        
        // Título
        doc.fontSize(10).font('Helvetica-Bold')
           .text('CONTROL DE ENTREGA', 50, controlY + 8, { width: 490, align: 'center' });
        
        // Campos en dos columnas
        const campoY = controlY + 25;
        const campoHeight = 15;
        
        // Nombre de quien recibe
        doc.fontSize(8).font('Helvetica-Bold')
           .text('Nombre legible de quien recibe:', 60, campoY);
        doc.moveTo(60, campoY + campoHeight).lineTo(290, campoY + campoHeight).stroke();
        
        // Firma
        doc.text('Firma (opcional):', 310, campoY);
        doc.moveTo(310, campoY + campoHeight).lineTo(530, campoY + campoHeight).stroke();
        
        // Entregado por
        doc.text('Entregado por:', 60, campoY + 25);
        doc.moveTo(60, campoY + 25 + campoHeight).lineTo(530, campoY + 25 + campoHeight).stroke();
        
        // Nota importante
        doc.fontSize(7).font('Helvetica')
           .text('IMPORTANTE: Este comprobante se usa para armar el pedido y controlarlo en destino. ' +
                 'Al entregar, se puede sacar una foto del papel con el nombre escrito por quien recibe.',
                 60, controlY + controlHeight - 15, { 
                     width: 470, 
                     align: 'justify' 
                 });
        
        // Pie de página minimalista
        doc.fontSize(7).font('Helvetica').fillColor('gray')
           .text(`Sistema LAMDA - ${new Date().toLocaleString('es-AR')}`,
                 50, doc.page.height - 25, { 
                     width: 490, 
                     align: 'center' 
                 });
        
        // Finalizar documento
        doc.end();
        
        console.log(`✅ [REMITO-R] PDF rediseñado generado: ${nombreArchivo}`);
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error generando PDF rediseñado:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando remito PDF rediseñado',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    imprimirPresupuestoCliente
};
