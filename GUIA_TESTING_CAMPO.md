# 🛠️ GUÍA DE TESTING DE CAMPO Y CORRECCIONES QUIRÚRGICAS

## 📋 HERRAMIENTAS DISPONIBLES

### 1. **HERRAMIENTAS DE TESTING DE CAMPO** (`herramientas_testing_campo.js`)
Herramientas para diagnóstico y correcciones puntuales durante las pruebas de campo.

#### Comandos disponibles:
```bash
# Diagnóstico general del sistema
node herramientas_testing_campo.js integridad

# Verificar un presupuesto específico
node herramientas_testing_campo.js verificar mg0sctql-y1zae

# Crear MAP faltante para presupuestos específicos
node herramientas_testing_campo.js corregir-map mg0sctql-y1zae

# Limpiar duplicados y huérfanos en MAP
node herramientas_testing_campo.js limpiar

# Simular próxima sincronización (sin ejecutar)
node herramientas_testing_campo.js simular
```

### 2. **MONITOR DE SINCRONIZACIÓN** (`monitor_sincronizacion.js`)
Monitoreo en tiempo real y alertas automáticas.

#### Comandos disponibles:
```bash
# Monitoreo continuo (cada 30 segundos)
node monitor_sincronizacion.js monitor

# Snapshot único del estado actual
node monitor_sincronizacion.js snapshot
```

#### Configuración del monitor:
- **Intervalo**: 30 segundos
- **Alertas automáticas**: Activadas
- **Límites de alerta**:
  - Máx. presupuestos sin MAP: 5
  - Máx. detalles huérfanos: 10
  - Máx. tiempo sin sync: 60 minutos

### 3. **AUTO-REPARACIÓN** (`auto_reparacion.js`)
Correcciones automáticas de problemas comunes.

#### Comandos disponibles:
```bash
# Ejecutar en modo seguro (solo reporta, no modifica)
node auto_reparacion.js seguro

# Ejecutar reparaciones reales
node auto_reparacion.js ejecutar

# Solo reparar MAP faltante
node auto_reparacion.js map ejecutar

# Solo limpiar MAP huérfanos
node auto_reparacion.js limpiar ejecutar
```

## 🔄 FLUJO DE TRABAJO RECOMENDADO

### **FASE 1: DIAGNÓSTICO INICIAL**
```bash
# 1. Estado general del sistema
node herramientas_testing_campo.js integridad

# 2. Snapshot del estado actual
node monitor_sincronizacion.js snapshot

# 3. Simular próxima sincronización
node herramientas_testing_campo.js simular
```

### **FASE 2: CORRECCIONES PREVENTIVAS**
```bash
# 1. Verificar qué se repararía (modo seguro)
node auto_reparacion.js seguro

# 2. Si todo se ve bien, ejecutar reparaciones
node auto_reparacion.js ejecutar

# 3. Verificar resultado
node herramientas_testing_campo.js integridad
```

### **FASE 3: MONITOREO CONTINUO**
```bash
# Iniciar monitor en tiempo real
node monitor_sincronizacion.js monitor
```

### **FASE 4: CORRECCIONES QUIRÚRGICAS**
```bash
# Para presupuestos específicos con problemas
node herramientas_testing_campo.js verificar <ID_PRESUPUESTO>
node herramientas_testing_campo.js corregir-map <ID_PRESUPUESTO>
```

## 🚨 ALERTAS Y PROBLEMAS COMUNES

### **Problema: Presupuestos sin MAP**
**Síntomas**: Detalles creados pero no sincronizados a Sheets
**Solución**:
```bash
node herramientas_testing_campo.js verificar <ID_PRESUPUESTO>
node herramientas_testing_campo.js corregir-map <ID_PRESUPUESTO>
```

### **Problema: MAP huérfanos**
**Síntomas**: Entradas en MAP sin detalles correspondientes
**Solución**:
```bash
node auto_reparacion.js limpiar ejecutar
```

### **Problema: Duplicados en MAP**
**Síntomas**: Múltiples entradas MAP para el mismo ID
**Solución**:
```bash
node herramientas_testing_campo.js limpiar
```

### **Problema: Sincronización lenta o fallida**
**Síntomas**: Tiempo excesivo sin sincronización exitosa
**Diagnóstico**:
```bash
node herramientas_testing_campo.js simular
node monitor_sincronizacion.js snapshot
```

