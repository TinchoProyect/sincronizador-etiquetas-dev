const fs = require('fs');
let b = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

// Find the string "// Cargar ingredientes al iniciar"
const idx = b.indexOf('// Cargar ingredientes al iniciar');

if (idx !== -1) {
    const fix = `
// Función para actualizar visibilidad del botón de impresión
function actualizarBotonImpresion() {
    const btnImprimir = document.getElementById('btn-imprimir');
    const codigo = document.getElementById('codigo').value;

    if (btnImprimir) {
        btnImprimir.style.display = codigo ? 'block' : 'none';
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
    // Configurar botón de impresión del modal de edición
    const btnImprimir = document.getElementById('btn-imprimir');
    if (btnImprimir) {
        btnImprimir.addEventListener('click', () => {
            const codigo = document.getElementById('codigo').value;
            const nombre = document.getElementById('nombre').value;
            const sectorId = document.getElementById('sector').value;

            // Utilizar la Lógica de extracción modularizada para evitar código espejo
            let sectorLetra = window.obtenerLetraSector(sectorId);

            if (codigo && nombre) {
                imprimirEtiqueta({ codigo, nombre, sector: sectorLetra });
            }
        });
    }

    //Filtro por nombre -Mari
    document.getElementById('filtro-nombre').addEventListener('input', () => {
        actualizarTablaFiltrada();
    });

    // Cargar sectores disponibles al inicializar
    await cargarSectores();

    // Cargar ingredientes al iniciar`;

    b = b.substring(0, idx) + fix + b.substring(idx + '// Cargar ingredientes al iniciar'.length);

    fs.writeFileSync('src/produccion/js/ingredientes.js', b);
    console.log("Restored successfully");
} else {
    console.log("Target not found");
}
