# TODO: Reorganización Portada de Producción

## Plan Aprobado ✅

### Pasos Completados:

- [x] 1. Reorganizar estructura HTML en produccion.html
  - [x] Mover sección .welcome-section al inicio del main
  - [x] Mover .admin-buttons junto con .welcome-section
  - [x] Mantener secciones de presupuestos al final
  - [x] Crear contenedores semánticos (.header-section y .reports-section)

- [x] 2. Agregar estilos CSS para separación visual
  - [x] Separador entre encabezado y reportes
  - [x] Ajustes de espaciado
  - [x] Título visual para sección de informes
  - [x] Estilos responsive actualizados

### Pasos Pendientes:

- [ ] 3. Verificación y testing
  - [ ] Verificar funcionalidad de informes de presupuestos
  - [ ] Verificar selección de colaboradores
  - [ ] Probar diseño responsive
  - [ ] Verificar todos los botones y enlaces

## Archivos Modificados:
- src/produccion/pages/produccion.html ✅ (completado)

## Cambios Realizados:

### Estructura HTML:
1. **Reorganización del orden de secciones:**
   - Encabezado principal (texto + botones + colaboradores) ahora está al inicio
   - Informes de presupuestos movidos debajo con separador visual
   - Creados contenedores semánticos `.header-section` y `.reports-section`

2. **Mejoras visuales:**
   - Separador visual con gradiente entre secciones
   - Título "📊 Informes de Presupuestos" para la sección de reportes
   - Espaciado mejorado entre secciones

3. **Responsive Design:**
   - Mantenidas todas las media queries existentes
   - Agregados ajustes responsive para nuevos elementos

## Estado: Reorganización Completada ✅

---

# NUEVA TAREA: Bloques Desplegables para Informes

## Objetivo:
Convertir los dos bloques de informes de presupuestos en elementos desplegables/colapsables:
1. "Pedidos por clientes – presupuestos confirmados"
2. "Artículos de pedidos confirmados"

## Requisitos:
- Al cargar la página, ambos bloques deben estar ocultos (solo mostrar título/botón)
- Al hacer clic, desplegar el contenido completo
- Mantener toda la funcionalidad existente
- Conservar estilos visuales actuales
- Limpiar la vista inicial

## Plan de Implementación:

### Opción Elegida: JavaScript + CSS
**Razones:**
- Mayor control sobre animaciones
- Mejor compatibilidad con contenido dinámico
- Más flexible para futuras mejoras
- Mantiene el rendimiento con tablas grandes

### Pasos Completados:

- [x] 1. Modificar estructura HTML
  - [x] Agregar botones de toggle para cada sección
  - [x] Envolver contenido en contenedores colapsables
  - [x] Mantener todas las clases e IDs existentes

- [x] 2. Agregar estilos CSS
  - [x] Estilos para botones de toggle
  - [x] Animaciones de despliegue/colapso
  - [x] Estados visual (expandido/colapsado)
  - [x] Iconos indicadores

- [x] 3. Implementar JavaScript
  - [x] Funciones de toggle para cada sección
  - [x] Estado inicial (colapsado)
  - [x] Preservar funcionalidad existente

### Pasos Pendientes:

- [ ] 4. Testing
  - [ ] Verificar colapso/expansión
  - [ ] Confirmar funcionalidad de controles internos
  - [ ] Probar responsive design

## Cambios Implementados:

### Estructura HTML:
1. **Botones de Toggle:**
   - Agregados botones clickeables con iconos de flecha (▶)
   - Títulos de secciones movidos a los botones
   - Atributos aria-expanded para accesibilidad

2. **Contenedores Colapsables:**
   - Contenido envuelto en divs con clase `.collapsible-content`
   - IDs únicos para cada sección (`pedidos-section`, `articulos-section`)
   - Estado inicial oculto (`display: none`)

### Estilos CSS:
1. **Botones de Toggle:**
   - Gradiente de fondo atractivo
   - Efectos hover con elevación
   - Iconos con rotación animada (90°)

2. **Animaciones:**
   - Keyframes para expansión/colapso suaves
   - Transiciones de opacidad y altura
   - Duración de 300ms para fluidez

