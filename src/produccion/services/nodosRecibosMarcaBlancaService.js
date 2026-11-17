'use strict';

/**
 * ============================================================================
 * SERVICIO DE RECIBOS DE PAGO MARCA BLANCA CON MEMBRETE OFICIAL DE TIENDA
 * Y DESPACHO AUTOMÁTICO POR WHATSAPP (:3004) AL CELULAR REGISTRADO DEL CLIENTE
 * ============================================================================
 * Reglas innegociables:
 * 1. Membrete 100% Marca Blanca de cada tienda (`nombre_marca`, logo oficial de `tema_visual`
 *    o `logo_original_base64` y paleta cromática de la tienda).
 * 2. CERO menciones a "LAMDA" y CERO menciones a la palabra "nodo" en imagen PNG, HTML o caption.
 * 3. Disparo automático no bloqueante al `vecino_telefono` vía `:3004/facturacion/whatsapp/enviar-imagen`,
 *    respetando el blindaje `esModoLaboratorioWa()` en Laboratorio y degradando con elegancia ante
 *    teléfonos inválidos o desconexión temporal sin revertir jamás el cobro en mano.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const db = require('../config/database');

const _logoImageCache = new Map();

function esModoLaboratorioRecibos() {
    const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || process.env.MODO_LABORATORIO || '').trim().toLowerCase();
    const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
    return flagLab === 'true' || flagLab === '1' || dbName === 'etiquetas_pruebas';
}

function limpiarHexColor(valor, fallback = '#2F6F4E') {
    const s = String(valor || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
        return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    return fallback;
}

function sanitizarTextoMarcaBlancaRecibo(texto = '') {
    return String(texto || '')
        .replace(/\bnodos?\s+barriales?\b/gi, 'comunidad')
        .replace(/\bpunto\s+de\s+retiro\s+del\s+nodo\b/gi, 'punto de retiro')
        .replace(/\bnodos?\b/gi, 'tienda')
        .replace(/\blamda\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function normalizarTelefonoWhatsAppAr(raw = '') {
    const digits = String(raw || '').replace(/\D+/g, '');
    if (!digits || digits.length < 8) return '';
    if (digits.startsWith('549') && digits.length >= 12) return digits;
    if (digits.startsWith('54') && digits.length >= 11) {
        const rest = digits.slice(2).replace(/^0+/, '');
        return rest.startsWith('9') ? '54' + rest : '549' + rest;
    }
    const sinCero = digits.replace(/^0+/, '').replace(/^15/, '');
    if (sinCero.length >= 10) return '549' + sinCero;
    return digits;
}

function formatearMonedaAr(monto) {
    const num = Math.round(Number(monto || 0));
    return '$' + num.toLocaleString('es-AR');
}

function formatearFechaHoraAr(fechaInput) {
    const dt = fechaInput ? new Date(fechaInput) : new Date();
    const valida = Number.isNaN(dt.getTime()) ? new Date() : dt;
    try {
        return valida.toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }) + ' hs';
    } catch (_) {
        return valida.toISOString().slice(0, 16).replace('T', ' ') + ' hs';
    }
}

function sanitizarNumeroRecibo(rawRef, codigoPedido, medioPago) {
    const cod = String(codigoPedido || 'NB-0000').trim().toUpperCase();
    const pref = String(medioPago || '').toUpperCase() === 'EFECTIVO' ? 'REC-EFVO' : 'REC-PAGO';
    const ref = sanitizarTextoMarcaBlancaRecibo(rawRef || '');
    if (!ref || /lamda|nodo/i.test(String(rawRef || ''))) {
        return `${pref}-${cod}`;
    }
    return ref.slice(0, 48);
}

async function cargarImagenLogoTienda(nodoRow = {}) {
    const tv = (nodoRow.tema_visual && typeof nodoRow.tema_visual === 'object') ? nodoRow.tema_visual : {};
    const logos = (tv.logos && typeof tv.logos === 'object') ? tv.logos : {};
    const candidatosRutas = [
        logos.horizontal,
        logos.principal,
        logos.vertical,
        logos.isotipo
    ].filter(Boolean);

    const baseProdDir = path.join(__dirname, '..');
    for (const rel of candidatosRutas) {
        const cleanRel = String(rel).split('?')[0].replace(/^\/+/, '');
        const absPath = path.resolve(baseProdDir, cleanRel);
        if (!absPath.startsWith(path.resolve(baseProdDir))) continue;
        if (fs.existsSync(absPath)) {
            try {
                const stat = fs.statSync(absPath);
                const cacheKey = `${absPath}:${stat.mtimeMs}`;
                if (_logoImageCache.has(cacheKey)) {
                    return { img: _logoImageCache.get(cacheKey), incluyeTexto: Boolean(tv.logo_incluye_texto) };
                }
                const img = await loadImage(absPath);
                if (_logoImageCache.size > 24) _logoImageCache.clear();
                _logoImageCache.set(cacheKey, img);
                return { img, incluyeTexto: Boolean(tv.logo_incluye_texto) };
            } catch (_) {}
        }
    }

    if (nodoRow.logo_original_base64 && String(nodoRow.logo_original_base64).startsWith('data:image/')) {
        try {
            const img = await loadImage(nodoRow.logo_original_base64);
            return { img, incluyeTexto: Boolean(tv.logo_incluye_texto) };
        } catch (_) {}
    }

    return { img: null, incluyeTexto: false };
}

function trazarRectRedondeado(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
}

function envolverLineasCanvas(ctx, texto, maxWidth) {
    const palabras = String(texto || '').trim().split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return [''];
    const lineas = [];
    let actual = palabras[0];
    for (let i = 1; i < palabras.length; i++) {
        const prueba = `${actual} ${palabras[i]}`;
        if (ctx.measureText(prueba).width <= maxWidth) {
            actual = prueba;
        } else {
            lineas.push(actual);
            actual = palabras[i];
        }
    }
    lineas.push(actual);
    return lineas;
}

/**
 * Obtiene todos los datos sanitizados de marca blanca para emitir el recibo de un pedido.
 */
