async function checkLiveWorker() {
  console.log('🔍 AUDITANDO DOMINIO PRODUCCIÓN REAL EN CLOUDFLARE:');
  const url1 = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
  const url2 = 'https://proud-darkness-ac3d.night-idea.workers.dev';

  try {
    const r1 = await fetch(url1 + '/index.html');
    const html1 = await r1.text();
    console.log(`📡 URL 1 (miserrano75): Status ${r1.status}`);

    const r2 = await fetch(url2 + '/index.html');
    const html2 = await r2.text();
    console.log(`📡 URL 2 (night-idea): Status ${r2.status}`);

    const match1 = html1.match(/src=["'](\/assets\/index-[^"']+\.js)["']/);
    const match2 = html2.match(/src=["'](\/assets\/index-[^"']+\.js)["']/);

    console.log('📦 Bundle en miserrano75 (PRODUCCIÓN REAL):', match1 ? match1[1] : 'No encontrado');
    console.log('📦 Bundle en night-idea (TEMPORAL):', match2 ? match2[1] : 'No encontrado');

    if (match1) {
      const jsRes1 = await fetch(url1 + match1[1]);
      const js1 = await jsRes1.text();
      console.log('🔍 ¿Tiene b2b_cliente_nombre en miserrano75?:', js1.includes('b2b_cliente_nombre'));
      console.log('🔍 ¿Tiene realNombre en miserrano75?:', js1.includes('realNombre'));
    }

    if (match2) {
      const jsRes2 = await fetch(url2 + match2[1]);
      const js2 = await jsRes2.text();
      console.log('🔍 ¿Tiene b2b_cliente_nombre en night-idea?:', js2.includes('b2b_cliente_nombre'));
      console.log('🔍 ¿Tiene realNombre en night-idea?:', js2.includes('realNombre'));
    }

  } catch (e) {
    console.error('❌ Error en auditoría:', e.message);
  }
  process.exit(0);
}

checkLiveWorker();
