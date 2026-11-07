@echo off
chcp 65001 >nul
echo ==================================================================
echo 🔒 ACTIVANDO CANDADOS AUTOMATICOS DE GIT (.githooks) - LAMDA
echo ==================================================================
cd /d "%~dp0.."
git config core.hooksPath .githooks
node "%~dp0activarGitHooks.js"
echo.
echo ✅ Candados pre-commit y pre-push activos.
pause