async function obtenerDatosReciboMarcaBlanca(pedidoId, runner = null) {
    const q = runner || db;
    const pid = Number(pedidoId || 0);
    if (!pid) {
        const err = new Error('Identificador de pedido inválido.');
        err.statusCode = 400;
        throw err;
    }

    const pedRes = await q.query(
        `SELECT npv.*,
                nm.slug AS nodo_slug,
                nm.nombre_marca,
                nm.bajada_marca,
                nm.subtitulo_marca,
                nm.barrio_zona,
                nm.direccion_retiro,
                nm.color_primario,
                nm.tema_visual,
                nm.logo_original_base64,
                nm.perfil_operativo
         FROM public.nodos_pedidos_vecinos npv
         JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
         WHERE npv.id = $1::int
         LIMIT 1`,
        [pid]
    );
    if (pedRes.rows.length === 0) {
        const err = new Error('Pedido no encontrado.');
        err.statusCode = 404;
        throw err;
    }
    const ped = pedRes.rows[0];

    const itemsRes = await q.query(
        `SELECT COALESCE(NULLIF(TRIM(nombre_vidriera_vecino), ''), nombre_publico) AS nombre_cliente,
                presentacion_etiqueta,
                cantidad,
                precio_unitario_vecino,
                subtotal_vecino
         FROM public.nodos_pedidos_items
         WHERE pedido_id = $1::int
         ORDER BY id ASC`,
        [pid]
    );

    const tv = (ped.tema_visual && typeof ped.tema_visual === 'object') ? ped.tema_visual : {};
    const pal = (tv.paleta && typeof tv.paleta === 'object') ? tv.paleta : {};
    const colorPrimario = limpiarHexColor(pal.primario || ped.color_primario, '#2F6F4E');
    const colorAcento = limpiarHexColor(pal.acento || pal.secundario || colorPrimario, colorPrimario);
    const colorFondo = limpiarHexColor(pal.fondo || '#FBF8F3', '#FBF8F3');
    const colorTexto = limpiarHexColor(pal.texto || '#241B15', '#241B15');

    const nombreMarca = sanitizarTextoMarcaBlancaRecibo(ped.nombre_marca || 'Tienda Oficial');
    const bajadaMarca = sanitizarTextoMarcaBlancaRecibo(ped.bajada_marca || ped.subtitulo_marca || '');
    const medioPagoNorm = String(ped.medio_pago || 'TRANSFERENCIA').toUpperCase();
    const esEfectivo = medioPagoNorm === 'EFECTIVO' || String(ped.estado_pago || '').toUpperCase() === 'COBRADO_EFECTIVO_GESTOR';
    const numeroRecibo = sanitizarNumeroRecibo(ped.comprobante_referencia, ped.codigo_pedido, esEfectivo ? 'EFECTIVO' : 'TRANSFERENCIA');
    const fechaEmision = ped.fecha_conciliacion_pago || ped.recibo_emitido_at || ped.fecha_entregado_vecino || new Date();

    const items = itemsRes.rows.map(it => {
        const baseNom = sanitizarTextoMarcaBlancaRecibo(it.nombre_cliente || 'Producto');
        const pres = sanitizarTextoMarcaBlancaRecibo(it.presentacion_etiqueta || '');
        const yaIncluyePeso = /\bx\s*\d+(?:[.,]\d+)?\s*(?:g|gr|kg|ml|l|un)\b/i.test(baseNom);
        const descripcion = (pres && !yaIncluyePeso && !baseNom.toLowerCase().includes(pres.toLowerCase()))
            ? `${baseNom} (${pres})`
            : baseNom;
        return {
            cantidad: Number(it.cantidad || 1),
            descripcion,
            precio_unitario: Number(it.precio_unitario_vecino || 0),
            subtotal: Number(it.subtotal_vecino || 0)
        };
    });

    const esPostal = String(ped.perfil_operativo || '').toLowerCase() === 'ecommerce_fulfillment' ||
        ['PAQUETERIA_DOMICILIO', 'PAQUETERIA_SUCURSAL', 'ENCOMIENDA'].includes(String(ped.modalidad_entrega || '').toUpperCase());

    return {
        pedido_id: Number(ped.id),
        nodo_id: Number(ped.nodo_id),
        nodo_slug: ped.nodo_slug || '',
        codigo_pedido: String(ped.codigo_pedido || '').trim(),
        tracking_token: ped.tracking_token || null,
        numero_recibo: numeroRecibo,
        fecha_emision_iso: new Date(fechaEmision).toISOString(),
        fecha_emision_label: formatearFechaHoraAr(fechaEmision),
        cliente_nombre: sanitizarTextoMarcaBlancaRecibo(ped.vecino_nombre || 'Cliente'),
        cliente_telefono: String(ped.vecino_telefono || '').trim(),
        medio_pago: esEfectivo ? 'EFECTIVO' : 'TRANSFERENCIA',
        medio_pago_label: esEfectivo ? 'Efectivo en mano al entregar' : 'Transferencia bancaria acreditada',
        etiqueta_total: esEfectivo ? 'IMPORTE COBRADO EN EFECTIVO' : 'IMPORTE TOTAL ABONADO',
        subtotal_productos: Number(ped.subtotal_productos_vecino || 0),
        cargo_envio: Number(ped.cargo_envio_barrial || 0),
        cargo_envio_label: esPostal ? 'Envío postal' : 'Envío a domicilio',
        monto_ajuste: Number(ped.monto_ajuste_credito || 0),
        total_cobrado: Number(ped.total_vecino || 0),
        pago_confirmado: Boolean(ped.impactado_cta_cte_pago) ||
            ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(ped.estado_pago || '').toUpperCase()),
        recibo_wa_enviado: Boolean(ped.recibo_wa_enviado),
        recibo_wa_detalle: ped.recibo_wa_detalle || null,
        marca: {
            nombre: nombreMarca,
            bajada: bajadaMarca,
            color_primario: colorPrimario,
            color_acento: colorAcento,
            color_fondo: colorFondo,
            color_texto: colorTexto,
            tema_visual: tv,
            logo_original_base64: ped.logo_original_base64 || null
        },
        items
    };
}

