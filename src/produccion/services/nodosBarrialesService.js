/**
 * ============================================================================
 * SERVICIO INTEGRAL: NODOS BARRIALES (MARCA BLANCA) - ETAPA 1
 * ============================================================================
 * Conecta el padrón exclusivo de Nodos Barriales, el ABM de Nodos (con logo
 * térmico ZPL ^GFA y vínculo contable a bunker_clientes / factura_cuentas_corrientes /
 * fin_cuentas_bancarias) y el Cotizador de Propuestas de Fracciones directamente
 * con los 6 Flujos de Costos de la Pizarra Inteligente LAMDA.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const {
    convertirLogoAZplGfa,
    generarEtiquetaZplParNodo,
    generarPreviewVisualEtiquetaPar,
    generarPreviewVisualCanastoQrMaestro,
    generarEtiquetaZplParFulfillment,
    generarPreviewVisualEtiquetaFulfillment
} = require('../utils/zplLogoConverter');
const paqueteriaService = require('./paqueteriaFulfillmentService');
const {
    construirCatalogoIngredientesComerciales,
    obtenerDesgloseIngredientesParaItem
} = require('./desgloseIngredientesComercialService');
const {
    agregarReferenciaNodoADescripcion,
    obtenerOCrearCuentaPrincipalBunker
} = require('../../shared/nodosCuentaUnificadaHelper');
const {
    asegurarEsquemaAnaliticaNodos,
    vincularVisitanteConVecino
} = require('./nodosAnaliticaService');
const pagosBancariosService = require('./nodosPagosBancariosService');
const recibosMarcaBlancaService = require('./nodosRecibosMarcaBlancaService');
const {
    normalizarArrayVideosBd,
    normalizarModoPortada,
    construirGaleriaYPortadaOferta
} = require('./nodosFotosService');

function normalizarModoVidrieraTienda(raw) {
    const val = String(raw || '').trim().toUpperCase();
    if (val === 'CUADRICULA' || val === 'LISTA_COMPACTA' || val === 'PORTADAS') {
        return val;
    }
    return 'PORTADAS';
}

let esquemaInicializado = false;

const _geoCacheBusquedaAr = new Map();
const _geoCacheInversaAr = new Map();
const GEO_CACHE_TTL_MS = 15 * 60 * 1000;
const GEO_CACHE_MAX_ENTRIES = 250;
let _ultimoHitNominatimMs = 0;

function esModoLaboratorioNodos() {
    return String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase() === 'true'
        && String(process.env.DB_NAME || '').trim() === 'etiquetas_pruebas';
}

const PROVINCIAS_ARGENTINA_CANONICAS = [
    { codigo: 'AR-C', nombre: 'Ciudad Autónoma de Buenos Aires' },
    { codigo: 'AR-B', nombre: 'Buenos Aires' },
    { codigo: 'AR-K', nombre: 'Catamarca' },
    { codigo: 'AR-H', nombre: 'Chaco' },
    { codigo: 'AR-U', nombre: 'Chubut' },
    { codigo: 'AR-X', nombre: 'Córdoba' },
    { codigo: 'AR-W', nombre: 'Corrientes' },
    { codigo: 'AR-E', nombre: 'Entre Ríos' },
    { codigo: 'AR-P', nombre: 'Formosa' },
    { codigo: 'AR-Y', nombre: 'Jujuy' },
    { codigo: 'AR-L', nombre: 'La Pampa' },
    { codigo: 'AR-F', nombre: 'La Rioja' },
    { codigo: 'AR-M', nombre: 'Mendoza' },
    { codigo: 'AR-N', nombre: 'Misiones' },
    { codigo: 'AR-Q', nombre: 'Neuquén' },
    { codigo: 'AR-R', nombre: 'Río Negro' },
    { codigo: 'AR-A', nombre: 'Salta' },
    { codigo: 'AR-J', nombre: 'San Juan' },
    { codigo: 'AR-D', nombre: 'San Luis' },
    { codigo: 'AR-Z', nombre: 'Santa Cruz' },
    { codigo: 'AR-S', nombre: 'Santa Fe' },
    { codigo: 'AR-G', nombre: 'Santiago del Estero' },
    { codigo: 'AR-V', nombre: 'Tierra del Fuego' },
    { codigo: 'AR-T', nombre: 'Tucumán' }
];

function normalizarPerfilOperativoNodo(raw) {
    const val = String(raw || '').trim().toLowerCase();
    if (val === 'ecommerce_fulfillment' || val === 'creador_online' || val === 'fulfillment_lamda') {
        return 'ecommerce_fulfillment';
    }
    return 'vecinal';
}

function obtenerPresetModulosActivos(perfilRaw = 'vecinal') {
    const perfil = normalizarPerfilOperativoNodo(perfilRaw);
    if (perfil === 'ecommerce_fulfillment') {
        return {
            retiro_punto: false,
            reparto_zonal: false,
            hoja_de_ruta: false,
            envio_paqueteria: true,
            venta_continua_24_7: true,
            despacho_desde_lamda: true,
            canasto_consolidado: false,
            cobro_efectivo_entrega: false
        };
    }
    return {
        retiro_punto: true,
        reparto_zonal: true,
        hoja_de_ruta: true,
        envio_paqueteria: false,
        venta_continua_24_7: false,
        despacho_desde_lamda: false,
        canasto_consolidado: true,
        cobro_efectivo_entrega: true
    };
}

function resolverModulosActivosNodo(nodoLike = {}, overridesRaw = null) {
    const perfil = normalizarPerfilOperativoNodo(nodoLike?.perfil_operativo);
    const preset = obtenerPresetModulosActivos(perfil);
    const guardados = (nodoLike?.modulos_activos && typeof nodoLike.modulos_activos === 'object' && !Array.isArray(nodoLike.modulos_activos))
        ? nodoLike.modulos_activos
        : {};
    const overrides = (overridesRaw && typeof overridesRaw === 'object' && !Array.isArray(overridesRaw))
        ? overridesRaw
        : {};

    const tieneGuardados = Object.keys(guardados).length > 0;
    const baseLegacy = {};
    if (!tieneGuardados && nodoLike && typeof nodoLike === 'object') {
        if (nodoLike.permitir_retiro_nodo !== undefined) baseLegacy.retiro_punto = Boolean(nodoLike.permitir_retiro_nodo);
        if (nodoLike.permitir_reparto_propio !== undefined || nodoLike.permitir_envio_barrial !== undefined) {
            baseLegacy.reparto_zonal = Boolean(nodoLike.permitir_reparto_propio ?? nodoLike.permitir_envio_barrial);
        }
        if (nodoLike.permitir_encomienda !== undefined && perfil === 'vecinal') {
            baseLegacy.envio_paqueteria = Boolean(nodoLike.permitir_encomienda);
        }
    }

    const merged = {
        ...preset,
        ...baseLegacy,
        ...guardados,
        ...(nodoLike && nodoLike.cobro_efectivo_entrega !== undefined && nodoLike.cobro_efectivo_entrega !== null
            ? { cobro_efectivo_entrega: Boolean(nodoLike.cobro_efectivo_entrega) }
            : {}),
        ...overrides
    };

    const resultado = {};
    for (const k of Object.keys(preset)) {
        resultado[k] = Boolean(merged[k]);
    }
    return resultado;
}

function obtenerConfigPaqueteriaDefault() {
    return {
        operadores_habilitados: ['CORREO_ARGENTINO', 'ANDREANI'],
        operador_default: 'CORREO_ARGENTINO',
        permitir_domicilio: true,
        permitir_sucursal_correo: true,
        permitir_editar_gestor: true,
        sla_despacho_label: 'Despacho en 24 a 48 hs hábiles',
        envio_gratis_activo: true,
        envio_gratis_desde_monto: 45000,
        tarifario_zonas: [
            {
                codigo: 'AMBA_LA_PLATA',
                nombre: 'CABA, GBA y Gran La Plata',
                cp_prefijos: ['10', '11', '12', '13', '14', '16', '17', '18', '19'],
                domicilio: 6500,
                sucursal: 4800,
                plazo_dias: '2 a 4 días hábiles'
            },
            {
                codigo: 'PBA_CENTRO_LITORAL',
                nombre: 'PBA Interior, Centro y Litoral',
                cp_prefijos: ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '50', '51', '52', '58', '59', '60', '64', '65', '66', '67', '70', '71', '72', '73', '74', '75', '76', '80', '81'],
                domicilio: 8200,
                sucursal: 6100,
                plazo_dias: '3 a 6 días hábiles'
            },
            {
                codigo: 'RESTO_PAIS',
                nombre: 'Cuyo, NOA, NEA y Patagonia',
                cp_prefijos: ['*'],
                domicilio: 10500,
                sucursal: 7900,
                plazo_dias: '4 a 8 días hábiles'
            }
        ],
        remitente_etiqueta: {
            mostrar_marca_creador: true,
            ciudad_origen: 'La Plata, Buenos Aires',
            cp_origen: '1900'
        }
    };
}

function normalizarConfigPaqueteria(raw = {}) {
    const def = obtenerConfigPaqueteriaDefault();
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

    const opsPermitidos = ['CORREO_ARGENTINO', 'ANDREANI'];
    let operadores = Array.isArray(src.operadores_habilitados)
        ? src.operadores_habilitados.map(o => String(o || '').trim().toUpperCase()).filter(o => opsPermitidos.includes(o))
        : def.operadores_habilitados.slice();
    operadores = Array.from(new Set(operadores));
    if (operadores.length === 0) operadores = ['CORREO_ARGENTINO'];

    const opDefCandidato = String(src.operador_default || '').trim().toUpperCase();
    const operadorDefault = operadores.includes(opDefCandidato) ? opDefCandidato : operadores[0];

    let permitirDom = src.permitir_domicilio !== undefined ? Boolean(src.permitir_domicilio) : true;
    let permitirSuc = src.permitir_sucursal_correo !== undefined ? Boolean(src.permitir_sucursal_correo) : true;
    if (!permitirDom && !permitirSuc) permitirDom = true;

    let zonas = Array.isArray(src.tarifario_zonas) && src.tarifario_zonas.length > 0
        ? src.tarifario_zonas.map((z, idx) => ({
            codigo: String(z?.codigo || `ZONA_${idx + 1}`).trim().toUpperCase(),
            nombre: String(z?.nombre || `Zona ${idx + 1}`).trim(),
            cp_prefijos: Array.isArray(z?.cp_prefijos)
                ? z.cp_prefijos.map(p => String(p || '').trim()).filter(Boolean)
                : String(z?.cp_prefijos || '*').split(',').map(p => p.trim()).filter(Boolean),
            domicilio: Math.max(0, Number(z?.domicilio ?? 8000) || 0),
            sucursal: Math.max(0, Number(z?.sucursal ?? 6000) || 0),
            plazo_dias: String(z?.plazo_dias || '3 a 6 días hábiles').trim()
        }))
        : def.tarifario_zonas.map(z => ({ ...z, cp_prefijos: [...z.cp_prefijos] }));

    if (!zonas.some(z => z.cp_prefijos.includes('*'))) {
        zonas.push({ ...def.tarifario_zonas[def.tarifario_zonas.length - 1] });
    }

    const montoGratis = Math.max(0, Number(src.envio_gratis_desde_monto ?? def.envio_gratis_desde_monto) || 0);
    const envioGratisActivo = src.envio_gratis_activo !== undefined
        ? Boolean(src.envio_gratis_activo) && montoGratis > 0
        : (montoGratis > 0);

    return {
        operadores_habilitados: operadores,
        operador_default: operadorDefault,
        permitir_domicilio: permitirDom,
        permitir_sucursal_correo: permitirSuc,
        permitir_editar_gestor: src.permitir_editar_gestor !== false,
        sla_despacho_label: String(src.sla_despacho_label || def.sla_despacho_label).trim() || def.sla_despacho_label,
        envio_gratis_activo: envioGratisActivo,
        envio_gratis_desde_monto: montoGratis,
        tarifario_zonas: zonas,
        remitente_etiqueta: {
            ...def.remitente_etiqueta,
            ...((src.remitente_etiqueta && typeof src.remitente_etiqueta === 'object') ? src.remitente_etiqueta : {})
        }
    };
}

function formatearOperadorPostalLabel(opRaw = '') {
    const op = String(opRaw || '').trim().toUpperCase();
    if (op === 'ANDREANI') return 'Andreani';
    if (op === 'OCA') return 'OCA';
    return 'Correo Argentino';
}

function inferirProvinciaPorCp(cpRaw = '') {
    const digits = String(cpRaw || '').replace(/\D+/g, '');
    if (digits.length !== 4) return null;
    const n = Number(digits);
    const localHints = {
        1629: { localidad: 'Pilar', provincia_codigo: 'AR-B', provincia_nombre: 'Buenos Aires' },
        1667: { localidad: 'Tortuguitas', provincia_codigo: 'AR-B', provincia_nombre: 'Buenos Aires' },
        1896: { localidad: 'City Bell', provincia_codigo: 'AR-B', provincia_nombre: 'Buenos Aires' },
        1900: { localidad: 'La Plata', provincia_codigo: 'AR-B', provincia_nombre: 'Buenos Aires' },
        7130: { localidad: 'Chascomús', provincia_codigo: 'AR-B', provincia_nombre: 'Buenos Aires' },
        7600: { localidad: 'Mar del Plata', provincia_codigo: 'AR-B', provincia_nombre: 'Buenos Aires' },
        8000: { localidad: 'Bahía Blanca', provincia_codigo: 'AR-B', provincia_nombre: 'Buenos Aires' },
        2000: { localidad: 'Rosario', provincia_codigo: 'AR-S', provincia_nombre: 'Santa Fe' },
        3000: { localidad: 'Santa Fe', provincia_codigo: 'AR-S', provincia_nombre: 'Santa Fe' },
        5000: { localidad: 'Córdoba', provincia_codigo: 'AR-X', provincia_nombre: 'Córdoba' },
        5500: { localidad: 'Mendoza', provincia_codigo: 'AR-M', provincia_nombre: 'Mendoza' },
        4000: { localidad: 'San Miguel de Tucumán', provincia_codigo: 'AR-T', provincia_nombre: 'Tucumán' },
        4400: { localidad: 'Salta', provincia_codigo: 'AR-A', provincia_nombre: 'Salta' },
        8300: { localidad: 'Neuquén', provincia_codigo: 'AR-Q', provincia_nombre: 'Neuquén' },
        8400: { localidad: 'San Carlos de Bariloche', provincia_codigo: 'AR-R', provincia_nombre: 'Río Negro' },
        9410: { localidad: 'Ushuaia', provincia_codigo: 'AR-V', provincia_nombre: 'Tierra del Fuego' }
    };
    if (localHints[n]) return { ...localHints[n] };

    if (n >= 1000 && n <= 1499) return { localidad: '', provincia_codigo: 'AR-C', provincia_nombre: 'Ciudad Autónoma de Buenos Aires' };
    if ((n >= 1600 && n <= 1999) || (n >= 2700 && n <= 2999) || (n >= 6000 && n <= 6299) || (n >= 6400 && n <= 8199)) {
        return { localidad: '', provincia_codigo: 'AR-B', provincia_nombre: 'Buenos Aires' };
    }
    if (n >= 2000 && n <= 2699) return { localidad: '', provincia_codigo: 'AR-S', provincia_nombre: 'Santa Fe' };
    if (n >= 3000 && n <= 3099) return { localidad: '', provincia_codigo: 'AR-S', provincia_nombre: 'Santa Fe' };
    if (n >= 3100 && n <= 3299) return { localidad: '', provincia_codigo: 'AR-E', provincia_nombre: 'Entre Ríos' };
    if (n >= 3300 && n <= 3399) return { localidad: '', provincia_codigo: 'AR-N', provincia_nombre: 'Misiones' };
    if (n >= 3400 && n <= 3499) return { localidad: '', provincia_codigo: 'AR-W', provincia_nombre: 'Corrientes' };
    if (n >= 3500 && n <= 3599) return { localidad: '', provincia_codigo: 'AR-H', provincia_nombre: 'Chaco' };
    if (n >= 3600 && n <= 3699) return { localidad: '', provincia_codigo: 'AR-P', provincia_nombre: 'Formosa' };
    if (n >= 4000 && n <= 4199) return { localidad: '', provincia_codigo: 'AR-T', provincia_nombre: 'Tucumán' };
    if (n >= 4200 && n <= 4399) return { localidad: '', provincia_codigo: 'AR-G', provincia_nombre: 'Santiago del Estero' };
    if (n >= 4400 && n <= 4599) return { localidad: '', provincia_codigo: 'AR-A', provincia_nombre: 'Salta' };
    if (n >= 4600 && n <= 4699) return { localidad: '', provincia_codigo: 'AR-Y', provincia_nombre: 'Jujuy' };
    if (n >= 4700 && n <= 4799) return { localidad: '', provincia_codigo: 'AR-K', provincia_nombre: 'Catamarca' };
    if (n >= 5000 && n <= 5299) return { localidad: '', provincia_codigo: 'AR-X', provincia_nombre: 'Córdoba' };
    if (n >= 5300 && n <= 5399) return { localidad: '', provincia_codigo: 'AR-F', provincia_nombre: 'La Rioja' };
    if (n >= 5400 && n <= 5499) return { localidad: '', provincia_codigo: 'AR-J', provincia_nombre: 'San Juan' };
    if (n >= 5500 && n <= 5699) return { localidad: '', provincia_codigo: 'AR-M', provincia_nombre: 'Mendoza' };
    if (n >= 5700 && n <= 5799) return { localidad: '', provincia_codigo: 'AR-D', provincia_nombre: 'San Luis' };
    if (n >= 5800 && n <= 5999) return { localidad: '', provincia_codigo: 'AR-X', provincia_nombre: 'Córdoba' };
    if (n >= 6300 && n <= 6399) return { localidad: '', provincia_codigo: 'AR-L', provincia_nombre: 'La Pampa' };
    if (n >= 8300 && n <= 8399) return { localidad: '', provincia_codigo: 'AR-Q', provincia_nombre: 'Neuquén' };
    if (n >= 8400 && n <= 8599) return { localidad: '', provincia_codigo: 'AR-R', provincia_nombre: 'Río Negro' };
    if (n >= 9000 && n <= 9299) return { localidad: '', provincia_codigo: 'AR-U', provincia_nombre: 'Chubut' };
    if (n >= 9300 && n <= 9399) return { localidad: '', provincia_codigo: 'AR-Z', provincia_nombre: 'Santa Cruz' };
    if (n >= 9400 && n <= 9499) return { localidad: '', provincia_codigo: 'AR-V', provincia_nombre: 'Tierra del Fuego' };
    return { localidad: '', provincia_codigo: 'AR-B', provincia_nombre: 'Buenos Aires' };
}

function cotizarEnvioPostalPorCp(configPaqueteriaRaw = {}, cpRaw = '', subtotalProductos = 0) {
    const cfg = normalizarConfigPaqueteria(configPaqueteriaRaw);
    const digits = String(cpRaw || '').replace(/\D+/g, '');
    if (digits.length !== 4) {
        return {
            ok: false,
            cp_valido: false,
            cp: digits,
            error: 'Ingresá un Código Postal argentino válido de 4 dígitos.'
        };
    }

    const pref2 = digits.slice(0, 2);
    let zonaAplicada = null;
    for (const z of cfg.tarifario_zonas) {
        const prefs = Array.isArray(z.cp_prefijos) ? z.cp_prefijos : [];
        if (prefs.some(p => p !== '*' && digits.startsWith(String(p)))) {
            zonaAplicada = z;
            break;
        }
        if (prefs.includes(pref2)) {
            zonaAplicada = z;
            break;
        }
    }
    if (!zonaAplicada) {
        zonaAplicada = cfg.tarifario_zonas.find(z => (z.cp_prefijos || []).includes('*')) || cfg.tarifario_zonas[cfg.tarifario_zonas.length - 1];
    }

    const sub = Math.max(0, Number(subtotalProductos || 0));
    const calificaEnvioGratis = Boolean(cfg.envio_gratis_activo && cfg.envio_gratis_desde_monto > 0 && sub >= cfg.envio_gratis_desde_monto);
    const costoDomicilioBase = Math.max(0, Number(zonaAplicada?.domicilio || 0));
    const costoSucursalBase = Math.max(0, Number(zonaAplicada?.sucursal || 0));
    const sugerenciaGeo = inferirProvinciaPorCp(digits);

    return {
        ok: true,
        cp_valido: true,
        cp: digits,
        zona_codigo: zonaAplicada?.codigo || 'NACIONAL',
        zona_nombre: zonaAplicada?.nombre || 'Cobertura Nacional',
        plazo_dias: zonaAplicada?.plazo_dias || '3 a 6 días hábiles',
        sla_despacho_label: cfg.sla_despacho_label,
        operadores_habilitados: cfg.operadores_habilitados,
        operador_default: cfg.operador_default,
        permitir_domicilio: cfg.permitir_domicilio,
        permitir_sucursal_correo: cfg.permitir_sucursal_correo,
        envio_gratis_activo: cfg.envio_gratis_activo,
        envio_gratis_desde_monto: cfg.envio_gratis_desde_monto,
        califica_envio_gratis: calificaEnvioGratis,
        faltante_envio_gratis: (cfg.envio_gratis_activo && cfg.envio_gratis_desde_monto > sub)
            ? Number((cfg.envio_gratis_desde_monto - sub).toFixed(2))
            : 0,
        costo_domicilio_base: costoDomicilioBase,
        costo_sucursal_base: costoSucursalBase,
        costo_domicilio_efectivo: calificaEnvioGratis ? 0 : costoDomicilioBase,
        costo_sucursal_efectivo: calificaEnvioGratis ? 0 : costoSucursalBase,
        sugerencia_geo: sugerenciaGeo
    };
}

// Paleta exacta muestreada píxel a píxel desde assets-paraiso/Paraiso Color Horizontal.png
const TEMA_VISUAL_PARAISO_OFICIAL = {
    paleta: {
        primario: '#654B30',
        primario_oscuro: '#4E3924',
        terracota: '#D36344',
        terracota_oscuro: '#B54F33',
        ocre: '#DA9A46',
        pistacho: '#9DAD5A',
        pistacho_texto: '#43521D',
        pistacho_suave: '#EFF4DF',
        amarillo_sol: '#FFC266',
        fondo: '#FBF8F3',
        superficie_calida: '#F5EFE6',
        tarjeta: '#FFFFFF',
        texto: '#654B30',
        texto_secundario: '#826B53',
        borde: '#E7DCCB'
    },
    tipografia: {
        familia: "'Nunito', sans-serif",
        google_font: 'Nunito:wght@500;600;700;800;900'
    },
    logo_incluye_texto: true,
    logos: {
        horizontal: '/img/nodos/paraiso/paraiso-horizontal.png',
        vertical: '/img/nodos/paraiso/paraiso-vertical.png',
        isotipo: '/img/nodos/paraiso/paraiso-isotipo.png',
        zebra_mono: '/img/nodos/paraiso/paraiso-zebra-mono.png'
    }
};

// Paleta exacta muestreada píxel a píxel desde la lámina gráfica oficial de MANSO (Franjas 2 y 3)
const TEMA_VISUAL_MANSO_OFICIAL = {
    paleta: {
        primario: '#0F4246',
        primario_oscuro: '#092B2E',
        terracota: '#672833',
        terracota_oscuro: '#4E1D26',
        ocre: '#C99B3D',
        pistacho: '#85B1B4',
        pistacho_texto: '#0F4246',
        pistacho_suave: '#E6F1F1',
        amarillo_sol: '#E3B857',
        fondo: '#FAF6EC',
        fondo_icono_tienda: '#672833',
        superficie_calida: '#F4EBD6',
        tarjeta: '#FFFFFF',
        texto: '#2C1B1E',
        texto_secundario: '#6E5358',
        borde: '#E5DAC6'
    },
    tipografia: {
        familia: "'Nunito', sans-serif",
        google_font: 'Nunito:wght@500;600;700;800;900'
    },
    logo_incluye_texto: true,
    logos: {
        principal: '/img/nodos/manso/logo-principal.png',
        horizontal: '/img/nodos/manso/logo-horizontal.png',
        vertical: '/img/nodos/manso/logo-principal.png',
        isotipo: '/img/nodos/manso/isotipo.png',
        zebra_mono: '/img/nodos/manso/logo-termico-bn.png'
    }
};

const LOGO_ZPL_CONFIG_MANSO_OFICIAL = {
    width: 208,
    height: 62,
    threshold: 140,
    mode: 'threshold',
    padding: 2,
    invert: false,
    modo_cabecera: 'banner_completo',
    iniciales: 'MO'
};

function leerLogoZebraMansoDataUrl() {
    const p = path.join(__dirname, '..', 'img', 'nodos', 'manso', 'logo-termico-bn.png');
    try {
        if (fs.existsSync(p)) {
            return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
        }
    } catch (_) {}
    return null;
}

function leerLogoZebraParaisoDataUrl() {
    const candidatos = [
        path.join(__dirname, '..', 'img', 'nodos', 'paraiso', 'paraiso-zebra-mono.png'),
        path.join(__dirname, '..', '..', '..', 'assets-paraiso', 'paraiso-zebra-mono.png')
    ];
    for (const p of candidatos) {
        try {
            if (fs.existsSync(p)) {
                return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
            }
        } catch (_) {}
    }
    return null;
}

/**
 * Migración idempotente de NODO-001 ("Lo de Mati" -> "Paraíso · Alimentos saludables").
 * Reutilizable de forma segura en Laboratorio y en el futuro pase a Producción:
 * - Conserva intactos cliente_madre_bunker_id, CB-NODO-001, gestor_token y todos los pedidos existentes.
 * - No modifica jamás a MANSO (NODO-002) ni otros nodos.
 */
async function migrarNodoLoDeMatiAParaiso(runner = null) {
    const q = runner || db;
    const candRes = await q.query(
        `SELECT id, codigo_nodo, slug, slug_historico, nombre_marca, bajada_marca,
                subtitulo_marca, gestor_nombre, barrio_zona, color_primario, tema_visual, logo_zpl_config, logo_zpl_gfa
         FROM public.nodos_maestro
         WHERE codigo_nodo = 'NODO-001'
            OR LOWER(slug) = 'lo-de-mati'
            OR LOWER(COALESCE(slug_historico, '')) = 'lo-de-mati'
         ORDER BY CASE WHEN codigo_nodo = 'NODO-001' THEN 0 ELSE 1 END, id ASC
         LIMIT 1`
    );

    if (candRes.rows.length === 0) {
        return { migrated: false, reason: 'NODO_001_NO_ENCONTRADO' };
    }

    const row = candRes.rows[0];
    if (String(row.slug || '').trim().toLowerCase() === 'manso') {
        return { migrated: false, reason: 'PROTEGIDO_MANSO' };
    }

    const tvActual = (row.tema_visual && typeof row.tema_visual === 'object') ? row.tema_visual : {};
    const cfgActual = (row.logo_zpl_config && typeof row.logo_zpl_config === 'object') ? row.logo_zpl_config : {};
    const yaMigrado =
        String(row.slug || '').trim() === 'paraiso' &&
        String(row.slug_historico || '').trim() === 'lo-de-mati' &&
        String(row.nombre_marca || '').trim() === 'Paraíso' &&
        String(row.bajada_marca || '').trim() === 'Alimentos saludables' &&
        String(row.gestor_nombre || '').trim() === 'Matías Ferronato' &&
        String(row.barrio_zona || '').trim() === 'Barrio Paraíso' &&
        String(row.color_primario || '').toUpperCase() === '#D36344' &&
        tvActual?.logo_incluye_texto === true &&
        tvActual?.logos?.horizontal === TEMA_VISUAL_PARAISO_OFICIAL.logos.horizontal &&
        tvActual?.paleta?.primario === TEMA_VISUAL_PARAISO_OFICIAL.paleta.primario &&
        Number(cfgActual.width || 0) === 264 &&
        Number(cfgActual.height || 0) === 64 &&
        String(row.logo_zpl_gfa || '').startsWith('^GFA,2112,2112,33,');

    if (yaMigrado) {
        return { migrated: false, already_migrated: true, nodo_id: Number(row.id) };
    }

    const conflictoSlug = await q.query(
        `SELECT id FROM public.nodos_maestro WHERE LOWER(slug) = 'paraiso' AND id <> $1::int LIMIT 1`,
        [Number(row.id)]
    );
    if (conflictoSlug.rows.length > 0) {
        return { migrated: false, reason: 'SLUG_PARAISO_OCUPADO', conflicto_id: conflictoSlug.rows[0].id };
    }

    const zebraDataUrl = leerLogoZebraParaisoDataUrl();
    const zplConfigNuevo = {
        width: 264,
        height: 64,
        threshold: 115,
        mode: 'threshold',
        invert: false,
        padding: 2,
        modo_cabecera: 'banner_completo',
        iniciales: 'P'
    };
    const conversionLogo = await convertirLogoAZplGfa({
        imageBase64: zebraDataUrl,
        nombreMarca: 'Paraíso',
        iniciales: 'P',
        width: zplConfigNuevo.width,
        height: zplConfigNuevo.height,
        threshold: zplConfigNuevo.threshold,
        mode: zplConfigNuevo.mode,
        padding: zplConfigNuevo.padding,
        invert: false
    });

    const upd = await q.query(
        `UPDATE public.nodos_maestro
         SET slug = 'paraiso',
             slug_historico = 'lo-de-mati',
             nombre_marca = 'Paraíso',
             bajada_marca = 'Alimentos saludables',
             subtitulo_marca = 'Alimentos saludables',
             gestor_nombre = 'Matías Ferronato',
             barrio_zona = 'Barrio Paraíso',
             color_primario = '#D36344',
             tema_visual = $1::jsonb,
             logo_original_base64 = COALESCE($2, logo_original_base64),
             logo_mono_preview_base64 = $3,
             logo_zpl_gfa = $4,
             logo_zpl_config = $5::jsonb,
             updated_at = NOW()
         WHERE id = $6::int
         RETURNING id, codigo_nodo, slug, slug_historico, nombre_marca, bajada_marca, gestor_nombre, barrio_zona`,
        [
            JSON.stringify(TEMA_VISUAL_PARAISO_OFICIAL),
            zebraDataUrl,
            conversionLogo.logo_mono_preview_base64,
            conversionLogo.logo_zpl_gfa,
            JSON.stringify(zplConfigNuevo),
            Number(row.id)
        ]
    );

    return {
        migrated: true,
        nodo: upd.rows[0] || null,
        zpl_dims: `${conversionLogo.width}x${conversionLogo.height}`
    };
}

function setGeoCacheLimitado(cacheMap, clave, valor) {
    if (cacheMap.size >= GEO_CACHE_MAX_ENTRIES) {
        const firstKey = cacheMap.keys().next().value;
        if (firstKey !== undefined) cacheMap.delete(firstKey);
    }
    cacheMap.set(clave, { ts: Date.now(), data: valor });
}

function getGeoCacheVigente(cacheMap, clave) {
    const entry = cacheMap.get(clave);
    if (!entry) return null;
    if ((Date.now() - entry.ts) > GEO_CACHE_TTL_MS) {
        cacheMap.delete(clave);
        return null;
    }
    return entry.data;
}

function normalizarQueryGeocoderAr(rawQuery = '') {
    let q = String(rawQuery || '').replace(/\s+/g, ' ').trim();
    if (!q) return '';
    // La Plata / diagonales: "Calle 7 nº 820" -> "7 820", "Diag. 74 n° 1500" -> "Diagonal 74 1500"
    q = q
        .replace(/\bdiag\.?\s*/gi, 'Diagonal ')
        .replace(/\bav\.?\s+/gi, 'Avenida ')
        .replace(/\bbv\.?\s+/gi, 'Boulevard ')
        .replace(/\bcalle\s+(\d)/gi, '$1')
        .replace(/\b(?:n[°ºo]|nro\.?)\s*(\d+)/gi, '$1')
        .replace(/\s+,/g, ',')
        .replace(/,\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .trim();
    return q;
}

function normalizarTokenTextoGeo(txt = '') {
    return String(txt || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchJsonConTimeout(url, opciones = {}, timeoutMs = 4800) {
    const resp = await fetch(url, {
        ...opciones,
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }
    return resp.json();
}

async function geocodificarDireccionArgentina(query, opciones = {}) {
    const qOrig = String(query || '').trim();
    if (qOrig.length < 3) {
        return { resultados: [], query_normalizada: qOrig, fuente_principal: 'vacio' };
    }

    const qNorm = normalizarQueryGeocoderAr(qOrig);
    const cacheKey = `${normalizarTokenTextoGeo(qNorm)}|${String(opciones.partido_hint || '').toLowerCase()}`;
    const cached = getGeoCacheVigente(_geoCacheBusquedaAr, cacheKey);
    if (cached) {
        return cached;
    }

    const partes = qNorm.split(',').map(p => p.trim()).filter(Boolean);
    const partePrincipal = partes[0] || qNorm;
    const partesResto = partes.slice(1);
    const partePrincipalNorm = normalizarTokenTextoGeo(partePrincipal);
    const tieneAltura = /\b\d{1,5}\b/.test(partePrincipal) && !/^(diagonal\s+)?\d{1,3}$/i.test(partePrincipal);
    const empiezaConTipoVia = /^(calle|av\.?|avenida|diagonal|diag\.?|boulevard|bv\.?|pasaje|pje\.?|ruta|camino|autopista)\s+/i.test(partePrincipal);
    const priorizaLocalidadSobreCalle = !tieneAltura && !empiezaConTipoVia;
    const tokensResto = partesResto
        .join(' ')
        .split(/\s+/)
        .map(normalizarTokenTextoGeo)
        .filter(t => t.length >= 3 && !['argentina', 'bs', 'as', 'prov', 'provincia'].includes(t));
    const zonaEspecificaRaw = normalizarTokenTextoGeo(partesResto[0] || '');
    const tokensZona = (zonaEspecificaRaw && zonaEspecificaRaw !== 'buenos aires')
        ? zonaEspecificaRaw.split(/\s+/).filter(t => t.length >= 3 && !['del', 'las', 'los', 'prov', 'provincia', 'ciudad', 'argentina'].includes(t))
        : [];
    const evaluarMatchZona = (blobNorm = '') => tokensZona.length === 0 || tokensZona.every(tok => blobNorm.includes(tok));

    const candidatos = [];

    const registrarCandidato = (item) => {
        const lat = Number(item.lat);
        const lng = Number(item.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return;
        const nuevoScore = Number(item.score || 0);
        const idxDuplicado = candidatos.findIndex(c =>
            Math.abs(c.lat - lat) < 0.0012 && Math.abs(c.lng - lng) < 0.0012
        );
        if (idxDuplicado === -1) {
            candidatos.push({
                display_name: String(item.display_name || '').trim(),
                lat: Number(lat.toFixed(7)),
                lng: Number(lng.toFixed(7)),
                calle: String(item.calle || '').trim(),
                altura: item.altura ? String(item.altura).trim() : '',
                localidad: String(item.localidad || '').trim(),
                partido: String(item.partido || '').trim(),
                provincia: String(item.provincia || '').trim(),
                fuente: item.fuente || 'georef',
                score: nuevoScore
            });
        } else if (nuevoScore > candidatos[idxDuplicado].score) {
            candidatos[idxDuplicado].score = nuevoScore;
        }
    };

    const promesasGeoref = [];

    if (tieneAltura) {
        const urlDir = new URL('https://apis.datos.gob.ar/georef/api/direcciones');
        urlDir.searchParams.set('direccion', partePrincipal);
        urlDir.searchParams.set('max', '8');
        urlDir.searchParams.set('campos', 'estandar');
        if (partesResto.length >= 2) {
            urlDir.searchParams.set('provincia', partesResto[partesResto.length - 1]);
        }
        promesasGeoref.push(
            fetchJsonConTimeout(urlDir.toString(), {}, 4500).then(data => ({ tipo: 'direcciones', data }))
        );
    }

    // Buscar también localidades (ideal para "Martínez, Buenos Aires", "City Bell", etc.)
    const urlLoc = new URL('https://apis.datos.gob.ar/georef/api/localidades');
    urlLoc.searchParams.set('nombre', partePrincipal);
    urlLoc.searchParams.set('max', '8');
    urlLoc.searchParams.set('campos', 'estandar');
    if (partesResto.length === 1 && !/la plata|san isidro|vicente lopez/i.test(partesResto[0])) {
        urlLoc.searchParams.set('provincia', partesResto[0]);
    } else if (partesResto.length >= 2) {
        urlLoc.searchParams.set('provincia', partesResto[partesResto.length - 1]);
    }
    promesasGeoref.push(
        fetchJsonConTimeout(urlLoc.toString(), {}, 4500).then(data => ({ tipo: 'localidades', data }))
    );

    const georefSettled = await Promise.allSettled(promesasGeoref);

    for (const resItem of georefSettled) {
        if (resItem.status !== 'fulfilled') continue;
        const { tipo, data } = resItem.value || {};
        if (tipo === 'direcciones' && Array.isArray(data?.direcciones)) {
            for (const d of data.direcciones) {
                const lat = d?.ubicacion?.lat;
                const lon = d?.ubicacion?.lon;
                if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) continue;
                const calle = d?.calle?.nombre || '';
                const altura = d?.altura?.valor ? String(d.altura.valor) : '';
                const loc = d?.localidad_censal?.nombre || '';
                const dep = d?.departamento?.nombre || '';
                const prov = d?.provincia?.nombre || '';
                const etiqueta = [
                    [calle, altura].filter(Boolean).join(' '),
                    loc || dep,
                    dep && dep !== loc ? dep : '',
                    prov
                ].filter(Boolean).join(', ');
                const blobNorm = normalizarTokenTextoGeo(etiqueta);
                let coincidencias = 0;
                for (const tok of tokensResto) {
                    if (blobNorm.includes(tok)) coincidencias += 1;
                }
                const coincideZona = evaluarMatchZona(blobNorm);
                if (tokensZona.length > 0 && !coincideZona) {
                    registrarCandidato({
                        display_name: etiqueta,
                        lat,
                        lng: lon,
                        calle,
                        altura,
                        localidad: loc,
                        partido: dep,
                        provincia: prov,
                        fuente: 'georef_direcciones',
                        score: 25 + coincidencias * 5
                    });
                } else if (tokensResto.length > 0 && coincidencias === 0 && !blobNorm.includes(normalizarTokenTextoGeo(partesResto.join(' ')))) {
                    // Priorizar las que coinciden con partido/provincia si el usuario escribió coma
                    registrarCandidato({
                        display_name: etiqueta,
                        lat,
                        lng: lon,
                        calle,
                        altura,
                        localidad: loc,
                        partido: dep,
                        provincia: prov,
                        fuente: 'georef_direcciones',
                        score: 20
                    });
                } else {
                    registrarCandidato({
                        display_name: etiqueta,
                        lat,
                        lng: lon,
                        calle,
                        altura,
                        localidad: loc,
                        partido: dep,
                        provincia: prov,
                        fuente: 'georef_direcciones',
                        score: 110 + coincidencias * 25 + (tokensZona.length > 0 && coincideZona ? 35 : 0)
                    });
                }
            }
        }
        if (tipo === 'localidades' && Array.isArray(data?.localidades)) {
            for (const l of data.localidades) {
                const lat = l?.centroide?.lat;
                const lon = l?.centroide?.lon;
                if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) continue;
                const loc = l?.nombre || '';
                const dep = l?.departamento?.nombre || l?.municipio?.nombre || '';
                const prov = l?.provincia?.nombre || '';
                const etiqueta = [loc, dep && dep !== loc ? dep : '', prov].filter(Boolean).join(', ');
                const blobNorm = normalizarTokenTextoGeo(etiqueta);
                let coincidencias = 0;
                for (const tok of tokensResto) {
                    if (blobNorm.includes(tok)) coincidencias += 1;
                }
                const esExactoLoc = normalizarTokenTextoGeo(loc) === partePrincipalNorm;
                const coincideZonaLoc = evaluarMatchZona(blobNorm);
                const baseLoc = priorizaLocalidadSobreCalle ? (esExactoLoc ? 200 : 155) : (tieneAltura ? 40 : 90);
                const penalizaZonaLoc = (tokensZona.length > 0 && !coincideZonaLoc) ? -75 : 0;
                registrarCandidato({
                    display_name: etiqueta,
                    lat,
                    lng: lon,
                    calle: '',
                    altura: '',
                    localidad: loc,
                    partido: dep,
                    provincia: prov,
                    fuente: 'georef_localidades',
                    score: baseLoc + coincidencias * 20 + (tokensZona.length > 0 && coincideZonaLoc ? 30 : 0) + penalizaZonaLoc
                });
            }
        }
    }

    const tieneMatchFuerteGeoref = candidatos.some(c =>
        c.score >= (tokensResto.length > 0 ? 110 : 85) &&
        evaluarMatchZona(normalizarTokenTextoGeo(c.display_name || ''))
    );
    if (!tieneMatchFuerteGeoref || (candidatos.length < 2 && !priorizaLocalidadSobreCalle) || /\by\b/i.test(partePrincipal)) {
        try {
            const ahora = Date.now();
            const espera = _ultimoHitNominatimMs ? Math.max(0, 1050 - (ahora - _ultimoHitNominatimMs)) : 0;
            if (espera > 0 && espera <= 1100) {
                await new Promise(r => setTimeout(r, espera));
            }
            _ultimoHitNominatimMs = Date.now();

            const urlNom = new URL('https://nominatim.openstreetmap.org/search');
            urlNom.searchParams.set('format', 'jsonv2');
            urlNom.searchParams.set('countrycodes', 'ar');
            urlNom.searchParams.set('limit', '6');
            urlNom.searchParams.set('addressdetails', '1');
            urlNom.searchParams.set('q', qNorm);

            const nomRows = await fetchJsonConTimeout(urlNom.toString(), {
                headers: {
                    'User-Agent': 'LAMDA-Nodos-Barriales/1.0 (logistica@lamdaser.com)',
                    'Accept-Language': 'es-AR,es;q=0.9'
                }
            }, 4800);

            if (Array.isArray(nomRows)) {
                for (const n of nomRows) {
                    const addr = n.address || {};
                    const calle = addr.road || addr.pedestrian || addr.footway || '';
                    const altura = addr.house_number || '';
                    const loc = addr.suburb || addr.town || addr.city || addr.village || addr.neighbourhood || '';
                    const dep = addr.state_district || addr.county || '';
                    const prov = addr.state || '';
                    const nomClass = String(n.class || n.category || '').toLowerCase();
                    const esLugarNominatim = !calle || ['place', 'boundary'].includes(nomClass);
                    const etiquetaLimpia = [
                        esLugarNominatim ? '' : [calle, altura].filter(Boolean).join(' '),
                        loc,
                        dep && dep !== loc ? dep : '',
                        prov
                    ].filter(Boolean).join(', ') || n.display_name;
                    const blobNorm = normalizarTokenTextoGeo(`${etiquetaLimpia} ${n.display_name || ''}`);
                    let coincidencias = 0;
                    for (const tok of tokensResto) {
                        if (blobNorm.includes(tok)) coincidencias += 1;
                    }
                    const coincideZonaNom = evaluarMatchZona(blobNorm);
                    let scoreNom;
                    if (tokensZona.length > 0 && !coincideZonaNom) {
                        scoreNom = 35 + coincidencias * 8;
                    } else if (priorizaLocalidadSobreCalle) {
                        if (esLugarNominatim) {
                            const esExactoNomLoc = normalizarTokenTextoGeo(loc || '') === partePrincipalNorm ||
                                normalizarTokenTextoGeo((n.name || '')) === partePrincipalNorm;
                            scoreNom = (esExactoNomLoc ? 185 : 145) + coincidencias * 22 + (tokensZona.length > 0 && coincideZonaNom ? 40 : 0);
                        } else {
                            // Búsqueda sin altura ni prefijo de vía: evitar que una calle homónima (ej: Calle Enrique Martínez en CABA) supere a una localidad
                            scoreNom = 55 + coincidencias * 12 + (tokensZona.length > 0 && coincideZonaNom ? 25 : 0);
                        }
                    } else {
                        scoreNom = 85 + coincidencias * 25 + (tokensZona.length > 0 && coincideZonaNom ? 45 : 0);
                    }
                    registrarCandidato({
                        display_name: etiquetaLimpia,
                        lat: n.lat,
                        lng: n.lon,
                        calle: esLugarNominatim ? '' : calle,
                        altura: esLugarNominatim ? '' : altura,
                        localidad: loc,
                        partido: dep,
                        provincia: prov,
                        fuente: 'nominatim',
                        score: scoreNom
                    });
                }
            }
        } catch (nomErr) {
            console.warn('⚠️ [GeocoderAR] Fallback Nominatim omitido:', nomErr.message);
        }
    }

    candidatos.sort((a, b) => b.score - a.score);
    const topResultados = candidatos.slice(0, 8).map(({ score, ...rest }) => rest);
    const salida = {
        resultados: topResultados,
        query_normalizada: qNorm,
        fuente_principal: topResultados[0]?.fuente || 'sin_resultados'
    };
    if (topResultados.length > 0) {
        setGeoCacheLimitado(_geoCacheBusquedaAr, cacheKey, salida);
    }
    return salida;
}

async function geocodificarInversoArgentina(latRaw, lngRaw) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        const err = new Error('Coordenadas geográficas inválidas.');
        err.statusCode = 400;
        throw err;
    }

    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = getGeoCacheVigente(_geoCacheInversaAr, cacheKey);
    if (cached) {
        return cached;
    }

    let calle = '';
    let altura = '';
    let localidad = '';
    let partido = '';
    let provincia = '';
    let fuente = 'coordenadas';

    const [georefRes, nomRes] = await Promise.allSettled([
        fetchJsonConTimeout(`https://apis.datos.gob.ar/georef/api/ubicacion?lat=${lat}&lon=${lng}`, {}, 4000),
        (async () => {
            const ahora = Date.now();
            if (_ultimoHitNominatimMs && (ahora - _ultimoHitNominatimMs) < 1050) {
                await new Promise(r => setTimeout(r, 1050 - (ahora - _ultimoHitNominatimMs)));
            }
            _ultimoHitNominatimMs = Date.now();
            return fetchJsonConTimeout(
                `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1`,
                {
                    headers: {
                        'User-Agent': 'LAMDA-Nodos-Barriales/1.0 (logistica@lamdaser.com)',
                        'Accept-Language': 'es-AR,es;q=0.9'
                    }
                },
                4500
            );
        })()
    ]);

    if (georefRes.status === 'fulfilled' && georefRes.value?.ubicacion) {
        const u = georefRes.value.ubicacion;
        partido = u.municipio?.nombre || u.departamento?.nombre || '';
        provincia = u.provincia?.nombre || '';
        fuente = 'georef_ubicacion';
    }

    if (nomRes.status === 'fulfilled' && nomRes.value) {
        const addr = nomRes.value.address || {};
        calle = addr.road || addr.pedestrian || addr.footway || '';
        altura = addr.house_number || '';
        localidad = addr.suburb || addr.town || addr.city || addr.village || addr.neighbourhood || localidad;
        partido = partido || addr.state_district || addr.county || '';
        provincia = provincia || addr.state || '';
        fuente = calle ? 'nominatim+georef' : fuente;
    }

    const display_name = [
        [calle, altura].filter(Boolean).join(' '),
        localidad,
        partido && partido !== localidad ? partido : '',
        provincia
    ].filter(Boolean).join(', ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    const salida = {
        lat: Number(lat.toFixed(7)),
        lng: Number(lng.toFixed(7)),
        display_name,
        calle,
        altura,
        localidad,
        partido,
        provincia,
        fuente
    };
    setGeoCacheLimitado(_geoCacheInversaAr, cacheKey, salida);
    return salida;
}

/**
 * Clasifica un ingrediente o artículo en uno de los 6 Flujos del Modelo de Dominio LAMDA
 */
function clasificarIngredienteEnFlujo(ing, idsCompuestosSet = new Set()) {
    const id = Number(ing.id);
    const nombreLower = String(ing.nombre || '').toLowerCase();
    const artVinc = String(ing.articulo_vinculado_numero || '').trim().toUpperCase();

    // Flujo 6: Doble Mezcla / Granola Compleja (excluir prefijos GSC de Garbanzo)
    if (
        [122, 131, 132, 134].includes(id) ||
        nombreLower.includes('grana') ||
        /^GS(X|GN)/i.test(artVinc) ||
        /^(GF(X|GN)|GDF)/i.test(artVinc)
    ) {
        return {
            flujo: 6,
            flujo_nombre: '[LDN 6] Granolas (Doble Mezcla + UP)',
            origen_tipo: 'UP_EXTERNA'
        };
    }

    // Flujo 5: Barritas (Mezcla Interna + UP Externa)
    if (
        [109, 140, 141].includes(id) ||
        nombreLower.includes('barrit') ||
        artVinc.startsWith('BF') ||
        artVinc === 'MPB'
    ) {
        return {
            flujo: 5,
            flujo_nombre: '[LDN 5] Barritas (Mezcla Interna + UP)',
            origen_tipo: 'UP_EXTERNA'
        };
    }

    // Flujo 4: Tostaderos (Unidad Productiva Externa Simple)
    if (
        [18, 38, 41, 56, 57, 123, 166].includes(id) ||
        nombreLower.includes('tostad')
    ) {
        return {
            flujo: 4,
            flujo_nombre: '[LDN 4] Tostaderos (UP Externa Simple)',
            origen_tipo: 'UP_EXTERNA'
        };
    }

    // Flujo 3: Mixes (Mezclas Internas a Fracciones - excluye MFB/MFQ/MFD de Maíz Frito)
    if (
        idsCompuestosSet.has(id) ||
        [92, 148, 149, 150, 151, 154, 155, 158, 159].includes(id) ||
        nombreLower.includes('mix') ||
        artVinc.startsWith('MFS') ||
        artVinc.startsWith('MCT') ||
        artVinc.startsWith('MSX')
    ) {
        return {
            flujo: 3,
            flujo_nombre: '[LDN 3] Mixes (Mezcla Interna)',
            origen_tipo: 'MIX'
        };
    }

    // Flujo 2: Fraccionados de Bulto Cerrado (Mono-Ingredientes 100% Puros)
    return {
        flujo: 2,
        flujo_nombre: '[LDN 2] Mono-Ingrediente Fraccionado',
        origen_tipo: 'INGREDIENTE'
    };
}

/**
 * Formateadores deterministas del idioma técnico oficial de LAMDA (CERO diccionarios de traducción intermedia).
 */
function formatearEtiquetaTecnicaIngrediente(ing = {}) {
    const id = Number(ing.id || 0);
    const cod = ing.codigo !== undefined && ing.codigo !== null && String(ing.codigo).trim() !== ''
        ? String(ing.codigo).trim()
        : (id > 0 ? `#${id}` : 'S/C');
    const nom = String(ing.nombre || '').trim() || `Ingrediente #${id}`;
    return `[${cod}] ${nom}`;
}

function formatearEtiquetaTecnicaArticulo(sku, descripcionOficial) {
    const cod = String(sku || '').trim() || 'S/SKU';
    const desc = String(descripcionOficial || '').trim() || cod;
    return `[${cod}] ${desc}`;
}

function normalizarEjeCategoriaBunker(txt) {
    return String(txt || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\s-]+/g, '_');
}

function resolverIdentidadTecnicaIngrediente(ing = {}, familiaNombreDb = null, categoriaIngNombreDb = null, idsCompuestosSet = new Set()) {
    const id = Number(ing.id || 0);
    const clasif = clasificarIngredienteEnFlujo(ing, idsCompuestosSet);
    const nombreOficial = String(ing.nombre || '').trim();
    const codigoOficial = ing.codigo !== undefined && ing.codigo !== null && String(ing.codigo).trim() !== ''
        ? String(ing.codigo).trim()
        : null;
    const labelOficial = formatearEtiquetaTecnicaIngrediente(ing);
    const categoriaLamda = String(familiaNombreDb || categoriaIngNombreDb || '').trim()
        || (clasif.flujo === 6 ? 'Cereales'
            : clasif.flujo === 5 ? 'Cereales'
            : clasif.flujo === 3 ? 'Frutos Secos'
            : 'Sin Familia Asignada');

    return {
        id,
        codigo: codigoOficial,
        nombre_oficial: nombreOficial,
        label_oficial: labelOficial,
        categoria_lamda: categoriaLamda,
        flujo: clasif.flujo,
        flujo_nombre: clasif.flujo_nombre,
        origen_tipo: clasif.origen_tipo,
        es_pack_barritas: Boolean(id === 141 || clasif.flujo === 5)
    };
}

/**
 * En Flujo 3 (Mixes) o ingredientes simples vinculados a receta puente, resuelve por SQL real
 * la cadena determinista:
 *   ingredientes(simple).articulo_vinculado_numero -> recetas.articulo_numero -> receta_ingredientes -> ingredientes(mix padre)
 * Ejemplo real verificable:
 *   #150 [98300883] Mix Premium (Simple) -> puente 'MFSPXK' -> #31 [48903659] Mix Premium (Mix)
 */
async function resolverMixPadreFlujo3(runner, ingSimple = {}) {
    const q = runner || db;
    const artVinc = String(ingSimple.articulo_vinculado_numero || '').trim();
    const simpleId = Number(ingSimple.id || 0);
    if (!artVinc) return null;

    const res = await q.query(
        `SELECT ing_p.id,
                ing_p.codigo,
                ing_p.nombre,
                COALESCE(ing_p.costo_patron, 0)::numeric(14,2) AS costo_patron,
                r.id AS receta_puente_id,
                r.articulo_numero AS receta_puente_codigo
         FROM public.recetas r
         JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
         JOIN public.ingredientes ing_p ON ing_p.id = ri.ingrediente_id
         WHERE UPPER(r.articulo_numero) = UPPER($1)
           AND ($2::int = 0 OR ing_p.id <> $2::int)
           AND COALESCE(ing_p.es_insumo, false) = false
         ORDER BY COALESCE(ri.cantidad, 0) DESC, ing_p.id ASC
         LIMIT 1`,
        [artVinc, simpleId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    const codPadre = row.codigo !== null && row.codigo !== undefined && String(row.codigo).trim() !== ''
        ? String(row.codigo).trim()
        : `#${row.id}`;
    return {
        id: Number(row.id),
        codigo: row.codigo,
        nombre: row.nombre,
        costo_patron: Number(row.costo_patron || 0),
        receta_puente_id: Number(row.receta_puente_id),
        receta_puente_codigo: row.receta_puente_codigo,
        label_oficial: `#${row.id} [${codPadre}] ${row.nombre}`
    };
}

/**
 * Ensambla la descripción técnica oficial del Búnker replicando exactamente el algoritmo
 * posicional de actualizarLivePreview() en src/logistica/js/bunker.js.
 */
function ensamblarDescripcionOficialBunker(cfg = {}) {
    const tokens = [];
    const incluirFamilia = Boolean(cfg.incluir_familia);
    const posicionFamilia = String(cfg.posicion_familia || 'ANTES').toUpperCase();
    const modoFamilia = String(cfg.modo_display_familia || 'COMPLETO').toUpperCase();
    const textoFamilia = (modoFamilia === 'ABREVIADO' && String(cfg.abreviatura_familia || '').trim())
        ? String(cfg.abreviatura_familia).trim()
        : String(cfg.familia_nombre || '').trim();

    if (incluirFamilia && posicionFamilia !== 'DESPUES' && textoFamilia) {
        tokens.push(textoFamilia);
    }

    const silenciosoPrincipal = Boolean(cfg.silencioso_principal);
    const modoPrincipal = String(cfg.modo_display_principal || 'COMPLETO').toUpperCase();
    const textoPrincipal = (modoPrincipal === 'ABREVIADO' && String(cfg.abreviatura_principal || '').trim())
        ? String(cfg.abreviatura_principal).trim()
        : String(cfg.articulo_principal || '').trim();

    if (!silenciosoPrincipal && textoPrincipal) {
        tokens.push(textoPrincipal);
    }

    if (incluirFamilia && posicionFamilia === 'DESPUES' && textoFamilia) {
        tokens.push(textoFamilia);
    }

    const posicionesObj = (cfg.posiciones && typeof cfg.posiciones === 'object') ? cfg.posiciones : {};
    const entradasPos = Object.entries(posicionesObj)
        .filter(([, p]) => p && typeof p === 'object' && String(p.valor || '').trim())
        .sort((a, b) => Number(a[1].posicion || 99) - Number(b[1].posicion || 99));

    for (const [, p] of entradasPos) {
        if (p.silencioso) continue;
        const modoPos = String(p.modo_display || 'COMPLETO').toUpperCase();
        const txtPos = (modoPos === 'ABREVIADO' && String(p.abreviatura || '').trim())
            ? String(p.abreviatura).trim()
            : String(p.valor).trim();
        if (txtPos) tokens.push(txtPos);
    }

    const kilos = Math.max(0.001, Number(cfg.kilos_unidad || 0.25));
    const gramos = Math.round(kilos * 1000);
    const esPack = Boolean(cfg.es_pack) && Number(cfg.pack_unidades || 1) > 1;
    if (esPack) {
        const packU = Math.max(2, Number(cfg.pack_unidades || 1));
        const gramosUnit = Math.max(1, Math.round(gramos / packU));
        tokens.push(`${packU} x ${gramosUnit}g`);
    } else {
        const sufijoPeso = (gramos >= 1000 && gramos % 1000 === 0) ? `${gramos / 1000}kg` : `${gramos}g`;
        tokens.push(`x ${sufijoPeso}`);
    }

    return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Expone los selectores relacionales oficiales del Diccionario Búnker (por Primary Key IDs)
 * para el Caso B del Cotizador (cuando un ingrediente aún no posee hermano en public.bunker_articulos).
 */
async function obtenerDiccionarioBunkerCotizador(familiaId = null, articuloPrincipalId = null) {
    if (familiaId && typeof familiaId === 'object') {
        articuloPrincipalId = familiaId.articuloPrincipalId ?? familiaId.articulo_principal_id ?? null;
        familiaId = familiaId.familiaId ?? familiaId.familia_id ?? null;
    }
    const famNum = familiaId ? Number(familiaId) : null;
    const artPrinNum = articuloPrincipalId ? Number(articuloPrincipalId) : null;

    const [familiasRes, rubrosRes, principalesRes, categoriasFamRes, relacionesRes, diccionarioRes] = await Promise.all([
        db.query(`
            SELECT id, codigo_familia, nombre, abreviatura
            FROM public.bunker_familias
            WHERE COALESCE(activo, true) = true
              AND id <> 42
            ORDER BY nombre ASC
        `),
        db.query(`
            SELECT r.id,
                   r.nombre AS rubro,
                   COALESCE(
                       json_agg(s.nombre ORDER BY s.nombre ASC) FILTER (WHERE s.id IS NOT NULL),
                       '[]'::json
                   ) AS subrubros
            FROM public.bunker_rubros r
            LEFT JOIN public.bunker_subrubros s ON s.rubro_id = r.id
            GROUP BY r.id, r.nombre
            ORDER BY r.nombre ASC
        `),
        db.query(`
            SELECT id, termino, abreviatura
            FROM public.bunker_diccionario
            WHERE LOWER(categoria) = 'articulo_principal'
              AND COALESCE(obsoleto, false) = false
            ORDER BY termino ASC
        `),
        famNum
            ? db.query(
                `SELECT id, familia_id, categoria, orden_posicional
                 FROM public.bunker_familia_categorias
                 WHERE familia_id = $1
                 ORDER BY orden_posicional ASC, id ASC`,
                [famNum]
            )
            : db.query(`
                SELECT id, familia_id, categoria, orden_posicional
                FROM public.bunker_familia_categorias
                ORDER BY familia_id ASC, orden_posicional ASC, id ASC
            `),
        famNum
            ? db.query(
                `SELECT r.id, r.familia_id, r.articulo_principal_id, r.termino_id,
                        r.categoria, r.categoria_id,
                        d.termino, d.abreviatura
                 FROM public.bunker_relacion_atributo_principal r
                 JOIN public.bunker_diccionario d ON d.id = r.termino_id
                 WHERE r.familia_id = $1
                   AND COALESCE(d.obsoleto, false) = false
                   AND ($2::int IS NULL OR r.articulo_principal_id = $2::int)
                 ORDER BY r.orden_id_safe ASC NULLS LAST, d.termino ASC`
                    .replace('r.orden_id_safe ASC NULLS LAST, ', ''),
                [famNum, artPrinNum]
            )
            : Promise.resolve({ rows: [] }),
        db.query(`
            SELECT id, termino, abreviatura, categoria
            FROM public.bunker_diccionario
            WHERE COALESCE(obsoleto, false) = false
              AND LOWER(categoria) <> 'articulo_principal'
            ORDER BY categoria ASC, termino ASC
        `)
    ]);

    let principalesPermitidos = principalesRes.rows;
    if (famNum) {
        const prinRelRes = await db.query(
            `SELECT DISTINCT d.id, d.termino, d.abreviatura
             FROM public.bunker_relacion_atributo_principal r
             JOIN public.bunker_diccionario d ON d.id = r.articulo_principal_id
             WHERE r.familia_id = $1
               AND COALESCE(d.obsoleto, false) = false
             ORDER BY d.termino ASC`,
            [famNum]
        );
        if (prinRelRes.rows.length > 0) {
            principalesPermitidos = prinRelRes.rows;
        }
    }

    const terminosPorCategoria = {};
    for (const d of diccionarioRes.rows) {
        const ejeKey = normalizarEjeCategoriaBunker(d.categoria);
        if (!terminosPorCategoria[ejeKey]) terminosPorCategoria[ejeKey] = [];
        terminosPorCategoria[ejeKey].push({
            id: Number(d.id),
            termino: d.termino,
            abreviatura: d.abreviatura || '',
            categoria: d.categoria
        });
    }

    const categoriasFamilia = categoriasFamRes.rows.map(cat => {
        const ejeNorm = normalizarEjeCategoriaBunker(cat.categoria);
        const relTerminos = relacionesRes.rows
            .filter(r => Number(r.categoria_id || 0) === Number(cat.id) || normalizarEjeCategoriaBunker(r.categoria) === ejeNorm)
            .map(r => ({
                id: Number(r.termino_id),
                termino: r.termino,
                abreviatura: r.abreviatura || ''
            }));
        const dedupMap = new Map();
        const fuente = relTerminos.length > 0 ? relTerminos : (terminosPorCategoria[ejeNorm] || []);
        for (const t of fuente) {
            if (!dedupMap.has(t.id)) dedupMap.set(t.id, t);
        }
        return {
            id: Number(cat.id),
            familia_id: Number(cat.familia_id),
            categoria: cat.categoria,
            eje_normalizado: ejeNorm,
            orden_posicional: Number(cat.orden_posicional),
            restringido_por_relacion: relTerminos.length > 0,
            terminos: Array.from(dedupMap.values())
        };
    });

    return {
        familia_activa_id: famNum,
        articulo_principal_activo_id: artPrinNum,
        familias: familiasRes.rows.map(f => ({
            id: Number(f.id),
            codigo_familia: f.codigo_familia,
            nombre: f.nombre,
            abreviatura: f.abreviatura || ''
        })),
        rubros: rubrosRes.rows.map(r => ({
            id: Number(r.id),
            rubro: r.rubro,
            subrubros: Array.isArray(r.subrubros) ? r.subrubros : []
        })),
        articulos_principales: principalesPermitidos.map(p => ({
            id: Number(p.id),
            termino: p.termino,
            abreviatura: p.abreviatura || ''
        })),
        categorias_familia: categoriasFamilia
    };
}

/**
 * Resuelve de forma 100% determinista por relaciones de base de datos (sin coincidencias difusas de texto)
 * cualquier ingrediente intermedio (fórmula de Mix en ingrediente_composicion o pre-mezcla de UP)
 * hacia su Ingrediente Puente Simple comercial que consumen las presentaciones de bunker_articulos:
 *   ingrediente_origen -> receta_ingredientes -> recetas.articulo_numero -> ingredientes.articulo_vinculado_numero
 * Ejemplos relacionales exactos en etiquetas_pruebas:
 *   #30 (Mix Frutos Secos Con Pasas) -> receta 'MFSXK' -> #149 (Mix Frutos Secos Con Pasas (Simple))
 *   #31 (Mix Premium (Mix)) -> receta 'MFSPXK' -> #150 (Mix Premium (Simple))
 *   #109 (Pre-Mezcla Barritas) -> 'MPB' (#140) -> 'BF' -> #141 (Barrita 20 x 50 (1kg))
 */
async function resolverIngredienteComercialDeterminista(runner, ingredienteId) {
    const q = runner || db;
    const idNum = Number(ingredienteId || 0);
    if (!idNum) return null;

    const curRes = await q.query(
        `SELECT id, codigo, nombre, COALESCE(costo_patron, 0)::numeric(14,2) AS costo_patron,
                articulo_vinculado_numero, categoria_id
         FROM public.ingredientes
         WHERE id = $1
         LIMIT 1`,
        [idNum]
    );
    if (curRes.rows.length === 0) return null;
    let actual = curRes.rows[0];

    for (let hop = 0; hop < 3; hop++) {
        const puenteRes = await q.query(
            `SELECT ing_dest.id, ing_dest.codigo, ing_dest.nombre,
                    COALESCE(ing_dest.costo_patron, 0)::numeric(14,2) AS costo_patron,
                    ing_dest.articulo_vinculado_numero, ing_dest.categoria_id
             FROM public.receta_ingredientes ri
             JOIN public.recetas r ON r.id = ri.receta_id
             JOIN public.ingredientes ing_dest ON UPPER(ing_dest.articulo_vinculado_numero) = UPPER(r.articulo_numero)
             WHERE ri.ingrediente_id = $1
               AND ing_dest.id <> $1
               AND COALESCE(ing_dest.es_insumo, false) = false
             ORDER BY ing_dest.id ASC
             LIMIT 1`,
            [actual.id]
        );
        if (puenteRes.rows.length > 0) {
            actual = puenteRes.rows[0];
        } else {
            break;
        }
    }

    return {
        id: Number(actual.id),
        codigo: actual.codigo,
        nombre: actual.nombre,
        label_oficial: formatearEtiquetaTecnicaIngrediente(actual),
        costo_patron: Number(actual.costo_patron || 0),
        articulo_vinculado_numero: actual.articulo_vinculado_numero || null,
        categoria_id: actual.categoria_id ? Number(actual.categoria_id) : null
    };
}

/**
 * Resuelve el desglose comercial de ingredientes para una oferta de Nodo Barrial,
 * contemplando Líneas 3, 4, 5 (Barritas con pre-mezcla + miel/aceite en UP) y 6,
 * incluso cuando el artículo de catálogo apunte a una pre-mezcla (#109 -> #141)
 * o a un pack derivado (p. ej. BF6X50) cuya receta comercial está en su artículo padre.
 */
async function resolverDesgloseIngredientesOfertaNodo(runner, oferta, catalogoIngredientes) {
    if (!catalogoIngredientes || !oferta) return null;

    const flujoNum = Number(oferta.flujo_lamda || 0);
    const skuRaw = String(oferta.sku_nodo || '').trim();
    const skuSinPrefijo = skuRaw.replace(/^NB-/i, '').trim();
    const codigoOrigen = String(oferta.articulo_bunker_origen_codigo || '').trim();
    const nombrePublico = String(oferta.nombre_publico || '').trim();
    const pareceBarrita = flujoNum === 5
        || /^(?:NB-)?BF(?:\d*X\d+|X\d*)/i.test(skuRaw)
        || /^BF(?:\d*X\d+|X\d*)/i.test(codigoOrigen)
        || /\bbarritas?\b/i.test(nombrePublico);

    if (flujoNum > 0 && flujoNum < 3 && !pareceBarrita) {
        return null;
    }

    const seleccionarMejor = (a, b) => {
        if (!a) return b || null;
        if (!b) return a;
        const lnA = Number(a.linea_negocio || 0);
        const lnB = Number(b.linea_negocio || 0);
        if (pareceBarrita && lnB === 5 && lnA !== 5) return b;
        if (lnB > lnA && Array.isArray(b.ingredientes) && b.ingredientes.length >= (a.ingredientes || []).length) {
            return b;
        }
        return a;
    };

    let mejor = await obtenerDesgloseIngredientesParaItem(
        {
            sku_nodo: skuRaw,
            articulo_codigo: skuSinPrefijo !== skuRaw ? skuSinPrefijo : undefined,
            articulo_bunker_origen_codigo: codigoOrigen || undefined,
            ingrediente_origen_id: oferta.ingrediente_origen_id
        },
        catalogoIngredientes,
        runner
    );

    const ingOrigenId = Number(oferta.ingrediente_origen_id || 0);
    if (ingOrigenId > 0 && (!mejor || (pareceBarrita && Number(mejor.linea_negocio || 0) !== 5))) {
        const ingComercial = await resolverIngredienteComercialDeterminista(runner, ingOrigenId).catch(() => null);
        if (ingComercial && ingComercial.id) {
            const desdePuente = await obtenerDesgloseIngredientesParaItem(
                {
                    articulo_codigo: ingComercial.articulo_vinculado_numero || undefined,
                    ingrediente_origen_id: ingComercial.id
                },
                catalogoIngredientes,
                runner
            );
            mejor = seleccionarMejor(mejor, desdePuente);
        }
    }

    if (pareceBarrita && (!mejor || Number(mejor.linea_negocio || 0) !== 5)) {
        const itemsL5 = Object.values(catalogoIngredientes.items || {}).filter(
            (it) => Number(it && it.linea_negocio) === 5 && Array.isArray(it.ingredientes) && it.ingredientes.length >= 2
        );
        const codigoBase = (codigoOrigen || skuSinPrefijo || skuRaw).toUpperCase();
        const raizFamiliaMatch = codigoBase.match(/^([A-Z]{2,4}?)(?:\d+X\d+|X\d+)/);
        const raizFamilia = raizFamiliaMatch ? raizFamiliaMatch[1] : '';
        const matchFamilia = raizFamilia
            ? itemsL5.find((it) => String(it.codigo || '').toUpperCase().startsWith(raizFamilia))
            : null;
        const fallbackL5 = matchFamilia || (itemsL5.length === 1 ? itemsL5[0] : null);
        mejor = seleccionarMejor(mejor, fallbackL5);
    }

    return mejor;
}

/**
 * Deriva determinísticamente el SKU nativo LAMDA (sin prefijos NB- ni EMB-) y la nomenclatura
 * posicional exacta a partir de un artículo hermano canónico de public.bunker_articulos.
 */
function derivarSkuYNomenclaturaDesdeHermano(hermano = {}, kilosUnidad = 0.25, packUnidadesOverride = null) {
    const kilos = Math.max(0.001, Number(kilosUnidad || 0.25));
    const gramos = Math.round(kilos * 1000);
    const sufijoPeso = (gramos >= 1000 && gramos % 1000 === 0) ? `${gramos / 1000}kg` : `${gramos}g`;
    const idHermano = String(hermano.articulo_id || '').trim();
    const descHermano = String(hermano.descripcion_generada || hermano.descripcion || idHermano).trim();

    const hermanoEsPackDirecto = Boolean(hermano.es_pack) && Number(hermano.pack_unidades) > 1 && !hermano.pack_hijo_codigo;
    if (hermanoEsPackDirecto) {
        const pesoUnitarioKg = Number(hermano.kilos_unidad || 1.2) / Number(hermano.pack_unidades || 24);
        const packUnidades = (packUnidadesOverride && Number(packUnidadesOverride) > 1)
            ? Number(packUnidadesOverride)
            : Math.max(1, Math.round(kilos / (pesoUnitarioKg || 0.05)));
        const gramosUnit = Math.round((pesoUnitarioKg || 0.05) * 1000);

        if (Math.abs(Number(hermano.kilos_unidad) - kilos) < 0.0005 && Number(hermano.pack_unidades) === packUnidades) {
            return {
                sku_nativo: idHermano,
                nomenclatura_bunker: descHermano,
                es_pack: true,
                pack_unidades: packUnidades,
                pack_hijo_codigo: hermano.pack_hijo_codigo || null,
                expresado_en_gramos: true,
                presentacion_etiqueta: `Pack ${packUnidades} u. (${gramos}g)`
            };
        }

        const skuDerivado = /\d+([xX]\d+)$/.test(idHermano)
            ? idHermano.replace(/\d+([xX]\d+)$/, `${packUnidades}$1`)
            : `${idHermano.replace(/\d+.*$/, '')}${packUnidades}X${gramosUnit}`;
        const nomDerivada = /\b\d+\s*x\s*\d+\s*g\b/i.test(descHermano)
            ? descHermano.replace(/\b\d+\s*x\s*\d+\s*g\b/i, `${packUnidades} x ${gramosUnit}g`)
            : `${descHermano.replace(/\s+x\s+.*$/i, '')} ${packUnidades} x ${gramosUnit}g`;

        return {
            sku_nativo: skuDerivado,
            nomenclatura_bunker: nomDerivada,
            es_pack: true,
            pack_unidades: packUnidades,
            pack_hijo_codigo: null,
            expresado_en_gramos: true,
            presentacion_etiqueta: `Pack ${packUnidades} u. (${gramos}g)`
        };
    }

    if (Math.abs(Number(hermano.kilos_unidad) - kilos) < 0.0005 && Number(hermano.pack_unidades || 1) === 1) {
        return {
            sku_nativo: idHermano,
            nomenclatura_bunker: descHermano,
            es_pack: Boolean(hermano.es_pack),
            pack_unidades: Number(hermano.pack_unidades || 1),
            pack_hijo_codigo: hermano.pack_hijo_codigo || null,
            expresado_en_gramos: hermano.expresado_en_gramos !== undefined ? Boolean(hermano.expresado_en_gramos) : (kilos < 1),
            presentacion_etiqueta: `Bolsa ${sufijoPeso}`
        };
    }

    let skuDerivado = idHermano;
    if (idHermano.toUpperCase() === 'CCTX1' && gramos < 1000) {
        skuDerivado = `CCTSx${gramos}`;
    } else if (gramos >= 1000 && gramos % 1000 === 0) {
        const kgEntero = gramos / 1000;
        skuDerivado = idHermano.replace(/([xX])\d+([gG]|KG|kg)?$/, `$1${kgEntero}`);
    } else if (/([xX])\d+([gG])$/.test(idHermano)) {
        skuDerivado = idHermano.replace(/([xX])\d+([gG])$/, `$1${gramos}$2`);
    } else if (/([xX])\d+$/.test(idHermano) && Number(hermano.kilos_unidad) < 1) {
        skuDerivado = idHermano.replace(/([xX])\d+$/, `$1${gramos}`);
    } else if (/([xX])(\d+|K|KG)$/i.test(idHermano)) {
        skuDerivado = idHermano.replace(/([xX])(\d+|K|KG)$/i, `X${gramos}G`);
    } else {
        skuDerivado = `${idHermano}X${gramos}G`;
    }

    const nomDerivada = /x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|grs?)\s*$/i.test(descHermano)
        ? descHermano.replace(/x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|grs?)\s*$/i, `x ${sufijoPeso}`)
        : `${descHermano} x ${sufijoPeso}`;

    return {
        sku_nativo: skuDerivado,
        nomenclatura_bunker: nomDerivada,
        es_pack: false,
        pack_unidades: 1,
        pack_hijo_codigo: null,
        expresado_en_gramos: kilos < 1,
        presentacion_etiqueta: `Bolsa ${sufijoPeso}`
    };
}

/**
 * Filtra y normaliza un mapa posiciones contra los ejes activos de bunker_familia_categorias
 * para garantizar 0 alertas de estructura_desfasada en bunkerController.js.
 */
async function sanitizarPosicionesContraFamiliaBunker(runner, familiaId, posicionesRaw = {}) {
    const q = runner || db;
    if (!familiaId || !posicionesRaw || typeof posicionesRaw !== 'object') return {};
    const catRes = await q.query(
        `SELECT categoria, orden_posicional
         FROM public.bunker_familia_categorias
         WHERE familia_id = $1
         ORDER BY orden_posicional ASC`,
        [Number(familiaId)]
    );
    const ejesValidos = new Map(
        catRes.rows.map(r => [normalizarEjeCategoriaBunker(r.categoria), Number(r.orden_posicional)])
    );
    const limpias = {};
    for (const [key, val] of Object.entries(posicionesRaw)) {
        if (!val || typeof val !== 'object') continue;
        const ejeNorm = normalizarEjeCategoriaBunker(val.eje);
        if (!ejeNorm || !ejesValidos.has(ejeNorm)) continue;
        const valorTxt = String(val.valor || '').trim();
        if (!valorTxt) continue;
        const posOrden = Number(val.posicion || ejesValidos.get(ejeNorm) || 1);
        limpias[key || `pos_${posOrden}`] = {
            eje: val.eje,
            valor: valorTxt,
            abreviatura: String(val.abreviatura || '').trim(),
            posicion: posOrden,
            silencioso: Boolean(val.silencioso),
            modo_display: String(val.modo_display || 'COMPLETO').toUpperCase() === 'ABREVIADO' ? 'ABREVIADO' : 'COMPLETO'
        };
    }
    return limpias;
}

function derivarPrefijoSkuDesdeDiccionario(cfg = {}, articuloVinculadoNumero = '') {
    const vinc = String(articuloVinculadoNumero || '').trim().toUpperCase();
    if (vinc && !vinc.startsWith('EMB-') && !vinc.startsWith('NB-')) {
        const baseVinc = vinc.replace(/([xX])(\d+|K|KG)$/i, '');
        if (baseVinc.length >= 2) return baseVinc;
    }
    const partes = [];
    if (cfg.incluir_familia) {
        const abFam = String(cfg.abreviatura_familia || cfg.familia_nombre || '').trim().toUpperCase();
        if (abFam) partes.push(abFam.slice(0, 1));
    }
    const prin = String(cfg.abreviatura_principal || cfg.articulo_principal || '').trim().toUpperCase();
    if (prin) {
        const palabrasPrin = prin.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
        partes.push(palabrasPrin.map(w => w.charAt(0)).join('').slice(0, 2) || prin.slice(0, 2));
    }
    const posOrdenadas = Object.values(cfg.posiciones || {})
        .filter(p => p && typeof p === 'object' && p.valor)
        .sort((a, b) => Number(a.posicion || 99) - Number(b.posicion || 99));
    for (const p of posOrdenadas) {
        const ab = String(p.abreviatura || p.valor || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
        if (ab) partes.push(ab.slice(0, 2));
    }
    const unido = partes.join('').replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return unido || 'ART';
}

/**
 * Resuelve la anatomía nativa completa de un artículo para Nodos Barriales directamente
 * desde las tablas relacionales de PostgreSQL (public.bunker_articulos, public.recetas,
 * public.receta_ingredientes, public.bunker_familias y public.bunker_diccionario):
 * - Caso 0: Si ya referencia un SKU nativo existente en public.bunker_articulos con igual peso, reutiliza su anatomía.
 * - Caso A: Si tiene artículo hermano en public.bunker_articulos que consume el mismo ingrediente_id, clona su
 *           familia_id, rubro, sub_rubro, sustantivo ancla y propiedades_dinamicas canónicas completas.
 * - Caso B: Si NO tiene hermano previo en Búnker, exige selectores relacionales del Diccionario Búnker (por PK IDs).
 */
async function resolverAnatomiaNativaArticuloNodo(runner, art = {}) {
    const q = runner || db;
    const kilos = Math.max(0.001, Number(art.kilos_unidad || 0.25));
    const gramos = Math.round(kilos * 1000);
    const sufijoPeso = (gramos >= 1000 && gramos % 1000 === 0) ? `${gramos / 1000}kg` : `${gramos}g`;

    const ingResuelto = art.ingrediente_origen_id
        ? await resolverIngredienteComercialDeterminista(q, art.ingrediente_origen_id)
        : null;
    const ingId = ingResuelto ? ingResuelto.id : (art.ingrediente_origen_id ? Number(art.ingrediente_origen_id) : null);

    let mixPadre = null;
    if (ingResuelto && ingResuelto.articulo_vinculado_numero) {
        mixPadre = await resolverMixPadreFlujo3(q, ingResuelto).catch(() => null);
    }

    const recomendarEnvasePorKilos = (kgVal) => {
        const kg = Number(kgVal || 0.25);
        if (kg <= 0.30) return 180; // Bolsa 15 x 18
        if (kg <= 0.60) return 179; // Bolsa 20 x 25
        if (kg <= 1.50) return 178; // Bolsa 20 x 30
        return 177;                 // Bolsa 30 x 40
    };

    const listasMayoristasInput = Array.isArray(art.listas_mayoristas_compartidas)
        ? art.listas_mayoristas_compartidas.map(Number).filter(Boolean)
        : [];
    const compartidoInput = art.compartido_mayorista !== undefined ? Boolean(art.compartido_mayorista) : (listasMayoristasInput.length > 0);

    // Caso 0: Artículo nativo existente en public.bunker_articulos con el mismo peso unitario
    const skuCandidato = String(art.sku_nodo || '').trim();
    if (
        skuCandidato &&
        !skuCandidato.toUpperCase().startsWith('NB-') &&
        !skuCandidato.toUpperCase().startsWith('EMB-') &&
        skuCandidato.toUpperCase() !== 'CCTX250G'
    ) {
        const dirRes = await q.query(
            `SELECT ba.*, bf.nombre AS familia_nombre_db, bf.abreviatura AS familia_abrev_db
             FROM public.bunker_articulos ba
             LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
             WHERE UPPER(ba.articulo_id) = UPPER($1)
             LIMIT 1`,
            [skuCandidato]
        );
        const dirArt = dirRes.rows[0] || null;
        if (dirArt && Math.abs(Number(dirArt.kilos_unidad || kilos) - kilos) < 0.002) {
            const recDirRes = await q.query(
                `SELECT ri.ingrediente_id, ri.cantidad,
                        ing.codigo AS ing_codigo, ing.nombre AS ing_nombre,
                        ing.articulo_vinculado_numero,
                        COALESCE(ing.costo_patron, 0) AS costo_patron,
                        COALESCE(ing.es_insumo, false) AS es_insumo
                 FROM public.recetas r
                 JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                 JOIN public.ingredientes ing ON ing.id = ri.ingrediente_id
                 WHERE UPPER(r.articulo_numero) = UPPER($1)
                 ORDER BY ri.id ASC`,
                [dirArt.articulo_id]
            );
            let insumoEnvaseRecetaId = null;
            let ingAlimentoRow = null;
            for (const rItem of recDirRes.rows) {
                if (rItem.es_insumo) {
                    if (Number(rItem.ingrediente_id) !== 181 && !insumoEnvaseRecetaId) {
                        insumoEnvaseRecetaId = Number(rItem.ingrediente_id);
                    }
                } else if (!ingAlimentoRow || Number(rItem.cantidad || 0) > Number(ingAlimentoRow.cantidad || 0)) {
                    ingAlimentoRow = rItem;
                }
            }
            const ingIdEfectivo = ingId || (ingAlimentoRow ? Number(ingAlimentoRow.ingrediente_id) : null);
            const artVincEfectivo = ingResuelto?.articulo_vinculado_numero || ingAlimentoRow?.articulo_vinculado_numero || null;
            if (!mixPadre && artVincEfectivo) {
                mixPadre = await resolverMixPadreFlujo3(q, { id: ingIdEfectivo, articulo_vinculado_numero: artVincEfectivo }).catch(() => null);
            }

            const famIdDir = Number(dirArt.familia_id || 1);
            const propDir = (dirArt.propiedades_dinamicas && typeof dirArt.propiedades_dinamicas === 'object')
                ? dirArt.propiedades_dinamicas
                : {};
            const posicionesDir = await sanitizarPosicionesContraFamiliaBunker(q, famIdDir, propDir.posiciones || {});
            const segundosDir = Number(propDir.asistente_minutos) > 0
                ? Math.round(Number(propDir.asistente_minutos) * 60)
                : null;
            const descOficial = dirArt.descripcion_generada || dirArt.descripcion || dirArt.articulo_id;
            const presEtiqueta = Boolean(dirArt.es_pack) && Number(dirArt.pack_unidades || 1) > 1
                ? `Pack ${dirArt.pack_unidades} u. (${gramos}g)`
                : `Bolsa ${sufijoPeso}`;

            return {
                existe_en_bunker: true,
                tiene_hermano_bunker: true,
                requiere_diccionario_bunker: false,
                hermano_referencia_sku: dirArt.articulo_id,
                ingrediente_comercial_id: ingIdEfectivo,
                ingrediente_comercial_codigo: ingResuelto?.codigo || ingAlimentoRow?.ing_codigo || null,
                ingrediente_comercial_nombre: ingResuelto?.nombre || ingAlimentoRow?.ing_nombre || art.ing_origen_nombre || null,
                ingrediente_comercial_label: ingResuelto
                    ? ingResuelto.label_oficial
                    : (ingAlimentoRow ? formatearEtiquetaTecnicaIngrediente({ id: ingIdEfectivo, codigo: ingAlimentoRow.ing_codigo, nombre: ingAlimentoRow.ing_nombre }) : null),
                ingrediente_comercial_costo_kg: ingResuelto?.costo_patron || Number(ingAlimentoRow?.costo_patron || art.costo_insumo_kg || 0),
                articulo_vinculado_numero: artVincEfectivo,
                mix_padre: mixPadre,
                sku_nativo: dirArt.articulo_id,
                familia_id: famIdDir,
                familia_nombre: dirArt.familia_nombre_db || propDir.familia_nombre || 'Frutos Secos',
                rubro: dirArt.rubro || null,
                sub_rubro: dirArt.sub_rubro || null,
                articulo_principal: dirArt.descripcion || propDir.articulo_principal || descOficial,
                nomenclatura_bunker: descOficial,
                nombre_publico_limpio: descOficial,
                presentacion_etiqueta: art.presentacion_etiqueta || presEtiqueta,
                es_pack: Boolean(dirArt.es_pack),
                pack_unidades: Number(dirArt.pack_unidades || 1),
                pack_hijo_codigo: dirArt.pack_hijo_codigo || null,
                expresado_en_gramos: Boolean(dirArt.expresado_en_gramos),
                segundos_nativos: segundosDir,
                insumo_envase_id: insumoEnvaseRecetaId || (ingIdEfectivo ? recomendarEnvasePorKilos(kilos) : null),
                envase_origen_receta: Boolean(insumoEnvaseRecetaId),
                compartido_mayorista: compartidoInput,
                listas_mayoristas_compartidas: listasMayoristasInput,
                propiedades_estructurales: {
                    familia_id: famIdDir,
                    familia_nombre: dirArt.familia_nombre_db || propDir.familia_nombre || '',
                    incluir_familia: Boolean(propDir.incluir_familia),
                    posicion_familia: propDir.posicion_familia || 'ANTES',
                    abreviatura_familia: propDir.abreviatura_familia ?? (dirArt.familia_abrev_db || ''),
                    modo_display_familia: propDir.modo_display_familia || 'COMPLETO',
                    articulo_principal: propDir.articulo_principal || dirArt.descripcion || '',
                    silencioso_principal: Boolean(propDir.silencioso_principal),
                    modo_display_principal: propDir.modo_display_principal || 'COMPLETO',
                    presentacion_variable_wip: false,
                    sufijo_wip: null
                },
                posiciones: posicionesDir
            };
        }
    }

    // Caso A: Buscar artículos hermanos canónicos en public.bunker_articulos que consuman el mismo ingrediente_id
    let hermanos = [];
    if (ingId) {
        const hermRes = await q.query(
            `SELECT ba.*, bf.nombre AS familia_nombre_db, bf.abreviatura AS familia_abrev_db
             FROM public.bunker_articulos ba
             LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
             JOIN public.recetas r ON UPPER(r.articulo_numero) = UPPER(ba.articulo_id)
             JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
             WHERE ri.ingrediente_id = $1
               AND UPPER(ba.articulo_id) NOT LIKE 'NB-%'
               AND UPPER(ba.articulo_id) NOT LIKE 'EMB-%'
               AND UPPER(ba.articulo_id) <> 'CCTX250G'
               AND COALESCE(ba.familia_id, 0) > 0
               AND COALESCE(ba.familia_id, 0) <> 42
             ORDER BY
               CASE WHEN ABS(COALESCE(ba.kilos_unidad, 1) - $2) < 0.0005 THEN 0 ELSE 1 END,
               CASE WHEN COALESCE(ba.kilos_unidad, 1) < 1 THEN 0 ELSE 1 END,
               ABS(COALESCE(ba.kilos_unidad, 1) - $2) ASC,
               ba.articulo_id ASC`,
            [ingId, kilos]
        );
        hermanos = hermRes.rows;
    }

    if (hermanos.length > 0) {
        const hermanoRef = hermanos[0];
        const derivado = derivarSkuYNomenclaturaDesdeHermano(hermanoRef, kilos, art.pack_unidades);

        const exactoEnHermanos = hermanos.find(
            h => String(h.articulo_id).toUpperCase() === String(derivado.sku_nativo).toUpperCase()
        ) || (Math.abs(Number(hermanoRef.kilos_unidad) - kilos) < 0.0005 ? hermanoRef : null);

        let insumoEnvaseRecetaId = null;
        if (exactoEnHermanos) {
            const envRecRes = await q.query(
                `SELECT ri.ingrediente_id, ri.cantidad
                 FROM public.recetas r
                 JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                 JOIN public.ingredientes i ON i.id = ri.ingrediente_id
                 WHERE UPPER(r.articulo_numero) = UPPER($1)
                   AND COALESCE(i.es_insumo, false) = true
                   AND ri.ingrediente_id <> 181
                 ORDER BY
                   CASE WHEN ABS(COALESCE(ri.cantidad, 1) - 1) < 0.05 THEN 0 ELSE 1 END,
                   ri.id DESC
                 LIMIT 1`,
                [exactoEnHermanos.articulo_id]
            );
            if (envRecRes.rows[0]) {
                insumoEnvaseRecetaId = Number(envRecRes.rows[0].ingrediente_id);
            }
        }

        const baseArt = exactoEnHermanos || hermanoRef;
        // Coalesce rubro y sub_rubro entre todos los hermanos del ingrediente por si el hermano más cercano los tuviera vacíos
        const hermanoConRubro = hermanos.find(h => h.rubro && String(h.rubro).trim() !== '') || baseArt;
        const hermanoConSubRubro = hermanos.find(h => h.sub_rubro && String(h.sub_rubro).trim() !== '') || hermanoConRubro;

        // Elegir el hermano con estructura propiedades_dinamicas más completa (con incluir_familia / articulo_principal o posiciones de objeto)
        const hermanoPropsCanonicas = hermanos.find(h => {
            const pd = h.propiedades_dinamicas;
            return pd && typeof pd === 'object' && (pd.articulo_principal !== undefined || pd.incluir_familia !== undefined);
        }) || baseArt;

        const propRef = (hermanoPropsCanonicas.propiedades_dinamicas && typeof hermanoPropsCanonicas.propiedades_dinamicas === 'object')
            ? hermanoPropsCanonicas.propiedades_dinamicas
            : {};
        const famId = Number(baseArt.familia_id || hermanoPropsCanonicas.familia_id || 1);
        const famNombre = baseArt.familia_nombre_db || propRef.familia_nombre || 'Frutos Secos';
        const posicionesSanas = await sanitizarPosicionesContraFamiliaBunker(q, famId, propRef.posiciones || {});

        const propsEstructurales = {
            familia_id: famId,
            familia_nombre: famNombre,
            incluir_familia: Boolean(propRef.incluir_familia),
            posicion_familia: propRef.posicion_familia || 'ANTES',
            abreviatura_familia: propRef.abreviatura_familia ?? (baseArt.familia_abrev_db || ''),
            modo_display_familia: propRef.modo_display_familia || 'COMPLETO',
            articulo_principal: propRef.articulo_principal || baseArt.descripcion || '',
            silencioso_principal: Boolean(propRef.silencioso_principal),
            modo_display_principal: propRef.modo_display_principal || 'COMPLETO',
            presentacion_variable_wip: false,
            sufijo_wip: null
        };

        const nomenclaturaEnsamblada = ensamblarDescripcionOficialBunker({
            ...propsEstructurales,
            posiciones: posicionesSanas,
            kilos_unidad: kilos,
            es_pack: derivado.es_pack,
            pack_unidades: derivado.pack_unidades
        });

        const nomenclaturaFinal = exactoEnHermanos
            ? (exactoEnHermanos.descripcion_generada || derivado.nomenclatura_bunker || nomenclaturaEnsamblada)
            : (derivado.nomenclatura_bunker || nomenclaturaEnsamblada);

        const segundosNativos = (exactoEnHermanos && Number(propRef.asistente_minutos) > 0)
            ? Math.round(Number(propRef.asistente_minutos) * 60)
            : null;

        return {
            modo_resolucion: exactoEnHermanos ? 'CASO_0_EXISTENTE' : 'CASO_A_HERMANO',
            existe_en_bunker: Boolean(exactoEnHermanos),
            tiene_hermano_bunker: true,
            requiere_diccionario_bunker: false,
            hermano_referencia_sku: baseArt.articulo_id,
            hermano_origen_sku: baseArt.articulo_id,
            ingrediente_comercial_id: ingId,
            ingrediente_comercial_codigo: ingResuelto?.codigo || null,
            ingrediente_comercial_nombre: ingResuelto?.nombre || art.ing_origen_nombre || null,
            ingrediente_comercial_label: ingResuelto ? ingResuelto.label_oficial : null,
            ingrediente_comercial_costo_kg: ingResuelto?.costo_patron || Number(art.costo_insumo_kg || 0),
            articulo_vinculado_numero: ingResuelto?.articulo_vinculado_numero || null,
            articulo_puente_numero: ingResuelto?.articulo_vinculado_numero || null,
            mix_padre: mixPadre,
            sku_nativo: exactoEnHermanos ? exactoEnHermanos.articulo_id : derivado.sku_nativo,
            familia_id: famId,
            familia_nombre: famNombre,
            rubro: baseArt.rubro || hermanoConRubro.rubro || null,
            sub_rubro: baseArt.sub_rubro || hermanoConSubRubro.sub_rubro || null,
            articulo_principal: baseArt.descripcion || propsEstructurales.articulo_principal,
            nomenclatura_bunker: nomenclaturaFinal,
            nombre_publico_limpio: nomenclaturaFinal,
            presentacion_etiqueta: art.presentacion_etiqueta || derivado.presentacion_etiqueta,
            es_pack: derivado.es_pack,
            pack_unidades: derivado.pack_unidades,
            pack_hijo_codigo: exactoEnHermanos ? (exactoEnHermanos.pack_hijo_codigo || null) : null,
            expresado_en_gramos: derivado.expresado_en_gramos,
            segundos_nativos: segundosNativos,
            insumo_envase_id: insumoEnvaseRecetaId || recomendarEnvasePorKilos(kilos),
            envase_origen_receta: Boolean(insumoEnvaseRecetaId),
            compartido_mayorista: compartidoInput,
            listas_mayoristas_compartidas: listasMayoristasInput,
            propiedades_estructurales: propsEstructurales,
            posiciones: posicionesSanas
        };
    }

    // Caso B: Sin hermano previo en public.bunker_articulos -> Construcción determinista por selectores del Diccionario Búnker (PK IDs)
    const famBunkerId = Number(art.familia_bunker_id || art.familia_id || 0);
    const artPrincipalId = Number(art.articulo_principal_id || 0);
    const artPrincipalTextoDirecto = String(art.articulo_principal_bunker || '').trim();
    const rubroInput = String(art.rubro_bunker || art.rubro || '').trim().toUpperCase();
    const subRubroInput = String(art.sub_rubro_bunker || art.sub_rubro || '').trim().toUpperCase();

    if (famBunkerId > 0 && (artPrincipalId > 0 || artPrincipalTextoDirecto)) {
        const famRowRes = await q.query(
            `SELECT id, nombre, abreviatura FROM public.bunker_familias WHERE id = $1 LIMIT 1`,
            [famBunkerId]
        );
        const famRow = famRowRes.rows[0] || null;
        if (famRow) {
            let principalRow = null;
            if (artPrincipalId > 0) {
                const pRes = await q.query(
                    `SELECT id, termino, abreviatura FROM public.bunker_diccionario WHERE id = $1 LIMIT 1`,
                    [artPrincipalId]
                );
                principalRow = pRes.rows[0] || null;
            } else if (artPrincipalTextoDirecto) {
                const pRes = await q.query(
                    `SELECT id, termino, abreviatura FROM public.bunker_diccionario
                     WHERE LOWER(categoria) = 'articulo_principal'
                       AND LOWER(termino) = LOWER($1)
                     LIMIT 1`,
                    [artPrincipalTextoDirecto]
                );
                principalRow = pRes.rows[0] || { id: null, termino: artPrincipalTextoDirecto, abreviatura: '' };
            }

            if (principalRow) {
                const catsFamRes = await q.query(
                    `SELECT id, categoria, orden_posicional
                     FROM public.bunker_familia_categorias
                     WHERE familia_id = $1
                     ORDER BY orden_posicional ASC`,
                    [famBunkerId]
                );
                const catsMap = new Map(catsFamRes.rows.map(c => [Number(c.id), c]));
                const catsByOrdenMap = new Map(catsFamRes.rows.map(c => [Number(c.orden_posicional), c]));
                let seleccionesPos = Array.isArray(art.posiciones_seleccionadas) ? [...art.posiciones_seleccionadas] : [];
                if (seleccionesPos.length === 0 && art.posiciones && typeof art.posiciones === 'object' && !Array.isArray(art.posiciones)) {
                    for (const [slotKey, slotVal] of Object.entries(art.posiciones)) {
                        if (!slotVal || typeof slotVal !== 'object') continue;
                        const ordenMatch = /^pos_(\d+)$/i.exec(slotKey);
                        const catFromOrden = ordenMatch ? catsByOrdenMap.get(Number(ordenMatch[1])) : null;
                        const catIdResolved = Number(slotVal.categoria_id || catFromOrden?.id || 0);
                        const termIdResolved = Number(slotVal.termino_id || 0);
                        if (catIdResolved > 0 && termIdResolved > 0) {
                            seleccionesPos.push({
                                categoria_id: catIdResolved,
                                termino_id: termIdResolved,
                                modo_display: slotVal.modo_display || 'COMPLETO',
                                silencioso: Boolean(slotVal.silencioso)
                            });
                        }
                    }
                }
                const posicionesConstruidas = {};

                for (const sel of seleccionesPos) {
                    const catId = Number(sel.categoria_id || 0);
                    const termId = Number(sel.termino_id || 0);
                    if (!catId || !termId || !catsMap.has(catId)) continue;
                    const catInfo = catsMap.get(catId);
                    const termRes = await q.query(
                        `SELECT id, termino, abreviatura FROM public.bunker_diccionario WHERE id = $1 AND COALESCE(obsoleto, false) = false LIMIT 1`,
                        [termId]
                    );
                    if (!termRes.rows[0]) continue;
                    const tRow = termRes.rows[0];
                    const orden = Number(catInfo.orden_posicional || 1);
                    posicionesConstruidas[`pos_${orden}`] = {
                        categoria_id: Number(catInfo.id),
                        termino_id: Number(tRow.id),
                        eje: normalizarEjeCategoriaBunker(catInfo.categoria),
                        valor: tRow.termino,
                        abreviatura: tRow.abreviatura || '',
                        posicion: orden,
                        silencioso: Boolean(sel.silencioso),
                        modo_display: String(sel.modo_display || 'COMPLETO').toUpperCase() === 'ABREVIADO' ? 'ABREVIADO' : 'COMPLETO'
                    };
                }

                const incluirFam = art.incluir_familia !== undefined ? Boolean(art.incluir_familia) : Boolean(famRow.abreviatura);
                const modoFamRaw = String(art.modo_display_familia || (famRow.abreviatura ? 'ABREVIADO' : 'COMPLETO')).toUpperCase();
                const modoFam = modoFamRaw.startsWith('ABREV') ? 'ABREVIADO' : 'COMPLETO';
                const propsEst = {
                    familia_id: Number(famRow.id),
                    familia_nombre: famRow.nombre,
                    incluir_familia: incluirFam,
                    posicion_familia: String(art.posicion_familia || 'ANTES').toUpperCase(),
                    abreviatura_familia: famRow.abreviatura || '',
                    modo_display_familia: modoFam,
                    articulo_principal: principalRow.termino,
                    abreviatura_principal: principalRow.abreviatura || '',
                    silencioso_principal: Boolean(art.silencioso_principal),
                    modo_display_principal: String(art.modo_display_principal || 'COMPLETO').toUpperCase(),
                    presentacion_variable_wip: false,
                    sufijo_wip: null
                };

                const descGenerada = ensamblarDescripcionOficialBunker({
                    ...propsEst,
                    posiciones: posicionesConstruidas,
                    kilos_unidad: kilos,
                    es_pack: false,
                    pack_unidades: 1
                });

                const skuExplicito = String(art.sku_nodo || '').trim();
                const prefSku = derivarPrefijoSkuDesdeDiccionario(
                    { ...propsEst, posiciones: posicionesConstruidas },
                    ingResuelto?.articulo_vinculado_numero || ''
                );
                const sufijoSku = (gramos >= 1000 && gramos % 1000 === 0) ? `X${gramos / 1000}` : `X${gramos}G`;
                const skuConstruido = (skuExplicito && !/^NB-/i.test(skuExplicito) && !/^EMB-/i.test(skuExplicito))
                    ? skuExplicito
                    : `${prefSku}${sufijoSku}`;

                return {
                    modo_resolucion: 'CASO_B_DICCIONARIO',
                    existe_en_bunker: false,
                    tiene_hermano_bunker: false,
                    requiere_diccionario_bunker: false,
                    hermano_referencia_sku: null,
                    hermano_origen_sku: null,
                    ingrediente_comercial_id: ingId,
                    ingrediente_comercial_codigo: ingResuelto?.codigo || null,
                    ingrediente_comercial_nombre: ingResuelto?.nombre || art.ing_origen_nombre || null,
                    ingrediente_comercial_label: ingResuelto ? ingResuelto.label_oficial : null,
                    ingrediente_comercial_costo_kg: ingResuelto?.costo_patron || Number(art.costo_insumo_kg || 0),
                    articulo_vinculado_numero: ingResuelto?.articulo_vinculado_numero || null,
                    articulo_puente_numero: ingResuelto?.articulo_vinculado_numero || null,
                    mix_padre: mixPadre,
                    sku_nativo: skuConstruido,
                    familia_id: Number(famRow.id),
                    familia_nombre: famRow.nombre,
                    rubro: rubroInput || famRow.nombre.toUpperCase(),
                    sub_rubro: subRubroInput || null,
                    articulo_principal: principalRow.termino,
                    nomenclatura_bunker: descGenerada,
                    nombre_publico_limpio: descGenerada,
                    presentacion_etiqueta: art.presentacion_etiqueta || `Bolsa ${sufijoPeso}`,
                    es_pack: false,
                    pack_unidades: 1,
                    pack_hijo_codigo: null,
                    expresado_en_gramos: kilos < 1,
                    segundos_nativos: null,
                    insumo_envase_id: recomendarEnvasePorKilos(kilos),
                    envase_origen_receta: false,
                    compartido_mayorista: compartidoInput,
                    listas_mayoristas_compartidas: listasMayoristasInput,
                    propiedades_estructurales: propsEst,
                    posiciones: posicionesConstruidas
                };
            }
        }
    }

    // Sin hermano en Búnker y aún sin selección relacional del Diccionario Búnker
    return {
        modo_resolucion: 'CASO_B_PENDIENTE',
        existe_en_bunker: false,
        tiene_hermano_bunker: false,
        requiere_diccionario_bunker: true,
        hermano_referencia_sku: null,
        hermano_origen_sku: null,
        ingrediente_comercial_id: ingId,
        ingrediente_comercial_codigo: ingResuelto?.codigo || null,
        ingrediente_comercial_nombre: ingResuelto?.nombre || art.ing_origen_nombre || null,
        ingrediente_comercial_label: ingResuelto ? ingResuelto.label_oficial : null,
        ingrediente_comercial_costo_kg: ingResuelto?.costo_patron || Number(art.costo_insumo_kg || 0),
        articulo_vinculado_numero: ingResuelto?.articulo_vinculado_numero || null,
        articulo_puente_numero: ingResuelto?.articulo_vinculado_numero || null,
        mix_padre: mixPadre,
        sku_nativo: '',
        familia_id: null,
        familia_nombre: null,
        rubro: null,
        sub_rubro: null,
        articulo_principal: null,
        nomenclatura_bunker: '',
        nombre_publico_limpio: '',
        presentacion_etiqueta: `Bolsa ${sufijoPeso}`,
        es_pack: false,
        pack_unidades: 1,
        pack_hijo_codigo: null,
        expresado_en_gramos: kilos < 1,
        segundos_nativos: null,
        insumo_envase_id: recomendarEnvasePorKilos(kilos),
        envase_origen_receta: false,
        compartido_mayorista: compartidoInput,
        listas_mayoristas_compartidas: listasMayoristasInput,
        propiedades_estructurales: null,
        posiciones: {}
    };
}

/**
 * Previsualiza en vivo para la Mesa Cotizadora de LAMDA la anatomía exacta en Búnker
 * (SKU nativo, cadena relacional de ingrediente/puente/mix padre, envase primario real y nomenclatura oficial).
 */
async function previsualizarAnatomiaCotizacionNodo(payload = {}) {
    await asegurarEsquemaNodosBarriales();
    const anatomia = await resolverAnatomiaNativaArticuloNodo(db, payload);
    return {
        ...anatomia,
        etiqueta_oficial_lamda: anatomia.sku_nativo && anatomia.nomenclatura_bunker
            ? formatearEtiquetaTecnicaArticulo(anatomia.sku_nativo, anatomia.nomenclatura_bunker)
            : ''
    };
}

/**
 * Fórmula unificada del Cotizador de Nodos LAMDA y la Calculadora Financiera del Búnker (BunkerService):
 * PrecioBaseNodoSinIVA = (CostoInsumoKg * KilosFraccion + CostoEnvaseTotal) * (1 + MargenLAMDA%/100) + CostoTiempoMO
 * PrecioBaseNodoFinal  = Math.round(PrecioBaseNodoSinIVA * (1 + IVA%/100))
 * IIBB (4% sobre Neto sin IVA) se descuenta de la ganancia bruta para obtener la Ganancia Neta Real LAMDA.
 */
function calcularEstructuraCostosNodo(params = {}) {
    const costoInsumoKg = Math.max(0, Number(params.costo_insumo_kg) || 0);
    const kilosUnidad = Math.max(0.001, Number(params.kilos_unidad) || 0.25);
    const costoEnvaseUnitario = Math.max(0, Number(params.costo_envase_unitario) || 0);
    const cantidadEnvases = Math.max(0, Number(params.cantidad_envases_unidad ?? 1));
    const costoEnvaseExtra = Math.max(0, Number(params.costo_envase_extra ?? 0));
    const segundosFraccionamiento = Math.max(0, Number(params.segundos_fraccionamiento ?? 35));
    const valorHoraAplicado = Math.max(0, Number(params.valor_hora_aplicado ?? 7000));
    const margenLamdaPct = Math.max(0, Number(params.margen_lamda_pct ?? 22));
    const ivaPct = Math.max(0, Number(params.iva_pct ?? 21));
    const iibbPct = Math.max(0, Number(params.iibb_pct ?? 4.0));
    const margenSugeridoGestorPct = Math.max(0, Number(params.margen_sugerido_gestor_pct ?? 28));

    const costoInsumoFraccion = Number((costoInsumoKg * kilosUnidad).toFixed(2));
    const costoEnvaseAplicado = params.costo_envase_total_override !== undefined
        ? Number(Number(params.costo_envase_total_override).toFixed(2))
        : Number((costoEnvaseUnitario * cantidadEnvases + costoEnvaseExtra).toFixed(2));
    const costoManoObraAplicado = Number(((segundosFraccionamiento / 3600) * valorHoraAplicado).toFixed(2));

    const costoMateriaYEnvase = Number((costoInsumoFraccion + costoEnvaseAplicado).toFixed(2));
    const costoPuroTotal = Number((costoMateriaYEnvase + costoManoObraAplicado).toFixed(2));

    const gananciaLamdaBruta = Number((costoMateriaYEnvase * (margenLamdaPct / 100)).toFixed(2));
    const precioBaseNodoNeto = Number((costoMateriaYEnvase + gananciaLamdaBruta + costoManoObraAplicado).toFixed(2));

    const coefIva = 1 + (ivaPct / 100);
    const montoIva = Number((precioBaseNodoNeto * (ivaPct / 100)).toFixed(2));
    const precioBaseNodoFinal = Math.round(precioBaseNodoNeto * coefIva);

    // IIBB como deducción de ganancia neta (idéntico a BunkerService línea 3334)
    const montoIibb = Number((precioBaseNodoNeto * (iibbPct / 100)).toFixed(2));
    const gananciaLamdaNeta = Number((gananciaLamdaBruta - montoIibb).toFixed(2));

    // Motor fiscal único sobre margen del Nodo (descontando IVA e IIBB sobre el excedente comercial)
    const calcMargenNodo = calcularPrecioYGananciaNetaOfertaNodo({
        costoBaseLamda: precioBaseNodoFinal,
        margenPct: margenSugeridoGestorPct,
        ivaPct: params.alicuota_iva_margen_pct ?? 21,
        iibbPct: params.alicuota_iibb_margen_pct ?? 4,
        modo: 'margen'
    });
    const precioSugeridoVecino = calcMargenNodo.precio_tienda;
    const gananciaUnitariaGestor = calcMargenNodo.ganancia_neta_nodo;

    return {
        costo_insumo_kg: Number(costoInsumoKg.toFixed(2)),
        kilos_unidad: Number(kilosUnidad.toFixed(4)),
        costo_insumo_fraccion: costoInsumoFraccion,
        costo_envase_aplicado: costoEnvaseAplicado,
        segundos_fraccionamiento: Number(segundosFraccionamiento.toFixed(2)),
        valor_hora_aplicado: Number(valorHoraAplicado.toFixed(2)),
        costo_mano_obra_aplicado: costoManoObraAplicado,
        costo_puro_total: costoPuroTotal,
        margen_lamda_pct: Number(margenLamdaPct.toFixed(2)),
        ganancia_lamda_bruta: gananciaLamdaBruta,
        ganancia_lamda_neta: gananciaLamdaNeta,
        precio_base_nodo_neto: precioBaseNodoNeto,
        iva_pct: Number(ivaPct.toFixed(2)),
        iibb_pct: Number(iibbPct.toFixed(2)),
        monto_impuestos: montoIva,
        monto_iibb: montoIibb,
        precio_base_nodo_final: precioBaseNodoFinal,
        margen_sugerido_gestor_pct: Number(calcMargenNodo.margen_pct.toFixed(2)),
        precio_sugerido_vecino: precioSugeridoVecino,
        ganancia_unitaria_gestor: gananciaUnitariaGestor,
        retencion_fiscal_unitaria_margen: calcMargenNodo.retencion_fiscal_unitaria,
        alicuota_iva_margen_pct: calcMargenNodo.alicuota_iva_pct,
        alicuota_iibb_margen_pct: calcMargenNodo.alicuota_iibb_pct
    };
}

/**
 * Normaliza una alícuota impositiva porcentual (ej: 21.00 para IVA, 4.00 para IIBB).
 */
function normalizarAlicuotaFiscalNodo(val, fallback = 0) {
    if (val === undefined || val === null || val === '') return Number(fallback);
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0) return Number(fallback);
    return Number(Math.min(90, num).toFixed(2));
}

/**
 * Factor neto limpio para el Nodo/Creador sobre el excedente bruto (precio_tienda - costo_base_lamda):
 *   iva_excedente = excedente_bruto - (excedente_bruto / (1 + iva/100))
 *   iibb_excedente = excedente_bruto * (iibb/100)
 *   factor_neto = (1 / (1 + iva/100)) - (iibb/100)
 * Con IVA=21% e IIBB=4% -> factor_neto = 0.78644628... (78,64% limpio y 21,36% retención fiscal LAMDA).
 */
function obtenerFactorNetoMargenNodo(ivaPct = 21, iibbPct = 4) {
    const iva = normalizarAlicuotaFiscalNodo(ivaPct, 21);
    const iibb = normalizarAlicuotaFiscalNodo(iibbPct, 4);
    const factor = (1 / (1 + iva / 100)) - (iibb / 100);
    return Math.max(0.01, factor);
}

/**
 * Desglosa de forma determinista y sin deriva de redondeo la retención fiscal (IVA + IIBB)
 * y la ganancia limpia sobre cualquier excedente bruto de productos.
 * Garantiza identidad contable exacta: ganancia_neta + retencion_fiscal_total === excedente_bruto,
 * e iva_excedente + iibb_excedente === retencion_fiscal_total.
 */
function desglosarRetencionFiscalExcedente(excedenteBruto, ivaPct = 21, iibbPct = 4) {
    const iva = normalizarAlicuotaFiscalNodo(ivaPct, 21);
    const iibb = normalizarAlicuotaFiscalNodo(iibbPct, 4);
    const excedente = Math.max(0, Number(Number(excedenteBruto || 0).toFixed(2)));
    const factorNeto = obtenerFactorNetoMargenNodo(iva, iibb);
    const gananciaNeta = Math.round(excedente * factorNeto);
    const retencionTotal = Math.max(0, Number((excedente - gananciaNeta).toFixed(2)));
    const iibbExcedente = Math.min(retencionTotal, Math.round(excedente * (iibb / 100)));
    const ivaExcedente = Math.max(0, Number((retencionTotal - iibbExcedente).toFixed(2)));

    return {
        excedente_bruto: excedente,
        ganancia_neta: gananciaNeta,
        retencion_fiscal_total: retencionTotal,
        iva_excedente: ivaExcedente,
        iibb_excedente: iibbExcedente,
        alicuota_iva_pct: iva,
        alicuota_iibb_pct: iibb,
        factor_neto: factorNeto
    };
}

/**
 * Motor matemático único y bidireccional (% <-> $) para ofertas de Nodos:
 *  - modo 'margen': precio_tienda = Math.round(base * (1 + margen_pct/100)), ganancia_neta = Math.round((precio_tienda - base) * factor_neto)
 *  - modo 'ganancia_neta': excedente_necesario = ganancia_deseada / factor_neto, precio_tienda = Math.round(base + excedente_necesario), margen_pct = (((precio_tienda - base)/base)*100).toFixed(2)
 *  - modo 'precio': precio_tienda = Math.round(precio), margen_pct = (((precio_tienda - base)/base)*100).toFixed(2), ganancia_neta = Math.round((precio_tienda - base) * factor_neto)
 */
function calcularPrecioYGananciaNetaOfertaNodo(opts = {}) {
    const costoBaseRaw = opts.costoBaseLamda !== undefined ? opts.costoBaseLamda : opts.costo_base_lamda;
    const margenRaw = opts.margenPct !== undefined ? opts.margenPct : opts.margen_pct;
    const ganDeseadaRaw = opts.gananciaNetaDeseada !== undefined ? opts.gananciaNetaDeseada : opts.ganancia_neta_deseada;
    const precioRaw = opts.precioTienda !== undefined ? opts.precioTienda : opts.precio_tienda;
    const ivaRaw = opts.ivaPct !== undefined ? opts.ivaPct : (opts.iva_pct !== undefined ? opts.iva_pct : opts.alicuota_iva_margen_pct);
    const iibbRaw = opts.iibbPct !== undefined ? opts.iibbPct : (opts.iibb_pct !== undefined ? opts.iibb_pct : opts.alicuota_iibb_margen_pct);
    const modoEfectivo = opts.modo
        || (ganDeseadaRaw !== undefined ? 'ganancia_neta' : (precioRaw !== undefined ? 'precio' : 'margen'));

    const base = Math.max(0, Math.round(Number(costoBaseRaw || 0)));
    const iva = normalizarAlicuotaFiscalNodo(ivaRaw, 21);
    const iibb = normalizarAlicuotaFiscalNodo(iibbRaw, 4);
    const factorNeto = obtenerFactorNetoMargenNodo(iva, iibb);

    let precioFinal = base;
    let margenFinal = 0;

    if (modoEfectivo === 'ganancia_neta') {
        const ganDeseada = Math.max(0, Number(ganDeseadaRaw || 0));
        const excedenteBrutoNecesario = ganDeseada / factorNeto;
        precioFinal = Math.max(base, Math.round(base + excedenteBrutoNecesario));
        margenFinal = base > 0 ? Number((((precioFinal - base) / base) * 100).toFixed(2)) : 0;
    } else if (modoEfectivo === 'precio') {
        precioFinal = Math.max(base, Math.round(Number(precioRaw || 0)));
        margenFinal = base > 0 ? Number((((precioFinal - base) / base) * 100).toFixed(2)) : 0;
    } else {
        margenFinal = Math.max(0, Number(Number(margenRaw || 0).toFixed(2)));
        precioFinal = Math.max(base, Math.round(base * (1 + margenFinal / 100)));
    }

    const excedenteReal = Math.max(0, precioFinal - base);
    const gananciaNeta = Math.round(excedenteReal * factorNeto);
    const retencionUnitaria = Math.max(0, excedenteReal - gananciaNeta);

    return {
        costo_base_lamda: base,
        margen_pct: margenFinal,
        precio_tienda: precioFinal,
        excedente_bruto: excedenteReal,
        ganancia_neta_nodo: gananciaNeta,
        retencion_fiscal_unitaria: retencionUnitaria,
        factor_neto: factorNeto,
        alicuota_iva_pct: iva,
        alicuota_iibb_pct: iibb
    };
}

/**
 * Recalcula cronológicamente una Cuenta Corriente Principal del Búnker (ej: CB-0006 de Matías)
 * siguiendo la convención estándar de cuentaCorrienteService.js:
 * saldo_apertura + SUM(DEBITO) - SUM(CREDITO)
 */
async function recalcularSaldosCuentaMadreBunker(client, ccId) {
    if (!ccId) return 0;
    const resCCInfo = await client.query(
        'SELECT saldo_apertura FROM public.factura_cuentas_corrientes WHERE id = $1 LIMIT 1',
        [Number(ccId)]
    );
    const saldoApertura = resCCInfo.rows.length > 0 ? Number(resCCInfo.rows[0].saldo_apertura || 0) : 0;

    const resMovs = await client.query(
        `SELECT id, tipo_movimiento, monto
         FROM public.factura_cuenta_corriente_movimientos
         WHERE cuenta_corriente_id = $1
         ORDER BY fecha_movimiento ASC, id ASC`,
        [Number(ccId)]
    );

    let saldoAcumulado = saldoApertura;
    for (const mov of resMovs.rows) {
        const m = Number(mov.monto || 0);
        if (mov.tipo_movimiento === 'DEBITO') {
            saldoAcumulado += m;
        } else if (mov.tipo_movimiento === 'CREDITO') {
            saldoAcumulado -= m;
        }
        saldoAcumulado = Number(saldoAcumulado.toFixed(2));
        await client.query(
            'UPDATE public.factura_cuenta_corriente_movimientos SET saldo_resultante = $1 WHERE id = $2',
            [saldoAcumulado, mov.id]
        );
    }

    await client.query(
        'UPDATE public.factura_cuentas_corrientes SET saldo = $1, actualizada_en = NOW() WHERE id = $2',
        [saldoAcumulado, Number(ccId)]
    );
    return saldoAcumulado;
}

/**
 * Resuelve la Cuenta Corriente destino activa para operaciones contables de un Nodo Barrial.
 * Cuando `usar_cuenta_madre_unificada = true` y el Nodo tiene cliente madre valido, apunta directo
 * a la "Cuenta Principal" de la ficha madre (ej. CB-0006); caso contrario usa la subcuenta aislada CB-NODO-xxx.
 *
 * @param {Object} client - Conexion/transaccion pg
 * @param {Object} nodoLike - Fila o subconjunto de campos de `nodos_maestro`
 * @returns {Promise<{ usaCuentaMadreUnificada: boolean, ccId: number|null, saldo: number, codigoBunkerDestino: string|null, etiquetaNodo: string|null, subcuentaCodigoOrigen: string|null }>}
 */
async function resolverCuentaContableOperativaNodo(client, nodoLike = {}) {
    const nombreMarca = String(nodoLike.nombre_marca || '').trim();
    const etiquetaNodo = nombreMarca ? `Nodo ${nombreMarca}` : 'Nodo Barrial';
    const subcuentaCod = nodoLike.codigo_bunker_cliente ? String(nodoLike.codigo_bunker_cliente).trim() : null;
    const usarUnificada = Boolean(nodoLike.usar_cuenta_madre_unificada);

    if (usarUnificada && (nodoLike.codigo_bunker_cliente_madre || nodoLike.cliente_madre_bunker_id)) {
        let codigoMadre = nodoLike.codigo_bunker_cliente_madre
            ? String(nodoLike.codigo_bunker_cliente_madre).trim()
            : '';
        if (!codigoMadre && nodoLike.cliente_madre_bunker_id) {
            const mRes = await client.query(
                'SELECT codigo_bunker_cliente FROM public.bunker_clientes WHERE id = $1 LIMIT 1',
                [Number(nodoLike.cliente_madre_bunker_id)]
            );
            if (mRes.rows.length > 0) {
                codigoMadre = String(mRes.rows[0].codigo_bunker_cliente || '').trim();
            }
        }
        if (codigoMadre && (!subcuentaCod || codigoMadre.toUpperCase() !== subcuentaCod.toUpperCase())) {
            const ccMadre = await obtenerOCrearCuentaPrincipalBunker(client, codigoMadre, {
                forUpdate: true,
                crearSiNoExiste: true
            });
            return {
                usaCuentaMadreUnificada: true,
                ccId: ccMadre ? Number(ccMadre.id) : null,
                saldo: Number(ccMadre?.saldo || 0),
                codigoBunkerDestino: codigoMadre,
                etiquetaNodo,
                subcuentaCodigoOrigen: subcuentaCod
            };
        }
    }

    if (!subcuentaCod) {
        return {
            usaCuentaMadreUnificada: false,
            ccId: null,
            saldo: 0,
            codigoBunkerDestino: null,
            etiquetaNodo: nombreMarca ? `Nodo ${nombreMarca}` : null,
            subcuentaCodigoOrigen: null
        };
    }

    const ccRes = await client.query(
        `SELECT id, saldo
         FROM public.factura_cuentas_corrientes
         WHERE codigo_bunker_cliente = $1
         ORDER BY CASE WHEN nombre_cuenta = 'Cuenta Principal' THEN 0 ELSE 1 END, id ASC
         LIMIT 1
         FOR UPDATE`,
        [subcuentaCod]
    );
    return {
        usaCuentaMadreUnificada: false,
        ccId: ccRes.rows[0]?.id ? Number(ccRes.rows[0].id) : null,
        saldo: Number(ccRes.rows[0]?.saldo || 0),
        codigoBunkerDestino: subcuentaCod,
        etiquetaNodo: nombreMarca ? `Nodo ${nombreMarca}` : null,
        subcuentaCodigoOrigen: subcuentaCod
    };
}

/**
 * Consolida de forma segura cualquier movimiento o saldo de apertura previo de la subcuenta `CB-NODO-...`
 * en la Cuenta Madre cuando `usar_cuenta_madre_unificada = true`, y marca dicha subcuenta como
 * `ARCHIVADA_UNIFICADA` (o la reactiva si la bandera vuelve a `false`). Es 100% idempotente.
 */
async function sincronizarArchivoYConsolidacionSubcuentaNodo(client, nodoId) {
    const nRes = await client.query(
        `SELECT nm.*,
                bc_m.codigo_bunker_cliente AS madre_codigo_real
         FROM public.nodos_maestro nm
         LEFT JOIN public.bunker_clientes bc_m ON bc_m.id = nm.cliente_madre_bunker_id
         WHERE nm.id = $1::int
         FOR UPDATE OF nm`,
        [Number(nodoId)]
    );
    if (nRes.rows.length === 0) {
        throw new Error(`Nodo ID ${nodoId} no encontrado para sincronizar estado de subcuenta.`);
    }
    const nodo = nRes.rows[0];
    const subCod = String(nodo.codigo_bunker_cliente || '').trim();
    const usarUnificada = Boolean(nodo.usar_cuenta_madre_unificada);

    if (!usarUnificada) {
        if (subCod) {
            await client.query(
                `UPDATE public.factura_cuentas_corrientes
                 SET estado = 'ACTIVA',
                     actualizada_en = NOW()
                 WHERE codigo_bunker_cliente = $1
                   AND estado = 'ARCHIVADA_UNIFICADA'`,
                [subCod]
            );
        }
        return {
            unificada: false,
            nodo_id: Number(nodo.id),
            codigo_nodo: nodo.codigo_nodo,
            subcuenta: subCod || null,
            movimientos_consolidados: 0,
            saldo_apertura_consolidado: 0
        };
    }

    const madreId = nodo.cliente_madre_bunker_id ? Number(nodo.cliente_madre_bunker_id) : null;
    const madreCod = String(nodo.madre_codigo_real || nodo.codigo_bunker_cliente_madre || '').trim();
    if (!madreId || !madreCod || (nodo.bunker_cliente_id && madreId === Number(nodo.bunker_cliente_id))) {
        throw new Error('Para activar Cuenta Madre Unificada el Nodo debe estar vinculado a un Cliente Titular Madre válido.');
    }

    const ccMadre = await obtenerOCrearCuentaPrincipalBunker(client, madreCod, {
        forUpdate: true,
        crearSiNoExiste: true
    });

    let movimientosConsolidados = 0;
    let saldoAperturaConsolidado = 0;
    const tagNodo = `Nodo ${nodo.nombre_marca || nodo.codigo_nodo}`;

    if (subCod) {
        const subCcsRes = await client.query(
            `SELECT id, saldo, saldo_apertura, estado
             FROM public.factura_cuentas_corrientes
             WHERE codigo_bunker_cliente = $1
             ORDER BY id ASC
             FOR UPDATE`,
            [subCod]
        );

        for (const subCc of subCcsRes.rows) {
            if (Number(subCc.id) === Number(ccMadre.id)) continue;

            const cntRes = await client.query(
                `SELECT COUNT(*)::int AS total
                 FROM public.factura_cuenta_corriente_movimientos
                 WHERE cuenta_corriente_id = $1`,
                [subCc.id]
            );
            const totalMovs = Number(cntRes.rows[0]?.total || 0);

            if (totalMovs > 0) {
                const movUpd = await client.query(
                    `UPDATE public.factura_cuenta_corriente_movimientos
                     SET cuenta_corriente_id = $1,
                         descripcion = CASE
                             WHEN LOWER(COALESCE(descripcion, '')) LIKE $2 THEN COALESCE(descripcion, '')
                             WHEN COALESCE(TRIM(descripcion), '') = '' THEN $3
                             ELSE TRIM(descripcion) || ' — ' || $3
                         END,
                         metadatos = COALESCE(metadatos, '{}'::jsonb) || $4::jsonb
                     WHERE cuenta_corriente_id = $5
                     RETURNING id`,
                    [
                        ccMadre.id,
                        `%${tagNodo.toLowerCase()}%`,
                        `${tagNodo} (consolidado desde ${subCod})`,
                        JSON.stringify({
                            consolidado_desde_subcuenta: subCod,
                            subcuenta_cc_origen_id: Number(subCc.id),
                            nodo_id: Number(nodo.id),
                            codigo_nodo: nodo.codigo_nodo
                        }),
                        subCc.id
                    ]
                );
                movimientosConsolidados += movUpd.rows.length;
            }

            const saldoAp = Number(subCc.saldo_apertura || 0);
            if (Math.abs(saldoAp) > 0.001) {
                await client.query(
                    `INSERT INTO public.factura_cuenta_corriente_movimientos (
                        cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                        tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                        creado_en, metadatos
                     ) VALUES ($1, $2, $3, 0, 'CONSOLIDACION_SUBCUENTA_NODO', NULL, $4, NOW(), NOW(), $5)`,
                    [
                        ccMadre.id,
                        saldoAp > 0 ? 'DEBITO' : 'CREDITO',
                        Math.abs(saldoAp),
                        `Consolidación saldo apertura subcuenta ${subCod} — ${tagNodo}`,
                        JSON.stringify({
                            consolidacion_apertura_subcuenta: subCod,
                            nodo_id: Number(nodo.id),
                            saldo_apertura_original: saldoAp
                        })
                    ]
                );
                await client.query(
                    `UPDATE public.factura_cuentas_corrientes
                     SET saldo_apertura = 0.00
                     WHERE id = $1`,
                    [subCc.id]
                );
                saldoAperturaConsolidado = Number((saldoAperturaConsolidado + saldoAp).toFixed(2));
            }

            await recalcularSaldosCuentaMadreBunker(client, subCc.id);
        }

        // Reasignar eventuales sobres o vínculos bancarios/cheques históricos si existieran en la subcuenta
        await client.query(
            `UPDATE public.factura_pagos_efectivo
             SET cliente_id = $1,
                 observaciones_cliente = CASE
                     WHEN LOWER(COALESCE(observaciones_cliente, '')) LIKE $2 THEN observaciones_cliente
                     WHEN COALESCE(TRIM(observaciones_cliente), '') = '' THEN $3
                     ELSE TRIM(observaciones_cliente) || ' (' || $3 || ')'
                 END
             WHERE UPPER(cliente_id) = UPPER($4)`,
            [madreCod, `%${tagNodo.toLowerCase()}%`, tagNodo, subCod]
        );
        if (nodo.bunker_cliente_id) {
            await client.query(
                `UPDATE public.fin_movimientos_bancarios
                 SET cliente_id = $1
                 WHERE cliente_id = $2`,
                [madreId, Number(nodo.bunker_cliente_id)]
            );
            await client.query(
                `UPDATE public.fin_cheques_vinculados
                 SET cliente_id = $1
                 WHERE cliente_id = $2`,
                [madreId, Number(nodo.bunker_cliente_id)]
            );
        }

        await client.query(
            `UPDATE public.factura_cuentas_corrientes
             SET estado = 'ARCHIVADA_UNIFICADA',
                 actualizada_en = NOW()
             WHERE codigo_bunker_cliente = $1
               AND id <> $2`,
            [subCod, ccMadre.id]
        );
    }

    const saldoMadreFinal = await recalcularSaldosCuentaMadreBunker(client, ccMadre.id);

    return {
        unificada: true,
        nodo_id: Number(nodo.id),
        codigo_nodo: nodo.codigo_nodo,
        subcuenta: subCod || null,
        codigo_madre: madreCod,
        madre_bunker_id: madreId,
        movimientos_consolidados: movimientosConsolidados,
        saldo_apertura_consolidado: saldoAperturaConsolidado,
        saldo_madre_final: saldoMadreFinal
    };
}

/**
 * Activa de forma idempotente la modalidad `usar_cuenta_madre_unificada = true` para un Nodo
 * (por defecto NODO-001 -> CB-0006), consolidando de forma segura cualquier movimiento previo
 * de CB-NODO-... en la Cuenta Madre y marcando la subcuenta como `ARCHIVADA_UNIFICADA`.
 * No modifica ni afecta a otros nodos (ej. MANSO / NODO-002).
 */
async function activarCuentaMadreUnificadaNodo(runnerOrNull = null, opciones = {}) {
    const codigoNodo = String(opciones.codigo_nodo || 'NODO-001').trim();
    const codigoMadreObjetivo = String(opciones.codigo_bunker_cliente_madre || 'CB-0006').trim();

    const ejecutarEnClient = async (client) => {
        const nodoRes = await client.query(
            `SELECT id, codigo_nodo, nombre_marca, bunker_cliente_id, codigo_bunker_cliente,
                    cliente_madre_bunker_id, codigo_bunker_cliente_madre, usar_cuenta_madre_unificada
             FROM public.nodos_maestro
             WHERE UPPER(codigo_nodo) = UPPER($1)
                OR ($2::text <> '' AND LOWER(slug) = LOWER($2))
             ORDER BY CASE WHEN UPPER(codigo_nodo) = UPPER($1) THEN 0 ELSE 1 END, id ASC
             LIMIT 1
             FOR UPDATE`,
            [codigoNodo, String(opciones.slug || '')]
        );
        if (nodoRes.rows.length === 0) {
            return { activated: false, reason: 'NODO_NO_ENCONTRADO', codigo_nodo: codigoNodo };
        }
        const nodo = nodoRes.rows[0];

        const madreRes = await client.query(
            `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social
             FROM public.bunker_clientes
             WHERE UPPER(codigo_bunker_cliente) = UPPER($1)
             LIMIT 1`,
            [codigoMadreObjetivo]
        );
        if (madreRes.rows.length === 0) {
            throw new Error(`No se encontró el Cliente Madre ${codigoMadreObjetivo} en public.bunker_clientes.`);
        }
        const madre = madreRes.rows[0];

        await client.query(
            `UPDATE public.nodos_maestro
             SET cliente_madre_bunker_id = $1,
                 codigo_bunker_cliente_madre = $2,
                 usar_cuenta_madre_unificada = true,
                 updated_at = NOW()
             WHERE id = $3::int`,
            [madre.id, madre.codigo_bunker_cliente, nodo.id]
        );

        const consolidacion = await sincronizarArchivoYConsolidacionSubcuentaNodo(client, nodo.id);
        return {
            activated: true,
            already_unified: Boolean(nodo.usar_cuenta_madre_unificada) && consolidacion.movimientos_consolidados === 0,
            ...consolidacion
        };
    };

    const esPool = Boolean(
        runnerOrNull &&
        typeof runnerOrNull.connect === 'function' &&
        typeof runnerOrNull.release !== 'function' &&
        typeof runnerOrNull.totalCount === 'number'
    );
    if (runnerOrNull && typeof runnerOrNull.query === 'function' && !esPool) {
        return ejecutarEnClient(runnerOrNull);
    }

    const poolToUse = esPool ? runnerOrNull : db;
    const client = await poolToUse.connect();
    try {
        await client.query('BEGIN');
        const res = await ejecutarEnClient(client);
        await client.query('COMMIT');
        return res;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Normaliza en forma canónica un número telefónico móvil/fijo argentino de 10 dígitos
 * (ej: "+54 9 221 501-1101", "0221-15-5011101" y "221 501-1101" convergen todos en "2215011101").
 */
function normalizarTelefonoVecinoNodo(rawTel = '') {
    let d = String(rawTel || '').replace(/\D+/g, '');
    if (!d) return '';

    if (d.startsWith('00549') && d.length >= 14) {
        d = d.slice(5);
    } else if (d.startsWith('0054') && d.length >= 13) {
        d = d.slice(4);
    } else if (d.startsWith('549') && d.length >= 12) {
        d = d.slice(3);
    } else if (d.startsWith('54') && d.length >= 11) {
        d = d.slice(2);
    }

    if (d.startsWith('0') && d.length >= 11) {
        d = d.slice(1);
    }

    if (d.length === 12) {
        if (d.startsWith('1115')) {
            d = '11' + d.slice(4);
        } else if (/^[23]\d{2}15\d{7}$/.test(d)) {
            d = d.slice(0, 3) + d.slice(5);
        } else if (/^[23]\d{3}15\d{6}$/.test(d)) {
            d = d.slice(0, 4) + d.slice(6);
        }
    }

    return d;
}

function formatearCodigoVecinoNodo(nodoId, vecinoId) {
    const nPad = String(Number(nodoId || 1)).padStart(2, '0');
    const vPad = String(Number(vecinoId || 1)).padStart(4, '0');
    return `VEC-N${nPad}-${vPad}`;
}

/**
 * Recalcula de forma determinista el saldo de la subcuenta individual de un vecino del Nodo:
 * DEBITO suma (+monto: pedido comprado / reversión de pago)
 * CREDITO resta (-monto: pago transferencia / pago efectivo / nota de crédito / anulación)
 * Saldo > 0 => el vecino aún debe abonar su compra; Saldo = 0 => al día; Saldo < 0 => saldo a favor del vecino.
 */
async function recalcularSaldoSubcuentaVecino(client, vecinoId) {
    if (!vecinoId) return 0;
    const movsRes = await client.query(
        `SELECT id, naturaleza, monto
         FROM public.nodos_vecinos_movimientos_cc
         WHERE vecino_id = $1::int
         ORDER BY created_at ASC, id ASC`,
        [Number(vecinoId)]
    );

    let saldoAcum = 0;
    for (const m of movsRes.rows) {
        const monto = Number(m.monto || 0);
        if (String(m.naturaleza || '').toUpperCase() === 'DEBITO') {
            saldoAcum += monto;
        } else {
            saldoAcum -= monto;
        }
        saldoAcum = Number(saldoAcum.toFixed(2));
        await client.query(
            'UPDATE public.nodos_vecinos_movimientos_cc SET saldo_resultante = $1 WHERE id = $2',
            [saldoAcum, m.id]
        );
    }

    await client.query(
        'UPDATE public.nodos_vecinos SET saldo_actual = $1, updated_at = NOW() WHERE id = $2::int',
        [saldoAcum, Number(vecinoId)]
    );
    return saldoAcum;
}

/**
 * Crea o asegura el vínculo de un Nodo con public.bunker_clientes y public.factura_cuentas_corrientes:
 * - Todo Nodo opera SIEMPRE sobre su propia Subcuenta Operativa Aislada (CB-NODO-xxx) vinculada a Lista Base Nodos Barriales.
 * - Opcionalmente puede vincularse con una Cuenta Madre preexistente en LAMDA (ej: Matías CB-0006, id = 18)
 *   sin tocar ni alterar la ficha, listas ni lomas_soft_id de la Cuenta Madre, e impactando en ella únicamente
 *   el asiento neto consolidado al cerrar la liquidación del canasto.
 */
function tieneContactosRegistradosValidos(rawJsonOrText) {
    if (!rawJsonOrText) return false;
    const str = String(rawJsonOrText).trim();
    if (!str || str === '[]' || str === '{}') return false;
    if (str.startsWith('[')) {
        try {
            const arr = JSON.parse(str);
            return Array.isArray(arr) && arr.some(x => x && (x.numero || x.email));
        } catch (_) {
            return false;
        }
    }
    return str.length >= 5;
}

/**
 * Sincroniza/hereda datos fiscales, contactos (WhatsApp y Email) y domicilio geolocalizado
 * desde el Cliente Madre (ej: CB-0006 Matías Ferronato) hacia el registro operativo del Nodo
 * (ej: CB-NODO-001), manteniendo sus Cuentas Corrientes 100% separadas y sin colisionar email_portal.
 */
async function sincronizarHerenciaFiscalYContactosDesdeMadre(runner, bunkerClienteNodoId, clienteMadreBunkerId, datosNodo = {}) {
    const q = runner || db;
    const idNodoBc = Number(bunkerClienteNodoId || 0);
    if (!idNodoBc) return null;

    const resNodoBc = await q.query('SELECT * FROM public.bunker_clientes WHERE id = $1 LIMIT 1', [idNodoBc]);
    if (resNodoBc.rows.length === 0) return null;
    const bcNodo = resNodoBc.rows[0];

    let bcMadre = null;
    const idMadreBc = Number(clienteMadreBunkerId || 0);
    if (idMadreBc && idMadreBc !== idNodoBc) {
        const resMadreBc = await q.query('SELECT * FROM public.bunker_clientes WHERE id = $1 LIMIT 1', [idMadreBc]);
        bcMadre = resMadreBc.rows[0] || null;
    }

    const gestorNombre = String(datosNodo.gestor_nombre || '').trim();
    const nombreMarca = String(datosNodo.nombre_marca || '').trim();
    const gestorTelDigits = String(datosNodo.gestor_telefono || '').replace(/\D+/g, '');
    const gestorEmail = String(datosNodo.gestor_email || '').trim();

    // 1. Determinar campos fiscales heredados sin pisar ediciones manuales específicas del Nodo
    const cuitActual = String(bcNodo.cuit_cuil || '').replace(/\D+/g, '');
    const cuitMadre = bcMadre ? String(bcMadre.cuit_cuil || '').replace(/\D+/g, '') : '';
    const cuitFinal = cuitActual || cuitMadre || null;

    const razonActual = String(bcNodo.razon_social || '').trim();
    const esRazonGenericaNodo = !razonActual ||
        razonActual.toLowerCase() === gestorNombre.toLowerCase() ||
        razonActual.toLowerCase() === nombreMarca.toLowerCase() ||
        razonActual.toUpperCase().startsWith('[NODO]');
    const razonFinal = (esRazonGenericaNodo && bcMadre && String(bcMadre.razon_social || '').trim())
        ? String(bcMadre.razon_social).trim()
        : (razonActual || gestorNombre || nombreMarca || 'Gestor Nodo Barrial');

    const ivaActual = String(bcNodo.condicion_iva || '').trim();
    const esIvaGenericoNodo = !ivaActual || ivaActual === 'Consumidor Final / Monotributo';
    const ivaFinal = (esIvaGenericoNodo && bcMadre && String(bcMadre.condicion_iva || '').trim())
        ? String(bcMadre.condicion_iva).trim()
        : (ivaActual || 'Consumidor Final');

    const prefActual = String(bcNodo.preferencia_facturacion || '').trim().toUpperCase();
    const prefMadre = bcMadre ? String(bcMadre.preferencia_facturacion || '').trim().toUpperCase() : '';
    const prefFinal = ((!prefActual || prefActual === 'PREGUNTAR') && ['ARCA', 'INTERNO'].includes(prefMadre))
        ? prefMadre
        : (['ARCA', 'INTERNO', 'PREGUNTAR'].includes(prefActual) ? prefActual : 'INTERNO');

    const domFiscalActual = String(bcNodo.domicilio_fiscal || '').trim();
    const esDomGenerico = !domFiscalActual || domFiscalActual.toLowerCase() === 'la plata';
    const domFiscalFinal = (!esDomGenerico)
        ? domFiscalActual
        : (String(datosNodo.direccion_retiro || '').trim() ||
           (bcMadre && String(bcMadre.domicilio_fiscal || '').trim()) ||
           String(datosNodo.barrio_zona || '').trim() ||
           'La Plata');

    const provFinal = String(bcNodo.provincia || '').trim() || (bcMadre && String(bcMadre.provincia || '').trim()) || 'BUENOS AIRES';
    const estadoClaveFinal = (bcMadre && String(bcMadre.estado_clave || '').trim()) || String(bcNodo.estado_clave || '').trim() || 'ACTIVO';
    const catMonoFinal = String(bcNodo.categoria_monotributo || '').trim() || (bcMadre ? bcMadre.categoria_monotributo : null) || null;
    const actPrinActual = String(bcNodo.actividad_principal || '').trim();
    const actPrinFinal = ((!actPrinActual || actPrinActual === 'GESTOR NODO BARRIAL MARCA BLANCA') && bcMadre && String(bcMadre.actividad_principal || '').trim())
        ? String(bcMadre.actividad_principal).trim()
        : (actPrinActual || 'GESTOR NODO BARRIAL MARCA BLANCA');
    const canalFinal = String(bcNodo.canal_envio_preferido || '').trim() || (bcMadre && String(bcMadre.canal_envio_preferido || '').trim()) || 'whatsapp';

    // 2. Contactos WhatsApp y Email (elimina alerta "⚠️ Sin contactos. Edite el cliente.")
    let wpFinal = bcNodo.whatsapp_facturas;
    if (!tieneContactosRegistradosValidos(wpFinal)) {
        if (bcMadre && tieneContactosRegistradosValidos(bcMadre.whatsapp_facturas)) {
            wpFinal = bcMadre.whatsapp_facturas;
        } else if (gestorTelDigits.length >= 8) {
            const numNorm = gestorTelDigits.startsWith('54') ? gestorTelDigits : `549${gestorTelDigits.replace(/^0/, '')}`;
            wpFinal = JSON.stringify([{
                id: `cont_nodo_${idNodoBc}`,
                numero: numNorm,
                nombre: gestorNombre || nombreMarca || 'Gestor Nodo',
                cargo: 'titular',
                enviar_alerta: true,
                default_resumen: true,
                default: true
            }]);
        }
    }

    let emailFactFinal = bcNodo.email_facturas;
    if (!tieneContactosRegistradosValidos(emailFactFinal)) {
        if (bcMadre && tieneContactosRegistradosValidos(bcMadre.email_facturas)) {
            emailFactFinal = bcMadre.email_facturas;
        } else {
            const emailCandidato = (bcMadre && String(bcMadre.email_portal || '').trim()) || gestorEmail;
            const esFicticio = !emailCandidato ||
                emailCandidato.toLowerCase().endsWith('@lamdaclientes.com') ||
                emailCandidato.toLowerCase().endsWith('@b2b.lamdaser.com') ||
                emailCandidato.toLowerCase().endsWith('@lamda.com.ar');
            if (!esFicticio && emailCandidato.includes('@')) {
                emailFactFinal = JSON.stringify([{
                    email: emailCandidato.toLowerCase(),
                    nombre: (bcMadre && bcMadre.email_portal_nombre) || gestorNombre || (bcMadre && bcMadre.cliente_nombre) || '',
                    cargo: (bcMadre && bcMadre.email_portal_cargo) || 'titular',
                    enviar_alerta: true
                }]);
            }
        }
    }

    await q.query(
        `UPDATE public.bunker_clientes
         SET cuit_cuil = $1,
             razon_social = $2,
             condicion_iva = $3,
             preferencia_facturacion = $4,
             domicilio_fiscal = $5,
             provincia = $6,
             estado_clave = $7,
             categoria_monotributo = $8,
             actividad_principal = $9,
             whatsapp_facturas = $10,
             email_facturas = $11,
             canal_envio_preferido = $12,
             updated_at = NOW()
         WHERE id = $13 AND codigo_bunker_cliente LIKE 'CB-NODO-%'`,
        [
            cuitFinal,
            razonFinal,
            ivaFinal,
            prefFinal,
            domFiscalFinal,
            provFinal,
            estadoClaveFinal,
            catMonoFinal,
            actPrinFinal,
            wpFinal || null,
            emailFactFinal || null,
            canalFinal,
            idNodoBc
        ]
    );

    // 3. Heredar domicilio geolocalizado en clientes_domicilios hacia id_cliente = bunker_cliente_id del Nodo si no posee uno
    if (bcMadre) {
        const domNodoRes = await q.query(
            'SELECT id FROM public.clientes_domicilios WHERE id_cliente = $1 AND COALESCE(activo, true) = true LIMIT 1',
            [idNodoBc]
        );
        if (domNodoRes.rows.length === 0) {
            const idsMadreCand = [Number(bcMadre.id)];
            if (bcMadre.lomas_soft_id) {
                const cleanLomas = String(bcMadre.lomas_soft_id).trim();
                if (cleanLomas) {
                    const legRes = await q.query(
                        `SELECT id FROM public.clientes
                         WHERE cliente_id::text = $1 OR ltrim(cliente_id::text, '0') = ltrim($1, '0')`,
                        [cleanLomas]
                    );
                    for (const lr of legRes.rows) {
                        if (lr.id) idsMadreCand.unshift(Number(lr.id));
                    }
                }
            }
            const domMadreRes = await q.query(
                `SELECT *
                 FROM public.clientes_domicilios
                 WHERE id_cliente = ANY($1::int[]) AND COALESCE(activo, true) = true
                 ORDER BY COALESCE(es_predeterminado, false) DESC, id ASC
                 LIMIT 1`,
                [idsMadreCand]
            );
            if (domMadreRes.rows.length > 0) {
                const dm = domMadreRes.rows[0];
                await q.query(
                    `INSERT INTO public.clientes_domicilios (
                        id_cliente, alias, direccion, localidad, provincia, codigo_postal,
                        latitud, longitud, instrucciones_entrega, horario_atencion_desde, horario_atencion_hasta,
                        telefono_contacto, es_predeterminado, activo, coordenadas_validadas
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,true,$13)`,
                    [
                        idNodoBc,
                        dm.alias ? `${dm.alias} (${nombreMarca || 'Nodo'})` : `Sede ${nombreMarca || 'Nodo'}`,
                        String(datosNodo.direccion_retiro || '').trim() || dm.direccion,
                        String(datosNodo.barrio_zona || '').trim() || dm.localidad,
                        dm.provincia || 'Buenos Aires',
                        dm.codigo_postal || null,
                        dm.latitud,
                        dm.longitud,
                        dm.instrucciones_entrega || `Entrega de Canastos Nodo ${nombreMarca || ''}`.trim(),
                        dm.horario_atencion_desde || null,
                        dm.horario_atencion_hasta || null,
                        dm.telefono_contacto || datosNodo.gestor_telefono || null,
                        Boolean(dm.coordenadas_validadas)
                    ]
                );
            }
        }
    }

    return { cuit_cuil: cuitFinal, razon_social: razonFinal, preferencia_facturacion: prefFinal };
}

/**
 * Propaga actualizaciones desde un Cliente Madre editado en Clientes Búnker hacia cualquier Nodo vinculado.
 */
async function sincronizarHerenciaFiscalDesdeMadrePorId(clienteMadreBunkerId) {
    const madreId = Number(clienteMadreBunkerId || 0);
    if (!madreId) return;
    const nodosVinc = await db.query(
        `SELECT id, nombre_marca, gestor_nombre, gestor_telefono, gestor_email, direccion_retiro, barrio_zona,
                bunker_cliente_id, cliente_madre_bunker_id
         FROM public.nodos_maestro
         WHERE cliente_madre_bunker_id = $1 AND bunker_cliente_id IS NOT NULL`,
        [madreId]
    );
    for (const n of nodosVinc.rows) {
        await sincronizarHerenciaFiscalYContactosDesdeMadre(db, n.bunker_cliente_id, n.cliente_madre_bunker_id, n);
    }
}

async function asegurarVinculoContableNodo(client, datosNodo) {
    let clienteMadreBunkerId = datosNodo.cliente_madre_bunker_id ? Number(datosNodo.cliente_madre_bunker_id) : null;
    let codigoBunkerMadre = datosNodo.codigo_bunker_cliente_madre ? String(datosNodo.codigo_bunker_cliente_madre).trim() : '';

    // Si en bunker_cliente_id se seleccionó un cliente real existente que NO es CB-NODO-%, tratarlo como Cuenta Madre
    const candidatoId = datosNodo.bunker_cliente_id ? Number(datosNodo.bunker_cliente_id) : null;
    if (candidatoId && !clienteMadreBunkerId) {
        const resCand = await client.query(
            'SELECT id, codigo_bunker_cliente FROM public.bunker_clientes WHERE id = $1 LIMIT 1',
            [candidatoId]
        );
        if (resCand.rows.length > 0) {
            const codCand = String(resCand.rows[0].codigo_bunker_cliente || '').trim();
            if (!codCand.toUpperCase().startsWith('CB-NODO-')) {
                clienteMadreBunkerId = resCand.rows[0].id;
                codigoBunkerMadre = codCand;
            }
        }
    }

    if (clienteMadreBunkerId && !codigoBunkerMadre) {
        const resMadre = await client.query(
            'SELECT id, codigo_bunker_cliente FROM public.bunker_clientes WHERE id = $1 LIMIT 1',
            [clienteMadreBunkerId]
        );
        if (resMadre.rows.length > 0) {
            codigoBunkerMadre = resMadre.rows[0].codigo_bunker_cliente;
        } else {
            clienteMadreBunkerId = null;
        }
    } else if (!clienteMadreBunkerId && codigoBunkerMadre && !codigoBunkerMadre.toUpperCase().startsWith('CB-NODO-')) {
        const resMadreCod = await client.query(
            'SELECT id, codigo_bunker_cliente FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1',
            [codigoBunkerMadre]
        );
        if (resMadreCod.rows.length > 0) {
            clienteMadreBunkerId = resMadreCod.rows[0].id;
            codigoBunkerMadre = resMadreCod.rows[0].codigo_bunker_cliente;
        } else {
            codigoBunkerMadre = '';
        }
    }

    // La Subcuenta Operativa del Nodo es SIEMPRE CB-NODO-xxx aislada
    let codigoBunker = datosNodo.codigo_bunker_cliente ? String(datosNodo.codigo_bunker_cliente).trim().toUpperCase() : '';
    if (!codigoBunker || !codigoBunker.startsWith('CB-NODO-')) {
        const numMatch = String(datosNodo.codigo_nodo || 'NODO-001').match(/(\d+)$/);
        const sufijo = numMatch ? numMatch[1].padStart(3, '0') : String(datosNodo.codigo_nodo || '001').replace(/[^0-9A-Z]/gi, '').slice(-3).toUpperCase();
        codigoBunker = `CB-NODO-${sufijo}`;
    }

    let bunkerClienteId = null;
    const checkBc = await client.query(
        'SELECT id, codigo_bunker_cliente FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1',
        [codigoBunker]
    );

    if (checkBc.rows.length > 0) {
        bunkerClienteId = checkBc.rows[0].id;
        await client.query(
            `UPDATE public.bunker_clientes
             SET cliente_nombre = $1
             WHERE id = $2 AND codigo_bunker_cliente LIKE 'CB-NODO-%'`,
            [
                `[NODO] ${datosNodo.nombre_marca} (${datosNodo.gestor_nombre})`,
                bunkerClienteId
            ]
        );
    } else {
        const insBc = await client.query(
            `INSERT INTO public.bunker_clientes (
                codigo_bunker_cliente, cliente_nombre, razon_social,
                condicion_iva, domicilio_fiscal, provincia, estado_clave,
                actividad_principal, canal_envio_preferido, preferencia_facturacion
            ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO', 'GESTOR NODO BARRIAL MARCA BLANCA', 'whatsapp', 'PREGUNTAR')
            RETURNING id, codigo_bunker_cliente`,
            [
                codigoBunker,
                `[NODO] ${datosNodo.nombre_marca} (${datosNodo.gestor_nombre})`,
                datosNodo.gestor_nombre || datosNodo.nombre_marca,
                'Consumidor Final / Monotributo',
                datosNodo.direccion_retiro || datosNodo.barrio_zona || 'La Plata',
                'BUENOS AIRES'
            ]
        );
        bunkerClienteId = insBc.rows[0].id;
    }

    // Heredar automáticamente CUIT, Razón Social fiscal, Preferencia de Facturación, Contactos y Domicilio desde el Cliente Madre
    await sincronizarHerenciaFiscalYContactosDesdeMadre(client, bunkerClienteId, clienteMadreBunkerId, datosNodo);

    // Asegurar subcuenta corriente operativa del Nodo en factura_cuentas_corrientes
    const checkCc = await client.query(
        'SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = $1 LIMIT 1',
        [codigoBunker]
    );

    if (checkCc.rows.length === 0) {
        await client.query(
            `INSERT INTO public.factura_cuentas_corrientes (
                codigo_bunker_cliente, nombre_cuenta, moneda, saldo, estado, saldo_apertura
            ) VALUES ($1, $2, 'ARS', 0.00, 'ACTIVA', 0.00)`,
            [codigoBunker, `Cta. Cte. Nodo ${datosNodo.nombre_marca}`]
        );
    } else {
        await client.query(
            `UPDATE public.factura_cuentas_corrientes
             SET nombre_cuenta = $1
             WHERE id = $2`,
            [`Cta. Cte. Nodo ${datosNodo.nombre_marca}`, checkCc.rows[0].id]
        );
    }

    return {
        bunker_cliente_id: bunkerClienteId,
        codigo_bunker_cliente: codigoBunker,
        cliente_madre_bunker_id: clienteMadreBunkerId,
        codigo_bunker_cliente_madre: codigoBunkerMadre || null
    };
}

// ============================================================================
// MOTOR DETERMINISTA DE SEGUIMIENTO EN VIVO MARCA BLANCA (6 HITOS)
// ============================================================================

const MAPA_HITO_A_ESTADO = {
    1: 'CONFIRMADO_VECINO',
    2: 'EN_PREPARACION',
    3: 'ARMADO_EN_CANASTO',
    4: 'EN_PODER_GESTOR',
    5: 'EN_CAMINO_VECINO',
    6: 'ENTREGADO_VECINO'
};

function generarTrackingTokenPedidoNodo() {
    return crypto.randomBytes(12).toString('hex');
}

function resolverHitoDesdeEstadoOperativo(estadoOp = '', secuenciaLamda = '') {
    const est = String(estadoOp || '').trim().toUpperCase();
    const sec = String(secuenciaLamda || '').trim();
    if (est === 'ANULADO') return 0;
    if (est === 'ENTREGADO_VECINO' || est === 'ENTREGADO') return 6;
    if (est === 'EN_CAMINO_VECINO' || est === 'EN_TRANSITO_CORREO') return 5;
    if (est === 'EN_PODER_GESTOR' || est === 'DESPACHADO_CORREO') return 4;
    if (est === 'ARMADO_EN_CANASTO' || est === 'EMPAQUETADO_FULFILLMENT' || sec === 'Pedido_Listo' || sec === 'Retira_Deposito') return 3;
    if (est === 'EN_PREPARACION' || sec === 'Armar_Pedido') return 2;
    return 1;
}

/**
 * Registra de forma monótona e idempotente el avance de hito de un pedido vecinal,
 * actualizando timestamps reales e insertando auditoría en nodos_pedidos_eventos_tracking.
 * Jamás retrocede de hito salvo reinicio explícito de Laboratorio.
 */
async function registrarTransicionHitoPedidoVecino(runner, pedidoId, nuevoHito, opciones = {}) {
    const q = runner || db;
    const pid = Number(pedidoId || 0);
    const hitoDestino = Number(nuevoHito || 0);
    if (!pid || !MAPA_HITO_A_ESTADO[hitoDestino]) return { avanzado: false };

    const pedRes = await q.query(
        `SELECT id, nodo_id, codigo_pedido, modalidad_entrega, estado_operativo,
                secuencia_operativa_lamda, hito_tracking_actual,
                fecha_en_preparacion, fecha_armado_bolsa, fecha_entrega_gestor,
                fecha_en_camino_vecino, fecha_entregado_vecino
         FROM public.nodos_pedidos_vecinos
         WHERE id = $1
         LIMIT 1`,
        [pid]
    );
    if (pedRes.rows.length === 0) return { avanzado: false };
    const ped = pedRes.rows[0];

    if (String(ped.estado_operativo || '').toUpperCase() === 'ANULADO') {
        return { avanzado: false, motivo: 'ANULADO' };
    }

    const hitoActual = Number(ped.hito_tracking_actual || resolverHitoDesdeEstadoOperativo(ped.estado_operativo, ped.secuencia_operativa_lamda));
    const permitirRetroceso = Boolean(opciones.permitirRetrocesoLaboratorio);
    if (!permitirRetroceso && hitoDestino <= hitoActual) {
        return { avanzado: false, hito_actual: hitoActual };
    }

    const nuevoEstado = opciones.estadoOverride || MAPA_HITO_A_ESTADO[hitoDestino];
    const origen = String(opciones.origen || 'SISTEMA').slice(0, 50);
    const actor = opciones.actor ? String(opciones.actor).slice(0, 120) : null;
    const detalle = opciones.detalle ? String(opciones.detalle) : null;

    await q.query(
        `UPDATE public.nodos_pedidos_vecinos
         SET estado_operativo = $1,
             hito_tracking_actual = $2::int,
             fecha_en_preparacion = CASE WHEN $2::int >= 2 THEN COALESCE(fecha_en_preparacion, NOW()) ELSE fecha_en_preparacion END,
             fecha_armado_bolsa = CASE WHEN $2::int >= 3 THEN COALESCE(fecha_armado_bolsa, NOW()) ELSE fecha_armado_bolsa END,
             fecha_entrega_gestor = CASE WHEN $2::int >= 4 THEN COALESCE(fecha_entrega_gestor, NOW()) ELSE fecha_entrega_gestor END,
             fecha_en_camino_vecino = CASE WHEN $2::int = 5 THEN COALESCE(fecha_en_camino_vecino, NOW()) ELSE fecha_en_camino_vecino END,
             fecha_entregado_vecino = CASE WHEN $2::int = 6 THEN COALESCE(fecha_entregado_vecino, NOW()) ELSE fecha_entregado_vecino END,
             updated_at = NOW()
         WHERE id = $3::int`,
        [nuevoEstado, Number(hitoDestino), Number(pid)]
    );

    await q.query(
        `INSERT INTO public.nodos_pedidos_eventos_tracking (
            pedido_id, nodo_id, hito_numero, estado_operativo, origen_evento, actor, detalle
         ) VALUES ($1::int, $2::int, $3::int, $4, $5, $6, $7)`,
        [Number(pid), Number(ped.nodo_id), Number(hitoDestino), nuevoEstado, origen, actor, detalle]
    );

    return { avanzado: true, hito_anterior: hitoActual, hito_actual: hitoDestino, estado_operativo: nuevoEstado };
}

function _sanitizarCoordenadasGeo(latRaw, lngRaw) {
    if (latRaw == null || lngRaw == null || latRaw === '' || lngRaw === '') return null;
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return {
        lat: Number(lat.toFixed(7)),
        lng: Number(lng.toFixed(7))
    };
}

function _normalizarTextoDirCoordenadas(dirRaw = '') {
    return String(dirRaw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function _calcularDistanciaMetrosGeo(lat1, lng1, lat2, lng2) {
    const R = 6371e3;
    const rad = (v) => (Number(v) * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(rad(lat1)) * Math.cos(rad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Construye la línea de tiempo Marca Blanca pura (cero menciones a LAMDA / costos / planta):
 * - ENVIO_BARRIAL: 6 hitos (1 -> 2 -> 3 -> 4 -> 5 -> 6).
 * - RETIRO_NODO: 5 hitos (1 -> 2 -> 3 -> 4 "¡Listo para retirar!" -> 6 "Entregado", sin viaje falso de reparto).
 */
function construirTimelineMarcaBlancaPedido(pedido, nodo, eventosRows = [], envioPostal = null) {
    const modOpUpper = String(pedido.modalidad_entrega || '').toUpperCase();
    const esPedidoPostal = Boolean(envioPostal) ||
        ['PAQUETERIA_DOMICILIO', 'PAQUETERIA_SUCURSAL', 'ENCOMIENDA'].includes(modOpUpper) ||
        normalizarPerfilOperativoNodo(nodo?.perfil_operativo) === 'ecommerce_fulfillment';

    const marca = nodo.nombre_marca || 'nuestra tienda';
    const gestor = nodo.gestor_nombre || marca;
    const esAnulado = String(pedido.estado_operativo || '').toUpperCase() === 'ANULADO';
    const hitoActual = esAnulado
        ? 0
        : Number(pedido.hito_tracking_actual || resolverHitoDesdeEstadoOperativo(pedido.estado_operativo, pedido.secuencia_operativa_lamda));

    const mapaEventosTs = new Map();
    for (const ev of (eventosRows || [])) {
        const hn = Number(ev.hito_numero || 0);
        if (hn > 0 && ev.created_at) {
            mapaEventosTs.set(hn, ev.created_at);
        }
    }

    if (esPedidoPostal) {
        const operadorLabel = formatearOperadorPostalLabel(envioPostal?.operador_postal || 'CORREO_ARGENTINO');
        const esSucursalPostal = String(envioPostal?.modalidad_postal || '').toUpperCase() === 'SUCURSAL' || modOpUpper === 'PAQUETERIA_SUCURSAL';
        const locTxt = [envioPostal?.localidad_nombre, envioPostal?.provincia_nombre].filter(Boolean).join(', ') || (pedido.direccion_entrega || 'tu localidad');
        const cpTxt = envioPostal?.cp_destino ? ` (CP ${envioPostal.cp_destino})` : '';
        const numGuia = String(envioPostal?.numero_tracking || '').trim();
        const slaLabel = nodo?.config_paqueteria?.sla_despacho_label || pedido.fecha_entrega_label || 'Despacho en 24 a 48 hs hábiles';

        const defsEcommerce = [
            {
                hito_numero: 1,
                codigo: 'COMPRA_RECIBIDA',
                icono: '📝',
                titulo: 'Compra recibida',
                descripcion: `Tu pedido quedó registrado en ${marca} (${slaLabel}).`,
                fecha_fallback: pedido.created_at
            },
            {
                hito_numero: 2,
                codigo: 'EN_PREPARACION',
                icono: '💳',
                titulo: 'Pago confirmado · En preparación',
                descripcion: 'Estamos seleccionando y preparando tus productos frescos para despacho.',
                fecha_fallback: pedido.fecha_en_preparacion || pedido.fecha_armado_bolsa
            },
            {
                hito_numero: 3,
                codigo: 'EMPAQUETADO_CONTROLADO',
                icono: '📦',
                titulo: 'Empaquetado y controlado',
                descripcion: `Tus productos fueron controlados uno por uno y embalados con sello de ${marca}.`,
                fecha_fallback: pedido.fecha_armado_bolsa
            },
            {
                hito_numero: 4,
                codigo: 'DESPACHADO_CORREO',
                icono: '🚚',
                titulo: `Despachado por ${operadorLabel}`,
                descripcion: numGuia
                    ? `Tu paquete ingresó a ${operadorLabel} con número de seguimiento #${numGuia}.`
                    : `Tu paquete ya fue entregado a ${operadorLabel} para su distribución nacional.`,
                fecha_fallback: envioPostal?.fecha_despacho || pedido.fecha_entrega_gestor
            },
            {
                hito_numero: 5,
                codigo: 'EN_TRANSITO_CORREO',
                icono: '🛣️',
                titulo: esSucursalPostal ? 'En viaje a sucursal de correo' : 'En tránsito a tu domicilio',
                descripcion: esSucursalPostal
                    ? `Viajando hacia la sucursal de ${operadorLabel} en ${locTxt}${cpTxt}.`
                    : `En distribución postal hacia ${locTxt}${cpTxt}.`,
                fecha_fallback: pedido.fecha_en_camino_vecino
            },
            {
                hito_numero: 6,
                codigo: 'ENTREGADO_CLIENTE',
                icono: '✅',
                titulo: 'Entregado',
                descripcion: `¡Gracias por elegir ${marca}! Que disfrutes tu compra.`,
                fecha_fallback: envioPostal?.fecha_entrega_correo || pedido.fecha_entregado_vecino
            }
        ];

        const hitoEfectivoPostal = Math.max(1, Math.min(6, hitoActual || 1));
        const pasosPostal = defsEcommerce.map((def, idx) => {
            const completado = !esAnulado && hitoEfectivoPostal >= def.hito_numero;
            const esActual = !esAnulado && hitoEfectivoPostal === def.hito_numero;
            const ts = completado ? (mapaEventosTs.get(def.hito_numero) || def.fecha_fallback || null) : null;
            return {
                paso_orden: idx + 1,
                total_pasos: defsEcommerce.length,
                hito_numero: def.hito_numero,
                codigo: def.codigo,
                icono: def.icono,
                titulo: def.titulo,
                descripcion: def.descripcion,
                completado,
                es_actual: esActual,
                fecha_hora: ts
            };
        });
        const pasoActualPostal = pasosPostal.find(p => p.es_actual) || pasosPostal[0];
        return {
            es_ecommerce_postal: true,
            anulado: esAnulado,
            ausente_pasa_retirar: false,
            motivo_ausencia: null,
            hito_actual: esAnulado ? 0 : hitoEfectivoPostal,
            paso_actual_orden: esAnulado ? 0 : (pasoActualPostal ? pasoActualPostal.paso_orden : 1),
            total_pasos: pasosPostal.length,
            titulo_estado_actual: esAnulado ? 'Compra anulada' : (pasoActualPostal ? pasoActualPostal.titulo : 'Compra recibida'),
            descripcion_estado_actual: esAnulado
                ? `Esta compra fue anulada. Si necesitás asistencia, contactanos desde ${marca}.`
                : (pasoActualPostal ? pasoActualPostal.descripcion : ''),
            operador_postal: envioPostal?.operador_postal || 'CORREO_ARGENTINO',
            operador_postal_label: operadorLabel,
            numero_tracking: numGuia || null,
            url_tracking_carrier: envioPostal?.url_tracking_carrier || null,
            pasos: pasosPostal
        };
    }

    const esEnvio = modOpUpper === 'ENVIO_BARRIAL' ||
        Boolean(pedido.incluido_reparto_manual);
    const dirRetiro = nodo.direccion_retiro || nodo.barrio_zona || marca;
    const dirVecino = pedido.direccion_entrega || 'tu domicilio';
    const esAusentePasaRetirar = Boolean(pedido.ausente_pasa_retirar) && !esAnulado && hitoActual < 6;
    const motivoAusencia = String(pedido.motivo_ausencia || '').trim();

    const definiciones = [
        {
            hito_numero: 1,
            codigo: 'CONFIRMADO_VECINO',
            icono: '📝',
            titulo: 'Pedido confirmado',
            descripcion: `Tu pedido quedó registrado en ${marca} para la entrega programada (${pedido.fecha_entrega_label || 'próximo reparto'}).`,
            fecha_fallback: pedido.created_at
        },
        {
            hito_numero: 2,
            codigo: 'EN_PREPARACION',
            icono: '🥣',
            titulo: 'En preparación',
            descripcion: 'Estamos seleccionando y fraccionando tus productos frescos.',
            fecha_fallback: pedido.fecha_en_preparacion || pedido.fecha_armado_bolsa
        },
        {
            hito_numero: 3,
            codigo: 'ARMADO_EN_CANASTO',
            icono: '📦',
            titulo: 'Controlado y embolsado',
            descripcion: 'Tus productos ya fueron controlados uno por uno y embolsados con tu nombre.',
            fecha_fallback: pedido.fecha_armado_bolsa
        },
        esAusentePasaRetirar
            ? {
                hito_numero: 4,
                codigo: 'AUSENTE_PASA_RETIRAR',
                icono: '🏡',
                titulo: `No te encontramos — Retirá por ${marca}`,
                descripcion: `Pasamos por ${dirVecino}${motivoAusencia ? ` (${motivoAusencia})` : ''} y no te encontramos. Tu pedido regresó a ${marca} (${dirRetiro}) para que pases a retirarlo (se conserva el cargo de envío del intento realizado).`,
                fecha_fallback: pedido.fecha_ausente_reparto || pedido.fecha_entrega_gestor
            }
            : (esEnvio
                ? {
                    hito_numero: 4,
                    codigo: 'EN_PODER_GESTOR',
                    icono: '🏡',
                    titulo: `Ya llegó a ${marca}`,
                    descripcion: `${gestor} ya recibió tu bolsa en el barrio y la prepara para salir hacia tu domicilio.`,
                    fecha_fallback: pedido.fecha_entrega_gestor
                }
                : {
                    hito_numero: 4,
                    codigo: 'EN_PODER_GESTOR',
                    icono: '🎉',
                    titulo: `¡Listo para retirar en ${marca}!`,
                    descripcion: `Ya podés pasar a retirarlo por ${dirRetiro}${pedido.ventana_horaria_label ? ` (${pedido.ventana_horaria_label})` : ''}.`,
                    fecha_fallback: pedido.fecha_entrega_gestor
                })
    ];

    if (esEnvio) {
        definiciones.push({
            hito_numero: 5,
            codigo: 'EN_CAMINO_VECINO',
            icono: '🛵',
            titulo: 'En camino a tu domicilio',
            descripcion: `¡${gestor} salió en reparto hacia ${dirVecino}!`,
            fecha_fallback: pedido.fecha_en_camino_vecino
        });
    }

    definiciones.push({
        hito_numero: 6,
        codigo: 'ENTREGADO_VECINO',
        icono: '✅',
        titulo: 'Entregado',
        descripcion: `¡Gracias por tu compra en ${marca}! Que disfrutes tus productos.`,
        fecha_fallback: pedido.fecha_entregado_vecino
    });

    const HITO_EFECTIVO = esAusentePasaRetirar ? 4 : ((!esEnvio && hitoActual === 5) ? 4 : hitoActual);

    const pasos = definiciones.map((def, idx) => {
        const completado = !esAnulado && HITO_EFECTIVO >= def.hito_numero;
        const esActual = !esAnulado && HITO_EFECTIVO === def.hito_numero;
        const ts = completado ? (mapaEventosTs.get(def.hito_numero) || def.fecha_fallback || null) : null;
        return {
            paso_orden: idx + 1,
            total_pasos: definiciones.length,
            hito_numero: def.hito_numero,
            codigo: def.codigo,
            icono: def.icono,
            titulo: def.titulo,
            descripcion: def.descripcion,
            completado,
            es_actual: esActual,
            fecha_hora: ts
        };
    });

    const pasoActualObj = pasos.find(p => p.es_actual) || pasos[0];
    return {
        anulado: esAnulado,
        ausente_pasa_retirar: esAusentePasaRetirar,
        motivo_ausencia: motivoAusencia || null,
        hito_actual: HITO_EFECTIVO,
        paso_actual_orden: esAnulado ? 0 : (pasoActualObj ? pasoActualObj.paso_orden : 1),
        total_pasos: pasos.length,
        titulo_estado_actual: esAnulado ? 'Pedido anulado' : (pasoActualObj ? pasoActualObj.titulo : 'Pedido confirmado'),
        descripcion_estado_actual: esAnulado
            ? `Este pedido fue anulado. Si necesitás ayuda, escribile a ${gestor}.`
            : (pasoActualObj ? pasoActualObj.descripcion : ''),
        pasos
    };
}

/**
 * Crea las 4 tablas de Etapa 1 en etiquetas_pruebas y siembra datos iniciales
 * realistas vinculados a los ingredientes y cuentas reales del Laboratorio.
 */
async function asegurarEsquemaNodosBarriales(opciones = {}) {
    const forzarSemillaDemo = Boolean(opciones && opciones.sembrarDemo === true);
    if (esquemaInicializado && !forzarSemillaDemo) return;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            CREATE TABLE IF NOT EXISTS public.nodos_maestro (
                id SERIAL PRIMARY KEY,
                codigo_nodo VARCHAR(50) UNIQUE NOT NULL,
                slug VARCHAR(120) UNIQUE NOT NULL,
                nombre_marca VARCHAR(160) NOT NULL,
                subtitulo_marca VARCHAR(200) DEFAULT 'Comunidad Barrial - Entrega Fresca',
                gestor_nombre VARCHAR(160) NOT NULL,
                gestor_telefono VARCHAR(80),
                gestor_email VARCHAR(140),
                barrio_zona VARCHAR(160),
                direccion_retiro VARCHAR(240),
                bunker_cliente_id INTEGER REFERENCES public.bunker_clientes(id) ON DELETE SET NULL,
                codigo_bunker_cliente VARCHAR(80),
                cuenta_bancaria_id INTEGER REFERENCES public.fin_cuentas_bancarias(id) ON DELETE SET NULL,
                usa_cuenta_compartida BOOLEAN DEFAULT false,
                alias_bancario_display VARCHAR(140),
                cbu_display VARCHAR(40),
                titular_display VARCHAR(180),
                permitir_envio_barrial BOOLEAN DEFAULT true,
                permitir_retiro_nodo BOOLEAN NOT NULL DEFAULT true,
                permitir_reparto_propio BOOLEAN NOT NULL DEFAULT true,
                permitir_encomienda BOOLEAN NOT NULL DEFAULT false,
                mostrar_ingredientes_tienda BOOLEAN DEFAULT true,
                cargo_envio_barrial NUMERIC(12,2) DEFAULT 0.00,
                margen_gestor_default_pct NUMERIC(8,2) DEFAULT 28.00,
                config_ventanas_corte JSONB DEFAULT '[]'::jsonb,
                color_primario VARCHAR(20) DEFAULT '#16a34a',
                logo_original_base64 TEXT,
                logo_mono_preview_base64 TEXT,
                logo_zpl_gfa TEXT,
                logo_zpl_config JSONB DEFAULT '{}'::jsonb,
                activo BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.nodos_articulos_catalogo (
                id SERIAL PRIMARY KEY,
                sku_nodo VARCHAR(60) UNIQUE NOT NULL,
                nombre_publico VARCHAR(180) NOT NULL,
                categoria_familiar VARCHAR(100) DEFAULT 'Frutos Secos',
                presentacion_etiqueta VARCHAR(80),
                flujo_lamda INTEGER NOT NULL CHECK (flujo_lamda BETWEEN 1 AND 6),
                origen_tipo VARCHAR(40) NOT NULL DEFAULT 'INGREDIENTE',
                ingrediente_origen_id INTEGER REFERENCES public.ingredientes(id) ON DELETE SET NULL,
                articulo_bunker_origen_codigo VARCHAR(80),
                kilos_unidad NUMERIC(10,4) NOT NULL DEFAULT 0.2500,
                insumo_envase_id INTEGER REFERENCES public.ingredientes(id) ON DELETE SET NULL,
                cantidad_envases_unidad NUMERIC(8,2) NOT NULL DEFAULT 1.00,
                segundos_fraccionamiento NUMERIC(10,2) NOT NULL DEFAULT 35.00,
                tarifa_colaborador_id INTEGER REFERENCES public.colaboradores_tarifas(id) ON DELETE SET NULL,
                valor_hora_aplicado NUMERIC(12,2) NOT NULL DEFAULT 7000.00,
                costo_insumo_kg NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                costo_insumo_fraccion NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                costo_envase_aplicado NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                costo_mano_obra_aplicado NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                margen_lamda_pct NUMERIC(8,2) NOT NULL DEFAULT 22.00,
                iva_pct NUMERIC(6,2) NOT NULL DEFAULT 21.00,
                iibb_pct NUMERIC(6,2) NOT NULL DEFAULT 3.50,
                costo_puro_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                precio_base_nodo_neto NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                precio_base_nodo_final NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                margen_sugerido_gestor_pct NUMERIC(8,2) NOT NULL DEFAULT 28.00,
                precio_sugerido_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                estado VARCHAR(40) NOT NULL DEFAULT 'APROBADO',
                notas_tecnicas TEXT,
                activo BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.nodos_propuestas_fracciones (
                id SERIAL PRIMARY KEY,
                codigo_propuesta VARCHAR(50) UNIQUE NOT NULL,
                nodo_solicitante_id INTEGER REFERENCES public.nodos_maestro(id) ON DELETE SET NULL,
                nombre_sugerido VARCHAR(180) NOT NULL,
                categoria_sugerida VARCHAR(100) DEFAULT 'Frutos Secos',
                flujo_sugerido INTEGER NOT NULL DEFAULT 2 CHECK (flujo_sugerido BETWEEN 1 AND 6),
                ingrediente_sugerido_id INTEGER REFERENCES public.ingredientes(id) ON DELETE SET NULL,
                articulo_bunker_sugerido_codigo VARCHAR(80),
                kilos_sugeridos NUMERIC(10,4) NOT NULL DEFAULT 0.2500,
                insumo_envase_sugerido_id INTEGER REFERENCES public.ingredientes(id) ON DELETE SET NULL,
                segundos_estimados NUMERIC(10,2) DEFAULT 35.00,
                precio_objetivo_vecino NUMERIC(14,2),
                comentario_gestor TEXT,
                respuesta_lamda TEXT,
                estado VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE_COTIZACION',
                articulo_catalogo_id INTEGER REFERENCES public.nodos_articulos_catalogo(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.nodos_ofertas_gestor (
                id SERIAL PRIMARY KEY,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                articulo_catalogo_id INTEGER NOT NULL REFERENCES public.nodos_articulos_catalogo(id) ON DELETE CASCADE,
                precio_base_nodo_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                margen_gestor_pct NUMERIC(8,2) NOT NULL DEFAULT 28.00,
                precio_venta_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ganancia_unitaria_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                publicado_tienda BOOLEAN DEFAULT true,
                destacado_tienda BOOLEAN DEFAULT false,
                alerta_cambio_costo BOOLEAN DEFAULT false,
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unq_nodo_articulo_oferta UNIQUE (nodo_id, articulo_catalogo_id)
            );

            CREATE TABLE IF NOT EXISTS public.nodos_vecinos (
                id SERIAL PRIMARY KEY,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                nombre_completo VARCHAR(160) NOT NULL,
                telefono_whatsapp VARCHAR(60) NOT NULL,
                direccion_calle VARCHAR(220),
                entrecalles_referencia VARCHAR(200),
                notas_entrega TEXT,
                titular_transferencia_habitual VARCHAR(180),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.nodos_pedidos_vecinos (
                id SERIAL PRIMARY KEY,
                codigo_pedido VARCHAR(50) UNIQUE NOT NULL,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                vecino_id INTEGER REFERENCES public.nodos_vecinos(id) ON DELETE SET NULL,
                vecino_nombre VARCHAR(160) NOT NULL,
                vecino_telefono VARCHAR(60) NOT NULL,
                modalidad_entrega VARCHAR(40) NOT NULL DEFAULT 'RETIRO_NODO',
                direccion_entrega VARCHAR(240),
                entrecalles_referencia VARCHAR(200),
                fecha_entrega_comprometida DATE NOT NULL DEFAULT CURRENT_DATE,
                fecha_entrega_label VARCHAR(140) NOT NULL,
                ventana_horaria_label VARCHAR(120),
                entrar_en_corte_actual BOOLEAN DEFAULT true,
                medio_pago VARCHAR(40) NOT NULL DEFAULT 'TRANSFERENCIA',
                estado_pago VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE_TRANSFERENCIA',
                estado_operativo VARCHAR(40) NOT NULL DEFAULT 'CONFIRMADO_VECINO',
                subtotal_productos_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                cargo_envio_barrial NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_base_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ganancia_total_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                observaciones_vecino TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.nodos_pedidos_items (
                id SERIAL PRIMARY KEY,
                pedido_id INTEGER NOT NULL REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE CASCADE,
                articulo_catalogo_id INTEGER REFERENCES public.nodos_articulos_catalogo(id) ON DELETE SET NULL,
                sku_nodo VARCHAR(60),
                nombre_publico VARCHAR(180) NOT NULL,
                presentacion_etiqueta VARCHAR(80),
                cantidad INTEGER NOT NULL DEFAULT 1,
                precio_unitario_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                precio_unitario_base_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                subtotal_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                subtotal_base_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ganancia_item_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00
            );

            CREATE TABLE IF NOT EXISTS public.nodos_lotes_estacion (
                id SERIAL PRIMARY KEY,
                codigo_canasto VARCHAR(50) UNIQUE NOT NULL,
                qr_maestro_payload VARCHAR(140) NOT NULL,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                fecha_entrega_iso DATE,
                fecha_entrega_label VARCHAR(140) NOT NULL,
                ventana_horaria_label VARCHAR(120),
                ubicacion_deposito VARCHAR(60) NOT NULL DEFAULT 'ESTACION_NODOS',
                estado_canasto VARCHAR(40) NOT NULL DEFAULT 'EN_ARMADO',
                total_bolsas INTEGER NOT NULL DEFAULT 0,
                bolsas_armadas INTEGER NOT NULL DEFAULT 0,
                total_kilos_lote NUMERIC(12,3) NOT NULL DEFAULT 0.000,
                total_base_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_venta_vecinos NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ganancia_estimada_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                debito_cta_cte_registrado BOOLEAN NOT NULL DEFAULT false,
                movimiento_cc_id BIGINT,
                preparado_por VARCHAR(120),
                retirado_por_gestor VARCHAR(120),
                fecha_listo_estacion TIMESTAMP,
                fecha_retiro_gestor TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unq_nodo_ventana_canasto UNIQUE (nodo_id, fecha_entrega_label)
            );

            CREATE TABLE IF NOT EXISTS public.nodos_movimientos_cta_cte (
                id SERIAL PRIMARY KEY,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                lote_canasto_id INTEGER REFERENCES public.nodos_lotes_estacion(id) ON DELETE SET NULL,
                pedido_vecino_id INTEGER REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE SET NULL,
                tipo_movimiento VARCHAR(50) NOT NULL,
                signo SMALLINT NOT NULL DEFAULT -1,
                monto NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                saldo_resultante NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                concepto VARCHAR(240) NOT NULL,
                referencia_externa VARCHAR(100),
                created_at TIMESTAMP DEFAULT NOW()
            );

            ALTER TABLE public.nodos_pedidos_vecinos
                ADD COLUMN IF NOT EXISTS lote_canasto_id INTEGER REFERENCES public.nodos_lotes_estacion(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS ubicacion_deposito VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE_TALLER',
                ADD COLUMN IF NOT EXISTS etiqueta_impresa BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS fecha_armado_bolsa TIMESTAMP,
                ADD COLUMN IF NOT EXISTS fecha_entrega_gestor TIMESTAMP,
                ADD COLUMN IF NOT EXISTS operario_armado VARCHAR(100),
                ADD COLUMN IF NOT EXISTS titular_transferencia VARCHAR(180),
                ADD COLUMN IF NOT EXISTS comprobante_referencia VARCHAR(100),
                ADD COLUMN IF NOT EXISTS fecha_conciliacion_pago TIMESTAMP,
                ADD COLUMN IF NOT EXISTS impactado_cta_cte_pago BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS movimiento_pago_cc_id BIGINT;

            CREATE TABLE IF NOT EXISTS public.nodos_alias_vecinos_aprendidos (
                id SERIAL PRIMARY KEY,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                vecino_id INTEGER REFERENCES public.nodos_vecinos(id) ON DELETE SET NULL,
                vecino_nombre VARCHAR(160) NOT NULL,
                titular_normalizado VARCHAR(180) NOT NULL,
                cuit_cuil_origen VARCHAR(30),
                billetera_banco_origen VARCHAR(100) DEFAULT 'Mercado Pago / Banco',
                usos_confirmados INTEGER NOT NULL DEFAULT 1,
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unq_nodo_titular_vecino UNIQUE (nodo_id, titular_normalizado)
            );

            CREATE TABLE IF NOT EXISTS public.nodos_liquidaciones_lote (
                id SERIAL PRIMARY KEY,
                codigo_liquidacion VARCHAR(50) UNIQUE NOT NULL,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                lote_canasto_id INTEGER NOT NULL REFERENCES public.nodos_lotes_estacion(id) ON DELETE CASCADE,
                total_venta_vecinos NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_base_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ganancia_neta_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_transferencias_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_efectivo_mano_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                direccion_compensacion VARCHAR(50) NOT NULL DEFAULT 'GESTOR_RINDE_A_LAMDA',
                monto_compensacion_final NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                saldo_cta_cte_post_cierre NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                movimiento_cc_id BIGINT,
                observaciones TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );

            ALTER TABLE public.nodos_lotes_estacion
                ADD COLUMN IF NOT EXISTS liquidacion_cerrada BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS liquidacion_id INTEGER REFERENCES public.nodos_liquidaciones_lote(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS fecha_liquidacion TIMESTAMP;

            ALTER TABLE public.nodos_maestro
                ADD COLUMN IF NOT EXISTS cliente_madre_bunker_id INTEGER REFERENCES public.bunker_clientes(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS codigo_bunker_cliente_madre VARCHAR(80),
                ADD COLUMN IF NOT EXISTS usar_cuenta_madre_unificada BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS latitud NUMERIC(12,8),
                ADD COLUMN IF NOT EXISTS longitud NUMERIC(12,8),
                ADD COLUMN IF NOT EXISTS mostrar_ingredientes_tienda BOOLEAN DEFAULT true,
                ADD COLUMN IF NOT EXISTS gestor_token VARCHAR(80),
                ADD COLUMN IF NOT EXISTS bajada_marca TEXT,
                ADD COLUMN IF NOT EXISTS slug_historico TEXT,
                ADD COLUMN IF NOT EXISTS tema_visual JSONB NOT NULL DEFAULT '{}'::jsonb,
                ADD COLUMN IF NOT EXISTS modo_vidriera_tienda VARCHAR(24) NOT NULL DEFAULT 'PORTADAS';

            CREATE UNIQUE INDEX IF NOT EXISTS unq_nodos_maestro_gestor_token
                ON public.nodos_maestro (gestor_token)
                WHERE gestor_token IS NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_nodos_maestro_slug_historico_lower
                ON public.nodos_maestro (LOWER(slug_historico))
                WHERE slug_historico IS NOT NULL;

            ALTER TABLE public.nodos_ofertas_gestor
                ADD COLUMN IF NOT EXISTS mostrar_ingredientes BOOLEAN DEFAULT true,
                ADD COLUMN IF NOT EXISTS nombre_vidriera_personalizado TEXT,
                ADD COLUMN IF NOT EXISTS categoria_vidriera_personalizada TEXT,
                ADD COLUMN IF NOT EXISTS fotos_vidriera JSONB NOT NULL DEFAULT '[]'::jsonb,
                ADD COLUMN IF NOT EXISTS narrativa_tienda TEXT,
                ADD COLUMN IF NOT EXISTS videos_vidriera JSONB NOT NULL DEFAULT '[]'::jsonb,
                ADD COLUMN IF NOT EXISTS portada_modo VARCHAR(20) NOT NULL DEFAULT 'AUTO',
                ADD COLUMN IF NOT EXISTS portada_media_id VARCHAR(64);

            ALTER TABLE public.nodos_articulos_catalogo
                ADD COLUMN IF NOT EXISTS fotos_catalogo_base JSONB NOT NULL DEFAULT '[]'::jsonb;

            ALTER TABLE public.nodos_propuestas_fracciones
                ADD COLUMN IF NOT EXISTS alias_vidriera_sugerido TEXT;

            ALTER TABLE public.nodos_pedidos_items
                ADD COLUMN IF NOT EXISTS nombre_vidriera_vecino TEXT;

            CREATE TABLE IF NOT EXISTS public.nodos_configuracion_canal (
                id INTEGER PRIMARY KEY DEFAULT 1,
                cuenta_bancaria_id INTEGER REFERENCES public.fin_cuentas_bancarias(id) ON DELETE SET NULL,
                banco_recaudador VARCHAR(160) DEFAULT 'Banco Galicia',
                alias_recaudador VARCHAR(120) NOT NULL DEFAULT 'LAMDA.SER.MARTIN',
                cbu_recaudador VARCHAR(40) DEFAULT '0070373230004007844141',
                titular_recaudador VARCHAR(180) DEFAULT 'Martín Ignacio Serrano',
                cuil_recaudador VARCHAR(30) DEFAULT '23-24892174-9',
                numero_cuenta_recaudador VARCHAR(50) DEFAULT '400784413734',
                solo_transferencia_bancaria BOOLEAN NOT NULL DEFAULT true,
                updated_at TIMESTAMP DEFAULT NOW()
            );

            INSERT INTO public.nodos_configuracion_canal (
                id, cuenta_bancaria_id, banco_recaudador, alias_recaudador, cbu_recaudador, titular_recaudador
            )
            SELECT
                1, NULL, 'Banco Galicia', 'LAMDA.SER.MARTIN', '0070373230004007844141', 'Martín Ignacio Serrano'
            WHERE NOT EXISTS (
                SELECT 1 FROM public.nodos_configuracion_canal WHERE id = 1
            );

            ALTER TABLE public.nodos_liquidaciones_lote
                ADD COLUMN IF NOT EXISTS movimiento_cc_madre_id BIGINT,
                ADD COLUMN IF NOT EXISTS saldo_cta_cte_madre_post_cierre NUMERIC(14,2);

            ALTER TABLE public.nodos_maestro
                ADD COLUMN IF NOT EXISTS perfil_operativo VARCHAR(40) NOT NULL DEFAULT 'vecinal',
                ADD COLUMN IF NOT EXISTS modulos_activos JSONB NOT NULL DEFAULT '{}'::jsonb,
                ADD COLUMN IF NOT EXISTS config_paqueteria JSONB NOT NULL DEFAULT '{}'::jsonb,
                ADD COLUMN IF NOT EXISTS diccionario_textos JSONB NOT NULL DEFAULT '{}'::jsonb,
                ADD COLUMN IF NOT EXISTS plantilla_origen_id INTEGER REFERENCES public.nodos_maestro(id) ON DELETE SET NULL;

            ALTER TABLE public.nodos_vecinos
                ADD COLUMN IF NOT EXISTS dni_cuil VARCHAR(24),
                ADD COLUMN IF NOT EXISTS email_contacto VARCHAR(160),
                ADD COLUMN IF NOT EXISTS cp_habitual VARCHAR(12),
                ADD COLUMN IF NOT EXISTS provincia_habitual VARCHAR(80),
                ADD COLUMN IF NOT EXISTS localidad_habitual VARCHAR(120);

            ALTER TABLE public.nodos_liquidaciones_lote
                ALTER COLUMN lote_canasto_id DROP NOT NULL;

            ALTER TABLE public.nodos_liquidaciones_lote
                ADD COLUMN IF NOT EXISTS tipo_liquidacion VARCHAR(40) NOT NULL DEFAULT 'CANASTO_SEMANAL',
                ADD COLUMN IF NOT EXISTS cantidad_ordenes INTEGER NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS total_envio_cobrado_clientes NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS total_costo_flete_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS detalle_ordenes_json JSONB NOT NULL DEFAULT '[]'::jsonb;

            ALTER TABLE public.nodos_pedidos_vecinos
                ADD COLUMN IF NOT EXISTS presupuesto_id_local INTEGER,
                ADD COLUMN IF NOT EXISTS secuencia_operativa_lamda VARCHAR(40) DEFAULT 'Imprimir',
                ADD COLUMN IF NOT EXISTS vecino_email VARCHAR(160),
                ADD COLUMN IF NOT EXISTS destinatario_dni VARCHAR(24),
                ADD COLUMN IF NOT EXISTS debito_cta_cte_registrado BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS movimiento_cc_id INTEGER,
                ADD COLUMN IF NOT EXISTS liquidacion_id INTEGER REFERENCES public.nodos_liquidaciones_lote(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS fecha_liquidacion TIMESTAMP,
                ADD COLUMN IF NOT EXISTS costo_flete_lamda NUMERIC(14,2) NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS stock_descontado_fulfillment BOOLEAN NOT NULL DEFAULT false;

            CREATE TABLE IF NOT EXISTS public.nodos_pedidos_envios_postales (
                id SERIAL PRIMARY KEY,
                pedido_id INTEGER NOT NULL UNIQUE REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE CASCADE,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                operador_postal VARCHAR(40) NOT NULL DEFAULT 'CORREO_ARGENTINO',
                modalidad_postal VARCHAR(30) NOT NULL DEFAULT 'DOMICILIO',
                sucursal_codigo VARCHAR(60),
                sucursal_nombre VARCHAR(180),
                destinatario_nombre VARCHAR(160) NOT NULL,
                destinatario_dni VARCHAR(24) NOT NULL,
                cp_destino VARCHAR(12) NOT NULL,
                provincia_codigo VARCHAR(10),
                provincia_nombre VARCHAR(80) NOT NULL,
                localidad_nombre VARCHAR(120) NOT NULL,
                calle VARCHAR(160),
                altura VARCHAR(30),
                piso_depto VARCHAR(60),
                referencias_domicilio VARCHAR(280),
                peso_gramos INTEGER NOT NULL DEFAULT 1000,
                largo_cm NUMERIC(6,1) DEFAULT 25.0,
                ancho_cm NUMERIC(6,1) DEFAULT 20.0,
                alto_cm NUMERIC(6,1) DEFAULT 15.0,
                valor_declarado NUMERIC(14,2) DEFAULT 0.00,
                costo_envio_cliente NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                costo_flete_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                modo_imposicion VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
                id_externo_carrier VARCHAR(120),
                numero_tracking VARCHAR(100),
                url_tracking_carrier TEXT,
                rotulo_formato VARCHAR(16),
                rotulo_contenido TEXT,
                estado_envio VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE_DESPACHO',
                eventos_carrier_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                email_contacto VARCHAR(160),
                despachado_por VARCHAR(120),
                fecha_despacho TIMESTAMPTZ,
                fecha_entrega_correo TIMESTAMPTZ,
                ultimo_sync_carrier_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            ALTER TABLE public.nodos_pedidos_envios_postales
                ADD COLUMN IF NOT EXISTS email_contacto VARCHAR(160),
                ADD COLUMN IF NOT EXISTS despachado_por VARCHAR(120);

            CREATE INDEX IF NOT EXISTS idx_nodos_envios_postales_nodo_estado
                ON public.nodos_pedidos_envios_postales (nodo_id, estado_envio, id DESC);
        `);

        // Garantizar de forma idempotente todos los índices UNIQUE del módulo Nodos
        // incluso si las tablas habían sido creadas previamente por snapshot sin constraints secundarias.
        const uniqueSpecsNodos = [
            { table: 'nodos_maestro', index: 'nodos_maestro_codigo_nodo_key', cols: ['codigo_nodo'] },
            { table: 'nodos_maestro', index: 'nodos_maestro_slug_key', cols: ['slug'] },
            { table: 'nodos_articulos_catalogo', index: 'nodos_articulos_catalogo_sku_nodo_key', cols: ['sku_nodo'] },
            { table: 'nodos_propuestas_fracciones', index: 'nodos_propuestas_fracciones_codigo_propuesta_key', cols: ['codigo_propuesta'] },
            { table: 'nodos_ofertas_gestor', index: 'unq_nodo_articulo_oferta', cols: ['nodo_id', 'articulo_catalogo_id'] },
            { table: 'nodos_vecinos', index: 'unq_nodos_vecinos_nodo_tel', cols: ['nodo_id', 'telefono_normalizado'] },
            { table: 'nodos_pedidos_vecinos', index: 'nodos_pedidos_vecinos_codigo_pedido_key', cols: ['codigo_pedido'] },
            { table: 'nodos_lotes_estacion', index: 'nodos_lotes_estacion_codigo_canasto_key', cols: ['codigo_canasto'] },
            { table: 'nodos_lotes_estacion', index: 'unq_nodo_ventana_canasto', cols: ['nodo_id', 'fecha_entrega_label'] },
            { table: 'nodos_alias_vecinos_aprendidos', index: 'unq_nodo_titular_vecino', cols: ['nodo_id', 'titular_normalizado'] },
            { table: 'nodos_liquidaciones_lote', index: 'nodos_liquidaciones_lote_codigo_liquidacion_key', cols: ['codigo_liquidacion'] },
            { table: 'nodos_reparto_radar', index: 'unq_nodos_reparto_radar_nodo', cols: ['nodo_id'] },
            { table: 'nodos_pedidos_envios_postales', index: 'nodos_pedidos_envios_postales_pedido_id_key', cols: ['pedido_id'] }
        ];
        for (const spec of uniqueSpecsNodos) {
            const colsList = spec.cols.map(c => `"${c}"`).join(', ');
            const colsArrayLiteral = spec.cols.map(c => `'${c}'`).join(', ');
            const notNullCond = spec.cols.map(c => `"${c}" IS NOT NULL`).join(' AND ');
            await client.query(`
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = '${spec.table}'
                    ) AND NOT EXISTS (
                        SELECT 1
                        FROM pg_index ix
                        JOIN pg_class tbl ON tbl.oid = ix.indrelid
                        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
                        WHERE ns.nspname = 'public'
                          AND tbl.relname = '${spec.table}'
                          AND ix.indisunique = true
                          AND ix.indpred IS NULL
                          AND (
                              SELECT array_agg(att.attname::text ORDER BY u.ord)
                              FROM unnest(ix.indkey) WITH ORDINALITY AS u(attnum, ord)
                              JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = u.attnum
                              WHERE u.ord <= ix.indnkeyatts
                          ) = ARRAY[${colsArrayLiteral}]::text[]
                    ) AND NOT EXISTS (
                        SELECT 1
                        FROM public."${spec.table}"
                        WHERE ${notNullCond}
                        GROUP BY ${colsList}
                        HAVING COUNT(*) > 1
                    ) THEN
                        CREATE UNIQUE INDEX IF NOT EXISTS "${spec.index}"
                            ON public."${spec.table}" (${colsList});
                    END IF;
                END $$;
            `);
        }

        // Garantizar gestor_token criptográfico único en nodos existentes sin token
        const nodosSinTokenRes = await client.query(
            `SELECT id FROM public.nodos_maestro WHERE gestor_token IS NULL OR LENGTH(TRIM(gestor_token)) < 16`
        );
        for (const rTok of nodosSinTokenRes.rows) {
            await client.query(
                `UPDATE public.nodos_maestro SET gestor_token = $1 WHERE id = $2`,
                [generarGestorTokenNodo(), rTok.id]
            );
        }

        // Si algún Nodo con cuenta compartida quedó sin alias efectivo (o con alias LAMDA distinto al configurado en canal)
        await client.query(`
            UPDATE public.nodos_maestro nm
            SET alias_bancario_display = cfg.alias_recaudador,
                cbu_display = COALESCE(NULLIF(cfg.cbu_recaudador, ''), nm.cbu_display),
                titular_display = COALESCE(NULLIF(cfg.titular_recaudador, ''), nm.titular_display)
            FROM public.nodos_configuracion_canal cfg
            WHERE cfg.id = 1
              AND COALESCE(nm.usa_cuenta_compartida, true) = true
              AND (
                  nm.alias_bancario_display IS NULL
                  OR nm.alias_bancario_display = ''
                  OR (nm.alias_bancario_display ILIKE '%lamda%' AND COALESCE(cfg.alias_recaudador, '') NOT ILIKE '%lamda%')
              );
        `);

        // Verificar si necesitamos poblar datos iniciales de Laboratorio (solo cuando se pide sembrarDemo explícitamente)
        const countNodos = await client.query('SELECT COUNT(*)::int AS total FROM public.nodos_maestro');
        if (forzarSemillaDemo && countNodos.rows[0].total === 0) {
            // Buscar cuenta bancaria activa y tarifa activa
            const ctaRes = await client.query('SELECT id, alias, cbu, titular FROM public.fin_cuentas_bancarias WHERE estado = $1 ORDER BY id LIMIT 1', ['ACTIVA']);
            const ctaDefault = ctaRes.rows[0] || { id: null, alias: 'LAMDA.SER.MARTIN', cbu: '0070373230004007844141', titular: 'MARTIN IGNACIO SERRANO' };

            const tarRes = await client.query('SELECT id, valor_hora FROM public.colaboradores_tarifas WHERE activo = true ORDER BY id LIMIT 1');
            const tarifaDefault = tarRes.rows[0] || { id: null, valor_hora: 7000 };

            // Generar logos ZPL ^GFA reales para los 2 Nodos semilla
            const logoNodo1 = await convertirLogoAZplGfa({
                nombreMarca: 'ALMACEN VERDE',
                iniciales: 'AV',
                threshold: 138,
                mode: 'threshold'
            });

            const logoNodo2 = await convertirLogoAZplGfa({
                nombreMarca: 'LA DESPENSA',
                iniciales: 'LD',
                threshold: 138,
                mode: 'threshold'
            });

            const nodo1Datos = {
                codigo_nodo: 'NODO-001',
                slug: 'almacen-verde-city-bell',
                nombre_marca: 'Almacén Verde City Bell',
                subtitulo_marca: 'Alimentación Consciente - Entrega Barrial',
                gestor_nombre: 'Carolina Méndez',
                gestor_telefono: '5492215548910',
                gestor_email: 'carolina@almacenverde.com.ar',
                barrio_zona: 'City Bell Centro / Cantilo',
                direccion_retiro: 'Calle Cantilo 452 e/ 13c y 14, City Bell',
                cuenta_bancaria_id: ctaDefault.id,
                usa_cuenta_compartida: false,
                alias_bancario_display: 'ALMACEN.VERDE.CB',
                cbu_display: ctaDefault.cbu,
                titular_display: ctaDefault.titular,
                permitir_envio_barrial: true,
                cargo_envio_barrial: 1500.00,
                margen_gestor_default_pct: 28.00,
                color_primario: '#16a34a',
                config_ventanas_corte: [
                    { dia_entrega: 'Miércoles', cierre_dia: 'Martes', cierre_hora: '14:00', ventana_retiro: '17:00 a 20:00 hs' },
                    { dia_entrega: 'Sábado', cierre_dia: 'Viernes', cierre_hora: '14:00', ventana_retiro: '10:00 a 13:30 hs' }
                ]
            };

            const vinculo1 = await asegurarVinculoContableNodo(client, nodo1Datos);
            const insN1 = await client.query(
                `INSERT INTO public.nodos_maestro (
                    codigo_nodo, slug, nombre_marca, subtitulo_marca,
                    gestor_nombre, gestor_telefono, gestor_email, barrio_zona, direccion_retiro,
                    bunker_cliente_id, codigo_bunker_cliente, cuenta_bancaria_id, usa_cuenta_compartida,
                    alias_bancario_display, cbu_display, titular_display,
                    permitir_envio_barrial, cargo_envio_barrial, margen_gestor_default_pct,
                    config_ventanas_corte, color_primario, logo_mono_preview_base64, logo_zpl_gfa, logo_zpl_config
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
                ) RETURNING id`,
                [
                    nodo1Datos.codigo_nodo, nodo1Datos.slug, nodo1Datos.nombre_marca, nodo1Datos.subtitulo_marca,
                    nodo1Datos.gestor_nombre, nodo1Datos.gestor_telefono, nodo1Datos.gestor_email, nodo1Datos.barrio_zona, nodo1Datos.direccion_retiro,
                    vinculo1.bunker_cliente_id, vinculo1.codigo_bunker_cliente, nodo1Datos.cuenta_bancaria_id, nodo1Datos.usa_cuenta_compartida,
                    nodo1Datos.alias_bancario_display, nodo1Datos.cbu_display, nodo1Datos.titular_display,
                    nodo1Datos.permitir_envio_barrial, nodo1Datos.cargo_envio_barrial, nodo1Datos.margen_gestor_default_pct,
                    JSON.stringify(nodo1Datos.config_ventanas_corte), nodo1Datos.color_primario,
                    logoNodo1.logo_mono_preview_base64, logoNodo1.logo_zpl_gfa,
                    JSON.stringify({ width: logoNodo1.width, height: logoNodo1.height, threshold: 138, mode: 'threshold', iniciales: 'AV' })
                ]
            );
            const nodo1Id = insN1.rows[0].id;

            const nodo2Datos = {
                codigo_nodo: 'NODO-002',
                slug: 'la-despensa-gonnet',
                nombre_marca: 'La Despensa de Gonnet',
                subtitulo_marca: 'Compras Comunitarias Saludables',
                gestor_nombre: 'Martín Echeverría',
                gestor_telefono: '5492216123344',
                gestor_email: 'martin@ladespensagonnet.com.ar',
                barrio_zona: 'Villa Elisa / Gonnet',
                direccion_retiro: 'Calle 502 N° 1840 e/ 13 y 14, Gonnet',
                cuenta_bancaria_id: ctaDefault.id,
                usa_cuenta_compartida: true,
                alias_bancario_display: ctaDefault.alias || 'LAMDA.SER.MARTIN',
                cbu_display: ctaDefault.cbu,
                titular_display: ctaDefault.titular,
                permitir_envio_barrial: true,
                cargo_envio_barrial: 1800.00,
                margen_gestor_default_pct: 25.00,
                color_primario: '#0284c7',
                config_ventanas_corte: [
                    { dia_entrega: 'Jueves', cierre_dia: 'Miércoles', cierre_hora: '18:00', ventana_retiro: '16:30 a 19:30 hs' }
                ]
            };

            const vinculo2 = await asegurarVinculoContableNodo(client, nodo2Datos);
            const insN2 = await client.query(
                `INSERT INTO public.nodos_maestro (
                    codigo_nodo, slug, nombre_marca, subtitulo_marca,
                    gestor_nombre, gestor_telefono, gestor_email, barrio_zona, direccion_retiro,
                    bunker_cliente_id, codigo_bunker_cliente, cuenta_bancaria_id, usa_cuenta_compartida,
                    alias_bancario_display, cbu_display, titular_display,
                    permitir_envio_barrial, cargo_envio_barrial, margen_gestor_default_pct,
                    config_ventanas_corte, color_primario, logo_mono_preview_base64, logo_zpl_gfa, logo_zpl_config
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
                ) RETURNING id`,
                [
                    nodo2Datos.codigo_nodo, nodo2Datos.slug, nodo2Datos.nombre_marca, nodo2Datos.subtitulo_marca,
                    nodo2Datos.gestor_nombre, nodo2Datos.gestor_telefono, nodo2Datos.gestor_email, nodo2Datos.barrio_zona, nodo2Datos.direccion_retiro,
                    vinculo2.bunker_cliente_id, vinculo2.codigo_bunker_cliente, nodo2Datos.cuenta_bancaria_id, nodo2Datos.usa_cuenta_compartida,
                    nodo2Datos.alias_bancario_display, nodo2Datos.cbu_display, nodo2Datos.titular_display,
                    nodo2Datos.permitir_envio_barrial, nodo2Datos.cargo_envio_barrial, nodo2Datos.margen_gestor_default_pct,
                    JSON.stringify(nodo2Datos.config_ventanas_corte), nodo2Datos.color_primario,
                    logoNodo2.logo_mono_preview_base64, logoNodo2.logo_zpl_gfa,
                    JSON.stringify({ width: logoNodo2.width, height: logoNodo2.height, threshold: 138, mode: 'threshold', iniciales: 'LD' })
                ]
            );
            const nodo2Id = insN2.rows[0].id;

            // Consultar costos reales de ingredientes e insumos de envase en etiquetas_pruebas
            const ingRows = await client.query(
                'SELECT id, nombre, costo_patron, es_insumo FROM public.ingredientes WHERE id IN (1, 18, 25, 30, 31, 122, 131, 141, 179, 180, 181)'
            );
            const ingMap = new Map(ingRows.rows.map(r => [Number(r.id), r]));
            const getCostoIng = (id, fallback) => Number(ingMap.get(id)?.costo_patron || fallback);

            const envase180Cost = getCostoIng(180, 45.96); // Bolsa 15 x 18
            const envase179Cost = getCostoIng(179, 71.54); // Bolsa 20 x 25
            const envase181Cost = getCostoIng(181, 18.16); // Bolsa 8 x 15 (flowpack barrita)
            const valorHora = Number(tarifaDefault.valor_hora || 7000);

            const catalogoSemilla = [
                {
                    sku_nodo: 'APN25/27X250G',
                    nombre_publico: 'Almendra Nonpareil Californiana x 250g',
                    categoria_familiar: 'FRUTOS SECOS',
                    presentacion_etiqueta: 'Bolsa 250g',
                    flujo_lamda: 2,
                    origen_tipo: 'INGREDIENTE',
                    ingrediente_origen_id: ingMap.has(1) ? 1 : null,
                    kilos_unidad: 0.25,
                    insumo_envase_id: ingMap.has(180) ? 180 : null,
                    costo_envase_unitario: envase180Cost,
                    segundos_fraccionamiento: 32,
                    costo_insumo_kg: getCostoIng(1, 18109.43),
                    margen_lamda_pct: 22,
                    margen_sugerido_gestor_pct: 28,
                    notas_tecnicas: 'Flujo 2: Fraccionado directo de Almendra Nonpareil calibre grande.'
                },
                {
                    sku_nodo: 'MFSX500G',
                    nombre_publico: 'Mix Frutos Secos con Pasas Familiar x 500g',
                    categoria_familiar: 'FRUTOS SECOS',
                    presentacion_etiqueta: 'Bolsa 500g',
                    flujo_lamda: 3,
                    origen_tipo: 'MIX',
                    ingrediente_origen_id: ingMap.has(149) ? 149 : (ingMap.has(30) ? 30 : null),
                    kilos_unidad: 0.50,
                    insumo_envase_id: ingMap.has(179) ? 179 : null,
                    costo_envase_unitario: envase179Cost,
                    segundos_fraccionamiento: 40,
                    costo_insumo_kg: getCostoIng(149, getCostoIng(30, 5604.22)),
                    margen_lamda_pct: 24,
                    margen_sugerido_gestor_pct: 30,
                    notas_tecnicas: 'Flujo 3: Mezcla interna (Mix Frutos Secos Con Pasas Simple) + fraccionamiento familiar 500g.'
                },
                {
                    sku_nodo: 'CCTSx250',
                    nombre_publico: 'Castaña de Cajú Tostada Artesanal x 250g',
                    categoria_familiar: 'FRUTOS SECOS',
                    presentacion_etiqueta: 'Bolsa 250g',
                    flujo_lamda: 4,
                    origen_tipo: 'UP_EXTERNA',
                    ingrediente_origen_id: ingMap.has(18) ? 18 : null,
                    kilos_unidad: 0.25,
                    insumo_envase_id: ingMap.has(180) ? 180 : null,
                    costo_envase_unitario: envase180Cost,
                    segundos_fraccionamiento: 35,
                    costo_insumo_kg: getCostoIng(18, 10575.53),
                    margen_lamda_pct: 22,
                    margen_sugerido_gestor_pct: 28,
                    notas_tecnicas: 'Flujo 4: Tostado en Unidad Productiva Externa + fraccionamiento local.'
                },
                {
                    sku_nodo: 'BF6X50',
                    nombre_publico: 'Pack Familiar 6 Barritas Energéticas (6 x 50g)',
                    categoria_familiar: 'CEREALES',
                    presentacion_etiqueta: 'Pack 6 u. (300g)',
                    flujo_lamda: 5,
                    origen_tipo: 'UP_EXTERNA',
                    ingrediente_origen_id: ingMap.has(141) ? 141 : null,
                    kilos_unidad: 0.30,
                    insumo_envase_id: ingMap.has(180) ? 180 : null,
                    costo_envase_unitario: envase180Cost,
                    costo_envase_extra: Number((6 * envase181Cost).toFixed(2)),
                    segundos_fraccionamiento: 45,
                    costo_insumo_kg: getCostoIng(141, 15143.70),
                    margen_lamda_pct: 22,
                    margen_sugerido_gestor_pct: 28,
                    notas_tecnicas: 'Flujo 5: Pre-mezcla MPB + UP Externa Barritas + Pack familiar x 6 unidades.'
                },
                {
                    sku_nodo: 'GSX500G',
                    nombre_publico: 'Granola de Sol Crocante con Miel x 500g',
                    categoria_familiar: 'CEREALES',
                    presentacion_etiqueta: 'Bolsa 500g',
                    flujo_lamda: 6,
                    origen_tipo: 'UP_EXTERNA',
                    ingrediente_origen_id: ingMap.has(131) ? 131 : null,
                    kilos_unidad: 0.50,
                    insumo_envase_id: ingMap.has(179) ? 179 : null,
                    costo_envase_unitario: envase179Cost,
                    segundos_fraccionamiento: 45,
                    costo_insumo_kg: getCostoIng(131, 9549.29),
                    margen_lamda_pct: 24,
                    margen_sugerido_gestor_pct: 30,
                    notas_tecnicas: 'Flujo 6: Doble mezcla (Mezcla base + Horneado UP + Agregado seco en taller).'
                }
            ];

            const catalogoIds = [];
            for (const item of catalogoSemilla) {
                const calc = calcularEstructuraCostosNodo({
                    ...item,
                    valor_hora_aplicado: valorHora,
                    iva_pct: 21,
                    iibb_pct: 4.0
                });

                const insCat = await client.query(
                    `INSERT INTO public.nodos_articulos_catalogo (
                        sku_nodo, nombre_publico, categoria_familiar, presentacion_etiqueta,
                        flujo_lamda, origen_tipo, ingrediente_origen_id, kilos_unidad,
                        insumo_envase_id, cantidad_envases_unidad, segundos_fraccionamiento,
                        tarifa_colaborador_id, valor_hora_aplicado, costo_insumo_kg,
                        costo_insumo_fraccion, costo_envase_aplicado, costo_mano_obra_aplicado,
                        margen_lamda_pct, iva_pct, iibb_pct, costo_puro_total,
                        precio_base_nodo_neto, precio_base_nodo_final,
                        margen_sugerido_gestor_pct, precio_sugerido_vecino, notas_tecnicas
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
                    ) RETURNING id`,
                    [
                        item.sku_nodo, item.nombre_publico, item.categoria_familiar, item.presentacion_etiqueta,
                        item.flujo_lamda, item.origen_tipo, item.ingrediente_origen_id, calc.kilos_unidad,
                        item.insumo_envase_id, calc.segundos_fraccionamiento,
                        tarifaDefault.id, calc.valor_hora_aplicado, calc.costo_insumo_kg,
                        calc.costo_insumo_fraccion, calc.costo_envase_aplicado, calc.costo_mano_obra_aplicado,
                        calc.margen_lamda_pct, calc.iva_pct, calc.iibb_pct, calc.costo_puro_total,
                        calc.precio_base_nodo_neto, calc.precio_base_nodo_final,
                        calc.margen_sugerido_gestor_pct, calc.precio_sugerido_vecino, item.notas_tecnicas
                    ]
                );
                const catId = insCat.rows[0].id;
                catalogoIds.push({ id: catId, calc });

                // Crear ofertas para Nodo 1 y Nodo 2
                for (const [nId, margenNodo] of [[nodo1Id, 28], [nodo2Id, 25]]) {
                    const precioVecino = Math.ceil((calc.precio_base_nodo_final * (1 + margenNodo / 100)) / 50) * 50;
                    const gananciaGestor = Math.max(0, precioVecino - calc.precio_base_nodo_final);
                    await client.query(
                        `INSERT INTO public.nodos_ofertas_gestor (
                            nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                            margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor,
                            publicado_tienda, destacado_tienda
                        ) VALUES ($1,$2,$3,$4,$5,$6,true,false)`,
                        [nId, catId, calc.precio_base_nodo_final, margenNodo, precioVecino, gananciaGestor]
                    );
                }
            }

            // Sembrar 3 propuestas de fracciones de los gestores (2 pendientes de cotización y 1 ya aprobada)
            await client.query(
                `INSERT INTO public.nodos_propuestas_fracciones (
                    codigo_propuesta, nodo_solicitante_id, nombre_sugerido, categoria_sugerida,
                    flujo_sugerido, ingrediente_sugerido_id, kilos_sugeridos, insumo_envase_sugerido_id,
                    segundos_estimados, precio_objetivo_vecino, comentario_gestor, estado
                ) VALUES
                ($1, $2, 'Nuez Mariposa Extra Light Familiar x 250g', 'Frutos Secos Puros', 2, $3, 0.2500, $4, 35, 6200,
                 'Las familias del barrio nos piden mucho nuez mariposa clara en bolsita de 250g para desayunos.', 'PENDIENTE_COTIZACION'),
                ($5, $6, 'Mix Premium Sin Pasas x 400g', 'Mixes Familiares', 3, $7, 0.4000, $8, 38, 11900,
                 'Buscamos una presentación intermedia de 400g de Mix Premium (almendra, cajú, nuez y avellana).', 'PENDIENTE_COTIZACION'),
                ($9, $2, 'Granola de Flor Premium x 500g', 'Granolas Horneadas', 6, $10, 0.5000, $8, 45, 13800,
                 'Queremos sumar la variedad Granola de Flor en medio kilo junto a la de Sol.', 'PENDIENTE_COTIZACION')`,
                [
                    'PROP-NB-001', nodo1Id, ingMap.has(25) ? 25 : null, ingMap.has(180) ? 180 : null,
                    'PROP-NB-002', nodo2Id, ingMap.has(150) ? 150 : (ingMap.has(31) ? 31 : null), ingMap.has(179) ? 179 : null,
                    'PROP-NB-003', ingMap.has(122) ? 122 : null
                ]
            );
        }

        // Sembrar pedidos vecinales de muestra para Etapa 2 solo si se solicita sembrarDemo explícitamente
        const countPedidos = await client.query('SELECT COUNT(*)::int AS total FROM public.nodos_pedidos_vecinos');
        if (forzarSemillaDemo && countPedidos.rows[0].total === 0) {
            const n1Res = await client.query('SELECT id, direccion_retiro, cargo_envio_barrial FROM public.nodos_maestro ORDER BY id ASC LIMIT 1');
            if (n1Res.rows.length > 0) {
                const n1 = n1Res.rows[0];
                const ofRes = await client.query(
                    `SELECT nog.*, nac.sku_nodo, nac.nombre_publico, nac.presentacion_etiqueta
                     FROM public.nodos_ofertas_gestor nog
                     JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
                     WHERE nog.nodo_id = $1
                     ORDER BY nac.id ASC`,
                    [n1.id]
                );
                const ofs = ofRes.rows;
                if (ofs.length >= 3) {
                    const v1 = await client.query(
                        `INSERT INTO public.nodos_vecinos (nodo_id, nombre_completo, telefono_whatsapp, direccion_calle, entrecalles_referencia)
                         VALUES ($1, 'María Laura Gómez', '221-554-8910', 'Cantilo 452', 'e/ 13c y 14') RETURNING id`,
                        [n1.id]
                    );
                    const v2 = await client.query(
                        `INSERT INTO public.nodos_vecinos (nodo_id, nombre_completo, telefono_whatsapp, direccion_calle, entrecalles_referencia)
                         VALUES ($1, 'Valeria Sánchez', '221-509-4412', 'Calle 473 bis N° 1120', 'e/ 14b y 15 - City Bell') RETURNING id`,
                        [n1.id]
                    );

                    // Pedido 1: Retiro en Nodo, Pagado por Transferencia
                    const it1A = ofs[0];
                    const it1B = ofs[1];
                    const subVec1 = Number(it1A.precio_venta_vecino) * 2 + Number(it1B.precio_venta_vecino) * 1;
                    const subBase1 = Number(it1A.precio_base_nodo_snapshot) * 2 + Number(it1B.precio_base_nodo_snapshot) * 1;
                    const gan1 = subVec1 - subBase1;

                    const p1 = await client.query(
                        `INSERT INTO public.nodos_pedidos_vecinos (
                            codigo_pedido, nodo_id, vecino_id, vecino_nombre, vecino_telefono,
                            modalidad_entrega, direccion_entrega, fecha_entrega_label, ventana_horaria_label,
                            medio_pago, estado_pago, estado_operativo,
                            subtotal_productos_vecino, cargo_envio_barrial, total_vecino, total_base_lamda, ganancia_total_gestor
                         ) VALUES ($1,$2,$3,$4,$5,'RETIRO_NODO',$6,'Miércoles (17:00 a 20:00 hs)','17:00 a 20:00 hs','TRANSFERENCIA','PAGADO_TRANSFERENCIA','CONFIRMADO_VECINO',$7,0,$7,$8,$9)
                         RETURNING id`,
                        ['NB-1041', n1.id, v1.rows[0].id, 'María Laura Gómez', '221-554-8910', n1.direccion_retiro, subVec1, subBase1, gan1]
                    );
                    await client.query(
                        `INSERT INTO public.nodos_pedidos_items (
                            pedido_id, articulo_catalogo_id, sku_nodo, nombre_publico, presentacion_etiqueta,
                            cantidad, precio_unitario_vecino, precio_unitario_base_lamda, subtotal_vecino, subtotal_base_lamda, ganancia_item_gestor
                         ) VALUES
                         ($1,$2,$3,$4,$5,2,$6,$7,$8,$9,$10),
                         ($1,$11,$12,$13,$14,1,$15,$16,$17,$18,$19)`,
                        [
                            p1.rows[0].id,
                            it1A.articulo_catalogo_id, it1A.sku_nodo, it1A.nombre_publico, it1A.presentacion_etiqueta,
                            it1A.precio_venta_vecino, it1A.precio_base_nodo_snapshot, Number(it1A.precio_venta_vecino) * 2, Number(it1A.precio_base_nodo_snapshot) * 2, Number(it1A.ganancia_unitaria_gestor) * 2,
                            it1B.articulo_catalogo_id, it1B.sku_nodo, it1B.nombre_publico, it1B.presentacion_etiqueta,
                            it1B.precio_venta_vecino, it1B.precio_base_nodo_snapshot, Number(it1B.precio_venta_vecino), Number(it1B.precio_base_nodo_snapshot), Number(it1B.ganancia_unitaria_gestor)
                        ]
                    );

                    // Pedido 2: Envío a Domicilio Barrial (+$1.500 100% para el gestor), Cobrar en Efectivo
                    const it2A = ofs[2];
                    const it2B = ofs[3] || ofs[0];
                    const envioBarrial = Number(n1.cargo_envio_barrial || 1500);
                    const subVec2 = Number(it2A.precio_venta_vecino) * 1 + Number(it2B.precio_venta_vecino) * 2;
                    const subBase2 = Number(it2A.precio_base_nodo_snapshot) * 1 + Number(it2B.precio_base_nodo_snapshot) * 2;
                    const totVec2 = subVec2 + envioBarrial;
                    const gan2 = (subVec2 - subBase2) + envioBarrial; // 100% del envío barrial corresponde al gestor

                    const p2 = await client.query(
                        `INSERT INTO public.nodos_pedidos_vecinos (
                            codigo_pedido, nodo_id, vecino_id, vecino_nombre, vecino_telefono,
                            modalidad_entrega, direccion_entrega, entrecalles_referencia, fecha_entrega_label, ventana_horaria_label,
                            medio_pago, estado_pago, estado_operativo,
                            subtotal_productos_vecino, cargo_envio_barrial, total_vecino, total_base_lamda, ganancia_total_gestor
                         ) VALUES ($1,$2,$3,$4,$5,'ENVIO_BARRIAL','Calle 473 bis N° 1120','e/ 14b y 15 - City Bell','Miércoles (17:00 a 20:00 hs)','17:00 a 20:00 hs','EFECTIVO','COBRAR_EN_ENTREGA','CONFIRMADO_VECINO',$6,$7,$8,$9,$10)
                         RETURNING id`,
                        ['NB-1042', n1.id, v2.rows[0].id, 'Valeria Sánchez', '221-509-4412', subVec2, envioBarrial, totVec2, subBase2, gan2]
                    );
                    await client.query(
                        `INSERT INTO public.nodos_pedidos_items (
                            pedido_id, articulo_catalogo_id, sku_nodo, nombre_publico, presentacion_etiqueta,
                            cantidad, precio_unitario_vecino, precio_unitario_base_lamda, subtotal_vecino, subtotal_base_lamda, ganancia_item_gestor
                         ) VALUES
                         ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10),
                         ($1,$11,$12,$13,$14,2,$15,$16,$17,$18,$19)`,
                        [
                            p2.rows[0].id,
                            it2A.articulo_catalogo_id, it2A.sku_nodo, it2A.nombre_publico, it2A.presentacion_etiqueta,
                            it2A.precio_venta_vecino, it2A.precio_base_nodo_snapshot, Number(it2A.precio_venta_vecino), Number(it2A.precio_base_nodo_snapshot), Number(it2A.ganancia_unitaria_gestor),
                            it2B.articulo_catalogo_id, it2B.sku_nodo, it2B.nombre_publico, it2B.presentacion_etiqueta,
                            it2B.precio_venta_vecino, it2B.precio_base_nodo_snapshot, Number(it2B.precio_venta_vecino) * 2, Number(it2B.precio_base_nodo_snapshot) * 2, Number(it2B.ganancia_unitaria_gestor) * 2
                        ]
                    );
                }
            }
        }

        // Unificar etiqueta de ventana de los pedidos semilla (NB-1041, NB-1042) con la próxima entrega real del Miércoles
        const refMiercoles = await client.query(
            `SELECT fecha_entrega_comprometida, fecha_entrega_label, ventana_horaria_label
             FROM public.nodos_pedidos_vecinos
             WHERE fecha_entrega_label ILIKE 'Miércoles %/%'
             ORDER BY id DESC LIMIT 1`
        );
        const labelMiercolesUnificado = refMiercoles.rows[0]?.fecha_entrega_label || 'Miércoles 11/11 (17:00 a 20:00 hs)';
        const fechaMiercolesIso = refMiercoles.rows[0]?.fecha_entrega_comprometida || '2026-11-11';
        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET fecha_entrega_label = $1,
                 fecha_entrega_comprometida = $2
             WHERE fecha_entrega_label = 'Miércoles (17:00 a 20:00 hs)'`,
            [labelMiercolesUnificado, fechaMiercolesIso]
        );

        // Columnas de integración nativa con el circuito operativo habitual de LAMDA (Presupuestos / Producción / Chequeo / Logística)
        await client.query(`
            ALTER TABLE public.nodos_lotes_estacion
                ADD COLUMN IF NOT EXISTS presupuesto_id_local INTEGER,
                ADD COLUMN IF NOT EXISTS id_presupuesto_ext VARCHAR(80),
                ADD COLUMN IF NOT EXISTS secuencia_operativa_lamda VARCHAR(40) DEFAULT 'Imprimir'
        `);

        // Si el Nodo 2 (La Despensa de Gonnet) aún no tiene pedidos semilla y se pidió sembrarDemo, sembrar 2 pedidos vecinales para su Canasto
        const n2Res = await client.query(`SELECT * FROM public.nodos_maestro WHERE codigo_nodo = 'NODO-002' LIMIT 1`);
        if (forzarSemillaDemo && n2Res.rows.length > 0) {
            const n2 = n2Res.rows[0];
            const countN2Peds = await client.query(`SELECT COUNT(*)::int AS total FROM public.nodos_pedidos_vecinos WHERE nodo_id = $1`, [n2.id]);
            if (countN2Peds.rows[0].total === 0) {
                const vG1 = await client.query(
                    `INSERT INTO public.nodos_vecinos (
                        nodo_id, nombre_completo, telefono_whatsapp, direccion_calle, entrecalles_referencia
                     ) VALUES ($1, 'Sofía Albornoz', '221-612-3390', 'Calle 501 N° 1920', 'e/ 14 y 15 - Gonnet')
                     RETURNING id`,
                    [n2.id]
                );
                const vG2 = await client.query(
                    `INSERT INTO public.nodos_vecinos (
                        nodo_id, nombre_completo, telefono_whatsapp, direccion_calle, entrecalles_referencia
                     ) VALUES ($1, 'Federico Quiroga', '221-498-7721', 'Calle 495 N° 1650', 'e/ 11 y 12 - Gonnet')
                     RETURNING id`,
                    [n2.id]
                );

                const ofsN2Res = await client.query(
                    `SELECT nog.*, nac.sku_nodo, nac.nombre_publico, nac.presentacion_etiqueta
                     FROM public.nodos_ofertas_gestor nog
                     JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
                     WHERE nog.nodo_id = $1
                     ORDER BY nac.id ASC`,
                    [n2.id]
                );
                const ofs2 = ofsN2Res.rows;
                if (ofs2.length >= 2) {
                    const oA = ofs2[0]; // Almendra 250g
                    const oB = ofs2[4] || ofs2[1]; // Granola de Sol 500g
                    const subV1 = Number(oA.precio_venta_vecino) + Number(oB.precio_venta_vecino) * 2;
                    const subB1 = Number(oA.precio_base_nodo_snapshot) + Number(oB.precio_base_nodo_snapshot) * 2;
                    const ganV1 = subV1 - subB1;

                    const pG1 = await client.query(
                        `INSERT INTO public.nodos_pedidos_vecinos (
                            codigo_pedido, nodo_id, vecino_id, vecino_nombre, vecino_telefono,
                            modalidad_entrega, direccion_entrega, fecha_entrega_comprometida, fecha_entrega_label, ventana_horaria_label,
                            medio_pago, estado_pago, estado_operativo, ubicacion_deposito, etiqueta_impresa,
                            subtotal_productos_vecino, cargo_envio_barrial, total_vecino, total_base_lamda, ganancia_total_gestor
                         ) VALUES ($1,$2,$3,'Sofía Albornoz','221-612-3390','RETIRO_NODO',$4,$5,$6,'17:00 a 20:00 hs','TRANSFERENCIA','PAGADO_TRANSFERENCIA','ARMADO_EN_CANASTO','ESTACION_NODOS',true,$7,0,$7,$8,$9)
                         RETURNING id`,
                        ['NB-1045', n2.id, vG1.rows[0].id, n2.direccion_retiro, fechaMiercolesIso, labelMiercolesUnificado, subV1, subB1, ganV1]
                    );
                    await client.query(
                        `INSERT INTO public.nodos_pedidos_items (
                            pedido_id, articulo_catalogo_id, sku_nodo, nombre_publico, presentacion_etiqueta,
                            cantidad, precio_unitario_vecino, precio_unitario_base_lamda, subtotal_vecino, subtotal_base_lamda, ganancia_item_gestor
                         ) VALUES
                         ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10),
                         ($1,$11,$12,$13,$14,2,$15,$16,$17,$18,$19)`,
                        [
                            pG1.rows[0].id,
                            oA.articulo_catalogo_id, oA.sku_nodo, oA.nombre_publico, oA.presentacion_etiqueta,
                            oA.precio_venta_vecino, oA.precio_base_nodo_snapshot, Number(oA.precio_venta_vecino), Number(oA.precio_base_nodo_snapshot), Number(oA.ganancia_unitaria_gestor),
                            oB.articulo_catalogo_id, oB.sku_nodo, oB.nombre_publico, oB.presentacion_etiqueta,
                            oB.precio_venta_vecino, oB.precio_base_nodo_snapshot, Number(oB.precio_venta_vecino) * 2, Number(oB.precio_base_nodo_snapshot) * 2, Number(oB.ganancia_unitaria_gestor) * 2
                        ]
                    );

                    const oC = ofs2[2] || ofs2[0]; // Castaña de Cajú 250g
                    const envG2 = Number(n2.cargo_envio_barrial || 1200);
                    const subV2 = Number(oC.precio_venta_vecino) * 2;
                    const subB2 = Number(oC.precio_base_nodo_snapshot) * 2;
                    const totV2 = subV2 + envG2;
                    const ganV2 = (subV2 - subB2) + envG2;

                    const pG2 = await client.query(
                        `INSERT INTO public.nodos_pedidos_vecinos (
                            codigo_pedido, nodo_id, vecino_id, vecino_nombre, vecino_telefono,
                            modalidad_entrega, direccion_entrega, entrecalles_referencia, fecha_entrega_comprometida, fecha_entrega_label, ventana_horaria_label,
                            medio_pago, estado_pago, estado_operativo, ubicacion_deposito, etiqueta_impresa,
                            subtotal_productos_vecino, cargo_envio_barrial, total_vecino, total_base_lamda, ganancia_total_gestor
                         ) VALUES ($1,$2,$3,'Federico Quiroga','221-498-7721','ENVIO_BARRIAL','Calle 495 N° 1650','e/ 11 y 12 - Gonnet',$4,$5,'17:00 a 20:00 hs','EFECTIVO','COBRAR_EN_ENTREGA','ARMADO_EN_CANASTO','ESTACION_NODOS',true,$6,$7,$8,$9,$10)
                         RETURNING id`,
                        ['NB-1046', n2.id, vG2.rows[0].id, fechaMiercolesIso, labelMiercolesUnificado, subV2, envG2, totV2, subB2, ganV2]
                    );
                    await client.query(
                        `INSERT INTO public.nodos_pedidos_items (
                            pedido_id, articulo_catalogo_id, sku_nodo, nombre_publico, presentacion_etiqueta,
                            cantidad, precio_unitario_vecino, precio_unitario_base_lamda, subtotal_vecino, subtotal_base_lamda, ganancia_item_gestor
                         ) VALUES ($1,$2,$3,$4,$5,2,$6,$7,$8,$9,$10)`,
                        [
                            pG2.rows[0].id,
                            oC.articulo_catalogo_id, oC.sku_nodo, oC.nombre_publico, oC.presentacion_etiqueta,
                            oC.precio_venta_vecino, oC.precio_base_nodo_snapshot, subV2, subB2, Number(oC.ganancia_unitaria_gestor) * 2
                        ]
                    );
                }
            }
        }

        // ------------------------------------------------------------------------------------
        // ARQUITECTURA UNIFICADA BÚNKER <-> NODOS BARRIALES (Familias Reales, Listas y Políticas)
        // ------------------------------------------------------------------------------------
        await client.query(`
            ALTER TABLE public.bunker_listas_precios
                ADD COLUMN IF NOT EXISTS canal_comercial VARCHAR(30) DEFAULT 'MAYORISTA';

            UPDATE public.bunker_listas_precios
               SET canal_comercial = 'MAYORISTA'
             WHERE canal_comercial IS NULL;

            ALTER TABLE public.nodos_maestro
                ADD COLUMN IF NOT EXISTS lista_precio_bunker_id INTEGER REFERENCES public.bunker_listas_precios(id) ON DELETE SET NULL;

            ALTER TABLE public.nodos_articulos_catalogo
                ADD COLUMN IF NOT EXISTS nomenclatura_bunker VARCHAR(220),
                ADD COLUMN IF NOT EXISTS familia_bunker_id INTEGER,
                ADD COLUMN IF NOT EXISTS familia_bunker_nombre VARCHAR(100),
                ADD COLUMN IF NOT EXISTS articulo_principal_bunker VARCHAR(120),
                ADD COLUMN IF NOT EXISTS compartido_mayorista BOOLEAN DEFAULT false,
                ADD COLUMN IF NOT EXISTS listas_mayoristas_compartidas JSONB DEFAULT '[]'::jsonb;
        `);

        // Asegurar Lista Oficial de Precios para Nodos Barriales en bunker_listas_precios
        let listaNodosId = null;
        const checkListaNodos = await client.query(
            `SELECT id FROM public.bunker_listas_precios
             WHERE canal_comercial = 'NODOS' OR LOWER(nombre) LIKE '%nodos barriales%'
             ORDER BY id ASC LIMIT 1`
        );
        if (checkListaNodos.rows.length > 0) {
            listaNodosId = checkListaNodos.rows[0].id;
            await client.query(
                `UPDATE public.bunker_listas_precios
                 SET canal_comercial = 'NODOS',
                     updated_at = NOW()
                 WHERE id = $1
                   AND COALESCE(canal_comercial, '') <> 'NODOS'`,
                [listaNodosId]
            );
        } else {
            const insListaNodos = await client.query(
                `INSERT INTO public.bunker_listas_precios (
                    nombre, descripcion, activa, canal_comercial,
                    salvavidas_habilitado, salvavidas_tasa_tem, salvavidas_dias_gracia,
                    salvavidas_dias_estandar, salvavidas_dias_cortesia
                 ) VALUES (
                    'Lista Base Nodos Barriales',
                    'Lista oficial de transferencia LAMDA -> Gestor de Nodo Barrial. Incluye servicio de financiación de canasto en Cta. Cte. hasta liquidación de lote.',
                    true, 'NODOS', true, 6.50, 5, 7, 2
                 ) RETURNING id`
            );
            listaNodosId = insListaNodos.rows[0].id;
        }

        // Vincular cada Nodo con la Lista Base Nodos Barriales en nodos_maestro y bunker_cliente_listas_precios
        if (listaNodosId) {
            await client.query(
                `UPDATE public.nodos_maestro
                 SET lista_precio_bunker_id = $1
                 WHERE lista_precio_bunker_id IS NULL OR lista_precio_bunker_id <> $1`,
                [listaNodosId]
            );

            const nodosConBc = await client.query(
                `SELECT id, bunker_cliente_id FROM public.nodos_maestro WHERE bunker_cliente_id IS NOT NULL`
            );
            for (const nr of nodosConBc.rows) {
                const checkClp = await client.query(
                    `SELECT id FROM public.bunker_cliente_listas_precios
                     WHERE bunker_cliente_id = $1 AND bunker_lista_precio_id = $2 LIMIT 1`,
                    [nr.bunker_cliente_id, listaNodosId]
                );
                if (checkClp.rows.length === 0) {
                    await client.query(
                        `INSERT INTO public.bunker_cliente_listas_precios (bunker_cliente_id, bunker_lista_precio_id)
                         VALUES ($1, $2)`,
                        [nr.bunker_cliente_id, listaNodosId]
                    );
                }
            }

            // Sembrar Políticas de Precio y Financiación de Nodos en bunker_politicas_descuento
            const politicasNodos = [
                {
                    nombre: 'Bonificación Volumen Canasto Nodo (5%)',
                    descripcion: 'Bonifica 5% sobre el valor base del Canasto cuando el lote consolidado del Nodo supera $120.000 y tiene el lote anterior saldado.',
                    exige_saldo_cero: true,
                    tolerancia_saldo: 1000.00,
                    no_acumulable: true,
                    monto_minimo: 120000,
                    descuento_porcentaje: 5.00,
                    etiqueta: 'Canasto Consolidado >= $120.000'
                },
                {
                    nombre: 'Financiación Ciclo Canasto en Cta. Cte. (0% hasta Rendición)',
                    descripcion: 'Servicio financiero LAMDA incluido en el margen base: entrega del canasto en consignación/Cta. Cte. con 0% de recargo durante la ventana de reparto barrial (5 días), aplicando TEM Salvavidas solo ante mora.',
                    exige_saldo_cero: true,
                    tolerancia_saldo: 1000.00,
                    no_acumulable: false,
                    monto_minimo: 0,
                    descuento_porcentaje: 0.00,
                    etiqueta: 'Ciclo Canasto 5 días (0% interés)'
                }
            ];

            for (const pol of politicasNodos) {
                const checkPol = await client.query(
                    `SELECT id FROM public.bunker_politicas_descuento WHERE nombre = $1 LIMIT 1`,
                    [pol.nombre]
                );
                let polId;
                if (checkPol.rows.length > 0) {
                    polId = checkPol.rows[0].id;
                    await client.query(
                        `UPDATE public.bunker_politicas_descuento
                         SET bunker_lista_precio_id = $1, updated_at = NOW()
                         WHERE id = $2 AND bunker_lista_precio_id IS NULL`,
                        [listaNodosId, polId]
                    );
                } else {
                    const insPol = await client.query(
                        `INSERT INTO public.bunker_politicas_descuento (
                            nombre, descripcion, bunker_lista_precio_id, activo,
                            tipo_calculo, aplica_sobre, exige_saldo_cero, tolerancia_saldo, no_acumulable, aplica_a_todas
                         ) VALUES ($1, $2, $3, true, 'ESCALA_DIRECTA', 'NETO', $4, $5, $6, false)
                         RETURNING id`,
                        [pol.nombre, pol.descripcion, listaNodosId, pol.exige_saldo_cero, pol.tolerancia_saldo, pol.no_acumulable]
                    );
                    polId = insPol.rows[0].id;
                }

                const checkPl = await client.query(
                    `SELECT id FROM public.bunker_politica_listas WHERE politica_id = $1 AND bunker_lista_precio_id = $2 LIMIT 1`,
                    [polId, listaNodosId]
                );
                if (checkPl.rows.length === 0) {
                    await client.query(
                        `INSERT INTO public.bunker_politica_listas (politica_id, bunker_lista_precio_id) VALUES ($1, $2)`,
                        [polId, listaNodosId]
                    );
                }

                const checkTramo = await client.query(
                    `SELECT id FROM public.bunker_politica_descuento_tramos WHERE politica_id = $1 LIMIT 1`,
                    [polId]
                );
                if (checkTramo.rows.length === 0) {
                    await client.query(
                        `INSERT INTO public.bunker_politica_descuento_tramos (
                            politica_id, monto_minimo, monto_maximo, descuento_porcentaje, etiqueta, orden
                         ) VALUES ($1, $2, NULL, $3, $4, 1)`,
                        [polId, pol.monto_minimo, pol.descuento_porcentaje, pol.etiqueta]
                    );
                }
            }
        }

        // 1) Normalizar determinísticamente propuestas de fracciones hacia sus ingredientes simples puente
        const propRes = await client.query(`SELECT id, ingrediente_sugerido_id, segundos_estimados, codigo_propuesta FROM public.nodos_propuestas_fracciones`);
        for (const pr of propRes.rows) {
            if (pr.ingrediente_sugerido_id) {
                const ingSimp = await resolverIngredienteComercialDeterminista(client, pr.ingrediente_sugerido_id);
                const segTarget = pr.codigo_propuesta === 'PROP-NB-003' ? 45 : Number(pr.segundos_estimados || 35);
                if (ingSimp.id && (Number(ingSimp.id) !== Number(pr.ingrediente_sugerido_id) || segTarget !== Number(pr.segundos_estimados))) {
                    await client.query(
                        `UPDATE public.nodos_propuestas_fracciones
                         SET ingrediente_sugerido_id = $1, segundos_estimados = $2, updated_at = NOW()
                         WHERE id = $3`,
                        [ingSimp.id, segTarget, pr.id]
                    );
                }
            }
        }

        // 2) Normalizar artículos existentes del catálogo con su Anatomía Nativa LAMDA (SKUs sin NB-, Familias, Posiciones pos_1..pos_5, Ingredientes Simples Puente y Recetas)
        const env181Res = await client.query(`SELECT COALESCE(costo_patron, 18.16) AS costo FROM public.ingredientes WHERE id = 181 LIMIT 1`);
        const costoFlowpack181 = Number(env181Res.rows[0]?.costo || 18.16);

        const catExistentes = await client.query(`
            SELECT nac.*,
                   COALESCE(ing.costo_patron, nac.costo_insumo_kg) AS ing_costo_db,
                   COALESCE(env.costo_patron, nac.costo_envase_aplicado) AS env_costo_db,
                   COALESCE(ct.valor_hora, nac.valor_hora_aplicado) AS tarifa_hora_db
            FROM public.nodos_articulos_catalogo nac
            LEFT JOIN public.ingredientes ing ON ing.id = nac.ingrediente_origen_id
            LEFT JOIN public.ingredientes env ON env.id = nac.insumo_envase_id
            LEFT JOIN public.colaboradores_tarifas ct ON ct.id = nac.tarifa_colaborador_id
            ORDER BY nac.id ASC
        `);

        for (const row of catExistentes.rows) {
            const skuOriginal = String(row.sku_nodo || '').trim();
            const anatomia = await resolverAnatomiaNativaArticuloNodo(client, row);
            const skuNativo = String(anatomia.sku_nativo || skuOriginal).trim();
            if (!skuNativo) continue;

            // Si el SKU cambió y ya existía otra fila con el SKU nativo, unificar y deduplicar
            if (skuOriginal.toUpperCase() !== skuNativo.toUpperCase()) {
                const dupCheck = await client.query(
                    `SELECT id FROM public.nodos_articulos_catalogo WHERE UPPER(sku_nodo) = UPPER($1) AND id <> $2 LIMIT 1`,
                    [skuNativo, row.id]
                );
                if (dupCheck.rows.length > 0) {
                    const keepId = dupCheck.rows[0].id;
                    await client.query(`UPDATE public.nodos_pedidos_items SET articulo_catalogo_id = $1, sku_nodo = $2 WHERE articulo_catalogo_id = $3`, [keepId, skuNativo, row.id]);
                    await client.query(`UPDATE public.nodos_propuestas_fracciones SET articulo_catalogo_id = $1 WHERE articulo_catalogo_id = $2`, [keepId, row.id]);
                    await client.query(`DELETE FROM public.nodos_ofertas_gestor WHERE articulo_catalogo_id = $1`, [row.id]);
                    await client.query(`DELETE FROM public.nodos_articulos_catalogo WHERE id = $1`, [row.id]);
                    continue;
                }
            }

            const esGranolaExistente = ['GSX500G', 'GDFX500G'].includes(skuNativo.toUpperCase());
            const esBarritaPack6 = skuNativo.toUpperCase() === 'BF6X50' || Number(anatomia.ingrediente_comercial_id) === 141;
            const esMixtoSemilla = esGranolaExistente || skuNativo.toUpperCase() === 'BF6X50';
            const listasCompActuales = Array.isArray(row.listas_mayoristas_compartidas)
                ? row.listas_mayoristas_compartidas.map(Number).filter(Boolean)
                : [];

            let listasMayoristasTarget = listasCompActuales;
            let compartidoTarget = Boolean(row.compartido_mayorista);
            if (esGranolaExistente && listasMayoristasTarget.length <= 2) {
                listasMayoristasTarget = [1, 2, 3, 5, 6, 7];
                compartidoTarget = true;
            } else if (esMixtoSemilla && listasMayoristasTarget.length === 0) {
                listasMayoristasTarget = [5, 6];
                compartidoTarget = true;
            }

            const nomenclaturaOficial = String(anatomia.nomenclatura_bunker || row.nomenclatura_bunker || row.nombre_publico || skuNativo).trim();
            const familiaIdOficial = Number(anatomia.familia_id || row.familia_bunker_id || 1);
            const familiaNombreOficial = String(anatomia.familia_nombre || row.familia_bunker_nombre || row.categoria_familiar || 'Frutos Secos').trim();
            const artPrincipalOficial = String(anatomia.articulo_principal || row.articulo_principal_bunker || nomenclaturaOficial).trim();
            const presentacionEtiquetaOficial = String(anatomia.presentacion_etiqueta || row.presentacion_etiqueta || '').trim();
            const ingComercialFinal = anatomia.ingrediente_comercial_id || row.ingrediente_origen_id || null;

            const costoEnvaseUnitarioReal = Number(row.env_costo_db || 45.96);
            const costoEnvaseExtra = esBarritaPack6
                ? Number((Number(anatomia.pack_unidades || 6) * costoFlowpack181).toFixed(2))
                : 0;
            const segundosFinales = esGranolaExistente
                ? Number(anatomia.segundos_nativos || 45)
                : Number(row.segundos_fraccionamiento || 35);

            const calc = calcularEstructuraCostosNodo({
                costo_insumo_kg: Number(anatomia.ingrediente_comercial_costo_kg || row.ing_costo_db || row.costo_insumo_kg),
                kilos_unidad: Number(row.kilos_unidad || 0.25),
                costo_envase_unitario: costoEnvaseUnitarioReal,
                cantidad_envases_unidad: Number(row.cantidad_envases_unidad || 1),
                costo_envase_extra: costoEnvaseExtra,
                segundos_fraccionamiento: segundosFinales,
                valor_hora_aplicado: Number(row.tarifa_hora_db || row.valor_hora_aplicado || 7000),
                margen_lamda_pct: Number(row.margen_lamda_pct || 22),
                iva_pct: Number(row.iva_pct || 21),
                iibb_pct: 4.0,
                margen_sugerido_gestor_pct: Number(row.margen_sugerido_gestor_pct || 28)
            });

            await client.query(
                `UPDATE public.nodos_articulos_catalogo SET
                    sku_nodo = $1,
                    ingrediente_origen_id = $2,
                    articulo_bunker_origen_codigo = $3,
                    segundos_fraccionamiento = $4,
                    nombre_publico = $5,
                    categoria_familiar = $6,
                    presentacion_etiqueta = $7,
                    nomenclatura_bunker = $8,
                    familia_bunker_id = $9,
                    familia_bunker_nombre = $10,
                    articulo_principal_bunker = $11,
                    compartido_mayorista = $12,
                    listas_mayoristas_compartidas = $13,
                    costo_insumo_kg = $14,
                    costo_insumo_fraccion = $15,
                    costo_envase_aplicado = $16,
                    valor_hora_aplicado = $17,
                    costo_mano_obra_aplicado = $18,
                    iibb_pct = $19,
                    costo_puro_total = $20,
                    precio_base_nodo_neto = $21,
                    precio_base_nodo_final = $22,
                    precio_sugerido_vecino = $23,
                    updated_at = NOW()
                 WHERE id = $24`,
                [
                    skuNativo,
                    ingComercialFinal,
                    skuNativo,
                    calc.segundos_fraccionamiento,
                    nomenclaturaOficial,
                    familiaNombreOficial,
                    presentacionEtiquetaOficial,
                    nomenclaturaOficial,
                    familiaIdOficial,
                    familiaNombreOficial,
                    artPrincipalOficial,
                    compartidoTarget,
                    JSON.stringify(listasMayoristasTarget),
                    calc.costo_insumo_kg,
                    calc.costo_insumo_fraccion,
                    calc.costo_envase_aplicado,
                    calc.valor_hora_aplicado,
                    calc.costo_mano_obra_aplicado,
                    calc.iibb_pct,
                    calc.costo_puro_total,
                    calc.precio_base_nodo_neto,
                    calc.precio_base_nodo_final,
                    calc.precio_sugerido_vecino,
                    row.id
                ]
            );

            await client.query(
                `UPDATE public.nodos_ofertas_gestor SET
                    precio_base_nodo_snapshot = $1,
                    precio_venta_vecino = CASE
                        WHEN COALESCE(precio_venta_vecino, 0) > 0 THEN precio_venta_vecino
                        ELSE ROUND($1 * (1 + margen_gestor_pct / 100.0))
                    END,
                    updated_at = NOW()
                 WHERE articulo_catalogo_id = $2`,
                [calc.precio_base_nodo_final, row.id]
            );

            // Actualizar SKU y nomenclatura técnica oficial en nodos_pedidos_items preservando el alias histórico de vidriera para el comprobante B2C del vecino
            await client.query(
                `UPDATE public.nodos_pedidos_items SET
                    nombre_vidriera_vecino = COALESCE(NULLIF(TRIM(nombre_vidriera_vecino), ''), NULLIF(TRIM(nombre_publico), '')),
                    sku_nodo = $1,
                    nombre_publico = $2,
                    presentacion_etiqueta = $3
                 WHERE articulo_catalogo_id = $4 OR UPPER(sku_nodo) = UPPER($5)`,
                [skuNativo, nomenclaturaOficial, presentacionEtiquetaOficial, row.id, skuOriginal]
            );
            if (skuOriginal.toUpperCase() !== skuNativo.toUpperCase()) {
                await client.query(
                    `UPDATE public.presupuestos_detalles SET articulo = $1 WHERE UPPER(articulo) = UPPER($2)`,
                    [skuNativo, skuOriginal]
                );
            }
        }

        // 3) Limpiar cualquier rastro de códigos antiguos NB-* o temporales en tablas operativas y del Búnker
        await client.query(`
            DELETE FROM public.bunker_lista_insumos
            WHERE lista_articulo_id IN (
                SELECT id FROM public.bunker_lista_articulos WHERE UPPER(articulo_numero) LIKE 'NB-%' OR UPPER(articulo_numero) = 'CCTX250G'
            );
            DELETE FROM public.bunker_lista_articulos WHERE UPPER(articulo_numero) LIKE 'NB-%' OR UPPER(articulo_numero) = 'CCTX250G';
            DELETE FROM public.receta_ingredientes
            WHERE receta_id IN (
                SELECT id FROM public.recetas WHERE UPPER(articulo_numero) LIKE 'NB-%' OR UPPER(articulo_numero) = 'CCTX250G'
            );
            DELETE FROM public.recetas WHERE UPPER(articulo_numero) LIKE 'NB-%' OR UPPER(articulo_numero) = 'CCTX250G';
            DELETE FROM public.stock_real_consolidado WHERE UPPER(articulo_numero) LIKE 'NB-%' OR UPPER(codigo_barras) LIKE 'NB-%' OR UPPER(articulo_numero) = 'CCTX250G';
            DELETE FROM public.bunker_articulos WHERE UPPER(articulo_id) LIKE 'NB-%' OR UPPER(codigo_barras) LIKE 'NB-%' OR UPPER(articulo_id) = 'CCTX250G';
            DELETE FROM public.articulos WHERE UPPER(numero) LIKE 'NB-%' OR UPPER(codigo_barras) LIKE 'NB-%' OR UPPER(numero) = 'CCTX250G';
        `);

        // 4) Limpiar únicamente residuos obsoletos NB-% / CCTX250G en Lista Base Nodos Barriales (preservando altas hechas desde el Búnker)
        if (listaNodosId) {
            await client.query(
                `DELETE FROM public.bunker_lista_insumos
                 WHERE lista_articulo_id IN (
                     SELECT la.id
                     FROM public.bunker_lista_articulos la
                     WHERE la.lista_id = $1
                       AND (UPPER(la.articulo_numero) LIKE 'NB-%' OR UPPER(la.articulo_numero) = 'CCTX250G')
                 )`,
                [listaNodosId]
            );
            await client.query(
                `DELETE FROM public.bunker_lista_articulos
                 WHERE lista_id = $1
                   AND (UPPER(articulo_numero) LIKE 'NB-%' OR UPPER(articulo_numero) = 'CCTX250G')`,
                [listaNodosId]
            );
        }

        // ------------------------------------------------------------------------------------
        // ETAPA A: ÁRBOL DE CLIENTES DEL NODO, IDENTIDAD ÚNICA Y SUBCUENTAS DETERMINISTAS
        // ------------------------------------------------------------------------------------
        await client.query(`
            ALTER TABLE public.nodos_vecinos
                ADD COLUMN IF NOT EXISTS codigo_vecino VARCHAR(40),
                ADD COLUMN IF NOT EXISTS telefono_normalizado VARCHAR(30),
                ADD COLUMN IF NOT EXISTS saldo_actual NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true,
                ADD COLUMN IF NOT EXISTS portal_token VARCHAR(80);

            CREATE UNIQUE INDEX IF NOT EXISTS unq_nodos_vecinos_portal_token
                ON public.nodos_vecinos (portal_token)
                WHERE portal_token IS NOT NULL;

            ALTER TABLE public.nodos_pedidos_vecinos
                ADD COLUMN IF NOT EXISTS monto_ajuste_credito NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS motivo_anulacion_ajuste TEXT,
                ADD COLUMN IF NOT EXISTS fecha_anulacion TIMESTAMPTZ;

            ALTER TABLE public.nodos_liquidaciones_lote
                ADD COLUMN IF NOT EXISTS modalidad_cierre VARCHAR(40) NOT NULL DEFAULT 'RENDICION_DIRECTA_NODO';

            CREATE TABLE IF NOT EXISTS public.nodos_vecinos_movimientos_cc (
                id SERIAL PRIMARY KEY,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                vecino_id INTEGER NOT NULL REFERENCES public.nodos_vecinos(id) ON DELETE CASCADE,
                pedido_vecino_id INTEGER REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE SET NULL,
                lote_canasto_id INTEGER REFERENCES public.nodos_lotes_estacion(id) ON DELETE SET NULL,
                tipo_movimiento VARCHAR(50) NOT NULL,
                naturaleza VARCHAR(12) NOT NULL CHECK (naturaleza IN ('DEBITO', 'CREDITO')),
                monto NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                saldo_resultante NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                medio_pago VARCHAR(40),
                concepto TEXT NOT NULL,
                referencia_externa VARCHAR(120),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_nodos_vecinos_movs_vecino_id
                ON public.nodos_vecinos_movimientos_cc (vecino_id, id);
            CREATE INDEX IF NOT EXISTS idx_nodos_vecinos_movs_pedido_id
                ON public.nodos_vecinos_movimientos_cc (pedido_vecino_id);
        `);

        // 1) Normalizar teléfonos y deduplicar canónicamente por (nodo_id, telefono_normalizado)
        const allVecRes = await client.query(
            'SELECT id, nodo_id, nombre_completo, telefono_whatsapp, telefono_normalizado, codigo_vecino, portal_token FROM public.nodos_vecinos ORDER BY id ASC'
        );
        const vistosPorNodoTel = new Map();
        for (const v of allVecRes.rows) {
            let telNorm = normalizarTelefonoVecinoNodo(v.telefono_normalizado || v.telefono_whatsapp);
            if (!telNorm) {
                telNorm = `SIN-TEL-${v.id}`;
            }
            const clave = `${v.nodo_id}::${telNorm}`;
            if (!vistosPorNodoTel.has(clave)) {
                vistosPorNodoTel.set(clave, v.id);
                const codVec = v.codigo_vecino || formatearCodigoVecinoNodo(v.nodo_id, v.id);
                const portalTok = (v.portal_token && String(v.portal_token).trim().length >= 16)
                    ? String(v.portal_token).trim()
                    : generarPortalTokenVecinoNodo();
                await client.query(
                    `UPDATE public.nodos_vecinos
                     SET telefono_normalizado = $1,
                         codigo_vecino = $2,
                         portal_token = $3
                     WHERE id = $4`,
                    [telNorm, codVec, portalTok, v.id]
                );
            } else {
                const canonicoId = vistosPorNodoTel.get(clave);
                await client.query('UPDATE public.nodos_pedidos_vecinos SET vecino_id = $1 WHERE vecino_id = $2', [canonicoId, v.id]);
                await client.query('UPDATE public.nodos_alias_vecinos_aprendidos SET vecino_id = $1 WHERE vecino_id = $2', [canonicoId, v.id]);
                await client.query('UPDATE public.nodos_vecinos_movimientos_cc SET vecino_id = $1 WHERE vecino_id = $2', [canonicoId, v.id]);
                await client.query('DELETE FROM public.nodos_vecinos WHERE id = $1', [v.id]);
            }
        }

        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS unq_nodos_vecinos_nodo_tel
                ON public.nodos_vecinos (nodo_id, telefono_normalizado)
        `);

        // 2) Vincular cualquier pedido huérfano por teléfono normalizado y sembrar movimientos históricos idempotentes
        const pedsBackfillRes = await client.query(
            `SELECT id, codigo_pedido, nodo_id, vecino_id, vecino_nombre, vecino_telefono,
                    direccion_entrega, entrecalles_referencia, lote_canasto_id,
                    medio_pago, estado_pago, estado_operativo,
                    total_vecino, monto_ajuste_credito, impactado_cta_cte_pago,
                    comprobante_referencia, created_at
             FROM public.nodos_pedidos_vecinos
             ORDER BY id ASC`
        );
        const vecinosRecalcularSet = new Set();

        for (const p of pedsBackfillRes.rows) {
            let vid = p.vecino_id ? Number(p.vecino_id) : null;
            const telNormPed = normalizarTelefonoVecinoNodo(p.vecino_telefono) || `SIN-TEL-PED-${p.id}`;
            if (!vid) {
                const exVecBack = await client.query(
                    `SELECT id, codigo_vecino FROM public.nodos_vecinos
                     WHERE nodo_id = $1 AND telefono_normalizado = $2
                     LIMIT 1 FOR UPDATE`,
                    [p.nodo_id, telNormPed]
                );
                let vecRowBack;
                if (exVecBack.rows.length > 0) {
                    const updVecBack = await client.query(
                        `UPDATE public.nodos_vecinos SET updated_at = NOW() WHERE id = $1 RETURNING id, codigo_vecino`,
                        [exVecBack.rows[0].id]
                    );
                    vecRowBack = updVecBack.rows[0];
                } else {
                    const insVecBack = await client.query(
                        `INSERT INTO public.nodos_vecinos (
                            nodo_id, nombre_completo, telefono_whatsapp, telefono_normalizado, direccion_calle, entrecalles_referencia
                         ) VALUES ($1, $2, $3, $4, $5, $6)
                         RETURNING id, codigo_vecino`,
                        [p.nodo_id, p.vecino_nombre, p.vecino_telefono, telNormPed, p.direccion_entrega || '', p.entrecalles_referencia || '']
                    );
                    vecRowBack = insVecBack.rows[0];
                }
                vid = Number(vecRowBack.id);
                if (!vecRowBack.codigo_vecino) {
                    await client.query(
                        'UPDATE public.nodos_vecinos SET codigo_vecino = $1 WHERE id = $2',
                        [formatearCodigoVecinoNodo(p.nodo_id, vid), vid]
                    );
                }
                await client.query('UPDATE public.nodos_pedidos_vecinos SET vecino_id = $1 WHERE id = $2', [vid, p.id]);
            }

            const exMovsPed = await client.query(
                'SELECT tipo_movimiento FROM public.nodos_vecinos_movimientos_cc WHERE pedido_vecino_id = $1',
                [p.id]
            );
            const tiposExistentes = new Set(exMovsPed.rows.map(r => r.tipo_movimiento));
            const montoAjuste = Number(p.monto_ajuste_credito || 0);
            const montoVigente = Number(p.total_vecino || 0);
            const montoOriginal = Number((montoVigente + montoAjuste).toFixed(2));

            if (!tiposExistentes.has('DEBITO_PEDIDO') && montoOriginal > 0) {
                await client.query(
                    `INSERT INTO public.nodos_vecinos_movimientos_cc (
                        nodo_id, vecino_id, pedido_vecino_id, lote_canasto_id,
                        tipo_movimiento, naturaleza, monto, saldo_resultante,
                        medio_pago, concepto, referencia_externa, created_at
                     ) VALUES ($1, $2, $3, $4, 'DEBITO_PEDIDO', 'DEBITO', $5, 0, $6, $7, $8, COALESCE($9, NOW()))`,
                    [
                        p.nodo_id,
                        vid,
                        p.id,
                        p.lote_canasto_id || null,
                        montoOriginal,
                        p.medio_pago || 'TRANSFERENCIA',
                        `Compra Pedido #${p.codigo_pedido}`,
                        p.codigo_pedido,
                        p.created_at
                    ]
                );
                vecinosRecalcularSet.add(vid);
            }

            if (montoAjuste > 0 && !tiposExistentes.has('CREDITO_NOTA_CREDITO')) {
                await client.query(
                    `INSERT INTO public.nodos_vecinos_movimientos_cc (
                        nodo_id, vecino_id, pedido_vecino_id, lote_canasto_id,
                        tipo_movimiento, naturaleza, monto, saldo_resultante,
                        medio_pago, concepto, referencia_externa
                     ) VALUES ($1, $2, $3, $4, 'CREDITO_NOTA_CREDITO', 'CREDITO', $5, 0, $6, $7, $8)`,
                    [
                        p.nodo_id,
                        vid,
                        p.id,
                        p.lote_canasto_id || null,
                        montoAjuste,
                        p.medio_pago || 'TRANSFERENCIA',
                        `Nota de Crédito Pedido #${p.codigo_pedido}`,
                        p.codigo_pedido
                    ]
                );
                vecinosRecalcularSet.add(vid);
            }

            const pagoConf = Boolean(p.impactado_cta_cte_pago) ||
                ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(p.estado_pago || '').toUpperCase());
            if (pagoConf && String(p.estado_operativo || '').toUpperCase() !== 'ANULADO' &&
                !tiposExistentes.has('CREDITO_TRANSFERENCIA_LAMDA') && !tiposExistentes.has('CREDITO_EFECTIVO_GESTOR')) {
                const esEfvo = String(p.medio_pago || '').toUpperCase() === 'EFECTIVO' ||
                    String(p.estado_pago || '').toUpperCase() === 'COBRADO_EFECTIVO_GESTOR';
                const tipoPagoMov = esEfvo ? 'CREDITO_EFECTIVO_GESTOR' : 'CREDITO_TRANSFERENCIA_LAMDA';
                await client.query(
                    `INSERT INTO public.nodos_vecinos_movimientos_cc (
                        nodo_id, vecino_id, pedido_vecino_id, lote_canasto_id,
                        tipo_movimiento, naturaleza, monto, saldo_resultante,
                        medio_pago, concepto, referencia_externa
                     ) VALUES ($1, $2, $3, $4, $5, 'CREDITO', $6, 0, $7, $8, $9)`,
                    [
                        p.nodo_id,
                        vid,
                        p.id,
                        p.lote_canasto_id || null,
                        tipoPagoMov,
                        montoVigente,
                        esEfvo ? 'EFECTIVO' : 'TRANSFERENCIA',
                        esEfvo
                            ? `Pago en Efectivo al Gestor — Pedido #${p.codigo_pedido}`
                            : `Pago por Transferencia conciliado — Pedido #${p.codigo_pedido}`,
                        p.comprobante_referencia || p.codigo_pedido
                    ]
                );
                vecinosRecalcularSet.add(vid);
            }

            if (String(p.estado_operativo || '').toUpperCase() === 'ANULADO' && !tiposExistentes.has('CREDITO_ANULACION_PEDIDO')) {
                await client.query(
                    `INSERT INTO public.nodos_vecinos_movimientos_cc (
                        nodo_id, vecino_id, pedido_vecino_id, lote_canasto_id,
                        tipo_movimiento, naturaleza, monto, saldo_resultante,
                        medio_pago, concepto, referencia_externa
                     ) VALUES ($1, $2, $3, $4, 'CREDITO_ANULACION_PEDIDO', 'CREDITO', $5, 0, $6, $7, $8)`,
                    [
                        p.nodo_id,
                        vid,
                        p.id,
                        p.lote_canasto_id || null,
                        montoVigente,
                        p.medio_pago || 'TRANSFERENCIA',
                        `Anulación Pedido #${p.codigo_pedido}`,
                        p.codigo_pedido
                    ]
                );
                vecinosRecalcularSet.add(vid);
            }
        }

        const vecsFinalRes = await client.query('SELECT id FROM public.nodos_vecinos ORDER BY id ASC');
        for (const vr of vecsFinalRes.rows) {
            await recalcularSaldoSubcuentaVecino(client, vr.id);
        }

        // 3) Alinear signos históricos en nodos_movimientos_cta_cte y recalcular Cuentas Corrientes CB-NODO-% con ley única (DEBITO +, CREDITO -)
        await client.query(`
            UPDATE public.nodos_movimientos_cta_cte
               SET signo = 1
             WHERE tipo_movimiento = 'DEBITO_RETIRO_LOTE' AND signo <> 1;

            UPDATE public.nodos_movimientos_cta_cte
               SET signo = -1
             WHERE tipo_movimiento = 'CREDITO_TRANSFERENCIA_VECINO' AND signo <> -1;
        `);

        const ccsNodoRes = await client.query(
            `SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente LIKE 'CB-NODO-%' ORDER BY id ASC`
        );
        for (const rowCc of ccsNodoRes.rows) {
            await recalcularSaldosCuentaMadreBunker(client, rowCc.id);
        }

        // 4) Sincronizar herencia fiscal, contactos y domicilio desde Cliente Madre (CB-0006 -> CB-NODO-001 y futuros Nodos)
        const nodosHerenciaRes = await client.query(
            `SELECT id, nombre_marca, gestor_nombre, gestor_telefono, gestor_email, direccion_retiro, barrio_zona,
                    bunker_cliente_id, cliente_madre_bunker_id
             FROM public.nodos_maestro
             WHERE bunker_cliente_id IS NOT NULL
             ORDER BY id ASC`
        );
        for (const nRow of nodosHerenciaRes.rows) {
            await sincronizarHerenciaFiscalYContactosDesdeMadre(client, nRow.bunker_cliente_id, nRow.cliente_madre_bunker_id, nRow);
        }

        // 4.b) Etapa B2: Capacidades modulares de entrega por Nodo (Retiro / Reparto Propio / Encomienda)
        const colRepartoRes = await client.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'nodos_maestro'
               AND column_name = 'permitir_reparto_propio'
             LIMIT 1`
        );
        const yaTeniaColReparto = colRepartoRes.rows.length > 0;
        await client.query(`
            ALTER TABLE public.nodos_maestro
                ADD COLUMN IF NOT EXISTS permitir_retiro_nodo BOOLEAN NOT NULL DEFAULT true,
                ADD COLUMN IF NOT EXISTS permitir_reparto_propio BOOLEAN NOT NULL DEFAULT true,
                ADD COLUMN IF NOT EXISTS permitir_encomienda BOOLEAN NOT NULL DEFAULT false;
        `);
        if (!yaTeniaColReparto) {
            await client.query(`
                UPDATE public.nodos_maestro
                SET permitir_retiro_nodo = COALESCE(permitir_retiro_nodo, true),
                    permitir_reparto_propio = COALESCE(permitir_envio_barrial, true),
                    permitir_encomienda = COALESCE(permitir_encomienda, false)
            `);
        }

        // 5) Etapa B: Columnas de tracking criptográfico, hitos deterministas y bitácora inmutable nodos_pedidos_eventos_tracking
        await client.query(`
            ALTER TABLE public.nodos_pedidos_vecinos
                ADD COLUMN IF NOT EXISTS tracking_token VARCHAR(40),
                ADD COLUMN IF NOT EXISTS hito_tracking_actual SMALLINT DEFAULT 1,
                ADD COLUMN IF NOT EXISTS fecha_en_preparacion TIMESTAMP,
                ADD COLUMN IF NOT EXISTS fecha_en_camino_vecino TIMESTAMP,
                ADD COLUMN IF NOT EXISTS fecha_entregado_vecino TIMESTAMP;

            CREATE UNIQUE INDEX IF NOT EXISTS unq_nodos_pedidos_vecinos_tracking_token
                ON public.nodos_pedidos_vecinos (tracking_token)
                WHERE tracking_token IS NOT NULL;

            CREATE TABLE IF NOT EXISTS public.nodos_pedidos_eventos_tracking (
                id SERIAL PRIMARY KEY,
                pedido_id INT NOT NULL REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE CASCADE,
                nodo_id INT NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                hito_numero SMALLINT NOT NULL,
                estado_operativo VARCHAR(40) NOT NULL,
                origen_evento VARCHAR(50) DEFAULT 'SISTEMA',
                actor VARCHAR(120),
                detalle TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_nodos_eventos_tracking_pedido
                ON public.nodos_pedidos_eventos_tracking (pedido_id, hito_numero, id);

            -- 6) Etapas B4 y B5: Coordenadas de vecinos/pedidos, Hoja de Ruta, Ausente Pasa a Retirar y Radar en vivo
            ALTER TABLE public.nodos_vecinos
                ADD COLUMN IF NOT EXISTS latitud NUMERIC(10, 7),
                ADD COLUMN IF NOT EXISTS longitud NUMERIC(10, 7),
                ADD COLUMN IF NOT EXISTS gps_origen VARCHAR(30),
                ADD COLUMN IF NOT EXISTS gps_verificado_gestor BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS gps_updated_at TIMESTAMP;

            ALTER TABLE public.nodos_pedidos_vecinos
                ADD COLUMN IF NOT EXISTS latitud NUMERIC(10, 7),
                ADD COLUMN IF NOT EXISTS longitud NUMERIC(10, 7),
                ADD COLUMN IF NOT EXISTS gps_origen VARCHAR(30),
                ADD COLUMN IF NOT EXISTS orden_reparto INTEGER,
                ADD COLUMN IF NOT EXISTS ausente_pasa_retirar BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS fecha_ausente_reparto TIMESTAMP,
                ADD COLUMN IF NOT EXISTS motivo_ausencia TEXT,
                ADD COLUMN IF NOT EXISTS en_hoja_ruta BOOLEAN NOT NULL DEFAULT true,
                ADD COLUMN IF NOT EXISTS incluido_reparto_manual BOOLEAN NOT NULL DEFAULT false;

            CREATE INDEX IF NOT EXISTS idx_nodos_pedidos_reparto
                ON public.nodos_pedidos_vecinos (nodo_id, modalidad_entrega, hito_tracking_actual, orden_reparto, id);

            CREATE TABLE IF NOT EXISTS public.nodos_reparto_radar (
                id SERIAL PRIMARY KEY,
                nodo_id INT NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                activo BOOLEAN NOT NULL DEFAULT false,
                latitud NUMERIC(10, 7),
                longitud NUMERIC(10, 7),
                precision_metros INT,
                pedido_actual_id INT REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE SET NULL,
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unq_nodos_reparto_radar_nodo UNIQUE (nodo_id)
            );
        `);

        // Backfill determinista de tracking_token, hito real actual y eventos de auditoría para pedidos existentes (#NB-1001, #NB-1002, #NB-1003, etc.)
        const pedsTrackingRes = await client.query(
            `SELECT id, nodo_id, codigo_pedido, modalidad_entrega, estado_operativo, secuencia_operativa_lamda,
                    tracking_token, hito_tracking_actual, created_at,
                    fecha_en_preparacion, fecha_armado_bolsa, fecha_entrega_gestor,
                    fecha_en_camino_vecino, fecha_entregado_vecino
             FROM public.nodos_pedidos_vecinos
             ORDER BY id ASC`
        );
        for (const pt of pedsTrackingRes.rows) {
            const tok = (pt.tracking_token && String(pt.tracking_token).trim().length >= 16)
                ? String(pt.tracking_token).trim()
                : generarTrackingTokenPedidoNodo();
            const hitoReal = resolverHitoDesdeEstadoOperativo(pt.estado_operativo, pt.secuencia_operativa_lamda);
            const hitoEf = hitoReal === 0 ? Number(pt.hito_tracking_actual || 1) : Math.max(Number(pt.hito_tracking_actual || 1), hitoReal);

            const tsPrep = pt.fecha_en_preparacion || (hitoEf >= 2 ? (pt.fecha_armado_bolsa || pt.created_at) : null);
            const tsArm = pt.fecha_armado_bolsa || (hitoEf >= 3 ? pt.created_at : null);
            const tsGestor = pt.fecha_entrega_gestor || (hitoEf >= 4 ? (pt.fecha_armado_bolsa || pt.created_at) : null);
            const tsEntregado = pt.fecha_entregado_vecino || (hitoEf >= 6 ? (pt.fecha_entrega_gestor || pt.created_at) : null);

            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET tracking_token = $1,
                     hito_tracking_actual = $2,
                     fecha_en_preparacion = COALESCE(fecha_en_preparacion, $3),
                     fecha_armado_bolsa = COALESCE(fecha_armado_bolsa, $4),
                     fecha_entrega_gestor = COALESCE(fecha_entrega_gestor, $5),
                     fecha_entregado_vecino = COALESCE(fecha_entregado_vecino, $6)
                 WHERE id = $7`,
                [tok, hitoReal === 0 ? 0 : hitoEf, tsPrep, tsArm, tsGestor, tsEntregado, pt.id]
            );

            if (hitoReal > 0) {
                const evsExRes = await client.query(
                    'SELECT hito_numero FROM public.nodos_pedidos_eventos_tracking WHERE pedido_id = $1',
                    [pt.id]
                );
                const hitosRegistrados = new Set(evsExRes.rows.map(r => Number(r.hito_numero)));
                const esEnvio = String(pt.modalidad_entrega || '').toUpperCase() === 'ENVIO_BARRIAL';
                const secuenciaHitos = [1, 2, 3, 4, ...(esEnvio ? [5] : []), 6].filter(h => h <= hitoEf);
                for (const h of secuenciaHitos) {
                    if (hitosRegistrados.has(h)) continue;
                    const tsEvento = h === 1 ? pt.created_at
                        : (h === 2 ? (tsPrep || pt.created_at)
                        : (h === 3 ? (tsArm || pt.created_at)
                        : (h === 4 ? (tsGestor || pt.created_at)
                        : (h === 5 ? (pt.fecha_en_camino_vecino || tsGestor || pt.created_at)
                        : (tsEntregado || pt.created_at)))));
                    await client.query(
                        `INSERT INTO public.nodos_pedidos_eventos_tracking (
                            pedido_id, nodo_id, hito_numero, estado_operativo, origen_evento, actor, detalle, created_at
                         ) VALUES ($1, $2, $3, $4, 'BACKFILL_SINCRONIZADO', 'Sistema', $5, COALESCE($6, NOW()))`,
                        [
                            pt.id,
                            pt.nodo_id,
                            h,
                            MAPA_HITO_A_ESTADO[h],
                            `Sincronizado con estado operativo real de #${pt.codigo_pedido}`,
                            tsEvento
                        ]
                    );
                }
            }
        }

        // Normalizar propuestas de fracción existentes vinculadas a ingrediente_sugerido_id hacia nomenclatura oficial [codigo] nombre
        await client.query(`
            UPDATE public.nodos_propuestas_fracciones npf
            SET alias_vidriera_sugerido = COALESCE(
                    NULLIF(TRIM(npf.alias_vidriera_sugerido), ''),
                    CASE WHEN LEFT(TRIM(COALESCE(npf.nombre_sugerido, '')), 1) <> '[' THEN TRIM(npf.nombre_sugerido) ELSE NULL END
                ),
                nombre_sugerido = '[' || COALESCE(NULLIF(TRIM(ing.codigo::text), ''), '#' || ing.id::text) || '] ' || ing.nombre || ' x ' ||
                    CASE
                        WHEN COALESCE(npf.kilos_sugeridos, 0.25) >= 1 THEN TRIM(TO_CHAR(npf.kilos_sugeridos, 'FM9990.##')) || ' kg'
                        ELSE ROUND(COALESCE(npf.kilos_sugeridos, 0.25) * 1000)::text || 'g'
                    END,
                categoria_sugerida = COALESCE(ci.nombre, npf.categoria_sugerida)
            FROM public.ingredientes ing
            LEFT JOIN public.categorias_ingredientes ci ON ci.id = ing.categoria_id
            WHERE npf.ingrediente_sugerido_id = ing.id
              AND LEFT(TRIM(COALESCE(npf.nombre_sugerido, '')), 1) <> '[';
        `);

        // 7) Parametrización fiscal idempotente sobre el margen comercial del Nodo (IVA 21% + IIBB 4%)
        await client.query(`
            ALTER TABLE public.nodos_maestro
                ADD COLUMN IF NOT EXISTS alicuota_iva_margen_pct NUMERIC(5,2) NOT NULL DEFAULT 21.00,
                ADD COLUMN IF NOT EXISTS alicuota_iibb_margen_pct NUMERIC(5,2) NOT NULL DEFAULT 4.00;

            ALTER TABLE public.nodos_pedidos_vecinos
                ADD COLUMN IF NOT EXISTS alicuota_iva_margen_pct NUMERIC(5,2) NOT NULL DEFAULT 21.00,
                ADD COLUMN IF NOT EXISTS alicuota_iibb_margen_pct NUMERIC(5,2) NOT NULL DEFAULT 4.00,
                ADD COLUMN IF NOT EXISTS retencion_iva_margen NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS retencion_iibb_margen NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS retencion_fiscal_margen NUMERIC(14,2) NOT NULL DEFAULT 0.00;

            ALTER TABLE public.nodos_lotes_estacion
                ADD COLUMN IF NOT EXISTS total_retencion_iva_margen NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS total_retencion_iibb_margen NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS total_retencion_fiscal_margen NUMERIC(14,2) NOT NULL DEFAULT 0.00;

            ALTER TABLE public.nodos_liquidaciones_lote
                ADD COLUMN IF NOT EXISTS total_retencion_iva_margen NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS total_retencion_iibb_margen NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ADD COLUMN IF NOT EXISTS total_retencion_fiscal_margen NUMERIC(14,2) NOT NULL DEFAULT 0.00;
        `);

        // Backfill idempotente de ganancia limpia en nodos_ofertas_gestor (sin alterar precios de venta publicados)
        const ofBackfillRes = await client.query(`
            SELECT nog.id,
                   nog.precio_venta_vecino,
                   nog.margen_gestor_pct,
                   nog.ganancia_unitaria_gestor,
                   COALESCE(nac.precio_base_nodo_final, nog.precio_base_nodo_snapshot, 0) AS base_efectiva,
                   COALESCE(nm.alicuota_iva_margen_pct, 21.00) AS iva_pct,
                   COALESCE(nm.alicuota_iibb_margen_pct, 4.00) AS iibb_pct
            FROM public.nodos_ofertas_gestor nog
            JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
            LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
        `);
        for (const ofRow of ofBackfillRes.rows) {
            const base = Math.max(0, Math.round(Number(ofRow.base_efectiva || 0)));
            const precioActual = Math.max(base, Math.round(Number(ofRow.precio_venta_vecino || 0)));
            const calcOf = calcularPrecioYGananciaNetaOfertaNodo({
                costoBaseLamda: base,
                precioTienda: precioActual,
                ivaPct: ofRow.iva_pct,
                iibbPct: ofRow.iibb_pct,
                modo: 'precio'
            });
            const ganActual = Number(ofRow.ganancia_unitaria_gestor || 0);
            const margActual = Number(ofRow.margen_gestor_pct || 0);
            if (Math.abs(ganActual - calcOf.ganancia_neta_nodo) >= 0.5 || Math.abs(margActual - calcOf.margen_pct) >= 0.02) {
                await client.query(
                    `UPDATE public.nodos_ofertas_gestor
                     SET ganancia_unitaria_gestor = $2,
                         margen_gestor_pct = $3,
                         precio_base_nodo_snapshot = CASE WHEN $4 > 0 THEN $4 ELSE precio_base_nodo_snapshot END
                     WHERE id = $1`,
                    [ofRow.id, calcOf.ganancia_neta_nodo, calcOf.margen_pct, base]
                );
            }
        }

        // Backfill idempotente para pedidos abiertos aún no debitados ni liquidados
        const pedOpenRes = await client.query(`
            SELECT npv.id,
                   npv.modalidad_entrega,
                   npv.subtotal_productos_vecino,
                   npv.monto_ajuste_credito,
                   npv.cargo_envio_barrial,
                   npv.total_vecino,
                   npv.total_base_lamda,
                   COALESCE(nm.alicuota_iva_margen_pct, 21.00) AS iva_pct,
                   COALESCE(nm.alicuota_iibb_margen_pct, 4.00) AS iibb_pct
            FROM public.nodos_pedidos_vecinos npv
            JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
            LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
            WHERE COALESCE(npv.estado_operativo, '') <> 'ANULADO'
              AND COALESCE(npv.debito_cta_cte_registrado, false) = false
              AND COALESCE(nle.debito_cta_cte_registrado, false) = false
              AND npv.liquidacion_id IS NULL
              AND COALESCE(nle.liquidacion_cerrada, false) = false
              AND COALESCE(npv.retencion_fiscal_margen, 0) = 0
              AND COALESCE(npv.subtotal_productos_vecino, 0) > COALESCE(npv.total_base_lamda, 0)
        `);
        for (const pr of pedOpenRes.rows) {
            const subNeto = Math.max(0, Number(pr.subtotal_productos_vecino || 0) - Number(pr.monto_ajuste_credito || 0));
            const exc = Math.max(0, subNeto - Number(pr.total_base_lamda || 0));
            const tf = desglosarRetencionFiscalExcedente(exc, pr.iva_pct, pr.iibb_pct);
            const esPostal = String(pr.modalidad_entrega || '').toUpperCase() === 'ENVIO_POSTAL';
            const nuevaGan = esPostal
                ? tf.ganancia_neta
                : Number((tf.ganancia_neta + Number(pr.cargo_envio_barrial || 0)).toFixed(2));
            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET alicuota_iva_margen_pct = $2,
                     alicuota_iibb_margen_pct = $3,
                     retencion_iva_margen = $4,
                     retencion_iibb_margen = $5,
                     retencion_fiscal_margen = $6,
                     ganancia_total_gestor = $7
                 WHERE id = $1`,
                [
                    pr.id,
                    tf.alicuota_iva_pct,
                    tf.alicuota_iibb_pct,
                    tf.iva_excedente,
                    tf.iibb_excedente,
                    tf.retencion_fiscal_total,
                    nuevaGan
                ]
            );
        }

        // Migración idempotente de identidad visual Paraíso para NODO-001 (sin tocar MANSO ni pedidos)
        await migrarNodoLoDeMatiAParaiso(client);
        await asegurarEsquemaAnaliticaNodos(client);
        await pagosBancariosService.asegurarEsquemaPagosBancariosNodos(client, { forzar: true });

        await client.query('COMMIT');
        esquemaInicializado = true;

        // Sincronizar canastos y el circuito operativo de LAMDA (Clientes, Artículos, Recetas, Stock y Presupuestos)
        await sincronizarCanastosEstacionNodos();
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ [NodosBarriales] Error inicializando esquema:', err);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Obtiene todas las fuentes de costo vivas de los 6 Flujos de la Pizarra
 * utilizando únicamente ingredientes simples puente y hermanos nativos deterministas.
 */
async function obtenerFuentesCostoSeisFlujos() {
    const [ingRes, compRes, mixPadresRes, artDirectosRes, envasesRes, tarifasRes, cuentasRes, clientesRes, hermanosRes, cfgCanalRes] = await Promise.all([
        db.query(`
            SELECT i.id, i.codigo, i.nombre, COALESCE(i.costo_patron, 0)::numeric(14,2) AS costo_patron,
                   i.articulo_vinculado_numero, COALESCE(i.es_insumo, false) AS es_insumo,
                   i.categoria_id, ci.nombre AS categoria_ingrediente_nombre
            FROM public.ingredientes i
            LEFT JOIN public.categorias_ingredientes ci ON ci.id = i.categoria_id
            WHERE COALESCE(i.es_insumo, false) = false
              AND i.id < 8000
              AND i.nombre NOT ILIKE '%Fuera de Servicio%'
              AND i.nombre NOT ILIKE '%Para Mix%'
              AND i.nombre NOT ILIKE '%Test E2E%'
            ORDER BY i.nombre ASC
        `),
        db.query(`
            SELECT DISTINCT mix_id AS ingrediente_padre_id
            FROM public.ingrediente_composicion
        `),
        db.query(`
            SELECT DISTINCT ON (ing_s.id)
                   ing_s.id AS simple_id,
                   r.id AS receta_puente_id,
                   r.articulo_numero AS receta_puente_codigo,
                   ing_p.id AS padre_id,
                   ing_p.codigo AS padre_codigo,
                   ing_p.nombre AS padre_nombre,
                   COALESCE(ing_p.costo_patron, 0)::numeric(14,2) AS padre_costo_patron
            FROM public.ingredientes ing_s
            JOIN public.recetas r ON UPPER(r.articulo_numero) = UPPER(ing_s.articulo_vinculado_numero)
            JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
            JOIN public.ingredientes ing_p ON ing_p.id = ri.ingrediente_id
            WHERE ing_s.articulo_vinculado_numero IS NOT NULL
              AND TRIM(ing_s.articulo_vinculado_numero) <> ''
              AND ing_p.id <> ing_s.id
              AND COALESCE(ing_p.es_insumo, false) = false
            ORDER BY ing_s.id, COALESCE(ri.cantidad, 0) DESC, ing_p.id ASC
        `),
        db.query(`
            SELECT articulo_id, descripcion_generada, descripcion, rubro, sub_rubro,
                   COALESCE(costo_base, 0)::numeric(14,2) AS costo_base,
                   COALESCE(kilos_unidad, 1)::numeric(10,4) AS kilos_unidad
            FROM public.bunker_articulos
            WHERE COALESCE(costo_base, 0) > 0
              AND COALESCE(es_pack, false) = false
            ORDER BY descripcion_generada ASC NULLS LAST
            LIMIT 120
        `),
        db.query(`
            SELECT id, codigo, nombre, COALESCE(costo_patron, 0)::numeric(14,2) AS costo_unitario
            FROM public.ingredientes
            WHERE COALESCE(es_insumo, false) = true
            ORDER BY costo_patron ASC, nombre ASC
        `),
        db.query(`
            SELECT ct.id, ct.usuario_id,
                   COALESCE(u.nombre_completo, u.usuario, 'Operador Taller') AS nombre_completo,
                   COALESCE(ct.valor_hora, 7000)::numeric(12,2) AS valor_hora, ct.activo
            FROM public.colaboradores_tarifas ct
            LEFT JOIN public.usuarios u ON u.id = ct.usuario_id
            WHERE COALESCE(ct.activo, true) = true
            ORDER BY ct.id ASC
        `),
        db.query(`
            SELECT id, banco, titular, alias, cbu, estado
            FROM public.fin_cuentas_bancarias
            WHERE COALESCE(estado, 'ACTIVA') = 'ACTIVA'
            ORDER BY id ASC
        `),
        db.query(`
            SELECT bc.id, bc.codigo_bunker_cliente, bc.cliente_nombre, bc.razon_social,
                   bc.cuit_cuil, bc.domicilio_fiscal, bc.provincia, bc.whatsapp_facturas,
                   bc.email_portal, bc.email_portal_nombre, bc.lomas_soft_id, bc.usuario_id,
                   COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cta_cte,
                   cd.direccion AS domicilio_entrega_direccion,
                   cd.localidad AS domicilio_entrega_localidad,
                   cd.alias AS domicilio_entrega_alias,
                   cd.telefono_contacto AS domicilio_entrega_telefono,
                   cd.latitud AS domicilio_entrega_latitud,
                   cd.longitud AS domicilio_entrega_longitud,
                   COALESCE(doms.lista, '[]'::jsonb) AS domicilios_registrados
            FROM public.bunker_clientes bc
            LEFT JOIN public.factura_cuentas_corrientes cc
              ON cc.codigo_bunker_cliente = bc.codigo_bunker_cliente
             AND cc.nombre_cuenta = 'Cuenta Principal'
            LEFT JOIN LATERAL (
                SELECT direccion, localidad, alias, telefono_contacto, latitud, longitud
                FROM public.clientes_domicilios d
                WHERE d.id_cliente = bc.id
                  AND COALESCE(d.activo, true) = true
                ORDER BY COALESCE(d.es_predeterminado, false) DESC, d.id ASC
                LIMIT 1
            ) cd ON true
            LEFT JOIN LATERAL (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', d.id,
                        'alias', COALESCE(d.alias, 'Entrega'),
                        'direccion', d.direccion,
                        'localidad', d.localidad,
                        'provincia', d.provincia,
                        'latitud', d.latitud,
                        'longitud', d.longitud,
                        'es_predeterminado', COALESCE(d.es_predeterminado, false)
                    ) ORDER BY COALESCE(d.es_predeterminado, false) DESC, d.id ASC
                ) AS lista
                FROM public.clientes_domicilios d
                WHERE d.id_cliente = bc.id
                  AND COALESCE(d.activo, true) = true
            ) doms ON true
            WHERE bc.codigo_bunker_cliente NOT LIKE 'CB-NODO-%'
            ORDER BY bc.id ASC
        `),
        db.query(`
            SELECT DISTINCT ON (ri.ingrediente_id)
                   ri.ingrediente_id,
                   ba.articulo_id AS hermano_sku,
                   ba.descripcion_generada AS hermano_descripcion_generada,
                   ba.descripcion AS hermano_articulo_principal,
                   ba.familia_id AS hermano_familia_id,
                   bf.nombre AS hermano_familia_nombre
            FROM public.receta_ingredientes ri
            JOIN public.recetas r ON r.id = ri.receta_id
            JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(r.articulo_numero)
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            WHERE COALESCE(ba.es_pack, false) = false
              AND ba.familia_id IS NOT NULL
              AND COALESCE(ba.familia_id, 0) <> 42
              AND UPPER(ba.articulo_id) NOT LIKE 'NB-%'
              AND UPPER(ba.articulo_id) NOT LIKE 'EMB-%'
            ORDER BY ri.ingrediente_id,
                     CASE
                         WHEN ba.kilos_unidad BETWEEN 0.10 AND 1.00 THEN 0
                         ELSE 1
                     END,
                     ba.kilos_unidad ASC
        `),
        db.query(`
            SELECT id, cuenta_bancaria_id, banco_recaudador, alias_recaudador, cbu_recaudador, titular_recaudador, updated_at
            FROM public.nodos_configuracion_canal
            WHERE id = 1
        `)
    ]);

    const idsCompuestosSet = new Set(compRes.rows.map(r => Number(r.ingrediente_padre_id)));
    const idsPreMezclasIntermedias = new Set([109, 132, 133, 134, 135, 136, 140]);
    const mapaHermanos = new Map(hermanosRes.rows.map(r => [Number(r.ingrediente_id), r]));
    const mapaMixPadres = new Map(
        mixPadresRes.rows.map(r => {
            const codP = r.padre_codigo !== null && r.padre_codigo !== undefined && String(r.padre_codigo).trim() !== ''
                ? String(r.padre_codigo).trim()
                : `#${r.padre_id}`;
            return [Number(r.simple_id), {
                id: Number(r.padre_id),
                codigo: r.padre_codigo,
                nombre: r.padre_nombre,
                costo_patron: Number(r.padre_costo_patron || 0),
                receta_puente_id: Number(r.receta_puente_id),
                receta_puente_codigo: r.receta_puente_codigo,
                label_oficial: `#${r.padre_id} [${codP}] ${r.padre_nombre}`
            }];
        })
    );

    const fuentesIngredientes = ingRes.rows
        .filter(ing => {
            const idNum = Number(ing.id);
            if (idsCompuestosSet.has(idNum)) return false;
            if (idsPreMezclasIntermedias.has(idNum)) return false;
            return true;
        })
        .map(ing => {
            const idNum = Number(ing.id);
            const herm = mapaHermanos.get(idNum) || null;
            const ident = resolverIdentidadTecnicaIngrediente(
                ing,
                herm ? herm.hermano_familia_nombre : null,
                ing.categoria_ingrediente_nombre || null,
                idsCompuestosSet
            );
            const mixPadre = mapaMixPadres.get(idNum) || null;
            return {
                id: idNum,
                codigo: ing.codigo,
                nombre: ing.nombre,
                label_oficial: ident.label_oficial,
                categoria_lamda: ident.categoria_lamda,
                es_pack_barritas: ident.es_pack_barritas,
                costo_kg: Number(ing.costo_patron),
                articulo_vinculado_numero: ing.articulo_vinculado_numero || null,
                mix_padre: mixPadre,
                flujo: ident.flujo,
                flujo_nombre: ident.flujo_nombre,
                origen_tipo: ident.origen_tipo,
                hermano_sku_base: herm ? herm.hermano_sku : null,
                hermano_descripcion_generada: herm ? herm.hermano_descripcion_generada : null,
                hermano_familia_id: herm ? Number(herm.hermano_familia_id) : null
            };
        });

    const fuentesDirectosFlujo1 = artDirectosRes.rows.map(art => {
        const kilos = Math.max(0.001, Number(art.kilos_unidad) || 1);
        const costoBase = Number(art.costo_base) || 0;
        const costoKg = Number((costoBase / kilos).toFixed(2));
        const descOf = art.descripcion_generada || art.descripcion || art.articulo_id;
        return {
            articulo_id: art.articulo_id,
            nombre: descOf,
            label_oficial: formatearEtiquetaTecnicaArticulo(art.articulo_id, descOf),
            rubro: art.rubro,
            kilos_bulto: kilos,
            costo_bulto: costoBase,
            costo_kg: costoKg,
            flujo: 1,
            flujo_nombre: '[LDN 1] Directo (Sin Receta)',
            origen_tipo: 'ARTICULO_BUNKER'
        };
    });

    const cfgCanalRow = cfgCanalRes.rows[0] || {
        id: 1,
        cuenta_bancaria_id: 1,
        banco_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.banco_recaudador,
        alias_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.alias_recaudador,
        cbu_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.cbu_recaudador,
        titular_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.titular_recaudador,
        cuil_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.cuil_recaudador,
        numero_cuenta_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.numero_cuenta_recaudador,
        solo_transferencia_bancaria: true
    };

    return {
        ingredientes_por_flujo: fuentesIngredientes,
        articulos_flujo_1: fuentesDirectosFlujo1,
        envases: envasesRes.rows.map(e => {
            const codEnv = e.codigo !== null && e.codigo !== undefined && String(e.codigo).trim() !== ''
                ? String(e.codigo).trim()
                : `#${e.id}`;
            return {
                id: Number(e.id),
                codigo: e.codigo,
                nombre: e.nombre,
                label_oficial: `#${e.id} [${codEnv}] ${e.nombre}`,
                costo_unitario: Number(e.costo_unitario)
            };
        }),
        tarifas_mano_obra: tarifasRes.rows.map(t => ({
            id: Number(t.id),
            nombre_completo: t.nombre_completo,
            valor_hora: Number(t.valor_hora)
        })),
        cuentas_bancarias: cuentasRes.rows,
        clientes_bunker: clientesRes.rows,
        config_cuenta_canal: cfgCanalRow,
        google_maps_api_key: process.env.GOOGLE_MAPS_API_KEY || ''
    };
}

/**
 * Obtiene las presentaciones unitarias (<= 1kg, más packs de barritas) que LAMDA YA PRODUCE
 * en Planta / Búnker (public.bunker_articulos + public.recetas + public.receta_ingredientes),
 * cruzadas con public.nodos_articulos_catalogo (Lista Base Nodos Barriales).
 */
async function obtenerPresentacionesPlantaLamda(runner = null) {
    const q = runner || db;
    const [plantaRes, catNodosRes, compRes] = await Promise.all([
        q.query(`
            SELECT
                ba.articulo_id,
                ba.descripcion_generada,
                ba.kilos_unidad,
                COALESCE(ba.es_pack, false) AS es_pack,
                COALESCE(ba.pack_unidades, 1) AS pack_unidades,
                COALESCE(ba.costo_base, 0)::numeric(14,2) AS bunker_costo_base,
                ba.familia_id,
                bf.nombre AS familia_nombre,
                ri.ingrediente_id,
                i.codigo AS ingrediente_codigo,
                i.nombre AS ingrediente_nombre,
                i.articulo_vinculado_numero,
                ci.nombre AS categoria_ingrediente_nombre,
                COALESCE(i.costo_patron, 0)::numeric(14,2) AS costo_insumo_kg,
                nac.id AS catalogo_nodo_id,
                nac.precio_base_nodo_final,
                nac.nombre_publico AS catalogo_nombre_publico,
                COALESCE(
                    (SELECT la.precio_final
                     FROM public.bunker_lista_articulos la
                     WHERE UPPER(la.articulo_numero) = UPPER(ba.articulo_id)
                       AND la.lista_id = 5
                       AND la.disponible = true
                       AND la.precio_final > 0
                     LIMIT 1),
                    (SELECT ROUND(la.precio_final / NULLIF(bp.pack_unidades, 0), 2)
                     FROM public.bunker_articulos bp
                     JOIN public.bunker_lista_articulos la
                       ON UPPER(la.articulo_numero) = UPPER(bp.articulo_id)
                      AND la.disponible = true
                      AND la.precio_final > 0
                     WHERE UPPER(bp.pack_hijo_codigo) = UPPER(ba.articulo_id)
                       AND bp.es_pack = true
                     ORDER BY CASE WHEN la.lista_id = 5 THEN 0 ELSE 1 END, la.lista_id ASC
                     LIMIT 1)
                )::numeric(14,2) AS precio_ref_mayorista
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            JOIN public.recetas r ON UPPER(r.articulo_numero) = UPPER(ba.articulo_id)
            JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
            JOIN public.ingredientes i ON i.id = ri.ingrediente_id AND COALESCE(i.es_insumo, false) = false
            LEFT JOIN public.categorias_ingredientes ci ON ci.id = i.categoria_id
            LEFT JOIN public.nodos_articulos_catalogo nac
              ON UPPER(nac.sku_nodo) = UPPER(ba.articulo_id)
             AND nac.activo = true
            WHERE UPPER(ba.articulo_id) NOT LIKE 'NB-%'
              AND UPPER(ba.articulo_id) NOT LIKE 'EMB-%'
              AND UPPER(ba.articulo_id) <> 'CCTX250G'
              AND COALESCE(ba.familia_id, 0) > 0
              AND COALESCE(ba.familia_id, 0) <> 42
              AND (
                  (COALESCE(ba.es_pack, false) = false AND COALESCE(ba.kilos_unidad, 1) <= 1.05)
                  OR (ri.ingrediente_id = 141 AND COALESCE(ba.kilos_unidad, 1) <= 1.25)
              )
            ORDER BY ri.ingrediente_id ASC,
                     ba.kilos_unidad ASC,
                     CASE WHEN nac.id IS NOT NULL THEN 0 ELSE 1 END,
                     ba.articulo_id ASC
        `),
        q.query(`
            SELECT id, sku_nodo, nombre_publico, nomenclatura_bunker, presentacion_etiqueta, ingrediente_origen_id,
                   kilos_unidad, precio_base_nodo_final
            FROM public.nodos_articulos_catalogo
            WHERE activo = true
              AND ingrediente_origen_id IS NOT NULL
            ORDER BY ingrediente_origen_id ASC, kilos_unidad ASC
        `),
        q.query('SELECT DISTINCT mix_id AS ingrediente_padre_id FROM public.ingrediente_composicion')
    ]);

    const idsCompuestosSet = new Set(compRes.rows.map(r => Number(r.ingrediente_padre_id)));
    const porIngredienteGestor = new Map();
    const disponiblesParaAdmin = [];

    const formatearEtiquetaPeso = (kilos, esPack, packUnidades) => {
        const kg = Number(kilos || 0);
        const gramos = Math.round(kg * 1000);
        if (esPack && Number(packUnidades) > 1) {
            const pesoTxt = gramos >= 1000
                ? `${Number(kg.toFixed(2))} kg`
                : `${gramos}g`;
            return `Pack x ${Number(packUnidades)} (${pesoTxt})`;
        }
        if (gramos >= 1000 && gramos % 1000 === 0) {
            return `${gramos / 1000} kg`;
        }
        if (gramos >= 1000) {
            return `${Number(kg.toFixed(2))} kg`;
        }
        return `${gramos}g`;
    };

    const registrarEnMapaGestor = (ingId, itemPublico) => {
        if (!porIngredienteGestor.has(ingId)) {
            porIngredienteGestor.set(ingId, []);
        }
        const lista = porIngredienteGestor.get(ingId);
        const idxExist = lista.findIndex(x => Math.abs(Number(x.kilos_unidad) - Number(itemPublico.kilos_unidad)) < 0.003);
        if (idxExist === -1) {
            lista.push(itemPublico);
        } else if (!lista[idxExist].en_catalogo_nodos && itemPublico.en_catalogo_nodos) {
            lista[idxExist] = itemPublico;
        }
    };

    for (const row of plantaRes.rows) {
        const ingId = Number(row.ingrediente_id);
        const kilos = Number(Number(row.kilos_unidad || 0).toFixed(4));
        const etiqueta = formatearEtiquetaPeso(kilos, row.es_pack, row.pack_unidades);
        const enCatalogo = Boolean(row.catalogo_nodo_id);
        const descOficial = row.descripcion_generada || row.articulo_id;

        // Metadatos técnicos oficiales para el Gestor (SKU + descripción Búnker, CERO costos internos ni stocks)
        registrarEnMapaGestor(ingId, {
            sku: row.articulo_id,
            descripcion_generada: descOficial,
            label_oficial: formatearEtiquetaTecnicaArticulo(row.articulo_id, descOficial),
            kilos_unidad: kilos,
            es_pack: Boolean(row.es_pack),
            pack_unidades: Number(row.pack_unidades || 1),
            etiqueta,
            ya_produce_lamda: true,
            en_catalogo_nodos: enCatalogo,
            catalogo_id: enCatalogo ? Number(row.catalogo_nodo_id) : null,
            precio_base_nodo_final: enCatalogo ? Number(row.precio_base_nodo_final) : null
        });

        if (!enCatalogo) {
            const ident = resolverIdentidadTecnicaIngrediente(
                {
                    id: ingId,
                    codigo: row.ingrediente_codigo,
                    nombre: row.ingrediente_nombre,
                    articulo_vinculado_numero: row.articulo_vinculado_numero
                },
                row.familia_nombre,
                row.categoria_ingrediente_nombre,
                idsCompuestosSet
            );
            disponiblesParaAdmin.push({
                articulo_id: row.articulo_id,
                descripcion_generada: descOficial,
                label_oficial: formatearEtiquetaTecnicaArticulo(row.articulo_id, descOficial),
                kilos_unidad: kilos,
                etiqueta_peso: etiqueta,
                es_pack: Boolean(row.es_pack),
                pack_unidades: Number(row.pack_unidades || 1),
                ingrediente_id: ingId,
                ingrediente_codigo: row.ingrediente_codigo,
                ingrediente_nombre: row.ingrediente_nombre,
                ingrediente_label_oficial: ident.label_oficial,
                categoria_lamda: ident.categoria_lamda,
                flujo: ident.flujo,
                costo_insumo_kg: Number(row.costo_insumo_kg || 0),
                bunker_costo_base: Number(row.bunker_costo_base || 0),
                precio_ref_mayorista: row.precio_ref_mayorista ? Number(row.precio_ref_mayorista) : null
            });
        }
    }

    for (const cat of catNodosRes.rows) {
        const ingId = Number(cat.ingrediente_origen_id);
        const kilos = Number(Number(cat.kilos_unidad || 0).toFixed(4));
        const descCat = cat.nomenclatura_bunker || cat.nombre_publico || cat.sku_nodo;
        registrarEnMapaGestor(ingId, {
            sku: cat.sku_nodo,
            descripcion_generada: descCat,
            label_oficial: formatearEtiquetaTecnicaArticulo(cat.sku_nodo, descCat),
            kilos_unidad: kilos,
            es_pack: ingId === 141,
            pack_unidades: ingId === 141 ? Math.max(1, Math.round((kilos * 1000) / 50)) : 1,
            etiqueta: formatearEtiquetaPeso(kilos, ingId === 141, ingId === 141 ? Math.max(1, Math.round((kilos * 1000) / 50)) : 1),
            ya_produce_lamda: true,
            en_catalogo_nodos: true,
            catalogo_id: Number(cat.id),
            precio_base_nodo_final: Number(cat.precio_base_nodo_final)
        });
    }

    for (const lista of porIngredienteGestor.values()) {
        lista.sort((a, b) => a.kilos_unidad - b.kilos_unidad);
    }

    disponiblesParaAdmin.sort((a, b) => {
        const aChica = a.kilos_unidad < 0.99 ? 0 : 1;
        const bChica = b.kilos_unidad < 0.99 ? 0 : 1;
        if (aChica !== bChica) return aChica - bChica;
        const catDiff = String(a.categoria_lamda).localeCompare(String(b.categoria_lamda), 'es');
        if (catDiff !== 0) return catDiff;
        const nomDiff = String(a.descripcion_generada).localeCompare(String(b.descripcion_generada), 'es');
        if (nomDiff !== 0) return nomDiff;
        return a.kilos_unidad - b.kilos_unidad;
    });

    return {
        porIngredienteGestor,
        disponiblesParaAdmin
    };
}

/**
 * Obtiene el estado completo del ecosistema de Nodos Barriales para la Pizarra
 */
async function obtenerEstadoCompletoNodos() {
    await asegurarEsquemaNodosBarriales();

    const [
        nodosRes,
        catalogoRes,
        propuestasRes,
        ofertasRes,
        fuentes,
        listaNodosRes,
        listasMayoristasRes,
        politicasRes,
        familiasRes,
        plantaInfo
    ] = await Promise.all([
        db.query(`
            SELECT nm.*,
                   fb.banco AS banco_nombre,
                   fb.alias AS banco_alias_oficial,
                   fb.cbu AS banco_cbu_oficial,
                   lp.nombre AS lista_precio_bunker_nombre,
                   lp.salvavidas_tasa_tem,
                   lp.salvavidas_dias_gracia,
                   COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente,
                   bc_madre.cliente_nombre AS cliente_madre_nombre,
                   bc_madre.razon_social AS cliente_madre_razon_social,
                   bc_madre.lomas_soft_id AS cliente_madre_lomas_id,
                   bc_madre.usuario_id AS cliente_madre_usuario_id,
                   COALESCE(cc_madre.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente_madre,
                   (SELECT COUNT(*)::int FROM public.nodos_ofertas_gestor nog WHERE nog.nodo_id = nm.id AND nog.publicado_tienda = true) AS total_ofertas_publicadas
            FROM public.nodos_maestro nm
            LEFT JOIN public.fin_cuentas_bancarias fb ON fb.id = nm.cuenta_bancaria_id
            LEFT JOIN public.bunker_listas_precios lp ON lp.id = nm.lista_precio_bunker_id
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
            LEFT JOIN public.bunker_clientes bc_madre ON bc_madre.id = nm.cliente_madre_bunker_id
            LEFT JOIN public.factura_cuentas_corrientes cc_madre
              ON cc_madre.codigo_bunker_cliente = nm.codigo_bunker_cliente_madre
             AND cc_madre.nombre_cuenta = 'Cuenta Principal'
            ORDER BY nm.id ASC
        `),
        db.query(`
            SELECT nac.*,
                   COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS bunker_descripcion_generada,
                   COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_oficial_lamda,
                   COALESCE(nac.familia_bunker_nombre, 'Frutos Secos') AS bunker_familia_nombre,
                   ing.codigo AS ingrediente_origen_codigo,
                   ing.nombre AS ingrediente_origen_nombre,
                   ing.articulo_vinculado_numero AS ingrediente_origen_puente,
                   COALESCE(ing.costo_patron, nac.costo_insumo_kg)::numeric(14,2) AS costo_insumo_kg_vivo,
                   env.codigo AS envase_codigo,
                   env.nombre AS envase_nombre,
                   COALESCE(env.costo_patron, nac.costo_envase_aplicado)::numeric(14,2) AS costo_envase_vivo,
                   COALESCE(u.nombre_completo, u.usuario, 'Operador Taller') AS colaborador_nombre,
                   COALESCE(src.stock_consolidado, 0)::numeric(12,2) AS stock_fisico_bunker
            FROM public.nodos_articulos_catalogo nac
            LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(nac.sku_nodo)
            LEFT JOIN public.ingredientes ing ON ing.id = nac.ingrediente_origen_id
            LEFT JOIN public.ingredientes env ON env.id = nac.insumo_envase_id
            LEFT JOIN public.colaboradores_tarifas ct ON ct.id = nac.tarifa_colaborador_id
            LEFT JOIN public.usuarios u ON u.id = ct.usuario_id
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = nac.sku_nodo
            WHERE nac.activo = true
            ORDER BY nac.flujo_lamda ASC, COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) ASC
        `),
        db.query(`
            SELECT npf.*,
                   nm.nombre_marca AS nodo_solicitante_nombre,
                   nm.gestor_nombre AS nodo_gestor_nombre,
                   nm.color_primario AS nodo_color,
                   ing.codigo AS ingrediente_sugerido_codigo,
                   ing.nombre AS ingrediente_sugerido_nombre,
                   ing.articulo_vinculado_numero AS ingrediente_sugerido_puente,
                   COALESCE(ing.costo_patron, 0)::numeric(14,2) AS ingrediente_sugerido_costo_kg,
                   env.codigo AS envase_sugerido_codigo,
                   env.nombre AS envase_sugerido_nombre,
                   COALESCE(env.costo_patron, 0)::numeric(14,2) AS envase_sugerido_costo
            FROM public.nodos_propuestas_fracciones npf
            LEFT JOIN public.nodos_maestro nm ON nm.id = npf.nodo_solicitante_id
            LEFT JOIN public.ingredientes ing ON ing.id = npf.ingrediente_sugerido_id
            LEFT JOIN public.ingredientes env ON env.id = npf.insumo_envase_sugerido_id
            WHERE COALESCE(npf.estado, '') NOT IN ('ANULADA', 'DESCARTADA')
            ORDER BY
                CASE WHEN npf.estado = 'PENDIENTE_COTIZACION' THEN 0 ELSE 1 END,
                npf.id DESC
        `),
        db.query(`
            SELECT nog.*,
                   nm.nombre_marca,
                   nm.slug AS nodo_slug,
                   nm.color_primario,
                   COALESCE(nm.alicuota_iva_margen_pct, 21.00)::numeric(5,2) AS alicuota_iva_margen_pct,
                   COALESCE(nm.alicuota_iibb_margen_pct, 4.00)::numeric(5,2) AS alicuota_iibb_margen_pct,
                   nac.sku_nodo,
                   COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_publico,
                   COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_oficial_lamda,
                   COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nomenclatura_bunker,
                   nac.familia_bunker_nombre,
                   nac.compartido_mayorista,
                   nac.presentacion_etiqueta,
                   nac.flujo_lamda,
                   nac.kilos_unidad,
                   nac.precio_base_nodo_final AS precio_base_actual_lamda
            FROM public.nodos_ofertas_gestor nog
            JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
            JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
            LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(nac.sku_nodo)
            WHERE nac.activo = true
            ORDER BY nog.nodo_id ASC, nac.flujo_lamda ASC, COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) ASC
        `),
        obtenerFuentesCostoSeisFlujos(),
        db.query(`
            SELECT id, nombre, descripcion, activa, COALESCE(canal_comercial, 'MAYORISTA') AS canal_comercial,
                   salvavidas_habilitado, salvavidas_tasa_tem, salvavidas_dias_gracia,
                   salvavidas_dias_estandar, salvavidas_dias_cortesia
            FROM public.bunker_listas_precios
            WHERE COALESCE(canal_comercial, 'MAYORISTA') = 'NODOS'
            ORDER BY id ASC LIMIT 1
        `),
        db.query(`
            SELECT id, nombre, descripcion, activa
            FROM public.bunker_listas_precios
            WHERE activa = true AND COALESCE(canal_comercial, 'MAYORISTA') = 'MAYORISTA'
            ORDER BY id ASC
        `),
        db.query(`
            SELECT pd.id, pd.nombre, pd.descripcion, pl.bunker_lista_precio_id, pd.activo,
                   pd.tipo_calculo, pd.aplica_sobre, pd.exige_saldo_cero, pd.tolerancia_saldo,
                   COALESCE(
                       json_agg(
                           json_build_object(
                               'monto_minimo', pdt.monto_minimo,
                               'descuento_porcentaje', pdt.descuento_porcentaje,
                               'etiqueta', pdt.etiqueta
                           ) ORDER BY pdt.orden ASC
                       ) FILTER (WHERE pdt.id IS NOT NULL),
                       '[]'::json
                   ) AS tramos
            FROM public.bunker_politicas_descuento pd
            JOIN public.bunker_politica_listas pl ON pl.politica_id = pd.id
            JOIN public.bunker_listas_precios lp ON lp.id = pl.bunker_lista_precio_id
            LEFT JOIN public.bunker_politica_descuento_tramos pdt ON pdt.politica_id = pd.id
            WHERE lp.canal_comercial = 'NODOS' AND pd.activo = true
            GROUP BY pd.id, pl.bunker_lista_precio_id
            ORDER BY pd.id ASC
        `),
        db.query(`
            SELECT id, nombre, descripcion
            FROM public.bunker_familias
            WHERE activo = true
            ORDER BY id ASC
        `),
        obtenerPresentacionesPlantaLamda()
    ]);

    if (fuentes) {
        const lRow = listaNodosRes.rows[0] || null;
        fuentes.lista_bunker_nodos = lRow ? { id: lRow.id, nombre_lista: lRow.nombre, canal_comercial: lRow.canal_comercial } : null;
        fuentes.politicas_bunker_nodos = politicasRes.rows;
    }

    return {
        nodos: nodosRes.rows,
        catalogo: catalogoRes.rows,
        propuestas: propuestasRes.rows,
        ofertas_gestor: ofertasRes.rows,
        fuentes,
        presentaciones_planta_disponibles: plantaInfo ? plantaInfo.disponiblesParaAdmin : [],
        lista_precios_nodos_bunker: listaNodosRes.rows[0] || null,
        listas_mayoristas_bunker: listasMayoristasRes.rows,
        politicas_descuento_bunker: politicasRes.rows,
        familias_bunker: familiasRes.rows,
        modo_laboratorio: esModoLaboratorioNodos()
    };
}

/**
 * Crea o actualiza un Nodo Barrial con generación de logo ZPL ^GFA y vínculo contable
 */
async function guardarNodoMaestro(payload = {}, idExistente = null) {
    await asegurarEsquemaNodosBarriales();

    const nombreMarca = String(payload.nombre_marca || '').trim();
    const gestorNombre = String(payload.gestor_nombre || '').trim();
    if (!nombreMarca || !gestorNombre) {
        throw new Error('El nombre de la marca del Nodo y el nombre del gestor son obligatorios.');
    }
    if (!payload.cliente_madre_bunker_id && !payload.codigo_bunker_cliente_madre) {
        throw new Error('Todo Nodo debe partir de un Cliente registrado en el padrón general de LAMDA. Seleccione primero al cliente en el buscador (o délo de alta en Clientes Búnker).');
    }

    const slugBase = String(payload.slug || nombreMarca)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `nodo-${Date.now()}`;

    let existenteRow = null;
    if (idExistente) {
        const exRes = await db.query('SELECT * FROM public.nodos_maestro WHERE id = $1 LIMIT 1', [Number(idExistente)]);
        existenteRow = exRes.rows[0] || null;
    }

    const perfilOperativoEfectivo = payload.perfil_operativo !== undefined
        ? normalizarPerfilOperativoNodo(payload.perfil_operativo)
        : normalizarPerfilOperativoNodo(existenteRow?.perfil_operativo || 'vecinal');

    const cambioDePerfil = Boolean(existenteRow) &&
        normalizarPerfilOperativoNodo(existenteRow.perfil_operativo) !== perfilOperativoEfectivo;

    const overridesModulos = (payload.modulos_activos && typeof payload.modulos_activos === 'object' && !Array.isArray(payload.modulos_activos))
        ? { ...payload.modulos_activos }
        : {};
    if (payload.permitir_retiro_nodo !== undefined && overridesModulos.retiro_punto === undefined) {
        overridesModulos.retiro_punto = Boolean(payload.permitir_retiro_nodo);
    }
    if ((payload.permitir_reparto_propio !== undefined || payload.permitir_envio_barrial !== undefined) && overridesModulos.reparto_zonal === undefined) {
        overridesModulos.reparto_zonal = Boolean(payload.permitir_reparto_propio ?? payload.permitir_envio_barrial);
    }
    if (payload.permitir_encomienda !== undefined && overridesModulos.envio_paqueteria === undefined) {
        overridesModulos.envio_paqueteria = Boolean(payload.permitir_encomienda);
    }
    if ((payload.cobro_efectivo_entrega !== undefined || payload.permitir_efectivo !== undefined) && overridesModulos.cobro_efectivo_entrega === undefined) {
        overridesModulos.cobro_efectivo_entrega = Boolean(payload.cobro_efectivo_entrega ?? payload.permitir_efectivo);
    }

    const modulosActivosEfectivos = resolverModulosActivosNodo(
        {
            perfil_operativo: perfilOperativoEfectivo,
            modulos_activos: cambioDePerfil ? {} : (existenteRow?.modulos_activos || {}),
            cobro_efectivo_entrega: cambioDePerfil ? undefined : existenteRow?.cobro_efectivo_entrega,
            permitir_retiro_nodo: cambioDePerfil ? undefined : existenteRow?.permitir_retiro_nodo,
            permitir_reparto_propio: cambioDePerfil ? undefined : existenteRow?.permitir_reparto_propio,
            permitir_envio_barrial: cambioDePerfil ? undefined : existenteRow?.permitir_envio_barrial,
            permitir_encomienda: cambioDePerfil ? undefined : existenteRow?.permitir_encomienda
        },
        overridesModulos
    );
    const cobroEfectivoEntregaEfectivo = Boolean(modulosActivosEfectivos.cobro_efectivo_entrega);

    const permitirRetiro = payload.permitir_retiro_nodo !== undefined
        ? Boolean(payload.permitir_retiro_nodo)
        : Boolean(modulosActivosEfectivos.retiro_punto);
    const permitirReparto = payload.permitir_reparto_propio !== undefined
        ? Boolean(payload.permitir_reparto_propio)
        : (payload.permitir_envio_barrial !== undefined
            ? Boolean(payload.permitir_envio_barrial)
            : Boolean(modulosActivosEfectivos.reparto_zonal));
    const permitirEncomienda = payload.permitir_encomienda !== undefined
        ? Boolean(payload.permitir_encomienda)
        : Boolean(modulosActivosEfectivos.envio_paqueteria);

    modulosActivosEfectivos.retiro_punto = permitirRetiro;
    modulosActivosEfectivos.reparto_zonal = permitirReparto;
    modulosActivosEfectivos.envio_paqueteria = permitirEncomienda;
    if (!permitirReparto && perfilOperativoEfectivo === 'ecommerce_fulfillment') {
        modulosActivosEfectivos.hoja_de_ruta = false;
    }

    if (!permitirRetiro && !permitirReparto && !permitirEncomienda) {
        throw new Error('Debés habilitar al menos una modalidad activa de entrega (Punto de Retiro, Reparto Zonal o Paquetería Nacional).');
    }

    const configPaqueteriaPrev = (existenteRow?.config_paqueteria && typeof existenteRow.config_paqueteria === 'object')
        ? existenteRow.config_paqueteria
        : {};
    const configPaqueteriaEfectiva = normalizarConfigPaqueteria(
        (payload.config_paqueteria && typeof payload.config_paqueteria === 'object')
            ? { ...configPaqueteriaPrev, ...payload.config_paqueteria }
            : configPaqueteriaPrev
    );

    const diccionarioTextosPrev = (existenteRow?.diccionario_textos && typeof existenteRow.diccionario_textos === 'object' && !Array.isArray(existenteRow.diccionario_textos))
        ? existenteRow.diccionario_textos
        : {};
    const diccionarioTextosEfectivo = (payload.diccionario_textos && typeof payload.diccionario_textos === 'object' && !Array.isArray(payload.diccionario_textos))
        ? { ...diccionarioTextosPrev, ...payload.diccionario_textos }
        : diccionarioTextosPrev;

    const plantillaOrigenIdEfectiva = payload.plantilla_origen_id !== undefined
        ? (payload.plantilla_origen_id ? Number(payload.plantilla_origen_id) : null)
        : (existenteRow?.plantilla_origen_id ? Number(existenteRow.plantilla_origen_id) : null);

    const alicuotaIvaMargenEfectiva = payload.alicuota_iva_margen_pct !== undefined
        ? normalizarAlicuotaFiscalNodo(payload.alicuota_iva_margen_pct, 21)
        : normalizarAlicuotaFiscalNodo(existenteRow?.alicuota_iva_margen_pct, 21);
    const alicuotaIibbMargenEfectiva = payload.alicuota_iibb_margen_pct !== undefined
        ? normalizarAlicuotaFiscalNodo(payload.alicuota_iibb_margen_pct, 4)
        : normalizarAlicuotaFiscalNodo(existenteRow?.alicuota_iibb_margen_pct, 4);

    const subtituloDefaultPerfil = perfilOperativoEfectivo === 'ecommerce_fulfillment'
        ? 'Alimentos Naturales y Frutos Secos · Envíos a Todo el País'
        : 'Comunidad Barrial - Entrega Fresca';

    const limpiarLogoOriginal = Boolean(payload.limpiar_logo_original);
    const logoOriginalEfectivo = limpiarLogoOriginal
        ? null
        : (payload.logo_original_base64 || existenteRow?.logo_original_base64 || null);

    // Convertir o regenerar el logo a ZPL ^GFA si se envió imagen o configuración
    const zplConfigPrev = (existenteRow?.logo_zpl_config && typeof existenteRow.logo_zpl_config === 'object') ? existenteRow.logo_zpl_config : {};
    const zplConfig = (payload.logo_zpl_config && typeof payload.logo_zpl_config === 'object')
        ? { ...zplConfigPrev, ...payload.logo_zpl_config }
        : zplConfigPrev;
    const widthZplReq = Number(zplConfig.width || 112);
    const heightZplReq = Number(zplConfig.height || 56);
    const bajadaMarcaEfectiva = payload.bajada_marca !== undefined
        ? (String(payload.bajada_marca || '').trim() || null)
        : (existenteRow?.bajada_marca ?? null);
    const slugHistoricoEfectivo = payload.slug_historico !== undefined
        ? (String(payload.slug_historico || '').trim() || null)
        : (existenteRow?.slug_historico ?? null);
    const temaVisualPrev = (existenteRow?.tema_visual && typeof existenteRow.tema_visual === 'object') ? existenteRow.tema_visual : {};
    const temaVisualEfectivo = (payload.tema_visual && typeof payload.tema_visual === 'object')
        ? {
            ...temaVisualPrev,
            ...payload.tema_visual,
            paleta: { ...(temaVisualPrev.paleta || {}), ...(payload.tema_visual.paleta || {}) },
            tipografia: { ...(temaVisualPrev.tipografia || {}), ...(payload.tema_visual.tipografia || {}) },
            logos: { ...(temaVisualPrev.logos || {}), ...(payload.tema_visual.logos || {}) }
        }
        : temaVisualPrev;

    const conversionLogo = await convertirLogoAZplGfa({
        imageBase64: logoOriginalEfectivo,
        nombreMarca,
        iniciales: zplConfig.iniciales || '',
        width: widthZplReq,
        height: heightZplReq,
        threshold: zplConfig.threshold || (logoOriginalEfectivo ? 180 : 138),
        mode: zplConfig.mode || 'threshold',
        padding: zplConfig.padding,
        invert: Boolean(zplConfig.invert)
    });

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        let codigoNodo = String(payload.codigo_nodo || existenteRow?.codigo_nodo || '').trim();
        if (!codigoNodo && !idExistente) {
            const maxRes = await client.query(`
                SELECT GREATEST(
                    COUNT(*)::int,
                    COALESCE(MAX(CASE WHEN codigo_nodo ~ '^NODO-[0-9]+$' THEN CAST(SUBSTRING(codigo_nodo FROM 6) AS INTEGER) ELSE 0 END), 0)
                ) AS base_num
                FROM public.nodos_maestro
            `);
            codigoNodo = `NODO-${String(Number(maxRes.rows[0]?.base_num || 0) + 1).padStart(3, '0')}`;
        }

        const vinculoContable = await asegurarVinculoContableNodo(client, {
            ...payload,
            codigo_bunker_cliente: payload.codigo_bunker_cliente || existenteRow?.codigo_bunker_cliente || null,
            codigo_nodo: codigoNodo || `NODO-${idExistente}`,
            nombre_marca: nombreMarca,
            gestor_nombre: gestorNombre
        });

        const ventanas = Array.isArray(payload.config_ventanas_corte) && payload.config_ventanas_corte.length > 0
            ? payload.config_ventanas_corte
            : (Array.isArray(existenteRow?.config_ventanas_corte) && existenteRow.config_ventanas_corte.length > 0
                ? existenteRow.config_ventanas_corte
                : [{ dia_entrega: 'Miércoles', cierre_dia: 'Martes', cierre_hora: '14:00', ventana_retiro: '17:00 a 20:00 hs' }]);

        // Consultar la configuración compartida de cuenta recaudadora del Canal Nodos
        const cfgCanalRes = await client.query('SELECT * FROM public.nodos_configuracion_canal WHERE id = 1');
        const cfgCanal = cfgCanalRes.rows[0] || {
            cuenta_bancaria_id: 1,
            banco_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.banco_recaudador,
            alias_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.alias_recaudador,
            cbu_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.cbu_recaudador,
            titular_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.titular_recaudador,
            cuil_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.cuil_recaudador,
            numero_cuenta_recaudador: pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.numero_cuenta_recaudador
        };

        const usaCuentaCompartida = payload.usa_cuenta_compartida !== undefined ? Boolean(payload.usa_cuenta_compartida) : true;
        let aliasEfectivo = String(payload.alias_bancario_display || '').trim();
        let cbuEfectivo = String(payload.cbu_display || '').trim();
        let titularEfectivo = String(payload.titular_display || '').trim();
        let cuentaBancariaIdEfectiva = payload.cuenta_bancaria_id ? Number(payload.cuenta_bancaria_id) : (cfgCanal.cuenta_bancaria_id || null);

        if (usaCuentaCompartida || !aliasEfectivo) {
            aliasEfectivo = cfgCanal.alias_recaudador || pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.alias_recaudador;
            cbuEfectivo = cfgCanal.cbu_recaudador || cbuEfectivo || pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.cbu_recaudador;
            titularEfectivo = cfgCanal.titular_recaudador || titularEfectivo || pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.titular_recaudador;
            cuentaBancariaIdEfectiva = cfgCanal.cuenta_bancaria_id || 1;
        }

        let gestorTokenCandidato = (existenteRow?.gestor_token && String(existenteRow.gestor_token).trim().length >= 16)
            ? String(existenteRow.gestor_token).trim()
            : (payload.gestor_token && String(payload.gestor_token).trim().length >= 16
                ? String(payload.gestor_token).trim()
                : '');
        if (gestorTokenCandidato && !idExistente) {
            const chkTok = await client.query(
                'SELECT id FROM public.nodos_maestro WHERE gestor_token = $1 LIMIT 1',
                [gestorTokenCandidato]
            );
            if (chkTok.rows.length > 0) {
                gestorTokenCandidato = '';
            }
        }
        const gestorTokenEfectivo = gestorTokenCandidato || generarGestorTokenNodo();

        const latVal = payload.latitud !== undefined && payload.latitud !== null && payload.latitud !== ''
            ? Number(payload.latitud)
            : null;
        const lngVal = payload.longitud !== undefined && payload.longitud !== null && payload.longitud !== ''
            ? Number(payload.longitud)
            : null;
        const usarCuentaMadreUnificada = payload.usar_cuenta_madre_unificada !== undefined
            ? Boolean(payload.usar_cuenta_madre_unificada)
            : (existenteRow ? Boolean(existenteRow.usar_cuenta_madre_unificada) : false);

        if (usarCuentaMadreUnificada && !vinculoContable.cliente_madre_bunker_id) {
            throw new Error('Para activar Cuenta Madre Unificada debe seleccionar un Cliente Titular Madre válido.');
        }

        let nodoGuardado;
        if (idExistente) {
            const upd = await client.query(
                `UPDATE public.nodos_maestro SET
                    slug = $1,
                    nombre_marca = $2,
                    subtitulo_marca = $3,
                    gestor_nombre = $4,
                    gestor_telefono = $5,
                    gestor_email = $6,
                    barrio_zona = $7,
                    direccion_retiro = $8,
                    bunker_cliente_id = $9,
                    codigo_bunker_cliente = $10,
                    cliente_madre_bunker_id = $11,
                    codigo_bunker_cliente_madre = $12,
                    usar_cuenta_madre_unificada = $39,
                    cuenta_bancaria_id = $13,
                    usa_cuenta_compartida = $14,
                    alias_bancario_display = $15,
                    cbu_display = $16,
                    titular_display = $17,
                    permitir_envio_barrial = $18,
                    permitir_retiro_nodo = $33,
                    permitir_reparto_propio = $34,
                    permitir_encomienda = $35,
                    cargo_envio_barrial = $19,
                    margen_gestor_default_pct = $20,
                    config_ventanas_corte = $21,
                    color_primario = $22,
                    logo_original_base64 = $23,
                    logo_mono_preview_base64 = $24,
                    logo_zpl_gfa = $25,
                    logo_zpl_config = $26,
                    activo = COALESCE($27, activo),
                    latitud = $28,
                    longitud = $29,
                    mostrar_ingredientes_tienda = COALESCE($30, mostrar_ingredientes_tienda),
                    gestor_token = COALESCE(NULLIF(TRIM(gestor_token), ''), $31),
                    bajada_marca = $36,
                    slug_historico = $37,
                    tema_visual = $38::jsonb,
                    perfil_operativo = $40,
                    modulos_activos = $41::jsonb,
                    config_paqueteria = $42::jsonb,
                    diccionario_textos = $43::jsonb,
                    plantilla_origen_id = $44,
                    alicuota_iva_margen_pct = $45,
                    alicuota_iibb_margen_pct = $46,
                    cobro_efectivo_entrega = $47,
                    updated_at = NOW()
                WHERE id = $32
                RETURNING *`,
                [
                    slugBase,
                    nombreMarca,
                    payload.subtitulo_marca || bajadaMarcaEfectiva || subtituloDefaultPerfil,
                    gestorNombre,
                    payload.gestor_telefono || '',
                    payload.gestor_email || '',
                    payload.barrio_zona || '',
                    payload.direccion_retiro || '',
                    vinculoContable.bunker_cliente_id,
                    vinculoContable.codigo_bunker_cliente,
                    vinculoContable.cliente_madre_bunker_id,
                    vinculoContable.codigo_bunker_cliente_madre,
                    cuentaBancariaIdEfectiva,
                    usaCuentaCompartida,
                    aliasEfectivo,
                    cbuEfectivo,
                    titularEfectivo,
                    permitirReparto,
                    Number(payload.cargo_envio_barrial || 0),
                    Number(payload.margen_gestor_default_pct || 28),
                    JSON.stringify(ventanas),
                    payload.color_primario || existenteRow?.color_primario || '#a2553b',
                    logoOriginalEfectivo,
                    conversionLogo.logo_mono_preview_base64,
                    conversionLogo.logo_zpl_gfa,
                    JSON.stringify({
                        width: conversionLogo.width,
                        height: conversionLogo.height,
                        threshold: conversionLogo.threshold,
                        mode: conversionLogo.mode,
                        invert: conversionLogo.invert,
                        padding: zplConfig.padding,
                        modo_cabecera: zplConfig.modo_cabecera || (conversionLogo.width >= 180 ? 'banner_completo' : undefined),
                        iniciales: zplConfig.iniciales || ''
                    }),
                    payload.activo !== undefined ? Boolean(payload.activo) : (existenteRow ? existenteRow.activo !== false : true),
                    Number.isFinite(latVal) ? latVal : null,
                    Number.isFinite(lngVal) ? lngVal : null,
                    payload.mostrar_ingredientes_tienda !== undefined ? Boolean(payload.mostrar_ingredientes_tienda) : null,
                    gestorTokenEfectivo,
                    Number(idExistente),
                    permitirRetiro,
                    permitirReparto,
                    permitirEncomienda,
                    bajadaMarcaEfectiva,
                    slugHistoricoEfectivo,
                    JSON.stringify(temaVisualEfectivo || {}),
                    usarCuentaMadreUnificada,
                    perfilOperativoEfectivo,
                    JSON.stringify(modulosActivosEfectivos),
                    JSON.stringify(configPaqueteriaEfectiva),
                    JSON.stringify(diccionarioTextosEfectivo),
                    plantillaOrigenIdEfectiva,
                    alicuotaIvaMargenEfectiva,
                    alicuotaIibbMargenEfectiva,
                    cobroEfectivoEntregaEfectivo
                ]
            );
            nodoGuardado = upd.rows[0];

            // Si cambiaron las alícuotas fiscales del Nodo, resincronizar ganancia_unitaria_gestor de sus ofertas manteniendo precio_venta_vecino
            const cambioFiscal = existenteRow && (
                Math.abs(Number(existenteRow.alicuota_iva_margen_pct ?? 21) - alicuotaIvaMargenEfectiva) >= 0.01 ||
                Math.abs(Number(existenteRow.alicuota_iibb_margen_pct ?? 4) - alicuotaIibbMargenEfectiva) >= 0.01
            );
            if (cambioFiscal) {
                const ofsNodo = await client.query(
                    `SELECT nog.id, nog.precio_venta_vecino,
                            COALESCE(nac.precio_base_nodo_final, nog.precio_base_nodo_snapshot, 0) AS base_efectiva
                     FROM public.nodos_ofertas_gestor nog
                     LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
                     WHERE nog.nodo_id = $1 FOR UPDATE OF nog`,
                    [nodoGuardado.id]
                );
                for (const ofItem of ofsNodo.rows) {
                    const calcNuevaGan = calcularPrecioYGananciaNetaOfertaNodo({
                        costoBaseLamda: ofItem.base_efectiva,
                        precioTienda: ofItem.precio_venta_vecino,
                        ivaPct: alicuotaIvaMargenEfectiva,
                        iibbPct: alicuotaIibbMargenEfectiva,
                        modo: 'precio'
                    });
                    await client.query(
                        `UPDATE public.nodos_ofertas_gestor
                         SET ganancia_unitaria_gestor = $2,
                             margen_gestor_pct = $3,
                             updated_at = NOW()
                         WHERE id = $1`,
                        [ofItem.id, calcNuevaGan.ganancia_neta_nodo, calcNuevaGan.margen_pct]
                    );
                }
            }
        } else {
            const ins = await client.query(
                `INSERT INTO public.nodos_maestro (
                    codigo_nodo, slug, nombre_marca, subtitulo_marca,
                    gestor_nombre, gestor_telefono, gestor_email, barrio_zona, direccion_retiro,
                    bunker_cliente_id, codigo_bunker_cliente, cliente_madre_bunker_id, codigo_bunker_cliente_madre,
                    usar_cuenta_madre_unificada,
                    cuenta_bancaria_id, usa_cuenta_compartida,
                    alias_bancario_display, cbu_display, titular_display,
                    permitir_envio_barrial, permitir_retiro_nodo, permitir_reparto_propio, permitir_encomienda,
                    cargo_envio_barrial, margen_gestor_default_pct,
                    config_ventanas_corte, color_primario,
                    logo_original_base64, logo_mono_preview_base64, logo_zpl_gfa, logo_zpl_config,
                    latitud, longitud, mostrar_ingredientes_tienda, gestor_token,
                    bajada_marca, slug_historico, tema_visual,
                    perfil_operativo, modulos_activos, config_paqueteria, diccionario_textos, plantilla_origen_id,
                    alicuota_iva_margen_pct, alicuota_iibb_margen_pct, cobro_efectivo_entrega
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$38,$14,$15,$16,$17,$18,$19,$32,$33,$34,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$35,$36,$37::jsonb,$39,$40::jsonb,$41::jsonb,$42::jsonb,$43,$44,$45,$46
                ) RETURNING *`,
                [
                    codigoNodo,
                    slugBase,
                    nombreMarca,
                    payload.subtitulo_marca || bajadaMarcaEfectiva || subtituloDefaultPerfil,
                    gestorNombre,
                    payload.gestor_telefono || '',
                    payload.gestor_email || '',
                    payload.barrio_zona || '',
                    payload.direccion_retiro || '',
                    vinculoContable.bunker_cliente_id,
                    vinculoContable.codigo_bunker_cliente,
                    vinculoContable.cliente_madre_bunker_id,
                    vinculoContable.codigo_bunker_cliente_madre,
                    cuentaBancariaIdEfectiva,
                    usaCuentaCompartida,
                    aliasEfectivo,
                    cbuEfectivo,
                    titularEfectivo,
                    permitirReparto,
                    Number(payload.cargo_envio_barrial || 0),
                    Number(payload.margen_gestor_default_pct || 28),
                    JSON.stringify(ventanas),
                    payload.color_primario || existenteRow?.color_primario || '#a2553b',
                    logoOriginalEfectivo,
                    conversionLogo.logo_mono_preview_base64,
                    conversionLogo.logo_zpl_gfa,
                    JSON.stringify({
                        width: conversionLogo.width,
                        height: conversionLogo.height,
                        threshold: conversionLogo.threshold,
                        mode: conversionLogo.mode,
                        invert: conversionLogo.invert,
                        padding: zplConfig.padding,
                        modo_cabecera: zplConfig.modo_cabecera || (conversionLogo.width >= 180 ? 'banner_completo' : undefined),
                        iniciales: zplConfig.iniciales || ''
                    }),
                    Number.isFinite(latVal) ? latVal : null,
                    Number.isFinite(lngVal) ? lngVal : null,
                    payload.mostrar_ingredientes_tienda !== false,
                    gestorTokenEfectivo,
                    permitirRetiro,
                    permitirReparto,
                    permitirEncomienda,
                    bajadaMarcaEfectiva,
                    slugHistoricoEfectivo,
                    JSON.stringify(temaVisualEfectivo || {}),
                    usarCuentaMadreUnificada,
                    perfilOperativoEfectivo,
                    JSON.stringify(modulosActivosEfectivos),
                    JSON.stringify(configPaqueteriaEfectiva),
                    JSON.stringify(diccionarioTextosEfectivo),
                    plantillaOrigenIdEfectiva,
                    alicuotaIvaMargenEfectiva,
                    alicuotaIibbMargenEfectiva,
                    cobroEfectivoEntregaEfectivo
                ]
            );
            nodoGuardado = ins.rows[0];

            // Vincular automáticamente el catálogo activo al nuevo Nodo con su margen por defecto y ganancia limpia post-impuestos
            const catActivos = await client.query('SELECT id, precio_base_nodo_final FROM public.nodos_articulos_catalogo WHERE activo = true');
            const margenDef = Number(nodoGuardado.margen_gestor_default_pct || 28);
            for (const c of catActivos.rows) {
                const base = Number(c.precio_base_nodo_final || 0);
                const calcNuevo = calcularPrecioYGananciaNetaOfertaNodo({
                    costoBaseLamda: base,
                    margenPct: margenDef,
                    ivaPct: alicuotaIvaMargenEfectiva,
                    iibbPct: alicuotaIibbMargenEfectiva,
                    modo: 'margen'
                });
                const chkOf = await client.query(
                    `SELECT id FROM public.nodos_ofertas_gestor WHERE nodo_id = $1 AND articulo_catalogo_id = $2 LIMIT 1 FOR UPDATE`,
                    [nodoGuardado.id, c.id]
                );
                if (chkOf.rows.length === 0) {
                    await client.query(
                        `INSERT INTO public.nodos_ofertas_gestor (
                            nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                            margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor, publicado_tienda
                        ) VALUES ($1,$2,$3,$4,$5,$6,true)`,
                        [nodoGuardado.id, c.id, base, calcNuevo.margen_pct, calcNuevo.precio_tienda, calcNuevo.ganancia_neta_nodo]
                    );
                }
            }
        }

        // Vincular el Nodo con la Lista Base Nodos Barriales en nodos_maestro y bunker_cliente_listas_precios
        const listaNodosRes = await client.query(
            `SELECT id FROM public.bunker_listas_precios WHERE canal_comercial = 'NODOS' OR LOWER(nombre) LIKE '%nodos barriales%' ORDER BY id ASC LIMIT 1`
        );
        if (listaNodosRes.rows.length > 0 && nodoGuardado) {
            const listaNodosId = listaNodosRes.rows[0].id;
            await client.query(
                `UPDATE public.nodos_maestro SET lista_precio_bunker_id = $1 WHERE id = $2`,
                [listaNodosId, nodoGuardado.id]
            );
            nodoGuardado.lista_precio_bunker_id = listaNodosId;

            if (nodoGuardado.bunker_cliente_id) {
                const checkClp = await client.query(
                    `SELECT id FROM public.bunker_cliente_listas_precios WHERE bunker_cliente_id = $1 AND bunker_lista_precio_id = $2 LIMIT 1`,
                    [nodoGuardado.bunker_cliente_id, listaNodosId]
                );
                if (checkClp.rows.length === 0) {
                    await client.query(
                        `INSERT INTO public.bunker_cliente_listas_precios (bunker_cliente_id, bunker_lista_precio_id) VALUES ($1, $2)`,
                        [nodoGuardado.bunker_cliente_id, listaNodosId]
                    );
                }
            }
        }

        if (nodoGuardado && nodoGuardado.id) {
            await sincronizarArchivoYConsolidacionSubcuentaNodo(client, nodoGuardado.id);
        }

        await client.query('COMMIT');
        await sincronizarNodosConCircuitoOperativoLamda();
        return nodoGuardado;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Clona en 1 clic la configuración operativa de una tienda/marca existente (ej. MANSO o Paraíso)
 * hacia una nueva marca con identidad propia y titular contable aislado.
 * NUNCA copia fotos caseras privadas ni cuentas contables ni tokens de acceso.
 */
async function clonarNodoMaestro(origenId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const oid = Number(origenId || 0);
    if (!Number.isFinite(oid) || oid <= 0) {
        throw new Error('Identificador de tienda plantilla inválido.');
    }

    const oriRes = await db.query('SELECT * FROM public.nodos_maestro WHERE id = $1 LIMIT 1', [oid]);
    if (oriRes.rows.length === 0) {
        const err = new Error('No se encontró la tienda plantilla seleccionada para clonar.');
        err.statusCode = 404;
        throw err;
    }
    const origen = oriRes.rows[0];

    const nombreMarcaNueva = String(payload.nombre_marca || '').trim();
    const gestorNombreNuevo = String(payload.gestor_nombre || '').trim();
    if (!nombreMarcaNueva || !gestorNombreNuevo) {
        throw new Error('Debés indicar el nombre de la nueva marca y el nombre de su creador/referente.');
    }
    if (!payload.cliente_madre_bunker_id && !payload.codigo_bunker_cliente_madre) {
        throw new Error('Debés seleccionar el Cliente Titular propio en el padrón Búnker para la nueva marca.');
    }

    const slugCandidato = String(payload.slug || nombreMarcaNueva)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!slugCandidato || slugCandidato === String(origen.slug || '').toLowerCase()) {
        throw new Error('El identificador URL (slug) de la nueva tienda debe ser único y distinto al de la plantilla.');
    }
    const chkSlug = await db.query(
        'SELECT id, nombre_marca FROM public.nodos_maestro WHERE LOWER(slug) = LOWER($1) LIMIT 1',
        [slugCandidato]
    );
    if (chkSlug.rows.length > 0) {
        throw new Error(`El slug "/tienda/${slugCandidato}" ya está en uso por "${chkSlug.rows[0].nombre_marca}".`);
    }

    const perfilHeredado = payload.perfil_operativo !== undefined
        ? normalizarPerfilOperativoNodo(payload.perfil_operativo)
        : normalizarPerfilOperativoNodo(origen.perfil_operativo);
    const modulosHeredados = resolverModulosActivosNodo(
        {
            perfil_operativo: perfilHeredado,
            modulos_activos: origen.modulos_activos,
            cobro_efectivo_entrega: origen.cobro_efectivo_entrega,
            permitir_retiro_nodo: origen.permitir_retiro_nodo,
            permitir_reparto_propio: origen.permitir_reparto_propio,
            permitir_envio_barrial: origen.permitir_envio_barrial,
            permitir_encomienda: origen.permitir_encomienda
        },
        (payload.modulos_activos && typeof payload.modulos_activos === 'object') ? payload.modulos_activos : null
    );
    const configPaqHeredada = normalizarConfigPaqueteria(
        (payload.config_paqueteria && typeof payload.config_paqueteria === 'object')
            ? { ...(origen.config_paqueteria || {}), ...payload.config_paqueteria }
            : (origen.config_paqueteria || {})
    );
    const dicTextosHeredado = {
        ...((origen.diccionario_textos && typeof origen.diccionario_textos === 'object') ? origen.diccionario_textos : {}),
        ...((payload.diccionario_textos && typeof payload.diccionario_textos === 'object') ? payload.diccionario_textos : {})
    };

    const temaOrigen = (origen.tema_visual && typeof origen.tema_visual === 'object') ? origen.tema_visual : {};
    const temaNuevo = {
        ...(temaOrigen.tipografia ? { tipografia: { ...temaOrigen.tipografia } } : {}),
        ...((payload.tema_visual && typeof payload.tema_visual === 'object') ? payload.tema_visual : {}),
        logo_incluye_texto: Boolean(payload.tema_visual?.logo_incluye_texto),
        logos: (payload.tema_visual?.logos && typeof payload.tema_visual.logos === 'object')
            ? { ...payload.tema_visual.logos }
            : {}
    };

    const nodoCreado = await guardarNodoMaestro({
        nombre_marca: nombreMarcaNueva,
        slug: slugCandidato,
        bajada_marca: payload.bajada_marca !== undefined ? payload.bajada_marca : null,
        subtitulo_marca: payload.subtitulo_marca || (perfilHeredado === 'ecommerce_fulfillment'
            ? 'Alimentos Naturales y Frutos Secos · Envíos a Todo el País'
            : (origen.subtitulo_marca || 'Comunidad Barrial - Entrega Fresca')),
        gestor_nombre: gestorNombreNuevo,
        gestor_telefono: payload.gestor_telefono || '',
        gestor_email: payload.gestor_email || '',
        barrio_zona: payload.barrio_zona !== undefined ? payload.barrio_zona : '',
        direccion_retiro: payload.direccion_retiro !== undefined ? payload.direccion_retiro : '',
        latitud: payload.latitud ?? null,
        longitud: payload.longitud ?? null,
        cliente_madre_bunker_id: payload.cliente_madre_bunker_id,
        codigo_bunker_cliente_madre: payload.codigo_bunker_cliente_madre,
        usar_cuenta_madre_unificada: payload.usar_cuenta_madre_unificada !== undefined
            ? Boolean(payload.usar_cuenta_madre_unificada)
            : Boolean(origen.usar_cuenta_madre_unificada),
        usa_cuenta_compartida: payload.usa_cuenta_compartida !== undefined
            ? Boolean(payload.usa_cuenta_compartida)
            : (origen.usa_cuenta_compartida !== false),
        alias_bancario_display: payload.alias_bancario_display || '',
        permitir_retiro_nodo: Boolean(modulosHeredados.retiro_punto),
        permitir_reparto_propio: Boolean(modulosHeredados.reparto_zonal),
        permitir_envio_barrial: Boolean(modulosHeredados.reparto_zonal),
        permitir_encomienda: Boolean(modulosHeredados.envio_paqueteria),
        cargo_envio_barrial: payload.cargo_envio_barrial !== undefined
            ? Number(payload.cargo_envio_barrial || 0)
            : Number(origen.cargo_envio_barrial || 0),
        margen_gestor_default_pct: payload.margen_gestor_default_pct !== undefined
            ? Number(payload.margen_gestor_default_pct || 28)
            : Number(origen.margen_gestor_default_pct || 28),
        config_ventanas_corte: Array.isArray(payload.config_ventanas_corte) && payload.config_ventanas_corte.length > 0
            ? payload.config_ventanas_corte
            : origen.config_ventanas_corte,
        mostrar_ingredientes_tienda: payload.mostrar_ingredientes_tienda !== undefined
            ? Boolean(payload.mostrar_ingredientes_tienda)
            : (origen.mostrar_ingredientes_tienda !== false),
        color_primario: payload.color_primario || origen.color_primario || '#a2553b',
        logo_original_base64: payload.logo_original_base64 || null,
        logo_zpl_config: payload.logo_zpl_config || {
            mode: 'threshold',
            width: 112,
            height: 56,
            invert: false,
            iniciales: nombreMarcaNueva.slice(0, 2).toUpperCase(),
            threshold: 150
        },
        tema_visual: temaNuevo,
        perfil_operativo: perfilHeredado,
        modulos_activos: modulosHeredados,
        config_paqueteria: configPaqHeredada,
        diccionario_textos: dicTextosHeredado,
        plantilla_origen_id: origen.id,
        alicuota_iva_margen_pct: payload.alicuota_iva_margen_pct !== undefined
            ? normalizarAlicuotaFiscalNodo(payload.alicuota_iva_margen_pct, 21)
            : normalizarAlicuotaFiscalNodo(origen.alicuota_iva_margen_pct, 21),
        alicuota_iibb_margen_pct: payload.alicuota_iibb_margen_pct !== undefined
            ? normalizarAlicuotaFiscalNodo(payload.alicuota_iibb_margen_pct, 4)
            : normalizarAlicuotaFiscalNodo(origen.alicuota_iibb_margen_pct, 4)
    }, null);

    // Sincronizar opcionalmente la selección de ofertas publicadas y % de margen (NUNCA fotos caseras privadas)
    const clonarOfertas = payload.clonar_ofertas_margenes !== false;
    let ofertasSincronizadas = 0;
    if (clonarOfertas && nodoCreado?.id) {
        const ofOrigenRes = await db.query(
            `SELECT nog.articulo_catalogo_id, nog.margen_gestor_pct, nog.publicado_tienda,
                    nog.destacado_tienda, nog.mostrar_ingredientes,
                    nac.precio_base_nodo_final
             FROM public.nodos_ofertas_gestor nog
             JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
             WHERE nog.nodo_id = $1 AND nac.activo = true`,
            [origen.id]
        );
        const mapaOrigen = new Map(ofOrigenRes.rows.map(r => [Number(r.articulo_catalogo_id), r]));

        for (const [catId, refOf] of mapaOrigen.entries()) {
            const base = Number(refOf.precio_base_nodo_final || 0);
            const margen = Number(refOf.margen_gestor_pct ?? nodoCreado.margen_gestor_default_pct ?? 28);
            const calcClon = calcularPrecioYGananciaNetaOfertaNodo({
                costoBaseLamda: base,
                margenPct: margen,
                ivaPct: nodoCreado.alicuota_iva_margen_pct ?? 21,
                iibbPct: nodoCreado.alicuota_iibb_margen_pct ?? 4,
                modo: 'margen'
            });
            const pVenta = calcClon.precio_tienda;
            const gan = calcClon.ganancia_neta_nodo;
            await db.query(
                `INSERT INTO public.nodos_ofertas_gestor (
                    nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                    margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor,
                    publicado_tienda, destacado_tienda, mostrar_ingredientes, fotos_vidriera
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]'::jsonb)
                 ON CONFLICT (nodo_id, articulo_catalogo_id) DO UPDATE SET
                    precio_base_nodo_snapshot = EXCLUDED.precio_base_nodo_snapshot,
                    margen_gestor_pct = EXCLUDED.margen_gestor_pct,
                    precio_venta_vecino = EXCLUDED.precio_venta_vecino,
                    ganancia_unitaria_gestor = EXCLUDED.ganancia_unitaria_gestor,
                    publicado_tienda = EXCLUDED.publicado_tienda,
                    destacado_tienda = EXCLUDED.destacado_tienda,
                    mostrar_ingredientes = EXCLUDED.mostrar_ingredientes,
                    fotos_vidriera = '[]'::jsonb,
                    updated_at = NOW()`,
                [
                    nodoCreado.id,
                    catId,
                    base,
                    margen,
                    pVenta,
                    gan,
                    Boolean(refOf.publicado_tienda),
                    Boolean(refOf.destacado_tienda),
                    refOf.mostrar_ingredientes !== false
                ]
            );
            ofertasSincronizadas++;
        }

        if (mapaOrigen.size > 0) {
            await db.query(
                `UPDATE public.nodos_ofertas_gestor
                 SET publicado_tienda = false, updated_at = NOW()
                 WHERE nodo_id = $1
                   AND NOT (articulo_catalogo_id = ANY($2::int[]))`,
                [nodoCreado.id, Array.from(mapaOrigen.keys())]
            );
        }
    }

    return {
        nodo: nodoCreado,
        plantilla_origen: {
            id: origen.id,
            codigo_nodo: origen.codigo_nodo,
            slug: origen.slug,
            nombre_marca: origen.nombre_marca,
            perfil_operativo: normalizarPerfilOperativoNodo(origen.perfil_operativo)
        },
        ofertas_sincronizadas: ofertasSincronizadas
    };
}

/**
 * Actualiza la Configuración Compartida de Cuenta Recaudadora del Canal Nodos (Marca Blanca)
 * y propaga automáticamente el nuevo Alias/CBU/Titular a todos los Nodos que usan cuenta compartida.
 */
async function actualizarConfiguracionCuentaCanalNodos(payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const aliasRecaudador = String(payload.alias_recaudador || '').trim();
    if (!aliasRecaudador) {
        throw new Error('El alias recaudador compartido del canal Nodos no puede estar vacío.');
    }

    const bancoRecaudador = String(payload.banco_recaudador || pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.banco_recaudador).trim();
    const cbuRecaudador = String(payload.cbu_recaudador || pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.cbu_recaudador).trim();
    const titularRecaudador = String(payload.titular_recaudador || pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.titular_recaudador).trim();
    const cuilRecaudador = String(payload.cuil_recaudador || pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.cuil_recaudador).trim();
    const numeroCuentaRecaudador = String(payload.numero_cuenta_recaudador || pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT.numero_cuenta_recaudador).trim();
    const soloTransferencia = payload.solo_transferencia_bancaria !== undefined ? Boolean(payload.solo_transferencia_bancaria) : true;
    const cuentaBancariaId = payload.cuenta_bancaria_id ? Number(payload.cuenta_bancaria_id) : 1;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        let cfgRes = await client.query(
            `UPDATE public.nodos_configuracion_canal SET
                cuenta_bancaria_id = $1,
                banco_recaudador = $2,
                alias_recaudador = $3,
                cbu_recaudador = $4,
                titular_recaudador = $5,
                cuil_recaudador = $6,
                numero_cuenta_recaudador = $7,
                solo_transferencia_bancaria = $8,
                updated_at = NOW()
             WHERE id = 1
             RETURNING *`,
            [cuentaBancariaId, bancoRecaudador, aliasRecaudador, cbuRecaudador, titularRecaudador, cuilRecaudador, numeroCuentaRecaudador, soloTransferencia]
        );
        if (cfgRes.rowCount === 0) {
            cfgRes = await client.query(
                `INSERT INTO public.nodos_configuracion_canal (
                    id, cuenta_bancaria_id, banco_recaudador, alias_recaudador, cbu_recaudador,
                    titular_recaudador, cuil_recaudador, numero_cuenta_recaudador, solo_transferencia_bancaria, updated_at
                ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, NOW())
                RETURNING *`,
                [cuentaBancariaId, bancoRecaudador, aliasRecaudador, cbuRecaudador, titularRecaudador, cuilRecaudador, numeroCuentaRecaudador, soloTransferencia]
            );
        }

        const updNodos = await client.query(
            `UPDATE public.nodos_maestro
             SET alias_bancario_display = $1,
                 cbu_display = $2,
                 titular_display = $3,
                 cuenta_bancaria_id = $4,
                 banco_display = $5,
                 cuil_display = $6,
                 numero_cuenta_display = $7,
                 updated_at = NOW()
             WHERE COALESCE(usa_cuenta_compartida, true) = true
             RETURNING id, codigo_nodo, nombre_marca, alias_bancario_display`,
            [aliasRecaudador, cbuRecaudador, titularRecaudador, cuentaBancariaId, bancoRecaudador, cuilRecaudador, numeroCuentaRecaudador]
        );

        await client.query('COMMIT');
        return {
            config_cuenta_canal: cfgRes.rows[0],
            nodos_actualizados: updNodos.rows.length,
            nodos: updNodos.rows
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Registra una nueva propuesta de fracción solicitada por un Gestor de Nodo.
 * Valida determinísticamente que:
 *  - No esté ya cotizada en nodos_articulos_catalogo.
 *  - No sea una presentación estándar que LAMDA ya produce (salvo que se pida explícitamente habilitar esa presentación existente).
 *  - No exista ya una solicitud PENDIENTE_COTIZACION idéntica para ese mismo Nodo, ingrediente y gramaje.
 */
async function crearPropuestaFraccion(payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const nodoId = payload.nodo_solicitante_id ? Number(payload.nodo_solicitante_id) : null;
    const ingId = payload.ingrediente_sugerido_id ? Number(payload.ingrediente_sugerido_id) : null;
    const kilos = Math.max(0.01, Number(payload.kilos_sugeridos || 0.25));
    const esHabilitacionExistente = Boolean(payload.solicitar_habilitacion_existente === true);
    const aliasVidrieraSugerido = String(payload.alias_vidriera_sugerido || '').trim() || null;

    if (!ingId && !payload.articulo_bunker_sugerido_codigo) {
        throw new Error('Debés seleccionar un producto o ingrediente oficial de LAMDA para solicitar una fracción.');
    }

    let ingRow = null;
    if (ingId) {
        const ingRes = await db.query(
            `SELECT i.id, i.codigo, i.nombre, i.articulo_vinculado_numero,
                    ci.nombre AS categoria_lamda
             FROM public.ingredientes i
             LEFT JOIN public.categorias_ingredientes ci ON ci.id = i.categoria_id
             WHERE i.id = $1 AND COALESCE(i.es_insumo, false) = false
             LIMIT 1`,
            [ingId]
        );
        if (ingRes.rows.length === 0) {
            throw new Error('El ingrediente seleccionado no existe en el padrón oficial de LAMDA.');
        }
        ingRow = ingRes.rows[0];
    }

    const etPeso = kilos >= 1 ? `${Number(kilos.toFixed(2))} kg` : `${Math.round(kilos * 1000)}g`;
    const nombreOficialBase = ingRow
        ? `${formatearEtiquetaTecnicaIngrediente(ingRow)} x ${etPeso}`
        : String(payload.nombre_sugerido || '').trim();
    const nombreSugerido = nombreOficialBase || String(payload.nombre_sugerido || '').trim();
    if (!nombreSugerido) {
        throw new Error('No se pudo determinar la identidad técnica de la fracción solicitada.');
    }

    if (ingId) {
        // 1. Verificar si ya está cotizada en el Catálogo Base de Nodos
        const catExistRes = await db.query(
            `SELECT id, sku_nodo, nombre_publico, precio_base_nodo_final
             FROM public.nodos_articulos_catalogo
             WHERE activo = true
               AND ingrediente_origen_id = $1
               AND ABS(COALESCE(kilos_unidad, 0) - $2) < 0.003
             LIMIT 1`,
            [ingId, kilos]
        );
        if (catExistRes.rows.length > 0) {
            throw new Error(`Esta presentación ya está cotizada en el Catálogo Base de Nodos ([${catExistRes.rows[0].sku_nodo}] ${catExistRes.rows[0].nombre_publico}). Podés incorporarla o editarla desde Mi Oferta y Márgenes.`);
        }

        // 2. Verificar si ya existe una solicitud pendiente para el mismo Nodo, producto y gramaje
        if (nodoId) {
            const pendRes = await db.query(
                `SELECT codigo_propuesta
                 FROM public.nodos_propuestas_fracciones
                 WHERE nodo_solicitante_id = $1
                   AND ingrediente_sugerido_id = $2
                   AND estado = 'PENDIENTE_COTIZACION'
                   AND ABS(COALESCE(kilos_sugeridos, 0) - $3) < 0.003
                 LIMIT 1`,
                [nodoId, ingId, kilos]
            );
            if (pendRes.rows.length > 0) {
                throw new Error(`Ya tenés una solicitud en cotización (${pendRes.rows[0].codigo_propuesta}) para este mismo producto y gramaje.`);
            }
        }

        // 3. Verificar si LAMDA ya produce esta presentación unitaria en Planta / Búnker
        const anatomia = await resolverAnatomiaNativaArticuloNodo(db, {
            ingrediente_origen_id: ingId,
            kilos_unidad: kilos,
            flujo_lamda: Number(payload.flujo_sugerido || 2)
        });
        if (anatomia.existe_en_bunker && !esHabilitacionExistente) {
            throw new Error(`LAMDA ya produce esta presentación ([${anatomia.sku_nativo}] ${anatomia.nomenclatura_bunker || etPeso}). No corresponde pedirla como nueva fracción a crear; elegí otro gramaje nuevo o solicitá habilitar la presentación existente.`);
        }
        if (anatomia.existe_en_bunker && esHabilitacionExistente) {
            payload.articulo_bunker_sugerido_codigo = anatomia.sku_nativo;
            if (!payload.insumo_envase_sugerido_id && anatomia.insumo_envase_id) {
                payload.insumo_envase_sugerido_id = anatomia.insumo_envase_id;
            }
        }
    }

    const maxRes = await db.query(`
        SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(codigo_propuesta, '[^0-9]', '', 'g'), '')::int), 0) AS max_num
        FROM public.nodos_propuestas_fracciones
    `);
    const codigoPropuesta = `PROP-NB-${String(Number(maxRes.rows[0].max_num || 0) + 1).padStart(3, '0')}`;
    const categoriaOficial = String(payload.categoria_sugerida || ingRow?.categoria_lamda || 'Frutos Secos').trim();

    const ins = await db.query(
        `INSERT INTO public.nodos_propuestas_fracciones (
            codigo_propuesta, nodo_solicitante_id, nombre_sugerido, alias_vidriera_sugerido,
            categoria_sugerida, flujo_sugerido, ingrediente_sugerido_id, articulo_bunker_sugerido_codigo,
            kilos_sugeridos, insumo_envase_sugerido_id, segundos_estimados,
            precio_objetivo_vecino, comentario_gestor, estado
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDIENTE_COTIZACION')
        RETURNING *`,
        [
            codigoPropuesta,
            nodoId,
            nombreSugerido,
            aliasVidrieraSugerido,
            categoriaOficial,
            Number(payload.flujo_sugerido || 2),
            ingId,
            payload.articulo_bunker_sugerido_codigo || null,
            kilos,
            payload.insumo_envase_sugerido_id ? Number(payload.insumo_envase_sugerido_id) : null,
            Number(payload.segundos_estimados || 35),
            payload.precio_objetivo_vecino ? Number(payload.precio_objetivo_vecino) : null,
            payload.comentario_gestor || ''
        ]
    );

    return ins.rows[0];
}

/**
 * Anula una solicitud pendiente desde el celular del Gestor (liberando ese gramaje)
 * o descarta una solicitud pendiente desde Administración de LAMDA.
 */
async function anularODescartarPropuestaFraccion(propuestaId, opciones = {}) {
    await asegurarEsquemaNodosBarriales();

    const pId = Number(propuestaId);
    if (!pId) {
        throw new Error('Identificador de solicitud inválido.');
    }

    const propRes = await db.query(
        'SELECT * FROM public.nodos_propuestas_fracciones WHERE id = $1 LIMIT 1',
        [pId]
    );
    if (propRes.rows.length === 0) {
        throw new Error('La solicitud seleccionada no existe.');
    }
    const prop = propRes.rows[0];

    if (prop.estado === 'APROBADA') {
        throw new Error('Esta solicitud ya fue cotizada y aprobada en el Catálogo Base; no puede anularse.');
    }

    const origen = String(opciones.origen || 'GESTOR').toUpperCase();
    if (origen === 'GESTOR') {
        let nodoId = Number(opciones.nodo_id || 0);
        const nodoSlug = String(opciones.nodo_slug || '').trim().toLowerCase();
        if (!nodoId && nodoSlug) {
            const nRes = await db.query(
                `SELECT id FROM public.nodos_maestro
                 WHERE LOWER(slug) = $1 OR LOWER(COALESCE(slug_historico, '')) = $1
                 ORDER BY CASE WHEN LOWER(slug) = $1 THEN 0 ELSE 1 END
                 LIMIT 1`,
                [nodoSlug]
            );
            if (nRes.rows[0]) nodoId = Number(nRes.rows[0].id);
        }
        if (!nodoId || Number(prop.nodo_solicitante_id) !== nodoId) {
            throw new Error('No tenés permiso para anular solicitudes de otro Nodo.');
        }
        const upd = await db.query(
            `UPDATE public.nodos_propuestas_fracciones
             SET estado = 'ANULADA',
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [pId]
        );
        return upd.rows[0];
    }

    const motivoAdmin = String(opciones.motivo || '').trim() || 'Solicitud descartada desde Administración.';
    const updAdmin = await db.query(
        `UPDATE public.nodos_propuestas_fracciones
         SET estado = 'DESCARTADA',
             respuesta_lamda = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [pId, motivoAdmin]
    );
    return updAdmin.rows[0];
}

/**
 * Incorpora en 1 toque un artículo ya cotizado en public.nodos_articulos_catalogo
 * dentro de Mi Oferta y Márgenes (public.nodos_ofertas_gestor) de un Nodo específico,
 * dejándolo inicialmente oculto para que el Gestor ajuste su ganancia y lo publique.
 */
async function sumarArticuloCatalogoANodo(nodoId, catalogoId) {
    await asegurarEsquemaNodosBarriales();
    const nId = Number(nodoId);
    const cId = Number(catalogoId);
    if (!nId || !cId) {
        throw new Error('Identificador de Nodo o de artículo de catálogo inválido.');
    }

    const [nodoRes, catRes] = await Promise.all([
        db.query(
            `SELECT id, margen_gestor_default_pct, activo,
                    COALESCE(alicuota_iva_margen_pct, 21.00) AS alicuota_iva_margen_pct,
                    COALESCE(alicuota_iibb_margen_pct, 4.00) AS alicuota_iibb_margen_pct
             FROM public.nodos_maestro WHERE id = $1 LIMIT 1`,
            [nId]
        ),
        db.query('SELECT * FROM public.nodos_articulos_catalogo WHERE id = $1 AND activo = true LIMIT 1', [cId])
    ]);
    if (nodoRes.rows.length === 0) throw new Error('Nodo no encontrado.');
    if (nodoRes.rows[0].activo === false) {
        const err = new Error('Este Nodo se encuentra archivado.');
        err.statusCode = 403;
        throw err;
    }
    if (catRes.rows.length === 0) throw new Error('El artículo seleccionado no está activo en el Catálogo Base de Nodos.');

    const nodo = nodoRes.rows[0];
    const cat = catRes.rows[0];
    const base = Number(cat.precio_base_nodo_final || 0);
    const margenDef = Number(nodo.margen_gestor_default_pct || cat.margen_sugerido_gestor_pct || 28);
    const calcSum = calcularPrecioYGananciaNetaOfertaNodo({
        costoBaseLamda: base,
        margenPct: margenDef,
        ivaPct: nodo.alicuota_iva_margen_pct,
        iibbPct: nodo.alicuota_iibb_margen_pct,
        modo: 'margen'
    });
    const precioVecino = calcSum.precio_tienda;
    const ganancia = calcSum.ganancia_neta_nodo;

    let resOf = await db.query(
        `UPDATE public.nodos_ofertas_gestor SET
            precio_base_nodo_snapshot = $3,
            updated_at = NOW()
         WHERE nodo_id = $1 AND articulo_catalogo_id = $2
         RETURNING *`,
        [nId, cId, base]
    );
    if (resOf.rowCount === 0) {
        resOf = await db.query(
            `INSERT INTO public.nodos_ofertas_gestor (
                nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor, publicado_tienda
             ) VALUES ($1, $2, $3, $4, $5, $6, false)
             RETURNING *`,
            [nId, cId, base, margenDef, precioVecino, ganancia]
        );
    }
    return resOf.rows[0];
}

/**
 * Cotiza y aprueba una fracción (desde una propuesta de gestor o creación directa en Pizarra),
 * la inserta/actualiza en public.nodos_articulos_catalogo y propaga la oferta a los Nodos.
 */
async function cotizarYAprobarArticuloNodo(payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Resolver determinísticamente el ingrediente comercial simple (Puente) si es Mix o Pre-Mezcla
        const ingComercial = await resolverIngredienteComercialDeterminista(client, payload.ingrediente_origen_id);
        const ingredienteOrigenFinalId = ingComercial.id || (payload.ingrediente_origen_id ? Number(payload.ingrediente_origen_id) : null);

        // 2. Resolver Anatomía Nativa LAMDA (Caso 0: existente, Caso A: clon de hermano Búnker, Caso B: Diccionario relacional Búnker)
        const anatomia = await resolverAnatomiaNativaArticuloNodo(client, {
            ...payload,
            ingrediente_origen_id: ingredienteOrigenFinalId
        });

        if (anatomia.requiere_diccionario_bunker) {
            throw new Error('Este artículo nuevo no posee hermanos previos en el Búnker. Completá los selectores relacionales del Diccionario Búnker (Familia, Sustantivo Ancla y Rubro/Subrubro) antes de aprobar.');
        }

        // 3. Validar determinísticamente por ID el envase primario (es_insumo = true) y flowpack individual (#181 si es Pack de Barritas)
        const origenTipoFinal = String(payload.origen_tipo || 'INGREDIENTE').toUpperCase();
        const insumoEnvaseIdFinal = payload.insumo_envase_id
            ? Number(payload.insumo_envase_id)
            : (anatomia.insumo_envase_id ? Number(anatomia.insumo_envase_id) : null);

        let costoEnvaseUnitario = Number(payload.costo_envase_unitario ?? 0);
        if (insumoEnvaseIdFinal) {
            const envRes = await client.query(
                `SELECT id, codigo, nombre, COALESCE(es_insumo, false) AS es_insumo, COALESCE(costo_patron, 0) AS costo_patron
                 FROM public.ingredientes
                 WHERE id = $1
                 LIMIT 1`,
                [insumoEnvaseIdFinal]
            );
            if (envRes.rows.length === 0 || !envRes.rows[0].es_insumo) {
                throw new Error('El envase / bolsa seleccionado no corresponde a un insumo válido del padrón de LAMDA (es_insumo = true).');
            }
            costoEnvaseUnitario = Number(envRes.rows[0].costo_patron || costoEnvaseUnitario);
        } else if (origenTipoFinal === 'INGREDIENTE' && !anatomia.existe_en_bunker) {
            throw new Error('Debés seleccionar un envase / bolsa oficial del padrón de insumos de LAMDA.');
        }

        let costoEnvaseExtra = Number(payload.costo_envase_extra || 0);
        if (Number(ingredienteOrigenFinalId) === 141 && !costoEnvaseExtra) {
            const env181Res = await client.query('SELECT COALESCE(costo_patron, 18.16) AS costo FROM public.ingredientes WHERE id = 181 LIMIT 1');
            const costo181 = Number(env181Res.rows[0]?.costo || 18.16);
            costoEnvaseExtra = Number((Number(anatomia.pack_unidades || 6) * costo181).toFixed(2));
        }

        // 4. Resolver costo por kilo del insumo comercial puente
        let costoInsumoKg = Number(payload.costo_insumo_kg ?? 0);
        if (ingredienteOrigenFinalId && (!costoInsumoKg || Number(ingredienteOrigenFinalId) !== Number(payload.ingrediente_origen_id))) {
            costoInsumoKg = Number(ingComercial.costo_patron || costoInsumoKg || 0);
        }

        const calc = calcularEstructuraCostosNodo({
            ...payload,
            segundos_fraccionamiento: payload.segundos_fraccionamiento || anatomia.segundos_nativos || 35,
            costo_insumo_kg: costoInsumoKg,
            costo_envase_unitario: costoEnvaseUnitario,
            costo_envase_extra: costoEnvaseExtra
        });

        // 5. Código SKU y Nomenclatura Oficial LAMDA deterministas (prohibidos prefijos NB- / EMB- y texto libre)
        const skuEntrada = String(payload.sku_nodo || '').trim();
        if (/^(NB-|EMB-)/i.test(skuEntrada)) {
            throw new Error(`El código SKU "${skuEntrada}" no respeta el estándar oficial LAMDA (prohibidos prefijos NB- o EMB-).`);
        }
        const skuNodo = skuEntrada || String(anatomia.sku_nativo || '').trim();
        if (!skuNodo || /^(NB-|EMB-)/i.test(skuNodo)) {
            throw new Error('No se pudo derivar un código SKU oficial válido del Diccionario Búnker.');
        }

        const nomenclaturaOficial = String(anatomia.nomenclatura_bunker || '').trim();
        if (!nomenclaturaOficial) {
            throw new Error('La nomenclatura oficial del artículo debe derivarse estrictamente del Diccionario Búnker.');
        }
        if (!anatomia.familia_id || !anatomia.articulo_principal) {
            throw new Error('El artículo debe quedar vinculado a una Familia y un Sustantivo Ancla válidos del Diccionario Búnker.');
        }

        const listasCompEntrada = Array.isArray(payload.listas_mayoristas_compartidas)
            ? payload.listas_mayoristas_compartidas.map(Number).filter(Boolean)
            : [];
        const esGranolaExistente = ['GSX500G', 'GDFX500G'].includes(String(skuNodo).toUpperCase());
        const listasCompFinales = (esGranolaExistente && listasCompEntrada.length === 0)
            ? [1, 2, 3, 5, 6, 7]
            : listasCompEntrada;
        const compartidoFinal = esGranolaExistente ? true : Boolean(payload.compartido_mayorista);

        let presentacionEtiqueta = String(payload.presentacion_etiqueta || '').trim();
        if (!presentacionEtiqueta) {
            if (Boolean(anatomia.es_pack) && Number(anatomia.pack_unidades || 1) > 1) {
                presentacionEtiqueta = Number(ingredienteOrigenFinalId) === 141
                    ? `Pack x ${anatomia.pack_unidades} (${Math.round((calc.kilos_unidad * 1000) / Number(anatomia.pack_unidades))}g c/u)`
                    : `Pack x ${anatomia.pack_unidades} un.`;
            } else if (calc.kilos_unidad < 1) {
                presentacionEtiqueta = `Bolsa ${Math.round(calc.kilos_unidad * 1000)}g`;
            } else {
                presentacionEtiqueta = `Bolsa ${Number(calc.kilos_unidad.toFixed(2))}kg`;
            }
        }

        const categoriaOficial = String(anatomia.familia_nombre || payload.categoria_familiar || 'Frutos Secos').trim();

        let articuloRow;
        if (payload.catalogo_id) {
            const upd = await client.query(
                `UPDATE public.nodos_articulos_catalogo SET
                    sku_nodo = $1,
                    nombre_publico = $2,
                    categoria_familiar = $3,
                    presentacion_etiqueta = $4,
                    flujo_lamda = $5,
                    origen_tipo = $6,
                    ingrediente_origen_id = $7,
                    articulo_bunker_origen_codigo = $8,
                    kilos_unidad = $9,
                    insumo_envase_id = $10,
                    cantidad_envases_unidad = $11,
                    segundos_fraccionamiento = $12,
                    tarifa_colaborador_id = $13,
                    valor_hora_aplicado = $14,
                    costo_insumo_kg = $15,
                    costo_insumo_fraccion = $16,
                    costo_envase_aplicado = $17,
                    costo_mano_obra_aplicado = $18,
                    margen_lamda_pct = $19,
                    iva_pct = $20,
                    iibb_pct = $21,
                    costo_puro_total = $22,
                    precio_base_nodo_neto = $23,
                    precio_base_nodo_final = $24,
                    margen_sugerido_gestor_pct = $25,
                    precio_sugerido_vecino = $26,
                    notas_tecnicas = $27,
                    nomenclatura_bunker = $28,
                    familia_bunker_id = $29,
                    familia_bunker_nombre = $30,
                    articulo_principal_bunker = $31,
                    compartido_mayorista = $32,
                    listas_mayoristas_compartidas = $33,
                    activo = true,
                    estado = 'APROBADO',
                    updated_at = NOW()
                WHERE id = $34
                RETURNING *`,
                [
                    skuNodo,
                    nomenclaturaOficial,
                    categoriaOficial,
                    presentacionEtiqueta,
                    Number(payload.flujo_lamda || 2),
                    origenTipoFinal,
                    ingredienteOrigenFinalId,
                    skuNodo,
                    calc.kilos_unidad,
                    insumoEnvaseIdFinal,
                    Number(payload.cantidad_envases_unidad || 1),
                    calc.segundos_fraccionamiento,
                    payload.tarifa_colaborador_id ? Number(payload.tarifa_colaborador_id) : null,
                    calc.valor_hora_aplicado,
                    calc.costo_insumo_kg,
                    calc.costo_insumo_fraccion,
                    calc.costo_envase_aplicado,
                    calc.costo_mano_obra_aplicado,
                    calc.margen_lamda_pct,
                    calc.iva_pct,
                    calc.iibb_pct,
                    calc.costo_puro_total,
                    calc.precio_base_nodo_neto,
                    calc.precio_base_nodo_final,
                    calc.margen_sugerido_gestor_pct,
                    calc.precio_sugerido_vecino,
                    payload.notas_tecnicas || '',
                    nomenclaturaOficial,
                    anatomia.familia_id,
                    anatomia.familia_nombre,
                    anatomia.articulo_principal,
                    compartidoFinal,
                    JSON.stringify(listasCompFinales),
                    Number(payload.catalogo_id)
                ]
            );
            articuloRow = upd.rows[0];
        } else {
            const exCatSku = await client.query(
                `SELECT id FROM public.nodos_articulos_catalogo
                 WHERE UPPER(sku_nodo) = UPPER($1)
                 LIMIT 1 FOR UPDATE`,
                [skuNodo]
            );
            if (exCatSku.rows.length > 0) {
                const updSku = await client.query(
                    `UPDATE public.nodos_articulos_catalogo SET
                        nombre_publico = $2,
                        categoria_familiar = $3,
                        presentacion_etiqueta = $4,
                        flujo_lamda = $5,
                        origen_tipo = $6,
                        ingrediente_origen_id = $7,
                        articulo_bunker_origen_codigo = $8,
                        kilos_unidad = $9,
                        insumo_envase_id = $10,
                        cantidad_envases_unidad = $11,
                        segundos_fraccionamiento = $12,
                        tarifa_colaborador_id = $13,
                        valor_hora_aplicado = $14,
                        costo_insumo_kg = $15,
                        costo_insumo_fraccion = $16,
                        costo_envase_aplicado = $17,
                        costo_mano_obra_aplicado = $18,
                        margen_lamda_pct = $19,
                        iva_pct = $20,
                        iibb_pct = $21,
                        costo_puro_total = $22,
                        precio_base_nodo_neto = $23,
                        precio_base_nodo_final = $24,
                        margen_sugerido_gestor_pct = $25,
                        precio_sugerido_vecino = $26,
                        notas_tecnicas = $27,
                        nomenclatura_bunker = $28,
                        familia_bunker_id = $29,
                        familia_bunker_nombre = $30,
                        articulo_principal_bunker = $31,
                        compartido_mayorista = $32,
                        listas_mayoristas_compartidas = $33,
                        activo = true,
                        estado = 'APROBADO',
                        updated_at = NOW()
                     WHERE id = $1
                     RETURNING *`,
                    [
                        exCatSku.rows[0].id,
                        nomenclaturaOficial,
                        categoriaOficial,
                        presentacionEtiqueta,
                        Number(payload.flujo_lamda || 2),
                        origenTipoFinal,
                        ingredienteOrigenFinalId,
                        skuNodo,
                        calc.kilos_unidad,
                        insumoEnvaseIdFinal,
                        Number(payload.cantidad_envases_unidad || 1),
                        calc.segundos_fraccionamiento,
                        payload.tarifa_colaborador_id ? Number(payload.tarifa_colaborador_id) : null,
                        calc.valor_hora_aplicado,
                        calc.costo_insumo_kg,
                        calc.costo_insumo_fraccion,
                        calc.costo_envase_aplicado,
                        calc.costo_mano_obra_aplicado,
                        calc.margen_lamda_pct,
                        calc.iva_pct,
                        calc.iibb_pct,
                        calc.costo_puro_total,
                        calc.precio_base_nodo_neto,
                        calc.precio_base_nodo_final,
                        calc.margen_sugerido_gestor_pct,
                        calc.precio_sugerido_vecino,
                        payload.notas_tecnicas || '',
                        nomenclaturaOficial,
                        anatomia.familia_id,
                        anatomia.familia_nombre,
                        anatomia.articulo_principal,
                        compartidoFinal,
                        JSON.stringify(listasCompFinales)
                    ]
                );
                articuloRow = updSku.rows[0];
            } else {
                const ins = await client.query(
                    `INSERT INTO public.nodos_articulos_catalogo (
                        sku_nodo, nombre_publico, categoria_familiar, presentacion_etiqueta,
                        flujo_lamda, origen_tipo, ingrediente_origen_id, articulo_bunker_origen_codigo,
                        kilos_unidad, insumo_envase_id, cantidad_envases_unidad, segundos_fraccionamiento,
                        tarifa_colaborador_id, valor_hora_aplicado, costo_insumo_kg,
                        costo_insumo_fraccion, costo_envase_aplicado, costo_mano_obra_aplicado,
                        margen_lamda_pct, iva_pct, iibb_pct, costo_puro_total,
                        precio_base_nodo_neto, precio_base_nodo_final,
                        margen_sugerido_gestor_pct, precio_sugerido_vecino, notas_tecnicas,
                        nomenclatura_bunker, familia_bunker_id, familia_bunker_nombre,
                        articulo_principal_bunker, compartido_mayorista, listas_mayoristas_compartidas
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
                    )
                    RETURNING *`,
                    [
                        skuNodo,
                        nomenclaturaOficial,
                        categoriaOficial,
                        presentacionEtiqueta,
                        Number(payload.flujo_lamda || 2),
                        origenTipoFinal,
                        ingredienteOrigenFinalId,
                        skuNodo,
                        calc.kilos_unidad,
                        insumoEnvaseIdFinal,
                        Number(payload.cantidad_envases_unidad || 1),
                        calc.segundos_fraccionamiento,
                        payload.tarifa_colaborador_id ? Number(payload.tarifa_colaborador_id) : null,
                        calc.valor_hora_aplicado,
                        calc.costo_insumo_kg,
                        calc.costo_insumo_fraccion,
                        calc.costo_envase_aplicado,
                        calc.costo_mano_obra_aplicado,
                        calc.margen_lamda_pct,
                        calc.iva_pct,
                        calc.iibb_pct,
                        calc.costo_puro_total,
                        calc.precio_base_nodo_neto,
                        calc.precio_base_nodo_final,
                        calc.margen_sugerido_gestor_pct,
                        calc.precio_sugerido_vecino,
                        payload.notas_tecnicas || '',
                        nomenclaturaOficial,
                        anatomia.familia_id,
                        anatomia.familia_nombre,
                        anatomia.articulo_principal,
                        compartidoFinal,
                        JSON.stringify(listasCompFinales)
                    ]
                );
                articuloRow = ins.rows[0];
            }
        }

        // Si provenía de una propuesta de fracción (o existían solicitudes pendientes equivalentes), marcarlas como APROBADA y vincularlas
        let nodoSolicitantePropId = null;
        let aliasVidrieraSolicitante = null;
        const textoRespuestaAprobada = payload.respuesta_lamda || `Aprobado por LAMDA con Precio Base Nodo $${calc.precio_base_nodo_final.toLocaleString('es-AR')} ([${skuNodo}] ${nomenclaturaOficial})`;
        if (payload.propuesta_id) {
            const propPrevRes = await client.query(
                `SELECT id, nodo_solicitante_id, alias_vidriera_sugerido
                 FROM public.nodos_propuestas_fracciones
                 WHERE id = $1
                 LIMIT 1 FOR UPDATE`,
                [Number(payload.propuesta_id)]
            );
            const propPrev = propPrevRes.rows[0] || null;
            if (propPrev && propPrev.nodo_solicitante_id) {
                nodoSolicitantePropId = Number(propPrev.nodo_solicitante_id);
            }
            const rawAliasExplicito = payload.alias_vidriera_nodo !== undefined
                ? String(payload.alias_vidriera_nodo || '').trim()
                : (payload.nombre_vidriera_personalizado !== undefined
                    ? String(payload.nombre_vidriera_personalizado || '').trim()
                    : ((payload.nombre_publico && String(payload.nombre_publico).trim() && String(payload.nombre_publico).trim() !== nomenclaturaOficial)
                        ? String(payload.nombre_publico).trim()
                        : String(propPrev?.alias_vidriera_sugerido || '').trim()));
            if (rawAliasExplicito && rawAliasExplicito !== nomenclaturaOficial) {
                aliasVidrieraSolicitante = rawAliasExplicito;
            }

            await client.query(
                `UPDATE public.nodos_propuestas_fracciones SET
                    estado = 'APROBADA',
                    articulo_catalogo_id = $1,
                    ingrediente_sugerido_id = COALESCE($4, ingrediente_sugerido_id),
                    alias_vidriera_sugerido = COALESCE($5, alias_vidriera_sugerido),
                    respuesta_lamda = $2,
                    updated_at = NOW()
                WHERE id = $3`,
                [
                    articuloRow.id,
                    textoRespuestaAprobada,
                    Number(payload.propuesta_id),
                    ingredienteOrigenFinalId,
                    aliasVidrieraSolicitante
                ]
            );
        }
        if (ingredienteOrigenFinalId) {
            const idsEquiv = [Number(ingredienteOrigenFinalId)];
            if (payload.ingrediente_origen_id && !idsEquiv.includes(Number(payload.ingrediente_origen_id))) {
                idsEquiv.push(Number(payload.ingrediente_origen_id));
            }
            await client.query(
                `UPDATE public.nodos_propuestas_fracciones SET
                    estado = 'APROBADA',
                    articulo_catalogo_id = $1,
                    respuesta_lamda = $2,
                    updated_at = NOW()
                WHERE estado = 'PENDIENTE_COTIZACION'
                  AND ingrediente_sugerido_id = ANY($3::int[])
                  AND ABS(COALESCE(kilos_sugeridos, 0) - $4) < 0.003`,
                [articuloRow.id, textoRespuestaAprobada, idsEquiv, calc.kilos_unidad]
            );
        }

        // Propagar / actualizar en nodos_ofertas_gestor para todos los Nodos activos mediante upsert determinístico.
        // Cada Nodo recibe el artículo con su SKU y nombre oficial LAMDA por defecto; si la solicitud traía un nombre
        // de vidriera personalizado para el Nodo solicitante, se registra únicamente en su oferta de vidriera.
        const publicadoInicial = Boolean(payload.publicar_inmediato_tienda === true);
        const nodosActivos = await client.query(
            `SELECT id, margen_gestor_default_pct,
                    COALESCE(alicuota_iva_margen_pct, 21.00) AS alicuota_iva_margen_pct,
                    COALESCE(alicuota_iibb_margen_pct, 4.00) AS alicuota_iibb_margen_pct
             FROM public.nodos_maestro WHERE activo = true`
        );
        for (const nodo of nodosActivos.rows) {
            const margenDef = Number(nodo.margen_gestor_default_pct || calc.margen_sugerido_gestor_pct || 28);
            const calcDef = calcularPrecioYGananciaNetaOfertaNodo({
                costoBaseLamda: calc.precio_base_nodo_final,
                margenPct: margenDef,
                ivaPct: nodo.alicuota_iva_margen_pct,
                iibbPct: nodo.alicuota_iibb_margen_pct,
                modo: 'margen'
            });
            const precioVecino = calcDef.precio_tienda;
            const ganancia = calcDef.ganancia_neta_nodo;
            const aliasVidrieraParaNodo = (nodoSolicitantePropId && Number(nodo.id) === nodoSolicitantePropId && aliasVidrieraSolicitante)
                ? aliasVidrieraSolicitante
                : null;

            const exOferta = await client.query(
                `SELECT id, precio_base_nodo_snapshot, margen_gestor_pct
                 FROM public.nodos_ofertas_gestor
                 WHERE nodo_id = $1 AND articulo_catalogo_id = $2
                 LIMIT 1 FOR UPDATE`,
                [nodo.id, articuloRow.id]
            );
            if (exOferta.rows.length > 0) {
                const ofPrev = exOferta.rows[0];
                const margenOf = Number(ofPrev.margen_gestor_pct ?? margenDef);
                const calcOf = calcularPrecioYGananciaNetaOfertaNodo({
                    costoBaseLamda: calc.precio_base_nodo_final,
                    margenPct: margenOf,
                    ivaPct: nodo.alicuota_iva_margen_pct,
                    iibbPct: nodo.alicuota_iibb_margen_pct,
                    modo: 'margen'
                });
                const nuevoPVecino = calcOf.precio_tienda;
                const nuevaGan = calcOf.ganancia_neta_nodo;
                const cambioCosto = Number(ofPrev.precio_base_nodo_snapshot || 0) !== Number(calc.precio_base_nodo_final || 0);
                await client.query(
                    `UPDATE public.nodos_ofertas_gestor SET
                        alerta_cambio_costo = $2,
                        precio_base_nodo_snapshot = $3,
                        precio_venta_vecino = $4,
                        ganancia_unitaria_gestor = $5,
                        nombre_vidriera_personalizado = COALESCE($6, nombre_vidriera_personalizado),
                        updated_at = NOW()
                     WHERE id = $1`,
                    [ofPrev.id, cambioCosto, calc.precio_base_nodo_final, nuevoPVecino, nuevaGan, aliasVidrieraParaNodo]
                );
            } else {
                await client.query(
                    `INSERT INTO public.nodos_ofertas_gestor (
                        nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                        margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor,
                        publicado_tienda, nombre_vidriera_personalizado
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                    [nodo.id, articuloRow.id, calc.precio_base_nodo_final, margenDef, precioVecino, ganancia, publicadoInicial, aliasVidrieraParaNodo]
                );
            }
        }

        // Sincronizar inmediatamente con bunker_articulos, bunker_lista_articulos y recetas
        await sincronizarNodosConCircuitoOperativoLamda(client, {
            skuDesdeCotizador: skuNodo,
            anatomiaOverride: anatomia
        });

        await client.query('COMMIT');
        articuloRow.bunker_descripcion_generada = articuloRow.nomenclatura_bunker;
        articuloRow.bunker_familia_nombre = articuloRow.familia_bunker_nombre;
        return { articulo: articuloRow, calculo: calc };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Recalcula en cascada todo el catálogo de Nodos tomando los costos vivos de los 6 Flujos
 * de la base de datos (y opcionalmente costos simulados en memoria de la Pizarra).
 */
async function recalcularCascadaCatalogoNodos(costosSimuladosIngredientes = {}) {
    await asegurarEsquemaNodosBarriales();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const env181Res = await client.query(`SELECT COALESCE(costo_patron, 18.16) AS costo FROM public.ingredientes WHERE id = 181 LIMIT 1`);
        const costoFlowpack181 = costosSimuladosIngredientes[181] !== undefined
            ? Number(costosSimuladosIngredientes[181])
            : Number(env181Res.rows[0]?.costo || 18.16);

        const catRes = await client.query(`
            SELECT nac.*,
                   COALESCE(ing.costo_patron, nac.costo_insumo_kg) AS ing_costo_db,
                   COALESCE(env.costo_patron, nac.costo_envase_aplicado) AS env_costo_db,
                   COALESCE(ct.valor_hora, nac.valor_hora_aplicado) AS tarifa_hora_db
            FROM public.nodos_articulos_catalogo nac
            LEFT JOIN public.ingredientes ing ON ing.id = nac.ingrediente_origen_id
            LEFT JOIN public.ingredientes env ON env.id = nac.insumo_envase_id
            LEFT JOIN public.colaboradores_tarifas ct ON ct.id = nac.tarifa_colaborador_id
            WHERE nac.activo = true
        `);

        let actualizados = 0;
        for (const row of catRes.rows) {
            const ingId = row.ingrediente_origen_id ? Number(row.ingrediente_origen_id) : null;
            const envId = row.insumo_envase_id ? Number(row.insumo_envase_id) : null;

            const costoInsumoVivo = (ingId && costosSimuladosIngredientes[ingId] !== undefined)
                ? Number(costosSimuladosIngredientes[ingId])
                : Number(row.ing_costo_db || row.costo_insumo_kg);

            const costoEnvaseVivo = (envId && costosSimuladosIngredientes[envId] !== undefined)
                ? Number(costosSimuladosIngredientes[envId])
                : Number(row.env_costo_db || 45.96);

            const esBarritaPack6 = String(row.sku_nodo || '').toUpperCase() === 'BF6X50' || ingId === 141;
            const costoEnvaseExtra = esBarritaPack6 ? Number((6 * costoFlowpack181).toFixed(2)) : 0;

            const calc = calcularEstructuraCostosNodo({
                costo_insumo_kg: costoInsumoVivo,
                kilos_unidad: row.kilos_unidad,
                costo_envase_unitario: costoEnvaseVivo,
                cantidad_envases_unidad: row.cantidad_envases_unidad,
                costo_envase_extra: costoEnvaseExtra,
                segundos_fraccionamiento: row.segundos_fraccionamiento,
                valor_hora_aplicado: row.tarifa_hora_db || row.valor_hora_aplicado,
                margen_lamda_pct: row.margen_lamda_pct,
                iva_pct: row.iva_pct,
                iibb_pct: row.iibb_pct,
                margen_sugerido_gestor_pct: row.margen_sugerido_gestor_pct
            });

            await client.query(
                `UPDATE public.nodos_articulos_catalogo SET
                    costo_insumo_kg = $1,
                    costo_insumo_fraccion = $2,
                    costo_envase_aplicado = $3,
                    valor_hora_aplicado = $4,
                    costo_mano_obra_aplicado = $5,
                    costo_puro_total = $6,
                    precio_base_nodo_neto = $7,
                    precio_base_nodo_final = $8,
                    precio_sugerido_vecino = $9,
                    updated_at = NOW()
                WHERE id = $10`,
                [
                    calc.costo_insumo_kg,
                    calc.costo_insumo_fraccion,
                    calc.costo_envase_aplicado,
                    calc.valor_hora_aplicado,
                    calc.costo_mano_obra_aplicado,
                    calc.costo_puro_total,
                    calc.precio_base_nodo_neto,
                    calc.precio_base_nodo_final,
                    calc.precio_sugerido_vecino,
                    row.id
                ]
            );

            const ofsCascadaRes = await client.query(
                `SELECT nog.id, nog.margen_gestor_pct, nog.precio_base_nodo_snapshot,
                        COALESCE(nm.alicuota_iva_margen_pct, 21.00) AS iva_pct,
                        COALESCE(nm.alicuota_iibb_margen_pct, 4.00) AS iibb_pct
                 FROM public.nodos_ofertas_gestor nog
                 JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
                 WHERE nog.articulo_catalogo_id = $1
                 FOR UPDATE OF nog`,
                [row.id]
            );
            for (const ofRow of ofsCascadaRes.rows) {
                const calcCasc = calcularPrecioYGananciaNetaOfertaNodo({
                    costoBaseLamda: calc.precio_base_nodo_final,
                    margenPct: ofRow.margen_gestor_pct,
                    ivaPct: ofRow.iva_pct,
                    iibbPct: ofRow.iibb_pct,
                    modo: 'margen'
                });
                const alertaCosto = Number(ofRow.precio_base_nodo_snapshot || 0) !== Number(calc.precio_base_nodo_final || 0);
                await client.query(
                    `UPDATE public.nodos_ofertas_gestor SET
                        alerta_cambio_costo = $2,
                        precio_base_nodo_snapshot = $3,
                        precio_venta_vecino = $4,
                        ganancia_unitaria_gestor = $5,
                        updated_at = NOW()
                     WHERE id = $1`,
                    [ofRow.id, alertaCosto, calc.precio_base_nodo_final, calcCasc.precio_tienda, calcCasc.ganancia_neta_nodo]
                );
            }

            actualizados++;
        }

        await sincronizarNodosConCircuitoOperativoLamda(client, { forzarPreciosNodos: true });
        await client.query('COMMIT');
        return { actualizados };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Sincroniza bidireccionalmente desde el Búnker de Artículos (listado-bunker.html -> Activar en Lista / 💰 Finanzas / Masa)
 * hacia nodos_articulos_catalogo y nodos_ofertas_gestor, manteniendo congelados los pedidos vecinales ya confirmados:
 * - Si el artículo se activa en Lista Base Nodos Barriales y aún no existe en nodos_articulos_catalogo, lo da de alta.
 * - Si tiene precio > $0 en Lista Base Nodos Barriales, propaga su Precio Base a nodos_ofertas_gestor de los Nodos activos.
 * - Si se desactiva (disponible = false) en Lista Base Nodos Barriales, marca activo = false en nodos_articulos_catalogo y oculta de tienda.
 */
async function sincronizarCatalogoNodoDesdeBunker(articuloId, runnerOpt = null) {
    const sku = String(articuloId || '').trim();
    if (!sku) return { sincronizado: false };

    const ownClient = !runnerOpt;
    const q = runnerOpt || await db.connect();
    try {
        if (ownClient) await q.query('BEGIN');

        const baRes = await q.query(
            `SELECT ba.*, bf.nombre AS familia_nombre_db
             FROM public.bunker_articulos ba
             LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
             WHERE UPPER(ba.articulo_id) = UPPER($1)
             LIMIT 1`,
            [sku]
        );
        if (baRes.rows.length === 0) {
            await q.query(
                `UPDATE public.nodos_articulos_catalogo SET activo = false, updated_at = NOW() WHERE UPPER(sku_nodo) = UPPER($1) AND activo = true`,
                [sku]
            );
            await q.query(
                `UPDATE public.nodos_ofertas_gestor SET publicado_tienda = false, updated_at = NOW()
                 WHERE articulo_catalogo_id IN (SELECT id FROM public.nodos_articulos_catalogo WHERE UPPER(sku_nodo) = UPPER($1))`,
                [sku]
            );
            if (ownClient) await q.query('COMMIT');
            return { sincronizado: false, motivo: 'articulo_no_existe_en_bunker' };
        }
        const ba = baRes.rows[0];
        const skuExacto = String(ba.articulo_id || sku).trim();

        const laNodosRes = await q.query(
            `SELECT la.*
             FROM public.bunker_lista_articulos la
             JOIN public.bunker_listas_precios lp ON lp.id = la.lista_id
             WHERE UPPER(la.articulo_numero) = UPPER($1)
               AND COALESCE(lp.canal_comercial, 'MAYORISTA') = 'NODOS'
             ORDER BY lp.id ASC LIMIT 1`,
            [skuExacto]
        );
        const laNodos = laNodosRes.rows[0] || null;

        const catRes = await q.query(
            'SELECT * FROM public.nodos_articulos_catalogo WHERE UPPER(sku_nodo) = UPPER($1) LIMIT 1',
            [skuExacto]
        );
        const row = catRes.rows[0] || null;

        // Caso A: Desactivado o ausente en Lista Base Nodos Barriales -> desactivar en catálogo Nodos y ocultar de tienda
        if (!laNodos || laNodos.disponible === false) {
            if (!row) {
                if (ownClient) await q.query('COMMIT');
                return { sincronizado: false, motivo: 'no_habilitado_en_nodos' };
            }
            if (row.activo !== false) {
                await q.query(
                    `UPDATE public.nodos_articulos_catalogo
                     SET activo = false, updated_at = NOW()
                     WHERE id = $1`,
                    [row.id]
                );
                await q.query(
                    `UPDATE public.nodos_ofertas_gestor
                     SET publicado_tienda = false, updated_at = NOW()
                     WHERE articulo_catalogo_id = $1`,
                    [row.id]
                );
            }
            if (ownClient) await q.query('COMMIT');
            return { sincronizado: true, desactivado: true, sku_nodo: row.sku_nodo };
        }

        // Caso B: Habilitado (disponible = true) en Lista Base Nodos Barriales -> insertar o actualizar en nodos_articulos_catalogo
        const listasMayoristasDispRes = await q.query(
            `SELECT la.lista_id
             FROM public.bunker_lista_articulos la
             JOIN public.bunker_listas_precios lp ON lp.id = la.lista_id
             WHERE UPPER(la.articulo_numero) = UPPER($1)
               AND COALESCE(lp.canal_comercial, 'MAYORISTA') = 'MAYORISTA'
               AND la.disponible = true
             ORDER BY la.lista_id ASC`,
            [skuExacto]
        );
        const listasCompIds = listasMayoristasDispRes.rows.map(r => Number(r.lista_id));
        const compartidoMayorista = listasCompIds.length > 0;

        const kilosUnidad = Math.max(0.001, Number(ba.kilos_unidad || row?.kilos_unidad || 1));

        // Desglosar desde public.receta_ingredientes el ingrediente alimenticio y los insumos de envase primario
        const recItemsRes = await q.query(
            `SELECT ri.ingrediente_id, ri.cantidad,
                    ing.id AS ing_id, ing.codigo AS ing_codigo, ing.nombre AS ing_nombre,
                    ing.articulo_vinculado_numero,
                    COALESCE(ing.es_insumo, false) AS es_insumo,
                    COALESCE(ing.costo_patron, 0) AS costo_patron
             FROM public.recetas r
             JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
             JOIN public.ingredientes ing ON ing.id = ri.ingrediente_id
             WHERE UPPER(r.articulo_numero) = UPPER($1)
             ORDER BY ri.id ASC`,
            [skuExacto]
        );

        let ingredienteAlimento = null;
        let ingredienteOrigenId = row?.ingrediente_origen_id ? Number(row.ingrediente_origen_id) : null;
        let costoInsumoKg = Number(row?.costo_insumo_kg || 0);
        let costoInsumoFraccion = Number(row?.costo_insumo_fraccion || 0);
        let costoEnvaseAplicado = Number(row?.costo_envase_aplicado || 0);
        let insumoEnvaseId = row?.insumo_envase_id ? Number(row.insumo_envase_id) : null;
        let cantidadEnvasesUnidad = Number(row?.cantidad_envases_unidad || 1);

        if (recItemsRes.rows.length > 0) {
            let sumaAlimento = 0;
            let sumaEnvase = 0;
            for (const ri of recItemsRes.rows) {
                const sub = Number(ri.cantidad || 0) * Number(ri.costo_patron || 0);
                if (ri.es_insumo) {
                    sumaEnvase += sub;
                    if (Number(ri.ingrediente_id) !== 181) {
                        insumoEnvaseId = Number(ri.ingrediente_id);
                        cantidadEnvasesUnidad = Number(ri.cantidad || 1);
                    }
                } else {
                    sumaAlimento += sub;
                    if (!ingredienteAlimento || Number(ri.cantidad || 0) > Number(ingredienteAlimento.cantidad || 0)) {
                        ingredienteAlimento = ri;
                        ingredienteOrigenId = Number(ri.ing_id);
                    }
                }
            }
            if (sumaAlimento > 0) {
                costoInsumoFraccion = Number(sumaAlimento.toFixed(2));
                costoInsumoKg = kilosUnidad > 0
                    ? Number((sumaAlimento / kilosUnidad).toFixed(2))
                    : Number(ingredienteAlimento?.costo_patron || costoInsumoKg);
            }
            costoEnvaseAplicado = Number(sumaEnvase.toFixed(2));
        } else {
            // Flujo 1 (Bulto Cerrado Directo sin receta) o multipack comercial directo
            if (laNodos.costo_base_sobrescrito !== null && laNodos.costo_base_sobrescrito !== undefined && Number(laNodos.costo_base_sobrescrito) > 0) {
                costoInsumoKg = Number(laNodos.costo_base_sobrescrito);
                costoInsumoFraccion = Number((costoInsumoKg * kilosUnidad).toFixed(2));
            } else if (Number(ba.costo_base || 0) > 0) {
                costoInsumoFraccion = Number(Number(ba.costo_base).toFixed(2));
                costoInsumoKg = kilosUnidad > 0 ? Number((costoInsumoFraccion / kilosUnidad).toFixed(2)) : costoInsumoFraccion;
            }
        }

        // Si además tuviera algún insumo adicional en bunker_lista_insumos (ej: multipacks con pack_hijo_codigo)
        if (laNodos.id) {
            const insRes = await q.query(
                `SELECT li.*, COALESCE(ing.costo_patron, li.costo_unitario_capturado, 0) AS costo_vivo
                 FROM public.bunker_lista_insumos li
                 LEFT JOIN public.ingredientes ing ON ing.id::text = li.insumo_articulo_numero
                 WHERE li.lista_articulo_id = $1 AND li.incluido = true
                 ORDER BY li.id ASC`,
                [laNodos.id]
            );
            if (insRes.rows.length > 0) {
                const extraLista = insRes.rows.reduce(
                    (acc, r) => acc + Number(r.cantidad || 1) * Number(r.costo_vivo || 0),
                    0
                );
                costoEnvaseAplicado = Number((costoEnvaseAplicado + extraLista).toFixed(2));
            }
        }

        const propDin = (ba.propiedades_dinamicas && typeof ba.propiedades_dinamicas === 'object')
            ? ba.propiedades_dinamicas
            : {};
        const segundosFracc = propDin.asistente_minutos !== undefined && propDin.asistente_minutos !== null && Number(propDin.asistente_minutos) > 0
            ? Number((Number(propDin.asistente_minutos) * 60).toFixed(2))
            : Number(row?.segundos_fraccionamiento || 35);

        let tarifaColabId = Number(row?.tarifa_colaborador_id || 1);
        let valorHoraAplicado = Number(row?.valor_hora_aplicado || 4500);
        const colabLookupParam = propDin.asistente_colaborador_id ? Number(propDin.asistente_colaborador_id) : tarifaColabId;
        const ctRes = await q.query(
            `SELECT id, COALESCE(valor_hora, 4500) AS valor_hora
             FROM public.colaboradores_tarifas
             WHERE id = $1 OR usuario_id = $1
             ORDER BY id ASC LIMIT 1`,
            [colabLookupParam]
        );
        if (ctRes.rows[0]) {
            tarifaColabId = Number(ctRes.rows[0].id);
            valorHoraAplicado = Number(ctRes.rows[0].valor_hora || 4500);
        }

        const manoObraActiva = laNodos.mano_obra_activa === true;
        const costoManoObra = manoObraActiva
            ? Number(laNodos.costo_tiempo ?? row?.costo_mano_obra_aplicado ?? 0)
            : 0;
        const margenLamdaPct = laNodos.margen_ganancia !== undefined && laNodos.margen_ganancia !== null
            ? Number(laNodos.margen_ganancia)
            : Number(row?.margen_lamda_pct ?? 0);
        const ivaPct = Number(laNodos.iva ?? ba.porcentaje_iva ?? row?.iva_pct ?? 21);

        const costoMateriaYEnvase = Number((costoInsumoFraccion + costoEnvaseAplicado).toFixed(2));
        const costoPuroTotal = Number((costoMateriaYEnvase + costoManoObra).toFixed(2));
        const precioFinalLista = Number(laNodos.precio_final || 0);
        const precioBaseNodoFinal = precioFinalLista > 0 ? Math.round(precioFinalLista) : 0;
        const precioBaseNodoNeto = precioBaseNodoFinal > 0
            ? Number((precioBaseNodoFinal / (1 + ivaPct / 100)).toFixed(2))
            : 0;

        const margenSugGestor = Number(row?.margen_sugerido_gestor_pct || 28);
        const precioSugeridoVecino = precioBaseNodoFinal > 0
            ? Math.round(precioBaseNodoFinal * (1 + margenSugGestor / 100))
            : 0;

        const nomenclaturaBunker = ba.descripcion_generada || row?.nomenclatura_bunker || ba.descripcion || skuExacto;
        const artPrincipalBunker = ba.descripcion || row?.articulo_principal_bunker || nomenclaturaBunker;
        const familiaBunkerId = ba.familia_id ? Number(ba.familia_id) : (row?.familia_bunker_id || null);
        const familiaBunkerNombre = ba.familia_nombre_db || row?.familia_bunker_nombre || ba.rubro || 'Frutos Secos';

        const nombrePublico = nomenclaturaBunker;
        const categoriaFamiliar = familiaBunkerNombre;
        let flujoLamda = Number(row?.flujo_lamda || (recItemsRes.rows.length > 0 ? 2 : 1));
        let origenTipo = row?.origen_tipo || (ingredienteOrigenId ? 'INGREDIENTE' : 'ARTICULO_BUNKER');

        if (!row && ingredienteAlimento) {
            const idsCompRes = await q.query('SELECT DISTINCT mix_id AS ingrediente_padre_id FROM public.ingrediente_composicion');
            const idsCompSet = new Set(idsCompRes.rows.map(r => Number(r.ingrediente_padre_id)));
            const ident = resolverIdentidadTecnicaIngrediente(
                {
                    id: ingredienteAlimento.ing_id,
                    codigo: ingredienteAlimento.ing_codigo,
                    nombre: ingredienteAlimento.ing_nombre,
                    articulo_vinculado_numero: ingredienteAlimento.articulo_vinculado_numero
                },
                familiaBunkerNombre,
                idsCompSet
            );
            flujoLamda = Number(ident.flujo || 2);
            origenTipo = ident.origen_tipo || 'INGREDIENTE';
        }

        let presentacionEtiqueta = row?.presentacion_etiqueta || propDin.presentacion_etiqueta_nodo || '';
        if (!presentacionEtiqueta) {
            if (Boolean(ba.es_pack) && Number(ba.pack_unidades || 1) > 1) {
                presentacionEtiqueta = Number(ingredienteOrigenId) === 141
                    ? `Pack x ${ba.pack_unidades} (${Math.round((kilosUnidad * 1000) / Number(ba.pack_unidades))}g c/u)`
                    : `Pack x ${ba.pack_unidades} un.`;
            } else if (kilosUnidad < 1) {
                presentacionEtiqueta = `Bolsa ${Math.round(kilosUnidad * 1000)}g`;
            } else {
                presentacionEtiqueta = `Bolsa ${Number(kilosUnidad.toFixed(2))}kg`;
            }
        }

        let catalogoRowActual;
        if (!row) {
            const insCat = await q.query(
                `INSERT INTO public.nodos_articulos_catalogo (
                    sku_nodo, nombre_publico, categoria_familiar, presentacion_etiqueta,
                    flujo_lamda, origen_tipo, ingrediente_origen_id, articulo_bunker_origen_codigo,
                    kilos_unidad, insumo_envase_id, cantidad_envases_unidad, segundos_fraccionamiento,
                    tarifa_colaborador_id, valor_hora_aplicado, costo_insumo_kg,
                    costo_insumo_fraccion, costo_envase_aplicado, costo_mano_obra_aplicado,
                    margen_lamda_pct, iva_pct, iibb_pct, costo_puro_total,
                    precio_base_nodo_neto, precio_base_nodo_final,
                    margen_sugerido_gestor_pct, precio_sugerido_vecino, notas_tecnicas,
                    nomenclatura_bunker, familia_bunker_id, familia_bunker_nombre,
                    articulo_principal_bunker, compartido_mayorista, listas_mayoristas_compartidas,
                    activo, estado
                 ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,3.5,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,true,'APROBADO'
                 )
                 RETURNING *`,
                [
                    skuExacto,
                    nombrePublico,
                    categoriaFamiliar,
                    presentacionEtiqueta,
                    flujoLamda,
                    origenTipo,
                    ingredienteOrigenId,
                    skuExacto,
                    kilosUnidad,
                    insumoEnvaseId,
                    cantidadEnvasesUnidad,
                    segundosFracc,
                    tarifaColabId,
                    valorHoraAplicado,
                    costoInsumoKg,
                    costoInsumoFraccion,
                    costoEnvaseAplicado,
                    costoManoObra,
                    margenLamdaPct,
                    ivaPct,
                    costoPuroTotal,
                    precioBaseNodoNeto,
                    precioBaseNodoFinal,
                    margenSugGestor,
                    precioSugeridoVecino,
                    'Habilitado desde Artículos y Diccionario Búnker',
                    nomenclaturaBunker,
                    familiaBunkerId,
                    familiaBunkerNombre,
                    artPrincipalBunker,
                    compartidoMayorista,
                    JSON.stringify(listasCompIds)
                ]
            );
            catalogoRowActual = insCat.rows[0];
        } else {
            const updCat = await q.query(
                `UPDATE public.nodos_articulos_catalogo SET
                    nombre_publico = $1,
                    categoria_familiar = $2,
                    presentacion_etiqueta = $3,
                    nomenclatura_bunker = $4,
                    articulo_principal_bunker = $5,
                    familia_bunker_id = $6,
                    familia_bunker_nombre = $7,
                    ingrediente_origen_id = COALESCE($8, ingrediente_origen_id),
                    kilos_unidad = $9,
                    insumo_envase_id = $10,
                    cantidad_envases_unidad = $11,
                    segundos_fraccionamiento = $12,
                    tarifa_colaborador_id = $13,
                    valor_hora_aplicado = $14,
                    costo_insumo_kg = $15,
                    costo_insumo_fraccion = $16,
                    costo_envase_aplicado = $17,
                    costo_mano_obra_aplicado = $18,
                    margen_lamda_pct = $19,
                    iva_pct = $20,
                    costo_puro_total = $21,
                    precio_base_nodo_neto = $22,
                    precio_base_nodo_final = $23,
                    precio_sugerido_vecino = $24,
                    compartido_mayorista = $25,
                    listas_mayoristas_compartidas = $26,
                    activo = true,
                    estado = 'APROBADO',
                    updated_at = NOW()
                 WHERE id = $27
                 RETURNING *`,
                [
                    nombrePublico,
                    categoriaFamiliar,
                    presentacionEtiqueta,
                    nomenclaturaBunker,
                    artPrincipalBunker,
                    familiaBunkerId,
                    familiaBunkerNombre,
                    ingredienteOrigenId,
                    kilosUnidad,
                    insumoEnvaseId,
                    cantidadEnvasesUnidad,
                    segundosFracc,
                    tarifaColabId,
                    valorHoraAplicado,
                    costoInsumoKg,
                    costoInsumoFraccion,
                    costoEnvaseAplicado,
                    costoManoObra,
                    margenLamdaPct,
                    ivaPct,
                    costoPuroTotal,
                    precioBaseNodoNeto,
                    precioBaseNodoFinal,
                    precioSugeridoVecino,
                    compartidoMayorista,
                    JSON.stringify(listasCompIds),
                    row.id
                ]
            );
            catalogoRowActual = updCat.rows[0];
        }

        // Propagar a nodos_ofertas_gestor cuando el artículo ya tiene Precio Base Nodo > $0
        if (precioBaseNodoFinal > 0) {
            const nodosActivos = await q.query(
                `SELECT id, margen_gestor_default_pct,
                        COALESCE(alicuota_iva_margen_pct, 21.00) AS alicuota_iva_margen_pct,
                        COALESCE(alicuota_iibb_margen_pct, 4.00) AS alicuota_iibb_margen_pct
                 FROM public.nodos_maestro WHERE activo = true`
            );
            for (const nodo of nodosActivos.rows) {
                const margenDef = Number(nodo.margen_gestor_default_pct || margenSugGestor || 28);
                const calcDefBunker = calcularPrecioYGananciaNetaOfertaNodo({
                    costoBaseLamda: precioBaseNodoFinal,
                    margenPct: margenDef,
                    ivaPct: nodo.alicuota_iva_margen_pct,
                    iibbPct: nodo.alicuota_iibb_margen_pct,
                    modo: 'margen'
                });
                const precioVecino = calcDefBunker.precio_tienda;
                const ganancia = calcDefBunker.ganancia_neta_nodo;

                const exOfHab = await q.query(
                    `SELECT id, precio_base_nodo_snapshot, margen_gestor_pct
                     FROM public.nodos_ofertas_gestor
                     WHERE nodo_id = $1 AND articulo_catalogo_id = $2
                     LIMIT 1`,
                    [nodo.id, catalogoRowActual.id]
                );
                if (exOfHab.rows.length > 0) {
                    const prevOf = exOfHab.rows[0];
                    const mOf = Number(prevOf.margen_gestor_pct ?? margenDef);
                    const calcExBunker = calcularPrecioYGananciaNetaOfertaNodo({
                        costoBaseLamda: precioBaseNodoFinal,
                        margenPct: mOf,
                        ivaPct: nodo.alicuota_iva_margen_pct,
                        iibbPct: nodo.alicuota_iibb_margen_pct,
                        modo: 'margen'
                    });
                    const nPVec = calcExBunker.precio_tienda;
                    const nGan = calcExBunker.ganancia_neta_nodo;
                    const chgCosto = Number(prevOf.precio_base_nodo_snapshot || 0) !== Number(precioBaseNodoFinal || 0);
                    await q.query(
                        `UPDATE public.nodos_ofertas_gestor SET
                            alerta_cambio_costo = $2,
                            precio_base_nodo_snapshot = $3,
                            precio_venta_vecino = $4,
                            ganancia_unitaria_gestor = $5,
                            updated_at = NOW()
                         WHERE id = $1`,
                        [prevOf.id, chgCosto, precioBaseNodoFinal, nPVec, nGan]
                    );
                } else {
                    await q.query(
                        `INSERT INTO public.nodos_ofertas_gestor (
                            nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                            margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor, publicado_tienda
                         ) VALUES ($1,$2,$3,$4,$5,$6,false)`,
                        [nodo.id, catalogoRowActual.id, precioBaseNodoFinal, margenDef, precioVecino, ganancia]
                    );
                }
            }

            if (ingredienteOrigenId) {
                await q.query(
                    `UPDATE public.nodos_propuestas_fracciones SET
                        estado = 'APROBADA',
                        articulo_catalogo_id = $1,
                        respuesta_lamda = $2,
                        updated_at = NOW()
                     WHERE estado = 'PENDIENTE_COTIZACION'
                       AND ingrediente_sugerido_id = $3
                       AND ABS(COALESCE(kilos_sugeridos, 0) - $4) < 0.003`,
                    [
                        catalogoRowActual.id,
                        `Habilitado y cotizado desde Búnker con Precio Base Nodo $${precioBaseNodoFinal.toLocaleString('es-AR')} (${nomenclaturaBunker})`,
                        ingredienteOrigenId,
                        kilosUnidad
                    ]
                );
            }
        } else {
            // Si aún está en $0 (recién tildado en lista antes de cotizar en Finanzas), asegurarse de que no esté publicado a $0 en tienda
            await q.query(
                `UPDATE public.nodos_ofertas_gestor
                 SET publicado_tienda = false, updated_at = NOW()
                 WHERE articulo_catalogo_id = $1`,
                [catalogoRowActual.id]
            );
        }

        if (ownClient) await q.query('COMMIT');
        return { sincronizado: true, sku_nodo: catalogoRowActual.sku_nodo, precio_base_nodo_final: precioBaseNodoFinal };
    } catch (err) {
        if (ownClient) await q.query('ROLLBACK');
        console.error('[NodosBarriales] Error sincronizando desde Búnker:', err.message);
        return { sincronizado: false, error: err.message };
    } finally {
        if (ownClient) q.release();
    }
}

/**
 * Actualiza el margen del gestor y el estado de publicación en su tienda vecinal
 */
async function actualizarOfertaGestor(ofertaId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const cur = await db.query(
        `SELECT nog.*, nac.precio_base_nodo_final, nm.activo AS nodo_activo,
                COALESCE(nm.alicuota_iva_margen_pct, 21.00) AS alicuota_iva_margen_pct,
                COALESCE(nm.alicuota_iibb_margen_pct, 4.00) AS alicuota_iibb_margen_pct
         FROM public.nodos_ofertas_gestor nog
         JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
         JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
         WHERE nog.id = $1`,
        [Number(ofertaId)]
    );
    if (cur.rows.length === 0) {
        throw new Error('Oferta de Nodo no encontrada.');
    }
    if (cur.rows[0].nodo_activo === false) {
        const err = new Error('Este Nodo se encuentra archivado y no permite editar ofertas.');
        err.statusCode = 403;
        throw err;
    }

    const row = cur.rows[0];
    const baseActual = Number(row.precio_base_nodo_final || row.precio_base_nodo_snapshot || 0);
    const ivaMargenPct = Number(row.alicuota_iva_margen_pct ?? 21);
    const iibbMargenPct = Number(row.alicuota_iibb_margen_pct ?? 4);

    let calcOferta;
    if (payload.ganancia_neta_deseada !== undefined && payload.ganancia_neta_deseada !== null && payload.ganancia_neta_deseada !== '') {
        calcOferta = calcularPrecioYGananciaNetaOfertaNodo({
            costoBaseLamda: baseActual,
            gananciaNetaDeseada: payload.ganancia_neta_deseada,
            ivaPct: ivaMargenPct,
            iibbPct: iibbMargenPct,
            modo: 'ganancia_neta'
        });
    } else if (payload.precio_venta_vecino !== undefined && payload.precio_venta_vecino !== null && payload.precio_venta_vecino !== '') {
        calcOferta = calcularPrecioYGananciaNetaOfertaNodo({
            costoBaseLamda: baseActual,
            precioTienda: payload.precio_venta_vecino,
            ivaPct: ivaMargenPct,
            iibbPct: iibbMargenPct,
            modo: 'precio'
        });
    } else if (payload.margen_gestor_pct !== undefined && payload.margen_gestor_pct !== null && payload.margen_gestor_pct !== '') {
        calcOferta = calcularPrecioYGananciaNetaOfertaNodo({
            costoBaseLamda: baseActual,
            margenPct: payload.margen_gestor_pct,
            ivaPct: ivaMargenPct,
            iibbPct: iibbMargenPct,
            modo: 'margen'
        });
    } else {
        // Si solo cambia publicado_tienda / destacado_tienda / nombre_vidriera_personalizado, preservar el precio actual y sincronizar ganancia limpia
        calcOferta = calcularPrecioYGananciaNetaOfertaNodo({
            costoBaseLamda: baseActual,
            precioTienda: row.precio_venta_vecino,
            ivaPct: ivaMargenPct,
            iibbPct: iibbMargenPct,
            modo: 'precio'
        });
    }

    const margenPct = calcOferta.margen_pct;
    const precioVecino = calcOferta.precio_tienda;
    const gananciaUnitaria = calcOferta.ganancia_neta_nodo;
    const publicado = payload.publicado_tienda !== undefined
        ? Boolean(payload.publicado_tienda)
        : Boolean(row.publicado_tienda);
    const destacado = payload.destacado_tienda !== undefined
        ? Boolean(payload.destacado_tienda)
        : Boolean(row.destacado_tienda);
    const mostrarIngredientes = payload.mostrar_ingredientes !== undefined
        ? Boolean(payload.mostrar_ingredientes)
        : (row.mostrar_ingredientes !== false);
    const nombreVidrieraPersonalizado = payload.nombre_vidriera_personalizado !== undefined
        ? (String(payload.nombre_vidriera_personalizado || '').trim() || null)
        : (row.nombre_vidriera_personalizado || null);
    const categoriaVidrieraPersonalizada = payload.categoria_vidriera_personalizada !== undefined
        ? (String(payload.categoria_vidriera_personalizada || '').trim() || null)
        : (row.categoria_vidriera_personalizada || null);
    const narrativaTienda = payload.narrativa_tienda !== undefined
        ? (String(payload.narrativa_tienda || '').trim().slice(0, 600) || null)
        : (row.narrativa_tienda ? String(row.narrativa_tienda).trim().slice(0, 600) : null);
    const portadaModo = payload.portada_modo !== undefined
        ? normalizarModoPortada(payload.portada_modo)
        : normalizarModoPortada(row.portada_modo);
    const portadaMediaId = payload.portada_media_id !== undefined
        ? (String(payload.portada_media_id || '').trim() || null)
        : (row.portada_media_id ? String(row.portada_media_id).trim() : null);

    const upd = await db.query(
        `UPDATE public.nodos_ofertas_gestor SET
            precio_base_nodo_snapshot = $1,
            margen_gestor_pct = $2,
            precio_venta_vecino = $3,
            ganancia_unitaria_gestor = $4,
            publicado_tienda = $5,
            destacado_tienda = $6,
            mostrar_ingredientes = $7,
            nombre_vidriera_personalizado = $8,
            categoria_vidriera_personalizada = $9,
            narrativa_tienda = $10,
            portada_modo = $11,
            portada_media_id = $12,
            alerta_cambio_costo = false,
            updated_at = NOW()
         WHERE id = $13
         RETURNING *`,
        [
            baseActual,
            margenPct,
            precioVecino,
            gananciaUnitaria,
            publicado,
            destacado,
            mostrarIngredientes,
            nombreVidrieraPersonalizado,
            categoriaVidrieraPersonalizada,
            narrativaTienda,
            portadaModo,
            portadaModo === 'CUSTOM' ? portadaMediaId : null,
            Number(ofertaId)
        ]
    );

    return upd.rows[0];
}

// ============================================================================
// ETAPA 2: MOTOR DE CORTE HORARIO (CUTOFF), PANEL DEL GESTOR Y TIENDA VECINAL
// ============================================================================

const MAPA_DIAS_SEMANA = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    'miércoles': 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    'sábado': 6
};

const NOMBRES_DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function normalizarDiaIndex(nombreDia) {
    const key = String(nombreDia || '').trim().toLowerCase();
    return MAPA_DIAS_SEMANA[key] !== undefined ? MAPA_DIAS_SEMANA[key] : 3;
}

function formatearFechaCortaEs(dateObj) {
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    return `${d}/${m}`;
}

/**
 * Calcula qué fecha y ventana de entrega corresponde hoy para un Nodo según sus
 * días de entrega y horarios de corte (cutoff).
 * Si el vecino entra después del horario de corte de la entrega más próxima,
 * asigna automáticamente la siguiente fecha de entrega disponible e informa el motivo.
 */
function calcularProximaEntregaNodo(configVentanas = [], fechaReferenciaInput = null) {
    const ahora = fechaReferenciaInput ? new Date(fechaReferenciaInput) : new Date();
    const reglas = Array.isArray(configVentanas) && configVentanas.length > 0
        ? configVentanas
        : [
            { dia_entrega: 'Miércoles', cierre_dia: 'Martes', cierre_hora: '14:00', ventana_retiro: '17:00 a 20:00 hs' },
            { dia_entrega: 'Sábado', cierre_dia: 'Viernes', cierre_hora: '14:00', ventana_retiro: '10:00 a 13:30 hs' }
        ];

    const candidatas = [];

    for (let offsetDias = 0; offsetDias <= 21; offsetDias++) {
        const fechaEntrega = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + offsetDias, 12, 0, 0);
        const dowEntrega = fechaEntrega.getDay();

        for (const regla of reglas) {
            const targetDowEntrega = normalizarDiaIndex(regla.dia_entrega);
            if (dowEntrega !== targetDowEntrega) continue;

            const targetDowCierre = normalizarDiaIndex(regla.cierre_dia);
            let diffCierre = (targetDowEntrega - targetDowCierre + 7) % 7;
            if (diffCierre === 0) diffCierre = 1;

            const [hh, mm] = String(regla.cierre_hora || '14:00').split(':').map(n => Number(n) || 0);
            const fechaCorte = new Date(
                fechaEntrega.getFullYear(),
                fechaEntrega.getMonth(),
                fechaEntrega.getDate() - diffCierre,
                hh,
                mm,
                0
            );

            // Solo considerar entregas futuras (desde hoy en adelante)
            const finDiaEntrega = new Date(fechaEntrega.getFullYear(), fechaEntrega.getMonth(), fechaEntrega.getDate(), 23, 59, 59);
            if (finDiaEntrega < ahora) continue;

            const nombreDiaEntrega = NOMBRES_DIAS[dowEntrega];
            const nombreDiaCierre = NOMBRES_DIAS[fechaCorte.getDay()];
            const fechaCorta = formatearFechaCortaEs(fechaEntrega);
            const fechaIso = `${fechaEntrega.getFullYear()}-${String(fechaEntrega.getMonth() + 1).padStart(2, '0')}-${String(fechaEntrega.getDate()).padStart(2, '0')}`;

            candidatas.push({
                fecha_entrega_iso: fechaIso,
                fecha_entrega_corta: fechaCorta,
                dia_entrega_nombre: nombreDiaEntrega,
                ventana_retiro: regla.ventana_retiro || '17:00 a 20:00 hs',
                cierre_dia_nombre: nombreDiaCierre,
                cierre_hora: regla.cierre_hora || '14:00',
                cierre_fecha_corta: formatearFechaCortaEs(fechaCorte),
                timestamp_entrega: fechaEntrega.getTime(),
                timestamp_corte: fechaCorte.getTime(),
                abierta: ahora.getTime() <= fechaCorte.getTime(),
                label_completo: `${nombreDiaEntrega} ${fechaCorta} (${regla.ventana_retiro || '17:00 a 20:00 hs'})`,
                label_corte: `${nombreDiaCierre} ${formatearFechaCortaEs(fechaCorte)} a las ${regla.cierre_hora || '14:00'} hs`
            });
        }
    }

    candidatas.sort((a, b) => a.timestamp_entrega - b.timestamp_entrega);

    const primeraAbierta = candidatas.find(c => c.abierta) || candidatas[0];
    const cerradaReciente = candidatas.find(c => !c.abierta && c.timestamp_entrega < (primeraAbierta?.timestamp_entrega || Infinity));

    return {
        ahora_iso: ahora.toISOString(),
        asignada: primeraAbierta,
        paso_horario_corte: Boolean(cerradaReciente),
        entrega_anterior_cerrada: cerradaReciente || null,
        proximas_ventanas: candidatas.filter(c => c.abierta).slice(0, 4),
        mensaje_vecino: cerradaReciente
            ? `El cierre para la entrega del ${cerradaReciente.dia_entrega_nombre} ${cerradaReciente.fecha_entrega_corta} finalizó el ${cerradaReciente.cierre_dia_nombre} a las ${cerradaReciente.cierre_hora} hs. Tu pedido se agenda automáticamente para el ${primeraAbierta.label_completo}.`
            : `Pedidos abiertos hasta el ${primeraAbierta.label_corte} para recibir o retirar el ${primeraAbierta.label_completo}.`
    };
}

/**
 * Devuelve el catálogo técnico oficial de ingredientes comercializables o producibles por LAMDA
 * para que el Gestor del Nodo solicite nuevas fracciones desde su panel hablando el mismo idioma
 * oficial de LAMDA ([codigo] nombre real de public.ingredientes y familias reales de Búnker/Ingredientes),
 * sin diccionarios intermedios y sin exponer costos ni fórmulas internas.
 */
async function obtenerCatalogoIngredientesSolicitablesGestor() {
    const [ingRes, compRes, famRes, plantaInfo] = await Promise.all([
        db.query(`
            SELECT i.id, i.codigo, i.nombre, i.articulo_vinculado_numero,
                   ci.nombre AS categoria_ingrediente_nombre
            FROM public.ingredientes i
            LEFT JOIN public.categorias_ingredientes ci ON ci.id = i.categoria_id
            WHERE COALESCE(i.es_insumo, false) = false
              AND i.id < 8000
              AND i.nombre NOT ILIKE '%Fuera de Servicio%'
              AND i.nombre NOT ILIKE '%Para Mix%'
              AND i.nombre NOT ILIKE '%Test E2E%'
            ORDER BY i.id ASC
        `),
        db.query(`
            SELECT DISTINCT mix_id AS ingrediente_padre_id
            FROM public.ingrediente_composicion
        `),
        db.query(`
            SELECT DISTINCT ON (ri.ingrediente_id)
                   ri.ingrediente_id,
                   bf.nombre AS familia_nombre
            FROM public.receta_ingredientes ri
            JOIN public.recetas r ON r.id = ri.receta_id
            JOIN public.bunker_articulos ba ON ba.articulo_id = r.articulo_numero
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            WHERE COALESCE(ba.familia_id, 0) > 0
              AND COALESCE(ba.familia_id, 0) <> 42
            ORDER BY ri.ingrediente_id,
                     CASE WHEN COALESCE(ba.kilos_unidad, 1) BETWEEN 0.05 AND 1.00 THEN 0 ELSE 1 END,
                     ba.kilos_unidad ASC
        `),
        obtenerPresentacionesPlantaLamda()
    ]);

    const idsCompuestosSet = new Set(compRes.rows.map(r => Number(r.ingrediente_padre_id)));
    // Excluir pre-mezclas e insumos internos de UP externa (se exponen sus ingredientes puente terminados: #122, #131, #141, etc.)
    const idsIntermediosExcluidos = new Set([109, 132, 133, 134, 135, 136, 140]);
    const mapaFamilias = new Map(famRes.rows.map(r => [Number(r.ingrediente_id), r.familia_nombre]));
    const mapaPresGestor = plantaInfo ? plantaInfo.porIngredienteGestor : new Map();

    return ingRes.rows
        .filter(ing => {
            const idNum = Number(ing.id);
            if (idsCompuestosSet.has(idNum)) return false;
            if (idsIntermediosExcluidos.has(idNum)) return false;
            return true;
        })
        .map(ing => {
            const idNum = Number(ing.id);
            const fam = mapaFamilias.get(idNum) || ing.categoria_ingrediente_nombre || null;
            const ident = resolverIdentidadTecnicaIngrediente(ing, fam, idsCompuestosSet);
            return {
                id: idNum,
                codigo: ident.codigo,
                nombre_oficial: ident.nombre_oficial,
                label_oficial: ident.label_oficial,
                nombre_claro: ident.label_oficial,
                categoria_lamda: ident.categoria_lamda,
                categoria_gestor: ident.categoria_lamda,
                articulo_vinculado_numero: ident.articulo_vinculado_numero,
                flujo: ident.flujo,
                flujo_nombre: ident.flujo_nombre,
                es_pack_barritas: ident.es_pack_barritas,
                presentaciones_lamda: mapaPresGestor.get(idNum) || []
            };
        })
        .sort((a, b) => {
            const diffCat = String(a.categoria_lamda || '').localeCompare(String(b.categoria_lamda || ''), 'es');
            if (diffCat !== 0) return diffCat;
            return String(a.nombre_oficial || '').localeCompare(String(b.nombre_oficial || ''), 'es');
        });
}

/**
 * Obtiene todos los datos necesarios para la Tienda Marca Blanca del Vecino y
 * para el Panel de Autogestión del Gestor de un Nodo específico (:slug).
 */
async function obtenerDatosPortalNodo(slug = '', fechaHoraSimulada = null, opciones = {}) {
    await asegurarEsquemaNodosBarriales();
    const esVistaGestor = String(opciones?.vista || '').trim().toLowerCase() === 'gestor';
    const cleanSlug = String(slug || '').trim();
    const strictSlug = Boolean(opciones?.strictSlug);

    let nodoRes = await db.query(
        `SELECT nm.*,
                COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente,
                bc_madre.cliente_nombre AS cliente_madre_nombre,
                bc_madre.razon_social AS cliente_madre_razon_social,
                bc_madre.lomas_soft_id AS cliente_madre_lomas_id,
                COALESCE(cc_madre.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente_madre
         FROM public.nodos_maestro nm
         LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
         LEFT JOIN public.bunker_clientes bc_madre ON bc_madre.id = nm.cliente_madre_bunker_id
         LEFT JOIN public.factura_cuentas_corrientes cc_madre
           ON cc_madre.codigo_bunker_cliente = nm.codigo_bunker_cliente_madre
          AND cc_madre.nombre_cuenta = 'Cuenta Principal'
         WHERE (LOWER(nm.slug) = LOWER($1) OR LOWER(COALESCE(nm.slug_historico, '')) = LOWER($1))
           AND COALESCE(nm.activo, true) = true
         ORDER BY CASE WHEN LOWER(nm.slug) = LOWER($1) THEN 0 ELSE 1 END, nm.id ASC
         LIMIT 1`,
        [cleanSlug]
    );

    if (nodoRes.rows.length === 0 && !cleanSlug && !strictSlug) {
        nodoRes = await db.query(
            `SELECT nm.*,
                    COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente,
                    bc_madre.cliente_nombre AS cliente_madre_nombre,
                    bc_madre.razon_social AS cliente_madre_razon_social,
                    bc_madre.lomas_soft_id AS cliente_madre_lomas_id,
                    COALESCE(cc_madre.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente_madre
             FROM public.nodos_maestro nm
             LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
             LEFT JOIN public.bunker_clientes bc_madre ON bc_madre.id = nm.cliente_madre_bunker_id
             LEFT JOIN public.factura_cuentas_corrientes cc_madre
               ON cc_madre.codigo_bunker_cliente = nm.codigo_bunker_cliente_madre
              AND cc_madre.nombre_cuenta = 'Cuenta Principal'
             WHERE COALESCE(nm.activo, true) = true
             ORDER BY nm.id ASC
             LIMIT 1`
        );
    }

    if (nodoRes.rows.length === 0) {
        if (cleanSlug) {
            const archCheck = await db.query(
                `SELECT id FROM public.nodos_maestro
                 WHERE (LOWER(slug) = LOWER($1) OR LOWER(COALESCE(slug_historico, '')) = LOWER($1))
                   AND activo = false
                 LIMIT 1`,
                [cleanSlug]
            );
            if (archCheck.rows.length > 0) {
                const err = new Error(`El Nodo Barrial "${cleanSlug}" se encuentra pausado o archivado.`);
                err.statusCode = 404;
                throw err;
            }
        }
        const err = new Error(
            cleanSlug
                ? `Nodo Barrial "${cleanSlug}" no encontrado.`
                : 'No hay Nodos Barriales activos configurados.'
        );
        err.statusCode = 404;
        throw err;
    }

    const nodo = nodoRes.rows[0];
    const proximaEntrega = calcularProximaEntregaNodo(nodo.config_ventanas_corte, fechaHoraSimulada);

    const mostrarIngredientesNodo = nodo.mostrar_ingredientes_tienda !== false;

    const [ofertasRes, propuestasRes, pedidosRes, itemsPedidosRes, movsRes, ingredientesSolicitables, catDisponibleRes, catalogoIngredientes] = await Promise.all([
        db.query(
            `SELECT nog.*,
                    nac.sku_nodo,
                    COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_oficial_lamda,
                    COALESCE(bf.nombre, ba.rubro, nac.familia_bunker_nombre, nac.categoria_familiar) AS categoria_oficial_lamda,
                    ba.rubro AS bunker_rubro,
                    ba.sub_rubro AS bunker_subrubro,
                    nac.nombre_publico,
                    nac.categoria_familiar,
                    nac.presentacion_etiqueta,
                    nac.kilos_unidad,
                    nac.flujo_lamda,
                    nac.ingrediente_origen_id,
                    nac.articulo_bunker_origen_codigo,
                    nac.precio_base_nodo_final,
                    COALESCE(nac.fotos_catalogo_base, '[]'::jsonb) AS fotos_catalogo_base
             FROM public.nodos_ofertas_gestor nog
             JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
             LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(nac.sku_nodo)
             LEFT JOIN public.bunker_familias bf ON bf.id = COALESCE(ba.familia_id, nac.familia_bunker_id)
             WHERE nog.nodo_id = $1
               AND nac.activo = true
               AND nac.precio_base_nodo_final > 0
             ORDER BY nog.destacado_tienda DESC,
                      COALESCE(bf.nombre, ba.rubro, nac.familia_bunker_nombre, nac.categoria_familiar) ASC,
                      COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) ASC`,
            [nodo.id]
        ),
        db.query(
            `SELECT npf.id, npf.codigo_propuesta, npf.nodo_solicitante_id, npf.nombre_sugerido,
                    npf.alias_vidriera_sugerido, npf.articulo_catalogo_id,
                    npf.categoria_sugerida, npf.ingrediente_sugerido_id, npf.flujo_sugerido,
                    npf.articulo_bunker_sugerido_codigo, npf.kilos_sugeridos, npf.precio_objetivo_vecino,
                    npf.comentario_gestor, npf.estado, npf.respuesta_lamda, npf.created_at,
                    ing.codigo AS ingrediente_codigo, ing.nombre AS ingrediente_nombre
             FROM public.nodos_propuestas_fracciones npf
             LEFT JOIN public.ingredientes ing ON ing.id = npf.ingrediente_sugerido_id
             WHERE npf.nodo_solicitante_id = $1
               AND COALESCE(npf.estado, '') <> 'ANULADA'
             ORDER BY npf.id DESC`,
            [nodo.id]
        ),
        esVistaGestor
            ? db.query(
                `SELECT npv.*,
                        nle.codigo_canasto AS lote_codigo_canasto,
                        nle.estado_canasto AS lote_estado_canasto,
                        COALESCE(nle.debito_cta_cte_registrado, false) AS lote_debito_registrado,
                        nv.latitud AS vecino_latitud,
                        nv.longitud AS vecino_longitud,
                        nv.gps_origen AS vecino_gps_origen,
                        nv.direccion_calle AS vecino_direccion_calle,
                        nv.entrecalles_referencia AS vecino_entrecalles,
                        COALESCE(nv.gps_verificado_gestor, false) AS vecino_gps_verificado,
                        npep.operador_postal AS postal_operador,
                        npep.modalidad_postal AS postal_modalidad,
                        npep.sucursal_nombre AS postal_sucursal_nombre,
                        npep.cp_destino AS postal_cp_destino,
                        npep.provincia_nombre AS postal_provincia_nombre,
                        npep.localidad_nombre AS postal_localidad_nombre,
                        npep.calle AS postal_calle,
                        npep.altura AS postal_altura,
                        npep.piso_depto AS postal_piso_depto,
                        npep.destinatario_dni AS postal_destinatario_dni,
                        npep.costo_envio_cliente AS postal_costo_envio_cliente,
                        npep.numero_tracking AS postal_numero_tracking,
                        npep.url_tracking_carrier AS postal_url_tracking_carrier,
                        npep.estado_envio AS postal_estado_envio,
                        npep.costo_flete_lamda AS postal_costo_flete_lamda,
                        npep.fecha_despacho AS postal_fecha_despacho
                 FROM public.nodos_pedidos_vecinos npv
                 LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
                 LEFT JOIN public.nodos_vecinos nv ON nv.id = npv.vecino_id
                 LEFT JOIN public.nodos_pedidos_envios_postales npep ON npep.pedido_id = npv.id
                 WHERE npv.nodo_id = $1
                 ORDER BY npv.id DESC
                 LIMIT 120`,
                [nodo.id]
            )
            : Promise.resolve({ rows: [] }),
        esVistaGestor
            ? db.query(
                `SELECT npi.*,
                        COALESCE(nac.sku_nodo, npi.sku_nodo) AS sku_oficial_lamda,
                        COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, npi.nombre_publico) AS nombre_oficial_lamda,
                        COALESCE(NULLIF(TRIM(npi.nombre_vidriera_vecino), ''), NULLIF(TRIM(nog.nombre_vidriera_personalizado), ''), COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, npi.nombre_publico)) AS nombre_vidriera_efectivo
                 FROM public.nodos_pedidos_items npi
                 JOIN public.nodos_pedidos_vecinos npv ON npv.id = npi.pedido_id
                 LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
                 LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, npi.sku_nodo))
                 LEFT JOIN public.nodos_ofertas_gestor nog ON nog.nodo_id = npv.nodo_id AND nog.articulo_catalogo_id = npi.articulo_catalogo_id
                 WHERE npv.nodo_id = $1
                 ORDER BY npi.id ASC`,
                [nodo.id]
            )
            : Promise.resolve({ rows: [] }),
        esVistaGestor
            ? db.query(
                `SELECT nmc.*, nle.codigo_canasto
                 FROM public.nodos_movimientos_cta_cte nmc
                 LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = nmc.lote_canasto_id
                 WHERE nmc.nodo_id = $1
                 ORDER BY nmc.id DESC
                 LIMIT 30`,
                [nodo.id]
            )
            : Promise.resolve({ rows: [] }),
        esVistaGestor ? obtenerCatalogoIngredientesSolicitablesGestor() : Promise.resolve([]),
        esVistaGestor
            ? db.query(
                `SELECT nac.id AS catalogo_id,
                        nac.sku_nodo,
                        COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_oficial_lamda,
                        COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_publico,
                        COALESCE(bf.nombre, ba.rubro, nac.familia_bunker_nombre, nac.categoria_familiar) AS categoria_familiar,
                        nac.presentacion_etiqueta,
                        nac.kilos_unidad,
                        nac.ingrediente_origen_id,
                        nac.precio_base_nodo_final
                 FROM public.nodos_articulos_catalogo nac
                 LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(nac.sku_nodo)
                 LEFT JOIN public.bunker_familias bf ON bf.id = COALESCE(ba.familia_id, nac.familia_bunker_id)
                 WHERE nac.activo = true
                   AND nac.precio_base_nodo_final > 0
                   AND NOT EXISTS (
                       SELECT 1 FROM public.nodos_ofertas_gestor nog
                       WHERE nog.nodo_id = $1 AND nog.articulo_catalogo_id = nac.id
                   )
                 ORDER BY COALESCE(bf.nombre, ba.rubro, nac.familia_bunker_nombre, nac.categoria_familiar) ASC,
                          COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) ASC`,
                [nodo.id]
            )
            : Promise.resolve({ rows: [] }),
        (mostrarIngredientesNodo || esVistaGestor)
            ? construirCatalogoIngredientesComerciales().catch(() => null)
            : Promise.resolve(null)
    ]);

    const aliasSugeridoPorCatId = new Map();
    const propuestasEnriquecidas = propuestasRes.rows.map(pr => {
        if (pr.articulo_catalogo_id && pr.alias_vidriera_sugerido && !aliasSugeridoPorCatId.has(Number(pr.articulo_catalogo_id))) {
            aliasSugeridoPorCatId.set(Number(pr.articulo_catalogo_id), String(pr.alias_vidriera_sugerido).trim());
        }
        return {
            ...pr,
            ingrediente_label_oficial: pr.ingrediente_sugerido_id
                ? formatearEtiquetaTecnicaIngrediente({ id: pr.ingrediente_sugerido_id, codigo: pr.ingrediente_codigo, nombre: pr.ingrediente_nombre })
                : null
        };
    });

    const itemsPorPedido = new Map();
    for (const it of itemsPedidosRes.rows) {
        const pid = Number(it.pedido_id);
        if (!itemsPorPedido.has(pid)) itemsPorPedido.set(pid, []);
        const skuOf = it.sku_oficial_lamda || it.sku_nodo || '';
        const nomOf = it.nombre_oficial_lamda || it.nombre_publico;
        itemsPorPedido.get(pid).push({
            ...it,
            sku_nodo: skuOf,
            nombre_oficial_lamda: nomOf,
            etiqueta_oficial_lamda: formatearEtiquetaTecnicaArticulo(skuOf, nomOf),
            nombre_vidriera_vecino: it.nombre_vidriera_efectivo || nomOf,
            nombre_publico: nomOf
        });
    }

    const [cfgCanalActiva, mapaPagosGestor] = await Promise.all([
        pagosBancariosService.obtenerConfiguracionBancariaCanalNodos(),
        esVistaGestor && pedidosRes.rows.length > 0
            ? pagosBancariosService.obtenerResumenPagosPorPedidosIds(
                pedidosRes.rows.map(r => Number(r.id)),
                null,
                { incluirTokenComprobante: true }
            )
            : Promise.resolve(new Map())
    ]);

    const pedidosConItems = pedidosRes.rows.map(p => {
        const resPago = pagosBancariosService.enriquecerPedidoConResumenPago(p, mapaPagosGestor.get(Number(p.id)));
        const pagoConfirmado = resPago.pago_confirmado;
        const hitoActual = Number(p.hito_tracking_actual || resolverHitoDesdeEstadoOperativo(p.estado_operativo, p.secuencia_operativa_lamda));
        const latPedido = p.latitud != null ? Number(p.latitud) : null;
        const lngPedido = p.longitud != null ? Number(p.longitud) : null;
        const latVecino = p.vecino_latitud != null ? Number(p.vecino_latitud) : null;
        const lngVecino = p.vecino_longitud != null ? Number(p.vecino_longitud) : null;
        return {
            ...p,
            ...resPago,
            latitud: Number.isFinite(latPedido) ? latPedido : null,
            longitud: Number.isFinite(lngPedido) ? lngPedido : null,
            vecino_latitud: Number.isFinite(latVecino) ? latVecino : null,
            vecino_longitud: Number.isFinite(lngVecino) ? lngVecino : null,
            vecino_gps_verificado: Boolean(p.vecino_gps_verificado),
            orden_reparto: p.orden_reparto != null ? Number(p.orden_reparto) : null,
            ausente_pasa_retirar: Boolean(p.ausente_pasa_retirar),
            en_hoja_ruta: p.en_hoja_ruta !== false,
            incluido_reparto_manual: Boolean(p.incluido_reparto_manual),
            hito_tracking_actual: hitoActual,
            pago_confirmado: pagoConfirmado,
            items: itemsPorPedido.get(Number(p.id)) || []
        };
    });

    const normalizarFotosGestor = (rawArr, permitirRutasCatalogoBase = false) => {
        if (!Array.isArray(rawArr)) return [];
        return rawArr
            .filter(f => {
                if (!f || typeof f !== 'object' || !f.id || !f.url) return false;
                const u = String(f.url);
                if (u.toLowerCase().includes('_orig.webp')) return false;
                if (/^\/media\/nodos\/\d+\/\d+\/[a-z0-9_-]+\.webp(\?.*)?$/i.test(u)) return true;
                if (permitirRutasCatalogoBase && /^\/(?:media\/nodos|img)\/[a-z0-9/_.-]+\.(?:webp|png|jpe?g)(\?.*)?$/i.test(u)) return true;
                return false;
            })
            .slice()
            .sort((a, b) => (Number(a.orden || 0) - Number(b.orden || 0)))
            .map((f, idx) => ({
                id: String(f.id),
                url: String(f.url),
                width: Number(f.width || 0) || null,
                height: Number(f.height || 0) || null,
                bytes: Number(f.bytes || 0) || null,
                orden: idx + 1,
                filtro_aplicado: f.filtro_aplicado !== false,
                rotacion: Number(f.rotacion || 0) || 0,
                crop: (f.crop && typeof f.crop === 'object') ? f.crop : null,
                created_at: f.created_at || null,
                updated_at: f.updated_at || null
            }));
    };

    const ofertasConDesglose = await Promise.all(
        ofertasRes.rows.map(async (o) => {
            const desglose = catalogoIngredientes
                ? await resolverDesgloseIngredientesOfertaNodo(db, o, catalogoIngredientes)
                : null;
            const listaIngredientes = (desglose && Array.isArray(desglose.ingredientes) && desglose.ingredientes.length >= 2)
                ? desglose.ingredientes
                : [];
            const tieneDesgloseIngredientes = listaIngredientes.length >= 2;
            const mostrarEnOferta = o.mostrar_ingredientes !== false;
            const nombreOficialLamda = o.nombre_oficial_lamda || o.nombre_publico;
            const rawCatLamda = String(o.categoria_oficial_lamda || o.categoria_familiar || 'Almacén').trim();
            const categoriaOficialLamda = (rawCatLamda === rawCatLamda.toUpperCase() && rawCatLamda.length > 2)
                ? rawCatLamda.toLowerCase().replace(/(^|\s)\S/g, l => l.toUpperCase())
                : rawCatLamda;
            const nombreVidrieraPers = o.nombre_vidriera_personalizado ? String(o.nombre_vidriera_personalizado).trim() : '';
            const categoriaVidrieraPers = o.categoria_vidriera_personalizada ? String(o.categoria_vidriera_personalizada).trim() : '';
            const nombreVidrieraEfectivo = nombreVidrieraPers || nombreOficialLamda;
            const categoriaVidrieraEfectiva = categoriaVidrieraPers || categoriaOficialLamda;
            const narrativaTienda = o.narrativa_tienda ? String(o.narrativa_tienda).trim().slice(0, 600) : null;
            const fotosPropias = normalizarFotosGestor(o.fotos_vidriera, false);
            const fotosBase = normalizarFotosGestor(o.fotos_catalogo_base, true);
            const videosPropios = normalizarArrayVideosBd(o.videos_vidriera);
            const galeriaInfo = construirGaleriaYPortadaOferta({
                fotosPropias,
                fotosBase,
                videosPropios,
                portadaModo: o.portada_modo,
                portadaMediaId: o.portada_media_id
            });
            return {
                ...o,
                nombre_publico: nombreOficialLamda,
                categoria_familiar: categoriaOficialLamda,
                nombre_oficial_lamda: nombreOficialLamda,
                etiqueta_oficial_lamda: formatearEtiquetaTecnicaArticulo(o.sku_nodo, nombreOficialLamda),
                categoria_oficial_lamda: categoriaOficialLamda,
                nombre_vidriera_personalizado: nombreVidrieraPers || null,
                categoria_vidriera_personalizada: categoriaVidrieraPers || null,
                nombre_vidriera_efectivo: nombreVidrieraEfectivo,
                categoria_vidriera_efectiva: categoriaVidrieraEfectiva,
                narrativa_tienda: narrativaTienda,
                alias_sugerido_previo: aliasSugeridoPorCatId.get(Number(o.articulo_catalogo_id)) || null,
                linea_negocio: desglose ? Number(desglose.linea_negocio || 0) || null : null,
                mostrar_ingredientes: mostrarEnOferta,
                tiene_desglose_ingredientes: tieneDesgloseIngredientes,
                ingredientes_comerciales: listaIngredientes,
                fotos_vidriera: fotosPropias,
                fotos_catalogo_base: fotosBase,
                videos_vidriera: videosPropios,
                portada_modo: galeriaInfo.portada_modo_efectivo,
                portada_media_id: o.portada_media_id ? String(o.portada_media_id) : null,
                portada_activa: galeriaInfo.portada_activa,
                galeria_multimedia: galeriaInfo.galeria_multimedia
            };
        })
    );

    const ofertasPublicadas = ofertasConDesglose
        .filter(o => o.publicado_tienda)
        .map(o => {
            const habilitarBotonIng = Boolean(
                mostrarIngredientesNodo &&
                o.mostrar_ingredientes !== false &&
                o.tiene_desglose_ingredientes
            );
            const fotosEfectivas = (Array.isArray(o.fotos_vidriera) && o.fotos_vidriera.length > 0)
                ? o.fotos_vidriera
                : (Array.isArray(o.fotos_catalogo_base) ? o.fotos_catalogo_base : []);
            const fotosPublicas = fotosEfectivas.map((f, idx) => ({
                id: f.id,
                url: f.url,
                width: f.width,
                height: f.height,
                orden: idx + 1
            }));
            const videosPublicos = (Array.isArray(o.videos_vidriera) ? o.videos_vidriera : []).map((v, idx) => ({
                id: v.id,
                tipo: 'video',
                url: v.url,
                poster_url: v.poster_url || '',
                width: v.width,
                height: v.height,
                duration_sec: v.duration_sec || 0,
                tiene_audio: Boolean(v.tiene_audio),
                orden: idx + 1
            }));
            return {
                oferta_id: o.id,
                articulo_catalogo_id: o.articulo_catalogo_id,
                sku_nodo: o.sku_nodo,
                nombre_publico: o.nombre_vidriera_efectivo,
                categoria_familiar: o.categoria_vidriera_efectiva,
                narrativa_tienda: o.narrativa_tienda || null,
                presentacion_etiqueta: o.presentacion_etiqueta,
                kilos_unidad: Number(o.kilos_unidad),
                flujo_lamda: Number(o.flujo_lamda || 0) || null,
                linea_negocio: o.linea_negocio || null,
                precio_venta_vecino: Number(o.precio_venta_vecino),
                destacado_tienda: Boolean(o.destacado_tienda),
                mostrar_ingredientes: habilitarBotonIng,
                ingredientes_comerciales: habilitarBotonIng ? o.ingredientes_comerciales : [],
                portada_modo: o.portada_modo || 'AUTO',
                portada_activa: o.portada_activa || null,
                galeria_multimedia: Array.isArray(o.galeria_multimedia) ? o.galeria_multimedia : [],
                videos_vidriera: videosPublicos,
                fotos_vidriera: fotosPublicas
            };
        });

    const perfilOperativoNodo = normalizarPerfilOperativoNodo(nodo.perfil_operativo);
    const modulosActivosNodo = resolverModulosActivosNodo(nodo);
    const configPaqueteriaNodo = normalizarConfigPaqueteria(nodo.config_paqueteria);
    const diccionarioTextosNodo = (nodo.diccionario_textos && typeof nodo.diccionario_textos === 'object' && !Array.isArray(nodo.diccionario_textos))
        ? nodo.diccionario_textos
        : {};

    const puedeRetiroNodo = Boolean(modulosActivosNodo.retiro_punto && nodo.permitir_retiro_nodo !== false);
    const puedeRepartoPropio = Boolean(modulosActivosNodo.reparto_zonal && (nodo.permitir_reparto_propio ?? nodo.permitir_envio_barrial ?? false));
    const puedeEncomiendaNodo = Boolean(modulosActivosNodo.envio_paqueteria || nodo.permitir_encomienda);
    const cobroEfectivoNodo = Boolean(nodo.cobro_efectivo_entrega ?? modulosActivosNodo.cobro_efectivo_entrega);
    modulosActivosNodo.cobro_efectivo_entrega = cobroEfectivoNodo;
    const permiteEfectivoNodo = Boolean(!cfgCanalActiva.solo_transferencia_bancaria && cobroEfectivoNodo);

    const bancoEfectivo = nodo.banco_display || cfgCanalActiva.banco_recaudador;
    const aliasEfectivo = nodo.alias_bancario_display || cfgCanalActiva.alias_recaudador;
    const cbuEfectivo = nodo.cbu_display || cfgCanalActiva.cbu_recaudador;
    const titularEfectivo = nodo.titular_display || cfgCanalActiva.titular_recaudador;
    const cuilEfectivo = nodo.cuil_display || cfgCanalActiva.cuil_recaudador;
    const nroCuentaEfectivo = nodo.numero_cuenta_display || cfgCanalActiva.numero_cuenta_recaudador;

    const modoVidrieraNodo = normalizarModoVidrieraTienda(nodo.modo_vidriera_tienda);

    const { gestor_token: _omitGestorToken, ...nodoSinToken } = nodo;
    const nodoPublico = esVistaGestor
        ? {
            ...nodoSinToken,
            modo_vidriera_tienda: modoVidrieraNodo,
            banco_display: bancoEfectivo,
            alias_bancario_display: aliasEfectivo,
            cbu_display: cbuEfectivo,
            titular_display: titularEfectivo,
            cuil_display: cuilEfectivo,
            numero_cuenta_display: nroCuentaEfectivo,
            solo_transferencia_bancaria: Boolean(cfgCanalActiva.solo_transferencia_bancaria),
            cobro_efectivo_entrega: cobroEfectivoNodo,
            perfil_operativo: perfilOperativoNodo,
            modulos_activos: modulosActivosNodo,
            config_paqueteria: configPaqueteriaNodo,
            diccionario_textos: diccionarioTextosNodo,
            mostrar_ingredientes_tienda: mostrarIngredientesNodo,
            permitir_retiro_nodo: puedeRetiroNodo,
            permitir_reparto_propio: puedeRepartoPropio,
            permitir_encomienda: puedeEncomiendaNodo,
            permitir_envio_barrial: puedeRepartoPropio,
            permitir_efectivo: permiteEfectivoNodo
        }
        : {
            id: nodo.id,
            codigo_nodo: nodo.codigo_nodo,
            slug: nodo.slug,
            slug_historico: nodo.slug_historico || null,
            nombre_marca: nodo.nombre_marca,
            bajada_marca: nodo.bajada_marca || null,
            subtitulo_marca: nodo.subtitulo_marca,
            modo_vidriera_tienda: modoVidrieraNodo,
            gestor_nombre: nodo.gestor_nombre,
            gestor_telefono: nodo.gestor_telefono,
            barrio_zona: nodo.barrio_zona,
            direccion_retiro: nodo.direccion_retiro,
            banco_display: bancoEfectivo,
            alias_bancario_display: aliasEfectivo,
            cbu_display: cbuEfectivo,
            titular_display: titularEfectivo,
            cuil_display: cuilEfectivo,
            numero_cuenta_display: nroCuentaEfectivo,
            solo_transferencia_bancaria: Boolean(cfgCanalActiva.solo_transferencia_bancaria),
            cobro_efectivo_entrega: cobroEfectivoNodo,
            perfil_operativo: perfilOperativoNodo,
            modulos_activos: modulosActivosNodo,
            config_paqueteria: configPaqueteriaNodo,
            diccionario_textos: diccionarioTextosNodo,
            permitir_envio_barrial: puedeRepartoPropio,
            permitir_retiro_nodo: puedeRetiroNodo,
            permitir_reparto_propio: puedeRepartoPropio,
            permitir_encomienda: puedeEncomiendaNodo,
            permitir_efectivo: permiteEfectivoNodo,
            mostrar_ingredientes_tienda: mostrarIngredientesNodo,
            cargo_envio_barrial: nodo.cargo_envio_barrial,
            zona_centro_lat: puedeRepartoPropio && nodo.latitud != null ? Number(nodo.latitud) : null,
            zona_centro_lng: puedeRepartoPropio && nodo.longitud != null ? Number(nodo.longitud) : null,
            config_ventanas_corte: nodo.config_ventanas_corte,
            color_primario: nodo.color_primario,
            tema_visual: (nodo.tema_visual && typeof nodo.tema_visual === 'object') ? nodo.tema_visual : {},
            logo_original_base64: nodo.logo_original_base64
        };

    let radarReparto = { activo: false };
    if (esVistaGestor && modulosActivosNodo.hoja_de_ruta) {
        const radRes = await db.query(
            `SELECT activo, pedido_actual_id, updated_at,
                    EXTRACT(EPOCH FROM (NOW() - updated_at)) AS edad_segundos
             FROM public.nodos_reparto_radar
             WHERE nodo_id = $1::int
             LIMIT 1`,
            [nodo.id]
        );
        const rad = radRes.rows[0];
        if (rad) {
            radarReparto = {
                activo: Boolean(rad.activo) && Number(rad.edad_segundos || 0) <= 240,
                pedido_actual_id: rad.pedido_actual_id ? Number(rad.pedido_actual_id) : null,
                updated_at: rad.updated_at || null
            };
        }
    }

    let liquidacionesNodo = [];
    if (esVistaGestor) {
        const liqGestorRes = await db.query(
            `SELECT id, codigo_liquidacion, lote_canasto_id, COALESCE(tipo_liquidacion, 'CANASTO_SEMANAL') AS tipo_liquidacion,
                    COALESCE(cantidad_ordenes, 0) AS cantidad_ordenes,
                    total_venta_vecinos, total_base_lamda,
                    COALESCE(total_envio_cobrado_clientes, 0) AS total_envio_cobrado_clientes,
                    COALESCE(total_costo_flete_lamda, 0) AS total_costo_flete_lamda,
                    ganancia_neta_gestor, total_transferencias_lamda, total_efectivo_mano_gestor,
                    direccion_compensacion, monto_compensacion_final,
                    saldo_cta_cte_post_cierre, modalidad_cierre, observaciones,
                    detalle_ordenes_json, created_at
             FROM public.nodos_liquidaciones_lote
             WHERE nodo_id = $1::int
             ORDER BY id DESC
             LIMIT 30`,
            [nodo.id]
        );
        liquidacionesNodo = liqGestorRes.rows;
    }

    return {
        nodo: nodoPublico,
        nodos_disponibles: [
            {
                id: nodo.id,
                codigo_nodo: nodo.codigo_nodo,
                slug: nodo.slug,
                slug_historico: nodo.slug_historico || null,
                nombre_marca: nodo.nombre_marca,
                bajada_marca: nodo.bajada_marca || null,
                subtitulo_marca: nodo.subtitulo_marca,
                gestor_nombre: nodo.gestor_nombre,
                barrio_zona: nodo.barrio_zona,
                color_primario: nodo.color_primario,
                tema_visual: (nodo.tema_visual && typeof nodo.tema_visual === 'object') ? nodo.tema_visual : {}
            }
        ],
        proxima_entrega: proximaEntrega,
        ofertas_publicadas: ofertasPublicadas,
        todas_ofertas_gestor: esVistaGestor ? ofertasConDesglose : [],
        catalogo_base_disponible: esVistaGestor ? catDisponibleRes.rows : [],
        propuestas_nodo: esVistaGestor ? propuestasEnriquecidas : [],
        pedidos_nodo: esVistaGestor ? pedidosConItems : [],
        movimientos_cta_cte: esVistaGestor ? movsRes.rows : [],
        liquidaciones_nodo: esVistaGestor ? liquidacionesNodo : [],
        radar_reparto: esVistaGestor ? radarReparto : { activo: false },
        telefono_whatsapp_pruebas: '5492216615746',
        telefono_whatsapp_pruebas_display: '221 661 5746',
        modo_laboratorio: esModoLaboratorioNodos(),
        ingredientes_sugeribles: esVistaGestor ? ingredientesSolicitables : []
    };
}

/**
 * Permite al Gestor del Nodo actualizar desde su Panel sus ventanas de entrega,
 * puntos de corte, envío barrial (100% para el gestor) y datos de contacto.
 */
async function actualizarConfiguracionGestorNodo(nodoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const cur = await db.query('SELECT * FROM public.nodos_maestro WHERE id = $1', [Number(nodoId)]);
    if (cur.rows.length === 0) {
        const err = new Error('Tienda no encontrada.');
        err.statusCode = 404;
        throw err;
    }
    const actual = cur.rows[0];
    if (actual.activo === false) {
        const err = new Error('Esta tienda se encuentra archivada y no puede modificar su configuración.');
        err.statusCode = 403;
        throw err;
    }

    const perfilActual = normalizarPerfilOperativoNodo(actual.perfil_operativo);
    const modulosActuales = resolverModulosActivosNodo(actual);

    const permitirRetiro = payload.permitir_retiro_nodo !== undefined
        ? Boolean(payload.permitir_retiro_nodo)
        : Boolean(modulosActuales.retiro_punto && actual.permitir_retiro_nodo !== false);
    const permitirReparto = payload.permitir_reparto_propio !== undefined
        ? Boolean(payload.permitir_reparto_propio)
        : (payload.permitir_envio_barrial !== undefined
            ? Boolean(payload.permitir_envio_barrial)
            : Boolean(modulosActuales.reparto_zonal && (actual.permitir_reparto_propio ?? actual.permitir_envio_barrial ?? false)));
    const permitirEncomienda = payload.permitir_encomienda !== undefined
        ? Boolean(payload.permitir_encomienda)
        : Boolean(modulosActuales.envio_paqueteria || actual.permitir_encomienda);

    if (!permitirRetiro && !permitirReparto && !permitirEncomienda) {
        throw new Error('Debés mantener habilitada al menos una modalidad activa de entrega.');
    }

    const cobroEfectivoEntrega = payload.cobro_efectivo_entrega !== undefined
        ? Boolean(payload.cobro_efectivo_entrega)
        : (payload.permitir_efectivo !== undefined
            ? Boolean(payload.permitir_efectivo)
            : Boolean(actual.cobro_efectivo_entrega ?? modulosActuales.cobro_efectivo_entrega));

    const modulosNuevos = resolverModulosActivosNodo(actual, {
        retiro_punto: permitirRetiro,
        reparto_zonal: permitirReparto,
        envio_paqueteria: permitirEncomienda,
        cobro_efectivo_entrega: cobroEfectivoEntrega,
        ...(perfilActual === 'ecommerce_fulfillment' && !permitirReparto ? { hoja_de_ruta: false } : {})
    });

    const configPaqActual = normalizarConfigPaqueteria(actual.config_paqueteria);
    const configPaqNueva = (payload.config_paqueteria && typeof payload.config_paqueteria === 'object' && configPaqActual.permitir_editar_gestor !== false)
        ? normalizarConfigPaqueteria({ ...configPaqActual, ...payload.config_paqueteria })
        : configPaqActual;

    const ventanas = Array.isArray(payload.config_ventanas_corte)
        ? payload.config_ventanas_corte
        : actual.config_ventanas_corte;

    const modoVidrieraTienda = payload.modo_vidriera_tienda !== undefined
        ? normalizarModoVidrieraTienda(payload.modo_vidriera_tienda)
        : normalizarModoVidrieraTienda(actual.modo_vidriera_tienda);

    const upd = await db.query(
        `UPDATE public.nodos_maestro SET
            nombre_marca = COALESCE($1, nombre_marca),
            bajada_marca = COALESCE($17, bajada_marca),
            subtitulo_marca = COALESCE($2, subtitulo_marca),
            gestor_nombre = COALESCE($3, gestor_nombre),
            gestor_telefono = COALESCE($4, gestor_telefono),
            barrio_zona = COALESCE($5, barrio_zona),
            direccion_retiro = COALESCE($6, direccion_retiro),
            alias_bancario_display = COALESCE($7, alias_bancario_display),
            permitir_envio_barrial = $8,
            permitir_retiro_nodo = $14,
            permitir_reparto_propio = $15,
            permitir_encomienda = $16,
            cargo_envio_barrial = $9,
            config_ventanas_corte = $10,
            color_primario = COALESCE($11, color_primario),
            mostrar_ingredientes_tienda = $12,
            modulos_activos = $18::jsonb,
            config_paqueteria = $19::jsonb,
            cobro_efectivo_entrega = $20,
            modo_vidriera_tienda = $21,
            updated_at = NOW()
         WHERE id = $13
         RETURNING *`,
        [
            payload.nombre_marca || actual.nombre_marca,
            payload.subtitulo_marca ?? actual.subtitulo_marca,
            payload.gestor_nombre || actual.gestor_nombre,
            payload.gestor_telefono ?? actual.gestor_telefono,
            payload.barrio_zona ?? actual.barrio_zona,
            payload.direccion_retiro ?? actual.direccion_retiro,
            payload.alias_bancario_display ?? actual.alias_bancario_display,
            permitirReparto,
            payload.cargo_envio_barrial !== undefined ? Number(payload.cargo_envio_barrial) : Number(actual.cargo_envio_barrial),
            JSON.stringify(ventanas),
            payload.color_primario || actual.color_primario,
            payload.mostrar_ingredientes_tienda !== undefined ? Boolean(payload.mostrar_ingredientes_tienda) : (actual.mostrar_ingredientes_tienda !== false),
            Number(nodoId),
            permitirRetiro,
            permitirReparto,
            permitirEncomienda,
            payload.bajada_marca !== undefined ? String(payload.bajada_marca || '').trim() : actual.bajada_marca,
            JSON.stringify(modulosNuevos),
            JSON.stringify(configPaqNueva),
            cobroEfectivoEntrega,
            modoVidrieraTienda
        ]
    );

    return upd.rows[0];
}

async function cotizarEnvioPostalTienda(slug, cpRaw = '', subtotalProductos = 0) {
    await asegurarEsquemaNodosBarriales();
    const nodoRes = await db.query(
        `SELECT id, slug, nombre_marca, perfil_operativo, modulos_activos, config_paqueteria, permitir_encomienda, activo
         FROM public.nodos_maestro
         WHERE (LOWER(slug) = LOWER($1) OR LOWER(COALESCE(slug_historico, '')) = LOWER($1))
           AND COALESCE(activo, true) = true
         ORDER BY CASE WHEN LOWER(slug) = LOWER($1) THEN 0 ELSE 1 END
         LIMIT 1`,
        [String(slug || '').trim()]
    );
    if (nodoRes.rows.length === 0) {
        const err = new Error('Tienda no encontrada.');
        err.statusCode = 404;
        throw err;
    }
    const nodo = nodoRes.rows[0];
    const modulos = resolverModulosActivosNodo(nodo);
    if (!modulos.envio_paqueteria && !nodo.permitir_encomienda) {
        const err = new Error('Esta tienda no tiene habilitado el envío por correo.');
        err.statusCode = 400;
        throw err;
    }
    return cotizarEnvioPostalPorCp(nodo.config_paqueteria, cpRaw, subtotalProductos);
}

/**
 * Registra un pedido de un vecino desde la Tienda Marca Blanca (/:nodoSlug),
 * calcula el horario de corte, los márgenes del gestor + 100% del envío barrial
 * y devuelve el comprobante junto con la etiqueta térmica Zebra lista.
 */
async function crearPedidoVecinoTienda(slug, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const vecinoNombre = String(payload.vecino_nombre || '').trim();
    const vecinoTelefono = String(payload.vecino_telefono || '').trim();
    const itemsCarrito = Array.isArray(payload.items) ? payload.items : [];

    if (!vecinoNombre || !vecinoTelefono) {
        throw new Error('Por favor ingresá tu nombre y tu número de WhatsApp para coordinar la entrega.');
    }
    if (itemsCarrito.length === 0) {
        throw new Error('Tu carrito está vacío. Agregá al menos un producto para confirmar el pedido.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const nodoRes = await client.query(
            `SELECT * FROM public.nodos_maestro
             WHERE LOWER(slug) = LOWER($1) OR LOWER(COALESCE(slug_historico, '')) = LOWER($1)
             ORDER BY CASE WHEN LOWER(slug) = LOWER($1) THEN 0 ELSE 1 END
             LIMIT 1`,
            [String(slug || '').trim()]
        );
        if (nodoRes.rows.length === 0) {
            throw new Error('Tienda no encontrada.');
        }
        const nodo = nodoRes.rows[0];
        if (nodo.activo === false) {
            throw new Error('Esta tienda se encuentra temporalmente pausada o archivada y no recibe pedidos.');
        }

        const modulosNodo = resolverModulosActivosNodo(nodo);
        const configPaqNodo = normalizarConfigPaqueteria(nodo.config_paqueteria);
        const puedeRetiro = Boolean(modulosNodo.retiro_punto && nodo.permitir_retiro_nodo !== false);
        const puedeReparto = Boolean(modulosNodo.reparto_zonal && (nodo.permitir_reparto_propio ?? nodo.permitir_envio_barrial));
        const puedeEncomienda = Boolean(modulosNodo.envio_paqueteria || nodo.permitir_encomienda);
        const modReq = String(payload.modalidad_entrega || '').trim().toUpperCase();

        let modalidad;
        if (['PAQUETERIA_DOMICILIO', 'PAQUETERIA_SUCURSAL', 'ENCOMIENDA'].includes(modReq)) {
            if (!puedeEncomienda) {
                throw new Error('Esta tienda no tiene habilitado el envío por paquetería nacional en este momento.');
            }
            const postalIn = (payload.postal && typeof payload.postal === 'object') ? payload.postal : payload;
            const modPostIn = String(postalIn.modalidad_postal || '').trim().toUpperCase();
            if (modReq === 'PAQUETERIA_SUCURSAL' || modPostIn === 'SUCURSAL') {
                if (!configPaqNodo.permitir_sucursal_correo) {
                    throw new Error('El retiro en sucursal de correo no se encuentra habilitado en este momento.');
                }
                modalidad = 'PAQUETERIA_SUCURSAL';
            } else {
                if (!configPaqNodo.permitir_domicilio) {
                    throw new Error('El envío postal a domicilio no se encuentra habilitado en este momento.');
                }
                modalidad = 'PAQUETERIA_DOMICILIO';
            }
        } else if (modReq === 'ENVIO_BARRIAL') {
            if (!puedeReparto) {
                throw new Error('Esta tienda no tiene habilitado el envío local a domicilio en este momento.');
            }
            modalidad = 'ENVIO_BARRIAL';
        } else if (modReq === 'RETIRO_NODO') {
            if (!puedeRetiro) {
                throw new Error('Esta tienda no tiene habilitado el retiro presencial en este momento.');
            }
            modalidad = 'RETIRO_NODO';
        } else {
            if (puedeRetiro) {
                modalidad = 'RETIRO_NODO';
            } else if (puedeReparto) {
                modalidad = 'ENVIO_BARRIAL';
            } else if (puedeEncomienda) {
                modalidad = configPaqNodo.permitir_domicilio ? 'PAQUETERIA_DOMICILIO' : 'PAQUETERIA_SUCURSAL';
            } else {
                throw new Error('Esta tienda no tiene modalidades de entrega habilitadas.');
            }
        }

        const esPedidoPostal = modalidad === 'PAQUETERIA_DOMICILIO' || modalidad === 'PAQUETERIA_SUCURSAL';
        const postalRaw = (payload.postal && typeof payload.postal === 'object') ? payload.postal : payload;

        let datosPostalesValidados = null;
        if (esPedidoPostal) {
            const cpDigits = String(postalRaw.cp_destino || postalRaw.codigo_postal || '').replace(/\D+/g, '');
            if (cpDigits.length !== 4) {
                throw new Error('Por favor ingresá un Código Postal argentino válido de 4 dígitos.');
            }
            const provNombre = String(postalRaw.provincia_nombre || postalRaw.provincia || '').trim();
            const provObj = PROVINCIAS_ARGENTINA_CANONICAS.find(
                p => p.nombre.toLowerCase() === provNombre.toLowerCase() || p.codigo.toLowerCase() === String(postalRaw.provincia_codigo || '').trim().toLowerCase()
            );
            const provFinalNombre = provObj ? provObj.nombre : provNombre;
            const provFinalCodigo = provObj ? provObj.codigo : (String(postalRaw.provincia_codigo || '').trim().slice(0, 10) || null);
            const localidadNombre = String(postalRaw.localidad_nombre || postalRaw.localidad || '').trim();
            if (!provFinalNombre || !localidadNombre) {
                throw new Error('Por favor completá la Provincia y la Localidad de destino.');
            }

            const dniDigits = String(postalRaw.destinatario_dni || payload.destinatario_dni || '').replace(/\D+/g, '');
            if (dniDigits.length < 7 || dniDigits.length > 11) {
                throw new Error('Por favor ingresá un DNI o CUIL válido (7 a 11 dígitos) para la etiqueta del correo.');
            }

            const opSolicitado = String(postalRaw.operador_postal || configPaqNodo.operador_default || 'CORREO_ARGENTINO').trim().toUpperCase();
            const operadorEfectivo = configPaqNodo.operadores_habilitados.includes(opSolicitado)
                ? opSolicitado
                : configPaqNodo.operador_default;

            const modalidadPostal = modalidad === 'PAQUETERIA_SUCURSAL' ? 'SUCURSAL' : 'DOMICILIO';
            const calle = String(postalRaw.calle || '').trim();
            const sinNumero = Boolean(postalRaw.sin_numero);
            const altura = sinNumero ? 'S/N' : String(postalRaw.altura || '').trim();
            const pisoDepto = String(postalRaw.piso_depto || '').trim();
            const referenciasDom = String(postalRaw.referencias_domicilio || payload.entrecalles_referencia || '').trim();
            const sucursalCodigo = String(postalRaw.sucursal_codigo || '').trim() || null;
            const sucursalNombre = String(
                postalRaw.sucursal_nombre ||
                (modalidadPostal === 'SUCURSAL' ? `Sucursal ${formatearOperadorPostalLabel(operadorEfectivo)} — ${localidadNombre} (CP ${cpDigits})` : '')
            ).trim();

            if (modalidadPostal === 'DOMICILIO' && (!calle || !altura)) {
                throw new Error('Por favor completá la calle y la altura del domicilio (o marcá S/N).');
            }
            if (modalidadPostal === 'SUCURSAL' && !sucursalNombre) {
                throw new Error('Por favor indicá la sucursal de correo de destino.');
            }

            datosPostalesValidados = {
                operador_postal: operadorEfectivo,
                modalidad_postal: modalidadPostal,
                sucursal_codigo: sucursalCodigo,
                sucursal_nombre: modalidadPostal === 'SUCURSAL' ? sucursalNombre : null,
                destinatario_nombre: String(postalRaw.destinatario_nombre || vecinoNombre).trim(),
                destinatario_dni: dniDigits,
                cp_destino: cpDigits,
                provincia_codigo: provFinalCodigo,
                provincia_nombre: provFinalNombre,
                localidad_nombre: localidadNombre,
                calle: modalidadPostal === 'DOMICILIO' ? calle : null,
                altura: modalidadPostal === 'DOMICILIO' ? altura : null,
                piso_depto: modalidadPostal === 'DOMICILIO' ? (pisoDepto || null) : null,
                referencias_domicilio: referenciasDom || null,
                email_contacto: String(postalRaw.email || payload.vecino_email || '').trim().slice(0, 160) || null
            };
        } else if (modalidad === 'ENVIO_BARRIAL' && !String(payload.direccion_entrega || '').trim()) {
            throw new Error('Por favor indicá tu dirección para el envío a domicilio.');
        }

        const proxima = calcularProximaEntregaNodo(nodo.config_ventanas_corte, payload.fecha_hora_simulada || null);
        const entregaAsignada = proxima.asignada;

        // Consultar las ofertas publicadas del Nodo ancladas a SKU + nomenclatura oficial de LAMDA
        const ofertasRes = await client.query(
            `SELECT nog.*,
                    nac.sku_nodo,
                    COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_oficial_lamda,
                    nac.nombre_publico,
                    nac.presentacion_etiqueta,
                    nac.precio_base_nodo_final
             FROM public.nodos_ofertas_gestor nog
             JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
             LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(nac.sku_nodo)
             WHERE nog.nodo_id = $1`,
            [nodo.id]
        );
        const mapaOfertas = new Map(ofertasRes.rows.map(o => [Number(o.id), o]));

        let subtotalProductosVecino = 0;
        let totalBaseLamda = 0;
        const ivaMargenPedidoPct = normalizarAlicuotaFiscalNodo(nodo.alicuota_iva_margen_pct, 21);
        const iibbMargenPedidoPct = normalizarAlicuotaFiscalNodo(nodo.alicuota_iibb_margen_pct, 4);
        const factorNetoPedido = obtenerFactorNetoMargenNodo(ivaMargenPedidoPct, iibbMargenPedidoPct);
        const itemsValidados = [];

        for (const itemReq of itemsCarrito) {
            const cant = Math.max(1, Math.round(Number(itemReq.cantidad) || 1));
            const of = mapaOfertas.get(Number(itemReq.oferta_id));
            if (!of) continue;

            const pUnitVecino = Number(of.precio_venta_vecino);
            const pUnitBaseLamda = Number(of.precio_base_nodo_final || of.precio_base_nodo_snapshot);
            const subVecino = Number((pUnitVecino * cant).toFixed(2));
            const subBase = Number((pUnitBaseLamda * cant).toFixed(2));
            const ganItem = Math.round(Math.max(0, subVecino - subBase) * factorNetoPedido);

            subtotalProductosVecino += subVecino;
            totalBaseLamda += subBase;

            const nombreOficialLamda = of.nombre_oficial_lamda || of.nombre_publico;
            const nombreVidrieraVecino = (of.nombre_vidriera_personalizado && String(of.nombre_vidriera_personalizado).trim())
                ? String(of.nombre_vidriera_personalizado).trim()
                : nombreOficialLamda;

            itemsValidados.push({
                articulo_catalogo_id: of.articulo_catalogo_id,
                sku_nodo: of.sku_nodo,
                nombre_oficial_lamda: nombreOficialLamda,
                nombre_vidriera_vecino: nombreVidrieraVecino,
                nombre_publico: nombreOficialLamda,
                presentacion_etiqueta: of.presentacion_etiqueta,
                cantidad: cant,
                precio_unitario_vecino: pUnitVecino,
                precio_unitario_base_lamda: pUnitBaseLamda,
                subtotal_vecino: subVecino,
                subtotal_base_lamda: subBase,
                ganancia_item_gestor: ganItem
            });
        }

        if (itemsValidados.length === 0) {
            throw new Error('No se pudieron validar los artículos seleccionados.');
        }

        let pesoGramosEstimado = 0;
        for (const it of itemsValidados) {
            const ofRow = ofertasRes.rows.find(r => Number(r.articulo_catalogo_id) === Number(it.articulo_catalogo_id));
            const kgUnit = Number(ofRow?.kilos_unidad || 0.3);
            pesoGramosEstimado += Math.round(kgUnit * 1000 * Number(it.cantidad || 1));
        }
        pesoGramosEstimado = Math.max(250, pesoGramosEstimado + 180);

        let cargoEnvioBarrial = 0;
        let cotizacionPostalAplicada = null;
        if (esPedidoPostal && datosPostalesValidados) {
            cotizacionPostalAplicada = cotizarEnvioPostalPorCp(
                configPaqNodo,
                datosPostalesValidados.cp_destino,
                subtotalProductosVecino
            );
            cargoEnvioBarrial = datosPostalesValidados.modalidad_postal === 'SUCURSAL'
                ? Number(cotizacionPostalAplicada.costo_sucursal_efectivo || 0)
                : Number(cotizacionPostalAplicada.costo_domicilio_efectivo || 0);
        } else if (modalidad === 'ENVIO_BARRIAL') {
            cargoEnvioBarrial = Number(nodo.cargo_envio_barrial || 0);
        }

        const excedenteBrutoProductos = Math.max(0, Number((subtotalProductosVecino - totalBaseLamda).toFixed(2)));
        const tramoFiscalPedido = desglosarRetencionFiscalExcedente(
            excedenteBrutoProductos,
            ivaMargenPedidoPct,
            iibbMargenPedidoPct
        );
        const gananciaProductosGestor = tramoFiscalPedido.ganancia_neta;
        const totalVecino = subtotalProductosVecino + cargoEnvioBarrial;
        const gananciaTotalGestor = esPedidoPostal
            ? gananciaProductosGestor
            : (gananciaProductosGestor + cargoEnvioBarrial);

        const cfgCanalPedido = await pagosBancariosService.obtenerConfiguracionBancariaCanalNodos(client);
        const cobroEfectivoHabilitadoTienda = Boolean(nodo.cobro_efectivo_entrega ?? modulosNodo.cobro_efectivo_entrega);
        const efectivoPermitidoEnPedido = Boolean(!cfgCanalPedido.solo_transferencia_bancaria && cobroEfectivoHabilitadoTienda);
        if (String(payload.medio_pago || '').toUpperCase() === 'EFECTIVO' && !efectivoPermitidoEnPedido) {
            const errEfvo = new Error('En esta tienda los pedidos se abonan por Transferencia Bancaria. Seleccioná Transferencia Bancaria para continuar.');
            errEfvo.statusCode = 400;
            throw errEfvo;
        }
        const medioPago = (String(payload.medio_pago || '').toUpperCase() === 'EFECTIVO' && efectivoPermitidoEnPedido)
            ? 'EFECTIVO'
            : 'TRANSFERENCIA';
        const estadoPago = medioPago === 'EFECTIVO' ? 'COBRAR_EN_ENTREGA' : 'PENDIENTE_TRANSFERENCIA';

        // Registrar o actualizar el comprador de forma determinista por clave única (nodo_id, telefono_normalizado)
        const telNormVecino = normalizarTelefonoVecinoNodo(vecinoTelefono);
        if (!telNormVecino || telNormVecino.length < 7) {
            throw new Error('Por favor ingresá un número de WhatsApp válido con código de área (ej: 221 501-1101).');
        }
        let dirPostalFormateada = '';
        if (esPedidoPostal && datosPostalesValidados) {
            if (datosPostalesValidados.modalidad_postal === 'SUCURSAL') {
                dirPostalFormateada = `${datosPostalesValidados.sucursal_nombre} — ${datosPostalesValidados.localidad_nombre}, ${datosPostalesValidados.provincia_nombre} (CP ${datosPostalesValidados.cp_destino})`;
            } else {
                const parteCalle = `${datosPostalesValidados.calle} ${datosPostalesValidados.altura}${datosPostalesValidados.piso_depto ? ` (${datosPostalesValidados.piso_depto})` : ''}`;
                dirPostalFormateada = `${parteCalle}, ${datosPostalesValidados.localidad_nombre}, ${datosPostalesValidados.provincia_nombre} (CP ${datosPostalesValidados.cp_destino})`;
            }
        }
        const dirVecino = esPedidoPostal
            ? dirPostalFormateada
            : (modalidad === 'ENVIO_BARRIAL'
                ? String(payload.direccion_entrega || '').trim()
                : (nodo.direccion_retiro || ''));
        const entrecallesVecino = esPedidoPostal
            ? (datosPostalesValidados?.referencias_domicilio || '')
            : (payload.entrecalles_referencia || '');
        const coordsPayload = modalidad === 'ENVIO_BARRIAL'
            ? _sanitizarCoordenadasGeo(payload.latitud, payload.longitud)
            : null;
        const gpsOrigenPayload = coordsPayload
            ? String(payload.gps_origen || 'VECINO_GPS').trim().slice(0, 30)
            : null;

        const vecPrevRes = await client.query(
            `SELECT id, direccion_calle, latitud, longitud, gps_origen, gps_verificado_gestor
             FROM public.nodos_vecinos
             WHERE nodo_id = $1::int AND telefono_normalizado = $2
             LIMIT 1`,
            [nodo.id, telNormVecino]
        );
        const vecPrevio = vecPrevRes.rows[0] || null;
        const normNuevaDir = _normalizarTextoDirCoordenadas(dirVecino);
        const normPrevDir = _normalizarTextoDirCoordenadas(vecPrevio?.direccion_calle || '');
        const cambioDireccionEnvio = modalidad === 'ENVIO_BARRIAL' && Boolean(vecPrevio) && (
            !normNuevaDir || !normPrevDir || normNuevaDir !== normPrevDir
        );

        let latPedidoFinal = null;
        let lngPedidoFinal = null;
        let gpsOrigenPedidoFinal = null;

        if (modalidad === 'ENVIO_BARRIAL') {
            if (coordsPayload) {
                latPedidoFinal = coordsPayload.lat;
                lngPedidoFinal = coordsPayload.lng;
                gpsOrigenPedidoFinal = gpsOrigenPayload;
            } else if (!cambioDireccionEnvio && vecPrevio && vecPrevio.latitud != null && vecPrevio.longitud != null) {
                const coordsPrev = _sanitizarCoordenadasGeo(vecPrevio.latitud, vecPrevio.longitud);
                if (coordsPrev) {
                    latPedidoFinal = coordsPrev.lat;
                    lngPedidoFinal = coordsPrev.lng;
                    gpsOrigenPedidoFinal = vecPrevio.gps_verificado_gestor
                        ? 'GESTOR_VERIFICADO'
                        : (String(vecPrevio.gps_origen || 'VECINO_PREVIO').slice(0, 30));
                }
            }
        }

        const exVecPed = await client.query(
            `SELECT id FROM public.nodos_vecinos
             WHERE nodo_id = $1 AND telefono_normalizado = $2
             LIMIT 1 FOR UPDATE`,
            [nodo.id, telNormVecino]
        );
        let upVec;
        if (exVecPed.rows.length > 0) {
            upVec = await client.query(
                `UPDATE public.nodos_vecinos SET
                    nombre_completo = $2,
                    telefono_whatsapp = $3,
                    direccion_calle = CASE
                        WHEN $10::boolean THEN COALESCE(NULLIF($4::varchar, ''), direccion_calle)
                        ELSE direccion_calle
                    END,
                    entrecalles_referencia = CASE
                        WHEN $10::boolean THEN COALESCE(NULLIF($5::varchar, ''), entrecalles_referencia)
                        ELSE entrecalles_referencia
                    END,
                    notas_entrega = COALESCE(NULLIF($6::text, ''), notas_entrega),
                    latitud = CASE
                        WHEN $7::numeric IS NOT NULL THEN $7::numeric
                        WHEN $11::boolean THEN NULL
                        ELSE latitud
                    END,
                    longitud = CASE
                        WHEN $8::numeric IS NOT NULL THEN $8::numeric
                        WHEN $11::boolean THEN NULL
                        ELSE longitud
                    END,
                    gps_origen = CASE
                        WHEN $7::numeric IS NOT NULL THEN $9::varchar
                        WHEN $11::boolean THEN NULL
                        ELSE gps_origen
                    END,
                    gps_verificado_gestor = CASE
                        WHEN $7::numeric IS NOT NULL THEN false
                        WHEN $11::boolean THEN false
                        ELSE gps_verificado_gestor
                    END,
                    gps_updated_at = CASE
                        WHEN $7::numeric IS NOT NULL THEN NOW()
                        WHEN $11::boolean THEN NULL
                        ELSE gps_updated_at
                    END,
                    activo = true,
                    updated_at = NOW()
                 WHERE id = $1
                 RETURNING id, codigo_vecino, portal_token`,
                [
                    exVecPed.rows[0].id,
                    vecinoNombre,
                    vecinoTelefono,
                    modalidad === 'ENVIO_BARRIAL' ? dirVecino : '',
                    modalidad === 'ENVIO_BARRIAL' ? entrecallesVecino : '',
                    payload.observaciones_vecino || '',
                    coordsPayload ? coordsPayload.lat : null,
                    coordsPayload ? coordsPayload.lng : null,
                    gpsOrigenPayload,
                    modalidad === 'ENVIO_BARRIAL',
                    cambioDireccionEnvio
                ]
            );
        } else {
            upVec = await client.query(
                `INSERT INTO public.nodos_vecinos (
                    nodo_id, nombre_completo, telefono_whatsapp, telefono_normalizado,
                    direccion_calle, entrecalles_referencia, notas_entrega,
                    latitud, longitud, gps_origen, gps_verificado_gestor, gps_updated_at, activo
                 ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7,
                    $8::numeric, $9::numeric, $10::varchar, false, CASE WHEN $8::numeric IS NOT NULL THEN NOW() ELSE NULL END, true
                 )
                 RETURNING id, codigo_vecino, portal_token`,
                [
                    nodo.id,
                    vecinoNombre,
                    vecinoTelefono,
                    telNormVecino,
                    modalidad === 'ENVIO_BARRIAL' ? dirVecino : '',
                    modalidad === 'ENVIO_BARRIAL' ? entrecallesVecino : '',
                    payload.observaciones_vecino || '',
                    coordsPayload ? coordsPayload.lat : null,
                    coordsPayload ? coordsPayload.lng : null,
                    gpsOrigenPayload
                ]
            );
        }
        const vecinoId = Number(upVec.rows[0].id);
        const codigoVecino = upVec.rows[0].codigo_vecino || formatearCodigoVecinoNodo(nodo.id, vecinoId);
        const portalTokenVecino = (upVec.rows[0].portal_token && String(upVec.rows[0].portal_token).trim().length >= 16)
            ? String(upVec.rows[0].portal_token).trim()
            : generarPortalTokenVecinoNodo();
        if (!upVec.rows[0].codigo_vecino || !upVec.rows[0].portal_token) {
            await client.query(
                'UPDATE public.nodos_vecinos SET codigo_vecino = $1, portal_token = $2 WHERE id = $3',
                [codigoVecino, portalTokenVecino, vecinoId]
            );
        }
        if (esPedidoPostal && datosPostalesValidados) {
            await client.query(
                `UPDATE public.nodos_vecinos SET
                    dni_cuil = COALESCE(NULLIF($2::varchar, ''), dni_cuil),
                    email_contacto = COALESCE(NULLIF($3::varchar, ''), email_contacto),
                    cp_habitual = COALESCE(NULLIF($4::varchar, ''), cp_habitual),
                    provincia_habitual = COALESCE(NULLIF($5::varchar, ''), provincia_habitual),
                    localidad_habitual = COALESCE(NULLIF($6::varchar, ''), localidad_habitual),
                    direccion_calle = COALESCE(NULLIF($7::varchar, ''), direccion_calle),
                    entrecalles_referencia = COALESCE(NULLIF($8::varchar, ''), entrecalles_referencia),
                    updated_at = NOW()
                 WHERE id = $1`,
                [
                    vecinoId,
                    datosPostalesValidados.destinatario_dni || '',
                    datosPostalesValidados.email_contacto || '',
                    datosPostalesValidados.cp_destino || '',
                    datosPostalesValidados.provincia_nombre || '',
                    datosPostalesValidados.localidad_nombre || '',
                    dirPostalFormateada,
                    datosPostalesValidados.referencias_domicilio || ''
                ]
            );
        }

        const seqRes = await client.query(`
            SELECT GREATEST(
                1000 + COUNT(*)::int,
                COALESCE(MAX(CASE WHEN codigo_pedido ~ '^NB-[0-9]+$' THEN CAST(SUBSTRING(codigo_pedido FROM 4) AS INTEGER) ELSE 1000 END), 1000)
            ) AS base_num
            FROM public.nodos_pedidos_vecinos
        `);
        const codigoPedido = `NB-${Number(seqRes.rows[0].base_num || 1000) + 1}`;

        const direccionFinal = esPedidoPostal
            ? dirPostalFormateada
            : (modalidad === 'ENVIO_BARRIAL'
                ? String(payload.direccion_entrega || '').trim()
                : (nodo.direccion_retiro || nodo.barrio_zona || ''));

        const fechaEntregaIsoEfectiva = esPedidoPostal
            ? new Date().toISOString().slice(0, 10)
            : entregaAsignada.fecha_entrega_iso;
        const fechaEntregaLabelEfectiva = esPedidoPostal
            ? (configPaqNodo.sla_despacho_label || 'Despacho en 24 a 48 hs hábiles')
            : entregaAsignada.label_completo;
        const ventanaLabelEfectiva = esPedidoPostal && datosPostalesValidados
            ? `${formatearOperadorPostalLabel(datosPostalesValidados.operador_postal)} · ${datosPostalesValidados.modalidad_postal === 'SUCURSAL' ? 'Retiro en Sucursal' : 'Envío a Domicilio'} (CP ${datosPostalesValidados.cp_destino})`
            : entregaAsignada.ventana_retiro;

        const trackingToken = generarTrackingTokenPedidoNodo();

        const insPed = await client.query(
            `INSERT INTO public.nodos_pedidos_vecinos (
                codigo_pedido, nodo_id, vecino_id, vecino_nombre, vecino_telefono,
                vecino_email, destinatario_dni,
                modalidad_entrega, direccion_entrega, entrecalles_referencia,
                latitud, longitud, gps_origen,
                fecha_entrega_comprometida, fecha_entrega_label, ventana_horaria_label,
                entrar_en_corte_actual, medio_pago, estado_pago, estado_operativo,
                tracking_token, hito_tracking_actual,
                en_hoja_ruta, incluido_reparto_manual,
                subtotal_productos_vecino, cargo_envio_barrial, total_vecino,
                total_base_lamda, ganancia_total_gestor, observaciones_vecino,
                alicuota_iva_margen_pct, alicuota_iibb_margen_pct,
                retencion_iva_margen, retencion_iibb_margen, retencion_fiscal_margen
             ) VALUES (
                $1,$2,$3,$4,$5,$26,$27,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'CONFIRMADO_VECINO',$18,1,$25,false,$19,$20,$21,$22,$23,$24,$28,$29,$30,$31,$32
             ) RETURNING *`,
            [
                codigoPedido,
                nodo.id,
                vecinoId,
                vecinoNombre,
                vecinoTelefono,
                modalidad,
                direccionFinal,
                entrecallesVecino,
                latPedidoFinal,
                lngPedidoFinal,
                gpsOrigenPedidoFinal,
                fechaEntregaIsoEfectiva,
                fechaEntregaLabelEfectiva,
                ventanaLabelEfectiva,
                esPedidoPostal ? true : !proxima.paso_horario_corte,
                medioPago,
                estadoPago,
                trackingToken,
                subtotalProductosVecino,
                cargoEnvioBarrial,
                totalVecino,
                totalBaseLamda,
                gananciaTotalGestor,
                payload.observaciones_vecino || '',
                modalidad === 'ENVIO_BARRIAL',
                datosPostalesValidados?.email_contacto || String(payload.vecino_email || '').trim().slice(0, 160) || null,
                datosPostalesValidados?.destinatario_dni || null,
                tramoFiscalPedido.alicuota_iva_pct,
                tramoFiscalPedido.alicuota_iibb_pct,
                tramoFiscalPedido.iva_excedente,
                tramoFiscalPedido.iibb_excedente,
                tramoFiscalPedido.retencion_fiscal_total
            ]
        );
        const pedidoRow = insPed.rows[0];

        let envioPostalRow = null;
        if (esPedidoPostal && datosPostalesValidados) {
            const insEnvioPostal = await client.query(
                `INSERT INTO public.nodos_pedidos_envios_postales (
                    pedido_id, nodo_id, operador_postal, modalidad_postal,
                    sucursal_codigo, sucursal_nombre, destinatario_nombre, destinatario_dni,
                    cp_destino, provincia_codigo, provincia_nombre, localidad_nombre,
                    calle, altura, piso_depto, referencias_domicilio, email_contacto,
                    peso_gramos, valor_declarado, costo_envio_cliente, costo_flete_lamda,
                    modo_imposicion, estado_envio
                 ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$20,$17,$18,$19,0,'MANUAL','PENDIENTE_DESPACHO'
                 ) RETURNING *`,
                [
                    pedidoRow.id,
                    nodo.id,
                    datosPostalesValidados.operador_postal,
                    datosPostalesValidados.modalidad_postal,
                    datosPostalesValidados.sucursal_codigo,
                    datosPostalesValidados.sucursal_nombre,
                    datosPostalesValidados.destinatario_nombre,
                    datosPostalesValidados.destinatario_dni,
                    datosPostalesValidados.cp_destino,
                    datosPostalesValidados.provincia_codigo,
                    datosPostalesValidados.provincia_nombre,
                    datosPostalesValidados.localidad_nombre,
                    datosPostalesValidados.calle,
                    datosPostalesValidados.altura,
                    datosPostalesValidados.piso_depto,
                    datosPostalesValidados.referencias_domicilio,
                    pesoGramosEstimado,
                    subtotalProductosVecino,
                    cargoEnvioBarrial,
                    datosPostalesValidados.email_contacto || null
                ]
            );
            envioPostalRow = insEnvioPostal.rows[0];
        }

        await client.query(
            `INSERT INTO public.nodos_pedidos_eventos_tracking (
                pedido_id, nodo_id, hito_numero, estado_operativo, origen_evento, actor, detalle
             ) VALUES ($1, $2, 1, 'CONFIRMADO_VECINO', 'TIENDA_VECINO', $3, $4)`,
            [
                pedidoRow.id,
                nodo.id,
                vecinoNombre,
                `Pedido #${codigoPedido} registrado en ${nodo.nombre_marca} (${modalidad})`
            ]
        );

        for (const it of itemsValidados) {
            await client.query(
                `INSERT INTO public.nodos_pedidos_items (
                    pedido_id, articulo_catalogo_id, sku_nodo, nombre_publico, nombre_vidriera_vecino,
                    presentacion_etiqueta, cantidad, precio_unitario_vecino, precio_unitario_base_lamda,
                    subtotal_vecino, subtotal_base_lamda, ganancia_item_gestor
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                [
                    pedidoRow.id,
                    it.articulo_catalogo_id,
                    it.sku_nodo,
                    it.nombre_oficial_lamda,
                    it.nombre_vidriera_vecino,
                    it.presentacion_etiqueta,
                    it.cantidad,
                    it.precio_unitario_vecino,
                    it.precio_unitario_base_lamda,
                    it.subtotal_vecino,
                    it.subtotal_base_lamda,
                    it.ganancia_item_gestor
                ]
            );
        }

        await sincronizarCanastosEstacionNodos(client);

        const pedCanRes = await client.query(
            'SELECT lote_canasto_id FROM public.nodos_pedidos_vecinos WHERE id = $1 LIMIT 1',
            [pedidoRow.id]
        );
        const loteCanastoId = pedCanRes.rows[0]?.lote_canasto_id || null;

        await client.query(
            `INSERT INTO public.nodos_vecinos_movimientos_cc (
                nodo_id, vecino_id, pedido_vecino_id, lote_canasto_id,
                tipo_movimiento, naturaleza, monto, saldo_resultante,
                medio_pago, concepto, referencia_externa
             ) VALUES ($1, $2, $3, $4, 'DEBITO_PEDIDO', 'DEBITO', $5, 0, $6, $7, $8)`,
            [
                nodo.id,
                vecinoId,
                pedidoRow.id,
                loteCanastoId,
                totalVecino,
                medioPago,
                `Compra Pedido #${codigoPedido} (${itemsValidados.length} art. · ${fechaEntregaLabelEfectiva})`,
                codigoPedido
            ]
        );
        const saldoVecinoActual = await recalcularSaldoSubcuentaVecino(client, vecinoId);

        if (payload.visitor_id) {
            await vincularVisitanteConVecino({
                visitorId: payload.visitor_id,
                nodoId: nodo.id,
                vecinoId,
                vecinoNombre,
                vecinoTelefono,
                telefonoNormalizado: telNormVecino,
                identificadoVia: 'PEDIDO',
                pedidoConfirmado: true,
                client
            });
        }

        await client.query('COMMIT');

        return {
            pedido: {
                ...pedidoRow,
                lote_canasto_id: loteCanastoId,
                codigo_vecino: codigoVecino,
                portal_token: portalTokenVecino,
                telefono_normalizado: telNormVecino,
                saldo_subcuenta_vecino: saldoVecinoActual,
                envio_postal: envioPostalRow,
                items: itemsValidados.map(it => ({
                    articulo_catalogo_id: it.articulo_catalogo_id,
                    sku_nodo: it.sku_nodo,
                    nombre_publico: it.nombre_vidriera_vecino || it.nombre_publico,
                    presentacion_etiqueta: it.presentacion_etiqueta,
                    cantidad: it.cantidad,
                    precio_unitario_vecino: it.precio_unitario_vecino,
                    subtotal_vecino: it.subtotal_vecino
                }))
            },
            nodo_pago_info: {
                nombre_marca: nodo.nombre_marca,
                banco: nodo.banco_display || cfgCanalPedido.banco_recaudador,
                alias: nodo.alias_bancario_display || cfgCanalPedido.alias_recaudador,
                cbu: nodo.cbu_display || cfgCanalPedido.cbu_recaudador,
                titular: nodo.titular_display || cfgCanalPedido.titular_recaudador,
                cuil: nodo.cuil_display || cfgCanalPedido.cuil_recaudador,
                numero_cuenta: nodo.numero_cuenta_display || cfgCanalPedido.numero_cuenta_recaudador,
                gestor_nombre: nodo.gestor_nombre,
                gestor_telefono: nodo.gestor_telefono,
                direccion_retiro: nodo.direccion_retiro
            }
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Genera el preview y el código ZPL 100% Marca Blanca para la caja de paquetería de un Creador / Tienda Online
 * (Cara Cliente sin mención alguna a LAMDA + QR de seguimiento en tienda.lamdaser.com) acompañado de su
 * Talón Desmontable Interno para Depósito LAMDA con SKUs oficiales, peso y fecha/hora de empaque.
 */
async function generarEtiquetaFulfillmentMarcaBlanca(pedidoId) {
    await asegurarEsquemaNodosBarriales();

    const pedRes = await db.query(
        `SELECT npv.*,
                nm.slug AS nodo_slug, nm.nombre_marca, nm.bajada_marca, nm.subtitulo_marca,
                nm.perfil_operativo, nm.modulos_activos,
                nm.logo_zpl_gfa, nm.logo_mono_preview_base64, nm.logo_zpl_config,
                npep.operador_postal AS postal_operador,
                npep.modalidad_postal AS postal_modalidad,
                npep.sucursal_codigo AS postal_sucursal_codigo,
                npep.sucursal_nombre AS postal_sucursal_nombre,
                npep.destinatario_nombre AS postal_destinatario,
                npep.destinatario_dni AS postal_dni,
                npep.cp_destino AS postal_cp,
                npep.provincia_nombre AS postal_provincia,
                npep.localidad_nombre AS postal_localidad,
                npep.calle AS postal_calle,
                npep.altura AS postal_altura,
                npep.piso_depto AS postal_piso_depto,
                npep.referencias_domicilio AS postal_referencias,
                npep.peso_gramos AS postal_peso_gramos,
                npep.numero_tracking AS postal_numero_tracking
         FROM public.nodos_pedidos_vecinos npv
         JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
         LEFT JOIN public.nodos_pedidos_envios_postales npep ON npep.pedido_id = npv.id
         WHERE npv.id = $1 LIMIT 1`,
        [Number(pedidoId)]
    );
    if (pedRes.rows.length === 0) {
        throw new Error('Pedido de fulfillment no encontrado.');
    }
    const ped = pedRes.rows[0];

    const itemsRes = await db.query(
        `SELECT npi.*,
                COALESCE(nac.sku_nodo, npi.sku_nodo) AS sku_oficial_lamda,
                COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, npi.nombre_publico) AS nombre_oficial_lamda,
                COALESCE(nac.kilos_unidad, 0.30)::numeric(10,3) AS kilos_unidad
         FROM public.nodos_pedidos_items npi
         LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
         LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, npi.sku_nodo))
         WHERE npi.pedido_id = $1
         ORDER BY npi.id ASC`,
        [ped.id]
    );

    let pesoCalcGramos = 0;
    for (const r of itemsRes.rows) {
        pesoCalcGramos += Math.round(Number(r.kilos_unidad || 0.30) * 1000 * Number(r.cantidad || 1));
    }
    pesoCalcGramos = Math.max(250, pesoCalcGramos + 180);
    const pesoFinalGramos = Number(ped.postal_peso_gramos || 0) > 0
        ? Number(ped.postal_peso_gramos)
        : pesoCalcGramos;

    const modPostal = String(ped.postal_modalidad || (ped.modalidad_entrega === 'PAQUETERIA_SUCURSAL' ? 'SUCURSAL' : 'DOMICILIO')).toUpperCase();
    const dirPostalStr = modPostal === 'SUCURSAL'
        ? `Sucursal: ${ped.postal_sucursal_nombre || ped.direccion_entrega || 'A designar'}`
        : [
            [ped.postal_calle, ped.postal_altura].filter(Boolean).join(' '),
            ped.postal_piso_depto ? `(${ped.postal_piso_depto})` : ''
        ].filter(Boolean).join(' ').trim() || (ped.direccion_entrega || '');

    const slugTienda = String(ped.nodo_slug || 'tienda').trim();
    const qrUrl = `https://tienda.lamdaser.com/tienda/${encodeURIComponent(slugTienda)}?seguimiento=${encodeURIComponent(ped.tracking_token || '')}`;

    const tsRef = ped.fecha_armado_bolsa ? new Date(ped.fecha_armado_bolsa) : new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const fechaEmpaqueTexto = `${pad2(tsRef.getDate())}/${pad2(tsRef.getMonth() + 1)}/${tsRef.getFullYear()} ${pad2(tsRef.getHours())}:${pad2(tsRef.getMinutes())}`;

    return generarPreviewVisualEtiquetaFulfillment({
        nombre_marca: ped.nombre_marca,
        bajada_marca: ped.bajada_marca,
        subtitulo_marca: ped.subtitulo_marca,
        logo_zpl_gfa: ped.logo_zpl_gfa,
        logo_mono_preview_base64: ped.logo_mono_preview_base64,
        logo_zpl_config: ped.logo_zpl_config,
        pedido_codigo: ped.codigo_pedido,
        destinatario_nombre: ped.postal_destinatario || ped.vecino_nombre,
        destinatario_dni: ped.postal_dni || '',
        destinatario_telefono: ped.vecino_telefono || '',
        localidad_nombre: ped.postal_localidad || '',
        provincia_nombre: ped.postal_provincia || '',
        cp_destino: ped.postal_cp || '',
        direccion_postal: dirPostalStr,
        operador_postal: formatearOperadorPostalLabel(ped.postal_operador || 'CORREO_ARGENTINO'),
        modalidad_postal: modPostal,
        sucursal_nombre: ped.postal_sucursal_nombre || '',
        numero_tracking: ped.postal_numero_tracking || '',
        qr_seguimiento_url: qrUrl,
        peso_gramos: pesoFinalGramos,
        fecha_empaque_texto: fechaEmpaqueTexto,
        bultos_texto: 'CAJA 1/1',
        items: itemsRes.rows.map(r => ({
            cantidad: r.cantidad,
            descripcion: formatearEtiquetaTecnicaArticulo(r.sku_oficial_lamda || r.sku_nodo, r.nombre_oficial_lamda || r.nombre_publico),
            presentacion_etiqueta: r.presentacion_etiqueta
        }))
    });
}

/**
 * Genera el preview y el código ZPL de la etiqueta térmica de un pedido vecinal real.
 * Si el pedido pertenece a un canal E-Commerce Fulfillment o posee envío postal, delega en
 * generarEtiquetaFulfillmentMarcaBlanca().
 */
async function generarEtiquetaDePedidoExistente(pedidoId) {
    await asegurarEsquemaNodosBarriales();

    const pedRes = await db.query(
        `SELECT npv.*,
                nm.nombre_marca, nm.bajada_marca, nm.subtitulo_marca,
                nm.perfil_operativo, nm.modulos_activos,
                nm.logo_zpl_gfa, nm.logo_mono_preview_base64, nm.logo_zpl_config,
                npep.id AS envio_postal_id
         FROM public.nodos_pedidos_vecinos npv
         JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
         LEFT JOIN public.nodos_pedidos_envios_postales npep ON npep.pedido_id = npv.id
         WHERE npv.id = $1 LIMIT 1`,
        [Number(pedidoId)]
    );
    if (pedRes.rows.length === 0) {
        throw new Error('Pedido vecinal no encontrado.');
    }
    const ped = pedRes.rows[0];

    if (
        ped.envio_postal_id ||
        normalizarPerfilOperativoNodo(ped.perfil_operativo) === 'ecommerce_fulfillment' ||
        ['PAQUETERIA_DOMICILIO', 'PAQUETERIA_SUCURSAL', 'ENCOMIENDA'].includes(String(ped.modalidad_entrega || '').toUpperCase())
    ) {
        return generarEtiquetaFulfillmentMarcaBlanca(pedidoId);
    }

    const itemsRes = await db.query(
        `SELECT npi.*,
                COALESCE(nac.sku_nodo, npi.sku_nodo) AS sku_oficial_lamda,
                COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, npi.nombre_publico) AS nombre_oficial_lamda
         FROM public.nodos_pedidos_items npi
         LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
         LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, npi.sku_nodo))
         WHERE npi.pedido_id = $1
         ORDER BY npi.id ASC`,
        [ped.id]
    );

    const esEfectivo = ped.medio_pago === 'EFECTIVO' || String(ped.estado_pago).includes('COBRAR');
    return generarPreviewVisualEtiquetaPar({
        nombre_marca: ped.nombre_marca,
        bajada_marca: ped.bajada_marca,
        subtitulo_marca: ped.subtitulo_marca,
        logo_zpl_gfa: ped.logo_zpl_gfa,
        logo_mono_preview_base64: ped.logo_mono_preview_base64,
        logo_zpl_config: ped.logo_zpl_config,
        pedido_codigo: ped.codigo_pedido,
        vecino_nombre: ped.vecino_nombre,
        vecino_telefono: ped.vecino_telefono,
        modalidad_entrega: `${ped.modalidad_entrega === 'ENVIO_BARRIAL' ? 'ENVIO BARRIAL' : 'RETIRO EN NODO'} (${ped.ventana_horaria_label || ''})`,
        direccion_barrial: ped.direccion_entrega || '',
        estado_pago: esEfectivo ? 'COBRAR EFECTIVO' : 'PAGADO (TRANSFERENCIA)',
        monto_cobrar: esEfectivo ? Number(ped.total_vecino) : 0,
        bultos_texto: 'BOLSA 1/1',
        items: itemsRes.rows.map(r => ({
            cantidad: r.cantidad,
            descripcion: formatearEtiquetaTecnicaArticulo(r.sku_oficial_lamda || r.sku_nodo, r.nombre_oficial_lamda || r.nombre_publico),
            presentacion_etiqueta: r.presentacion_etiqueta
        }))
    });
}

// ============================================================================
// ETAPA 3: MESA DE ARMADO, 4° DEPÓSITO CONCEPTUAL (ESTACION_NODOS) Y QR MAESTRO
// ============================================================================

/**
 * Sincroniza automáticamente los Canastos/Lotes alojados en ESTACION_NODOS
 * agrupando los pedidos vecinales por Nodo y Ventana de Entrega (excluyendo pedidos ANULADOS de los totales activos).
 */
async function sincronizarCanastosEstacionNodos(runner = null) {
    const q = runner || db;

    // Compuerta diferenciada en Depósito:
    // - Pedidos por TRANSFERENCIA permanecen bloqueados y fuera del canasto hasta `CONCILIADO_BANCO_LAMDA`.
    // - Pedidos en EFECTIVO ingresan directo al canasto/armado para que el referente retire la mercadería y cobre al entregar.
    await q.query(`
        UPDATE public.nodos_pedidos_vecinos npv
        SET lote_canasto_id = NULL
        WHERE npv.lote_canasto_id IS NOT NULL
          AND COALESCE(npv.estado_operativo, '') IN ('', 'CONFIRMADO_VECINO', 'EN_PREPARACION')
          AND COALESCE(npv.impactado_cta_cte_pago, false) = false
          AND UPPER(COALESCE(npv.medio_pago, 'TRANSFERENCIA')) <> 'EFECTIVO'
          AND UPPER(COALESCE(npv.estado_pago, '')) NOT IN ('CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR')
    `);

    await q.query(`
        UPDATE public.presupuestos p
        SET activo = false
        FROM public.nodos_pedidos_vecinos npv
        WHERE (p.id_presupuesto_ext = npv.codigo_pedido OR (npv.presupuesto_id_local IS NOT NULL AND p.id = npv.presupuesto_id_local))
          AND COALESCE(npv.estado_operativo, '') IN ('', 'CONFIRMADO_VECINO', 'EN_PREPARACION')
          AND COALESCE(npv.impactado_cta_cte_pago, false) = false
          AND UPPER(COALESCE(npv.medio_pago, 'TRANSFERENCIA')) <> 'EFECTIVO'
          AND UPPER(COALESCE(npv.estado_pago, '')) NOT IN ('CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR')
          AND p.activo = true
    `);

    const condElegibleArmadoSql = `
        COALESCE(npv.estado_operativo, '') <> 'ANULADO'
        AND (
            UPPER(COALESCE(npv.medio_pago, 'TRANSFERENCIA')) = 'EFECTIVO'
            OR COALESCE(npv.impactado_cta_cte_pago, false) = true
            OR UPPER(COALESCE(npv.estado_pago, '')) IN ('CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR')
            OR npv.estado_operativo IN ('ARMADO_EN_CANASTO', 'EN_PODER_GESTOR', 'EN_CAMINO_VECINO', 'ENTREGADO_VECINO')
        )
    `;

    const gruposRes = await q.query(`
        SELECT npv.nodo_id,
               nm.codigo_nodo,
               npv.fecha_entrega_label,
               MAX(npv.ventana_horaria_label) AS ventana_horaria_label,
               MIN(npv.fecha_entrega_comprometida) AS fecha_entrega_iso,
               COUNT(*) FILTER (WHERE ${condElegibleArmadoSql})::int AS total_bolsas,
               COUNT(*) FILTER (
                   WHERE npv.estado_operativo IN ('ARMADO_EN_CANASTO', 'EN_PODER_GESTOR', 'ENTREGADO_VECINO')
               )::int AS bolsas_armadas,
               COUNT(*) FILTER (
                   WHERE npv.estado_operativo IN ('EN_PODER_GESTOR', 'ENTREGADO_VECINO')
               )::int AS bolsas_despachadas,
               COALESCE(SUM(npv.total_base_lamda) FILTER (WHERE ${condElegibleArmadoSql}), 0)::numeric(14,2) AS total_base_lamda,
               COALESCE(SUM(npv.retencion_iva_margen) FILTER (WHERE ${condElegibleArmadoSql}), 0)::numeric(14,2) AS total_retencion_iva_margen,
               COALESCE(SUM(npv.retencion_iibb_margen) FILTER (WHERE ${condElegibleArmadoSql}), 0)::numeric(14,2) AS total_retencion_iibb_margen,
               COALESCE(SUM(npv.retencion_fiscal_margen) FILTER (WHERE ${condElegibleArmadoSql}), 0)::numeric(14,2) AS total_retencion_fiscal_margen,
               COALESCE(SUM(npv.total_vecino) FILTER (WHERE ${condElegibleArmadoSql}), 0)::numeric(14,2) AS total_venta_vecinos,
               COALESCE(SUM(npv.ganancia_total_gestor) FILTER (WHERE ${condElegibleArmadoSql}), 0)::numeric(14,2) AS ganancia_estimada_gestor
        FROM public.nodos_pedidos_vecinos npv
        JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
        WHERE COALESCE(
            (nm.modulos_activos->>'canasto_consolidado')::boolean,
            CASE WHEN LOWER(COALESCE(nm.perfil_operativo, 'vecinal')) = 'ecommerce_fulfillment' THEN false ELSE true END
        ) = true
          AND (${condElegibleArmadoSql})
        GROUP BY npv.nodo_id, nm.codigo_nodo, npv.fecha_entrega_label
        ORDER BY MIN(npv.fecha_entrega_comprometida) ASC, npv.nodo_id ASC
    `);

    const kilosPorGrupoRes = await q.query(`
        SELECT npv.nodo_id,
               npv.fecha_entrega_label,
               COALESCE(SUM(npi.cantidad * COALESCE(nac.kilos_unidad, 0.25)) FILTER (
                   WHERE ${condElegibleArmadoSql}
               ), 0)::numeric(12,3) AS total_kilos
        FROM public.nodos_pedidos_vecinos npv
        JOIN public.nodos_pedidos_items npi ON npi.pedido_id = npv.id
        LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
        WHERE (${condElegibleArmadoSql})
        GROUP BY npv.nodo_id, npv.fecha_entrega_label
    `);

    const mapaKilos = new Map(
        kilosPorGrupoRes.rows.map(r => [`${r.nodo_id}::${r.fecha_entrega_label}`, Number(r.total_kilos || 0)])
    );

    let seqIndex = 1;
    for (const g of gruposRes.rows) {
        const keyKilos = `${g.nodo_id}::${g.fecha_entrega_label}`;
        const totalKilos = mapaKilos.get(keyKilos) || 0;

        // Generar código limpio para el canasto
        const matchFecha = String(g.fecha_entrega_label || '').match(/(\d{2})\/(\d{2})/);
        const sufijoFecha = matchFecha ? `${matchFecha[1]}${matchFecha[2]}` : `L${seqIndex}`;
        const prefijoDia = String(g.fecha_entrega_label || '').toUpperCase().startsWith('SAB') || String(g.fecha_entrega_label || '').toUpperCase().startsWith('SÁB')
            ? 'SAB'
            : 'MIE';
        const codigoCanasto = `CAN-N${String(g.nodo_id).padStart(2, '0')}-${prefijoDia}${sufijoFecha}`;
        const qrPayload = `LAMDA-CANASTO|${codigoCanasto}|NODO-${g.nodo_id}`;
        seqIndex++;

        const exRes = await q.query(
            `SELECT * FROM public.nodos_lotes_estacion
             WHERE nodo_id = $1 AND fecha_entrega_label = $2
             LIMIT 1`,
            [g.nodo_id, g.fecha_entrega_label]
        );

        const totalBolsas = Number(g.total_bolsas || 0);
        const bolsasArmadas = Number(g.bolsas_armadas || 0);
        const bolsasDespachadas = Number(g.bolsas_despachadas || 0);

        let estadoCalculado = 'EN_ARMADO';
        let ubicacionCalculada = 'ESTACION_NODOS';
        if (bolsasDespachadas > 0 && bolsasDespachadas === totalBolsas) {
            estadoCalculado = 'ENTREGADO_AL_GESTOR';
            ubicacionCalculada = 'DESPACHADO_NODO';
        } else if (totalBolsas > 0 && bolsasArmadas === totalBolsas) {
            estadoCalculado = 'LISTO_ESTACION_NODOS';
            ubicacionCalculada = 'ESTACION_NODOS';
        }

        let canastoId;
        if (exRes.rows.length === 0) {
            const ins = await q.query(
                `INSERT INTO public.nodos_lotes_estacion (
                    codigo_canasto, qr_maestro_payload, nodo_id, fecha_entrega_iso,
                    fecha_entrega_label, ventana_horaria_label, ubicacion_deposito, estado_canasto,
                    total_bolsas, bolsas_armadas, total_kilos_lote,
                    total_base_lamda, total_retencion_iva_margen, total_retencion_iibb_margen, total_retencion_fiscal_margen,
                    total_venta_vecinos, ganancia_estimada_gestor,
                    fecha_listo_estacion
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$16,$17,$18,$13,$14,$15)
                 RETURNING id`,
                [
                    codigoCanasto,
                    qrPayload,
                    g.nodo_id,
                    g.fecha_entrega_iso || null,
                    g.fecha_entrega_label,
                    g.ventana_horaria_label || '',
                    ubicacionCalculada,
                    estadoCalculado,
                    totalBolsas,
                    bolsasArmadas,
                    totalKilos,
                    Number(g.total_base_lamda || 0),
                    Number(g.total_venta_vecinos || 0),
                    Number(g.ganancia_estimada_gestor || 0),
                    estadoCalculado === 'LISTO_ESTACION_NODOS' ? new Date() : null,
                    Number(g.total_retencion_iva_margen || 0),
                    Number(g.total_retencion_iibb_margen || 0),
                    Number(g.total_retencion_fiscal_margen || 0)
                ]
            );
            canastoId = ins.rows[0].id;
        } else {
            const actual = exRes.rows[0];
            canastoId = actual.id;
            const preservarEntregado = actual.estado_canasto === 'ENTREGADO_AL_GESTOR' && bolsasDespachadas === totalBolsas;
            const estadoFinal = preservarEntregado ? 'ENTREGADO_AL_GESTOR' : estadoCalculado;
            const ubicacionFinal = estadoFinal === 'ENTREGADO_AL_GESTOR' ? 'DESPACHADO_NODO' : 'ESTACION_NODOS';

            await q.query(
                `UPDATE public.nodos_lotes_estacion
                 SET total_bolsas = $1,
                     bolsas_armadas = $2,
                     total_kilos_lote = $3,
                     total_base_lamda = $4,
                     total_retencion_iva_margen = $10,
                     total_retencion_iibb_margen = $11,
                     total_retencion_fiscal_margen = $12,
                     total_venta_vecinos = $5,
                     ganancia_estimada_gestor = $6,
                     estado_canasto = $7::varchar,
                     ubicacion_deposito = $8::varchar,
                     fecha_listo_estacion = CASE
                         WHEN $7::varchar = 'LISTO_ESTACION_NODOS' AND fecha_listo_estacion IS NULL THEN NOW()
                         ELSE fecha_listo_estacion
                     END,
                     updated_at = NOW()
                 WHERE id = $9`,
                [
                    totalBolsas,
                    bolsasArmadas,
                    totalKilos,
                    Number(g.total_base_lamda || 0),
                    Number(g.total_venta_vecinos || 0),
                    Number(g.ganancia_estimada_gestor || 0),
                    estadoFinal,
                    ubicacionFinal,
                    canastoId,
                    Number(g.total_retencion_iva_margen || 0),
                    Number(g.total_retencion_iibb_margen || 0),
                    Number(g.total_retencion_fiscal_margen || 0)
                ]
            );
        }

        // Vincular únicamente los pedidos vecinales con pago acreditado (o históricos ya armados) con su Canasto en ESTACION_NODOS
        await q.query(
            `UPDATE public.nodos_pedidos_vecinos npv
             SET lote_canasto_id = $1::int
             WHERE npv.nodo_id = $2::int
               AND npv.fecha_entrega_label = $3::varchar
               AND (${condElegibleArmadoSql})
               AND (npv.lote_canasto_id IS NULL OR npv.lote_canasto_id <> $1::int)`,
            [canastoId, g.nodo_id, g.fecha_entrega_label]
        );
    }

    // Limpiar canastos abiertos vacíos (sin débito ni liquidación) cuyos pedidos pasaron a anulado o quedaron sin pago acreditado
    await q.query(`
        DELETE FROM public.nodos_lotes_estacion nle
        WHERE COALESCE(nle.debito_cta_cte_registrado, false) = false
          AND COALESCE(nle.liquidacion_cerrada, false) = false
          AND COALESCE(nle.estado_canasto, '') <> 'ENTREGADO_AL_GESTOR'
          AND NOT EXISTS (
              SELECT 1 FROM public.nodos_pedidos_vecinos npv
              WHERE npv.lote_canasto_id = nle.id
          )
    `);

    // Sincronizar automáticamente con las tablas operativas habituales de LAMDA
    await sincronizarNodosConCircuitoOperativoLamda(q);
}

/**
 * Sincroniza de forma nativa los Nodos, sus Fracciones aprobadas y sus Canastos/Lotes
 * dentro del circuito operativo habitual de LAMDA:
 * 1. public.clientes + public.bunker_clientes + public.clientes_domicilios (con coordenadas validadas para Mapa Logística :3005)
 * 2. public.articulos + public.bunker_articulos + public.stock_real_consolidado + public.recetas + public.receta_ingredientes (para Configurar Carros y Carro Personal)
 * 3. public.presupuestos + public.presupuestos_detalles (para Pizarra Principal :3000, Imprimir, Armar Pedido, Chequeo, Retira Depósito y Reparto :3005)
 */
async function sincronizarNodosConCircuitoOperativoLamda(runner = null, opciones = {}) {
    const q = runner || db;
    const opts = (opciones && typeof opciones === 'object') ? opciones : {};
    const skuDesdeCotizador = opts.skuDesdeCotizador ? String(opts.skuDesdeCotizador).trim().toUpperCase() : null;
    const anatomiaOverride = (opts.anatomiaOverride && typeof opts.anatomiaOverride === 'object') ? opts.anatomiaOverride : null;
    const forzarPreciosNodos = Boolean(opts.forzarPreciosNodos);

    // 1. Asegurar Clientes y Domicilios Geolocalizados por cada Nodo activo
    const nodosRes = await q.query('SELECT * FROM public.nodos_maestro WHERE COALESCE(activo, true) = true ORDER BY id ASC');
    const mapaClienteDomicilio = new Map();

    for (const nodo of nodosRes.rows) {
        const clienteIdNum = 9000 + Number(nodo.id);
        const nombreCliente = `NODO: ${nodo.nombre_marca}`;
        const apellidoCliente = `(${nodo.gestor_nombre})`;

        const cliCheck = await q.query('SELECT id FROM public.clientes WHERE cliente_id = $1 LIMIT 1', [clienteIdNum]);
        let clientePkId;
        if (cliCheck.rows.length === 0) {
            const insCli = await q.query(
                `INSERT INTO public.clientes (
                    cliente_id, nombre, apellido, telefono
                 ) VALUES ($1,$2,$3,$4)
                 RETURNING id`,
                [
                    clienteIdNum,
                    nombreCliente,
                    apellidoCliente,
                    nodo.gestor_telefono || '221-555-0100'
                ]
            );
            clientePkId = insCli.rows[0].id;
        } else {
            clientePkId = cliCheck.rows[0].id;
            await q.query(
                `UPDATE public.clientes
                 SET nombre = $1, apellido = $2, telefono = $3
                 WHERE id = $4`,
                [
                    nombreCliente,
                    apellidoCliente,
                    nodo.gestor_telefono || '221-555-0100',
                    clientePkId
                ]
            );
        }

        if (nodo.bunker_cliente_id) {
            await q.query(
                `UPDATE public.bunker_clientes
                 SET lomas_soft_id = $1
                 WHERE id = $2
                   AND codigo_bunker_cliente LIKE 'CB-NODO-%'
                   AND (lomas_soft_id IS NULL OR lomas_soft_id <> $1)`,
                [String(clienteIdNum), nodo.bunker_cliente_id]
            );
        }

        // Usar coordenadas reales configuradas en el Nodo si existen; fallback a City Bell / Gonnet
        const latReal = Number(nodo.latitud);
        const lngReal = Number(nodo.longitud);
        const tieneCoordsReales = Number.isFinite(latReal) && Number.isFinite(lngReal) && latReal !== 0 && lngReal !== 0;
        const esGonnet = String(nodo.barrio_zona || nodo.nombre_marca || '').toLowerCase().includes('gonnet');
        const lat = tieneCoordsReales ? latReal : (esGonnet ? -34.8812 : -34.8625);
        const lng = tieneCoordsReales ? lngReal : (esGonnet ? -58.0195 : -58.0465);

        const domCheck = await q.query(
            `SELECT id FROM public.clientes_domicilios
             WHERE id_cliente = $1 AND activo = true
             ORDER BY es_predeterminado DESC, id ASC LIMIT 1`,
            [clientePkId]
        );
        let domicilioId;
        if (domCheck.rows.length === 0) {
            const insDom = await q.query(
                `INSERT INTO public.clientes_domicilios (
                    id_cliente, alias, direccion, localidad, provincia, codigo_postal,
                    latitud, longitud, instrucciones_entrega, telefono_contacto,
                    es_predeterminado, activo, coordenadas_validadas
                 ) VALUES ($1,$2,$3,$4,'Buenos Aires','1896',$5,$6,$7,$8,true,true,true)
                 RETURNING id`,
                [
                    clientePkId,
                    `Sede ${nodo.nombre_marca}`,
                    nodo.direccion_retiro || 'Calle Cantilo 452, City Bell',
                    nodo.barrio_zona || 'City Bell',
                    lat,
                    lng,
                    `Entrega de Canastos Nodos Barriales · Gestor: ${nodo.gestor_nombre}`,
                    nodo.gestor_telefono || '221-555-0100'
                ]
            );
            domicilioId = insDom.rows[0].id;
        } else {
            domicilioId = domCheck.rows[0].id;
            await q.query(
                `UPDATE public.clientes_domicilios
                 SET direccion = $1,
                     localidad = $2,
                     latitud = CASE WHEN $6 THEN $3 ELSE COALESCE(latitud, $3) END,
                     longitud = CASE WHEN $6 THEN $4 ELSE COALESCE(longitud, $4) END,
                     es_predeterminado = true,
                     activo = true,
                     coordenadas_validadas = true
                 WHERE id = $5`,
                [
                    nodo.direccion_retiro || 'Calle Cantilo 452, City Bell',
                    nodo.barrio_zona || 'City Bell',
                    lat,
                    lng,
                    domicilioId,
                    tieneCoordsReales
                ]
            );
        }

        mapaClienteDomicilio.set(Number(nodo.id), {
            cliente_id_num: clienteIdNum,
            cliente_pk_id: clientePkId,
            domicilio_id: domicilioId,
            nodo
        });
    }

    // 2. Asegurar Artículos, Búnker (Anatomía Nativa LAMDA: Familias Reales + Nomenclatura Posicional pos_1..pos_5 + Recetas con Envase Primario), Stock Real Consolidado
    const listasPreciosRes = await q.query(`
        SELECT id, nombre, COALESCE(canal_comercial, 'MAYORISTA') AS canal_comercial
        FROM public.bunker_listas_precios
        WHERE activa = true
        ORDER BY id ASC
    `);
    const listasActivas = listasPreciosRes.rows;

    // Resolver usuario_id oficial de colaboradores_tarifas para asistente_colaborador_id (estándar nativo LAMDA = 5)
    const tarifasMapRes = await q.query(`SELECT id, usuario_id FROM public.colaboradores_tarifas`);
    const tarifaToUsuarioMap = new Map(tarifasMapRes.rows.map(r => [Number(r.id), Number(r.usuario_id || 5)]));
    const env181InfoRes = await q.query(`SELECT id, nombre, COALESCE(costo_patron, 18.16) AS costo_patron FROM public.ingredientes WHERE id = 181 LIMIT 1`);
    const env181Info = env181InfoRes.rows[0] || { id: 181, nombre: 'Bolsa 8 x 15', costo_patron: 18.16 };

    // 2.a) Auto-incorporar al catálogo de Nodos cualquier artículo que haya sido habilitado (disponible = true)
    // directamente en Lista Base Nodos Barriales desde Artículos y Diccionario Búnker.
    const pendientesDesdeBunkerRes = await q.query(`
        SELECT DISTINCT la.articulo_numero
        FROM public.bunker_lista_articulos la
        JOIN public.bunker_listas_precios lp ON lp.id = la.lista_id
        WHERE COALESCE(lp.canal_comercial, 'MAYORISTA') = 'NODOS'
          AND la.disponible = true
          AND UPPER(la.articulo_numero) NOT LIKE 'NB-%'
          AND UPPER(la.articulo_numero) <> 'CCTX250G'
          AND UPPER(la.articulo_numero) NOT IN (
              SELECT UPPER(sku_nodo) FROM public.nodos_articulos_catalogo WHERE activo = true
          )
    `);
    for (const pRow of pendientesDesdeBunkerRes.rows) {
        await sincronizarCatalogoNodoDesdeBunker(pRow.articulo_numero, q);
    }

    const catRes = await q.query(`
        SELECT nac.*,
               ing.nombre AS ing_origen_nombre,
               ing.articulo_vinculado_numero AS ing_articulo_vinculado_numero,
               env.nombre AS env_nombre,
               COALESCE(env.costo_patron, nac.costo_envase_aplicado) AS env_costo_unitario
        FROM public.nodos_articulos_catalogo nac
        LEFT JOIN public.ingredientes ing ON ing.id = nac.ingrediente_origen_id
        LEFT JOIN public.ingredientes env ON env.id = nac.insumo_envase_id
        WHERE nac.activo = true
        ORDER BY nac.id ASC
    `);

    for (const art of catRes.rows) {
        const esMatchOverride = Boolean(
            skuDesdeCotizador &&
            String(art.sku_nodo || '').trim().toUpperCase() === skuDesdeCotizador &&
            anatomiaOverride
        );
        const anatomia = esMatchOverride
            ? anatomiaOverride
            : await resolverAnatomiaNativaArticuloNodo(q, art);
        const sku = String(anatomia.sku_nativo || art.sku_nodo).trim();
        const esEdicionDesdeCotizador = Boolean(
            skuDesdeCotizador &&
            (sku.toUpperCase() === skuDesdeCotizador || String(art.sku_nodo || '').trim().toUpperCase() === skuDesdeCotizador)
        );
        const existeNativoPreviamente = Boolean(anatomia.existe_en_bunker);

        const descTecnicaBunker = String(anatomia.nomenclatura_bunker || art.nomenclatura_bunker || art.nombre_publico || sku).trim();
        const kilos = Number(art.kilos_unidad || 0.25);
        const minutosFracc = Number((Number(art.segundos_fraccionamiento || anatomia.segundos_nativos || 35) / 60).toFixed(4));
        const listasCompIds = Array.isArray(art.listas_mayoristas_compartidas)
            ? art.listas_mayoristas_compartidas.map(Number).filter(Boolean)
            : [];
        const compartidoMayorista = Boolean(art.compartido_mayorista || listasCompIds.length > 0);

        const usuarioColabId = tarifaToUsuarioMap.get(Number(art.tarifa_colaborador_id || 1))
            || Number(anatomia.asistente_colaborador_usuario_id || 5);

        const posicionesNativas = {
            ...(anatomia.posiciones && typeof anatomia.posiciones === 'object' ? anatomia.posiciones : {})
        };
        const propEstructurales = (anatomia.propiedades_estructurales && typeof anatomia.propiedades_estructurales === 'object')
            ? anatomia.propiedades_estructurales
            : {};

        const propMetadataNodo = {
            presentacion_etiqueta_nodo: art.presentacion_etiqueta || (kilos < 1 ? `Bolsa ${Math.round(kilos * 1000)}g` : `Bolsa ${Number(kilos.toFixed(2))}kg`),
            canal_nodos_barriales: true,
            sku_nodo: sku,
            compartido_mayorista: compartidoMayorista,
            listas_mayoristas_compartidas: listasCompIds
        };

        const propDinamicasCompletas = {
            ...propEstructurales,
            posiciones: posicionesNativas,
            asistente_minutos: minutosFracc,
            asistente_colaborador_id: usuarioColabId,
            ...propMetadataNodo
        };

        const costoMateriaYEnvase = Number((Number(art.costo_insumo_fraccion || 0) + Number(art.costo_envase_aplicado || 0)).toFixed(2));
        const costoRecetaPorKg = kilos > 0
            ? Number((costoMateriaYEnvase / kilos).toFixed(2))
            : costoMateriaYEnvase;

        const artCheck = await q.query('SELECT numero FROM public.articulos WHERE UPPER(numero) = UPPER($1) OR UPPER(codigo_barras) = UPPER($1) LIMIT 1', [sku]);
        if (artCheck.rows.length === 0) {
            await q.query(
                `INSERT INTO public.articulos (numero, codigo_barras, nombre)
                 VALUES ($1,$1,$2)`,
                [sku, descTecnicaBunker]
            );
        } else if (esEdicionDesdeCotizador && !existeNativoPreviamente) {
            await q.query(
                `UPDATE public.articulos SET nombre = $2, codigo_barras = $1 WHERE UPPER(numero) = UPPER($1) OR UPPER(codigo_barras) = UPPER($1)`,
                [sku, descTecnicaBunker]
            );
        }

        const baCheck = await q.query('SELECT articulo_id FROM public.bunker_articulos WHERE UPPER(articulo_id) = UPPER($1) LIMIT 1', [sku]);
        if (baCheck.rows.length === 0) {
            await q.query(
                `INSERT INTO public.bunker_articulos (
                    articulo_id, codigo_barras, descripcion, descripcion_generada,
                    kilos_unidad, costo_base, porcentaje_iva, rubro, sub_rubro,
                    familia_id, no_producido_por_lambda, es_pack, pack_unidades,
                    expresado_en_gramos, propiedades_dinamicas
                 ) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,$11,$12,$13)`,
                [
                    sku,
                    anatomia.articulo_principal || art.articulo_principal_bunker || descTecnicaBunker,
                    descTecnicaBunker,
                    kilos,
                    costoMateriaYEnvase,
                    Number(art.iva_pct ?? 21),
                    anatomia.rubro || null,
                    anatomia.sub_rubro || null,
                    anatomia.familia_id || art.familia_bunker_id || null,
                    Boolean(anatomia.es_pack),
                    Number(anatomia.pack_unidades || 1),
                    Boolean(anatomia.expresado_en_gramos),
                    JSON.stringify(propDinamicasCompletas)
                ]
            );
        } else if (esEdicionDesdeCotizador && !existeNativoPreviamente) {
            await q.query(
                `UPDATE public.bunker_articulos SET
                    descripcion = $2,
                    descripcion_generada = $3,
                    kilos_unidad = $4,
                    costo_base = $5,
                    porcentaje_iva = $6,
                    rubro = COALESCE($7, rubro),
                    sub_rubro = COALESCE($8, sub_rubro),
                    familia_id = COALESCE($9, familia_id),
                    es_pack = $10,
                    pack_unidades = $11,
                    expresado_en_gramos = $12,
                    propiedades_dinamicas = ((COALESCE(propiedades_dinamicas, '{}'::jsonb) - 'alias_comercial_vecino' - 'alias_vecino_nodo') || $13::jsonb)
                 WHERE UPPER(articulo_id) = UPPER($1)`,
                [
                    sku,
                    anatomia.articulo_principal || art.articulo_principal_bunker || descTecnicaBunker,
                    descTecnicaBunker,
                    kilos,
                    costoMateriaYEnvase,
                    Number(art.iva_pct ?? 21),
                    anatomia.rubro || null,
                    anatomia.sub_rubro || null,
                    anatomia.familia_id || art.familia_bunker_id || null,
                    Boolean(anatomia.es_pack),
                    Number(anatomia.pack_unidades || 1),
                    Boolean(anatomia.expresado_en_gramos),
                    JSON.stringify(propDinamicasCompletas)
                ]
            );
        } else {
            // Artículo nativo existente en Búnker: preservar intactos su costo_base, tiempos de asistente y taxonomía,
            // limpiando cualquier alias comercial viejo y manteniendo únicamente metadatos técnicos de canal.
            const patchProps = esEdicionDesdeCotizador
                ? { asistente_minutos: minutosFracc, asistente_colaborador_id: usuarioColabId, ...propMetadataNodo }
                : propMetadataNodo;
            await q.query(
                `UPDATE public.bunker_articulos
                 SET propiedades_dinamicas = ((COALESCE(propiedades_dinamicas, '{}'::jsonb) - 'alias_comercial_vecino' - 'alias_vecino_nodo') || $2::jsonb)
                 WHERE UPPER(articulo_id) = UPPER($1)`,
                [sku, JSON.stringify(patchProps)]
            );
        }

        // Stock inicial real en stock_real_consolidado (0 unidades cuando se da de alta una fracción nueva; jamás inyectar stock artificial):
        const srcCheck = await q.query('SELECT articulo_numero FROM public.stock_real_consolidado WHERE UPPER(articulo_numero) = UPPER($1) OR UPPER(codigo_barras) = UPPER($1) LIMIT 1', [sku]);
        if (srcCheck.rows.length === 0) {
            await q.query(
                `INSERT INTO public.stock_real_consolidado (
                    articulo_numero, codigo_barras, descripcion, stock_lomasoft, stock_movimientos,
                    stock_ajustes, stock_consolidado, kilos_unidad, no_producido_por_lambda, solo_produccion_externa, es_pack
                 ) VALUES ($1,$1,$2,0,0,0,0,$3,false,false,$4)`,
                [sku, descTecnicaBunker, kilos, Boolean(anatomia.es_pack)]
            );
        } else {
            await q.query(
                `UPDATE public.stock_real_consolidado
                 SET kilos_unidad = COALESCE(NULLIF(kilos_unidad, 0), $1)
                 WHERE UPPER(articulo_numero) = UPPER($2) OR UPPER(codigo_barras) = UPPER($2)`,
                [kilos, sku]
            );
        }

        // Asegurar Receta Nativa en public.recetas + public.receta_ingredientes (con articulo_sugerido_numero puente)
        const ingComercialId = anatomia.ingrediente_comercial_id || art.ingrediente_origen_id;
        const artSugeridoPuente = anatomia.articulo_vinculado_numero || art.ing_articulo_vinculado_numero || null;
        if (ingComercialId) {
            const recCheck = await q.query('SELECT id FROM public.recetas WHERE UPPER(articulo_numero) = UPPER($1) LIMIT 1', [sku]);
            let recetaId;
            if (recCheck.rows.length === 0) {
                const insRec = await q.query(
                    `INSERT INTO public.recetas (articulo_numero, descripcion, articulo_sugerido_numero, fecha_creacion, enlazado_externo)
                     VALUES ($1, $2, $3, NOW(), false)
                     RETURNING id`,
                    [sku, descTecnicaBunker, artSugeridoPuente]
                );
                recetaId = insRec.rows[0].id;
            } else {
                recetaId = recCheck.rows[0].id;
                await q.query(
                    `UPDATE public.recetas
                     SET articulo_sugerido_numero = COALESCE($2, articulo_sugerido_numero),
                         descripcion = CASE WHEN $3::boolean THEN $4 ELSE descripcion END
                     WHERE id = $1`,
                    [recetaId, artSugeridoPuente, Boolean(esEdicionDesdeCotizador && !existeNativoPreviamente), descTecnicaBunker]
                );
            }

            const recItemsCntRes = await q.query('SELECT COUNT(*)::int AS cnt FROM public.receta_ingredientes WHERE receta_id = $1', [recetaId]);
            const tieneItemsReceta = Number(recItemsCntRes.rows[0]?.cnt || 0) > 0;

            if (!tieneItemsReceta || (esEdicionDesdeCotizador && !existeNativoPreviamente)) {
                await q.query('DELETE FROM public.receta_ingredientes WHERE receta_id = $1', [recetaId]);

                // 1) Ingrediente alimenticio simple (Puente)
                await q.query(
                    `INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, cantidad)
                     VALUES ($1, $2, $3, 'Kilo', $4)`,
                    [recetaId, ingComercialId, anatomia.ingrediente_comercial_nombre || art.ing_origen_nombre || descTecnicaBunker, kilos]
                );

                // 2) Si es Pack de Barritas (#141), agregar primero los flowpacks individuales (#181 Bolsa 8 x 15)
                if (Number(ingComercialId) === 141) {
                    const cantFlowpacks = Number(anatomia.pack_unidades || 6);
                    await q.query(
                        `INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, cantidad)
                         VALUES ($1, $2, $3, 'Unidades', $4)`,
                        [recetaId, env181Info.id, env181Info.nombre, cantFlowpacks]
                    );
                }

                // 3) Envase contenedor / bolsa primaria
                if (art.insumo_envase_id) {
                    await q.query(
                        `INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, cantidad)
                         VALUES ($1, $2, $3, 'Unidades', $4)`,
                        [
                            recetaId,
                            Number(art.insumo_envase_id),
                            art.env_nombre || (Number(art.insumo_envase_id) === 179 ? 'Bolsa 20 x 25' : 'Bolsa 15 x 18'),
                            Number(art.cantidad_envases_unidad || 1)
                        ]
                    );
                }
            }
        }

        // Poblar bunker_lista_articulos preservando 100% los cambios hechos en Artículos y Diccionario Búnker (Finanzas / Listas)
        const esMultipackDeHijoComercial = Boolean(
            anatomia.pack_hijo_codigo &&
            anatomia.es_pack &&
            Number(anatomia.pack_unidades || 1) > 1
        );

        for (const lp of listasActivas) {
            const esListaNodos = String(lp.canal_comercial || 'MAYORISTA').toUpperCase() === 'NODOS';
            const disponibleEnLista = esListaNodos
                ? true
                : Boolean(compartidoMayorista && listasCompIds.includes(Number(lp.id)));

            let listaArtId = null;

            if (esListaNodos) {
                const exLaNodos = await q.query(
                    `SELECT id, disponible FROM public.bunker_lista_articulos
                     WHERE lista_id = $1 AND UPPER(articulo_numero) = UPPER($2)
                     LIMIT 1 FOR UPDATE`,
                    [lp.id, sku]
                );

                if (exLaNodos.rows.length === 0) {
                    const manoObraActivaNodo = Number(art.costo_mano_obra_aplicado || 0) > 0;
                    const insLa = await q.query(
                        `INSERT INTO public.bunker_lista_articulos (
                            lista_id, articulo_numero, margen_ganancia, costo_base_sobrescrito,
                            costo_tiempo, iva, precio_final, modo_calculo, modo_iva,
                            es_patron, disponible, mano_obra_activa, updated_at
                         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'AUTOMATIC','COMPLETO',false,true,$8,NOW())
                         RETURNING id`,
                        [
                            lp.id,
                            sku,
                            Number(art.margen_lamda_pct ?? 22),
                            costoRecetaPorKg > 0 ? costoRecetaPorKg : null,
                            Number(art.costo_mano_obra_aplicado || 0),
                            Number(art.iva_pct ?? 21),
                            Number(art.precio_base_nodo_final || 0),
                            manoObraActivaNodo
                        ]
                    );
                    listaArtId = insLa.rows[0].id;
                } else if (esEdicionDesdeCotizador || forzarPreciosNodos) {
                    const manoObraActivaNodo = Number(art.costo_mano_obra_aplicado || 0) > 0;
                    listaArtId = exLaNodos.rows[0].id;
                    await q.query(
                        `UPDATE public.bunker_lista_articulos SET
                            margen_ganancia = $2,
                            costo_base_sobrescrito = $3,
                            costo_tiempo = $4,
                            iva = $5,
                            precio_final = $6,
                            disponible = true,
                            mano_obra_activa = $7,
                            updated_at = NOW()
                         WHERE id = $1`,
                        [
                            listaArtId,
                            Number(art.margen_lamda_pct ?? 22),
                            costoRecetaPorKg > 0 ? costoRecetaPorKg : null,
                            Number(art.costo_mano_obra_aplicado || 0),
                            Number(art.iva_pct ?? 21),
                            Number(art.precio_base_nodo_final || 0),
                            manoObraActivaNodo
                        ]
                    );
                } else {
                    // Ya existe en Lista Base Nodos Barriales: respetar intactos su margen, mano de obra y precio configurados en Búnker
                    listaArtId = exLaNodos.rows[0].id;
                    if (exLaNodos.rows[0].disponible !== true) {
                        await q.query(
                            `UPDATE public.bunker_lista_articulos SET disponible = true, updated_at = NOW() WHERE id = $1`,
                            [listaArtId]
                        );
                    }
                }
            } else {
                const exLa = await q.query(
                    `SELECT id, disponible FROM public.bunker_lista_articulos
                     WHERE lista_id = $1 AND UPPER(articulo_numero) = UPPER($2)
                     LIMIT 1 FOR UPDATE`,
                    [lp.id, sku]
                );

                if (exLa.rows.length > 0) {
                    // Preservar siempre márgenes, costos y disponibilidad mayorista existentes en el Búnker
                    listaArtId = exLa.rows[0].id;
                    if (esEdicionDesdeCotizador && disponibleEnLista && exLa.rows[0].disponible === false) {
                        await q.query(
                            `UPDATE public.bunker_lista_articulos SET disponible = true, updated_at = NOW() WHERE id = $1`,
                            [listaArtId]
                        );
                    }
                } else {
                    const insLaMay = await q.query(
                        `INSERT INTO public.bunker_lista_articulos (
                            lista_id, articulo_numero, margen_ganancia, costo_base_sobrescrito,
                            costo_tiempo, iva, precio_final, modo_calculo, modo_iva,
                            es_patron, disponible, mano_obra_activa, updated_at
                         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'AUTOMATIC','COMPLETO',false,$8,$9,NOW())
                         RETURNING id`,
                        [
                            lp.id,
                            sku,
                            Number(art.margen_lamda_pct ?? 22),
                            costoRecetaPorKg > 0 ? costoRecetaPorKg : null,
                            Number(art.costo_mano_obra_aplicado || 0),
                            Number(art.iva_pct ?? 21),
                            Number(art.precio_base_nodo_final || 0),
                            disponibleEnLista,
                            Number(art.costo_mano_obra_aplicado || 0) > 0
                        ]
                    );
                    listaArtId = insLaMay.rows[0]?.id || null;
                }
            }

            // En LAMDA, solo los multipacks con pack_hijo_codigo llevan bolsón maestro en bunker_lista_insumos.
            if (listaArtId && !esMultipackDeHijoComercial && (esEdicionDesdeCotizador && !existeNativoPreviamente)) {
                await q.query('DELETE FROM public.bunker_lista_insumos WHERE lista_articulo_id = $1', [listaArtId]);
            }
        }
    }

    // Marcar disponible = false en listas NODOS únicamente para SKUs que hayan sido desactivados explícitamente (activo = false),
    // sin borrar jamás filas habilitadas desde el Búnker.
    await q.query(`
        UPDATE public.bunker_lista_articulos
        SET disponible = false, updated_at = NOW()
        WHERE lista_id IN (
            SELECT id FROM public.bunker_listas_precios WHERE COALESCE(canal_comercial, 'MAYORISTA') = 'NODOS'
        )
        AND disponible = true
        AND UPPER(articulo_numero) IN (
            SELECT UPPER(sku_nodo) FROM public.nodos_articulos_catalogo WHERE activo = false
        );
    `);

    // 3. Sincronizar cada Pedido/Canasto individual de Vecino con public.presupuestos y public.presupuestos_detalles
    //    (Arquitectura nativa LAMDA: 1 Cliente Nodo [9001] -> N Presupuestos individuales [NB-1001, NB-1002, ...],
    //     permitiendo control real de faltantes, Configurar Carros, 1 Remito R impreso por vecino y Verificación nativa).
    await q.query(`
        UPDATE public.presupuestos
        SET activo = false
        WHERE id_presupuesto_ext LIKE 'CAN-%'
          AND activo = true
    `);

    const canastosRes = await q.query(`
        SELECT nle.*, nm.nombre_marca, nm.gestor_nombre
        FROM public.nodos_lotes_estacion nle
        JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
        ORDER BY nle.id ASC
    `);

    for (const canasto of canastosRes.rows) {
        const infoCli = mapaClienteDomicilio.get(Number(canasto.nodo_id));
        if (!infoCli) continue;

        const pedidosCanastoRes = await q.query(
            `SELECT * FROM public.nodos_pedidos_vecinos
             WHERE lote_canasto_id = $1
             ORDER BY id ASC`,
            [canasto.id]
        );
        if (pedidosCanastoRes.rows.length === 0) continue;

        let primerPresupuestoIdCanasto = null;
        const secuenciasVecinos = [];
        let bolsasListasCount = 0;

        for (const pedido of pedidosCanastoRes.rows) {
            const estOpPed = String(pedido.estado_operativo || '').toUpperCase();
            const pagoOkCanasto = estOpPed !== 'ANULADO' && (
                pagosBancariosService.esPedidoHabilitadoArmadoDepositoNodos(pedido) ||
                ['ARMADO_EN_CANASTO', 'EN_PODER_GESTOR', 'EN_CAMINO_VECINO', 'ENTREGADO_VECINO'].includes(estOpPed)
            );
            if (estOpPed === 'ANULADO' || !pagoOkCanasto) {
                await q.query(
                    `UPDATE public.presupuestos
                     SET activo = false,
                         archivado = CASE WHEN $3 = 'ANULADO' THEN true ELSE archivado END,
                         estado = CASE WHEN $3 = 'ANULADO' THEN 'Anulado' ELSE estado END
                     WHERE id_presupuesto_ext = $1 OR ($2::int IS NOT NULL AND id = $2::int)`,
                    [pedido.codigo_pedido, pedido.presupuesto_id_local || null, estOpPed]
                );
                continue;
            }

            const itemsPedidoRes = await q.query(
                `SELECT sku_nodo,
                        MAX(nombre_publico) AS nombre_publico,
                        SUM(cantidad)::numeric(12,2) AS cantidad_total,
                        MAX(precio_unitario_base_lamda)::numeric(14,2) AS precio_base
                 FROM public.nodos_pedidos_items
                 WHERE pedido_id = $1
                   AND sku_nodo IS NOT NULL
                   AND TRIM(sku_nodo) != ''
                 GROUP BY sku_nodo
                 ORDER BY sku_nodo ASC`,
                [pedido.id]
            );
            if (itemsPedidoRes.rows.length === 0) continue;

            const presCheck = await q.query(
                `SELECT * FROM public.presupuestos
                 WHERE id_presupuesto_ext = $1
                 ORDER BY id DESC LIMIT 1`,
                [pedido.codigo_pedido]
            );

            let secuenciaTarget = String(pedido.secuencia_operativa_lamda || '').trim();
            if (!secuenciaTarget) {
                if (presCheck.rows[0]?.secuencia) {
                    secuenciaTarget = presCheck.rows[0].secuencia;
                } else {
                    secuenciaTarget = canasto.secuencia_operativa_lamda || 'Imprimir';
                }
            }

            let estadoTarget = 'Presupuesto/Orden';
            let estadoLogisticoTarget = 'PENDIENTE';

            if (canasto.estado_canasto === 'ENTREGADO_AL_GESTOR' || ['EN_PODER_GESTOR', 'ENTREGADO_VECINO'].includes(String(pedido.estado_operativo || ''))) {
                secuenciaTarget = 'Entregado';
                estadoTarget = 'Entregado';
                estadoLogisticoTarget = 'ENTREGADO_DEPOSITO';
                bolsasListasCount++;
            } else if (secuenciaTarget === 'Retira_Deposito') {
                estadoTarget = 'Retira por Deposito';
                estadoLogisticoTarget = 'PENDIENTE';
                bolsasListasCount++;
            } else if (secuenciaTarget === 'Pedido_Listo') {
                estadoTarget = 'Presupuesto/Orden';
                estadoLogisticoTarget = 'PENDIENTE_ASIGNAR';
                bolsasListasCount++;
            } else {
                if (!['Imprimir', 'Imprimir_Modificado', 'Armar_Pedido'].includes(secuenciaTarget)) {
                    secuenciaTarget = 'Imprimir';
                }
                estadoTarget = 'Presupuesto/Orden';
                estadoLogisticoTarget = 'PENDIENTE';
                if (String(pedido.estado_operativo || '') === 'ARMADO_EN_CANASTO') {
                    bolsasListasCount++;
                }
            }

            const modEntregaNota = pedido.modalidad_entrega === 'ENVIO_BARRIAL'
                ? `Envío Barrial (${pedido.direccion_entrega || 'Domicilio'})`
                : `Retira en ${canasto.nombre_marca}`;
            const notaPresupuesto = `${canasto.nombre_marca} · Canasto ${canasto.codigo_canasto} · Vecino: ${pedido.vecino_nombre} (#${pedido.codigo_pedido}) · ${modEntregaNota} · Pago: ${pedido.medio_pago || 'TRANSFERENCIA'}`;
            const puntoEntregaStr = `${canasto.nombre_marca} — ${pedido.vecino_nombre} (${modEntregaNota})`;

            let presupuestoIdLocal;
            if (presCheck.rows.length === 0) {
                const insP = await q.query(
                    `INSERT INTO public.presupuestos (
                        id_presupuesto_ext, id_cliente, fecha, fecha_entrega,
                        estado, secuencia, estado_logistico,
                        agente, tipo_comprobante, punto_entrega,
                        nota, id_domicilio_entrega, activo, archivado
                     ) VALUES ($1,$2,CURRENT_DATE,CURRENT_DATE,$3,$4,$5,'Nodo Barrial','Pedido Vecino Nodo',$6,$7,$8,true,false)
                     RETURNING id`,
                    [
                        pedido.codigo_pedido,
                        String(infoCli.cliente_id_num),
                        estadoTarget,
                        secuenciaTarget,
                        estadoLogisticoTarget,
                        puntoEntregaStr,
                        notaPresupuesto,
                        infoCli.domicilio_id
                    ]
                );
                presupuestoIdLocal = insP.rows[0].id;
            } else {
                const pExist = presCheck.rows[0];
                presupuestoIdLocal = pExist.id;

                const enRutaActiva = Boolean(pExist.id_ruta) && ['ASIGNADO', 'EN_CAMINO'].includes(String(pExist.estado_logistico || '').toUpperCase());
                const estLogFinal = enRutaActiva ? pExist.estado_logistico : estadoLogisticoTarget;
                const secFinal = enRutaActiva ? (pExist.secuencia || 'Asignado_Ruta') : secuenciaTarget;
                secuenciaTarget = secFinal;

                await q.query(
                    `UPDATE public.presupuestos
                     SET id_cliente = $1,
                         fecha = CURRENT_DATE,
                         estado = $2,
                         secuencia = $3,
                         estado_logistico = $4,
                         agente = 'Nodo Barrial',
                         tipo_comprobante = 'Pedido Vecino Nodo',
                         punto_entrega = $5,
                         nota = $6,
                         id_domicilio_entrega = COALESCE(id_domicilio_entrega, $7),
                         activo = true,
                         archivado = false
                     WHERE id = $8`,
                    [
                        String(infoCli.cliente_id_num),
                        estadoTarget,
                        secFinal,
                        estLogFinal,
                        puntoEntregaStr,
                        notaPresupuesto,
                        infoCli.domicilio_id,
                        presupuestoIdLocal
                    ]
                );
            }

            // Sincronizar presupuestos_detalles únicamente si cambió la composición (evita regenerar filas innecesariamente)
            const detExistRes = await q.query(
                `SELECT articulo, cantidad::numeric(12,2) AS cantidad
                 FROM public.presupuestos_detalles
                 WHERE id_presupuesto = $1
                 ORDER BY articulo ASC`,
                [presupuestoIdLocal]
            );
            const firmaActual = detExistRes.rows.map(r => `${r.articulo}:${Number(r.cantidad)}`).join('|');
            const firmaNueva = itemsPedidoRes.rows.map(r => `${r.sku_nodo}:${Number(r.cantidad_total)}`).join('|');

            if (firmaActual !== firmaNueva) {
                await q.query('DELETE FROM public.presupuestos_detalles WHERE id_presupuesto = $1 OR id_presupuesto_ext = $2', [presupuestoIdLocal, pedido.codigo_pedido]);
                for (const item of itemsPedidoRes.rows) {
                    const cant = Number(item.cantidad_total || 1);
                    const precioBase = Number(item.precio_base || 0);
                    const subtotalBase = Number((cant * precioBase).toFixed(2));
                    await q.query(
                        `INSERT INTO public.presupuestos_detalles (
                            id_presupuesto, id_presupuesto_ext, articulo, cantidad,
                            valor1, precio1, iva1, diferencia, camp1, fecha_actualizacion
                         ) VALUES ($1,$2,$3,$4,$5,$6,0,0,$6,NOW())`,
                        [
                            presupuestoIdLocal,
                            pedido.codigo_pedido,
                            item.sku_nodo,
                            cant,
                            precioBase,
                            subtotalBase
                        ]
                    );
                }
            }

            await q.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET presupuesto_id_local = $1,
                     secuencia_operativa_lamda = $2
                 WHERE id = $3`,
                [presupuestoIdLocal, secuenciaTarget, pedido.id]
            );

            if (!primerPresupuestoIdCanasto) primerPresupuestoIdCanasto = presupuestoIdLocal;
            secuenciasVecinos.push(secuenciaTarget);
        }

        // Consolidar estado padre del Canasto a partir de sus pedidos vecinales
        let secResumenCanasto = canasto.secuencia_operativa_lamda || 'Imprimir';
        let estadoCanastoConsolidado = canasto.estado_canasto || 'EN_ARMADO';
        if (secuenciasVecinos.length > 0) {
            if (secuenciasVecinos.every(s => s === 'Entregado')) {
                secResumenCanasto = 'Entregado';
                estadoCanastoConsolidado = 'ENTREGADO_AL_GESTOR';
            } else if (secuenciasVecinos.every(s => s === 'Retira_Deposito')) {
                secResumenCanasto = 'Retira_Deposito';
                estadoCanastoConsolidado = 'LISTO_ESTACION_NODOS';
            } else if (secuenciasVecinos.every(s => ['Pedido_Listo', 'Retira_Deposito'].includes(s))) {
                secResumenCanasto = 'Pedido_Listo';
                estadoCanastoConsolidado = 'LISTO_ESTACION_NODOS';
            } else if (secuenciasVecinos.some(s => ['Armar_Pedido', 'Pedido_Listo', 'Retira_Deposito'].includes(s))) {
                secResumenCanasto = 'Armar_Pedido';
                if (estadoCanastoConsolidado !== 'ENTREGADO_AL_GESTOR') {
                    estadoCanastoConsolidado = 'EN_ARMADO';
                }
            } else {
                secResumenCanasto = 'Imprimir';
                if (estadoCanastoConsolidado !== 'ENTREGADO_AL_GESTOR') {
                    estadoCanastoConsolidado = 'EN_ARMADO';
                }
            }
        }

        await q.query(
            `UPDATE public.nodos_lotes_estacion
             SET presupuesto_id_local = COALESCE($1, presupuesto_id_local),
                 id_presupuesto_ext = $2,
                 secuencia_operativa_lamda = $3,
                 estado_canasto = $4,
                 bolsas_armadas = $5
             WHERE id = $6`,
            [primerPresupuestoIdCanasto, canasto.codigo_canasto, secResumenCanasto, estadoCanastoConsolidado, bolsasListasCount, canasto.id]
        );
    }

    // 4. Sincronizar órdenes individuales de Tiendas Online / E-Commerce Fulfillment (lote_canasto_id IS NULL)
    const pedidosFulfillmentRes = await q.query(`
        SELECT npv.*,
               nm.nombre_marca, nm.gestor_nombre, nm.perfil_operativo, nm.modulos_activos,
               npep.operador_postal AS postal_operador,
               npep.modalidad_postal AS postal_modalidad,
               npep.localidad_nombre AS postal_localidad,
               npep.provincia_nombre AS postal_provincia,
               npep.cp_destino AS postal_cp,
               npep.numero_tracking AS postal_numero_tracking
        FROM public.nodos_pedidos_vecinos npv
        JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
        LEFT JOIN public.nodos_pedidos_envios_postales npep ON npep.pedido_id = npv.id
        WHERE npv.lote_canasto_id IS NULL
          AND (
              LOWER(COALESCE(nm.perfil_operativo, 'vecinal')) = 'ecommerce_fulfillment'
              OR npep.id IS NOT NULL
              OR UPPER(COALESCE(npv.modalidad_entrega, '')) IN ('PAQUETERIA_DOMICILIO', 'PAQUETERIA_SUCURSAL', 'ENCOMIENDA', 'ENVIO_POSTAL')
          )
        ORDER BY npv.id ASC
    `);

    for (const pedido of pedidosFulfillmentRes.rows) {
        const infoCli = mapaClienteDomicilio.get(Number(pedido.nodo_id));
        if (!infoCli) continue;

        const estOp = String(pedido.estado_operativo || '').toUpperCase();
        const habilitadoArmadoFul = pagosBancariosService.esPedidoHabilitadoArmadoDepositoNodos(pedido);

        if (estOp === 'ANULADO' || !habilitadoArmadoFul) {
            await q.query(
                `UPDATE public.presupuestos
                 SET activo = false,
                     archivado = CASE WHEN $3 = 'ANULADO' THEN true ELSE archivado END,
                     estado = CASE WHEN $3 = 'ANULADO' THEN 'Anulado' ELSE estado END
                 WHERE id_presupuesto_ext = $1 OR ($2::int IS NOT NULL AND id = $2::int)`,
                [pedido.codigo_pedido, pedido.presupuesto_id_local || null, estOp]
            );
            continue;
        }

        const itemsPedidoRes = await q.query(
            `SELECT sku_nodo,
                    MAX(nombre_publico) AS nombre_publico,
                    SUM(cantidad)::numeric(12,2) AS cantidad_total,
                    MAX(precio_unitario_base_lamda)::numeric(14,2) AS precio_base
             FROM public.nodos_pedidos_items
             WHERE pedido_id = $1
               AND sku_nodo IS NOT NULL
               AND TRIM(sku_nodo) != ''
             GROUP BY sku_nodo
             ORDER BY sku_nodo ASC`,
            [pedido.id]
        );
        if (itemsPedidoRes.rows.length === 0) continue;

        const presCheck = await q.query(
            `SELECT * FROM public.presupuestos
             WHERE id_presupuesto_ext = $1
             ORDER BY id DESC LIMIT 1`,
            [pedido.codigo_pedido]
        );

        let secuenciaTarget = String(pedido.secuencia_operativa_lamda || '').trim();
        let estadoTarget = 'Presupuesto/Orden';
        let estadoLogisticoTarget = 'PENDIENTE';

        if (
            Boolean(pedido.debito_cta_cte_registrado) ||
            ['DESPACHADO_CORREO', 'EN_TRANSITO_CORREO', 'ENTREGADO', 'ENTREGADO_VECINO'].includes(estOp)
        ) {
            secuenciaTarget = 'Entregado';
            estadoTarget = 'Entregado';
            estadoLogisticoTarget = 'DESPACHADO_ENCOMIENDA';
        } else if (estOp === 'EMPAQUETADO_FULFILLMENT') {
            secuenciaTarget = 'Pedido_Listo';
            estadoTarget = 'Presupuesto/Orden';
            estadoLogisticoTarget = 'PENDIENTE_DESPACHO_POSTAL';
        } else {
            if (!['Imprimir', 'Imprimir_Modificado', 'Armar_Pedido'].includes(secuenciaTarget)) {
                secuenciaTarget = 'Armar_Pedido';
            }
            estadoTarget = 'Presupuesto/Orden';
            estadoLogisticoTarget = 'PENDIENTE';
        }

        const destPostalTxt = [pedido.postal_localidad, pedido.postal_provincia].filter(Boolean).join(', ') || pedido.direccion_entrega || 'Envío Nacional';
        const opPostalTxt = formatearOperadorPostalLabel(pedido.postal_operador || 'CORREO_ARGENTINO');
        const guiaTxt = pedido.postal_numero_tracking ? ` · Guía #${pedido.postal_numero_tracking}` : '';
        const notaPresupuesto = `${pedido.nombre_marca} · Fulfillment 24/7 (#${pedido.codigo_pedido}) · Destinatario: ${pedido.vecino_nombre} · ${opPostalTxt} (${destPostalTxt}${pedido.postal_cp ? ' CP ' + pedido.postal_cp : ''})${guiaTxt}`;
        const puntoEntregaStr = `${pedido.nombre_marca} — ${pedido.vecino_nombre} (${destPostalTxt})`;

        let presupuestoIdLocal;
        if (presCheck.rows.length === 0) {
            const insP = await q.query(
                `INSERT INTO public.presupuestos (
                    id_presupuesto_ext, id_cliente, fecha, fecha_entrega,
                    estado, secuencia, estado_logistico,
                    agente, tipo_comprobante, punto_entrega,
                    nota, id_domicilio_entrega, activo, archivado
                 ) VALUES ($1,$2,CURRENT_DATE,CURRENT_DATE,$3,$4,$5,'Fulfillment Tienda Online','Orden Fulfillment Paquetería',$6,$7,$8,true,false)
                 RETURNING id`,
                [
                    pedido.codigo_pedido,
                    String(infoCli.cliente_id_num),
                    estadoTarget,
                    secuenciaTarget,
                    estadoLogisticoTarget,
                    puntoEntregaStr,
                    notaPresupuesto,
                    infoCli.domicilio_id
                ]
            );
            presupuestoIdLocal = insP.rows[0].id;
        } else {
            presupuestoIdLocal = presCheck.rows[0].id;
            await q.query(
                `UPDATE public.presupuestos
                 SET id_cliente = $1,
                     fecha = CURRENT_DATE,
                     estado = $2,
                     secuencia = $3,
                     estado_logistico = $4,
                     agente = 'Fulfillment Tienda Online',
                     tipo_comprobante = 'Orden Fulfillment Paquetería',
                     punto_entrega = $5,
                     nota = $6,
                     id_domicilio_entrega = COALESCE(id_domicilio_entrega, $7),
                     activo = true,
                     archivado = false
                 WHERE id = $8`,
                [
                    String(infoCli.cliente_id_num),
                    estadoTarget,
                    secuenciaTarget,
                    estadoLogisticoTarget,
                    puntoEntregaStr,
                    notaPresupuesto,
                    infoCli.domicilio_id,
                    presupuestoIdLocal
                ]
            );
        }

        const detExistRes = await q.query(
            `SELECT articulo, cantidad::numeric(12,2) AS cantidad
             FROM public.presupuestos_detalles
             WHERE id_presupuesto = $1
             ORDER BY articulo ASC`,
            [presupuestoIdLocal]
        );
        const firmaActual = detExistRes.rows.map(r => `${r.articulo}:${Number(r.cantidad)}`).join('|');
        const firmaNueva = itemsPedidoRes.rows.map(r => `${r.sku_nodo}:${Number(r.cantidad_total)}`).join('|');

        if (firmaActual !== firmaNueva) {
            await q.query('DELETE FROM public.presupuestos_detalles WHERE id_presupuesto = $1 OR id_presupuesto_ext = $2', [presupuestoIdLocal, pedido.codigo_pedido]);
            for (const item of itemsPedidoRes.rows) {
                const cant = Number(item.cantidad_total || 1);
                const precioBase = Number(item.precio_base || 0);
                const subtotalBase = Number((cant * precioBase).toFixed(2));
                await q.query(
                    `INSERT INTO public.presupuestos_detalles (
                        id_presupuesto, id_presupuesto_ext, articulo, cantidad,
                        valor1, precio1, iva1, diferencia, camp1, fecha_actualizacion
                     ) VALUES ($1,$2,$3,$4,$5,$6,0,0,$6,NOW())`,
                    [
                        presupuestoIdLocal,
                        pedido.codigo_pedido,
                        item.sku_nodo,
                        cant,
                        precioBase,
                        subtotalBase
                    ]
                );
            }
        }

        await q.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET presupuesto_id_local = $1,
                 secuencia_operativa_lamda = $2
             WHERE id = $3`,
            [presupuestoIdLocal, secuenciaTarget, pedido.id]
        );
    }
}

/**
 * Sincroniza bidireccionalmente cuando desde produccion.html (Imprimir / Armar Pedido / Chequeo / Retira por Depósito)
 * se cambia la secuencia de uno o varios presupuestos vecinales ('NB-...') o de un Canasto ('CAN-...').
 */
async function sincronizarCambioSecuenciaDesdeLamda(presupuestosIds = [], nuevaSecuencia = '') {
    if (!Array.isArray(presupuestosIds) || presupuestosIds.length === 0) return;

    const idsStr = presupuestosIds.map(x => String(x).trim()).filter(Boolean);
    if (idsStr.length === 0) return;

    // 1. Buscar pedidos vecinales alcanzados directamente (NB-... o presupuesto_id_local) o por código de canasto padre
    const pedRes = await db.query(
        `SELECT npv.*, nle.codigo_canasto
         FROM public.nodos_pedidos_vecinos npv
         LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
         WHERE npv.codigo_pedido = ANY($1::text[])
            OR npv.presupuesto_id_local::text = ANY($1::text[])
            OR nle.codigo_canasto = ANY($1::text[])
            OR nle.id_presupuesto_ext = ANY($1::text[])`,
        [idsStr]
    );

    if (pedRes.rows.length === 0) return;

    const pedidoIds = pedRes.rows.map(r => Number(r.id));
    const canastoIdsSet = new Set(pedRes.rows.map(r => Number(r.lote_canasto_id)).filter(Boolean));

    if (nuevaSecuencia === 'Imprimir' || nuevaSecuencia === 'Imprimir_Modificado') {
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_operativo = CASE WHEN COALESCE(hito_tracking_actual, 1) < 2 THEN 'CONFIRMADO_VECINO' ELSE estado_operativo END,
                 ubicacion_deposito = CASE WHEN COALESCE(hito_tracking_actual, 1) < 3 THEN 'PENDIENTE_TALLER' ELSE ubicacion_deposito END,
                 secuencia_operativa_lamda = $1,
                 updated_at = NOW()
             WHERE id = ANY($2::int[])
               AND COALESCE(estado_operativo, '') <> 'ANULADO'`,
            [nuevaSecuencia, pedidoIds]
        );
    } else if (nuevaSecuencia === 'Armar_Pedido') {
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET secuencia_operativa_lamda = 'Armar_Pedido',
                 updated_at = NOW()
             WHERE id = ANY($1::int[])
               AND COALESCE(estado_operativo, '') <> 'ANULADO'`,
            [pedidoIds]
        );
        for (const pid of pedidoIds) {
            await registrarTransicionHitoPedidoVecino(db, pid, 2, {
                origen: 'PRODUCCION_IMPRESION',
                actor: 'Taller Producción',
                detalle: 'Orden impresa y en preparación de productos'
            });
        }
    } else if (nuevaSecuencia === 'Pedido_Listo' || nuevaSecuencia === 'Retira_Deposito') {
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET ubicacion_deposito = CASE WHEN COALESCE(hito_tracking_actual, 1) < 4 THEN 'ESTACION_NODOS' ELSE ubicacion_deposito END,
                 etiqueta_impresa = true,
                 fecha_armado_bolsa = COALESCE(fecha_armado_bolsa, NOW()),
                 operario_armado = COALESCE(operario_armado, 'Chequeo Producción LAMDA'),
                 secuencia_operativa_lamda = $1,
                 updated_at = NOW()
             WHERE id = ANY($2::int[])
               AND COALESCE(estado_operativo, '') <> 'ANULADO'`,
            [nuevaSecuencia, pedidoIds]
        );
        for (const pid of pedidoIds) {
            await registrarTransicionHitoPedidoVecino(db, pid, 3, {
                origen: 'VERIFICACION_LECTOR',
                actor: 'Verificación Código de Barras',
                detalle: `Bolsa verificada y controlada (${nuevaSecuencia})`
            });
        }
    } else if (nuevaSecuencia === 'Entregado') {
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET secuencia_operativa_lamda = 'Entregado',
                 updated_at = NOW()
             WHERE id = ANY($1::int[])
               AND COALESCE(estado_operativo, '') <> 'ANULADO'`,
            [pedidoIds]
        );
    }

    // 2. Recalcular estado consolidado de cada Canasto afectado
    for (const canastoId of canastoIdsSet) {
        const canCheck = await db.query('SELECT * FROM public.nodos_lotes_estacion WHERE id = $1', [canastoId]);
        if (canCheck.rows.length === 0) continue;
        const canasto = canCheck.rows[0];

        if (nuevaSecuencia === 'Entregado') {
            const pedsCan = await db.query('SELECT secuencia_operativa_lamda FROM public.nodos_pedidos_vecinos WHERE lote_canasto_id = $1', [canastoId]);
            const todosEntregados = pedsCan.rows.length > 0 && pedsCan.rows.every(r => r.secuencia_operativa_lamda === 'Entregado');
            if (todosEntregados || idsStr.includes(canasto.codigo_canasto)) {
                if (canasto.estado_canasto !== 'ENTREGADO_AL_GESTOR' || !canasto.debito_cta_cte_registrado) {
                    await confirmarRetiroCanastoPorGestor(canastoId, {
                        retirado_por: 'Entrega / Despacho LAMDA'
                    });
                }
                await db.query(
                    `UPDATE public.nodos_lotes_estacion
                     SET secuencia_operativa_lamda = 'Entregado',
                         updated_at = NOW()
                     WHERE id = $1`,
                    [canastoId]
                );
                continue;
            }
        }

        const pedsEstado = await db.query(
            `SELECT estado_operativo, COALESCE(secuencia_operativa_lamda, 'Imprimir') AS sec
             FROM public.nodos_pedidos_vecinos
             WHERE lote_canasto_id = $1`,
            [canastoId]
        );
        const rowsP = pedsEstado.rows;
        const totalP = rowsP.length;
        const armadasP = rowsP.filter(r => ['ARMADO_EN_CANASTO', 'EN_PODER_GESTOR', 'EN_CAMINO_VECINO', 'ENTREGADO_VECINO'].includes(String(r.estado_operativo || '')) || ['Pedido_Listo', 'Retira_Deposito', 'Entregado'].includes(r.sec)).length;

        let nuevaSecCan = 'Imprimir';
        let nuevoEstCan = 'EN_ARMADO';
        if (totalP > 0 && rowsP.every(r => r.sec === 'Retira_Deposito')) {
            nuevaSecCan = 'Retira_Deposito';
            nuevoEstCan = 'LISTO_ESTACION_NODOS';
        } else if (totalP > 0 && rowsP.every(r => ['Pedido_Listo', 'Retira_Deposito'].includes(r.sec))) {
            nuevaSecCan = 'Pedido_Listo';
            nuevoEstCan = 'LISTO_ESTACION_NODOS';
        } else if (rowsP.some(r => ['Armar_Pedido', 'Pedido_Listo', 'Retira_Deposito'].includes(r.sec))) {
            nuevaSecCan = 'Armar_Pedido';
            nuevoEstCan = 'EN_ARMADO';
        }

        await db.query(
            `UPDATE public.nodos_lotes_estacion
             SET estado_canasto = $1,
                 ubicacion_deposito = 'ESTACION_NODOS',
                 bolsas_armadas = $2,
                 secuencia_operativa_lamda = $3,
                 fecha_listo_estacion = CASE WHEN $1 = 'LISTO_ESTACION_NODOS' THEN COALESCE(fecha_listo_estacion, NOW()) ELSE fecha_listo_estacion END,
                 updated_at = NOW()
             WHERE id = $4`,
            [nuevoEstCan, armadasP, nuevaSecCan, canastoId]
        );
    }
}

/**
 * Enganche determinista para Hito 2 (EN_PREPARACION) cuando desde Configurar Carros
 * se asignan artículos faltantes de un Nodo Barrial a un operador de fraccionamiento.
 */
async function notificarInicioPreparacionCarroNodo({ cliente_id = null, articulos = [], operario = 'Operador Taller', carro_id = null } = {}) {
    try {
        await asegurarEsquemaNodosBarriales();
        const skusUpper = Array.isArray(articulos)
            ? articulos.map(a => String(a.articulo_numero || a.codigo || a || '').trim().toUpperCase()).filter(Boolean)
            : [];
        if (skusUpper.length === 0) return { actualizados: 0 };

        const cliNum = Number(cliente_id || 0);
        let filtroNodoSql = '';
        const params = [skusUpper];
        if (cliNum >= 9001 && cliNum < 9999) {
            params.push(cliNum - 9000);
            filtroNodoSql = `AND npv.nodo_id = $2`;
        }

        const pedsRes = await db.query(
            `SELECT DISTINCT npv.id
             FROM public.nodos_pedidos_vecinos npv
             JOIN public.nodos_pedidos_items npi ON npi.pedido_id = npv.id
             WHERE COALESCE(npv.estado_operativo, '') <> 'ANULADO'
               AND COALESCE(npv.hito_tracking_actual, 1) < 2
               AND UPPER(TRIM(npi.sku_nodo)) = ANY($1::text[])
               ${filtroNodoSql}`,
            params
        );

        let actualizados = 0;
        for (const r of pedsRes.rows) {
            const resHito = await registrarTransicionHitoPedidoVecino(db, r.id, 2, {
                origen: 'PRODUCCION_CARRO',
                actor: String(operario || 'Operador Taller'),
                detalle: `Artículos asignados a Carro de Producción${carro_id ? ` #${carro_id}` : ''}`
            });
            if (resHito.avanzado) actualizados++;
        }
        return { actualizados };
    } catch (err) {
        console.warn('⚠️ [NodosBarriales] Advertencia notificando inicio de preparación en carro:', err.message);
        return { actualizados: 0 };
    }
}

/**
 * Permite situar un Canasto en cualquiera de las etapas del circuito operativo habitual de LAMDA
 * respetando siempre el stock real sin inyectar stock artificial.
 */
async function cambiarEtapaCircuitoLamdaCanasto(canastoIdOrCodigo, etapaDestino = 'IMPRIMIR_CON_FALTANTES') {
    await asegurarEsquemaNodosBarriales();

    const canRes = await db.query(
        `SELECT * FROM public.nodos_lotes_estacion
         WHERE id::text = $1 OR codigo_canasto = $1 OR id_presupuesto_ext = $1
         LIMIT 1`,
        [String(canastoIdOrCodigo).trim()]
    );
    if (canRes.rows.length === 0) {
        throw new Error('Canasto no encontrado.');
    }
    const canasto = canRes.rows[0];

    const etapaUpper = String(etapaDestino || '').toUpperCase().trim();
    if (etapaUpper !== 'ENTREGADO_GESTOR') {
        if (canasto.liquidacion_cerrada) {
            await reabrirLiquidacionCanastoPrueba(canasto.id);
        }
        const checkAfter = await db.query('SELECT * FROM public.nodos_lotes_estacion WHERE id = $1', [canasto.id]);
        if (checkAfter.rows[0]?.debito_cta_cte_registrado || checkAfter.rows[0]?.estado_canasto === 'ENTREGADO_AL_GESTOR') {
            await reabrirCanastoParaPruebaLaboratorio(canasto.id);
        }
        await db.query(
            `UPDATE public.presupuestos
             SET id_ruta = NULL, orden_entrega = NULL
             WHERE id IN (SELECT presupuesto_id_local FROM public.nodos_pedidos_vecinos WHERE lote_canasto_id = $1 AND presupuesto_id_local IS NOT NULL)`,
            [canasto.id]
        );
    }

    if (etapaUpper === 'IMPRIMIR_CON_FALTANTES') {
        await sincronizarCambioSecuenciaDesdeLamda([canasto.codigo_canasto], 'Imprimir');
    } else if (etapaUpper === 'ARMAR_CHEQUEO') {
        await sincronizarCambioSecuenciaDesdeLamda([canasto.codigo_canasto], 'Armar_Pedido');
    } else if (etapaUpper === 'PEDIDO_LISTO_REPARTO') {
        await sincronizarCambioSecuenciaDesdeLamda([canasto.codigo_canasto], 'Pedido_Listo');
    } else if (etapaUpper === 'RETIRA_DEPOSITO') {
        await sincronizarCambioSecuenciaDesdeLamda([canasto.codigo_canasto], 'Retira_Deposito');
    } else if (etapaUpper === 'ENTREGADO_GESTOR') {
        await db.query(
            `UPDATE public.presupuestos
             SET secuencia = 'Entregado', estado = 'Entregado', estado_logistico = 'ENTREGADO_DEPOSITO', activo = true
             WHERE id IN (SELECT presupuesto_id_local FROM public.nodos_pedidos_vecinos WHERE lote_canasto_id = $1 AND presupuesto_id_local IS NOT NULL)`,
            [canasto.id]
        );
        await sincronizarCambioSecuenciaDesdeLamda([canasto.codigo_canasto], 'Entregado');
    }

    await sincronizarCanastosEstacionNodos();
    return obtenerEstadoCircuitoOperativoLamda();
}

/**
 * Obtiene el resumen en vivo de los Canastos de Nodos dentro del circuito operativo de LAMDA
 * para mostrar en la barra de integración de produccion.html y /deposito-nodos
 */
async function obtenerEstadoCircuitoOperativoLamda() {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const res = await db.query(`
        SELECT nle.*,
               nm.codigo_nodo,
               nm.nombre_marca,
               nm.gestor_nombre,
               nm.barrio_zona,
               nm.direccion_retiro,
               nm.codigo_bunker_cliente,
               COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente,
               p.id AS presup_id,
               p.secuencia AS presup_secuencia,
               p.estado AS presup_estado,
               p.estado_logistico AS presup_estado_logistico,
               p.id_ruta AS presup_id_ruta,
               p.id_cliente AS presup_id_cliente
        FROM public.nodos_lotes_estacion nle
        JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
        LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
        LEFT JOIN public.presupuestos p ON p.id = nle.presupuesto_id_local
        ORDER BY nle.id ASC
    `);

    await sincronizarCanastosEstacionNodos();
    const tablero = await obtenerTableroMesaArmadoDeposito();
    const mapaCanastosTablero = new Map((tablero.canastos || []).map(c => [Number(c.id), c]));

    const canastos = res.rows.map(r => {
        const det = mapaCanastosTablero.get(Number(r.id)) || {};
        return {
            ...r,
            consolidado_mercaderia: det.consolidado_mercaderia || [],
            pedidos_vecinos: det.pedidos_vecinos || []
        };
    });

    return {
        canastos,
        resumen_deposito: tablero.resumen_deposito
    };
}

/**
 * Obtiene el tablero completo de la Mesa de Armado de Nodos (4° Depósito Conceptual ESTACION_NODOS),
 * con los Canastos por ventana, el resumen consolidado de mercadería a fraccionar y las bolsas individuales.
 */
async function obtenerTableroMesaArmadoDeposito(filtros = {}) {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const nodoIdFiltro = filtros.nodo_id ? Number(filtros.nodo_id) : 0;

    const [nodosRes, canastosRes, pedidosRes, itemsRes, movsRes, enviosPostalesRes, stockConsolidadoRes] = await Promise.all([
        db.query(`
            SELECT nm.id, nm.codigo_nodo, nm.slug, nm.nombre_marca, nm.bajada_marca, nm.subtitulo_marca,
                   nm.gestor_nombre, nm.gestor_telefono, nm.barrio_zona, nm.direccion_retiro,
                   nm.color_primario, nm.codigo_bunker_cliente,
                   nm.perfil_operativo, nm.modulos_activos, nm.config_paqueteria,
                   COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada,
                   nm.cliente_madre_bunker_id, nm.codigo_bunker_cliente_madre,
                   CASE WHEN COALESCE(nm.usar_cuenta_madre_unificada, false) AND nm.codigo_bunker_cliente_madre IS NOT NULL
                        THEN nm.codigo_bunker_cliente_madre
                        ELSE nm.codigo_bunker_cliente
                   END AS codigo_bunker_cuenta_activa,
                   CASE WHEN COALESCE(nm.usar_cuenta_madre_unificada, false) AND nm.codigo_bunker_cliente_madre IS NOT NULL
                        THEN COALESCE(cc_madre.saldo, 0)
                        ELSE COALESCE(cc.saldo, 0)
                   END::numeric(14,2) AS saldo_cuenta_corriente
            FROM public.nodos_maestro nm
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
            LEFT JOIN public.factura_cuentas_corrientes cc_madre
              ON cc_madre.codigo_bunker_cliente = nm.codigo_bunker_cliente_madre
             AND cc_madre.nombre_cuenta = 'Cuenta Principal'
            WHERE nm.activo = true
            ORDER BY nm.id ASC
        `),
        db.query(`
            SELECT nle.*,
                   nm.codigo_nodo,
                   nm.slug AS nodo_slug,
                   nm.nombre_marca,
                   nm.subtitulo_marca,
                   nm.gestor_nombre,
                   nm.gestor_telefono,
                   nm.barrio_zona,
                   nm.direccion_retiro,
                   nm.color_primario,
                   nm.codigo_bunker_cliente,
                   COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada,
                   nm.cliente_madre_bunker_id,
                   nm.codigo_bunker_cliente_madre,
                   CASE WHEN COALESCE(nm.usar_cuenta_madre_unificada, false) AND nm.codigo_bunker_cliente_madre IS NOT NULL
                        THEN nm.codigo_bunker_cliente_madre
                        ELSE nm.codigo_bunker_cliente
                   END AS codigo_bunker_cuenta_activa,
                   CASE WHEN COALESCE(nm.usar_cuenta_madre_unificada, false) AND nm.codigo_bunker_cliente_madre IS NOT NULL
                        THEN COALESCE(cc_madre.saldo, 0)
                        ELSE COALESCE(cc.saldo, 0)
                   END::numeric(14,2) AS saldo_cuenta_corriente
            FROM public.nodos_lotes_estacion nle
            JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
            LEFT JOIN public.factura_cuentas_corrientes cc_madre
              ON cc_madre.codigo_bunker_cliente = nm.codigo_bunker_cliente_madre
             AND cc_madre.nombre_cuenta = 'Cuenta Principal'
            WHERE ($1 = 0 OR nle.nodo_id = $1)
            ORDER BY
                CASE nle.estado_canasto
                    WHEN 'EN_ARMADO' THEN 0
                    WHEN 'LISTO_ESTACION_NODOS' THEN 1
                    ELSE 2
                END,
                COALESCE(nle.fecha_entrega_iso, CURRENT_DATE) ASC,
                nle.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT npv.*
            FROM public.nodos_pedidos_vecinos npv
            WHERE ($1 = 0 OR npv.nodo_id = $1)
              AND COALESCE(npv.estado_operativo, '') <> 'ANULADO'
            ORDER BY npv.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT npi.*,
                   npv.lote_canasto_id,
                   npv.codigo_pedido,
                   npv.vecino_nombre,
                   npv.estado_operativo,
                   COALESCE(nac.sku_nodo, npi.sku_nodo) AS sku_oficial_lamda,
                   COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, npi.nombre_publico) AS nombre_oficial_lamda,
                   COALESCE(nac.kilos_unidad, 0.25)::numeric(10,3) AS kilos_unidad,
                   COALESCE(nac.flujo_lamda, 2)::int AS flujo_lamda,
                   COALESCE(bf.nombre, ba.rubro, nac.familia_bunker_nombre, nac.categoria_familiar, 'Fraccionados') AS categoria_familiar
            FROM public.nodos_pedidos_items npi
            JOIN public.nodos_pedidos_vecinos npv ON npv.id = npi.pedido_id
            LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
            LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, npi.sku_nodo))
            LEFT JOIN public.bunker_familias bf ON bf.id = COALESCE(ba.familia_id, nac.familia_bunker_id)
            WHERE ($1 = 0 OR npv.nodo_id = $1)
              AND COALESCE(npv.estado_operativo, '') <> 'ANULADO'
            ORDER BY npi.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT nmc.*,
                   nm.nombre_marca,
                   nm.gestor_nombre,
                   nle.codigo_canasto
            FROM public.nodos_movimientos_cta_cte nmc
            JOIN public.nodos_maestro nm ON nm.id = nmc.nodo_id
            LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = nmc.lote_canasto_id
            WHERE ($1 = 0 OR nmc.nodo_id = $1)
            ORDER BY nmc.id DESC
            LIMIT 25
        `, [nodoIdFiltro]),
        db.query(`
            SELECT *
            FROM public.nodos_pedidos_envios_postales
            WHERE ($1 = 0 OR nodo_id = $1)
            ORDER BY id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT UPPER(articulo_numero) AS sku_upper,
                   COALESCE(stock_consolidado, 0)::numeric(14,2) AS stock_consolidado
            FROM public.stock_real_consolidado
            WHERE articulo_numero IS NOT NULL
        `)
    ]);

    const itemsPorPedido = new Map();
    const itemsPorCanasto = new Map();

    for (const rawIt of itemsRes.rows) {
        const skuOf = rawIt.sku_oficial_lamda || rawIt.sku_nodo || '';
        const nomOf = rawIt.nombre_oficial_lamda || rawIt.nombre_publico;
        const it = {
            ...rawIt,
            sku_nodo: skuOf,
            nombre_oficial_lamda: nomOf,
            etiqueta_oficial_lamda: formatearEtiquetaTecnicaArticulo(skuOf, nomOf),
            nombre_publico: nomOf
        };
        const pid = Number(it.pedido_id);
        if (!itemsPorPedido.has(pid)) itemsPorPedido.set(pid, []);
        itemsPorPedido.get(pid).push(it);

        const cid = Number(it.lote_canasto_id);
        if (cid) {
            if (!itemsPorCanasto.has(cid)) itemsPorCanasto.set(cid, []);
            itemsPorCanasto.get(cid).push(it);
        }
    }

    const pedidosPorCanasto = new Map();
    for (const p of pedidosRes.rows) {
        const cid = Number(p.lote_canasto_id);
        const pedidoEnriquecido = {
            ...p,
            bolsa_lista: ['ARMADO_EN_CANASTO', 'EN_PODER_GESTOR', 'ENTREGADO_VECINO'].includes(p.estado_operativo),
            despachado_gestor: ['EN_PODER_GESTOR', 'ENTREGADO_VECINO'].includes(p.estado_operativo),
            items: itemsPorPedido.get(Number(p.id)) || []
        };
        if (!pedidosPorCanasto.has(cid)) pedidosPorCanasto.set(cid, []);
        pedidosPorCanasto.get(cid).push(pedidoEnriquecido);
    }

    const canastosDetallados = canastosRes.rows.map(c => {
        const cid = Number(c.id);
        const pedidosCanasto = pedidosPorCanasto.get(cid) || [];
        const itemsCanasto = itemsPorCanasto.get(cid) || [];

        // Construir consolidado de mercadería a fraccionar para completar este Canasto
        const mapaConsolidado = new Map();
        for (const it of itemsCanasto) {
            const key = `${it.sku_nodo || it.nombre_publico}`;
            if (!mapaConsolidado.has(key)) {
                mapaConsolidado.set(key, {
                    articulo_catalogo_id: it.articulo_catalogo_id,
                    sku_nodo: it.sku_nodo || 'S/C',
                    nombre_oficial_lamda: it.nombre_oficial_lamda || it.nombre_publico,
                    etiqueta_oficial_lamda: it.etiqueta_oficial_lamda || formatearEtiquetaTecnicaArticulo(it.sku_nodo, it.nombre_oficial_lamda || it.nombre_publico),
                    nombre_publico: it.nombre_publico,
                    presentacion_etiqueta: it.presentacion_etiqueta || '',
                    categoria_familiar: it.categoria_familiar || '',
                    flujo_lamda: Number(it.flujo_lamda || 2),
                    kilos_unidad: Number(it.kilos_unidad || 0.25),
                    bolsas_totales: 0,
                    bolsas_listas: 0,
                    bolsas_pendientes: 0,
                    kilos_totales: 0,
                    vecinos_detalle: []
                });
            }
            const entry = mapaConsolidado.get(key);
            const cant = Number(it.cantidad || 1);
            const estaLista = ['ARMADO_EN_CANASTO', 'EN_PODER_GESTOR', 'ENTREGADO_VECINO'].includes(it.estado_operativo);

            entry.bolsas_totales += cant;
            if (estaLista) {
                entry.bolsas_listas += cant;
            } else {
                entry.bolsas_pendientes += cant;
            }
            entry.kilos_totales = Number((entry.bolsas_totales * entry.kilos_unidad).toFixed(3));
            entry.vecinos_detalle.push({
                codigo_pedido: it.codigo_pedido,
                vecino_nombre: it.vecino_nombre,
                cantidad: cant,
                lista: estaLista
            });
        }

        return {
            ...c,
            total_bolsas: Number(c.total_bolsas || 0),
            bolsas_armadas: Number(c.bolsas_armadas || 0),
            total_kilos_lote: Number(c.total_kilos_lote || 0),
            total_base_lamda: Number(c.total_base_lamda || 0),
            total_venta_vecinos: Number(c.total_venta_vecinos || 0),
            ganancia_estimada_gestor: Number(c.ganancia_estimada_gestor || 0),
            consolidado_mercaderia: Array.from(mapaConsolidado.values()).sort((a, b) => b.bolsas_totales - a.bolsas_totales),
            pedidos_vecinos: pedidosCanasto
        };
    });

    // Resumen global del 4° Depósito Conceptual (ESTACION_NODOS)
    const pedidosCanastosRows = pedidosRes.rows.filter(p => Number(p.lote_canasto_id || 0) > 0);
    const totalPedidos = pedidosCanastosRows.length;
    const bolsasPendientesArmar = pedidosCanastosRows.filter(p => p.estado_operativo === 'CONFIRMADO_VECINO').length;
    const bolsasEnEstacionNodos = pedidosCanastosRows.filter(p => p.estado_operativo === 'ARMADO_EN_CANASTO').length;
    const bolsasEnPoderGestor = pedidosCanastosRows.filter(p => ['EN_PODER_GESTOR', 'ENTREGADO_VECINO'].includes(p.estado_operativo)).length;
    const canastosListosRetiro = canastosDetallados.filter(c => c.estado_canasto === 'LISTO_ESTACION_NODOS').length;

    // =========================================================================
    // COLA FIFO FULFILLMENT PAQUETERÍA 24/7 (Tiendas Online / ecommerce_fulfillment)
    // =========================================================================
    const mapaNodosPorId = new Map(nodosRes.rows.map(n => [Number(n.id), n]));
    const mapaPostalPorPedido = new Map(enviosPostalesRes.rows.map(ep => [Number(ep.pedido_id), ep]));
    const mapaStockPorSku = new Map(stockConsolidadoRes.rows.map(s => [String(s.sku_upper || '').trim().toUpperCase(), Number(s.stock_consolidado || 0)]));

    const pedidosFulfillmentRaw = pedidosRes.rows.filter(p => {
        if (Number(p.lote_canasto_id || 0) > 0) return false;
        const nRow = mapaNodosPorId.get(Number(p.nodo_id));
        const esEc = nRow && normalizarPerfilOperativoNodo(nRow.perfil_operativo) === 'ecommerce_fulfillment';
        const tienePostal = mapaPostalPorPedido.has(Number(p.id)) ||
            ['PAQUETERIA_DOMICILIO', 'PAQUETERIA_SUCURSAL', 'ENCOMIENDA'].includes(String(p.modalidad_entrega || '').toUpperCase());
        return Boolean(esEc || tienePostal);
    });

    // Orden FIFO por fecha de conciliación de pago o creación
    pedidosFulfillmentRaw.sort((a, b) => {
        const ta = new Date(a.fecha_conciliacion_pago || a.created_at || 0).getTime();
        const tb = new Date(b.fecha_conciliacion_pago || b.created_at || 0).getTime();
        if (ta !== tb) return ta - tb;
        return Number(a.id) - Number(b.id);
    });

    const ordenesFulfillment = [];
    const mapaConsolidadoFulfillment = new Map();
    let pendEmpaqueCount = 0;
    let empaquetadasListasCount = 0;
    let despachadasCorreoCount = 0;
    let entregadasFinalCount = 0;
    let aguardandoPagoCount = 0;

    for (const p of pedidosFulfillmentRaw) {
        const pid = Number(p.id);
        const nRow = mapaNodosPorId.get(Number(p.nodo_id)) || {};
        const ep = mapaPostalPorPedido.get(pid) || null;
        const itemsPed = itemsPorPedido.get(pid) || [];

        const pagoConfirmado = pagosBancariosService.esPedidoPagoConfirmadoNodos(p);
        const habilitadoArmado = pagosBancariosService.esPedidoHabilitadoArmadoDepositoNodos(p);

        const estOp = String(p.estado_operativo || '').toUpperCase();
        const yaDespachado = Boolean(p.debito_cta_cte_registrado) ||
            ['DESPACHADO_CORREO', 'EN_TRANSITO_CORREO', 'ENTREGADO', 'ENTREGADO_VECINO'].includes(estOp) ||
            ['DESPACHADO', 'EN_TRANSITO', 'ENTREGADO'].includes(String(ep?.estado_envio || '').toUpperCase());
        const yaEntregado = ['ENTREGADO', 'ENTREGADO_VECINO'].includes(estOp) ||
            String(ep?.estado_envio || '').toUpperCase() === 'ENTREGADO' ||
            Number(p.hito_tracking_actual || 1) >= 6;
        const yaEmpaquetado = yaDespachado || estOp === 'EMPAQUETADO_FULFILLMENT' || Number(p.hito_tracking_actual || 1) >= 3;

        let etapaFulfillment = 'PENDIENTE_EMPAQUE';
        if (!habilitadoArmado) {
            etapaFulfillment = 'AGUARDANDO_PAGO';
            aguardandoPagoCount++;
        } else if (yaEntregado) {
            etapaFulfillment = 'ENTREGADO';
            entregadasFinalCount++;
        } else if (yaDespachado) {
            etapaFulfillment = 'DESPACHADO_CORREO';
            despachadasCorreoCount++;
        } else if (yaEmpaquetado) {
            etapaFulfillment = 'EMPAQUETADO_LISTO';
            empaquetadasListasCount++;
        } else {
            etapaFulfillment = 'PENDIENTE_EMPAQUE';
            pendEmpaqueCount++;
        }

        let pesoEstimadoGramos = 0;
        for (const it of itemsPed) {
            const cant = Number(it.cantidad || 1);
            const kgU = Number(it.kilos_unidad || 0.30);
            pesoEstimadoGramos += Math.round(kgU * 1000 * cant);

            // Alimentar el consolidado de SKUs hacia Carros de Producción para órdenes habilitadas aún no despachadas
            if (habilitadoArmado && !yaDespachado) {
                const skuKey = String(it.sku_nodo || it.nombre_publico).trim().toUpperCase();
                if (!mapaConsolidadoFulfillment.has(skuKey)) {
                    const stockActual = mapaStockPorSku.has(skuKey) ? Number(mapaStockPorSku.get(skuKey)) : 0;
                    mapaConsolidadoFulfillment.set(skuKey, {
                        articulo_catalogo_id: it.articulo_catalogo_id,
                        sku_nodo: it.sku_nodo || 'S/C',
                        nombre_oficial_lamda: it.nombre_oficial_lamda || it.nombre_publico,
                        etiqueta_oficial_lamda: it.etiqueta_oficial_lamda || formatearEtiquetaTecnicaArticulo(it.sku_nodo, it.nombre_oficial_lamda || it.nombre_publico),
                        presentacion_etiqueta: it.presentacion_etiqueta || '',
                        categoria_familiar: it.categoria_familiar || '',
                        flujo_lamda: Number(it.flujo_lamda || 2),
                        kilos_unidad: kgU,
                        unidades_requeridas: 0,
                        unidades_empaquetadas: 0,
                        unidades_pendientes_empaque: 0,
                        kilos_requeridos: 0,
                        stock_consolidado_actual: stockActual,
                        faltante_fraccionar_unidades: 0,
                        faltante_fraccionar_kilos: 0,
                        ordenes_detalle: []
                    });
                }
                const entry = mapaConsolidadoFulfillment.get(skuKey);
                entry.unidades_requeridas += cant;
                if (yaEmpaquetado) entry.unidades_empaquetadas += cant;
                else entry.unidades_pendientes_empaque += cant;
                entry.kilos_requeridos = Number((entry.unidades_requeridas * entry.kilos_unidad).toFixed(3));
                entry.faltante_fraccionar_unidades = Math.max(0, Number((entry.unidades_requeridas - entry.stock_consolidado_actual).toFixed(2)));
                entry.faltante_fraccionar_kilos = Number((entry.faltante_fraccionar_unidades * entry.kilos_unidad).toFixed(3));
                entry.ordenes_detalle.push({
                    codigo_pedido: p.codigo_pedido,
                    nombre_marca: nRow.nombre_marca || '',
                    destinatario: ep?.destinatario_nombre || p.vecino_nombre,
                    cantidad: cant,
                    empaquetado: yaEmpaquetado
                });
            }
        }
        pesoEstimadoGramos = Math.max(250, pesoEstimadoGramos + 180);

        const operadorEfectivo = String(ep?.operador_postal || 'CORREO_ARGENTINO').toUpperCase();
        ordenesFulfillment.push({
            ...p,
            nodo_slug: nRow.slug || '',
            nombre_marca: nRow.nombre_marca || '',
            bajada_marca: nRow.bajada_marca || '',
            color_primario: nRow.color_primario || '#1e293b',
            codigo_bunker_cuenta_activa: nRow.codigo_bunker_cuenta_activa || nRow.codigo_bunker_cliente || '',
            pago_confirmado: pagoConfirmado,
            habilitado_armado: habilitadoArmado,
            es_efectivo_entrega: String(p.medio_pago || '').toUpperCase() === 'EFECTIVO',
            etapa_fulfillment: etapaFulfillment,
            empaquetado_listo: yaEmpaquetado,
            despachado_correo: yaDespachado,
            entregado_final: yaEntregado,
            operador_postal: operadorEfectivo,
            operador_postal_label: formatearOperadorPostalLabel(operadorEfectivo),
            peso_gramos_efectivo: Number(ep?.peso_gramos || 0) > 0 ? Number(ep.peso_gramos) : pesoEstimadoGramos,
            envio_postal: ep ? {
                ...ep,
                operador_label: formatearOperadorPostalLabel(ep.operador_postal || 'CORREO_ARGENTINO'),
                costo_envio_cliente: Number(ep.costo_envio_cliente || p.cargo_envio_barrial || 0),
                costo_flete_lamda: Number(ep.costo_flete_lamda ?? p.costo_flete_lamda ?? 0)
            } : {
                operador_postal: operadorEfectivo,
                operador_label: formatearOperadorPostalLabel(operadorEfectivo),
                modalidad_postal: p.modalidad_entrega === 'PAQUETERIA_SUCURSAL' ? 'SUCURSAL' : 'DOMICILIO',
                destinatario_nombre: p.vecino_nombre,
                destinatario_dni: '',
                cp_destino: '',
                provincia_nombre: '',
                localidad_nombre: '',
                calle: p.direccion_entrega || '',
                altura: '',
                piso_depto: '',
                sucursal_nombre: '',
                costo_envio_cliente: Number(p.cargo_envio_barrial || 0),
                costo_flete_lamda: Number(p.costo_flete_lamda || 0),
                numero_tracking: null,
                url_tracking_carrier: null,
                estado_envio: 'PENDIENTE_DESPACHO'
            },
            items: itemsPed
        });
    }

    const nodosEcommerce = nodosRes.rows.filter(n => normalizarPerfilOperativoNodo(n.perfil_operativo) === 'ecommerce_fulfillment');
    const pedidosVecinalesAguardandoPago = pedidosRes.rows
        .filter(p => {
            if (Number(p.lote_canasto_id || 0) > 0) return false;
            const nRow = mapaNodosPorId.get(Number(p.nodo_id));
            const esEc = nRow && normalizarPerfilOperativoNodo(nRow.perfil_operativo) === 'ecommerce_fulfillment';
            const tienePostal = mapaPostalPorPedido.has(Number(p.id)) ||
                ['PAQUETERIA_DOMICILIO', 'PAQUETERIA_SUCURSAL', 'ENCOMIENDA', 'ENVIO_POSTAL'].includes(String(p.modalidad_entrega || '').toUpperCase());
            if (esEc || tienePostal) return false;
            return !pagosBancariosService.esPedidoHabilitadoArmadoDepositoNodos(p);
        })
        .map(p => {
            const nRow = mapaNodosPorId.get(Number(p.nodo_id)) || {};
            return {
                id: Number(p.id),
                codigo_pedido: p.codigo_pedido,
                nodo_id: Number(p.nodo_id),
                nombre_marca: nRow.nombre_marca || '',
                vecino_nombre: p.vecino_nombre,
                fecha_entrega_label: p.fecha_entrega_label || '',
                estado_pago: p.estado_pago || 'PENDIENTE_TRANSFERENCIA',
                total_vecino: Number(p.total_vecino || 0),
                monto_declarado_cliente: Number(p.monto_declarado_cliente || 0),
                monto_acreditado_banco: Number(p.monto_acreditado_banco || 0),
                items: itemsPorPedido.get(Number(p.id)) || []
            };
        });

    return {
        resumen_deposito: {
            ubicacion_virtual: 'ESTACION_NODOS',
            total_pedidos: totalPedidos,
            bolsas_pendientes_armar: bolsasPendientesArmar,
            bolsas_en_estacion_nodos: bolsasEnEstacionNodos,
            bolsas_en_poder_gestor: bolsasEnPoderGestor,
            vecinales_aguardando_pago: pedidosVecinalesAguardandoPago.length,
            canastos_totales: canastosDetallados.length,
            canastos_listos_retiro: canastosListosRetiro,
            fulfillment_cola_activa: pendEmpaqueCount + empaquetadasListasCount,
            fulfillment_pendientes_empaque: pendEmpaqueCount,
            fulfillment_empaquetadas_listas: empaquetadasListasCount,
            fulfillment_despachadas_correo: despachadasCorreoCount
        },
        nodos: nodosRes.rows,
        canastos: canastosDetallados,
        pedidos_vecinales_aguardando_pago: pedidosVecinalesAguardandoPago,
        fulfillment_paqueteria: {
            conectores: paqueteriaService.obtenerEstadoConectoresPaqueteria(),
            tiendas_online: nodosEcommerce,
            resumen: {
                cola_activa_total: pendEmpaqueCount + empaquetadasListasCount,
                pendientes_empaque: pendEmpaqueCount,
                empaquetadas_listas_despacho: empaquetadasListasCount,
                despachadas_correo: despachadasCorreoCount,
                entregadas_final: entregadasFinalCount,
                aguardando_conciliacion_pago: aguardandoPagoCount,
                total_ordenes: ordenesFulfillment.length
            },
            consolidado_mercaderia: Array.from(mapaConsolidadoFulfillment.values()).sort((a, b) => b.unidades_requeridas - a.unidades_requeridas),
            ordenes: ordenesFulfillment
        },
        movimientos_cta_cte: movsRes.rows
    };
}

/**
 * Marca (o desmarca) como preparado el pedido individual de un vecino,
 * lo aloja en el Canasto dentro de ESTACION_NODOS y devuelve su par gemelo de etiquetas Zebra.
 */
async function armarBolsaPedidoVecino(pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const desmarcar = Boolean(payload.desmarcar);
    const operario = String(payload.operario || 'Equipo Depósito').trim();

    const pedRes = await db.query(
        'SELECT * FROM public.nodos_pedidos_vecinos WHERE id = $1 LIMIT 1',
        [Number(pedidoId)]
    );
    if (pedRes.rows.length === 0) {
        throw new Error('Pedido vecinal no encontrado.');
    }
    const ped = pedRes.rows[0];

    if (['EN_PODER_GESTOR', 'EN_CAMINO_VECINO', 'ENTREGADO_VECINO'].includes(String(ped.estado_operativo || '').toUpperCase())) {
        throw new Error('Este pedido ya fue retirado por el Gestor del Nodo.');
    }

    if (!desmarcar && !pagosBancariosService.esPedidoHabilitadoArmadoDepositoNodos(ped)) {
        throw new Error(`Bloqueo operativo: el pedido #${ped.codigo_pedido} aún no cuenta con pago acreditado en Banco Galicia.`);
    }

    const nuevoEstado = desmarcar ? 'CONFIRMADO_VECINO' : 'ARMADO_EN_CANASTO';
    const nuevaUbicacion = desmarcar ? 'PENDIENTE_TALLER' : 'ESTACION_NODOS';

    if (desmarcar) {
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_operativo = 'CONFIRMADO_VECINO',
                 hito_tracking_actual = 1,
                 ubicacion_deposito = 'PENDIENTE_TALLER',
                 fecha_armado_bolsa = NULL,
                 operario_armado = NULL,
                 updated_at = NOW()
             WHERE id = $1::int`,
            [Number(pedidoId)]
        );
        await db.query(
            'DELETE FROM public.nodos_pedidos_eventos_tracking WHERE pedido_id = $1 AND hito_numero >= 3',
            [Number(pedidoId)]
        );
    } else {
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET ubicacion_deposito = 'ESTACION_NODOS',
                 etiqueta_impresa = true,
                 fecha_armado_bolsa = COALESCE(fecha_armado_bolsa, NOW()),
                 operario_armado = $1::varchar,
                 updated_at = NOW()
             WHERE id = $2::int`,
            [operario, Number(pedidoId)]
        );
        await registrarTransicionHitoPedidoVecino(db, Number(pedidoId), 3, {
            origen: 'MESA_ARMADO_DEPOSITO',
            actor: operario,
            detalle: `Bolsa controlada y alojada en Canasto por ${operario}`
        });
    }

    await sincronizarCanastosEstacionNodos();

    const etiqueta = !desmarcar ? await generarEtiquetaDePedidoExistente(pedidoId) : null;
    await sincronizarCanastosEstacionNodos();
    const tablero = await obtenerTableroMesaArmadoDeposito();
    const canastoActualizado = tablero.canastos.find(c => Number(c.id) === Number(ped.lote_canasto_id)) || null;

    return {
        pedido_id: Number(pedidoId),
        codigo_pedido: ped.codigo_pedido,
        vecino_nombre: ped.vecino_nombre,
        estado_operativo: nuevoEstado,
        ubicacion_deposito: nuevaUbicacion,
        etiqueta,
        canasto: canastoActualizado,
        tablero
    };
}

/**
 * Marca todas las bolsas pendientes de un Canasto como armadas en ESTACION_NODOS
 * y devuelve la etiqueta con el QR Maestro del Canasto lista para retiro.
 */
async function armarTodasBolsasDeCanasto(canastoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const operario = String(payload.operario || 'Equipo Depósito').trim();

    const pedsPendArmar = await db.query(
        `SELECT id FROM public.nodos_pedidos_vecinos
         WHERE lote_canasto_id = $1
           AND COALESCE(estado_operativo, '') <> 'ANULADO'
           AND COALESCE(hito_tracking_actual, 1) < 3`,
        [Number(canastoId)]
    );

    await db.query(
        `UPDATE public.nodos_pedidos_vecinos
         SET ubicacion_deposito = 'ESTACION_NODOS',
             etiqueta_impresa = true,
             fecha_armado_bolsa = COALESCE(fecha_armado_bolsa, NOW()),
             operario_armado = COALESCE(operario_armado, $1),
             updated_at = NOW()
         WHERE lote_canasto_id = $2
           AND COALESCE(estado_operativo, '') <> 'ANULADO'
           AND COALESCE(hito_tracking_actual, 1) < 3`,
        [operario, Number(canastoId)]
    );

    for (const r of pedsPendArmar.rows) {
        await registrarTransicionHitoPedidoVecino(db, r.id, 3, {
            origen: 'MESA_ARMADO_LOTE',
            actor: operario,
            detalle: `Bolsa controlada en cierre de Canasto por ${operario}`
        });
    }

    await sincronizarCanastosEstacionNodos();
    const etiquetaCanasto = await generarEtiquetaQrMaestroCanasto(canastoId);
    await sincronizarCanastosEstacionNodos();
    const tablero = await obtenerTableroMesaArmadoDeposito();

    return {
        etiqueta_canasto: etiquetaCanasto,
        tablero
    };
}

/**
 * Genera el preview y el código ZPL de la Etiqueta Maestra del Canasto (con QR Maestro)
 */
async function generarEtiquetaQrMaestroCanasto(canastoId) {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const canRes = await db.query(
        `SELECT nle.*,
                nm.nombre_marca, nm.bajada_marca, nm.subtitulo_marca, nm.gestor_nombre,
                nm.logo_zpl_gfa, nm.logo_mono_preview_base64, nm.logo_zpl_config
         FROM public.nodos_lotes_estacion nle
         JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
         WHERE nle.id = $1 LIMIT 1`,
        [Number(canastoId)]
    );
    if (canRes.rows.length === 0) {
        throw new Error('Canasto no encontrado en ESTACION_NODOS.');
    }
    const canasto = canRes.rows[0];

    const pedidosRes = await db.query(
        `SELECT id, codigo_pedido, vecino_nombre, total_vecino, medio_pago, estado_pago, estado_operativo
         FROM public.nodos_pedidos_vecinos
         WHERE lote_canasto_id = $1
           AND COALESCE(estado_operativo, '') <> 'ANULADO'
         ORDER BY id ASC`,
        [canasto.id]
    );

    return generarPreviewVisualCanastoQrMaestro({
        nombre_marca: canasto.nombre_marca,
        bajada_marca: canasto.bajada_marca,
        codigo_canasto: canasto.codigo_canasto,
        qr_maestro_payload: canasto.qr_maestro_payload,
        gestor_nombre: canasto.gestor_nombre,
        fecha_entrega_label: canasto.fecha_entrega_label,
        total_bolsas: canasto.total_bolsas,
        bolsas_armadas: canasto.bolsas_armadas,
        total_base_lamda: canasto.total_base_lamda,
        estado_canasto: canasto.estado_canasto,
        logo_zpl_gfa: canasto.logo_zpl_gfa,
        logo_mono_preview_base64: canasto.logo_mono_preview_base64,
        logo_zpl_config: canasto.logo_zpl_config,
        pedidos: pedidosRes.rows
    });
}

/**
 * Confirma el retiro del Canasto completo por parte del Gestor del Nodo (escaneo de QR Maestro),
 * pasa todos los pedidos activos del lote a "En reparto / En poder del Gestor" (EN_PODER_GESTOR) y
 * registra automáticamente el Débito (+monto) por el Costo Base LAMDA del lote en la Cuenta Corriente del Nodo.
 */
async function confirmarRetiroCanastoPorGestor(canastoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const canRes = await client.query(
            `SELECT nle.*,
                    nm.nombre_marca, nm.gestor_nombre, nm.codigo_bunker_cliente,
                    nm.cliente_madre_bunker_id, nm.codigo_bunker_cliente_madre,
                    COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada
             FROM public.nodos_lotes_estacion nle
             JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
             WHERE nle.id = $1
             FOR UPDATE`,
            [Number(canastoId)]
        );
        if (canRes.rows.length === 0) {
            throw new Error('Canasto no encontrado.');
        }
        const canasto = canRes.rows[0];

        if (canasto.estado_canasto === 'ENTREGADO_AL_GESTOR' && canasto.debito_cta_cte_registrado) {
            throw new Error(`El Canasto ${canasto.codigo_canasto} ya fue entregado al gestor y su débito ya se registró en Cuenta Corriente.`);
        }

        // Si se envió código QR escaneado, verificar coincidencia con código de canasto o payload QR
        if (payload.qr_escaneado) {
            const qrLimpio = String(payload.qr_escaneado || '').trim().toUpperCase();
            if (
                qrLimpio !== String(canasto.qr_maestro_payload).toUpperCase() &&
                qrLimpio !== String(canasto.codigo_canasto).toUpperCase() &&
                !qrLimpio.includes(String(canasto.codigo_canasto).toUpperCase())
            ) {
                throw new Error(`El código QR escaneado (${qrLimpio}) no coincide con el Canasto seleccionado (${canasto.codigo_canasto}).`);
            }
        }

        const retiradoPor = String(payload.retirado_por || canasto.gestor_nombre || 'Gestor del Nodo').trim();
        const origenRetiro = String(payload.origen_evento || 'DESPACHO_LOTE_NODO').trim();

        const pedsActivosCanRes = await client.query(
            `SELECT id FROM public.nodos_pedidos_vecinos
             WHERE lote_canasto_id = $1
               AND COALESCE(estado_operativo, '') <> 'ANULADO'
             ORDER BY id ASC`,
            [canasto.id]
        );

        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET ubicacion_deposito = 'DESPACHADO_NODO',
                 etiqueta_impresa = true,
                 fecha_armado_bolsa = COALESCE(fecha_armado_bolsa, NOW()),
                 fecha_entrega_gestor = COALESCE(fecha_entrega_gestor, NOW()),
                 updated_at = NOW()
             WHERE lote_canasto_id = $1
               AND COALESCE(estado_operativo, '') <> 'ANULADO'`,
            [canasto.id]
        );

        for (const pRow of pedsActivosCanRes.rows) {
            await registrarTransicionHitoPedidoVecino(client, pRow.id, 4, {
                origen: origenRetiro,
                actor: retiradoPor,
                detalle: `Lote ${canasto.codigo_canasto} recibido en ${canasto.nombre_marca} (${retiradoPor})`
            });
        }

        const costoBaseCanasto = Number(canasto.total_base_lamda || 0);
        const retencionFiscalCanasto = Number(canasto.total_retencion_fiscal_margen || 0);
        const montoDebitoLamda = Number((costoBaseCanasto + retencionFiscalCanasto).toFixed(2));
        let saldoResultante = 0;
        let movCcFacturaId = null;

        // Impactar en Cuenta Corriente operativa del Nodo (Cuenta Madre Unificada si aplica, caso contrario subcuenta CB-NODO-xxx)
        // Convención única LAMDA: DEBITO suma +monto (Costo Base LAMDA + Retención Fiscal IVA/IIBB sobre margen)
        const destCc = await resolverCuentaContableOperativaNodo(client, canasto);
        if (destCc.ccId) {
            const detFiscalTxt = retencionFiscalCanasto > 0
                ? `: Base $${costoBaseCanasto.toLocaleString('es-AR')} + Ret. IVA/IIBB s/Margen $${retencionFiscalCanasto.toLocaleString('es-AR')}`
                : '';
            const descBase = `Retiro Canasto ${canasto.codigo_canasto} (${canasto.total_bolsas} pedidos vecinales - ${canasto.fecha_entrega_label})${detFiscalTxt}`;
            const descMovimiento = destCc.usaCuentaMadreUnificada
                ? agregarReferenciaNodoADescripcion(descBase, canasto.nombre_marca)
                : descBase;
            const insMovCc = await client.query(
                `INSERT INTO public.factura_cuenta_corriente_movimientos (
                    cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                    tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                    creado_en, metadatos
                 ) VALUES ($1, 'DEBITO', $2, 0, 'CANASTO_NODO', NULL, $3, NOW(), NOW(), $4)
                 RETURNING id`,
                [
                    destCc.ccId,
                    montoDebitoLamda,
                    descMovimiento,
                    JSON.stringify({
                        canasto_id: canasto.id,
                        codigo_canasto: canasto.codigo_canasto,
                        nodo_id: canasto.nodo_id,
                        nodo_marca: canasto.nombre_marca || null,
                        usa_cuenta_madre_unificada: destCc.usaCuentaMadreUnificada,
                        codigo_bunker_cuenta_impactada: destCc.codigoBunkerDestino,
                        total_bolsas: canasto.total_bolsas,
                        costo_base_lamda: costoBaseCanasto,
                        retencion_fiscal_margen: retencionFiscalCanasto,
                        monto_debito_lamda: montoDebitoLamda,
                        total_venta_vecinos: Number(canasto.total_venta_vecinos || 0),
                        ganancia_estimada_gestor: Number(canasto.ganancia_estimada_gestor || 0)
                    })
                ]
            );
            movCcFacturaId = insMovCc.rows[0].id;
            saldoResultante = await recalcularSaldosCuentaMadreBunker(client, destCc.ccId);
        }

        // Registrar también en el libro mayor específico de Nodos (signo = +1 por DEBITO)
        const conceptoNodo = retencionFiscalCanasto > 0
            ? `Débito por retiro de Canasto ${canasto.codigo_canasto} (${canasto.total_bolsas} bolsas · Base $${costoBaseCanasto.toLocaleString('es-AR')} + Ret. IVA/IIBB $${retencionFiscalCanasto.toLocaleString('es-AR')})`
            : `Débito por retiro de Canasto ${canasto.codigo_canasto} (${canasto.total_bolsas} bolsas · ${canasto.fecha_entrega_label})`;
        await client.query(
            `INSERT INTO public.nodos_movimientos_cta_cte (
                nodo_id, lote_canasto_id, tipo_movimiento, signo, monto,
                saldo_resultante, concepto, referencia_externa
             ) VALUES ($1, $2, 'DEBITO_RETIRO_LOTE', 1, $3, $4, $5, $6)`,
            [
                canasto.nodo_id,
                canasto.id,
                montoDebitoLamda,
                saldoResultante,
                conceptoNodo,
                canasto.codigo_canasto
            ]
        );

        await client.query(
            `UPDATE public.nodos_lotes_estacion
             SET estado_canasto = 'ENTREGADO_AL_GESTOR',
                 ubicacion_deposito = 'DESPACHADO_NODO',
                 bolsas_armadas = total_bolsas,
                 debito_cta_cte_registrado = true,
                 movimiento_cc_id = $1,
                 retirado_por_gestor = $2,
                 fecha_retiro_gestor = NOW(),
                 updated_at = NOW()
             WHERE id = $3`,
            [movCcFacturaId, retiradoPor, canasto.id]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    await sincronizarCanastosEstacionNodos();
    const tablero = await obtenerTableroMesaArmadoDeposito();
    const canastoActualizado = tablero.canastos.find(c => Number(c.id) === Number(canastoId)) || null;

    return {
        canasto: canastoActualizado,
        tablero
    };
}

/**
 * Herramienta de Laboratorio: Permite reabrir un Canasto entregado y revertir su débito
 * de prueba para volver a ensayar el circuito de armado y escaneo de QR Maestro.
 */
async function reabrirCanastoParaPruebaLaboratorio(canastoId) {
    await asegurarEsquemaNodosBarriales();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const canRes = await client.query(
            `SELECT nle.*, nm.codigo_bunker_cliente, nm.cliente_madre_bunker_id, nm.codigo_bunker_cliente_madre,
                    nm.nombre_marca, COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada
             FROM public.nodos_lotes_estacion nle
             JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
             WHERE nle.id = $1
             FOR UPDATE`,
            [Number(canastoId)]
        );
        if (canRes.rows.length === 0) {
            throw new Error('Canasto no encontrado.');
        }
        const canasto = canRes.rows[0];

        if (canasto.debito_cta_cte_registrado) {
            const ccsARecalcular = new Set();
            if (canasto.movimiento_cc_id) {
                const delMov = await client.query(
                    'DELETE FROM public.factura_cuenta_corriente_movimientos WHERE id = $1 RETURNING cuenta_corriente_id',
                    [canasto.movimiento_cc_id]
                );
                if (delMov.rows[0]?.cuenta_corriente_id) {
                    ccsARecalcular.add(Number(delMov.rows[0].cuenta_corriente_id));
                }
            }
            const destCc = await resolverCuentaContableOperativaNodo(client, canasto);
            if (destCc.ccId) {
                ccsARecalcular.add(Number(destCc.ccId));
            }
            if (canasto.codigo_bunker_cliente) {
                const ccRes = await client.query(
                    'SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = $1 LIMIT 1',
                    [canasto.codigo_bunker_cliente]
                );
                if (ccRes.rows[0]?.id) {
                    ccsARecalcular.add(Number(ccRes.rows[0].id));
                }
            }
            for (const ccIdRecalc of ccsARecalcular) {
                await recalcularSaldosCuentaMadreBunker(client, ccIdRecalc);
            }
            await client.query(
                `DELETE FROM public.nodos_movimientos_cta_cte
                 WHERE lote_canasto_id = $1 AND tipo_movimiento = 'DEBITO_RETIRO_LOTE'`,
                [canasto.id]
            );
        }

        await client.query(
            `DELETE FROM public.nodos_pedidos_eventos_tracking
             WHERE pedido_id IN (
                 SELECT id FROM public.nodos_pedidos_vecinos WHERE lote_canasto_id = $1
             ) AND hito_numero >= 4`,
            [canasto.id]
        );

        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_operativo = 'ARMADO_EN_CANASTO',
                 hito_tracking_actual = 3,
                 ubicacion_deposito = 'ESTACION_NODOS',
                 fecha_entrega_gestor = NULL,
                 fecha_en_camino_vecino = NULL,
                 fecha_entregado_vecino = NULL,
                 updated_at = NOW()
             WHERE lote_canasto_id = $1
               AND COALESCE(estado_operativo, '') <> 'ANULADO'`,
            [canasto.id]
        );

        await client.query(
            `UPDATE public.nodos_lotes_estacion
             SET estado_canasto = 'LISTO_ESTACION_NODOS',
                 ubicacion_deposito = 'ESTACION_NODOS',
                 debito_cta_cte_registrado = false,
                 movimiento_cc_id = NULL,
                 retirado_por_gestor = NULL,
                 fecha_retiro_gestor = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [canasto.id]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    await sincronizarCanastosEstacionNodos();
    return obtenerTableroMesaArmadoDeposito();
}

// ============================================================================
// ETAPA 4: CONCILIACIÓN DE COBROS (TRANSFERENCIAS Y EFECTIVO) Y LIQUIDACIÓN
// ============================================================================

function normalizarTitularBancario(str = '') {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Calcula la radiografía contable y el cuadro de compensación automática de un Canasto/Lote:
 * - Total vendido a vecinos activos (excluyendo pedidos ANULADOS)
 * - Menos Costo Base LAMDA del lote -> Ganancia Neta del Gestor
 * - Compensación entre lo cobrado por Transferencia en banco de LAMDA vs. lo cobrado en Efectivo en mano del Gestor
 */
function calcularCuadroLiquidacionCanasto(canasto, pedidos = []) {
    let totalVentaVecinos = 0;
    let totalSubtotalProductos = 0;
    let totalEnviosBarrialesGestor = 0;
    let totalBaseLamda = 0;
    let totalRetencionIvaMargen = 0;
    let totalRetencionIibbMargen = 0;
    let totalRetencionFiscalMargen = 0;
    let gananciaNetaGestor = 0;

    const ivaCanastoPct = normalizarAlicuotaFiscalNodo(canasto?.alicuota_iva_margen_pct, 21);
    const iibbCanastoPct = normalizarAlicuotaFiscalNodo(canasto?.alicuota_iibb_margen_pct, 4);

    let transferenciasEsperadas = 0;
    let transferenciasConciliadasLamda = 0;
    let cantTransferenciasTotales = 0;
    let cantTransferenciasConciliadas = 0;

    let efectivoEsperado = 0;
    let efectivoCobradoManoGestor = 0;
    let cantEfectivoTotales = 0;
    let cantEfectivoCobrados = 0;
    let pedidosAnulados = 0;

    const pedidosActivos = [];
    for (const p of pedidos) {
        if (String(p.estado_operativo || '').toUpperCase() === 'ANULADO') {
            pedidosAnulados++;
            continue;
        }
        pedidosActivos.push(p);

        const totVec = Number(p.total_vecino || 0);
        const subProd = Number(p.subtotal_productos_vecino || totVec);
        const envBarrial = Number(p.cargo_envio_barrial || 0);
        const totBase = Number(p.total_base_lamda || 0);
        const retFiscalPed = Number(p.retencion_fiscal_margen || 0);
        const retIvaPed = Number(p.retencion_iva_margen || 0);
        const retIibbPed = Number(p.retencion_iibb_margen || 0);
        const ganGestor = Number(p.ganancia_total_gestor ?? Math.max(0, totVec - totBase - retFiscalPed));

        totalVentaVecinos += totVec;
        totalSubtotalProductos += subProd;
        totalEnviosBarrialesGestor += envBarrial;
        totalBaseLamda += totBase;
        totalRetencionIvaMargen += retIvaPed;
        totalRetencionIibbMargen += retIibbPed;
        totalRetencionFiscalMargen += retFiscalPed;
        gananciaNetaGestor += ganGestor;

        const esEfectivo = String(p.medio_pago || '').toUpperCase() === 'EFECTIVO';
        const pagoConfirmado = Boolean(p.impactado_cta_cte_pago) ||
            ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(p.estado_pago || '').toUpperCase());

        if (esEfectivo) {
            cantEfectivoTotales++;
            efectivoEsperado += totVec;
            if (pagoConfirmado) {
                cantEfectivoCobrados++;
                efectivoCobradoManoGestor += totVec;
            }
        } else {
            cantTransferenciasTotales++;
            transferenciasEsperadas += totVec;
            if (pagoConfirmado) {
                cantTransferenciasConciliadas++;
                transferenciasConciliadasLamda += totVec;
            } else if (Number(p.monto_acreditado_banco || 0) > 0) {
                transferenciasConciliadasLamda += Math.min(totVec, Number(p.monto_acreditado_banco || 0));
            }
        }
    }

    const totalPedidos = pedidosActivos.length;
    const pedidosPagosConfirmados = cantTransferenciasConciliadas + cantEfectivoCobrados;
    const todosPagosConfirmados = totalPedidos > 0 && pedidosPagosConfirmados === totalPedidos;

    // Para el cálculo del cuadro de compensación se usan los montos reales del lote
    const transfEnLamda = todosPagosConfirmados ? transferenciasConciliadasLamda : transferenciasEsperadas;
    const efectivoEnGestor = todosPagosConfirmados ? efectivoCobradoManoGestor : efectivoEsperado;

    // A LAMDA le corresponde cubrir `totalBaseLamda + totalRetencionFiscalMargen` (IVA + IIBB sobre el margen).
    // Diferencia algebraica exacta: `transfEnLamda - totalACubrirLamda === gananciaNetaGestor - efectivoEnGestor`.
    const totalACubrirLamda = Number((totalBaseLamda + totalRetencionFiscalMargen).toFixed(2));
    const diferenciaCompensacion = Number((transfEnLamda - totalACubrirLamda).toFixed(2));

    let direccionCompensacion = 'SALDADO_EXACTO';
    let montoCompensacionFinal = 0;
    let tituloResultado = 'Cuenta Compensada en $0';
    const labelObligacionLamda = totalRetencionFiscalMargen > 0
        ? `$${totalACubrirLamda.toLocaleString('es-AR')} (Costo Base $${totalBaseLamda.toLocaleString('es-AR')} + Ret. IVA/IIBB s/Margen $${totalRetencionFiscalMargen.toLocaleString('es-AR')})`
        : `$${totalBaseLamda.toLocaleString('es-AR')}`;
    let explicacionCompensacion = `Las transferencias recibidas en LAMDA coinciden exactamente con el total a cubrir (${labelObligacionLamda}).`;

    if (diferenciaCompensacion < -0.01) {
        direccionCompensacion = 'GESTOR_RINDE_A_LAMDA';
        montoCompensacionFinal = Math.abs(diferenciaCompensacion);
        tituloResultado = `El Gestor rinde a LAMDA: $${montoCompensacionFinal.toLocaleString('es-AR')}`;
        explicacionCompensacion = `El Gestor cobró $${efectivoEnGestor.toLocaleString('es-AR')} en efectivo en mano: retiene directamente el 100% de su Ganancia Limpia ($${gananciaNetaGestor.toLocaleString('es-AR')}) y rinde a LAMDA los $${montoCompensacionFinal.toLocaleString('es-AR')} restantes para completar ${labelObligacionLamda} menos $${transfEnLamda.toLocaleString('es-AR')} ya acreditados por transferencia.`;
    } else if (diferenciaCompensacion > 0.01) {
        direccionCompensacion = 'LAMDA_TRANSFIERE_A_GESTOR';
        montoCompensacionFinal = diferenciaCompensacion;
        tituloResultado = `LAMDA transfiere al Gestor: $${montoCompensacionFinal.toLocaleString('es-AR')}`;
        explicacionCompensacion = `Las transferencias cobradas en el banco de LAMDA ($${transfEnLamda.toLocaleString('es-AR')}) cubrieron ${labelObligacionLamda} y generaron una Utilidad Neta Liquidable a favor del Gestor de $${montoCompensacionFinal.toLocaleString('es-AR')}.`;
    }

    return {
        total_pedidos: totalPedidos,
        pedidos_anulados: pedidosAnulados,
        pedidos_pagos_confirmados: pedidosPagosConfirmados,
        todos_pagos_confirmados: todosPagosConfirmados,
        total_venta_vecinos: Number(totalVentaVecinos.toFixed(2)),
        total_subtotal_productos: Number(totalSubtotalProductos.toFixed(2)),
        total_envios_barriales_gestor: Number(totalEnviosBarrialesGestor.toFixed(2)),
        total_base_lamda: Number(totalBaseLamda.toFixed(2)),
        alicuota_iva_margen_pct: ivaCanastoPct,
        alicuota_iibb_margen_pct: iibbCanastoPct,
        total_retencion_iva_margen: Number(totalRetencionIvaMargen.toFixed(2)),
        total_retencion_iibb_margen: Number(totalRetencionIibbMargen.toFixed(2)),
        total_retencion_fiscal_margen: Number(totalRetencionFiscalMargen.toFixed(2)),
        total_a_cubrir_lamda: totalACubrirLamda,
        ganancia_neta_gestor: Number(gananciaNetaGestor.toFixed(2)),
        transferencias_esperadas: Number(transferenciasEsperadas.toFixed(2)),
        transferencias_conciliadas_lamda: Number(transferenciasConciliadasLamda.toFixed(2)),
        cant_transferencias_totales: cantTransferenciasTotales,
        cant_transferencias_conciliadas: cantTransferenciasConciliadas,
        efectivo_esperado: Number(efectivoEsperado.toFixed(2)),
        efectivo_cobrado_mano_gestor: Number(efectivoCobradoManoGestor.toFixed(2)),
        cant_efectivo_totales: cantEfectivoTotales,
        cant_efectivo_cobrados: cantEfectivoCobrados,
        direccion_compensacion: direccionCompensacion,
        monto_compensacion_final: Number(montoCompensacionFinal.toFixed(2)),
        titulo_resultado: tituloResultado,
        explicacion_compensacion: explicacionCompensacion
    };
}

/**
 * Obtiene el tablero integral de la Etapa 4: Conciliación de Transferencias,
 * Rendición de Efectivo en mano del Gestor y Liquidación de Cuenta Corriente por Lote.
 */
async function obtenerTableroLiquidacionCobros(filtros = {}) {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const nodoIdFiltro = filtros.nodo_id ? Number(filtros.nodo_id) : 0;

    const [nodosRes, canastosRes, pedidosRes, itemsRes, aliasRes, liqRes, movsRes, vecinosRes] = await Promise.all([
        db.query(`
            SELECT nm.id, nm.codigo_nodo, nm.slug, nm.nombre_marca, nm.bajada_marca, nm.subtitulo_marca,
                   nm.gestor_nombre, nm.gestor_telefono, nm.barrio_zona, nm.direccion_retiro,
                   nm.alias_bancario_display, nm.cbu_display, nm.titular_display,
                   nm.color_primario, nm.codigo_bunker_cliente, nm.bunker_cliente_id,
                   nm.perfil_operativo, nm.modulos_activos, nm.config_paqueteria,
                   COALESCE(nm.alicuota_iva_margen_pct, 21.00)::numeric(5,2) AS alicuota_iva_margen_pct,
                   COALESCE(nm.alicuota_iibb_margen_pct, 4.00)::numeric(5,2) AS alicuota_iibb_margen_pct,
                   nm.cliente_madre_bunker_id, nm.codigo_bunker_cliente_madre,
                   COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada,
                   CASE WHEN COALESCE(nm.usar_cuenta_madre_unificada, false) AND nm.codigo_bunker_cliente_madre IS NOT NULL
                        THEN nm.codigo_bunker_cliente_madre
                        ELSE nm.codigo_bunker_cliente
                   END AS codigo_bunker_cuenta_activa,
                   bc_madre.cliente_nombre AS cliente_madre_nombre,
                   bc_madre.razon_social AS cliente_madre_razon_social,
                   bc_madre.lomas_soft_id AS cliente_madre_lomas_id,
                   COALESCE(cc_madre.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente_madre,
                   nm.lista_precio_bunker_id,
                   COALESCE(lp.nombre, 'Lista Base Nodos Barriales') AS lista_precio_nombre,
                   (9000 + nm.id) AS cliente_id_logistica,
                   COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente
            FROM public.nodos_maestro nm
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
            LEFT JOIN public.bunker_clientes bc_madre ON bc_madre.id = nm.cliente_madre_bunker_id
            LEFT JOIN public.factura_cuentas_corrientes cc_madre
              ON cc_madre.codigo_bunker_cliente = nm.codigo_bunker_cliente_madre
             AND cc_madre.nombre_cuenta = 'Cuenta Principal'
            LEFT JOIN public.bunker_listas_precios lp ON lp.id = nm.lista_precio_bunker_id
            WHERE nm.activo = true
              AND ($1::int = 0 OR nm.id = $1::int)
            ORDER BY nm.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT nle.*,
                   nm.codigo_nodo,
                   nm.slug AS nodo_slug,
                   nm.nombre_marca,
                   nm.gestor_nombre,
                   nm.gestor_telefono,
                   nm.alias_bancario_display,
                   nm.cbu_display,
                   nm.titular_display,
                   nm.codigo_bunker_cliente,
                   COALESCE(nm.alicuota_iva_margen_pct, 21.00)::numeric(5,2) AS alicuota_iva_margen_pct,
                   COALESCE(nm.alicuota_iibb_margen_pct, 4.00)::numeric(5,2) AS alicuota_iibb_margen_pct,
                   nm.cliente_madre_bunker_id,
                   nm.codigo_bunker_cliente_madre,
                   COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada,
                   CASE WHEN COALESCE(nm.usar_cuenta_madre_unificada, false) AND nm.codigo_bunker_cliente_madre IS NOT NULL
                        THEN nm.codigo_bunker_cliente_madre
                        ELSE nm.codigo_bunker_cliente
                   END AS codigo_bunker_cuenta_activa,
                   bc_madre.cliente_nombre AS cliente_madre_nombre,
                   bc_madre.razon_social AS cliente_madre_razon_social,
                   COALESCE(cc_madre.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente_madre,
                   COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente
            FROM public.nodos_lotes_estacion nle
            JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
            LEFT JOIN public.bunker_clientes bc_madre ON bc_madre.id = nm.cliente_madre_bunker_id
            LEFT JOIN public.factura_cuentas_corrientes cc_madre
              ON cc_madre.codigo_bunker_cliente = nm.codigo_bunker_cliente_madre
             AND cc_madre.nombre_cuenta = 'Cuenta Principal'
            WHERE ($1::int = 0 OR nle.nodo_id = $1::int)
            ORDER BY
                CASE WHEN nle.estado_canasto = 'ENTREGADO_AL_GESTOR' AND COALESCE(nle.liquidacion_cerrada, false) = false THEN 0
                     WHEN COALESCE(nle.liquidacion_cerrada, false) = false THEN 1
                     ELSE 2
                END,
                nle.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT npv.*,
                   npep.operador_postal AS postal_operador,
                   npep.modalidad_postal AS postal_modalidad,
                   npep.cp_destino AS postal_cp,
                   npep.localidad_nombre AS postal_localidad,
                   npep.provincia_nombre AS postal_provincia,
                   npep.numero_tracking AS postal_numero_tracking,
                   npep.url_tracking_carrier AS postal_url_tracking,
                   npep.estado_envio AS postal_estado_envio,
                   npep.costo_envio_cliente AS postal_costo_envio_cliente,
                   npep.costo_flete_lamda AS postal_costo_flete_lamda,
                   npep.fecha_despacho AS postal_fecha_despacho
            FROM public.nodos_pedidos_vecinos npv
            LEFT JOIN public.nodos_pedidos_envios_postales npep ON npep.pedido_id = npv.id
            WHERE ($1::int = 0 OR npv.nodo_id = $1::int)
            ORDER BY npv.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT npi.*,
                   COALESCE(nac.sku_nodo, npi.sku_nodo) AS sku_oficial_lamda,
                   COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, npi.nombre_publico) AS nombre_oficial_lamda
            FROM public.nodos_pedidos_items npi
            JOIN public.nodos_pedidos_vecinos npv ON npv.id = npi.pedido_id
            LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
            LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, npi.sku_nodo))
            WHERE ($1::int = 0 OR npv.nodo_id = $1::int)
            ORDER BY npi.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT *
            FROM public.nodos_alias_vecinos_aprendidos
            WHERE ($1::int = 0 OR nodo_id = $1::int)
            ORDER BY updated_at DESC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT *
            FROM public.nodos_liquidaciones_lote
            WHERE ($1::int = 0 OR nodo_id = $1::int)
            ORDER BY id DESC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT nmc.*,
                   nm.nombre_marca,
                   nm.gestor_nombre,
                   nle.codigo_canasto
            FROM public.nodos_movimientos_cta_cte nmc
            JOIN public.nodos_maestro nm ON nm.id = nmc.nodo_id
            LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = nmc.lote_canasto_id
            WHERE ($1::int = 0 OR nmc.nodo_id = $1::int)
            ORDER BY nmc.id DESC
            LIMIT 40
        `, [nodoIdFiltro]),
        db.query(`
            SELECT nv.*,
                   nm.codigo_nodo,
                   nm.slug AS nodo_slug,
                   nm.nombre_marca,
                   nm.gestor_nombre,
                   nm.color_primario
            FROM public.nodos_vecinos nv
            JOIN public.nodos_maestro nm ON nm.id = nv.nodo_id
            WHERE ($1::int = 0 OR nv.nodo_id = $1::int)
            ORDER BY nv.nodo_id ASC, nv.nombre_completo ASC, nv.id ASC
        `, [nodoIdFiltro])
    ]);

    const itemsPorPedido = new Map();
    for (const rawIt of itemsRes.rows) {
        const pid = Number(rawIt.pedido_id);
        if (!itemsPorPedido.has(pid)) itemsPorPedido.set(pid, []);
        const skuOf = rawIt.sku_oficial_lamda || rawIt.sku_nodo || '';
        const nomOf = rawIt.nombre_oficial_lamda || rawIt.nombre_publico;
        itemsPorPedido.get(pid).push({
            ...rawIt,
            sku_nodo: skuOf,
            nombre_oficial_lamda: nomOf,
            etiqueta_oficial_lamda: formatearEtiquetaTecnicaArticulo(skuOf, nomOf),
            nombre_publico: nomOf
        });
    }

    const [mapaPagosLiquidacion, conciliadorGalicia] = await Promise.all([
        pedidosRes.rows.length > 0
            ? pagosBancariosService.obtenerResumenPagosPorPedidosIds(pedidosRes.rows.map(r => Number(r.id)))
            : Promise.resolve(new Map()),
        pagosBancariosService.obtenerTableroConciliadorGaliciaNodos({ nodo_id: nodoIdFiltro }).catch(() => null)
    ]);

    const mapaNodosLiq = new Map(nodosRes.rows.map(n => [Number(n.id), n]));
    const pedidosPorCanasto = new Map();
    const pedidosVecinalesPreCanastoPorNodo = new Map();
    const pedidosPorVecinoId = new Map();

    for (const p of pedidosRes.rows) {
        const cid = Number(p.lote_canasto_id || 0);
        const esAnulado = String(p.estado_operativo || '').toUpperCase() === 'ANULADO';
        const resPago = pagosBancariosService.enriquecerPedidoConResumenPago(p, mapaPagosLiquidacion.get(Number(p.id)));
        const pagoConfirmado = !esAnulado && resPago.pago_confirmado;

        const titularSugerido = p.titular_transferencia || normalizarTitularBancario(p.vecino_nombre);
        const enriched = {
            ...p,
            ...resPago,
            anulado: esAnulado,
            pago_confirmado: pagoConfirmado,
            titular_sugerido: titularSugerido,
            items: itemsPorPedido.get(Number(p.id)) || []
        };

        const nRow = mapaNodosLiq.get(Number(p.nodo_id));
        const esEc = (nRow && normalizarPerfilOperativoNodo(nRow.perfil_operativo) === 'ecommerce_fulfillment') ||
            Boolean(p.postal_operador) ||
            ['PAQUETERIA_DOMICILIO', 'PAQUETERIA_SUCURSAL', 'ENCOMIENDA', 'ENVIO_POSTAL'].includes(String(p.modalidad_entrega || '').toUpperCase());

        if (cid === 0 && !esEc) {
            const nid = Number(p.nodo_id);
            if (!pedidosVecinalesPreCanastoPorNodo.has(nid)) pedidosVecinalesPreCanastoPorNodo.set(nid, []);
            pedidosVecinalesPreCanastoPorNodo.get(nid).push(enriched);
        } else {
            if (!pedidosPorCanasto.has(cid)) pedidosPorCanasto.set(cid, []);
            pedidosPorCanasto.get(cid).push(enriched);
        }

        if (p.vecino_id) {
            const vid = Number(p.vecino_id);
            if (!pedidosPorVecinoId.has(vid)) pedidosPorVecinoId.set(vid, []);
            pedidosPorVecinoId.get(vid).push(enriched);
        }
    }

    const aliasPorVecinoId = new Map();
    for (const al of aliasRes.rows) {
        if (al.vecino_id) {
            const vid = Number(al.vecino_id);
            if (!aliasPorVecinoId.has(vid)) aliasPorVecinoId.set(vid, []);
            aliasPorVecinoId.get(vid).push(al);
        }
    }

    const vecinosPadron = vecinosRes.rows.map(v => {
        const pedidosHistorial = (pedidosPorVecinoId.get(Number(v.id)) || [])
            .slice()
            .sort((a, b) => Number(b.id) - Number(a.id));

        const aliasList = aliasPorVecinoId.get(Number(v.id)) || [];
        let totalComprado = 0;
        let totalPagado = 0;
        let totalPendiente = 0;
        let pedidosActivosCount = 0;
        for (const ph of pedidosHistorial) {
            if (ph.anulado) continue;
            pedidosActivosCount++;
            const monto = Number(ph.total_vecino || 0);
            totalComprado += monto;
            if (ph.pago_confirmado) totalPagado += monto;
            else totalPendiente += monto;
        }
        const ultimoPedido = pedidosHistorial.find(x => !x.anulado) || pedidosHistorial[0] || null;
        return {
            ...v,
            codigo_vecino: v.codigo_vecino || formatearCodigoVecinoNodo(v.nodo_id, v.id),
            saldo_actual: Number(Number(v.saldo_actual || 0).toFixed(2)),
            titulares_aprendidos: aliasList,
            titular_habitual_efectivo: v.titular_transferencia_habitual || (aliasList[0] ? aliasList[0].titular_normalizado : ''),
            cantidad_pedidos: pedidosActivosCount,
            cantidad_pedidos_totales: pedidosHistorial.length,
            total_comprado: Number(totalComprado.toFixed(2)),
            total_pagado: Number(totalPagado.toFixed(2)),
            total_pendiente_pago: Number(totalPendiente.toFixed(2)),
            ultimo_pedido_codigo: ultimoPedido ? ultimoPedido.codigo_pedido : null,
            ultima_fecha_entrega: ultimoPedido ? ultimoPedido.fecha_entrega_label : null,
            pedidos_historial: pedidosHistorial
        };
    });

    const liqPorCanasto = new Map(
        liqRes.rows
            .filter(l => Number(l.lote_canasto_id || 0) > 0)
            .map(l => [Number(l.lote_canasto_id), l])
    );

    const lotes = canastosRes.rows.map(c => {
        const cid = Number(c.id);
        const pedidosLote = (pedidosPorCanasto.get(cid) || []).slice();
        // Si este lote sigue abierto, adjuntar pedidos vecinales de esa misma ventana pendientes de acreditación bancaria
        if (!c.debito_cta_cte_registrado && !c.liquidacion_cerrada && String(c.estado_canasto || '') !== 'ENTREGADO_AL_GESTOR') {
            const pendVec = pedidosVecinalesPreCanastoPorNodo.get(Number(c.nodo_id)) || [];
            const restantes = [];
            for (const pv of pendVec) {
                if (pv.fecha_entrega_label === c.fecha_entrega_label) {
                    pedidosLote.push(pv);
                } else {
                    restantes.push(pv);
                }
            }
            pedidosVecinalesPreCanastoPorNodo.set(Number(c.nodo_id), restantes);
        }
        const cuadro = calcularCuadroLiquidacionCanasto(c, pedidosLote);
        return {
            ...c,
            cuadro_liquidacion: cuadro,
            pedidos_vecinos: pedidosLote,
            liquidacion_oficial: liqPorCanasto.get(cid) || null
        };
    });

    // Si un nodo vecinal tiene pedidos pendientes de conciliación bancaria cuya ventana aún no creó fila física en nodos_lotes_estacion,
    // exponer una bandeja virtual previa en `lotes` para que Administración los vea y concilie sin ingresar aún a Depósito.
    for (const [nid, pedsPre] of pedidosVecinalesPreCanastoPorNodo.entries()) {
        if (!pedsPre || pedsPre.length === 0) continue;
        const nRow = mapaNodosLiq.get(nid);
        if (!nRow) continue;
        const porVentana = new Map();
        for (const pv of pedsPre) {
            const lbl = pv.fecha_entrega_label || 'Próxima Ronda';
            if (!porVentana.has(lbl)) porVentana.set(lbl, []);
            porVentana.get(lbl).push(pv);
        }
        let subIdx = 1;
        for (const [lbl, listaPv] of porVentana.entries()) {
            const virtualCanasto = {
                id: -(nid * 100 + subIdx++),
                es_bandeja_previa_banco: true,
                codigo_canasto: `PEND-BANCO-N${String(nid).padStart(2, '0')}`,
                nodo_id: nid,
                codigo_nodo: nRow.codigo_nodo,
                nodo_slug: nRow.slug,
                nombre_marca: nRow.nombre_marca,
                gestor_nombre: nRow.gestor_nombre,
                gestor_telefono: nRow.gestor_telefono,
                alias_bancario_display: nRow.alias_bancario_display,
                cbu_display: nRow.cbu_display,
                titular_display: nRow.titular_display,
                codigo_bunker_cliente: nRow.codigo_bunker_cliente,
                codigo_bunker_cuenta_activa: nRow.codigo_bunker_cuenta_activa,
                usar_cuenta_madre_unificada: nRow.usar_cuenta_madre_unificada,
                alicuota_iva_margen_pct: nRow.alicuota_iva_margen_pct,
                alicuota_iibb_margen_pct: nRow.alicuota_iibb_margen_pct,
                fecha_entrega_label: lbl,
                ventana_horaria_label: listaPv[0]?.ventana_horaria_label || '',
                estado_canasto: 'AGUARDANDO_CONCILIACION_BANCO',
                debito_cta_cte_registrado: false,
                liquidacion_cerrada: false,
                total_bolsas: 0,
                bolsas_armadas: 0
            };
            lotes.unshift({
                ...virtualCanasto,
                cuadro_liquidacion: calcularCuadroLiquidacionCanasto(virtualCanasto, listaPv),
                pedidos_vecinos: listaPv,
                liquidacion_oficial: null
            });
        }
    }

    // Construir tablero de Liquidación Continua 24/7 para Tiendas Online (ecommerce_fulfillment / lote_canasto_id IS NULL)
    const pedidosSinCanasto = pedidosPorCanasto.get(0) || [];
    const pedidosFulfillmentPorNodo = new Map();
    for (const p of pedidosSinCanasto) {
        const nid = Number(p.nodo_id);
        if (!pedidosFulfillmentPorNodo.has(nid)) pedidosFulfillmentPorNodo.set(nid, []);
        pedidosFulfillmentPorNodo.get(nid).push(p);
    }

    const cortesPorNodo = new Map();
    const cortesFulfillment = [];
    for (const l of liqRes.rows) {
        if (String(l.tipo_liquidacion || '').toUpperCase() === 'CORTE_FULFILLMENT' || !l.lote_canasto_id) {
            cortesFulfillment.push(l);
            const nid = Number(l.nodo_id);
            if (!cortesPorNodo.has(nid)) cortesPorNodo.set(nid, []);
            cortesPorNodo.get(nid).push(l);
        }
    }

    const tiendasFulfillment = nodosRes.rows
        .filter(n => normalizarPerfilOperativoNodo(n.perfil_operativo) === 'ecommerce_fulfillment' || (pedidosFulfillmentPorNodo.get(Number(n.id)) || []).length > 0)
        .map(n => {
            const nid = Number(n.id);
            const pedsTienda = (pedidosFulfillmentPorNodo.get(nid) || []).slice().sort((a, b) => Number(b.id) - Number(a.id));
            const pedsActivos = pedsTienda.filter(x => !x.anulado);
            const pedsPendientesPago = pedsActivos.filter(x => !x.pago_confirmado);
            const pedsPendientesDespacho = pedsActivos.filter(x => x.pago_confirmado && !x.debito_cta_cte_registrado);
            const pedsElegiblesCorte = pedsActivos.filter(x => x.pago_confirmado && Boolean(x.debito_cta_cte_registrado) && !x.liquidacion_id);

            let subtotalProductosCorte = 0;
            let envioCobradoClientesCorte = 0;
            let totalIngresosBrutosCorte = 0;
            let totalCostoBaseLamdaCorte = 0;
            let totalRetencionIvaCorte = 0;
            let totalRetencionIibbCorte = 0;
            let totalRetencionFiscalCorte = 0;
            let totalCostoFleteLamdaCorte = 0;
            let utilidadNetaCreadorCorte = 0;

            const ivaTiendaPct = normalizarAlicuotaFiscalNodo(n.alicuota_iva_margen_pct, 21);
            const iibbTiendaPct = normalizarAlicuotaFiscalNodo(n.alicuota_iibb_margen_pct, 4);

            for (const po of pedsElegiblesCorte) {
                const subP = Number(po.subtotal_productos_vecino || 0);
                const envCli = Number(po.cargo_envio_barrial ?? po.postal_costo_envio_cliente ?? 0);
                const ingBruto = Number(po.total_vecino || (subP + envCli - Number(po.monto_ajuste_credito || 0)));
                const baseLamda = Number(po.total_base_lamda || 0);
                const retFiscal = Number(po.retencion_fiscal_margen || 0);
                const retIva = Number(po.retencion_iva_margen || 0);
                const retIibb = Number(po.retencion_iibb_margen || 0);
                const fleteLamda = Number(po.costo_flete_lamda ?? po.postal_costo_flete_lamda ?? 0);
                const utilOrden = Number((ingBruto - baseLamda - retFiscal - fleteLamda).toFixed(2));

                subtotalProductosCorte += subP;
                envioCobradoClientesCorte += envCli;
                totalIngresosBrutosCorte += ingBruto;
                totalCostoBaseLamdaCorte += baseLamda;
                totalRetencionIvaCorte += retIva;
                totalRetencionIibbCorte += retIibb;
                totalRetencionFiscalCorte += retFiscal;
                totalCostoFleteLamdaCorte += fleteLamda;
                utilidadNetaCreadorCorte += utilOrden;
            }

            return {
                ...n,
                perfil_operativo: normalizarPerfilOperativoNodo(n.perfil_operativo),
                pedidos_fulfillment: pedsTienda,
                resumen_operativo: {
                    ordenes_activas: pedsActivos.length,
                    pendientes_conciliar_pago: pedsPendientesPago.length,
                    en_cola_despacho_deposito: pedsPendientesDespacho.length,
                    despachadas_pendientes_corte: pedsElegiblesCorte.length
                },
                cuadro_corte_pendiente: {
                    cantidad_ordenes: pedsElegiblesCorte.length,
                    subtotal_productos: Number(subtotalProductosCorte.toFixed(2)),
                    envio_cobrado_clientes: Number(envioCobradoClientesCorte.toFixed(2)),
                    total_ingresos_brutos: Number(totalIngresosBrutosCorte.toFixed(2)),
                    costo_base_lamda: Number(totalCostoBaseLamdaCorte.toFixed(2)),
                    alicuota_iva_margen_pct: ivaTiendaPct,
                    alicuota_iibb_margen_pct: iibbTiendaPct,
                    retencion_iva_margen: Number(totalRetencionIvaCorte.toFixed(2)),
                    retencion_iibb_margen: Number(totalRetencionIibbCorte.toFixed(2)),
                    retencion_fiscal_margen: Number(totalRetencionFiscalCorte.toFixed(2)),
                    costo_flete_lamda: Number(totalCostoFleteLamdaCorte.toFixed(2)),
                    utilidad_neta_creador: Number(utilidadNetaCreadorCorte.toFixed(2))
                },
                cortes_cerrados: cortesPorNodo.get(nid) || []
            };
        });

    return {
        nodos: nodosRes.rows,
        lotes,
        tiendas_fulfillment: tiendasFulfillment,
        cortes_fulfillment: cortesFulfillment,
        conciliador_galicia: conciliadorGalicia,
        vecinos_padron: vecinosPadron,
        alias_aprendidos: aliasRes.rows,
        movimientos_cta_cte: movsRes.rows,
        telefono_whatsapp_pruebas: '5492216615746',
        telefono_whatsapp_pruebas_display: '221 661 5746'
    };
}

function _obtenerHelpersContablesParaPagosBancarios() {
    return {
        resolverCuentaContableOperativaNodo,
        recalcularSaldosCuentaMadreBunker,
        recalcularSaldoSubcuentaVecino,
        registrarTransicionHitoPedidoVecino,
        calcularProximaVentanaEntrega: (configVentanas, fechaRef) => {
            const resProx = calcularProximaEntregaNodo(configVentanas, fechaRef);
            const asig = resProx?.asignada || {};
            return {
                fecha_entrega_label: asig.label_completo || '',
                ventana_horaria_label: asig.ventana_retiro || '',
                fecha_entrega_iso: asig.fecha_entrega_iso || null
            };
        },
        sincronizarCanastosEstacionNodos,
        sincronizarNodosConCircuitoOperativoLamda
    };
}

/**
 * Concilia el pago de un pedido vecinal (ley contable unificada LAMDA):
 * - Si es TRANSFERENCIA: Acredita (-total_vecino, CREDITO) a favor del Nodo en su Cuenta Corriente CB-NODO-xxx
 *   (ya que el dinero ingresó en la cuenta recaudadora de LAMDA), acredita en la Subcuenta del Vecino (-total_vecino)
 *   y memoriza el titular bancario del vecino.
 * - Si es EFECTIVO: Registra el cobro en efectivo en mano del Gestor, salda la Subcuenta del Vecino (-total_vecino)
 *   y computa el efectivo retenido en mano del Gestor para la compensación final del lote (sin tocar CB-NODO-xxx).
 */
async function conciliarPagoPedidoVecino(pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const forzarEfectivo = String(payload.medio_pago || '').toUpperCase() === 'EFECTIVO';
    if (!forzarEfectivo) {
        const chkMedio = await db.query('SELECT medio_pago FROM public.nodos_pedidos_vecinos WHERE id = $1 LIMIT 1', [Number(pedidoId)]);
        const esPedEfectivo = String(chkMedio.rows[0]?.medio_pago || '').toUpperCase() === 'EFECTIVO';
        if (!esPedEfectivo) {
            await pagosBancariosService.conciliarCreditosBancariosNodos(
                {
                    pedido_id: Number(pedidoId),
                    movimiento_bancario_id: payload.movimiento_bancario_id || null,
                    aviso_pago_id: payload.aviso_pago_id || null,
                    monto_aplicado: payload.monto_aplicado,
                    titular_transferencia: payload.titular_transferencia,
                    comprobante_referencia: payload.comprobante_referencia,
                    responsable: payload.responsable || 'Administración LAMDA'
                },
                _obtenerHelpersContablesParaPagosBancarios()
            );
            return obtenerTableroLiquidacionCobros();
        }
    }

    const client = await db.connect();
    let despachoReciboEfectivoId = null;
    try {
        await client.query('BEGIN');

        const pedRes = await client.query(
            `SELECT npv.*,
                    nm.nombre_marca, nm.gestor_nombre, nm.codigo_bunker_cliente, nm.alias_bancario_display,
                    nm.perfil_operativo, nm.modulos_activos,
                    nm.cliente_madre_bunker_id, nm.codigo_bunker_cliente_madre,
                    COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada,
                    nle.codigo_canasto,
                    npep.id AS envio_postal_id
             FROM public.nodos_pedidos_vecinos npv
             JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
             LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
             LEFT JOIN public.nodos_pedidos_envios_postales npep ON npep.pedido_id = npv.id
             WHERE npv.id = $1::int
             FOR UPDATE OF npv`,
            [Number(pedidoId)]
        );
        if (pedRes.rows.length === 0) {
            throw new Error('Pedido vecinal no encontrado.');
        }
        const ped = pedRes.rows[0];

        if (String(ped.estado_operativo || '').toUpperCase() === 'ANULADO') {
            throw new Error(`El pedido #${ped.codigo_pedido} se encuentra ANULADO y no admite conciliación de cobro.`);
        }

        if (ped.impactado_cta_cte_pago) {
            await client.query('COMMIT');
            return obtenerTableroLiquidacionCobros();
        }

        const montoTotalVecino = Number(ped.total_vecino || 0);
        const esEfectivo = forzarEfectivo || String(ped.medio_pago || '').toUpperCase() === 'EFECTIVO';

        let saldoResultante = 0;
        let movCcFacturaId = null;

        const destCc = await resolverCuentaContableOperativaNodo(client, ped);
        const ccRes = destCc.ccId
            ? { rows: [{ id: destCc.ccId, saldo: destCc.saldo }] }
            : { rows: [] };

        const saldoActual = ccRes.rows.length > 0 ? Number(ccRes.rows[0].saldo || 0) : 0;

        if (!esEfectivo) {
            // 1. TRANSFERENCIA BANCARIA RECIBIDA EN CUENTA DE LAMDA -> CREDITO (-montoTotalVecino) A FAVOR DEL NODO
            const titularInput = payload.titular_transferencia || ped.titular_transferencia || normalizarTitularBancario(ped.vecino_nombre);
            const titularNorm = normalizarTitularBancario(titularInput);
            const referencia = String(payload.comprobante_referencia || `TRF-${ped.codigo_pedido}`).trim();
            const billetera = String(payload.billetera_origen || 'Mercado Pago / Transferencia').trim();

            if (ccRes.rows.length > 0) {
                const ccId = ccRes.rows[0].id;
                const descBaseCc = `Transferencia Vecino #${ped.codigo_pedido} (${ped.vecino_nombre} · Titular: ${titularNorm}) acreditada en cuenta LAMDA`;
                const descCc = destCc.usaCuentaMadreUnificada
                    ? agregarReferenciaNodoADescripcion(descBaseCc, ped.nombre_marca)
                    : descBaseCc;
                const insMov = await client.query(
                    `INSERT INTO public.factura_cuenta_corriente_movimientos (
                        cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                        tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                        creado_en, metadatos
                     ) VALUES ($1, 'CREDITO', $2, 0, 'TRANSFERENCIA_VECINO_NODO', NULL, $3, NOW(), NOW(), $4)
                     RETURNING id`,
                    [
                        ccId,
                        montoTotalVecino,
                        descCc,
                        JSON.stringify({
                            pedido_id: ped.id,
                            codigo_pedido: ped.codigo_pedido,
                            nodo_id: ped.nodo_id,
                            nodo_marca: ped.nombre_marca || null,
                            usa_cuenta_madre_unificada: destCc.usaCuentaMadreUnificada,
                            codigo_bunker_cuenta_impactada: destCc.codigoBunkerDestino,
                            vecino_nombre: ped.vecino_nombre,
                            titular_normalizado: titularNorm,
                            referencia
                        })
                    ]
                );
                movCcFacturaId = insMov.rows[0].id;
                saldoResultante = await recalcularSaldosCuentaMadreBunker(client, ccId);
            } else {
                saldoResultante = Number((saldoActual - montoTotalVecino).toFixed(2));
            }

            // Aprendizaje automático del titular para futuras transferencias del vecino
            const exAliasVec = await client.query(
                `SELECT id FROM public.nodos_alias_vecinos_aprendidos
                 WHERE nodo_id = $1 AND titular_normalizado = $2
                 LIMIT 1 FOR UPDATE`,
                [ped.nodo_id, titularNorm]
            );
            if (exAliasVec.rows.length > 0) {
                await client.query(
                    `UPDATE public.nodos_alias_vecinos_aprendidos SET
                        vecino_id = COALESCE($2, vecino_id),
                        vecino_nombre = $3,
                        billetera_banco_origen = $4,
                        usos_confirmados = usos_confirmados + 1,
                        updated_at = NOW()
                     WHERE id = $1`,
                    [exAliasVec.rows[0].id, ped.vecino_id, ped.vecino_nombre, billetera]
                );
            } else {
                await client.query(
                    `INSERT INTO public.nodos_alias_vecinos_aprendidos (
                        nodo_id, vecino_id, vecino_nombre, titular_normalizado, billetera_banco_origen, usos_confirmados, updated_at
                     ) VALUES ($1, $2, $3, $4, $5, 1, NOW())`,
                    [ped.nodo_id, ped.vecino_id, ped.vecino_nombre, titularNorm, billetera]
                );
            }

            if (ped.vecino_id) {
                await client.query(
                    `UPDATE public.nodos_vecinos
                     SET titular_transferencia_habitual = $1,
                         updated_at = NOW()
                     WHERE id = $2`,
                    [titularNorm, ped.vecino_id]
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
                        montoTotalVecino,
                        `Pago por Transferencia acreditado (${titularNorm}) — Pedido #${ped.codigo_pedido}`,
                        referencia
                    ]
                );
                await recalcularSaldoSubcuentaVecino(client, ped.vecino_id);
            }

            await client.query(
                `INSERT INTO public.nodos_movimientos_cta_cte (
                    nodo_id, lote_canasto_id, pedido_vecino_id, tipo_movimiento, signo,
                    monto, saldo_resultante, concepto, referencia_externa
                 ) VALUES ($1, $2, $3, 'CREDITO_TRANSFERENCIA_VECINO', -1, $4, $5, $6, $7)`,
                [
                    ped.nodo_id,
                    ped.lote_canasto_id,
                    ped.id,
                    montoTotalVecino,
                    saldoResultante,
                    `Transferencia conciliada en Banco LAMDA: #${ped.codigo_pedido} (${ped.vecino_nombre} · Titular: ${titularNorm})`,
                    referencia
                ]
            );

            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET medio_pago = 'TRANSFERENCIA',
                     estado_pago = 'CONCILIADO_BANCO_LAMDA',
                     titular_transferencia = $1,
                     comprobante_referencia = $2,
                     fecha_conciliacion_pago = NOW(),
                     impactado_cta_cte_pago = true,
                     movimiento_pago_cc_id = $3,
                     updated_at = NOW()
                 WHERE id = $4`,
                [titularNorm, referencia, movCcFacturaId, ped.id]
            );
        } else {
            // 2. EFECTIVO COBRADO EN MANO POR EL GESTOR AL ENTREGAR AL VECINO
            const referencia = String(payload.comprobante_referencia || `REC-EFVO-${ped.codigo_pedido}`).trim();
            saldoResultante = saldoActual;

            if (ped.vecino_id) {
                await client.query(
                    `INSERT INTO public.nodos_vecinos_movimientos_cc (
                        nodo_id, vecino_id, pedido_vecino_id, lote_canasto_id,
                        tipo_movimiento, naturaleza, monto, saldo_resultante,
                        medio_pago, concepto, referencia_externa
                     ) VALUES ($1, $2, $3, $4, 'CREDITO_EFECTIVO_GESTOR', 'CREDITO', $5, 0, 'EFECTIVO', $6, $7)`,
                    [
                        ped.nodo_id,
                        ped.vecino_id,
                        ped.id,
                        ped.lote_canasto_id || null,
                        montoTotalVecino,
                        `Pago en Efectivo abonado a ${ped.gestor_nombre} — Pedido #${ped.codigo_pedido}`,
                        referencia
                    ]
                );
                await recalcularSaldoSubcuentaVecino(client, ped.vecino_id);
            }

            await client.query(
                `INSERT INTO public.nodos_movimientos_cta_cte (
                    nodo_id, lote_canasto_id, pedido_vecino_id, tipo_movimiento, signo,
                    monto, saldo_resultante, concepto, referencia_externa
                 ) VALUES ($1, $2, $3, 'COBRO_EFECTIVO_MANO_GESTOR', 0, $4, $5, $6, $7)`,
                [
                    ped.nodo_id,
                    ped.lote_canasto_id,
                    ped.id,
                    montoTotalVecino,
                    saldoResultante,
                    `Cobro en Efectivo en mano del Gestor: #${ped.codigo_pedido} (${ped.vecino_nombre}) — Retenido por ${ped.gestor_nombre} a cuenta de comisión y liquidación`,
                    referencia
                ]
            );

            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET medio_pago = 'EFECTIVO',
                     estado_pago = 'COBRADO_EFECTIVO_GESTOR',
                     estado_operativo = CASE WHEN estado_operativo IN ('EN_PODER_GESTOR', 'EN_CAMINO_VECINO') THEN 'ENTREGADO_VECINO' ELSE estado_operativo END,
                     comprobante_referencia = $1,
                     fecha_conciliacion_pago = NOW(),
                     impactado_cta_cte_pago = true,
                     updated_at = NOW()
                 WHERE id = $2`,
                [referencia, ped.id]
            );
            despachoReciboEfectivoId = Number(ped.id);
        }

        // Si la orden pertenece a E-Commerce Fulfillment / Paquetería (sin canasto semanal),
        // al conciliar su pago pasa de inmediato a Hito 2 (EN_PREPARACION) e ingresa a la cola FIFO 24/7 de Depósito.
        const esOrdenFulfillment = !ped.lote_canasto_id && (
            Boolean(ped.envio_postal_id) ||
            normalizarPerfilOperativoNodo(ped.perfil_operativo) === 'ecommerce_fulfillment' ||
            ['PAQUETERIA_DOMICILIO', 'PAQUETERIA_SUCURSAL', 'ENCOMIENDA'].includes(String(ped.modalidad_entrega || '').toUpperCase())
        );
        if (esOrdenFulfillment && Number(ped.hito_tracking_actual || 1) < 2) {
            await registrarTransicionHitoPedidoVecino(client, ped.id, 2, {
                estadoOverride: 'EN_PREPARACION',
                origen: 'CONCILIACION_PAGO_ONLINE',
                actor: String(payload.responsable || 'Administración LAMDA').trim(),
                detalle: `Pago verificado · Orden #${ped.codigo_pedido} ingresada a cola de preparación y empaque`
            });
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    await sincronizarNodosConCircuitoOperativoLamda();

    let envioWhatsappRecibo = null;
    if (despachoReciboEfectivoId && payload.omitir_whatsapp_automatico !== true) {
        envioWhatsappRecibo = await recibosMarcaBlancaService.despacharReciboMarcaBlancaWhatsApp(
            despachoReciboEfectivoId,
            { origen: payload.origen_disparo || 'COBRO_EFECTIVO_AUTOMATICO' }
        ).catch(err => ({
            attempted: false,
            ok: false,
            error: err?.message || 'Error despachando recibo automático.'
        }));
    }

    const tableroActualizado = await obtenerTableroLiquidacionCobros();
    if (envioWhatsappRecibo && tableroActualizado && typeof tableroActualizado === 'object') {
        tableroActualizado.ultimo_envio_whatsapp_recibo = envioWhatsappRecibo;
    }
    return tableroActualizado;
}

/**
 * Concilia en un solo paso todos los cobros pendientes (transferencias y efectivo) de un Canasto/Lote activo
 */
async function conciliarTodosLosPagosPendientesCanasto(canastoId) {
    await asegurarEsquemaNodosBarriales();

    const peds = await db.query(
        `SELECT id FROM public.nodos_pedidos_vecinos
         WHERE lote_canasto_id = $1::int
           AND COALESCE(impactado_cta_cte_pago, false) = false
           AND COALESCE(estado_operativo, '') <> 'ANULADO'
         ORDER BY id ASC`,
        [Number(canastoId)]
    );

    for (const row of peds.rows) {
        await conciliarPagoPedidoVecino(row.id, {});
    }

    return obtenerTableroLiquidacionCobros();
}

// ============================================================================
// BLOQUE B: MESA DE FULFILLMENT 24/7, GATILLO CONTABLE POSTAL Y CORTES CONTINUOS
// ============================================================================

/**
 * Marca (o desmarca) una orden de E-Commerce Fulfillment como controlada y empaquetada en Depósito Central LAMDA,
 * devolviendo su etiqueta Zebra Marca Blanca + Talón Interno.
 * Regla estricta: exige pago_confirmado === true.
 */
async function marcarEmpaqueFulfillmentPedido(pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const pid = Number(pedidoId || 0);
    if (!pid) throw new Error('ID de pedido inválido.');

    const desmarcar = Boolean(payload.desmarcar);
    const operario = String(payload.operario || 'Mesa Fulfillment LAMDA').trim();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const pedRes = await client.query(
            `SELECT npv.*, nm.nombre_marca, nm.perfil_operativo
             FROM public.nodos_pedidos_vecinos npv
             JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
             WHERE npv.id = $1::int
             FOR UPDATE OF npv`,
            [pid]
        );
        if (pedRes.rows.length === 0) {
            const err = new Error('Pedido no encontrado.');
            err.statusCode = 404;
            throw err;
        }
        const ped = pedRes.rows[0];
        const estOp = String(ped.estado_operativo || '').toUpperCase();

        if (estOp === 'ANULADO') {
            const err = new Error(`El pedido #${ped.codigo_pedido} está ANULADO.`);
            err.statusCode = 400;
            throw err;
        }

        const habilitadoEmpaque = pagosBancariosService.esPedidoHabilitadoArmadoDepositoNodos(ped);
        if (!habilitadoEmpaque) {
            const err = new Error(`Bloqueo operativo: el pedido #${ped.codigo_pedido} aún no tiene su transferencia conciliada en Liquidación y Cobros.`);
            err.statusCode = 400;
            throw err;
        }

        if (ped.debito_cta_cte_registrado) {
            const err = new Error(`El pedido #${ped.codigo_pedido} ya fue despachado por correo.`);
            err.statusCode = 400;
            throw err;
        }

        if (payload.peso_gramos !== undefined && Number(payload.peso_gramos) > 0) {
            await client.query(
                `UPDATE public.nodos_pedidos_envios_postales
                 SET peso_gramos = $1::int,
                     updated_at = NOW()
                 WHERE pedido_id = $2::int`,
                [Math.round(Number(payload.peso_gramos)), pid]
            );
        }

        if (desmarcar) {
            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET estado_operativo = 'EN_PREPARACION',
                     hito_tracking_actual = 2,
                     ubicacion_deposito = 'COLA_FULFILLMENT',
                     secuencia_operativa_lamda = 'Armar_Pedido',
                     updated_at = NOW()
                 WHERE id = $1::int`,
                [pid]
            );
        } else {
            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET ubicacion_deposito = 'MESA_FULFILLMENT',
                     etiqueta_impresa = true,
                     secuencia_operativa_lamda = 'Pedido_Listo',
                     fecha_armado_bolsa = COALESCE(fecha_armado_bolsa, NOW()),
                     updated_at = NOW()
                 WHERE id = $1::int`,
                [pid]
            );
            await registrarTransicionHitoPedidoVecino(client, pid, 3, {
                estadoOverride: 'EMPAQUETADO_FULFILLMENT',
                origen: 'MESA_FULFILLMENT_LAMDA',
                actor: operario,
                detalle: `Productos controlados y empaquetados con sello de ${ped.nombre_marca} (${operario})`
            });
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    await sincronizarNodosConCircuitoOperativoLamda();
    const etiqueta = desmarcar ? null : await generarEtiquetaFulfillmentMarcaBlanca(pid);
    const tablero = await obtenerTableroMesaArmadoDeposito();
    return { etiqueta, tablero };
}

/**
 * Genera el archivo CSV de Preimposición Masiva (Correo Argentino Paq.ar / Andreani / Genérico)
 * para órdenes de E-Commerce Fulfillment con pago confirmado.
 */
async function exportarCsvPreimposicionFulfillment(filtros = {}) {
    await asegurarEsquemaNodosBarriales();

    const nodoId = filtros.nodo_id ? Number(filtros.nodo_id) : 0;
    const operadorFiltro = String(filtros.operador_postal || '').trim().toUpperCase();
    const soloPendientes = filtros.solo_pendientes !== false && String(filtros.solo_pendientes || '1') !== '0';
    const idsExplicitos = Array.isArray(filtros.pedido_ids)
        ? filtros.pedido_ids.map(x => Number(x)).filter(n => Number.isFinite(n) && n > 0)
        : String(filtros.pedido_ids || '')
            .split(',')
            .map(x => Number(String(x).trim()))
            .filter(n => Number.isFinite(n) && n > 0);

    const res = await db.query(
        `SELECT npv.*,
                nm.nombre_marca, nm.perfil_operativo,
                npep.operador_postal, npep.modalidad_postal, npep.sucursal_codigo, npep.sucursal_nombre,
                npep.destinatario_nombre, npep.destinatario_dni, npep.cp_destino,
                npep.provincia_codigo, npep.provincia_nombre, npep.localidad_nombre,
                npep.calle, npep.altura, npep.piso_depto, npep.referencias_domicilio,
                npep.email_contacto, npep.peso_gramos, npep.estado_envio
         FROM public.nodos_pedidos_vecinos npv
         JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
         LEFT JOIN public.nodos_pedidos_envios_postales npep ON npep.pedido_id = npv.id
         WHERE npv.lote_canasto_id IS NULL
           AND COALESCE(npv.estado_operativo, '') <> 'ANULADO'
           AND (
               COALESCE(npv.impactado_cta_cte_pago, false) = true
               OR UPPER(COALESCE(npv.estado_pago, '')) IN ('CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR')
           )
           AND ($1::int = 0 OR npv.nodo_id = $1::int)
         ORDER BY npv.id ASC`,
        [nodoId]
    );

    let filas = res.rows;
    if (idsExplicitos.length > 0) {
        const setIds = new Set(idsExplicitos);
        filas = filas.filter(r => setIds.has(Number(r.id)));
    } else {
        if (soloPendientes) {
            filas = filas.filter(r => !r.debito_cta_cte_registrado);
        }
        if (operadorFiltro && operadorFiltro !== 'TODOS') {
            filas = filas.filter(r => String(r.operador_postal || 'CORREO_ARGENTINO').toUpperCase() === operadorFiltro);
        }
    }

    const ordenesMapeadas = filas.map(r => ({
        codigo_pedido: r.codigo_pedido,
        destinatario_nombre: r.destinatario_nombre || r.vecino_nombre,
        destinatario_dni: r.destinatario_dni || '',
        calle: r.calle || r.direccion_entrega || '',
        altura: r.altura || 'S/N',
        piso_depto: r.piso_depto || '',
        cp_destino: r.cp_destino || '',
        localidad_nombre: r.localidad_nombre || '',
        provincia_nombre: r.provincia_nombre || '',
        telefono: r.vecino_telefono || '',
        email: r.email_contacto || '',
        peso_gramos: Number(r.peso_gramos || 500),
        operador_postal: r.operador_postal || 'CORREO_ARGENTINO',
        modalidad_postal: r.modalidad_postal || 'DOMICILIO',
        sucursal_codigo: r.sucursal_codigo || '',
        sucursal_nombre: r.sucursal_nombre || '',
        valor_declarado: Number(r.subtotal_productos_vecino || r.total_vecino || 0),
        referencias_domicilio: r.referencias_domicilio || ''
    }));

    const operadorCsv = operadorFiltro && operadorFiltro !== 'TODOS' ? operadorFiltro : 'CORREO_ARGENTINO';
    return paqueteriaService.generarCsvPreimposicionMasiva(ordenesMapeadas, operadorCsv);
}

/**
 * Confirma atómicamente el despacho postal de una orden de E-Commerce Fulfillment:
 * 1. Bloquea si pago_confirmado !== true.
 * 2. Idempotencia estricta mediante debito_cta_cte_registrado: si ya fue despachado, nunca duplica asientos ni descuento de stock.
 * 3. Actualiza nodos_pedidos_envios_postales + avanza orden a Hito 4 (DESPACHADO_CORREO) visible al instante en Tienda y Panel Creador.
 * 4. Impacta y cierra presupuesto espejo (Entregado / DESPACHADO_ENCOMIENDA) descontando stock real consolidado.
 * 5. Registra DEBITO = Costo_Base_LAMDA + Costo_Flete_LAMDA en la Cuenta Corriente operativa del Creador/Nodo.
 */
async function confirmarDespachoPostalPedido(pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const pid = Number(pedidoId || 0);
    if (!pid) {
        const err = new Error('ID de pedido inválido.');
        err.statusCode = 400;
        throw err;
    }

    const guiaResuelta = paqueteriaService.resolverGuiaYUrlCarrier({
        operador_postal: payload.operador_postal,
        numero_tracking: payload.numero_tracking,
        url_tracking_custom: payload.url_tracking_carrier || payload.url_tracking_custom
    });

    if (!guiaResuelta.numero_tracking) {
        const err = new Error('Ingresá o escaneá el número de seguimiento / guía postal antes de confirmar el despacho.');
        err.statusCode = 400;
        throw err;
    }

    const despachadoPor = String(payload.despachado_por || 'Mesa Fulfillment LAMDA').trim().slice(0, 120);

    const client = await db.connect();
    let resultadoDespacho = null;
    try {
        await client.query('BEGIN');

        const pedRes = await client.query(
            `SELECT npv.*,
                    nm.nombre_marca, nm.gestor_nombre, nm.codigo_bunker_cliente,
                    nm.perfil_operativo, nm.modulos_activos, nm.config_paqueteria,
                    COALESCE(nm.alicuota_iva_margen_pct, 21.00) AS nodo_alicuota_iva_margen_pct,
                    COALESCE(nm.alicuota_iibb_margen_pct, 4.00) AS nodo_alicuota_iibb_margen_pct,
                    nm.cliente_madre_bunker_id, nm.codigo_bunker_cliente_madre,
                    COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada
             FROM public.nodos_pedidos_vecinos npv
             JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
             WHERE npv.id = $1::int
             FOR UPDATE OF npv`,
            [pid]
        );
        if (pedRes.rows.length === 0) {
            const err = new Error('Pedido de fulfillment no encontrado.');
            err.statusCode = 404;
            throw err;
        }
        const ped = pedRes.rows[0];

        if (String(ped.estado_operativo || '').toUpperCase() === 'ANULADO') {
            const err = new Error(`El pedido #${ped.codigo_pedido} está ANULADO y no puede despacharse.`);
            err.statusCode = 400;
            throw err;
        }

        const habilitadoDespacho = pagosBancariosService.esPedidoHabilitadoArmadoDepositoNodos(ped);
        if (!habilitadoDespacho) {
            const err = new Error(`Bloqueo contable: el pedido #${ped.codigo_pedido} aún no tiene el pago conciliado. Conciliá primero la transferencia en Liquidación y Cobros antes de despachar.`);
            err.statusCode = 400;
            throw err;
        }

        const epRes = await client.query(
            `SELECT * FROM public.nodos_pedidos_envios_postales
             WHERE pedido_id = $1::int
             LIMIT 1
             FOR UPDATE`,
            [pid]
        );
        const epActual = epRes.rows[0] || null;

        // Idempotencia estricta: si el débito contable ya fue registrado, solo permite actualizar tracking sin duplicar asientos ni stock
        if (ped.debito_cta_cte_registrado) {
            if (epActual) {
                await client.query(
                    `UPDATE public.nodos_pedidos_envios_postales
                     SET operador_postal = $1,
                         numero_tracking = $2,
                         url_tracking_carrier = $3,
                         updated_at = NOW()
                     WHERE id = $4::int`,
                    [
                        guiaResuelta.operador_postal,
                        guiaResuelta.numero_tracking,
                        guiaResuelta.url_tracking_carrier,
                        epActual.id
                    ]
                );
            }
            await client.query('COMMIT');
            resultadoDespacho = {
                idempotente_ya_registrado: true,
                pedido_id: pid,
                codigo_pedido: ped.codigo_pedido,
                operador_postal: guiaResuelta.operador_postal,
                numero_tracking: guiaResuelta.numero_tracking,
                url_tracking_carrier: guiaResuelta.url_tracking_carrier,
                costo_flete_lamda: Number(ped.costo_flete_lamda || epActual?.costo_flete_lamda || 0),
                movimiento_cc_id: ped.movimiento_cc_id || null
            };
        } else {
            const costoFleteRaw = payload.costo_flete_lamda !== undefined && payload.costo_flete_lamda !== ''
                ? Number(payload.costo_flete_lamda)
                : Number(epActual?.costo_flete_lamda ?? ped.costo_flete_lamda ?? 0);
            if (!Number.isFinite(costoFleteRaw) || costoFleteRaw < 0) {
                const err = new Error('El costo real de flete LAMDA debe ser un monto numérico mayor o igual a $0.');
                err.statusCode = 400;
                throw err;
            }
            const costoFleteLamda = Number(costoFleteRaw.toFixed(2));
            const costoBaseLamda = Number(Number(ped.total_base_lamda || 0).toFixed(2));
            const ivaOrdPct = normalizarAlicuotaFiscalNodo(ped.alicuota_iva_margen_pct ?? ped.nodo_alicuota_iva_margen_pct, 21);
            const iibbOrdPct = normalizarAlicuotaFiscalNodo(ped.alicuota_iibb_margen_pct ?? ped.nodo_alicuota_iibb_margen_pct, 4);
            const subNetoProdOrd = Math.max(0, Number(ped.subtotal_productos_vecino || 0) - Number(ped.monto_ajuste_credito || 0));
            const tramoFiscalOrd = Number(ped.retencion_fiscal_margen || 0) > 0
                ? {
                    alicuota_iva_pct: ivaOrdPct,
                    alicuota_iibb_pct: iibbOrdPct,
                    iva_excedente: Number(ped.retencion_iva_margen || 0),
                    iibb_excedente: Number(ped.retencion_iibb_margen || 0),
                    retencion_fiscal_total: Number(ped.retencion_fiscal_margen || 0)
                }
                : desglosarRetencionFiscalExcedente(Math.max(0, subNetoProdOrd - costoBaseLamda), ivaOrdPct, iibbOrdPct);
            const retencionFiscalMargen = Number(tramoFiscalOrd.retencion_fiscal_total.toFixed(2));
            const montoDebitoTotal = Number((costoBaseLamda + retencionFiscalMargen + costoFleteLamda).toFixed(2));
            const operadorLabel = formatearOperadorPostalLabel(guiaResuelta.operador_postal);

            // a) Actualizar o insertar registro postal con guía, URL oficial y costo_flete_lamda
            if (epActual) {
                await client.query(
                    `UPDATE public.nodos_pedidos_envios_postales
                     SET operador_postal = $1,
                         numero_tracking = $2,
                         url_tracking_carrier = $3,
                         costo_flete_lamda = $4,
                         estado_envio = 'DESPACHADO',
                         fecha_despacho = COALESCE(fecha_despacho, NOW()),
                         despachado_por = $5,
                         updated_at = NOW()
                     WHERE id = $6::int`,
                    [
                        guiaResuelta.operador_postal,
                        guiaResuelta.numero_tracking,
                        guiaResuelta.url_tracking_carrier,
                        costoFleteLamda,
                        despachadoPor,
                        epActual.id
                    ]
                );
            } else {
                await client.query(
                    `INSERT INTO public.nodos_pedidos_envios_postales (
                        pedido_id, nodo_id, operador_postal, modalidad_postal,
                        destinatario_nombre, cp_destino, provincia_nombre, localidad_nombre,
                        calle, costo_envio_cliente, costo_flete_lamda,
                        numero_tracking, url_tracking_carrier, estado_envio,
                        fecha_despacho, despachado_por
                     ) VALUES ($1,$2,$3,'DOMICILIO',$4,'0000','Argentina',$5,$5,$6,$7,$8,$9,'DESPACHADO',NOW(),$10)`,
                    [
                        pid,
                        ped.nodo_id,
                        guiaResuelta.operador_postal,
                        ped.vecino_nombre,
                        ped.direccion_entrega || 'Envío Postal',
                        Number(ped.cargo_envio_barrial || 0),
                        costoFleteLamda,
                        guiaResuelta.numero_tracking,
                        guiaResuelta.url_tracking_carrier,
                        despachadoPor
                    ]
                );
            }

            // b) Asegurar Hito 3 y avanzar a Hito 4 (DESPACHADO_CORREO)
            if (Number(ped.hito_tracking_actual || 1) < 3) {
                await registrarTransicionHitoPedidoVecino(client, pid, 3, {
                    estadoOverride: 'EMPAQUETADO_FULFILLMENT',
                    origen: 'MESA_FULFILLMENT_LAMDA',
                    actor: despachadoPor,
                    detalle: `Productos controlados y empaquetados con sello de ${ped.nombre_marca}`
                });
            }
            await registrarTransicionHitoPedidoVecino(client, pid, 4, {
                estadoOverride: 'DESPACHADO_CORREO',
                origen: 'DESPACHO_POSTAL_LAMDA',
                actor: despachadoPor,
                detalle: `Despachado por ${operadorLabel} · Seguimiento #${guiaResuelta.numero_tracking}`
            });

            // c) Descontar stock real consolidado de los SKUs despachados (1 sola vez por orden)
            if (!ped.stock_descontado_fulfillment) {
                const itemsStockRes = await client.query(
                    `SELECT COALESCE(nac.sku_nodo, npi.sku_nodo) AS sku_oficial,
                            SUM(npi.cantidad)::numeric(12,2) AS cantidad_total,
                            MAX(COALESCE(nac.kilos_unidad, 0.25))::numeric(10,3) AS kilos_unidad,
                            MAX(ba.codigo_barras) AS codigo_barras
                     FROM public.nodos_pedidos_items npi
                     LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
                     LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, npi.sku_nodo))
                     WHERE npi.pedido_id = $1::int
                     GROUP BY COALESCE(nac.sku_nodo, npi.sku_nodo)`,
                    [pid]
                );

                for (const stIt of itemsStockRes.rows) {
                    const skuArt = String(stIt.sku_oficial || '').trim();
                    const cantEgreso = Number(stIt.cantidad_total || 0);
                    if (!skuArt || cantEgreso <= 0) continue;
                    const kilosEgreso = Number((cantEgreso * Number(stIt.kilos_unidad || 0.25)).toFixed(3));

                    await client.query(
                        `INSERT INTO public.stock_ventas_movimientos (
                            articulo_numero, codigo_barras, kilos, cantidad, fecha, tipo, origen_ingreso, observaciones
                         ) VALUES ($1, $2, $3, $4, NOW(), 'egreso_venta', 'fulfillment_paqueteria', $5)`,
                        [
                            skuArt,
                            stIt.codigo_barras || null,
                            kilosEgreso,
                            cantEgreso,
                            `Despacho Postal ${ped.nombre_marca} #${ped.codigo_pedido} (${operadorLabel} #${guiaResuelta.numero_tracking})`
                        ]
                    );

                    const updStock = await client.query(
                        `UPDATE public.stock_real_consolidado
                         SET stock_movimientos = COALESCE(stock_movimientos, 0) - $1,
                             stock_consolidado = COALESCE(stock_lomasoft, 0) + (COALESCE(stock_movimientos, 0) - $1) + COALESCE(stock_ajustes, 0),
                             ultima_actualizacion = NOW()
                         WHERE UPPER(articulo_numero) = UPPER($2)`,
                        [cantEgreso, skuArt]
                    );
                    if (updStock.rowCount === 0) {
                        await client.query(
                            `INSERT INTO public.stock_real_consolidado (
                                articulo_numero, stock_lomasoft, stock_movimientos, stock_ajustes, stock_consolidado, ultima_actualizacion
                             ) VALUES ($1, 0, $2, 0, $2, NOW())
                             ON CONFLICT DO NOTHING`,
                            [skuArt, -cantEgreso]
                        );
                    }
                }
            }

            // d) Registrar DEBITO automático (Costo Base LAMDA + Retención Fiscal s/Margen + Costo Flete Real LAMDA) en Cuenta Corriente operativa
            let saldoResultante = 0;
            let movCcFacturaId = null;
            const destCc = await resolverCuentaContableOperativaNodo(client, ped);

            if (destCc.ccId && montoDebitoTotal > 0) {
                const txtRetFiscal = retencionFiscalMargen > 0
                    ? ` + Ret. IVA/IIBB s/Margen $${retencionFiscalMargen.toLocaleString('es-AR')}`
                    : '';
                const descBase = `Despacho Fulfillment #${ped.codigo_pedido} (${ped.vecino_nombre} · ${operadorLabel} #${guiaResuelta.numero_tracking}): Mercadería Base $${costoBaseLamda.toLocaleString('es-AR')}${txtRetFiscal} + Flete Postal $${costoFleteLamda.toLocaleString('es-AR')}`;
                const descMovimiento = destCc.usaCuentaMadreUnificada
                    ? agregarReferenciaNodoADescripcion(descBase, ped.nombre_marca)
                    : descBase;

                const insMovCc = await client.query(
                    `INSERT INTO public.factura_cuenta_corriente_movimientos (
                        cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                        tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                        creado_en, metadatos
                     ) VALUES ($1, 'DEBITO', $2, 0, 'DESPACHO_FULFILLMENT_NODO', NULL, $3, NOW(), NOW(), $4)
                     RETURNING id`,
                    [
                        destCc.ccId,
                        montoDebitoTotal,
                        descMovimiento,
                        JSON.stringify({
                            pedido_id: ped.id,
                            codigo_pedido: ped.codigo_pedido,
                            nodo_id: ped.nodo_id,
                            nodo_marca: ped.nombre_marca || null,
                            usa_cuenta_madre_unificada: destCc.usaCuentaMadreUnificada,
                            codigo_bunker_cuenta_impactada: destCc.codigoBunkerDestino,
                            costo_base_lamda: costoBaseLamda,
                            retencion_iva_margen: tramoFiscalOrd.iva_excedente,
                            retencion_iibb_margen: tramoFiscalOrd.iibb_excedente,
                            retencion_fiscal_margen: retencionFiscalMargen,
                            costo_flete_lamda: costoFleteLamda,
                            monto_debito_total: montoDebitoTotal,
                            operador_postal: guiaResuelta.operador_postal,
                            numero_tracking: guiaResuelta.numero_tracking
                        })
                    ]
                );
                movCcFacturaId = insMovCc.rows[0].id;
                saldoResultante = await recalcularSaldosCuentaMadreBunker(client, destCc.ccId);
            } else if (destCc.ccId) {
                saldoResultante = Number(destCc.saldo || 0);
            }

            await client.query(
                `INSERT INTO public.nodos_movimientos_cta_cte (
                    nodo_id, lote_canasto_id, pedido_vecino_id, tipo_movimiento, signo, monto,
                    saldo_resultante, concepto, referencia_externa
                 ) VALUES ($1, NULL, $2, 'DEBITO_DESPACHO_FULFILLMENT', 1, $3, $4, $5, $6)`,
                [
                    ped.nodo_id,
                    ped.id,
                    montoDebitoTotal,
                    saldoResultante,
                    `Débito Despacho Fulfillment #${ped.codigo_pedido} (${operadorLabel} #${guiaResuelta.numero_tracking}): Base LAMDA $${costoBaseLamda.toLocaleString('es-AR')}${retencionFiscalMargen > 0 ? ` + Ret. IVA/IIBB $${retencionFiscalMargen.toLocaleString('es-AR')}` : ''} + Flete $${costoFleteLamda.toLocaleString('es-AR')}`,
                    guiaResuelta.numero_tracking
                ]
            );

            // Recalcular ganancia_total_gestor limpia de la orden contemplando retención fiscal s/margen y costo real de flete LAMDA
            const ingresoBrutoOrden = Number(ped.total_vecino || 0);
            const utilidadNetaOrden = Number((ingresoBrutoOrden - costoBaseLamda - retencionFiscalMargen - costoFleteLamda).toFixed(2));

            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET debito_cta_cte_registrado = true,
                     movimiento_cc_id = $1,
                     costo_flete_lamda = $2,
                     ganancia_total_gestor = $3,
                     alicuota_iva_margen_pct = $5,
                     alicuota_iibb_margen_pct = $6,
                     retencion_iva_margen = $7,
                     retencion_iibb_margen = $8,
                     retencion_fiscal_margen = $9,
                     stock_descontado_fulfillment = true,
                     ubicacion_deposito = 'DESPACHADO_CORREO',
                     secuencia_operativa_lamda = 'Entregado',
                     etiqueta_impresa = true,
                     updated_at = NOW()
                 WHERE id = $4::int`,
                [
                    movCcFacturaId,
                    costoFleteLamda,
                    utilidadNetaOrden,
                    pid,
                    tramoFiscalOrd.alicuota_iva_pct,
                    tramoFiscalOrd.alicuota_iibb_pct,
                    tramoFiscalOrd.iva_excedente,
                    tramoFiscalOrd.iibb_excedente,
                    retencionFiscalMargen
                ]
            );

            await client.query('COMMIT');
            resultadoDespacho = {
                idempotente_ya_registrado: false,
                pedido_id: pid,
                codigo_pedido: ped.codigo_pedido,
                operador_postal: guiaResuelta.operador_postal,
                operador_postal_label: operadorLabel,
                numero_tracking: guiaResuelta.numero_tracking,
                url_tracking_carrier: guiaResuelta.url_tracking_carrier,
                costo_base_lamda: costoBaseLamda,
                retencion_fiscal_margen: retencionFiscalMargen,
                costo_flete_lamda: costoFleteLamda,
                monto_debito_total: montoDebitoTotal,
                utilidad_neta_creador_orden: utilidadNetaOrden,
                movimiento_cc_id: movCcFacturaId,
                saldo_cta_cte_resultante: saldoResultante
            };
        }
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    await sincronizarNodosConCircuitoOperativoLamda();
    const tablero = await obtenerTableroMesaArmadoDeposito();
    return {
        despacho: resultadoDespacho,
        tablero
    };
}

/**
 * Marca como ENTREGADO (Hito 6) un envío postal ya despachado.
 */
async function marcarEntregaFinalPostalPedido(pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    const pid = Number(pedidoId || 0);
    if (!pid) throw new Error('ID de pedido inválido.');

    const actor = String(payload.actor || 'Seguimiento Postal LAMDA').trim().slice(0, 120);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const pedRes = await client.query(
            `SELECT npv.*, nm.nombre_marca
             FROM public.nodos_pedidos_vecinos npv
             JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
             WHERE npv.id = $1::int
             FOR UPDATE OF npv`,
            [pid]
        );
        if (pedRes.rows.length === 0) {
            const err = new Error('Pedido no encontrado.');
            err.statusCode = 404;
            throw err;
        }
        const ped = pedRes.rows[0];
        if (!ped.debito_cta_cte_registrado) {
            const err = new Error(`El pedido #${ped.codigo_pedido} debe despacharse por correo antes de marcar su entrega final.`);
            err.statusCode = 400;
            throw err;
        }

        await client.query(
            `UPDATE public.nodos_pedidos_envios_postales
             SET estado_envio = 'ENTREGADO',
                 fecha_entrega_correo = COALESCE(fecha_entrega_correo, NOW()),
                 updated_at = NOW()
             WHERE pedido_id = $1::int`,
            [pid]
        );

        await registrarTransicionHitoPedidoVecino(client, pid, 6, {
            estadoOverride: 'ENTREGADO',
            origen: 'CONFIRMACION_ENTREGA_POSTAL',
            actor,
            detalle: `Envío postal #${ped.codigo_pedido} entregado en destino`
        });

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    const tablero = await obtenerTableroMesaArmadoDeposito();
    return { ok: true, tablero };
}

/**
 * Genera un Corte de Liquidación Continua (sin frenar la tienda 24/7) agrupando todas las órdenes
 * de E-Commerce Fulfillment de un Nodo que tengan pago_confirmado = true, debito_cta_cte_registrado = true
 * y liquidacion_id IS NULL.
 * Fórmula exacta:
 *   Utilidad_Neta_Creador = (Subtotal_Productos + Envio_Cobrado_Cliente) - Costo_Base_LAMDA - Costo_Flete_LAMDA
 */
async function generarCorteLiquidacionFulfillment(nodoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const nid = Number(nodoId || 0);
    if (!nid) {
        const err = new Error('ID de Tienda/Nodo requerido.');
        err.statusCode = 400;
        throw err;
    }

    const idsFiltro = Array.isArray(payload.pedido_ids)
        ? payload.pedido_ids.map(x => Number(x)).filter(n => Number.isFinite(n) && n > 0)
        : [];

    const client = await db.connect();
    let corteCreado = null;
    try {
        await client.query('BEGIN');

        const nodoRes = await client.query(
            `SELECT nm.*
             FROM public.nodos_maestro nm
             WHERE nm.id = $1::int
             FOR UPDATE`,
            [nid]
        );
        if (nodoRes.rows.length === 0) {
            const err = new Error('Tienda/Nodo no encontrado.');
            err.statusCode = 404;
            throw err;
        }
        const nodo = nodoRes.rows[0];

        const pedsRes = await client.query(
            `SELECT npv.*,
                    npep.operador_postal AS postal_operador,
                    npep.numero_tracking AS postal_numero_tracking,
                    npep.costo_envio_cliente AS postal_costo_envio_cliente,
                    npep.costo_flete_lamda AS postal_costo_flete_lamda,
                    npep.fecha_despacho AS postal_fecha_despacho
             FROM public.nodos_pedidos_vecinos npv
             LEFT JOIN public.nodos_pedidos_envios_postales npep ON npep.pedido_id = npv.id
             WHERE npv.nodo_id = $1::int
               AND npv.lote_canasto_id IS NULL
               AND COALESCE(npv.estado_operativo, '') <> 'ANULADO'
               AND (
                   COALESCE(npv.impactado_cta_cte_pago, false) = true
                   OR UPPER(COALESCE(npv.estado_pago, '')) IN ('CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR')
               )
               AND COALESCE(npv.debito_cta_cte_registrado, false) = true
               AND npv.liquidacion_id IS NULL
             ORDER BY npv.id ASC
             FOR UPDATE OF npv`,
            [nid]
        );

        let ordenesElegibles = pedsRes.rows;
        if (idsFiltro.length > 0) {
            const setIds = new Set(idsFiltro);
            ordenesElegibles = ordenesElegibles.filter(r => setIds.has(Number(r.id)));
        }

        if (ordenesElegibles.length === 0) {
            const err = new Error(`No hay órdenes despachadas con pago conciliado pendientes de corte en ${nodo.nombre_marca}.`);
            err.statusCode = 400;
            throw err;
        }

        const ordenIds = ordenesElegibles.map(o => Number(o.id));
        const itemsCorteRes = await client.query(
            `SELECT npi.pedido_id,
                    npi.cantidad,
                    npi.precio_unitario_vecino,
                    npi.precio_unitario_base_lamda,
                    npi.subtotal_vecino,
                    npi.subtotal_base_lamda,
                    COALESCE(nac.sku_nodo, npi.sku_nodo) AS sku_oficial_lamda,
                    COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, npi.nombre_publico) AS nombre_oficial_lamda
             FROM public.nodos_pedidos_items npi
             LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
             LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, npi.sku_nodo))
             WHERE npi.pedido_id = ANY($1::int[])
             ORDER BY npi.id ASC`,
            [ordenIds]
        );

        const itemsMap = new Map();
        for (const it of itemsCorteRes.rows) {
            const pid = Number(it.pedido_id);
            if (!itemsMap.has(pid)) itemsMap.set(pid, []);
            const skuOf = it.sku_oficial_lamda || '';
            const nomOf = it.nombre_oficial_lamda || '';
            itemsMap.get(pid).push({
                sku_nodo: skuOf,
                nombre_oficial_lamda: nomOf,
                etiqueta_oficial_lamda: formatearEtiquetaTecnicaArticulo(skuOf, nomOf),
                cantidad: Number(it.cantidad || 1),
                subtotal_cliente: Number(it.subtotal_vecino || 0),
                subtotal_base_lamda: Number(it.subtotal_base_lamda || 0)
            });
        }

        let totalSubtotalProductos = 0;
        let totalEnvioCobradoClientes = 0;
        let totalIngresosBrutos = 0;
        let totalCostoBaseLamda = 0;
        let totalRetencionIvaMargen = 0;
        let totalRetencionIibbMargen = 0;
        let totalRetencionFiscalMargen = 0;
        let totalCostoFleteLamda = 0;
        let totalUtilidadNetaCreador = 0;

        const detalleOrdenes = ordenesElegibles.map(po => {
            const subProd = Number(po.subtotal_productos_vecino || 0);
            const envCli = Number(po.cargo_envio_barrial ?? po.postal_costo_envio_cliente ?? 0);
            const ajusteCred = Number(po.monto_ajuste_credito || 0);
            const ingBruto = Number(po.total_vecino || (subProd + envCli - ajusteCred));
            const baseLamda = Number(po.total_base_lamda || 0);
            const retIva = Number(po.retencion_iva_margen || 0);
            const retIibb = Number(po.retencion_iibb_margen || 0);
            const retFiscal = Number(po.retencion_fiscal_margen || 0);
            const fleteLamda = Number(po.costo_flete_lamda ?? po.postal_costo_flete_lamda ?? 0);
            const utilidadOrden = Number((ingBruto - baseLamda - retFiscal - fleteLamda).toFixed(2));

            totalSubtotalProductos += subProd;
            totalEnvioCobradoClientes += envCli;
            totalIngresosBrutos += ingBruto;
            totalCostoBaseLamda += baseLamda;
            totalRetencionIvaMargen += retIva;
            totalRetencionIibbMargen += retIibb;
            totalRetencionFiscalMargen += retFiscal;
            totalCostoFleteLamda += fleteLamda;
            totalUtilidadNetaCreador += utilidadOrden;

            return {
                pedido_id: Number(po.id),
                codigo_pedido: po.codigo_pedido,
                comprador: po.vecino_nombre,
                operador_postal: po.postal_operador || 'CORREO_ARGENTINO',
                numero_tracking: po.postal_numero_tracking || null,
                fecha_despacho: po.postal_fecha_despacho || po.updated_at,
                subtotal_productos: Number(subProd.toFixed(2)),
                envio_cobrado_cliente: Number(envCli.toFixed(2)),
                ingreso_bruto: Number(ingBruto.toFixed(2)),
                costo_base_lamda: Number(baseLamda.toFixed(2)),
                retencion_iva_margen: Number(retIva.toFixed(2)),
                retencion_iibb_margen: Number(retIibb.toFixed(2)),
                retencion_fiscal_margen: Number(retFiscal.toFixed(2)),
                costo_flete_lamda: Number(fleteLamda.toFixed(2)),
                utilidad_neta_creador: utilidadOrden,
                items: itemsMap.get(Number(po.id)) || []
            };
        });

        totalSubtotalProductos = Number(totalSubtotalProductos.toFixed(2));
        totalEnvioCobradoClientes = Number(totalEnvioCobradoClientes.toFixed(2));
        totalIngresosBrutos = Number(totalIngresosBrutos.toFixed(2));
        totalCostoBaseLamda = Number(totalCostoBaseLamda.toFixed(2));
        totalRetencionIvaMargen = Number(totalRetencionIvaMargen.toFixed(2));
        totalRetencionIibbMargen = Number(totalRetencionIibbMargen.toFixed(2));
        totalRetencionFiscalMargen = Number(totalRetencionFiscalMargen.toFixed(2));
        totalCostoFleteLamda = Number(totalCostoFleteLamda.toFixed(2));
        totalUtilidadNetaCreador = Number(totalUtilidadNetaCreador.toFixed(2));

        let direccionCompensacion = 'SALDADO_EXACTO';
        if (totalUtilidadNetaCreador > 0.01) {
            direccionCompensacion = 'LAMDA_TRANSFIERE_A_GESTOR';
        } else if (totalUtilidadNetaCreador < -0.01) {
            direccionCompensacion = 'GESTOR_RINDE_A_LAMDA';
        }
        const montoCompensacion = Number(Math.abs(totalUtilidadNetaCreador).toFixed(2));

        const usaCuentaMadreUnificada = Boolean(nodo.usar_cuenta_madre_unificada && nodo.codigo_bunker_cliente_madre);
        const impactarEnCuentaMadre = !usaCuentaMadreUnificada && Boolean(payload.impactar_en_cuenta_madre === true);
        const modalidadCierre = usaCuentaMadreUnificada
            ? 'CUENTA_MADRE_UNIFICADA'
            : (impactarEnCuentaMadre ? 'COMPENSACION_CUENTA_MADRE' : 'RENDICION_DIRECTA_NODO');

        const hoyIso = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const codigoLiq = `LIQ-FUL-N${String(nid).padStart(2, '0')}-${hoyIso}-${Date.now().toString().slice(-4)}`;

        let saldoResultante = 0;
        let movCcFacturaId = null;
        let movCcMadreId = null;
        let saldoMadrePostCierre = null;

        if (usaCuentaMadreUnificada) {
            // En Cuenta Madre Unificada (ej. MANSO -> CB-0036), los créditos por transferencias (-ingreso_bruto)
            // y los débitos por despacho postal (+costo_base_lamda + costo_flete_lamda) ya se registraron en tiempo real
            // sobre la Cuenta Principal de la ficha madre dejando el saldo exacto (-Utilidad_Neta_Creador).
            const ccMadreUnif = await obtenerOCrearCuentaPrincipalBunker(client, nodo.codigo_bunker_cliente_madre, {
                forUpdate: true,
                crearSiNoExiste: true
            });
            saldoResultante = Number(ccMadreUnif?.saldo || 0);
            saldoMadrePostCierre = saldoResultante;
        } else if (nodo.codigo_bunker_cliente) {
            const ccRes = await client.query(
                `SELECT id, saldo FROM public.factura_cuentas_corrientes
                 WHERE codigo_bunker_cliente = $1
                 LIMIT 1
                 FOR UPDATE`,
                [nodo.codigo_bunker_cliente]
            );
            if (ccRes.rows.length > 0) {
                const ccId = ccRes.rows[0].id;
                const saldoActual = Number(ccRes.rows[0].saldo || 0);
                if (montoCompensacion > 0 && direccionCompensacion !== 'SALDADO_EXACTO') {
                    const tipoMovSub = direccionCompensacion === 'LAMDA_TRANSFIERE_A_GESTOR' ? 'DEBITO' : 'CREDITO';
                    const descSub = `Corte Liquidación Fulfillment ${codigoLiq} (${ordenesElegibles.length} órdenes · ${nodo.nombre_marca}): Utilidad Neta $${totalUtilidadNetaCreador.toLocaleString('es-AR')}`;
                    const insMovSub = await client.query(
                        `INSERT INTO public.factura_cuenta_corriente_movimientos (
                            cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                            tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                            creado_en, metadatos
                         ) VALUES ($1, $2, $3, 0, 'CORTE_FULFILLMENT_NODO', NULL, $4, NOW(), NOW(), $5)
                         RETURNING id`,
                        [
                            ccId,
                            tipoMovSub,
                            montoCompensacion,
                            descSub,
                            JSON.stringify({ codigo_liquidacion: codigoLiq, cantidad_ordenes: ordenesElegibles.length, utilidad_neta_creador: totalUtilidadNetaCreador })
                        ]
                    );
                    movCcFacturaId = insMovSub.rows[0].id;
                    saldoResultante = await recalcularSaldosCuentaMadreBunker(client, ccId);
                } else {
                    saldoResultante = saldoActual;
                }
            }

            if (impactarEnCuentaMadre && nodo.codigo_bunker_cliente_madre && montoCompensacion > 0 && direccionCompensacion !== 'SALDADO_EXACTO') {
                const ccMadreRes = await client.query(
                    `SELECT id FROM public.factura_cuentas_corrientes
                     WHERE codigo_bunker_cliente = $1
                     ORDER BY CASE WHEN nombre_cuenta = 'Cuenta Principal' THEN 0 ELSE 1 END, id ASC
                     LIMIT 1 FOR UPDATE`,
                    [nodo.codigo_bunker_cliente_madre]
                );
                if (ccMadreRes.rows.length > 0) {
                    const ccMadreId = ccMadreRes.rows[0].id;
                    const tipoMovMadre = direccionCompensacion === 'LAMDA_TRANSFIERE_A_GESTOR' ? 'CREDITO' : 'DEBITO';
                    const insMadre = await client.query(
                        `INSERT INTO public.factura_cuenta_corriente_movimientos (
                            cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                            tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                            creado_en, metadatos
                         ) VALUES ($1, $2, $3, 0, 'LIQUIDACION_NODO', NULL, $4, NOW(), NOW(), $5)
                         RETURNING id`,
                        [
                            ccMadreId,
                            tipoMovMadre,
                            montoCompensacion,
                            `Compensación Corte Fulfillment ${nodo.nombre_marca} (${codigoLiq} · ${ordenesElegibles.length} órdenes): Utilidad Neta $${totalUtilidadNetaCreador.toLocaleString('es-AR')}`,
                            JSON.stringify({ codigo_liquidacion: codigoLiq, utilidad_neta_creador: totalUtilidadNetaCreador })
                        ]
                    );
                    movCcMadreId = insMadre.rows[0].id;
                    saldoMadrePostCierre = await recalcularSaldosCuentaMadreBunker(client, ccMadreId);
                }
            }
        }

        const obsTexto = payload.observaciones ||
            `Corte Fulfillment (${ordenesElegibles.length} órdenes): Productos $${totalSubtotalProductos.toLocaleString('es-AR')} + Envíos cobrados $${totalEnvioCobradoClientes.toLocaleString('es-AR')} − Base LAMDA $${totalCostoBaseLamda.toLocaleString('es-AR')} − Ret. IVA/IIBB s/Margen $${totalRetencionFiscalMargen.toLocaleString('es-AR')} − Flete LAMDA $${totalCostoFleteLamda.toLocaleString('es-AR')} = Utilidad Neta Liquidable $${totalUtilidadNetaCreador.toLocaleString('es-AR')}`;

        const insLiq = await client.query(
            `INSERT INTO public.nodos_liquidaciones_lote (
                codigo_liquidacion, nodo_id, lote_canasto_id, tipo_liquidacion, cantidad_ordenes,
                total_venta_vecinos, total_base_lamda,
                total_retencion_iva_margen, total_retencion_iibb_margen, total_retencion_fiscal_margen,
                total_envio_cobrado_clientes, total_costo_flete_lamda,
                ganancia_neta_gestor, total_transferencias_lamda, total_efectivo_mano_gestor,
                direccion_compensacion, monto_compensacion_final,
                saldo_cta_cte_post_cierre, movimiento_cc_id,
                movimiento_cc_madre_id, saldo_cta_cte_madre_post_cierre,
                modalidad_cierre, observaciones, detalle_ordenes_json
             ) VALUES ($1,$2,NULL,'CORTE_FULFILLMENT',$3,$4,$5,$19,$20,$21,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
             RETURNING *`,
            [
                codigoLiq,
                nid,
                ordenesElegibles.length,
                totalIngresosBrutos,
                totalCostoBaseLamda,
                totalEnvioCobradoClientes,
                totalCostoFleteLamda,
                totalUtilidadNetaCreador,
                totalIngresosBrutos,
                direccionCompensacion,
                montoCompensacion,
                saldoResultante,
                movCcFacturaId,
                movCcMadreId,
                saldoMadrePostCierre,
                modalidadCierre,
                obsTexto,
                JSON.stringify(detalleOrdenes),
                totalRetencionIvaMargen,
                totalRetencionIibbMargen,
                totalRetencionFiscalMargen
            ]
        );
        corteCreado = insLiq.rows[0];

        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET liquidacion_id = $1::int,
                 fecha_liquidacion = NOW(),
                 updated_at = NOW()
             WHERE id = ANY($2::int[])`,
            [corteCreado.id, ordenIds]
        );

        const signoCorte = usaCuentaMadreUnificada
            ? 0
            : (montoCompensacion > 0 ? (direccionCompensacion === 'GESTOR_RINDE_A_LAMDA' ? -1 : 1) : 0);

        await client.query(
            `INSERT INTO public.nodos_movimientos_cta_cte (
                nodo_id, lote_canasto_id, tipo_movimiento, signo, monto,
                saldo_resultante, concepto, referencia_externa
             ) VALUES ($1, NULL, 'CORTE_LIQUIDACION_FULFILLMENT', $2, $3, $4, $5, $6)`,
            [
                nid,
                signoCorte,
                montoCompensacion,
                saldoResultante,
                `Corte de Liquidación ${codigoLiq} (${ordenesElegibles.length} órdenes despachadas): Utilidad Neta Creador $${totalUtilidadNetaCreador.toLocaleString('es-AR')}`,
                codigoLiq
            ]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    const tablero = await obtenerTableroLiquidacionCobros();
    return {
        corte: corteCreado,
        tablero
    };
}

/**
 * Ejecuta la Liquidación Final del Lote/Canasto con soporte bidireccional determinista:
 * - Opción A (`impactar_en_cuenta_madre: false`, default): Rendición / transferencia directa sobre `CB-NODO-xxx`
 *   dejando el lote en $0,00 y manteniendo aislada la Cuenta Personal del Gestor (`CB-0006`).
 * - Opción B (`impactar_en_cuenta_madre: true`, solo si existe `codigo_bunker_cliente_madre`):
 *   Salda `CB-NODO-xxx` en $0,00 y asienta el movimiento espejo enlazado en la Cuenta Personal (`CB-0006`)
 *   tanto cuando el Nodo rinde saldo deudor (`DEBITO` en `CB-0006`) como cuando queda saldo acreedor a favor del Gestor (`CREDITO` en `CB-0006`).
 */
async function cerrarLiquidacionCanasto(canastoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    // Asegurar primero que todos los cobros activos del lote estén conciliados
    await conciliarTodosLosPagosPendientesCanasto(canastoId);

    // Si el canasto aún no tenía registrado su retiro/débito base de Etapa 3, registrarlo primero
    const checkCan = await db.query('SELECT * FROM public.nodos_lotes_estacion WHERE id = $1::int', [Number(canastoId)]);
    if (checkCan.rows.length === 0) {
        throw new Error('Canasto no encontrado.');
    }
    if (!checkCan.rows[0].debito_cta_cte_registrado) {
        await confirmarRetiroCanastoPorGestor(canastoId, { retirado_por: payload.responsable || 'Gestor del Nodo' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const canRes = await client.query(
            `SELECT nle.*,
                    nm.nombre_marca, nm.gestor_nombre, nm.codigo_bunker_cliente,
                    COALESCE(nm.alicuota_iva_margen_pct, 21.00) AS alicuota_iva_margen_pct,
                    COALESCE(nm.alicuota_iibb_margen_pct, 4.00) AS alicuota_iibb_margen_pct,
                    nm.cliente_madre_bunker_id, nm.codigo_bunker_cliente_madre,
                    COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada
             FROM public.nodos_lotes_estacion nle
             JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
             WHERE nle.id = $1::int
             FOR UPDATE OF nle`,
            [Number(canastoId)]
        );
        const canasto = canRes.rows[0];
        if (canasto.liquidacion_cerrada) {
            throw new Error(`La liquidación del canasto ${canasto.codigo_canasto} ya se encuentra cerrada y saldada.`);
        }

        const usaCuentaMadreUnificada = Boolean(canasto.usar_cuenta_madre_unificada && canasto.codigo_bunker_cliente_madre);
        const impactarEnCuentaMadre = !usaCuentaMadreUnificada && Boolean(payload.impactar_en_cuenta_madre === true);
        if ((payload.impactar_en_cuenta_madre === true || canasto.usar_cuenta_madre_unificada) && !canasto.codigo_bunker_cliente_madre) {
            throw new Error('Este Nodo no posee una Cuenta Personal/Madre vinculada para compensar el cierre.');
        }
        const modalidadCierre = usaCuentaMadreUnificada
            ? 'CUENTA_MADRE_UNIFICADA'
            : (impactarEnCuentaMadre ? 'COMPENSACION_CUENTA_MADRE' : 'RENDICION_DIRECTA_NODO');

        const pedsRes = await client.query(
            `SELECT * FROM public.nodos_pedidos_vecinos
             WHERE lote_canasto_id = $1::int
             ORDER BY id ASC`,
            [canasto.id]
        );
        const cuadro = calcularCuadroLiquidacionCanasto(canasto, pedsRes.rows);

        const codigoLiq = `LIQ-${canasto.codigo_canasto}-${Date.now().toString().slice(-4)}`;
        let saldoResultante = 0;
        let movCcFacturaId = null;
        let movCcMadreId = null;
        let saldoMadrePostCierre = null;

        if (usaCuentaMadreUnificada) {
            // En modo Cuenta Madre Unificada, tanto el débito base al retiro como los créditos por transferencias
            // ya impactaron directamente sobre la Cuenta Principal de la ficha madre (ej. CB-0006),
            // por lo que el cierre consolida el cuadro financiero sin generar asientos duplicados ni de traspaso.
            const ccMadreUnif = await obtenerOCrearCuentaPrincipalBunker(client, canasto.codigo_bunker_cliente_madre, {
                forUpdate: true,
                crearSiNoExiste: true
            });
            saldoResultante = Number(ccMadreUnif?.saldo || 0);
            saldoMadrePostCierre = saldoResultante;
        } else {
            if (canasto.codigo_bunker_cliente) {
                const ccRes = await client.query(
                    `SELECT id, saldo FROM public.factura_cuentas_corrientes
                     WHERE codigo_bunker_cliente = $1
                     LIMIT 1
                     FOR UPDATE`,
                    [canasto.codigo_bunker_cliente]
                );
                if (ccRes.rows.length > 0) {
                    const ccId = ccRes.rows[0].id;
                    const saldoActual = Number(ccRes.rows[0].saldo || 0);

                    if (cuadro.direccion_compensacion === 'GESTOR_RINDE_A_LAMDA' && cuadro.monto_compensacion_final > 0) {
                        // Saldo deudor (> 0) en CB-NODO-xxx -> CREDITO (-monto) cancela la deuda del lote dejándolo en $0,00
                        const descNodo = impactarEnCuentaMadre
                            ? `Liquidación Lote ${canasto.codigo_canasto} (${codigoLiq}): Compensación contra Cuenta Personal ${canasto.codigo_bunker_cliente_madre} (${canasto.gestor_nombre} retuvo ganancia de $${cuadro.ganancia_neta_gestor.toLocaleString('es-AR')})`
                            : `Liquidación y Rendición Directa Lote ${canasto.codigo_canasto} (${codigoLiq}): ${canasto.gestor_nombre} retuvo ganancia de $${cuadro.ganancia_neta_gestor.toLocaleString('es-AR')} y rindió saldo neto a LAMDA`;
                        const insMov = await client.query(
                            `INSERT INTO public.factura_cuenta_corriente_movimientos (
                                cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                                tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                                creado_en, metadatos
                             ) VALUES ($1, 'CREDITO', $2, 0, 'LIQUIDACION_LOTE_NODO', NULL, $3, NOW(), NOW(), $4)
                             RETURNING id`,
                            [
                                ccId,
                                cuadro.monto_compensacion_final,
                                descNodo,
                                JSON.stringify({ ...cuadro, codigo_liquidacion: codigoLiq, modalidad_cierre: modalidadCierre })
                            ]
                        );
                        movCcFacturaId = insMov.rows[0].id;
                        saldoResultante = await recalcularSaldosCuentaMadreBunker(client, ccId);
                    } else if (cuadro.direccion_compensacion === 'LAMDA_TRANSFIERE_A_GESTOR' && cuadro.monto_compensacion_final > 0) {
                        // Saldo acreedor (< 0, a favor del Nodo) en CB-NODO-xxx -> DEBITO (+monto) cancela el saldo a favor al pagarlo/transferirlo a CB-0006 o banco del Gestor
                        const descNodo = impactarEnCuentaMadre
                            ? `Liquidación Lote ${canasto.codigo_canasto} (${codigoLiq}): Traspaso de saldo a favor a Cuenta Personal ${canasto.codigo_bunker_cliente_madre}`
                            : `Liquidación Directa Lote ${canasto.codigo_canasto} (${codigoLiq}): Transferencia de saldo de ganancia de LAMDA al Gestor (${canasto.gestor_nombre})`;
                        const insMov = await client.query(
                            `INSERT INTO public.factura_cuenta_corriente_movimientos (
                                cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                                tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                                creado_en, metadatos
                             ) VALUES ($1, 'DEBITO', $2, 0, 'LIQUIDACION_LOTE_NODO', NULL, $3, NOW(), NOW(), $4)
                             RETURNING id`,
                            [
                                ccId,
                                cuadro.monto_compensacion_final,
                                descNodo,
                                JSON.stringify({ ...cuadro, codigo_liquidacion: codigoLiq, modalidad_cierre: modalidadCierre })
                            ]
                        );
                        movCcFacturaId = insMov.rows[0].id;
                        saldoResultante = await recalcularSaldosCuentaMadreBunker(client, ccId);
                    } else {
                        saldoResultante = saldoActual;
                    }
                }
            }

            // 2. Asiento Espejo Bidireccional en Cuenta Personal/Madre (ej: CB-0006) SOLO cuando el Admin eligió Opción B
            if (canasto.codigo_bunker_cliente_madre) {
                const ccMadreRes = await client.query(
                    `SELECT id, saldo FROM public.factura_cuentas_corrientes
                     WHERE codigo_bunker_cliente = $1
                     ORDER BY CASE WHEN nombre_cuenta = 'Cuenta Principal' THEN 0 ELSE 1 END, id ASC
                     LIMIT 1
                     FOR UPDATE`,
                    [canasto.codigo_bunker_cliente_madre]
                );
                if (ccMadreRes.rows.length > 0) {
                    const ccMadreId = ccMadreRes.rows[0].id;
                    if (impactarEnCuentaMadre && cuadro.monto_compensacion_final > 0 &&
                        (cuadro.direccion_compensacion === 'LAMDA_TRANSFIERE_A_GESTOR' || cuadro.direccion_compensacion === 'GESTOR_RINDE_A_LAMDA')) {
                        const esCreditoMadre = cuadro.direccion_compensacion === 'LAMDA_TRANSFIERE_A_GESTOR';
                        const tipoMovMadre = esCreditoMadre ? 'CREDITO' : 'DEBITO';
                        const descMadre = esCreditoMadre
                            ? `Compensación Nodo ${canasto.nombre_marca} (${codigoLiq} · Lote ${canasto.codigo_canasto}): Saldo neto de ganancia acreditado a favor de ${canasto.gestor_nombre} (Transferencias en LAMDA $${cuadro.transferencias_conciliadas_lamda.toLocaleString('es-AR')} - Costo Base $${cuadro.total_base_lamda.toLocaleString('es-AR')})`
                            : `Compensación Nodo ${canasto.nombre_marca} (${codigoLiq} · Lote ${canasto.codigo_canasto}): Rendición neta compensada a favor de LAMDA por cobros en efectivo en mano ($${cuadro.efectivo_cobrado_mano_gestor.toLocaleString('es-AR')} cobrados - $${cuadro.ganancia_neta_gestor.toLocaleString('es-AR')} ganancia retenida)`;

                        const insMovMadre = await client.query(
                            `INSERT INTO public.factura_cuenta_corriente_movimientos (
                                cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                                tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                                creado_en, metadatos
                             ) VALUES ($1, $2, $3, 0, 'LIQUIDACION_NODO', NULL, $4, NOW(), NOW(), $5)
                             RETURNING id`,
                            [
                                ccMadreId,
                                tipoMovMadre,
                                cuadro.monto_compensacion_final,
                                descMadre,
                                JSON.stringify({
                                    ...cuadro,
                                    codigo_liquidacion: codigoLiq,
                                    modalidad_cierre: modalidadCierre,
                                    codigo_canasto: canasto.codigo_canasto,
                                    codigo_bunker_subcuenta_nodo: canasto.codigo_bunker_cliente,
                                    codigo_bunker_cliente_madre: canasto.codigo_bunker_cliente_madre,
                                    movimiento_cc_subcuenta_nodo_id: movCcFacturaId
                                })
                            ]
                        );
                        movCcMadreId = insMovMadre.rows[0].id;
                        saldoMadrePostCierre = await recalcularSaldosCuentaMadreBunker(client, ccMadreId);

                        if (movCcFacturaId) {
                            await client.query(
                                `UPDATE public.factura_cuenta_corriente_movimientos
                                 SET metadatos = COALESCE(metadatos, '{}'::jsonb) || $1::jsonb
                                 WHERE id = $2`,
                                [JSON.stringify({ movimiento_cc_madre_id: movCcMadreId }), movCcFacturaId]
                            );
                        }
                    } else {
                        saldoMadrePostCierre = Number(ccMadreRes.rows[0].saldo || 0);
                    }
                }
            }
        }

        const insLiq = await client.query(
            `INSERT INTO public.nodos_liquidaciones_lote (
                codigo_liquidacion, nodo_id, lote_canasto_id,
                total_venta_vecinos, total_base_lamda,
                total_retencion_iva_margen, total_retencion_iibb_margen, total_retencion_fiscal_margen,
                ganancia_neta_gestor,
                total_transferencias_lamda, total_efectivo_mano_gestor,
                direccion_compensacion, monto_compensacion_final,
                saldo_cta_cte_post_cierre, movimiento_cc_id,
                movimiento_cc_madre_id, saldo_cta_cte_madre_post_cierre,
                modalidad_cierre, observaciones
             ) VALUES ($1,$2,$3,$4,$5,$17,$18,$19,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             RETURNING *`,
            [
                codigoLiq,
                canasto.nodo_id,
                canasto.id,
                cuadro.total_venta_vecinos,
                cuadro.total_base_lamda,
                cuadro.ganancia_neta_gestor,
                cuadro.transferencias_conciliadas_lamda,
                cuadro.efectivo_cobrado_mano_gestor,
                cuadro.direccion_compensacion,
                cuadro.monto_compensacion_final,
                saldoResultante,
                movCcFacturaId,
                movCcMadreId,
                saldoMadrePostCierre,
                modalidadCierre,
                payload.observaciones || cuadro.explicacion_compensacion,
                cuadro.total_retencion_iva_margen || 0,
                cuadro.total_retencion_iibb_margen || 0,
                cuadro.total_retencion_fiscal_margen || 0
            ]
        );
        const liqRow = insLiq.rows[0];

        // Ley unificada: CREDITO (GESTOR_RINDE_A_LAMDA) => signo -1; DEBITO (LAMDA_TRANSFIERE_A_GESTOR) => signo +1
        const signoMov = cuadro.monto_compensacion_final > 0
            ? (cuadro.direccion_compensacion === 'GESTOR_RINDE_A_LAMDA' ? -1 : 1)
            : 0;
        const etiquetaModo = impactarEnCuentaMadre
            ? `Compensado en ${canasto.codigo_bunker_cliente_madre}`
            : 'Rendición / Liquidación Directa Nodo';
        await client.query(
            `INSERT INTO public.nodos_movimientos_cta_cte (
                nodo_id, lote_canasto_id, tipo_movimiento, signo, monto,
                saldo_resultante, concepto, referencia_externa
             ) VALUES ($1, $2, 'LIQUIDACION_CIERRE_LOTE', $3, $4, $5, $6, $7)`,
            [
                canasto.nodo_id,
                canasto.id,
                signoMov,
                cuadro.monto_compensacion_final,
                saldoResultante,
                `Cierre de Liquidación ${codigoLiq} (${canasto.codigo_canasto} · ${etiquetaModo}): Ganancia Gestor $${cuadro.ganancia_neta_gestor.toLocaleString('es-AR')} cubierta · ${cuadro.titulo_resultado} · Cta. Cte. Nodo Saldada`,
                codigoLiq
            ]
        );

        await client.query(
            `UPDATE public.nodos_lotes_estacion
             SET liquidacion_cerrada = true,
                 liquidacion_id = $1,
                 fecha_liquidacion = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
            [liqRow.id, canasto.id]
        );

        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_operativo = 'ENTREGADO_VECINO',
                 updated_at = NOW()
             WHERE lote_canasto_id = $1
               AND COALESCE(estado_operativo, '') <> 'ANULADO'`,
            [canasto.id]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    return obtenerTableroLiquidacionCobros();
}

/**
 * Herramienta de Laboratorio: Reabre los cobros y la liquidación de un Canasto
 * recalculando de forma determinista CB-NODO-xxx, CB-0006 y las subcuentas de vecinos.
 */
async function reabrirLiquidacionCanastoPrueba(canastoId) {
    await asegurarEsquemaNodosBarriales();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const canRes = await client.query(
            `SELECT nle.*, nm.codigo_bunker_cliente, nm.codigo_bunker_cliente_madre
             FROM public.nodos_lotes_estacion nle
             JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
             WHERE nle.id = $1::int
             FOR UPDATE OF nle`,
            [Number(canastoId)]
        );
        if (canRes.rows.length === 0) {
            throw new Error('Canasto no encontrado.');
        }
        const canasto = canRes.rows[0];
        const ccsARecalcular = new Set();

        // 1. Revertir liquidación final si estaba cerrada (tanto en subcuenta del Nodo como en Cuenta Madre)
        const liqRes = await client.query(
            'SELECT * FROM public.nodos_liquidaciones_lote WHERE lote_canasto_id = $1::int',
            [canasto.id]
        );
        for (const liq of liqRes.rows) {
            if (liq.movimiento_cc_id) {
                const delSub = await client.query(
                    'DELETE FROM public.factura_cuenta_corriente_movimientos WHERE id = $1 RETURNING cuenta_corriente_id',
                    [liq.movimiento_cc_id]
                );
                if (delSub.rows[0]?.cuenta_corriente_id) {
                    ccsARecalcular.add(Number(delSub.rows[0].cuenta_corriente_id));
                }
            }
            if (liq.movimiento_cc_madre_id) {
                const mRes = await client.query(
                    'DELETE FROM public.factura_cuenta_corriente_movimientos WHERE id = $1 RETURNING cuenta_corriente_id',
                    [liq.movimiento_cc_madre_id]
                );
                if (mRes.rows[0]?.cuenta_corriente_id) {
                    ccsARecalcular.add(Number(mRes.rows[0].cuenta_corriente_id));
                }
            }
        }
        await client.query('DELETE FROM public.nodos_liquidaciones_lote WHERE lote_canasto_id = $1::int', [canasto.id]);

        // 2. Revertir créditos de pagos de vecinos de este lote (tanto en Cuenta Madre/CB-NODO-xxx como en subcuentas vecinales)
        const pedsRes = await client.query(
            'SELECT * FROM public.nodos_pedidos_vecinos WHERE lote_canasto_id = $1::int',
            [canasto.id]
        );
        const vecinosAfectados = new Set();
        for (const p of pedsRes.rows) {
            if (p.movimiento_pago_cc_id) {
                const delPag = await client.query(
                    'DELETE FROM public.factura_cuenta_corriente_movimientos WHERE id = $1 RETURNING cuenta_corriente_id',
                    [p.movimiento_pago_cc_id]
                );
                if (delPag.rows[0]?.cuenta_corriente_id) {
                    ccsARecalcular.add(Number(delPag.rows[0].cuenta_corriente_id));
                }
            }
            if (String(p.estado_operativo || '').toUpperCase() !== 'ANULADO') {
                await client.query(
                    `DELETE FROM public.nodos_vecinos_movimientos_cc
                     WHERE pedido_vecino_id = $1::int
                       AND tipo_movimiento IN ('CREDITO_TRANSFERENCIA_LAMDA', 'CREDITO_EFECTIVO_GESTOR')`,
                    [p.id]
                );
                if (p.vecino_id) vecinosAfectados.add(Number(p.vecino_id));
            }
        }

        if (canasto.codigo_bunker_cliente) {
            const ccNodoRes = await client.query(
                'SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = $1 LIMIT 1',
                [canasto.codigo_bunker_cliente]
            );
            if (ccNodoRes.rows[0]?.id) {
                ccsARecalcular.add(Number(ccNodoRes.rows[0].id));
            }
        }

        for (const ccIdRecalc of ccsARecalcular) {
            await recalcularSaldosCuentaMadreBunker(client, ccIdRecalc);
        }

        for (const vid of vecinosAfectados) {
            await recalcularSaldoSubcuentaVecino(client, vid);
        }

        // 3. Limpiar movimientos de cobro/liquidación en nodos_movimientos_cta_cte (conservando DEBITO_RETIRO_LOTE)
        await client.query(
            `DELETE FROM public.nodos_movimientos_cta_cte
             WHERE lote_canasto_id = $1::int
               AND tipo_movimiento IN ('CREDITO_TRANSFERENCIA_VECINO', 'COBRO_EFECTIVO_MANO_GESTOR', 'LIQUIDACION_CIERRE_LOTE')`,
            [canasto.id]
        );

        // 4. Restaurar estado de pago de los pedidos activos del canasto
        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_pago = CASE WHEN medio_pago = 'EFECTIVO' THEN 'COBRAR_EN_ENTREGA' ELSE 'PENDIENTE_TRANSFERENCIA' END,
                 estado_operativo = CASE WHEN $2::varchar = 'ENTREGADO_AL_GESTOR' THEN 'EN_PODER_GESTOR' ELSE estado_operativo END,
                 impactado_cta_cte_pago = false,
                 movimiento_pago_cc_id = NULL,
                 fecha_conciliacion_pago = NULL,
                 updated_at = NOW()
             WHERE lote_canasto_id = $1::int
               AND COALESCE(estado_operativo, '') <> 'ANULADO'`,
            [canasto.id, canasto.estado_canasto]
        );

        await client.query(
            `UPDATE public.nodos_lotes_estacion
             SET liquidacion_cerrada = false,
                 liquidacion_id = NULL,
                 fecha_liquidacion = NULL,
                 updated_at = NOW()
             WHERE id = $1::int`,
            [canasto.id]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    return obtenerTableroLiquidacionCobros();
}

/**
 * Herramienta de Laboratorio (Fase 0):
 * Limpia el 100% de los Nodos, pedidos, vecinos, canastos, propuestas, clientes Nodos (Búnker + Lomas),
 * cuentas corrientes de Nodos y presupuestos/canastos de prueba en etiquetas_pruebas,
 * manteniendo intactos todos los datos mayoristas habituales.
 * Por defecto conserva 2 artículos base preexistentes en Lista Base Nodos Barriales (APN25/27X250G y GSX500G)
 * para permitir probar tanto la publicación de un artículo preexistente como la solicitud de cotización de una fracción nueva.
 */
async function ponerACeroDatosNodosBarriales(opciones = {}) {
    await asegurarEsquemaNodosBarriales({ sembrarDemo: false });
    const conservarArticulosBase = opciones.conservarArticulosBase !== false;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Limpiar presupuestos y detalles de Canastos Nodos del circuito operativo general LAMDA
        await client.query(`
            DELETE FROM public.presupuestos_detalles
            WHERE id_presupuesto IN (
                SELECT id FROM public.presupuestos
                WHERE id_presupuesto_ext LIKE 'CAN-%'
                   OR tipo_comprobante = 'Canasto Nodo'
                   OR agente = 'Nodo Barrial'
            )
            OR id_presupuesto_ext LIKE 'CAN-%'
        `);
        await client.query(`
            DELETE FROM public.presupuestos
            WHERE id_presupuesto_ext LIKE 'CAN-%'
               OR tipo_comprobante = 'Canasto Nodo'
               OR agente = 'Nodo Barrial'
        `);

        // 2. Limpiar movimientos y cuentas corrientes de Nodos en factura_cuentas_corrientes
        // Si hubo movimientos de Nodos imputados en Cuentas Madre (ej: CB-0006 unificada o liquidación), eliminarlos y recalcular el saldo de las Cuentas Madre
        const ccsMadreAfectadas = await client.query(`
            SELECT DISTINCT cuenta_corriente_id
            FROM public.factura_cuenta_corriente_movimientos
            WHERE (tipo_comprobante IN ('CANASTO_NODO', 'TRANSFERENCIA_VECINO_NODO', 'LIQUIDACION_LOTE_NODO', 'LIQUIDACION_NODO', 'REVERSION_TRANSFERENCIA_ANULADA_NODO', 'NOTA_CREDITO_CANASTO_NODO')
                   OR origen_tipo = 'LIQUIDACION_NODO')
              AND cuenta_corriente_id NOT IN (
                  SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente LIKE 'CB-NODO-%'
              )
        `);
        await client.query(`
            DELETE FROM public.factura_cuenta_corriente_movimientos
            WHERE tipo_comprobante IN ('CANASTO_NODO', 'TRANSFERENCIA_VECINO_NODO', 'LIQUIDACION_LOTE_NODO', 'LIQUIDACION_NODO', 'REVERSION_TRANSFERENCIA_ANULADA_NODO', 'NOTA_CREDITO_CANASTO_NODO')
               OR origen_tipo = 'LIQUIDACION_NODO'
               OR cuenta_corriente_id IN (
                   SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente LIKE 'CB-NODO-%'
               )
        `);
        await client.query(`
            DELETE FROM public.factura_cuentas_corrientes
            WHERE codigo_bunker_cliente LIKE 'CB-NODO-%'
        `);
        for (const rMadre of ccsMadreAfectadas.rows) {
            if (rMadre.cuenta_corriente_id) {
                await recalcularSaldosCuentaMadreBunker(client, rMadre.cuenta_corriente_id);
            }
        }

        // 3. Limpiar clientes Nodos en Búnker y en Lomas/Logística (cliente_id >= 9000)
        await client.query(`
            DELETE FROM public.bunker_cliente_listas_precios
            WHERE bunker_cliente_id IN (
                SELECT id FROM public.bunker_clientes WHERE codigo_bunker_cliente LIKE 'CB-NODO-%'
            )
        `);
        await client.query(`
            DELETE FROM public.bunker_clientes
            WHERE codigo_bunker_cliente LIKE 'CB-NODO-%'
        `);
        await client.query(`
            DELETE FROM public.clientes_domicilios
            WHERE id_cliente IN (
                SELECT id FROM public.clientes WHERE cliente_id >= 9000 OR nombre ILIKE '%NODO:%'
            )
        `);
        await client.query(`
            DELETE FROM public.clientes
            WHERE cliente_id >= 9000 OR nombre ILIKE '%NODO:%'
        `);

        // 4. Vaciar todas las tablas operativas de Nodos y reiniciar sus secuencias a 1
        await client.query(`
            TRUNCATE TABLE
                public.nodos_tienda_eventos,
                public.nodos_tienda_visitantes,
                public.nodos_vecinos_movimientos_cc,
                public.nodos_liquidaciones_lote,
                public.nodos_movimientos_cta_cte,
                public.nodos_alias_vecinos_aprendidos,
                public.nodos_pedidos_items,
                public.nodos_pedidos_vecinos,
                public.nodos_vecinos,
                public.nodos_lotes_estacion,
                public.nodos_ofertas_gestor,
                public.nodos_propuestas_fracciones,
                public.nodos_maestro
            RESTART IDENTITY CASCADE
        `);

        // 5. Configurar el estado inicial de Lista Base Nodos Barriales y nodos_articulos_catalogo
        const skusExclusivosMuestra = conservarArticulosBase
            ? ['MFSX500G', 'CCTSX250', 'BF6X50']
            : ['APN25/27X250G', 'MFSX500G', 'CCTSX250', 'BF6X50'];

        // Limpiar del Búnker las fracciones creadas exclusivamente como muestra de Nodos (sin tocar artículos mayoristas nativos como GSX500G o GDFX500G)
        await client.query(
            `DELETE FROM public.bunker_lista_insumos
             WHERE lista_articulo_id IN (
                 SELECT id FROM public.bunker_lista_articulos WHERE UPPER(articulo_numero) = ANY($1)
             )`,
            [skusExclusivosMuestra]
        );
        await client.query(
            `DELETE FROM public.bunker_lista_articulos WHERE UPPER(articulo_numero) = ANY($1)`,
            [skusExclusivosMuestra]
        );
        await client.query(
            `DELETE FROM public.receta_ingredientes
             WHERE receta_id IN (
                 SELECT id FROM public.recetas WHERE UPPER(articulo_numero) = ANY($1)
             )`,
            [skusExclusivosMuestra]
        );
        await client.query(
            `DELETE FROM public.recetas WHERE UPPER(articulo_numero) = ANY($1)`,
            [skusExclusivosMuestra]
        );
        await client.query(
            `DELETE FROM public.stock_real_consolidado WHERE UPPER(articulo_numero) = ANY($1) OR UPPER(codigo_barras) = ANY($1)`,
            [skusExclusivosMuestra]
        );
        await client.query(
            `DELETE FROM public.bunker_articulos WHERE UPPER(articulo_id) = ANY($1) OR UPPER(codigo_barras) = ANY($1)`,
            [skusExclusivosMuestra]
        );
        await client.query(
            `DELETE FROM public.articulos WHERE UPPER(numero) = ANY($1) OR UPPER(codigo_barras) = ANY($1)`,
            [skusExclusivosMuestra]
        );

        if (conservarArticulosBase) {
            await client.query(
                `DELETE FROM public.nodos_articulos_catalogo
                 WHERE UPPER(sku_nodo) NOT IN ('APN25/27X250G', 'GSX500G')`
            );
            await client.query(
                `DELETE FROM public.bunker_lista_articulos
                 WHERE lista_id IN (
                     SELECT id FROM public.bunker_listas_precios WHERE COALESCE(canal_comercial, 'MAYORISTA') = 'NODOS'
                 )
                 AND UPPER(articulo_numero) NOT IN ('APN25/27X250G', 'GSX500G')`
            );
        } else {
            await client.query(`TRUNCATE TABLE public.nodos_articulos_catalogo RESTART IDENTITY CASCADE`);
            await client.query(
                `DELETE FROM public.bunker_lista_articulos
                 WHERE lista_id IN (
                     SELECT id FROM public.bunker_listas_precios WHERE COALESCE(canal_comercial, 'MAYORISTA') = 'NODOS'
                 )`
            );
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    await sincronizarNodosConCircuitoOperativoLamda();

    const catRes = await db.query(
        'SELECT id, sku_nodo, nombre_publico, presentacion_etiqueta, flujo_lamda, precio_base_nodo_final FROM public.nodos_articulos_catalogo WHERE activo = true ORDER BY id ASC'
    );
    return {
        ok: true,
        nodos_activos: 0,
        pedidos_vecinos: 0,
        canastos_estacion: 0,
        propuestas_pendientes: 0,
        clientes_nodos_padron: 0,
        presupuestos_canastos: 0,
        conservar_articulos_base: conservarArticulosBase,
        articulos_base_lista_nodos: catRes.rows
    };
}

/**
 * Obtiene la estructura jerárquica en Árbol (Nodo -> Vecinos -> Artículos de cada vecino)
 * para una lista de códigos de canasto ('CAN-...') sin sobrecargar la consulta principal.
 */
async function obtenerArbolCanastosPorCodigos(codigosCanastos = []) {
    const codigos = Array.from(new Set((codigosCanastos || []).map(c => String(c || '').trim()).filter(Boolean)));
    if (codigos.length === 0) return {};

    const canRes = await db.query(
        `SELECT nle.*,
                nm.codigo_nodo,
                nm.slug AS nodo_slug,
                nm.nombre_marca,
                nm.subtitulo_marca,
                nm.gestor_nombre,
                nm.gestor_telefono,
                nm.barrio_zona,
                nm.direccion_retiro,
                nm.color_primario
         FROM public.nodos_lotes_estacion nle
         JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
         WHERE nle.codigo_canasto = ANY($1::text[])
            OR nle.id_presupuesto_ext = ANY($1::text[])`,
        [codigos]
    );
    if (canRes.rows.length === 0) return {};

    const canastoIds = canRes.rows.map(r => Number(r.id));
    const [pedidosRes, itemsRes] = await Promise.all([
        db.query(
            `SELECT npv.*
             FROM public.nodos_pedidos_vecinos npv
             WHERE npv.lote_canasto_id = ANY($1::int[])
               AND COALESCE(npv.estado_operativo, '') <> 'ANULADO'
             ORDER BY npv.id ASC`,
            [canastoIds]
        ),
        db.query(
            `SELECT npi.*,
                    npv.lote_canasto_id,
                    COALESCE(nac.sku_nodo, npi.sku_nodo) AS sku_oficial_lamda,
                    COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, npi.nombre_publico) AS nombre_oficial_lamda,
                    COALESCE(nac.kilos_unidad, 0.25)::numeric(10,3) AS kilos_unidad
             FROM public.nodos_pedidos_items npi
             JOIN public.nodos_pedidos_vecinos npv ON npv.id = npi.pedido_id
             LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
             LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, npi.sku_nodo))
             WHERE npv.lote_canasto_id = ANY($1::int[])
               AND COALESCE(npv.estado_operativo, '') <> 'ANULADO'
             ORDER BY npi.id ASC`,
            [canastoIds]
        )
    ]);

    const itemsPorPedido = new Map();
    for (const it of itemsRes.rows) {
        const pid = Number(it.pedido_id);
        if (!itemsPorPedido.has(pid)) itemsPorPedido.set(pid, []);
        const skuOf = it.sku_oficial_lamda || it.sku_nodo || '';
        const nomOf = it.nombre_oficial_lamda || it.nombre_publico;
        itemsPorPedido.get(pid).push({
            id: Number(it.id),
            sku_nodo: skuOf,
            nombre_oficial_lamda: nomOf,
            etiqueta_oficial_lamda: formatearEtiquetaTecnicaArticulo(skuOf, nomOf),
            nombre_publico: nomOf,
            presentacion_etiqueta: it.presentacion_etiqueta || '',
            cantidad: Number(it.cantidad || 0),
            kilos_unidad: Number(it.kilos_unidad || 0),
            precio_unitario_base_lamda: Number(it.precio_unitario_base_lamda || 0),
            precio_unitario_vecino: Number(it.precio_unitario_vecino || 0),
            subtotal_vecino: Number(it.subtotal_vecino || 0)
        });
    }

    const vecinosPorCanasto = new Map();
    for (const p of pedidosRes.rows) {
        const cid = Number(p.lote_canasto_id);
        const itemsVecino = itemsPorPedido.get(Number(p.id)) || [];
        const totalUnidadesVecino = itemsVecino.reduce((acc, x) => acc + Number(x.cantidad || 0), 0);
        const bolsaLista = ['ARMADO_EN_CANASTO', 'EN_PODER_GESTOR', 'ENTREGADO_VECINO'].includes(String(p.estado_operativo || ''));

        if (!vecinosPorCanasto.has(cid)) vecinosPorCanasto.set(cid, []);
        vecinosPorCanasto.get(cid).push({
            id: Number(p.id),
            codigo_pedido: p.codigo_pedido,
            vecino_nombre: p.vecino_nombre,
            vecino_telefono: p.vecino_telefono || '',
            modalidad_entrega: p.modalidad_entrega || 'RETIRO_NODO',
            direccion_entrega: p.direccion_entrega || '',
            medio_pago: p.medio_pago || 'TRANSFERENCIA',
            estado_pago: p.estado_pago || 'PENDIENTE',
            estado_operativo: p.estado_operativo || 'CONFIRMADO_VECINO',
            bolsa_lista: bolsaLista,
            etiqueta_impresa: Boolean(p.etiqueta_impresa),
            total_vecino: Number(p.total_vecino || 0),
            total_base_lamda: Number(p.total_base_lamda || 0),
            total_articulos_distintos: itemsVecino.length,
            total_unidades_vecino: totalUnidadesVecino,
            items: itemsVecino
        });
    }

    const resultado = {};
    for (const c of canRes.rows) {
        const cid = Number(c.id);
        const vecinos = vecinosPorCanasto.get(cid) || [];
        const totalUnidadesCanasto = vecinos.reduce((acc, v) => acc + Number(v.total_unidades_vecino || 0), 0);
        const bolsasArmadasCalc = vecinos.filter(v => v.bolsa_lista).length;
        const payloadArbol = {
            canasto_id: cid,
            codigo_canasto: c.codigo_canasto,
            nodo_id: Number(c.nodo_id),
            codigo_nodo: c.codigo_nodo,
            nodo_slug: c.nodo_slug,
            nombre_marca: c.nombre_marca,
            subtitulo_marca: c.subtitulo_marca || '',
            gestor_nombre: c.gestor_nombre,
            gestor_telefono: c.gestor_telefono || '',
            barrio_zona: c.barrio_zona || '',
            direccion_retiro: c.direccion_retiro || '',
            color_primario: c.color_primario || '#16a34a',
            fecha_entrega_label: c.fecha_entrega_label || '',
            estado_canasto: c.estado_canasto || 'EN_ARMADO',
            secuencia_operativa_lamda: c.secuencia_operativa_lamda || 'Imprimir',
            total_vecinos: vecinos.length,
            total_bolsas: Number(c.total_bolsas || vecinos.length),
            bolsas_armadas: bolsasArmadasCalc,
            total_unidades: totalUnidadesCanasto,
            total_kilos_lote: Number(c.total_kilos_lote || 0),
            total_base_lamda: Number(c.total_base_lamda || 0),
            total_venta_vecinos: Number(c.total_venta_vecinos || 0),
            qr_maestro_payload: c.qr_maestro_payload || c.codigo_canasto,
            vecinos
        };
        resultado[c.codigo_canasto] = payloadArbol;
        if (c.id_presupuesto_ext && c.id_presupuesto_ext !== c.codigo_canasto) {
            resultado[c.id_presupuesto_ext] = payloadArbol;
        }
    }
    return resultado;
}

/**
 * Obtiene los metadatos de Nodo + Canasto + Vecino indexados por código de pedido vecinal ('NB-1001', etc.)
 * para enriquecer tanto los acordeones nativos de produccion.html como la impresión individual de Remitos R por vecino.
 */
async function obtenerMetadataPedidosVecinosPorCodigos(codigosPedidos = [], opciones = {}) {
    const codigos = Array.from(new Set((codigosPedidos || []).map(c => String(c || '').trim()).filter(Boolean)));
    if (codigos.length === 0) return {};
    const incluirLogo = Boolean(opciones && opciones.incluirLogo);

    const logoSelectSql = incluirLogo
        ? `,
                nm.logo_original_base64,
                nm.logo_mono_preview_base64`
        : '';

    const pedRes = await db.query(
        `SELECT npv.*,
                nle.id AS canasto_id_ref,
                nle.codigo_canasto,
                nle.qr_maestro_payload,
                nle.estado_canasto,
                nle.total_bolsas AS canasto_total_bolsas,
                nle.bolsas_armadas AS canasto_bolsas_armadas,
                nle.fecha_entrega_label AS canasto_fecha_entrega_label,
                nm.codigo_nodo,
                nm.slug AS nodo_slug,
                nm.nombre_marca,
                nm.subtitulo_marca,
                nm.gestor_nombre,
                nm.gestor_telefono,
                nm.gestor_email,
                nm.barrio_zona,
                nm.direccion_retiro,
                nm.alias_bancario_display,
                nm.cbu_display,
                nm.titular_display,
                nm.color_primario${logoSelectSql}
         FROM public.nodos_pedidos_vecinos npv
         LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
         JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
         WHERE npv.codigo_pedido = ANY($1::text[])`,
        [codigos]
    );
    if (pedRes.rows.length === 0) return {};

    const pedidoIds = pedRes.rows.map(r => Number(r.id));
    const itemsRes = await db.query(
        `SELECT npi.*,
                COALESCE(nac.sku_nodo, npi.sku_nodo) AS sku_oficial_lamda,
                COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, npi.nombre_publico) AS nombre_oficial_lamda,
                COALESCE(nac.kilos_unidad, 0.25)::numeric(10,3) AS kilos_unidad
         FROM public.nodos_pedidos_items npi
         LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
         LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, npi.sku_nodo))
         WHERE npi.pedido_id = ANY($1::int[])
         ORDER BY npi.id ASC`,
        [pedidoIds]
    );

    const itemsPorPedido = new Map();
    for (const it of itemsRes.rows) {
        const pid = Number(it.pedido_id);
        if (!itemsPorPedido.has(pid)) itemsPorPedido.set(pid, []);
        const skuOf = it.sku_oficial_lamda || it.sku_nodo || '';
        const nomOf = it.nombre_oficial_lamda || it.nombre_publico;
        itemsPorPedido.get(pid).push({
            id: Number(it.id),
            sku_nodo: skuOf,
            nombre_oficial_lamda: nomOf,
            etiqueta_oficial_lamda: formatearEtiquetaTecnicaArticulo(skuOf, nomOf),
            nombre_publico: nomOf,
            presentacion_etiqueta: it.presentacion_etiqueta || '',
            cantidad: Number(it.cantidad || 0),
            kilos_unidad: Number(it.kilos_unidad || 0),
            precio_unitario_base_lamda: Number(it.precio_unitario_base_lamda || 0),
            precio_unitario_vecino: Number(it.precio_unitario_vecino || 0),
            subtotal_vecino: Number(it.subtotal_vecino || 0)
        });
    }

    const resultado = {};
    for (const p of pedRes.rows) {
        const itemsVecino = itemsPorPedido.get(Number(p.id)) || [];
        const totalUnidadesVecino = itemsVecino.reduce((acc, x) => acc + Number(x.cantidad || 0), 0);
        const bolsaLista = ['ARMADO_EN_CANASTO', 'EN_PODER_GESTOR', 'ENTREGADO_VECINO'].includes(String(p.estado_operativo || ''));

        const entry = {
            pedido_id: Number(p.id),
            codigo_pedido: p.codigo_pedido,
            nodo_id: Number(p.nodo_id),
            codigo_nodo: p.codigo_nodo,
            nodo_slug: p.nodo_slug,
            nombre_marca: p.nombre_marca,
            subtitulo_marca: p.subtitulo_marca || '',
            gestor_nombre: p.gestor_nombre,
            gestor_telefono: p.gestor_telefono || '',
            gestor_email: p.gestor_email || '',
            barrio_zona: p.barrio_zona || '',
            direccion_retiro: p.direccion_retiro || '',
            alias_bancario_display: p.alias_bancario_display || '',
            cbu_display: p.cbu_display || '',
            titular_display: p.titular_display || '',
            color_primario: p.color_primario || '#a2553b',
            canasto_id: p.canasto_id_ref ? Number(p.canasto_id_ref) : null,
            codigo_canasto: p.codigo_canasto || '',
            qr_maestro_payload: p.qr_maestro_payload || p.codigo_canasto || p.codigo_pedido,
            estado_canasto: p.estado_canasto || 'EN_ARMADO',
            canasto_total_bolsas: Number(p.canasto_total_bolsas || 1),
            canasto_bolsas_armadas: Number(p.canasto_bolsas_armadas || 0),
            fecha_entrega_label: p.canasto_fecha_entrega_label || p.fecha_entrega_label || '',
            vecino_nombre: p.vecino_nombre,
            vecino_telefono: p.vecino_telefono || '',
            modalidad_entrega: p.modalidad_entrega || 'RETIRO_NODO',
            direccion_entrega: p.direccion_entrega || '',
            entrecalles_referencia: p.entrecalles_referencia || '',
            observaciones_vecino: p.observaciones_vecino || '',
            medio_pago: p.medio_pago || 'TRANSFERENCIA',
            estado_pago: p.estado_pago || 'PENDIENTE',
            estado_operativo: p.estado_operativo || 'CONFIRMADO_VECINO',
            secuencia_operativa_lamda: p.secuencia_operativa_lamda || 'Imprimir',
            bolsa_lista: bolsaLista,
            etiqueta_impresa: Boolean(p.etiqueta_impresa),
            subtotal_productos_vecino: Number(p.subtotal_productos_vecino || p.total_vecino || 0),
            cargo_envio_barrial: Number(p.cargo_envio_barrial || 0),
            total_vecino: Number(p.total_vecino || 0),
            total_base_lamda: Number(p.total_base_lamda || 0),
            total_articulos_distintos: itemsVecino.length,
            total_unidades_vecino: totalUnidadesVecino,
            items: itemsVecino
        };
        if (incluirLogo) {
            entry.logo_original_base64 = p.logo_original_base64 || '';
            entry.logo_mono_preview_base64 = p.logo_mono_preview_base64 || '';
        }
        resultado[p.codigo_pedido] = entry;
    }
    return resultado;
}

/**
 * Anula de forma determinista un pedido vecinal mientras se encuentre en etapas previas
 * al despacho/entrega física (H1 CONFIRMADO_VECINO, H2 EN_PREPARACION, H3 ARMADO_EN_CANASTO):
 * - Acredita la anulación en `nodos_vecinos_movimientos_cc` dejando saldado el cargo del pedido.
 * - Si el pedido ya tenía una transferencia conciliada en Banco LAMDA, revierte determinísticamente
 *   el crédito en `CB-NODO-xxx` (DEBITO por reversión) y registra el reintegro en la subcuenta del vecino
 *   (salvo que se indique explícitamente `devolver_pago_conciliado: false` únicamente para registro interno,
 *   aunque por regla contable del lote se revierte en `CB-NODO-xxx` para no desfasar el cierre del canasto).
 * - Desactiva su fila espejo en `public.presupuestos` y recalcula los totales del canasto en `nodos_lotes_estacion`.
 */
async function anularPedidoVecinoNodo(pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const motivo = String(payload.motivo || 'Anulación solicitada antes de despacho al Nodo').trim();

    const client = await db.connect();
    let nodoIdRef = null;
    let vecinoIdRef = null;
    try {
        await client.query('BEGIN');

        const pedRes = await client.query(
            `SELECT npv.*,
                    nm.nombre_marca, nm.gestor_nombre, nm.codigo_bunker_cliente,
                    nm.cliente_madre_bunker_id, nm.codigo_bunker_cliente_madre,
                    COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada,
                    nle.codigo_canasto, nle.estado_canasto, nle.debito_cta_cte_registrado, nle.liquidacion_cerrada
             FROM public.nodos_pedidos_vecinos npv
             JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
             LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
             WHERE npv.id = $1::int
             FOR UPDATE OF npv`,
            [Number(pedidoId)]
        );
        if (pedRes.rows.length === 0) {
            throw new Error('Pedido vecinal no encontrado.');
        }
        const ped = pedRes.rows[0];
        nodoIdRef = Number(ped.nodo_id);
        vecinoIdRef = ped.vecino_id ? Number(ped.vecino_id) : null;

        const estadoOp = String(ped.estado_operativo || '').toUpperCase();
        if (estadoOp === 'ANULADO') {
            throw new Error(`El pedido #${ped.codigo_pedido} ya se encuentra ANULADO.`);
        }
        if (ped.liquidacion_cerrada) {
            throw new Error(`No se puede anular el pedido #${ped.codigo_pedido} porque la liquidación del lote ${ped.codigo_canasto} ya está cerrada.`);
        }
        if (['EN_PODER_GESTOR', 'EN_CAMINO_VECINO', 'ENTREGADO_VECINO'].includes(estadoOp) || ped.debito_cta_cte_registrado) {
            throw new Error(`El pedido #${ped.codigo_pedido} ya fue despachado al Nodo (${estadoOp}). Para diferencias posteriores al despacho utilice Nota de Crédito / Ajuste.`);
        }

        const montoVigente = Number(ped.total_vecino || 0);
        const estabaPagado = Boolean(ped.impactado_cta_cte_pago) ||
            ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(ped.estado_pago || '').toUpperCase());
        const eraTransferencia = String(ped.medio_pago || '').toUpperCase() === 'TRANSFERENCIA' ||
            String(ped.estado_pago || '').toUpperCase() === 'CONCILIADO_BANCO_LAMDA';

        // 1) Revertir en Subcuenta del Vecino
        if (vecinoIdRef && montoVigente > 0) {
            await client.query(
                `INSERT INTO public.nodos_vecinos_movimientos_cc (
                    nodo_id, vecino_id, pedido_vecino_id, lote_canasto_id,
                    tipo_movimiento, naturaleza, monto, saldo_resultante,
                    medio_pago, concepto, referencia_externa
                 ) VALUES ($1, $2, $3, $4, 'CREDITO_ANULACION_PEDIDO', 'CREDITO', $5, 0, $6, $7, $8)`,
                [
                    ped.nodo_id,
                    vecinoIdRef,
                    ped.id,
                    ped.lote_canasto_id || null,
                    montoVigente,
                    ped.medio_pago || 'TRANSFERENCIA',
                    `Anulación Pedido #${ped.codigo_pedido}: ${motivo}`,
                    ped.codigo_pedido
                ]
            );

            if (estabaPagado) {
                await client.query(
                    `INSERT INTO public.nodos_vecinos_movimientos_cc (
                        nodo_id, vecino_id, pedido_vecino_id, lote_canasto_id,
                        tipo_movimiento, naturaleza, monto, saldo_resultante,
                        medio_pago, concepto, referencia_externa
                     ) VALUES ($1, $2, $3, $4, 'DEBITO_REINTEGRO_PAGO_ANULADO', 'DEBITO', $5, 0, $6, $7, $8)`,
                    [
                        ped.nodo_id,
                        vecinoIdRef,
                        ped.id,
                        ped.lote_canasto_id || null,
                        montoVigente,
                        ped.medio_pago || 'TRANSFERENCIA',
                        `Reintegro / reversión de cobro por anulación de Pedido #${ped.codigo_pedido}`,
                        ped.codigo_pedido
                    ]
                );
            }

            await recalcularSaldoSubcuentaVecino(client, vecinoIdRef);
        }

        // 2) Si tenía transferencia conciliada en Banco LAMDA, revertir el CREDITO en Cuenta Operativa (Madre Unificada o CB-NODO-xxx) con un DEBITO espejo
        const destCc = await resolverCuentaContableOperativaNodo(client, ped);
        if (estabaPagado && eraTransferencia && destCc.ccId && montoVigente > 0) {
            const ccId = destCc.ccId;
            let saldoNodoPost = 0;
            const descBaseRev = `Reversión de transferencia por anulación de Pedido #${ped.codigo_pedido} (${ped.vecino_nombre}) — ${motivo}`;
            const descRev = destCc.usaCuentaMadreUnificada
                ? agregarReferenciaNodoADescripcion(descBaseRev, ped.nombre_marca)
                : descBaseRev;
            await client.query(
                `INSERT INTO public.factura_cuenta_corriente_movimientos (
                    cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                    tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                    creado_en, metadatos
                 ) VALUES ($1, 'DEBITO', $2, 0, 'REVERSION_TRANSFERENCIA_ANULADA_NODO', NULL, $3, NOW(), NOW(), $4)`,
                [
                    ccId,
                    montoVigente,
                    descRev,
                    JSON.stringify({
                        pedido_id: ped.id,
                        codigo_pedido: ped.codigo_pedido,
                        nodo_id: ped.nodo_id,
                        nodo_marca: ped.nombre_marca || null,
                        usa_cuenta_madre_unificada: destCc.usaCuentaMadreUnificada,
                        vecino_nombre: ped.vecino_nombre,
                        motivo
                    })
                ]
            );
            saldoNodoPost = await recalcularSaldosCuentaMadreBunker(client, ccId);

            await client.query(
                `INSERT INTO public.nodos_movimientos_cta_cte (
                    nodo_id, lote_canasto_id, pedido_vecino_id, tipo_movimiento, signo,
                    monto, saldo_resultante, concepto, referencia_externa
                 ) VALUES ($1, $2, $3, 'DEBITO_REVERSION_PAGO_ANULADO', 1, $4, $5, $6, $7)`,
                [
                    ped.nodo_id,
                    ped.lote_canasto_id || null,
                    ped.id,
                    montoVigente,
                    saldoNodoPost,
                    `Reversión de transferencia conciliada por anulación de #${ped.codigo_pedido} (${ped.vecino_nombre})`,
                    ped.codigo_pedido
                ]
            );
        } else if (estabaPagado && !eraTransferencia) {
            // Si había sido marcado efectivo en mano antes de despacho, dejar constancia neutra
            await client.query(
                `INSERT INTO public.nodos_movimientos_cta_cte (
                    nodo_id, lote_canasto_id, pedido_vecino_id, tipo_movimiento, signo,
                    monto, saldo_resultante, concepto, referencia_externa
                 ) VALUES ($1, $2, $3, 'ANULACION_COBRO_EFECTIVO', 0, $4, 0, $5, $6)`,
                [
                    ped.nodo_id,
                    ped.lote_canasto_id || null,
                    ped.id,
                    montoVigente,
                    `Baja de cobro efectivo por anulación de Pedido #${ped.codigo_pedido} (${ped.vecino_nombre})`,
                    ped.codigo_pedido
                ]
            );
        }

        // 3) Marcar pedido como ANULADO y desactivar presupuesto espejo en circuito LAMDA
        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_operativo = 'ANULADO',
                 estado_pago = $1,
                 impactado_cta_cte_pago = false,
                 motivo_anulacion_ajuste = $2,
                 fecha_anulacion = NOW(),
                 updated_at = NOW()
             WHERE id = $3::int`,
            [estabaPagado ? 'ANULADO_REVERTIDO' : 'ANULADO', motivo, ped.id]
        );

        await client.query(
            `UPDATE public.presupuestos
             SET activo = false,
                 archivado = true,
                 estado = 'Anulado'
             WHERE id_presupuesto_ext = $1 OR ($2::int IS NOT NULL AND id = $2::int)`,
            [ped.codigo_pedido, ped.presupuesto_id_local || null]
        );

        await sincronizarCanastosEstacionNodos(client);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    return {
        ok: true,
        nodo_id: nodoIdRef,
        vecino_id: vecinoIdRef,
        tablero: await obtenerTableroLiquidacionCobros({ nodo_id: nodoIdRef || 0 })
    };
}

/**
 * Aplica una Nota de Crédito parcial sobre un pedido vecinal (por faltante parcial o ajuste de precio)
 * antes del cierre de liquidación del lote:
 * - Reduce determinísticamente `total_vecino`, `total_base_lamda` (proporcional o explícito) y `ganancia_total_gestor`.
 * - Asienta `CREDITO_NOTA_CREDITO` en `nodos_vecinos_movimientos_cc`.
 * - Si el pedido ya tenía transferencia conciliada, ajusta el excedente en `CB-NODO-xxx` y registra el reintegro.
 * - Si el lote ya había sido retirado (`debito_cta_cte_registrado`), acredita la reducción de Costo Base en `CB-NODO-xxx`.
 */
async function aplicarNotaCreditoPedidoVecino(pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const montoCredito = Number(Number(payload.monto_credito_vecino || payload.monto || 0).toFixed(2));
    const motivo = String(payload.motivo || 'Ajuste / Nota de Crédito por faltante parcial').trim();

    if (!(montoCredito > 0)) {
        throw new Error('Ingrese un monto de Nota de Crédito mayor a $0.');
    }

    const client = await db.connect();
    let nodoIdRef = null;
    let vecinoIdRef = null;
    try {
        await client.query('BEGIN');

        const pedRes = await client.query(
            `SELECT npv.*,
                    nm.nombre_marca, nm.gestor_nombre, nm.codigo_bunker_cliente,
                    COALESCE(nm.alicuota_iva_margen_pct, 21.00) AS nodo_alicuota_iva_margen_pct,
                    COALESCE(nm.alicuota_iibb_margen_pct, 4.00) AS nodo_alicuota_iibb_margen_pct,
                    nm.cliente_madre_bunker_id, nm.codigo_bunker_cliente_madre,
                    COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada,
                    nle.codigo_canasto,
                    COALESCE(nle.debito_cta_cte_registrado, npv.debito_cta_cte_registrado, false) AS lote_o_ped_debito_registrado,
                    nle.liquidacion_cerrada
             FROM public.nodos_pedidos_vecinos npv
             JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
             LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
             WHERE npv.id = $1::int
             FOR UPDATE OF npv`,
            [Number(pedidoId)]
        );
        if (pedRes.rows.length === 0) {
            throw new Error('Pedido vecinal no encontrado.');
        }
        const ped = pedRes.rows[0];
        nodoIdRef = Number(ped.nodo_id);
        vecinoIdRef = ped.vecino_id ? Number(ped.vecino_id) : null;

        if (String(ped.estado_operativo || '').toUpperCase() === 'ANULADO') {
            throw new Error(`El pedido #${ped.codigo_pedido} está ANULADO.`);
        }
        if (ped.liquidacion_cerrada || ped.liquidacion_id) {
            throw new Error(`La liquidación del pedido #${ped.codigo_pedido} ya se encuentra cerrada.`);
        }

        const totalActualVecino = Number(ped.total_vecino || 0);
        if (montoCredito >= totalActualVecino) {
            throw new Error(`El monto de la Nota de Crédito ($${montoCredito.toLocaleString('es-AR')}) cubre el total del pedido ($${totalActualVecino.toLocaleString('es-AR')}). Utilice la opción "Anular Pedido" para dar de baja el pedido completo.`);
        }

        const rawRedBase = payload.monto_reduccion_base_lamda ?? payload.monto_credito_base_lamda;
        const totalBaseActual = Number(ped.total_base_lamda || 0);
        const proporcionBase = totalActualVecino > 0 ? (totalBaseActual / totalActualVecino) : 0;
        const reduccionBase = rawRedBase !== undefined && rawRedBase !== null && rawRedBase !== ''
            ? Math.min(totalBaseActual, Math.max(0, Number(Number(rawRedBase).toFixed(2))))
            : Math.min(totalBaseActual, Number((montoCredito * proporcionBase).toFixed(2)));

        const nuevoTotalVecino = Number((totalActualVecino - montoCredito).toFixed(2));
        const nuevoSubtotalProd = Math.max(0, Number((Number(ped.subtotal_productos_vecino || totalActualVecino) - montoCredito).toFixed(2)));
        const nuevoTotalBase = Math.max(0, Number((totalBaseActual - reduccionBase).toFixed(2)));

        const ivaNcPct = normalizarAlicuotaFiscalNodo(ped.alicuota_iva_margen_pct ?? ped.nodo_alicuota_iva_margen_pct, 21);
        const iibbNcPct = normalizarAlicuotaFiscalNodo(ped.alicuota_iibb_margen_pct ?? ped.nodo_alicuota_iibb_margen_pct, 4);
        const retFiscalPrev = Number(ped.retencion_fiscal_margen || 0);
        const tramoNc = desglosarRetencionFiscalExcedente(Math.max(0, nuevoSubtotalProd - nuevoTotalBase), ivaNcPct, iibbNcPct);
        const reduccionRetFiscal = Math.max(0, Number((retFiscalPrev - tramoNc.retencion_fiscal_total).toFixed(2)));
        const creditoOperativoLamda = Number((reduccionBase + reduccionRetFiscal).toFixed(2));

        const esPedPostalNc = String(ped.modalidad_entrega || '').toUpperCase() === 'ENVIO_POSTAL';
        const fletePostalActual = Number(ped.costo_flete_lamda || 0);
        const nuevaGanancia = esPedPostalNc
            ? Number((nuevoTotalVecino - nuevoTotalBase - tramoNc.retencion_fiscal_total - fletePostalActual).toFixed(2))
            : Number((tramoNc.ganancia_neta + Number(ped.cargo_envio_barrial || 0)).toFixed(2));

        const estabaPagado = Boolean(ped.impactado_cta_cte_pago) ||
            ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(ped.estado_pago || '').toUpperCase());
        const eraTransferencia = String(ped.medio_pago || '').toUpperCase() === 'TRANSFERENCIA' ||
            String(ped.estado_pago || '').toUpperCase() === 'CONCILIADO_BANCO_LAMDA';

        // 1) Asentar Nota de Crédito en Subcuenta del Vecino
        if (vecinoIdRef) {
            await client.query(
                `INSERT INTO public.nodos_vecinos_movimientos_cc (
                    nodo_id, vecino_id, pedido_vecino_id, lote_canasto_id,
                    tipo_movimiento, naturaleza, monto, saldo_resultante,
                    medio_pago, concepto, referencia_externa
                 ) VALUES ($1, $2, $3, $4, 'CREDITO_NOTA_CREDITO', 'CREDITO', $5, 0, $6, $7, $8)`,
                [
                    ped.nodo_id,
                    vecinoIdRef,
                    ped.id,
                    ped.lote_canasto_id || null,
                    montoCredito,
                    ped.medio_pago || 'TRANSFERENCIA',
                    `Nota de Crédito Pedido #${ped.codigo_pedido}: ${motivo}`,
                    ped.codigo_pedido
                ]
            );

            if (estabaPagado && payload.dejar_saldo_a_favor_vecino !== true) {
                await client.query(
                    `INSERT INTO public.nodos_vecinos_movimientos_cc (
                        nodo_id, vecino_id, pedido_vecino_id, lote_canasto_id,
                        tipo_movimiento, naturaleza, monto, saldo_resultante,
                        medio_pago, concepto, referencia_externa
                     ) VALUES ($1, $2, $3, $4, 'DEBITO_REINTEGRO_NOTA_CREDITO', 'DEBITO', $5, 0, $6, $7, $8)`,
                    [
                        ped.nodo_id,
                        vecinoIdRef,
                        ped.id,
                        ped.lote_canasto_id || null,
                        montoCredito,
                        ped.medio_pago || 'TRANSFERENCIA',
                        `Reintegro de diferencia abonada al vecino por Nota de Crédito #${ped.codigo_pedido}`,
                        ped.codigo_pedido
                    ]
                );
            }
            await recalcularSaldoSubcuentaVecino(client, vecinoIdRef);
        }

        // 2) Ajustes en Cuenta Operativa del Nodo (Cuenta Madre Unificada o subcuenta CB-NODO-xxx)
        const destCc = await resolverCuentaContableOperativaNodo(client, ped);
        if (destCc.ccId) {
            const ccId = destCc.ccId;

            if (estabaPagado && eraTransferencia && payload.dejar_saldo_a_favor_vecino !== true) {
                const descBaseNcTrf = `Reintegro parcial de transferencia por Nota de Crédito en #${ped.codigo_pedido} (${ped.vecino_nombre}) — ${motivo}`;
                const descNcTrf = destCc.usaCuentaMadreUnificada
                    ? agregarReferenciaNodoADescripcion(descBaseNcTrf, ped.nombre_marca)
                    : descBaseNcTrf;
                await client.query(
                    `INSERT INTO public.factura_cuenta_corriente_movimientos (
                        cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                        tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                        creado_en, metadatos
                     ) VALUES ($1, 'DEBITO', $2, 0, 'REVERSION_TRANSFERENCIA_ANULADA_NODO', NULL, $3, NOW(), NOW(), $4)`,
                    [
                        ccId,
                        montoCredito,
                        descNcTrf,
                        JSON.stringify({
                            pedido_id: ped.id,
                            codigo_pedido: ped.codigo_pedido,
                            nodo_id: ped.nodo_id,
                            nodo_marca: ped.nombre_marca || null,
                            usa_cuenta_madre_unificada: destCc.usaCuentaMadreUnificada,
                            monto_credito: montoCredito,
                            motivo
                        })
                    ]
                );
                const sPost = await recalcularSaldosCuentaMadreBunker(client, ccId);
                await client.query(
                    `INSERT INTO public.nodos_movimientos_cta_cte (
                        nodo_id, lote_canasto_id, pedido_vecino_id, tipo_movimiento, signo,
                        monto, saldo_resultante, concepto, referencia_externa
                     ) VALUES ($1, $2, $3, 'DEBITO_REINTEGRO_NOTA_CREDITO', 1, $4, $5, $6, $7)`,
                    [
                        ped.nodo_id,
                        ped.lote_canasto_id || null,
                        ped.id,
                        montoCredito,
                        sPost,
                        `Ajuste de transferencia por Nota de Crédito #${ped.codigo_pedido} (${ped.vecino_nombre})`,
                        ped.codigo_pedido
                    ]
                );
            }

            if (ped.lote_o_ped_debito_registrado && creditoOperativoLamda > 0) {
                const descBaseNcLote = `Nota de Crédito Costo Base + Ret. Fiscal LAMDA en ${ped.codigo_canasto || 'Fulfillment'} (Pedido #${ped.codigo_pedido}) — ${motivo}`;
                const descNcLote = destCc.usaCuentaMadreUnificada
                    ? agregarReferenciaNodoADescripcion(descBaseNcLote, ped.nombre_marca)
                    : descBaseNcLote;
                await client.query(
                    `INSERT INTO public.factura_cuenta_corriente_movimientos (
                        cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                        tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                        creado_en, metadatos
                     ) VALUES ($1, 'CREDITO', $2, 0, 'NOTA_CREDITO_CANASTO_NODO', NULL, $3, NOW(), NOW(), $4)`,
                    [
                        ccId,
                        creditoOperativoLamda,
                        descNcLote,
                        JSON.stringify({
                            pedido_id: ped.id,
                            codigo_pedido: ped.codigo_pedido,
                            nodo_id: ped.nodo_id,
                            nodo_marca: ped.nombre_marca || null,
                            usa_cuenta_madre_unificada: destCc.usaCuentaMadreUnificada,
                            reduccion_base: reduccionBase,
                            reduccion_retencion_fiscal: reduccionRetFiscal,
                            credito_operativo_lamda: creditoOperativoLamda,
                            motivo
                        })
                    ]
                );
                const sPostBase = await recalcularSaldosCuentaMadreBunker(client, ccId);
                await client.query(
                    `INSERT INTO public.nodos_movimientos_cta_cte (
                        nodo_id, lote_canasto_id, pedido_vecino_id, tipo_movimiento, signo,
                        monto, saldo_resultante, concepto, referencia_externa
                     ) VALUES ($1, $2, $3, 'CREDITO_AJUSTE_BASE_LOTE', -1, $4, $5, $6, $7)`,
                    [
                        ped.nodo_id,
                        ped.lote_canasto_id || null,
                        ped.id,
                        creditoOperativoLamda,
                        sPostBase,
                        `Bonificación de Costo Base y Ret. Fiscal en ${ped.codigo_canasto || 'Fulfillment'} por Nota de Crédito #${ped.codigo_pedido}`,
                        ped.codigo_pedido
                    ]
                );
            }
        }

        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET subtotal_productos_vecino = $1,
                 total_vecino = $2,
                 total_base_lamda = $3,
                 ganancia_total_gestor = $4,
                 monto_ajuste_credito = COALESCE(monto_ajuste_credito, 0) + $5,
                 motivo_anulacion_ajuste = $6,
                 retencion_iva_margen = $8,
                 retencion_iibb_margen = $9,
                 retencion_fiscal_margen = $10,
                 updated_at = NOW()
             WHERE id = $7::int`,
            [
                nuevoSubtotalProd,
                nuevoTotalVecino,
                nuevoTotalBase,
                nuevaGanancia,
                montoCredito,
                motivo,
                ped.id,
                tramoNc.iva_excedente,
                tramoNc.iibb_excedente,
                tramoNc.retencion_fiscal_total
            ]
        );

        await sincronizarCanastosEstacionNodos(client);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    return {
        ok: true,
        nodo_id: nodoIdRef,
        vecino_id: vecinoIdRef,
        tablero: await obtenerTableroLiquidacionCobros({ nodo_id: nodoIdRef || 0 })
    };
}

/**
 * Devuelve la estructura completa en Árbol de un Nodo para `Clientes Búnker`:
 * - Datos del Nodo + Vínculo con Cuenta Personal/Madre (ej: CB-0006)
 * - Cuadratura contable en vivo (Saldo CB-NODO-xxx vs Subcuentas de Vecinos vs Efectivo en Gestor)
 * - Padrón completo de vecinos compradores con subcuenta, historial resumido y pedidos pendientes de cobro
 */
async function obtenerArbolNodoClientesBunker(bunkerClienteIdOrNodoId, opciones = {}) {
    await asegurarEsquemaNodosBarriales();

    const rawParam = String(bunkerClienteIdOrNodoId || '').trim();
    const searchTerm = String(opciones.search || '').trim().toLowerCase();
    const searchDigits = normalizarTelefonoVecinoNodo(searchTerm) || searchTerm.replace(/\D+/g, '');

    let nodoRes;
    if (/^(CB-|NODO-)/i.test(rawParam)) {
        nodoRes = await db.query(
            `SELECT nm.*,
                    COALESCE(cc.id, 0) AS cuenta_corriente_nodo_id,
                    COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente,
                    bc_madre.cliente_nombre AS cliente_madre_nombre,
                    bc_madre.razon_social AS cliente_madre_razon_social,
                    COALESCE(cc_madre.id, 0) AS cuenta_corriente_madre_id,
                    COALESCE(cc_madre.saldo, 0)::numeric(14,2) AS saldo_cuenta_madre
             FROM public.nodos_maestro nm
             LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
             LEFT JOIN public.bunker_clientes bc_madre ON bc_madre.id = nm.cliente_madre_bunker_id
             LEFT JOIN public.factura_cuentas_corrientes cc_madre
               ON cc_madre.codigo_bunker_cliente = nm.codigo_bunker_cliente_madre
              AND COALESCE(cc_madre.estado, 'ACTIVA') <> 'ARCHIVADA_UNIFICADA'
             WHERE UPPER(nm.codigo_bunker_cliente) = UPPER($1)
                OR UPPER(nm.codigo_nodo) = UPPER($1)
                OR (
                    COALESCE(nm.usar_cuenta_madre_unificada, false) = true
                    AND UPPER(COALESCE(nm.codigo_bunker_cliente_madre, '')) = UPPER($1)
                )
             ORDER BY
                CASE
                    WHEN UPPER(nm.codigo_bunker_cliente) = UPPER($1) OR UPPER(nm.codigo_nodo) = UPPER($1) THEN 0
                    ELSE 1
                END ASC,
                CASE WHEN cc_madre.nombre_cuenta = 'Cuenta Principal' THEN 0 ELSE 1 END ASC,
                nm.id ASC
             LIMIT 1`,
            [rawParam]
        );
    } else {
        const numId = Number(rawParam);
        if (!Number.isFinite(numId) || numId <= 0) {
            throw new Error('Identificador de Nodo inválido.');
        }
        nodoRes = await db.query(
            `SELECT nm.*,
                    COALESCE(cc.id, 0) AS cuenta_corriente_nodo_id,
                    COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente,
                    bc_madre.cliente_nombre AS cliente_madre_nombre,
                    bc_madre.razon_social AS cliente_madre_razon_social,
                    COALESCE(cc_madre.id, 0) AS cuenta_corriente_madre_id,
                    COALESCE(cc_madre.saldo, 0)::numeric(14,2) AS saldo_cuenta_madre
             FROM public.nodos_maestro nm
             LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
             LEFT JOIN public.bunker_clientes bc_madre ON bc_madre.id = nm.cliente_madre_bunker_id
             LEFT JOIN public.factura_cuentas_corrientes cc_madre
               ON cc_madre.codigo_bunker_cliente = nm.codigo_bunker_cliente_madre
              AND COALESCE(cc_madre.estado, 'ACTIVA') <> 'ARCHIVADA_UNIFICADA'
             WHERE (
                    $2::boolean = false
                    AND (
                        nm.bunker_cliente_id = $1::int
                        OR (COALESCE(nm.usar_cuenta_madre_unificada, false) = true AND nm.cliente_madre_bunker_id = $1::int)
                    )
                 )
                OR nm.id = $1::int
             ORDER BY
                CASE
                    WHEN $2::boolean = false AND nm.bunker_cliente_id = $1::int THEN 0
                    WHEN $2::boolean = false AND COALESCE(nm.usar_cuenta_madre_unificada, false) = true AND nm.cliente_madre_bunker_id = $1::int THEN 1
                    ELSE 2
                END ASC,
                CASE WHEN cc_madre.nombre_cuenta = 'Cuenta Principal' THEN 0 ELSE 1 END ASC,
                nm.id ASC
             LIMIT 1`,
            [numId, Boolean(opciones.porNodoId)]
        );
    }

    if (nodoRes.rows.length === 0) {
        throw new Error('No se encontró un Nodo Barrial vinculado a este cliente.');
    }
    const nRow = nodoRes.rows[0];
    const nodoId = Number(nRow.id);

    const [vecinosRes, pedidosRes, lotesRes, aliasRes] = await Promise.all([
        db.query(
            `SELECT *
             FROM public.nodos_vecinos
             WHERE nodo_id = $1::int
               AND COALESCE(activo, true) = true
             ORDER BY nombre_completo ASC, id ASC`,
            [nodoId]
        ),
        db.query(
            `SELECT npv.*, nle.codigo_canasto, nle.liquidacion_cerrada
             FROM public.nodos_pedidos_vecinos npv
             LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
             WHERE npv.nodo_id = $1::int
             ORDER BY npv.id DESC`,
            [nodoId]
        ),
        db.query(
            `SELECT *
             FROM public.nodos_lotes_estacion
             WHERE nodo_id = $1::int
             ORDER BY id DESC`,
            [nodoId]
        ),
        db.query(
            `SELECT *
             FROM public.nodos_alias_vecinos_aprendidos
             WHERE nodo_id = $1::int
             ORDER BY usos_confirmados DESC, updated_at DESC`,
            [nodoId]
        )
    ]);

    const pedsPorVecino = new Map();
    const pedsPorCanasto = new Map();
    for (const p of pedidosRes.rows) {
        const esAnulado = String(p.estado_operativo || '').toUpperCase() === 'ANULADO';
        const pagoConfirmado = !esAnulado && (
            Boolean(p.impactado_cta_cte_pago) ||
            ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(p.estado_pago || '').toUpperCase())
        );
        const enriched = {
            ...p,
            anulado: esAnulado,
            pago_confirmado: pagoConfirmado
        };
        if (p.vecino_id) {
            const vid = Number(p.vecino_id);
            if (!pedsPorVecino.has(vid)) pedsPorVecino.set(vid, []);
            pedsPorVecino.get(vid).push(enriched);
        }
        if (p.lote_canasto_id) {
            const cid = Number(p.lote_canasto_id);
            if (!pedsPorCanasto.has(cid)) pedsPorCanasto.set(cid, []);
            pedsPorCanasto.get(cid).push(enriched);
        }
    }

    const aliasPorVecino = new Map();
    for (const al of aliasRes.rows) {
        if (al.vecino_id) {
            const vid = Number(al.vecino_id);
            if (!aliasPorVecino.has(vid)) aliasPorVecino.set(vid, []);
            aliasPorVecino.get(vid).push(al);
        }
    }

    let totalSubcuentasVecinos = 0;
    let vecinosConSaldoPendiente = 0;
    let vecinosConSaldoAFavor = 0;

    const vecinosArbol = vecinosRes.rows.map(v => {
        const vid = Number(v.id);
        const codVec = v.codigo_vecino || formatearCodigoVecinoNodo(nodoId, vid);
        const saldoVec = Number(Number(v.saldo_actual || 0).toFixed(2));
        totalSubcuentasVecinos += saldoVec;
        if (saldoVec > 0.01) vecinosConSaldoPendiente++;
        else if (saldoVec < -0.01) vecinosConSaldoAFavor++;

        const peds = pedsPorVecino.get(vid) || [];
        const pedsActivos = peds.filter(x => !x.anulado);
        const pedsAnulados = peds.filter(x => x.anulado);
        const pedsPendientesPago = pedsActivos.filter(x => !x.pago_confirmado);
        const totalComprado = pedsActivos.reduce((acc, x) => acc + Number(x.total_vecino || 0), 0);
        const ultimoPed = pedsActivos[0] || peds[0] || null;
        const aliasList = aliasPorVecino.get(vid) || [];
        const titularHab = v.titular_transferencia_habitual || (aliasList[0] ? aliasList[0].titular_normalizado : '');

        let coincideBusqueda = false;
        if (searchTerm) {
            const bolsaVec = `${codVec} ${v.nombre_completo || ''} ${v.telefono_whatsapp || ''} ${v.telefono_normalizado || ''} ${titularHab} ${v.direccion_calle || ''}`.toLowerCase();
            if (bolsaVec.includes(searchTerm) || (searchDigits.length >= 4 && String(v.telefono_normalizado || '').includes(searchDigits))) {
                coincideBusqueda = true;
            }
        }

        return {
            id: vid,
            codigo_vecino: codVec,
            portal_token: v.portal_token || null,
            nombre_completo: v.nombre_completo,
            telefono_whatsapp: v.telefono_whatsapp,
            telefono_normalizado: v.telefono_normalizado || normalizarTelefonoVecinoNodo(v.telefono_whatsapp),
            direccion_calle: v.direccion_calle || '',
            entrecalles_referencia: v.entrecalles_referencia || '',
            titular_habitual: titularHab,
            saldo_actual: saldoVec,
            cantidad_pedidos_activos: pedsActivos.length,
            cantidad_pedidos_anulados: pedsAnulados.length,
            total_comprado: Number(totalComprado.toFixed(2)),
            coincide_busqueda: coincideBusqueda,
            ultimo_pedido: ultimoPed ? {
                id: Number(ultimoPed.id),
                codigo_pedido: ultimoPed.codigo_pedido,
                fecha_entrega_label: ultimoPed.fecha_entrega_label,
                modalidad_entrega: ultimoPed.modalidad_entrega,
                medio_pago: ultimoPed.medio_pago,
                estado_pago: ultimoPed.estado_pago,
                estado_operativo: ultimoPed.estado_operativo,
                total_vecino: Number(ultimoPed.total_vecino || 0),
                pago_confirmado: Boolean(ultimoPed.pago_confirmado),
                anulado: Boolean(ultimoPed.anulado)
            } : null,
            pedidos_pendientes_pago: pedsPendientesPago.map(pp => ({
                id: Number(pp.id),
                codigo_pedido: pp.codigo_pedido,
                medio_pago: pp.medio_pago,
                estado_pago: pp.estado_pago,
                estado_operativo: pp.estado_operativo,
                total_vecino: Number(pp.total_vecino || 0),
                fecha_entrega_label: pp.fecha_entrega_label
            }))
        };
    });

    let efectivoManoGestorAbiertos = 0;
    let transferenciasLamdaAbiertos = 0;
    let costoBaseDespachadoAbiertos = 0;
    let gananciaGestorAbiertos = 0;

    const lotesResumen = lotesRes.rows.map(l => {
        const cuadro = calcularCuadroLiquidacionCanasto(l, pedsPorCanasto.get(Number(l.id)) || []);
        if (!l.liquidacion_cerrada) {
            efectivoManoGestorAbiertos += Number(cuadro.efectivo_cobrado_mano_gestor || 0);
            transferenciasLamdaAbiertos += Number(cuadro.transferencias_conciliadas_lamda || 0);
            if (l.debito_cta_cte_registrado) {
                costoBaseDespachadoAbiertos += Number(cuadro.total_base_lamda || 0);
            }
            gananciaGestorAbiertos += Number(cuadro.ganancia_neta_gestor || 0);
        }
        return {
            id: Number(l.id),
            codigo_canasto: l.codigo_canasto,
            fecha_entrega_label: l.fecha_entrega_label,
            estado_canasto: l.estado_canasto,
            debito_cta_cte_registrado: Boolean(l.debito_cta_cte_registrado),
            liquidacion_cerrada: Boolean(l.liquidacion_cerrada),
            total_bolsas: Number(l.total_bolsas || 0),
            cuadro_liquidacion: cuadro
        };
    });

    const usaMadreUnificada = Boolean(nRow.usar_cuenta_madre_unificada && nRow.codigo_bunker_cliente_madre);
    const saldoOperativoCc = usaMadreUnificada
        ? Number(Number(nRow.saldo_cuenta_madre || 0).toFixed(2))
        : Number(Number(nRow.saldo_cuenta_corriente || 0).toFixed(2));
    const codigoCuentaOperativa = usaMadreUnificada
        ? nRow.codigo_bunker_cliente_madre
        : nRow.codigo_bunker_cliente;

    return {
        nodo: {
            id: nodoId,
            codigo_nodo: nRow.codigo_nodo,
            slug: nRow.slug,
            nombre_marca: nRow.nombre_marca,
            subtitulo_marca: nRow.subtitulo_marca || '',
            gestor_nombre: nRow.gestor_nombre,
            gestor_telefono: nRow.gestor_telefono || '',
            barrio_zona: nRow.barrio_zona || '',
            direccion_retiro: nRow.direccion_retiro || '',
            color_primario: nRow.color_primario || '#16a34a',
            usar_cuenta_madre_unificada: usaMadreUnificada,
            codigo_cuenta_operativa: codigoCuentaOperativa,
            bunker_cliente_id: nRow.bunker_cliente_id ? Number(nRow.bunker_cliente_id) : null,
            codigo_bunker_cliente: nRow.codigo_bunker_cliente,
            cuenta_corriente_nodo_id: Number(nRow.cuenta_corriente_nodo_id || 0) || null,
            saldo_cuenta_corriente: saldoOperativoCc,
            cliente_madre_bunker_id: nRow.cliente_madre_bunker_id ? Number(nRow.cliente_madre_bunker_id) : null,
            codigo_bunker_cliente_madre: nRow.codigo_bunker_cliente_madre || null,
            cliente_madre_nombre: nRow.cliente_madre_razon_social || nRow.cliente_madre_nombre || null,
            cuenta_corriente_madre_id: Number(nRow.cuenta_corriente_madre_id || 0) || null,
            saldo_cuenta_madre: nRow.codigo_bunker_cliente_madre ? Number(Number(nRow.saldo_cuenta_madre || 0).toFixed(2)) : null
        },
        cuadratura: {
            saldo_cc_nodo_lamda: saldoOperativoCc,
            total_subcuentas_vecinos: Number(totalSubcuentasVecinos.toFixed(2)),
            vecinos_totales: vecinosArbol.length,
            vecinos_con_saldo_pendiente: vecinosConSaldoPendiente,
            vecinos_con_saldo_a_favor: vecinosConSaldoAFavor,
            efectivo_en_mano_gestor_lotes_abiertos: Number(efectivoManoGestorAbiertos.toFixed(2)),
            transferencias_en_lamda_lotes_abiertos: Number(transferenciasLamdaAbiertos.toFixed(2)),
            costo_base_despachado_lotes_abiertos: Number(costoBaseDespachadoAbiertos.toFixed(2)),
            ganancia_gestor_lotes_abiertos: Number(gananciaGestorAbiertos.toFixed(2))
        },
        lotes_resumen: lotesResumen,
        vecinos: vecinosArbol
    };
}

/**
 * Devuelve la ficha integral de la Subcuenta de un Vecino del Nodo:
 * datos canónicos, todos sus pedidos con detalle de artículos y acciones disponibles,
 * y el extracto cronológico completo de `nodos_vecinos_movimientos_cc`.
 */
async function obtenerSubcuentaVecinoDetalle(vecinoId) {
    await asegurarEsquemaNodosBarriales();

    const vid = Number(vecinoId);
    if (!Number.isFinite(vid) || vid <= 0) {
        throw new Error('ID de vecino inválido.');
    }

    const vecRes = await db.query(
        `SELECT nv.*,
                nm.codigo_nodo, nm.slug AS nodo_slug, nm.nombre_marca,
                nm.gestor_nombre, nm.codigo_bunker_cliente, nm.color_primario
         FROM public.nodos_vecinos nv
         JOIN public.nodos_maestro nm ON nm.id = nv.nodo_id
         WHERE nv.id = $1::int
         LIMIT 1`,
        [vid]
    );
    if (vecRes.rows.length === 0) {
        throw new Error('Vecino no encontrado en el padrón del Nodo.');
    }
    const v = vecRes.rows[0];

    const [pedidosRes, itemsRes, movsRes, aliasRes] = await Promise.all([
        db.query(
            `SELECT npv.*,
                    nle.codigo_canasto, nle.estado_canasto,
                    nle.debito_cta_cte_registrado, nle.liquidacion_cerrada
             FROM public.nodos_pedidos_vecinos npv
             LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
             WHERE npv.vecino_id = $1::int
             ORDER BY npv.id DESC`,
            [vid]
        ),
        db.query(
            `SELECT npi.*,
                    COALESCE(nac.sku_nodo, npi.sku_nodo) AS sku_oficial_lamda,
                    COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, npi.nombre_publico) AS nombre_oficial_lamda
             FROM public.nodos_pedidos_items npi
             JOIN public.nodos_pedidos_vecinos npv ON npv.id = npi.pedido_id
             LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
             LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(COALESCE(nac.sku_nodo, npi.sku_nodo))
             WHERE npv.vecino_id = $1::int
             ORDER BY npi.id ASC`,
            [vid]
        ),
        db.query(
            `SELECT nvm.*, npv.codigo_pedido, nle.codigo_canasto
             FROM public.nodos_vecinos_movimientos_cc nvm
             LEFT JOIN public.nodos_pedidos_vecinos npv ON npv.id = nvm.pedido_vecino_id
             LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = nvm.lote_canasto_id
             WHERE nvm.vecino_id = $1::int
             ORDER BY nvm.created_at DESC, nvm.id DESC`,
            [vid]
        ),
        db.query(
            `SELECT *
             FROM public.nodos_alias_vecinos_aprendidos
             WHERE vecino_id = $1::int
             ORDER BY usos_confirmados DESC, updated_at DESC`,
            [vid]
        )
    ]);

    const itemsPorPed = new Map();
    for (const rawIt of itemsRes.rows) {
        const pid = Number(rawIt.pedido_id);
        if (!itemsPorPed.has(pid)) itemsPorPed.set(pid, []);
        const skuOf = rawIt.sku_oficial_lamda || rawIt.sku_nodo || '';
        const nomOf = rawIt.nombre_oficial_lamda || rawIt.nombre_publico;
        itemsPorPed.get(pid).push({
            ...rawIt,
            sku_nodo: skuOf,
            nombre_oficial_lamda: nomOf,
            etiqueta_oficial_lamda: formatearEtiquetaTecnicaArticulo(skuOf, nomOf),
            nombre_publico: nomOf
        });
    }

    let totalComprado = 0;
    let totalAbonado = 0;
    const pedidos = pedidosRes.rows.map(p => {
        const esAnulado = String(p.estado_operativo || '').toUpperCase() === 'ANULADO';
        const pagoConfirmado = !esAnulado && (
            Boolean(p.impactado_cta_cte_pago) ||
            ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(p.estado_pago || '').toUpperCase())
        );
        const estOp = String(p.estado_operativo || '').toUpperCase();
        const puedeAnular = !esAnulado && !p.liquidacion_cerrada && !p.debito_cta_cte_registrado &&
            !['EN_PODER_GESTOR', 'EN_CAMINO_VECINO', 'ENTREGADO_VECINO'].includes(estOp);
        const puedeNotaCredito = !esAnulado && !p.liquidacion_cerrada && Number(p.total_vecino || 0) > 0;

        if (!esAnulado) {
            totalComprado += Number(p.total_vecino || 0);
            if (pagoConfirmado) totalAbonado += Number(p.total_vecino || 0);
        }

        return {
            ...p,
            anulado: esAnulado,
            pago_confirmado: pagoConfirmado,
            puede_anular: puedeAnular,
            puede_nota_credito: puedeNotaCredito,
            titular_sugerido: p.titular_transferencia || v.titular_transferencia_habitual || normalizarTitularBancario(v.nombre_completo),
            items: itemsPorPed.get(Number(p.id)) || []
        };
    });

    return {
        vecino: {
            id: vid,
            nodo_id: Number(v.nodo_id),
            codigo_nodo: v.codigo_nodo,
            nodo_slug: v.nodo_slug,
            nombre_marca: v.nombre_marca,
            gestor_nombre: v.gestor_nombre,
            codigo_bunker_cliente: v.codigo_bunker_cliente,
            color_primario: v.color_primario || '#16a34a',
            codigo_vecino: v.codigo_vecino || formatearCodigoVecinoNodo(v.nodo_id, vid),
            portal_token: v.portal_token || null,
            nombre_completo: v.nombre_completo,
            telefono_whatsapp: v.telefono_whatsapp,
            telefono_normalizado: v.telefono_normalizado || normalizarTelefonoVecinoNodo(v.telefono_whatsapp),
            direccion_calle: v.direccion_calle || '',
            entrecalles_referencia: v.entrecalles_referencia || '',
            notas_entrega: v.notas_entrega || '',
            titular_transferencia_habitual: v.titular_transferencia_habitual || '',
            saldo_actual: Number(Number(v.saldo_actual || 0).toFixed(2)),
            total_comprado: Number(totalComprado.toFixed(2)),
            total_abonado: Number(totalAbonado.toFixed(2)),
            titulares_aprendidos: aliasRes.rows
        },
        pedidos,
        movimientos_cc: movsRes.rows
    };
}

// ============================================================================
// ETAPA B: SEGUIMIENTO EN VIVO MARCA BLANCA Y CONTROLES DE 1 TOQUE DEL GESTOR
// ============================================================================

/**
 * Resumen público estrictamente anonimizado de proximidad durante reparto en curso.
 * Nunca expone latitud/longitud del repartidor ni datos de otros vecinos:
 * únicamente devuelve cuántas paradas faltan y un rango estimado en minutos cuando el radar está vigente (<= 4 min).
 */
async function obtenerResumenRadarParaPedidoVecino(pedidoRow) {
    const esRepartoDomicilio = pedidoRow &&
        (String(pedidoRow.modalidad_entrega || '').toUpperCase() === 'ENVIO_BARRIAL' || Boolean(pedidoRow.incluido_reparto_manual));
    if (!esRepartoDomicilio || pedidoRow.en_hoja_ruta === false) {
        return { disponible: false };
    }
    if (Boolean(pedidoRow.ausente_pasa_retirar) || String(pedidoRow.estado_operativo || '').toUpperCase() === 'ANULADO') {
        return { disponible: false };
    }
    const hito = Number(pedidoRow.hito_tracking_actual || 1);
    if (hito !== 5) {
        return { disponible: false };
    }

    const nid = Number(pedidoRow.nodo_id || 0);
    const pid = Number(pedidoRow.id || 0);
    if (!nid || !pid) return { disponible: false };

    const radRes = await db.query(
        `SELECT activo, pedido_actual_id, updated_at,
                EXTRACT(EPOCH FROM (NOW() - updated_at)) AS edad_segundos
         FROM public.nodos_reparto_radar
         WHERE nodo_id = $1::int
         LIMIT 1`,
        [nid]
    );
    const radar = radRes.rows[0];
    if (!radar || !radar.activo || Number(radar.edad_segundos || 9999) > 240) {
        return { disponible: false };
    }

    const colaRes = await db.query(
        `SELECT id, direccion_entrega, latitud, longitud
         FROM public.nodos_pedidos_vecinos
         WHERE nodo_id = $1::int
           AND (modalidad_entrega = 'ENVIO_BARRIAL' OR COALESCE(incluido_reparto_manual, false) = true)
           AND COALESCE(en_hoja_ruta, true) = true
           AND UPPER(COALESCE(estado_operativo, '')) <> 'ANULADO'
           AND COALESCE(ausente_pasa_retirar, false) = false
           AND hito_tracking_actual IN (4, 5)
         ORDER BY (CASE WHEN hito_tracking_actual = 5 THEN 0 ELSE 1 END) ASC,
                  COALESCE(orden_reparto, 999999) ASC,
                  id ASC`,
        [nid]
    );

    const cola = colaRes.rows;
    const idxPedido = cola.findIndex(r => Number(r.id) === pid);
    if (idxPedido === -1) {
        return { disponible: false };
    }

    let idxActual = 0;
    if (radar.pedido_actual_id) {
        const encontrado = cola.findIndex(r => Number(r.id) === Number(radar.pedido_actual_id));
        if (encontrado >= 0) idxActual = encontrado;
    }

    const obtenerClavePuerta = (row) => (row.latitud != null && row.longitud != null)
        ? `${Number(row.latitud).toFixed(4)},${Number(row.longitud).toFixed(4)}`
        : _normalizarTextoDirCoordenadas(row.direccion_entrega || `p-${row.id}`);

    const claveActual = obtenerClavePuerta(cola[idxActual]);
    const clavePedido = obtenerClavePuerta(cola[idxPedido]);

    if (idxPedido <= idxActual || clavePedido === claveActual) {
        return {
            disponible: true,
            es_proxima_parada: true,
            paradas_restantes: 0,
            minutos_min: 1,
            minutos_max: 6,
            rango_minutos_label: 'Sos la próxima parada (~1 a 6 min)'
        };
    }

    const puertasPrevias = new Set();
    for (let i = idxActual; i < idxPedido; i++) {
        const clavePuerta = obtenerClavePuerta(cola[i]);
        if (clavePuerta !== clavePedido) {
            puertasPrevias.add(clavePuerta);
        }
    }

    const paradasRestantes = Math.max(1, puertasPrevias.size);
    const minutosMin = Math.max(4, paradasRestantes * 5);
    const minutosMax = Math.max(10, paradasRestantes * 10 + 5);
    return {
        disponible: true,
        es_proxima_parada: false,
        paradas_restantes: paradasRestantes,
        minutos_min: minutosMin,
        minutos_max: minutosMax,
        rango_minutos_label: `Faltan ${paradasRestantes} ${paradasRestantes === 1 ? 'parada' : 'paradas'} antes (~${minutosMin} a ${minutosMax} min)`
    };
}

async function _armarRespuestaSeguimientoMarcaBlanca(pedidoRow, nodoRow) {
    const [itemsRes, evsRes, postalRes, resumenPagosMap, cfgBancoSeg] = await Promise.all([
        db.query(
            `SELECT COALESCE(NULLIF(TRIM(nombre_vidriera_vecino), ''), nombre_publico) AS nombre_publico,
                    presentacion_etiqueta, cantidad,
                    precio_unitario_vecino, subtotal_vecino
             FROM public.nodos_pedidos_items
             WHERE pedido_id = $1
             ORDER BY id ASC`,
            [pedidoRow.id]
        ),
        db.query(
            `SELECT hito_numero, estado_operativo, created_at
             FROM public.nodos_pedidos_eventos_tracking
             WHERE pedido_id = $1
             ORDER BY hito_numero ASC, id ASC`,
            [pedidoRow.id]
        ),
        db.query(
            `SELECT operador_postal, modalidad_postal, sucursal_codigo, sucursal_nombre,
                    destinatario_nombre, cp_destino, provincia_nombre, localidad_nombre,
                    calle, altura, piso_depto, referencias_domicilio,
                    costo_envio_cliente, numero_tracking, url_tracking_carrier, estado_envio,
                    fecha_despacho, fecha_entrega_correo
             FROM public.nodos_pedidos_envios_postales
             WHERE pedido_id = $1
             LIMIT 1`,
            [pedidoRow.id]
        ),
        pagosBancariosService.obtenerResumenPagosPorPedidosIds([Number(pedidoRow.id)], null, {
            incluirTokenComprobante: true
        }),
        pagosBancariosService.obtenerConfiguracionBancariaCanalNodos()
    ]);

    const envioPostal = postalRes.rows[0] || null;
    const pagoConfirmado = pagosBancariosService.esPedidoPagoConfirmadoNodos(pedidoRow);

    const perfilOp = normalizarPerfilOperativoNodo(nodoRow.perfil_operativo);
    const modulosOp = resolverModulosActivosNodo(nodoRow);
    const configPaqOp = normalizarConfigPaqueteria(nodoRow.config_paqueteria);

    const timeline = construirTimelineMarcaBlancaPedido(
        pedidoRow,
        { ...nodoRow, perfil_operativo: perfilOp, config_paqueteria: configPaqOp },
        evsRes.rows,
        envioPostal
    );
    const radarResumen = modulosOp.hoja_de_ruta
        ? await obtenerResumenRadarParaPedidoVecino(pedidoRow)
        : { disponible: false };

    const dfltGal = pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT;
    const pedidoBase = {
        codigo_pedido: pedidoRow.codigo_pedido,
        tracking_token: pedidoRow.tracking_token,
        vecino_nombre: pedidoRow.vecino_nombre,
        modalidad_entrega: pedidoRow.modalidad_entrega,
        direccion_entrega: pedidoRow.direccion_entrega || '',
        entrecalles_referencia: pedidoRow.entrecalles_referencia || '',
        fecha_entrega_label: pedidoRow.fecha_entrega_label || '',
        ventana_horaria_label: pedidoRow.ventana_horaria_label || '',
        medio_pago: pedidoRow.medio_pago,
        estado_pago: pedidoRow.estado_pago,
        impactado_cta_cte_pago: Boolean(pedidoRow.impactado_cta_cte_pago),
        pago_confirmado: pagoConfirmado,
        monto_declarado_cliente: Number(pedidoRow.monto_declarado_cliente || 0),
        monto_acreditado_banco: Number(pedidoRow.monto_acreditado_banco || 0),
        cantidad_avisos_pago: Number(pedidoRow.cantidad_avisos_pago || 0),
        ultimo_aviso_pago_at: pedidoRow.ultimo_aviso_pago_at || null,
        reclamo_pago_no_recibido: Boolean(pedidoRow.reclamo_pago_no_recibido),
        reclamo_pago_motivo: pedidoRow.reclamo_pago_motivo || null,
        reclamo_pago_fecha: pedidoRow.reclamo_pago_fecha || null,
        ausente_pasa_retirar: Boolean(pedidoRow.ausente_pasa_retirar),
        motivo_ausencia: pedidoRow.motivo_ausencia || '',
        fecha_ausente_reparto: pedidoRow.fecha_ausente_reparto || null,
        subtotal_productos_vecino: Number(pedidoRow.subtotal_productos_vecino || 0),
        cargo_envio_barrial: Number(pedidoRow.cargo_envio_barrial || 0),
        monto_ajuste_credito: Number(pedidoRow.monto_ajuste_credito || 0),
        motivo_ajuste_credito: pedidoRow.motivo_ajuste_credito || '',
        total_vecino: Number(pedidoRow.total_vecino || 0),
        observaciones_vecino: pedidoRow.observaciones_vecino || '',
        created_at: pedidoRow.created_at,
        envio_postal: envioPostal ? {
            operador_postal: envioPostal.operador_postal,
            operador_label: formatearOperadorPostalLabel(envioPostal.operador_postal),
            modalidad_postal: envioPostal.modalidad_postal,
            sucursal_nombre: envioPostal.sucursal_nombre || null,
            cp_destino: envioPostal.cp_destino,
            provincia_nombre: envioPostal.provincia_nombre,
            localidad_nombre: envioPostal.localidad_nombre,
            costo_envio_cliente: Number(envioPostal.costo_envio_cliente || 0),
            numero_tracking: envioPostal.numero_tracking || null,
            url_tracking_carrier: envioPostal.url_tracking_carrier || null,
            estado_envio: envioPostal.estado_envio || 'PENDIENTE_DESPACHO'
        } : null
    };
    const medioPagoSegNorm = String(pedidoRow.medio_pago || 'TRANSFERENCIA').toUpperCase();
    const totalUnidadesSeg = itemsRes.rows.reduce((acc, x) => acc + Number(x.cantidad || 0), 0);
    const comprobanteDigitalSeg = pagoConfirmado ? {
        disponible: true,
        numero_recibo: _sanitizarNumeroReciboMarcaBlanca(
            pedidoRow.comprobante_referencia,
            pedidoRow.codigo_pedido,
            medioPagoSegNorm
        ),
        fecha_pago: pedidoRow.fecha_conciliacion_pago || pedidoRow.recibo_emitido_at || pedidoRow.fecha_entregado_vecino || pedidoRow.created_at,
        medio_pago_label: medioPagoSegNorm === 'EFECTIVO' ? 'Efectivo al entregar' : 'Transferencia bancaria',
        monto_abonado: Number(Number(pedidoRow.total_vecino || 0).toFixed(2)),
        emitido_por: nodoRow.nombre_marca,
        concepto: `Pedido #${pedidoRow.codigo_pedido} (${totalUnidadesSeg} ${totalUnidadesSeg === 1 ? 'unidad' : 'unidades'})`,
        imagen_url: pedidoRow.tracking_token
            ? `/api/produccion/nodos/pedidos/${Number(pedidoRow.id)}/recibo-marca-blanca.png?tracking_token=${encodeURIComponent(pedidoRow.tracking_token)}`
            : null
    } : null;

    const pedidoEnriquecido = {
        ...pedidoBase,
        ...pagosBancariosService.enriquecerPedidoConResumenPago(
            pedidoBase,
            resumenPagosMap.get(Number(pedidoRow.id))
        ),
        comprobante_digital: comprobanteDigitalSeg
    };

    return {
        nodo: {
            slug: nodoRow.slug,
            slug_historico: nodoRow.slug_historico || null,
            nombre_marca: nodoRow.nombre_marca,
            bajada_marca: nodoRow.bajada_marca || null,
            subtitulo_marca: nodoRow.subtitulo_marca || (perfilOp === 'ecommerce_fulfillment' ? 'Tienda Oficial · Envíos a Todo el País' : 'Comunidad Barrial - Entrega Fresca'),
            gestor_nombre: nodoRow.gestor_nombre,
            gestor_telefono: nodoRow.gestor_telefono,
            barrio_zona: nodoRow.barrio_zona,
            direccion_retiro: nodoRow.direccion_retiro,
            color_primario: nodoRow.color_primario || '#a2553b',
            tema_visual: (nodoRow.tema_visual && typeof nodoRow.tema_visual === 'object') ? nodoRow.tema_visual : {},
            logo_original_base64: nodoRow.logo_original_base64 || null,
            banco_display: nodoRow.banco_display || cfgBancoSeg.banco_display || dfltGal.banco_display,
            alias_bancario_display: nodoRow.alias_bancario_display || cfgBancoSeg.alias_bancario_display || dfltGal.alias_bancario_display,
            cbu_display: nodoRow.cbu_display || cfgBancoSeg.cbu_display || dfltGal.cbu_display,
            titular_display: nodoRow.titular_display || cfgBancoSeg.titular_display || dfltGal.titular_display,
            cuil_display: nodoRow.cuil_display || cfgBancoSeg.cuil_display || dfltGal.cuil_display,
            numero_cuenta_display: nodoRow.numero_cuenta_display || cfgBancoSeg.numero_cuenta_display || dfltGal.numero_cuenta_display,
            solo_transferencia_bancaria: Boolean(cfgBancoSeg.solo_transferencia_bancaria === true),
            perfil_operativo: perfilOp,
            modulos_activos: modulosOp,
            config_paqueteria: configPaqOp
        },
        pedido: pedidoEnriquecido,
        items: itemsRes.rows.map(it => ({
            nombre_publico: it.nombre_publico,
            presentacion_etiqueta: it.presentacion_etiqueta,
            cantidad: Number(it.cantidad || 1),
            precio_unitario_vecino: Number(it.precio_unitario_vecino || 0),
            subtotal_vecino: Number(it.subtotal_vecino || 0)
        })),
        seguimiento: timeline,
        radar_en_vivo: radarResumen,
        modo_laboratorio: esModoLaboratorioNodos(),
        telefono_whatsapp_pruebas: '5492216615746'
    };
}

/**
 * Consulta pública por token criptográfico (100% Marca Blanca, cero datos internos de LAMDA).
 * Como el cliente posee el `tracking_token` criptográfico de su comprobante, devuelve también
 * su identidad del Nodo (`portal_token` y `telefono_normalizado`) para habilitar el seguimiento en 1 toque.
 */
async function obtenerSeguimientoPublicoPedidoVecino(slug, trackingToken) {
    await asegurarEsquemaNodosBarriales();

    const cleanSlug = String(slug || '').trim();
    const cleanToken = String(trackingToken || '').trim();
    if (!cleanToken || cleanToken.length < 12) {
        throw new Error('Enlace de seguimiento inválido.');
    }

    const res = await db.query(
        `SELECT npv.*,
                nv.id AS vec_id_real, nv.portal_token AS vec_portal_token,
                nv.telefono_normalizado AS vec_tel_norm, nv.telefono_whatsapp AS vec_tel_wa,
                nv.nombre_completo AS vec_nombre_real,
                nm.slug AS nm_slug, nm.slug_historico, nm.nombre_marca, nm.bajada_marca, nm.subtitulo_marca, nm.gestor_nombre,
                nm.gestor_telefono, nm.barrio_zona, nm.direccion_retiro, nm.color_primario, nm.tema_visual,
                nm.logo_original_base64, nm.banco_display, nm.alias_bancario_display, nm.cbu_display, nm.titular_display,
                nm.cuil_display, nm.numero_cuenta_display,
                nm.perfil_operativo, nm.modulos_activos, nm.config_paqueteria, nm.diccionario_textos
         FROM public.nodos_pedidos_vecinos npv
         JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
         LEFT JOIN public.nodos_vecinos nv ON nv.id = npv.vecino_id
         WHERE npv.tracking_token = $1
           AND ($2 = '' OR LOWER(nm.slug) = LOWER($2) OR LOWER(COALESCE(nm.slug_historico, '')) = LOWER($2))
           AND COALESCE(nm.activo, true) = true
         LIMIT 1`,
        [cleanToken, cleanSlug]
    );

    if (res.rows.length === 0) {
        throw new Error('No encontramos un pedido asociado a este enlace de seguimiento.');
    }

    const row = res.rows[0];
    let portalTok = String(row.vec_portal_token || '').trim();
    if (row.vec_id_real && portalTok.length < 16) {
        portalTok = generarPortalTokenVecinoNodo();
        await db.query(
            'UPDATE public.nodos_vecinos SET portal_token = $1 WHERE id = $2::int',
            [portalTok, Number(row.vec_id_real)]
        );
    }

    const basePayload = await _armarRespuestaSeguimientoMarcaBlanca(row, { ...row, slug: row.nm_slug });
    return {
        ...basePayload,
        modo_privacidad_enmascarada: false,
        identidad_vecino: {
            portal_token: portalTok || null,
            telefono_normalizado: row.vec_tel_norm || normalizarTelefonoVecinoNodo(row.vecino_telefono || ''),
            telefono_whatsapp: row.vec_tel_wa || row.vecino_telefono || '',
            nombre_completo: row.vec_nombre_real || row.vecino_nombre || ''
        }
    };
}

function _enmascararDigitosAltura(digitosStr) {
    const d = String(digitosStr || '');
    if (d.length >= 4) return d.slice(0, d.length - 2) + '**';
    if (d.length === 3) return d.slice(0, 1) + '**';
    if (d.length === 2) return d.slice(0, 1) + '*';
    return '*';
}

function _enmascararDireccionSensibleMarcaBlanca(direccionRaw = '') {
    const original = String(direccionRaw || '').trim();
    if (!original) return '';

    // Separar notas adicionales tras coma o piso/depto para no exponer detalles internos de vivienda
    const baseSinNotas = original
        .split(/\s*[,;]\s*|\s+(?:piso|dpto\.?|depto\.?|timbre|casa|uf|lote)\b/i)[0]
        .trim() || original;

    // Caso 1: Numeración explícita precedida por N°, Nº, Nro o # (ej: "Calle 74 N° 1145" -> "Calle 74 N° 11**")
    const regExplicito = /((?:\bN[°ºo.]?|\bNro\.?|#)\s*)(\d{1,6})\b/i;
    if (regExplicito.test(baseSinNotas)) {
        return baseSinNotas.replace(regExplicito, (_, prefijo, num) => `${prefijo}${_enmascararDigitosAltura(num)}`);
    }

    // Caso 2: Último bloque numérico de altura al final o tras el nombre de calle (ej: "Calle 74 1145" -> "Calle 74 11**")
    const regUltimoNumero = /^(.*\s)(\d{2,6})(\s*[a-zA-Z]?)$/;
    const mUlt = baseSinNotas.match(regUltimoNumero);
    if (mUlt) {
        return `${mUlt[1]}${_enmascararDigitosAltura(mUlt[2])}`;
    }

    return baseSinNotas;
}

function _enmascararNombreVecinoMarcaBlanca(nombreRaw = '') {
    const partes = String(nombreRaw || '').trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return 'Vecino/a';
    if (partes.length === 1) return partes[0];
    const inicialApellido = partes[partes.length - 1].charAt(0).toUpperCase();
    return `${partes[0]} ${inicialApellido}.`;
}

/**
 * Consulta de cero fricción desde navegador limpio ingresando únicamente el número de WhatsApp:
 * - No exige recordar el código `#NB-...`.
 * - Enmascara parcialmente datos sensibles (numeración exacta del domicilio, referencias internas y apellido)
 *   y omite tokens permanentes (`portal_token` / `tracking_token`) para cuidar la privacidad del vecino.
 */
async function consultarSeguimientoPublicoPorWhatsapp(slug, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const cleanSlug = String(slug || '').trim();
    const telNorm = normalizarTelefonoVecinoNodo(payload.telefono || payload.vecino_telefono || '');
    if (!telNorm || telNorm.length < 8) {
        throw new Error('Ingresá tu número de WhatsApp con código de área (por ejemplo: 221 501 1102).');
    }

    const ultimos8 = telNorm.slice(-8);
    const res = await db.query(
        `SELECT npv.*,
                nv.telefono_normalizado AS vec_tel_norm,
                nm.slug AS nm_slug, nm.slug_historico, nm.nombre_marca, nm.bajada_marca, nm.subtitulo_marca, nm.gestor_nombre,
                nm.gestor_telefono, nm.barrio_zona, nm.direccion_retiro, nm.color_primario, nm.tema_visual,
                nm.logo_original_base64, nm.banco_display, nm.alias_bancario_display, nm.cbu_display, nm.titular_display,
                nm.cuil_display, nm.numero_cuenta_display,
                nm.perfil_operativo, nm.modulos_activos, nm.config_paqueteria, nm.diccionario_textos
         FROM public.nodos_pedidos_vecinos npv
         JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
         LEFT JOIN public.nodos_vecinos nv ON nv.id = npv.vecino_id
         WHERE ($1 = '' OR LOWER(nm.slug) = LOWER($1) OR LOWER(COALESCE(nm.slug_historico, '')) = LOWER($1))
           AND COALESCE(nm.activo, true) = true
           AND COALESCE(npv.estado_operativo, '') <> 'ANULADO'
           AND (
               nv.telefono_normalizado = $2
               OR RIGHT(REGEXP_REPLACE(COALESCE(nv.telefono_normalizado, npv.vecino_telefono, ''), '[^0-9]', '', 'g'), 8) = $3
           )
         ORDER BY npv.id DESC
         LIMIT 12`,
        [cleanSlug, telNorm, ultimos8]
    );

    const filasCoincidentes = res.rows.filter(r => {
        const tPed = normalizarTelefonoVecinoNodo(r.vec_tel_norm || r.vecino_telefono || '');
        if (!tPed) return false;
        return tPed === telNorm || (ultimos8.length >= 8 && tPed.slice(-8) === ultimos8);
    });

    if (filasCoincidentes.length === 0) {
        throw new Error('No encontramos pedidos activos ni recientes asociados a ese WhatsApp. Verificá que sea el mismo número con el que hiciste tu compra.');
    }

    const pedidoIds = filasCoincidentes.map(r => Number(r.id));
    const [itemsRes, evsRes, postalesWaRes] = await Promise.all([
        db.query(
            `SELECT pedido_id,
                    COALESCE(NULLIF(TRIM(nombre_vidriera_vecino), ''), nombre_publico) AS nombre_publico,
                    presentacion_etiqueta, cantidad,
                    precio_unitario_vecino, subtotal_vecino
             FROM public.nodos_pedidos_items
             WHERE pedido_id = ANY($1::int[])
             ORDER BY id ASC`,
            [pedidoIds]
        ),
        db.query(
            `SELECT pedido_id, hito_numero, estado_operativo, created_at
             FROM public.nodos_pedidos_eventos_tracking
             WHERE pedido_id = ANY($1::int[])
             ORDER BY hito_numero ASC, id ASC`,
            [pedidoIds]
        ),
        db.query(
            `SELECT pedido_id, operador_postal, modalidad_postal, sucursal_nombre,
                    cp_destino, provincia_nombre, localidad_nombre,
                    costo_envio_cliente, numero_tracking, url_tracking_carrier, estado_envio,
                    fecha_despacho, fecha_entrega_correo
             FROM public.nodos_pedidos_envios_postales
             WHERE pedido_id = ANY($1::int[])`,
            [pedidoIds]
        )
    ]);
    const postalesWaMap = new Map(postalesWaRes.rows.map(ep => [Number(ep.pedido_id), ep]));

    const itemsMap = new Map();
    for (const it of itemsRes.rows) {
        const pid = Number(it.pedido_id);
        if (!itemsMap.has(pid)) itemsMap.set(pid, []);
        itemsMap.get(pid).push({
            nombre_publico: it.nombre_publico,
            presentacion_etiqueta: it.presentacion_etiqueta || '',
            cantidad: Number(it.cantidad || 1),
            precio_unitario_vecino: Number(it.precio_unitario_vecino || 0),
            subtotal_vecino: Number(it.subtotal_vecino || 0)
        });
    }

    const evsMap = new Map();
    for (const ev of evsRes.rows) {
        const pid = Number(ev.pedido_id);
        if (!evsMap.has(pid)) evsMap.set(pid, []);
        evsMap.get(pid).push(ev);
    }

    const primera = filasCoincidentes[0];
    const perfilOpWa = normalizarPerfilOperativoNodo(primera.perfil_operativo);
    const modulosOpWa = resolverModulosActivosNodo(primera);
    const configPaqWa = normalizarConfigPaqueteria(primera.config_paqueteria);
    const dfltGalWa = pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT;
    const cfgBancoWa = await pagosBancariosService.obtenerConfiguracionBancariaCanalNodos();
    const nodoPublico = {
        slug: primera.nm_slug,
        slug_historico: primera.slug_historico || null,
        nombre_marca: primera.nombre_marca,
        bajada_marca: primera.bajada_marca || null,
        subtitulo_marca: primera.subtitulo_marca || (perfilOpWa === 'ecommerce_fulfillment' ? 'Tienda Oficial · Envíos a Todo el País' : 'Comunidad Barrial - Entrega Fresca'),
        gestor_nombre: primera.gestor_nombre || '',
        gestor_telefono: primera.gestor_telefono || '',
        barrio_zona: primera.barrio_zona || '',
        direccion_retiro: primera.direccion_retiro || '',
        color_primario: primera.color_primario || '#a2553b',
        tema_visual: (primera.tema_visual && typeof primera.tema_visual === 'object') ? primera.tema_visual : {},
        logo_original_base64: primera.logo_original_base64 || null,
        banco_display: primera.banco_display || cfgBancoWa.banco_display || dfltGalWa.banco_display,
        alias_bancario_display: primera.alias_bancario_display || cfgBancoWa.alias_bancario_display || dfltGalWa.alias_bancario_display,
        cbu_display: primera.cbu_display || cfgBancoWa.cbu_display || dfltGalWa.cbu_display,
        titular_display: primera.titular_display || cfgBancoWa.titular_display || dfltGalWa.titular_display,
        cuil_display: primera.cuil_display || cfgBancoWa.cuil_display || dfltGalWa.cuil_display,
        numero_cuenta_display: primera.numero_cuenta_display || cfgBancoWa.numero_cuenta_display || dfltGalWa.numero_cuenta_display,
        solo_transferencia_bancaria: Boolean(cfgBancoWa.solo_transferencia_bancaria === true),
        perfil_operativo: perfilOpWa,
        modulos_activos: modulosOpWa,
        config_paqueteria: configPaqWa
    };

    const esModoLab = esModoLaboratorioNodos();
    const pedidosArmados = await Promise.all(filasCoincidentes.map(async (p) => {
        const pid = Number(p.id);
        const esEnvio = String(p.modalidad_entrega || '').toUpperCase() === 'ENVIO_BARRIAL' || Boolean(p.incluido_reparto_manual);
        const dirPublicaOEnmascarada = esEnvio
            ? _enmascararDireccionSensibleMarcaBlanca(p.direccion_entrega || '')
            : (nodoPublico.direccion_retiro || nodoPublico.barrio_zona || '');

        const pagoConfirmado = Boolean(p.impactado_cta_cte_pago) ||
            ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(p.estado_pago || '').toUpperCase());

        const epWa = postalesWaMap.get(pid) || null;
        const pedidoEnmascaradoParaTimeline = {
            ...p,
            direccion_entrega: dirPublicaOEnmascarada
        };
        const seguimiento = construirTimelineMarcaBlancaPedido(
            pedidoEnmascaradoParaTimeline,
            nodoPublico,
            evsMap.get(pid) || [],
            epWa
        );
        const radarResumen = await obtenerResumenRadarParaPedidoVecino(p);

        return {
            modo_privacidad_enmascarada: true,
            nodo: nodoPublico,
            pedido: {
                codigo_pedido: p.codigo_pedido,
                tracking_token: null,
                vecino_nombre: _enmascararNombreVecinoMarcaBlanca(p.vecino_nombre),
                modalidad_entrega: p.modalidad_entrega,
                direccion_entrega: dirPublicaOEnmascarada,
                entrecalles_referencia: '',
                fecha_entrega_label: p.fecha_entrega_label || '',
                ventana_horaria_label: p.ventana_horaria_label || '',
                medio_pago: p.medio_pago,
                estado_pago: p.estado_pago,
                pago_confirmado: pagoConfirmado,
                monto_declarado_cliente: Number(p.monto_declarado_cliente || 0),
                monto_acreditado_banco: Number(p.monto_acreditado_banco || 0),
                cantidad_avisos_pago: Number(p.cantidad_avisos_pago || 0),
                reclamo_pago_no_recibido: Boolean(p.reclamo_pago_no_recibido),
                reclamo_pago_motivo: p.reclamo_pago_motivo || null,
                saldo_pendiente_acreditar: pagoConfirmado ? 0 : Math.max(0, Number((Number(p.total_vecino || 0) - Number(p.monto_acreditado_banco || 0)).toFixed(2))),
                saldo_pendiente_declarar: pagoConfirmado ? 0 : Math.max(0, Number((Number(p.total_vecino || 0) - Math.max(Number(p.monto_declarado_cliente || 0), Number(p.monto_acreditado_banco || 0))).toFixed(2))),
                ausente_pasa_retirar: Boolean(p.ausente_pasa_retirar),
                motivo_ausencia: p.motivo_ausencia || '',
                fecha_ausente_reparto: p.fecha_ausente_reparto || null,
                subtotal_productos_vecino: Number(p.subtotal_productos_vecino || 0),
                cargo_envio_barrial: Number(p.cargo_envio_barrial || 0),
                monto_ajuste_credito: Number(p.monto_ajuste_credito || 0),
                motivo_ajuste_credito: '',
                total_vecino: Number(p.total_vecino || 0),
                observaciones_vecino: '',
                created_at: p.created_at,
                envio_postal: epWa ? {
                    operador_postal: epWa.operador_postal,
                    operador_label: formatearOperadorPostalLabel(epWa.operador_postal),
                    modalidad_postal: epWa.modalidad_postal,
                    sucursal_nombre: epWa.sucursal_nombre || null,
                    cp_destino: epWa.cp_destino,
                    provincia_nombre: epWa.provincia_nombre,
                    localidad_nombre: epWa.localidad_nombre,
                    costo_envio_cliente: Number(epWa.costo_envio_cliente || 0),
                    numero_tracking: epWa.numero_tracking || null,
                    url_tracking_carrier: epWa.url_tracking_carrier || null,
                    estado_envio: epWa.estado_envio || 'PENDIENTE_DESPACHO'
                } : null
            },
            items: itemsMap.get(pid) || [],
            seguimiento,
            radar_en_vivo: radarResumen,
            modo_laboratorio: esModoLab,
            telefono_whatsapp_pruebas: '5492216615746'
        };
    }));

    const pedidosEnTransito = pedidosArmados.filter(x => Number(x.seguimiento?.hito_actual || 1) < 6);
    const pedidosEntregados = pedidosArmados.filter(x => Number(x.seguimiento?.hito_actual || 1) >= 6);

    const codigoSolicitado = String(payload.codigo_pedido || '').trim().toUpperCase().replace(/^#+/, '');
    const pedidoEspecifico = codigoSolicitado
        ? pedidosArmados.find(x => String(x.pedido.codigo_pedido || '').toUpperCase() === codigoSolicitado) || null
        : null;

    return {
        modo_privacidad_enmascarada: true,
        telefono_normalizado: telNorm,
        nodo: nodoPublico,
        pedidos_en_transito: pedidosEnTransito,
        pedidos_entregados: pedidosEntregados,
        pedidos_todos: pedidosArmados,
        pedido_especifico: pedidoEspecifico,
        modo_laboratorio: esModoLab,
        telefono_whatsapp_pruebas: '5492216615746'
    };
}

/**
 * Buscador público anti-enumeración en Tienda del Vecino: exige coincidencia simultánea
 * de WhatsApp del vecino + Código de pedido (#NB-1002 o 1002) dentro del mismo Nodo.
 */
async function buscarSeguimientoPublicoPorTelefonoYPedido(slug, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const cleanSlug = String(slug || '').trim();
    const telNorm = normalizarTelefonoVecinoNodo(payload.telefono || payload.vecino_telefono || '');
    const rawCodigo = String(payload.codigo_pedido || '').trim().toUpperCase().replace(/^#+/, '');

    if (!telNorm || telNorm.length < 6) {
        throw new Error('Ingresá el número de WhatsApp con el que hiciste el pedido.');
    }
    if (!rawCodigo) {
        throw new Error('Ingresá el número de tu pedido (por ejemplo: NB-1002).');
    }

    const codigoNormalizado = /^\d+$/.test(rawCodigo)
        ? `NB-${rawCodigo}`
        : (rawCodigo.startsWith('NB-') ? rawCodigo : `NB-${rawCodigo.replace(/^NB/i, '').replace(/^-+/, '')}`);

    const res = await db.query(
        `SELECT npv.*,
                nv.telefono_normalizado AS vec_tel_norm,
                nm.slug AS nm_slug, nm.slug_historico, nm.nombre_marca, nm.bajada_marca, nm.subtitulo_marca, nm.gestor_nombre,
                nm.gestor_telefono, nm.barrio_zona, nm.direccion_retiro, nm.color_primario, nm.tema_visual,
                nm.logo_original_base64, nm.banco_display, nm.alias_bancario_display, nm.cbu_display, nm.titular_display,
                nm.cuil_display, nm.numero_cuenta_display,
                nm.perfil_operativo, nm.modulos_activos, nm.config_paqueteria, nm.diccionario_textos
         FROM public.nodos_pedidos_vecinos npv
         JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
         LEFT JOIN public.nodos_vecinos nv ON nv.id = npv.vecino_id
         WHERE UPPER(TRIM(npv.codigo_pedido)) = $1
           AND ($2 = '' OR LOWER(nm.slug) = LOWER($2) OR LOWER(COALESCE(nm.slug_historico, '')) = LOWER($2))
           AND COALESCE(nm.activo, true) = true
         LIMIT 5`,
        [codigoNormalizado, cleanSlug]
    );

    const coincidente = res.rows.find(r => {
        const tPed = normalizarTelefonoVecinoNodo(r.vec_tel_norm || r.vecino_telefono || '');
        if (!tPed) return false;
        const ultimos8Ingresado = telNorm.slice(-8);
        const ultimos8Pedido = tPed.slice(-8);
        return tPed === telNorm || (ultimos8Ingresado.length >= 7 && ultimos8Ingresado === ultimos8Pedido);
    });

    if (!coincidente) {
        throw new Error('No encontramos un pedido que coincida con ese número de pedido y WhatsApp. Verificá ambos datos.');
    }

    if (!coincidente.tracking_token) {
        const nuevoTok = generarTrackingTokenPedidoNodo();
        await db.query('UPDATE public.nodos_pedidos_vecinos SET tracking_token = $1 WHERE id = $2', [nuevoTok, coincidente.id]);
        coincidente.tracking_token = nuevoTok;
    }

    return _armarRespuestaSeguimientoMarcaBlanca(coincidente, { ...coincidente, slug: coincidente.nm_slug });
}

/**
 * Control de 1 toque en el Panel del Gestor: confirma la recepción física del lote en el Nodo
 * (Hito 3 -> Hito 4 EN_PODER_GESTOR) registrando determinísticamente el débito base sobre CB-NODO-xxx.
 */
async function confirmarRecepcionLotePorGestor(nodoId, canastoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const nid = Number(nodoId || 0);
    const cid = Number(canastoId || 0);
    if (!nid || !cid) {
        throw new Error('Identificadores de Nodo y Lote requeridos.');
    }

    const canRes = await db.query(
        `SELECT nle.*, nm.gestor_nombre, nm.slug, nm.activo AS nodo_activo
         FROM public.nodos_lotes_estacion nle
         JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
         WHERE nle.id = $1 AND nle.nodo_id = $2
         LIMIT 1`,
        [cid, nid]
    );
    if (canRes.rows.length === 0) {
        throw new Error('El lote seleccionado no pertenece a este Nodo.');
    }
    const canasto = canRes.rows[0];
    if (canasto.nodo_activo === false) {
        const err = new Error('Este Nodo se encuentra archivado.');
        err.statusCode = 403;
        throw err;
    }

    // Validar que los pedidos activos del lote ya hayan sido controlados en Verificación (Hito >= 3)
    const pedsCheck = await db.query(
        `SELECT id, codigo_pedido, estado_operativo, hito_tracking_actual
         FROM public.nodos_pedidos_vecinos
         WHERE lote_canasto_id = $1 AND COALESCE(estado_operativo, '') <> 'ANULADO'`,
        [cid]
    );
    const sinVerificar = pedsCheck.rows.filter(p => Number(p.hito_tracking_actual || 1) < 3);
    if (sinVerificar.length > 0) {
        throw new Error(`Todavía hay ${sinVerificar.length} pedido(s) en preparación pendiente(s) de control antes de confirmar la recepción del lote.`);
    }

    if (canasto.estado_canasto === 'ENTREGADO_AL_GESTOR' && canasto.debito_cta_cte_registrado) {
        return {
            ya_recibido: true,
            codigo_canasto: canasto.codigo_canasto
        };
    }

    const resRetiro = await confirmarRetiroCanastoPorGestor(cid, {
        retirado_por: payload.actor || canasto.gestor_nombre || 'Gestor del Nodo',
        origen_evento: 'RECEPCION_PANEL_GESTOR'
    });

    return {
        ya_recibido: false,
        codigo_canasto: canasto.codigo_canasto,
        canasto: resRetiro.canasto
    };
}

/**
 * Control de 1 toque en el Panel del Gestor para avanzar un pedido vecinal a:
 *  - Hito 5 ('SALIO_REPARTO' -> EN_CAMINO_VECINO, exclusivo para ENVIO_BARRIAL en Hito 4)
 *  - Hito 6 ('ENTREGADO' -> ENTREGADO_VECINO, desde Hito 4 o 5), con opción unificada
 *    de registrar el cobro en efectivo en el mismo paso.
 */
async function actualizarEstadoEntregaVecinoPorGestor(nodoId, pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const nid = Number(nodoId || 0);
    const pid = Number(pedidoId || 0);
    const accion = String(payload.accion || '').trim().toUpperCase();

    if (!nid || !pid) {
        throw new Error('Nodo y Pedido requeridos.');
    }
    if (!['SALIO_REPARTO', 'ENTREGADO', 'AUSENTE_PASA_RETIRAR', 'REINTEGRAR_REPARTO'].includes(accion)) {
        throw new Error('Acción inválida. Use SALIO_REPARTO, ENTREGADO, AUSENTE_PASA_RETIRAR o REINTEGRAR_REPARTO.');
    }

    const pedRes = await db.query(
        `SELECT npv.*, nm.nombre_marca, nm.gestor_nombre, nm.slug, nm.activo AS nodo_activo,
                nm.direccion_retiro AS nodo_direccion_retiro
         FROM public.nodos_pedidos_vecinos npv
         JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
         WHERE npv.id = $1 AND npv.nodo_id = $2
         LIMIT 1`,
        [pid, nid]
    );
    if (pedRes.rows.length === 0) {
        throw new Error('Pedido vecinal no encontrado en este Nodo.');
    }
    const ped = pedRes.rows[0];
    if (ped.nodo_activo === false) {
        const err = new Error('Este Nodo se encuentra archivado.');
        err.statusCode = 403;
        throw err;
    }

    if (String(ped.estado_operativo || '').toUpperCase() === 'ANULADO') {
        throw new Error('No se puede avanzar la entrega de un pedido anulado.');
    }

    const hitoActual = Number(ped.hito_tracking_actual || resolverHitoDesdeEstadoOperativo(ped.estado_operativo, ped.secuencia_operativa_lamda));
    if (hitoActual < 4) {
        throw new Error(`El pedido #${ped.codigo_pedido} aún no figura recibido en ${ped.nombre_marca}. Confirmá primero la recepción del lote arriba.`);
    }

    const actor = String(payload.actor || ped.gestor_nombre || 'Gestor del Nodo').trim();
    const llevaRepartoDomicilio = String(ped.modalidad_entrega || '').toUpperCase() === 'ENVIO_BARRIAL' ||
        Boolean(ped.incluido_reparto_manual);

    if (accion === 'SALIO_REPARTO') {
        if (!llevaRepartoDomicilio) {
            throw new Error(`El pedido #${ped.codigo_pedido} es de retiro en el Nodo (sumalo primero a la Hoja de Ruta si lo vas a llevar).`);
        }
        if (hitoActual >= 6) {
            throw new Error(`El pedido #${ped.codigo_pedido} ya figura como entregado.`);
        }
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET ausente_pasa_retirar = false,
                 en_hoja_ruta = true,
                 updated_at = NOW()
             WHERE id = $1::int`,
            [pid]
        );
        await registrarTransicionHitoPedidoVecino(db, pid, 5, {
            origen: 'PANEL_GESTOR_REPARTO',
            actor,
            detalle: `${actor} inició reparto barrial hacia ${ped.direccion_entrega || 'domicilio del vecino'}`
        });
    } else if (accion === 'AUSENTE_PASA_RETIRAR') {
        if (!llevaRepartoDomicilio) {
            throw new Error(`El pedido #${ped.codigo_pedido} ya es de retiro en el Nodo.`);
        }
        if (hitoActual >= 6) {
            throw new Error(`El pedido #${ped.codigo_pedido} ya fue entregado.`);
        }
        const motivo = String(payload.motivo || 'No se encontraba en el domicilio al momento del reparto').trim().slice(0, 300);
        // Se conserva íntegro cargo_envio_barrial y total_vecino porque el viaje al domicilio se realizó
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET ausente_pasa_retirar = true,
                 fecha_ausente_reparto = NOW(),
                 motivo_ausencia = $2,
                 hito_tracking_actual = 4,
                 estado_operativo = 'EN_PODER_GESTOR',
                 en_hoja_ruta = false,
                 orden_reparto = NULL,
                 updated_at = NOW()
             WHERE id = $1::int`,
            [pid, motivo]
        );
        await db.query(
            `INSERT INTO public.nodos_pedidos_eventos_tracking (
                pedido_id, nodo_id, hito_numero, estado_operativo, origen_evento, actor, detalle
             ) VALUES ($1::int, $2::int, 4, 'AUSENTE_PASA_RETIRAR', 'MODO_REPARTO_AUSENTE', $3, $4)`,
            [
                pid,
                nid,
                actor,
                `Domicilio ausente (${motivo}). Pedido disponible para retirar en ${ped.nombre_marca}. Se conserva el cargo de envío.`
            ]
        );
    } else if (accion === 'REINTEGRAR_REPARTO') {
        if (!llevaRepartoDomicilio) {
            throw new Error(`El pedido #${ped.codigo_pedido} es de retiro en el Nodo.`);
        }
        if (hitoActual >= 6) {
            throw new Error(`El pedido #${ped.codigo_pedido} ya fue entregado.`);
        }
        const salirAhora = Boolean(payload.salir_a_reparto);
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET ausente_pasa_retirar = false,
                 en_hoja_ruta = true,
                 updated_at = NOW()
             WHERE id = $1::int`,
            [pid]
        );
        if (salirAhora) {
            await registrarTransicionHitoPedidoVecino(db, pid, 5, {
                origen: 'MODO_REPARTO_REINTEGRO',
                actor,
                detalle: `${actor} reintegró el pedido #${ped.codigo_pedido} a nueva tanda de reparto`
            });
        } else {
            await db.query(
                `INSERT INTO public.nodos_pedidos_eventos_tracking (
                    pedido_id, nodo_id, hito_numero, estado_operativo, origen_evento, actor, detalle
                 ) VALUES ($1::int, $2::int, 4, 'EN_PODER_GESTOR', 'MODO_REPARTO_REINTEGRO', $3, $4)`,
                [
                    pid,
                    nid,
                    actor,
                    `Pedido #${ped.codigo_pedido} reintegrado a la Hoja de Ruta para próximo intento de entrega.`
                ]
            );
        }
    } else if (accion === 'ENTREGADO') {
        const esPedEfectivoEnt = String(ped.medio_pago || '').toUpperCase() === 'EFECTIVO';
        const pagoConfirmadoEnt = pagosBancariosService.esPedidoPagoConfirmadoNodos(ped);
        if (!pagoConfirmadoEnt && !(esPedEfectivoEnt && Boolean(payload.registrar_cobro_efectivo))) {
            throw new Error(`El pedido #${ped.codigo_pedido} aún no tiene la transferencia acreditada en Banco Galicia. Debe estar conciliado antes de registrar la entrega.`);
        }
        if (ped.ausente_pasa_retirar) {
            await db.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET ausente_pasa_retirar = false,
                     updated_at = NOW()
                 WHERE id = $1::int`,
                [pid]
            );
        }
        await db.query(
            `UPDATE public.nodos_pedidos_envios_postales
             SET estado_envio = 'ENTREGADO',
                 fecha_entrega_correo = COALESCE(fecha_entrega_correo, NOW()),
                 updated_at = NOW()
             WHERE pedido_id = $1::int`,
            [pid]
        );
        await registrarTransicionHitoPedidoVecino(db, pid, 6, {
            origen: ped.ausente_pasa_retirar ? 'RETIRO_POST_AUSENCIA' : 'PANEL_GESTOR_ENTREGA',
            actor,
            detalle: ped.ausente_pasa_retirar
                ? `Pedido #${ped.codigo_pedido} retirado en ${ped.nombre_marca} por ${ped.vecino_nombre} tras ausencia en reparto`
                : `Pedido #${ped.codigo_pedido} entregado a ${ped.vecino_nombre}`
        });
    }

    let cobroRegistrado = false;
    let envioWhatsappRecibo = null;
    const pagoYaConfirmado = Boolean(ped.impactado_cta_cte_pago) ||
        ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(ped.estado_pago || '').toUpperCase());

    if (accion === 'ENTREGADO' && Boolean(payload.registrar_cobro_efectivo) && !pagoYaConfirmado) {
        const resConc = await conciliarPagoPedidoVecino(pid, {
            medio_pago: 'EFECTIVO',
            comprobante_referencia: `REC-EFVO-${ped.codigo_pedido}`,
            nota: payload.nota_cobro || `Cobrado en efectivo al entregar #${ped.codigo_pedido}`,
            origen_disparo: 'ENTREGA_GESTOR_UN_TOQUE'
        });
        cobroRegistrado = true;
        envioWhatsappRecibo = resConc?.ultimo_envio_whatsapp_recibo || null;
    }

    const pedActualizadoRes = await db.query('SELECT * FROM public.nodos_pedidos_vecinos WHERE id = $1 LIMIT 1', [pid]);
    const pedAct = pedActualizadoRes.rows[0];
    const seguimientoData = await _armarRespuestaSeguimientoMarcaBlanca(pedAct, ped);
    const reciboMarcaBlanca = (cobroRegistrado || pagoYaConfirmado)
        ? await recibosMarcaBlancaService.obtenerDatosReciboMarcaBlanca(pid).catch(() => null)
        : null;

    return {
        pedido: pedAct,
        cobro_efectivo_registrado: cobroRegistrado,
        envio_whatsapp_recibo: envioWhatsappRecibo || pedAct?.recibo_wa_detalle || null,
        recibo_marca_blanca: reciboMarcaBlanca,
        seguimiento: seguimientoData.seguimiento
    };
}

// ============================================================================
// ETAPAS B4 y B5: HOJA DE RUTA DEL GESTOR, OPTIMIZADOR DE PARADAS Y RADAR EN VIVO
// ============================================================================

/**
 * Optimiza el orden de paradas usando agrupamiento por puerta física, Nearest-Neighbor
 * desde el origen y refinamiento 2-opt sobre distancia Haversine.
 * Los pedidos sin coordenadas válidas se preservan ordenados al final manteniendo agrupación por dirección.
 */
function optimizarOrdenParadasReparto(paradas = [], origen = null) {
    const lista = Array.isArray(paradas) ? paradas : [];
    const clustersConGps = [];
    const clustersSinGps = [];
    const mapaSinGps = new Map();

    for (const p of lista) {
        const coords = _sanitizarCoordenadasGeo(p.latitud, p.longitud);
        const normDir = _normalizarTextoDirCoordenadas(p.direccion_entrega || '');
        if (coords) {
            let grupo = clustersConGps.find(g =>
                _calcularDistanciaMetrosGeo(g.lat, g.lng, coords.lat, coords.lng) <= 20 ||
                (normDir && g.normDirs.has(normDir))
            );
            if (!grupo) {
                grupo = {
                    lat: coords.lat,
                    lng: coords.lng,
                    normDirs: new Set(normDir ? [normDir] : []),
                    items: []
                };
                clustersConGps.push(grupo);
            } else if (normDir) {
                grupo.normDirs.add(normDir);
            }
            grupo.items.push(p);
        } else {
            const keyDir = normDir || `sin-dir-${p.id}`;
            if (!mapaSinGps.has(keyDir)) {
                const cl = { normDir: keyDir, items: [] };
                mapaSinGps.set(keyDir, cl);
                clustersSinGps.push(cl);
            }
            mapaSinGps.get(keyDir).items.push(p);
        }
    }

    let rutaClusters = [];
    let distanciaTotalMetros = 0;

    if (clustersConGps.length > 0) {
        const originCoords = _sanitizarCoordenadasGeo(origen?.lat, origen?.lng)
            || { lat: clustersConGps[0].lat, lng: clustersConGps[0].lng };

        // 1) Nearest-Neighbor desde el origen
        const pendientes = clustersConGps.slice();
        let currLat = originCoords.lat;
        let currLng = originCoords.lng;
        while (pendientes.length > 0) {
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let i = 0; i < pendientes.length; i++) {
                const d = _calcularDistanciaMetrosGeo(currLat, currLng, pendientes[i].lat, pendientes[i].lng);
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = i;
                }
            }
            const elegido = pendientes.splice(bestIdx, 1)[0];
            rutaClusters.push(elegido);
            currLat = elegido.lat;
            currLng = elegido.lng;
        }

        // 2) Refinamiento 2-opt de trayectoria abierta desde el origen
        const calcularLongitudRuta = (arr) => {
            if (arr.length === 0) return 0;
            let total = _calcularDistanciaMetrosGeo(originCoords.lat, originCoords.lng, arr[0].lat, arr[0].lng);
            for (let i = 0; i < arr.length - 1; i++) {
                total += _calcularDistanciaMetrosGeo(arr[i].lat, arr[i].lng, arr[i + 1].lat, arr[i + 1].lng);
            }
            return total;
        };

        let mejorDist = calcularLongitudRuta(rutaClusters);
        if (rutaClusters.length >= 3) {
            let huboMejora = true;
            let iter = 0;
            while (huboMejora && iter < 80) {
                huboMejora = false;
                iter += 1;
                for (let i = 0; i < rutaClusters.length - 1; i++) {
                    for (let j = i + 1; j < rutaClusters.length; j++) {
                        const candidato = [
                            ...rutaClusters.slice(0, i),
                            ...rutaClusters.slice(i, j + 1).reverse(),
                            ...rutaClusters.slice(j + 1)
                        ];
                        const distCand = calcularLongitudRuta(candidato);
                        if (distCand < mejorDist - 5) {
                            rutaClusters = candidato;
                            mejorDist = distCand;
                            huboMejora = true;
                        }
                    }
                }
            }
        }
        distanciaTotalMetros = mejorDist;
    }

    const todosClusters = [...rutaClusters, ...clustersSinGps];
    const paradasOrdenadas = [];
    for (const cl of todosClusters) {
        cl.items.sort((a, b) => Number(a.id) - Number(b.id));
        for (const it of cl.items) {
            paradasOrdenadas.push(it);
        }
    }

    return {
        orden_ids: paradasOrdenadas.map(p => Number(p.id)),
        paradas_ordenadas: paradasOrdenadas,
        distancia_total_metros: Math.round(distanciaTotalMetros),
        cantidad_con_gps: clustersConGps.reduce((acc, g) => acc + g.items.length, 0),
        cantidad_sin_gps: clustersSinGps.reduce((acc, g) => acc + g.items.length, 0)
    };
}

async function _obtenerNodoActivoParaGestor(nodoId) {
    const nid = Number(nodoId || 0);
    if (!nid) {
        const err = new Error('Identificador de Nodo inválido.');
        err.statusCode = 400;
        throw err;
    }
    const res = await db.query(
        `SELECT id, nombre_marca, gestor_nombre, barrio_zona, direccion_retiro,
                latitud, longitud, permitir_reparto_propio, activo
         FROM public.nodos_maestro
         WHERE id = $1::int
         LIMIT 1`,
        [nid]
    );
    if (res.rows.length === 0) {
        const err = new Error('Nodo Barrial no encontrado.');
        err.statusCode = 404;
        throw err;
    }
    const nodo = res.rows[0];
    if (nodo.activo === false) {
        const err = new Error('Este Nodo se encuentra archivado.');
        err.statusCode = 403;
        throw err;
    }
    return nodo;
}

async function geocodificarDireccionParaGestor(nodoId, query = '') {
    await asegurarEsquemaNodosBarriales();
    await _obtenerNodoActivoParaGestor(nodoId);
    return geocodificarDireccionArgentina(query);
}

async function sugerirOrdenRepartoGestor(nodoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    const nodo = await _obtenerNodoActivoParaGestor(nodoId);
    const nid = Number(nodo.id);

    const filtroIds = Array.isArray(payload.pedido_ids)
        ? payload.pedido_ids.map(x => Number(x)).filter(x => Number.isFinite(x) && x > 0)
        : [];

    const resPed = await db.query(
        `SELECT npv.id, npv.codigo_pedido, npv.vecino_nombre, npv.direccion_entrega,
                npv.latitud, npv.longitud, npv.orden_reparto, npv.hito_tracking_actual,
                nv.latitud AS vecino_latitud, nv.longitud AS vecino_longitud,
                nv.direccion_calle AS vecino_direccion_calle
         FROM public.nodos_pedidos_vecinos npv
         LEFT JOIN public.nodos_vecinos nv ON nv.id = npv.vecino_id
         WHERE npv.nodo_id = $1::int
           AND COALESCE(npv.en_hoja_ruta, true) = true
           AND UPPER(COALESCE(npv.estado_operativo, '')) <> 'ANULADO'
           AND COALESCE(npv.ausente_pasa_retirar, false) = false
           AND (
                (npv.modalidad_entrega = 'ENVIO_BARRIAL' AND npv.hito_tracking_actual IN (4, 5))
                OR (COALESCE(npv.incluido_reparto_manual, false) = true AND npv.hito_tracking_actual IN (3, 4, 5))
           )
           AND ($2::int[] IS NULL OR npv.id = ANY($2::int[]))
         ORDER BY COALESCE(npv.orden_reparto, 999999) ASC, npv.id ASC`,
        [nid, filtroIds.length > 0 ? filtroIds : null]
    );

    const paradasNormalizadas = resPed.rows.map(r => {
        let coords = _sanitizarCoordenadasGeo(r.latitud, r.longitud);
        if (!coords && r.vecino_latitud != null && r.vecino_longitud != null) {
            const d1 = _normalizarTextoDirCoordenadas(r.direccion_entrega);
            const d2 = _normalizarTextoDirCoordenadas(r.vecino_direccion_calle);
            if (d1 && d2 && d1 === d2) {
                coords = _sanitizarCoordenadasGeo(r.vecino_latitud, r.vecino_longitud);
            }
        }
        return {
            ...r,
            latitud: coords ? coords.lat : null,
            longitud: coords ? coords.lng : null
        };
    });

    const origenCoords = _sanitizarCoordenadasGeo(payload.origen_lat, payload.origen_lng)
        || _sanitizarCoordenadasGeo(nodo.latitud, nodo.longitud)
        || null;

    const resultado = optimizarOrdenParadasReparto(paradasNormalizadas, origenCoords);

    if (payload.guardar !== false && resultado.orden_ids.length > 0) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            for (let i = 0; i < resultado.orden_ids.length; i++) {
                await client.query(
                    `UPDATE public.nodos_pedidos_vecinos
                     SET orden_reparto = $1::int,
                         updated_at = NOW()
                     WHERE id = $2::int AND nodo_id = $3::int`,
                    [i + 1, resultado.orden_ids[i], nid]
                );
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    return {
        orden_ids: resultado.orden_ids,
        distancia_total_metros: resultado.distancia_total_metros,
        cantidad_paradas: resultado.orden_ids.length,
        cantidad_con_gps: resultado.cantidad_con_gps,
        cantidad_sin_gps: resultado.cantidad_sin_gps,
        origen_utilizado: origenCoords
    };
}

async function guardarOrdenManualRepartoGestor(nodoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    const nodo = await _obtenerNodoActivoParaGestor(nodoId);
    const nid = Number(nodo.id);

    const ordenIds = Array.from(new Set(
        (Array.isArray(payload.orden_ids) ? payload.orden_ids : [])
            .map(x => Number(x))
            .filter(x => Number.isFinite(x) && x > 0)
    ));
    if (ordenIds.length === 0) {
        throw new Error('Se requiere al menos un pedido para guardar el orden de reparto.');
    }

    const valRes = await db.query(
        `SELECT id FROM public.nodos_pedidos_vecinos
         WHERE nodo_id = $1::int AND id = ANY($2::int[])`,
        [nid, ordenIds]
    );
    const validosSet = new Set(valRes.rows.map(r => Number(r.id)));
    const idsFiltrados = ordenIds.filter(id => validosSet.has(id));
    if (idsFiltrados.length === 0) {
        throw new Error('Los pedidos indicados no pertenecen a este Nodo.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        for (let i = 0; i < idsFiltrados.length; i++) {
            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET orden_reparto = $1::int,
                     updated_at = NOW()
                 WHERE id = $2::int AND nodo_id = $3::int`,
                [i + 1, idsFiltrados[i], nid]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }

    return {
        orden_ids: idsFiltrados,
        actualizados: idsFiltrados.length
    };
}

/**
 * Permite al Gestor agregar (AGREGAR) o quitar (QUITAR) pedidos arbitrarios de su Hoja de Ruta activa:
 *  - QUITAR: setea en_hoja_ruta = false, orden_reparto = NULL; si estaba en Hito 5 lo devuelve
 *    silenciosamente a Hito 4 ('EN_PODER_GESTOR') sin marcar ausente_pasa_retirar ni emitir aviso de ausencia,
 *    y recompacta orden_reparto = 1..N en los restantes.
 *  - AGREGAR: acepta pedidos activos del nodo en hito IN (3, 4, 5) (envíos fuera de ruta, ausentes reactivados
 *    o pedidos RETIRO_NODO sumados con incluido_reparto_manual = true sin alterar cargo_envio_barrial ni total_vecino),
 *    asigna en_hoja_ruta = true y los anexa al final de orden_reparto vigente.
 */
async function actualizarSeleccionHojaRutaGestor(nodoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    const nodo = await _obtenerNodoActivoParaGestor(nodoId);
    const nid = Number(nodo.id);
    const accion = String(payload.accion || '').trim().toUpperCase();

    if (!['AGREGAR', 'QUITAR'].includes(accion)) {
        const err = new Error('Acción inválida. Use AGREGAR o QUITAR.');
        err.statusCode = 400;
        throw err;
    }

    const pedidoIds = Array.from(new Set(
        (Array.isArray(payload.pedido_ids) ? payload.pedido_ids : [])
            .map(x => Number(x))
            .filter(x => Number.isFinite(x) && x > 0)
    ));
    if (pedidoIds.length === 0) {
        const err = new Error('Debe indicar al menos un pedido válido.');
        err.statusCode = 400;
        throw err;
    }

    const detallesPorId = new Map();
    if (Array.isArray(payload.detalles)) {
        for (const det of payload.detalles) {
            const did = Number(det?.pedido_id || det?.id || 0);
            if (did > 0) detallesPorId.set(did, det);
        }
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        let actualizados = [];

        if (accion === 'QUITAR') {
            const updRes = await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET en_hoja_ruta = false,
                     orden_reparto = NULL,
                     hito_tracking_actual = CASE WHEN COALESCE(hito_tracking_actual, 1) = 5 THEN 4 ELSE hito_tracking_actual END,
                     estado_operativo = CASE WHEN COALESCE(hito_tracking_actual, 1) = 5 THEN 'EN_PODER_GESTOR' ELSE estado_operativo END,
                     updated_at = NOW()
                 WHERE nodo_id = $1::int
                   AND id = ANY($2::int[])
                   AND UPPER(COALESCE(estado_operativo, '')) <> 'ANULADO'
                   AND COALESCE(hito_tracking_actual, 1) < 6
                 RETURNING id, codigo_pedido, hito_tracking_actual, estado_operativo, en_hoja_ruta,
                           incluido_reparto_manual, orden_reparto, ausente_pasa_retirar,
                           cargo_envio_barrial, total_vecino`,
                [nid, pedidoIds]
            );
            actualizados = updRes.rows;
        } else {
            const maxRes = await client.query(
                `SELECT COALESCE(MAX(orden_reparto), 0)::int AS max_orden
                 FROM public.nodos_pedidos_vecinos
                 WHERE nodo_id = $1::int
                   AND COALESCE(en_hoja_ruta, true) = true
                   AND UPPER(COALESCE(estado_operativo, '')) <> 'ANULADO'
                   AND COALESCE(ausente_pasa_retirar, false) = false
                   AND (
                        (modalidad_entrega = 'ENVIO_BARRIAL' AND hito_tracking_actual IN (4, 5))
                        OR (COALESCE(incluido_reparto_manual, false) = true AND hito_tracking_actual IN (3, 4, 5))
                   )`,
                [nid]
            );
            let maxOrden = Number(maxRes.rows[0]?.max_orden || 0);

            const elegiblesRes = await client.query(
                `SELECT id, codigo_pedido, modalidad_entrega, hito_tracking_actual,
                        incluido_reparto_manual, direccion_entrega, entrecalles_referencia,
                        latitud, longitud, gps_origen, cargo_envio_barrial, total_vecino
                 FROM public.nodos_pedidos_vecinos
                 WHERE nodo_id = $1::int
                   AND id = ANY($2::int[])
                   AND UPPER(COALESCE(estado_operativo, '')) <> 'ANULADO'
                   AND COALESCE(hito_tracking_actual, 1) IN (3, 4, 5)
                 FOR UPDATE`,
                [nid, pedidoIds]
            );
            const mapPorId = new Map(elegiblesRes.rows.map(r => [Number(r.id), r]));

            for (const pid of pedidoIds) {
                const ped = mapPorId.get(pid);
                if (!ped) continue;

                const esRetiro = String(ped.modalidad_entrega || '').toUpperCase() === 'RETIRO_NODO';
                const incluirManual = Boolean(ped.incluido_reparto_manual) ||
                    esRetiro ||
                    Number(ped.hito_tracking_actual || 1) === 3;
                const det = detallesPorId.get(pid) || null;
                const dirNueva = det && typeof det.direccion_entrega === 'string'
                    ? det.direccion_entrega.trim()
                    : '';
                const entreNueva = det && typeof det.entrecalles_referencia === 'string'
                    ? det.entrecalles_referencia.trim()
                    : '';
                const coordsNuevas = det ? _sanitizarCoordenadasGeo(det.latitud, det.longitud) : null;

                maxOrden += 1;
                const updOne = await client.query(
                    `UPDATE public.nodos_pedidos_vecinos
                     SET en_hoja_ruta = true,
                         ausente_pasa_retirar = false,
                         incluido_reparto_manual = $1::boolean,
                         orden_reparto = $2::int,
                         direccion_entrega = CASE WHEN $3 <> '' THEN $3 ELSE direccion_entrega END,
                         entrecalles_referencia = CASE WHEN $4 <> '' THEN $4 ELSE entrecalles_referencia END,
                         latitud = COALESCE($5::numeric, latitud),
                         longitud = COALESCE($6::numeric, longitud),
                         gps_origen = CASE WHEN $5::numeric IS NOT NULL THEN 'GESTOR_MAPA' ELSE gps_origen END,
                         updated_at = NOW()
                     WHERE id = $7::int AND nodo_id = $8::int
                     RETURNING id, codigo_pedido, modalidad_entrega, hito_tracking_actual, estado_operativo,
                               en_hoja_ruta, incluido_reparto_manual, orden_reparto, ausente_pasa_retirar,
                               direccion_entrega, entrecalles_referencia, latitud, longitud,
                               cargo_envio_barrial, total_vecino`,
                    [
                        incluirManual,
                        maxOrden,
                        dirNueva,
                        entreNueva,
                        coordsNuevas ? coordsNuevas.lat : null,
                        coordsNuevas ? coordsNuevas.lng : null,
                        pid,
                        nid
                    ]
                );
                if (updOne.rows[0]) actualizados.push(updOne.rows[0]);
            }
        }

        // Recompactar orden_reparto = 1..N en los pedidos activos restantes de la Hoja de Ruta
        const activosRes = await client.query(
            `SELECT id, codigo_pedido, modalidad_entrega, hito_tracking_actual, estado_operativo,
                    en_hoja_ruta, incluido_reparto_manual, orden_reparto, ausente_pasa_retirar,
                    direccion_entrega, latitud, longitud
             FROM public.nodos_pedidos_vecinos
             WHERE nodo_id = $1::int
               AND COALESCE(en_hoja_ruta, true) = true
               AND UPPER(COALESCE(estado_operativo, '')) <> 'ANULADO'
               AND COALESCE(ausente_pasa_retirar, false) = false
               AND (
                    (modalidad_entrega = 'ENVIO_BARRIAL' AND hito_tracking_actual IN (4, 5))
                    OR (COALESCE(incluido_reparto_manual, false) = true AND hito_tracking_actual IN (3, 4, 5))
               )
             ORDER BY COALESCE(orden_reparto, 999999) ASC, id ASC
             FOR UPDATE`,
            [nid]
        );

        const ordenFinal = [];
        for (let i = 0; i < activosRes.rows.length; i++) {
            const r = activosRes.rows[i];
            const nuevoOrden = i + 1;
            if (Number(r.orden_reparto || 0) !== nuevoOrden) {
                await client.query(
                    `UPDATE public.nodos_pedidos_vecinos
                     SET orden_reparto = $1::int,
                         updated_at = NOW()
                     WHERE id = $2::int`,
                    [nuevoOrden, Number(r.id)]
                );
            }
            ordenFinal.push({
                ...r,
                id: Number(r.id),
                orden_reparto: nuevoOrden,
                latitud: r.latitud != null ? Number(r.latitud) : null,
                longitud: r.longitud != null ? Number(r.longitud) : null
            });
        }

        await client.query('COMMIT');
        return {
            accion,
            actualizados: actualizados.length,
            pedidos_modificados: actualizados,
            orden_reparto_actual: ordenFinal
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function actualizarCoordenadasPedidoYVecinoGestor(nodoId, pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    await _obtenerNodoActivoParaGestor(nodoId);
    const nid = Number(nodoId);
    const pid = Number(pedidoId || 0);
    if (!pid) {
        throw new Error('Identificador de pedido inválido.');
    }

    const coords = _sanitizarCoordenadasGeo(payload.latitud, payload.longitud);
    if (!coords) {
        const err = new Error('Coordenadas geográficas inválidas.');
        err.statusCode = 400;
        throw err;
    }

    const pedRes = await db.query(
        `SELECT id, nodo_id, vecino_id, direccion_entrega
         FROM public.nodos_pedidos_vecinos
         WHERE id = $1::int AND nodo_id = $2::int
         LIMIT 1`,
        [pid, nid]
    );
    if (pedRes.rows.length === 0) {
        const err = new Error('Pedido vecinal no encontrado en este Nodo.');
        err.statusCode = 404;
        throw err;
    }
    const ped = pedRes.rows[0];
    const dirEditada = String(payload.direccion_entrega || '').trim();
    const dirFinal = dirEditada || ped.direccion_entrega || '';
    const normDirFinal = _normalizarTextoDirCoordenadas(dirFinal);

    const client = await db.connect();
    let pedidosSincronizados = 1;
    try {
        await client.query('BEGIN');

        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET latitud = $1::numeric,
                 longitud = $2::numeric,
                 gps_origen = 'GESTOR_MAPA',
                 direccion_entrega = CASE WHEN $3 <> '' THEN $3 ELSE direccion_entrega END,
                 updated_at = NOW()
             WHERE id = $4::int AND nodo_id = $5::int`,
            [coords.lat, coords.lng, dirEditada, pid, nid]
        );

        if (ped.vecino_id) {
            await client.query(
                `UPDATE public.nodos_vecinos
                 SET latitud = $1::numeric,
                     longitud = $2::numeric,
                     gps_origen = 'GESTOR_MAPA',
                     gps_verificado_gestor = true,
                     gps_updated_at = NOW(),
                     direccion_calle = CASE WHEN $3 <> '' THEN $3 ELSE direccion_calle END,
                     updated_at = NOW()
                 WHERE id = $4::int AND nodo_id = $5::int`,
                [coords.lat, coords.lng, dirEditada, Number(ped.vecino_id), nid]
            );

            // Sincronizar otros pedidos abiertos del mismo vecino que compartan la misma puerta
            const otrosRes = await client.query(
                `SELECT id, direccion_entrega
                 FROM public.nodos_pedidos_vecinos
                 WHERE nodo_id = $1::int
                   AND vecino_id = $2::int
                   AND id <> $3::int
                   AND (modalidad_entrega = 'ENVIO_BARRIAL' OR COALESCE(incluido_reparto_manual, false) = true)
                   AND COALESCE(hito_tracking_actual, 1) < 6
                   AND UPPER(COALESCE(estado_operativo, '')) <> 'ANULADO'`,
                [nid, Number(ped.vecino_id), pid]
            );
            for (const o of otrosRes.rows) {
                const normO = _normalizarTextoDirCoordenadas(o.direccion_entrega || '');
                if (!normDirFinal || !normO || normO === normDirFinal) {
                    await client.query(
                        `UPDATE public.nodos_pedidos_vecinos
                         SET latitud = $1::numeric,
                             longitud = $2::numeric,
                             gps_origen = 'GESTOR_MAPA',
                             updated_at = NOW()
                         WHERE id = $3::int`,
                        [coords.lat, coords.lng, Number(o.id)]
                    );
                    pedidosSincronizados += 1;
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

    return {
        pedido_id: pid,
        vecino_id: ped.vecino_id ? Number(ped.vecino_id) : null,
        latitud: coords.lat,
        longitud: coords.lng,
        gps_origen: 'GESTOR_MAPA',
        gps_verificado_gestor: true,
        pedidos_sincronizados: pedidosSincronizados
    };
}

async function iniciarModoRepartoGestor(nodoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    const nodo = await _obtenerNodoActivoParaGestor(nodoId);
    const nid = Number(nodo.id);
    const actor = String(payload.actor || nodo.gestor_nombre || 'Gestor del Nodo').trim();

    const filtroIds = Array.isArray(payload.pedido_ids)
        ? payload.pedido_ids.map(x => Number(x)).filter(x => Number.isFinite(x) && x > 0)
        : [];

    const resPed = await db.query(
        `SELECT id, codigo_pedido, hito_tracking_actual, direccion_entrega, orden_reparto
         FROM public.nodos_pedidos_vecinos
         WHERE nodo_id = $1::int
           AND COALESCE(en_hoja_ruta, true) = true
           AND UPPER(COALESCE(estado_operativo, '')) <> 'ANULADO'
           AND COALESCE(ausente_pasa_retirar, false) = false
           AND (
                (modalidad_entrega = 'ENVIO_BARRIAL' AND hito_tracking_actual IN (4, 5))
                OR (COALESCE(incluido_reparto_manual, false) = true AND hito_tracking_actual IN (3, 4, 5))
           )
           AND ($2::int[] IS NULL OR id = ANY($2::int[]))
         ORDER BY COALESCE(orden_reparto, 999999) ASC, id ASC`,
        [nid, filtroIds.length > 0 ? filtroIds : null]
    );

    if (resPed.rows.length === 0) {
        throw new Error('No hay pedidos cargados en la Hoja de Ruta para salir a repartir.');
    }

    const mapPorId = new Map(resPed.rows.map(r => [Number(r.id), r]));
    const ordenFinal = [];
    if (filtroIds.length > 0) {
        for (const id of filtroIds) {
            if (mapPorId.has(id) && !ordenFinal.some(x => Number(x.id) === id)) {
                ordenFinal.push(mapPorId.get(id));
            }
        }
    } else {
        ordenFinal.push(...resPed.rows);
    }

    let pasadosAHito5 = 0;
    for (let i = 0; i < ordenFinal.length; i++) {
        const p = ordenFinal[i];
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET orden_reparto = $1::int,
                 updated_at = NOW()
             WHERE id = $2::int`,
            [i + 1, Number(p.id)]
        );
        if (Number(p.hito_tracking_actual || 4) === 4) {
            const tr = await registrarTransicionHitoPedidoVecino(db, Number(p.id), 5, {
                origen: 'MODO_REPARTO_LOTE',
                actor,
                detalle: `${actor} salió en hoja de ruta (#${i + 1}) hacia ${p.direccion_entrega || 'domicilio del vecino'}`
            });
            if (tr.avanzado) pasadosAHito5 += 1;
        }
    }

    return {
        total_paradas: ordenFinal.length,
        iniciados_en_reparto: pasadosAHito5,
        orden_ids: ordenFinal.map(p => Number(p.id))
    };
}

async function actualizarRadarRepartoGestor(nodoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    await _obtenerNodoActivoParaGestor(nodoId);
    const nid = Number(nodoId);
    const activo = Boolean(payload.activo);

    if (!activo) {
        const updOff = await db.query(
            `UPDATE public.nodos_reparto_radar SET
                activo = false,
                pedido_actual_id = NULL,
                updated_at = NOW()
             WHERE nodo_id = $1::int`,
            [nid]
        );
        if (updOff.rowCount === 0) {
            await db.query(
                `INSERT INTO public.nodos_reparto_radar (
                    nodo_id, activo, latitud, longitud, precision_metros, pedido_actual_id, updated_at
                 )
                 SELECT $1::int, false, NULL, NULL, NULL, NULL, NOW()
                 WHERE NOT EXISTS (SELECT 1 FROM public.nodos_reparto_radar WHERE nodo_id = $1::int)`,
                [nid]
            );
        }
        return { activo: false, expira_en_segundos: 240 };
    }

    const coords = _sanitizarCoordenadasGeo(payload.latitud, payload.longitud);
    const precision = Number.isFinite(Number(payload.precision_metros))
        ? Math.max(0, Math.min(5000, Math.round(Number(payload.precision_metros))))
        : null;
    const pedActualRaw = Number(payload.pedido_actual_id || 0);
    let pedActualValidado = null;
    if (pedActualRaw > 0) {
        const chk = await db.query(
            'SELECT id FROM public.nodos_pedidos_vecinos WHERE id = $1::int AND nodo_id = $2::int LIMIT 1',
            [pedActualRaw, nid]
        );
        if (chk.rows.length > 0) pedActualValidado = pedActualRaw;
    }

    const paramsRadar = [
        nid,
        coords ? coords.lat : null,
        coords ? coords.lng : null,
        precision,
        pedActualValidado
    ];
    const updOn = await db.query(
        `UPDATE public.nodos_reparto_radar SET
            activo = true,
            latitud = COALESCE($2::numeric, latitud),
            longitud = COALESCE($3::numeric, longitud),
            precision_metros = COALESCE($4::int, precision_metros),
            pedido_actual_id = $5::int,
            updated_at = NOW()
         WHERE nodo_id = $1::int`,
        paramsRadar
    );
    if (updOn.rowCount === 0) {
        await db.query(
            `INSERT INTO public.nodos_reparto_radar (
                nodo_id, activo, latitud, longitud, precision_metros, pedido_actual_id, updated_at
             )
             SELECT $1::int, true, $2::numeric, $3::numeric, $4::int, $5::int, NOW()
             WHERE NOT EXISTS (SELECT 1 FROM public.nodos_reparto_radar WHERE nodo_id = $1::int)`,
            paramsRadar
        );
    }

    return {
        activo: true,
        pedido_actual_id: pedActualValidado,
        expira_en_segundos: 240
    };
}

// ============================================================================
// PORTAL PERSONAL MARCA BLANCA ("MI CUENTA / MIS PEDIDOS") Y ACCESOS QR
// ============================================================================

function generarPortalTokenVecinoNodo() {
    return crypto.randomBytes(14).toString('hex');
}

function generarGestorTokenNodo() {
    return 'ngt_' + crypto.randomBytes(20).toString('hex');
}

async function resolverNodoPorTokenGestor(token) {
    await asegurarEsquemaNodosBarriales();
    const tok = String(token || '').trim();
    if (!tok || tok.length < 16) return null;
    const res = await db.query(
        `SELECT id, codigo_nodo, slug, slug_historico, nombre_marca, bajada_marca, gestor_nombre, activo
         FROM public.nodos_maestro
         WHERE gestor_token = $1
           AND COALESCE(activo, true) = true
         LIMIT 1`,
        [tok]
    );
    return res.rows[0] || null;
}

async function asegurarOfertaPerteneceANodo(ofertaId, nodoId) {
    const res = await db.query(
        `SELECT id, nodo_id FROM public.nodos_ofertas_gestor WHERE id = $1 LIMIT 1`,
        [Number(ofertaId)]
    );
    if (res.rows.length === 0) {
        const err = new Error('Oferta de gestor no encontrada.');
        err.statusCode = 404;
        throw err;
    }
    if (Number(res.rows[0].nodo_id) !== Number(nodoId)) {
        const err = new Error('No autorizado: la oferta pertenece a otro Nodo.');
        err.statusCode = 403;
        throw err;
    }
    return res.rows[0];
}

async function asegurarPedidoPerteneceANodo(pedidoId, nodoId) {
    const res = await db.query(
        `SELECT id, nodo_id, tracking_token, codigo_pedido FROM public.nodos_pedidos_vecinos WHERE id = $1 LIMIT 1`,
        [Number(pedidoId)]
    );
    if (res.rows.length === 0) {
        const err = new Error('Pedido vecinal no encontrado.');
        err.statusCode = 404;
        throw err;
    }
    if (Number(res.rows[0].nodo_id) !== Number(nodoId)) {
        const err = new Error('No autorizado: el pedido pertenece a otro Nodo.');
        err.statusCode = 403;
        throw err;
    }
    return res.rows[0];
}

async function obtenerEtiquetaDePedidoAutorizada(pedidoId, auth = {}) {
    await asegurarEsquemaNodosBarriales();
    const pedRes = await db.query(
        `SELECT id, nodo_id, tracking_token FROM public.nodos_pedidos_vecinos WHERE id = $1 LIMIT 1`,
        [Number(pedidoId)]
    );
    if (pedRes.rows.length === 0) {
        const err = new Error('Pedido vecinal no encontrado.');
        err.statusCode = 404;
        throw err;
    }
    const ped = pedRes.rows[0];
    if (auth && auth.requerirAutorizacion) {
        const tokGestor = String(auth.gestorToken || '').trim();
        const tokTracking = String(auth.trackingToken || '').trim();
        let autorizado = false;
        if (tokTracking && ped.tracking_token && tokTracking === String(ped.tracking_token).trim()) {
            autorizado = true;
        } else if (tokGestor) {
            const nodoAuth = await resolverNodoPorTokenGestor(tokGestor);
            if (nodoAuth && Number(nodoAuth.id) === Number(ped.nodo_id)) {
                autorizado = true;
            }
        }
        if (!autorizado) {
            const err = new Error('Se requiere autorización válida del Gestor o token de seguimiento del pedido.');
            err.statusCode = 403;
            throw err;
        }
    }
    return generarEtiquetaDePedidoExistente(pedidoId);
}

function _sanitizarNumeroReciboMarcaBlanca(refRaw, codigoPedido, medioPago) {
    const esEfvo = String(medioPago || '').toUpperCase() === 'EFECTIVO';
    const fallback = `REC-${esEfvo ? 'EFVO' : 'TRF'}-${codigoPedido || 'NODO'}`;
    const txt = String(refRaw || '').trim();
    if (!txt || /lamda|bunker|búnker/i.test(txt)) {
        return fallback;
    }
    return txt;
}

/**
 * Resuelve metadatos del Nodo (por bunker_cliente_id, id o slug) para emitir
 * los códigos QR de acceso móvil como Gestor y Tienda Pública.
 */
async function obtenerDatosQrAccesoNodo(idOrSlug) {
    await asegurarEsquemaNodosBarriales();

    const raw = String(idOrSlug || '').trim();
    if (!raw) {
        throw new Error('Identificador de Nodo requerido.');
    }

    const numVal = /^\d+$/.test(raw) ? Number(raw) : -1;
    const res = await db.query(
        `SELECT id, codigo_nodo, slug, slug_historico, nombre_marca, bajada_marca, subtitulo_marca,
                gestor_nombre, gestor_telefono, barrio_zona, direccion_retiro,
                color_primario, tema_visual, bunker_cliente_id, codigo_bunker_cliente,
                cliente_madre_bunker_id, codigo_bunker_cliente_madre, usar_cuenta_madre_unificada,
                activo, gestor_token
         FROM public.nodos_maestro
         WHERE (
                $1::int > 0
                AND (
                    bunker_cliente_id = $1::int
                    OR (COALESCE(usar_cuenta_madre_unificada, false) = true AND cliente_madre_bunker_id = $1::int)
                    OR id = $1::int
                )
             )
            OR LOWER(slug) = LOWER($2)
            OR LOWER(COALESCE(slug_historico, '')) = LOWER($2)
            OR UPPER(codigo_nodo) = UPPER($2)
            OR UPPER(COALESCE(codigo_bunker_cliente, '')) = UPPER($2)
            OR (COALESCE(usar_cuenta_madre_unificada, false) = true AND UPPER(COALESCE(codigo_bunker_cliente_madre, '')) = UPPER($2))
         ORDER BY
            CASE
                WHEN bunker_cliente_id = $1::int THEN 0
                WHEN COALESCE(usar_cuenta_madre_unificada, false) = true AND cliente_madre_bunker_id = $1::int THEN 1
                ELSE 2
            END ASC,
            id ASC
         LIMIT 1`,
        [numVal, raw]
    );

    if (res.rows.length === 0) {
        throw new Error('Nodo Barrial no encontrado.');
    }

    const n = res.rows[0];
    let gestorToken = String(n.gestor_token || '').trim();
    if (gestorToken.length < 16) {
        gestorToken = generarGestorTokenNodo();
        await db.query(
            `UPDATE public.nodos_maestro SET gestor_token = $1, updated_at = NOW() WHERE id = $2::int`,
            [gestorToken, Number(n.id)]
        );
    }

    return {
        id: Number(n.id),
        bunker_cliente_id: n.bunker_cliente_id ? Number(n.bunker_cliente_id) : null,
        codigo_nodo: n.codigo_nodo,
        codigo_bunker_cliente: n.codigo_bunker_cliente || null,
        slug: n.slug,
        slug_historico: n.slug_historico || null,
        gestor_token: gestorToken,
        nombre_marca: n.nombre_marca,
        bajada_marca: n.bajada_marca || null,
        subtitulo_marca: n.subtitulo_marca || '',
        gestor_nombre: n.gestor_nombre || '',
        gestor_telefono: n.gestor_telefono || '',
        barrio_zona: n.barrio_zona || '',
        direccion_retiro: n.direccion_retiro || '',
        color_primario: n.color_primario || '#16a34a',
        tema_visual: (n.tema_visual && typeof n.tema_visual === 'object') ? n.tema_visual : {}
    };
}

async function rotarGestorTokenNodo(idOrSlug) {
    const actual = await obtenerDatosQrAccesoNodo(idOrSlug);
    const nuevoToken = generarGestorTokenNodo();
    await db.query(
        `UPDATE public.nodos_maestro SET gestor_token = $1, updated_at = NOW() WHERE id = $2::int`,
        [nuevoToken, Number(actual.id)]
    );
    return {
        ...actual,
        gestor_token: nuevoToken
    };
}

function _normalizarClaveTelefonoOmnicanal(rawTel) {
    const digits = String(rawTel || '').replace(/\D+/g, '');
    if (!digits || digits.length < 7) return null;
    let norm = digits;
    if (norm.startsWith('00')) norm = norm.slice(2);
    if (norm.startsWith('0') && norm.length >= 10) norm = norm.slice(1);
    if (norm.startsWith('54') && !norm.startsWith('549') && norm.length === 12) {
        norm = '549' + norm.slice(2);
    } else if (!norm.startsWith('54') && norm.length === 10) {
        norm = '549' + norm;
    }
    return norm;
}

function _parsearListaContactosJsonOTexto(rawVal, campoValor = 'numero') {
    if (!rawVal) return [];
    const txt = String(rawVal).trim();
    if (!txt) return [];
    if (txt.startsWith('[')) {
        try {
            const arr = JSON.parse(txt);
            if (Array.isArray(arr)) {
                return arr
                    .map(it => {
                        if (typeof it === 'string') return { valor: it.trim(), nombre: '', cargo: '', esDefault: true };
                        if (!it || typeof it !== 'object') return null;
                        const v = String(it[campoValor] || it.numero || it.telefono || it.email || '').trim();
                        if (!v) return null;
                        return {
                            valor: v,
                            nombre: String(it.nombre || '').trim(),
                            cargo: String(it.cargo || '').trim(),
                            esDefault: Boolean(it.default_factura || it.default_resumen || it.default)
                        };
                    })
                    .filter(Boolean);
            }
        } catch (_) {}
    }
    return txt
        .split(/[,;]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(v => ({ valor: v, nombre: '', cargo: '', esDefault: true }));
}

/**
 * Consolida los contactos omnicanal (WhatsApp + Email) asociados a un Nodo Barrial:
 * - Ficha Madre en Búnker (`cliente_madre_bunker_id` cuando `usar_cuenta_madre_unificada = true`, o respaldo)
 * - Subficha Búnker del Nodo (`bunker_cliente_id`)
 * - Correo de Portal B2B (`email_portal`)
 * - Contactos de Gestor en `nodos_maestro` (`gestor_telefono`, `gestor_email`)
 * - Respaldo en `public.clientes` (Lomasoft) si existiera `lomas_soft_id`
 */
async function obtenerContactosOmnicanalNodo(idOrSlug) {
    const nodoQr = await obtenerDatosQrAccesoNodo(idOrSlug);
    const mRes = await db.query(
        `SELECT id, codigo_nodo, slug, slug_historico, nombre_marca, bajada_marca, subtitulo_marca,
                gestor_nombre, gestor_telefono, gestor_email, barrio_zona, direccion_retiro,
                alias_bancario_display, cbu_display, titular_display,
                bunker_cliente_id, codigo_bunker_cliente,
                cliente_madre_bunker_id, codigo_bunker_cliente_madre,
                COALESCE(usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada,
                activo
         FROM public.nodos_maestro
         WHERE id = $1::int
         LIMIT 1`,
        [Number(nodoQr.id)]
    );
    if (mRes.rows.length === 0) {
        throw new Error('Nodo Barrial no encontrado.');
    }
    const nm = mRes.rows[0];
    const usaMadre = Boolean(nm.usar_cuenta_madre_unificada) && Number(nm.cliente_madre_bunker_id) > 0;
    const idsBunkerOrdenados = [];
    if (usaMadre) {
        idsBunkerOrdenados.push(Number(nm.cliente_madre_bunker_id));
        if (nm.bunker_cliente_id && Number(nm.bunker_cliente_id) !== Number(nm.cliente_madre_bunker_id)) {
            idsBunkerOrdenados.push(Number(nm.bunker_cliente_id));
        }
    } else {
        if (nm.bunker_cliente_id) idsBunkerOrdenados.push(Number(nm.bunker_cliente_id));
        if (nm.cliente_madre_bunker_id && Number(nm.cliente_madre_bunker_id) !== Number(nm.bunker_cliente_id || 0)) {
            idsBunkerOrdenados.push(Number(nm.cliente_madre_bunker_id));
        }
    }

    let fichasBunker = [];
    if (idsBunkerOrdenados.length > 0) {
        const bRes = await db.query(
            `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social,
                    whatsapp_facturas, email_facturas,
                    email_portal, email_portal_nombre, email_portal_cargo,
                    lomas_soft_id
             FROM public.bunker_clientes
             WHERE id = ANY($1::int[])`,
            [idsBunkerOrdenados]
        );
        const mapPorId = new Map(bRes.rows.map(r => [Number(r.id), r]));
        fichasBunker = idsBunkerOrdenados.map(id => mapPorId.get(id)).filter(Boolean);
    }

    const fichaOperativa = fichasBunker[0] || null;
    const mapaWa = new Map();
    const mapaEmail = new Map();

    const registrarWa = ({ numero, nombre, cargo, origen, preferido }) => {
        const clave = _normalizarClaveTelefonoOmnicanal(numero);
        if (!clave) return;
        if (mapaWa.has(clave)) {
            const prev = mapaWa.get(clave);
            if (!prev.nombre && nombre) prev.nombre = nombre;
            if (!prev.cargo && cargo) prev.cargo = cargo;
            if (preferido) prev.seleccionado_default = true;
            return;
        }
        mapaWa.set(clave, {
            numero: clave,
            numero_display: String(numero || clave).trim(),
            nombre: nombre || nm.gestor_nombre || nm.nombre_marca || '',
            cargo: cargo || '',
            origen,
            seleccionado_default: Boolean(preferido)
        });
    };

    const registrarEmail = ({ email, nombre, cargo, origen, preferido }) => {
        const limpio = String(email || '').trim().toLowerCase();
        if (!limpio || !limpio.includes('@')) return;
        if (mapaEmail.has(limpio)) {
            const prev = mapaEmail.get(limpio);
            if (!prev.nombre && nombre) prev.nombre = nombre;
            if (!prev.cargo && cargo) prev.cargo = cargo;
            if (preferido) prev.seleccionado_default = true;
            return;
        }
        mapaEmail.set(limpio, {
            email: limpio,
            nombre: nombre || nm.gestor_nombre || nm.nombre_marca || '',
            cargo: cargo || '',
            origen,
            seleccionado_default: Boolean(preferido)
        });
    };

    for (let idx = 0; idx < fichasBunker.length; idx++) {
        const fb = fichasBunker[idx];
        const esPrimaria = idx === 0;
        const codFb = fb.codigo_bunker_cliente || `ID-${fb.id}`;
        const etiquetaFicha = esPrimaria
            ? `Ficha ${codFb}`
            : `Vínculo ${codFb}`;

        const listaWa = _parsearListaContactosJsonOTexto(fb.whatsapp_facturas, 'numero');
        for (const w of listaWa) {
            registrarWa({
                numero: w.valor,
                nombre: w.nombre || fb.cliente_nombre || '',
                cargo: w.cargo || '',
                origen: etiquetaFicha,
                preferido: esPrimaria && (w.esDefault || listaWa.length === 1)
            });
        }

        const listaEm = _parsearListaContactosJsonOTexto(fb.email_facturas, 'email');
        for (const em of listaEm) {
            registrarEmail({
                email: em.valor,
                nombre: em.nombre || fb.cliente_nombre || '',
                cargo: em.cargo || '',
                origen: etiquetaFicha,
                preferido: esPrimaria && (em.esDefault || listaEm.length === 1)
            });
        }

        if (fb.email_portal && String(fb.email_portal).includes('@')) {
            registrarEmail({
                email: fb.email_portal,
                nombre: fb.email_portal_nombre || fb.cliente_nombre || '',
                cargo: fb.email_portal_cargo || 'Portal B2B',
                origen: `Portal B2B (${codFb})`,
                preferido: esPrimaria && mapaEmail.size === 0
            });
        }

        if (/^\d+$/.test(String(fb.lomas_soft_id || '').trim())) {
            try {
                const lRes = await db.query(
                    `SELECT telefono, celular, email FROM public.clientes WHERE cliente_id = $1::int LIMIT 1`,
                    [Number(fb.lomas_soft_id)]
                );
                if (lRes.rows.length > 0) {
                    const lr = lRes.rows[0];
                    if (lr.celular) registrarWa({ numero: lr.celular, nombre: fb.cliente_nombre || '', cargo: 'Celular Lomas', origen: `Lomas (${codFb})`, preferido: false });
                    if (lr.telefono) registrarWa({ numero: lr.telefono, nombre: fb.cliente_nombre || '', cargo: 'Teléfono Lomas', origen: `Lomas (${codFb})`, preferido: false });
                    if (lr.email) registrarEmail({ email: lr.email, nombre: fb.cliente_nombre || '', cargo: 'Correo Lomas', origen: `Lomas (${codFb})`, preferido: false });
                }
            } catch (_) {}
        }
    }

    if (nm.gestor_telefono) {
        registrarWa({
            numero: nm.gestor_telefono,
            nombre: nm.gestor_nombre || nm.nombre_marca,
            cargo: 'Gestor del Nodo',
            origen: `Gestor (${nm.codigo_nodo})`,
            preferido: mapaWa.size === 0
        });
    }

    if (nm.gestor_email) {
        registrarEmail({
            email: nm.gestor_email,
            nombre: nm.gestor_nombre || nm.nombre_marca,
            cargo: 'Gestor del Nodo',
            origen: `Gestor (${nm.codigo_nodo})`,
            preferido: mapaEmail.size === 0
        });
    }

    const contactosWhatsapp = Array.from(mapaWa.values());
    if (contactosWhatsapp.length > 0 && !contactosWhatsapp.some(c => c.seleccionado_default)) {
        contactosWhatsapp[0].seleccionado_default = true;
    }

    const contactosEmail = Array.from(mapaEmail.values());
    if (contactosEmail.length > 0 && !contactosEmail.some(c => c.seleccionado_default)) {
        contactosEmail[0].seleccionado_default = true;
    }

    return {
        nodo_qr: nodoQr,
        nodo_detalle: {
            id: Number(nm.id),
            codigo_nodo: nm.codigo_nodo,
            slug: nm.slug,
            slug_historico: nm.slug_historico || null,
            nombre_marca: nm.nombre_marca,
            bajada_marca: nm.bajada_marca || null,
            subtitulo_marca: nm.subtitulo_marca || '',
            gestor_nombre: nm.gestor_nombre || '',
            gestor_telefono: nm.gestor_telefono || '',
            gestor_email: nm.gestor_email || '',
            barrio_zona: nm.barrio_zona || '',
            direccion_retiro: nm.direccion_retiro || '',
            alias_bancario_display: nm.alias_bancario_display || '',
            usar_cuenta_madre_unificada: Boolean(nm.usar_cuenta_madre_unificada),
            cliente_madre_bunker_id: nm.cliente_madre_bunker_id ? Number(nm.cliente_madre_bunker_id) : null,
            codigo_bunker_cliente_madre: nm.codigo_bunker_cliente_madre || null,
            bunker_cliente_id: nm.bunker_cliente_id ? Number(nm.bunker_cliente_id) : null,
            codigo_bunker_cliente: nm.codigo_bunker_cliente || null
        },
        cliente_operativo: fichaOperativa ? {
            id: Number(fichaOperativa.id),
            codigo_bunker_cliente: fichaOperativa.codigo_bunker_cliente,
            cliente_nombre: fichaOperativa.cliente_nombre || fichaOperativa.razon_social || nm.gestor_nombre || nm.nombre_marca,
            razon_social: fichaOperativa.razon_social || '',
            es_cuenta_madre_unificada: usaMadre
        } : {
            id: null,
            codigo_bunker_cliente: nm.codigo_bunker_cliente_madre || nm.codigo_bunker_cliente || nm.codigo_nodo,
            cliente_nombre: nm.gestor_nombre || nm.nombre_marca,
            razon_social: '',
            es_cuenta_madre_unificada: usaMadre
        },
        contactos_whatsapp: contactosWhatsapp,
        contactos_email: contactosEmail
    };
}

/**
 * Resuelve metadatos y garantiza un `portal_token` criptográfico único por Vecino
 * para generar su QR personal "Ver como Cliente" desde Clientes Búnker.
 */
async function obtenerDatosQrAccesoVecino(vecinoId) {
    await asegurarEsquemaNodosBarriales();

    const vid = Number(vecinoId || 0);
    if (!Number.isFinite(vid) || vid <= 0) {
        throw new Error('Identificador de vecino inválido.');
    }

    const res = await db.query(
        `SELECT nv.id, nv.nodo_id, nv.codigo_vecino, nv.nombre_completo,
                nv.telefono_whatsapp, nv.saldo_actual, nv.portal_token,
                nm.codigo_nodo, nm.slug AS nodo_slug, nm.nombre_marca,
                nm.gestor_nombre, nm.barrio_zona, nm.color_primario,
                nm.bunker_cliente_id, nm.codigo_bunker_cliente
         FROM public.nodos_vecinos nv
         JOIN public.nodos_maestro nm ON nm.id = nv.nodo_id
         WHERE nv.id = $1::int
         LIMIT 1`,
        [vid]
    );

    if (res.rows.length === 0) {
        throw new Error('Vecino no encontrado en el padrón del Nodo.');
    }

    const v = res.rows[0];
    let portalTok = String(v.portal_token || '').trim();
    if (portalTok.length < 16) {
        portalTok = generarPortalTokenVecinoNodo();
        await db.query(
            'UPDATE public.nodos_vecinos SET portal_token = $1 WHERE id = $2::int',
            [portalTok, vid]
        );
    }

    return {
        vecino_id: vid,
        codigo_vecino: v.codigo_vecino || formatearCodigoVecinoNodo(v.nodo_id, vid),
        nombre_completo: v.nombre_completo,
        telefono_whatsapp: v.telefono_whatsapp || '',
        saldo_actual: Number(Number(v.saldo_actual || 0).toFixed(2)),
        portal_token: portalTok,
        nodo: {
            id: Number(v.nodo_id),
            bunker_cliente_id: v.bunker_cliente_id ? Number(v.bunker_cliente_id) : null,
            codigo_nodo: v.codigo_nodo,
            codigo_bunker_cliente: v.codigo_bunker_cliente || null,
            slug: v.nodo_slug,
            nombre_marca: v.nombre_marca,
            gestor_nombre: v.gestor_nombre || '',
            barrio_zona: v.barrio_zona || '',
            color_primario: v.color_primario || '#16a34a'
        }
    };
}

/**
 * Portal personal 100% Marca Blanca del Vecino ("Mi Cuenta / Mis Pedidos"):
 *  - Identificado exclusivamente por `portal_token` criptográfico único del comprador.
 *  - Expone 0% de información interna de LAMDA, Búnker, SKUs internos, costos base o márgenes.
 */
async function obtenerPortalCuentaVecinoMarcaBlanca(slug, portalToken) {
    await asegurarEsquemaNodosBarriales();

    const cleanSlug = String(slug || '').trim();
    const cleanToken = String(portalToken || '').trim();
    if (!cleanToken || cleanToken.length < 16) {
        throw new Error('Enlace personal de cuenta inválido.');
    }

    const vecRes = await db.query(
        `SELECT nv.id, nv.nodo_id, nv.codigo_vecino, nv.nombre_completo,
                nv.telefono_whatsapp, nv.telefono_normalizado, nv.direccion_calle, nv.entrecalles_referencia,
                nv.saldo_actual,
                nm.slug AS nm_slug, nm.slug_historico, nm.nombre_marca, nm.bajada_marca, nm.subtitulo_marca,
                nm.gestor_nombre, nm.gestor_telefono, nm.barrio_zona, nm.direccion_retiro,
                nm.color_primario, nm.tema_visual, nm.logo_original_base64,
                nm.banco_display, nm.alias_bancario_display, nm.cbu_display, nm.titular_display,
                nm.cuil_display, nm.numero_cuenta_display,
                nm.permitir_envio_barrial, nm.permitir_retiro_nodo, nm.permitir_reparto_propio, nm.permitir_encomienda, nm.cargo_envio_barrial,
                nm.perfil_operativo, nm.modulos_activos, nm.config_paqueteria, nm.diccionario_textos
         FROM public.nodos_vecinos nv
         JOIN public.nodos_maestro nm ON nm.id = nv.nodo_id
         WHERE nv.portal_token = $1
           AND ($2 = '' OR LOWER(nm.slug) = LOWER($2) OR LOWER(COALESCE(nm.slug_historico, '')) = LOWER($2))
           AND COALESCE(nv.activo, true) = true
           AND COALESCE(nm.activo, true) = true
         LIMIT 1`,
        [cleanToken, cleanSlug]
    );

    if (vecRes.rows.length === 0) {
        throw new Error('No encontramos una cuenta vecinal asociada a este enlace.');
    }

    const row = vecRes.rows[0];
    const vid = Number(row.id);
    const cfgBancoPortal = await pagosBancariosService.obtenerConfiguracionBancariaCanalNodos();
    const dfltGalPortal = pagosBancariosService.CUENTA_OFICIAL_GALICIA_DEFAULT;
    const nodoInfo = {
        slug: row.nm_slug,
        slug_historico: row.slug_historico || null,
        nombre_marca: row.nombre_marca,
        bajada_marca: row.bajada_marca || null,
        subtitulo_marca: row.subtitulo_marca || 'Comunidad Barrial - Entrega Fresca',
        gestor_nombre: row.gestor_nombre || '',
        gestor_telefono: row.gestor_telefono || '',
        barrio_zona: row.barrio_zona || '',
        direccion_retiro: row.direccion_retiro || '',
        color_primario: row.color_primario || '#a2553b',
        tema_visual: (row.tema_visual && typeof row.tema_visual === 'object') ? row.tema_visual : {},
        logo_original_base64: row.logo_original_base64 || null,
        banco_display: row.banco_display || cfgBancoPortal.banco_display || dfltGalPortal.banco_display,
        alias_bancario_display: row.alias_bancario_display || cfgBancoPortal.alias_bancario_display || dfltGalPortal.alias_bancario_display,
        cbu_display: row.cbu_display || cfgBancoPortal.cbu_display || dfltGalPortal.cbu_display,
        titular_display: row.titular_display || cfgBancoPortal.titular_display || dfltGalPortal.titular_display,
        cuil_display: row.cuil_display || cfgBancoPortal.cuil_display || dfltGalPortal.cuil_display,
        numero_cuenta_display: row.numero_cuenta_display || cfgBancoPortal.numero_cuenta_display || dfltGalPortal.numero_cuenta_display,
        solo_transferencia_bancaria: Boolean(cfgBancoPortal.solo_transferencia_bancaria === true),
        permitir_envio_barrial: Boolean(row.permitir_reparto_propio ?? row.permitir_envio_barrial),
        permitir_retiro_nodo: row.permitir_retiro_nodo !== false,
        permitir_reparto_propio: Boolean(row.permitir_reparto_propio ?? row.permitir_envio_barrial),
        permitir_encomienda: Boolean(row.permitir_encomienda),
        cargo_envio_barrial: Number(row.cargo_envio_barrial || 0),
        perfil_operativo: normalizarPerfilOperativoNodo(row.perfil_operativo),
        modulos_activos: resolverModulosActivosNodo(row),
        config_paqueteria: normalizarConfigPaqueteria(row.config_paqueteria)
    };

    const [pedsRes, itemsRes, evsRes, pagosMovsRes, postalesPortalRes] = await Promise.all([
        db.query(
            `SELECT id, codigo_pedido, tracking_token, vecino_nombre,
                    modalidad_entrega, direccion_entrega, entrecalles_referencia,
                    fecha_entrega_label, ventana_horaria_label,
                    medio_pago, estado_pago, estado_operativo, secuencia_operativa_lamda,
                    hito_tracking_actual, impactado_cta_cte_pago, comprobante_referencia,
                    monto_declarado_cliente, monto_acreditado_banco, cantidad_avisos_pago, ultimo_aviso_pago_at,
                    reclamo_pago_no_recibido, reclamo_pago_motivo, reclamo_pago_fecha,
                    subtotal_productos_vecino, cargo_envio_barrial, monto_ajuste_credito,
                    motivo_anulacion_ajuste, total_vecino, observaciones_vecino,
                    created_at, fecha_en_preparacion, fecha_armado_bolsa,
                    fecha_entrega_gestor, fecha_en_camino_vecino, fecha_entregado_vecino
             FROM public.nodos_pedidos_vecinos
             WHERE vecino_id = $1::int
             ORDER BY id DESC`,
            [vid]
        ),
        db.query(
            `SELECT npi.pedido_id,
                    COALESCE(NULLIF(TRIM(npi.nombre_vidriera_vecino), ''), npi.nombre_publico) AS nombre_publico,
                    npi.presentacion_etiqueta,
                    npi.cantidad, npi.precio_unitario_vecino, npi.subtotal_vecino
             FROM public.nodos_pedidos_items npi
             JOIN public.nodos_pedidos_vecinos npv ON npv.id = npi.pedido_id
             WHERE npv.vecino_id = $1::int
             ORDER BY npi.id ASC`,
            [vid]
        ),
        db.query(
            `SELECT ev.pedido_id, ev.hito_numero, ev.estado_operativo, ev.created_at
             FROM public.nodos_pedidos_eventos_tracking ev
             JOIN public.nodos_pedidos_vecinos npv ON npv.id = ev.pedido_id
             WHERE npv.vecino_id = $1::int
             ORDER BY ev.hito_numero ASC, ev.id ASC`,
            [vid]
        ),
        db.query(
            `SELECT pedido_vecino_id, medio_pago, monto, referencia_externa, created_at
             FROM public.nodos_vecinos_movimientos_cc
             WHERE vecino_id = $1::int
               AND naturaleza = 'CREDITO'
               AND tipo_movimiento IN ('CREDITO_TRANSFERENCIA_LAMDA', 'CREDITO_EFECTIVO_GESTOR')
             ORDER BY id DESC`,
            [vid]
        ),
        db.query(
            `SELECT npep.pedido_id, npep.operador_postal, npep.modalidad_postal, npep.sucursal_nombre,
                    npep.cp_destino, npep.provincia_nombre, npep.localidad_nombre,
                    npep.costo_envio_cliente, npep.numero_tracking, npep.url_tracking_carrier, npep.estado_envio,
                    npep.fecha_despacho, npep.fecha_entrega_correo
             FROM public.nodos_pedidos_envios_postales npep
             JOIN public.nodos_pedidos_vecinos npv ON npv.id = npep.pedido_id
             WHERE npv.vecino_id = $1::int`,
            [vid]
        )
    ]);
    const postalesPorPedido = new Map(postalesPortalRes.rows.map(ep => [Number(ep.pedido_id), ep]));

    const itemsPorPedido = new Map();
    for (const it of itemsRes.rows) {
        const pid = Number(it.pedido_id);
        if (!itemsPorPedido.has(pid)) itemsPorPedido.set(pid, []);
        itemsPorPedido.get(pid).push({
            nombre_publico: it.nombre_publico,
            presentacion_etiqueta: it.presentacion_etiqueta || '',
            cantidad: Number(it.cantidad || 1),
            precio_unitario_vecino: Number(it.precio_unitario_vecino || 0),
            subtotal_vecino: Number(it.subtotal_vecino || 0)
        });
    }

    const eventosPorPedido = new Map();
    for (const ev of evsRes.rows) {
        const pid = Number(ev.pedido_id);
        if (!eventosPorPedido.has(pid)) eventosPorPedido.set(pid, []);
        eventosPorPedido.get(pid).push(ev);
    }

    const pagoMovPorPedido = new Map();
    for (const pm of pagosMovsRes.rows) {
        const pid = Number(pm.pedido_vecino_id || 0);
        if (pid > 0 && !pagoMovPorPedido.has(pid)) {
            pagoMovPorPedido.set(pid, pm);
        }
    }

    const resumenPagosPortalMap = await pagosBancariosService.obtenerResumenPagosPorPedidosIds(
        pedsRes.rows.map(p => Number(p.id)),
        null,
        { incluirTokenComprobante: true }
    );

    let totalPendienteTransferencia = 0;
    let totalPendienteEfectivo = 0;
    let totalHistoricoComprado = 0;
    let totalHistoricoAbonado = 0;
    let cantidadPedidosActivos = 0;
    let cantidadPedidosEnCurso = 0;
    let cantidadPagosPendientes = 0;

    const historialPedidos = pedsRes.rows.map(p => {
        const pid = Number(p.id);
        const esAnulado = String(p.estado_operativo || '').toUpperCase() === 'ANULADO';
        const resPagoPortal = resumenPagosPortalMap.get(pid) || null;
        const pEnr = pagosBancariosService.enriquecerPedidoConResumenPago(p, resPagoPortal);
        const pagoConfirmado = !esAnulado && Boolean(pEnr.pago_confirmado);
        const totalPed = Number(p.total_vecino || 0);
        const medioPagoNorm = String(p.medio_pago || 'TRANSFERENCIA').toUpperCase();
        const epPortal = postalesPorPedido.get(pid) || null;
        const seguimiento = construirTimelineMarcaBlancaPedido(p, nodoInfo, eventosPorPedido.get(pid) || [], epPortal);
        const items = itemsPorPedido.get(pid) || [];
        const totalUnidades = items.reduce((acc, x) => acc + Number(x.cantidad || 0), 0);

        if (!esAnulado) {
            cantidadPedidosActivos += 1;
            totalHistoricoComprado += totalPed;
            if (Number(seguimiento.hito_actual || 1) < 6) {
                cantidadPedidosEnCurso += 1;
            }
            if (pagoConfirmado) {
                totalHistoricoAbonado += totalPed;
            } else {
                const acreditadoParcial = Number(pEnr.monto_acreditado_banco || 0);
                if (acreditadoParcial > 0) {
                    totalHistoricoAbonado += Math.min(totalPed, acreditadoParcial);
                }
                const pendienteReal = Math.max(0, Number((totalPed - acreditadoParcial).toFixed(2)));
                if (pendienteReal > 0.01) {
                    cantidadPagosPendientes += 1;
                    if (medioPagoNorm === 'EFECTIVO') {
                        totalPendienteEfectivo += pendienteReal;
                    } else {
                        totalPendienteTransferencia += pendienteReal;
                    }
                }
            }
        }

        const movPago = pagoMovPorPedido.get(pid) || null;
        const comprobanteDigital = pagoConfirmado ? {
            disponible: true,
            numero_recibo: _sanitizarNumeroReciboMarcaBlanca(
                movPago?.referencia_externa || p.comprobante_referencia,
                p.codigo_pedido,
                medioPagoNorm
            ),
            fecha_pago: movPago?.created_at || p.fecha_entregado_vecino || p.created_at,
            medio_pago_label: medioPagoNorm === 'EFECTIVO' ? 'Efectivo al entregar' : 'Transferencia bancaria',
            monto_abonado: Number(totalPed.toFixed(2)),
            emitido_por: nodoInfo.nombre_marca,
            concepto: `Pedido #${p.codigo_pedido} (${totalUnidades} ${totalUnidades === 1 ? 'unidad' : 'unidades'})`,
            imagen_url: p.tracking_token
                ? `/api/produccion/nodos/pedidos/${pid}/recibo-marca-blanca.png?tracking_token=${encodeURIComponent(p.tracking_token)}`
                : `/api/produccion/nodos/pedidos/${pid}/recibo-marca-blanca.png?portal_token=${encodeURIComponent(cleanToken)}`
        } : null;

        return {
            codigo_pedido: p.codigo_pedido,
            tracking_token: p.tracking_token,
            created_at: p.created_at,
            fecha_entrega_label: p.fecha_entrega_label || '',
            ventana_horaria_label: p.ventana_horaria_label || '',
            modalidad_entrega: p.modalidad_entrega,
            direccion_entrega: p.direccion_entrega || '',
            entrecalles_referencia: p.entrecalles_referencia || '',
            medio_pago: medioPagoNorm,
            estado_pago: pEnr.estado_pago,
            pago_confirmado: pagoConfirmado,
            monto_declarado_cliente: pEnr.monto_declarado_cliente,
            monto_acreditado_banco: pEnr.monto_acreditado_banco,
            saldo_pendiente_acreditar: pEnr.saldo_pendiente_acreditar,
            saldo_pendiente_declarar: pEnr.saldo_pendiente_declarar,
            cantidad_avisos_pago: pEnr.cantidad_avisos_pago,
            ultimo_aviso_pago_at: pEnr.ultimo_aviso_pago_at,
            reclamo_pago_no_recibido: pEnr.reclamo_pago_no_recibido,
            reclamo_pago_motivo: pEnr.reclamo_pago_motivo,
            reclamo_pago_fecha: pEnr.reclamo_pago_fecha,
            avisos_pago: pEnr.avisos_pago,
            cobros_banco: pEnr.cobros_banco,
            anulado: esAnulado,
            subtotal_productos_vecino: Number(p.subtotal_productos_vecino || 0),
            cargo_envio_barrial: Number(p.cargo_envio_barrial || 0),
            monto_ajuste_credito: Number(p.monto_ajuste_credito || 0),
            total_vecino: Number(totalPed.toFixed(2)),
            total_unidades: totalUnidades,
            observaciones_vecino: p.observaciones_vecino || '',
            envio_postal: epPortal ? {
                operador_postal: epPortal.operador_postal,
                operador_label: formatearOperadorPostalLabel(epPortal.operador_postal),
                modalidad_postal: epPortal.modalidad_postal,
                sucursal_nombre: epPortal.sucursal_nombre || null,
                cp_destino: epPortal.cp_destino,
                provincia_nombre: epPortal.provincia_nombre,
                localidad_nombre: epPortal.localidad_nombre,
                costo_envio_cliente: Number(epPortal.costo_envio_cliente || 0),
                numero_tracking: epPortal.numero_tracking || null,
                url_tracking_carrier: epPortal.url_tracking_carrier || null,
                estado_envio: epPortal.estado_envio || 'PENDIENTE_DESPACHO'
            } : null,
            items,
            seguimiento,
            comprobante_digital: comprobanteDigital
        };
    });

    const saldoReal = Number(Number(row.saldo_actual || 0).toFixed(2));
    const saldoPendiente = saldoReal > 0.01 ? saldoReal : 0;
    const saldoAFavor = saldoReal < -0.01 ? Number(Math.abs(saldoReal).toFixed(2)) : 0;

    const pedidoEnCurso = historialPedidos.find(p => !p.anulado && Number(p.seguimiento?.hito_actual || 1) < 6) || null;
    const pedidoDestacado = pedidoEnCurso || historialPedidos.find(p => !p.anulado) || historialPedidos[0] || null;

    return {
        nodo: nodoInfo,
        vecino: {
            codigo_cliente: row.codigo_vecino || `VEC-${vid}`,
            nombre_completo: row.nombre_completo,
            telefono_whatsapp: row.telefono_whatsapp || '',
            telefono_normalizado: row.telefono_normalizado || normalizarTelefonoVecinoNodo(row.telefono_whatsapp || ''),
            direccion_calle: row.direccion_calle || '',
            entrecalles_referencia: row.entrecalles_referencia || ''
        },
        resumen_cuenta: {
            saldo_pendiente: saldoPendiente,
            saldo_a_favor: saldoAFavor,
            al_dia: saldoPendiente <= 0.01,
            total_pendiente_transferencia: Number(totalPendienteTransferencia.toFixed(2)),
            total_pendiente_efectivo: Number(totalPendienteEfectivo.toFixed(2)),
            total_historico_comprado: Number(totalHistoricoComprado.toFixed(2)),
            total_historico_abonado: Number(totalHistoricoAbonado.toFixed(2)),
            cantidad_pedidos_activos: cantidadPedidosActivos,
            cantidad_pedidos_en_curso: cantidadPedidosEnCurso,
            cantidad_pagos_pendientes: cantidadPagosPendientes
        },
        pedido_en_curso: pedidoEnCurso,
        pedido_destacado: pedidoDestacado,
        historial_pedidos: historialPedidos
    };
}

/**
 * Devuelve los datos Marca Blanca y catálogo publicado de un Nodo para construir
 * el kit móvil de difusión (link público, ofertas compartibles y textos sugeridos).
 */
async function obtenerKitCompartirNodo(nodoId) {
    await asegurarEsquemaNodosBarriales();

    const nid = Number(nodoId || 0);
    if (!Number.isFinite(nid) || nid <= 0) {
        const err = new Error('Identificador de Nodo inválido.');
        err.statusCode = 400;
        throw err;
    }

    const [nodoRes, ofertasRes] = await Promise.all([
        db.query(
            `SELECT id, codigo_nodo, slug, slug_historico, nombre_marca, bajada_marca, subtitulo_marca,
                    gestor_nombre, barrio_zona, direccion_retiro,
                    permitir_envio_barrial, permitir_retiro_nodo, permitir_reparto_propio, permitir_encomienda,
                    cargo_envio_barrial,
                    color_primario, tema_visual, config_ventanas_corte, activo
             FROM public.nodos_maestro
             WHERE id = $1::int
             LIMIT 1`,
            [nid]
        ),
        db.query(
            `SELECT nog.id AS oferta_id,
                    nog.precio_venta_vecino,
                    nog.destacado_tienda,
                    nac.sku_nodo,
                    COALESCE(NULLIF(TRIM(nog.nombre_vidriera_personalizado), ''), ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_publico,
                    COALESCE(NULLIF(TRIM(nog.categoria_vidriera_personalizada), ''), bf.nombre, ba.rubro, nac.familia_bunker_nombre, nac.categoria_familiar) AS categoria_familiar,
                    nac.presentacion_etiqueta,
                    nac.kilos_unidad
             FROM public.nodos_ofertas_gestor nog
             JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
             LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(nac.sku_nodo)
             LEFT JOIN public.bunker_familias bf ON bf.id = COALESCE(ba.familia_id, nac.familia_bunker_id)
             WHERE nog.nodo_id = $1::int
               AND nog.publicado_tienda = true
               AND nac.activo = true
               AND nac.precio_base_nodo_final > 0
             ORDER BY nog.destacado_tienda DESC,
                      COALESCE(NULLIF(TRIM(nog.categoria_vidriera_personalizada), ''), bf.nombre, ba.rubro, nac.familia_bunker_nombre, nac.categoria_familiar) ASC,
                      COALESCE(NULLIF(TRIM(nog.nombre_vidriera_personalizado), ''), ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) ASC,
                      nac.kilos_unidad ASC`,
            [nid]
        )
    ]);

    if (nodoRes.rows.length === 0) {
        const err = new Error('Nodo no encontrado.');
        err.statusCode = 404;
        throw err;
    }

    const n = nodoRes.rows[0];
    if (n.activo === false) {
        const err = new Error('Este Nodo se encuentra archivado y su kit de difusión está pausado.');
        err.statusCode = 403;
        throw err;
    }
    const proximaEntrega = calcularProximaEntregaNodo(n.config_ventanas_corte);
    const puedeRepartoKit = Boolean(n.permitir_reparto_propio ?? n.permitir_envio_barrial);

    return {
        nodo: {
            id: Number(n.id),
            slug: n.slug,
            slug_historico: n.slug_historico || null,
            nombre_marca: n.nombre_marca,
            bajada_marca: n.bajada_marca || null,
            subtitulo_marca: n.subtitulo_marca || '',
            gestor_nombre: n.gestor_nombre || '',
            barrio_zona: n.barrio_zona || '',
            direccion_retiro: n.direccion_retiro || '',
            permitir_envio_barrial: puedeRepartoKit,
            permitir_retiro_nodo: n.permitir_retiro_nodo !== false,
            permitir_reparto_propio: puedeRepartoKit,
            permitir_encomienda: Boolean(n.permitir_encomienda),
            cargo_envio_barrial: Number(n.cargo_envio_barrial || 0),
            color_primario: n.color_primario || '#a2553b',
            tema_visual: (n.tema_visual && typeof n.tema_visual === 'object') ? n.tema_visual : {}
        },
        proxima_entrega: proximaEntrega,
        ofertas_publicadas: ofertasRes.rows.map(o => ({
            oferta_id: Number(o.oferta_id),
            sku_nodo: o.sku_nodo,
            nombre_publico: o.nombre_publico,
            categoria_familiar: o.categoria_familiar || 'Almacén Natural',
            presentacion_etiqueta: o.presentacion_etiqueta || '',
            kilos_unidad: Number(o.kilos_unidad || 0),
            precio_venta_vecino: Number(o.precio_venta_vecino || 0),
            destacado_tienda: Boolean(o.destacado_tienda)
        }))
    };
}

/**
 * Lista los compradores registrados automáticamente en `nodos_vecinos` para un Nodo
 * puntual, agregando su historial en `nodos_pedidos_vecinos` sin fugas cross-nodo.
 */
async function obtenerCompradoresRegistradosNodo(nodoId) {
    await asegurarEsquemaNodosBarriales();

    const nid = Number(nodoId || 0);
    if (!Number.isFinite(nid) || nid <= 0) {
        const err = new Error('Identificador de Nodo inválido.');
        err.statusCode = 400;
        throw err;
    }

    const [nodoRes, vecinosRes, pedidosRes] = await Promise.all([
        db.query(
            `SELECT id, slug, nombre_marca, perfil_operativo, activo
             FROM public.nodos_maestro
             WHERE id = $1::int
             LIMIT 1`,
            [nid]
        ),
        db.query(
            `SELECT id, nodo_id, codigo_vecino, nombre_completo,
                    telefono_whatsapp, telefono_normalizado,
                    direccion_calle, entrecalles_referencia, notas_entrega,
                    dni_cuil, email_contacto, cp_habitual, provincia_habitual, localidad_habitual,
                    saldo_actual, created_at, updated_at
             FROM public.nodos_vecinos
             WHERE nodo_id = $1::int
               AND COALESCE(activo, true) = true
             ORDER BY updated_at DESC, id DESC`,
            [nid]
        ),
        db.query(
            `SELECT id, codigo_pedido, vecino_id, vecino_telefono,
                    modalidad_entrega, direccion_entrega, entrecalles_referencia,
                    fecha_entrega_label, ventana_horaria_label,
                    medio_pago, estado_pago, estado_operativo,
                    total_vecino, impactado_cta_cte_pago,
                    secuencia_operativa_lamda, tracking_token,
                    hito_tracking_actual, created_at
             FROM public.nodos_pedidos_vecinos
             WHERE nodo_id = $1::int
             ORDER BY id DESC`,
            [nid]
        )
    ]);

    if (nodoRes.rows.length === 0) {
        const err = new Error('Nodo no encontrado.');
        err.statusCode = 404;
        throw err;
    }
    if (nodoRes.rows[0].activo === false) {
        const err = new Error('Este Nodo se encuentra archivado.');
        err.statusCode = 403;
        throw err;
    }

    const pedidosPorVecinoId = new Map();
    const pedidosPorTelNorm = new Map();

    for (const p of pedidosRes.rows) {
        const vid = p.vecino_id ? Number(p.vecino_id) : 0;
        if (vid > 0) {
            if (!pedidosPorVecinoId.has(vid)) pedidosPorVecinoId.set(vid, []);
            pedidosPorVecinoId.get(vid).push(p);
        } else {
            const telNorm = normalizarTelefonoVecinoNodo(p.vecino_telefono || '');
            if (telNorm) {
                if (!pedidosPorTelNorm.has(telNorm)) pedidosPorTelNorm.set(telNorm, []);
                pedidosPorTelNorm.get(telNorm).push(p);
            }
        }
    }

    const compradores = vecinosRes.rows.map(v => {
        const vid = Number(v.id);
        const telNorm = String(v.telefono_normalizado || normalizarTelefonoVecinoNodo(v.telefono_whatsapp || '')).trim();
        const pedidosVec = [
            ...(pedidosPorVecinoId.get(vid) || []),
            ...(telNorm ? (pedidosPorTelNorm.get(telNorm) || []) : [])
        ].sort((a, b) => Number(b.id) - Number(a.id));

        let cantidadActivos = 0;
        let cantidadEntregados = 0;
        let tienePedidoEnCurso = false;
        let totalHistoricoComprado = 0;
        let totalHistoricoPagado = 0;

        for (const p of pedidosVec) {
            const anulado = String(p.estado_operativo || '').toUpperCase() === 'ANULADO';
            if (anulado) continue;

            cantidadActivos++;
            const monto = Number(p.total_vecino || 0);
            totalHistoricoComprado += monto;

            const pagado = Boolean(p.impactado_cta_cte_pago) ||
                ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(p.estado_pago || '').toUpperCase());
            if (pagado) totalHistoricoPagado += monto;

            const hito = Number(p.hito_tracking_actual || resolverHitoDesdeEstadoOperativo(p.estado_operativo, p.secuencia_operativa_lamda));
            if (hito >= 6) {
                cantidadEntregados++;
            } else {
                tienePedidoEnCurso = true;
            }
        }

        const ult = pedidosVec.find(p => String(p.estado_operativo || '').toUpperCase() !== 'ANULADO') || pedidosVec[0] || null;
        let ultimoPedido = null;
        if (ult) {
            const ultAnulado = String(ult.estado_operativo || '').toUpperCase() === 'ANULADO';
            const ultHito = Number(ult.hito_tracking_actual || resolverHitoDesdeEstadoOperativo(ult.estado_operativo, ult.secuencia_operativa_lamda));
            const ultPagado = Boolean(ult.impactado_cta_cte_pago) ||
                ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(ult.estado_pago || '').toUpperCase());
            ultimoPedido = {
                id: Number(ult.id),
                codigo_pedido: ult.codigo_pedido,
                fecha_entrega_label: ult.fecha_entrega_label || '',
                ventana_horaria_label: ult.ventana_horaria_label || '',
                modalidad_entrega: ult.modalidad_entrega || 'RETIRO_NODO',
                total_vecino: Number(ult.total_vecino || 0),
                estado_operativo: ult.estado_operativo || 'RECIBIDO',
                hito_tracking_actual: ultHito,
                anulado: ultAnulado,
                pago_confirmado: ultPagado,
                tracking_token: ult.tracking_token || null,
                created_at: ult.created_at
            };
        }

        return {
            vecino_id: vid,
            codigo_vecino: v.codigo_vecino || formatearCodigoVecinoNodo(nid, vid),
            nombre_completo: v.nombre_completo || 'Comprador',
            telefono_whatsapp: v.telefono_whatsapp || '',
            telefono_normalizado: telNorm,
            direccion_calle: v.direccion_calle || '',
            entrecalles_referencia: v.entrecalles_referencia || '',
            notas_entrega: v.notas_entrega || '',
            dni_cuil: v.dni_cuil || '',
            email_contacto: v.email_contacto || '',
            cp_habitual: v.cp_habitual || '',
            provincia_habitual: v.provincia_habitual || '',
            localidad_habitual: v.localidad_habitual || '',
            saldo_actual: Number(Number(v.saldo_actual || 0).toFixed(2)),
            cantidad_pedidos_activos: cantidadActivos,
            cantidad_pedidos_entregados: cantidadEntregados,
            tiene_pedido_en_curso: tienePedidoEnCurso,
            es_recurrente: cantidadActivos >= 2,
            total_historico_comprado: Number(totalHistoricoComprado.toFixed(2)),
            total_historico_pagado: Number(totalHistoricoPagado.toFixed(2)),
            created_at: v.created_at,
            updated_at: v.updated_at,
            ultimo_pedido: ultimoPedido
        };
    });

    compradores.sort((a, b) => {
        if (a.tiene_pedido_en_curso !== b.tiene_pedido_en_curso) {
            return a.tiene_pedido_en_curso ? -1 : 1;
        }
        const idA = Number(a.ultimo_pedido?.id || 0);
        const idB = Number(b.ultimo_pedido?.id || 0);
        if (idA !== idB) return idB - idA;
        return Number(b.vecino_id) - Number(a.vecino_id);
    });

    const resumen = {
        total_compradores: compradores.length,
        con_pedido_activo: compradores.filter(c => c.tiene_pedido_en_curso).length,
        recurrentes: compradores.filter(c => c.es_recurrente).length
    };

    return {
        nodo: {
            id: Number(nodoRes.rows[0].id),
            slug: nodoRes.rows[0].slug,
            nombre_marca: nodoRes.rows[0].nombre_marca
        },
        resumen,
        compradores
    };
}

/**
 * Archiva o reactiva un Nodo Barrial sin eliminar historial contable ni de Liquidación.
 */
async function archivarOActivarNodoMaestro(nodoId, activo = false) {
    await asegurarEsquemaNodosBarriales();
    const nid = Number(nodoId || 0);
    if (!Number.isFinite(nid) || nid <= 0) {
        const err = new Error('Identificador de Nodo inválido.');
        err.statusCode = 400;
        throw err;
    }

    const nuevoActivo = Boolean(activo);
    const res = await db.query(
        `UPDATE public.nodos_maestro
         SET activo = $1,
             updated_at = NOW()
         WHERE id = $2::int
         RETURNING *`,
        [nuevoActivo, nid]
    );
    if (res.rows.length === 0) {
        const err = new Error('Nodo Barrial no encontrado.');
        err.statusCode = 404;
        throw err;
    }
    return res.rows[0];
}

/**
 * Eliminación transaccional segura de un único Nodo de Prueba,
 * habilitada EXCLUSIVAMENTE cuando LAMDA_MODO_LABORATORIO === 'true' y DB_NAME === 'etiquetas_pruebas'.
 * Protege estrictamente el Cliente Titular Madre y no altera otros Nodos ni clientes mayoristas.
 */
async function eliminarNodoPruebaLaboratorio(nodoId, opciones = {}) {
    await asegurarEsquemaNodosBarriales({ sembrarDemo: false });

    if (!esModoLaboratorioNodos()) {
        const err = new Error('La eliminación física de Nodos solo está permitida en Modo Laboratorio sobre etiquetas_pruebas.');
        err.statusCode = 403;
        throw err;
    }

    const nid = Number(nodoId || 0);
    if (!Number.isFinite(nid) || nid <= 0) {
        const err = new Error('Identificador de Nodo inválido.');
        err.statusCode = 400;
        throw err;
    }

    const client = await db.connect();
    let resumen;
    try {
        await client.query('BEGIN');

        const nodoRes = await client.query(
            'SELECT * FROM public.nodos_maestro WHERE id = $1::int FOR UPDATE',
            [nid]
        );
        if (nodoRes.rows.length === 0) {
            const err = new Error('Nodo Barrial no encontrado.');
            err.statusCode = 404;
            throw err;
        }
        const nodo = nodoRes.rows[0];
        const clienteMadreBunkerId = nodo.cliente_madre_bunker_id ? Number(nodo.cliente_madre_bunker_id) : null;
        const bunkerClienteHijoId = nodo.bunker_cliente_id ? Number(nodo.bunker_cliente_id) : null;
        const codigoCbHijo = String(nodo.codigo_bunker_cliente || '').trim();
        const clienteLomasId = 9000 + nid;

        const [lotesRes, pedsRes, liqRes, ofCountRes, vecCountRes, propCountRes] = await Promise.all([
            client.query('SELECT * FROM public.nodos_lotes_estacion WHERE nodo_id = $1::int', [nid]),
            client.query('SELECT * FROM public.nodos_pedidos_vecinos WHERE nodo_id = $1::int', [nid]),
            client.query('SELECT * FROM public.nodos_liquidaciones_lote WHERE nodo_id = $1::int', [nid]),
            client.query('SELECT COUNT(*)::int AS total FROM public.nodos_ofertas_gestor WHERE nodo_id = $1::int', [nid]),
            client.query('SELECT COUNT(*)::int AS total FROM public.nodos_vecinos WHERE nodo_id = $1::int', [nid]),
            client.query('SELECT COUNT(*)::int AS total FROM public.nodos_propuestas_fracciones WHERE nodo_solicitante_id = $1::int AND articulo_catalogo_id IS NULL', [nid])
        ]);

        const presIds = Array.from(new Set([
            ...lotesRes.rows.map(r => Number(r.presupuesto_id_local || 0)),
            ...pedsRes.rows.map(r => Number(r.presupuesto_id_local || 0))
        ].filter(v => Number.isFinite(v) && v > 0)));

        const exts = Array.from(new Set([
            ...lotesRes.rows.map(r => String(r.codigo_canasto || '').trim()),
            ...pedsRes.rows.map(r => String(r.codigo_pedido || '').trim())
        ].filter(Boolean)));

        const madreCcMovIds = Array.from(new Set(
            liqRes.rows.map(r => Number(r.movimiento_cc_madre_id || 0)).filter(v => Number.isFinite(v) && v > 0)
        ));
        const otrosCcMovIds = Array.from(new Set([
            ...liqRes.rows.map(r => Number(r.movimiento_cc_id || 0)),
            ...lotesRes.rows.map(r => Number(r.movimiento_cc_id || 0)),
            ...pedsRes.rows.map(r => Number(r.movimiento_pago_cc_id || 0))
        ].filter(v => Number.isFinite(v) && v > 0)));

        // 1. Limpiar presupuestos y detalles vinculados únicamente a este Nodo
        await client.query(
            `DELETE FROM public.presupuestos_detalles
             WHERE id_presupuesto IN (
                 SELECT id FROM public.presupuestos
                 WHERE id = ANY($1::int[])
                    OR id_presupuesto_ext = ANY($2::text[])
                    OR (id_cliente = $3::text AND agente = 'Nodo Barrial')
             )
             OR id_presupuesto_ext = ANY($2::text[])`,
            [presIds, exts, String(clienteLomasId)]
        );
        const delPresRes = await client.query(
            `DELETE FROM public.presupuestos
             WHERE id = ANY($1::int[])
                OR id_presupuesto_ext = ANY($2::text[])
                OR (id_cliente = $3::text AND agente = 'Nodo Barrial')`,
            [presIds, exts, String(clienteLomasId)]
        );

        // 2. Revertir movimientos de liquidación imputados sobre Cuenta Madre y recalcular su saldo (sin borrar Madre)
        const ccMadreAfectadas = new Set();
        if (madreCcMovIds.length > 0) {
            const delMadreMovs = await client.query(
                `DELETE FROM public.factura_cuenta_corriente_movimientos
                 WHERE id = ANY($1::bigint[])
                 RETURNING cuenta_corriente_id`,
                [madreCcMovIds]
            );
            for (const m of delMadreMovs.rows) {
                if (m.cuenta_corriente_id) ccMadreAfectadas.add(Number(m.cuenta_corriente_id));
            }
        }
        if (otrosCcMovIds.length > 0) {
            const delOtrosMovs = await client.query(
                `DELETE FROM public.factura_cuenta_corriente_movimientos
                 WHERE id = ANY($1::bigint[])
                 RETURNING cuenta_corriente_id`,
                [otrosCcMovIds]
            );
            for (const m of delOtrosMovs.rows) {
                if (m.cuenta_corriente_id) ccMadreAfectadas.add(Number(m.cuenta_corriente_id));
            }
        }

        // 3. Eliminar subcuenta corriente hija CB-NODO-xxx exclusivamente
        let cuentasHijasEliminadas = 0;
        if (codigoCbHijo && /^CB-NODO-/i.test(codigoCbHijo)) {
            await client.query(
                `DELETE FROM public.factura_cuenta_corriente_movimientos
                 WHERE cuenta_corriente_id IN (
                     SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = $1
                 )`,
                [codigoCbHijo]
            );
            const delCc = await client.query(
                `DELETE FROM public.factura_cuentas_corrientes
                 WHERE codigo_bunker_cliente = $1`,
                [codigoCbHijo]
            );
            cuentasHijasEliminadas = delCc.rowCount || 0;
        }

        if (ccMadreAfectadas.size > 0) {
            const ccsVivasRes = await client.query(
                `SELECT id FROM public.factura_cuentas_corrientes WHERE id = ANY($1::bigint[])`,
                [Array.from(ccMadreAfectadas)]
            );
            for (const ccRow of ccsVivasRes.rows) {
                await recalcularSaldosCuentaMadreBunker(client, ccRow.id);
            }
        }

        // 4. Eliminar ficha hija CB-NODO-xxx en bunker_clientes protegiendo estrictamente cliente_madre_bunker_id
        if (bunkerClienteHijoId && codigoCbHijo && /^CB-NODO-/i.test(codigoCbHijo) && bunkerClienteHijoId !== clienteMadreBunkerId) {
            await client.query(
                `DELETE FROM public.bunker_cliente_listas_precios WHERE bunker_cliente_id = $1::int`,
                [bunkerClienteHijoId]
            );
            await client.query(
                `DELETE FROM public.bunker_clientes
                 WHERE id = $1::int
                   AND codigo_bunker_cliente = $2
                   AND codigo_bunker_cliente LIKE 'CB-NODO-%'
                   AND ($3::int IS NULL OR id <> $3::int)`,
                [bunkerClienteHijoId, codigoCbHijo, clienteMadreBunkerId]
            );
        }

        // 5. Eliminar cliente operativo Lomas/Logística (cliente_id = 9000 + nodo.id) y sus domicilios
        await client.query(
            `DELETE FROM public.clientes_domicilios
             WHERE id_cliente IN (SELECT id FROM public.clientes WHERE cliente_id = $1::int)`,
            [clienteLomasId]
        );
        await client.query(
            `DELETE FROM public.clientes WHERE cliente_id = $1::int`,
            [clienteLomasId]
        );

        // 6. Limpiar propuestas pendientes exclusivas de este Nodo
        await client.query(
            `DELETE FROM public.nodos_propuestas_fracciones
             WHERE nodo_solicitante_id = $1::int
               AND articulo_catalogo_id IS NULL`,
            [nid]
        );

        // 7. Eliminar el registro maestro del Nodo (ON DELETE CASCADE limpia ofertas, vecinos, pedidos, items, eventos, lotes, movs, liquidaciones, alias)
        await client.query(
            `DELETE FROM public.nodos_maestro WHERE id = $1::int`,
            [nid]
        );

        await client.query('COMMIT');

        resumen = {
            id: nid,
            codigo_nodo: nodo.codigo_nodo,
            slug: nodo.slug,
            nombre_marca: nodo.nombre_marca,
            cliente_madre_bunker_id_preservado: clienteMadreBunkerId,
            codigo_bunker_cliente_madre_preservado: nodo.codigo_bunker_cliente_madre || null,
            ofertas_eliminadas: ofCountRes.rows[0]?.total || 0,
            vecinos_eliminados: vecCountRes.rows[0]?.total || 0,
            pedidos_eliminados: pedsRes.rows.length,
            canastos_eliminados: lotesRes.rows.length,
            propuestas_eliminadas: propCountRes.rows[0]?.total || 0,
            presupuestos_eliminados: delPresRes.rowCount || 0,
            subcuentas_hijas_eliminadas: cuentasHijasEliminadas,
            motivo: String(opciones.motivo || 'ELIMINACION_LABORATORIO').trim()
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    return { ok: true, eliminado: true, resumen };
}

async function obtenerTableroConciliadorGaliciaNodos(filtros = {}) {
    await asegurarEsquemaNodosBarriales();
    return pagosBancariosService.obtenerTableroConciliadorGaliciaNodos(filtros);
}

async function ingestarExtractoGaliciaParaNodos(buffer, opciones = {}) {
    await asegurarEsquemaNodosBarriales();
    return pagosBancariosService.ingestarExtractoGaliciaParaNodos(buffer, opciones);
}

async function conciliarCreditosBancariosNodos(payload = {}) {
    await asegurarEsquemaNodosBarriales();
    const resConc = await pagosBancariosService.conciliarCreditosBancariosNodos(
        payload,
        _obtenerHelpersContablesParaPagosBancarios()
    );
    const tablero = await obtenerTableroLiquidacionCobros({ nodo_id: payload.nodo_id || 0 });
    return {
        ...resConc,
        tablero
    };
}

async function marcarPagoNoRecibidoPedidoNodo(pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    const resRec = await pagosBancariosService.marcarPagoNoRecibidoYSolicitarComprobante(pedidoId, payload);
    const tablero = await obtenerTableroLiquidacionCobros({ nodo_id: payload.nodo_id || 0 });
    return {
        ...resRec,
        tablero
    };
}

async function obtenerEstadoPagoPublicoPedidoTienda(slug, codigoOToken, queryAuth = {}) {
    await asegurarEsquemaNodosBarriales();
    return pagosBancariosService.obtenerEstadoPagoPublicoPedido(slug, codigoOToken, queryAuth);
}

async function registrarAvisoPagoCompradorTienda(slug, codigoOToken, payload = {}, fileObj = null) {
    await asegurarEsquemaNodosBarriales();
    return pagosBancariosService.registrarAvisoPagoComprador(slug, codigoOToken, payload, fileObj);
}

async function obtenerArchivoComprobanteAvisoPagoNodos(avisoId, opciones = {}) {
    await asegurarEsquemaNodosBarriales();
    return pagosBancariosService.obtenerArchivoComprobanteAvisoPago(avisoId, opciones);
}

/**
 * Entrega el PNG del Recibo de Pago con membrete oficial de la tienda validando acceso:
 * - En host interno ERP: permitido para Administración.
 * - En host público / con credenciales: exige `nodoAuth` del mismo nodo, `tracking_token` o `portal_token` válido.
 */
async function obtenerReciboPngAutorizadoPedido(pedidoId, opciones = {}) {
    await asegurarEsquemaNodosBarriales();
    const pid = Number(pedidoId || 0);
    if (!pid) {
        const err = new Error('ID de pedido inválido.');
        err.statusCode = 400;
        throw err;
    }

    if (opciones.esHostPublico) {
        if (!opciones.nodoAuth && !opciones.trackingToken && !opciones.portalToken) {
            const err = new Error('No autorizado para visualizar este comprobante.');
            err.statusCode = 403;
            throw err;
        }
        const pedRes = await db.query(
            `SELECT npv.id, npv.nodo_id, npv.tracking_token, npv.impactado_cta_cte_pago, npv.estado_pago,
                    nv.portal_token
             FROM public.nodos_pedidos_vecinos npv
             LEFT JOIN public.nodos_vecinos nv ON nv.id = npv.vecino_id
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
        const okGestor = Boolean(opciones.nodoAuth && Number(opciones.nodoAuth.id) === Number(ped.nodo_id));
        const okTracking = Boolean(opciones.trackingToken && ped.tracking_token && opciones.trackingToken === ped.tracking_token);
        const okPortal = Boolean(opciones.portalToken && ped.portal_token && opciones.portalToken === ped.portal_token);
        if (!okGestor && !okTracking && !okPortal) {
            const err = new Error('No autorizado para visualizar este comprobante.');
            err.statusCode = 403;
            throw err;
        }
    }

    const datos = await recibosMarcaBlancaService.obtenerDatosReciboMarcaBlanca(pid);
    if (!datos.pago_confirmado) {
        const err = new Error('El comprobante de pago estará disponible una vez registrado el cobro.');
        err.statusCode = 400;
        throw err;
    }
    const pngBuffer = await recibosMarcaBlancaService.renderizarPngReciboMarcaBlanca(datos);
    return {
        buffer: pngBuffer,
        filename: `Recibo-${datos.codigo_pedido}.png`,
        datos
    };
}

async function reenviarReciboWhatsAppPorGestor(nodoId, pedidoId, opciones = {}) {
    await asegurarEsquemaNodosBarriales();
    await asegurarPedidoPerteneceANodo(pedidoId, nodoId);
    const datos = await recibosMarcaBlancaService.obtenerDatosReciboMarcaBlanca(pedidoId);
    if (!datos.pago_confirmado) {
        const err = new Error('Registrá primero el cobro del pedido antes de enviar el recibo.');
        err.statusCode = 400;
        throw err;
    }
    const envio = await recibosMarcaBlancaService.despacharReciboMarcaBlancaWhatsApp(pedidoId, {
        telefono_override: opciones.telefono_override || null,
        origen: opciones.origen || 'REENVIO_GESTOR_CELULAR'
    });
    return {
        ok: true,
        envio_whatsapp_recibo: envio,
        recibo_marca_blanca: datos
    };
}

module.exports = {
    esModoLaboratorioNodos,
    geocodificarDireccionArgentina,
    geocodificarInversoArgentina,
    archivarOActivarNodoMaestro,
    eliminarNodoPruebaLaboratorio,
    asegurarEsquemaNodosBarriales,
    sincronizarHerenciaFiscalDesdeMadrePorId,
    ponerACeroDatosNodosBarriales,
    normalizarTelefonoVecinoNodo,
    formatearEtiquetaTecnicaIngrediente,
    formatearEtiquetaTecnicaArticulo,
    ensamblarDescripcionOficialBunker,
    obtenerDiccionarioBunkerCotizador,
    previsualizarAnatomiaCotizacionNodo,
    calcularEstructuraCostosNodo,
    normalizarAlicuotaFiscalNodo,
    obtenerFactorNetoMargenNodo,
    desglosarRetencionFiscalExcedente,
    calcularPrecioYGananciaNetaOfertaNodo,
    obtenerEstadoCompletoNodos,
    guardarNodoMaestro,
    clonarNodoMaestro,
    normalizarPerfilOperativoNodo,
    obtenerPresetModulosActivos,
    resolverModulosActivosNodo,
    obtenerConfigPaqueteriaDefault,
    normalizarConfigPaqueteria,
    cotizarEnvioPostalPorCp,
    cotizarEnvioPostalTienda,
    PROVINCIAS_ARGENTINA_CANONICAS,
    actualizarConfiguracionCuentaCanalNodos,
    crearPropuestaFraccion,
    anularODescartarPropuestaFraccion,
    sumarArticuloCatalogoANodo,
    cotizarYAprobarArticuloNodo,
    recalcularCascadaCatalogoNodos,
    sincronizarCatalogoNodoDesdeBunker,
    actualizarOfertaGestor,
    calcularProximaEntregaNodo,
    obtenerCatalogoIngredientesSolicitablesGestor,
    obtenerDatosPortalNodo,
    actualizarConfiguracionGestorNodo,
    crearPedidoVecinoTienda,
    generarEtiquetaDePedidoExistente,
    generarEtiquetaFulfillmentMarcaBlanca,
    sincronizarCanastosEstacionNodos,
    sincronizarNodosConCircuitoOperativoLamda,
    sincronizarCambioSecuenciaDesdeLamda,
    notificarInicioPreparacionCarroNodo,
    cambiarEtapaCircuitoLamdaCanasto,
    obtenerEstadoCircuitoOperativoLamda,
    obtenerArbolCanastosPorCodigos,
    obtenerMetadataPedidosVecinosPorCodigos,
    obtenerTableroMesaArmadoDeposito,
    armarBolsaPedidoVecino,
    armarTodasBolsasDeCanasto,
    generarEtiquetaQrMaestroCanasto,
    confirmarRetiroCanastoPorGestor,
    reabrirCanastoParaPruebaLaboratorio,
    marcarEmpaqueFulfillmentPedido,
    exportarCsvPreimposicionFulfillment,
    confirmarDespachoPostalPedido,
    marcarEntregaFinalPostalPedido,
    generarCorteLiquidacionFulfillment,
    calcularCuadroLiquidacionCanasto,
    obtenerTableroLiquidacionCobros,
    conciliarPagoPedidoVecino,
    conciliarTodosLosPagosPendientesCanasto,
    cerrarLiquidacionCanasto,
    reabrirLiquidacionCanastoPrueba,
    anularPedidoVecinoNodo,
    aplicarNotaCreditoPedidoVecino,
    obtenerArbolNodoClientesBunker,
    obtenerSubcuentaVecinoDetalle,
    obtenerSeguimientoPublicoPedidoVecino,
    consultarSeguimientoPublicoPorWhatsapp,
    buscarSeguimientoPublicoPorTelefonoYPedido,
    confirmarRecepcionLotePorGestor,
    actualizarEstadoEntregaVecinoPorGestor,
    geocodificarDireccionParaGestor,
    optimizarOrdenParadasReparto,
    sugerirOrdenRepartoGestor,
    guardarOrdenManualRepartoGestor,
    actualizarSeleccionHojaRutaGestor,
    actualizarCoordenadasPedidoYVecinoGestor,
    iniciarModoRepartoGestor,
    actualizarRadarRepartoGestor,
    obtenerResumenRadarParaPedidoVecino,
    obtenerDatosQrAccesoNodo,
    obtenerContactosOmnicanalNodo,
    obtenerKitCompartirNodo,
    obtenerCompradoresRegistradosNodo,
    rotarGestorTokenNodo,
    generarGestorTokenNodo,
    resolverNodoPorTokenGestor,
    asegurarOfertaPerteneceANodo,
    asegurarPedidoPerteneceANodo,
    obtenerEtiquetaDePedidoAutorizada,
    obtenerDatosQrAccesoVecino,
    obtenerPortalCuentaVecinoMarcaBlanca,
    resolverDesgloseIngredientesOfertaNodo,
    convertirLogoAZplGfa,
    generarEtiquetaZplParNodo,
    generarPreviewVisualEtiquetaPar,
    generarPreviewVisualCanastoQrMaestro,
    migrarNodoLoDeMatiAParaiso,
    resolverCuentaContableOperativaNodo,
    sincronizarArchivoYConsolidacionSubcuentaNodo,
    activarCuentaMadreUnificadaNodo,
    obtenerTableroConciliadorGaliciaNodos,
    ingestarExtractoGaliciaParaNodos,
    conciliarCreditosBancariosNodos,
    marcarPagoNoRecibidoPedidoNodo,
    obtenerEstadoPagoPublicoPedidoTienda,
    registrarAvisoPagoCompradorTienda,
    obtenerArchivoComprobanteAvisoPagoNodos,
    obtenerReciboPngAutorizadoPedido,
    reenviarReciboWhatsAppPorGestor,
    TEMA_VISUAL_PARAISO_OFICIAL,
    TEMA_VISUAL_MANSO_OFICIAL,
    LOGO_ZPL_CONFIG_MANSO_OFICIAL,
    leerLogoZebraMansoDataUrl
};
