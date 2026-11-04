const { spawn } = require('child_process');
const path = require('path');

// Port killing helper to make sure port 3005 is free
function killPort3005() {
  return new Promise((resolve) => {
    console.log('🧹 Clearing port 3005 before starting test...');
    const kp = spawn('npx', ['kill-port', '3005'], { shell: true });
    kp.on('exit', () => {
      setTimeout(resolve, 1000);
    });
  });
}

async function run() {
  await killPort3005();

  console.log('🚀 Spawning logistics server...');
  const serverPath = path.join(__dirname, '..', 'src', 'logistica', 'app.js');
  const server = spawn('node', [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT_LOGISTICA: '3005' }
  });

  let serverOutput = '';

  server.stdout.on('data', (data) => {
    const chunk = data.toString();
    serverOutput += chunk;
    console.log(`[SERVER STDOUT] ${chunk.trim()}`);
  });

  server.stderr.on('data', (data) => {
    const chunk = data.toString();
    serverOutput += chunk;
    console.error(`[SERVER STDERR] ${chunk.trim()}`);
  });

  // Wait 3 seconds for server to start
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n📡 Sending invitation POST request to local server...');
  try {
    const response = await fetch('http://localhost:3005/api/logistica/b2b-onboarding/invitar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cliente_id: 'CB-0002',
        canal: 'whatsapp',
        destino: '2216615746',
        mensajeTexto: 'Hola Nico, te paso el link del portal. Código de activación: [Codigo_Activacion]. Entrá acá: [Enlace_Al_Portal]'
      })
    });

    console.log(`Response Status: ${response.status} ${response.statusText}`);
    const resJson = await response.json();
    console.log('Response JSON:', JSON.stringify(resJson, null, 2));

  } catch (err) {
    console.error('❌ Request failed:', err.message);
  }

  // Wait 3 seconds to capture any async logging
  console.log('\n⏳ Waiting for any async logs...');
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n🛑 Stopping server...');
  server.kill('SIGINT');

  console.log('\n=========================================');
  console.log('📋 SUMMARY OF SERVER OUTPUT CAPTURED:');
  console.log('=========================================');
  console.log(serverOutput);
  console.log('=========================================');
  
  process.exit(0);
}

run();
