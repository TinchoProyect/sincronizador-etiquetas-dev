const https = require('https');

const token = 'cfut_tdyaMXN9XUKN8eo77AkhqWm1PihMjvvyA8i6N9w950659f6e';

function cfFetch(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(`https://api.cloudflare.com/client/v4${path}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch(e) {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('🔍 Obteniendo Cuentas...');
  const accounts = await cfFetch('/accounts');
  console.log('CUENTAS:', JSON.stringify(accounts, null, 2));

  if (accounts.result && accounts.result.length > 0) {
    const accountId = accounts.result[0].id;
    console.log(`\n🔍 Obteniendo Workers en la cuenta: ${accountId}`);
    const workers = await cfFetch(`/accounts/${accountId}/workers/scripts`);
    console.log('WORKERS:', JSON.stringify(workers, null, 2));
  }
}

main().catch(console.error);
