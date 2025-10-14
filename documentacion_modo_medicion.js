/**
 * DOCUMENTACIÓN DEL FLUJO "MODO MEDICIÓN" EN PRODUCCIÓN INDIVIDUAL
 * PARA CARROS DE PRODUCCIÓN INTERNA
 *
 * Este script documenta los archivos, funciones, tablas y campos de base de datos
 * involucrados en el flujo de temporización de etapas en la producción personal.
 */

// ==========================================
// ARCHIVOS PRINCIPALES INVOLUCRADOS
// ==========================================

const archivosInvolucrados = {
  // Archivo HTML principal
  "src/produccion/pages/produccion_personal.html": {
    descripcion: "Página principal de producción personal donde se activa el modo medición",
    elementos: [
      "#btn-temporizador-global - Botón para activar/desactivar modo medición",
      "#btn-etapa1 - Botón para iniciar/parar Etapa 1",
      "#btn-etapa3 - Botón para iniciar/parar Etapa 3",
      "#badge-etapa2 - Badge que muestra el tiempo de Etapa 2",
      ".btn-temporizador-articulo - Botones para medir tiempo por artículo"
    ]
  },

  // Archivos JavaScript
  "src/produccion/js/temporizador_carro.js": {
    descripcion: "Módulo principal que maneja toda la lógica de temporización",
    funciones: [
      "initTemporizadores() - Inicializa event listeners y estado",
      "startEtapa1(carroId, uid) - Inicia Etapa 1",
      "stopEtapa1(carroId, uid) - Detiene Etapa 1",
      "startEtapa2(carroId, uid) - Inicia Etapa 2",
      "stopEtapa2(carroId, uid) - Detiene Etapa 2",
      "startEtapa3(carroId, uid) - Inicia Etapa 3",
      "stopEtapa3(carroId, uid) - Detiene Etapa 3",
      "syncTimerButtonsVisibility() - Sincroniza visibilidad de botones",
      "rehidratarDesdeEstado(carroId) - Restaura estado desde localStorage",
      "importarEstadoLocal(carroId, estado) - Importa estado del backend",
      "clearTimersForCarro(carroId) - Limpia temporizadores al eliminar carro"
    ]
  },

  "src/produccion/js/carro.js": {
    descripcion: "Maneja la lógica de carros y integración con temporización",
    funciones: [
      "seleccionarCarro(carroId) - Selecciona carro y rehidrata temporizadores",
      "deseleccionarCarro() - Deselecciona carro y limpia temporizadores",
      "crearNuevoCarro(tipoCarro) - Crea nuevo carro (tipo 'interna' por defecto)",
      "actualizarEstadoCarro() - Actualiza UI de carros disponibles"
    ]
  },

  "src/produccion/js/produccion_personal.js": {
    descripcion: "Inicializa la página y coordina funciones",
    funciones: [
      "carroPreparadoConTemporizador(carroId) - Marca carro listo y inicia Etapa 2",
      "asentarProduccionConTemporizador(carroId) - Asienta producción e inicia Etapa 3",
      "inicializarEspacioTrabajo() - Configura la página al cargar"
    ]
  }
};

// ==========================================
// FUNCIONES CLAVE Y SU FLUJO
// ==========================================

