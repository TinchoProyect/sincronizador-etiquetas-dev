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
            if (typeof obj !== 'object' || obj === null) return;
            
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
            // Formato String (lat, lng) o LatLng objeto
            if (obj.latLng) {
                if (typeof obj.latLng === 'string') {
                    const partes = obj.latLng.split(',');
                    if (partes.length === 2) {
                        lat = parseFloat(partes[0].trim());
                        lng = parseFloat(partes[1].trim());
                        return;
                    }
                } else if (obj.latLng.latitude !== undefined) {
                    lat = parseFloat(obj.latLng.latitude);
                    lng = parseFloat(obj.latLng.longitude);
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
    static extraerTodasLasCoordenadas(nodo) {
        if (!nodo) return [];
        let puntos = [];
        
        const buscar = (obj) => {
            if (typeof obj !== 'object' || obj === null) return;
            
            if (Array.isArray(obj)) {
                obj.forEach(buscar);
                return;
            }

            let lat = null, lng = null;
            if (obj.latitudeE7 !== undefined && obj.longitudeE7 !== undefined) {
                lat = parseFloat((obj.latitudeE7 / 10000000).toFixed(7));
                lng = parseFloat((obj.longitudeE7 / 10000000).toFixed(7));
            } else if (obj.latitude !== undefined && obj.longitude !== undefined) {
                lat = parseFloat(obj.latitude);
                lng = parseFloat(obj.longitude);
            } else if (obj.latLng) {
                if (typeof obj.latLng === 'string') {
                    const partes = obj.latLng.split(',');
                    if (partes.length === 2) {
                        lat = parseFloat(partes[0].trim());
                        lng = parseFloat(partes[1].trim());
                    }
                } else if (obj.latLng.latitude !== undefined) {
                    lat = parseFloat(obj.latLng.latitude);
                    lng = parseFloat(obj.latLng.longitude);
                }
            }

            if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
                puntos.push({ lat, lng });
            }

            for (const key in obj) {
                // Evitamos recursión en strings/números para optimizar
                if (typeof obj[key] === 'object') buscar(obj[key]);
            }
        };

        buscar(nodo);
        return puntos;
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

        // Filtro de Contexto (Ticket #021): Aislar estrictamente los segmentos correspondientes a la ruta
        if (ventanaTemporal && ventanaTemporal.inicio && ventanaTemporal.fin) {
            const msVentanaInicio = ventanaTemporal.inicio;
            const msVentanaFin = ventanaTemporal.fin;

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
        }

        const tramosExtraidos = [];
        let distanciaTotalRecorridaMts = 0;

        segmentos.forEach(obj => {
            // Unificar interfaces de parada: obj.placeVisit (Clásico) o obj.visit (E2EE Nuevo)
            const paradaInfo = obj.placeVisit || obj.visit;
            // Unificar interfaces de movimiento: obj.activitySegment (Clásico) o obj.activity (E2EE Nuevo)
            const movimientoInfo = obj.activitySegment || obj.activity;
            
            // Tiempos unificados
            // En E2EE, el startTime/endTime están directamente en el obj raíz (semanticSegment) o dentro de duration.
            const rawStart = (paradaInfo && paradaInfo.duration && paradaInfo.duration.startTimestamp) || 
                             (movimientoInfo && movimientoInfo.duration && movimientoInfo.duration.startTimestamp) || 
                             obj.startTime;
                             
            const rawEnd = (paradaInfo && paradaInfo.duration && paradaInfo.duration.endTimestamp) || 
                           (movimientoInfo && movimientoInfo.duration && movimientoInfo.duration.endTimestamp) || 
                           obj.endTime;

            if (paradaInfo) {
                // Nodo de Detención
                const coords = this.extraerCoordenadas(paradaInfo);
                if (coords && rawStart && rawEnd) {
                    const horaInicio = new Date(rawStart);
                    const horaFin = new Date(rawEnd);
                    const duracionMinutos = Math.round((horaFin - horaInicio) / 60000);

                    // A. Evaluar si es Nodo Cero (Inicio/Fin)
                    let esNodoCero = false;
                    for (const pb of puntosBase) {
                        const distNodo = this.calcularDistanciaMetros(coords.lat, coords.lng, pb.latitud, pb.longitud);
                        if (distNodo <= (pb.radio_tolerancia_metros || config.toleranciaMetros)) {
                            esNodoCero = true;
                            tramosExtraidos.push({
                                tipo_tramo: 'NODO_CERO',
                                nombre_ref: pb.nombre,
                                id_presupuesto: null,
                                tiempo_duracion_minutos: duracionMinutos,
                                coordenada_real_lat: coords.lat,
                                coordenada_real_lng: coords.lng,
                                distancia_geocerca_metros: distNodo,
                                hora_inicio: horaInicio,
                                hora_fin: horaFin
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
                                hora_fin: horaFin
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
                                hora_fin: horaFin
                            });
                        }
                    }
                }
            } else if (movimientoInfo) {
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
                        hora_fin: horaFin
                    });
                }
            }
        });

        // Ordenar tramos cronológicamente
        tramosExtraidos.sort((a, b) => a.hora_inicio - b.hora_inicio);

        // Inyección Manual de Nodos Extremos
        if (nodoInicio || nodoFin) {
            const paradasValidas = tramosExtraidos.filter(t => t.coordenada_real_lat && t.coordenada_real_lng);
            
            if (paradasValidas.length > 0) {
                const primeraParada = paradasValidas[0];
                const ultimaParada = paradasValidas[paradasValidas.length - 1];

                if (nodoInicio && tramosExtraidos[0].tipo_tramo !== 'NODO_CERO') {
                    const distAInicio = this.calcularDistanciaMetros(nodoInicio.latitud, nodoInicio.longitud, primeraParada.coordenada_real_lat, primeraParada.coordenada_real_lng);
                    distanciaTotalRecorridaMts += distAInicio;
                    
                    tramosExtraidos.unshift({
                        tipo_tramo: 'TRASLADO',
                        nombre_ref: `Traslado (Inyectado desde ${nodoInicio.alias || nodoInicio.nombre})`,
                        id_presupuesto: null,
                        tiempo_duracion_minutos: 0,
                        coordenada_real_lat: null,
                        coordenada_real_lng: null,
                        distancia_geocerca_metros: distAInicio,
                        hora_inicio: primeraParada.hora_inicio,
                        hora_fin: primeraParada.hora_inicio
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
                        hora_fin: primeraParada.hora_inicio
                    });
                }

                if (nodoFin && tramosExtraidos[tramosExtraidos.length - 1].tipo_tramo !== 'NODO_CERO') {
                    const distAFin = this.calcularDistanciaMetros(ultimaParada.coordenada_real_lat, ultimaParada.coordenada_real_lng, nodoFin.latitud, nodoFin.longitud);
                    distanciaTotalRecorridaMts += distAFin;
                    
                    tramosExtraidos.push({
                        tipo_tramo: 'TRASLADO',
                        nombre_ref: `Traslado (Inyectado hacia ${nodoFin.alias || nodoFin.nombre})`,
                        id_presupuesto: null,
                        tiempo_duracion_minutos: 0,
                        coordenada_real_lat: null,
                        coordenada_real_lng: null,
                        distancia_geocerca_metros: distAFin,
                        hora_inicio: ultimaParada.hora_fin,
                        hora_fin: ultimaParada.hora_fin
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
                        hora_fin: ultimaParada.hora_fin
                    });
                }
            }
        }

        const tiempoTotalOperativoMinutos = tramosExtraidos.reduce((acc, curr) => acc + curr.tiempo_duracion_minutos, 0);

        // Extraer la traza visual completa
        const traceCompleto = this.extraerTodasLasCoordenadas(segmentos);
        if (nodoInicio && traceCompleto.length > 0) {
            traceCompleto.unshift({ lat: nodoInicio.latitud, lng: nodoInicio.longitud });
        }
        if (nodoFin && traceCompleto.length > 0) {
            traceCompleto.push({ lat: nodoFin.latitud, lng: nodoFin.longitud });
        }

        return {
            distancia_real_km: parseFloat((distanciaTotalRecorridaMts / 1000).toFixed(2)),
            tiempo_real_minutos: tiempoTotalOperativoMinutos,
            tramos: tramosExtraidos,
            trace: traceCompleto
        };
    }
}

module.exports = GoogleTimelineParser;
