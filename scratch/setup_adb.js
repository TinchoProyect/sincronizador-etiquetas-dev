const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function setupAdb() {
  const toolsDir = path.join(__dirname, 'platform-tools');
  const adbPath = path.join(toolsDir, 'adb.exe');

  if (!fs.existsSync(adbPath)) {
    console.log('📥 Descargando Android Platform-Tools oficial desde Google...');
    const zipPath = path.join(__dirname, 'platform-tools.zip');
    
    // Descargar zip oficial de Google
    const downloadCmd = `powershell -Command "Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile '${zipPath}'"`;
    execSync(downloadCmd, { stdio: 'inherit' });

    console.log('📦 Extrayendo platform-tools...');
    const extractCmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${__dirname}' -Force"`;
    execSync(extractCmd, { stdio: 'inherit' });

    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  }

  console.log('🔌 Verificando conexión ADB con el celular Samsung S22 Ultra...');
  const res = execSync(`"${adbPath}" devices`, { encoding: 'utf8' });
  console.log('📋 Resultado ADB devices:\n' + res);

  return adbPath;
}

setupAdb().catch(err => console.error('❌ Error:', err.message));
