'use strict';

/**
 * ============================================================================
 * SERVICIO DE COBROS POR TRANSFERENCIA BANCARIA (BANCO GALICIA),
 * AVISOS DECLARATIVOS EN TRAMOS Y CONCILIADOR BANCARIO HÍBRIDO DE NODOS
 * ============================================================================
 * - Fuente única de cobro oficial: Banco Galicia (`LAMDA.SER.MARTIN` / CBU `0070373230004007844141` /
 *   Titular `Martín Ignacio Serrano` / CUIL `23-24892174-9` / Cuenta `400784413734`),
 *   vinculada a `public.fin_cuentas_bancarias` y `public.nodos_configuracion_canal (id = 1)`.
 * - Separa estrictamente la pista declarativa del comprador (`public.nodos_pedidos_avisos_pago`)
 *   de la acreditación empírica real en extracto bancario (`public.nodos_pedidos_cobros_banco` <-> `fin_movimientos_bancarios`).
 * - Soporta relación N:M controlada:
 *     * N transferencias parciales (o de cuentas de terceros) -> 1 pedido grande.
 *     * 1 transferencia grande -> M pedidos abiertos del mismo comprador (`SUM(monto_aplicado) <= credito`).
 * - Libera mercadería a `/deposito-nodos` únicamente cuando `monto_acreditado_banco >= total_vecino`
 *   (`CONCILIADO_BANCO_LAMDA`), reasignando limpiamente el canasto en nodos vecinales si el lote original ya cerró.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const cuentasBancariasService = require('../../facturacion/services/cuentasBancariasService');
const {
    agregarReferenciaNodoADescripcion
} = require('../../shared/nodosCuentaUnificadaHelper');

let invocarGemini25Flash = null;
try {
    ({ invocarGemini25Flash } = require('../../services/whatsappAgenteHibridoLlmService'));
} catch (_) {
    invocarGemini25Flash = null;
}

const CUENTA_OFICIAL_GALICIA_DEFAULT = Object.freeze({
    banco_recaudador: 'Banco Galicia',
    banco_fin_nombre: 'Banco de Galicia y Buenos Aires S.A.U (CUIT: 30-50000173-5)',
    alias_recaudador: 'LAMDA.SER.MARTIN',
    cbu_recaudador: '0070373230004007844141',
    titular_recaudador: 'Martín Ignacio Serrano',
    titular_fin_nombre: 'MARTIN IGNACIO SERRANO (DU Nro. 24892174)',
    tipo_cuenta_fin: 'Caja de Ahorro en Pesos (CA $)',
    cuil_recaudador: '23-24892174-9',
    numero_cuenta_recaudador: '400784413734',
    solo_transferencia_bancaria: true
});

const MAX_COMPROBANTE_BYTES = 5 * 1024 * 1024; // 5 MB

let _esquemaPagosInicializado = false;

function esModoLaboratorioPagosNodos() {
    const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || process.env.MODO_LABORATORIO || '').trim().toLowerCase();
    const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
    return flagLab === 'true' || flagLab === '1' || dbName === 'etiquetas_pruebas';
}

function obtenerDirectorioComprobantesNodos() {
    if (esModoLaboratorioPagosNodos()) {
        if (process.env.NODOS_COMPROBANTES_DIR_LAB) {
            return path.resolve(process.env.NODOS_COMPROBANTES_DIR_LAB);
        }
        return path.join(process.cwd(), 'data', 'nodos-comprobantes');
    }
    if (process.env.NODOS_COMPROBANTES_DIR) {
        return path.resolve(process.env.NODOS_COMPROBANTES_DIR);
    }
    if (process.platform === 'win32') {
        return path.join(process.cwd(), 'data', 'nodos-comprobantes');
    }
    return '/opt/lamda/nodos-comprobantes';
}

/**
 * Valida magic bytes reales del archivo subido (JPG, PNG, WEBP o PDF) y límite de 5 MB.
 */
function validarBufferComprobantePago(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('El archivo adjunto está vacío.');
    }
    if (buffer.length > MAX_COMPROBANTE_BYTES) {
        throw new Error('El comprobante supera el tamaño máximo permitido de 5 MB.');
    }
    if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { mime: 'image/jpeg', ext: '.jpg' };
    }
    if (
        buffer.length >= 8 &&
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
        buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
    ) {
        return { mime: 'image/png', ext: '.png' };
    }
    if (
        buffer.length >= 12 &&
        buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
        buffer.slice(8, 12).toString('ascii') === 'WEBP'
    ) {
        return { mime: 'image/webp', ext: '.webp' };
    }
    if (buffer.length >= 5 && buffer.slice(0, 5).toString('ascii') === '%PDF-') {
        return { mime: 'application/pdf', ext: '.pdf' };
    }
    throw new Error('Formato de comprobante no admitido. Subí una imagen (JPG, PNG, WEBP) o archivo PDF de hasta 5 MB.');
}

function normalizarTextoComparacionBancaria(str = '') {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizarTelefonoSimple(raw = '') {
    const digits = String(raw || '').replace(/\D+/g, '');
    if (!digits) return '';
    if (digits.startsWith('549') && digits.length >= 12) return digits;
    if (digits.startsWith('54') && digits.length >= 11) return '549' + digits.slice(2);
    if (digits.startsWith('0')) return '549' + digits.slice(1);
    if (digits.length === 10) return '549' + digits;
    return digits;
}

/**
 * Calcula similitud por tokens entre dos nombres bancarios/personales (soporta "APELLIDO, NOMBRE" vs "Nombre Apellido").
 * Retorna score entre 0 y 1.
 */
function calcularSimilitudNombresBancarios(nombreA = '', nombreB = '') {
    const normA = normalizarTextoComparacionBancaria(nombreA);
    const normB = normalizarTextoComparacionBancaria(nombreB);
    if (!normA || !normB) return 0;
    if (normA === normB) return 1;
    if (normA.length >= 5 && normB.length >= 5 && (normA.includes(normB) || normB.includes(normA))) {
        return 0.92;
    }
    const stopWords = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'SRL', 'SA', 'SAS', 'SAU']);
    const toksA = normA.split(' ').filter(t => t.length >= 2 && !stopWords.has(t));
    const toksB = normB.split(' ').filter(t => t.length >= 2 && !stopWords.has(t));
    if (toksA.length === 0 || toksB.length === 0) return 0;

    let coincidencias = 0;
    for (const ta of toksA) {
        if (toksB.some(tb => tb === ta || (ta.length >= 4 && tb.length >= 4 && (tb.startsWith(ta) || ta.startsWith(tb))))) {
            coincidencias++;
        }
    }
    if (coincidencias === 0) return 0;
    const minLen = Math.min(toksA.length, toksB.length);
    const maxLen = Math.max(toksA.length, toksB.length);
    if (coincidencias >= 2 && coincidencias >= minLen) return 0.95;
    return Number(((coincidencias / maxLen) * 0.85 + (coincidencias / minLen) * 0.15).toFixed(3));
}

function esPedidoPagoConfirmadoNodos(ped = {}) {
    const estOp = String(ped.estado_operativo || '').toUpperCase();
    if (estOp === 'ANULADO') return false;
    const estPago = String(ped.estado_pago || '').toUpperCase();
    if (estPago === 'CONCILIADO_BANCO_LAMDA' || estPago === 'COBRADO_EFECTIVO_GESTOR') return true;
    if (Boolean(ped.impactado_cta_cte_pago)) return true;
    return false;
}

/**
 * Inicializa de forma 100% idempotente las tablas y columnas de cobros bancarios de Nodos,
 * asegura la cuenta oficial de Banco Galicia en `fin_cuentas_bancarias` y vincula `nodos_configuracion_canal (id = 1)`.
 */
