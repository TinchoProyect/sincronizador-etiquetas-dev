# Corrección: Punto de Venta 32 para Facturas en Modo Pruebas

## 📋 Problema Identificado

En el módulo de facturación en modo pruebas (HOMO), las facturas generadas desde Presupuestos estaban usando el punto de venta 1, cuando debían usar el punto de venta 32 (configurado en AFIP para homologación).

## 🔧 Corrección Aplicada

### 1. Archivo Modificado: `src/facturacion/services/presupuestoFacturaService.js`

**Cambio realizado:**
- Se importó la constante `PTO_VTA` desde la configuración AFIP
- Se reemplazó el valor hardcodeado `pto_vta: 1` por `pto_vta: PTO_VTA`

**Antes:**
```javascript
const cabecera = {
    tipo_cbte: tipoCbte,
    pto_vta: 1, // TODO: Configurar desde settings
    concepto: 1,
    // ...
};
```

**Después:**
```javascript
const { PTO_VTA } = require('../config/afip');

// ...

const cabecera = {
    tipo_cbte: tipoCbte,
    pto_vta: PTO_VTA, // Punto de venta desde configuración AFIP
    concepto: 1,
    // ...
};
```

## 📊 Configuración AFIP

El punto de venta se configura en `src/facturacion/config/afip.js`:

```javascript
const PTO_VTA = parseInt(process.env.AFIP_PTO_VTA || '32');
```

Puede ser modificado desde el archivo `.env`:
```env
AFIP_PTO_VTA=32
```

## ✅ Resultado

Ahora todas las facturas generadas desde Presupuestos usarán:
- **Punto de Venta**: 32 (configurado en AFIP HOMO)
- **CUIT**: 23248921749
- **Numeración continua por tipo de comprobante**

## 🎯 Alcance

Esta corrección asegura que:

1. ✅ Las facturas nuevas usen PV=32
2. ✅ La numeración sea continua por tipo de comprobante
3. ✅ No se generen facturas inválidas con PV=1
4. ✅ Se respete la configuración de AFIP Homologación

## 📝 Notas

- Los registros antiguos con PV=1 no fueron corregidos, ya que serán eliminados al finalizar las pruebas
- La configuración es centralizada y aplica a todo el módulo de facturación
- El servicio de numeración (`numeroService.js`) ya estaba correctamente implementado para trabajar con cualquier punto de venta

## 🔍 Verificación

Para verificar que está funcionando correctamente:

1. Generar una factura desde un presupuesto
2. Consultar la tabla `factura_facturas`
3. Verificar que `pto_vta = 32`

```sql
SELECT id, tipo_cbte, pto_vta, cbte_nro, estado
FROM factura_facturas
ORDER BY id DESC
LIMIT 5;
```

## 📅 Fecha de Corrección

22 de octubre de 2025

---

**Importante**: Esta configuración es específica para el entorno de Homologación (HOMO). Para producción, el punto de venta debe configurarse según lo autorizado por AFIP en el entorno real.
