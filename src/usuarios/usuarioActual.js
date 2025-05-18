const pool = require('./pool');

async function usuarioActual(req, res) {
  const userId = req.usuario.id;

  try {
    const result = await pool.query(
      `SELECT id, nombre_completo, usuario, rol_id FROM usuarios WHERE id = $1`,
      [userId]
    );

    const permisos = await pool.query(
      `SELECT DISTINCT p.nombre 
       FROM permisos p
       INNER JOIN roles_permisos rp ON rp.permiso_id = p.id
       INNER JOIN usuarios u ON u.rol_id = rp.rol_id
       WHERE u.id = $1`,
      [userId]
    );

    res.json({
      usuario: result.rows[0],
      permisos: permisos.rows.map(p => p.nombre),
    });
  } catch (error) {
    console.error('Error al obtener usuario actual:', error);
    res.status(500).json({ error: 'Error interno' });
  }
}

module.exports = { usuarioActual };
