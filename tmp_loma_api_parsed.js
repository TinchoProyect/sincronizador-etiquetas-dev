const https = require('https');

const payloadLomasoft = JSON.stringify({
    cliente_id: '216',
    monto_total: 210502.97,
    fecha_creacion: '2026-03-22',
    articulos: []
});

const options = {
  hostname: 'api.lamdaser.com',
  path: '/api/facturas/candidatas',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Content-Length': Buffer.byteLength(payloadLomasoft)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.data && parsed.data.length > 0) {
        console.log("Comprobante Formateado:", parsed.data[0].comprobante_formateado);
        console.log("Importe:", parsed.data[0].importe_total);
      } else {
        console.log("NO DATA found.");
      }
    } catch(e) {
      console.log("Raw output:", data);
    }
  });
});

req.on('error', (e) => {
  console.error(`Status error: ${e.message}`);
});

req.write(payloadLomasoft);
req.end();
