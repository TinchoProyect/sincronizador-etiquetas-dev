require('dotenv').config();
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function generarPDF() {
    try {
        console.log('Conectando a la base de datos...');
        const query = `
            SELECT i.nombre as ingrediente, s.nombre as sector_nombre, s.descripcion as sector_desc
            FROM ingredientes i 
            LEFT JOIN sectores_ingredientes s ON i.sector_id = s.id 
            ORDER BY COALESCE(s.descripcion, 'Z'), i.nombre
        `;
        const res = await pool.query(query);
        
        console.log(`Recuperados ${res.rows.length} ingredientes.`);

        const grouped = {};
        for (const row of res.rows) {
            let desc = row.sector_desc || '';
            // Extraer la letra entre comillas, ej: Sector "A" -> A. O usar un fallback.
            let letraMatch = desc.match(/"([^"]+)"/);
            let letra = letraMatch ? letraMatch[1] : '?';
            const sectorName = row.sector_nombre || 'Sin Sector Asignado';

            const groupKey = `${letra}|${sectorName}`;
            if (!grouped[groupKey]) {
                grouped[groupKey] = [];
            }
            grouped[groupKey].push(row.ingrediente);
        }

        const doc = new PDFDocument({ margin: 40 });
        const outputPath = path.join(__dirname, 'Informe_Ingredientes_Por_Sector.pdf');
        
        console.log(`Generando PDF en ${outputPath}...`);
        
        doc.pipe(fs.createWriteStream(outputPath));

        doc.fontSize(22).font('Helvetica-Bold').fillColor('#333333').text('Mapeo Físico de Ingredientes', { align: 'center' });
        doc.moveDown(2);

        for (const [groupKey, items] of Object.entries(grouped)) {
            const [letra, sectorName] = groupKey.split('|');

            // Estimar la altura que ocupará este sector para evitar cortes a mitad de página
            const itemsPerCol = Math.ceil(items.length / 3);
            const estimatedHeight = 60 + itemsPerCol * 18 + 30; // buffer seguro
            
            if (doc.y + estimatedHeight > doc.page.height - doc.page.margins.bottom) {
                doc.addPage();
            }

            // Header para el sector con Letra Destacada
            doc.font('Helvetica-Bold');
            doc.fontSize(22).fillColor('#d9534f').text(`[ ${letra} ] `, { continued: true });
            doc.fontSize(16).fillColor('#003366').text(`- ${sectorName}`);
            
            doc.moveDown(0.5);
            
            // Posiciones iniciales para las columnas
            const startY = doc.y;
            let maxY = startY;
            const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right - 30) / 3;

            doc.fontSize(11).font('Helvetica').fillColor('#000000');
            
            for (let c = 0; c < 3; c++) {
                const chunk = items.slice(c * itemsPerCol, (c + 1) * itemsPerCol);
                if (chunk.length === 0) continue;
                
                const x = doc.page.margins.left + c * (colWidth + 15);
                const chunkStr = chunk.map(item => `• ${item}`).join('\n');
                
                doc.text(chunkStr, x, startY, {
                    width: colWidth,
                    align: 'left',
                    lineGap: 4
                });
                
                if (doc.y > maxY) maxY = doc.y;
            }
            
            // Restaurar el cursor al final de la columna más larga
            doc.x = doc.page.margins.left;
            doc.y = maxY;
            doc.moveDown(2);
        }

        doc.end();
        console.log(`✅ PDF generado exitosamente: ${outputPath}`);

    } catch (error) {
        console.error('❌ Error general:', error);
    } finally {
        await pool.end();
    }
}

generarPDF();
