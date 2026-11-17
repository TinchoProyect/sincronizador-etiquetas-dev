const pool = require('../config/database');
const { normalizarOfertaProveedor } = require('../utils/unitNormalizer');
const { supabaseFetch } = require('../utils/supabaseHelper');
let iaMonitor = null;
try {
    iaMonitor = require('../../services/iaCreditoMonitorService');
} catch (_) {
    iaMonitor = null;
}

// REGEX UNIVERSALES DE CLASIFICACIÓN DE CONFORMACIÓN Y GRADO COMERCIAL (DOMINIO MAYORISTA ALIMENTOS)
const REGEX_CONFORMACION_INDUSTRIA = /\b(industri[a-z]*|bakery|panader[a-z]*|pastel[a-z]*|partid[oa]s?|ptda|quebrad[oa]s?|trozad[oa]s?|trozos?|granza|pedacer[a-z]*|descarte|segunda|cuart[oa]s?|cuartill[oa]s?|1\/4|octav[oa]s?)\b/i;
const REGEX_CONFORMACION_PREMIUM = /\b(entero|entera|enteros|enteras|premium|confiter[a-z]*|mesa|mariposa|super verde|doble a|\baa\b|primera|extra light|extralight)\b/i;

/**
 * SERVICIO DETERMINISTA DE CONCILIACIÓN CON EXTRACCIÓN EMPÍRICA AGOTADORA Y CACHÉ RAM
 * Conectado a la Tabla Maestra de Proveedores Operativa (Supabase Cloud Grilla B4.1)
 * Auditado sobre la totalidad de los 3.961 registros reales de Supabase.
 * Single Source of Truth de Costos: public.bunker_articulos.costo_base
 */
class ConciliacionArticulosService {

    constructor() {
        this.cacheTablaMaestra = null;
        this.cacheTimestamp = 0;
        this.CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos de vigencia en memoria local para rápida sincronización
        this.refreshingPromise = null;
    }

    /**
     * Invalida explícitamente el caché de la Tabla Maestra
     */
    invalidarCache() {
        this.cacheTablaMaestra = null;
        this.cacheTimestamp = 0;
        this.refreshingPromise = null;
        console.log('🔄 [CONCILIACION] Caché de Tabla Maestra en memoria invalidado.');
    }

    /**
     * Extrae deterministamente el valor de un objeto JSONB probando las claves empíricas validadas en BD
     */
    extraerDatoEmpirico(dm, posiblesClaves, valorPorDefecto = '') {
        if (!dm || typeof dm !== 'object') return valorPorDefecto;
        for (const key of posiblesClaves) {
            if (dm[key] !== undefined && dm[key] !== null && String(dm[key]).trim() !== '') {
                return dm[key];
            }
        }
        return valorPorDefecto;
    }

    /**
     * Limpia y parsea valores numéricos y monetarios robustamente
     * Soporta símbolos de moneda ($), espacios, y formatos numéricos argentinos (16.742,88 o 16742,88)
     */
    limpiarYParsearNumero(raw, defaultVal = 0) {
        if (raw === null || raw === undefined || raw === '') return defaultVal;
        let clean = String(raw).replace(/[^0-9,.-]/g, '').trim();
        if (!clean) return defaultVal;

        if (clean.includes('.') && clean.includes(',')) {
            // Formato argentino estándar: 16.742,88 -> 16742.88
            clean = clean.replace(/\./g, '').replace(',', '.');
        } else if (clean.includes(',')) {
            // Formato decimal con coma: 16742,88 -> 16742.88
            clean = clean.replace(',', '.');
        } else if ((clean.match(/\./g) || []).length > 1) {
            // Múltiples puntos de miles: 1.250.000 -> 1250000
            clean = clean.replace(/\./g, '');
        }

        const val = parseFloat(clean);
        return isNaN(val) ? defaultVal : val;
    }

    /**
     * Evalúa condiciones numéricas avanzadas (soporta expresiones matemáticas y lenguaje natural en español)
     * Ejemplos: '< 50', '<50', 'menor que 50', 'menores a 50', 'hasta 50', '10-25', 'entre 10 y 25', '> 10', '10'
     */
    evaluarCondicionNumerica(valNum, condicionRaw) {
        if (valNum === null || valNum === undefined || isNaN(valNum)) return false;
        let text = String(condicionRaw || '').trim().toLowerCase();
        if (!text) return true;

        // Normalizar expresiones en lenguaje natural en español a operadores matemáticos
        text = text.replace(/menor(?:es)?\s+o\s+igual(?:es)?\s*(?:a|que)?/gi, '<=');
        text = text.replace(/hasta/gi, '<=');
        text = text.replace(/menor(?:es)?\s*(?:a|que)?/gi, '<');
        text = text.replace(/menos\s+de/gi, '<');

        text = text.replace(/mayor(?:es)?\s+o\s+igual(?:es)?\s*(?:a|que)?/gi, '>=');
        text = text.replace(/desde/gi, '>=');
        text = text.replace(/mayor(?:es)?\s*(?:a|que)?/gi, '>');
        text = text.replace(/m[aá]s\s+de/gi, '>');

        text = text.replace(/entre\s+([0-9.,]+)\s+y\s+([0-9.,]+)/gi, '$1-$2');
        text = text.replace(/\s+/g, ''); // eliminar espacios residuales

        if (text.includes('-')) {
            const parts = text.split('-');
            const min = parseFloat(parts[0].replace(',', '.')) || 0;
            const max = parseFloat(parts[1].replace(',', '.')) || Infinity;
            return valNum >= min && valNum <= max;
        }
        if (text.startsWith('>=')) {
            const min = parseFloat(text.replace('>=', '').replace(',', '.')) || 0;
            return valNum >= min;
        }
        if (text.startsWith('>')) {
            const min = parseFloat(text.replace('>', '').replace(',', '.')) || 0;
            return valNum > min;
        }
        if (text.startsWith('<=')) {
            const max = parseFloat(text.replace('<=', '').replace(',', '.')) || Infinity;
            return valNum <= max;
        }
        if (text.startsWith('<')) {
            const max = parseFloat(text.replace('<', '').replace(',', '.')) || Infinity;
            return valNum < max;
        }
        if (text === '>0' || text === '0' || text === 'cero') {
            return valNum > 0;
        }

        const target = parseFloat(text.replace(',', '.'));
        if (!isNaN(target)) {
            return Math.abs(valNum - target) < 0.01;
        }

        return true;
    }

    /**
     * Obtener el barrido completo de ofertas VIGENTES desde Supabase Cloud (Grilla B4.1)
     * Extrae con precisión empírica el 100% de los campos de datos_maestros.
     * Implementa patrón Stale-While-Revalidate para eliminar latencias de red percibidas.
     */
    async obtenerTablaMaestraSupabase(forzarRefresco = false) {
        const nowMs = Date.now();

        if (!forzarRefresco && this.cacheTablaMaestra) {
            if (nowMs - this.cacheTimestamp < this.CACHE_TTL_MS) {
                return this.cacheTablaMaestra;
            }
            // Caché expirado: revalidar en segundo plano sin bloquear la solicitud actual
            if (!this.refreshingPromise) {
                this.refreshingPromise = this._ejecutarBarridoSupabase().finally(() => {
                    this.refreshingPromise = null;
                });
            }
            return this.cacheTablaMaestra;
        }

        if (this.refreshingPromise) {
            return this.refreshingPromise;
        }

        this.refreshingPromise = this._ejecutarBarridoSupabase().finally(() => {
            this.refreshingPromise = null;
        });

        return this.refreshingPromise;
    }

