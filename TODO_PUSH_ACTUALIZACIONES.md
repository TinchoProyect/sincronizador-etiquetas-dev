# TODO: Push de Actualizaciones Local→Sheets

## Objetivo
Implementar push de actualizaciones (no solo altas) desde local hacia Google Sheets.

## Tareas

### ✅ 1. Análisis y Diagnóstico
- [x] Ubicar flujo del botón sync: `executeSyncronization()` → `ejecutarSincronizacionBidireccional()` → `pushCambiosLocalesConTimestamp()`
- [x] Confirmar que hoy solo inserta (append) y no actualiza
- [x] Identificar archivos: `sync_fechas_fix.js` (service y controller)

### 🔄 2. Cabecera - Upsert por ID
- [ ] Modificar `pushAltasLocalesASheets()` para detectar registros existentes
- [ ] Implementar actualización de filas existentes por `id_presupuesto_ext`
- [ ] Mantener "sticky delete" (Activo=false nunca a true)
- [ ] Respetar LWW con timestamps

### 🔄 3. Detalles - Replace-all por presupuesto  
- [ ] Modificar `pushDetallesLocalesASheets()` para eliminar detalles existentes
- [ ] Reinsertar detalles actuales desde BD local
- [ ] Mantener mapeos camp1↔Camp2, etc.

### 🔄 4. Detección de cambios
- [ ] Ampliar `pushCambiosLocalesConTimestamp()` para incluir modificados
- [ ] Usar `fecha_actualizacion` para detectar cambios

### 🔄 5. Logging
- [ ] Agregar contadores `headers_updated`, `details_replaced`
- [ ] Implementar log `[SYNC-PUSH]` final

## Archivos a Modificar
- `src/services/gsheets/sync_fechas_fix.js`
- `src/presupuestos/controllers/sync_fechas_fix.js`

## Criterio de Aceptación
Editar cantidad de detalle en local → 1 sincronización → cambios reflejados en Sheets con logs correctos.
