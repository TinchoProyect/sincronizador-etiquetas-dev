const fs = require('fs');
const path = require('path');

const files = [
    'debug_latest_50.json',
    'debug_presupuestos.json',
    'debug_test_presupuestos.json',
    'debug_retiros_general.json',
    'payload_debug.json',
    'pedidos_debug.json'
];

async function run() {
    console.log('--- INSPECCIONANDO ARCHIVOS JSON DE DEPURACIÓN ---');
    for (const file of files) {
        const fullPath = path.join('c:\\Users\\Martin\\Documents\\sincronizador-etiquetas - copia', file);
        if (fs.existsSync(fullPath)) {
            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                const data = JSON.parse(content);
                console.log(`Archivo: ${file} | Tipo: ${Array.isArray(data) ? 'Array' : typeof data} | Longitud/Campos: ${Array.isArray(data) ? data.length : Object.keys(data).length}`);
                
                // Print some sample/summary
                if (Array.isArray(data) && data.length > 0) {
                    console.log('Ejemplo de fila:', JSON.stringify(data[0]).substring(0, 150));
                } else {
                    console.log('Contenido:', JSON.stringify(data).substring(0, 150));
                }
            } catch (err) {
                console.log(`Error leyendo ${file}:`, err.message);
            }
        } else {
            console.log(`Archivo no existe: ${file}`);
        }
    }
}

run();
