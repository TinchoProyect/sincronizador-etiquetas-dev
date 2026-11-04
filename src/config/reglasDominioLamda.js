/**
 * REGLAS DE DOMINIO Y LÓGICA DE NEGOCIO LAMDA (merchandise_flow_auditor)
 * Mapeo, trazabilidad y costeo dinámico del ciclo de vida de los productos.
 * Consumido por la Pizarra Inteligente de Costos y Sandbox de Precios.
 */

const REGLAS_DOMINIO_LAMDA = {
  // 1. RECEPCIÓN DE LOTES
  RECEPCION_LOTES: {
    nombre: "Recepción de Lotes y Costo FOB",
    descripcion: "Ingreso de compras de proveedores, asignación de costo FOB ($/kg) y vinculación a artículos búnker o ingredientes.",
    calcularCostoPatronIngrediente: (costoFobBulto, kilosUnidad) => {
      if (!kilosUnidad || kilosUnidad <= 0) return 0;
      return Number((costoFobBulto / kilosUnidad).toFixed(2));
    }
  },

  // 2. STOCK CONSOLIDADO
  STOCK_CONSOLIDADO: {
    nombre: "Ecuación de Stock Real Consolidado",
    descripcion: "Control de bultos/cajas en comercialización directa.",
    formula: "stock_real_consolidado = stock_lomasoft + stock_movimientos + stock_ajustes",
    calcularStockConsolidado: (stockLomasoft, stockMovimientos, stockAjustes) => {
      const loma = Number(stockLomasoft || 0);
      const movs = Number(stockMovimientos || 0);
      const ajus = Number(stockAjustes || 0);
      return loma + movs + ajus;
    }
  },

  // 3. DESEMPAQUE / ALIMENTACIÓN A FÁBRICA
  DESEMPAQUE_ALIMENTACION: {
    nombre: "Desempaque de Cajas y Alta de Insumos Sueltos",
    descripcion: "Apertura manual o automática de cajas comerciales vinculada por UUID transaccional unificado.",
    generarTransaccionApertura: ({ codigoCaja, ingredienteId, cantidadCajas, kilosPorCaja, usuarioId, uuid }) => {
      const bultosEgreso = -Math.abs(cantidadCajas);
      const kilosEgreso = -Math.abs(cantidadCajas * kilosPorCaja);
      const kilosIngresoInsumo = Math.abs(cantidadCajas * kilosPorCaja);

      return {
        uuid: uuid || `DESEMPAQUE-${Date.now()}`,
        movimientoComercialEgreso: {
          articulo_numero: codigoCaja,
          cantidad: bultosEgreso,
          kilos: kilosEgreso,
          tipo: 'ingreso a producción',
          observaciones: `Ingreso manual [UUID: ${uuid}]`,
          usuario_id: usuarioId
        },
        movimientoInsumoIngreso: {
          ingrediente_id: ingredienteId,
          kilos: kilosIngresoInsumo,
          tipo: 'ingreso',
          observaciones: `Ingreso manual [UUID: ${uuid}]`
        }
      };
    }
  },

  // 4. PRODUCCIÓN Y MEZCLAS (ROLLUP DE COSTOS EN CARROS)
  PRODUCCION_Y_MEZCLAS: {
    nombre: "Consumo en Carros de Producción y Rollup de Costos",
    descripcion: "Consumo de ingredientes en carros de producción (carro_id) y generación de productos terminados (salida a ventas).",
    calcularCostoTandaCarro: (ingredientesConsumidos) => {
      // ingredientesConsumidos: Array de { ingrediente_id, kilos, costo_patron }
      let costoTotal = 0;
      let kilosTotales = 0;

      ingredientesConsumidos.forEach(item => {
        const kgs = Math.abs(Number(item.kilos || 0));
        const costoKg = Number(item.costo_patron || 0);
        costoTotal += kgs * costoKg;
        kilosTotales += kgs;
      });

      const costoPromedioKg = kilosTotales > 0 ? costoTotal / kilosTotales : 0;

      return {
        costoTotal: Number(costoTotal.toFixed(2)),
        kilosTotales: Number(kilosTotales.toFixed(2)),
        costoPromedioKg: Number(costoPromedioKg.toFixed(2))
      };
    }
  },

  // REGISTRO DE TRAZABILIDAD EVALUADA / AUDITADA (CASO TESTIGO NUEZ PECÁN)
  CASOS_AUDITADOS: {
    NUEZ_PECAN: {
      proveedorOrigen: "Pueblo Viejo",
      loteSupabaseId: "fa9b36c7-009a-472a-8fd1-2fd97879dcf5",
      vinculoId: "9778e3bb-9a92-4eaa-a39c-60581ba430c8",
      articuloBunker: "NPM2X5",
      costoFobBulto: 216652.90,
      kilosUnidadBulto: 10.00,
      ingredienteId: 32,
      ingredienteNombre: "Nuez Pecan Pelada",
      costoPatronIngrediente: 21665.29,
      uuidDesempaque: "4df44016-5161-4440-8f87-a302026471c7",
      carroProduccionId: 2745,
      consumoCarroKg: 0.70,
      costoConsumoCarro: 15165.70,
      productoTerminadoId: "MFSPXK",
      productoTerminadoNombre: "Mix Frutos Secos Premium x Kilo",
      rendimientoCarroKg: 7.00,
      costoTotalTandaCarro: 105281.11,
      costoPromedioKgProductoTerminado: 15040.16
    }
  }
};

module.exports = REGLAS_DOMINIO_LAMDA;
