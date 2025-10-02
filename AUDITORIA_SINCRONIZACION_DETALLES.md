# Auditoría Completa de Sincronización de Detalles

**Fecha:** Diciembre 2024  
**Sistema:** Sincronizador de Etiquetas - Módulo Presupuestos  
**Alcance:** Análisis exhaustivo de la sincronización de detalles entre Base de Datos Local y Google Sheets

---

## 1. INVENTARIO DE SINCRONIZACIÓN

### Funciones que Escriben Detalles en Google Sheets

#### 1.1 writePresupuestoDetails
- **Ruta exacta:** `src/services/gsheets/writer.js` (líneas 95-220)
- **Quién la llama:** 
  - `pushDetallesLocalesASheets` en `src/services/gsheets/sync_fechas_fix.js`
  - Funciones de sincronización bidireccional
- **Operación:** **UPSERT** (Update si existe, Insert si es nuevo)
- **Descripción:** Función principal para escribir detalles en hoja "DetallesPresupuestos". Lee detalles existentes, compara por `IDDetallePresupuesto`, actualiza filas existentes o inserta nuevas. Incluye deduplicación preventiva.

#### 1.2 pushDetallesLocalesASheets
- **Ruta exacta:** `src/services/gsheets/sync_fechas_fix.js` (líneas 520-620)
- **Quién la llama:**
  - `ejecutarCorreccionFechas` en el mismo archivo
  - `pushToSheetsFireAndForget` en `src/presupuestos/controllers/presupuestosWrite.js`
  - Controllers de sincronización en `src/presupuestos/controllers/sync_fechas_fix.js`
- **Operación:** **UPSERT** (Update + Insert)
- **Descripción:** Push de detalles locales nuevos a Google Sheets. Lee detalles existentes para detectar duplicados, actualiza fila existente si encuentra `IDDetallePresupuesto`, inserta nueva fila si no existe.

#### 1.3 pushDetallesModificadosASheets
- **Ruta exacta:** `src/services/gsheets/sync_fechas_fix.js` (líneas 680-780)
- **Quién la llama:** Funciones de sincronización de cambios locales
- **Operación:** **UPSERT** (Update + Insert)
- **Descripción:** Sincroniza detalles modificados localmente (últimas 24 horas) a Sheets. Detecta detalles modificados por `fecha_actualizacion`, actualiza si existe en Sheets, inserta si es nuevo.

### Funciones que Escriben Detalles en Base de Datos Local

#### 1.4 upsertDetalle
- **Ruta exacta:** `src/services/gsheets/database.js` (líneas 85-150)
- **Quién la llama:** `upsertDetalles` en el mismo archivo
- **Operación:** **UPSERT** (Insert con ON CONFLICT DO UPDATE)
- **Descripción:** UPSERT individual de detalle en PostgreSQL. Usa `INSERT` con `ON CONFLICT (id_presupuesto_ext, articulo) DO UPDATE`, actualiza todos los campos en caso de conflicto.

#### 1.5 upsertDetalles
- **Ruta exacta:** `src/services/gsheets/database.js` (líneas 200-260)
- **Quién la llama:**
  - `sync_orchestrator.js` línea 180
  - `jobs/sync.js` línea 45
- **Operación:** **UPSERT** (lote)
- **Descripción:** Procesa lote de detalles para UPSERT. Llama a `upsertDetalle` para cada elemento del lote.

#### 1.6 Inserción directa en crearPresupuesto
- **Ruta exacta:** `src/presupuestos/controllers/presupuestosWrite.js` (líneas 150-180)
- **Quién la llama:** Endpoint POST `/presupuestos` (crear presupuesto)
- **Operación:** **INSERT** directo
- **Descripción:** Inserción directa de detalles al crear presupuestos. Calcula campos normalizados y ejecuta INSERT directo en `presupuestos_detalles`.

#### 1.7 Inserción directa en editarPresupuesto
- **Ruta exacta:** `src/presupuestos/controllers/presupuestosWrite.js` (líneas 350-380)
- **Quién la llama:** Endpoint PUT `/presupuestos/:id` (editar presupuesto)
- **Operación:** **DELETE + INSERT** (reemplazo completo)
- **Descripción:** Al editar presupuesto con detalles, elimina todos los detalles existentes y inserta los nuevos detalles normalizados.

