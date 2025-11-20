$file = "src/produccion/pages/produccion.html"
$content = Get-Content $file -Raw -Encoding UTF8

# Buscar y reemplazar el tag mal formado
$oldTag = '<script src=" /js/modal-pack-debug.js?v=9.0\></script></body'
$newTag = '<script src="/js/modal-pack-debug.js?v=9.0"></script>
</body>'

if ($content -match [regex]::Escape($oldTag)) {
    Write-Host "Tag encontrado, reemplazando..." -ForegroundColor Green
    $content = $content -replace [regex]::Escape($oldTag), $newTag
    $content | Set-Content $file -Encoding UTF8 -NoNewline
    Write-Host "Archivo corregido exitosamente" -ForegroundColor Green
} else {
    Write-Host "Tag no encontrado, buscando variantes..." -ForegroundColor Yellow
    
    # Mostrar lo que hay actualmente
    $lines = Get-Content $file | Select-String -Pattern "modal-pack-debug" -Context 0,1
    Write-Host "Contenido actual:" -ForegroundColor Cyan
    $lines | ForEach-Object { Write-Host $_.Line }
}
