const puppeteer = require('puppeteer');

/**
 * Genera un PDF de un presupuesto usando Puppeteer (Headless Chrome)
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function generarPDFPresupuesto(req, res) {
    const { id } = req.params;
    const { formato, sololista } = req.query;

    if (!id) {
        return res.status(400).json({ success: false, error: 'ID de presupuesto requerido' });
    }

    let browser;
    try {
        console.log(`📄 [PDF] Iniciando generación de PDF para Presupuesto #${id}`);
        console.log(`📄 [PDF] Opciones: formato=${formato}, sololista=${sololista}`);

        browser = await puppeteer.launch({
            // Headless 'new' is the modern standard, fallback to basic true if required by puppeteer version
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        
        // Construir la URL local del servidor central (3003) para renderizar la plantilla HTML purificada
        const pdfUrl = `http://localhost:3003/pages/imprimir-presupuesto.html?id=${id}&formato=${formato || ''}${sololista === 'true' ? '&sololista=true' : ''}`;
        
        console.log(`📄 [PDF] Navegando (Headless) a: ${pdfUrl}`);
        
        // Esperamos a que la red se estabilice para garantizar que los fetchs internos de los items trajeron la data
        await page.goto(pdfUrl, { waitUntil: 'networkidle0', timeout: 35000 });

        // Ajustamos la vista para que las Media Queries resuelvan la impresión limpia
        await page.emulateMediaType('print');

        // Generamos el buffer binario PDF
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

        console.log(`✅ [PDF] Generado exitosamente: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);

        // Enviamos el archivo como Binario File-Attachment Stream
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Presupuesto_${id}.pdf`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        res.end(pdfBuffer);

    } catch (error) {
        console.error('❌ [PDF ERROR]:', error);
        res.status(500).json({ success: false, error: 'Fallo interno al generar el PDF de Compartición Nativa', details: error.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = {
    generarPDFPresupuesto
};
