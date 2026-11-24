/**
 * Servicio de Conocimiento, Detección Determinista y Referencias Reales para Captación de Nodos LAMDA
 * Sistema LAMDA — Consola Comercial & CRM WhatsApp
 *
 * Provee:
 *  1. Base de conocimiento real y precisa del Modelo de Nodos (propuesta llave en mano, cero inversión en stock,
 *     espíritu de equipo defensa/goleador, compra sin fricción, esquema híbrido del Panel de Gestor).
 *  2. Consulta cacheada (5 min) de tiendas reales activas en `public.nodos_maestro` usando SIEMPRE el dominio
 *     público oficial `https://tienda.lamdaser.com/tienda/<slug>` (JAMÁS `logistica.lamdaser.com`).
 *  3. Detector determinista del contexto del hilo (mensajes, nombres de adjuntos PDF y reuniones pendientes)
 *     vs. señal mayorista entrante inequívoca (pedidos, cobranza/comprobantes, logística, reclamos).
 *  4. Formateador determinista de Burbuja 2 (`LINK_DEMO_NODO`) por perfil (VECINOS / REDES / LOCALES).
 */

const pool = require('../usuarios/pool');

const DOMINIO_TIENDA_NODOS_OFICIAL = 'https://tienda.lamdaser.com';

const ETAPAS_CAPTACION_NODO = {
    INVITACION_INICIAL: { id: 'INVITACION_INICIAL', label: '👋 Invitación', corto: 'Invitación', prioridad: 3 },
    PROPUESTA_ENVIADA: { id: 'PROPUESTA_ENVIADA', label: '📄 Propuesta enviada', corto: 'Propuesta enviada', prioridad: 2 },
    REUNION_A_COORDINAR: { id: 'REUNION_A_COORDINAR', label: '📅 Reunión a coordinar', corto: 'Reunión a coordinar', prioridad: 1 },
    REUNION_AGENDADA: { id: 'REUNION_AGENDADA', label: '🤝 Reunión agendada', corto: 'Reunión agendada', prioridad: 1 },
    EN_EVALUACION: { id: 'EN_EVALUACION', label: '🧐 En evaluación', corto: 'En evaluación', prioridad: 2 },
    PAUSADO: { id: 'PAUSADO', label: '⏸️ Pausado', corto: 'Pausado', prioridad: 5 },
    ACTIVO_COMO_NODO: { id: 'ACTIVO_COMO_NODO', label: '✅ Nodo activo', corto: 'Nodo activo', prioridad: 6 }
};

const ETAPAS_CAPTACION_VALIDAS = new Set(Object.keys(ETAPAS_CAPTACION_NODO));
const FRENTES_ACTIVOS_VALIDOS = new Set(['AUTO', 'NODOS', 'MAYORISTA']);
const PERFILES_NODO_VALIDOS = new Set(['VECINOS', 'REDES', 'LOCALES']);

const REFERENCIAS_NODOS_FALLBACK = [
    {
        id: 1,
        codigo_nodo: 'NODO-001',
        slug: 'paraiso',
        nombre_marca: 'Paraíso',
        subtitulo_marca: 'Alimentos saludables',
        perfil_operativo: 'VECINOS',
        perfil_label: 'Barrio / Vecinos',
        barrio_zona: 'Barrio Paraíso',
        url_tienda: `${DOMINIO_TIENDA_NODOS_OFICIAL}/tienda/paraiso`,
        tiene_video_bienvenida: true
    },
    {
        id: 2,
        codigo_nodo: 'NODO-002',
        slug: 'manso',
        nombre_marca: 'MANSO',
        subtitulo_marca: 'Frutos Secos · Snacks · Boxes',
        perfil_operativo: 'REDES',
        perfil_label: 'Redes / Contactos',
        barrio_zona: 'Martinez',
        url_tienda: `${DOMINIO_TIENDA_NODOS_OFICIAL}/tienda/manso`,
        tiene_video_bienvenida: true
    },
    {
        id: 3,
        codigo_nodo: 'NODO-003',
        slug: 'moro',
        nombre_marca: 'MORO',
        subtitulo_marca: 'Almacén de Bebidas',
        perfil_operativo: 'LOCALES',
        perfil_label: 'Comercios / Locales',
        barrio_zona: 'Centro, La Plata',
        url_tienda: `${DOMINIO_TIENDA_NODOS_OFICIAL}/tienda/moro`,
        tiene_video_bienvenida: true
    }
];

