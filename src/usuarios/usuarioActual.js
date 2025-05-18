const pool = require('./pool');

async function usuarioActual(req, res) {
  const userId = req.usuario.id;

  try {
    const result = await pool.query(
      `SELECT id, nombre_completo, usuario, rol_id FROM usuarios WHERE id = $1`,
      [userId]
    );

    const permisos = await pool.query(
      `SELECT DISTINCT p.nombre FROM permisos p
       LEFT JOIN usuarios_permisos up ON up.permiso_id = p.id AND up.usuario_id = $1 AND up.permitido = true
       LEFT JOIN roles_permisos rp ON rp.permiso_id = p.id
       LEFT JOIN usuarios u ON u.id = $1
       WHERE up.permitido = true OR rp.rol_id = u.rol_id`,
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
