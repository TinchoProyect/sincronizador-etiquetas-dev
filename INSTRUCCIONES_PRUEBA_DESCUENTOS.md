# Instrucciones para Probar Descuentos en Facturas

## 📋 Resumen

El sistema de descuentos funciona de la siguiente manera:
- El descuento se toma del campo `presupuestos.descuento`
- Se aplica automáticamente al crear la factura desde el presupuesto
- Se muestra en la UI y PDF **solo si el descuento es mayor a 0**

## 🧪 Cómo Probar

### Opción 1: Script Automático (Recomendado)

Ejecuta el script de prueba que crea automáticamente un presupuesto con descuento y genera la factura:

```bash
node test-factura-con-descuento.js
```

Este script:
1. Busca o crea un presupuesto con 10% de descuento
2. Agrega items al presupuesto
3. Crea la factura desde el presupuesto
4. Verifica que el descuento se guardó correctamente
5. Te da la URL para ver la factura en el navegador

### Opción 2: Manualmente

1. **Asegúrate de tener un presupuesto con descuento**:
   ```sql
   -- Ver presupuestos con descuento
   SELECT id, id_presupuesto_ext, descuento, factura_id
   FROM presupuestos
   WHERE descuento > 0
   ORDER BY id DESC;
   ```

2. **Si no hay presupuestos con descuento, crea uno**:
   ```sql
   -- Actualizar un presupuesto existente para agregarle descuento
   UPDATE presupuestos
   SET descuento = 0.10  -- 10% de descuento
   WHERE id = <ID_PRESUPUESTO>
   AND factura_id IS NULL;
   ```

3. **Crear la factura desde el módulo de presupuestos**:
   - Ve a la interfaz de presupuestos
   - Selecciona un presupuesto que tenga `descuento > 0`
   - Haz clic en "Facturar"

4. **Ver la factura generada**:
   - Ve a `http://localhost:3004/facturacion/ver-factura.html?id=<FACTURA_ID>`
   - El descuento debería mostrarse así:
     ```
     Subtotal: $1,500.00
     Descuento (10%): -$150.00
     Neto Gravado: $1,350.00
     IVA 21%: $283.50
     TOTAL: $1,633.50
     ```

## 🔍 Verificar que Funciona

### En la Base de Datos

```sql
-- Ver facturas con descuento
SELECT 
    f.id,
    f.descuento,
    f.imp_neto,
    f.imp_iva,
    f.imp_total,
    p.id_presupuesto_ext,
    p.descuento as descuento_presupuesto
FROM factura_facturas f
LEFT JOIN presupuestos p ON f.presupuesto_id = p.id
WHERE f.descuento > 0
ORDER BY f.id DESC;
```

### En la UI (navegador)

1. Abre: `http://localhost:3004/facturacion/ver-factura.html?id=<ID>`
2. En la sección "Totales" deberías ver:
   - **Subtotal** (antes del descuento)
   - **Descuento (X%)** con el monto negativo
   - **Neto Gravado** (después del descuento)
   - **IVA** discriminado por tasa
   - **TOTAL** final

### En el PDF

1. Genera el PDF desde la factura
2. Abre el PDF
3. En la sección de totales deberías ver el mismo desglose que en la UI

## ⚠️ Notas Importantes

1. **El descuento NO se muestra si es 0**:
   - Si `factura.descuento = 0` o es NULL, no aparecerá la línea de descuento
   - Esto es intencional para no confundir al usuario con facturas sin descuento

2. **El descuento se aplica ANTES del IVA**:
   - Primero se calcula: `subtotal - descuento = neto`
   - Luego se calcula: `neto × IVA = impuesto`

3. **El descuento se guarda en la factura**:
   - Columna: `factura_facturas.descuento`
   - Formato: fraccional (0.10 = 10%)

4. **Facturas creadas manualmente**:
   - Si creas una factura directamente (no desde presupuesto), el descuento será 0
   - Actualmente no hay UI para agregar descuento manualmente

## 🐛 Troubleshooting

### No veo el descuento en la factura

**Causas posibles:**
1. El presupuesto origen no tenía descuento (`presupuestos.descuento = 0`)
2. La factura se creó antes de esta implementación
3. La columna `descuento` no existe en `factura_facturas`

**Solución:**
```sql
-- Verificar si la columna existe
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'factura_facturas' 
AND column_name = 'descuento';

-- Si no existe, ejecutar:
-- node agregar-columna-descuento-factura.js
```

### El descuento no se aplicó correctamente

**Verificar el cálculo:**
```sql
SELECT 
    f.id,
    f.descuento,
    (SELECT SUM(qty * p_unit) FROM factura_factura_items WHERE factura_id = f.id) as subtotal_items,
    f.imp_neto as neto_con_descuento,
    f.imp_iva,
    f.imp_total
FROM factura_facturas f
WHERE f.id = <ID_FACTURA>;
```

El `imp_neto` debería ser: `subtotal_items × (1 - descuento)`

### El PDF no muestra el descuento

1. Verifica que la factura tenga `descuento > 0` en la BD
2. Regenera el PDF
3. Si sigue sin mostrarse, verifica los logs del servidor

## 📊 Ejemplo Completo

```
Presupuesto con descuento 10%:
- Item A: 10 × $100 = $1,000 (21% IVA)
- Item B: 5 × $100 = $500 (10.5% IVA)
- Subtotal: $1,500

Aplicando descuento:
- Descuento (10%): -$150
- Neto A: $900 (10 × 100 × 0.90)
- Neto B: $450 (5 × 100 × 0.90)
- Neto Total: $1,350

Calculando IVA:
- IVA 21% sobre $900: $189
- IVA 10.5% sobre $450: $47.25
- Total IVA: $236.25

Total Factura: $1,586.25
```

## 📞 Soporte

Si después de seguir estas instrucciones aún no ves el descuento:
1. Ejecuta: `node test-factura-con-descuento.js`
2. Revisa los logs en consola
3. Verifica la estructura de la BD con: `node verificar-columna-descuento.js`
