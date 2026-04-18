const fs = require('fs');
const FILE_PATH = 'src/produccion/js/ingredientes.js';
let content = fs.readFileSync(FILE_PATH, 'utf8');

// 1. Fix obtenerLetraSector fallback
const regexLetra = /return extraerLetra\(sectorObj\.descripcion,\s*sectorObj\.nombre\)\s*\|\|\s*sectorObj\.nombre;/;
content = content.replace(regexLetra, `return extraerLetra(sectorObj.descripcion, sectorObj.nombre) || (sectorObj.nombre ? sectorObj.nombre.charAt(0).toUpperCase() : '');`);

// 2. Add localStorage persistence
// Replace function guardarEstadoFiltros()
const regexGuardar = /function guardarEstadoFiltros\([^)]*\)\s*\{[\s\S]*?sectores:\s*new Set\(filtrosSectorActivos\)\s*\};?\s*\}/;
const newGuardar = `function guardarEstadoFiltros() {
    estadoFiltrosGuardado = {
        categorias: new Set(filtrosActivos),
        tipos: new Set(filtrosTipoActivos),
        stocks: new Set(filtrosStockActivos),
        sectores: new Set(filtrosSectorActivos)
    };
    
    // Serializar Sets para localStorage
    const serializado = {
        categorias: Array.from(filtrosActivos),
        tipos: Array.from(filtrosTipoActivos),
        stocks: Array.from(filtrosStockActivos),
        sectores: Array.from(filtrosSectorActivos)
    };
    localStorage.setItem('lamda_ingredientes_filtros', JSON.stringify(serializado));
}`;
content = content.replace(regexGuardar, newGuardar);

// We should inject localStorage loading inside inicializarFiltros at the top
const regexInitFiltros = /function inicializarFiltros\(ingredientes\)\s*\{[\s\S]*?filtrosSectorActivos\s*=\s*new Set\(\);/;
const newInitFiltros = `function inicializarFiltros(ingredientes) {
    // ✅ INICIALIZAR DESDE CACHÉ (PERSISTENCIA) O VACÍOS
    filtrosActivos = new Set();
    filtrosTipoActivos = new Set();
    filtrosStockActivos = new Set();
    filtrosSectorActivos = new Set();

    try {
        const cache = localStorage.getItem('lamda_ingredientes_filtros');
        if (cache) {
            const parsed = JSON.parse(cache);
            if (parsed.categorias) filtrosActivos = new Set(parsed.categorias);
            if (parsed.tipos) filtrosTipoActivos = new Set(parsed.tipos);
            if (parsed.stocks) filtrosStockActivos = new Set(parsed.stocks);
            if (parsed.sectores) filtrosSectorActivos = new Set(parsed.sectores);
        }
    } catch(e) {
        console.error('Error al restaurar filtros persistentes:', e);
    }`;
content = content.replace(regexInitFiltros, newInitFiltros);
// But wait! When a filter changes, `actualizarTablaFiltrada` isn't calling `guardarEstadoFiltros()`.
// Actually, I can just inject it at the end of `actualizarTablaFiltrada`:
content = content.replace(/await actualizarTablaIngredientes\(ingredientesFiltrados\);/g, `await actualizarTablaIngredientes(ingredientesFiltrados);\n    guardarEstadoFiltros();`);

// And we must call restaurarEstadoVisualFiltros() inside inicializarFiltros after it renders?
// We need to add visual sync AFTER the buttons are attached. It's safer to just call restaurarEstadoVisualFiltros() at the end of inicializarFiltros.
content = content.replace(/\} \/\/ ===== FILTROS POR SECTOR/g, `} // ===== FILTROS POR SECTOR`);
content = content.replace(/sectoresContainer\.appendChild\(btn\);\s*\};\s*\}\s*\}/g, `sectoresContainer.appendChild(btn);
            });
        }
        setTimeout(restaurarEstadoVisualFiltros, 50); // Restore visuals after render
    }
}
`);


