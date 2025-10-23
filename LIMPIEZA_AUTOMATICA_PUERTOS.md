# Limpieza Automática de Puertos

## 📋 Descripción

Se ha implementado un sistema de limpieza automática de puertos que se ejecuta cada vez que inicias el proyecto con `npm start` o `npm start:local`. Esto previene errores comunes de "puerto en uso" (EADDRINUSE) al garantizar que los puertos estén libres antes de iniciar los servicios.

## 🔧 Componentes

### 1. Script de Limpieza (`scripts/limpiar-puertos.ps1`)

Script de PowerShell que:
- ✅ Verifica cada puerto usado por el proyecto (3000, 3002, 3003, 3004)
- ✅ Detecta procesos que estén usando estos puertos
- ✅ Detiene automáticamente esos procesos
- ✅ Confirma que los puertos estén libros antes de continuar

### 2. Modificación en package.json

Los comandos `start` y `start:local` ahora ejecutan automáticamente la limpieza:

```json
"start": "pwsh -ExecutionPolicy Bypass -File scripts/limpiar-puertos.ps1 && concurrently ..."
"start:local": "pwsh -ExecutionPolicy Bypass -File scripts/limpiar-puertos.ps1 && concurrently ..."
```

## 🚀 Uso

### Inicio Normal (con Cloudflared)
```bash
npm start
```

### Inicio Local (sin Cloudflared)
```bash
npm start:local
```

## 📊 Puertos del Sistema

| Puerto | Servicio | Descripción |
|--------|----------|-------------|
| 3000 | Etiquetas | Servidor principal de etiquetas |
| 3002 | Producción | Servidor de producción con WebSocket |
| 3003 | Presupuestos | Módulo de presupuestos |
| 3004 | Facturación | Módulo de facturación AFIP |

## 🎯 Ventajas

1. **Inicio Limpio**: Garantiza que no haya conflictos de puertos
2. **Automático**: No necesitas recordar ejecutar comandos de limpieza manualmente
3. **Visual**: Muestra en consola qué procesos se detienen y confirma cuando los puertos están libres
4. **Rápido**: Solo toma 2-3 segundos antes de iniciar los servicios

## 🔍 Qué Hace el Script

1. **Verifica** cada puerto (3000, 3002, 3003, 3004)
2. **Detecta** si hay algún proceso usando esos puertos
3. **Detiene** los procesos encontrados de forma segura
4. **Confirma** que los puertos estén libres
5. **Espera** 2 segundos para asegurar la liberación
6. **Continúa** con el inicio normal de los servicios

## 💡 Ejemplo de Salida

```
=============================================
  LIMPIEZA DE PUERTOS - Sistema LAMDA
=============================================

Verificando puerto 3000...
  ✓ Puerto 3000 está libre
Verificando puerto 3002...
  → Deteniendo proceso: node.exe (PID: 12345)
  ✓ Proceso detenido exitosamente
Verificando puerto 3003...
  ✓ Puerto 3003 está libre
Verificando puerto 3004...
  ✓ Puerto 3004 está libre

=============================================
  Limpieza completada
=============================================

Puertos listos para usar. Iniciando servicios...
```

## 🛠️ Solución de Problemas

### Error: "No se puede ejecutar scripts en este sistema"

Si ves un error relacionado con la política de ejecución de PowerShell:

```bash
# Opción 1: Usar el comando kill-ports manual
npm run kill-ports

# Opción 2: Cambiar política de ejecución (como administrador)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Script Manual de Limpieza

Si necesitas limpiar puertos manualmente sin iniciar los servicios:

```bash
# PowerShell
pwsh -ExecutionPolicy Bypass -File scripts/limpiar-puertos.ps1

# O usando el script npm existente
npm run kill-ports
```

## 📝 Notas Técnicas

- El script usa PowerShell Core (`pwsh`) que viene instalado por defecto en Windows 11
- Se ejecuta con `-ExecutionPolicy Bypass` para evitar problemas de permisos
- Usa `Get-NetTCPConnection` para detectar procesos en puertos específicos
- Detiene procesos con `Stop-Process -Force` para asegurar la liberación
- Incluye un delay de 2 segundos para garantizar que el SO libere completamente los puertos

## 🔄 Versión Anterior

El comando `npm run kill-ports` sigue disponible como alternativa:
```bash
npm run kill-ports  # Usa npx kill-port
```

Pero el nuevo sistema automático es más confiable y no requiere dependencias adicionales.
