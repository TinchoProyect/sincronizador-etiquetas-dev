const fs = require('fs');
let text = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

const t1_find = `<div class="tarjeta-cuerpo" style="position: relative;">
                <div class="tarjeta-header">
                    <input type="checkbox" class="checkbox-ajuste" data-id="\${ingredienteIdReal}" onchange="window.toggleSeleccionAjuste(this)" \${isChecked ? "checked" : ""}>
                    <span class="tarjeta-codigo">\${ingrediente.codigo || '-'}</span>
                </div>
                <h3 class="tarjeta-titulo">\${ingrediente.nombre_ingrediente || ingrediente.nombre}</h3>
                \${ingrediente.descripcion ? \`<p class="tarjeta-descripcion" title="\${ingrediente.descripcion}">\${ingrediente.descripcion}</p>\` : \`<p class="tarjeta-descripcion" style="visibility: hidden; user-select: none;">-</p>\`}

                <div class="tarjeta-stats">
                    <div class="stat-item \${parseFloat(ingrediente.stock_total) <= 0 ? 'stock-cero' : ''}">
                        <span class="stat-label">STOCK ASIGNADO</span>
                        <span class="stat-value">\${window.formatearStock ? window.formatearStock(ingrediente.stock_total) : parseFloat(ingrediente.stock_total).toFixed(3)} <small>\${ingrediente.unidad_medida}</small></span>
                    </div>
                </div>
            </div>`;

const t1_replace = `<div class="tarjeta-cuerpo" style="position: relative; padding: 10px;">
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
            </div>`;


const t2_find = `<div class="tarjeta-cuerpo" style="position: relative;">
                    <div class="tarjeta-header">
                        <input type="checkbox" class="checkbox-ajuste" data-id="\${ingredienteIdReal}" onchange="window.toggleSeleccionAjuste(this)" \${isChecked ? "checked" : ""}>
                        <span class="tarjeta-codigo">\${ingrediente.codigo || '-'}</span>
                    </div>
                    <h3 class="tarjeta-titulo">\${ingrediente.nombre_ingrediente || ingrediente.nombre}</h3>
                    \${ingrediente.descripcion ? \`<p class="tarjeta-descripcion" title="\${ingrediente.descripcion}">\${ingrediente.descripcion}</p>\` : \`<p class="tarjeta-descripcion" style="visibility: hidden; user-select: none;">-</p>\`}

                    <div class="tarjeta-stats" style="display: flex; flex-direction: column; gap: 0;">
                        <!-- STOCK FÍSICO: Colorimetría Semántica según Signo Numérico -->
                        <div class="stat-item \${ingrediente.stock_actual < 0 ? 'stock-cero' : ''}" style="margin-bottom: 2px;">
                            <span class="stat-label" style="font-size: 0.75rem; color: #64748b; font-weight: 700; letter-spacing: 0.5px;">STOCK FÍSICO</span>
                            <span class="stat-value" style="display: block; font-size: 2rem; font-weight: 900; color: \${window.obtenerColorStock ? window.obtenerColorStock(ingrediente.stock_actual) : '#3b82f6'}; line-height: 1.1; margin-top: 2px;">
                                \${window.formatearStock ? window.formatearStock(ingrediente.stock_actual) : ingrediente.stock_actual} 
                                <small style="font-size: 1rem; font-weight: 600; color: #64748b;">\${ingrediente.unidad_medida}</small>
                            </span>
                        </div>
                        <!-- STOCK POTENCIAL: Texto descriptivo y numérico forzados en una única línea block -->
                        <div style="display: block; text-align: right; padding-top: 4px; margin-top: 6px; border-top: 1px dashed #cbd5e1;">
                            <span style="font-size: 0.70rem; color: #94a3b8; font-weight: 600;">Potencial: \${window.formatearStock ? window.formatearStock(ingrediente.stock_potencial) : ingrediente.stock_potencial}</span>
                            <span style="font-size: 0.65rem; font-weight: 600; color: #94a3b8;">\${ingrediente.unidad_medida}</span>
                        </div>
                    </div>
                </div>`;

const t2_replace = `<div class="tarjeta-cuerpo" style="position: relative; padding: 10px;">
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
                        <div class="stat-item \${ingrediente.stock_actual < 0 ? 'stock-cero' : ''}" style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0px; padding: 2px 4px;">
                            <span class="stat-label" style="font-size: 0.70rem; color: #64748b; font-weight: 700; letter-spacing: 0.5px; margin: 0;">STOCK FÍSICO</span>
                            <span class="stat-value" style="font-size: 1.6rem; font-weight: 900; color: \${window.obtenerColorStock ? window.obtenerColorStock(ingrediente.stock_actual) : '#3b82f6'}; line-height: 1; margin: 0;">
                                \${window.formatearStock ? window.formatearStock(ingrediente.stock_actual) : ingrediente.stock_actual} 
                                <small style="font-size: 0.85rem; font-weight: 600; color: #64748b;">\${ingrediente.unidad_medida}</small>
                            </span>
                        </div>
                        <!-- STOCK POTENCIAL: Texto descriptivo y numérico forzados en una única línea block -->
                        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 4px; margin-top: 4px; border-top: 1px dashed #cbd5e1;">
                            <span style="font-size: 0.65rem; color: #94a3b8; font-weight: 600;">STOCK POTENCIAL</span>
                            <div style="text-align: right;">
                                <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 700;">\${window.formatearStock ? window.formatearStock(ingrediente.stock_potencial) : ingrediente.stock_potencial}</span>
                                <span style="font-size: 0.70rem; font-weight: 600; color: #94a3b8;">\${ingrediente.unidad_medida}</span>
                            </div>
                        </div>
                    </div>
                </div>`;

const stripWhitespace = (str) => str.replace(/\\s+/g, '');

const index1 = stripWhitespace(text).indexOf(stripWhitespace(t1_find));
const index2 = stripWhitespace(text).indexOf(stripWhitespace(t2_find));
console.log('T1 found:', index1 !== -1);
console.log('T2 found:', index2 !== -1);

if (index1 !== -1 && index2 !== -1) {
    // Poor man's normalize matching regex since exact whitespace matching across OS is a nightmare
    const escapeRegex = (s) => s.replace(/[-/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
    
    // Convert multiple whitespace in target to handle any spacing in actual file
    const toFlexibleRegex = (str) => {
        return new RegExp(escapeRegex(str).replace(/\\s+/g, '\\\\s+'), 'g');
    };

    text = text.replace(toFlexibleRegex(t1_find), t1_replace);
    text = text.replace(toFlexibleRegex(t2_find), t2_replace);
    
    fs.writeFileSync('src/produccion/js/ingredientes.js', text);
    console.log("Success replacing");
} else {
    console.log("Failed to find targets");
}