// 3. Sorting groups by letter alphabetically
// In actualizarTablaIngredientes, we have:
/*
        for (const [nombreSector, items] of Object.entries(grupos)) {
*/
const regexSortGrupos = /for\s*\(\s*const\s*\[nombreSector,\s*items\]\s*of\s*Object\.entries\(grupos\)\s*\)\s*\{/;
const newSortGrupos = `// Convert and sort groups alphabetically by extracted Letter
        const gruposArray = Object.entries(grupos).map(([n, i]) => {
            const l = (i[0] && i[0].sector_id && window.obtenerLetraSector) ? window.obtenerLetraSector(i[0].sector_id) : n.charAt(0);
            return { nombreSector: n, items: i, letra: l.toUpperCase() };
        });
        gruposArray.sort((a, b) => a.letra.localeCompare(b.letra));

        for (const {nombreSector, items} of gruposArray) {`;
content = content.replace(regexSortGrupos, newSortGrupos);

// 4. Update the Selector Inline appearance and behavior 
// Let's modify crearSelectorSectorInline to be a mini dropdown
const regexCrearSelector = /function crearSelectorSectorInline\(ingredienteId,\s*sectorActualId,\s*sectorActualNombre\)\s*\{[\s\S]*?return select;\s*\n?\}/;

// Wait, crearSelectorSectorInline is defined near the end of ingredientes.js
// We replace its content completely.
const newCrearSelector = `function crearSelectorSectorInline(ingredienteId, sectorActualId, sectorActualNombre) {
    const select = document.createElement('select');
    select.className = 'tarjeta-sector-selector';
    select.dataset.ingredienteId = ingredienteId;
    select.dataset.sectorOriginal = sectorActualId || '';
    select.title = "Cambiar Sector";

    select.style.cssText = \`
        padding: 4px 6px;
        border: none;
        border-radius: 4px;
        background-color: transparent;
        font-size: 0.75rem;
        cursor: pointer;
        transition: all 0.2s ease;
        font-weight: 700;
        color: #5c6bc0;
    \`;

    const optionDefault = document.createElement('option');
    optionDefault.value = '';
    optionDefault.textContent = '-';
    select.appendChild(optionDefault);

    if (typeof sectoresDisponibles !== 'undefined') {
        sectoresDisponibles.forEach(sector => {
            const option = document.createElement('option');
            option.value = sector.id;
            const letra = window.obtenerLetraSector ? window.obtenerLetraSector(sector.id) : sector.nombre.charAt(0);
            option.textContent = "Sector " + letra;
            select.appendChild(option);
        });
    }

    select.value = sectorActualId || '';

    // Events
    select.addEventListener('change', async (e) => {
        await actualizarSectorIngrediente(ingredienteId, e.target.value, e.target);
    });

    select.addEventListener('focus', () => {
        select.style.background = 'rgba(92, 107, 192, 0.1)';
        select.style.outline = 'none';
    });

    select.addEventListener('blur', () => {
        select.style.background = 'transparent';
    });

    return select;
}`;

const matchSelector = content.match(regexCrearSelector);
if (matchSelector) {
    content = content.replace(matchSelector[0], newCrearSelector);
} else {
    console.log("No match for crearSelectorSector");
}

// 5. Place it as a badge!
// In actualizarTablaIngredientes
// We inject the badge-like selector into tarjeta-badges directly via JS after creation
// I need to change: 
/*
                if (selectorInline) {
                    selectorInline.className = 'tarjeta-sector-selector';
                    containerSelector.appendChild(selectorInline);
                }
*/
const regexBadgeInjector = /const containerSelector = card\.querySelector\('\.sector-cell-container'\);\s*const selectorInline = [\s\S]*?containerSelector\.appendChild\(selectorInline\);\s*\}/;

const newBadgeInjector = `
                // Integrate selector directly next to badges!
                const badgesContainer = card.querySelector('.tarjeta-badges');
                const selectorInline = window.crearSelectorSectorInline ? window.crearSelectorSectorInline(ingrediente.id, ingrediente.sector_id, nombreSector) : null;
                
                if (selectorInline && badgesContainer) {
                    // Wrap it in a subtly styled badge container for layout harmony
                    const wrap = document.createElement('span');
                    wrap.className = 'badge-sutil';
                    wrap.style.padding = '0'; // Let select manage its own padding
                    wrap.style.display = 'flex';
                    wrap.style.alignItems = 'center';
                    wrap.style.border = '1px solid #c5cae9';
                    
                    wrap.appendChild(selectorInline);
                    badgesContainer.appendChild(wrap);
                }
                
                // Cleanup old container
                const containerSelector = card.querySelector('.sector-cell-container');
                if (containerSelector) containerSelector.remove();
`;
content = content.replace(regexBadgeInjector, newBadgeInjector);

fs.writeFileSync(FILE_PATH, content, 'utf8');
console.log('Done applying UX mods');
