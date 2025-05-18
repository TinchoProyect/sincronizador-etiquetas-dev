const express = require('express');
const router = express.Router();
const pool = require('./pool');

const { login } = require('./login');
const { usuarioActual } = require('./usuarioActual');
const { autenticarToken } = require('./middleware');

// --- LOGIN Y USUARIO ACTUAL ---
router.post('/login', login);
router.get('/usuarios/me', autenticarToken, usuarioActual);

// --- LISTAR USUARIOS ---
router.get('/usuarios', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nombre_completo, u.usuario, u.activo, r.nombre AS rol_nombre
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      ORDER BY u.id
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ error: 'Error interno al obtener usuarios' });
  }
});

// --- CREAR USUARIO ---
router.post('/usuarios', async (req, res) => {
  const { nombre_completo, usuario, contraseña, rol_id } = req.body;

  if (!nombre_completo || !usuario || !contraseña) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  try {
    const existe = await pool.query('SELECT 1 FROM usuarios WHERE usuario = $1', [usuario]);
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya existe' });
    }

    await pool.query(
      `INSERT INTO usuarios (nombre_completo, usuario, contraseña, rol_id, activo)
       VALUES ($1, $2, $3, $4, true)`,
      [nombre_completo, usuario, contraseña, rol_id]
    );

    res.status(201).json({ message: 'Usuario creado' });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({ error: 'Error interno al crear usuario' });
  }
});

// --- LISTAR ROLES ---
router.get('/roles', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombre, descripcion FROM roles ORDER BY nombre');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener roles:', error);
    res.status(500).json({ error: 'Error interno al obtener roles' });
  }
});

// --- CREAR ROL ---
router.post('/roles', async (req, res) => {
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre del rol es obligatorio' });
  }

  try {
    const existe = await pool.query('SELECT 1 FROM roles WHERE nombre = $1', [nombre]);
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Ese rol ya existe' });
    }

    await pool.query(
      `INSERT INTO roles (nombre, descripcion) VALUES ($1, $2)`,
      [nombre, descripcion || null]
    );

    res.status(201).json({ message: 'Rol creado correctamente' });
  } catch (error) {
    console.error('Error al crear rol:', error);
    res.status(500).json({ error: 'Error interno al crear rol' });
  }
});

// --- LISTAR PERMISOS ---
router.get('/permisos', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombre, descripcion FROM permisos ORDER BY nombre');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener permisos:', error);
    res.status(500).json({ error: 'Error interno al obtener permisos' });
  }
});

// --- CREAR PERMISO ---
router.post('/permisos', async (req, res) => {
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre del permiso es obligatorio' });
  }

  try {
    const existe = await pool.query('SELECT 1 FROM permisos WHERE nombre = $1', [nombre]);
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Ese permiso ya existe' });
    }

    await pool.query(
      `INSERT INTO permisos (nombre, descripcion) VALUES ($1, $2)`,
      [nombre, descripcion || null]
    );

    res.status(201).json({ message: 'Permiso creado correctamente' });
  } catch (error) {
    console.error('Error al crear permiso:', error);
    res.status(500).json({ error: 'Error interno al crear permiso' });
  }
});

// --- LISTAR PERMISOS DE UN ROL ---
router.get('/roles/:id/permisos', async (req, res) => {
  const rolId = req.params.id;

  try {
    const result = await pool.query(`
      SELECT p.id, p.nombre, p.descripcion
      FROM permisos p
      INNER JOIN roles_permisos rp ON p.id = rp.permiso_id
      WHERE rp.rol_id = $1
    `, [rolId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener permisos del rol:', error);
    res.status(500).json({ error: 'Error interno al obtener permisos del rol' });
  }
});

// --- ASIGNAR / QUITAR PERMISO A ROL ---
router.post('/roles/:id/permisos', async (req, res) => {
  const rolId = req.params.id;
  const { permisoId, permitir } = req.body;

  if (!permisoId || typeof permitir !== 'boolean') {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  try {
    if (permitir) {
      await pool.query(`
        INSERT INTO roles_permisos (rol_id, permiso_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [rolId, permisoId]);
      res.status(200).json({ message: 'Permiso asignado' });
    } else {
      await pool.query(`
        DELETE FROM roles_permisos
        WHERE rol_id = $1 AND permiso_id = $2
      `, [rolId, permisoId]);
      res.status(200).json({ message: 'Permiso quitado' });
    }
  } catch (error) {
    console.error('Error al modificar permisos del rol:', error);
    res.status(500).json({ error: 'Error interno al modificar permisos del rol' });
  }
});

module.exports = router;