# API de Escritura a Google Sheets - Presupuestos

## Resumen

**Fase 2 completada** - Endpoints y controladores para escritura bidireccional a Google Sheets con flujo en dos fases, atomicidad, rollback e idempotencia.

## Endpoints Implementados

### 🆕 POST /api/presupuestos
**Crear presupuesto con encabezado + detalles**

**Headers requeridos:**
```
Content-Type: application/json
Idempotency-Key: uuid-unico-por-operacion
Authorization: Bearer <token>
```

**Body esperado:**
```json
{
  "id_cliente": "123",
  "fecha": "2024-12-19",
  "fecha_entrega": "2024-12-25",
  "agente": "Juan Pérez",
  "tipo_comprobante": "PRESUPUESTO",
  "nota": "Presupuesto para cliente especial",
  "punto_entrega": "Sucursal Centro",
  "descuento": 10.50,
  "detalles": [
    {
      "articulo": "ART001",
      "cantidad": 2,
      "valor1": 100.00,
      "precio1": 121.00,
      "iva1": 21.00,
      "diferencia": 0,
      "camp1": 0,
      "camp2": 0,
      "camp3": 0,
      "camp4": 0,
      "camp5": 0,
      "camp6": 0
    }
  ]
}
```

**Respuesta exitosa (201):**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "id_presupuesto": "P-01234567-89ab-7cde-f012-345678901234",
    "estado": "CONFIRMADO",
    "detalles_count": 1,
    "created_at": "2024-12-19T10:30:00.000Z"
  },
  "message": "Presupuesto creado exitosamente en Google Sheets",
  "requestId": "REQ-1703001000-abc12",
  "idempotencyKey": "uuid-unico-por-operacion",
  "timestamp": "2024-12-19T10:30:00.000Z"
}
```

### 🔄 PUT /api/presupuestos/:id
**Editar presupuesto existente (solo datos permitidos)**

**Campos editables:**
- `agente`
- `nota` 
- `punto_entrega`
- `descuento`
- `fecha_entrega`

**Body ejemplo:**
```json
{
  "agente": "María García",
  "nota": "Nota actualizada",
  "descuento": 15.00
}
```

### 🗑️ DELETE /api/presupuestos/:id
**Eliminar presupuesto (baja lógica)**

Marca el presupuesto como `activo=false` y `estado='ANULADO'` tanto en BD como en Sheets.

### 🔄 POST /api/presupuestos/:id/retry
**Reintentar operación con idempotencia**

**Headers requeridos:**
```
Idempotency-Key: mismo-uuid-de-operacion-original
```

Útil para recuperar presupuestos en estado `ERROR` o `PENDIENTE`.

### 📊 GET /api/presupuestos/:id/status
**Obtener estado de presupuesto**

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "id_presupuesto": "P-01234567-89ab-7cde-f012-345678901234",
    "estado": "CONFIRMADO",
    "error_motivo": null,
    "detalles_count": 1,
    "fecha_actualizacion": "2024-12-19T10:30:00.000Z",
    "activo": true
  }
}
```

## Flujo en Dos Fases

### Fase 1: Registro en BD como PENDIENTE
1. Generar IDs UUIDv7 con prefijos (`P-` para presupuestos, `D-` para detalles)
2. Normalizar fechas a formato `YYYY-MM-DD`
3. Normalizar números con 2 decimales
4. Insertar encabezado y detalles en BD con `estado='PENDIENTE'`

### Fase 2: Escritura a Google Sheets
1. Escribir encabezado a hoja "Presupuestos" (columnas A:M)
2. Escribir detalles a hoja "PresupuestosDetalles" (columnas A:N)
3. Actualizar estado a `'CONFIRMADO'` en Sheets y BD

### Rollback en caso de error
- Si falla Fase 2: remover encabezado de Sheets o marcar como `'ERROR'`
- Actualizar BD con `estado='ERROR'` y `error_motivo`
- Logs detallados para debugging

## Mapeo de Columnas

