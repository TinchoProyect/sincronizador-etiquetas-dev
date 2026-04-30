const fs = require('fs');
let content = fs.readFileSync('src/produccion/controllers/mantenimiento.js', 'utf8');

const regex = /const buscarOrdenRetiro = async \(req, res\) => \{\r?\n\s*try \{\r?\n\s*const \{ idFactura, articulo \} = req\.params;/;
const replacement = `const buscarOrdenRetiro = async (req, res) => {
    try {
        const { idFactura, articulo } = req.params;

        // [TICKET 028] Bugfix: Si el idFactura YA ES una Orden de Retiro, devolverlo directamente
        const checkSelf = await pool.query(\`
            SELECT id as id_orden_retiro
            FROM public.presupuestos
            WHERE id = $1 AND (tipo_comprobante = 'Orden de Retiro' OR estado = 'Orden de Retiro')
            LIMIT 1
        \`, [idFactura]);

        if (checkSelf.rows.length > 0) {
            return res.json({ success: true, id_orden_retiro: checkSelf.rows[0].id_orden_retiro });
        }
`;

content = content.replace(regex, replacement);
fs.writeFileSync('src/produccion/controllers/mantenimiento.js', content, 'utf8');
console.log('REPLACED');
