const db = require('../db/pool');
const fs = require('fs');
const path = require('path');

function readSQL(file) {
  return fs.readFileSync(path.join(__dirname, '../db/sql/carros', file), 'utf8');
}

exports.stats = async ({ desde=null, hasta=null }) => {
  const sql = readSQL('stats.sql');     // SELECT ... usando tus CTE/vistas
  const { rows } = await db.query(sql, [desde, hasta]);
  return rows[0] || null;
};