const flujoModoMedicion = {
  activacion: {
    paso: "Usuario hace clic en '⏱ Modo medición'",
    archivo: "temporizador_carro.js",
    funcion: "initTemporizadores() -> event listener en #btn-temporizador-global",
    acciones: [
      "Alterna clase 'activo' en el botón",
      "Muestra/oculta botones de temporización",
      "Llama a syncTimerButtonsVisibility()",
      "Si hay carro activo, importa estado del backend y rehidrata UI"
    ]
  },

  etapa1: {
    inicio: {
      paso: "Usuario hace clic en '▶️ Iniciar etapa 1'",
      archivo: "temporizador_carro.js",
      funcion: "startEtapa1(carroId, uid)",
      acciones: [
        "POST a /api/tiempos/carro/{id}/etapa/1/iniciar",
        "Inicia intervalo de tick cada 1s",
        "Actualiza UI del botón",
        "Bloquea botones de artículos (setEtapaCarro(1))"
      ]
    },
    fin: {
      paso: "Usuario hace clic en '⏹️ Pausar etapa 1'",
      archivo: "temporizador_carro.js",
      funcion: "stopEtapa1(carroId, uid)",
      acciones: [
        "POST a /api/tiempos/carro/{id}/etapa/1/finalizar",
        "Detiene intervalo",
        "Actualiza UI del botón",
        "Mantiene bloqueo de artículos"
      ]
    }
  },

  etapa2: {
    inicio: {
      paso: "Automático al marcar 'Carro listo para producir'",
      archivo: "produccion_personal.js",
      funcion: "carroPreparadoConTemporizador(carroId)",
      acciones: [
        "Llama a stopEtapa1()",
        "Llama a startEtapa2()",
        "Llama a marcarCarroPreparado()"
      ]
    },
    fin: {
      paso: "Automático al 'Asentar producción'",
      archivo: "produccion_personal.js",
      funcion: "asentarProduccionConTemporizador(carroId)",
      acciones: [
        "Llama a stopEtapa2()",
        "Llama a startEtapa3()",
        "Llama a finalizarProduccion()"
      ]
    }
  },

  etapa3: {
    inicio: {
      paso: "Automático al asentar producción",
      archivo: "temporizador_carro.js",
      funcion: "startEtapa3(carroId, uid)",
      acciones: [
        "POST a /api/tiempos/carro/{id}/etapa/3/iniciar",
        "Detiene temporizadores de artículos en curso (_detenerMedicionArticulosEnCurso)",
        "Inicia intervalo de tick",
        "Muestra botón Etapa 3"
      ]
    },
    fin: {
      paso: "Usuario hace clic en '⏸️ Pausar etapa 3'",
      archivo: "temporizador_carro.js",
      funcion: "stopEtapa3(carroId, uid)",
      acciones: [
        "POST a /api/tiempos/carro/{id}/etapa/3/finalizar",
        "Detiene intervalo",
        "Actualiza UI del botón"
      ]
    }
  },

  articulos: {
    inicio: {
      paso: "Usuario hace clic en '⏱ Iniciar' en un artículo",
      archivo: "temporizador_carro.js",
      funcion: "event listener en .btn-temporizador-articulo",
      acciones: [
        "Verifica que no esté en Etapa 1",
        "POST a /api/tiempos/carro/{id}/articulo/{numero}/iniciar",
        "Inicia intervalo de tick",
        "Actualiza UI del botón",
        "Guarda en localStorage"
      ]
    },
    fin: {
      paso: "Usuario hace clic en '⏹️ Detener' en un artículo",
      archivo: "temporizador_carro.js",
      funcion: "event listener en .btn-temporizador-articulo",
      acciones: [
        "POST a /api/tiempos/carro/{id}/articulo/{numero}/finalizar",
        "Detiene intervalo",
        "Actualiza UI del botón",
        "Guarda en localStorage"
      ]
    }
  }
};

// ==========================================
// TABLAS Y CAMPOS DE BASE DE DATOS REALES
// ==========================================

