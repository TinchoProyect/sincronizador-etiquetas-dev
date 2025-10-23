# ✅ CORRECCIÓN COMPLETA: Mapeo de Clientes para Facturación

**Fecha:** 2025-01-XX  
**Problema:** Todos los clientes se facturaban como Consumidor Final (99) independientemente de su condición IVA real

---

## 🔍 ANÁLISIS DEL PROBLEMA

### Datos Reales de la Tabla `clientes`

**Estructura:**
- `cliente_id` (INTEGER) - ID único
- `nombre` (TEXT) - Nombre del cliente
- `apellido` (TEXT) - Apellido
- `cuit` (VARCHAR(40)) - CUIT (11 dígitos)
- `dni` (TEXT) - DNI (7-8 dígitos)
- `condicion_iva` (TEXT) - Condición IVA como texto
- **NO existe** `condicion_iva_id`

**Ejemplo Cliente ID 1:**
```
cliente_id: 1
nombre: "Don Emilio"
apellido: "DEL GIOVANI NATALIA GISELA"
cuit: "27328441484"
dni: "32844148"
condicion_iva: "Responsable Inscripto"
```

---

## ✅ CORRECCIONES APLICADAS

### 1. Mapeo de Alícuotas IVA (`afip.js`)

**Antes (INCORRECTO):**
```javascript
const ALICUOTAS_IVA = {
    3: { porcentaje: 0, descripcion: 'IVA 0%', codigo_afip: 3 },
    4: { porcentaje: 10.5, descripcion: 'IVA 10.5%', codigo_afip: 4 },
    5: { porcentaje: 21, descripcion: 'IVA 21%', codigo_afip: 5 }
};
```

**Después (CORRECTO según tabla real):**
```javascript
const ALICUOTAS_IVA = {
    1: { porcentaje: 21, descripcion: 'IVA 21%', codigo_afip: 5 },
    2: { porcentaje: 10.5, descripcion: 'IVA 10.5%', codigo_afip: 4 },
    3: { porcentaje: 0, descripcion: 'Exento', codigo_afip: 3 }
};
```

---

### 2. Endpoint para Obtener Datos del Cliente

**Nuevo endpoint:** `GET /api/presupuestos/clientes/:id`

**Controlador:** `src/presupuestos/controllers/presupuestos.js`
```javascript
const obtenerClientePorId = async (req, res) => {
    const query = `
        SELECT 
            cliente_id,
            nombre,
            apellido,
            otros,
            cuit,
            dni,
            condicion_iva,
            lista_precios,
            domicilio as direccion,
            telefono,
            email
        FROM public.clientes
        WHERE cliente_id = $1
    `;
    // ... resto del código
};
```

**Ruta:** `src/presupuestos/routes/presupuestos.js`
```javascript
router.get('/clientes/:id', validatePermissions('presupuestos.read'), obtenerClientePorId);
```

---

### 3. Mapeo Correcto en `facturacion-integration.js`

**Función `obtenerDatosCliente()`:**
```javascript
async function obtenerDatosCliente(clienteId) {
    const response = await fetch(`http://localhost:3003/api/clientes/${clienteId}`);
    const result = await response.json();
    return result.success ? result.data : null;
}
```

**Función `mapearPresupuestoAFactura()` mejorada:**

```javascript
// Limpiar CUIT/DNI (remover espacios, guiones, puntos)
const cuitLimpio = cliente.cuit ? String(cliente.cuit).replace(/[-\s.]/g, '').trim() : '';
const dniLimpio = cliente.dni ? String(cliente.dni).replace(/[-\s.]/g, '').trim() : '';

// Determinar tipo de documento
if (cuitLimpio && cuitLimpio.length === 11 && /^\d{11}$/.test(cuitLimpio)) {
    docTipo = 80; // CUIT
    docNro = cuitLimpio;
} else if (dniLimpio && dniLimpio.length >= 7 && dniLimpio.length <= 8 && /^\d+$/.test(dniLimpio)) {
    docTipo = 96; // DNI
    docNro = dniLimpio;
} else {
    // Consumidor Final por defecto
    docTipo = 99;
    docNro = '0';
}

// Mapear condición IVA (TEXT a ID)
const mapeoCondicion = {
    'Responsable Inscripto': 1,
    'Responsable no Inscripto': 2,
    'No Responsable': 3,
    'Exento': 4,
    'Consumidor Final': 5,
    'Responsable Monotributo': 6,
    'Monotributo': 6,
    'IVA Liberado': 10
};

