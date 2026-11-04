const axios = require('axios');
const iaMonitor = require('../../services/iaCreditoMonitorService');

const API_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// JSON Schema para la respuesta estructurada de un lote
const responseSchema = {
    type: "OBJECT",
    properties: {
        movimientos: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    indice_original: { type: "INTEGER", description: "El índice (0-based) de la transacción recibida en el array de entrada." },
                    tipo_operacion: { 
                        type: "STRING", 
                        enum: ["Transferencia", "Depósito", "Impuestos", "Gasto Comisión", "Pago Cliente", "Pago Proveedor", "Otros"],
                        description: "Naturaleza clasificada de la transacción." 
                    },
                    cuit_extraido: { 
                        type: "STRING", 
                        description: "Número de CUIT o CUIL de 11 dígitos numéricos limpios (sin guiones o espacios) detectado en el concepto. Si no hay ninguno, retornar null." 
                    },
                    ref_operacion: { 
                        type: "STRING", 
                        description: "Identificador de Coelsa, número de cheque, número de transferencia o ID de transacción bancaria. Si no hay ninguno, retornar null." 
                    },
                    nombre_entidad: { 
                        type: "STRING", 
                        description: "Nombre del tercero (persona física o jurídica, ej: 'JUAN PEREZ' o 'MERCADOPAGO') involucrado en la transacción. Si es imposible de determinar, retornar null." 
                    },
                    confianza: {
                        type: "NUMBER",
                        description: "Puntuación de confianza de clasificación de 0.0 a 1.0."
                    }
                },
                required: ["indice_original", "tipo_operacion"]
            }
        }
    },
    required: ["movimientos"]
};

/**
 * Clasifica y extrae metadatos de un sub-lote de movimientos bancarios usando Gemini
 * @param {Array} subLote - Array de objetos conteniendo { concepto, debito, credito }
 * @returns {Promise<Array>} Array de resultados clasificados y tokenizados
 */
async function procesarSubLoteConGemini(subLote) {
    const cred = iaMonitor.leerCredencialesGeminiEnCaliente();
    const apiKey = cred.apiKey;
    const modelActivo = cred.model || API_MODEL;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY no configurada en las variables de entorno.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelActivo}:generateContent?key=${apiKey}`;

    // Construir el prompt con el sub-lote
    const promptText = `
Analiza las siguientes transacciones bancarias crudas extraídas del Home Banking. Tu tarea consiste en clasificar cada una de ellas y extraer los metadatos estructurados (CUIT/CUIL de 11 dígitos, referencia u ID de operación y nombre de la entidad o persona tercera).

Instrucciones de clasificación:
- "Pago Cliente": Transferencias recibidas de clientes, cobros de pasarelas como MercadoPago, MODO, Posnet o depósitos de clientes.
- "Pago Proveedor": Pagos realizados por servicios, compras de mercadería, pago a proveedores de stock.
- "Impuesto": Cargos de AFIP, ARBA, Ingresos Brutos, IVA, tasas municipales, Sircreb, retenciones o percepciones de impuestos.
- "Gasto Comisión": Comisiones bancarias, cargos por mantenimiento de cuenta, IVA sobre comisiones, gastos de chequeras.
- "Rendimiento": Intereses ganados por plazos fijos, fondos comunes de inversión o rendimiento de saldos.
- "Otros": Cualquier operación que no califique en los anteriores (ej: transferencias propias entre cuentas de la empresa).

Instrucciones de extracción:
- Extrae el CUIT o CUIL (11 dígitos numéricos continuos sin guiones ni espacios) de la contraparte si está explícito en la descripción.
- Aisla el número de transferencia, ID de Coelsa, número de cheque u otro ID único en "ref_operacion".
- Identifica el nombre de la empresa o persona tercera involucrada en "nombre_entidad" (ej: "DISTRIBUIDORA SUR", "JUAN PEREZ"). Limpia términos de la pasarela si es posible.