#### 1.8 Inserción masiva en ejecutarCorreccionFechas
- **Ruta exacta:** `src/services/gsheets/sync_fechas_fix.js` (líneas 280-320)
- **Quién la llama:** `ejecutarCorreccionFechas` (corrección de fechas)
- **Operación:** **INSERT** directo (full refresh)
- **Descripción:** Inserción masiva durante corrección de fechas. Ejecuta DELETE completo de tabla presupuestos (CASCADE elimina detalles), luego INSERT masivo de todos los detalles.

#### 1.9 Inserción en sync_complete_with_logs.js
- **Ruta exacta:** `src/services/gsheets/sync_complete_with_logs.js` (líneas 280-320)
- **Quién la llama:** `upsertPresupuesto` en el mismo archivo
- **Operación:** **INSERT** directo (con DELETE previo)
- **Descripción:** Función de sincronización completa con logs detallados. Para presupuestos existentes, elimina detalles previos y reinserta todos los detalles. Para presupuestos nuevos, inserta directamente.

### Funciones de Limpieza

#### 1.10 limpiarDuplicadosDetalles (writer.js)
- **Ruta exacta:** `src/services/gsheets/writer.js` (líneas 230-320)
- **Quién la llama:** Funciones de mantenimiento
- **Operación:** **DELETE** (eliminación de duplicados)
- **Descripción:** Elimina duplicados en Google Sheets por `IDDetallePresupuesto`. Mantiene la versión más reciente según `LastModified`.

#### 1.11 limpiarDuplicadosDetalles (sync_fechas_fix.js)
- **Ruta exacta:** `src/services/gsheets/sync_fechas_fix.js` (líneas 620-680)
- **Quién la llama:** Funciones de mantenimiento
- **Operación:** **DELETE** (eliminación de duplicados)
- **Descripción:** Versión alternativa de limpieza de duplicados en Sheets. Mantiene solo la primera ocurrencia de cada `IDDetallePresupuesto`.

---

## 2. FLUJO ACTUAL DE DETALLES

### Flujo Local → Sheets (Escritura de Detalles Locales a Google Sheets)

#### Paso 1: Punto de Entrada
- **Ruta:** `src/presupuestos/controllers/presupuestosWrite.js`
- **Línea:** 125-130 (función `pushToSheetsFireAndForget`)
- **Trigger:** Después del COMMIT exitoso al crear/editar presupuesto local

#### Paso 2: Lectura de Datos Actuales de Sheets
- **Ruta:** `src/presupuestos/controllers/presupuestosWrite.js`
- **Línea:** 140-145
- **Acción:** `readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos')`
- **Propósito:** Obtener IDs existentes para filtrar qué enviar

#### Paso 3: Push de Cabeceras (si es necesario)
- **Ruta:** `src/presupuestos/controllers/presupuestosWrite.js`
- **Línea:** 150-155
- **Función:** `pushAltasLocalesASheets(presupuestosData, config, db)`

#### Paso 4: Push de Detalles - Función Principal
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 520 (función `pushDetallesLocalesASheets`)
- **Entrada:** `insertedIds` (Set de IDs de presupuestos a procesar)

#### Paso 5: Lectura de Detalles Existentes en Sheets
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 535-540

#### Paso 6: Consulta de Detalles Locales
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 545-555

#### Paso 7: DECISIÓN APPEND vs UPDATE
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 585 - `if (existingRowIndex)` determina si hacer UPDATE o APPEND
- **Lógica:** Si existe el `IDDetallePresupuesto` en el mapa de filas existentes → UPDATE, sino → APPEND

### Flujo Sheets → Local (Sincronización de Detalles desde Google Sheets)

#### Paso 1: Punto de Entrada Principal
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 50 (función `ejecutarCorreccionFechas`)
- **Trigger:** Sincronización manual o automática

#### Paso 2: Lectura de Datos desde Sheets
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 85-90

#### Paso 3: Filtrado por Bajas Lógicas
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 110-125
- **Lógica:** Excluye presupuestos marcados como `activo = false` en BD local

#### Paso 4: Push de Altas Locales (Bidireccional)
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 130-135

#### Paso 5: Re-lectura Post-Push
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 140-145

#### Paso 6: Inicio de Transacción Atómica
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 160-165
- **Operación:** DELETE completo + INSERT masivo (full refresh)

#### Paso 7: Procesamiento de Detalles desde Sheets
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 280-320
- **Nota:** En el flujo Sheets→Local, NO hay decisión append vs update. Se hace DELETE completo + INSERT masivo

---

## 3. VERIFICACIÓN DE CLAVES

### Generación de IDDetallePresupuesto

#### 3.1 Generación por Hash (Método Principal)
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Líneas:** 560-562 y 720-722
- **Método:** SHA1 hash basado en todos los campos del detalle

