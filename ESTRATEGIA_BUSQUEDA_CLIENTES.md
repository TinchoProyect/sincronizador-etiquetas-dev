# 📋 DIAGNÓSTICO Y ESTRATEGIA - Campo IDCliente con Búsqueda BD Local

## 🔍 RELEVAMIENTO DEL REPOSITORIO

### Archivos Identificados:

**Modal/Pantalla "Nuevo presupuesto":**
- `src/presupuestos/pages/crear-presupuesto.html` - Página principal con formulario
- `src/presupuestos/js/presupuestosCreate.js` - Lógica JavaScript del formulario

**Controlador POST /api/presupuestos:**
- `src/presupuestos/controllers/presupuestosWrite.js` - Recibe el POST de creación
- `src/presupuestos/routes/presupuestos.js` - Define la ruta POST /

**Endpoint de sugerencias existente:**
- ✅ **YA EXISTE**: `GET /api/presupuestos/clientes/sugerencias` en `routes/presupuestos.js`
- ✅ **YA IMPLEMENTADO**: `obtenerSugerenciasClientes()` en `controllers/presupuestos.js`

**Tabla de clientes confirmada:**
- ✅ **BD Local**: `public.clientes` con campos correctos
- ✅ **Relación**: JOIN con `presupuestos` por `cliente_id = CAST(id_cliente AS integer)`

---

## ✅ ESTADO ACTUAL - LO QUE YA FUNCIONA

### Endpoint de Búsqueda (COMPLETO):
```javascript
GET /api/presupuestos/clientes/sugerencias?q=texto
```

**Funcionalidades ya implementadas:**
- ✅ Búsqueda por número: `/^\d{1,3}$/` → filtro por `cliente_id` exacto
- ✅ Búsqueda por texto: filtro por `nombre + apellido` con ILIKE
- ✅ Formato de respuesta: `{id, text, nombre, apellido, total_presupuestos}`
- ✅ Formato visual: `"001 — Apellido, Nombre"` con ceros a la izquierda
- ✅ Autenticación y permisos: `presupuestos.read`

### Campo Actual en HTML:
```html
<input type="text" id="id_cliente" name="id_cliente" required placeholder="Ej: 123">
```

---

## 🎯 ESTRATEGIA DE IMPLEMENTACIÓN

### PASO 1: Mejorar el Campo IDCliente (Frontend)
**Archivos a modificar:**
- `src/presupuestos/pages/crear-presupuesto.html`
- `src/presupuestos/js/presupuestosCreate.js`

**Cambios:**
1. **HTML**: Agregar contenedor para sugerencias debajo del input
2. **CSS**: Estilos para dropdown de sugerencias
3. **JavaScript**: 
   - Event listener con debounce (300ms)
   - Fetch al endpoint existente
   - Renderizado de sugerencias
   - Selección y formateo

### PASO 2: Lógica de Búsqueda (Ya existe, solo integrar)
**Endpoint existente:** `GET /api/presupuestos/clientes/sugerencias`

**Comportamiento confirmado:**
- Input "00" → busca cliente_id que empiece con "00"
- Input "juan" → busca en nombre/apellido que contenga "juan"
- Respuesta: `[{id: 23, text: "0023 — García, Juan", ...}]`

### PASO 3: Integración con POST (Mínima)
**Archivo:** `src/presupuestos/js/presupuestosCreate.js`

**Cambio:** Validar que `id_cliente` sea numérico antes del POST
```javascript
// Antes del envío, extraer solo el número del formato "0023 — Nombre"
const clienteId = document.getElementById('id_cliente').value.match(/^\d+/)?.[0];
```

---

## 🔧 IMPLEMENTACIÓN DETALLADA

