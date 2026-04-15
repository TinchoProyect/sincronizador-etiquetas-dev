const { Pool } = require('pg'); 
require('dotenv').config(); 
const pool = new Pool({ connectionString: 'postgres://postgres:ta3Mionga@localhost:5432/etiquetas' }); 
pool.query(`
SELECT rc.delete_rule, kcu.table_name
FROM information_schema.referential_constraints rc 
JOIN information_schema.key_column_usage kcu ON rc.constraint_name = kcu.constraint_name 
WHERE kcu.table_name IN ('ordenes_tratamiento_detalles', 'entregas_eventos');
`).then(r => console.log(r.rows)).catch(e=>console.error(e)).finally(() => pool.end());
