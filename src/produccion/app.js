require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { createProxyMiddleware } = require('http-proxy-middleware');
const produccionRoutes = require('./routes/produccion');
const usuariosRoutes = require('../usuarios/rutas');


const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});


// Almacén de sesiones de inventario activas
const inventarioSesiones = new Map();

// ✅ Middleware para interpretar JSON en los requests
// NOTA: El proxy debe ir ANTES del body parser para que funcione correctamente el stream
app.use('/api/presupuestos', createProxyMiddleware({
    target: 'http://127.0.0.1:3003/api/presupuestos',
    changeOrigin: true,
    logLevel: 'debug'
}));

// Proxy hacia el módulo de logística
app.use('/api/logistica', createProxyMiddleware({
    target: 'http://127.0.0.1:3005/api/logistica',
    changeOrigin: true,
    logLevel: 'debug'
}));

app.use(express.json());

//Temporizacion -Mari
const tiemposRouter = require('./routes/tiemposCarro');
app.use('/api/tiempos', tiemposRouter);
app.use('/api/produccion', produccionRoutes);

// ✅ PROXY A SUPABASE (BYPASS DE CORS)
// Para que el frontend pueda leer los datos sin que Supabase rechace el Personal Access Token (sb_secret)
app.get('/api/supabase/lotes', async (req, res) => {
    try {
        const url = 'https://wofttcnpipozwupmpuul.supabase.co/rest/v1/recepciones_fisicas_items?select=id,cantidad_recibida,cantidad_esperada,recepciones_fisicas_cabecera(id,fecha_recepcion,numero_remito,pedido_id,estado,pedidos_b2b_cabecera(id,proveedor_id,proveedores(id,nombre))),pedidos_b2b_items(id,producto_codigo,producto_descripcion,unidad_ref,valor_unitario_ref)&order=created_at.desc&limit=100';
        const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
        const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(await response.text());
        const lotes = await response.json();
        
        // Extraer IDs únicos de proveedores y pedidos
        const proveedoresIds = [...new Set(lotes.map(l => l.recepciones_fisicas_cabecera?.pedidos_b2b_cabecera?.proveedor_id).filter(Boolean))];
        const pedidosIds = [...new Set(lotes.map(l => l.recepciones_fisicas_cabecera?.pedido_id).filter(Boolean))];
        
        // 1. Obtener Tabla Maestra para cant_bult y cant_valor (Paginación en Bucle para evitar límite de 1000 de Supabase)
        let masterMap = {};
        if (proveedoresIds.length > 0) {
            let masterData = [];
            let offset = 0;
            let hasMore = true;
            while (hasMore) {
                const masterUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=datos_maestros&proveedor_id=in.(${proveedoresIds.join(',')})&limit=1000&offset=${offset}`;
                const masterRes = await fetch(masterUrl, { headers });
                if (masterRes.ok) {
                    const rows = await masterRes.json();
                    masterData = masterData.concat(rows);
                    if (rows.length < 1000) {
                        hasMore = false;
                    } else {
                        offset += 1000;
                    }
                } else {
                    hasMore = false;
                }
            }

            masterData.forEach(row => {
                if (row.datos_maestros && row.datos_maestros.codigo) {
                    const cod = String(row.datos_maestros.codigo).trim().toLowerCase();
                    masterMap[cod] = {
                        cantBult: row.datos_maestros.cant_bult,
                        cantValor: row.datos_maestros.cant_valor,
                        iva: row.datos_maestros.iva || row.datos_maestros.IVA || null
                    };
                }
            });
        }
        
        // 2. Obtener Facturas para IVA Real (Heurística de Alícuotas)
        let facturasMap = {};
        if (pedidosIds.length > 0) {
            const facturasUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/facturas_raw?select=pedido_b2b_id,importe_iva_21,importe_iva_105,match_report&pedido_b2b_id=in.(${pedidosIds.join(',')})`;
            const facturasRes = await fetch(facturasUrl, { headers });
            if (facturasRes.ok) {
                const facturasData = await facturasRes.json();
                facturasData.forEach(fac => {
                    if (fac.pedido_b2b_id && fac.match_report) {
                        const i21 = Number(fac.importe_iva_21) || 0;
                        const i105 = Number(fac.importe_iva_105) || 0;
                        
                        let ivaBase = null;
                        // Motor Heurístico:
                        if (i21 === 0 && i105 === 0) ivaBase = 0;           // Factura Pura 0%
                        else if (i105 > 0 && i21 === 0) ivaBase = 10.5;     // Factura Pura 10.5%
                        else if (i21 > 0 && i105 === 0) ivaBase = 21;       // Factura Pura 21%
                        
                        if (!facturasMap[fac.pedido_b2b_id]) facturasMap[fac.pedido_b2b_id] = {};
                        
                        fac.match_report.forEach(mr => {
                            const cod = String(mr.pedido?.codigo || '').trim().toLowerCase();
                            if (cod) {
                                if (ivaBase !== null) {
                                    facturasMap[fac.pedido_b2b_id][cod] = ivaBase;
                                } else {
                                    // Factura Mixta (Fallback empírico)
                                    // Asignamos 21% como fallback de seguridad
                                    facturasMap[fac.pedido_b2b_id][cod] = 21;
                                }
                            }
                        });
                    }
                });
            }
        }

        // 3. Deduplicación Reductora en Node.js (Agrupación por SKU)
        const uniqueMap = new Map();
        lotes.forEach(lote => {
            const cod = String(lote.pedidos_b2b_items?.producto_codigo || '').trim().toLowerCase();
            if (!cod) return;
            
            // Agrupamos por fecha (YYYY-MM-DD) y por SKU, emulando la vista vw_inventario_consolidado
            // pero reteniendo la metadata del lote físico agrupado por día.
            const fechaStr = (lote.recepciones_fisicas_cabecera?.fecha_recepcion || new Date().toISOString()).split('T')[0];
            const dedupeKey = fechaStr + '_' + cod;
            
            if (!uniqueMap.has(dedupeKey)) {
                // Clonamos para no mutar el lote original al sumar
                uniqueMap.set(dedupeKey, { ...lote });
            } else {
                const existing = uniqueMap.get(dedupeKey);
                existing.cantidad_recibida += Number(lote.cantidad_recibida);
            }
        });
        const dedupedLotes = Array.from(uniqueMap.values());

        // 4. Enriquecer los lotes consolidados
        const enrichedLotes = dedupedLotes.map(lote => {
            const item = lote.pedidos_b2b_items || {};
            const cabecera = lote.recepciones_fisicas_cabecera || {};
            const cod = String(item.producto_codigo || '').trim().toLowerCase();
            const masterInfo = masterMap[cod] || { cantBult: null, cantValor: null, iva: null };
            
            // IVA Real Inferido desde Facturas
            let ivaReal = masterInfo.iva;
            if (cabecera.pedido_id && facturasMap[cabecera.pedido_id] && facturasMap[cabecera.pedido_id][cod] !== undefined) {
                ivaReal = facturasMap[cabecera.pedido_id][cod];
            }
            
            // Contingencia Fiscal (Fallback 21% para lotes huérfanos de factura)
            if (ivaReal === null || ivaReal === undefined) {
                ivaReal = 21;
            }
            
            return {
                ...lote,
                pedidos_b2b_items: {
                    ...item,
                    cant_bult: item.cant_bult !== undefined && item.cant_bult !== null ? item.cant_bult : masterInfo.cantBult,
                    cant_valor: item.cant_valor !== undefined && item.cant_valor !== null ? item.cant_valor : masterInfo.cantValor,
                    iva_porcentaje: ivaReal
                }
            };
        });
        
        res.json(enrichedLotes);
    } catch (e) {
        console.error("Error proxy Supabase:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/supabase/lotes/:id_corto', async (req, res) => {
    try {
        const id_corto = req.params.id_corto.trim();
        // Generar rango mínimo y máximo del UUID para evitar usar ilike que falla en Postgres para tipos uuid
        const minUuid = id_corto + '-0000-0000-0000-000000000000';
        const maxUuid = id_corto + '-ffff-ffff-ffff-ffffffffffff';
        
        const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/recepciones_fisicas_items?select=id,cantidad_recibida,cantidad_esperada,recepciones_fisicas_cabecera(id,fecha_recepcion,numero_remito,pedido_id,estado,pedidos_b2b_cabecera(id,proveedor_id,proveedores(id,nombre))),pedidos_b2b_items(id,producto_codigo,producto_descripcion,unidad_ref)&id=gte.${minUuid}&id=lte.${maxUuid}&limit=1`;
        const key = process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY';
        const response = await fetch(url, { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        if (data.length > 0) {
            const lote = data[0];
            const item = lote.pedidos_b2b_items || {};
            const provId = lote.recepciones_fisicas_cabecera?.pedidos_b2b_cabecera?.proveedor_id;
            const cod = String(item.producto_codigo || '').trim().toLowerCase();
            
            let masterInfo = { cantBult: null, cantValor: null, iva: null };
            if (provId && cod) {
                const masterUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=datos_maestros&proveedor_id=eq.${provId}`;
                const masterRes = await fetch(masterUrl, { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } });
                if (masterRes.ok) {
                    const rows = await masterRes.json();
                    const matchingRow = rows.find(r => r.datos_maestros && String(r.datos_maestros.codigo).trim().toLowerCase() === cod);
                    if (matchingRow && matchingRow.datos_maestros) {
                        masterInfo = {
                            cantBult: matchingRow.datos_maestros.cant_bult,
                            cantValor: matchingRow.datos_maestros.cant_valor,
                            iva: matchingRow.datos_maestros.iva || matchingRow.datos_maestros.IVA || null
                        };
                    }
                }
            }
            
            let ivaReal = masterInfo.iva || 21;
            
            lote.pedidos_b2b_items = {
                ...item,
                cant_bult: item.cant_bult !== undefined && item.cant_bult !== null ? item.cant_bult : masterInfo.cantBult,
                cant_valor: item.cant_valor !== undefined && item.cant_valor !== null ? item.cant_valor : masterInfo.cantValor,
                iva_porcentaje: ivaReal
            };
            res.json(lote);
        } else {
            res.json(null);
        }
    } catch (e) {
        console.error("Error proxy Supabase ID:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// ✅ PROXY A SUPABASE PARA TODAS LAS OFERTAS DE REPOSICIÓN VIVAS (FASE 4 - REGISTRADO ANTES POR PRECEDENCIA DE WILDCARD)
app.get('/api/supabase/reposicion/todas', async (req, res) => {
    try {
        const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
        const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

        // Obtener hasta 1000 registros activos de la tabla maestra filtrando las bajas
        const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=id,proveedor_id,nombre_proveedor,timestamp_extraccion,datos_maestros&datos_maestros->>_estado_delta=neq.BAJA&limit=1000`;
        
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(await response.text());
        const cotizaciones = await response.json();

        if (cotizaciones.length === 0) {
            return res.json([]);
        }

        // Obtener la curaduría humana de unidades para normalizar posibles ambigüedades
        const proveedoresIds = [...new Set(cotizaciones.map(c => c.proveedor_id).filter(Boolean))];
        let excepciones = [];
        if (proveedoresIds.length > 0) {
            const excUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/curaduria_excepciones?select=proveedor_id,producto_codigo,unidad_fijada&proveedor_id=in.(${proveedoresIds.join(',')})`;
            const excRes = await fetch(excUrl, { headers });
            if (excRes.ok) {
                excepciones = await excRes.json();
            }
        }

        // Crear mapa O(N) para indexación
        const curaduriaMap = new Map();
        excepciones.forEach(exc => {
            const keyMap = `${exc.proveedor_id}_${String(exc.producto_codigo).trim().toLowerCase()}`;
            curaduriaMap.set(keyMap, exc.unidad_fijada);
        });

        // Normalizar y estructurar tarifas de forma homogénea y determinista
        const cotizacionesNormalizadas = cotizaciones.map(row => {
            const dm = { ...row.datos_maestros };
            const skuProveedorRaw = dm.codigo || dm.sku || dm.código || "";
            const skuClean = String(skuProveedorRaw).trim().toLowerCase();
            const keyMap = `${row.proveedor_id}_${skuClean}`;
            
            // Intercepción por Curaduría de Unidad
            if (curaduriaMap.has(keyMap) && curaduriaMap.get(keyMap)) {
                dm.unidad = curaduriaMap.get(keyMap);
            }
            
            // Calcular días de antigüedad del dato contra el tiempo actual (Mayo 2026)
            const fechaTarifa = new Date(dm.ultima_actualizacion_origen || row.timestamp_extraccion);
            const diasAntiguedad = Math.floor((new Date() - fechaTarifa) / (1000 * 60 * 60 * 24));
            
            // Convertir precio String Argentino a Float (ej: "3.423,77" -> 3423.77)
            let precioUnitarioVal = 0;
            if (dm.precio) {
                const cleanPrice = String(dm.precio).replace(/\./g, '').replace(',', '.');
                precioUnitarioVal = parseFloat(cleanPrice) || 0;
            }

            return {
                oferta_id: row.id,
                proveedor_id: row.proveedor_id,
                nombre_proveedor: row.nombre_proveedor,
                sku_proveedor: skuProveedorRaw,
                descripcion: dm.descripcion,
                precio_unitario: precioUnitarioVal,
                unidad_medida: dm.unidad,
                dias_antiguedad: diasAntiguedad >= 0 ? diasAntiguedad : 0,
                valido_hasta: dm.ultima_actualizacion_origen || row.timestamp_extraccion,
                rubro: dm.rubro || "",
                cant_bult: dm.cant_bult !== undefined && dm.cant_bult !== null ? dm.cant_bult : "",
                cant_valor: dm.cant_valor !== undefined && dm.cant_valor !== null ? dm.cant_valor : "",
                _estado_delta: dm._estado_delta || "INTACTO",
                _timestamp: row.timestamp_extraccion || dm.ultima_actualizacion_origen || new Date().toISOString(),
                _proveedor: row.nombre_proveedor
            };
        });

        res.json(cotizacionesNormalizadas);
    } catch (e) {
        console.error("Error en proxy de todas las ofertas de reposición:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// ✅ PROXY A SUPABASE PARA OFERTAS DE REPOSICIÓN VIVAS POR SKU (WILDCARD)
app.get('/api/supabase/reposicion/:sku', async (req, res) => {
    try {
        const sku = String(req.params.sku || '').trim().toLowerCase();
        if (!sku) {
            return res.json([]);
        }

        const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
        const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

        // 1. Obtener registros activos de la tabla maestra filtrando las bajas y filtrando por SKU
        const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=id,proveedor_id,nombre_proveedor,timestamp_extraccion,datos_maestros&datos_maestros->>_estado_delta=neq.BAJA&or=(datos_maestros->>codigo.eq.${sku},datos_maestros->>sku.eq.${sku},datos_maestros->>c\u00f3digo.eq.${sku})`;
        
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(await response.text());
        const cotizaciones = await response.json();

        if (cotizaciones.length === 0) {
            return res.json([]);
        }

        // 2. Obtener la curaduría humana de unidades para normalizar posibles ambigüedades
        const proveedoresIds = [...new Set(cotizaciones.map(c => c.proveedor_id).filter(Boolean))];
        let excepciones = [];
        if (proveedoresIds.length > 0) {
            const excUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/curaduria_excepciones?select=proveedor_id,producto_codigo,unidad_fijada&proveedor_id=in.(${proveedoresIds.join(',')})`;
            const excRes = await fetch(excUrl, { headers });
            if (excRes.ok) {
                excepciones = await excRes.json();
            }
        }

        // 3. Crear mapa O(N) para indexación
        const curaduriaMap = new Map();
        excepciones.forEach(exc => {
            const keyMap = `${exc.proveedor_id}_${String(exc.producto_codigo).trim().toLowerCase()}`;
            curaduriaMap.set(keyMap, exc.unidad_fijada);
        });

        // 4. Normalizar y estructurar tarifas de forma homogénea y determinista
        const cotizacionesNormalizadas = cotizaciones.map(row => {
            const dm = { ...row.datos_maestros };
            const skuProveedorRaw = dm.codigo || dm.sku || dm.código || "";
            const skuClean = String(skuProveedorRaw).trim().toLowerCase();
            const keyMap = `${row.proveedor_id}_${skuClean}`;
            
            // Intercepción por Curaduría de Unidad
            if (curaduriaMap.has(keyMap) && curaduriaMap.get(keyMap)) {
                dm.unidad = curaduriaMap.get(keyMap);
            }
            
            // Calcular días de antigüedad del dato contra el tiempo actual (Mayo 2026)
            const fechaTarifa = new Date(dm.ultima_actualizacion_origen || row.timestamp_extraccion);
            const diasAntiguedad = Math.floor((new Date() - fechaTarifa) / (1000 * 60 * 60 * 24));
            
            // Convertir precio String Argentino a Float (ej: "3.423,77" -> 3423.77)
            let precioUnitarioVal = 0;
            if (dm.precio) {
                const cleanPrice = String(dm.precio).replace(/\./g, '').replace(',', '.');
                precioUnitarioVal = parseFloat(cleanPrice) || 0;
            }

            return {
                oferta_id: row.id,
                proveedor_id: row.proveedor_id,
                nombre_proveedor: row.nombre_proveedor,
                sku_proveedor: skuProveedorRaw,
                descripcion: dm.descripcion,
                precio_unitario: precioUnitarioVal,
                unidad_medida: dm.unidad,
                dias_antiguedad: diasAntiguedad >= 0 ? diasAntiguedad : 0,
                valido_hasta: dm.ultima_actualizacion_origen || row.timestamp_extraccion,
                rubro: dm.rubro || "",
                cant_bult: dm.cant_bult !== undefined && dm.cant_bult !== null ? dm.cant_bult : "",
                cant_valor: dm.cant_valor !== undefined && dm.cant_valor !== null ? dm.cant_valor : "",
                _estado_delta: dm._estado_delta || "INTACTO",
                _timestamp: row.timestamp_extraccion || dm.ultima_actualizacion_origen || new Date().toISOString(),
                _proveedor: row.nombre_proveedor
            };
        });

        res.json(cotizacionesNormalizadas);
    } catch (e) {
        console.error("Error en proxy de ofertas de reposición:", e.message);
        res.status(500).json({ error: e.message });
    }
});


// Middleware para deshabilitar caché en archivos HTML y JS
app.use((req, res, next) => {
    if (req.url.endsWith('.html') || req.url.endsWith('.js') || req.url.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// Configuración de archivos estáticos y rutas base
app.use(express.static(__dirname));
app.use('/pages', express.static(path.join(__dirname, 'pages')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));


// Redirigir la raíz a la página principal de producción
app.get('/', (req, res) => {
    res.redirect('/pages/produccion.html');
});

// Endpoint para obtener la IP local del servidor
app.get('/api/config/network-ip', (req, res) => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let networkIp = 'localhost';

    // Buscar una dirección IPv4 externa
    Object.keys(interfaces).forEach((ifname) => {
        interfaces[ifname].forEach((iface) => {
            // Saltar direcciones internas (127.0.0.1) y no-IPv4
            if ('IPv4' !== iface.family || iface.internal) {
                return;
            }
            networkIp = iface.address;
        });
    });

    res.json({ ip: networkIp });
});

// Ruta para la vista móvil de inventario
app.get('/inventario-movil', (req, res) => {
    res.redirect('/pages/inventario-movil.html');
});

// Middleware para logging detallado
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

// ✅ Middleware para ajustar solo si es necesario (solo si no se rompe)
app.use('/api/produccion', produccionRoutes); // ← Registro completo sin manipular req.url

// Otras rutas de usuarios
app.use('/api', usuariosRoutes);

/**
 * CONFIGURACIÓN CORS — TOPOLOGÍA DE RED
 * Dominio externo oficial: lamda-logistica.tplinkdns.com (DDNS TP-Link)
 * Puerto de salida público: 3005 (Port Forwarding en router)
 * Host binding: 0.0.0.0 (NUNCA cambiar a localhost, bloquearía acceso externo)
 * 
 * NOTA: Este módulo usa cors() abierto porque recibe requests desde múltiples
 * orígenes dinámicos (inventario móvil, WebSocket, módulos internos).
 */
app.use(cors());

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({
        error: 'Error interno del servidor',
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Configuración de WebSocket
io.on('connection', (socket) => {
    console.log('🔌 [WS] Cliente conectado - Socket ID:', socket.id);
    console.log('📊 [WS] Sesiones activas:', inventarioSesiones.size);

    // Detectar tipo de inventario por sessionId y manejar de forma unificada
    function detectarTipoInventario(sessionId) {
        return sessionId && sessionId.startsWith('inv_ing_') ? 'ingredientes' : 'articulos';
    }

    // PC inicia una sesión de inventario (UNIFICADO para artículos e ingredientes)
    socket.on('iniciar_inventario', (data) => {
        const tiempoInicio = Date.now();
        const sessionId = data.sessionId;
        const usuario = data.usuario || null; // Ahora es un objeto {id, nombre}
        const sectores = data.sectores || null; // Para ingredientes
        const tipoInventario = detectarTipoInventario(sessionId);

        console.log(`🚀 [WS] ===== NUEVA SESIÓN DE INVENTARIO (${tipoInventario.toUpperCase()}) =====`);
        console.log('🆔 [WS] Session ID:', sessionId);
        console.log('👤 [WS] Usuario recibido:', JSON.stringify(usuario));
        console.log('🏷️ [WS] Sectores:', sectores);
        console.log('🔌 [WS] Socket PC:', socket.id);
        console.log('⏱️ [WS] Timestamp inicio:', new Date(tiempoInicio).toISOString());

        // Verificar si ya existe la sesión
        if (inventarioSesiones.has(sessionId)) {
            console.log('⚠️ [WS] Sesión existente, actualizando datos...');
            const sesionExistente = inventarioSesiones.get(sessionId);
            sesionExistente.pcSocketId = socket.id;
            sesionExistente.usuario = usuario; // Guardar objeto completo
            sesionExistente.timestampActualizacion = tiempoInicio;
            if (tipoInventario === 'ingredientes') {
                sesionExistente.sectores = sectores;
                sesionExistente.tipo = 'ingredientes';
            }
        } else {
            console.log('✨ [WS] Creando nueva sesión...');
            const sesionData = {
                pcSocketId: socket.id,
                usuario: usuario, // Guardar objeto completo {id, nombre}
                items: new Map(),
                fechaInicio: new Date(),
                timestampCreacion: tiempoInicio,
                estado: 'activa'
            };

            // Agregar datos específicos para ingredientes
            if (tipoInventario === 'ingredientes') {
                sesionData.sectores = sectores;
                sesionData.ingredientes = data.ingredientes || []; // Guardar lista maestra
                sesionData.tipo = 'ingredientes';
            }

            inventarioSesiones.set(sessionId, sesionData);
        }

        const tiempoGuardado = Date.now() - tiempoInicio;
        console.log(`⏱️ [WS] Sesión guardada en ${tiempoGuardado}ms`);

        // CORRECCIÓN CRÍTICA: Usar setImmediate para asegurar que la sesión 
        // esté completamente persistida antes de notificar a la PC
        setImmediate(() => {
            // Emitir respuesta unificada con datos específicos según el tipo
            const respuesta = { sessionId, usuario }; // Enviar objeto usuario completo
            if (tipoInventario === 'ingredientes') {
                respuesta.sectores = sectores;
            }

            socket.emit('inventario_iniciado', respuesta);

            const tiempoTotal = Date.now() - tiempoInicio;
            console.log(`✅ [WS] Sesión de ${tipoInventario} iniciada exitosamente en ${tiempoTotal}ms`);
            console.log('📊 [WS] Total sesiones activas:', inventarioSesiones.size);
        });
    });

    // Móvil se une a una sesión (UNIFICADO)
    socket.on('unirse_inventario', (data) => {
        const tiempoUnion = Date.now();
        const sessionId = data.sessionId;
        const intentoNumero = data.intento || 1;

        console.log('📱 [WS] ===== MÓVIL INTENTANDO UNIRSE =====');
        console.log('🆔 [WS] Session ID solicitado:', sessionId);
        console.log('🔌 [WS] Socket Móvil:', socket.id);
        console.log('🔢 [WS] Intento número:', intentoNumero);
        console.log('⏱️ [WS] Timestamp unión:', new Date(tiempoUnion).toISOString());
        console.log('📊 [WS] Sesiones activas:', Array.from(inventarioSesiones.keys()));
        console.log('🔍 [WS] Datos completos recibidos del móvil:', JSON.stringify(data, null, 2));

        const session = inventarioSesiones.get(sessionId);

        if (session) {
            const tiempoDesdeCreacion = tiempoUnion - (session.timestampCreacion || tiempoUnion);
            console.log('✅ [WS] Datos de la sesión encontrada:');
            console.log('- Usuario:', session.usuario);
            console.log('- Estado:', session.estado);
            console.log('- Fecha inicio:', session.fechaInicio);
            console.log('- PC Socket:', session.pcSocketId);
            console.log('- Tipo:', session.tipo || 'articulos');
            console.log('- Sectores:', session.sectores);
            console.log(`⏱️ [WS] Tiempo desde creación de sesión: ${tiempoDesdeCreacion}ms`);

            // ADVERTENCIA: Detectar posibles race conditions
            if (tiempoDesdeCreacion < 100) {
                console.warn(`⚠️ [WS] ADVERTENCIA: Unión muy rápida (${tiempoDesdeCreacion}ms) - Posible race condition evitada`);
            }
        }

        if (!session) {
            console.error('❌ [WS] Error: Sesión no encontrada');
            console.log('🔍 [WS] Sesiones disponibles:', Array.from(inventarioSesiones.keys()));
            socket.emit('error_conexion', {
                mensaje: 'Sesión no encontrada o expirada',
                sessionId: sessionId
            });
            return;
        }

        if (session.estado !== 'activa') {
            console.error('❌ [WS] Error: Sesión no está activa');
            socket.emit('error_conexion', {
                mensaje: 'La sesión ya no está activa',
                sessionId: sessionId
            });
            return;
        }

        console.log('✅ [WS] Sesión encontrada y válida');
        console.log('👤 [WS] Usuario de la sesión:', JSON.stringify(session.usuario));

        // Registrar el móvil en la sesión
        session.mobileSocketId = socket.id;

        // CORRECCIÓN: Confirmar conexión al móvil con objeto usuario completo
        const respuestaConexion = {
            sessionId,
            usuario: session.usuario, // Enviar objeto completo {id, nombre}
            sectores: session.sectores, // Enviar sectores también
            ingredientes: session.ingredientes // Enviar Lista Maestra para auditoría
        };

        // Para ingredientes, incluir información de sectores
        if (session.tipo === 'ingredientes' && session.sectores) {
            respuestaConexion.sectores = session.sectores;
            console.log('🏢 [WS] Incluyendo sectores en respuesta:', session.sectores);
        } else if ((!session.tipo || session.tipo === 'articulos') && session.items) {
            // Para artículos, enviar los ya escaneados para tolerancia a fallos
            respuestaConexion.articulosContados = Array.from(session.items.values());
            console.log(`📦 [WS] Incluyendo ${respuestaConexion.articulosContados.length} artículos contados para sincronización móvil`);
        }

        console.log('📤 [WS] Enviando conexion_exitosa con datos:', JSON.stringify(respuestaConexion));
        socket.emit('conexion_exitosa', respuestaConexion);

        // Notificar a la PC
        io.to(session.pcSocketId).emit('movil_conectado', {
            mensaje: 'Dispositivo móvil conectado',
            socketId: socket.id
        });

        console.log('🎉 [WS] Móvil conectado exitosamente a la sesión');
    });

    // Móvil envía un item escaneado (UNIFICADO para artículos e ingredientes)
    socket.on('articulo_escaneado', (data) => {
        const { sessionId, articulo, ingrediente, cantidad } = data;
        const item = articulo || ingrediente; // Puede ser artículo o ingrediente
        const tipoInventario = detectarTipoInventario(sessionId);

        console.log(`📦 [WS] ===== NUEVO ${tipoInventario.toUpperCase().slice(0, -1)} ESCANEADO =====`);
        console.log('🆔 [WS] Session ID:', sessionId);
        console.log('📝 [WS] Item:', item?.nombre);
        console.log('🔢 [WS] Cantidad:', cantidad);
        console.log('🏷️ [WS] Tipo detectado:', tipoInventario);

        const session = inventarioSesiones.get(sessionId);

        if (!session) {
            console.error(`❌ [WS] Error: Sesión no encontrada para ${tipoInventario.slice(0, -1)}`);
            socket.emit('error_conexion', { mensaje: 'Sesión no válida' });
            return;
        }

        if (session.estado !== 'activa') {
            console.error(`❌ [WS] Error: Sesión no activa para ${tipoInventario.slice(0, -1)}`);
            socket.emit('error_conexion', { mensaje: 'La sesión no está activa' });
            return;
        }

        // Guardar en la sesión con clave apropiada según el tipo
        const key = tipoInventario === 'ingredientes' ?
            (item.id || item.codigo) :
            item.numero;

        session.items.set(key, {
            [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item,
            cantidad,
            timestamp: new Date()
        });

        console.log(`📤 [WS] Enviando ${tipoInventario.slice(0, -1)} a PC...`);

        // Enviar a la PC usando evento unificado
        io.to(session.pcSocketId).emit('nuevo_articulo', {
            sessionId,
            [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item,
            cantidad,
            timestamp: new Date()
        });

        // NUEVO: Enviar también al Móvil (Mirroring)
        if (session.mobileSocketId) {
            io.to(session.mobileSocketId).emit('nuevo_articulo', {
                sessionId,
                [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item,
                cantidad,
                timestamp: new Date()
            });
        }

        // Confirmar al emisor (PC o Móvil)
        socket.emit('articulo_confirmado', {
            [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item.nombre,
            cantidad
        });

        console.log(`✅ [WS] ${tipoInventario.slice(0, -1)} procesado exitosamente`);
        console.log(`📊 [WS] Total items en sesión:`, session.items.size);
        console.log(`✅ [WS] ${tipoInventario.slice(0, -1)} procesado exitosamente`);
        console.log(`📊 [WS] Total items en sesión:`, session.items.size);
    });

    // NUEVO: Hidratar estado del servidor desde la PC
    socket.on('hydrate_server_state', (data) => {
        const { sessionId, items } = data;
        const session = inventarioSesiones.get(sessionId);
        
        if (session && items && Array.isArray(items)) {
            console.log(`💧 [WS] Hidratando sesión ${sessionId} con ${items.length} artículos desde PC`);
            const tipoInventario = detectarTipoInventario(sessionId);
            
            items.forEach(itemData => {
                const item = itemData.articulo || itemData.ingrediente;
                if (!item) return;
                
                const cantidad = itemData.cantidad;
                const key = tipoInventario === 'ingredientes' ? (item.id || item.codigo) : item.numero;
                
                session.items.set(key, {
                    [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item,
                    cantidad,
                    timestamp: new Date()
                });
            });
            
            console.log(`✅ [WS] Sesión hidratada. Total items ahora: ${session.items.size}`);
            
            // Mirroring al móvil si está conectado
            if (session.mobileSocketId) {
                console.log(`📦 [WS] Sincronizando móvil con estado hidratado...`);
                const itemsAEnviar = Array.from(session.items.values());
                io.to(session.mobileSocketId).emit('conexion_exitosa', {
                    sessionId,
                    usuario: session.usuario,
                    sectores: session.sectores,
                    articulosContados: itemsAEnviar
                });
            }
        }
    });

    // Relay de datos de inventario (PC -> Móvil)
    socket.on('sincronizar_datos_inventario', (data) => {
        const { sessionId, ingredientes } = data;
        const session = inventarioSesiones.get(sessionId);

        if (session && session.mobileSocketId) {
            console.log(`📦 [WS] Sincronizando ${ingredientes.length} ingredientes con móvil...`);
            io.to(session.mobileSocketId).emit('datos_inventario', { ingredientes });
        }
    });

    // Relay de solicitud de impresión (Móvil -> PC)
    socket.on('solicitar_impresion', (data) => {
        const { sessionId, ingredientes } = data; // Legacy support
        // ...
    });

    // ✅ FIX: Listener específico para impresión de etiquetas de ingredientes
    // ✅ FIX: Listener específico para impresión de etiquetas de ingredientes
    // ✅ FIX: Listener específico para impresión de etiquetas de ingredientes
    socket.on('imprimir_etiqueta_ingrediente', async (data) => {
        const { sessionId, ingrediente } = data; // Ahora esperamos el objeto ingrediente completo
        const session = inventarioSesiones.get(sessionId);

        // TRAZA NIVEL 2: Recepción
        console.log(`TRAZA-SERVER: Orden de impresión recibida del cliente [${socket.id}] para [${ingrediente?.id}]`);
        console.log(`🖨️ [WS] Solicitud de impresión para: ${ingrediente?.nombre || 'Desconocido'}`);

        // NO Relay a PC (Centralizamos la impresión en el Servidor para soportar Móvil y evitar duplicados)
        // Si la PC necesita feedback, escuchará 'print_status'

        if (ingrediente) {
            try {
                // Usar módulo HTTP nativo para máxima compatibilidad (Node < 18 fallback)
                const http = require('http');
                const postData = JSON.stringify({
                    ingredienteId: ingrediente.id,
                    nombre: ingrediente.nombre,
                    codigo: ingrediente.codigo,
                    sector: ingrediente.sector_letra || ingrediente.sector_id || ''
                });

                // TRAZA NIVEL 3: Puente
                console.log(`TRAZA-SERVER: Enviando orden final al puerto 3000 con los datos: ${postData}`);

                const options = {
                    hostname: 'localhost',
                    port: 3000,
                    path: '/api/etiquetas/ingrediente',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                const req = http.request(options, (res) => {
                    let responseData = '';
                    res.on('data', (chunk) => { responseData += chunk; });
                    res.on('end', () => {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            console.log("✅ [IMP] Orden enviada a localhost:3000 con éxito.");
                            socket.emit('print_status', { success: true, msg: 'Imprimiendo...' });
                        } else {
                            console.error(`TRAZA-SERVER-ERROR: Servicio de impresión respondió con error: Status ${res.statusCode} - ${responseData}`);
                            console.error(`❌ [IMP] Error del servicio (Status: ${res.statusCode}): ${responseData}`);
                            socket.emit('print_status', { success: false, msg: 'Error en servicio de impresión' });
                        }
                    });
                });

                req.on('error', (e) => {
                    console.error(`TRAZA-SERVER-ERROR: Error de conexión con puerto 3000: ${e.message}`);
                    console.error(`❌ [IMP] Error de conexión con localhost:3000: ${e.message}`);
                    socket.emit('print_status', { success: false, msg: 'Error: Servicio de impresión no disponible' });
                });

                // Write data to request body
                req.write(postData);
                req.end();

            } catch (err) {
                console.error("TRAZA-SERVER-ERROR: Excepción crítica server-side:", err.message);
                console.error("❌ [IMP] Excepción crítica al intentar imprimir:", err.message);
                socket.emit('print_status', { success: false, msg: 'Error interno de impresión' });
            }
        } else {
            console.warn("⚠️ [IMP] Datos de ingrediente inválidos/faltantes");
            socket.emit('print_status', { success: false, msg: 'Datos inválidos' });
        }
    });

    // NUEVO: Listener para impresión de sector (Relay a puerto 3000)
    socket.on('imprimir_etiqueta_sector', async (data) => {
        console.log(`🖨️ [WS] Imprimir etiqueta SECTOR: ${data.sector}`);
        try {
            // Enviamos al endpoint genérico de impresión de texto o específico si existe
            // Asumo /api/etiquetas/sector o similar. Si no, ajustar a /texto
            await fetch('http://localhost:3000/api/etiquetas/sector', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sector: data.sector })
            });
            console.log("✅ [IMP] Orden imprimir sector enviada");
        } catch (e) {
            console.error("❌ [IMP] Error al imprimir sector:", e.message);
        }
    });

    // PC finaliza inventario (UNIFICADO)
    socket.on('finalizar_inventario', (data) => {
        const sessionId = data.sessionId;
        console.log('🏁 [WS] ===== FINALIZANDO INVENTARIO (Desde Móvil) =====');
        console.log('🆔 [WS] Session ID:', sessionId);

        const session = inventarioSesiones.get(sessionId);

        if (!session) {
            console.log('⚠️ [WS] No se encontró la sesión a finalizar');
            return;
        }

        // RELAY CRÍTICO: Ordenar a la PC que ejecute el cierre
        if (session.pcSocketId) {
            console.log('💻 [WS] Enviando solicitud_cierre_remoto a PC...');
            io.to(session.pcSocketId).emit('solicitud_cierre_remoto', { sessionId });
        }

        // Marcar sesión como finalizada
        session.estado = 'finalizada';

        // Notificar al móvil
        if (session.mobileSocketId) {
            io.to(session.mobileSocketId).emit('inventario_finalizado', {
                mensaje: 'Procesando cierre de inventario...'
            });
        }

        // Limpieza diferida
        setTimeout(() => {
            if (inventarioSesiones.has(sessionId)) {
                inventarioSesiones.delete(sessionId);
            }
        }, 5000);
    });

    // NUEVO: Cancelar inventario (Sin guardar nada)
    socket.on('cancelar_inventario', (data) => {
        const sessionId = data.sessionId;
        console.log('⛔ [WS] ===== CANCELANDO INVENTARIO =====');
        console.log('🆔 [WS] Session ID:', sessionId);

        const session = inventarioSesiones.get(sessionId);
        if (!session) return;

        // Notificar a ambos
        if (session.pcSocketId) io.to(session.pcSocketId).emit('inventario_cancelado');
        if (session.mobileSocketId) io.to(session.mobileSocketId).emit('inventario_cancelado');

        // Limpiar sesión inmediatamente
        inventarioSesiones.delete(sessionId);
        console.log('🗑️ [WS] Sesión eliminada por cancelación');
    });

    // Limpiar cuando se desconectan
    socket.on('disconnect', () => {
        const tiempoDesconexion = Date.now();
        console.log('👋 [WS] ===== CLIENTE DESCONECTADO =====');
        console.log('🔌 [WS] Socket ID:', socket.id);
        console.log('⏱️ [WS] Timestamp desconexión:', new Date(tiempoDesconexion).toISOString());

        // Limpiar sesiones donde este socket era parte
        for (const [sessionId, session] of inventarioSesiones.entries()) {
            if (session.pcSocketId === socket.id) {
                console.log('💻 [WS] PC desconectada de sesión:', sessionId);

                // CORRECCIÓN: No eliminar inmediatamente, dar tiempo para reconexión
                session.estado = 'esperando_reconexion';
                session.timestampDesconexion = tiempoDesconexion;

                // Si se desconecta la PC, notificar al móvil pero NO cerrar sesión aún
                if (session.mobileSocketId) {
                    console.log('📱 [WS] Notificando al móvil sobre desconexión temporal de PC');
                    io.to(session.mobileSocketId).emit('pc_desconectada_temporal', {
                        mensaje: 'PC desconectada temporalmente. Esperando reconexión...'
                    });
                }

                // CORRECCIÓN: Aumentar timeout de 5s a 60s para permitir reconexiones
                setTimeout(() => {
                    const sesionActual = inventarioSesiones.get(sessionId);
                    // Solo eliminar si sigue en estado de espera (no se reconectó)
                    if (sesionActual && sesionActual.estado === 'esperando_reconexion') {
                        console.log('🗑️ [WS] Sesión eliminada por timeout (60s sin reconexión):', sessionId);
                        inventarioSesiones.delete(sessionId);

                        // Notificar al móvil que la sesión expiró definitivamente
                        if (sesionActual.mobileSocketId) {
                            io.to(sesionActual.mobileSocketId).emit('sesion_expirada', {
                                mensaje: 'La sesión ha expirado. La PC no se reconectó.'
                            });
                        }
                    } else if (sesionActual) {
                        console.log('✅ [WS] Sesión se reconectó exitosamente, no se eliminó:', sessionId);
                    }
                }, 60000); // 60 segundos en lugar de 5

            } else if (session.mobileSocketId === socket.id) {
                console.log('📱 [WS] Móvil desconectado de sesión:', sessionId);
                // Si se desconecta el móvil, notificar a la PC
                io.to(session.pcSocketId).emit('movil_desconectado');
                delete session.mobileSocketId;
            }
        }

        console.log('📊 [WS] Sesiones activas restantes:', inventarioSesiones.size);
    });
});

// Puerto
const PORT = process.env.PORT || 3002;

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor de producción corriendo en puerto ${PORT}`);
});
