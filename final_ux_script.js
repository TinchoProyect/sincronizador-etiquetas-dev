const fs = require('fs');

// 1. Modificar ingredientes-panel.css
const fileCss = 'src/produccion/css/ingredientes-panel.css';
let contentCss = fs.readFileSync(fileCss, 'utf8');

// Remover las reglas de zebra y tarjeta actual
const regexTarjeta = /\.tarjeta-ingrediente\s*\{[\s\S]*?box-shadow:\s*[^;]*;/;
const nuevaTarjeta = `.tarjeta-ingrediente {
    background: #f4f7fb;
    backdrop-filter: none;
    border: 1px solid #d1d5db;
    border-left: 4px solid #475569;
    border-radius: 8px;
    padding: 16px 18px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.04);`;
contentCss = contentCss.replace(regexTarjeta, nuevaTarjeta);

// Remover el :nth-child(even) que agregué
const regexZebra = /\.tarjeta-ingrediente:nth-child\(even\)\s*\{\s*background:\s*#f8fafc;\s*\}/;
contentCss = contentCss.replace(regexZebra, '');

// Mejorar los btn-accion-icono
const regexBtnAccion = /\.btn-accion-icono\s*\{[\s\S]*?font-weight:\s*600;\s*\}/;
const nuevobtnAccion = `.btn-accion-icono {
    background: #ffffff;
    border: 1px solid rgba(0,0,0,0.06);
    cursor: pointer;
    font-size: 0.95rem;
    padding: 6px 12px;
    border-radius: 6px;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #555;
    font-weight: 600;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.03);
}`;
contentCss = contentCss.replace(regexBtnAccion, nuevobtnAccion);

// Hover de btn-accion-icono
const regexBtnAccionHover = /\.btn-accion-icono:hover\s*\{\s*background:\s*#f0f0f0;\s*\}/;
const nuevobtnAccionHover = `.btn-accion-icono:hover {
    background: #f8f9fa;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.06);
    transform: translateY(-1px);
}`;
contentCss = contentCss.replace(regexBtnAccionHover, nuevobtnAccionHover);

fs.writeFileSync(fileCss, contentCss, 'utf8');


// 2. Modificar ingredientes.js
const fileJs = 'src/produccion/js/ingredientes.js';
let contentJs = fs.readFileSync(fileJs, 'utf8');

// Title format
const regexHeaderGroups = /groupHeader\.innerHTML\s*=\s*\`<h3>\$\{titulo\}<\/h3>\s*<div\s+class="sector-divider"><\/div>\`;/;
const newHeaderGroups = `const tituloCompleto = titulo + (titulo !== nombreSector ? " - " + nombreSector : "");
            groupHeader.innerHTML = \`<h3>\${tituloCompleto}</h3> <div class="sector-divider"></div>\`;`;
contentJs = contentJs.replace(regexHeaderGroups, newHeaderGroups);

// Remove the inline selector injection and create gear button!
const regexBadgeInjector = /\/\/ Integrate selector directly next to badges![\s\S]*?if\s*\(containerSelector\)\s*containerSelector\.remove\(\);/m;
const newBadgeInjector = `// Añadir botón discreto de engranaje para cambio de sector en el header de la tarjeta
                const infoPrincipal = card.querySelector('.tarjeta-info-principal .tarjeta-titulo');
                if (infoPrincipal) {
                    const editSectorBtn = document.createElement('button');
                    editSectorBtn.innerHTML = '⚙️';
                    editSectorBtn.className = 'btn-accion-icono';
                    editSectorBtn.style.cssText = 'padding: 4px; font-size: 0.8rem; background: transparent; box-shadow: none; border: none; opacity: 0.6; display: inline-flex; vertical-align: middle; margin-left: 8px;';
                    editSectorBtn.title = 'Reasignar Sector';
                    editSectorBtn.onclick = () => window.abrirModalCambioSector(ingrediente.id, ingrediente.sector_id, ingrediente.nombre);
                    infoPrincipal.appendChild(editSectorBtn);
                }
                
                // Cleanup old container
                const containerSelector = card.querySelector('.sector-cell-container');
                if (containerSelector) containerSelector.remove();`;
                
contentJs = contentJs.replace(regexBadgeInjector, newBadgeInjector);


// Inject the window.abrirModalCambioSector function near the bottom (before window.eliminarIngrediente or similar globally)
const modalSectorFunc = `
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

if (!contentJs.includes('window.abrirModalCambioSector')) {
    contentJs = contentJs.replace(/\/\/ Función para eliminar un ingrediente/g, modalSectorFunc + '\n// Función para eliminar un ingrediente');
}

fs.writeFileSync(fileJs, contentJs, 'utf8');

console.log('Final UX script applied.');
