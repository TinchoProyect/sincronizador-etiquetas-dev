const fs = require('fs');
let text = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

const targetStr = `// ✅ NUEVA FUNCIÓN PARA RECARGAR DATOS SIN PERDER FILTROS
async function recargarDatosMantenendoFiltros() {
    try {
        // Cargar datos frescos del servidor
        const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
        if (!response.ok) {
let categoriasCatalogo = []; // Para almacenar las categorias del combobox`;

const replacement = `// ✅ NUEVA FUNCIÓN PARA RECARGAR DATOS SIN PERDER FILTROS
async function recargarDatosMantenendoFiltros() {
    try {
        // Cargar datos frescos del servidor
        const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener los datos');
        }

        const datos = await response.json();

        // Actualizar lista completa y mix.js
        ingredientesOriginales = datos;
        if (typeof window.actualizarListaIngredientes === 'function') {
            window.actualizarListaIngredientes(datos);
        }

        // Mapear es_mix a esMix para consistencia
        const ingredientesConEstado = datos.map(d => ({ ...d, esMix: d.es_mix }));
        ingredientesOriginales = ingredientesConEstado;

        restaurarEstadoFiltros();
    } catch (error) {
        console.error('Error al recargar datos:', error);
    }
}

let categoriasCatalogo = []; // Para almacenar las categorias del combobox`;

if(text.includes(targetStr)) {
    text = text.replace(targetStr, replacement);
    fs.writeFileSync('src/produccion/js/ingredientes.js', text);
    console.log('Fixed syntax error');
} else {
    console.log('Target string not found!');
}
