# Reglas del Proyecto: Sistema LAMDA (Producción Nube/Local y Modo Laboratorio)
# Ubicación: Workspace Customization Root (.agents/AGENTS.md)

Este archivo establece los lineamientos técnicos, de seguridad de entornos y de organización para Antigravity y sus subagentes especializados.

---

## 0. REGLA PRIORITARIA INQUEBRANTABLE: Aislamiento de Entornos (Modo Laboratorio vs Producción)

Esta regla tiene prioridad absoluta sobre cualquier otra instrucción al iniciar una conversación nueva:

1. **Prohibición Estricta de Tocar Producción en Tareas de Desarrollo, Corrección o Prueba:**
   - Durante cualquier tarea de desarrollo, corrección de bugs, ajustes visuales o pruebas, **queda terminantemente prohibido**:
     - Editar o modificar archivos dentro de `c:\Users\Martin\Documents\sincronizador-etiquetas - copia` (carpeta de Producción en `PcAlmacen`).
     - Hacer `git commit` o `git push` sobre la rama `main`.
     - Ejecutar comandos `ssh` o `scp` hacia el servidor de Google Cloud (`34.39.187.220` / `/opt/lamda/sincronizador-etiquetas`).
     - Modificar datos o esquemas sobre la base de datos productiva `etiquetas`.

2. **Entorno Obligatorio de Trabajo (`Modo Laboratorio` — Rama `desarrollo`):**
   - **En `PcAlmacen`:** Todo cambio de código debe realizarse **exclusivamente** en `C:\Users\Martin\Documents\LAMDA-Laboratorio` (rama `desarrollo`, conectado a la base aislada `etiquetas_pruebas`, con `LAMDA_MODO_LABORATORIO=true`, emisión ARCA simulada localmente y WhatsApp protegido).
   - **En la `Notebook`:** El entorno equivalente opera también sobre la rama `desarrollo` y la base aislada `etiquetas_pruebas`, gestionado desde `scripts\LamdaControlPanel.exe`.
   - **Subida de Avances (`origin/desarrollo`):** Al finalizar un cambio en Laboratorio, se debe exportar el snapshot del esquema de base de datos (`node scripts/auditarDiferenciasEsquemaDb.js --export-lab`) y subir los commits **únicamente** a `origin/desarrollo` (`git push origin desarrollo`).
   - **Rutas Relativas de Informes y PDFs:** Todo informe o archivo PDF generado en `LAMDA-Laboratorio` debe guardarse usando rutas relativas a su propio directorio (`path.join(__dirname, ...)` -> `C:\Users\Martin\Documents\LAMDA-Laboratorio\src\app-etiquetas\documentos`), sin apuntar jamás por ruta fija a `sincronizador-etiquetas - copia`.

3. **Única Vía Autorizada para Pasar a Producción (`"Pasá esto a Producción"`):**
   - El pase de cambios desde `desarrollo` hacia Producción (`main` + Google Cloud `34.39.187.220` + migración automática de esquema DB `etiquetas_pruebas` -> `etiquetas`) **solo puede ejecutarse desde `PcAlmacen`** mediante el comando:
     ```powershell
     node scripts/publicarDesarrolloAProduccion.js --confirmar-produccion
     ```
   - Este comando **solo puede ejecutarse cuando el usuario lo ordene de forma expresa con la frase `"Pasá esto a Producción"`**.

---

## 1. Organización del Equipo de Subagentes

El desarrollo de este módulo se estructurará mediante roles especializados para asegurar el aislamiento y evitar colisiones:

* **Coordinador (Agente Principal):**
  - Responsabilidad: Controla el `implementation_plan.md`, la lista de tareas `task.md` y supervisa el progreso general de las fases.
  - Orquestación: Delega tareas puntuales mediante `invoke_subagent` a los especialistas y consolida los resultados.

* **Especialista Cloud (Subagente: `cloud_specialist`):**
  - Contexto de Trabajo: Directorio `supabase_migration/` y conexión remota de base de datos.
  - Responsabilidad: Estructuración DDL, mantenimiento de políticas RLS, configuración de triggers, funciones del Custom Access Token Hook y gestión de Supabase Storage.

