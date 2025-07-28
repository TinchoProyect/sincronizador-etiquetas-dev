# 📋 Endpoints Requeridos para Historial de Inventarios

Este documento describe los endpoints que deben ser implementados en el backend para que la funcionalidad de "Historial de Inventarios" funcione correctamente.

## 🎯 Endpoints Necesarios

### 1. **GET** `/api/produccion/inventarios/historial`

**Descripción:** Obtiene la lista de todos los inventarios realizados con información resumida.

**Respuesta esperada:**
```json
[
  {
    "inventario_id": 1,
    "fecha_creacion": "2024-01-15T10:30:00.000Z",
    "usuario_id": 5,
    "total_articulos": 45,
    "total_diferencias": 3
  },
  {
    "inventario_id": 2,
    "fecha_creacion": "2024-01-20T14:15:00.000Z",
    "usuario_id": 8,
    "total_articulos": 67,
    "total_diferencias": 0
  }
]
```

**Query SQL sugerida:**
```sql
SELECT 
    inventario_id,
    fecha_creacion,
    usuario_id,
    COUNT(DISTINCT articulo_numero) as total_articulos,
    COUNT(CASE WHEN stock_sistema != stock_contado THEN 1 END) as total_diferencias
FROM inventario_general_articulos_registro
GROUP BY inventario_id, fecha_creacion, usuario_id
ORDER BY fecha_creacion DESC;
```

---

### 2. **GET** `/api/produccion/inventarios/:inventarioId/stock-registrado`

**Descripción:** Obtiene todos los artículos registrados en un inventario específico.

**Parámetros:**
- `inventarioId` (number): ID del inventario

**Respuesta esperada:**
```json
[
  {
    "articulo_numero": "ART001",
    "nombre_articulo": "Producto Ejemplo 1",
    "stock_sistema": 100.50,
    "stock_contado": 98.00,
    "fecha_registro": "2024-01-15T10:35:00.000Z"
  },
  {
    "articulo_numero": "ART002",
    "nombre_articulo": "Producto Ejemplo 2",
    "stock_sistema": 50.00,
    "stock_contado": 50.00,
    "fecha_registro": "2024-01-15T10:40:00.000Z"
  }
]
```

**Query SQL sugerida:**
```sql
SELECT 
    igar.articulo_numero,
    a.nombre as nombre_articulo,
    igar.stock_sistema,
    igar.stock_contado,
    igar.fecha_registro
FROM inventario_general_articulos_registro igar
LEFT JOIN articulos a ON a.numero = igar.articulo_numero
WHERE igar.inventario_id = $1
ORDER BY igar.fecha_registro ASC;
```

---

### 3. **GET** `/api/produccion/inventarios/:inventarioId/diferencias`

**Descripción:** Obtiene solo los artículos que tuvieron diferencias en un inventario específico.

**Parámetros:**
- `inventarioId` (number): ID del inventario

**Respuesta esperada:**
```json
[
  {
    "articulo_numero": "ART001",
    "nombre_articulo": "Producto Ejemplo 1",
    "stock_sistema": 100.50,
    "stock_contado": 98.00,
    "fecha_registro": "2024-01-15T10:35:00.000Z"
  },
  {
    "articulo_numero": "ART003",
    "nombre_articulo": "Producto Ejemplo 3",
    "stock_sistema": 25.00,
    "stock_contado": 30.00,
    "fecha_registro": "2024-01-15T10:45:00.000Z"
  }
]
```

**Query SQL sugerida:**
```sql
SELECT 
    igad.articulo_numero,
    a.nombre as nombre_articulo,
    igad.stock_sistema,
    igad.stock_contado,
    igad.fecha_registro
FROM inventario_general_articulos_diferencias igad
LEFT JOIN articulos a ON a.numero = igad.articulo_numero
WHERE igad.inventario_id = $1
ORDER BY ABS(igad.stock_contado - igad.stock_sistema) DESC;
```

---

## 🗄️ Estructura de Tablas Asumida

Basándome en la información proporcionada, asumo que existen estas tablas:

