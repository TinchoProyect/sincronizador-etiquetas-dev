# Integración con Módulo de Presupuestos

## 🎯 Objetivo

Integración estricta y controlada entre el módulo de Presupuestos y el módulo de Facturación, garantizando que solo presupuestos nuevos (post-hito) utilicen el nuevo facturador.

---

## 📋 Reglas de Integración

### 1. Fecha Hito: **2025-10-12**

- ✅ **Presupuestos >= 2025-10-12**: Usan facturador nuevo
- ❌ **Presupuestos < 2025-10-12**: Rechazados (usar sistema legado)

### 2. Flag Obligatorio

Todos los requests deben incluir:
```json
{
  "usar_facturador_nuevo": true
}
```

Si falta o es `false` → **400 Bad Request**

### 3. Idempotencia por presupuesto_id

- Si ya existe una factura para un `presupuesto_id` en estado `BORRADOR`, `APROBADA` o `APROBADA_LOCAL`
- No se crea otra factura
- Se devuelve la existente con **409 Conflict**

---

## 🔌 Contrato de API

### Endpoint

```
POST /facturacion/facturas
Content-Type: application/json
```

### Request Body Completo

```json
{
  "usar_facturador_nuevo": true,
  "fecha_presupuesto": "2025-10-12",
  "presupuesto_id": 123,
  "usuario_id": 456,
  
  "tipo_cbte": 6,
  "pto_vta": 32,
  "concepto": 1,
  "fecha_emision": "2025-10-12",
  
  "cliente": {
    "cliente_id": 45,
    "razon_social": "Consumidor Final",
    "doc_tipo": 99,
    "doc_nro": "0",
    "condicion_iva_id": 5
  },
  
  "precio_modo": "NETO",
  "moneda": "PES",
  "mon_cotiz": 1,
  
  "items": [
    {
      "descripcion": "Item X",
      "qty": 1,
      "p_unit": 1000.00,
      "alic_iva_id": 5
    }
  ],
  
  "requiere_afip": false,
  "serie_interna": "INT"
}
```

### Campos Obligatorios

| Campo | Tipo | Descripción | Validación |
|-------|------|-------------|------------|
| `usar_facturador_nuevo` | boolean | Flag de nuevo facturador | Debe ser `true` |
| `fecha_presupuesto` | string | Fecha del presupuesto | >= "2025-10-12" |
| `presupuesto_id` | integer | ID del presupuesto | Requerido |
| `cliente` | object | Datos del cliente | Ver estructura abajo |
| `precio_modo` | string | Modo de precio | "NETO" o "FINAL_CON_IVA" |
| `items` | array | Items de la factura | Mínimo 1 item |

### Estructura de `cliente`

```json
{
  "cliente_id": 45,
  "razon_social": "Consumidor Final",
  "doc_tipo": 99,
  "doc_nro": "0",
  "condicion_iva_id": 5
}
```

Todos los campos son **obligatorios**.

---

## 💰 Modos de Precio

### Modo NETO

El precio unitario (`p_unit`) **NO incluye IVA**.

**Ejemplo:**
```json
{
  "precio_modo": "NETO",
  "items": [
    {
      "descripcion": "Producto A",
      "qty": 2,
      "p_unit": 1000.00,
      "alic_iva_id": 5
    }
  ]
}
```

**Cálculo:**
- Neto: 2 × 1000 = 2000.00
- IVA 21%: 2000 × 0.21 = 420.00
- **Total: 2420.00**

### Modo FINAL_CON_IVA

El precio unitario (`p_unit`) **INCLUYE IVA**.

**Ejemplo:**
```json
{
  "precio_modo": "FINAL_CON_IVA",
  "items": [
    {
      "descripcion": "Producto B",
      "qty": 2,
      "p_unit": 1210.00,
      "alic_iva_id": 5
    }
  ]
}
```

**Cálculo (desglose):**
- Precio final: 2 × 1210 = 2420.00
- Divisor: 1 + 0.21 = 1.21
- Neto: 2420 / 1.21 = 2000.00
- IVA: 2420 - 2000 = 420.00
- **Total: 2420.00**

---

## 📤 Respuestas

### 201 Created - Factura Nueva

```json
{
  "success": true,
  "message": "Borrador de factura creado exitosamente",
  "data": {
    "id": 123,
    "estado": "BORRADOR",
    "tipo_cbte": 6,
    "pto_vta": 32,
    "presupuesto_id": 200,
    "cliente_id": 45,
    "imp_neto": "2000.00",
    "imp_iva": "420.00",
    "imp_total": "2420.00",
    "requiere_afip": false,
    "serie_interna": "INT",
    "created_at": "2025-10-12T20:56:42.654Z"
  }
}
```

### 409 Conflict - Idempotencia

```json
{
  "success": true,
  "idempotente": true,
  "message": "Factura ya existe para este presupuesto",
  "data": {
    "id": 120,
    "estado": "BORRADOR",
    "presupuesto_id": 200,
    "imp_total": "2420.00",
    "created_at": "2025-10-12T18:30:00.000Z"
  }
}
```

### 400 Bad Request - Validación Fallida

#### Falta `usar_facturador_nuevo`

```json
{
  "success": false,
  "error": "Facturador nuevo requerido",
  "message": "Este endpoint solo acepta presupuestos marcados con usar_facturador_nuevo: true",
  "campo_faltante": "usar_facturador_nuevo"
}
```

#### Fecha anterior al hito

