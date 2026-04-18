const fs = require('fs');

let file = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

// 1. Remove text from Sector button (leaving only icon)
// In my code, it could be `📍 Sec. ${isLetter ? letraPura : 'Asg'}` or similar
file = file.replace(
    /(<button class="btn-tarjeta-sector"[^>]+>)(📍.*?)<\/button>/,
    '$1📍</button>'
);

// 2. Append the window.abrirModalSector function if it does not exist
const modalFunc = `
// ============================================
// FUNCIONES UI DE SECTOR
// ============================================
window.abrirModalSector = async function(ingredienteId, sectorActualId) {
    if (typeof sectoresDisponibles === 'undefined' || sectoresDisponibles.length === 0) {
        Swal.fire('Error', 'No hay sectores cargados. Por favor refresque la página.', 'error');
        return;
    }

    let sectorActualNombre = "Sin asignar";
    if (sectorActualId) {
        const sectorObj = sectoresDisponibles.find(s => s.id == sectorActualId);
        if (sectorObj) sectorActualNombre = sectorObj.nombre;
    }

    let html = \`<div style="margin-bottom: 15px; font-weight: bold; color: #555;">Sector actual: <span style="color: #333;">\${sectorActualNombre}</span></div>\`;
    html += '<select id="swal-sectores" class="swal2-select" style="max-width: 100%;">';
    html += '<option value="">Sin asignar</option>';
    sectoresDisponibles.forEach(s => {
        let sel = s.id == sectorActualId ? 'selected' : '';
        html += \`<option value="\${s.id}" \${sel}>\${s.nombre}\${s.descripcion ? ' (' + s.descripcion + ')' : ''}</option>\`;
    });
    html += '</select>';

    const res = await Swal.fire({
        title: 'Reasignar Sector',
        html: html,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: async () => {
            const val = document.getElementById('swal-sectores').value;
            Swal.showLoading();
            try {
                let r = await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${ingredienteId}\`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sector_id: val || null })
                });
                
                if (!r.ok) {
                    const data = await r.json();
                    throw new Error(data.error || 'Error al guardar sector');
                }
                return true;
            } catch (err) {
                Swal.showValidationMessage(err.message);
                return false;
            }
        }
    });

    if (res.isConfirmed) {
        Swal.fire({
            icon: 'success',
            title: 'Sector actualizado',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 2000
        });
        if (window.actualizarTablaFiltrada) {
            await window.cargarSectores(); // Reload sectors just in case
            await window.cargarIngredientes(); // Need full reload to catch sector_id and object relations mapping
        }
    }
};
`;

if (!file.includes('window.abrirModalSector = async function')) {
    file += modalFunc;
}

fs.writeFileSync('src/produccion/js/ingredientes.js', file, 'utf8');
console.log('Script safely executed.');
