/**
 * ============================================================================
 * CONVERSOR DE LOGOS A ZPL (^GFA) Y PREVISUALIZADOR TÉRMICO ZEBRA MARCA BLANCA
 * Unidad de Negocio: Nodos Barriales (Marca Blanca) - Etapas 1 y 2
 * ============================================================================
 * - Convierte imágenes PNG/JPG (base64) o genera monogramas vectoriales de marca
 *   a mapas de bits monocromáticos de 1 bit compatibles con cabezales Zebra
 *   mediante el comando nativo ^GFA (Graphic Field ASCII Hex).
 * - Soporta binarización por Umbral Directo (Threshold) o Difusión de Error
 *   Floyd-Steinberg (Dithering).
 * - Genera el código ZPL en rollo de doble columna (offsetX=23 Izquierda /
 *   offsetX=443 Derecha) con preservación garantizada del gramaje/presentación
 *   en cada renglón del checklist y paginación automática con etiquetas de
 *   continuación cuando el pedido supera los 6 ítems.
 * - Renderiza una previsualización PNG de alta fidelidad del rollo térmico
 *   para validación en Modo Laboratorio sin gastar insumos físicos.
 */

const { createCanvas, loadImage } = require('canvas');

const DEFAULT_LOGO_WIDTH = 112; // Múltiplo exacto de 8 (14 bytes por fila)
const DEFAULT_LOGO_HEIGHT = 56; // 56 filas -> 14 * 56 = 784 bytes totales
const ITEMS_POR_ETIQUETA_DERECHA = 6; // Máximo de renglones en etiqueta derecha antes de emitir etiqueta de continuación

/**
 * Extrae ancho y alto (en dots 203 dpi) directamente desde el encabezado ^GFA,<total>,<total>,<bytesPorFila>,...
 */
function parsearDimensionesGfa(gfaStr = '') {
    const m = String(gfaStr || '').match(/\^GFA\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/i);
    if (!m) return null;
    const totalBytes = Number(m[1]) || 0;
    const bytesPerRow = Number(m[3]) || 0;
    if (totalBytes <= 0 || bytesPerRow <= 0) return null;
    return {
        width: bytesPerRow * 8,
        height: Math.max(1, Math.round(totalBytes / bytesPerRow))
    };
}

function resolverModoCabeceraLogo({ logoGfa = '', logoImg = null, logoZplConfig = null } = {}) {
    const gfaDims = parsearDimensionesGfa(logoGfa);
    const width = gfaDims?.width || Number(logoImg?.width) || Number(logoZplConfig?.width) || DEFAULT_LOGO_WIDTH;
    const height = gfaDims?.height || Number(logoImg?.height) || Number(logoZplConfig?.height) || DEFAULT_LOGO_HEIGHT;
    const modoConfig = String(logoZplConfig?.modo_cabecera || '').trim().toLowerCase();
    const esBannerCompleto = modoConfig === 'banner_completo' || width >= 180;
    return { width, height, esBannerCompleto };
}

/**
 * Limpia texto para ZPL (sin tildes problemáticas ni caracteres de control)
 */
function limpiarTextoZpl(texto = '') {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\^~\\]/g, ' ')
        .trim();
}

/**
 * Formatea una línea del checklist garantizando que la cantidad y el gramaje /
 * presentación NUNCA se trunquen aunque el nombre del artículo sea muy largo.
 * Ejemplo:
 *   Entrada: { cantidad: 2, descripcion: 'Almendra Nonpareil Californiana x 250g' }
 *   Salida:  "1. 2x Almendra Nonpareil Calif. x 250g"
 */
function formatearLineaChecklistSegura(it = {}, numeroOrden = 1, maxCharsTotal = 37) {
    const cant = Number(it.cantidad) || 1;
    const rawDesc = limpiarTextoZpl(it.descripcion || it.nombre_publico || 'Articulo');
    const rawPres = limpiarTextoZpl(it.presentacion_etiqueta || it.presentacion || '');

    // Detectar sufijo de gramaje/presentación al final del nombre (ej: "x 250g", "x 500g", "(6 x 50g)", "x 1kg")
    const regexGramajeFinal = /(\s*\(\d+\s*x\s*\d+\s*(?:g|gr|kg)\)|\s+x\s*\d+(?:[.,]\d+)?\s*(?:g|gr|kg|un|u)\b|\s+\d+(?:[.,]\d+)?\s*(?:g|gr|kg)\b)$/i;
    let sufijoGramaje = '';
    let nombreBase = rawDesc;

    const match = rawDesc.match(regexGramajeFinal);
    if (match) {
        sufijoGramaje = match[1].trim();
        nombreBase = rawDesc.slice(0, rawDesc.length - match[0].length).trim();
    } else if (rawPres) {
        const presLimpia = rawPres.replace(/^bolsa\s+/i, '').trim();
        sufijoGramaje = presLimpia.toLowerCase().startsWith('x') ? presLimpia : `x ${presLimpia}`;
    }

    // Normalizar sufijo para que siempre sea compacto y legible (ej: "x 250g")
    if (sufijoGramaje && !sufijoGramaje.startsWith('(') && !/^x\s/i.test(sufijoGramaje)) {
        sufijoGramaje = `x ${sufijoGramaje}`;
    }

    const prefijo = `${numeroOrden}. ${cant}x `;
    const sufijoFinal = sufijoGramaje ? ` ${sufijoGramaje}` : '';
    const espacioParaNombre = Math.max(10, maxCharsTotal - prefijo.length - sufijoFinal.length);

    let nombreAjustado = nombreBase;
    if (nombreAjustado.length > espacioParaNombre) {
        nombreAjustado = nombreAjustado.substring(0, Math.max(8, espacioParaNombre - 1)).trim() + '.';
    }

    return `${prefijo}${nombreAjustado}${sufijoFinal}`;
}

/**
 * Genera una imagen base en Canvas a partir de un monograma / insignia de Nodo
 * cuando el gestor aún no subió un PNG propio o desea generar un sello rápido.
 */
function dibujarMonogramaEnCanvas(ctx, width, height, textoMarca = 'NODO', iniciales = '') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    const siglas = (iniciales || textoMarca.split(/\s+/).map(w => w[0] || '').join('').toUpperCase() || 'NB').substring(0, 3);

    // Marco exterior redondeado negro
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, width - 4, height - 4);

    // Sello izquierdo con siglas invertidas
    const badgeW = Math.min(46, Math.floor(width * 0.42));
    ctx.fillStyle = '#000000';
    ctx.fillRect(4, 4, badgeW, height - 8);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(siglas, 4 + Math.floor(badgeW / 2), Math.floor(height / 2));

    // Texto de marca a la derecha del sello
    const words = limpiarTextoZpl(textoMarca).toUpperCase().split(/\s+/).filter(Boolean);
    const line1 = (words[0] || 'NODO').substring(0, 9);
    const line2 = (words.slice(1).join(' ') || 'BARRIAL').substring(0, 10);

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.font = 'bold 13px Arial';
    ctx.fillText(line1, badgeW + 9, Math.floor(height * 0.36));

    ctx.font = 'bold 10px Arial';
    ctx.fillText(line2, badgeW + 9, Math.floor(height * 0.70));
}

/**
 * Convierte una imagen base64 (o genera un monograma) a formato ZPL ^GFA y
 * devuelve además el PNG monocromático de 1 bit en base64 para previsualización.
 */
