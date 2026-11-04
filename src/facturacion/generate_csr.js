const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

function generateCSR() {
    try {
        console.log('====================================================');
        console.log('LAMDA - GENERADOR DE CREDENCIALES PARA ARCA / AFIP');
        console.log('====================================================\n');
        
        const cuit = '23248921749';
        const commonName = 'LAMDA';
        const organizationName = 'LAMDA';
        const countryName = 'AR';
        
        console.log(`CUIT: ${cuit}`);
        console.log(`Nombre Común (CN): ${commonName}`);
        console.log(`Organización (O): ${organizationName}`);
        console.log(`País (C): ${countryName}`);
        console.log(`Subject Completo: C=AR, O=LAMDA, CN=LAMDA, serialNumber=CUIT ${cuit}\n`);
        
        // 1. Generar par de claves RSA de 2048 bits
        console.log('1. Generando par de claves RSA de 2048 bits (esto puede demorar unos segundos)...');
        const keys = forge.pki.rsa.generateKeyPair(2048);
        const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
        console.log('✔ Clave privada generada.');

        // 2. Crear solicitud de firma de certificado (CSR)
        console.log('2. Creando solicitud de firma de certificado (CSR)...');
        const csr = forge.pki.createCertificationRequest();
        csr.publicKey = keys.publicKey;
        
        // Cargar atributos del subject
        const attrs = [
            { name: 'commonName', value: commonName },
            { name: 'countryName', value: countryName },
            { name: 'organizationName', value: organizationName },
            { name: 'serialNumber', value: `CUIT ${cuit}` } // AFIP requiere este formato exacto
        ];
        
        csr.setSubject(attrs);
        
        // Firmar el CSR con la clave privada
        csr.sign(keys.privateKey);
        
        // Convertir a formato PEM
        const csrPem = forge.pki.certificationRequestToPem(csr);
        console.log('✔ Solicitud CSR generada y firmada.');

        // 3. Escribir archivos en la carpeta de certificados
        const certsDir = path.join(__dirname, 'certs');
        if (!fs.existsSync(certsDir)) {
            fs.mkdirSync(certsDir, { recursive: true });
        }
        
        const keyPath = path.join(certsDir, 'prod-key.pem');
        const csrPath = path.join(certsDir, 'prod.csr');
        
        fs.writeFileSync(keyPath, privateKeyPem, 'utf8');
        fs.writeFileSync(csrPath, csrPem, 'utf8');
        
        console.log('\n====================================================');
        console.log('🎉 PROCESO COMPLETADO CON ÉXITO');
        console.log('====================================================');
        console.log(`✔ Clave Privada guardada en: ${keyPath}`);
        console.log(`✔ Solicitud CSR guardada en: ${csrPath}`);
        console.log('\n👉 PASOS SIGUIENTES PARA EL USUARIO:');
        console.log('1. Descargue el archivo "prod.csr" generado.');
        console.log('2. Ingrese al portal de AFIP (https://www.afip.gob.ar/) con Clave Fiscal.');
        console.log('3. Acceda al servicio "Administración de Certificados Digitales".');
        console.log('4. Cargue el archivo "prod.csr" para generar su certificado de producción.');
        console.log('5. Descargue el certificado generado por AFIP y guardelo en la carpeta "certs/" como "prod-cert.pem".');
        console.log('====================================================\n');
        
    } catch (error) {
        console.error('❌ Error al generar credenciales:', error);
    }
}

generateCSR();
