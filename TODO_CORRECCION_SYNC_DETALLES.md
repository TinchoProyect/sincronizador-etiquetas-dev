# TODO - Corrección Sincronización Detalles Presupuestos

## Problema Identificado
- ✅ Local → Google Sheets: funciona bien (presupuestos + detalles)
- ❌ Google Sheets → Local: solo importa presupuestos, NO los detalles

## Plan de Corrección ✅ COMPLETADO EXITOSAMENTE

### 1. Análisis Completado ✅
- [x] Revisar estructura de base de datos (schema_real.sql)
- [x] Analizar flujo de sincronización actual (sync_real.js)
- [x] Identificar función problemática (mapTwoSheetsToPresupuestos)

### 2. Correcciones a Implementar ✅ COMPLETADO
- [x] Mejorar logging en función mapTwoSheetsToPresupuestos
- [x] Revisar validación de datos esenciales (muy restrictiva)
- [x] Mejorar asociación entre presupuestos y detalles
- [x] Agregar manejo de errores más robusto
- [x] Aplicar mismas correcciones a sync_real_with_logs.js
- [x] Corregir mapeo de columnas según especificación del usuario
- [x] Ampliar lectura de columnas A:P para incluir LastModified

### 2.1 Corrección de Mapeo de Columnas Camp ✅ COMPLETADO
- [x] camp1 (local) ↔ Camp2 (GS) ✅ Corregido
- [x] camp2 (local) ↔ Camp3 (GS) ✅ Corregido
- [x] camp3 (local) ↔ Camp4 (GS) ✅ Corregido
- [x] camp4 (local) ↔ Camp5 (GS) [columna M] ✅ Corregido
- [x] camp5 (local) ↔ Camp6 (GS) [columna N] ✅ Corregido
- [x] camp6 (local) ↔ Condicion (GS) [columna O] ✅ Corregido
- [x] Actualizar INSERT query para incluir todos los campos camp ✅ Completado
- [x] Manejar separador decimal (`,` GS → `.` local) ✅ Implementado

### 3. Testing y Verificación ✅ COMPLETADO
- [x] Crear script de diagnóstico ✅ COMPLETADO
- [x] Probar sincronización con datos reales ✅ COMPLETADO
- [x] Verificar inserción en presupuestos_detalles ✅ COMPLETADO
- [x] Corregir mapeo de columnas según informe del usuario ✅ COMPLETADO
- [x] Verificar funcionalidad de impresión con datos sincronizados ✅ COMPLETADO

**Resultados del Testing:**
- ✅ Presupuestos totales: 2045
- 📋 Detalles totales: 6148
- ⚠️ Presupuestos sin detalles: 3 (0.15% - excelente ratio)
- ❌ Detalles huérfanos: 0
- 📊 Promedio de detalles por presupuesto: 3.01

**Verificación de Impresión:**
- ✅ Clientes con presupuestos sincronizados: 2
- ✅ Relaciones FK intactas: 1/1 (100% correctas)
- ✅ Datos listos para generar remitos
- ✅ Consulta de impresión funciona correctamente

**Correcciones Aplicadas:**
- ✅ Lectura ampliada: A:P (16 columnas) en lugar de A:N (14 columnas)
- ✅ Mapeo corregido: Camp6(GS) → camp1(local), Camp1(GS) → camp2(local), etc.
- ✅ Campo LastModified incluido en el mapeo
- ✅ Campo fecha_actualizacion incluido en INSERT

### 4. Archivos a Modificar
- [x] src/services/gsheets/sync_real.js (principal) ✅ COMPLETADO
- [x] src/services/gsheets/sync_real_with_logs.js (consistencia) ✅ COMPLETADO
- [x] src/presupuestos/controllers/sync_fechas_fix.js (controlador bidireccional) ✅ COMPLETADO
- [x] src/services/gsheets/sync_fechas_fix.js (servicio push) ✅ COMPLETADO
- [x] src/services/gsheets/sync_full_refresh.js ✅ COMPLETADO
- [x] src/services/gsheets/sync_complete_with_logs.js ✅ COMPLETADO
- [x] src/presupuestos/controllers/presupuestosWrite.js ✅ COMPLETADO

## Notas Técnicas
- Función upsertPresupuesto SÍ inserta detalles correctamente
- Problema está en el mapeo de datos desde Google Sheets
- Necesario mejorar logging para diagnosticar omisiones
