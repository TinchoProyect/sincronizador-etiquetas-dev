async function inspectOldRecepcionCode() {
    console.log('================================================================================');
    console.log('🔍 ANÁLISIS EXACTO DEL CÓDIGO JS DESPLEGADO EN VIVO (index-BAE96pJL.js)');
    console.log('================================================================================\n');

    try {
        const url = 'https://proud-darkness-ac3d.miserrano75.workers.dev/assets/index-BAE96pJL.js';
        const res = await fetch(url);
        const code = await res.text();

        // Buscar fragmentos donde se extrae el ID de la URL y se llama a Supabase
        const recepcionIdx = code.indexOf('/recepcion/');
        console.log(`1. Posición de '/recepcion/' en el bundle: ${recepcionIdx}`);

        if (recepcionIdx !== -1) {
            console.log('   - Snippet alrededor de /recepcion/:');
            console.log(code.substring(recepcionIdx - 100, recepcionIdx + 400));
        }

        // Buscar fragmento de "Remito No Encontrado"
        const errorIdx = code.indexOf('Remito No Encontrado');
        console.log(`\n2. Posición de 'Remito No Encontrado' en el bundle: ${errorIdx}`);

        if (errorIdx !== -1) {
            console.log('   - Snippet alrededor de "Remito No Encontrado":');
            console.log(code.substring(errorIdx - 300, errorIdx + 200));
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

inspectOldRecepcionCode();
