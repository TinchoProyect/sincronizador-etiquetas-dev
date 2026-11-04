/**
 * Inicializa y actualiza la tabla de memoria persistente de planificación e informes en PostgreSQL:
 * public.planificacion_reglas_memoria
 *
 * Permite que todos los agentes y generadores de informes (Día, Semana, Mes) consulten
 * siempre las reglas operativas y de formato vigentes de LAMDA sin que el usuario deba repetirlas.
 */

const pool = require('../src/produccion/config/database');

async function sincronizarMemoriaPlanificacion() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.planificacion_reglas_memoria (
      id SERIAL PRIMARY KEY,
      codigo_regla VARCHAR(80) UNIQUE NOT NULL,
      ambito VARCHAR(50) NOT NULL,
      titulo VARCHAR(160) NOT NULL,
      regla_detalle TEXT NOT NULL,
      parametros_json JSONB DEFAULT '{}'::jsonb,
      activo BOOLEAN DEFAULT true,
      actualizado_en TIMESTAMP DEFAULT NOW()
    );
  `);

  const reglas = [
    {
      codigo: 'FORMATO_PDF_INFORMES_PRODUCCION',
      ambito: 'FORMATO_INFORMES',
      titulo: 'Estándar visual y sintético para PDFs de Producción (Día, Semana, Mes)',
      detalle: '1) Logo oficial de LAMDA (src/app-etiquetas/img/logo_LAMDA.png) siempre arriba a la izquierda sobre encabezado limpio. 2) Cero textos explicativos, cero notas al pie y cero palabras redundantes como Fraccionar: o Fracciones:. 3) Formato estricto por ítem: Nombre exacto del artículo Búnker (CÓDIGO): Cantidad + (tiempo estimado: ~XX min) a la derecha. 4) En Línea 3 (Mixes): Mostrar primera línea Artículo puente: Nombre exacto del puente (CÓDIGO): X kg y debajo las viñetas de cada artículo hijo con Nombre (CÓDIGO): Cantidad (X pack de 10 x 300g).',
      json: {
        logo: 'src/app-etiquetas/img/logo_LAMDA.png',
        incluir_notas_explicativas: false,
        mostrar_tiempo_entre_parentesis: true,
        estructura_item: 'Nombre del artículo (CÓDIGO): Cantidad (tiempo estimado: ~XX min)'
      }
    },
    {
      codigo: 'CAPACIDAD_JORNADA_COLABORADOR',
      ambito: 'METRICAS_TEMPORALES',
      titulo: 'Presupuesto horario por visita del colaborador en depósito',
      detalle: 'Asistencia habitual: 3 a 4 veces por semana. Duración bruta promedio medida en colaboradores_jornadas: 193-195 min (~3h 15m). Descontando 15 min de puesta a punto de mesa/balanza/selladora, cada Jornada (Plan del Día) se presupuesta en ~170 a 180 minutos efectivos (~2h 50m a 3h).',
      json: { minutos_brutos_promedio: 195, minutos_netos_objetivo: 180, visitas_semanales: 3 }
    },
    {
      codigo: 'REGLA_LDN2_EXCLUSION_ABRECAJA_Y_MADRE',
      ambito: 'LINEA_2',
      titulo: 'Exclusión permanente de Abrecajas y Bultos Madre en Línea 2',
      detalle: 'Los artículos que vienen subdivididos de fábrica en cajas de 2x5kg (Abrecaja en despacho: NMELCHx5, NCECAMX5, NMALX5, NCC34/36X5, NCC36+X5) y los que son el propio bulto cerrado de proveedor (PTSx5, PAx5, PALUx5, LNX5, SLX5, TSEx5, ADAX5, HAx5, HDAX5, HIOX5, MCR50/60X5) jamás se asignan como tarea de producción en depósito.',
      json: {
        skus_excluidos: [
          'NMELCHX5', 'NCECAMX5', 'NMALX5', 'NCC34/36X5', 'NCC36+X5',
          'PTSX5', 'PTSX2', 'PTS10X150G', 'PTSX150G',
          'PAX5', 'PALUX5', 'LNX5', 'SLX5', 'TSEX5', 'ADAX5', 'HAX5', 'HDAX5', 'HIOX5', 'MCR50/60X5'
        ]
      }
    },
    {
      codigo: 'REGLA_LDN2_LOTES_Y_VACIADO_ABIERTOS',
      ambito: 'LINEA_2',
      titulo: 'Prohibido pedir 1 unidad suelta: Vaciar abierto en taller o fraccionar bulto entero',
      detalle: 'En Línea 2 nunca se pide hacer 1 bolsa suelta de reposición. Si hay stock abierto en taller (ingredientes.stock_actual >= kilos_unidad), se pide envasar todo el saldo abierto para vaciar el contenedor (ej. 15 kg de Semilla de Zapallo AA -> 3 bolsas de 5 kg). Si hay que abrir bulto cerrado de 25 kg, se pide el bulto entero (5 bolsas de 5 kg = 25 kg); en 1 kg o 2 kg, tandas mínimas de 5 a 10 unidades.',
      json: { lote_bulto_25kg_en_5kg: 5, lote_min_2kg: 5, lote_min_1kg: 5 }
    },
    {
      codigo: 'REGLA_LDN3_CARRO_EXACTO_10KG',
      ambito: 'LINEA_3',
      titulo: 'Cierre exacto de carros de 10 kg en Mixes y packs de 10x300g',
      detalle: 'Todo Mix se elabora en múltiplos de 10 kg en su Artículo Puente (o consume saldo ya abierto en el puente). Las presentaciones hijas de 300g van siempre en múltiplos cerrados de pack de 10 u. (3 kg). La suma de las fracciones debe dar exactamente los kilos del puente para dejar el puente en 0 kg.',
      json: { tanda_kg: 10, pack_300g_unidades: 10 }
    },
    {
      codigo: 'REGLA_LDN456_PREMEZCLAS_Y_LEAD_TIME_UP',
      ambito: 'LINEAS_4_5_6',
      titulo: 'Pre-Mezclas Crudas en stock mínimo y tiempos de ciclo en días (Lead Time UP)',
      detalle: 'En Líneas 5 y 6 (Barritas y Granolas), primero se debe producir en depósito la Pre-Mezcla Cruda (MPB x 4kg ~12 min/u, MPGDSX7 x 7kg ~15 min/u, MPGDFX6,9 x 6.9kg ~12.5 min/u) manteniendo siempre al menos 1-2 bolsas listas en estantería para retiro rápido. Entre que el colaborador retira la mezcla y vuelve horneada pasan 2,50 días promedio en Granolas y 3,15 días en Barritas (4 a 5 días si cruza fin de semana). En Línea 4 (Tostadero), el retorno tarda 2,16 días promedio (5-6 días si cruza fin de semana). Nunca programar el fraccionamiento final el mismo día que se arma la pre-mezcla si no hay base horneada/tostada en taller.',
      json: {
        lead_time_dias: { ldn4_tostadero: 2.16, ldn5_barritas: 3.15, ldn6_granolas: 2.50, cruce_fin_de_semana: 5.0 },
        min_por_premezcla: { MPB: 12.2, MPGDSX7: 15.0, 'MPGDFX6,9': 12.5 },
        min_post_horneado: { ldn5_4cajas_barritas: 65, ldn6_2damezcla_y_fracc: 50, ldn4_tanda_tostado: 27 }
      }
    },
    {
      codigo: 'REGLA_RETIRO_UP_EXTERNA_CRUCE_COMPRAS_DEMANDA',
      ambito: 'LINEAS_4_5_6',
      titulo: 'Formato verticalista de Retiro para Producción Externa (sólo Unidades Productivas a retirar)',
      detalle: 'En el informe PDF de Retiro para Producción Externa (Línea de Negocio 4, 5 y 6): 1) Logo oficial LAMDA arriba a la izquierda. 2) Prohibido mostrar lo que está en verde o lo que NO se lleva, y prohibido poner explicaciones de stock/ventas. 3) Sólo listar de forma verticalista y técnica las Unidades Productivas que el colaborador debe retirar ese día (ej. Mezcla BARRA Flor x 4kg (MPB): 1 unidad productiva (4 cajas de barritas) y Mezcla GRANA Sol x 7kg (MPGDSX7): 1 unidad productiva) junto con la fecha estimada en que debe traer la producción a depósito (ej. entrega estimada: Martes 27/10). El cruce con compras directas a proveedor (EMB-XBN4S5, MRSSGx25, etc.) lo hacen los agentes internamente para filtrar, sin volcar esa prosa al PDF del colaborador.',
      json: {
        mostrar_items_en_verde_no_retirar: false,
        unidad_texto: 'unidad productiva',
        incluir_fecha_estimada_entrega: true,
        bultos_comprados_tostados: ['EMB-XBN4S5', 'MRSSGX25', 'MRSX25G', 'MCVX20']
      }
    },
    {
      codigo: 'REGLA_PACK_500G_GRANOLAS',
      ambito: 'LINEA_6',
      titulo: 'El pack comercial de Granolas de 500g es de 5 x 500g (2,5 kg), nunca de 10 x 500g',
      detalle: 'En Grana Sol (GSX500G / GS5X500G) y Grana Flor (GDFX500G / GDF5X500G), los clientes piden packs de 5 x 500g (2,5 kg) con rotación baja (~1 pack al mes), y en taller siempre se envasan de a 5 unidades. Prohibido pedir packs de 10 x 500g. El volumen fuerte de Granolas está en las bolsas de 1 kg (GSX1: 16 u./mes y GDFX1: 9-18 u./mes).',
      json: {
        GSX500G_pack_unidades: 5,
        GDFX500G_pack_unidades: 5,
        prioridad_fraccionamiento_granola: '1kg (GSX1 / GDFX1)'
      }
    },
    {
      codigo: 'REGLA_CONSOLIDACION_TANDA_MIX_Y_PREMEZCLAS',
      ambito: 'LINEAS_3_5_6',
      titulo: 'Consolidación de tanda: Prohibido partir el mismo Mix o Pre-Mezcla entre semanas consecutivas',
      detalle: 'Preparar la mesa para un Mix o para las Pre-Mezclas Crudas lleva tiempo de acarreo y pesaje. Si un Mix (ej. Mix Salado MSXK) necesita 1 bolsa de 5kg hoy y 2 bolsas de 5kg la semana que viene, se debe programar TODA la tanda junta el mismo día (ej. 20 kg hoy: 3 u. de MSx5 + 10 u. de MSX300G + 1 u. de MSx2 = 20 kg) y no volver a tocar ese Mix la semana siguiente. Lo mismo aplica a las Pre-Mezclas Crudas (MPB, MPGDSX7, MPGDFX6,9): se hacen las 3 unidades de cada una en una sola sesión.',
      json: {
        consolidar_mismo_mix_en_un_solo_dia: true,
        consolidar_premezclas_en_una_sola_tanda: true
      }
    },
    {
      codigo: 'REGLA_STOCK_IDEAL_FINITO_TECHO_MENSUAL',
      ambito: 'TODAS_LAS_LINEAS',
      titulo: 'Principio de Finitud de la Producción y Stock Ideal Mensual',
      detalle: 'El trabajo en depósito DEBE SER FINITO. Cada artículo tiene un Stock Ideal Finito en función de lo que realmente se vende en facturas (30-60 días) y del lote cerrado de taller. Cuando un artículo alcanza su Stock Ideal Finito, no se produce más. Está terminantemente prohibido inventar tareas de relleno (como pedir 5 de ATX1 cuando se vende 1 al mes, o meter bolsitas de 1kg de MFSx1 cuando nadie las pide) sólo para completar horas. Si el Stock Ideal se alcanza antes de completar las 3 horas de una jornada, el sistema debe declarar explícitamente: NO HAY MÁS NADA PARA HACER (Stock Ideal Alcanzado).',
      json: {
        produccion_finita: true,
        prohibido_rellenar_horas_con_baja_rotacion: true,
        stock_ideal_mensual_referencia: {
          BF24X50: 8,
          GSX1: 16,
          GSX500G: 5,
          GDFX1: 12,
          GDFX500G: 5,
          MFSx5: 6,
          MFSX300G: 30,
          MSx5: 3,
          MSX300G: 10,
          MSx2: 2,
          MFSPx5: 2,
          MFSPx300: 20,
          MFSPX2: 2,
          MCTX300: 20,
          'EMB-AI7OIK': 2,
          'APN27/30X5': 6,
          SZAAx5: 5,
          SBX5: 5,
          SNX5: 5,
          MCVX5: 4,
          'MFMMx2,5': 5,
          CCDEX2: 5,
          'EMB-NU9HD0': 4,
          ATySx5: 3,
          CCTX1: 5,
          CCW4X5: 3,
          CCW4x1k: 4
        }
      }
    },
    {
      codigo: 'REGLA_STOCK_CERO_PREVALECE_SOBRE_ESPORADICO',
      ambito: 'TODAS_LAS_LINEAS',
      titulo: 'Stock Cero prevalece siempre sobre el filtro de rotación esporádica (<= 3 ventas en 90d)',
      detalle: 'Ningún artículo con stock_actual <= 0 y ventas activas en los últimos 30-90 días puede ser silenciado como "A pedido (cantidad_sugerida = 0)" por tener entre 1 y 3 ventas trimestrales (como ocurría con SNX5 SEM Sesamo Negro x 5kg, CCDEX2 Coco en Escamas x 2kg, EMB-NU9HD0 Higo Turco x 2kg, MFMMx2,5 Maíz Mostaza y Miel x 2.5kg o los contenedores abiertos de 1kg en taller). Si el stock físico en estantería es 0 y existe materia prima en depósito o contenedor abierto en taller, debe disparar CRITICO_SIN_STOCK y programar el lote cerrado de bulto (ej. 5 u. de SNX5 = 25 kg) o el vaciado del contenedor abierto.',
      json: {
        stock_cero_nunca_a_pedido_si_tuvo_ventas: true,
        skus_rescatados_auditoria: [
          'SNX5', 'CCDEX2', 'EMB-NU9HD0', 'MFMMx2,5', 'GDFX500G',
          'ATySx5', 'CCTX1', 'EMB-JK1OOX', 'EMB-JYS9SJ', 'APN1x1', 'QRX1', 'EMB-9KG3XS'
        ]
      }
    },
    {
      codigo: 'REGLA_BLOQUE_SI_SOBRA_TIEMPO_ADELANTO',
      ambito: 'FORMATO_INFORMES',
      titulo: 'Incluir bloque "SI SOBRA TIEMPO" al pie de la jornada cuando queden quiebres (Stock 0) diferidos a la jornada siguiente',
      detalle: 'Cuando la jornada principal ya tiene su cupo horario completo pero queda algún artículo en stock 0 con materia prima disponible que se pasó para la jornada siguiente (ej. SEM Sesamo Negro x 5kg SNX5: 5 u.), se debe agregar al final del informe un renglón o bloque corto "SI SOBRA TIEMPO:" con esa tarea para que el colaborador pueda adelantarla si termina antes.',
      json: {
        incluir_bloque_si_sobra_tiempo: true
      }
    },
    {
      codigo: 'REGLA_PLAN_A_Y_PLAN_B_MERCADERIA_EN_TRANSITO',
      ambito: 'LINEAS_4_5_6',
      titulo: 'Separar Plan Base Independiente vs Plan A (si trajo producción en tránsito) y verificar carros externos abiertos',
      detalle: 'Antes de programar encajado de Barritas (BF24X50) o fraccionamiento de Granolas (GSX1/GSX500G/GDFX1) en el Plan de Hoy, auditar siempre carros_produccion (WHERE tipo_carro = \'externa\' AND fecha_confirmacion IS NULL) e ingredientes.stock_actual real (descartando saldos residuales de artículos puente como GSGNFX1 si no se descontaron al fraccionar). El cuerpo principal del día debe componerse 100% de tareas con materia prima física hoy en depósito (Plan B), agregando un bloque condicional "PLAN A — SÓLO SI HOY TRAJO LA PRODUCCIÓN EXTERNA EN TRÁNSITO". Asimismo, solo emitir PDF de Retiro Externo si realmente es necesario retirar nuevas unidades productivas según stock + tránsito vs ventas.',
      json: {
        auditar_carros_externos_abiertos: true,
        separar_plan_base_y_plan_a_en_transito: true,
        emitir_retiro_externa_solo_si_necesario: true
      }
    },
    {
      codigo: 'REGLA_ESTANDAR_DOBLE_INFORME_FUNDAMENTALS_Y_CLIP_UI',
      ambito: 'FORMATO_INFORMES',
      titulo: 'Estándar Innegociable de Doble Documento (Operativo + Anexo Fundamentals con Clip 📎) y Finitud Dual (Local + Externa)',
      detalle: 'Todo informe de producción (Plan de Hoy, Retiro de Producción Externa y Plan Semanal de 3 Jornadas) DEBE emitirse siempre en par gemelo: (1) Hoja Operativa 100% técnica para el colaborador y (2) Anexo de Fundamentals y Auditoría Empírica (Fundamentals_*.pdf) elaborado con los 7 subagentes especializados, detallando stock actual, ventas 30d/60d/90d, contenedor abierto/bulto madre, regla de tanda única, descuento automático de carros confirmados el día anterior y demostración de Finitud tanto en producción local como en producción externa (0 tareas pendientes y 0 UPs externas pendientes). En la UI de la Pizarra, el anexo de Fundamentals se vincula mediante un botón compacto de clip (📎 .pizarra-btn-clip-anexo) adosado a la derecha de cada botón principal (.pizarra-pdf-pair), sin botones anchos ni partes blancas.',
      json: {
        doble_documento_obligatorio: true,
        ui_boton_clip_compacto: true,
        finitud_local_y_externa: true,
        descuento_automatico_carros_confirmados_ayer: true,
        comite_7_subagentes_obligatorio: true
      }
    }
  ];

  for (const r of reglas) {
    await pool.query(
      `INSERT INTO public.planificacion_reglas_memoria (codigo_regla, ambito, titulo, regla_detalle, parametros_json, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (codigo_regla) DO UPDATE SET
         ambito = EXCLUDED.ambito,
         titulo = EXCLUDED.titulo,
         regla_detalle = EXCLUDED.regla_detalle,
         parametros_json = EXCLUDED.parametros_json,
         actualizado_en = NOW()`,
      [r.codigo, r.ambito, r.titulo, r.detalle, JSON.stringify(r.json)]
    );
  }

  const res = await pool.query('SELECT codigo_regla, ambito, titulo FROM public.planificacion_reglas_memoria WHERE activo = true ORDER BY id');
  return res.rows;
}

if (require.main === module) {
  sincronizarMemoriaPlanificacion()
    .then(rows => {
      console.log(`✅ Memoria de planificación sincronizada en PostgreSQL (${rows.length} reglas activas):`);
      console.table(rows);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error guardando memoria:', err);
      process.exit(1);
    });
}

module.exports = { sincronizarMemoriaPlanificacion };
