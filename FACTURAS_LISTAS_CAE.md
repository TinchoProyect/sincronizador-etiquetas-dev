# Facturas Listas para Solicitar CAE

## 📋 Mejoras Implementadas

Se modificó el servicio de conversión de Presupuesto → Factura para que deje el registro completamente listo para solicitar CAE a AFIP, cumpliendo con todos los requisitos de WSFE/ARCA.

## 🔧 Cambios en `presupuestoFacturaService.js`

### 1. **Importaciones Agregadas**
```javascript
const { PTO_VTA, ENTORNO } = require('../config/afip');
const { nextAfip } = require('./numeroService');
```

### 2. **Punto de Venta 32**
- ✅ Usa `PTO_VTA` desde configuración (valor: 32)
- ✅ Mantiene continuidad de numeración

### 3. **Número NO se Asigna al Crear**
```javascript
// cbte_nro queda en NULL al crear la factura
// El número se asignará al momento de obtener el CAE
```
- ✅ Factura BORRADOR sin número
- ✅ Evita quemar números si falla el CAE
- ✅ Flujo estándar recomendado por AFIP

### 4. **Validación de Datos Obligatorios**

#### Receptor:
```javascript
if (!docTipo || !docNro || docNro === '0') {
    throw new Error('Cliente sin documento válido. CUIT/CUIL/DNI requerido');
}

if (!condicionIvaId) {
    throw new Error('Condición IVA inválida para el cliente');
}
```

#### Totales:
```javascript
if (totales.imp_total <= 0) {
    throw new Error('El importe total debe ser mayor a cero');
}

if (Math.abs((totales.imp_neto + totales.imp_iva + totales.imp_trib) - totales.imp_total) > 0.01) {
    throw new Error('Los totales no son coherentes');
}
```

### 5. **Campos Completados Correctamente**

#### Campos Obligatorios AFIP:
- ✅ `tipo_cbte`: Tipo de comprobante (6=Factura B, 11=Factura C)
- ✅ `pto_vta`: Punto de venta (32)
- ✅ `cbte_nro`: Número correlativo del comprobante
- ✅ `concepto`: 1=Productos (default para presupuestos)
- ✅ `fecha_emision`: Fecha válida formato YYYY-MM-DD
- ✅ `doc_tipo`: Tipo documento receptor (80=CUIT, 96=DNI, 99=Consumidor Final)
- ✅ `doc_nro`: Número documento receptor (validado)
- ✅ `condicion_iva_id`: Condición IVA del receptor
- ✅ `moneda`: 'PES' (Pesos)
- ✅ `mon_cotiz`: 1.0000 (siempre 1 para pesos)
- ✅ `imp_neto`: Importe neto gravado
- ✅ `imp_iva`: IVA discriminado
- ✅ `imp_trib`: Tributos (0 por ahora)
- ✅ `imp_total`: Total coherente (neto + IVA + tributos)

#### Fechas de Servicio (solo si concepto = 2 o 3):
- ✅ `fch_serv_desde`: Fecha inicio servicio
- ✅ `fch_serv_hasta`: Fecha fin servicio
- ✅ `fch_vto_pago`: Fecha vencimiento pago

Para concepto 1 (Productos), estos campos quedan en NULL como corresponde.

### 6. **Campo Descuento**
```javascript
descuento: descuentoFraccional
```
- ✅ Se guarda el descuento del presupuesto (valor fraccional)
- ✅ El descuento ya está aplicado en los importes de items

## 📊 Campos de la Tabla `factura_facturas`

### Completados al crear desde Presupuesto:
| Campo | Tipo | Obligatorio | Fuente |
|-------|------|-------------|--------|
| tipo_cbte | smallint | ✅ | Según condición IVA cliente |
| pto_vta | integer | ✅ | Configuración (32) |
| cbte_nro | integer | NULL | Se asigna al obtener CAE |
| concepto | smallint | ✅ | 1=Productos (default) |
| fecha_emision | date | ✅ | fechaActual() |
| cliente_id | integer | ✅ | ID del cliente |
| doc_tipo | smallint | ✅ | Validado desde cliente |
| doc_nro | varchar(20) | ✅ | Validado desde cliente |
| condicion_iva_id | smallint | ✅ | Mapeado desde cliente |
| moneda | char(3) | ✅ | 'PES' |
| mon_cotiz | numeric(10,4) | ✅ | 1.0000 |
| imp_neto | numeric(14,2) | ✅ | Calculado |
| imp_iva | numeric(14,2) | ✅ | Calculado |
| imp_trib | numeric(14,2) | ✅ | 0 |
| imp_total | numeric(14,2) | ✅ | Validado coherente |
| requiere_afip | boolean | ✅ | true |
| presupuesto_id | integer | ✅ | ID presupuesto origen |
| estado | varchar(20) | ✅ | 'BORRADOR' |
| descuento | numeric(10,4) | ✅ | Del presupuesto |
| emitida_en | timestamptz | ✅ | NOW() |
| created_at | timestamptz | ✅ | NOW() |
| updated_at | timestamptz | ✅ | NOW() |

