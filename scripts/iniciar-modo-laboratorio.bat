@echo off
chcp 65001 >nul
title [ACTIVO - MODO LABORATORIO] Sistema Interno LAMDA (Cerrar esta ventana para apagar)
color 0E

cd /d "%~dp0.."

echo ============================================================================
echo   🟢 SISTEMA INTERNO LAMDA - MODO LABORATORIO ACTIVO (NOTEBOOK)
echo ============================================================================
echo   Carpeta : %CD%
echo   Base BD : etiquetas_pruebas (Aislada 100%% de Produccion)
echo   Modulos : Gestiones (3000), Produccion (3002), Presupuestos (3003),
echo             Facturacion (3004), Logistica (3005) y App Movil (/mobile)
echo   Estado  : MIENTRAS ESTA VENTANA ESTE ABIERTA, EL SISTEMA ESTA ENCENDIDO.
echo             SI CERRAS ESTA VENTANA (X), SE APAGAN TODOS LOS SERVICIOS.
echo ============================================================================
echo.

REM 1. Guardian de cierre automatico: si el usuario cierra esta ventana (X), mata automaticamente los puertos 3000..3005
powershell -NoProfile -Command "$parentPid = (Get-CimInstance Win32_Process -Filter \"ProcessId = $PID\").ParentProcessId; Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',\"Wait-Process -Id $parentPid -ErrorAction SilentlyContinue; foreach (`$p in @(3000,3002,3003,3004,3005)) { Get-NetTCPConnection -LocalPort `$p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id `$_.OwningProcess -Force -ErrorAction SilentlyContinue } }\""

REM 2. Lanzar navegador automaticamente en Gestiones (3000), Logistica (3005) y App Movil (3005/mobile) cuando levante
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 30; $i++) { Start-Sleep -Seconds 2; try { $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', 3000); if ($c.Connected) { $c.Close(); Start-Process 'http://localhost:3000'; Start-Process 'http://localhost:3005'; Start-Process 'http://localhost:3005/mobile'; exit } } catch {} }"

call npm run start:laboratorio

echo.
echo [INFO] Deteniendo servicios remanentes de LAMDA...
powershell -NoProfile -Command "foreach ($p in @(3000,3002,3003,3004,3005)) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"
pause
