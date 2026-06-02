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
    SELECT 
      a.nombre, 
      COALESCE(a.stock_ventas, 0) as stock_actual, 
      SUM(pd.cantidad) as demanda,
      (SUM(pd.cantidad) - COALESCE(a.stock_ventas, 0)) as faltante
    FROM presupuestos_detalles pd
    JOIN articulos a ON pd.articulo = a.numero
    GROUP BY a.nombre, a.stock_ventas
    HAVING (SUM(pd.cantidad) - COALESCE(a.stock_ventas, 0)) > 0
    ORDER BY faltante DESC
    LIMIT 20
  `;
  const { rows: produccion } = await pool.query(queryArticulos);

  let html = '<html><head><meta charset="utf-8"><style>body { font-family: Helvetica, sans-serif; margin: 40px; color: #333; } h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; } h2 { color: #e74c3c; margin-top: 30px; } table { width: 100%; border-collapse: collapse; margin-top: 15px; } th, td { border: 1px solid #ddd; padding: 12px; text-align: left; } th { background-color: #f8f9fa; font-weight: bold; } .urgent { color: red; font-weight: bold; } .warning { color: orange; font-weight: bold; } .footer { margin-top: 50px; font-size: 12px; color: #7f8c8d; text-align: center; }</style></head><body>';
  html += '<h1>📋 Plan de Producción de ARTÍCULOS - LAMDA</h1>';
  html += '<p><strong>Generado el:</strong> ' + new Date().toLocaleDateString('es-AR') + ' | <strong>Carro de Producción:</strong> Matías</p>';
  html += '<p>Este reporte cruza la <strong>Demanda en Presupuestos Activos</strong> contra el <strong>Stock Real de Ventas</strong> de los artículos terminados. Te muestra exactamente cuántos <strong>artículos</strong> necesitás producir (faltante) para cubrir las ventas.</p>';
  
  html += '<h2>🚀 Orden de Prioridades (Mayor Faltante Primero)</h2>';
  html += '<table><tr><th>Artículo a Producir</th><th>Stock en Ventas</th><th>Demanda (Presupuestos)</th><th>Faltante (¡A Producir!)</th></tr>';
  
  produccion.forEach(p => {
    let cls = p.faltante > 50 ? 'urgent' : 'warning';
    html += '<tr><td>' + p.nombre + '</td><td>' + p.stock_actual + '</td><td>' + p.demanda + '</td><td class="' + cls + '">' + p.faltante + '</td></tr>';
  });
  
  if (produccion.length === 0) {
     html += '<tr><td colspan="4" style="text-align:center;">No hay faltantes registrados actualmente. ¡El stock cubre las ventas!</td></tr>';
  }
  
  html += '</table>';
  html += '<h2>📋 Siguientes Pasos en el Carro</h2><p>1. Buscá los artículos de la tabla superior en tu pantalla de producción.<br>2. Verificá si tenés los ingredientes (materia prima) necesarios para cubrirlos.<br>3. Cargá las cantidades de <strong>Faltante</strong> a tu carro.</p>';
  html += '<div class="footer">Reporte generado automáticamente por Sistema LAMDA - Inteligencia de Producción</div>';
  html += '</body></html>';

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  await page.pdf({ path: 'C:/Users/Martin/Desktop/Plan_de_Produccion_Articulos_Matias.pdf', format: 'A4' });
  await browser.close();
  pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
