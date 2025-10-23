# Implementación de Múltiples Alícuotas de IVA

**Fecha:** 20/01/2025  
**Estado:** ✅ Completado  
**Objetivo:** Manejo correcto y consistente de múltiples alícuotas de IVA (21%, 10.5%, 0%) en UI, PDF y envío a AFIP/ARCA (WSFE)

---

## 📋 Resumen Ejecutivo

Se ha implementado un sistema completo para el manejo de múltiples alícuotas de IVA que asegura **sincronía total** entre lo que se muestra (UI y PDF) y lo que se envía a AFIP. El sistema ahora:

1. ✅ Aplica descuentos del presupuesto sobre la base imponible (antes del IVA)
2. ✅ Agrupa correctamente las alícuotas de IVA para el envío a WSFE
3. ✅ Discrimina el IVA por tasa en UI y PDF
4. ✅ Separa bases gravadas de bases exentas en WSFE
5. ✅ Muestra el descuento de forma clara y separada en UI y PDF
6. ✅ Mantiene consistencia total entre todos los componentes

---

## 🎯 Cambios Implementados

### 1. Servicio de Conversión Presupuesto → Factura
**Archivo:** `src/facturacion/services/presupuestoFacturaService.js`

#### Cambios realizados:
- Modificada la función `mapearItems()` para:
  - **Aplicar descuento del presupuesto** (`presupuestos.descuento`) sobre la base imponible
  - Usar `valor1` (precio sin IVA) y `camp2` (factor IVA) como fuente de datos correcta
  - Calcular el IVA sobre el neto **ya descontado**

#### Fórmula de cálculo:
```javascript
// 1. Base sin descuento
baseImponibleSinDescuento = cantidad × valor1

// 2. Aplicar descuento
impNeto = baseImponibleSinDescuento × (1 - descuentoFraccional)

// 3. Calcular IVA sobre neto ya con descuento
impIva = calcularIva(impNeto, alicuotaId)
```

#### Mapeo de campos:
- `presupuestos_detalles.valor1` → precio unitario sin IVA
- `presupuestos_detalles.camp2` → factor IVA (0.210, 0.105, 0.000)
- `presupuestos_detalles.cantidad` → cantidad
- `presupuestos.descuento` → descuento fraccional (ej. 0.05 = 5%)

---

### 2. Mapper WSFE (Envío a AFIP)
**Archivo:** `src/facturacion/mappers/wsfeMapper.js`

#### Funciones agregadas:

##### `calcularTotalesWSFE(items)`
Calcula los totales correctos separando bases gravadas de bases exentas:

```javascript
items.forEach(item => {
    const alicId = parseInt(item.alic_iva_id);
    const baseImp = parseFloat(item.imp_neto) || 0;
    const impIva = parseFloat(item.imp_iva) || 0;
    
    if (alicId === 3) {
        // Código 3 = Exento (0%)
        impOpEx += baseImp;
    } else {
        // Códigos 4 (10.5%), 5 (21%), etc. = Gravados
        impNeto += baseImp;
        impIVA += impIva;
    }
});
```

##### `construirArrayIVA(items)` - Mejorado
Agrupa correctamente las alícuotas sumando bases e importes por cada código:

```javascript
// Agrupación por alícuota
items.forEach(item => {
    const alicId = parseInt(item.alic_iva_id);
    
    if (!ivaAgrupado[alicId]) {
        ivaAgrupado[alicId] = {
            Id: alicId,
            BaseImp: 0,
            Importe: 0
        };
    }
    
    ivaAgrupado[alicId].BaseImp += parseFloat(item.imp_neto);
    ivaAgrupado[alicId].Importe += parseFloat(item.imp_iva);
});
```

#### Estructura del payload WSFE:
```javascript
{
    ImpNeto: 1000.00,      // Solo bases gravadas
    ImpOpEx: 100.00,       // Solo bases exentas
    ImpIVA: 210.00,        // Suma de todos los IVAs
    ImpTotal: 1310.00,     // Total = Neto + OpEx + IVA
    iva: [
        { Id: 4, BaseImp: 500.00, Importe: 52.50 },   // 10.5%
        { Id: 5, BaseImp: 500.00, Importe: 105.00 }   // 21%
    ]
}
```

---

### 3. Generador de PDF
**Archivo:** `src/facturacion/pdf/generador.js`

#### Cambios en sección de totales:

**Antes:**
```
Subtotal (Neto): $1,100.00
IVA: $231.00
TOTAL: $1,331.00
```

**Ahora:**
```
Subtotal Gravado: $1,000.00
Subtotal Exento: $100.00
IVA 10,5%: $52.50
IVA 21%: $105.00
Total IVA: $157.50
TOTAL: $1,257.50
```

#### Lógica implementada:
```javascript
// Agrupar IVA por alícuota
const ivasPorAlicuota = {};
let netoGravado = 0;
let netoExento = 0;

items.forEach(item => {
    const codigoNormalizado = normalizarCodigo(item.alic_iva_id);
    const baseImp = parseFloat(item.imp_neto) || 0;
    const impIva = parseFloat(item.imp_iva) || 0;
    
    if (codigoNormalizado === 3) {
        netoExento += baseImp;
    } else {
        netoGravado += baseImp;
        if (!ivasPorAlicuota[codigoNormalizado]) {
            ivasPorAlicuota[codigoNormalizado] = 0;
        }
        ivasPorAlicuota[codigoNormalizado] += impIva;
    }
});
```

