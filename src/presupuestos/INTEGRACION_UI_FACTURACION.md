# Integración UI: Presupuestos → Facturación

Documentación de la integración de interfaz de usuario entre el módulo de Presupuestos y el módulo de Facturación.

## 📋 Descripción

Esta integración permite crear facturas directamente desde la pantalla de edición de presupuestos, con validaciones estrictas y control de idempotencia.

## 🎯 Funcionalidades Implementadas

### 1. Botón "Facturar" Condicional

El botón se muestra **solo si**:
- ✅ `fecha_presupuesto >= "2025-10-12"` (fecha hito)
- ✅ `usar_facturador_nuevo === true` (por defecto true para presupuestos nuevos)
- ✅ No existe factura asociada

Si ya existe factura, se muestra botón **"Ver Factura"**.

### 2. Validaciones Automáticas

Antes de enviar la solicitud:
- Verifica fecha del presupuesto
- Verifica flag `usar_facturador_nuevo`
- Verifica que no exista factura previa

### 3. Mapeo de Datos

**Presupuesto → Factura:**
```javascript
{
  usar_facturador_nuevo: true,
  fecha_presupuesto: "YYYY-MM-DD",
  presupuesto_id: <ID>,
  tipo_cbte: 6,              // Factura B
  pto_vta: 32,               // Punto de venta
  concepto: 1,               // Productos
  cliente: {
    cliente_id: <ID>,
    razon_social: "<nombre>",
    doc_tipo: <99|80|96>,
    doc_nro: "<nro>",
    condicion_iva_id: <5|4|1>
  },
  precio_modo: "NETO",       // Precios sin IVA
  items: [...]
}
```

### 4. Manejo de Respuestas

#### 201 Created - Factura Nueva
```javascript
{
  success: true,
  message: "Factura creada exitosamente (ID: 123)",
  data: { id: 123, ... }
}
```
- Muestra toast de éxito
- Agrega badge con ID de factura
- Cambia botón a "Ver Factura"

#### 409 Conflict - Idempotencia
```javascript
{
  success: true,
  idempotente: true,
  message: "Ya existía factura para este presupuesto (ID: 120)",
  data: { id: 120, ... }
}
```
- Muestra toast informativo
- Cambia botón a "Ver Factura"
- No duplica factura

#### 400 Bad Request - Validación Fallida
```javascript
{
  success: false,
  error: "Facturador nuevo requerido",
  message: "Este endpoint solo acepta presupuestos marcados con usar_facturador_nuevo: true"
}
```
- Muestra toast de error
- Mensaje específico del problema

## 📁 Archivos Creados/Modificados

### Archivos Nuevos

1. **`js/facturacion-integration.js`** (450 líneas)
   - Módulo de integración completo
   - Funciones de validación
   - Mapeo de datos
   - Renderizado de botón
   - Manejo de respuestas

### Archivos Modificados

1. **`pages/editar-presupuesto.html`**
   - Agregado script de integración
   - Estilos para botón y toasts

2. **`js/presupuestosEdit.js`**
   - Inicialización del módulo de facturación
   - Llamada después de cargar datos

## 🚀 Uso

### Desde la UI

1. Abrir presupuesto en modo edición
2. Si cumple condiciones, aparece botón "🧾 Facturar"
3. Click en botón → Confirmación
4. Factura creada → Toast + Badge + Botón "Ver Factura"

### Programático

```javascript
// Verificar si puede facturar
const verificacion = window.FacturacionIntegration.puedeFacturar(presupuesto);
if (verificacion.puede) {
  // Crear factura
  const resultado = await window.FacturacionIntegration.crearFactura(
    presupuesto,
    detalles
  );
}
```

## 🔧 Configuración

### Variables de Entorno

```env
# URL del módulo de facturación
FACTURACION_API_URL=http://localhost:3004/facturacion
```

### Constantes

```javascript
// En facturacion-integration.js
const FECHA_HITO = '2025-10-12';
const FACTURACION_API_URL = 'http://localhost:3004/facturacion';
```

## 📊 Flujo de Integración

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Usuario abre presupuesto en edición                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Se cargan datos del presupuesto y detalles               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Se inicializa módulo de facturación                      │
│    - Verifica fecha >= 2025-10-12                           │
│    - Verifica usar_facturador_nuevo                         │
│    - Verifica que no exista factura                         │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│ Puede facturar   │    │ No puede facturar│
│ Muestra botón    │    │ Muestra mensaje  │
│ "Facturar"       │    │ o "Ver Factura"  │
└────────┬─────────┘    └──────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Usuario hace click en "Facturar"                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Confirmación del usuario                                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Mapeo de datos: Presupuesto → Factura                    │
│    - Cliente                                                 │
│    - Items con precios NETO                                  │
│    - Alícuotas de IVA                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. POST http://localhost:3004/facturacion/facturas          │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┬───────────────┐
         │                       │               │
         ▼                       ▼               ▼
┌──────────────┐    ┌──────────────────┐  ┌──────────────┐
│ 201 Created  │    │ 409 Conflict     │  │ 400 Error    │
│ Nueva factura│    │ Ya existía       │  │ Validación   │
└──────┬───────┘    └────────┬─────────┘  └──────┬───────┘
       │                     │                    │
       ▼                     ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Actualización de UI                                       │
│    - Toast con mensaje                                       │
│    - Badge con ID (si aplica)                                │
│    - Botón cambia a "Ver Factura"                            │
└─────────────────────────────────────────────────────────────┘
```

## 🔍 Debugging

### Logs en Consola

```javascript
// Todos los logs tienen prefijo [FACTURACION-INT]
console.log('🧾 [FACTURACION-INT] Cargando módulo...');
console.log('🔍 [FACTURACION-INT] Verificando si puede facturar...');
console.log('🔄 [FACTURACION-INT] Mapeando presupuesto a factura...');
console.log('📤 [FACTURACION-INT] Creando factura...');
console.log('✅ [FACTURACION-INT] Factura creada:', result);
```

### Verificar Estado

```javascript
// En consola del navegador
window.FacturacionIntegration
// Debe mostrar objeto con funciones disponibles
```

## ⚠️ Limitaciones Actuales

1. **No persiste factura_id en presupuesto**
   - Requiere endpoint en backend
   - Documentado como TODO

2. **Solo facturación interna**
   - `requiere_afip: false`
   - AFIP real pendiente de implementación

3. **Mapeo simplificado de cliente**
   - Doc tipo: 99 (CF) o 80 (CUIT)
   - Condición IVA: 5 (CF) o 1 (RI)

## 🔄 Próximos Pasos

1. **Backend**: Agregar campo `factura_id` a tabla presupuestos
2. **Backend**: Endpoint para actualizar `factura_id`
3. **Frontend**: Persistir relación presupuesto-factura
4. **Frontend**: Mostrar link directo a factura
5. **AFIP**: Implementar facturación electrónica real

## 📞 Soporte

Para consultas sobre la integración:
- Revisar logs en consola del navegador
- Verificar que módulo de facturación esté corriendo (puerto 3004)
- Verificar que presupuesto cumpla condiciones

---

**Sistema LAMDA** - Integración UI Presupuestos → Facturación
