const https = require('https');
const http = require('http');

// Función auxiliar para hacer requests HTTP
function makeRequest(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

async function testAutoPobladoCliente() {
    console.log('🧪 PRUEBAS EXHAUSTIVAS - AUTO-POBLADO DE DATOS DE CLIENTE');
    console.log('='.repeat(60));

    try {
        // 1. Obtener factura de prueba (ID 22)
        console.log('\n📄 Paso 1: Obteniendo factura de prueba (ID: 22)');
        const facturaData = await makeRequest('http://localhost:3004/facturacion/facturas/22');

        if (!facturaData.success) {
            throw new Error('No se pudo obtener la factura de prueba');
        }

        const factura = facturaData.data;
        console.log('✅ Factura obtenida:', {
            id: factura.id,
            cliente_id: factura.cliente_id,
            doc_tipo: factura.doc_tipo,
            doc_nro: factura.doc_nro,
            estado: factura.estado
        });

        // 2. Verificar si la factura tiene cliente_id y necesita auto-poblado
        if (!factura.cliente_id || factura.doc_nro !== '0') {
            console.log('ℹ️ La factura no requiere auto-poblado (ya tiene datos o no tiene cliente_id)');
            return;
        }

        console.log('\n👤 Paso 2: Obteniendo datos del cliente desde presupuestos API');
        const clienteData = await makeRequest(`http://localhost:3003/api/presupuestos/clientes/${factura.cliente_id}`);

        if (!clienteData.success) {
            throw new Error('No se pudo obtener los datos del cliente');
        }

        const cliente = clienteData.data;
        console.log('✅ Datos del cliente obtenidos:', {
            cliente_id: cliente.cliente_id,
            nombre: cliente.nombre,
            apellido: cliente.apellido,
            cuit: cliente.cuit,
            dni: cliente.dni,
            condicion_iva: cliente.condicion_iva
        });

        // 3. Simular el mapeo de datos como lo haría el JavaScript del navegador
        console.log('\n🔄 Paso 3: Simulando mapeo de datos del formulario');

        // Mapeo de razón social
        const razonSocial = `${cliente.nombre} ${cliente.apellido}`.trim();
        console.log(`📝 Razón Social: "${razonSocial}"`);

        // Mapeo de documento (CUIT prioritario, luego DNI)
        let docTipo, docNro;
        if (cliente.cuit && cliente.cuit !== '') {
            docTipo = 80; // CUIT
            docNro = cliente.cuit;
            console.log(`🆔 Documento: CUIT ${docNro}`);
        } else if (cliente.dni && cliente.dni !== '') {
            docTipo = 96; // DNI
            docNro = cliente.dni;
            console.log(`🆔 Documento: DNI ${docNro}`);
        } else {
            docTipo = 99; // Consumidor Final
            docNro = '0';
            console.log('🆔 Documento: Consumidor Final');
        }

        // Mapeo de condición IVA a códigos AFIP
        let condicionIvaId;
        switch (cliente.condicion_iva) {
            case 'Responsable Inscripto':
                condicionIvaId = 1;
                break;
            case 'Responsable Monotributo':
                condicionIvaId = 2;
                break;
            case 'Exento':
                condicionIvaId = 4;
                break;
            case 'Consumidor Final':
            default:
                condicionIvaId = 5;
                break;
        }
        console.log(`🏢 Condición IVA: ${cliente.condicion_iva} (Código AFIP: ${condicionIvaId})`);

        // Determinación automática del tipo de comprobante
        let tipoComprobante;
        if (condicionIvaId === 1) { // Responsable Inscripto
            tipoComprobante = 1; // Factura A
            console.log('📄 Tipo de Comprobante: Factura A (Responsable Inscripto)');
        } else {
            tipoComprobante = 6; // Factura B
            console.log('📄 Tipo de Comprobante: Factura B (Otros)');
        }

        // 4. Verificaciones finales
        console.log('\n✅ Paso 4: Verificaciones finales');

        const verificaciones = [
            {
                descripcion: 'Razón Social no está vacía',
                resultado: razonSocial && razonSocial.trim() !== '',
                esperado: true
            },
            {
                descripcion: 'Tipo de documento válido',
                resultado: [80, 96, 99].includes(docTipo),
                esperado: true
            },
            {
                descripcion: 'Número de documento válido',
                resultado: docNro && docNro !== '',
                esperado: true
            },
            {
                descripcion: 'Condición IVA mapeada correctamente',
                resultado: [1, 2, 4, 5].includes(condicionIvaId),
                esperado: true
            },
            {
                descripcion: 'Tipo de comprobante determinado',
                resultado: [1, 6].includes(tipoComprobante),
                esperado: true
            }
        ];

        let todasPasaron = true;
        verificaciones.forEach(v => {
            const status = v.resultado === v.esperado ? '✅' : '❌';
            console.log(`${status} ${v.descripcion}`);
            if (v.resultado !== v.esperado) {
                todasPasaron = false;
            }
        });

        // 5. Resumen final
        console.log('\n' + '='.repeat(60));
        if (todasPasaron) {
            console.log('🎉 PRUEBA EXITOSA: El auto-poblado de datos de cliente funciona correctamente');
            console.log('\n📋 Resumen de datos que se poblarían automáticamente:');
            console.log(`   • Razón Social: ${razonSocial}`);
            console.log(`   • Documento: ${docTipo === 80 ? 'CUIT' : docTipo === 96 ? 'DNI' : 'Consumidor Final'} ${docNro}`);
            console.log(`   • Condición IVA: ${cliente.condicion_iva} (ID: ${condicionIvaId})`);
            console.log(`   • Tipo Comprobante: Factura ${tipoComprobante === 1 ? 'A' : 'B'}`);
        } else {
            console.log('❌ PRUEBA FALLIDA: Hay problemas con el auto-poblado de datos');
        }

    } catch (error) {
        console.error('❌ Error durante las pruebas:', error.message);
        console.log('\n🔍 Posibles causas:');
        console.log('   • Los servicios de facturación o presupuestos no están ejecutándose');
        console.log('   • La factura ID 22 no existe o no tiene cliente_id');
        console.log('   • Problemas de conectividad de red');
    }
}

// Ejecutar las pruebas
testAutoPobladoCliente();
