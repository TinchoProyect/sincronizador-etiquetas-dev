require('dotenv').config();
const { getSharedPool } = require('../shared/pgPoolFactory');

const pool = getSharedPool({ defaultMax: 10 });

// Log de conexión con información del entorno
console.log(`🔌 [DB-USUARIOS] Conectado a BD: ${process.env.DB_NAME || 'etiquetas'} (Entorno: ${process.env.NODE_ENV || 'production'}, Pool max: ${pool.options.max})`);

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

// Inicialización de la tabla de jornadas/asistencia de colaboradores
const inicializarTablaJornadas = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.colaboradores_jornadas (
          id SERIAL PRIMARY KEY,
          usuario_id INTEGER NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
          fecha_ingreso TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          fecha_egreso TIMESTAMP WITH TIME ZONE DEFAULT NULL,
          horas_totales NUMERIC(10, 2) DEFAULT 0,
          minutos_totales INTEGER DEFAULT 0,
          valor_hora_aplicado NUMERIC(15, 2) DEFAULT NULL,
          monto_total NUMERIC(15, 2) DEFAULT 0,
          estado VARCHAR(20) NOT NULL DEFAULT 'EN_CURSO',
          observacion_ingreso TEXT DEFAULT NULL,
          observacion_egreso TEXT DEFAULT NULL,
          liquidada_en TIMESTAMP WITH TIME ZONE DEFAULT NULL,
          cuenta_corriente_movimiento_id INTEGER REFERENCES public.factura_cuenta_corriente_movimientos(id) ON DELETE SET NULL,
          creado_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          actualizado_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_colaboradores_jornadas_usuario_estado 
      ON public.colaboradores_jornadas(usuario_id, estado);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_colaboradores_jornadas_fecha 
      ON public.colaboradores_jornadas(fecha_ingreso);
    `);

    console.log('✅ [DB-USUARIOS] Tabla public.colaboradores_jornadas verificada/creada.');
  } catch (err) {
    console.error('❌ [DB-USUARIOS] Error al inicializar tabla colaboradores_jornadas:', err.message);
  }
};

inicializarTablaTarifas();
inicializarTablaJornadas();

module.exports = pool;
