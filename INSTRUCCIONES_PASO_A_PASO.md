# 📝 INSTRUCCIONES PASO A PASO: Completar Presupuesto → Factura

**Tiempo estimado total:** 45 minutos  
**Dificultad:** Baja (pasos claros y guiados)

---

## 🎯 OBJETIVO

Completar la implementación del flujo Presupuesto → Factura BORRADOR con validación pre-WSFE.

---

## 📋 PASO 1: VERIFICAR ESTADO ACTUAL (5 min)

### 1.1 Ejecutar script de verificación

```bash
node verificar-estado-bd-facturacion.js
```

**Resultado esperado:**
- Si dice "✅ Base de datos YA ESTÁ CONFIGURADA" → Saltar al PASO 3
- Si dice "⚠️ Base de datos NECESITA CONFIGURACIÓN" → Continuar con PASO 2

### 1.2 Revisar documentación

Leer rápidamente:
- `RESUMEN_EJECUTIVO_PRESUPUESTO_FACTURA.md` (5 min de lectura)
- `ACUERDO_Y_PLAN_PRESUPUESTO_FACTURA.md` (referencia completa)

---

## 🗄️ PASO 2: EJECUTAR CAMBIOS EN BASE DE DATOS (5 min)

### 2.1 Conectar a PostgreSQL

**Opción A: Desde línea de comandos**
```bash
psql -U postgres -d etiquetas
```

**Opción B: Desde pgAdmin**
- Abrir pgAdmin
- Conectar a servidor local
- Seleccionar base de datos "etiquetas"
- Abrir Query Tool

### 2.2 Ejecutar script SQL

**Opción A: Desde psql**
```sql
\i alter-table-facturacion.sql
```

**Opción B: Desde pgAdmin**
- Abrir archivo `alter-table-facturacion.sql`
- Copiar todo el contenido
- Pegar en Query Tool
- Ejecutar (F5)

### 2.3 Verificar ejecución exitosa

Deberías ver mensajes como:
```
ALTER TABLE
ALTER TABLE
CREATE FUNCTION
CREATE TRIGGER
CREATE TRIGGER
CREATE TRIGGER
```

### 2.4 Verificar cambios aplicados

```bash
node verificar-estado-bd-facturacion.js
```

Ahora debería decir: "✅ Base de datos YA ESTÁ CONFIGURADA"

---

## 🧪 PASO 3: PROBAR BACKEND (10 min)

### 3.1 Reiniciar servidor de facturación

```bash
cd src/facturacion
node app.js
```

Deberías ver:
```
✅ [FACTURACION] Servidor iniciado en puerto 3004
✅ [PRESUPUESTO-FACTURA] Servicio de conversión cargado
✅ [VALIDADOR-AFIP] Servicio de validación cargado
```

### 3.2 Probar endpoint de facturación

**Opción A: Con curl**
```bash
curl -X POST http://localhost:3004/facturacion/presupuestos/1/facturar
```

**Opción B: Con Postman/Insomnia**
- Método: POST
- URL: `http://localhost:3004/facturacion/presupuestos/1/facturar`
- Headers: `Content-Type: application/json`

**Resultado esperado (201 Created):**
```json
{
  "success": true,
  "message": "Factura creada exitosamente desde presupuesto",
  "data": {
    "factura_id": 123,
    "presupuesto_id": 1,
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

**Si falla con 404 o error:**
- Verificar que el presupuesto ID=1 existe
- Verificar que la fecha del presupuesto >= 2025-10-12
- Revisar logs del servidor

### 3.3 Probar endpoint de validación

Usar el `factura_id` del paso anterior:

```bash
curl http://localhost:3004/facturacion/facturas/123/validar-afip
```

**Resultado esperado (200 OK):**
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

## 🎨 PASO 4: IMPLEMENTAR UI DE VALIDACIÓN (20 min)

### 4.1 Abrir archivo de ver factura

```bash
code src/facturacion/pages/ver-factura.html
```

### 4.2 Buscar sección de acciones

Buscar algo como:
```html
<div class="factura-actions">
    <!-- Botones existentes -->
