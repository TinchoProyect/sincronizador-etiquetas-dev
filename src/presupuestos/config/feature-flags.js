module.exports = {
  // MODO SEGURO POR DEFECTO - Cambiar a 'true' para habilitar
  AUTO_SYNC_ENABLED: process.env.AUTO_SYNC_ENABLED === 'true',
  SYNC_ENGINE_ENABLED: process.env.SYNC_ENGINE_ENABLED === 'true'
};
