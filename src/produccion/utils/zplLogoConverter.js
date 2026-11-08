/**
 * ============================================================================
 * CONVERSOR DE LOGOS A ZPL (^GFA) Y PREVISUALIZADOR TÉRMICO ZEBRA MARCA BLANCA
 * Unidad de Negocio: Nodos Barriales (Marca Blanca) - Etapa 1
 * ============================================================================
 * - Convierte imágenes PNG/JPG (base64) o genera monogramas vectoriales de marca
 *   a mapas de bits monocromáticos de 1 bit compatibles con cabezales Zebra
 *   mediante el comando nativo ^GFA (Graphic Field ASCII Hex).
 * - Soporta binarización por Umbral Directo (Threshold) o Difusión de Error
 *   Floyd-Steinberg (Dithering).
 * - Genera el código ZPL en rollo de doble columna (offsetX=23 Izquierda /
 *   offsetX=443 Derecha) con paginación automática de etiquetas de continuación
 *   cuando el checklist supera la capacidad vertical de una etiqueta.
 * - Renderiza una previsualización PNG de alta fidelidad del rollo térmico
 *   para validación en Modo Laboratorio sin gastar insumos físicos.
 */

const { createCanvas, loadImage } = require('canvas');

const DEFAULT_LOGO_WIDTH = 112; // Múltiplo exacto de 8 (14 bytes por fila)
const DEFAULT_LOGO_HEIGHT = 56; // 56 filas -> 14 * 56 = 784 bytes totales
const ITEMS_POR_ETIQUETA_DERECHA = 6; // Máximo de renglones en etiqueta derecha antes de emitir etiqueta de continuación

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

    // Círculo / Sello izquierdo con siglas invertidas
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
 *
 * @param {Object} opts
 * @param {string} [opts.imageBase64] - Data URL o base64 de imagen PNG/JPG
 * @param {string} [opts.nombreMarca] - Nombre de la marca del Nodo (para monograma)
 * @param {string} [opts.iniciales] - Iniciales opcionales para monograma
 * @param {number} [opts.width=112] - Ancho en dots (se ajusta a múltiplo de 8)
 * @param {number} [opts.height=56] - Alto en dots
 * @param {number} [opts.threshold=138] - Umbral de luminancia (0..255)
 * @param {string} [opts.mode='threshold'] - 'threshold' | 'dither' (Floyd-Steinberg)
 * @param {boolean} [opts.invert=false] - Invertir blanco/negro
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

    // Fondo blanco limpio
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    if (opts.imageBase64 && typeof opts.imageBase64 === 'string' && opts.imageBase64.trim().length > 20) {
        const cleanDataUrl = opts.imageBase64.startsWith('data:image')
            ? opts.imageBase64
            : `data:image/png;base64,${opts.imageBase64}`;
        const img = await loadImage(cleanDataUrl);

        // Escalar manteniendo proporción (contain) centrado
        const scale = Math.min((width - 4) / img.width, (height - 4) / img.height);
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

    // Matriz de luminancia (0 = negro, 255 = blanco)
    const lum = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const alpha = rgba[idx + 3] / 255;
        // Mezclar sobre blanco si tiene transparencia
        const r = rgba[idx] * alpha + 255 * (1 - alpha);
        const g = rgba[idx + 1] * alpha + 255 * (1 - alpha);
        const b = rgba[idx + 2] * alpha + 255 * (1 - alpha);
        let l = 0.299 * r + 0.587 * g + 0.114 * b;
        if (invert) l = 255 - l;
        lum[i] = l;
    }

    // Difusión de error Floyd-Steinberg opcional
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

    // Construir bytes hexadecimales para ^GFA y actualizar imagen de preview 1-bit
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
                // Pintar en imgData para el preview monocromático exacto
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
 * ITEMS_POR_ETIQUETA_DERECHA (6 ítems por etiqueta derecha) para garantizar que
 * ningún ítem quede truncado si el pedido es largo (emitiendo etiquetas de continuación).
 */