</div>
```

### 4.3 Agregar botón de validación

Insertar antes del cierre del div:

```html
<!-- Botón Validar para AFIP -->
<button 
    id="btn-validar-afip" 
    class="btn btn-primary"
    style="margin-left: 10px;"
    onclick="validarParaAfip()">
    🔍 Validar para AFIP
</button>

<!-- Contenedor de resultados -->
<div id="validation-results" style="display: none; margin-top: 20px;">
    <div class="card">
        <div class="card-header">
            <h5>Resultados de Validación</h5>
        </div>
        <div class="card-body" id="validation-content">
            <!-- Contenido dinámico -->
        </div>
    </div>
</div>
```

### 4.4 Agregar JavaScript de validación

Al final del archivo, antes de `</body>`, agregar:

```html
<script>
async function validarParaAfip() {
    const facturaId = obtenerFacturaId(); // Función existente que obtiene el ID
    const btn = document.getElementById('btn-validar-afip');
    const resultsDiv = document.getElementById('validation-results');
    const contentDiv = document.getElementById('validation-content');
    
    // Mostrar loading
    btn.disabled = true;
    btn.innerHTML = '⏳ Validando...';
    
    try {
        const response = await fetch(`http://localhost:3004/facturacion/facturas/${facturaId}/validar-afip`);
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Error en validación');
        }
        
        const validacion = result.data;
        
        // Construir HTML de resultados
        let html = '';
        
        // Estado general
        if (validacion.readyForWSFE) {
            html += `
                <div class="alert alert-success">
                    <h5>✅ Factura lista para AFIP</h5>
                    <p>La factura cumple con todos los requisitos para solicitar CAE.</p>
                </div>
            `;
        } else {
            html += `
                <div class="alert alert-warning">
                    <h5>⚠️ Factura NO lista para AFIP</h5>
                    <p>Se encontraron ${validacion.faltantes.length} problema(s) que deben corregirse.</p>
                </div>
            `;
        }
        
        // Faltantes
        if (validacion.faltantes.length > 0) {
            html += '<h6>Problemas encontrados:</h6><ul class="list-group mb-3">';
            validacion.faltantes.forEach(faltante => {
                html += `
                    <li class="list-group-item list-group-item-warning">
                        <strong>${faltante.campo}:</strong> ${faltante.mensaje}
                    </li>
                `;
            });
            html += '</ul>';
        }
        
        // Advertencias
        if (validacion.advertencias.length > 0) {
            html += '<h6>Información adicional:</h6><ul class="list-group mb-3">';
            validacion.advertencias.forEach(adv => {
                html += `
                    <li class="list-group-item list-group-item-info">
                        <strong>${adv.campo}:</strong> ${adv.mensaje}
                    </li>
                `;
            });
            html += '</ul>';
        }
        
        // Resumen
        html += `
            <h6>Resumen:</h6>
            <table class="table table-sm">
                <tr><td><strong>Estado:</strong></td><td>${validacion.resumen.estado}</td></tr>
                <tr><td><strong>Tipo Cbte:</strong></td><td>${validacion.resumen.tipo_cbte}</td></tr>
                <tr><td><strong>Concepto:</strong></td><td>${validacion.resumen.concepto}</td></tr>
                <tr><td><strong>Items:</strong></td><td>${validacion.resumen.items_count}</td></tr>
                <tr><td><strong>Total:</strong></td><td>$ ${validacion.resumen.imp_total.toFixed(2)}</td></tr>
            </table>
        `;
        
        contentDiv.innerHTML = html;
        resultsDiv.style.display = 'block';
        
    } catch (error) {
        console.error('Error validando:', error);
        contentDiv.innerHTML = `
            <div class="alert alert-danger">
                <h5>❌ Error</h5>
                <p>${error.message}</p>
            </div>
        `;
        resultsDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '🔍 Validar para AFIP';
    }
}

// Función auxiliar para obtener ID de factura de la URL
function obtenerFacturaId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
}
</script>
```

### 4.5 Guardar y probar

1. Guardar archivo
2. Abrir en navegador: `http://localhost:3004/pages/ver-factura.html?id=123`
3. Hacer clic en "🔍 Validar para AFIP"
4. Verificar que muestra resultados correctamente

---

## ✅ PASO 5: PRUEBAS END-TO-END (5 min)

### 5.1 Probar flujo completo desde UI de presupuestos

