const fs = require('fs');
const GoogleTimelineParser = require('../services/googleTimelineParser');
const ReservorioModel = require('../models/reservorioModel');

class ReservorioController {
    /**
     * Procesa la ingesta de un archivo JSON del Google Timeline 
     * Inyección agnóstica de trazado
     */
    static async ingestarJSON(req, res) {
        try {
            console.log('[RESERVORIO] Iniciando ingesta satelital agnóstica...');

            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No se subió ningún archivo' });
            }
            // 1. Leer archivo
            const timelineJsonStr = fs.readFileSync(req.file.path, 'utf8');
            const dataRaw = JSON.parse(timelineJsonStr);
            let segmentosCrudos = [];
            
            if (dataRaw.timelineObjects) {
                segmentosCrudos = dataRaw.timelineObjects;
            } else if (dataRaw.semanticSegments) {
                segmentosCrudos = dataRaw.semanticSegments;
            } else {
                throw new Error("Estructura de JSON no reconocida. No se encontraron timelineObjects ni semanticSegments.");
            }

            // 2. Obtener punto de partida (último registro en la BD)
            const ultimoMs = await ReservorioModel.obtenerUltimoTimestamp() || 0;
            console.log(`[RESERVORIO] Ingestando novedades a partir del timestamp: ${ultimoMs} (${ultimoMs > 0 ? new Date(ultimoMs).toISOString() : 'INICIO'})`);

            // 3. Purga Temprana y Extracción de Puntos
            let puntosAInsertar = [];
            let eventosAInsertar = [];
            
            // Helpers nativos para extracción de timestamps desde la estructura variable de Google
            const getMsInicio = (obj) => {
                const rawStart = (obj.duration && obj.duration.startTimestamp) || 
                                 obj.startTime || 
                                 (obj.activity && obj.activity.timestamp) ||
                                 (obj.activityRecord && obj.activityRecord.timestamp) ||
                                 (obj.position && obj.position.timestamp) ||
                                 (obj.placeVisit && obj.placeVisit.duration && obj.placeVisit.duration.startTimestamp) ||
                                 (obj.visit && obj.visit.duration && obj.visit.duration.startTimestamp) ||
                                 (obj.activitySegment && obj.activitySegment.duration && obj.activitySegment.duration.startTimestamp) ||
                                 (obj.activitySegment && obj.activitySegment.startLocation && obj.activitySegment.startLocation.timestamp);
                return rawStart ? new Date(rawStart).getTime() : 0;
            };

            const getMsFin = (obj) => {
                const rawStart = getMsInicio(obj);
                const rawEnd = (obj.duration && obj.duration.endTimestamp) || 
                               obj.endTime || 
                               (obj.placeVisit && obj.placeVisit.duration && obj.placeVisit.duration.endTimestamp) ||
                               (obj.visit && obj.visit.duration && obj.visit.duration.endTimestamp) ||
                               (obj.activitySegment && obj.activitySegment.duration && obj.activitySegment.duration.endTimestamp) ||
                               (obj.activitySegment && obj.activitySegment.endLocation && obj.activitySegment.endLocation.timestamp);
                return rawEnd ? new Date(rawEnd).getTime() : rawStart;
            };
            
            // Usamos la lógica de extracción cruda del parser existente
            // Primero ordenamos los segmentos
            segmentosCrudos.sort((a, b) => {
                return getMsInicio(a) - getMsInicio(b);
            });

            // Filtramos sólo los segmentos posteriores al watermark
            const segmentosNuevos = segmentosCrudos.filter(seg => {
                const ms = getMsFin(seg) || getMsInicio(seg);
                return ms > ultimoMs;
            });

            console.log(`[RESERVORIO] Descartados ${segmentosCrudos.length - segmentosNuevos.length} segmentos antiguos. Procesando ${segmentosNuevos.length} nuevos.`);

            segmentosNuevos.forEach(obj => {
                // A. Extraer Puntos de Traza Empírica
                const pts = GoogleTimelineParser.extraerTodasLasCoordenadas([obj]);
                if (pts && pts.length > 0) {
                    let baseMs = getMsInicio(obj);
                    let syntheticOffset = 0; // Ticket #061: Offset artificial para preservar geometría

                    pts.forEach((p, idx) => {
                        let ms = 0;
                        if (p.timestamp) {
                            ms = new Date(p.timestamp).getTime();
                        } else {
                            // TICKET #061: Si Google no manda timestamp por punto, usamos el inicio + offset (1ms por punto)
                            // Si todos los puntos tuvieran el mismo ms, la deduplicación de Map y SQL (UNIQUE) destruiría la ruta completa dejando solo el último vértice.
                            ms = baseMs + syntheticOffset;
                            syntheticOffset++;
                        }

                        if (ms > ultimoMs) {
                            puntosAInsertar.push({
                                lat: p.lat,
                                lng: p.lng,
                                timestamp: ms,
                                precision: null
                            });
                        }
                    });
                }

                // B. Extraer Semántica (Paradas/Nodos)
                const paradaInfo = obj.placeVisit || obj.visit || (obj.activity && obj.activity.placeVisit);
                const movimientoInfo = obj.activitySegment || obj.activity || (obj.activity && obj.activity.activitySegment);
                
                const msInicio = getMsInicio(obj);
                const msFin = getMsFin(obj);

                if (paradaInfo && msInicio > ultimoMs) {
                    const placeName = (paradaInfo.location && (paradaInfo.location.name || paradaInfo.location.address)) || 
                                      (paradaInfo.topCandidate && paradaInfo.topCandidate.placeId) || 'Desconocido';
                    const locationObj = paradaInfo.location || (paradaInfo.topCandidate && paradaInfo.topCandidate.placeLocation);
                    const coord = GoogleTimelineParser.extraerCoordenadas(locationObj);
                    eventosAInsertar.push({
                        inicio: msInicio,
                        fin: msFin,
                        tipo: 'PARADA',
                        nombre: placeName,
                        lat: coord ? coord.lat : null,
                        lng: coord ? coord.lng : null,
                        raw_path: null
                    });
                } else if (movimientoInfo && msInicio > ultimoMs) {
                    const pathObj = movimientoInfo.simplifiedRawPath || movimientoInfo.waypointPath || obj.timelinePath;
                    const pathPts = pathObj ? GoogleTimelineParser.extraerTodasLasCoordenadas([pathObj]) : [];
                    eventosAInsertar.push({
                        inicio: msInicio,
                        fin: msFin,
                        tipo: 'TRASLADO',
                        nombre: movimientoInfo.activityType || 'Desconocido',
                        lat: null,
                        lng: null,
                        raw_path: pathPts.length > 0 ? JSON.stringify(pathPts) : null
                    });
                }
            });

            // 4. Inserción Masiva
            console.log(`[RESERVORIO] Insertando ${puntosAInsertar.length} puntos y ${eventosAInsertar.length} eventos...`);
            
            // Deduplicar puntos con mismo timestamp (para evitar conflictos de la restricción uk_chofer_tiempo)
            const mapPuntos = new Map();
            puntosAInsertar.forEach(p => {
                mapPuntos.set(p.timestamp, p); // Sobrescribe si hay empate de ms exacto
            });
            const puntosUnicos = Array.from(mapPuntos.values());

            // =========================================================
            // TICKET #068: INGESTA CON FILTRO DE VERDAD FÍSICA
            // =========================================================
            
            // ETAPA A: Ordenamiento Pre-Inserción
            puntosUnicos.sort((a, b) => a.timestamp - b.timestamp);

            // ETAPA B & C: Filtro Cinemático y Stay-Points
            let bufferParada = [];
            let ultimoPuntoValido = null;

            puntosUnicos.forEach(punto => {
                punto.ruido_sincronizacion = false;
                punto.velocidad_calculada_kmh = null;
                punto.es_parada_real = false;

                // B. Filtro Cinemático (Anti-Teletransportación)
                if (ultimoPuntoValido) {
                    const distMetros = GoogleTimelineParser.calcularDistanciaMetros(ultimoPuntoValido.lat, ultimoPuntoValido.lng, punto.lat, punto.lng);
                    const tiempoHoras = (punto.timestamp - ultimoPuntoValido.timestamp) / 3600000;
                    
                    if (tiempoHoras > 0) {
                        const velocidadKmh = (distMetros / 1000) / tiempoHoras;
                        punto.velocidad_calculada_kmh = Math.round(velocidadKmh * 100) / 100;
                        
                        if (velocidadKmh > 130) {
                            punto.ruido_sincronizacion = true;
                        } else {
                            ultimoPuntoValido = punto;
                        }
                    } else {
                        ultimoPuntoValido = punto; // Mismo timestamp
                    }
                } else {
                    ultimoPuntoValido = punto;
                }

                // C. Stay-Point Detection (Solo operamos sobre puntos válidos)
                if (!punto.ruido_sincronizacion) {
                    if (bufferParada.length === 0) {
                        bufferParada.push(punto);
                    } else {
                        // Calcular centroide simple (promedio)
                        const sumLat = bufferParada.reduce((sum, p) => sum + parseFloat(p.lat), 0);
                        const sumLng = bufferParada.reduce((sum, p) => sum + parseFloat(p.lng), 0);
                        const centroidLat = sumLat / bufferParada.length;
                        const centroidLng = sumLng / bufferParada.length;

                        const distToCentroid = GoogleTimelineParser.calcularDistanciaMetros(centroidLat, centroidLng, punto.lat, punto.lng);

                        if (distToCentroid <= 30) {
                            bufferParada.push(punto);
                            const tiempoEstanciaMs = bufferParada[bufferParada.length - 1].timestamp - bufferParada[0].timestamp;
                            if (tiempoEstanciaMs >= 5 * 60000) { // >= 5 min
                                bufferParada.forEach(p => p.es_parada_real = true);
                            }
                        } else {
                            bufferParada = [punto]; // Rotura de clúster, inicio de nuevo tramo
                        }
                    }
                }
            });

            const totalPuntos = await ReservorioModel.bulkInsertPuntos(puntosUnicos);
            const totalEventos = await ReservorioModel.bulkInsertEventos(eventosAInsertar);

            // Eliminar archivo temporal
            fs.unlinkSync(req.file.path);

            return res.json({
                success: true,
                message: 'Ingesta completada',
                data: {
                    puntos_insertados: totalPuntos,
                    eventos_insertados: totalEventos
                }
            });

        } catch (error) {
            console.error('[RESERVORIO] Error en ingesta:', error);
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Consulta cronológica para la UI de Auditoría Satelital
     */
    static async consultarTrazado(req, res) {
        try {
            const { ms_inicio, ms_fin } = req.query;
            
            if (!ms_inicio || !ms_fin) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros obligatorios (ms_inicio, ms_fin)' });
            }

            const msInicio = parseInt(ms_inicio);
            const msFin = parseInt(ms_fin);

            console.log(`[RESERVORIO] Consultando trazado agnóstico desde ${new Date(msInicio).toISOString()} hasta ${new Date(msFin).toISOString()}`);

            const puntos = await ReservorioModel.consultarTrazado(msInicio, msFin);
            const eventos = await ReservorioModel.consultarEventos(msInicio, msFin);

            // Formatear respuesta imitando la estructura plana que espera la nueva UI de auditoria-rutas.html
            const tramosFlats = [];

            // A. Añadir Eventos
            eventos.forEach(evt => {
                let tipo_tramo = 'PAUSA_NO_DECLARADA';
                let nombre_ref = evt.nombre;
                
                if (evt.tipo === 'PARADA') {
                    tipo_tramo = 'GESTION_CLIENTE'; // Usamos GESTION_CLIENTE genérico para que se pinte en la UI
                } else if (evt.nombre === 'IN_PASSENGER_VEHICLE' || evt.nombre === 'IN_VEHICLE' || evt.tipo === 'TRASLADO') {
                    // No mapeamos eventos de traslado como nodos visuales para no ensuciar, los saltamos
                    return; 
                }

                tramosFlats.push({
                    tipo_tramo: tipo_tramo,
                    nombre_ref: nombre_ref,
                    hora_inicio: evt.inicio,
                    hora_fin: evt.fin,
                    tiempo_duracion_minutos: Math.round((evt.fin - evt.inicio) / 60000),
                    coordenada_real_lat: null, // Como es semántico genérico y no está cruzado con base, lo dejamos nulo o buscamos un punto cercano
                    coordenada_real_lng: null,
                    metodo_conciliacion: 'Reservorio Satelital'
                });
            });

            // Asignar coordenadas a los eventos usando el punto empírico más cercano en tiempo
            tramosFlats.forEach(evt => {
                const puntoCercano = puntos.find(p => p.timestamp >= evt.hora_inicio && p.timestamp <= evt.hora_fin) ||
                                     puntos.reduce((prev, curr) => Math.abs(curr.timestamp - evt.hora_inicio) < Math.abs(prev.timestamp - evt.hora_inicio) ? curr : prev, puntos[0]);
                if (puntoCercano) {
                    evt.coordenada_real_lat = puntoCercano.lat;
                    evt.coordenada_real_lng = puntoCercano.lng;
                }
            });

            // B. Añadir el Traslado global con la traza completa
            if (puntos.length > 0) {
                tramosFlats.push({
                    tipo_tramo: 'TRASLADO',
                    nombre_ref: 'Traza Empírica (Reservorio)',
                    hora_inicio: msInicio,
                    tiempo_duracion_minutos: Math.round((msFin - msInicio) / 60000),
                    distancia_geocerca_metros: 0,
                    trace_empirico: puntos.map(p => ({
                        lat: p.lat,
                        lng: p.lng,
                        timestamp: p.timestamp
                    }))
                });
            }

            return res.json({
                success: true,
                data: {
                    tramos: tramosFlats
                }
            });

        } catch (error) {
            console.error('[RESERVORIO] Error consultando trazado:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Purga total del reservorio satelital (Solo coordenadas)
     */
    static async vaciarReservorio(req, res) {
        try {
            console.log('[RESERVORIO] ⚠️ Solicitud de purga total recibida (Vaciado Quirúrgico).');
            await ReservorioModel.vaciarReservorio();
            console.log('[RESERVORIO] ✅ Purga ejecutada exitosamente.');
            return res.json({ success: true, message: 'Reservorio purgado exitosamente.' });
        } catch (error) {
            console.error('[RESERVORIO] ❌ Error en purga:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }
}

module.exports = ReservorioController;
