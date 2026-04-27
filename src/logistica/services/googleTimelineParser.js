/**
 * Google Timeline Parser Service
 * Motor Analítico para procesar archivos Rutas.json
 */

class GoogleTimelineParser {
    /**
     * Parsear coordenadas formato E7 de Google
     * @param {number} e7Coord - Coordenada en formato entero (E7)
     * @returns {number} Coordenada decimal flotante
     */
    static parseE7(e7Coord) {
        if (e7Coord === undefined || e7Coord === null) return null;
        // Se usa parseFloat para asegurar que no se pierdan decimales vitales tras la división
        return parseFloat((e7Coord / 10000000).toFixed(7));
    }

    /**
     * Formatear fecha para validación visual de auditoría
     * @param {Date} dateObj
     * @returns {string} Fecha formateada DD/MM/YYYY - HH:mm
     */
    static formatearFecha(dateObj) {
        if (!dateObj) return '';
        const dia = String(dateObj.getDate()).padStart(2, '0');
        const mes = String(dateObj.getMonth() + 1).padStart(2, '0');
        const anio = dateObj.getFullYear();
        const hora = String(dateObj.getHours()).padStart(2, '0');
        const min = String(dateObj.getMinutes()).padStart(2, '0');
        return `${dia}/${mes}/${anio} - ${hora}:${min}`;
    }

    /**
     * Calcular distancia en metros entre dos coordenadas (Fórmula Haversine)
     */
    static calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
        if (!lat1 || !lon1 || !lat2 || !lon2) return null;
        
