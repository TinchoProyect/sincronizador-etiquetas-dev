#!/usr/bin/env node
/**
 * Guardián de Túnel Cloudflare para Sistema LAMDA
 * -----------------------------------------------
 * En Producción (PcAlmacen, DB_NAME=etiquetas), levanta el túnel oficial de Cloudflare.
 * En Modo Laboratorio / Notebook (DB_NAME=etiquetas_pruebas o LAMDA_MODO_LABORATORIO=true),
 * bloquea el túnel público para jamás secuestrar `logistica.lamdaser.com` desde pruebas,
 * manteniendo el proceso vivo para no interrumpir `concurrently --kill-others-on-fail`.
 */

require('dotenv').config();
const fs = require('fs');
const { spawn } = require('child_process');

const CLOUDFLARED_BIN = 'C:\\Cloudflared\\cloudflared.exe';
const TUNNEL_ID = 'd72f6c10-9fdc-4130-a0fb-ebadefb7006b';

const isModoLaboratorio =
    String(process.env.DB_NAME || '').trim().toLowerCase() === 'etiquetas_pruebas' ||
    String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase() === 'true';

if (isModoLaboratorio) {
    console.log('🔒 [CLOUDFLARED-GUARD] MODO LABORATORIO ACTIVO: Túnel público Cloudflare desactivado por seguridad para no interferir con Producción (logistica.lamdaser.com).');
    setInterval(() => {}, 60 * 60 * 1000);
} else if (!fs.existsSync(CLOUDFLARED_BIN)) {
    console.log(`ℹ️ [CLOUDFLARED-GUARD] Binario ${CLOUDFLARED_BIN} no encontrado en este equipo. Operando en modo local sin túnel público.`);
    setInterval(() => {}, 60 * 60 * 1000);
} else {
    console.log('🌐 [CLOUDFLARED] Iniciando túnel oficial LAMDA...');
    const child = spawn(CLOUDFLARED_BIN, ['tunnel', 'run', TUNNEL_ID], { stdio: 'inherit' });
    child.on('exit', (code) => {
        process.exit(code || 0);
    });
}
