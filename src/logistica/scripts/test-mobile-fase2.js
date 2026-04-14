require('dotenv').config({ path: '../../.env' }); // Adjust relative path if needed, fallback down below.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../../.env.test') }); // Load whatever is local

const { pool } = require('../config/database');
const TratamientosModel = require('../models/tratamientosModel');
const os = require('os');

async function bootTest() {
    console.log("=======================================================");
    console.log("🛠️ GENERADOR DE PRUEBAS MÓVILES - FASE 2 LAMDA");
    console.log("=======================================================\n");
    console.log("Inyectando sesión efímera determinista en base de datos...");

    try {
        // Obtenemos el TPLink DNS si está en .env o caemos en el estándar de la infraestructura.
        const ddnstBaseUrl = process.env.PUBLIC_BASE_URL || 'http://lamda-logistica.tplinkdns.com:3005';

        // 1. Instanciamos la sesion. Requerimos Id cliente genérico de prueba (ej. 1)
        const orden = await TratamientosModel.crearQRPreCheckIn(1);

        // 2. Construimos la URL
        const testUrl = `${ddnstBaseUrl}/pages/tratamiento-checkin.html?hash=${orden.codigo_qr_hash}`;
        const lanIp = obtenerIpLan();
        const lanUrl = `http://${lanIp}:3005/pages/tratamiento-checkin.html?hash=${orden.codigo_qr_hash}`;
        
        // 3. Generamos Enlace a QR Imprimible (Via API pública rápida para escanear en PC)
        const qrGeneradorApi = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(testUrl)}`;

        console.log("\n✅ SESIÓN CREADA CORRECTAMENTE.");
        console.log(`- ID: ${orden.id}`);
        console.log(`- Hash Asignado: ${orden.codigo_qr_hash}\n`);

        console.log("-------------------------------------------------------");
        console.log("📱 OPCIÓN 1: Ingreso Remoto (Red 4G Móvil / Exterior del local)");
        console.log("Abre este enlace desde tu celular o escanea el QR:");
        console.log(`🌐 Enlace directo: \x1b[36m${testUrl}\x1b[0m`);
        console.log(`📷 Generador QR (Abre esto en la PC y escanea la pantalla con el celular): \n\x1b[33m${qrGeneradorApi}\x1b[0m`);
        
        console.log("\n-------------------------------------------------------");
        console.log("🏠 OPCIÓN 2: Ingreso LAN (Dispositivo conectado al mismo Wi-Fi de la Empresa)");
        console.log("Si el router no permitiese loopback de DDNS desde adentro, usa la IP Local:");
        console.log(`🌐 Lan URL: \x1b[32m${lanUrl}\x1b[0m`);
        console.log("-------------------------------------------------------\n");
        console.log("⚠️  Asegúrate de que npm start (o logistica) esté corriendo en el servidor host para resolver el tráfico entrante.");
        
    } catch (error) {
        console.error("❌ Falla crítica al inyectar sesión de prueba:", error);
    } finally {
        pool.end();
        process.exit();
    }
}

function obtenerIpLan() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '192.168.1.X';
}

bootTest();
