/**
 * Diagnóstico de Domicilios
 * Script para verificar estructura de tablas y tipos de datos
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

/**
 * Verificar estructura de clientes_domicilios
 */
router.get('/estructura-domicilios', async (req, res) => {
    try {
        const query = `
            SELECT 
                column_name,
                data_type,
                character_maximum_length,
                is_nullable
            FROM information_schema.columns
            WHERE table_name = 'clientes_domicilios'
            ORDER BY ordinal_position;
        `;
        
        const result = await pool.query(query);
        
        res.json({
            success: true,
            tabla: 'clientes_domicilios',
            columnas: result.rows
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Verificar estructura de clientes
 */
router.get('/estructura-clientes', async (req, res) => {
    try {
        const query = `
            SELECT 
                column_name,
                data_type,
                character_maximum_length,
                is_nullable
            FROM information_schema.columns
            WHERE table_name = 'clientes'
            ORDER BY ordinal_position;
        `;
        
        const result = await pool.query(query);
        
        res.json({
            success: true,
            tabla: 'clientes',
            columnas: result.rows
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Probar query de domicilios con diferentes conversiones
 */
router.get('/test-query/:id_cliente', async (req, res) => {
    const { id_cliente } = req.params;
    
    const tests = [];
    
    // Test 1: Sin conversión
    try {
        const result1 = await pool.query(
            'SELECT COUNT(*) FROM clientes_domicilios WHERE id_cliente = $1',
            [id_cliente]
        );
        tests.push({ test: 'Sin conversión', success: true, count: result1.rows[0].count });
    } catch (error) {
        tests.push({ test: 'Sin conversión', success: false, error: error.message });
    }
    
    // Test 2: Con ::text
    try {
        const result2 = await pool.query(
            'SELECT COUNT(*) FROM clientes_domicilios WHERE id_cliente::text = $1',
            [id_cliente]
        );
        tests.push({ test: 'Con ::text', success: true, count: result2.rows[0].count });
    } catch (error) {
        tests.push({ test: 'Con ::text', success: false, error: error.message });
    }
    
    // Test 3: Con CAST
    try {
        const result3 = await pool.query(
            'SELECT COUNT(*) FROM clientes_domicilios WHERE CAST(id_cliente AS TEXT) = $1',
            [id_cliente]
        );
        tests.push({ test: 'Con CAST', success: true, count: result3.rows[0].count });
    } catch (error) {
        tests.push({ test: 'Con CAST', success: false, error: error.message });
    }
    
    // Test 4: Convertir parámetro a integer
    try {
        const result4 = await pool.query(
            'SELECT COUNT(*) FROM clientes_domicilios WHERE id_cliente = $1::integer',
            [id_cliente]
        );
        tests.push({ test: 'Parámetro ::integer', success: true, count: result4.rows[0].count });
    } catch (error) {
        tests.push({ test: 'Parámetro ::integer', success: false, error: error.message });
    }
    
    res.json({
        success: true,
        id_cliente_recibido: id_cliente,
        tipo_recibido: typeof id_cliente,
        tests: tests
    });
});

module.exports = router;