const tablasBaseDatos = {
  // Tabla principal de carros de producción (incluye campos de etapas)
  "carros_produccion": {
    descripcion: "Tabla principal que almacena carros de producción y sus etapas de medición",
    campos: {
      id: "ID único del carro",
      usuario_id: "ID del usuario propietario",
      fecha_inicio: "Timestamp de creación del carro",
      fecha_confirmacion: "Timestamp de finalización del carro",
      en_auditoria: "Flag para carros en auditoría",
      fecha_preparado: "Timestamp cuando el carro fue marcado como preparado",
      tipo_carro: "Tipo de carro ('interna' o 'externa')",
      // Campos de etapas
      etapa1_inicio: "Timestamp de inicio de Etapa 1",
      etapa1_fin: "Timestamp de fin de Etapa 1",
      etapa1_duracion_ms: "Duración total de Etapa 1 en milisegundos",
      etapa2_inicio: "Timestamp de inicio de Etapa 2",
      etapa2_fin: "Timestamp de fin de Etapa 2",
      etapa2_duracion_ms: "Duración total de Etapa 2 en milisegundos",
      etapa3_inicio: "Timestamp de inicio de Etapa 3",
      etapa3_fin: "Timestamp de fin de Etapa 3",
      etapa3_duracion_ms: "Duración total de Etapa 3 en milisegundos"
    },
    endpoints: [
      "GET /api/tiempos/carro/{id}/etapas/estado - Obtiene estado actual de etapas",
      "POST /api/tiempos/carro/{id}/etapa/{n}/iniciar - Inicia etapa N",
      "POST /api/tiempos/carro/{id}/etapa/{n}/finalizar - Finaliza etapa N"
    ]
  },

  // Tabla de artículos en carros (con mediciones de tiempo)
  "carros_articulos": {
    descripcion: "Almacena los artículos agregados a un carro y sus mediciones de tiempo",
    campos: {
      id: "ID único del registro",
      carro_id: "ID del carro de producción (FK a carros_produccion.id)",
      articulo_numero: "Código/número del artículo",
      descripcion: "Descripción del artículo",
      cantidad: "Cantidad del artículo en el carro",
      tiempo_inicio: "Timestamp de inicio de medición del artículo",
      tiempo_fin: "Timestamp de fin de medición del artículo",
      duracion_ms: "Duración total de medición en milisegundos"
    },
    endpoints: [
      "GET /api/tiempos/carro/{id}/articulos/estado - Obtiene estado de mediciones de artículos",
      "POST /api/tiempos/carro/{id}/articulo/{numero}/iniciar - Inicia medición de artículo",
      "POST /api/tiempos/carro/{id}/articulo/{numero}/finalizar - Finaliza medición de artículo"
    ]
  }
};

// ==========================================
// LOCALSTORAGE KEYS
// ==========================================

const localStorageKeys = {
  "timers_carro_{carroId}": "Estado de etapas del carro (snapshot local)",
  "timers_articulos_{carroId}": "Estado de artículos del carro (snapshot local)",
  "carroActivo": "ID del carro actualmente activo",
  "colaboradorActivo": "Datos del colaborador activo (JSON)",
  "carro:{carroId}:etapa": "Etapa actual del carro (fallback)"
};

// ==========================================
// DEPENDENCIAS Y UTILIDADES
// ==========================================

const dependencias = {
  "utilsEtapasMedicion.js": {
    funciones: [
      "setEtapaCarro(carroId, etapa) - Establece etapa actual",
      "getEtapaCarro(carroId) - Obtiene etapa actual",
      "esEtapa1(carroId) - Verifica si está en etapa 1"
    ]
  },

  "carroPreparado.js": {
    funciones: [
      "marcarCarroPreparado(carroId) - Marca carro como preparado",
      "finalizarProduccion(carroId) - Finaliza producción del carro",
      "actualizarVisibilidadBotones() - Actualiza visibilidad de botones UI"
    ]
  }
};

// ==========================================
// RESUMEN EJECUTIVO
// ==========================================

console.log("=== DOCUMENTACIÓN MODO MEDICIÓN ===");
console.log("Archivos principales:", Object.keys(archivosInvolucrados));
console.log("Funciones clave:", Object.keys(flujoModoMedicion));
console.log("Tablas BD:", Object.keys(tablasBaseDatos));
console.log("Endpoints API:", [
  "/api/tiempos/carro/{id}/etapas/estado",
  "/api/tiempos/carro/{id}/etapa/{n}/iniciar",
  "/api/tiempos/carro/{id}/etapa/{n}/finalizar",
  "/api/tiempos/carro/{id}/articulos/estado",
  "/api/tiempos/carro/{id}/articulo/{numero}/iniciar",
  "/api/tiempos/carro/{id}/articulo/{numero}/finalizar"
]);

// Exportar para uso en otros scripts si es necesario
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    archivosInvolucrados,
    flujoModoMedicion,
    tablasBaseDatos,
    localStorageKeys,
    dependencias
  };
}