### Completados solo para CAE:
| Campo | Tipo | Se completa en |
|-------|------|----------------|
| cae | varchar(14) | Al obtener CAE |
| cae_vto | date | Al obtener CAE |
| resultado | char(1) | Al obtener CAE |
| estado | varchar(20) | Cambia a 'APROBADA' |

### NULL hasta obtener CAE:
- `fch_serv_desde`, `fch_serv_hasta`, `fch_vto_pago`: Solo si concepto != 1
- `serie_interna`, `nro_interno`: Solo para facturas sin AFIP

## 🎯 Flujo Completo (Estándar AFIP)

1. **Convertir Presupuesto → Factura BORRADOR**
   - ✅ Valida cliente con documento
   - ✅ Asigna PV=32 (sin número todavía)
   - ✅ Completa todos campos obligatorios
   - ✅ Valida totales coherentes
   - ✅ cbte_nro = NULL
   - ✅ Estado: 'BORRADOR'
   - 💡 Factura lista para CAE, pero SIN número

2. **Solicitar CAE** (operación atómica)
   a) Consultar último autorizado en AFIP
   b) Calcular siguiente = último + 1
   c) Actualizar numeración local
   d) Solicitar CAE a AFIP con ese número
   e) Si éxito: Guardar número + CAE juntos
   f) Si falla: Rollback, número no se quema
   g) Cambiar estado a 'APROBADA'
   
   **Ventajas de este flujo:**
   - 🔒 Número y CAE se asignan juntos (transacción atómica)
   - 📊 Sin huecos en numeración si falla
   - 🔄 Reintentable sin problemas
   - ✅ Estándar oficial de AFIP

## ✅ Verificación

Para verificar que una factura BORRADOR está lista para solicitar CAE:

```sql
SELECT 
    id,
    tipo_cbte,
    pto_vta,
    cbte_nro,
    fecha_emision,
    doc_tipo,
    doc_nro,
    moneda,
    mon_cotiz,
    imp_neto,
    imp_iva,
    imp_total,
    estado,
    CASE 
        WHEN cbte_nro IS NOT NULL THEN '⚠️ Ya tiene número (revisar flujo)'
        WHEN doc_tipo IS NULL OR doc_nro IS NULL THEN '❌ Falta documento receptor'
        WHEN imp_total <= 0 THEN '❌ Total inválido'
        WHEN ABS((imp_neto + imp_iva + imp_trib) - imp_total) > 0.01 THEN '❌ Totales incoherentes'
        ELSE '✅ Lista para CAE'
    END as validacion
FROM factura_facturas
WHERE estado = 'BORRADOR'
ORDER BY id DESC;
```

**Nota:** Las facturas BORRADOR correctas deben tener `cbte_nro = NULL`. El número se asigna al obtener el CAE.

## 📝 Notas Importantes

1. **No persistir valores nulos en campos obligatorios**: Todos los campos requeridos por AFIP tienen valores válidos (excepto cbte_nro que se asigna al emitir)

2. **No persistir "Invalid date"**: Se usa `fechaActual()` que devuelve formato YYYY-MM-DD válido

3. **Número al emitir (NO al crear)**: El número se asigna en la transacción atómica junto con el CAE. Esto garantiza:
   - Sin huecos si falla el CAE
   - Numeración continua perfecta
   - Cumplimiento del estándar AFIP
   - Operación reintentable

4. **Totales coherentes**: Se valida que neto + IVA + tributos = total (con tolerancia de $0.01)

5. **Descuento aplicado**: El descuento del presupuesto ya está aplicado en los importes de items

## 🔄 Flujo de Usuario

**Lo que ve el usuario:**

1. **Crear factura desde presupuesto:**
   - Sistema: "Factura BORRADOR #62 creada"
   - Pantalla muestra: "Sin número asignado"
   - Estado: BORRADOR

2. **Click en "Obtener CAE":**
   - Sistema consulta AFIP
   - AFIP asigna número y devuelve CAE
   - Pantalla muestra: "CAE obtenido - Factura 00032-00000015"
   - Estado: APROBADA

**Es transparente y profesional.**

## 🎯 Ventajas de este Flujo

### Para Homologación:
- ✅ Puedes reintentar sin quemar números
- ✅ Numeración perfecta para pruebas

### Para Producción:
- ✅ Numeración continua garantizada
- ✅ Sin huecos por errores
- ✅ Cumple estándar AFIP/ARCA
- ✅ Robusto ante fallos de red
- ✅ Transacciones atómicas

---

**Fecha de implementación**: 22 de octubre de 2025
**Flujo**: Estándar AFIP - Número al emitir (NO al crear)
