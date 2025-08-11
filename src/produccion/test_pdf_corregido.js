const express = require('express');
const { imprimirPresupuestoCliente } = require('./controllers/impresionPresupuestos');

console.log('🧪 [TEST-PDF-CORREGIDO] Iniciando test de PDF con fuentes corregidas...');

// Simular req y res
const mockReq = {
    query: {
        cliente_id: '34',
        formato: 'pdf'
    }
};

const mockRes = {
    status: (code) => {
        console.log(`📊 [TEST] Status: ${code}`);
        return mockRes;
    },
    json: (data) => {
        console.log('📄 [TEST] JSON Response:', JSON.stringify(data, null, 2));
        return mockRes;
    },
    setHeader: (name, value) => {
        console.log(`📋 [TEST] Header: ${name} = ${value}`);
        return mockRes;
    },
    send: (data) => {
        console.log(`✅ [TEST] PDF generado exitosamente! Tamaño: ${data.length || 'N/A'} bytes`);
        return mockRes;
    }
};

// Ejecutar test
imprimirPresupuestoCliente(mockReq, mockRes)
    .then(() => {
        console.log('🎉 [TEST-PDF-CORREGIDO] Test completado exitosamente!');
    })
    .catch((error) => {
        console.error('❌ [TEST-PDF-CORREGIDO] Error en test:', error);
    });
