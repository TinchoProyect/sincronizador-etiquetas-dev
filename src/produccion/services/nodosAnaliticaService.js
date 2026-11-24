const db = require('../config/database');

let _esquemaAnaliticaReady = false;

const TIPOS_EVENTO_TIENDA_PERMITIDOS = new Set([
    'vista_tienda',
    'vista_seguimiento',
    'vista_mi_cuenta',
    'categoria_seleccionada',
    'busqueda_lupa',
    'vista_producto',
    'clic_que_contiene',
    'clic_coordinar_gestor',
    'video_bienvenida_apertura',
    'video_bienvenida_play',
    'carrito_agregar',
    'carrito_quitar',
    'carrito_vaciar',
    'inicio_checkout',
    'checkout_paso',
    'checkout_abandono',
    'pedido_confirmado',
    'marcar_admin_gestor'
]);

function limpiarTextoCorto(val, maxLen = 160) {
    if (val === undefined || val === null) return null;
    const limpio = String(val).replace(/[\u0000-\u001f]+/g, ' ').trim();
    if (!limpio) return null;
    return limpio.slice(0, maxLen);
}

function normalizarTelefonoSimple(raw) {
    const soloDigitos = String(raw || '').replace(/\D+/g, '');
    if (!soloDigitos) return '';
    if (soloDigitos.startsWith('549') && soloDigitos.length >= 12) return soloDigitos.slice(3);
    if (soloDigitos.startsWith('54') && soloDigitos.length >= 11) return soloDigitos.slice(2);
    if (soloDigitos.startsWith('0') && soloDigitos.length >= 11) return soloDigitos.slice(1);
    return soloDigitos;
}

/**
 * Reutiliza la convención de detección de dispositivos/bots de LAMDA (B2B + Web Pública),
 * distinguiendo navegadores in-app reales (Instagram, TikTok, Facebook) de crawlers automáticos.
 */
function detectarAgenteOSistemaNodo(uaRaw = '') {
    const ua = String(uaRaw || '');
    const uaLow = ua.toLowerCase();

    const esWhatsappCrawlerSinNavegador = uaLow.startsWith('whatsapp/') && !uaLow.includes('mozilla/');
    const esCrawlerAutomatico = esWhatsappCrawlerSinNavegador ||
        /googlebot|bingbot|gptbot|chatgpt-user|oai-searchbot|claudebot|anthropic-ai|perplexitybot|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|discordbot|linkedinbot|applebot|bytespider|petalbot|semrushbot|ahrefsbot|mj12bot|headlesschrome|lighthouse|uptimerobot|pingdom|curl\/|python-requests|go-http-client|axios\//i.test(ua);

    if (esCrawlerAutomatico) {
        let botNombre = 'Bot / Crawler';
        if (/whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|slackbot|discordbot/i.test(ua)) {
            botNombre = 'Preview Red Social';
        } else if (/gptbot|chatgpt|oai-searchbot|claudebot|anthropic|perplexity/i.test(ua)) {
            botNombre = 'Agente IA';
        } else if (/googlebot|bingbot|applebot/i.test(ua)) {
            botNombre = 'Buscador';
        }
        return {
            esIaBot: true,
            modo: 'Bot/IA',
            sistema: botNombre
        };
    }

    const esMovil = /android|iphone|ipad|ipod|mobile|iemobile|opera mini/i.test(uaLow);
    let sistema = 'Otro';
    if (uaLow.includes('android')) sistema = 'Android';
    else if (uaLow.includes('iphone') || uaLow.includes('ipad') || uaLow.includes('ipod')) sistema = 'iPhone / iOS';
    else if (uaLow.includes('windows')) sistema = 'Windows PC';
    else if (uaLow.includes('mac os') || uaLow.includes('macintosh')) sistema = 'Mac';
    else if (uaLow.includes('linux')) sistema = 'Linux';

    return {
        esIaBot: false,
        modo: esMovil ? 'Celular' : 'PC',
        sistema
    };
}

/**
 * Clasifica el origen de tráfico combinando utm_source, utm_medium, ref, referrer y firmas de in-app browsers.
 */
function detectarOrigenTraficoNodo({
    utm_source = '',
    utm_medium = '',
    utm_campaign = '',
    ref_param = '',
    referrer = '',
    user_agent = ''
} = {}) {
    const src = String(utm_source || '').trim().toLowerCase();
    const med = String(utm_medium || '').trim().toLowerCase();
    const camp = String(utm_campaign || '').trim().toLowerCase();
    const ref = String(ref_param || '').trim().toLowerCase();
    const docRef = String(referrer || '').trim().toLowerCase();
    const ua = String(user_agent || '').toLowerCase();

    const bolsaExplicita = `${src} ${med} ${camp} ${ref}`;

    if (/\b(qr|afiche|cartel|folleto|flyer|impreso|vidriera|mostrador)\b/.test(bolsaExplicita)) {
        return 'QR Afiche';
    }
    if (/\b(whatsapp|wsp|wa)\b/.test(bolsaExplicita) || docRef.includes('whatsapp.com') || docRef.includes('wa.me')) {
        return 'WhatsApp';
    }
    if (/\b(instagram|ig|insta|reels)\b/.test(bolsaExplicita) || docRef.includes('instagram.com') || ua.includes('instagram')) {
        return 'Instagram';
    }
    if (/\b(tiktok|tt)\b/.test(bolsaExplicita) || docRef.includes('tiktok.com') || /bytedancewebview|musical_ly|tiktok/i.test(ua)) {
        return 'TikTok';
    }
    if (/\b(facebook|fb|meta)\b/.test(bolsaExplicita) || docRef.includes('facebook.com') || docRef.includes('fb.me') || /fban\/|fbav\//i.test(ua)) {
        return 'Facebook';
    }
    if (/\b(google|gads|sem|seo)\b/.test(bolsaExplicita) || docRef.includes('google.com') || docRef.includes('google.com.ar')) {
        return 'Google';
    }
    if (docRef.includes('centro-nodos-analitica') || docRef.includes('pizarra-simulacion') || /\b(panel_lamda|admin|gestor)\b/.test(bolsaExplicita)) {
        return 'Panel Interno';
    }
    if (src) {
        return src.charAt(0).toUpperCase() + src.slice(1, 32);
    }
    return 'Directo';
}

function sanitizarSnapshotCarrito(rawSnapshot) {
    if (!Array.isArray(rawSnapshot)) return [];
    const limpio = [];
    for (const item of rawSnapshot.slice(0, 35)) {
        if (!item || typeof item !== 'object') continue;
        const cantidad = Math.max(0, Math.round(Number(item.cantidad || 0)));
        if (cantidad <= 0) continue;
        const precio = Math.max(0, Number(item.precio || item.precio_venta_vecino || 0));
        const subtotal = Math.max(0, Number(item.subtotal !== undefined ? item.subtotal : (precio * cantidad)));
        limpio.push({
            oferta_id: item.oferta_id ? Number(item.oferta_id) : null,
            sku: limpiarTextoCorto(item.sku || item.sku_nodo, 60) || '',
            nombre: limpiarTextoCorto(item.nombre || item.nombre_publico, 160) || 'Producto',
            presentacion: limpiarTextoCorto(item.presentacion || item.presentacion_etiqueta, 80) || '',
            cantidad,
            precio: Number(precio.toFixed(2)),
            subtotal: Number(subtotal.toFixed(2))
        });
    }
    return limpio;
}

async function asegurarEsquemaAnaliticaNodos(clientOrDb = null) {
    if (_esquemaAnaliticaReady && !clientOrDb) return;
    const runner = clientOrDb || db;

    await runner.query(`
        CREATE TABLE IF NOT EXISTS public.nodos_tienda_visitantes (
            id SERIAL PRIMARY KEY,
            visitor_id VARCHAR(80) UNIQUE NOT NULL,
            primer_nodo_id INTEGER REFERENCES public.nodos_maestro(id) ON DELETE SET NULL,
            ultimo_nodo_id INTEGER REFERENCES public.nodos_maestro(id) ON DELETE SET NULL,
            vecino_id INTEGER REFERENCES public.nodos_vecinos(id) ON DELETE SET NULL,
            vecino_nombre VARCHAR(160),
            vecino_telefono VARCHAR(60),
            telefono_normalizado VARCHAR(40),
            identificado_via VARCHAR(40),
            es_admin_gestor BOOLEAN NOT NULL DEFAULT false,
            etiqueta_dispositivo VARCHAR(120),
            dispositivo_modo VARCHAR(32) DEFAULT 'Celular',
            sistema_operativo VARCHAR(64) DEFAULT 'Otro',
            ultimo_origen_trafico VARCHAR(60) DEFAULT 'Directo',
            total_sesiones INTEGER NOT NULL DEFAULT 1,
            total_eventos INTEGER NOT NULL DEFAULT 0,
            total_pedidos_confirmados INTEGER NOT NULL DEFAULT 0,
            carrito_actual_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            carrito_actual_unidades INTEGER NOT NULL DEFAULT 0,
            carrito_actual_subtotal NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            carrito_actual_nodo_id INTEGER REFERENCES public.nodos_maestro(id) ON DELETE SET NULL,
            carrito_actualizado_at TIMESTAMPTZ,
            ultimo_pedido_at TIMESTAMPTZ,
            primera_visita_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ultima_visita_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ultima_ip VARCHAR(80),
            user_agent TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_nodos_tienda_visitantes_nodo_ultima
            ON public.nodos_tienda_visitantes (ultimo_nodo_id, ultima_visita_at DESC);

        CREATE INDEX IF NOT EXISTS idx_nodos_tienda_visitantes_vecino
            ON public.nodos_tienda_visitantes (vecino_id);

        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_index ix
                JOIN pg_class tbl ON tbl.oid = ix.indrelid
                JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
                JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = ANY(ix.indkey)
                WHERE ns.nspname = 'public'
                  AND tbl.relname = 'nodos_tienda_visitantes'
                  AND ix.indisunique = true
                  AND ix.indnatts = 1
                  AND att.attname = 'visitor_id'
            ) AND NOT EXISTS (
                SELECT visitor_id
                FROM public.nodos_tienda_visitantes
                GROUP BY visitor_id
                HAVING COUNT(*) > 1
            ) THEN
                CREATE UNIQUE INDEX IF NOT EXISTS nodos_tienda_visitantes_visitor_id_key
                    ON public.nodos_tienda_visitantes (visitor_id);
            END IF;
        END $$;

        CREATE TABLE IF NOT EXISTS public.nodos_tienda_eventos (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
            nodo_slug VARCHAR(120) NOT NULL,
            visitor_id VARCHAR(80) NOT NULL,
            session_id VARCHAR(80),
            vecino_id INTEGER REFERENCES public.nodos_vecinos(id) ON DELETE SET NULL,
            tipo_evento VARCHAR(50) NOT NULL,
            es_admin_gestor BOOLEAN NOT NULL DEFAULT false,
            es_ia_bot BOOLEAN NOT NULL DEFAULT false,
            origen_trafico VARCHAR(60) DEFAULT 'Directo',
            utm_source VARCHAR(100),
            utm_medium VARCHAR(100),
            utm_campaign VARCHAR(120),
            referrer TEXT,
            dispositivo_modo VARCHAR(32) DEFAULT 'Celular',
            sistema_operativo VARCHAR(64) DEFAULT 'Otro',
            categoria_nombre VARCHAR(120),
            termino_busqueda VARCHAR(200),
            oferta_id INTEGER,
            sku_nodo VARCHAR(60),
            producto_nombre VARCHAR(180),
            cantidad INTEGER,
            carrito_unidades INTEGER DEFAULT 0,
            carrito_subtotal NUMERIC(14,2) DEFAULT 0.00,
            carrito_snapshot JSONB,
            pedido_id INTEGER REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE SET NULL,
            codigo_pedido VARCHAR(50),
            detalle TEXT,
            ip_origen VARCHAR(80),
            user_agent TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_nodos_tienda_eventos_nodo_fecha
            ON public.nodos_tienda_eventos (nodo_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_nodos_tienda_eventos_visitor_fecha
            ON public.nodos_tienda_eventos (visitor_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_nodos_tienda_eventos_tipo
            ON public.nodos_tienda_eventos (tipo_evento);

        CREATE INDEX IF NOT EXISTS idx_nodos_tienda_eventos_created
            ON public.nodos_tienda_eventos (created_at DESC);
    `);

    if (!clientOrDb) {
        _esquemaAnaliticaReady = true;
    }
}

async function resolverNodoBasico(slugOrId, runner = db) {
    const raw = String(slugOrId || '').trim();
    if (!raw) return null;
    const idNum = /^\d+$/.test(raw) ? Number(raw) : -1;
    const res = await runner.query(
        `SELECT id, codigo_nodo, slug, slug_historico, nombre_marca, activo
         FROM public.nodos_maestro
         WHERE ($1::int > 0 AND id = $1::int)
            OR LOWER(slug) = LOWER($2)
            OR LOWER(COALESCE(slug_historico, '')) = LOWER($2)
            OR UPPER(codigo_nodo) = UPPER($2)
         ORDER BY CASE WHEN LOWER(slug) = LOWER($2) THEN 0 ELSE 1 END, id ASC
         LIMIT 1`,
        [idNum, raw]
    );
    return res.rows[0] || null;
}

