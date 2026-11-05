@echo off
chcp 65001 >nul
title [RESTAURAR BD PRUEBAS] Sistema LAMDA - etiquetas_pruebas
color 0B

cd /d "%~dp0.."

echo ============================================================================
echo   🔄 ACTUALIZAR / RESTAURAR BASE DE DATOS DE PRUEBA (etiquetas_pruebas)
echo ============================================================================
echo   Esta herramienta solo opera sobre la base local 'etiquetas_pruebas'.
echo   Ninguna otra base de tu PostgreSQL local (como 'mibase') sera tocada.
echo ============================================================================
echo.
echo   [1] Restaurar desde el Snapshot Local incluido (backups/etiquetas_snapshot_fase1.backup)
echo   [2] Clonar datos frescos desde la Nube (si CLOUD_DB_URL esta configurado en .env)
echo   [3] Cancelar y salir
echo.
set /p OPCION="Seleccione una opcion (1/2/3): "

if "%OPCION%"=="1" (
    echo.
    call npm run db:restaurar-pruebas
    echo.
    pause
    exit /b 0
)
if "%OPCION%"=="2" (
    echo.
    call npm run db:clonar-desde-nube
    echo.
    pause
    exit /b 0
)
exit /b 0
