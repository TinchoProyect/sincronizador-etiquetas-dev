const express = require('express');
const cors = require('cors');
const rutasProduccion = require('./rutas');

const app = express();
const PORT = 3002;

// Middlewares
app.use(cors());
app.use(express.json());

// Rutas
app.use('/api/produccion', rutasProduccion);

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Error interno del servidor'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor de producción ejecutándose en puerto ${PORT}`);
});