/**
 * Renderiza el recibo oficial con membrete de la tienda en PNG de alta definición (760px ancho).
 */
async function renderizarPngReciboMarcaBlanca(datos) {
    const W = 760;
    const PAD = 38;
    const CARD_X = 28;
    const CARD_W = W - CARD_X * 2;
    const INNER_X = CARD_X + PAD;
    const INNER_W = CARD_W - PAD * 2;

    const logoInfo = await cargarImagenLogoTienda({
        tema_visual: datos.marca.tema_visual,
        logo_original_base64: datos.marca.logo_original_base64
    });

    // Paso 1: medir alto dinámico de productos
    const measureCanvas = createCanvas(W, 120);
    const mctx = measureCanvas.getContext('2d');
    mctx.font = 'bold 21px sans-serif';

    const itemsMedidos = datos.items.map(it => {
        const pref = `${it.cantidad}x `;
        const lineas = envolverLineasCanvas(mctx, `${pref}${it.descripcion}`, INNER_W - 155);
        return {
            ...it,
            lineas,
            alto: Math.max(38, lineas.length * 27 + 12)
        };
    });

    const altoHeader = logoInfo.img ? (logoInfo.incluyeTexto ? 132 : 185) : 138;
    const altoMeta = 152;
    const altoItems = itemsMedidos.reduce((acc, x) => acc + x.alto, 0)
        + (datos.cargo_envio > 0 ? 40 : 0)
        + (datos.monto_ajuste > 0 ? 40 : 0)
        + 52;
    const altoTotalBox = 112;
    const altoFooter = 72;
    const H = 56 + altoHeader + altoMeta + altoItems + altoTotalBox + altoFooter;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Fondo exterior cálido de la tienda
    ctx.fillStyle = datos.marca.color_fondo;
    ctx.fillRect(0, 0, W, H);

    // Tarjeta principal blanca con sombra sutil
    ctx.save();
    ctx.shadowColor = 'rgba(20, 15, 10, 0.10)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 6;
    trazarRectRedondeado(ctx, CARD_X, 26, CARD_W, H - 52, 24);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();

    trazarRectRedondeado(ctx, CARD_X, 26, CARD_W, H - 52, 24);
    ctx.lineWidth = 2;
    ctx.strokeStyle = datos.marca.color_primario + '33';
    ctx.stroke();

    // Franja superior de identidad de marca
    ctx.save();
    trazarRectRedondeado(ctx, CARD_X, 26, CARD_W, 12, 12);
    ctx.fillStyle = datos.marca.color_primario;
    ctx.fill();
    ctx.restore();

    let y = 58;

    // Membrete oficial: Logo + Nombre comercial + Badge RECIBO DE PAGO
    if (logoInfo.img) {
        const maxLogoW = 280;
        const maxLogoH = 86;
        const ratio = Math.min(maxLogoW / logoInfo.img.width, maxLogoH / logoInfo.img.height);
        const drawW = Math.round(logoInfo.img.width * ratio);
        const drawH = Math.round(logoInfo.img.height * ratio);
        ctx.drawImage(logoInfo.img, INNER_X, y, drawW, drawH);

        if (!logoInfo.incluyeTexto) {
            ctx.fillStyle = datos.marca.color_texto;
            ctx.font = 'bold 28px sans-serif';
            ctx.fillText(datos.marca.nombre, INNER_X, y + drawH + 30);
            if (datos.marca.bajada) {
                ctx.fillStyle = '#64748B';
                ctx.font = '600 17px sans-serif';
                ctx.fillText(datos.marca.bajada.slice(0, 56), INNER_X, y + drawH + 54);
            }
        }
    } else {
        ctx.fillStyle = datos.marca.color_primario;
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(datos.marca.nombre, INNER_X, y + 38);
        if (datos.marca.bajada) {
            ctx.fillStyle = '#64748B';
            ctx.font = '600 18px sans-serif';
            ctx.fillText(datos.marca.bajada.slice(0, 58), INNER_X, y + 66);
        }
    }

    // Pastilla derecha: RECIBO DE PAGO + N°
    const badgeW = 248;
    const badgeH = 74;
    const badgeX = CARD_X + CARD_W - PAD - badgeW;
    trazarRectRedondeado(ctx, badgeX, y, badgeW, badgeH, 14);
    ctx.fillStyle = datos.marca.color_fondo;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = datos.marca.color_primario;
    ctx.stroke();

    ctx.fillStyle = datos.marca.color_primario;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('RECIBO DE PAGO', badgeX + badgeW - 16, y + 27);
    ctx.fillStyle = datos.marca.color_texto;
    ctx.font = 'bold 19px sans-serif';
    ctx.fillText(datos.numero_recibo, badgeX + badgeW - 16, y + 54);
    ctx.textAlign = 'left';

    y += altoHeader;

    // Línea divisoria
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(INNER_X, y - 16);
    ctx.lineTo(INNER_X + INNER_W, y - 16);
    ctx.stroke();

    // Cuadro de datos del cliente y pedido
    trazarRectRedondeado(ctx, INNER_X, y, INNER_W, 128, 14);
    ctx.fillStyle = '#F8FAFC';
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.stroke();

    const col2X = INNER_X + Math.round(INNER_W * 0.54);
    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('CLIENTE', INNER_X + 18, y + 28);
    ctx.fillText('FECHA Y HORA', col2X, y + 28);

    ctx.fillStyle = datos.marca.color_texto;
    ctx.font = 'bold 21px sans-serif';
    ctx.fillText(datos.cliente_nombre.slice(0, 32), INNER_X + 18, y + 54);
    ctx.font = 'bold 19px sans-serif';
    ctx.fillText(datos.fecha_emision_label, col2X, y + 54);

    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('PEDIDO', INNER_X + 18, y + 84);
    ctx.fillText('MEDIO DE PAGO', col2X, y + 84);

    ctx.fillStyle = datos.marca.color_primario;
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`#${datos.codigo_pedido}`, INNER_X + 18, y + 110);
    ctx.fillStyle = datos.marca.color_texto;
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(datos.medio_pago_label, col2X, y + 110);

    y += altoMeta;

    // Encabezado de tabla de productos
    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('DETALLE DE PRODUCTOS', INNER_X, y + 16);
    ctx.textAlign = 'right';
    ctx.fillText('IMPORTE', INNER_X + INNER_W, y + 16);
    ctx.textAlign = 'left';

    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(INNER_X, y + 28);
    ctx.lineTo(INNER_X + INNER_W, y + 28);
    ctx.stroke();

    y += 44;

    for (const it of itemsMedidos) {
        ctx.fillStyle = datos.marca.color_texto;
        ctx.font = 'bold 20px sans-serif';
        it.lineas.forEach((ln, idx) => {
            ctx.fillText(ln, INNER_X, y + 20 + idx * 26);
        });

        ctx.textAlign = 'right';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText(formatearMonedaAr(it.subtotal), INNER_X + INNER_W, y + 20);
        ctx.textAlign = 'left';

        y += it.alto;

        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(INNER_X, y - 6);
        ctx.lineTo(INNER_X + INNER_W, y - 6);
        ctx.stroke();
        ctx.restore();
    }

    if (datos.cargo_envio > 0) {
        ctx.fillStyle = '#475569';
        ctx.font = '600 19px sans-serif';
        ctx.fillText(datos.cargo_envio_label, INNER_X, y + 22);
        ctx.textAlign = 'right';
        ctx.font = 'bold 19px sans-serif';
        ctx.fillText(formatearMonedaAr(datos.cargo_envio), INNER_X + INNER_W, y + 22);
        ctx.textAlign = 'left';
        y += 40;
    }

    if (datos.monto_ajuste > 0) {
        ctx.fillStyle = '#15803D';
        ctx.font = '600 19px sans-serif';
        ctx.fillText('Bonificación / ajuste a favor', INNER_X, y + 22);
        ctx.textAlign = 'right';
        ctx.font = 'bold 19px sans-serif';
        ctx.fillText('-' + formatearMonedaAr(datos.monto_ajuste), INNER_X + INNER_W, y + 22);
        ctx.textAlign = 'left';
        y += 40;
    }

    y += 8;

    // Caja destacada de TOTAL COBRADO con el color oficial de la marca
    trazarRectRedondeado(ctx, INNER_X, y, INNER_W, 96, 16);
    ctx.fillStyle = datos.marca.color_primario;
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(datos.etiqueta_total, INNER_X + 22, y + 36);
    ctx.font = '600 15px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillText(`Pagado · Comprobante ${datos.numero_recibo}`, INNER_X + 22, y + 64);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(formatearMonedaAr(datos.total_cobrado), INNER_X + INNER_W - 22, y + 60);
    ctx.textAlign = 'left';

    y += altoTotalBox;

    // Pie limpio de agradecimiento de la tienda
    ctx.fillStyle = '#64748B';
    ctx.font = '600 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
        `Comprobante emitido por ${datos.marca.nombre} · ¡Muchas gracias por tu compra!`,
        W / 2,
        y + 26
    );
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

