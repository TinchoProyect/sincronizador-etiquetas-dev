# 📝 Guía de Campos Editables en Factura

## 🎯 Resumen

La página `ver-factura.html` tiene **4 campos editables** cuando la factura está en BORRADOR:

### 1. **Requiere AFIP** ✏️
- **Siempre visible** en BORRADOR
- Desplegable con 2 opciones:
  - "Sí - Factura AFIP"
  - "No - Factura Interna"
- Al cambiar, guarda automáticamente y recarga la página

### 2. **Tipo de Documento** ✏️
- **Solo visible si** `requiere_afip = true`
- Desplegable con opciones:
  - 99 - Consumidor Final
  - 80 - CUIT
  - 96 - DNI
  - 86 - CUIL

### 3. **Número de Documento** ✏️
- **Solo visible si** `requiere_afip = true`
- Input de texto
- Valor por defecto: "0" (para Consumidor Final)

### 4. **Condición IVA** ✏️ (CRÍTICO)
- **Solo visible si** `requiere_afip = true`
- Desplegable con opciones:
  - Consumidor Final
  - Responsable Inscripto
  - Responsable Monotributo
  - Exento
- ⚠️ **Obligatorio para AFIP**

## 🔄 Flujo de Uso

### Caso 1: Factura Interna → AFIP

**Estado Inicial:**
```
Requiere AFIP: [No - Factura Interna] ✏️
```

**Pasos:**
1. Cambiar desplegable a "Sí - Factura AFIP"
2. Confirmar en el diálogo
3. La página recarga automáticamente
4. **Ahora verás los 4 campos:**
   - Requiere AFIP: [Sí - Factura AFIP] ✏️
   - Tipo de Documento: [99 - CF] ✏️
   - Número de Documento: [0] ✏️
   - Condición IVA: [Consumidor Final] ✏️ (CRÍTICO)

### Caso 2: Editar Campos de Cliente

**Con requiere_afip = true:**

1. Modificar cualquier campo (doc_tipo, doc_nro, condicion_iva_id)
2. Aparece botón "💾 Guardar Cambios" (naranja)
3. Hacer clic en "Guardar"
4. Ver mensaje de confirmación
5. Hacer clic en "📄 Obtener CAE de AFIP"

## 🐛 Troubleshooting

### Problema: "No veo los campos editables"

**Verificar:**
1. ¿La factura está en BORRADOR? → Debe decir "BORRADOR" en el badge amarillo
2. ¿Requiere AFIP está en "Sí"? → Cambiar el desplegable a "Sí - Factura AFIP"

### Problema: "El desplegable no cambia"

**Verificar en consola:**
1. Abrir DevTools (F12)
2. Ir a pestaña "Consola"
3. Cambiar el desplegable
4. Deberías ver:
   ```
   🔄 cambiarTipoFactura() ejecutada
   📊 Valor seleccionado: true
   📊 requiereAfip: true
   📊 facturaActual.requiere_afip: false
   ```
5. Luego aparece el diálogo de confirmación
6. Si confirmas:
   ```
   ✅ Usuario confirmó el cambio
   💾 Guardando cambio de tipo...
   📊 facturaId: 8
   📊 requiereAfip: true
   📤 Enviando payload: {requiere_afip: true, serie_interna: null}
   📥 Response status: 200
   📥 Response data: {success: true, ...}
   ✅ Cambio guardado, recargando página...
   ```

### Problema: "Error al guardar"

**Verificar:**
1. ¿El servidor de facturación está corriendo? → `http://localhost:3004`
2. ¿El endpoint PUT funciona? → Revisar logs del servidor
3. ¿La BD está accesible? → Verificar conexión PostgreSQL

## 📊 Estados de la Factura

| Estado | Requiere AFIP | Campos Editables | Botones |
|--------|---------------|------------------|---------|
| BORRADOR + requiere_afip=false | ✏️ Sí/No | 1 (solo requiere_afip) | Cerrar, Imprimir |
| BORRADOR + requiere_afip=true | ✏️ Sí/No | 4 (todos) | Guardar, Obtener CAE, Cerrar, Imprimir |
| APROBADA | No editable | 0 | Cerrar, Imprimir |
| RECHAZADA | No editable | 0 | Cerrar, Imprimir |

## ✅ Checklist de Testing

- [ ] Abrir factura con requiere_afip=false
- [ ] Ver 1 campo editable (Requiere AFIP)
- [ ] Cambiar a "Sí - Factura AFIP"
- [ ] Confirmar cambio
- [ ] Verificar que recarga la página
- [ ] Ver 4 campos editables
- [ ] Modificar Tipo de Documento
- [ ] Modificar Número de Documento
- [ ] Modificar Condición IVA
- [ ] Ver botón "Guardar Cambios" aparecer
- [ ] Guardar cambios
- [ ] Ver mensaje de confirmación
- [ ] Hacer clic en "Obtener CAE"
- [ ] Verificar que obtiene CAE exitosamente

## 🎨 Indicadores Visuales

**Campos Editables:**
- Fondo: Amarillo claro (#fffbeb)
- Borde izquierdo: Naranja (#f59e0b)
- Icono: ✏️ en el título
- Texto de ayuda: Color naranja debajo del campo

**Campos No Editables:**
- Fondo: Gris claro (#f8f9fa)
- Borde izquierdo: Morado (#667eea)
- Sin icono ✏️
- Sin texto de ayuda
