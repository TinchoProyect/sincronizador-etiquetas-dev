const fs = require('fs');
const path = require('path');

console.log(' OPERANDO EL PACIENTE CORRECTO: HTML EMBEBIDO...');

const htmlPath = path.join('src', 'produccion', 'pages', 'ingredientes.html');

try {
    let content = fs.readFileSync(htmlPath, 'utf8');

    // 1. REEMPLAZO DE LA CELDA "SOLO LECTURA"
    // Buscamos el patrón exacto que vimos en tu archivo subido
    const patronViejo = '<td><span style="color: #6c757d; font-style: italic;">Solo lectura</span></td>';
    
    // Nueva celda con el botón. 
    // Usamos item.stock_total porque así se llama en la función renderizarTablaUsuario del HTML
    const patronNuevo = `
                    <td style="text-align: center;">
                        <button class="btn-icon" 
                                onclick="window.abrirModalAjusteDesdeTabla(null, '\${item.nombre_ingrediente.replace(/'/g, "\\\\'")}', \${item.stock_total}, \${item.ingrediente_id || item.id})"
                                title="Ajuste Rápido"
                                style="cursor:pointer; background:none; border:none; font-size:1.2em;">
                            
                        </button>
                    </td>`;

    if (content.includes('Solo lectura')) {
        content = content.replace(patronViejo, patronNuevo);
        console.log(' Celda "Solo lectura" reemplazada por Botón en el HTML.');
    } else {
        console.warn(' No encontré "Solo lectura". Verificando si ya se aplicó...');
        if (content.includes('onclick="window.abrirModalAjusteDesdeTabla')) {
            console.log('ℹ El botón ya parece estar presente.');
        } else {
            console.error(' No encuentro ni el texto viejo ni el nuevo. El archivo puede haber cambiado.');
        }
    }

    // 2. INYECTAR LA FUNCIÓN BRIDGE (PUENTE)
    // El botón llama a window.abrirModalAjusteDesdeTabla. Necesitamos definirla en el script del HTML.
    // La insertamos antes de renderizarTablaUsuario para que esté disponible.
    
    if (!content.includes('window.abrirModalAjusteDesdeTabla =')) {
        const funcionPuente = `
        // --- FUNCIÓN PUENTE PARA EL MODAL DE AJUSTE ---
        window.abrirModalAjusteDesdeTabla = function(dummy, nombre, stock, idReal) {
            console.log(' Click en ajuste:', nombre, stock, idReal);
            
            // Buscar el ID de usuario activo desde el DOM (clase .activo)
            const itemActivo = document.querySelector('.sector-item.activo');
            const usuarioId = itemActivo ? itemActivo.dataset.usuarioId : null;

            if (!usuarioId) {
                alert('Error: No se detectó el usuario activo.');
                return;
            }

            // Intentar usar la función del módulo externo si está disponible
            if (typeof window.abrirModalAjusteRapido === 'function') {
                window.abrirModalAjusteRapido(idReal, nombre, stock, true, usuarioId);
                
                // Recarga automática al confirmar
                setTimeout(() => {
                    const btn = document.getElementById('btn-confirmar-ajuste');
                    if (btn) {
                        // Clonamos para evitar listeners duplicados
                        const newBtn = btn.cloneNode(true);
                        btn.parentNode.replaceChild(newBtn, btn);
                        
                        newBtn.addEventListener('click', () => {
                            console.log(' Recargando vista de usuario...');
                            setTimeout(() => cargarStockUsuario(usuarioId), 500); 
                        });
                    }
                }, 500);
            } else {
                console.error('Falta ajusteRapido.js');
                alert('El módulo de ajustes no está cargado. Recarga la página con Ctrl+F5.');
            }
        };
        `;
        
        // Insertamos antes de la función renderizarTablaUsuario
        content = content.replace('function renderizarTablaUsuario(stockUsuario) {', funcionPuente + '\n\n        function renderizarTablaUsuario(stockUsuario) {');
        console.log(' Función puente inyectada en el HTML.');
    }

    fs.writeFileSync(htmlPath, content, 'utf8');
    console.log(' HTML ACTUALIZADO. REINICIA EL SERVIDOR.');

} catch (e) {
    console.error(` Error: ${e.message}`);
}
