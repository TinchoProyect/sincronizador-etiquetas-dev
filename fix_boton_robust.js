const fs = require('fs');
const path = require('path');

console.log(' INICIANDO REPARACIÓN ROBUSTA DEL FRONTEND...');

const frontendPath = path.join('src', 'produccion', 'js', 'ingredientes.js');

try {
    if (!fs.existsSync(frontendPath)) {
        throw new Error(`El archivo no existe en: ${frontendPath}`);
    }

    let content = fs.readFileSync(frontendPath, 'utf8');
    let modificado = false;

    // 1. INYECTAR FUNCIÓN GLOBAL (Si no está)
    if (!content.includes('window.abrirModalAjusteDesdeTabla')) {
        console.log(' Agregando función global al final del archivo...');
        const funcionGlobal = `
// ==========================================
// FUNCIÓN GLOBAL: ABRIR MODAL DE AJUSTE (INYECTADA)
// ==========================================
window.abrirModalAjusteDesdeTabla = async function(ingredienteId, nombreIngrediente, stockActual) {
    console.log(' Solicitando ajuste para:', nombreIngrediente);
    
    const selectorUsuario = document.getElementById('filtro-usuario');
    if (!selectorUsuario || !selectorUsuario.value || selectorUsuario.value === 'todos') {
        alert(' Error: Seleccione un usuario específico primero.');
        return;
    }
    const usuarioId = parseInt(selectorUsuario.value);

    if (typeof window.abrirModalAjusteRapido === 'function') {
        // flag esStockUsuario = true
        window.abrirModalAjusteRapido(ingredienteId, nombreIngrediente, stockActual, true, usuarioId);
        
        setTimeout(() => {
            const btnConfirm = document.getElementById('btn-confirmar-ajuste');
            if(btnConfirm) {
                const newBtn = btnConfirm.cloneNode(true);
                btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);
                newBtn.addEventListener('click', () => {
                    console.log(' Recargando tabla...');
                    setTimeout(() => cargarIngredientes(usuarioId), 1000);
                });
            }
        }, 500);
    } else {
        alert('Error: Módulo de ajustes no cargado.');
    }
};
`;
        content += "\n" + funcionGlobal;
        modificado = true;
    } else {
        console.log('ℹ La función global ya existe.');
    }

    // 2. REEMPLAZAR CELDA "SOLO LECTURA" CON REGEX (Indestructible)
    // Busca: <td>...<span>...Solo lectura...</span>...</td> ignorando espacios y comillas
    const regexSoloLectura = /<td[^>]*>\s*<span[^>]*>\s*Solo lectura\s*<\/span>\s*<\/td>/i;

    if (regexSoloLectura.test(content)) {
        console.log(' Celda "Solo lectura" ENCONTRADA. Reemplazando...');
        
        const celdaBoton = `
                <td style="text-align: center;">
                    <button class="btn-icon" 
                            onclick="window.abrirModalAjusteDesdeTabla(\${ingrediente.id}, '\${ingrediente.nombre_ingrediente.replace(/'/g, "\\\\'")}', \${ingrediente.stock_total})"
                            title="Ajustar Stock"
                            style="cursor:pointer; background:none; border:none; font-size:1.4em; transition: transform 0.2s;">
                        
                    </button>
                </td>`;
        
        content = content.replace(regexSoloLectura, celdaBoton);
        modificado = true;
    } else {
        console.warn(' NO se encontró la celda "Solo lectura" con Regex. Verificá si ya se cambió.');
        // Debug: mostrar un pedacito donde debería estar
        const indexVista = content.indexOf('esVistaUsuario');
        if (indexVista !== -1) {
            console.log('CONTEXTO CERCANO (esVistaUsuario):');
            console.log(content.substring(indexVista, indexVista + 400));
        }
    }

    // 3. GUARDAR CAMBIOS
    if (modificado) {
        fs.writeFileSync(frontendPath, content, 'utf8');
        console.log(` ARCHIVO SOBRESCRITO CORRECTAMENTE: ${frontendPath}`);
        console.log('--- ÚLTIMAS 5 LÍNEAS DEL ARCHIVO ---');
        console.log(content.slice(-200));
    } else {
        console.log(' No se realizaron cambios (el archivo ya estaba actualizado).');
    }

} catch (e) {
    console.error(` Error fatal: ${e.message}`);
}
