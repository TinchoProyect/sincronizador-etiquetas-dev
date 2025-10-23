# 🔐 Guía de Renovación de TA (Token de Acceso AFIP)

## 📍 Acceso Rápido

### Desde el Listado de Facturas

1. Ir a: `http://localhost:3004/pages/facturas.html`
2. En el header (esquina superior derecha), hacer clic en el botón **"🔐 Administración AFIP"**
3. Se abrirá la página de administración de AFIP

### Acceso Directo

URL: `http://localhost:3004/pages/afip-admin.html`

---

## 🎯 Cómo Renovar el TA

### Paso 1: Acceder a Administración AFIP

Desde el listado de facturas, hacer clic en **"🔐 Administración AFIP"** (botón en el header)

### Paso 2: Renovar el Token

1. En la página de Administración AFIP, hacer clic en **"🔄 Renovar TA (Homologación)"**
2. El botón mostrará un spinner mientras procesa
3. Esperar la respuesta (puede tardar 5-10 segundos)

### Paso 3: Verificar el Resultado

**Si es exitoso:**
- ✅ Aparecerá un mensaje verde: "TA actualizado exitosamente"
- La información del TA se actualizará:
  - **Entorno:** HOMO
  - **Servicio:** wsfe
  - **Estado:** Vigente (en verde)
  - **Expira:** Fecha y hora en formato argentino
  - **Token:** Primeros 50 caracteres
  - **Última actualización:** Timestamp actual

**Si hay error:**
- ❌ Aparecerá un mensaje rojo con el detalle del error
- Revisar los logs del servidor para más información

---

## 🔍 Qué Hace el Botón

Cuando haces clic en "Renovar TA (Homologación)", el sistema:

1. **Crea un TRA** (Ticket de Requerimiento de Acceso) XML
2. **Firma el TRA** con OpenSSL usando el certificado de homologación
3. **Llama a WSAA** (Web Service de Autenticación y Autorización) de AFIP
4. **Obtiene el TA** (Token y Sign)
5. **Guarda en la base de datos** (tabla `factura_afip_ta`)
6. **Actualiza la UI** con la información del nuevo TA

---

## 📊 Información Mostrada

### Estado del TA

- **Entorno:** HOMO (homologación) o PROD (producción)
- **Servicio:** wsfe (Web Service de Facturación Electrónica)
- **Estado:** 
  - 🟢 **Vigente** (en verde) - El TA es válido
  - 🔴 **Expirado** (en rojo) - El TA ya no es válido
- **Expira:** Fecha y hora de expiración en formato DD/MM/YYYY HH:mm:ss
- **Token:** Primeros 50 caracteres del token (para verificación)
- **Última actualización:** Timestamp de cuándo se renovó

---

## ⚠️ Casos Especiales

### Error: "alreadyAuthenticated"

Si AFIP devuelve este error, significa que ya existe un TA válido. El sistema:
- Intentará reusar el TA existente de la base de datos
- Si está vigente, lo mostrará en la UI
- Si está expirado, mostrará un error

**Solución:** Esperar unos minutos y volver a intentar.

### Error: "Request failed with status code 500"

Posibles causas:
- Límite de requests de AFIP alcanzado (cooldown)
- Certificado inválido o expirado
- Problema de conectividad con AFIP

**Solución:** 
1. Esperar 30-60 minutos
2. Verificar certificados en `.env`
3. Revisar logs del servidor

### TA Expirado

Los TA de AFIP tienen una validez de **12 horas**. Si el TA está expirado:
- El sistema lo detectará automáticamente
- Al intentar emitir una factura, renovará el TA automáticamente
- También puedes renovarlo manualmente con el botón

---

## 🗄️ Base de Datos

El TA se guarda en la tabla `factura_afip_ta`:

```sql
SELECT 
    entorno,
    servicio,
    expira_en,
    creado_en,
    SUBSTRING(token, 1, 50) as token_preview
FROM factura_afip_ta
WHERE entorno = 'HOMO' AND servicio = 'wsfe';
```

**Constraint:** Solo puede haber **1 TA por entorno/servicio** (UNIQUE)

---

## 🔄 Flujo Completo

```
Usuario en Listado de Facturas
    ↓
Clic en "🔐 Administración AFIP"
    ↓
Página de Administración AFIP
    ↓
Clic en "🔄 Renovar TA (Homologación)"
    ↓
Backend: POST /facturacion/afip/homo/ta/refresh
    ↓
Servicio WSAA: Crear TRA → Firmar → Llamar AFIP
    ↓
AFIP: Devuelve Token y Sign
    ↓
BD: Guardar en factura_afip_ta (UPSERT)
    ↓
UI: Mostrar TA actualizado
    ↓
Usuario puede emitir facturas
```

---

## 📝 Logs del Servidor

Al renovar el TA, verás estos logs en la consola:

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
   Expira: 16/01/2025 14:30:00
```

---

## ✅ Checklist de Uso

- [ ] Servidor de facturación iniciado (`npm start`)
- [ ] Certificados de HOMO configurados en `.env`
- [ ] OpenSSL instalado y configurado
- [ ] Acceder a `http://localhost:3004/pages/facturas.html`
- [ ] Hacer clic en "🔐 Administración AFIP"
- [ ] Hacer clic en "🔄 Renovar TA (Homologación)"
- [ ] Verificar mensaje de éxito
- [ ] Verificar que el estado sea "Vigente"
- [ ] Verificar fecha de expiración (debe ser futura)
- [ ] Ahora puedes emitir facturas con AFIP

---

## 🎨 Experiencia de Usuario

### Navegación Intuitiva

1. **Desde Facturas:** Botón visible en el header (esquina superior derecha)
2. **Diseño Consistente:** Mismo estilo visual que el resto del módulo
3. **Feedback Visual:** 
   - Spinner durante la operación
   - Alertas de éxito/error
   - Actualización automática de datos
4. **Información Clara:** Todos los datos del TA visibles y formateados

### Accesibilidad

- Botón siempre visible en el header
- Un solo clic para acceder
- Interfaz simple y directa
- Mensajes claros en español

---

## 🚀 Próximos Pasos Después de Renovar

Una vez que tengas un TA válido:

1. **Volver al listado de facturas** (botón "← Volver a Facturas")
2. **Seleccionar una factura en estado BORRADOR**
3. **Hacer clic en "📄 Ver"**
4. **Hacer clic en "Obtener CAE"** (o "Reprocesar" si fue rechazada)
5. **Verificar que se obtenga el CAE exitosamente**

---

**Implementado:** 2025-01-15  
**Versión:** 1.0.0  
**Módulo:** Facturación LAMDA
