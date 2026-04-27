require('dotenv').config();
const { ejecutarQuery } = require('../src/logistica/config/database');

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

async function aplicarFiltro() {
    console.log("Iniciando validación cinemática masiva en base de datos...");
    
    try {
        const res = await ejecutarQuery('SELECT id, timestamp_ms, latitud, longitud FROM logistica_satelite_puntos ORDER BY timestamp_ms ASC', [], 'Obtener Puntos');
        const puntos = res.rows;
        
        console.log(`Analizando ${puntos.length} puntos...`);

        let ultimoPuntoValido = null;
        let bufferParada = [];
        let countRuido = 0;
        let countParadas = 0;

        for (let i = 0; i < puntos.length; i++) {
            const punto = puntos[i];
            const lat = parseFloat(punto.latitud);
            const lng = parseFloat(punto.longitud);
            const ts = parseInt(punto.timestamp_ms);

            let ruido = false;
            let velocidadKmh = null;
            let parada = false;

            // B. Filtro Cinemático
            if (ultimoPuntoValido) {
                const distMetros = calcularDistanciaMetros(ultimoPuntoValido.lat, ultimoPuntoValido.lng, lat, lng);
                const tiempoHoras = (ts - ultimoPuntoValido.ts) / 3600000;
                
                if (tiempoHoras > 0) {
                    velocidadKmh = (distMetros / 1000) / tiempoHoras;
                    
                    if (velocidadKmh > 130) {
                        ruido = true;
                        countRuido++;
                    } else {
                        ultimoPuntoValido = { id: punto.id, lat, lng, ts };
                    }
                } else {
                    ultimoPuntoValido = { id: punto.id, lat, lng, ts };
                }
            } else {
                ultimoPuntoValido = { id: punto.id, lat, lng, ts };
            }

            // Actualizamos en BD
            await ejecutarQuery(
                'UPDATE logistica_satelite_puntos SET ruido_sincronizacion = $1, velocidad_calculada_kmh = $2 WHERE id = $3',
                [ruido, velocidadKmh ? Math.round(velocidadKmh * 100) / 100 : null, punto.id],
                'Update Ruido'
            );

            // C. Stay-Point Detection
            if (!ruido) {
                if (bufferParada.length === 0) {
                    bufferParada.push({ id: punto.id, lat, lng, ts });
                } else {
                    const sumLat = bufferParada.reduce((sum, p) => sum + p.lat, 0);
                    const sumLng = bufferParada.reduce((sum, p) => sum + p.lng, 0);
                    const centroidLat = sumLat / bufferParada.length;
                    const centroidLng = sumLng / bufferParada.length;

                    const distToCentroid = calcularDistanciaMetros(centroidLat, centroidLng, lat, lng);

                    if (distToCentroid <= 30) {
                        bufferParada.push({ id: punto.id, lat, lng, ts });
                        const tiempoEstanciaMs = bufferParada[bufferParada.length - 1].ts - bufferParada[0].ts;
                        if (tiempoEstanciaMs >= 5 * 60000) {
                            // Update todos los IDs en el buffer
                            const ids = bufferParada.map(p => p.id);
                            await ejecutarQuery(
                                'UPDATE logistica_satelite_puntos SET es_parada_real = true WHERE id = ANY($1::int[])',
                                [ids],
                                'Update Parada'
                            );
                            countParadas += ids.length;
                        }
                    } else {
                        bufferParada = [{ id: punto.id, lat, lng, ts }];
                    }
                }
            }
        }

        console.log(`[EXITO] Validación completada.`);
        console.log(`Puntos marcados como ruido espacial (>130km/h): ${countRuido}`);
        console.log(`Puntos marcados como anclaje de parada real (>5min): ${countParadas}`);
        
    } catch (e) {
        console.error("Error en validación:", e);
    }
}

aplicarFiltro();
