const express = require('express');
const cors = require('cors');
const path = require('path');
const produccionRoutes = require('./routes/produccion');
const usuariosRoutes = require('../usuarios/rutas');

const app = express();

// ✅ Middleware para interpretar JSON en los requests
app.use(express.json());

// Configuración de archivos estáticos y rutas base
app.use(express.static(__dirname));
app.use('/pages', express.static(path.join(__dirname, 'pages')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));

// Redirigir la raíz a la página principal de producción
app.get('/', (req, res) => {
    res.redirect('/pages/produccion.html');
});

// Middleware para logging detallado
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

// ✅ Middleware para ajustar solo si es necesario (solo si no se rompe)
app.use('/api/produccion', produccionRoutes); // ← Registro completo sin manipular req.url

// Otras rutas de usuarios
app.use('/api', usuariosRoutes);

// Middleware
app.use(cors());

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
