const pool = require('./pool');

async function consultarUsuarios() {
  try {
    const result = await pool.query(`
      SELECT u.nombre_completo, u.usuario, u.contraseña, u.comentario, r.nombre as rol,
             array_agg(p.nombre) as permisos
      FROM usuarios u 
      LEFT JOIN roles r ON u.rol_id = r.id
      LEFT JOIN roles_permisos rp ON r.id = rp.rol_id
      LEFT JOIN permisos p ON rp.permiso_id = p.id
      GROUP BY u.id, r.nombre
      ORDER BY u.nombre_completo;
    `);
    
    console.log('\nUsuarios encontrados:');
    result.rows.forEach(row => {
      console.log('\n-------------------');
      console.log('Nombre:', row.nombre_completo);
      console.log('Usuario:', row.usuario);
      console.log('Contraseña:', row.contraseña);
      console.log('Rol:', row.rol);
      console.log('Permisos:', row.permisos.filter(p => p).join(', '));
      if (row.comentario) console.log('Comentario:', row.comentario);
    });

  } catch (error) {
    console.error('Error al consultar usuarios:', error);
  } finally {
    pool.end();
  }
}

consultarUsuarios();
