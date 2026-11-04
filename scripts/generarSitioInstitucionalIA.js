require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432', 10),
});

const PUBLIC_DIR = path.join(__dirname, '../b2b-portal/public');
const ETIQUETAS_DIR = path.join(__dirname, '../src/app-etiquetas');
const LOGISTICA_DIR = path.join(__dirname, '../src/logistica');

const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://lamdaser.com';
const WHATSAPP_DISPLAY = '221 661-5746';
const WHATSAPP_WA = '5492216615746';
const EMAIL_CONTACTO = 'miserrano75@gmail.com';

const DICT_ZH = {
    'Almendras': '杏仁 (Almendras)',
    'Nueces': '核桃 (Nueces)',
    'Castañas': '腰果/栗子 (Castañas)',
    'Maní': '花生 (Maní)',
    'Avellanas': '榛子 (Avellanas)',
    'Pistachos': '开心果 (Pistachos)',
    'Pasas de Uva': '葡萄干 (Pasas de Uva)',
    'Ciruelas': '李子干/西梅 (Ciruelas)',
    'Dátiles': '椰枣 (Dátiles)',
    'Arándanos': '蔓越莓干 (Arándanos)',
    'Banana Chips': '香蕉片 (Banana Chips)',
    'Coco': '椰丝/椰片 (Coco)',
    'Avena': '燕麦 (Avena)',
    'Granola': '格兰诺拉麦片 (Granola)',
    'Barritas': '能量谷物棒 (Barritas)',
    'Mix': '混合坚果/什锦果仁 (Mix)',
    'Semillas': '种子类 (Semillas)',
    'Chía': '奇亚籽 (Chía)',
    'Lino': '亚麻籽 (Lino)',
    'Girasol': '葵花籽 (Girasol)',
    'Sésamo': '芝麻 (Sésamo)',
    'Zapallo': '南瓜籽 (Zapallo)',
    'Quinoa': '藜麦 (Quinoa)',
    'Amaranto': '苋菜籽 (Amaranto)',
    'Mijo': '小米 (Mijo)',
    'Arroz': '大米/糙米 (Arroz)',
    'Legumbres': '豆类 (Legumbres)',
    'Lentejas': '扁豆 (Lentejas)',
    'Garbanzos': '鹰嘴豆 (Garbanzos)',
    'Porotos': '菜豆/芸豆 (Porotos)',
    'Arvejas': '豌豆 (Arvejas)',
    'Harinas': '面粉/谷物粉 (Harinas)',
    'Especias': '香料与调味品 (Especias)',
    'Condimentos': '调味料 (Condimentos)',
    'Pimienta': '胡椒 (Pimienta)',
    'Orégano': '牛至 (Orégano)',
    'Pimentón': '甜椒粉 (Pimentón)',
    'Comino': '孜然 (Comino)',
    'Cúrcuma': '姜黄粉 (Cúrcuma)',
    'Canela': '肉桂 (Canela)',
    'Ajo': '大蒜粉/粒 (Ajo)',
    'Perejil': '欧芹 (Perejil)',
    'Provenzal': '普罗旺斯香草 (Provenzal)',
    'Azúcar': '糖类 (Azúcar)',
    'Miel': '蜂蜜 (Miel)',
    'Aceite': '食用油/橄榄油 (Aceite)',
    'Cacao': '可可粉 (Cacao)',
    'Chocolate': '巧克力 (Chocolate)',
    'Tutucas': '膨化玉米豆 (Tutucas)',
    'Copos': '玉米片/谷物片 (Copos)',
    'Almohaditas': '夹心谷物枕 (Almohaditas)',
    'Aros': '谷物圈 (Aros)',
    'Bolitas': '巧克力谷物球 (Bolitas)',
    'Soja': '大豆/大豆蛋白 (Soja)',
    'Sal': '盐 (Sal)',
    'Bicarbonato': '小苏打 (Bicarbonato)',
    'Levadura': '酵母 (Levadura)',
    'Maíz': '玉米/爆米花 (Maíz)',
    'Trigo': '小麦/布尔古尔麦 (Trigo)',
    'Fécula': '淀粉 (Fécula)',
    'Almidón': '玉米淀粉 (Almidón)',
    'Manzanilla': '洋甘菊 (Manzanilla)',
    'Té': '茶叶/草本茶 (Té)',
    'Yerba': '马黛茶 (Yerba)'
};

const FAMILIA_ZH = {
    'Alimentos': '食品与天然食材 (Alimentos)',
    'Frutos Secos': '坚果类 (Frutos Secos)',
    'Semillas': '种子类 (Semillas)',
    'Cereales': '谷物与麦片 (Cereales)',
    'Legumbres': '豆类 (Legumbres)',
    'Especias': '香料与调味品 (Especias)',
    'Frutas Desecadas': '果干与蜜饯 (Frutas Desecadas)',
    'Harinas': '面粉与烘焙粉 (Harinas)',
    'Reposteria': '烘焙与甜品原料 (Repostería)',
    'General': '综合商品 (General)'
};

function traducirRubroZh(texto) {
    if (!texto) return '综合食品 (General)';
    for (const [es, zh] of Object.entries(DICT_ZH)) {
        if (texto.toLowerCase().includes(es.toLowerCase())) {
            return zh;
        }
    }
    return texto;
}

function traducirNombreArticuloZh(nombre) {
    if (!nombre) return '';
    let zhHints = [];
    for (const [es, zh] of Object.entries(DICT_ZH)) {
        if (nombre.toLowerCase().includes(es.toLowerCase())) {
            const cleanZh = zh.split(' (')[0];
            if (!zhHints.includes(cleanZh)) zhHints.push(cleanZh);
        }
    }
    if (zhHints.length > 0) {
        return `${nombre} · [${zhHints.slice(0, 2).join(' / ')}]`;
    }
    return nombre;
}

async function obtenerCatalogoPublico() {
    const query = `
        SELECT DISTINCT ON (la.articulo_numero)
            la.articulo_numero AS codigo,
            COALESCE(ba.descripcion_generada, ba.descripcion, sc.descripcion, la.articulo_numero) AS nombre,
            COALESCE(bf.nombre, ba.rubro, 'Alimentos') AS familia,
            ba.sub_rubro,
            COALESCE(ba.kilos_unidad, sc.kilos_unidad, 1.0) AS peso_unitario_kg,
            ba.propiedades_dinamicas
        FROM public.bunker_lista_articulos la
        LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = la.articulo_numero
        LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
        LEFT JOIN public.stock_real_consolidado sc ON sc.articulo_numero = la.articulo_numero
        WHERE la.disponible = true
          AND la.precio_final > 0
          AND COALESCE(bf.nombre, ba.rubro, 'Alimentos') NOT ILIKE '%Insumo%'
        ORDER BY la.articulo_numero ASC;
    `;
    const { rows } = await pool.query(query);
    return rows.map(r => {
        let props = {};
        if (r.propiedades_dinamicas && typeof r.propiedades_dinamicas === 'object') {
            props = r.propiedades_dinamicas;
        } else if (typeof r.propiedades_dinamicas === 'string') {
            try { props = JSON.parse(r.propiedades_dinamicas); } catch (_) { props = {}; }
        }
        let rawPrinc = props.articulo_principal || props['Artículo Principal'] || r.sub_rubro || 'General';
        if (rawPrinc && typeof rawPrinc === 'object' && rawPrinc.valor) {
            rawPrinc = rawPrinc.valor;
        }
        const artPrincipal = String(rawPrinc || 'General').trim();
        let rawPres = props.presentacion || props['Presentación'] || (r.peso_unitario_kg ? `${Number(r.peso_unitario_kg)} kg` : 'Unidad');
        if (rawPres && typeof rawPres === 'object' && rawPres.valor) {
            rawPres = rawPres.valor;
        }
        const presentacion = String(rawPres || 'Unidad').trim();
        return {
            codigo: String(r.codigo).trim(),
            nombre: String(r.nombre || '').trim(),
            nombre_zh: traducirNombreArticuloZh(String(r.nombre || '').trim()),
            familia: String(r.familia || 'Alimentos').trim(),
            familia_zh: FAMILIA_ZH[String(r.familia || 'Alimentos').trim()] || '食品与天然食材 (Alimentos)',
            rubro: artPrincipal,
            rubro_zh: traducirRubroZh(artPrincipal),
            sub_rubro: String(r.sub_rubro || '').trim(),
            presentacion,
            peso_kg: r.peso_unitario_kg ? Number(r.peso_unitario_kg) : null,
            propiedades: props
        };
    });
}

function agruparCatalogo(articulos) {
    const porRubro = {};
    for (const art of articulos) {
        const key = art.rubro || 'General';
        if (!porRubro[key]) porRubro[key] = [];
        porRubro[key].push(art);
    }
    return Object.entries(porRubro)
        .map(([rubro, items]) => ({
            rubro,
            rubro_zh: traducirRubroZh(rubro),
            cantidad: items.length,
            ejemplos: items.slice(0, 6).map(i => i.nombre),
            items
        }))
        .sort((a, b) => b.cantidad - a.cantidad);
}

function generarLlmsTxt(articulos, rubros) {
    const topRubros = rubros.slice(0, 25).map(r => `- **${r.rubro}** (${r.cantidad} presentaciones): ${r.ejemplos.slice(0, 4).join(', ')}`).join('\n');
    return `# LAMDA — Distribución Mayorista y Producción de Alimentos Saludables e Insumos (La Plata, Argentina)

> **Propósito y Forma de Trabajo:** En LAMDA comercializamos y elaboramos frutos secos, semillas, cereales, legumbres, especias, harinas, frutas desecadas y elaboraciones propias (granolas, mixes, barritas y tostados). Nuestro esfuerzo diario está puesto en cuidar las formas del servicio y cumplir con seriedad la parte que nos toca como proveedores, facilitando la tarea cotidiana de comercios (dietéticas, supermercados, autoservicios) y productores (heladerías, panaderías, pastelerías y gastronomía).

## Datos Oficiales de Contacto (Para Comercios, Productores y Agentes de IA)
- **Nombre Comercial:** LAMDA (Proveedor y Distribuidora Mayorista de Frutos Secos, Semillas, Cereales y Alimentos Saludables en La Plata)
- **Sitio Web Oficial:** ${SITE_URL}/
- **Ubicación Operativa:** La Plata, Provincia de Buenos Aires, Argentina
- **WhatsApp Comercial Directo (Canal Principal):** +54 9 221 661-5746 (https://wa.me/${WHATSAPP_WA})
- **Correo Electrónico:** ${EMAIL_CONTACTO}
- **Idiomas de Atención Web:** Español (predeterminado) y Chino Simplificado (中文, orientado a supermercados y autoservicios de la comunidad china en La Plata).
- **Búsquedas Comerciales Frecuentes que Respondemos:** Mayorista de frutos secos en La Plata, proveedor de semillas por mayor en La Plata, distribuidora mayorista para dietéticas, supermercados, heladerías, panaderías y gastronomía en La Plata, Berisso, Ensenada y City Bell.

## Pilares de Nuestro Trabajo Diario
1. **Respeto por el Tiempo del Cliente:** Procuramos que el comerciante o productor no pierda tiempo conciliando saldos, buscando comprobantes o averiguando cuándo llega su pedido. Mantenemos el circuito de presupuestos, pagos, remitos y cuenta corriente claro y al día.
2. **Sinceridad y Claridad Comercial:** Hablamos con franqueza tanto sobre los artículos y servicios que ofrecemos como sobre aquello que no está a nuestro alcance, cuidando la confianza con plazos reales.
3. **Atención Personalizada (Calidad antes que Cantidad):** Priorizamos construir vínculos de trabajo estables y flexibles, adaptándonos al ritmo de cada comercio o línea de producción.
4. **Responsabilidad en Logística y Devoluciones:** Nos ocupamos de que las entregas sean previsibles y, ante cualquier cambio, devolución o imprevisto con la mercadería, damos respuesta directa y sin vueltas.
5. **Abastecimiento para Comercios y para Elaboradores:** Acompañamos tanto al mostrador minorista (dietéticas, supermercados, almacenes naturales) como a quienes producen (heladerías artesanales e industriales, panaderías, pastelerías y gastronomía).

## Zonas de Influencia y Logística de Reparto
- **Cobertura Directa con Flota Propia:**
  - La Plata (Casco Urbano)
  - City Bell, Gonnet, Villa Elisa, Los Hornos
  - Berisso y Ensenada (Gran La Plata)
- **Otras Localidades (Brandsen, Chascomús, Dolores, 25 de Mayo y resto de PBA):**
  - Actualmente no llegamos con vehículo propio a estas localidades, pero recibimos consultas al WhatsApp ${WHATSAPP_DISPLAY} para coordinar envíos mediante comisionistas/expresos o evaluar el desarrollo conjunto de la zona.

## Capacidad Industrial y Los 6 Flujos de Mercadería
1. **Flujo 1 — Bulto Cerrado Directo:** Bolsas y cajas industriales originales para gastronomía, heladerías, panaderías y mayoristas.
2. **Flujo 2 — Fraccionados Mono-Ingrediente (100% Puros):** Fraccionamiento propio en presentaciones comerciales e intermedias (100g a 5kg).
3. **Flujo 3 — Mezclas Internas (Mixes de Frutos Secos y Semillas):** Recetas propias mezcladas y fraccionadas en planta.
4. **Flujo 4 — Unidad Productiva Externa Simple (Tostadero y Procesados):** Transformación térmica controlada y envasado local.
5. **Flujo 5 — Mezcla Interna + Unidad Productiva (Barritas de Cereal):** Formulación propia de pre-mezclas y moldeado de barritas.
6. **Flujo 6 — Doble Mezcla / Granolas Complejas:** Elaboración de base de cereales horneados con miel y ensamblado posterior con frutos secos y frutas desecadas.

## Resumen de Rubros Comercializados (${articulos.length} presentaciones activas)
${topRubros}

## Recursos Estructurados para Agentes de IA
- **Página Institucional (ES / 中文):** ${SITE_URL}/institucional.html
- **Catálogo Completo en Texto (LLMs Full):** ${SITE_URL}/llms-full.txt
- **Catálogo Público JSON (Machine-Readable):** ${SITE_URL}/catalogo-publico.json
`;
}