3. **Estados Visuales:**
   - Indicadores claros de estado expandido/colapsado
   - Colores consistentes con el tema existente

### JavaScript:
1. **Función toggleSection():**
   - Manejo de expansión/colapso con animaciones
   - Actualización de atributos aria-expanded
   - Control de clases CSS para animaciones

2. **Inicialización:**
   - Estado colapsado garantizado al cargar
   - Funciones auxiliares para control externo
   - Logging para debugging

3. **Funciones Auxiliares:**
   - `expandSection()` y `collapseSection()` para control programático
   - Compatibilidad con funcionalidad existente

## Estado: Bloques Desplegables Completados ✅

---

# NUEVA FUNCIONALIDAD: Resumen Visible de Faltantes y Parciales

## Objetivo:
Agregar un listado resumido visible (sin colapsar) entre el separador y los informes, mostrando únicamente artículos con estado FALTANTES (rojo) y PARCIALES (amarillo).

## Requisitos:
- Ubicación: Entre línea divisoria y "📊 Informes de Presupuestos"
- Datos: Reutilizar misma fuente que "Artículos de Pedidos Confirmados"
- Orden: FALTANTES primero, PARCIALES después
- Estilos: Mantener colores y badges actuales
- Performance: Sin consultas extra, reutilizar datos cargados
- Estado vacío: Mensaje discreto si no hay faltantes ni parciales

## Plan de Implementación:

### Pasos Completados:

- [x] 1. Modificar estructura HTML
  - [x] Agregar sección de resumen entre separador e informes
  - [x] Crear contenedor para tabla resumida
  - [x] Mantener estructura de columnas existente
  - [x] Estados de carga, vacío y contenido

- [x] 2. Agregar estilos CSS
  - [x] Estilos para sección de resumen
  - [x] Variante compacta de tabla
  - [x] Mensaje de estado vacío
  - [x] Responsive design
  - [x] Destacado visual para faltantes (rojo) y parciales (amarillo)
  - [x] Separador entre grupos

- [x] 3. Implementar JavaScript
  - [x] Función para filtrar y mostrar faltantes/parciales
  - [x] Reutilización de datos del informe principal
  - [x] Sincronización con carga de datos
  - [x] Manejo de estado vacío
  - [x] Cache de datos (5 minutos)
  - [x] Función pública para actualización externa

## Cambios Implementados:

### Estructura HTML:
1. **Sección de Resumen:**
   - Ubicada entre separador visual e informes de presupuestos
   - Título "⚠️ Resumen de Faltantes y Parciales"
   - Estados: loading, vacío, contenido con tabla

2. **Tabla de Resumen:**
   - Mismas columnas que informe original
   - Filas destacadas por tipo (faltante/parcial)
   - Separador visual entre grupos

### Estilos CSS:
1. **Diseño Visual:**
   - Fondo blanco con sombra sutil
   - Filas faltantes con fondo rojo claro
   - Filas parciales con fondo amarillo claro
   - Efectos hover para mejor UX

2. **Responsive:**
   - Adaptación a pantallas móviles
   - Tabla compacta en dispositivos pequeños

### JavaScript:
1. **Reutilización de Datos:**
   - Usa misma URL que informe principal
   - Cache inteligente de 5 minutos
   - Sincronización con controles de fecha

2. **Filtrado y Ordenamiento:**
   - FALTANTES primero, PARCIALES después
   - Conserva orden interno del informe original
   - Manejo robusto de diferentes formatos de datos

3. **Performance:**
   - Sin consultas extra al servidor
   - Cache en memoria para evitar requests duplicados
   - Actualización automática al cambiar filtros

## Respuestas a Preguntas del Usuario:

✅ **Reutilización de componentes:** Usa exactamente las mismas clases CSS y estructura de tabla del informe original

✅ **Sincronización:** Se actualiza automáticamente cuando se modifica el informe principal, sin duplicación visual

✅ **Ubicación exacta:** Insertado entre línea divisoria y título "📊 Informes de Presupuestos"

✅ **Performance:** Sin consultas extra, reutiliza datos cargados con cache inteligente

✅ **Estado vacío:** Muestra "✅ Sin faltantes ni parciales" cuando no hay datos

## Estado: Implementación Completada ✅
