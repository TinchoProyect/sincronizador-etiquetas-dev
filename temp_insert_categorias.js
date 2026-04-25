const fs = require('fs');

const file = 'c:\\Users\\Martin\\Documents\\sincronizador-etiquetas - copia\\src\\produccion\\routes\\produccion.js';
let content = fs.readFileSync(file, 'utf8');

const insertStr = `});

// ==========================================
// RUTAS PARA CATEGORÍAS
// ==========================================

// Ruta para obtener categorías
router.get('/categorias', async (req, res) => {
    try {
        const { obtenerCategorias } = require('../controllers/ingredientes');
        const categorias = await obtenerCategorias();
        res.json(categorias);
    } catch (error) {
        console.error('❌ [CATEGORIAS] Error en GET /categorias:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para crear una nueva categoría
router.post('/categorias', async (req, res) => {
    try {
        const { crearCategoria } = require('../controllers/ingredientes');
        const nuevaCategoria = await crearCategoria(req.body);
        res.status(201).json(nuevaCategoria);
    } catch (error) {
        console.error('❌ [CATEGORIAS] Error en POST /categorias:', error);
        const statusCode = error.message.includes('requerido') || error.message.includes('existe') ? 400 : 500;
        res.status(statusCode).json({ error: error.message });
    }
});

// Ruta para actualizar una categoría
router.put('/categorias/:id', async (req, res) => {
    try {
        const { actualizarCategoria } = require('../controllers/ingredientes');
        const categoriaActualizada = await actualizarCategoria(req.params.id, req.body);
        res.json(categoriaActualizada);
    } catch (error) {
        console.error('❌ [CATEGORIAS] Error en PUT /categorias/:id:', error);
        let statusCode = 500;
        if (error.message.includes('requerido') || error.message.includes('existe')) {
            statusCode = 400;
        } else if (error.message.includes('no encontrada')) {
            statusCode = 404;
        }
        res.status(statusCode).json({ error: error.message });
    }
});

// ==========================================
// RUTAS PARA NUTRIENTES`;

if (content.includes('// RUTAS PARA CATEGORÍAS')) {
    console.log('Ya insertado');
} else {
    content = content.replace(/}\);\r?\n\r?\n\/\/ ==========================================\r?\n\/\/ RUTAS PARA NUTRIENTES/, insertStr);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Insertado exitosamente');
}