    async _ejecutarBarridoSupabase() {
        const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
        if (!key) {
            console.warn('⚠️ [CONCILIACION] SUPABASE_SERVICE_KEY no configurada. Usando fallback de BD local.');
            return null;
        }

        const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
        
        let cotizacionesRaw = [];
        let offset = 0;
        let hasMore = true;

        const t0Supa = Date.now();

        while (hasMore && cotizacionesRaw.length < 10000) {
            const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=id,proveedor_id,nombre_proveedor,timestamp_extraccion,datos_maestros&limit=1000&offset=${offset}`;
            let response;
            try {
                response = await supabaseFetch(url, { headers }, 1, 300, 6000);
            } catch (fetchErr) {
                console.error(`⚠️ Error Supabase REST en offset ${offset}:`, fetchErr.message);
                break;
            }
            if (!response.ok) {
                console.error(`⚠️ Error Supabase REST (${response.status}):`, await response.text());
                break;
            }

            const rows = await response.json();
            cotizacionesRaw = cotizacionesRaw.concat(rows);

            if (rows.length < 1000) {
                hasMore = false;
            } else {
                offset += 1000;
            }
        }

        const duracionFetch = Date.now() - t0Supa;
        const now = new Date();
        const ofertasVigentes = [];

        for (const row of cotizacionesRaw) {
            const dm = row.datos_maestros || {};
            const estadoDelta = String(dm._estado_delta || '').toUpperCase().trim();

            // REGLA TÉCNICA OFICIAL TALLER V4.1: Excluir ofertas descontinuadas en 'BAJA'
            if (estadoDelta === 'BAJA') {
                continue;
            }

            // EXTRACCIÓN EMPÍRICA DE CLAVES AUDITADAS EN SUPABASE B4.1 (Manual Técnico Sección 2)
            const skuProveedorRaw = String(this.extraerDatoEmpirico(dm, ['codigo', 'sku', 'código'], 'N/D')).trim();
            const descProveedorRaw = String(this.extraerDatoEmpirico(dm, ['descripcion', 'nombre', 'producto'], 'Sin Descripción')).trim();
            const especificacionRaw = String(this.extraerDatoEmpirico(dm, ['especificacion', 'calibre', 'variedad', 'corte'], '')).trim();
            const marcaRaw = String(this.extraerDatoEmpirico(dm, ['marca'], '')).trim();
            const tipoEnvaseRaw = String(this.extraerDatoEmpirico(dm, ['tipo_envase', 'envase'], '')).trim();
            const paisOrigenRaw = String(this.extraerDatoEmpirico(dm, ['país_de_origen', 'pais_de_origen', 'procedencia'], '')).trim();
            const rubroProveedorRaw = String(this.extraerDatoEmpirico(dm, ['rubro', 'categoria', 'subrubro'], 'SIN RUBRO')).trim();
            const unidadStr = String(this.extraerDatoEmpirico(dm, ['unidad', 'ean-unidad', 'unidad_medida'], 'Kilogramo')).trim();
            
            // EXTRACCIÓN EMPÍRICA CLAVE DE BULTOS ('cant_bult', 'dun-bulto', 'cantidad_bultos')
            const cantBultosRaw = this.extraerDatoEmpirico(dm, ['cant_bult', 'dun-bulto', 'cantidad_bultos', 'cant_bultos', 'bultos', 'bulto'], 1);
            const cantBultos = Math.max(1, Math.round(this.limpiarYParsearNumero(cantBultosRaw, 1)));

            // EXTRACCIÓN EMPÍRICA CLAVE DE CANTIDAD VALOR/PESO ('cant_valor', 'cantidad_valor')
            const cantValorRaw = this.extraerDatoEmpirico(dm, ['cant_valor', 'cantidad_valor', 'cant_val', 'contenido', 'peso'], 1);
            const cantValor = Math.max(0.001, this.limpiarYParsearNumero(cantValorRaw, 1));

            // EXTRACCIÓN DE PESO UNITARIO FÍSICO ('peso_unitario', 'peso_unidad', 'peso')
            const pesoUnitarioRaw = this.extraerDatoEmpirico(dm, ['peso_unitario', 'peso_unidad', 'peso'], null);
            let pesoUnitarioVal = pesoUnitarioRaw !== null ? this.limpiarYParsearNumero(pesoUnitarioRaw, 0) : 0;

            // EXTRACCIÓN EMPÍRICA CLAVE DE PRECIO NETO ('precio', 'precio_s/iva_s/desc')
            const precioRaw = this.extraerDatoEmpirico(dm, ['precio', 'precio_s/iva_s/desc', 'precio_costo', 'costo'], 0);
            const precioRawVal = this.limpiarYParsearNumero(precioRaw, 0);

            // EXTRACCIÓN EMPÍRICA CLAVE DE PRECIO PROMOCIONAL Y CONDICIONES POR VOLUMEN (Manual Sección 4.3)
            const promoRaw = this.extraerDatoEmpirico(dm, ['promo', 'precio_promo', 'precio_promocional', 'descuento', 'precio_descuento'], null);
            let precioPromoRawVal = null;
            if (promoRaw !== null && promoRaw !== undefined && String(promoRaw).trim() !== '') {
                const numPromo = this.limpiarYParsearNumero(promoRaw, 0);
                if (numPromo > 0) {
                    precioPromoRawVal = numPromo;
                }
            }
            const reglaRaw = String(this.extraerDatoEmpirico(dm, ['regla', 'condicion_promo', 'escala'], '')).trim();
            const ivaRaw = String(this.extraerDatoEmpirico(dm, ['iva'], 'Sin IVA')).trim();

            const fechaActualizacionRaw = dm.ultima_actualizacion_origen || dm.fecha_modificacion_precio || row.timestamp_extraccion;
            const diasActualizacion = Math.max(0, Math.floor((now - new Date(fechaActualizacionRaw)) / (1000 * 60 * 60 * 24)));

            // APLICACIÓN ESTRICTA DE LA MATEMÁTICA DE CONVERSIÓN DE LOTES (Manual Técnico Sección 3)
            const uLower = unidadStr.toLowerCase().trim();
            const esModoGranel = uLower.includes('kilo') || uLower === 'kg' || uLower === 'kilos';
            const esModoGramos = uLower.includes('gram') || uLower === 'g' || uLower === 'gr';
            const esModoLitros = uLower.includes('litr') || uLower === 'l' || uLower === 'lt';

            let modoEmpaque = 'GRANEL';
            let pesoUnitarioFinal = 1.0;
            let kilosEmpaque = 1.0;
            let costoKiloCalculado = 0;
            let precioCostoBulto = 0;
            let costoKiloPromoCalculado = null;
            let precioCostoPromoBulto = null;
            let presentacionMaestraStr = '';

            if (esModoGranel) {
                // CASO A: MODO GRANEL / COMMODITY (unidad = 'Kilogramo')
                // cant_valor = Kilos totales del bulto cerrado
                // peso_unitario = 1.0 kg (factor neutro)
                // precio = Precio por KILOGRAMO
                modoEmpaque = 'GRANEL';
                pesoUnitarioFinal = 1.0;
                kilosEmpaque = cantValor; // Kilos totales por bulto = cant_valor * 1.0
                costoKiloCalculado = precioRawVal; // Costo por kilogramo = precio
                precioCostoBulto = precioRawVal * cantValor; // Costo de compra de 1 bulto cerrado

                if (precioPromoRawVal && precioPromoRawVal > 0) {
                    costoKiloPromoCalculado = precioPromoRawVal;
                    precioCostoPromoBulto = precioPromoRawVal * cantValor;
                }
                const envaseFmt = tipoEnvaseRaw ? ` (${tipoEnvaseRaw})` : '';
                presentacionMaestraStr = `${cantBultos} x ${cantValor.toFixed(2).replace(/\.00$/, '')} kg${envaseFmt}`;

            } else if (esModoGramos) {
                // MODO GRAMOS (ej: especias, rocío vegetal)
                modoEmpaque = 'ENVASADO';
                pesoUnitarioFinal = cantValor / 1000;
                kilosEmpaque = cantBultos * pesoUnitarioFinal;
                costoKiloCalculado = pesoUnitarioFinal > 0 ? (precioRawVal / pesoUnitarioFinal) : (precioRawVal * 1000);
                precioCostoBulto = precioRawVal * cantBultos;

                if (precioPromoRawVal && precioPromoRawVal > 0) {
                    costoKiloPromoCalculado = pesoUnitarioFinal > 0 ? (precioPromoRawVal / pesoUnitarioFinal) : (precioPromoRawVal * 1000);
                    precioCostoPromoBulto = precioPromoRawVal * cantBultos;
                }
                presentacionMaestraStr = `${cantBultos} x ${cantValor} gr (${(pesoUnitarioFinal * 1000).toFixed(0)}g)`;

            } else if (esModoLitros) {
                // MODO LITROS (aceites, bebidas)
                modoEmpaque = cantValor >= 5 ? 'GRANEL' : 'ENVASADO';
                pesoUnitarioFinal = pesoUnitarioVal > 0 ? pesoUnitarioVal : cantValor;
                kilosEmpaque = cantValor * pesoUnitarioFinal;
                costoKiloCalculado = pesoUnitarioFinal > 0 ? (precioRawVal / pesoUnitarioFinal) : precioRawVal;
                precioCostoBulto = precioRawVal * cantValor;

                if (precioPromoRawVal && precioPromoRawVal > 0) {
                    costoKiloPromoCalculado = pesoUnitarioFinal > 0 ? (precioPromoRawVal / pesoUnitarioFinal) : precioPromoRawVal;
                    precioCostoPromoBulto = precioPromoRawVal * cantValor;
                }
                presentacionMaestraStr = `${cantBultos} x ${cantValor} L${tipoEnvaseRaw ? ` (${tipoEnvaseRaw})` : ''}`;

            } else {
                // CASO B: MODO ENVASADO / FRACCIONADO / PACKS (unidad = 'Unidad')
                // cant_bult = 1 caja
                // cant_valor = Cantidad de unidades individuales contenidas dentro de la caja (ej: 48, 24, 12, 20)
                // peso_unitario = Peso físico en kilogramos de UNA SOLA unidad (ej: 0.17 para 170g; 0.1 para 100g; 0.25 para 250g)
                // precio = Precio unitario por CADA pieza / envase individual
                modoEmpaque = 'ENVASADO';
                if (pesoUnitarioVal > 0) {
                    pesoUnitarioFinal = pesoUnitarioVal;
                } else {
                    const matchPeso = `${descProveedorRaw} ${especificacionRaw}`.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?)/i);
                    if (matchPeso) {
                        const n = parseFloat(matchPeso[1].replace(',', '.'));
                        const u = matchPeso[2].toLowerCase();
                        pesoUnitarioFinal = u.startsWith('k') ? n : (n / 1000);
                    } else {
                        pesoUnitarioFinal = 1.0;
                    }
                }

                // Fórmulas matemáticas oficiales del Manual Técnico Sección 3.2:
                kilosEmpaque = cantValor * pesoUnitarioFinal; // Kilos Físicos Totales por Caja = cant_valor * peso_unitario

                // Detectar cajas subdivididas mayoristas (ej: SKU -32 = 3x2kg, -52 = 5x2kg, -425 = 4x2.5kg, -45 = 4x5kg) donde el precio de lista ya viene expresado por KG
                const sufijoSubdividido = `${cantValor}${String(pesoUnitarioFinal).replace(/[.,]/g, '')}`;
                const esBultoSubdivididoPrecioKilo = (pesoUnitarioFinal >= 2.0 && skuProveedorRaw.endsWith(`-${sufijoSubdividido}`));

                if (esBultoSubdivididoPrecioKilo) {
                    costoKiloCalculado = precioRawVal;
                    precioCostoBulto = precioRawVal * kilosEmpaque;
                    if (precioPromoRawVal && precioPromoRawVal > 0) {
                        costoKiloPromoCalculado = precioPromoRawVal;
                        precioCostoPromoBulto = precioPromoRawVal * kilosEmpaque;
                    }
                } else {
                    precioCostoBulto = precioRawVal * cantValor; // Costo de Compra de 1 Caja Cerrada = precio * cant_valor
                    costoKiloCalculado = pesoUnitarioFinal > 0 ? (precioRawVal / pesoUnitarioFinal) : precioRawVal; // Costo Equivalente por Kilogramo = precio / peso_unitario

                    if (precioPromoRawVal && precioPromoRawVal > 0) {
                        costoKiloPromoCalculado = pesoUnitarioFinal > 0 ? (precioPromoRawVal / pesoUnitarioFinal) : precioPromoRawVal;
                        precioCostoPromoBulto = precioPromoRawVal * cantValor;
                    }
                }

                const gUnit = (pesoUnitarioFinal * 1000).toFixed(0);
                const txtUnit = pesoUnitarioFinal >= 1 ? `${pesoUnitarioFinal} kg` : `${gUnit}g`;
                const envaseFmt = tipoEnvaseRaw ? ` [${tipoEnvaseRaw}]` : '';
                presentacionMaestraStr = `${cantBultos} x ${cantValor} u (${txtUnit} c/u)${envaseFmt}`;
            }

            const tienePromo = Boolean(precioPromoRawVal && precioPromoRawVal > 0);

            ofertasVigentes.push({
                id: row.id,
                proveedor_id: row.proveedor_id,
                proveedor_nombre: row.nombre_proveedor || 'Proveedor Supabase',
                codigo_proveedor: skuProveedorRaw,
                descripcion_proveedor: descProveedorRaw,
                especificacion: especificacionRaw,
                marca: marcaRaw,
                tipo_envase: tipoEnvaseRaw,
                pais_origen: paisOrigenRaw,
                modo_empaque: modoEmpaque,
                peso_unitario: pesoUnitarioFinal,
                precio_costo_bulto: precioCostoBulto,
                kilos_empaque: kilosEmpaque,
                cantidad_valor: cantValor,
                cantidad_bultos: cantBultos,
                unidad_medida: unidadStr,
                presentacion_maestra: presentacionMaestraStr,
                rubro_proveedor: rubroProveedorRaw,
                costo_kilo_calculado: costoKiloCalculado,
                precio_promo_kilo: costoKiloPromoCalculado,
                precio_promo_bulto: precioCostoPromoBulto,
                tiene_promo: tienePromo,
                regla: reglaRaw,
                iva: ivaRaw,
                tipo_precio: 'ESTANDAR',
                modo_precio: 'KILO',
                estado_delta: estadoDelta || 'LEGADO',
                fecha_actualizacion: fechaActualizacionRaw,
                antiguedad_dias: diasActualizacion,
                es_antigua: diasActualizacion > 45,
                etiqueta_antiguedad: diasActualizacion > 45 ? `⚠️ Hace ${diasActualizacion} días (Antigua)` : `🟢 Hace ${diasActualizacion} días`,
                origen_tabla: 'tabla_maestra_operativa'
            });
        }

        if (ofertasVigentes.length > 0 || !this.cacheTablaMaestra) {
            this.cacheTablaMaestra = ofertasVigentes;
            this.cacheTimestamp = Date.now();
        }
        console.log(`⚡ [CONCILIACION] Tabla Maestra V4.1 cargada en Memoria RAM: ${ofertasVigentes.length} ofertas vigentes (${duracionFetch}ms).`);

        return this.cacheTablaMaestra;
    }

    /**
     * Genera la lista de etiquetas/parámetros propuestos inicialmente por la IA evitando palabras que hacen ruido
     */
    generarEtiquetasPropuestas(articuloPrincipal, posicionesEstructuradas, descGenerada = '') {
        const tags = [];
        const palabrasRuido = ['uva', 'pasas de', 'frutas de', 'aceite de', 'harina de', 'semillas de'];

        // Excluir el eje 'calibre' como filtro literal obligatorio en Paso 1 porque los proveedores escriben '15+', '+15', '15 UP' o '88/110'
        // mientras el diccionario guarda '15 +' o '88 - 110'; el calibre se evalúa semánticamente en los bloques de clasificación.
        const posNucleo = posicionesEstructuradas.find(p =>
            !p.silencioso &&
            p.valor_bd &&
            p.valor_bd.length >= 3 &&
            String(p.eje_categoria || '').toLowerCase() !== 'calibre' &&
            !/^\d+\s*[\+\-\/]/i.test(String(p.valor_bd).trim())
        );
        if (posNucleo && posNucleo.valor_bd) {
            const valNorm = posNucleo.valor_bd.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            if (!palabrasRuido.includes(valNorm)) {
                tags.push({ texto: valNorm, columna: 'DESCRIPCION', modo: 'INCLUIR' });
            }
        }

        if (articuloPrincipal) {
            let artPrincNorm = articuloPrincipal.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            artPrincNorm = artPrincNorm.replace(/^pasas de\s*/, '').replace(/^frutas de\s*/, '').trim();
            
            if (artPrincNorm.includes('pasa')) {
                artPrincNorm = 'pasa';
            } else if (artPrincNorm === 'avellanas') {
                artPrincNorm = 'avellana';
            } else if (artPrincNorm === 'almendras') {
                artPrincNorm = 'almendra';
            } else if (artPrincNorm.startsWith('castanas')) {
                artPrincNorm = 'castana';
            } else if (artPrincNorm === 'ciruelas') {
                artPrincNorm = 'ciruela';
            } else if (artPrincNorm === 'datiles') {
                artPrincNorm = 'datil';
            } else if (artPrincNorm === 'higos') {
                artPrincNorm = 'higo';
            } else if (artPrincNorm === 'porotos') {
                artPrincNorm = 'poroto';
            } else if (artPrincNorm === 'garbanzos') {
                artPrincNorm = 'garbanzo';
            }

            if (artPrincNorm && !tags.some(t => t.texto === artPrincNorm) && !palabrasRuido.includes(artPrincNorm)) {
                tags.push({ texto: artPrincNorm, columna: 'DESCRIPCION', modo: 'INCLUIR' });
            }
        }

        if (tags.length === 0 && descGenerada) {
            const palabras = descGenerada.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter(p => p.length >= 3 && !palabrasRuido.includes(p));
            palabras.forEach(p => { 
                if (!tags.some(t => t.texto === p)) tags.push({ texto: p, columna: 'DESCRIPCION', modo: 'INCLUIR' }); 
            });
        }

        if (tags.length === 0) {
            tags.push({ texto: 'pasa', columna: 'DESCRIPCION', modo: 'INCLUIR' });
        }

        return tags;
    }

    /**
     * Normaliza un objeto o string tag al esquema completo { texto, columna, modo }
     */
    normalizarTagObjeto(t) {
        if (typeof t === 'object' && t !== null) {
            return {
                texto: String(t.texto || '').toLowerCase().trim(),
                columna: (t.columna || 'DESCRIPCION').toUpperCase(),
                modo: (t.modo || 'INCLUIR').toUpperCase()
            };
        }
        return {
            texto: String(t || '').toLowerCase().trim(),
            columna: 'DESCRIPCION',
            modo: 'INCLUIR'
        };
    }

    /**
     * Analiza un texto normalizado (sin tildes, minúsculas) y extrae sus atributos de proceso, corte, cáscara y naturaleza
     */
    analizarAtributosTexto(textoNorm) {
        const txtSinParaMix = String(textoNorm || '')
            .replace(/\bp\/mix\b|\bpara\s+mix\b|\bp\/\s*mezcla\b/gi, ' ');

        // Naturaleza de producto (derivados que no son el fruto/semilla natural)
        const esHarina = /\b(harina|har\.|farina|polvo|molid[oa]s?)\b/i.test(txtSinParaMix);
        const esSalvado = /\bsalvado\b/i.test(txtSinParaMix);
        const esAceite = /\b(aceites?|oleo)\b/i.test(txtSinParaMix) && !/\b(en\s+aceite|c\/aceite|con\s+aceite|sin\s+aceite|s\/aceite)\b/i.test(txtSinParaMix);
        const esBebida = /\b(leche|bebida|beb\.|jugo|biba|ades|tratenfu|vrink)\b/i.test(txtSinParaMix);
        const esPasta = /\b(pasta|manteca|mantequilla|untable|tahini|halawa)\b/i.test(txtSinParaMix);
        const esConfiteria = /\b(chocolate|choc\.|banad\w*|garrapinad\w*|acaramelad\w*|caramelizad\w*|turron\w*|crocante\w*|praline\w*|gragead\w*|cubiert[oa]s?\s+con)\b/i.test(txtSinParaMix);
        const esMix = /\b(mix|mezcla|granola|muesli|trail|cajun)\b/i.test(txtSinParaMix) ||
            /\b(mani|coco|pasas|almendras?|nuez|nueces|arandanos?|caju|avellanas?)\s*(?:&|y)\s*(mani|coco|pasas|almendras?|nuez|nueces|arandanos?|caju|avellanas?)\b/i.test(txtSinParaMix);

        // Cáscara vs Pelado (Si es harina, no asumir pelado/cáscara salvo mención explícita)
        const esSinCascaraExplicito = /\b(sin\s+cascara|s\/cascara|s\/casc|s\/cas|sin\s+piel|s\/piel|pelad[oa]s?|repelad[oa]s?|descascarad[oa]s?)\b/i.test(txtSinParaMix);
        const txtSinSinCascara = txtSinParaMix.replace(/\b(sin\s+cascara|s\/cascara|s\/casc|s\/cas|sin\s+piel|s\/piel)\b/gi, ' ');
        const esConCascara = !esSinCascaraExplicito && /\b(con\s+cascara|c\/cascara|c\/casc|c\/cas|cascara|peerless|34\+\+|36\+\+)\b/i.test(txtSinSinCascara);

        // Piel explícita (para almendras fileteadas o harinas de almendra: Con Piel vs Sin Piel)
        let pielStatus = '';
        if (/\b(con\s+piel|c\/piel)\b/i.test(txtSinParaMix)) {
            pielStatus = 'CON_PIEL';
        } else if (/\b(sin\s+piel|s\/piel|repelad[oa]s?|blanquead[oa]s?)\b/i.test(txtSinParaMix)) {
            pielStatus = 'SIN_PIEL';
        }

        // Proceso térmico y salado
        const tieneTostSalAbrev = /\b(tost\/sal|tost\s+y\s+sal|syt|t\/s)\b/i.test(txtSinParaMix);
        const esSinSal = /\b(sin\s+sal|s\/sal|s\/s)\b/i.test(txtSinParaMix);
        const txtSinSinSal = txtSinParaMix.replace(/\b(sin\s+sal|s\/sal|s\/s)\b/gi, ' ');

        const esTostado = tieneTostSalAbrev || /\b(tostad[oa]s?|totdo|tost\.?)\b/i.test(txtSinSinSal);
        const esFrito = /\b(frit[oa]s?)\b/i.test(txtSinSinSal);
        const esSalado = tieneTostSalAbrev || (!esSinSal && /\b(salad[oa]s?|c\/sal|con\s+sal|sal)\b/i.test(txtSinSinSal) && !/\bsal\s+(?:marina|rosada|fina|gruesa|entrefina|parrillera|himalaya|celta)\b/i.test(txtSinSinSal));

        let proceso = 'CRUDO';
        if ((esTostado || esFrito) && esSalado) {
            proceso = 'TOSTADO_Y_SALADO';
        } else if (esTostado && !esSalado) {
            proceso = 'TOSTADO_SIN_SAL';
        } else if (esFrito && !esSalado) {
            proceso = 'FRITO_SIN_SAL';
        } else if (esSalado) {
            // En pistachos y frutos secos con cáscara, "salado" implica tostado y salado
            if (/\bpistachos?\b/i.test(txtSinParaMix)) {
                proceso = 'TOSTADO_Y_SALADO';
            } else {
                proceso = 'SALADO';
            }
        }

        // Corte / Morfología física industrial de frutos secos (fileteado/laminado/cubeteado/granulado)
        const esCorteEspecial = /\b(filetead[oa]s?|laminad[oa]s?|cubetead[oa]s?|baston|efilad[oa]s?|granulad[oa]s?|picad[oa]s?)\b/i.test(txtSinParaMix);
        const esPartido = /\b(partid[oa]s?|ptda|part\.|quebrad[oa]s?|trozos?|granza|industri\w*|bakery|cuartos?|1\/4|halves\s*&\s*pieces|lwp|swp|sp|p3|b3|g3)\b/i.test(txtSinParaMix);

        let corte = 'ENTERO';
        if (esCorteEspecial) corte = 'CORTE_ESPECIAL';
        else if (esPartido) corte = 'PARTIDO';

        return {
            es_harina: esHarina,
            es_salvado: esSalvado,
            es_aceite: esAceite,
            es_bebida: esBebida,
            es_pasta: esPasta,
            es_confiteria: esConfiteria,
            es_mix: esMix,
            es_con_cascara: esConCascara,
            es_pelado_explicito: esSinCascaraExplicito,
            piel_status: pielStatus,
            es_tostado: esTostado,
            es_frito: esFrito,
            es_salado: esSalado,
            es_sin_sal: esSinSal,
            proceso,
            corte,
            es_corte_especial: esCorteEspecial,
            es_partido: esPartido
        };
    }

    /**
     * BLOQUE DE RAZONAMIENTO 2A: Extracción y Normalización de Calibre y Tamaño
     * Reconoce calibres numéricos (15+, +15, 15 UP, 13/15, 11/13, 9/11, 25/27, 27/30, 30/34, 88/110, 110/132, W4, W5, P3, G3, B3, W180..W450, N4)
     * y tamaños semánticos (Gigante/Jumbo, Grande, Mediana, Chica), traduciendo entre ambos según la entidad botánica.
     */
    analizarCalibreYTamano(textoNorm, entidad = '', posCalibreRaw = '', posTamanoRaw = '') {
        const calPosNorm = String(posCalibreRaw || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const tamPosNorm = String(posTamanoRaw || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const fullRaw = `${calPosNorm} ${tamPosNorm} ${textoNorm || ''}`;

        // Limpiar expresiones de peso/empaque (ej: '10 x 1 kg', '22.68kg', '1/4' de cuarto) para no confundir con calibres
        const cleanForCalibre = fullRaw
            .replace(/\b\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:kg|kilos?|g|grs?|gramos?|l|lt|u|unid\w*)?\b/gi, ' ')
            .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|kilos?|g|grs?|gramos?|l|lt|micrones|mic)\b/gi, ' ')
            .replace(/\b1\/4\b|\b1\/2\b|\b1\/8\b/g, ' ');

        let calibreCodigo = '';
        let calibreMin = null;
        let calibreMax = null;
        let esCalibreMas = false;

        // 1. Calibres W / LW y Grados de Partida (P3, G3, B3, LWP, SWP) de Castañas de Cajú (escala internacional completa)
        const matchW = cleanForCalibre.match(/\b((?:lw|slw|lbw|sw|dw|w)\s*(?:160|180|210|240|280|320|400|450|[1-5]s?))\b/i);
        if (matchW) {
            calibreCodigo = matchW[1].toUpperCase().replace(/\s+/g, '');
        } else if (entidad === 'castana') {
            const matchPartCaju = cleanForCalibre.match(/\b(p3|g3|b3|lwp|swp|sp)\b/i);
            if (matchPartCaju) {
                calibreCodigo = matchPartCaju[1].toUpperCase();
            }
        }

        // 2. Calibres abiertos superiores (15+, 15(+), +15, 15 UP, 34+, 34++, 36+, 36++)
        if (!calibreCodigo) {
            const matchPlus = cleanForCalibre.match(/(?:(?:\b|\+)(14|15|16|32|34|36|38)\s*(?:\(\+\)|\+\+|\+|\s+up\b)|\+\s*(14|15|16|32|34|36|38)\b)/i);
            if (matchPlus) {
                const num = parseInt(matchPlus[1] || matchPlus[2], 10);
                calibreCodigo = `${num}+`;
                calibreMin = num;
                calibreMax = num + 3;
                esCalibreMas = true;
            }
        }

        // 3. Calibres por rango (9/11, 9-11, 11/13, 13/15, 18/20, 20/22, 23/25, 25/27, 27/30, 30/32, 30/34, 32/34, 34/36, 36/40, 30/40, 40/50, 66/77, 70/80, 88/110, 110/132)
        if (!calibreCodigo) {
            const regexRange = /\b(\d{1,3})\s*(?:\/|-)\s*(\d{1,3})\b/g;
            let m;
            while ((m = regexRange.exec(cleanForCalibre)) !== null) {
                const n1 = parseInt(m[1], 10);
                const n2 = parseInt(m[2], 10);
                if (n1 >= 8 && n2 > n1 && (n2 - n1) <= 30) {
                    calibreCodigo = `${n1}/${n2}`;
                    calibreMin = n1;
                    calibreMax = n2;
                    break;
                }
            }
        }

        // 4. Calibres por Número (ej: Higo Turco Numero 4 / N4 / N° 2 / Garbanzo 8mm / 9mm)
        if (!calibreCodigo) {
            const matchNum = cleanForCalibre.match(/(?:(?:\bnumero|\bnro|\bn)\s*([1-9])\b|(?:n°|nº)\s*([1-9])\b)/i);
            if (matchNum && (entidad === 'higo' || cleanForCalibre.includes('numero') || cleanForCalibre.includes('turco') || cleanForCalibre.includes('protobene'))) {
                calibreCodigo = `N${matchNum[1] || matchNum[2]}`;
            } else if (entidad === 'garbanzo') {
                const matchMm = cleanForCalibre.match(/(?:\b([789]|10)\s*mm\b|(?:n°|nº|\bn)\s*([789]|10)\b)/i);
                if (matchMm) {
                    calibreCodigo = `${matchMm[1] || matchMm[2]}MM`;
                }
            }
        }

        // 5. Tamaño explícito en palabras
        let tamanoExplicito = '';
        if (/\b(gigantes?|jumbos?|colossal|extra\s+grandes?|super\s+grandes?)\b/i.test(cleanForCalibre)) {
            tamanoExplicito = 'GIGANTE';
        } else if (/\b(grandes?|large)\b/i.test(cleanForCalibre)) {
            tamanoExplicito = 'GRANDE';
        } else if (/\b(median[oa]s?|medios?|medium)\b/i.test(cleanForCalibre)) {
            tamanoExplicito = 'MEDIANA';
        } else if (/\b(chic[oa]s?|small|petit|mignon)\b/i.test(cleanForCalibre)) {
            tamanoExplicito = 'CHICA';
        }

        // 6. Inferir tamaño comercial según la escala técnica de cada fruto seco / desecado
        let tamanoInferido = '';
        if (calibreMin !== null) {
            if (entidad === 'avellana') {
                // Avellanas (diámetro en mm: mayor número = fruto más grande)
                if (calibreMin >= 15) tamanoInferido = 'GIGANTE';
                else if (calibreMin >= 13 && calibreMax <= 15) tamanoInferido = 'GRANDE';
                else if (calibreMin >= 11 && calibreMax <= 13) tamanoInferido = 'MEDIANA';
                else if (calibreMax <= 11) tamanoInferido = 'CHICA';
            } else if (entidad === 'almendra') {
                // Almendras (unidades por onza: menor número = fruto más grande)
                if (calibreMax <= 22) tamanoInferido = 'GIGANTE';
                else if (calibreMax <= 27) tamanoInferido = 'GRANDE';
                else if (calibreMin >= 26 && calibreMax <= 30) tamanoInferido = 'MEDIANA';
                else if (calibreMin >= 30) tamanoInferido = 'CHICA';
            } else if (entidad === 'ciruela') {
                // Ciruelas (unidades por lb/kg: menor número = fruto más grande)
                if (calibreMax <= 70) tamanoInferido = 'GRANDE';
                else if (calibreMin >= 65 && calibreMax <= 110) tamanoInferido = 'MEDIANA';
                else if (calibreMin >= 110) tamanoInferido = 'CHICA';
            } else if (entidad === 'nuez' || entidad === 'nueces') {
                // Nueces con cáscara (mm)
                if (calibreMin >= 36) tamanoInferido = 'GIGANTE';
                else if (calibreMin >= 32) tamanoInferido = 'GRANDE';
                else tamanoInferido = 'MEDIANA';
            }
        }

        const tamanoFinal = tamanoExplicito || tamanoInferido || '';
        const tamanoLabels = {
            'GIGANTE': 'Gigante',
            'GRANDE': 'Grande',
            'MEDIANA': 'Mediana',
            'CHICA': 'Chica'
        };

        let etiquetaCalibre = '';
        if (calibreCodigo && tamanoFinal) {
            etiquetaCalibre = `${calibreCodigo} (${tamanoLabels[tamanoFinal] || tamanoFinal})`;
        } else if (calibreCodigo) {
            etiquetaCalibre = calibreCodigo;
        } else if (tamanoFinal) {
            etiquetaCalibre = tamanoLabels[tamanoFinal] || tamanoFinal;
        }

        return {
            calibre_codigo: calibreCodigo,
            calibre_min: calibreMin,
            calibre_max: calibreMax,
            es_calibre_mas: esCalibreMas,
            tamano_explicito: tamanoExplicito,
            tamano_inferido: tamanoInferido,
            tamano_final: tamanoFinal,
            tiene_criterio: Boolean(calibreCodigo || tamanoFinal),
            etiqueta_calibre: etiquetaCalibre
        };
    }

    /**
     * Evalúa la compatibilidad de Calibre y Tamaño entre el Artículo Objetivo y una Oferta
     */
    evaluarCoincidenciaCalibre(calTarget, calOferta, entidad = '') {
        if (!calTarget || !calTarget.tiene_criterio) {
            return {
                estado: 'SIN_RESTRICCION',
                sub_orden: 1,
                es_compatible: true,
                motivo: ''
            };
        }

        if (!calOferta || !calOferta.tiene_criterio) {
            // En Castañas de Cajú cuando el artículo Búnker exige un calibre estricto (ej: W4, W5, P3),
            // las ofertas genéricas sin calibre declarado suelen corresponder a otro grado comercial y van a Nivel 2.
            if (entidad === 'castana' && calTarget.calibre_codigo) {
                return {
                    estado: 'DIFERENTE',
                    sub_orden: 4,
                    es_compatible: false,
                    motivo: `Sin calibre ${calTarget.etiqueta_calibre} explícito`
                };
            }
            return {
                estado: 'SIN_DATO_OFERTA',
                sub_orden: 3,
                es_compatible: true,
                motivo: 'Oferta sin calibre explícito'
            };
        }

        // 1. Coincidencia exacta de código de calibre (ej: '15+' === '15+', '25/27' === '25/27', '13/15' === '13/15', 'W4' === 'W4')
        if (calTarget.calibre_codigo && calOferta.calibre_codigo && calTarget.calibre_codigo === calOferta.calibre_codigo) {
            return {
                estado: 'EXACTO',
                sub_orden: 1,
                es_compatible: true,
                motivo: `Calibre Exacto ${calOferta.etiqueta_calibre}`
            };
        }

        // 1b. Equivalencia técnica internacional en Castañas de Cajú (W180<->W1, W210<->W2, W240<->W3, W320<->W4, W450<->W5)
        if (entidad === 'castana' && calTarget.calibre_codigo && calOferta.calibre_codigo) {
            const mapaEquivCaju = {
                'W1': 'W180', 'W180': 'W1',
                'W2': 'W210', 'W210': 'W2',
                'W3': 'W240', 'W240': 'W3',
                'W4': 'W320', 'W320': 'W4',
                'W5': 'W450', 'W450': 'W5'
            };
            if (mapaEquivCaju[calTarget.calibre_codigo] === calOferta.calibre_codigo) {
                return {
                    estado: 'COMPATIBLE_FUERTE',
                    sub_orden: 2,
                    es_compatible: true,
                    motivo: `Calibre Equivalente ${calOferta.etiqueta_calibre} (≈ ${calTarget.etiqueta_calibre})`
                };
            }
        }

        // 2. Si el target solo pidió tamaño por palabra (sin número, ej: 'Grande') y la oferta coincide en tamaño
        if (!calTarget.calibre_codigo && calTarget.tamano_final && calOferta.tamano_final === calTarget.tamano_final) {
            return {
                estado: 'EXACTO',
                sub_orden: 1,
                es_compatible: true,
                motivo: `Tamaño Exacto ${calOferta.etiqueta_calibre}`
            };
        }

        // 3. Coincidencia Fuerte Compatible (Calibres contiguos / equivalencia Grande-Gigante)
        // Ejemplo clave: Target es Avellana 15+ (Gigante / vinculada a 'Avellana Pelada Grande') y la oferta es 13/15 Grande
        const ambosGrandesOGigantes = (
            ['GIGANTE', 'GRANDE'].includes(calTarget.tamano_final) ||
            ['GIGANTE', 'GRANDE'].includes(calTarget.tamano_explicito) ||
            ['GIGANTE', 'GRANDE'].includes(calTarget.tamano_inferido)
        ) && (
            ['GIGANTE', 'GRANDE'].includes(calOferta.tamano_final) ||
            ['GIGANTE', 'GRANDE'].includes(calOferta.tamano_explicito) ||
            ['GIGANTE', 'GRANDE'].includes(calOferta.tamano_inferido)
        );

        const rangosSeTocanOSuperponen = (
            calTarget.calibre_min !== null &&
            calOferta.calibre_min !== null &&
            calOferta.calibre_max >= calTarget.calibre_min &&
            calOferta.calibre_min <= calTarget.calibre_max
        );

        const mismoTamanoExplicito = (
            calTarget.tamano_explicito &&
            calOferta.tamano_final &&
            calTarget.tamano_explicito === calOferta.tamano_final
        );

        if ((rangosSeTocanOSuperponen && calOferta.tamano_final !== 'CHICA') || ambosGrandesOGigantes || mismoTamanoExplicito) {
            return {
                estado: 'COMPATIBLE_FUERTE',
                sub_orden: 2,
                es_compatible: true,
                motivo: `Calibre Compatible ${calOferta.etiqueta_calibre}`
            };
        }

        // 4. Calibre o tamaño diferente (ej: 9/11 Chica o 11/13 Mediana cuando se busca 15+ Grande; 30/34 cuando se busca 25/27)
        return {
            estado: 'DIFERENTE',
            sub_orden: 4,
            es_compatible: false,
            motivo: `Otro Calibre: ${calOferta.etiqueta_calibre || calOferta.calibre_codigo || calOferta.tamano_final} (Buscado: ${calTarget.etiqueta_calibre})`
        };
    }

    /**
     * BLOQUE DE RAZONAMIENTO 2B: Extracción de Variedad, Morfología Específica, Color y Carozo/Semilla
     */
    extraerVariedadColorYSubtipo(textoNorm, entidad = '', posicionesMap = {}) {
        const varPos = String(posicionesMap.variedad || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const defPos = String(posicionesMap.definicion || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const colPos = String(posicionesMap.color || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const confPos = String(posicionesMap.conformacion || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const tratPos = String(posicionesMap.tratamiento || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const fantPos = String(posicionesMap['nom. fantasia'] || posicionesMap['nom. fantasía'] || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        const full = `${textoNorm || ''} ${varPos} ${defPos} ${colPos} ${confPos} ${tratPos} ${fantPos}`;

        // 1. Variedad canónica por familia/entidad
        let variedadCanonica = '';
        let variedadLabel = '';

        if (entidad === 'almendra') {
            if (/\b(non\s*pareil|nonpareil|nonparei|np)\b/i.test(full)) {
                variedadCanonica = 'NON_PAREIL';
                variedadLabel = 'Non Pareil';
            } else if (/\bguara\b/i.test(full)) {
                variedadCanonica = 'GUARA';
                variedadLabel = 'Guara';
            } else if (/\bcarmel\b/i.test(full)) {
                variedadCanonica = 'CARMEL';
                variedadLabel = 'Carmel';
            } else if (/\bindependence\b/i.test(full)) {
                variedadCanonica = 'INDEPENDENCE';
                variedadLabel = 'Independence';
            } else if (/\bsupreme\b/i.test(full)) {
                variedadCanonica = 'SUPREME';
                variedadLabel = 'Supreme';
            }
        } else if (entidad === 'ciruela') {
            if (/\bpresidente\b/i.test(full)) {
                variedadCanonica = 'PRESIDENTE';
                variedadLabel = 'Presidente';
            } else if (/\b(bombon|d['’´\s\/-]*agen|de\s+agen|dagen)\b/i.test(full)) {
                variedadCanonica = 'BOMBON_DAGEN';
                variedadLabel = "Bombón / D'Agen";
            }
        } else if (entidad === 'datil') {
            if (/\b(medjoul|medjool|medjouel|medj)\b/i.test(full)) {
                variedadCanonica = 'MEDJOUL';
                variedadLabel = 'Medjoul';
            } else if (/\bdeglet\b/i.test(full)) {
                variedadCanonica = 'DEGLET';
                variedadLabel = 'Deglet Noor';
            } else if (/\b(egipcio|kalite)\b/i.test(full)) {
                variedadCanonica = 'EGIPCIO_KALITE';
                variedadLabel = 'Egipcio / Kalite';
            }
        } else if (entidad === 'higo') {
            if (/\b(turc[oa]s?|protobene|smirna|esmirna|blanc[oa]s?)\b/i.test(full)) {
                variedadCanonica = 'TURCO';
                variedadLabel = 'Turco / Protobene';
            } else if (/\bnegr[oa]s?\b/i.test(full)) {
                variedadCanonica = 'NEGRO';
                variedadLabel = 'Higo Negro';
            }
        } else if (entidad === 'pasa' || entidad === 'pasas') {
            if (/\b(rubia\w*|rub\b|sultanina\w*|dorada\w*|golden\b)/i.test(full)) {
                variedadCanonica = 'RUBIA_SULTANINA';
                variedadLabel = 'Rubia / Sultanina';
            } else if (/\b(moscatel|mtel)\b/i.test(full)) {
                variedadCanonica = 'MOSCATEL';
                variedadLabel = 'Moscatel';
            } else if (/\b(flame|negr[oa]s?|thompson)\b/i.test(full)) {
                variedadCanonica = 'FLAME_NEGRA';
                variedadLabel = 'Negra / Flame';
            } else if (/\bjumbo\b/i.test(full)) {
                variedadCanonica = 'JUMBO';
                variedadLabel = 'Jumbo';
            }
        } else if (entidad === 'lenteja') {
            if (/\b(roj[oa]s?|turc[oa]s?|coral)\b/i.test(full)) {
                variedadCanonica = 'ROJA_TURCA';
                variedadLabel = 'Roja / Turca';
            } else if (/\blentejon(?:es)?\b/i.test(full)) {
                variedadCanonica = 'LENTEJON';
                variedadLabel = 'Lentejón';
            } else if (/\b(nacional|6\s*mm|comun|lentejas?\b)\b/i.test(full) && !/\blentejon/i.test(full)) {
                variedadCanonica = 'LENTEJA_COMUN';
                variedadLabel = 'Lenteja Común';
            }
        } else if (entidad === 'avena') {
            if (/\b(instantanea|inst\.?)\b/i.test(full)) {
                variedadCanonica = 'INSTANTANEA';
                variedadLabel = 'Instantánea';
            } else if (/\bfin[oa]s?\b/i.test(full)) {
                variedadCanonica = 'FINA';
                variedadLabel = 'Arrollada Fina';
            } else if (/\bgrues[oa]s?\b/i.test(full)) {
                variedadCanonica = 'GRUESA';
                variedadLabel = 'Arrollada Gruesa';
            } else if (/\btradicional\b/i.test(full)) {
                variedadCanonica = 'TRADICIONAL';
                variedadLabel = 'Tradicional';
            }
        } else if (entidad === 'garbanzo') {
            if (/\blechos[oa]\b/i.test(full)) {
                variedadCanonica = 'LECHOSO';
                variedadLabel = 'Lechoso';
            } else if (/\bsauco\b/i.test(full)) {
                variedadCanonica = 'SAUCO';
                variedadLabel = 'Sauco';
            }
        } else if (entidad === 'arroz') {
            if (/\bbasmati\b/i.test(full)) {
                variedadCanonica = 'BASMATI';
                variedadLabel = 'Basmati';
            } else if (/\bcarnaroli\b/i.test(full)) {
                variedadCanonica = 'CARNAROLI';
                variedadLabel = 'Carnaroli';
            } else if (/\byamani\b/i.test(full)) {
                variedadCanonica = 'YAMANI';
                variedadLabel = 'Yamaní';
            } else if (/\bsushi\b/i.test(full)) {
                variedadCanonica = 'SUSHI';
                variedadLabel = 'Sushi';
            } else if (/\b(calasparra|bomba)\b/i.test(full)) {
                variedadCanonica = 'CALASPARRA';
                variedadLabel = 'Calasparra / Bomba';
            } else if (/\bparboil\b/i.test(full)) {
                variedadCanonica = 'PARBOIL';
                variedadLabel = 'Parboil';
            } else if (/\bintegral\b/i.test(full)) {
                variedadCanonica = 'INTEGRAL';
                variedadLabel = 'Integral';
            } else if (/\b(doble\s+carolina|carolina)\b/i.test(full)) {
                variedadCanonica = 'CAROLINA';
                variedadLabel = 'Doble Carolina';
            } else if (/\b(largo\s+fino|00000)\b/i.test(full)) {
                variedadCanonica = 'LARGO_FINO';
                variedadLabel = 'Largo Fino';
            }
        } else if (entidad === 'sesamo') {
            if (/\bblanc[oa]\b/i.test(full)) {
                variedadCanonica = 'BLANCO';
                variedadLabel = 'Blanco';
            } else if (/\bnegr[oa]\b/i.test(full)) {
                variedadCanonica = 'NEGRO';
                variedadLabel = 'Negro';
            } else if (/\bintegral\b/i.test(full)) {
                variedadCanonica = 'INTEGRAL';
                variedadLabel = 'Integral';
            }
        } else if (entidad === 'poroto') {
            if (/\bpallares?\b/i.test(full)) {
                variedadCanonica = 'PALLARES';
                variedadLabel = 'Pallares';
            } else if (/\bsoja\b/i.test(full)) {
                variedadCanonica = 'SOJA';
                variedadLabel = 'Soja';
            } else if (/\bregina\b/i.test(full)) {
                variedadCanonica = 'REGINA';
                variedadLabel = 'Regina';
            } else if (/\bmanteca\b/i.test(full)) {
                variedadCanonica = 'MANTECA';
                variedadLabel = 'Manteca';
            } else if (/\blupin(?:es)?\b/i.test(full)) {
                variedadCanonica = 'LUPINES';
                variedadLabel = 'Lupines';
            } else if (/\b(alubia|blanc[oa]s?)\b/i.test(full)) {
                variedadCanonica = 'ALUBIA';
                variedadLabel = 'Alubia / Blanco';
            } else if (/\b(aduki|azuki)\b/i.test(full)) {
                variedadCanonica = 'ADUKI';
                variedadLabel = 'Aduki';
            } else if (/\b(cramberry|cranberry|negro|colorado|mung)\b/i.test(full)) {
                const mPor = full.match(/\b(cramberry|cranberry|negro|colorado|mung)\b/i);
                variedadCanonica = mPor[1].toUpperCase().replace('CRAMBERRY', 'CRANBERRY');
                variedadLabel = mPor[1];
            }
        } else if (entidad === 'azucar') {
            if (/\b(mascabo|muscovado)\b/i.test(full)) {
                variedadCanonica = 'MASCABO';
                variedadLabel = 'Mascabo';
            } else if (/\b(impalpable|glas|talco)\b/i.test(full)) {
                variedadCanonica = 'IMPALPABLE';
                variedadLabel = 'Impalpable';
            } else if (/\bde\s+coco\b/i.test(full)) {
                variedadCanonica = 'DE_COCO';
                variedadLabel = 'De Coco';
            } else if (/\bnegr[oa]\b/i.test(full)) {
                variedadCanonica = 'NEGRA';
                variedadLabel = 'Negra';
            } else if (/\b(comun|blanc[oa]|refinad[oa]|organic[oa]|san\s+isidro|ledesma)\b/i.test(full)) {
                variedadCanonica = 'BLANCA_ORGANICA';
                variedadLabel = 'Blanca / Orgánica';
            }
        } else if (entidad === 'coco') {
            if (/\b(desgrasad[oa]|low\s*fat|bajo\s+tenor)\b/i.test(full)) {
                variedadCanonica = 'LOW_FAT';
                variedadLabel = 'Desgrasado / Low Fat';
            } else if (/\b(high\s*fat|alto\s+tenor)\b/i.test(full)) {
                variedadCanonica = 'HIGH_FAT';
                variedadLabel = 'Alto Tenor / High Fat';
            }
        } else if (entidad === 'mani') {
            if (/\b(virginia|vgna)\b/i.test(full)) {
                variedadCanonica = 'VIRGINIA';
                variedadLabel = 'Virginia';
            } else if (/\brunner\b/i.test(full)) {
                variedadCanonica = 'RUNNER';
                variedadLabel = 'Runner';
            }
        } else if (entidad === 'arveja') {
            if (/\btexturizad[oa]s?\b/i.test(full)) {
                variedadCanonica = 'TEXTURIZADA';
                variedadLabel = 'Texturizada';
            }
        }

        // 2. Morfología específica (ej: Nuez Mariposa vs Cuarto; Almendra Ramillada vs Partida vs Entera; Coco Escamas vs Rallado)
        let morfologiaEspecifica = '';
        let morfologiaLabel = '';
        if (entidad === 'nuez' || entidad === 'nueces') {
            if (/\b(mariposas?|mpsa|halves|mitades)\b/i.test(full) && !/\bhalves\s*&\s*pieces\b/i.test(full)) {
                morfologiaEspecifica = 'MARIPOSA';
                morfologiaLabel = 'Mariposa';
            } else if (/\b(cuartos?|cuartillos?|quarters?|1\/4)\b/i.test(full)) {
                morfologiaEspecifica = 'CUARTO';
                morfologiaLabel = 'Cuarto';
            }
        } else if (entidad === 'almendra') {
            if (/\bramillad[oa]s?\b/i.test(full)) {
                morfologiaEspecifica = 'RAMILLADA';
                morfologiaLabel = 'Ramillada';
            } else if (/\b(filetead[oa]s?|laminad[oa]s?|efilad[oa]s?)\b/i.test(full)) {
                morfologiaEspecifica = 'FILETEADA';
                morfologiaLabel = 'Fileteada';
            } else if (/\b(cubetead[oa]s?|cubos?|baston)\b/i.test(full)) {
                morfologiaEspecifica = 'CUBETEADA';
                morfologiaLabel = 'Cubeteada';
            }
        } else if (entidad === 'coco') {
            if (/\b(escamas?|chips?|flakes?|laminas?)\b/i.test(full)) {
                morfologiaEspecifica = 'ESCAMAS';
                morfologiaLabel = 'Escamas / Chips';
            } else if (/\brallad[oa]s?\b/i.test(full)) {
                morfologiaEspecifica = 'RALLADO';
                morfologiaLabel = 'Rallado';
            }
        } else if (entidad === 'pasa' || entidad === 'pasas') {
            if (/\b(en\s+racimos?|racimos?)\b/i.test(full)) {
                morfologiaEspecifica = 'EN_RACIMO';
                morfologiaLabel = 'En Racimo';
            }
        }

        // 2b. Piel en Almendras Fileteadas o Harinas (Sin Piel / Repelada vs Con Piel)
        let pielStatus = '';
        let pielLabel = '';
        if (/\b(con\s+piel|c\/piel)\b/i.test(full)) {
            pielStatus = 'CON_PIEL';
            pielLabel = 'Con Piel';
        } else if (/\b(sin\s+piel|s\/piel|blanquead[oa]s?|repelad[oa]s?)\b/i.test(full)) {
            pielStatus = 'SIN_PIEL';
            pielLabel = 'Sin Piel';
        }

        // 3. Color específico (Especialmente en Nueces: Extra Light vs Light vs Ambar Light)
        let colorCanonico = '';
        let colorLabel = '';
        if (entidad === 'nuez' || entidad === 'nueces') {
            if (/\b(extra\s*light|extralight|exlight|ex\.?\s*light)\b/i.test(full)) {
                colorCanonico = 'EXTRA_LIGHT';
                colorLabel = 'Extra Light';
            } else if (/\b(ambar\s*light|amlight|amlght|light\s*ambar)\b/i.test(full)) {
                colorCanonico = 'AMBAR_LIGHT';
                colorLabel = 'Ámbar Light';
            } else if (/\b(light|lht)\b/i.test(full)) {
                colorCanonico = 'LIGHT';
                colorLabel = 'Light';
            }
        }

        // 4. Carozo / Semilla (Ciruelas, Dátiles, Pasas)
        let carozoSemilla = '';
        let carozoLabel = '';
        if (/\b(sin\s+carozo|s\/carozo|s\/cazo|s\/c|descarozad[oa]s?)\b/i.test(full)) {
            carozoSemilla = 'SIN_CAROZO';
            carozoLabel = 'Sin Carozo';
        } else if (/\b(con\s+carozo|c\/carozo|c\/zo|c\/car)\b/i.test(full)) {
            carozoSemilla = 'CON_CAROZO';
            carozoLabel = 'Con Carozo';
        } else if (/\b(sin\s+semillas?|s\/semillas?)\b/i.test(full)) {
            carozoSemilla = 'SIN_SEMILLA';
            carozoLabel = 'Sin Semilla';
        } else if (/\b(con\s+semillas?|c\/semillas?)\b/i.test(full)) {
            carozoSemilla = 'CON_SEMILLA';
            carozoLabel = 'Con Semilla';
        }

        return {
            variedad_canonica: variedadCanonica,
            variedad_label: variedadLabel,
            morfologia_especifica: morfologiaEspecifica,
            morfologia_label: morfologiaLabel,
            piel_status: pielStatus,
            piel_label: pielLabel,
            color_canonico: colorCanonico,
            color_label: colorLabel,
            carozo_semilla: carozoSemilla,
            carozo_label: carozoLabel
        };
    }

    /**
     * BLOQUE DE RAZONAMIENTO 3: Análisis de Estructura de Empaque (Granel Puro 1x10kg vs. Caja Fraccionada 10x1kg)
     */
    analizarEstructuraEmpaqueOferta(oferta, textoOfertaNorm) {
        const cantValor = Number(oferta.cantidad_valor || 1);
        const cantBultos = Number(oferta.cantidad_bultos || 1);
        const pesoUnit = Number(oferta.peso_unitario || 1);
        const kilosEmp = Number(oferta.kilos_empaque || 1);
        const modoEmp = String(oferta.modo_empaque || 'GRANEL').toUpperCase();

        // Detectar patrón explícito '10 x 1 kg', '10x1kg', '12 x 500g', '5 x 1 kg' en descripción o presentación
        const matchMultiPack = String(textoOfertaNorm || '').match(/\b(\d{1,2})\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?)\b/i);
        let esCajaFraccionadaTexto = false;
        let detalleFraccionado = '';

        if (matchMultiPack) {
            const unidades = parseInt(matchMultiPack[1], 10);
            const valorPeso = parseFloat(matchMultiPack[2].replace(',', '.'));
            const unidadPeso = matchMultiPack[3].toLowerCase();
            const pesoPorUnidadKg = unidadPeso.startsWith('k') ? valorPeso : (valorPeso / 1000);
            if (unidades >= 4 && pesoPorUnidadKg <= 2.0) {
                esCajaFraccionadaTexto = true;
                detalleFraccionado = `${unidades} x ${matchMultiPack[2]} ${unidadPeso}`;
            }
        }

        const esCajaFraccionadaEstructural = (
            (modoEmp === 'ENVASADO' && cantValor >= 4 && pesoUnit <= 2.0) ||
            (cantBultos >= 4 && cantValor <= 2.0 && kilosEmp >= 4)
        );

        const esCajaFraccionada = esCajaFraccionadaTexto || esCajaFraccionadaEstructural;
        if (esCajaFraccionada && !detalleFraccionado) {
            detalleFraccionado = oferta.presentacion_maestra || `${cantValor} u x ${pesoUnit} kg`;
        }

        return {
            es_caja_fraccionada: esCajaFraccionada,
            es_granel_puro: !esCajaFraccionada && kilosEmp >= 5,
            detalle_empaque: detalleFraccionado || oferta.presentacion_maestra || `${kilosEmp} kg`
        };
    }

    /**
     * Detecta con fronteras de palabra (\b) la entidad botánica/comercial canónica evitando falsos positivos (ej. 'yamani' != 'mani').
     */
    detectarEntidadBotanica(textoNorm, artPrincipalNorm = '') {
        const catalogoEntidades = [
            { canon: 'fruta nevada', regex: /\bfruta\s+nevada\b/i },
            { canon: 'escurrida', regex: /\b(escurrid[oa]s?|errda|abrillantad[oa]s?)\b/i },
            { canon: 'zapallo', regex: /\bzapallos?\b/i },
            { canon: 'nuez', regex: /\b(nuez|nueces)\b/i },
            { canon: 'almendra', regex: /\balmendras?\b/i },
            { canon: 'ciruela', regex: /\bciruelas?\b/i },
            { canon: 'castana', regex: /\b(castanas?|caju)\b/i },
            { canon: 'chia', regex: /\bchia\b/i },
            { canon: 'girasol', regex: /\bgirasol(?:es)?\b/i },
            { canon: 'lino', regex: /\blino\b/i },
            { canon: 'sesamo', regex: /\bsesamo\b/i },
            { canon: 'arroz', regex: /\barroz\b/i },
            { canon: 'mani', regex: /\b(mani|manies)\b/i },
            { canon: 'datil', regex: /\bdatil(?:es)?\b/i },
            { canon: 'coco', regex: /\bcoco\b/i },
            { canon: 'arandano', regex: /\barandanos?\b/i },
            { canon: 'banana', regex: /\bbananas?\b/i },
            { canon: 'avena', regex: /\bavenas?\b/i },
            { canon: 'quinoa', regex: /\b(quinoa|quinua)\b/i },
            { canon: 'higo', regex: /\bhigos?\b/i },
            { canon: 'damasco', regex: /\bdamascos?\b/i },
            { canon: 'tomate', regex: /\btomates?\b/i },
            { canon: 'lenteja', regex: /\b(lentejas?|lentejon(?:es)?)\b/i },
            { canon: 'garbanzo', regex: /\bgarbanzos?\b/i },
            { canon: 'poroto', regex: /\bporotos?\b/i },
            { canon: 'arveja', regex: /\barvejas?\b/i },
            { canon: 'pistacho', regex: /\bpistachos?\b/i },
            { canon: 'avellana', regex: /\bavellanas?\b/i },
            { canon: 'pasa', regex: /\b(pasas?|sultanina)\b/i },
            { canon: 'amaranto', regex: /\bamaranto\b/i },
            { canon: 'amapola', regex: /\bamapolas?\b/i },
            { canon: 'alpiste', regex: /\balpiste\b/i },
            { canon: 'mijo', regex: /\bmijo\b/i },
            { canon: 'pecan', regex: /\bpecan\b/i },
            { canon: 'macadamia', regex: /\bmacadamias?\b/i },
            { canon: 'cacao', regex: /\bcacao\b/i },
            { canon: 'kiwi', regex: /\bkiwis?\b/i },
            { canon: 'naranja', regex: /\bnaranjas?\b/i },
            { canon: 'anana', regex: /\b(ananas?|pina)\b/i },
            { canon: 'mango', regex: /\bmangos?\b/i },
            { canon: 'papaya', regex: /\bpapayas?\b/i },
            { canon: 'durazno', regex: /\bduraznos?\b/i },
            { canon: 'pera', regex: /\bperas?\b/i },
            { canon: 'manzana', regex: /\bmanzanas?\b/i },
            { canon: 'frutilla', regex: /\bfrutillas?\b/i },
            { canon: 'cereza', regex: /\bcerezas?\b/i },
            { canon: 'jengibre', regex: /\bjengibres?\b/i },
            { canon: 'azucar', regex: /\bazucar(?:es)?\b/i },
            { canon: 'panko', regex: /\bpanko\b/i },
            { canon: 'fecula', regex: /\bfeculas?\b/i },
            { canon: 'almidon', regex: /\balmidon(?:es)?\b/i },
            { canon: 'bicarbonato', regex: /\bbicarbonato\b/i },
            { canon: 'soja', regex: /\bsoja\b/i },
            { canon: 'maiz', regex: /\b(maiz|maices|pisingallo)\b/i },
            { canon: 'trigo', regex: /\btrigo\b/i },
            { canon: 'cebada', regex: /\bcebada\b/i },
            { canon: 'centeno', regex: /\bcenteno\b/i },
            { canon: 'miel', regex: /\bmiel\b/i },
            { canon: 'ajo', regex: /\bajos?\b/i },
            { canon: 'cebolla', regex: /\bcebollas?\b/i },
            { canon: 'curcuma', regex: /\bcurcuma\b/i },
            { canon: 'canela', regex: /\bcanela\b/i },
            { canon: 'oregano', regex: /\boregano\b/i },
            { canon: 'pimenton', regex: /\bpimenton\b/i },
            { canon: 'pimienta', regex: /\bpimientas?\b/i },
            { canon: 'comino', regex: /\bcomino\b/i },
            { canon: 'perejil', regex: /\bperejil\b/i },
            { canon: 'provenzal', regex: /\bprovenzal\b/i }
        ];

        // Caso especial: "Arándanos Pasas" / "Pasas de Arándano" es siempre arándano deshidratado, no pasa de uva
        if (/\barandanos?\b/i.test(textoNorm) || /\barandanos?\b/i.test(artPrincipalNorm)) {
            return 'arandano';
        }

        // Priorizar siempre el artículo principal canónico del Búnker si coincide (salvo el genérico 'pasas' cuando el texto especifica otra fruta)
        if (artPrincipalNorm && !/^pasas?$/i.test(artPrincipalNorm)) {
            for (const item of catalogoEntidades) {
                if (item.regex.test(artPrincipalNorm)) {
                    return item.canon;
                }
            }
        }
        for (const item of catalogoEntidades) {
            if (item.regex.test(textoNorm)) {
                return item.canon;
            }
        }
        if (artPrincipalNorm) {
            return artPrincipalNorm.trim();
        }
        return '';
    }

    /**
     * Verifica si una oferta de proveedor coincide con la entidad botánica objetivo (soportando plurales e irregulares como nuez/nueces, castaña/caju).
     */
    coincideEntidadEnOferta(entidadNorm, subEntidadTarget, textoOfertaNorm) {
        if (!entidadNorm) return false;
        const mapaRegex = {
            'nuez': /\b(nuez|nueces)\b/i,
            'nueces': /\b(nuez|nueces)\b/i,
            'castana': subEntidadTarget === 'CASTANA_PARA'
                ? /\b(castanas?\s+de\s+para|castanas?\s+para)\b/i
                : /\b(castanas?|caju)\b/i,
            'mani': /\b(mani|manies)\b/i,
            'maiz': /\b(maiz|maices|pisingallo)\b/i,
            'pasa': /\b(pasas?|sultanina|moscatel)\b/i,
            'pasas': /\b(pasas?|sultanina|moscatel)\b/i,
            'datil': /\bdatil(?:es)?\b/i,
            'escurrida': /\b(escurrid[oa]s?|abrillantad[oa]s?)\b/i,
            'lenteja': /\b(lentejas?|lentejon(?:es)?)\b/i,
            'quinoa': /\b(quinoa|quinua)\b/i,
            'anana': /\b(ananas?|pina)\b/i,
            'azucar': /\bazucar(?:es)?\b/i,
            'almendra': /\balmendras?\b/i,
            'avellana': /\bavellanas?\b/i,
            'ciruela': /\bciruelas?\b/i,
            'higo': /\bhigos?\b/i,
            'arandano': /\barandanos?\b/i,
            'damasco': /\bdamascos?\b/i,
            'garbanzo': /\bgarbanzos?\b/i,
            'poroto': /\bporotos?\b/i,
            'arveja': /\barvejas?\b/i,
            'pistacho': /\bpistachos?\b/i,
            'kiwi': /\bkiwis?\b/i,
            'naranja': /\bnaranjas?\b/i
        };
        const rx = mapaRegex[entidadNorm];
        if (rx) {
            if (!rx.test(textoOfertaNorm)) return false;
            if (entidadNorm === 'castana' && /\bcajun\b/i.test(textoOfertaNorm)) return false;
            return true;
        }
        const escaped = entidadNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const genericRx = new RegExp(`\\b${escaped}(?:s|es)?\\b`, 'i');
        return genericRx.test(textoOfertaNorm);
    }

    /**
     * Detecta si la oferta es un producto compuesto de OTRA materia prima donde la entidad buscada solo figura como agregado secundario
     * (ej: "Garbanzo cubierto con Sésamo" cuando se busca "Sésamo", o "Quinoa inflada pop con arándanos" cuando se busca "Arándanos").
     */
    esOfertaCompuestoAjeno(entidadNorm, descOfertaNorm, attrTarget = {}) {
        if (!entidadNorm || !descOfertaNorm || attrTarget.es_mix || attrTarget.es_confiteria) return false;
        const otrosSujetos = [
            'garbanzos?', 'quinoa', 'quinua', 'avenas?', 'arroz', 'cereales?', 'copos', 'inflad[oa]s?',
            'pop', 'galletitas?', 'granola', 'alfajor(?:es)?', 'turron(?:es)?', 'budin(?:es)?', 'pan', 'grisines?'
        ].filter(p => !p.startsWith(entidadNorm.slice(0, 4)));
        const patronOtroSujetoConTarget = new RegExp(`^\\s*(?:${otrosSujetos.join('|')})\\b.*\\b(?:con|y|sabor|cubiert[oa]s?\\s+con|rellen[oa]s?\\s+de)\\b`, 'i');
        if (patronOtroSujetoConTarget.test(descOfertaNorm)) return true;
        if (/\b(inflad[oa]s?\s+pop|pop\s+con|cubiert[oa]s?\s+con|rellen[oa]s?\s+de)\b/i.test(descOfertaNorm)) return true;
        return false;
    }

    /**
     * Verifica compatibilidad con los 14 rubros reales de la Tabla Maestra B4.1 en Supabase
     */
    esRubroCompatibleB41(rubroCanonico, rubroOferta, attrTarget = {}, entidadNorm = '') {
        if (!rubroOferta || rubroOferta === 'SIN RUBRO') return true;
        if (attrTarget.es_bebida) {
            return ['BEBIDAS', 'OTROS'].includes(rubroOferta);
        }
        if (attrTarget.es_aceite) {
            return ['ACEITES', 'REPOSTERIA', 'OTROS'].includes(rubroOferta);
        }
        if (attrTarget.es_harina) {
            return ['HARINAS', 'REPOSTERIA', 'CEREALES', 'LEGUMBRES', 'FRUTOS SECOS', 'SEMILLAS', 'CONDIMENTOS-ESPECIAS-HIERBAS', 'OTROS'].includes(rubroOferta);
        }
        if (attrTarget.es_confiteria) {
            return ['REPOSTERIA', 'FRUTOS SECOS', 'FRUTAS DESECADAS', 'OTROS'].includes(rubroOferta);
        }
        if (entidadNorm === 'escurrida') {
            return ['REPOSTERIA', 'FRUTAS DESECADAS', 'CONSERVAS', 'OTROS'].includes(rubroOferta);
        }
        if (!rubroCanonico) return true;

        const mapaCompatibles = {
            'FRUTOS SECOS': ['FRUTOS SECOS', 'REPOSTERIA', 'OTROS'],
            'FRUTAS DESECADAS': ['FRUTAS DESECADAS', 'FRUTOS SECOS', 'REPOSTERIA', 'OTROS'],
            'SEMILLAS': ['SEMILLAS', 'CEREALES', 'FRUTOS SECOS', 'LEGUMBRES', 'REPOSTERIA', 'OTROS'],
            'LEGUMBRES': ['LEGUMBRES', 'SEMILLAS', 'CEREALES', 'HARINAS', 'OTROS'],
            'CEREALES': ['CEREALES', 'SUSHI', 'SEMILLAS', 'HARINAS', 'REPOSTERIA', 'OTROS'],
            'HARINAS Y DERIVADOS': ['HARINAS', 'REPOSTERIA', 'CEREALES', 'LEGUMBRES', 'FRUTOS SECOS', 'SEMILLAS', 'OTROS'],
            'ESPECIAS Y CONDIMENTOS': ['CONDIMENTOS-ESPECIAS-HIERBAS', 'ESPECIAS', 'OTROS'],
            'ACEITES Y GRASAS': ['ACEITES', 'REPOSTERIA', 'OTROS'],
            'REPOSTERIA': ['REPOSTERIA', 'FRUTOS SECOS', 'FRUTAS DESECADAS', 'HARINAS', 'CEREALES', 'OTROS'],
            'BEBIDAS': ['BEBIDAS', 'OTROS']
        };
        const permitidos = mapaCompatibles[rubroCanonico];
        return permitidos ? permitidos.includes(rubroOferta) : (rubroOferta === rubroCanonico);
    }

    extraerFichaSemantica(artLamda) {
        const pd = artLamda.propiedades_dinamicas || {};
        const posicionesObj = pd.posiciones || {};
        const posicionesMap = {};
        const valoresPosiciones = [];

        Object.keys(posicionesObj).forEach(k => {
            const item = posicionesObj[k];
            if (item && typeof item === 'object' && item.valor) {
                const ejeKey = String(item.eje || '').toLowerCase().trim();
                posicionesMap[ejeKey] = item.valor;
                valoresPosiciones.push(item.valor);
                if (item.abreviatura) valoresPosiciones.push(item.abreviatura);
            }
        });

        const textoIngredienteVinc = String(artLamda.ingrediente_vinculado_nombre || '');
        const textoArticulosVinc = String(artLamda.articulos_vinculados_texto || '');
        const artPrincNorm = String(pd.articulo_principal || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

        const descRaw = `${artLamda.descripcion || ''} ${artLamda.descripcion_generada || ''} ${pd.articulo_principal || ''} ${valoresPosiciones.join(' ')} ${textoIngredienteVinc} ${textoArticulosVinc}`.toLowerCase();
        const descNorm = descRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // 1. Detectar entidad botánica/materia prima con fronteras estrictas de palabra (\b)
        let entidad = this.detectarEntidadBotanica(descNorm, artPrincNorm);

        // Sub-entidad para desambiguar especies distintas (ej: Castaña de Cajú vs Castaña de Pará, Nuez vs Nuez Pecán)
        let subEntidad = '';
        if (entidad === 'castana') {
            if (/\b(de\s+para|para)\b/i.test(descNorm) && !/\bpara\s+mix\b/i.test(descNorm)) {
                subEntidad = 'CASTANA_PARA';
            } else {
                subEntidad = 'CASTANA_CAJU';
            }
        } else if (entidad === 'nuez' || entidad === 'nueces') {
            if (/\bpecan\b/i.test(descNorm)) {
                subEntidad = 'NUEZ_PECAN';
            } else if (/\bmoscada\b/i.test(descNorm)) {
                subEntidad = 'NUEZ_MOSCADA';
            } else {
                subEntidad = 'NUEZ_COMUN';
            }
        }

        // 2. Detectar grado / calidad
        let grado = 'ESTANDAR';
        if (/\b(aa|doble a|super verde)\b/i.test(descNorm)) {
            grado = 'AA';
        } else if (/\b(solo a|grado a|calidad a)\b/i.test(descNorm) || (entidad === 'zapallo' && /\b\ba\b/i.test(descNorm))) {
            grado = 'A';
        } else if (/\b(grado b|calidad b)\b/i.test(descNorm)) {
            grado = 'B';
        }

        // 3. Analizar atributos profundos de proceso, corte, cáscara y naturaleza
        const attr = this.analizarAtributosTexto(descNorm);

        let estadoPartes = [];
        if (attr.es_harina) {
            estadoPartes.push('HARINA');
        } else if (attr.es_salvado) {
            estadoPartes.push('SALVADO');
        } else if (attr.es_aceite) {
            estadoPartes.push('ACEITE');
        } else if (attr.es_bebida) {
            estadoPartes.push('BEBIDA VEGETAL');
        } else {
            if (attr.proceso === 'TOSTADO_Y_SALADO') estadoPartes.push('TOSTADO Y SALADO');
            else if (attr.proceso === 'TOSTADO_SIN_SAL') estadoPartes.push('TOSTADO SIN SAL');
            else if (attr.proceso === 'FRITO_SIN_SAL') estadoPartes.push('FRITO');
            else if (attr.proceso === 'SALADO') estadoPartes.push('SALADO');
            else estadoPartes.push('CRUDO');

            if (attr.es_con_cascara) estadoPartes.push('CON CASCARA');
            else if (attr.es_pelado_explicito || ['almendra', 'nuez', 'nueces', 'castana', 'avellana', 'girasol'].includes(entidad)) {
                estadoPartes.push('PELADO');
            }
            if (attr.corte === 'PARTIDO') estadoPartes.push('PARTIDO');
            else if (attr.corte === 'CORTE_ESPECIAL') estadoPartes.push('CORTE ESPECIAL');
        }

        const estado = estadoPartes.join(' • ');

        // 4. Detectar Grado de Conformación Comercial / Físico
        let conformacion = 'ESTANDAR';
        if (REGEX_CONFORMACION_INDUSTRIA.test(descNorm) || attr.es_partido) {
            conformacion = 'INDUSTRIA_PARTIDO';
        } else if (REGEX_CONFORMACION_PREMIUM.test(descNorm)) {
            conformacion = 'ENTERO_PREMIUM';
        }

        // 5. Analizar Calibre, Tamaño, Variedad, Corte Específico, Color y Carozo
        const calibreInfo = this.analizarCalibreYTamano(
            descNorm,
            entidad,
            posicionesMap.calibre || '',
            posicionesMap.tamano || posicionesMap['tamaño'] || ''
        );
        const variedadInfo = this.extraerVariedadColorYSubtipo(descNorm, entidad, posicionesMap);

        // 6. Formato / Empaque (Distinguir Granel Puro vs Multi-Pack Fraccionado 10x1kg)
        const kilosUnidad = parseFloat(artLamda.kilos_unidad) || 1;
        const descVisibleNorm = `${artLamda.descripcion_generada || ''} ${artLamda.descripcion || ''}`.toLowerCase();
        const matchPackTarget = descVisibleNorm.match(/\b(\d{1,2})\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?)\b/i);
        let esTargetCajaFraccionada = false;
        if (matchPackTarget) {
            const u = parseInt(matchPackTarget[1], 10);
            const v = parseFloat(matchPackTarget[2].replace(',', '.'));
            const unit = matchPackTarget[3].toLowerCase();
            const kgUnit = unit.startsWith('k') ? v : (v / 1000);
            if (u >= 4 && kgUnit <= 2.0) {
                esTargetCajaFraccionada = true;
            }
        }
        const esGranel = (kilosUnidad >= 2) || Boolean(artLamda.es_ingrediente);
        // En el Taller LAMDA toda materia prima se abastece a granel (1x10kg / 1x22.68kg / 1x25kg) salvo que el artículo LAMDA sea explícitamente un multi-pack (ej. 10x1kg)
        const esTargetGranelPuro = !esTargetCajaFraccionada;

        // 7. Detectar rubro canónico oficial
        let rubroCanonico = '';
        if (attr.es_bebida) {
            rubroCanonico = 'BEBIDAS';
        } else if (attr.es_aceite) {
            rubroCanonico = 'ACEITES Y GRASAS';
        } else if (attr.es_harina || entidad === 'panko' || entidad === 'fecula' || entidad === 'almidon') {
            rubroCanonico = 'HARINAS Y DERIVADOS';
        } else if (['girasol', 'zapallo', 'chia', 'lino', 'sesamo', 'amaranto', 'amapola', 'alpiste', 'mijo'].includes(entidad)) {
            rubroCanonico = 'SEMILLAS';
        } else if (['nuez', 'nueces', 'almendra', 'castana', 'pistacho', 'avellana', 'mani', 'pecan', 'macadamia'].includes(entidad)) {
            rubroCanonico = 'FRUTOS SECOS';
        } else if (['ciruela', 'datil', 'arandano', 'banana', 'higo', 'damasco', 'pasas', 'pasa', 'kiwi', 'naranja', 'anana', 'mango', 'papaya', 'durazno', 'pera', 'manzana', 'frutilla', 'cereza', 'fruta nevada'].includes(entidad)) {
            rubroCanonico = 'FRUTAS DESECADAS';
        } else if (entidad === 'escurrida' || entidad === 'cacao' || entidad === 'azucar' || entidad === 'bicarbonato') {
            rubroCanonico = 'REPOSTERIA';
        } else if (['lenteja', 'garbanzo', 'poroto', 'arveja', 'soja'].includes(entidad)) {
            rubroCanonico = 'LEGUMBRES';
        } else if (['avena', 'quinoa', 'arroz', 'maiz', 'trigo', 'cebada', 'centeno'].includes(entidad)) {
            rubroCanonico = 'CEREALES';
        } else {
            const rubroArt = String(artLamda.rubro || artLamda.familia_nombre || '').toUpperCase().trim();
            if (rubroArt.includes('SEMILLA')) rubroCanonico = 'SEMILLAS';
            else if (rubroArt.includes('FRUTO')) rubroCanonico = 'FRUTOS SECOS';
            else if (rubroArt.includes('FRUTA')) rubroCanonico = 'FRUTAS DESECADAS';
            else if (rubroArt.includes('LEGUMB')) rubroCanonico = 'LEGUMBRES';
            else if (rubroArt.includes('CEREAL')) rubroCanonico = 'CEREALES';
            else if (rubroArt.includes('HARINA')) rubroCanonico = 'HARINAS Y DERIVADOS';
            else if (rubroArt.includes('ESPECIA') || rubroArt.includes('CONDIMENTO')) rubroCanonico = 'ESPECIAS Y CONDIMENTOS';
            else if (rubroArt.includes('ACEITE') || rubroArt.includes('GRASA')) rubroCanonico = 'ACEITES Y GRASAS';
            else if (rubroArt.includes('REPOST')) rubroCanonico = 'REPOSTERIA';
        }

        // 8. Construir los 4 Agentes / Bloques de Razonamiento Explícitos del Chofer IA para UI y Auditoría
        const detallesEspecificos = [];
        if (calibreInfo.etiqueta_calibre) detallesEspecificos.push(`Calibre/Tamaño: ${calibreInfo.etiqueta_calibre}`);
        if (variedadInfo.variedad_label) detallesEspecificos.push(`Variedad: ${variedadInfo.variedad_label}`);
        if (variedadInfo.morfologia_label) detallesEspecificos.push(`Corte: ${variedadInfo.morfologia_label}`);
        if (variedadInfo.piel_label) detallesEspecificos.push(`Piel: ${variedadInfo.piel_label}`);
        if (variedadInfo.color_label) detallesEspecificos.push(`Color: ${variedadInfo.color_label}`);
        if (variedadInfo.carozo_label) detallesEspecificos.push(variedadInfo.carozo_label);
        if (grado !== 'ESTANDAR') detallesEspecificos.push(`Grado: ${grado}`);

        const bloquesRazonamiento = [
            {
                paso: 1,
                icono: '🌱',
                titulo: 'Agente 1: Identidad y Estado Físico',
                valor: `${(entidad || 'Insumo').toUpperCase()} • ${estado}`,
                explicacion: attr.es_harina
                    ? 'Exige harina/molienda del insumo; descarta fruto entero, pastas y bebidas.'
                    : (attr.es_con_cascara
                        ? 'Exige fruto con cáscara; descarta pelados, harinas y compuestos ajenos.'
                        : 'Exige producto puro en el estado requerido; evalúa todos los proveedores (incluido el habitual).')
            },
            {
                paso: 2,
                icono: '📏',
                titulo: 'Agente 2: Calibre, Tamaño y Variedad',
                valor: detallesEspecificos.length > 0 ? detallesEspecificos.join(' • ') : 'Estándar de Línea',
                explicacion: calibreInfo.tiene_criterio
                    ? `Prioriza coincidencia fuerte con ${calibreInfo.etiqueta_calibre}${textoIngredienteVinc ? ` (Insumo: "${textoIngredienteVinc}")` : ''} y separa otros calibres en Nivel 2.`
                    : 'Prioriza coincidencia estricta de especie, variedad, morfología y corte comercial.'
            },
            {
                paso: 3,
                icono: '📦',
                titulo: 'Agente 3: Empaque y Proveedor Habitual',
                valor: esTargetGranelPuro
                    ? `Granel Puro (${artLamda.es_ingrediente ? 'Bulto Mayorista' : `${kilosUnidad} kg suelto`})`
                    : (esTargetCajaFraccionada ? `Caja Subdividida (${kilosUnidad} kg)` : `Presentación ${kilosUnidad} kg`),
                explicacion: esTargetGranelPuro
                    ? 'Incluye al Proveedor Habitual compitiendo de igual a igual y separa cajas fraccionadas (10 x 1kg) en Nivel 2.'
                    : 'Acepta presentaciones subdivididas o fraccionadas compatibles de todo el mercado.'
            },
            {
                paso: 4,
                icono: '⏳',
                titulo: 'Agente 4: Vigencia y Mejor $/kg',
                valor: 'Vigentes Arriba • Menor $/kg • Vencidas al Fondo',
                explicacion: 'Ordena por exactitud técnica y menor costo $/kg vigente (<= 45 días), desplazando cotizaciones vencidas a Nivel 4.'
            }
        ];

        return {
            entidad,
            sub_entidad: subEntidad,
            grado,
            estado,
            proceso: attr.proceso,
            corte: attr.corte,
            atributos: attr,
            calibre_info: calibreInfo,
            variedad_info: variedadInfo,
            conformacion,
            es_granel: esGranel,
            es_target_granel_puro: esTargetGranelPuro,
            es_target_caja_fraccionada: esTargetCajaFraccionada,
            es_ingrediente: Boolean(artLamda.es_ingrediente),
            ingrediente_vinculado_nombre: textoIngredienteVinc || null,
            kilos_unidad: kilosUnidad,
            rubro_canonico: rubroCanonico,
            nombre_referencia: artLamda.descripcion_generada || artLamda.descripcion || artLamda.articulo_id,
            bloques_razonamiento: bloquesRazonamiento
        };
    }

    /**
     * Búsqueda Semántica Autónoma por Comité de 4 Agentes del Chofer IA en Tabla Maestra B4.1
     * Evalúa el 100% del mercado activo (INCLUYENDO al Proveedor Habitual para no ocultar la mejor oferta)
     * y clasifica jerárquicamente en 4 Escalones de Pertinencia:
     * - Prioridad 1 (Coincidencia Fuerte Vigente: Mismo Producto, Calibre/Variedad Compatible y Granel Puro)
     * - Prioridad 2 (Variante Cercana Vigente: Otro Calibre ej. W1/W3/9-11, Otra Variedad o Caja Fraccionada 10x1kg)
     * - Prioridad 3 (Referencia Secundaria Vigente: Insumo Crudo cuando se busca Tostado o Grado Partido/Industria)
     * - Prioridad 4 (Ofertas Vencidas / Antiguas > 45 días: Rezagadas al fondo sin ocultarlas)
     */
    buscarAlternativasMercadoIA(ofertasRaw, fichaSemantica, contextoHabitual = null) {
        if (!fichaSemantica.entidad || !Array.isArray(ofertasRaw)) return [];

        const provHabitualNombre = typeof contextoHabitual === 'string'
            ? contextoHabitual
            : (contextoHabitual?.proveedorNombre || '');
        const provHabitualCodigo = typeof contextoHabitual === 'object' && contextoHabitual
            ? (contextoHabitual.productoCodigo || '')
            : '';
        const loteReciente = typeof contextoHabitual === 'object' && contextoHabitual
            ? (contextoHabitual.loteReciente || null)
            : null;

        const provHabitualNorm = provHabitualNombre.toLowerCase().trim();
        const codHabitualNorm = String(provHabitualCodigo || '').toLowerCase().trim();
        const entidadNorm = fichaSemantica.entidad.toLowerCase().trim();
        const subEntidadTarget = fichaSemantica.sub_entidad || '';
        const esGradoA = fichaSemantica.grado === 'A';
        const esGradoAA = fichaSemantica.grado === 'AA';
        const confTarget = fichaSemantica.conformacion || 'ESTANDAR';
        const procesoTarget = fichaSemantica.proceso || (fichaSemantica.estado && fichaSemantica.estado.includes('TOSTAD') ? (fichaSemantica.estado.includes('SALAD') ? 'TOSTADO_Y_SALADO' : 'TOSTADO_SIN_SAL') : 'CRUDO');
        const corteTarget = fichaSemantica.corte || 'ENTERO';
        const attrTarget = fichaSemantica.atributos || this.analizarAtributosTexto(`${fichaSemantica.nombre_referencia || ''} ${fichaSemantica.estado || ''}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
        const calTarget = fichaSemantica.calibre_info || { tiene_criterio: false };
        const varTarget = fichaSemantica.variedad_info || {};
        const esTargetProcesado = procesoTarget !== 'CRUDO';
        const esTargetGranelPuro = fichaSemantica.es_target_granel_puro !== false && Boolean(fichaSemantica.es_granel);
        const refNormTarget = String(fichaSemantica.nombre_referencia || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const kilosTarget = parseFloat(fichaSemantica.kilos_unidad) || 1;

        const candidatas = ofertasRaw.filter(o => {
            if (o.costo_kilo_calculado <= 0) return false;

            const desc = (o.descripcion_proveedor || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const espec = (o.especificacion || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const textoCompleto = `${desc} ${espec}`;
            const rubroOferta = (o.rubro_proveedor || '').toUpperCase().trim();

            // 1. Debe coincidir con la entidad botánica con fronteras de palabra y equivalencias plurales
            if (!this.coincideEntidadEnOferta(entidadNorm, subEntidadTarget, textoCompleto)) return false;

            // 1b. Descartar productos compuestos de otra materia prima donde la entidad solo es un agregado ("Garbanzo cubierto con sésamo", "Quinoa pop con arándanos")
            if (this.esOfertaCompuestoAjeno(entidadNorm, desc, attrTarget)) return false;

            // Desambiguación de sub-entidades botánicas (Castaña Cajú vs Pará, Nuez común vs Moscada/Pecán)
            if (subEntidadTarget === 'CASTANA_CAJU') {
                if (/\b(de\s+para|castanas?\s+para)\b/i.test(textoCompleto)) return false;
            } else if (subEntidadTarget === 'CASTANA_PARA') {
                if (!/\b(de\s+para|castanas?\s+para)\b/i.test(textoCompleto)) return false;
            } else if (subEntidadTarget === 'NUEZ_COMUN') {
                if (/\b(moscada|pecan)\b/i.test(textoCompleto)) return false;
            } else if (subEntidadTarget === 'NUEZ_PECAN') {
                if (!/\bpecan\b/i.test(textoCompleto)) return false;
            }

            // 2. Analizar atributos semánticos de la oferta
            const attrOferta = this.analizarAtributosTexto(textoCompleto);

            // 3. Validar compatibilidad con los rubros reales de Supabase B4.1
            if (!this.esRubroCompatibleB41(fichaSemantica.rubro_canonico, rubroOferta, attrTarget, entidadNorm)) {
                return false;
            }

            // Exclusión estricta por Naturaleza de Producto (Harina, Salvado, Aceite, Bebida, Pasta, Confitería/Bañados, Mixes)
            if (attrTarget.es_harina !== attrOferta.es_harina) return false;
            if (Boolean(attrTarget.es_salvado) !== Boolean(attrOferta.es_salvado)) return false;
            if (Boolean(attrTarget.es_aceite) !== Boolean(attrOferta.es_aceite)) return false;
            if (attrTarget.es_bebida !== attrOferta.es_bebida) return false;
            if (attrTarget.es_pasta !== attrOferta.es_pasta) return false;
            if (attrTarget.es_confiteria !== attrOferta.es_confiteria) return false;
            if (attrTarget.es_mix !== attrOferta.es_mix) return false;

            // 4. Descartar derivados procesados de cocina / conservas / golosinas / galletitas / barras / tés
            const permiteAlmibar = (entidadNorm === 'escurrida' || refNormTarget.includes('almibar'));
            const esTomateHumedo = (entidadNorm === 'tomate' && !refNormTarget.includes('triturad') && /\b(perita|triturad[oa]s?|salsa|extracto|pure|botella|lata)\b/i.test(textoCompleto));
            const esDerivadoProcesado = desc.includes('mermelad') ||
                                       (!permiteAlmibar && desc.includes('almibar')) ||
                                       esTomateHumedo ||
                                       desc.includes('pure') ||
                                       (!refNormTarget.includes('dulce') && desc.includes('dulce')) ||
                                       (!attrTarget.es_aceite && !refNormTarget.includes('aceite') && (desc.includes('aceite') || espec.includes('aceite'))) ||
                                       desc.includes('galletit') || desc.includes('gall.') ||
                                       /\b(barras?|barritas?)\b/i.test(desc) || desc.includes('rocio') ||
                                       desc.includes('pulpito') || desc.includes('paella') ||
                                       (!permiteAlmibar && desc.includes('conserva')) || desc.includes('rooibos') ||
                                       desc.includes('sabor ') ||
                                       (!refNormTarget.includes('esencia') && desc.includes('esencia')) ||
                                       espec.includes('galletit');
            if (esDerivadoProcesado) return false;

            // 5. Exclusión estricta de Cáscara vs Pelado (excepto en Harinas, Aceites, Bebidas o Pistachos):
            if (entidadNorm !== 'pistacho' && !attrTarget.es_harina && !attrTarget.es_aceite && !attrTarget.es_bebida) {
                if (attrTarget.es_con_cascara && !attrOferta.es_con_cascara) return false;
                if (!attrTarget.es_con_cascara && attrOferta.es_con_cascara) return false;
            }

            // 6. Exclusión de Cortes Industriales Especiales (Cubeteada, Fileteada, Laminada, Granulada) si el target NO lo es
            if (corteTarget !== 'CORTE_ESPECIAL' && attrOferta.es_corte_especial) {
                return false;
            }
            if (corteTarget === 'CORTE_ESPECIAL' && !attrOferta.es_corte_especial) {
                return false;
            }

            // 7. Reglas de Proceso Térmico y Salado:
            if (procesoTarget === 'CRUDO' && attrOferta.proceso !== 'CRUDO') {
                return false;
            }
            if (esTargetProcesado && corteTarget === 'ENTERO' && attrOferta.proceso === 'CRUDO' && attrOferta.corte === 'PARTIDO') {
                return false;
            }

            // 8. Discriminación quirúrgica de Calidad A vs AA
            const tieneAA = /\baa\b|\bdoble a\b/i.test(textoCompleto);
            if (esGradoA && tieneAA) return false;
            if (esGradoAA && !tieneAA) return false;

            // 9. Coherencia de Empaque Mayorista vs Minorista
            if (fichaSemantica.es_granel && !attrTarget.es_bebida && !attrTarget.es_aceite) {
                if (o.modo_empaque === 'ENVASADO' && o.peso_unitario < 0.9) return false;
                const esFrutaEspecial = ['kiwi', 'naranja', 'anana', 'mango', 'papaya', 'cereza', 'frutilla', 'fruta nevada', 'jengibre', 'escurrida'].includes(entidadNorm);
                let minKilos = 5.0;
                if ((esTargetProcesado && attrOferta.proceso !== 'CRUDO') || esFrutaEspecial) {
                    minKilos = 2.0;
                } else if (!fichaSemantica.es_ingrediente && kilosTarget > 0 && kilosTarget < 5.0) {
                    minKilos = Math.max(1.0, kilosTarget * 0.8);
                }
                if (o.kilos_empaque < minKilos) return false;
            }

            // NOTA ARQUITECTÓNICA CLAVE:
            // NO se excluye al proveedor habitual en Capa 4 (Chofer IA: Mercado).
            // El Chofer IA evalúa el 100% del mercado en igualdad de condiciones para recomendar siempre
            // el costo de reposición óptimo real (ej. Bavosi $9.604,30/kg en Castañas de Cajú W4),
            // identificándolo con insignia de Proveedor Habitual y su cotejo contra el último lote.
            return true;
        });

        // Evaluar cada oferta con los 4 Agentes de Razonamiento del Chofer IA
        const familiasExigenVariedadExplicita = ['poroto', 'arroz', 'azucar', 'arveja', 'lenteja'];

        const enriquecidas = candidatas.map(alt => {
            const descOferta = (alt.descripcion_proveedor || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const especOferta = (alt.especificacion || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const presOferta = (alt.presentacion_maestra || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const textoOferta = `${descOferta} ${especOferta}`;
            const provOfertaNorm = String(alt.proveedor_nombre || '').toLowerCase().trim();
            const codOfertaNorm = String(alt.codigo_proveedor || '').toLowerCase().trim();
            const attrOferta = this.analizarAtributosTexto(textoOferta);

            const esProvHabitual = Boolean(provHabitualNorm && provOfertaNorm.includes(provHabitualNorm));
            const esMismoSkuLote = Boolean(esProvHabitual && codHabitualNorm && codOfertaNorm === codHabitualNorm);

            let confOferta = 'ESTANDAR';
            if (REGEX_CONFORMACION_INDUSTRIA.test(textoOferta) || attrOferta.es_partido) {
                confOferta = 'INDUSTRIA_PARTIDO';
            } else if (REGEX_CONFORMACION_PREMIUM.test(textoOferta)) {
                confOferta = 'ENTERO_PREMIUM';
            }

            // Evaluación Agente 2: Calibre, Tamaño, Variedad, Morfología y Color
            const calOferta = this.analizarCalibreYTamano(textoOferta, entidadNorm, alt.especificacion || '', '');
            const evalCalibre = this.evaluarCoincidenciaCalibre(calTarget, calOferta, entidadNorm);
            const varOferta = this.extraerVariedadColorYSubtipo(textoOferta, entidadNorm, {});

            // Evaluación de discrepancias de Variedad / Corte específico / Piel / Color / Carozo
            const discrepanciasEspecificas = [];
            const aciertosEspecificos = [];
            let tieneMatchVariedadCorteExplicito = 0;

            if (evalCalibre.estado === 'EXACTO' && calOferta.etiqueta_calibre) {
                aciertosEspecificos.push(`Calibre Exacto ${calOferta.etiqueta_calibre}`);
            } else if (evalCalibre.estado === 'COMPATIBLE_FUERTE' && calOferta.etiqueta_calibre) {
                aciertosEspecificos.push(`Calibre Compatible ${calOferta.etiqueta_calibre}`);
            } else if (evalCalibre.estado === 'DIFERENTE') {
                const detalleCal = calOferta.etiqueta_calibre || calOferta.calibre_codigo || `Sin calibre ${calTarget.etiqueta_calibre}`;
                discrepanciasEspecificas.push(`📏 Otro Calibre: ${detalleCal}`);
            }

            if (varTarget.variedad_canonica) {
                if (varOferta.variedad_canonica && varOferta.variedad_canonica !== varTarget.variedad_canonica) {
                    discrepanciasEspecificas.push(`🌱 Otra Variedad: ${varOferta.variedad_label}`);
                } else if (varOferta.variedad_canonica === varTarget.variedad_canonica) {
                    aciertosEspecificos.push(`Variedad ${varOferta.variedad_label}`);
                    tieneMatchVariedadCorteExplicito += 2;
                } else if (['MEDJOUL', 'TURCO'].includes(varTarget.variedad_canonica) || familiasExigenVariedadExplicita.includes(entidadNorm)) {
                    discrepanciasEspecificas.push(`🌱 Sin variedad ${varTarget.variedad_label} explícita`);
                }
            } else if (entidadNorm === 'arveja' && varOferta.variedad_canonica === 'TEXTURIZADA') {
                discrepanciasEspecificas.push(`🌱 Derivado Texturizado`);
            }

            if (varTarget.morfologia_especifica) {
                if (varOferta.morfologia_especifica && varOferta.morfologia_especifica !== varTarget.morfologia_especifica) {
                    discrepanciasEspecificas.push(`🔪 Otro Corte: ${varOferta.morfologia_label}`);
                } else if (varOferta.morfologia_especifica === varTarget.morfologia_especifica) {
                    aciertosEspecificos.push(`Corte ${varOferta.morfologia_label}`);
                    tieneMatchVariedadCorteExplicito += 2;
                } else if (entidadNorm === 'coco' && varTarget.morfologia_especifica === 'ESCAMAS') {
                    discrepanciasEspecificas.push(`🔪 Sin corte Escamas/Chips explícito`);
                }
            } else if ((entidadNorm === 'pasa' || entidadNorm === 'pasas') && varOferta.morfologia_especifica === 'EN_RACIMO') {
                discrepanciasEspecificas.push(`🍇 Presentación Especial: En Racimo`);
            } else if (entidadNorm === 'coco' && !refNormTarget.includes('escama') && varOferta.morfologia_especifica === 'ESCAMAS') {
                discrepanciasEspecificas.push(`🔪 Otro Corte: Escamas / Chips`);
            }

            if (varTarget.piel_status && (attrTarget.es_harina || corteTarget === 'CORTE_ESPECIAL')) {
                if (varOferta.piel_status && varOferta.piel_status !== varTarget.piel_status) {
                    discrepanciasEspecificas.push(`🌰 ${varOferta.piel_label} (Buscado: ${varTarget.piel_label})`);
                } else if (varOferta.piel_status === varTarget.piel_status) {
                    aciertosEspecificos.push(varOferta.piel_label);
                    tieneMatchVariedadCorteExplicito += 1;
                }
            }

            if (varTarget.color_canonico) {
                if (varOferta.color_canonico && varOferta.color_canonico !== varTarget.color_canonico) {
                    discrepanciasEspecificas.push(`🎨 Otro Color: ${varOferta.color_label}`);
                } else if (varOferta.color_canonico === varTarget.color_canonico) {
                    aciertosEspecificos.push(`Color ${varOferta.color_label}`);
                    tieneMatchVariedadCorteExplicito += 1;
                }
            }

            if (varTarget.carozo_semilla) {
                if (varOferta.carozo_semilla && varOferta.carozo_semilla !== varTarget.carozo_semilla) {
                    discrepanciasEspecificas.push(`🍒 ${varOferta.carozo_label}`);
                } else if (varOferta.carozo_semilla === varTarget.carozo_semilla) {
                    aciertosEspecificos.push(varOferta.carozo_label);
                }
            }

            // Evaluación Agente 3: Empaque Granel Puro vs Caja Fraccionada (ej. 10 x 1 kg)
            const empaqueInfo = this.analizarEstructuraEmpaqueOferta(alt, `${textoOferta} ${presOferta}`);
            const penalizarPorFraccionado = (esTargetGranelPuro && empaqueInfo.es_caja_fraccionada);
            if (penalizarPorFraccionado) {
                discrepanciasEspecificas.push(`📦 Fraccionado: ${empaqueInfo.detalle_empaque} (Unidades de ${alt.peso_unitario || 1}kg)`);
            }

            const specClean = String(alt.especificacion || '').trim();
            const marcaClean = String(alt.marca || '').trim();
            const empaqueClean = String(alt.presentacion_maestra || '').trim();
            const precioFmt = `$${alt.costo_kilo_calculado.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}/kg`;

            let prioridadTecnica = 2;
            let subOrdenCalibre = evalCalibre.sub_orden || 2;
            let matchType = 'REFERENCIA_ESTANDAR';
            let badge = '📦 Referencia Mercado (Grado Estándar)';
            let justif = '';

            if (esTargetProcesado) {
                const mismoProceso = (attrOferta.proceso === procesoTarget);
                const ambosProcesados = (attrOferta.proceso !== 'CRUDO');
                const mismoCorte = (corteTarget === 'PARTIDO') ? true : (attrOferta.corte === corteTarget);
                const esBultoGrande = (alt.kilos_empaque || 0) >= 5;

                if (mismoProceso && mismoCorte && discrepanciasEspecificas.length === 0) {
                    prioridadTecnica = 1;
                    matchType = 'MATCH_DIRECTO';
                    const labelProc = procesoTarget === 'TOSTADO_Y_SALADO' ? 'Tostado y Salado' : 'Tostado sin Sal';
                    badge = esBultoGrande
                        ? `🎯 Coincidencia Fuerte: ${labelProc}${aciertosEspecificos.length ? ' • ' + aciertosEspecificos[0] : ''}`
                        : `🎯 Coincidencia Fuerte: ${labelProc} (${alt.kilos_empaque}kg)`;
                    justif = `🎯 Coincidencia Fuerte (${labelProc}${aciertosEspecificos.length ? ' • ' + aciertosEspecificos.join(' • ') : ''}): Oferta a ${precioFmt} (${empaqueClean}).`;
                } else if (mismoProceso && discrepanciasEspecificas.length > 0) {
                    prioridadTecnica = 2;
                    matchType = 'VARIANTE_CALIBRE_EMPAQUE';
                    badge = discrepanciasEspecificas.join(' • ');
                    justif = `🔄 Mismo proceso pero difiere en especificación (${discrepanciasEspecificas.join(', ')}): Alternativa a ${precioFmt} (${empaqueClean}).`;
                } else if (mismoProceso && !mismoCorte) {
                    prioridadTecnica = 2;
                    matchType = 'PROCESO_CERCANO';
                    badge = `🔄 Mismo Proceso • Corte ${attrOferta.corte === 'PARTIDO' ? 'Partido' : 'Entero'}`;
                    justif = `🔄 Mismo Proceso con otra morfología (${specClean || attrOferta.corte}): Alternativa a ${precioFmt} (${empaqueClean}).`;
                } else if (ambosProcesados) {
                    prioridadTecnica = 2;
                    matchType = 'PROCESO_CERCANO';
                    const labelAltProc = attrOferta.proceso === 'TOSTADO_Y_SALADO' ? 'Tostado y Salado' : (attrOferta.proceso === 'SALADO' ? 'Salado' : 'Tostado sin Sal');
                    badge = `🔥 Proceso Cercano: ${labelAltProc}`;
                    justif = `🔥 Variante de Tostadero (${labelAltProc}): Misma materia prima procesada (${specClean || 'sin sal/con sal'}) a ${precioFmt} (${empaqueClean}).`;
                } else {
                    prioridadTecnica = 3;
                    matchType = 'REFERENCIA_CRUDO';
                    badge = `🌾 Referencia Secundaria: Insumo Crudo (Sin Tostar)`;
                    justif = `🌾 Referencia de Materia Prima Cruda: Sin proceso de tostado (${specClean || 'Granel Crudo'}) a ${precioFmt} (${empaqueClean}).`;
                }
            } else {
                // === TARGET CRUDO (Comercialización Directa / Insumos Crudos) ===
                const esIngFabrica = Boolean(fichaSemantica.es_ingrediente);
                const conformacionCompatible = (
                    (confTarget === 'INDUSTRIA_PARTIDO' && confOferta === 'INDUSTRIA_PARTIDO') ||
                    (confTarget !== 'INDUSTRIA_PARTIDO' && (confOferta !== 'INDUSTRIA_PARTIDO' || esIngFabrica))
                );

                if (!conformacionCompatible) {
                    prioridadTecnica = 3;
                    matchType = confOferta === 'INDUSTRIA_PARTIDO' ? 'GRADO_INDUSTRIA' : 'GRADO_SUPERIOR';
                    badge = confOferta === 'INDUSTRIA_PARTIDO'
                        ? '🏭 Grado Industria / Partido (Otra Conformación)'
                        : '✨ Grado Entero / Superior (Otra Conformación)';
                    justif = `${badge}: ${specClean || 'Conformación alternativa'} a ${precioFmt} (${empaqueClean}).`;
                } else if (discrepanciasEspecificas.length > 0) {
                    prioridadTecnica = 2;
                    matchType = 'VARIANTE_CALIBRE_EMPAQUE';
                    badge = discrepanciasEspecificas.join(' • ');
                    justif = `🔄 Variante de Mercado (${discrepanciasEspecificas.join(' | ')}): Misma materia prima pero con distinta especificación o empaque a ${precioFmt} (${empaqueClean}).`;
                } else {
                    prioridadTecnica = 1;
                    matchType = 'MATCH_DIRECTO';

                    if (evalCalibre.estado === 'EXACTO' && calOferta.etiqueta_calibre) {
                        const extraVar = (varTarget.variedad_canonica && varOferta.variedad_canonica === varTarget.variedad_canonica) ? ` • ${varOferta.variedad_label}` : '';
                        badge = `🎯 Match Exacto: Calibre ${calOferta.etiqueta_calibre}${extraVar}`;
                        justif = `🎯 Coincidencia Fuerte Exacta: Mismo calibre (${calOferta.etiqueta_calibre}${extraVar}), estado y formato granel (${empaqueClean}) a ${precioFmt}.`;
                    } else if (evalCalibre.estado === 'COMPATIBLE_FUERTE' && calOferta.etiqueta_calibre) {
                        const extraVar = (varTarget.variedad_canonica && varOferta.variedad_canonica === varTarget.variedad_canonica) ? ` • ${varOferta.variedad_label}` : '';
                        badge = `🎯 Coincidencia Fuerte: Calibre ${calOferta.etiqueta_calibre}${extraVar}`;
                        justif = `🎯 Coincidencia Fuerte Compatible: Calibre/Tamaño directo (${calOferta.etiqueta_calibre}${extraVar}) en formato granel (${empaqueClean}) a ${precioFmt}.`;
                    } else if (aciertosEspecificos.length > 0) {
                        badge = `🎯 Coincidencia Fuerte: ${aciertosEspecificos.join(' • ')}`;
                        justif = `🎯 Coincidencia Fuerte (${aciertosEspecificos.join(' • ')}): Formato ${empaqueClean} a ${precioFmt}.`;
                    } else {
                        badge = '🎯 Coincidencia Fuerte: Granel Compatible';
                        justif = `🎯 Coincidencia Directa de Producto y Empaque (${empaqueClean}): ${specClean ? specClean + ' • ' : ''}Alternativa a ${precioFmt}.`;
                    }
                }
            }

            // Enriquecer con trazabilidad de Proveedor Habitual / Último Lote si corresponde
            let variacionVsLote = alt.variacion_vs_lote || null;
            if (esProvHabitual && loteReciente && (esMismoSkuLote || prioridadTecnica === 1)) {
                const costoLote = parseFloat(loteReciente.costo_kilo_al_momento || 0);
                const precioLista = parseFloat(alt.costo_kilo_calculado || 0);
                if (costoLote > 0) {
                    const diffMonto = precioLista - costoLote;
                    const diffPct = (diffMonto / costoLote) * 100;
                    variacionVsLote = {
                        costo_lote: costoLote,
                        precio_lista: precioLista,
                        diff_monto: diffMonto,
                        diff_pct: diffPct,
                        lote_codigo: loteReciente.lote_codigo_corto || loteReciente.lote_id_supabase,
                        fecha_lote: loteReciente.fecha_vinculacion,
                        remito: loteReciente.numero_remito
                    };
                }
            }

            if (esMismoSkuLote && !alt.es_antigua) {
                justif = `⭐ Proveedor Habitual (Mismo SKU #${alt.codigo_proveedor} del último lote en depósito) • ${justif}`;
            } else if (esProvHabitual && !alt.es_antigua) {
                justif = `⭐ Proveedor Habitual en Depósito • ${justif}`;
            }

            // Evaluación Agente 4: Vigencia Temporal (Ofertas vencidas > 45 días van al Escalón 4 al final de la solapa)
            let prioridadFinal = prioridadTecnica;
            if (alt.es_antigua) {
                prioridadFinal = 4;
                const resumenTecnico = (prioridadTecnica === 1)
                    ? `Coincidía con el artículo (${calOferta.etiqueta_calibre || 'Match Directo'})`
                    : (discrepanciasEspecificas.length > 0 ? discrepanciasEspecificas.join(' • ') : 'Referencia anterior');
                badge = `⏳ Oferta Vencida (${alt.antiguedad_dias}d) • ${resumenTecnico}`;
                justif = `⏳ Cotización Desactualizada (Hace ${alt.antiguedad_dias} días): ${resumenTecnico}. Se conserva abajo solo como referencia histórica (${precioFmt} • ${empaqueClean}).`;
                matchType = 'OFERTA_VENCIDA';
            }

            if (!justif) {
                justif = `🤖 Alternativa de Mercado (${marcaClean || empaqueClean}): ${precioFmt}.`;
            }

            const especificidadScore = aciertosEspecificos.length;

            return {
                ...alt,
                es_proveedor_habitual: esProvHabitual,
                es_mismo_sku_lote: esMismoSkuLote,
                variacion_vs_lote: variacionVsLote,
                proceso_oferta: attrOferta.proceso,
                corte_oferta: attrOferta.corte,
                calibre_oferta: calOferta.etiqueta_calibre || '',
                calibre_estado: evalCalibre.estado,
                es_caja_fraccionada: empaqueInfo.es_caja_fraccionada,
                conformacion_oferta: confOferta,
                conformacion_match: matchType,
                conformacion_badge: badge,
                prioridad_ia: prioridadFinal,
                prioridad_tecnica_base: prioridadTecnica,
                sub_orden_calibre: subOrdenCalibre,
                match_variedad_corte: tieneMatchVariedadCorteExplicito,
                especificidad_score: especificidadScore,
                justificacion: justif
            };
        });

        // Ordenamiento Multi-Criterio del Chofer IA:
        // 1° Escalón de Prioridad IA (1: Coincidencias Fuertes Vigentes, 2: Variantes de Calibre/Empaque Vigentes, 3: Secundarias, 4: Ofertas Vencidas al fondo)
        // 2° Dentro de Ofertas Vencidas (Nivel 4), poner primero las que sí coincidían técnicamente (prioridad_tecnica_base 1 antes que 2)
        // 3° Sub-orden de Calibre (1: Calibre Exacto ej. W4 / 15+ primero, 2: Calibre Compatible después, 3: Sin calibre especificado)
        // 4° Coincidencia explícita de Variedad / Corte específico antes que ofertas sin variedad declarada
        // 5° Menor costo por kilo (para que dentro del mismo nivel de exactitud gane siempre la reposición más competitiva, ej. Bavosi $9.604,30/kg)
        // 6° En empate de precio, priorizar mismo SKU del último lote / proveedor habitual y menor antigüedad
        enriquecidas.sort((a, b) => {
            if (a.prioridad_ia !== b.prioridad_ia) {
                return a.prioridad_ia - b.prioridad_ia;
            }
            if (a.prioridad_tecnica_base !== b.prioridad_tecnica_base) {
                return a.prioridad_tecnica_base - b.prioridad_tecnica_base;
            }
            if (a.sub_orden_calibre !== b.sub_orden_calibre) {
                return a.sub_orden_calibre - b.sub_orden_calibre;
            }
            if (b.match_variedad_corte !== a.match_variedad_corte) {
                return b.match_variedad_corte - a.match_variedad_corte;
            }
            if (Math.abs(a.costo_kilo_calculado - b.costo_kilo_calculado) > 0.01) {
                return a.costo_kilo_calculado - b.costo_kilo_calculado;
            }
            if (Boolean(b.es_mismo_sku_lote) !== Boolean(a.es_mismo_sku_lote)) {
                return Number(Boolean(b.es_mismo_sku_lote)) - Number(Boolean(a.es_mismo_sku_lote));
            }
            if (b.especificidad_score !== a.especificidad_score) {
                return b.especificidad_score - a.especificidad_score;
            }
            return a.antiguedad_dias - b.antiguedad_dias;
        });

        if (enriquecidas.length > 0 && enriquecidas[0].prioridad_ia === 1) {
            enriquecidas[0].es_recomendada_top = true;
        }

        return enriquecidas;
    }


    /**
     * Busca y clasifica deterministamente candidatos en Supabase B4.1 mediante Filtro Compuesto Unificado en 1 solo paso.
     * Lee directamente el costo_base de Single Source of Truth desde public.bunker_articulos.
     */
    async buscarCandidatosTablaMaestra(articuloId, tagsUsuario = null, opcionesAdicionales = {}) {
        const t0Inicio = Date.now();
        const criterioOrden = (opcionesAdicionales.criterio_orden || 'FECHA').toUpperCase();
        const excluirCero = opcionesAdicionales.excluir_cero !== false;

        const cleanArtId = String(articuloId).trim();
        const resArt = await pool.query(
            `SELECT ba.articulo_id, ba.descripcion, ba.descripcion_generada, ba.rubro, ba.sub_rubro, 
                    ba.costo_base, ba.kilos_unidad, ba.familia_id, ba.propiedades_dinamicas, ba.estrategia_busqueda_json,
                    bf.nombre as familia_nombre
             FROM public.bunker_articulos ba
             LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
             WHERE TRIM(ba.articulo_id) = $1 LIMIT 1`,
            [cleanArtId]
        );

        let artLamda = null;
        let esIngredienteDirecto = false;
        let ingredienteObj = null;

        if (resArt.rows.length > 0) {
            artLamda = resArt.rows[0];
            try {
                const resIngVinc = await pool.query(
                    `SELECT DISTINCT i.id, i.nombre
                     FROM public.ingredientes i
                     LEFT JOIN public.ingrediente_bunker_articulos iba ON iba.ingrediente_id = i.id
                     WHERE TRIM(i.articulo_vinculado_numero) = $1 OR TRIM(iba.bunker_articulo_id) = $1`,
                    [cleanArtId]
                );
                if (resIngVinc.rows.length > 0) {
                    artLamda.ingrediente_id = artLamda.ingrediente_id || resIngVinc.rows[0].id;
                    artLamda.ingrediente_vinculado_nombre = resIngVinc.rows.map(r => r.nombre).join(' • ');
                }
            } catch (eVinc) {
                console.warn('⚠️ [CONCILIACION] Aviso al consultar ingrediente vinculado:', eVinc.message);
            }
        } else {
            // Intentar resolver como ingrediente puro de fábrica (ej: 'ING-184' o '184')
            const cleanIngId = parseInt(cleanArtId.replace(/^ING-?/i, ''), 10);
            if (!isNaN(cleanIngId) && cleanIngId > 0) {
                const resIng = await pool.query(
                    `SELECT id, nombre, unidad_medida, costo_patron, stock_actual, categoria_id
                     FROM public.ingredientes
                     WHERE id = $1 LIMIT 1`,
                    [cleanIngId]
                );
                if (resIng.rows.length > 0) {
                    esIngredienteDirecto = true;
                    ingredienteObj = resIng.rows[0];

                    let pdHeredado = { articulo_principal: ingredienteObj.nombre };
                    let artsVincTexto = '';
                    let estrategiaHeredada = null;
                    try {
                        const resArtsVinc = await pool.query(
                            `SELECT DISTINCT ba.articulo_id, ba.descripcion, ba.descripcion_generada, ba.kilos_unidad, ba.propiedades_dinamicas, ba.estrategia_busqueda_json
                             FROM public.bunker_articulos ba
                             LEFT JOIN public.ingrediente_bunker_articulos iba ON TRIM(iba.bunker_articulo_id) = TRIM(ba.articulo_id)
                             LEFT JOIN public.ingredientes i ON TRIM(i.articulo_vinculado_numero) = TRIM(ba.articulo_id)
                             WHERE iba.ingrediente_id = $1 OR i.id = $1`,
                            [ingredienteObj.id]
                        );
                        if (resArtsVinc.rows.length > 0) {
                            const principalArt = resArtsVinc.rows.find(a => Number(a.kilos_unidad) >= 5) || resArtsVinc.rows[0];
                            if (principalArt && principalArt.propiedades_dinamicas) {
                                pdHeredado = {
                                    ...principalArt.propiedades_dinamicas,
                                    articulo_principal: principalArt.propiedades_dinamicas.articulo_principal || ingredienteObj.nombre
                                };
                            }
                            const artConEstrategia = resArtsVinc.rows.find(a => a.estrategia_busqueda_json && Array.isArray(a.estrategia_busqueda_json.tags_consolidados) && a.estrategia_busqueda_json.tags_consolidados.length > 0) || principalArt;
                            if (artConEstrategia && artConEstrategia.estrategia_busqueda_json) {
                                estrategiaHeredada = artConEstrategia.estrategia_busqueda_json;
                            }
                            artsVincTexto = resArtsVinc.rows.map(a => `${a.descripcion_generada || a.descripcion || ''}`).join(' ');
                        }
                    } catch (eArtsVinc) {
                        console.warn('⚠️ [CONCILIACION] Aviso al consultar artículos vinculados al ingrediente:', eArtsVinc.message);
                    }

                    artLamda = {
                        articulo_id: `ING-${ingredienteObj.id}`,
                        ingrediente_id: ingredienteObj.id,
                        es_ingrediente: true,
                        descripcion: ingredienteObj.nombre,
                        descripcion_generada: `${ingredienteObj.nombre} (Insumo de Fábrica)`,
                        rubro: 'INSUMOS DE FABRICA',
                        sub_rubro: 'INSUMOS DE FABRICA',
                        costo_base: parseFloat(ingredienteObj.costo_patron || 0),
                        kilos_unidad: 1.0,
                        familia_id: null,
                        familia_nombre: 'Insumos y Stock de Fábrica',
                        propiedades_dinamicas: pdHeredado,
                        articulos_vinculados_texto: artsVincTexto,
                        estrategia_busqueda_json: estrategiaHeredada
                    };
                }
            }
        }

        if (!artLamda) {
            throw new Error(`Artículo Búnker o Insumo ID '${articuloId}' no encontrado.`);
        }

        const pd = artLamda.propiedades_dinamicas || {};
        const posicionesRaw = pd.posiciones || {};
        const kilosUnidad = parseFloat(artLamda.kilos_unidad) || 1;
        const costoBaseActual = parseFloat(artLamda.costo_base) || 0;
        const costoKiloActual = kilosUnidad > 0 ? (costoBaseActual / kilosUnidad) : costoBaseActual;

        const estrategiaGuardada = artLamda.estrategia_busqueda_json || null;

        const posicionesEstructuradas = Object.keys(posicionesRaw)
            .map(k => {
                const item = posicionesRaw[k];
                return {
                    posicion_orden: item.posicion,
                    eje_categoria: item.eje,
                    valor_bd: item.valor,
                    abreviatura_bd: item.abreviatura,
                    silencioso: item.silencioso
                };
            })
            .sort((a, b) => a.posicion_orden - b.posicion_orden);

        const articuloPrincipalRaw = pd.articulo_principal || artLamda.sub_rubro || artLamda.descripcion || '';
        const descGeneradaRaw = artLamda.descripcion_generada || artLamda.descripcion || '';

        let tagsActivosFinales = [];
        let esRutaConsolidadaBD = false;

        if (Array.isArray(tagsUsuario)) {
            // El usuario envió explícitamente una lista de etiquetas (incluso vacía [] si eliminó todos los filtros)
            tagsActivosFinales = tagsUsuario.map(t => this.normalizarTagObjeto(t)).filter(t => t.texto);
            esRutaConsolidadaBD = false;
        } else if (typeof tagsUsuario === 'string' && tagsUsuario.trim() !== '') {
            tagsActivosFinales = tagsUsuario.toLowerCase().split(',').map(t => this.normalizarTagObjeto(t.trim())).filter(t => t.texto);
            esRutaConsolidadaBD = false;
        } else if (estrategiaGuardada && Array.isArray(estrategiaGuardada.tags_consolidados) && estrategiaGuardada.tags_consolidados.length > 0) {
            tagsActivosFinales = estrategiaGuardada.tags_consolidados.map(t => this.normalizarTagObjeto(t)).filter(t => t.texto);
            esRutaConsolidadaBD = true;
        } else if (artLamda.es_ingrediente) {
            const fichaIng = this.extraerFichaSemantica(artLamda);
            const attrIng = fichaIng.atributos || {};
            const tagsPropuestos = [];

            if (fichaIng.entidad) {
                tagsPropuestos.push({ texto: fichaIng.entidad, columna: 'DESCRIPCION', modo: 'INCLUIR' });
            }
            if (fichaIng.sub_entidad === 'CASTANA_PARA') {
                tagsPropuestos.push({ texto: 'para', columna: 'DESCRIPCION', modo: 'INCLUIR' });
            } else if (fichaIng.sub_entidad === 'CASTANA_CAJU') {
                tagsPropuestos.push({ texto: 'para', columna: 'DESCRIPCION', modo: 'EXCLUIR' });
            }

            if (attrIng.proceso === 'TOSTADO_Y_SALADO') {
                tagsPropuestos.push({ texto: 'tost', columna: 'DESCRIPCION', modo: 'INCLUIR' });
                tagsPropuestos.push({ texto: 'sal', columna: 'DESCRIPCION', modo: 'INCLUIR' });
            } else if (attrIng.proceso === 'TOSTADO_SIN_SAL') {
                tagsPropuestos.push({ texto: 'tost', columna: 'DESCRIPCION', modo: 'INCLUIR' });
                tagsPropuestos.push({ texto: 'salad', columna: 'DESCRIPCION', modo: 'EXCLUIR' });
            } else if (attrIng.proceso === 'SALADO') {
                tagsPropuestos.push({ texto: 'sal', columna: 'DESCRIPCION', modo: 'INCLUIR' });
            }

            if (tagsPropuestos.length === 0) {
                const stopWords = ['para', 'como', 'fabric', 'insum', 'puro', 'semilla', 'partido', 'partida', 'molido', 'molida', 'crudo', 'cruda', 'pelado', 'pelada'];
                const palabrasNombre = String(artLamda.descripcion || '')
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .replace(/\bp\/mix\b|\bpara\s+mix\b/g, ' ')
                    .split(/[\s/]+/)
                    .filter(w => w.length >= 4 && !stopWords.includes(w));

                tagsPropuestos.push(...palabrasNombre.map(w => ({ texto: w, columna: 'DESCRIPCION', modo: 'INCLUIR' })));
            }

            if (tagsPropuestos.length === 0) {
                const fallback = String(artLamda.descripcion || '')
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .split(/\s+/)
                    .find(w => w.length >= 4 && !['para', 'como', 'fabric', 'insum'].includes(w));
                tagsPropuestos.push({ texto: fallback || 'girasol', columna: 'DESCRIPCION', modo: 'INCLUIR' });
            }

            tagsActivosFinales = tagsPropuestos;
            esRutaConsolidadaBD = false;
        } else {
            tagsActivosFinales = this.generarEtiquetasPropuestas(articuloPrincipalRaw, posicionesEstructuradas, descGeneradaRaw);
            esRutaConsolidadaBD = false;
        }

        let ofertasRaw = await this.obtenerTablaMaestraSupabase(opcionesAdicionales.forzar_refresco || false);
        const totalEscaneadas = ofertasRaw ? ofertasRaw.length : 0;

        if (!ofertasRaw || ofertasRaw.length === 0) {
            const resMaestra = await pool.query(`
                SELECT ap.id, ap.proveedor_id, ap.codigo_proveedor, ap.descripcion_proveedor, 
                       ap.precio_costo, ap.fecha_actualizacion, ap.updated_at,
                       COALESCE(p.nombre, 'Proveedor Maestra') as proveedor_nombre
                FROM public.articulos_proveedor ap
                LEFT JOIN public.proveedores p ON p.id = ap.proveedor_id
                ORDER BY ap.fecha_actualizacion DESC
            `);
            ofertasRaw = resMaestra.rows.map(r => normalizarOfertaProveedor(r, kilosUnidad));
        }

        // EVALUACIÓN DEL FILTRO COMPUESTO UNIFICADO
        const paso1Capturados = ofertasRaw.filter(oferta => {
            if (excluirCero && (oferta.costo_kilo_calculado <= 0 || oferta.precio_costo_bulto <= 0)) {
                return false;
            }

            if (tagsActivosFinales.length === 0) {
                return true;
            }

            return tagsActivosFinales.every(tagObj => {
                const textRaw = String(tagObj.texto || '').trim().toLowerCase();
                const colTarget = (tagObj.columna || 'DESCRIPCION').toUpperCase();
                const modoFilter = (tagObj.modo || 'INCLUIR').toUpperCase();

                if (colTarget === 'PRECIO') {
                    const valPrecio = oferta.costo_kilo_calculado;
                    const matchNum = this.evaluarCondicionNumerica(valPrecio, textRaw);
                    return modoFilter === 'EXCLUIR' ? !matchNum : matchNum;
                }

                if (colTarget === 'CANTIDAD_BULTOS') {
                    const valBultos = oferta.cantidad_bultos;
                    const matchNum = this.evaluarCondicionNumerica(valBultos, textRaw);
                    return modoFilter === 'EXCLUIR' ? !matchNum : matchNum;
                }

                if (colTarget === 'CANTIDAD_VALOR') {
                    let valTarget = oferta.cantidad_valor !== undefined ? oferta.cantidad_valor : oferta.kilos_empaque;
                    let textoCondicion = textRaw;

                    if (/(?:kg|kilos?|k)\b/i.test(textoCondicion)) {
                        valTarget = oferta.kilos_empaque;
                        textoCondicion = textoCondicion.replace(/(?:kg|kilos?|k)\b/gi, '');
                    } else if (/(?:g|gr|gramos?)\b/i.test(textoCondicion)) {
                        valTarget = (oferta.unidad_medida && oferta.unidad_medida.toLowerCase().startsWith('gram'))
                            ? oferta.cantidad_valor
                            : (oferta.kilos_empaque * 1000);
                        textoCondicion = textoCondicion.replace(/(?:g|gr|gramos?)\b/gi, '');
                    }

                    const matchNum = this.evaluarCondicionNumerica(valTarget, textoCondicion);
                    return modoFilter === 'EXCLUIR' ? !matchNum : matchNum;
                }

                let textoEvaluado = '';
                if (colTarget === 'RUBRO') {
                    textoEvaluado = oferta.rubro_proveedor || '';
                } else if (colTarget === 'UNIDAD') {
                    textoEvaluado = oferta.unidad_medida || '';
                } else if (colTarget === 'CODIGO') {
                    textoEvaluado = oferta.codigo_proveedor || '';
                } else if (colTarget === 'PROVEEDOR') {
                    textoEvaluado = oferta.proveedor_nombre || '';
                } else if (colTarget === 'EMPAQUE') {
                    textoEvaluado = `${oferta.kilos_empaque} ${oferta.unidad_medida} ${oferta.presentacion_maestra}`;
                } else {
                    textoEvaluado = `${oferta.descripcion_proveedor || ''} ${oferta.especificacion || ''} ${oferta.marca || ''} ${oferta.proveedor_nombre || ''}`;
                }

                const tagTextoNorm = textRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const textoNorm = textoEvaluado.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const contieneMatch = textoNorm.includes(tagTextoNorm);

                if (modoFilter === 'EXCLUIR') {
                    return !contieneMatch;
                } else {
                    return contieneMatch;
                }
            });
        });

        const proveedoresConteo = {};
        paso1Capturados.forEach(o => {
            const pName = o.proveedor_nombre || 'Sin Proveedor';
            proveedoresConteo[pName] = (proveedoresConteo[pName] || 0) + 1;
        });

        // PASO 2: CLASIFICACIÓN NIVEL 1 VS NIVEL 2
        const nivel1Exacto = [];
        const nivel2Sugerencias = [];

        const descTargetLower = descGeneradaRaw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const esConCascaraTarget = descTargetLower.includes('cascara') || descTargetLower.includes('c/cas');
        const esGradoAATarget = descTargetLower.includes('aa') || descTargetLower.includes('doble a');
        const esRubiaTarget = descTargetLower.includes('rubia') || descTargetLower.includes('sultanina');
        const esMedjoolTarget = descTargetLower.includes('medjoul') || descTargetLower.includes('medjool');

        for (const oferta of paso1Capturados) {
            const descOfertaNorm = (oferta.descripcion_proveedor || '')
                .toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            let esExacto = false;
            let justificacion = '';

            if (esConCascaraTarget) {
                const tieneCascaraOferta = descOfertaNorm.includes('cascara') || descOfertaNorm.includes('c/cas') || descOfertaNorm.includes('34++') || descOfertaNorm.includes('36++');
                if (tieneCascaraOferta) {
                    esExacto = true;
                    justificacion = '🎯 Match Exacto: Entidad Nuez y conformación Con Cáscara.';
                } else {
                    esExacto = false;
                    justificacion = '💡 Sugerencia Alternativa: Misma entidad Nuez, pero presentación Pelada.';
                }
            } else if (esGradoAATarget) {
                if (descOfertaNorm.includes('aa')) {
                    esExacto = true;
                    justificacion = '🎯 Match Exacto: Coincidencia de Entidad y Grado Doble A (AA).';
                } else {
                    esExacto = false;
                    justificacion = '💡 Sugerencia Alternativa: Misma entidad, pero difiere en Grado.';
                }
            } else if (esRubiaTarget) {
                if (descOfertaNorm.includes('rubia') || descOfertaNorm.includes('rub') || descOfertaNorm.includes('sultanina')) {
                    esExacto = true;
                    justificacion = '🎯 Match Exacto: Pasas de Uva Variedad Rubia / Sultanina.';
                } else {
                    esExacto = false;
                    justificacion = '💡 Sugerencia Alternativa: Misma entidad Pasas, pero variedad Flame o Negra.';
                }
            } else if (esMedjoolTarget) {
                if (descOfertaNorm.includes('medjoul') || descOfertaNorm.includes('medjool') || descOfertaNorm.includes('medj')) {
                    esExacto = true;
                    justificacion = '🎯 Match Exacto: Dátil Variedad Medjool con carozo.';
                } else {
                    esExacto = false;
                    justificacion = '💡 Sugerencia Alternativa: Misma entidad Dátil, pero variedad Deglet Noor o Sin Carozo.';
                }
            } else if (tagsActivosFinales.length === 0) {
                esExacto = true;
                justificacion = 'ℹ️ Sin filtros aplicados (Oferta vigente de Tabla Maestra).';
            } else {
                esExacto = true;
                justificacion = `🎯 Match Exacto: Coincidencia de filtros de etiquetas activas.`;
            }

            if (oferta.especificacion && oferta.especificacion.trim() !== '' && oferta.especificacion.toLowerCase() !== 'sin especificacion') {
                justificacion += ` • 🔬 Esp: ${oferta.especificacion.trim()}`;
            }

            const candidato = {
                ...oferta,
                justificacion,
                nivel: esExacto ? 'MATCH_EXACTO' : 'SUGERENCIA_ALTERNATIVA'
            };

            if (esExacto) {
                nivel1Exacto.push(candidato);
            } else {
                nivel2Sugerencias.push(candidato);
            }
        }

        // ORDENAMIENTO DUAL INTERACTIVO (FECHA VS PRECIO) — Relegando siempre ofertas vencidas (>45 días) al fondo
        if (criterioOrden === 'PRECIO') {
            nivel1Exacto.sort((a, b) => (Number(Boolean(a.es_antigua)) - Number(Boolean(b.es_antigua))) || (a.costo_kilo_calculado - b.costo_kilo_calculado) || (a.antiguedad_dias - b.antiguedad_dias));
            nivel2Sugerencias.sort((a, b) => (Number(Boolean(a.es_antigua)) - Number(Boolean(b.es_antigua))) || (a.costo_kilo_calculado - b.costo_kilo_calculado) || (a.antiguedad_dias - b.antiguedad_dias));
        } else {
            nivel1Exacto.sort((a, b) => (Number(Boolean(a.es_antigua)) - Number(Boolean(b.es_antigua))) || (a.antiguedad_dias - b.antiguedad_dias) || (a.costo_kilo_calculado - b.costo_kilo_calculado));
            nivel2Sugerencias.sort((a, b) => (Number(Boolean(a.es_antigua)) - Number(Boolean(b.es_antigua))) || (a.antiguedad_dias - b.antiguedad_dias) || (a.costo_kilo_calculado - b.costo_kilo_calculado));
        }

        // Si no hay filtros activos (el usuario quitó todos los filtros para explorar la totalidad),
        // acotamos Nivel 1 a las primeras 200 ofertas para no sobrecargar el renderizado del DOM en el navegador.
        const nivel1Final = (tagsActivosFinales.length === 0 && nivel1Exacto.length > 200)
            ? nivel1Exacto.slice(0, 200)
            : nivel1Exacto;

        const duracionTotal = Date.now() - t0Inicio;

        // =========================================================================
        // ARQUITECTURA DE 4 CAPAS SELLADA: LOTES, HABITUAL, OPERADOR Y CHOFER IA
        // =========================================================================

        // 1. CAPA LOTES DE DEPÓSITO (Trazabilidad física de entradas)
        let lotesDeposito = [];
        try {
            const cleanIngIdStr = String(artLamda.ingrediente_id || cleanArtId.replace(/^ING-?/i, '').trim());
            const resLotes = await pool.query(`
                SELECT d.destino_id, d.costo_kilo_al_momento, v.lote_id_supabase, v.lote_codigo_corto, v.fecha_vinculacion,
                       v.impuesto_iva, v.costo_bruto_ingresado, v.cantidad_total_lote,
                       v.proveedor_nombre, v.articulo_descripcion, v.producto_codigo, v.numero_remito
                FROM public.bunker_lotes_destinos d
                JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                WHERE d.destino_id = $1 OR d.destino_id = $2 OR d.destino_id IN (
                    SELECT CAST(id AS TEXT) FROM public.ingredientes WHERE articulo_vinculado_numero = $1
                )
                ORDER BY v.fecha_vinculacion DESC
            `, [cleanArtId, cleanIngIdStr]);
            lotesDeposito = resLotes.rows;
        } catch (errLotes) {
            console.error('⚠️ [CONCILIACION] Error al consultar lotes locales:', errLotes.message);
        }

        const loteReciente = lotesDeposito.length > 0 ? lotesDeposito[0] : null;
        const proveedorHabitualNombre = loteReciente ? (loteReciente.proveedor_nombre || '') : '';
        const proveedorHabitualCodigo = loteReciente ? (loteReciente.producto_codigo || '') : '';

        // 2. CAPA PROVEEDOR HABITUAL (Cotejo de Lista Maestra vs. Último Lote)
        const capaHabitual = [];
        if (proveedorHabitualNombre && Array.isArray(ofertasRaw)) {
            const provHabLower = proveedorHabitualNombre.toLowerCase().trim();
            const codHabLower = (proveedorHabitualCodigo || '').toLowerCase().trim();

            // Priorizar coincidencia exacta por código SKU del proveedor
            const exactCodeMatches = ofertasRaw.filter(o => {
                const provO = (o.proveedor_nombre || '').toLowerCase().trim();
                const codO = (o.codigo_proveedor || '').toLowerCase().trim();
                return provO.includes(provHabLower) && codHabLower && (codO === codHabLower);
            });

            const candidatasHabitual = exactCodeMatches.length > 0 
                ? exactCodeMatches 
                : ofertasRaw.filter(o => {
                    const provO = (o.proveedor_nombre || '').toLowerCase().trim();
                    const descO = (o.descripcion_proveedor || '').toLowerCase();
                    return provO.includes(provHabLower) && loteReciente && loteReciente.articulo_descripcion &&
                           descO.includes(loteReciente.articulo_descripcion.toLowerCase().trim());
                });

            candidatasHabitual.forEach(o => {
                const costoLote = loteReciente ? parseFloat(loteReciente.costo_kilo_al_momento || 0) : 0;
                const precioLista = parseFloat(o.costo_kilo_calculado || 0);
                const diffMonto = precioLista - costoLote;
                const diffPct = costoLote > 0 ? ((diffMonto / costoLote) * 100) : 0;

                capaHabitual.push({
                    ...o,
                    variacion_vs_lote: {
                        costo_lote: costoLote,
                        precio_lista: precioLista,
                        diff_monto: diffMonto,
                        diff_pct: diffPct,
                        lote_codigo: loteReciente.lote_codigo_corto || loteReciente.lote_id_supabase,
                        fecha_lote: loteReciente.fecha_vinculacion,
                        remito: loteReciente.numero_remito
                    }
                });
            });
        }

        // 3. CAPA CHOFER IA (Comité de 4 Agentes sobre el 100% del Mercado incluyendo Proveedor Habitual)
        const fichaSemantica = this.extraerFichaSemantica(artLamda);
        const capaChoferIA = this.buscarAlternativasMercadoIA(ofertasRaw, fichaSemantica, {
            proveedorNombre: proveedorHabitualNombre,
            productoCodigo: proveedorHabitualCodigo,
            loteReciente
        });
        const recomendacionTopIA = capaChoferIA.find(c => c.prioridad_ia === 1) || capaChoferIA[0] || null;

        const historialInicial = [
            {
                paso: 1,
                nombre: esRutaConsolidadaBD 
                    ? `⭐ Filtro Compuesto Unificado en BD [ ${estrategiaGuardada.estrategia_id} ] (${paso1Capturados.length} ofertas, ${duracionTotal}ms)`
                    : tagsActivosFinales.length === 0
                        ? `Paso 1: Sin filtros (Todas las ofertas vigentes: ${paso1Capturados.length}, ${duracionTotal}ms)`
                        : `Paso 1: Filtro Compuesto Unificado (${paso1Capturados.length} ofertas, ${duracionTotal}ms)`,
                tipo: esRutaConsolidadaBD ? 'CONSOLIDADA_BD' : 'ETIQUETAS',
                filas_restantes: paso1Capturados.length
            }
        ];

        return {
            articulo_lamda: {
                articulo_id: artLamda.articulo_id,
                ingrediente_id: artLamda.ingrediente_id || null,
                es_ingrediente: Boolean(artLamda.es_ingrediente),
                descripcion: descGeneradaRaw,
                familia: artLamda.familia_nombre || artLamda.rubro,
                articulo_principal: articuloPrincipalRaw,
                costo_base_actual: costoBaseActual,
                costo_kilo_actual: costoKiloActual,
                kilos_unidad: kilosUnidad,
                posiciones_jerarquicas: posicionesEstructuradas,
                tags_activos_paso_1: tagsActivosFinales,
                es_ruta_consolidada_bd: esRutaConsolidadaBD,
                estrategia_guardada: estrategiaGuardada,
                criterio_orden_actual: criterioOrden,
                excluir_cero_actual: excluirCero
            },
            total_escaneadas: totalEscaneadas,
            paso_1_capturados: paso1Capturados.length,
            proveedores_conteo: proveedoresConteo,

            // === ARQUITECTURA DE 4 CAPAS SELLADA ===
            capa_lotes: lotesDeposito,
            capa_habitual: capaHabitual,
            capa_operador: {
                exactos: nivel1Final,
                sugerencias: nivel2Sugerencias,
                tags_activos: tagsActivosFinales,
                es_ruta_consolidada: esRutaConsolidadaBD
            },
            capa_chofer_ia: capaChoferIA,
            recomendacion_principal_ia: recomendacionTopIA,
            ficha_semantica_ia: fichaSemantica,

            // Retrocompatibilidad garantizada con UI existente
            nivel_1_exacto: nivel1Final,
            nivel_2_sugerencias: nivel2Sugerencias,
            historial_lotes_recientes: lotesDeposito,
            total_candidatos: nivel1Final.length + nivel2Sugerencias.length,
            historial_capas: historialInicial,
            tiempo_ejecucion_ms: duracionTotal
        };
    }

    /**
     * Guarda la estrategia de búsqueda consolidada en PostgreSQL bunker_articulos.estrategia_busqueda_json
     */
    async guardarEstrategiaConsolidada(articuloId, tagsConsolidados, historialCapas = [], usuarioId = null) {
        if (!articuloId) throw new Error('ID de artículo requerido.');

        const cleanArtId = String(articuloId).trim();
        const estrategiaId = `EST-${cleanArtId.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now().toString().slice(-4)}`;
        
        const payloadEstrategia = {
            estrategia_id: estrategiaId,
            fecha_consolidacion: new Date(),
            usuario_id: usuarioId,
            tags_consolidados: tagsConsolidados || [],
            historial_capas: historialCapas || []
        };

        const jsonStr = JSON.stringify(payloadEstrategia);

        const resUpdate = await pool.query(
            `UPDATE public.bunker_articulos
             SET estrategia_busqueda_json = $1
             WHERE TRIM(articulo_id) = $2`,
            [jsonStr, cleanArtId]
        );

        // Si se consolidó desde un Insumo de Fábrica (ING-xxx), persistir en sus artículos Búnker vinculados
        if (resUpdate.rowCount === 0 && /^ING-?/i.test(cleanArtId)) {
            const cleanIngId = parseInt(cleanArtId.replace(/^ING-?/i, ''), 10);
            if (!isNaN(cleanIngId) && cleanIngId > 0) {
                await pool.query(
                    `UPDATE public.bunker_articulos ba
                     SET estrategia_busqueda_json = $1
                     WHERE TRIM(ba.articulo_id) IN (
                         SELECT TRIM(iba.bunker_articulo_id) FROM public.ingrediente_bunker_articulos iba WHERE iba.ingrediente_id = $2 AND iba.bunker_articulo_id IS NOT NULL
                         UNION
                         SELECT TRIM(i.articulo_vinculado_numero) FROM public.ingredientes i WHERE i.id = $2 AND i.articulo_vinculado_numero IS NOT NULL
                     )`,
                    [jsonStr, cleanIngId]
                );
            }
        }

        return payloadEstrategia;
    }

    /**
     * Resetea / Elimina la estrategia de búsqueda consolidada en PostgreSQL
     */
    async eliminarEstrategiaConsolidada(articuloId) {
        if (!articuloId) throw new Error('ID de artículo requerido.');

        const cleanArtId = String(articuloId).trim();
        const resUpdate = await pool.query(
            `UPDATE public.bunker_articulos
             SET estrategia_busqueda_json = NULL
             WHERE TRIM(articulo_id) = $1`,
            [cleanArtId]
        );

        if (resUpdate.rowCount === 0 && /^ING-?/i.test(cleanArtId)) {
            const cleanIngId = parseInt(cleanArtId.replace(/^ING-?/i, ''), 10);
            if (!isNaN(cleanIngId) && cleanIngId > 0) {
                await pool.query(
                    `UPDATE public.bunker_articulos ba
                     SET estrategia_busqueda_json = NULL
                     WHERE TRIM(ba.articulo_id) IN (
                         SELECT TRIM(iba.bunker_articulo_id) FROM public.ingrediente_bunker_articulos iba WHERE iba.ingrediente_id = $1 AND iba.bunker_articulo_id IS NOT NULL
                         UNION
                         SELECT TRIM(i.articulo_vinculado_numero) FROM public.ingredientes i WHERE i.id = $1 AND i.articulo_vinculado_numero IS NOT NULL
                     )`,
                    [cleanIngId]
                );
            }
        }

        return true;
    }

    /**
     * Invoca a Gemini Flash con esquema JSON estricto y registro en el Ledger oficial de Tokens IA (módulo PRODUCCION_LOTES).
     * Los precios jamás los redacta la IA: solo audita, filtra o reordena IDs existentes.
     */
    async _invocarGeminiConciliacionJson({ systemInstruction, userText, responseSchema, detalleLedger = 'Comité Chofer IA' }) {
        const cred = iaMonitor ? iaMonitor.leerCredencialesGeminiEnCaliente() : {
            apiKey: String(process.env.GEMINI_API_KEY || '').trim(),
            model: String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
            disponible: Boolean(process.env.GEMINI_API_KEY && String(process.env.GEMINI_API_KEY).length > 15)
        };
        if (!cred.disponible || !cred.apiKey) {
            throw new Error('GEMINI_NO_CONFIGURADO: No se encontró GEMINI_API_KEY activa en .env.');
        }

        const backupKey = String(process.env.GEMINI_API_KEY_BACKUP || '').trim();
        const keys = [cred.apiKey];
        if (backupKey && backupKey.length > 15 && backupKey !== cred.apiKey) keys.push(backupKey);

        const modelos = Array.from(new Set([cred.model || 'gemini-2.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest']));
        let ultimoError = null;

        for (const activeKey of keys) {
            for (const modelName of modelos) {
                const generationConfig = {
                    temperature: 0.1,
                    responseMimeType: 'application/json',
                    responseSchema
                };
                if (modelName.includes('2.5') || modelName.includes('3.')) {
                    generationConfig.thinkingConfig = { thinkingBudget: 0 };
                }

                const payload = {
                    systemInstruction: { parts: [{ text: systemInstruction }] },
                    contents: [{ role: 'user', parts: [{ text: userText }] }],
                    generationConfig
                };

                const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(activeKey)}`;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 14000);
                try {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal: controller.signal
                    });
                    if (!res.ok) {
                        const errTxt = await res.text().catch(() => '');
                        ultimoError = new Error(`Gemini (${modelName}) HTTP ${res.status}: ${errTxt.slice(0, 200)}`);
                        if (res.status === 404) continue;
                        break;
                    }
                    const data = await res.json();
                    if (iaMonitor) {
                        iaMonitor.registrarEventoIaSistema({
                            modulo: 'PRODUCCION_LOTES',
                            detalle: detalleLedger,
                            rawResponseData: data,
                            modelo: modelName
                        });
                    }
                    const partsResp = data?.candidates?.[0]?.content?.parts || [];
                    const partTexto = partsResp.find(p => typeof p.text === 'string' && !p.thought) || partsResp[0];
                    const rawText = String(partTexto?.text || '').trim();
                    if (!rawText) throw new Error('Respuesta vacía de Gemini.');
                    return { parsed: JSON.parse(rawText), modelo: modelName };
                } catch (err) {
                    ultimoError = err;
                } finally {
                    clearTimeout(timer);
                }
            }
        }
        throw ultimoError || new Error('No se pudo conectar con Gemini IA.');
    }

    /**
     * Auditoría Cognitiva bajo demanda con Comité Gemini IA sobre las ofertas del mercado (sin alterar precios deterministas)
     */
    async auditarConComiteGeminiIA(articuloId) {
        const baseMatch = await this.buscarCandidatosTablaMaestra(articuloId);
        const art = baseMatch.articulo_lamda;
        const ficha = baseMatch.ficha_semantica_ia || {};
        const candidatosBase = Array.isArray(baseMatch.capa_chofer_ia) ? baseMatch.capa_chofer_ia : [];

        if (candidatosBase.length === 0) {
            return {
                usando_ia_gemini: false,
                veredicto_ejecutivo: 'No hay ofertas candidatas en la Tabla Maestra B4.1 para auditar en este artículo.',
                alertas_detectadas: [],
                mejor_oferta_id: null,
                capa_chofer_ia: []
            };
        }

        const muestraParaIA = candidatosBase.slice(0, 28).map((c, idx) => ({
            ref_idx: idx,
            oferta_id: String(c.id || c.codigo_proveedor),
            proveedor: c.proveedor_nombre,
            es_proveedor_habitual: Boolean(c.es_proveedor_habitual),
            sku_proveedor: c.codigo_proveedor,
            descripcion: c.descripcion_proveedor,
            especificacion: c.especificacion || '',
            presentacion: c.presentacion_maestra,
            kilos_bulto: c.kilos_empaque,
            es_caja_fraccionada: Boolean(c.es_caja_fraccionada),
            costo_kilo_ars: Number(c.costo_kilo_calculado.toFixed(2)),
            promo_kilo_ars: c.precio_promo_kilo ? Number(c.precio_promo_kilo.toFixed(2)) : null,
            antiguedad_dias: c.antiguedad_dias,
            vencida_mas_45d: Boolean(c.es_antigua),
            nivel_actual: c.prioridad_ia
        }));

        const systemInstruction = [
            'Sos el Comité Cognitivo de Compras y Costos de Reposición de LAMDA (distribuidora mayorista de frutos secos, frutas desecadas, semillas, cereales y legumbres en Argentina).',
            'Tu misión es auditar las ofertas mayoristas preseleccionadas (incluyendo al Proveedor Habitual) para definir el Costo de Reposición exacto del artículo objetivo.',
            'REGLAS ESTRICTAS:',
            '1. NO excluyas nunca al proveedor habitual: si tiene coincidencia exacta de producto/calibre/granel vigente y el menor $/kg, DEBE ser la oferta recomendada #1.',
            '2. Nivel 1 = Coincidencia exacta/fuerte vigente (mismo producto, calibre compatible, estado crudo/tostado idéntico y bulto a granel cuando se busca granel).',
            '3. Nivel 2 = Variante cercana vigente (otro calibre ej. W1/W3 cuando se busca W4, otra variedad o caja subdividida 10x1kg cuando se busca bulto suelto de 10kg/22.68kg/25kg).',
            '4. Nivel 3 = Otra conformación/grado industria/partido o insumo crudo cuando se busca tostado.',
            '5. Nivel 4 = Ofertas vencidas (> 45 días) y Nivel 0 = Descartar únicamente si es otro producto incompatible que se filtró por error.',
            '6. Redactá en español argentino claro y técnico (sin signos de apertura "¿" ni "¡"). Jamás inventes precios.'
        ].join('\n');

        const userText = JSON.stringify({
            articulo_objetivo_lamda: {
                codigo: art.articulo_id,
                descripcion: art.descripcion,
                kilos_unidad: art.kilos_unidad,
                costo_kilo_actual_taller: Number((art.costo_kilo_actual || 0).toFixed(2)),
                entidad: ficha.entidad,
                estado: ficha.estado,
                calibre_objetivo: ficha.calibre_info?.etiqueta_calibre || 'Sin restricción',
                empaque_objetivo: ficha.es_target_granel_puro ? 'Bulto Granel Suelto' : 'Presentación Compatible'
            },
            ultimo_lote_deposito: baseMatch.capa_lotes && baseMatch.capa_lotes[0] ? {
                proveedor: baseMatch.capa_lotes[0].proveedor_nombre,
                sku: baseMatch.capa_lotes[0].producto_codigo,
                descripcion: baseMatch.capa_lotes[0].articulo_descripcion,
                costo_kilo_lote: Number(parseFloat(baseMatch.capa_lotes[0].costo_kilo_al_momento || 0).toFixed(2))
            } : null,
            ofertas_candidatas: muestraParaIA
        });

        const responseSchema = {
            type: 'OBJECT',
            properties: {
                mejor_ref_idx: { type: 'INTEGER', description: 'El ref_idx (0-based) de la mejor oferta recomendada para reposición, o -1 si ninguna sirve.' },
                veredicto_ejecutivo: { type: 'STRING', description: 'Explicación técnica concisa (2 a 3 oraciones) justificando cuál es la mejor oferta de reposición y cómo se compara con el resto del mercado.' },
                alertas_detectadas: {
                    type: 'ARRAY',
                    items: { type: 'STRING' },
                    description: 'Hasta 3 alertas breves sobre diferencias de empaque (ej. 10x1kg vs 22.68kg), otros calibres o cotizaciones vencidas.'
                },
                evaluaciones: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            ref_idx: { type: 'INTEGER' },
                            nivel_ia: { type: 'INTEGER', description: '1=Fuerte vigente, 2=Variante calibre/empaque, 3=Secundaria/partido, 4=Vencida >45d, 0=Descartar por incompatible.' },
                            nota_ia: { type: 'STRING', description: 'Breve nota técnica para mostrar en la tarjeta (máx 110 caracteres).' }
                        },
                        required: ['ref_idx', 'nivel_ia']
                    }
                }
            },
            required: ['mejor_ref_idx', 'veredicto_ejecutivo', 'evaluaciones']
        };

        const { parsed, modelo } = await this._invocarGeminiConciliacionJson({
            systemInstruction,
            userText,
            responseSchema,
            detalleLedger: `Auditoría Comité Chofer IA (${art.articulo_id})`
        });

        const evalMap = new Map();
        (parsed.evaluaciones || []).forEach(ev => {
            evalMap.set(Number(ev.ref_idx), ev);
        });

        const mejorIdx = Number(parsed.mejor_ref_idx);
        const auditadas = [];

        candidatosBase.forEach((cand, idx) => {
            const ev = evalMap.get(idx);
            if (ev && Number(ev.nivel_ia) === 0) {
                return; // Descartada por incompatibilidad semántica verificada
            }
            let nuevoNivel = cand.prioridad_ia;
            if (ev && [1, 2, 3, 4].includes(Number(ev.nivel_ia))) {
                nuevoNivel = cand.es_antigua ? 4 : Number(ev.nivel_ia);
            }
            const esElegidaIA = (idx === mejorIdx && !cand.es_antigua);
            if (esElegidaIA) nuevoNivel = 1;

            const notaLimpia = ev?.nota_ia ? String(ev.nota_ia).replace(/[¿¡]/g, '').trim() : '';
            auditadas.push({
                ...cand,
                prioridad_ia: nuevoNivel,
                es_recomendada_top: esElegidaIA,
                auditada_por_gemini: true,
                justificacion: notaLimpia
                    ? `🧠 Gemini IA: ${notaLimpia} • (${cand.justificacion || ''})`
                    : cand.justificacion
            });
        });

        auditadas.sort((a, b) => {
            if (Boolean(b.es_recomendada_top) !== Boolean(a.es_recomendada_top)) {
                return Number(Boolean(b.es_recomendada_top)) - Number(Boolean(a.es_recomendada_top));
            }
            if (a.prioridad_ia !== b.prioridad_ia) return a.prioridad_ia - b.prioridad_ia;
            if (a.sub_orden_calibre !== b.sub_orden_calibre) return a.sub_orden_calibre - b.sub_orden_calibre;
            if (Math.abs(a.costo_kilo_calculado - b.costo_kilo_calculado) > 0.01) {
                return a.costo_kilo_calculado - b.costo_kilo_calculado;
            }
            return a.antiguedad_dias - b.antiguedad_dias;
        });

        return {
            usando_ia_gemini: true,
            modelo_ia: modelo,
            veredicto_ejecutivo: String(parsed.veredicto_ejecutivo || '').replace(/[¿¡]/g, '').trim(),
            alertas_detectadas: Array.isArray(parsed.alertas_detectadas)
                ? parsed.alertas_detectadas.map(a => String(a || '').replace(/[¿¡]/g, '').trim()).filter(Boolean)
                : [],
            mejor_oferta: auditadas.find(a => a.es_recomendada_top) || auditadas[0] || null,
            capa_chofer_ia: auditadas
        };
    }

    /**
     * Depuración Inteligente del Subconjunto mediante Instrucción Natural al Chofer IA
     * Soporta inclusiones ("solo bavosi", "w4", "vietnam", "con promo", "solo vigentes"),
     * exclusiones ("sin villares", "quitar tostados", "sin fraccionados"), rangos numéricos y restauración ("mostrar todos").
     */
    async refinarSubconjuntoConInstruccion(articuloId, candidatosActuales, instruccionOperador, historialCapasActuales = []) {
        const instruccionClean = (instruccionOperador || '').toLowerCase().trim();
        if (!instruccionClean) {
            return { candidatos_filtrados: candidatosActuales || [], historial_capas: historialCapasActuales };
        }

        // Siempre recuperar el universo completo del Chofer IA para este artículo si existe articuloId,
        // de modo que pedir "mostrar todos" o "solo bavosi" recupere proveedores aunque hubieran sido filtrados en un paso previo.
        let universoBase = Array.isArray(candidatosActuales) ? candidatosActuales : [];
        if (articuloId) {
            try {
                const fullMatch = await this.buscarCandidatosTablaMaestra(articuloId);
                if (Array.isArray(fullMatch.capa_chofer_ia) && fullMatch.capa_chofer_ia.length > 0) {
                    universoBase = fullMatch.capa_chofer_ia;
                }
            } catch (_) {}
        }

        if (universoBase.length === 0) {
            return { candidatos_filtrados: [], historial_capas: historialCapasActuales };
        }

        const instrNorm = instruccionClean.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // 1. Comando de restauración completa
        if (/^(todos?|ver\s+todos?|mostrar\s+todos?|restaurar|reset|limpiar|original)\b/i.test(instrNorm)) {
            return {
                candidatos_filtrados: universoBase,
                historial_capas: [historialCapasActuales[0]].filter(Boolean),
                resumen_refino: `Se restauraron las ${universoBase.length} ofertas completas del mercado.`
            };
        }

        // Si no es restauración, encadenar sobre candidatosActuales salvo que pida explícitamente "incluir/mostrar/ver/solo <algo>" que no estaba
        const pideAmpliarOIncluir = /\b(solo|solamente|unicamente|mostrar|ver|incluir|dejar)\b/i.test(instrNorm);
        const poolTrabajo = (!pideAmpliarOIncluir && Array.isArray(candidatosActuales) && candidatosActuales.length > 0)
            ? candidatosActuales
            : universoBase;

        let filtroEmpaqueMin = 0;
        let filtroEmpaqueMax = Infinity;
        let filtroPrecioMax = Infinity;
        let filtroPrecioMin = 0;
        let soloVigentes = false;
        let soloPromo = false;
        let soloGranelPuro = false;
        let excluirFraccionados = false;
        let soloHabitual = false;

        if (/\b(vigentes?|sin\s+vencid[oa]s?|quitar\s+vencid[oa]s?|actualizad[oa]s?)\b/i.test(instrNorm)) {
            soloVigentes = true;
        }
        if (/\b(con\s+promo|en\s+promo|promocion|oferta\s+promo)\b/i.test(instrNorm)) {
            soloPromo = true;
        }
        if (/\b(solo\s+granel|granel\s+puro|bulto\s+suelto)\b/i.test(instrNorm)) {
            soloGranelPuro = true;
        }
        if (/\b(sin\s+fraccionad[oa]s?|quitar\s+fraccionad[oa]s?|excluir\s+fraccionad[oa]s?|sin\s+10x1)\b/i.test(instrNorm)) {
            excluirFraccionados = true;
        }
        if (/\b(habitual|ultimo\s+lote)\b/i.test(instrNorm) && !/\b(sin|quitar|excluir)\s+habitual\b/i.test(instrNorm)) {
            soloHabitual = true;
        }

        // Bultos/kilos mínimos o exactos: "bultos > 10kg", "mas de 15kg", "de 22.68kg"
        const matchKilosExacto = instrNorm.match(/\b(?:de|exacto)\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:kg|kilos?)\b/i);
        if (matchKilosExacto) {
            const valKg = parseFloat(matchKilosExacto[1].replace(',', '.')) || 0;
            if (valKg > 0) {
                filtroEmpaqueMin = valKg - 0.25;
                filtroEmpaqueMax = valKg + 0.25;
            }
        } else {
            const matchKilosMin = instrNorm.match(/(?:bultos?\s*(?:>|>=|mayor(?:es)?\s*a|mas\s*de)|(?:>|>=|mas\s+de|mayor(?:es)?\s+a|desde)\s*)([0-9]+(?:[.,][0-9]+)?)\s*(?:kg|kilos?)\b/i)
                || (instrNorm.includes('kg') ? instrNorm.match(/(?:>|>=)\s*([0-9]+(?:[.,][0-9]+)?)/i) : null);
            if (matchKilosMin) {
                filtroEmpaqueMin = parseFloat(matchKilosMin[1].replace(',', '.')) || 0;
            }
            const matchKilosMax = instrNorm.match(/(?:<|<=|menor(?:es)?\s+a|menos\s+de|hasta)\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:kg|kilos?)\b/i);
            if (matchKilosMax) {
                filtroEmpaqueMax = parseFloat(matchKilosMax[1].replace(',', '.')) || Infinity;
            }
        }

        // Precio máximo / mínimo (cuando el número es >= 100 o lleva $)
        const sinKilosTxt = instrNorm.replace(/[0-9]+(?:[.,][0-9]+)?\s*(?:kg|kilos?)\b/gi, ' ');
        const matchPrecioMax = sinKilosTxt.match(/(?:menor(?:es)?\s+a|menos\s+de|<=|<|hasta|maximo)\s*\$?\s*([0-9]{3,}(?:[.,][0-9]+)?)/i);
        if (matchPrecioMax) {
            filtroPrecioMax = this.limpiarYParsearNumero(matchPrecioMax[1], Infinity);
        }
        const matchPrecioMin = sinKilosTxt.match(/(?:mayor(?:es)?\s+a|mas\s+de|>=|>|desde|minimo)\s*\$?\s*([0-9]{3,}(?:[.,][0-9]+)?)/i);
        if (matchPrecioMin) {
            filtroPrecioMin = this.limpiarYParsearNumero(matchPrecioMin[1], 0);
        }

        // Separar explícitamente cláusulas de EXCLUSIÓN ("sin X", "quitar X", "sacar X", "excluir X", "no X")
        // vs cláusulas de INCLUSIÓN ("solo X", "mostrar X", o palabras buscadas directamente como "bavosi", "w4", "brasil")
        const terminosExcluir = [];
        const terminosIncluir = [];

        let restoTexto = sinKilosTxt
            .replace(/\b(vigentes?|vencid[oa]s?|actualizad[oa]s?|con\s+promo|en\s+promo|promocion|solo\s+granel|granel\s+puro|bulto\s+suelto|fraccionad[oa]s?|habitual|ultimo\s+lote)\b/gi, ' ')
            .replace(/(?:menor(?:es)?\s+a|menos\s+de|mayor(?:es)?\s+a|mas\s+de|<=|>=|<|>|hasta|desde|maximo|minimo)\s*\$?\s*[0-9.,]+/gi, ' ');

        // Capturar segmentos precedidos por verbos de exclusión
        const regexExcl = /\b(?:sin|quitar|sacar|excluir|ocultar|descartar|eliminar|excepto|menos)\s+([a-z0-9\s/.-]+?)(?=\b(?:y\s+solo|solo|mostrar|incluir|dejar|sin|quitar|sacar|excluir|$))/gi;
        let mEx;
        while ((mEx = regexExcl.exec(restoTexto)) !== null) {
            const frag = mEx[1].trim();
            frag.split(/[\s,]+/).forEach(w => {
                const cleanW = w.replace(/[^a-z0-9]/gi, '');
                if (cleanW.length >= 2 && !['los', 'las', 'del', 'por', 'con', 'que', 'una', 'uno', 'proveedor', 'proveedores', 'ofertas', 'bultos', 'kilos'].includes(cleanW)) {
                    terminosExcluir.push(cleanW.replace(/s$/, ''));
                }
            });
        }
        restoTexto = restoTexto.replace(regexExcl, ' ');

        // Lo que queda (ej: "solo bavosi", "bavosi", "w4", "vietnam", "villares") son términos de INCLUSIÓN
        const stopWordsIncl = new Set([
            'solo', 'solamente', 'unicamente', 'mostrar', 'ver', 'incluir', 'dejar', 'filtrar', 'buscar',
            'por', 'para', 'con', 'del', 'las', 'los', 'una', 'uno', 'que', 'sean', 'sea', 'son',
            'proveedor', 'proveedores', 'oferta', 'ofertas', 'bulto', 'bultos', 'caja', 'cajas',
            'bolsa', 'bolsas', 'kilo', 'kilos', 'precio', 'precios', 'mercado', 'todas', 'todo', 'y', 'o', 'de', 'en', 'el', 'la'
        ]);
        restoTexto.split(/[\s,]+/).forEach(w => {
            const cleanW = w.replace(/[^a-z0-9/+]/gi, '').toLowerCase();
            if (cleanW.length >= 2 && !stopWordsIncl.has(cleanW) && !/^[0-9.,]+$/.test(cleanW)) {
                // Equivalencia fonética frecuente (ej. "babosi" -> "bavosi")
                const canonW = cleanW === 'babosi' || cleanW === 'babossi' ? 'bavosi' : cleanW;
                if (!terminosIncluir.includes(canonW)) terminosIncluir.push(canonW);
            }
        });

        // Normalizar también equivalencia fonética en exclusiones ("sin babosi" -> "bavosi")
        for (let i = 0; i < terminosExcluir.length; i++) {
            if (terminosExcluir[i] === 'babosi' || terminosExcluir[i] === 'babossi') {
                terminosExcluir[i] = 'bavosi';
            }
        }

        const aplicarFiltroSobrePool = (pool) => pool.filter(cand => {
            const textoCand = `${cand.descripcion_proveedor || ''} ${cand.especificacion || ''} ${cand.proveedor_nombre || ''} ${cand.codigo_proveedor || ''} ${cand.pais_origen || ''} ${cand.marca || ''} ${cand.presentacion_maestra || ''}`
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "");

            if (soloVigentes && cand.es_antigua) return false;
            if (soloPromo && !cand.tiene_promo) return false;
            if ((soloGranelPuro || excluirFraccionados) && cand.es_caja_fraccionada) return false;
            if (soloHabitual && !cand.es_proveedor_habitual) return false;

            if (filtroEmpaqueMin > 0 && (cand.kilos_empaque || 0) < filtroEmpaqueMin) return false;
            if (filtroEmpaqueMax < Infinity && (cand.kilos_empaque || 0) > filtroEmpaqueMax) return false;
            if (filtroPrecioMax < Infinity && (cand.costo_kilo_calculado || 0) > filtroPrecioMax) return false;
            if (filtroPrecioMin > 0 && (cand.costo_kilo_calculado || 0) < filtroPrecioMin) return false;

            if (terminosExcluir.length > 0) {
                const chocaExcl = terminosExcluir.some(te => textoCand.includes(te));
                if (chocaExcl) return false;
            }

            if (terminosIncluir.length > 0) {
                const cumpleIncl = terminosIncluir.every(ti => {
                    const stem = ti.length >= 5 ? ti.replace(/s$/, '') : ti;
                    return textoCand.includes(stem);
                });
                if (!cumpleIncl) return false;
            }

            return true;
        });

        let candidatosFiltrados = aplicarFiltroSobrePool(poolTrabajo);
        if (candidatosFiltrados.length === 0 && poolTrabajo !== universoBase) {
            candidatosFiltrados = aplicarFiltroSobrePool(universoBase);
        }

        // Preservar el ordenamiento jerárquico inteligente del Chofer IA (1° Nivel IA, 2° Calibre, 3° Menor $/kg)
        candidatosFiltrados.sort((a, b) => {
            if ((a.prioridad_ia || 1) !== (b.prioridad_ia || 1)) return (a.prioridad_ia || 1) - (b.prioridad_ia || 1);
            if ((a.sub_orden_calibre || 2) !== (b.sub_orden_calibre || 2)) return (a.sub_orden_calibre || 2) - (b.sub_orden_calibre || 2);
            if (Math.abs((a.costo_kilo_calculado || 0) - (b.costo_kilo_calculado || 0)) > 0.01) {
                return (a.costo_kilo_calculado || 0) - (b.costo_kilo_calculado || 0);
            }
            return (a.antiguedad_dias || 0) - (b.antiguedad_dias || 0);
        });

        const nuevaCapaNum = (historialCapasActuales.length || 1) + 1;
        const nuevoHistorial = [
            ...historialCapasActuales,
            {
                paso: nuevaCapaNum,
                nombre: `Paso ${nuevaCapaNum}: "${instruccionOperador}" (${candidatosFiltrados.length} ofertas)`,
                instruccion: instruccionOperador,
                tipo: 'REFINO_OPERADOR',
                filas_restantes: candidatosFiltrados.length
            }
        ];

        return {
            candidatos_filtrados: candidatosFiltrados,
            historial_capas: nuevoHistorial
        };
    }
}

module.exports = new ConciliacionArticulosService();