### Flujo de Usuario:
1. **Usuario tipea** en campo IDCliente
2. **Debounce 300ms** → evita requests excesivos
3. **Fetch automático** a `/api/presupuestos/clientes/sugerencias?q=${texto}`
4. **Dropdown aparece** con formato: "0001 — Apellido, Nombre (X presupuestos)"
5. **Usuario selecciona** → campo queda con "0001", cliente asociado internamente
6. **POST normal** con `id_cliente: "1"` (sin ceros)

### Formateo de cliente_id:
```javascript
// Mostrar: siempre 4 dígitos con ceros
const formatClienteId = (id) => id.toString().padStart(4, '0');

// Enviar: número sin ceros
const parseClienteId = (formatted) => parseInt(formatted.replace(/^0+/, '')) || 0;
```

### Manejo de Estados:
- **Escribiendo**: Mostrar sugerencias
- **Seleccionado**: Ocultar sugerencias, mostrar formato final
- **Sin resultados**: Mostrar "Sin resultados" 
- **Error**: Mantener funcionalidad actual (input libre)

---

## 🛡️ RIESGOS Y MITIGACIONES

### Riesgos Identificados:
1. **Romper funcionalidad actual**: El POST espera `id_cliente` como string
2. **Performance**: Muchas consultas si no hay debounce
3. **UX**: Dropdown puede interferir con otros elementos

### Mitigaciones:
1. **Compatibilidad**: Mantener formato actual del POST, solo mejorar UX
2. **Debounce**: 300ms + cancelar requests anteriores
3. **Z-index**: Dropdown con posición absoluta y z-index alto

---

## ✅ CRITERIOS DE ACEPTACIÓN

### Funcionalidad Core:
- [ ] Tipeo "00" → aparecen sugerencias de clientes con ID 001, 002, etc.
- [ ] Tipeo "juan" → aparecen sugerencias con nombre/apellido que contenga "juan"
- [ ] Selección → campo muestra "0001" y cliente queda asociado
- [ ] "Sin resultados" cuando no hay coincidencias
- [ ] POST funciona igual que antes (sin romper nada)

### UX/UI:
- [ ] Debounce funciona (no spam de requests)
- [ ] Dropdown se posiciona correctamente
- [ ] Escape/click fuera cierra sugerencias
- [ ] Loading state durante búsqueda
- [ ] Mensajes en español

---

## 🧪 TESTING MÍNIMO SUGERIDO

### Smoke Tests:
1. **Búsqueda por número**: Tipear "00" → verificar sugerencias correctas
2. **Búsqueda por nombre**: Tipear "juan" → verificar filtrado por nombre
3. **Selección**: Elegir sugerencia → verificar formato "0001" en campo
4. **POST**: Crear presupuesto → verificar que se guarda correctamente
5. **Sin resultados**: Tipear "xyz123" → verificar mensaje "Sin resultados"

### Casos Edge:
- Campo vacío → no mostrar sugerencias
- Texto muy corto → no hacer request
- Error de red → mantener funcionalidad actual

---

## 📁 ARCHIVOS A MODIFICAR

### Confirmados para edición:
1. `src/presupuestos/pages/crear-presupuesto.html` - Agregar contenedor sugerencias
2. `src/presupuestos/js/presupuestosCreate.js` - Lógica de búsqueda y selección

### NO requieren cambios:
- ✅ `src/presupuestos/controllers/presupuestos.js` - Endpoint ya existe
- ✅ `src/presupuestos/routes/presupuestos.js` - Ruta ya configurada  
- ✅ `src/presupuestos/controllers/presupuestosWrite.js` - POST ya funciona
- ✅ Base de datos - Esquema correcto

---

## 🚀 ESTIMACIÓN

**Tiempo estimado:** 2-3 horas
- HTML/CSS: 30 min
- JavaScript: 90 min  
- Testing: 60 min

**Complejidad:** BAJA - Aprovecha infraestructura existente

**Riesgo:** MÍNIMO - No toca backend ni BD, solo mejora UX

---

*Estrategia lista para implementación. El endpoint de búsqueda ya existe y funciona correctamente.*
