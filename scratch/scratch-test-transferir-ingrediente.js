const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
    const client = await pool.connect();
    try {
        console.log('🏁 INICIANDO SIMULACIÓN DE TRANSFERENCIA A INGREDIENTES...');
        await client.query('BEGIN');

        // Datos del payload
        const articulo = '3256419852'; // Código de barras de Avena x 5
        const ingrediente_id = '120'; // Avena Arrollada Gruesa in local DB
        const cantidad_real = 4.79;
        const unidades_origen = 0.957; // 4.785 / 5 = 0.957 u.
        const usuario = 'TEST_USER';
        
        let cantidadUnidades = parseFloat(unidades_origen || 0);
        let kilosUnidad = 1;
        let pesoTeoricoTotal = cantidadUnidades;

        // 1. Obtener Stock Actual en Mantenimiento para KilosPorUnidad y validaciones secundarias
        let articuloRealNumero = articulo;
        if (articulo && articulo !== 'null' && articulo !== '') {
            const stockQuery = `
                SELECT stock_mantenimiento, kilos_unidad, articulo_numero
                FROM public.stock_real_consolidado 
                WHERE articulo_numero = $1 OR codigo_barras = $1
                FOR UPDATE
            `;
            const resStock = await client.query(stockQuery, [articulo]);

            if (resStock.rows.length === 0) {
                throw new Error(`Artículo ${articulo} no encontrado en stock consolidado.`);
            }

            articuloRealNumero = resStock.rows[0].articulo_numero;
            console.log(`✅ Artículo resuelto a SKU real: ${articuloRealNumero}`);

            if (!cantidadUnidades || cantidadUnidades <= 0) {
                cantidadUnidades = parseFloat(resStock.rows[0].stock_mantenimiento || 0);
            }

            kilosUnidad = parseFloat(resStock.rows[0].kilos_unidad || 1);
            pesoTeoricoTotal = cantidadUnidades * kilosUnidad;

            if (cantidadUnidades <= 0) {
                throw new Error(`El artículo ${articuloRealNumero} no tiene stock asignado a transferir.`);
            }
        }

        const pesoIngreso = parseFloat(cantidad_real);
        const diferencia = pesoIngreso - pesoTeoricoTotal;
        console.log(`📊 Unidades a restar en mantenimiento: ${cantidadUnidades}`);
        console.log(`📊 Kilos reales ingresados: ${pesoIngreso}`);
        console.log(`📊 Peso teórico total: ${pesoTeoricoTotal}`);
        console.log(`📊 Diferencia (merma): ${diferencia}`);

        // 2. DAR DE BAJA EN MANTENIMIENTO
        const updateMantenimiento = `
            UPDATE public.stock_real_consolidado
            SET 
                stock_mantenimiento = GREATEST(0, stock_mantenimiento - $2),
                ultima_actualizacion = NOW()
            WHERE articulo_numero = $1
        `;
        const resUpdate = await client.query(updateMantenimiento, [articuloRealNumero, cantidadUnidades]);
        console.log(`✅ stock_real_consolidado actualizado. Filas afectadas: ${resUpdate.rowCount}`);

        // 3. DAR DE ALTA EN INGREDIENTES
        const updateIngrediente = `
            UPDATE ingredientes
            SET stock_actual = stock_actual + $1
            WHERE id = $2
            RETURNING nombre, stock_actual
        `;
        const resIng = await client.query(updateIngrediente, [pesoIngreso, ingrediente_id]);
        if (resIng.rowCount === 0) {
            throw new Error(`Ingrediente destino ${ingrediente_id} no encontrado.`);
        }
        console.log(`✅ Ingredientes actualizados. Nombre: ${resIng.rows[0].nombre}, Nuevo Stock: ${resIng.rows[0].stock_actual}`);

        console.log('🔄 Deshaciendo transacción (ROLLBACK)...');
        await client.query('ROLLBACK');
        console.log('🎉 Transacción simulada correctamente y revertida con éxito!');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR EN LA SIMULACIÓN:', e.message);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
