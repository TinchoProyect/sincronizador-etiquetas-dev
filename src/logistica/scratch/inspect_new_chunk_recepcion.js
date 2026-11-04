async function inspectNewChunkRecepcion() {
    console.log('================================================================================');
    console.log('🔬 AUDITORÍA DEL CHUNK DE RECEPCIÓN EN EL NUEVO DESPLIEGUE (index-BV-rdqoN.js)');
    console.log('================================================================================\n');

    try {
        const portalUrl = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
        const resCode = await fetch(`${portalUrl}/assets/index-BV-rdqoN.js`);
        const code = await resCode.text();

        const chunkMatches = [...code.matchAll(/assets\/[a-zA-Z0-9_-]+\.js/g)].map(m => m[0]);
        console.log('Chunks JS referenciados en index-BV-rdqoN.js:', chunkMatches);

        for (const chunk of chunkMatches) {
            const chunkUrl = `${portalUrl}/${chunk}`;
            const res = await fetch(chunkUrl);
            const text = await res.text();
            if (text.includes('Remito') || text.includes('recepcion') || text.includes('cargarPedidoCompleto')) {
                console.log(`\n🎯 NUEVO CHUNK DE RECEPCIÓN: ${chunkUrl}`);
                console.log(`   - Tamaño: ${text.length} bytes`);
                
                // Inspeccionar las primeras 40 líneas de la lógica de carga
                const cargarIdx = text.indexOf('cargarPedidoCompleto');
                if (cargarIdx !== -1) {
                    console.log('\n   - Snippet alrededor de cargarPedidoCompleto:');
                    console.log(text.substring(cargarIdx - 150, cargarIdx + 600));
                }

                const rawPathIdx = text.indexOf('rawPath');
                if (rawPathIdx !== -1) {
                    console.log('\n   - Snippet alrededor de rawPath:');
                    console.log(text.substring(rawPathIdx - 100, rawPathIdx + 400));
                }
            }
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

inspectNewChunkRecepcion();
