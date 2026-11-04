async function inspectLiveChunkLogic() {
    console.log('================================================================================');
    console.log('🔬 AUDITORÍA EXACTA DE LA LÓGICA DE DFWrhUHb.js (DESPLEGADO EN VIVO)');
    console.log('================================================================================\n');

    try {
        const url = 'https://proud-darkness-ac3d.miserrano75.workers.dev/assets/RecepcionPedido-DfWrhUHb.js';
        const res = await fetch(url);
        const code = await res.text();

        console.log('1. Extracción de UUID / Token en el bundle en vivo:');
        const splitIdx = code.indexOf('.split(');
        if (splitIdx !== -1) {
            console.log(code.substring(splitIdx - 100, splitIdx + 200));
        }

        console.log('\n2. Consulta Supabase en el bundle en vivo:');
        const supaIdx = code.indexOf('clientes_b2b_pedidos_cabecera');
        if (supaIdx !== -1) {
            console.log(code.substring(supaIdx - 100, supaIdx + 300));
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

inspectLiveChunkLogic();
