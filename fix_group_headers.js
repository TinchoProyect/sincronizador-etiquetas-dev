const fs = require('fs');
const filePath = 'src/produccion/js/ingredientes.js';
let js = fs.readFileSync(filePath, 'utf8');

const regex = /const gruposArray = Object\.entries\(grupos\)\.map\(\[n, i\]\) => \{[\s\S]*?groupContent\.appendChild\(card\);\s*\n\s*\}\);/;

const replacement = `const gruposArray = Object.entries(grupos).map(([nombreSector, items]) => {
            const letraBackend = items[0] && items[0].sector_letra ? items[0].sector_letra : '';
            return { nombreSector, items, sector_letra: letraBackend };
        });
        
        // Ordenar estrictamente por el nombre del sector, no por letras inventadas
        gruposArray.sort((a, b) => a.nombreSector.localeCompare(b.nombreSector));

        for (const {nombreSector, items, sector_letra} of gruposArray) {
            const groupHeader = document.createElement('div');
            groupHeader.className = 'sector-group-header';
            
            const nombreLimpio = nombreSector.replace(/'/g, "\\\\'");
            
            let displayIzquierda = "";
            let displayCentro = "";
            let isLetter = false;

            // Si el backend nos dio una letra pura (ej: 'A', 'B'), formamos "Sector A"
            if (sector_letra && sector_letra !== nombreSector && sector_letra.length <= 2) {
                displayIzquierda = "Sector " + sector_letra;
                displayCentro = nombreSector; // nombre completo en el centro
                isLetter = true;
            } else {
                // Si no hay letra corta, el sector simplemente se llama como su nombre (Ej: "PARA MIX")
                displayIzquierda = nombreSector;
                displayCentro = ""; 
            }

            groupHeader.innerHTML = \`
                <div class="sector-header-flex" style="display: flex; justify-content: space-between; align-items: center; width: 100%; border-bottom: 2px solid #007bff; padding-bottom: 10px; margin-bottom: 15px;">
                    <div class="header-izq" style="font-size: 1.5rem; font-weight: 800; color: #2c3e50; min-width: 120px;">
                        \${displayIzquierda}
                    </div>
                    <div class="header-centro" style="font-size: 1.3rem; font-weight: 600; color: #475569; text-align: center; flex: 1;">
                        \${displayCentro}
                    </div>
                    <div class="header-der" style="min-width: 120px; text-align: right;">
                        <button class="btn-imprimir-cartel" style="background: #17a2b8; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-size: 0.95rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s;" onclick="window.imprimirCartelSector('\${isLetter ? sector_letra : ''}', '\${nombreLimpio}')">
                            🖨️ Cartel A4
                        </button>
                    </div>
                </div>
            \`;

            fragment.appendChild(groupHeader);

            const groupContent = document.createElement('div');
            groupContent.className = 'sector-group-content';
            
            items.forEach(ingrediente => {
                const card = document.createElement('div');
                card.className = \`ingrediente-card \${(ingrediente.stock_actual === 0 && ingrediente.stock_potencial === 0) ? 'con-stock-cero' : ''}\`;
                
                const ingredienteIdReal = ingrediente.ingrediente_id || ingrediente.id;
                
                card.innerHTML = \`
                <div class="card-left-band"></div>
                <div class="tarjeta-cuerpo">
                    <div class="tarjeta-header">
                        <span class="tarjeta-codigo">\${ingrediente.codigo || '-'}</span>
                    </div>
                    <div class="tarjeta-titulo">\${ingrediente.nombre_ingrediente || ingrediente.nombre}</div>
                    \${ingrediente.descripcion ? \`<div class="tarjeta-descripcion">\${ingrediente.descripcion}</div>\` : ''}
                    
                    <div class="tarjeta-stats">
                        <div class="stat-item \${ingrediente.stock_actual <= 0 ? 'stock-cero' : ''}">
                            <span class="stat-label">STOCK FÍSICO</span>
                            <span class="stat-value">\${window.formatearStock ? window.formatearStock(ingrediente.stock_actual) : ingrediente.stock_actual} <small>\${ingrediente.unidad_medida}</small></span>
                        </div>
                        <div class="stat-item pot-box">
                            <span class="stat-label">STOCK POTENCIAL</span>
                            <span class="stat-value">\${window.formatearStock ? window.formatearStock(ingrediente.stock_potencial) : ingrediente.stock_potencial} <small>\${ingrediente.unidad_medida}</small></span>
                        </div>
                    </div>
                </div>
                <!-- PANEL INFERIOR -->
                <div class="tarjeta-footer">
                    <button class="btn-tarjeta primary" onclick="mostrarModalFormula(\${ingredienteIdReal})">📋 Fórmula</button>
                    <!-- Agregamos el botoncito discreto del sector actual -->
                    <button class="btn-tarjeta-sector" onclick="abrirModalSector(\${ingredienteIdReal}, \${ingrediente.sector_id || 'null'})" title="Cambiar Sector">📍 Sec. \${isLetter ? sector_letra : 'Asg'}</button>
                    
                    <button class="btn-tarjeta info" onclick="mostrarInfoCompleta(\${ingredienteIdReal})">ℹ️ Info</button>
                    <button class="btn-tarjeta action" onclick="abrirModalImpresionGeneral(\${ingredienteIdReal}, '\${(ingrediente.nombre_ingrediente || ingrediente.nombre).replace(/'/g, "\\\\'")}')">🖨️ Etiquetas</button>
                    <button class="btn-tarjeta adjust" onclick="abrirModalAjusteManual(\${ingredienteIdReal || null}, '\${(ingrediente.nombre_ingrediente || ingrediente.nombre).replace(/'/g, "\\\\'")}', \${ingrediente.stock_total || ingrediente.stock_actual}, \${ingredienteIdReal})" title="Ajustar Stock Manualmente">✏️ Ajustar</button>
                </div>\`;
                groupContent.appendChild(card);
            });`;

js = js.substring(0, js.indexOf('const gruposArray = Object.entries(grupos)')) + replacement + js.substring(js.indexOf('fragment.appendChild(groupContent);'));

fs.writeFileSync(filePath, js, 'utf8');
console.log('Done replacement.');
