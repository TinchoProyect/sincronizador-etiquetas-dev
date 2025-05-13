const express = require('express');
const { Pool } = require('pg');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

// Middleware para registrar todas las solicitudes
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

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

// Configurar conexión a la base de datos
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

// Verificar conexión a la base de datos
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error al conectar con la base de datos:', err);
  } else {
    console.log('Conexión a la base de datos establecida');
  }
});

// Configurar rutas API
const router = express.Router();

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

  // Ejecutar script imprimirEtiqueta.js con parámetros
  const scriptPath = path.resolve(__dirname, '../scripts/imprimirEtiqueta.js');
  
  // Guardar datos en temp-data.json dentro del directorio temporal
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

  // Ejecutar script etiquetaTextoManual.js con parámetros
  const scriptPath = path.resolve(__dirname, '../scripts/etiquetaTextoManual.js');
  
  // Guardar datos en temp-texto.json dentro del directorio temporal
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

// Montar las rutas API bajo /api
app.use('/api', router);

// Middleware para manejar errores 404
app.use((req, res, next) => {
  console.error(`404: ${req.method} ${req.url} not found`);
  res.status(404).send('Recurso no encontrado');
});

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