#### 3.2 Generación por Hash (Método Alternativo)
- **Ruta:** `src/services/gsheets/writer.js`
- **Líneas:** 110-115
- **Método:** Fallback si no existe `id_detalle_presupuesto`

#### 3.3 Generación por Timestamp (Local)
- **Ruta:** `src/presupuestos/controllers/presupuestosWrite.js`
- **Líneas:** 25-29
- **Uso:** Para detalles creados localmente (NO se usa para IDDetallePresupuesto en Sheets)

### Validación de IDDetallePresupuesto

#### 3.4 Validación en Lectura desde Sheets
- **Ruta:** `src/services/gsheets/sync_real.js`
- **Líneas:** 180-185
- **Acción:** Omite filas sin IDDetallePresupuesto

#### 3.5 Validación en Limpieza de Duplicados
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Líneas:** 650-655
- **Acción:** Salta filas sin ID en limpieza

### Escritura SIN IDDetallePresupuesto PERMITIDA

#### 3.6 Inserción Directa en Base de Datos Local (SIN ID)
- **Ruta:** `src/presupuestos/controllers/presupuestosWrite.js`
- **Líneas:** 170-180 (crear) y 380-390 (editar)
- **CRÍTICO:** NO incluye `id_detalle_presupuesto` en la inserción local

#### 3.7 Inserción en Sync Full Refresh (SIN ID)
- **Ruta:** `src/services/gsheets/sync_fechas_fix.js`
- **Líneas:** 300-315
- **CRÍTICO:** NO incluye `id_detalle_presupuesto` en la inserción

#### 3.8 Inserción en Sync Controllers (SIN ID)
- **Ruta:** `src/presupuestos/controllers/sync_fechas_fix.js`
- **Líneas:** 180-190
- **CRÍTICO:** NO incluye `id_detalle_presupuesto` ni `id_presupuesto`

### Inconsistencias Críticas Detectadas

1. **Base de Datos Local NO almacena IDDetallePresupuesto**
2. **Generación Inconsistente de IDs** según el contexto
3. **Validación Inconsistente** entre Sheets y Local
4. **Función sync_complete_with_logs.js ADICIONAL** - Se identificó una función adicional de inserción de detalles que no estaba en el inventario inicial

---

## 4. DETECTOR DE DUPLICACIÓN

### Doble Escritura por Flujo Bidireccional

#### 4.1 Push Automático + Sincronización Manual
- **Archivo:** `src/presupuestos/controllers/presupuestosWrite.js`
- **Línea:** 150-155 (pushToSheetsFireAndForget)
- **Conflicto con:** `src/services/gsheets/sync_fechas_fix.js` línea 130-135
- **Escenario:** Usuario crea presupuesto → push automático → sincronización manual inmediata

#### 4.2 Doble Push en Corrección de Fechas
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Líneas:** 130-135 y 140-145
- **Riesgo:** Si hay error entre push y re-lectura, puede duplicar

### Doble Escritura por Reintentos

#### 4.3 Reintento de writePresupuestoDetails
- **Archivo:** `src/services/gsheets/writer.js`
- **Líneas:** 160-220
- **Problema:** Si falla después de algunos INSERT pero antes del final

#### 4.4 Reintento de pushDetallesLocalesASheets
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Líneas:** 580-620
- **Problema:** Procesa cada detalle sin transacción atómica

### Doble Escritura por Concurrencia

#### 4.5 Múltiples Procesos de Sincronización
- **Archivo:** `src/jobs/sync.js`
- **Líneas:** 40-50
- **Conflicto con:** `src/services/gsheets/sync_fechas_fix.js` línea 50
- **Problema:** No hay mutex entre diferentes tipos de sync

#### 4.6 Push Automático Concurrente
- **Archivo:** `src/presupuestos/controllers/presupuestosWrite.js`
- **Líneas:** 150-155
- **Problema:** `setImmediate` no previene concurrencia

### Doble Escritura por Falta de Idempotencia

#### 4.7 Generación de ID No Determinística
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Líneas:** 560-562
- **Riesgo:** Si los valores cambian mínimamente entre llamadas, genera ID diferente

#### 4.8 Falta de Verificación Pre-Escritura
- **Archivo:** `src/services/gsheets/writer.js`
- **Líneas:** 130-140
- **Problema:** Lee existentes una sola vez al inicio

---

## 5. VENTANA Y WATERMARKS

### Filtros por Fechas Existentes

#### 5.1 Filtro por Fecha de Actualización (24 horas)
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 700-705
- **Propósito:** Detecta detalles modificados localmente en las últimas 24 horas

