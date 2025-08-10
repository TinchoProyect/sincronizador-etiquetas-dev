@echo off
setlocal

REM Ir a la carpeta donde está este .bat (src\actualizaArticulos)
pushd "%~dp0"

echo Sincronizando articulos...
node syncEtiquetas.js

echo.
echo Sincronizando clientes...
node ..\actualizaClientes\syncClientes.js

popd
endlocal
pause
