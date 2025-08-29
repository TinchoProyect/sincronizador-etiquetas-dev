@echo off
setlocal

REM Ir a la carpeta donde está este .bat (src\actualizaArticulos)
pushd "%~dp0"

echo Sincronizando articulos...
node syncEtiquetas.js

echo.
echo Sincronizando clientes...
node ..\actualizaClientes\syncClientes.js

echo.
echo Sincronizando precios...
set "LOMASOFT_ARTICULOS_URL=https://api.lamdaser.com/precios"
REM Si tu endpoint real es /api/precios, usar:
REM set "LOMASOFT_ARTICULOS_URL=https://api.lamdaser.com/api/precios"
node ..\actualizaPrecios\syncPrecios.js

popd
endlocal
pause