Transacciones a procesar en formato JSON (usa "indice_original" para mapear cada fila en el mismo orden de entrada):
${JSON.stringify(subLote, null, 2)}
`;

    const generationConfig = {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.1
    };
    if (API_MODEL.includes('2.5')) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const payload = {
        contents: [{
            parts: [{
                text: promptText
            }]
        }],
        generationConfig
    };

    console.log(`🤖 [GEMINI-SERVICE] Enviando sub-lote de ${subLote.length} transacciones al modelo ${modelActivo}...`);
    
    let response;
    try {
        response = await axios.post(url, payload, { timeout: 14000 });
        iaMonitor.registrarEventoIaSistema({
            modulo: 'CUENTAS_BANCARIAS',
            detalle: `Conciliación extracto (${subLote.length} movs)`,
            rawResponseData: response.data,
            modelo: modelActivo
        });
    } catch (err) {
        iaMonitor.registrarEventoIaSistema({
            modulo: 'CUENTAS_BANCARIAS',
            detalle: `Error conciliación (${subLote.length} movs)`,
            modelo: modelActivo,
            errorMsg: err.response?.data?.error?.message || err.message
        });
        throw err;
    }
    
    if (!response.data || !response.data.candidates || !response.data.candidates[0].content) {
        throw new Error('Respuesta inválida o vacía de la API de Gemini.');
    }
    
    const textResponse = response.data.candidates[0].content.parts[0].text;
    const parsedData = JSON.parse(textResponse);
    
    return parsedData.movimientos || [];
}

/**
 * Procesa la ingesta de movimientos bancarios dividiéndola en sub-lotes rápidos en paralelo
 * @param {Array} movimientos - Lista de movimientos bancarios NUEVOS y ambiguos pre-filtrados del Excel
 * @returns {Promise<Array>} Lista total consolidada con clasificaciones y metadatos
 */
async function clasificarMovimientosBancarios(movimientos) {
    if (!movimientos || movimientos.length === 0) return [];
    const CHUNK_SIZE = 40;
    const MAX_CONCURRENCY = 3;
    const resultadosConsolidados = new Array(movimientos.length);
    
    // Preparar los datos simplificados para enviar al prompt (para ahorrar tokens)
    const inputsSimplificados = movimientos.map((m, idx) => ({
        indice_original: idx,
        concepto: m.concepto,
        debito: m.debito,
        credito: m.credito
    }));
    
    const chunks = [];
    for (let i = 0; i < inputsSimplificados.length; i += CHUNK_SIZE) {
        chunks.push({ startIndex: i, subLote: inputsSimplificados.slice(i, i + CHUNK_SIZE) });
    }

    console.log(`🤖 [GEMINI-SERVICE] Clasificando ${movimientos.length} movimientos nuevos en ${chunks.length} sub-lote(s) de hasta ${CHUNK_SIZE}...`);
    
    for (let c = 0; c < chunks.length; c += MAX_CONCURRENCY) {
        const batch = chunks.slice(c, c + MAX_CONCURRENCY);
        await Promise.all(batch.map(async ({ startIndex, subLote }) => {
            try {
                const resultadosSubLote = await procesarSubLoteConGemini(subLote);
                resultadosSubLote.forEach(res => {
                    const idx = res.indice_original;
                    if (idx !== undefined && idx >= 0 && idx < movimientos.length) {
                        resultadosConsolidados[idx] = {
                            tipo_operacion: res.tipo_operacion,
                            cuit_extraido: res.cuit_extraido ? String(res.cuit_extraido).replace(/\D/g, '') : null,
                            referencia_operacion: res.ref_operacion ? String(res.ref_operacion).trim() : null,
                            nombre_entidad: res.nombre_entidad ? String(res.nombre_entidad).trim().toUpperCase() : null,
                            estado_clasificacion: (res.confianza !== undefined && res.confianza < 0.7) ? 'IA_DUDOSO' : 'IA_COMPLETO',
                            metadata_adicional: {
                                confianza_ia: res.confianza || 1.0,
                                nombre_entidad_ia: res.nombre_entidad || null
                            }
                        };
                    }
                });
            } catch (error) {
                console.error(`❌ [GEMINI-SERVICE] Fallo en el sub-lote iniciando en índice ${startIndex}:`, error.message);
            }
        }));
    }
    
    // Rellenar con fallback heurístico o valores por defecto para cualquier fila que haya fallado o no haya sido devuelta por el LLM
    for (let idx = 0; idx < movimientos.length; idx++) {
        if (!resultadosConsolidados[idx]) {
            resultadosConsolidados[idx] = {
                tipo_operacion: null, // Indicará que requiere fallback
                cuit_extraido: null,
                referencia_operacion: null,
                nombre_entidad: null,
                estado_clasificacion: 'AUTO',
                metadata_adicional: null
            };
        }
    }
    
    return resultadosConsolidados;
}

/**
 * Verifica el estado y conectividad del servicio Gemini
 */
async function verificarSaludIA() {
    const cred = iaMonitor.leerCredencialesGeminiEnCaliente();
    const apiKey = cred.apiKey;
    const modelActivo = cred.model || API_MODEL;
    if (!apiKey) {
        return { activa: false, razon: 'SIN_API_KEY', modelo: modelActivo };
    }
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelActivo}:generateContent?key=${apiKey}`;
        const payload = { contents: [{ parts: [{ text: "ping" }] }] };
        const res = await axios.post(url, payload, { timeout: 7000 });
        if (res.status === 200) {
            iaMonitor.registrarEventoIaSistema({
                modulo: 'CUENTAS_BANCARIAS',
                detalle: 'Verificación de estado en caliente (Ping)',
                rawResponseData: res.data,
                modelo: modelActivo
            });
            return { activa: true, modelo: modelActivo };
        }
        return { activa: false, razon: 'RESPUESTA_INVALIDA', modelo: modelActivo };
    } catch (err) {
        const msg = err.response && err.response.data && err.response.data.error ? err.response.data.error.message : err.message;
        iaMonitor.registrarEventoIaSistema({
            modulo: 'CUENTAS_BANCARIAS',
            detalle: 'Fallo en verificación de estado',
            modelo: modelActivo,
            errorMsg: msg
        });
        return { activa: false, razon: msg, modelo: modelActivo };
    }
}

module.exports = {
    clasificarMovimientosBancarios,
    verificarSaludIA
};
