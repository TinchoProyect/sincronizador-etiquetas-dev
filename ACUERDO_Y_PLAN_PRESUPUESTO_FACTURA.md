# 📋 ACUERDO Y PLAN: Presupuesto → Factura BORRADOR

**Fecha:** 2025-01-XX  
**Objetivo:** Completar el flujo Presupuesto → Factura BORRADOR con validación pre-WSFE

---

## 🎯 OBJETIVO DEL CICLO

Tomar un **Presupuesto** y generar una **Factura BORRADOR** con todos los datos completos y consistentes que luego se enviarán a AFIP/ARCA (WSFE).

### Características Clave:
- ✅ Evitar campos nulos/ambiguos
- ✅ Reglas claras para datos opcionales
- ✅ Validación completa pre-WSFE
- ❌ **NO emitir CAE todavía** (solo preparar)

---

## 📊 ESTADO ACTUAL DEL PROYECTO

### ✅ **YA IMPLEMENTADO (Backend Completo)**

#### 1. Servicios Backend
- ✅ **`src/facturacion/services/presupuestoFacturaService.js`**
  - Mapeo completo Presupuesto → Factura
  - Determinación automática de tipo de comprobante según condición IVA
  - Manejo de documentos (CUIT/DNI/Consumidor Final)
  - Cálculo automático de totales
  - Transacciones seguras con rollback

- ✅ **`src/facturacion/services/validadorAfipService.js`**
  - Validación completa de cabecera
  - Validación de items (descripción, cantidad, precios, IVA)
  - Validación de fechas de servicio (si concepto = 2 o 3)
  - Validación de documento receptor
  - Validación de totales y consistencia
  - Respuesta con `readyForWSFE: true/false` + lista de faltantes

#### 2. Controladores y Rutas
- ✅ **`src/facturacion/controllers/facturas.js`**
  - `facturarPresupuesto()` - Crear factura desde presupuesto
  - `validarFacturaAfip()` - Validar factura pre-WSFE

- ✅ **`src/facturacion/routes/facturas.js`**
  - `POST /facturacion/presupuestos/:id/facturar`
  - `GET /facturacion/facturas/:id/validar-afip`

#### 3. UI Básica
- ✅ **`src/presupuestos/js/facturacion-integration.js`**
  - Botón "Facturar" en módulo de presupuestos
  - Verificación de fecha hito (>= 2025-10-12)
  - Detección de facturas existentes (idempotencia)
  - Integración con backend de facturación

#### 4. Documentación
- ✅ `PLAN_PRESUPUESTO_A_FACTURA.md` - Plan original con mapeos
- ✅ `PRESUPUESTO_A_FACTURA_IMPLEMENTADO.md` - Estado de implementación
- ✅ `alter-table-facturacion.sql` - Script SQL completo

---

## ⚠️ PENDIENTE DE EJECUTAR

### 1. 🗄️ **CAMBIOS EN BASE DE DATOS** (Ejecutar por DBA)

El archivo `alter-table-facturacion.sql` contiene:

#### A. Agregar Columnas para Fechas de Servicio
```sql
ALTER TABLE factura_facturas 
ADD COLUMN IF NOT EXISTS fch_serv_desde DATE,
ADD COLUMN IF NOT EXISTS fch_serv_hasta DATE,
ADD COLUMN IF NOT EXISTS fch_vto_pago DATE;
```

**Propósito:** Requeridas por AFIP cuando concepto = 2 (Servicios) o 3 (Productos y Servicios)

#### B. Agregar Constraints de Validación

1. **CHECK para concepto** (1=Productos, 2=Servicios, 3=Ambos)
```sql
ALTER TABLE factura_facturas 
ADD CONSTRAINT check_concepto 
CHECK (concepto IN (1, 2, 3));
```

2. **CHECK para moneda** (solo PES, DOL, EUR)
```sql
ALTER TABLE factura_facturas 
ADD CONSTRAINT check_moneda 
CHECK (moneda IN ('PES', 'DOL', 'EUR'));
```

3. **CHECK para cotización de pesos** (debe ser 1)
```sql
ALTER TABLE factura_facturas 
ADD CONSTRAINT check_mon_cotiz_pesos 
CHECK (moneda != 'PES' OR mon_cotiz = 1);
```

