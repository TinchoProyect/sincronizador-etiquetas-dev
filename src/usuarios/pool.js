require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// Log de conexión con información del entorno
console.log(`🔌 [DB-USUARIOS] Conectado a BD: ${process.env.DB_NAME || 'etiquetas'} (Entorno: ${process.env.NODE_ENV || 'production'})`);

// Inicialización de la tabla de tarifas de colaboradores
const inicializarTablaTarifas = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.colaboradores_tarifas (
          id SERIAL PRIMARY KEY,
          usuario_id INTEGER NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
          valor_hora NUMERIC(15, 2) NOT NULL CHECK (valor_hora >= 0),
          fecha_desde TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          fecha_hasta TIMESTAMP DEFAULT NULL,
          activo BOOLEAN NOT NULL DEFAULT true,
          creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Índice único parcial para que solo haya una tarifa activa por usuario
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_colaboradores_tarifas_active_unique
      ON public.colaboradores_tarifas (usuario_id) WHERE (activo = true);
    `);

    // Índice general
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_colaboradores_tarifas_user_id
      ON public.colaboradores_tarifas (usuario_id);
    `);
    
    console.log('✅ [DB-USUARIOS] Tabla public.colaboradores_tarifas verificada/creada.');
  } catch (err) {
    console.error('❌ [DB-USUARIOS] Error al inicializar tabla colaboradores_tarifas:', err.message);
  }
};

inicializarTablaTarifas();

module.exports = pool;
