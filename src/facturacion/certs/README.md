# Certificados AFIP

Esta carpeta debe contener los certificados y claves privadas para autenticación con AFIP.

## ⚠️ IMPORTANTE

**NUNCA commitear certificados o claves reales al repositorio.**

Los archivos `.pem` están incluidos en `.gitignore` para evitar commits accidentales.

## 📋 Archivos Requeridos

### Homologación (Pruebas)
- `homo-cert.pem` - Certificado de homologación
- `homo-key.pem` - Clave privada de homologación

### Producción
- `prod-cert.pem` - Certificado de producción
- `prod-key.pem` - Clave privada de producción

## 🔐 Cómo Obtener Certificados

### Para Homologación

1. Ir a https://www.afip.gob.ar/ws/
2. Descargar el certificado de prueba
3. Guardar como `homo-cert.pem` y `homo-key.pem`

### Para Producción

1. Generar un CSR (Certificate Signing Request):
   ```bash
   openssl req -new -newkey rsa:2048 -nodes -keyout prod-key.pem -out prod.csr
   ```

2. Ingresar a AFIP con Clave Fiscal
3. Ir a: Sistema Registral > Administrador de Relaciones de Clave Fiscal
4. Seleccionar: Adherir Servicio > Web Services
5. Cargar el archivo `prod.csr`
6. Descargar el certificado generado como `prod-cert.pem`

## 📝 Formato de Archivos

Los archivos deben estar en formato PEM:

```
-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKJ...
...
-----END CERTIFICATE-----
```

```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0...
...
-----END PRIVATE KEY-----
```

## 🔒 Seguridad

- Los certificados son personales e intransferibles
- Mantener las claves privadas seguras
- No compartir certificados entre ambientes
- Renovar certificados antes de su vencimiento
- Usar permisos restrictivos en los archivos:
  ```bash
  chmod 600 *.pem
  ```

## 🧪 Verificar Certificados

Para verificar que los certificados son válidos:

```bash
# Ver información del certificado
openssl x509 -in homo-cert.pem -text -noout

# Verificar que la clave corresponde al certificado
openssl x509 -noout -modulus -in homo-cert.pem | openssl md5
openssl rsa -noout -modulus -in homo-key.pem | openssl md5
# Los hashes MD5 deben coincidir
```

## 📅 Vigencia

- Certificados de homologación: Generalmente 1 año
- Certificados de producción: Generalmente 2 años

Configurar recordatorios para renovar antes del vencimiento.

## 🆘 Problemas Comunes

### Error: "Certificate not found"
- Verificar que los archivos existen en esta carpeta
- Verificar rutas en `.env`

### Error: "Invalid certificate format"
- Verificar que los archivos están en formato PEM
- Verificar que no hay espacios o caracteres extra

### Error: "Private key doesn't match certificate"
- Verificar que la clave privada corresponde al certificado
- Regenerar el par certificado/clave si es necesario

## 📚 Referencias

- [AFIP - Web Services](https://www.afip.gob.ar/ws/)
- [Manual de Certificados AFIP](https://www.afip.gob.ar/ws/documentacion/certificados.asp)
- [OpenSSL Documentation](https://www.openssl.org/docs/)
