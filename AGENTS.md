# Reglas Permanentes del Proyecto LAMDA (Memoria de Arquitectura y Operación)

> **IMPORTANTE PARA EL AGENTE DE IA (Antigravity / Gemini / Cursor):**
> Este archivo define la arquitectura oficial de ramas, bases de datos, sincronización por GitHub y blindajes de seguridad del ecosistema **LAMDA**. Estas reglas son de cumplimiento obligatorio en todas las conversaciones sin necesidad de que el usuario las repita.

---

## 1. Mapa de la Arquitectura LAMDA

### A. Entorno de Producción (Rama `main` — Base de Datos `etiquetas`)
- **Producción Titular (24/7):** Corre en **Google Cloud (`34.39.187.220`)** en `/opt/lamda/sincronizador-etiquetas` bajo el dominio `https://logistica.lamdaser.com`, conectada a la base productiva `etiquetas`.
- **Producción Respaldo (Standby):** Corre en **`PcAlmacen`** en `C:\Users\Martin\Documents\sincronizador-etiquetas - copia` conectada a la base productiva local `etiquetas`, manteniendo activo el Puente Zebra (`3099`).
- **Conmutación (`LAMDA Switch`):** Orquesta el estado Activo/Standby entre Nube y `PcAlmacen`, sincronizando la base `etiquetas` y aplicando candados `Read-Only` en el nodo en espera.

### B. Entorno de Desarrollo / Laboratorio (Rama `desarrollo` — Base de Datos `etiquetas_pruebas`)
- **Espejo simétrico de Laboratorio entre dos máquinas:**
  1. **Esta `Notebook` (`COMPUTERNAME=SERVEDIORA`):** Ubicada en `C:\Users\Martin\Documents\LAMDA-Laboratorio`.
  2. **Laboratorio de `PcAlmacen`:** Ubicado en `C:\Users\Martin\Documents\LAMDA-Laboratorio`.
- Ambos entornos de Laboratorio trabajan **exclusivamente** sobre la rama **`desarrollo`** y conectados a su base PostgreSQL local de pruebas **`etiquetas_pruebas`** con `LAMDA_MODO_LABORATORIO=true`.
- **Puertos de los 5 servicios Node.js + Gateway:**
  - `3000`: Gestiones LAMDA y Etiquetas (`src/app-etiquetas/server.js`)
  - `3002`: Facturación y ARCA (`src/facturacion/server.js`)
  - `3003`: Presupuestos y Clientes (`src/presupuestos/app.js`)
  - `3004`: Producción, Recetas y Stock (`src/produccion/app.js`)
  - `3005`: Logística, Reparto y App Móvil / Gateway Unificado (`src/logistica/app.js`)

---

## 2. Reglas Operativas Estrictas en la Notebook

1. **Rama y Base Exclusivas:**
   - En la Notebook (`C:\Users\Martin\Documents\LAMDA-Laboratorio`) se trabaja **únicamente** sobre la rama **`desarrollo`** y la base de datos **`etiquetas_pruebas`** (`LAMDA_MODO_LABORATORIO=true`, `DB_NAME=etiquetas_pruebas`, `DB_PASSWORD=taKionga`).
2. **Prohibición Total de tocar `main` desde la Notebook:**
   - Desde la Notebook **jamás** se hace `git checkout main`, ni commits en `main`, ni `git push origin main`.
   - El pase de `desarrollo` a `main` y el despliegue a Producción (`Google Cloud` + `PcAlmacen Standby`) se ejecutan **exclusivamente desde `PcAlmacen`** mediante `node scripts/publicarDesarrolloAProduccion.js`.
3. **Panel de Control del Modo Laboratorio:**
   - El ejecutable del panel en la Notebook es `scripts/LamdaControlPanel.exe` (compilado desde `scripts/LamdaControlPanel.cs` con ícono gris `scripts/lamda-lab.ico`).
   - Siempre que se modifique `scripts/LamdaControlPanel.cs`, se debe recompilar `scripts/LamdaControlPanel.exe` con `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /out:"scripts\LamdaControlPanel.exe" /win32icon:"scripts\lamda-lab.ico" "scripts\LamdaControlPanel.cs"`.

---

## 3. Flujo Automático de Sincronización en `desarrollo`

### Al iniciar cualquier tarea nueva:
1. Verificar `git status -sb` para asegurar que se está en la rama `desarrollo`.
2. Limpiar archivos de ruido de runtime si estuvieran modificados (`data/ia_credito_ledger.json`, PDFs efímeros en `src/app-etiquetas/documentos/*.pdf`, `pagina-publica-web/dist`).
3. Traer los últimos cambios desde GitHub:
   ```powershell
   git pull --rebase origin desarrollo
   ```
4. Aplicar automáticamente en `etiquetas_pruebas` cualquier tabla o columna nueva traída desde el otro equipo:
   ```powershell
   node scripts/auditarDiferenciasEsquemaDb.js --apply-lab
   ```

### Al finalizar y verificar un cambio pedido por el usuario:
1. Limpiar archivos de ruido de runtime (`data/ia_credito_ledger.json`, `src/app-etiquetas/documentos/*.pdf`, `pagina-publica-web/dist`).
2. Exportar el snapshot actualizado del esquema de `etiquetas_pruebas` hacia `migrations/schema_laboratorio_snapshot.json`:
   ```powershell
   node scripts/auditarDiferenciasEsquemaDb.js --export-lab
   ```
3. Hacer `git add`, `git commit` descriptivo en la rama `desarrollo` y **`git push origin desarrollo` automáticamente**, para que `PcAlmacen` ya tenga los cambios de código y estructura de base de datos listos sin intervención manual.

---

## 4. Blindajes de Seguridad que NO Deben Desactivarse

1. **Simulación local de ARCA / AFIP en Laboratorio (`esModoLaboratorioAfip()` en `src/facturacion/services/afipService.js` y `src/facturacion/controllers/facturasController.js`):**
   - En Laboratorio (`DB_NAME === 'etiquetas_pruebas'` / `LAMDA_MODO_LABORATORIO === 'true'`), jamás se contacta a WSAA ni WSFEv1 de ARCA real ni se generan certificados de producción; la emisión de CAE se simula localmente (`CAE 79999...`).
2. **Protección Dual de WhatsApp sin consumo de QR en Laboratorio (`esModoLaboratorioWa()` en `src/facturacion/services/whatsappService.js`):**
   - Exige simultáneamente `DB_NAME === 'etiquetas_pruebas'` **y** `LAMDA_MODO_LABORATORIO === 'true'`.
   - En Laboratorio **no** levanta Puppeteer/Chromium ni pide escanear QR (para no consumir cupos de dispositivos vinculados ni desloguear Producción). Simula el envío localmente informando la redirección de prueba a `+5492216615746`.
   - Si `DB_NAME === 'etiquetas'` (Producción), jamás redirige ni simula envíos.
3. **Controladores del Switch de Producción y Guardia Cloud:**
   - Mantener siempre intactos `scripts/lamdaSwitchGuiServer.js`, `scripts/orquestadorSwitchLocalNube.js`, `src/shared/lamdaCloudAuthGuard.js` y `src/shared/lamdaCloudRuntime.js`.
   - Mantener intacto el endpoint `/api/admin/db-snapshot-pruebas` en `src/logistica/app.js` y el restaurador `scripts/dbRestaurarPruebas.js` que alimentan a `etiquetas_pruebas` con copias sanitizadas de Producción (vaciando `factura_afip_ta`).