## 📊 MÉTRICAS CLAVE A MONITOREAR

### **Integridad de Datos**
- ✅ **Presupuestos activos**: Total de presupuestos en estado activo
- ✅ **Detalles con MAP**: Porcentaje de detalles que tienen MAP
- ✅ **MAP huérfanos**: Entradas MAP sin detalle correspondiente
- ✅ **Fuente consistente**: MAP con fuente correcta (Local/AppSheet)

### **Performance de Sincronización**
- ⏱️ **Última sincronización**: Tiempo transcurrido desde última sync
- ✅ **Sincronización exitosa**: Estado de la última sincronización
- 📊 **Registros procesados**: Cantidad de registros en última sync
- 🔄 **Cambios recientes**: Presupuestos modificados en últimos 5 minutos

### **Problemas Detectados**
- ❌ **Sin MAP**: Presupuestos con detalles pero sin MAP
- 🔶 **MAP parcial**: Presupuestos con MAP incompleto
- ⚠️ **Sin detalles**: Presupuestos sin detalles asociados
- 🚨 **Errores críticos**: Problemas que requieren atención inmediata

## 🔧 CONFIGURACIONES IMPORTANTES

### **Archivos de configuración**:
- `herramientas_testing_campo.js`: Configuración de herramientas
- `monitor_sincronizacion.js`: CONFIG_MONITOR
- `auto_reparacion.js`: CONFIG_REPARACION

### **Logs generados**:
- `monitor_sync.log`: Log del monitor continuo
- `auto_reparacion.log`: Log de reparaciones automáticas
- `backup_map_*.sql`: Backups automáticos antes de reparaciones
- `snapshot_*.txt`: Snapshots del estado del sistema

## ⚠️ PRECAUCIONES DE SEGURIDAD

### **SIEMPRE**:
1. ✅ Ejecutar primero en **modo seguro**
2. ✅ Verificar **backups automáticos**
3. ✅ Revisar **logs detallados**
4. ✅ Probar con **presupuestos específicos** antes de operaciones masivas

### **NUNCA**:
1. ❌ Ejecutar reparaciones masivas sin backup
2. ❌ Ignorar alertas críticas del monitor
3. ❌ Modificar MAP manualmente sin herramientas
4. ❌ Ejecutar múltiples reparaciones simultáneamente

## 📞 ESCALACIÓN DE PROBLEMAS

### **Nivel 1 - Problemas Menores** (Auto-reparables)
- MAP faltante para pocos presupuestos
- Duplicados menores en MAP
- Detalles huérfanos ocasionales

### **Nivel 2 - Problemas Moderados** (Requieren atención)
- Múltiples presupuestos sin MAP
- Sincronización fallando repetidamente
- Inconsistencias en fuente MAP

### **Nivel 3 - Problemas Críticos** (Requieren intervención manual)
- Corrupción masiva de MAP
- Pérdida de integridad referencial
- Fallas sistemáticas de sincronización

## 🎯 OBJETIVOS DE CALIDAD

### **Métricas objetivo**:
- 📊 **MAP Coverage**: > 98% de detalles con MAP
- ⏱️ **Sync Frequency**: < 5 minutos entre sincronizaciones
- ✅ **Success Rate**: > 95% de sincronizaciones exitosas
- 🔧 **Auto-repair**: < 2% de problemas requieren intervención manual

### **Indicadores de salud**:
- 🟢 **Verde**: Todas las métricas dentro de objetivos
- 🟡 **Amarillo**: Una métrica fuera de objetivo
- 🔴 **Rojo**: Múltiples métricas fuera de objetivo o problemas críticos

---

## 📚 COMANDOS DE REFERENCIA RÁPIDA

```bash
# DIAGNÓSTICO RÁPIDO
node herramientas_testing_campo.js integridad

# MONITOREO CONTINUO
node monitor_sincronizacion.js monitor

# REPARACIÓN SEGURA
node auto_reparacion.js seguro

# VERIFICAR PRESUPUESTO ESPECÍFICO
node herramientas_testing_campo.js verificar <ID>

# CORRECCIÓN QUIRÚRGICA
node herramientas_testing_campo.js corregir-map <ID>
```

**¡Mantén esta guía a mano durante las pruebas de campo!** 🚀