async function convertirLogoAZplGfa(opts = {}) {
    const rawW = Number(opts.width) || DEFAULT_LOGO_WIDTH;
    const width = Math.max(16, Math.ceil(rawW / 8) * 8);
    const height = Math.max(16, Number(opts.height) || DEFAULT_LOGO_HEIGHT);
    const threshold = Math.min(245, Math.max(15, Number(opts.threshold) || 138));
    const mode = opts.mode === 'dither' ? 'dither' : 'threshold';
    const invert = Boolean(opts.invert);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    if (opts.imageBase64 && typeof opts.imageBase64 === 'string' && opts.imageBase64.trim().length > 20) {
        const cleanDataUrl = opts.imageBase64.startsWith('data:image')
            ? opts.imageBase64
            : `data:image/png;base64,${opts.imageBase64}`;
        const img = await loadImage(cleanDataUrl);

        const totalPadding = Number.isFinite(Number(opts.padding))
            ? Math.max(0, Number(opts.padding))
            : (width >= 180 ? 2 : 4);
        const scale = Math.min((width - totalPadding) / img.width, (height - totalPadding) / img.height);
        const drawW = Math.max(1, Math.round(img.width * scale));
        const drawH = Math.max(1, Math.round(img.height * scale));
        const dx = Math.round((width - drawW) / 2);
        const dy = Math.round((height - drawH) / 2);
        ctx.drawImage(img, dx, dy, drawW, drawH);
    } else {
        dibujarMonogramaEnCanvas(ctx, width, height, opts.nombreMarca || 'NODO BARRIAL', opts.iniciales || '');
    }

    const imgData = ctx.getImageData(0, 0, width, height);
    const rgba = imgData.data;

    const lum = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const alpha = rgba[idx + 3] / 255;
        const r = rgba[idx] * alpha + 255 * (1 - alpha);
        const g = rgba[idx + 1] * alpha + 255 * (1 - alpha);
        const b = rgba[idx + 2] * alpha + 255 * (1 - alpha);
        let l = 0.299 * r + 0.587 * g + 0.114 * b;
        if (invert) l = 255 - l;
        lum[i] = l;
    }

    const isBlackBit = new Uint8Array(width * height);
    if (mode === 'dither') {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pos = y * width + x;
                const oldVal = lum[pos];
                const newVal = oldVal < threshold ? 0 : 255;
                isBlackBit[pos] = newVal === 0 ? 1 : 0;
                const err = oldVal - newVal;

                if (x + 1 < width) lum[pos + 1] += (err * 7) / 16;
                if (x - 1 >= 0 && y + 1 < height) lum[pos + width - 1] += (err * 3) / 16;
                if (y + 1 < height) lum[pos + width] += (err * 5) / 16;
                if (x + 1 < width && y + 1 < height) lum[pos + width + 1] += (err * 1) / 16;
            }
        }
    } else {
        for (let i = 0; i < width * height; i++) {
            isBlackBit[i] = lum[i] < threshold ? 1 : 0;
        }
    }

    const bytesPerRow = width / 8;
    const totalBytes = bytesPerRow * height;
    const hexRows = [];

    for (let y = 0; y < height; y++) {
        let rowHex = '';
        for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
            let byteVal = 0;
            for (let bit = 0; bit < 8; bit++) {
                const x = byteIdx * 8 + bit;
                const pos = y * width + x;
                const black = isBlackBit[pos] === 1;
                if (black) {
                    byteVal |= (1 << (7 - bit));
                }
                const pIdx = pos * 4;
                const color = black ? 15 : 255;
                rgba[pIdx] = color;
                rgba[pIdx + 1] = color;
                rgba[pIdx + 2] = color;
                rgba[pIdx + 3] = 255;
            }
            rowHex += byteVal.toString(16).toUpperCase().padStart(2, '0');
        }
        hexRows.push(rowHex);
    }

    ctx.putImageData(imgData, 0, 0);
    const previewBase64 = canvas.toDataURL('image/png');
    const hexString = hexRows.join('');
    const zplGfa = `^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hexString}`;

    return {
        width,
        height,
        bytesPerRow,
        totalBytes,
        threshold,
        mode,
        invert,
        logo_zpl_gfa: zplGfa,
        logo_mono_preview_base64: previewBase64,
        isBlackBit
    };
}

/**
 * Divide la lista de ítems del pedido de un vecino en bloques de hasta
 * ITEMS_POR_ETIQUETA_DERECHA (6 ítems por etiqueta derecha).
 */
function paginarItemsEtiqueta(items = []) {
    const lista = Array.isArray(items) && items.length > 0
        ? items
        : [
            { cantidad: 2, descripcion: 'Almendra Nonpareil Californiana x 250g' },
            { cantidad: 1, descripcion: 'Granola de Sol Crocante x 500g' },
            { cantidad: 1, descripcion: 'Mix Frutos Secos con Pasas x 500g' },
            { cantidad: 1, descripcion: 'Nuez Mariposa Extra Light x 250g' }
        ];

    const paginas = [];
    for (let i = 0; i < lista.length; i += ITEMS_POR_ETIQUETA_DERECHA) {
        paginas.push(lista.slice(i, i + ITEMS_POR_ETIQUETA_DERECHA));
    }
    return paginas;
}

/**
 * Genera el código ZPL completo del Par Gemelo en rollo de doble columna:
 * - Izquierda (X=23): Identidad Marca Blanca del Nodo + Vecino + Dirección/Ventana + QR + Estado de Pago invertido (^FR)
 * - Derecha (X=443): Checklist de armado con gramaje siempre visible al final.
 */
