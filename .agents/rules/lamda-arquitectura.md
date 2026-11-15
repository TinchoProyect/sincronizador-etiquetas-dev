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

5. **Política Permanente de Comunicaciones Administrativas (Cero `wa.me` / `mailto:`):**
   - En **ninguna** pantalla administrativa interna de LAMDA está permitido usar `wa.me`, `api.whatsapp.com` ni `mailto:` (solo se admiten en vistas públicas/externas para celulares de gestores/vecinos como `nodo-panel-gestor.html` y `nodo-tienda-vecino.html`).
   - Todo envío administrativo de WhatsApp o Email debe pasar siempre por una ventana modal previa con selección de contactos múltiples de `bunker_clientes` + destinatario manual opcional, selección de canal (`WhatsApp :3004` y/o `Email SMTP`), vista previa editable del mensaje/adjuntos y despacho directo por backend.

6. **Estándar Permanente de Flujos Guiados por Rol (Gestor vs. Cliente Final):**
   - **Paneles Operativos de Gestor (`nodo-panel-gestor.html`):** Usar desbloqueo progresivo con pasos numerados visibles; el paso activo lleva contraste pleno y borde de marca, mientras los pasos pendientes permanecen atenuados (`opacity: ~0.42`, fondo neutro, `pointer-events: none`, `disabled` y leyenda `"Completá el paso anterior"`), con scroll suave en móvil y reinicio en cascada al cambiar pasos previos.
   - **Flujos Correlativos de Cliente Final (`nodo-tienda-vecino.html` Checkout):** Usar wizard a pantalla completa (`100dvh`) de **1 sola acción por pantalla**, con cabecera de marca del nodo (respetando `tema_visual` y `logo_incluye_texto`), indicador `"Paso X de N"`, botón grande `"← Volver"`, botón `"Continuar"` deshabilitado hasta validar el paso actual y precarga limpia desde `localStorage` para compradores recurrentes.
