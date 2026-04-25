const fs = require('fs');
const path = require('path');

// 1. Update controllers/ingredientes.js
const ctrlPath = path.join(__dirname, 'src/produccion/controllers/ingredientes.js');
let ctrlContent = fs.readFileSync(ctrlPath, 'utf8');

const eliminarCategoriaFunc = `
async function eliminarCategoria(id) {
    try {
        // Verificar dependencias
        const checkQuery = 'SELECT COUNT(*) FROM ingredientes WHERE categoria_id = $1 AND estado = 1';
        const checkResult = await pool.query(checkQuery, [id]);
        
        if (parseInt(checkResult.rows[0].count) > 0) {
            throw new Error('No se puede eliminar la categoría porque hay ingredientes activos que la están usando');
        }

        const deleteQuery = 'DELETE FROM categorias_ingredientes WHERE id = $1 RETURNING *';
        const result = await pool.query(deleteQuery, [id]);

        if (result.rows.length === 0) {
            throw new Error('Categoría no encontrada');
        }

        return { mensaje: 'Categoría eliminada exitosamente' };
    } catch (error) {
        console.error('Error al eliminar categoría:', error);
        throw error;
    }
}
`;

if (!ctrlContent.includes('function eliminarCategoria')) {
    // Insert before module.exports
    const modIdx = ctrlContent.lastIndexOf('module.exports = {');
    ctrlContent = ctrlContent.substring(0, modIdx) + eliminarCategoriaFunc + '\\n' + ctrlContent.substring(modIdx);
    
    // Add to module.exports
    ctrlContent = ctrlContent.replace('actualizarCategoria,', 'actualizarCategoria,\\n    eliminarCategoria,');
    fs.writeFileSync(ctrlPath, ctrlContent, 'utf8');
    console.log('✅ Controller updated');
}

// 2. Update routes/produccion.js
const routePath = path.join(__dirname, 'src/produccion/routes/produccion.js');
let routeContent = fs.readFileSync(routePath, 'utf8');

const deleteRoute = `
// Ruta para eliminar una categoría
router.delete('/categorias/:id', async (req, res) => {
    try {
        const { eliminarCategoria } = require('../controllers/ingredientes');
        const resultado = await eliminarCategoria(req.params.id);
        res.json(resultado);
    } catch (error) {
        console.error('❌ [CATEGORIAS] Error en DELETE /categorias/:id:', error);
        let statusCode = 500;
        if (error.message.includes('No se puede eliminar')) {
            statusCode = 400;
        } else if (error.message.includes('no encontrada')) {
            statusCode = 404;
        }
        res.status(statusCode).json({ error: error.message });
    }
});
`;

if (!routeContent.includes('router.delete("/categorias/:id"') && !routeContent.includes("router.delete('/categorias/:id'")) {
    // Insert after router.put('/categorias/:id' block
    // We can use a regex to find the end of that block or just indexOf
    // Actually, searching for module.exports at the end is safer, but this is a router file. Let's find "module.exports = router;"
    const expIdx = routeContent.lastIndexOf('module.exports = router;');
    routeContent = routeContent.substring(0, expIdx) + deleteRoute + '\\n' + routeContent.substring(expIdx);
    fs.writeFileSync(routePath, routeContent, 'utf8');
    console.log('✅ Route updated');
}

