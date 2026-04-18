const fs = require('fs');

const FILE_PATH = 'src/produccion/js/ingredientes.js';
let content = fs.readFileSync(FILE_PATH, 'utf8');

const anchorStart = "mostrarMensaje('Etiqueta enviada a imprimir', 'exito');";
const anchorEnd = "// Hacer los modales arrastrables";

const idxStart = content.indexOf(anchorStart);
const idxEnd = content.indexOf(anchorEnd);

if (idxStart !== -1 && idxEnd !== -1) {
    const fixedMiddle = `
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(error.message || 'No se pudo imprimir la etiqueta');
    }
}

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

    // Cargar ingredientes al iniciar
    cargarIngredientes();

    // Botón para abrir modal de nuevo ingrediente
    document.getElementById('btn-nuevo-ingrediente').addEventListener('click', () => {
        abrirModal();
    });

    `;

    const newContent = content.substring(0, idxStart + anchorStart.length) + fixedMiddle + content.substring(idxEnd);
    fs.writeFileSync(FILE_PATH, newContent, 'utf8');
    console.log("Restored missing code successfully!");
} else {
    console.log("Anchors not found!");
}
