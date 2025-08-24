# Corrección del Middleware de Validación PUT - Presupuestos

## Problema Identificado

**Error 400**: "Debe proporcionar al menos un campo para actualizar" en PUT `/api/presupuestos/:id`

## Diagnóstico Realizado

### 1. Análisis del Error
- ✅ El JSON de prueba es válido: `{"descuento": 12.5, "nota": "Actualización de prueba"}`
- ✅ Los campos `descuento` y `nota` están en la lista de campos permitidos
- ❌ El middleware de validación reporta que no hay campos válidos tras el filtrado

### 2. Problemas Encontrados y Corregidos

#### A. Orden Incorrecto de Middlewares
**Problema**: En las rutas, el orden era:
```javascript
validarIdPresupuesto,
validarActualizarPresupuesto,  // ❌ ANTES de sanitizar
sanitizarDatos,                // ❌ DESPUÉS de validar
```

**Solución**: Cambiar el orden a:
```javascript
validarIdPresupuesto,
sanitizarDatos,                // ✅ ANTES de validar
validarActualizarPresupuesto,  // ✅ DESPUÉS de sanitizar
```

#### B. Middleware de Validación Incorrecto
**Problema**: El middleware `validarActualizarPresupuesto` usaba campos incorretos:
- Esperaba: `concepto`, `monto`, `categoria` (campos de creación)
- Debería esperar: `agente`, `nota`, `punto_entrega`, `descuento`, `fecha_entrega`

**Solución**: Reescribir completamente el middleware para:
1. Aceptar solo campos permitidos para actualización
2. Filtrar y descartar campos no permitidos
3. Validar tipos y rangos correctos
4. Agregar logs de depuración detallados

### 3. Cambios Implementados

#### Archivo: `src/presupuestos/routes/presupuestos.js`
```javascript
// ANTES (incorrecto)
router.put('/:id',
    validatePermissions('presupuestos.update'),
    validarIdPresupuesto,
    validarActualizarPresupuesto,  // ❌ Orden incorrecto
    sanitizarDatos,
    async (req, res) => { ... }
);

// DESPUÉS (corregido)
router.put('/:id',
    validatePermissions('presupuestos.update'),
    validarIdPresupuesto,
    sanitizarDatos,                // ✅ Orden correcto
    validarActualizarPresupuesto,
    async (req, res) => { ... }
);
```

#### Archivo: `src/presupuestos/middleware/validation.js`
- ✅ Campos permitidos corregidos: `['agente', 'nota', 'punto_entrega', 'descuento', 'fecha_entrega']`
- ✅ Filtrado de campos no permitidos
- ✅ Validaciones específicas por tipo de campo
- ✅ Logs de depuración detallados
- ✅ Sanitización mejorada para campos de actualización

### 4. Validaciones Implementadas

#### Campo `descuento`
- Acepta números y strings convertibles
- Convierte "12,50" → 12.50
- Rango: 0-100%
- Redondeo a 2 decimales

#### Campo `nota`
- Tipo: string
- Máximo: 500 caracteres
- Trim automático

#### Campo `agente`
- Tipo: string
- Máximo: 100 caracteres
- Trim automático

#### Campo `punto_entrega`
- Tipo: string
- Máximo: 200 caracteres
- Trim automático

#### Campo `fecha_entrega`
- Formato: YYYY-MM-DD
- Validación de fecha válida
- Permite null/empty

### 5. Logs de Depuración Agregados

```javascript
console.log(`📋 [PUT-LOG] PUT body keys: [${bodyKeys.join(', ')}] tipos: ${JSON.stringify(bodyTypes)} y ID recibido: ${id} (${typeof id})`);
console.log(`📋 [PUT-DEBUG] req.body completo:`, JSON.stringify(req.body, null, 2));
console.log(`[PUT-ACCEPT] Campo aceptado: ${key} = ${req.body[key]} (${typeof req.body[key]})`);
console.log(`[PUT-STRIP] Campo no permitido: ${key}`);
```

## Estado Actual

### ✅ Completado
1. Orden de middlewares corregido
2. Validación de campos corregida
3. Sanitización mejorada
4. Logs de depuración agregados

### 🔄 En Testing
- Probando PUT con datos válidos
- Verificando logs del servidor
- Confirmando que los campos llegan correctamente

## Próximos Pasos

1. **Verificar logs del servidor** para confirmar que los campos llegan correctamente
2. **Probar diferentes combinaciones** de campos
3. **Verificar integración** con el controlador de escritura
4. **Testing completo** del flujo de edición

## Archivos Modificados

- `src/presupuestos/routes/presupuestos.js` - Orden de middlewares
- `src/presupuestos/middleware/validation.js` - Validación completa reescrita
- `test_put.ps1` - Script de testing mejorado

## Comandos de Testing

```powershell
# Test básico
powershell -ExecutionPolicy Bypass -File test_put.ps1

# Test con curl (alternativo)
curl -X PUT "http://localhost:3003/api/presupuestos/4537174" -H "Content-Type: application/json" -d '{"descuento": 12.5, "nota": "Test"}'
