# 📊 MÓDULO DE PRESUPUESTOS - SISTEMA LAMDA
## Versión 2.0 - Estructura Real Implementada

### 🎯 DESCRIPCIÓN
Módulo completo para la gestión de presupuestos integrado con Google Sheets, diseñado para sincronizar y gestionar presupuestos de clientes con sus respectivos detalles de artículos.

### 🏗️ ARQUITECTURA REAL IMPLEMENTADA

#### 📋 **Estructura de Base de Datos PostgreSQL**

**Tabla: `presupuestos_config`**
```sql
- id (SERIAL PRIMARY KEY)
- hoja_url (TEXT NOT NULL) - URL de Google Sheets
- hoja_id (TEXT NOT NULL) - ID extraído de la URL
- hoja_nombre (TEXT NOT NULL) - Nombre de la pestaña
- rango (TEXT DEFAULT 'A:P') - Rango de datos a sincronizar
- activo (BOOLEAN DEFAULT TRUE) - Estado de la configuración
- usuario_id (INTEGER) - Usuario que configuró
- fecha_creacion (TIMESTAMP DEFAULT NOW())
```

**Tabla: `presupuestos`**
```sql
- id (SERIAL PRIMARY KEY)
- id_presupuesto_ext (TEXT NOT NULL) - ID externo desde Google Sheets
- id_cliente (TEXT NOT NULL) - Identificador del cliente
- fecha (DATE) - Fecha del presupuesto
- fecha_entrega (DATE) - Fecha de entrega estimada
- agente (TEXT) - Agente comercial
- tipo_comprobante (TEXT) - Tipo de comprobante
- nota (TEXT) - Notas adicionales
- estado (TEXT) - Estado: entregado, pendiente, armado, etc.
- informe_generado (TEXT) - Estado del informe
- cliente_nuevo_id (TEXT) - ID de cliente nuevo
- punto_entrega (TEXT) - Punto de entrega
- descuento (NUMERIC(10,2)) - Descuento aplicado
- activo (BOOLEAN DEFAULT TRUE) - Soft delete
- hoja_nombre (TEXT) - Nombre de la hoja origen
- hoja_url (TEXT) - URL de la hoja origen
- usuario_id (INTEGER) - Usuario que sincronizó
```

**Tabla: `presupuestos_detalles`**
```sql
- id (SERIAL PRIMARY KEY)
- id_presupuesto (INTEGER REFERENCES presupuestos(id))
- id_presupuesto_ext (TEXT NOT NULL) - Referencia externa
- articulo (TEXT) - Nombre del artículo
- cantidad (NUMERIC(10,2)) - Cantidad
- valor1 (NUMERIC(10,2)) - Valor 1
- precio1 (NUMERIC(10,2)) - Precio unitario
- iva1 (NUMERIC(10,2)) - IVA aplicado
- diferencia (NUMERIC(10,2)) - Diferencia de precio
- camp1-camp6 (NUMERIC(10,2)) - Campos personalizables
```

**Tabla: `presupuestos_sync_log`**
```sql
- id (SERIAL PRIMARY KEY)
- config_id (INTEGER REFERENCES presupuestos_config(id))
- registros_procesados (INTEGER DEFAULT 0)
- registros_nuevos (INTEGER DEFAULT 0)
- registros_actualizados (INTEGER DEFAULT 0)
- errores (TEXT) - Errores durante sincronización
- fecha_sync (TIMESTAMP DEFAULT NOW())
- duracion_segundos (INTEGER)
- exitoso (BOOLEAN DEFAULT false)
- usuario_id (INTEGER)
- tipo_sync (VARCHAR(20) DEFAULT 'manual')
```

### 🔄 MAPEO DE GOOGLE SHEETS