/**
 * Vincula progresiva y retroactivamente un visitor_id con la identidad real de un vecino
 * cuando compra, abre /seguimiento/:token, /mi-cuenta/:portalToken o consulta por WhatsApp.
 */
async function vincularVisitanteConVecino({
    visitorId,
    nodoId = null,
    vecinoId = null,
    vecinoNombre = null,
    vecinoTelefono = null,
    telefonoNormalizado = null,
    identificadoVia = 'INTERACCION',
    pedidoConfirmado = false,
    ipOrigen = null,
    userAgent = null,
    client = null
} = {}) {
    const vid = limpiarTextoCorto(visitorId, 80);
    if (!vid || vid.length < 6) return { ok: false, omitido: true };

    const runner = client || db;
    await asegurarEsquemaAnaliticaNodos(client || null);

    let vId = vecinoId ? Number(vecinoId) : null;
    let vNombre = limpiarTextoCorto(vecinoNombre, 160);
    let vTel = limpiarTextoCorto(vecinoTelefono, 60);
    let telNorm = limpiarTextoCorto(telefonoNormalizado || normalizarTelefonoSimple(vTel || ''), 40);

    if (vId && (!vNombre || !vTel)) {
        const vecRes = await runner.query(
            `SELECT id, nodo_id, nombre_completo, telefono_whatsapp, telefono_normalizado
             FROM public.nodos_vecinos WHERE id = $1::int LIMIT 1`,
            [vId]
        );
        if (vecRes.rows[0]) {
            vNombre = vNombre || vecRes.rows[0].nombre_completo;
            vTel = vTel || vecRes.rows[0].telefono_whatsapp;
            telNorm = telNorm || vecRes.rows[0].telefono_normalizado;
            if (!nodoId) nodoId = vecRes.rows[0].nodo_id;
        }
    } else if (!vId && telNorm && nodoId) {
        const vecRes = await runner.query(
            `SELECT id, nombre_completo, telefono_whatsapp, telefono_normalizado
             FROM public.nodos_vecinos
             WHERE nodo_id = $1::int AND telefono_normalizado = $2
             LIMIT 1`,
            [Number(nodoId), telNorm]
        );
        if (vecRes.rows[0]) {
            vId = Number(vecRes.rows[0].id);
            vNombre = vNombre || vecRes.rows[0].nombre_completo;
            vTel = vTel || vecRes.rows[0].telefono_whatsapp;
        }
    }

    const uaInfo = detectarAgenteOSistemaNodo(userAgent || '');

    const paramsVincular = [
        vid,
        nodoId ? Number(nodoId) : null,
        vId,
        vNombre,
        vTel,
        telNorm || null,
        limpiarTextoCorto(identificadoVia, 40),
        uaInfo.modo,
        uaInfo.sistema,
        Boolean(pedidoConfirmado),
        limpiarTextoCorto(ipOrigen, 80),
        limpiarTextoCorto(userAgent, 500)
    ];

    const updVis = await runner.query(
        `UPDATE public.nodos_tienda_visitantes SET
            ultimo_nodo_id = COALESCE($2::int, ultimo_nodo_id),
            vecino_id = COALESCE($3::int, vecino_id),
            vecino_nombre = COALESCE($4::varchar, vecino_nombre),
            vecino_telefono = COALESCE($5::varchar, vecino_telefono),
            telefono_normalizado = COALESCE($6::varchar, telefono_normalizado),
            identificado_via = COALESCE($7::varchar, identificado_via),
            dispositivo_modo = COALESCE($8::varchar, dispositivo_modo),
            sistema_operativo = COALESCE($9::varchar, sistema_operativo),
            total_pedidos_confirmados = total_pedidos_confirmados + (CASE WHEN $10::boolean THEN 1 ELSE 0 END),
            carrito_actual_json = CASE WHEN $10::boolean THEN '[]'::jsonb ELSE carrito_actual_json END,
            carrito_actual_unidades = CASE WHEN $10::boolean THEN 0 ELSE carrito_actual_unidades END,
            carrito_actual_subtotal = CASE WHEN $10::boolean THEN 0.00 ELSE carrito_actual_subtotal END,
            ultimo_pedido_at = CASE WHEN $10::boolean THEN NOW() ELSE ultimo_pedido_at END,
            ultima_visita_at = NOW(),
            ultima_ip = COALESCE($11::varchar, ultima_ip),
            user_agent = COALESCE($12::text, user_agent)
         WHERE visitor_id = $1::varchar`,
        paramsVincular
    );

    if (updVis.rowCount === 0) {
        await runner.query(
            `INSERT INTO public.nodos_tienda_visitantes (
                visitor_id, primer_nodo_id, ultimo_nodo_id,
                vecino_id, vecino_nombre, vecino_telefono, telefono_normalizado, identificado_via,
                dispositivo_modo, sistema_operativo,
                total_sesiones, total_eventos, total_pedidos_confirmados,
                carrito_actual_json, carrito_actual_unidades, carrito_actual_subtotal,
                ultimo_pedido_at, ultima_ip, user_agent
            )
            SELECT
                $1::varchar, $2::int, $2::int,
                $3::int, $4::varchar, $5::varchar, $6::varchar, $7::varchar,
                $8::varchar, $9::varchar,
                1, 0, CASE WHEN $10::boolean THEN 1 ELSE 0 END,
                '[]'::jsonb, 0, 0.00,
                CASE WHEN $10::boolean THEN NOW() ELSE NULL::timestamptz END,
                $11::varchar, $12::text
            WHERE NOT EXISTS (
                SELECT 1 FROM public.nodos_tienda_visitantes WHERE visitor_id = $1::varchar
            )`,
            paramsVincular
        );
    }

    if (vId) {
        await runner.query(
            `UPDATE public.nodos_tienda_eventos
             SET vecino_id = $1::int
             WHERE visitor_id = $2 AND vecino_id IS NULL`,
            [vId, vid]
        );
    }

    return { ok: true, visitor_id: vid, vecino_id: vId, vecino_nombre: vNombre };
}

/**
 * Ingesta liviana de eventos de telemetría de tienda barrial y seguimiento.
 */