---

### 4. Interfaz de Usuario
**Archivo:** `src/facturacion/pages/ver-factura.html`

#### Funciones agregadas:

##### `normalizarCodigoIVA(id)`
Normaliza códigos antiguos a códigos AFIP correctos:
```javascript
const normalizacion = {
    1: 5,  // 21% (código antiguo → nuevo)
    2: 4   // 10.5% (código antiguo → nuevo)
};
```

##### Renderizado de totales discriminados con descuento
Muestra el descuento y el IVA separado por cada tasa:

```javascript
// Subtotal antes del descuento
const descuento = parseFloat(factura.descuento) || 0;
if (descuento > 0) {
    html += `Subtotal: ${formatMoney(subtotalAntesDescuento)}`;
    
    // Descuento
    const montoDescuento = subtotalAntesDescuento * descuento;
    const porcentajeDesc = (descuento * 100).toFixed(2).replace('.', ',');
    html += `Descuento (${porcentajeDesc}%): -${formatMoney(montoDescuento)}`;
}

// Neto Gravado (ya con descuento aplicado)
if (netoGravado > 0) {
    html += `Neto Gravado: ${formatMoney(netoGravado)}`;
}

// Neto Exento
if (netoExento > 0) {
    html += `Neto Exento: ${formatMoney(netoExento)}`;
}

// IVA por cada tasa
codigosOrdenados.forEach(codigo => {
    const etiqueta = obtenerAlicuotaIVA(codigo);
    html += `IVA ${etiqueta}: ${formatMoney(ivasPorAlicuota[codigo])}`;
});

// Total IVA (si hay múltiples alícuotas)
if (codigosOrdenados.length > 1) {
    html += `Total IVA: ${formatMoney(totalIva)}`;
}
```

### 5. Base de Datos
**Cambio:** Se agregó la columna `descuento` a la tabla `factura_facturas`

```sql
ALTER TABLE factura_facturas 
ADD COLUMN descuento NUMERIC(10,4) DEFAULT 0.00;

COMMENT ON COLUMN factura_facturas.descuento 
IS 'Descuento global aplicado (valor fraccional: 0.05 = 5%)';
```

El descuento se guarda en formato fraccional (0.05 = 5%) y se muestra en la factura de forma clara y separada.

---

## 📊 Tabla de Códigos AFIP

| Código AFIP | Porcentaje | Factor | Descripción |
|-------------|-----------|---------|-------------|
| 3 | 0% | 0.00 | Exento |
| 4 | 10.5% | 0.105 | IVA Reducido |
| 5 | 21% | 0.21 | IVA General |
| 6 | 27% | 0.27 | IVA Especial |
| 8 | 5% | 0.05 | IVA Mínimo |
| 9 | 2.5% | 0.025 | IVA Muy Reducido |

---

## 🔄 Flujo Completo: Presupuesto → Factura → AFIP

### 1. **Origen: Presupuesto**
```
presupuestos.descuento = 0.05 (5%)
presupuestos_detalles:
  - articulo: "Producto A"
    cantidad: 10
    valor1: 100.00 (precio sin IVA)
    camp2: 0.210 (21% IVA)
  - articulo: "Producto B"
    cantidad: 5
    valor1: 100.00
    camp2: 0.105 (10.5% IVA)
```

### 2. **Conversión: presupuestoFacturaService**
```javascript
// Item 1: Producto A (21% IVA)
baseImponible = 10 × 100 = 1000.00
impNeto = 1000.00 × (1 - 0.05) = 950.00
impIva = 950.00 × 0.21 = 199.50

// Item 2: Producto B (10.5% IVA)
baseImponible = 5 × 100 = 500.00
impNeto = 500.00 × (1 - 0.05) = 475.00
impIva = 475.00 × 0.105 = 49.88
```

### 3. **Almacenamiento: factura_factura_items**
```
item_1: imp_neto=950.00, imp_iva=199.50, alic_iva_id=5
item_2: imp_neto=475.00, imp_iva=49.88, alic_iva_id=4
```

### 4. **Agrupación: wsfeMapper**
```javascript
AlicIva: [
    { Id: 4, BaseImp: 475.00, Importe: 49.88 },
    { Id: 5, BaseImp: 950.00, Importe: 199.50 }
]

Totales:
ImpNeto: 1425.00  (bases gravadas)
ImpOpEx: 0.00     (bases exentas)
ImpIVA: 249.38    (suma de IVAs)
ImpTotal: 1674.38
```

### 5. **Visualización: UI y PDF**
```
Subtotal: $1,500.00
Descuento (5%): -$75.00
Neto Gravado: $1,425.00
IVA 10,5%: $49.88
IVA 21%: $199.50
Total IVA: $249.38
──────────────────────────
TOTAL: $1,674.38
```

