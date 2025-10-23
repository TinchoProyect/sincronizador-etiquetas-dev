# Estructura del Módulo de Facturación

```
src/facturacion/
├── app.js                          # Servidor principal (puerto 3004)
├── package.json                    # Dependencias del módulo
├── .env.example                    # Plantilla de variables de entorno
├── .gitignore                      # Archivos a ignorar en git
├── README.md                       # Documentación principal
├── ESTRUCTURA.md                   # Este archivo
│
├── config/                         # Configuraciones
│   ├── database.js                 # Conexión PostgreSQL
│   ├── afip.js                     # Configuración AFIP (URLs, certificados)
│   └── timezone.js                 # Zona horaria Argentina
│
├── routes/                         # Rutas HTTP
│   └── facturas.js                 # Rutas del módulo
│
├── controllers/                    # Controladores HTTP
│   ├── facturas.js                 # CRUD de facturas
│   └── afip.js                     # Operaciones AFIP
│
├── services/                       # Lógica de negocio
│   ├── wsaaService.js              # Autenticación AFIP (WSAA)
│   ├── wsfeService.js              # Facturación electrónica (WSFE)
│   ├── facturaService.js           # Lógica de facturas
│   └── numeroService.js            # Numeración (AFIP e interna)
│
├── mappers/                        # Transformación de datos
│   └── wsfeMapper.js               # Construcción de payloads SOAP
│
├── utils/                          # Utilidades
│   ├── decimales.js                # Conversión coma/punto
│   ├── validaciones.js             # Validaciones de negocio
│   └── soap.js                     # Helpers SOAP/XML
│
├── middleware/                     # Middleware Express
│   ├── auth.js                     # Autenticación y logging
│   └── validation.js               # Validación de requests
│
├── pdf/                            # Generación de PDF
│   └── generador.js                # Generador de PDF con CAE/QR
│
└── certs/                          # Certificados AFIP
    └── README.md                   # Instrucciones de certificados
```

## 📊 Tablas de Base de Datos (ya creadas)

- `factura_facturas` - Cabecera de facturas
- `factura_factura_items` - Líneas de facturas
- `factura_afip_ta` - Cache de tokens WSAA
- `factura_afip_wsfe_logs` - Logs de operaciones WSFE
- `factura_numeracion_afip` - Numeración AFIP
- `factura_numeracion_interna` - Numeración interna

## 🔄 Flujo de Datos

### Crear Factura
```
Request → routes/facturas.js
       → middleware/validation.js (validar)
       → controllers/facturas.js (crearFactura)
       → services/facturaService.js (crearBorrador)
       → utils/decimales.js (calcular totales)
       → config/database.js (guardar en BD)
       → Response
```

### Emitir Factura AFIP
```
Request → routes/facturas.js
       → controllers/facturas.js (emitirFactura)
       → services/facturaService.js (emitir)
       → services/numeroService.js (nextAfip)
       → services/wsaaService.js (getTA)
       → services/wsfeService.js (solicitarCAE)
       → mappers/wsfeMapper.js (construir payload)
       → utils/soap.js (construir SOAP)
       → AFIP WSFE
       → config/database.js (actualizar factura)
       → Response
```

### Emitir Factura Interna
```
Request → routes/facturas.js
       → controllers/facturas.js (emitirFactura)
       → services/facturaService.js (emitir)
       → services/numeroService.js (nextInterno)
       → config/database.js (actualizar factura)
       → Response
```

### Generar PDF
```
Request → routes/facturas.js
       → controllers/facturas.js (generarPDF)
       → pdf/generador.js (generarPDF)
       → utils/decimales.js (formatear montos)
       → config/timezone.js (formatear fechas)
       → Response (PDF Buffer)
```

## 🔑 Variables de Entorno Requeridas

Ver `.env.example` para la lista completa.

Principales:
- `PORT` - Puerto del servidor (3004)
- `AFIP_ENV` - Entorno AFIP (HOMO/PROD)
- `AFIP_CUIT` - CUIT de la empresa
- `CERT_PATH_HOMO` - Ruta certificado homologación
- `KEY_PATH_HOMO` - Ruta clave homologación
- `DB_*` - Configuración PostgreSQL

## 📝 Estado Actual (Paso 1)

✅ Estructura completa creada
✅ Configuraciones implementadas
✅ Utilidades implementadas
✅ Servicios con stubs funcionales
✅ Controladores con logs
✅ Rutas configuradas
✅ Middleware implementado
✅ Servidor principal listo
✅ Documentación completa

⚠️ Pendiente para Paso 2:
- Implementación completa de WSAA (firma de certificados)
- Implementación completa de WSFE (requests SOAP reales)
- Generación completa de PDF
- Tests de integración

## 🚀 Cómo Ejecutar

```bash
# Instalar dependencias
cd src/facturacion
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con valores reales

# Iniciar servidor
npm start

# O desde la raíz del proyecto
npm run facturacion
```

## 📚 Próximos Pasos

1. Implementar firma real de certificados en WSAA
2. Implementar requests SOAP reales a AFIP
3. Completar generación de PDF con QR
4. Agregar frontend para gestión de facturas
5. Implementar tests unitarios e integración
6. Agregar validación de CUIT contra padrón AFIP
7. Implementar anulación de comprobantes
8. Agregar reportes y estadísticas
