# ✅ Renovación de TA (Token de Acceso) - Implementado

## 📋 Resumen

Se ha implementado exitosamente la funcionalidad para renovar el Token de Acceso (TA) de AFIP desde la interfaz de usuario del módulo de facturación.

---

## 🔧 Cambios Realizados

### 1. Backend

#### **Servicio WSAA** (`src/facturacion/services/wsaaService.real.js`)
- ✅ Agregada función `renovarTA(entorno)` que:
  - Solicita un nuevo TA a AFIP forzadamente (sin verificar si existe uno vigente)
  - Guarda el TA en la tabla `factura_afip_ta` con UPSERT
  - Retorna información completa del TA (entorno, servicio, expira_en, vigente, mensaje)
  - Maneja errores y usa TA existente como fallback si falla la renovación

#### **Controlador AFIP** (`src/facturacion/controllers/afip.js`)
- ✅ Agregada función `renovarTAHomo(req, res)` que:
  - Maneja el endpoint POST `/facturacion/afip/homo/ta/refresh`
  - Llama al servicio `renovarTA('HOMO')`
  - Formatea la fecha de expiración para zona horaria Argentina
  - Retorna JSON con toda la información del TA

#### **Rutas** (`src/facturacion/routes/facturas.js`)
- ✅ Agregada ruta: `POST /facturacion/afip/homo/ta/refresh`
- ✅ Conectada al controlador `afipController.renovarTAHomo`

### 2. Frontend

#### **Página de Administración AFIP** (`src/facturacion/pages/afip-admin.html`)
- ✅ Interfaz completa para gestión de TA con:
  - **Visualización del estado del TA:**
    - Entorno (HOMO/PROD)
    - Servicio (wsfe)
    - Estado (Vigente/Expirado)
    - Fecha de expiración formateada
    - Token (primeros 50 caracteres)
    - Última actualización
  
  - **Botón "Renovar TA (Homologación)":**
    - Llama al endpoint POST `/facturacion/afip/homo/ta/refresh`
    - Muestra spinner durante la operación
    - Actualiza la UI con el resultado
    - Muestra alertas de éxito/error
  
  - **Diseño profesional:**
    - Gradiente moderno
    - Cards con sombras
    - Responsive
    - Alertas con colores semánticos
    - Animaciones suaves

---

## 📊 Flujo de Funcionamiento

```
Usuario hace clic en "Renovar TA"
    ↓
Frontend: POST /facturacion/afip/homo/ta/refresh
    ↓
Backend: renovarTAHomo() en controlador
    ↓
Servicio: renovarTA('HOMO')
    ↓
WSAA: solicitarNuevoTA()
    ├─ Crear TRA XML
    ├─ Firmar con OpenSSL (-binary)
    ├─ Llamar loginCms SOAP
    └─ Parsear respuesta
    ↓
BD: UPSERT en factura_afip_ta
    ↓
Respuesta JSON al frontend
    ↓
UI actualizada con nuevo TA
```

---

## 🗄️ Base de Datos

### Tabla: `factura_afip_ta`

```sql
INSERT INTO factura_afip_ta (entorno, servicio, token, sign, expira_en, creado_en)
VALUES ('HOMO', 'wsfe', :token, :sign, :expira_en, NOW())
ON CONFLICT (entorno, servicio)
DO UPDATE SET
    token = EXCLUDED.token,
    sign = EXCLUDED.sign,
    expira_en = EXCLUDED.expira_en,
    creado_en = EXCLUDED.creado_en;
```

**Campos:**
- `entorno`: 'HOMO' o 'PROD'
- `servicio`: 'wsfe' (Web Service de Facturación Electrónica)
- `token`: Token de acceso (TEXT)
- `sign`: Firma digital (TEXT)
- `expira_en`: Timestamp de expiración (TIMESTAMPTZ)
- `creado_en`: Timestamp de creación (TIMESTAMPTZ)

**Constraint:** UNIQUE (entorno, servicio)

---

## 🔐 Seguridad

- ✅ Firma con OpenSSL usando flag `-binary` (requerido por AFIP)
- ✅ Certificados y claves en rutas configurables (`.env`)
- ✅ Manejo de errores SOAP Fault
- ✅ Logs detallados de cada paso
- ✅ Fallback a TA existente si falla la renovación

---

## 🌐 Endpoints

### POST `/facturacion/afip/homo/ta/refresh`

**Descripción:** Renueva el Token de Acceso de AFIP para homologación

**Request:**
```http
POST /facturacion/afip/homo/ta/refresh
Content-Type: application/json
```

