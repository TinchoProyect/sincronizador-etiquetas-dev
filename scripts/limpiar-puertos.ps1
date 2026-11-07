# Script de limpieza de puertos para Windows
# Sistema LAMDA - Sincronizador de Etiquetas

$puertos = @(3000, 3002, 3003, 3004, 3005)

foreach ($puerto in $puertos) {
    try {
        $conexiones = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue
        if ($conexiones) {
            foreach ($conexion in $conexiones) {
                $procesoId = $conexion.OwningProcess
                if ($procesoId -and $procesoId -gt 4) {
                    try {
                        $wmiProc = Get-CimInstance Win32_Process -Filter "ProcessId = $procesoId" -ErrorAction SilentlyContinue
                        if ($wmiProc -and ($wmiProc.CommandLine -like "*lamdaSwitchGuiServer.js*")) {
                            continue
                        }
                        Stop-Process -Id $procesoId -Force -ErrorAction SilentlyContinue
                    } catch {}
                }
            }
        }
    } catch {}
}

$puppeteerChromium = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like "*\.cache\puppeteer\*" -or $_.CommandLine -like "*\.cache\puppeteer\*" -or $_.CommandLine -like "*session-lamda-billing*"
}
if ($puppeteerChromium) {
    foreach ($proc in $puppeteerChromium) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Milliseconds 300
