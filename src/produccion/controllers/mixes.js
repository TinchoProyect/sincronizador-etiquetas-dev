/**
 * Controlador de mixes (ingredientes compuestos).
 * Permite crear y gestionar la composición de un mix.
 */

const pool = require('../config/database'); // Ajustar la ruta si corresponde

/**
 * Evita que se formen ciclos (un mix contenga a sí mismo en cualquier nivel).
 * @param {number} mixId ID del mix principal
 * @param {number} ingredienteId ID del posible ingrediente a insertar
 * @returns {Promise<boolean>} Retorna true si se detecta un ciclo
 */
async function existeCiclo(mixId, ingredienteId) {
  // Lógica básica para detectar ciclos:
  // 1. Si ingredienteId es el mismo que mixId, ya es un ciclo directo.
  // 2. Recorrer árbol de padres para ver si mixId aparece como "padre_id" en la cadena.
  if (mixId === ingredienteId) return true;

  // Búsqueda recursiva de ancestros:
  const queryPadre = `
    WITH RECURSIVE ascendent AS (
      SELECT id, padre_id
      FROM ingredientes
      WHERE id = $1
      UNION
      SELECT i.id, i.padre_id
      FROM ingredientes i
      INNER JOIN ascendent a ON i.id = a.padre_id
    )
    SELECT * FROM ascendent;
  `;
  const resultPadre = await pool.query(queryPadre, [ingredienteId]);
  // Si en la cadena de ancestros de "ingredienteId" está "mixId", hay ciclo.
  return resultPadre.rows.some(row => row.padre_id === mixId);
}

/**
 * Verifica si una cantidad es decimal positiva.
 * @param {number} cantidad
 * @returns {boolean} true si es decimal positiva
 */
function esCantidadValida(cantidad) {
  if (isNaN(cantidad)) return false;
  return cantidad > 0;
}

/**
 * Crear un ingrediente nuevo que será usado como mix.
 * No requiere composición inicial, esta se puede agregar después.
 */
async function crearMix(req, res) {
  try {
    const { nombre, descripcion, unidad_medida } = req.body;
    if (!nombre || nombre.trim() === '') {
      return res.status(400).json({ error: 'El nombre del mix es requerido' });
    }

    // Insertar en ingredientes (sin padre_id indica que es un mix "raíz")
    const insertIng = `
      INSERT INTO ingredientes (nombre, descripcion, unidad_medida, padre_id)
      VALUES ($1, $2, $3, NULL)
      RETURNING id, nombre, descripcion, unidad_medida;
    `;
    const resultIng = await pool.query(insertIng, [
      nombre.trim(),
      descripcion || null,
      unidad_medida || null
    ]);
    const nuevoMix = resultIng.rows[0];
    res.json({
      message: 'Mix creado exitosamente',
      mix: nuevoMix,
    });
  } catch (error) {
    console.error('Error al crear mix:', error);
    res.status(500).json({ error: 'Error interno del servidor al crear el mix' });
  }
}

/**
 * Obtener la composición completa de un mix (sus ingredientes hijos y cantidades).
 */
async function obtenerComposicionDeMix(req, res) {
  try {
    const { mix_id } = req.params;
    const mixId = parseInt(mix_id, 10);

    // Primero verificamos que el mix existe
    const queryMix = `
      SELECT id, nombre, descripcion, unidad_medida 
      FROM ingredientes 
      WHERE id = $1;
    `;
    const resultMix = await pool.query(queryMix, [mixId]);
    
    if (resultMix.rows.length === 0) {
      return res.status(404).json({ error: 'Mix no encontrado' });
    }

    // Obtenemos su composición con detalles de cada ingrediente
    const queryComposicion = `
      SELECT 
        c.mix_id,
        c.ingrediente_id,
        c.cantidad,
        i.nombre AS nombre_ingrediente,
        i.unidad_medida,
        i.descripcion AS descripcion_ingrediente
      FROM ingrediente_composicion c
      JOIN ingredientes i ON c.ingrediente_id = i.id
      WHERE c.mix_id = $1
      ORDER BY i.nombre;
    `;
    const result = await pool.query(queryComposicion, [mixId]);

    // Devolvemos tanto los datos del mix como su composición
    res.json({
      mix: resultMix.rows[0],
      composicion: result.rows
    });
  } catch (error) {
    console.error('Error al obtener composición del mix:', error);
    res.status(500).json({ error: 'Error interno al obtener la composición del mix' });
  }
}

