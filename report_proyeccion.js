const puppeteer = require('puppeteer');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

async function main() {
  const queryArticulos = `
    WITH ventas_historicas AS (
      SELECT 
        articulo_numero, 
        SUM(cantidad) as total_vendido_30d
      FROM stock_ventas_movimientos
      WHERE tipo IN ('salida a ventas', 'egreso') 
        AND fecha >= NOW() - INTERVAL '30 days'
      GROUP BY articulo_numero
    )
    SELECT 
      a.nombre, 
      COALESCE(a.stock_ventas, 0) as stock_actual, 
      COALESCE(vh.total_vendido_30d, 0) as proyeccion_mensual,
      (COALESCE(vh.total_vendido_30d, 0) - COALESCE(a.stock_ventas, 0)) as faltante_proyectado
    FROM articulos a
    LEFT JOIN ventas_historicas vh ON a.numero = vh.articulo_numero
    WHERE (COALESCE(vh.total_vendido_30d, 0) - COALESCE(a.stock_ventas, 0)) > 0
    ORDER BY faltante_proyectado DESC
    LIMIT 30
  `;
  
  const { rows: produccion } = await pool.query(queryArticulos);

  let html = '<html><head><meta charset="utf-8"><style>body { font-family: Helvetica, sans-serif; margin: 40px; color: #333; } h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; } h2 { color: #e74c3c; margin-top: 30px; } table { width: 100%; border-collapse: collapse; margin-top: 15px; } th, td { border: 1px solid #ddd; padding: 12px; text-align: left; } th { background-color: #f8f9fa; font-weight: bold; } .urgent { color: red; font-weight: bold; } .warning { color: orange; font-weight: bold; } .footer { margin-top: 50px; font-size: 12px; color: #7f8c8d; text-align: center; }</style></head><body>';
  html += '<h1>📈 Proyección de Producción (A 30 Días) - LAMDA</h1>';
  html += '<p><strong>Generado el:</strong> ' + new Date().toLocaleDateString('es-AR') + ' | <strong>Carro de Producción:</strong> Matías</p>';
  html += '<p>Este reporte calcula una <strong>proyección de la demanda para el próximo mes</strong> basada en el ritmo de salida a ventas de los últimos 30 días, y lo compara con el <strong>Stock Actual</strong>. Te muestra exactamente en qué artículos debes reforzar el stock para no quedarte sin mercadería a mediados de mes.</p>';
  
  html += '<h2>🚀 Orden de Prioridades a Producir (Proyección Mensual)</h2>';
  html += '<table><tr><th>Artículo a Producir</th><th>Stock Actual</th><th>Proyección 30 Días</th><th>A Producir (Faltante Proyectado)</th></tr>';
  
  produccion.forEach(p => {
    let cls = p.faltante_proyectado > 100 ? 'urgent' : 'warning';
    html += '<tr><td>' + p.nombre + '</td><td>' + Number(p.stock_actual).toFixed(2) + '</td><td>' + Number(p.proyeccion_mensual).toFixed(2) + '</td><td class="' + cls + '">' + Number(p.faltante_proyectado).toFixed(2) + '</td></tr>';
  });
  
  if (produccion.length === 0) {
     html += '<tr><td colspan="4" style="text-align:center;">¡El stock actual es suficiente para cubrir la proyección de ventas del próximo mes!</td></tr>';
  }
  
  html += '</table>';
  html += '<h2>📋 Plan de Acción para Matías</h2><p>1. <strong>Stock Crítico (Rojo):</strong> Son los artículos que se van a agotar en los próximos días si no se reponen. Producción y envasado urgente.<br>2. <strong>Stock de Alerta (Naranja):</strong> Artículos que vas a necesitar producir antes de fin de mes para no quebrar stock.<br>3. Cargá las cantidades de la columna "A Producir" a tu carro a medida que tengas disponibilidad de materias primas.</p>';
  html += '<div class="footer">Reporte proyectivo generado automáticamente por Sistema LAMDA - Inteligencia de Producción</div>';
  html += '</body></html>';

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  await page.pdf({ path: 'C:/Users/Martin/Desktop/Proyeccion_Mensual_Matias.pdf', format: 'A4' });
  await browser.close();
  pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
