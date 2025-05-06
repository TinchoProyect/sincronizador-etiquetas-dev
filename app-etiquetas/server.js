const express = require('express');
const { Pool } = require('pg');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

app.get('/api/articulos', async (req, res) => {
  try {
    const result = await pool.query('SELECT numero, nombre, codigo_barras FROM articulos');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener artículos:', error);
    res.status(500).json({ error: 'Error al obtener artículos' });
  }
});

// Eliminada la ruta GET '/' para que express.static sirva index.html automáticamente

// Ruta para imprimir etiquetas normales
app.post('/api/imprimir', (req, res) => {
  const datos = req.body;
  const cantidad = datos.cantidad || 2;

  if (!datos) {
    return res.status(400).json({ error: 'Faltan datos para imprimir' });
  }

  // Ejecutar script imprimirEtiqueta.js con parámetros
  const scriptPath = path.resolve(__dirname, '../imprimirEtiqueta.js');
  const datosStr = JSON.stringify(datos);
  const escapedDatosStr = datosStr.replace(/"/g, '\\"');
  const command = `cd "${path.dirname(__dirname)}" && node "${scriptPath}" "${escapedDatosStr}" ${cantidad}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error al imprimir:', error);
      return res.status(500).json({ error: 'Error al imprimir' });
    }
    console.log('Impresión enviada correctamente.');
    res.json({ message: 'Impresión enviada correctamente' });
  });
});


// Ruta para imprimir etiquetas personalizadas
app.post('/api/imprimir-personalizada', (req, res) => {
  const { datos, cantidad } = req.body;

  if (!datos || !datos.textoPrincipal || !cantidad) {
    return res.status(400).json({ error: 'Faltan datos para imprimir' });
  }

  // Ejecutar script etiquetaTextoManual.js con parámetros
  const scriptPath = path.resolve(__dirname, '../app-etiquetas/etiquetaTextoManual.js');
  const datosStr = JSON.stringify(datos);
  const cantidadNum = parseInt(cantidad, 10);
  const escapedDatosStr = datosStr.replace(/"/g, '\\"');
  const command = `cd "${path.dirname(__dirname)}" && node "${scriptPath}" "${escapedDatosStr}" ${cantidadNum}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error al imprimir:', error);
      return res.status(500).json({ error: 'Error al imprimir' });
    }
    console.log('Impresión personalizada enviada correctamente.');
    res.json({ message: 'Impresión enviada correctamente' });
  });
});

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