const PERFIL_LABELS = {
    VECINOS: 'Barrio / Vecinos',
    REDES: 'Redes / Contactos',
    LOCALES: 'Comercios / Locales'
};

let _cacheReferenciasNodos = null;
let _cacheReferenciasNodosTs = 0;
const CACHE_REFERENCIAS_TTL_MS = 5 * 60 * 1000;

function normalizarTextoNodos(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function construirUrlPublicaTiendaNodo(slug) {
    const cleanSlug = String(slug || '').trim().replace(/^\/+|\/+$/g, '');
    if (!cleanSlug) return `${DOMINIO_TIENDA_NODOS_OFICIAL}/tienda/paraiso`;
    return `${DOMINIO_TIENDA_NODOS_OFICIAL}/tienda/${encodeURIComponent(cleanSlug)}`;
}

async function obtenerReferenciasNodosActivos({ forceRefresh = false } = {}) {
    const ahora = Date.now();
    if (!forceRefresh && _cacheReferenciasNodos && (ahora - _cacheReferenciasNodosTs) < CACHE_REFERENCIAS_TTL_MS) {
        return _cacheReferenciasNodos;
    }
    try {
        const res = await pool.query(`
            SELECT id, codigo_nodo, slug, nombre_marca, subtitulo_marca,
                   perfil_operativo, barrio_zona, bunker_cliente_id, cliente_madre_bunker_id,
                   gestor_nombre, gestor_telefono, margen_gestor_default_pct,
                   (config_video_bienvenida IS NOT NULL AND COALESCE((config_video_bienvenida->>'activo')::boolean, false)) AS tiene_video_bienvenida
            FROM public.nodos_maestro
            WHERE activo = true
            ORDER BY id ASC
        `);
        const rows = Array.isArray(res.rows) && res.rows.length > 0
            ? res.rows.map(r => {
                const perfil = String(r.perfil_operativo || 'VECINOS').trim().toUpperCase();
                return {
                    id: Number(r.id),
                    codigo_nodo: r.codigo_nodo || '',
                    slug: String(r.slug || '').trim(),
                    nombre_marca: String(r.nombre_marca || '').trim(),
                    subtitulo_marca: String(r.subtitulo_marca || '').trim(),
                    perfil_operativo: PERFILES_NODO_VALIDOS.has(perfil) ? perfil : 'VECINOS',
                    perfil_label: PERFIL_LABELS[perfil] || 'Barrio / Vecinos',
                    barrio_zona: String(r.barrio_zona || '').trim(),
                    bunker_cliente_id: r.bunker_cliente_id ? Number(r.bunker_cliente_id) : null,
                    cliente_madre_bunker_id: r.cliente_madre_bunker_id ? Number(r.cliente_madre_bunker_id) : null,
                    gestor_nombre: String(r.gestor_nombre || '').trim(),
                    gestor_telefono: String(r.gestor_telefono || '').replace(/\D/g, ''),
                    margen_gestor_default_pct: Number(r.margen_gestor_default_pct || 28),
                    tiene_video_bienvenida: Boolean(r.tiene_video_bienvenida),
                    url_tienda: construirUrlPublicaTiendaNodo(r.slug)
                };
            })
            : REFERENCIAS_NODOS_FALLBACK.slice();

        _cacheReferenciasNodos = rows;
        _cacheReferenciasNodosTs = ahora;
        return rows;
    } catch (_) {
        return REFERENCIAS_NODOS_FALLBACK.slice();
    }
}

async function buscarNodoExistenteDeContacto({ bunkerClienteId = null, telefonoNormalizado = '' } = {}) {
    const refs = await obtenerReferenciasNodosActivos();
    const bId = Number(bunkerClienteId || 0);
    const telDig = String(telefonoNormalizado || '').replace(/\D/g, '');
    const cola8 = telDig.length >= 8 ? telDig.slice(-8) : '';

    return refs.find(n => {
        if (bId > 0 && (Number(n.bunker_cliente_id) === bId || Number(n.cliente_madre_bunker_id) === bId)) {
            return true;
        }
        if (cola8 && n.gestor_telefono && n.gestor_telefono.slice(-8) === cola8) {
            return true;
        }
        return false;
    }) || null;
}

/**
 * Formateador determinista de Burbuja 2 para compartir una tienda ejemplo de Nodo.
 * Usa SIEMPRE https://tienda.lamdaser.com/tienda/<slug> + aclaración natural sobre chusmear
 * sin confirmar pedido y precios con margen minorista de ese nodo.
 */
function formatearBurbuja2DemoNodo({ perfil = 'VECINOS', slug = '', nodosReferencia = null } = {}) {
    const lista = Array.isArray(nodosReferencia) && nodosReferencia.length > 0
        ? nodosReferencia
        : REFERENCIAS_NODOS_FALLBACK;

    const slugNorm = String(slug || '').trim().toLowerCase();
    const perfilNorm = String(perfil || '').trim().toUpperCase();

    let elegido = null;
    if (slugNorm) {
        elegido = lista.find(n => String(n.slug || '').toLowerCase() === slugNorm) || null;
    }
    if (!elegido && PERFILES_NODO_VALIDOS.has(perfilNorm)) {
        elegido = lista.find(n => String(n.perfil_operativo || '').toUpperCase() === perfilNorm) || null;
    }
    if (!elegido) {
        elegido = lista[0] || REFERENCIAS_NODOS_FALLBACK[0];
    }

    const url = construirUrlPublicaTiendaNodo(elegido.slug);
    const perfilTxt = PERFIL_LABELS[elegido.perfil_operativo] || elegido.perfil_label || 'Nodo';
    const nombre = elegido.nombre_marca || elegido.slug;

    return [
        `Te dejo un ejemplo en vivo de cómo queda una tienda de Nodo (${perfilTxt} — *${nombre}*):`,
        url,
        `Podés chusmearla tranquilo desde el celu y probar el carrito sin confirmar el pedido al final. Tené en cuenta que los precios que figuran ahí ya tienen cargado el margen minorista que definió ese nodo.`
    ].join('\n');
}

/**
 * Bloque de conocimiento real del Modelo de Nodos de LAMDA para inyectar únicamente
 * cuando actúan los especialistas NODOS_RESPUESTA o NODOS_SEGUIMIENTO.
 */
function construirBloqueConocimientoModeloNodos(nodosReferencia = null) {
    const lista = Array.isArray(nodosReferencia) && nodosReferencia.length > 0
        ? nodosReferencia
        : REFERENCIAS_NODOS_FALLBACK;
    const ejemplosTxt = lista
        .slice(0, 4)
        .map(n => `  * ${n.nombre_marca} (${n.perfil_label || n.perfil_operativo}): ${construirUrlPublicaTiendaNodo(n.slug)}`)
        .join('\n');

    return [
        'CONOCIMIENTO REAL DEL MODELO DE NODOS COMERCIALES DE LAMDA ("bajo la manga"):',
        '1. PROPUESTA CENTRAL: Tienda online llave en mano con marca, logo y colores propios del referente, adaptable a 3 perfiles reales: barrio/vecinos (como Paraíso), redes/contactos (como MANSO) o comercios/locales (como MORO).',
        '2. CERO INVERSIÓN INICIAL EN STOCK Y ESPÍRITU DE EQUIPO: LAMDA juega "en la defensa" (pone el capital en mercadería, el fraccionado en planta, paquetes y bolsas rotulados con etiqueta térmica con la marca del nodo, entrega consolidada semanal y asistencia constante) y el referente juega "de goleador" arriba moviendo su marca y atendiendo a su gente. MUY IMPORTANTE: que la marca del nodo vaya al frente NO significa que LAMDA se esconda (aparece tienda.lamdaser.com en el dominio y nuestro respaldo operativo/cobros/depósito); el espíritu real es formar equipo.',
        '3. COMPRA SIN FRICCIÓN PARA EL CLIENTE FINAL: El comprador entra al link desde el celular, arma su carrito y confirma solo con nombre, teléfono y modalidad de entrega, sin contraseñas ni registros largos (el navegador lo recuerda solo para próximas compras).',
        '4. ESQUEMA HÍBRIDO DEL PANEL DE GESTOR: El referente maneja 100% su día a día comercial desde su panel (prende/apaga productos, ve su costo base de depósito en vivo y define libremente su margen de ganancia, sube fotos y videos propios, configura su perfil/WhatsApp/Instagram y usa su Kit de Difusión y Radar). La estética estructural profunda se define en conjunto con LAMDA, y cuando el nodo propone combos o presentaciones nuevas, primero pasan por aprobación y cotización base de LAMDA antes de publicarse.',
        '5. TIENDAS DE REFERENCIA REALES (SIEMPRE dominio oficial https://tienda.lamdaser.com/tienda/<slug>, JAMÁS logistica.lamdaser.com):',
        ejemplosTxt
    ].join('\n');
}

/**
 * Señal rápida de texto/adjunto para auto-clasificación en crmWhatsappDbService
 * (contactos externos sin ficha Búnker -> PROSPECTO_NODO).
 */
function esTextoSenalNodosParaCategoria(cuerpo = '', mediaFilename = '') {
    const fn = normalizarTextoNodos(mediaFilename);
    if (/(proyecto.*nodo|propuesta.*nodo|nodo.*lamda|nodos.*comercial)/i.test(fn)) {
        return true;
    }
    const c = normalizarTextoNodos(cuerpo);
    if (!c) return false;
    if (/tienda\.lamdaser\.com\/tienda\//i.test(c)) return true;
    if (/\b(proyecto\s+(de\s+)?nodos?|nodos?\s+(de\s+venta|comercial(es)?|barrial(es)?|vecinal(es)?|lamda)|propuesta\s+(ejecutiva\s+)?.*nodos?|modelo\s+de\s+nodos?|sistema\s+de\s+nodos?|esquema\s+de\s+nodos?|red\s+de\s+nodos?|panel\s+(de|del)\s+gestor|kit\s+de\s+difusion|sumar(me|se|te)?\s+(como\s+|a\s+)?(un\s+)?nodo\b|ser\s+(un\s+)?nodo\b|armar\s+(tu|un|mi)\s+nodo\b|por\s+(el\s+tema\s+de\s+|lo\s+de\s+)?(los\s+)?nodos?\b)\b/i.test(c)) {
        return true;
    }
    return false;
}

/**
 * Detecta si en la ráfaga entrante más reciente (mensajes del cliente posteriores al último de Martín)
 * hay una operación mayorista inequívoca (comprobante de pago, reclamo de mercadería/factura,
 * consulta de entrega/camión o pedido explícito de kilos/precios).
 * Evita falsos positivos cuando un prospecto pregunta sobre el modelo de Nodos (costos base, márgenes, bolsas, web).
 */
function detectarSenalMayoristaEntranteReciente({ mensajesRecientes = [], comprobanteLeido = null } = {}) {
    if (comprobanteLeido && comprobanteLeido.es_comprobante_pago) {
        return {
            esMayorista: true,
            agenteSugerido: 'COBRANZA_COMPROBANTES',
            motivo: 'Comprobante de pago leído por visión'
        };
    }

    const arr = Array.isArray(mensajesRecientes) ? mensajesRecientes : [];
    if (arr.length === 0) {
        return { esMayorista: false, agenteSugerido: null, motivo: '' };
    }

    // Tomar únicamente la última ráfaga entrante del interlocutor (después del último mensaje de Martín)
    const rafagaEntrante = [];
    for (let i = arr.length - 1; i >= 0; i--) {
        const m = arr[i];
        if (!m) continue;
        if (m.from_me) break;
        rafagaEntrante.unshift(m);
        if (rafagaEntrante.length >= 4) break;
    }
    if (rafagaEntrante.length === 0) {
        return { esMayorista: false, agenteSugerido: null, motivo: '' };
    }

    const txtRafaga = normalizarTextoNodos(
        rafagaEntrante.map(m => `${m.cuerpo || ''} ${m.media_filename || ''}`).join(' ')
    );
    if (!txtRafaga) {
        return { esMayorista: false, agenteSugerido: null, motivo: '' };
    }

    const hablaExplicitamenteDeNodosEnRafaga = /\b(nodo|nodos|tienda\s+online|tienda\s+propia|mi\s+marca|etiqueta\s+termica|margen|costo\s+base|panel\s+de\s+gestor|sin\s+clave|sin\s+contrasena|diseno\s+web|proyecto\s+nodos|reunion|juntarnos)\b/i.test(txtRafaga);

    // 1. Reclamo concreto de mercadería o factura
    if (/\b(vino\s+(roto|mal|fe[oa]|vencid)|hongos?|bichos?|me\s+falt[oó]\b|faltaron\s+\d|nota\s+de\s+credito|diferencia\s+en\s+la\s+factura|me\s+cobraron\s+de\s+mas|devolucion\s+de\s+mercaderia)\b/i.test(txtRafaga)) {
        return {
            esMayorista: true,
            agenteSugerido: 'RECLAMO_DEVOLUCION',
            motivo: 'Reclamo concreto de mercadería o facturación en último mensaje'
        };
    }

    // 2. Comprobante / aviso de pago / consulta de deuda propia (no preguntas genéricas sobre cómo cobra un nodo)
    const esConsultaCobroNodo = hablaExplicitamenteDeNodosEnRafaga && /\b(como\s+cobra|como\s+son\s+los\s+cobros|como\s+me\s+pagan|liquidacion\s+del\s+nodo)\b/i.test(txtRafaga);
    if (!esConsultaCobroNodo && /\b(te\s+transferi|ya\s+transferi|te\s+pase\s+el\s+pago|ya\s+pague|adjunto\s+comprobante|te\s+mando\s+(el\s+)?comprobante|comprobante\s+de\s+(pago|transferencia)|pasame\s+(el\s+)?(cbu|alias)|cuanto\s+(te\s+)?debo|mi\s+saldo|resumen\s+de\s+cuenta|cuenta\s+corriente|transferencia\s+realizada)\b/i.test(txtRafaga)) {
        return {
            esMayorista: true,
            agenteSugerido: 'COBRANZA_COMPROBANTES',
            motivo: 'Aviso de pago, comprobante o consulta de saldo en último mensaje'
        };
    }

    // 3. Logística / seguimiento de pedido mayorista en curso
    if (/\b(cuando\s+llega\s+(el\s+pedido|el\s+camion|mi\s+pedido|la\s+mercaderia)|a\s+que\s+hora\s+pasa\s+el\s+(camion|chofer|reparto)|salio\s+(el|mi)\s+pedido|estado\s+de\s+(mi|el)\s+pedido|pasan\s+hoy\s+con\s+el\s+pedido|hoja\s+de\s+ruta)\b/i.test(txtRafaga)) {
        return {
            esMayorista: true,
            agenteSugerido: 'LOGISTICA_ENTREGAS',
            motivo: 'Consulta de entrega/reparto mayorista en último mensaje'
        };
    }

    // 4. Pedido explícito de mercadería o cotización mayorista de productos
    const tieneCantidadYProducto = /\b\d+(?:[.,]\d+)?\s*(kg|kilos?|k\b|bolsas?|cajas?|bultos?|packs?|unidades?)\s+(de\s+)?[a-z]{3,}/i.test(txtRafaga);
    const tienePedidoExplicito = /\b(te\s+paso\s+(el\s+|un\s+)?pedido|anotame\s+(este\s+|un\s+)?pedido|mandame\s+\d|necesito\s+pedir|quiero\s+hacer\s+(un\s+)?pedido|pasame\s+(la\s+)?lista\s+de\s+precios|cuanto\s+(esta|sale)\s+el\s+(kg|kilo|bulto)\s+de|necesito\s+\d+\s*(kg|kilos?|bolsas?|cajas?|bultos?))\b/i.test(txtRafaga);

    if (tieneCantidadYProducto || (tienePedidoExplicito && !hablaExplicitamenteDeNodosEnRafaga)) {
        return {
            esMayorista: true,
            agenteSugerido: 'VENTAS_COTIZADOR',
            motivo: 'Pedido o cotización mayorista explícita en último mensaje'
        };
    }

    return { esMayorista: false, agenteSugerido: null, motivo: '' };
}

/**
 * Detector determinista del contexto de Captación de Nodos y reuniones pendientes en un hilo.
 */
function detectarContextoHiloNodosWa({
    mensajesRecientes = [],
    categoriaContacto = '',
    frenteActivo = 'AUTO',
    nodoCaptacionJson = null,
    comprobanteLeido = null,
    clienteNombre = '',
    contactoNombre = '',
    bunkerClienteId = null
} = {}) {
    const arr = Array.isArray(mensajesRecientes) ? mensajesRecientes : [];
    const ventana = arr.slice(-14);
    const catNorm = String(categoriaContacto || '').trim().toUpperCase();
    const frenteNorm = String(frenteActivo || 'AUTO').trim().toUpperCase();
    const nodoJson = (nodoCaptacionJson && typeof nodoCaptacionJson === 'object') ? nodoCaptacionJson : {};

    const evidencias = [];
    let senalFuerteNodos = false;
    let senalPropuestaPdf = false;
    let senalProyectoNuevo = false;
    let senalReunionPendiente = false;
    let senalReunionAgendada = false;
    let pideVerEjemplo = false;
    let perfilInferido = String(nodoJson.perfil_sugerido || '').trim().toUpperCase();
    if (!PERFILES_NODO_VALIDOS.has(perfilInferido)) perfilInferido = '';

    for (let i = 0; i < ventana.length; i++) {
        const m = ventana[i];
        if (!m) continue;
        const cuerpoNorm = normalizarTextoNodos(m.cuerpo || '');
        const fnNorm = normalizarTextoNodos(m.media_filename || '');
        const comb = `${cuerpoNorm} ${fnNorm}`.trim();
        if (!comb) continue;

        const esReciente6 = i >= Math.max(0, ventana.length - 6);

        if (/(proyecto.*nodo|propuesta.*nodo|nodo.*lamda)/i.test(fnNorm)) {
            senalFuerteNodos = true;
            senalPropuestaPdf = true;
            evidencias.push(`Adjunto: ${m.media_filename}`);
        }
        if (esTextoSenalNodosParaCategoria(cuerpoNorm, fnNorm)) {
            senalFuerteNodos = true;
            evidencias.push('Mención explícita al Proyecto / Modelo de Nodos');
        }
        if (/\b(proyecto\s+nuevo)\b/i.test(cuerpoNorm) && /\b(contarte|juntarnos|charlar|paso\s+y\s+te\s+cuento|local|desarrollo|aplicacion)\b/i.test(cuerpoNorm)) {
            senalProyectoNuevo = true;
            evidencias.push('Invitación a conversar sobre proyecto nuevo');
        }
        if (esReciente6 && /\b(horarios?\s+para\s+juntarnos|juntarnos\s+(la\s+semana|esta\s+semana)|fijamos\s+(un\s+)?dia\s+y\s+horario|coordinamos\s+para\s+la\s+semana|coordinamos\s+y\s+nos\s+juntamos|cuando\s+estes\s+de\s+vuelta\s+y\s+coordinamos|avisame\s+que\s+dia\s+y\s+horario|vuelvo\s+.*lunes.*arreglamos|puedo\s+llamarte\s+el\s+lunes|ver\s+como\s+funciona\s+en\s+vivo|un\s+rato\s+para\s+juntarnos|reunion\s+.*nodo|coordinar\s+(una\s+)?reunion)\b/i.test(cuerpoNorm)) {
            senalReunionPendiente = true;
            evidencias.push('Coordinación de reunión pendiente en los últimos mensajes');
        }
        if (esReciente6 && /\b(nos\s+vemos\s+el\s+(lunes|martes|miercoles|jueves|viernes|sabado)|quedamos\s+el\s+(lunes|martes|miercoles|jueves|viernes|sabado)|agendado\s+para\s+el)\b/i.test(cuerpoNorm)) {
            senalReunionAgendada = true;
        }
        if (esReciente6 && !m.from_me && /\b(como\s+funciona|como\s+es\s+la\s+(web|tienda|pagina)|tenes\s+(algun\s+)?(link|ejemplo|demo)|link\s+de\s+ejemplo|puedo\s+ver\s+(una|como\s+queda|el\s+catalogo|la\s+tienda)|para\s+ver\s+como\s+queda|chusmear\s+(una|alguna|como\s+queda)|mostrame|pasame\s+(el\s+)?link\s+de\s+(una\s+)?tienda)\b/i.test(cuerpoNorm)) {
            pideVerEjemplo = true;
        }

        // Inferir perfil de Nodo si no estaba definido
        if (!perfilInferido) {
            if (/\b(local|mostrador|comercio|casa\s+dionisio|almacen|dietetica|feria|negocio|vinoteca|bebidas)\b/i.test(comb)) {
                perfilInferido = 'LOCALES';
            } else if (/\b(instagram|redes|seguidores|tiktok|envios?\s+por\s+correo|encomienda|influencer)\b/i.test(comb)) {
                perfilInferido = 'REDES';
            } else if (/\b(barrio|vecinos|country|barrio\s+cerrado|grupo\s+de\s+vecinos|edificio)\b/i.test(comb)) {
                perfilInferido = 'VECINOS';
            }
        }
    }

    // También inferir perfil LOCALES si es cliente con nombre de local/comercio
    if (!perfilInferido) {
        const nomComb = normalizarTextoNodos(`${clienteNombre} ${contactoNombre}`);
        if (/\b(casa\s+dionisio|local|dietetica|almacen|mercado|tienda|vinoteca|panaderia|verduleria)\b/i.test(nomComb)) {
            perfilInferido = 'LOCALES';
        }
    }

    const senalMayoristaEntrante = detectarSenalMayoristaEntranteReciente({
        mensajesRecientes: ventana,
        comprobanteLeido
    });

    // Determinar si hay vínculo/seguimiento de Nodos (para badge, solapa 🌐 Nodos y detección)
    const marcadoExplicitoNodos = (
        frenteNorm === 'NODOS'
        || catNorm === 'PROSPECTO_NODO'
        || Boolean(nodoJson.activo)
    );
    const bloqueadoManualMayorista = frenteNorm === 'MAYORISTA';

    // Detección automática del hilo: señal fuerte de Nodos O proyecto nuevo O reunión pendiente explícita sin contexto logístico/entrega
    const detectadoAutoPorHilo = !bloqueadoManualMayorista && (
        senalFuerteNodos
        || senalProyectoNuevo
        || (senalReunionPendiente && !senalMayoristaEntrante.esMayorista)
    );

    const enSeguimientoNodos = Boolean(
        !bloqueadoManualMayorista && (marcadoExplicitoNodos || detectadoAutoPorHilo)
    );

    // ¿Debe activarse el especialista Nodos en modo AUTO?
    // Regla de convivencia: si el cliente actual (o contacto) mandó en su ÚLTIMO mensaje entrante
    // una señal mayorista inequívoca (pedido/comprobante/reclamo/camión), atiende eso en modo mayorista
    // SIN borrar el estado de seguimiento Nodos.
    const ultimoMsg = ventana.length > 0 ? ventana[ventana.length - 1] : null;
    const ultimoEsEntrante = Boolean(ultimoMsg && !ultimoMsg.from_me);
    const cedeAMayoristaPorUltimoEntrante = Boolean(
        ultimoEsEntrante
        && senalMayoristaEntrante.esMayorista
        && Boolean(bunkerClienteId)
    );

    const esFrenteNodos = Boolean(
        enSeguimientoNodos && !cedeAMayoristaPorUltimoEntrante
    );

    // Inferir etapa si no hay una fijada manualmente
    let etapaInferida = String(nodoJson.etapa || '').trim().toUpperCase();
    if (!ETAPAS_CAPTACION_VALIDAS.has(etapaInferida)) {
        if (senalReunionAgendada) {
            etapaInferida = 'REUNION_AGENDADA';
        } else if (senalReunionPendiente) {
            etapaInferida = 'REUNION_A_COORDINAR';
        } else if (senalPropuestaPdf) {
            etapaInferida = 'PROPUESTA_ENVIADA';
        } else if (pideVerEjemplo) {
            etapaInferida = 'EN_EVALUACION';
        } else {
            etapaInferida = 'INVITACION_INICIAL';
        }
    }

    let motivoDeteccion = '';
    if (frenteNorm === 'NODOS') {
        motivoDeteccion = 'Modo Captación Nodo activado manualmente';
    } else if (catNorm === 'PROSPECTO_NODO') {
        motivoDeteccion = 'Contacto clasificado como Prospecto Nodo';
    } else if (evidencias.length > 0) {
        motivoDeteccion = Array.from(new Set(evidencias)).slice(0, 2).join(' · ');
    } else if (nodoJson.activo) {
        motivoDeteccion = `Seguimiento Nodo activo (${ETAPAS_CAPTACION_NODO[etapaInferida]?.corto || etapaInferida})`;
    }

    return {
        esFrenteNodos,
        enSeguimientoNodos,
        detectadoAutoPorHilo,
        cedeAMayoristaPorUltimoEntrante,
        motivoDeteccion,
        etapaInferida,
        etapaMeta: ETAPAS_CAPTACION_NODO[etapaInferida] || ETAPAS_CAPTACION_NODO.INVITACION_INICIAL,
        perfilInferido: perfilInferido || (bunkerClienteId ? 'LOCALES' : 'VECINOS'),
        pideVerEjemplo,
        senalPropuestaPdf,
        senalReunionPendiente,
        senalMayoristaEntrante,
        evidencias: Array.from(new Set(evidencias))
    };
}

module.exports = {
    DOMINIO_TIENDA_NODOS_OFICIAL,
    ETAPAS_CAPTACION_NODO,
    ETAPAS_CAPTACION_VALIDAS,
    FRENTES_ACTIVOS_VALIDOS,
    PERFILES_NODO_VALIDOS,
    REFERENCIAS_NODOS_FALLBACK,
    normalizarTextoNodos,
    construirUrlPublicaTiendaNodo,
    obtenerReferenciasNodosActivos,
    buscarNodoExistenteDeContacto,
    formatearBurbuja2DemoNodo,
    construirBloqueConocimientoModeloNodos,
    esTextoSenalNodosParaCategoria,
    detectarSenalMayoristaEntranteReciente,
    detectarContextoHiloNodosWa
};
