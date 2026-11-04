require('dotenv').config();

async function checkIdColumnType() {
    console.log('================================================================================');
    console.log('🔍 VERIFICACIÓN DEL TIPO DE DATOS DE LA COLUMNA ID EN SUPABASE');
    console.log('================================================================================\n');

    try {
        const url = process.env.SUPABASE_B2B_URL;
        const key = process.env.SUPABASE_B2B_SERVICE_KEY;

        const res = await fetch(`${url}/rest/v1/clientes_b2b_pedidos_cabecera?limit=1`, {
            headers: {
                'apikey': key,
                'Authorization': `Bearer ${key}`
            }
        });

        const data = await res.json();
        console.log('Ejemplo de fila en clientes_b2b_pedidos_cabecera:');
        console.log(data[0]);

        // Probar si Supabase permite insertar o buscar por id = 'msf620v9-k4n4z'
        const resTest = await fetch(`${url}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.msf620v9-k4n4z`, {
            headers: {
                'apikey': key,
                'Authorization': `Bearer ${key}`
            }
        });

        console.log(`\nStatus de búsqueda por id='msf620v9-k4n4z': ${resTest.status}`);
        const testRes = await resTest.json();
        console.log('Respuesta:', testRes);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkIdColumnType();
