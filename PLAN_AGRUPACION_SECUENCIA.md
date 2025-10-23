# Plan: Agrupar Presupuestos por Secuencia en Producción

## Objetivo
Reorganizar la sección "Pedidos por Cliente - Presupuestos Confirmados" en tres acordeones separados según el campo `Secuencia`:

1. **Imprimir / Imprimir_Modificado** (mismo grupo)
2. **Armar_Pedido**
3. **Pedido_Listo**

## Análisis de Código Actual

### Backend: `src/produccion/controllers/pedidosPorCliente.js`
- **Query actual**: Trae presupuestos con estado 'presupuesto/orden'
- **Campos devueltos**: cliente_id, cliente_nombre, articulos (con presupuesto_id, fecha, etc.)
- **Problema**: NO incluye el campo `secuencia` en el SELECT

### Frontend: `public/js/produccion.js`
- **Función**: `renderizarPedidosPorCliente(clientes)`
- **Lógica actual**: Agrupa artículos por presupuesto_id dentro de cada cliente
- **Renderizado**: Un solo acordeón "Pedidos por Cliente - Presupuestos Confirmados"

### HTML: `src/produccion/pages/produccion.html`
- **Estructura actual**: Un solo `<section class="collapsible-section">` para pedidos
- **Necesidad**: Crear tres secciones hermanas con la misma estructura

## Cambios Necesarios

### 1. Backend: Agregar campo `secuencia` al query

**Archivo**: `src/produccion/controllers/pedidosPorCliente.js`

**Cambios en el CTE `presupuestos_confirmados`**:
```sql
-- ANTES:
SELECT 
    p.id,
    p.id_presupuesto_ext,
    p.id_cliente,
    p.fecha,
    CAST(p.id_cliente AS integer) as cliente_id_int
FROM public.presupuestos p

-- DESPUÉS:
SELECT 
    p.id,
    p.id_presupuesto_ext,
    p.id_cliente,
    p.fecha,
    p.secuencia,  -- ✅ AGREGAR
    CAST(p.id_cliente AS integer) as cliente_id_int
FROM public.presupuestos p
```

**Cambios en el JSON_AGG**:
```sql
-- AGREGAR 'secuencia' al JSON_BUILD_OBJECT:
JSON_BUILD_OBJECT(
    'presupuesto_id', app.presupuesto_id,
    'presupuesto_fecha', app.presupuesto_fecha,
    'secuencia', app.secuencia,  -- ✅ AGREGAR
    'articulo_numero', app.articulo_numero,
    ...
)
```

**Cambios en el CTE `articulos_por_presupuesto`**:
```sql
-- AGREGAR pc.secuencia al SELECT y GROUP BY:
SELECT 
    pc.cliente_id_int,
    ${presupuestoIdFieldMain} as presupuesto_id,
    pc.fecha as presupuesto_fecha,
    pc.secuencia,  -- ✅ AGREGAR
    pd.articulo as articulo_numero,
    SUM(COALESCE(pd.cantidad, 0)) as cantidad
FROM presupuestos_confirmados pc
${joinClause}
WHERE pd.articulo IS NOT NULL AND TRIM(pd.articulo) != ''
GROUP BY pc.cliente_id_int, ${presupuestoIdFieldMain}, pc.fecha, pc.secuencia, pd.articulo  -- ✅ AGREGAR pc.secuencia
```

### 2. Frontend JavaScript: Agrupar por secuencia

**Archivo**: `public/js/produccion.js`

