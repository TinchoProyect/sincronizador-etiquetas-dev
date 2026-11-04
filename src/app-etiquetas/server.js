const express = require('express');
const { exec, fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const app = express();
const port = 3000;

/**
 * CONFIGURACIÓN CORS — TOPOLOGÍA DE RED
 * Dominio externo oficial: lamda-logistica.tplinkdns.com (DDNS TP-Link)
 * Puerto de salida público: 3005 (Port Forwarding en router)
 * Host binding: 0.0.0.0 (NUNCA cambiar a localhost, bloquearía acceso externo)
 */
app.use(cors({
  origin: [
    'http://localhost:3002',
    'http://localhost:3005',
    'http://127.0.0.1:3005',
    // --- Acceso externo seguro vía Cloudflare Tunnel (Dominio Oficial LAMDA) ---
    'https://logistica.lamdaser.com',
    'http://logistica.lamdaser.com',
    // --- Acceso externo vía DDNS (router TP-Link con Port Forwarding) ---
    'http://lamda-logistica.tplinkdns.com:3005',
    'https://lamda-logistica.tplinkdns.com:3005',
    'http://lamda-logistica.tplinkdns.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// 🔐 Importar rutas del sistema de usuarios y jornadas de colaboradores
const rutasUsuarios = require('../usuarios/rutas');
const rutasJornadas = require('../usuarios/rutasJornadas');
const rutasCrmSeguimientos = require('./routes/crmSeguimientos');
const rutasCrmWhatsappHub = require('./routes/crmWhatsappHub');
const rutasOfertasDinamicas = require('./routes/ofertasDinamicasRoutes');

// Middleware para registrar todas las solicitudes
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Configurar proxy para el servidor de producción
app.use('/api/produccion', createProxyMiddleware({
  target: 'http://localhost:3002',
  changeOrigin: true,
  pathRewrite: (path, req) => {
    // Restaurar el prefijo que Express elimina
    return '/api/produccion' + req.url; 
  }
}));

// 🧾 [PRESUPUESTOS] Configurar proxy para el módulo de presupuestos
console.log('🔍 [PRESUPUESTOS] Configurando proxy para módulo de presupuestos...');
app.use('/api/presupuestos', createProxyMiddleware({
  target: 'http://localhost:3003',
  changeOrigin: true,
  pathRewrite: (path, req) => {
    // Restaurar el prefijo que Express elimina
    return '/api/presupuestos' + req.url; 
  },
  onError: (err, req, res) => {
    console.error('❌ [PRESUPUESTOS] Error en proxy:', err.message);
    res.status(503).json({
      error: 'Servicio de presupuestos no disponible',
      message: 'Verifique que el servidor de presupuestos esté ejecutándose en puerto 3003'
    });
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`🔍 [PRESUPUESTOS] Proxy request: ${req.method} ${req.url} -> http://localhost:3003${req.url}`);
  }
}));

// 🚚 [LOGISTICA] Configurar proxy para el módulo de logística
console.log('🔍 [LOGISTICA] Configurando proxy para módulo de logística...');
app.use('/api/logistica', createProxyMiddleware({
  target: 'http://localhost:3005',
  changeOrigin: true,
  pathRewrite: (path, req) => {
    return '/api/logistica' + req.url; 
  },
  onError: (err, req, res) => {
    console.error('❌ [LOGISTICA] Error en proxy:', err.message);
    res.status(503).json({
      error: 'Servicio de logística no disponible',
      message: 'Verifique que el servidor de logística esté ejecutándose en puerto 3005'
    });
  }
}));

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ limit: '30mb', extended: true }));
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.js')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Configurar el middleware para servir archivos estáticos
const staticPath = path.join(__dirname);
console.log('Serving static files from:', staticPath);

// Servir archivos estáticos desde la raíz del proyecto
app.use(express.static(staticPath));

// Servir archivos desde subdirectorios
app.use('/css', express.static(path.join(staticPath, 'css')));
app.use('/js', express.static(path.join(staticPath, 'js')));
app.use('/pages', express.static(path.join(staticPath, 'pages')));

// Configurar index.html como página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});



// 🧾 [PRESUPUESTOS] Ruta para servir la página principal del módulo
app.get('/presupuestos', (req, res) => {
  console.log('🔍 [PRESUPUESTOS] Sirviendo página principal del módulo');
  res.redirect('http://localhost:3003');
});

// Importar pool centralizado de usuarios
const pool = require('../usuarios/pool');
const { reconciliarFaltantesConStock } = require('../produccion/services/reconciliacionStock');
const { obtenerDemandaFaltantes, cambiarEstadoFaltante } = require('../presupuestos/services/demandaFaltantesService');
const { obtenerPlanTrabajoDeposito, invalidarCachePlanDeposito } = require('./services/planTrabajoDepositoService');

console.log('🔌 [ETIQUETAS-SERVER] Usando pool centralizado de usuarios');

// Configurar rutas API existentes
const router = express.Router();

// Endpoint para obtener el estado del entorno (para indicador visual)
router.get('/config/status', (req, res) => {
  const dbName = process.env.DB_NAME || 'etiquetas';
  const nodeEnv = process.env.NODE_ENV || 'production';

  res.json({
    database: dbName,
    environment: nodeEnv,
    isProduction: dbName === 'etiquetas' && nodeEnv === 'production',
    isTest: dbName === 'etiquetas_pruebas' || nodeEnv === 'test'
  });
});

router.get('/articulos', async (req, res) => {
  console.log('GET /api/articulos - Obteniendo artículos...');
  try {
    const result = await pool.query('SELECT numero, nombre, codigo_barras FROM articulos');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener artículos:', error);
    res.status(500).json({ error: 'Error al obtener artículos' });
  }
});

router.post('/imprimir', (req, res) => {
  const datos = req.body;
  const cantidad = Math.max(1, Math.ceil(parseFloat(datos?.cantidad) || 2));

  const tieneDatosArticulo = datos && (
    (datos.articulo && typeof datos.articulo === 'object') ||
    datos.nombre ||
    datos.descripcion ||
    datos.numero ||
    datos.articulo_numero ||
    datos.codigo_barras ||
    datos.codigo
  );

  if (!tieneDatosArticulo) {
    return res.status(400).json({ error: 'Faltan datos para imprimir' });
  }

  const scriptPath = path.resolve(__dirname, '../scripts/imprimirEtiqueta.js');
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const uniqueId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const tempDataPath = path.join(tempDir, `temp-data-${uniqueId}.json`);
  fs.writeFileSync(tempDataPath, JSON.stringify(datos, null, 2));
  const command = `cd "${path.dirname(__dirname)}" && node "${scriptPath}" ${cantidad} "${tempDataPath}"`;

  exec(command, (error, stdout, stderr) => {
    fs.unlink(tempDataPath, () => {});
    if (error) {
      console.error('Error al imprimir:', error);
      return res.status(500).json({ error: 'Error al imprimir', detalle: error.message });
    }
    console.log('Impresión enviada correctamente.');
    res.json({ message: 'Impresión enviada correctamente' });
  });
});

router.post('/imprimir-personalizada', (req, res) => {
  const { datos, cantidad } = req.body;

  if (!datos || !datos.textoPrincipal || !cantidad) {
    return res.status(400).json({ error: 'Faltan datos para imprimir' });
  }

  const scriptPath = path.resolve(__dirname, '../scripts/etiquetaTextoManual.js');
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const tempDataPath = path.join(tempDir, 'temp-texto.json');
  fs.writeFileSync(tempDataPath, JSON.stringify(datos, null, 2));
  const command = `cd "${path.dirname(__dirname)}" && node "${scriptPath}" ${cantidad}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error al imprimir:', error);
      return res.status(500).json({ error: 'Error al imprimir' });
    }
    console.log('Impresión personalizada enviada correctamente.');
    res.json({ message: 'Impresión enviada correctamente' });
  });
});

// Endpoint para imprimir etiquetas de ingredientes
router.post('/etiquetas/ingrediente', (req, res) => {
  const { id, nombre, codigo, sector, cantidad } = req.body;

  console.log(`[API Etiquetas] ID Ingrediente recibido: ${id || 'N/A'}, Cantidad solicitada: ${cantidad}`);

  if (!nombre || !codigo) {
    return res.status(400).json({ error: 'Faltan datos del ingrediente' });
  }

  const datos = {
    id,
    nombre: String(nombre || ''),
    codigo: String(codigo || '00000000'),
    sector: String(sector || '')
  };

  const cantidadImpresion = Math.max(1, Math.ceil(parseFloat(cantidad) || 1));

  const scriptPath = path.resolve(__dirname, '../scripts/imprimirEtiquetaIngrediente.js');
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const uniqueId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const tempDataPath = path.join(tempDir, `temp-ingrediente-${uniqueId}.json`);
  fs.writeFileSync(tempDataPath, JSON.stringify(datos, null, 2));

  // Ejecutar script con la cantidad dinámica y archivo JSON único
  const command = `cd "${path.dirname(__dirname)}" && node "${scriptPath}" ${cantidadImpresion} "${tempDataPath}"`;

  exec(command, (error, stdout, stderr) => {
    fs.unlink(tempDataPath, () => {});
    if (error) {
      console.error('Error al imprimir etiqueta de ingrediente:', error);
      return res.status(500).json({ error: 'Error al imprimir etiqueta de ingrediente', detalle: error.message });
    }
    console.log(`Etiqueta de ingrediente enviada a imprimir (Cant: ${cantidadImpresion}).`);
    res.json({ message: 'Etiqueta enviada a imprimir' });
  });
});

// NUEVO: Endpoint para imprimir etiqueta de SECTOR
router.post('/etiquetas/sector', (req, res) => {
  const { sector } = req.body; // Espera "Sector 'G'" o similar

  if (!sector) {
    return res.status(400).json({ error: 'Falta el nombre del sector' });
  }

  // Usamos el script de texto manual para imprimir el sector
  // Formato: Texto grande y centrado
  const datos = {
    textoPrincipal: sector,
    textoSecundario: "", // Opcional
    esSector: true // Flag por si el script lo necesita
  };

  const scriptPath = path.resolve(__dirname, '../scripts/etiquetaTextoManual.js');
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // CORRECCION: Usar archivo unico para evitar colisiones en concurrencia
  const uniqueId = Date.now() + Math.random().toString(36).substring(7);
  const tempFileName = `temp-texto-${uniqueId}.json`;
  const tempDataPath = path.join(tempDir, tempFileName);

  fs.writeFileSync(tempDataPath, JSON.stringify(datos, null, 2));

  // Cantidad siempre 1 para sector. Pasamos el path del archivo temp como argumento extra si el script lo soporta
  // OJO: El script etiquetaTextoManual.js debe saber leer este archivo.
  // Si el script busca hardcoded 'temp-texto.json', fallará.
  // Vamos a modificar la llamada para que el script lea EL ARCHIVO QUE LE PASAMOS.
  // Asumimos que modificaremos etiquetaTextoManual.js para aceptar un argumento opcional de archivo.

  const command = `cd "${path.dirname(__dirname)}" && node "${scriptPath}" 1 "${tempDataPath}"`;

  exec(command, (error, stdout, stderr) => {
    // Limpieza: Borrar archivo temporal
    try {
      if (fs.existsSync(tempDataPath)) fs.unlinkSync(tempDataPath);
    } catch (e) { console.error("Error borrando temp:", e); }

    if (error) {
      console.error('Error al imprimir etiqueta de SECTOR:', error);
      return res.status(500).json({ error: 'Error al imprimir etiqueta' });
    }
    console.log(`Etiqueta de SECTOR enviada: ${sector}`);
    res.json({ message: 'Etiqueta enviada a imprimir' });
  });
});

// NUEVO: Endpoint para imprimir etiquetas de LOTES (Secreto Comercial: Sin Proveedor)
router.post('/etiquetas/lote', (req, res) => {
  const { id_corto, descripcion, cantidad } = req.body;

  console.log(`[API Etiquetas] Imprimiendo Lote: ${id_corto}, Cantidad: ${cantidad}`);

  if (!id_corto || !descripcion) {
    return res.status(400).json({ error: 'Faltan datos del lote' });
  }

  const datos = {
    id_corto,
    descripcion
  };

  const cantidadImpresion = parseInt(cantidad) || 1;

  const scriptPath = path.resolve(__dirname, '../scripts/imprimirEtiquetaLote.js');
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const tempDataPath = path.join(tempDir, `temp-lote-${Date.now()}.json`);
  fs.writeFileSync(tempDataPath, JSON.stringify(datos, null, 2));

  // Pasar el path del archivo temporal y la cantidad
  const command = `cd "${path.dirname(__dirname)}" && node "${scriptPath}" ${cantidadImpresion} "${tempDataPath}"`;

  exec(command, (error, stdout, stderr) => {
    // Limpieza
    try {
      if (fs.existsSync(tempDataPath)) fs.unlinkSync(tempDataPath);
    } catch (e) { console.error("Error borrando temp lote:", e); }

    if (error) {
      console.error('Error al imprimir etiqueta de LOTE:', error);
      return res.status(500).json({ error: 'Error al imprimir etiqueta de lote' });
    }
    console.log(`Etiqueta de LOTE enviada a Zebra (Cant: ${cantidadImpresion}).`);
    res.json({ message: 'Etiqueta de lote enviada a imprimir' });
  });
});

// NUEVO: Endpoint para imprimir etiquetas de TRATAMIENTO (CARPAS)
router.post('/etiquetas/tratamiento', (req, res) => {
  const matrizEtiquetas = req.body; 

  if (!Array.isArray(matrizEtiquetas) || matrizEtiquetas.length === 0) {
    return res.status(400).json({ error: 'Falta la matriz de etiquetas de los bultos' });
  }

  const scriptPath = path.resolve(__dirname, '../scripts/imprimirEtiquetaTratamiento.js');
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const tempDataPath = path.join(tempDir, 'temp-tratamiento.json');
  fs.writeFileSync(tempDataPath, JSON.stringify(matrizEtiquetas, null, 2));

  // No necesitamos pasar cantidad de argumentos porque la iteracion la hace el propio script basado en el JSON
  const command = `cd "${path.dirname(__dirname)}" && node "${scriptPath}"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error al imprimir etiqueta de TRATAMIENTO:', error);
      return res.status(500).json({ error: 'Error al imprimir etiquetas' });
    }
    console.log(`Etiquetas de TRATAMIENTO enviadas a Zebra (Cant: ${matrizEtiquetas.length}).`);
    res.json({ message: 'Etiquetas enviadas a imprimir', total: matrizEtiquetas.length });
  });
});

