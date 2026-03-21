const fetch = require('node-fetch');

async function run() {
  const payloadLomasoft = {
      cliente_id: '216',
      monto_total: 210502.97,
      fecha_creacion: '2026-01-01', // Una fecha anterior para que traiga facturas viejas
      articulos: []
  };

  try {
      const lomaRes = await fetch('https://api.lamdaser.com/api/facturas/candidatas', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
          },
          body: JSON.stringify(payloadLomasoft)
      });
      const data = await lomaRes.json();
      console.log(JSON.stringify(data, null, 2));
  } catch(e) {
      console.error(e);
  }
}
run();
