# Configuración AFIP HOMO (Homologación)

Guía completa para configurar y probar el módulo de facturación con AFIP en entorno de homologación.

## 📋 Parámetros Exactos HOMO

```
CUIT: 23248921749
Punto de Venta: 32
Tipos de Comprobante: 6 (Factura B), 11 (Factura C)
Entorno: HOMO
```

## 🔐 Certificados Requeridos

### 1. Obtener Certificado de Homologación

1. Ir a https://www.afip.gob.ar/ws/
2. Descargar certificado de prueba para HOMO
3. Guardar en `src/facturacion/certs/`:
   - `cert_homo.crt` (certificado)
   - `key_homo.key` (clave privada)

### 2. Verificar Certificados

```bash
# Verificar certificado
openssl x509 -in certs/cert_homo.crt -text -noout

# Verificar clave privada
openssl rsa -in certs/key_homo.key -check
```

## ⚙️ Configuración

### Archivo `.env`

```env
# Entorno
AFIP_ENV=HOMO
AFIP_CUIT=23248921749
AFIP_PTO_VTA=32
AFIP_USE_REAL=true

# URLs HOMO
WSAA_URL_HOMO=https://wsaahomo.afip.gov.ar/ws/services/LoginCms
WSFE_URL_HOMO=https://wswhomo.afip.gov.ar/wsfev1/service.asmx

# Certificados HOMO
CERT_PATH_HOMO=./certs/cert_homo.crt
KEY_PATH_HOMO=./certs/key_homo.key
```

## 🔄 Flujo WSAA (Autenticación)

### 1. Crear TRA (Ticket de Requerimiento de Acceso)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
<header>
    <uniqueId>1234567890</uniqueId>
    <generationTime>2024-01-15T10:00:00-03:00</generationTime>
    <expirationTime>2024-01-15T22:00:00-03:00</expirationTime>
</header>
<service>wsfe</service>
</loginTicketRequest>
```

### 2. Firmar TRA con OpenSSL

```bash
openssl smime -sign \
  -in tra.xml \
  -out login.cms \
  -signer certs/cert_homo.crt \
  -inkey certs/key_homo.key \
  -outform DER \
  -nodetach
```

### 3. Llamar loginCms

**Request SOAP:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope 
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
    xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
<soapenv:Header/>
<soapenv:Body>
<wsaa:loginCms>
<wsaa:in0>BASE64_CMS_AQUI</wsaa:in0>
</wsaa:loginCms>
</soapenv:Body>
</soapenv:Envelope>
```

**Response SOAP:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Body>
<loginCmsReturn>
<![CDATA[
<?xml version="1.0" encoding="UTF-8"?>
<loginTicketResponse version="1.0">
<header>
    <source>CN=wsaahomo, O=AFIP, C=AR, SERIALNUMBER=CUIT 33693450239</source>
    <destination>SERIALNUMBER=CUIT 23248921749, CN=test</destination>
    <uniqueId>1234567890</uniqueId>
    <generationTime>2024-01-15T10:00:00.000-03:00</generationTime>
    <expirationTime>2024-01-15T22:00:00.000-03:00</expirationTime>
</header>
<credentials>
    <token>TOKEN_LARGO_AQUI</token>
    <sign>SIGN_LARGO_AQUI</sign>
</credentials>
</loginTicketResponse>
]]>
</loginCmsReturn>
</soapenv:Body>
</soapenv:Envelope>
```

## 📄 Flujo WSFE (Facturación)

### 1. FECompUltimoAutorizado

Consultar último comprobante autorizado.

**Request:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope 
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
    xmlns:fe="http://ar.gov.afip.dif.FEV1/">
<soapenv:Header/>
<soapenv:Body>
<fe:FECompUltimoAutorizado>
<fe:Auth>
    <fe:Token>TOKEN_DE_WSAA</fe:Token>
    <fe:Sign>SIGN_DE_WSAA</fe:Sign>
    <fe:Cuit>23248921749</fe:Cuit>
</fe:Auth>
<fe:PtoVta>32</fe:PtoVta>
<fe:CbteTipo>6</fe:CbteTipo>
</fe:FECompUltimoAutorizado>
</soapenv:Body>
</soapenv:Envelope>
```

**Response:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body>
<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/">
<FECompUltimoAutorizadoResult>
    <PtoVta>32</PtoVta>
    <CbteTipo>6</CbteTipo>
    <CbteNro>123</CbteNro>