function paginarItemsEtiqueta(items = []) {
    const lista = Array.isArray(items) && items.length > 0
        ? items
        : [
            { cantidad: 2, descripcion: 'Almendra Nonpareil x 250g' },
            { cantidad: 1, descripcion: 'Granola de Sol x 500g' },
            { cantidad: 1, descripcion: 'Mix Frutos Secos c/Pasas x 500g' },
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
 * - Derecha (X=443): Checklist de armado de artículos del pedido.
 * - Si hay más de 6 ítems, emite bloques ^XA...^XZ adicionales de continuación (HOJA 2/N, etc.).
 */
function generarEtiquetaZplParNodo(params = {}) {
    const nombreMarca = limpiarTextoZpl(params.nombre_marca || 'ALMACEN VERDE CITY BELL').toUpperCase();
    const subtituloMarca = limpiarTextoZpl(params.subtitulo_marca || 'Pedido Vecinal - Entrega Fresca');
    const logoGfa = (params.logo_zpl_gfa && params.logo_zpl_gfa.startsWith('^GFA'))
        ? params.logo_zpl_gfa
        : '';

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

    const bloquesZpl = paginas.map((itemsPagina, pageIndex) => {
        const numHoja = pageIndex + 1;
        const esContinuacion = numHoja > 1;
        const textoBanderaPago = estadoPago.includes('EFECTIVO') && montoCobrar > 0
            ? `COBRAR EFECTIVO: $${montoCobrar.toLocaleString('es-AR')}`
            : estadoPago;

        const lineasChecklistZpl = itemsPagina.map((it, idx) => {
            const globalIdx = pageIndex * ITEMS_POR_ETIQUETA_DERECHA + idx + 1;
            const yPos = 66 + idx * 32;
            const cant = it.cantidad || 1;
            const desc = limpiarTextoZpl(it.descripcion || it.nombre_publico || 'Articulo').substring(0, 32);
            return [
                `^FO448,${yPos}^GB20,20,2^FS`,
                `^FO476,${yPos + 2}^A0N,20,20^FD${globalIdx}. ${cant}x ${desc}^FS`
            ].join('\n');
        }).join('\n');

        return [
            '^XA',
            '^CI28',
            '^PW830',
            '^LL280',
            // ================= COLUMNA IZQUIERDA (X=23): PORTADA MARCA BLANCA =================
            logoGfa ? `^FO25,14${logoGfa}^FS` : '^FO25,14^GB108,54,3^FS^FO42,30^A0N,24,24^FDNODO^FS',
            `^FO145,16^A0N,24,24^FD${nombreMarca.substring(0, 22)}^FS`,
            `^FO145,44^A0N,17,17^FD${esContinuacion ? `CONTINUACION CHECKLIST (HOJA ${numHoja}/${totalHojas})` : subtituloMarca.substring(0, 28)}^FS`,
            '^FO23,76^GB372,2,2^FS',
            `^FO23,84^A0N,22,22^FDVECINO: ${vecinoNombre.substring(0, 22)}^FS`,
            `^FO23,110^A0N,18,18^FD${modalidadEntrega.substring(0, 34)}^FS`,
            `^FO23,132^A0N,17,17^FD${direccionBarrial.substring(0, 36)} | Tel: ${vecinoTelefono}^FS`,
            '^FO23,156^GB372,2,2^FS',
            // QR de Despacho en Estación Nodos (abajo a la izquierda)
            `^FO25,166^BQN,2,3^FDMA,${pedidoCodigo}-H${numHoja}^FS`,
            // Banda invertida (^FR) de Estado de Pago + Bulto/Hoja
            '^FO118,166^GB276,94,94^FS',
            `^FO128,176^FR^A0N,21,21^FD${textoBanderaPago.substring(0, 24)}^FS`,
            `^FO128,204^FR^A0N,19,19^FDPEDIDO #${pedidoCodigo} | ${bultosTexto}^FS`,
            `^FO128,230^FR^A0N,18,18^FDHOJA ETIQUETA ${numHoja} DE ${totalHojas}^FS`,

            // ================= COLUMNA DERECHA (X=443): CHECKLIST DE ARMADO =================
            `^FO443,16^A0N,22,22^FDCHECKLIST #${pedidoCodigo} (${totalItemsPedido} ITEMS)^FS`,
            `^FO443,40^A0N,17,17^FDVECINO: ${vecinoNombre.substring(0, 20)} [HOJA ${numHoja}/${totalHojas}]^FS`,
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

    const labelW = 395;
    const labelH = 270;
    const gapX = 22;
    const gapY = 20;
    const padOuter = 18;

    const canvasW = padOuter * 2 + labelW * 2 + gapX;
    const canvasH = padOuter * 2 + totalHojas * labelH + (totalHojas - 1) * gapY;

    const canvas = createCanvas(canvasW, canvasH);
    const ctx = canvas.getContext('2d');

    // Fondo de soporte siliconado del rollo térmico (gris azulado suave)
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Cargar logo monocromático si fue provisto
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
    const subtituloMarca = limpiarTextoZpl(params.subtitulo_marca || 'Pedido Vecinal - Entrega Fresca');
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

        // Etiqueta blanca izquierda y derecha
        for (const lx of [leftX, rightX]) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(lx, rowY, labelW, labelH);
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(lx, rowY, labelW, labelH);
        }

        // ================= DIBUJAR ETIQUETA IZQUIERDA =================
        if (logoImg) {
            ctx.drawImage(logoImg, leftX + 10, rowY + 10, 112, 56);
        } else {
            dibujarMonogramaEnCanvas(ctx, 112, 56, nombreMarca);
        }

        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = 'bold 15px Arial';
        ctx.fillText(nombreMarca.substring(0, 22), leftX + 130, rowY + 15);

        ctx.font = 'bold 11px Arial';
        ctx.fillStyle = esContinuacion ? '#b45309' : '#334155';
        ctx.fillText(
            esContinuacion ? `CONTINUACION CHECKLIST (HOJA ${numHoja}/${totalHojas})` : subtituloMarca.substring(0, 30),
            leftX + 130,
            rowY + 38
        );

        // Línea divisoria
        ctx.fillStyle = '#000000';
        ctx.fillRect(leftX + 10, rowY + 72, labelW - 20, 2);

        // Datos del vecino
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`VECINO: ${vecinoNombre.substring(0, 24)}`, leftX + 10, rowY + 80);

        ctx.font = 'bold 12px Arial';
        ctx.fillText(modalidadEntrega.substring(0, 36), leftX + 10, rowY + 102);

        ctx.font = '11px Arial';
        ctx.fillText(`${direccionBarrial.substring(0, 34)} | Tel: ${vecinoTelefono}`, leftX + 10, rowY + 122);

        ctx.fillRect(leftX + 10, rowY + 144, labelW - 20, 2);

        // Simulación QR a la izquierda
        const qrX = leftX + 12;
        const qrY = rowY + 154;
        const qrSize = 82;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(qrX, qrY, qrSize, qrSize);
        // Celdas tipo QR
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
        ctx.font = 'bold 13px Arial';
        ctx.fillText(textoBanderaPago.substring(0, 26), bandX + 10, bandY + 14);
        ctx.font = 'bold 12px Arial';
        ctx.fillText(`PEDIDO #${pedidoCodigo} | ${bultosTexto}`, bandX + 10, bandY + 42);
        ctx.font = '11px monospace';
        ctx.fillText(`HOJA ETIQUETA ${numHoja} DE ${totalHojas}`, bandX + 10, bandY + 68);

        // ================= DIBUJAR ETIQUETA DERECHA (CHECKLIST) =================
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`CHECKLIST #${pedidoCodigo} (${totalItemsPedido} ITEMS)`, rightX + 12, rowY + 14);

        ctx.font = 'bold 11px Arial';
        ctx.fillText(`VECINO: ${vecinoNombre.substring(0, 22)} [HOJA ${numHoja}/${totalHojas}]`, rightX + 12, rowY + 36);

        ctx.fillRect(rightX + 10, rowY + 54, labelW - 20, 2);

        itemsPagina.forEach((it, idx) => {
            const globalIdx = pageIndex * ITEMS_POR_ETIQUETA_DERECHA + idx + 1;
            const itemY = rowY + 64 + idx * 31;
            // Checkbox térmico
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeRect(rightX + 12, itemY, 16, 16);

            const cant = it.cantidad || 1;
            const desc = limpiarTextoZpl(it.descripcion || it.nombre_publico || 'Articulo').substring(0, 34);
            ctx.fillStyle = '#000000';
            ctx.font = 'bold 12px Arial';
            ctx.fillText(`${globalIdx}. ${cant}x ${desc}`, rightX + 36, itemY + 2);
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

module.exports = {
    convertirLogoAZplGfa,
    generarEtiquetaZplParNodo,
    generarPreviewVisualEtiquetaPar,
    limpiarTextoZpl,
    ITEMS_POR_ETIQUETA_DERECHA
};
