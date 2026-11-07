#!/usr/bin/env node
/**
 * Lanzador Inteligente de LAMDA (`Iniciar Sistema LAMDA`)
 * -------------------------------------------------------
 * Abre de forma inmediata (< 0.5s) la ventana maximizada de arranque visual
 * (`http://127.0.0.1:3098/launcher`), la cual muestra barra de progreso en vivo (0% -> 100%),
 * detecta si el Switch está en `L · Local` o `N · Nube`, libera y levanta los 5 servicios
 * locales (3000..3005) si corresponde, y redirige automáticamente a la Pantalla Principal
 * recién cuando el servicio está 100% verificado.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

function checkPort(port, urlPath = '/') {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}${urlPath}`, { timeout: 1500 }, (res) => {
            res.resume();
            resolve(res.statusCode >= 200 && res.statusCode < 500);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

function runHiddenPsEncoded(psScript, timeoutMs = 8000) {
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    return execSync(
        `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
        { stdio: 'ignore', windowsHide: true, timeout: timeoutMs }
    );
}

function asegurarServidorGuiSwitchEnBackground() {
    const nodeExe = process.execPath || 'C:\\Program Files\\nodejs\\node.exe';
    const fullGui = path.join(ROOT_DIR, 'scripts', 'lamdaSwitchGuiServer.js');
    const ps = `
$si = New-CimInstance -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 } -ClientOnly
$cmd = '"' + '${nodeExe.replace(/'/g, "''")}' + '" "' + '${fullGui.replace(/'/g, "''")}' + '"'
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = '${ROOT_DIR.replace(/'/g, "''")}'
    ProcessStartupInformation = $si
} | Out-Null
`;
    try {
        runHiddenPsEncoded(ps, 8000);
    } catch (_) {}
}

function abrirVentanaProgramaMaximizada(targetUrl) {
    const chromeCandidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const browserBin = chromeCandidates.find(p => fs.existsSync(p));
    if (browserBin) {
        const ps = `Start-Process -FilePath '${browserBin.replace(/'/g, "''")}' -ArgumentList '--app=${targetUrl}','--start-maximized'`;
        runHiddenPsEncoded(ps, 6000);
    } else {
        execSync(`cmd.exe /c start "" "${targetUrl}"`, { stdio: 'ignore', windowsHide: true });
    }
}

async function main() {
    let guiAlive = await checkPort(3098, '/');
    if (!guiAlive) {
        asegurarServidorGuiSwitchEnBackground();
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 250));
            guiAlive = await checkPort(3098, '/');
            if (guiAlive) break;
        }
    }

    // Abrir en el acto (< 0.5s) la pantalla visual de arranque con barra de progreso 0% -> 100%
    abrirVentanaProgramaMaximizada('http://127.0.0.1:3098/launcher');
    process.exit(0);
}

main().catch(() => process.exit(0));
