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
     * Procesar un archivo JSON crudo de Google Timeline
     * @param {Object} timelineJson - Objeto JSON de Google
     * @param {Array} puntosBase - Lista de Nodos Cero (depósitos/casas)
     * @param {Array} rutaLamdaEntregas - Lista de paradas de la Ruta según base de datos LAMDA
     * @param {Object} config - Tolerancias paramétricas (geocerca en metros)
     */
    static procesar(timelineJson, puntosBase = [], rutaLamdaEntregas = [], config = { toleranciaMetros: 50, toleranciaTiempoMin: 3 }) {
        console.log('[PARSER] Iniciando procesamiento de Timeline JSON');
        
        if (!timelineJson.timelineObjects || !Array.isArray(timelineJson.timelineObjects)) {
            throw new Error('El archivo JSON no tiene el formato esperado de Google Timeline (falta timelineObjects).');
        }

        const tramosExtraidos = [];
        let distanciaTotalRecorridaMts = 0;

        // 1. Aplanar los objetos del timeline
        timelineJson.timelineObjects.forEach(obj => {
            if (obj.placeVisit) {
                // Nodo de Detención (Posible Parada o Nodo Cero)
                const loc = obj.placeVisit.location;
                const dur = obj.placeVisit.duration;
                
                if (loc && dur) {
                    const lat = this.parseE7(loc.latitudeE7);
                    const lng = this.parseE7(loc.longitudeE7);
                    const horaInicio = new Date(dur.startTimestamp);
                    const horaFin = new Date(dur.endTimestamp);
                    const duracionMinutos = Math.round((horaFin - horaInicio) / 60000);

                    // A. Evaluar si es Nodo Cero (Inicio/Fin)
                    let esNodoCero = false;
                    for (const pb of puntosBase) {
                        const distNodo = this.calcularDistanciaMetros(lat, lng, pb.latitud, pb.longitud);
                        if (distNodo <= (pb.radio_tolerancia_metros || config.toleranciaMetros)) {
                            esNodoCero = true;
                            tramosExtraidos.push({
                                tipo_tramo: 'NODO_CERO',
                                nombre_ref: pb.nombre,
                                id_presupuesto: null,
                                tiempo_duracion_minutos: duracionMinutos,
                                coordenada_real_lat: lat,
                                coordenada_real_lng: lng,
                                distancia_geocerca_metros: distNodo,
                                hora_inicio: horaInicio,
                                hora_fin: horaFin
                            });
                            break;
                        }
                    }

                    // B. Si no es Nodo Cero, cruzamos con las entregas de LAMDA
                    if (!esNodoCero && duracionMinutos >= config.toleranciaTiempoMin) {
                        let entregaMatcheada = null;
                        let menorDistancia = Infinity;

                        for (const entrega of rutaLamdaEntregas) {
                            if (entrega.latitud && entrega.longitud) {
                                const dist = this.calcularDistanciaMetros(lat, lng, entrega.latitud, entrega.longitud);
                                if (dist <= config.toleranciaMetros && dist < menorDistancia) {
                                    menorDistancia = dist;
                                    entregaMatcheada = entrega;
                                }
                            }
                        }

                        if (entregaMatcheada) {
                            // Coincide con entrega planificada
                            tramosExtraidos.push({
                                tipo_tramo: 'GESTION_CLIENTE',
                                nombre_ref: entregaMatcheada.cliente_nombre,
                                id_presupuesto: entregaMatcheada.id,
                                tiempo_duracion_minutos: duracionMinutos,
                                coordenada_real_lat: lat,
                                coordenada_real_lng: lng,
                                distancia_geocerca_metros: menorDistancia,
                                hora_inicio: horaInicio,
                                hora_fin: horaFin
                            });
                        } else {
                            // Parada prolongada no declarada comercialmente
                            tramosExtraidos.push({
                                tipo_tramo: 'PAUSA_NO_DECLARADA',
                                nombre_ref: 'Desconocido',
                                id_presupuesto: null,
                                tiempo_duracion_minutos: duracionMinutos,
                                coordenada_real_lat: lat,
                                coordenada_real_lng: lng,
                                distancia_geocerca_metros: null,
                                hora_inicio: horaInicio,
                                hora_fin: horaFin
                            });
                        }
                    }
                }
            } else if (obj.activitySegment) {
                // Segmento en Movimiento (Traslado)
                const act = obj.activitySegment;
                if (act.distance) {
                    distanciaTotalRecorridaMts += act.distance;
                }
                if (act.duration) {
                    const horaInicio = new Date(act.duration.startTimestamp);
                    const horaFin = new Date(act.duration.endTimestamp);
                    const duracionMinutos = Math.round((horaFin - horaInicio) / 60000);
                    
                    tramosExtraidos.push({
                        tipo_tramo: 'TRASLADO',
                        nombre_ref: 'Conducción',
                        id_presupuesto: null,
                        tiempo_duracion_minutos: duracionMinutos,
                        coordenada_real_lat: null,
                        coordenada_real_lng: null,
                        distancia_geocerca_metros: act.distance || 0, // En Traslado guardamos metros recorridos aquí temporalmente
                        hora_inicio: horaInicio,
                        hora_fin: horaFin
                    });
                }
            }
        });

        // Ordenar tramos cronológicamente
        tramosExtraidos.sort((a, b) => a.hora_inicio - b.hora_inicio);

        const tiempoTotalOperativoMinutos = tramosExtraidos.reduce((acc, curr) => acc + curr.tiempo_duracion_minutos, 0);

        return {
            distancia_real_km: parseFloat((distanciaTotalRecorridaMts / 1000).toFixed(2)),
            tiempo_real_minutos: tiempoTotalOperativoMinutos,
            tramos: tramosExtraidos
        };
    }
}

module.exports = GoogleTimelineParser;