</FECompUltimoAutorizadoResult>
</FECompUltimoAutorizadoResponse>
</soap:Body>
</soap:Envelope>
```

### 2. FECAESolicitar

Solicitar CAE para factura.

**Request (Factura B - Consumidor Final):**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope 
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
    xmlns:fe="http://ar.gov.afip.dif.FEV1/">
<soapenv:Header/>
<soapenv:Body>
<fe:FECAESolicitar>
<fe:Auth>
    <fe:Token>TOKEN_DE_WSAA</fe:Token>
    <fe:Sign>SIGN_DE_WSAA</fe:Sign>
    <fe:Cuit>23248921749</fe:Cuit>
</fe:Auth>
<fe:FeCAEReq>
    <fe:FeCabReq>
        <fe:CantReg>1</fe:CantReg>
        <fe:PtoVta>32</fe:PtoVta>
        <fe:CbteTipo>6</fe:CbteTipo>
    </fe:FeCabReq>
    <fe:FeDetReq>
        <fe:FECAEDetRequest>
            <fe:Concepto>1</fe:Concepto>
            <fe:DocTipo>99</fe:DocTipo>
            <fe:DocNro>0</fe:DocNro>
            <fe:CbteDesde>124</fe:CbteDesde>
            <fe:CbteHasta>124</fe:CbteHasta>
            <fe:CbteFch>20240115</fe:CbteFch>
            <fe:ImpTotal>1210.00</fe:ImpTotal>
            <fe:ImpTotConc>0.00</fe:ImpTotConc>
            <fe:ImpNeto>1000.00</fe:ImpNeto>
            <fe:ImpOpEx>0.00</fe:ImpOpEx>
            <fe:ImpTrib>0.00</fe:ImpTrib>
            <fe:ImpIVA>210.00</fe:ImpIVA>
            <fe:FchServDesde></fe:FchServDesde>
            <fe:FchServHasta></fe:FchServHasta>
            <fe:FchVtoPago></fe:FchVtoPago>
            <fe:MonId>PES</fe:MonId>
            <fe:MonCotiz>1.0000</fe:MonCotiz>
            <fe:Iva>
                <fe:AlicIva>
                    <fe:Id>5</fe:Id>
                    <fe:BaseImp>1000.00</fe:BaseImp>
                    <fe:Importe>210.00</fe:Importe>
                </fe:AlicIva>
            </fe:Iva>
        </fe:FECAEDetRequest>
    </fe:FeDetReq>
</fe:FeCAEReq>
</fe:FECAESolicitar>
</soapenv:Body>
</soapenv:Envelope>
```

**Response Exitosa:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body>
<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
<FECAESolicitarResult>
    <FeCabResp>
        <Cuit>23248921749</Cuit>
        <PtoVta>32</PtoVta>
        <CbteTipo>6</CbteTipo>
        <FchProceso>20240115</FchProceso>
        <CantReg>1</CantReg>
        <Resultado>A</Resultado>
    </FeCabResp>
    <FeDetResp>
        <FECAEDetResponse>
            <Concepto>1</Concepto>
            <DocTipo>99</DocTipo>
            <DocNro>0</DocNro>
            <CbteDesde>124</CbteDesde>
            <CbteHasta>124</CbteHasta>
            <CbteFch>20240115</CbteFch>
            <Resultado>A</Resultado>
            <CAE>74123456789012</CAE>
            <CAEFchVto>20240125</CAEFchVto>
        </FECAEDetResponse>
    </FeDetResp>
