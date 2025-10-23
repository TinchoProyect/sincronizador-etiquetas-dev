# ✅ Validación AFIP HOMO Completa

Documento de referencia con los detalles exactos de lo que fue probado y validado exitosamente en AFIP HOMO.

## 📋 Parámetros Validados

```
CUIT: 23248921749
Punto de Venta: 32
Entorno: HOMO (Homologación)
Certificado: CN=WSFEHOMO32, serialNumber=CUIT 23248921749
```

## 🔐 Archivos y Rutas Reales (Probadas)

### Certificados
```
Certificado: C:\Users\Martin\Documents\lambda-ws-homo\cert\homo_cert.pem
Clave Privada: C:\Users\Martin\Documents\lambda-ws-homo\cert\homo_key.pem
Sujeto: CN=WSFEHOMO32, serialNumber=CUIT 23248921749
Modulus: Verificado y coincidente
```

### Carpeta de Trabajo WSAA
```
Directorio: C:\Users\Martin\Documents\lambda-ws-homo\wsaa\
Archivos:
  - login.xml (TRA generado)
  - login.cms (TRA firmado, DER, nodetach, binary)
  - TA.xml (Token de Acceso vigente)
  - wsaa_fault.xml (solo si hay error)
```

### OpenSSL
```
Ejecutable: C:\Program Files\OpenSSL-Win64\bin\openssl.exe
Comando usado: smime -sign -outform DER -nodetach -binary
```

## ✅ WSAA (Autenticación) - VALIDADO

### LoginTicketRequest (TRA)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <source>CN=WSFEHOMO32, serialNumber=CUIT 23248921749</source>
    <destination>CN=wsaahomo, O=AFIP, C=AR, SERIALNUMBER=CUIT 33693450239</destination>
    <uniqueId>ENTERO_6_DIGITOS</uniqueId>
    <generationTime>YYYY-MM-DDTHH:MM:SSZ</generationTime>
    <expirationTime>YYYY-MM-DDTHH:MM:SSZ</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>
```

### Firma y Envío
- **Firma**: OpenSSL S/MIME PKCS#7, DER, nodetach, binary
- **URL**: https://wsaahomo.afip.gov.ar/ws/services/LoginCms
- **SOAPAction**: "loginCms" (con comillas)
- **Resultado**: ✅ Token y Sign obtenidos correctamente

### Errores Manejados
- ✅ `ns1:coe.alreadyAuthenticated`: TA vigente, reutilizar
- ✅ Ventana temporal: -10/+10 minutos validada
- ✅ Renovación automática: 5 minutos antes de expirar

## ✅ WSFE (Facturación) - VALIDADO

### Endpoints y SOAPActions Probados

| Método | SOAPAction | Estado |
|--------|-----------|--------|
| FEDummy | `http://ar.gov.afip.dif.FEV1/FEDummy` | ✅ OK |
| FEParamGetTiposCbte | `http://ar.gov.afip.dif.FEV1/FEParamGetTiposCbte` | ✅ OK |
| FEParamGetPtosVenta | `http://ar.gov.afip.dif.FEV1/FEParamGetPtosVenta` | ⚠️ 602 (no bloquea) |
| FECompUltimoAutorizado | `http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado` | ✅ OK |
| FECAESolicitar | `http://ar.gov.afip.dif.FEV1/FECAESolicitar` | ✅ OK |
| FECompConsultar | `http://ar.gov.afip.dif.FEV1/FECompConsultar` | ✅ OK |

### Factura B Exitosa (Validada)

**Parámetros:**
```
PtoVta: 32
CbteTipo: 6 (Factura B)
CbteNro: 1
Concepto: 1 (Productos)
DocTipo: 99 (Consumidor Final)
DocNro: 0
CondicionIVAReceptorId: 5 (Consumidor Final) ⟵ OBLIGATORIO
```

