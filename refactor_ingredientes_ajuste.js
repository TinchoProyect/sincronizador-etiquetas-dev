const fs = require('fs');

let content = fs.readFileSync('src/produccion/pages/ingredientes.html', 'utf8');

// 1. Add "Ajuste Puntual" button
const btnNuevoIngrediente = `<button id="btn-nuevo-ingrediente" class="btn-agregar">+ Nuevo Ingrediente</button>`;
const btnAjustePuntual = `<button id="btn-nuevo-ingrediente" class="btn-agregar">+ Nuevo Ingrediente</button>\n                                <button id="btn-iniciar-ajuste" class="btn-agregar" style="background-color: #6366f1;" onclick="window.iniciarFlujoAjuste()">⚖️ Ajuste Puntual</button>`;
content = content.replace(btnNuevoIngrediente, btnAjustePuntual);

// 2. Add Modals and Sticky Header right before </main>
const modalesAjuste = `
            <!-- STICKY HEADER FASE 2 -->
            <div id="sticky-header-ajuste" style="display: none; position: fixed; top: 0; left: 0; width: 100%; background: #6366f1; color: white; padding: 15px 30px; z-index: 9999; box-shadow: 0 4px 6px rgba(0,0,0,0.1); justify-content: space-between; align-items: center;">
                <div style="display: flex; flex-direction: column;">
                    <h3 style="margin: 0; font-size: 1.2rem;">Modo Ajuste Puntual Activo</h3>
                    <span style="font-size: 0.9rem;" id="ajuste-usuario-label">Resp: -</span>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn-secundario" style="background: white; color: #6366f1; padding: 8px 16px; border-radius: 4px; font-weight: bold; cursor: pointer;" onclick="window.cancelarModoAjuste()">❌ Cancelar</button>
                    <button class="btn-primario" style="background: #10b981; color: white; padding: 8px 16px; border-radius: 4px; border: none; font-weight: bold; cursor: pointer;" onclick="window.confirmarSeleccionAjuste()">✅ Confirmar Selección (<span id="contador-seleccion-ajuste">0</span>)</button>
                </div>
            </div>

            <!-- MODAL FASE 1: SELECCION DE USUARIO -->
            <div id="modal-seleccion-usuario" class="modal-overlay" style="display: none; z-index: 10000;">
                <div class="modal-content" style="max-width: 400px; padding: 30px;">
                    <div class="modal-header" style="border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 20px;">
                        <h2>Seleccionar Responsable</h2>
                        <span class="close-modal" onclick="document.getElementById('modal-seleccion-usuario').style.display='none'">&times;</span>
                    </div>
                    <div class="form-group">
                        <label>👤 Operario Responsable:</label>
                        <select id="ajuste-usuario-select" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-top: 10px;">
                            <option value="">Cargando usuarios...</option>
                        </select>
                    </div>
                    <div class="form-actions" style="margin-top: 25px; display: flex; justify-content: flex-end; gap: 15px;">
                        <button type="button" class="btn-secundario" onclick="document.getElementById('modal-seleccion-usuario').style.display='none'">Cancelar</button>
                        <button type="button" class="btn-primario" style="background-color: #6366f1;" onclick="window.confirmarUsuarioYPasarAFase2()">Continuar ➔</button>
                    </div>
                </div>
            </div>

            <!-- MODAL FASE 3: EJECUCION DE AJUSTE -->
            <div id="modal-ejecucion-ajuste" class="modal-overlay" style="display: none; z-index: 10000;">
                <div class="modal-content" style="max-width: 800px; padding: 30px; width: 90%;">
                    <div class="modal-header" style="border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 20px;">
                        <h2>Ejecutar Ajuste Puntual</h2>
                        <span class="close-modal" onclick="document.getElementById('modal-ejecucion-ajuste').style.display='none'">&times;</span>
                    </div>
                    
                    <div style="max-height: 60vh; overflow-y: auto;">
                        <table style="width: 100%; border-collapse: collapse; text-align: left;">
                            <thead>
                                <tr style="border-bottom: 2px solid #e2e8f0; background: #f8fafc;">
                                    <th style="padding: 12px;">Ingrediente</th>
                                    <th style="padding: 12px; width: 120px;">Stock Actual</th>
                                    <th style="padding: 12px; width: 150px;">Nuevo Stock</th>
                                    <th style="padding: 12px; width: 100px;">Diferencial</th>
                                </tr>
                            </thead>
                            <tbody id="ajuste-ejecucion-tbody">
                                <!-- Filas generadas dinámicamente -->
                            </tbody>
                        </table>
                    </div>

                    <div class="form-group" style="margin-top: 20px;">
                        <label>📝 Observación / Motivo general del ajuste:</label>
                        <input type="text" id="ajuste-observacion" placeholder="Ej: Control de inventario general" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; margin-top: 5px;">
                    </div>

                    <div class="form-actions" style="margin-top: 25px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.9rem; color: #64748b;">La operación impactará la DB.</span>
                        <div style="display: flex; gap: 15px;">
                            <button type="button" class="btn-secundario" onclick="document.getElementById('modal-ejecucion-ajuste').style.display='none'">Cancelar</button>
                            <button type="button" id="btn-procesar-ajuste" class="btn-primario" style="background-color: #ef4444;" onclick="window.procesarAjustes()">⚠️ Impactar Ajuste</button>
                        </div>
                    </div>
                </div>
            </div>
`;
content = content.replace('</main>', modalesAjuste + '\n        </main>');

fs.writeFileSync('src/produccion/pages/ingredientes.html', content);
console.log('UI inyectada.');