```json
{
  "success": false,
  "error": "Presupuesto legado rechazado",
  "message": "Solo se aceptan presupuestos con fecha >= 2025-10-12. Presupuestos anteriores deben usar el sistema legado.",
  "fecha_recibida": "2025-10-10",
  "fecha_minima": "2025-10-12"
}
```

#### Falta `presupuesto_id`

```json
{
  "success": false,
  "error": "ID de presupuesto requerido",
  "message": "Debe proporcionar presupuesto_id",
  "campo_faltante": "presupuesto_id"
}
```

#### Datos de cliente incompletos

```json
{
  "success": false,
  "error": "Datos de cliente incompletos",
  "message": "Faltan campos requeridos en objeto cliente",
  "campos_faltantes": ["doc_tipo", "doc_nro"]
}
```

#### `precio_modo` inválido

```json
{
  "success": false,
  "error": "Modo de precio inválido",
  "message": "precio_modo debe ser \"NETO\" o \"FINAL_CON_IVA\"",
  "valor_recibido": "INVALIDO",
  "valores_validos": ["NETO", "FINAL_CON_IVA"]
}
```

---

## 🧪 Ejemplos de Uso

### Ejemplo 1: Crear Factura con Precio NETO

```powershell
$body = Get-Content test-factura-neto.json -Raw
Invoke-WebRequest -Uri http://localhost:3004/facturacion/facturas `
  -Method POST -Body $body -ContentType "application/json"
```

**Resultado esperado:** 201 Created

### Ejemplo 2: Crear Factura con Precio FINAL_CON_IVA

```powershell
$body = Get-Content test-factura-final-con-iva.json -Raw
Invoke-WebRequest -Uri http://localhost:3004/facturacion/facturas `
  -Method POST -Body $body -ContentType "application/json"
```

**Resultado esperado:** 201 Created

### Ejemplo 3: Intentar Duplicar (Idempotencia)

```powershell
# Primera vez
$body = Get-Content test-factura-neto.json -Raw
Invoke-WebRequest -Uri http://localhost:3004/facturacion/facturas `
  -Method POST -Body $body -ContentType "application/json"
# → 201 Created

# Segunda vez (mismo presupuesto_id)
Invoke-WebRequest -Uri http://localhost:3004/facturacion/facturas `
  -Method POST -Body $body -ContentType "application/json"
# → 409 Conflict (devuelve factura existente)
```

### Ejemplo 4: Presupuesto Legado (Rechazado)

```json
{
  "usar_facturador_nuevo": true,
  "fecha_presupuesto": "2025-10-10",
  "presupuesto_id": 100,
  ...
}
```

**Resultado esperado:** 400 Bad Request
```json
{
  "error": "Presupuesto legado rechazado",
  "fecha_recibida": "2025-10-10",
  "fecha_minima": "2025-10-12"
}
```

---

## 🔒 Seguridad

### CORS

El módulo de facturación acepta requests de:
- `http://localhost:3000` (etiquetas)
- `http://localhost:3002` (producción)
- `http://localhost:3003` (presupuestos)
- `http://localhost:3004` (facturación)

### Validación Estricta

Todos los campos son validados antes de procesar:
1. Tipos de datos correctos
2. Rangos válidos
3. Referencias a catálogos (IVA, documentos, etc.)
4. Lógica de negocio (fechas, totales, etc.)

---

## 📊 Flujo de Integración

```
┌─────────────────┐
│   Presupuestos  │
│   (Puerto 3003) │
└────────┬────────┘
         │
         │ Usuario hace clic "Facturar"
         │
         ▼
┌─────────────────────────────────────┐
│ Validar:                            │
│ - fecha_presupuesto >= 2025-10-12   │
│ - usar_facturador_nuevo = true      │
└────────┬────────────────────────────┘
         │
         │ POST /facturacion/facturas
         │
         ▼
┌─────────────────┐
│  Facturación    │
│  (Puerto 3004)  │
└────────┬────────┘
         │
         ├─→ Validar campos obligatorios
         │
         ├─→ Verificar idempotencia
         │   (presupuesto_id)
         │
         ├─→ Procesar precio_modo
         │   (NETO o FINAL_CON_IVA)
         │
         ├─→ Calcular totales
         │
         ├─→ Guardar en BD
         │
         ▼
┌─────────────────┐
│   Respuesta     │
│ 201 / 409 / 400 │
└─────────────────┘
```

---

## 🐛 Troubleshooting

### Error: "usar_facturador_nuevo no es true"

**Causa:** El campo falta o tiene valor `false`

**Solución:** Asegurar que el request incluya:
```json
{
  "usar_facturador_nuevo": true
}
```

### Error: "Presupuesto legado rechazado"

**Causa:** `fecha_presupuesto` es anterior a 2025-10-12

**Solución:** Usar el sistema legado para presupuestos antiguos

### Error: "Factura ya existe para este presupuesto"

**Causa:** Ya existe una factura para ese `presupuesto_id`

**Solución:** Esto es correcto (idempotencia). Usar la factura existente devuelta en la respuesta 409.

### Error: "Datos de cliente incompletos"

**Causa:** Faltan campos en el objeto `cliente`

**Solución:** Incluir todos los campos obligatorios:
- `cliente_id`
- `razon_social`
- `doc_tipo`
- `doc_nro`
- `condicion_iva_id`

---

## 📚 Referencias

- [README Principal](./README.md)
- [Estructura del Módulo](./ESTRUCTURA.md)
- [Testing Paso 1.1](./TESTING_PASO1.1.md)

---

**Sistema LAMDA** - Integración Presupuestos → Facturación
