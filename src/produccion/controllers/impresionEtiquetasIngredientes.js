const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');

const imprimirEtiquetaIngrediente = async (req, res) => {
    try {
        const { ingredienteId, nombre, cantidad, codigo, sector } = req.body;

        if (!nombre) {
            return res.status(400).json({ error: 'Falta el nombre del ingrediente' });
        }

        console.log('🖨️ [IMPRESIÓN] Solicitud de etiqueta de ingrediente:', { nombre, cantidad, codigo, sector });

        // Definir rutas relativas a la estructura del proyecto
        // Asumiendo que estamos en src/produccion/controllers
        // El script está en src/scripts
        const scriptPath = path.resolve(__dirname, '../../scripts/imprimirEtiquetaIngrediente.js');
        const tempDir = path.resolve(__dirname, '../../app-etiquetas/temp');

        // Asegurar que el directorio temporal existe
        await fs.mkdir(tempDir, { recursive: true });

        // Crear el archivo JSON que espera el script
        const jsonPath = path.join(tempDir, 'temp-ingrediente.json');
        const datos = {
            nombre: nombre,
            codigo: codigo || '',
            sector: sector || ''
        };

        await fs.writeFile(jsonPath, JSON.stringify(datos, null, 2), 'utf8');
        console.log('📝 [IMPRESIÓN] Archivo temporal JSON creado:', jsonPath);

        // Ejecutar el script
        // El script toma la cantidad como argumento
        const cantidadEntera = Math.ceil(parseFloat(cantidad) || 1);
        const command = `node "${scriptPath}" ${cantidadEntera}`;

        console.log('🚀 [IMPRESIÓN] Ejecutando comando:', command);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ [IMPRESIÓN] Error ejecutando script: ${error.message}`);
                console.error(`❌ [IMPRESIÓN] stderr: ${stderr}`);
                return res.status(500).json({
                    error: 'Error al ejecutar script de impresión',
                    details: error.message,
                    stderr: stderr
                });
            }

            console.log(`✅ [IMPRESIÓN] Script ejecutado exitosamente`);
            console.log(`📄 [IMPRESIÓN] stdout: ${stdout}`);

            res.json({
                success: true,
                message: 'Orden de impresión enviada correctamente',
                output: stdout
            });
        });

    } catch (error) {
        console.error('❌ [IMPRESIÓN] Error en controlador:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = { imprimirEtiquetaIngrediente };
