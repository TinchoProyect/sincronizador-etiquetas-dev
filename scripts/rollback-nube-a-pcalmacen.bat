@echo off
chcp 65001 >nul
title LAMDA - Rollback de Emergencia Nube a PcAlmacen (< 3 min)
echo ============================================================================
echo   SISTEMA LAMDA - PROTOCOLO DE ROLLBACK DE EMERGENCIA (NUBE -> PCALMACEN)
echo ============================================================================
echo.

cd /d "%~dp0.."

echo [1/3] Deteniendo Agente Puente y liberando puertos locales (3000..3005, 3099)...
powershell -ExecutionPolicy Bypass -File "scripts\limpiar-puertos.ps1" >nul 2>&1

echo [2/3] Ejecutando orquestador de Rollback (freno VPS + ultimo snapshot o backup local + cierre de conexiones PG + restauracion + TA ARCA + limpieza .env)...
node "scripts\ejecutarRollbackNubeAPcAlmacen.js"

echo [3/3] Iniciando los 5 servicios locales + Tunel Cloudflare en PcAlmacen...
echo ============================================================================
echo   ROLLBACK COMPLETADO - PCALMACEN OPERANDO NUEVAMENTE COMO TITULAR
echo ============================================================================
npm start
