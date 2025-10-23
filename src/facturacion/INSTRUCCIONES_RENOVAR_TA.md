# Instrucciones para Completar la Renovación de TA

## Problema Actual

El botón "Renovar TA" da error 500 porque falta la implementación completa del servicio WSAA con los requisitos específicos de AFIP.

## Solución

Necesitas reemplazar la función `renovarTA` en `src/facturacion/services/wsaaService.real.js` con la implementación correcta que incluye:

### Requisitos Críticos de AFIP:

1. **Header SOAPAction vacío**: `'SOAPAction': ''` (obligatorio)
2. **TRA sin BOM**: Guardar como Buffer UTF-8
3. **Firma binaria**: OpenSSL con flag `-binary`
4. **Variables de entorno necesarias**:
   ```
   AFIP_HOMO_CERT_PATH=C:\Users\Martin\Documents\cert-arca\homo\homo_cert.pem
   AFIP_HOMO_KEY_PATH=C:\Users\Martin\Documents\cert-arca\homo\homo_key.pem
   AFIP_HOMO_WSAA_URL=https://wsaahomo.afip.gov.ar/ws/services/LoginCms
   ```

### Pasos para Implementar:

1. **Agregar variables al `.env`** del módulo de facturación
2. **Instalar axios** si no está: `npm install axios`
3. **Reemplazar la función `renovarTA`** con el código proporcionado en el feedback
4. **Reiniciar el servidor**

### Código de Referencia

Ver el feedback del usuario que contiene la implementación completa con:
- Generación de TRA con timestamps correctos
- Firma con OpenSSL usando `-binary`
- SOAP request con SOAPAction vacío
- Parseo de respuesta WSAA
- UPSERT en BD

### Testing

```bash
# 1. Agregar variables al .env
# 2. Reiniciar servidor
npm start

# 3. Probar endpoint
curl -X POST http://localhost:3004/facturacion/afip/homo/ta/refresh

# 4. Verificar en BD
SELECT * FROM factura_afip_ta WHERE entorno='HOMO';
```

## Alternativa Rápida

Si prefieres, puedes usar el script PowerShell que ya tienes (`obtener-ta-corregido.ps1`) para obtener el TA manualmente y cargarlo en la BD, mientras implementas la solución completa en el backend.
