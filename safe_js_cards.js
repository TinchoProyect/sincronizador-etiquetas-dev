const fs = require('fs');
const FILE_PATH = 'src/produccion/js/ingredientes.js';

let js = fs.readFileSync(FILE_PATH, 'utf8');

const replacement = `function actualizarTablaIngredientes(ingredientes, esVistaUsuario = false) {
    const container = document.getElementById('tabla-ingredientes-body');
    if (!container) return;

    container.innerHTML = '';

    if (!ingredientes || ingredientes.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:2rem; color:#6c757d;">No hay ingredientes disponibles</div>';
        return;
    }

    const fragment = document.createDocumentFragment();

    if (esVistaUsuario) {
        const groupContent = document.createElement('div');
        groupContent.className = 'sector-group-content';

        ingredientes.forEach(ingrediente => {
            const ingredienteIdReal = ingrediente.ingrediente_id || ingrediente.id;
            const mixButtons = ingrediente.tipo_origen === 'Mix' && window.mostrarModalFormula 
                ? \`<button class="btn-tarjeta primary" onclick="mostrarModalFormula(\${ingredienteIdReal})">📋 Fórmula</button>\` 
                : '';
                
            const card = document.createElement('div');
            card.className = \`tarjeta-ingrediente \${(ingrediente.stock_total <= 0) ? 'con-stock-cero' : ''}\`;
            
            card.innerHTML = \`
            <div class="tarjeta-cuerpo">
                <div class="tarjeta-header">
                    <span class="tarjeta-codigo">\${ingrediente.codigo || '-'}</span>
                </div>
                <h3 class="tarjeta-titulo">\${ingrediente.nombre_ingrediente || ingrediente.nombre}</h3>
                \${ingrediente.descripcion ? \`<p class="tarjeta-descripcion">\${ingrediente.descripcion}</p>\` : ''}
                
                <div class="tarjeta-stats">
                    <div class="stat-item \${parseFloat(ingrediente.stock_total) <= 0 ? 'stock-cero' : ''}">
                        <span class="stat-label">STOCK ASIGNADO</span>
                        <span class="stat-value">\${window.formatearStock ? window.formatearStock(ingrediente.stock_total) : parseFloat(ingrediente.stock_total).toFixed(3)} <small>\${ingrediente.unidad_medida}</small></span>
                    </div>
                </div>
            </div>
            
            <div class="tarjeta-footer">
                \${mixButtons}
                <button class="btn-tarjeta action" onclick="window.abrirModalAjusteDesdeTabla(\${ingredienteIdReal}, '\${(ingrediente.nombre_ingrediente || ingrediente.nombre).replace(/'/g, "\\\\'")}', \${ingrediente.stock_total}, \${ingredienteIdReal})" title="Ajustar Stock Manualmente">✏️ Ajustar</button>
                <button class="btn-tarjeta" style="background:#fef2f2; color:#b91c1c;" onclick="window.iniciarTrasladoIngrediente('\${ingredienteIdReal}', '\${(ingrediente.nombre_ingrediente || ingrediente.nombre).replace(/'/g, "\\\\'")}')" title="Enviar a Cuarentena">🏥 Mover</button>
            </div>\`;
            groupContent.appendChild(card);
        });
        fragment.appendChild(groupContent);
    } else {
        // Vista de depósito: Agrupar por sector
        const grupos = {};
        
        ingredientes.forEach(ingrediente => {
            const nombreSector = ingrediente.sector_nombre || 'Sin asignar';
            if (!grupos[nombreSector]) {
                grupos[nombreSector] = [];
            }
            grupos[nombreSector].push(ingrediente);
        });

        const gruposArray = Object.entries(grupos).map(([nombreSector, items]) => {
            const letraBackend = items[0] && items[0].sector_letra ? items[0].sector_letra : '';
            return { nombreSector, items, sector_letra: letraBackend };
        });
        
        // Ordenar estrictamente por el nombre del sector (SIN LETRAS INVENTADAS)
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
                displayIzquierda = nombreSector;
                displayCentro = ""; 
            }

            groupHeader.innerHTML = \`
                <div class="sector-header-flex" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div class="header-izq" style="font-size: 1.5rem; font-weight: 800; color: #2c3e50; min-width: 120px;">
                        \${displayIzquierda}
                    </div>
                    <div class="header-centro" style="font-size: 1.3rem; font-weight: 600; color: #475569; text-align: center; flex: 1;">
                        \${displayCentro}
                    </div>
                    <div class="header-der" style="min-width: 120px; text-align: right;">
                        <button class="btn-imprimir-cartel" onclick="if(window.imprimirCartelSector) window.imprimirCartelSector('\${isLetter ? sector_letra : ''}', '\${nombreLimpio}')">
                            🖨️ Cartel A4
                        </button>
                    </div>
                </div>\`;

            fragment.appendChild(groupHeader);

            const groupContent = document.createElement('div');
            groupContent.className = 'sector-group-content';
            
            items.forEach(ingrediente => {
                const ingredienteIdReal = ingrediente.ingrediente_id || ingrediente.id;
                
                const card = document.createElement('div');
                card.className = \`tarjeta-ingrediente \${(ingrediente.stock_actual <= 0 && ingrediente.stock_potencial <= 0) ? 'con-stock-cero' : ''}\`;
                
                card.innerHTML = \`
                <div class="tarjeta-cuerpo">
                    <div class="tarjeta-header">
                        <span class="tarjeta-codigo">\${ingrediente.codigo || '-'}</span>
                    </div>
                    <h3 class="tarjeta-titulo">\${ingrediente.nombre_ingrediente || ingrediente.nombre}</h3>
                    \${ingrediente.descripcion ? \`<p class="tarjeta-descripcion">\${ingrediente.descripcion}</p>\` : ''}
                    
                    <div class="tarjeta-stats">
                        <div class="stat-item \${ingrediente.stock_actual <= 0 ? 'stock-cero' : ''}">
                            <span class="stat-label">STOCK FÍSICO</span>
                            <span class="stat-value">\${window.formatearStock ? window.formatearStock(ingrediente.stock_actual) : ingrediente.stock_actual} <small>\${ingrediente.unidad_medida}</small></span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">STOCK POTENCIAL</span>
                            <span class="stat-value">\${window.formatearStock ? window.formatearStock(ingrediente.stock_potencial) : ingrediente.stock_potencial} <small>\${ingrediente.unidad_medida}</small></span>
                        </div>
                    </div>
                </div>
                
                <div class="tarjeta-footer">
                    <button class="btn-tarjeta primary" onclick="if(window.mostrarModalFormula) mostrarModalFormula(\${ingredienteIdReal})">📋 Fórmula</button>
                    <button class="btn-tarjeta-sector" onclick="if(window.abrirModalSector) abrirModalSector(\${ingredienteIdReal}, \${ingrediente.sector_id || 'null'})" title="Cambiar Sector">📍 Sec. \${isLetter ? sector_letra : 'Asg'}</button>
                    <button class="btn-tarjeta action" onclick="if(window.abrirModalImpresionGeneral) abrirModalImpresionGeneral(\${ingredienteIdReal}, '\${(ingrediente.nombre_ingrediente || ingrediente.nombre).replace(/'/g, "\\\\'")}')">🖨️ Etiquetas</button>
                    <button class="btn-tarjeta adjust" onclick="if(window.abrirModalAjusteManual) abrirModalAjusteManual(\${ingredienteIdReal}, '\${(ingrediente.nombre_ingrediente || ingrediente.nombre).replace(/'/g, "\\\\'")}', \${ingrediente.stock_total || ingrediente.stock_actual}, \${ingredienteIdReal})" title="Ajustar Stock Manualmente">✏️ Ajustar</button>
                </div>\`;
                groupContent.appendChild(card);
            });
            fragment.appendChild(groupContent);
        }
    }

    container.appendChild(fragment);
}`;

