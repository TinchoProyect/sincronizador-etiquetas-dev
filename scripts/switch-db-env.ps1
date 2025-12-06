# Script para cambiar entre entornos de base de datos
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("produccion", "test")]
    [string]$Entorno
)

$rootPath = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  CAMBIO DE ENTORNO DE BASE DE DATOS" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($Entorno -eq "produccion") {
    # Restaurar .env original
    if (Test-Path "$rootPath\.env.backup") {
        Copy-Item "$rootPath\.env.backup" "$rootPath\.env" -Force
        Write-Host "✅ Restaurado .env original (Producción)" -ForegroundColor Green
    } else {
        Write-Host "⚠️  No se encontró backup, usando .env actual" -ForegroundColor Yellow
    }
    Write-Host "📦 Base de datos: etiquetas" -ForegroundColor Yellow
    Write-Host "🌍 Entorno: PRODUCCIÓN" -ForegroundColor Yellow
} else {
    # Backup del .env actual
    Copy-Item "$rootPath\.env" "$rootPath\.env.backup" -Force
    Write-Host "💾 Backup creado: .env.backup" -ForegroundColor Gray
    
    # Copiar .env.test a .env
    Copy-Item "$rootPath\.env.test" "$rootPath\.env" -Force
    Write-Host "✅ Activado .env.test (Pruebas)" -ForegroundColor Green
    Write-Host "🧪 Base de datos: etiquetas_pruebas" -ForegroundColor Yellow
    Write-Host "🌍 Entorno: TEST" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "⚠️  IMPORTANTE: Reinicia los servidores para aplicar los cambios" -ForegroundColor Red
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  COMANDOS DISPONIBLES" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  npm run db:check         - Verificar BD actual" -ForegroundColor White
Write-Host "  npm run start:local      - Iniciar en modo actual" -ForegroundColor White
Write-Host "  npm run start:test:all   - Iniciar en modo TEST" -ForegroundColor White
Write-Host ""
Write-Host "  Scripts de sincronización en TEST:" -ForegroundColor Gray
Write-Host "  npm run sync:articulos:test  - Sincronizar artículos (⚠️ DESTRUCTIVO)" -ForegroundColor White
Write-Host "  npm run sync:clientes:test   - Sincronizar clientes" -ForegroundColor White
Write-Host "  npm run sync:precios:test    - Sincronizar precios (⚠️ DESTRUCTIVO)" -ForegroundColor White
Write-Host ""