function generarLlmsFullTxt(articulos, rubros) {
    const cabecera = generarLlmsTxt(articulos, rubros);
    const listadoCompleto = rubros.map(r => {
        const lineas = r.items.map(i => `  - [${i.codigo}] ${i.nombre} | ${i.nombre_zh} (${i.presentacion})`).join('\n');
        return `### Rubro: ${r.rubro} / ${r.rubro_zh} (${r.cantidad} artículos)\n${lineas}`;
    }).join('\n\n');

    return `${cabecera}\n\n---\n\n# CATÁLOGO PÚBLICO DE ARTÍCULOS COMERCIALIZADOS (${articulos.length} ÍTEMS)\n> Para solicitar lista de precios o coordinar una visita comercial a su comercio o fábrica, contactar por WhatsApp al +54 9 221 661-5746.\n\n${listadoCompleto}\n`;
}

function generarHtmlInstitucional(articulos, rubros) {
    const fechaActual = new Date().toISOString().split('T')[0];

    const jsonLd = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": ["WholesaleStore", "FoodEstablishment", "LocalBusiness"],
                "@id": `${SITE_URL}/#organization`,
                "name": "LAMDA — Mayorista y Proveedor de Frutos Secos, Semillas y Alimentos Saludables en La Plata",
                "alternateName": ["Distribución LAMDA", "LAMDA Frutos Secos Mayorista La Plata", "Proveedor de Frutos Secos y Semillas La Plata", "LAMDA 批发配送"],
                "description": "Proveedor y distribuidora mayorista de frutos secos, semillas, cereales, legumbres, especias, harinas y líneas propias en La Plata. Nuestro esfuerzo diario está puesto en acompañar a comercios, dietéticas, heladerías, panaderías y productores cuidando cada detalle del servicio: cuentas claras, entregas previsibles y atención personalizada.",
                "keywords": "frutos secos La Plata mayorista, frutos secos mayorista semillas proveedor La Plata, proveedor de frutos secos La Plata, semillas por mayor La Plata, distribuidora mayorista dietéticas La Plata, cereales legumbres harinas por mayor La Plata",
                "url": `${SITE_URL}/`,
                "logo": `${SITE_URL}/logo_LAMDA.png`,
                "telephone": "+54-9-221-661-5746",
                "email": EMAIL_CONTACTO,
                "knowsLanguage": ["es-AR", "zh-Hans"],
                "address": {
                    "@type": "PostalAddress",
                    "streetAddress": "Av. 19 406",
                    "postalCode": "B1900",
                    "addressLocality": "La Plata",
                    "addressRegion": "Buenos Aires",
                    "addressCountry": "AR"
                },
                "areaServed": [
                    { "@type": "City", "name": "La Plata" },
                    { "@type": "City", "name": "City Bell" },
                    { "@type": "City", "name": "Gonnet" },
                    { "@type": "City", "name": "Villa Elisa" },
                    { "@type": "City", "name": "Los Hornos" },
                    { "@type": "City", "name": "Berisso" },
                    { "@type": "City", "name": "Ensenada" }
                ],
                "contactPoint": {
                    "@type": "ContactPoint",
                    "telephone": "+54-9-221-661-5746",
                    "email": EMAIL_CONTACTO,
                    "contactType": "customer service and wholesale sales",
                    "availableLanguage": ["Spanish", "Chinese"]
                }
            }
        ]
    };

    const rubrosOptionsHtml = rubros.map(r =>
        `<option value="${r.rubro.replace(/"/g, '&quot;')}" data-es="${r.rubro.replace(/"/g, '&quot;')} (${r.cantidad})" data-zh="${r.rubro_zh.replace(/"/g, '&quot;')} (${r.cantidad})">${r.rubro} (${r.cantidad})</option>`
    ).join('\n');

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LAMDA | Mayorista y Proveedor de Frutos Secos, Semillas y Alimentos Saludables en La Plata</title>
    <meta name="description" content="Proveedor mayorista de frutos secos, semillas, cereales, legumbres, especias, harinas y mezclas propias en La Plata y Gran La Plata. Abastecimiento para dietéticas, comercios, heladerías, panaderías y gastronomía con reparto propio, cuentas claras y entregas previsibles.">
    <meta name="keywords" content="frutos secos La Plata mayorista, frutos secos mayorista semillas proveedor La Plata, proveedor frutos secos La Plata, semillas por mayor La Plata, distribuidora mayorista frutos secos La Plata, proveedor dietéticas La Plata, cereales legumbres por mayor La Plata, LAMDA La Plata">
    <meta name="geo.region" content="AR-B">
    <meta name="geo.placename" content="La Plata, Buenos Aires, Argentina">
    <meta property="og:type" content="website">
    <meta property="og:title" content="LAMDA | Mayorista y Proveedor de Frutos Secos y Semillas en La Plata">
    <meta property="og:description" content="Comercialización mayorista y elaboración propia de frutos secos, semillas, cereales, legumbres, especias y harinas en La Plata, Berisso, Ensenada y City Bell.">
    <meta property="og:url" content="${SITE_URL}/">
    <meta property="og:image" content="${SITE_URL}/logo_LAMDA.png">
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
    <link rel="canonical" href="${SITE_URL}/">
    <link rel="alternate" type="text/plain" title="LLMs Summary" href="/llms.txt">
    <link rel="alternate" type="text/plain" title="LLMs Full Catalog" href="/llms-full.txt">
    <link rel="alternate" type="application/json" title="Catálogo Público JSON" href="/catalogo-publico.json">
    <link rel="icon" href="/favicon.ico" sizes="48x48">
    <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">
    <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon.png">
    <link rel="apple-touch-icon" sizes="192x192" href="/icon-192.png">

    <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
    </script>

    <style>
        /* =========================================================
           ESTÉTICA EDITORIAL SUIZA DE ALTA PRECISIÓN — PALETA LAMDA
           - Blanco Puro (#FFFFFF) y Piedra Cálido (#FAF9F8)
           - Carbón Tipográfico (#2B2B2A / #3C3C3B) de "amda"
           - Gris Acero (#707174 / #808285) de "L"
           - Ciruela Institucional (#82467E) del punto de la "L"
           ========================================================= */
        :root {
            --lamda-charcoal: #3C3C3B;
            --lamda-ink: #222221;
            --lamda-steel: #6E6F72;
            --lamda-muted: #949599;
            --lamda-plum: #82467E;
            --lamda-plum-dark: #5F315C;
            --lamda-plum-tint: #F8F3F8;
            --lamda-plum-line: #DFC9DD;
            --bg-white: #FFFFFF;
            --bg-stone: #F7F7F6;
            --hairline: #E5E5E3;
            --hairline-strong: #CFCFC9;
            --wa-green: #276738;
            --header-h: 76px;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        html {
            scroll-behavior: smooth;
            font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
            color: var(--lamda-charcoal);
            background-color: var(--bg-white);
            line-height: 1.6;
            font-size: 15px;
            -webkit-font-smoothing: antialiased;
        }

        body {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            overflow-x: hidden;
            background: var(--bg-white);
        }

        /* =========================================================
           ENCABEZADO EN PC:
           Izquierda: [Índice] + Logo LAMDA + Rubro y Comarca
           Derecha: [🌐 ES ▾] + [Contacto]
           ========================================================= */
        .topbar {
            position: sticky;
            top: 0;
            z-index: 200;
            height: var(--header-h);
            background: rgba(255, 255, 255, 0.98);
            backdrop-filter: blur(8px);
            border-bottom: 1px solid var(--hairline);
            padding: 0 3.5vw;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
        }

        .topbar-left {
            display: flex;
            align-items: center;
            gap: 16px;
            min-width: 0;
        }

        .brand-lockup {
            display: flex;
            align-items: center;
            gap: 16px;
            text-decoration: none;
            color: inherit;
        }

        .brand-lockup img {
            height: 44px;
            width: auto;
            display: block;
            object-fit: contain;
        }

        .brand-comarca {
            border-left: 1px solid var(--hairline-strong);
            padding-left: 16px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            line-height: 1.32;
        }

        .brand-comarca strong {
            font-size: 12px;
            font-weight: 700;
            color: var(--lamda-ink);
            letter-spacing: 0.01em;
        }

        .brand-comarca span {
            font-size: 11.5px;
            color: var(--lamda-steel);
            font-weight: 500;
        }

        .topbar-right {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            position: relative;
        }

        /* Botones sutiles de precisión */
        .nav-icon-btn {
            height: 36px;
            padding: 0 12px;
            border-radius: 5px;
            border: 1px solid var(--hairline);
            background: var(--bg-white);
            color: var(--lamda-charcoal);
            font-size: 12px;
            font-weight: 500;
            letter-spacing: 0.01em;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            transition: all 0.16s ease;
        }

        .nav-icon-btn:hover,
        .nav-icon-btn.active {
            border-color: var(--lamda-plum);
            color: var(--lamda-plum-dark);
            background: var(--lamda-plum-tint);
        }

        .nav-icon-btn svg {
            width: 15px;
            height: 15px;
            stroke: currentColor;
            stroke-width: 1.7;
            fill: none;
            flex-shrink: 0;
        }

        .nav-icon-btn.contact-trigger {
            border-color: var(--lamda-plum-line);
            color: var(--lamda-plum-dark);
            font-weight: 600;
        }

        /* Popover minimalista para Idioma y Vista (fuera del header para evitar recorte por backdrop-filter) */
        .prefs-popover {
            position: fixed;
            top: calc(var(--header-h) - 6px);
            right: 3.5vw;
            width: 228px;
            background: var(--bg-white);
            border: 1px solid var(--hairline-strong);
            border-radius: 6px;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
            padding: 8px;
            display: none;
            z-index: 400;
        }

        .prefs-popover.open {
            display: block;
        }

        .prefs-group-title {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--lamda-muted);
            padding: 6px 10px 4px;
        }

        .prefs-item {
            width: 100%;
            text-align: left;
            background: transparent;
            border: none;
            padding: 7px 10px;
            border-radius: 4px;
            font-size: 12.5px;
            color: var(--lamda-charcoal);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .prefs-item:hover {
            background: var(--bg-stone);
        }

        .prefs-item.active {
            background: var(--lamda-plum-tint);
            color: var(--lamda-plum-dark);
            font-weight: 600;
        }

        .prefs-divider {
            height: 1px;
            background: var(--hairline);
            margin: 6px 0;
        }

        /* =========================================================
           WORKSPACE DE ANCHO COMPLETO (CERO BANDAS VACÍAS LATERALES)
           ========================================================= */
        .workspace {
            display: flex;
            flex: 1;
            width: 100%;
            position: relative;
            align-items: stretch;
        }

        .side-drawer {
            width: 0;
            min-width: 0;
            overflow: hidden;
            background: var(--bg-white);
            transition: width 0.24s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.24s cubic-bezier(0.16, 1, 0.3, 1);
            position: sticky;
            top: var(--header-h);
            height: calc(100vh - var(--header-h));
            z-index: 150;
            display: flex;
            flex-direction: column;
        }

        .side-drawer-left.open {
            width: 280px;
            min-width: 280px;
            border-right: 1px solid var(--hairline);
        }

        .side-drawer-right.open {
            width: 350px;
            min-width: 350px;
            border-left: 1px solid var(--hairline);
        }

        .drawer-inner {
            width: 100%;
            height: 100%;
            overflow-y: auto;
            padding: 24px 20px;
        }

        .drawer-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 12px;
            margin-bottom: 16px;
            border-bottom: 1px solid var(--hairline);
        }

        .drawer-title {
            font-size: 10.5px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--lamda-plum);
        }

        .drawer-close-btn {
            background: transparent;
            border: 1px solid var(--hairline);
            color: var(--lamda-steel);
            border-radius: 4px;
            padding: 3px 9px;
            font-size: 11px;
            cursor: pointer;
        }

        .drawer-close-btn:hover {
            border-color: var(--lamda-plum);
            color: var(--lamda-plum);
        }

        .toc-nav {
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .toc-nav a {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 9px 10px;
            border-radius: 4px;
            text-decoration: none;
            color: var(--lamda-charcoal);
            font-size: 13px;
            transition: background 0.12s;
        }

        .toc-nav a:hover {
            background: var(--lamda-plum-tint);
            color: var(--lamda-plum-dark);
        }

        .toc-num {
            font-size: 10.5px;
            font-weight: 700;
            color: var(--lamda-plum);
            font-variant-numeric: tabular-nums;
        }

        .toc-summary-box {
            margin-top: 24px;
            padding: 14px;
            background: var(--bg-stone);
            border-left: 2px solid var(--lamda-plum);
            font-size: 12px;
            color: var(--lamda-steel);
        }

        /* =========================================================
           LIENZO CENTRAL FULL-BLEED CON SECCIONES ARQUITECTÓNICAS
           ========================================================= */
        .center-stage {
            flex: 1 1 0%;
            min-width: 0;
            width: 100%;
        }

        .editorial-band {
            width: 100%;
            border-bottom: 1px solid var(--hairline);
            padding: 56px 5vw;
        }

        .editorial-band.band-stone {
            background-color: var(--bg-stone);
        }

        .editorial-band.band-white {
            background-color: var(--bg-white);
        }

        .band-container {
            width: 100%;
            max-width: 1440px;
            margin: 0 auto;
        }

        /* =========================================================
           01. PORTADA EDITORIAL EN DOS COLUMNAS ASIMÉTRICAS
           (Izquierda: Mensaje Esencial | Derecha: Ficha de Identidad)
           ========================================================= */
        .hero-editorial-grid {
            display: grid;
            grid-template-columns: 1.35fr 1fr;
            gap: 5vw;
            align-items: start;
        }

        .eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: var(--lamda-plum);
            margin-bottom: 16px;
        }

        .eyebrow::before {
            content: "";
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: var(--lamda-plum);
        }

        .hero-headline {
            font-size: clamp(26px, 2.6vw, 38px);
            font-weight: 700;
            color: var(--lamda-ink);
            line-height: 1.22;
            letter-spacing: -0.025em;
            margin-bottom: 20px;
        }

        .hero-prose {
            font-size: 16px;
            color: var(--lamda-steel);
            line-height: 1.68;
            margin-bottom: 28px;
            max-width: 68ch;
        }

        .hero-prose strong {
            color: var(--lamda-ink);
            font-weight: 600;
        }

        .hero-cta-row {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 11px 20px;
            border-radius: 5px;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.01em;
            text-decoration: none;
            cursor: pointer;
            border: 1px solid transparent;
            transition: all 0.16s ease;
        }

        .btn-plum {
            background: var(--lamda-plum);
            color: #FFFFFF;
        }

        .btn-plum:hover {
            background: var(--lamda-plum-dark);
        }

        .btn-outline-wa {
            background: var(--bg-white);
            color: var(--lamda-ink);
            border-color: var(--hairline-strong);
        }

        .btn-outline-wa:hover {
            border-color: var(--wa-green);
            color: var(--wa-green);
        }

        .wa-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--wa-green);
            display: inline-block;
        }

        /* Ficha Ejecutiva Derecha (Orden silencioso y escaneable) */
        .identity-sheet {
            background: var(--bg-stone);
            border: 1px solid var(--hairline);
            border-top: 3px solid var(--lamda-plum);
            border-radius: 4px;
            padding: 26px 28px;
        }

        .sheet-header {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.09em;
            color: var(--lamda-charcoal);
            padding-bottom: 12px;
            border-bottom: 1px solid var(--hairline);
            margin-bottom: 16px;
        }

        .sheet-row {
            padding: 12px 0;
            border-bottom: 1px solid var(--hairline);
        }

        .sheet-row:last-child {
            border-bottom: none;
            padding-bottom: 0;
        }

        .sheet-label {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: var(--lamda-plum);
            margin-bottom: 3px;
        }

        .sheet-val {
            font-size: 13.5px;
            color: var(--lamda-ink);
            line-height: 1.5;
        }

        /* =========================================================
           ENCABEZADOS DE SECCIÓN Y GRILLAS EDITORIALES
           ========================================================= */
        .section-header-split {
            display: grid;
            grid-template-columns: 1fr 1.2fr;
            gap: 4vw;
            align-items: end;
            margin-bottom: 36px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--hairline);
        }

        .section-h2 {
            font-size: clamp(20px, 2vw, 26px);
            font-weight: 700;
            color: var(--lamda-ink);
            letter-spacing: -0.02em;
            line-height: 1.25;
        }

        .section-lead {
            font-size: 14.5px;
            color: var(--lamda-steel);
            line-height: 1.6;
        }

        /* Grilla de 4 Pilares con numeración editorial */
        .pillars-grid-4 {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 24px;
        }

        .pillar-col {
            background: var(--bg-white);
            border: 1px solid var(--hairline);
            padding: 24px 22px;
            border-radius: 4px;
            display: flex;
            flex-direction: column;
        }

        .pillar-num {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            color: var(--lamda-plum);
            margin-bottom: 12px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--hairline);
        }

        .pillar-col h3 {
            font-size: 15.5px;
            font-weight: 700;
            color: var(--lamda-ink);
            margin-bottom: 8px;
            line-height: 1.35;
        }

        .pillar-col p {
            font-size: 13.5px;
            color: var(--lamda-steel);
            line-height: 1.58;
        }

        /* Grilla de 3 Columnas Limpias */
        .editorial-grid-3 {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }

        .clean-card {
            background: var(--bg-white);
            border: 1px solid var(--hairline);
            border-radius: 4px;
            padding: 22px;
        }

        . band-white .clean-card {
            background: var(--bg-stone);
        }

        .card-index {
            font-size: 10.5px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--lamda-plum);
            margin-bottom: 8px;
        }

        .clean-card h3 {
            font-size: 15px;
            font-weight: 700;
            color: var(--lamda-ink);
            margin-bottom: 6px;
        }

        .clean-card p {
            font-size: 13.2px;
            color: var(--lamda-steel);
            line-height: 1.55;
        }

        /* Grilla de 2 Columnas para Logística */
        .editorial-grid-2 {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 28px;
        }

        .locality-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 7px;
            margin-top: 14px;
        }

        .locality-chip {
            font-size: 12px;
            font-weight: 500;
            padding: 4px 11px;
            border-radius: 3px;
            background: var(--bg-white);
            border: 1px solid var(--hairline-strong);
            color: var(--lamda-ink);
        }

        /* Buscador y Tabla del Catálogo */
        .catalog-bar {
            display: grid;
            grid-template-columns: 1fr 260px;
            gap: 12px;
            margin-bottom: 12px;
        }

        .input-field, .select-field, .textarea-field {
            width: 100%;
            padding: 9px 12px;
            border: 1px solid var(--hairline-strong);
            border-radius: 4px;
            font-size: 13.5px;
            font-family: inherit;
            color: var(--lamda-ink);
            background: var(--bg-white);
        }

        .input-field:focus, .select-field:focus, .textarea-field:focus {
            outline: none;
            border-color: var(--lamda-plum);
        }

        .catalog-status {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: var(--lamda-steel);
            margin-bottom: 10px;
        }

        .table-box {
            border: 1px solid var(--hairline);
            border-radius: 4px;
            background: var(--bg-white);
            overflow: hidden;
            max-height: 440px;
            overflow-y: auto;
        }

        table.clean-table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 13px;
        }

        table.clean-table th {
            position: sticky;
            top: 0;
            background: var(--bg-stone);
            color: var(--lamda-charcoal);
            font-weight: 700;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 10px 14px;
            border-bottom: 1px solid var(--hairline-strong);
        }

        table.clean-table td {
            padding: 9px 14px;
            border-bottom: 1px solid var(--hairline);
            color: var(--lamda-ink);
        }

        table.clean-table tr:hover td {
            background: var(--lamda-plum-tint);
        }

        .code-pill {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11.5px;
            font-weight: 600;
            color: var(--lamda-plum-dark);
            background: var(--lamda-plum-tint);
            padding: 2px 6px;
            border-radius: 3px;
        }

        /* Preguntas Frecuentes en Grilla de 2 Columnas */
        .faq-grid-2 {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 24px 40px;
        }

        .faq-item {
            padding-bottom: 16px;
            border-bottom: 1px solid var(--hairline);
        }

        .faq-q {
            font-size: 14.5px;
            font-weight: 700;
            color: var(--lamda-ink);
            margin-bottom: 6px;
        }

        .faq-a {
            font-size: 13.5px;
            color: var(--lamda-steel);
            line-height: 1.58;
        }

        /* Formulario de Contacto en el Panel Derecho */
        .form-group {
            margin-bottom: 12px;
        }

        .form-group label {
            display: block;
            font-size: 10.5px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--lamda-steel);
            margin-bottom: 4px;
        }

        .contact-direct-card {
            margin-top: 16px;
            padding: 14px;
            background: var(--bg-stone);
            border: 1px solid var(--hairline);
            border-radius: 4px;
            font-size: 12px;
            line-height: 1.6;
        }

        footer.site-footer {
            background: var(--bg-white);
            border-top: 1px solid var(--hairline);
            padding: 24px 5vw;
            font-size: 12px;
            color: var(--lamda-steel);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 12px;
        }

        footer.site-footer a {
            color: var(--lamda-plum);
            text-decoration: none;
            font-weight: 500;
        }

        /* =========================================================
           MODO CELULAR:
           - Arriba: Regulador a la izquierda + Logo LAMDA central más grande
           - Abajo: El resto de los botones en la barra inferior fija
           ========================================================= */
        .drawer-backdrop {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(34, 34, 33, 0.35);
            z-index: 250;
        }

        body.drawer-backdrop-active .drawer-backdrop {
            display: block;
        }

        body.mode-mobile .topbar {
            padding: 0 16px;
            height: 72px;
            justify-content: center;
            position: sticky;
        }

        body.mode-mobile .topbar-left {
            width: 100%;
            justify-content: center;
            position: relative;
        }

        body.mode-mobile #btnHeaderToc {
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%);
            padding: 0 10px;
        }

        body.mode-mobile .nav-icon-btn .btn-subtle-label {
            display: none;
        }

        body.mode-mobile .brand-comarca {
            display: none;
        }

        body.mode-mobile .brand-lockup {
            margin: 0 auto;
        }

        body.mode-mobile .brand-lockup img {
            height: 48px;
        }

        body.mode-mobile .topbar-right #btnPrefsTrigger,
        body.mode-mobile .topbar-right #btnHeaderContact {
            display: none;
        }

        body.mode-mobile .prefs-popover {
            position: fixed;
            top: auto;
            bottom: 58px;
            left: 12px;
            right: auto;
            transform: none;
            width: min(88vw, 250px);
            box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.18);
        }

        body.mode-mobile .side-drawer {
            position: fixed;
            top: 0;
            bottom: 0;
            height: 100vh;
            z-index: 300;
            box-shadow: 0 12px 36px rgba(0,0,0,0.16);
        }

        body.mode-mobile .side-drawer-left { left: 0; }
        body.mode-mobile .side-drawer-right { right: 0; }

        body.mode-mobile .side-drawer-left.open,
        body.mode-mobile .side-drawer-right.open {
            width: min(88vw, 330px);
            min-width: min(88vw, 330px);
        }

        body.mode-mobile .editorial-band {
            padding: 32px 18px;
        }

        body.mode-mobile .hero-editorial-grid,
        body.mode-mobile .section-header-split,
        body.mode-mobile .pillars-grid-4,
        body.mode-mobile .editorial-grid-3,
        body.mode-mobile .editorial-grid-2,
        body.mode-mobile .faq-grid-2,
        body.mode-mobile .catalog-bar {
            grid-template-columns: 1fr;
            gap: 18px;
        }

        body.mode-mobile .hero-headline {
            font-size: 23px;
        }

        body.mode-mobile .center-stage {
            padding-bottom: 58px;
        }

        .mobile-bottom-bar {
            display: none;
        }

        body.mode-mobile .mobile-bottom-bar {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 8px;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: rgba(255, 255, 255, 0.98);
            backdrop-filter: blur(8px);
            border-top: 1px solid var(--hairline-strong);
            padding: 6px 12px;
            z-index: 190;
        }

        body.mode-mobile .mobile-bottom-bar .btn {
            height: 36px;
            padding: 0 14px;
            font-size: 12.5px;
            white-space: nowrap;
        }

        @media (max-width: 1024px) {
            .hero-editorial-grid,
            .section-header-split,
            .pillars-grid-4 {
                grid-template-columns: 1fr;
                gap: 24px;
            }
            .editorial-grid-3 {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        @media (max-width: 820px) {
            .topbar {
                padding: 0 16px;
                height: 72px;
                justify-content: center;
                position: sticky;
            }
            .topbar-left {
                width: 100%;
                justify-content: center;
                position: relative;
            }
            #btnHeaderToc {
                position: absolute;
                left: 0;
                top: 50%;
                transform: translateY(-50%);
                padding: 0 10px;
            }
            .nav-icon-btn .btn-subtle-label,
            .brand-comarca,
            .topbar-right #btnPrefsTrigger,
            .topbar-right #btnHeaderContact {
                display: none !important;
            }
            .brand-lockup {
                margin: 0 auto;
            }
            .brand-lockup img {
                height: 48px;
            }
            .prefs-popover {
                position: fixed;
                top: auto;
                bottom: 58px;
                left: 12px;
                right: auto;
                transform: none;
                width: min(88vw, 250px);
                box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.18);
            }
            .editorial-grid-3,
            .editorial-grid-2,
            .faq-grid-2,
            .catalog-bar {
                grid-template-columns: 1fr;
            }
            .center-stage {
                padding-bottom: 58px;
            }
            .mobile-bottom-bar {
                display: grid;
                grid-template-columns: auto 1fr;
                gap: 8px;
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                background: rgba(255, 255, 255, 0.98);
                backdrop-filter: blur(8px);
                border-top: 1px solid var(--hairline-strong);
                padding: 6px 12px;
                z-index: 190;
            }
            .mobile-bottom-bar .btn {
                height: 36px;
                padding: 0 14px;
                font-size: 12.5px;
                white-space: nowrap;
            }
        }
    </style>
