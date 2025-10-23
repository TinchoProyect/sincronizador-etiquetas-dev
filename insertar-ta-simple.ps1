# Script simple para insertar TA en la base de datos
# Requiere que las variables $token, $sign, $exp estén cargadas

Write-Host "🔄 Insertando TA en la base de datos..." -ForegroundColor Cyan

# Verificar variables
if (-not $token -or -not $sign -or -not $exp) {
    Write-Host "❌ ERROR: Faltan variables. Ejecuta primero el script de obtención de TA" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Variables encontradas" -ForegroundColor Green
Write-Host ""

# Configuración
$dbHost = "localhost"
$dbPort = "5432"
$dbName = "etiquetas"
$dbUser = "postgres"
$dbPassword = "ta3Mionga"

# Crear archivo SQL temporal
$sqlFile = "$env:TEMP\insert_ta_$(Get-Random).sql"

# Escribir SQL (escapando comillas simples en los valores)
$tokenEscaped = $token -replace "'", "''"
$signEscaped = $sign -replace "'", "''"

$sql = @"
INSERT INTO factura_afip_ta (entorno, servicio, token, sign, expira_en, creado_en)
VALUES ('HOMO', 'wsfe', '$tokenEscaped', '$signEscaped', '$exp', NOW())
ON CONFLICT (entorno, servicio)
DO UPDATE SET
    token = EXCLUDED.token,
    sign = EXCLUDED.sign,
    expira_en = EXCLUDED.expira_en,
    creado_en = NOW();

SELECT 
    'TA insertado exitosamente' as mensaje,
    entorno,
    servicio,
    expira_en,
    CASE WHEN expira_en > NOW() THEN 'VIGENTE' ELSE 'EXPIRADO' END as estado
FROM factura_afip_ta
WHERE entorno = 'HOMO' AND servicio = 'wsfe';
"@

# Guardar SQL
[System.IO.File]::WriteAllText($sqlFile, $sql, [System.Text.Encoding]::UTF8)

Write-Host "💾 SQL generado en: $sqlFile" -ForegroundColor Gray
Write-Host ""
Write-Host "🔄 Ejecutando con psql..." -ForegroundColor Cyan
Write-Host ""

# Ejecutar con psql
$env:PGPASSWORD = $dbPassword
$output = & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -f $sqlFile 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ TA insertado exitosamente!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 Resultado:" -ForegroundColor Cyan
    Write-Host $output
    Write-Host ""
    Write-Host "🎉 Próximos pasos:" -ForegroundColor Green
    Write-Host "   1. Ir a: http://localhost:3004/pages/afip-admin.html" -ForegroundColor White
    Write-Host "   2. Hacer clic en 'Renovar TA'" -ForegroundColor White
    Write-Host "   3. Debería mostrar: 'TA vigente (sin renovar)'" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "❌ Error ejecutando SQL" -ForegroundColor Red
    Write-Host $output
    Write-Host ""
    Write-Host "💡 Alternativa: Ejecuta manualmente en pgAdmin/DBeaver:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "INSERT INTO factura_afip_ta (entorno, servicio, token, sign, expira_en)" -ForegroundColor Cyan
    Write-Host "VALUES ('HOMO', 'wsfe', '<token>', '<sign>', '$exp')" -ForegroundColor Cyan
    Write-Host "ON CONFLICT (entorno, servicio) DO UPDATE SET" -ForegroundColor Cyan
    Write-Host "  token = EXCLUDED.token, sign = EXCLUDED.sign, expira_en = EXCLUDED.expira_en;" -ForegroundColor Cyan
}

# Limpiar
Remove-Item $sqlFile -ErrorAction SilentlyContinue