function generarEtiquetaZplParNodo(params = {}) {
    const nombreMarca = limpiarTextoZpl(params.nombre_marca || 'ALMACEN VERDE CITY BELL').toUpperCase();
    const subtituloMarca = limpiarTextoZpl(params.bajada_marca || params.subtitulo_marca || 'Pedido Vecinal - Entrega Fresca');
    const logoGfa = (params.logo_zpl_gfa && params.logo_zpl_gfa.startsWith('^GFA'))
        ? params.logo_zpl_gfa
        : '';
    const logoCabecera = resolverModoCabeceraLogo({ logoGfa, logoZplConfig: params.logo_zpl_config });

    const pedidoCodigo = limpiarTextoZpl(params.pedido_codigo || 'NB-1042');
    const vecinoNombre = limpiarTextoZpl(params.vecino_nombre || 'MARIA LAURA GOMEZ').toUpperCase();
    const vecinoTelefono = limpiarTextoZpl(params.vecino_telefono || '221-554-8910');
    const modalidadEntrega = limpiarTextoZpl(params.modalidad_entrega || 'RETIRO EN NODO (17:00 A 20:00 HS)');
    const direccionBarrial = limpiarTextoZpl(params.direccion_barrial || 'Cantilo 452 e/ 13c y 14 - City Bell');
    const estadoPago = limpiarTextoZpl(params.estado_pago || 'PAGADO (TRANSFERENCIA)');
    const montoCobrar = Number(params.monto_cobrar || 0);
    const bultosTexto = limpiarTextoZpl(params.bultos_texto || 'BOLSA 1/1');

    const paginas = paginarItemsEtiqueta(params.items);
    const totalHojas = paginas.length;
    const totalItemsPedido = Array.isArray(params.items) ? params.items.length : paginas.reduce((a, p) => a + p.length, 0);

    // Ajuste tipográfico dinámico del título para que entren hasta 32 caracteres sin cortarse
    const fontTituloZpl = nombreMarca.length > 22 ? '19,18' : '22,21';

    const bloquesZpl = paginas.map((itemsPagina, pageIndex) => {
        const numHoja = pageIndex + 1;
        const esContinuacion = numHoja > 1;
        const textoBanderaPago = estadoPago.includes('EFECTIVO') && montoCobrar > 0
            ? `COBRAR EFECTIVO: $${montoCobrar.toLocaleString('es-AR')}`
            : estadoPago;

        const lineasChecklistZpl = itemsPagina.map((it, idx) => {
            const globalIdx = pageIndex * ITEMS_POR_ETIQUETA_DERECHA + idx + 1;
            const yPos = 66 + idx * 32;
            const lineaSegura = formatearLineaChecklistSegura(it, globalIdx, 37);
            return [
                `^FO446,${yPos}^GB18,18,2^FS`,
                `^FO470,${yPos + 1}^A0N,18,17^FD${lineaSegura}^FS`
            ].join('\n');
        }).join('\n');

        const xRightBadge = Math.min(315, 25 + Math.min(logoCabecera.width, 280) + 10);
        const bloqueCabeceraIzqZpl = logoGfa && logoCabecera.esBannerCompleto
            ? [
                `^FO25,8${logoGfa}^FS`,
                ...(esContinuacion ? [
                    `^FO${xRightBadge},18^A0N,17,17^FDHOJA ${numHoja}/${totalHojas}^FS`,
                    `^FO${xRightBadge},40^A0N,14,14^FDCONT. CHECK^FS`
                ] : [])
            ]
            : [
                logoGfa ? `^FO25,14${logoGfa}^FS` : '^FO25,14^GB108,54,3^FS^FO42,30^A0N,24,24^FDNODO^FS',
                `^FO142,16^A0N,${fontTituloZpl}^FD${nombreMarca.substring(0, 32)}^FS`,
                `^FO142,42^A0N,15,14^FD${esContinuacion ? `CONTINUACION CHECKLIST (HOJA ${numHoja}/${totalHojas})` : subtituloMarca.substring(0, 44)}^FS`
            ];

        return [
            '^XA',
            '^CI28',
            '^PW830',
            '^LL280',
            // ================= COLUMNA IZQUIERDA (X=23): PORTADA MARCA BLANCA =================
            ...bloqueCabeceraIzqZpl,
            '^FO23,76^GB372,2,2^FS',
            `^FO23,84^A0N,21,20^FDVECINO: ${vecinoNombre.substring(0, 26)}^FS`,
            `^FO23,110^A0N,17,17^FD${modalidadEntrega.substring(0, 38)}^FS`,
            `^FO23,132^A0N,16,15^FD${direccionBarrial.substring(0, 36)} | Tel: ${vecinoTelefono}^FS`,
            '^FO23,156^GB372,2,2^FS',
            // QR de Despacho en Estación Nodos (abajo a la izquierda)
            `^FO25,166^BQN,2,3^FDMA,${pedidoCodigo}-H${numHoja}^FS`,
            // Banda invertida (^FR) de Estado de Pago + Bulto/Hoja
            '^FO118,166^GB276,94,94^FS',
            `^FO128,176^FR^A0N,20,19^FD${textoBanderaPago.substring(0, 26)}^FS`,
            `^FO128,204^FR^A0N,19,19^FDPEDIDO #${pedidoCodigo} | ${bultosTexto}^FS`,
            `^FO128,230^FR^A0N,18,18^FDHOJA ETIQUETA ${numHoja} DE ${totalHojas}^FS`,

            // ================= COLUMNA DERECHA (X=443): CHECKLIST DE ARMADO =================
            `^FO443,16^A0N,21,21^FDCHECKLIST #${pedidoCodigo} (${totalItemsPedido} ITEMS)^FS`,
            `^FO443,40^A0N,16,16^FDVECINO: ${vecinoNombre.substring(0, 24)} [HOJA ${numHoja}/${totalHojas}]^FS`,
            '^FO443,60^GB368,2,2^FS',
            lineasChecklistZpl,
            '^XZ'
        ].join('\n');
    });

    return {
        zpl: bloquesZpl.join('\n\n'),
        totalHojas,
        totalItemsPedido,
        paginas
    };
}

/**
 * Renderiza en Canvas una previsualización gráfica exacta del rollo térmico
 * de doble columna (incluyendo las filas adicionales si hay etiqueta de continuación).
 */
