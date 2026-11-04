const path = require('path');
const { execSync } = require('child_process');

function launchChrome() {
  const adbPath = path.join(__dirname, 'platform-tools', 'adb.exe');
  console.log('🚀 Abriendo Chrome con el Portal B2B en el Moto G06...');
  
  try {
    execSync(`"${adbPath}" shell am start -n com.android.chrome/com.google.android.apps.chrome.Main -d "https://proud-darkness-ac3d.miserrano75.workers.dev"`);
    console.log('✅ Chrome abierto en el Moto G06.');
  } catch (err) {
    console.error('Error abriendo Chrome por intent:', err.message);
  }
}

launchChrome();
