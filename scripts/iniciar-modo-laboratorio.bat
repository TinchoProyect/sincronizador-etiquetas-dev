@echo off
chcp 65001 >nul
title [MODO LABORATORIO] Sistema Interno LAMDA - Rama Desarrollo (BD: etiquetas_pruebas)
color 0E

cd /d "%~dp0.."

echo ============================================================================
echo   🛠️  SISTEMA INTERNO LAMDA - MODO LABORATORIO / PRUEBAS (NOTEBOOK)
echo ============================================================================
echo   Carpeta : %CD%
echo   Base BD : etiquetas_pruebas (Aislada 100%% de Produccion)
echo   Modulos : Gestiones (3000), Produccion (3002), Presupuestos (3003),
echo             Facturacion (3004) y Logistica/Bunker (3005)
echo   Candados: Supabase B2B DESCONECTADO ^| WhatsApp Espejo ^| ARCA HOMO ^| Zebra Simulada
echo ============================================================================
echo.

REM Lanzar navegador automaticamente en Gestiones (3000) y Logistica (3005) cuando respondan
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 30; $i++) { Start-Sleep -Seconds 2; try { $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', 3000); if ($c.Connected) { $c.Close(); Start-Process 'http://localhost:3000'; Start-Process 'http://localhost:3005'; exit } } catch {} }"

call npm run start:laboratorio
pause