async function generarPreviewVisualEtiquetaPar(params = {}) {
    const resultadoZpl = generarEtiquetaZplParNodo(params);
    const { paginas, totalHojas, totalItemsPedido } = resultadoZpl;

    const labelW = 405;
    const labelH = 270;
    const gapX = 20;
    const gapY = 20;
    const padOuter = 16;

    const canvasW = padOuter * 2 + labelW * 2 + gapX;
    const canvasH = padOuter * 2 + totalHojas * labelH + (totalHojas - 1) * gapY;

    const canvas = createCanvas(canvasW, canvasH);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, canvasW, canvasH);

    let logoImg = null;
    if (params.logo_mono_preview_base64) {
        try {
            const cleanUrl = params.logo_mono_preview_base64.startsWith('data:image')
                ? params.logo_mono_preview_base64
                : `data:image/png;base64,${params.logo_mono_preview_base64}`;
            logoImg = await loadImage(cleanUrl);
        } catch (_) {
            logoImg = null;
        }
    }

    const nombreMarca = limpiarTextoZpl(params.nombre_marca || 'ALMACEN VERDE CITY BELL').toUpperCase();
    const subtituloMarca = limpiarTextoZpl(params.bajada_marca || params.subtitulo_marca || 'Pedido Vecinal - Entrega Fresca');
    const logoCabecera = resolverModoCabeceraLogo({
        logoGfa: params.logo_zpl_gfa,
        logoImg,
        logoZplConfig: params.logo_zpl_config
    });
    const pedidoCodigo = limpiarTextoZpl(params.pedido_codigo || 'NB-1042');
    const vecinoNombre = limpiarTextoZpl(params.vecino_nombre || 'MARIA LAURA GOMEZ').toUpperCase();
    const vecinoTelefono = limpiarTextoZpl(params.vecino_telefono || '221-554-8910');
    const modalidadEntrega = limpiarTextoZpl(params.modalidad_entrega || 'RETIRO EN NODO (17:00 A 20:00 HS)');
    const direccionBarrial = limpiarTextoZpl(params.direccion_barrial || 'Cantilo 452 e/ 13c y 14 - City Bell');
    const estadoPago = limpiarTextoZpl(params.estado_pago || 'PAGADO (TRANSFERENCIA)');
    const montoCobrar = Number(params.monto_cobrar || 0);
    const bultosTexto = limpiarTextoZpl(params.bultos_texto || 'BOLSA 1/1');

    const textoBanderaPago = estadoPago.includes('EFECTIVO') && montoCobrar > 0
        ? `COBRAR EFECTIVO: $${montoCobrar.toLocaleString('es-AR')}`
        : estadoPago;

    for (let pageIndex = 0; pageIndex < totalHojas; pageIndex++) {
        const itemsPagina = paginas[pageIndex];
        const numHoja = pageIndex + 1;
        const esContinuacion = numHoja > 1;
        const rowY = padOuter + pageIndex * (labelH + gapY);

        const leftX = padOuter;
        const rightX = padOuter + labelW + gapX;

        for (const lx of [leftX, rightX]) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(lx, rowY, labelW, labelH);
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(lx, rowY, labelW, labelH);
        }

        // ================= DIBUJAR ETIQUETA IZQUIERDA =================
        if (logoImg && logoCabecera.esBannerCompleto) {
            const scalePv = Math.min(1, (labelW - 22) / logoImg.width, 64 / logoImg.height);
            const drawW = Math.round(logoImg.width * scalePv);
            const drawH = Math.round(logoImg.height * scalePv);
            ctx.drawImage(logoImg, leftX + 10, rowY + 6 + Math.round((64 - drawH) / 2), drawW, drawH);
            if (esContinuacion) {
                const bx = Math.min(leftX + labelW - 95, leftX + 14 + drawW);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillStyle = '#b45309';
                ctx.font = 'bold 11px Arial';
                ctx.fillText(`HOJA ${numHoja}/${totalHojas}`, bx, rowY + 18);
                ctx.font = 'bold 9.5px Arial';
                ctx.fillText('CONT. CHECK', bx, rowY + 36);
            }
        } else {
            if (logoImg) {
                ctx.drawImage(logoImg, leftX + 10, rowY + 10, 112, 56);
            } else {
                dibujarMonogramaEnCanvas(ctx, 112, 56, nombreMarca);
            }

            ctx.fillStyle = '#0f172a';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.font = nombreMarca.length > 21 ? 'bold 13px Arial' : 'bold 15px Arial';
            ctx.fillText(nombreMarca.substring(0, 32), leftX + 128, rowY + 14);

            const textoSub = esContinuacion
                ? `CONTINUACION CHECKLIST (HOJA ${numHoja}/${totalHojas})`
                : subtituloMarca.substring(0, 44);
            ctx.font = textoSub.length > 30 ? 'bold 10px Arial' : 'bold 11px Arial';
            ctx.fillStyle = esContinuacion ? '#b45309' : '#334155';
            ctx.fillText(textoSub, leftX + 128, rowY + 38);
        }

        ctx.fillStyle = '#000000';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        ctx.fillStyle = '#000000';
        ctx.fillRect(leftX + 10, rowY + 72, labelW - 20, 2);

        ctx.font = 'bold 13px Arial';
        ctx.fillText(`VECINO: ${vecinoNombre.substring(0, 26)}`, leftX + 10, rowY + 80);

        ctx.font = 'bold 11px Arial';
        ctx.fillText(modalidadEntrega.substring(0, 38), leftX + 10, rowY + 102);

        ctx.font = '10.5px Arial';
        ctx.fillText(`${direccionBarrial.substring(0, 36)} | Tel: ${vecinoTelefono}`, leftX + 10, rowY + 122);

        ctx.fillRect(leftX + 10, rowY + 144, labelW - 20, 2);

        // Simulación QR a la izquierda
        const qrX = leftX + 12;
        const qrY = rowY + 154;
        const qrSize = 82;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(qrX, qrY, qrSize, qrSize);
        ctx.fillStyle = '#000000';
        ctx.fillRect(qrX + 6, qrY + 6, 20, 20);
        ctx.fillRect(qrX + qrSize - 26, qrY + 6, 20, 20);
        ctx.fillRect(qrX + 6, qrY + qrSize - 26, 20, 20);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(qrX + 10, qrY + 10, 12, 12);
        ctx.fillRect(qrX + qrSize - 22, qrY + 10, 12, 12);
        ctx.fillRect(qrX + 10, qrY + qrSize - 22, 12, 12);
        ctx.fillStyle = '#000000';
        ctx.fillRect(qrX + 13, qrY + 13, 6, 6);
        ctx.fillRect(qrX + qrSize - 19, qrY + 13, 6, 6);
        ctx.fillRect(qrX + 13, qrY + qrSize - 19, 6, 6);
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                if ((r + c + pageIndex) % 2 === 0) {
                    ctx.fillRect(qrX + 30 + c * 7, qrY + 30 + r * 7, 5, 5);
                }
            }
        }
        ctx.font = 'bold 9px monospace';
        ctx.fillText(pedidoCodigo, qrX + 14, qrY + qrSize + 4);

        // Banda invertida (^FR) negra con texto blanco
        const bandX = leftX + 104;
        const bandY = rowY + 154;
        const bandW = labelW - 114;
        const bandH = 96;
        ctx.fillStyle = '#000000';
        ctx.fillRect(bandX, bandY, bandW, bandH);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12.5px Arial';
        ctx.fillText(textoBanderaPago.substring(0, 27), bandX + 10, bandY + 14);
        ctx.font = 'bold 12px Arial';
        ctx.fillText(`PEDIDO #${pedidoCodigo} | ${bultosTexto}`, bandX + 10, bandY + 42);
        ctx.font = '11px monospace';
        ctx.fillText(`HOJA ETIQUETA ${numHoja} DE ${totalHojas}`, bandX + 10, bandY + 68);

        // ================= DIBUJAR ETIQUETA DERECHA (CHECKLIST SIN RECORTE DE GRAMAJE) =================
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`CHECKLIST #${pedidoCodigo} (${totalItemsPedido} ITEMS)`, rightX + 12, rowY + 14);

        ctx.font = 'bold 11px Arial';
        ctx.fillText(`VECINO: ${vecinoNombre.substring(0, 24)} [HOJA ${numHoja}/${totalHojas}]`, rightX + 12, rowY + 36);

        ctx.fillRect(rightX + 10, rowY + 54, labelW - 20, 2);

        itemsPagina.forEach((it, idx) => {
            const globalIdx = pageIndex * ITEMS_POR_ETIQUETA_DERECHA + idx + 1;
            const itemY = rowY + 64 + idx * 31;

            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeRect(rightX + 12, itemY, 15, 15);

            const lineaSegura = formatearLineaChecklistSegura(it, globalIdx, 37);
            ctx.fillStyle = '#000000';
            ctx.font = 'bold 11.5px Arial';
            ctx.fillText(lineaSegura, rightX + 34, itemY + 2);
        });

        if (numHoja < totalHojas) {
            ctx.fillStyle = '#000000';
            ctx.font = 'italic bold 10px Arial';
            ctx.fillText(`>>> Continua en Hoja ${numHoja + 1}/${totalHojas}...`, rightX + 12, rowY + labelH - 18);
        }
    }

    return {
        ...resultadoZpl,
        preview_rollo_base64: canvas.toDataURL('image/png')
    };
}

/**
 * Formatea una línea del manifiesto del canasto protegiendo SIEMPRE el estado e importe
 * entre paréntesis al final del renglón (abreviando el nombre intermedio del vecino si es largo).
 * Ejemplo:
 *   "María Laura Gómez" -> "1. [NB-1041] Maria Laura G. (Pagado Transf.)"
 *   "Valeria Sánchez"   -> "2. [NB-1042] Valeria S. (Efvo $24.950)"
 */
function formatearLineaManifiestoCanastoSegura(p, numeroOrden, maxCharsTotal = 42) {
    const prefijo = `${numeroOrden}. [${limpiarTextoZpl(p.codigo_pedido || '')}]`;
    const estadoUpper = String(p.estado_pago || '').toUpperCase();
    const esEfectivo = String(p.medio_pago || '').toUpperCase() === 'EFECTIVO' || estadoUpper.includes('COBRAR') || estadoUpper.includes('EFECTIVO');
    const cobroTxt = esEfectivo
        ? `Efvo $${Number(p.total_vecino || 0).toLocaleString('es-AR')}`
        : 'Pagado Transf.';
    const sufijo = `(${cobroTxt})`;

    const espacioNombre = Math.max(7, maxCharsTotal - prefijo.length - sufijo.length - 2);
    let nombre = limpiarTextoZpl(p.vecino_nombre || 'Vecino');

    if (nombre.length > espacioNombre) {
        const partes = nombre.split(/\s+/).filter(Boolean);
        if (partes.length >= 2) {
            // Intentar dejar primer nombre completo e iniciales de apellidos/segundos nombres
            const conInicialFinal = `${partes.slice(0, -1).join(' ')} ${partes[partes.length - 1].charAt(0)}.`;
            if (conInicialFinal.length <= espacioNombre) {
                nombre = conInicialFinal;
            } else {
                const soloPrimeroEIniciales = `${partes[0]} ${partes.slice(1).map(w => w.charAt(0) + '.').join(' ')}`;
                nombre = soloPrimeroEIniciales.length <= espacioNombre
                    ? soloPrimeroEIniciales
                    : `${nombre.substring(0, Math.max(4, espacioNombre - 1)).trim()}.`;
            }
        } else {
            nombre = `${nombre.substring(0, Math.max(4, espacioNombre - 1)).trim()}.`;
        }
    }

    return `${prefijo} ${nombre} ${sufijo}`;
}

