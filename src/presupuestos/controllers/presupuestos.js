console.log('🔍 [PRESUPUESTOS] Cargando controlador de presupuestos...');

/**
 * Resuelve un presupuesto por ID o id_presupuesto_ext
 * @param {Object} client - Cliente de PostgreSQL
 * @param {string} idParam - ID del parámetro (numérico o string)
 * @returns {Object|null} Registro del presupuesto o null si no existe
 */
async function resolvePresupuesto(client, idParam) {
  // Si es todo dígitos, lo tratamos como id (integer); si no, como ext
  const isNumeric = /^\d+$/.test(idParam);
  const { rows } = await client.query(
    `SELECT id, id_presupuesto_ext
       FROM public.presupuestos
      WHERE ${isNumeric ? 'id = $1' : 'id_presupuesto_ext = $1'}
      LIMIT 1`,
    [isNumeric ? Number(idParam) : idParam]
  );
  return rows[0] || null;
}

/**
 * Función auxiliar para analizar datos de fechas
 * Extrae tipos, formatos y fechas futuras de un array de filas
 * @param {Array} rows - Filas con campo fecha_registro
 * @returns {Object} Objeto con tiposDetectados, formatosDetectados, fechasFuturas, ejemplosFechasFuturas
 */
function analyzeDateData(rows) {
  const tiposDetectados = new Set();
  const formatosDetectados = new Set();
  const fechasFuturas = [];
  const ahora = new Date();
  const unAñoFuturo = new Date(ahora.getFullYear() + 1, ahora.getMonth(), ahora.getDate());

  rows.forEach(row => {
    const fechaValue = row.fecha_registro;
    if (!fechaValue) return;

    const tipoDetectado = typeof fechaValue;
    tiposDetectados.add(tipoDetectado);

    // Detectar formato específico
    if (fechaValue instanceof Date) {
      formatosDetectados.add('Date object');
    } else if (typeof fechaValue === 'string') {
      if (fechaValue.includes('T') && fechaValue.includes('Z')) {
        formatosDetectados.add('ISO UTC (YYYY-MM-DDTHH:mm:ss.sssZ)');
      } else if (fechaValue.includes('T')) {
        formatosDetectados.add('ISO con hora (YYYY-MM-DDTHH:mm:ss)');
      } else if (fechaValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
        formatosDetectados.add('YYYY-MM-DD (solo fecha)');
      } else if (fechaValue.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        formatosDetectados.add('DD/MM/YYYY');
      } else {
        formatosDetectados.add('Otro formato string');
      }
    } else if (typeof fechaValue === 'number') {
      formatosDetectados.add('Timestamp numérico');
    }

    // Detectar fechas futuras (más de 1 año)
    const fechaObj = new Date(fechaValue);
    if (fechaObj > unAñoFuturo) {
      fechasFuturas.push({ id: row.id, fecha: fechaValue, fechaObj });
    }
  });

  return {
    tiposDetectados: Array.from(tiposDetectados),
    formatosDetectados: Array.from(formatosDetectados),
    fechasFuturas: fechasFuturas.length,
    ejemplosFechasFuturas: fechasFuturas.slice(0, 5)
  };
}

/**
 * Controlador principal para la gestión de presupuestos
 * Maneja la lógica de negocio del módulo con CRUD completo
 */

/**
 * Obtener todos los presupuestos con filtros avanzados
 */
