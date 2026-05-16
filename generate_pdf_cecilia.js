const { Client } = require('pg');
const dotenv = require('dotenv');
const PDFDocument = require('pdfkit');
const fs = require('fs');

dotenv.config();

const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function generateReport() {
    await client.connect();
    try {
        console.log("Fetching requested articles for client 577 with 10.5% IVA...");
        
        const res = await client.query(`
            SELECT DISTINCT pa.articulo as codigo, pa.descripcion as nombre, pa.iva
            FROM presupuestos p
            JOIN presupuestos_detalles pd ON p.id = pd.id_presupuesto
            JOIN articulos a ON a.codigo_barras = pd.articulo
            JOIN precios_articulos pa ON pa.articulo = a.numero
            WHERE p.id_cliente = '577' 
            AND (pa.iva = '10.5' OR pa.iva = '10.50' OR CAST(pa.iva AS numeric) = 10.5)
            ORDER BY pa.descripcion ASC
        `);
        
        const articles = res.rows;
        console.log("Found " + articles.length + " articles.");
        
        const doc = new PDFDocument({ margin: 50 });
        const filePath = 'Informe_Cecilia_IVA_10_5.pdf';
        doc.pipe(fs.createWriteStream(filePath));
        
        // Header
        doc.fontSize(20).text('Informe de Articulos Solicitados con IVA 10.5%', { align: 'center' });
        doc.moveDown();
        doc.fontSize(14).text('Cliente: Cecilia (ID: 577)');
        doc.text("Fecha: " + new Date().toLocaleDateString());
        doc.moveDown(2);
        
        // Table Header
        doc.fontSize(12).font('Helvetica-Bold');
        const startY = doc.y;
        doc.text('Codigo', 50, startY);
        doc.text('Articulo', 150, startY);
        doc.text('IVA', 500, startY);
        
        doc.moveTo(50, startY + 15).lineTo(550, startY + 15).stroke();
        
        let currentY = startY + 25;
        doc.font('Helvetica');
        
        for (const article of articles) {
            if (currentY > 700) {
                doc.addPage();
                currentY = 50;
            }
            doc.text((article.codigo || '-').substring(0, 15), 50, currentY);
            doc.text((article.nombre || '').substring(0, 60), 150, currentY);
            doc.text(article.iva + "%", 500, currentY);
            currentY += 20;
        }
        
        if (articles.length === 0) {
            doc.text("No se encontraron articulos solicitados con IVA 10.5% para este cliente.", 50, currentY + 20);
        }
        
        doc.end();
        console.log("PDF generated successfully at " + filePath);
        
    } catch (e) {
        console.error("Error generating report:", e);
    } finally {
        await client.end();
    }
}
generateReport();
