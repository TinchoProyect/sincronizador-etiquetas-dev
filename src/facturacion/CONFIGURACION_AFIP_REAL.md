# Configuración AFIP Real - Resumen de Implementación

## ✅ Archivos Creados/Actualizados

### 1. Configuración Base

- **`.env`**: Configurado con parámetros exactos HOMO
  - CUIT: 23248921749
  - PTO_VTA: 32
  - AFIP_USE_REAL: true
  - URLs WSAA/WSFE HOMO
  - Rutas a certificados

- **`config/afip.js`**: Actualizado
  - Carga `.env` con dotenv
  - Exporta `USE_REAL`, `PTO_VTA`, `TIPOS_CBTE_SOPORTADOS`
  - Configuración completa para HOMO/PROD

### 2. Servicio WSAA Real

- **`services/wsaaService.real.js`**: Implementación completa
  - `getTA()`: Obtiene Token de Acceso de AFIP
  - `crearTRA()`: Genera Ticket de Requerimiento
  - `firmarTRA()`: Firma con OpenSSL (PKCS#7)
  - `llamarLoginCms()`: Request SOAP a WSAA
  - `parsearLoginTicketResponse()`: Parsea respuesta
  - Cache en BD (`factura_afip_ta`)
  - Renovación automática antes de expirar
  - Fallback a stub si `USE_REAL=false`

- **`services/wsaaService.js`**: Wrapper
  - Carga implementación real
  - Exporta funciones principales

### 3. Dependencias

- **`package.json`**: Agregadas
  - `node-forge`: Para PKCS#7
  - `axios`: Para requests HTTP

### 4. Documentación

- **`AFIP_HOMO.md`**: Guía completa
  - Parámetros exactos
  - Obtención de certificados
  - Ejemplos de SOAP (WSAA y WSFE)
  - Errores comunes y soluciones
  - Testing paso a paso
  - Mapeo de datos
  - Checklist pre-producción

## 🔧 Requisitos Pendientes

### 1. Certificados AFIP

**Ubicación:** `src/facturacion/certs/`

**Archivos necesarios:**
- `cert_homo.crt` (certificado HOMO)
- `key_homo.key` (clave privada HOMO)

**Cómo obtenerlos:**
1. Ir a https://www.afip.gob.ar/ws/
2. Descargar certificado de prueba para HOMO
3. Guardar en la carpeta `certs/`

### 2. OpenSSL

**Requerido para:** Firmar TRA con PKCS#7

**Instalación Windows:**
```bash
# Descargar de: https://slproweb.com/products/Win32OpenSSL.html
# O usar: choco install openssl
```

**Verificar instalación:**
```bash
openssl version
```

### 3. Tabla BD

**Tabla:** `factura_afip_ta`

**Estado:** ✅ Ya existe (confirmado por usuario)

**Campos:**
- `id` BIGSERIAL PK
- `entorno` VARCHAR(10) (HOMO/PROD)
- `servicio` VARCHAR(32) (wsfe)
- `token` TEXT
- `sign` TEXT
- `expira_en` TIMESTAMPTZ
- `creado_en` TIMESTAMPTZ
- UNIQUE (entorno, servicio)

## 🚀 Próximos Pasos

### Paso 1: Instalar Dependencias

```bash
cd src/facturacion
npm install
```

### Paso 2: Colocar Certificados

```bash
# Copiar certificados a:
src/facturacion/certs/cert_homo.crt
src/facturacion/certs/key_homo.key
```

### Paso 3: Verificar OpenSSL

```bash
openssl version
# Debe mostrar: OpenSSL 1.1.1 o superior
```

### Paso 4: Implementar WSFE Real

**Archivo a crear:** `services/wsfeService.real.js`

**Funciones necesarias:**
- `feCompUltimoAutorizado(pto_vta, tipo_cbte)`
- `feCAESolicitar(factura)`
- `feCompConsultar(pto_vta, tipo_cbte, cbte_nro)`

**Características:**
- Usar TA de WSAA
- Construir SOAP con `wsfeMapper`
- Llamar endpoints WSFE
- Parsear respuestas
- Guardar logs en `factura_afip_wsfe_logs`
- Manejar errores AFIP (10246, 600, etc.)

### Paso 5: Actualizar Mapper WSFE

**Archivo:** `mappers/wsfeMapper.js`

**Agregar:**
- `construirFECompUltimoAutorizado()`
- `construirFECAESolicitar(factura, items)`
- Mapeo correcto de IVA
- `CondicionIVAReceptorId` según tipo de cliente
- Validaciones de totales

### Paso 6: Integrar en Controller

**Archivo:** `controllers/facturas.js`

**Función:** `emitirFactura()`

**Flujo:**
1. Obtener TA (WSAA)
2. Consultar último autorizado (WSFE)
3. Numerar factura
4. Solicitar CAE (WSFE)
5. Guardar resultado
6. Actualizar estado

### Paso 7: Testing

```bash
# 1. Iniciar servidor
npm start

# 2. Probar WSAA
curl -X POST http://localhost:3004/facturacion/afip/test-wsaa

# 3. Probar último autorizado
curl "http://localhost:3004/facturacion/afip/ultimo?pto_vta=32&tipo_cbte=6"

# 4. Crear y emitir factura
# (Ver ejemplos en AFIP_HOMO.md)
```

## 📊 Estado Actual

| Componente | Estado | Notas |
|------------|--------|-------|
| Configuración `.env` | ✅ | Parámetros exactos HOMO |
| Config AFIP | ✅ | USE_REAL, PTO_VTA exportados |
| WSAA Service | ✅ | Implementación completa |
| WSFE Service | ⏳ | Pendiente implementación real |
| Mapper WSFE | ⏳ | Pendiente actualización |
| Controller | ⏳ | Pendiente integración AFIP |
| Certificados | ❌ | Pendiente colocar archivos |
| OpenSSL | ❓ | Verificar instalación |
| Testing | ⏳ | Pendiente pruebas reales |

## 🔍 Verificación Rápida

### 1. Verificar Configuración

```javascript
// En Node.js REPL
require('dotenv').config({ path: './src/facturacion/.env' });
console.log({
  CUIT: process.env.AFIP_CUIT,
  PTO_VTA: process.env.AFIP_PTO_VTA,
  USE_REAL: process.env.AFIP_USE_REAL,
  ENTORNO: process.env.AFIP_ENV
});
```

**Salida esperada:**
```javascript
{
  CUIT: '23248921749',
  PTO_VTA: '32',
  USE_REAL: 'true',
  ENTORNO: 'HOMO'
}
```

### 2. Verificar Tabla BD

```sql
SELECT * FROM factura_afip_ta WHERE entorno = 'HOMO';
```

### 3. Verificar Certificados

```bash
ls -la src/facturacion/certs/
# Debe mostrar: cert_homo.crt, key_homo.key
```

## ⚠️ Notas Importantes

1. **Certificados**: NUNCA commitear certificados reales al repositorio
2. **`.env`**: Ya está en `.gitignore`, no se commitea
3. **OpenSSL**: Requerido en PATH para firmar TRA
4. **Zona Horaria**: Siempre America/Argentina/Buenos_Aires
5. **Formato Números**: UI usa comas, AFIP usa puntos
6. **Logs**: Todos los requests/responses se guardan en BD
7. **Idempotencia**: Evitar doble emisión con locks y validaciones

## 📞 Soporte

**Errores comunes:** Ver `AFIP_HOMO.md` sección "Errores Comunes"

**Logs:** Revisar consola del servidor (prefijo `[WSAA-REAL]`, `[WSFE-REAL]`)

**BD Logs:** Tabla `factura_afip_wsfe_logs`

---

**Última actualización:** 2024-01-15
**Estado:** Configuración base completa, pendiente implementación WSFE y testing
