# Script para reiniciar el servidor de producción limpiamente
Write-Host "🔄 Reiniciando servidor de producción..." -ForegroundColor Cyan

# 1. Matar procesos de Node en puerto 3002
Write-Host "1️⃣ Deteniendo procesos en puerto 3002..." -ForegroundColor Yellow
$processes = Get-NetTCPConnection -LocalPort 3002 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($proc in $processes) {
    Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
    Write-Host "   ✅ Proceso $proc detenido" -ForegroundColor Green
}

Start-Sleep -Seconds 2

# 2. Limpiar caché de Node
Write-Host "2️⃣ Limpiando caché de Node..." -ForegroundColor Yellow
if (Test-Path "node_modules/.cache") {
    Remove-Item "node_modules/.cache" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "   ✅ Caché limpiado" -ForegroundColor Green
}

# 3. Iniciar servidor
Write-Host "3️⃣ Iniciando servidor de producción..." -ForegroundColor Yellow
Set-Location "src/produccion"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node app.js"

Write-Host ""
Write-Host "✅ Servidor reiniciado!" -ForegroundColor Green
Write-Host "📍 URL: http://localhost:3002/pages/produccion.html" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚠️  IMPORTANTE:" -ForegroundColor Yellow
Write-Host "   1. Cierra COMPLETAMENTE el navegador (no solo la pestaña)" -ForegroundColor White
Write-Host "   2. Abre el navegador nuevamente" -ForegroundColor White
Write-Host "   3. Ve a: http://localhost:3002/pages/produccion.html" -ForegroundColor White
Write-Host "   4. Abre la consola (F12)" -ForegroundColor White
Write-Host "   5. Haz clic en 'Editar Pack'" -ForegroundColor White
Write-Host "   6. Verifica que aparezcan logs [MODAL-PACK]" -ForegroundColor White
Write-Host ""
