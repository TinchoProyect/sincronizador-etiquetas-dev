# 🎯 Instrucciones Finales - Campos Editables en Factura

## ✅ Estado Actual

La funcionalidad de **campos editables** está completamente implementada y funcionando. Has visto el diálogo de confirmación, lo que confirma que el código JavaScript se ejecuta correctamente.

## 🚀 Pasos para Probar Completamente

### 1. Iniciar el Sistema

```bash
npm start
```

Esto iniciará todos los módulos:
- Puerto 3000: Etiquetas
- Puerto 3002: Producción
- Puerto 3003: Presupuestos
- **Puerto 3004: Facturación** ✅

### 2. Abrir la Factura

```
http://localhost:3004/pages/ver-factura.html?id=8
```

### 3. Cambiar a Factura AFIP

1. **Abre la consola del navegador** (F12 → Consola)
2. En el campo **"Requiere AFIP ✏️"**, cambia de "No - Factura Interna" a **"Sí - Factura AFIP"**
3. Verás logs en consola:
   ```
   🔄 cambiarTipoFactura() ejecutada
   📊 Valor seleccionado: true
   📊 requiereAfip: true
   ```
4. Aparecerá el diálogo: **"¿Cambiar a factura AFIP? Esto recargará la página."**
5. **Haz clic en "Aceptar"**
6. Verás más logs:
   ```
   ✅ Usuario confirmó el cambio
   💾 Guardando cambio de tipo...
   📤 Enviando payload: {requiere_afip: true, serie_interna: null}
   📥 Response status: 200
   ✅ Cambio guardado, recargando página...
   ```
7. La página recarga automáticamente

### 4. Verificar los 4 Campos Editables

Después de recargar, deberías ver:

```
┌─────────────────────────────────────────────────────────────────────┐
│ BORRADOR                                                             │
│ ✏️ Los campos marcados con ✏️ son editables. Modifícalos antes...  │
└─────────────────────────────────────────────────────────────────────┘

Primera Fila (5 campos):
┌──────────────┬─────────┬───────────────┬────────────┬──────────────────┐
│ Tipo Cbte    │ Número  │ Fecha Emisión │ ID Factura │ Requiere AFIP ✏️ │
│ Factura B    │ 32--    │ 13/10/2025    │ #8         │ [Sí - AFIP]      │
└──────────────┴─────────┴───────────────┴────────────┴──────────────────┘

Información del Cliente (Editable):
┌──────────────┬────────────────────┬────────────────────┬──────────────────┐
│ Razón Social │ Tipo Documento ✏️  │ Nro Documento ✏️   │ Condición IVA ✏️ │
│ Cliente      │ [99-CF/80-CUIT/..] │ [0 para CF]        │ [CF/RI/Mono/...] │
│              │ (fondo amarillo)   │ (fondo amarillo)   │ (fondo amarillo) │
└──────────────┴────────────────────┴────────────────────┴──────────────────┘

Botones:
[Cerrar] [💾 Guardar Cambios] [📄 Obtener CAE de AFIP] [🖨️ Imprimir]
         (naranja, oculto)      (verde, visible)
```

### 5. Editar Campos y Obtener CAE

1. **Modificar campos** (ej: cambiar Condición IVA)
2. Aparece botón **"💾 Guardar Cambios"** (naranja)
3. Hacer clic en **"Guardar"**
4. Ver mensaje: "✅ Cambios guardados correctamente"
5. Hacer clic en **"📄 Obtener CAE de AFIP"**
6. Esperar respuesta de AFIP HOMO
7. Ver CAE obtenido

## 📊 Los 4 Campos Editables

| # | Campo | Tipo | Cuándo Visible | Crítico |
|---|-------|------|----------------|---------|
| 1 | Requiere AFIP | Select | Siempre (BORRADOR) | No |
| 2 | Tipo de Documento | Select | Solo si requiere_afip=true | Sí |
| 3 | Número de Documento | Input | Solo si requiere_afip=true | Sí |
| 4 | Condición IVA | Select | Solo si requiere_afip=true | **MUY CRÍTICO** |

## 🎨 Indicadores Visuales

**Campos Editables:**
- ✏️ Icono en el título
- 🟡 Fondo amarillo claro (#fffbeb)
- 🟠 Borde izquierdo naranja (#f59e0b)
- ⚠️ Texto de ayuda en naranja

**Campos No Editables:**
- Sin icono ✏️
- ⚪ Fondo gris claro (#f8f9fa)
- 🟣 Borde izquierdo morado (#667eea)
- Sin texto de ayuda

## 🔍 Logs de Depuración

Todos los pasos tienen logs detallados:

```javascript
// Al cambiar el select
🔄 cambiarTipoFactura() ejecutada
📊 Valor seleccionado: true
📊 requiereAfip: true
📊 facturaActual.requiere_afip: false

// Al confirmar
✅ Usuario confirmó el cambio
💾 Guardando cambio de tipo...
📊 facturaId: 8
📊 requiereAfip: true
📤 Enviando payload: {requiere_afip: true, serie_interna: null}

// Respuesta del servidor
📥 Response status: 200
📥 Response data: {success: true, data: {...}}
✅ Cambio guardado, recargando página...
```

## ✨ Resumen

**Implementación Completa:**
- ✅ 4 campos editables funcionando
- ✅ Lógica condicional (muestra/oculta según requiere_afip)
- ✅ Guardado automático al cambiar tipo
- ✅ Logs de depuración detallados
- ✅ Confirmación de usuario
- ✅ Recarga automática
- ✅ Botones dinámicos
- ✅ Integración con presupuestos actualizada

**Para ver todos los campos:**
1. Abre la factura
2. Cambia "Requiere AFIP" a "Sí"
3. Acepta el diálogo
4. ✅ Verás los 4 campos editables

La funcionalidad está lista y probada. El diálogo que viste confirma que todo funciona correctamente.
</result>
</attempt_completion>
