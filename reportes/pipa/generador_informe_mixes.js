/**
 * Generador de Informe de Mixes para PIPA
 * 
 * Este script genera un informe profesional con la composición porcentual
 * de todos los productos tipo "mix" elaborados en LAMDA.
 * 
 * Autor: Sistema LAMDA
 * Cliente: PIPA (dietética)
 * Fecha: Diciembre 2024
 */

const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

// Configuración de base de datos
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

/**
 * Obtiene todos los mixes (ingredientes compuestos) de la base de datos
 * @returns {Promise<Array>} Lista de mixes con su información básica
 */
async function obtenerMixes() {
    try {
        console.log('🔍 Buscando productos tipo "mix"...');
        
        const query = `
            SELECT DISTINCT
                i.id,
                i.codigo,
                i.nombre,
                i.descripcion,
                i.unidad_medida,
                i.receta_base_kg,
                COUNT(ic.ingrediente_id) as total_componentes
            FROM ingredientes i
            INNER JOIN ingrediente_composicion ic ON i.id = ic.mix_id
            WHERE i.nombre IS NOT NULL 
            AND i.nombre != ''
            GROUP BY i.id, i.codigo, i.nombre, i.descripcion, i.unidad_medida, i.receta_base_kg
            HAVING COUNT(ic.ingrediente_id) >= 2
            ORDER BY i.nombre ASC;
        `;
        
        const result = await pool.query(query);
        console.log(`✅ Encontrados ${result.rows.length} productos tipo "mix"`);
        
        return result.rows;
    } catch (error) {
        console.error('❌ Error al obtener mixes:', error);
        throw error;
    }
}

/**
 * Obtiene la composición detallada de un mix específico
 * @param {number} mixId - ID del mix
 * @returns {Promise<Object>} Composición del mix con porcentajes calculados
 */
async function obtenerComposicionMix(mixId) {
    try {
        const query = `
            SELECT 
                ic.cantidad,
                i.nombre as nombre_ingrediente,
                i.unidad_medida,
                m.receta_base_kg,
                m.nombre as nombre_mix
            FROM ingrediente_composicion ic
            JOIN ingredientes i ON ic.ingrediente_id = i.id
            JOIN ingredientes m ON ic.mix_id = m.id
            WHERE ic.mix_id = $1
            ORDER BY ic.cantidad DESC;
        `;
        
        const result = await pool.query(query, [mixId]);
        
        if (result.rows.length === 0) {
            return { componentes: [], receta_base_kg: 0 };
        }
        
        const recetaBaseKg = result.rows[0].receta_base_kg || 1;
        const nombreMix = result.rows[0].nombre_mix;
        
        // Calcular porcentajes
        let componentes = result.rows.map(row => ({
            nombre: row.nombre_ingrediente,
            cantidad: parseFloat(row.cantidad),
            unidad_medida: row.unidad_medida,
            porcentaje: (parseFloat(row.cantidad) / recetaBaseKg) * 100
        }));
        
        // Redondear a 2 decimales
        componentes = componentes.map(comp => ({
            ...comp,
            porcentaje: Math.round(comp.porcentaje * 100) / 100
        }));
        
        // Ajustar para que sume exactamente 100.00%
        const sumaActual = componentes.reduce((sum, comp) => sum + comp.porcentaje, 0);
        const diferencia = 100.00 - sumaActual;
        
        if (Math.abs(diferencia) > 0.001) {
            // Ajustar el componente con mayor porcentaje
            const componenteMayor = componentes.reduce((max, comp) => 
                comp.porcentaje > max.porcentaje ? comp : max
            );
            componenteMayor.porcentaje = Math.round((componenteMayor.porcentaje + diferencia) * 100) / 100;
        }
        
        // Ordenar por porcentaje descendente
        componentes.sort((a, b) => b.porcentaje - a.porcentaje);
        
        return {
            componentes,
            receta_base_kg: recetaBaseKg,
            nombre_mix: nombreMix
        };
    } catch (error) {
        console.error(`❌ Error al obtener composición del mix ${mixId}:`, error);
        throw error;
    }
}

