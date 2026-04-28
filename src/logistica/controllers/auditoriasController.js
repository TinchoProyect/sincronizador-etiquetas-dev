/**
 * Controlador de Auditorías de Rutas
 * Lógica transaccional REST para la conciliación de rutas
 */

const AuditoriasModel = require('../models/auditoriasModel');
const PuntosBaseModel = require('../models/puntosBaseModel');
const RutasModel = require('../models/rutasModel');
const GoogleTimelineParser = require('../services/googleTimelineParser');

class AuditoriasController {
    
    /**
     * Procesar un archivo JSON de Google (En memoria, no guarda)
     * Retorna la vista previa de la auditoría.
     */
    static async procesarAuditoriaPreview(req, res) {
        try {
            console.log('[AUDITORIAS] Iniciando procesamiento de preview JSON');
            
            // Validaciones
            const id_ruta = parseInt(req.body.id_ruta);
            
            if (!id_ruta) return res.status(400).json({ success: false, error: 'Se requiere ID de Ruta' });

            // 1. Obtener la Ruta original y sus entregas
            const ruta = await RutasModel.obtenerPorId(id_ruta);
            if (!ruta) return res.status(404).json({ success: false, error: 'Ruta no encontrada' });
            
            // Extraer las entregas/paradas mapeadas con sus latitudes
            const paradas = ruta.presupuestos || [];

            // 2. Obtener Puntos Base
            const puntosBase = await PuntosBaseModel.obtenerTodos();

            const idNodoInicio = req.body.id_nodo_inicio;
            const idNodoFin = req.body.id_nodo_fin;
            
            let nodoInicio = null;
            let nodoFin = null;
            if (idNodoInicio) nodoInicio = puntosBase.find(p => p.id == idNodoInicio);
            if (idNodoFin) nodoFin = puntosBase.find(p => p.id == idNodoFin);

            // Definir ventana de tiempo de la ruta para acotar la Realidad Satelital
            const msInicioRaw = ruta.fecha_salida ? new Date(ruta.fecha_salida).getTime() : new Date(ruta.fecha_creacion).getTime();
            let msFinRaw = new Date().getTime(); // Si no terminó, hasta el presente
            if (ruta.fecha_finalizacion) {
                msFinRaw = new Date(ruta.fecha_finalizacion).getTime();
            }

            // Aplicar heurística de 12 horas de rescate por clics tardíos
            const msInicio = msInicioRaw - (12 * 60 * 60 * 1000);
            const msFin = msFinRaw + (12 * 60 * 60 * 1000);

            // 3. Obtener Data del Reservorio (Agnóstico, solo por tiempo)
            const ReservorioModel = require('../models/reservorioModel');
            
            const puntosDb = await ReservorioModel.consultarTrazado(msInicio, msFin);
            const eventosDb = await ReservorioModel.consultarEventos(msInicio, msFin);

            console.log(`[AUDITORIAS] Reservorio devolvió ${puntosDb.length} puntos y ${eventosDb.length} eventos para la ruta.`);

            // VIGÍA DEPURADOR - INICIO
            const debugLog = {
                paso1_parametros: {
                    id_ruta: id_ruta,
                    busqueda: 'Time-Bounding (Agnóstico a Chofer)',
                    ventana_busqueda_ms: { inicio: msInicio, fin: msFin },
                    ventana_busqueda_iso: { inicio: new Date(msInicio).toISOString(), fin: new Date(msFin).toISOString() },
                    tolerancia_nodos_metros: 500,
                    tolerancia_clientes_metros: 50
                },
                paso2_nodos: [],
                paso3_trazabilidad: {
                    puntos_encontrados_en_reservorio: puntosDb.length,
                    eventos_encontrados_en_reservorio: eventosDb.length,
                    segmentos: []
                },
                paso4_misses: []
            };
            // VIGÍA DEPURADOR - FIN

            // ==========================================
            // TICKET #069: FASE 3 (Conciliación Semántica)
            // ==========================================
            let tramosExtraidos = [];
            
            if (eventosDb.length > 0) {
                console.log(`[FASE 3] Iniciando conciliación semántica con ${eventosDb.length} eventos.`);
                const paradasSemanticas = eventosDb.filter(e => e.tipo === 'PARADA');
                const trasladosSemanticos = eventosDb.filter(e => e.tipo === 'TRASLADO');
                
                let cursorTimestamp = msInicio;

                // 1. NODO_CERO (Depósito)
                if (nodoInicio) {
                    const depositVisits = paradasSemanticas.filter(p => GoogleTimelineParser.calcularDistanciaMetros(nodoInicio.latitud, nodoInicio.longitud, p.lat, p.lng) <= 500);
                    
                    let primerClienteEvt = null;
                    if (paradas.length > 0) {
                        const primerCliente = paradas[0];
                        primerClienteEvt = paradasSemanticas.find(p => GoogleTimelineParser.calcularDistanciaMetros(primerCliente.latitud, primerCliente.longitud, p.lat, p.lng) <= 150);
                    }

                    let depositoEvt = null;
                    if (primerClienteEvt) {
                        // VALLA TEMPORAL: Buscar la última visita al depósito que terminó ANTES de llegar al primer cliente
                        const depositVisitsAntesCliente = depositVisits.filter(p => p.fin <= primerClienteEvt.inicio);
                        if (depositVisitsAntesCliente.length > 0) {
                            depositoEvt = depositVisitsAntesCliente[depositVisitsAntesCliente.length - 1]; // El último cronológicamente (más cercano al cliente)
                        } else if (depositVisits.length > 0) {
                            depositoEvt = depositVisits[depositVisits.length - 1]; // Fallback al último
                        }
                    } else if (depositVisits.length > 0) {
                        depositoEvt = depositVisits[0];
                    }

                    if (depositoEvt) {
                        cursorTimestamp = depositoEvt.fin;
                        tramosExtraidos.push({
                            tipo_tramo: 'NODO_CERO',
                            nombre_ref: nodoInicio.nombre,
                            id_presupuesto: null,
                            tiempo_duracion_minutos: Math.max(1, Math.round((depositoEvt.fin - depositoEvt.inicio) / 60000)),
                            coordenada_real_lat: depositoEvt.lat,
                            coordenada_real_lng: depositoEvt.lng,
                            distancia_geocerca_metros: Math.round(GoogleTimelineParser.calcularDistanciaMetros(nodoInicio.latitud, nodoInicio.longitud, depositoEvt.lat, depositoEvt.lng)),
                            hora_inicio: depositoEvt.inicio,
                            hora_fin: depositoEvt.fin,
                            metodo_conciliacion: 'Semántico (visit - Lookup Back)'
                        });
                    }
                }

                // 2. PARADAS (Clientes)
                for (let i = 0; i < paradas.length; i++) {
                    const cliente = paradas[i];
                    // Buscar PARADA semántica posterior al cursor
                    let clienteEvt = paradasSemanticas.find(p => p.inicio >= cursorTimestamp && GoogleTimelineParser.calcularDistanciaMetros(cliente.latitud, cliente.longitud, p.lat, p.lng) <= 150);
                    
                    if (clienteEvt) {
                        clienteEvt.metodo_conciliacion = 'Semántico (visit)';
                    } else {
                        // TICKET #077: Nivel 2 (Anclaje Heurístico)
                        if (cliente.fecha_entrega_real) {
                            const tsEntrega = new Date(cliente.fecha_entrega_real).getTime();
                            if (tsEntrega >= msInicio && tsEntrega <= msFin) {
                                // Ventana de +/- 1 hr (3,600,000 ms)
                                const pVentana = puntosDb.filter(p => p.timestamp >= (tsEntrega - 3600000) && p.timestamp <= (tsEntrega + 3600000));
                                const pCerca = pVentana.filter(p => GoogleTimelineParser.calcularDistanciaMetros(cliente.latitud, cliente.longitud, p.lat, p.lng) <= 150);
                                if (pCerca.length > 0) {
                                    clienteEvt = {
                                        inicio: pCerca[0].timestamp,
                                        fin: pCerca[pCerca.length - 1].timestamp,
                                        lat: pCerca[Math.floor(pCerca.length / 2)].lat,
                                        lng: pCerca[Math.floor(pCerca.length / 2)].lng,
                                        metodo_conciliacion: 'Heurístico (Timestamp App)'
                                    };
                                }
                            }
                        }
                    }

                    if (!clienteEvt) {
                        // TICKET #077: Nivel 3 (Clustering Geofísico - Búsqueda Ciega)
                        const pPosteriores = puntosDb.filter(p => p.timestamp >= cursorTimestamp);
                        let inicioGeofisico = null;
                        let finGeofisico = null;
                        let puntosGeofisicos = [];

                        for (const p of pPosteriores) {
                            const d = GoogleTimelineParser.calcularDistanciaMetros(cliente.latitud, cliente.longitud, p.lat, p.lng);
                            if (d <= 50) { // Radio ampliado a 50 metros
                                if (!inicioGeofisico) inicioGeofisico = p.timestamp;
                                finGeofisico = p.timestamp;
                                puntosGeofisicos.push(p);
                            } else if (inicioGeofisico && (p.timestamp - finGeofisico > 60000)) {
                                // Cortar el cluster si sale y no vuelve en 1 minuto
                                break;
                            }
                        }

                        if (inicioGeofisico && finGeofisico && (finGeofisico - inicioGeofisico >= 120000)) { // Delta T > 2 min
                            clienteEvt = {
                                inicio: inicioGeofisico,
                                fin: finGeofisico,
                                lat: puntosGeofisicos[Math.floor(puntosGeofisicos.length / 2)].lat,
                                lng: puntosGeofisicos[Math.floor(puntosGeofisicos.length / 2)].lng,
                                metodo_conciliacion: 'Calculado (Geofísico)'
                            };
                        }
                    }

                    if (!clienteEvt) {
                        // TICKET #077: Nivel 4 (Rastreo Geográfico Total - Prioridad Coordenada sobre Tiempo)
                        let inicioTotal = null;
                        let finTotal = null;
                        let puntosTotal = [];

                        for (const p of puntosDb) {
                            const d = GoogleTimelineParser.calcularDistanciaMetros(cliente.latitud, cliente.longitud, p.lat, p.lng);
                            if (d <= 100) {
                                if (!inicioTotal) inicioTotal = p.timestamp;
                                finTotal = p.timestamp;
                                puntosTotal.push(p);
                            } else if (inicioTotal && (p.timestamp - finTotal > 60000)) {
                                break;
                            }
                        }

                        if (puntosTotal.length > 0) {
                            clienteEvt = {
                                inicio: inicioTotal,
                                fin: finTotal,
                                lat: puntosTotal[Math.floor(puntosTotal.length / 2)].lat,
                                lng: puntosTotal[Math.floor(puntosTotal.length / 2)].lng,
                                metodo_conciliacion: 'Calculado (Geofísico Total)'
                            };
                            
                            debugLog.paso4_misses.push({
                                cliente: cliente.cliente_nombre,
                                estado: 'Forzado Nivel 4',
                                razon_miss_nivel3: `Delta T era ${Math.round((finTotal - inicioTotal)/1000)}s (menor a 120s) o Radio era mayor a 50m`,
                                puntos_radio_100m: puntosTotal.length,
                                inicio: GoogleTimelineParser.formatearFecha(new Date(inicioTotal)),
                                fin: GoogleTimelineParser.formatearFecha(new Date(finTotal))
                            });
                        } else {
                            debugLog.paso4_misses.push({
                                cliente: cliente.cliente_nombre,
                                estado: 'MISS DEFINITIVO',
                                razon: '0 puntos en radio de 100m en todo el día'
                            });
                        }
                    }

                    if (clienteEvt) {
                        const trasladoEvt = trasladosSemanticos.find(t => t.inicio >= cursorTimestamp && t.fin <= clienteEvt.inicio + 60000);
                        const inicioTraslado = trasladoEvt ? trasladoEvt.inicio : cursorTimestamp;
                        const finTraslado = trasladoEvt ? trasladoEvt.fin : clienteEvt.inicio;
                        
                        let puntosEmpiricosTramo = puntosDb.filter(p => p.timestamp >= inicioTraslado && p.timestamp <= finTraslado);

                        // TICKET #078: Cierre Geométrico del Tramo Inicial
                        if (i === 0 && nodoInicio) {
                            const puntosPrevios = puntosDb.filter(p => p.timestamp < inicioTraslado).reverse();
                            let puntosSuavizado = [];
                            for (const pp of puntosPrevios) {
                                const d = GoogleTimelineParser.calcularDistanciaMetros(nodoInicio.latitud, nodoInicio.longitud, pp.lat, pp.lng);
                                if (d <= 200) {
                                    puntosSuavizado.unshift(pp);
                                } else if (puntosSuavizado.length > 0) {
                                    break;
                                }
                            }
                            
                            const anclajeDeposito = {
                                timestamp: inicioTraslado - 1,
                                lat: parseFloat(nodoInicio.latitud),
                                lng: parseFloat(nodoInicio.longitud),
                                isForzado: true
                            };
                            
                            puntosEmpiricosTramo = [anclajeDeposito, ...puntosSuavizado, ...puntosEmpiricosTramo];
                        }

                        tramosExtraidos.push({
                            tipo_tramo: 'TRASLADO',
                            nombre_ref: `Hacia ${cliente.cliente_nombre}`,
                            id_presupuesto: null,
                            tiempo_duracion_minutos: Math.max(1, Math.round((finTraslado - inicioTraslado) / 60000)),
                            coordenada_real_lat: null,
                            coordenada_real_lng: null,
                            distancia_geocerca_metros: 0,
                            hora_inicio: inicioTraslado,
                            hora_fin: finTraslado,
                            metodo_conciliacion: 'Híbrido (Anclaje Semántico + Trazas Crudas)',
                            trace_empirico: puntosEmpiricosTramo
                        });

                        tramosExtraidos.push({
                            tipo_tramo: 'GESTION_CLIENTE',
                            nombre_ref: cliente.cliente_nombre,
                            id_presupuesto: cliente.id,
                            tiempo_duracion_minutos: Math.max(1, Math.round((clienteEvt.fin - clienteEvt.inicio) / 60000)),
                            coordenada_real_lat: clienteEvt.lat,
                            coordenada_real_lng: clienteEvt.lng,
                            distancia_geocerca_metros: Math.round(GoogleTimelineParser.calcularDistanciaMetros(cliente.latitud, cliente.longitud, clienteEvt.lat, clienteEvt.lng)),
                            hora_inicio: clienteEvt.inicio,
                            hora_fin: clienteEvt.fin,
                            metodo_conciliacion: clienteEvt.metodo_conciliacion || 'Semántico (visit)'
                        });
                        cursorTimestamp = clienteEvt.fin;
                    } else {
                        console.log(`[FASE 3] Cliente no detectado en ningún nivel: ${cliente.cliente_nombre}`);
                    }
                }

                // 3. NODO_FIN (Casa)
                if (nodoFin) {
                    const finEvt = paradasSemanticas.find(p => p.inicio >= cursorTimestamp && GoogleTimelineParser.calcularDistanciaMetros(nodoFin.latitud, nodoFin.longitud, p.lat, p.lng) <= 500);
                    if (finEvt) {
                        const trasladoEvt = trasladosSemanticos.find(t => t.inicio >= cursorTimestamp && t.fin <= finEvt.inicio + 60000);
                        const inicioTraslado = trasladoEvt ? trasladoEvt.inicio : cursorTimestamp;
                        const finTraslado = trasladoEvt ? trasladoEvt.fin : finEvt.inicio;
                        
                        tramosExtraidos.push({
                            tipo_tramo: 'TRASLADO',
                            nombre_ref: 'Retorno a Base',
                            id_presupuesto: null,
                            tiempo_duracion_minutos: Math.max(1, Math.round((finTraslado - inicioTraslado) / 60000)),
                            coordenada_real_lat: null,
                            coordenada_real_lng: null,
                            distancia_geocerca_metros: 0,
                            hora_inicio: inicioTraslado,
                            hora_fin: finTraslado,
                            metodo_conciliacion: 'Híbrido (Anclaje Semántico + Trazas Crudas)',
                            trace_empirico: puntosDb.filter(p => p.timestamp >= inicioTraslado && p.timestamp <= finTraslado) // PASO B: Puntos Crudos Saneados
                        });

                        tramosExtraidos.push({
                            tipo_tramo: 'NODO_FIN',
                            nombre_ref: nodoFin.nombre,
                            id_presupuesto: null,
                            tiempo_duracion_minutos: Math.max(1, Math.round((finEvt.fin - finEvt.inicio) / 60000)),
                            coordenada_real_lat: finEvt.lat,
                            coordenada_real_lng: finEvt.lng,
                            distancia_geocerca_metros: Math.round(GoogleTimelineParser.calcularDistanciaMetros(nodoFin.latitud, nodoFin.longitud, finEvt.lat, finEvt.lng)),
                            hora_inicio: finEvt.inicio,
                            hora_fin: finEvt.fin,
                            metodo_conciliacion: 'Semántico (visit)'
                        });
                    }
                }
                
                debugLog.paso3_trazabilidad.segmentos.push({
                    tipo: 'CONCILIACION_SEMANTICA',
                    eventos_usados: eventosDb.length
                });

            } else {
                console.log(`[FASE 2] Fallback a Fase 2 - No hay eventos semánticos.`);
                // ==========================================
                // TICKET #066: FASE 2 (Densidad Total y Anclaje Empírico) - FALLBACK
                // ==========================================
                if (puntosDb.length === 0) {
                    console.log('[FASE 2] Reservorio vacío. Abortando aislamiento.');
                    return res.json({ success: true, tramos: [], debug: debugLog });
                }

                let primerClienteEntrada = null;
                if (paradas.length > 0) {
                    const primerCliente = paradas[0];
                    for (let j = 0; j < puntosDb.length; j++) {
                        const d = GoogleTimelineParser.calcularDistanciaMetros(primerCliente.latitud, primerCliente.longitud, puntosDb[j].lat, puntosDb[j].lng);
                        if (d <= 150) { 
                            primerClienteEntrada = puntosDb[j];
                            break;
                        }
                    }
                }

                let cursorTimestamp = puntosDb[0].timestamp;
                let msTopeRetrospectiva = primerClienteEntrada ? primerClienteEntrada.timestamp : puntosDb[puntosDb.length-1].timestamp;

                let salidaDeposito = null;
                if (nodoInicio) {
                    const puntosPrevios = puntosDb.filter(p => p.timestamp <= msTopeRetrospectiva).reverse();
                    for (const pdb of puntosPrevios) {
                        const d = GoogleTimelineParser.calcularDistanciaMetros(nodoInicio.latitud, nodoInicio.longitud, pdb.lat, pdb.lng);
                        if (d <= 500) {
                            salidaDeposito = pdb;
                            break;
                        }
                    }
                    
                    if (salidaDeposito) {
                        cursorTimestamp = salidaDeposito.timestamp;
                        tramosExtraidos.push({
                            tipo_tramo: 'NODO_CERO',
                            nombre_ref: nodoInicio.nombre,
                            id_presupuesto: null,
                            tiempo_duracion_minutos: 1,
                            coordenada_real_lat: salidaDeposito.lat,
                            coordenada_real_lng: salidaDeposito.lng,
                            distancia_geocerca_metros: Math.round(GoogleTimelineParser.calcularDistanciaMetros(nodoInicio.latitud, nodoInicio.longitud, salidaDeposito.lat, salidaDeposito.lng)),
                            hora_inicio: salidaDeposito.timestamp - 60000,
                            hora_fin: salidaDeposito.timestamp,
                            metodo_conciliacion: 'Empírico (Lookup Back)'
                        });
                    }
                }

                for (let i = 0; i < paradas.length; i++) {
                    const cliente = paradas[i];
                    let entradaCliente = null;
                    let salidaCliente = null;
                    
                    let ultimoPuntoAdentro = null;
                    for (let j = 0; j < puntosDb.length; j++) {
                        if (puntosDb[j].timestamp < cursorTimestamp) continue;
                        
                        const d = GoogleTimelineParser.calcularDistanciaMetros(cliente.latitud, cliente.longitud, puntosDb[j].lat, puntosDb[j].lng);
                        if (d <= 150) { 
                            if (!entradaCliente) {
                                entradaCliente = puntosDb[j];
                            } else if (ultimoPuntoAdentro && (puntosDb[j].timestamp - ultimoPuntoAdentro.timestamp > 60 * 60000)) {
                                break;
                            }
                            salidaCliente = puntosDb[j];
                            ultimoPuntoAdentro = puntosDb[j];
                        } else if (entradaCliente && ultimoPuntoAdentro) {
                            if (puntosDb[j].timestamp - ultimoPuntoAdentro.timestamp > 30 * 60000) {
                                break;
                            }
                        }
                    }
                    
                    if (entradaCliente && salidaCliente) {
                        const puntosTraslado = puntosDb.filter(p => p.timestamp >= cursorTimestamp && p.timestamp <= entradaCliente.timestamp);
                        
                        // TICKET #078: Cierre Geométrico del Tramo Inicial (Fase 2)
                        if (i === 0 && nodoInicio) {
                            const anclajeDeposito = {
                                timestamp: cursorTimestamp - 1,
                                lat: parseFloat(nodoInicio.latitud),
                                lng: parseFloat(nodoInicio.longitud),
                                isForzado: true
                            };
                            puntosTraslado.unshift(anclajeDeposito);
                        }

                        if (puntosTraslado.length > 0) {
                            tramosExtraidos.push({
                                tipo_tramo: 'TRASLADO',
                                nombre_ref: `Hacia ${cliente.cliente_nombre}`,
                                id_presupuesto: null,
                                tiempo_duracion_minutos: Math.round((entradaCliente.timestamp - cursorTimestamp) / 60000) || 1,
                                coordenada_real_lat: null,
                                coordenada_real_lng: null,
                                distancia_geocerca_metros: 0,
                                hora_inicio: cursorTimestamp,
                                hora_fin: entradaCliente.timestamp,
                                metodo_conciliacion: 'Densidad Total',
                                trace_empirico: puntosTraslado
                            });
                        }
                        
                        const permanencia = Math.max(1, Math.round((salidaCliente.timestamp - entradaCliente.timestamp) / 60000));
                        tramosExtraidos.push({
                            tipo_tramo: 'GESTION_CLIENTE',
                            nombre_ref: cliente.cliente_nombre,
                            id_presupuesto: cliente.id,
                            tiempo_duracion_minutos: permanencia,
                            coordenada_real_lat: entradaCliente.lat,
                            coordenada_real_lng: entradaCliente.lng,
                            distancia_geocerca_metros: Math.round(GoogleTimelineParser.calcularDistanciaMetros(cliente.latitud, cliente.longitud, entradaCliente.lat, entradaCliente.lng)),
                            hora_inicio: entradaCliente.timestamp,
                            hora_fin: salidaCliente.timestamp,
                            metodo_conciliacion: 'Empírico (Entrada/Salida)'
                        });
                        
                        cursorTimestamp = salidaCliente.timestamp;
                    } else {
                        console.log(`[FASE 2] Cliente no detectado empíricamente: ${cliente.cliente_nombre}`);
                    }
                }

                if (nodoFin) {
                    let llegadaFin = null;
                    for (let j = 0; j < puntosDb.length; j++) {
                        if (puntosDb[j].timestamp < cursorTimestamp) continue;
                        const d = GoogleTimelineParser.calcularDistanciaMetros(nodoFin.latitud, nodoFin.longitud, puntosDb[j].lat, puntosDb[j].lng);
                        if (d <= 500) {
                            llegadaFin = puntosDb[j];
                            break;
                        }
                    }
                    
                    if (llegadaFin) {
                        const puntosRetorno = puntosDb.filter(p => p.timestamp >= cursorTimestamp && p.timestamp <= llegadaFin.timestamp);
                        if (puntosRetorno.length > 0) {
                            tramosExtraidos.push({
                                tipo_tramo: 'TRASLADO',
                                nombre_ref: 'Retorno a Base',
                                id_presupuesto: null,
                                tiempo_duracion_minutos: Math.round((llegadaFin.timestamp - cursorTimestamp) / 60000) || 1,
                                coordenada_real_lat: null,
                                coordenada_real_lng: null,
                                distancia_geocerca_metros: 0,
                                hora_inicio: cursorTimestamp,
                                hora_fin: llegadaFin.timestamp,
                                metodo_conciliacion: 'Densidad Total',
                                trace_empirico: puntosRetorno
                            });
                        }
                        
                        tramosExtraidos.push({
                            tipo_tramo: 'NODO_FIN',
                            nombre_ref: nodoFin.nombre,
                            id_presupuesto: null,
                            tiempo_duracion_minutos: 1,
                            coordenada_real_lat: llegadaFin.lat,
                            coordenada_real_lng: llegadaFin.lng,
                            distancia_geocerca_metros: Math.round(GoogleTimelineParser.calcularDistanciaMetros(nodoFin.latitud, nodoFin.longitud, llegadaFin.lat, llegadaFin.lng)),
                            hora_inicio: llegadaFin.timestamp,
                            hora_fin: llegadaFin.timestamp + 60000,
                            metodo_conciliacion: 'Empírico (Llegada)'
                        });
                    }
                }

                debugLog.paso3_trazabilidad.segmentos.push({
                    tipo: 'TRASLADO_UNIFICADO',
                    puntos_intermedios_usados: puntosDb.length
                });
            }

            // Ordenar cronológicamente
            tramosExtraidos.sort((a, b) => a.hora_inicio - b.hora_inicio);

            const distanciaTotalMetros = tramosExtraidos.reduce((acc, t) => acc + (t.distancia_geocerca_metros || 0), 0);

            const resultado = {
                tramos: tramosExtraidos,
                tiempo_real_minutos: tramosExtraidos.reduce((acc, t) => acc + (t.tiempo_duracion_minutos || 0), 0),
                distancia_real_km: parseFloat((distanciaTotalMetros / 1000).toFixed(2))
            };

            // 4. Calcular desviación teórica
            const duracionDeclarada = ruta.duracion_neta_minutos || 0;
            const duracionReal = resultado.tiempo_real_minutos;
            let desviacion = 0;
            if (duracionDeclarada > 0) {
                desviacion = parseFloat((((duracionReal - duracionDeclarada) / duracionDeclarada) * 100).toFixed(2));
            }

            resultado.desviacion_global_porcentaje = desviacion;
            resultado.id_ruta = id_ruta;
            resultado.estado = 'PREVIEW'; // Solo en memoria
            resultado.ruta_teorica = ruta;
            resultado.vigia_depurador = debugLog; // Exponer Vigía

            return res.json({ success: true, data: resultado });

        } catch (error) {
            console.error('[AUDITORIAS] ❌ Error en pre-procesamiento:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Guardar de manera atómica una auditoría ya revisada por el humano.
     */
    static async guardarAuditoria(req, res) {
        try {
            console.log('[AUDITORIAS] Guardando auditoría consolidada');
            
            const auditoriaData = req.body;
            
            if (!auditoriaData || !auditoriaData.id_ruta || !auditoriaData.tramos) {
                return res.status(400).json({ success: false, error: 'Estructura de auditoría inválida o incompleta.' });
            }

            // En un futuro se extrae el auditor del JWT. Por ahora quemado o enviado desde frontend.
            auditoriaData.usuario_auditor = req.user?.usuario || 'Auditor Central';

            const result = await AuditoriasModel.guardar(auditoriaData);

            return res.json({ success: true, message: 'Auditoría guardada exitosamente.', id_auditoria: result.id_auditoria });
        } catch (error) {
            console.error('[AUDITORIAS] ❌ Error al guardar:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Listar auditorías (Historial)
     */
    static async listarAuditorias(req, res) {
        try {
            const lista = await AuditoriasModel.obtenerTodas();
            return res.json({ success: true, data: lista });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Ver Detalle Completo Auditoria
     */
    static async detalleAuditoria(req, res) {
        try {
            const { id } = req.params;
            const auditoria = await AuditoriasModel.obtenerPorId(id);
            if(!auditoria) return res.status(404).json({ success: false, error: 'No encontrada' });
            return res.json({ success: true, data: auditoria });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Eliminar una auditoría histórica y liberar la hoja de ruta
     */
    static async eliminarAuditoria(req, res) {
        try {
            const id_auditoria = req.params.id;
            const eliminado = await AuditoriasModel.eliminar(id_auditoria);
            
            if (!eliminado) {
                return res.status(404).json({ success: false, error: 'Auditoría no encontrada o ya eliminada.' });
            }

            return res.json({ success: true, message: 'Auditoría eliminada con éxito.' });
        } catch (error) {
            console.error('[AUDITORIAS] ❌ Error al eliminar auditoría:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    // =====================================
    // CRUD PUNTOS BASE
    // =====================================
    static async listarPuntosBase(req, res) {
        try {
            const data = await PuntosBaseModel.obtenerTodos();
            return res.json({ success: true, data });
        } catch(e) { return res.status(500).json({ success: false, error: e.message }); }
    }

    static async crearPuntoBase(req, res) {
        try {
            const data = await PuntosBaseModel.crear(req.body);
            return res.json({ success: true, data });
        } catch(e) { return res.status(500).json({ success: false, error: e.message }); }
    }
}

module.exports = AuditoriasController;
