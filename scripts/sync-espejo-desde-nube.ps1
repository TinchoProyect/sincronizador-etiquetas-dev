# ==============================================================================
# LAMDA Cloud 24/7 — Script de Sincronización de Espejo Local (Cada 15 Minutos)
# Ubicación: scripts/sync-espejo-desde-nube.ps1
# ==============================================================================
# Invoca el motor NodeJS de espejo (`scripts/syncEspejoDesdeNube.js`) que:
#  1. Descarga el backup de PostgreSQL de la Nube hacia `backups/espejo_nube/`
#     y lo restaura en la base standby `etiquetas_espejo_nube`.
#  2. Reconstruye en disco `src/facturacion/certs/TA-*.json` desde `public.factura_afip_ta`.
#  3. Sincroniza las 6 carpetas de activos físicos (`uploads`, `pdfs`, `certs`,
#     `documentos`, `gsheets`, `data/ia_credit_ledger.json`).
#  4. Mantiene el candado `default_transaction_read_only = on` sobre `etiquetas`
#     mientras `LAMDA_ROLE=GALPON_BRIDGE_ONLY`.
# ==============================================================================

$ErrorActionPreference = "Continue"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host "[ESPEJO-15M] Iniciando ciclo de sincronizacion Nube -> PcAlmacen..." -ForegroundColor Cyan
node "$RepoRoot\scripts\syncEspejoDesdeNube.js"
if ($LASTEXITCODE -eq 0) {
    Write-Host "[ESPEJO-15M] Espejo actualizado correctamente." -ForegroundColor Green
} else {
    Write-Host "[ESPEJO-15M] Advertencia: El ciclo de espejo reporto codigo $LASTEXITCODE." -ForegroundColor Yellow
}
