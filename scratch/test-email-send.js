const path = require('path');
// Cargar .env de facturación
require('dotenv').config({ path: path.join(__dirname, '../src/facturacion/.env'), override: true });

const emailService = require('../src/facturacion/services/emailService');
const { generarPDF } = require('../src/facturacion/pdf/generador');

async function testSend() {
    console.log('🚀 Iniciando script de prueba de envío de correo...');
    console.log(`📧 Egresor configurado (GMAIL_USER): ${process.env.GMAIL_USER || 'No definido (default: miserrano75@gmail.com)'}`);
    console.log(`🔑 Contraseña de aplicación configurada (GMAIL_APP_PASSWORD): ${process.env.GMAIL_APP_PASSWORD ? 'SÍ (ocultada por seguridad)' : 'NO'}`);

    if (!process.env.GMAIL_APP_PASSWORD) {
        console.error('❌ ERROR: GMAIL_APP_PASSWORD no está configurada en el archivo src/facturacion/.env.');
        console.error('Por favor, configure la variable en el entorno antes de correr el test.');
        process.exit(1);
    }

    const destinatarioTest = 'belgiancitybell@gmail.com';
    console.log(`✉️ Destinatario de prueba: ${destinatarioTest}`);

    // Mock de factura detallado para generar un PDF válido
    const facturaMock = {
        id: 9999,
        razon_social: 'Belgian City Bell S.A.',
        tipo_cbte: 1, // Factura A
        fecha_emision: new Date().toISOString(),
        imp_total: 15430.50,
        cae: '74123456789012',
        cae_fch_vto: '2026-07-15',
        pto_vta: 32,
        cbte_nro: 305,
        tipo_doc: 80, // CUIT
        nro_doc: '30712345678',
        condicion_iva: 'Responsable Inscripto',
        forma_pago: 'Cuenta Corriente',
        imp_neto: 12752.48,
        imp_op_ex: 0,
        imp_trib: 0,
        imp_tot_conc: 0,
        imp_iva: 2678.02
    };

    const itemsMock = [
        {
            codigo: 'ART-0001',
            descripcion: 'Etiquetas Autoadhesivas Térmicas 30x10',
            cantidad: 10,
            unidad_medida: 7, // unidades
            precio_unitario: 1275.25,
            bonificacion: 0,
            imp_neto: 12752.48,
            alicuota_iva: 21,
            imp_iva: 2678.02,
            subtotal: 15430.50
        }
    ];

    try {
        console.log('📄 Generando PDF real de prueba...');
        const realPdfBuffer = await generarPDF(facturaMock, itemsMock);
        console.log(`✅ PDF generado con éxito (Tamaño: ${realPdfBuffer.length} bytes).`);

        const nroComprobante = '0032-00000305';
        const res = await emailService.enviarFacturaPdf(facturaMock, realPdfBuffer, destinatarioTest, nroComprobante);
        console.log('✅ ENVÍO REALIZADO CON ÉXITO!');
        console.log('Respuesta del servicio:', res);
        
        // Forzar salida para cerrar cualquier pool de pg abierto en generador.js
        process.exit(0);
    } catch (error) {
        console.error('❌ ERROR al enviar el correo:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

testSend();