* **Integrador Backend (Subagente: `backend_integrator`):**
  - Contexto de Trabajo: `src/` (especialmente rutas NodeJS, controladores de sincronización local y queries PostgreSQL local).
  - Responsabilidad: Canales de sincronización (Phase 2), migración e ingesta de pedidos del portal al sistema de despacho local.

* **Diseñador Frontend (Subagente: `frontend_designer`):**
  - Contexto de Trabajo: `src/facturacion/pages/`, `src/app-etiquetas/pages/` o la estructura frontend decidida para el portal.
  - Responsabilidad: Ensamblado de vistas HTML, diseño UX/UI en doble columna, interacción SweetAlert2 y responsive design.

* **Especialista en Flujos de Usuario (Subagente: `ux_user_flow_specialist`):**
  - Contexto de Trabajo: Interfaces operativas (`src/logistica/pages/`, `src/logistica/js/`) y protocolos de carga de datos.
  - Responsabilidad: Auditoría de continuidad visual, eliminación de callejones sin salida (dead-ends), autoselección de recursos creados/vinculados y refresco automático del DOM tras operaciones HTTP 200 OK.

---

## 2. Lineamientos de Codificación y Seguridad

* **Aislamiento Absoluto de Datos (RLS):**
  - Todas las tablas en Supabase expuestas a la API REST deben contar con RLS activo.
  - Ninguna consulta del cliente debe depender de filtros del lado del navegador; el filtrado se realizará por RLS utilizando la información inyectada en el JWT (`app_metadata.cliente_id` y `app_metadata.listas_precios`).

* **Higiene de Contexto:**
  - Evitar el análisis de dependencias externas pesadas (`node_modules/`, cachés).
  - Las búsquedas de código deben limitarse a los archivos bajo `/src` y carpetas de scripts específicos.

* **Tono del Taller:**
  - Toda comunicación debe mantener una postura de respeto, profesionalismo y sobriedad técnica (como el Taller local que asume la responsabilidad del software).

---

## 3. Política Universal de Búsqueda LAMDA (Fase 49)

* **Estándar Obligatorio para Todo Nuevo Buscador:**
  Cualquier input de búsqueda que se programe en la plataforma LAMDA debe utilizar de forma obligatoria y por defecto el motor de filtrado unificado:
  - **Bolsa de Búsqueda Combinada:** 9 campos estáticos MÁS los valores descriptivos de `propiedades_dinamicas`.
  - **Búsqueda Parcial:** Coincidencia de sub-cadenas parciales en minúsculas.
  - **Filtrado Acumulativo (Espacios = AND):** Cada término separado por espacios actúa como filtro acumulativo sobre los resultados ya filtrados.
  - **Single Source of Truth:** Reutilización de `window.obtenerTextoBusquedaArticulo(art)`.

---

## 4. Reglas Arquitectónicas Selladas — Fase 1 (Familias de Producto / Nivel 1)

* **Relaciones Graníticas por Primary Key IDs (Nivel 1 & Nivel 2):**
  - Todas las operaciones relacionales de Nivel 1 y Nivel 2 se comunican y restringen **exclusivamente mediante identificadores primarios enteros** (`familia_id`, `articulo_principal_id`, `termino_id`, `categoria_id`).
  - Se prohíbe terminantemente el uso de cadenas de texto (`articulo_principal_texto`, `termino_texto`) para restricciones UNIQUE, cláusulas `ON CONFLICT` o `JOINs` relacionales.
  - La tabla `bunker_relacion_atributo_principal` se halla físicamente blindada en PostgreSQL mediante el índice único `unq_bunker_relacion_atributo_id_categoria` sobre `(familia_id, articulo_principal_id, termino_id, LOWER(categoria))`.

* **Barrera de Protección Estructural (HTTP 409 Conflict):**
  - La eliminación (`DELETE /familias/:id`) debe auditar si existen dependencias en `bunker_relacion_atributo_principal` o `bunker_articulos`.
  - Si existen dependencias activas, el backend debe retornar **HTTP 409 Conflict** y el frontend debe desplegar el desglose exacto de dependencias vinculadas, bloqueando la transacción.
  - Si no existen dependencias, la baja elimina la familia y su plantilla posicional por defecto en una sola transacción SQL.