async function registrarEventoTelemetriaTienda(slugOrId, payload = {}, reqMeta = {}) {
    await asegurarEsquemaAnaliticaNodos();

    const tipoEvento = String(payload.tipo_evento || payload.evento || 'vista_tienda').trim().toLowerCase();
    if (!TIPOS_EVENTO_TIENDA_PERMITIDOS.has(tipoEvento)) {
        return { ok: false, omitido: true, motivo: 'tipo_evento_invalido' };
    }

    const nodo = await resolverNodoBasico(slugOrId || payload.nodo_slug || payload.nodo_id);
    if (!nodo) {
        return { ok: false, omitido: true, motivo: 'nodo_no_encontrado' };
    }

    const userAgent = limpiarTextoCorto(reqMeta.userAgent || payload.user_agent || '', 600) || '';
    const ipOrigen = limpiarTextoCorto(reqMeta.ip || '', 80);
    const uaInfo = detectarAgenteOSistemaNodo(userAgent);

    let visitorId = limpiarTextoCorto(payload.visitor_id, 80);
    if (!visitorId || visitorId.length < 6) {
        // Fallback determinístico efímero para bots sin localStorage
        const seed = `${ipOrigen || 'anon'}-${userAgent.slice(0, 48)}`;
        visitorId = 'anon_' + Buffer.from(seed).toString('hex').slice(0, 24);
    }
    const sessionId = limpiarTextoCorto(payload.session_id, 80);

    const utmSource = limpiarTextoCorto(payload.utm_source, 100);
    const utmMedium = limpiarTextoCorto(payload.utm_medium, 100);
    const utmCampaign = limpiarTextoCorto(payload.utm_campaign, 120);
    const refParam = limpiarTextoCorto(payload.ref, 80);
    const referrer = limpiarTextoCorto(payload.referrer, 500);

    const origenTrafico = detectarOrigenTraficoNodo({
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        ref_param: refParam,
        referrer,
        user_agent: userAgent
    });

    // Consultar visitante previo para identidad conocida y trazabilidad por nodo
    const prevRes = await db.query(
        `SELECT id, ultimo_nodo_id, vecino_id, vecino_nombre, vecino_telefono, telefono_normalizado,
                es_admin_gestor, etiqueta_dispositivo, ultimo_origen_trafico, ultima_visita_at
         FROM public.nodos_tienda_visitantes
         WHERE visitor_id = $1
         LIMIT 1`,
        [visitorId]
    );
    const prev = prevRes.rows[0] || null;

    // Clasificación por evento y por nodo (sin efecto sticky irreversible entre nodos ni al pasar a Cliente Real)
    const accionAdmin = String(payload.accion_admin_gestor || '').trim().toUpperCase();
    let esAdminGestor;
    if (accionAdmin === 'DESACTIVAR') {
        esAdminGestor = false;
    } else if (accionAdmin === 'ACTIVAR') {
        esAdminGestor = true;
    } else if (payload.es_admin_gestor !== undefined && payload.es_admin_gestor !== null) {
        esAdminGestor = Boolean(payload.es_admin_gestor);
    } else {
        // Fallback solo para llamadas sin flag explícito: heredar únicamente si pertenece al mismo nodo
        esAdminGestor = Boolean(prev?.es_admin_gestor && Number(prev?.ultimo_nodo_id) === Number(nodo.id));
    }

    const etiquetaDispositivo = esAdminGestor
        ? (limpiarTextoCorto(payload.etiqueta_dispositivo, 120) || (Number(prev?.ultimo_nodo_id) === Number(nodo.id) ? prev?.etiqueta_dispositivo : null) || null)
        : null;

    // Resolver identidad progresiva si vienen pistas (portal_token, tracking_token, teléfono o pedido_id)
    let vecinoId = prev?.vecino_id ? Number(prev.vecino_id) : null;
    let vecinoNombre = limpiarTextoCorto(payload.vecino_nombre, 160) || prev?.vecino_nombre || null;
    let vecinoTelefono = limpiarTextoCorto(payload.vecino_telefono, 60) || prev?.vecino_telefono || null;
    let telNorm = normalizarTelefonoSimple(vecinoTelefono || payload.telefono_normalizado || '') || prev?.telefono_normalizado || null;
    let identificadoVia = null;

    const portalTokenHint = limpiarTextoCorto(payload.portal_token, 80);
    const trackingTokenHint = limpiarTextoCorto(payload.tracking_token, 80);

    if (!vecinoId && portalTokenHint && portalTokenHint.length >= 16) {
        const rPt = await db.query(
            `SELECT id, nombre_completo, telefono_whatsapp, telefono_normalizado
             FROM public.nodos_vecinos WHERE portal_token = $1 LIMIT 1`,
            [portalTokenHint]
        );
        if (rPt.rows[0]) {
            vecinoId = Number(rPt.rows[0].id);
            vecinoNombre = rPt.rows[0].nombre_completo || vecinoNombre;
            vecinoTelefono = rPt.rows[0].telefono_whatsapp || vecinoTelefono;
            telNorm = rPt.rows[0].telefono_normalizado || telNorm;
            identificadoVia = 'MI_CUENTA';
        }
    }

    if (!vecinoId && trackingTokenHint && trackingTokenHint.length >= 12) {
        const rTk = await db.query(
            `SELECT npv.vecino_id, npv.vecino_nombre, npv.vecino_telefono, nv.telefono_normalizado
             FROM public.nodos_pedidos_vecinos npv
             LEFT JOIN public.nodos_vecinos nv ON nv.id = npv.vecino_id
             WHERE npv.tracking_token = $1
             LIMIT 1`,
            [trackingTokenHint]
        );
        if (rTk.rows[0]) {
            vecinoId = rTk.rows[0].vecino_id ? Number(rTk.rows[0].vecino_id) : null;
            vecinoNombre = rTk.rows[0].vecino_nombre || vecinoNombre;
            vecinoTelefono = rTk.rows[0].vecino_telefono || vecinoTelefono;
            telNorm = rTk.rows[0].telefono_normalizado || normalizarTelefonoSimple(vecinoTelefono || '') || telNorm;
            identificadoVia = 'SEGUIMIENTO_TOKEN';
        }
    }

    if (!vecinoId && telNorm && telNorm.length >= 7) {
        const rTel = await db.query(
            `SELECT id, nombre_completo, telefono_whatsapp, telefono_normalizado
             FROM public.nodos_vecinos
             WHERE nodo_id = $1::int AND telefono_normalizado = $2
             LIMIT 1`,
            [nodo.id, telNorm]
        );
        if (rTel.rows[0]) {
            vecinoId = Number(rTel.rows[0].id);
            vecinoNombre = rTel.rows[0].nombre_completo || vecinoNombre;
            vecinoTelefono = rTel.rows[0].telefono_whatsapp || vecinoTelefono;
            identificadoVia = identificadoVia || 'TELEFONO_LOCAL';
        }
    }

    const esCarritoVaciar = tipoEvento === 'carrito_vaciar';
    const tieneSnapshot = esCarritoVaciar || Array.isArray(payload.carrito_snapshot);
    const snapshotLimpio = esCarritoVaciar
        ? []
        : (Array.isArray(payload.carrito_snapshot) ? sanitizarSnapshotCarrito(payload.carrito_snapshot) : null);
    const carritoUnidades = esCarritoVaciar
        ? 0
        : (payload.carrito_unidades !== undefined
            ? Math.max(0, Math.round(Number(payload.carrito_unidades || 0)))
            : (snapshotLimpio ? snapshotLimpio.reduce((acc, x) => acc + x.cantidad, 0) : null));
    const carritoSubtotal = esCarritoVaciar
        ? 0
        : (payload.carrito_subtotal !== undefined
            ? Math.max(0, Number(Number(payload.carrito_subtotal || 0).toFixed(2)))
            : (snapshotLimpio ? Number(snapshotLimpio.reduce((acc, x) => acc + x.subtotal, 0).toFixed(2)) : null));

    const esEventoCarrito = ['carrito_agregar', 'carrito_quitar', 'carrito_vaciar', 'inicio_checkout'].includes(tipoEvento) ||
        (['checkout_paso', 'checkout_abandono'].includes(tipoEvento) && tieneSnapshot);
    const esPedidoConfirmado = tipoEvento === 'pedido_confirmado';

    const nuevaSesion = !prev || !prev.ultima_visita_at ||
        (Date.now() - new Date(prev.ultima_visita_at).getTime() > 30 * 60 * 1000);

    const origenPersistir = (origenTrafico !== 'Directo' || !prev?.ultimo_origen_trafico)
        ? origenTrafico
        : prev.ultimo_origen_trafico;

    const paramsTelemetria = [
        visitorId,
        nodo.id,
        vecinoId,
        vecinoNombre,
        vecinoTelefono,
        telNorm,
        identificadoVia || (esPedidoConfirmado ? 'PEDIDO' : null),
        esAdminGestor,
        etiquetaDispositivo,
        uaInfo.modo,
        uaInfo.sistema,
        origenPersistir,
        esPedidoConfirmado,
        esPedidoConfirmado ? '[]' : (snapshotLimpio ? JSON.stringify(snapshotLimpio) : null),
        esPedidoConfirmado ? 0 : carritoUnidades,
        esPedidoConfirmado ? 0 : carritoSubtotal,
        esEventoCarrito,
        ipOrigen,
        userAgent || null,
        nuevaSesion
    ];

    const updTelVis = await db.query(
        `UPDATE public.nodos_tienda_visitantes SET
            ultimo_nodo_id = $2::int,
            vecino_id = COALESCE($3::int, vecino_id),
            vecino_nombre = COALESCE($4::varchar, vecino_nombre),
            vecino_telefono = COALESCE($5::varchar, vecino_telefono),
            telefono_normalizado = COALESCE($6::varchar, telefono_normalizado),
            identificado_via = COALESCE($7::varchar, identificado_via),
            es_admin_gestor = $8::boolean,
            etiqueta_dispositivo = CASE WHEN $8::boolean THEN COALESCE($9::varchar, etiqueta_dispositivo) ELSE NULL END,
            dispositivo_modo = $10::varchar,
            sistema_operativo = $11::varchar,
            ultimo_origen_trafico = $12::varchar,
            total_sesiones = total_sesiones + (CASE WHEN $20::boolean THEN 1 ELSE 0 END),
            total_eventos = total_eventos + 1,
            total_pedidos_confirmados = total_pedidos_confirmados + (CASE WHEN $13::boolean THEN 1 ELSE 0 END),
            carrito_actual_json = CASE
                WHEN $13::boolean THEN '[]'::jsonb
                WHEN $17::boolean AND $14::jsonb IS NOT NULL THEN $14::jsonb
                ELSE carrito_actual_json
            END,
            carrito_actual_unidades = CASE
                WHEN $13::boolean THEN 0
                WHEN $17::boolean AND $15::int IS NOT NULL THEN $15::int
                ELSE carrito_actual_unidades
            END,
            carrito_actual_subtotal = CASE
                WHEN $13::boolean THEN 0.00
                WHEN $17::boolean AND $16::numeric IS NOT NULL THEN $16::numeric
                ELSE carrito_actual_subtotal
            END,
            carrito_actual_nodo_id = CASE
                WHEN $13::boolean THEN carrito_actual_nodo_id
                WHEN $17::boolean THEN $2::int
                ELSE carrito_actual_nodo_id
            END,
            carrito_actualizado_at = CASE
                WHEN $13::boolean OR $17::boolean THEN NOW()
                ELSE carrito_actualizado_at
            END,
            ultimo_pedido_at = CASE
                WHEN $13::boolean THEN NOW()
                ELSE ultimo_pedido_at
            END,
            ultima_visita_at = NOW(),
            ultima_ip = COALESCE($18::varchar, ultima_ip),
            user_agent = COALESCE($19::text, user_agent)
         WHERE visitor_id = $1::varchar`,
        paramsTelemetria
    );

    if (updTelVis.rowCount === 0) {
        await db.query(
            `INSERT INTO public.nodos_tienda_visitantes (
                visitor_id, primer_nodo_id, ultimo_nodo_id,
                vecino_id, vecino_nombre, vecino_telefono, telefono_normalizado, identificado_via,
                es_admin_gestor, etiqueta_dispositivo, dispositivo_modo, sistema_operativo, ultimo_origen_trafico,
                total_sesiones, total_eventos, total_pedidos_confirmados,
                carrito_actual_json, carrito_actual_unidades, carrito_actual_subtotal, carrito_actual_nodo_id, carrito_actualizado_at,
                ultimo_pedido_at, ultima_ip, user_agent
            )
            SELECT
                $1::varchar, $2::int, $2::int,
                $3::int, $4::varchar, $5::varchar, $6::varchar, $7::varchar,
                $8::boolean, $9::varchar, $10::varchar, $11::varchar, $12::varchar,
                1, 1, CASE WHEN $13::boolean THEN 1 ELSE 0 END,
                COALESCE($14::jsonb, '[]'::jsonb),
                COALESCE($15::int, 0),
                COALESCE($16::numeric, 0.00),
                CASE WHEN $17::boolean THEN $2::int ELSE NULL::int END,
                CASE WHEN $17::boolean THEN NOW() ELSE NULL::timestamptz END,
                CASE WHEN $13::boolean THEN NOW() ELSE NULL::timestamptz END,
                $18::varchar, $19::text
            WHERE NOT EXISTS (
                SELECT 1 FROM public.nodos_tienda_visitantes WHERE visitor_id = $1::varchar
            )`,
            paramsTelemetria.slice(0, 19)
        );
    }

    const pedidoId = payload.pedido_id && /^\d+$/.test(String(payload.pedido_id)) ? Number(payload.pedido_id) : null;
    const ofertaId = payload.oferta_id && /^\d+$/.test(String(payload.oferta_id)) ? Number(payload.oferta_id) : null;
    const cantidadItem = payload.cantidad !== undefined && payload.cantidad !== null
        ? Math.round(Number(payload.cantidad || 0))
        : null;

    await db.query(
        `INSERT INTO public.nodos_tienda_eventos (
            nodo_id, nodo_slug, visitor_id, session_id, vecino_id,
            tipo_evento, es_admin_gestor, es_ia_bot,
            origen_trafico, utm_source, utm_medium, utm_campaign, referrer,
            dispositivo_modo, sistema_operativo,
            categoria_nombre, termino_busqueda,
            oferta_id, sku_nodo, producto_nombre, cantidad,
            carrito_unidades, carrito_subtotal, carrito_snapshot,
            pedido_id, codigo_pedido, detalle, ip_origen, user_agent
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8,
            $9, $10, $11, $12, $13,
            $14, $15,
            $16, $17,
            $18, $19, $20, $21,
            $22, $23, $24::jsonb,
            $25, $26, $27, $28, $29
        )`,
        [
            nodo.id,
            nodo.slug,
            visitorId,
            sessionId,
            vecinoId,
            tipoEvento,
            esAdminGestor,
            uaInfo.esIaBot,
            origenPersistir,
            utmSource,
            utmMedium,
            utmCampaign,
            referrer,
            uaInfo.modo,
            uaInfo.sistema,
            limpiarTextoCorto(payload.categoria_nombre, 120),
            limpiarTextoCorto(payload.termino_busqueda, 200),
            ofertaId,
            limpiarTextoCorto(payload.sku_nodo, 60),
            limpiarTextoCorto(payload.producto_nombre, 180),
            cantidadItem,
            carritoUnidades || 0,
            carritoSubtotal || 0,
            snapshotLimpio ? JSON.stringify(snapshotLimpio) : null,
            pedidoId,
            limpiarTextoCorto(payload.codigo_pedido, 50),
            limpiarTextoCorto(payload.detalle, 300),
            ipOrigen,
            userAgent || null
        ]
    );

    if (vecinoId && !prev?.vecino_id) {
        await db.query(
            `UPDATE public.nodos_tienda_eventos
             SET vecino_id = $1::int
             WHERE visitor_id = $2 AND vecino_id IS NULL`,
            [vecinoId, visitorId]
        );
    }

    return {
        ok: true,
        nodo_id: nodo.id,
        nodo_slug: nodo.slug,
        visitor_id: visitorId,
        es_admin_gestor: esAdminGestor,
        origen_trafico: origenPersistir,
        identificado: Boolean(vecinoId || vecinoNombre)
    };
}

/**
 * VISTA A — Listado y Resumen Integral de Nodos (Modalidad Contable + Resumen Comercial + Pulso Hoy).
 */