1. Abrir módulo de presupuestos
2. Editar un presupuesto con fecha >= 2025-10-12
3. Hacer clic en botón "🧾 Facturar"
4. Verificar mensaje de éxito
5. Hacer clic en "📄 Ver Factura"
6. En la factura, hacer clic en "🔍 Validar para AFIP"
7. Verificar que muestra "✅ Factura lista para AFIP"

### 5.2 Probar diferentes escenarios

**Escenario 1: Responsable Inscripto**
- Cliente con CUIT
- Debería generar Factura A (tipo_cbte = 1)

**Escenario 2: Consumidor Final**
- Cliente sin CUIT
- Debería generar Factura B (tipo_cbte = 6)
- doc_tipo = 99, doc_nro = "0"

**Escenario 3: Items con diferentes IVAs**
- Item 1: IVA 21%
- Item 2: IVA 10.5%
- Item 3: IVA 0% (exento)
- Verificar que totales se calculan correctamente

### 5.3 Probar triggers de totales

1. Crear una factura
2. Editar un item (cambiar cantidad o precio)
3. Verificar que los totales de la factura se actualizan automáticamente

---

## 📊 PASO 6: VERIFICACIÓN FINAL (5 min)

### 6.1 Checklist de verificación

- [ ] ✅ Columnas de fechas creadas en BD
- [ ] ✅ Constraints de validación activos
- [ ] ✅ Triggers de totales funcionando
- [ ] ✅ Endpoint POST /presupuestos/:id/facturar funciona
- [ ] ✅ Endpoint GET /facturas/:id/validar-afip funciona
- [ ] ✅ Botón "Facturar" en presupuestos funciona
- [ ] ✅ Botón "Validar" en facturas funciona
- [ ] ✅ Validación muestra resultados correctos
- [ ] ✅ Totales se recalculan automáticamente

### 6.2 Ejecutar verificación final

```bash
node verificar-estado-bd-facturacion.js
```

Debería mostrar todo en verde (✅).

---

## 🎉 COMPLETADO

Si todos los pasos anteriores funcionan correctamente, la implementación está completa.

### Próximos pasos (futuro):

1. **Emisión de CAE en HOMO**
   - Usar el endpoint existente de WSFE
   - Probar con facturas validadas

2. **Tributación detallada** (si es necesario)
   - Agregar tabla de tributos
   - Implementar cálculo de percepciones/retenciones

3. **Migración a producción**
   - Cambiar certificados de HOMO a PROD
   - Actualizar configuración de AFIP

---

## 🆘 SOLUCIÓN DE PROBLEMAS

### Problema: "Presupuesto no encontrado"
**Solución:** Verificar que el ID del presupuesto existe en la tabla `presupuestos`

### Problema: "Ya existe una factura para este presupuesto"
**Solución:** Es correcto (idempotencia). Usar el ID de la factura existente.

### Problema: "Falta tipo de documento del receptor"
**Solución:** Verificar que el cliente tiene CUIT/DNI en la tabla `clientes`

### Problema: "Totales no se recalculan"
**Solución:** Verificar que los triggers están activos:
```sql
SELECT tgname, tgenabled FROM pg_trigger 
WHERE tgrelid = 'factura_factura_items'::regclass;
```

### Problema: "Error de constraint check_fechas_servicio"
**Solución:** Si concepto = 2 o 3, debe tener fechas de servicio. Cambiar concepto a 1 (Productos) o agregar fechas.

---

## 📞 CONTACTO Y REFERENCIAS

### Documentos de referencia:
- `RESUMEN_EJECUTIVO_PRESUPUESTO_FACTURA.md` - Resumen rápido
- `ACUERDO_Y_PLAN_PRESUPUESTO_FACTURA.md` - Plan completo
- `alter-table-facturacion.sql` - Script SQL
- `verificar-estado-bd-facturacion.js` - Script de verificación

### Archivos de código:
- `src/facturacion/services/presupuestoFacturaService.js` - Conversión
- `src/facturacion/services/validadorAfipService.js` - Validación
- `src/facturacion/controllers/facturas.js` - Controladores
- `src/presupuestos/js/facturacion-integration.js` - UI presupuestos

---

**¡Éxito con la implementación!** 🚀
