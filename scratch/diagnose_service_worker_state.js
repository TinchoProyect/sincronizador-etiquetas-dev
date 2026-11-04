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
    res.on('end', () => {
      const pages = JSON.parse(raw);
      const target = pages.find(p => p.url.includes('proud-darkness')) || pages[0];
      
      console.log(`🔍 Diagnosticando Moto G06: ${target.url}`);
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      let id = 1;

      const send = (method, params = {}) => {
        return new Promise((resolve) => {
          const msgId = id++;
          const handler = (data) => {
            const msg = JSON.parse(data);
            if (msg.id === msgId) {
              ws.removeListener('message', handler);
              resolve(msg.result);
            }
          };
          ws.on('message', handler);
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      };

      ws.on('open', async () => {
        console.log('✅ Connected to Moto G06 tab.');
        
        // Habilitar logs de consola
        send('Console.enable');
        send('Runtime.enable');

        ws.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.method === 'Console.messageAdded' || msg.method === 'Runtime.consoleAPICalled') {
            const text = msg.params.message ? msg.params.message.text : (msg.params.args ? msg.params.args.map(a => a.value || a.description).join(' ') : '');
            console.log(`💬 [CONSOLA MOTO G06] ${text}`);
          }
        });

        // Test ServiceWorker Registrations via ServiceWorker domain
        const swRegs = await send('ServiceWorker.enable');
        
        // Evaluate simple expression
        const evalRes = await send('Runtime.evaluate', {
          expression: `JSON.stringify({
            hasSW: 'serviceWorker' in navigator,
            controller: !!navigator.serviceWorker.controller,
            online: navigator.onLine,
            url: location.href
          })`
        });

        console.log('📊 Evaluación JS Estado Browser:\n', evalRes.result ? evalRes.result.value : evalRes);
      });
    });
  });
}

main().catch(err => console.error(err));
