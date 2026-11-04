const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
  const adbPath = path.join(__dirname, 'platform-tools', 'adb.exe');
  execSync(`"${adbPath}" forward tcp:9222 localabstract:chrome_devtools_remote`);

  console.log('🔍 Consultando pestañas en Moto G06...');

  http.get('http://localhost:9222/json', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
      const pages = JSON.parse(raw);
      console.log(`📱 Pestañas en Moto G06 (${pages.length}):`);
      pages.forEach((p, idx) => console.log(`   [${idx}] ${p.title || 'Sin Título'} | ${p.url}`));

      const target = pages.find(p => p.url.includes('proud-darkness')) || pages[0];
      if (!target) {
        console.log('❌ No hay pestañas disponibles.');
        return;
      }

      console.log(`🎯 Conectado a pestaña: ${target.title || target.url}`);
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      let id = 1;
      const send = (method, params = {}) => ws.send(JSON.stringify({ id: id++, method, params }));

      const requests = new Map();

      ws.on('open', () => {
        send('Network.enable');
        send('Page.enable');
        send('Performance.enable');
        console.log('\n=============================================================');
        console.log('👉 En la pantalla del Moto G06, tocá RECARGAR o abrí el portal.');
        console.log('=============================================================\n');
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data);

        if (msg.method === 'Network.requestWillBeSent') {
          requests.set(msg.params.requestId, { url: msg.params.request.url, startTime: msg.params.timestamp });
          console.log(`🌐 [RED MOTO G06] ${msg.params.request.url.substring(0, 90)}`);
        }

        if (msg.method === 'Network.loadingFinished') {
          const req = requests.get(msg.params.requestId);
          if (req) {
            const ms = ((msg.params.timestamp - req.startTime) * 1000).toFixed(0);
            console.log(`✅ [RED OK MOTO G06] ${ms} ms | ${req.url.substring(0, 80)}`);
          }
        }

        if (msg.method === 'Page.loadEventFired') {
          console.log(`\n🏁 [LOAD EVENT MOTO G06] ¡Carga completada en Moto G06!`);
          send('Performance.getMetrics');
        }

        if (msg.result && msg.result.metrics) {
          console.log('\n📊 === RENDIMIENTO CPU Y RENDER MOTO G06 ===');
          msg.result.metrics.forEach(m => {
            if (['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(m.name)) {
              console.log(`   - ${m.name.padEnd(25)}: ${(m.value * 1000).toFixed(2)} ms`);
            }
          });
          console.log('================================================\n');
        }
      });
    });
  });
}

main().catch(err => console.error(err));