/**
 * Genera el ZPL II y el preview visual de la Etiqueta de Canasto Maestro (ESTACION_NODOS)
 * con el QR Maestro para el retiro del lote completo por parte del Gestor del Nodo.
 */
async function generarPreviewVisualCanastoQrMaestro(params = {}) {
    const nombreMarca = limpiarTextoZpl(params.nombre_marca || 'ALMACEN VERDE CITY BELL').toUpperCase();
    const codigoCanasto = limpiarTextoZpl(params.codigo_canasto || 'CAN-N001-20261111');
    const qrPayload = limpiarTextoZpl(params.qr_maestro_payload || `LAMDA-CANASTO|${codigoCanasto}`);
    const gestorNombre = limpiarTextoZpl(params.gestor_nombre || 'Carolina Mendez');
    const fechaEntregaLabel = limpiarTextoZpl(params.fecha_entrega_label || 'Miercoles 11/11 (17:00 a 20:00 hs)');
    const totalBolsas = Number(params.total_bolsas || 0);
    const bolsasArmadas = Number(params.bolsas_armadas || 0);
    const totalBaseLamda = Number(params.total_base_lamda || 0);
    const estadoCanasto = limpiarTextoZpl(params.estado_canasto || 'LISTO_ESTACION_NODOS');
    const pedidos = Array.isArray(params.pedidos) ? params.pedidos : [];

    let logoGfa = params.logo_zpl_gfa;
    let logoPreviewB64 = params.logo_mono_preview_base64;
    if (!logoGfa || !logoPreviewB64) {
        const conv = await convertirLogoAZplGfa({ nombreMarca });
        logoGfa = conv.logo_zpl_gfa;
        logoPreviewB64 = conv.logo_mono_preview_base64;
    }

    const leftX = 23;
    const rightX = 443;
    const logoCabecera = resolverModoCabeceraLogo({ logoGfa, logoZplConfig: params.logo_zpl_config });

    const lineasPedidosZpl = pedidos.slice(0, 6).map((p, idx) => {
        const rowY = 74 + idx * 31;
        const lineaSegura = formatearLineaManifiestoCanastoSegura(p, idx + 1, 42);
        return [
            `^FO${rightX + 10},${rowY}^GB16,16,2^FS`,
            `^FO${rightX + 34},${rowY + 1}^A0N,17,16^FD${lineaSegura}^FS`
        ].join('\n');
    }).join('\n');

    const xCanastoTagZpl = leftX + Math.min(282, logoCabecera.width + 12);
    const bloqueCabeceraCanastoZpl = logoCabecera.esBannerCompleto
        ? [
            `^FO${leftX + 4},6${logoGfa}^FS`,
            `^FO${xCanastoTagZpl},14^A0N,16,15^FDCANASTO NODOS^FS`,
            `^FO${xCanastoTagZpl},34^A0N,14,13^FD${codigoCanasto.slice(0, 14)}^FS`,
            `^FO${xCanastoTagZpl},51^A0N,12,12^FDESTACION NODOS^FS`
        ]
        : [
            `^FO${leftX + 8},10${logoGfa}`,
            `^FO${leftX + 128},14^A0N,22,20^FD${nombreMarca.substring(0, 30)}^FS`,
            `^FO${leftX + 128},40^A0N,16,16^FDCANASTO ESTACION NODOS (${codigoCanasto})^FS`
        ];

    const zpl = [
        '^XA',
        '^CI28',
        '^PW840',
        '^LL280',
        '^LH0,0',
        // Etiqueta Izquierda: QR Maestro del Canasto en ESTACION_NODOS
        ...bloqueCabeceraCanastoZpl,
        `^FO${leftX + 8},72^GB378,2,2^FS`,
        `^FO${leftX + 8},80^A0N,20,20^FDGESTOR: ${gestorNombre.substring(0, 26)}^FS`,
        `^FO${leftX + 8},104^A0N,17,17^FDENTREGA: ${fechaEntregaLabel.substring(0, 34)}^FS`,
        `^FO${leftX + 8},125^A0N,16,16^FDUBICACION: 4TO DEPOSITO (ESTACION_NODOS)^FS`,
        `^FO${leftX + 8},145^GB378,2,2^FS`,
        `^FO${leftX + 10},152^BQN,2,4^FDQA,${qrPayload}^FS`,
        `^FO${leftX + 104},154^GB282,96,96^FS`,
        `^FO${leftX + 112},164^FR^A0N,20,19^FDQR MAESTRO: ${bolsasArmadas}/${totalBolsas} BOLSAS^FS`,
        `^FO${leftX + 112},192^FR^A0N,19,18^FDBASE LOTE: $${totalBaseLamda.toLocaleString('es-AR')}^FS`,
        `^FO${leftX + 112},220^FR^A0N,16,16^FD${estadoCanasto === 'ENTREGADO_AL_GESTOR' ? 'RETIRADO POR GESTOR' : 'ESCANEAR AL RETIRAR LOTE'}^FS`,
        // Etiqueta Derecha: Manifiesto de Bolsas del Canasto
        `^FO${rightX + 10},14^A0N,21,20^FDMANIFIESTO CANASTO (${totalBolsas} PEDIDOS)^FS`,
        `^FO${rightX + 10},38^A0N,16,16^FDLOTE: ${codigoCanasto} | ${gestorNombre.substring(0, 18)}^FS`,
        `^FO${rightX + 10},58^GB378,2,2^FS`,
        lineasPedidosZpl,
        '^XZ'
    ].join('\n');

    const labelW = 405;
    const labelH = 266;
    const gapX = 16;
    const padOuter = 14;
    const canvasW = padOuter * 2 + labelW * 2 + gapX;
    const canvasH = padOuter * 2 + labelH;

    const canvas = createCanvas(canvasW, canvasH);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, canvasW, canvasH);

    let logoImg = null;
    try {
        logoImg = await loadImage(logoPreviewB64);
    } catch (_) {
        logoImg = null;
    }

    const lxLeft = padOuter;
    const lxRight = padOuter + labelW + gapX;
    const rowY = padOuter;

    for (const lx of [lxLeft, lxRight]) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(lx, rowY, labelW, labelH);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(lx, rowY, labelW, labelH);
    }

    if (logoImg && (logoCabecera.esBannerCompleto || logoImg.width >= 180)) {
        const scalePv = Math.min(1, 272 / logoImg.width, 62 / logoImg.height);
        const drawW = Math.round(logoImg.width * scalePv);
        const drawH = Math.round(logoImg.height * scalePv);
        ctx.drawImage(logoImg, lxLeft + 8, rowY + 6 + Math.round((62 - drawH) / 2), drawW, drawH);

        const bx = lxLeft + Math.min(286, drawW + 14);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 11px Arial';
        ctx.fillText('CANASTO', bx, rowY + 14);
        ctx.fillStyle = '#0284c7';
        ctx.font = 'bold 9.5px Arial';
        ctx.fillText(codigoCanasto.slice(0, 14), bx, rowY + 32);
        ctx.fillStyle = '#475569';
        ctx.font = 'bold 9px Arial';
        ctx.fillText('EST. NODOS', bx, rowY + 48);
    } else {
        if (logoImg) {
            ctx.drawImage(logoImg, lxLeft + 10, rowY + 10, 112, 56);
        } else {
            dibujarMonogramaEnCanvas(ctx, 112, 56, nombreMarca);
        }

        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = nombreMarca.length > 21 ? 'bold 13px Arial' : 'bold 15px Arial';
        ctx.fillText(nombreMarca.substring(0, 32), lxLeft + 128, rowY + 14);

        ctx.font = 'bold 11px Arial';
        ctx.fillStyle = '#0284c7';
        ctx.fillText(`CANASTO ESTACION NODOS (${codigoCanasto})`, lxLeft + 128, rowY + 38);
    }

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillRect(lxLeft + 10, rowY + 72, labelW - 20, 2);

    ctx.font = 'bold 13px Arial';
    ctx.fillText(`GESTOR: ${gestorNombre.substring(0, 26)}`, lxLeft + 10, rowY + 80);

    ctx.font = 'bold 11px Arial';
    ctx.fillText(`ENTREGA: ${fechaEntregaLabel.substring(0, 36)}`, lxLeft + 10, rowY + 102);

    ctx.font = '10.5px Arial';
    ctx.fillText('UBICACION: 4TO DEPOSITO (ESTACION_NODOS)', lxLeft + 10, rowY + 122);

    ctx.fillRect(lxLeft + 10, rowY + 144, labelW - 20, 2);

    // QR Maestro simulado
    const qrX = lxLeft + 12;
    const qrY = rowY + 154;
    const qrSize = 82;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(qrX, qrY, qrSize, qrSize);
    ctx.fillStyle = '#000000';
    ctx.fillRect(qrX + 6, qrY + 6, 20, 20);
    ctx.fillRect(qrX + qrSize - 26, qrY + 6, 20, 20);
    ctx.fillRect(qrX + 6, qrY + qrSize - 26, 20, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qrX + 10, qrY + 10, 12, 12);
    ctx.fillRect(qrX + qrSize - 22, qrY + 10, 12, 12);
    ctx.fillRect(qrX + 10, qrY + qrSize - 22, 12, 12);
    ctx.fillStyle = '#000000';
    ctx.fillRect(qrX + 13, qrY + 13, 6, 6);
    ctx.fillRect(qrX + qrSize - 19, qrY + 13, 6, 6);
    ctx.fillRect(qrX + 13, qrY + qrSize - 19, 6, 6);
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
            if ((r * 3 + c) % 2 === 0) {
                ctx.fillRect(qrX + 30 + c * 7, qrY + 30 + r * 7, 5, 5);
            }
        }
    }
    ctx.font = 'bold 8.5px monospace';
    ctx.fillText(codigoCanasto.substring(0, 16), qrX + 4, qrY + qrSize + 4);

    // Banda invertida negra
    const bandX = lxLeft + 104;
    const bandY = rowY + 154;
    const bandW = labelW - 114;
    const bandH = 96;
    ctx.fillStyle = '#000000';
    ctx.fillRect(bandX, bandY, bandW, bandH);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px Arial';
    ctx.fillText(`QR MAESTRO: ${bolsasArmadas}/${totalBolsas} BOLSAS`, bandX + 10, bandY + 14);
    ctx.font = 'bold 12.5px Arial';
    ctx.fillText(`BASE LOTE: $${totalBaseLamda.toLocaleString('es-AR')}`, bandX + 10, bandY + 42);
    ctx.font = 'bold 10.5px monospace';
    ctx.fillText(
        estadoCanasto === 'ENTREGADO_AL_GESTOR' ? 'RETIRADO POR GESTOR' : 'ESCANEAR AL RETIRAR LOTE',
        bandX + 10,
        bandY + 68
    );

    // Etiqueta derecha: Manifiesto de Bolsas
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 13.5px Arial';
    ctx.fillText(`MANIFIESTO CANASTO (${totalBolsas} BOLSAS VECINOS)`, lxRight + 12, rowY + 14);
    ctx.font = 'bold 11px Arial';
    ctx.fillText(`LOTE: ${codigoCanasto} | GESTOR: ${gestorNombre.substring(0, 18)}`, lxRight + 12, rowY + 36);
    ctx.fillRect(lxRight + 10, rowY + 54, labelW - 20, 2);

    pedidos.slice(0, 6).forEach((p, idx) => {
        const itemY = rowY + 64 + idx * 31;
        const armada = p.estado_operativo === 'ARMADO_EN_CANASTO' || p.estado_operativo === 'EN_PODER_GESTOR' || p.estado_operativo === 'ENTREGADO_VECINO';

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(lxRight + 12, itemY, 15, 15);
        if (armada) {
            ctx.fillStyle = '#000000';
            ctx.font = 'bold 12px Arial';
            ctx.fillText('✓', lxRight + 14, itemY + 1);
        }

        const lineaSegura = formatearLineaManifiestoCanastoSegura(p, idx + 1, 42);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 11px Arial';
        ctx.fillText(lineaSegura, lxRight + 34, itemY + 2);
    });

    return {
        zpl,
        total_hojas: 1,
        codigo_canasto: codigoCanasto,
        qr_maestro_payload: qrPayload,
        preview_rollo_base64: canvas.toDataURL('image/png')
    };
}

