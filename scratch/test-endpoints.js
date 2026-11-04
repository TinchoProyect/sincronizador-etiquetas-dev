const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function main() {
  console.log('--- TECHNICAL VERIFICATION START ---');
  
  // 1. Query movements
  const client = await pool.connect();
  try {
    console.log('Querying database for test movements...');
    const queryRC = `
      SELECT id, tipo_comprobante, descripcion, metadatos, monto 
      FROM public.factura_cuenta_corriente_movimientos 
      WHERE tipo_comprobante IN ('RECIBO', 'RECIBO_PAGO', 'COBRO_BANCARIO', 'COBRO_CHEQUE') 
      ORDER BY id DESC LIMIT 5;
    `;
    const resRC = await client.query(queryRC);
    console.log('Recent Receipts / Payments:');
    resRC.rows.forEach(r => {
      console.log(`- ID: ${r.id}, Type: ${r.tipo_comprobante}, Desc: "${r.descripcion}", Metadatos: ${JSON.stringify(r.metadatos)}, Monto: ${r.monto}`);
    });

    const queryFC = `
      SELECT id, tipo_comprobante, descripcion, comprobante_id, monto 
      FROM public.factura_cuenta_corriente_movimientos 
      WHERE tipo_comprobante IN ('FACTURA', 'FACTURA_A', 'NOTA_CREDITO', 'NOTA_DEBITO') 
      ORDER BY id DESC LIMIT 5;
    `;
    const resFC = await client.query(queryFC);
    console.log('\nRecent Invoices:');
    resFC.rows.forEach(r => {
      console.log(`- ID: ${r.id}, Type: ${r.tipo_comprobante}, Desc: "${r.descripcion}", Comprobante ID: ${r.comprobante_id}, Monto: ${r.monto}`);
    });

    // 2. Test Logistics Server HTTP endpoints
    const portCC = 3005;
    console.log(`\nTesting Logistics Server on port ${portCC}...`);
    
    // Check if logistics server is up
    try {
      const pingRes = await fetch(`http://localhost:${portCC}`);
      console.log(`Logistics Server root ping status: ${pingRes.status} ${pingRes.statusText}`);
    } catch (err) {
      console.warn(`Logistics Server is not responding on port ${portCC}: ${err.message}`);
      console.log('Trying to start logistics server might be needed, or let us see if we can query it directly.');
    }

    if (resRC.rows.length > 0) {
      const rcId = resRC.rows[0].id;
      const pdfUrl = `http://localhost:${portCC}/api/logistica/bunker/cuentas-corrientes/movimientos/${rcId}/pdf`;
      console.log(`\nTesting PDF endpoint for Receipt (ID: ${rcId}): ${pdfUrl}`);
      try {
        const rcRes = await fetch(pdfUrl);
        console.log(`Response status: ${rcRes.status}`);
        console.log(`Headers Content-Type: ${rcRes.headers.get('content-type')}`);
        console.log(`Headers Content-Disposition: ${rcRes.headers.get('content-disposition')}`);
        if (rcRes.ok) {
          const buffer = await rcRes.arrayBuffer();
          console.log(`PDF retrieved successfully! Size: ${buffer.byteLength} bytes.`);
        } else {
          console.error(`Failed to fetch receipt PDF: ${await rcRes.text()}`);
        }
      } catch (err) {
        console.error(`Error requesting receipt PDF: ${err.message}`);
      }
    }

    if (resFC.rows.length > 0) {
      const fcId = resFC.rows[0].id;
      const pdfUrl = `http://localhost:${portCC}/api/logistica/bunker/cuentas-corrientes/movimientos/${fcId}/pdf`;
      console.log(`\nTesting PDF endpoint for Invoice (ID: ${fcId}): ${pdfUrl}`);
      try {
        const fcRes = await fetch(pdfUrl);
        console.log(`Response status: ${fcRes.status}`);
        console.log(`Headers Content-Type: ${fcRes.headers.get('content-type')}`);
        console.log(`Headers Content-Disposition: ${fcRes.headers.get('content-disposition')}`);
        if (fcRes.ok) {
          const buffer = await fcRes.arrayBuffer();
          console.log(`PDF retrieved successfully! Size: ${buffer.byteLength} bytes.`);
        } else {
          console.error(`Failed to fetch invoice PDF: ${await fcRes.text()}`);
        }
      } catch (err) {
        console.error(`Error requesting invoice PDF: ${err.message}`);
      }
    }

  } catch (err) {
    console.error('Database query failed:', err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