/**
 * Detecta posibles alérgenos en los ingredientes
 * @param {Array} componentes - Lista de componentes del mix
 * @returns {Array} Lista de alérgenos detectados
 */
function detectarAlergenos(componentes) {
    const alergenos = [];
    const palabrasClave = {
        'frutos secos': ['almendra', 'nuez', 'avellana', 'pistacho', 'castaña'],
        'maní': ['mani', 'maní', 'cacahuete'],
        'gluten': ['trigo', 'avena', 'cebada', 'centeno', 'gluten'],
        'soja': ['soja', 'soya'],
        'lácteos': ['leche', 'lacteo', 'queso', 'yogur'],
        'huevo': ['huevo', 'clara', 'yema'],
        'sesamo': ['sesamo', 'sésamo', 'ajonjoli']
    };
    
    componentes.forEach(comp => {
        const nombreLower = comp.nombre.toLowerCase();
        Object.entries(palabrasClave).forEach(([alergeno, palabras]) => {
            if (palabras.some(palabra => nombreLower.includes(palabra))) {
                if (!alergenos.includes(alergeno)) {
                    alergenos.push(alergeno);
                }
            }
        });
    });
    
    return alergenos;
}

/**
 * Genera el contenido del informe en formato Markdown
 * @param {Array} mixes - Lista de mixes con sus composiciones
 * @param {Array} datosPendientes - Lista de datos pendientes o asunciones
 * @returns {string} Contenido del informe en Markdown
 */
function generarMarkdown(mixes, datosPendientes = []) {
    const fecha = new Date().toLocaleDateString('es-AR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires'
    });
    
    let markdown = `# LAMDA — Informe de Mixes para PIPA

**Fecha de generación:** ${fecha}  
**Cliente:** PIPA (Dietética)  
**Empresa:** LAMDA  

---

## Índice de Productos

`;

    // Generar índice
    mixes.forEach((mix, index) => {
        markdown += `${index + 1}. [${mix.nombre}](#${mix.nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')})\n`;
    });
    
    markdown += `\n---\n\n## Composición Detallada de Productos\n\n`;
    
    // Generar detalle de cada mix
    mixes.forEach((mix, index) => {
        const ancla = mix.nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
        
        markdown += `### ${index + 1}. ${mix.nombre} {#${ancla}}\n\n`;
        
        // Información básica del mix
        if (mix.codigo) {
            markdown += `**Código interno:** ${mix.codigo}\n\n`;
        }
        
        if (mix.descripcion) {
            markdown += `**Descripción:** ${mix.descripcion}\n\n`;
        }
        
        // Tabla de composición
        markdown += `**Composición porcentual:**\n\n`;
        markdown += `| Componente | Porcentaje |\n`;
        markdown += `|------------|------------|\n`;
        
        mix.composicion.componentes.forEach(comp => {
            markdown += `| ${comp.nombre} | ${comp.porcentaje.toFixed(2)}% |\n`;
        });
        
        // Verificar suma
        const sumaTotal = mix.composicion.componentes.reduce((sum, comp) => sum + comp.porcentaje, 0);
        markdown += `| **TOTAL** | **${sumaTotal.toFixed(2)}%** |\n\n`;
        
        // Alérgenos
        const alergenos = detectarAlergenos(mix.composicion.componentes);
        if (alergenos.length > 0) {
            markdown += `**⚠️ Posibles alérgenos:** ${alergenos.join(', ')}\n\n`;
        }
        
        // Observaciones si hay
        if (mix.total_componentes !== mix.composicion.componentes.length) {
            markdown += `**Observación:** Se detectaron ${mix.total_componentes} componentes en base de datos, pero se procesaron ${mix.composicion.componentes.length}.\n\n`;
        }
        
        markdown += `---\n\n`;
    });
    
    // Sección de datos pendientes/asunciones
    if (datosPendientes.length > 0) {
        markdown += `## Datos Pendientes/Asunciones\n\n`;
        datosPendientes.forEach((item, index) => {
            markdown += `${index + 1}. ${item}\n`;
        });
        markdown += `\n`;
    }
    
    // Footer
    markdown += `---\n\n`;
    markdown += `*Informe generado automáticamente por el Sistema LAMDA*  \n`;
    markdown += `*Total de productos analizados: ${mixes.length}*  \n`;
    markdown += `*Fecha: ${fecha}*\n`;
    
    return markdown;
}