#### 5.2 Filtro por Fecha de Actualización (1 hora)
- **Archivo:** `src/presupuestos/controllers/sync_fechas_fix.js`
- **Línea:** 285-290
- **Propósito:** Consulta presupuestos modificados en la última hora

#### 5.3 Validación de Fechas Futuras
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 330-335
- **Propósito:** Detecta fechas futuras después de corrección

### Filtros por Fechas NO Existentes en Sincronización

#### 5.4 Lectura Completa de Google Sheets (SIN FILTRO)
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Líneas:** 85-90
- **Problema:** Lee TODOS los datos de Sheets sin filtro temporal

#### 5.5 Lectura en Otros Servicios de Sync (SIN FILTRO)
- **Archivo:** `src/services/gsheets/sync_real.js`
- **Líneas:** 85-90
- **Problema:** Sin filtro por fechas en sincronización principal

### Puntos Exactos para Agregar Filtro de 60 Días

#### 5.6 Filtro en Lectura de Google Sheets (CRÍTICO)
- **Archivo:** `src/services/gsheets/client_with_logs.js`
- **Línea:** 135 (después de obtener rows)
- **Lógica necesaria:** Filtrar `rows` por columna de fecha

#### 5.7 Filtro en Función Principal de Corrección
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 95 (antes del filtrado por bajas lógicas)
- **Lógica necesaria:** Filtrar `presupuestosData.rows` por fecha >= (HOY - 60 días)

#### 5.8 Filtro en Sincronización Principal
- **Archivo:** `src/services/gsheets/sync_real.js`
- **Línea:** 95 (antes del mapeo de datos)
- **Lógica necesaria:** Filtrar por columna B (Fecha) >= (HOY - 60 días)

#### 5.9 Filtro en Jobs Automáticos
- **Archivo:** `src/jobs/sync.js`
- **Línea:** 40 (antes del procesamiento)
- **Lógica necesaria:** Filtrar ambos datasets por fecha

---

## 6. LWW REAL (Last-Write-Wins)

### Comparación de LastModified Existente

#### 6.1 Comparación por Lote (NO por fila individual)
- **Archivo:** `src/services/gsheets/writer.js`
- **Líneas:** 110-120
- **PROBLEMA:** Compara solo dentro del lote entrante, NO contra datos existentes en Sheets

#### 6.2 Comparación en Limpieza de Duplicados
- **Archivo:** `src/services/gsheets/writer.js`
- **Líneas:** 280-295
- **CONTEXTO:** Solo para limpieza de duplicados, NO para sincronización normal

### Falta de Comparación por Fila en Sincronización

#### 6.3 Escritura sin Comparación LWW
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Líneas:** 580-620
- **PROBLEMA CRÍTICO:** Actualiza sin verificar si la versión local es más reciente

#### 6.4 Lectura de Existentes sin LastModified
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Líneas:** 535-545
- **PROBLEMA:** No captura LastModified de filas existentes para comparación

### Lugares Correctos para Aplicar LWW por Detalle

#### 6.5 Punto Crítico Principal
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 535-545 (modificar lectura de existentes)
- **Cambio necesario:** Capturar LastModified de filas existentes

#### 6.6 Punto de Decisión LWW
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 585-590 (modificar lógica de decisión)
- **Cambio necesario:** Comparar timestamps antes de UPDATE

#### 6.7 Captura de LastModified Local
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 545-555 (modificar query SQL)
- **Cambio necesario:** Incluir fecha_actualizacion en query

#### 6.8 Función Helper para LWW
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** Agregar después de línea 520
- **Función necesaria:** Comparar timestamps para Last-Write-Wins

---

## 7. MÉTRICAS Y ABORTOS SEGUROS

### Contadores Existentes para Detalles

#### 7.1 Contadores en writer.js (Google Sheets)
- **Archivo:** `src/services/gsheets/writer.js`
- **Líneas:** 150-160
- **✅ TIENE:** inserts, updates, errores
- **❌ FALTA:** leídos, omitidos, sin-key

#### 7.2 Contadores en sync_fechas_fix.js (Push Detalles)
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Líneas:** 575-580
- **✅ TIENE:** insertados, actualizados
- **❌ FALTA:** leídos, omitidos, errores, sin-key

#### 7.3 Contadores en database.js (UPSERT)
- **Archivo:** `src/services/gsheets/database.js`
- **Líneas:** 200-210
- **✅ TIENE:** total, successful, failed, inserted, updated
- **❌ FALTA:** leídos, omitidos, sin-key

