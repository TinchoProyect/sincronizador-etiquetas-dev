# SOLUCIÓN: Duplicación de Detalles en Sync Local→Google Sheets

## PROBLEMA IDENTIFICADO
La función `pushDetallesLocalesASheets` en `src/services/gsheets/sync_fechas_fix.js` hace `append` sin verificar duplicados, causando que el mismo detalle se inserte 2-3 veces en Google Sheets y AppSheet.

## ARCHIVOS A MODIFICAR

### 1. `src/services/gsheets/sync_fechas_fix.js`
**Función:** `pushDetallesLocalesASheets()`
**Cambio:** Implementar lógica UPSERT usando IDDetallePresupuesto como clave única

### 2. `src/services/gsheets/sync_fechas_fix.js` 
**Nueva función:** `limpiarDuplicadosDetalles()`
**Propósito:** Limpiar duplicados existentes antes de la sincronización

## IMPLEMENTACIÓN

### Clave de Unicidad
```javascript
const mkId = r => crypto.createHash('sha1')
  .update(`${r.id_presupuesto_ext}|${r.articulo}|${r.cantidad}|${r.valor1}|${r.precio1}|${r.iva1}|${r.diferencia}|${r.camp1}|${r.camp2}|${r.camp3}|${r.camp4}|${r.camp5}|${r.camp6}`)
  .digest('hex').slice(0, 8);
```

### Lógica UPSERT
1. Leer detalles existentes de Google Sheets
2. Crear mapa de IDs existentes → índice de fila
3. Para cada detalle local:
   - Si existe: UPDATE fila específica
   - Si no existe: APPEND nueva fila

### Limpieza de Duplicados
1. Leer todos los detalles de Google Sheets
2. Agrupar por IDDetallePresupuesto
3. Mantener solo la primera ocurrencia
4. Eliminar filas duplicadas

## VERIFICACIÓN MANUAL
1. Crear presupuesto en Local con 3 detalles
2. Ejecutar sincronización
3. Verificar en Google Sheets: exactamente 3 filas en DetallesPresupuestos
4. Verificar en AppSheet: exactamente 3 detalles sin duplicados
