const requireEnv = require('dotenv').config();

async function run() {
  const url = process.env.SUPABASE_B2B_URL;
  const key = process.env.SUPABASE_B2B_SERVICE_KEY;

  if (!url || !key) {
    console.error('Error: credentials missing in .env');
    return;
  }

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    console.log('🚀 Creando pedido de simulación en Supabase B2B...');
    
    // 1. Insert Cabecera
    const resHeader = await fetch(`${url}/rest/v1/clientes_b2b_pedidos_cabecera`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        cliente_id: '621', // Cliente Testigo
        subtotal: 36845.50,
        descuento: 0.00,
        total: 36845.50,
        observaciones: 'SIMULACION DE PRUEBA DE INTEGRACION - FASE 4',
        estado: 'Borrador',
        sync_estado: 'Pendiente'
      })
    });

    if (!resHeader.ok) {
      throw new Error(`Error cabecera: HTTP ${resHeader.status} - ${await resHeader.text()}`);
    }

    const headersCreated = await resHeader.json();
    const orderId = headersCreated[0].id;
    console.log(`✅ Cabecera de pedido creada con ID: ${orderId}`);

    // 2. Insert Items (AGPX2 y AGPX10Q)
    const resItems = await fetch(`${url}/rest/v1/clientes_b2b_pedidos_items`, {
      method: 'POST',
      headers,
      body: JSON.stringify([
        {
          pedido_id: orderId,
          producto_codigo: 'AGPX2',
          producto_descripcion: 'Artículo de Simulación A',
          cantidad: 5.00,
          precio_unitario: 5000.00,
          subtotal: 25000.00
        },
        {
          pedido_id: orderId,
          producto_codigo: 'AGPX10Q',
          producto_descripcion: 'Artículo de Simulación B',
          cantidad: 1.00,
          precio_unitario: 11845.50,
          subtotal: 11845.50
        }
      ])
    });

    if (!resItems.ok) {
      throw new Error(`Error items: HTTP ${resItems.status} - ${await resItems.text()}`);
    }

    console.log('✅ Detalles de pedido creados correctamente en la nube.');
    console.log(`\n👉 PRUEBA LISTA: Correr 'node src/actualizaPrecios/syncB2BPedidos.js' para ingerir el pedido.`);

  } catch (err) {
    console.error('❌ Error en simulación:', err.message);
  }
}

run();
