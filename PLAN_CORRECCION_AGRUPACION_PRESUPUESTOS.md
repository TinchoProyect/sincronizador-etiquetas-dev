# Plan de Corrección: Agrupación Incorrecta de Presupuestos en Producción

## Problema Identificado

En la página de producción, cuando hay dos presupuestos diferentes del mismo cliente, se están agrupando incorrectamente como si fueran uno solo. Esto ocurre en la sección "Pedidos por Cliente - Presupuestos Confirmados".

## Causa Raíz

En el archivo `src/produccion/controllers/pedidosPorCliente.js`, la consulta SQL en la función `obtenerPedidosPorCliente` está agrupando por:
- `cliente_id_int`
- `articulo_numero`

Pero **NO incluye el `id_presupuesto`** en el GROUP BY, lo que causa que:
1. Múltiples presupuestos del mismo cliente se consoliden en uno solo
2. Las cantidades de artículos se sumen entre presupuestos diferentes
3. Se pierda la independencia de cada presupuesto

## Ubicación del Problema

**Archivo:** `src/produccion/controllers/pedidosPorCliente.js`
**Función:** `obtenerPedidosPorCliente`
**Líneas:** Aproximadamente 90-150 (CTE `articulos_consolidados`)

## Solución Propuesta

### Opción 1: Mantener Vista por Cliente con Presupuestos Separados

Modificar la consulta para que agrupe por:
- `cliente_id_int`
- `presupuesto_id` (id_presupuesto_ext o id según el modo)
- `articulo_numero`

Esto mantendrá cada presupuesto independiente dentro del mismo cliente.

### Opción 2: Crear Nueva Vista "Por Presupuesto"

Agregar una nueva sección en la interfaz que muestre:
- Cada presupuesto como una entrada independiente
- Con su fecha, número de presupuesto
- Y sus artículos correspondientes

## Cambios Necesarios

### 1. Modificar Query SQL en `pedidosPorCliente.js`

**Antes:**
```sql
articulos_consolidados AS (
    SELECT 
        pc.cliente_id_int,
        pd.articulo as articulo_numero,
        SUM(COALESCE(pd.cantidad, 0)) as pedido_total,
        ...
    GROUP BY pc.cliente_id_int, pd.articulo
)
```

**Después:**
```sql
articulos_consolidados AS (
    SELECT 
        pc.cliente_id_int,
        ${presupuestoIdFieldMain} as presupuesto_id,
        pc.fecha as presupuesto_fecha,
        pd.articulo as articulo_numero,
        SUM(COALESCE(pd.cantidad, 0)) as pedido_total,
        ...
    GROUP BY pc.cliente_id_int, ${presupuestoIdFieldMain}, pc.fecha, pd.articulo
)
```

### 2. Modificar Estructura de Respuesta

Cambiar de:
```javascript
{
  cliente_id: 123,
  cliente_nombre: "Cliente X",
  articulos: [...]
}
```

A:
```javascript
{
  cliente_id: 123,
  cliente_nombre: "Cliente X",
  presupuestos: [
    {
      presupuesto_id: "ABC123",
      fecha: "2024-01-15",
      articulos: [...]
    },
    {
      presupuesto_id: "DEF456",
      fecha: "2024-01-16",
      articulos: [...]
    }
  ]
}
```

### 3. Actualizar Frontend (produccion.html y produccion.js)

- Modificar `renderizarPedidosPorCliente()` para mostrar presupuestos anidados
- Agregar nivel adicional de acordeón: Cliente > Presupuesto > Artículos
- Mantener indicadores de estado por presupuesto

## Archivos a Modificar

1. ✅ `src/produccion/controllers/pedidosPorCliente.js` - Query SQL y lógica
2. ✅ `public/js/produccion.js` - Función de renderizado
3. ✅ `src/produccion/pages/produccion.html` - Estilos CSS (si es necesario)

## Pasos de Implementación

1. Modificar la consulta SQL para incluir presupuesto_id en GROUP BY
2. Reestructurar la respuesta JSON para agrupar artículos por presupuesto
3. Actualizar función de renderizado en el frontend
4. Probar con datos reales de múltiples presupuestos del mismo cliente
5. Verificar que los indicadores de estado funcionen correctamente

## Consideraciones

- Mantener compatibilidad con el resumen de faltantes y parciales
- Asegurar que la funcionalidad de asignación de faltantes siga funcionando
- Verificar que los filtros por fecha y cliente sigan operando correctamente
- Mantener la funcionalidad de pack mapping

## Testing

Casos de prueba:
1. Cliente con 1 presupuesto → Debe mostrar 1 presupuesto
2. Cliente con 2+ presupuestos → Debe mostrar cada uno por separado
3. Mismo artículo en 2 presupuestos → Debe aparecer en ambos, no sumado
4. Filtros por fecha → Deben aplicarse correctamente
5. Indicadores de estado → Deben calcularse por presupuesto

## Prioridad

🔴 **ALTA** - Afecta la funcionalidad principal de producción