condicionIvaId = mapeoCondicion[cliente.condicion_iva] || 5;

// Determinar tipo de comprobante
let tipoCbte = 6; // Factura B por defecto
if (condicionIvaId === 1) {
    tipoCbte = 1; // Factura A para Responsable Inscripto
}
```

---

## 📋 MAPEOS CORRECTOS

### Condición IVA (TEXT) → ID AFIP

| Texto en BD | ID AFIP | Tipo Cbte | Doc Tipo |
|-------------|---------|-----------|----------|
| Responsable Inscripto | 1 | 1 (Factura A) | 80 (CUIT) |
| Responsable no Inscripto | 2 | 6 (Factura B) | 80 (CUIT) |
| No Responsable | 3 | 6 (Factura B) | 96 (DNI) |
| Exento | 4 | 6 (Factura B) | 80 (CUIT) |
| Consumidor Final | 5 | 6 (Factura B) | 99 (Sin ID) |
| Responsable Monotributo | 6 | 6 (Factura B) | 80 (CUIT) |
| Monotributo | 6 | 6 (Factura B) | 80 (CUIT) |
| IVA Liberado | 10 | 6 (Factura B) | 80 (CUIT) |

### Tipo de Documento ARCA/AFIP

| Código | Descripción | Validación |
|--------|-------------|------------|
| 80 | CUIT | 11 dígitos numéricos |
| 96 | DNI | 7-8 dígitos numéricos |
| 99 | Sin identificar / CF | "0" |

### IVA % → ID Alícuota

| IVA % | ID Tabla | Código AFIP |
|-------|----------|-------------|
| 21% | 1 | 5 |
| 10.5% | 2 | 4 |
| 0% | 3 | 3 |

---

## 🧪 PRUEBA ESPERADA

**Cliente ID 1:**
- Nombre: "Don Emilio DEL GIOVANI NATALIA GISELA"
- CUIT: "27328441484"
- Condición IVA: "Responsable Inscripto"

**Resultado esperado:**
```json
{
  "tipo_cbte": 1,  // Factura A
  "cliente": {
    "cliente_id": 1,
    "razon_social": "Don Emilio DEL GIOVANI NATALIA GISELA",
    "doc_tipo": 80,  // CUIT
    "doc_nro": "27328441484",
    "condicion_iva_id": 1  // Responsable Inscripto
  }
}
```

---

## 📝 LOGS DE DEPURACIÓN

El sistema ahora genera logs detallados:

```
🔍 [FACTURACION-INT] Obteniendo datos del cliente 1...
✅ [FACTURACION-INT] Datos del cliente obtenidos: {
  cliente_id: 1,
  nombre: "Don Emilio",
  apellido: "DEL GIOVANI NATALIA GISELA",
  cuit: "27328441484",
  dni: "32844148",
  condicion_iva: "Responsable Inscripto"
}
🔍 [FACTURACION-INT] Cliente 1: {
  nombre: "Don Emilio DEL GIOVANI NATALIA GISELA",
  cuit: "27328441484",
  dni: "32844148",
  condicion_iva: "Responsable Inscripto"
}
✅ [FACTURACION-INT] Usando CUIT: 27328441484
✅ [FACTURACION-INT] Condición IVA: "Responsable Inscripto" → ID 1
```

---

## 🚀 PARA PROBAR

1. **Reiniciar servidor de presupuestos** (para cargar nuevo endpoint)
2. **Recargar página** del presupuesto (F5)
3. **Hacer clic en "Facturar"**
4. **Verificar en consola** los logs de mapeo
5. **Verificar en factura creada** que tenga:
   - Tipo de comprobante correcto (1 para RI, 6 para resto)
   - CUIT del cliente (no "0")
   - Condición IVA correcta

---

## 📂 ARCHIVOS MODIFICADOS

1. ✅ `src/facturacion/config/afip.js` - Alícuotas IVA corregidas
2. ✅ `src/presupuestos/controllers/presupuestos.js` - Endpoint `obtenerClientePorId()`
3. ✅ `src/presupuestos/routes/presupuestos.js` - Ruta `GET /clientes/:id`
4. ✅ `src/presupuestos/js/facturacion-integration.js` - Mapeo completo con datos reales
5. ✅ `src/presupuestos/controllers/presupuestos.js` - Campo `factura_id` en consultas

---

**Estado:** ✅ Listo para probar  
**Acción requerida:** Reiniciar servidor y probar facturación
