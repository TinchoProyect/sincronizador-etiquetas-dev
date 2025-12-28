const fs = require('fs');
const path = require('path');

console.log(' INICIANDO INYECCIÓN DEL BOTÓN DE AJUSTE...');

const frontendPath = path.join('src', 'produccion', 'js', 'ingredientes.js');

try {
    let content = fs.readFileSync(frontendPath, 'utf8');

    // 1. AGREGAR LA FUNCIÓN GLOBAL (Si no existe)
    // -------------------------------------------------
    if (!content.includes('window.abrirModalAjusteDesdeTabla')) {
        const funcionGlobal = `
// ==========================================
// FUNCIÓN GLOBAL: ABRIR MODAL DE AJUSTE (INYECTADA)
// ==========================================
window.abrirModalAjusteDesdeTabla = async function(ingredienteId, nombreIngrediente, stockActual) {
    console.log(' Solicitando ajuste para:', nombreIngrediente);
    
    // Obtener usuario del filtro (el select del header)
    const selectorUsuario = document.getElementById('filtro-usuario');
    if (!selectorUsuario || !selectorUsuario.value || selectorUsuario.value === 'todos') {
        alert(' Error: Seleccione un usuario específico primero.');
        return;
    }
    const usuarioId = parseInt(selectorUsuario.value);

    // Verificar si ajusteRapido.js cargó la función maestra
    if (typeof window.abrirModalAjusteRapido === 'function') {
        // LLAMADA CLAVE: flag esStockUsuario = true
        window.abrirModalAjusteRapido(ingredienteId, nombreIngrediente, stockActual, true, usuarioId);
        
        // Listener temporal para recargar la tabla al confirmar el ajuste
        // Esperamos a que el modal se abra y el botón exista
        setTimeout(() => {
            const btnConfirm = document.getElementById('btn-confirmar-ajuste');
            if(btnConfirm) {
                // Clonamos para limpiar listeners previos
                const newBtn = btnConfirm.cloneNode(true);
                btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);
                
                newBtn.addEventListener('click', () => {
                    console.log(' Recargando tabla tras ajuste...');
                    // Damos tiempo al backend para procesar
                    setTimeout(() => cargarIngredientes(usuarioId), 1000);
                });
            }
        }, 500);
    } else {
        console.error(' window.abrirModalAjusteRapido no está definida.');
        alert('Error: El módulo de ajustes no está cargado correctamente.');
    }
};
`;
        // Insertamos antes de la última llave o al final
        content += funcionGlobal;
        console.log(' Función global window.abrirModalAjusteDesdeTabla agregada.');
    }

    // 2. REEMPLAZAR LA CELDA "SOLO LECTURA" POR EL BOTÓN
    // -------------------------------------------------
    // Texto exacto encontrado en tu archivo:
    const celdaSoloLectura = '<td><span style="color: #6c757d; font-style: italic;">Solo lectura</span></td>';
    
    // Nuevo código para la celda con el botón
    // Usamos backticks escapados (\`) para que sea válido dentro del template string existente
    const celdaBoton = `
                <td style="text-align: center;">
                    <button class="btn-icon" 
                            onclick="window.abrirModalAjusteDesdeTabla(\${ingrediente.id}, '\${ingrediente.nombre_ingrediente.replace(/'/g, "\\\\'")}', \${ingrediente.stock_total})"
                            title="Ajustar Stock Manualmente"
                            style="cursor:pointer; background:none; border:none; font-size:1.4em; transition: transform 0.2s;">
                        
                    </button>
                </td>`;

    if (content.includes('Solo lectura')) {
        // Reemplazo usando replace de string para mayor seguridad
        // Nota: Como el archivo usa backticks, necesitamos insertar esto con cuidado.
        // Reemplazamos la línea completa del TD.
        
        content = content.replace(celdaSoloLectura, celdaBoton);
        console.log(' Celda "Solo lectura" reemplazada por Botón de Ajuste .');
        
        fs.writeFileSync(frontendPath, content, 'utf8');
        console.log(' ARCHIVO GUARDADO CORRECTAMENTE.');
    } else {
        console.warn(' No encontré el texto "Solo lectura". ¿Quizás ya se aplicó el parche?');
    }

} catch (e) {
    console.error(` Error fatal: ${e.message}`);
}
