---
trigger: always_on
description: Reglas permanentes de arquitectura LAMDA (Producción vs Laboratorio, sincronización Git en desarrollo y blindajes de seguridad)
---

# Reglas Permanentes del Proyecto LAMDA

1. **Mapa de la Arquitectura LAMDA:**
   - **Producción (`main`):** Corre en Google Cloud (`34.39.187.220` — `/opt/lamda/sincronizador-etiquetas`) y en `PcAlmacen` Standby (`C:\Users\Martin\Documents\sincronizador-etiquetas - copia`) sobre la base productiva `etiquetas`.
   - **Laboratorio (`desarrollo`):** Corre en espejo entre la **Notebook** (`C:\Users\Martin\Documents\LAMDA-Laboratorio`) y el Laboratorio de **`PcAlmacen`** (`C:\Users\Martin\Documents\LAMDA-Laboratorio`) sobre la base de pruebas `etiquetas_pruebas`.

2. **Reglas Operativas en la Notebook (`SERVEDIORA`):**
   - En tareas de desarrollo se trabaja **únicamente** sobre la rama `desarrollo` y la base `etiquetas_pruebas` (`LAMDA_MODO_LABORATORIO=true`, `DB_PASSWORD=taKionga`).
   - **Prohibido** hacer commits o push directos a la rama `main`. El pase de `desarrollo` a `main` y el despliegue a Producción solo pueden ejecutarse cuando el usuario lo ordene con la frase expresa **`"Pasá esto a Producción"`** mediante `node scripts/publicarDesarrolloAProduccion.js --confirmar-produccion`.

3. **Flujo Automático de Sincronización en `desarrollo`:**
   - **Al iniciar tarea:** Verificar `git status`, limpiar ruido de runtime, ejecutar `git pull --rebase origin desarrollo` y aplicar diferencias de esquema con `node scripts/auditarDiferenciasEsquemaDb.js --apply-lab`.
   - **Al finalizar tarea:** Limpiar archivos de ruido de runtime (`data/ia_credito_ledger.json`, PDFs en `src/app-etiquetas/documentos/*.pdf`, `pagina-publica-web/dist`), exportar esquema actual con `node scripts/auditarDiferenciasEsquemaDb.js --export-lab`, hacer `git commit` en `desarrollo` y `git push origin desarrollo` automáticamente.

4. **Blindajes Inamovibles:**
   - Mantener intactos la simulación local de ARCA en Laboratorio (`esModoLaboratorioAfip()`), la protección dual de WhatsApp sin consumo de QR en Laboratorio (`esModoLaboratorioWa()` con `DB_NAME === 'etiquetas_pruebas'` y `LAMDA_MODO_LABORATORIO === 'true'`), y los controladores del Switch de Producción (`lamdaSwitchGuiServer.js`, `orquestadorSwitchLocalNube.js`, `lamdaCloudAuthGuard.js`).