let isSyncingB2B = false;

router.post('/sync-b2b', async (req, res) => {
  if (isSyncingB2B) {
    return res.status(409).json({ error: 'Ya hay una sincronización en curso. Por favor, espere.' });
  }

  isSyncingB2B = true;
  console.log(`🚀 [MANUAL-SYNC] Iniciando sincronización integral B2B...`);

  const scripts = [
    { name: 'Catálogo y Precios', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BPrecios.js') },
    { name: 'Cuentas Corrientes', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BCuentas.js') },
    { name: 'Clientes y Listas', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BClientesListas.js') },
    { name: 'Políticas Comerciales', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BPoliticas.js') },
    { name: 'Ofertas Dinámicas', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BOfertas.js') },
    { name: 'Servicios Colaborador', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BColaboradores.js') },
    { name: 'Pedidos desde B2B', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BPedidos.js') },
    { name: 'Estados Logísticos B2B', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BEstados.js') },
  ];

  try {
    for (const script of scripts) {
      console.log(`🚀 [MANUAL-SYNC] Ejecutando: ${script.name}...`);
      const exitCode = await new Promise((resolve) => {
        const child = fork(script.path, [], {
          env: { ...process.env, NODE_ENV: 'production' }
        });
        child.on('close', (code) => {
          resolve(code);
        });
        child.on('error', (err) => {
          console.error(`💥 [MANUAL-SYNC] Error lanzando ${script.name}:`, err.message);
          resolve(-1);
        });
      });

      if (exitCode !== 0) {
        console.warn(`⚠️ [MANUAL-SYNC] ${script.name} finalizó con advertencias/errores (código ${exitCode}). Continuando secuencia...`);
      } else {
        console.log(`✅ [MANUAL-SYNC] ${script.name} finalizó con éxito.`);
      }
    }

    isSyncingB2B = false;
    console.log('✅ [MANUAL-SYNC] Sincronización integral manual completada con éxito.');
    res.json({ success: true, message: 'La sincronización integral (Precios, Cuentas, Listas, Políticas, Ofertas, Colaboradores, Pedidos y Estados) se completó exitosamente.' });

  } catch (err) {
    isSyncingB2B = false;
    console.error('💥 [MANUAL-SYNC] Error general en secuencia:', err.message);
    res.status(500).json({ error: `La sincronización integral falló: ${err.message}` });
  }
});


router.post('/sync-b2b/:step', async (req, res) => {
  const { step } = req.params;
  
  const stepMap = {
    precios: { name: 'Catálogo y Precios', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BPrecios.js') },
    cuentas: { name: 'Cuentas Corrientes', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BCuentas.js') },
    listas: { name: 'Clientes y Listas', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BClientesListas.js') },
    politicas: { name: 'Políticas Comerciales', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BPoliticas.js') },
    ofertas: { name: 'Ofertas Dinámicas', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BOfertas.js') },
    colaboradores: { name: 'Servicios Colaborador', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BColaboradores.js') },
    pedidos: { name: 'Pedidos desde B2B', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BPedidos.js') },
    estados: { name: 'Estados Logísticos B2B', path: path.resolve(__dirname, '../actualizaPrecios/syncB2BEstados.js') },
  };

  const script = stepMap[step];
  if (!script) {
    return res.status(400).json({ error: 'Paso de sincronización inválido.' });
  }

  console.log(`🚀 [MANUAL-STEP-SYNC] Iniciando paso: ${script.name}...`);

  try {
    const exitCode = await new Promise((resolve) => {
      const child = fork(script.path, [], {
        env: { ...process.env, NODE_ENV: 'production' }
      });
      child.on('close', (code) => {
        resolve(code);
      });
      child.on('error', (err) => {
        console.error(`💥 [MANUAL-STEP-SYNC] Error lanzando ${script.name}:`, err.message);
        resolve(-1);
      });
    });

    if (exitCode !== 0) {
      return res.status(500).json({ error: `El paso ${script.name} finalizó con errores.` });
    }

    res.json({ success: true, message: `Paso ${script.name} completado con éxito.` });
  } catch (err) {
    console.error(`💥 [MANUAL-STEP-SYNC] Error general en ${script.name}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});


// NUEVO: Endpoint para abrir la carpeta b2b-portal/dist/ en el Explorador de Archivos de Windows
app.get('/api/open-dist', (req, res) => {
  const distPath = path.resolve(__dirname, '../../b2b-portal/dist');
  console.log(`📂 [ETIQUETAS-SERVER] Solicitud para abrir carpeta dist: ${distPath}`);
  
  if (!fs.existsSync(distPath)) {
    return res.status(400).json({ error: 'La carpeta dist/ no existe. Por favor, corre npm run b2b:build primero.' });
  }

  const command = `explorer.exe "${distPath}"`;
  exec(command, (error) => {
    if (error) {
      console.error('Error al abrir explorador:', error);
      return res.status(500).json({ error: 'No se pudo abrir el explorador de archivos' });
    }
    res.json({ success: true, message: 'Explorador de archivos abierto.' });
  });
});


// Helper for local HTTP GET requests
const http = require('http');
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON response: ' + data.substring(0, 100)));
        }
      });
    }).on('error', reject);
  });
}

// Módulo Producción (resumen_faltantes_parciales)
router.get('/pizarra/resumen_faltantes_parciales', async (req, res) => {
  try {
    const data = await httpGetJson('http://localhost:3002/api/produccion/pedidos-articulos');
    const articulos = data.data || [];
    // Filtrar por estado FALTANTE o PARCIAL, omitiendo ingredientes kit de colaborador
    const faltantes = articulos.filter(a => (a.estado === 'FALTANTE' || a.estado === 'PARCIAL') && !a.es_ingrediente);
    res.json({
      success: true,
      data: faltantes.map(a => ({
        articulo_numero: a.articulo_numero,
        descripcion: a.descripcion,
        faltante: parseFloat(a.faltante) || 0,
        estado: a.estado,
        id_presupuesto_local: a.id_presupuesto_local,
        id_presupuesto_ext: a.id_presupuesto_ext
      }))
    });
  } catch (error) {
    console.error('Error in /pizarra/resumen_faltantes_parciales:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Módulo Logística/Impresión (bandeja_imprimir_modificado)
router.get('/pizarra/bandeja_imprimir_modificado', async (req, res) => {
  try {
    // Usamos el pool centralizado para contar presupuestos activos segregando por su origen.
    // Los presupuestos del portal B2B se cuentan siempre que estén activos y en 'Presupuesto/Orden',
    // sin requerir secuencia de impresión ya que son ingresados directamente para preparación.
    const query = `
      SELECT 
        COUNT(*)::integer as count,
        COUNT(CASE WHEN (agente = 'Portal B2B' OR modificado_portal = true) AND estado = 'Presupuesto/Orden' THEN 1 END)::integer as portal,
        COUNT(CASE WHEN COALESCE(agente, '') != 'Portal B2B' AND COALESCE(modificado_portal, false) = false AND secuencia IN ('Imprimir', 'Imprimir_Modificado') AND estado = 'Presupuesto/Orden' THEN 1 END)::integer as presupuestos
      FROM public.presupuestos
      WHERE activo = true
        AND id NOT IN (
          SELECT id_presupuesto_local 
          FROM public.faltantes_pendientes_compra 
          WHERE estado = 'En espera'
        )
        AND (
          -- Pedidos locales: deben estar listos en secuencia Imprimir/Imprimir_Modificado
          (COALESCE(agente, '') != 'Portal B2B' AND COALESCE(modificado_portal, false) = false AND secuencia IN ('Imprimir', 'Imprimir_Modificado') AND estado = 'Presupuesto/Orden')
          OR
          -- Pedidos del portal: ingresan listos para su preparación
          ((agente = 'Portal B2B' OR modificado_portal = true) AND estado = 'Presupuesto/Orden')
        )
    `;
    const result = await pool.query(query);
    const row = result.rows[0];
    res.json({
      success: true,
      count: row.count || 0,
      portal: row.portal || 0,
      presupuestos: row.presupuestos || 0
    });
  } catch (error) {
    console.error('Error in /pizarra/bandeja_imprimir_modificado:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Módulo Mantenimiento (carpas activas)
router.get('/pizarra/mantenimiento_carpas', async (req, res) => {
  try {
    const data = await httpGetJson('http://localhost:3002/api/produccion/mantenimiento/tratamientos');
    const tratamientos = data.data || [];
    // Filtrar por tratamientos en curso (estado !== 'FINALIZADO')
    const activos = tratamientos.filter(t => t.estado !== 'FINALIZADO');
    res.json({
      success: true,
      data: activos.map(t => {
        const item = t.items && t.items[0] ? t.items[0] : {};
        return {
          id: t.id,
          fecha_inicio_cuarentena: t.fecha_inicio_cuarentena || t.fecha_inicio_armado,
          kilos_brutos_totales: parseFloat(t.kilos_brutos_totales) || 0,
          item_nombre: item.item_nombre || ''
        };
      })
    });
  } catch (error) {
    console.error('Error in /pizarra/mantenimiento_carpas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Módulo Compras Pendientes (artículos derivados en espera)
router.get('/pizarra/compras_pendientes', async (req, res) => {
  try {
    await reconciliarFaltantesConStock(pool);

    const query = `
      SELECT 
        fpc.articulo_numero,
        COALESCE(src.descripcion, a.nombre, fpc.articulo_numero) as descripcion,
        SUM(fpc.cantidad_faltante::numeric) as cantidad_faltante
      FROM public.faltantes_pendientes_compra fpc
      INNER JOIN public.presupuestos p ON p.id = fpc.id_presupuesto_local
      LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = fpc.articulo_numero
      LEFT JOIN public.articulos a ON (a.numero = fpc.articulo_numero OR a.codigo_barras = fpc.articulo_numero)
      WHERE fpc.estado = 'En espera'
        AND p.estado = 'Presupuesto/Orden'
        AND p.activo = true
      GROUP BY fpc.articulo_numero, src.descripcion, a.nombre
      ORDER BY fpc.articulo_numero
    `;
    const result = await pool.query(query);
    res.json({
      success: true,
      data: result.rows.map(r => ({
        articulo_numero: r.articulo_numero,
        descripcion: r.descripcion,
        cantidad_faltante: parseFloat(r.cantidad_faltante) || 0
      }))
    });
  } catch (error) {
    console.error('Error in /pizarra/compras_pendientes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Resumen Operativo Completo para la Pizarra Inteligente (Pedidos Activos, Armados 12h y Compras en Espera)
router.get('/pizarra/resumen_operativo', async (req, res) => {
  try {
    await reconciliarFaltantesConStock(pool);

    const activosQuery = `
      WITH todos_presupuestos_activos AS (
        SELECT DISTINCT p2.id, p2.id_presupuesto_ext
        FROM public.presupuestos p2
        WHERE p2.activo = true 
          AND p2.secuencia IN ('Imprimir', 'Imprimir_Modificado', 'Armar_Pedido')
          AND p2.estado = 'Presupuesto/Orden'
      ),
      pedidos_listos_reservados AS (
        SELECT 
          pd_listo.articulo,
          SUM(COALESCE(pd_listo.cantidad, 0)) as stock_reservado
        FROM public.presupuestos p_listo
        JOIN public.presupuestos_detalles pd_listo ON (pd_listo.id_presupuesto_ext = p_listo.id_presupuesto_ext OR pd_listo.id_presupuesto = p_listo.id)
        WHERE p_listo.activo = true
          AND p_listo.estado = 'Presupuesto/Orden'
          AND p_listo.secuencia IN ('Pedido_Listo', 'Retira_Deposito')
          AND COALESCE(pd_listo.es_saldo_ingrediente, false) = false
          AND p_listo.fecha_actualizacion >= NOW() - INTERVAL '24 hours'
        GROUP BY pd_listo.articulo
      ),
      demanda_global_activa AS (
        SELECT 
          pd_act.articulo,
          SUM(COALESCE(pd_act.cantidad, 0)) as demanda_total,
          COUNT(DISTINCT tpa.id) as pedidos_count
        FROM todos_presupuestos_activos tpa
        JOIN public.presupuestos_detalles pd_act ON (pd_act.id_presupuesto_ext = tpa.id_presupuesto_ext OR pd_act.id_presupuesto = tpa.id)
        WHERE COALESCE(pd_act.es_saldo_ingrediente, false) = false
        GROUP BY pd_act.articulo
      )
      SELECT 
        p.id,
        p.id_presupuesto_ext,
        p.id_cliente,
        COALESCE(NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''), NULLIF(TRIM(c.nombre), ''), 'Cliente ' || p.id_cliente) as cliente_nombre,
        p.agente,
        p.secuencia,
        CASE 
          WHEN p.agente = 'Portal B2B' OR p.modificado_portal = true THEN 'Portal'
          ELSE 'Presupuestos'
        END as origen,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'articulo', pd.articulo,
                'descripcion', COALESCE(ba.descripcion_generada, ba.descripcion, src.descripcion, pd.articulo),
                'cantidad', pd.cantidad,
                'es_saldo_ingrediente', COALESCE(pd.es_saldo_ingrediente, false),
                'kilos_saldo', pd.kilos_saldo,
                'stock_disponible', GREATEST(0, (
                  CASE 
                    WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                    THEN COALESCE(src.stock_consolidado, 0) + FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                    ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                  END
                ) - COALESCE(plr.stock_reservado, 0)),
                'demanda_global', COALESCE(dga.demanda_total, pd.cantidad),
                'pedidos_demandantes', COALESCE(dga.pedidos_count, 1),
                'faltante', CASE 
                  WHEN COALESCE(pd.es_saldo_ingrediente, false) = true THEN 0
                  WHEN (pd.cantidad - GREATEST(0, (
                    CASE 
                      WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                      THEN COALESCE(src.stock_consolidado, 0) + FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                      ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                    END
                  ) - COALESCE(plr.stock_reservado, 0))) <= 0.005 THEN 0
                  ELSE ROUND((pd.cantidad - GREATEST(0, (
                    CASE 
                      WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                      THEN COALESCE(src.stock_consolidado, 0) + FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                      ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                    END
                  ) - COALESCE(plr.stock_reservado, 0)))::numeric, 2)
                END,
                'en_disputa', CASE
                  WHEN COALESCE(pd.es_saldo_ingrediente, false) = true THEN false
                  ELSE (
                    pd.cantidad <= GREATEST(0, (
                      CASE 
                        WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                        THEN COALESCE(src.stock_consolidado, 0) + FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                        ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                      END
                    ) - COALESCE(plr.stock_reservado, 0))
                    AND COALESCE(dga.demanda_total, 0) > GREATEST(0, (
                      CASE 
                        WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                        THEN COALESCE(src.stock_consolidado, 0) + FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                        ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                      END
                    ) - COALESCE(plr.stock_reservado, 0))
                    AND GREATEST(0, (
                      CASE 
                        WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                        THEN COALESCE(src.stock_consolidado, 0) + FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                        ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                      END
                    ) - COALESCE(plr.stock_reservado, 0)) > 0
                  )
                END,
                'estado_stock', CASE
                  WHEN COALESCE(pd.es_saldo_ingrediente, false) = true THEN 'COMPLETO'
                  WHEN (pd.cantidad - GREATEST(0, (
                    CASE 
                      WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                      THEN COALESCE(src.stock_consolidado, 0) + FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                      ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                    END
                  ) - COALESCE(plr.stock_reservado, 0))) > 0.005 THEN 'FALTANTE'
                  WHEN (
                    pd.cantidad <= GREATEST(0, (
                      CASE 
                        WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                        THEN COALESCE(src.stock_consolidado, 0) + FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                        ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                      END
                    ) - COALESCE(plr.stock_reservado, 0))
                    AND COALESCE(dga.demanda_total, 0) > GREATEST(0, (
                      CASE 
                        WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                        THEN COALESCE(src.stock_consolidado, 0) + FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                        ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                      END
                    ) - COALESCE(plr.stock_reservado, 0))
                    AND GREATEST(0, (
                      CASE 
                        WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                        THEN COALESCE(src.stock_consolidado, 0) + FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                        ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                      END
                    ) - COALESCE(plr.stock_reservado, 0)) > 0
                  ) THEN 'EN_DISPUTA'
                  ELSE 'COMPLETO'
                END
              )
            )
            FROM public.presupuestos_detalles pd
            LEFT JOIN public.stock_real_consolidado src ON (src.articulo_numero = pd.articulo OR src.codigo_barras = pd.articulo)
            LEFT JOIN public.stock_real_consolidado hijo ON (hijo.codigo_barras = src.pack_hijo_codigo OR hijo.articulo_numero = src.pack_hijo_codigo)
            LEFT JOIN public.bunker_articulos ba ON (ba.articulo_id = pd.articulo OR ba.articulo_id = src.articulo_numero)
            LEFT JOIN pedidos_listos_reservados plr ON plr.articulo = pd.articulo
            LEFT JOIN demanda_global_activa dga ON dga.articulo = pd.articulo
            WHERE (pd.id_presupuesto_ext = p.id_presupuesto_ext OR pd.id_presupuesto = p.id)
          ),
          '[]'::json
        ) as articulos
      FROM public.presupuestos p
      LEFT JOIN public.clientes c ON c.cliente_id = NULLIF(regexp_replace(p.id_cliente::text, '^0+', ''), '')::integer
      WHERE p.activo = true
        AND p.estado = 'Presupuesto/Orden'
        AND p.secuencia IN ('Imprimir', 'Imprimir_Modificado', 'Armar_Pedido')
        AND p.id NOT IN (
          SELECT id_presupuesto_local 
          FROM public.faltantes_pendientes_compra 
          WHERE estado = 'En espera'
        )
      ORDER BY p.fecha DESC
    `;
    const listosQuery = `
      SELECT 
        p.id,
        p.id_presupuesto_ext,
        p.id_cliente,
        COALESCE(NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''), NULLIF(TRIM(c.nombre), ''), 'Cliente ' || p.id_cliente) as cliente_nombre,
        p.secuencia,
        p.fecha_actualizacion
      FROM public.presupuestos p
      LEFT JOIN public.clientes c ON c.cliente_id = NULLIF(regexp_replace(p.id_cliente::text, '^0+', ''), '')::integer
      WHERE p.activo = true
        AND p.secuencia IN ('Pedido_Listo', 'Retira_Deposito', 'Entregado')
        AND p.fecha_actualizacion >= NOW() - INTERVAL '12 hours'
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 15
    `;
    const esperaQuery = `
      SELECT 
        fpc.articulo_numero,
        COALESCE(src.descripcion, a.nombre, fpc.articulo_numero) as descripcion,
        SUM(fpc.cantidad_faltante::numeric) as cantidad_faltante
      FROM public.faltantes_pendientes_compra fpc
      INNER JOIN public.presupuestos p ON p.id = fpc.id_presupuesto_local
      LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = fpc.articulo_numero
      LEFT JOIN public.articulos a ON (a.numero = fpc.articulo_numero OR a.codigo_barras = fpc.articulo_numero)
      WHERE fpc.estado = 'En espera'
        AND p.estado = 'Presupuesto/Orden'
        AND p.activo = true
      GROUP BY fpc.articulo_numero, src.descripcion, a.nombre
      ORDER BY fpc.articulo_numero
    `;
    const produccionRealizadaQuery = `
      SELECT 
        ca.id,
        ca.carro_id,
        ca.articulo_numero,
        COALESCE(NULLIF(TRIM(ba.descripcion_generada), ''), NULLIF(TRIM(ba.descripcion), ''), NULLIF(TRIM(src.descripcion), ''), ca.descripcion) as descripcion,
        ca.cantidad,
        cp.fecha_confirmacion
      FROM public.carros_articulos ca
      JOIN public.carros_produccion cp ON cp.id = ca.carro_id
      LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ca.articulo_numero
      LEFT JOIN public.stock_real_consolidado src ON (src.articulo_numero = ca.articulo_numero OR src.codigo_barras = ca.articulo_numero)
      WHERE cp.fecha_confirmacion >= NOW() - INTERVAL '12 hours'
      ORDER BY cp.fecha_confirmacion DESC
    `;

    const entregadosSinFacturarQuery = `
      SELECT 
        p.id,
        p.id_cliente,
        COALESCE(NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''), NULLIF(TRIM(c.nombre), ''), 'Cliente ' || p.id_cliente) as cliente_nombre,
        p.estado,
        p.estado_logistico,
        p.fecha,
        p.fecha_entrega,
        p.fecha_entrega_real,
        p.id_ruta,
        r.nombre_ruta,
        (
          SELECT COALESCE(SUM(pd.cantidad * pd.precio1), 0)
          FROM public.presupuestos_detalles pd
          WHERE pd.id_presupuesto = p.id OR pd.id_presupuesto_ext = p.id_presupuesto_ext
        ) as total
      FROM public.presupuestos p
      LEFT JOIN public.clientes c ON c.cliente_id = NULLIF(regexp_replace(p.id_cliente::text, '^0+', ''), '')::integer
      LEFT JOIN public.rutas r ON r.id = p.id_ruta
      LEFT JOIN LATERAL (
        SELECT id, estado, cae
        FROM public.factura_facturas
        WHERE (presupuesto_id = p.id OR (p.factura_id IS NOT NULL AND id = p.factura_id))
          AND tipo_cbte NOT IN (3, 8, 13)
          AND (
            (cae IS NOT NULL AND cae != '')
            OR estado IN ('APROBADA', 'APROBADA_LOCAL')
          )
        ORDER BY id DESC LIMIT 1
      ) f ON true
      WHERE p.activo = true
        AND (
          p.estado_logistico IN ('ENTREGADO', 'ENTREGADO_DEPOSITO', 'RETIRADO')
          OR p.fecha_entrega_real IS NOT NULL
          OR (p.estado IN ('Entregado', 'Retirado') AND (p.fecha >= NOW() - INTERVAL '30 days' OR p.fecha_actualizacion >= NOW() - INTERVAL '30 days'))
        )
        AND f.id IS NULL
        AND (p.id_factura_lomasoft IS NULL OR p.id_factura_lomasoft = '')
        AND (p.comprobante_lomasoft IS NULL OR p.comprobante_lomasoft = '')
        AND p.estado != 'Facturado'
        AND p.estado NOT IN ('Anulado', 'Cancelado')
        AND COALESCE(p.tipo_comprobante, '') NOT IN ('Orden de Retiro')
        AND (p.archivado IS NOT TRUE)
        AND COALESCE(p.fecha_entrega_real, p.fecha_entrega::timestamp, p.fecha::timestamp) >= NOW() - INTERVAL '60 days'
      ORDER BY COALESCE(p.fecha_entrega_real, p.fecha_entrega::timestamp, p.fecha::timestamp) DESC
    `;

    const facturadosRecientesQuery = `
      SELECT 
        p.id,
        p.id_cliente,
        COALESCE(NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''), NULLIF(TRIM(c.nombre), ''), 'Cliente ' || p.id_cliente) as cliente_nombre,
        p.estado,
        p.estado_logistico,
        p.fecha_entrega_real,
        p.id_ruta,
        r.nombre_ruta,
        f.id as factura_id,
        f.cbte_nro,
        f.pto_vta,
        f.tipo_cbte,
        f.serie_interna,
        f.nro_interno,
        f.imp_total,
        f.emitida_en
      FROM public.presupuestos p
      LEFT JOIN public.clientes c ON c.cliente_id = NULLIF(regexp_replace(p.id_cliente::text, '^0+', ''), '')::integer
      LEFT JOIN public.rutas r ON r.id = p.id_ruta
      JOIN LATERAL (
        SELECT id, estado, cbte_nro, imp_total, tipo_cbte, pto_vta, serie_interna, nro_interno, emitida_en
        FROM public.factura_facturas
        WHERE (presupuesto_id = p.id OR (p.factura_id IS NOT NULL AND id = p.factura_id))
          AND tipo_cbte NOT IN (3, 8, 13)
          AND (
            (cae IS NOT NULL AND cae != '')
            OR estado IN ('APROBADA', 'APROBADA_LOCAL')
          )
        ORDER BY id DESC LIMIT 1
      ) f ON true
      WHERE p.activo = true
        AND (
          (p.fecha_entrega_real IS NOT NULL AND f.emitida_en > p.fecha_entrega_real)
          OR (p.fecha_asignacion_ruta IS NOT NULL AND f.emitida_en > p.fecha_asignacion_ruta)
          OR (p.estado_logistico IN ('ENTREGADO', 'ENTREGADO_DEPOSITO', 'RETIRADO') AND f.emitida_en > COALESCE(p.fecha_entrega_real, p.fecha_actualizacion, p.fecha::timestamp))
        )
        AND f.emitida_en >= NOW() - INTERVAL '12 hours'
      ORDER BY f.emitida_en DESC
    `;

    const [activosRes, listosRes, esperaRes, produccionRealizadaRes, demandaSatisfecha, entregadosSinFacturarRes, facturadosRecientesRes, planTrabajoDeposito] = await Promise.all([
      pool.query(activosQuery),
      pool.query(listosQuery),
      pool.query(esperaQuery),
      pool.query(produccionRealizadaQuery),
      obtenerDemandaFaltantes(pool, { soloConStock: true, estado: 'Pendiente' }).catch(err => {
        console.warn('⚠️ Error consultando demanda satisfecha en /pizarra/resumen_operativo:', err.message);
        return [];
      }),
      pool.query(entregadosSinFacturarQuery).catch(err => {
        console.warn('⚠️ Error consultando entregados sin facturar en /pizarra/resumen_operativo:', err.message);
        return { rows: [] };
      }),
      pool.query(facturadosRecientesQuery).catch(err => {
        console.warn('⚠️ Error consultando facturados recientes en /pizarra/resumen_operativo:', err.message);
        return { rows: [] };
      }),
      obtenerPlanTrabajoDeposito(pool).catch(err => {
        console.warn('⚠️ Error consultando plan de trabajo de depósito en /pizarra/resumen_operativo:', err.message);
        return null;
      })
    ]);

    res.json({
      success: true,
      pedidos_activos: activosRes.rows,
      pedidos_armados_12h: listosRes.rows,
      produccion_realizada_12h: produccionRealizadaRes.rows,
      compras_en_espera: esperaRes.rows.map(r => ({
        articulo_numero: r.articulo_numero,
        descripcion: r.descripcion,
        cantidad_faltante: parseFloat(r.cantidad_faltante) || 0
      })),
      demanda_satisfecha: demandaSatisfecha || [],
      presupuestos_entregados_sin_facturar: entregadosSinFacturarRes.rows || [],
      presupuestos_facturados_12h: facturadosRecientesRes.rows || [],
      plan_trabajo_deposito: planTrabajoDeposito
    });
  } catch (error) {
    console.error('Error in /pizarra/resumen_operativo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint dedicado para el Plan de Trabajo Finito de Depósito (Metas por Horizonte 7d / 15d / 30d + Mirada Consciente)
router.get('/pizarra/plan_trabajo_deposito', async (req, res) => {
  try {
    const forceRefresh = req.query.force === 'true' || req.query.force === '1';
    const plan = await obtenerPlanTrabajoDeposito(pool, { forceRefresh });
    res.json(plan);
  } catch (error) {
    console.error('Error in /pizarra/plan_trabajo_deposito:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para consultar trazabilidad integral y empírica de un presupuesto
router.get('/pizarra/presupuestos/:id/trazabilidad', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, error: 'ID de presupuesto inválido' });
    }

    // 1. Presupuesto base + Cliente + Domicilio + Mapeo B2B
    const pQuery = `
      SELECT 
        p.id,
        p.id_presupuesto_ext,
        p.id_cliente,
        p.fecha,
        p.fecha_entrega,
        p.fecha_entrega_real,
        p.fecha_actualizacion,
        p.agente,
        p.tipo_comprobante,
        p.nota,
        p.estado,
        p.secuencia,
        p.estado_logistico,
        p.descuento,
        p.id_ruta,
        p.orden_entrega,
        p.id_domicilio_entrega,
        p.fecha_asignacion_ruta,
        p.origen_facturacion,
        p.origen_numero_factura,
        p.factura_id,
        p.id_factura_lomasoft,
        p.comprobante_lomasoft,
        COALESCE(NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''), NULLIF(TRIM(c.nombre), ''), 'Cliente ' || p.id_cliente) as cliente_nombre,
        c.telefono as cliente_telefono,
        c.celular as cliente_celular,
        c.domicilio as cliente_domicilio,
        c.localidad as cliente_localidad,
        bc.codigo_bunker_cliente,
        bc.razon_social,
        bc.whatsapp_facturas,
        cd.alias as domicilio_alias,
        cd.direccion as domicilio_direccion,
        cd.localidad as domicilio_localidad,
        cd.latitud as domicilio_lat,
        cd.longitud as domicilio_lng,
        b2b.supabase_pedido_id,
        b2b.created_at as b2b_created_at
      FROM public.presupuestos p
      LEFT JOIN public.clientes c ON c.cliente_id = NULLIF(regexp_replace(p.id_cliente::text, '^0+', ''), '')::integer
      LEFT JOIN public.bunker_clientes bc ON (CASE WHEN bc.lomas_soft_id ~ '^\\d+$' THEN bc.lomas_soft_id::integer ELSE NULL END) = c.cliente_id
      LEFT JOIN public.clientes_domicilios cd ON cd.id = p.id_domicilio_entrega
      LEFT JOIN public.b2b_pedidos_mapeo b2b ON b2b.local_presupuesto_id = p.id
      WHERE p.id = $1
      LIMIT 1
    `;
    const pRes = await pool.query(pQuery, [id]);
    if (pRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Presupuesto no encontrado' });
    }
    const p = pRes.rows[0];

    // 2. Ruta y Chofer
    let ruta = null;
    if (p.id_ruta) {
      const rQuery = `
        SELECT 
          r.id,
          r.nombre_ruta,
          r.estado as estado_ruta,
          r.fecha_salida,
          r.fecha_finalizacion,
          r.id_chofer,
          u.nombre_completo as chofer_nombre
        FROM public.rutas r
        LEFT JOIN public.usuarios u ON u.id = r.id_chofer
        WHERE r.id = $1
        LIMIT 1
      `;
      const rRes = await pool.query(rQuery, [p.id_ruta]);
      if (rRes.rows.length > 0) ruta = rRes.rows[0];
    }

    // 3. Eventos de entrega
    const eeQuery = `
      SELECT 
        id,
        tipo_evento,
        fecha_entrega,
        receptor_nombre,
        receptor_vinculo,
        latitud_confirmacion,
        longitud_confirmacion,
        foto_conformidad_url,
        observaciones,
        created_at
      FROM public.entregas_eventos
      WHERE id_presupuesto = $1
      ORDER BY created_at ASC
    `;
    const eeRes = await pool.query(eeQuery, [id]);

    // 4. Snapshots de producción / armado
    const psQuery = `
      SELECT 
        id,
        motivo,
        secuencia_en_snapshot,
        numero_impresion,
        fecha_snapshot
      FROM public.presupuestos_snapshots
      WHERE id_presupuesto = $1
      ORDER BY fecha_snapshot ASC, id ASC
    `;
    const psRes = await pool.query(psQuery, [id]);

    // 5. Historial de cambios de estado
    const pehQuery = `
      SELECT 
        peh.id,
        peh.estado_anterior,
        peh.estado_nuevo,
        peh.metadata,
        peh.fecha_cambio,
        u.nombre_completo as usuario_nombre
      FROM public.presupuestos_estados_historial peh
      LEFT JOIN public.usuarios u ON u.id = peh.usuario_id
      WHERE peh.id_presupuesto = $1
      ORDER BY peh.fecha_cambio ASC
    `;
    const pehRes = await pool.query(pehQuery, [id]);

    // 6. Facturas vinculadas
    const ffQuery = `
      SELECT 
        id,
        pto_vta,
        cbte_nro,
        tipo_cbte,
        imp_total,
        cae,
        cae_vto,
        resultado,
        estado,
        emitida_en,
        es_enviado,
        enviado_at,
        enviado_canal,
        created_at,
        updated_at
      FROM public.factura_facturas
      WHERE presupuesto_id = $1 OR (id = $2 AND $2 IS NOT NULL)
      ORDER BY id DESC
    `;
    const ffRes = await pool.query(ffQuery, [id, p.factura_id]);

    // 7. Resumen de ítems del presupuesto
    const pdQuery = `
      SELECT 
        pd.id,
        pd.articulo,
        pd.cantidad,
        pd.precio1 as precio_unitario,
        (pd.cantidad * pd.precio1) as subtotal,
        COALESCE(
          NULLIF(TRIM(ba.descripcion_generada), ''),
          NULLIF(TRIM(ba.descripcion), ''),
          NULLIF(TRIM(a.nombre), ''),
          pd.articulo
        ) as descripcion
      FROM public.presupuestos_detalles pd
      LEFT JOIN public.articulos a ON (a.codigo_barras = pd.articulo OR a.numero = pd.articulo)
      LEFT JOIN public.bunker_articulos ba ON (ba.articulo_id = pd.articulo OR ba.articulo_id = a.numero)
      WHERE pd.id_presupuesto = $1
      ORDER BY pd.id ASC
    `;
    const pdRes = await pool.query(pdQuery, [id]);

    // Parsear contactos whatsapp de bunker
    let contactosWhatsapp = [];
    if (p.whatsapp_facturas) {
      try {
        const parsed = typeof p.whatsapp_facturas === 'string' ? JSON.parse(p.whatsapp_facturas) : p.whatsapp_facturas;
        if (Array.isArray(parsed)) {
          contactosWhatsapp = parsed.map(c => ({
            nombre: c.nombre || 'Contacto',
            cargo: c.cargo || '',
            numero: c.numero || '',
            es_default: c.default === true || c.default_factura === true || c.default_presupuesto === true
          }));
        }
      } catch (e) {}
    }

    const totalImporte = pdRes.rows.reduce((sum, item) => sum + parseFloat(item.subtotal || 0), 0);
    const totalUnidades = pdRes.rows.reduce((sum, item) => sum + parseFloat(item.cantidad || 0), 0);

    res.json({
      success: true,
      presupuesto: {
        id: p.id,
        id_presupuesto_ext: p.id_presupuesto_ext,
        fecha_administrativa: p.fecha,
        fecha_creacion_portal: p.b2b_created_at,
        supabase_pedido_id: p.supabase_pedido_id,
        agente: p.agente,
        tipo_comprobante: p.tipo_comprobante,
        nota: p.nota,
        estado: p.estado,
        secuencia: p.secuencia,
        estado_logistico: p.estado_logistico,
        descuento: p.descuento,
        total: totalImporte,
        total_unidades: totalUnidades,
        cant_items: pdRes.rows.length,
        origen_canal: p.supabase_pedido_id ? 'Portal B2B' : (p.agente === 'Portal B2B' ? 'Portal B2B' : 'Local / Taller')
      },
      cliente: {
        id: p.id_cliente,
        nombre: p.cliente_nombre,
        codigo_bunker: p.codigo_bunker_cliente,
        razon_social: p.razon_social,
        telefono: p.cliente_telefono,
        celular: p.cliente_celular,
        domicilio: p.cliente_domicilio,
        localidad: p.cliente_localidad,
        contactos_whatsapp: contactosWhatsapp
      },
      domicilio_entrega: {
        id: p.id_domicilio_entrega,
        alias: p.domicilio_alias,
        direccion: p.domicilio_direccion || p.cliente_domicilio,
        localidad: p.domicilio_localidad || p.cliente_localidad,
        lat: p.domicilio_lat,
        lng: p.domicilio_lng
      },
      produccion: {
        secuencia_actual: p.secuencia,
        snapshots: psRes.rows.map(s => ({
          id: s.id,
          motivo: s.motivo,
          secuencia: s.secuencia_en_snapshot,
          numero_impresion: s.numero_impresion,
          fecha: s.fecha_snapshot
        }))
      },
      logistica: {
        id_ruta: p.id_ruta,
        orden_entrega: p.orden_entrega,
        fecha_asignacion_ruta: p.fecha_asignacion_ruta,
        nombre_ruta: ruta ? ruta.nombre_ruta : null,
        estado_ruta: ruta ? ruta.estado_ruta : null,
        chofer_nombre: ruta ? ruta.chofer_nombre : null,
        fecha_salida_ruta: ruta ? ruta.fecha_salida : null,
        fecha_finalizacion_ruta: ruta ? ruta.fecha_finalizacion : null,
        fecha_entrega_real: p.fecha_entrega_real,
        eventos_entrega: eeRes.rows.map(e => ({
          id: e.id,
          tipo_evento: e.tipo_evento,
          fecha_entrega: e.fecha_entrega,
          receptor_nombre: e.receptor_nombre,
          receptor_vinculo: e.receptor_vinculo,
          lat: e.latitud_confirmacion,
          lng: e.longitud_confirmacion
        }))
      },
      comunicacion: {
        contactos_whatsapp: contactosWhatsapp,
        envios_factura_whatsapp: ffRes.rows.filter(f => f.es_enviado).map(f => ({
          factura_id: f.id,
          cbte: `${f.pto_vta}-${f.cbte_nro}`,
          enviado_at: f.enviado_at,
          canal: f.enviado_canal
        })),
        hubo_envio_whatsapp: ffRes.rows.some(f => f.es_enviado)
      },
      facturacion: {
        factura_id_asignada: p.factura_id,
        origen_facturacion: p.origen_facturacion,
        origen_numero_factura: p.origen_numero_factura,
        id_factura_lomasoft: p.id_factura_lomasoft,
        comprobante_lomasoft: p.comprobante_lomasoft,
        facturas: ffRes.rows.map(f => ({
          id: f.id,
          tipo_cbte: f.tipo_cbte,
          pto_vta: f.pto_vta,
          cbte_nro: f.cbte_nro,
          imp_total: parseFloat(f.imp_total),
          cae: f.cae,
          estado: f.estado,
          emitida_en: f.emitida_en,
          es_enviado: f.es_enviado,
          enviado_at: f.enviado_at
        }))
      },
      items: pdRes.rows
    });
  } catch (error) {
    console.error('Error in /pizarra/presupuestos/:id/trazabilidad:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para actualizar estado de demanda faltante (Cubierto, Desestimado, Pendiente)
router.post('/pizarra/demanda-faltantes/:id/estado', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { nuevoEstado, motivo } = req.body;
    const actualizado = await cambiarEstadoFaltante(pool, {
      id,
      nuevoEstado,
      motivo,
      origen: 'pizarra_frontal'
    });
    res.json({ success: true, data: actualizado });
  } catch (error) {
    console.error('Error in POST /pizarra/demanda-faltantes/:id/estado:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para consultar demanda faltante con filtros
router.get('/pizarra/demanda-faltantes', async (req, res) => {
  try {
    const { estado, solo_stock } = req.query;
    const datos = await obtenerDemandaFaltantes(pool, {
      estado: estado || null,
      soloConStock: solo_stock === 'true'
    });
    res.json({ success: true, data: datos });
  } catch (error) {
    console.error('Error in GET /pizarra/demanda-faltantes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Proxy para enviar mensaje de WhatsApp desde microservicio de facturación (puerto 3004)
router.post('/whatsapp/enviar-mensaje', async (req, res) => {
  try {
    const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-mensaje', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Error proxy WhatsApp enviar-mensaje:', error.message);
    res.status(500).json({ success: false, error: 'Servicio de mensajería no disponible', message: error.message });
  }
});

// Proxy para enviar notificación por Email desde microservicio de facturación (puerto 3004)
router.post('/email/enviar-notificacion', async (req, res) => {
  try {
    const response = await fetch('http://localhost:3004/facturacion/email/notificacion/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Error proxy Email enviar-notificacion:', error.message);
    res.status(500).json({ success: false, error: 'Servicio de correo no disponible', message: error.message });
  }
});

// Proxy para actualizar contactos de Bunker en Logística (puerto 3005)
router.patch('/logistica/bunker/clientes/:id/whatsapp-contacts', async (req, res) => {
  try {
    const { id } = req.params;
    const response = await fetch(`http://localhost:3005/api/logistica/bunker/clientes/${id}/whatsapp-contacts`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Error proxy actualizar contactos bunker:', error.message);
    res.status(500).json({ success: false, error: 'Servicio de logística no disponible', message: error.message });
  }
});

// ⚡ Auto-Sync B2B reactivo en segundo plano tras modificaciones locales (ofertas dinámicas, jornadas/tarifas)
const { createB2BAutoSyncMiddleware } = require('../actualizaPrecios/b2bAutoSyncTrigger');
app.use('/api', createB2BAutoSyncMiddleware('etiquetas'));

// Montar las rutas API
app.use('/api', router);
app.use('/api', rutasUsuarios); // 🟩 NUEVAS rutas de usuarios
app.use('/api', rutasJornadas); // ⏱️ NUEVAS rutas de jornadas de colaboradores
app.use('/api', rutasCrmSeguimientos); // 📱 NUEVAS rutas de seguimientos CRM WhatsApp
app.use('/api', rutasCrmWhatsappHub); // 💬 NUEVAS rutas horizontales WhatsApp CRM Bidireccional & Consola 3 Columnas
app.use('/api', rutasOfertasDinamicas); // 🏷️ NUEVAS rutas de ofertas dinámicas y cuotas de stock

// Middleware para manejar errores 404
app.use((req, res, next) => {
  console.error(`404: ${req.method} ${req.url} not found`);
  res.status(404).send('Recurso no encontrado');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
