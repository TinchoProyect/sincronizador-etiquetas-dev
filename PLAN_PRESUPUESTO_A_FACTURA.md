# 📋 Plan: Presupuesto → Factura BORRADOR

## ✅ Respuestas a tus Preguntas

### 1. ALTER TABLE, CHECKS y Triggers
**✅ APROBADO** - Procede con:
- Agregar columnas: `fch_serv_desde`, `fch_serv_hasta`, `fch_vto_pago`
- CHECKS de negocio
- Trigger de recálculo de totales
- Sugerencia: Incluir actualización de `updated_at` en el trigger

### 2. Tablas Identificadas

**Origen (Presupuestos):**
- `presupuestos` (19 columnas)
- `presupuestos_detalles` (16 columnas)
- `clientes` (23 columnas)

**Destino (Facturación):**
- `factura_facturas`
- `factura_factura_items`
- `factura_iva_alicuotas` (ya existe con 3 alícuotas: 21%, 10.5%, 0%)

### 3. Tributación Detallada
**Respuesta:** Dejamos para segunda iteración. Por ahora:
- Solo IVA (ya tenemos `factura_iva_alicuotas`)
- Si necesitamos tributos específicos (percepciones, retenciones), lo agregamos después

---

## 🗺️ Mapeo de Datos

### Presupuesto → Factura (Cabecera)

| Campo Factura | Origen | Lógica |
|---------------|--------|--------|
| `tipo_cbte` | `clientes.condicion_iva` | Mapeo según condición IVA |
| `pto_vta` | Config | Valor fijo (ej: 1) |
| `concepto` | Análisis items | 1=Productos (default) |
| `fecha_emision` | NOW() | Fecha actual |
| `cliente_id` | `presupuestos.id_cliente` | Convertir a INTEGER |
| `doc_tipo` | `clientes.condicion_iva` | 80=CUIT, 96=DNI, 99=CF |
| `doc_nro` | `clientes.cuit` o `clientes.dni` | Según doc_tipo |
| `condicion_iva_id` | `clientes.condicion_iva` | Mapeo a código AFIP |
| `moneda` | 'PES' | Fijo |
| `mon_cotiz` | 1 | Fijo |
| `requiere_afip` | true | Default (configurable) |
| `presupuesto_id` | `presupuestos.id` | Referencia |
| `estado` | 'BORRADOR' | Inicial |
| `fch_serv_desde` | NULL | Solo si concepto=2 o 3 |
| `fch_serv_hasta` | NULL | Solo si concepto=2 o 3 |
| `fch_vto_pago` | NULL | Solo si concepto=2 o 3 |

### Presupuesto Detalle → Factura Items

| Campo Item | Origen | Lógica |
|------------|--------|--------|
| `descripcion` | `presupuestos_detalles.articulo` | Directo |
| `qty` | `presupuestos_detalles.cantidad` | Directo |
| `p_unit` | `presupuestos_detalles.precio1` | Directo |
| `alic_iva_id` | `presupuestos_detalles.iva1` | Mapeo a factura_iva_alicuotas |
| `imp_neto` | Calculado | `qty * p_unit` |
| `imp_iva` | Calculado | `imp_neto * (porcentaje/100)` |
| `orden` | Secuencial | 1, 2, 3... |

---

## 🔄 Mapeos Específicos

### Condición IVA → Tipo Comprobante

```javascript
const MAPEO_TIPO_CBTE = {
    'Responsable Inscripto': 1,      // Factura A
    'Monotributo': 6,                 // Factura B
    'Consumidor Final': 6,            // Factura B
    'Exento': 6,                      // Factura B
    'No Responsable': 6               // Factura B
};
```

### Condición IVA → Código AFIP

```javascript
const MAPEO_CONDICION_IVA = {
    'Responsable Inscripto': 1,
    'Monotributo': 6,
    'Consumidor Final': 5,
    'Exento': 4,
    'No Responsable': 3
};
```

### Condición IVA → Tipo Documento

```javascript
const MAPEO_DOC_TIPO = {
    'Responsable Inscripto': 80,     // CUIT
    'Monotributo': 80,                // CUIT
    'Consumidor Final': 99,           // Sin identificar
    'Exento': 80,                     // CUIT
    'No Responsable': 96              // DNI
};
```

### IVA Presupuesto → Alícuota Factura

```javascript
const MAPEO_IVA = {
    21: 1,    // IVA 21%
    10.5: 2,  // IVA 10.5%
    0: 3      // Exento
};
```

---

