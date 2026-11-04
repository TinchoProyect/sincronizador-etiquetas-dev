async function inspectRecepcionInitSnippet() {
    console.log('================================================================================');
    console.log('🔬 AUDITORÍA DE INICIALIZACIÓN DE RUTA EN RecepcionPedido-CU2SmQpY.js');
    console.log('================================================================================\n');

    try {
        const url = 'https://proud-darkness-ac3d.miserrano75.workers.dev/assets/RecepcionPedido-CU2SmQpY.js';
        const res = await fetch(url);
        const text = await res.text();

        // Imprimir las primeras 1000 caracteres de RecepcionPedido
        const fnIdx = text.indexOf('function');
        console.log('Snippet de la función RecepcionPedido:');
        console.log(text.substring(fnIdx, fnIdx + 1200));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

inspectRecepcionInitSnippet();