**Nueva función**: `agruparPresupuestosPorSecuencia(clientes)`
```javascript
function agruparPresupuestosPorSecuencia(clientes) {
    const grupos = {
        imprimir: [],      // Imprimir + Imprimir_Modificado
        armar_pedido: [],  // Armar_Pedido
        pedido_listo: []   // Pedido_Listo
    };
    
    clientes.forEach(cliente => {
        // Agrupar artículos del cliente por secuencia
        const clientePorSecuencia = {
            imprimir: { ...cliente, articulos: [] },
            armar_pedido: { ...cliente, articulos: [] },
            pedido_listo: { ...cliente, articulos: [] }
        };
        
        cliente.articulos.forEach(articulo => {
            const secuencia = (articulo.secuencia || 'Imprimir').toLowerCase();
            
            if (secuencia === 'imprimir' || secuencia === 'imprimir_modificado') {
                clientePorSecuencia.imprimir.articulos.push(articulo);
            } else if (secuencia === 'armar_pedido') {
                clientePorSecuencia.armar_pedido.articulos.push(articulo);
            } else if (secuencia === 'pedido_listo') {
                clientePorSecuencia.pedido_listo.articulos.push(articulo);
            } else {
                // Fallback: si no reconoce la secuencia, va a imprimir
                clientePorSecuencia.imprimir.articulos.push(articulo);
            }
        });
        
        // Agregar cliente a cada grupo solo si tiene artículos
        if (clientePorSecuencia.imprimir.articulos.length > 0) {
            grupos.imprimir.push(clientePorSecuencia.imprimir);
        }
        if (clientePorSecuencia.armar_pedido.articulos.length > 0) {
            grupos.armar_pedido.push(clientePorSecuencia.armar_pedido);
        }
        if (clientePorSecuencia.pedido_listo.articulos.length > 0) {
            grupos.pedido_listo.push(clientePorSecuencia.pedido_listo);
        }
    });
    
    return grupos;
}
```

**Modificar función**: `renderizarPedidosPorCliente(clientes)`
```javascript
function renderizarPedidosPorCliente(clientes) {
    // Agrupar por secuencia
    const grupos = agruparPresupuestosPorSecuencia(clientes);
    
    // Renderizar cada grupo en su contenedor
    renderizarGrupoSecuencia('pedidos-imprimir', grupos.imprimir, 'Imprimir / Imprimir Modificado');
    renderizarGrupoSecuencia('pedidos-armar', grupos.armar_pedido, 'Armar Pedido');
    renderizarGrupoSecuencia('pedidos-listo', grupos.pedido_listo, 'Pedido Listo');
    
    // Actualizar contadores en títulos
    actualizarContadoresSecuencia(grupos);
}
```

**Nueva función**: `renderizarGrupoSecuencia(containerId, clientes, titulo)`
```javascript
function renderizarGrupoSecuencia(containerId, clientes, titulo) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!clientes || clientes.length === 0) {
        container.innerHTML = '<div class="mensaje-info">No hay presupuestos en esta etapa</div>';
        return;
    }
    
    // Reutilizar la misma lógica de renderizado actual
    const html = clientes.map(cliente => {
        // ... mismo código de renderizado actual ...
    }).join('');
    
    container.innerHTML = html;
}
```

### 3. HTML: Crear tres acordeones hermanos

**Archivo**: `src/produccion/pages/produccion.html`