4. **CHECK para fechas de servicio** (obligatorias si concepto = 2 o 3)
```sql
ALTER TABLE factura_facturas 
ADD CONSTRAINT check_fechas_servicio 
CHECK (
    (concepto = 1) OR 
    (concepto IN (2, 3) AND fch_serv_desde IS NOT NULL 
                        AND fch_serv_hasta IS NOT NULL 
                        AND fch_vto_pago IS NOT NULL)
);
```

5. **CHECK para documento receptor** (obligatorio si requiere_afip)
```sql
ALTER TABLE factura_facturas 
ADD CONSTRAINT check_doc_receptor 
CHECK (
    (requiere_afip = false) OR 
    (requiere_afip = true AND doc_tipo IS NOT NULL AND doc_nro IS NOT NULL)
);
```

#### C. Función y Triggers para Recalcular Totales Automáticamente

**Función:**
```sql
CREATE OR REPLACE FUNCTION recalcular_totales_factura()
RETURNS TRIGGER AS $$
DECLARE
    v_factura_id BIGINT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_factura_id := OLD.factura_id;
    ELSE
        v_factura_id := NEW.factura_id;
    END IF;
    
    UPDATE factura_facturas f
    SET 
        imp_neto = COALESCE((SELECT SUM(imp_neto) FROM factura_factura_items WHERE factura_id = v_factura_id), 0),
        imp_iva = COALESCE((SELECT SUM(imp_iva) FROM factura_factura_items WHERE factura_id = v_factura_id), 0),
        imp_total = COALESCE((SELECT SUM(imp_neto) + SUM(imp_iva) FROM factura_factura_items WHERE factura_id = v_factura_id), 0),
        updated_at = NOW()
    WHERE id = v_factura_id;
    
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;
```

**Triggers:**
```sql
-- INSERT
CREATE TRIGGER trigger_recalcular_totales_insert
AFTER INSERT ON factura_factura_items
FOR EACH ROW EXECUTE FUNCTION recalcular_totales_factura();

-- UPDATE
CREATE TRIGGER trigger_recalcular_totales_update
AFTER UPDATE ON factura_factura_items
FOR EACH ROW EXECUTE FUNCTION recalcular_totales_factura();

-- DELETE
CREATE TRIGGER trigger_recalcular_totales_delete
AFTER DELETE ON factura_factura_items
FOR EACH ROW EXECUTE FUNCTION recalcular_totales_factura();
```

**Propósito:** Mantener totales sincronizados automáticamente al insertar/editar/eliminar items

---

### 2. 🎨 **UI FALTANTE** (Implementar en código)

#### A. Botón "Validar (pre-WSFE)" en Página de Ver Factura

**Archivo a modificar:** `src/facturacion/pages/ver-factura.html`

**Funcionalidad:**
- Botón visible solo para facturas en estado BORRADOR
- Al hacer clic, llama a `GET /facturacion/facturas/:id/validar-afip`
- Muestra resultados de validación:
  - ✅ **Ready for WSFE:** Factura lista para emitir
  - ⚠️ **Faltantes:** Lista de campos/validaciones pendientes
  - ℹ️ **Advertencias:** Información adicional

**Diseño propuesto:**
```html
<div class="validation-section">
    <button id="btn-validar-afip" class="btn btn-primary">
        🔍 Validar para AFIP
    </button>
    
    <div id="validation-results" style="display: none;">
        <!-- Resultados de validación -->
    </div>
</div>
```

---

## 🗺️ MAPEOS IMPLEMENTADOS

### Condición IVA → Tipo de Comprobante
| Condición IVA | Tipo Cbte | Descripción |
|---------------|-----------|-------------|
| Responsable Inscripto | 1 | Factura A |
| Monotributo | 6 | Factura B |
| Consumidor Final | 6 | Factura B |
| Exento | 6 | Factura B |
| No Responsable | 6 | Factura B |
| IVA Liberado | 6 | Factura B |