async function obtenerResumenCentroNodos({ calcularProximaEntregaFn = null } = {}) {
    await asegurarEsquemaAnaliticaNodos();

    const nodosRes = await db.query(`
        SELECT
            nm.*,
            bc_propia.codigo_bunker_cliente AS propia_codigo_bc,
            bc_propia.cliente_nombre AS propia_nombre_bc,
            bc_propia.razon_social AS propia_razon_social_bc,
            fcc_propia.id AS propia_cc_id,
            fcc_propia.saldo AS propia_cc_saldo,
            fcc_propia.estado AS propia_cc_estado,
            bc_madre.id AS madre_bc_id,
            bc_madre.codigo_bunker_cliente AS madre_codigo_bc,
            bc_madre.cliente_nombre AS madre_nombre_bc,
            bc_madre.razon_social AS madre_razon_social_bc,
            fcc_madre.id AS madre_cc_id,
            fcc_madre.saldo AS madre_cc_saldo,
            fcc_madre.estado AS madre_cc_estado,
            COALESCE(ped_stats.pedidos_activos, 0)::int AS pedidos_activos,
            COALESCE(ped_stats.pedidos_historicos, 0)::int AS pedidos_historicos,
            COALESCE(ped_stats.facturacion_vecinos, 0)::numeric(14,2) AS facturacion_vecinos,
            COALESCE(ped_stats.facturacion_base_lamda, 0)::numeric(14,2) AS facturacion_base_lamda,
            COALESCE(ped_stats.retencion_fiscal_margen, 0)::numeric(14,2) AS retencion_fiscal_margen,
            COALESCE(ped_stats.ganancia_gestor, 0)::numeric(14,2) AS ganancia_gestor,
            COALESCE(ped_stats.pedidos_hoy, 0)::int AS pedidos_hoy,
            COALESCE(lote_stats.canastos_en_curso, 0)::int AS canastos_en_curso,
            COALESCE(lote_stats.canastos_totales, 0)::int AS canastos_totales,
            COALESCE(of_stats.ofertas_publicadas, 0)::int AS ofertas_publicadas,
            COALESCE(vec_stats.vecinos_registrados, 0)::int AS vecinos_registrados,
            COALESCE(tel_stats.visitantes_reales_hoy, 0)::int AS visitantes_reales_hoy,
            COALESCE(tel_stats.visitantes_admin_hoy, 0)::int AS visitantes_admin_hoy,
            COALESCE(tel_stats.visitantes_reales_7d, 0)::int AS visitantes_reales_7d,
            COALESCE(tel_stats.visitantes_admin_7d, 0)::int AS visitantes_admin_7d,
            COALESCE(tel_stats.eventos_reales_7d, 0)::int AS eventos_reales_7d,
            COALESCE(tel_stats.eventos_admin_7d, 0)::int AS eventos_admin_7d,
            tel_stats.ultimo_evento_arg AS ultimo_evento_arg,
            COALESCE(cart_stats.carritos_activos, 0)::int AS carritos_sin_cerrar,
            COALESCE(cart_stats.carritos_activos_admin, 0)::int AS carritos_sin_cerrar_admin
        FROM public.nodos_maestro nm
        LEFT JOIN public.bunker_clientes bc_propia ON bc_propia.id = nm.bunker_cliente_id
        LEFT JOIN LATERAL (
            SELECT id, saldo, estado
            FROM public.factura_cuentas_corrientes
            WHERE codigo_bunker_cliente = COALESCE(bc_propia.codigo_bunker_cliente, nm.codigo_bunker_cliente)
            ORDER BY CASE WHEN nombre_cuenta = 'Cuenta Principal' THEN 0 ELSE 1 END, id ASC
            LIMIT 1
        ) fcc_propia ON true
        LEFT JOIN public.bunker_clientes bc_madre ON bc_madre.id = nm.cliente_madre_bunker_id
        LEFT JOIN LATERAL (
            SELECT id, saldo, estado
            FROM public.factura_cuentas_corrientes
            WHERE codigo_bunker_cliente = bc_madre.codigo_bunker_cliente
              AND COALESCE(estado, 'ACTIVA') = 'ACTIVA'
            ORDER BY CASE WHEN nombre_cuenta = 'Cuenta Principal' THEN 0 ELSE 1 END, id ASC
            LIMIT 1
        ) fcc_madre ON true
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE estado_operativo NOT IN ('ENTREGADO_VECINO', 'ANULADO')) AS pedidos_activos,
                COUNT(*) FILTER (WHERE estado_operativo <> 'ANULADO') AS pedidos_historicos,
                COALESCE(SUM(total_vecino) FILTER (WHERE estado_operativo <> 'ANULADO'), 0) AS facturacion_vecinos,
                COALESCE(SUM(total_base_lamda) FILTER (WHERE estado_operativo <> 'ANULADO'), 0) AS facturacion_base_lamda,
                COALESCE(SUM(COALESCE(retencion_fiscal_margen, 0)) FILTER (WHERE estado_operativo <> 'ANULADO'), 0) AS retencion_fiscal_margen,
                COALESCE(SUM(ganancia_total_gestor) FILTER (WHERE estado_operativo <> 'ANULADO'), 0) AS ganancia_gestor,
                COUNT(*) FILTER (
                    WHERE estado_operativo <> 'ANULADO'
                      AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date =
                          (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
                ) AS pedidos_hoy
            FROM public.nodos_pedidos_vecinos
            WHERE nodo_id = nm.id
        ) ped_stats ON true
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE COALESCE(liquidacion_cerrada, false) = false) AS canastos_en_curso,
                COUNT(*) AS canastos_totales
            FROM public.nodos_lotes_estacion
            WHERE nodo_id = nm.id
        ) lote_stats ON true
        LEFT JOIN LATERAL (
            SELECT COUNT(*) FILTER (WHERE publicado_tienda = true) AS ofertas_publicadas
            FROM public.nodos_ofertas_gestor
            WHERE nodo_id = nm.id
        ) of_stats ON true
        LEFT JOIN LATERAL (
            SELECT COUNT(*) FILTER (WHERE COALESCE(activo, true) = true) AS vecinos_registrados
            FROM public.nodos_vecinos
            WHERE nodo_id = nm.id
        ) vec_stats ON true
        LEFT JOIN LATERAL (
            SELECT
                COUNT(DISTINCT visitor_id) FILTER (
                    WHERE es_admin_gestor = false
                      AND es_ia_bot = false
                      AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date =
                          (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
                ) AS visitantes_reales_hoy,
                COUNT(DISTINCT visitor_id) FILTER (
                    WHERE es_admin_gestor = true
                      AND es_ia_bot = false
                      AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date =
                          (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
                ) AS visitantes_admin_hoy,
                COUNT(DISTINCT visitor_id) FILTER (
                    WHERE es_admin_gestor = false
                      AND es_ia_bot = false
                      AND created_at >= NOW() - INTERVAL '7 days'
                ) AS visitantes_reales_7d,
                COUNT(DISTINCT visitor_id) FILTER (
                    WHERE es_admin_gestor = true
                      AND es_ia_bot = false
                      AND created_at >= NOW() - INTERVAL '7 days'
                ) AS visitantes_admin_7d,
                COUNT(*) FILTER (
                    WHERE es_admin_gestor = false
                      AND es_ia_bot = false
                      AND created_at >= NOW() - INTERVAL '7 days'
                ) AS eventos_reales_7d,
                COUNT(*) FILTER (
                    WHERE es_admin_gestor = true
                      AND es_ia_bot = false
                      AND created_at >= NOW() - INTERVAL '7 days'
                ) AS eventos_admin_7d,
                TO_CHAR(
                    MAX(created_at) FILTER (WHERE es_ia_bot = false) AT TIME ZONE 'America/Argentina/Buenos_Aires',
                    'YYYY-MM-DD HH24:MI'
                ) AS ultimo_evento_arg
            FROM public.nodos_tienda_eventos
            WHERE nodo_id = nm.id
        ) tel_stats ON true
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE COALESCE(last_c.es_admin_gestor, v.es_admin_gestor) = false) AS carritos_activos,
                COUNT(*) FILTER (WHERE COALESCE(last_c.es_admin_gestor, v.es_admin_gestor) = true) AS carritos_activos_admin
            FROM public.nodos_tienda_visitantes v
            LEFT JOIN LATERAL (
                SELECT e_c.es_admin_gestor
                FROM public.nodos_tienda_eventos e_c
                WHERE e_c.visitor_id = v.visitor_id
                  AND e_c.nodo_id = v.carrito_actual_nodo_id
                  AND e_c.tipo_evento IN ('carrito_agregar', 'carrito_quitar', 'carrito_vaciar', 'inicio_checkout', 'checkout_paso', 'checkout_abandono', 'pedido_confirmado')
                ORDER BY e_c.created_at DESC, e_c.id DESC
                LIMIT 1
            ) last_c ON true
            WHERE v.carrito_actual_nodo_id = nm.id
              AND v.carrito_actual_unidades > 0
        ) cart_stats ON true
        ORDER BY nm.activo DESC, nm.id ASC
    `);

    const nodos = nodosRes.rows.map((r) => {
        const usaMadre = Boolean(r.usar_cuenta_madre_unificada && r.madre_bc_id);
        const proximaEntrega = typeof calcularProximaEntregaFn === 'function'
            ? calcularProximaEntregaFn(r.config_ventanas_corte)
            : null;

        const rawPerfil = String(r.perfil_operativo || 'VECINOS').trim().toLowerCase();
        const perfilCanon = (rawPerfil === 'redes' || rawPerfil === 'ecommerce_fulfillment' || rawPerfil === 'creador_online' || rawPerfil === 'fulfillment_lamda')
            ? 'REDES'
            : ((rawPerfil === 'locales' || rawPerfil === 'local' || rawPerfil === 'comercio_pickup' || rawPerfil === 'pickup_point' || rawPerfil === 'local_fisico')
                ? 'LOCALES'
                : 'VECINOS');
        const presetMod = perfilCanon === 'REDES'
            ? {
                retiro_punto: false, reparto_zonal: false, hoja_de_ruta: false, envio_paqueteria: true,
                venta_continua_24_7: true, despacho_desde_lamda: true, canasto_consolidado: false,
                cobro_efectivo_entrega: false, mostrador_entrega_rapida: false,
                checkout_omitir_paso_entrega_si_unico: true, mostrar_horarios_comerciales: false,
                ocultar_franja_info_superior: false,
                abastecimiento_modo: 'despacho_correo', etiqueta_zpl_formato: 'postal_fulfillment'
            }
            : (perfilCanon === 'LOCALES'
                ? {
                    retiro_punto: true, reparto_zonal: false, hoja_de_ruta: false, envio_paqueteria: false,
                    venta_continua_24_7: false, despacho_desde_lamda: false, canasto_consolidado: true,
                    cobro_efectivo_entrega: false, mostrador_entrega_rapida: true,
                    checkout_omitir_paso_entrega_si_unico: true, mostrar_horarios_comerciales: true,
                    ocultar_franja_info_superior: true,
                    abastecimiento_modo: 'camioneta_lamda', etiqueta_zpl_formato: 'mostrador_local'
                }
                : {
                    retiro_punto: true, reparto_zonal: true, hoja_de_ruta: true, envio_paqueteria: false,
                    venta_continua_24_7: false, despacho_desde_lamda: false, canasto_consolidado: true,
                    cobro_efectivo_entrega: true, mostrador_entrega_rapida: false,
                    checkout_omitir_paso_entrega_si_unico: true, mostrar_horarios_comerciales: false,
                    ocultar_franja_info_superior: false,
                    abastecimiento_modo: 'retiro_deposito', etiqueta_zpl_formato: 'vecinal'
                });
        const modGuard = (r.modulos_activos && typeof r.modulos_activos === 'object' && !Array.isArray(r.modulos_activos)) ? r.modulos_activos : {};
        const cobroEfvoVal = Boolean(
            r.cobro_efectivo_entrega ??
            modGuard.cobro_efectivo_entrega ??
            presetMod.cobro_efectivo_entrega
        );

        return {
            id: Number(r.id),
            codigo_nodo: r.codigo_nodo,
            slug: r.slug,
            slug_historico: r.slug_historico || null,
            nombre_marca: r.nombre_marca,
            bajada_marca: r.bajada_marca || null,
            subtitulo_marca: r.subtitulo_marca || '',
            gestor_nombre: r.gestor_nombre || '',
            gestor_telefono: r.gestor_telefono || '',
            gestor_email: r.gestor_email || '',
            barrio_zona: r.barrio_zona || '',
            direccion_retiro: r.direccion_retiro || '',
            color_primario: r.color_primario || '#16a34a',
            tema_visual: require('./nodosBarrialesService').enriquecerTemaVisualConVersionAssets(r.tema_visual),
            activo: r.activo !== false,
            perfil_operativo: perfilCanon,
            cobro_efectivo_entrega: cobroEfvoVal,
            modulos_activos: {
                ...presetMod,
                ...modGuard,
                cobro_efectivo_entrega: cobroEfvoVal
            },
            config_paqueteria: (r.config_paqueteria && typeof r.config_paqueteria === 'object' && !Array.isArray(r.config_paqueteria))
                ? r.config_paqueteria
                : {},
            config_retiro_local: (r.config_retiro_local && typeof r.config_retiro_local === 'object' && !Array.isArray(r.config_retiro_local))
                ? r.config_retiro_local
                : {},
            config_video_bienvenida: require('./nodosFotosService').normalizarConfigVideoBienvenida(r.config_video_bienvenida),
            config_perfil_publico: require('./nodosBarrialesService').normalizarConfigPerfilPublico(r.config_perfil_publico),
            diccionario_textos: (r.diccionario_textos && typeof r.diccionario_textos === 'object' && !Array.isArray(r.diccionario_textos))
                ? r.diccionario_textos
                : {},
            plantilla_origen_id: r.plantilla_origen_id ? Number(r.plantilla_origen_id) : null,
            permitir_retiro_nodo: r.permitir_retiro_nodo !== false,
            permitir_reparto_propio: Boolean(r.permitir_reparto_propio ?? r.permitir_envio_barrial),
            permitir_encomienda: Boolean(r.permitir_encomienda),
            cargo_envio_barrial: Number(r.cargo_envio_barrial || 0),
            margen_gestor_default_pct: Number(r.margen_gestor_default_pct ?? 28),
            alicuota_iva_margen_pct: Number(r.alicuota_iva_margen_pct ?? 21),
            alicuota_iibb_margen_pct: Number(r.alicuota_iibb_margen_pct ?? 4),
            mostrar_ingredientes_tienda: r.mostrar_ingredientes_tienda !== false,
            usa_cuenta_compartida: r.usa_cuenta_compartida !== false,
            alias_bancario_display: r.alias_bancario_display || '',
            contabilidad: {
                usar_cuenta_madre_unificada: usaMadre,
                modalidad: usaMadre ? 'CUENTA_MADRE_UNIFICADA' : 'SUBCUENTA_PROPIA',
                modalidad_label: usaMadre
                    ? `Cuenta Madre Unificada (${r.madre_codigo_bc})`
                    : `Subcuenta Propia (${r.propia_codigo_bc || r.codigo_bunker_cliente || 'S/C'})`,
                bunker_cliente_operativo_id: usaMadre ? Number(r.madre_bc_id) : (r.bunker_cliente_id ? Number(r.bunker_cliente_id) : null),
                codigo_cuenta_operativa: usaMadre ? r.madre_codigo_bc : (r.propia_codigo_bc || r.codigo_bunker_cliente),
                titular_cuenta_operativa: usaMadre
                    ? (r.madre_nombre_bc || r.madre_razon_social_bc || '')
                    : (r.propia_nombre_bc || r.nombre_marca || ''),
                cuenta_corriente_operativa_id: usaMadre
                    ? (r.madre_cc_id ? Number(r.madre_cc_id) : null)
                    : (r.propia_cc_id ? Number(r.propia_cc_id) : null),
                saldo_cuenta_operativa: Number(usaMadre ? (r.madre_cc_saldo || 0) : (r.propia_cc_saldo || 0)),
                codigo_subcuenta_nodo: r.propia_codigo_bc || r.codigo_bunker_cliente || null,
                estado_subcuenta_nodo: r.propia_cc_estado || (usaMadre ? 'ARCHIVADA_UNIFICADA' : 'ACTIVA'),
                cliente_madre_bunker_id: r.madre_bc_id ? Number(r.madre_bc_id) : null,
                codigo_cliente_madre: r.madre_codigo_bc || null,
                nombre_cliente_madre: r.madre_nombre_bc || r.madre_razon_social_bc || null
            },
            comercial: {
                pedidos_activos: Number(r.pedidos_activos || 0),
                pedidos_historicos: Number(r.pedidos_historicos || 0),
                pedidos_hoy: Number(r.pedidos_hoy || 0),
                facturacion_vecinos: Number(r.facturacion_vecinos || 0),
                facturacion_base_lamda: Number(r.facturacion_base_lamda || 0),
                retencion_fiscal_margen: Number(r.retencion_fiscal_margen || 0),
                ganancia_gestor: Number(r.ganancia_gestor || 0),
                canastos_en_curso: Number(r.canastos_en_curso || 0),
                canastos_totales: Number(r.canastos_totales || 0),
                ofertas_publicadas: Number(r.ofertas_publicadas || 0),
                vecinos_registrados: Number(r.vecinos_registrados || 0),
                visitantes_reales_hoy: Number(r.visitantes_reales_hoy || 0),
                visitantes_admin_hoy: Number(r.visitantes_admin_hoy || 0),
                visitantes_reales_7d: Number(r.visitantes_reales_7d || 0),
                visitantes_admin_7d: Number(r.visitantes_admin_7d || 0),
                eventos_reales_7d: Number(r.eventos_reales_7d || 0),
                eventos_admin_7d: Number(r.eventos_admin_7d || 0),
                ultimo_evento_arg: r.ultimo_evento_arg || null,
                carritos_sin_cerrar: Number(r.carritos_sin_cerrar || 0),
                carritos_sin_cerrar_admin: Number(r.carritos_sin_cerrar_admin || 0),
                proxima_entrega: proximaEntrega ? {
                    label_completo: proximaEntrega.asignada?.label_completo || '',
                    fecha_entrega_iso: proximaEntrega.asignada?.fecha_entrega_iso || '',
                    ventana_retiro: proximaEntrega.asignada?.ventana_retiro || '',
                    corte_texto: proximaEntrega.asignada?.corte_texto || '',
                    paso_horario_corte: Boolean(proximaEntrega.paso_horario_corte)
                } : null
            }
        };
    });

    return {
        ok: true,
        fecha_servidor: new Date().toISOString(),
        modo_laboratorio: String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase() === 'true'
            && String(process.env.DB_NAME || '').trim() === 'etiquetas_pruebas',
        total_nodos: nodos.length,
        nodos
    };
}

