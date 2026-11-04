const express = require('express');
const cors = require('cors');
const corsOptions = require('./config/cors');

const app = express();

// Habilitar CORS con las opciones configuradas
app.use(cors(corsOptions));

// Middleware para procesar JSON (límite ampliado para catálogos y PDFs)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Rutas
app.use('/api/etiquetas', require('./routes/etiquetas'));

// Manejo de errores CORS
app.use((err, req, res, next) => {
    if (err.name === 'CORSError') {
        res.status(403).json({
            error: 'No permitido por CORS',
            details: err.message
        });
    } else {
        next(err);
    }
});

module.exports = app;