## 🛠️ Implementación

### 1. Servicio: `presupuestoFacturaService.js`

**Funciones:**
- `facturarPresupuesto(presupuestoId)` - Crea factura BORRADOR desde presupuesto
- `obtenerDatosPresupuesto(presupuestoId)` - Lee presupuesto + cliente + detalles
- `mapearCabecera(presupuesto, cliente)` - Mapea datos de cabecera
- `mapearItems(detalles)` - Mapea items con cálculos
- `determinarTipoComprobante(condicionIva)` - Lógica de tipo_cbte
- `determinarDocumento(cliente)` - Lógica de doc_tipo/doc_nro

### 2. Validador: `validadorAfipService.js`

**Funciones:**
- `validarFacturaParaAfip(facturaId)` - Valida factura completa
- `validarCabecera(factura)` - Valida campos de cabecera
- `validarItems(items)` - Valida items y totales
- `validarFechasServicio(factura)` - Valida fechas si concepto=2 o 3
- `validarDocumentoReceptor(factura)` - Valida doc_tipo/doc_nro

**Respuesta:**
```javascript
{
    readyForWSFE: true/false,
    faltantes: [
        { campo: 'doc_nro', mensaje: 'Falta número de documento' },
        { campo: 'fch_serv_desde', mensaje: 'Concepto servicios requiere fecha desde' }
    ],
    advertencias: [
        { campo: 'mon_cotiz', mensaje: 'Cotización en 1, verificar si es correcto' }
    ]
}
```

### 3. Endpoints

**POST `/facturacion/presupuestos/:id/facturar`**
- Crea factura BORRADOR desde presupuesto
- Valida automáticamente
- Retorna factura + validación

**GET `/facturacion/facturas/:id/validar-afip`**
- Valida factura existente
- Retorna estado de validación

### 4. UI

**En Presupuestos:**
- Botón "Facturar" → llama POST `/facturacion/presupuestos/:id/facturar`
- Muestra resultado y redirige a factura

**En Factura:**
- Botón "Validar (pre-WSFE)" → llama GET `/facturacion/facturas/:id/validar-afip`
- Muestra faltantes o "✅ Lista para AFIP"

---

## 📝 Reglas de Validación

### Obligatorios para AFIP

✅ **Cabecera:**
- `tipo_cbte` válido (1, 6, 11, etc.)
- `pto_vta` > 0
- `concepto` ∈ {1, 2, 3}
- `fecha_emision` válida
- `doc_tipo` y `doc_nro` (excepto CF)
- `condicion_iva_id` válido
- `moneda` = 'PES'
- `mon_cotiz` = 1
- Totales > 0

✅ **Items:**
- Al menos 1 item
- `qty` > 0
- `p_unit` >= 0
- `alic_iva_id` válido
- Totales calculados correctamente

✅ **Fechas Servicio (si concepto=2 o 3):**
- `fch_serv_desde` NOT NULL
- `fch_serv_hasta` NOT NULL
- `fch_vto_pago` NOT NULL
- `fch_serv_desde` <= `fch_serv_hasta`

---

## 🧪 Plan de Prueba

### Caso 1: Presupuesto con IVA mixto
- Cliente: Responsable Inscripto
- Items: 2 con IVA 21%, 1 con IVA 10.5%, 1 exento
- Esperado: Factura A (tipo_cbte=1) con totales correctos

### Caso 2: Consumidor Final
- Cliente: Consumidor Final
- Items: 3 con IVA 21%
- Esperado: Factura B (tipo_cbte=6), doc_tipo=99, doc_nro='0'

### Caso 3: Validación
- Factura BORRADOR completa
- Esperado: `readyForWSFE: true`, sin faltantes

---

## 📦 Entregables

1. ✅ `src/facturacion/services/presupuestoFacturaService.js`
2. ✅ `src/facturacion/services/validadorAfipService.js`
3. ✅ Actualizar `src/facturacion/controllers/facturas.js` (nuevos endpoints)
4. ✅ Actualizar `src/facturacion/routes/facturas.js` (nuevas rutas)
5. ✅ UI: Botón "Facturar" en presupuestos
6. ✅ UI: Botón "Validar" en facturas
7. ✅ Documentación de uso

---

## 🚀 Próximos Pasos (Fuera de este ciclo)

- Emisión CAE (WSFE HOMO)
- Manejo de Notas de Crédito/Débito
- Tributos detallados
- Facturación masiva
- Reportes

---

**Estado:** Listo para implementar
**Fecha:** 2025-10-16
