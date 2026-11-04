async function inspectAppRouteState() {
    console.log('================================================================================');
    console.log('🔬 AUDITORÍA DE App.jsx: ¿CÓMO SE INICIALIZA EL ESTADO DE RUTA `g`?');
    console.log('================================================================================\n');

    try {
        const url = 'https://proud-darkness-ac3d.miserrano75.workers.dev/assets/index-BV-rdqoN.js';
        const res = await fetch(url);
        const code = await res.text();

        const recIdx = code.indexOf('g.startsWith(`/recepcion/`)');
        console.log('Snippet 300 caracteres antes del render de rutas:');
        console.log(code.substring(recIdx - 500, recIdx + 100));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

inspectAppRouteState();
