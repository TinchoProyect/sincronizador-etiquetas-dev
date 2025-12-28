# Script para aplicar el fix al archivo ingredientes.js
$ErrorActionPreference = "Stop"

Write-Host "🔧 Aplicando fix a ingredientes.js..." -ForegroundColor Cyan

$filePath = "src/produccion/js/ingredientes.js"
$content = Get-Content $filePath -Raw -Encoding UTF8

# Función a reemplazar (patrón regex)
$oldPattern = @'
window\.abrirModalAjusteDesdeTabla = async function\(ingredienteId, nombreIngrediente, stockActual\) \{[\s\S]*?console\.log\('.*?Solicitando ajuste para:', nombreIngrediente\);[\s\S]*?\};
'@

# Nueva función
$newFunction = @'
window.abrirModalAjusteDesdeTabla = async function(ingredienteId, nombreIngrediente, stockActual) {
    console.log('✏️ [AJUSTE-JS] Solicitando ajuste para:', nombreIngrediente);
    console.log('📊 [AJUSTE-JS] Vista actual:', vistaActual);
    
    let usuarioId = null;
    
    if (vistaActual.startsWith('usuario-')) {
        usuarioId = parseInt(vistaActual.replace('usuario-', ''));
        console.log('👤 [AJUSTE-JS] Usuario detectado desde vistaActual:', usuarioId);
    } else {
        const sectorActivo = document.querySelector('.sector-item.activo[data-usuario-id]');
        if (sectorActivo) {
            usuarioId = parseInt(sectorActivo.dataset.usuarioId);
            console.log('👤 [AJUSTE-JS] Usuario detectado desde DOM:', usuarioId);
        }
    }
    
    if (!usuarioId) {
        alert('⚠️ Error: No se pudo detectar el usuario activo.');
        return;
    }

    let selectorFiltro = document.getElementById('filtro-usuario');
    if (!selectorFiltro) {
        selectorFiltro = document.createElement('select');
        selectorFiltro.id = 'filtro-usuario';
        selectorFiltro.style.display = 'none';
        document.body.appendChild(selectorFiltro);
        console.log('✅ [AJUSTE-JS] Selector filtro-usuario creado');
    }
    selectorFiltro.value = usuarioId;

    if (typeof window.abrirModalAjusteRapido === 'function') {
        console.log('🚀 [AJUSTE-JS] Llamando a abrirModalAjusteRapido...');
        window.abrirModalAjusteRapido(ingredienteId, nombreIngrediente, stockActual, null);
        
        const actualizarOriginal = window.actualizarResumenIngredientes;
        window.actualizarResumenIngredientes = async function() {
            console.log('🔄 [AJUSTE-JS] Recargando tabla después del ajuste...');
            await cargarIngredientes(usuarioId);
            window.actualizarResumenIngredientes = actualizarOriginal;
        };
    } else {
        console.error('❌ window.abrirModalAjusteRapido no está definida.');
        alert('Error: El módulo de ajustes no está cargado correctamente. Recarga la página con Ctrl+F5.');
    }
};
'@

# Aplicar reemplazo
if ($content -match $oldPattern) {
    $content = $content -replace $oldPattern, $newFunction
    Set-Content $filePath -Value $content -Encoding UTF8 -NoNewline
    Write-Host "✅ Fix aplicado exitosamente!" -ForegroundColor Green
} else {
    Write-Host "⚠️ No se encontró el patrón exacto. Intentando método alternativo..." -ForegroundColor Yellow
    
    # Buscar la última ocurrencia de la función
    $lines = Get-Content $filePath -Encoding UTF8
    $startIndex = -1
    $endIndex = -1
    $braceCount = 0
    $inFunction = $false
    
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match 'window\.abrirModalAjusteDesdeTabla\s*=\s*async\s*function') {
            $startIndex = $i
            $inFunction = $true
            $braceCount = 0
        }
        
        if ($inFunction) {
            $braceCount += ($lines[$i] -split '\{').Count - 1
            $braceCount -= ($lines[$i] -split '\}').Count - 1
            
            if ($braceCount -eq 0 -and $lines[$i] -match '\};') {
                $endIndex = $i
                break
            }
        }
    }
    
    if ($startIndex -ge 0 -and $endIndex -ge 0) {
        $newLines = $lines[0..($startIndex-1)] + $newFunction.Split("`n") + $lines[($endIndex+1)..($lines.Count-1)]
        Set-Content $filePath -Value $newLines -Encoding UTF8
        Write-Host "✅ Fix aplicado con método alternativo!" -ForegroundColor Green
    } else {
        Write-Host "❌ No se pudo aplicar el fix automáticamente." -ForegroundColor Red
        Write-Host "Por favor, aplica el fix manualmente usando ingredientes-fix.txt" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "`n✨ Proceso completado. Reinicia el servidor con: npm start" -ForegroundColor Cyan
