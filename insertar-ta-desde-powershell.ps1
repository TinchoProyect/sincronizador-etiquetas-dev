# Script para insertar TA en la base de datos directamente desde PowerShell
# Usa las variables $token, $sign, $exp que ya tienes cargadas

Write-Host "🔄 Insertando TA en la base de datos..." -ForegroundColor Cyan
Write-Host ""

# Verificar que las variables existen
if (-not $token) {
    Write-Host "❌ ERROR: Variable `$token no encontrada" -ForegroundColor Red
    Write-Host "Ejecuta primero el script de obtención de TA" -ForegroundColor Yellow
    exit 1
}

if (-not $sign) {
    Write-Host "❌ ERROR: Variable `$sign no encontrada" -ForegroundColor Red
    exit 1
}

if (-not $exp) {
    Write-Host "❌ ERROR: Variable `$exp no encontrada" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Variables encontradas" -ForegroundColor Green
Write-Host "   Token: $($token.Substring(0, 50))..." -ForegroundColor Gray
Write-Host "   Sign: $($sign.Substring(0, 50))..." -ForegroundColor Gray
Write-Host "   Expira: $exp" -ForegroundColor Gray
Write-Host ""

# Configuración de BD
$dbHost = "localhost"
$dbPort = "5432"
$dbName = "etiquetas"
$dbUser = "postgres"
$dbPassword = "ta3Mionga"

# Construir connection string
$connString = "Host=$dbHost;Port=$dbPort;Database=$dbName;Username=$dbUser;Password=$dbPassword"

Write-Host "📊 Conectando a la base de datos..." -ForegroundColor Cyan

try {
    # Cargar el driver de PostgreSQL (Npgsql)
    # Si no está instalado, usar psql como alternativa
    
    # Crear archivo SQL temporal
    $sqlFile = "$env:TEMP\insert_ta.sql"
    
    $sqlContent = @"
-- Insertar o actualizar TA en la base de datos
INSERT INTO factura_afip_ta (entorno, servicio, token, sign, expira_en, creado_en)
VALUES ('HOMO', 'wsfe', '$token', '$sign', '$exp', NOW())
ON CONFLICT (entorno, servicio)
DO UPDATE SET
    token = EXCLUDED.token,
    sign = EXCLUDED.sign,
    expira_en = EXCLUDED.expira_en,
    creado_en = NOW();

-- Mostrar el resultado
SELECT 
    id,
    entorno,
    servicio,
    expira_en,
    (expira_en > NOW()) AS vigente,
    creado_en
FROM factura_afip_ta
WHERE entorno = 'HOMO' AND servicio = 'wsfe';
"@

    # Guardar SQL en archivo temporal
    $sqlContent | Out-File -FilePath $sqlFile -Encoding UTF8
    
    Write-Host "💾 Archivo SQL creado: $sqlFile" -ForegroundColor Gray
    Write-Host ""
    Write-Host "🔄 Ejecutando INSERT/UPDATE..." -ForegroundColor Cyan
    
    # Ejecutar con psql
    $env:PGPASSWORD = $dbPassword
    $result = & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -f $sqlFile 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ TA insertado exitosamente en la base de datos!" -ForegroundColor Green
        Write-Host ""
        Write-Host "📊 Resultado:" -ForegroundColor Cyan
        Write-Host $result -ForegroundColor Gray
        Write-Host ""
        Write-Host "🎉 Ahora puedes:" -ForegroundColor Green
        Write-Host "   1. Ir a http://localhost:3004/pages/afip-admin.html" -ForegroundColor White
        Write-Host "   2. Hacer clic en 'Renovar TA'" -ForegroundColor White
        Write-Host "   3. Debería mostrar 'TA vigente (sin renovar)'" -ForegroundColor White
        Write-Host ""
    } else {
        Write-Host ""
        Write-Host "❌ Error ejecutando SQL:" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        Write-Host ""
        Write-Host "💡 Alternativa: Usar Node.js" -ForegroundColor Yellow
        Write-Host "   Ejecuta: node insertar-ta-manual.js" -ForegroundColor White
        Write-Host "   (Pero primero edita el archivo con los valores)" -ForegroundColor Gray
    }
    
    # Limpiar archivo temporal
    Remove-Item $sqlFile -ErrorAction SilentlyContinue
    
} catch {
    Write-Host ""
    Write-Host "❌ Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Solución alternativa:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Ejecuta este SQL manualmente en pgAdmin o DBeaver:" -ForegroundColor White
    Write-Host ""
    Write-Host "INSERT INTO factura_afip_ta (entorno, servicio, token, sign, expira_en, creado_en)" -ForegroundColor Cyan
    Write-Host "VALUES ('HOMO', 'wsfe', '$($token.Substring(0,50))...', '$($sign.Substring(0,50))...', '$exp', NOW())" -ForegroundColor Cyan
    Write-Host "ON CONFLICT (entorno, servicio)" -ForegroundColor Cyan
    Write-Host "DO UPDATE SET token = EXCLUDED.token, sign = EXCLUDED.sign, expira_en = EXCLUDED.expira_en;" -ForegroundColor Cyan
    Write-Host ""
}
