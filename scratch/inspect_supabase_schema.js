const requireEnv = require('dotenv').config();

async function main() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  const url = 'https://wofttcnpipozwupmpuul.supabase.co/rest/v1/recepciones_fisicas_items?limit=1';
  const res = await fetch(url, { headers });
  if (res.ok) {
    const data = await res.json();
    console.log('RECEPCIONES FISICAS ITEMS RAW ROW KEYS:', Object.keys(data[0] || {}));
    console.log('ROW DATA:', data[0]);
  } else {
    console.error('Error:', await res.text());
  }

  const url2 = 'https://wofttcnpipozwupmpuul.supabase.co/rest/v1/pedidos_b2b_items?limit=1';
  const res2 = await fetch(url2, { headers });
  if (res2.ok) {
    const data2 = await res2.json();
    console.log('PEDIDOS B2B ITEMS RAW ROW KEYS:', Object.keys(data2[0] || {}));
    console.log('ROW DATA:', data2[0]);
  } else {
    console.error('Error:', await res2.text());
  }
}

main();
