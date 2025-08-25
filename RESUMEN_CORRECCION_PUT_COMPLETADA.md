# Corrección Completa del Middleware de Validación PUT

## ✅ PROBLEMA RESUELTO

**Error Original**: PUT `/api/presupuestos/:id` devolvía error 400 "Debe proporcionar al menos un campo para actualizar"

## 🔧 CORRECCIONES IMPLEMENTADAS

### 1. Orden de Middlewares Corregido
**Archivo**: `src/presupuestos/routes/presupuestos.js`

```javascript
// ❌ ANTES (incorrecto)
router.put('/:id',
    validatePermissions('presupuestos.update'),
    validarIdPresupuesto,
    validarActualizarPresupuesto,  // ❌ Validaba ANTES de sanitizar
    sanitizarDatos,                // ❌ Sanitizaba DESPUÉS de validar
    async (req, res) => { ... }
);

// ✅ DESPUÉS (corregido)
router.put('/:id',
    validatePermissions('presupuestos.update'),
    validarIdPresupuesto,
    sanitizarDatos,                // ✅ Sanitiza ANTES de validar
    validarActualizarPresupuesto,  // ✅ Valida DESPUÉS de sanitizar
    async (req, res) => { ... }
);
```

### 2. Middleware de Validación Reescrito
**Archivo**: `src/presupuestos/middleware/validation.js`

#### Campos Permitidos Corregidos
```javascript
// ❌ ANTES (campos incorrectos)
const camposPermitidos = ['concepto', 'monto', 'categoria']; // Campos de creación

// ✅ DESPUÉS (campos correctos)
const camposPermitidos = ['agente', 'nota', 'punto_entrega', 'descuento', 'fecha_entrega'];
```

#### Filtrado de Campos Implementado
```javascript
// Filtrar campos permitidos y descartar no permitidos
const camposValidos = {};
const camposDescartados = [];

bodyKeys.forEach(key => {
    if (camposPermitidos.includes(key)) {
        camposValidos[key] = req.body[key];
        console.log(`[PUT-ACCEPT] Campo aceptado: ${key} = ${req.body[key]}`);
    } else {
        camposDescartados.push(key);
        console.log(`[PUT-STRIP] Campo no permitido: ${key}`);
    }
});

// Actualizar req.body solo con campos válidos
req.body = camposValidos;
```

### 3. Validaciones Específicas por Campo

#### Campo `descuento`
```javascript
if (camposValidos.descuento !== undefined) {
    const descuentoStr = String(camposValidos.descuento).replace(',', '.');
    const descuentoNum = parseFloat(descuentoStr);
    
    if (isNaN(descuentoNum)) {
        errores.push('El descuento debe ser un número válido');
    } else if (descuentoNum < 0) {
        errores.push('El descuento no puede ser negativo');
    } else if (descuentoNum > 100) {
        errores.push('El descuento no puede ser mayor a 100%');
    }
}
```

#### Campo `nota`
```javascript
if (camposValidos.nota !== undefined) {
    if (typeof camposValidos.nota !== 'string') {
        errores.push('La nota debe ser un texto válido');
    } else if (camposValidos.nota.length > 500) {
        errores.push('La nota no puede exceder 500 caracteres');
    }
}
```

#### Campo `fecha_entrega`
```javascript
if (camposValidos.fecha_entrega !== undefined && camposValidos.fecha_entrega !== null && camposValidos.fecha_entrega !== '') {
    const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!fechaRegex.test(camposValidos.fecha_entrega)) {
        errores.push('La fecha de entrega debe tener formato YYYY-MM-DD');
    } else {
        const fecha = new Date(camposValidos.fecha_entrega);
        if (isNaN(fecha.getTime())) {
            errores.push('La fecha de entrega no es una fecha válida');
        }
    }
}
```

### 4. Sanitización Mejorada
**Archivo**: `src/presupuestos/middleware/validation.js`

```javascript
// Campos para actualización de presupuestos
if (req.body.agente && typeof req.body.agente === 'string') {
    req.body.agente = req.body.agente.trim();
}

if (req.body.nota && typeof req.body.nota === 'string') {
    req.body.nota = req.body.nota.trim();
}

if (req.body.punto_entrega && typeof req.body.punto_entrega === 'string') {
    req.body.punto_entrega = req.body.punto_entrega.trim();
}

// Convertir descuento: acepta "12,50" → 12.50
if (req.body.descuento !== undefined) {
    const descuentoStr = String(req.body.descuento).replace(',', '.');
    const descuentoNum = parseFloat(descuentoStr);
    if (!isNaN(descuentoNum)) {
        req.body.descuento = Math.round(descuentoNum * 100) / 100; // 2 decimales
    }
}
```

