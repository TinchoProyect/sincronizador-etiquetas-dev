/**
 * Script alternativo para convertir el Markdown a PDF
 * Usa una configuración más simple de Puppeteer
 */

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

async function convertirMarkdownAPDF() {
    try {
        console.log('📄 Iniciando conversión a PDF...');
        
        // Leer el archivo Markdown
        const markdownPath = path.join(__dirname, 'informe_mixes_PIPA.md');
        const pdfPath = path.join(__dirname, 'informe_mixes_PIPA.pdf');
        
        const markdownContent = await fs.readFile(markdownPath, 'utf8');
        
        // Convertir Markdown a HTML más simple
        let htmlContent = markdownContent
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/^---$/gm, '<hr>')
            .replace(/\n/g, '<br>');
        
        // Procesar tablas
        const lines = htmlContent.split('<br>');
        let inTable = false;
        let processedLines = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('|') && line.endsWith('|')) {
                if (!inTable) {
                    processedLines.push('<table border="1" cellpadding="8" cellspacing="0" style="width:100%; margin: 15px 0; border-collapse: collapse;">');
                    inTable = true;
                }
                
                // Procesar fila de tabla
                const cells = line.slice(1, -1).split('|').map(cell => cell.trim());
                
                // Verificar si es separador
                if (cells.every(cell => cell.match(/^-+$/))) {
                    continue; // Saltar separadores
                }
                
                // Determinar si es encabezado (primera fila de la tabla)
                const isHeader = cells.some(cell => cell.includes('Componente') || cell.includes('Porcentaje'));
                const tag = isHeader ? 'th' : 'td';
                const style = isHeader ? 'background-color: #f2f2f2; font-weight: bold;' : '';
                
                const rowHtml = cells.map(cell => `<${tag} style="border: 1px solid #ddd; padding: 8px; ${style}">${cell}</${tag}>`).join('');
                processedLines.push(`<tr>${rowHtml}</tr>`);
            } else {
                if (inTable) {
                    processedLines.push('</table>');
                    inTable = false;
                }
                processedLines.push(line);
            }
        }
        
        if (inTable) {
            processedLines.push('</table>');
        }
        
        htmlContent = processedLines.join('<br>');
        
        // HTML completo con estilos mejorados
        const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Informe de Mixes - PIPA</title>
            <style>
                body { 
                    font-family: 'Arial', sans-serif; 
                    line-height: 1.6; 
                    margin: 0;
                    padding: 20px;
                    color: #333;
                    font-size: 12px;
                }
                h1 { 
                    color: #2c3e50; 
                    border-bottom: 3px solid #3498db;
                    padding-bottom: 10px;
                    font-size: 24px;
                    text-align: center;
                }
                h2 { 
                    color: #34495e; 
                    border-bottom: 2px solid #bdc3c7;
                    padding-bottom: 5px;
                    font-size: 18px;
                    margin-top: 25px;
                }
                h3 { 
                    color: #2980b9; 
                    font-size: 16px;
                    margin-top: 20px;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    margin: 15px 0;
                    font-size: 11px;
                }
                th, td { 
                    border: 1px solid #ddd; 
                    padding: 8px; 
                    text-align: left; 
                }
                th { 
                    background-color: #f8f9fa; 
                    font-weight: bold;
                    color: #2c3e50;
                }
                tr:nth-child(even) {
                    background-color: #f9f9f9;
                }
                hr { 
                    border: none; 
                    height: 1px; 
                    background-color: #bdc3c7; 
                    margin: 20px 0;
                }
                strong {
                    color: #2c3e50;
                }
                em {
                    color: #7f8c8d;
                }
                .warning {
                    color: #e74c3c;
                    font-weight: bold;
                }
                .footer {
                    text-align: center;
                    font-style: italic;
                    color: #7f8c8d;
                    margin-top: 30px;
                    font-size: 10px;
                }
                @page { 
                    margin: 2cm; 
                    size: A4;
                }
                @media print {
                    body { font-size: 11px; }
                    h1 { font-size: 20px; }
                    h2 { font-size: 16px; }
                    h3 { font-size: 14px; }
                }
            </style>
        </head>
        <body>
            ${htmlContent.replace(/⚠️/g, '<span class="warning">⚠️</span>')}
        </body>
        </html>`;
        
        // Lanzar Puppeteer con configuración más robusta
        console.log('🚀 Lanzando navegador...');
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();
        
        // Configurar timeout más largo
        page.setDefaultTimeout(60000);
        
        console.log('📝 Cargando contenido HTML...');
        await page.setContent(fullHtml, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        console.log('📄 Generando PDF...');
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '2cm',
                right: '1.5cm',
                bottom: '2cm',
                left: '1.5cm'
            },
            displayHeaderFooter: true,
            headerTemplate: `
                <div style="font-size: 10px; text-align: center; width: 100%; color: #666;">
                    LAMDA — Informe de Mixes para PIPA
                </div>
            `,
            footerTemplate: `
                <div style="font-size: 10px; text-align: center; width: 100%; color: #666;">
                    Página <span class="pageNumber"></span> de <span class="totalPages"></span>
                </div>
            `
        });
        
        await browser.close();
        
        console.log('✅ PDF generado exitosamente:', pdfPath);
        return pdfPath;
        
    } catch (error) {
        console.error('❌ Error al convertir a PDF:', error);
        throw error;
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    convertirMarkdownAPDF()
        .then(pdfPath => {
            console.log('🎉 Conversión completada:', pdfPath);
        })
        .catch(error => {
            console.error('💥 Error en la conversión:', error);
            process.exit(1);
        });
}

module.exports = { convertirMarkdownAPDF };