### Hoja "Presupuestos" (A:M)
```
A: IDPresupuesto (P-{UUIDv7})
B: Fecha (YYYY-MM-DD)
C: IDCliente
D: Agente
E: Factura/Efectivo (tipo_comprobante)
F: Estado
G: InformeGenerado
H: ClienteNuevoID
I: PuntoEntrega
J: Descuento (número con 2 decimales)
K: FechaEntrega (YYYY-MM-DD)
L: Nota
M: Campo13 (reservado)
```

### Hoja "PresupuestosDetalles" (A:N)
```
A: IDDetallePresupuesto (D-{UUIDv7})
B: IdPresupuesto (P-{UUIDv7})
C: Articulo
D: Cantidad
E: Valor1 (neto unitario)
F: Precio1 (total unitario con IVA)
G: IVA1 (IVA unitario)
H: Diferencia
I: Camp1
J: Camp2
K: Camp3
L: Camp4
M: Camp5
N: Camp6
```

## Idempotencia

**Header obligatorio para operaciones de escritura:**
```
Idempotency-Key: <uuid-unico>
```

- Cache en memoria con TTL configurable (default: 1 hora)
- Previene duplicados en caso de reintentos
- Permite recuperación segura de operaciones fallidas

## Estados de Presupuesto

- `PENDIENTE`: Registrado en BD, pendiente de escritura a Sheets
- `CONFIRMADO`: Completamente sincronizado en BD y Sheets  
- `ERROR`: Falló la escritura a Sheets, requiere reintento
- `ANULADO`: Eliminado lógicamente

## Variables de Entorno Requeridas

```env
SPREADSHEET_ID=1abc123def456ghi789jkl
SPREADSHEET_URL=https://docs.google.com/spreadsheets/d/1abc123def456ghi789jkl
GOOGLE_SERVICE_ACCOUNT_KEY=path/to/service-account.json
```

## Logs de Debugging

Cada operación incluye logs mínimos obligatorios:
- Inicio/fin de cada fase con requestId
- IDs generados (presupuesto y detalles)
- Idempotency-Key utilizada
- Mapeo de columnas aplicado
- Resultado de cada operación a Sheets
- Motivo de error y rollback (si aplica)

## Ejemplo de Uso Completo

```bash
# 1. Crear presupuesto
curl -X POST http://localhost:3000/api/presupuestos \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "id_cliente": "123",
    "fecha": "2024-12-19",
    "agente": "Juan Pérez",
    "tipo_comprobante": "PRESUPUESTO",
    "detalles": [
      {
        "articulo": "ART001",
        "cantidad": 2,
        "valor1": 100.00,
        "precio1": 121.00,
        "iva1": 21.00
      }
    ]
  }'

# 2. Verificar estado
curl http://localhost:3000/api/presupuestos/P-01234567-89ab-7cde-f012-345678901234/status

# 3. Editar (solo campos permitidos)
curl -X PUT http://localhost:3000/api/presupuestos/P-01234567-89ab-7cde-f012-345678901234 \
  -H "Content-Type: application/json" \
  -d '{"agente": "María García", "descuento": 15.00}'

# 4. Reintentar si hay error
curl -X POST http://localhost:3000/api/presupuestos/P-01234567-89ab-7cde-f012-345678901234/retry \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000"

# 5. Eliminar (baja lógica)
curl -X DELETE http://localhost:3000/api/presupuestos/P-01234567-89ab-7cde-f012-345678901234
```

## Próximos Pasos - Fase 3

- Interfaz de usuario para crear/editar presupuestos
- Formularios con validación en tiempo real
- Visualización de estados y progreso
- Manejo de errores en UI
- Integración con sistema de autenticación

---

**Fase 2 completada exitosamente** ✅
- Endpoints funcionales con flujo en dos fases
- Atomicidad y rollback implementados
- Idempotencia configurada
- IDs UUIDv7 con prefijos
- Normalización de datos
- Logs de debugging completos
