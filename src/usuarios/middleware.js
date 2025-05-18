const jwt = require('jsonwebtoken');
const pool = require('./pool');
const { SECRET_KEY } = require('./login');

function autenticarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.sendStatus(403);
    req.usuario = user;
    next();
  });
}

function verificarPermiso(nombrePermiso) {
  return async function (req, res, next) {
    const userId = req.usuario.id;

    try {
      // Chequeo individual
      const individual = await pool.query(
        `SELECT permitido FROM usuarios_permisos up
         JOIN permisos p ON up.permiso_id = p.id
         WHERE up.usuario_id = $1 AND p.nombre = $2`,
        [userId, nombrePermiso]
      );

      if (individual.rows.length > 0) {
        return individual.rows[0].permitido ? next() : res.sendStatus(403);
      }

      // Chequeo por rol
      const porRol = await pool.query(
        `SELECT 1 FROM usuarios u
         JOIN roles_permisos rp ON rp.rol_id = u.rol_id
         JOIN permisos p ON p.id = rp.permiso_id
         WHERE u.id = $1 AND p.nombre = $2`,
        [userId, nombrePermiso]
      );

      if (porRol.rows.length > 0) return next();

      res.sendStatus(403);
    } catch (error) {
      console.error('Error verificando permisos:', error);
      res.sendStatus(500);
    }
  };
}

module.exports = { autenticarToken, verificarPermiso };