</head>
<body class="mode-pc">

    <!-- ENCABEZADO:
         - En PC: [Índice] + Logo LAMDA + Rubro y Comarca a la izquierda | [ES] + [Contacto] a la derecha
         - En Celular: Regulador a la izquierda + Logo LAMDA grande al centro (resto de botones abajo)
    -->
    <header class="topbar">
        <div class="topbar-left">
            <button type="button" class="nav-icon-btn" id="btnHeaderToc" onclick="toggleDrawer('left')" title="Índice de contenidos">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="16" rx="2"></rect>
                    <line x1="9" y1="4" x2="9" y2="20"></line>
                </svg>
                <span class="btn-subtle-label" data-i18n="btn_index_short">Índice</span>
            </button>

            <a href="#inicio" class="brand-lockup" title="LAMDA — Inicio">
                <img src="/logo_LAMDA.png" alt="LAMDA" onerror="this.src='/logo_mini.png'">
                <div class="brand-comarca">
                    <strong data-i18n="brand_sub1">Alimentos Saludables, Frutos Secos, Semillas e Insumos</strong>
                    <span data-i18n="brand_sub2">La Plata y Gran La Plata • Distribución y Producción</span>
                </div>
            </a>
        </div>

        <div class="topbar-right">
            <button type="button" class="nav-icon-btn" id="btnPrefsTrigger" onclick="togglePrefsPopover(event)" title="Idioma y formato de visualización">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9"></circle>
                    <line x1="3.6" y1="9" x2="20.4" y2="9"></line>
                    <line x1="3.6" y1="15" x2="20.4" y2="15"></line>
                    <path d="M11.5 3a17 17 0 0 0 0 18"></path>
                    <path d="M12.5 3a17 17 0 0 1 0 18"></path>
                </svg>
                <span id="currentLangBadge" style="font-size:11px;font-weight:700;">ES</span>
                <span style="font-size:9px;color:var(--lamda-muted);">▾</span>
            </button>

            <button type="button" class="nav-icon-btn contact-trigger" id="btnHeaderContact" onclick="toggleDrawer('right')" title="Solicitar contacto o visita comercial">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
                <span class="btn-subtle-label" data-i18n="btn_contact_short">Contacto</span>
            </button>
        </div>
    </header>

    <!-- MENÚ FLOTANTE DE IDIOMA Y VISTA (FUERA DEL HEADER PARA FUNCIONAR EN PC Y EN CELULAR) -->
    <div class="prefs-popover" id="prefsPopover">
        <div class="prefs-group-title" data-i18n="menu_lang_title">Idioma / 语言</div>
        <button type="button" class="prefs-item active" id="btnLangEs" onclick="setLanguage('es'); closePrefsPopover();">
            <span>Español</span>
            <span style="font-size:11px;color:var(--lamda-plum);">ES</span>
        </button>
        <button type="button" class="prefs-item" id="btnLangZh" onclick="setLanguage('zh'); closePrefsPopover();">
            <span>中文 (Chino Simplificado)</span>
            <span style="font-size:11px;color:var(--lamda-plum);">中文</span>
        </button>

        <div class="prefs-divider"></div>

        <div class="prefs-group-title" data-i18n="menu_view_title">Formato de Pantalla</div>
        <button type="button" class="prefs-item active" id="btnModePc" onclick="setViewMode('pc'); closePrefsPopover();">
            <span data-i18n="menu_view_pc">Vista PC (Escritorio)</span>
            <span style="font-size:11px;">🖥</span>
        </button>
        <button type="button" class="prefs-item" id="btnModeMobile" onclick="setViewMode('mobile'); closePrefsPopover();">
            <span data-i18n="menu_view_mob">Vista Celular (Móvil)</span>
            <span style="font-size:11px;">📱</span>
        </button>
    </div>

    <div class="drawer-backdrop" onclick="closeAllDrawers()"></div>

    <div class="workspace">

        <!-- PANEL IZQUIERDO: ÍNDICE DE CONTENIDOS -->
        <aside class="side-drawer side-drawer-left" id="drawerLeft" aria-label="Índice de Contenidos">
            <div class="drawer-inner">
                <div class="drawer-header">
                    <span class="drawer-title" data-i18n="toc_title">Índice de Contenidos</span>
                    <button type="button" class="drawer-close-btn" onclick="toggleDrawer('left')" data-i18n="btn_collapse">✕</button>
                </div>
                <ul class="toc-nav">
                    <li><a href="#inicio" onclick="onTocClick()"><span class="toc-num">01</span> <span data-i18n="nav_1">Propósito y Rubro</span></a></li>
                    <li><a href="#valor-servicio" onclick="onTocClick()"><span class="toc-num">02</span> <span data-i18n="nav_2">Dónde Ponemos el Esfuerzo</span></a></li>
                    <li><a href="#transparencia-operativa" onclick="onTocClick()"><span class="toc-num">03</span> <span data-i18n="nav_3">Gestión de Cuentas y Pedidos</span></a></li>
                    <li><a href="#flujos-produccion" onclick="onTocClick()"><span class="toc-num">04</span> <span data-i18n="nav_4">Depósito y 6 Flujos Productivos</span></a></li>
                    <li><a href="#zonas-logistica" onclick="onTocClick()"><span class="toc-num">05</span> <span data-i18n="nav_5">Logística y Zonas de Entrega</span></a></li>
                    <li><a href="#catalogo-articulos" onclick="onTocClick()"><span class="toc-num">06</span> <span data-i18n="nav_6">Catálogo (${articulos.length})</span></a></li>
                    <li><a href="#preguntas-frecuentes" onclick="onTocClick()"><span class="toc-num">07</span> <span data-i18n="nav_7">Preguntas Frecuentes</span></a></li>
                </ul>

                <a href="https://wa.me/${WHATSAPP_WA}?text=Hola%20LAMDA%2C%20vi%20su%20p%C3%A1gina%20web%20y%20me%20gustar%C3%ADa%20establecer%20contacto%20comercial." target="_blank" rel="noopener" class="toc-summary-box" style="display:block;text-decoration:none;cursor:pointer;transition:background 0.15s;">
                    <strong style="color:var(--lamda-ink);display:block;margin-bottom:4px;" data-i18n="toc_box_title">Contacto Directo por WhatsApp</strong>
                    <span data-i18n="toc_box_desc">Tocá acá para enviarnos un mensaje directo al WhatsApp comercial:</span>
                    <div style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;font-weight:700;color:#FFFFFF;background:var(--wa-green);padding:5px 10px;border-radius:4px;font-size:12px;">
                        <span>💬 Enviar WhatsApp: ${WHATSAPP_DISPLAY}</span>
                    </div>
                </a>
            </div>
        </aside>

        <!-- CONTENIDO CENTRAL DE PUNTA A PUNTA (ORDEN EDITORIAL) -->
        <main class="center-stage">

            <!-- 01. PORTADA EN DOS COLUMNAS: MENSAJE ESENCIAL + FICHA DE IDENTIDAD -->
            <section class="editorial-band band-white" id="inicio">
                <div class="band-container">
                    <div class="hero-editorial-grid">
                        <div>
                            <div class="eyebrow" data-i18n="hero_kicker">Abastecimiento Mayorista y Elaboración Propia • La Plata</div>
                            <h1 class="hero-headline" data-i18n="hero_title">
                                Nuestro esfuerzo diario está puesto en acompañar a tu comercio o tu producción, cuidando cada detalle del servicio.
                            </h1>
                            <p class="hero-prose" data-i18n="hero_lead">
                                Comercializamos y elaboramos <strong>frutos secos, semillas, cereales, legumbres, especias, harinas y mezclas propias</strong>. Sabemos que cada comerciante y cada productor conoce su oficio y el valor de su tiempo; por eso, en la parte que nos toca como proveedores, nos esforzamos por facilitar la tarea diaria: que las cuentas estén claras, los comprobantes al día y las entregas sean previsibles.
                            </p>
                            <div class="hero-cta-row">
                                <button type="button" class="btn btn-plum" onclick="openDrawer('right')" data-i18n="cta_visit">Solicitar Contacto o Visita Comercial</button>
                                <a href="https://wa.me/${WHATSAPP_WA}?text=Hola%20LAMDA%2C%20vi%20su%20p%C3%A1gina%20web%20y%20me%20gustar%C3%ADa%20establecer%20contacto%20comercial." target="_blank" rel="noopener" class="btn btn-outline-wa">
                                    <span class="wa-dot"></span>
                                    <span>WhatsApp: ${WHATSAPP_DISPLAY}</span>
                                </a>
                            </div>
                        </div>

                        <!-- Ficha estructurada que ordena la información sin saturar -->
                        <aside class="identity-sheet" aria-label="Resumen Institucional">
                            <div class="sheet-header" data-i18n="sheet_title">Síntesis de Nuestro Trabajo</div>
                            <div class="sheet-row">
                                <div class="sheet-label" data-i18n="sh1_lbl">01 · Nuestro Compromiso</div>
                                <div class="sheet-val" data-i18n="sh1_val">Respeto por tu tiempo, orden en saldos y sinceridad sobre lo que ofrecemos y lo que está a nuestro alcance.</div>
                            </div>
                            <div class="sheet-row">
                                <div class="sheet-label" data-i18n="sh2_lbl">02 · Qué Comercializamos</div>
                                <div class="sheet-val" data-i18n="sh2_val">Frutos secos, semillas, cereales, legumbres, especias, harinas, frutas desecadas y elaboración de granolas, mixes y barritas.</div>
                            </div>
                            <div class="sheet-row">
                                <div class="sheet-label" data-i18n="sh3_lbl">03 · A Quiénes Acompañamos</div>
                                <div class="sheet-val" data-i18n="sh3_val">Dietéticas, supermercados y autoservicios, así como elaboradores: <strong>heladerías</strong>, panaderías, pastelerías y gastronomía.</div>
                            </div>
                            <div class="sheet-row">
                                <div class="sheet-label" data-i18n="sh4_lbl">04 · Cobertura Logística</div>
                                <div class="sheet-val" data-i18n="sh4_val">Reparto propio en La Plata, City Bell, Gonnet, Villa Elisa, Los Hornos, Berisso y Ensenada. Otras localidades a coordinar.</div>
                            </div>
                        </aside>
                    </div>
                </div>
            </section>

            <!-- 02. LOS 4 PILARES DE NUESTRA FORMA DE TRABAJAR -->
            <section class="editorial-band band-stone" id="valor-servicio">
                <div class="band-container">
                    <div class="section-header-split">
                        <div>
                            <div class="eyebrow" data-i18n="sec2_kicker">02 • Compromiso de Servicio</div>
                            <h2 class="section-h2" data-i18n="sec2_title">Dónde ponemos nuestro esfuerzo todos los días</h2>
                        </div>
                        <p class="section-lead" data-i18n="sec2_desc">
                            Más allá de los alimentos e insumos que distribuimos, entendemos el abastecimiento como una responsabilidad cotidiana que debe simplificarle la jornada al cliente.
                        </p>
                    </div>

                    <div class="pillars-grid-4">
                        <div class="pillar-col">
                            <div class="pillar-num" data-i18n="val1_tag">01 / ORDEN EN LAS CUENTAS</div>
                            <h3 data-i18n="val1_title">Claridad en saldos, pagos y comprobantes</h3>
                            <p data-i18n="val1_desc">Procuramos que nadie tenga que perder tiempo intentando descifrar una cuenta corriente o rastreando un pago. Cada presupuesto, remito e imputación se registra de manera ordenada y accesible.</p>
                        </div>
                        <div class="pillar-col">
                            <div class="pillar-num" data-i18n="val2_tag">02 / SINCERIDAD COMERCIAL</div>
                            <h3 data-i18n="val2_title">Franqueza sobre lo que ofrecemos y lo que no</h3>
                            <p data-i18n="val2_desc">Preferimos hablar con honestidad desde el primer día: qué mercadería trabajamos, en qué plazos reales podemos cumplir y qué cosas no están a nuestro alcance. Cuidamos la confianza evitando promesas que no podamos sostener.</p>
                        </div>
                        <div class="pillar-col">
                            <div class="pillar-num" data-i18n="val3_tag">03 / CUMPLIMIENTO Y RESPUESTA</div>
                            <h3 data-i18n="val3_title">Entregas previsibles y atención ante imprevistos</h3>
                            <p data-i18n="val3_desc">Nos ocupamos de toda la logística que rodea al pedido: avisar cuándo entregamos y, si en algún momento surge una devolución, un cambio o un problema con la mercadería, hacernos cargo y resolverlo sin vueltas.</p>
                        </div>
                        <div class="pillar-col">
                            <div class="pillar-num" data-i18n="val4_tag">04 / VÍNCULO CERCANO</div>
                            <h3 data-i18n="val4_title">Calidad de atención antes que cantidad</h3>
                            <p data-i18n="val4_desc">Preferimos crecer cuidando el vínculo con cada cliente. Escuchamos la necesidad puntual de cada comercio y de cada elaborador (heladerías, panificados, gastronomía) para adaptarnos a su ritmo de trabajo.</p>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 03. HERRAMIENTAS PARA EL CLIENTE ACTIVO -->
            <section class="editorial-band band-white" id="transparencia-operativa">
                <div class="band-container">
                    <div class="section-header-split">
                        <div>
                            <div class="eyebrow" data-i18n="sec3_kicker">03 • Orden y Previsibilidad</div>
                            <h2 class="section-h2" data-i18n="sec3_title">Herramientas para un trabajo ordenado y sin contratiempos</h2>
                        </div>
                        <p class="section-lead" data-i18n="sec3_desc">
                            Una vez que realizás tu primera operación y te incorporás como cliente activo, contás con respaldos prácticos en cada etapa comercial.
                        </p>
                    </div>

                    <div class="editorial-grid-3">
                        <div class="clean-card">
                            <div class="card-index" data-i18n="p1_tag">01 · Cuentas Claras</div>
                            <h3 data-i18n="p1_title">Saldos, Pagos y Comprobantes al Día</h3>
                            <p data-i18n="p1_desc">Registro claro de presupuestos, pagos parciales o totales y saldos actualizados para facilitar el control administrativo de tu negocio.</p>
                        </div>
                        <div class="clean-card">
                            <div class="card-index" data-i18n="p2_tag">02 · Comunicación</div>
                            <h3 data-i18n="p2_title">Avisos de Despacho y Novedades</h3>
                            <p data-i18n="p2_desc">Información oportuna sobre el armado y salida de tu pedido, junto con comunicaciones ordenadas sobre disponibilidad y listas.</p>
                        </div>
                        <div class="clean-card">
                            <div class="card-index" data-i18n="p3_tag">03 · Reposición Simple</div>
                            <h3 data-i18n="p3_title">Portal de Autogestión + Trato Humano</h3>
                            <p data-i18n="p3_desc">Acceso a nuestro Portal B2B con tu lista asignada para consultar o armar pedidos con tranquilidad, acompañado siempre por nuestro contacto directo.</p>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 04. CAPACIDAD OPERATIVA Y LOS 6 FLUJOS -->
            <section class="editorial-band band-stone" id="flujos-produccion">
                <div class="band-container">
                    <div class="section-header-split">
                        <div>
                            <div class="eyebrow" data-i18n="sec4_kicker">04 • Respaldo Físico e Industrial</div>
                            <h2 class="section-h2" data-i18n="sec4_title">Depósito Propio y 6 Flujos de Mercadería y Elaboración</h2>
                        </div>
                        <p class="section-lead" data-i18n="sec4_desc">
                            Contamos con depósito propio, sala de fraccionamiento y líneas de elaboración que se adaptan tanto a la góndola comercial como al insumo de producción.
                        </p>
                    </div>

                    <div class="editorial-grid-3">
                        <div class="clean-card">
                            <div class="card-index" data-i18n="f1_tag">Flujo 01</div>
                            <h3 data-i18n="f1_title">Bulto Cerrado Directo</h3>
                            <p data-i18n="f1_desc">Bolsas y cajas industriales originales para heladerías, panaderías, gastronomía y comercios de alto volumen.</p>
                        </div>
                        <div class="clean-card">
                            <div class="card-index" data-i18n="f2_tag">Flujo 02</div>
                            <h3 data-i18n="f2_title">Fraccionados Puros</h3>
                            <p data-i18n="f2_desc">Fraccionamiento local de frutos secos, semillas, cereales, legumbres y especias listas para góndola o uso intermedio.</p>
                        </div>
                        <div class="clean-card">
                            <div class="card-index" data-i18n="f3_tag">Flujo 03</div>
                            <h3 data-i18n="f3_title">Mezclas Internas (Mixes)</h3>
                            <p data-i18n="f3_desc">Elaboración de mixes de frutos secos y semillas con proporción controlada y rotación fresca.</p>
                        </div>
                        <div class="clean-card">
                            <div class="card-index" data-i18n="f4_tag">Flujo 04</div>
                            <h3 data-i18n="f4_title">Tostadero y Procesados</h3>
                            <p data-i18n="f4_desc">Procesos térmicos y tostados controlados en unidades productivas asociadas con fraccionamiento local.</p>
                        </div>
                        <div class="clean-card">
                            <div class="card-index" data-i18n="f5_tag">Flujo 05</div>
                            <h3 data-i18n="f5_title">Línea de Barritas</h3>
                            <p data-i18n="f5_desc">Formulación de pre-mezclas en nuestro depósito, moldeado en unidad productiva y presentación en packs comerciales.</p>
                        </div>
                        <div class="clean-card">
                            <div class="card-index" data-i18n="f6_tag">Flujo 06</div>
                            <h3 data-i18n="f6_title">Granolas Complejas</h3>
                            <p data-i18n="f6_desc">Horneado artesanal y ensamblado posterior con frutos secos, pasas, semillas y coco.</p>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 05. LOGÍSTICA Y ZONAS DE INFLUENCIA -->
            <section class="editorial-band band-white" id="zonas-logistica">
                <div class="band-container">
                    <div class="section-header-split">
                        <div>
                            <div class="eyebrow" data-i18n="sec5_kicker">05 • Logística Transparente</div>
                            <h2 class="section-h2" data-i18n="sec5_title">Zonas de Influencia y Coordinación de Entregas</h2>
                        </div>
                        <p class="section-lead" data-i18n="sec5_desc">
                            Parte central de nuestra forma de trabajar es hablar con claridad sobre dónde llegamos con vehículo propio y cómo coordinamos con otras localidades.
                        </p>
                    </div>

                    <div class="editorial-grid-2">
                        <div class="clean-card">
                            <div class="card-index" data-i18n="z1_tag">Cobertura Directa Propia</div>
                            <h3 data-i18n="z1_title">La Plata y Gran La Plata (Camioneta Propia)</h3>
                            <p data-i18n="z1_desc">Entregamos de forma directa y programada con nuestro propio vehículo y personal en toda la región:</p>
                            <div class="locality-chips">
                                <span class="locality-chip">La Plata (Casco Urbano)</span>
                                <span class="locality-chip">City Bell</span>
                                <span class="locality-chip">Gonnet</span>
                                <span class="locality-chip">Villa Elisa</span>
                                <span class="locality-chip">Los Hornos</span>
                                <span class="locality-chip">Berisso</span>
                                <span class="locality-chip">Ensenada</span>
                            </div>
                        </div>
                        <div class="clean-card">
                            <div class="card-index" data-i18n="z2_tag">Otras Localidades y Consultas</div>
                            <h3 data-i18n="z2_title">¿Estás en otra ciudad o corredor? Conversémoslo</h3>
                            <p data-i18n="z2_desc">
                                Hoy por hoy no llegamos con vehículo propio a localidades como Brandsen, Chascomús, Dolores o 25 de Mayo, pero la predisposición está siempre abierta. Si tenés un comercio o producción fuera del Gran La Plata, escribinos y evaluamos juntos cómo coordinar el despacho mediante comisionistas o transporte de confianza.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 06. CATÁLOGO DE REFERENCIA -->
            <section class="editorial-band band-stone" id="catalogo-articulos">
                <div class="band-container">
                    <div class="section-header-split">
                        <div>
                            <div class="eyebrow" data-i18n="sec6_kicker">06 • Detalle de Mercadería</div>
                            <h2 class="section-h2" data-i18n="sec6_title">Catálogo de Alimentos, Frutos Secos, Semillas e Insumos (${articulos.length})</h2>
                        </div>
                        <p class="section-lead" data-i18n="sec6_desc">
                            A modo de referencia sobre los insumos y productos que respaldan nuestro servicio, podés consultar aquí las presentaciones que trabajamos actualmente.
                        </p>
                    </div>

                    <div class="catalog-bar">
                        <input
                            type="search"
                            id="buscadorCatalogoInstitucional"
                            class="input-field"
                            placeholder="Buscar artículo (ej: almendra, nuez, cacao, coco, granola, 1kg, 5kg)..."
                            autocomplete="off"
                        >
                        <select id="filtroRubroInstitucional" class="select-field">
                            <option value="" data-es="Todos los rubros (${rubros.length})" data-zh="所有类别 (${rubros.length})">Todos los rubros (${rubros.length})</option>
                            ${rubrosOptionsHtml}
                        </select>
                    </div>

                    <div class="catalog-status">
                        <span id="contadorResultadosCatalogo">Mostrando ${articulos.length} de ${articulos.length} presentaciones</span>
                        <span data-i18n="cat_note">Listas de precios mayoristas a disposición solicitando contacto</span>
                    </div>

                    <div class="table-box">
                        <table class="clean-table">
                            <thead>
                                <tr>
                                    <th style="width: 110px;" data-i18n="th_code">Código</th>
                                    <th data-i18n="th_article">Artículo / Descripción</th>
                                    <th style="width: 210px;" data-i18n="th_category">Rubro</th>
                                    <th style="width: 130px;" data-i18n="th_pack">Presentación</th>
                                </tr>
                            </thead>
                            <tbody id="tablaCatalogoBody"></tbody>
                        </table>
                    </div>
                </div>
            </section>

            <!-- 07. PREGUNTAS FRECUENTES -->
            <section class="editorial-band band-white" id="preguntas-frecuentes">
                <div class="band-container">
                    <div class="section-header-split">
                        <div>
                            <div class="eyebrow" data-i18n="sec7_kicker">07 • Dudas Frecuentes</div>
                            <h2 class="section-h2" data-i18n="sec7_title">Preguntas Frecuentes sobre Nuestro Servicio</h2>
                        </div>
                        <p class="section-lead" data-i18n="sec7_desc">
                            Respuestas claras sobre nuestra modalidad de atención comercial, abastecimiento y logística.
                        </p>
                    </div>

                    <div class="faq-grid-2">
                        <div class="faq-item">
                            <div class="faq-q" data-i18n="faq1_q">1. ¿Cuál es el compromiso principal de LAMDA al trabajar con un cliente?</div>
                            <div class="faq-a" data-i18n="faq1_a">Buscamos aportar tranquilidad y orden en la parte que nos toca como proveedores: cuentas claras, entregas acordadas y trato directo. Sabemos que cada cliente conoce su negocio; nuestro esfuerzo está puesto en cumplir con seriedad y sencillez para acompañar su trabajo diario.</div>
                        </div>
                        <div class="faq-item">
                            <div class="faq-q" data-i18n="faq2_q">2. ¿Abastecen tanto a comercios minoristas como a elaboradores (heladerías, panaderías, gastronomía)?</div>
                            <div class="faq-a" data-i18n="faq2_a">Sí. Trabajamos tanto con comercios de venta al público (dietéticas, supermercados, autoservicios) como con productores y elaboradores (heladerías, panaderías, pastelerías y gastronomía) que requieren materias primas e insumos confiables y entregas previsibles.</div>
                        </div>
                        <div class="faq-item">
                            <div class="faq-q" data-i18n="faq3_q">3. ¿Cómo inicio el vínculo comercial o solicito una visita?</div>
                            <div class="faq-a" data-i18n="faq3_a">Escribinos directamente por WhatsApp al ${WHATSAPP_DISPLAY} o tocá el botón de Contacto arriba a la derecha. Conversamos sobre lo que necesita tu negocio o producción, te brindamos nuestras listas y coordinamos una visita o primer pedido. Una vez realizada tu primera compra, se habilita tu acceso al Portal Exclusivo de Clientes.</div>
                        </div>
                        <div class="faq-item">
                            <div class="faq-q" data-i18n="faq4_q">4. ¿En qué zonas entregan con vehículo propio?</div>
                            <div class="faq-a" data-i18n="faq4_a">Realizamos reparto directo con nuestra camioneta en La Plata (Casco Urbano), City Bell, Gonnet, Villa Elisa, Los Hornos, Berisso y Ensenada. Para otras localidades, consultanos y buscamos juntos la forma de coordinar el envío.</div>
                        </div>
                    </div>
                </div>
            </section>

        </main>

        <!-- PANEL DERECHO: SOLICITAR CONTACTO / VISITA -->
        <aside class="side-drawer side-drawer-right" id="drawerRight" aria-label="Solicitar Contacto o Visita">
            <div class="drawer-inner">
                <div class="drawer-header">
                    <span class="drawer-title" data-i18n="contact_drawer_title">Solicitar Contacto / Visita</span>
                    <button type="button" class="drawer-close-btn" onclick="toggleDrawer('right')" data-i18n="btn_collapse">✕</button>
                </div>

                <p style="font-size: 12.5px; color: var(--lamda-steel); margin-bottom: 14px;" data-i18n="contact_intro">
                    Completá tus datos para enviarnos un mensaje directo al WhatsApp comercial de LAMDA (${WHATSAPP_DISPLAY}) y coordinar asesoramiento o visita:
                </p>

                <form onsubmit="enviarConsultaWhatsApp(event)">
                    <div class="form-group">
                        <label for="cNombre" data-i18n="lbl_name">Nombre y Apellido</label>
                        <input type="text" id="cNombre" class="input-field" required placeholder="Ej: Martín / Supermercado / Heladería">
                    </div>
                    <div class="form-group">
                        <label for="cComercio" data-i18n="lbl_store">Comercio o Producción</label>
                        <input type="text" id="cComercio" class="input-field" required placeholder="Ej: Dietética / Supermercado / Heladería / Panadería">
                    </div>
                    <div class="form-group">
                        <label for="cLocalidad" data-i18n="lbl_city">Localidad</label>
                        <select id="cLocalidad" class="select-field">
                            <option value="La Plata (Casco Urbano)">La Plata (Casco Urbano)</option>
                            <option value="City Bell">City Bell</option>
                            <option value="Gonnet">Gonnet</option>
                            <option value="Villa Elisa">Villa Elisa</option>
                            <option value="Los Hornos">Los Hornos</option>
                            <option value="Berisso">Berisso</option>
                            <option value="Ensenada">Ensenada</option>
                            <option value="Otra localidad (Coordinar envío)">Otra localidad (Coordinar envío)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="cMotivo" data-i18n="lbl_reason">¿Cómo podemos ayudarte?</label>
                        <select id="cMotivo" class="select-field">
                            <option value="Solicitar lista de precios y conocer el servicio" data-i18n="opt_r1">Solicitar lista de precios y conocer el servicio</option>
                            <option value="Coordinar visita de un representante comercial" data-i18n="opt_r2">Coordinar visita de un representante comercial</option>
                            <option value="Abastecimiento de insumos para producción (heladería / panadería / gastronomía)" data-i18n="opt_r3">Insumos para producción (heladería / panadería / gastronomía)</option>
                            <option value="Consultar envío hacia otra localidad" data-i18n="opt_r4">Consultar envío hacia otra localidad</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="cMensaje" data-i18n="lbl_msg">Comentario adicional (opcional)</label>
                        <textarea id="cMensaje" rows="2" class="textarea-field" placeholder="Dirección, horarios o insumos de interés..."></textarea>
                    </div>

                    <button type="submit" class="btn btn-plum" style="width: 100%; margin-top: 4px;" data-i18n="btn_send_wa">
                        Enviar a WhatsApp (${WHATSAPP_DISPLAY})
                    </button>
                </form>

                <div class="contact-direct-card">
                    <div><strong>WhatsApp:</strong> <a href="https://wa.me/${WHATSAPP_WA}" target="_blank" rel="noopener" style="color:var(--wa-green);font-weight:700;text-decoration:none;">+54 9 ${WHATSAPP_DISPLAY}</a></div>
                    <div><strong>Email:</strong> <a href="mailto:${EMAIL_CONTACTO}" style="color:var(--lamda-plum);text-decoration:none;">${EMAIL_CONTACTO}</a></div>
                    <div><strong data-i18n="lbl_zone_direct">Reparto Propio:</strong> La Plata, City Bell, Gonnet, Villa Elisa, Los Hornos, Berisso y Ensenada.</div>
                </div>
            </div>
        </aside>

    </div>

    <!-- BARRA INFERIOR ANGOSTA EN MODO CELULAR (SOLO IDIOMA/VISTA Y CONTACTO/VISITA) -->
    <div class="mobile-bottom-bar">
        <button type="button" class="btn btn-outline-wa" id="btnPrefsTriggerMob" onclick="togglePrefsPopover(event)">
            <span>🌐</span>
            <span id="currentLangBadgeMob">ES</span>
            <span style="font-size:9px;color:var(--lamda-muted);">▾</span>
        </button>
        <button type="button" class="btn btn-plum" onclick="openDrawer('right')" data-i18n="mob_btn_contact">✉ Solicitar Contacto / Visita</button>
    </div>

    <footer class="site-footer">
        <div>
            <strong>LAMDA</strong> — <span data-i18n="footer_copy">Alimentos Saludables, Frutos Secos, Semillas e Insumos • La Plata, Buenos Aires (${fechaActual})</span>
        </div>
        <div>
            <a href="/llms.txt" target="_blank">/llms.txt</a> ·
            <a href="/llms-full.txt" target="_blank">/llms-full.txt</a> ·
            <a href="/catalogo-publico.json" target="_blank">/catalogo-publico.json</a>
        </div>
    </footer>

    <script>
        window.CATALOGO_PUBLICO_LAMDA = ${JSON.stringify(articulos)};

        const I18N = {
            es: {
                btn_index_short: "Índice",
                btn_contact_short: "Contacto",
                brand_sub1: "Alimentos Saludables, Frutos Secos, Semillas e Insumos",
                brand_sub2: "La Plata y Gran La Plata • Distribución y Producción",
                menu_lang_title: "Idioma / 语言",
                menu_view_title: "Formato de Pantalla",
                menu_view_pc: "Vista PC (Escritorio)",
                menu_view_mob: "Vista Celular (Móvil)",
                toc_title: "Índice de Contenidos",
                btn_collapse: "✕",
                nav_1: "Propósito y Rubro",
                nav_2: "Dónde Ponemos el Esfuerzo",
                nav_3: "Gestión de Cuentas y Pedidos",
                nav_4: "Depósito y 6 Flujos Productivos",
                nav_5: "Logística y Zonas de Entrega",
                nav_6: "Catálogo (${articulos.length})",
                nav_7: "Preguntas Frecuentes",
                toc_box_title: "Contacto Directo",
                toc_box_desc: "Para recibir asesoramiento, lista de precios o coordinar una visita comercial:",
                hero_kicker: "Abastecimiento Mayorista y Elaboración Propia • La Plata",
                hero_title: "Nuestro esfuerzo diario está puesto en acompañar a tu comercio o tu producción, cuidando cada detalle del servicio.",
                hero_lead: "Comercializamos y elaboramos <strong>frutos secos, semillas, cereales, legumbres, especias, harinas y mezclas propias</strong>. Sabemos que cada comerciante y cada productor conoce su oficio y el valor de su tiempo; por eso, en la parte que nos toca como proveedores, nos esforzamos por facilitar la tarea diaria: que las cuentas estén claras, los comprobantes al día y las entregas sean previsibles.",
                cta_visit: "Solicitar Contacto o Visita Comercial",
                sheet_title: "Síntesis de Nuestro Trabajo",
                sh1_lbl: "01 · Nuestro Compromiso",
                sh1_val: "Respeto por tu tiempo, orden en saldos y sinceridad sobre lo que ofrecemos y lo que está a nuestro alcance.",
                sh2_lbl: "02 · Qué Comercializamos",
                sh2_val: "Frutos secos, semillas, cereales, legumbres, especias, harinas, frutas desecadas y elaboración de granolas, mixes y barritas.",
                sh3_lbl: "03 · A Quiénes Acompañamos",
                sh3_val: "Dietéticas, supermercados y autoservicios, así como elaboradores: <strong>heladerías</strong>, panaderías, pastelerías y gastronomía.",
                sh4_lbl: "04 · Cobertura Logística",
                sh4_val: "Reparto propio en La Plata, City Bell, Gonnet, Villa Elisa, Los Hornos, Berisso y Ensenada. Otras localidades a coordinar.",
                sec2_kicker: "02 • Compromiso de Servicio",
                sec2_title: "Dónde ponemos nuestro esfuerzo todos los días",
                sec2_desc: "Más allá de los alimentos e insumos que distribuimos, entendemos el abastecimiento como una responsabilidad cotidiana que debe simplificarle la jornada al cliente.",
                val1_tag: "01 / ORDEN EN LAS CUENTAS",
                val1_title: "Claridad en saldos, pagos y comprobantes",
                val1_desc: "Procuramos que nadie tenga que perder tiempo intentando descifrar una cuenta corriente o rastreando un pago. Cada presupuesto, remito e imputación se registra de manera ordenada y accesible.",
                val2_tag: "02 / SINCERIDAD COMERCIAL",
                val2_title: "Franqueza sobre lo que ofrecemos y lo que no",
                val2_desc: "Preferimos hablar con honestidad desde el primer día: qué mercadería trabajamos, en qué plazos reales podemos cumplir y qué cosas no están a nuestro alcance. Cuidamos la confianza evitando promesas que no podamos sostener.",
                val3_tag: "03 / CUMPLIMIENTO Y RESPUESTA",
                val3_title: "Entregas previsibles y atención ante imprevistos",
                val3_desc: "Nos ocupamos de toda la logística que rodea al pedido: avisar cuándo entregamos y, si en algún momento surge una devolución, un cambio o un problema con la mercadería, hacernos cargo y resolverlo sin vueltas.",
                val4_tag: "04 / VÍNCULO CERCANO",
                val4_title: "Calidad de atención antes que cantidad",
                val4_desc: "Preferimos crecer cuidando el vínculo con cada cliente. Escuchamos la necesidad puntual de cada comercio y de cada elaborador (heladerías, panificados, gastronomía) para adaptarnos a su ritmo de trabajo.",
                sec3_kicker: "03 • Orden y Previsibilidad",
                sec3_title: "Herramientas para un trabajo ordenado y sin contratiempos",
                sec3_desc: "Una vez que realizás tu primera operación y te incorporás como cliente activo, contás con respaldos prácticos en cada etapa comercial.",
                p1_tag: "01 · Cuentas Claras",
                p1_title: "Saldos, Pagos y Comprobantes al Día",
                p1_desc: "Registro claro de presupuestos, pagos parciales o totales y saldos actualizados para facilitar el control administrativo de tu negocio.",
                p2_tag: "02 · Comunicación",
                p2_title: "Avisos de Despacho y Novedades",
                p2_desc: "Información oportuna sobre el armado y salida de tu pedido, junto con comunicaciones ordenadas sobre disponibilidad y listas.",
                p3_tag: "03 · Reposición Simple",
                p3_title: "Portal de Autogestión + Trato Humano",
                p3_desc: "Acceso a nuestro Portal B2B con tu lista asignada para consultar o armar pedidos con tranquilidad, acompañado siempre por nuestro contacto directo.",
                sec4_kicker: "04 • Respaldo Físico e Industrial",
                sec4_title: "Depósito Propio y 6 Flujos de Mercadería y Elaboración",
                sec4_desc: "Contamos con depósito propio, sala de fraccionamiento y líneas de elaboración que se adaptan tanto a la góndola comercial como al insumo de producción.",
                f1_tag: "Flujo 01",
                f1_title: "Bulto Cerrado Directo",
                f1_desc: "Bolsas y cajas industriales originales para heladerías, panaderías, gastronomía y comercios de alto volumen.",
                f2_tag: "Flujo 02",
                f2_title: "Fraccionados Puros",
                f2_desc: "Fraccionamiento local de frutos secos, semillas, cereales, legumbres y especias listas para góndola o uso intermedio.",
                f3_tag: "Flujo 03",
                f3_title: "Mezclas Internas (Mixes)",
                f3_desc: "Elaboración de mixes de frutos secos y semillas con proporción controlada y rotación fresca.",
                f4_tag: "Flujo 04",
                f4_title: "Tostadero y Procesados",
                f4_desc: "Procesos térmicos y tostados controlados en unidades productivas asociadas con fraccionamiento local.",
                f5_tag: "Flujo 05",
                f5_title: "Línea de Barritas",
                f5_desc: "Formulación de pre-mezclas en nuestro depósito, moldeado en unidad productiva y presentación en packs comerciales.",
                f6_tag: "Flujo 06",
                f6_title: "Granolas Complejas",
                f6_desc: "Horneado artesanal y ensamblado posterior con frutos secos, pasas, semillas y coco.",
                sec5_kicker: "05 • Logística Transparente",
                sec5_title: "Zonas de Influencia y Coordinación de Entregas",
                sec5_desc: "Parte central de nuestra forma de trabajar es hablar con claridad sobre dónde llegamos con vehículo propio y cómo coordinamos con otras localidades.",
                z1_tag: "Cobertura Directa Propia",
                z1_title: "La Plata y Gran La Plata (Camioneta Propia)",
                z1_desc: "Entregamos de forma directa y programada con nuestro propio vehículo y personal en toda la región:",
                z2_tag: "Otras Localidades y Consultas",
                z2_title: "¿Estás en otra ciudad o corredor? Conversémoslo",
                z2_desc: "Hoy por hoy no llegamos con vehículo propio a localidades como Brandsen, Chascomús, Dolores o 25 de Mayo, pero la predisposición está siempre abierta. Si tenés un comercio o producción fuera del Gran La Plata, escribinos y evaluamos juntos cómo coordinar el despacho mediante comisionistas o transporte de confianza.",
                sec6_kicker: "06 • Detalle de Mercadería",
                sec6_title: "Catálogo de Alimentos, Frutos Secos, Semillas e Insumos (${articulos.length})",
                sec6_desc: "A modo de referencia sobre los insumos y productos que respaldan nuestro servicio, podés consultar aquí las presentaciones que trabajamos actualmente.",
                cat_note: "Listas de precios mayoristas a disposición solicitando contacto",
                th_code: "Código",
                th_article: "Artículo / Descripción",
                th_category: "Rubro",
                th_pack: "Presentación",
                sec7_kicker: "07 • Dudas Frecuentes",
                sec7_title: "Preguntas Frecuentes sobre Nuestro Servicio",
                sec7_desc: "Respuestas claras sobre nuestra modalidad de atención comercial, abastecimiento y logística.",
                faq1_q: "1. ¿Cuál es el compromiso principal de LAMDA al trabajar con un cliente?",
                faq1_a: "Buscamos aportar tranquilidad y orden en la parte que nos toca como proveedores: cuentas claras, entregas acordadas y trato directo. Sabemos que cada cliente conoce su negocio; nuestro esfuerzo está puesto en cumplir con seriedad y sencillez para acompañar su trabajo diario.",
                faq2_q: "2. ¿Abastecen tanto a comercios minoristas como a elaboradores (heladerías, panaderías, gastronomía)?",
                faq2_a: "Sí. Trabajamos tanto con comercios de venta al público (dietéticas, supermercados, autoservicios) como con productores y elaboradores (heladerías, panaderías, pastelerías y gastronomía) que requieren materias primas e insumos confiables y entregas previsibles.",
                faq3_q: "3. ¿Cómo inicio el vínculo comercial o solicito una visita?",
                faq3_a: "Escribinos directamente por WhatsApp al ${WHATSAPP_DISPLAY} o tocá el botón de Contacto arriba a la derecha. Conversamos sobre lo que necesita tu negocio o producción, te brindamos nuestras listas y coordinamos una visita o primer pedido. Una vez realizada tu primera compra, se habilita tu acceso al Portal Exclusivo de Clientes.",
                faq4_q: "4. ¿En qué zonas entregan con vehículo propio?",
                faq4_a: "Realizamos reparto directo con nuestra camioneta en La Plata (Casco Urbano), City Bell, Gonnet, Villa Elisa, Los Hornos, Berisso y Ensenada. Para otras localidades, consultanos y buscamos juntos la forma de coordinar el envío.",
                contact_drawer_title: "Solicitar Contacto / Visita",
                contact_intro: "Completá tus datos para enviarnos un mensaje directo al WhatsApp comercial de LAMDA (${WHATSAPP_DISPLAY}) y coordinar asesoramiento o visita:",
                lbl_name: "Nombre y Apellido",
                lbl_store: "Comercio o Producción",
                lbl_city: "Localidad",
                lbl_reason: "¿Cómo podemos ayudarte?",
                opt_r1: "Solicitar lista de precios y conocer el servicio",
                opt_r2: "Coordinar visita de un representante comercial",
                opt_r3: "Insumos para producción (heladería / panadería / gastronomía)",
                opt_r4: "Consultar envío hacia otra localidad",
                lbl_msg: "Comentario adicional (opcional)",
                btn_send_wa: "Enviar a WhatsApp (${WHATSAPP_DISPLAY})",
                lbl_zone_direct: "Reparto Propio:",
                mob_btn_index: "☰ Índice",
                mob_btn_contact: "✉ Contacto / Visita",
                footer_copy: "Alimentos Saludables, Frutos Secos, Semillas e Insumos • La Plata, Buenos Aires (${fechaActual})",
                search_placeholder: "Buscar artículo (ej: almendra, nuez, cacao, coco, granola, 1kg, 5kg)..."
            },
            zh: {
                btn_index_short: "目录",
                btn_contact_short: "联系",
                brand_sub1: "健康食品、坚果、种子与烘焙/冰淇淋原料",
                brand_sub2: "拉普拉塔及大拉普拉塔地区 • 批发配送与自有生产",
                menu_lang_title: "语言 / Idioma",
                menu_view_title: "显示模式 / Formato",
                menu_view_pc: "电脑版视图 (PC)",
                menu_view_mob: "手机版视图 (Celular)",
                toc_title: "内容目录 (Índice)",
                btn_collapse: "✕",
                nav_1: "服务宗旨与经营品类",
                nav_2: "我们日常努力的重心",
                nav_3: "账目、付款与订单管理",
                nav_4: "自有仓库与 6 大生产流程",
                nav_5: "配送范围与外地物流协调",
                nav_6: "商品参考目录 (${articulos.length})",
                nav_7: "常见问题解答 (FAQ)",
                toc_box_title: "直接商务联系",
                toc_box_desc: "如需获取批发报价单、咨询合作或预约业务代表上门拜访：",
                hero_kicker: "健康食品、坚果、种子与原料批发及自有生产 • 拉普拉塔 (La Plata)",
                hero_title: "我们每日的努力，旨在用心做好每一个服务细节，全力配合您的店铺经营与食品生产。",
                hero_lead: "我们批发并自主分装生产<strong>坚果、种子、谷物、豆类、香料、面粉及混合谷物</strong>。我们深知每位店主与生产者都精通自己的行业并珍惜宝贵时间；因此在作为供应商的职责范围内，我们尽力让日常合作更省心：账目清晰、单据同步、交货守时可期。",
                cta_visit: "申请商务联系 / 预约上门拜访",
                sheet_title: "我们的服务与业务概览",
                sh1_lbl: "01 · 我们的服务承诺",
                sh1_val: "尊重您的宝贵时间，保持账目清晰，并对我们能提供的商品与实际能力范围保持坦诚。",
                sh2_lbl: "02 · 经营商品品类",
                sh2_val: "坚果、种子、谷物、豆类、香料、面粉、果干蜜饯，以及自产格兰诺拉麦片、什锦果仁与能量谷物棒。",
                sh3_lbl: "03 · 服务客户类型",
                sh3_val: "华人超市、健康食品店、百货自选店，以及食品生产商：<strong>冰淇淋店</strong>、面包烘焙坊、甜品店与餐饮企业。",
                sh4_lbl: "04 · 配送覆盖区域",
                sh4_val: "自有货车直达 La Plata 市区、City Bell、Gonnet、Villa Elisa、Los Hornos、Berisso 与 Ensenada。其他城市可协商货运。",
                sec2_kicker: "02 • 服务承诺",
                sec2_title: "我们每天把精力放在哪里",
                sec2_desc: "除了所供应的坚果、种子与原料本身，我们将物资供应视为一份为客户减轻日常负担的责任。",
                val1_tag: "01 / 账目井然有序",
                val1_title: "余额、付款与单据清晰明了",
                val1_desc: "我们力求让客户无需耗费时间核对繁琐账单或查找汇款记录。每一份报价单、送货单及付款记录都条理清楚、随时可查。",
                val2_tag: "02 / 商业坦诚",
                val2_title: "对能做与不能做的事实事求是",
                val2_desc: "我们坚持从第一天起就坦诚沟通：我们经营哪些商品、实际能做到的交货时间，以及哪些不在我们的服务范围内。不作空洞承诺，珍惜彼此信任。",
                val3_tag: "03 / 守时与担当",
                val3_title: "交货时间可预期，遇到问题直接解决",
                val3_desc: "我们认真对待订单的每一个物流环节：提前告知送达时间；若出现退换货、差异或任何商品问题，我们主动承担并直接妥善解决。",
                val4_tag: "04 / 贴近客户需求",
                val4_title: "重质不重量，注重长期配合",
                val4_desc: "我们注重服务品质而非盲目追求客户数量。认真倾听每家零售店铺（超市、健康食品店）与生产商（冰淇淋店、烘焙及餐饮）的具体需求，配合您的工作节奏。",
                sec3_kicker: "03 • 秩序与可预期性",
                sec3_title: "助您日常采购井然有序的实用工具",
                sec3_desc: "当您完成首次采购成为正式客户后，将在每个环节享有清晰的工具与支持。",
                p1_tag: "01 · 账目一目了然",
                p1_title: "余额、付款与单据实时同步",
                p1_desc: "历史订单、部分或全额付款及当前往来余额清晰记录，方便您的日常财务核对。",
                p2_tag: "02 · 顺畅沟通",
                p2_title: "发货通知与周度动态",
                p2_desc: "备货与出库状态及时通知，并定期同步商品供应与价格表更新。",
                p3_tag: "03 · 便捷补货",
                p3_title: "专属客户门户 + 直接人工服务",
                p3_desc: "开通专属 B2B 客户门户随时查询与下单，同时始终保持直接、人性化的沟通。",
                sec4_kicker: "04 • 实体仓储与生产实力",
                sec4_title: "自有仓库与 6 大商品生产供应流程",
                sec4_desc: "我们拥有实体仓库、洁净分装车间及自有生产线，满足商超货架零售与工厂餐饮生产的不同规格需求。",
                f1_tag: "流程 01",
                f1_title: "原包装大件直供 (Bulto Cerrado)",
                f1_desc: "整袋/整箱大包装原料，适合冰淇淋店、烘焙厂、餐饮及大宗采购。",
                f2_tag: "流程 02",
                f2_title: "100% 纯单品分装",
                f2_desc: "坚果、种子、谷物、豆类与香料本地分装，适合超市货架直接陈列销售。",
                f3_tag: "流程 03",
                f3_title: "自有混合坚果 (Mixes)",
                f3_desc: "工厂内部按标准配方调配的什锦坚果与活力果仁组合。",
                f4_tag: "流程 04",
                f4_title: "烘焙与熟制加工",
                f4_desc: "专业烘焙单元控温加工，本地分装，确保酥脆度与新鲜周转。",
                f5_tag: "流程 05",
                f5_title: "能量谷物棒产线 (Barritas)",
                f5_desc: "自有配方预混与成型烘焙，提供商业盒装/排装规格。",
                f6_tag: "流程 06",
                f6_title: "复合格兰诺拉麦片 (Granolas)",
                f6_desc: "蜂蜜烘焙谷物基底，复配优质坚果、葡萄干与椰片。",
                sec5_kicker: "05 • 透明物流体系",
                sec5_title: "自有货车配送区域与外地物流协调",
                sec5_desc: "我们清楚说明自有车辆的直达范围，以及与其他城市客户的协作方式。",
                z1_tag: "自有车队直达",
                z1_title: "拉普拉塔及大拉普拉塔地区 (Gran La Plata)",
                z1_desc: "以下区域由 LAMDA 自有配送货车定期直接送货上门：",
                z2_tag: "其他城市与合作洽谈",
                z2_title: "位于其他城市？欢迎联系协商方案",
                z2_desc: "目前我们的自有车辆暂未直接覆盖 Brandsen、Chascomús、Dolores 或 25 de Mayo 等外围城市，但非常欢迎您的咨询。如您的店铺或工坊位于其他地区，请联系我们共同商讨通过货运代理（comisionistas）发货。",
                sec6_kicker: "06 • 经营商品参考明细",
                sec6_title: "食品、坚果、种子与原料参考目录（共 ${articulos.length} 种规格）",
                sec6_desc: "作为我们服务背后的商品支撑，您可以在此搜索查询我们目前常规供应的商品规格。",
                cat_note: "如需了解批发价格，请联系我们获取报价单",
                th_code: "编号",
                th_article: "商品名称 / 规格说明",
                th_category: "类别 (Rubro)",
                th_pack: "包装规格",
                sec7_kicker: "07 • 常见问题 (FAQ)",
                sec7_title: "关于 LAMDA 服务的常见问题",
                sec7_desc: "关于我们合作方式、原料供应与物流配送的清晰解答。",
                faq1_q: "1. LAMDA 与客户合作时最核心的承诺是什么？",
                faq1_a: "我们致力于在作为供应商的职责范围内为您带来省心与秩序：账目清晰、按约交货、直接沟通。我们深知每位客户都精通自己的生意，我们的努力在于踏实可靠地做好供应配合工作。",
                faq2_q: "2. 你们既供应零售超市/店铺，也供应冰淇淋店和烘焙生产商吗？",
                faq2_a: "是的。我们既服务于零售商业（华人超市、健康食品店、百货自选店），也服务于使用原料进行生产的客户（冰淇淋店、面包烘焙坊、甜品厂及餐饮业）。",
                faq3_q: "3. 如何开始合作或预约业务代表拜访？",
                faq3_a: "请直接发送 WhatsApp 消息至 ${WHATSAPP_DISPLAY}，或点击右上角“联系”按钮。我们将根据您的需求提供报价单或安排上门拜访。完成首次采购后，还将为您开通专属客户门户。",
                faq4_q: "4. 哪些区域由自有车辆直接配送？",
                faq4_a: "我们的自有配送车直达 La Plata 市区、City Bell、Gonnet、Villa Elisa、Los Hornos、Berisso 和 Ensenada。其他地区欢迎联系协商货运方案。",
                contact_drawer_title: "申请联系 / 预约上门拜访",
                contact_intro: "请填写以下信息，直接发送消息至 LAMDA 商务 WhatsApp (${WHATSAPP_DISPLAY})：",
                lbl_name: "您的姓名",
                lbl_store: "店铺或生产企业名称",
                lbl_city: "所在区域",
                lbl_reason: "我们需要为您提供什么帮助？",
                opt_r1: "获取批发报价单并了解服务模式",
                opt_r2: "预约 LAMDA 业务代表上门拜访",
                opt_r3: "生产原料采购（冰淇淋店 / 烘焙坊 / 餐饮加工）",
                opt_r4: "咨询外地城市发货与物流方案",
                lbl_msg: "补充说明（选填）",
                btn_send_wa: "发送至 WhatsApp (${WHATSAPP_DISPLAY})",
                lbl_zone_direct: "自有配送范围：",
                mob_btn_index: "☰ 目录",
                mob_btn_contact: "✉ 申请联系",
                footer_copy: "健康食品、坚果、种子与原料批发配送 • 拉普拉塔 (${fechaActual})",
                search_placeholder: "搜索商品（例如：almendra 杏仁, nuez 核桃, cacao 可可, 1kg, 5kg）..."
            }
        };

        let CURRENT_LANG = 'es';
        let CURRENT_MODE = 'pc';

        // POLÍTICA UNIVERSAL DE BÚSQUEDA LAMDA (Fase 49)
        window.obtenerTextoBusquedaArticulo = function(art) {
            if (!art || typeof art !== 'object') return '';
            const camposEstaticos = [
                art.codigo,
                art.nombre,
                art.nombre_zh,
                art.familia,
                art.familia_zh,
                art.rubro,
                art.rubro_zh,
                art.sub_rubro,
                art.presentacion
            ];
            const valoresDinamicos = [];
            if (art.propiedades && typeof art.propiedades === 'object') {
                for (const val of Object.values(art.propiedades)) {
                    if (val !== null && val !== undefined && typeof val !== 'object') {
                        valoresDinamicos.push(String(val));
                    }
                }
            }
            return camposEstaticos.concat(valoresDinamicos).filter(Boolean).join(' ').toLowerCase();
        };

        function syncBackdrop() {
            const isMobile = document.body.classList.contains('mode-mobile');
            const leftOpen = document.getElementById('drawerLeft').classList.contains('open');
            const rightOpen = document.getElementById('drawerRight').classList.contains('open');
            document.body.classList.toggle('drawer-backdrop-active', isMobile && (leftOpen || rightOpen));
            document.getElementById('btnHeaderToc').classList.toggle('active', leftOpen);
            document.getElementById('btnHeaderContact').classList.toggle('active', rightOpen);
        }

        function toggleDrawer(side) {
            const el = document.getElementById(side === 'left' ? 'drawerLeft' : 'drawerRight');
            const other = document.getElementById(side === 'left' ? 'drawerRight' : 'drawerLeft');
            const willOpen = !el.classList.contains('open');
            if (document.body.classList.contains('mode-mobile') && willOpen) {
                other.classList.remove('open');
            }
            el.classList.toggle('open', willOpen);
            if (willOpen && side === 'right' && window.__TELEMETRIA_LISTA) {
                registrarTelemetriaSitio('apertura_contacto', { detalle: 'Apertura del panel Solicitar Contacto / Visita' });
            }
            syncBackdrop();
        }

        function openDrawer(side) {
            const el = document.getElementById(side === 'left' ? 'drawerLeft' : 'drawerRight');
            const other = document.getElementById(side === 'left' ? 'drawerRight' : 'drawerLeft');
            if (document.body.classList.contains('mode-mobile')) {
                other.classList.remove('open');
            }
            el.classList.add('open');
            if (side === 'right' && window.__TELEMETRIA_LISTA) {
                registrarTelemetriaSitio('apertura_contacto', { detalle: 'Apertura del panel Solicitar Contacto / Visita' });
            }
            syncBackdrop();
        }

        function closeAllDrawers() {
            document.getElementById('drawerLeft').classList.remove('open');
            document.getElementById('drawerRight').classList.remove('open');
            syncBackdrop();
        }

        function onTocClick() {
            if (document.body.classList.contains('mode-mobile')) {
                closeAllDrawers();
            }
        }

        function togglePrefsPopover(e) {
            if (e) e.stopPropagation();
            const pop = document.getElementById('prefsPopover');
            pop.classList.toggle('open');
        }

        function closePrefsPopover() {
            const pop = document.getElementById('prefsPopover');
            if (pop) pop.classList.remove('open');
        }

        document.addEventListener('click', function(e) {
            const pop = document.getElementById('prefsPopover');
            const btn = document.getElementById('btnPrefsTrigger');
            const btnMob = document.getElementById('btnPrefsTriggerMob');
            if (pop && pop.classList.contains('open')) {
                const insideBtn = (btn && btn.contains(e.target)) || (btnMob && btnMob.contains(e.target));
                if (!pop.contains(e.target) && !insideBtn) {
                    pop.classList.remove('open');
                }
            }
        });

        function registrarClicArticuloFila(trEl) {
            if (!trEl) return;
            var nom = trEl.getAttribute('data-nombre') || '';
            var cod = trEl.getAttribute('data-codigo') || '';
            if (nom) {
                registrarTelemetriaSitio('busqueda_catalogo', {
                    termino_busqueda: nom,
                    detalle: 'Miró artículo: ' + nom + (cod ? ' (' + cod + ')' : '')
                });
            }
        }

        function renderizarCatalogo(lista) {
            const tbody = document.getElementById('tablaCatalogoBody');
            const contador = document.getElementById('contadorResultadosCatalogo');
            const total = window.CATALOGO_PUBLICO_LAMDA.length;

            if (contador) {
                contador.textContent = CURRENT_LANG === 'zh'
                    ? '显示 ' + lista.length + ' / 共 ' + total + ' 项商品规格'
                    : 'Mostrando ' + lista.length + ' de ' + total + ' presentaciones';
            }

            if (!tbody) return;
            if (lista.length === 0) {
                const msg = CURRENT_LANG === 'zh' ? '未找到匹配的商品。' : 'No se encontraron artículos con ese filtro.';
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#76777A;">' + msg + '</td></tr>';
                return;
            }

            tbody.innerHTML = lista.map(function(art) {
                const nombreMostrar = CURRENT_LANG === 'zh' ? (art.nombre_zh || art.nombre) : art.nombre;
                const rubroMostrar = CURRENT_LANG === 'zh' ? (art.rubro_zh || art.rubro) : art.rubro;
                const attrNom = String(art.nombre || '').replace(/"/g, '&quot;');
                const attrCod = String(art.codigo || '').replace(/"/g, '&quot;');
                return '<tr style="cursor:pointer;" data-nombre="' + attrNom + '" data-codigo="' + attrCod + '" onclick="registrarClicArticuloFila(this)">' +
                    '<td><span class="code-pill">' + art.codigo + '</span></td>' +
                    '<td style="font-weight:600;">' + nombreMostrar + '</td>' +
                    '<td style="color:#6E6F72;">' + rubroMostrar + '</td>' +
                    '<td>' + art.presentacion + '</td>' +
                '</tr>';
            }).join('');
        }

        function filtrarCatalogo() {
            const input = document.getElementById('buscadorCatalogoInstitucional');
            const select = document.getElementById('filtroRubroInstitucional');
            const queryRaw = (input ? input.value : '').toLowerCase().trim();
            const rubroSel = select ? select.value : '';
            const terminos = queryRaw ? queryRaw.split(/\\s+/).filter(Boolean) : [];

            const filtrados = window.CATALOGO_PUBLICO_LAMDA.filter(function(art) {
                if (rubroSel && art.rubro !== rubroSel) return false;
                if (terminos.length === 0) return true;
                const bolsa = window.obtenerTextoBusquedaArticulo(art);
                return terminos.every(function(t) { return bolsa.includes(t); });
            });

            renderizarCatalogo(filtrados);
        }

        function setLanguage(lang) {
            CURRENT_LANG = lang === 'zh' ? 'zh' : 'es';
            document.documentElement.lang = CURRENT_LANG === 'zh' ? 'zh-Hans' : 'es';

            document.getElementById('btnLangEs').classList.toggle('active', CURRENT_LANG === 'es');
            document.getElementById('btnLangZh').classList.toggle('active', CURRENT_LANG === 'zh');

            const badge = document.getElementById('currentLangBadge');
            if (badge) badge.textContent = CURRENT_LANG === 'zh' ? '中文' : 'ES';
            const badgeMob = document.getElementById('currentLangBadgeMob');
            if (badgeMob) badgeMob.textContent = CURRENT_LANG === 'zh' ? '中文' : 'ES';

            const dict = I18N[CURRENT_LANG];
            document.querySelectorAll('[data-i18n]').forEach(function(el) {
                const key = el.getAttribute('data-i18n');
                if (dict[key]) {
                    el.innerHTML = dict[key];
                }
            });

            const input = document.getElementById('buscadorCatalogoInstitucional');
            if (input && dict.search_placeholder) {
                input.placeholder = dict.search_placeholder;
            }

            const select = document.getElementById('filtroRubroInstitucional');
            if (select) {
                Array.from(select.options).forEach(function(opt) {
                    const txt = opt.getAttribute(CURRENT_LANG === 'zh' ? 'data-zh' : 'data-es');
                    if (txt) opt.textContent = txt;
                });
            }

            filtrarCatalogo();
            if (window.__TELEMETRIA_LISTA) {
                registrarTelemetriaSitio(CURRENT_LANG === 'zh' ? 'cambio_idioma_zh' : 'cambio_idioma_es', {
                    detalle: 'Cambio manual de idioma a ' + (CURRENT_LANG === 'zh' ? 'Chino (中文)' : 'Español (ES)')
                });
            }
        }

        function setViewMode(mode) {
            CURRENT_MODE = mode === 'mobile' ? 'mobile' : 'pc';
            document.body.classList.toggle('mode-mobile', CURRENT_MODE === 'mobile');
            document.body.classList.toggle('mode-pc', CURRENT_MODE === 'pc');

            document.getElementById('btnModePc').classList.toggle('active', CURRENT_MODE === 'pc');
            document.getElementById('btnModeMobile').classList.toggle('active', CURRENT_MODE === 'mobile');

            closeAllDrawers();
        }

        function registrarTelemetriaSitio(tipoEvento, extra) {
            try {
                extra = extra || {};
                const payload = {
                    tipo_evento: tipoEvento,
                    dispositivo_modo: CURRENT_MODE === 'mobile' ? 'Celular' : 'PC',
                    idioma: CURRENT_LANG,
                    termino_busqueda: extra.termino_busqueda || null,
                    detalle: extra.detalle || null,
                    dominio_host: window.location.host || 'lamdaser.com',
                    referrer: document.referrer || 'Acceso Directo'
                };

                const hostActual = (window.location.hostname || '').toLowerCase();
                const enviarASupabaseNube = function() {
                    var sbUrl = 'https://zysyxtbcvgswancxtpib.supabase.co/rest/v1/telemetria_accesos';
                    var sbKey = 'sb_publishable_auFX1kW7JonsV5TvUYnsnQ_LekKj2si';
                    return fetch(sbUrl, {
                        method: 'POST',
                        headers: {
                            'apikey': sbKey,
                            'Authorization': 'Bearer ' + sbKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            cliente_nombre: 'SITIO_INSTITUCIONAL_JSON',
                            dispositivo: payload.dispositivo_modo + ' (' + navigator.userAgent.slice(0, 80) + ')',
                            latencia_ms: 0,
                            tipo_acceso: JSON.stringify(payload)
                        }),
                        keepalive: true
                    }).catch(function() {});
                };

                // En el dominio público 24/7 (lamdaser.com / www.lamdaser.com), guardamos directo en la Nube (Supabase 24/7)
                // para que funcione siempre aunque la PC local del taller esté apagada.
                if (hostActual === 'lamdaser.com' || hostActual === 'www.lamdaser.com' || hostActual.includes('github.io') || hostActual.includes('workers.dev') || hostActual.includes('pages.dev')) {
                    enviarASupabaseNube();
                    return;
                }

                let endpoint = '/api/logistica/telemetria/sitio-evento';
                if (window.location.port === '5173' || window.location.port === '3000') {
                    endpoint = 'http://' + hostActual + ':3005/api/logistica/telemetria/sitio-evento';
                }

                fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    keepalive: true
                }).then(function(res) {
                    if (!res || !res.ok) throw new Error('local_offline');
                }).catch(function() {
                    enviarASupabaseNube();
                });
            } catch (_) {}
        }

        function enviarConsultaWhatsApp(e) {
            e.preventDefault();
            const nombre = (document.getElementById('cNombre').value || '').trim();
            const comercio = (document.getElementById('cComercio').value || '').trim();
            const localidad = (document.getElementById('cLocalidad').value || '').trim();
            const motivo = (document.getElementById('cMotivo').value || '').trim();
            const mensaje = (document.getElementById('cMensaje').value || '').trim();

            registrarTelemetriaSitio('envio_formulario_whatsapp', {
                detalle: comercio + ' (' + localidad + ') — ' + motivo
            });

            const idiomaNota = CURRENT_LANG === 'zh' ? ' [Consulta desde versión en Chino 中文]' : '';
            const texto = 'Hola LAMDA, les escribo desde su página oficial' + idiomaNota + '.\\n\\n' +
                '• *Contacto:* ' + nombre + '\\n' +
                '• *Comercio / Producción:* ' + comercio + '\\n' +
                '• *Localidad:* ' + localidad + '\\n' +
                '• *Interés:* ' + motivo +
                (mensaje ? ('\\n• *Detalle:* ' + mensaje) : '');

            const url = 'https://wa.me/${WHATSAPP_WA}?text=' + encodeURIComponent(texto);
            window.open(url, '_blank', 'noopener');
        }

        document.addEventListener('DOMContentLoaded', function() {
            const isSmallScreen = window.innerWidth <= 820 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
            setViewMode(isSmallScreen ? 'mobile' : 'pc');
            setLanguage('es');
            window.__TELEMETRIA_LISTA = true;

            registrarTelemetriaSitio('vista_pagina', {
                detalle: 'Ingreso a Página Institucional (' + (isSmallScreen ? 'Vista Celular' : 'Vista PC') + ')'
            });

            let timerBusqueda = null;
            const input = document.getElementById('buscadorCatalogoInstitucional');
            const select = document.getElementById('filtroRubroInstitucional');
            if (input) {
                input.addEventListener('input', function() {
                    filtrarCatalogo();
                    clearTimeout(timerBusqueda);
                    const val = (input.value || '').trim();
                    if (val.length >= 3) {
                        timerBusqueda = setTimeout(function() {
                            registrarTelemetriaSitio('busqueda_catalogo', {
                                termino_busqueda: val,
                                detalle: 'Búsqueda en catálogo: "' + val + '"'
                            });
                        }, 900);
                    }
                });
            }
            if (select) {
                select.addEventListener('change', function() {
                    filtrarCatalogo();
                    if (select.value) {
                        registrarTelemetriaSitio('busqueda_catalogo', {
                            termino_busqueda: select.value,
                            detalle: 'Filtro por rubro: ' + select.value
                        });
                    }
                });
            }

            document.querySelectorAll('a[href*="wa.me"]').forEach(function(link) {
                link.addEventListener('click', function() {
                    registrarTelemetriaSitio('clic_whatsapp', {
                        detalle: 'Clic directo al botón de WhatsApp (${WHATSAPP_DISPLAY})'
                    });
                });
            });
        });
    </script>