**Reemplazar la sección actual** (líneas ~XXX):
```html
<!-- ANTES: Un solo acordeón -->
<section class="pedidos-por-cliente-section collapsible-section">
    <button class="section-toggle" onclick="toggleSection('pedidos-section')">
        <span class="toggle-icon">▶</span>
        <h2>Pedidos por Cliente - Presupuestos Confirmados</h2>
    </button>
    <div id="pedidos-section" class="collapsible-content" style="display: none;">
        ...
        <div id="pedidos-container" class="pedidos-container">
            <!-- Contenido -->
        </div>
    </div>
</section>

<!-- DESPUÉS: Tres acordeones hermanos -->
<!-- 1. Imprimir / Imprimir Modificado -->
<section class="pedidos-por-cliente-section collapsible-section">
    <button class="section-toggle" onclick="toggleSection('pedidos-imprimir-section')">
        <span class="toggle-icon">▶</span>
        <h2>📄 Imprimir / Imprimir Modificado <span id="contador-imprimir" class="contador-secuencia">(0)</span></h2>
    </button>
    <div id="pedidos-imprimir-section" class="collapsible-content" style="display: none;">
        <div class="pedidos-header">
            <div class="pedidos-controls">
                <label for="fecha-corte">Fecha límite:</label>
                <input type="date" id="fecha-corte" name="fecha-corte" />
                <input type="text" id="buscar-cliente" placeholder="Buscar cliente..." />
                <button id="refresh-pedidos" class="admin-button">Actualizar</button>
            </div>
        </div>
        <div id="pedidos-imprimir" class="pedidos-container">
            <!-- Contenido dinámico -->
        </div>
    </div>
</section>

<!-- 2. Armar Pedido -->
<section class="pedidos-por-cliente-section collapsible-section">
    <button class="section-toggle" onclick="toggleSection('pedidos-armar-section')">
        <span class="toggle-icon">▶</span>
        <h2>📦 Armar Pedido <span id="contador-armar" class="contador-secuencia">(0)</span></h2>
    </button>
    <div id="pedidos-armar-section" class="collapsible-content" style="display: none;">
        <div id="pedidos-armar" class="pedidos-container">
            <!-- Contenido dinámico -->
        </div>
    </div>
</section>

<!-- 3. Pedido Listo -->
<section class="pedidos-por-cliente-section collapsible-section">
    <button class="section-toggle" onclick="toggleSection('pedidos-listo-section')">
        <span class="toggle-icon">▶</span>
        <h2>✅ Pedido Listo <span id="contador-listo" class="contador-secuencia">(0)</span></h2>
    </button>
    <div id="pedidos-listo-section" class="collapsible-content" style="display: none;">
        <div id="pedidos-listo" class="pedidos-container">
            <!-- Contenido dinámico -->
        </div>
    </div>
</section>
```

**Agregar estilos CSS**:
```css
.contador-secuencia {
    font-weight: normal;
    color: #6c757d;
    font-size: 0.9em;
    margin-left: 8px;
}
```

### 4. Actualización reactiva al cambiar secuencia

**Estrategia**: 
- Cuando se cambia la secuencia de un presupuesto (desde el módulo de presupuestos)
- El frontend de producción debe detectar el cambio y reubicar el presupuesto
- Opciones:
  1. **Polling periódico** (cada 30-60 segundos)
  2. **Recargar al expandir** un acordeón
  3. **WebSocket/SSE** (más complejo, no recomendado para MVP)

**Implementación recomendada**: Recargar al expandir + botón manual de actualizar

## Archivos a Modificar

1. **`src/produccion/controllers/pedidosPorCliente.js`**
   - Agregar campo `secuencia` al query SQL (3 lugares)

2. **`public/js/produccion.js`**
   - Agregar función `agruparPresupuestosPorSecuencia(clientes)`
   - Modificar función `renderizarPedidosPorCliente(clientes)`
   - Agregar función `renderizarGrupoSecuencia(containerId, clientes, titulo)`
   - Agregar función `actualizarContadoresSecuencia(grupos)`

3. **`src/produccion/pages/produccion.html`**
   - Reemplazar sección única por tres acordeones hermanos
   - Agregar estilos CSS para contadores

## Orden de Implementación

1. ✅ Modificar backend para incluir campo `secuencia`
2. ✅ Modificar frontend JS para agrupar y renderizar por secuencia
3. ✅ Modificar HTML para crear tres acordeones
4. ✅ Probar funcionalidad completa
5. ✅ Verificar actualización reactiva

## Comportamiento Esperado

### Agrupación:
- **Grupo 1**: Presupuestos con `secuencia = 'Imprimir'` O `'Imprimir_Modificado'`
- **Grupo 2**: Presupuestos con `secuencia = 'Armar_Pedido'`
- **Grupo 3**: Presupuestos con `secuencia = 'Pedido_Listo'`

### Contadores:
- Título de cada acordeón muestra: `"Nombre Grupo (n)"` donde n = cantidad de presupuestos

### Actualización:
- Al hacer clic en "Actualizar", recarga todos los grupos
- Al expandir un acordeón, puede opcionalmente recargar solo ese grupo

## Notas Importantes

- Mantener todas las funcionalidades existentes (ver, imprimir, pack, asignar)
- Mantener los mismos estilos y comportamiento de colapso/expandir
- No modificar la lógica de cálculo de faltantes/parciales
- No modificar la sección "Artículos de Pedidos Confirmados"
- No modificar el "Resumen de Faltantes y Parciales"
