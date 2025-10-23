# ✅ Presupuesto → Factura BORRADOR - IMPLEMENTADO

## 🎉 Estado: Backend Completado

El flujo de conversión de Presupuesto a Factura BORRADOR está **completamente implementado** y listo para usar.

---

## 📦 Archivos Creados/Modificados

### Nuevos Servicios
1. ✅ `src/facturacion/services/presupuestoFacturaService.js`
   - Mapeo completo de presupuesto → factura
   - Cálculo automático de totales
   - Determinación de tipo de comprobante según condición IVA
   - Manejo de documentos (CUIT/DNI/CF)

2. ✅ `src/facturacion/services/validadorAfipService.js`
   - Validación completa pre-WSFE
   - Verificación de cabecera, items, fechas, documentos
   - Respuesta con `readyForWSFE` y lista de faltantes

### Controladores Actualizados
3. ✅ `src/facturacion/controllers/facturas.js`
   - Nuevo endpoint: `facturarPresupuesto()`
   - Nuevo endpoint: `validarFacturaAfip()`

### Rutas Actualizadas
4. ✅ `src/facturacion/routes/facturas.js`
   - `POST /facturacion/presupuestos/:id/facturar`
   - `GET /facturacion/facturas/:id/validar-afip`

### Documentación
5. ✅ `PLAN_PRESUPUESTO_A_FACTURA.md` - Plan completo con mapeos
6. ✅ `consultar-tablas-presupuestos.js` - Script de consulta de estructura
7. ✅ `consultar-estructura-completa.js` - Script de análisis detallado

---

## 🗄️ Cambios en Base de Datos (PENDIENTES - EJECUTAR)

### ⚠️ IMPORTANTE: Ejecutar estos ALTER TABLE

```sql
-- 1. Agregar columnas para fechas de servicio
ALTER TABLE factura_facturas 
ADD COLUMN IF NOT EXISTS fch_serv_desde DATE,
ADD COLUMN IF NOT EXISTS fch_serv_hasta DATE,
ADD COLUMN IF NOT EXISTS fch_vto_pago DATE;

-- 2. Agregar CHECK para concepto
ALTER TABLE factura_facturas 
ADD CONSTRAINT check_concepto 
CHECK (concepto IN (1, 2, 3));

-- 3. Agregar CHECK para moneda
ALTER TABLE factura_facturas 
ADD CONSTRAINT check_moneda 
CHECK (moneda IN ('PES', 'DOL', 'EUR'));

-- 4. Agregar CHECK para cotización de pesos
ALTER TABLE factura_facturas 
ADD CONSTRAINT check_mon_cotiz_pesos 
CHECK (moneda != 'PES' OR mon_cotiz = 1);

-- 5. Agregar CHECK para fechas de servicio (solo si concepto = 2 o 3)
ALTER TABLE factura_facturas 
ADD CONSTRAINT check_fechas_servicio 
CHECK (
    (concepto = 1) OR 
    (concepto IN (2, 3) AND fch_serv_desde IS NOT NULL AND fch_serv_hasta IS NOT NULL AND fch_vto_pago IS NOT NULL)
);

-- 6. Agregar CHECK para documento receptor (solo si requiere AFIP)
ALTER TABLE factura_facturas 
ADD CONSTRAINT check_doc_receptor 
CHECK (
    (requiere_afip = false) OR 
    (requiere_afip = true AND doc_tipo IS NOT NULL AND doc_nro IS NOT NULL)
);

-- 7. TRIGGER: Recalcular totales al insertar/actualizar items
CREATE OR REPLACE FUNCTION recalcular_totales_factura()
RETURNS TRIGGER AS $$
BEGIN
    -- Recalcular totales de la factura
    UPDATE factura_facturas f
    SET 
        imp_neto = COALESCE((
            SELECT SUM(imp_neto) 
            FROM factura_factura_items 
            WHERE factura_id = f.id
        ), 0),
        imp_iva = COALESCE((
            SELECT SUM(imp_iva) 
            FROM factura_factura_items 
            WHERE factura_id = f.id
        ), 0),
        imp_total = COALESCE((
            SELECT SUM(imp_neto) + SUM(imp_iva) 
            FROM factura_factura_items 
            WHERE factura_id = f.id
        ), 0),
        updated_at = NOW()
    WHERE id = COALESCE(NEW.factura_id, OLD.factura_id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger para INSERT
DROP TRIGGER IF EXISTS trigger_recalcular_totales_insert ON factura_factura_items;
CREATE TRIGGER trigger_recalcular_totales_insert
AFTER INSERT ON factura_factura_items
FOR EACH ROW
EXECUTE FUNCTION recalcular_totales_factura();

-- Crear trigger para UPDATE
DROP TRIGGER IF EXISTS trigger_recalcular_totales_update ON factura_factura_items;
CREATE TRIGGER trigger_recalcular_totales_update
AFTER UPDATE ON factura_factura_items
FOR EACH ROW
EXECUTE FUNCTION recalcular_totales_factura();

-- Crear trigger para DELETE
DROP TRIGGER IF EXISTS trigger_recalcular_totales_delete ON factura_factura_items;
CREATE TRIGGER trigger_recalcular_totales_delete
AFTER DELETE ON factura_factura_items
FOR EACH ROW
EXECUTE FUNCTION recalcular_totales_factura();

-- Verificar cambios
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'factura_facturas'
AND column_name IN ('fch_serv_desde', 'fch_serv_hasta', 'fch_vto_pago')
ORDER BY column_name;
```

---

## 🔄 Endpoints Disponibles