### Contadores Faltantes Identificados

#### 7.4 Detalles Leídos
- **❌ NO EXISTE** en ninguna función
- **Necesario para:** Saber cuántos detalles se procesaron desde el origen

#### 7.5 Detalles Omitidos
- **❌ NO EXISTE** contador específico para detalles
- **Existe solo para presupuestos:** `detallesOmitidos` en sync_real.js línea 250
- **Necesario para:** Detalles saltados por validación o filtros

#### 7.6 Detalles Sin Key
- **❌ NO EXISTE** en ninguna función
- **Necesario para:** Detalles sin IDDetallePresupuesto válido

#### 7.7 Contadores en sync_complete_with_logs.js
- **Archivo:** `src/services/gsheets/sync_complete_with_logs.js`
- **Líneas:** 150-200
- **✅ TIENE:** registros_procesados, registros_nuevos, registros_actualizados, errores
- **❌ FALTA:** contadores específicos para detalles (leídos, omitidos, sin-key)

### Lugares Exactos para Agregar Contadores Faltantes

#### 7.7 En writePresupuestoDetails (writer.js)
- **Archivo:** `src/services/gsheets/writer.js`
- **Línea:** 105 (después de leer datos existentes)
- **Agregar:** `leidos`, `omitidos`, `sinKey`
- **Línea:** 200 (modificar log existente)

#### 7.8 En pushDetallesLocalesASheets (sync_fechas_fix.js)
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 545 (después de query SQL)
- **Agregar:** `leidos`, `omitidos`, `sinKey`, `errores`
- **Línea:** 620 (modificar log existente)

#### 7.9 En pushDetallesModificadosASheets (sync_fechas_fix.js)
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 700 (después de query SQL)
- **Agregar:** `leidos`, `omitidos`, `sinKey`, `errores`
- **Línea:** 780 (modificar log existente)

#### 7.10 En upsertDetalles (database.js)
- **Archivo:** `src/services/gsheets/database.js`
- **Línea:** 200 (inicio de función)
- **Agregar:** `leidos`, `omitidos`, `sinKey`
- **Línea:** 250 (modificar log existente)

#### 7.11 En ejecutarCorreccionFechas (sync_fechas_fix.js)
- **Archivo:** `src/services/gsheets/sync_fechas_fix.js`
- **Línea:** 150 (en estructura resultado)
- **Agregar:** campos específicos para detalles
- **Línea:** 400 (en mostrarResumenOperacion)

#### 7.12 En sync_complete_with_logs.js
- **Archivo:** `src/services/gsheets/sync_complete_with_logs.js`
- **Línea:** 50 (en estructura syncLog)
- **Agregar:** `detalles_leidos`, `detalles_omitidos`, `detalles_sin_key`
- **Línea:** 280 (en función upsertPresupuesto)
- **Agregar:** contadores para detalles procesados
- **Línea:** 400 (en resumen final)

---

## CONCLUSIONES Y RECOMENDACIONES

### Problemas Críticos Identificados

1. **Falta de LWW por fila individual** - Los detalles se sobrescriben sin comparar LastModified
2. **Duplicación por concurrencia** - Múltiples flujos pueden escribir la misma fila
3. **Inconsistencia en claves** - IDDetallePresupuesto no se almacena localmente
4. **Ausencia de filtros temporales** - Se procesan todos los datos sin límite de fecha
5. **Métricas insuficientes** - Faltan contadores críticos para debugging
6. **Función adicional no documentada** - sync_complete_with_logs.js contiene lógica de inserción de detalles que no estaba en el análisis inicial

### Archivos Adicionales Identificados

Durante la verificación final se identificaron archivos adicionales en `services/gsheets` que contienen funciones de escritura de detalles:

- **sync_complete_with_logs.js** - Función completa de sincronización con logs detallados
- **sync_fixed.js** - Archivo obsoleto que redirige a sync_real.js (no contiene lógica activa)

### Impacto en la Integridad de Datos

- **Alto riesgo** de pérdida de cambios recientes
- **Posible corrupción** por escrituras concurrentes
- **Dificultad de debugging** por falta de métricas
- **Rendimiento degradado** por procesamiento de datos obsoletos

### Prioridades de Corrección

1. **Crítico:** Implementar LWW por fila individual
2. **Alto:** Agregar mutex para prevenir concurrencia
3. **Alto:** Implementar filtros temporales de 60 días
4. **Medio:** Estandarizar contadores y métricas
5. **Medio:** Resolver inconsistencias de claves

---

**Fin del Documento**
