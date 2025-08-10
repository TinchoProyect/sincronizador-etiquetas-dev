# Sincronización de Clientes desde Lomasoft

Este script sincroniza clientes desde el endpoint remoto `https://api.lamdaser.com/api/clientes` hacia la tabla PostgreSQL `public."F2002"`.

## Requisitos

- La tabla `public."F2002"` debe tener un índice único sobre la columna `cliente_id` para que el `ON CONFLICT` funcione correctamente.
  
  Ejemplo de índice único:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS f2002_cliente_id_uidx ON public."F2002" (cliente_id);
  ```

- Variable de entorno opcional para cambiar el endpoint:
  ```
  LOMASOFT_CLIENTES_URL=https://api.lamdaser.com/api/clientes
  ```

## Uso

El script `syncClientes.js` se ejecuta desde el archivo batch `sincronizar-etiquetas.bat` junto con la sincronización de artículos.

No se deben modificar otras partes del flujo actual de artículos y stock.

## Logs

- Inicio y fin de sincronización
- Progreso cada 500 clientes procesados
- Manejo de errores con rollback y código de salida 1 (sin usar `process.exit(1)` directamente)