        const R = 6371e3; // Radio de la tierra en metros
        const phi1 = lat1 * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        const deltaPhi = (lat2 - lat1) * Math.PI / 180;
        const deltaLambda = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return Math.round(R * c); // Retorna metros enteros
    }

    /**
     * Extractor recursivo de coordenadas para soportar topologías mixtas (E7 o Decimales)
     */
    static extraerCoordenadas(nodo) {
        if (!nodo) return null;
        let lat = null, lng = null;
        
        const buscar = (obj) => {
            if (lat !== null && lng !== null) return;
            if (obj === null || obj === undefined) return;
            
            // Detección de cadenas directas E2EE
            if (typeof obj === 'string') {
                if (obj.includes(',') && (obj.includes('°') || obj.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/))) {
                    const partes = obj.split(',');
                    if (partes.length === 2) {
                        lat = parseFloat(partes[0].replace(/°/g, '').trim());
                        lng = parseFloat(partes[1].replace(/°/g, '').trim());
                    }
                }
                return;
            }

            if (typeof obj !== 'object') return;
            
            // Formato E7 Clásico
            if (obj.latitudeE7 !== undefined && obj.longitudeE7 !== undefined) {
                lat = parseFloat((obj.latitudeE7 / 10000000).toFixed(7));
                lng = parseFloat((obj.longitudeE7 / 10000000).toFixed(7));
                return;
            }
            // Formato Decimal Nuevo
            if (obj.latitude !== undefined && obj.longitude !== undefined) {
                lat = parseFloat(obj.latitude);
                lng = parseFloat(obj.longitude);
                return;
            }
            // Formato String (lat, lng) o LatLng/point objeto
            const strLatLng = obj.latLng || obj.LatLng || obj.point;
            if (strLatLng) {
                if (typeof strLatLng === 'string') {
                    const partes = strLatLng.split(',');
                    if (partes.length === 2) {
                        lat = parseFloat(partes[0].replace(/°/g, '').trim());
                        lng = parseFloat(partes[1].replace(/°/g, '').trim());
                        return;
                    }
                } else if (strLatLng.latitude !== undefined) {
                    lat = parseFloat(strLatLng.latitude);
                    lng = parseFloat(strLatLng.longitude);
                    return;
                }
            }
            
            for (const key in obj) {
                if (typeof obj[key] === 'object') buscar(obj[key]);
            }
        };

        buscar(nodo);
        if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
            return { lat, lng };
        }
        return null;
    }

    /**
     * Extrae de forma recursiva TODAS las coordenadas de un objeto/array en orden.
     * Ideal para extraer el waypointPath o trace completo de los segmentos.
     */
    static extraerTodasLasCoordenadas(segmentos) {
        if (!segmentos) return [];
        
        const _extraerRecursivo = (nodo) => {
            let pts = [];
            const buscar = (obj) => {
                if (obj === null || obj === undefined) return;
                
                // Detección de cadenas directas en arrays E2EE
                if (typeof obj === 'string') {
                    if (obj.includes(',') && (obj.includes('°') || obj.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/))) {
                        const partes = obj.split(',');
                        if (partes.length === 2) {
                            const latStr = parseFloat(partes[0].replace(/[^0-9.-]/g, ''));
                            const lngStr = parseFloat(partes[1].replace(/[^0-9.-]/g, ''));
                            if (!isNaN(latStr) && !isNaN(lngStr)) pts.push({ lat: latStr, lng: lngStr });
                        }
                    }
                    return;
                }

                if (typeof obj !== 'object') return;
                
                if (Array.isArray(obj)) {
                    obj.forEach(buscar);
                    return;
                }

                let lat = null, lng = null;
                if (obj.latitudeE7 !== undefined && obj.longitudeE7 !== undefined) {
                    lat = parseFloat((obj.latitudeE7 / 10000000).toFixed(7));
                    lng = parseFloat((obj.longitudeE7 / 10000000).toFixed(7));
                } else if (obj.latE7 !== undefined && obj.lngE7 !== undefined) {
                    lat = parseFloat((obj.latE7 / 10000000).toFixed(7));
                    lng = parseFloat((obj.lngE7 / 10000000).toFixed(7));
                } else if (obj.latitude !== undefined && obj.longitude !== undefined) {
                    lat = parseFloat(obj.latitude);
                    lng = parseFloat(obj.longitude);
                } else {
                    const strLatLng = obj.latLng || obj.LatLng || obj.point;
                    if (strLatLng) {
                        if (typeof strLatLng === 'string') {
                            const partes = strLatLng.split(',');
                            if (partes.length === 2) {
                                // TICKET #042: Extracción matemática rigurosa para desglosar formato nativo de Google (String "point")
                                lat = parseFloat(partes[0].replace(/[^0-9.-]/g, ''));
                                lng = parseFloat(partes[1].replace(/[^0-9.-]/g, ''));
                            }
                        } else if (strLatLng.latitude !== undefined) {
                            lat = parseFloat(strLatLng.latitude);
                            lng = parseFloat(strLatLng.longitude);
                        }
                    }
                }

                if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
                    // TICKET #049: Intentar rescatar el timestamp exacto del punto para la auditoría empírica cronológica
                    let timestamp = obj.timestamp || obj.time || obj.datetime;
                    pts.push({ lat, lng, timestamp });
                }

                for (const key in obj) {
                    if (typeof obj[key] === 'object') buscar(obj[key]);
                }
            };
            buscar(nodo);
            return pts;
        };

        if (Array.isArray(segmentos)) {
            let puntosFinales = [];
            segmentos.forEach(segmento => {
                const tlPath = segmento.timelinePath || (segmento.activitySegment && segmento.activitySegment.timelinePath) || (segmento.activity && segmento.activity.timelinePath);
                const wpPath = segmento.waypointPath || (segmento.activitySegment && segmento.activitySegment.waypointPath) || (segmento.activity && segmento.activity.waypointPath);
                // TICKET #042: Rescate de simplifiedRawPath si Google Timeline cesa de enviar timelinePath segregados
                const rawPath = segmento.simplifiedRawPath || (segmento.activitySegment && segmento.activitySegment.simplifiedRawPath) || (segmento.activity && segmento.activity.simplifiedRawPath);
                
                if (tlPath) {
                    console.log(`\n[AUDITORÍA FORENSE - ENTRADA] Leyendo propiedad 'timelinePath'.`);
                    puntosFinales.push(..._extraerRecursivo(tlPath));
                } else if (wpPath) {
                    console.log(`\n[AUDITORÍA FORENSE - ENTRADA] Leyendo propiedad 'waypointPath'.`);
                    puntosFinales.push(..._extraerRecursivo(wpPath));
                } else if (rawPath) {
                    console.log(`\n[AUDITORÍA FORENSE - ENTRADA] Leyendo propiedad 'simplifiedRawPath'.`);
                    puntosFinales.push(..._extraerRecursivo(rawPath));
                } else {
                    // TICKET #043: Fallback de Extracción Profunda. 
                    // Si Google oculta los puntos en llaves arbitrarias (transitPath, points, etc)
                    // y no usa los nombres estándar, forzamos un barrido recursivo de todo el segmento.
                    console.log(`\n[AUDITORÍA FORENSE - ENTRADA] Ausencia de llaves estándar. Iniciando barrido recursivo ciego de todo el segmento.`);
                    const ptsOcultos = _extraerRecursivo(segmento);
                    console.log(`[AUDITORÍA FORENSE - RESULTADO] El barrido ciego rescató ${ptsOcultos.length} coordenadas ocultas.`);
                    if (ptsOcultos.length > 0) {
                        puntosFinales.push(...ptsOcultos);
                    } else {
                        // Último recurso: Extraer solo la coordenada raíz o startLocation
                        const p = this.extraerCoordenadas(segmento);
                        if (p) puntosFinales.push(p);
                    }
                }
            });
            return puntosFinales;
        }

        return _extraerRecursivo(segmentos);
    }

    /**
     * Pipeline de Sanitización en 2 Fases (Ticket #033)
     * Fase 1: Aislamiento Cronológico estricto (24 horas)
     * Fase 2: Purga de ruido satelital (wifiScan, UNKNOWN activity, etc)
     */
    static sanitizarPipeline(segmentosCrudos, msDiaRuta) {
        console.log(`[PARSER] Iniciando Pipeline de Sanitización... Total crudo: ${segmentosCrudos.length}`);
        
        // Fase 1: Machetazo Cronológico (Con Margen Expandido Extremo - 5 días)
        const fechaRuta = new Date(msDiaRuta);
        fechaRuta.setHours(0,0,0,0);
        // TICKET #043: Añadir 5 días (120 horas) de margen hacia atrás para salvar desfasajes inmensos entre DB y JSON
        const msInicioDia = fechaRuta.getTime() - (120 * 60 * 60 * 1000); 
        fechaRuta.setHours(23,59,59,999);
        // TICKET #043: Añadir 5 días de margen hacia adelante
        const msFinDia = fechaRuta.getTime() + (120 * 60 * 60 * 1000);

        const segmentosFase1 = segmentosCrudos.filter(obj => {
            const rawStart = (obj.duration && obj.duration.startTimestamp) || 
                             obj.startTime || 
                             (obj.activity && obj.activity.timestamp) ||
                             (obj.activityRecord && obj.activityRecord.timestamp) ||
                             (obj.position && obj.position.timestamp) ||
                             (obj.placeVisit && obj.placeVisit.duration && obj.placeVisit.duration.startTimestamp) ||
                             (obj.visit && obj.visit.duration && obj.visit.duration.startTimestamp) ||
                             (obj.activitySegment && obj.activitySegment.duration && obj.activitySegment.duration.startTimestamp) ||
                             (obj.activitySegment && obj.activitySegment.startLocation && obj.activitySegment.startLocation.timestamp);
                             
            const rawEnd = (obj.duration && obj.duration.endTimestamp) || 
                           obj.endTime || 
                           (obj.placeVisit && obj.placeVisit.duration && obj.placeVisit.duration.endTimestamp) ||
                           (obj.visit && obj.visit.duration && obj.visit.duration.endTimestamp) ||
                           (obj.activitySegment && obj.activitySegment.duration && obj.activitySegment.duration.endTimestamp) ||
                           (obj.activitySegment && obj.activitySegment.endLocation && obj.activitySegment.endLocation.timestamp) ||
                           rawStart;

            if (!rawStart && !rawEnd) return false;

            const msStart = rawStart ? new Date(rawStart).getTime() : new Date(rawEnd).getTime();
            const msEnd = rawEnd ? new Date(rawEnd).getTime() : msStart;

            // Conservamos si HAY solapamiento dentro del margen expandido de 14 horas
            return (msStart <= msFinDia && msEnd >= msInicioDia);
        });

        console.log(`[PARSER] Fase 1 (Cronológica) completada. Restantes: ${segmentosFase1.length}`);

        // Fase 2: Purga de Ruido con Rescate de Datos (Ticket #034)
        const segmentosLimpios = segmentosFase1.filter(obj => {
            // TICKET #042: Incluir simplifiedRawPath como trazado válido ante la falta de timelinePath
            const tieneTrazadoCalle = obj.timelinePath || obj.waypointPath || obj.simplifiedRawPath || (obj.activitySegment && obj.activitySegment.simplifiedRawPath) || (obj.activity && obj.activity.simplifiedRawPath);

            // Eliminar ruido estático directo
            if (obj.wifiScan) {
                if (tieneTrazadoCalle) {
                    // Rescate: Preservar timestamp en la raíz antes de amputar
                    obj.startTime = obj.startTime || obj.wifiScan.deliveryTime || obj.wifiScan.timestamp;
                    delete obj.wifiScan;
                    return true;
                }
                return false;
            }
            
            // Evaluar activityRecord para descartar adivinanzas de baja fiabilidad
            if (obj.activityRecord && obj.activityRecord.probableActivities) {
                const acts = obj.activityRecord.probableActivities;
                if (acts.length > 0) {
                    const topAct = acts[0];
                    let esBasura = false;
                    
                    if (topAct.type === 'UNKNOWN') esBasura = true;
                    if (topAct.type === 'STILL' && topAct.confidence < 0.5) esBasura = true;

                    if (esBasura) {
                        if (tieneTrazadoCalle) {
                            // Amputar la predicción fallida pero rescatar la polilínea y el tiempo
                            obj.startTime = obj.startTime || obj.activityRecord.timestamp;
                            delete obj.activityRecord;
                            return true;
                        }
                        // Destrucción total
                        return false;
                    }
                }
            }

            return true;
        });

        console.log(`[PARSER] Fase 2 (Ruido Satelital) completada. Restantes limpios: ${segmentosLimpios.length}`);
        return segmentosLimpios;
    }

    /**
     * Procesar un archivo JSON crudo de Google Timeline
     */
    static procesar(timelineJson, puntosBase = [], rutaLamdaEntregas = [], config = { toleranciaMetros: 50, toleranciaTiempoMin: 3 }, nodoInicio = null, nodoFin = null, ventanaTemporal = null) {
        console.log('[PARSER] Iniciando procesamiento de Timeline JSON');
        
        // Detección de Topología (Antigua vs Nueva E2EE)
        let segmentos = [];
        if (timelineJson.semanticSegments && Array.isArray(timelineJson.semanticSegments)) {
            console.log('[PARSER] Topología detectada: semanticSegments (E2EE Nuevo Formato)');
            segmentos = timelineJson.semanticSegments;
        } else if (timelineJson.timelineObjects && Array.isArray(timelineJson.timelineObjects)) {
            console.log('[PARSER] Topología detectada: timelineObjects (Formato Clásico)');
            segmentos = timelineJson.timelineObjects;
        } else {
            throw new Error('El archivo JSON no tiene un formato válido (No se encontró semanticSegments ni timelineObjects).');
        }

        // Aplicar Pipeline de Sanitización Masiva antes de iniciar cualquier anclaje
        if (ventanaTemporal && ventanaTemporal.inicio) {
            segmentos = this.sanitizarPipeline(segmentos, ventanaTemporal.inicio);
        }

        // Filtro de Contexto y Anclaje (Ticket #027 y #028): Aislar los segmentos correspondientes a la ruta
        if (ventanaTemporal && ventanaTemporal.inicio && ventanaTemporal.fin) {
            let msVentanaInicio = ventanaTemporal.inicio;
            let msVentanaFin = ventanaTemporal.fin;

            // Para evitar discrepancias de Timezone (UTC vs Local) y desfasajes crónicos de choferes, 
            // buscamos el evento físico más cercano a la hora teórica con un margen de tolerancia extremo (5 días).
            // TICKET #043: 120 horas para acoplarse a archivos de la semana que tienen una fecha_salida posterior en LAMDA.
            const margenBuscadorMs = 120 * 60 * 60 * 1000;

            // Anclar Nodo Inicio: Buscamos a qué hora real salió del nodo
            if (nodoInicio) {
                let mejorDiferencia = Infinity;
                let msSalidaReal = null;

                for (const obj of segmentos) {
                    // Prevenir ruido de telemetría pura (ej. wifiScan) que no tiene timestamps de eventos de tiempo
                    const rawStart = (obj.duration && obj.duration.startTimestamp) || obj.startTime || (obj.activity && obj.activity.timestamp);
                    if (!rawStart) continue;

                    const coords = this.extraerCoordenadas(obj);
                    if (coords) {
                        const toleranciaAnclaje = 500; 
                        const dist = this.calcularDistanciaMetros(coords.lat, coords.lng, nodoInicio.latitud, nodoInicio.longitud);
                        if (dist <= toleranciaAnclaje) {
                            // Para Nodo Inicio, extraemos rawEnd desde la jerarquía correcta o caemos en startTime
                            const objVisit = obj.placeVisit || obj.visit || {};
                            const objAct = obj.activitySegment || obj.activity || {};
                            const rawEnd = (objVisit.duration && objVisit.duration.endTimestamp) || 
                                           (objAct.duration && objAct.duration.endTimestamp) || 
                                           obj.endTime || rawStart;

                            if (rawEnd) {
                                const msEnd = new Date(rawEnd).getTime();
                                const diff = Math.abs(msVentanaInicio - msEnd);
                                if (diff <= margenBuscadorMs && diff < mejorDiferencia) {
                                    mejorDiferencia = diff;
                                    msSalidaReal = msEnd;
                                }
                            }
                        }
                    }
                }
                if (msSalidaReal !== null && msSalidaReal < msVentanaInicio) {
                    // Damos un margen de 1 segundo hacia atrás para asegurar que el placeVisit quede atrapado en el filtro >=
                    msVentanaInicio = msSalidaReal - 1000;
                    console.log(`[PARSER] Anclaje de Nodo Inicio: Ventana expandida hacia atrás a ${new Date(msVentanaInicio).toISOString()}`);
                } else {
                    // TICKET #043: Si el chofer fue al depósito AL FINAL de la ruta (o nunca fue), msSalidaReal >= msVentanaInicio o es null.
                    // Esto significa que la hora de "Inicio de Ruta" en LAMDA (ej. 18:12) fue apretada tardíamente.
                    // Expandimos la ventana heurísticamente 12 horas hacia atrás para rescatar todo el recorrido empírico de ese turno.
                    msVentanaInicio = msVentanaInicio - (12 * 60 * 60 * 1000);
                    console.log(`[PARSER] ⚠️ Heurística de Rescate: Anclaje de inicio físico inefectivo. Expandiendo 12 horas hacia atrás para absorber la jornada previa al clic: ${new Date(msVentanaInicio).toISOString()}`);
                }
            }

            // Anclar Nodo Fin: Buscamos a qué hora real llegó al nodo
            if (nodoFin) {
                let mejorDiferencia = Infinity;
                let msLlegadaReal = null;

                for (const obj of segmentos) {
                    const rawStartRoot = (obj.duration && obj.duration.startTimestamp) || obj.startTime || (obj.activity && obj.activity.timestamp);
                    if (!rawStartRoot) continue;

                    const coords = this.extraerCoordenadas(obj);
                    if (coords) {
                        const toleranciaAnclaje = 500;
                        const dist = this.calcularDistanciaMetros(coords.lat, coords.lng, nodoFin.latitud, nodoFin.longitud);
                        if (dist <= toleranciaAnclaje) {
                            const objVisit = obj.placeVisit || obj.visit || {};
                            const objAct = obj.activitySegment || obj.activity || {};
                            const rawStart = (objVisit.duration && objVisit.duration.startTimestamp) || 
                                             (objAct.duration && objAct.duration.startTimestamp) || 
                                             obj.startTime || rawStartRoot;

                            if (rawStart) {
                                const msStart = new Date(rawStart).getTime();
                                const diff = Math.abs(msVentanaFin - msStart);
                                if (diff <= margenBuscadorMs && diff < mejorDiferencia) {
                                    mejorDiferencia = diff;
                                    msLlegadaReal = msStart;
                                }
                            }
                        }
                    }
                }
                if (msLlegadaReal !== null && msLlegadaReal > msVentanaFin) {
                    // Damos un margen de 1 segundo hacia adelante
                    msVentanaFin = msLlegadaReal + 1000;
                    console.log(`[PARSER] Anclaje de Nodo Fin: Ventana expandida hacia adelante a ${new Date(msVentanaFin).toISOString()}`);
                } else if (msLlegadaReal === null) {
                    const d = new Date(msVentanaFin);
                    d.setHours(23,59,59,999);
                    msVentanaFin = d.getTime();
                    console.log(`[PARSER] Falló el anclaje de Nodo Fin. Ventana expandida automáticamente a las 23:59:59 del día: ${new Date(msVentanaFin).toISOString()}`);
                }
            }

            console.log(`[PARSER] ✂️ APLICANDO FILTRO DE VENTANA - Inicio: ${new Date(msVentanaInicio).toISOString()} | Fin: ${new Date(msVentanaFin).toISOString()}`);
            
            // TICKET #043: Prevención de ventana invertida (Ej: Inicio=Abril 26, Fin=Abril 23)
            let ventanaValida = true;
            if (msVentanaInicio > msVentanaFin) {
                console.log(`[PARSER] ⚠️ ADVERTENCIA CRÍTICA: Ventana temporal invertida detectada. El chofer ancló el Nodo Fin en una fecha anterior a la fecha teórica de la ruta (Inicio Teórico: ${new Date(msVentanaInicio).toISOString()}). Desactivando el filtro de ventana para evitar amputación masiva de datos reales.`);
                ventanaValida = false;
            }

            if (ventanaValida) {
                segmentos = segmentos.filter(obj => {
                const paradaInfo = obj.placeVisit || obj.visit;
                const movimientoInfo = obj.activitySegment || obj.activity;
                
                const rawStart = (paradaInfo && paradaInfo.duration && paradaInfo.duration.startTimestamp) || 
                                 (movimientoInfo && movimientoInfo.duration && movimientoInfo.duration.startTimestamp) || 
                                 obj.startTime;
                
                const rawEnd = (paradaInfo && paradaInfo.duration && paradaInfo.duration.endTimestamp) || 
                               (movimientoInfo && movimientoInfo.duration && movimientoInfo.duration.endTimestamp) || 
                               obj.endTime;
                
                if (!rawStart) return false;
                
                const msObjInicio = new Date(rawStart).getTime();
                const msObjFin = rawEnd ? new Date(rawEnd).getTime() : msObjInicio;
                
                // Si el segmento completo ocurrió antes de la ruta o después de la ruta, se descarta.
                // Permitimos solapamiento parcial (overlap).
                return (msObjInicio <= msVentanaFin && msObjFin >= msVentanaInicio);
                });
            } // Cierra if (ventanaValida)
            console.log(`[PARSER] Fase 3 (Acoplamiento de Ruta) completada. Restantes: ${segmentos.length}`);
        } // Cierra if (ventanaTemporal)

        const tramosExtraidos = [];
        let distanciaTotalRecorridaMts = 0;

        segmentos.forEach(obj => {
            // Unificar interfaces de parada: obj.placeVisit (Clásico) o obj.visit (E2EE Nuevo)
            const paradaInfo = obj.placeVisit || obj.visit;
            // Unificar interfaces de movimiento: obj.activitySegment (Clásico) o obj.activity (E2EE Nuevo)
            const movimientoInfo = obj.activitySegment || obj.activity;
            
            // Tiempos unificados
            // TICKET #041: Extensión Forense de Fallbacks Temporales
            const rawStart = (paradaInfo && paradaInfo.duration && paradaInfo.duration.startTimestamp) || 
                             (movimientoInfo && movimientoInfo.duration && movimientoInfo.duration.startTimestamp) || 
                             (movimientoInfo && movimientoInfo.startLocation && movimientoInfo.startLocation.timestamp) ||
                             obj.startTime;
                             
            const rawEnd = (paradaInfo && paradaInfo.duration && paradaInfo.duration.endTimestamp) || 
                           (movimientoInfo && movimientoInfo.duration && movimientoInfo.duration.endTimestamp) || 
                           (movimientoInfo && movimientoInfo.endLocation && movimientoInfo.endLocation.timestamp) ||
                           obj.endTime || rawStart;

            // Evaluar de forma laxa si es una posible parada (incluye segmentos estáticos UNKNOWN o sin clasificar)
            // TICKET #041 y #042: Si el segmento contiene una traza (timelinePath o simplifiedRawPath), es FÍSICAMENTE IMPOSIBLE que sea estático.
            let tieneTrazaEmpirica = (movimientoInfo && movimientoInfo.timelinePath) || (movimientoInfo && movimientoInfo.waypointPath) || (movimientoInfo && movimientoInfo.simplifiedRawPath) || obj.timelinePath || obj.waypointPath || obj.simplifiedRawPath;
            
            // TICKET #043: Fallback de Escaneo Profundo para Evitar Clasificación Falsa de Pausa
            if (!tieneTrazaEmpirica) {
                const puntosOcultos = this.extraerTodasLasCoordenadas([obj]);
                // Si la matriz extraída de manera forzada supera los 2 puntos (es decir, no es solo un origen/destino), es un TRASLADO físico.
                if (puntosOcultos && puntosOcultos.length > 2) {
                    tieneTrazaEmpirica = true;
                    console.log(`[AUDITORÍA FORENSE - CLASIFICACIÓN] ⚠️ Segmento salvado de ser clasificado como PAUSA. El escaneo profundo reveló ${puntosOcultos.length} puntos.`);
                }
            }

            const esActividadEstatica = movimientoInfo && (movimientoInfo.activityType === 'UNKNOWN_ACTIVITY' || movimientoInfo.activityType === 'STILL') && !tieneTrazaEmpirica;
            const esSegmentoAtipico = !paradaInfo && !movimientoInfo;
            const posibleParada = paradaInfo || esActividadEstatica || esSegmentoAtipico;

            if (posibleParada) {
                // Nodo de Detención (Extraemos coords de la raíz para tolerar segmentos atípicos)
                const coords = this.extraerCoordenadas(obj);
                if (coords && rawStart && rawEnd) {
                    const horaInicio = new Date(rawStart);
                    const horaFin = new Date(rawEnd);
                    const duracionMinutos = Math.round((horaFin - horaInicio) / 60000);

                    // A. Evaluar si es Nodo Cero (Inicio/Fin)
                    let esNodoCero = false;
                    for (const pb of puntosBase) {
                        // Si el punto base coincide con el nodo forzado de inicio o fin, usamos la tolerancia expandida (500m)
                        // Caso contrario usamos su radio definido o el por defecto (50m)
                        const esNodoForzado = (nodoInicio && pb.id === nodoInicio.id) || (nodoFin && pb.id === nodoFin.id);
                        const toleranciaActiva = esNodoForzado ? 500 : (pb.radio_tolerancia_metros || config.toleranciaMetros);

                        const distNodo = this.calcularDistanciaMetros(coords.lat, coords.lng, pb.latitud, pb.longitud);
                        if (distNodo <= toleranciaActiva) {
                            esNodoCero = true;
                            tramosExtraidos.push({
                                tipo_tramo: 'NODO_CERO',
                                nombre_ref: pb.nombre,
                                id_presupuesto: null,
                                tiempo_duracion_minutos: duracionMinutos,
                                coordenada_real_lng: coords.lng,
                                distancia_geocerca_metros: distNodo,
                                hora_inicio: horaInicio,
                                hora_fin: horaFin,
                                metodo_conciliacion: `Anclaje JSON Exacto [Empírico: ${this.formatearFecha(horaInicio)}]`
                            });
                            break;
                        }
                    }

                    // B. Si no es Nodo Cero, cruzamos con entregas LAMDA
                    if (!esNodoCero && duracionMinutos >= config.toleranciaTiempoMin) {
                        let entregaMatcheada = null;
                        let menorDistancia = Infinity;

                        for (const entrega of rutaLamdaEntregas) {
                            if (entrega.latitud && entrega.longitud) {
                                const dist = this.calcularDistanciaMetros(coords.lat, coords.lng, entrega.latitud, entrega.longitud);
                                if (dist <= config.toleranciaMetros && dist < menorDistancia) {
                                    menorDistancia = dist;
                                    entregaMatcheada = entrega;
                                }
                            }
                        }

                        if (entregaMatcheada) {
                            tramosExtraidos.push({
                                tipo_tramo: 'GESTION_CLIENTE',
                                nombre_ref: entregaMatcheada.cliente_nombre,
                                id_presupuesto: entregaMatcheada.id,
                                tiempo_duracion_minutos: duracionMinutos,
                                coordenada_real_lat: coords.lat,
                                coordenada_real_lng: coords.lng,
                                distancia_geocerca_metros: menorDistancia,
                                hora_inicio: horaInicio,
                                hora_fin: horaFin,
                                metodo_conciliacion: `Match Geográfico [Empírico: ${this.formatearFecha(horaInicio)}]`
                            });
                        } else {
                            tramosExtraidos.push({
                                tipo_tramo: 'PAUSA_NO_DECLARADA',
                                nombre_ref: 'Desconocido',
                                id_presupuesto: null,
                                tiempo_duracion_minutos: duracionMinutos,
                                coordenada_real_lat: coords.lat,
                                coordenada_real_lng: coords.lng,
                                distancia_geocerca_metros: null,
                                hora_inicio: horaInicio,
                                hora_fin: horaFin,
                                metodo_conciliacion: `Aislado por Algoritmo [Empírico: ${this.formatearFecha(horaInicio)}]`
                            });
                        }
                    }
                }
            } else if (movimientoInfo && !posibleParada) {
                // Segmento de Movimiento
                let distanceMeters = movimientoInfo.distance || movimientoInfo.distanceMeters || 0;
                if (distanceMeters) distanciaTotalRecorridaMts += distanceMeters;
                
                if (rawStart && rawEnd) {
                    const horaInicio = new Date(rawStart);
                    const horaFin = new Date(rawEnd);
                    const duracionMinutos = Math.round((horaFin - horaInicio) / 60000);
                    
                    tramosExtraidos.push({
                        tipo_tramo: 'TRASLADO',
                        nombre_ref: 'Conducción',
                        id_presupuesto: null,
                        tiempo_duracion_minutos: duracionMinutos,
                        coordenada_real_lat: null,
                        coordenada_real_lng: null,
                        distancia_geocerca_metros: distanceMeters,
                        hora_inicio: horaInicio,
                        hora_fin: horaFin,
                        _objOrigen: obj
                    });
                }
            }
        });

        // Ordenar tramos cronológicamente
        tramosExtraidos.sort((a, b) => a.hora_inicio - b.hora_inicio);

        // Asignar trazas empíricas a cada traslado individualmente
        tramosExtraidos.forEach((tramo, index) => {
            if (tramo.tipo_tramo === 'TRASLADO' && tramo._objOrigen) {
                console.log(`\n[AUDITORÍA FORENSE - INICIO TRAMO ${index + 1}] 🚀 Solicitando extracción para TRASLADO: ${tramo.nombre_ref}`);
                const traceDelTramo = this.extraerTodasLasCoordenadas([tramo._objOrigen]);
                console.log(`[AUDITORÍA FORENSE - SALIDA TRAMO ${index + 1}] 🏁 Extracción finalizada. Coordenadas empaquetadas: ${traceDelTramo.length} puntos.`);
                
                if (traceDelTramo && traceDelTramo.length > 0) {
                    tramo.trace_empirico = traceDelTramo;
                }
                delete tramo._objOrigen; // Limpiar propiedad temporal
            }
        });

        // Inyección Manual de Nodos Extremos
        if (nodoInicio || nodoFin) {
            const paradasValidas = tramosExtraidos.filter(t => t.coordenada_real_lat && t.coordenada_real_lng);
            
            if (paradasValidas.length > 0) {
                const primeraParada = paradasValidas[0];
                const ultimaParada = paradasValidas[paradasValidas.length - 1];

                if (nodoInicio && tramosExtraidos[0].tipo_tramo !== 'NODO_CERO') {
                    const distAInicio = this.calcularDistanciaMetros(nodoInicio.latitud, nodoInicio.longitud, primeraParada.coordenada_real_lat, primeraParada.coordenada_real_lng);
                    distanciaTotalRecorridaMts += distAInicio;
                    
                    const tiempoEstimadoMin = Math.round(distAInicio / 333); // 20 km/h
                    
                    tramosExtraidos.unshift({
                        tipo_tramo: 'TRASLADO',
                        nombre_ref: `Traslado (Inyectado desde ${nodoInicio.alias || nodoInicio.nombre})`,
                        id_presupuesto: null,
                        tiempo_duracion_minutos: tiempoEstimadoMin,
                        coordenada_real_lat: null,
                        coordenada_real_lng: null,
                        distancia_geocerca_metros: distAInicio,
                        hora_inicio: primeraParada.hora_inicio,
                        hora_fin: primeraParada.hora_inicio,
                        metodo_conciliacion: 'Fallback Matemático',
                        trace_empirico: null // No hay traza satelital para el inyectado
                    });
                    
                    tramosExtraidos.unshift({
                        tipo_tramo: 'NODO_CERO',
                        nombre_ref: `${nodoInicio.nombre} (Forzado)`,
                        id_presupuesto: null,
                        tiempo_duracion_minutos: 0,
                        coordenada_real_lat: nodoInicio.latitud,
                        coordenada_real_lng: nodoInicio.longitud,
                        distancia_geocerca_metros: 0,
                        hora_inicio: primeraParada.hora_inicio,
                        hora_fin: primeraParada.hora_inicio,
                        metodo_conciliacion: 'Fallback Teórico (No en JSON)'
                    });
                }

                if (nodoFin && tramosExtraidos[tramosExtraidos.length - 1].tipo_tramo !== 'NODO_CERO') {
                    const distAFin = this.calcularDistanciaMetros(ultimaParada.coordenada_real_lat, ultimaParada.coordenada_real_lng, nodoFin.latitud, nodoFin.longitud);
                    distanciaTotalRecorridaMts += distAFin;
                    
                    const tiempoEstimadoMin = Math.round(distAFin / 333);

                    tramosExtraidos.push({
                        tipo_tramo: 'TRASLADO',
                        nombre_ref: `Traslado (Inyectado hacia ${nodoFin.alias || nodoFin.nombre})`,
                        id_presupuesto: null,
                        tiempo_duracion_minutos: tiempoEstimadoMin,
                        coordenada_real_lat: null,
                        coordenada_real_lng: null,
                        distancia_geocerca_metros: distAFin,
                        hora_inicio: ultimaParada.hora_fin,
                        hora_fin: ultimaParada.hora_fin,
                        metodo_conciliacion: 'Fallback Matemático',
                        trace_empirico: null
                    });

                    tramosExtraidos.push({
                        tipo_tramo: 'NODO_CERO',
                        nombre_ref: `${nodoFin.nombre} (Forzado)`,
                        id_presupuesto: null,
                        tiempo_duracion_minutos: 0,
                        coordenada_real_lat: nodoFin.latitud,
                        coordenada_real_lng: nodoFin.longitud,
                        distancia_geocerca_metros: 0,
                        hora_inicio: ultimaParada.hora_fin,
                        hora_fin: ultimaParada.hora_fin,
                        metodo_conciliacion: 'Fallback Teórico (No en JSON)'
                    });
                }
            }
        }

        // Post-procesamiento: Generar Fallbacks (vectores directos) estrictamente donde no haya polilínea
        let ultimoNodo = null;
        tramosExtraidos.forEach((tramo, i) => {
            if (tramo.coordenada_real_lat && tramo.coordenada_real_lng) {
                ultimoNodo = { lat: tramo.coordenada_real_lat, lng: tramo.coordenada_real_lng };
            } else if (tramo.tipo_tramo === 'TRASLADO') {
                let proximoNodo = null;
                for (let j = i + 1; j < tramosExtraidos.length; j++) {
                    if (tramosExtraidos[j].coordenada_real_lat && tramosExtraidos[j].coordenada_real_lng) {
                        proximoNodo = { lat: tramosExtraidos[j].coordenada_real_lat, lng: tramosExtraidos[j].coordenada_real_lng };
                        break;
                    }
                }

                if (!tramo.trace_empirico || tramo.trace_empirico.length === 0) {
                    if (ultimoNodo && proximoNodo) {
                        tramo.trace_fallback = [ultimoNodo, proximoNodo];
                    }
                } else {
                    // Opcional: Asegurar que la polilínea visualmente conecte con los nodos (si no es muy densa)
                    if (ultimoNodo) tramo.trace_empirico.unshift(ultimoNodo);
                    if (proximoNodo) tramo.trace_empirico.push(proximoNodo);
                }
            }
        });

        const tiempoTotalOperativoMinutos = tramosExtraidos.reduce((acc, curr) => acc + curr.tiempo_duracion_minutos, 0);

        return {
            distancia_real_km: parseFloat((distanciaTotalRecorridaMts / 1000).toFixed(2)),
            tiempo_real_minutos: tiempoTotalOperativoMinutos,
            tramos: tramosExtraidos
        };
    }
}

module.exports = GoogleTimelineParser;
