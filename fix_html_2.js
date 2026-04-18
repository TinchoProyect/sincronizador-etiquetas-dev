const fs = require('fs');
const FILE_PATH = 'src/produccion/pages/ingredientes.html';
let content = fs.readFileSync(FILE_PATH, 'utf8');

const anchorStart = `// Función para renderizar tabla de usuario
        function renderizarTablaUsuario(stockUsuario) {`;
const anchorEnd = `                tbody.appendChild(row);
            });
        }`;

const idxStart = content.indexOf(anchorStart);
const idxEnd = content.indexOf(anchorEnd, idxStart) + anchorEnd.length;

if(idxStart !== -1 && idxEnd !== -1) {
    const newFunc = `// Función para renderizar tarjetas de usuario
        function renderizarTablaUsuario(stockUsuario) {
            const container = document.getElementById('tarjetas-ingredientes-container');
            if (!container) return;

            container.innerHTML = '';

            if (!stockUsuario || stockUsuario.length === 0) {
                container.innerHTML = '<div class="mensaje-vacio">Este usuario no tiene stock de ingredientes</div>';
                return;
            }

            // Agrupar visualmente todas las tarjetas juntas
            const groupHeader = document.createElement('div');
            groupHeader.className = 'sector-group-header';
            groupHeader.innerHTML = '<h3>Stock Personal</h3>';
            container.appendChild(groupHeader);

            const groupContainer = document.createElement('div');
            groupContainer.className = 'sector-group-content';

            stockUsuario.forEach(item => {
                let tipoOrigen = 'Simple';
                if (item.origen_mix_id !== null && item.origen_mix_id !== undefined) {
                    tipoOrigen = 'Sobrante de Mix';
                }

                const ingredienteId = item.ingrediente_id || item.id;
                const card = document.createElement('div');
                card.className = 'tarjeta-ingrediente';
                
                card.innerHTML = \`
                    <div class="tarjeta-main">
                        <div class="tarjeta-info-principal">
                            <h4 class="tarjeta-titulo">\${item.nombre_ingrediente}</h4>
                            <div class="tarjeta-badges">
                                <span class="badge-sutil">\${item.categoria || '-'}</span>
                                <span class="badge-sutil">\${tipoOrigen}</span>
                            </div>
                        </div>
                        <div class="tarjeta-stock">
                            <span class="stock-valor">\${parseFloat(item.stock_total).toFixed(3)}</span>
                            <span class="stock-unidad">\${item.unidad_medida || '-'}</span>
                        </div>
                    </div>
                    
                    <div class="tarjeta-acciones-secundarias">
                        <button class="btn-accion-icono" onclick="window.abrirModalAjusteDesdeTabla(null, '\${item.nombre_ingrediente.replace(/'/g, "\\\\'")}', \${item.stock_total}, \${ingredienteId})" title="Ajuste Rápido">✏️</button>
                    </div>
                \`;

                groupContainer.appendChild(card);
            });
            container.appendChild(groupContainer);
        }`;

    content = content.substring(0, idxStart) + newFunc + content.substring(idxEnd);
    fs.writeFileSync(FILE_PATH, content, 'utf8');
    console.log('Replaced renderizarTablaUsuario successfully!');
} else {
    console.log('Function not found in HTML!');
}