### 1. Facturar Presupuesto
```http
POST http://localhost:3004/facturacion/presupuestos/:id/facturar
```

**Respuesta:**
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

---

## 🗺️ Mapeos Implementados

### Condición IVA → Tipo Comprobante
| Condición IVA | Tipo Cbte | Descripción |
|---------------|-----------|-------------|
| Responsable Inscripto | 1 | Factura A |
| Monotributo | 6 | Factura B |
| Consumidor Final | 6 | Factura B |
| Exento | 6 | Factura B |
| No Responsable | 6 | Factura B |

### Condición IVA → Tipo Documento
| Condición IVA | Doc Tipo | Descripción |
|---------------|----------|-------------|
| Responsable Inscripto | 80 | CUIT |
| Monotributo | 80 | CUIT |
| Consumidor Final | 99 | Sin identificar |
| Exento | 80 | CUIT |
| No Responsable | 96 | DNI |

### IVA Presupuesto → Alícuota Factura
| IVA % | Alícuota ID | Descripción |
|-------|-------------|-------------|
| 21 | 1 | IVA 21% |
| 10.5 | 2 | IVA 10.5% |
| 0 | 3 | Exento |

---

## 🧪 Cómo Probar

### Paso 1: Ejecutar ALTER TABLE
```bash
# Conectar a PostgreSQL
psql -U postgres -d etiquetas

# Copiar y pegar el SQL de arriba
```

### Paso 2: Reiniciar el servidor de facturación
```bash
cd src/facturacion
node app.js
```

### Paso 3: Probar con un presupuesto existente
```bash
# Obtener ID de un presupuesto
# Luego llamar al endpoint

curl -X POST http://localhost:3004/facturacion/presupuestos/1/facturar
```

### Paso 4: Validar la factura creada
```bash
# Usar el factura_id de la respuesta anterior

curl http://localhost:3004/facturacion/facturas/123/validar-afip
```

---

## ✅ Validaciones Implementadas

### Cabecera
- ✅ Tipo de comprobante válido
- ✅ Punto de venta > 0
- ✅ Concepto (1, 2 o 3)
- ✅ Fecha de emisión
- ✅ Condición IVA
- ✅ Moneda (solo PES por ahora)
- ✅ Cotización (1 para PES)
- ✅ Estado BORRADOR

### Items
- ✅ Al menos 1 item
- ✅ Descripción no vacía
- ✅ Cantidad > 0
- ✅ Precio unitario >= 0
- ✅ Alícuota IVA válida
- ✅ Cálculos correctos (neto, IVA)

### Fechas de Servicio (si concepto = 2 o 3)
- ✅ fch_serv_desde NOT NULL
- ✅ fch_serv_hasta NOT NULL
- ✅ fch_vto_pago NOT NULL
- ✅ fch_serv_desde <= fch_serv_hasta

### Documento Receptor
- ✅ doc_tipo válido
- ✅ doc_nro presente
- ✅ Formato según tipo (CUIT 11 dígitos, DNI 7-8 dígitos)

### Totales
- ✅ Neto >= 0
- ✅ IVA >= 0
- ✅ Total > 0
- ✅ Total = Neto + IVA + Tributos
- ✅ Totales de factura = suma de items

---

## 📝 Logs de Depuración

El sistema genera logs detallados en español:

```
🔄 [PRESUPUESTO-FACTURA] Iniciando facturación del presupuesto 1...
🔄 [PRESUPUESTO-FACTURA] Transacción iniciada
🔍 [PRESUPUESTO-FACTURA] Obteniendo datos del presupuesto 1...
✅ [PRESUPUESTO-FACTURA] Presupuesto encontrado: PRES-2024-001
✅ [PRESUPUESTO-FACTURA] Cliente encontrado: Juan Pérez
✅ [PRESUPUESTO-FACTURA] 3 items encontrados
📋 [PRESUPUESTO-FACTURA] Mapeando cabecera...
📋 [PRESUPUESTO-FACTURA] Condición IVA "Responsable Inscripto" → Tipo Cbte: 1
📋 [PRESUPUESTO-FACTURA] Documento: Tipo 80, Nro "20123456789"
✅ [PRESUPUESTO-FACTURA] Cabecera mapeada
📋 [PRESUPUESTO-FACTURA] Mapeando 3 items...
✅ [PRESUPUESTO-FACTURA] 3 items mapeados
🧮 [PRESUPUESTO-FACTURA] Calculando totales...
✅ [PRESUPUESTO-FACTURA] Totales: Neto=1000.00, IVA=210.00, Total=1210.00
✅ [PRESUPUESTO-FACTURA] Factura creada con ID: 123
✅ [PRESUPUESTO-FACTURA] 3 items insertados
✅ [PRESUPUESTO-FACTURA] Transacción confirmada
```

---

## 🚀 Próximos Pasos

1. ✅ **Ejecutar ALTER TABLE** (tú, en PostgreSQL)
2. ✅ **Probar endpoints** con presupuestos reales
3. ⏳ **UI: Botón "Facturar"** en módulo de presupuestos
4. ⏳ **UI: Botón "Validar"** en facturas
5. ⏳ **Emisión CAE** (WSFE HOMO) - siguiente ciclo

---

## 📞 Soporte

Si encuentras algún problema:
1. Revisar logs en consola del servidor
2. Verificar que los ALTER TABLE se ejecutaron correctamente
3. Consultar `PLAN_PRESUPUESTO_A_FACTURA.md` para detalles de mapeo

---

**Estado:** ✅ Backend completado, listo para pruebas
**Fecha:** 2025-10-16
**Versión:** 1.0.0
