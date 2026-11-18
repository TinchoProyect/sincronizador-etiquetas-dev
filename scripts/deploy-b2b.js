const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const B2B_DIR = path.join(ROOT_DIR, 'b2b-portal');

function parseEnvFileSafe(filePath) {
    try {
        if (!fs.existsSync(filePath)) return {};
        return dotenv.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return {};
    }
}

function esUrlValidaProduccion(u) {
    const val = String(u || '').trim();
    if (!val) return false;
    if (val.includes('127.0.0.1') || val.includes('localhost') || val.includes('59999')) return false;
    return val.startsWith('https://');
}

const rootEnv = parseEnvFileSafe(path.join(ROOT_DIR, '.env'));
const origEnv = parseEnvFileSafe(path.join(ROOT_DIR, '.env.original_deposito'));
const b2bEnv = parseEnvFileSafe(path.join(B2B_DIR, '.env'));
const b2bProdEnv = parseEnvFileSafe(path.join(B2B_DIR, '.env.production'));

const prodSupabaseUrl = [
    process.env.VITE_SUPABASE_URL,
    b2bProdEnv.VITE_SUPABASE_URL,
    b2bEnv.VITE_SUPABASE_URL,
    rootEnv.SUPABASE_B2B_URL,
    origEnv.SUPABASE_B2B_URL
].find(esUrlValidaProduccion) || '';

const prodSupabaseAnonKey = [
    process.env.VITE_SUPABASE_ANON_KEY,
    b2bProdEnv.VITE_SUPABASE_ANON_KEY,
    b2bEnv.VITE_SUPABASE_ANON_KEY,
    rootEnv.SUPABASE_B2B_ANON_KEY,
    origEnv.SUPABASE_B2B_ANON_KEY
].map(v => String(v || '').trim()).find(v => v && v !== 'lab-offline-anon-key' && v !== 'modo_laboratorio_desconectado') || '';

const prodApiBaseUrl = [
    process.env.VITE_API_BASE_URL,
    b2bProdEnv.VITE_API_BASE_URL,
    b2bEnv.VITE_API_BASE_URL,
    rootEnv.PUBLIC_BASE_URL,
    origEnv.PUBLIC_BASE_URL,
    'https://logistica.lamdaser.com'
].find(esUrlValidaProduccion) || 'https://logistica.lamdaser.com';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || rootEnv.CLOUDFLARE_ACCOUNT_ID || origEnv.CLOUDFLARE_ACCOUNT_ID || '';
const workersToken = process.env.CLOUDFLARE_WORKERS_TOKEN || rootEnv.CLOUDFLARE_WORKERS_TOKEN || origEnv.CLOUDFLARE_WORKERS_TOKEN || '';

if (!prodSupabaseUrl || !prodSupabaseAnonKey) {
    console.error('❌ [B2B-DEPLOY] Faltan credenciales productivas VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (ni en .env ni en .env.original_deposito). Se aborta para no subir un bundle desconectado.');
    process.exit(1);
}

console.log('🔨 Compilando Portal B2B con configuración de PRODUCCIÓN...');
console.log('   • Supabase URL:', prodSupabaseUrl);
console.log('   • API Base URL:', prodApiBaseUrl);

const buildEnv = {
    ...process.env,
    VITE_SUPABASE_URL: prodSupabaseUrl,
    VITE_SUPABASE_ANON_KEY: prodSupabaseAnonKey,
    VITE_API_BASE_URL: prodApiBaseUrl
};

const buildRes = spawnSync('npm', ['run', 'build'], {
    cwd: B2B_DIR,
    env: buildEnv,
    stdio: 'inherit',
    shell: true
});

if (buildRes.status !== 0) {
    console.error('❌ [B2B-DEPLOY] Falló la compilación de b2b-portal.');
    process.exit(buildRes.status || 1);
}

// Verificación de integridad del bundle compilado antes de subir a Cloudflare
const assetsDir = path.join(B2B_DIR, 'dist', 'assets');
const jsFiles = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir).filter(f => f.startsWith('index-') && f.endsWith('.js'))
    : [];

if (jsFiles.length === 0) {
    console.error('❌ [B2B-DEPLOY] No se encontró dist/assets/index-*.js tras compilar.');
    process.exit(1);
}

const bundleContent = fs.readFileSync(path.join(assetsDir, jsFiles[0]), 'utf8');
if (!bundleContent.includes(prodSupabaseUrl) || !bundleContent.includes(prodSupabaseAnonKey)) {
    console.error('❌ [B2B-DEPLOY] Candado de seguridad: el bundle compilado NO contiene las credenciales productivas de Supabase. Se aborta la subida.');
    process.exit(1);
}
console.log(`✅ [B2B-DEPLOY] Bundle productivo verificado (${jsFiles[0]}).`);

if (process.argv.includes('--build-only')) {
    process.exit(0);
}

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

const nodeMajor = parseInt(String(process.versions.node || '18').split('.')[0], 10) || 18;
const wranglerPkg = nodeMajor >= 22 ? 'wrangler' : 'wrangler@3.114.17';

let result = spawnSync('npx', ['--yes', wranglerPkg, 'deploy'], {
    cwd: B2B_DIR,
    env: env,
    stdio: 'inherit',
    shell: true
});

if (result.status !== 0 && !workersToken) {
    console.log('\n🔑 Sesión OAuth de Wrangler expirada o no iniciada en este equipo. Abriendo autorización en el navegador...');
    const loginRes = spawnSync('npx', ['--yes', wranglerPkg, 'login'], {
        cwd: B2B_DIR,
        env: env,
        stdio: 'inherit',
        shell: true
    });
    if (loginRes.status === 0) {
        console.log('🚀 Reintentando despliegue tras iniciar sesión...');
        result = spawnSync('npx', ['--yes', wranglerPkg, 'deploy'], {
            cwd: B2B_DIR,
            env: env,
            stdio: 'inherit',
            shell: true
        });
    }
}

if (result.status === 0) {
    console.log('🎉 Despliegue completado exitosamente en Cloudflare.');
} else {
    console.error('❌ Error en despliegue. Código:', result.status);
    process.exit(result.status || 1);
}
