const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');

const imprimirEtiquetaIngrediente = async (req, res) => {
    try {
        const { ingredienteId, id, nombre, cantidad, codigo, sector } = req.body;

        if (!nombre) {
            return res.status(400).json({ error: 'Falta el nombre del ingrediente' });
        }

        console.log('🖨️ [IMPRESIÓN] Solicitud de etiqueta de ingrediente:', { nombre, cantidad, codigo, sector });

        const scriptPath = path.resolve(__dirname, '../../scripts/imprimirEtiquetaIngrediente.js');
        const tempDir = path.resolve(__dirname, '../../app-etiquetas/temp');

        await fs.mkdir(tempDir, { recursive: true });

        const uniqueId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const jsonPath = path.join(tempDir, `temp-ingrediente-${uniqueId}.json`);
        const datos = {
            id: ingredienteId || id || undefined,
            nombre: String(nombre || ''),
            codigo: String(codigo || ingredienteId || id || '00000000'),
            sector: String(sector || '')
        };

        await fs.writeFile(jsonPath, JSON.stringify(datos, null, 2), 'utf8');
        console.log('📝 [IMPRESIÓN] Archivo temporal JSON creado:', jsonPath);

        const cantidadEntera = Math.max(1, Math.ceil(parseFloat(cantidad) || 1));
        const command = `node "${scriptPath}" ${cantidadEntera} "${jsonPath}"`;

        console.log('🚀 [IMPRESIÓN] Ejecutando comando:', command);

        exec(command, { cwd: path.resolve(__dirname, '../..') }, (error, stdout, stderr) => {
            fs.unlink(jsonPath).catch(() => {});

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

const imprimirEtiquetaArticulo = async (req, res) => {
    try {
        const datos = req.body;
        if (!datos || !datos.articulo) {
            return res.status(400).json({ error: 'Faltan datos del artículo para imprimir' });
        }

        const cantidadEntera = Math.max(1, Math.ceil(parseFloat(datos.cantidad) || 1));
        const scriptPath = path.resolve(__dirname, '../../scripts/imprimirEtiqueta.js');
        const tempDir = path.resolve(__dirname, '../../app-etiquetas/temp');

        await fs.mkdir(tempDir, { recursive: true });

        const uniqueId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const jsonPath = path.join(tempDir, `temp-data-${uniqueId}.json`);

        const payload = {
            ...datos,
            articulo: {
                numero: String(datos.articulo.numero || ''),
                nombre: String(datos.articulo.nombre || datos.articulo.descripcion || datos.articulo.numero || 'Artículo'),
                codigo_barras: String(datos.articulo.codigo_barras || datos.articulo.numero || '00000000')
            },
            cantidad: cantidadEntera
        };

        await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

        const command = `node "${scriptPath}" ${cantidadEntera} "${jsonPath}"`;
        console.log('🚀 [IMPRESIÓN ARTÍCULO] Ejecutando comando:', command);

        exec(command, { cwd: path.resolve(__dirname, '../..') }, (error, stdout, stderr) => {
            fs.unlink(jsonPath).catch(() => {});

            if (error) {
                console.error(`❌ [IMPRESIÓN ARTÍCULO] Error ejecutando script: ${error.message}`);
                return res.status(500).json({
                    error: 'Error al imprimir etiqueta de artículo',
                    details: error.message,
                    stderr: stderr
                });
            }

            res.json({
                success: true,
                message: 'Impresión enviada correctamente',
                output: stdout
            });
        });
    } catch (error) {
        console.error('❌ [IMPRESIÓN ARTÍCULO] Error en controlador:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = { imprimirEtiquetaIngrediente, imprimirEtiquetaArticulo };

