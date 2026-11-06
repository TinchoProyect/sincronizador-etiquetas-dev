const jwt = require('jsonwebtoken');
const pool = require('./pool');
const { emitirCookieSesionCloud } = require('../shared/lamdaCloudAuthGuard');

const SECRET_KEY = process.env.JWT_SECRET || 'LAMDA_super_secreta'; // Podés moverla a un .env más adelante

async function login(req, res) {
  const contraseña = req.body?.contraseña ?? req.body?.password;
  const usuario = req.body?.usuario;

  if (!usuario || !contraseña) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE usuario = $1 AND activo = true',
      [usuario]
    );

    const user = result.rows[0];

    if (!user || user.contraseña !== contraseña) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { id: user.id, usuario: user.usuario, rol_id: user.rol_id },
      SECRET_KEY,
      { expiresIn: '30d' }
    );

    // Emitir Cookie firmada HttpOnly; SameSite=Lax (lamda_cloud_jwt) para el Gateway 3005
    try {
      emitirCookieSesionCloud(req, res, token);
    } catch (_) {}

    res.json({
      token,
      user: {
        id: user.id,
        usuario: user.usuario,
        nombre_completo: user.nombre_completo,
        rol_id: user.rol_id
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno' });
  }
}

module.exports = { login, SECRET_KEY };