**Totales:**
```
ImpNeto: 1000.00
ImpIVA: 210.00 (21%)
ImpTotal: 1210.00
ImpTotConc: 0.00
ImpTrib: 0.00
ImpOpEx: 0.00
```

**IVA:**
```
AlicIva:
  Id: 5 (21%)
  BaseImp: 1000.00
  Importe: 210.00
```

**Moneda:**
```
MonId: PES
MonCotiz: 1.000
```

**Resultado:**
```
Resultado: A (Aprobado)
CAE: 75419285645738
CAEFchVto: 20251022 (2025-10-22)
```

**Confirmación:**
- ✅ FECompConsultar confirmó todos los datos
- ✅ CAE válido y persistido
- ✅ Numeración sincronizada

## ❌ Errores Encontrados y Solucionados

### Error 10246 (RG 5616)
**Causa**: Falta `CondicionIVAReceptorId` en el request
**Solución**: Agregar campo obligatorio
```xml
<fe:CondicionIVAReceptorId>5</fe:CondicionIVAReceptorId>
```
**Estado**: ✅ Resuelto

### Error 600 (Token Expirado)
**Causa**: TA vencido o fuera de ventana temporal
**Solución**: Renovar TA automáticamente
**Estado**: ✅ Implementado

### Error 602 (Sin Resultados)
**Causa**: FEParamGetPtosVenta no lista PV en HOMO
**Solución**: No bloquea emisión, continuar con PV conocido (32)
**Estado**: ✅ Manejado

## 📊 Estado de Tipos de Comprobante

| Tipo | Descripción | Estado | Notas |
|------|-------------|--------|-------|
| 6 | Factura B | ✅ Probado | CAE obtenido exitosamente |
| 11 | Factura C | ⏳ Pendiente | Preparado, requiere completar payload |
| 1 | Factura A | ❌ No probado | Requiere condición impositiva específica |

## 🔄 Flujo Completo Validado

### 1. Autenticación (WSAA)
```
1. Generar login.xml con ventana temporal correcta
2. Firmar con OpenSSL → login.cms (DER, nodetach, binary)
3. Enviar a loginCms con SOAPAction "loginCms"
4. Parsear respuesta → Token, Sign, expirationTime
5. Guardar en TA.xml
6. Reutilizar hasta 5 min antes de expirar
```
**Estado**: ✅ Validado

### 2. Consultar Último Autorizado
```
1. Usar Token/Sign de TA.xml
2. FECompUltimoAutorizado con PtoVta=32, CbteTipo=6
3. Obtener último CbteNro (era 0 antes de emitir)
```
**Estado**: ✅ Validado

### 3. Solicitar CAE
```
1. Construir FECAESolicitar con:
   - Auth (Token, Sign, Cuit)
   - Cabecera (CantReg=1, PtoVta=32, CbteTipo=6)
   - Detalle con CondicionIVAReceptorId=5
   - Totales coherentes
   - IVA con Id=5 (21%)
2. Enviar a WSFE
3. Parsear respuesta → CAE, CAEFchVto
4. Persistir resultado
```
**Estado**: ✅ Validado (CAE: 75419285645738)

### 4. Consultar Comprobante
```
1. FECompConsultar con PtoVta=32, CbteTipo=6, CbteNro=1
2. Confirmar Resultado=A, CAE y totales
```
**Estado**: ✅ Validado

## 📝 Contrato Mínimo para Factura B (CF)

```javascript
{
  // Auth (desde TA.xml)
  auth: {
    token: "TOKEN_DE_WSAA",
    sign: "SIGN_DE_WSAA",
    cuit: "23248921749"
  },
  
  // Cabecera
  cabecera: {
    cantReg: 1,
    ptoVta: 32,
    cbteTipo: 6
  },
  
  // Detalle
  detalle: {
    concepto: 1,                      // Productos
    docTipo: 99,                      // Consumidor Final
    docNro: 0,
    cbteDesde: N,                     // Próximo número
    cbteHasta: N,
    cbteFch: "YYYYMMDD",             // Hoy
    impTotal: 1210.00,
    impTotConc: 0.00,
    impNeto: 1000.00,
    impOpEx: 0.00,
    impTrib: 0.00,
    impIVA: 210.00,
    monId: "PES",
    monCotiz: 1.000,
    condicionIVAReceptorId: 5,       // ⟵ OBLIGATORIO
    iva: [{
      id: 5,                          // 21%
      baseImp: 1000.00,
      importe: 210.00
    }]
  }
}
```