</FECAESolicitarResult>
</FECAESolicitarResponse>
</soap:Body>
</soap:Envelope>
```

## ⚠️ Errores Comunes

### Error 10246: "No se encontró el comprobante"

**Causa:** El número de comprobante no existe en AFIP.

**Solución:** Usar `FECompUltimoAutorizado` para obtener el último número.

### Error 600: "Token expirado"

**Causa:** El TA (Token de Acceso) venció.

**Solución:** El sistema renueva automáticamente. Si persiste, verificar certificados.

### Error ns1:coe.alreadyAuthenticated

**Causa:** Ya existe una sesión activa.

**Solución:** Esperar unos segundos y reintentar.

### Error: "Certificado inválido"

**Causa:** Certificado mal formateado o expirado.

**Solución:**
1. Verificar formato PEM
2. Verificar vigencia
3. Regenerar si es necesario

## 🧪 Testing

### 1. Instalar Dependencias

```bash
cd src/facturacion
npm install
```

### 2. Verificar Configuración

```bash
node -e "require('dotenv').config(); console.log(process.env.AFIP_CUIT)"
```

### 3. Iniciar Servidor

```bash
npm start
```

### 4. Probar WSAA

```bash
curl -X POST http://localhost:3004/facturacion/afip/test-wsaa
```

### 5. Probar Último Autorizado

```bash
curl "http://localhost:3004/facturacion/afip/ultimo?pto_vta=32&tipo_cbte=6"
```

### 6. Crear Factura de Prueba

```bash
curl -X POST http://localhost:3004/facturacion/facturas \
  -H "Content-Type: application/json" \
  -d '{
    "tipo_cbte": 6,
    "pto_vta": 32,
    "concepto": 1,
    "doc_tipo": 99,
    "doc_nro": "0",
    "condicion_iva_id": 5,
    "requiere_afip": true,
    "items": [
      {
        "descripcion": "Producto de prueba",
        "qty": 1,
        "p_unit": 1000,
        "alic_iva_id": 5
      }
    ]
  }'
```

### 7. Emitir Factura

```bash
curl -X POST http://localhost:3004/facturacion/facturas/1/emitir
```

## 📊 Mapeo de Datos

### Condición IVA Receptor

| ID | Descripción | Uso en Factura B |
|----|-------------|------------------|
| 1  | Responsable Inscripto | ❌ |
| 5  | Consumidor Final | ✅ |
| 6  | Monotributo | ✅ |

### Alícuotas IVA

| ID | Porcentaje | Código AFIP |
|----|------------|-------------|
| 3  | 0%         | 3           |
| 4  | 10.5%      | 4           |
| 5  | 21%        | 5           |
| 6  | 27%        | 6           |

### Tipos de Documento

| Código | Descripción | Uso |
|--------|-------------|-----|
| 80     | CUIT        | Empresas |
| 96     | DNI         | Personas |
| 99     | Consumidor Final | Sin identificar |

## 🔍 Logs de Depuración

El sistema genera logs detallados:

```
🔑 [WSAA-REAL] Obteniendo TA para HOMO...
📝 [WSAA-REAL] Paso 1: Creando TRA XML...
✅ [WSAA-REAL] TRA creado (uniqueId: 1705324800000)
🔐 [WSAA-REAL] Paso 2: Firmando TRA con OpenSSL...
✅ [WSAA-REAL] Certificados encontrados
🔧 [WSAA-REAL] Ejecutando OpenSSL...
✅ [WSAA-REAL] CMS generado (1234 chars)
📤 [WSAA-REAL] Paso 3: Llamando loginCms...
✅ [WSAA-REAL] Respuesta recibida (200)
📥 [WSAA-REAL] Paso 4: Parseando respuesta...
✅ [WSAA-REAL] TA obtenido exitosamente
   Token: PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiI...
   Expira: 2024-01-15T22:00:00.000-03:00
💾 [WSAA-REAL] Guardando TA en BD...
✅ [WSAA-REAL] TA guardado en BD
```

## 📚 Referencias

- [AFIP Web Services](https://www.afip.gob.ar/ws/)
- [Manual WSFE](https://www.afip.gob.ar/fe/documentos/manual_desarrollador_COMPG_v2_10.pdf)
- [Tipos de Comprobante](https://www.afip.gob.ar/fe/ayuda/tipos-comprobante.asp)
- [Errores WSFE](https://www.afip.gob.ar/fe/ayuda/errores.asp)

## ✅ Checklist Pre-Producción

Antes de pasar a PROD, verificar:

- [ ] Certificados HOMO funcionando correctamente
- [ ] Al menos 10 facturas emitidas exitosamente en HOMO
- [ ] Todos los tipos de comprobante probados (B, C)
- [ ] Manejo de errores validado
- [ ] Logs de auditoría funcionando
- [ ] PDF generándose correctamente con CAE
- [ ] Numeración sincronizada con AFIP
- [ ] Certificados PROD obtenidos y configurados
- [ ] Variables de entorno PROD configuradas
- [ ] Backup de BD antes del cambio

---

**Sistema LAMDA** - Módulo de Facturación Electrónica AFIP HOMO