</body>
</html>`;
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('🌐 [LAMDA GEO/SEO] DISEÑO EDITORIAL SUIZO DE ALTA PRECISIÓN');
    console.log('═══════════════════════════════════════════════════════════════════');

    const articulos = await obtenerCatalogoPublico();
    const rubros = agruparCatalogo(articulos);

    const html = generarHtmlInstitucional(articulos, rubros);
    const llmsTxt = generarLlmsTxt(articulos, rubros);
    const llmsFullTxt = generarLlmsFullTxt(articulos, rubros);
    const jsonCatalog = JSON.stringify({
        empresa: 'LAMDA — Distribución Mayorista y Producción de Alimentos Saludables e Insumos',
        proposito_servicio: 'Nuestro esfuerzo diario está puesto en acompañar a comercios y productores cuidando cada detalle del servicio: orden en cuentas, pagos y comprobantes, sinceridad comercial, entregas previsibles y trato cercano.',
        ubicacion: 'La Plata, Provincia de Buenos Aires, Argentina',
        contacto_whatsapp: `+54 9 ${WHATSAPP_DISPLAY}`,
        email: EMAIL_CONTACTO,
        zonas_reparto_propio: ['La Plata', 'City Bell', 'Gonnet', 'Villa Elisa', 'Los Hornos', 'Berisso', 'Ensenada'],
        sectores_abastecidos: ['Dietéticas', 'Supermercados y Autoservicios', 'Heladerías', 'Panaderías y Pastelerías', 'Gastronomía y Elaboradores'],
        total_presentaciones_activas: articulos.length,
        rubros: rubros.map(r => ({ rubro: r.rubro, rubro_zh: r.rubro_zh, cantidad: r.cantidad })),
        articulos
    }, null, 2);

    const fechaSitemap = new Date().toISOString().split('T')[0];
    const robotsTxt = `User-agent: *