## ⚙️ Variables de Entorno (.env)

```env
# Validadas y probadas
AFIP_ENV=HOMO
AFIP_CUIT=23248921749
AFIP_PTO_VTA=32
AFIP_TIPOS_CBTE=6,11
AFIP_USE_REAL=true

# Rutas reales
CERT_FILE=C:\Users\Martin\Documents\lambda-ws-homo\cert\homo_cert.pem
KEY_FILE=C:\Users\Martin\Documents\lambda-ws-homo\cert\homo_key.pem
WSAA_WORKDIR=C:\Users\Martin\Documents\lambda-ws-homo\wsaa\
OPENSSL_EXE=C:\Program Files\OpenSSL-Win64\bin\openssl.exe

# Servidor
PORT=3004
```

## 🎯 Checklist de Integración

### Backend
- [x] Cargar .env con rutas reales
- [x] Servicio WSAA: generar y firmar TRA
- [x] Servicio WSAA: obtener y cachear TA
- [x] Servicio WSAA: renovar TA automáticamente
- [ ] Servicio WSFE: FECompUltimoAutorizado
- [ ] Servicio WSFE: FECAESolicitar con CondicionIVAReceptorId
- [ ] Servicio WSFE: FECompConsultar
- [ ] Mapper: construir SOAP correcto
- [ ] Controller: flujo completo de emisión
- [ ] Persistencia: guardar CAE y logs

### Testing
- [x] WSAA: obtener TA
- [x] WSAA: manejar alreadyAuthenticated
- [x] WSFE: FEDummy
- [x] WSFE: FEParamGetTiposCbte
- [x] WSFE: FECompUltimoAutorizado
- [x] WSFE: FECAESolicitar (Factura B)
- [x] WSFE: FECompConsultar
- [ ] Emisión end-to-end desde UI
- [ ] Generación de PDF con CAE

## 🚀 Próximos Pasos

1. **Actualizar config/afip.js**
   - Leer `CERT_FILE`, `KEY_FILE`, `WSAA_WORKDIR`, `OPENSSL_EXE` del .env
   - Exportar estas rutas para uso en servicios

2. **Actualizar wsaaService.real.js**
   - Usar rutas reales del .env
   - Guardar TA.xml en `WSAA_WORKDIR`
   - Usar `OPENSSL_EXE` para firmar

3. **Implementar wsfeService.real.js**
   - `feCompUltimoAutorizado()`
   - `feCAESolicitar()` con CondicionIVAReceptorId
   - `feCompConsultar()`
   - Usar Token/Sign de TA.xml

4. **Actualizar wsfeMapper.js**
   - Incluir `CondicionIVAReceptorId` según cliente
   - Mapear IVA correctamente (Id 5 = 21%)
   - Validar totales coherentes

5. **Testing Completo**
   - Probar flujo end-to-end
   - Emitir 3 facturas consecutivas
   - Verificar CAE y persistencia
   - Generar PDF con CAE/QR

## 📚 Referencias

- **Certificado**: CN=WSFEHOMO32, serialNumber=CUIT 23248921749
- **CAE Obtenido**: 75419285645738 (Vto: 2025-10-22)
- **Punto de Venta**: 32
- **Tipo Validado**: 6 (Factura B)
- **Receptor Validado**: Consumidor Final (DocTipo 99, CondicionIVA 5)

---

**Última validación**: 2024-01-15
**Estado**: WSAA y WSFE probados exitosamente en HOMO
**Próximo**: Integrar servicios reales en el módulo
