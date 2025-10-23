# 🧪 Instrucciones de Testing - Botón Facturar

## ⚠️ IMPORTANTE

El botón "Facturar" **NO está en la página de listado** de presupuestos.

El botón está en la **página de EDICIÓN** de un presupuesto individual.

---

## 📋 Pasos Correctos para Probar

### PASO 1: Ir a la Página de Listado

Ya estás ahí: `http://localhost:3003/pages/presupuestos.html`

### PASO 2: Editar un Presupuesto

1. En la tabla de presupuestos, buscar uno con fecha **>= 2025-10-12**
2. Click en el ícono de **lápiz** (✏️) en la columna "ACCIONES"
3. Esto te lleva a: `http://localhost:3003/pages/editar-presupuesto.html?id=XXXX`

### PASO 3: Buscar el Botón "Facturar"

1. En la página de edición, hacer **scroll hasta el final**
2. Buscar la sección de botones (Cancelar / Guardar)
3. El botón "🧾 Facturar" debe estar **a la izquierda** de "Cancelar"

### PASO 4: Probar el Botón

1. Click en "🧾 Facturar"
2. Debe aparecer confirmación: "¿Desea crear una factura para este presupuesto?"
3. Click en "Aceptar"
4. Loading spinner aparece
5. Toast verde: "Factura creada exitosamente (ID: X)"
6. Badge verde con ID aparece
7. Botón cambia a "Ver Factura"

---

## 🔍 Debugging en Consola

### Verificar que el Módulo Cargó

En Console (F12):
```javascript
window.FacturacionIntegration
// Debe mostrar: {inicializar: ƒ, puedeFacturar: ƒ, ...}
```

### Verificar Logs de Inicialización

Buscar en Console:
```
🧾 [FACTURACION-INT] Cargando módulo de integración con facturación...
✅ [FACTURACION-INT] Módulo cargado correctamente
🚀 [FACTURACION-INT] Inicializando integración de facturación...
✅ [FACTURACION-INT] Contenedor encontrado: <div id="facturacion-container">
🎨 [FACTURACION-INT] Renderizando botón de facturación...
✅ [FACTURACION-INT] Botón renderizado
✅ [FACTURACION-INT] Integración inicializada
```

### Si el Botón NO Aparece

Verificar en Console:
```javascript
// Ver datos del presupuesto
window.presupuestoData
// Verificar fecha

// Verificar si puede facturar
window.FacturacionIntegration.puedeFacturar(window.presupuestoData)
// Debe retornar: {puede: true} o {puede: false, razon: "..."}
```

---

## ⚠️ Casos Especiales

### Presupuesto con Fecha < 2025-10-12

**Comportamiento Esperado:**
- ❌ NO aparece botón "Facturar"
- ✅ Aparece mensaje: "Solo presupuestos desde 2025-10-12 pueden facturarse con el nuevo sistema"

**Ejemplo:** El presupuesto ID 8227522 tiene fecha 2025-10-09, por lo tanto NO puede facturarse.

### Presupuesto con Fecha >= 2025-10-12

**Comportamiento Esperado:**
- ✅ Aparece botón "🧾 Facturar" (verde)
- ✅ Click funciona correctamente
- ✅ Crea factura en el backend

---

## 🎯 Resumen

**Página INCORRECTA:** `presupuestos.html` (listado) ← Estás aquí
**Página CORRECTA:** `editar-presupuesto.html` (edición) ← Ir aquí

**Acción:** Click en ícono de lápiz (✏️) en cualquier presupuesto de la lista

---

**Sistema LAMDA** - Instrucciones de Testing
