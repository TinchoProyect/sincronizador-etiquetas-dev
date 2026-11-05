@echo off
chcp 65001 >nul
title Apagar Sistema LAMDA (Modo Laboratorio)
color 0A

cd /d "%~dp0.."

echo ============================================================================
echo   🛑 APAGANDO SISTEMA INTERNO LAMDA (MODO LABORATORIO)
echo ============================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$puertos = @( " ^
  "  @{ Port = 3000; Name = 'Gestiones / Etiquetas' }, " ^
  "  @{ Port = 3002; Name = 'Produccion' }, " ^
  "  @{ Port = 3003; Name = 'Presupuestos' }, " ^
  "  @{ Port = 3004; Name = 'Facturacion' }, " ^
  "  @{ Port = 3005; Name = 'Logistica y App Movil' } " ^
  "); " ^
  "foreach ($item in $puertos) { " ^
  "  $conns = Get-NetTCPConnection -LocalPort $item.Port -State Listen -ErrorAction SilentlyContinue; " ^
  "  if ($conns) { " ^
  "    foreach ($c in $conns) { " ^
  "      if ($c.OwningProcess -gt 0) { " ^
  "        Write-Host ('  -> Deteniendo servicio en puerto ' + $item.Port + ' (' + $item.Name + ', PID: ' + $c.OwningProcess + ')...') -ForegroundColor Yellow; " ^
  "        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue; " ^
  "      } " ^
  "    } " ^
  "  } " ^
  "} " ^
  "Get-Process cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*MODO LABORATORIO*' } | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }; " ^
  "Start-Sleep -Seconds 1; " ^
  "Write-Host ''; " ^
  "Write-Host '  VERIFICACION FINAL DE PUERTOS EN LA NOTEBOOK:' -ForegroundColor Cyan; " ^
  "Write-Host '  ------------------------------------------------------------' -ForegroundColor DarkGray; " ^
  "$todoLibre = $true; " ^
  "foreach ($item in $puertos) { " ^
  "  $check = Get-NetTCPConnection -LocalPort $item.Port -State Listen -ErrorAction SilentlyContinue; " ^
  "  if ($check) { " ^
  "    Write-Host ('  [ACTIVO]  Puerto ' + $item.Port + ' (' + $item.Name + ') sigue ocupado') -ForegroundColor Red; " ^
  "    $todoLibre = $false; " ^
  "  } else { " ^
  "    Write-Host ('  [APAGADO] Puerto ' + $item.Port + ' (' + $item.Name.PadRight(22) + ') -> LIBRE (0 procesos)') -ForegroundColor Green; " ^
  "  } " ^
  "} " ^
  "Write-Host '  ------------------------------------------------------------' -ForegroundColor DarkGray; " ^
  "Write-Host ''; " ^
  "if ($todoLibre) { " ^
  "  Write-Host '  ✅ CONFIRMADO: No quedo ningun servicio de LAMDA corriendo en segundo plano.' -ForegroundColor Green; " ^
  "  Write-Host '     Tu Notebook esta 100% libre para usar en otros proyectos.' -ForegroundColor Green; " ^
  "} "

echo.
echo ============================================================================
pause