#### **Estructura Esperada (Columnas A:P)**
```
A: id_presupuesto_ext - ID único del presupuesto
B: id_cliente - Identificador del cliente
C: fecha - Fecha del presupuesto
D: fecha_entrega - Fecha de entrega
E: agente - Agente comercial
F: tipo_comprobante - Tipo de comprobante
G: nota - Notas adicionales
H: estado - Estado del presupuesto
I: informe_generado - Estado del informe
J: cliente_nuevo_id - ID cliente nuevo
K: punto_entrega - Punto de entrega
L: descuento - Descuento aplicado
M: articulo - Nombre del artículo
N: cantidad - Cantidad del artículo
O: precio1 - Precio unitario
P: valor1 - Valor total del artículo
```

### 🚀 ENDPOINTS API DISPONIBLES

#### **📋 Consulta de Presupuestos**
```
GET /api/presupuestos
- Filtros: id_cliente, estado, agente, fecha_desde, fecha_hasta, 
          fecha_entrega_desde, fecha_entrega_hasta, hoja_nombre
- Paginación: limit, offset
- Ordenamiento: order_by, order_dir

GET /api/presupuestos/:id
- Obtiene presupuesto específico con todos sus detalles

GET /api/presupuestos/cliente/:cliente
- Filtra presupuestos por cliente específico

GET /api/presupuestos/estado/:estado
- Filtra presupuestos por estado específico
```

#### **📊 Análisis y Estadísticas**
```
GET /api/presupuestos/estadisticas
- Estadísticas generales del módulo
- Distribución por estados
- Top clientes
- Totales de artículos y valores

GET /api/presupuestos/resumen
- Parámetros: tipo (cliente|estado), fecha_desde, fecha_hasta, estado
- Resúmenes agrupados con totales
```

#### **⚙️ Gestión**
```
PUT /api/presupuestos/:id/estado
- Actualiza estado de presupuesto específico
- Body: { estado, nota }

GET /api/presupuestos/configuracion
- Obtiene configuración actual de Google Sheets
```

#### **🔄 Sincronización con Google Sheets**
```
GET /api/presupuestos/sync/auth/status
- Verifica estado de autenticación con Google

POST /api/presupuestos/sync/auth/iniciar
- Inicia proceso de autenticación OAuth2

POST /api/presupuestos/sync/auth/completar
- Completa autenticación con código de Google
- Body: { code }

POST /api/presupuestos/sync/validar-hoja
- Valida acceso a hoja de Google Sheets
- Body: { hoja_url }

POST /api/presupuestos/sync/configurar
- Configura hoja para sincronización
- Body: { hoja_url, rango, hoja_nombre }

POST /api/presupuestos/sync/ejecutar
- Ejecuta sincronización manual

GET /api/presupuestos/sync/historial
- Obtiene historial de sincronizaciones

GET /api/presupuestos/sync/estado
- Estado general de sincronización
```

#### **🏥 Monitoreo**
```
GET /api/presupuestos/health
- Health check del módulo

GET /health
- Health check del servidor
```

### 🔧 CONFIGURACIÓN Y DESPLIEGUE

#### **Requisitos**
- Node.js v13.14.0+
- PostgreSQL con base de datos 'etiquetas'
- Credenciales de Google Sheets API
- Puerto 3003 disponible

#### **Variables de Entorno**
```bash
PORT=3003
DB_HOST=localhost
DB_PORT=5432
DB_NAME=etiquetas
DB_USER=postgres
DB_PASSWORD=ta3Mionga
```

#### **Instalación**
```bash
# Desde el directorio del proyecto
cd src/presupuestos
npm install

# Ejecutar esquema de base de datos
psql -U postgres -d etiquetas -f sql/schema_real.sql

# Configurar credenciales de Google
cp ../../config/google-credentials.json.example ../../config/google-credentials.json
# Editar con credenciales reales

# Iniciar servidor
npm start
```

### 📁 ESTRUCTURA DE ARCHIVOS

