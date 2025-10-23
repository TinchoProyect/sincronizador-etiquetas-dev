# 🧪 Cómo Probar la Obtención de CAE

Guía paso a paso para probar la funcionalidad de obtener CAE desde la UI.

## ⚠️ Problema Común

**El botón "Obtener CAE" NO aparece si:**
- La factura tiene `requiere_afip: false` (No)
- La factura ya está en estado APROBADA o RECHAZADA

**El botón SÍ aparece cuando:**
- Estado = BORRADOR
- requiere_afip = true (Sí)

## 📝 Paso 1: Crear Factura de Prueba con AFIP

### Opción A: Desde Presupuesto (Recomendado)

1. Ir a Presupuestos: `http://localhost:3003/pages/presupuestos.html`
2. Editar un presupuesto existente
3. En el modal de facturación:
   - ✅ **Marcar "Factura AFIP"** (muy importante!)
   - Seleccionar Tipo: Factura B (tipo 6)
   - Punto de Venta: 32
   - Documento: 99 - 0 (Consumidor Final)
   - Condición IVA: Consumidor Final
4. Hacer clic en "Generar Factura"

### Opción B: Crear Manualmente con API

```bash
curl -X POST http://localhost:3004/facturacion/facturas \
-H "Content-Type: application/json" \
-d '{
  "tipo_cbte": 6,
  "pto_vta": 32,
  "concepto": 1,
  "doc_tipo": 99,
  "doc_nro": "0",
  "condicion_iva_id": 5,
  "requiere_afip": true,
  "items": [
    {
      "descripcion": "Producto de Prueba",
      "qty": 1,
      "p_unit": 1000,
      "alic_iva_id": 5
    }
  ]
}'
```

**Importante:** `"requiere_afip": true` es obligatorio!

## 📋 Paso 2: Verificar la Factura

1. Ir al listado: `http://localhost:3004/pages/facturas.html`
2. Buscar la factura recién creada
3. Verificar que:
   - Estado = BORRADOR
   - Debe tener un badge amarillo "BORRADOR"

## 👁️ Paso 3: Ver la Factura

1. Hacer clic en el botón "📄 Ver" de la factura
2. Se abre `ver-factura.html?id=X`
3. Verificar en "Información Adicional":
   - **REQUIERE AFIP: Sí** ← Debe decir "Sí"

## 🎯 Paso 4: Obtener CAE

Si todo está correcto, deberías ver:

```
┌─────────────────────────────────────────┐
│ [Cerrar] [📄 Obtener CAE de AFIP] [🖨️ Imprimir] │
└─────────────────────────────────────────┘
```

1. Hacer clic en "📄 Obtener CAE de AFIP"
2. El botón cambia a: "⏳ Obteniendo CAE..."
3. Aparece alerta azul: "Solicitando CAE a AFIP HOMO..."
4. Esperar 5-10 segundos
5. Si éxito:
   - Alerta verde con CAE
   - Página recarga automáticamente
   - Ahora muestra el CAE en una caja morada

## ✅ Resultado Esperado

Después de obtener el CAE, la página debe mostrar:

```
┌─────────────────────────────────────────┐
│ Código de Autorización Electrónico (CAE)│
│                                          │
│         75419285645738                   │
│                                          │
│    Vencimiento: 22/10/2025               │
└─────────────────────────────────────────┘
```

## ❌ Solución de Problemas

### No veo el botón "Obtener CAE"

**Causa 1:** La factura tiene `requiere_afip: false`
- **Solución:** Crear una nueva factura con `requiere_afip: true`
- Verificar en "Información Adicional" que diga "REQUIERE AFIP: Sí"

**Causa 2:** La factura ya está APROBADA
- **Solución:** Crear una nueva factura en BORRADOR

**Causa 3:** Estás viendo una factura interna
- **Solución:** Las facturas internas no tienen CAE, crear una con AFIP

### El botón no hace nada

**Causa:** Error de JavaScript
- **Solución:** Abrir consola del navegador (F12) y ver errores
- Verificar que el servidor esté corriendo en puerto 3004

### Error al obtener CAE

**Posibles causas:**
1. Certificados AFIP no configurados
2. .env no tiene las rutas correctas
3. OpenSSL no encontrado
4. Servicio WSAA/WSFE no implementado

**Solución:**
- Verificar `.env` tiene:
  ```
  AFIP_USE_REAL=true
  CERT_FILE=C:\Users\Martin\Documents\lambda-ws-homo\cert\homo_cert.pem
  KEY_FILE=C:\Users\Martin\Documents\lambda-ws-homo\cert\homo_key.pem
  WSAA_WORKDIR=C:\Users\Martin\Documents\lambda-ws-homo\wsaa\
  OPENSSL_EXE=C:\Program Files\OpenSSL-Win64\bin\openssl.exe
  ```

## 🔍 Verificar Configuración

### 1. Verificar que el servidor esté corriendo

```bash
curl http://localhost:3004/facturacion/health
```

Debe responder: `{"success":true,"message":"Servidor de facturación funcionando"}`

### 2. Verificar una factura específica

```bash
curl http://localhost:3004/facturacion/facturas/6
```

Buscar en la respuesta:
```json
{
  "requiere_afip": true,  // ← Debe ser true
  "estado": "BORRADOR"    // ← Debe ser BORRADOR
}
```

### 3. Verificar configuración AFIP

```bash
# Desde la carpeta del proyecto
cd src/facturacion
node -e "require('dotenv').config(); console.log('USE_REAL:', process.env.AFIP_USE_REAL); console.log('CERT:', process.env.CERT_FILE);"
```

## 📸 Capturas de Referencia

### Factura SIN botón (requiere_afip: false)
```
Información Adicional
┌──────────────────────┐
│ REQUIERE AFIP: No    │  ← No aparece botón
└──────────────────────┘

[Cerrar] [🖨️ Imprimir]
```

### Factura CON botón (requiere_afip: true)
```
Información Adicional
┌──────────────────────┐
│ REQUIERE AFIP: Sí    │  ← Aparece botón
└──────────────────────┘

[Cerrar] [📄 Obtener CAE de AFIP] [🖨️ Imprimir]
```

## 🎓 Resumen

1. ✅ Crear factura con `requiere_afip: true`
2. ✅ Verificar estado BORRADOR
3. ✅ Abrir en `ver-factura.html`
4. ✅ Verificar "REQUIERE AFIP: Sí"
5. ✅ Hacer clic en "Obtener CAE"
6. ✅ Esperar resultado
7. ✅ Ver CAE en la página

Si sigues estos pasos y no ves el botón, el problema está en el paso 1 (la factura no tiene `requiere_afip: true`).
