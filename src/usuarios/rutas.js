const express = require('express');
const router = express.Router();
const pool = require('./pool');

const { login } = require('./login');
const { usuarioActual } = require('./usuarioActual');
const { autenticarToken } = require('./middleware');

// --- LOGIN Y USUARIO ACTUAL ---
router.post('/login', login);
router.get('/usuarios/me', autenticarToken, usuarioActual);

// --- OBTENER USUARIO POR ID ---
router.get('/usuarios/:id', async (req, res) => {
  const userId = req.params.id;
  
  try {
    const result = await pool.query(`
      SELECT u.id, u.nombre_completo, u.usuario, u.rol_id, u.activo, u.comentario,
             r.nombre AS rol_nombre
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      WHERE u.id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({ error: 'Error interno al obtener usuario' });
  }
});

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

// --- ELIMINAR USUARIO ---
router.delete('/usuarios/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    // Verificar si el usuario existe
    const userExists = await pool.query('SELECT 1 FROM usuarios WHERE id = $1', [userId]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Eliminar el usuario
    await pool.query('DELETE FROM usuarios WHERE id = $1', [userId]);
    res.json({ message: 'Usuario eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    res.status(500).json({ error: 'Error interno al eliminar usuario' });
  }
});

// --- ACTUALIZAR USUARIO ---
router.put('/usuarios/:id', async (req, res) => {
  const userId = req.params.id;
  const { nombre_completo, usuario, contraseña, rol_id, comentario, activo } = req.body;

  if (!nombre_completo || !usuario) {
    return res.status(400).json({ error: 'Nombre completo y usuario son obligatorios' });
  }

  try {
    // Verificar si el usuario existe
    const userExists = await pool.query('SELECT 1 FROM usuarios WHERE id = $1', [userId]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Verificar si el nuevo nombre de usuario ya existe (excluyendo el usuario actual)
    const usuarioExists = await pool.query(
      'SELECT 1 FROM usuarios WHERE usuario = $1 AND id != $2',
      [usuario, userId]
    );
    if (usuarioExists.rows.length > 0) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya existe' });
    }

    // Construir la consulta SQL dinámicamente basada en si se incluye contraseña
    let query = `
      UPDATE usuarios 
      SET nombre_completo = $1, 
          usuario = $2, 
          rol_id = $3,
          comentario = $4,
          activo = $5
    `;
    const params = [nombre_completo, usuario, rol_id, comentario, activo];

    if (contraseña) {
      query += `, contraseña = $${params.length + 1}`;
      params.push(contraseña);
    }

    query += ` WHERE id = $${params.length + 1}`;
    params.push(userId);

    await pool.query(query, params);

    res.json({ message: 'Usuario actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ error: 'Error interno al actualizar usuario' });
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

// --- OBTENER ROL POR ID ---
router.get('/roles/:id', async (req, res) => {
  const rolId = req.params.id;
  
  try {
    const result = await pool.query('SELECT id, nombre, descripcion FROM roles WHERE id = $1', [rolId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rol no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener rol:', error);
    res.status(500).json({ error: 'Error interno al obtener rol' });
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

// --- ELIMINAR ROL ---
router.delete('/roles/:id', async (req, res) => {
  const rolId = req.params.id;

  try {
    // Verificar si el rol existe
    const rolExists = await pool.query('SELECT 1 FROM roles WHERE id = $1', [rolId]);
    if (rolExists.rows.length === 0) {
      return res.status(404).json({ error: 'Rol no encontrado' });
    }

    // Verificar si hay usuarios usando este rol
    const usersWithRole = await pool.query('SELECT 1 FROM usuarios WHERE rol_id = $1', [rolId]);
    if (usersWithRole.rows.length > 0) {
      return res.status(400).json({ error: 'No se puede eliminar el rol porque hay usuarios que lo tienen asignado' });
    }

    // Eliminar permisos asociados al rol
    await pool.query('DELETE FROM roles_permisos WHERE rol_id = $1', [rolId]);
    
    // Eliminar el rol
    await pool.query('DELETE FROM roles WHERE id = $1', [rolId]);
    
    res.json({ message: 'Rol eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar rol:', error);
    res.status(500).json({ error: 'Error interno al eliminar rol' });
  }
});

// --- ACTUALIZAR ROL ---
router.put('/roles/:id', async (req, res) => {
  const rolId = req.params.id;
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre del rol es obligatorio' });
  }

  try {
    // Verificar si el rol existe
    const rolExists = await pool.query('SELECT 1 FROM roles WHERE id = $1', [rolId]);
    if (rolExists.rows.length === 0) {
      return res.status(404).json({ error: 'Rol no encontrado' });
    }

    // Verificar si el nuevo nombre ya existe (excluyendo el rol actual)
    const nombreExists = await pool.query(
      'SELECT 1 FROM roles WHERE nombre = $1 AND id != $2',
      [nombre, rolId]
    );
    if (nombreExists.rows.length > 0) {
      return res.status(400).json({ error: 'Ya existe un rol con ese nombre' });
    }

    // Actualizar el rol
    await pool.query(
      'UPDATE roles SET nombre = $1, descripcion = $2 WHERE id = $3',
      [nombre, descripcion || null, rolId]
    );

    res.json({ message: 'Rol actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar rol:', error);
    res.status(500).json({ error: 'Error interno al actualizar rol' });
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

// --- ACTUALIZAR PERMISO ---
router.put('/permisos/:id', async (req, res) => {
  const permisoId = req.params.id;
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre del permiso es obligatorio' });
  }

  try {
    // Verificar si el permiso existe
    const permisoExists = await pool.query('SELECT 1 FROM permisos WHERE id = $1', [permisoId]);
    if (permisoExists.rows.length === 0) {
      return res.status(404).json({ error: 'Permiso no encontrado' });
    }

    // Verificar si el nuevo nombre ya existe (excluyendo el permiso actual)
    const nombreExists = await pool.query(
      'SELECT 1 FROM permisos WHERE nombre = $1 AND id != $2',
      [nombre, permisoId]
    );
    if (nombreExists.rows.length > 0) {
      return res.status(400).json({ error: 'Ya existe un permiso con ese nombre' });
    }

    // Actualizar el permiso
    await pool.query(
      'UPDATE permisos SET nombre = $1, descripcion = $2 WHERE id = $3',
      [nombre, descripcion || null, permisoId]
    );

    res.json({ message: 'Permiso actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar permiso:', error);
    res.status(500).json({ error: 'Error interno al actualizar permiso' });
  }
});

// --- ELIMINAR PERMISO ---
router.delete('/permisos/:id', async (req, res) => {
  const permisoId = req.params.id;

  try {
    // Verificar si el permiso existe
    const permisoExists = await pool.query('SELECT 1 FROM permisos WHERE id = $1', [permisoId]);
    if (permisoExists.rows.length === 0) {
      return res.status(404).json({ error: 'Permiso no encontrado' });
    }

    // Eliminar las asignaciones del permiso a roles
    await pool.query('DELETE FROM roles_permisos WHERE permiso_id = $1', [permisoId]);
    
    // Eliminar el permiso
    await pool.query('DELETE FROM permisos WHERE id = $1', [permisoId]);
    
    res.json({ message: 'Permiso eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar permiso:', error);
    res.status(500).json({ error: 'Error interno al eliminar permiso' });
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