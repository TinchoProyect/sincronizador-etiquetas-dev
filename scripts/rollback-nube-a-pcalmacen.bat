@echo off
chcp 65001 >nul
title LAMDA - Rollback de Emergencia Nube a PcAlmacen (< 3 min)
echo ============================================================================
echo   SISTEMA LAMDA - PROTOCOLO DE ROLLBACK DE EMERGENCIA (NUBE -> PCALMACEN)
echo ============================================================================
echo.

cd /d "%~dp0.."

echo [1/6] Deteniendo Agente Puente y liberando puertos locales (3000..3005, 3099)...
powershell -ExecutionPolicy Bypass -File "scripts\limpiar-puertos.ps1" >nul 2>&1

echo [2/6] Levantando candado SQL Read-Only sobre base local `etiquetas`...
set PGPASSWORD=postgres
if exist "C:\Program Files\PostgreSQL\17\bin\psql.exe" (
    set PSQL_BIN="C:\Program Files\PostgreSQL\17\bin\psql.exe"
) else if exist "C:\Program Files\PostgreSQL\16\bin\psql.exe" (
    set PSQL_BIN="C:\Program Files\PostgreSQL\16\bin\psql.exe"
) else (
    set PSQL_BIN=psql
)
%PSQL_BIN% -h localhost -U postgres -d postgres -c "ALTER DATABASE etiquetas SET default_transaction_read_only = off;"

echo [3/6] Verificando ultimo espejo descargado de la nube (`backups\espejo_nube\etiquetas_nube_latest.sql`)...
if exist "backups\espejo_nube\etiquetas_nube_latest.sql" (
    echo       Restaurando ultimo espejo de la nube sobre `etiquetas`...
    %PSQL_BIN% -h localhost -U postgres -d etiquetas -f "backups\espejo_nube\etiquetas_nube_latest.sql" >nul
    echo       Base `etiquetas` actualizada con el ultimo estado de la nube.
) else (
    echo       [AVISO] No se encontro `etiquetas_nube_latest.sql`; se conserva el estado actual de `etiquetas`.
)

echo [4/6] Reconstruyendo Ticket de Acceso vigente de ARCA/AFIP desde `public.factura_afip_ta`...
node -e "require('./src/facturacion/services/wsfeService').sincronizarTADesdeBDHaciaDisco('wsfe').then(r => { console.log('      TA AFIP:', JSON.stringify(r)); process.exit(0); }).catch(e => { console.warn(e.message); process.exit(0); });"

echo [5/6] Desactivando candado GALPON_BRIDGE_ONLY y restaurando rol LOCAL_PRIMARY...
powershell -NoProfile -Command "$envPath = '.env'; if (Test-Path $envPath) { $c = Get-Content $envPath -Raw; $c = $c -replace 'LAMDA_ROLE=GALPON_BRIDGE_ONLY','LAMDA_ROLE=LOCAL_PRIMARY'; $c = $c -replace 'LAMDA_CLOUD_MODE=true','LAMDA_CLOUD_MODE=false'; $c = $c -replace 'WHATSAPP_STANDBY_PASIVO=true','WHATSAPP_STANDBY_PASIVO=false'; Set-Content $envPath $c -Encoding UTF8 }"

echo [6/6] Iniciando los 5 servicios locales + Tunel Cloudflare en PcAlmacen...
echo ============================================================================
echo   ROLLBACK COMPLETADO - PCALMACEN OPERANDO NUEVAMENTE COMO TITULAR
echo ============================================================================
npm start