* **Espejado UI Obligatorio (Gestor de Diccionario y Edición de Artículos):**
  - Todas las herramientas CRUD de familias (`🌳 ➕ Nova Familia`, `✏️ Editar`, `🗑️ Eliminar`) deben estar inyectadas en espejo tanto en `diccionario-bunker.html` como en `bunker.html`.
  - Al realizar cualquier modificación, el sistema debe re-poblar los selectores en tiempo real mediante `window.cargarFamiliasBunker()`.

---

## 5. Modelo de Dominio Sellado — Los 6 Flujos de Mercadería, Costos y Oferta Comercial (Taller LAMDA)

Todas las herramientas de cálculo, simulaciones de precios y cascadas de costos en la Pizarra Inteligente deben adherirse estrictamente a esta tipología de 6 flujos:

1. **Flujo 1 (Bulto Cerrado Directo — Sin Receta):**
   - *Trayectoria*: Tabla Maestra / Lote Entrante $\rightarrow$ Bulto Cerrado (Directo) $\rightarrow$ Oferta Comercial.
   - *Dominio*: Artículos comprados e importados que se comercializan en la misma bolsa/caja industrial cerrada sin proceso de transformación.

2. **Flujo 2 (Fraccionados de Bulto Cerrado — Mono-Ingredientes 100% Puros):**
   - *Trayectoria*: Tabla Maestra / Lote Entrante $\rightarrow$ Bulto Cerrado $\rightarrow$ Fracciones (ej: 1kg, 5kg) $\rightarrow$ Oferta Comercial.
   - *Dominio*: El insumo del bulto cerrado pasa por un fraccionamiento local directo (bolsa + mano de obra) conservando el 100% de pureza del ingrediente único.

3. **Flujo 3 (Mezclas Internas a Fracciones — Mixes / Carros Granel):**
   - *Trayectoria*: Tabla Maestra / Lotes Entrantes de Varios Bultos Cerrados $\rightarrow$ Mezcla Interna (Carro Mix Granel) $\rightarrow$ Fracciones $\rightarrow$ Oferta Comercial.
   - *Dominio*: Se combinan múltiples ingredientes del depósito en una receta de mezclado interno, y la mezcla resultante se fracciona para oferta comercial.

4. **Flujo 4 (Unidad Productiva Externa Simple — UP):**
   - *Trayectoria*: Tabla Maestra / Lote Entrante $\rightarrow$ Producción Externa (UP en planta/casa de productor) $\rightarrow$ Fracciones $\rightarrow$ Oferta Comercial.
   - *Dominio*: El bulto cerrado se envía a una Unidad Productiva externa donde sufre transformación física (ej: horneado/elaboración externa) antes del fraccionamiento comercial.

5. **Flujo 5 (Mezcla Interna + UP Externa — Barritas):**
   - *Trayectoria*: Varios Bultos Cerrados $\rightarrow$ Mezcla Interna $\rightarrow$ Producción Externa (Barritas en UP) $\rightarrow$ Fracciones $\rightarrow$ Oferta Comercial.
   - *Dominio*: Se elabora una mezcla previa en depósito, la mezcla se despacha a la UP externa para moldeado/horneado de barritas, retorna al taller, se fracciona y se emite la oferta.

6. **Flujo 6 (Doble Mezcla / Granola Compleja):**
   - *Trayectoria*: Bulto Cerrado $\rightarrow$ Mezcla Base $\rightarrow$ Producción Externa (Horneado de Granola con insumos del productor ej: miel/aceite) $\rightarrow$ Segunda Mezcla / Agregado Seco (pasas, coco) $\rightarrow$ Fracciones $\rightarrow$ Oferta Comercial.
   - *Dominio*: Circuito en dos fases de mezclado con incorporación de insumos propios del productor externo y posterior ensamblado de frutos secos en carros comerciales.

