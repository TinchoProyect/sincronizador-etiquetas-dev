const path = require('path');
const dotenv = require('dotenv');
const { spawnSync } = require('child_process');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

console.log('🚀 Desplegando Portal B2B a Cloudflare Workers...');
console.log('Account ID:', accountId);
console.log('Token disponible:', !!token);

if (!token) {
    console.error('❌ Falta CLOUDFLARE_API_TOKEN en .env');
    process.exit(1);
}

const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: token,
    CLOUDFLARE_ACCOUNT_ID: accountId
};

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