function sanitizarCaraClienteSinLamda(texto = '') {
    return limpiarTextoZpl(texto)
        .replace(/\blamda\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * Genera el par térmico Zebra ZD220 para órdenes de E-Commerce / Fulfillment Nacional:
 * - Cara Izquierda (X=23, adherida a la caja): 100% Marca Blanca del creador (logo ^GFA,
 *   marca, orden, destinatario, DNI, domicilio/sucursal, Localidad + Provincia + CP,
 *   operador postal y QR hacia https://tienda.lamdaser.com/tienda/<slug>?seguimiento=<token>),
 *   con CERO menciones a "LAMDA".
 * - Talón Derecho (X=443, desmontable de planta): Control Interno Depósito LAMDA con
 *   [SKU] Nomenclatura Oficial LAMDA, cantidades exactas, peso total y fecha/hora de armado.
 */
function generarEtiquetaZplParFulfillment(params = {}) {
    const nombreMarca = sanitizarCaraClienteSinLamda(params.nombre_marca || 'TIENDA OFICIAL').toUpperCase() || 'TIENDA OFICIAL';
    const subtituloMarca = sanitizarCaraClienteSinLamda(params.bajada_marca || params.subtitulo_marca || 'Tienda Online Oficial');
    const logoGfa = (params.logo_zpl_gfa && String(params.logo_zpl_gfa).startsWith('^GFA'))
        ? params.logo_zpl_gfa
        : '';
    const logoCabecera = resolverModoCabeceraLogo({ logoGfa, logoZplConfig: params.logo_zpl_config });

    const pedidoCodigo = sanitizarCaraClienteSinLamda(params.pedido_codigo || 'NB-1001');
    const destinatarioNombre = sanitizarCaraClienteSinLamda(params.destinatario_nombre || params.vecino_nombre || 'CLIENTE').toUpperCase();
    const destinatarioDni = sanitizarCaraClienteSinLamda(params.destinatario_dni || '');
    const destinoLinea1 = sanitizarCaraClienteSinLamda(params.destino_linea_1 || params.direccion_postal || params.direccion_barrial || '');
    const locFallback = [
        params.localidad_nombre,
        params.provincia_nombre,
        params.cp_destino ? `CP ${params.cp_destino}` : ''
    ].filter(Boolean).join(', ');
    const localidadProvinciaCp = sanitizarCaraClienteSinLamda(params.localidad_provincia_cp || locFallback || '');
    const opFallback = [params.operador_postal, params.modalidad_postal].filter(Boolean).join(' - ');
    const operadorModalidad = sanitizarCaraClienteSinLamda(params.operador_modalidad || opFallback || 'CORREO ARGENTINO - DOMICILIO').toUpperCase();
    const qrSeguimientoUrl = String(params.qr_seguimiento_url || '').trim() ||
        `https://tienda.lamdaser.com/tienda/${encodeURIComponent(params.slug || 'tienda')}?seguimiento=${encodeURIComponent(params.tracking_token || pedidoCodigo)}`;
    const pesoGramos = Math.max(100, Math.round(Number(params.peso_gramos || 500)));
    const fechaHoraArmado = limpiarTextoZpl(params.fecha_hora_armado || params.fecha_empaque_texto || new Date().toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }));

    const paginas = paginarItemsEtiqueta(params.items);
    const totalHojas = paginas.length;
    const totalItemsPedido = Array.isArray(params.items) ? params.items.length : paginas.reduce((a, p) => a + p.length, 0);
    const fontTituloZpl = nombreMarca.length > 22 ? '19,18' : '22,21';
    const siglasFallback = nombreMarca.split(/\s+/).map(w => w[0] || '').join('').substring(0, 3) || 'MBO';

    const bloquesCaraCliente = [];
    const bloquesTalonInterno = [];
    const bloquesZpl = paginas.map((itemsPagina, pageIndex) => {
        const numHoja = pageIndex + 1;
        const esContinuacion = numHoja > 1;
        const xRightBadge = Math.min(315, 25 + Math.min(logoCabecera.width, 280) + 10);

        const bloqueCabeceraIzqZpl = logoGfa && logoCabecera.esBannerCompleto
            ? [
                `^FO25,8${logoGfa}^FS`,
                ...(esContinuacion ? [
                    `^FO${xRightBadge},18^A0N,17,17^FDBULTO ${numHoja}/${totalHojas}^FS`
                ] : [])
            ]
            : [
                logoGfa ? `^FO25,12${logoGfa}^FS` : `^FO25,12^GB96,52,3^FS^FO42,27^A0N,24,24^FD${siglasFallback}^FS`,
                `^FO132,14^A0N,${fontTituloZpl}^FD${nombreMarca.substring(0, 28)}^FS`,
                `^FO132,40^A0N,15,14^FD${esContinuacion ? `CAJA ${numHoja} DE ${totalHojas}` : subtituloMarca.substring(0, 42)}^FS`
            ];

        const dniSuffix = destinatarioDni ? ` (DNI ${destinatarioDni})` : '';
        const caraClienteLines = [
            ...bloqueCabeceraIzqZpl,
            '^FO23,72^GB372,2,2^FS',
            `^FO23,79^A0N,19,18^FDRECIBE: ${(destinatarioNombre + dniSuffix).substring(0, 36)}^FS`,
            `^FO23,102^A0N,16,16^FD${destinoLinea1.substring(0, 40)}^FS`,
            `^FO23,122^A0N,17,17^FD${localidadProvinciaCp.substring(0, 38)}^FS`,
            '^FO23,145^GB372,2,2^FS',
            `^FO25,153^BQN,2,3^FDQA,${qrSeguimientoUrl}^FS`,
            '^FO132,155^GB262,106,106^FS',
            `^FO142,164^FR^A0N,18,17^FD${operadorModalidad.substring(0, 27)}^FS`,
            `^FO142,190^FR^A0N,20,20^FDORDEN #${pedidoCodigo}^FS`,
            `^FO142,217^FR^A0N,15,15^FDSEGUI TU ENVIO CON EL QR^FS`,
            `^FO142,238^FR^A0N,14,14^FDETIQUETA ${numHoja} DE ${totalHojas}^FS`
        ];

        const lineasChecklistZpl = itemsPagina.map((it, idx) => {
            const globalIdx = pageIndex * ITEMS_POR_ETIQUETA_DERECHA + idx + 1;
            const yPos = 72 + idx * 31;
            const lineaSegura = formatearLineaChecklistSegura(it, globalIdx, 38);
            return [
                `^FO446,${yPos}^GB17,17,2^FS`,
                `^FO469,${yPos + 1}^A0N,17,16^FD${lineaSegura}^FS`
            ].join('\n');
        }).join('\n');

        const talonInternoLines = [
            `^FO443,14^A0N,19,18^FDTALON INTERNO DEPOSITO LAMDA^FS`,
            `^FO443,36^A0N,16,15^FD#${pedidoCodigo} | ${pesoGramos}g | ${fechaHoraArmado}^FS`,
            `^FO443,54^A0N,14,14^FDSKUS OFICIALES (${totalItemsPedido} ITEMS - H${numHoja}/${totalHojas})^FS`,
            '^FO443,68^GB368,2,2^FS',
            lineasChecklistZpl
        ];

        bloquesCaraCliente.push(caraClienteLines.join('\n'));
        bloquesTalonInterno.push(talonInternoLines.join('\n'));

        return [
            '^XA',
            '^CI28',
            '^PW830',
            '^LL280',
            ...caraClienteLines,
            ...talonInternoLines,
            '^XZ'
        ].join('\n');
    });

    return {
        zpl: bloquesZpl.join('\n\n'),
        zpl_cara_cliente: bloquesCaraCliente.join('\n\n'),
        zpl_talon_interno: bloquesTalonInterno.join('\n\n'),
        qr_seguimiento_url: qrSeguimientoUrl,
        totalHojas,
        totalItemsPedido,
        paginas
    };
}

async function generarPreviewVisualEtiquetaFulfillment(params = {}) {
    const resultadoZpl = generarEtiquetaZplParFulfillment(params);
    const { paginas, totalHojas, totalItemsPedido, qr_seguimiento_url } = resultadoZpl;

    const labelW = 405;
    const labelH = 270;
    const gapX = 20;
    const gapY = 20;
    const padOuter = 16;

    const canvasW = padOuter * 2 + labelW * 2 + gapX;
    const canvasH = padOuter * 2 + totalHojas * labelH + (totalHojas - 1) * gapY;
    const canvas = createCanvas(canvasW, canvasH);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, canvasW, canvasH);

    let logoImg = null;
    if (params.logo_mono_preview_base64) {
        try {
            const cleanUrl = params.logo_mono_preview_base64.startsWith('data:image')
                ? params.logo_mono_preview_base64
                : `data:image/png;base64,${params.logo_mono_preview_base64}`;
            logoImg = await loadImage(cleanUrl);
        } catch (_) {
            logoImg = null;
        }
    }

    const nombreMarca = sanitizarCaraClienteSinLamda(params.nombre_marca || 'TIENDA OFICIAL').toUpperCase() || 'TIENDA OFICIAL';
    const subtituloMarca = sanitizarCaraClienteSinLamda(params.bajada_marca || params.subtitulo_marca || 'Tienda Online Oficial');
    const logoCabecera = resolverModoCabeceraLogo({
        logoGfa: params.logo_zpl_gfa,
        logoImg,
        logoZplConfig: params.logo_zpl_config
    });
    const pedidoCodigo = sanitizarCaraClienteSinLamda(params.pedido_codigo || 'NB-1001');
    const destinatarioNombre = sanitizarCaraClienteSinLamda(params.destinatario_nombre || params.vecino_nombre || 'CLIENTE').toUpperCase();
    const destinatarioDni = sanitizarCaraClienteSinLamda(params.destinatario_dni || '');
    const destinoLinea1 = sanitizarCaraClienteSinLamda(params.destino_linea_1 || params.direccion_postal || params.direccion_barrial || '');
    const locFallbackPv = [
        params.localidad_nombre,
        params.provincia_nombre,
        params.cp_destino ? `CP ${params.cp_destino}` : ''
    ].filter(Boolean).join(', ');
    const localidadProvinciaCp = sanitizarCaraClienteSinLamda(params.localidad_provincia_cp || locFallbackPv || '');
    const opFallbackPv = [params.operador_postal, params.modalidad_postal].filter(Boolean).join(' - ');
    const operadorModalidad = sanitizarCaraClienteSinLamda(params.operador_modalidad || opFallbackPv || 'CORREO ARGENTINO - DOMICILIO').toUpperCase();
    const pesoGramos = Math.max(100, Math.round(Number(params.peso_gramos || 500)));
    const fechaHoraArmado = limpiarTextoZpl(params.fecha_hora_armado || params.fecha_empaque_texto || new Date().toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }));

    for (let pageIndex = 0; pageIndex < totalHojas; pageIndex++) {
        const itemsPagina = paginas[pageIndex];
        const numHoja = pageIndex + 1;
        const rowY = padOuter + pageIndex * (labelH + gapY);
        const leftX = padOuter;
        const rightX = padOuter + labelW + gapX;

        for (const lx of [leftX, rightX]) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(lx, rowY, labelW, labelH);
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(lx, rowY, labelW, labelH);
        }

        // ETIQUETA IZQUIERDA (100% MARCA BLANCA CREADOR)
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        if (logoImg && logoCabecera.esBannerCompleto) {
            const scalePv = Math.min(1, (labelW - 22) / logoImg.width, 60 / logoImg.height);
            const drawW = Math.round(logoImg.width * scalePv);
            const drawH = Math.round(logoImg.height * scalePv);
            ctx.drawImage(logoImg, leftX + 10, rowY + 6 + Math.round((60 - drawH) / 2), drawW, drawH);
        } else {
            if (logoImg) {
                ctx.drawImage(logoImg, leftX + 10, rowY + 8, 104, 52);
            }
            const textX = logoImg ? (leftX + 122) : (leftX + 12);
            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 16px Arial';
            ctx.fillText(nombreMarca.substring(0, 26), textX, rowY + 12);
            ctx.font = 'bold 10.5px Arial';
            ctx.fillStyle = '#334155';
            ctx.fillText(subtituloMarca.substring(0, 40), textX, rowY + 36);
        }

        ctx.fillStyle = '#000000';
        ctx.fillRect(leftX + 10, rowY + 68, labelW - 20, 2);
        ctx.font = 'bold 12px Arial';
        const dniTxt = destinatarioDni ? ` (DNI ${destinatarioDni})` : '';
        ctx.fillText(`RECIBE: ${(destinatarioNombre + dniTxt).substring(0, 36)}`, leftX + 10, rowY + 76);
        ctx.font = '11px Arial';
        ctx.fillText(destinoLinea1.substring(0, 42), leftX + 10, rowY + 96);
        ctx.font = 'bold 11.5px Arial';
        ctx.fillText(localidadProvinciaCp.substring(0, 40), leftX + 10, rowY + 116);
        ctx.fillRect(leftX + 10, rowY + 138, labelW - 20, 2);

        // QR Seguimiento Marca Blanca
        const qrX = leftX + 12;
        const qrY = rowY + 148;
        const qrSize = 86;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(qrX, qrY, qrSize, qrSize);
        ctx.fillStyle = '#000000';
        ctx.fillRect(qrX + 6, qrY + 6, 20, 20);
        ctx.fillRect(qrX + qrSize - 26, qrY + 6, 20, 20);
        ctx.fillRect(qrX + 6, qrY + qrSize - 26, 20, 20);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(qrX + 10, qrY + 10, 12, 12);
        ctx.fillRect(qrX + qrSize - 22, qrY + 10, 12, 12);
        ctx.fillRect(qrX + 10, qrY + qrSize - 22, 12, 12);
        ctx.fillStyle = '#000000';
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                if ((r * 3 + c + pageIndex) % 2 === 0) {
                    ctx.fillRect(qrX + 30 + c * 7, qrY + 30 + r * 7, 5, 5);
                }
            }
        }
        ctx.font = 'bold 9px monospace';
        ctx.fillText(`#${pedidoCodigo}`, qrX + 14, qrY + qrSize + 5);

        const bandX = leftX + 108;
        const bandY = rowY + 148;
        const bandW = labelW - 118;
        const bandH = 102;
        ctx.fillStyle = '#000000';
        ctx.fillRect(bandX, bandY, bandW, bandH);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11.5px Arial';
        ctx.fillText(operadorModalidad.substring(0, 28), bandX + 10, bandY + 13);
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`ORDEN #${pedidoCodigo}`, bandX + 10, bandY + 38);
        ctx.font = 'bold 10.5px Arial';
        ctx.fillText('SEGUI TU ENVIO CON EL QR', bandX + 10, bandY + 64);
        ctx.font = '10px monospace';
        ctx.fillText(`CAJA ${numHoja} DE ${totalHojas}`, bandX + 10, bandY + 84);

        // TALON DERECHO (CONTROL INTERNO DEPOSITO LAMDA)
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 13px Arial';
        ctx.fillText('TALON INTERNO DEPOSITO LAMDA', rightX + 12, rowY + 12);
        ctx.font = 'bold 10.5px monospace';
        ctx.fillText(`#${pedidoCodigo} | PESO: ${pesoGramos}g | ${fechaHoraArmado}`, rightX + 12, rowY + 32);
        ctx.font = 'bold 10px Arial';
        ctx.fillText(`SKUS OFICIALES (${totalItemsPedido} ITEMS - H${numHoja}/${totalHojas})`, rightX + 12, rowY + 49);
        ctx.fillRect(rightX + 10, rowY + 64, labelW - 20, 2);

        itemsPagina.forEach((it, idx) => {
            const globalIdx = pageIndex * ITEMS_POR_ETIQUETA_DERECHA + idx + 1;
            const itemY = rowY + 72 + idx * 30;
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.8;
            ctx.strokeRect(rightX + 12, itemY, 14, 14);
            const lineaSegura = formatearLineaChecklistSegura(it, globalIdx, 38);
            ctx.fillStyle = '#000000';
            ctx.font = 'bold 10.8px Arial';
            ctx.fillText(lineaSegura, rightX + 32, itemY + 1);
        });
    }

    return {
        pedido_codigo: pedidoCodigo,
        nombre_marca: nombreMarca,
        qr_seguimiento_url,
        zpl: resultadoZpl.zpl,
        zpl_cara_cliente: resultadoZpl.zpl_cara_cliente,
        zpl_talon_interno: resultadoZpl.zpl_talon_interno,
        total_hojas: totalHojas,
        total_items: totalItemsPedido,
        preview_rollo_base64: canvas.toDataURL('image/png')
    };
}

module.exports = {
    convertirLogoAZplGfa,
    generarEtiquetaZplParNodo,
    generarPreviewVisualEtiquetaPar,
    generarPreviewVisualCanastoQrMaestro,
    generarEtiquetaZplParFulfillment,
    generarPreviewVisualEtiquetaFulfillment,
    formatearLineaChecklistSegura,
    formatearLineaManifiestoCanastoSegura,
    limpiarTextoZpl,
    ITEMS_POR_ETIQUETA_DERECHA
};
