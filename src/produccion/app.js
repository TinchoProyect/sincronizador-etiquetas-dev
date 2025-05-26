const express = require('express');
const cors = require('cors');
const produccionRoutes = require('./routes/produccion');

const app = express();

// Middleware para logging detallado
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

// Middleware para manejar las rutas con prefijo
app.use((req, res, next) => {
    // Si la ruta viene con /api/produccion, la ajustamos
    if (req.originalUrl.startsWith('/api/produccion')) {
        req.url = req.url.replace('/api/produccion', '');
        console.log('URL ajustada:', req.url);
    }
    next();
});

// Middleware
app.use(cors());
app.use(express.json());

// Rutas
app.use('/', produccionRoutes);

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ 
        error: 'Error interno del servidor',
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Puerto
const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
    console.log(`Servidor de producción corriendo en puerto ${PORT}`);
});
