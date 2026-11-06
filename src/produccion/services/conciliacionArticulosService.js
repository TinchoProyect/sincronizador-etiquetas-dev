const pool = require('../config/database');
const { normalizarOfertaProveedor } = require('../utils/unitNormalizer');
const { supabaseFetch } = require('../utils/supabaseHelper');

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
        const esHarina = /\b(harina|har\.|farina|polvo)\b/i.test(txtSinParaMix);
        const esSalvado = /\bsalvado\b/i.test(txtSinParaMix);
        const esBebida = /\b(leche|bebida|beb\.|jugo|biba|ades|tratenfu|vrink)\b/i.test(txtSinParaMix);
        const esPasta = /\b(pasta|manteca|mantequilla|untable|tahini|halawa)\b/i.test(txtSinParaMix);
        const esConfiteria = /\b(chocolate|choc\.|banad|garrapinad|acaramelad|caramelizad|confitad|turron|crocante|praline|gragead)\b/i.test(txtSinParaMix);
        const esMix = /\b(mix|mezcla|granola|muesli|trail)\b/i.test(txtSinParaMix) ||
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

        const esTostado = tieneTostSalAbrev || /\b(tostad[oa]s?|tost\.?)\b/i.test(txtSinSinSal);
        const esFrito = /\b(frit[oa]s?)\b/i.test(txtSinSinSal);
        const esSalado = tieneTostSalAbrev || (!esSinSal && /\b(salad[oa]s?|c\/sal|con\s+sal|sal)\b/i.test(txtSinSinSal));

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

        // Corte / Morfología física
        const esCorteEspecial = /\b(filetead[oa]s?|laminad[oa]s?|cubetead[oa]s?|cubos?|baston|efilad[oa]s?|granulad[oa]s?|picad[oa]s?|rodajas?|tiras?)\b/i.test(txtSinParaMix);
        const esPartido = /\b(partid[oa]s?|ptda|part\.|quebrad[oa]s?|trozos?|granza|industri\w*|bakery|cuartos?|1\/4|halves\s*&\s*pieces|lwp|swp|sp|p3|b3|g3)\b/i.test(txtSinParaMix);

        let corte = 'ENTERO';
        if (esCorteEspecial) corte = 'CORTE_ESPECIAL';
        else if (esPartido) corte = 'PARTIDO';

        return {
            es_harina: esHarina,
            es_salvado: esSalvado,
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

        // 1. Calibres W y Grados de Partida (P3, G3, B3, LWP, SWP) de Castañas de Cajú
        const matchW = cleanForCalibre.match(/\b(w\s*(?:180|210|240|320|450|3|4|5))\b/i);
        if (matchW) {
            calibreCodigo = matchW[1].toUpperCase().replace(/\s+/g, '');
        } else if (entidad === 'castana') {
            const matchPartCaju = cleanForCalibre.match(/\b(p3|g3|b3|lwp|swp)\b/i);
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
            if (/\b(rubia|sultanina)\b/i.test(full)) {
                variedadCanonica = 'RUBIA_SULTANINA';
                variedadLabel = 'Rubia / Sultanina';
            } else if (/\b(moscatel|mtel)\b/i.test(full)) {
                variedadCanonica = 'MOSCATEL';
                variedadLabel = 'Moscatel';
            } else if (/\bflame\b/i.test(full)) {
                variedadCanonica = 'FLAME';
                variedadLabel = 'Flame';
            } else if (/\bjumbo\b/i.test(full)) {
                variedadCanonica = 'JUMBO';
                variedadLabel = 'Jumbo';
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
            } else if (/\b(cramberry|cranberry|alubia|negro|colorado|mung|aduki)\b/i.test(full)) {
                const mPor = full.match(/\b(cramberry|cranberry|alubia|negro|colorado|mung|aduki)\b/i);
                variedadCanonica = mPor[1].toUpperCase().replace('CRAMBERRY', 'CRANBERRY');
                variedadLabel = mPor[1];
            }
        }

        // 2. Morfología específica (ej: Nuez Mariposa vs Cuarto; Almendra Ramillada vs Partida vs Entera)
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

        const descRaw = `${artLamda.descripcion || ''} ${artLamda.descripcion_generada || ''} ${pd.articulo_principal || ''} ${valoresPosiciones.join(' ')} ${textoIngredienteVinc} ${textoArticulosVinc}`.toLowerCase();
        const descNorm = descRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // 1. Detectar entidad botánica/materia prima
        let entidad = '';
        const entidadesComunes = [
            'zapallo', 'nuez', 'nueces', 'almendra', 'ciruela', 'castana', 'chia', 'girasol', 
            'lino', 'sesamo', 'mani', 'datil', 'coco', 'arandano', 'banana', 'avena', 
            'quinoa', 'higo', 'damasco', 'tomate', 'lenteja', 'garbanzo', 'poroto', 'arroz',
            'pistacho', 'avellana', 'pasas', 'pasa', 'amaranto', 'amapola', 'alpiste', 'mijo',
            'pecan', 'macadamia', 'cacao'
        ];
        for (const ent of entidadesComunes) {
            if (descNorm.includes(ent)) {
                entidad = ent;
                break;
            }
        }
        if (!entidad && pd.articulo_principal) {
            entidad = pd.articulo_principal.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        }

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
        const esGranel = (kilosUnidad >= 5) || Boolean(artLamda.es_ingrediente);
        // En el Taller LAMDA toda materia prima se abastece a granel (1x10kg / 1x25kg) salvo que el artículo LAMDA sea explícitamente un multi-pack (ej. 10x1kg)
        const esTargetGranelPuro = !esTargetCajaFraccionada;

        // 7. Detectar rubro canónico oficial
        let rubroCanonico = '';
        if (attr.es_harina) {
            rubroCanonico = 'HARINAS Y DERIVADOS';
        } else if (['girasol', 'zapallo', 'chia', 'lino', 'sesamo', 'amaranto', 'amapola', 'alpiste', 'mijo'].includes(entidad)) {
            rubroCanonico = 'SEMILLAS';
        } else if (['nuez', 'nueces', 'almendra', 'castana', 'pistacho', 'avellana', 'mani', 'pecan', 'macadamia'].includes(entidad)) {
            rubroCanonico = 'FRUTOS SECOS';
        } else if (['ciruela', 'datil', 'arandano', 'banana', 'higo', 'damasco', 'pasas', 'pasa'].includes(entidad)) {
            rubroCanonico = 'FRUTAS DESECADAS';
        } else if (['lenteja', 'garbanzo', 'poroto'].includes(entidad)) {
            rubroCanonico = 'LEGUMBRES';
        } else if (['avena', 'quinoa', 'arroz'].includes(entidad)) {
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
        }

        // 8. Construir los Bloques de Razonamiento Explícitos del Chofer IA para UI y Auditoría
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
                titulo: '1. Identidad y Estado Físico',
                valor: `${(entidad || 'Insumo').toUpperCase()} • ${estado}`,
                explicacion: attr.es_harina
                    ? 'Exige harina/molienda del insumo; descarta fruto entero, pastas y bebidas.'
                    : (attr.es_con_cascara
                        ? 'Exige fruto con cáscara; descarta pelados, harinas y derivados.'
                        : 'Exige producto pelado/natural; descarta con cáscara, harinas y pastas.')
            },
            {
                paso: 2,
                icono: '📏',
                titulo: '2. Calibre, Tamaño y Variedad',
                valor: detallesEspecificos.length > 0 ? detallesEspecificos.join(' • ') : 'Estándar de Línea',
                explicacion: calibreInfo.tiene_criterio
                    ? `Prioriza coincidencia fuerte con ${calibreInfo.etiqueta_calibre}${textoIngredienteVinc ? ` (Insumo: "${textoIngredienteVinc}")` : ''} y separa otros calibres abajo.`
                    : 'Prioriza coincidencia de variedad, morfología y corte comercial.'
            },
            {
                paso: 3,
                icono: '📦',
                titulo: '3. Formato de Empaque',
                valor: esTargetGranelPuro
                    ? `Granel Puro (${artLamda.es_ingrediente ? 'Bulto >= 5kg' : `${kilosUnidad} kg suelto`})`
                    : (esTargetCajaFraccionada ? `Caja Subdividida (${kilosUnidad} kg)` : `Presentación ${kilosUnidad} kg`),
                explicacion: esTargetGranelPuro
                    ? 'Prioriza bolsas/cajas a granel (1 x 10kg / 25kg) por encima de cajas de paquetes de 1kg (10 x 1kg).'
                    : 'Acepta presentaciones subdivididas o fraccionadas compatibles.'
            },
            {
                paso: 4,
                icono: '⏳',
                titulo: '4. Vigencia Temporal',
                valor: 'Vigentes Arriba • Vencidas al Fondo',
                explicacion: 'Mantiene en los primeros niveles solo cotizaciones vigentes (<= 45 días) y desplaza las vencidas al último bloque.'
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
     * Búsqueda Semántica Autónoma por Bloques de Razonamiento del Chofer IA en Tabla Maestra
     * Clasifica jerárquicamente en 4 Escalones de Pertinencia:
     * - Prioridad 1 (Coincidencia Fuerte Vigente: Mismo Producto, Calibre/Variedad Compatible y Granel Puro)
     * - Prioridad 2 (Variante Cercana Vigente: Otro Calibre ej. 9/11 o 11/13, Otra Variedad o Empaque Fraccionado 10x1kg)
     * - Prioridad 3 (Referencia Secundaria Vigente: Insumo Crudo cuando se busca Tostado o Grado Partido/Industria)
     * - Prioridad 4 (Ofertas Vencidas / Antiguas > 45 días: Rezagadas al fondo sin ocultarlas)
     */
    buscarAlternativasMercadoIA(ofertasRaw, fichaSemantica, proveedorHabitualNombre = '') {
        if (!fichaSemantica.entidad || !Array.isArray(ofertasRaw)) return [];

        const provHabitualNorm = (proveedorHabitualNombre || '').toLowerCase().trim();
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

        const candidatas = ofertasRaw.filter(o => {
            if (o.costo_kilo_calculado <= 0) return false;

            const desc = (o.descripcion_proveedor || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const espec = (o.especificacion || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const textoCompleto = `${desc} ${espec}`;
            const prov = (o.proveedor_nombre || '').toLowerCase().trim();
            const rubroOferta = (o.rubro_proveedor || '').toUpperCase().trim();

            // 1. Debe coincidir con la entidad botánica en descripción o especificación
            if (!desc.includes(entidadNorm) && !espec.includes(entidadNorm)) return false;

            // Desambiguación de sub-entidades botánicas (Castaña Cajú vs Pará, Nuez común vs Moscada/Pecán)
            if (subEntidadTarget === 'CASTANA_CAJU') {
                if (/\b(de\s+para|castanas?\s+para)\b/i.test(textoCompleto)) return false;
            } else if (subEntidadTarget === 'CASTANA_PARA') {
                if (!/\b(de\s+para|castanas?\s+para)\b/i.test(textoCompleto)) return false;
            } else if (subEntidadTarget === 'NUEZ_COMUN') {
                if (textoCompleto.includes('moscada') || textoCompleto.includes('pecan')) return false;
            } else if (subEntidadTarget === 'NUEZ_PECAN') {
                if (!textoCompleto.includes('pecan')) return false;
            }

            // 2. Si el artículo target tiene rubro canónico identificado (salvo Harinas, que los proveedores cargan en Frutos Secos o Harinas), filtrar rubros incompatibles
            if (!attrTarget.es_harina && fichaSemantica.rubro_canonico && rubroOferta && rubroOferta !== 'SIN RUBRO' && rubroOferta !== fichaSemantica.rubro_canonico) {
                return false;
            }

            // 3. Analizar atributos semánticos de la oferta
            const attrOferta = this.analizarAtributosTexto(textoCompleto);

            // Exclusión estricta por Naturaleza de Producto (Harina, Salvado, Bebida, Pasta, Confitería/Bañados, Mixes)
            if (attrTarget.es_harina !== attrOferta.es_harina) return false;
            if (Boolean(attrTarget.es_salvado) !== Boolean(attrOferta.es_salvado)) return false;
            if (attrTarget.es_bebida !== attrOferta.es_bebida) return false;
            if (attrTarget.es_pasta !== attrOferta.es_pasta) return false;
            if (attrTarget.es_confiteria !== attrOferta.es_confiteria) return false;
            if (attrTarget.es_mix !== attrOferta.es_mix) return false;

            // 4. Descartar derivados procesados de cocina / conservas / golosinas / galletitas / barras / tés
            const esDerivadoProcesado = desc.includes('mermelad') || desc.includes('almibar') || 
                                       (!refNormTarget.includes('escama') && desc.includes('escama')) ||
                                       desc.includes('pure') || 
                                       desc.includes('dulce') ||
                                       (!refNormTarget.includes('aceite') && (desc.includes('aceite') || espec.includes('aceite'))) ||
                                       desc.includes('galletit') || desc.includes('gall.') ||
                                       /\b(barras?|barritas?)\b/i.test(desc) || desc.includes('rocio') ||
                                       desc.includes('pulpito') || desc.includes('paella') ||
                                       desc.includes('conserva') || desc.includes('rooibos') ||
                                       desc.includes('sabor ') ||
                                       (!refNormTarget.includes('esencia') && desc.includes('esencia')) ||
                                       espec.includes('galletit');
            if (esDerivadoProcesado) return false;

            // 5. Exclusión estricta de Cáscara vs Pelado (excepto en Harinas o Pistachos):
            if (entidadNorm !== 'pistacho' && !attrTarget.es_harina) {
                if (attrTarget.es_con_cascara && !attrOferta.es_con_cascara) return false;
                if (!attrTarget.es_con_cascara && attrOferta.es_con_cascara) return false;
            }

            // 6. Exclusión de Cortes Especiales (Cubeteada, Fileteada, Laminada) si el target NO lo es
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
            if (fichaSemantica.es_granel) {
                if (o.modo_empaque === 'ENVASADO' && o.peso_unitario < 1.0) return false;
                const minKilos = (esTargetProcesado && attrOferta.proceso !== 'CRUDO') ? 2.0 : 5.0;
                if (o.kilos_empaque < minKilos) return false;
            }

            // 10. Excluir el proveedor habitual ya cubierto en Capa 2
            if (provHabitualNorm && prov.includes(provHabitualNorm)) {
                return false;
            }

            return true;
        });

        // Evaluar cada oferta con los Bloques de Razonamiento del Chofer IA
        const enriquecidas = candidatas.map(alt => {
            const descOferta = (alt.descripcion_proveedor || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const especOferta = (alt.especificacion || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const presOferta = (alt.presentacion_maestra || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const textoOferta = `${descOferta} ${especOferta}`;
            const attrOferta = this.analizarAtributosTexto(textoOferta);

            let confOferta = 'ESTANDAR';
            if (REGEX_CONFORMACION_INDUSTRIA.test(textoOferta) || attrOferta.es_partido) {
                confOferta = 'INDUSTRIA_PARTIDO';
            } else if (REGEX_CONFORMACION_PREMIUM.test(textoOferta)) {
                confOferta = 'ENTERO_PREMIUM';
            }

            // Evaluación Bloque 2: Calibre, Tamaño, Variedad, Morfología y Color
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
                discrepanciasEspecificas.push(`📏 Otro Calibre: ${calOferta.etiqueta_calibre || calOferta.calibre_codigo}`);
            }

            if (varTarget.variedad_canonica) {
                if (varOferta.variedad_canonica && varOferta.variedad_canonica !== varTarget.variedad_canonica) {
                    discrepanciasEspecificas.push(`🌱 Otra Variedad: ${varOferta.variedad_label}`);
                } else if (varOferta.variedad_canonica === varTarget.variedad_canonica) {
                    aciertosEspecificos.push(`Variedad ${varOferta.variedad_label}`);
                    tieneMatchVariedadCorteExplicito += 2;
                } else if (['MEDJOUL', 'TURCO'].includes(varTarget.variedad_canonica)) {
                    // En Dátiles Medjoul e Higos Turcos, las ofertas genéricas sin variedad suelen ser otra variedad económica (Egipcio/Higo Negro)
                    discrepanciasEspecificas.push(`🌱 Sin variedad ${varTarget.variedad_label} explícita`);
                }
            }

            if (varTarget.morfologia_especifica) {
                if (varOferta.morfologia_especifica && varOferta.morfologia_especifica !== varTarget.morfologia_especifica) {
                    discrepanciasEspecificas.push(`🔪 Otro Corte: ${varOferta.morfologia_label}`);
                } else if (varOferta.morfologia_especifica === varTarget.morfologia_especifica) {
                    aciertosEspecificos.push(`Corte ${varOferta.morfologia_label}`);
                    tieneMatchVariedadCorteExplicito += 2;
                }
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

            // Evaluación Bloque 3: Empaque Granel Puro vs Caja Fraccionada (ej. 10 x 1 kg)
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
                    // Ejemplo: se busca Fruto Entero y la oferta es Partido/Industria (o viceversa)
                    prioridadTecnica = 3;
                    matchType = confOferta === 'INDUSTRIA_PARTIDO' ? 'GRADO_INDUSTRIA' : 'GRADO_SUPERIOR';
                    badge = confOferta === 'INDUSTRIA_PARTIDO'
                        ? '🏭 Grado Industria / Partido (Otra Conformación)'
                        : '✨ Grado Entero / Superior (Otra Conformación)';
                    justif = `${badge}: ${specClean || 'Conformación alternativa'} a ${precioFmt} (${empaqueClean}).`;
                } else if (discrepanciasEspecificas.length > 0) {
                    // Tiene discrepancia de Calibre (ej: 9/11 Chica o 11/13 cuando se busca 15+ Grande),
                    // o de Empaque (ej: 10 x 1 kg cuando se busca granel 1 x 10 kg), o de Variedad/Corte/Color
                    prioridadTecnica = 2;
                    matchType = 'VARIANTE_CALIBRE_EMPAQUE';
                    badge = discrepanciasEspecificas.join(' • ');
                    justif = `🔄 Variante de Mercado (${discrepanciasEspecificas.join(' | ')}): Misma materia prima pelada/cruda pero con distinta especificación o empaque a ${precioFmt} (${empaqueClean}).`;
                } else {
                    // COINCIDENCIA FUERTE (Nivel 1): Mismo producto, estado, granel puro y calibre/variedad compatible
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

            // Evaluación Bloque 4: Vigencia Temporal (Ofertas vencidas > 45 días van al Escalón 4 al final de la solapa)
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

            // Sub-puntaje de especificidad (cuantos más atributos específicos explícitos acierta, más arriba dentro de su sub-bloque)
            const especificidadScore = aciertosEspecificos.length;

            return {
                ...alt,
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
        // 3° Sub-orden de Calibre (1: Calibre Exacto ej. 15+ primero, 2: Calibre Compatible ej. 13/15 Grande después, 3: Sin calibre especificado)
        // 4° Coincidencia explícita de Variedad / Corte específico (ej. Non Pareil, Ramillada, Presidente, Medjoul) antes que ofertas sin variedad declarada
        // 5° Mayor cantidad total de atributos específicos acertados
        // 6° Menor costo por kilo
        // 7° Menor antigüedad (más reciente)
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
            if (b.especificidad_score !== a.especificidad_score) {
                return b.especificidad_score - a.especificidad_score;
            }
            if (a.costo_kilo_calculado !== b.costo_kilo_calculado) {
                return a.costo_kilo_calculado - b.costo_kilo_calculado;
            }
            return a.antiguedad_dias - b.antiguedad_dias;
        });

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

        // 3. CAPA CHOFER IA (Inteligencia Autónoma y Alternativas de Mercado)
        const fichaSemantica = this.extraerFichaSemantica(artLamda);
        const capaChoferIA = this.buscarAlternativasMercadoIA(ofertasRaw, fichaSemantica, proveedorHabitualNombre);

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
     * Depuración del Subconjunto Actual mediante Instrucción Natural al Chofer IA
     */
    async refinarSubconjuntoConInstruccion(articuloId, candidatosActuales, instruccionOperador, historialCapasActuales = []) {
        if (!Array.isArray(candidatosActuales) || candidatosActuales.length === 0) {
            return { candidatos_filtrados: [], historial_capas: historialCapasActuales };
        }

        const instruccionClean = (instruccionOperador || '').toLowerCase().trim();
        if (!instruccionClean) {
            return { candidatos_filtrados: candidatosActuales, historial_capas: candidatosActuales };
        }

        let filtroEmpaqueMin = 0;
        let filtroPrecioMax = Infinity;

        // Detección de bultos/kilos mínimos: "solo bultos > 10kg", "mas de 5kg", ">10"
        const matchKilosMin = instruccionClean.match(/(?:bultos?|kilos?|kg|>|mas\s+de|mayor\s+a)\s*>?\s*([0-9.,]+)\s*(?:kg|kilos?)?/i);
        if (matchKilosMin && (instruccionClean.includes('bulto') || instruccionClean.includes('kg') || instruccionClean.includes('>'))) {
            filtroEmpaqueMin = parseFloat(matchKilosMin[1].replace(',', '.')) || 0;
        }

        // Detección de precio máximo: "menor a 10000", "menos de $9500", "< 10000"
        const matchPrecioMax = instruccionClean.match(/(?:menor\s+a|menos\s+de|<|hasta)\s*\$?\s*([0-9.,]+)/i);
        if (matchPrecioMax) {
            filtroPrecioMax = parseFloat(matchPrecioMax[1].replace(/\./g, '').replace(',', '.')) || Infinity;
        }

        const terminosDescarte = [];
        if (instruccionClean.includes('tostad') || instruccionClean.includes('tostado')) terminosDescarte.push('tostad');
        if (instruccionClean.includes('salad') || instruccionClean.includes('salado')) terminosDescarte.push('salad');
        if (instruccionClean.includes('pasa') || instruccionClean.includes('pasas')) terminosDescarte.push('pasa');
        if (instruccionClean.includes('mermelada') || instruccionClean.includes('dulce')) terminosDescarte.push('mermelad', 'dulce');

        // Proveedores a descartar: "sin abel", "quitar villares"
        const matchSinProv = instruccionClean.match(/(?:sin|quitar|sacar|no)\s+([a-zA-Z]+)/i);
        if (matchSinProv) {
            terminosDescarte.push(matchSinProv[1].toLowerCase());
        }

        const palabras = instruccionClean.replace(/quitar|filtrar|sacar|sin|no|solo|bultos?|kilos?|kg|mayor|menor|hasta|desde/g, '').split(/\s+/).filter(p => p.length >= 3 && !/^[0-9.,]+$/.test(p));
        palabras.forEach(p => {
            const pNorm = p.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (!terminosDescarte.includes(pNorm)) terminosDescarte.push(pNorm);
        });

        const candidatosFiltrados = candidatosActuales.filter(cand => {
            const descNorm = `${cand.descripcion_proveedor || ''} ${cand.proveedor_nombre || ''}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const tieneDescarte = terminosDescarte.some(td => descNorm.includes(td));
            if (tieneDescarte) return false;

            if (filtroEmpaqueMin > 0 && (cand.kilos_empaque || 0) < filtroEmpaqueMin) {
                return false;
            }

            if (filtroPrecioMax < Infinity && (cand.costo_kilo_calculado || 0) > filtroPrecioMax) {
                return false;
            }

            return true;
        });

        candidatosFiltrados.sort((a, b) => a.antiguedad_dias - b.antiguedad_dias);

        const nuevaCapaNum = (historialCapasActuales.length || 1) + 1;
        const nuevoHistorial = [
            ...historialCapasActuales,
            {
                paso: nuevaCapaNum,
                nombre: `Paso ${nuevaCapaNum}: ${instruccionOperador} (${candidatosFiltrados.length} ofertas)`,
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