async function asegurarEsquemaPagosBancariosNodos(runner = null, opciones = {}) {
    if (_esquemaPagosInicializado && !opciones.forzar && !runner) {
        return;
    }

    const ownClient = !runner;
    const client = runner || await db.connect();
    try {
        // 1. Asegurar tablas base financieras si aún no las inicializó facturación (:3004)
        await client.query(`
            CREATE TABLE IF NOT EXISTS public.fin_cuentas_bancarias (
                id SERIAL PRIMARY KEY,
                banco VARCHAR(150) NOT NULL,
                titular VARCHAR(150) NOT NULL,
                tipo_cuenta VARCHAR(100) NOT NULL,
                numero_cuenta VARCHAR(50) UNIQUE NOT NULL,
                cbu VARCHAR(22) UNIQUE NOT NULL,
                alias VARCHAR(100) NOT NULL,
                saldo NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA',
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS public.fin_movimientos_bancarios (
                id SERIAL PRIMARY KEY,
                cuenta_id INTEGER NOT NULL REFERENCES public.fin_cuentas_bancarias(id) ON DELETE CASCADE,
                fecha_movimiento TIMESTAMP NOT NULL,
                concepto VARCHAR(500) NOT NULL,
                tipo_operacion VARCHAR(50) NOT NULL DEFAULT 'Otros',
                debito NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                credito NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                referencia VARCHAR(150),
                saldo_resultante NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                hash_dedup VARCHAR(64) UNIQUE NOT NULL,
                cuit_extraido VARCHAR(20),
                referencia_operacion VARCHAR(100),
                cliente_id INTEGER,
                estado_clasificacion VARCHAR(30) DEFAULT 'AUTO',
                metadata_adicional JSONB,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Resolver o sembrar la cuenta oficial de Banco Galicia (CBU 0070373230004007844141 / Cuenta 400784413734)
        let galiciaRes = await client.query(
            `SELECT id, alias, cbu, numero_cuenta
             FROM public.fin_cuentas_bancarias
             WHERE cbu = $1 OR numero_cuenta = $2 OR UPPER(alias) = UPPER($3)
             ORDER BY id ASC
             LIMIT 1`,
            [
                CUENTA_OFICIAL_GALICIA_DEFAULT.cbu_recaudador,
                CUENTA_OFICIAL_GALICIA_DEFAULT.numero_cuenta_recaudador,
                CUENTA_OFICIAL_GALICIA_DEFAULT.alias_recaudador
            ]
        );
        let galiciaCuentaId = galiciaRes.rows[0]?.id ? Number(galiciaRes.rows[0].id) : null;

        if (!galiciaCuentaId) {
            const insGal = await client.query(
                `INSERT INTO public.fin_cuentas_bancarias (
                    banco, titular, tipo_cuenta, numero_cuenta, cbu, alias, saldo, estado
                 ) VALUES ($1, $2, $3, $4, $5, $6, 0.00, 'ACTIVA')
                 ON CONFLICT (cbu) DO UPDATE SET alias = EXCLUDED.alias
                 RETURNING id`,
                [
                    CUENTA_OFICIAL_GALICIA_DEFAULT.banco_fin_nombre,
                    CUENTA_OFICIAL_GALICIA_DEFAULT.titular_fin_nombre,
                    CUENTA_OFICIAL_GALICIA_DEFAULT.tipo_cuenta_fin,
                    CUENTA_OFICIAL_GALICIA_DEFAULT.numero_cuenta_recaudador,
                    CUENTA_OFICIAL_GALICIA_DEFAULT.cbu_recaudador,
                    CUENTA_OFICIAL_GALICIA_DEFAULT.alias_recaudador
                ]
            );
            galiciaCuentaId = Number(insGal.rows[0].id);
        }

        // 3. Extender nodos_configuracion_canal y nodos_maestro con campos bancarios completos
        await client.query(`
            ALTER TABLE public.nodos_configuracion_canal
                ADD COLUMN IF NOT EXISTS cuil_recaudador VARCHAR(30) DEFAULT '23-24892174-9',
                ADD COLUMN IF NOT EXISTS numero_cuenta_recaudador VARCHAR(50) DEFAULT '400784413734',
                ADD COLUMN IF NOT EXISTS solo_transferencia_bancaria BOOLEAN NOT NULL DEFAULT true;

            ALTER TABLE public.nodos_maestro
                ADD COLUMN IF NOT EXISTS banco_display VARCHAR(120) DEFAULT 'Banco Galicia',
                ADD COLUMN IF NOT EXISTS cuil_display VARCHAR(30) DEFAULT '23-24892174-9',
                ADD COLUMN IF NOT EXISTS numero_cuenta_display VARCHAR(50) DEFAULT '400784413734';
        `);

        // 4. Migrar idempotentemente nodos_configuracion_canal (id = 1) desde valores provisorios hacia Banco Galicia oficial
        await client.query(
            `INSERT INTO public.nodos_configuracion_canal (
                id, cuenta_bancaria_id, banco_recaudador, alias_recaudador, cbu_recaudador,
                titular_recaudador, cuil_recaudador, numero_cuenta_recaudador, solo_transferencia_bancaria, updated_at
             ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, true, NOW())
             ON CONFLICT (id) DO UPDATE SET
                cuenta_bancaria_id = COALESCE(public.nodos_configuracion_canal.cuenta_bancaria_id, EXCLUDED.cuenta_bancaria_id),
                banco_recaudador = CASE
                    WHEN public.nodos_configuracion_canal.banco_recaudador IS NULL
                      OR public.nodos_configuracion_canal.banco_recaudador ILIKE '%provisori%'
                      OR public.nodos_configuracion_canal.alias_recaudador = 'pago.canasto'
                    THEN EXCLUDED.banco_recaudador
                    ELSE public.nodos_configuracion_canal.banco_recaudador
                END,
                alias_recaudador = CASE
                    WHEN public.nodos_configuracion_canal.alias_recaudador IS NULL
                      OR public.nodos_configuracion_canal.alias_recaudador = ''
                      OR public.nodos_configuracion_canal.alias_recaudador = 'pago.canasto'
                    THEN EXCLUDED.alias_recaudador
                    ELSE public.nodos_configuracion_canal.alias_recaudador
                END,
                cbu_recaudador = CASE
                    WHEN public.nodos_configuracion_canal.cbu_recaudador IS NULL
                      OR public.nodos_configuracion_canal.cbu_recaudador = ''
                      OR public.nodos_configuracion_canal.cbu_recaudador = '0000000000000000000000'
                    THEN EXCLUDED.cbu_recaudador
                    ELSE public.nodos_configuracion_canal.cbu_recaudador
                END,
                titular_recaudador = CASE
                    WHEN public.nodos_configuracion_canal.titular_recaudador IS NULL
                      OR public.nodos_configuracion_canal.titular_recaudador ILIKE '%provisori%'
                      OR public.nodos_configuracion_canal.titular_recaudador ILIKE '%canal nodos%'
                    THEN EXCLUDED.titular_recaudador
                    ELSE public.nodos_configuracion_canal.titular_recaudador
                END,
                cuil_recaudador = COALESCE(NULLIF(TRIM(public.nodos_configuracion_canal.cuil_recaudador), ''), EXCLUDED.cuil_recaudador),
                numero_cuenta_recaudador = COALESCE(NULLIF(TRIM(public.nodos_configuracion_canal.numero_cuenta_recaudador), ''), EXCLUDED.numero_cuenta_recaudador),
                updated_at = NOW()`,
            [
                galiciaCuentaId,
                CUENTA_OFICIAL_GALICIA_DEFAULT.banco_recaudador,
                CUENTA_OFICIAL_GALICIA_DEFAULT.alias_recaudador,
                CUENTA_OFICIAL_GALICIA_DEFAULT.cbu_recaudador,
                CUENTA_OFICIAL_GALICIA_DEFAULT.titular_recaudador,
                CUENTA_OFICIAL_GALICIA_DEFAULT.cuil_recaudador,
                CUENTA_OFICIAL_GALICIA_DEFAULT.numero_cuenta_recaudador
            ]
        );

        // Sincronizar todos los nodos que usan la cuenta compartida del canal con la configuración vigente de id=1
        const cfgActivaRes = await client.query(`SELECT * FROM public.nodos_configuracion_canal WHERE id = 1 LIMIT 1`);
        const cfgCanal = cfgActivaRes.rows[0];
        if (cfgCanal) {
            await client.query(
                `UPDATE public.nodos_maestro
                 SET cuenta_bancaria_id = $1,
                     banco_display = $2,
                     alias_bancario_display = $3,
                     cbu_display = $4,
                     titular_display = $5,
                     cuil_display = $6,
                     numero_cuenta_display = $7
                 WHERE COALESCE(usa_cuenta_compartida, true) = true
                   AND (
                       COALESCE(alias_bancario_display, '') <> $3
                       OR COALESCE(cbu_display, '') <> $4
                       OR COALESCE(titular_display, '') <> $5
                       OR COALESCE(banco_display, '') <> $2
                       OR COALESCE(cuil_display, '') <> $6
                       OR COALESCE(numero_cuenta_display, '') <> $7
                       OR cuenta_bancaria_id IS DISTINCT FROM $1
                   )`,
                [
                    cfgCanal.cuenta_bancaria_id || galiciaCuentaId,
                    cfgCanal.banco_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.banco_recaudador,
                    cfgCanal.alias_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.alias_recaudador,
                    cfgCanal.cbu_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.cbu_recaudador,
                    cfgCanal.titular_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.titular_recaudador,
                    cfgCanal.cuil_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.cuil_recaudador,
                    cfgCanal.numero_cuenta_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.numero_cuenta_recaudador
                ]
            );
        }

        // 5. Columnas resumen de pago / reclamo en nodos_pedidos_vecinos + tablas 1:N / N:M de avisos y cobros reales
        await client.query(`
            ALTER TABLE public.nodos_pedidos_vecinos
                ADD COLUMN IF NOT EXISTS monto_declarado_cliente NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS monto_acreditado_banco NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS cantidad_avisos_pago INTEGER NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS ultimo_aviso_pago_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS reclamo_pago_no_recibido BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS reclamo_pago_motivo TEXT,
                ADD COLUMN IF NOT EXISTS reclamo_pago_fecha TIMESTAMPTZ;

            ALTER TABLE public.nodos_alias_vecinos_aprendidos
                ADD COLUMN IF NOT EXISTS cbu_cvu_origen VARCHAR(30);

            CREATE TABLE IF NOT EXISTS public.nodos_pedidos_avisos_pago (
                id SERIAL PRIMARY KEY,
                pedido_id INTEGER NOT NULL REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE CASCADE,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                vecino_id INTEGER REFERENCES public.nodos_vecinos(id) ON DELETE SET NULL,
                monto_informado NUMERIC(14,2) NOT NULL CHECK (monto_informado > 0),
                titular_emisor VARCHAR(180),
                es_cuenta_tercero BOOLEAN NOT NULL DEFAULT false,
                nota_cliente VARCHAR(280),
                comprobante_token VARCHAR(64),
                comprobante_filename VARCHAR(220),
                comprobante_mime VARCHAR(80),
                comprobante_bytes INTEGER,
                estado_aviso VARCHAR(32) NOT NULL DEFAULT 'INFORMADO',
                movimiento_bancario_id INTEGER REFERENCES public.fin_movimientos_bancarios(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_nodos_avisos_pago_pedido
                ON public.nodos_pedidos_avisos_pago(pedido_id);
            CREATE INDEX IF NOT EXISTS idx_nodos_avisos_pago_nodo_estado
                ON public.nodos_pedidos_avisos_pago(nodo_id, estado_aviso);

            CREATE TABLE IF NOT EXISTS public.nodos_pedidos_cobros_banco (
                id SERIAL PRIMARY KEY,
                pedido_id INTEGER NOT NULL REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE CASCADE,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                vecino_id INTEGER REFERENCES public.nodos_vecinos(id) ON DELETE SET NULL,
                movimiento_bancario_id INTEGER REFERENCES public.fin_movimientos_bancarios(id) ON DELETE RESTRICT,
                aviso_pago_id INTEGER REFERENCES public.nodos_pedidos_avisos_pago(id) ON DELETE SET NULL,
                monto_aplicado NUMERIC(14,2) NOT NULL CHECK (monto_aplicado > 0),
                fecha_banco TIMESTAMP,
                cuit_origen VARCHAR(24),
                cbu_origen VARCHAR(30),
                titular_banco VARCHAR(180),
                referencia_banco VARCHAR(160),
                movimiento_pago_cc_id BIGINT,
                conciliado_por VARCHAR(120) DEFAULT 'Administración LAMDA',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_nodos_cobros_banco_pedido
                ON public.nodos_pedidos_cobros_banco(pedido_id);
            CREATE INDEX IF NOT EXISTS idx_nodos_cobros_banco_mov
                ON public.nodos_pedidos_cobros_banco(movimiento_bancario_id);
            CREATE UNIQUE INDEX IF NOT EXISTS unq_nodos_cobro_pedido_mov
                ON public.nodos_pedidos_cobros_banco(pedido_id, movimiento_bancario_id)
                WHERE movimiento_bancario_id IS NOT NULL;
        `);

        // Backfill idempotente: pedidos históricos que ya figuraban conciliados antes de este módulo
        await client.query(`
            UPDATE public.nodos_pedidos_vecinos
            SET monto_acreditado_banco = total_vecino
            WHERE (COALESCE(impactado_cta_cte_pago, false) = true OR UPPER(COALESCE(estado_pago, '')) = 'CONCILIADO_BANCO_LAMDA')
              AND COALESCE(monto_acreditado_banco, 0) = 0
              AND COALESCE(total_vecino, 0) > 0;
        `);

        _esquemaPagosInicializado = true;
    } finally {
        if (ownClient) {
            client.release();
        }
    }
}

async function obtenerConfiguracionBancariaCanalNodos(runner = null) {
    const q = runner || db;
    await asegurarEsquemaPagosBancariosNodos(runner);
    const res = await q.query(`SELECT * FROM public.nodos_configuracion_canal WHERE id = 1 LIMIT 1`);
    const row = res.rows[0] || {};
    return {
        id: 1,
        cuenta_bancaria_id: row.cuenta_bancaria_id ? Number(row.cuenta_bancaria_id) : 1,
        banco_recaudador: row.banco_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.banco_recaudador,
        alias_recaudador: row.alias_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.alias_recaudador,
        cbu_recaudador: row.cbu_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.cbu_recaudador,
        titular_recaudador: row.titular_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.titular_recaudador,
        cuil_recaudador: row.cuil_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.cuil_recaudador,
        numero_cuenta_recaudador: row.numero_cuenta_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.numero_cuenta_recaudador,
        solo_transferencia_bancaria: row.solo_transferencia_bancaria !== false
    };
}

/**
 * Resuelve y valida pertenencia de un pedido para operaciones públicas del comprador en `/tienda/:slug`
 * (por `tracking_token` criptográfico, o por `codigo_pedido` + `portal_token` / `telefono` coincidente).
 */
async function _resolverPedidoAutorizadoComprador(q, slug, codigoOToken, credenciales = {}) {
    const cleanSlug = String(slug || '').trim();
    const identificador = String(codigoOToken || '').trim();
    if (!cleanSlug || !identificador) {
        const err = new Error('Identificador de pedido requerido.');
        err.statusCode = 400;
        throw err;
    }

    const trackingTokParam = String(credenciales.tracking_token || '').trim();
    const portalTokParam = String(credenciales.portal_token || '').trim();
    const telNormParam = normalizarTelefonoSimple(credenciales.telefono || credenciales.vecino_telefono || '');

    const esTokenDirecto = /^trk_[a-zA-Z0-9_-]{12,}$/i.test(identificador) || identificador.length >= 24;
    const codigoNorm = !esTokenDirecto
        ? (/^\d+$/.test(identificador)
            ? `NB-${identificador}`
            : (identificador.toUpperCase().startsWith('NB-')
                ? identificador.toUpperCase()
                : `NB-${identificador.toUpperCase().replace(/^#?NB-?/i, '')}`))
        : '';

    const res = await q.query(
        `SELECT npv.*,
                nv.portal_token AS vec_portal_token,
                nv.telefono_normalizado AS vec_tel_norm,
                nm.slug AS nm_slug, nm.slug_historico, nm.nombre_marca, nm.gestor_nombre, nm.gestor_telefono,
                nm.banco_display, nm.alias_bancario_display, nm.cbu_display, nm.titular_display,
                nm.cuil_display, nm.numero_cuenta_display, nm.activo AS nodo_activo
         FROM public.nodos_pedidos_vecinos npv
         JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
         LEFT JOIN public.nodos_vecinos nv ON nv.id = npv.vecino_id
         WHERE (LOWER(nm.slug) = LOWER($1) OR LOWER(COALESCE(nm.slug_historico, '')) = LOWER($1))
           AND COALESCE(nm.activo, true) = true
           AND (
               ($2 <> '' AND npv.tracking_token = $2)
               OR ($3 <> '' AND UPPER(TRIM(npv.codigo_pedido)) = $3)
           )
         ORDER BY npv.id DESC
         LIMIT 1`,
        [cleanSlug, esTokenDirecto ? identificador : trackingTokParam, codigoNorm]
    );

    if (res.rows.length === 0) {
        const err = new Error('Pedido no encontrado en esta tienda.');
        err.statusCode = 404;
        throw err;
    }

    const ped = res.rows[0];

    // Verificación estricta de pertenencia (anti-enumeración)
    const poseeTrackingValido = Boolean(
        (esTokenDirecto && ped.tracking_token && identificador === ped.tracking_token) ||
        (trackingTokParam && ped.tracking_token && trackingTokParam === ped.tracking_token)
    );
    const poseePortalValido = Boolean(
        portalTokParam && ped.vec_portal_token && portalTokParam === ped.vec_portal_token
    );
    const telPed = normalizarTelefonoSimple(ped.vec_tel_norm || ped.vecino_telefono || '');
    const poseeTelefonoValido = Boolean(
        telNormParam && telPed && telNormParam.length >= 8 && telNormParam.slice(-8) === telPed.slice(-8)
    );

    if (!poseeTrackingValido && !poseePortalValido && !poseeTelefonoValido) {
        const err = new Error('No autorizado para consultar o informar pagos de este pedido.');
        err.statusCode = 403;
        throw err;
    }

    return ped;
}

/**
 * Construye el resumen estructurado de estado de pago, avisos declarados y acreditaciones reales
 * para inyectar en Seguimiento, Mi Cuenta, Post-Checkout, Panel de Gestión y Liquidación.
 */
async function obtenerResumenPagosPorPedidosIds(pedidoIds = [], runner = null, opciones = {}) {
    const ids = Array.from(new Set((pedidoIds || []).map(Number).filter(n => Number.isFinite(n) && n > 0)));
    const mapa = new Map();
    if (ids.length === 0) return mapa;

    const q = runner || db;
    await asegurarEsquemaPagosBancariosNodos(runner);

    const [avisosRes, cobrosRes] = await Promise.all([
        q.query(
            `SELECT id, pedido_id, monto_informado, titular_emisor, es_cuenta_tercero, nota_cliente,
                    comprobante_token, comprobante_filename, comprobante_mime, comprobante_bytes,
                    estado_aviso, movimiento_bancario_id, created_at
             FROM public.nodos_pedidos_avisos_pago
             WHERE pedido_id = ANY($1::int[])
             ORDER BY id ASC`,
            [ids]
        ),
        q.query(
            `SELECT id, pedido_id, movimiento_bancario_id, aviso_pago_id, monto_aplicado,
                    fecha_banco, cuit_origen, cbu_origen, titular_banco, referencia_banco, created_at
             FROM public.nodos_pedidos_cobros_banco
             WHERE pedido_id = ANY($1::int[])
             ORDER BY id ASC`,
            [ids]
        )
    ]);

    for (const pid of ids) {
        mapa.set(pid, { avisos: [], cobros_banco: [] });
    }
    for (const av of avisosRes.rows) {
        const pid = Number(av.pedido_id);
        if (!mapa.has(pid)) mapa.set(pid, { avisos: [], cobros_banco: [] });
        mapa.get(pid).avisos.push({
            id: Number(av.id),
            monto_informado: Number(av.monto_informado || 0),
            titular_emisor: av.titular_emisor || '',
            es_cuenta_tercero: Boolean(av.es_cuenta_tercero),
            nota_cliente: av.nota_cliente || '',
            tiene_comprobante: Boolean(av.comprobante_filename),
            comprobante_mime: av.comprobante_mime || null,
            comprobante_url: av.comprobante_filename
                ? (opciones.incluirTokenComprobante && av.comprobante_token
                    ? `/api/produccion/nodos/comprobante-pago/${av.id}?ct=${encodeURIComponent(av.comprobante_token)}`
                    : `/api/produccion/nodos/comprobante-pago/${av.id}`)
                : null,
            estado_aviso: av.estado_aviso || 'INFORMADO',
            movimiento_bancario_id: av.movimiento_bancario_id ? Number(av.movimiento_bancario_id) : null,
            created_at: av.created_at
        });
    }
    for (const cb of cobrosRes.rows) {
        const pid = Number(cb.pedido_id);
        if (!mapa.has(pid)) mapa.set(pid, { avisos: [], cobros_banco: [] });
        mapa.get(pid).cobros_banco.push({
            id: Number(cb.id),
            movimiento_bancario_id: cb.movimiento_bancario_id ? Number(cb.movimiento_bancario_id) : null,
            aviso_pago_id: cb.aviso_pago_id ? Number(cb.aviso_pago_id) : null,
            monto_aplicado: Number(cb.monto_aplicado || 0),
            fecha_banco: cb.fecha_banco,
            cuit_origen: cb.cuit_origen || null,
            cbu_origen: cb.cbu_origen || null,
            titular_banco: cb.titular_banco || '',
            referencia_banco: cb.referencia_banco || '',
            created_at: cb.created_at
        });
    }

    return mapa;
}

function enriquecerPedidoConResumenPago(pedRow, detallePagos = null) {
    const totalVecino = Math.max(0, Number(pedRow.total_vecino || 0));
    const avisos = Array.isArray(detallePagos?.avisos) ? detallePagos.avisos : [];
    const cobrosBanco = Array.isArray(detallePagos?.cobros_banco) ? detallePagos.cobros_banco : [];
    const pagoConfirmado = esPedidoPagoConfirmadoNodos(pedRow);

    const montoAcreditado = pagoConfirmado
        ? Math.max(totalVecino, Number(pedRow.monto_acreditado_banco || 0))
        : Math.max(0, Number(pedRow.monto_acreditado_banco || 0));

    const avisosVigentes = avisos.filter(a => String(a.estado_aviso || '').toUpperCase() !== 'OBSERVADO_NO_RECIBIDO');
    const sumaAvisosVigentes = avisosVigentes.reduce((s, a) => s + Number(a.monto_informado || 0), 0);
    const montoDeclarado = avisos.length > 0
        ? Number(sumaAvisosVigentes.toFixed(2))
        : Math.max(0, Number(pedRow.monto_declarado_cliente || 0));

    const saldoPendienteAcreditar = pagoConfirmado
        ? 0
        : Math.max(0, Number((totalVecino - montoAcreditado).toFixed(2)));

    // Saldo sugerido para precargar en el input de "Ya hice la transferencia":
    // Si tiene reclamo de pago no recibido, vuelve a sugerir el saldo real no acreditado en banco.
    const reclamoActivo = !pagoConfirmado && Boolean(pedRow.reclamo_pago_no_recibido);
    const baseCubiertaDeclarativa = reclamoActivo
        ? montoAcreditado
        : Math.max(montoAcreditado, montoDeclarado);
    const saldoPendienteDeclarar = pagoConfirmado
        ? 0
        : Math.max(0, Number((totalVecino - baseCubiertaDeclarativa).toFixed(2)));

    return {
        estado_pago: pedRow.estado_pago || (pagoConfirmado ? 'CONCILIADO_BANCO_LAMDA' : 'PENDIENTE_TRANSFERENCIA'),
        pago_confirmado: pagoConfirmado,
        monto_declarado_cliente: Number(montoDeclarado.toFixed(2)),
        monto_acreditado_banco: Number(montoAcreditado.toFixed(2)),
        saldo_pendiente_acreditar: saldoPendienteAcreditar,
        saldo_pendiente_declarar: saldoPendienteDeclarar,
        cantidad_avisos_pago: avisos.length || Number(pedRow.cantidad_avisos_pago || 0),
        ultimo_aviso_pago_at: pedRow.ultimo_aviso_pago_at || (avisos.length ? avisos[avisos.length - 1].created_at : null),
        reclamo_pago_no_recibido: reclamoActivo,
        reclamo_pago_motivo: reclamoActivo ? (pedRow.reclamo_pago_motivo || '') : null,
        reclamo_pago_fecha: reclamoActivo ? (pedRow.reclamo_pago_fecha || null) : null,
        avisos_pago: avisos,
        cobros_banco: cobrosBanco
    };
}

/**
 * Consulta pública del estado de pago y cuenta bancaria oficial para un pedido del comprador.
 */
async function obtenerEstadoPagoPublicoPedido(slug, codigoOToken, credenciales = {}) {
    await asegurarEsquemaPagosBancariosNodos();
    const ped = await _resolverPedidoAutorizadoComprador(db, slug, codigoOToken, credenciales);
    const [cfgCanal, mapaPagos] = await Promise.all([
        obtenerConfiguracionBancariaCanalNodos(),
        obtenerResumenPagosPorPedidosIds([Number(ped.id)], null, { incluirTokenComprobante: true })
    ]);
    const resumenPago = enriquecerPedidoConResumenPago(ped, mapaPagos.get(Number(ped.id)));

    const datosBancarios = {
        banco: ped.banco_display || cfgCanal.banco_display || cfgCanal.banco_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.banco_display,
        alias: ped.alias_bancario_display || cfgCanal.alias_bancario_display || cfgCanal.alias_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.alias_bancario_display,
        cbu: ped.cbu_display || cfgCanal.cbu_display || cfgCanal.cbu_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.cbu_display,
        titular: ped.titular_display || cfgCanal.titular_display || cfgCanal.titular_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.titular_display,
        cuil: ped.cuil_display || cfgCanal.cuil_display || cfgCanal.cuil_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.cuil_display,
        numero_cuenta: ped.numero_cuenta_display || cfgCanal.numero_cuenta_display || cfgCanal.numero_cuenta_recaudador || CUENTA_OFICIAL_GALICIA_DEFAULT.numero_cuenta_display
    };
    const pedidoPayload = {
        id: Number(ped.id),
        pedido_id: Number(ped.id),
        codigo_pedido: ped.codigo_pedido,
        tracking_token: ped.tracking_token,
        vecino_nombre: ped.vecino_nombre,
        medio_pago: ped.medio_pago,
        total_vecino: Number(ped.total_vecino || 0),
        ...resumenPago
    };

    return {
        ok: true,
        ...pedidoPayload,
        pedido: pedidoPayload,
        cuenta_bancaria: datosBancarios,
        datos_bancarios: datosBancarios
    };
}

/**
 * Registra un aviso declarativo de transferencia del comprador ("Ya hice la transferencia"),
 * soportando pagos únicos en 1 toque, pagos en varios tramos desde distintas cuentas,
 * titular emisor tercero opcional y comprobante opcional validado por magic bytes.
 * NUNCA marca `pago_confirmado = true` ni libera mercadería en depósito.
 */
async function registrarAvisoPagoComprador(slug, codigoOToken, payload = {}, fileObj = null) {
    await asegurarEsquemaPagosBancariosNodos();

    let archivoValidado = null;
    if (fileObj && fileObj.buffer) {
        const infoMime = validarBufferComprobantePago(fileObj.buffer);
        archivoValidado = {
            buffer: fileObj.buffer,
            mime: infoMime.mime,
            ext: infoMime.ext,
            bytes: fileObj.buffer.length
        };
    }

    const client = await db.connect();
    let rutaFisicaEscrita = null;
    let pedidoIdFinal = null;

    try {
        await client.query('BEGIN');

        const ped = await _resolverPedidoAutorizadoComprador(client, slug, codigoOToken, payload);
        pedidoIdFinal = Number(ped.id);

        if (String(ped.estado_operativo || '').toUpperCase() === 'ANULADO') {
            const err = new Error('Este pedido se encuentra anulado.');
            err.statusCode = 400;
            throw err;
        }
        if (esPedidoPagoConfirmadoNodos(ped)) {
            const err = new Error('El pago de este pedido ya fue acreditado y confirmado.');
            err.statusCode = 400;
            throw err;
        }

        // Lock pedido row
        const lockRes = await client.query(
            `SELECT * FROM public.nodos_pedidos_vecinos WHERE id = $1 FOR UPDATE`,
            [pedidoIdFinal]
        );
        const pedLocked = lockRes.rows[0];
        const totalPedido = Math.max(0, Number(pedLocked.total_vecino || 0));
        const acreditadoActual = Math.max(0, Number(pedLocked.monto_acreditado_banco || 0));
        const saldoMaxInformable = Math.max(0, Number((totalPedido - acreditadoActual).toFixed(2)));

        // Calcular cuánto ya informó en avisos vigentes
        const avPrevRes = await client.query(
            `SELECT COALESCE(SUM(monto_informado), 0)::numeric(14,2) AS suma_vigente,
                    COUNT(*)::int AS total_avisos
             FROM public.nodos_pedidos_avisos_pago
             WHERE pedido_id = $1 AND estado_aviso <> 'OBSERVADO_NO_RECIBIDO'`,
            [pedidoIdFinal]
        );
        const sumaVigentePrev = Number(avPrevRes.rows[0]?.suma_vigente || 0);
        const saldoSugeridoDefault = Math.max(0, Number((saldoMaxInformable - sumaVigentePrev).toFixed(2))) || saldoMaxInformable;

        const montoInput = payload.monto_informado !== undefined && payload.monto_informado !== null && String(payload.monto_informado).trim() !== ''
            ? Number(String(payload.monto_informado).replace(/\$/g, '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
            : saldoSugeridoDefault;

        if (!Number.isFinite(montoInput) || montoInput <= 0) {
            const err = new Error('Ingresá un importe transferido válido mayor a $0.');
            err.statusCode = 400;
            throw err;
        }
        const montoInformado = Number(montoInput.toFixed(2));
        if (montoInformado > totalPedido * 1.15 + 100) {
            const err = new Error(`El importe informado ($${montoInformado.toLocaleString('es-AR')}) supera el total del pedido ($${totalPedido.toLocaleString('es-AR')}).`);
            err.statusCode = 400;
            throw err;
        }

        const titularRaw = String(payload.titular_emisor || '').trim().slice(0, 175);
        const normTitular = normalizarTextoComparacionBancaria(titularRaw);
        const normComprador = normalizarTextoComparacionBancaria(pedLocked.vecino_nombre || '');
        const esTercero = Boolean(normTitular && normTitular !== normComprador);
        const notaCliente = String(payload.nota_cliente || '').trim().slice(0, 275) || null;

        let compToken = null;
        let compFilename = null;
        if (archivoValidado) {
            compToken = 'cmp_' + crypto.randomBytes(18).toString('hex');
            compFilename = `aviso_${pedidoIdFinal}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${archivoValidado.ext}`;
            const dirDestino = path.join(obtenerDirectorioComprobantesNodos(), String(pedLocked.nodo_id), String(pedidoIdFinal));
            fs.mkdirSync(dirDestino, { recursive: true });
            rutaFisicaEscrita = path.join(dirDestino, compFilename);
            fs.writeFileSync(rutaFisicaEscrita, archivoValidado.buffer);
        }

        await client.query(
            `INSERT INTO public.nodos_pedidos_avisos_pago (
                pedido_id, nodo_id, vecino_id, monto_informado, titular_emisor, es_cuenta_tercero,
                nota_cliente, comprobante_token, comprobante_filename, comprobante_mime, comprobante_bytes,
                estado_aviso, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'INFORMADO', NOW(), NOW())`,
            [
                pedidoIdFinal,
                Number(pedLocked.nodo_id),
                pedLocked.vecino_id ? Number(pedLocked.vecino_id) : null,
                montoInformado,
                titularRaw || null,
                esTercero,
                notaCliente,
                compToken,
                compFilename,
                archivoValidado ? archivoValidado.mime : null,
                archivoValidado ? archivoValidado.bytes : null
            ]
        );

        const recuentoRes = await client.query(
            `SELECT COALESCE(SUM(monto_informado) FILTER (WHERE estado_aviso <> 'OBSERVADO_NO_RECIBIDO'), 0)::numeric(14,2) AS total_declarado,
                    COUNT(*)::int AS cant_total
             FROM public.nodos_pedidos_avisos_pago
             WHERE pedido_id = $1`,
            [pedidoIdFinal]
        );
        const nuevoDeclarado = Number(recuentoRes.rows[0]?.total_declarado || 0);
        const cantTotalAvisos = Number(recuentoRes.rows[0]?.cant_total || 1);

        let nuevoEstadoPago = 'PAGO_INFORMADO';
        if (acreditadoActual > 0 && acreditadoActual < totalPedido - 0.5) {
            nuevoEstadoPago = 'PAGO_PARCIAL_ACREDITADO';
        } else if (nuevoDeclarado + acreditadoActual < totalPedido - 0.5) {
            nuevoEstadoPago = 'PAGO_INFORMADO_PARCIAL';
        }

        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_pago = $1,
                 monto_declarado_cliente = $2,
                 cantidad_avisos_pago = $3,
                 ultimo_aviso_pago_at = NOW(),
                 titular_transferencia = COALESCE($4, titular_transferencia),
                 reclamo_pago_no_recibido = false,
                 updated_at = NOW()
             WHERE id = $5`,
            [
                nuevoEstadoPago,
                nuevoDeclarado,
                cantTotalAvisos,
                titularRaw ? normalizarTextoComparacionBancaria(titularRaw) : null,
                pedidoIdFinal
            ]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (rutaFisicaEscrita && fs.existsSync(rutaFisicaEscrita)) {
            try { fs.unlinkSync(rutaFisicaEscrita); } catch (_) {}
        }
        throw err;
    } finally {
        client.release();
    }

    return obtenerEstadoPagoPublicoPedido(slug, codigoOToken, payload);
}

/**
 * Lee un archivo de comprobante opcional validando autorización estricta:
 * - Si viene desde host público (`esAccesoPublico === true`), exige `ct` (`comprobante_token`),
 *   `tracking_token` del pedido o `gestor_token` válido del nodo propietario.
 */
async function obtenerArchivoComprobanteAvisoPago(avisoId, opciones = {}) {
    await asegurarEsquemaPagosBancariosNodos();
    const idNum = Number(avisoId || 0);
    if (!idNum) {
        const err = new Error('Identificador de comprobante inválido.');
        err.statusCode = 400;
        throw err;
    }

    const res = await db.query(
        `SELECT av.*, npv.tracking_token, nm.gestor_token
         FROM public.nodos_pedidos_avisos_pago av
         JOIN public.nodos_pedidos_vecinos npv ON npv.id = av.pedido_id
         JOIN public.nodos_maestro nm ON nm.id = av.nodo_id
         WHERE av.id = $1
         LIMIT 1`,
        [idNum]
    );
    if (res.rows.length === 0 || !res.rows[0].comprobante_filename) {
        const err = new Error('Comprobante no encontrado.');
        err.statusCode = 404;
        throw err;
    }
    const row = res.rows[0];

    if (opciones.requerirAutorizacion) {
        const ct = String(opciones.comprobanteToken || '').trim();
        const trk = String(opciones.trackingToken || '').trim();
        const gtok = String(opciones.gestorToken || '').trim();
        const okCt = Boolean(ct && row.comprobante_token && ct === row.comprobante_token);
        const okTrk = Boolean(trk && row.tracking_token && trk === row.tracking_token);
        const okGestor = Boolean(gtok && row.gestor_token && gtok === row.gestor_token);
        if (!okCt && !okTrk && !okGestor) {
            const err = new Error('No autorizado para visualizar este comprobante.');
            err.statusCode = 403;
            throw err;
        }
    }

    const safeFile = path.basename(String(row.comprobante_filename));
    const absPath = path.join(obtenerDirectorioComprobantesNodos(), String(row.nodo_id), String(row.pedido_id), safeFile);
    if (!fs.existsSync(absPath)) {
        const err = new Error('El archivo físico del comprobante no se encuentra disponible.');
        err.statusCode = 404;
        throw err;
    }

    return {
        absPath,
        mime: row.comprobante_mime || 'application/octet-stream',
        filename: safeFile
    };
}

/**
 * Marca desde Administración LAMDA en 1 clic un pedido informado sin acreditación bancaria como
 * `OBSERVADO_NO_RECIBIDO`, encendiendo alerta inmediata en Gestión del nodo y en la Tienda del comprador.
 */
async function marcarPagoNoRecibidoYSolicitarComprobante(pedidoId, payload = {}) {
    await asegurarEsquemaPagosBancariosNodos();
    const pid = Number(pedidoId || 0);
    if (!pid) {
        throw new Error('ID de pedido inválido.');
    }

    const levantar = Boolean(payload.levantar_reclamo);
    const motivoDefault = 'Revisamos las acreditaciones de Banco Galicia y aún no impactó la transferencia informada. Por favor solicitá el comprobante al comprador.';
    const motivo = String(payload.motivo || motivoDefault).trim().slice(0, 400);

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const pedRes = await client.query(`SELECT * FROM public.nodos_pedidos_vecinos WHERE id = $1 FOR UPDATE`, [pid]);
        if (pedRes.rows.length === 0) {
            throw new Error('Pedido no encontrado.');
        }
        const ped = pedRes.rows[0];
        if (esPedidoPagoConfirmadoNodos(ped)) {
            throw new Error('Este pedido ya tiene el pago acreditado y confirmado.');
        }

        if (levantar) {
            const nuevoEst = Number(ped.monto_acreditado_banco || 0) > 0
                ? 'PAGO_PARCIAL_ACREDITADO'
                : (Number(ped.monto_declarado_cliente || 0) > 0 ? 'PAGO_INFORMADO' : 'PENDIENTE_TRANSFERENCIA');
            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET reclamo_pago_no_recibido = false,
                     reclamo_pago_motivo = NULL,
                     estado_pago = $2,
                     updated_at = NOW()
                 WHERE id = $1`,
                [pid, nuevoEst]
            );
        } else {
            await client.query(
                `UPDATE public.nodos_pedidos_avisos_pago
                 SET estado_aviso = 'OBSERVADO_NO_RECIBIDO',
                     updated_at = NOW()
                 WHERE pedido_id = $1 AND estado_aviso = 'INFORMADO'`,
                [pid]
            );
            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET estado_pago = 'OBSERVADO_NO_RECIBIDO',
                     reclamo_pago_no_recibido = true,
                     reclamo_pago_motivo = $2,
                     reclamo_pago_fecha = NOW(),
                     updated_at = NOW()
                 WHERE id = $1`,
                [pid, motivo]
            );
        }

        await client.query('COMMIT');
        return { ok: true, pedido_id: pid, reclamo_activo: !levantar };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Motor de Conciliación Híbrido:
 * Cruza los créditos reales disponibles de `public.fin_movimientos_bancarios` (Banco Galicia)
 * contra TODOS los pedidos activos pendientes de cobro (`!pago_confirmado`), tengan o no aviso del comprador.
 * Aprovecha `nodos_alias_vecinos_aprendidos` + `nodos_pedidos_avisos_pago` (montos parciales y titulares terceros)
 * como pistas contextuales y soporta:
 *   - 1 crédito -> 1 pedido (total o parcial)
 *   - N créditos -> 1 pedido (tramos múltiples)
 *   - 1 crédito grande -> M pedidos del mismo comprador (split controlado)
 */
async function obtenerTableroConciliadorGaliciaNodos(filtros = {}) {
    await asegurarEsquemaPagosBancariosNodos();
    const nodoIdFiltro = filtros.nodo_id ? Number(filtros.nodo_id) : 0;
    const cfgCanal = await obtenerConfiguracionBancariaCanalNodos();
    const cuentaId = Number(cfgCanal.cuenta_bancaria_id || 1);

    const [cuentaRes, movsRes, pedidosPendRes, avisosPendRes, aliasRes] = await Promise.all([
        db.query(`SELECT * FROM public.fin_cuentas_bancarias WHERE id = $1 LIMIT 1`, [cuentaId]),
        db.query(
            `SELECT m.*,
                    COALESCE((
                        SELECT SUM(cb.monto_aplicado)
                        FROM public.nodos_pedidos_cobros_banco cb
                        WHERE cb.movimiento_bancario_id = m.id
                    ), 0)::numeric(14,2) AS monto_ya_aplicado_nodos,
                    COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'pedido_id', cb.pedido_id,
                            'codigo_pedido', p2.codigo_pedido,
                            'monto_aplicado', cb.monto_aplicado
                        ))
                        FROM public.nodos_pedidos_cobros_banco cb
                        JOIN public.nodos_pedidos_vecinos p2 ON p2.id = cb.pedido_id
                        WHERE cb.movimiento_bancario_id = m.id
                    ), '[]'::jsonb) AS imputaciones_nodos
             FROM public.fin_movimientos_bancarios m
             WHERE m.cuenta_id = $1
               AND m.credito > 0
               AND m.cliente_id IS NULL
               AND m.tipo_operacion IN ('Transferencia', 'Depósito', 'Otros')
             ORDER BY m.fecha_movimiento DESC, m.id DESC
             LIMIT 180`,
            [cuentaId]
        ),
        db.query(
            `SELECT npv.*,
                    nm.nombre_marca, nm.slug AS nodo_slug, nm.perfil_operativo,
                    nv.dni_cuil AS vecino_dni_cuil, nv.titular_transferencia_habitual
             FROM public.nodos_pedidos_vecinos npv
             JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
             LEFT JOIN public.nodos_vecinos nv ON nv.id = npv.vecino_id
             WHERE COALESCE(npv.estado_operativo, '') <> 'ANULADO'
               AND COALESCE(npv.impactado_cta_cte_pago, false) = false
               AND UPPER(COALESCE(npv.estado_pago, '')) NOT IN ('CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR')
               AND ($1::int = 0 OR npv.nodo_id = $1::int)
             ORDER BY npv.id DESC`,
            [nodoIdFiltro]
        ),
        db.query(
            `SELECT av.*
             FROM public.nodos_pedidos_avisos_pago av
             JOIN public.nodos_pedidos_vecinos npv ON npv.id = av.pedido_id
             WHERE COALESCE(npv.estado_operativo, '') <> 'ANULADO'
               AND COALESCE(npv.impactado_cta_cte_pago, false) = false
               AND ($1::int = 0 OR av.nodo_id = $1::int)
             ORDER BY av.id ASC`,
            [nodoIdFiltro]
        ),
        db.query(
            `SELECT * FROM public.nodos_alias_vecinos_aprendidos ORDER BY usos_confirmados DESC, updated_at DESC`
        )
    ]);

    const avisosPorPedido = new Map();
    for (const av of avisosPendRes.rows) {
        const pid = Number(av.pedido_id);
        if (!avisosPorPedido.has(pid)) avisosPorPedido.set(pid, []);
        avisosPorPedido.get(pid).push(av);
    }

    const aliasPorCuit = new Map();
    const aliasPorCbu = new Map();
    const aliasLista = aliasRes.rows.map(a => {
        const cuitClean = String(a.cuit_cuil_origen || '').replace(/\D+/g, '');
        const cbuClean = String(a.cbu_cvu_origen || '').replace(/\D+/g, '');
        if (cuitClean && !aliasPorCuit.has(cuitClean)) aliasPorCuit.set(cuitClean, a);
        if (cbuClean && !aliasPorCbu.has(cbuClean)) aliasPorCbu.set(cbuClean, a);
        return {
            ...a,
            titular_norm: normalizarTextoComparacionBancaria(a.titular_normalizado || '')
        };
    });

    const pedidosAbiertos = pedidosPendRes.rows.map(p => {
        const total = Number(p.total_vecino || 0);
        const acreditado = Number(p.monto_acreditado_banco || 0);
        const saldoPendiente = Math.max(0, Number((total - acreditado).toFixed(2)));
        const avisos = avisosPorPedido.get(Number(p.id)) || [];
        return {
            id: Number(p.id),
            codigo_pedido: p.codigo_pedido,
            nodo_id: Number(p.nodo_id),
            nombre_marca: p.nombre_marca,
            nodo_slug: p.nodo_slug,
            perfil_operativo: p.perfil_operativo,
            vecino_id: p.vecino_id ? Number(p.vecino_id) : null,
            vecino_nombre: p.vecino_nombre,
            vecino_telefono: p.vecino_telefono,
            destinatario_dni: String(p.destinatario_dni || p.vecino_dni_cuil || '').replace(/\D+/g, ''),
            titular_habitual: p.titular_transferencia_habitual || p.titular_transferencia || '',
            estado_pago: p.estado_pago,
            total_vecino: total,
            monto_declarado_cliente: Number(p.monto_declarado_cliente || 0),
            monto_acreditado_banco: acreditado,
            saldo_pendiente_acreditar: saldoPendiente,
            reclamo_pago_no_recibido: Boolean(p.reclamo_pago_no_recibido),
            reclamo_pago_motivo: p.reclamo_pago_motivo || null,
            created_at: p.created_at,
            avisos
        };
    }).filter(p => p.saldo_pendiente_acreditar > 0.5);

    // Contar cuántos pedidos abiertos comparten el mismo saldo pendiente exacto (para ponderar unicidad de importe)
    const conteoPorSaldoExacto = new Map();
    for (const p of pedidosAbiertos) {
        const k = Math.round(p.saldo_pendiente_acreditar);
        conteoPorSaldoExacto.set(k, (conteoPorSaldoExacto.get(k) || 0) + 1);
    }

    const creditosDisponibles = [];
    for (const m of movsRes.rows) {
        const creditoTotal = Number(m.credito || 0);
        const yaAplicado = Number(m.monto_ya_aplicado_nodos || 0);
        const disponible = Number((creditoTotal - yaAplicado).toFixed(2));
        if (disponible <= 0.5) continue;

        const extraido = cuentasBancariasService.extraerDatosBancariosDeConcepto(m.concepto, m.cuit_extraido);
        const cuitMov = extraido.cuit || (m.cuit_extraido ? String(m.cuit_extraido).replace(/\D+/g, '') : null);
        const cbuMov = extraido.cbu || m.metadata_adicional?.cbu_detectado || null;
        const titularMov = extraido.titular || m.metadata_adicional?.nombre_entidad_ia || '';

        creditosDisponibles.push({
            id: Number(m.id),
            fecha_movimiento: m.fecha_movimiento,
            concepto: m.concepto,
            tipo_operacion: m.tipo_operacion,
            credito_total: creditoTotal,
            monto_ya_aplicado: yaAplicado,
            credito_disponible: disponible,
            cuit_origen: cuitMov,
            cbu_origen: cbuMov,
            titular_banco: titularMov,
            imputaciones_previas: Array.isArray(m.imputaciones_nodos) ? m.imputaciones_nodos : []
        });
    }

    // Agrupar pedidos abiertos por vecino_id para detectar 1 transferencia grande -> M pedidos del mismo comprador
    const pedidosPorVecino = new Map();
    for (const p of pedidosAbiertos) {
        if (p.vecino_id) {
            const key = `${p.nodo_id}:${p.vecino_id}`;
            if (!pedidosPorVecino.has(key)) pedidosPorVecino.set(key, []);
            pedidosPorVecino.get(key).push(p);
        }
    }

    const sugerencias = [];
    const pedidosConSugerenciaSet = new Set();
    const movimientosAmbiguosIA = [];

    for (const mov of creditosDisponibles) {
        // Filtrar movimientos previos a la apertura más vieja menos 5 días para no cruzar histórico viejo irrelevante
        let mejorCandidato = null;
        const candidatosEvaluados = [];

        // Identidad aprendida por CUIT / CBU / Titular
        const aliasHit = (mov.cuit_origen && aliasPorCuit.get(mov.cuit_origen))
            || (mov.cbu_origen && aliasPorCbu.get(mov.cbu_origen))
            || (mov.titular_banco
                ? aliasLista.find(a => calcularSimilitudNombresBancarios(mov.titular_banco, a.titular_norm) >= 0.88)
                : null);

        // Evaluar caso especial Safeguard #1: 1 crédito bancario cubre exactamente 2+ pedidos abiertos del mismo comprador
        for (const [, pedsVec] of pedidosPorVecino.entries()) {
            if (pedsVec.length < 2) continue;
            const ordenados = pedsVec.slice().sort((a, b) => a.id - b.id);
            const sumaTotalVec = Number(ordenados.reduce((s, x) => s + x.saldo_pendiente_acreditar, 0).toFixed(2));
            const simVec = Math.max(
                calcularSimilitudNombresBancarios(mov.titular_banco, ordenados[0].vecino_nombre),
                calcularSimilitudNombresBancarios(mov.titular_banco, ordenados[0].titular_habitual),
                (aliasHit && Number(aliasHit.vecino_id) === Number(ordenados[0].vecino_id)) ? 0.96 : 0
            );
            if (Math.abs(mov.credito_disponible - sumaTotalVec) <= 2 && (simVec >= 0.45 || ordenados.some(o => o.avisos.length > 0))) {
                mejorCandidato = {
                    tipo_imputacion: 'SPLIT_MULTI_PEDIDO',
                    puntaje: Math.round(75 + simVec * 25),
                    confianza: simVec >= 0.7 ? 'ALTA' : 'MEDIA',
                    motivos: [
                        `1 crédito bancario ($${mov.credito_disponible.toLocaleString('es-AR')}) cubre exactamente ${ordenados.length} pedidos abiertos del mismo comprador (${ordenados.map(o => '#' + o.codigo_pedido).join(' + ')})`
                    ],
                    imputaciones: ordenados.map(o => ({
                        pedido_id: o.id,
                        codigo_pedido: o.codigo_pedido,
                        nombre_marca: o.nombre_marca,
                        vecino_nombre: o.vecino_nombre,
                        monto_aplicado: o.saldo_pendiente_acreditar,
                        saldo_pendiente_pedido: o.saldo_pendiente_acreditar
                    }))
                };
                break;
            }
        }

        if (!mejorCandidato) {
            for (const ped of pedidosAbiertos) {
                let score = 0;
                const motivos = [];
                let montoSugerido = Math.min(mov.credito_disponible, ped.saldo_pendiente_acreditar);
                let avisoVinculadoId = null;

                // 1) Señal aprendida en nodos_alias_vecinos_aprendidos
                if (aliasHit && ped.vecino_id && Number(aliasHit.vecino_id) === Number(ped.vecino_id)) {
                    score += 52;
                    motivos.push(`Emisor ya aprendido en compras previas (${aliasHit.titular_normalizado})`);
                }

                // 2) DNI contenido dentro del CUIT extraído del extracto Galicia (20-XXXXXXXX-X)
                if (mov.cuit_origen && ped.destinatario_dni && ped.destinatario_dni.length >= 7 && mov.cuit_origen.includes(ped.destinatario_dni)) {
                    score += 50;
                    motivos.push(`CUIT bancario (${mov.cuit_origen}) contiene el DNI del comprador`);
                }

                // 3) Similitud directa con nombre del comprador o su titular habitual
                const simComprador = Math.max(
                    calcularSimilitudNombresBancarios(mov.titular_banco, ped.vecino_nombre),
                    calcularSimilitudNombresBancarios(mov.titular_banco, ped.titular_habitual)
                );
                if (simComprador >= 0.85) {
                    score += 46;
                    motivos.push(`Titular bancario coincide con comprador (${mov.titular_banco})`);
                } else if (simComprador >= 0.5) {
                    score += 26;
                    motivos.push(`Apellido/nombre parcial coincidente (${mov.titular_banco})`);
                }

                // 4) Pistas contextuales de avisos declarados (incluyendo cuenta de terceros y tramos parciales)
                let matchTramoExacto = false;
                let mejorScoreAviso = 0;
                let mejoresMotivosAviso = [];
                for (const av of ped.avisos) {
                    if (String(av.estado_aviso || '') === 'CONCILIADO') continue;
                    let scoreAv = 0;
                    const motivosAv = [];
                    const simTercero = av.titular_emisor
                        ? calcularSimilitudNombresBancarios(mov.titular_banco, av.titular_emisor)
                        : 0;
                    if (simTercero >= 0.8) {
                        scoreAv += 48;
                        motivosAv.push(`Coincide con titular emisor declarado por el cliente ("${av.titular_emisor}")`);
                    } else if (simTercero >= 0.5) {
                        scoreAv += 25;
                        motivosAv.push(`Similitud parcial con titular declarado ("${av.titular_emisor}")`);
                    }

                    const montoAv = Number(av.monto_informado || 0);
                    if (montoAv > 0 && Math.abs(mov.credito_disponible - montoAv) <= 2) {
                        scoreAv += 38;
                        motivosAv.push(`Importe idéntico al tramo informado por el cliente ($${montoAv.toLocaleString('es-AR')})`);
                    }

                    if (scoreAv > mejorScoreAviso) {
                        mejorScoreAviso = scoreAv;
                        avisoVinculadoId = Number(av.id);
                        mejoresMotivosAviso = motivosAv;
                        if (montoAv > 0 && Math.abs(mov.credito_disponible - montoAv) <= 2) {
                            matchTramoExacto = true;
                            montoSugerido = Math.min(mov.credito_disponible, ped.saldo_pendiente_acreditar);
                        }
                    }
                }
                if (mejorScoreAviso > 0) {
                    score += mejorScoreAviso;
                    motivos.push(...mejoresMotivosAviso);
                }

                // 5) Coincidencia de importe con el saldo pendiente total del pedido (incluso si el cliente NO dio aviso)
                if (Math.abs(mov.credito_disponible - ped.saldo_pendiente_acreditar) <= 2) {
                    const cantMismoSaldo = conteoPorSaldoExacto.get(Math.round(ped.saldo_pendiente_acreditar)) || 1;
                    if (!matchTramoExacto) {
                        score += cantMismoSaldo === 1 ? 42 : 28;
                        motivos.push(
                            ped.avisos.length === 0
                                ? `Importe exacto del pedido ($${ped.saldo_pendiente_acreditar.toLocaleString('es-AR')}) — detectado aunque el cliente no tocó "Ya transferí"`
                                : `Importe exacto del saldo pendiente ($${ped.saldo_pendiente_acreditar.toLocaleString('es-AR')})`
                        );
                    }
                }

                // Ventana temporal razonable: el crédito bancario no puede ser semanas anterior al pedido
                const fechaPedMs = new Date(ped.created_at || 0).getTime();
                const fechaMovMs = new Date(mov.fecha_movimiento || 0).getTime();
                if (fechaPedMs > 0 && fechaMovMs > 0 && fechaMovMs < fechaPedMs - (4 * 86400 * 1000)) {
                    score -= 45;
                }

                if (score >= 38) {
                    candidatosEvaluados.push({
                        ped,
                        score,
                        motivos,
                        montoSugerido: Number(montoSugerido.toFixed(2)),
                        avisoVinculadoId
                    });
                }
            }

            candidatosEvaluados.sort((a, b) => b.score - a.score);
            if (candidatosEvaluados.length > 0) {
                const top = candidatosEvaluados[0];
                const segundo = candidatosEvaluados[1] || null;
                const esAmbiguo = Boolean(segundo && (top.score - segundo.score) < 12 && top.score < 80);

                if (esAmbiguo && filtros.usar_ia && invocarGemini25Flash) {
                    movimientosAmbiguosIA.push({ mov, candidatos: candidatosEvaluados.slice(0, 4) });
                }

                const confianza = top.score >= 75 ? 'ALTA' : (top.score >= 52 ? 'MEDIA' : 'BAJA');
                mejorCandidato = {
                    tipo_imputacion: top.montoSugerido < top.ped.saldo_pendiente_acreditar - 0.5 ? 'TRAMO_PARCIAL' : 'PAGO_COMPLETO',
                    puntaje: Math.min(100, top.score),
                    confianza,
                    sin_aviso_cliente: top.ped.avisos.length === 0,
                    aviso_pago_id: top.avisoVinculadoId,
                    motivos: top.motivos,
                    imputaciones: [
                        {
                            pedido_id: top.ped.id,
                            codigo_pedido: top.ped.codigo_pedido,
                            nombre_marca: top.ped.nombre_marca,
                            vecino_nombre: top.ped.vecino_nombre,
                            monto_aplicado: top.montoSugerido,
                            saldo_pendiente_pedido: top.ped.saldo_pendiente_acreditar,
                            aviso_pago_id: top.avisoVinculadoId
                        }
                    ],
                    alternativas: candidatosEvaluados.slice(1, 3).map(alt => ({
                        pedido_id: alt.ped.id,
                        codigo_pedido: alt.ped.codigo_pedido,
                        nombre_marca: alt.ped.nombre_marca,
                        vecino_nombre: alt.ped.vecino_nombre,
                        monto_aplicado: alt.montoSugerido,
                        puntaje: alt.score
                    }))
                };
            }
        }

        if (mejorCandidato) {
            for (const imp of mejorCandidato.imputaciones) {
                pedidosConSugerenciaSet.add(Number(imp.pedido_id));
            }
            sugerencias.push({
                movimiento: mov,
                propuesta: mejorCandidato
            });
        }
    }

    // Desempate asistido por Gemini 2.5 Flash únicamente para casos genuinamente ambiguos si se solicitó usar_ia
    if (movimientosAmbiguosIA.length > 0 && invocarGemini25Flash) {
        for (const itemAmb of movimientosAmbiguosIA.slice(0, 5)) {
            try {
                const promptTexto = JSON.stringify({
                    credito_banco_galicia: {
                        monto: itemAmb.mov.credito_disponible,
                        titular_detectado: itemAmb.mov.titular_banco,
                        cuit: itemAmb.mov.cuit_origen,
                        concepto: itemAmb.mov.concepto
                    },
                    pedidos_candidatos: itemAmb.candidatos.map(c => ({
                        pedido_id: c.ped.id,
                        codigo_pedido: c.ped.codigo_pedido,
                        comprador: c.ped.vecino_nombre,
                        saldo_pendiente: c.ped.saldo_pendiente_acreditar,
                        avisos_declarados: c.ped.avisos.map(a => ({
                            monto: a.monto_informado,
                            titular_emisor: a.titular_emisor
                        }))
                    }))
                });
                const resIa = await invocarGemini25Flash({
                    modulo: 'CUENTAS_BANCARIAS',
                    operacion: 'conciliar_nodos_desempate',
                    systemInstruction: 'Sos un analista de conciliación bancaria argentina. Elegí el pedido_id más probable para el crédito de Banco Galicia comparando apellidos/nombres y pistas de titulares emisores. Si ninguno es confiable devolvé pedido_id: 0.',
                    parts: [{ text: promptTexto }],
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            pedido_id: { type: 'INTEGER' },
                            motivo_ia: { type: 'STRING' }
                        },
                        required: ['pedido_id', 'motivo_ia']
                    },
                    temperature: 0.0,
                    timeoutMs: 8000
                });
                const elegidoId = Number(resIa?.json?.pedido_id || 0);
                if (elegidoId > 0) {
                    const sugTarget = sugerencias.find(s => s.movimiento.id === itemAmb.mov.id);
                    const candIa = itemAmb.candidatos.find(c => c.ped.id === elegidoId);
                    if (sugTarget && candIa) {
                        sugTarget.propuesta.imputaciones = [{
                            pedido_id: candIa.ped.id,
                            codigo_pedido: candIa.ped.codigo_pedido,
                            nombre_marca: candIa.ped.nombre_marca,
                            vecino_nombre: candIa.ped.vecino_nombre,
                            monto_aplicado: candIa.montoSugerido,
                            saldo_pendiente_pedido: candIa.ped.saldo_pendiente_acreditar,
                            aviso_pago_id: candIa.avisoVinculadoId
                        }];
                        sugTarget.propuesta.motivos.unshift(`🤖 Desempate IA: ${resIa.json.motivo_ia}`);
                    }
                }
            } catch (_) {}
        }
    }

    // Pedidos donde el cliente tocó "Ya hice la transferencia" pero NO hay ningún crédito sugerido en Banco Galicia
    const pedidosInformadosSinRespaldo = pedidosAbiertos.filter(p =>
        (p.avisos.length > 0 || ['PAGO_INFORMADO', 'PAGO_INFORMADO_PARCIAL'].includes(String(p.estado_pago || '').toUpperCase())) &&
        !pedidosConSugerenciaSet.has(p.id)
    );

    return {
        cuenta_oficial: {
            ...cfgCanal,
            saldo_extracto: cuentaRes.rows[0] ? Number(cuentaRes.rows[0].saldo || 0) : 0,
            actualizado_en: cuentaRes.rows[0]?.actualizado_en || null
        },
        creditos_disponibles: creditosDisponibles,
        pedidos_pendientes: pedidosAbiertos,
        sugerencias,
        pedidos_informados_sin_respaldo: pedidosInformadosSinRespaldo
    };
}

/**
 * Sube un extracto `.xls` / `.xlsx` de Banco Galicia reutilizando `cuentasBancariasService.procesarExtractoGalicia`
 * y devuelve de inmediato el tablero de sugerencias actualizado.
 */
async function ingestarExtractoGaliciaParaNodos(fileBuffer, filtros = {}) {
    await asegurarEsquemaPagosBancariosNodos();
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        throw new Error('No se recibió ningún archivo Excel de extracto bancario.');
    }
    const cfgCanal = await obtenerConfiguracionBancariaCanalNodos();
    const cuentaId = Number(cfgCanal.cuenta_bancaria_id || 1);
    const resultadoIngesta = await cuentasBancariasService.procesarExtractoGalicia(cuentaId, fileBuffer);
    const conciliador = await obtenerTableroConciliadorGaliciaNodos({
        nodo_id: filtros.nodo_id || 0,
        usar_ia: Boolean(filtros.usar_ia)
    });
    return {
        ingesta: resultadoIngesta,
        conciliador
    };
}

/**
 * Resguardo #2: Cuando un pedido `vecinal` alcanza `CONCILIADO_BANCO_LAMDA`, verifica si su ventana/canasto
 * original sigue abierto previo a retiro del gestor. Si ese lote ya fue retirado o liquidado, reasigna el pedido
 * al lote abierto vigente del nodo o a su próxima ventana de entrega para que jamás quede huérfano.
 */
async function _asegurarVentanaCanastoVigenteAlConciliarVecinal(client, pedRow, helpers) {
    const perfil = String(pedRow.perfil_operativo || 'vecinal').toLowerCase();
    const modulos = (pedRow.modulos_activos && typeof pedRow.modulos_activos === 'object') ? pedRow.modulos_activos : {};
    const usaCanasto = modulos.canasto_consolidado !== undefined
        ? Boolean(modulos.canasto_consolidado)
        : (perfil !== 'ecommerce_fulfillment');
    if (!usaCanasto) return null;

    // Consultar si existe lote para su fecha_entrega_label actual
    const loteOrigRes = await client.query(
        `SELECT * FROM public.nodos_lotes_estacion
         WHERE nodo_id = $1 AND fecha_entrega_label = $2
         ORDER BY id DESC LIMIT 1`,
        [Number(pedRow.nodo_id), String(pedRow.fecha_entrega_label || '')]
    );
    const loteOrig = loteOrigRes.rows[0] || null;
    const loteOrigCerrado = Boolean(
        loteOrig && (
            String(loteOrig.estado_canasto || '').toUpperCase() === 'ENTREGADO_AL_GESTOR' ||
            Boolean(loteOrig.debito_cta_cte_registrado) ||
            Boolean(loteOrig.liquidacion_cerrada)
        )
    );

    if (!loteOrigCerrado && pedRow.fecha_entrega_label) {
        return { reasignado: false, fecha_entrega_label: pedRow.fecha_entrega_label };
    }

    // Buscar si el nodo tiene otro canasto actualmente abierto en estación
    const loteAbiertoRes = await client.query(
        `SELECT * FROM public.nodos_lotes_estacion
         WHERE nodo_id = $1
           AND COALESCE(estado_canasto, '') <> 'ENTREGADO_AL_GESTOR'
           AND COALESCE(debito_cta_cte_registrado, false) = false
           AND COALESCE(liquidacion_cerrada, false) = false
         ORDER BY fecha_entrega_iso ASC NULLS LAST, id DESC
         LIMIT 1`,
        [Number(pedRow.nodo_id)]
    );

    let nuevaFechaLabel = '';
    let nuevaVentanaHoraria = pedRow.ventana_horaria_label || '';
    let nuevaFechaIso = null;

    if (loteAbiertoRes.rows.length > 0) {
        const la = loteAbiertoRes.rows[0];
        nuevaFechaLabel = la.fecha_entrega_label;
        nuevaVentanaHoraria = la.ventana_horaria_label || nuevaVentanaHoraria;
        nuevaFechaIso = la.fecha_entrega_iso || null;
    } else if (helpers && typeof helpers.calcularProximaVentanaEntrega === 'function') {
        let fechaRef = new Date();
        for (let intento = 0; intento < 6; intento++) {
            const prox = helpers.calcularProximaVentanaEntrega(pedRow.config_ventanas_corte, fechaRef);
            const chkCerrado = await client.query(
                `SELECT 1 FROM public.nodos_lotes_estacion
                 WHERE nodo_id = $1 AND fecha_entrega_label = $2
                   AND (COALESCE(estado_canasto, '') = 'ENTREGADO_AL_GESTOR' OR COALESCE(debito_cta_cte_registrado, false) = true OR COALESCE(liquidacion_cerrada, false) = true)
                 LIMIT 1`,
                [Number(pedRow.nodo_id), prox.fecha_entrega_label]
            );
            if (chkCerrado.rows.length === 0) {
                nuevaFechaLabel = prox.fecha_entrega_label;
                nuevaVentanaHoraria = prox.ventana_horaria_label || nuevaVentanaHoraria;
                nuevaFechaIso = prox.fecha_entrega_iso || null;
                break;
            }
            fechaRef = new Date(fechaRef.getTime() + 3 * 86400 * 1000);
        }
    }

    if (nuevaFechaLabel && nuevaFechaLabel !== pedRow.fecha_entrega_label) {
        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET fecha_entrega_label = $1,
                 ventana_horaria_label = $2,
                 fecha_entrega_comprometida = COALESCE($3::date, fecha_entrega_comprometida),
                 lote_canasto_id = NULL,
                 updated_at = NOW()
             WHERE id = $4`,
            [nuevaFechaLabel, nuevaVentanaHoraria, nuevaFechaIso, Number(pedRow.id)]
        );
        return { reasignado: true, fecha_entrega_label: nuevaFechaLabel };
    }

    return { reasignado: false, fecha_entrega_label: pedRow.fecha_entrega_label };
}

/**
 * Concilia de forma transaccional 1 o N imputaciones de créditos bancarios (`fin_movimientos_bancarios`)
 * contra 1 o M pedidos de Nodos (`nodos_pedidos_vecinos`).
 * - Controla estrictamente que `SUM(monto_aplicado)` por `movimiento_bancario_id` jamás supere `credito`.
 * - Registra el asiento `CREDITO` exacto por cada tramo en `factura_cuenta_corriente_movimientos`,
 *   `nodos_vecinos_movimientos_cc` y `nodos_movimientos_cta_cte` sin duplicar.
 * - Cuando un pedido completa `monto_acreditado_banco >= total_vecino`, pasa a `CONCILIADO_BANCO_LAMDA`,
 *   activa Hito 2 (`EN_PREPARACION`) y libera mercadería a `/deposito-nodos`.
 */
async function conciliarCreditosBancariosNodos(payload = {}, helpers = {}) {
    await asegurarEsquemaPagosBancariosNodos();

    const rawImputaciones = Array.isArray(payload.imputaciones)
        ? payload.imputaciones
        : (payload.pedido_id ? [{
            pedido_id: payload.pedido_id,
            movimiento_bancario_id: payload.movimiento_bancario_id || null,
            aviso_pago_id: payload.aviso_pago_id || null,
            monto_aplicado: payload.monto_aplicado,
            titular_manual: payload.titular_transferencia || null,
            referencia_manual: payload.comprobante_referencia || null
        }] : []);

    if (rawImputaciones.length === 0) {
        throw new Error('Debés indicar al menos una imputación de pago para conciliar.');
    }

    const responsable = String(payload.responsable || 'Administración LAMDA').trim();
    const client = await db.connect();
    const pedidosCompletadosIds = [];

    try {
        await client.query('BEGIN');

        for (const imp of rawImputaciones) {
            const pid = Number(imp.pedido_id || 0);
            const movBancoId = imp.movimiento_bancario_id ? Number(imp.movimiento_bancario_id) : null;
            if (!pid) throw new Error('Identificador de pedido inválido en la imputación.');

            const pedRes = await client.query(
                `SELECT npv.*,
                        nm.nombre_marca, nm.gestor_nombre, nm.codigo_bunker_cliente,
                        nm.perfil_operativo, nm.modulos_activos, nm.config_ventanas_corte,
                        nm.cliente_madre_bunker_id, nm.codigo_bunker_cliente_madre,
                        COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada,
                        npep.id AS envio_postal_id
                 FROM public.nodos_pedidos_vecinos npv
                 JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
                 LEFT JOIN public.nodos_pedidos_envios_postales npep ON npep.pedido_id = npv.id
                 WHERE npv.id = $1
                 FOR UPDATE OF npv`,
                [pid]
            );
            if (pedRes.rows.length === 0) {
                throw new Error(`Pedido #${pid} no encontrado.`);
            }
            const ped = pedRes.rows[0];
            if (String(ped.estado_operativo || '').toUpperCase() === 'ANULADO') {
                throw new Error(`El pedido #${ped.codigo_pedido} está ANULADO y no admite imputación.`);
            }
            if (esPedidoPagoConfirmadoNodos(ped)) {
                continue;
            }

            const totalPedido = Number(ped.total_vecino || 0);
            const yaAcreditadoPedido = Number(ped.monto_acreditado_banco || 0);
            const saldoPendientePedido = Math.max(0, Number((totalPedido - yaAcreditadoPedido).toFixed(2)));
            if (saldoPendientePedido <= 0.01) continue;

            let movBanco = null;
            let cuitOrigen = null;
            let cbuOrigen = null;
            let titularBanco = '';
            let fechaBanco = new Date();
            let referenciaBanco = '';

            if (movBancoId) {
                const movRes = await client.query(
                    `SELECT * FROM public.fin_movimientos_bancarios WHERE id = $1 FOR UPDATE`,
                    [movBancoId]
                );
                if (movRes.rows.length === 0) {
                    throw new Error(`Movimiento bancario #${movBancoId} no encontrado.`);
                }
                movBanco = movRes.rows[0];
                if (movBanco.cliente_id) {
                    throw new Error(`El movimiento bancario #${movBancoId} ya fue imputado a un cliente mayorista en Cuentas Bancarias.`);
                }
                const dupCheck = await client.query(
                    `SELECT id FROM public.nodos_pedidos_cobros_banco WHERE pedido_id = $1 AND movimiento_bancario_id = $2 LIMIT 1`,
                    [pid, movBancoId]
                );
                if (dupCheck.rows.length > 0) {
                    continue; // Idempotencia: ya estaba vinculado a este pedido
                }

                const usadoRes = await client.query(
                    `SELECT COALESCE(SUM(monto_aplicado), 0)::numeric(14,2) AS usado
                     FROM public.nodos_pedidos_cobros_banco
                     WHERE movimiento_bancario_id = $1`,
                    [movBancoId]
                );
                const yaUsadoMov = Number(usadoRes.rows[0]?.usado || 0);
                const dispMov = Number((Number(movBanco.credito || 0) - yaUsadoMov).toFixed(2));
                if (dispMov <= 0.01) {
                    throw new Error(`El crédito bancario #${movBancoId} ya fue imputado en su totalidad.`);
                }

                const montoSolicitado = imp.monto_aplicado !== undefined && imp.monto_aplicado !== null && imp.monto_aplicado !== ''
                    ? Number(imp.monto_aplicado)
                    : Math.min(dispMov, saldoPendientePedido);

                if (!Number.isFinite(montoSolicitado) || montoSolicitado <= 0) {
                    throw new Error('El monto a aplicar debe ser mayor a $0.');
                }
                if (montoSolicitado > dispMov + 0.05) {
                    throw new Error(`El monto a aplicar ($${montoSolicitado.toLocaleString('es-AR')}) supera el saldo disponible del movimiento bancario ($${dispMov.toLocaleString('es-AR')}).`);
                }
                if (montoSolicitado > saldoPendientePedido + 1.00) {
                    throw new Error(`El monto a aplicar ($${montoSolicitado.toLocaleString('es-AR')}) supera el saldo pendiente del pedido #${ped.codigo_pedido} ($${saldoPendientePedido.toLocaleString('es-AR')}).`);
                }
                imp._montoEfectivo = Number(Math.min(montoSolicitado, saldoPendientePedido).toFixed(2));

                const ext = cuentasBancariasService.extraerDatosBancariosDeConcepto(movBanco.concepto, movBanco.cuit_extraido);
                cuitOrigen = ext.cuit || movBanco.cuit_extraido || null;
                cbuOrigen = ext.cbu || movBanco.metadata_adicional?.cbu_detectado || null;
                titularBanco = normalizarTextoComparacionBancaria(
                    ext.titular || movBanco.metadata_adicional?.nombre_entidad_ia || imp.titular_manual || ped.vecino_nombre
                );
                fechaBanco = movBanco.fecha_movimiento || new Date();
                referenciaBanco = `GALICIA-MOV-${movBancoId}`;
            } else {
                const montoManual = imp.monto_aplicado !== undefined && imp.monto_aplicado !== null && imp.monto_aplicado !== ''
                    ? Number(imp.monto_aplicado)
                    : saldoPendientePedido;
                if (!Number.isFinite(montoManual) || montoManual <= 0 || montoManual > saldoPendientePedido + 1.00) {
                    throw new Error(`Monto inválido para conciliar el pedido #${ped.codigo_pedido}.`);
                }
                imp._montoEfectivo = Number(Math.min(montoManual, saldoPendientePedido).toFixed(2));
                titularBanco = normalizarTextoComparacionBancaria(
                    imp.titular_manual || ped.titular_transferencia || ped.vecino_nombre
                );
                referenciaBanco = String(imp.referencia_manual || `TRF-${ped.codigo_pedido}`).trim();
            }

            const montoAplicar = imp._montoEfectivo;
            const nuevoAcreditado = Number((yaAcreditadoPedido + montoAplicar).toFixed(2));
            const quedaCompleto = nuevoAcreditado >= totalPedido - 0.50;

            // 1. Impactar asiento CREDITO exacto por `montoAplicar` en Cuenta Corriente operativa del Nodo
            let movCcFacturaId = null;
            let saldoResultanteCc = 0;
            if (helpers.resolverCuentaContableOperativaNodo && helpers.recalcularSaldosCuentaMadreBunker) {
                const destCc = await helpers.resolverCuentaContableOperativaNodo(client, ped);
                if (destCc.ccId) {
                    const etiquetaTramo = (!quedaCompleto || yaAcreditadoPedido > 0)
                        ? ` [Tramo $${montoAplicar.toLocaleString('es-AR')} de $${totalPedido.toLocaleString('es-AR')}]`
                        : '';
                    const etiquetaMov = movBancoId ? ` [MovBanco #${movBancoId}]` : '';
                    const descBaseCc = `Transferencia Vecino #${ped.codigo_pedido} (${ped.vecino_nombre} · Titular: ${titularBanco})${etiquetaTramo} acreditada en Banco Galicia${etiquetaMov}`;
                    const descCc = destCc.usaCuentaMadreUnificada
                        ? agregarReferenciaNodoADescripcion(descBaseCc, ped.nombre_marca)
                        : descBaseCc;

                    const insMovCc = await client.query(
                        `INSERT INTO public.factura_cuenta_corriente_movimientos (
                            cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                            tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                            creado_en, metadatos
                         ) VALUES ($1, 'CREDITO', $2, 0, 'TRANSFERENCIA_VECINO_NODO', NULL, $3, NOW(), NOW(), $4)
                         RETURNING id`,
                        [
                            destCc.ccId,
                            montoAplicar,
                            descCc,
                            JSON.stringify({
                                pedido_id: ped.id,
                                codigo_pedido: ped.codigo_pedido,
                                nodo_id: ped.nodo_id,
                                nodo_marca: ped.nombre_marca || null,
                                usa_cuenta_madre_unificada: destCc.usaCuentaMadreUnificada,
                                codigo_bunker_cuenta_impactada: destCc.codigoBunkerDestino,
                                vecino_nombre: ped.vecino_nombre,
                                titular_normalizado: titularBanco,
                                cuit_origen: cuitOrigen,
                                cbu_origen: cbuOrigen,
                                movimiento_bancario_id: movBancoId,
                                monto_tramo: montoAplicar,
                                total_pedido: totalPedido,
                                referencia: referenciaBanco
                            })
                        ]
                    );
                    movCcFacturaId = Number(insMovCc.rows[0].id);
                    saldoResultanteCc = await helpers.recalcularSaldosCuentaMadreBunker(client, destCc.ccId);
                }
            }

            // 2. Insertar fila en nodos_pedidos_cobros_banco
            await client.query(
                `INSERT INTO public.nodos_pedidos_cobros_banco (
                    pedido_id, nodo_id, vecino_id, movimiento_bancario_id, aviso_pago_id,
                    monto_aplicado, fecha_banco, cuit_origen, cbu_origen, titular_banco,
                    referencia_banco, movimiento_pago_cc_id, conciliado_por, created_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
                [
                    pid,
                    Number(ped.nodo_id),
                    ped.vecino_id ? Number(ped.vecino_id) : null,
                    movBancoId,
                    imp.aviso_pago_id ? Number(imp.aviso_pago_id) : null,
                    montoAplicar,
                    fechaBanco,
                    cuitOrigen,
                    cbuOrigen,
                    titularBanco,
                    referenciaBanco,
                    movCcFacturaId,
                    responsable
                ]
            );

            // 3. Actualizar metadata en fin_movimientos_bancarios para trazabilidad cruzada con Cuentas Bancarias (:3004)
            if (movBancoId && movBanco) {
                const metaPrev = (movBanco.metadata_adicional && typeof movBanco.metadata_adicional === 'object')
                    ? movBanco.metadata_adicional
                    : {};
                const pedsPrev = Array.isArray(metaPrev.nodos_pedidos_codigos) ? metaPrev.nodos_pedidos_codigos : [];
                if (!pedsPrev.includes(ped.codigo_pedido)) pedsPrev.push(ped.codigo_pedido);
                const metaNueva = {
                    ...metaPrev,
                    canal_nodos: true,
                    nodos_pedidos_codigos: pedsPrev
                };
                await client.query(
                    `UPDATE public.fin_movimientos_bancarios
                     SET metadata_adicional = $2::jsonb
                     WHERE id = $1`,
                    [movBancoId, JSON.stringify(metaNueva)]
                );
            }

            // 4. Aprender titular / CUIT / CBU del emisor en nodos_alias_vecinos_aprendidos
            if (titularBanco) {
                const exAl = await client.query(
                    `SELECT id FROM public.nodos_alias_vecinos_aprendidos
                     WHERE nodo_id = $1 AND titular_normalizado = $2
                     LIMIT 1 FOR UPDATE`,
                    [ped.nodo_id, titularBanco]
                );
                const etiquetaBancoOrigen = movBancoId ? 'Banco Galicia (Extracto)' : 'Transferencia Bancaria';
                if (exAl.rows.length > 0) {
                    await client.query(
                        `UPDATE public.nodos_alias_vecinos_aprendidos
                         SET vecino_id = COALESCE($2, vecino_id),
                             vecino_nombre = $3,
                             cuit_cuil_origen = COALESCE($4, cuit_cuil_origen),
                             cbu_cvu_origen = COALESCE($5, cbu_cvu_origen),
                             billetera_banco_origen = $6,
                             usos_confirmados = usos_confirmados + 1,
                             updated_at = NOW()
                         WHERE id = $1`,
                        [exAl.rows[0].id, ped.vecino_id, ped.vecino_nombre, cuitOrigen, cbuOrigen, etiquetaBancoOrigen]
                    );
                } else {
                    await client.query(
                        `INSERT INTO public.nodos_alias_vecinos_aprendidos (
                            nodo_id, vecino_id, vecino_nombre, titular_normalizado,
                            cuit_cuil_origen, cbu_cvu_origen, billetera_banco_origen, usos_confirmados, updated_at
                         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NOW())`,
                        [ped.nodo_id, ped.vecino_id, ped.vecino_nombre, titularBanco, cuitOrigen, cbuOrigen, etiquetaBancoOrigen]
                    );
                }
            }

            // 5. Subcuenta del vecino y libro auxiliar de Nodos por el tramo acreditado
            if (ped.vecino_id && helpers.recalcularSaldoSubcuentaVecino) {
                await client.query(
                    `UPDATE public.nodos_vecinos
                     SET titular_transferencia_habitual = COALESCE($1, titular_transferencia_habitual),
                         updated_at = NOW()
                     WHERE id = $2`,
                    [titularBanco || null, ped.vecino_id]
                );
                await client.query(
                    `INSERT INTO public.nodos_vecinos_movimientos_cc (
                        nodo_id, vecino_id, pedido_vecino_id, lote_canasto_id,
                        tipo_movimiento, naturaleza, monto, saldo_resultante,
                        medio_pago, concepto, referencia_externa
                     ) VALUES ($1, $2, $3, $4, 'CREDITO_TRANSFERENCIA_LAMDA', 'CREDITO', $5, 0, 'TRANSFERENCIA', $6, $7)`,
                    [
                        ped.nodo_id,
                        ped.vecino_id,
                        ped.id,
                        ped.lote_canasto_id || null,
                        montoAplicar,
                        `Transferencia acreditada (${titularBanco}) — Pedido #${ped.codigo_pedido}`,
                        referenciaBanco
                    ]
                );
                await helpers.recalcularSaldoSubcuentaVecino(client, ped.vecino_id);
            }

            await client.query(
                `INSERT INTO public.nodos_movimientos_cta_cte (
                    nodo_id, lote_canasto_id, pedido_vecino_id, tipo_movimiento, signo,
                    monto, saldo_resultante, concepto, referencia_externa
                 ) VALUES ($1, $2, $3, 'CREDITO_TRANSFERENCIA_VECINO', -1, $4, $5, $6, $7)`,
                [
                    ped.nodo_id,
                    ped.lote_canasto_id || null,
                    ped.id,
                    montoAplicar,
                    saldoResultanteCc,
                    `Transferencia conciliada en Banco Galicia: #${ped.codigo_pedido} (${ped.vecino_nombre} · Titular: ${titularBanco})`,
                    referenciaBanco
                ]
            );

            // 6. Marcar aviso(s) asociado(s) como CONCILIADO
            if (imp.aviso_pago_id) {
                await client.query(
                    `UPDATE public.nodos_pedidos_avisos_pago
                     SET estado_aviso = 'CONCILIADO',
                         movimiento_bancario_id = COALESCE($2, movimiento_bancario_id),
                         updated_at = NOW()
                     WHERE id = $1 AND pedido_id = $3`,
                    [Number(imp.aviso_pago_id), movBancoId, pid]
                );
            } else if (quedaCompleto) {
                await client.query(
                    `UPDATE public.nodos_pedidos_avisos_pago
                     SET estado_aviso = 'CONCILIADO',
                         movimiento_bancario_id = COALESCE(movimiento_bancario_id, $2),
                         updated_at = NOW()
                     WHERE pedido_id = $1 AND estado_aviso <> 'CONCILIADO'`,
                    [pid, movBancoId]
                );
            } else {
                await client.query(
                    `UPDATE public.nodos_pedidos_avisos_pago
                     SET estado_aviso = 'CONCILIADO',
                         movimiento_bancario_id = COALESCE(movimiento_bancario_id, $2),
                         updated_at = NOW()
                     WHERE id = (
                         SELECT id FROM public.nodos_pedidos_avisos_pago
                         WHERE pedido_id = $1 AND estado_aviso <> 'CONCILIADO'
                           AND ABS(monto_informado - $3) <= 2
                         ORDER BY id ASC LIMIT 1
                     )`,
                    [pid, movBancoId, montoAplicar]
                );
            }

            // 7. Actualizar estado del pedido (liberando mercadería recién cuando quedaCompleto === true)
            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET medio_pago = 'TRANSFERENCIA',
                     monto_acreditado_banco = $1,
                     estado_pago = $2,
                     titular_transferencia = COALESCE($3, titular_transferencia),
                     comprobante_referencia = $4,
                     fecha_conciliacion_pago = CASE WHEN $5 THEN NOW() ELSE fecha_conciliacion_pago END,
                     impactado_cta_cte_pago = $5,
                     movimiento_pago_cc_id = COALESCE($6, movimiento_pago_cc_id),
                     reclamo_pago_no_recibido = false,
                     reclamo_pago_motivo = NULL,
                     updated_at = NOW()
                 WHERE id = $7`,
                [
                    nuevoAcreditado,
                    quedaCompleto ? 'CONCILIADO_BANCO_LAMDA' : 'PAGO_PARCIAL_ACREDITADO',
                    titularBanco || null,
                    referenciaBanco,
                    quedaCompleto,
                    movCcFacturaId,
                    pid
                ]
            );

            if (quedaCompleto) {
                pedidosCompletadosIds.push(pid);
                await _asegurarVentanaCanastoVigenteAlConciliarVecinal(client, ped, helpers);

                if (helpers.registrarTransicionHitoPedidoVecino && Number(ped.hito_tracking_actual || 1) < 2) {
                    const esFulfillment = !ped.lote_canasto_id && (
                        Boolean(ped.envio_postal_id) ||
                        String(ped.perfil_operativo || '').toLowerCase() === 'ecommerce_fulfillment' ||
                        ['PAQUETERIA_DOMICILIO', 'PAQUETERIA_SUCURSAL', 'ENCOMIENDA'].includes(String(ped.modalidad_entrega || '').toUpperCase())
                    );
                    await helpers.registrarTransicionHitoPedidoVecino(client, ped.id, 2, {
                        estadoOverride: esFulfillment ? 'EN_PREPARACION' : 'CONFIRMADO_VECINO',
                        origen: 'CONCILIACION_BANCO_GALICIA',
                        actor: responsable,
                        detalle: `Pago acreditado en Banco Galicia · Pedido #${ped.codigo_pedido} habilitado para preparación`
                    });
                }
            }
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }

    if (helpers.sincronizarCanastosEstacionNodos) {
        await helpers.sincronizarCanastosEstacionNodos();
    } else if (helpers.sincronizarNodosConCircuitoOperativoLamda) {
        await helpers.sincronizarNodosConCircuitoOperativoLamda();
    }

    return {
        ok: true,
        pedidos_completados_ids: pedidosCompletadosIds
    };
}

module.exports = {
    CUENTA_OFICIAL_GALICIA_DEFAULT,
    MAX_COMPROBANTE_BYTES,
    esModoLaboratorioPagosNodos,
    obtenerDirectorioComprobantesNodos,
    validarBufferComprobantePago,
    esPedidoPagoConfirmadoNodos,
    asegurarEsquemaPagosBancariosNodos,
    obtenerConfiguracionBancariaCanalNodos,
    obtenerResumenPagosPorPedidosIds,
    enriquecerPedidoConResumenPago,
    obtenerEstadoPagoPublicoPedido,
    registrarAvisoPagoComprador,
    obtenerArchivoComprobanteAvisoPago,
    marcarPagoNoRecibidoYSolicitarComprobante,
    obtenerTableroConciliadorGaliciaNodos,
    ingestarExtractoGaliciaParaNodos,
    conciliarCreditosBancariosNodos
};
