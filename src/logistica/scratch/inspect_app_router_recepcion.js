async function inspectAppRouterRecepcion() {
    console.log('================================================================================');
    console.log('🔬 AUDITORÍA DE App.jsx: ¿CÓMO SE PASA LA RUTA A RecepcionPedido?');
    console.log('================================================================================\n');

    try {
        const url = 'https://proud-darkness-ac3d.miserrano75.workers.dev/assets/index-BV-rdqoN.js';
        const res = await fetch(url);
        const code = await res.text();

        const recIdx = code.indexOf('/recepcion/');
        console.log('Snippet de renderizado de /recepcion/ en App.jsx:');
        console.log(code.substring(recIdx - 150, recIdx + 200));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

inspectAppRouterRecepcion();