/**
 * VISTA A (Detalle) — Ficha Integral de un Nodo:
 * Movimientos contables filtrados por referencia del nodo (cuando usa Cuenta Madre Unificada)
 * o de su subcuenta propia, más Lotes/Canastos, Remitos/Presupuestos, Liquidaciones y Pedidos.
 */
async function obtenerFichaDetalleNodo(idOrSlug, { calcularProximaEntregaFn = null } = {}) {
    await asegurarEsquemaAnaliticaNodos();
    const baseNodo = await resolverNodoBasico(idOrSlug);
    if (!baseNodo) {
        throw new Error('Nodo no encontrado.');
    }

    const resumen = await obtenerResumenCentroNodos({ calcularProximaEntregaFn });
    const fichaNodo = resumen.nodos.find((n) => Number(n.id) === Number(baseNodo.id));
    if (!fichaNodo) {
        throw new Error('No se pudo construir el resumen del Nodo.');
    }

    const nodoId = Number(fichaNodo.id);
    const usaMadre = Boolean(fichaNodo.contabilidad.usar_cuenta_madre_unificada);
    const ccOperativaId = fichaNodo.contabilidad.cuenta_corriente_operativa_id;

    // Obtener también el id de la subcuenta propia por si existieran asientos previos al archivo
    const subCcRes = await db.query(
        `SELECT id FROM public.factura_cuentas_corrientes
         WHERE codigo_bunker_cliente = $1
         ORDER BY id ASC LIMIT 1`,
        [fichaNodo.contabilidad.codigo_subcuenta_nodo || '']
    );
    const subCcId = subCcRes.rows[0]?.id ? Number(subCcRes.rows[0].id) : -1;

    const nombreCortoMarca = String(fichaNodo.nombre_marca || '')
        .split('·')[0]
        .trim() || fichaNodo.nombre_marca;

    let movimientosContablesNodo = [];
    let movimientosGeneralesMadre = [];

    if (usaMadre && ccOperativaId) {
        // Movimientos en Cuenta Madre (ej. CB-0006) que corresponden específicamente al Nodo
        const movNodoRes = await db.query(
            `SELECT
                fccm.id,
                fccm.cuenta_corriente_id,
                fccm.tipo_movimiento,
                fccm.monto,
                fccm.saldo_resultante,
                fccm.tipo_comprobante,
                fccm.comprobante_id,
                fccm.descripcion,
                fccm.fecha_movimiento,
                fccm.creado_en,
                fccm.presupuesto_id,
                fccm.origen_tipo,
                fccm.metadatos
             FROM public.factura_cuenta_corriente_movimientos fccm
             WHERE (
                 fccm.cuenta_corriente_id = $1::int
                 AND (
                     (fccm.metadatos->>'nodo_id') = $2::text
                     OR UPPER(COALESCE(fccm.metadatos->>'codigo_nodo', '')) = UPPER($3)
                     OR fccm.id IN (
                         SELECT movimiento_cc_id FROM public.nodos_lotes_estacion WHERE nodo_id = $2::int AND movimiento_cc_id IS NOT NULL
                         UNION
                         SELECT movimiento_cc_id FROM public.nodos_liquidaciones_lote WHERE nodo_id = $2::int AND movimiento_cc_id IS NOT NULL
                         UNION
                         SELECT movimiento_cc_madre_id FROM public.nodos_liquidaciones_lote WHERE nodo_id = $2::int AND movimiento_cc_madre_id IS NOT NULL
                         UNION
                         SELECT movimiento_pago_cc_id FROM public.nodos_pedidos_vecinos WHERE nodo_id = $2::int AND movimiento_pago_cc_id IS NOT NULL
                     )
                     OR fccm.presupuesto_id IN (
                         SELECT presupuesto_id_local FROM public.nodos_lotes_estacion WHERE nodo_id = $2::int AND presupuesto_id_local IS NOT NULL
                         UNION
                         SELECT presupuesto_id_local FROM public.nodos_pedidos_vecinos WHERE nodo_id = $2::int AND presupuesto_id_local IS NOT NULL
                     )
                     OR fccm.descripcion ILIKE ('%Nodo ' || $4 || '%')
                     OR fccm.descripcion ILIKE ('%' || $3 || '%')
                     OR ($5 <> '' AND fccm.descripcion ILIKE '%Lo de Mati%')
                 )
             )
             OR (fccm.cuenta_corriente_id = $6::int)
             ORDER BY COALESCE(fccm.fecha_movimiento, fccm.creado_en) DESC, fccm.id DESC
             LIMIT 60`,
            [
                ccOperativaId,
                nodoId,
                fichaNodo.codigo_nodo,
                nombreCortoMarca,
                fichaNodo.slug_historico === 'lo-de-mati' ? 'lo-de-mati' : '',
                subCcId
            ]
        );
        movimientosContablesNodo = movNodoRes.rows;

        // Últimos movimientos globales de la Cuenta Madre para contexto rápido de Tesorería
        const movMadreRes = await db.query(
            `SELECT id, tipo_movimiento, monto, saldo_resultante, tipo_comprobante,
                    descripcion, fecha_movimiento, creado_en, presupuesto_id, origen_tipo
             FROM public.factura_cuenta_corriente_movimientos
             WHERE cuenta_corriente_id = $1::int
             ORDER BY COALESCE(fecha_movimiento, creado_en) DESC, id DESC
             LIMIT 25`,
            [ccOperativaId]
        );
        movimientosGeneralesMadre = movMadreRes.rows;
    } else if (ccOperativaId) {
        const movPropiaRes = await db.query(
            `SELECT id, cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                    tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                    creado_en, presupuesto_id, origen_tipo, metadatos
             FROM public.factura_cuenta_corriente_movimientos
             WHERE cuenta_corriente_id = $1::int
             ORDER BY COALESCE(fecha_movimiento, creado_en) DESC, id DESC
             LIMIT 60`,
            [ccOperativaId]
        );
        movimientosContablesNodo = movPropiaRes.rows;
    }

    const [movInternosRes, canastosRes, liquidacionesRes, remitosRes, pedidosRes] = await Promise.all([
        db.query(
            `SELECT id, lote_canasto_id, pedido_vecino_id, tipo_movimiento, signo,
                    monto, saldo_resultante, concepto, referencia_externa, created_at
             FROM public.nodos_movimientos_cta_cte
             WHERE nodo_id = $1::int
             ORDER BY id DESC
             LIMIT 50`,
            [nodoId]
        ),
        db.query(
            `SELECT id, codigo_canasto, fecha_entrega_iso, fecha_entrega_label, ventana_horaria_label,
                    estado_canasto, total_bolsas, bolsas_armadas, total_kilos_lote,
                    total_base_lamda, total_venta_vecinos, ganancia_estimada_gestor,
                    debito_cta_cte_registrado, movimiento_cc_id, liquidacion_cerrada,
                    liquidacion_id, presupuesto_id_local, id_presupuesto_ext,
                    secuencia_operativa_lamda, created_at
             FROM public.nodos_lotes_estacion
             WHERE nodo_id = $1::int
             ORDER BY id DESC
             LIMIT 40`,
            [nodoId]
        ),
        db.query(
            `SELECT nll.*, nle.codigo_canasto, nle.fecha_entrega_label
             FROM public.nodos_liquidaciones_lote nll
             LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = nll.lote_canasto_id
             WHERE nll.nodo_id = $1::int
             ORDER BY nll.id DESC
             LIMIT 40`,
            [nodoId]
        ),
        db.query(
            `SELECT p.id, p.id_presupuesto_ext, p.fecha, p.fecha_entrega, p.tipo_comprobante,
                    p.secuencia, p.estado_logistico, p.nota,
                    COALESCE(SUM(pd.cantidad * pd.precio1), 0)::numeric(14,2) AS importe_estimado
             FROM public.presupuestos p
             LEFT JOIN public.presupuestos_detalles pd ON pd.id_presupuesto = p.id
             WHERE COALESCE(p.activo, true) = true
               AND (
                   p.id IN (
                       SELECT presupuesto_id_local FROM public.nodos_lotes_estacion WHERE nodo_id = $1::int AND presupuesto_id_local IS NOT NULL
                       UNION
                       SELECT presupuesto_id_local FROM public.nodos_pedidos_vecinos WHERE nodo_id = $1::int AND presupuesto_id_local IS NOT NULL
                   )
                   OR p.nota ILIKE ('%' || $2 || '%')
                   OR (p.tipo_comprobante = 'Canasto Nodo' AND p.nota ILIKE ('%' || $3 || '%'))
               )
             GROUP BY p.id
             ORDER BY p.id DESC
             LIMIT 40`,
            [nodoId, fichaNodo.codigo_nodo, nombreCortoMarca]
        ),
        db.query(
            `SELECT npv.id, npv.codigo_pedido, npv.vecino_id, npv.vecino_nombre, npv.vecino_telefono,
                    npv.modalidad_entrega, npv.direccion_entrega, npv.fecha_entrega_label,
                    npv.medio_pago, npv.estado_pago, npv.estado_operativo,
                    COALESCE(npv.impactado_cta_cte_pago, false) AS impactado_cta_cte_pago,
                    (COALESCE(npv.impactado_cta_cte_pago, false) = true OR UPPER(COALESCE(npv.estado_pago, '')) IN ('CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR')) AS pago_confirmado,
                    COALESCE(npv.monto_declarado_cliente, 0)::numeric(14,2) AS monto_declarado_cliente,
                    COALESCE(npv.monto_acreditado_banco, 0)::numeric(14,2) AS monto_acreditado_banco,
                    COALESCE(npv.reclamo_pago_no_recibido, false) AS reclamo_pago_no_recibido,
                    npv.total_vecino, npv.total_base_lamda,
                    COALESCE(npv.retencion_fiscal_margen, 0)::numeric(14,2) AS retencion_fiscal_margen,
                    npv.ganancia_total_gestor,
                    npv.tracking_token, npv.hito_tracking_actual, npv.created_at,
                    nle.codigo_canasto,
                    COALESCE(it.total_unidades, 0)::int AS total_unidades,
                    COALESCE(it.resumen_items, '') AS resumen_items
             FROM public.nodos_pedidos_vecinos npv
             LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
             LEFT JOIN LATERAL (
                 SELECT
                     SUM(npi.cantidad) AS total_unidades,
                     STRING_AGG(
                         npi.cantidad::text || 'x [' || COALESCE(nac.sku_nodo, npi.sku_nodo, 'S/C') || '] ' ||
                         COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, npi.nombre_publico),
                         ' · ' ORDER BY npi.id ASC
                     ) AS resumen_items
                 FROM public.nodos_pedidos_items npi
                 LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
                 LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, npi.sku_nodo))
                 WHERE npi.pedido_id = npv.id
             ) it ON true
             WHERE npv.nodo_id = $1::int
             ORDER BY npv.id DESC
             LIMIT 50`,
            [nodoId]
        )
    ]);

    const totalDebitosNodo = movimientosContablesNodo
        .filter((m) => String(m.tipo_movimiento || '').toUpperCase() === 'DEBITO')
        .reduce((acc, m) => acc + Number(m.monto || 0), 0);
    const totalCreditosNodo = movimientosContablesNodo
        .filter((m) => String(m.tipo_movimiento || '').toUpperCase() === 'CREDITO')
        .reduce((acc, m) => acc + Number(m.monto || 0), 0);

    return {
        ok: true,
        nodo: fichaNodo,
        resumen_contable_filtrado: {
            cantidad_movimientos_nodo: movimientosContablesNodo.length,
            total_cargos_nodo: Number(totalDebitosNodo.toFixed(2)),
            total_abonos_nodo: Number(totalCreditosNodo.toFixed(2)),
            resultado_neto_movimientos_nodo: Number((totalDebitosNodo - totalCreditosNodo).toFixed(2))
        },
        movimientos_contables_nodo: movimientosContablesNodo,
        movimientos_generales_madre: movimientosGeneralesMadre,
        movimientos_internos_nodo: movInternosRes.rows,
        canastos: canastosRes.rows,
        liquidaciones: liquidacionesRes.rows,
        remitos_presupuestos: remitosRes.rows,
        pedidos_recientes: pedidosRes.rows
    };
}

