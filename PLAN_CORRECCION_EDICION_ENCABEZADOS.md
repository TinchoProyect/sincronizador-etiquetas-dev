# PLAN DE CORRECCIÓN: EDICIÓN DE ENCABEZADOS DE PRESUPUESTOS

## 📋 DIAGNÓSTICO CONFIRMADO

### ✅ Archivos en Ejecución Verificados:
- **Frontend**: `src/presupuestos/js/presupuestosEdit.js` (línea 864: handleSubmit)
- **Backend**: `src/presupuestos/controllers/presupuestosWrite.js` (línea 445: editarPresupuesto)
- **Rutas**: `src/presupuestos/routes/presupuestos.js` (línea 425: PUT /:id)

### ❌ Problema Confirmado:

**Campos que NO se envían al backend:**
- `tipo_comprobante`
- `estado`
- `id_cliente`
- `fecha`

**Campos que SÍ se envían:**
- ✅ `agente`
- ✅ `nota`
- ✅ `punto_entrega`
- ✅ `descuento`
- ✅ `fecha_entrega`
- ✅ `detalles`

---

## 🔧 CORRECCIONES NECESARIAS

### 1️⃣ FRONTEND: `src/presupuestos/js/presupuestosEdit.js`

**Ubicación**: Función `handleSubmit()` - línea ~959

**Cambio actual:**
```javascript
const updateData = {
    agente: data.agente,
    punto_entrega: data.punto_entrega,
    descuento: data.descuento,
    fecha_entrega: data.fecha_entrega,
    nota: data.nota,
    detalles: detalles
};
```

**Cambio propuesto:**
```javascript
const updateData = {
    // Campos existentes (ya funcionan)
    agente: data.agente,
    punto_entrega: data.punto_entrega,
    descuento: data.descuento,
    fecha_entrega: data.fecha_entrega,
    nota: data.nota,
    
    // NUEVOS: Campos del encabezado que faltaban
    tipo_comprobante: data.tipo_comprobante,
    estado: data.estado,
    id_cliente: data.id_cliente,
    fecha: data.fecha,
    
    // Detalles
    detalles: detalles
};
```

---

### 2️⃣ BACKEND: `src/presupuestos/controllers/presupuestosWrite.js`

**Ubicación**: Función `editarPresupuesto()` - línea ~445

#### Cambio A: Extraer campos adicionales del req.body

**Línea actual (~460):**
```javascript
const { agente, nota, punto_entrega, descuento, fecha_entrega, detalles } = req.body;
```

**Cambio propuesto:**
```javascript
const { 
    agente, 
    nota, 
    punto_entrega, 
    descuento, 
    fecha_entrega, 
    detalles,
    // NUEVOS campos del encabezado
    tipo_comprobante,
    estado,
    id_cliente,
    fecha
} = req.body;
```

#### Cambio B: Agregar lógica de actualización para campos nuevos

**Ubicación**: Después de la línea que maneja `fecha_entrega` (~540)

**Código a agregar:**
```javascript
if (tipo_comprobante !== undefined) {
    paramCount++;
    updates.push(`tipo_comprobante = $${paramCount}`);
    params.push(tipo_comprobante);
}

if (estado !== undefined) {
    paramCount++;
    updates.push(`estado = $${paramCount}`);
    params.push(estado);
}

if (id_cliente !== undefined) {
    paramCount++;
    updates.push(`id_cliente = $${paramCount}`);
    params.push(id_cliente);
}

if (fecha !== undefined) {
    paramCount++;
    updates.push(`fecha = $${paramCount}`);
    params.push(fecha ? normalizeDate(fecha) : null);
}
```

---

## 📝 VALIDACIONES A CONSIDERAR

### Middleware de Validación

Verificar que `src/presupuestos/middleware/validation.js` permita estos campos en `validarActualizarPresupuesto`:

```javascript
// Campos permitidos para actualización
const camposPermitidos = [
    'agente',
    'nota',
    'punto_entrega',
    'descuento',
    'fecha_entrega',
    'detalles',
    // AGREGAR:
    'tipo_comprobante',
    'estado',
    'id_cliente',
    'fecha'
];
```

---

## 🧪 PLAN DE TESTING

### Test 1: Edición de Estado
1. Abrir presupuesto existente
2. Cambiar estado de "Presupuesto/Orden" a "Muestra de Fraccionados"
3. Guardar
4. Verificar en BD que el campo `estado` se actualizó
5. Verificar que `fecha_actualizacion` se actualizó

