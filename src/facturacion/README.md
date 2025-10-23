# Módulo de Facturación - Sistema LAMDA

Módulo profesional de Facturación Electrónica con integración AFIP (WSAA/WSFE) y soporte para facturación interna.

## 🎯 Características

- ✅ Facturación Electrónica AFIP (Tipos A, B, C, NC, ND)
- ✅ Facturación Interna sin AFIP (series personalizadas)
- ✅ Integración WSAA (autenticación) y WSFE (facturación)
- ✅ Soporte HOMO (homologación) y PROD (producción)
- ✅ Generación de PDF con CAE y código QR
- ✅ Cálculo automático de IVA y totales
- ✅ Numeración automática (AFIP e interna)
- ✅ Logs detallados de depuración
- ✅ Conversión automática coma/punto (UI ↔ Backend)
- ✅ Zona horaria Argentina (America/Argentina/Buenos_Aires)
- ✅ Idempotencia en emisión de comprobantes

## 📋 Requisitos Previos

1. **Node.js** v14 o superior
2. **PostgreSQL** con base de datos `etiquetas`
3. **Certificados AFIP** (formato PEM)
4. **CUIT** registrado en AFIP

## 🚀 Instalación

### 1. Configurar Variables de Entorno

```bash
cd src/facturacion
cp .env.example .env
```

Editar `.env` con tus datos:
- `AFIP_CUIT`: Tu CUIT sin guiones
- `AFIP_ENV`: `HOMO` para pruebas, `PROD` para producción
- Rutas a certificados y claves

### 2. Obtener Certificados AFIP

#### Para Homologación:
1. Ir a https://www.afip.gob.ar/ws/
2. Descargar certificado de prueba
3. Guardar en `src/facturacion/certs/homo-cert.pem` y `homo-key.pem`

#### Para Producción:
1. Generar CSR (Certificate Signing Request)
2. Solicitar certificado en AFIP
3. Guardar en `src/facturacion/certs/prod-cert.pem` y `prod-key.pem`

### 3. Verificar Base de Datos

Las siguientes tablas deben existir en PostgreSQL:
- `factura_facturas`
- `factura_factura_items`
- `factura_afip_ta`
- `factura_afip_wsfe_logs`
- `factura_numeracion_afip`
- `factura_numeracion_interna`

### 4. Instalar Dependencias

```bash
npm install
```

## 🎮 Uso

### Iniciar el Servidor

```bash
# Desarrollo (puerto 3004)
npm run facturacion

# O desde la raíz del proyecto
npm start
```

El servidor estará disponible en: `http://localhost:3004`

### Endpoints Principales

#### Facturas

```bash
# Crear borrador
POST /facturacion/facturas
Content-Type: application/json
{
  "tipo_cbte": 6,
  "pto_vta": 1,
  "concepto": 1,
  "cliente_id": 123,
  "doc_tipo": 80,
  "doc_nro": "20123456789",
  "condicion_iva_id": 1,
  "requiere_afip": true,
  "items": [
    {
      "descripcion": "Producto 1",
      "qty": 2,
      "p_unit": 1000.50,
      "alic_iva_id": 5
    }
  ]
}

# Actualizar borrador
PUT /facturacion/facturas/:id

# Emitir factura (AFIP o interna)
POST /facturacion/facturas/:id/emitir

# Obtener factura
GET /facturacion/facturas/:id

# Listar facturas (con filtros)
GET /facturacion/facturas?fecha_desde=2024-01-01&estado=APROBADA

# Generar PDF
POST /facturacion/facturas/:id/pdf
```

#### AFIP

```bash
# Consultar último comprobante autorizado
GET /facturacion/afip/ultimo?pto_vta=1&tipo_cbte=6

# Health check
GET /facturacion/health
```

## 📊 Tipos de Comprobante

| Código | Descripción |
|--------|-------------|
| 1      | Factura A   |
| 6      | Factura B   |
| 11     | Factura C   |
| 3      | Nota de Crédito A |
| 8      | Nota de Crédito B |
| 13     | Nota de Crédito C |
| 2      | Nota de Débito A |
| 7      | Nota de Débito B |
| 12     | Nota de Débito C |

## 🔢 Tipos de Documento

| Código | Descripción |
|--------|-------------|
| 80     | CUIT        |
| 86     | CUIL        |
| 96     | DNI         |
| 99     | Consumidor Final |

## 💰 Alícuotas de IVA

| Código | Descripción | Porcentaje |
|--------|-------------|------------|
| 5      | IVA 21%     | 21%        |
| 4      | IVA 10.5%   | 10.5%      |
| 6      | IVA 27%     | 27%        |
| 8      | IVA 5%      | 5%         |
| 9      | IVA 2.5%    | 2.5%       |
| 3      | IVA 0%      | 0%         |

## 📋 Contrato de Integración (Paso 1.1)

### Crear Borrador de Factura

**Endpoint:** `POST /facturacion/facturas`

