const fs = require('fs');
const FILE_PATH = 'src/produccion/js/ingredientes.js';
let content = fs.readFileSync(FILE_PATH, 'utf8');

const regex = /async function actualizarTablaIngredientes\([^)]*\)\s*\{[\s\S]*?tbody\.appendChild\(fragment\);\s*\n\}/m;
const match = content.match(regex);

if(match) {
    const newFunc = `async function actualizarTablaIngredientes(ingredientes, esVistaUsuario = false) {
    const container = document.getElementById('tarjetas-ingredientes-container');
    if (!container) return;

    container.innerHTML = '';

    if (!ingredientes || ingredientes.length === 0) {
        container.innerHTML = '<div class="mensaje-vacio">No hay ingredientes disponibles</div>';
        return;
    }

    const fragment = document.createDocumentFragment();

    // Si es vista de usuario, simplemente creamos un solo grupo
    if (esVistaUsuario) {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'sector-group-header';
        groupHeader.innerHTML = '<h3>Stock Personal</h3> <div class="sector-divider"></div>';
        fragment.appendChild(groupHeader);

        const groupContent = document.createElement('div');
        groupContent.className = 'sector-group-content';

        ingredientes.forEach(ingrediente => {
            const ingredienteIdReal = ingrediente.ingrediente_id || ingrediente.id;
            const card = document.createElement('div');
            card.className = 'tarjeta-ingrediente';
            
            card.innerHTML = \`<div class="tarjeta-main">
                <div class="tarjeta-info-principal">
                    <h4 class="tarjeta-titulo">\${ingrediente.nombre_ingrediente || ingrediente.nombre}</h4>
                    <div class="tarjeta-badges">
                        <span class="badge-sutil">\${ingrediente.categoria || '-'}</span>
                        <span class="badge-sutil">\${ingrediente.tipo_origen || 'Simple'}</span>
                    </div>
                </div>
                <div class="tarjeta-stock">
                    <span class="stock-valor">\${parseFloat(ingrediente.stock_total || ingrediente.stock_actual).toFixed(3)}</span>
                    <span class="stock-unidad">\${ingrediente.unidad_medida || '-'}</span>
                </div>
            </div>
            
            <div class="tarjeta-acciones-inferior">
                <button class="btn-accion-icono btn-imprimir-rapido text-imprimir" onclick="window.iniciarImpresionRapida(\${ingredienteIdReal}, '\${(ingrediente.nombre_ingrediente || ingrediente.nombre).replace(/'/g, "\\\\'")}', '\${ingrediente.codigo || ''}', '\${ingrediente.sector_id || ''}')" title="Imprimir Etiquetas">🖨️ Imprimir</button>
                <button class="btn-accion-icono text-ajuste" onclick="window.abrirModalAjusteDesdeTabla(\${ingredienteIdReal}, '\${(ingrediente.nombre_ingrediente || ingrediente.nombre).replace(/'/g, "\\\\'")}', \${ingrediente.stock_total || ingrediente.stock_actual}, \${ingredienteIdReal})" title="Ajustar Stock Manualmente">✏️ Ajustar</button>
            </div>\`;
            groupContent.appendChild(card);
        });
        fragment.appendChild(groupContent);
    } else {
        // Vista de depósito: Agrupar por sector
        const grupos = {};
        
        // Función de resguardo si no está exponiendo globalmente
        const getLetraSectorLocal = window.obtenerLetraSector || function(sectorId) { return ''; };

        ingredientes.forEach(ingrediente => {
            const nombreSector = ingrediente.sector_nombre || 'Sin asignar';
            if (!grupos[nombreSector]) {
                grupos[nombreSector] = [];
            }
            grupos[nombreSector].push(ingrediente);
        });

        for (const [nombreSector, items] of Object.entries(grupos)) {
            const groupHeader = document.createElement('div');
            groupHeader.className = 'sector-group-header';
            
            // Intentar extraer la letra del sector globalmente (ej: L, K) si es posible
            // Solo para darle un estilo especial. Si no hay Letra, se pone el nombre normal.
            let titulo = nombreSector;
            if (items[0] && items[0].sector_id && window.obtenerLetraSector) {
                const letra = window.obtenerLetraSector(items[0].sector_id);
                if (letra) titulo = "Sector " + letra;
            }

            groupHeader.innerHTML = \`<h3>\${titulo}</h3> <div class="sector-divider"></div>\`;
            fragment.appendChild(groupHeader);

            const groupContent = document.createElement('div');
            groupContent.className = 'sector-group-content';

            items.forEach(ingrediente => {
                const stockPotencial = parseFloat(ingrediente.stock_potencial) || parseFloat(ingrediente.stock_actual) || 0;
                
                const card = document.createElement('div');
                card.className = 'tarjeta-ingrediente';
                card.dataset.id = ingrediente.id;

                // Definimos botonera dinamica dependiendo del rol/mix
                let mixButtons = '';
                if (ingrediente.esMix) {
                    mixButtons = \`
                        <button class="btn-accion-icono text-mix" onclick="gestionarComposicionMix(\${ingrediente.id})" title="Gestionar Composición">🔄 Comp</button>
                    \`;
                } else if (!ingrediente.padre_id) {
                    mixButtons = \`
                        <button class="btn-accion-icono text-mix" onclick="gestionarComposicionMix(\${ingrediente.id})" title="Crear Composición">➕ Mix</button>
                    \`;
                }

                card.innerHTML = \`
                    <div class="tarjeta-main">
                        <div class="tarjeta-info-principal">
                            <h4 class="tarjeta-titulo">\${ingrediente.nombre}</h4>
                            <div class="tarjeta-badges">
                                <span class="badge-sutil">\${ingrediente.categoria || 'Sin Categoría'}</span>
                                <span class="badge-sutil \${ingrediente.esMix ? 'badge-warning' : ''}">\${ingrediente.esMix ? 'Mix' : 'Simple'}</span>
                            </div>
                        </div>
                        <div class="tarjeta-stock">
                            <span class="stock-valor">\${window.formatearStock ? window.formatearStock(ingrediente.stock_actual) : parseFloat(ingrediente.stock_actual).toFixed(3)}</span>
                            <span class="stock-unidad">\${ingrediente.unidad_medida || '-'}</span>
                            <span class="stock-potencial-texto" title="Stock Potencial">Max: \${window.formatearStock ? window.formatearStock(stockPotencial) : parseFloat(stockPotencial).toFixed(3)}</span>
                        </div>
                    </div>
                    
                    <div class="tarjeta-acciones-inferior">
                        <div class="acciones-grupo">
                            <button class="btn-accion-icono btn-imprimir-rapido text-imprimir" onclick="window.iniciarImpresionRapida(\${ingrediente.id}, '\${ingrediente.nombre.replace(/'/g, "\\\\'")}', '\${ingrediente.codigo || ''}', '\${ingrediente.sector_id || ''}')" title="Imprimir Etiquetas">🖨️ Imprimir</button>
                            <button class="btn-accion-icono text-ajuste" onclick="editarIngrediente(\${ingrediente.id})" title="Editar Detalles">✏️ Edit</button>
                            <button class="btn-accion-icono text-eliminar" onclick="eliminarIngrediente(\${ingrediente.id})" title="Eliminar">🗑️</button>
                            \${mixButtons}
                        </div>
                        <div class="acciones-grupo sector-cell-container">
                            <!-- El selector de sector irá aquí -->
                        </div>
                    </div>
                \`;

                // Inyectamos el selector dinámico originario
                const containerSelector = card.querySelector('.sector-cell-container');
                const selectorInline = window.crearSelectorSectorInline ? window.crearSelectorSectorInline(ingrediente.id, ingrediente.sector_id, nombreSector) : null;
                
                if (selectorInline) {
                    selectorInline.className = 'tarjeta-sector-selector';
                    containerSelector.appendChild(selectorInline);
                }

                groupContent.appendChild(card);
            });

            fragment.appendChild(groupContent);
        }
    }

    container.appendChild(fragment);
}`;

    content = content.replace(match[0], newFunc);
    fs.writeFileSync(FILE_PATH, content, 'utf8');
    console.log('Replaced actualizarTablaIngredientes in JS successfully!');
} else {
    console.log('Function not found in JS!');
}