---

## ✅ Validación de Sincronía

### Regla fundamental:
**Lo que se ve (UI/PDF) = Lo que se envía (WSFE)**

### Verificaciones automáticas:
1. ✅ Suma de bases por alícuota en WSFE = Suma de imp_neto en items
2. ✅ Suma de importes IVA en WSFE = Suma de imp_iva en items  
3. ✅ ImpTotal WSFE = ImpNeto + ImpOpEx + ImpIVA
4. ✅ Total PDF = Total UI = Total WSFE

---

## 🧪 Casos de Prueba

### Caso 1: Una sola alícuota (21%)
```
Items: 
  - $1000 (21% IVA)

Resultado:
  Neto Gravado: $1000.00
  IVA 21%: $210.00
  Total: $1210.00

WSFE:
  ImpNeto: 1000.00
  ImpIVA: 210.00
  AlicIva: [{ Id: 5, BaseImp: 1000.00, Importe: 210.00 }]
```

### Caso 2: Múltiples alícuotas (21% + 10.5%)
```
Items:
  - $1000 (21% IVA)
  - $500 (10.5% IVA)

Resultado:
  Neto Gravado: $1500.00
  IVA 10,5%: $52.50
  IVA 21%: $210.00
  Total IVA: $262.50
  Total: $1762.50

WSFE:
  ImpNeto: 1500.00
  ImpIVA: 262.50
  AlicIva: [
    { Id: 4, BaseImp: 500.00, Importe: 52.50 },
    { Id: 5, BaseImp: 1000.00, Importe: 210.00 }
  ]
```

### Caso 3: Con exentos (0%)
```
Items:
  - $1000 (21% IVA)
  - $200 (0% IVA - Exento)

Resultado:
  Neto Gravado: $1000.00
  Neto Exento: $200.00
  IVA 21%: $210.00
  Total: $1410.00

WSFE:
  ImpNeto: 1000.00
  ImpOpEx: 200.00
  ImpIVA: 210.00
  AlicIva: [
    { Id: 3, BaseImp: 200.00, Importe: 0.00 },
    { Id: 5, BaseImp: 1000.00, Importe: 210.00 }
  ]
```

### Caso 4: Con descuento del presupuesto (5%)
```
Presupuesto:
  - descuento: 0.05 (5%)
  - Item: cantidad=10, valor1=100, camp2=0.210

Cálculo:
  Base sin descuento: 10 × 100 = 1000.00
  Base con descuento: 1000 × 0.95 = 950.00
  IVA sobre base descontada: 950 × 0.21 = 199.50

Resultado:
  Neto Gravado: $950.00
  IVA 21%: $199.50
  Total: $1149.50
```

---

## 📝 Archivos Modificados

1. ✅ `src/facturacion/services/presupuestoFacturaService.js`
   - Aplicación de descuento sobre base imponible
   - Uso correcto de valor1 y camp2
   - Guardado del descuento en factura_facturas

2. ✅ `src/facturacion/mappers/wsfeMapper.js`
   - Separación de gravados/exentos
   - Agrupación correcta de alícuotas

3. ✅ `src/facturacion/pdf/generador.js`
   - Discriminación de IVA por tasa en PDF
   - Muestra de subtotales gravados/exentos
   - Visualización clara del descuento

4. ✅ `src/facturacion/pages/ver-factura.html`
   - Discriminación de IVA por tasa en UI
   - Normalización de códigos antiguos
   - Visualización clara del descuento

5. ✅ Base de datos: `factura_facturas`
   - Nueva columna `descuento NUMERIC(10,4) DEFAULT 0.00`

---

## 🎯 Beneficios de la Implementación

1. **Cumplimiento Normativo:** Los datos enviados a AFIP son exactos y cumplen con la normativa
2. **Transparencia:** El usuario ve exactamente qué se está enviando a AFIP
3. **Precisión:** Los cálculos de IVA son correctos incluso con múltiples alícuotas
4. **Mantenibilidad:** Código centralizado en helpers reutilizables
5. **Escalabilidad:** Fácil agregar nuevas alícuotas sin romper el código existente

---

## 🔧 Mantenimiento Futuro

### Para agregar una nueva alícuota:

1. Actualizar `src/facturacion/utils/iva-helper.js`:
```javascript
const ALICUOTAS_AFIP = {
    // ... existentes ...
    7: { pct: 15, factor: 0.15, descripcion: 'IVA 15%' }
};

const PCT_TO_CODE = {
    // ... existentes ...
    15: 7
};
```

2. No se requieren otros cambios - el sistema es dinámico

---

## 📞 Soporte

Para consultas o problemas con esta implementación:
- Revisar los logs en consola (buscar `[PRESUPUESTO-FACTURA]`, `[FACTURACION-MAPPER]`, `[FACTURACION-PDF]`)
- Verificar la estructura de datos en `presupuestos_detalles` (valor1, camp2)
- Confirmar códigos AFIP en `factura_iva_alicuotas`

---

**Documentación actualizada:** 20/01/2025  
**Versión:** 1.0  
**Estado:** ✅ Producción