```
src/presupuestos/
├── app.js                           # Servidor principal
├── package.json                     # Dependencias
├── README_REAL.md                   # Esta documentación
├── config/
│   └── database.js                  # Configuración de PostgreSQL
├── controllers/
│   ├── presupuestos_real.js         # Controlador principal (REAL)
│   └── gsheets.js                   # Controlador Google Sheets
├── middleware/
│   ├── auth.js                      # Autenticación y logging
│   └── validation.js                # Validaciones de datos
├── routes/
│   └── presupuestos_real.js         # Rutas API (REAL)
├── sql/
│   └── schema_real.sql              # Esquema de BD real
├── pages/
│   └── presupuestos.html            # Interfaz web
├── js/
│   └── presupuestos.js              # JavaScript frontend
└── css/
    └── presupuestos.css             # Estilos
```

```
src/services/gsheets/
├── auth.js                          # Autenticación OAuth2
├── client.js                        # Cliente Google Sheets API
└── sync_real.js                     # Sincronización (REAL)
```

### 🔍 LOGS Y DEBUGGING

Todos los logs incluyen el prefijo `[PRESUPUESTOS]` con niveles:
- `🔍 [PRESUPUESTOS]` - Información general
- `✅ [PRESUPUESTOS]` - Operaciones exitosas
- `⚠️ [PRESUPUESTOS]` - Advertencias
- `❌ [PRESUPUESTOS]` - Errores
- `📋 [PRESUPUESTOS]` - Datos y configuraciones
- `📊 [PRESUPUESTOS]` - Estadísticas y resúmenes
- `🔄 [PRESUPUESTOS]` - Sincronizaciones

### 🚦 ESTADOS DE PRESUPUESTOS

Estados típicos manejados:
- `pendiente` - Presupuesto pendiente de aprobación
- `armado` - Presupuesto armado/preparado
- `entregado` - Presupuesto entregado al cliente
- `cancelado` - Presupuesto cancelado
- `revision` - En revisión

### 🔐 SEGURIDAD Y PERMISOS

Permisos requeridos:
- `presupuestos.read` - Lectura de presupuestos
- `presupuestos.update` - Actualización de estados
- `presupuestos.sync` - Sincronización con Google Sheets
- `presupuestos.config` - Configuración del módulo

### 📈 RENDIMIENTO

- Paginación obligatoria (máximo 1000 registros por consulta)
- Índices optimizados para filtros frecuentes
- Consultas con parámetros seguros (prevención SQL injection)
- Soft delete para mantener integridad referencial

### 🔄 SINCRONIZACIÓN

**Proceso de Sincronización:**
1. Validación de acceso a Google Sheets
2. Lectura de datos desde rango configurado (A:P)
3. Mapeo a estructura de presupuestos y detalles
4. Upsert en base de datos (insertar nuevos, actualizar existentes)
5. Registro de log de sincronización
6. Reporte de resultados

**Características:**
- Ignora registros ya sincronizados (por id_presupuesto_ext + id_cliente)
- Manejo de transacciones para integridad
- Log detallado de errores y estadísticas
- Soporte para múltiples hojas activas

### 🎯 CASOS DE USO

1. **Sincronización Automática**: Leer presupuestos desde Google Sheets
2. **Consulta Avanzada**: Filtrar presupuestos por múltiples criterios
3. **Gestión de Estados**: Actualizar estados de presupuestos
4. **Análisis de Datos**: Generar estadísticas y resúmenes
5. **Auditoría**: Rastrear cambios y sincronizaciones

### 📞 SOPORTE

Para soporte técnico o consultas sobre la implementación:
- Revisar logs con prefijo `[PRESUPUESTOS]`
- Verificar estado de sincronización en `/api/presupuestos/sync/estado`
- Consultar health check en `/api/presupuestos/health`

---

**Versión:** 2.0.0  
**Fecha:** Diciembre 2024  
**Estado:** Implementación Real Completada ✅
