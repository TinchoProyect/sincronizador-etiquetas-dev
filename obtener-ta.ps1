# Script para obtener nuevo TA de AFIP HOMO
# Ejecutar desde PowerShell

Write-Host "[WSAA] Obteniendo nuevo TA de AFIP HOMO..." -ForegroundColor Cyan

# Configuracion
$CUIT = "23248921749"
$SERVICE = "wsfe"
$CERT_PATH = "C:\Users\Martin\Documents\lambda-ws-homo\cert\homo_cert.pem"
$KEY_PATH = "C:\Users\Martin\Documents\lambda-ws-homo\cert\homo_key.pem"
$WSAA_DIR = "C:\Users\Martin\Documents\lambda-ws-homo\wsaa"
$OPENSSL = "C:\Program Files\OpenSSL-Win64\bin\openssl.exe"
$WSAA_URL = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms"

# Crear directorio si no existe
if (!(Test-Path $WSAA_DIR)) {
    New-Item -ItemType Directory -Path $WSAA_DIR | Out-Null
}

# Generar TRA
$uniqueId = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$generationTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss")
$expirationTime = (Get-Date).AddHours(12).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss")

$TRA = @"
<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
<header>
    <uniqueId>$uniqueId</uniqueId>
    <generationTime>$generationTime</generationTime>
    <expirationTime>$expirationTime</expirationTime>
</header>
<service>$SERVICE</service>
</loginTicketRequest>
"@

$TRA_PATH = Join-Path $WSAA_DIR "TRA.xml"
$CMS_PATH = Join-Path $WSAA_DIR "login.cms"
$TA_PATH = Join-Path $WSAA_DIR "TA.xml"

# Guardar TRA
$TRA | Out-File -FilePath $TRA_PATH -Encoding UTF8 -NoNewline
Write-Host "[OK] TRA creado: $TRA_PATH" -ForegroundColor Green

# Firmar con OpenSSL
Write-Host "[WSAA] Firmando TRA con OpenSSL..." -ForegroundColor Cyan
& $OPENSSL smime -sign `
    -in $TRA_PATH `
    -out $CMS_PATH `
    -signer $CERT_PATH `
    -inkey $KEY_PATH `
    -outform DER `
    -nodetach

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Error firmando TRA" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] CMS generado: $CMS_PATH" -ForegroundColor Green

# Leer CMS y convertir a Base64
$cmsBytes = [System.IO.File]::ReadAllBytes($CMS_PATH)
$cmsBase64 = [Convert]::ToBase64String($cmsBytes)

# Crear SOAP envelope
$soapEnvelope = @"
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
<soapenv:Header/>
<soapenv:Body>
<wsaa:loginCms>
<wsaa:in0>$cmsBase64</wsaa:in0>
</wsaa:loginCms>
</soapenv:Body>
</soapenv:Envelope>
"@

# Llamar a WSAA
Write-Host "[WSAA] Llamando a WSAA loginCms..." -ForegroundColor Cyan

try {
    $response = Invoke-WebRequest -Uri $WSAA_URL `
        -Method POST `
        -Body $soapEnvelope `
        -ContentType "text/xml; charset=utf-8" `
        -Headers @{"SOAPAction"=""} `
        -TimeoutSec 30
    
    Write-Host "[OK] Respuesta recibida (Status: $($response.StatusCode))" -ForegroundColor Green
    
    # Extraer loginTicketResponse
    $xml = [xml]$response.Content
    $loginCmsReturn = $xml.Envelope.Body.loginCmsReturn
    
    # Guardar TA
    $loginCmsReturn | Out-File -FilePath $TA_PATH -Encoding UTF8
    
    Write-Host "[OK] TA guardado: $TA_PATH" -ForegroundColor Green
    
    # Parsear y mostrar info
    $taXml = [xml]$loginCmsReturn
    $token = $taXml.loginTicketResponse.credentials.token
    $sign = $taXml.loginTicketResponse.credentials.sign
    $expiration = $taXml.loginTicketResponse.header.expirationTime
    
    Write-Host ""
    Write-Host "[INFO] Informacion del TA:" -ForegroundColor Cyan
    Write-Host "   Token: $($token.Substring(0, 50))..." -ForegroundColor White
    Write-Host "   Sign: $($sign.Substring(0, 50))..." -ForegroundColor White
    Write-Host "   Expira: $expiration" -ForegroundColor White
    Write-Host ""
    Write-Host "[OK] TA obtenido exitosamente!" -ForegroundColor Green
    Write-Host "[INFO] Ahora puedes emitir facturas desde el backend" -ForegroundColor Yellow
    
} catch {
    Write-Host "[ERROR] Error llamando a WSAA: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "[ERROR] Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    }
    exit 1
}
