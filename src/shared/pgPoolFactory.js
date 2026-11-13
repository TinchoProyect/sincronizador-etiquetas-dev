require('dotenv').config();
const { Pool } = require('pg');

const SHARED_POOLS_SYMBOL = Symbol.for('lamda.sharedPgPools');

function getPoolStore() {
    if (!globalThis[SHARED_POOLS_SYMBOL]) {
        globalThis[SHARED_POOLS_SYMBOL] = new Map();
    }
    return globalThis[SHARED_POOLS_SYMBOL];
}

function resolvePoolMax(defaultMax = 10) {
    const envMax = Number(process.env.DB_POOL_MAX);
    if (Number.isFinite(envMax) && envMax > 0) {
        return Math.floor(envMax);
    }
    const fallback = Number(defaultMax);
    return Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 10;
}

function getSharedPool(options = {}) {
    const user = options.user || process.env.DB_USER || 'postgres';
    const host = options.host || process.env.DB_HOST || 'localhost';
    const database = options.database || process.env.DB_NAME || 'etiquetas';
    const password = options.password || process.env.DB_PASSWORD || 'ta3Mionga';
    const port = parseInt(options.port || process.env.DB_PORT || '5432', 10);
    const max = resolvePoolMax(options.defaultMax || options.max || 10);
    const idleTimeoutMillis = Number.isFinite(Number(options.idleTimeoutMillis))
        ? Number(options.idleTimeoutMillis)
        : 30000;
    const connectionTimeoutMillis = Number.isFinite(Number(options.connectionTimeoutMillis))
        ? Number(options.connectionTimeoutMillis)
        : 10000;
    const statementTimeoutEnv = Number(process.env.DB_STATEMENT_TIMEOUT_MS);
    const statementTimeout = Number.isFinite(Number(options.statement_timeout))
        ? Number(options.statement_timeout)
        : (Number.isFinite(statementTimeoutEnv) && statementTimeoutEnv > 0 ? statementTimeoutEnv : 30000);

    const store = getPoolStore();
    const key = `${user}@${host}:${port}/${database}`;
    if (store.has(key)) {
        return store.get(key);
    }

    const pool = new Pool({
        user,
        host,
        database,
        password,
        port,
        max,
        idleTimeoutMillis,
        connectionTimeoutMillis,
        statement_timeout: statementTimeout
    });

    pool.on('error', (err) => {
        console.error(`⚠️ [DB-POOL:${database}] Error inesperado en cliente inactivo:`, err.message);
    });

    store.set(key, pool);
    return pool;
}

module.exports = {
    getSharedPool,
    resolvePoolMax
};
