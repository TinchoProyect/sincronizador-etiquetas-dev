async function inspectLiveRecepcionChunk() {
    console.log('================================================================================');
    console.log('🔍 BÚSQUEDA DEL BUNDLE DE RECEPCIÓN EN CLOUDFLARE WORKERS');
    console.log('================================================================================\n');

    try {
        const portalUrl = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
        const resCode = await fetch(`${portalUrl}/assets/index-BAE96pJL.js`);
        const code = await resCode.text();

        // Buscar import() dinámicos en el JS principal
        const chunkMatches = [...code.matchAll(/assets\/[a-zA-Z0-9_-]+\.js/g)].map(m => m[0]);
        console.log('Chunks JS secundarios encontrados:', chunkMatches);

        for (const chunk of chunkMatches) {
            const chunkUrl = `${portalUrl}/${chunk}`;
            const res = await fetch(chunkUrl);
            const text = await res.text();
            if (text.includes('Remito') || text.includes('recepcion')) {
                console.log(`\n🎯 CHUNK DE RECEPCIÓN ENCONTRADO: ${chunkUrl}`);
                console.log(`   - Tamaño: ${text.length} bytes`);
                const errIdx = text.indexOf('Remito');
                if (errIdx !== -1) {
                    console.log('   - Snippet alrededor de "Remito":');
                    console.log(text.substring(errIdx - 150, errIdx + 300));
                }
            }
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

inspectLiveRecepcionChunk();