/**
 * Agregar un ingrediente a la composición de un mix.
 */
async function agregarIngredienteAlMix(req, res) {
  try {
    const { mix_id } = req.params;
    const mixId = parseInt(mix_id, 10);
    const { ingrediente_id, cantidad } = req.body;
    const ingredienteId = parseInt(ingrediente_id, 10);

    // Validar cantidad
    if (!esCantidadValida(cantidad)) {
      return res.status(400).json({ error: 'La cantidad debe ser un número decimal positivo' });
    }

    // Evitar ciclos
    const hayCiclo = await existeCiclo(mixId, ingredienteId);
    if (hayCiclo) {
      return res.status(400).json({ error: 'Se detectó un ciclo. No se puede añadir este ingrediente.' });
    }

    const queryInsert = `
      INSERT INTO ingrediente_composicion (mix_id, ingrediente_id, cantidad)
      VALUES ($1, $2, $3)
      RETURNING mix_id, ingrediente_id, cantidad;
    `;
    const result = await pool.query(queryInsert, [mixId, ingredienteId, cantidad]);
    res.json({
      message: 'Ingrediente agregado al mix con éxito',
      composicion: result.rows[0],
    });
  } catch (error) {
    console.error('Error al agregar ingrediente al mix:', error);
    res.status(500).json({ error: 'Error interno al agregar ingrediente al mix' });
  }
}

/**
 * Editar la cantidad de un ingrediente dentro de un mix.
 */
async function editarIngredienteDelMix(req, res) {
  try {
    const { mix_id, ingrediente_id } = req.params;
    const { cantidad } = req.body;
    const mixId = parseInt(mix_id, 10);
    const ingId = parseInt(ingrediente_id, 10);

    if (!esCantidadValida(cantidad)) {
      return res.status(400).json({ error: 'La cantidad debe ser un número decimal positivo' });
    }

    const queryUpdate = `
      UPDATE ingrediente_composicion
      SET cantidad = $1
      WHERE mix_id = $2 AND ingrediente_id = $3
      RETURNING mix_id, ingrediente_id, cantidad;
    `;
    const result = await pool.query(queryUpdate, [cantidad, mixId, ingId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No se encontró este ingrediente en la composición del mix' });
    }

    res.json({
      message: 'Ingrediente del mix actualizado con éxito',
      composicion: result.rows[0],
    });
  } catch (error) {
    console.error('Error al editar ingrediente del mix:', error);
    res.status(500).json({ error: 'Error interno al editar ingrediente del mix' });
  }
}

/**
 * Eliminar un ingrediente de la composición de un mix.
 */
async function eliminarIngredienteDelMix(req, res) {
  try {
    const { mix_id, ingrediente_id } = req.params;
    const mixId = parseInt(mix_id, 10);
    const ingId = parseInt(ingrediente_id, 10);

    const queryDelete = `
      DELETE FROM ingrediente_composicion
      WHERE mix_id = $1 AND ingrediente_id = $2
      RETURNING mix_id, ingrediente_id;
    `;
    const result = await pool.query(queryDelete, [mixId, ingId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No se encontró este ingrediente en la composición del mix' });
    }

    res.json({
      message: 'Ingrediente eliminado del mix',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error al eliminar ingrediente del mix:', error);
    res.status(500).json({ error: 'Error interno al eliminar ingrediente del mix' });
  }
}

module.exports = {
  crearMix,
  obtenerComposicionDeMix,
  agregarIngredienteAlMix,
  editarIngredienteDelMix,
  eliminarIngredienteDelMix,
};
