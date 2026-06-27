const puppeteer = require('puppeteer');

/**
 * Genera un PDF de un presupuesto usando Puppeteer y retorna el buffer
 * @param {string|number} id 
 * @param {Object} queryParams 
 * @returns {Promise<Buffer>}
 */
async function generarPDFPresupuestoBuffer(id, queryParams) {
    const { formato, sololista, faltantes } = queryParams;
    let browser;
    try {
        console.log(`📄 [PDF-BUFFER] Generando buffer para Presupuesto #${id}. Opciones: formato=${formato}, sololista=${sololista}, faltantes=${faltantes}`);

        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        
        // Construir la URL local del servidor central (3003) para renderizar la plantilla HTML
        const pdfUrl = `http://localhost:3003/pages/imprimir-presupuesto.html?id=${id}&formato=${formato || ''}${sololista === 'true' ? '&sololista=true' : ''}${faltantes === 'false' ? '&faltantes=false' : ''}`;
        
        console.log(`📄 [PDF-BUFFER] Navegando (Headless) a: ${pdfUrl}`);
        
        await page.goto(pdfUrl, { waitUntil: 'networkidle0', timeout: 35000 });
        await page.emulateMediaType('print');

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '10mm',
                right: '10mm',
                bottom: '10mm',
                left: '10mm'
            }
        });

        console.log(`✅ [PDF-BUFFER] Generado exitosamente: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
        return Buffer.from(pdfBuffer);

    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Genera un PDF de un presupuesto y lo envía como respuesta HTTP
 */
async function generarPDFPresupuesto(req, res) {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ success: false, error: 'ID de presupuesto requerido' });
    }

    try {
        const pdfBuffer = await generarPDFPresupuestoBuffer(id, req.query);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Presupuesto_${id}.pdf`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        res.end(pdfBuffer);

    } catch (error) {
        console.error('❌ [PDF ERROR]:', error);
        res.status(500).json({ success: false, error: 'Fallo interno al generar el PDF', details: error.message });
    }
}

/**
 * Genera el PDF del presupuesto en el backend y lo despacha al servicio de WhatsApp en el puerto 3004
 */
async function enviarPDFPresupuestoWhatsApp(req, res) {
    const { id } = req.params;
    const { destinatarios, formato, sololista, faltantes, nombreCliente, estado } = req.body;

    if (!id) {
        return res.status(400).json({ success: false, error: 'ID de presupuesto requerido' });
    }

    if (!destinatarios || !destinatarios.trim()) {
        return res.status(400).json({ success: false, error: 'Faltan destinatarios' });
    }

    try {
        console.log(`📱 [WHATSAPP-BACK] Iniciando flujo de WhatsApp para Presupuesto #${id}`);
        
        // 1. Generar el PDF buffer
        const pdfBuffer = await generarPDFPresupuestoBuffer(id, { formato, sololista, faltantes });
        
        // 2. Convertir buffer a Base64
        const pdfBase64 = pdfBuffer.toString('base64');
        
        // 3. Normalizar nombre de archivo
        const cleanNombre = nombreCliente 
            ? String(nombreCliente).trim().replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, '-') 
            : 'Cliente';
        const fechaHoy = new Date().toISOString().split('T')[0];
        const filename = `${id}-Presu-${cleanNombre}-${fechaHoy}.pdf`;
        
        // 4. Determinar mensaje
        const transferInfo = '\n\n*Datos para transferencia:*\n*Banco:* Galicia\n*DU:* 24892174\n*Cuenta (CTA):* 4007844-1 373-4\n*CBU:* 0070373230004007844141\n*CUIL:* 23248921749\n*ALIAS:* LAMDA.SER.MARTIN';
        const tituloDoc = estado === 'Orden de Retiro' ? 'Orden de Retiro / Devolución' : 'Presupuesto';
        const mensajeTexto = `Hola, te enviamos el ${tituloDoc.toLowerCase()} N° ${id} de LAMDA. Saludos.` + transferInfo;

        console.log(`📱 [WHATSAPP-BACK] Despachando PDF por WhatsApp a destinatarios: "${destinatarios}"`);

        // 5. Enviar POST al microservicio de facturación/whatsapp en el puerto 3004
        const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-documento', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                destinatarios,
                pdfBase64,
                filename,
                mensajeTexto
            })
        });

        const data = await response.json();
        
        if (!response.ok || !data.success) {
            console.error(`❌ [WHATSAPP-BACK] Error del servicio de mensajería (3004):`, data);
            return res.status(response.status || 502).json({
                success: false,
                error: data.error || 'Error del servicio de mensajería',
                message: data.message || 'No se pudo enviar el documento por WhatsApp.'
            });
        }

        console.log(`✅ [WHATSAPP-BACK] Envío procesado con éxito por el servicio (3004)`);
        res.json({
            success: true,
            message: 'Envío de WhatsApp de presupuesto procesado.',
            data: data.data
        });

    } catch (error) {
        console.error('❌ [WHATSAPP-BACK-ERROR]:', error);
        res.status(500).json({ success: false, error: 'Fallo interno al despachar por WhatsApp', details: error.message });
    }
}

