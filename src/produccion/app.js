const express = require('express');
const cors = require('cors');
const produccionRoutes = require('./routes/produccion');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Rutas
app.use('/api/produccion', produccionRoutes);

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// Puerto
const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
    console.log(`Servidor de producción corriendo en puerto ${PORT}`);
});

module.exports = app;
