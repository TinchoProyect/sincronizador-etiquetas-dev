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
    // --- Acceso externo vía DDNS (router TP-Link con Port Forwarding) ---
    'http://lamda-logistica.tplinkdns.com:3005',
    'https://lamda-logistica.tplinkdns.com:3005',
    'http://lamda-logistica.tplinkdns.com'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// 🔐 Importar rutas del sistema de usuarios
const rutasUsuarios = require('../usuarios/rutas');

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

app.use(express.json());

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
  const cantidad = datos.cantidad || 2;

  if (!datos) {
    return res.status(400).json({ error: 'Faltan datos para imprimir' });
  }

  const scriptPath = path.resolve(__dirname, '../scripts/imprimirEtiqueta.js');
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const tempDataPath = path.join(tempDir, 'temp-data.json');
  fs.writeFileSync(tempDataPath, JSON.stringify(datos, null, 2));
  const command = `cd "${path.dirname(__dirname)}" && node "${scriptPath}" ${cantidad}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error al imprimir:', error);
      return res.status(500).json({ error: 'Error al imprimir' });
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
    nombre,
    codigo,
    sector: sector || ''
  };

  // Usar cantidad recibida o fallback a 1
  // El script de impresión espera un entero
  const cantidadImpresion = parseInt(cantidad) || 1;

  const scriptPath = path.resolve(__dirname, '../scripts/imprimirEtiquetaIngrediente.js');
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const tempDataPath = path.join(tempDir, 'temp-ingrediente.json');
  fs.writeFileSync(tempDataPath, JSON.stringify(datos, null, 2));

  // Ejecutar script con la cantidad dinámica
  const command = `cd "${path.dirname(__dirname)}" && node "${scriptPath}" ${cantidadImpresion}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
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

router.post('/sync-b2b', (req, res) => {
  if (isSyncingB2B) {
    return res.status(409).json({ error: 'Ya hay una sincronización en curso. Por favor, espere.' });
  }

  isSyncingB2B = true;
  const scriptPath = path.resolve(__dirname, '../actualizaPrecios/syncB2BPrecios.js');
  console.log(`🚀 [MANUAL-SYNC] Lanzando syncB2BPrecios.js...`);

  const child = fork(scriptPath, [], {
    env: { ...process.env, NODE_ENV: 'production' }
  });

  child.on('close', (code) => {
    isSyncingB2B = false;
    if (code === 0) {
      console.log('✅ [MANUAL-SYNC] Sincronización manual completada con éxito.');
      res.json({ success: true, message: 'La sincronización de catálogo y precios se completó exitosamente.' });
    } else {
      console.error(`❌ [MANUAL-SYNC] Sincronización manual falló con código ${code}.`);
      res.status(500).json({ error: `La sincronización falló con código ${code}.` });
    }
  });

  child.on('error', (err) => {
    isSyncingB2B = false;
    console.error('💥 [MANUAL-SYNC] Error en fork:', err.message);
    res.status(500).json({ error: `Error al iniciar el proceso: ${err.message}` });
  });
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

// Montar las rutas API
app.use('/api', router);
app.use('/api', rutasUsuarios); // 🟩 NUEVAS rutas de usuarios

// Middleware para manejar errores 404
app.use((req, res, next) => {
  console.error(`404: ${req.method} ${req.url} not found`);
  res.status(404).send('Recurso no encontrado');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
