const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
  const adbPath = path.join(__dirname, 'platform-tools', 'adb.exe');
  execSync(`"${adbPath}" forward tcp:9222 localabstract:chrome_devtools_remote`);

  console.log('🚀 Disparando apertura del Portal B2B en el Moto G06 y escuchando métricas...');

  http.get('http://localhost:9222/json', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', async () => {
      const pages = JSON.parse(raw);
      if (!pages.length) {
        console.log('❌ No hay pestañas abiertas.');
        return;
      }

      let target = pages.find(p => p.url.includes('proud-darkness') || p.type === 'page') || pages[0];
      console.log(`🎯 Conectado a Moto G06: ${target.title || target.url} (${target.webSocketDebuggerUrl})`);

      const ws = new WebSocket(target.webSocketDebuggerUrl);
      let id = 1;
      const send = (method, params = {}) => {
        const msgId = id++;
        ws.send(JSON.stringify({ id: msgId, method, params }));
        return msgId;
      };

      const requests = new Map();

      ws.on('open', () => {
        console.log('✅ Inspector activo en Moto G06.');
        send('Network.enable');
        send('Page.enable');
        send('Performance.enable');

        // Navegar a la app si no estaba en ella
        send('Page.navigate', { url: 'https://proud-darkness-ac3d.miserrano75.workers.dev' });
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data);

        if (msg.method === 'Network.requestWillBeSent') {
          const { requestId, request, timestamp } = msg.params;
          requests.set(requestId, { url: request.url, startTime: timestamp });
          console.log(`🌐 [RED MOTO G06] Petición: ${request.url.substring(0, 80)}`);
        }

        if (msg.method === 'Network.loadingFinished') {
          const { requestId, timestamp, encodedDataLength } = msg.params;
          const req = requests.get(requestId);
          if (req) {
            const durationMs = ((timestamp - req.startTime) * 1000).toFixed(0);
            console.log(`✅ [RED COMPLETA] ${durationMs} ms | ${(encodedDataLength / 1024).toFixed(1)} KB | ${req.url.substring(0, 75)}`);
          }
        }

        if (msg.method === 'Page.loadEventFired') {
          console.log(`\n🏁 [LOAD EVENT MOTO G06] ¡Página completamente cargada en el Moto G06!`);
          send('Performance.getMetrics');
        }

        if (msg.result && msg.result.metrics) {
          console.log('\n📊 === RENDIMIENTO DE CPU Y RENDERIZADO EN MOTO G06 ===');
          msg.result.metrics.forEach(m => {
            if (['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(m.name)) {
              console.log(`   - ${m.name.padEnd(25)}: ${(m.value * 1000).toFixed(2)} ms`);
            }
          });
          console.log('=======================================================\n');
        }
      });
    });
  });
}

main().catch(err => console.error(err));
