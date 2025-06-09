const corsOptions = {
    origin: ['http://localhost:3002'],  // Permitir solo el origen específico
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true
};

module.exports = corsOptions;
