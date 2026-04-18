const fs = require('fs');
const FILE_PATH = 'src/produccion/pages/ingredientes.html';
let content = fs.readFileSync(FILE_PATH, 'utf8');

// 1. Refactor Title
content = content.replace('<h1>Gestión de Ingredientes</h1>', '<h1>Lista de ingredientes LAMDA</h1>');

// 2. Refactor limpiarFiltros to just hide instead of destroy
const oldLimpiar = `function limpiarFiltros() {
            const containers = [
                'filtros-categorias-container',
                'filtros-tipo-container',
                'filtros-stock-container',
                'filtros-sectores-container'
            ];

            containers.forEach(containerId => {
                const container = document.getElementById(containerId);
                if (container) {
                    container.innerHTML = '<p class="text-muted">Los filtros no están disponibles en la vista de usuario</p>';
                }
            });
        }`;

const newLimpiar = `function limpiarFiltros() {
            // Ya no destruimos el DOM, simplemente ocultamos los filtros en la vista de usuario y limpiamos su estado
            if(window.filtrosActivos) window.filtrosActivos.clear();
            if(window.filtrosTipoActivos) window.filtrosTipoActivos.clear();
            if(window.filtrosStockActivos) window.filtrosStockActivos.clear();
            if(window.filtrosSectorActivos) window.filtrosSectorActivos.clear();
            
            // Ocultamos todos los acordeones de filtro para que no se use durante vista Matias
            document.querySelectorAll('.config-accordion:not(:first-child)').forEach(acc => {
                acc.style.display = 'none';
            });
            
            // Ocultar busqueda
            const searchContainer = document.querySelector('.filtro-nombre-container');
            if(searchContainer) searchContainer.style.display = 'none';
        }`;

if(content.includes(oldLimpiar)) {
    content = content.replace(oldLimpiar, newLimpiar);
} else {
    // try softer match
    const regexLimpiar = /function limpiarFiltros\([^)]*\)\s*\{[\s\S]*?\}\s*\}\);?\s*\}/;
    const match = content.match(regexLimpiar);
    if(match) {
        content = content.replace(match[0], newLimpiar);
    } else {
        console.log("No se pudo reemplazar limpiarFiltros");
    }
}

// 3. Restaurar visibility del sidebar en vista depósito
const oldActivarTabDeposito = `async function activarTabDeposito() {

            tabActiva = 'deposito';`;

const newActivarTabDeposito = `async function activarTabDeposito() {

            tabActiva = 'deposito';
            
            // Mostrar todos los acordeones
            document.querySelectorAll('.config-accordion').forEach(acc => {
                acc.style.display = '';
            });
            
            // Mostrar busqueda
            const searchContainer = document.querySelector('.filtro-nombre-container');
            if(searchContainer) searchContainer.style.display = '';`;

if (content.includes(oldActivarTabDeposito)) {
    content = content.replace(oldActivarTabDeposito, newActivarTabDeposito);
} else {
    console.log("No se pudo reemplazar activarTabDeposito");
}

fs.writeFileSync(FILE_PATH, content, 'utf8');
console.log('Ingredientes.html modificado correctamente.');