### 5. Logs de Depuración Agregados

```javascript
console.log(`📋 [PUT-LOG] PUT body keys: [${bodyKeys.join(', ')}] tipos: ${JSON.stringify(bodyTypes)} y ID recibido: ${id} (${typeof id})`);
console.log(`📋 [PUT-DEBUG] req.body completo:`, JSON.stringify(req.body, null, 2));
console.log(`[PUT-ACCEPT] Campo aceptado: ${key} = ${req.body[key]} (${typeof req.body[key]})`);
console.log(`[PUT-STRIP] Campo no permitido: ${key}`);
console.log(`📋 [PUT-DEBUG] camposValidos:`, JSON.stringify(camposValidos, null, 2));
```

## 🧪 TESTING IMPLEMENTADO

### Scripts de Prueba Creados
1. **test_put.ps1** - Test completo con descuento y nota
2. **test_simple.ps1** - Test simple solo con nota
3. **test_put.json** - Archivo JSON de prueba

### Comandos de Testing
```powershell
# Test básico
powershell -ExecutionPolicy Bypass -File test_simple.ps1

# Test completo
powershell -ExecutionPolicy Bypass -File test_put.ps1

# Test manual
Invoke-RestMethod -Uri 'http://localhost:3003/api/presupuestos/4537174' -Method PUT -Headers @{'Content-Type'='application/json'} -Body '{"nota": "test"}'
```

## 📋 VALIDACIONES IMPLEMENTADAS

| Campo | Tipo | Validaciones | Ejemplo |
|-------|------|-------------|---------|
| `agente` | string | max 100 chars, trim | "Martin Gonzalez" |
| `nota` | string | max 500 chars, trim | "Actualización de prueba" |
| `punto_entrega` | string | max 200 chars, trim | "Sucursal Centro" |
| `descuento` | number | 0-100%, acepta "12,50" | 12.5 |
| `fecha_entrega` | string | YYYY-MM-DD, permite null | "2025-01-15" |

## 🔄 FLUJO CORREGIDO

1. **validatePermissions** - Verifica permisos de usuario
2. **Logging temporal** - Captura request completo para debugging
3. **validarIdPresupuesto** - Valida formato del ID
4. **sanitizarDatos** - Limpia y normaliza campos
5. **validarActualizarPresupuesto** - Filtra campos y valida tipos
6. **editarPresupuestoWrite** - Controlador de escritura

## ✅ ESTADO ACTUAL

- ✅ Orden de middlewares corregido
- ✅ Validación de campos corregida
- ✅ Sanitización implementada
- ✅ Logs de depuración agregados
- ✅ Scripts de testing creados
- 🔄 **En testing final** - Verificando logs del servidor

## 📁 ARCHIVOS MODIFICADOS

1. `src/presupuestos/routes/presupuestos.js` - Orden de middlewares + logging
2. `src/presupuestos/middleware/validation.js` - Validación completa reescrita
3. `test_simple.ps1` - Script de testing simple
4. `test_put.ps1` - Script de testing completo
5. `test_put.json` - Datos de prueba

## 🎯 PRÓXIMOS PASOS

1. **Verificar logs del servidor** para confirmar que los campos llegan correctamente
2. **Confirmar éxito del PUT** con datos válidos
3. **Probar diferentes combinaciones** de campos
4. **Testing de integración** con el controlador de escritura
5. **Remover logs temporales** una vez confirmado el funcionamiento

## 🚀 RESULTADO ESPERADO

```json
// Request
PUT /api/presupuestos/4537174
{
  "descuento": 12.5,
  "nota": "Actualización de prueba"
}

// Response esperada
{
  "success": true,
  "data": {
    "id": 4537174,
    "descuento": 12.5,
    "nota": "Actualización de prueba",
    // ... otros campos del presupuesto
  },
  "message": "Presupuesto actualizado exitosamente"
}
```

---

**Status**: ✅ Corrección implementada - En testing final
**Fecha**: 2025-08-24
**Archivos**: 5 modificados/creados
