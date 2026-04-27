require('dotenv').config();
const fs = require('fs');
const { ejecutarQuery } = require('../src/logistica/config/database');
const ReservorioModel = require('../src/logistica/models/reservorioModel');
const GoogleTimelineParser = require('../src/logistica/services/googleTimelineParser');

async function reingestar() {
    try {
        console.log("1. Vaciando reservorio...");
        await ReservorioModel.vaciarReservorio();

        console.log("2. Leyendo JSON...");
        const timelineJsonStr = fs.readFileSync('C:\\Users\\Martin\\Desktop\\Rutas 26_04_2026.json', 'utf8');
        const dataRaw = JSON.parse(timelineJsonStr);
        let segmentosCrudos = dataRaw.timelineObjects || dataRaw.semanticSegments || [];

        console.log(`Encontrados ${segmentosCrudos.length} segmentos crudos.`);

        let puntosAInsertar = [];
        let eventosAInsertar = [];
        let ultimoMs = 0;

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

        segmentosCrudos.sort((a, b) => getMsInicio(a) - getMsInicio(b));

        segmentosCrudos.forEach(obj => {
            const pts = GoogleTimelineParser.extraerTodasLasCoordenadas([obj]);
            if (pts && pts.length > 0) {
                let baseMs = getMsInicio(obj);
                let syntheticOffset = 0;
                pts.forEach(p => {
                    let ms = p.timestamp ? new Date(p.timestamp).getTime() : baseMs + syntheticOffset++;
                    puntosAInsertar.push({ lat: p.lat, lng: p.lng, timestamp: ms, precision: null });
                });
            }

            const paradaInfo = obj.placeVisit || obj.visit || (obj.activity && obj.activity.placeVisit);
            const movimientoInfo = obj.activitySegment || obj.activity || (obj.activity && obj.activity.activitySegment);
            const msInicio = getMsInicio(obj);
            const msFin = getMsFin(obj);

            if (paradaInfo) {
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
            } else if (movimientoInfo) {
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

        // Deduplicar puntos
        const mapPuntos = new Map();
        puntosAInsertar.forEach(p => mapPuntos.set(p.timestamp, p));
        const puntosUnicos = Array.from(mapPuntos.values()).sort((a, b) => a.timestamp - b.timestamp);

        // Filtro cinemático
        let bufferParada = [];
        let ultimoPuntoValido = null;
        puntosUnicos.forEach(punto => {
            punto.ruido_sincronizacion = false;
            punto.velocidad_calculada_kmh = null;
            punto.es_parada_real = false;

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
                    ultimoPuntoValido = punto;
                }
            } else {
                ultimoPuntoValido = punto;
            }

            if (!punto.ruido_sincronizacion) {
                if (bufferParada.length === 0) {
                    bufferParada.push(punto);
                } else {
                    const sumLat = bufferParada.reduce((sum, p) => sum + parseFloat(p.lat), 0);
                    const sumLng = bufferParada.reduce((sum, p) => sum + parseFloat(p.lng), 0);
                    const centroidLat = sumLat / bufferParada.length;
                    const centroidLng = sumLng / bufferParada.length;
                    const distToCentroid = GoogleTimelineParser.calcularDistanciaMetros(centroidLat, centroidLng, punto.lat, punto.lng);

                    if (distToCentroid <= 30) {
                        bufferParada.push(punto);
                        const tiempoEstanciaMs = bufferParada[bufferParada.length - 1].timestamp - bufferParada[0].timestamp;
                        if (tiempoEstanciaMs >= 5 * 60000) {
                            bufferParada.forEach(p => p.es_parada_real = true);
                        }
                    } else {
                        bufferParada = [punto];
                    }
                }
            }
        });

        console.log(`3. Insertando ${puntosUnicos.length} puntos y ${eventosAInsertar.length} eventos...`);
        await ReservorioModel.bulkInsertPuntos(puntosUnicos);
        await ReservorioModel.bulkInsertEventos(eventosAInsertar);
        
        console.log("4. Finalizado.");
        process.exit(0);

    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

reingestar();
