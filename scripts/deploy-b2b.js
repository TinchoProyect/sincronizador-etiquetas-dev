const path = require('path');
const dotenv = require('dotenv');
const { spawnSync } = require('child_process');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const workersToken = process.env.CLOUDFLARE_WORKERS_TOKEN || '';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

console.log('🚀 Desplegando Portal B2B a Cloudflare Workers...');
console.log('Account ID:', accountId);

const env = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: accountId
};

// Nota: CLOUDFLARE_API_TOKEN en .env corresponde a GraphQL Analytics (solo lectura).
// Si no existe CLOUDFLARE_WORKERS_TOKEN específico, limpiamos CLOUDFLARE_API_TOKEN
// para que Wrangler utilice la sesión OAuth de `npx wrangler login` (default.toml).
if (workersToken) {
    env.CLOUDFLARE_API_TOKEN = workersToken;
} else {
    delete env.CLOUDFLARE_API_TOKEN;
}

const result = spawnSync('npx', ['wrangler', 'deploy'], {
    cwd: path.join(__dirname, '..', 'b2b-portal'),
    env: env,
    stdio: 'inherit',
    shell: true
});

if (result.status === 0) {
    console.log('🎉 Despliegue completado exitosamente en Cloudflare.');
} else {
    console.error('❌ Error en despliegue. Código:', result.status);
    process.exit(result.status);
}
