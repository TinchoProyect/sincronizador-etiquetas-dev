console.log('🔍 [PRESUPUESTOS] Configurando middleware de validación...');

/**
 * Helpers de normalización
 */
const toStr = (v) => (v === undefined || v === null) ? '' : String(v);
const isYYYYMMDD = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return NaN;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Sanitizar datos de entrada (body + query)
 */
const sanitizarDatos = (req, res, next) => {
  try {
    // Body
    if (req.body && typeof req.body === 'object') {
      // Campos de encabezado
      if (req.body.id_cliente !== undefined) {
        req.body.id_cliente = toStr(req.body.id_cliente).trim();
      }
      if (req.body.agente !== undefined) {
        req.body.agente = toStr(req.body.agente).trim();
      }
      if (req.body.tipo_comprobante !== undefined) {
        req.body.tipo_comprobante = toStr(req.body.tipo_comprobante).trim();
      }
      if (req.body.punto_entrega !== undefined) {
        req.body.punto_entrega = toStr(req.body.punto_entrega).trim();
      }
      if (req.body.nota !== undefined) {
        req.body.nota = toStr(req.body.nota).trim();
      }
      if (req.body.fecha !== undefined) {
        req.body.fecha = toStr(req.body.fecha).trim();
      }
      if (req.body.fecha_entrega !== undefined) {
        req.body.fecha_entrega = toStr(req.body.fecha_entrega).trim();
      }
      if (req.body.descuento !== undefined) {
        const d = toNum(req.body.descuento);
        req.body.descuento = Number.isFinite(d) ? d : req.body.descuento;
      }

      // Detalles
      if (Array.isArray(req.body.detalles)) {
        req.body.detalles = req.body.detalles.map((it) => {
          const item = { ...it };
          if (item.articulo !== undefined) item.articulo = toStr(item.articulo).trim();
          if (item.cantidad !== undefined) {
            const n = toNum(item.cantidad);
            item.cantidad = Number.isFinite(n) ? n : item.cantidad;
          }
          if (item.valor1 !== undefined) {
            const n = toNum(item.valor1);
            item.valor1 = Number.isFinite(n) ? n : item.valor1;
          }
          if (item.precio1 !== undefined) {
            const n = toNum(item.precio1);
            item.precio1 = Number.isFinite(n) ? n : item.precio1;
          }
          if (item.iva1 !== undefined) {
            const n = toNum(item.iva1);
            item.iva1 = Number.isFinite(n) ? n : item.iva1;
          }
          // Campos opcionales: diferencia, camp1..camp6
          ['diferencia','camp1','camp2','camp3','camp4','camp5','camp6'].forEach((k) => {
            if (item[k] !== undefined) {
              const n = toNum(item[k]);
              item[k] = Number.isFinite(n) ? n : item[k];
            }
          });
          return item;
        });
      }
    }

    // Query
    if (req.query && typeof req.query === 'object') {
      if (req.query.limit !== undefined) req.query.limit = parseInt(req.query.limit, 10);
      if (req.query.offset !== undefined) req.query.offset = parseInt(req.query.offset, 10);
      ['estado','agente','order_by','order_dir'].forEach((k) => {
        if (req.query[k] !== undefined) req.query[k] = toStr(req.query[k]).trim();
      });
      ['fecha_desde','fecha_hasta'].forEach((k) => {
        if (req.query[k] !== undefined) req.query[k] = toStr(req.query[k]).trim();
      });
      if (req.query.id_cliente !== undefined) {
        req.query.id_cliente = toStr(req.query.id_cliente).trim();
      }
    }

    console.log('✅ [PRESUPUESTOS] Datos sanitizados');
    next();
  } catch (e) {
    console.error('❌ [PRESUPUESTOS] Error sanitizando datos:', e.message);
    res.status(400).json({
      success: false,
      error: 'Error sanitizando datos de entrada',
      message: e.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Validar datos para crear presupuesto (validación LIGHT, a prueba de cuelgues)
 * Requerido: id_cliente (string/num no vacío), detalles (array con al menos 1 item)
 * Para cada detalle: articulo (string no vacío), cantidad (>0)
 * Campos opcionales no bloquean (agente, fechas, etc.)
 */
const validarCrearPresupuesto = (req, res, next) => {
  console.log('🔍 [PRESUPUESTOS] Validando datos para crear presupuesto...');
  try {
    const {
      id_cliente,
      fecha,
      fecha_entrega,
      agente,            // opcional
      tipo_comprobante,  // opcional
      punto_entrega,     // opcional
      descuento,         // opcional (0..100)
      nota,              // opcional
      detalles,
    } = req.body || {};

    const errores = [];

    // id_cliente (requerido)
    if (id_cliente === undefined || id_cliente === null || String(id_cliente).trim() === '') {
      errores.push("El campo 'id_cliente' es obligatorio.");
    }

    // fechas (opcionales, si vienen deben ser YYYY-MM-DD válidas)
    if (fecha && !isYYYYMMDD(String(fecha))) {
      errores.push("El campo 'fecha' debe tener formato YYYY-MM-DD.");
    }
    if (fecha_entrega && !isYYYYMMDD(String(fecha_entrega))) {
      errores.push("El campo 'fecha_entrega' debe tener formato YYYY-MM-DD.");
    }

    // descuento (opcional 0..100)
    if (descuento !== undefined && descuento !== null && descuento !== '') {
      const d = toNum(descuento);
      if (!Number.isFinite(d)) {
        errores.push("El campo 'descuento' debe ser numérico.");
      } else if (d < 0 || d > 100) {
        errores.push("El campo 'descuento' debe estar entre 0 y 100.");
      }
    }

    // agente (opcional, si viene debe ser string razonable)
    if (agente !== undefined && agente !== null && agente !== '') {
      if (typeof agente !== 'string') {
        errores.push("El campo 'agente' debe ser texto.");
      } else if (agente.length > 100) {
        errores.push("El campo 'agente' no puede exceder 100 caracteres.");
      }
    }

    // tipo_comprobante / punto_entrega / nota (opcionales: solo chequear tipo si vienen)
    [['tipo_comprobante', tipo_comprobante], ['punto_entrega', punto_entrega], ['nota', nota]].forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '' && typeof v !== 'string') {
        errores.push(`El campo '${k}' debe ser texto.`);
      }
    });

    // detalles (requerido: array con al menos 1)
    if (!Array.isArray(detalles) || detalles.length === 0) {
      errores.push("Debe enviar al menos un ítem en 'detalles'.");
    } else {
      detalles.forEach((item, idx) => {
        const prefix = `Detalle #${idx + 1}:`;
        if (!item || typeof item !== 'object') {
          errores.push(`${prefix} Formato inválido.`);
          return;
        }
        // articulo (string no vacío) — acá llega el código de barras
        if (item.articulo === undefined || item.articulo === null || String(item.articulo).trim() === '') {
          errores.push(`${prefix} El campo 'articulo' es obligatorio.`);
        }
        // cantidad (>0)
        const cant = toNum(item.cantidad);
        if (!Number.isFinite(cant) || cant <= 0) {
          errores.push(`${prefix} 'cantidad' debe ser un número > 0.`);
        }
        // valor1 / iva1 / precio1 (opcionales, si vienen deben ser numéricos)
        ['valor1','iva1','precio1'].forEach((k) => {
          if (item[k] !== undefined && item[k] !== null && item[k] !== '') {
            const n = toNum(item[k]);
            if (!Number.isFinite(n)) {
              errores.push(`${prefix} '${k}' debe ser numérico.`);
            }
          }
        });
      });
    }

    if (errores.length > 0) {
      console.log('❌ [PRESUPUESTOS] Errores de validación:', errores);
      return res.status(400).json({
        success: false,
        error: 'Datos de entrada inválidos para crear presupuesto',
        errores,
        timestamp: new Date().toISOString(),
      });
    }

    console.log('✅ [PRESUPUESTOS] Validación de creación exitosa');
    return next();
  } catch (e) {
    console.error('❌ [PRESUPUESTOS] Excepción durante validación de creación:', e);
    return res.status(400).json({
      success: false,
      error: 'Error validando datos de creación',
      message: e.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Validar datos para actualizar presupuesto (PATCH/PUT)
 * Campos permitidos: agente, nota, punto_entrega, descuento, fecha_entrega, detalles, tipo_comprobante, estado, id_cliente, fecha
 */
const validarActualizarPresupuesto = (req, res, next) => {
  console.log('🔍 [PRESUPUESTOS] Validando datos para actualizar presupuesto...');
  try {
    // CORREGIDO: Agregados campos faltantes del encabezado
    const allow = [
      'agente', 
      'nota', 
      'punto_entrega', 
      'descuento', 
      'fecha_entrega', 
      'detalles',
      // NUEVOS: Campos del encabezado que faltaban
      'tipo_comprobante',
      'estado',
      'id_cliente',
      'fecha',
      'secuencia',  // Campo de secuencia agregado
      
      // NUEVOS FASE LOGÍSTICA/MOVIL: Integración de variables tácticas
      'estado_logistico',
      'informe_generado',
      'origen_facturacion',
      'origen_punto_venta',
      'origen_numero_factura',
      'metodo_retiro',
      'detalles_sin_stock'
    ];
    const body = req.body || {};
    const keys = Object.keys(body);
    const errores = [];

    if (keys.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No hay campos para actualizar',
        timestamp: new Date().toISOString(),
      });
    }

    // Solo permitir campos válidos
    const invalid = keys.filter(k => !allow.includes(k));
    if (invalid.length > 0) {
      errores.push(`Campos no permitidos: ${invalid.join(', ')}`);
    }

    // Validaciones light de campos existentes
    if (body.agente !== undefined && body.agente !== null && body.agente !== '') {
      if (typeof body.agente !== 'string') errores.push("El campo 'agente' debe ser texto.");
      else if (body.agente.length > 100) errores.push("El campo 'agente' no puede exceder 100 caracteres.");
    }
    if (body.nota !== undefined && body.nota !== null && typeof body.nota !== 'string') {
      errores.push("El campo 'nota' debe ser texto.");
    }
    if (body.punto_entrega !== undefined && body.punto_entrega !== null && typeof body.punto_entrega !== 'string') {
      errores.push("El campo 'punto_entrega' debe ser texto.");
    }
    if (body.descuento !== undefined && body.descuento !== null && body.descuento !== '') {
      const d = toNum(body.descuento);
      if (!Number.isFinite(d)) errores.push("El campo 'descuento' debe ser numérico.");
      else if (d < 0 || d > 100) errores.push("El descuento debe estar entre 0 y 100.");
    }
    if (body.fecha_entrega !== undefined && body.fecha_entrega !== null && body.fecha_entrega !== '') {
      if (!isYYYYMMDD(String(body.fecha_entrega))) {
        errores.push("El campo 'fecha_entrega' debe tener formato YYYY-MM-DD.");
      }
    }

    // NUEVAS VALIDACIONES: Campos del encabezado que faltaban
    if (body.tipo_comprobante !== undefined && body.tipo_comprobante !== null && body.tipo_comprobante !== '') {
      if (typeof body.tipo_comprobante !== 'string') {
        errores.push("El campo 'tipo_comprobante' debe ser texto.");
      } else if (body.tipo_comprobante.length > 50) {
        errores.push("El campo 'tipo_comprobante' no puede exceder 50 caracteres.");
      }
    }

    if (body.estado !== undefined && body.estado !== null && body.estado !== '') {
      if (typeof body.estado !== 'string') {
        errores.push("El campo 'estado' debe ser texto.");
      } else if (body.estado.length > 50) {
        errores.push("El campo 'estado' no puede exceder 50 caracteres.");
      }
    }

    if (body.id_cliente !== undefined && body.id_cliente !== null && body.id_cliente !== '') {
      const idClienteStr = String(body.id_cliente).trim();
      if (idClienteStr === '') {
        errores.push("El campo 'id_cliente' no puede estar vacío.");
      }
    }

    if (body.fecha !== undefined && body.fecha !== null && body.fecha !== '') {
      if (!isYYYYMMDD(String(body.fecha))) {
        errores.push("El campo 'fecha' debe tener formato YYYY-MM-DD.");
      }
    }

    // Validar detalles (opcional)
    if (body.detalles !== undefined) {
      if (!Array.isArray(body.detalles)) {
        errores.push("El campo 'detalles' debe ser un array.");
      } else {
        body.detalles.forEach((item, idx) => {
          const prefix = `Detalle #${idx + 1}:`;
          if (!item || typeof item !== 'object') {
            errores.push(`${prefix} Formato inválido.`);
            return;
          }
          
          // articulo: string no vacío (código de barras, trim)
          if (item.articulo === undefined || item.articulo === null || String(item.articulo).trim() === '') {
            errores.push(`${prefix} El campo 'articulo' es obligatorio.`);
          }
          
          // cantidad: número finito ≥ 0
          const cant = toNum(item.cantidad);
          if (!Number.isFinite(cant) || cant < 0) {
            errores.push(`${prefix} 'cantidad' debe ser un número ≥ 0.`);
          }
          
          // valor1: número finito ≥ 0 (neto unitario)
          const valor1 = toNum(item.valor1);
          if (!Number.isFinite(valor1) || valor1 < 0) {
            errores.push(`${prefix} 'valor1' debe ser un número ≥ 0.`);
          }
          
          // iva1: número finito en % o decimal (0–100 o 0–1)
          const iva1 = toNum(item.iva1);
          if (!Number.isFinite(iva1) || iva1 < 0 || iva1 > 100) {
            errores.push(`${prefix} 'iva1' debe ser un número entre 0 y 100.`);
          }
        });
      }
    }

    // Validar detalles sin stock (opcional)
    if (body.detalles_sin_stock !== undefined) {
      if (!Array.isArray(body.detalles_sin_stock)) {
        errores.push("El campo 'detalles_sin_stock' debe ser un array.");
      } else {
        body.detalles_sin_stock.forEach((item, idx) => {
          const prefix = `Faltante #${idx + 1}:`;
          if (!item || typeof item !== 'object') {
            errores.push(`${prefix} Formato inválido.`);
            return;
          }
          if (item.articulo === undefined || item.articulo === null || String(item.articulo).trim() === '') {
            errores.push(`${prefix} El campo 'articulo' es obligatorio.`);
          }
          const cant = toNum(item.cantidad);
          if (!Number.isFinite(cant) || cant < 0) {
            errores.push(`${prefix} 'cantidad' debe ser un número ≥ 0.`);
          }
        });
      }
    }

    if (errores.length > 0) {
      console.warn('[VALIDATION-UPDATE] errores:', errores);
      return res.status(400).json({
        success: false,
        error: 'Datos de entrada inválidos para actualizar presupuesto',
        errores,
        timestamp: new Date().toISOString(),
      });
    }

    console.log('✅ [PRESUPUESTOS] Validación de actualización exitosa');
    return next();
  } catch (e) {
    console.error('❌ [PRESUPUESTOS] Excepción durante validación de actualización:', e);
    return res.status(400).json({
      success: false,
      error: 'Error validando datos de actualización',
      message: e.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Validar ID de presupuesto en params
 * Acepta tanto IDs numéricos (enteros positivos) como IDs externos (strings)
 */
const validarIdPresupuesto = (req, res, next) => {
  console.log('🔍 [PRESUPUESTOS] Validando ID de presupuesto...');
  try {
    const { id } = req.params || {};
    if (!id && id !== 0) {
      return res.status(400).json({
        success: false,
        error: 'ID de presupuesto requerido',
        timestamp: new Date().toISOString(),
      });
    }

    // Convertir a string para validaciones
    const idStr = String(id).trim();
    
    // Validar que no esté vacío
    if (idStr === '') {
      return res.status(400).json({
        success: false,
        error: 'ID de presupuesto no puede estar vacío',
        timestamp: new Date().toISOString(),
      });
    }

    // Si es numérico, validar como entero positivo
    const n = parseInt(idStr, 10);
    if (Number.isFinite(n) && n > 0 && idStr === String(n)) {
      // Es un ID numérico válido
      req.params.id = n;
      console.log(`✅ [PRESUPUESTOS] ID numérico válido: ${n}`);
      return next();
    }

    // Si no es numérico, validar como ID externo (string)
    // Los IDs externos pueden contener letras, números y guiones
    if (/^[a-zA-Z0-9\-_]+$/.test(idStr) && idStr.length >= 1 && idStr.length <= 50) {
      // Es un ID externo válido
      req.params.id = idStr;
      console.log(`✅ [PRESUPUESTOS] ID externo válido: ${idStr}`);
      return next();
    }

    // Si llegamos aquí, el ID no es válido
    return res.status(400).json({
      success: false,
      error: 'ID de presupuesto debe ser un entero positivo o un ID externo válido (alfanumérico, guiones y guiones bajos, 1-50 caracteres)',
      timestamp: new Date().toISOString(),
    });

  } catch (e) {
    console.error('❌ [PRESUPUESTOS] Excepción validando ID:', e);
    return res.status(400).json({
      success: false,
      error: 'Error validando ID de presupuesto',
      message: e.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Validar filtros (GET list)
 */
const validarFiltros = (req, res, next) => {
  console.log('🔍 [PRESUPUESTOS] Validando filtros de consulta...');
  try {
    const q = req.query || {};
    const errores = [];

    if (q.limit !== undefined) {
      const n = parseInt(q.limit, 10);
      if (!Number.isFinite(n) || n <= 0 || n > 1000) {
        errores.push('El límite debe ser un número entre 1 y 1000');
      }
    }
    if (q.offset !== undefined) {
      const n = parseInt(q.offset, 10);
      if (!Number.isFinite(n) || n < 0) {
        errores.push('El offset debe ser un número mayor o igual a 0');
      }
    }
    if (q.fecha_desde && !isYYYYMMDD(String(q.fecha_desde))) {
      errores.push('La fecha desde debe ser YYYY-MM-DD');
    }
    if (q.fecha_hasta && !isYYYYMMDD(String(q.fecha_hasta))) {
      errores.push('La fecha hasta debe ser YYYY-MM-DD');
    }
    if (q.fecha_desde && q.fecha_hasta) {
      const d = new Date(q.fecha_desde);
      const h = new Date(q.fecha_hasta);
      if (d > h) errores.push('La fecha desde debe ser anterior o igual a la fecha hasta');
    }
    if (q.order_dir && !['ASC','DESC','asc','desc'].includes(String(q.order_dir))) {
      errores.push('La dirección de ordenamiento debe ser ASC o DESC');
    }
    // Dejamos order_by abierto a campos típicos del módulo
    if (q.order_by) {
      const allowed = ['fecha','estado','fecha_actualizacion','id_cliente','agente','id'];
      if (!allowed.includes(String(q.order_by))) {
        errores.push(`order_by debe ser uno de: ${allowed.join(', ')}`);
      }
    }

    if (errores.length > 0) {
      console.log('❌ [PRESUPUESTOS] Errores de validación de filtros:', errores);
      return res.status(400).json({
        success: false,
        error: 'Parámetros de filtrado inválidos',
        errores,
        timestamp: new Date().toISOString(),
      });
    }

    console.log('✅ [PRESUPUESTOS] Validación de filtros exitosa');
    return next();
  } catch (e) {
    console.error('❌ [PRESUPUESTOS] Excepción validando filtros:', e);
    return res.status(400).json({
      success: false,
      error: 'Error validando filtros',
      message: e.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Validar parámetros de resumen (si existiera un endpoint de resumen)
 * Mantener light para no bloquear.
 */
const validarResumen = (req, res, next) => {
  console.log('🔍 [PRESUPUESTOS] Validando parámetros de resumen...');
  try {
    const { tipo, fecha_desde, fecha_hasta } = req.query || {};
    const errores = [];

    if (tipo && !['categoria', 'fecha'].includes(tipo)) {
      errores.push('El tipo de resumen debe ser "categoria" o "fecha"');
    }
    if (fecha_desde && !isYYYYMMDD(String(fecha_desde))) {
      errores.push('La fecha desde debe ser YYYY-MM-DD');
    }
    if (fecha_hasta && !isYYYYMMDD(String(fecha_hasta))) {
      errores.push('La fecha hasta debe ser YYYY-MM-DD');
    }
    if (fecha_desde && fecha_hasta) {
      const d = new Date(fecha_desde);
      const h = new Date(fecha_hasta);
      if (d > h) errores.push('La fecha desde debe ser anterior o igual a la fecha hasta');
    }

    if (errores.length > 0) {
      console.log('❌ [PRESUPUESTOS] Errores de validación de resumen:', errores);
      return res.status(400).json({
        success: false,
        error: 'Parámetros de resumen inválidos',
        errores,
        timestamp: new Date().toISOString(),
      });
    }

    console.log('✅ [PRESUPUESTOS] Validación de resumen exitosa');
    return next();
  } catch (e) {
    console.error('❌ [PRESUPUESTOS] Excepción validando resumen:', e);
    return res.status(400).json({
      success: false,
      error: 'Error validando parámetros de resumen',
      message: e.message,
      timestamp: new Date().toISOString(),
    });
  }
};

console.log('✅ [PRESUPUESTOS] Middleware de validación configurado');

module.exports = {
  sanitizarDatos,
  validarCrearPresupuesto,
  validarActualizarPresupuesto,
  validarIdPresupuesto,
  validarFiltros,
  validarResumen,
};
