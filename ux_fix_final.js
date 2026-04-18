const fs = require('fs');

// 1. Modificar Accordion en ingredientes.html
let htmlFile = 'src/produccion/pages/ingredientes.html';
let html = fs.readFileSync(htmlFile, 'utf8');

// The exact tag is <div class="accordion-content" id="accordion-sectores-depositos">
// If it has collapsed already, we don't replace. If it doesn't we add it.

const regexAccordion = /<div class="accordion-content"\s*id="accordion-sectores-depositos">/;
if (regexAccordion.test(html)) {
    html = html.replace(regexAccordion, '<div class="accordion-content collapsed" id="accordion-sectores-depositos">');
}
fs.writeFileSync(htmlFile, html, 'utf8');


// 2. Modificar color de tarjeta y limpiar CSS amarillo
let cssFile = 'src/produccion/css/ingredientes-panel.css';
let css = fs.readFileSync(cssFile, 'utf8');

css = css.replace(/background:\s*#e3f2fd;/, 'background: #f5f6fa;');

const yellowBadgeRegex = /\.badge-sector-clickable\s*\{[\s\S]*?\}\s*\.badge-sector-clickable:hover\s*\{[\s\S]*?\}/;
if (yellowBadgeRegex.test(css)) {
    css = css.replace(yellowBadgeRegex, ''); // Remove yellow badge logic entirely
}

fs.writeFileSync(cssFile, css, 'utf8');


// 3. Reubicar botón y asegurar la función modal
let jsFile = 'src/produccion/js/ingredientes.js';
let js = fs.readFileSync(jsFile, 'utf8');

// Primero eliminar la vieja badge que agregué
const badgesRegex = /const badgesContainer = card\.querySelector\('\.tarjeta-badges'\);[\s\S]*?badgesContainer\.appendChild\(editSectorBadge\);\s*\}/;
if (badgesRegex.test(js)) {
    js = js.replace(badgesRegex, '');
}

// Check where bottom buttons are. In ingredientes.js:
// <div class="tarjeta-footer">
//     <div class="tarjeta-acciones-principales">

const footerRegex = /<div class="tarjeta-acciones-principales">([\s\S]*?)<\/div>/;
// Wait, we generate HTML in a template or DOM elements?
// En ingredientes.js card.innerHTML tiene las acciones principales

const jsFooterMatch = js.match(/<div class="tarjeta-acciones-principales">([\s\S]*?)<\/div>/);
if (jsFooterMatch) {
    const newFooter = `<div class="tarjeta-acciones-principales">
                            \${mixButtons}
                            <button class="btn-accion-icono" onclick="window.abrirModalCambioSector(\${ingrediente.id}, \${ingrediente.sector_id || 'null'}, '\${ingrediente.nombre.replace(/'/g, "\\\\'")}')" title="Sector Actual">📍 Sec. \${(window.obtenerLetraSector ? window.obtenerLetraSector(ingrediente.sector_id) : '?') || '?'}</button>
                        </div>`;
    js = js.replace(jsFooterMatch[0], newFooter);
}

// Y removemos las inyecciones si quedaron (como "const infoPrincipal = card.querySelector...")
const oldInjectionRegex = /const infoPrincipal = card\.querySelector\('\.tarjeta-info-principal \.tarjeta-titulo'\);[\s\S]*?infoPrincipal\.appendChild\(editSectorBtn\);\s*\}/;
if (oldInjectionRegex.test(js)) {
    js = js.replace(oldInjectionRegex, '');
}

// Ahora, aseguremos la existencia real de window.abrirModalCambioSector al propio final del documento
const modalSectorFunc = `

// ============================================
// FUNCION MODAL SECTOR
// ============================================
window.abrirModalCambioSector = async function(ingredienteId, sectorActualId, nombreIngrediente) {
    if (typeof sectoresDisponibles === 'undefined' || sectoresDisponibles.length === 0) {
        Swal.fire('Error', 'No hay sectores disponibles cargados', 'error');
        return;
    }

    let optionsHtml = '<option value="">Sin asignar</option>';
    sectoresDisponibles.forEach(sector => {
        const selected = (sector.id == sectorActualId) ? 'selected' : '';
        optionsHtml += \`<option value="\${sector.id}" \${selected}>\${sector.nombre}</option>\`;
    });

    const result = await Swal.fire({
        title: 'Reasignar Sector',
        html: \`
            <div style="text-align: left; margin-bottom: 15px;">
                <p><strong>Ingrediente:</strong> \${nombreIngrediente}</p>
                <p>Seleccione la nueva ubicación:</p>
            </div>
            <select id="swal-sector-select" class="swal2-select" style="width: 100%; max-width: 100%; border: 1px solid #ccc; font-size: 1rem; border-radius: 4px;">
                \${optionsHtml}
            </select>
        \`,
        showCancelButton: true,
        confirmButtonText: 'Guardar cambios',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#007bff',
        focusConfirm: false,
        preConfirm: async () => {
            const nuevoSectorId = document.getElementById('swal-sector-select').value;
            Swal.showLoading();
            try {
                const datos = { sector_id: nuevoSectorId || null };
                const response = await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${ingredienteId}\`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datos)
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Error al actualizar el sector');
                }
                return true;
            } catch (error) {
                Swal.showValidationMessage(error.message || 'Error de red');
                return false;
            }
        }
    });

    if (result.isConfirmed) {
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: 'Sector reasignado',
            showConfirmButton: false,
            timer: 2000
        });
        
        if (window.recargarDatosMantenendoFiltros) {
            await window.recargarDatosMantenendoFiltros();
        }
    }
};
`;

// Evitar doble inyección si se corre dos veces
if (!js.includes('window.abrirModalCambioSector = async function(')) {
    js += modalSectorFunc;
}

fs.writeFileSync(jsFile, js, 'utf8');

console.log('Script correctivo aplicado a los 3 archivos.');
