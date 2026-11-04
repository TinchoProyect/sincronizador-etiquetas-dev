const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
  const adbPath = path.join(__dirname, 'platform-tools', 'adb.exe');
  execSync(`"${adbPath}" forward tcp:9222 localabstract:chrome_devtools_remote`);

  http.get('http://localhost:9222/json', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', async () => {
      const pages = JSON.parse(raw);
      if (!pages.length) {
        console.log('❌ No hay pestañas abiertas en Chrome.');
        return;
      }

      // Elegir la primera página o la que coincida con el portal
      let target = pages.find(p => p.url.includes('proud-darkness') || p.url.includes('workers.dev')) || pages[0];
      console.log(`🎯 Conectando Inspector DevTools a: ${target.title || target.url || 'Pestaña activa'} (${target.webSocketDebuggerUrl})`);

      const ws = new WebSocket(target.webSocketDebuggerUrl);

      let id = 1;
      const send = (method, params = {}) => {
        const msgId = id++;
        ws.send(JSON.stringify({ id: msgId, method, params }));
        return msgId;
      };

      const requests = new Map();
      const metrics = {};

      ws.on('open', () => {
        console.log('✅ Conexión WebSocket con Chrome Mobile ESTABLECIDA.');
        console.log('⏳ Habilitando dominios Network, Page, Performance y PerformanceTimeline...');

        send('Network.enable');
        send('Page.enable');
        send('Performance.enable');

        console.log('\n=============================================================');
        console.log('📱 INSTRUCCIONES PARA LA PRUEBA EN VIVO:');
        console.log('👉 En tu celular S22 Ultra, tocá el botón RECARGAR en Chrome o abrí el icono del Portal B2B.');
        console.log('=============================================================\n');
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data);

        // Network events
        if (msg.method === 'Network.requestWillBeSent') {
          const { requestId, request, timestamp } = msg.params;
          requests.set(requestId, {
            url: request.url,
            method: request.method,
            startTime: timestamp,
            type: msg.params.type
          });
          console.log(`🌐 [RED] Iniciando solicitud: ${request.url.substring(0, 90)}...`);
        }

        if (msg.method === 'Network.responseReceived') {
          const { requestId, response, timestamp } = msg.params;
          const req = requests.get(requestId);
          if (req) {
            req.responseTime = timestamp;
            req.status = response.status;
            req.mimeType = response.mimeType;
            req.timing = response.timing;
          }
        }

        if (msg.method === 'Network.loadingFinished') {
          const { requestId, timestamp, encodedDataLength } = msg.params;
          const req = requests.get(requestId);
          if (req) {
            const durationMs = ((timestamp - req.startTime) * 1000).toFixed(0);
            console.log(`✅ [RED COMPLETA] ${req.status || 200} | ${durationMs}ms | ${(encodedDataLength / 1024).toFixed(1)} KB | ${req.url.substring(0, 80)}`);
          }
        }

        if (msg.method === 'Page.loadEventFired') {
          console.log(`\n🏁 [EVENTO LOAD] ¡Página completamente cargada en el celular! (Timestamp: ${msg.params.timestamp})`);
          
          // Solicitar métricas de rendimiento detalladas
          send('Performance.getMetrics');
        }

        if (msg.result && msg.result.metrics) {
          console.log('\n📊 === REPORTE METRICAS DE RENDIMIENTO DE CPU Y RENDERIZADO ===');
          msg.result.metrics.forEach(m => {
            if (['Timestamp', 'Documents', 'Frames', 'JSEventListeners', 'JSHeapUsedSize', 'TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(m.name)) {
              let val = m.value;
              if (m.name.includes('Duration')) val = (val * 1000).toFixed(2) + ' ms';
              if (m.name.includes('Size')) val = (val / (1024 * 1024)).toFixed(2) + ' MB';
              console.log(`   - ${m.name.padEnd(25)}: ${val}`);
            }
          });
          console.log('=================================================================\n');
        }
      });
    });
  });
}

main().catch(err => console.error(err));
