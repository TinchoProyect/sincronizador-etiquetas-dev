const fs = require('fs');
let lines = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8').split('\n');

const t1_replace = `            <div class="tarjeta-cuerpo" style="position: relative; padding: 10px;">
                <div class="tarjeta-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; padding: 0;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" class="checkbox-ajuste" data-id="\${ingredienteIdReal}" onchange="window.toggleSeleccionAjuste(this)" \${isChecked ? "checked" : ""}>
                        <span class="tarjeta-codigo" style="margin: 0; font-size: 0.8rem;">\${ingrediente.codigo || '-'}</span>
                    </div>
                    <h3 class="tarjeta-titulo" style="margin: 0; font-size: 1rem; text-align: right; max-width: 65%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="\${ingrediente.nombre_ingrediente || ingrediente.nombre}">\${ingrediente.nombre_ingrediente || ingrediente.nombre}</h3>
                </div>
                \${ingrediente.descripcion ? \`<p class="tarjeta-descripcion" title="\${ingrediente.descripcion}" style="margin-bottom: 6px; font-size: 0.8rem; line-height: 1.2;">\${ingrediente.descripcion}</p>\` : \`<p class="tarjeta-descripcion" style="display: none;">-</p>\`}

                <div class="tarjeta-stats" style="margin: 0; padding: 0;">
                    <div class="stat-item \${parseFloat(ingrediente.stock_total) <= 0 ? 'stock-cero' : ''}" style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0px; padding: 4px;">
                        <span class="stat-label" style="font-size: 0.70rem; color: #64748b; font-weight: 700; margin: 0;">STOCK ASIGNADO</span>
                        <span class="stat-value" style="font-size: 1.5rem; font-weight: 900; line-height: 1; margin: 0;">
                            \${window.formatearStock ? window.formatearStock(ingrediente.stock_total) : parseFloat(ingrediente.stock_total).toFixed(3)} 
                            <small style="font-size: 0.85rem; font-weight: 600; color: #64748b;">\${ingrediente.unidad_medida}</small>
                        </span>
                    </div>
                </div>
            </div>`.split('\n');

const t2_replace = `                <div class="tarjeta-cuerpo" style="position: relative; padding: 10px;">
                    <div class="tarjeta-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; padding: 0;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" class="checkbox-ajuste" data-id="\${ingredienteIdReal}" onchange="window.toggleSeleccionAjuste(this)" \${isChecked ? "checked" : ""}>
                            <span class="tarjeta-codigo" style="margin: 0; font-size: 0.8rem;">\${ingrediente.codigo || '-'}</span>
                        </div>
                        <h3 class="tarjeta-titulo" style="margin: 0; font-size: 1rem; text-align: right; max-width: 65%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="\${ingrediente.nombre_ingrediente || ingrediente.nombre}">\${ingrediente.nombre_ingrediente || ingrediente.nombre}</h3>
                    </div>
                    \${ingrediente.descripcion ? \`<p class="tarjeta-descripcion" title="\${ingrediente.descripcion}" style="margin-bottom: 6px; font-size: 0.8rem; line-height: 1.2;">\${ingrediente.descripcion}</p>\` : \`<p class="tarjeta-descripcion" style="display: none;">-</p>\`}

                    <div class="tarjeta-stats" style="display: flex; flex-direction: column; gap: 0; margin: 0; padding: 0;">
                        <!-- STOCK FÍSICO: Header y Valor Horizontal -->
                        <div class="stat-item \${ingrediente.stock_actual < 0 ? 'stock-cero' : ''}" style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0px; padding: 2px 0px;">
                            <span class="stat-label" style="font-size: 0.70rem; color: #64748b; font-weight: 700; letter-spacing: 0.5px; margin: 0;">STOCK FÍSICO</span>
                            <span class="stat-value" style="font-size: 1.6rem; font-weight: 900; color: \${window.obtenerColorStock ? window.obtenerColorStock(ingrediente.stock_actual) : '#3b82f6'}; line-height: 1; margin: 0;">
                                \${window.formatearStock ? window.formatearStock(ingrediente.stock_actual) : ingrediente.stock_actual} 
                                <small style="font-size: 0.85rem; font-weight: 600; color: #64748b;">\${ingrediente.unidad_medida}</small>
                            </span>
                        </div>
                        <!-- STOCK POTENCIAL: Texto descriptivo y numérico forzados en una única línea block -->
                        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 4px; margin-top: 2px; border-top: 1px dashed #cbd5e1;">
                            <span style="font-size: 0.65rem; color: #94a3b8; font-weight: 600;">STOCK POTENCIAL</span>
                            <div style="text-align: right;">
                                <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 700;">\${window.formatearStock ? window.formatearStock(ingrediente.stock_potencial) : ingrediente.stock_potencial}</span>
                                <span style="font-size: 0.70rem; font-weight: 600; color: #94a3b8;">\${ingrediente.unidad_medida}</span>
                            </div>
                        </div>
                    </div>
                </div>`.split('\n');

// T2 length=22 lines, T1 length=15 lines. We will extract exactly what is in the file right now
// For safety.
// Splice out lines 1156 through 1176 (21 lines)
lines.splice(1156, 21, ...t2_replace);

// Splice out lines 1058 through 1072 (15 lines)
lines.splice(1058, 15, ...t1_replace);

fs.writeFileSync('src/produccion/js/ingredientes.js', lines.join('\n'));
console.log('Success');