**Request Body:**
```json
{
  "tipo_cbte": 6,
  "pto_vta": 32,
  "concepto": 1,
  "fecha_emision": "2025-01-12",
  "doc_tipo": 99,
  "doc_nro": "0",
  "condicion_iva_id": 5,
  "requiere_afip": false,
  "serie_interna": "INT",
  "cliente_id": 45,
  "presupuesto_id": 123,
  "items": [
    {
      "descripcion": "Item X",
      "qty": 1,
      "p_unit": 1000,
      "alic_iva_id": 5
    }
  ]
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Borrador de factura creado exitosamente",
  "data": {
    "id": "2",
    "tipo_cbte": 6,
    "pto_vta": 32,
    "cbte_nro": null,
    "concepto": 1,
    "fecha_emision": "2025-01-12T03:00:00.000Z",
    "cliente_id": 45,
    "doc_tipo": 99,
    "doc_nro": "0",
    "condicion_iva_id": 5,
    "moneda": "PES",
    "mon_cotiz": "1.0000",
    "imp_neto": "1000.00",
    "imp_iva": "210.00",
    "imp_trib": "0.00",
    "imp_total": "1210.00",
    "cae": null,
    "cae_vto": null,
    "resultado": null,
    "estado": "BORRADOR",
    "presupuesto_id": 123,
    "requiere_afip": false,
    "serie_interna": "INT",
    "nro_interno": null,
    "emitida_en": "2025-10-12T20:56:42.654Z",
    "created_at": "2025-10-12T20:56:42.654Z",
    "updated_at": "2025-10-12T20:56:42.654Z"
  }
}
```

**Reglas:**
- Se guarda en BD con `estado='BORRADOR'`
- Conversión automática coma→punto en números
- `fecha_emision` es DATE (usa la proporcionada o CURRENT_DATE por defecto)
- Cálculo automático de totales (neto, IVA, total)
- Sin lógica AFIP en esta etapa
- Usa tablas existentes: `factura_facturas`, `factura_factura_items`

## 🔄 Flujo de Facturación

### Factura AFIP

1. **Crear Borrador**: `POST /facturacion/facturas`
   - Estado: `BORRADOR`
   - Se calculan totales automáticamente

2. **Emitir**: `POST /facturacion/facturas/:id/emitir`
   - Obtiene Token de Acceso (WSAA)
   - Consulta último número autorizado
   - Solicita CAE a AFIP (WSFE)
   - Guarda resultado y logs
   - Estado: `APROBADA` o `RECHAZADA`

3. **Generar PDF**: `POST /facturacion/facturas/:id/pdf`
   - Incluye CAE, fecha de vencimiento y código QR

### Factura Interna

1. **Crear Borrador**: `POST /facturacion/facturas`
   - `requiere_afip: false`
   - `serie_interna: "A"` (o la serie deseada)

2. **Emitir**: `POST /facturacion/facturas/:id/emitir`
   - Numera con serie interna
   - Estado: `APROBADA_LOCAL`

3. **Generar PDF**: `POST /facturacion/facturas/:id/pdf`
   - Sin CAE ni código QR

## 🐛 Logs de Depuración

El módulo genera logs detallados en español:

```
[FACTURACION] 🚀 Iniciando servidor en puerto 3004...
[FACTURACION] ✅ Conexión a BD establecida
[FACTURACION-WSAA] 🔑 Obteniendo Token de Acceso...
[FACTURACION-WSAA] ✅ Token válido hasta: 2024-01-15 10:30:00
[FACTURACION-WSFE] 📄 Solicitando CAE para factura ID: 123
[FACTURACION-WSFE] ✅ CAE obtenido: 74123456789012
[FACTURACION-PDF] 📑 Generando PDF para factura ID: 123
```

## 🔒 Seguridad

- ✅ Certificados AFIP en carpeta `certs/` (no commitear)
- ✅ Archivo `.env` en `.gitignore`
- ✅ Validación de datos en todos los endpoints
- ✅ Middleware de autenticación
- ✅ Logs de auditoría en BD

## 🧪 Testing

### Modo Homologación (HOMO)

```bash
# En .env
AFIP_ENV=HOMO
```

Usar datos de prueba de AFIP:
- CUIT: 20123456789
- Certificado de homologación

### Modo Producción (PROD)

```bash
# En .env
AFIP_ENV=PROD
```

⚠️ **IMPORTANTE**: Usar certificados reales y CUIT válido.

## 📝 Formato de Números

- **UI (Frontend)**: Usa comas para decimales (ej: `1.234,56`)
- **Backend/AFIP**: Usa puntos para decimales (ej: `1234.56`)
- **Conversión**: Automática en el backend

## 🕐 Zona Horaria

Todas las fechas y timestamps usan:
- Zona horaria: `America/Argentina/Buenos_Aires`
- Formato BD: `TIMESTAMPTZ`
- Formato AFIP: `YYYYMMDD`

## 🆘 Solución de Problemas

### Error: "Token expirado"
- El token WSAA se renueva automáticamente
- Verificar conectividad con AFIP
- Revisar logs en `factura_afip_wsfe_logs`

### Error: "Certificado inválido"
- Verificar rutas en `.env`
- Verificar formato PEM
- Verificar vigencia del certificado

### Error: "Último comprobante no coincide"
- Ejecutar: `GET /facturacion/afip/ultimo?pto_vta=X&tipo_cbte=Y`
- Sincroniza con AFIP automáticamente

## 📞 Soporte

Para consultas sobre el módulo:
- Revisar logs en consola
- Consultar tabla `factura_afip_wsfe_logs`
- Verificar configuración en `.env`

## 📚 Referencias

- [AFIP Web Services](https://www.afip.gob.ar/ws/)
- [Manual WSFE](https://www.afip.gob.ar/fe/documentos/manual_desarrollador_COMPG_v2_10.pdf)
- [Tipos de Comprobante](https://www.afip.gob.ar/fe/ayuda/tipos-comprobante.asp)

## 🔄 Versión

**v1.0.0** - Módulo inicial con todas las funcionalidades

---

**Sistema LAMDA** - Módulo de Facturación Electrónica
