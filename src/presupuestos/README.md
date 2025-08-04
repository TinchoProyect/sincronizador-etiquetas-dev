# 📊 Módulo de Presupuestos - Sistema LAMDA

## 🎯 Descripción

Módulo independiente para la gestión y visualización de presupuestos integrado con Google Sheets, desarrollado como parte del sistema de gestión LAMDA.

## 🏗️ Arquitectura

- **Puerto**: 3003
- **Base de datos**: PostgreSQL (compartida con sistema principal)
- **Estructura**: MVC con separación de responsabilidades
- **Frontend**: HTML5, CSS3, JavaScript vanilla
- **Backend**: Node.js + Express

## 📁 Estructura del Proyecto

```
src/presupuestos/
├── app.js                    # Servidor principal
├── package.json              # Dependencias y scripts
├── README.md                 # Este archivo
├── config/
│   └── database.js          # Configuración de base de datos
├── controllers/
│   └── presupuestos.js      # Lógica de negocio
├── middleware/
│   └── auth.js              # Middleware de autenticación
├── routes/
│   └── presupuestos.js      # Rutas API
├── pages/
│   └── presupuestos.html    # Vista principal
├── js/
│   └── presupuestos.js      # Lógica del frontend
└── css/
    └── presupuestos.css     # Estilos del módulo
```

## 🚀 Instalación y Configuración

### Prerrequisitos
- Node.js >= 14.0.0
- PostgreSQL
- Sistema LAMDA base funcionando

### Instalación
```bash
cd src/presupuestos
npm install
```

### Configuración de Base de Datos
El módulo utiliza la misma base de datos que el sistema principal (`etiquetas`). Las tablas necesarias se crearán automáticamente en la Fase 2.

### Iniciar el Servidor
```bash
# Modo producción
npm start

# Modo desarrollo (con nodemon)
npm run dev
```

El servidor estará disponible en: `http://localhost:3003`

## 📋 API Endpoints

### Presupuestos
- `GET /api/presupuestos` - Obtener todos los presupuestos
- `GET /api/presupuestos/categoria/:categoria` - Filtrar por categoría
- `GET /api/presupuestos/estadisticas` - Obtener estadísticas generales
- `GET /api/presupuestos/configuracion` - Obtener configuración actual
- `GET /api/presupuestos/health` - Health check del módulo

### Sistema
- `GET /health` - Health check del servidor

## 🔧 Configuración

### Variables de Entorno
```bash
PORT=3003                    # Puerto del servidor
NODE_ENV=development         # Entorno de ejecución
```

### Base de Datos
La configuración de base de datos está en `config/database.js`:
- Host: localhost
- Puerto: 5432
- Base de datos: etiquetas
- Usuario: postgres

## 📊 Funcionalidades Implementadas (Fase 1)

### ✅ Completadas
- [x] Servidor Express independiente
- [x] Conexión a base de datos PostgreSQL
- [x] Middleware de autenticación básico
- [x] Rutas API estructuradas
- [x] Controladores de presupuestos
- [x] Interfaz web responsive
- [x] Sistema de logs de depuración
- [x] Manejo de errores
- [x] Health checks

### 🔄 Pendientes (Próximas Fases)
- [ ] Integración con Google Sheets API
- [ ] Sincronización automática de datos
- [ ] Panel de configuración
- [ ] Autenticación integrada con sistema principal
- [ ] Creación de tablas de base de datos
- [ ] Funcionalidades de CRUD completas

## 🔍 Logs de Depuración

El módulo incluye logs detallados con el prefijo `[PRESUPUESTOS]`:

- `🔍 [PRESUPUESTOS]` - Información general
- `✅ [PRESUPUESTOS]` - Operaciones exitosas
- `⚠️ [PRESUPUESTOS]` - Advertencias
- `❌ [PRESUPUESTOS]` - Errores

## 🧪 Testing

```bash
npm test
```

*Nota: Los tests se implementarán en fases posteriores.*

## 🔗 Integración con Sistema Principal

### Modificaciones Necesarias (Fase 5)

1. **Menú Principal** (`src/app-etiquetas/index.html`):
```html
<a href="http://localhost:3003/pages/presupuestos.html" class="menu-button">
  <span class="icon">💰</span>
  Presupuestos
</a>
```

2. **Proxy** (`src/app-etiquetas/server.js`):
```javascript
app.use('/api/presupuestos', createProxyMiddleware({
  target: 'http://localhost:3003',
  changeOrigin: true
}));
```

3. **CORS** (`src/config/cors.js`):
```javascript
origin: ['http://localhost:3002', 'http://localhost:3003']
```

## 📈 Roadmap

### Fase 1: Infraestructura Base ✅
- Estructura del módulo
- Servidor Express
- Conexión a base de datos
- Middleware básico

### Fase 2: Google Sheets Integration 🔄
- Autenticación Google API
- Servicio de sincronización
- Controladores de Google Sheets

### Fase 3: Backend Completo 🔄
- Esquema de base de datos
- CRUD completo
- Validaciones

### Fase 4: Frontend Avanzado 🔄
- Interfaz de configuración
- Sincronización en tiempo real
- Filtros avanzados

### Fase 5: Integración Final 🔄
- Integración con menú principal
- Autenticación compartida
- Pruebas de integración

## 🛡️ Seguridad

- Middleware de autenticación implementado
- Validación de permisos por ruta
- Manejo seguro de errores
- Logs de auditoría

## 🐛 Troubleshooting

### Puerto en uso
```bash
# Verificar qué proceso usa el puerto 3003
netstat -ano | findstr :3003

# Cambiar puerto en package.json o variable de entorno
PORT=3004 npm start
```

### Error de conexión a base de datos
- Verificar que PostgreSQL esté ejecutándose
- Confirmar credenciales en `config/database.js`
- Verificar que la base de datos `etiquetas` exista

### Problemas de CORS
- Verificar configuración en `app.js`
- Confirmar que los orígenes estén correctos

## 📞 Soporte

Para reportar problemas o solicitar funcionalidades:
1. Verificar logs del servidor
2. Revisar health checks
3. Consultar este README
4. Contactar al equipo de desarrollo

## 📄 Licencia

ISC - Sistema LAMDA

---

**Versión**: 1.0.0  
**Última actualización**: Fase 1 completada  
**Estado**: Infraestructura base implementada ✅
