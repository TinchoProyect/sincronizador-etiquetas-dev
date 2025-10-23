# Script corregido para obtener TA de AFIP HOMO
# Incluye: -binary en OpenSSL + diagnóstico de SOAP Fault

$ws   = "C:\Users\Martin\Documents\lambda-ws-homo\wsaa"
$cert = "C:\Users\Martin\Documents\lambda-ws-homo\cert\homo_cert.pem"
$key  = "C:\Users\Martin\Documents\lambda-ws-homo\cert\homo_key.pem"
$OPENSSL = "C:\Program Files\OpenSSL-Win64\bin\openssl.exe"

Write-Host "[WSAA] Obteniendo TA de AFIP HOMO..." -ForegroundColor Cyan

# Crear directorio si no existe
if (!(Test-Path $ws)) {
    New-Item -ItemType Directory -Path $ws | Out-Null
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
<service>wsfe</service>
</loginTicketRequest>
"@

$TRA_PATH = Join-Path $ws "TRA.xml"
$CMS_PATH = Join-Path $ws "login.cms"
$TA_PATH = Join-Path $ws "TA.xml"

# Guardar TRA
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($TRA_PATH, $TRA, $utf8NoBom)
Write-Host "[OK] TRA creado: $TRA_PATH" -ForegroundColor Green

# Firmar con OpenSSL - IMPORTANTE: incluir -binary
Write-Host "[WSAA] Firmando TRA con OpenSSL (con -binary)..." -ForegroundColor Cyan
& $OPENSSL smime -sign `
    -in $TRA_PATH `
    -out $CMS_PATH `
    -signer $cert `
    -inkey $key `
    -outform DER `
    -nodetach `
    -binary

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

# Llamar a WSAA con manejo de errores mejorado
Write-Host "[WSAA] Llamando a WSAA loginCms..." -ForegroundColor Cyan

try {
    $response = Invoke-WebRequest -Uri 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms' `
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
    
    # Intentar extraer SOAP Fault
    if ($_.Exception.Response) {
        try {
            $rs = $_.Exception.Response.GetResponseStream()
            $reader = New-Object IO.StreamReader($rs)
            $responseBody = $reader.ReadToEnd()
            $reader.Close()
            
            Write-Host "[ERROR] Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
            
            # Parsear SOAP Fault
            [xml]$soapXml = $responseBody
            $fault = $soapXml.SelectSingleNode("//*[local-name()='Fault']")
            
            if ($fault) {
                $faultcode = $fault.SelectSingleNode("*[local-name()='faultcode']").InnerText
                $faultstring = $fault.SelectSingleNode("*[local-name()='faultstring']").InnerText
                
                Write-Host ""
                Write-Host "[SOAP FAULT] Detalles del error:" -ForegroundColor Yellow
                Write-Host "   Code: $faultcode" -ForegroundColor White
                Write-Host "   String: $faultstring" -ForegroundColor White
                Write-Host ""
                
                # Caso especial: alreadyAuthenticated
                if ($faultstring -match "alreadyAuthenticated" -or $faultstring -match "ya posee un TA válido") {
                    Write-Host "[INFO] AFIP indica que ya existe un TA válido" -ForegroundColor Yellow
                    Write-Host "[INFO] Verificando si existe TA en disco..." -ForegroundColor Yellow
                    
                    if (Test-Path $TA_PATH) {
                        [xml]$taExistente = Get-Content $TA_PATH
                        $expiracion = $taExistente.loginTicketResponse.header.expirationTime
                        $expiraDate = [DateTime]::Parse($expiracion)
                        $minutosRestantes = [Math]::Floor(($expiraDate - (Get-Date).ToUniversalTime()).TotalMinutes)
                        
                        Write-Host "[INFO] TA existente expira en: $minutosRestantes minutos" -ForegroundColor Cyan
                        
                        if ($minutosRestantes -gt 0) {
                            Write-Host "[OK] TA existente aun es valido, puedes usarlo" -ForegroundColor Green
                            Write-Host "[INFO] Expira: $expiracion" -ForegroundColor White
                            exit 0
                        } else {
                            Write-Host "[WARN] TA existente expirado" -ForegroundColor Yellow
                            Write-Host "[INFO] Espera unos minutos y vuelve a intentar" -ForegroundColor Yellow
                        }
                    } else {
                        Write-Host "[WARN] No se encontro TA en disco" -ForegroundColor Yellow
                        Write-Host "[INFO] Espera unos minutos (cooldown de AFIP) y vuelve a intentar" -ForegroundColor Yellow
                    }
                }
            }
        } catch {
            Write-Host "[ERROR] No se pudo parsear SOAP Fault" -ForegroundColor Red
        }
    }
    
    exit 1
}
