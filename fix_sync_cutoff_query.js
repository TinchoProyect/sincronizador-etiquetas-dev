// FIX PARA EL QUERY DE CUTOFF_AT EN SYNC MANUAL
// Corrige el problema donde presupuestos recientes no se detectan

const fs = require('fs');

const CONTROLLER_PATH = 'src/presupuestos/controllers/sync_fechas_fix.js';

console.log('🔧 [FIX] Aplicando corrección al query de cutoff_at...');

// Leer el archivo actual
let content = fs.readFileSync(CONTROLLER_PATH, 'utf8');

// Buscar y reemplazar el query problemático
const oldQuery = `      HAVING GREATEST(
        COALESCE(p.fecha_actualizacion, 'epoch'::timestamptz),
        COALESCE(MAX(d.fecha_actualizacion), 'epoch'::timestamptz)
      ) >= $1`;

const newQuery = `      HAVING GREATEST(
        p.fecha_actualizacion,
        COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
      ) >= $1`;

if (content.includes(oldQuery)) {
  content = content.replace(oldQuery, newQuery);
  
  // También corregir el SELECT para que sea consistente
  const oldSelect = `        GREATEST(
          COALESCE(p.fecha_actualizacion, 'epoch'::timestamptz),
          COALESCE(MAX(d.fecha_actualizacion), 'epoch'::timestamptz)
        ) AS local_last_edit`;

  const newSelect = `        GREATEST(
          p.fecha_actualizacion,
          COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
        ) AS local_last_edit`;

  content = content.replace(oldSelect, newSelect);
  
  // Escribir el archivo corregido
  fs.writeFileSync(CONTROLLER_PATH, content);
  
  console.log('✅ [FIX] Query corregido exitosamente');
  console.log('🔍 [FIX] Cambios aplicados:');
  console.log('   - Eliminado COALESCE con epoch que causaba problemas');
  console.log('   - Usar p.fecha_actualizacion directamente (nunca es NULL)');
  console.log('   - Fallback a p.fecha_actualizacion si no hay detalles');
  
} else {
  console.log('❌ [FIX] No se encontró el query a corregir');
}