### Condición IVA → Tipo de Documento
| Condición IVA | Doc Tipo | Descripción |
|---------------|----------|-------------|
| Responsable Inscripto | 80 | CUIT |
| Monotributo | 80 | CUIT |
| Consumidor Final | 99 | Sin identificar |
| Exento | 80 | CUIT |
| No Responsable | 96 | DNI |
| IVA Liberado | 80 | CUIT |

### IVA Presupuesto → Alícuota Factura
| IVA % | Alícuota ID | Descripción |
|-------|-------------|-------------|
| 21 | 1 | IVA 21% |
| 10.5 | 2 | IVA 10.5% |
| 0 | 3 | Exento |

---

## 📋 REGLAS DE NEGOCIO IMPLEMENTADAS

### 1. Tipo de Comprobante
- Determinado automáticamente según condición IVA del cliente
- Factura A para Responsables Inscriptos
- Factura B para el resto

### 2. Concepto
- **1 = Productos:** Default, no requiere fechas de servicio
- **2 = Servicios:** Requiere fch_serv_desde, fch_serv_hasta, fch_vto_pago
- **3 = Productos y Servicios:** Requiere fechas de servicio

### 3. Documento Receptor
- **Responsable Inscripto/Monotributo/Exento:** CUIT (tipo 80)
- **Consumidor Final:** Sin identificar (tipo 99, nro "0")
- **No Responsable:** DNI (tipo 96)
- Validación de formato: CUIT 11 dígitos, DNI 7-8 dígitos

### 4. Moneda y Cotización
- Por ahora solo **PES** (pesos)
- Cotización siempre **1** para pesos
- Validado por constraint en BD

### 5. Totales
- **imp_neto:** Suma de (qty × p_unit) de todos los items
- **imp_iva:** Suma de IVA de todos los items
- **imp_trib:** Tributos adicionales (por ahora 0)
- **imp_total:** imp_neto + imp_iva + imp_trib
- Recalculado automáticamente por triggers

---

## ✅ VALIDACIONES IMPLEMENTADAS

### Cabecera
- ✅ Tipo de comprobante válido (según tabla AFIP)
- ✅ Punto de venta > 0
- ✅ Concepto válido (1, 2 o 3)
- ✅ Fecha de emisión presente
- ✅ Condición IVA del receptor
- ✅ Moneda válida (PES, DOL, EUR)
- ✅ Cotización correcta (1 para PES)
- ✅ Estado = BORRADOR

### Items
- ✅ Al menos 1 item
- ✅ Descripción no vacía
- ✅ Cantidad > 0
- ✅ Precio unitario >= 0
- ✅ Alícuota IVA válida
- ✅ Cálculos correctos (imp_neto = qty × p_unit)
- ✅ IVA calculado correctamente

### Fechas de Servicio (si concepto = 2 o 3)
- ✅ fch_serv_desde NOT NULL
- ✅ fch_serv_hasta NOT NULL
- ✅ fch_vto_pago NOT NULL
- ✅ fch_serv_desde <= fch_serv_hasta

### Documento Receptor (si requiere_afip = true)
- ✅ doc_tipo válido
- ✅ doc_nro presente
- ✅ Formato según tipo (CUIT 11 dígitos, DNI 7-8 dígitos)

### Totales
- ✅ imp_neto >= 0
- ✅ imp_iva >= 0
- ✅ imp_trib >= 0
- ✅ imp_total > 0
- ✅ imp_total = imp_neto + imp_iva + imp_trib
- ✅ Totales de factura = suma de items

---

## 🔄 ENDPOINTS DISPONIBLES

### 1. Facturar Presupuesto
```http
POST http://localhost:3004/facturacion/presupuestos/:id/facturar
```

**Respuesta Exitosa (201):**
```json
{
  "success": true,
  "message": "Factura creada exitosamente desde presupuesto",
  "data": {
    "factura_id": 123,
    "presupuesto_id": 456,
    "totales": {
      "imp_neto": 1000.00,
      "imp_iva": 210.00,
      "imp_trib": 0,
      "imp_total": 1210.00
    },
    "items_count": 3,
    "validacion": {
      "ready_for_wsfe": true,
      "faltantes": [],
      "advertencias": []
    }
  }
}
```

**Respuesta Idempotente (409):**
```json
{
  "success": false,
  "error": "Factura duplicada",
  "message": "Ya existe una factura para el presupuesto 456 (ID: 123)"
}
```

