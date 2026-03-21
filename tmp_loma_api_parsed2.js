const https = require('https');
const fs = require('fs');

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
      fs.writeFileSync('tmp_loma_api.json', JSON.stringify(parsed, null, 2));
      console.log("Saved to tmp_loma_api.json");
    } catch(e) {
      console.log("Error parsing JSON:", e);
    }
  });
});

req.on('error', (e) => {
  console.error(`Status error: ${e.message}`);
});

req.write(payloadLomasoft);
req.end();
