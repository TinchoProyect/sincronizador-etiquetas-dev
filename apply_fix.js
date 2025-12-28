const fs = require('fs');
const path = require('path');

console.log('🔧 Aplicando fix a ingredientes.js...');

const filePath = path.join(__dirname, 'src/produccion/js/ingredientes.js');
let content = fs.readFileSync(filePath, 'utf8');

// Buscar el inicio de la función
const functionStart = content.indexOf('window.abrirModalAjusteDesdeTabla = async function');

if (functionStart === -1) {
    console.error('❌ No se encontró la función window.abrirModalAjusteDesdeTabla');
    process.exit(1);
}

// Buscar el final de la función (contar llaves)
let braceCount = 0;
let inFunction = false;
let functionEnd = -1;

for (let i = functionStart; i < content.length; i++) {
    if (content[i] === '{') {
        braceCount++;
        inFunction = true;
    } else if (content[i] === '}') {
        braceCount--;
        if (inFunction && braceCount === 0) {
            // Buscar el punto y coma después de la llave
            if (content[i + 1] === ';') {
                functionEnd = i + 2;
            } else {
                functionEnd = i + 1;
            }
            break;
        }
    }
}

if (functionEnd === -1) {
    console.error('❌ No se pudo encontrar el final de la función');
    process.exit(1);
}

// Nueva función
const newFunction = `window.abrirModalAjusteDesdeTabla = async function(ingredienteId, nombreIngrediente, stockActual) {
    console.log('[AJUSTE-JS] Solicitando ajuste para:', nombreIngrediente);
    console.log('[AJUSTE-JS] Vista actual:', vistaActual);
    
    let usuarioId = null;
    
    if (vistaActual.startsWith('usuario-')) {
        usuarioId = parseInt(vistaActual.replace('usuario-', ''));
        console.log('[AJUSTE-JS] Usuario detectado desde vistaActual:', usuarioId);
    } else {
        const sectorActivo = document.querySelector('.sector-item.activo[data-usuario-id]');
        if (sectorActivo) {
            usuarioId = parseInt(sectorActivo.dataset.usuarioId);
            console.log('[AJUSTE-JS] Usuario detectado desde DOM:', usuarioId);
        }
    }
    
    if (!usuarioId) {
        alert('Error: No se pudo detectar el usuario activo.');
        return;
    }

    let selectorFiltro = document.getElementById('filtro-usuario');
    if (!selectorFiltro) {
        selectorFiltro = document.createElement('select');
        selectorFiltro.id = 'filtro-usuario';
        selectorFiltro.style.display = 'none';
        document.body.appendChild(selectorFiltro);
        console.log('[AJUSTE-JS] Selector filtro-usuario creado');
    }
    selectorFiltro.value = usuarioId;

    if (typeof window.abrirModalAjusteRapido === 'function') {
        console.log('[AJUSTE-JS] Llamando a abrirModalAjusteRapido...');
        window.abrirModalAjusteRapido(ingredienteId, nombreIngrediente, stockActual, null);
        
        const actualizarOriginal = window.actualizarResumenIngredientes;
        window.actualizarResumenIngredientes = async function() {
            console.log('[AJUSTE-JS] Recargando tabla despues del ajuste...');
            await cargarIngredientes(usuarioId);
            window.actualizarResumenIngredientes = actualizarOriginal;
        };
    } else {
        console.error('window.abrirModalAjusteRapido no esta definida.');
        alert('Error: El modulo de ajustes no esta cargado correctamente. Recarga la pagina con Ctrl+F5.');
    }
};`;

// Reemplazar
const before = content.substring(0, functionStart);
const after = content.substring(functionEnd);
const newContent = before + newFunction + after;

// Guardar
fs.writeFileSync(filePath, newContent, 'utf8');

console.log('✅ Fix aplicado exitosamente!');
console.log('📍 Archivo modificado:', filePath);
console.log('🔄 Reinicia el servidor con: npm start');