**Response (Éxito):**
```json
{
  "success": true,
  "entorno": "HOMO",
  "servicio": "wsfe",
  "expira_en": "2025-01-16T02:30:00-03:00",
  "expira_en_formatted": "16/01/2025 02:30:00",
  "vigente": true,
  "mensaje": "TA actualizado exitosamente",
  "token": "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiI...",
  "sign": "ZGFzZGFzZGFzZGFzZGFzZGFzZGFzZGFzZGFzZGFzZGFzZGFz..."
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Error renovando TA",
  "message": "Request failed with status code 500"
}
```

---

## 📱 Acceso a la UI

**URL:** `http://localhost:3004/pages/afip-admin.html`

**Desde el listado de facturas:**
- Agregar un enlace/botón "Administración AFIP" que redirija a `/pages/afip-admin.html`

---

## 🧪 Testing

### Prueba Manual:

1. **Iniciar el servidor:**
   ```bash
   npm start
   ```

2. **Abrir la página:**
   ```
   http://localhost:3004/pages/afip-admin.html
   ```

3. **Hacer clic en "Renovar TA (Homologación)"**

4. **Verificar:**
   - ✅ Botón muestra spinner durante la operación
   - ✅ Alerta de éxito aparece
   - ✅ Información del TA se actualiza en la UI
   - ✅ Fecha de expiración está en formato argentino
   - ✅ Token se muestra (primeros 50 caracteres)

5. **Verificar en BD:**
   ```sql
   SELECT * FROM factura_afip_ta WHERE entorno = 'HOMO' AND servicio = 'wsfe';
   ```

### Logs Esperados:

```
🔄 [FACTURACION-AFIP-CTRL] POST /afip/homo/ta/refresh - Renovar TA HOMO
🔄 [WSAA-REAL] Renovación forzada de TA para HOMO...
🔄 [WSAA-REAL] Solicitando nuevo TA a AFIP HOMO...
📝 [WSAA-REAL] Paso 1: Creando TRA XML...
✅ [WSAA-REAL] TRA creado (uniqueId: 1760494734007)
🔐 [WSAA-REAL] Paso 2: Firmando TRA con OpenSSL...
✅ [WSAA-REAL] Certificados encontrados
✅ [WSAA-REAL] OpenSSL ejecutado exitosamente
✅ [WSAA-REAL] CMS generado (2436 chars)
📤 [WSAA-REAL] Paso 3: Llamando loginCms...
✅ [WSAA-REAL] Respuesta recibida (200)
📥 [WSAA-REAL] Paso 4: Parseando respuesta...
✅ [WSAA-REAL] TA parseado exitosamente
✅ [WSAA-REAL] TA obtenido exitosamente
💾 [WSAA-REAL] Guardando TA en BD...
✅ [WSAA-REAL] TA guardado en BD
✅ [WSAA-REAL] TA renovado exitosamente (expira en 720 min)
✅ [FACTURACION-AFIP-CTRL] TA renovado exitosamente
   Expira: 16/01/2025 02:30:00
```

---

## 📝 Notas Importantes

1. **Solo para HOMO:** Esta implementación es específica para el entorno de homologación. Para producción se necesitaría un endpoint similar pero con validaciones adicionales.

2. **Zona Horaria:** Todas las fechas se manejan en `America/Argentina/Buenos_Aires`.

3. **Expiración:** Los TA de AFIP tienen una validez de 12 horas.

4. **Renovación Automática:** El sistema ya tiene lógica para renovar automáticamente el TA cuando está por vencer (5 minutos antes). Este botón es para renovación manual/forzada.

5. **Logs en BD:** Todos los requests/responses SOAP se guardan en `factura_afip_wsfe_logs` para auditoría.

---

## 🔄 Próximos Pasos Sugeridos

1. ✅ **Agregar enlace en el listado de facturas** para acceder a la administración AFIP
2. ✅ **Mostrar estado del TA** en el header/navbar del módulo de facturación
3. ✅ **Notificación automática** cuando el TA esté por vencer
4. ✅ **Historial de renovaciones** (consultar `factura_afip_ta` con timestamps)

---

## ✅ Checklist de Implementación

- [x] Función `renovarTA()` en servicio WSAA
- [x] Controlador `renovarTAHomo()` en AFIP controller
- [x] Ruta POST `/facturacion/afip/homo/ta/refresh`
- [x] Página HTML `afip-admin.html` con UI completa
- [x] Botón funcional con spinner y alertas
- [x] Actualización de UI con datos del TA
- [x] Manejo de errores
- [x] Logs detallados
- [x] Documentación completa

---

**Implementado por:** BLACKBOXAI  
**Fecha:** 2025-01-15  
**Versión:** 1.0.0