function resolverBaseUrlPublicaTienda() {
    const custom = String(process.env.PUBLIC_TIENDA_BASE_URL || process.env.TIENDA_PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
    if (custom) return custom;
    if (esModoLaboratorioRecibos()) {
        return `http://localhost:${process.env.PORT || 3002}`;
    }
    return 'https://tienda.lamdaser.com';
}

function construirMensajeWhatsAppReciboMarcaBlanca(datos) {
    const basePub = resolverBaseUrlPublicaTienda();
    const linkRecibo = datos.tracking_token
        ? `${basePub}/seguimiento/${encodeURIComponent(datos.tracking_token)}`
        : (datos.nodo_slug ? `${basePub}/tienda/${encodeURIComponent(datos.nodo_slug)}` : '');

    const lineasItems = datos.items.map(it =>
        `• ${it.cantidad}x ${it.descripcion}: ${formatearMonedaAr(it.subtotal)}`
    ).join('\n');

    return [
        `🧾 *RECIBO DE PAGO — ${datos.marca.nombre}*`,
        `Comprobante: *${datos.numero_recibo}* · Pedido *#${datos.codigo_pedido}*`,
        `Fecha: ${datos.fecha_emision_label}`,
        `Hola *${datos.cliente_nombre}*, registramos tu pago:`,
        lineasItems,
        datos.cargo_envio > 0 ? `• ${datos.cargo_envio_label}: ${formatearMonedaAr(datos.cargo_envio)}` : '',
        datos.monto_ajuste > 0 ? `• Bonificación: -${formatearMonedaAr(datos.monto_ajuste)}` : '',
        `✅ *${datos.etiqueta_total}: ${formatearMonedaAr(datos.total_cobrado)}*`,
        linkRecibo ? `📍 Tu pedido y comprobante digital: ${linkRecibo}` : '',
        `¡Muchas gracias por elegir *${datos.marca.nombre}*!`
    ].filter(Boolean).join('\n');
}

/**
 * Genera el recibo PNG con membrete oficial de la tienda y lo despacha automáticamente
 * al celular registrado del comprador (`vecino_telefono`) mediante `:3004/facturacion/whatsapp/enviar-imagen`.
 * Nunca lanza excepción fatal: ante teléfono inválido o desconexión degrada con elegancia y deja trazabilidad en BD.
 */
async function despacharReciboMarcaBlancaWhatsApp(pedidoId, opciones = {}) {
    const pid = Number(pedidoId || 0);
    if (!pid) {
        return { attempted: false, ok: false, error: 'ID de pedido inválido.' };
    }

    let datos = null;
    try {
        datos = await obtenerDatosReciboMarcaBlanca(pid);
    } catch (errDatos) {
        return {
            attempted: false,
            ok: false,
            error: errDatos.message || 'No se pudieron obtener los datos del recibo.'
        };
    }

    const telefonoOriginal = String(opciones.telefono_override || datos.cliente_telefono || '').trim();
    const telefonoNorm = normalizarTelefonoWhatsAppAr(telefonoOriginal);
    const mensajeTexto = construirMensajeWhatsAppReciboMarcaBlanca(datos);
    const filename = `Recibo-${datos.marca.nombre.replace(/[^a-zA-Z0-9]+/g, '-')}-${datos.codigo_pedido}.png`;

    let pngBuffer = null;
    try {
        pngBuffer = await renderizarPngReciboMarcaBlanca(datos);
    } catch (errRender) {
        console.error('⚠️ [ReciboMarcaBlanca] Error renderizando PNG, degradando a texto:', errRender.message);
    }

    const detalleEnvio = {
        attempted: true,
        ok: false,
        simulated: false,
        modo_laboratorio: esModoLaboratorioRecibos(),
        numero_recibo: datos.numero_recibo,
        codigo_pedido: datos.codigo_pedido,
        nombre_marca: datos.marca.nombre,
        cliente_nombre: datos.cliente_nombre,
        telefono_registrado: telefonoOriginal,
        telefono_normalizado: telefonoNorm,
        redirected_to: null,
        filename: pngBuffer ? filename : null,
        png_bytes: pngBuffer ? pngBuffer.length : 0,
        mensaje_caption: mensajeTexto,
        origen_disparo: opciones.origen || 'COBRO_EFECTIVO_AUTOMATICO',
        enviado_at: new Date().toISOString(),
        error: null
    };

    if (!telefonoNorm || telefonoNorm.replace(/\D/g, '').length < 10) {
        detalleEnvio.attempted = false;
        detalleEnvio.error = 'El cliente no registra un número móvil válido para envío por WhatsApp.';
    } else {
        const endpointWa = pngBuffer
            ? 'http://127.0.0.1:3004/facturacion/whatsapp/enviar-imagen'
            : 'http://127.0.0.1:3004/facturacion/whatsapp/enviar-mensaje';

        const payloadWa = pngBuffer
            ? {
                destinatarios: telefonoNorm,
                base64Data: pngBuffer.toString('base64'),
                mimeType: 'image/png',
                filename,
                mensajeTexto
            }
            : {
                destinatarios: telefonoNorm,
                mensajeTexto
            };

        try {
            const wpRes = await fetch(endpointWa, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadWa),
                signal: AbortSignal.timeout(18000)
            });
            const wpJson = await wpRes.json().catch(() => ({}));
            const resultados = Array.isArray(wpJson?.data?.resultados)
                ? wpJson.data.resultados
                : (Array.isArray(wpJson?.detalles) ? wpJson.detalles : []);

            detalleEnvio.simulated = resultados.some(r => Boolean(r && r.simulated));
            const redir = resultados.find(r => r && r.redirectedTo)?.redirectedTo || null;
            if (redir) detalleEnvio.redirected_to = redir;

            if (!wpRes.ok || !wpJson.success) {
                detalleEnvio.ok = false;
                detalleEnvio.error = wpJson.error || wpJson.message || `Servicio de mensajería no disponible (HTTP ${wpRes.status}).`;
            } else {
                const exitosos = resultados.filter(r => r && (r.success === true || r.status === 'enviado'));
                detalleEnvio.ok = resultados.length === 0 ? true : exitosos.length > 0;
                if (!detalleEnvio.ok) {
                    detalleEnvio.error = resultados[0]?.error || 'No se pudo completar el despacho por WhatsApp.';
                }
            }
        } catch (errFetch) {
            detalleEnvio.ok = false;
            detalleEnvio.error = errFetch.message || 'Servicio interno de WhatsApp (:3004) sin respuesta temporal.';
        }
    }

    try {
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET recibo_emitido_at = COALESCE(recibo_emitido_at, NOW()),
                 recibo_wa_enviado = CASE WHEN $2::boolean THEN true ELSE COALESCE(recibo_wa_enviado, false) END,
                 recibo_wa_detalle = $3::jsonb,
                 updated_at = NOW()
             WHERE id = $1::int`,
            [pid, Boolean(detalleEnvio.ok), JSON.stringify(detalleEnvio)]
        );
    } catch (errUpd) {
        console.error('⚠️ [ReciboMarcaBlanca] No se pudo guardar traza recibo_wa_detalle:', errUpd.message);
    }

    return detalleEnvio;
}

module.exports = {
    sanitizarTextoMarcaBlancaRecibo,
    normalizarTelefonoWhatsAppAr,
    obtenerDatosReciboMarcaBlanca,
    renderizarPngReciboMarcaBlanca,
    construirMensajeWhatsAppReciboMarcaBlanca,
    despacharReciboMarcaBlancaWhatsApp
};