### 2. Validar Factura para AFIP
```http
GET http://localhost:3004/facturacion/facturas/:id/validar-afip
```

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "facturaId": 123,
    "readyForWSFE": true,
    "faltantes": [],
    "advertencias": [
      {
        "campo": "mon_cotiz",
        "mensaje": "Cotización en 1 para pesos (correcto)"
      }
    ],
    "resumen": {
      "estado": "BORRADOR",
      "tipo_cbte": 6,
      "concepto": 1,
      "items_count": 3,
      "imp_total": 1210.00,
      "requiere_afip": true
    }
  }
}
```

**Ejemplo con Faltantes:**
```json
{
  "success": true,
  "data": {
    "facturaId": 124,
    "readyForWSFE": false,
    "faltantes": [
      {
        "campo": "doc_tipo",
        "mensaje": "Falta tipo de documento del receptor"
      },
      {
        "campo": "items[2].descripcion",
        "mensaje": "Item 2: Falta descripción"
      }
    ],
    "advertencias": [],
    "resumen": {
      "estado": "BORRADOR",
      "tipo_cbte": 6,
      "concepto": 1,
      "items_count": 3,
      "imp_total": 850.00,
      "requiere_afip": true
    }
  }
}
```

---

## 🧪 PLAN DE PRUEBAS

### Paso 1: Ejecutar ALTER TABLE
```bash
# Conectar a PostgreSQL
psql -U postgres -d etiquetas

# Ejecutar el script
\i alter-table-facturacion.sql

# Verificar cambios
\d factura_facturas
```

### Paso 2: Reiniciar Servidor de Facturación
```bash
cd src/facturacion
node app.js
```

### Paso 3: Probar Facturación de Presupuesto
```bash
# Obtener ID de un presupuesto de prueba (>= 2025-10-12)
# Luego llamar al endpoint

curl -X POST http://localhost:3004/facturacion/presupuestos/1/facturar
```

### Paso 4: Validar Factura Creada
```bash
# Usar el factura_id de la respuesta anterior

