@echo off
chcp 65001 >nul
title [GIT DESARROLLO] Sincronizar Avances Notebook ^<^> Deposito
color 0A

cd /d "%~dp0.."

echo ============================================================================
echo   ☁️  SINCRONIZADOR GIT - RAMA 'desarrollo' (Notebook ^<^> PcAlmacen)
echo ============================================================================
git status -sb
echo ============================================================================
echo.
echo   [1] BAJAR ultimos cambios desde GitHub (git pull origin desarrollo)
echo   [2] SUBIR mis avances de la Notebook a GitHub (commit + push origin desarrollo)
echo   [3] Salir
echo.
set /p OPCION="Seleccione una opcion (1/2/3): "

if "%OPCION%"=="1" (
    echo.
    git pull origin desarrollo
    echo.
    pause
    exit /b 0
)
if "%OPCION%"=="2" (
    echo.
    set /p MSG="Escribi un breve resumen del avance (Enter para 'Avances desde Notebook'): "
    if "%MSG%"=="" set MSG=Avances desde Notebook
    git add .
    git commit -m "%MSG%"
    git push origin desarrollo
    echo.
    pause
    exit /b 0
)
exit /b 0