Allow: /
Allow: /institucional.html
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /catalogo-publico.json
Allow: /sitemap.xml

User-agent: Googlebot
Allow: /

User-agent: Google-Favicon
Allow: /

User-agent: Googlebot-Image
Allow: /

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${fechaSitemap}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/institucional.html</loc>
    <lastmod>${fechaSitemap}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${SITE_URL}/llms.txt</loc>
    <lastmod>${fechaSitemap}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${SITE_URL}/llms-full.txt</loc>
    <lastmod>${fechaSitemap}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${SITE_URL}/catalogo-publico.json</loc>
    <lastmod>${fechaSitemap}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`;

    const PAGINA_PUBLICA_DIST = path.join(__dirname, '..', 'pagina-publica-web', 'dist');
    fs.mkdirSync(PAGINA_PUBLICA_DIST, { recursive: true });

    const targetDirs = [PAGINA_PUBLICA_DIST, ETIQUETAS_DIR, LOGISTICA_DIR];
    for (const dir of targetDirs) {
        if (!fs.existsSync(dir)) continue;
        if (dir === PAGINA_PUBLICA_DIST) {
            fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
        }
        fs.writeFileSync(path.join(dir, 'institucional.html'), html, 'utf8');
        fs.writeFileSync(path.join(dir, 'llms.txt'), llmsTxt, 'utf8');
        fs.writeFileSync(path.join(dir, 'llms-full.txt'), llmsFullTxt, 'utf8');
        fs.writeFileSync(path.join(dir, 'catalogo-publico.json'), jsonCatalog, 'utf8');
        fs.writeFileSync(path.join(dir, 'robots.txt'), robotsTxt, 'utf8');
        fs.writeFileSync(path.join(dir, 'sitemap.xml'), sitemapXml, 'utf8');

        const assetsToCopy = ['logo_LAMDA.png', 'isotipo_L_LAMDA.png'];
        for (const assetName of assetsToCopy) {
            const srcAsset = path.join(PUBLIC_DIR, assetName);
            const dstAsset = path.join(dir, assetName);
            if (fs.existsSync(srcAsset) && srcAsset !== dstAsset) {
                fs.copyFileSync(srcAsset, dstAsset);
            }
        }
        // Eliminar favicon.svg viejo (ícono genérico 48x46 no cuadrado que hacía que Google y el navegador ignoraran la L de LAMDA)
        const oldSvg = path.join(dir, 'favicon.svg');
        if (fs.existsSync(oldSvg)) {
            try { fs.unlinkSync(oldSvg); } catch (_) {}
        }

        const srcIsotipo = path.join(PUBLIC_DIR, 'isotipo_L_LAMDA.png');
        const dstMini = path.join(dir, 'logo_mini.png');
        if (fs.existsSync(srcIsotipo)) {
            if (srcIsotipo !== dstMini) {
                fs.copyFileSync(srcIsotipo, dstMini);
            }
            // Google Search exige múltiplos exactos de 48px (48x48, 96x96, 192x192) y un archivo .ico nativo BMP 48x48 sin descalce de cabecera
            const { createCanvas, loadImage } = require('canvas');
            const imgIso = await loadImage(srcIsotipo);

            const renderSquarePng = (size, pad) => {
                const c = createCanvas(size, size);
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, size, size);
                ctx.drawImage(imgIso, pad, pad, size - pad * 2, size - pad * 2);
                return { canvas: c, ctx, buf: c.toBuffer('image/png') };
            };

            const icon48 = renderSquarePng(48, 2);
            const icon96 = renderSquarePng(96, 4);
            const icon192 = renderSquarePng(192, 10);

            fs.writeFileSync(path.join(dir, 'favicon-48x48.png'), icon48.buf);
            fs.writeFileSync(path.join(dir, 'favicon-96x96.png'), icon96.buf);
            fs.writeFileSync(path.join(dir, 'favicon.png'), icon192.buf);
            fs.writeFileSync(path.join(dir, 'icon-192.png'), icon192.buf);

            // Construir favicon.ico nativo sin comprimir (DIB/BMP 48x48 32-bit BGRA bottom-up) 100% compatible con Google-Favicon
            const w = 48, h = 48;
            const imgData = icon48.ctx.getImageData(0, 0, w, h).data;
            const xorSize = w * h * 4;
            const andRowBytes = Math.ceil(w / 32) * 4; // 8 bytes por fila para 48px
            const andSize = andRowBytes * h;           // 384 bytes
            const biSize = 40;
            const dibSize = biSize + xorSize + andSize;

            const icoBuf = Buffer.alloc(22 + dibSize, 0);
            // ICONDIR (6 bytes)
            icoBuf.writeUInt16LE(0, 0);       // Reserved
            icoBuf.writeUInt16LE(1, 2);       // Type = 1 (ICO)
            icoBuf.writeUInt16LE(1, 4);       // Count = 1
            // ICONDIRENTRY (16 bytes)
            icoBuf.writeUInt8(w, 6);          // bWidth = 48
            icoBuf.writeUInt8(h, 7);          // bHeight = 48
            icoBuf.writeUInt8(0, 8);          // bColorCount = 0
            icoBuf.writeUInt8(0, 9);          // bReserved = 0
            icoBuf.writeUInt16LE(1, 10);      // wPlanes = 1
            icoBuf.writeUInt16LE(32, 12);     // wBitCount = 32
            icoBuf.writeUInt32LE(dibSize, 14);// dwBytesInRes
            icoBuf.writeUInt32LE(22, 18);     // dwImageOffset = 22
            // BITMAPINFOHEADER (40 bytes)
            icoBuf.writeUInt32LE(biSize, 22); // biSize = 40
            icoBuf.writeInt32LE(w, 26);       // biWidth = 48
            icoBuf.writeInt32LE(h * 2, 30);   // biHeight = 96 (48 XOR + 48 AND)
            icoBuf.writeUInt16LE(1, 34);      // biPlanes = 1
            icoBuf.writeUInt16LE(32, 36);     // biBitCount = 32
            icoBuf.writeUInt32LE(0, 38);      // biCompression = BI_RGB (0)
            icoBuf.writeUInt32LE(xorSize + andSize, 42); // biSizeImage

            // Pixels BGRA bottom-up
            let dstOffset = 22 + biSize;
            for (let y = h - 1; y >= 0; y--) {
                for (let x = 0; x < w; x++) {
                    const srcIdx = (y * w + x) * 4;
                    icoBuf[dstOffset]     = imgData[srcIdx + 2]; // B
                    icoBuf[dstOffset + 1] = imgData[srcIdx + 1]; // G
                    icoBuf[dstOffset + 2] = imgData[srcIdx];     // R
                    icoBuf[dstOffset + 3] = imgData[srcIdx + 3]; // A
                    dstOffset += 4;
                }
            }
            fs.writeFileSync(path.join(dir, 'favicon.ico'), icoBuf);
        }
    }

    console.log('✅ Sitio regenerado con arquitectura editorial de precisión.');
    await pool.end();
}

main().catch(err => {
    console.error('❌ Error generando sitio institucional:', err);
    process.exit(1);
});