curl http://localhost:3004/facturacion/facturas/123/validar-afip
```

### Paso 5: Probar desde UI
1. Abrir módulo de presupuestos
2. Editar un presupuesto >= 2025-10-12
3. Hacer clic en botón "🧾 Facturar"
4. Verificar que se crea la factura
5. Abrir factura creada
6. Hacer clic en "🔍 Validar para AFIP" (cuando esté implementado)

---

## 📝 TABLAS UTILIZADAS

### Presupuestos (Origen)
- **`presupuestos`** - Cabecera del presupuesto
- **`presupuestos_detalles`** - Items del presupuesto
- **`clientes`** - Datos del cliente

### Facturación (Destino)
- **`factura_facturas`** - Cabecera de la factura
- **`factura_factura_items`** - Items de la factura
- **`factura_iva_alicuotas`** - Alícuotas de IVA disponibles
- **`factura_numeracion_afip`** - Numeración AFIP
- **`factura_numeracion_interna`** - Numeración interna
- **`factura_afip_ta`** - Tokens de acceso AFIP
- **`factura_afip_wsfe_logs`** - Logs de comunicación con AFIP

---

## 🚀 PRÓXIMOS PASOS (Orden de Ejecución)

### FASE 1: Base de Datos (DBA)
1. ✅ **Revisar y aprobar** el script `alter-table-facturacion.sql`
2. ✅ **Ejecutar** el script en PostgreSQL
3. ✅ **Verificar** que columnas, constraints y triggers se crearon correctamente

### FASE 2: Código (Desarrollador)
4. ✅ **Implementar** botón "Validar (pre-WSFE)" en `ver-factura.html`
5. ✅ **Agregar** JavaScript para llamar al endpoint de validación
6. ✅ **Diseñar** visualización de resultados de validación

### FASE 3: Pruebas
7. ✅ **Probar** facturación de presupuesto con diferentes escenarios:
   - Responsable Inscripto (Factura A)
   - Consumidor Final (Factura B)
   - Items con diferentes alícuotas de IVA (21%, 10.5%, 0%)
8. ✅ **Probar** validación pre-WSFE
9. ✅ **Verificar** que triggers recalculan totales correctamente

### FASE 4: Documentación
10. ✅ **Actualizar** documentación con resultados de pruebas
11. ✅ **Crear** guía de usuario para el flujo completo

### FASE 5: Siguiente Ciclo (Futuro)
12. ⏳ **Implementar** emisión de CAE en HOMO
13. ⏳ **Agregar** tributación detallada (si es necesario)
14. ⏳ **Migrar** a producción

---

## ❓ PREGUNTAS PARA CONFIRMAR

### 1. Base de Datos
**¿Aprobás que ejecute el ALTER TABLE con:**
- 3 columnas nuevas (fch_serv_desde, fch_serv_hasta, fch_vto_pago)
- 5 constraints de validación
- 1 función + 3 triggers para recalcular totales?

**Respuesta:** [ ] SÍ / [ ] NO / [ ] MODIFICAR

---

### 2. Tablas de Presupuestos
**¿Las tablas de presupuestos son estas?**
- `presupuestos` (cabecera)
- `presupuestos_detalles` (items)
- `clientes` (datos del cliente)

**Respuesta:** [ ] SÍ / [ ] NO (especificar nombres correctos)

---

### 3. UI de Validación
**¿Querés que implemente el botón "Validar (pre-WSFE)" ahora?**
- Ubicación: Página de ver factura
- Funcionalidad: Llamar a endpoint y mostrar resultados

**Respuesta:** [ ] SÍ, AHORA / [ ] NO, DESPUÉS

---

### 4. Tributación Detallada
**¿Incluimos tributación detallada (percepciones, retenciones) ahora o en segunda iteración?**
- Ahora: Requiere tabla adicional y lógica de cálculo
- Después: Dejamos solo IVA por ahora

**Respuesta:** [ ] AHORA / [ ] SEGUNDA ITERACIÓN

---

## 📞 SOPORTE Y LOGS

### Logs de Depuración
El sistema genera logs detallados en español con emojis:

```
🔄 [PRESUPUESTO-FACTURA] Iniciando facturación del presupuesto 1...
🔄 [PRESUPUESTO-FACTURA] Transacción iniciada
🔍 [PRESUPUESTO-FACTURA] Obteniendo datos del presupuesto 1...
✅ [PRESUPUESTO-FACTURA] Presupuesto encontrado: PRES-2024-001
✅ [PRESUPUESTO-FACTURA] Cliente encontrado: Juan Pérez
✅ [PRESUPUESTO-FACTURA] 3 items encontrados
📋 [PRESUPUESTO-FACTURA] Mapeando cabecera...
📋 [PRESUPUESTO-FACTURA] Condición IVA "Responsable Inscripto" → Tipo Cbte: 1
✅ [PRESUPUESTO-FACTURA] Factura creada con ID: 123
✅ [PRESUPUESTO-FACTURA] Transacción confirmada
```

### Archivos de Referencia
- **Plan original:** `PLAN_PRESUPUESTO_A_FACTURA.md`
- **Estado implementación:** `PRESUPUESTO_A_FACTURA_IMPLEMENTADO.md`
- **Script SQL:** `alter-table-facturacion.sql`
- **Servicio conversión:** `src/facturacion/services/presupuestoFacturaService.js`
- **Servicio validación:** `src/facturacion/services/validadorAfipService.js`

---

## 📌 RESUMEN EJECUTIVO

### ✅ Completado
- Backend completo (servicios + endpoints)
- UI básica (botón "Facturar" en presupuestos)
- SQL preparado y documentado
- Validaciones exhaustivas implementadas
- Mapeos de datos definidos

### ⚠️ Pendiente
- Ejecutar ALTER TABLE en PostgreSQL
- Implementar botón "Validar" en UI de facturas
- Pruebas end-to-end

### 🎯 Objetivo Inmediato
Dejar facturas en estado BORRADOR, completamente validadas y listas para solicitar CAE en un ciclo futuro.

---

**Versión:** 1.0  
**Última actualización:** 2025-01-XX  
**Estado:** ✅ Backend completo, ⚠️ Pendiente ejecución BD y UI validación