/**
 * Convierte el archivo Markdown a PDF usando Puppeteer
 * @param {string} markdownPath - Ruta del archivo Markdown
 * @param {string} pdfPath - Ruta de salida del PDF
 */
async function convertirAPDF(markdownPath, pdfPath) {
    try {
        console.log('📄 Convirtiendo Markdown a PDF...');
        
        // Leer el contenido Markdown
        const markdownContent = await fs.readFile(markdownPath, 'utf8');
        
        // Convertir Markdown a HTML básico
        let htmlContent = markdownContent
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/^---$/gm, '<hr>')
            .replace(/^\| (.+) \|$/gm, (match, content) => {
                const cells = content.split(' | ').map(cell => `<td>${cell}</td>`).join('');
                return `<tr>${cells}</tr>`;
            })
            .replace(/^\|(.+)\|$/gm, (match, content) => {
                if (content.includes('---')) {
                    return ''; // Ignorar separadores de tabla
                }
                const cells = content.split('|').map(cell => `<td>${cell.trim()}</td>`).join('');
                return `<tr>${cells}</tr>`;
            })
            .replace(/(<tr>.*<\/tr>)/gs, '<table border="1" cellpadding="5" cellspacing="0">$1</table>')
            .replace(/\n/g, '<br>');
        
        // HTML completo con estilos
        const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Informe de Mixes - PIPA</title>
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    line-height: 1.6; 
                    margin: 40px;
                    color: #333;
                }
                h1 { 
                    color: #2c3e50; 
                    border-bottom: 3px solid #3498db;
                    padding-bottom: 10px;
                }
                h2 { 
                    color: #34495e; 
                    border-bottom: 1px solid #bdc3c7;
                    padding-bottom: 5px;
                }
                h3 { 
                    color: #2980b9; 
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    margin: 15px 0;
                }
                th, td { 
                    border: 1px solid #ddd; 
                    padding: 8px; 
                    text-align: left; 
                }
                th { 
                    background-color: #f2f2f2; 
                    font-weight: bold;
                }
                hr { 
                    border: none; 
                    height: 1px; 
                    background-color: #bdc3c7; 
                    margin: 20px 0;
                }
                .header { 
                    text-align: center; 
                    margin-bottom: 30px;
                }
                .footer { 
                    text-align: center; 
                    font-style: italic; 
                    color: #7f8c8d;
                    margin-top: 30px;
                }
                @page { 
                    margin: 2cm; 
                    @top-center { 
                        content: "LAMDA - Informe PIPA"; 
                    }
                    @bottom-center { 
                        content: counter(page); 
                    }
                }
            </style>
        </head>
        <body>
            ${htmlContent}
        </body>
        </html>`;
        
        // Usar Puppeteer para generar PDF
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        
        await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
        
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '2cm',
                right: '2cm',
                bottom: '2cm',
                left: '2cm'
            },
            displayHeaderFooter: true,
            headerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%;">LAMDA — Informe de Mixes para PIPA</div>',
            footerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>'
        });
        
        await browser.close();
        console.log('✅ PDF generado exitosamente');
        
    } catch (error) {
        console.error('❌ Error al convertir a PDF:', error);
        console.log('ℹ️ Continuando sin PDF - el archivo Markdown está disponible');
    }
}

/**
 * Función principal que ejecuta todo el proceso
 */
async function generarInforme() {
    const datosPendientes = [];
    
    try {
        console.log('🚀 Iniciando generación de informe de mixes para PIPA...\n');
        
        // 1. Obtener todos los mixes
        const mixes = await obtenerMixes();
        
        if (mixes.length === 0) {
            console.log('⚠️ No se encontraron productos tipo "mix" en la base de datos');
            return;
        }
        
        // 2. Obtener composición de cada mix
        console.log('📊 Calculando composiciones porcentuales...');
        for (let i = 0; i < mixes.length; i++) {
            const mix = mixes[i];
            console.log(`   Procesando: ${mix.nombre} (${i + 1}/${mixes.length})`);
            
            try {
                mix.composicion = await obtenerComposicionMix(mix.id);
                
                // Validaciones
                if (mix.composicion.componentes.length < 2) {
                    datosPendientes.push(`Mix "${mix.nombre}": Tiene menos de 2 componentes (${mix.composicion.componentes.length})`);
                }
                
                if (!mix.receta_base_kg || mix.receta_base_kg <= 0) {
                    datosPendientes.push(`Mix "${mix.nombre}": No tiene definido receta_base_kg o es inválido (${mix.receta_base_kg})`);
                }
                
                const sumaTotal = mix.composicion.componentes.reduce((sum, comp) => sum + comp.porcentaje, 0);
                if (Math.abs(sumaTotal - 100) > 0.01) {
                    datosPendientes.push(`Mix "${mix.nombre}": Los porcentajes no suman exactamente 100% (suma: ${sumaTotal.toFixed(2)}%)`);
                }
                
            } catch (error) {
                console.error(`   ❌ Error procesando ${mix.nombre}:`, error.message);
                datosPendientes.push(`Mix "${mix.nombre}": Error al procesar composición - ${error.message}`);
                mix.composicion = { componentes: [], receta_base_kg: 0 };
            }
        }
        
        // 3. Generar archivo Markdown
        console.log('\n📝 Generando archivo Markdown...');
        const markdownContent = generarMarkdown(mixes, datosPendientes);
        const markdownPath = path.join(__dirname, 'informe_mixes_PIPA.md');
        await fs.writeFile(markdownPath, markdownContent, 'utf8');
        console.log(`✅ Archivo Markdown generado: ${markdownPath}`);
        
        // 4. Generar archivo PDF
        console.log('\n📄 Generando archivo PDF...');
        const pdfPath = path.join(__dirname, 'informe_mixes_PIPA.pdf');
        await convertirAPDF(markdownPath, pdfPath);
        
        // 5. Resumen final
        console.log('\n🎉 ¡Informe generado exitosamente!');
        console.log('=====================================');
        console.log(`📁 Archivos generados:`);
        console.log(`   • ${markdownPath}`);
        console.log(`   • ${pdfPath}`);
        console.log(`📊 Estadísticas:`);
        console.log(`   • Total de mixes procesados: ${mixes.length}`);
        console.log(`   • Total de componentes únicos: ${[...new Set(mixes.flatMap(m => m.composicion.componentes.map(c => c.nombre)))].length}`);
        console.log(`   • Datos pendientes/asunciones: ${datosPendientes.length}`);
        
        if (datosPendientes.length > 0) {
            console.log('\n⚠️ Revisar sección "Datos Pendientes/Asunciones" en el informe');
        }
        
    } catch (error) {
        console.error('❌ Error general en la generación del informe:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    generarInforme().catch(error => {
        console.error('💥 Error fatal:', error);
        process.exit(1);
    });
}

module.exports = {
    generarInforme,
    obtenerMixes,
    obtenerComposicionMix,
    generarMarkdown
};