### Origen y Naturaleza de los Costos Base:
- **Tabla Maestra (Costo Patrón):** Provee el valor de **costo de reposición** actualizado.
- **Lote Entrante (Lote Supabase / Destinos):** Provee el valor real de la **última compra efectiva**.

---

## 6. Memoria Viva de Planificación de Depósito e Informes PDF (Día, Semana y Mes)

* **Fuente de Verdad en Base de Datos (`public.planificacion_reglas_memoria`):**
  - Antes de elaborar cualquier informe de producción (del Día, Semanal o Mensual) o modificar `planTrabajoDepositoService.js` / `scripts/generarPlanJornadaHoyPDF.js`, el Coordinador y sus subagentes **deben consultar siempre la tabla PostgreSQL `public.planificacion_reglas_memoria`** (`WHERE activo = true`) y registrar en ella toda nueva directriz operativa del Director.
* **Estándar Innegociable de Formato para Informes PDF (`/documentos/Plan_Jornada_Hoy_Deposito.pdf`):**
  1. **Logo Oficial LAMDA:** Siempre arriba a la izquierda (`src/app-etiquetas/img/logo_LAMDA.png`) sobre encabezado blanco limpio.
  2. **Sintético y 100% Técnico (Cero texto redundante):** Prohibido incluir notas explicativas al pie, párrafos de justificación o prefijos repetitivos como `"Fraccionar:"` / `"Fracciones:"`.
  3. **Estructura por renglón:** `Nombre exacto del artículo Búnker (CÓDIGO): Cantidad` y a la derecha entre paréntesis `(tiempo estimado: ~XX min)`.
  4. **Línea 3 (Mixes):** Primera línea con el nombre y código del puente: `Artículo puente: Nombre del Puente (CÓDIGO): X kg` y debajo las viñetas de los artículos hijos (`• Nombre (CÓDIGO): Cantidad (X pack de 10 x 300g)`), cerrando siempre el puente en `0 kg`.
  5. **Líneas 4, 5 y 6 (Pre-Mezclas y UPs Externas):** Contemplar tanto los minutos locales de armado de pre-mezcla (`MPB`, `MPGDSX7`, `MPGDFX6,9` — manteniendo siempre stock mínimo en estantería para retiro rápido) como los **días de ciclo externo (Lead Time UP: ~2,2d Tostadero, ~2,5d Granolas, ~3,2d Barritas; 4-6d si cruza fin de semana)** antes de agendar el fraccionamiento final.
  6. **Estándar de Doble Documento Imprimible (`Operativo` + Anexo `Fundamentals` con Clip `📎`):**
     - Cada uno de los 3 informes (`Plan_Jornada_Hoy_Deposito.pdf`, `Plan_Retiro_Produccion_Externa_Hoy.pdf` y `Plan_Semanal_3_Jornadas_Deposito.pdf`) debe generarse **siempre acompañado de su anexo gemelo de Fundamentals** (`Fundamentals_Jornada_Hoy_Deposito.pdf`, `Fundamentals_Retiro_Produccion_Externa_Hoy.pdf` y `Fundamentals_Semanal_3_Jornadas_Deposito.pdf`) auditado por el Comité de **7 Subagentes Especializados** (`especialista_metricas_temporales`, `especialista_linea_2_fraccionados`, `especialista_linea_3_mixes`, `especialista_lineas_4_5_6_up`, `especialista_demanda_y_compras_up`, `especialista_retiro_produccion_externa` y `auditor_fundamentals_produccion`).
     - En la Pizarra (`src/app-etiquetas/js/main.js`), cada botón de informe operativo lleva adosado a su derecha únicamente un **pequeño botón de clip (`📎` `.pizarra-btn-clip-anexo`)** dentro de `.pizarra-pdf-pair` para abrir su documento de Fundamentals (prohibido usar botones largos o blancos separados).
     - **Principio de Finitud Dual (Local y Externa) y Descuento Diario:** Todo informe diario/semanal y de retiro externo debe descontar automáticamente los carros confirmados en la jornada previa y demostrar el punto exacto de **Finitud Total (`0 tareas locales pendientes` y `0 UPs externas pendientes` una vez cubierto el Stock Ideal >= 30 días)**.