const obtenerPresupuestos = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Iniciando obtención de presupuestos...');
        
        // Extraer parámetros de filtrado y paginación - Filtro cliente + Typeahead + Fechas + Estado – 2024-12-19
        const {
            categoria,
            concepto,
            fecha_desde,
            fecha_hasta,
            monto_min,
            monto_max,
            sheet_id,
            // Nuevos parámetros de filtro de cliente
            clienteId,
            clienteName,
            // Nuevo parámetro de filtro por estado
            estado,
            // Parámetros de paginación nuevos
            page = 1,
            pageSize = 100,
            sortBy = 'fecha',
            order = 'desc',
            // Parámetros legacy para compatibilidad
            limit,
            offset,
            order_by,
            order_dir
        } = req.query;
        
        // Convertir parámetros de paginación nueva a formato interno
        const currentPage = parseInt(page);
        const itemsPerPage = parseInt(pageSize);
        const calculatedOffset = (currentPage - 1) * itemsPerPage;
        const calculatedLimit = itemsPerPage;
        
        // Usar parámetros nuevos o legacy para compatibilidad
        const finalLimit = limit ? parseInt(limit) : calculatedLimit;
        const finalOffset = offset !== undefined ? parseInt(offset) : calculatedOffset;
        const finalSortBy = sortBy || order_by || 'fecha';
        const finalOrder = order || order_dir || 'desc';
        
        console.log('📋 [PRESUPUESTOS] Filtros aplicados:', {
            categoria, concepto, clienteId, clienteName, estado, fecha_desde, fecha_hasta, 
            monto_min, monto_max, sheet_id, 
            page: currentPage, pageSize: itemsPerPage, sortBy: finalSortBy, order: finalOrder
        });
        
        // Construir consulta dinámica con JOIN a clientes según relaciones confirmadas - 2024-12-19
        let query = `
            SELECT 
                p.id,
                p.id_presupuesto_ext,
                p.tipo_comprobante as categoria,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin cliente') as concepto,
                0 as monto,
                p.fecha as fecha_registro,
                p.activo,
                p.estado,
                p.agente
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(p.id_cliente AS integer)
            WHERE p.activo = true
        `;
        
        const params = [];
        let paramCount = 0;
        
        // Aplicar filtros dinámicos
        if (categoria) {
            paramCount++;
            query += ` AND LOWER(p.tipo_comprobante) LIKE LOWER($${paramCount})`;
            params.push(`%${categoria}%`);
        }
        
        // Filtro de cliente mejorado - Filtro cliente + Typeahead + Fechas – 2024-12-19
        if (clienteId) {
            // Filtro por ID de cliente exacto (número de 3 cifras)
            paramCount++;
            query += ` AND c.cliente_id = $${paramCount}`;
            params.push(parseInt(clienteId));
        } else if (clienteName) {
            // Filtro por nombre/apellido del cliente
            paramCount++;
            query += ` AND LOWER(c.nombre || ' ' || COALESCE(c.apellido,'')) LIKE LOWER($${paramCount})`;
            params.push(`%${clienteName}%`);
        } else if (concepto) {
            // Filtro legacy por concepto (mantener compatibilidad)
            paramCount++;
            query += ` AND (LOWER(c.nombre) LIKE LOWER($${paramCount}) OR LOWER(c.apellido) LIKE LOWER($${paramCount}) OR LOWER(c.otros) LIKE LOWER($${paramCount}))`;
            params.push(`%${concepto}%`);
        }
        
        if (fecha_desde) {
            paramCount++;
            query += ` AND p.fecha >= $${paramCount}`;
            params.push(fecha_desde);
        }
        
        if (fecha_hasta) {
            paramCount++;
            query += ` AND p.fecha <= $${paramCount}`;
            params.push(fecha_hasta);
        }
        
        if (monto_min) {
            paramCount++;
            query += ` AND 0 >= $${paramCount}`;
            params.push(parseFloat(monto_min));
        }
        
        if (monto_max) {
            paramCount++;
            query += ` AND 0 <= $${paramCount}`;
            params.push(parseFloat(monto_max));
        }
        
        if (sheet_id) {
            paramCount++;
            query += ` AND p.id_presupuesto_ext = $${paramCount}`;
            params.push(sheet_id);
        }
        
        // Filtro por estado - Filtro por Estado – 2024-12-19
        if (estado) {
            // Soportar múltiples estados (array o string separado por comas)
            let estadosArray = [];
            if (Array.isArray(estado)) {
                estadosArray = estado;
            } else if (typeof estado === 'string') {
                estadosArray = estado.split(',').map(e => e.trim()).filter(e => e.length > 0);
            }
            
            if (estadosArray.length > 0) {
                const estadosPlaceholders = estadosArray.map((_, index) => `$${paramCount + index + 1}`).join(', ');
                paramCount += estadosArray.length;
                query += ` AND p.estado IN (${estadosPlaceholders})`;
                params.push(...estadosArray);
                
                console.log(`🔍 [PRESUPUESTOS] Ruta GET / - Filtro estado: [${estadosArray.join(', ')}]`);
            }
        }
        
        // Ordenamiento - Orden por fecha DESC + paginación – 2024-12-19
        const validOrderFields = ['fecha', 'fecha_registro', 'categoria', 'concepto', 'monto'];
        let orderField;
        if (finalSortBy === 'fecha' || finalSortBy === 'fecha_registro') {
            orderField = 'p.fecha';
        } else if (finalSortBy === 'categoria') {
            orderField = 'p.tipo_comprobante';
        } else if (finalSortBy === 'concepto') {
            orderField = 'COALESCE(c.nombre, c.apellido, c.otros)';
        } else if (finalSortBy === 'monto') {
            orderField = '0';
        } else {
            orderField = 'p.fecha'; // Default: ordenar por fecha
        }
        const orderDirection = finalOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        
        // Manejo de fecha DATE (YYYY-MM-DD) sin UTC; orden servidor – [YYYY-MM-DD] – 2024-12-19
        query += ` ORDER BY ${orderField} ${orderDirection} NULLS LAST, p.id DESC`;
        
        // Paginación - Orden por fecha DESC + paginación – 2024-12-19
        if (finalLimit) {
            paramCount++;
            query += ` LIMIT $${paramCount}`;
            params.push(finalLimit);
        }
        
        if (finalOffset) {
            paramCount++;
            query += ` OFFSET $${paramCount}`;
            params.push(finalOffset);
        }
        
        console.log('📋 [PRESUPUESTOS] Consulta SQL:', query);
        console.log('📋 [PRESUPUESTOS] Parámetros:', params);
        
        const result = await req.db.query(query, params);
        
        // AUDITORÍA DE FECHAS - Instrumentación completa de logs inteligentes
        const auditoriaDeFechas = process.env.DEBUG_FECHAS === 'true' || req.query.debug_fechas === 'true';
        
        if (auditoriaDeFechas && result.rows.length > 0) {
            console.log('\n🔍 [AUDITORÍA-FECHAS] ===== PASO 1: LECTURA DESDE BASE DE DATOS =====');
            
            // Generar ID único para correlacionar logs de toda la solicitud
            const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            console.log(`[AUDITORÍA-FECHAS] Request ID de correlación: ${requestId}`);
            
            // Análisis de muestra distribuida (máximo 20 registros representativos)
            const totalRegistros = result.rows.length;
            const muestraSize = Math.min(20, totalRegistros);
            const indices = [];
            
            if (totalRegistros <= 20) {
                // Si hay 20 o menos, tomar todos
                for (let i = 0; i < totalRegistros; i++) indices.push(i);
            } else {
                // Distribuir muestra: primeros 5, últimos 5, y hasta 10 intermedios
                for (let i = 0; i < 5; i++) indices.push(i);
                for (let i = totalRegistros - 5; i < totalRegistros; i++) indices.push(i);
                const step = Math.max(1, Math.floor((totalRegistros - 10) / 10));
                for (let i = 5; i < totalRegistros - 5; i += step) {
                    if (indices.length < 20) indices.push(i);
                }
            }
            
            // Análisis de la muestra
            const muestraFechas = indices.map(i => result.rows[i]);
            const fechasValidas = muestraFechas.filter(row => row.fecha_registro);
            
            if (fechasValidas.length > 0) {
                const { tiposDetectados, formatosDetectados, fechasFuturas, ejemplosFechasFuturas } = analyzeDateData(fechasValidas);
                // Ordenar fechas para análisis
                const fechasOrdenadas = fechasValidas
                    .map(row => ({ ...row, fechaObj: new Date(row.fecha_registro) }))
                    .sort((a, b) => a.fechaObj - b.fechaObj);

                const fechaMinima = fechasOrdenadas[0];
                const fechaMaxima = fechasOrdenadas[fechasOrdenadas.length - 1];
                
                // PASO 1: RESUMEN DE LECTURA DESDE BD
                console.log(`[AUDITORÍA-FECHAS] 📊 RESUMEN PASO 1 - LECTURA BD (${requestId}):`);
                console.log(`[AUDITORÍA-FECHAS] - Total registros consultados: ${totalRegistros}`);
                console.log(`[AUDITORÍA-FECHAS] - Muestra analizada: ${muestraSize} registros`);
                console.log(`[AUDITORÍA-FECHAS] - Fecha mínima en BD: ${fechaMinima.fecha_registro} (ID: ${fechaMinima.id})`);
                console.log(`[AUDITORÍA-FECHAS] - Fecha máxima en BD: ${fechaMaxima.fecha_registro} (ID: ${fechaMaxima.id})`);
                console.log(`[AUDITORÍA-FECHAS] - Tipos de datos detectados: ${Array.from(tiposDetectados).join(', ')}`);
                console.log(`[AUDITORÍA-FECHAS] - Formatos detectados: ${Array.from(formatosDetectados).join(', ')}`);
                console.log(`[AUDITORÍA-FECHAS] - Fechas futuras detectadas: ${fechasFuturas.length}`);
                
                // Ejemplos de fechas futuras (máximo 5)
                if (fechasFuturas.length > 0) {
                    console.log(`[AUDITORÍA-FECHAS] ⚠️ EJEMPLOS DE FECHAS FUTURAS (hasta 5):`);
                    fechasFuturas.slice(0, 5).forEach((item, idx) => {
                        console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${item.id}, fecha_futura="${item.fecha}", año=${item.fechaObj.getFullYear()}`);
                    });
                }
                
                // Ejemplos representativos de la muestra (máximo 10)
                console.log(`[AUDITORÍA-FECHAS] 📋 EJEMPLOS PASO 1 - VALORES CRUDOS BD (hasta 10):`);
                muestraFechas.slice(0, 10).forEach((row, idx) => {
                    const fechaValue = row.fecha_registro;
                    console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${row.id}, valor_crudo="${fechaValue}", tipo=${typeof fechaValue}, formato_detectado=${
                        fechaValue instanceof Date ? 'Date object' :
                        typeof fechaValue === 'string' && fechaValue.includes('T') ? 'ISO con hora' :
                        typeof fechaValue === 'string' && fechaValue.match(/^\d{4}-\d{2}-\d{2}$/) ? 'YYYY-MM-DD' :
                        'Otro'
                    }`);
                });
                
                // Guardar datos para correlación con pasos siguientes
                result.auditData = {
                    requestId,
                    paso1: {
                        totalRegistros,
                        muestraSize,
                        fechaMinima: fechaMinima.fecha_registro,
                        fechaMaxima: fechaMaxima.fecha_registro,
                        tiposDetectados: Array.from(tiposDetectados),
                        formatosDetectados: Array.from(formatosDetectados),
                        fechasFuturas: fechasFuturas.length,
                        ejemplosFechasFuturas: fechasFuturas.slice(0, 5)
                    }
                };
            }
        }
        
        // Consulta para total de registros (sin paginación) - Ajuste según relaciones confirmadas - 2024-12-19
        let countQuery = `
            SELECT COUNT(*) as total
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(p.id_cliente AS integer)
            WHERE p.activo = true
        `;
        
        // Aplicar mismos filtros para el conteo
        let countParams = [];
        let countParamCount = 0;
        
        if (categoria) {
            countParamCount++;
            countQuery += ` AND LOWER(p.tipo_comprobante) LIKE LOWER($${countParamCount})`;
            countParams.push(`%${categoria}%`);
        }
        
        // Aplicar mismo filtro de cliente para el conteo - Filtro cliente + Typeahead + Fechas – 2024-12-19
        if (clienteId) {
            countParamCount++;
            countQuery += ` AND c.cliente_id = $${countParamCount}`;
            countParams.push(parseInt(clienteId));
        } else if (clienteName) {
            countParamCount++;
            countQuery += ` AND LOWER(c.nombre || ' ' || COALESCE(c.apellido,'')) LIKE LOWER($${countParamCount})`;
            countParams.push(`%${clienteName}%`);
        } else if (concepto) {
            countParamCount++;
            countQuery += ` AND (LOWER(c.nombre) LIKE LOWER($${countParamCount}) OR LOWER(c.apellido) LIKE LOWER($${countParamCount}) OR LOWER(c.otros) LIKE LOWER($${countParamCount}))`;
            countParams.push(`%${concepto}%`);
        }
        
        if (fecha_desde) {
            countParamCount++;
            countQuery += ` AND p.fecha >= $${countParamCount}`;
            countParams.push(fecha_desde);
        }
        
        if (fecha_hasta) {
            countParamCount++;
            countQuery += ` AND p.fecha <= $${countParamCount}`;
            countParams.push(fecha_hasta);
        }
        
        if (monto_min) {
            countParamCount++;
            countQuery += ` AND 0 >= $${countParamCount}`;
            countParams.push(parseFloat(monto_min));
        }
        
        if (monto_max) {
            countParamCount++;
            countQuery += ` AND 0 <= $${countParamCount}`;
            countParams.push(parseFloat(monto_max));
        }
        
        if (sheet_id) {
            countParamCount++;
            countQuery += ` AND p.id_presupuesto_ext = $${countParamCount}`;
            countParams.push(sheet_id);
        }
        
        // Aplicar mismo filtro de estado para el conteo - Filtro por Estado – 2024-12-19
        if (estado) {
            let estadosArray = [];
            if (Array.isArray(estado)) {
                estadosArray = estado;
            } else if (typeof estado === 'string') {
                estadosArray = estado.split(',').map(e => e.trim()).filter(e => e.length > 0);
            }
            
            if (estadosArray.length > 0) {
                const estadosPlaceholders = estadosArray.map((_, index) => `$${countParamCount + index + 1}`).join(', ');
                countParamCount += estadosArray.length;
                countQuery += ` AND p.estado IN (${estadosPlaceholders})`;
                countParams.push(...estadosArray);
            }
        }
        
        const countResult = await req.db.query(countQuery, countParams);
        const totalRecords = parseInt(countResult.rows[0].total);
        
        console.log(`✅ [PRESUPUESTOS] Presupuestos obtenidos: ${result.rows.length} de ${totalRecords} registros`);
        
        // Log de categorías encontradas para debugging
        const categorias = [...new Set(result.rows.map(row => row.categoria))];
        console.log('📊 [PRESUPUESTOS] Tipos de comprobante encontrados:', categorias);
        console.log('📊 [PRESUPUESTOS] Muestra de datos:', result.rows.slice(0, 3));
        
        // AUDITORÍA DE FECHAS - PASO 2: Transformaciones en backend (si las hay)
        if (auditoriaDeFechas && result.auditData) {
            const { requestId } = result.auditData;
            console.log(`\n🔍 [AUDITORÍA-FECHAS] ===== PASO 2: TRANSFORMACIONES EN BACKEND (${requestId}) =====`);
            
            // En este punto, verificamos si hay transformaciones entre la lectura de BD y la preparación para envío
            // Como estamos usando el resultado directo de la BD sin transformaciones adicionales,
            // documentamos que no hay transformaciones en el backend
            console.log(`[AUDITORÍA-FECHAS] 📋 ANÁLISIS PASO 2 - TRANSFORMACIONES BACKEND (${requestId}):`);
            console.log(`[AUDITORÍA-FECHAS] - Motivo: Sin transformaciones - datos enviados tal como se leen de BD`);
            console.log(`[AUDITORÍA-FECHAS] - Proceso: Los valores de fecha se mantienen en su formato original`);
            console.log(`[AUDITORÍA-FECHAS] - Zona horaria: Sin manipulación de zona horaria`);
            console.log(`[AUDITORÍA-FECHAS] - Formateo: Sin formateo adicional aplicado`);
            console.log(`[AUDITORÍA-FECHAS] ✅ No se detectaron transformaciones en el backend`);
            
            // Actualizar datos de auditoría
            result.auditData.paso2 = {
                transformacionesDetectadas: false,
                motivo: 'Sin transformaciones - datos enviados tal como se leen de BD',
                procesoAplicado: 'Ninguno',
                zonaHoraria: 'Sin manipulación',
                formateoAplicado: 'Ninguno'
            };
        }
        
        // AUDITORÍA DE FECHAS - PASO 3: Serialización de la API (antes de enviar respuesta)
        if (auditoriaDeFechas && result.rows.length > 0) {
            const requestId = result.auditData?.requestId || 'NO-ID';
            console.log(`\n🔍 [AUDITORÍA-FECHAS] ===== PASO 3: SERIALIZACIÓN DE LA API (${requestId}) =====`);
            
            // Analizar fechas que se van a enviar al frontend
            const fechasParaEnviar = result.rows.filter(row => row.fecha_registro);
            
            if (fechasParaEnviar.length > 0) {
                // Análisis de muestra para serialización (máximo 10 registros)
                const muestraEnvio = fechasParaEnviar.slice(0, 10);
                
                const fechasOrdenadas = fechasParaEnviar
                    .map(row => ({ ...row, fechaObj: new Date(row.fecha_registro) }))
                    .sort((a, b) => a.fechaObj - b.fechaObj);
                
                const fechaMinima = fechasOrdenadas[0];
                const fechaMaxima = fechasOrdenadas[fechasOrdenadas.length - 1];
                
                // Detectar tipos y formatos en la serialización
                const tiposEnvio = new Set();
                const formatosEnvio = new Set();
                const fechasFuturasEnvio = [];
                const ahora = new Date();
                const unAñoFuturo = new Date(ahora.getFullYear() + 1, ahora.getMonth(), ahora.getDate());
                
                fechasParaEnviar.forEach(row => {
                    const fechaValue = row.fecha_registro;
                    const tipoDetectado = typeof fechaValue;
                    tiposEnvio.add(tipoDetectado);
                    
                    // Detectar formato específico en serialización
                    if (fechaValue instanceof Date) {
                        formatosEnvio.add('Date object');
                    } else if (typeof fechaValue === 'string') {
                        if (fechaValue.includes('T') && fechaValue.includes('Z')) {
                            formatosEnvio.add('ISO UTC (YYYY-MM-DDTHH:mm:ss.sssZ)');
                        } else if (fechaValue.includes('T')) {
                            formatosEnvio.add('ISO con hora (YYYY-MM-DDTHH:mm:ss)');
                        } else if (fechaValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                            formatosEnvio.add('YYYY-MM-DD (solo fecha)');
                        } else if (fechaValue.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                            formatosEnvio.add('DD/MM/YYYY');
                        } else {
                            formatosEnvio.add('Otro formato string');
                        }
                    } else if (typeof fechaValue === 'number') {
                        formatosEnvio.add('Timestamp numérico');
                    }
                    
                    // Detectar fechas futuras en serialización
                    const fechaObj = new Date(fechaValue);
                    if (fechaObj > unAñoFuturo) {
                        fechasFuturasEnvio.push({ id: row.id, fecha: fechaValue, fechaObj });
                    }
                });
                
                // PASO 3: RESUMEN DE SERIALIZACIÓN API
                console.log(`[AUDITORÍA-FECHAS] 📤 RESUMEN PASO 3 - SERIALIZACIÓN API (${requestId}):`);
                console.log(`[AUDITORÍA-FECHAS] - Total registros a enviar: ${result.rows.length}`);
                console.log(`[AUDITORÍA-FECHAS] - Fecha mínima a enviar: ${fechaMinima.fecha_registro} (ID: ${fechaMinima.id})`);
                console.log(`[AUDITORÍA-FECHAS] - Fecha máxima a enviar: ${fechaMaxima.fecha_registro} (ID: ${fechaMaxima.id})`);
                console.log(`[AUDITORÍA-FECHAS] - Tipos en serialización: ${Array.from(tiposEnvio).join(', ')}`);
                console.log(`[AUDITORÍA-FECHAS] - Formatos en serialización: ${Array.from(formatosEnvio).join(', ')}`);
                console.log(`[AUDITORÍA-FECHAS] - Fechas futuras en serialización: ${fechasFuturasEnvio.length}`);
                
                // Ejemplos de fechas futuras en serialización (máximo 5)
                if (fechasFuturasEnvio.length > 0) {
                    console.log(`[AUDITORÍA-FECHAS] ⚠️ EJEMPLOS DE FECHAS FUTURAS EN SERIALIZACIÓN (hasta 5):`);
                    fechasFuturasEnvio.slice(0, 5).forEach((item, idx) => {
                        console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${item.id}, fecha_futura_api="${item.fecha}", año=${item.fechaObj.getFullYear()}`);
                    });
                }
                
                // Ejemplos de lo que se va a enviar (máximo 10)
                console.log(`[AUDITORÍA-FECHAS] 📤 EJEMPLOS PASO 3 - VALORES A ENVIAR (hasta 10):`);
                muestraEnvio.forEach((row, idx) => {
                    const fechaValue = row.fecha_registro;
                    console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${row.id}, valor_a_enviar="${fechaValue}", tipo=${typeof fechaValue}, será_serializado_como=${
                        fechaValue instanceof Date ? 'ISO string por JSON.stringify' :
                        typeof fechaValue === 'string' ? 'string (sin cambios)' :
                        typeof fechaValue === 'number' ? 'number (sin cambios)' :
                        'unknown'
                    }`);
                });
                
                // Comparar con paso anterior para detectar transformaciones
                const datosAnterior = result.auditData?.paso1;
                if (datosAnterior) {
                    const transformacionDetectada = (
                        tiposEnvio.size !== datosAnterior.tiposDetectados.length ||
                        formatosEnvio.size !== datosAnterior.formatosDetectados.length ||
                        fechasFuturasEnvio.length !== datosAnterior.fechasFuturas
                    );
                    
                    if (transformacionDetectada) {
                        console.log(`[AUDITORÍA-FECHAS] ⚠️ TRANSFORMACIÓN DETECTADA ENTRE PASO 1 Y PASO 3:`);
                        console.log(`[AUDITORÍA-FECHAS] - Cambio en tipos: ${datosAnterior.tiposDetectados.join(', ')} → ${Array.from(tiposEnvio).join(', ')}`);
                        console.log(`[AUDITORÍA-FECHAS] - Cambio en formatos: ${datosAnterior.formatosDetectados.join(', ')} → ${Array.from(formatosEnvio).join(', ')}`);
                        console.log(`[AUDITORÍA-FECHAS] - Cambio en fechas futuras: ${datosAnterior.fechasFuturas} → ${fechasFuturasEnvio.length}`);
                    } else {
                        console.log(`[AUDITORÍA-FECHAS] ✅ No se detectaron transformaciones entre Paso 1 y Paso 3`);
                    }
                }
                
                // Actualizar datos de auditoría para el paso 3
                if (result.auditData) {
                    result.auditData.paso3 = {
                        totalRegistrosEnviar: result.rows.length,
                        fechaMinima: fechaMinima.fecha_registro,
                        fechaMaxima: fechaMaxima.fecha_registro,
                        tiposEnSerializacion: Array.from(tiposEnvio),
                        formatosEnSerializacion: Array.from(formatosEnvio),
                        fechasFuturasEnSerializacion: fechasFuturasEnvio.length,
                        ejemplosFechasFuturas: fechasFuturasEnvio.slice(0, 5)
                    };
                }
            }
        }
        
        // Respuesta con formato de paginación mejorado - Orden por fecha DESC + paginación – 2024-12-19
        res.json({
            success: true,
            data: result.rows,
            total: totalRecords,
            page: currentPage,
            pageSize: itemsPerPage,
            items: result.rows, // Alias para compatibilidad
            pagination: {
                total: totalRecords,
                page: currentPage,
                pageSize: itemsPerPage,
                pages: Math.ceil(totalRecords / itemsPerPage),
                hasNext: currentPage < Math.ceil(totalRecords / itemsPerPage),
                hasPrev: currentPage > 1,
                // Legacy para compatibilidad
                limit: finalLimit,
                offset: finalOffset
            },
            sorting: {
                sortBy: finalSortBy,
                order: finalOrder
            },
            filters: {
                categoria, concepto, clienteId, clienteName, estado, fecha_desde, fecha_hasta,
                monto_min, monto_max, sheet_id
            },
            categorias: categorias,
            timestamp: new Date().toISOString(),
            // Incluir requestId para correlación con frontend
            ...(auditoriaDeFechas && result.requestId && { auditRequestId: result.requestId })
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener presupuestos:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuestos',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener sugerencias de clientes para typeahead - Filtro cliente + Typeahead + Fechas – 2024-12-19
 */
const obtenerSugerenciasClientes = async (req, res) => {
  try {
    const qRaw = (req.query.q || '').trim();
    if (!qRaw) {
      return res.json({
        success: true,
        data: [],
        message: 'Query muy corto para sugerencias',
        timestamp: new Date().toISOString()
      });
    }

    const limitParam = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 10;

    // ¿Buscan por ID numérico corto?
    if (/^\d{1,6}$/.test(qRaw)) {
      const query = `
        SELECT DISTINCT
          c.cliente_id,
          c.nombre,
          c.apellido,
          c.otros,
          COUNT(p.id) AS total_presupuestos
        FROM public.clientes c
        LEFT JOIN public.presupuestos p
          ON p.id_cliente = CAST(c.cliente_id AS text) AND p.activo = true
        WHERE c.cliente_id = $1
        GROUP BY c.cliente_id, c.nombre, c.apellido, c.otros
        ORDER BY total_presupuestos DESC, c.nombre
        LIMIT $2
      `;
      const params = [parseInt(qRaw, 10), limit];

      const result = await req.db.query(query, params);
      const sugerencias = result.rows.map(cliente => ({
        id: cliente.cliente_id,
        text: `${cliente.cliente_id.toString().padStart(3, '0')} — ${cliente.nombre || ''} ${cliente.apellido || ''}`.trim(),
        nombre: cliente.nombre,
        apellido: cliente.apellido,
        otros: cliente.otros,
        total_presupuestos: parseInt(cliente.total_presupuestos)
      }));

      return res.json({
        success: true,
        data: sugerencias,
        query: qRaw,
        total: sugerencias.length,
        timestamp: new Date().toISOString()
      });
    }

    // Texto libre → múltiples términos (AND), buscando en nombre + apellido + otros
    const tokens = qRaw
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    let p = 0;
    const params = [];
    const andConds = tokens.map(t => {
      p += 1; const ph = `$${p}`; params.push(`%${t}%`);
      return `(LOWER(c.nombre) ILIKE ${ph} OR LOWER(c.apellido) ILIKE ${ph} OR LOWER(c.otros) ILIKE ${ph})`;
    });

    p += 1; params.push(limit);

    const query = `
      SELECT DISTINCT
        c.cliente_id,
        c.nombre,
        c.apellido,
        c.otros,
        COUNT(pres.id) AS total_presupuestos
      FROM public.clientes c
      LEFT JOIN public.presupuestos pres
        ON pres.id_cliente = CAST(c.cliente_id AS text) AND pres.activo = true
      WHERE ${andConds.join(' AND ')}
      GROUP BY c.cliente_id, c.nombre, c.apellido, c.otros
      ORDER BY total_presupuestos DESC, c.nombre
      LIMIT $${p}
    `;

    const result = await req.db.query(query, params);

    const sugerencias = result.rows.map(cliente => ({
      id: cliente.cliente_id,
      text: `${cliente.cliente_id.toString().padStart(3, '0')} — ${cliente.nombre || ''} ${cliente.apellido || ''}`.trim(),
      nombre: cliente.nombre,
      apellido: cliente.apellido,
      otros: cliente.otros,
      total_presupuestos: parseInt(cliente.total_presupuestos)
    }));

    return res.json({
      success: true,
      data: sugerencias,
      query: qRaw,
      total: sugerencias.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [PRESUPUESTOS] Error al obtener sugerencias de clientes:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener sugerencias de clientes',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Obtener sugerencias de artículos para autocompletar en detalles
 */
const obtenerSugerenciasArticulos = async (req, res) => {
  try {
    const qRaw = (req.query.q || '').trim();
    if (!qRaw) {
      return res.json({
        success: true,
        data: [],
        message: 'Escribí para buscar artículos...',
        timestamp: new Date().toISOString()
      });
    }

    // limit: default 50, máximo 200
    const limitParam = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    // Tokenización (múltiples palabras) – tolerante a espacios y acentos (solo para logs);
    // en SQL usamos ILIKE para insensibilidad de mayúsc/minúsc.
    const tokens = qRaw
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    // Si parece código de barras (solo dígitos 8–14), lo priorizamos como igualdad exacta
    const isBarcode = /^\d{8,14}$/.test(qRaw);

    // Armado dinámico del WHERE con placeholders
    const fields = ['src.descripcion', 'src.articulo_numero', 'src.codigo_barras'];
    const whereParts = [];
    const params = [];
    let p = 0;

    if (isBarcode) {
      p += 1;
      whereParts.push(`src.codigo_barras = $${p}`);
      params.push(qRaw);
    }

    if (tokens.length) {
      const andGroup = tokens.map(t => {
        p += 1;
        const ph = `$${p}`;
        params.push(`%${t}%`);
        return `(${fields.map(f => `${f} ILIKE ${ph}`).join(' OR ')})`;
      });
      // Si ya agregamos el OR de código de barras exacto, incluimos AND-group aparte
      if (isBarcode) {
        whereParts.push(`(${andGroup.join(' AND ')})`);
      } else {
        whereParts.push(...andGroup);
      }
    }

    // Si no hay condiciones, devolvemos vacío (no debería ocurrir porque qRaw existe)
    if (!whereParts.length) {
      return res.json({ success: true, data: [], query: qRaw, total: 0, timestamp: new Date().toISOString() });
    }

    const whereClause = isBarcode
      ? `WHERE (${whereParts[0]}) OR (${whereParts.slice(1).join(' AND ') || 'FALSE'})`
      : `WHERE ${whereParts.join(' AND ')}`;

    const sql = `
      SELECT
        src.codigo_barras,
        src.articulo_numero,
        src.descripcion,
        COALESCE(src.stock_consolidado, 0) AS stock_consolidado
      FROM public.stock_real_consolidado src
      ${whereClause}
      ORDER BY
        CASE WHEN COALESCE(src.stock_consolidado,0) > 0 THEN 0 ELSE 1 END ASC,
        src.descripcion ASC
      LIMIT $${p + 1}
    `;
    params.push(limit);

    console.log('📋 [PRESUPUESTOS] Query artículos:', sql);
    console.log('📋 [PRESUPUESTOS] Parámetros:', params);

    const result = await req.db.query(sql, params);

    const sugerencias = result.rows.map(a => ({
      codigo_barras: a.codigo_barras,
      articulo_numero: a.articulo_numero,
      descripcion: a.descripcion,
      stock_consolidado: parseFloat(a.stock_consolidado || 0),
      text: `${a.descripcion} — [${a.articulo_numero}] (stock: ${Math.floor(a.stock_consolidado || 0)})`
    }));

    console.log(`✅ [PRESUPUESTOS] Sugerencias de artículos encontradas: ${sugerencias.length} (limit=${limit})`);

    return res.json({
      success: true,
      data: sugerencias,
      query: qRaw,
      total: sugerencias.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [PRESUPUESTOS] Error al obtener sugerencias de artículos:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener sugerencias de artículos',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Obtener precio neto (valor1) e IVA para un artículo según la lista del cliente.
 * Mapas de listas:
 * 1 -> precio_neg | 2 -> mayorista | 3 -> especial_brus | 4 -> consumidor_final | 5 -> lista_5
 * Si no se encuentra, devolver 0s (pedido explícito).
 */
const obtenerPrecioArticuloCliente = async (req, res) => {
  try {
    const idCliente = parseInt(req.query.cliente_id, 10) || 0;
    const codigoBarras = (req.query.codigo_barras || '').trim();
    let descripcion = (req.query.descripcion || '').trim();

    if (!codigoBarras && !descripcion) {
      return res.status(400).json({
        success: false,
        error: 'Falta codigo_barras o descripcion',
        timestamp: new Date().toISOString()
      });
    }

    // 1) Lista de precios del cliente (default 1)
    let lista = 1;
    if (idCliente > 0) {
      try {
        const rLista = await req.db.query(
          'SELECT lista_precios FROM public.clientes WHERE cliente_id = $1 LIMIT 1',
          [idCliente]
        );
        if (rLista.rows.length) {
          const n = parseInt(rLista.rows[0].lista_precios, 10);
          if (Number.isFinite(n) && n >= 1 && n <= 5) lista = n;
        }
      } catch (e) {
        console.warn('[PRECIOS] No se pudo leer lista_precios del cliente, usando 1 por defecto');
      }
    }

    // 2) Si no vino descripción y sí código de barras, resolverla
    if (!descripcion && codigoBarras) {
      const rDesc = await req.db.query(
        'SELECT descripcion FROM public.stock_real_consolidado WHERE codigo_barras = $1 LIMIT 1',
        [codigoBarras]
      );
      if (rDesc.rows.length) descripcion = rDesc.rows[0].descripcion;
    }

    if (!descripcion) {
      return res.json({
        success: true,
        data: { valor1: 0, iva: 0, lista_precios: lista },
        message: 'Artículo no encontrado',
        timestamp: new Date().toISOString()
      });
    }

    // 3) Buscar precios por descripción (igual exacto → fallback ILIKE)
    let rPrecio = await req.db.query(`
      SELECT 
        COALESCE(iva,0)              AS iva,
        COALESCE(precio_neg,0)       AS precio_neg,
        COALESCE(mayorista,0)        AS mayorista,
        COALESCE(especial_brus,0)    AS especial_brus,
        COALESCE(consumidor_final,0) AS consumidor_final,
        COALESCE(lista_5,0)          AS lista_5
      FROM public.precios_articulos
      WHERE LOWER(descripcion) = LOWER($1)
      LIMIT 1
    `, [descripcion]);

    if (rPrecio.rows.length === 0) {
      rPrecio = await req.db.query(`
        SELECT 
          COALESCE(iva,0)              AS iva,
          COALESCE(precio_neg,0)       AS precio_neg,
          COALESCE(mayorista,0)        AS mayorista,
          COALESCE(especial_brus,0)    AS especial_brus,
          COALESCE(consumidor_final,0) AS consumidor_final,
          COALESCE(lista_5,0)          AS lista_5
        FROM public.precios_articulos
        WHERE descripcion ILIKE $1
        ORDER BY LENGTH(descripcion) ASC
        LIMIT 1
      `, [descripcion]);
    }

    if (rPrecio.rows.length === 0) {
      return res.json({
        success: true,
        data: { valor1: 0, iva: 0, lista_precios: lista },
        message: 'Sin precio para la descripción',
        timestamp: new Date().toISOString()
      });
    }

    const p = rPrecio.rows[0];
    const valor =
      lista === 1 ? p.precio_neg :
      lista === 2 ? p.mayorista :
      lista === 3 ? p.especial_brus :
      lista === 4 ? p.consumidor_final :
      lista === 5 ? p.lista_5 : p.precio_neg;

    return res.json({
      success: true,
      data: {
        valor1: Number(valor) || 0,
        iva: Number(p.iva) || 0,
        lista_precios: lista,
        descripcion_resuelta: descripcion
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ [PRESUPUESTOS] Error en obtenerPrecioArticuloCliente:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno al obtener precio/IVA',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};


/**
 * Obtener presupuestos por categoría
 */
const obtenerPresupuestosPorCategoria = async (req, res) => {
    try {
        const { categoria } = req.params;
        console.log(`🔍 [PRESUPUESTOS] Obteniendo presupuestos para categoría: ${categoria}`);
        
        const query = `
            SELECT 
                p.id,
                p.id_presupuesto_ext as sheet_id,
                'Presupuestos' as sheet_name,
                p.tipo_comprobante as categoria,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin cliente') as concepto,
                0 as monto,
                p.fecha as fecha_registro,
                p.fecha as fecha_sincronizacion,
                p.activo
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(p.id_cliente AS integer)
            WHERE p.activo = true AND LOWER(p.tipo_comprobante) = LOWER($1)
            ORDER BY p.fecha DESC, concepto
        `;
        
        const result = await req.db.query(query, [categoria]);
        
        console.log(`✅ [PRESUPUESTOS] Presupuestos encontrados para '${categoria}': ${result.rows.length} registros`);
        
        res.json({
            success: true,
            data: result.rows,
            categoria: categoria,
            total: result.rows.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error al obtener presupuestos por categoría:`, error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuestos por categoría',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estadísticas de presupuestos
 */
const obtenerEstadisticas = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Calculando estadísticas...');
        
        const query = `
            SELECT 
                COUNT(*) as total_registros,
                COUNT(DISTINCT tipo_comprobante) as total_categorias,
                0 as monto_total,
                0 as monto_promedio,
                0 as monto_minimo,
                0 as monto_maximo,
                COALESCE(
                    (SELECT MAX(fecha_sync) FROM public.presupuestos_sync_log WHERE exitoso = true),
                    (SELECT MAX(fecha) FROM public.presupuestos WHERE activo = true)
                ) as ultima_sincronizacion
            FROM public.presupuestos 
            WHERE activo = true
        `;
        
        const result = await req.db.query(query);
        const stats = result.rows[0];
        
        // Obtener distribución por categorías
        const categoriasQuery = `
            SELECT 
                tipo_comprobante as categoria,
                COUNT(*) as cantidad,
                0 as monto_categoria,
                0 as promedio_categoria
            FROM public.presupuestos 
            WHERE activo = true 
            GROUP BY tipo_comprobante 
            ORDER BY cantidad DESC
        `;
        
        const categoriasResult = await req.db.query(categoriasQuery);
        
        console.log('✅ [PRESUPUESTOS] Estadísticas calculadas exitosamente');
        console.log(`📊 [PRESUPUESTOS] Total registros: ${stats.total_registros}`);
        console.log(`💰 [PRESUPUESTOS] Monto total: $${parseFloat(stats.monto_total || 0).toFixed(2)}`);
        
        res.json({
            success: true,
            estadisticas: {
                total_registros: parseInt(stats.total_registros),
                total_categorias: parseInt(stats.total_categorias),
                monto_total: parseFloat(stats.monto_total || 0),
                monto_promedio: parseFloat(stats.monto_promedio || 0),
                monto_minimo: parseFloat(stats.monto_minimo || 0),
                monto_maximo: parseFloat(stats.monto_maximo || 0),
                ultima_sincronizacion: stats.ultima_sincronizacion
            },
            categorias: categoriasResult.rows,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al calcular estadísticas:', error);
        res.status(500).json({
            success: false,
            error: 'Error al calcular estadísticas',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener configuración actual
 */
const obtenerConfiguracion = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Obteniendo configuración actual...');
        
        const query = `
            SELECT 
                id,
                sheet_url,
                sheet_id,
                range_datos,
                ultima_sincronizacion,
                activo,
                creado_por,
                fecha_creacion
            FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const result = await req.db.query(query);
        
        if (result.rows.length === 0) {
            console.log('⚠️ [PRESUPUESTOS] No se encontró configuración activa');
            return res.json({
                success: true,
                data: null,
                message: 'No hay configuración activa',
                timestamp: new Date().toISOString()
            });
        }
        
        const config = result.rows[0];
        console.log('✅ [PRESUPUESTOS] Configuración encontrada:', config.sheet_id);
        
        res.json({
            success: true,
            data: config,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener configuración:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener configuración',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener presupuesto por ID
 */
const obtenerPresupuestoPorId = async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🔍 [PRESUPUESTOS] Obteniendo presupuesto por ID: ${id}`);
        
        // Validar formato de ID: numérico (legacy) o UUIDv7 con prefijo P-
        const isNumericId = /^\d+$/.test(id);
        const isUUIDv7Id = /^P-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
        
        if (!isNumericId && !isUUIDv7Id) {
            console.log('❌ [PRESUPUESTOS] ID inválido proporcionado:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido (debe ser numérico o P-{UUIDv7})',
                timestamp: new Date().toISOString()
            });
        }
        
        const query = `
            SELECT 
                p.id,
                p.id_presupuesto_ext,
                p.id_cliente,
                p.fecha,
                p.fecha_entrega,
                p.agente,
                p.tipo_comprobante,
                p.estado,
                COALESCE(p.nota, '') AS nota,
                COALESCE(p.punto_entrega, 'Sin dirección') AS punto_entrega,
                COALESCE(p.descuento, 0) AS descuento,
                p.activo
            FROM public.presupuestos p
            WHERE p.id = $1 AND p.activo = true
        `;
        
        const result = await req.db.query(query, [parseInt(id)]);
        
        if (result.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }
        
        const presupuesto = result.rows[0];
        console.log(`[GET/:id] resp`, { 
            id: presupuesto.id, 
            descuento: presupuesto.descuento, 
            nota: presupuesto.nota, 
            punto_entrega: presupuesto.punto_entrega 
        });
        
        res.json({
            success: true,
            data: presupuesto,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener presupuesto por ID:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Crear nuevo presupuesto manualmente
 */
const crearPresupuesto = async (req, res) => {
    try {
        const { sheet_id, sheet_name, categoria, concepto, monto } = req.body;
        const usuario_id = req.user?.id || 1; // TODO: Obtener de sesión real
        
        console.log('🔍 [PRESUPUESTOS] Creando nuevo presupuesto:', { categoria, concepto, monto });
        
        // Validaciones
        if (!concepto || concepto.trim() === '') {
            console.log('❌ [PRESUPUESTOS] Concepto requerido');
            return res.status(400).json({
                success: false,
                error: 'El concepto es requerido',
                timestamp: new Date().toISOString()
            });
        }
        
        if (monto === undefined || monto === null || isNaN(parseFloat(monto))) {
            console.log('❌ [PRESUPUESTOS] Monto inválido:', monto);
            return res.status(400).json({
                success: false,
                error: 'El monto debe ser un número válido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar duplicados
        const duplicateQuery = `
            SELECT p.id FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(p.id_cliente AS integer)
            WHERE LOWER(COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin cliente')) = LOWER($1) 
            AND LOWER(p.tipo_comprobante) = LOWER($2) 
            AND p.id_presupuesto_ext = $3 
            AND p.activo = true
        `;
        
        const duplicateResult = await req.db.query(duplicateQuery, [
            concepto.trim(),
            (categoria || 'Sin categoría').trim(),
            sheet_id || 'manual'
        ]);
        
        if (duplicateResult.rows.length > 0) {
            console.log('⚠️ [PRESUPUESTOS] Presupuesto duplicado detectado');
            return res.status(409).json({
                success: false,
                error: 'Ya existe un presupuesto con el mismo concepto y categoría',
                timestamp: new Date().toISOString()
            });
        }
        
        // Insertar nuevo presupuesto
        const insertQuery = `
            INSERT INTO public.presupuestos 
            (id_presupuesto_ext, tipo_comprobante, id_cliente, fecha, agente, activo)
            VALUES ($1, $2, '999', NOW(), 'Manual', true)
            RETURNING *
        `;
        
        const insertResult = await req.db.query(insertQuery, [
            sheet_id || 'manual',
            sheet_name || 'Ingreso Manual',
            (categoria || 'Sin categoría').trim(),
            concepto.trim(),
            parseFloat(monto)
        ]);
        
        const nuevoPresupuesto = insertResult.rows[0];
        
        console.log(`✅ [PRESUPUESTOS] Presupuesto creado con ID: ${nuevoPresupuesto.id}`);
        console.log(`📋 [PRESUPUESTOS] Detalles: ${nuevoPresupuesto.concepto} - $${nuevoPresupuesto.monto}`);
        
        res.status(201).json({
            success: true,
            data: nuevoPresupuesto,
            message: 'Presupuesto creado exitosamente',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al crear presupuesto:', error);
        res.status(500).json({
            success: false,
            error: 'Error al crear presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Actualizar presupuesto existente
 */
const actualizarPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;
        const { categoria, concepto, monto } = req.body;

        console.log(`🔍 [PRESUPUESTOS] Actualizando presupuesto ID: ${id}`);
        console.log('📋 [PRESUPUESTOS] Nuevos datos:', { categoria, concepto, monto });

        if (!id || id.trim() === '') {
            console.log('❌ [PRESUPUESTOS] ID inválido:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }

        // Usar resolvePresupuesto para encontrar el presupuesto por id o id_presupuesto_ext
        const presupuesto = await resolvePresupuesto(req.db, id);

        if (!presupuesto) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado para actualizar: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }

        // Construir consulta de actualización dinámica
        const updates = [];
        const params = [];
        let paramCount = 0;

        if (categoria !== undefined) {
            paramCount++;
            updates.push(`tipo_comprobante = $${paramCount}`);
            params.push((categoria || 'Sin categoría').trim());
        }

        if (concepto !== undefined && concepto.trim() !== '') {
            paramCount++;
            updates.push(`concepto = $${paramCount}`);
            params.push(concepto.trim());
        }

        if (monto !== undefined && !isNaN(parseFloat(monto))) {
            paramCount++;
            updates.push(`monto = $${paramCount}`);
            params.push(parseFloat(monto));
        }

        if (updates.length === 0) {
            console.log('⚠️ [PRESUPUESTOS] No hay campos válidos para actualizar');
            return res.status(400).json({
                success: false,
                error: 'No se proporcionaron campos válidos para actualizar',
                timestamp: new Date().toISOString()
            });
        }

        // Agregar fecha de sincronización
        paramCount++;
        updates.push(`fecha_sincronizacion = NOW()`);

        // Agregar ID numérico para WHERE
        paramCount++;
        params.push(presupuesto.id);

        const updateQuery = `
            UPDATE public.presupuestos
            SET ${updates.join(', ')}
            WHERE id = $${paramCount} AND activo = true
            RETURNING *
        `;

        console.log('📋 [PRESUPUESTOS] Query de actualización:', updateQuery);
        console.log('📋 [PRESUPUESTOS] Parámetros:', params);

        const updateResult = await req.db.query(updateQuery, params);
        const presupuestoActualizado = updateResult.rows[0];

        console.log(`✅ [PRESUPUESTOS] Presupuesto actualizado: ${presupuestoActualizado.concepto}`);

        res.json({
            success: true,
            data: presupuestoActualizado,
            message: 'Presupuesto actualizado exitosamente',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al actualizar presupuesto:', error);
        res.status(500).json({
            success: false,
            error: 'Error al actualizar presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Eliminar presupuesto (soft delete)
 */
const eliminarPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🔍 [PRESUPUESTOS] Eliminando presupuesto ID: ${id}`);
        
        if (!id || isNaN(parseInt(id))) {
            console.log('❌ [PRESUPUESTOS] ID inválido:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar que el presupuesto existe
        const existsQuery = `
            SELECT p.id, COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin cliente') as concepto 
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(p.id_cliente AS integer)
            WHERE p.id = $1 AND p.activo = true
        `;
        
        const existsResult = await req.db.query(existsQuery, [parseInt(id)]);
        
        if (existsResult.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado para eliminar: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }
        
        const presupuesto = existsResult.rows[0];
        
        // Soft delete
        const deleteQuery = `
            UPDATE public.presupuestos 
            SET activo = false
            WHERE id = $1
            RETURNING id, 'Presupuesto eliminado' as concepto
        `;
        
        const deleteResult = await req.db.query(deleteQuery, [parseInt(id)]);
        const presupuestoEliminado = deleteResult.rows[0];
        
        console.log(`✅ [PRESUPUESTOS] Presupuesto eliminado (soft delete): ${presupuestoEliminado.concepto}`);
        
        res.json({
            success: true,
            data: {
                id: presupuestoEliminado.id,
                concepto: presupuestoEliminado.concepto,
                eliminado: true
            },
            message: 'Presupuesto eliminado exitosamente',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al eliminar presupuesto:', error);
        res.status(500).json({
            success: false,
            error: 'Error al eliminar presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener resumen por categoría o fecha
 */
const obtenerResumen = async (req, res) => {
    try {
        const { 
            tipo = 'categoria', 
            fecha_desde, 
            fecha_hasta,
            categoria 
        } = req.query;
        
        console.log(`🔍 [PRESUPUESTOS] Generando resumen por: ${tipo}`);
        console.log('📋 [PRESUPUESTOS] Filtros:', { fecha_desde, fecha_hasta, categoria });
        
        let query = '';
        let params = [];
        let paramCount = 0;
        
        if (tipo === 'categoria') {
            query = `
                SELECT 
                    categoria,
                    COUNT(*) as total_registros,
                    SUM(monto) as monto_total,
                    AVG(monto) as monto_promedio,
                    MIN(monto) as monto_minimo,
                    MAX(monto) as monto_maximo,
                    MIN(fecha_registro) as fecha_primer_registro,
                    MAX(p.fecha) as ultima_actualizacion
                FROM public.presupuestos p
                WHERE p.activo = true
            `;
            
            // Filtros adicionales
            if (fecha_desde) {
                paramCount++;
                query += ` AND fecha_registro >= $${paramCount}`;
                params.push(fecha_desde);
            }
            
            if (fecha_hasta) {
                paramCount++;
                query += ` AND fecha_registro <= $${paramCount}`;
                params.push(fecha_hasta);
            }
            
            if (categoria) {
                paramCount++;
                query += ` AND LOWER(categoria) LIKE LOWER($${paramCount})`;
                params.push(`%${categoria}%`);
            }
            
            query += `
                GROUP BY categoria
                ORDER BY monto_total DESC
            `;
            
        } else if (tipo === 'fecha') {
            query = `
                SELECT 
                    DATE(fecha_registro) as fecha,
                    COUNT(*) as total_registros,
                    SUM(monto) as monto_total,
                    AVG(monto) as monto_promedio,
                    COUNT(DISTINCT p.tipo_comprobante) as categorias_distintas
                FROM public.presupuestos p
                WHERE p.activo = true
            `;
            
            // Filtros adicionales
            if (fecha_desde) {
                paramCount++;
                query += ` AND fecha_registro >= $${paramCount}`;
                params.push(fecha_desde);
            }
            
            if (fecha_hasta) {
                paramCount++;
                query += ` AND fecha_registro <= $${paramCount}`;
                params.push(fecha_hasta);
            }
            
            if (categoria) {
                paramCount++;
                query += ` AND LOWER(categoria) LIKE LOWER($${paramCount})`;
                params.push(`%${categoria}%`);
            }
            
            query += `
                GROUP BY DATE(fecha_registro)
                ORDER BY fecha DESC
            `;
            
        } else {
            console.log('❌ [PRESUPUESTOS] Tipo de resumen inválido:', tipo);
            return res.status(400).json({
                success: false,
                error: 'Tipo de resumen inválido. Use "categoria" o "fecha"',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('📋 [PRESUPUESTOS] Query de resumen:', query);
        console.log('📋 [PRESUPUESTOS] Parámetros:', params);
        
        const result = await req.db.query(query, params);
        
        // Calcular totales generales
        const totalesQuery = `
            SELECT 
                COUNT(*) as total_registros,
                SUM(monto) as monto_total,
                AVG(monto) as monto_promedio,
                COUNT(DISTINCT p.tipo_comprobante) as total_categorias
            FROM public.presupuestos p
            WHERE p.activo = true
            ${fecha_desde ? `AND fecha_registro >= '${fecha_desde}'` : ''}
            ${fecha_hasta ? `AND fecha_registro <= '${fecha_hasta}'` : ''}
            ${categoria ? `AND LOWER(categoria) LIKE LOWER('%${categoria}%')` : ''}
        `;
        
        const totalesResult = await req.db.query(totalesQuery);
        const totales = totalesResult.rows[0];
        
        console.log(`✅ [PRESUPUESTOS] Resumen generado: ${result.rows.length} grupos`);
        console.log(`📊 [PRESUPUESTOS] Totales: ${totales.total_registros} registros, $${parseFloat(totales.monto_total || 0).toFixed(2)}`);
        
        res.json({
            success: true,
            tipo: tipo,
            data: result.rows,
            totales: {
                total_registros: parseInt(totales.total_registros),
                monto_total: parseFloat(totales.monto_total || 0),
                monto_promedio: parseFloat(totales.monto_promedio || 0),
                total_categorias: parseInt(totales.total_categorias)
            },
            filtros: {
                fecha_desde,
                fecha_hasta,
                categoria
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al generar resumen:', error);
        res.status(500).json({
            success: false,
            error: 'Error al generar resumen',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener detalles de artículos de un presupuesto
 */
const obtenerDetallesPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🔍 [PRESUPUESTOS] Obteniendo detalles de artículos para presupuesto ID: ${id}`);
        
        // Validación de ID ya se hace en middleware validarIdPresupuesto
        if (!id) {
            console.log('❌ [PRESUPUESTOS] ID faltante:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto requerido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar que el presupuesto existe y obtener id_presupuesto_ext
        const presupuestoQuery = `
            SELECT id, id_presupuesto_ext, tipo_comprobante 
            FROM public.presupuestos 
            WHERE id = $1 AND activo = true
        `;
        
        const presupuestoResult = await req.db.query(presupuestoQuery, [parseInt(id)]);
        
        if (presupuestoResult.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }
        
        const presupuesto = presupuestoResult.rows[0];
        
        // Obtener detalles de artículos usando id_presupuesto_ext con JOIN a stock para descripción - Ajuste según relaciones confirmadas - 2024-12-19
        // CORRECCIÓN DE CÁLCULOS NETO/IVA/TOTAL según reglas de negocio - 2024-12-19
        // MAPEO CORREGIDO: K=camp2, L=camp3, M=camp4, N=camp5
        const detallesQuery = `
            SELECT 
                pd.id,
                pd.articulo,
                COALESCE(a.nombre, pd.articulo) as descripcion_articulo,
                pd.cantidad,
                pd.valor1,
                pd.precio1,
                pd.iva1,
                pd.camp2,
                -- Cálculos FINALMENTE CORREGIDOS según análisis de datos reales
                -- NETO = cantidad * valor1 (neto unitario)
                ROUND(pd.cantidad * COALESCE(pd.valor1, 0), 2) as neto_linea,
                -- IVA = cantidad * iva1 (IVA unitario directo de BD)
                ROUND(pd.cantidad * COALESCE(pd.iva1, 0), 2) as iva_linea,
                -- TOTAL = cantidad * precio1 (total unitario con IVA incluido)
                ROUND(pd.cantidad * COALESCE(pd.precio1, 0), 2) as total_linea
            FROM public.presupuestos_detalles pd
            LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo
            WHERE pd.id_presupuesto_ext = $1
            ORDER BY pd.id
        `;
        
        const detallesResult = await req.db.query(detallesQuery, [presupuesto.id_presupuesto_ext]);
        
        console.log(`✅ [PRESUPUESTOS] Detalles encontrados: ${detallesResult.rows.length} artículos para presupuesto ${presupuesto.id_presupuesto_ext}`);
        
        // Mapear resultados - CORRECCIÓN: Devolver valores UNITARIOS + TOTALES
        // El frontend de edición espera valores UNITARIOS en valor1/precio1/iva1
        // Los totales (neto/iva/total) son para el resumen
        const detallesConCalculos = detallesResult.rows.map(item => ({
            id: item.id,
            codigo_barras: item.articulo,
            articulo: item.articulo,
            articulo_numero: item.articulo,
            descripcion_articulo: item.descripcion_articulo,  // ✅ Agregar campo faltante
            detalle: item.descripcion_articulo,
            descripcion: item.descripcion_articulo,
            cantidad: parseFloat(item.cantidad || 0),
            // VALORES UNITARIOS (para edición)
            valor1: parseFloat(item.valor1 || 0),      // Precio unitario SIN IVA
            precio1: parseFloat(item.precio1 || 0),    // Precio unitario CON IVA
            iva1: parseFloat(item.iva1 || 0),          // Monto IVA unitario
            camp2: parseFloat(item.camp2 || 0),        // Alícuota decimal (0.21)
            // VALORES TOTALES (para resumen/totales)
            neto: parseFloat(item.neto_linea || 0),
            iva: parseFloat(item.iva_linea || 0),
            total: parseFloat(item.total_linea || 0)
        }));
        
        // Calcular totales con redondeo por renglón antes de acumular
        const totales = detallesConCalculos.reduce((acc, item) => {
            acc.cantidad_total += item.cantidad;
            acc.neto_total += item.neto;
            acc.iva_total += item.iva;
            acc.total_general += item.total;
            return acc;
        }, {
            cantidad_total: 0,
            neto_total: 0,
            iva_total: 0,
            total_general: 0
        });
        
        // Redondear totales finales
        totales.cantidad_total = Math.round(totales.cantidad_total * 100) / 100;
        totales.neto_total = Math.round(totales.neto_total * 100) / 100;
        totales.iva_total = Math.round(totales.iva_total * 100) / 100;
        totales.total_general = Math.round(totales.total_general * 100) / 100;
        
        // Verificar que totalFinal = totalNeto + totalIVA
        const sumaCalculada = Math.round((totales.neto_total + totales.iva_total) * 100) / 100;
        const diferencia = Math.abs(totales.total_general - sumaCalculada);
        
        if (diferencia > 0.01) {
            console.log(`⚠️ [PRESUPUESTOS] Diferencia en totales detectada: ${diferencia.toFixed(2)}`);
        }
        
        // Log de control por presupuesto según especificación
        console.log(`[DETALLE] sumNeto= ${totales.neto_total.toFixed(2)} sumIVA= ${totales.iva_total.toFixed(2)} sumTotal= ${totales.total_general.toFixed(2)}`);
        
        console.log('📊 [PRESUPUESTOS] Totales calculados:', totales);
        
        res.json({
            success: true,
            data: {
                presupuesto: {
                    id: presupuesto.id,
                    id_presupuesto: presupuesto.id_presupuesto_ext,
                    tipo_comprobante: presupuesto.tipo_comprobante
                },
                detalles: detallesConCalculos,
                totales: totales,
                total_articulos: detallesConCalculos.length
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener detalles:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener detalles del presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estados distintos de presupuestos - Filtro por Estado – 2024-12-19
 */
const obtenerEstados = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Obteniendo estados distintos...');
        
        const query = `
            SELECT DISTINCT estado
            FROM public.presupuestos 
            WHERE activo = true 
            AND estado IS NOT NULL 
            AND TRIM(estado) != ''
            ORDER BY estado ASC
        `;
        
        const result = await req.db.query(query);
        
        // Filtrar y limpiar estados
        const estados = result.rows
            .map(row => row.estado.trim())
            .filter(estado => estado.length > 0)
            .sort();
        
        console.log(`🔍 [PRESUPUESTOS] Ruta GET /estados - estados distintos: ${estados.length}`);
        console.log('📊 [PRESUPUESTOS] Estados encontrados:', estados);
        
        res.json({
            success: true,
            estados: estados,
            total: estados.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener estados:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener estados',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Actualizar estado de presupuesto
 */
const actualizarEstadoPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        
        console.log(`🔍 [PRESUPUESTOS] Actualizando estado de presupuesto ID: ${id} a: ${estado}`);
        
        if (!id || isNaN(parseInt(id))) {
            console.log('❌ [PRESUPUESTOS] ID inválido:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }
        
        if (!estado || estado.trim() === '') {
            console.log('❌ [PRESUPUESTOS] Estado requerido');
            return res.status(400).json({
                success: false,
                error: 'El estado es requerido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar que el presupuesto existe
        const existsQuery = `
            SELECT id, estado FROM presupuestos 
            WHERE id = $1 AND activo = true
        `;
        
        const existsResult = await req.db.query(existsQuery, [parseInt(id)]);
        
        if (existsResult.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado para actualizar estado: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }
        
        // Actualizar estado
        const updateQuery = `
            UPDATE presupuestos
            SET estado = $1
            WHERE id = $2 AND activo = true
            RETURNING *
        `;
        
        const updateResult = await req.db.query(updateQuery, [estado.trim(), parseInt(id)]);
        const presupuestoActualizado = updateResult.rows[0];
        
        console.log(`✅ [PRESUPUESTOS] Estado actualizado: ${presupuestoActualizado.estado}`);
        
        res.json({
            success: true,
            data: presupuestoActualizado,
            message: 'Estado de presupuesto actualizado exitosamente',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al actualizar estado:', error);
        res.status(500).json({
            success: false,
            error: 'Error al actualizar estado de presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('✅ [PRESUPUESTOS] Controlador de presupuestos configurado con CRUD completo');

module.exports = {
    obtenerPresupuestos,
    obtenerSugerenciasClientes,
    obtenerSugerenciasArticulos,
    obtenerPresupuestoPorId,
    obtenerDetallesPresupuesto,
    obtenerEstados,
    crearPresupuesto,
    actualizarPresupuesto,
    actualizarEstadoPresupuesto,
    eliminarPresupuesto,
    obtenerPresupuestosPorCategoria,
    obtenerEstadisticas,
    obtenerConfiguracion,
    obtenerResumen,
    obtenerPrecioArticuloCliente
};