### `inventario_general_articulos_registro`
```sql
CREATE TABLE inventario_general_articulos_registro (
    id SERIAL PRIMARY KEY,
    inventario_id INTEGER NOT NULL,
    articulo_numero VARCHAR(50) NOT NULL,
    stock_sistema DECIMAL(10,2) NOT NULL,
    stock_contado DECIMAL(10,2) NOT NULL,
    usuario_id INTEGER NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `inventario_general_articulos_diferencias`
```sql
CREATE TABLE inventario_general_articulos_diferencias (
    id SERIAL PRIMARY KEY,
    inventario_id INTEGER NOT NULL,
    articulo_numero VARCHAR(50) NOT NULL,
    stock_sistema DECIMAL(10,2) NOT NULL,
    stock_contado DECIMAL(10,2) NOT NULL,
    diferencia DECIMAL(10,2) NOT NULL,
    usuario_id INTEGER NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `articulos` (ya existente)
```sql
-- Tabla ya existente con información de artículos
-- Campos relevantes: numero, nombre
```

### `usuarios` (ya existente)
```sql
-- Tabla ya existente con información de usuarios
-- Campos relevantes: id, nombre_completo
```

---

## 🚀 Implementación Sugerida

### Archivo: `src/produccion/controllers/historialInventarios.js`

```javascript
const pool = require('../config/database');

/**
 * Obtiene el historial de inventarios
 */
async function obtenerHistorialInventarios(req, res) {
    try {
        const query = `
            SELECT 
                inventario_id,
                MIN(fecha_registro) as fecha_creacion,
                usuario_id,
                COUNT(DISTINCT articulo_numero) as total_articulos,
                COUNT(CASE WHEN stock_sistema != stock_contado THEN 1 END) as total_diferencias
            FROM inventario_general_articulos_registro
            GROUP BY inventario_id, usuario_id
            ORDER BY MIN(fecha_registro) DESC
        `;
        
        const result = await pool.query(query);
        res.json(result.rows);
        
    } catch (error) {
        console.error('Error al obtener historial de inventarios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

/**
 * Obtiene el stock registrado de un inventario específico
 */
async function obtenerStockRegistrado(req, res) {
    try {
        const { inventarioId } = req.params;
        
        const query = `
            SELECT 
                igar.articulo_numero,
                a.nombre as nombre_articulo,
                igar.stock_sistema,
                igar.stock_contado,
                igar.fecha_registro
            FROM inventario_general_articulos_registro igar
            LEFT JOIN articulos a ON a.numero = igar.articulo_numero
            WHERE igar.inventario_id = $1
            ORDER BY igar.fecha_registro ASC
        `;
        
        const result = await pool.query(query, [inventarioId]);
        res.json(result.rows);
        
    } catch (error) {
        console.error('Error al obtener stock registrado:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

/**
 * Obtiene las diferencias de un inventario específico
 */
async function obtenerDiferencias(req, res) {
    try {
        const { inventarioId } = req.params;
        
        const query = `
            SELECT 
                igad.articulo_numero,
                a.nombre as nombre_articulo,
                igad.stock_sistema,
                igad.stock_contado,
                igad.fecha_registro
            FROM inventario_general_articulos_diferencias igad
            LEFT JOIN articulos a ON a.numero = igad.articulo_numero
            WHERE igad.inventario_id = $1
            ORDER BY ABS(igad.stock_contado - igad.stock_sistema) DESC
        `;
        
        const result = await pool.query(query, [inventarioId]);
        res.json(result.rows);
        
    } catch (error) {
        console.error('Error al obtener diferencias:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

module.exports = {
    obtenerHistorialInventarios,
    obtenerStockRegistrado,
    obtenerDiferencias
};
```

### Archivo: `src/produccion/routes/historialInventarios.js`

```javascript
const express = require('express');
const router = express.Router();
const {
    obtenerHistorialInventarios,
    obtenerStockRegistrado,
    obtenerDiferencias
} = require('../controllers/historialInventarios');

// Rutas para historial de inventarios
router.get('/inventarios/historial', obtenerHistorialInventarios);
router.get('/inventarios/:inventarioId/stock-registrado', obtenerStockRegistrado);
router.get('/inventarios/:inventarioId/diferencias', obtenerDiferencias);

module.exports = router;
```

### Integración en el archivo principal de rutas

En `src/produccion/routes/produccion.js`, agregar:

```javascript
const historialInventariosRoutes = require('./historialInventarios');

// Usar las rutas de historial de inventarios
router.use('/', historialInventariosRoutes);
```

---

## ✅ Estado Actual

- ✅ **Frontend completamente implementado**
- ✅ **Interfaz de usuario funcional**
- ✅ **Manejo de errores robusto**
- ❌ **Endpoints del backend pendientes de implementación**

## 🔧 Próximos Pasos

1. Implementar los 3 endpoints descritos arriba
2. Verificar que las tablas `inventario_general_articulos_registro` e `inventario_general_articulos_diferencias` existen
3. Probar la funcionalidad completa
4. Ajustar queries SQL según la estructura real de las tablas si es necesario

---

## 📞 Contacto

Si necesitas ayuda con la implementación de estos endpoints o tienes preguntas sobre la estructura de datos, no dudes en consultar.
