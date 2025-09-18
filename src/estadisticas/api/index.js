const carrosRoutes = require('./routes/carros.routes');
const modelosRoutes = require('./routes/modelos.routes');
const healthRoutes  = require('./routes/health.routes');

module.exports = (app) => {
  app.use('/api/estadisticas', carrosRoutes);
  app.use('/api/estadisticas', modelosRoutes);
  app.use('/api/estadisticas', healthRoutes);
};
