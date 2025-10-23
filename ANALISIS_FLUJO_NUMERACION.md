# Análisis del Flujo de Numeración de Facturas

## 🔍 Situación Actual

Tenemos **DOS flujos diferentes** que crean facturas:

### Flujo 1: Desde Presupuestos (NUEVO - modificado hoy)
```
Presupuesto → [presupuestoFacturaService.facturarPresupuesto()]
  ↓
  - Asigna número con nextAfip() ✅
  - Guarda cbte_nro en BD
  - Estado: BORRADOR
  ↓
Usuario click "Obtener CAE" → [facturaService.emitir()]
  ↓
  - Intenta asignar número OTRA VEZ ❌ ← AQUÍ FALLA
  - Error: "Factura ya tiene número"
```

### Flujo 2: Desde UI Manual (ANTIGUO)
```
UI Manual → [facturaService.crearBorrador()]
  ↓
  - NO asigna número
  - cbte_nro = NULL
  - Estado: BORRADOR
  ↓
Usuario click "Obtener CAE" → [facturaService.emitir()]
  ↓
  - Asigna número con nextAfip() ✅
  - Guarda cbte_nro
  - Solicita CAE
```

## 🤔 El Dilema

Hay **dos enfoques posibles**:

### Opción A: Asignar Número AL CREAR (tu enfoque actual)
```
✅ VENTAJAS:
- Factura completa desde el inicio
- Número visible en pantalla antes del CAE
- Más transparente para el usuario

❌ DESVENTAJAS:
- Si falla la obtención del CAE, el número queda "quemado"
- Puede generar huecos en la numeración
- No es lo que hace AFIP oficialmente
```

### Opción B: Asignar Número AL EMITIR (estándar AFIP)
```
✅ VENTAJAS:
- Número y CAE se asignan juntos (atómico)
- Si falla, NO se quema un número
- Numeración continua garantizada
- Es el flujo oficial recomendado por AFIP
- Más robusto ante errores

❌ DESVENTAJAS:
- Usuario no ve el número hasta obtener CAE
- Factura en BORRADOR no tiene número visible
```

## 📊 ¿Qué hace AFIP en producción?

Según la documentación oficial de AFIP:

1. **Consultar último número autorizado**: `FECompUltimoAutorizado`
2. **Calcular siguiente**: último + 1
3. **Enviar a AFIP**: `FECAESolicitar` con ese número
4. **AFIP valida**: Si el número es correcto, devuelve CAE
5. **Si falla**: El número NO se consumió, puedes reintentarlo

**IMPORTANTE**: AFIP espera que el número sea **último_autorizado + 1**. Si envías un número incorrecto (por ejemplo, salteas uno), AFIP lo rechaza.

## 🎯 Recomendación para Producción

### **Opción B es la correcta**

**Razones:**

1. **Atomicidad**: Número y CAE se asignan juntos en una sola transacción
2. **Sin huecos**: Si falla el CAE, el número no se desperdicia
3. **Reintentable**: Puedes reintentar sin problemas de numeración
4. **Estándar AFIP**: Es el flujo que AFIP espera
5. **Más robusto**: Menos puntos de falla

### Flujo Recomendado:

```
1. CREAR FACTURA (presupuestoFacturaService)
   - Validar todos los datos
   - Calcular totales
   - Guardar en BD
   - cbte_nro = NULL
   - Estado = BORRADOR
   ✅ Factura lista para CAE, pero sin número

2. OBTENER CAE (facturaService.emitir)
   TRANSACCIÓN ATÓMICA:
   a) Obtener último autorizado de AFIP
   b) Calcular siguiente = último + 1
   c) Actualizar numeración local
   d) Solicitar CAE a AFIP con ese número
   e) Si éxito: Guardar número + CAE
   f) Si falla: Rollback, número no se quema
   ✅ Número y CAE asignados juntos
```

## 🔧 Cambios Necesarios

### En `presupuestoFacturaService.js`:
```javascript
// REMOVER esto:
const cbteNro = await nextAfip(cabecera.pto_vta, cabecera.tipo_cbte, ENTORNO);

// CAMBIAR el INSERT para que cbte_nro sea NULL:
const insertFacturaQuery = `
    INSERT INTO factura_facturas (
        tipo_cbte, pto_vta, cbte_nro, concepto, fecha_emision,
        ...
    ) VALUES (
        $1, $2, NULL, $4, $5,  -- cbte_nro en NULL
        ...
    )
`;
```

### En `facturaService.js`:
```javascript
// MANTENER como está (ya asigna número al emitir)
const emitirAfip = async (factura) => {
    // 1. Obtener número
    const cbteNro = await nextAfip(factura.pto_vta, factura.tipo_cbte, ENTORNO);
    
    // 2. Solicitar CAE
    const resultadoCAE = await solicitarCAE(factura.id, ENTORNO);
    
    // 3. Guardar todo junto
    UPDATE factura_facturas SET cbte_nro = $1, cae = $2, ...
};
```

## 📝 Beneficios de este Enfoque

### En Homologación (pruebas):
- ✅ Puedes probar múltiples veces sin quemar números
- ✅ Si falla, simplemente reintentás
- ✅ La numeración se mantiene ordenada

### En Producción:
- ✅ Numeración continua garantizada
- ✅ Sin huecos por errores
- ✅ Transacciones atómicas
- ✅ Cumple con el estándar AFIP
- ✅ Robusto ante fallos de red

## 🎬 Usuario Final

**LO QUE VE EL USUARIO:**

1. Convierte Presupuesto → Factura
   - Ve: "Factura BORRADOR #62 creada"
   - Número de factura: "Sin número asignado"
   
2. Click "Obtener CAE"
   - Sistema solicita a AFIP
   - AFIP asigna: PV 32, Número 15
   - Usuario ve: "CAE obtenido - Factura 00032-00000015"

**Es transparente y profesional.**

## ⚠️ Caso de Error

Si por alguna razón falla la obtención del CAE:

**Con Opción A** (número al crear):
- ❌ Número 15 ya fue asignado y guardado
- ❌ Si reintentás, usará número 16
- ❌ Número 15 queda "quemado"
- ❌ Hueco en la numeración

**Con Opción B** (número al emitir):
- ✅ Número 15 nunca se guardó
- ✅ Si reintentás, usará número 15 nuevamente
- ✅ Sin huecos
- ✅ Numeración continua

## 🎯 Conclusión

**Recomiendo REVERTIR el cambio** de asignar número en `presupuestoFacturaService` y dejar que `facturaService.emitir()` sea el único lugar donde se asigna número.

**Esto garantiza:**
- 🔒 Transacciones atómicas
- 📊 Numeración continua
- ✅ Cumplimiento con AFIP
- 🛡️ Robustez ante errores
- 🎯 Producción impecable

¿Qué te parece esta propuesta?
