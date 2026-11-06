const pool = require('./pool');
const { verificarTokenOExtraerUsuario } = require('../shared/lamdaCloudAuthGuard');

function autenticarToken(req, res, next) {
  const isLab =
    String(process.env.MODO_LABORATORIO || '').toLowerCase() === 'true' ||
    String(process.env.LAMDA_MODO_LABORATORIO || '').toLowerCase() === 'true' ||
    process.env.DB_NAME === 'etiquetas_pruebas';
  if (isLab) {
    req.usuario = { id: 2, usuario: 'Tincho', rol_id: 1 };
    return next();
  }

  const authHeader = req.headers['authorization'];
  const cookieHeader = req.headers['cookie'];
  const hasAnyCredential = Boolean(
    (authHeader && String(authHeader).trim()) ||
    (cookieHeader && String(cookieHeader).includes('lamda_cloud_jwt=')) ||
    req.headers['x-access-token'] ||
    req.headers['x-chofer-token']
  );

  if (!hasAnyCredential) {
    return res.sendStatus(401);
  }

  const user = verificarTokenOExtraerUsuario(req);
  if (!user) {
    return res.sendStatus(403);
  }

  req.usuario = user;
  next();
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