/**
 * VISTA B — Radar en Vivo, Flujo de Nube, Embudo y Carritos Abandonados por Nodo.
 */
async function obtenerRadarAnaliticaNodos({
    nodoId = null,
    rango = '7d',
    fecha = null,
    audiencia = 'clientes',
    limiteEventos = 400
} = {}) {
    await asegurarEsquemaAnaliticaNodos();

    let filtroNodoId = null;
    if (nodoId && String(nodoId).toLowerCase() !== 'todos') {
        const nObj = await resolverNodoBasico(nodoId);
        if (nObj) filtroNodoId = Number(nObj.id);
    }

    const hoyArgRes = await db.query(`
        SELECT TO_CHAR(NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS hoy
    `);
    const hoyArg = hoyArgRes.rows[0].hoy;

    const modoRango = String(rango || '7d').trim().toLowerCase();
    const fechaSeleccionada = (fecha && /^\d{4}-\d{2}-\d{2}$/.test(String(fecha).trim()))
        ? String(fecha).trim()
        : hoyArg;

    // Construir cláusula base (nodo + ventana temporal, SIN filtro de audiencia)
    // y cláusula completa (agregando filtro de audiencia).
    const params = [];
    const baseConds = [];

    if (filtroNodoId) {
        params.push(filtroNodoId);
        baseConds.push(`e.nodo_id = $${params.length}::int`);
    }

    if (modoRango === '7d') {
        baseConds.push(`e.created_at >= NOW() - INTERVAL '7 days'`);
    } else if (modoRango === '30d') {
        baseConds.push(`e.created_at >= NOW() - INTERVAL '30 days'`);
    } else if (modoRango === 'todo') {
        // Sin recorte de fecha
    } else {
        params.push(fechaSeleccionada);
        baseConds.push(`(e.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = $${params.length}::date`);
    }

    const whereBaseSql = baseConds.length > 0 ? `WHERE ${baseConds.join(' AND ')}` : '';

    const aud = String(audiencia || 'clientes').trim().toLowerCase();
    const conds = [...baseConds];
    if (aud === 'admin_gestor') {
        conds.push(`e.es_admin_gestor = true AND e.es_ia_bot = false`);
    } else if (aud === 'todos') {
        // Incluye clientes, admin/gestor y bots identificados con insignias
    } else {
        // Por defecto: solo clientes reales (sin admin/gestor ni bots)
        conds.push(`e.es_admin_gestor = false AND e.es_ia_bot = false`);
    }

    const whereSql = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

    // Fechas recientes con actividad + contexto global del nodo (sin recorte de audiencia)
    const paramsFechas = [];
    let whereFechas = `WHERE es_ia_bot = false`;
    let whereNodoOnly = '';
    if (filtroNodoId) {
        paramsFechas.push(filtroNodoId);
        whereFechas += ` AND nodo_id = $1::int`;
        whereNodoOnly = `WHERE nodo_id = $1::int`;
    }

    const lim = Math.min(800, Math.max(50, Number(limiteEventos) || 400));
    const paramsEventos = [...params, lim];

    const [
        fechasDispRes,
        contextoGlobalRes,
        resumenAudienciasRes,
        kpisRes,
        embudoCheckoutRes,
        origenesRes,
        porNodoRes,
        topCategoriasRes,
        topBusquedasRes,
        topProductosRes,
        eventosRes
    ] = await Promise.all([
        db.query(
            `SELECT
                TO_CHAR(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS fecha,
                COUNT(DISTINCT visitor_id) FILTER (WHERE es_admin_gestor = false)::int AS visitantes_clientes,
                COUNT(DISTINCT visitor_id) FILTER (WHERE es_admin_gestor = true)::int AS visitantes_admin,
                COUNT(*)::int AS eventos
             FROM public.nodos_tienda_eventos
             ${whereFechas}
             GROUP BY 1
             ORDER BY 1 DESC
             LIMIT 30`,
            paramsFechas
        ),
        db.query(
            `SELECT
                COUNT(*) FILTER (WHERE es_ia_bot = false)::int AS eventos_historico_total,
                COUNT(*) FILTER (WHERE es_admin_gestor = false AND es_ia_bot = false)::int AS eventos_historico_clientes,
                COUNT(*) FILTER (WHERE es_admin_gestor = true AND es_ia_bot = false)::int AS eventos_historico_admin,
                COUNT(*) FILTER (WHERE es_admin_gestor = false AND es_ia_bot = false AND created_at >= NOW() - INTERVAL '7 days')::int AS eventos_7d_clientes,
                COUNT(*) FILTER (WHERE es_admin_gestor = true AND es_ia_bot = false AND created_at >= NOW() - INTERVAL '7 days')::int AS eventos_7d_admin,
                COUNT(DISTINCT visitor_id) FILTER (WHERE es_admin_gestor = false AND es_ia_bot = false AND created_at >= NOW() - INTERVAL '7 days')::int AS visitantes_7d_clientes,
                COUNT(DISTINCT visitor_id) FILTER (WHERE es_admin_gestor = true AND es_ia_bot = false AND created_at >= NOW() - INTERVAL '7 days')::int AS visitantes_7d_admin,
                TO_CHAR(MAX(created_at) FILTER (WHERE es_ia_bot = false) AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') AS ultima_actividad_arg,
                TO_CHAR(MAX(created_at) FILTER (WHERE es_ia_bot = false) AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS ultima_actividad_fecha,
                TO_CHAR(MAX(created_at) FILTER (WHERE es_admin_gestor = true AND es_ia_bot = false) AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') AS ultima_actividad_admin_arg,
                TO_CHAR(MAX(created_at) FILTER (WHERE es_admin_gestor = false AND es_ia_bot = false) AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') AS ultima_actividad_cliente_arg
             FROM public.nodos_tienda_eventos
             ${whereNodoOnly}`,
            paramsFechas
        ),
        db.query(
            `SELECT
                COUNT(*)::int AS eventos_totales_periodo,
                COUNT(*) FILTER (WHERE e.es_admin_gestor = false AND e.es_ia_bot = false)::int AS eventos_clientes_periodo,
                COUNT(*) FILTER (WHERE e.es_admin_gestor = true AND e.es_ia_bot = false)::int AS eventos_admin_gestor_periodo,
                COUNT(*) FILTER (WHERE e.es_ia_bot = true)::int AS hits_bots_periodo,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.es_ia_bot = false)::int AS visitantes_humanos_periodo,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.es_admin_gestor = false AND e.es_ia_bot = false)::int AS visitantes_clientes_periodo,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.es_admin_gestor = true AND e.es_ia_bot = false)::int AS visitantes_admin_gestor_periodo,
                TO_CHAR(MAX(e.created_at) FILTER (WHERE e.es_ia_bot = false) AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') AS ultima_actividad_periodo_arg
             FROM public.nodos_tienda_eventos e
             ${whereBaseSql}`,
            params
        ),
        db.query(
            `SELECT
                COUNT(*)::int AS total_eventos,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.es_ia_bot = false)::int AS visitantes_totales,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.es_admin_gestor = false AND e.es_ia_bot = false)::int AS visitantes_reales,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.es_admin_gestor = true AND e.es_ia_bot = false)::int AS visitantes_admin_gestor,
                COUNT(DISTINCT e.visitor_id) FILTER (
                    WHERE e.es_ia_bot = false AND COALESCE(v.total_sesiones, 1) <= 1
                )::int AS visitantes_nuevos,
                COUNT(DISTINCT e.visitor_id) FILTER (
                    WHERE e.es_ia_bot = false AND COALESCE(v.total_sesiones, 1) > 1
                )::int AS visitantes_recurrentes,
                COUNT(DISTINCT e.visitor_id) FILTER (
                    WHERE e.es_ia_bot = false
                      AND (e.vecino_id IS NOT NULL OR v.vecino_id IS NOT NULL OR COALESCE(v.vecino_nombre, '') <> '')
                )::int AS visitantes_identificados,
                COUNT(*) FILTER (WHERE e.tipo_evento IN ('vista_tienda', 'vista_seguimiento', 'vista_mi_cuenta') AND e.es_ia_bot = false)::int AS ingresos_tienda,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'categoria_seleccionada')::int AS clics_categorias,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'busqueda_lupa')::int AS busquedas_lupa,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'vista_producto')::int AS vistas_producto,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'clic_que_contiene')::int AS clics_que_contiene,
                COUNT(*) FILTER (WHERE e.tipo_evento IN ('clic_que_contiene', 'vista_producto'))::int AS consultas_producto,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'vista_mi_cuenta')::int AS vistas_mi_cuenta,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'clic_coordinar_gestor')::int AS clics_whatsapp,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.tipo_evento = 'clic_coordinar_gestor')::int AS visitantes_con_whatsapp,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'video_bienvenida_apertura')::int AS aperturas_video_bienvenida,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'video_bienvenida_play')::int AS reproducciones_video_bienvenida,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.tipo_evento IN ('video_bienvenida_apertura', 'video_bienvenida_play'))::int AS visitantes_video_bienvenida,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.tipo_evento = 'carrito_agregar')::int AS visitantes_con_carrito,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.tipo_evento = 'inicio_checkout')::int AS visitantes_checkout,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'checkout_paso')::int AS pasos_checkout,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'checkout_abandono')::int AS abandonos_checkout,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.tipo_evento = 'checkout_abandono')::int AS visitantes_abandono_checkout,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'pedido_confirmado')::int AS eventos_pedido_confirmado,
                COUNT(DISTINCT e.visitor_id) FILTER (
                    WHERE e.tipo_evento = 'pedido_confirmado' AND e.es_admin_gestor = false
                )::int AS compradores_unicos_reales,
                COUNT(DISTINCT e.visitor_id) FILTER (
                    WHERE e.tipo_evento = 'pedido_confirmado' AND e.es_admin_gestor = true
                )::int AS compradores_unicos_admin,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.dispositivo_modo = 'Celular' AND e.es_ia_bot = false)::int AS disp_celulares,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.dispositivo_modo = 'PC' AND e.es_ia_bot = false)::int AS disp_pcs,
                COUNT(*) FILTER (WHERE e.es_ia_bot = true)::int AS hits_bots
             FROM public.nodos_tienda_eventos e
             LEFT JOIN public.nodos_tienda_visitantes v ON v.visitor_id = e.visitor_id
             ${whereSql}`,
            params
        ),
        db.query(
            `SELECT
                COALESCE(NULLIF(TRIM(e.detalle), ''), 'paso') AS paso_detalle,
                COUNT(*)::int AS eventos,
                COUNT(DISTINCT e.visitor_id)::int AS visitantes
             FROM public.nodos_tienda_eventos e
             ${whereSql ? `${whereSql} AND` : 'WHERE'} e.tipo_evento = 'checkout_paso'
             GROUP BY 1
             ORDER BY eventos DESC, visitantes DESC
             LIMIT 12`,
            params
        ),
        db.query(
            `SELECT
                COALESCE(e.origen_trafico, 'Directo') AS origen,
                COUNT(DISTINCT e.visitor_id)::int AS visitantes,
                COUNT(*)::int AS eventos,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'pedido_confirmado')::int AS pedidos
             FROM public.nodos_tienda_eventos e
             ${whereSql}
             GROUP BY 1
             ORDER BY visitantes DESC, eventos DESC`,
            params
        ),
        db.query(
            `SELECT
                nm.id AS nodo_id,
                nm.slug AS nodo_slug,
                nm.nombre_marca,
                nm.color_primario,
                COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.es_ia_bot = false)::int AS visitantes,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'carrito_agregar')::int AS agregados_carrito,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'pedido_confirmado')::int AS pedidos
             FROM public.nodos_tienda_eventos e
             JOIN public.nodos_maestro nm ON nm.id = e.nodo_id
             ${whereSql}
             GROUP BY nm.id, nm.slug, nm.nombre_marca, nm.color_primario
             ORDER BY visitantes DESC, pedidos DESC`,
            params
        ),
        db.query(
            `SELECT
                e.categoria_nombre AS categoria,
                COUNT(*)::int AS clics,
                COUNT(DISTINCT e.visitor_id)::int AS visitantes
             FROM public.nodos_tienda_eventos e
             ${whereSql ? `${whereSql} AND` : 'WHERE'} e.tipo_evento = 'categoria_seleccionada'
               AND COALESCE(e.categoria_nombre, '') <> ''
               AND UPPER(e.categoria_nombre) <> 'TODAS'
             GROUP BY e.categoria_nombre
             ORDER BY clics DESC, visitantes DESC
             LIMIT 12`,
            params
        ),
        db.query(
            `SELECT
                LOWER(TRIM(e.termino_busqueda)) AS termino,
                COUNT(*)::int AS cantidad,
                COUNT(DISTINCT e.visitor_id)::int AS visitantes,
                MAX(e.created_at) AS ultima_vez
             FROM public.nodos_tienda_eventos e
             ${whereSql ? `${whereSql} AND` : 'WHERE'} e.tipo_evento = 'busqueda_lupa'
               AND LENGTH(TRIM(COALESCE(e.termino_busqueda, ''))) >= 2
             GROUP BY 1
             ORDER BY cantidad DESC, ultima_vez DESC
             LIMIT 15`,
            params
        ),
        db.query(
            `SELECT
                COALESCE(ba.articulo_id, nac.sku_nodo, e.sku_nodo, '') AS sku_nodo,
                MAX(
                    CASE
                        WHEN COALESCE(e.sku_nodo, '') <> '' THEN
                            '[' || COALESCE(ba.articulo_id, nac.sku_nodo, e.sku_nodo) || '] ' ||
                            COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico, e.producto_nombre, e.sku_nodo)
                        ELSE COALESCE(e.producto_nombre, 'Producto')
                    END
                ) AS producto_nombre,
                COUNT(*) FILTER (WHERE e.tipo_evento IN ('clic_que_contiene', 'vista_producto'))::int AS vistas_detalle,
                COUNT(*) FILTER (WHERE e.tipo_evento = 'carrito_agregar')::int AS veces_agregado,
                COUNT(DISTINCT e.visitor_id)::int AS visitantes
             FROM public.nodos_tienda_eventos e
             LEFT JOIN public.nodos_articulos_catalogo nac ON UPPER(nac.sku_nodo) = UPPER(COALESCE(e.sku_nodo, ''))
             LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, e.sku_nodo, ''))
             ${whereSql ? `${whereSql} AND` : 'WHERE'} e.tipo_evento IN ('clic_que_contiene', 'vista_producto', 'carrito_agregar')
               AND COALESCE(e.producto_nombre, e.sku_nodo, '') <> ''
             GROUP BY COALESCE(ba.articulo_id, nac.sku_nodo, e.sku_nodo, '')
             ORDER BY veces_agregado DESC, vistas_detalle DESC
             LIMIT 15`,
            params
        ),
        db.query(
            `SELECT
                e.id,
                e.created_at,
                TO_CHAR(e.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS fecha_arg,
                TO_CHAR(e.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:MI:SS') AS hora_arg,
                e.nodo_id,
                e.nodo_slug,
                nm.nombre_marca AS nodo_nombre,
                nm.color_primario AS nodo_color,
                e.visitor_id,
                e.session_id,
                e.tipo_evento,
                e.es_admin_gestor,
                e.es_ia_bot,
                e.origen_trafico,
                e.utm_source,
                e.utm_medium,
                e.utm_campaign,
                e.dispositivo_modo,
                e.sistema_operativo,
                e.categoria_nombre,
                e.termino_busqueda,
                e.oferta_id,
                COALESCE(ba.articulo_id, nac.sku_nodo, e.sku_nodo) AS sku_nodo,
                CASE
                    WHEN COALESCE(e.sku_nodo, '') <> '' THEN
                        '[' || COALESCE(ba.articulo_id, nac.sku_nodo, e.sku_nodo) || '] ' ||
                        COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico, e.producto_nombre, e.sku_nodo)
                    ELSE e.producto_nombre
                END AS producto_nombre,
                e.cantidad,
                e.carrito_unidades,
                e.carrito_subtotal,
                e.carrito_snapshot,
                e.pedido_id,
                e.codigo_pedido,
                e.detalle,
                e.ip_origen,
                COALESCE(nv.id, v.vecino_id) AS vecino_id_resuelto,
                COALESCE(nv.nombre_completo, v.vecino_nombre) AS vecino_nombre_resuelto,
                COALESCE(nv.telefono_whatsapp, v.vecino_telefono) AS vecino_telefono_resuelto,
                v.identificado_via,
                v.etiqueta_dispositivo,
                v.es_admin_gestor AS visitante_es_admin_gestor,
                COALESCE(last_cart_ev.es_admin_gestor, v.es_admin_gestor) AS carrito_es_admin_gestor,
                v.carrito_actual_nodo_id,
                COALESCE(v.total_sesiones, 1)::int AS total_sesiones_visitante,
                COALESCE(v.total_pedidos_confirmados, 0)::int AS total_pedidos_visitante,
                COALESCE(v.carrito_actual_unidades, 0)::int AS carrito_actual_unidades,
                COALESCE(v.carrito_actual_subtotal, 0)::numeric(14,2) AS carrito_actual_subtotal,
                v.carrito_actual_json,
                v.carrito_actualizado_at
             FROM public.nodos_tienda_eventos e
             JOIN public.nodos_maestro nm ON nm.id = e.nodo_id
             LEFT JOIN public.nodos_articulos_catalogo nac ON UPPER(nac.sku_nodo) = UPPER(COALESCE(e.sku_nodo, ''))
             LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, e.sku_nodo, ''))
             LEFT JOIN public.nodos_tienda_visitantes v ON v.visitor_id = e.visitor_id
             LEFT JOIN LATERAL (
                 SELECT e_c.es_admin_gestor
                 FROM public.nodos_tienda_eventos e_c
                 WHERE e_c.visitor_id = v.visitor_id
                   AND e_c.nodo_id = v.carrito_actual_nodo_id
                   AND e_c.tipo_evento IN ('carrito_agregar', 'carrito_quitar', 'carrito_vaciar', 'inicio_checkout', 'checkout_paso', 'checkout_abandono', 'pedido_confirmado')
                 ORDER BY e_c.created_at DESC, e_c.id DESC
                 LIMIT 1
             ) last_cart_ev ON true
             LEFT JOIN public.nodos_vecinos nv ON nv.id = COALESCE(e.vecino_id, v.vecino_id)
             ${whereSql}
             ORDER BY e.created_at DESC, e.id DESC
             LIMIT $${paramsEventos.length}::int`,
            paramsEventos
        )
    ]);

    // Consultar Carritos en Curso / Abandonados actualmente abiertos (respetando rol exacto del nodo del carrito)
    const cartParams = [];
    const cartBaseConds = [`v.carrito_actual_unidades > 0`];
    if (filtroNodoId) {
        cartParams.push(filtroNodoId);
        cartBaseConds.push(`v.carrito_actual_nodo_id = $${cartParams.length}::int`);
    }
    const cartConds = [...cartBaseConds];
    if (aud === 'admin_gestor') {
        cartConds.push(`COALESCE(last_cart_ev.es_admin_gestor, v.es_admin_gestor) = true`);
    } else if (aud !== 'todos') {
        cartConds.push(`COALESCE(last_cart_ev.es_admin_gestor, v.es_admin_gestor) = false`);
    }

    const [carritosAbiertosRes, carritosResumenRes] = await Promise.all([
        db.query(
            `SELECT
                v.visitor_id,
                v.carrito_actual_nodo_id AS nodo_id,
                nm.slug AS nodo_slug,
                nm.nombre_marca AS nodo_nombre,
                nm.color_primario AS nodo_color,
                COALESCE(nv.id, v.vecino_id) AS vecino_id,
                COALESCE(nv.nombre_completo, v.vecino_nombre) AS vecino_nombre,
                COALESCE(nv.telefono_whatsapp, v.vecino_telefono) AS vecino_telefono,
                v.identificado_via,
                COALESCE(last_cart_ev.es_admin_gestor, v.es_admin_gestor) AS es_admin_gestor,
                v.etiqueta_dispositivo,
                v.dispositivo_modo,
                v.sistema_operativo,
                v.ultimo_origen_trafico,
                v.carrito_actual_unidades,
                v.carrito_actual_subtotal,
                v.carrito_actual_json,
                v.carrito_actualizado_at,
                EXTRACT(EPOCH FROM (NOW() - COALESCE(v.carrito_actualizado_at, v.ultima_visita_at)))::int AS segundos_inactivo
             FROM public.nodos_tienda_visitantes v
             LEFT JOIN public.nodos_maestro nm ON nm.id = v.carrito_actual_nodo_id
             LEFT JOIN public.nodos_vecinos nv ON nv.id = v.vecino_id
             LEFT JOIN LATERAL (
                 SELECT e_c.es_admin_gestor
                 FROM public.nodos_tienda_eventos e_c
                 WHERE e_c.visitor_id = v.visitor_id
                   AND e_c.nodo_id = v.carrito_actual_nodo_id
                   AND e_c.tipo_evento IN ('carrito_agregar', 'carrito_quitar', 'carrito_vaciar', 'inicio_checkout', 'checkout_paso', 'checkout_abandono', 'pedido_confirmado')
                 ORDER BY e_c.created_at DESC, e_c.id DESC
                 LIMIT 1
             ) last_cart_ev ON true
             WHERE ${cartConds.join(' AND ')}
             ORDER BY COALESCE(v.carrito_actualizado_at, v.ultima_visita_at) DESC
             LIMIT 40`,
            cartParams
        ),
        db.query(
            `SELECT
                COUNT(*) FILTER (WHERE COALESCE(last_cart_ev.es_admin_gestor, v.es_admin_gestor) = false)::int AS carritos_clientes,
                COUNT(*) FILTER (WHERE COALESCE(last_cart_ev.es_admin_gestor, v.es_admin_gestor) = true)::int AS carritos_admin
             FROM public.nodos_tienda_visitantes v
             LEFT JOIN LATERAL (
                 SELECT e_c.es_admin_gestor
                 FROM public.nodos_tienda_eventos e_c
                 WHERE e_c.visitor_id = v.visitor_id
                   AND e_c.nodo_id = v.carrito_actual_nodo_id
                   AND e_c.tipo_evento IN ('carrito_agregar', 'carrito_quitar', 'carrito_vaciar', 'inicio_checkout', 'checkout_paso', 'checkout_abandono', 'pedido_confirmado')
                 ORDER BY e_c.created_at DESC, e_c.id DESC
                 LIMIT 1
             ) last_cart_ev ON true
             WHERE ${cartBaseConds.join(' AND ')}`,
            cartParams
        )
    ]);

    const catalogoSkuOficialRes = await db.query(
        `SELECT UPPER(nac.sku_nodo) AS sku_upper,
                COALESCE(ba.articulo_id, nac.sku_nodo) AS sku_oficial,
                COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_oficial
         FROM public.nodos_articulos_catalogo nac
         LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(nac.sku_nodo)`
    );
    const mapaSkuOficial = new Map(
        catalogoSkuOficialRes.rows.map(r => [r.sku_upper, { sku: r.sku_oficial, nombre: r.nombre_oficial }])
    );
    const normalizarItemsCarritoLamda = (arr) => {
        if (!Array.isArray(arr)) return [];
        return arr.map(it => {
            const rawSku = String(it.sku || it.sku_nodo || '').trim();
            const match = rawSku ? mapaSkuOficial.get(rawSku.toUpperCase()) : null;
            if (!match) return it;
            return {
                ...it,
                sku: match.sku,
                nombre: `[${match.sku}] ${match.nombre}`
            };
        });
    };

    const carritosSinCerrar = carritosAbiertosRes.rows.map((c) => {
        const minInactivo = Math.max(0, Math.round(Number(c.segundos_inactivo || 0) / 60));
        return {
            visitor_id: c.visitor_id,
            alias_corto: '#' + String(c.visitor_id || '').slice(-4).toUpperCase(),
            nodo_id: c.nodo_id ? Number(c.nodo_id) : null,
            nodo_slug: c.nodo_slug || '',
            nodo_nombre: c.nodo_nombre || 'Nodo',
            nodo_color: c.nodo_color || '#16a34a',
            identificado: Boolean(c.vecino_id || c.vecino_nombre),
            vecino_id: c.vecino_id ? Number(c.vecino_id) : null,
            vecino_nombre: c.vecino_nombre || null,
            vecino_telefono: c.vecino_telefono || null,
            es_admin_gestor: Boolean(c.es_admin_gestor),
            etiqueta_dispositivo: c.es_admin_gestor ? (c.etiqueta_dispositivo || null) : null,
            dispositivo_modo: c.dispositivo_modo || 'Celular',
            sistema_operativo: c.sistema_operativo || 'Otro',
            origen_trafico: c.ultimo_origen_trafico || 'Directo',
            unidades: Number(c.carrito_actual_unidades || 0),
            subtotal: Number(c.carrito_actual_subtotal || 0),
            items: normalizarItemsCarritoLamda(c.carrito_actual_json),
            actualizado_at: c.carrito_actualizado_at,
            minutos_inactivo: minInactivo,
            estado_carrito: minInactivo >= 10 ? 'ABANDONADO' : 'EN_TIENDA_AHORA'
        };
    });

    // Agrupar eventos por (visitor_id + nodo_id + fecha_arg + rol) para el Radar estilo Acordeón B2B
    const gruposMap = new Map();
    for (const ev of eventosRes.rows) {
        const rolKey = ev.es_admin_gestor ? 'adm' : 'cli';
        const key = `${ev.visitor_id}::${ev.nodo_id}::${ev.fecha_arg}::${rolKey}`;
        if (!gruposMap.has(key)) {
            const alias = '#' + String(ev.visitor_id || '').slice(-4).toUpperCase();
            const carritoPerteneceAGrupo =
                Number(ev.carrito_actual_nodo_id) === Number(ev.nodo_id) &&
                Boolean(ev.carrito_es_admin_gestor) === Boolean(ev.es_admin_gestor);
            gruposMap.set(key, {
                grupo_key: key,
                visitor_id: ev.visitor_id,
                alias_visitante: alias,
                fecha_arg: ev.fecha_arg,
                primera_hora: ev.hora_arg,
                ultima_hora: ev.hora_arg,
                ultimo_timestamp: ev.created_at,
                nodo_id: Number(ev.nodo_id),
                nodo_slug: ev.nodo_slug,
                nodo_nombre: ev.nodo_nombre,
                nodo_color: ev.nodo_color || '#16a34a',
                identificado: Boolean(ev.vecino_id_resuelto || ev.vecino_nombre_resuelto),
                vecino_id: ev.vecino_id_resuelto ? Number(ev.vecino_id_resuelto) : null,
                vecino_nombre: ev.vecino_nombre_resuelto || null,
                vecino_telefono: ev.vecino_telefono_resuelto || null,
                identificado_via: ev.identificado_via || null,
                es_admin_gestor: Boolean(ev.es_admin_gestor),
                es_ia_bot: Boolean(ev.es_ia_bot),
                etiqueta_dispositivo: ev.es_admin_gestor ? (ev.etiqueta_dispositivo || null) : null,
                es_recurrente: Number(ev.total_sesiones_visitante || 1) > 1,
                total_sesiones_historicas: Number(ev.total_sesiones_visitante || 1),
                dispositivo_modo: ev.dispositivo_modo || 'Celular',
                sistema_operativo: ev.sistema_operativo || 'Otro',
                origen_trafico: ev.origen_trafico || 'Directo',
                ip_origen: ev.ip_origen || '',
                compro_en_visita: false,
                codigos_pedido: [],
                iniciaron_checkout: false,
                abandono_checkout: false,
                pasos_checkout: [],
                clics_whatsapp: 0,
                vio_video_bienvenida: false,
                categorias_vistas: [],
                busquedas: [],
                productos_interes: [],
                carrito_actual_unidades: carritoPerteneceAGrupo ? Number(ev.carrito_actual_unidades || 0) : 0,
                carrito_actual_subtotal: carritoPerteneceAGrupo ? Number(ev.carrito_actual_subtotal || 0) : 0,
                carrito_actual_items: carritoPerteneceAGrupo ? normalizarItemsCarritoLamda(ev.carrito_actual_json) : [],
                eventos: []
            });
        }

        const g = gruposMap.get(key);
        // Como vienen ordenados DESC, cada iteración más antigua actualiza primera_hora
        g.primera_hora = ev.hora_arg;
        if (!g.identificado && (ev.vecino_id_resuelto || ev.vecino_nombre_resuelto)) {
            g.identificado = true;
            g.vecino_id = ev.vecino_id_resuelto ? Number(ev.vecino_id_resuelto) : null;
            g.vecino_nombre = ev.vecino_nombre_resuelto || null;
            g.vecino_telefono = ev.vecino_telefono_resuelto || null;
        }
        if (ev.origen_trafico && ev.origen_trafico !== 'Directo' && g.origen_trafico === 'Directo') {
            g.origen_trafico = ev.origen_trafico;
        }
        if (ev.tipo_evento === 'pedido_confirmado') {
            g.compro_en_visita = true;
            if (ev.codigo_pedido && !g.codigos_pedido.includes(ev.codigo_pedido)) {
                g.codigos_pedido.push(ev.codigo_pedido);
            }
        }
        if (ev.tipo_evento === 'inicio_checkout') {
            g.iniciaron_checkout = true;
        }
        if (ev.tipo_evento === 'checkout_paso' && ev.detalle) {
            if (!g.pasos_checkout.includes(ev.detalle)) {
                g.pasos_checkout.push(ev.detalle);
            }
        }
        if (ev.tipo_evento === 'checkout_abandono') {
            g.abandono_checkout = true;
        }
        if (ev.tipo_evento === 'clic_coordinar_gestor') {
            g.clics_whatsapp += 1;
        }
        if (ev.tipo_evento === 'video_bienvenida_apertura' || ev.tipo_evento === 'video_bienvenida_play') {
            g.vio_video_bienvenida = true;
        }
        if (ev.tipo_evento === 'categoria_seleccionada' && ev.categoria_nombre && ev.categoria_nombre !== 'TODAS') {
            if (!g.categorias_vistas.includes(ev.categoria_nombre)) {
                g.categorias_vistas.push(ev.categoria_nombre);
            }
        }
        if (ev.tipo_evento === 'busqueda_lupa' && ev.termino_busqueda) {
            if (!g.busquedas.includes(ev.termino_busqueda)) {
                g.busquedas.push(ev.termino_busqueda);
            }
        }
        if (['clic_que_contiene', 'vista_producto', 'carrito_agregar'].includes(ev.tipo_evento) && ev.producto_nombre) {
            if (!g.productos_interes.includes(ev.producto_nombre)) {
                g.productos_interes.push(ev.producto_nombre);
            }
        }

        g.eventos.push({
            id: Number(ev.id),
            hora: ev.hora_arg,
            tipo_evento: ev.tipo_evento,
            categoria_nombre: ev.categoria_nombre,
            termino_busqueda: ev.termino_busqueda,
            sku_nodo: ev.sku_nodo,
            producto_nombre: ev.producto_nombre,
            cantidad: ev.cantidad,
            carrito_unidades: Number(ev.carrito_unidades || 0),
            carrito_subtotal: Number(ev.carrito_subtotal || 0),
            codigo_pedido: ev.codigo_pedido,
            origen_trafico: ev.origen_trafico,
            detalle: ev.detalle
        });
    }

    const k = kpisRes.rows[0] || {};
    const ra = resumenAudienciasRes.rows[0] || {};
    const cg = contextoGlobalRes.rows[0] || {};
    const cr = carritosResumenRes.rows[0] || {};

    const visitantesRealesPeriodo = Number(ra.visitantes_clientes_periodo || 0);
    const visitantesAdminPeriodo = Number(ra.visitantes_admin_gestor_periodo || 0);
    const hitsBotsPeriodo = Number(ra.hits_bots_periodo || 0);

    const baseVisitantesConversion = aud === 'admin_gestor'
        ? Number(k.visitantes_admin_gestor || 0)
        : Number(k.visitantes_reales || 0);
    const pedidosParaConversion = aud === 'admin_gestor'
        ? Number(k.compradores_unicos_admin || 0)
        : Number(k.compradores_unicos_reales || 0);
    const tasaConversionPct = baseVisitantesConversion > 0
        ? Number(((pedidosParaConversion / baseVisitantesConversion) * 100).toFixed(1))
        : 0;

    const totalMontoCarritosSinCerrar = carritosSinCerrar.reduce((acc, c) => acc + Number(c.subtotal || 0), 0);
    const cantAbandonados = carritosSinCerrar.filter((c) => c.estado_carrito === 'ABANDONADO').length;

    return {
        ok: true,
        filtros: {
            nodo_id: filtroNodoId || 'todos',
            rango: modoRango,
            fecha: fechaSeleccionada,
            hoy_argentina: hoyArg,
            audiencia: aud
        },
        resumen_audiencias: {
            eventos_totales: Number(ra.eventos_totales_periodo || 0),
            eventos_clientes: Number(ra.eventos_clientes_periodo || 0),
            eventos_admin_gestor: Number(ra.eventos_admin_gestor_periodo || 0),
            hits_bots: hitsBotsPeriodo,
            visitantes_humanos: Number(ra.visitantes_humanos_periodo || 0),
            visitantes_clientes: visitantesRealesPeriodo,
            visitantes_admin_gestor: visitantesAdminPeriodo,
            ultima_actividad_periodo_arg: ra.ultima_actividad_periodo_arg || null,
            carritos_clientes: Number(cr.carritos_clientes || 0),
            carritos_admin: Number(cr.carritos_admin || 0)
        },
        contexto_global: {
            eventos_historico_total: Number(cg.eventos_historico_total || 0),
            eventos_historico_clientes: Number(cg.eventos_historico_clientes || 0),
            eventos_historico_admin: Number(cg.eventos_historico_admin || 0),
            eventos_7d_clientes: Number(cg.eventos_7d_clientes || 0),
            eventos_7d_admin: Number(cg.eventos_7d_admin || 0),
            visitantes_7d_clientes: Number(cg.visitantes_7d_clientes || 0),
            visitantes_7d_admin: Number(cg.visitantes_7d_admin || 0),
            ultima_actividad_arg: cg.ultima_actividad_arg || null,
            ultima_actividad_fecha: cg.ultima_actividad_fecha || null,
            ultima_actividad_admin_arg: cg.ultima_actividad_admin_arg || null,
            ultima_actividad_cliente_arg: cg.ultima_actividad_cliente_arg || null
        },
        fechas_disponibles: fechasDispRes.rows,
        kpis: {
            total_eventos: Number(k.total_eventos || 0),
            visitantes_unicos: aud === 'admin_gestor'
                ? Number(k.visitantes_admin_gestor || 0)
                : (aud === 'todos' ? Number(k.visitantes_totales || 0) : Number(k.visitantes_reales || 0)),
            visitantes_reales: visitantesRealesPeriodo,
            visitantes_admin_gestor: visitantesAdminPeriodo,
            eventos_clientes: Number(ra.eventos_clientes_periodo || 0),
            eventos_admin_gestor: Number(ra.eventos_admin_gestor_periodo || 0),
            visitantes_nuevos: Number(k.visitantes_nuevos || 0),
            visitantes_recurrentes: Number(k.visitantes_recurrentes || 0),
            visitantes_identificados: Number(k.visitantes_identificados || 0),
            ingresos_tienda: Number(k.ingresos_tienda || 0),
            clics_categorias: Number(k.clics_categorias || 0),
            busquedas_lupa: Number(k.busquedas_lupa || 0),
            vistas_producto: Number(k.vistas_producto || 0),
            clics_que_contiene: Number(k.clics_que_contiene || 0),
            consultas_producto: Number(k.consultas_producto || 0),
            vistas_mi_cuenta: Number(k.vistas_mi_cuenta || 0),
            clics_whatsapp: Number(k.clics_whatsapp || 0),
            visitantes_con_whatsapp: Number(k.visitantes_con_whatsapp || 0),
            aperturas_video_bienvenida: Number(k.aperturas_video_bienvenida || 0),
            reproducciones_video_bienvenida: Number(k.reproducciones_video_bienvenida || 0),
            visitantes_video_bienvenida: Number(k.visitantes_video_bienvenida || 0),
            visitantes_con_carrito: Number(k.visitantes_con_carrito || 0),
            visitantes_checkout: Number(k.visitantes_checkout || 0),
            pasos_checkout: Number(k.pasos_checkout || 0),
            abandonos_checkout: Number(k.abandonos_checkout || 0),
            visitantes_abandono_checkout: Number(k.visitantes_abandono_checkout || 0),
            pedidos_confirmados: Number(k.eventos_pedido_confirmado || 0),
            compradores_unicos_reales: Number(k.compradores_unicos_reales || 0),
            tasa_conversion_pct: tasaConversionPct,
            carritos_sin_cerrar_total: carritosSinCerrar.length,
            carritos_abandonados_total: cantAbandonados,
            carritos_sin_cerrar_monto: Number(totalMontoCarritosSinCerrar.toFixed(2)),
            dispositivos: {
                celulares: Number(k.disp_celulares || 0),
                pcs: Number(k.disp_pcs || 0),
                bots: hitsBotsPeriodo
            }
        },
        embudo_checkout: embudoCheckoutRes.rows,
        origenes_trafico: origenesRes.rows,
        por_nodo: porNodoRes.rows,
        top_categorias: topCategoriasRes.rows,
        top_busquedas: topBusquedasRes.rows,
        top_productos_interes: topProductosRes.rows,
        carritos_sin_cerrar: carritosSinCerrar,
        radar_visitantes: Array.from(gruposMap.values()),
        flujo_cronologico: eventosRes.rows.slice(0, 150)
    };
}

module.exports = {
    TIPOS_EVENTO_TIENDA_PERMITIDOS,
    detectarAgenteOSistemaNodo,
    detectarOrigenTraficoNodo,
    asegurarEsquemaAnaliticaNodos,
    vincularVisitanteConVecino,
    registrarEventoTelemetriaTienda,
    obtenerResumenCentroNodos,
    obtenerFichaDetalleNodo,
    obtenerRadarAnaliticaNodos
};
