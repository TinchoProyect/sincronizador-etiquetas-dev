const jwt = require('jsonwebtoken');
const pool = require('./pool');

const SECRET_KEY = 'LAMDA_super_secreta'; // Podés moverla a un .env más adelante

async function login(req, res) {
  const { usuario, contraseña } = req.body;

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
      { expiresIn: '8h' }
    );

    res.json({ token });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno' });
  }
}

module.exports = { login, SECRET_KEY };
