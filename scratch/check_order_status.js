require('dotenv').config();
const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

async function run() {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`
  };

  const id = 'fc96c7c7-b798-44fd-8664-1d100abf4d57';
  const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${id}`;
  
  try {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      console.log("Order found in Supabase:", data);
    } else {
      console.error(`HTTP error: ${res.status}`);
    }
  } catch (err) {
    console.error(err);
  }
}
run();