let start = js.indexOf('function actualizarTablaIngredientes');
let end = js.indexOf('}', js.indexOf('tbody.appendChild(fragment);')) + 1;
if (end === 0) { console.error('End not found'); process.exit(1); }

js = js.substring(0, start) + replacement + js.substring(end);

// Also append window.imprimirCartelSector
const strCartel = `
// ============================================
// FUNCIONES UI DE IMPRESION y RENDERIZADO
// ============================================
window.imprimirCartelSector = function(letra, nombre) {
    let container = document.getElementById('cartel-print-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'cartel-print-container';
        document.body.appendChild(container);
    }
    
    container.style.display = 'none'; // oculto normalmente
    container.innerHTML = \`
        <div class="cartel-letra">\${letra}</div>
        <div class="cartel-nombre">\${nombre}</div>
    \`;
    
    document.body.classList.add('modo-impresion-cartel');
    
    setTimeout(() => {
        window.print();
        setTimeout(() => {
            document.body.classList.remove('modo-impresion-cartel');
        }, 800);
    }, 150);
};

// Hack para abrirModalSector inline
window.abrirModalSector = async function(ingredienteId, sectorActualId) {
    if (typeof sectoresDisponibles === 'undefined' || sectoresDisponibles.length === 0) {
        Swal.fire('Error', 'No hay sectores cargados', 'error');
        return;
    }
    let html = '<select id="swal-sectores" class="swal2-select">';
    html += '<option value="">Sin asignar</option>';
    sectoresDisponibles.forEach(s => {
        let sel = s.id == sectorActualId ? 'selected' : '';
        html += \`<option value="\${s.id}" \${sel}>\${s.nombre}</option>\`;
    });
    html += '</select>';

    const res = await Swal.fire({
        title: 'Reasignar Sector',
        html: html,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        preConfirm: async () => {
            const val = document.getElementById('swal-sectores').value;
            Swal.showLoading();
            try {
                let r = await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${ingredienteId}\`, {
                    method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sector_id: val || null})
                });
                if(!r.ok) throw new Error('Error al guardar sector');
                return true;
            } catch (err) {
                Swal.showValidationMessage(err.message);
                return false;
            }
        }
    });

    if (res.isConfirmed) {
        if(window.actualizarTablaFiltrada) await window.actualizarTablaFiltrada();
    }
};

`;
if (!js.includes('window.imprimirCartelSector')) {
    js += strCartel;
}

fs.writeFileSync(FILE_PATH, js, 'utf8');
console.log('Script injection complete.');