/**
 * Genera el PDF del presupuesto en el backend y lo despacha al servicio de Email en el puerto 3004
 */
async function enviarPDFPresupuestoEmail(req, res) {
    const { id } = req.params;
    const { destinatarios, formato, sololista, faltantes } = req.body;

    if (!id) {
        return res.status(400).json({ success: false, error: 'ID de presupuesto requerido' });
    }

    if (!destinatarios || !destinatarios.trim()) {
        return res.status(400).json({ success: false, error: 'Faltan destinatarios' });
    }

    try {
        console.log(`📧 [EMAIL-BACK] Iniciando flujo de Email para Presupuesto #${id}`);
        
        // 1. Generar el PDF buffer
        const pdfBuffer = await generarPDFPresupuestoBuffer(id, { formato, sololista, faltantes });
        const pdfBase64 = pdfBuffer.toString('base64');
        
        // 2. Obtener datos del cliente de la base de datos
        const { pool } = require('../config/database');
        const query = `
            SELECT 
                p.id,
                p.id_cliente,
                p.estado,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, 'Cliente') as cliente_nombre,
                bc.codigo_bunker_cliente,
                bc.razon_social
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON 
                (CASE WHEN p.id_cliente ~ '^[0-9]+$' THEN p.id_cliente::integer ELSE NULL END) = c.cliente_id
            LEFT JOIN public.bunker_clientes bc ON 
                (CASE WHEN bc.lomas_soft_id ~ '^[0-9]+$' THEN bc.lomas_soft_id::integer ELSE NULL END) = (CASE WHEN p.id_cliente ~ '^[0-9]+$' THEN p.id_cliente::integer ELSE NULL END)
            WHERE p.id = $1
            LIMIT 1
        `;
        const resQuery = await pool.query(query, [id]);
        if (resQuery.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Presupuesto no encontrado' });
        }
        
        const row = resQuery.rows[0];
        
        // 3. Enviar POST al microservicio de facturación (puerto 3004)
        console.log(`📧 [EMAIL-BACK] Despachando PDF por Email a destinatarios: "${destinatarios}"`);
        const response = await fetch('http://localhost:3004/facturacion/email/presupuestos/enviar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cliente: {
                    cliente_nombre: row.cliente_nombre,
                    razon_social: row.razon_social,
                    codigo_bunker_cliente: row.codigo_bunker_cliente
                },
                destinatarios,
                pdfBase64,
                nroComprobante: String(id)
            })
        });

        const data = await response.json();
        
        if (!response.ok || !data.success) {
            console.error(`❌ [EMAIL-BACK] Error del servicio de mensajería (3004):`, data);
            return res.status(response.status || 502).json({
                success: false,
                error: data.error || 'Error del servicio de correo',
                message: data.message || 'No se pudo enviar el documento por Correo Electrónico.'
            });
        }

        console.log(`✅ [EMAIL-BACK] Envío procesado con éxito por el servicio (3004)`);
        res.json({
            success: true,
            message: 'Envío de correo electrónico de presupuesto procesado.',
            data: data.data
        });

    } catch (error) {
        console.error('❌ [EMAIL-BACK-ERROR]:', error);
        res.status(500).json({ success: false, error: 'Fallo interno al despachar por Correo Electrónico', details: error.message });
    }
}

module.exports = {
    generarPDFPresupuesto,
    enviarPDFPresupuestoWhatsApp,
    enviarPDFPresupuestoEmail,
    generarPDFPresupuestoBuffer
};