### Test 2: Edición de Tipo de Comprobante
1. Abrir presupuesto existente
2. Cambiar tipo_comprobante de "Factura" a "Remito-Efectivo"
3. Guardar
4. Verificar en BD que el campo `tipo_comprobante` se actualizó

### Test 3: Edición de Cliente
1. Abrir presupuesto existente
2. Cambiar cliente
3. Guardar
4. Verificar en BD que el campo `id_cliente` se actualizó

### Test 4: Edición de Fecha
1. Abrir presupuesto existente
2. Cambiar fecha del presupuesto
3. Guardar
4. Verificar en BD que el campo `fecha` se actualizó

### Test 5: Edición Combinada
1. Abrir presupuesto existente
2. Cambiar TODOS los campos (encabezado + detalles)
3. Guardar
4. Verificar que TODOS los cambios se guardaron correctamente

### Test 6: Verificar que Detalles Siguen Funcionando
1. Abrir presupuesto existente
2. Modificar solo detalles (agregar/eliminar/modificar artículos)
3. Guardar
4. Verificar que los detalles se actualizaron correctamente

---

## 🔍 QUERIES DE VERIFICACIÓN

### Verificar actualización de encabezado:
```sql
SELECT 
    id,
    id_presupuesto_ext,
    tipo_comprobante,
    estado,
    id_cliente,
    fecha,
    agente,
    nota,
    fecha_actualizacion
FROM presupuestos
WHERE id = [ID_PRESUPUESTO]
ORDER BY fecha_actualizacion DESC;
```

### Verificar actualización de detalles:
```sql
SELECT 
    id,
    id_presupuesto,
    articulo,
    cantidad,
    valor1,
    precio1,
    fecha_actualizacion
FROM presupuestos_detalles
WHERE id_presupuesto = [ID_PRESUPUESTO]
ORDER BY id;
```

---

## ⚠️ CONSIDERACIONES IMPORTANTES

### 1. Sincronización con Google Sheets
- La función `editarPresupuesto` actualiza `fecha_actualizacion` ✅
- Esto permite que el motor de sincronización detecte el cambio
- Los cambios se propagarán a Google Sheets en la próxima sincronización

### 2. Validaciones de Negocio
- Verificar que los valores de `tipo_comprobante` sean válidos
- Verificar que los valores de `estado` sean válidos
- Verificar que `id_cliente` exista en la tabla `clientes`
- Verificar que `fecha` tenga formato válido (YYYY-MM-DD)

### 3. Campos de Solo Lectura
Los siguientes campos NO deben ser editables (mantener como info):
- `id` (PK autoincremental)
- `id_presupuesto_ext` (generado al crear)
- `activo` (solo se modifica en eliminación)
- `hoja_url`, `hoja_nombre` (configuración de sync)

---

## 📦 ARCHIVOS A MODIFICAR

1. ✅ `src/presupuestos/js/presupuestosEdit.js`
   - Línea ~959: Agregar campos a `updateData`

2. ✅ `src/presupuestos/controllers/presupuestosWrite.js`
   - Línea ~460: Agregar campos a destructuring
   - Línea ~540: Agregar lógica de actualización

3. ⚠️ `src/presupuestos/middleware/validation.js` (verificar)
   - Confirmar que campos están permitidos en `validarActualizarPresupuesto`

---

## 🚀 ORDEN DE IMPLEMENTACIÓN

1. **Primero**: Modificar backend (presupuestosWrite.js)
   - Así el backend está listo para recibir los campos

2. **Segundo**: Modificar frontend (presupuestosEdit.js)
   - Así el frontend envía los campos que el backend ya puede procesar

3. **Tercero**: Verificar middleware de validación
   - Confirmar que no bloquea los nuevos campos

4. **Cuarto**: Testing completo
   - Ejecutar todos los tests del plan

---

## ✅ CRITERIOS DE ÉXITO

- ✅ Al editar `tipo_comprobante`, el cambio se guarda en BD
- ✅ Al editar `estado`, el cambio se guarda en BD
- ✅ Al editar `id_cliente`, el cambio se guarda en BD
- ✅ Al editar `fecha`, el cambio se guarda en BD
- ✅ Al editar `nota`, `agente`, etc., siguen funcionando
- ✅ Al editar detalles, siguen funcionando
- ✅ `fecha_actualizacion` se actualiza en todos los casos
- ✅ Los cambios se sincronizan correctamente con Google Sheets

---

## 📞 PRÓXIMOS PASOS

¿Deseas que proceda con la implementación de estas correcciones?

Puedo:
1. Aplicar los cambios en los archivos
2. Crear un script de testing para verificar
3. Documentar los cambios realizados
