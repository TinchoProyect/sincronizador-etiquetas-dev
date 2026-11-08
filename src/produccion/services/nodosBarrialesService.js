/**
 * ============================================================================
 * SERVICIO INTEGRAL: NODOS BARRIALES (MARCA BLANCA) - ETAPA 1
 * ============================================================================
 * Conecta el padrón exclusivo de Nodos Barriales, el ABM de Nodos (con logo
 * térmico ZPL ^GFA y vínculo contable a bunker_clientes / factura_cuentas_corrientes /
 * fin_cuentas_bancarias) y el Cotizador de Propuestas de Fracciones directamente
 * con los 6 Flujos de Costos de la Pizarra Inteligente LAMDA.
 */

const db = require('../config/database');
const {
    convertirLogoAZplGfa,
    generarEtiquetaZplParNodo,
    generarPreviewVisualEtiquetaPar,
    generarPreviewVisualCanastoQrMaestro
} = require('../utils/zplLogoConverter');

let esquemaInicializado = false;

/**
 * Clasifica un ingrediente o artículo en uno de los 6 Flujos del Modelo de Dominio LAMDA
 */
function clasificarIngredienteEnFlujo(ing, idsCompuestosSet) {
    const id = Number(ing.id);
    const nombreLower = String(ing.nombre || '').toLowerCase();
    const artVinc = String(ing.articulo_vinculado_numero || '').toUpperCase();

    // Flujo 6: Doble Mezcla / Granola Compleja
    if (
        [122, 131, 132, 134].includes(id) ||
        nombreLower.includes('grana') ||
        artVinc.startsWith('GS') ||
        artVinc.startsWith('GF')
    ) {
        return {
            flujo: 6,
            flujo_nombre: '[LDN 6] Granolas (Doble Mezcla + UP)',
            origen_tipo: 'UP_EXTERNA'
        };
    }

    // Flujo 5: Barritas (Mezcla Interna + UP Externa)
    if (
        [109, 141].includes(id) ||
        nombreLower.includes('barrit') ||
        artVinc.startsWith('BF')
    ) {
        return {
            flujo: 5,
            flujo_nombre: '[LDN 5] Barritas (Mezcla Interna + UP)',
            origen_tipo: 'UP_EXTERNA'
        };
    }

    // Flujo 4: Tostaderos (Unidad Productiva Externa Simple)
    if (
        [18, 38, 41, 56, 57, 123, 166].includes(id) ||
        nombreLower.includes('tostad')
    ) {
        return {
            flujo: 4,
            flujo_nombre: '[LDN 4] Tostaderos (UP Externa Simple)',
            origen_tipo: 'UP_EXTERNA'
        };
    }

    // Flujo 3: Mixes (Mezclas Internas a Fracciones)
    if (
        idsCompuestosSet.has(id) ||
        nombreLower.includes('mix') ||
        artVinc.startsWith('MFS') ||
        artVinc.startsWith('MCT') ||
        artVinc.startsWith('MSX')
    ) {
        return {
            flujo: 3,
            flujo_nombre: '[LDN 3] Mixes (Mezcla Interna)',
            origen_tipo: 'MIX'
        };
    }

    // Flujo 2: Fraccionados de Bulto Cerrado (Mono-Ingredientes 100% Puros)
    return {
        flujo: 2,
        flujo_nombre: '[LDN 2] Mono-Ingrediente Fraccionado',
        origen_tipo: 'INGREDIENTE'
    };
}

/**
 * Fórmula exacta del Cotizador de Nodos LAMDA:
 * PrecioBaseNodo = ((CostoInsumoKg * KilosFraccion + CostoEnvase) * (1 + MargenLAMDA%/100) + CostoTiempoMO) * (1 + (IVA% + IIBB%)/100)
 */
function calcularEstructuraCostosNodo(params = {}) {
    const costoInsumoKg = Math.max(0, Number(params.costo_insumo_kg) || 0);
    const kilosUnidad = Math.max(0.001, Number(params.kilos_unidad) || 0.25);
    const costoEnvaseUnitario = Math.max(0, Number(params.costo_envase_unitario) || 0);
    const cantidadEnvases = Math.max(0, Number(params.cantidad_envases_unidad ?? 1));
    const segundosFraccionamiento = Math.max(0, Number(params.segundos_fraccionamiento ?? 35));
    const valorHoraAplicado = Math.max(0, Number(params.valor_hora_aplicado ?? 7000));
    const margenLamdaPct = Math.max(0, Number(params.margen_lamda_pct ?? 22));
    const ivaPct = Math.max(0, Number(params.iva_pct ?? 21));
    const iibbPct = Math.max(0, Number(params.iibb_pct ?? 3.5));
    const margenSugeridoGestorPct = Math.max(0, Number(params.margen_sugerido_gestor_pct ?? 28));

    const costoInsumoFraccion = Number((costoInsumoKg * kilosUnidad).toFixed(2));
    const costoEnvaseAplicado = Number((costoEnvaseUnitario * cantidadEnvases).toFixed(2));
    const costoManoObraAplicado = Number(((segundosFraccionamiento / 3600) * valorHoraAplicado).toFixed(2));

    const costoMateriaYEnvase = costoInsumoFraccion + costoEnvaseAplicado;
    const costoPuroTotal = Number((costoMateriaYEnvase + costoManoObraAplicado).toFixed(2));

    const gananciaLamdaNeta = Number((costoMateriaYEnvase * (margenLamdaPct / 100)).toFixed(2));
    const precioBaseNodoNeto = Number((costoMateriaYEnvase + gananciaLamdaNeta + costoManoObraAplicado).toFixed(2));

    const coefImpuestos = 1 + (ivaPct + iibbPct) / 100;
    const montoImpuestos = Number((precioBaseNodoNeto * ((ivaPct + iibbPct) / 100)).toFixed(2));
    const precioBaseNodoFinal = Math.round(precioBaseNodoNeto * coefImpuestos);

    // Redondeo comercial amigable para vecino (múltiplo de $50)
    const rawVecino = precioBaseNodoFinal * (1 + margenSugeridoGestorPct / 100);
    const precioSugeridoVecino = Math.ceil(rawVecino / 50) * 50;
    const gananciaUnitariaGestor = Math.max(0, precioSugeridoVecino - precioBaseNodoFinal);

    return {
        costo_insumo_kg: Number(costoInsumoKg.toFixed(2)),
        kilos_unidad: Number(kilosUnidad.toFixed(4)),
        costo_insumo_fraccion: costoInsumoFraccion,
        costo_envase_aplicado: costoEnvaseAplicado,
        segundos_fraccionamiento: Number(segundosFraccionamiento.toFixed(2)),
        valor_hora_aplicado: Number(valorHoraAplicado.toFixed(2)),
        costo_mano_obra_aplicado: costoManoObraAplicado,
        costo_puro_total: costoPuroTotal,
        margen_lamda_pct: Number(margenLamdaPct.toFixed(2)),
        ganancia_lamda_neta: gananciaLamdaNeta,
        precio_base_nodo_neto: precioBaseNodoNeto,
        iva_pct: Number(ivaPct.toFixed(2)),
        iibb_pct: Number(iibbPct.toFixed(2)),
        monto_impuestos: montoImpuestos,
        precio_base_nodo_final: precioBaseNodoFinal,
        margen_sugerido_gestor_pct: Number(margenSugeridoGestorPct.toFixed(2)),
        precio_sugerido_vecino: precioSugeridoVecino,
        ganancia_unitaria_gestor: gananciaUnitariaGestor
    };
}

/**
 * Crea o asegura el vínculo de un Nodo con public.bunker_clientes y public.factura_cuentas_corrientes
 */
async function asegurarVinculoContableNodo(client, datosNodo) {
    let bunkerClienteId = datosNodo.bunker_cliente_id ? Number(datosNodo.bunker_cliente_id) : null;
    let codigoBunker = datosNodo.codigo_bunker_cliente ? String(datosNodo.codigo_bunker_cliente).trim() : '';

    if (bunkerClienteId) {
        const resExist = await client.query(
            'SELECT id, codigo_bunker_cliente FROM public.bunker_clientes WHERE id = $1 LIMIT 1',
            [bunkerClienteId]
        );
        if (resExist.rows.length > 0) {
            codigoBunker = resExist.rows[0].codigo_bunker_cliente;
        }
    }

    if (!codigoBunker) {
        const sufijo = String(datosNodo.codigo_nodo || 'NODO-001').replace(/[^0-9A-Z]/gi, '').slice(-4).toUpperCase();
        codigoBunker = `CB-NODO-${sufijo}`;
    }

    // Verificar si ya existe en bunker_clientes por codigo_bunker_cliente
    const checkBc = await client.query(
        'SELECT id, codigo_bunker_cliente FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1',
        [codigoBunker]
    );

    if (checkBc.rows.length > 0) {
        bunkerClienteId = checkBc.rows[0].id;
    } else {
        const insBc = await client.query(
            `INSERT INTO public.bunker_clientes (
                codigo_bunker_cliente, cliente_nombre, razon_social,
                condicion_iva, domicilio_fiscal, provincia, estado_clave,
                actividad_principal, canal_envio_preferido, preferencia_facturacion
            ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO', 'GESTOR NODO BARRIAL MARCA BLANCA', 'whatsapp', 'PREGUNTAR')
            RETURNING id, codigo_bunker_cliente`,
            [
                codigoBunker,
                `[NODO] ${datosNodo.nombre_marca} (${datosNodo.gestor_nombre})`,
                datosNodo.gestor_nombre || datosNodo.nombre_marca,
                'Consumidor Final / Monotributo',
                datosNodo.direccion_retiro || datosNodo.barrio_zona || 'La Plata',
                'BUENOS AIRES'
            ]
        );
        bunkerClienteId = insBc.rows[0].id;
    }

    // Asegurar cuenta corriente en factura_cuentas_corrientes
    const checkCc = await client.query(
        'SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = $1 LIMIT 1',
        [codigoBunker]
    );

    if (checkCc.rows.length === 0) {
        await client.query(
            `INSERT INTO public.factura_cuentas_corrientes (
                codigo_bunker_cliente, nombre_cuenta, moneda, saldo, estado, saldo_apertura
            ) VALUES ($1, $2, 'ARS', 0.00, 'ACTIVA', 0.00)`,
            [codigoBunker, `Cta. Cte. Nodo ${datosNodo.nombre_marca}`]
        );
    }

    return { bunker_cliente_id: bunkerClienteId, codigo_bunker_cliente: codigoBunker };
}

/**
 * Crea las 4 tablas de Etapa 1 en etiquetas_pruebas y siembra datos iniciales
 * realistas vinculados a los ingredientes y cuentas reales del Laboratorio.
 */
async function asegurarEsquemaNodosBarriales() {
    if (esquemaInicializado) return;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            CREATE TABLE IF NOT EXISTS public.nodos_maestro (
                id SERIAL PRIMARY KEY,
                codigo_nodo VARCHAR(50) UNIQUE NOT NULL,
                slug VARCHAR(120) UNIQUE NOT NULL,
                nombre_marca VARCHAR(160) NOT NULL,
                subtitulo_marca VARCHAR(200) DEFAULT 'Comunidad Barrial - Entrega Fresca',
                gestor_nombre VARCHAR(160) NOT NULL,
                gestor_telefono VARCHAR(80),
                gestor_email VARCHAR(140),
                barrio_zona VARCHAR(160),
                direccion_retiro VARCHAR(240),
                bunker_cliente_id INTEGER REFERENCES public.bunker_clientes(id) ON DELETE SET NULL,
                codigo_bunker_cliente VARCHAR(80),
                cuenta_bancaria_id INTEGER REFERENCES public.fin_cuentas_bancarias(id) ON DELETE SET NULL,
                usa_cuenta_compartida BOOLEAN DEFAULT false,
                alias_bancario_display VARCHAR(140),
                cbu_display VARCHAR(40),
                titular_display VARCHAR(180),
                permitir_envio_barrial BOOLEAN DEFAULT true,
                cargo_envio_barrial NUMERIC(12,2) DEFAULT 0.00,
                margen_gestor_default_pct NUMERIC(8,2) DEFAULT 28.00,
                config_ventanas_corte JSONB DEFAULT '[]'::jsonb,
                color_primario VARCHAR(20) DEFAULT '#16a34a',
                logo_original_base64 TEXT,
                logo_mono_preview_base64 TEXT,
                logo_zpl_gfa TEXT,
                logo_zpl_config JSONB DEFAULT '{}'::jsonb,
                activo BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.nodos_articulos_catalogo (
                id SERIAL PRIMARY KEY,
                sku_nodo VARCHAR(60) UNIQUE NOT NULL,
                nombre_publico VARCHAR(180) NOT NULL,
                categoria_familiar VARCHAR(100) DEFAULT 'Frutos Secos',
                presentacion_etiqueta VARCHAR(80),
                flujo_lamda INTEGER NOT NULL CHECK (flujo_lamda BETWEEN 1 AND 6),
                origen_tipo VARCHAR(40) NOT NULL DEFAULT 'INGREDIENTE',
                ingrediente_origen_id INTEGER REFERENCES public.ingredientes(id) ON DELETE SET NULL,
                articulo_bunker_origen_codigo VARCHAR(80),
                kilos_unidad NUMERIC(10,4) NOT NULL DEFAULT 0.2500,
                insumo_envase_id INTEGER REFERENCES public.ingredientes(id) ON DELETE SET NULL,
                cantidad_envases_unidad NUMERIC(8,2) NOT NULL DEFAULT 1.00,
                segundos_fraccionamiento NUMERIC(10,2) NOT NULL DEFAULT 35.00,
                tarifa_colaborador_id INTEGER REFERENCES public.colaboradores_tarifas(id) ON DELETE SET NULL,
                valor_hora_aplicado NUMERIC(12,2) NOT NULL DEFAULT 7000.00,
                costo_insumo_kg NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                costo_insumo_fraccion NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                costo_envase_aplicado NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                costo_mano_obra_aplicado NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                margen_lamda_pct NUMERIC(8,2) NOT NULL DEFAULT 22.00,
                iva_pct NUMERIC(6,2) NOT NULL DEFAULT 21.00,
                iibb_pct NUMERIC(6,2) NOT NULL DEFAULT 3.50,
                costo_puro_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                precio_base_nodo_neto NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                precio_base_nodo_final NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                margen_sugerido_gestor_pct NUMERIC(8,2) NOT NULL DEFAULT 28.00,
                precio_sugerido_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                estado VARCHAR(40) NOT NULL DEFAULT 'APROBADO',
                notas_tecnicas TEXT,
                activo BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.nodos_propuestas_fracciones (
                id SERIAL PRIMARY KEY,
                codigo_propuesta VARCHAR(50) UNIQUE NOT NULL,
                nodo_solicitante_id INTEGER REFERENCES public.nodos_maestro(id) ON DELETE SET NULL,
                nombre_sugerido VARCHAR(180) NOT NULL,
                categoria_sugerida VARCHAR(100) DEFAULT 'Frutos Secos',
                flujo_sugerido INTEGER NOT NULL DEFAULT 2 CHECK (flujo_sugerido BETWEEN 1 AND 6),
                ingrediente_sugerido_id INTEGER REFERENCES public.ingredientes(id) ON DELETE SET NULL,
                articulo_bunker_sugerido_codigo VARCHAR(80),
                kilos_sugeridos NUMERIC(10,4) NOT NULL DEFAULT 0.2500,
                insumo_envase_sugerido_id INTEGER REFERENCES public.ingredientes(id) ON DELETE SET NULL,
                segundos_estimados NUMERIC(10,2) DEFAULT 35.00,
                precio_objetivo_vecino NUMERIC(14,2),
                comentario_gestor TEXT,
                respuesta_lamda TEXT,
                estado VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE_COTIZACION',
                articulo_catalogo_id INTEGER REFERENCES public.nodos_articulos_catalogo(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.nodos_ofertas_gestor (
                id SERIAL PRIMARY KEY,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                articulo_catalogo_id INTEGER NOT NULL REFERENCES public.nodos_articulos_catalogo(id) ON DELETE CASCADE,
                precio_base_nodo_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                margen_gestor_pct NUMERIC(8,2) NOT NULL DEFAULT 28.00,
                precio_venta_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ganancia_unitaria_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                publicado_tienda BOOLEAN DEFAULT true,
                destacado_tienda BOOLEAN DEFAULT false,
                alerta_cambio_costo BOOLEAN DEFAULT false,
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unq_nodo_articulo_oferta UNIQUE (nodo_id, articulo_catalogo_id)
            );

            CREATE TABLE IF NOT EXISTS public.nodos_vecinos (
                id SERIAL PRIMARY KEY,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                nombre_completo VARCHAR(160) NOT NULL,
                telefono_whatsapp VARCHAR(60) NOT NULL,
                direccion_calle VARCHAR(220),
                entrecalles_referencia VARCHAR(200),
                notas_entrega TEXT,
                titular_transferencia_habitual VARCHAR(180),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.nodos_pedidos_vecinos (
                id SERIAL PRIMARY KEY,
                codigo_pedido VARCHAR(50) UNIQUE NOT NULL,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                vecino_id INTEGER REFERENCES public.nodos_vecinos(id) ON DELETE SET NULL,
                vecino_nombre VARCHAR(160) NOT NULL,
                vecino_telefono VARCHAR(60) NOT NULL,
                modalidad_entrega VARCHAR(40) NOT NULL DEFAULT 'RETIRO_NODO',
                direccion_entrega VARCHAR(240),
                entrecalles_referencia VARCHAR(200),
                fecha_entrega_comprometida DATE NOT NULL DEFAULT CURRENT_DATE,
                fecha_entrega_label VARCHAR(140) NOT NULL,
                ventana_horaria_label VARCHAR(120),
                entrar_en_corte_actual BOOLEAN DEFAULT true,
                medio_pago VARCHAR(40) NOT NULL DEFAULT 'TRANSFERENCIA',
                estado_pago VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE_TRANSFERENCIA',
                estado_operativo VARCHAR(40) NOT NULL DEFAULT 'CONFIRMADO_VECINO',
                subtotal_productos_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                cargo_envio_barrial NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_base_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ganancia_total_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                observaciones_vecino TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.nodos_pedidos_items (
                id SERIAL PRIMARY KEY,
                pedido_id INTEGER NOT NULL REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE CASCADE,
                articulo_catalogo_id INTEGER REFERENCES public.nodos_articulos_catalogo(id) ON DELETE SET NULL,
                sku_nodo VARCHAR(60),
                nombre_publico VARCHAR(180) NOT NULL,
                presentacion_etiqueta VARCHAR(80),
                cantidad INTEGER NOT NULL DEFAULT 1,
                precio_unitario_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                precio_unitario_base_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                subtotal_vecino NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                subtotal_base_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ganancia_item_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00
            );

            CREATE TABLE IF NOT EXISTS public.nodos_lotes_estacion (
                id SERIAL PRIMARY KEY,
                codigo_canasto VARCHAR(50) UNIQUE NOT NULL,
                qr_maestro_payload VARCHAR(140) NOT NULL,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                fecha_entrega_iso DATE,
                fecha_entrega_label VARCHAR(140) NOT NULL,
                ventana_horaria_label VARCHAR(120),
                ubicacion_deposito VARCHAR(60) NOT NULL DEFAULT 'ESTACION_NODOS',
                estado_canasto VARCHAR(40) NOT NULL DEFAULT 'EN_ARMADO',
                total_bolsas INTEGER NOT NULL DEFAULT 0,
                bolsas_armadas INTEGER NOT NULL DEFAULT 0,
                total_kilos_lote NUMERIC(12,3) NOT NULL DEFAULT 0.000,
                total_base_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_venta_vecinos NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ganancia_estimada_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                debito_cta_cte_registrado BOOLEAN NOT NULL DEFAULT false,
                movimiento_cc_id BIGINT,
                preparado_por VARCHAR(120),
                retirado_por_gestor VARCHAR(120),
                fecha_listo_estacion TIMESTAMP,
                fecha_retiro_gestor TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unq_nodo_ventana_canasto UNIQUE (nodo_id, fecha_entrega_label)
            );

            CREATE TABLE IF NOT EXISTS public.nodos_movimientos_cta_cte (
                id SERIAL PRIMARY KEY,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                lote_canasto_id INTEGER REFERENCES public.nodos_lotes_estacion(id) ON DELETE SET NULL,
                pedido_vecino_id INTEGER REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE SET NULL,
                tipo_movimiento VARCHAR(50) NOT NULL,
                signo SMALLINT NOT NULL DEFAULT -1,
                monto NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                saldo_resultante NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                concepto VARCHAR(240) NOT NULL,
                referencia_externa VARCHAR(100),
                created_at TIMESTAMP DEFAULT NOW()
            );

            ALTER TABLE public.nodos_pedidos_vecinos
                ADD COLUMN IF NOT EXISTS lote_canasto_id INTEGER REFERENCES public.nodos_lotes_estacion(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS ubicacion_deposito VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE_TALLER',
                ADD COLUMN IF NOT EXISTS etiqueta_impresa BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS fecha_armado_bolsa TIMESTAMP,
                ADD COLUMN IF NOT EXISTS fecha_entrega_gestor TIMESTAMP,
                ADD COLUMN IF NOT EXISTS operario_armado VARCHAR(100),
                ADD COLUMN IF NOT EXISTS titular_transferencia VARCHAR(180),
                ADD COLUMN IF NOT EXISTS comprobante_referencia VARCHAR(100),
                ADD COLUMN IF NOT EXISTS fecha_conciliacion_pago TIMESTAMP,
                ADD COLUMN IF NOT EXISTS impactado_cta_cte_pago BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS movimiento_pago_cc_id BIGINT;

            CREATE TABLE IF NOT EXISTS public.nodos_alias_vecinos_aprendidos (
                id SERIAL PRIMARY KEY,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                vecino_id INTEGER REFERENCES public.nodos_vecinos(id) ON DELETE SET NULL,
                vecino_nombre VARCHAR(160) NOT NULL,
                titular_normalizado VARCHAR(180) NOT NULL,
                cuit_cuil_origen VARCHAR(30),
                billetera_banco_origen VARCHAR(100) DEFAULT 'Mercado Pago / Banco',
                usos_confirmados INTEGER NOT NULL DEFAULT 1,
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unq_nodo_titular_vecino UNIQUE (nodo_id, titular_normalizado)
            );

            CREATE TABLE IF NOT EXISTS public.nodos_liquidaciones_lote (
                id SERIAL PRIMARY KEY,
                codigo_liquidacion VARCHAR(50) UNIQUE NOT NULL,
                nodo_id INTEGER NOT NULL REFERENCES public.nodos_maestro(id) ON DELETE CASCADE,
                lote_canasto_id INTEGER NOT NULL REFERENCES public.nodos_lotes_estacion(id) ON DELETE CASCADE,
                total_venta_vecinos NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_base_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                ganancia_neta_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_transferencias_lamda NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                total_efectivo_mano_gestor NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                direccion_compensacion VARCHAR(50) NOT NULL DEFAULT 'GESTOR_RINDE_A_LAMDA',
                monto_compensacion_final NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                saldo_cta_cte_post_cierre NUMERIC(14,2) NOT NULL DEFAULT 0.00,
                movimiento_cc_id BIGINT,
                observaciones TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );

            ALTER TABLE public.nodos_lotes_estacion
                ADD COLUMN IF NOT EXISTS liquidacion_cerrada BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS liquidacion_id INTEGER REFERENCES public.nodos_liquidaciones_lote(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS fecha_liquidacion TIMESTAMP;
        `);

        // Verificar si necesitamos poblar datos iniciales de Laboratorio
        const countNodos = await client.query('SELECT COUNT(*)::int AS total FROM public.nodos_maestro');
        if (countNodos.rows[0].total === 0) {
            // Buscar cuenta bancaria activa y tarifa activa
            const ctaRes = await client.query('SELECT id, alias, cbu, titular FROM public.fin_cuentas_bancarias WHERE estado = $1 ORDER BY id LIMIT 1', ['ACTIVA']);
            const ctaDefault = ctaRes.rows[0] || { id: null, alias: 'LAMDA.SER.MARTIN', cbu: '0070373230004007844141', titular: 'MARTIN IGNACIO SERRANO' };

            const tarRes = await client.query('SELECT id, valor_hora FROM public.colaboradores_tarifas WHERE activo = true ORDER BY id LIMIT 1');
            const tarifaDefault = tarRes.rows[0] || { id: null, valor_hora: 7000 };

            // Generar logos ZPL ^GFA reales para los 2 Nodos semilla
            const logoNodo1 = await convertirLogoAZplGfa({
                nombreMarca: 'ALMACEN VERDE',
                iniciales: 'AV',
                threshold: 138,
                mode: 'threshold'
            });

            const logoNodo2 = await convertirLogoAZplGfa({
                nombreMarca: 'LA DESPENSA',
                iniciales: 'LD',
                threshold: 138,
                mode: 'threshold'
            });

            const nodo1Datos = {
                codigo_nodo: 'NODO-001',
                slug: 'almacen-verde-city-bell',
                nombre_marca: 'Almacén Verde City Bell',
                subtitulo_marca: 'Alimentación Consciente - Entrega Barrial',
                gestor_nombre: 'Carolina Méndez',
                gestor_telefono: '5492215548910',
                gestor_email: 'carolina@almacenverde.com.ar',
                barrio_zona: 'City Bell Centro / Cantilo',
                direccion_retiro: 'Calle Cantilo 452 e/ 13c y 14, City Bell',
                cuenta_bancaria_id: ctaDefault.id,
                usa_cuenta_compartida: false,
                alias_bancario_display: 'ALMACEN.VERDE.CB',
                cbu_display: ctaDefault.cbu,
                titular_display: ctaDefault.titular,
                permitir_envio_barrial: true,
                cargo_envio_barrial: 1500.00,
                margen_gestor_default_pct: 28.00,
                color_primario: '#16a34a',
                config_ventanas_corte: [
                    { dia_entrega: 'Miércoles', cierre_dia: 'Martes', cierre_hora: '14:00', ventana_retiro: '17:00 a 20:00 hs' },
                    { dia_entrega: 'Sábado', cierre_dia: 'Viernes', cierre_hora: '14:00', ventana_retiro: '10:00 a 13:30 hs' }
                ]
            };

            const vinculo1 = await asegurarVinculoContableNodo(client, nodo1Datos);
            const insN1 = await client.query(
                `INSERT INTO public.nodos_maestro (
                    codigo_nodo, slug, nombre_marca, subtitulo_marca,
                    gestor_nombre, gestor_telefono, gestor_email, barrio_zona, direccion_retiro,
                    bunker_cliente_id, codigo_bunker_cliente, cuenta_bancaria_id, usa_cuenta_compartida,
                    alias_bancario_display, cbu_display, titular_display,
                    permitir_envio_barrial, cargo_envio_barrial, margen_gestor_default_pct,
                    config_ventanas_corte, color_primario, logo_mono_preview_base64, logo_zpl_gfa, logo_zpl_config
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
                ) RETURNING id`,
                [
                    nodo1Datos.codigo_nodo, nodo1Datos.slug, nodo1Datos.nombre_marca, nodo1Datos.subtitulo_marca,
                    nodo1Datos.gestor_nombre, nodo1Datos.gestor_telefono, nodo1Datos.gestor_email, nodo1Datos.barrio_zona, nodo1Datos.direccion_retiro,
                    vinculo1.bunker_cliente_id, vinculo1.codigo_bunker_cliente, nodo1Datos.cuenta_bancaria_id, nodo1Datos.usa_cuenta_compartida,
                    nodo1Datos.alias_bancario_display, nodo1Datos.cbu_display, nodo1Datos.titular_display,
                    nodo1Datos.permitir_envio_barrial, nodo1Datos.cargo_envio_barrial, nodo1Datos.margen_gestor_default_pct,
                    JSON.stringify(nodo1Datos.config_ventanas_corte), nodo1Datos.color_primario,
                    logoNodo1.logo_mono_preview_base64, logoNodo1.logo_zpl_gfa,
                    JSON.stringify({ width: logoNodo1.width, height: logoNodo1.height, threshold: 138, mode: 'threshold', iniciales: 'AV' })
                ]
            );
            const nodo1Id = insN1.rows[0].id;

            const nodo2Datos = {
                codigo_nodo: 'NODO-002',
                slug: 'la-despensa-gonnet',
                nombre_marca: 'La Despensa de Gonnet',
                subtitulo_marca: 'Compras Comunitarias Saludables',
                gestor_nombre: 'Martín Echeverría',
                gestor_telefono: '5492216123344',
                gestor_email: 'martin@ladespensagonnet.com.ar',
                barrio_zona: 'Villa Elisa / Gonnet',
                direccion_retiro: 'Calle 502 N° 1840 e/ 13 y 14, Gonnet',
                cuenta_bancaria_id: ctaDefault.id,
                usa_cuenta_compartida: true,
                alias_bancario_display: ctaDefault.alias || 'LAMDA.SER.MARTIN',
                cbu_display: ctaDefault.cbu,
                titular_display: ctaDefault.titular,
                permitir_envio_barrial: true,
                cargo_envio_barrial: 1800.00,
                margen_gestor_default_pct: 25.00,
                color_primario: '#0284c7',
                config_ventanas_corte: [
                    { dia_entrega: 'Jueves', cierre_dia: 'Miércoles', cierre_hora: '18:00', ventana_retiro: '16:30 a 19:30 hs' }
                ]
            };

            const vinculo2 = await asegurarVinculoContableNodo(client, nodo2Datos);
            const insN2 = await client.query(
                `INSERT INTO public.nodos_maestro (
                    codigo_nodo, slug, nombre_marca, subtitulo_marca,
                    gestor_nombre, gestor_telefono, gestor_email, barrio_zona, direccion_retiro,
                    bunker_cliente_id, codigo_bunker_cliente, cuenta_bancaria_id, usa_cuenta_compartida,
                    alias_bancario_display, cbu_display, titular_display,
                    permitir_envio_barrial, cargo_envio_barrial, margen_gestor_default_pct,
                    config_ventanas_corte, color_primario, logo_mono_preview_base64, logo_zpl_gfa, logo_zpl_config
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
                ) RETURNING id`,
                [
                    nodo2Datos.codigo_nodo, nodo2Datos.slug, nodo2Datos.nombre_marca, nodo2Datos.subtitulo_marca,
                    nodo2Datos.gestor_nombre, nodo2Datos.gestor_telefono, nodo2Datos.gestor_email, nodo2Datos.barrio_zona, nodo2Datos.direccion_retiro,
                    vinculo2.bunker_cliente_id, vinculo2.codigo_bunker_cliente, nodo2Datos.cuenta_bancaria_id, nodo2Datos.usa_cuenta_compartida,
                    nodo2Datos.alias_bancario_display, nodo2Datos.cbu_display, nodo2Datos.titular_display,
                    nodo2Datos.permitir_envio_barrial, nodo2Datos.cargo_envio_barrial, nodo2Datos.margen_gestor_default_pct,
                    JSON.stringify(nodo2Datos.config_ventanas_corte), nodo2Datos.color_primario,
                    logoNodo2.logo_mono_preview_base64, logoNodo2.logo_zpl_gfa,
                    JSON.stringify({ width: logoNodo2.width, height: logoNodo2.height, threshold: 138, mode: 'threshold', iniciales: 'LD' })
                ]
            );
            const nodo2Id = insN2.rows[0].id;

            // Consultar costos reales de ingredientes e insumos de envase en etiquetas_pruebas
            const ingRows = await client.query(
                'SELECT id, nombre, costo_patron, es_insumo FROM public.ingredientes WHERE id IN (1, 18, 25, 30, 31, 122, 131, 141, 179, 180, 181)'
            );
            const ingMap = new Map(ingRows.rows.map(r => [Number(r.id), r]));
            const getCostoIng = (id, fallback) => Number(ingMap.get(id)?.costo_patron || fallback);

            const envase180Cost = getCostoIng(180, 45.96); // Bolsa 15 x 18
            const envase179Cost = getCostoIng(179, 71.54); // Bolsa 20 x 25
            const valorHora = Number(tarifaDefault.valor_hora || 7000);

            const catalogoSemilla = [
                {
                    sku_nodo: 'NB-ALM-250G',
                    nombre_publico: 'Almendra Nonpareil Californiana x 250g',
                    categoria_familiar: 'Frutos Secos Puros',
                    presentacion_etiqueta: 'Bolsa 250g',
                    flujo_lamda: 2,
                    origen_tipo: 'INGREDIENTE',
                    ingrediente_origen_id: ingMap.has(1) ? 1 : null,
                    kilos_unidad: 0.25,
                    insumo_envase_id: ingMap.has(180) ? 180 : null,
                    costo_envase_unitario: envase180Cost,
                    segundos_fraccionamiento: 32,
                    costo_insumo_kg: getCostoIng(1, 18109.43),
                    margen_lamda_pct: 22,
                    margen_sugerido_gestor_pct: 28,
                    notas_tecnicas: 'Flujo 2: Fraccionado directo de Almendra Nonpareil calibre grande.'
                },
                {
                    sku_nodo: 'NB-MIX-PASAS-500G',
                    nombre_publico: 'Mix Frutos Secos con Pasas Familiar x 500g',
                    categoria_familiar: 'Mixes Familiares',
                    presentacion_etiqueta: 'Bolsa 500g',
                    flujo_lamda: 3,
                    origen_tipo: 'MIX',
                    ingrediente_origen_id: ingMap.has(30) ? 30 : null,
                    kilos_unidad: 0.50,
                    insumo_envase_id: ingMap.has(179) ? 179 : null,
                    costo_envase_unitario: envase179Cost,
                    segundos_fraccionamiento: 40,
                    costo_insumo_kg: getCostoIng(30, 5481.93),
                    margen_lamda_pct: 24,
                    margen_sugerido_gestor_pct: 30,
                    notas_tecnicas: 'Flujo 3: Mezcla interna en carro granel + fraccionamiento familiar 500g.'
                },
                {
                    sku_nodo: 'NB-CAJU-TOST-250G',
                    nombre_publico: 'Castaña de Cajú Tostada Artesanal x 250g',
                    categoria_familiar: 'Tostadero Artesanal',
                    presentacion_etiqueta: 'Bolsa 250g',
                    flujo_lamda: 4,
                    origen_tipo: 'UP_EXTERNA',
                    ingrediente_origen_id: ingMap.has(18) ? 18 : null,
                    kilos_unidad: 0.25,
                    insumo_envase_id: ingMap.has(180) ? 180 : null,
                    costo_envase_unitario: envase180Cost,
                    segundos_fraccionamiento: 35,
                    costo_insumo_kg: getCostoIng(18, 10575.53),
                    margen_lamda_pct: 22,
                    margen_sugerido_gestor_pct: 28,
                    notas_tecnicas: 'Flujo 4: Tostado en Unidad Productiva Externa + fraccionamiento local.'
                },
                {
                    sku_nodo: 'NB-BARRITA-PACK6',
                    nombre_publico: 'Pack Familiar 6 Barritas Energéticas (6 x 50g)',
                    categoria_familiar: 'Barritas & Snacks',
                    presentacion_etiqueta: 'Pack 6 u. (300g)',
                    flujo_lamda: 5,
                    origen_tipo: 'UP_EXTERNA',
                    ingrediente_origen_id: ingMap.has(141) ? 141 : null,
                    kilos_unidad: 0.30,
                    insumo_envase_id: ingMap.has(180) ? 180 : null,
                    costo_envase_unitario: envase180Cost,
                    segundos_fraccionamiento: 45,
                    costo_insumo_kg: getCostoIng(141, 15143.70),
                    margen_lamda_pct: 22,
                    margen_sugerido_gestor_pct: 28,
                    notas_tecnicas: 'Flujo 5: Pre-mezcla MPB + UP Externa Barritas + Pack familiar x 6 unidades.'
                },
                {
                    sku_nodo: 'NB-GRANA-SOL-500G',
                    nombre_publico: 'Granola de Sol Crocante con Miel x 500g',
                    categoria_familiar: 'Granolas Horneadas',
                    presentacion_etiqueta: 'Bolsa 500g',
                    flujo_lamda: 6,
                    origen_tipo: 'UP_EXTERNA',
                    ingrediente_origen_id: ingMap.has(131) ? 131 : null,
                    kilos_unidad: 0.50,
                    insumo_envase_id: ingMap.has(179) ? 179 : null,
                    costo_envase_unitario: envase179Cost,
                    segundos_fraccionamiento: 42,
                    costo_insumo_kg: getCostoIng(131, 9549.29),
                    margen_lamda_pct: 24,
                    margen_sugerido_gestor_pct: 30,
                    notas_tecnicas: 'Flujo 6: Doble mezcla (Mezcla base + Horneado UP + Agregado seco en taller).'
                }
            ];

            const catalogoIds = [];
            for (const item of catalogoSemilla) {
                const calc = calcularEstructuraCostosNodo({
                    ...item,
                    valor_hora_aplicado: valorHora,
                    iva_pct: 21,
                    iibb_pct: 3.5
                });

                const insCat = await client.query(
                    `INSERT INTO public.nodos_articulos_catalogo (
                        sku_nodo, nombre_publico, categoria_familiar, presentacion_etiqueta,
                        flujo_lamda, origen_tipo, ingrediente_origen_id, kilos_unidad,
                        insumo_envase_id, cantidad_envases_unidad, segundos_fraccionamiento,
                        tarifa_colaborador_id, valor_hora_aplicado, costo_insumo_kg,
                        costo_insumo_fraccion, costo_envase_aplicado, costo_mano_obra_aplicado,
                        margen_lamda_pct, iva_pct, iibb_pct, costo_puro_total,
                        precio_base_nodo_neto, precio_base_nodo_final,
                        margen_sugerido_gestor_pct, precio_sugerido_vecino, notas_tecnicas
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
                    ) RETURNING id`,
                    [
                        item.sku_nodo, item.nombre_publico, item.categoria_familiar, item.presentacion_etiqueta,
                        item.flujo_lamda, item.origen_tipo, item.ingrediente_origen_id, calc.kilos_unidad,
                        item.insumo_envase_id, calc.segundos_fraccionamiento,
                        tarifaDefault.id, calc.valor_hora_aplicado, calc.costo_insumo_kg,
                        calc.costo_insumo_fraccion, calc.costo_envase_aplicado, calc.costo_mano_obra_aplicado,
                        calc.margen_lamda_pct, calc.iva_pct, calc.iibb_pct, calc.costo_puro_total,
                        calc.precio_base_nodo_neto, calc.precio_base_nodo_final,
                        calc.margen_sugerido_gestor_pct, calc.precio_sugerido_vecino, item.notas_tecnicas
                    ]
                );
                const catId = insCat.rows[0].id;
                catalogoIds.push({ id: catId, calc });

                // Crear ofertas para Nodo 1 y Nodo 2
                for (const [nId, margenNodo] of [[nodo1Id, 28], [nodo2Id, 25]]) {
                    const precioVecino = Math.ceil((calc.precio_base_nodo_final * (1 + margenNodo / 100)) / 50) * 50;
                    const gananciaGestor = Math.max(0, precioVecino - calc.precio_base_nodo_final);
                    await client.query(
                        `INSERT INTO public.nodos_ofertas_gestor (
                            nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                            margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor,
                            publicado_tienda, destacado_tienda
                        ) VALUES ($1,$2,$3,$4,$5,$6,true,false)`,
                        [nId, catId, calc.precio_base_nodo_final, margenNodo, precioVecino, gananciaGestor]
                    );
                }
            }

            // Sembrar 3 propuestas de fracciones de los gestores (2 pendientes de cotización y 1 ya aprobada)
            await client.query(
                `INSERT INTO public.nodos_propuestas_fracciones (
                    codigo_propuesta, nodo_solicitante_id, nombre_sugerido, categoria_sugerida,
                    flujo_sugerido, ingrediente_sugerido_id, kilos_sugeridos, insumo_envase_sugerido_id,
                    segundos_estimados, precio_objetivo_vecino, comentario_gestor, estado
                ) VALUES
                ($1, $2, 'Nuez Mariposa Extra Light Familiar x 250g', 'Frutos Secos Puros', 2, $3, 0.2500, $4, 35, 6200,
                 'Las familias del barrio nos piden mucho nuez mariposa clara en bolsita de 250g para desayunos.', 'PENDIENTE_COTIZACION'),
                ($5, $6, 'Mix Premium Sin Pasas x 400g', 'Mixes Familiares', 3, $7, 0.4000, $8, 38, 11900,
                 'Buscamos una presentación intermedia de 400g de Mix Premium (almendra, cajú, nuez y avellana).', 'PENDIENTE_COTIZACION'),
                ($9, $2, 'Granola de Flor Premium x 500g', 'Granolas Horneadas', 6, $10, 0.5000, $8, 42, 13800,
                 'Queremos sumar la variedad Granola de Flor en medio kilo junto a la de Sol.', 'PENDIENTE_COTIZACION')`,
                [
                    'PROP-NB-001', nodo1Id, ingMap.has(25) ? 25 : null, ingMap.has(180) ? 180 : null,
                    'PROP-NB-002', nodo2Id, ingMap.has(31) ? 31 : null, ingMap.has(179) ? 179 : null,
                    'PROP-NB-003', ingMap.has(122) ? 122 : null
                ]
            );
        }

        // Sembrar pedidos vecinales de muestra para Etapa 2 si aún no existen
        const countPedidos = await client.query('SELECT COUNT(*)::int AS total FROM public.nodos_pedidos_vecinos');
        if (countPedidos.rows[0].total === 0) {
            const n1Res = await client.query('SELECT id, direccion_retiro, cargo_envio_barrial FROM public.nodos_maestro ORDER BY id ASC LIMIT 1');
            if (n1Res.rows.length > 0) {
                const n1 = n1Res.rows[0];
                const ofRes = await client.query(
                    `SELECT nog.*, nac.sku_nodo, nac.nombre_publico, nac.presentacion_etiqueta
                     FROM public.nodos_ofertas_gestor nog
                     JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
                     WHERE nog.nodo_id = $1
                     ORDER BY nac.id ASC`,
                    [n1.id]
                );
                const ofs = ofRes.rows;
                if (ofs.length >= 3) {
                    const v1 = await client.query(
                        `INSERT INTO public.nodos_vecinos (nodo_id, nombre_completo, telefono_whatsapp, direccion_calle, entrecalles_referencia)
                         VALUES ($1, 'María Laura Gómez', '221-554-8910', 'Cantilo 452', 'e/ 13c y 14') RETURNING id`,
                        [n1.id]
                    );
                    const v2 = await client.query(
                        `INSERT INTO public.nodos_vecinos (nodo_id, nombre_completo, telefono_whatsapp, direccion_calle, entrecalles_referencia)
                         VALUES ($1, 'Valeria Sánchez', '221-509-4412', 'Calle 473 bis N° 1120', 'e/ 14b y 15 - City Bell') RETURNING id`,
                        [n1.id]
                    );

                    // Pedido 1: Retiro en Nodo, Pagado por Transferencia
                    const it1A = ofs[0];
                    const it1B = ofs[1];
                    const subVec1 = Number(it1A.precio_venta_vecino) * 2 + Number(it1B.precio_venta_vecino) * 1;
                    const subBase1 = Number(it1A.precio_base_nodo_snapshot) * 2 + Number(it1B.precio_base_nodo_snapshot) * 1;
                    const gan1 = subVec1 - subBase1;

                    const p1 = await client.query(
                        `INSERT INTO public.nodos_pedidos_vecinos (
                            codigo_pedido, nodo_id, vecino_id, vecino_nombre, vecino_telefono,
                            modalidad_entrega, direccion_entrega, fecha_entrega_label, ventana_horaria_label,
                            medio_pago, estado_pago, estado_operativo,
                            subtotal_productos_vecino, cargo_envio_barrial, total_vecino, total_base_lamda, ganancia_total_gestor
                         ) VALUES ($1,$2,$3,$4,$5,'RETIRO_NODO',$6,'Miércoles (17:00 a 20:00 hs)','17:00 a 20:00 hs','TRANSFERENCIA','PAGADO_TRANSFERENCIA','CONFIRMADO_VECINO',$7,0,$7,$8,$9)
                         RETURNING id`,
                        ['NB-1041', n1.id, v1.rows[0].id, 'María Laura Gómez', '221-554-8910', n1.direccion_retiro, subVec1, subBase1, gan1]
                    );
                    await client.query(
                        `INSERT INTO public.nodos_pedidos_items (
                            pedido_id, articulo_catalogo_id, sku_nodo, nombre_publico, presentacion_etiqueta,
                            cantidad, precio_unitario_vecino, precio_unitario_base_lamda, subtotal_vecino, subtotal_base_lamda, ganancia_item_gestor
                         ) VALUES
                         ($1,$2,$3,$4,$5,2,$6,$7,$8,$9,$10),
                         ($1,$11,$12,$13,$14,1,$15,$16,$17,$18,$19)`,
                        [
                            p1.rows[0].id,
                            it1A.articulo_catalogo_id, it1A.sku_nodo, it1A.nombre_publico, it1A.presentacion_etiqueta,
                            it1A.precio_venta_vecino, it1A.precio_base_nodo_snapshot, Number(it1A.precio_venta_vecino) * 2, Number(it1A.precio_base_nodo_snapshot) * 2, Number(it1A.ganancia_unitaria_gestor) * 2,
                            it1B.articulo_catalogo_id, it1B.sku_nodo, it1B.nombre_publico, it1B.presentacion_etiqueta,
                            it1B.precio_venta_vecino, it1B.precio_base_nodo_snapshot, Number(it1B.precio_venta_vecino), Number(it1B.precio_base_nodo_snapshot), Number(it1B.ganancia_unitaria_gestor)
                        ]
                    );

                    // Pedido 2: Envío a Domicilio Barrial (+$1.500 100% para el gestor), Cobrar en Efectivo
                    const it2A = ofs[2];
                    const it2B = ofs[3] || ofs[0];
                    const envioBarrial = Number(n1.cargo_envio_barrial || 1500);
                    const subVec2 = Number(it2A.precio_venta_vecino) * 1 + Number(it2B.precio_venta_vecino) * 2;
                    const subBase2 = Number(it2A.precio_base_nodo_snapshot) * 1 + Number(it2B.precio_base_nodo_snapshot) * 2;
                    const totVec2 = subVec2 + envioBarrial;
                    const gan2 = (subVec2 - subBase2) + envioBarrial; // 100% del envío barrial corresponde al gestor

                    const p2 = await client.query(
                        `INSERT INTO public.nodos_pedidos_vecinos (
                            codigo_pedido, nodo_id, vecino_id, vecino_nombre, vecino_telefono,
                            modalidad_entrega, direccion_entrega, entrecalles_referencia, fecha_entrega_label, ventana_horaria_label,
                            medio_pago, estado_pago, estado_operativo,
                            subtotal_productos_vecino, cargo_envio_barrial, total_vecino, total_base_lamda, ganancia_total_gestor
                         ) VALUES ($1,$2,$3,$4,$5,'ENVIO_BARRIAL','Calle 473 bis N° 1120','e/ 14b y 15 - City Bell','Miércoles (17:00 a 20:00 hs)','17:00 a 20:00 hs','EFECTIVO','COBRAR_EN_ENTREGA','CONFIRMADO_VECINO',$6,$7,$8,$9,$10)
                         RETURNING id`,
                        ['NB-1042', n1.id, v2.rows[0].id, 'Valeria Sánchez', '221-509-4412', subVec2, envioBarrial, totVec2, subBase2, gan2]
                    );
                    await client.query(
                        `INSERT INTO public.nodos_pedidos_items (
                            pedido_id, articulo_catalogo_id, sku_nodo, nombre_publico, presentacion_etiqueta,
                            cantidad, precio_unitario_vecino, precio_unitario_base_lamda, subtotal_vecino, subtotal_base_lamda, ganancia_item_gestor
                         ) VALUES
                         ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10),
                         ($1,$11,$12,$13,$14,2,$15,$16,$17,$18,$19)`,
                        [
                            p2.rows[0].id,
                            it2A.articulo_catalogo_id, it2A.sku_nodo, it2A.nombre_publico, it2A.presentacion_etiqueta,
                            it2A.precio_venta_vecino, it2A.precio_base_nodo_snapshot, Number(it2A.precio_venta_vecino), Number(it2A.precio_base_nodo_snapshot), Number(it2A.ganancia_unitaria_gestor),
                            it2B.articulo_catalogo_id, it2B.sku_nodo, it2B.nombre_publico, it2B.presentacion_etiqueta,
                            it2B.precio_venta_vecino, it2B.precio_base_nodo_snapshot, Number(it2B.precio_venta_vecino) * 2, Number(it2B.precio_base_nodo_snapshot) * 2, Number(it2B.ganancia_unitaria_gestor) * 2
                        ]
                    );
                }
            }
        }

        // Unificar etiqueta de ventana de los pedidos semilla (NB-1041, NB-1042) con la próxima entrega real del Miércoles
        const refMiercoles = await client.query(
            `SELECT fecha_entrega_comprometida, fecha_entrega_label, ventana_horaria_label
             FROM public.nodos_pedidos_vecinos
             WHERE fecha_entrega_label ILIKE 'Miércoles %/%'
             ORDER BY id DESC LIMIT 1`
        );
        const labelMiercolesUnificado = refMiercoles.rows[0]?.fecha_entrega_label || 'Miércoles 11/11 (17:00 a 20:00 hs)';
        const fechaMiercolesIso = refMiercoles.rows[0]?.fecha_entrega_comprometida || '2026-11-11';
        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET fecha_entrega_label = $1,
                 fecha_entrega_comprometida = $2
             WHERE fecha_entrega_label = 'Miércoles (17:00 a 20:00 hs)'`,
            [labelMiercolesUnificado, fechaMiercolesIso]
        );

        // Columnas de integración nativa con el circuito operativo habitual de LAMDA (Presupuestos / Producción / Chequeo / Logística)
        await client.query(`
            ALTER TABLE public.nodos_lotes_estacion
                ADD COLUMN IF NOT EXISTS presupuesto_id_local INTEGER,
                ADD COLUMN IF NOT EXISTS id_presupuesto_ext VARCHAR(80),
                ADD COLUMN IF NOT EXISTS secuencia_operativa_lamda VARCHAR(40) DEFAULT 'Imprimir'
        `);

        // Si el Nodo 2 (La Despensa de Gonnet) aún no tiene pedidos semilla, sembrar 2 pedidos vecinales para su Canasto
        const n2Res = await client.query(`SELECT * FROM public.nodos_maestro WHERE codigo_nodo = 'NODO-002' LIMIT 1`);
        if (n2Res.rows.length > 0) {
            const n2 = n2Res.rows[0];
            const countN2Peds = await client.query(`SELECT COUNT(*)::int AS total FROM public.nodos_pedidos_vecinos WHERE nodo_id = $1`, [n2.id]);
            if (countN2Peds.rows[0].total === 0) {
                const vG1 = await client.query(
                    `INSERT INTO public.nodos_vecinos (
                        nodo_id, nombre_completo, telefono_whatsapp, direccion_calle, entrecalles_referencia
                     ) VALUES ($1, 'Sofía Albornoz', '221-612-3390', 'Calle 501 N° 1920', 'e/ 14 y 15 - Gonnet')
                     RETURNING id`,
                    [n2.id]
                );
                const vG2 = await client.query(
                    `INSERT INTO public.nodos_vecinos (
                        nodo_id, nombre_completo, telefono_whatsapp, direccion_calle, entrecalles_referencia
                     ) VALUES ($1, 'Federico Quiroga', '221-498-7721', 'Calle 495 N° 1650', 'e/ 11 y 12 - Gonnet')
                     RETURNING id`,
                    [n2.id]
                );

                const ofsN2Res = await client.query(
                    `SELECT nog.*, nac.sku_nodo, nac.nombre_publico, nac.presentacion_etiqueta
                     FROM public.nodos_ofertas_gestor nog
                     JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
                     WHERE nog.nodo_id = $1
                     ORDER BY nac.id ASC`,
                    [n2.id]
                );
                const ofs2 = ofsN2Res.rows;
                if (ofs2.length >= 2) {
                    const oA = ofs2[0]; // Almendra 250g
                    const oB = ofs2[4] || ofs2[1]; // Granola de Sol 500g
                    const subV1 = Number(oA.precio_venta_vecino) + Number(oB.precio_venta_vecino) * 2;
                    const subB1 = Number(oA.precio_base_nodo_snapshot) + Number(oB.precio_base_nodo_snapshot) * 2;
                    const ganV1 = subV1 - subB1;

                    const pG1 = await client.query(
                        `INSERT INTO public.nodos_pedidos_vecinos (
                            codigo_pedido, nodo_id, vecino_id, vecino_nombre, vecino_telefono,
                            modalidad_entrega, direccion_entrega, fecha_entrega_comprometida, fecha_entrega_label, ventana_horaria_label,
                            medio_pago, estado_pago, estado_operativo, ubicacion_deposito, etiqueta_impresa,
                            subtotal_productos_vecino, cargo_envio_barrial, total_vecino, total_base_lamda, ganancia_total_gestor
                         ) VALUES ($1,$2,$3,'Sofía Albornoz','221-612-3390','RETIRO_NODO',$4,$5,$6,'17:00 a 20:00 hs','TRANSFERENCIA','PAGADO_TRANSFERENCIA','ARMADO_EN_CANASTO','ESTACION_NODOS',true,$7,0,$7,$8,$9)
                         RETURNING id`,
                        ['NB-1045', n2.id, vG1.rows[0].id, n2.direccion_retiro, fechaMiercolesIso, labelMiercolesUnificado, subV1, subB1, ganV1]
                    );
                    await client.query(
                        `INSERT INTO public.nodos_pedidos_items (
                            pedido_id, articulo_catalogo_id, sku_nodo, nombre_publico, presentacion_etiqueta,
                            cantidad, precio_unitario_vecino, precio_unitario_base_lamda, subtotal_vecino, subtotal_base_lamda, ganancia_item_gestor
                         ) VALUES
                         ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10),
                         ($1,$11,$12,$13,$14,2,$15,$16,$17,$18,$19)`,
                        [
                            pG1.rows[0].id,
                            oA.articulo_catalogo_id, oA.sku_nodo, oA.nombre_publico, oA.presentacion_etiqueta,
                            oA.precio_venta_vecino, oA.precio_base_nodo_snapshot, Number(oA.precio_venta_vecino), Number(oA.precio_base_nodo_snapshot), Number(oA.ganancia_unitaria_gestor),
                            oB.articulo_catalogo_id, oB.sku_nodo, oB.nombre_publico, oB.presentacion_etiqueta,
                            oB.precio_venta_vecino, oB.precio_base_nodo_snapshot, Number(oB.precio_venta_vecino) * 2, Number(oB.precio_base_nodo_snapshot) * 2, Number(oB.ganancia_unitaria_gestor) * 2
                        ]
                    );

                    const oC = ofs2[2] || ofs2[0]; // Castaña de Cajú 250g
                    const envG2 = Number(n2.cargo_envio_barrial || 1200);
                    const subV2 = Number(oC.precio_venta_vecino) * 2;
                    const subB2 = Number(oC.precio_base_nodo_snapshot) * 2;
                    const totV2 = subV2 + envG2;
                    const ganV2 = (subV2 - subB2) + envG2;

                    const pG2 = await client.query(
                        `INSERT INTO public.nodos_pedidos_vecinos (
                            codigo_pedido, nodo_id, vecino_id, vecino_nombre, vecino_telefono,
                            modalidad_entrega, direccion_entrega, entrecalles_referencia, fecha_entrega_comprometida, fecha_entrega_label, ventana_horaria_label,
                            medio_pago, estado_pago, estado_operativo, ubicacion_deposito, etiqueta_impresa,
                            subtotal_productos_vecino, cargo_envio_barrial, total_vecino, total_base_lamda, ganancia_total_gestor
                         ) VALUES ($1,$2,$3,'Federico Quiroga','221-498-7721','ENVIO_BARRIAL','Calle 495 N° 1650','e/ 11 y 12 - Gonnet',$4,$5,'17:00 a 20:00 hs','EFECTIVO','COBRAR_EN_ENTREGA','ARMADO_EN_CANASTO','ESTACION_NODOS',true,$6,$7,$8,$9,$10)
                         RETURNING id`,
                        ['NB-1046', n2.id, vG2.rows[0].id, fechaMiercolesIso, labelMiercolesUnificado, subV2, envG2, totV2, subB2, ganV2]
                    );
                    await client.query(
                        `INSERT INTO public.nodos_pedidos_items (
                            pedido_id, articulo_catalogo_id, sku_nodo, nombre_publico, presentacion_etiqueta,
                            cantidad, precio_unitario_vecino, precio_unitario_base_lamda, subtotal_vecino, subtotal_base_lamda, ganancia_item_gestor
                         ) VALUES ($1,$2,$3,$4,$5,2,$6,$7,$8,$9,$10)`,
                        [
                            pG2.rows[0].id,
                            oC.articulo_catalogo_id, oC.sku_nodo, oC.nombre_publico, oC.presentacion_etiqueta,
                            oC.precio_venta_vecino, oC.precio_base_nodo_snapshot, subV2, subB2, Number(oC.ganancia_unitaria_gestor) * 2
                        ]
                    );
                }
            }
        }

        await client.query('COMMIT');
        esquemaInicializado = true;

        // Sincronizar canastos y el circuito operativo de LAMDA (Clientes, Artículos, Recetas, Stock y Presupuestos)
        await sincronizarCanastosEstacionNodos();
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ [NodosBarriales] Error inicializando esquema:', err);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Obtiene todas las fuentes de costo vivas de los 6 Flujos de la Pizarra
 */
async function obtenerFuentesCostoSeisFlujos() {
    const [ingRes, compRes, artDirectosRes, envasesRes, tarifasRes, cuentasRes, clientesRes] = await Promise.all([
        db.query(`
            SELECT id, codigo, nombre, COALESCE(costo_patron, 0)::numeric(14,2) AS costo_patron,
                   articulo_vinculado_numero, COALESCE(es_insumo, false) AS es_insumo
            FROM public.ingredientes
            WHERE COALESCE(es_insumo, false) = false
              AND COALESCE(costo_patron, 0) > 0
              AND nombre NOT ILIKE '%Fuera de Servicio%'
            ORDER BY nombre ASC
        `),
        db.query(`
            SELECT DISTINCT mix_id AS ingrediente_padre_id
            FROM public.ingrediente_composicion
        `),
        db.query(`
            SELECT articulo_id, descripcion_generada, descripcion, rubro, sub_rubro,
                   COALESCE(costo_base, 0)::numeric(14,2) AS costo_base,
                   COALESCE(kilos_unidad, 1)::numeric(10,4) AS kilos_unidad
            FROM public.bunker_articulos
            WHERE COALESCE(costo_base, 0) > 0
              AND COALESCE(es_pack, false) = false
            ORDER BY descripcion_generada ASC NULLS LAST
            LIMIT 120
        `),
        db.query(`
            SELECT id, codigo, nombre, COALESCE(costo_patron, 0)::numeric(14,2) AS costo_unitario
            FROM public.ingredientes
            WHERE COALESCE(es_insumo, false) = true
            ORDER BY costo_patron ASC, nombre ASC
        `),
        db.query(`
            SELECT ct.id, ct.usuario_id,
                   COALESCE(u.nombre_completo, u.usuario, 'Operador Taller') AS nombre_completo,
                   COALESCE(ct.valor_hora, 7000)::numeric(12,2) AS valor_hora, ct.activo
            FROM public.colaboradores_tarifas ct
            LEFT JOIN public.usuarios u ON u.id = ct.usuario_id
            WHERE COALESCE(ct.activo, true) = true
            ORDER BY ct.id ASC
        `),
        db.query(`
            SELECT id, banco, titular, alias, cbu, estado
            FROM public.fin_cuentas_bancarias
            WHERE COALESCE(estado, 'ACTIVA') = 'ACTIVA'
            ORDER BY id ASC
        `),
        db.query(`
            SELECT bc.id, bc.codigo_bunker_cliente, bc.cliente_nombre, bc.razon_social,
                   COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cta_cte
            FROM public.bunker_clientes bc
            LEFT JOIN public.factura_cuentas_corrientes cc
              ON cc.codigo_bunker_cliente = bc.codigo_bunker_cliente
            ORDER BY bc.id DESC
            LIMIT 60
        `)
    ]);

    const idsCompuestosSet = new Set(compRes.rows.map(r => Number(r.ingrediente_padre_id)));

    const fuentesIngredientes = ingRes.rows.map(ing => {
        const clasif = clasificarIngredienteEnFlujo(ing, idsCompuestosSet);
        return {
            id: Number(ing.id),
            codigo: ing.codigo,
            nombre: ing.nombre,
            costo_kg: Number(ing.costo_patron),
            articulo_vinculado_numero: ing.articulo_vinculado_numero,
            flujo: clasif.flujo,
            flujo_nombre: clasif.flujo_nombre,
            origen_tipo: clasif.origen_tipo
        };
    });

    const fuentesDirectosFlujo1 = artDirectosRes.rows.map(art => {
        const kilos = Math.max(0.001, Number(art.kilos_unidad) || 1);
        const costoBase = Number(art.costo_base) || 0;
        const costoKg = Number((costoBase / kilos).toFixed(2));
        return {
            articulo_id: art.articulo_id,
            nombre: art.descripcion_generada || art.descripcion || art.articulo_id,
            rubro: art.rubro,
            kilos_bulto: kilos,
            costo_bulto: costoBase,
            costo_kg: costoKg,
            flujo: 1,
            flujo_nombre: '[LDN 1] Directo (Sin Receta)',
            origen_tipo: 'ARTICULO_BUNKER'
        };
    });

    return {
        ingredientes_por_flujo: fuentesIngredientes,
        articulos_flujo_1: fuentesDirectosFlujo1,
        envases: envasesRes.rows.map(e => ({
            id: Number(e.id),
            codigo: e.codigo,
            nombre: e.nombre,
            costo_unitario: Number(e.costo_unitario)
        })),
        tarifas_mano_obra: tarifasRes.rows.map(t => ({
            id: Number(t.id),
            nombre_completo: t.nombre_completo,
            valor_hora: Number(t.valor_hora)
        })),
        cuentas_bancarias: cuentasRes.rows,
        clientes_bunker: clientesRes.rows
    };
}

/**
 * Obtiene el estado completo del ecosistema de Nodos Barriales para la Pizarra
 */
async function obtenerEstadoCompletoNodos() {
    await asegurarEsquemaNodosBarriales();

    const [nodosRes, catalogoRes, propuestasRes, ofertasRes, fuentes] = await Promise.all([
        db.query(`
            SELECT nm.*,
                   fb.banco AS banco_nombre,
                   fb.alias AS banco_alias_oficial,
                   fb.cbu AS banco_cbu_oficial,
                   COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente,
                   (SELECT COUNT(*)::int FROM public.nodos_ofertas_gestor nog WHERE nog.nodo_id = nm.id AND nog.publicado_tienda = true) AS total_ofertas_publicadas
            FROM public.nodos_maestro nm
            LEFT JOIN public.fin_cuentas_bancarias fb ON fb.id = nm.cuenta_bancaria_id
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
            ORDER BY nm.id ASC
        `),
        db.query(`
            SELECT nac.*,
                   ing.nombre AS ingrediente_origen_nombre,
                   COALESCE(ing.costo_patron, nac.costo_insumo_kg)::numeric(14,2) AS costo_insumo_kg_vivo,
                   env.nombre AS envase_nombre,
                   COALESCE(env.costo_patron, nac.costo_envase_aplicado)::numeric(14,2) AS costo_envase_vivo,
                   COALESCE(u.nombre_completo, u.usuario, 'Operador Taller') AS colaborador_nombre
            FROM public.nodos_articulos_catalogo nac
            LEFT JOIN public.ingredientes ing ON ing.id = nac.ingrediente_origen_id
            LEFT JOIN public.ingredientes env ON env.id = nac.insumo_envase_id
            LEFT JOIN public.colaboradores_tarifas ct ON ct.id = nac.tarifa_colaborador_id
            LEFT JOIN public.usuarios u ON u.id = ct.usuario_id
            ORDER BY nac.flujo_lamda ASC, nac.nombre_publico ASC
        `),
        db.query(`
            SELECT npf.*,
                   nm.nombre_marca AS nodo_solicitante_nombre,
                   nm.gestor_nombre AS nodo_gestor_nombre,
                   nm.color_primario AS nodo_color,
                   ing.nombre AS ingrediente_sugerido_nombre,
                   COALESCE(ing.costo_patron, 0)::numeric(14,2) AS ingrediente_sugerido_costo_kg,
                   env.nombre AS envase_sugerido_nombre,
                   COALESCE(env.costo_patron, 0)::numeric(14,2) AS envase_sugerido_costo
            FROM public.nodos_propuestas_fracciones npf
            LEFT JOIN public.nodos_maestro nm ON nm.id = npf.nodo_solicitante_id
            LEFT JOIN public.ingredientes ing ON ing.id = npf.ingrediente_sugerido_id
            LEFT JOIN public.ingredientes env ON env.id = npf.insumo_envase_sugerido_id
            ORDER BY
                CASE WHEN npf.estado = 'PENDIENTE_COTIZACION' THEN 0 ELSE 1 END,
                npf.id DESC
        `),
        db.query(`
            SELECT nog.*,
                   nm.nombre_marca,
                   nm.slug AS nodo_slug,
                   nm.color_primario,
                   nac.sku_nodo,
                   nac.nombre_publico,
                   nac.presentacion_etiqueta,
                   nac.flujo_lamda,
                   nac.kilos_unidad,
                   nac.precio_base_nodo_final AS precio_base_actual_lamda
            FROM public.nodos_ofertas_gestor nog
            JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
            JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
            ORDER BY nog.nodo_id ASC, nac.flujo_lamda ASC, nac.nombre_publico ASC
        `),
        obtenerFuentesCostoSeisFlujos()
    ]);

    return {
        nodos: nodosRes.rows,
        catalogo: catalogoRes.rows,
        propuestas: propuestasRes.rows,
        ofertas_gestor: ofertasRes.rows,
        fuentes
    };
}

/**
 * Crea o actualiza un Nodo Barrial con generación de logo ZPL ^GFA y vínculo contable
 */
async function guardarNodoMaestro(payload = {}, idExistente = null) {
    await asegurarEsquemaNodosBarriales();

    const nombreMarca = String(payload.nombre_marca || '').trim();
    const gestorNombre = String(payload.gestor_nombre || '').trim();
    if (!nombreMarca || !gestorNombre) {
        throw new Error('El nombre de la marca del Nodo y el nombre del gestor son obligatorios.');
    }

    const slugBase = String(payload.slug || nombreMarca)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `nodo-${Date.now()}`;

    // Convertir o regenerar el logo a ZPL ^GFA si se envió imagen o configuración
    const zplConfig = payload.logo_zpl_config || {};
    const conversionLogo = await convertirLogoAZplGfa({
        imageBase64: payload.logo_original_base64 || null,
        nombreMarca,
        iniciales: zplConfig.iniciales || '',
        width: zplConfig.width || 112,
        height: zplConfig.height || 56,
        threshold: zplConfig.threshold || 138,
        mode: zplConfig.mode || 'threshold',
        invert: Boolean(zplConfig.invert)
    });

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        let codigoNodo = String(payload.codigo_nodo || '').trim();
        if (!codigoNodo && !idExistente) {
            const maxRes = await client.query('SELECT COUNT(*)::int AS total FROM public.nodos_maestro');
            codigoNodo = `NODO-${String(maxRes.rows[0].total + 1).padStart(3, '0')}`;
        }

        const vinculoContable = await asegurarVinculoContableNodo(client, {
            ...payload,
            codigo_nodo: codigoNodo || `NODO-${idExistente}`,
            nombre_marca: nombreMarca,
            gestor_nombre: gestorNombre
        });

        const ventanas = Array.isArray(payload.config_ventanas_corte)
            ? payload.config_ventanas_corte
            : [
                { dia_entrega: 'Miércoles', cierre_dia: 'Martes', cierre_hora: '14:00', ventana_retiro: '17:00 a 20:00 hs' }
            ];

        let nodoGuardado;
        if (idExistente) {
            const upd = await client.query(
                `UPDATE public.nodos_maestro SET
                    slug = $1,
                    nombre_marca = $2,
                    subtitulo_marca = $3,
                    gestor_nombre = $4,
                    gestor_telefono = $5,
                    gestor_email = $6,
                    barrio_zona = $7,
                    direccion_retiro = $8,
                    bunker_cliente_id = $9,
                    codigo_bunker_cliente = $10,
                    cuenta_bancaria_id = $11,
                    usa_cuenta_compartida = $12,
                    alias_bancario_display = $13,
                    cbu_display = $14,
                    titular_display = $15,
                    permitir_envio_barrial = $16,
                    cargo_envio_barrial = $17,
                    margen_gestor_default_pct = $18,
                    config_ventanas_corte = $19,
                    color_primario = $20,
                    logo_original_base64 = COALESCE($21, logo_original_base64),
                    logo_mono_preview_base64 = $22,
                    logo_zpl_gfa = $23,
                    logo_zpl_config = $24,
                    activo = COALESCE($25, activo),
                    updated_at = NOW()
                WHERE id = $26
                RETURNING *`,
                [
                    slugBase,
                    nombreMarca,
                    payload.subtitulo_marca || 'Comunidad Barrial - Entrega Fresca',
                    gestorNombre,
                    payload.gestor_telefono || '',
                    payload.gestor_email || '',
                    payload.barrio_zona || '',
                    payload.direccion_retiro || '',
                    vinculoContable.bunker_cliente_id,
                    vinculoContable.codigo_bunker_cliente,
                    payload.cuenta_bancaria_id ? Number(payload.cuenta_bancaria_id) : null,
                    Boolean(payload.usa_cuenta_compartida),
                    payload.alias_bancario_display || '',
                    payload.cbu_display || '',
                    payload.titular_display || '',
                    payload.permitir_envio_barrial !== false,
                    Number(payload.cargo_envio_barrial || 0),
                    Number(payload.margen_gestor_default_pct || 28),
                    JSON.stringify(ventanas),
                    payload.color_primario || '#16a34a',
                    payload.logo_original_base64 || null,
                    conversionLogo.logo_mono_preview_base64,
                    conversionLogo.logo_zpl_gfa,
                    JSON.stringify({
                        width: conversionLogo.width,
                        height: conversionLogo.height,
                        threshold: conversionLogo.threshold,
                        mode: conversionLogo.mode,
                        invert: conversionLogo.invert,
                        iniciales: zplConfig.iniciales || ''
                    }),
                    payload.activo !== undefined ? Boolean(payload.activo) : true,
                    Number(idExistente)
                ]
            );
            nodoGuardado = upd.rows[0];
        } else {
            const ins = await client.query(
                `INSERT INTO public.nodos_maestro (
                    codigo_nodo, slug, nombre_marca, subtitulo_marca,
                    gestor_nombre, gestor_telefono, gestor_email, barrio_zona, direccion_retiro,
                    bunker_cliente_id, codigo_bunker_cliente, cuenta_bancaria_id, usa_cuenta_compartida,
                    alias_bancario_display, cbu_display, titular_display,
                    permitir_envio_barrial, cargo_envio_barrial, margen_gestor_default_pct,
                    config_ventanas_corte, color_primario,
                    logo_original_base64, logo_mono_preview_base64, logo_zpl_gfa, logo_zpl_config
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
                ) RETURNING *`,
                [
                    codigoNodo,
                    slugBase,
                    nombreMarca,
                    payload.subtitulo_marca || 'Comunidad Barrial - Entrega Fresca',
                    gestorNombre,
                    payload.gestor_telefono || '',
                    payload.gestor_email || '',
                    payload.barrio_zona || '',
                    payload.direccion_retiro || '',
                    vinculoContable.bunker_cliente_id,
                    vinculoContable.codigo_bunker_cliente,
                    payload.cuenta_bancaria_id ? Number(payload.cuenta_bancaria_id) : null,
                    Boolean(payload.usa_cuenta_compartida),
                    payload.alias_bancario_display || '',
                    payload.cbu_display || '',
                    payload.titular_display || '',
                    payload.permitir_envio_barrial !== false,
                    Number(payload.cargo_envio_barrial || 0),
                    Number(payload.margen_gestor_default_pct || 28),
                    JSON.stringify(ventanas),
                    payload.color_primario || '#16a34a',
                    payload.logo_original_base64 || null,
                    conversionLogo.logo_mono_preview_base64,
                    conversionLogo.logo_zpl_gfa,
                    JSON.stringify({
                        width: conversionLogo.width,
                        height: conversionLogo.height,
                        threshold: conversionLogo.threshold,
                        mode: conversionLogo.mode,
                        invert: conversionLogo.invert,
                        iniciales: zplConfig.iniciales || ''
                    })
                ]
            );
            nodoGuardado = ins.rows[0];

            // Vincular automáticamente el catálogo activo al nuevo Nodo con su margen por defecto
            const catActivos = await client.query('SELECT id, precio_base_nodo_final FROM public.nodos_articulos_catalogo WHERE activo = true');
            const margenDef = Number(nodoGuardado.margen_gestor_default_pct || 28);
            for (const c of catActivos.rows) {
                const base = Number(c.precio_base_nodo_final || 0);
                const pVecino = Math.ceil((base * (1 + margenDef / 100)) / 50) * 50;
                const gan = Math.max(0, pVecino - base);
                await client.query(
                    `INSERT INTO public.nodos_ofertas_gestor (
                        nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                        margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor, publicado_tienda
                    ) VALUES ($1,$2,$3,$4,$5,$6,true)
                    ON CONFLICT (nodo_id, articulo_catalogo_id) DO NOTHING`,
                    [nodoGuardado.id, c.id, base, margenDef, pVecino, gan]
                );
            }
        }

        await client.query('COMMIT');
        return nodoGuardado;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Registra una nueva propuesta de fracción solicitada por un Gestor de Nodo
 */
async function crearPropuestaFraccion(payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const nombreSugerido = String(payload.nombre_sugerido || '').trim();
    if (!nombreSugerido) {
        throw new Error('El nombre sugerido de la fracción es obligatorio.');
    }

    const countRes = await db.query('SELECT COUNT(*)::int AS total FROM public.nodos_propuestas_fracciones');
    const codigoPropuesta = `PROP-NB-${String(countRes.rows[0].total + 1).padStart(3, '0')}`;

    const ins = await db.query(
        `INSERT INTO public.nodos_propuestas_fracciones (
            codigo_propuesta, nodo_solicitante_id, nombre_sugerido, categoria_sugerida,
            flujo_sugerido, ingrediente_sugerido_id, articulo_bunker_sugerido_codigo,
            kilos_sugeridos, insumo_envase_sugerido_id, segundos_estimados,
            precio_objetivo_vecino, comentario_gestor, estado
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDIENTE_COTIZACION')
        RETURNING *`,
        [
            codigoPropuesta,
            payload.nodo_solicitante_id ? Number(payload.nodo_solicitante_id) : null,
            nombreSugerido,
            payload.categoria_sugerida || 'Frutos Secos',
            Number(payload.flujo_sugerido || 2),
            payload.ingrediente_sugerido_id ? Number(payload.ingrediente_sugerido_id) : null,
            payload.articulo_bunker_sugerido_codigo || null,
            Number(payload.kilos_sugeridos || 0.25),
            payload.insumo_envase_sugerido_id ? Number(payload.insumo_envase_sugerido_id) : null,
            Number(payload.segundos_estimados || 35),
            payload.precio_objetivo_vecino ? Number(payload.precio_objetivo_vecino) : null,
            payload.comentario_gestor || ''
        ]
    );

    return ins.rows[0];
}

/**
 * Cotiza y aprueba una fracción (desde una propuesta de gestor o creación directa en Pizarra),
 * la inserta/actualiza en public.nodos_articulos_catalogo y propaga la oferta a los Nodos.
 */
async function cotizarYAprobarArticuloNodo(payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const nombrePublico = String(payload.nombre_publico || '').trim();
    if (!nombrePublico) {
        throw new Error('El nombre público del producto para Nodos es obligatorio.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Resolver costo de envase si se indicó insumo_envase_id y no vino costo explícito
        let costoEnvaseUnitario = Number(payload.costo_envase_unitario ?? 0);
        if (payload.insumo_envase_id && !costoEnvaseUnitario) {
            const envRes = await client.query('SELECT costo_patron FROM public.ingredientes WHERE id = $1', [Number(payload.insumo_envase_id)]);
            if (envRes.rows[0]) costoEnvaseUnitario = Number(envRes.rows[0].costo_patron || 0);
        }

        // Resolver costo por kilo del insumo origen si no vino explícito
        let costoInsumoKg = Number(payload.costo_insumo_kg ?? 0);
        if (payload.ingrediente_origen_id && !costoInsumoKg) {
            const ingRes = await client.query('SELECT costo_patron FROM public.ingredientes WHERE id = $1', [Number(payload.ingrediente_origen_id)]);
            if (ingRes.rows[0]) costoInsumoKg = Number(ingRes.rows[0].costo_patron || 0);
        }

        const calc = calcularEstructuraCostosNodo({
            ...payload,
            costo_insumo_kg: costoInsumoKg,
            costo_envase_unitario: costoEnvaseUnitario
        });

        let skuNodo = String(payload.sku_nodo || '').trim().toUpperCase();
        if (!skuNodo) {
            const pref = nombrePublico
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toUpperCase()
                .replace(/[^A-Z0-9]+/g, '-')
                .split('-')
                .filter(Boolean)
                .slice(0, 2)
                .join('-');
            const gramos = Math.round(calc.kilos_unidad * 1000);
            skuNodo = `NB-${pref}-${gramos}G`;
        }

        let articuloRow;
        if (payload.catalogo_id) {
            const upd = await client.query(
                `UPDATE public.nodos_articulos_catalogo SET
                    sku_nodo = $1,
                    nombre_publico = $2,
                    categoria_familiar = $3,
                    presentacion_etiqueta = $4,
                    flujo_lamda = $5,
                    origen_tipo = $6,
                    ingrediente_origen_id = $7,
                    articulo_bunker_origen_codigo = $8,
                    kilos_unidad = $9,
                    insumo_envase_id = $10,
                    cantidad_envases_unidad = $11,
                    segundos_fraccionamiento = $12,
                    tarifa_colaborador_id = $13,
                    valor_hora_aplicado = $14,
                    costo_insumo_kg = $15,
                    costo_insumo_fraccion = $16,
                    costo_envase_aplicado = $17,
                    costo_mano_obra_aplicado = $18,
                    margen_lamda_pct = $19,
                    iva_pct = $20,
                    iibb_pct = $21,
                    costo_puro_total = $22,
                    precio_base_nodo_neto = $23,
                    precio_base_nodo_final = $24,
                    margen_sugerido_gestor_pct = $25,
                    precio_sugerido_vecino = $26,
                    notas_tecnicas = $27,
                    estado = 'APROBADO',
                    updated_at = NOW()
                WHERE id = $28
                RETURNING *`,
                [
                    skuNodo,
                    nombrePublico,
                    payload.categoria_familiar || 'Frutos Secos',
                    payload.presentacion_etiqueta || `${Math.round(calc.kilos_unidad * 1000)}g`,
                    Number(payload.flujo_lamda || 2),
                    payload.origen_tipo || 'INGREDIENTE',
                    payload.ingrediente_origen_id ? Number(payload.ingrediente_origen_id) : null,
                    payload.articulo_bunker_origen_codigo || null,
                    calc.kilos_unidad,
                    payload.insumo_envase_id ? Number(payload.insumo_envase_id) : null,
                    Number(payload.cantidad_envases_unidad || 1),
                    calc.segundos_fraccionamiento,
                    payload.tarifa_colaborador_id ? Number(payload.tarifa_colaborador_id) : null,
                    calc.valor_hora_aplicado,
                    calc.costo_insumo_kg,
                    calc.costo_insumo_fraccion,
                    calc.costo_envase_aplicado,
                    calc.costo_mano_obra_aplicado,
                    calc.margen_lamda_pct,
                    calc.iva_pct,
                    calc.iibb_pct,
                    calc.costo_puro_total,
                    calc.precio_base_nodo_neto,
                    calc.precio_base_nodo_final,
                    calc.margen_sugerido_gestor_pct,
                    calc.precio_sugerido_vecino,
                    payload.notas_tecnicas || '',
                    Number(payload.catalogo_id)
                ]
            );
            articuloRow = upd.rows[0];
        } else {
            const ins = await client.query(
                `INSERT INTO public.nodos_articulos_catalogo (
                    sku_nodo, nombre_publico, categoria_familiar, presentacion_etiqueta,
                    flujo_lamda, origen_tipo, ingrediente_origen_id, articulo_bunker_origen_codigo,
                    kilos_unidad, insumo_envase_id, cantidad_envases_unidad, segundos_fraccionamiento,
                    tarifa_colaborador_id, valor_hora_aplicado, costo_insumo_kg,
                    costo_insumo_fraccion, costo_envase_aplicado, costo_mano_obra_aplicado,
                    margen_lamda_pct, iva_pct, iibb_pct, costo_puro_total,
                    precio_base_nodo_neto, precio_base_nodo_final,
                    margen_sugerido_gestor_pct, precio_sugerido_vecino, notas_tecnicas
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
                )
                ON CONFLICT (sku_nodo) DO UPDATE SET
                    nombre_publico = EXCLUDED.nombre_publico,
                    costo_insumo_kg = EXCLUDED.costo_insumo_kg,
                    costo_insumo_fraccion = EXCLUDED.costo_insumo_fraccion,
                    costo_envase_aplicado = EXCLUDED.costo_envase_aplicado,
                    costo_mano_obra_aplicado = EXCLUDED.costo_mano_obra_aplicado,
                    margen_lamda_pct = EXCLUDED.margen_lamda_pct,
                    precio_base_nodo_neto = EXCLUDED.precio_base_nodo_neto,
                    precio_base_nodo_final = EXCLUDED.precio_base_nodo_final,
                    precio_sugerido_vecino = EXCLUDED.precio_sugerido_vecino,
                    updated_at = NOW()
                RETURNING *`,
                [
                    skuNodo,
                    nombrePublico,
                    payload.categoria_familiar || 'Frutos Secos',
                    payload.presentacion_etiqueta || `${Math.round(calc.kilos_unidad * 1000)}g`,
                    Number(payload.flujo_lamda || 2),
                    payload.origen_tipo || 'INGREDIENTE',
                    payload.ingrediente_origen_id ? Number(payload.ingrediente_origen_id) : null,
                    payload.articulo_bunker_origen_codigo || null,
                    calc.kilos_unidad,
                    payload.insumo_envase_id ? Number(payload.insumo_envase_id) : null,
                    Number(payload.cantidad_envases_unidad || 1),
                    calc.segundos_fraccionamiento,
                    payload.tarifa_colaborador_id ? Number(payload.tarifa_colaborador_id) : null,
                    calc.valor_hora_aplicado,
                    calc.costo_insumo_kg,
                    calc.costo_insumo_fraccion,
                    calc.costo_envase_aplicado,
                    calc.costo_mano_obra_aplicado,
                    calc.margen_lamda_pct,
                    calc.iva_pct,
                    calc.iibb_pct,
                    calc.costo_puro_total,
                    calc.precio_base_nodo_neto,
                    calc.precio_base_nodo_final,
                    calc.margen_sugerido_gestor_pct,
                    calc.precio_sugerido_vecino,
                    payload.notas_tecnicas || ''
                ]
            );
            articuloRow = ins.rows[0];
        }

        // Si provenía de una propuesta de fracción, marcarla como APROBADA y vincularla
        if (payload.propuesta_id) {
            await client.query(
                `UPDATE public.nodos_propuestas_fracciones SET
                    estado = 'APROBADA',
                    articulo_catalogo_id = $1,
                    respuesta_lamda = $2,
                    updated_at = NOW()
                WHERE id = $3`,
                [
                    articuloRow.id,
                    payload.respuesta_lamda || `Aprobado por LAMDA con Precio Base Nodo $${calc.precio_base_nodo_final.toLocaleString('es-AR')}`,
                    Number(payload.propuesta_id)
                ]
            );
        }

        // Propagar / actualizar en nodos_ofertas_gestor para todos los Nodos activos
        const nodosActivos = await client.query('SELECT id, margen_gestor_default_pct FROM public.nodos_maestro WHERE activo = true');
        for (const nodo of nodosActivos.rows) {
            const margenDef = Number(nodo.margen_gestor_default_pct || calc.margen_sugerido_gestor_pct || 28);
            const precioVecino = Math.ceil((calc.precio_base_nodo_final * (1 + margenDef / 100)) / 50) * 50;
            const ganancia = Math.max(0, precioVecino - calc.precio_base_nodo_final);

            await client.query(
                `INSERT INTO public.nodos_ofertas_gestor (
                    nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                    margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor, publicado_tienda
                ) VALUES ($1,$2,$3,$4,$5,$6,true)
                ON CONFLICT (nodo_id, articulo_catalogo_id) DO UPDATE SET
                    alerta_cambio_costo = (public.nodos_ofertas_gestor.precio_base_nodo_snapshot <> EXCLUDED.precio_base_nodo_snapshot),
                    precio_base_nodo_snapshot = EXCLUDED.precio_base_nodo_snapshot,
                    precio_venta_vecino = CEIL((EXCLUDED.precio_base_nodo_snapshot * (1 + public.nodos_ofertas_gestor.margen_gestor_pct / 100.0)) / 50.0) * 50,
                    ganancia_unitaria_gestor = (CEIL((EXCLUDED.precio_base_nodo_snapshot * (1 + public.nodos_ofertas_gestor.margen_gestor_pct / 100.0)) / 50.0) * 50) - EXCLUDED.precio_base_nodo_snapshot,
                    updated_at = NOW()`,
                [nodo.id, articuloRow.id, calc.precio_base_nodo_final, margenDef, precioVecino, ganancia]
            );
        }

        await client.query('COMMIT');
        return { articulo: articuloRow, calculo: calc };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Recalcula en cascada todo el catálogo de Nodos tomando los costos vivos de los 6 Flujos
 * de la base de datos (y opcionalmente costos simulados en memoria de la Pizarra).
 */
async function recalcularCascadaCatalogoNodos(costosSimuladosIngredientes = {}) {
    await asegurarEsquemaNodosBarriales();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const catRes = await client.query(`
            SELECT nac.*,
                   COALESCE(ing.costo_patron, nac.costo_insumo_kg) AS ing_costo_db,
                   COALESCE(env.costo_patron, nac.costo_envase_aplicado) AS env_costo_db,
                   COALESCE(ct.valor_hora, nac.valor_hora_aplicado) AS tarifa_hora_db
            FROM public.nodos_articulos_catalogo nac
            LEFT JOIN public.ingredientes ing ON ing.id = nac.ingrediente_origen_id
            LEFT JOIN public.ingredientes env ON env.id = nac.insumo_envase_id
            LEFT JOIN public.colaboradores_tarifas ct ON ct.id = nac.tarifa_colaborador_id
            WHERE nac.activo = true
        `);

        let actualizados = 0;
        for (const row of catRes.rows) {
            const ingId = row.ingrediente_origen_id ? Number(row.ingrediente_origen_id) : null;
            const envId = row.insumo_envase_id ? Number(row.insumo_envase_id) : null;

            const costoInsumoVivo = (ingId && costosSimuladosIngredientes[ingId] !== undefined)
                ? Number(costosSimuladosIngredientes[ingId])
                : Number(row.ing_costo_db || row.costo_insumo_kg);

            const costoEnvaseVivo = (envId && costosSimuladosIngredientes[envId] !== undefined)
                ? Number(costosSimuladosIngredientes[envId])
                : Number(row.env_costo_db || row.costo_envase_aplicado);

            const calc = calcularEstructuraCostosNodo({
                costo_insumo_kg: costoInsumoVivo,
                kilos_unidad: row.kilos_unidad,
                costo_envase_unitario: costoEnvaseVivo,
                cantidad_envases_unidad: row.cantidad_envases_unidad,
                segundos_fraccionamiento: row.segundos_fraccionamiento,
                valor_hora_aplicado: row.tarifa_hora_db || row.valor_hora_aplicado,
                margen_lamda_pct: row.margen_lamda_pct,
                iva_pct: row.iva_pct,
                iibb_pct: row.iibb_pct,
                margen_sugerido_gestor_pct: row.margen_sugerido_gestor_pct
            });

            await client.query(
                `UPDATE public.nodos_articulos_catalogo SET
                    costo_insumo_kg = $1,
                    costo_insumo_fraccion = $2,
                    costo_envase_aplicado = $3,
                    valor_hora_aplicado = $4,
                    costo_mano_obra_aplicado = $5,
                    costo_puro_total = $6,
                    precio_base_nodo_neto = $7,
                    precio_base_nodo_final = $8,
                    precio_sugerido_vecino = $9,
                    updated_at = NOW()
                WHERE id = $10`,
                [
                    calc.costo_insumo_kg,
                    calc.costo_insumo_fraccion,
                    calc.costo_envase_aplicado,
                    calc.valor_hora_aplicado,
                    calc.costo_mano_obra_aplicado,
                    calc.costo_puro_total,
                    calc.precio_base_nodo_neto,
                    calc.precio_base_nodo_final,
                    calc.precio_sugerido_vecino,
                    row.id
                ]
            );

            await client.query(
                `UPDATE public.nodos_ofertas_gestor SET
                    alerta_cambio_costo = (precio_base_nodo_snapshot <> $1),
                    precio_base_nodo_snapshot = $1,
                    precio_venta_vecino = CEIL(($1 * (1 + margen_gestor_pct / 100.0)) / 50.0) * 50,
                    ganancia_unitaria_gestor = (CEIL(($1 * (1 + margen_gestor_pct / 100.0)) / 50.0) * 50) - $1,
                    updated_at = NOW()
                WHERE articulo_catalogo_id = $2`,
                [calc.precio_base_nodo_final, row.id]
            );

            actualizados++;
        }

        await client.query('COMMIT');
        return { actualizados };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Actualiza el margen del gestor y el estado de publicación en su tienda vecinal
 */
async function actualizarOfertaGestor(ofertaId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const cur = await db.query(
        `SELECT nog.*, nac.precio_base_nodo_final
         FROM public.nodos_ofertas_gestor nog
         JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
         WHERE nog.id = $1`,
        [Number(ofertaId)]
    );
    if (cur.rows.length === 0) {
        throw new Error('Oferta de Nodo no encontrada.');
    }

    const row = cur.rows[0];
    const baseActual = Number(row.precio_base_nodo_final || row.precio_base_nodo_snapshot || 0);
    const margenPct = payload.margen_gestor_pct !== undefined
        ? Number(payload.margen_gestor_pct)
        : Number(row.margen_gestor_pct);

    const precioVecino = payload.precio_venta_vecino !== undefined
        ? Number(payload.precio_venta_vecino)
        : Math.ceil((baseActual * (1 + margenPct / 100)) / 50) * 50;

    const gananciaUnitaria = Math.max(0, precioVecino - baseActual);
    const publicado = payload.publicado_tienda !== undefined
        ? Boolean(payload.publicado_tienda)
        : Boolean(row.publicado_tienda);
    const destacado = payload.destacado_tienda !== undefined
        ? Boolean(payload.destacado_tienda)
        : Boolean(row.destacado_tienda);

    const upd = await db.query(
        `UPDATE public.nodos_ofertas_gestor SET
            precio_base_nodo_snapshot = $1,
            margen_gestor_pct = $2,
            precio_venta_vecino = $3,
            ganancia_unitaria_gestor = $4,
            publicado_tienda = $5,
            destacado_tienda = $6,
            alerta_cambio_costo = false,
            updated_at = NOW()
         WHERE id = $7
         RETURNING *`,
        [baseActual, margenPct, precioVecino, gananciaUnitaria, publicado, destacado, Number(ofertaId)]
    );

    return upd.rows[0];
}

// ============================================================================
// ETAPA 2: MOTOR DE CORTE HORARIO (CUTOFF), PANEL DEL GESTOR Y TIENDA VECINAL
// ============================================================================

const MAPA_DIAS_SEMANA = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    'miércoles': 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    'sábado': 6
};

const NOMBRES_DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function normalizarDiaIndex(nombreDia) {
    const key = String(nombreDia || '').trim().toLowerCase();
    return MAPA_DIAS_SEMANA[key] !== undefined ? MAPA_DIAS_SEMANA[key] : 3;
}

function formatearFechaCortaEs(dateObj) {
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    return `${d}/${m}`;
}

/**
 * Calcula qué fecha y ventana de entrega corresponde hoy para un Nodo según sus
 * días de entrega y horarios de corte (cutoff).
 * Si el vecino entra después del horario de corte de la entrega más próxima,
 * asigna automáticamente la siguiente fecha de entrega disponible e informa el motivo.
 */
function calcularProximaEntregaNodo(configVentanas = [], fechaReferenciaInput = null) {
    const ahora = fechaReferenciaInput ? new Date(fechaReferenciaInput) : new Date();
    const reglas = Array.isArray(configVentanas) && configVentanas.length > 0
        ? configVentanas
        : [
            { dia_entrega: 'Miércoles', cierre_dia: 'Martes', cierre_hora: '14:00', ventana_retiro: '17:00 a 20:00 hs' },
            { dia_entrega: 'Sábado', cierre_dia: 'Viernes', cierre_hora: '14:00', ventana_retiro: '10:00 a 13:30 hs' }
        ];

    const candidatas = [];

    for (let offsetDias = 0; offsetDias <= 21; offsetDias++) {
        const fechaEntrega = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + offsetDias, 12, 0, 0);
        const dowEntrega = fechaEntrega.getDay();

        for (const regla of reglas) {
            const targetDowEntrega = normalizarDiaIndex(regla.dia_entrega);
            if (dowEntrega !== targetDowEntrega) continue;

            const targetDowCierre = normalizarDiaIndex(regla.cierre_dia);
            let diffCierre = (targetDowEntrega - targetDowCierre + 7) % 7;
            if (diffCierre === 0) diffCierre = 1;

            const [hh, mm] = String(regla.cierre_hora || '14:00').split(':').map(n => Number(n) || 0);
            const fechaCorte = new Date(
                fechaEntrega.getFullYear(),
                fechaEntrega.getMonth(),
                fechaEntrega.getDate() - diffCierre,
                hh,
                mm,
                0
            );

            // Solo considerar entregas futuras (desde hoy en adelante)
            const finDiaEntrega = new Date(fechaEntrega.getFullYear(), fechaEntrega.getMonth(), fechaEntrega.getDate(), 23, 59, 59);
            if (finDiaEntrega < ahora) continue;

            const nombreDiaEntrega = NOMBRES_DIAS[dowEntrega];
            const nombreDiaCierre = NOMBRES_DIAS[fechaCorte.getDay()];
            const fechaCorta = formatearFechaCortaEs(fechaEntrega);
            const fechaIso = `${fechaEntrega.getFullYear()}-${String(fechaEntrega.getMonth() + 1).padStart(2, '0')}-${String(fechaEntrega.getDate()).padStart(2, '0')}`;

            candidatas.push({
                fecha_entrega_iso: fechaIso,
                fecha_entrega_corta: fechaCorta,
                dia_entrega_nombre: nombreDiaEntrega,
                ventana_retiro: regla.ventana_retiro || '17:00 a 20:00 hs',
                cierre_dia_nombre: nombreDiaCierre,
                cierre_hora: regla.cierre_hora || '14:00',
                cierre_fecha_corta: formatearFechaCortaEs(fechaCorte),
                timestamp_entrega: fechaEntrega.getTime(),
                timestamp_corte: fechaCorte.getTime(),
                abierta: ahora.getTime() <= fechaCorte.getTime(),
                label_completo: `${nombreDiaEntrega} ${fechaCorta} (${regla.ventana_retiro || '17:00 a 20:00 hs'})`,
                label_corte: `${nombreDiaCierre} ${formatearFechaCortaEs(fechaCorte)} a las ${regla.cierre_hora || '14:00'} hs`
            });
        }
    }

    candidatas.sort((a, b) => a.timestamp_entrega - b.timestamp_entrega);

    const primeraAbierta = candidatas.find(c => c.abierta) || candidatas[0];
    const cerradaReciente = candidatas.find(c => !c.abierta && c.timestamp_entrega < (primeraAbierta?.timestamp_entrega || Infinity));

    return {
        ahora_iso: ahora.toISOString(),
        asignada: primeraAbierta,
        paso_horario_corte: Boolean(cerradaReciente),
        entrega_anterior_cerrada: cerradaReciente || null,
        proximas_ventanas: candidatas.filter(c => c.abierta).slice(0, 4),
        mensaje_vecino: cerradaReciente
            ? `El cierre para la entrega del ${cerradaReciente.dia_entrega_nombre} ${cerradaReciente.fecha_entrega_corta} finalizó el ${cerradaReciente.cierre_dia_nombre} a las ${cerradaReciente.cierre_hora} hs. Tu pedido se agenda automáticamente para el ${primeraAbierta.label_completo}.`
            : `Pedidos abiertos hasta el ${primeraAbierta.label_corte} para recibir o retirar el ${primeraAbierta.label_completo}.`
    };
}

/**
 * Obtiene todos los datos necesarios para la Tienda Marca Blanca del Vecino y
 * para el Panel de Autogestión del Gestor de un Nodo específico (:slug).
 */
async function obtenerDatosPortalNodo(slug = '', fechaHoraSimulada = null) {
    await asegurarEsquemaNodosBarriales();

    const todosNodosRes = await db.query(
        'SELECT id, codigo_nodo, slug, nombre_marca, subtitulo_marca, gestor_nombre, barrio_zona, color_primario FROM public.nodos_maestro WHERE activo = true ORDER BY id ASC'
    );
    const todosNodos = todosNodosRes.rows;

    let nodoRes = await db.query(
        `SELECT nm.*,
                COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente
         FROM public.nodos_maestro nm
         LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
         WHERE LOWER(nm.slug) = LOWER($1)
         LIMIT 1`,
        [String(slug || '').trim()]
    );

    if (nodoRes.rows.length === 0) {
        nodoRes = await db.query(
            `SELECT nm.*,
                    COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente
             FROM public.nodos_maestro nm
             LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
             ORDER BY nm.id ASC
             LIMIT 1`
        );
    }

    if (nodoRes.rows.length === 0) {
        throw new Error('No hay Nodos Barriales configurados.');
    }

    const nodo = nodoRes.rows[0];
    const proximaEntrega = calcularProximaEntregaNodo(nodo.config_ventanas_corte, fechaHoraSimulada);

    const [ofertasRes, propuestasRes, pedidosRes, itemsPedidosRes, ingSugeriblesRes] = await Promise.all([
        db.query(
            `SELECT nog.*,
                    nac.sku_nodo,
                    nac.nombre_publico,
                    nac.categoria_familiar,
                    nac.presentacion_etiqueta,
                    nac.kilos_unidad,
                    nac.flujo_lamda,
                    nac.precio_base_nodo_final
             FROM public.nodos_ofertas_gestor nog
             JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
             WHERE nog.nodo_id = $1
               AND nac.activo = true
             ORDER BY nog.destacado_tienda DESC, nac.categoria_familiar ASC, nac.nombre_publico ASC`,
            [nodo.id]
        ),
        db.query(
            `SELECT npf.*,
                    ing.nombre AS ingrediente_sugerido_nombre
             FROM public.nodos_propuestas_fracciones npf
             LEFT JOIN public.ingredientes ing ON ing.id = npf.ingrediente_sugerido_id
             WHERE npf.nodo_solicitante_id = $1 OR npf.nodo_solicitante_id IS NULL
             ORDER BY npf.id DESC`,
            [nodo.id]
        ),
        db.query(
            `SELECT *
             FROM public.nodos_pedidos_vecinos
             WHERE nodo_id = $1
             ORDER BY id DESC
             LIMIT 50`,
            [nodo.id]
        ),
        db.query(
            `SELECT npi.*
             FROM public.nodos_pedidos_items npi
             JOIN public.nodos_pedidos_vecinos npv ON npv.id = npi.pedido_id
             WHERE npv.nodo_id = $1
             ORDER BY npi.id ASC`,
            [nodo.id]
        ),
        db.query(
            `SELECT id, nombre, COALESCE(costo_patron, 0)::numeric(14,2) AS costo_kg
             FROM public.ingredientes
             WHERE COALESCE(es_insumo, false) = false
               AND COALESCE(costo_patron, 0) > 0
               AND nombre NOT ILIKE '%Fuera de Servicio%'
             ORDER BY nombre ASC`
        )
    ]);

    const itemsPorPedido = new Map();
    for (const it of itemsPedidosRes.rows) {
        const pid = Number(it.pedido_id);
        if (!itemsPorPedido.has(pid)) itemsPorPedido.set(pid, []);
        itemsPorPedido.get(pid).push(it);
    }

    const pedidosConItems = pedidosRes.rows.map(p => ({
        ...p,
        items: itemsPorPedido.get(Number(p.id)) || []
    }));

    const ofertasPublicadas = ofertasRes.rows
        .filter(o => o.publicado_tienda)
        .map(o => ({
            oferta_id: o.id,
            articulo_catalogo_id: o.articulo_catalogo_id,
            sku_nodo: o.sku_nodo,
            nombre_publico: o.nombre_publico,
            categoria_familiar: o.categoria_familiar,
            presentacion_etiqueta: o.presentacion_etiqueta,
            kilos_unidad: Number(o.kilos_unidad),
            precio_venta_vecino: Number(o.precio_venta_vecino),
            destacado_tienda: Boolean(o.destacado_tienda)
        }));

    return {
        nodo,
        nodos_disponibles: todosNodos,
        proxima_entrega: proximaEntrega,
        ofertas_publicadas: ofertasPublicadas,
        todas_ofertas_gestor: ofertasRes.rows,
        propuestas_nodo: propuestasRes.rows,
        pedidos_nodo: pedidosConItems,
        ingredientes_sugeribles: ingSugeriblesRes.rows
    };
}

/**
 * Permite al Gestor del Nodo actualizar desde su Panel sus ventanas de entrega,
 * puntos de corte, envío barrial (100% para el gestor) y datos de contacto.
 */
async function actualizarConfiguracionGestorNodo(nodoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const cur = await db.query('SELECT * FROM public.nodos_maestro WHERE id = $1', [Number(nodoId)]);
    if (cur.rows.length === 0) {
        throw new Error('Nodo no encontrado.');
    }
    const actual = cur.rows[0];

    const ventanas = Array.isArray(payload.config_ventanas_corte)
        ? payload.config_ventanas_corte
        : actual.config_ventanas_corte;

    const upd = await db.query(
        `UPDATE public.nodos_maestro SET
            nombre_marca = COALESCE($1, nombre_marca),
            subtitulo_marca = COALESCE($2, subtitulo_marca),
            gestor_nombre = COALESCE($3, gestor_nombre),
            gestor_telefono = COALESCE($4, gestor_telefono),
            barrio_zona = COALESCE($5, barrio_zona),
            direccion_retiro = COALESCE($6, direccion_retiro),
            alias_bancario_display = COALESCE($7, alias_bancario_display),
            permitir_envio_barrial = $8,
            cargo_envio_barrial = $9,
            config_ventanas_corte = $10,
            color_primario = COALESCE($11, color_primario),
            updated_at = NOW()
         WHERE id = $12
         RETURNING *`,
        [
            payload.nombre_marca || actual.nombre_marca,
            payload.subtitulo_marca ?? actual.subtitulo_marca,
            payload.gestor_nombre || actual.gestor_nombre,
            payload.gestor_telefono ?? actual.gestor_telefono,
            payload.barrio_zona ?? actual.barrio_zona,
            payload.direccion_retiro ?? actual.direccion_retiro,
            payload.alias_bancario_display ?? actual.alias_bancario_display,
            payload.permitir_envio_barrial !== undefined ? Boolean(payload.permitir_envio_barrial) : actual.permitir_envio_barrial,
            payload.cargo_envio_barrial !== undefined ? Number(payload.cargo_envio_barrial) : Number(actual.cargo_envio_barrial),
            JSON.stringify(ventanas),
            payload.color_primario || actual.color_primario,
            Number(nodoId)
        ]
    );

    return upd.rows[0];
}

/**
 * Registra un pedido de un vecino desde la Tienda Marca Blanca (/:nodoSlug),
 * calcula el horario de corte, los márgenes del gestor + 100% del envío barrial
 * y devuelve el comprobante junto con la etiqueta térmica Zebra lista.
 */
async function crearPedidoVecinoTienda(slug, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const vecinoNombre = String(payload.vecino_nombre || '').trim();
    const vecinoTelefono = String(payload.vecino_telefono || '').trim();
    const itemsCarrito = Array.isArray(payload.items) ? payload.items : [];

    if (!vecinoNombre || !vecinoTelefono) {
        throw new Error('Por favor ingresá tu nombre y tu número de WhatsApp para coordinar la entrega.');
    }
    if (itemsCarrito.length === 0) {
        throw new Error('Tu carrito está vacío. Agregá al menos un producto para confirmar el pedido.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const nodoRes = await client.query(
            'SELECT * FROM public.nodos_maestro WHERE LOWER(slug) = LOWER($1) LIMIT 1',
            [String(slug || '').trim()]
        );
        if (nodoRes.rows.length === 0) {
            throw new Error('Tienda barrial no encontrada.');
        }
        const nodo = nodoRes.rows[0];

        const modalidad = payload.modalidad_entrega === 'ENVIO_BARRIAL' && nodo.permitir_envio_barrial
            ? 'ENVIO_BARRIAL'
            : 'RETIRO_NODO';

        if (modalidad === 'ENVIO_BARRIAL' && !String(payload.direccion_entrega || '').trim()) {
            throw new Error('Por favor indicá tu dirección en el barrio para el envío a domicilio.');
        }

        const proxima = calcularProximaEntregaNodo(nodo.config_ventanas_corte, payload.fecha_hora_simulada || null);
        const entregaAsignada = proxima.asignada;

        // Consultar las ofertas publicadas del Nodo
        const ofertasRes = await client.query(
            `SELECT nog.*, nac.sku_nodo, nac.nombre_publico, nac.presentacion_etiqueta, nac.precio_base_nodo_final
             FROM public.nodos_ofertas_gestor nog
             JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
             WHERE nog.nodo_id = $1`,
            [nodo.id]
        );
        const mapaOfertas = new Map(ofertasRes.rows.map(o => [Number(o.id), o]));

        let subtotalProductosVecino = 0;
        let totalBaseLamda = 0;
        let gananciaProductosGestor = 0;
        const itemsValidados = [];

        for (const itemReq of itemsCarrito) {
            const cant = Math.max(1, Math.round(Number(itemReq.cantidad) || 1));
            const of = mapaOfertas.get(Number(itemReq.oferta_id));
            if (!of) continue;

            const pUnitVecino = Number(of.precio_venta_vecino);
            const pUnitBaseLamda = Number(of.precio_base_nodo_final || of.precio_base_nodo_snapshot);
            const subVecino = Number((pUnitVecino * cant).toFixed(2));
            const subBase = Number((pUnitBaseLamda * cant).toFixed(2));
            const ganItem = Math.max(0, subVecino - subBase);

            subtotalProductosVecino += subVecino;
            totalBaseLamda += subBase;
            gananciaProductosGestor += ganItem;

            itemsValidados.push({
                articulo_catalogo_id: of.articulo_catalogo_id,
                sku_nodo: of.sku_nodo,
                nombre_publico: of.nombre_publico,
                presentacion_etiqueta: of.presentacion_etiqueta,
                cantidad: cant,
                precio_unitario_vecino: pUnitVecino,
                precio_unitario_base_lamda: pUnitBaseLamda,
                subtotal_vecino: subVecino,
                subtotal_base_lamda: subBase,
                ganancia_item_gestor: ganItem
            });
        }

        if (itemsValidados.length === 0) {
            throw new Error('No se pudieron validar los artículos seleccionados.');
        }

        // El cargo opcional de envío barrial corresponde 100% al gestor (sin costo base de LAMDA)
        const cargoEnvioBarrial = modalidad === 'ENVIO_BARRIAL' ? Number(nodo.cargo_envio_barrial || 0) : 0;
        const totalVecino = subtotalProductosVecino + cargoEnvioBarrial;
        const gananciaTotalGestor = gananciaProductosGestor + cargoEnvioBarrial;

        const medioPago = payload.medio_pago === 'EFECTIVO' ? 'EFECTIVO' : 'TRANSFERENCIA';
        const estadoPago = medioPago === 'EFECTIVO' ? 'COBRAR_EN_ENTREGA' : 'PENDIENTE_TRANSFERENCIA';

        // Registrar/actualizar vecino
        const insVec = await client.query(
            `INSERT INTO public.nodos_vecinos (
                nodo_id, nombre_completo, telefono_whatsapp, direccion_calle, entrecalles_referencia
             ) VALUES ($1,$2,$3,$4,$5)
             RETURNING id`,
            [
                nodo.id,
                vecinoNombre,
                vecinoTelefono,
                payload.direccion_entrega || nodo.direccion_retiro || '',
                payload.entrecalles_referencia || ''
            ]
        );
        const vecinoId = insVec.rows[0].id;

        const seqRes = await client.query('SELECT COUNT(*)::int AS total FROM public.nodos_pedidos_vecinos');
        const codigoPedido = `NB-${1041 + seqRes.rows[0].total}`;

        const direccionFinal = modalidad === 'ENVIO_BARRIAL'
            ? String(payload.direccion_entrega || '').trim()
            : (nodo.direccion_retiro || nodo.barrio_zona || '');

        const insPed = await client.query(
            `INSERT INTO public.nodos_pedidos_vecinos (
                codigo_pedido, nodo_id, vecino_id, vecino_nombre, vecino_telefono,
                modalidad_entrega, direccion_entrega, entrecalles_referencia,
                fecha_entrega_comprometida, fecha_entrega_label, ventana_horaria_label,
                entrar_en_corte_actual, medio_pago, estado_pago, estado_operativo,
                subtotal_productos_vecino, cargo_envio_barrial, total_vecino,
                total_base_lamda, ganancia_total_gestor, observaciones_vecino
             ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'CONFIRMADO_VECINO',$15,$16,$17,$18,$19,$20
             ) RETURNING *`,
            [
                codigoPedido,
                nodo.id,
                vecinoId,
                vecinoNombre,
                vecinoTelefono,
                modalidad,
                direccionFinal,
                payload.entrecalles_referencia || '',
                entregaAsignada.fecha_entrega_iso,
                entregaAsignada.label_completo,
                entregaAsignada.ventana_retiro,
                !proxima.paso_horario_corte,
                medioPago,
                estadoPago,
                subtotalProductosVecino,
                cargoEnvioBarrial,
                totalVecino,
                totalBaseLamda,
                gananciaTotalGestor,
                payload.observaciones_vecino || ''
            ]
        );
        const pedidoRow = insPed.rows[0];

        for (const it of itemsValidados) {
            await client.query(
                `INSERT INTO public.nodos_pedidos_items (
                    pedido_id, articulo_catalogo_id, sku_nodo, nombre_publico, presentacion_etiqueta,
                    cantidad, precio_unitario_vecino, precio_unitario_base_lamda,
                    subtotal_vecino, subtotal_base_lamda, ganancia_item_gestor
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [
                    pedidoRow.id,
                    it.articulo_catalogo_id,
                    it.sku_nodo,
                    it.nombre_publico,
                    it.presentacion_etiqueta,
                    it.cantidad,
                    it.precio_unitario_vecino,
                    it.precio_unitario_base_lamda,
                    it.subtotal_vecino,
                    it.subtotal_base_lamda,
                    it.ganancia_item_gestor
                ]
            );
        }

        await sincronizarCanastosEstacionNodos(client);
        await client.query('COMMIT');

        return {
            pedido: {
                ...pedidoRow,
                items: itemsValidados
            },
            nodo_pago_info: {
                nombre_marca: nodo.nombre_marca,
                alias: nodo.alias_bancario_display,
                cbu: nodo.cbu_display,
                titular: nodo.titular_display,
                gestor_nombre: nodo.gestor_nombre,
                gestor_telefono: nodo.gestor_telefono,
                direccion_retiro: nodo.direccion_retiro
            }
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Genera el preview y el código ZPL de la etiqueta térmica de un pedido vecinal real
 */
async function generarEtiquetaDePedidoExistente(pedidoId) {
    await asegurarEsquemaNodosBarriales();

    const pedRes = await db.query(
        `SELECT npv.*,
                nm.nombre_marca, nm.subtitulo_marca, nm.logo_zpl_gfa, nm.logo_mono_preview_base64
         FROM public.nodos_pedidos_vecinos npv
         JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
         WHERE npv.id = $1 LIMIT 1`,
        [Number(pedidoId)]
    );
    if (pedRes.rows.length === 0) {
        throw new Error('Pedido vecinal no encontrado.');
    }
    const ped = pedRes.rows[0];

    const itemsRes = await db.query(
        'SELECT * FROM public.nodos_pedidos_items WHERE pedido_id = $1 ORDER BY id ASC',
        [ped.id]
    );

    const esEfectivo = ped.medio_pago === 'EFECTIVO' || String(ped.estado_pago).includes('COBRAR');
    return generarPreviewVisualEtiquetaPar({
        nombre_marca: ped.nombre_marca,
        subtitulo_marca: ped.subtitulo_marca,
        logo_zpl_gfa: ped.logo_zpl_gfa,
        logo_mono_preview_base64: ped.logo_mono_preview_base64,
        pedido_codigo: ped.codigo_pedido,
        vecino_nombre: ped.vecino_nombre,
        vecino_telefono: ped.vecino_telefono,
        modalidad_entrega: `${ped.modalidad_entrega === 'ENVIO_BARRIAL' ? 'ENVIO BARRIAL' : 'RETIRO EN NODO'} (${ped.ventana_horaria_label || ''})`,
        direccion_barrial: ped.direccion_entrega || '',
        estado_pago: esEfectivo ? 'COBRAR EFECTIVO' : 'PAGADO (TRANSFERENCIA)',
        monto_cobrar: esEfectivo ? Number(ped.total_vecino) : 0,
        bultos_texto: 'BOLSA 1/1',
        items: itemsRes.rows.map(r => ({
            cantidad: r.cantidad,
            descripcion: r.nombre_publico,
            presentacion_etiqueta: r.presentacion_etiqueta
        }))
    });
}

// ============================================================================
// ETAPA 3: MESA DE ARMADO, 4° DEPÓSITO CONCEPTUAL (ESTACION_NODOS) Y QR MAESTRO
// ============================================================================

/**
 * Sincroniza automáticamente los Canastos/Lotes alojados en ESTACION_NODOS
 * agrupando los pedidos vecinales por Nodo y Ventana de Entrega.
 */
async function sincronizarCanastosEstacionNodos(runner = null) {
    const q = runner || db;

    const gruposRes = await q.query(`
        SELECT npv.nodo_id,
               nm.codigo_nodo,
               npv.fecha_entrega_label,
               MAX(npv.ventana_horaria_label) AS ventana_horaria_label,
               MIN(npv.fecha_entrega_comprometida) AS fecha_entrega_iso,
               COUNT(*)::int AS total_bolsas,
               COUNT(*) FILTER (
                   WHERE npv.estado_operativo IN ('ARMADO_EN_CANASTO', 'EN_PODER_GESTOR', 'ENTREGADO_VECINO')
               )::int AS bolsas_armadas,
               COUNT(*) FILTER (
                   WHERE npv.estado_operativo IN ('EN_PODER_GESTOR', 'ENTREGADO_VECINO')
               )::int AS bolsas_despachadas,
               COALESCE(SUM(npv.total_base_lamda), 0)::numeric(14,2) AS total_base_lamda,
               COALESCE(SUM(npv.total_vecino), 0)::numeric(14,2) AS total_venta_vecinos,
               COALESCE(SUM(npv.ganancia_total_gestor), 0)::numeric(14,2) AS ganancia_estimada_gestor
        FROM public.nodos_pedidos_vecinos npv
        JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
        GROUP BY npv.nodo_id, nm.codigo_nodo, npv.fecha_entrega_label
        ORDER BY MIN(npv.fecha_entrega_comprometida) ASC, npv.nodo_id ASC
    `);

    const kilosPorGrupoRes = await q.query(`
        SELECT npv.nodo_id,
               npv.fecha_entrega_label,
               COALESCE(SUM(npi.cantidad * COALESCE(nac.kilos_unidad, 0.25)), 0)::numeric(12,3) AS total_kilos
        FROM public.nodos_pedidos_vecinos npv
        JOIN public.nodos_pedidos_items npi ON npi.pedido_id = npv.id
        LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
        GROUP BY npv.nodo_id, npv.fecha_entrega_label
    `);

    const mapaKilos = new Map(
        kilosPorGrupoRes.rows.map(r => [`${r.nodo_id}::${r.fecha_entrega_label}`, Number(r.total_kilos || 0)])
    );

    let seqIndex = 1;
    for (const g of gruposRes.rows) {
        const keyKilos = `${g.nodo_id}::${g.fecha_entrega_label}`;
        const totalKilos = mapaKilos.get(keyKilos) || 0;

        // Generar código limpio para el canasto
        const matchFecha = String(g.fecha_entrega_label || '').match(/(\d{2})\/(\d{2})/);
        const sufijoFecha = matchFecha ? `${matchFecha[1]}${matchFecha[2]}` : `L${seqIndex}`;
        const prefijoDia = String(g.fecha_entrega_label || '').toUpperCase().startsWith('SAB') || String(g.fecha_entrega_label || '').toUpperCase().startsWith('SÁB')
            ? 'SAB'
            : 'MIE';
        const codigoCanasto = `CAN-N${String(g.nodo_id).padStart(2, '0')}-${prefijoDia}${sufijoFecha}`;
        const qrPayload = `LAMDA-CANASTO|${codigoCanasto}|NODO-${g.nodo_id}`;
        seqIndex++;

        const exRes = await q.query(
            `SELECT * FROM public.nodos_lotes_estacion
             WHERE nodo_id = $1 AND fecha_entrega_label = $2
             LIMIT 1`,
            [g.nodo_id, g.fecha_entrega_label]
        );

        const totalBolsas = Number(g.total_bolsas || 0);
        const bolsasArmadas = Number(g.bolsas_armadas || 0);
        const bolsasDespachadas = Number(g.bolsas_despachadas || 0);

        let estadoCalculado = 'EN_ARMADO';
        let ubicacionCalculada = 'ESTACION_NODOS';
        if (bolsasDespachadas > 0 && bolsasDespachadas === totalBolsas) {
            estadoCalculado = 'ENTREGADO_AL_GESTOR';
            ubicacionCalculada = 'DESPACHADO_NODO';
        } else if (totalBolsas > 0 && bolsasArmadas === totalBolsas) {
            estadoCalculado = 'LISTO_ESTACION_NODOS';
            ubicacionCalculada = 'ESTACION_NODOS';
        }

        let canastoId;
        if (exRes.rows.length === 0) {
            const ins = await q.query(
                `INSERT INTO public.nodos_lotes_estacion (
                    codigo_canasto, qr_maestro_payload, nodo_id, fecha_entrega_iso,
                    fecha_entrega_label, ventana_horaria_label, ubicacion_deposito, estado_canasto,
                    total_bolsas, bolsas_armadas, total_kilos_lote,
                    total_base_lamda, total_venta_vecinos, ganancia_estimada_gestor,
                    fecha_listo_estacion
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                 RETURNING id`,
                [
                    codigoCanasto,
                    qrPayload,
                    g.nodo_id,
                    g.fecha_entrega_iso || null,
                    g.fecha_entrega_label,
                    g.ventana_horaria_label || '',
                    ubicacionCalculada,
                    estadoCalculado,
                    totalBolsas,
                    bolsasArmadas,
                    totalKilos,
                    Number(g.total_base_lamda || 0),
                    Number(g.total_venta_vecinos || 0),
                    Number(g.ganancia_estimada_gestor || 0),
                    estadoCalculado === 'LISTO_ESTACION_NODOS' ? new Date() : null
                ]
            );
            canastoId = ins.rows[0].id;
        } else {
            const actual = exRes.rows[0];
            canastoId = actual.id;
            const preservarEntregado = actual.estado_canasto === 'ENTREGADO_AL_GESTOR' && bolsasDespachadas === totalBolsas;
            const estadoFinal = preservarEntregado ? 'ENTREGADO_AL_GESTOR' : estadoCalculado;
            const ubicacionFinal = estadoFinal === 'ENTREGADO_AL_GESTOR' ? 'DESPACHADO_NODO' : 'ESTACION_NODOS';

            await q.query(
                `UPDATE public.nodos_lotes_estacion
                 SET total_bolsas = $1,
                     bolsas_armadas = $2,
                     total_kilos_lote = $3,
                     total_base_lamda = $4,
                     total_venta_vecinos = $5,
                     ganancia_estimada_gestor = $6,
                     estado_canasto = $7::varchar,
                     ubicacion_deposito = $8::varchar,
                     fecha_listo_estacion = CASE
                         WHEN $7::varchar = 'LISTO_ESTACION_NODOS' AND fecha_listo_estacion IS NULL THEN NOW()
                         ELSE fecha_listo_estacion
                     END,
                     updated_at = NOW()
                 WHERE id = $9`,
                [
                    totalBolsas,
                    bolsasArmadas,
                    totalKilos,
                    Number(g.total_base_lamda || 0),
                    Number(g.total_venta_vecinos || 0),
                    Number(g.ganancia_estimada_gestor || 0),
                    estadoFinal,
                    ubicacionFinal,
                    canastoId
                ]
            );
        }

        // Vincular los pedidos vecinales de esa ventana con su Canasto en ESTACION_NODOS
        await q.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET lote_canasto_id = $1::int
             WHERE nodo_id = $2::int
               AND fecha_entrega_label = $3::varchar
               AND (lote_canasto_id IS NULL OR lote_canasto_id <> $1::int)`,
            [canastoId, g.nodo_id, g.fecha_entrega_label]
        );
    }

    // Sincronizar automáticamente con las tablas operativas habituales de LAMDA
    await sincronizarNodosConCircuitoOperativoLamda(q);
}

/**
 * Sincroniza de forma nativa los Nodos, sus Fracciones aprobadas y sus Canastos/Lotes
 * dentro del circuito operativo habitual de LAMDA:
 * 1. public.clientes + public.bunker_clientes + public.clientes_domicilios (con coordenadas validadas para Mapa Logística :3005)
 * 2. public.articulos + public.bunker_articulos + public.stock_real_consolidado + public.recetas + public.receta_ingredientes (para Configurar Carros y Carro Personal)
 * 3. public.presupuestos + public.presupuestos_detalles (para Pizarra Principal :3000, Imprimir, Armar Pedido, Chequeo, Retira Depósito y Reparto :3005)
 */
async function sincronizarNodosConCircuitoOperativoLamda(runner = null) {
    const q = runner || db;

    // 0. Primera vinculación: si CAN-N01-MIE1111 aún no tiene presupuesto_id_local y estaba cerrado por prueba previa,
    // dejarlo en la Etapa 1 (Imprimir + Faltantes) para que el equipo pueda probar el flujo completo de punta a punta.
    const checkFirstLink = await q.query(`
        SELECT id, codigo_canasto, estado_canasto, presupuesto_id_local, debito_cta_cte_registrado, movimiento_cc_id, nodo_id, total_base_lamda
        FROM public.nodos_lotes_estacion
        WHERE codigo_canasto = 'CAN-N01-MIE1111'
        LIMIT 1
    `);
    let inicializarStockFaltantesDemo = false;
    if (checkFirstLink.rows.length > 0 && !checkFirstLink.rows[0].presupuesto_id_local) {
        inicializarStockFaltantesDemo = true;
        const can1 = checkFirstLink.rows[0];
        const nmRes = await q.query('SELECT codigo_bunker_cliente FROM public.nodos_maestro WHERE id = $1', [can1.nodo_id]);
        const codBunker = nmRes.rows[0]?.codigo_bunker_cliente;

        // Limpiar liquidación/cobros previos de prueba en CAN-N01-MIE1111 para que arranque limpio en Etapa 1
        await q.query('DELETE FROM public.nodos_liquidaciones_lote WHERE lote_canasto_id = $1', [can1.id]);
        await q.query('DELETE FROM public.nodos_movimientos_cta_cte WHERE lote_canasto_id = $1', [can1.id]);
        if (codBunker) {
            await q.query('UPDATE public.factura_cuentas_corrientes SET saldo = 0, actualizada_en = NOW() WHERE codigo_bunker_cliente = $1', [codBunker]);
            await q.query(`DELETE FROM public.factura_cuenta_corriente_movimientos WHERE tipo_comprobante IN ('CANASTO_NODO', 'TRANSFERENCIA_VECINO_NODO', 'LIQUIDACION_LOTE_NODO')`);
        }
        await q.query(`
            UPDATE public.nodos_pedidos_vecinos
            SET estado_operativo = 'CONFIRMADO_VECINO',
                ubicacion_deposito = 'PENDIENTE_TALLER',
                estado_pago = CASE WHEN medio_pago = 'EFECTIVO' THEN 'COBRAR_EN_ENTREGA' ELSE 'PENDIENTE_TRANSFERENCIA' END,
                impactado_cta_cte_pago = false,
                movimiento_pago_cc_id = NULL,
                fecha_conciliacion_pago = NULL
            WHERE lote_canasto_id = $1
        `, [can1.id]);
        await q.query(`
            UPDATE public.nodos_lotes_estacion
            SET estado_canasto = 'EN_ARMADO',
                ubicacion_deposito = 'ESTACION_NODOS',
                bolsas_armadas = 0,
                secuencia_operativa_lamda = 'Imprimir',
                debito_cta_cte_registrado = false,
                movimiento_cc_id = NULL,
                liquidacion_cerrada = false,
                liquidacion_id = NULL,
                retirado_por_gestor = NULL,
                fecha_retiro_gestor = NULL
            WHERE id = $1
        `, [can1.id]);
    }

    // 1. Asegurar Clientes y Domicilios Geolocalizados por cada Nodo
    const nodosRes = await q.query('SELECT * FROM public.nodos_maestro ORDER BY id ASC');
    const mapaClienteDomicilio = new Map();

    for (const nodo of nodosRes.rows) {
        const clienteIdNum = 9000 + Number(nodo.id);
        const nombreCliente = `🏘️ NODO: ${nodo.nombre_marca}`;
        const apellidoCliente = `(${nodo.gestor_nombre})`;

        const cliCheck = await q.query('SELECT id FROM public.clientes WHERE cliente_id = $1 LIMIT 1', [clienteIdNum]);
        let clientePkId;
        if (cliCheck.rows.length === 0) {
            const insCli = await q.query(
                `INSERT INTO public.clientes (
                    cliente_id, nombre, apellido, telefono
                 ) VALUES ($1,$2,$3,$4)
                 RETURNING id`,
                [
                    clienteIdNum,
                    nombreCliente,
                    apellidoCliente,
                    nodo.gestor_telefono || '221-555-0100'
                ]
            );
            clientePkId = insCli.rows[0].id;
        } else {
            clientePkId = cliCheck.rows[0].id;
            await q.query(
                `UPDATE public.clientes
                 SET nombre = $1, apellido = $2, telefono = $3
                 WHERE id = $4`,
                [
                    nombreCliente,
                    apellidoCliente,
                    nodo.gestor_telefono || '221-555-0100',
                    clientePkId
                ]
            );
        }

        if (nodo.bunker_cliente_id) {
            await q.query(
                `UPDATE public.bunker_clientes
                 SET lomas_soft_id = $1
                 WHERE id = $2 AND (lomas_soft_id IS NULL OR lomas_soft_id <> $1)`,
                [String(clienteIdNum), nodo.bunker_cliente_id]
            );
        }

        // Coordenadas reales en City Bell / Gonnet para el Mapa de Logística (:3005)
        const esGonnet = String(nodo.barrio_zona || nodo.nombre_marca || '').toLowerCase().includes('gonnet');
        const lat = esGonnet ? -34.8812 : -34.8625;
        const lng = esGonnet ? -58.0195 : -58.0465;

        const domCheck = await q.query(
            `SELECT id FROM public.clientes_domicilios
             WHERE id_cliente = $1 AND activo = true
             ORDER BY es_predeterminado DESC, id ASC LIMIT 1`,
            [clientePkId]
        );
        let domicilioId;
        if (domCheck.rows.length === 0) {
            const insDom = await q.query(
                `INSERT INTO public.clientes_domicilios (
                    id_cliente, alias, direccion, localidad, provincia, codigo_postal,
                    latitud, longitud, instrucciones_entrega, telefono_contacto,
                    es_predeterminado, activo, coordenadas_validadas
                 ) VALUES ($1,$2,$3,$4,'Buenos Aires','1896',$5,$6,$7,$8,true,true,true)
                 RETURNING id`,
                [
                    clientePkId,
                    `Sede ${nodo.nombre_marca}`,
                    nodo.direccion_retiro || 'Calle Cantilo 452, City Bell',
                    nodo.barrio_zona || 'City Bell',
                    lat,
                    lng,
                    `Entrega de Canastos Nodos Barriales · Gestor: ${nodo.gestor_nombre}`,
                    nodo.gestor_telefono || '221-555-0100'
                ]
            );
            domicilioId = insDom.rows[0].id;
        } else {
            domicilioId = domCheck.rows[0].id;
            await q.query(
                `UPDATE public.clientes_domicilios
                 SET direccion = $1, localidad = $2, latitud = COALESCE(latitud, $3), longitud = COALESCE(longitud, $4),
                     es_predeterminado = true, activo = true, coordenadas_validadas = true
                 WHERE id = $5`,
                [
                    nodo.direccion_retiro || 'Calle Cantilo 452, City Bell',
                    nodo.barrio_zona || 'City Bell',
                    lat,
                    lng,
                    domicilioId
                ]
            );
        }

        mapaClienteDomicilio.set(Number(nodo.id), {
            cliente_id_num: clienteIdNum,
            cliente_pk_id: clientePkId,
            domicilio_id: domicilioId,
            nodo
        });
    }

    // 2. Asegurar Artículos, Búnker, Stock Real Consolidado y Recetas (para Configurar Carros y Carro Personal)
    const catRes = await q.query(`
        SELECT nac.*,
               ing.nombre AS ing_origen_nombre,
               env.nombre AS env_nombre
        FROM public.nodos_articulos_catalogo nac
        LEFT JOIN public.ingredientes ing ON ing.id = nac.ingrediente_origen_id
        LEFT JOIN public.ingredientes env ON env.id = nac.insumo_envase_id
        WHERE nac.activo = true
        ORDER BY nac.id ASC
    `);

    for (const art of catRes.rows) {
        const sku = String(art.sku_nodo).trim();
        const descNodo = `[NODO] ${art.nombre_publico}`;
        const kilos = Number(art.kilos_unidad || 0.25);

        const artCheck = await q.query('SELECT numero FROM public.articulos WHERE numero = $1 OR codigo_barras = $1 LIMIT 1', [sku]);
        if (artCheck.rows.length === 0) {
            await q.query(
                `INSERT INTO public.articulos (numero, codigo_barras, nombre)
                 VALUES ($1,$1,$2)`,
                [sku, descNodo]
            );
        } else {
            await q.query(
                `UPDATE public.articulos SET nombre = $2, codigo_barras = $1 WHERE numero = $1 OR codigo_barras = $1`,
                [sku, descNodo]
            );
        }

        await q.query(
            `INSERT INTO public.bunker_articulos (
                articulo_id, codigo_barras, descripcion, descripcion_generada,
                kilos_unidad, costo_base, rubro, sub_rubro, no_producido_por_lambda, es_pack, pack_unidades
             ) VALUES ($1,$1,$2,$2,$3,$4,'NODOS_BARRIALES',$5,false,false,1)
             ON CONFLICT (articulo_id) DO UPDATE SET
                codigo_barras = EXCLUDED.codigo_barras,
                descripcion = EXCLUDED.descripcion,
                descripcion_generada = EXCLUDED.descripcion_generada,
                kilos_unidad = EXCLUDED.kilos_unidad,
                costo_base = EXCLUDED.costo_base`,
            [sku, descNodo, kilos, Number(art.costo_puro_total || 0), art.categoria_familiar || 'Fraccionados']
        );

        // Stock inicial en stock_real_consolidado:
        // NB-ALM-250G = 1 (faltan 3 para las 4 pedidas en CAN-N01-MIE1111)
        // NB-MIX-PASAS-500G = 1 (faltan 2 para las 3 pedidas en CAN-N01-MIE1111)
        // Resto = 10 (Completos)
        const stockInicial = (sku === 'NB-ALM-250G' || sku === 'NB-MIX-PASAS-500G') ? 1 : 10;
        const srcCheck = await q.query('SELECT articulo_numero FROM public.stock_real_consolidado WHERE articulo_numero = $1 OR codigo_barras = $1 LIMIT 1', [sku]);
        if (srcCheck.rows.length === 0) {
            await q.query(
                `INSERT INTO public.stock_real_consolidado (
                    articulo_numero, codigo_barras, descripcion, stock_lomasoft, stock_movimientos,
                    stock_ajustes, stock_consolidado, kilos_unidad, no_producido_por_lambda, solo_produccion_externa, es_pack
                 ) VALUES ($1,$1,$2,0,$3,0,$3,$4,false,false,false)`,
                [sku, descNodo, stockInicial, kilos]
            );
        } else if (inicializarStockFaltantesDemo) {
            await q.query(
                `UPDATE public.stock_real_consolidado
                 SET descripcion = $1, kilos_unidad = $2, stock_consolidado = $3, stock_movimientos = $3
                 WHERE articulo_numero = $4 OR codigo_barras = $4`,
                [descNodo, kilos, stockInicial, sku]
            );
        }

        // Asegurar Receta en public.recetas + public.receta_ingredientes para el Carro Personal
        if (art.ingrediente_origen_id) {
            const recCheck = await q.query('SELECT id FROM public.recetas WHERE articulo_numero = $1 LIMIT 1', [sku]);
            let recetaId;
            if (recCheck.rows.length === 0) {
                const insRec = await q.query(
                    `INSERT INTO public.recetas (articulo_numero, descripcion, fecha_creacion, enlazado_externo)
                     VALUES ($1, $2, NOW(), false)
                     RETURNING id`,
                    [sku, `Fraccionamiento Nodo: ${art.nombre_publico}`]
                );
                recetaId = insRec.rows[0].id;
            } else {
                recetaId = recCheck.rows[0].id;
            }

            const riCheck = await q.query('SELECT COUNT(*)::int AS total FROM public.receta_ingredientes WHERE receta_id = $1', [recetaId]);
            if (riCheck.rows[0].total === 0) {
                await q.query(
                    `INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, cantidad)
                     VALUES ($1, $2, $3, 'kg', $4)`,
                    [recetaId, art.ingrediente_origen_id, art.ing_origen_nombre || art.nombre_publico, kilos]
                );
                if (art.insumo_envase_id && art.env_nombre) {
                    await q.query(
                        `INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, cantidad)
                         VALUES ($1, $2, $3, 'u', $4)`,
                        [recetaId, art.insumo_envase_id, art.env_nombre, Number(art.cantidad_envases_unidad || 1)]
                    );
                }
            }
        }
    }

    // 3. Sincronizar cada Canasto/Lote con public.presupuestos y public.presupuestos_detalles
    const canastosRes = await q.query(`
        SELECT nle.*, nm.nombre_marca, nm.gestor_nombre
        FROM public.nodos_lotes_estacion nle
        JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
        ORDER BY nle.id ASC
    `);

    for (const canasto of canastosRes.rows) {
        const infoCli = mapaClienteDomicilio.get(Number(canasto.nodo_id));
        if (!infoCli) continue;

        const itemsConsolidadosRes = await q.query(
            `SELECT npi.sku_nodo,
                    MAX(npi.nombre_publico) AS nombre_publico,
                    SUM(npi.cantidad)::numeric(12,2) AS cantidad_total,
                    MAX(npi.precio_unitario_base_lamda)::numeric(14,2) AS precio_base
             FROM public.nodos_pedidos_items npi
             JOIN public.nodos_pedidos_vecinos npv ON npv.id = npi.pedido_id
             WHERE npv.lote_canasto_id = $1
             GROUP BY npi.sku_nodo
             ORDER BY npi.sku_nodo ASC`,
            [canasto.id]
        );
        if (itemsConsolidadosRes.rows.length === 0) continue;

        // Verificar si ya existe el presupuesto en public.presupuestos
        const presCheck = await q.query(
            `SELECT * FROM public.presupuestos
             WHERE id_presupuesto_ext = $1
             ORDER BY id DESC LIMIT 1`,
            [canasto.codigo_canasto]
        );

        let secuenciaTarget = canasto.secuencia_operativa_lamda || 'Imprimir';
        let estadoTarget = 'Presupuesto/Orden';
        let estadoLogisticoTarget = 'PENDIENTE';

        if (canasto.estado_canasto === 'ENTREGADO_AL_GESTOR') {
            secuenciaTarget = 'Entregado';
            estadoTarget = 'Entregado';
            estadoLogisticoTarget = 'ENTREGADO_DEPOSITO';
        } else if (canasto.estado_canasto === 'LISTO_ESTACION_NODOS') {
            if (secuenciaTarget === 'Retira_Deposito') {
                estadoTarget = 'Retira por Deposito';
                estadoLogisticoTarget = 'PENDIENTE';
            } else {
                secuenciaTarget = 'Pedido_Listo';
                estadoTarget = 'Presupuesto/Orden';
                estadoLogisticoTarget = 'PENDIENTE_ASIGNAR';
            }
        } else {
            // EN_ARMADO
            if (secuenciaTarget !== 'Armar_Pedido' && secuenciaTarget !== 'Imprimir_Modificado') {
                secuenciaTarget = 'Imprimir';
            }
            estadoTarget = 'Presupuesto/Orden';
            estadoLogisticoTarget = 'PENDIENTE';
        }

        const notaPresupuesto = `Canasto ${canasto.codigo_canasto} (${canasto.fecha_entrega_label}) · ${canasto.total_bolsas} bolsas vecinales · Base LAMDA: $${Number(canasto.total_base_lamda || 0).toLocaleString('es-AR')}`;
        const puntoEntregaStr = `Sede ${canasto.nombre_marca} (${canasto.gestor_nombre})`;

        let presupuestoIdLocal;
        if (presCheck.rows.length === 0) {
            const insP = await q.query(
                `INSERT INTO public.presupuestos (
                    id_presupuesto_ext, id_cliente, fecha, fecha_entrega,
                    estado, secuencia, estado_logistico,
                    agente, tipo_comprobante, punto_entrega,
                    nota, id_domicilio_entrega, activo, archivado
                 ) VALUES ($1,$2,CURRENT_DATE,CURRENT_DATE,$3,$4,$5,'Nodo Barrial','Canasto Nodo',$6,$7,$8,true,false)
                 RETURNING id`,
                [
                    canasto.codigo_canasto,
                    String(infoCli.cliente_id_num),
                    estadoTarget,
                    secuenciaTarget,
                    estadoLogisticoTarget,
                    puntoEntregaStr,
                    notaPresupuesto,
                    infoCli.domicilio_id
                ]
            );
            presupuestoIdLocal = insP.rows[0].id;
        } else {
            const pExist = presCheck.rows[0];
            presupuestoIdLocal = pExist.id;

            // Si está asignado a una ruta activa en Logística (:3005), respetar id_ruta y estado_logistico de ruta
            const enRutaActiva = Boolean(pExist.id_ruta) && ['ASIGNADO', 'EN_CAMINO'].includes(String(pExist.estado_logistico || '').toUpperCase());
            const estLogFinal = enRutaActiva ? pExist.estado_logistico : estadoLogisticoTarget;
            const secFinal = enRutaActiva ? (pExist.secuencia || 'Asignado_Ruta') : secuenciaTarget;

            await q.query(
                `UPDATE public.presupuestos
                 SET id_cliente = $1,
                     fecha = CURRENT_DATE,
                     estado = $2,
                     secuencia = $3,
                     estado_logistico = $4,
                     agente = 'Nodo Barrial',
                     tipo_comprobante = 'Canasto Nodo',
                     punto_entrega = $5,
                     nota = $6,
                     id_domicilio_entrega = COALESCE(id_domicilio_entrega, $7),
                     activo = true,
                     archivado = false
                 WHERE id = $8`,
                [
                    String(infoCli.cliente_id_num),
                    estadoTarget,
                    secFinal,
                    estLogFinal,
                    puntoEntregaStr,
                    notaPresupuesto,
                    infoCli.domicilio_id,
                    presupuestoIdLocal
                ]
            );
        }

        // Actualizar presupuestos_detalles con las cantidades consolidadas de las bolsas vecinales del Canasto
        await q.query('DELETE FROM public.presupuestos_detalles WHERE id_presupuesto = $1 OR id_presupuesto_ext = $2', [presupuestoIdLocal, canasto.codigo_canasto]);
        for (const item of itemsConsolidadosRes.rows) {
            const cant = Number(item.cantidad_total || 1);
            const precioBase = Number(item.precio_base || 0);
            const subtotalBase = Number((cant * precioBase).toFixed(2));
            await q.query(
                `INSERT INTO public.presupuestos_detalles (
                    id_presupuesto, id_presupuesto_ext, articulo, cantidad,
                    valor1, precio1, iva1, diferencia, camp1, fecha_actualizacion
                 ) VALUES ($1,$2,$3,$4,$5,$6,0,0,$6,NOW())`,
                [
                    presupuestoIdLocal,
                    canasto.codigo_canasto,
                    item.sku_nodo,
                    cant,
                    precioBase,
                    subtotalBase
                ]
            );
        }

        await q.query(
            `UPDATE public.nodos_lotes_estacion
             SET presupuesto_id_local = $1,
                 id_presupuesto_ext = $2,
                 secuencia_operativa_lamda = $3
             WHERE id = $4`,
            [presupuestoIdLocal, canasto.codigo_canasto, secuenciaTarget, canasto.id]
        );
    }
}

/**
 * Sincroniza bidireccionalmente cuando desde produccion.html (Imprimir / Armar Pedido / Chequeo / Retira por Depósito)
 * se cambia la secuencia de un presupuesto que corresponde a un Canasto de Nodo Barrial.
 */
async function sincronizarCambioSecuenciaDesdeLamda(presupuestosIds = [], nuevaSecuencia = '') {
    if (!Array.isArray(presupuestosIds) || presupuestosIds.length === 0) return;

    const idsStr = presupuestosIds.map(x => String(x).trim()).filter(Boolean);
    if (idsStr.length === 0) return;

    const canRes = await db.query(
        `SELECT * FROM public.nodos_lotes_estacion
         WHERE codigo_canasto = ANY($1::text[])
            OR id_presupuesto_ext = ANY($1::text[])
            OR presupuesto_id_local::text = ANY($1::text[])`,
        [idsStr]
    );

    if (canRes.rows.length === 0) return;

    for (const canasto of canRes.rows) {
        if (nuevaSecuencia === 'Imprimir' || nuevaSecuencia === 'Imprimir_Modificado') {
            await db.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET estado_operativo = 'CONFIRMADO_VECINO',
                     ubicacion_deposito = 'PENDIENTE_TALLER'
                 WHERE lote_canasto_id = $1`,
                [canasto.id]
            );
            await db.query(
                `UPDATE public.nodos_lotes_estacion
                 SET estado_canasto = 'EN_ARMADO',
                     ubicacion_deposito = 'ESTACION_NODOS',
                     bolsas_armadas = 0,
                     secuencia_operativa_lamda = $1,
                     updated_at = NOW()
                 WHERE id = $2`,
                [nuevaSecuencia, canasto.id]
            );
        } else if (nuevaSecuencia === 'Armar_Pedido') {
            await db.query(
                `UPDATE public.nodos_lotes_estacion
                 SET estado_canasto = 'EN_ARMADO',
                     ubicacion_deposito = 'ESTACION_NODOS',
                     secuencia_operativa_lamda = 'Armar_Pedido',
                     updated_at = NOW()
                 WHERE id = $1`,
                [canasto.id]
            );
        } else if (nuevaSecuencia === 'Pedido_Listo' || nuevaSecuencia === 'Retira_Deposito') {
            // Al completar el Chequeo en produccion.html (o pasar a Retira_Deposito),
            // todas las bolsas vecinales quedan armadas en ESTACION_NODOS y el Canasto queda LISTO_ESTACION_NODOS
            await db.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET estado_operativo = 'ARMADO_EN_CANASTO',
                     ubicacion_deposito = 'ESTACION_NODOS',
                     etiqueta_impresa = true,
                     fecha_armado_bolsa = COALESCE(fecha_armado_bolsa, NOW()),
                     operario_armado = COALESCE(operario_armado, 'Chequeo Producción LAMDA'),
                     updated_at = NOW()
                 WHERE lote_canasto_id = $1`,
                [canasto.id]
            );
            await db.query(
                `UPDATE public.nodos_lotes_estacion
                 SET estado_canasto = 'LISTO_ESTACION_NODOS',
                     ubicacion_deposito = 'ESTACION_NODOS',
                     bolsas_armadas = total_bolsas,
                     secuencia_operativa_lamda = $1,
                     fecha_listo_estacion = COALESCE(fecha_listo_estacion, NOW()),
                     updated_at = NOW()
                 WHERE id = $2`,
                [nuevaSecuencia, canasto.id]
            );
        } else if (nuevaSecuencia === 'Entregado') {
            if (canasto.estado_canasto !== 'ENTREGADO_AL_GESTOR' || !canasto.debito_cta_cte_registrado) {
                await confirmarRetiroCanastoPorGestor(canasto.id, {
                    retirado_por: 'Entrega / Despacho LAMDA'
                });
            }
            await db.query(
                `UPDATE public.nodos_lotes_estacion
                 SET secuencia_operativa_lamda = 'Entregado',
                     updated_at = NOW()
                 WHERE id = $1`,
                [canasto.id]
            );
        }
    }
}

/**
 * Permite situar un Canasto en cualquiera de las etapas del circuito operativo habitual de LAMDA
 * para probar el recorrido de punta a punta:
 * - 'IMPRIMIR_CON_FALTANTES': Etapa 1 (Aparece en Pizarra :3000 con faltantes, en Configurar Carros / Carro Personal y en Bandeja Imprimir)
 * - 'ARMAR_CHEQUEO': Etapa 2/3 (Con stock listo, en Bandeja Armar Pedido lista para 🔍 Verificar / Chequeo y Etiquetas Zebra)
 * - 'PEDIDO_LISTO_REPARTO': Etapa 3/4 (Chequeo completado, Canasto Listo en ESTACION_NODOS y disponible en Logística :3005 para asignar a Ruta)
 * - 'RETIRA_DEPOSITO': Etapa 4B (En Bandeja Retira por Depósito listo para escanear QR Maestro / entregar al Gestor)
 * - 'ENTREGADO_GESTOR': Etapa 5 (Entregado al Gestor con Débito en Cuenta Corriente registrado, listo para Liquidación en /liquidacion-nodos)
 */
async function cambiarEtapaCircuitoLamdaCanasto(canastoIdOrCodigo, etapaDestino = 'IMPRIMIR_CON_FALTANTES') {
    await asegurarEsquemaNodosBarriales();

    const canRes = await db.query(
        `SELECT * FROM public.nodos_lotes_estacion
         WHERE id::text = $1 OR codigo_canasto = $1 OR id_presupuesto_ext = $1
         LIMIT 1`,
        [String(canastoIdOrCodigo).trim()]
    );
    if (canRes.rows.length === 0) {
        throw new Error('Canasto no encontrado.');
    }
    const canasto = canRes.rows[0];

    // Si estaba entregado o liquidado y vamos a una etapa previa, reabrir primero liquidación y retiro
    const etapaUpper = String(etapaDestino || '').toUpperCase().trim();
    if (etapaUpper !== 'ENTREGADO_GESTOR') {
        if (canasto.liquidacion_cerrada) {
            await reabrirLiquidacionCanastoPrueba(canasto.id);
        }
        const checkAfter = await db.query('SELECT * FROM public.nodos_lotes_estacion WHERE id = $1', [canasto.id]);
        if (checkAfter.rows[0]?.debito_cta_cte_registrado || checkAfter.rows[0]?.estado_canasto === 'ENTREGADO_AL_GESTOR') {
            await reabrirCanastoParaPruebaLaboratorio(canasto.id);
        }
        // Limpiar posible asignación de ruta previa en presupuestos
        if (canasto.presupuesto_id_local) {
            await db.query(
                `UPDATE public.presupuestos
                 SET id_ruta = NULL, orden_entrega = NULL
                 WHERE id = $1`,
                [canasto.presupuesto_id_local]
            );
        }
    }

    if (etapaUpper === 'IMPRIMIR_CON_FALTANTES') {
        // Dejar 2 artículos del canasto con faltante real para probar Pizarra Principal + Configurar Carros + Carro Personal
        await db.query(
            `UPDATE public.stock_real_consolidado
             SET stock_consolidado = 1, stock_movimientos = 1
             WHERE articulo_numero IN ('NB-ALM-250G', 'NB-MIX-PASAS-500G')`
        );
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_operativo = 'CONFIRMADO_VECINO',
                 ubicacion_deposito = 'PENDIENTE_TALLER',
                 etiqueta_impresa = false
             WHERE lote_canasto_id = $1`,
            [canasto.id]
        );
        await db.query(
            `UPDATE public.nodos_lotes_estacion
             SET estado_canasto = 'EN_ARMADO',
                 bolsas_armadas = 0,
                 secuencia_operativa_lamda = 'Imprimir'
             WHERE id = $1`,
            [canasto.id]
        );
    } else if (etapaUpper === 'ARMAR_CHEQUEO') {
        // Stock suficiente + en bandeja "Armar Pedido" listo para 🔍 Verificar (Chequeo) y Etiquetas Zebra
        await db.query(
            `UPDATE public.stock_real_consolidado
             SET stock_consolidado = GREATEST(COALESCE(stock_consolidado, 0), 12),
                 stock_movimientos = GREATEST(COALESCE(stock_movimientos, 0), 12)
             WHERE articulo_numero LIKE 'NB-%'`
        );
        await db.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_operativo = 'CONFIRMADO_VECINO',
                 ubicacion_deposito = 'PENDIENTE_TALLER'
             WHERE lote_canasto_id = $1`,
            [canasto.id]
        );
        await db.query(
            `UPDATE public.nodos_lotes_estacion
             SET estado_canasto = 'EN_ARMADO',
                 bolsas_armadas = 0,
                 secuencia_operativa_lamda = 'Armar_Pedido'
             WHERE id = $1`,
            [canasto.id]
        );
    } else if (etapaUpper === 'PEDIDO_LISTO_REPARTO') {
        await db.query(
            `UPDATE public.stock_real_consolidado
             SET stock_consolidado = GREATEST(COALESCE(stock_consolidado, 0), 12),
                 stock_movimientos = GREATEST(COALESCE(stock_movimientos, 0), 12)
             WHERE articulo_numero LIKE 'NB-%'`
        );
        await sincronizarCambioSecuenciaDesdeLamda([canasto.codigo_canasto], 'Pedido_Listo');
    } else if (etapaUpper === 'RETIRA_DEPOSITO') {
        await db.query(
            `UPDATE public.stock_real_consolidado
             SET stock_consolidado = GREATEST(COALESCE(stock_consolidado, 0), 12),
                 stock_movimientos = GREATEST(COALESCE(stock_movimientos, 0), 12)
             WHERE articulo_numero LIKE 'NB-%'`
        );
        await sincronizarCambioSecuenciaDesdeLamda([canasto.codigo_canasto], 'Retira_Deposito');
    } else if (etapaUpper === 'ENTREGADO_GESTOR') {
        await sincronizarCambioSecuenciaDesdeLamda([canasto.codigo_canasto], 'Entregado');
    }

    await sincronizarCanastosEstacionNodos();
    return obtenerEstadoCircuitoOperativoLamda();
}

/**
 * Obtiene el resumen en vivo de los Canastos de Nodos dentro del circuito operativo de LAMDA
 * para mostrar en la barra de integración de produccion.html y /deposito-nodos
 */
async function obtenerEstadoCircuitoOperativoLamda() {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const res = await db.query(`
        SELECT nle.*,
               nm.codigo_nodo,
               nm.nombre_marca,
               nm.gestor_nombre,
               nm.barrio_zona,
               nm.direccion_retiro,
               nm.codigo_bunker_cliente,
               COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente,
               p.id AS presup_id,
               p.secuencia AS presup_secuencia,
               p.estado AS presup_estado,
               p.estado_logistico AS presup_estado_logistico,
               p.id_ruta AS presup_id_ruta,
               p.id_cliente AS presup_id_cliente
        FROM public.nodos_lotes_estacion nle
        JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
        LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
        LEFT JOIN public.presupuestos p ON p.id = nle.presupuesto_id_local
        ORDER BY nle.id ASC
    `);

    await sincronizarCanastosEstacionNodos();
    const tablero = await obtenerTableroMesaArmadoDeposito();
    const mapaCanastosTablero = new Map((tablero.canastos || []).map(c => [Number(c.id), c]));

    const canastos = res.rows.map(r => {
        const det = mapaCanastosTablero.get(Number(r.id)) || {};
        return {
            ...r,
            consolidado_mercaderia: det.consolidado_mercaderia || [],
            pedidos_vecinos: det.pedidos_vecinos || []
        };
    });

    return {
        canastos,
        resumen_deposito: tablero.resumen_deposito
    };
}

/**
 * Obtiene el tablero completo de la Mesa de Armado de Nodos (4° Depósito Conceptual ESTACION_NODOS),
 * con los Canastos por ventana, el resumen consolidado de mercadería a fraccionar y las bolsas individuales.
 */
async function obtenerTableroMesaArmadoDeposito(filtros = {}) {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const nodoIdFiltro = filtros.nodo_id ? Number(filtros.nodo_id) : 0;

    const [nodosRes, canastosRes, pedidosRes, itemsRes, movsRes] = await Promise.all([
        db.query(`
            SELECT nm.id, nm.codigo_nodo, nm.slug, nm.nombre_marca, nm.subtitulo_marca,
                   nm.gestor_nombre, nm.gestor_telefono, nm.barrio_zona, nm.direccion_retiro,
                   nm.color_primario, nm.codigo_bunker_cliente,
                   COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente
            FROM public.nodos_maestro nm
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
            WHERE nm.activo = true
            ORDER BY nm.id ASC
        `),
        db.query(`
            SELECT nle.*,
                   nm.codigo_nodo,
                   nm.slug AS nodo_slug,
                   nm.nombre_marca,
                   nm.subtitulo_marca,
                   nm.gestor_nombre,
                   nm.gestor_telefono,
                   nm.barrio_zona,
                   nm.direccion_retiro,
                   nm.color_primario,
                   nm.codigo_bunker_cliente,
                   COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente
            FROM public.nodos_lotes_estacion nle
            JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
            WHERE ($1 = 0 OR nle.nodo_id = $1)
            ORDER BY
                CASE nle.estado_canasto
                    WHEN 'EN_ARMADO' THEN 0
                    WHEN 'LISTO_ESTACION_NODOS' THEN 1
                    ELSE 2
                END,
                COALESCE(nle.fecha_entrega_iso, CURRENT_DATE) ASC,
                nle.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT npv.*
            FROM public.nodos_pedidos_vecinos npv
            WHERE ($1 = 0 OR npv.nodo_id = $1)
            ORDER BY npv.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT npi.*,
                   npv.lote_canasto_id,
                   npv.codigo_pedido,
                   npv.vecino_nombre,
                   npv.estado_operativo,
                   COALESCE(nac.kilos_unidad, 0.25)::numeric(10,3) AS kilos_unidad,
                   COALESCE(nac.flujo_lamda, 2)::int AS flujo_lamda,
                   COALESCE(nac.categoria_familiar, 'Fraccionados') AS categoria_familiar
            FROM public.nodos_pedidos_items npi
            JOIN public.nodos_pedidos_vecinos npv ON npv.id = npi.pedido_id
            LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
            WHERE ($1 = 0 OR npv.nodo_id = $1)
            ORDER BY npi.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT nmc.*,
                   nm.nombre_marca,
                   nm.gestor_nombre,
                   nle.codigo_canasto
            FROM public.nodos_movimientos_cta_cte nmc
            JOIN public.nodos_maestro nm ON nm.id = nmc.nodo_id
            LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = nmc.lote_canasto_id
            WHERE ($1 = 0 OR nmc.nodo_id = $1)
            ORDER BY nmc.id DESC
            LIMIT 25
        `, [nodoIdFiltro])
    ]);

    const itemsPorPedido = new Map();
    const itemsPorCanasto = new Map();

    for (const it of itemsRes.rows) {
        const pid = Number(it.pedido_id);
        if (!itemsPorPedido.has(pid)) itemsPorPedido.set(pid, []);
        itemsPorPedido.get(pid).push(it);

        const cid = Number(it.lote_canasto_id);
        if (cid) {
            if (!itemsPorCanasto.has(cid)) itemsPorCanasto.set(cid, []);
            itemsPorCanasto.get(cid).push(it);
        }
    }

    const pedidosPorCanasto = new Map();
    for (const p of pedidosRes.rows) {
        const cid = Number(p.lote_canasto_id);
        const pedidoEnriquecido = {
            ...p,
            bolsa_lista: ['ARMADO_EN_CANASTO', 'EN_PODER_GESTOR', 'ENTREGADO_VECINO'].includes(p.estado_operativo),
            despachado_gestor: ['EN_PODER_GESTOR', 'ENTREGADO_VECINO'].includes(p.estado_operativo),
            items: itemsPorPedido.get(Number(p.id)) || []
        };
        if (!pedidosPorCanasto.has(cid)) pedidosPorCanasto.set(cid, []);
        pedidosPorCanasto.get(cid).push(pedidoEnriquecido);
    }

    const canastosDetallados = canastosRes.rows.map(c => {
        const cid = Number(c.id);
        const pedidosCanasto = pedidosPorCanasto.get(cid) || [];
        const itemsCanasto = itemsPorCanasto.get(cid) || [];

        // Construir consolidado de mercadería a fraccionar para completar este Canasto
        const mapaConsolidado = new Map();
        for (const it of itemsCanasto) {
            const key = `${it.sku_nodo || it.nombre_publico}`;
            if (!mapaConsolidado.has(key)) {
                mapaConsolidado.set(key, {
                    articulo_catalogo_id: it.articulo_catalogo_id,
                    sku_nodo: it.sku_nodo || 'S/C',
                    nombre_publico: it.nombre_publico,
                    presentacion_etiqueta: it.presentacion_etiqueta || '',
                    categoria_familiar: it.categoria_familiar || '',
                    flujo_lamda: Number(it.flujo_lamda || 2),
                    kilos_unidad: Number(it.kilos_unidad || 0.25),
                    bolsas_totales: 0,
                    bolsas_listas: 0,
                    bolsas_pendientes: 0,
                    kilos_totales: 0,
                    vecinos_detalle: []
                });
            }
            const entry = mapaConsolidado.get(key);
            const cant = Number(it.cantidad || 1);
            const estaLista = ['ARMADO_EN_CANASTO', 'EN_PODER_GESTOR', 'ENTREGADO_VECINO'].includes(it.estado_operativo);

            entry.bolsas_totales += cant;
            if (estaLista) {
                entry.bolsas_listas += cant;
            } else {
                entry.bolsas_pendientes += cant;
            }
            entry.kilos_totales = Number((entry.bolsas_totales * entry.kilos_unidad).toFixed(3));
            entry.vecinos_detalle.push({
                codigo_pedido: it.codigo_pedido,
                vecino_nombre: it.vecino_nombre,
                cantidad: cant,
                lista: estaLista
            });
        }

        return {
            ...c,
            total_bolsas: Number(c.total_bolsas || 0),
            bolsas_armadas: Number(c.bolsas_armadas || 0),
            total_kilos_lote: Number(c.total_kilos_lote || 0),
            total_base_lamda: Number(c.total_base_lamda || 0),
            total_venta_vecinos: Number(c.total_venta_vecinos || 0),
            ganancia_estimada_gestor: Number(c.ganancia_estimada_gestor || 0),
            consolidado_mercaderia: Array.from(mapaConsolidado.values()).sort((a, b) => b.bolsas_totales - a.bolsas_totales),
            pedidos_vecinos: pedidosCanasto
        };
    });

    // Resumen global del 4° Depósito Conceptual (ESTACION_NODOS)
    const totalPedidos = pedidosRes.rows.length;
    const bolsasPendientesArmar = pedidosRes.rows.filter(p => p.estado_operativo === 'CONFIRMADO_VECINO').length;
    const bolsasEnEstacionNodos = pedidosRes.rows.filter(p => p.estado_operativo === 'ARMADO_EN_CANASTO').length;
    const bolsasEnPoderGestor = pedidosRes.rows.filter(p => ['EN_PODER_GESTOR', 'ENTREGADO_VECINO'].includes(p.estado_operativo)).length;
    const canastosListosRetiro = canastosDetallados.filter(c => c.estado_canasto === 'LISTO_ESTACION_NODOS').length;

    return {
        resumen_deposito: {
            ubicacion_virtual: 'ESTACION_NODOS',
            total_pedidos: totalPedidos,
            bolsas_pendientes_armar: bolsasPendientesArmar,
            bolsas_en_estacion_nodos: bolsasEnEstacionNodos,
            bolsas_en_poder_gestor: bolsasEnPoderGestor,
            canastos_totales: canastosDetallados.length,
            canastos_listos_retiro: canastosListosRetiro
        },
        nodos: nodosRes.rows,
        canastos: canastosDetallados,
        movimientos_cta_cte: movsRes.rows
    };
}

/**
 * Marca (o desmarca) como preparado el pedido individual de un vecino,
 * lo aloja en el Canasto dentro de ESTACION_NODOS y devuelve su par gemelo de etiquetas Zebra.
 */
async function armarBolsaPedidoVecino(pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const desmarcar = Boolean(payload.desmarcar);
    const operario = String(payload.operario || 'Equipo Depósito').trim();

    const pedRes = await db.query(
        'SELECT * FROM public.nodos_pedidos_vecinos WHERE id = $1 LIMIT 1',
        [Number(pedidoId)]
    );
    if (pedRes.rows.length === 0) {
        throw new Error('Pedido vecinal no encontrado.');
    }
    const ped = pedRes.rows[0];

    if (ped.estado_operativo === 'EN_PODER_GESTOR' || ped.estado_operativo === 'ENTREGADO_VECINO') {
        throw new Error('Este pedido ya fue retirado por el Gestor del Nodo.');
    }

    const nuevoEstado = desmarcar ? 'CONFIRMADO_VECINO' : 'ARMADO_EN_CANASTO';
    const nuevaUbicacion = desmarcar ? 'PENDIENTE_TALLER' : 'ESTACION_NODOS';

    await db.query(
        `UPDATE public.nodos_pedidos_vecinos
         SET estado_operativo = $1::varchar,
             ubicacion_deposito = $2::varchar,
             etiqueta_impresa = CASE WHEN $3::boolean THEN etiqueta_impresa ELSE true END,
             fecha_armado_bolsa = CASE WHEN $3::boolean THEN NULL ELSE NOW() END,
             operario_armado = CASE WHEN $3::boolean THEN NULL ELSE $4::varchar END,
             updated_at = NOW()
         WHERE id = $5::int`,
        [nuevoEstado, nuevaUbicacion, desmarcar, operario, Number(pedidoId)]
    );

    await sincronizarCanastosEstacionNodos();

    const etiqueta = !desmarcar ? await generarEtiquetaDePedidoExistente(pedidoId) : null;
    await sincronizarCanastosEstacionNodos();
    const tablero = await obtenerTableroMesaArmadoDeposito();
    const canastoActualizado = tablero.canastos.find(c => Number(c.id) === Number(ped.lote_canasto_id)) || null;

    return {
        pedido_id: Number(pedidoId),
        codigo_pedido: ped.codigo_pedido,
        vecino_nombre: ped.vecino_nombre,
        estado_operativo: nuevoEstado,
        ubicacion_deposito: nuevaUbicacion,
        etiqueta,
        canasto: canastoActualizado,
        tablero
    };
}

/**
 * Marca todas las bolsas pendientes de un Canasto como armadas en ESTACION_NODOS
 * y devuelve la etiqueta con el QR Maestro del Canasto lista para retiro.
 */
async function armarTodasBolsasDeCanasto(canastoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const operario = String(payload.operario || 'Equipo Depósito').trim();

    await db.query(
        `UPDATE public.nodos_pedidos_vecinos
         SET estado_operativo = 'ARMADO_EN_CANASTO',
             ubicacion_deposito = 'ESTACION_NODOS',
             etiqueta_impresa = true,
             fecha_armado_bolsa = COALESCE(fecha_armado_bolsa, NOW()),
             operario_armado = COALESCE(operario_armado, $1),
             updated_at = NOW()
         WHERE lote_canasto_id = $2
           AND estado_operativo = 'CONFIRMADO_VECINO'`,
        [operario, Number(canastoId)]
    );

    await sincronizarCanastosEstacionNodos();
    const etiquetaCanasto = await generarEtiquetaQrMaestroCanasto(canastoId);
    await sincronizarCanastosEstacionNodos();
    const tablero = await obtenerTableroMesaArmadoDeposito();

    return {
        etiqueta_canasto: etiquetaCanasto,
        tablero
    };
}

/**
 * Genera el preview y el código ZPL de la Etiqueta Maestra del Canasto (con QR Maestro)
 */
async function generarEtiquetaQrMaestroCanasto(canastoId) {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const canRes = await db.query(
        `SELECT nle.*,
                nm.nombre_marca, nm.subtitulo_marca, nm.gestor_nombre,
                nm.logo_zpl_gfa, nm.logo_mono_preview_base64
         FROM public.nodos_lotes_estacion nle
         JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
         WHERE nle.id = $1 LIMIT 1`,
        [Number(canastoId)]
    );
    if (canRes.rows.length === 0) {
        throw new Error('Canasto no encontrado en ESTACION_NODOS.');
    }
    const canasto = canRes.rows[0];

    const pedidosRes = await db.query(
        `SELECT id, codigo_pedido, vecino_nombre, total_vecino, medio_pago, estado_pago, estado_operativo
         FROM public.nodos_pedidos_vecinos
         WHERE lote_canasto_id = $1
         ORDER BY id ASC`,
        [canasto.id]
    );

    return generarPreviewVisualCanastoQrMaestro({
        nombre_marca: canasto.nombre_marca,
        codigo_canasto: canasto.codigo_canasto,
        qr_maestro_payload: canasto.qr_maestro_payload,
        gestor_nombre: canasto.gestor_nombre,
        fecha_entrega_label: canasto.fecha_entrega_label,
        total_bolsas: canasto.total_bolsas,
        bolsas_armadas: canasto.bolsas_armadas,
        total_base_lamda: canasto.total_base_lamda,
        estado_canasto: canasto.estado_canasto,
        logo_zpl_gfa: canasto.logo_zpl_gfa,
        logo_mono_preview_base64: canasto.logo_mono_preview_base64,
        pedidos: pedidosRes.rows
    });
}

/**
 * Confirma el retiro del Canasto completo por parte del Gestor del Nodo (escaneo de QR Maestro),
 * pasa todos los pedidos del lote a "En reparto / En poder del Gestor" (EN_PODER_GESTOR) y
 * registra automáticamente el Débito por el Costo Base LAMDA del lote en la Cuenta Corriente del Nodo.
 */
async function confirmarRetiroCanastoPorGestor(canastoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const canRes = await client.query(
            `SELECT nle.*,
                    nm.nombre_marca, nm.gestor_nombre, nm.codigo_bunker_cliente
             FROM public.nodos_lotes_estacion nle
             JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
             WHERE nle.id = $1
             FOR UPDATE`,
            [Number(canastoId)]
        );
        if (canRes.rows.length === 0) {
            throw new Error('Canasto no encontrado.');
        }
        const canasto = canRes.rows[0];

        if (canasto.estado_canasto === 'ENTREGADO_AL_GESTOR' && canasto.debito_cta_cte_registrado) {
            throw new Error(`El Canasto ${canasto.codigo_canasto} ya fue entregado al gestor y su débito ya se registró en Cuenta Corriente.`);
        }

        // Si se envió código QR escaneado, verificar coincidencia con código de canasto o payload QR
        if (payload.qr_escaneado) {
            const qrLimpio = String(payload.qr_escaneado || '').trim().toUpperCase();
            if (
                qrLimpio !== String(canasto.qr_maestro_payload).toUpperCase() &&
                qrLimpio !== String(canasto.codigo_canasto).toUpperCase() &&
                !qrLimpio.includes(String(canasto.codigo_canasto).toUpperCase())
            ) {
                throw new Error(`El código QR escaneado (${qrLimpio}) no coincide con el Canasto seleccionado (${canasto.codigo_canasto}).`);
            }
        }

        const retiradoPor = String(payload.retirado_por || canasto.gestor_nombre || 'Gestor del Nodo').trim();

        // Pasar todas las bolsas del Canasto a EN_PODER_GESTOR ("En reparto / En poder del Gestor")
        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_operativo = 'EN_PODER_GESTOR',
                 ubicacion_deposito = 'DESPACHADO_NODO',
                 etiqueta_impresa = true,
                 fecha_armado_bolsa = COALESCE(fecha_armado_bolsa, NOW()),
                 fecha_entrega_gestor = NOW(),
                 updated_at = NOW()
             WHERE lote_canasto_id = $1`,
            [canasto.id]
        );

        const montoDebitoBaseLamda = Number(canasto.total_base_lamda || 0);
        let saldoResultante = 0;
        let movCcFacturaId = null;

        // Impactar en Cuenta Corriente oficial del Nodo (factura_cuentas_corrientes + factura_cuenta_corriente_movimientos)
        if (canasto.codigo_bunker_cliente) {
            const ccRes = await client.query(
                `SELECT id, saldo
                 FROM public.factura_cuentas_corrientes
                 WHERE codigo_bunker_cliente = $1
                 LIMIT 1
                 FOR UPDATE`,
                [canasto.codigo_bunker_cliente]
            );

            if (ccRes.rows.length > 0) {
                const ccId = ccRes.rows[0].id;
                const saldoActual = Number(ccRes.rows[0].saldo || 0);
                // El retiro de mercadería del depósito genera un débito por el Costo Base LAMDA
                saldoResultante = Number((saldoActual - montoDebitoBaseLamda).toFixed(2));

                await client.query(
                    `UPDATE public.factura_cuentas_corrientes
                     SET saldo = $1,
                         actualizada_en = NOW()
                     WHERE id = $2`,
                    [saldoResultante, ccId]
                );

                const descMovimiento = `Retiro Canasto ${canasto.codigo_canasto} (${canasto.total_bolsas} pedidos vecinales - ${canasto.fecha_entrega_label})`;
                const insMovCc = await client.query(
                    `INSERT INTO public.factura_cuenta_corriente_movimientos (
                        cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                        tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                        creado_en, metadatos
                     ) VALUES ($1, 'DEBITO', $2, $3, 'CANASTO_NODO', NULL, $4, NOW(), NOW(), $5)
                     RETURNING id`,
                    [
                        ccId,
                        montoDebitoBaseLamda,
                        saldoResultante,
                        descMovimiento,
                        JSON.stringify({
                            canasto_id: canasto.id,
                            codigo_canasto: canasto.codigo_canasto,
                            nodo_id: canasto.nodo_id,
                            total_bolsas: canasto.total_bolsas,
                            total_venta_vecinos: Number(canasto.total_venta_vecinos || 0),
                            ganancia_estimada_gestor: Number(canasto.ganancia_estimada_gestor || 0)
                        })
                    ]
                );
                movCcFacturaId = insMovCc.rows[0].id;
            }
        }

        // Registrar también en el libro mayor específico de Nodos Barriales
        const conceptoNodo = `Débito por retiro de Canasto ${canasto.codigo_canasto} (${canasto.total_bolsas} bolsas · ${canasto.fecha_entrega_label})`;
        await client.query(
            `INSERT INTO public.nodos_movimientos_cta_cte (
                nodo_id, lote_canasto_id, tipo_movimiento, signo, monto,
                saldo_resultante, concepto, referencia_externa
             ) VALUES ($1, $2, 'DEBITO_RETIRO_LOTE', -1, $3, $4, $5, $6)`,
            [
                canasto.nodo_id,
                canasto.id,
                montoDebitoBaseLamda,
                saldoResultante,
                conceptoNodo,
                canasto.codigo_canasto
            ]
        );

        await client.query(
            `UPDATE public.nodos_lotes_estacion
             SET estado_canasto = 'ENTREGADO_AL_GESTOR',
                 ubicacion_deposito = 'DESPACHADO_NODO',
                 bolsas_armadas = total_bolsas,
                 debito_cta_cte_registrado = true,
                 movimiento_cc_id = $1,
                 retirado_por_gestor = $2,
                 fecha_retiro_gestor = NOW(),
                 updated_at = NOW()
             WHERE id = $3`,
            [movCcFacturaId, retiradoPor, canasto.id]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    await sincronizarCanastosEstacionNodos();
    const tablero = await obtenerTableroMesaArmadoDeposito();
    const canastoActualizado = tablero.canastos.find(c => Number(c.id) === Number(canastoId)) || null;

    return {
        canasto: canastoActualizado,
        tablero
    };
}

/**
 * Herramienta de Laboratorio: Permite reabrir un Canasto entregado y revertir su débito
 * de prueba para volver a ensayar el circuito de armado y escaneo de QR Maestro.
 */
async function reabrirCanastoParaPruebaLaboratorio(canastoId) {
    await asegurarEsquemaNodosBarriales();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const canRes = await client.query(
            `SELECT nle.*, nm.codigo_bunker_cliente
             FROM public.nodos_lotes_estacion nle
             JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
             WHERE nle.id = $1
             FOR UPDATE`,
            [Number(canastoId)]
        );
        if (canRes.rows.length === 0) {
            throw new Error('Canasto no encontrado.');
        }
        const canasto = canRes.rows[0];

        if (canasto.debito_cta_cte_registrado && canasto.codigo_bunker_cliente) {
            const monto = Number(canasto.total_base_lamda || 0);
            await client.query(
                `UPDATE public.factura_cuentas_corrientes
                 SET saldo = COALESCE(saldo, 0) + $1,
                     actualizada_en = NOW()
                 WHERE codigo_bunker_cliente = $2`,
                [monto, canasto.codigo_bunker_cliente]
            );
            if (canasto.movimiento_cc_id) {
                await client.query(
                    'DELETE FROM public.factura_cuenta_corriente_movimientos WHERE id = $1',
                    [canasto.movimiento_cc_id]
                );
            }
            await client.query(
                `DELETE FROM public.nodos_movimientos_cta_cte
                 WHERE lote_canasto_id = $1 AND tipo_movimiento = 'DEBITO_RETIRO_LOTE'`,
                [canasto.id]
            );
        }

        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_operativo = 'ARMADO_EN_CANASTO',
                 ubicacion_deposito = 'ESTACION_NODOS',
                 fecha_entrega_gestor = NULL,
                 updated_at = NOW()
             WHERE lote_canasto_id = $1`,
            [canasto.id]
        );

        await client.query(
            `UPDATE public.nodos_lotes_estacion
             SET estado_canasto = 'LISTO_ESTACION_NODOS',
                 ubicacion_deposito = 'ESTACION_NODOS',
                 debito_cta_cte_registrado = false,
                 movimiento_cc_id = NULL,
                 retirado_por_gestor = NULL,
                 fecha_retiro_gestor = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [canasto.id]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    await sincronizarCanastosEstacionNodos();
    return obtenerTableroMesaArmadoDeposito();
}

// ============================================================================
// ETAPA 4: CONCILIACIÓN DE COBROS (TRANSFERENCIAS Y EFECTIVO) Y LIQUIDACIÓN
// ============================================================================

function normalizarTitularBancario(str = '') {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Calcula la radiografía contable y el cuadro de compensación automática de un Canasto/Lote:
 * - Total vendido a vecinos (incluyendo envíos barriales 100% del gestor)
 * - Menos Costo Base LAMDA del lote -> Ganancia Neta del Gestor
 * - Compensación entre lo cobrado por Transferencia en banco de LAMDA vs. lo cobrado en Efectivo en mano del Gestor
 */
function calcularCuadroLiquidacionCanasto(canasto, pedidos = []) {
    let totalVentaVecinos = 0;
    let totalSubtotalProductos = 0;
    let totalEnviosBarrialesGestor = 0;
    let totalBaseLamda = 0;
    let gananciaNetaGestor = 0;

    let transferenciasEsperadas = 0;
    let transferenciasConciliadasLamda = 0;
    let cantTransferenciasTotales = 0;
    let cantTransferenciasConciliadas = 0;

    let efectivoEsperado = 0;
    let efectivoCobradoManoGestor = 0;
    let cantEfectivoTotales = 0;
    let cantEfectivoCobrados = 0;

    for (const p of pedidos) {
        const totVec = Number(p.total_vecino || 0);
        const subProd = Number(p.subtotal_productos_vecino || totVec);
        const envBarrial = Number(p.cargo_envio_barrial || 0);
        const totBase = Number(p.total_base_lamda || 0);
        const ganGestor = Number(p.ganancia_total_gestor || (totVec - totBase));

        totalVentaVecinos += totVec;
        totalSubtotalProductos += subProd;
        totalEnviosBarrialesGestor += envBarrial;
        totalBaseLamda += totBase;
        gananciaNetaGestor += ganGestor;

        const esEfectivo = String(p.medio_pago || '').toUpperCase() === 'EFECTIVO';
        const pagoConfirmado = Boolean(p.impactado_cta_cte_pago) ||
            ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(p.estado_pago || '').toUpperCase());

        if (esEfectivo) {
            cantEfectivoTotales++;
            efectivoEsperado += totVec;
            if (pagoConfirmado) {
                cantEfectivoCobrados++;
                efectivoCobradoManoGestor += totVec;
            }
        } else {
            cantTransferenciasTotales++;
            transferenciasEsperadas += totVec;
            if (pagoConfirmado) {
                cantTransferenciasConciliadas++;
                transferenciasConciliadasLamda += totVec;
            }
        }
    }

    const totalPedidos = pedidos.length;
    const pedidosPagosConfirmados = cantTransferenciasConciliadas + cantEfectivoCobrados;
    const todosPagosConfirmados = totalPedidos > 0 && pedidosPagosConfirmados === totalPedidos;

    // Para el cálculo del cuadro de compensación se usan los montos reales del lote
    const transfEnLamda = todosPagosConfirmados ? transferenciasConciliadasLamda : transferenciasEsperadas;
    const efectivoEnGestor = todosPagosConfirmados ? efectivoCobradoManoGestor : efectivoEsperado;

    // Saldo de compensación:
    // A LAMDA le corresponde cobrar `totalBaseLamda`. Ya tiene `transfEnLamda` en el banco.
    // Diferencia: `transfEnLamda - totalBaseLamda` (que es matemáticamente idéntica a `gananciaNetaGestor - efectivoEnGestor`)
    const diferenciaCompensacion = Number((transfEnLamda - totalBaseLamda).toFixed(2));

    let direccionCompensacion = 'SALDADO_EXACTO';
    let montoCompensacionFinal = 0;
    let tituloResultado = 'Cuenta Compensada en $0';
    let explicacionCompensacion = 'Las transferencias recibidas en LAMDA coinciden exactamente con el Costo Base del lote.';

    if (diferenciaCompensacion < -0.01) {
        direccionCompensacion = 'GESTOR_RINDE_A_LAMDA';
        montoCompensacionFinal = Math.abs(diferenciaCompensacion);
        tituloResultado = `El Gestor rinde a LAMDA: $${montoCompensacionFinal.toLocaleString('es-AR')}`;
        explicacionCompensacion = `El Gestor cobró $${efectivoEnGestor.toLocaleString('es-AR')} en efectivo en mano: se queda directamente con el 100% de su Ganancia Neta ($${gananciaNetaGestor.toLocaleString('es-AR')}) y rinde a LAMDA los $${montoCompensacionFinal.toLocaleString('es-AR')} restantes para completar el Costo Base del lote ($${totalBaseLamda.toLocaleString('es-AR')} menos $${transfEnLamda.toLocaleString('es-AR')} ya ingresados por transferencia en banco LAMDA).`;
    } else if (diferenciaCompensacion > 0.01) {
        direccionCompensacion = 'LAMDA_TRANSFIERE_A_GESTOR';
        montoCompensacionFinal = diferenciaCompensacion;
        tituloResultado = `LAMDA transfiere al Gestor: $${montoCompensacionFinal.toLocaleString('es-AR')}`;
        explicacionCompensacion = `Las transferencias cobradas en el banco de LAMDA ($${transfEnLamda.toLocaleString('es-AR')}) cubrieron la totalidad del Costo Base del lote ($${totalBaseLamda.toLocaleString('es-AR')}) y generaron un saldo a favor de $${montoCompensacionFinal.toLocaleString('es-AR')} que LAMDA transfiere al Gestor para completar su ganancia.`;
    }

    return {
        total_pedidos: totalPedidos,
        pedidos_pagos_confirmados: pedidosPagosConfirmados,
        todos_pagos_confirmados: todosPagosConfirmados,
        total_venta_vecinos: Number(totalVentaVecinos.toFixed(2)),
        total_subtotal_productos: Number(totalSubtotalProductos.toFixed(2)),
        total_envios_barriales_gestor: Number(totalEnviosBarrialesGestor.toFixed(2)),
        total_base_lamda: Number(totalBaseLamda.toFixed(2)),
        ganancia_neta_gestor: Number(gananciaNetaGestor.toFixed(2)),
        transferencias_esperadas: Number(transferenciasEsperadas.toFixed(2)),
        transferencias_conciliadas_lamda: Number(transferenciasConciliadasLamda.toFixed(2)),
        cant_transferencias_totales: cantTransferenciasTotales,
        cant_transferencias_conciliadas: cantTransferenciasConciliadas,
        efectivo_esperado: Number(efectivoEsperado.toFixed(2)),
        efectivo_cobrado_mano_gestor: Number(efectivoCobradoManoGestor.toFixed(2)),
        cant_efectivo_totales: cantEfectivoTotales,
        cant_efectivo_cobrados: cantEfectivoCobrados,
        direccion_compensacion: direccionCompensacion,
        monto_compensacion_final: Number(montoCompensacionFinal.toFixed(2)),
        titulo_resultado: tituloResultado,
        explicacion_compensacion: explicacionCompensacion
    };
}

/**
 * Obtiene el tablero integral de la Etapa 4: Conciliación de Transferencias,
 * Rendición de Efectivo en mano del Gestor y Liquidación de Cuenta Corriente por Lote.
 */
async function obtenerTableroLiquidacionCobros(filtros = {}) {
    await asegurarEsquemaNodosBarriales();
    await sincronizarCanastosEstacionNodos();

    const nodoIdFiltro = filtros.nodo_id ? Number(filtros.nodo_id) : 0;

    const [nodosRes, canastosRes, pedidosRes, itemsRes, aliasRes, liqRes, movsRes] = await Promise.all([
        db.query(`
            SELECT nm.id, nm.codigo_nodo, nm.slug, nm.nombre_marca, nm.subtitulo_marca,
                   nm.gestor_nombre, nm.gestor_telefono, nm.barrio_zona, nm.direccion_retiro,
                   nm.alias_bancario_display, nm.cbu_display, nm.titular_display,
                   nm.color_primario, nm.codigo_bunker_cliente,
                   COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente
            FROM public.nodos_maestro nm
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
            WHERE nm.activo = true
            ORDER BY nm.id ASC
        `),
        db.query(`
            SELECT nle.*,
                   nm.codigo_nodo,
                   nm.slug AS nodo_slug,
                   nm.nombre_marca,
                   nm.gestor_nombre,
                   nm.gestor_telefono,
                   nm.alias_bancario_display,
                   nm.cbu_display,
                   nm.titular_display,
                   nm.codigo_bunker_cliente,
                   COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente
            FROM public.nodos_lotes_estacion nle
            JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
            WHERE ($1::int = 0 OR nle.nodo_id = $1::int)
            ORDER BY
                CASE WHEN nle.estado_canasto = 'ENTREGADO_AL_GESTOR' AND COALESCE(nle.liquidacion_cerrada, false) = false THEN 0
                     WHEN COALESCE(nle.liquidacion_cerrada, false) = false THEN 1
                     ELSE 2
                END,
                nle.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT npv.*
            FROM public.nodos_pedidos_vecinos npv
            WHERE ($1::int = 0 OR npv.nodo_id = $1::int)
            ORDER BY npv.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT npi.*
            FROM public.nodos_pedidos_items npi
            JOIN public.nodos_pedidos_vecinos npv ON npv.id = npi.pedido_id
            WHERE ($1::int = 0 OR npv.nodo_id = $1::int)
            ORDER BY npi.id ASC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT *
            FROM public.nodos_alias_vecinos_aprendidos
            WHERE ($1::int = 0 OR nodo_id = $1::int)
            ORDER BY updated_at DESC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT *
            FROM public.nodos_liquidaciones_lote
            WHERE ($1::int = 0 OR nodo_id = $1::int)
            ORDER BY id DESC
        `, [nodoIdFiltro]),
        db.query(`
            SELECT nmc.*,
                   nm.nombre_marca,
                   nm.gestor_nombre,
                   nle.codigo_canasto
            FROM public.nodos_movimientos_cta_cte nmc
            JOIN public.nodos_maestro nm ON nm.id = nmc.nodo_id
            LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = nmc.lote_canasto_id
            WHERE ($1::int = 0 OR nmc.nodo_id = $1::int)
            ORDER BY nmc.id DESC
            LIMIT 40
        `, [nodoIdFiltro])
    ]);

    const itemsPorPedido = new Map();
    for (const it of itemsRes.rows) {
        const pid = Number(it.pedido_id);
        if (!itemsPorPedido.has(pid)) itemsPorPedido.set(pid, []);
        itemsPorPedido.get(pid).push(it);
    }

    const pedidosPorCanasto = new Map();
    for (const p of pedidosRes.rows) {
        const cid = Number(p.lote_canasto_id);
        const pagoConfirmado = Boolean(p.impactado_cta_cte_pago) ||
            ['CONCILIADO_BANCO_LAMDA', 'COBRADO_EFECTIVO_GESTOR'].includes(String(p.estado_pago || '').toUpperCase());

        const titularSugerido = p.titular_transferencia || normalizarTitularBancario(p.vecino_nombre);
        const enriched = {
            ...p,
            pago_confirmado: pagoConfirmado,
            titular_sugerido: titularSugerido,
            items: itemsPorPedido.get(Number(p.id)) || []
        };
        if (!pedidosPorCanasto.has(cid)) pedidosPorCanasto.set(cid, []);
        pedidosPorCanasto.get(cid).push(enriched);
    }

    const liqPorCanasto = new Map(liqRes.rows.map(l => [Number(l.lote_canasto_id), l]));

    const lotes = canastosRes.rows.map(c => {
        const cid = Number(c.id);
        const pedidosLote = pedidosPorCanasto.get(cid) || [];
        const cuadro = calcularCuadroLiquidacionCanasto(c, pedidosLote);
        return {
            ...c,
            cuadro_liquidacion: cuadro,
            pedidos_vecinos: pedidosLote,
            liquidacion_oficial: liqPorCanasto.get(cid) || null
        };
    });

    return {
        nodos: nodosRes.rows,
        lotes,
        alias_aprendidos: aliasRes.rows,
        movimientos_cta_cte: movsRes.rows
    };
}

/**
 * Concilia el pago de un pedido vecinal:
 * - Si es TRANSFERENCIA: Acredita (+total_vecino) a favor del Nodo en su Cuenta Corriente con LAMDA
 *   (ya que el dinero ingresó en la cuenta recaudadora de LAMDA) y memoriza el titular bancario del vecino.
 * - Si es EFECTIVO: Registra el cobro en efectivo en mano del Gestor (emitiendo recibo vecinal y
 *   computándolo como efectivo retenido por el Gestor para la compensación final del lote).
 */
async function conciliarPagoPedidoVecino(pedidoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const pedRes = await client.query(
            `SELECT npv.*,
                    nm.nombre_marca, nm.gestor_nombre, nm.codigo_bunker_cliente, nm.alias_bancario_display,
                    nle.codigo_canasto
             FROM public.nodos_pedidos_vecinos npv
             JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
             LEFT JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
             WHERE npv.id = $1::int
             FOR UPDATE OF npv`,
            [Number(pedidoId)]
        );
        if (pedRes.rows.length === 0) {
            throw new Error('Pedido vecinal no encontrado.');
        }
        const ped = pedRes.rows[0];

        if (ped.impactado_cta_cte_pago) {
            await client.query('COMMIT');
            return obtenerTableroLiquidacionCobros();
        }

        const montoTotalVecino = Number(ped.total_vecino || 0);
        const esEfectivo = String(ped.medio_pago || '').toUpperCase() === 'EFECTIVO';

        let saldoResultante = 0;
        let movCcFacturaId = null;

        const ccRes = ped.codigo_bunker_cliente
            ? await client.query(
                `SELECT id, saldo FROM public.factura_cuentas_corrientes
                 WHERE codigo_bunker_cliente = $1
                 LIMIT 1
                 FOR UPDATE`,
                [ped.codigo_bunker_cliente]
            )
            : { rows: [] };

        const saldoActual = ccRes.rows.length > 0 ? Number(ccRes.rows[0].saldo || 0) : 0;

        if (!esEfectivo) {
            // 1. TRANSFERENCIA BANCARIA RECIBIDA EN CUENTA DE LAMDA -> CRÉDITO A FAVOR DEL NODO (+montoTotalVecino)
            const titularInput = payload.titular_transferencia || ped.titular_transferencia || normalizarTitularBancario(ped.vecino_nombre);
            const titularNorm = normalizarTitularBancario(titularInput);
            const referencia = String(payload.comprobante_referencia || `TRF-${ped.codigo_pedido}`).trim();
            const billetera = String(payload.billetera_origen || 'Mercado Pago / Transferencia').trim();

            saldoResultante = Number((saldoActual + montoTotalVecino).toFixed(2));

            if (ccRes.rows.length > 0) {
                const ccId = ccRes.rows[0].id;
                await client.query(
                    `UPDATE public.factura_cuentas_corrientes
                     SET saldo = $1, actualizada_en = NOW()
                     WHERE id = $2`,
                    [saldoResultante, ccId]
                );

                const descCc = `Transferencia Vecino #${ped.codigo_pedido} (${ped.vecino_nombre} · Titular: ${titularNorm}) acreditada en cuenta LAMDA`;
                const insMov = await client.query(
                    `INSERT INTO public.factura_cuenta_corriente_movimientos (
                        cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                        tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                        creado_en, metadatos
                     ) VALUES ($1, 'CREDITO', $2, $3, 'TRANSFERENCIA_VECINO_NODO', NULL, $4, NOW(), NOW(), $5)
                     RETURNING id`,
                    [
                        ccId,
                        montoTotalVecino,
                        saldoResultante,
                        descCc,
                        JSON.stringify({
                            pedido_id: ped.id,
                            codigo_pedido: ped.codigo_pedido,
                            vecino_nombre: ped.vecino_nombre,
                            titular_normalizado: titularNorm,
                            referencia
                        })
                    ]
                );
                movCcFacturaId = insMov.rows[0].id;
            }

            // Aprendizaje automático del titular para futuras transferencias del vecino
            await client.query(
                `INSERT INTO public.nodos_alias_vecinos_aprendidos (
                    nodo_id, vecino_id, vecino_nombre, titular_normalizado, billetera_banco_origen, usos_confirmados, updated_at
                 ) VALUES ($1, $2, $3, $4, $5, 1, NOW())
                 ON CONFLICT (nodo_id, titular_normalizado)
                 DO UPDATE SET
                    vecino_nombre = EXCLUDED.vecino_nombre,
                    billetera_banco_origen = EXCLUDED.billetera_banco_origen,
                    usos_confirmados = public.nodos_alias_vecinos_aprendidos.usos_confirmados + 1,
                    updated_at = NOW()`,
                [ped.nodo_id, ped.vecino_id, ped.vecino_nombre, titularNorm, billetera]
            );

            await client.query(
                `INSERT INTO public.nodos_movimientos_cta_cte (
                    nodo_id, lote_canasto_id, pedido_vecino_id, tipo_movimiento, signo,
                    monto, saldo_resultante, concepto, referencia_externa
                 ) VALUES ($1, $2, $3, 'CREDITO_TRANSFERENCIA_VECINO', 1, $4, $5, $6, $7)`,
                [
                    ped.nodo_id,
                    ped.lote_canasto_id,
                    ped.id,
                    montoTotalVecino,
                    saldoResultante,
                    `Transferencia conciliada en Banco LAMDA: #${ped.codigo_pedido} (${ped.vecino_nombre} · Titular: ${titularNorm})`,
                    referencia
                ]
            );

            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET estado_pago = 'CONCILIADO_BANCO_LAMDA',
                     titular_transferencia = $1,
                     comprobante_referencia = $2,
                     fecha_conciliacion_pago = NOW(),
                     impactado_cta_cte_pago = true,
                     movimiento_pago_cc_id = $3,
                     updated_at = NOW()
                 WHERE id = $4`,
                [titularNorm, referencia, movCcFacturaId, ped.id]
            );
        } else {
            // 2. EFECTIVO COBRADO EN MANO POR EL GESTOR AL ENTREGAR AL VECINO
            const referencia = String(payload.comprobante_referencia || `REC-EFVO-${ped.codigo_pedido}`).trim();
            saldoResultante = saldoActual;

            await client.query(
                `INSERT INTO public.nodos_movimientos_cta_cte (
                    nodo_id, lote_canasto_id, pedido_vecino_id, tipo_movimiento, signo,
                    monto, saldo_resultante, concepto, referencia_externa
                 ) VALUES ($1, $2, $3, 'COBRO_EFECTIVO_MANO_GESTOR', 0, $4, $5, $6, $7)`,
                [
                    ped.nodo_id,
                    ped.lote_canasto_id,
                    ped.id,
                    montoTotalVecino,
                    saldoResultante,
                    `Cobro en Efectivo en mano del Gestor: #${ped.codigo_pedido} (${ped.vecino_nombre}) — Retenido por ${ped.gestor_nombre} a cuenta de comisión y liquidación`,
                    referencia
                ]
            );

            await client.query(
                `UPDATE public.nodos_pedidos_vecinos
                 SET estado_pago = 'COBRADO_EFECTIVO_GESTOR',
                     estado_operativo = CASE WHEN estado_operativo = 'EN_PODER_GESTOR' THEN 'ENTREGADO_VECINO' ELSE estado_operativo END,
                     comprobante_referencia = $1,
                     fecha_conciliacion_pago = NOW(),
                     impactado_cta_cte_pago = true,
                     updated_at = NOW()
                 WHERE id = $2`,
                [referencia, ped.id]
            );
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    return obtenerTableroLiquidacionCobros();
}

/**
 * Concilia en un solo paso todos los cobros pendientes (transferencias y efectivo) de un Canasto/Lote
 */
async function conciliarTodosLosPagosPendientesCanasto(canastoId) {
    await asegurarEsquemaNodosBarriales();

    const peds = await db.query(
        `SELECT id FROM public.nodos_pedidos_vecinos
         WHERE lote_canasto_id = $1::int
           AND COALESCE(impactado_cta_cte_pago, false) = false
         ORDER BY id ASC`,
        [Number(canastoId)]
    );

    for (const row of peds.rows) {
        await conciliarPagoPedidoVecino(row.id, {});
    }

    return obtenerTableroLiquidacionCobros();
}

/**
 * Ejecuta la Liquidación Final del Lote/Canasto y registra la compensación automática
 * en la Cuenta Corriente del Nodo (dejando el lote saldado en $0).
 */
async function cerrarLiquidacionCanasto(canastoId, payload = {}) {
    await asegurarEsquemaNodosBarriales();

    // Asegurar primero que todos los cobros del lote estén conciliados
    await conciliarTodosLosPagosPendientesCanasto(canastoId);

    // Si el canasto aún no tenía registrado su retiro/débito base de Etapa 3, registrarlo primero
    const checkCan = await db.query('SELECT * FROM public.nodos_lotes_estacion WHERE id = $1::int', [Number(canastoId)]);
    if (checkCan.rows.length === 0) {
        throw new Error('Canasto no encontrado.');
    }
    if (!checkCan.rows[0].debito_cta_cte_registrado) {
        await confirmarRetiroCanastoPorGestor(canastoId, { retirado_por: payload.responsable || 'Gestor del Nodo' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const canRes = await client.query(
            `SELECT nle.*,
                    nm.nombre_marca, nm.gestor_nombre, nm.codigo_bunker_cliente
             FROM public.nodos_lotes_estacion nle
             JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
             WHERE nle.id = $1::int
             FOR UPDATE OF nle`,
            [Number(canastoId)]
        );
        const canasto = canRes.rows[0];
        if (canasto.liquidacion_cerrada) {
            throw new Error(`La liquidación del canasto ${canasto.codigo_canasto} ya se encuentra cerrada y saldada.`);
        }

        const pedsRes = await client.query(
            'SELECT * FROM public.nodos_pedidos_vecinos WHERE lote_canasto_id = $1::int ORDER BY id ASC',
            [canasto.id]
        );
        const cuadro = calcularCuadroLiquidacionCanasto(canasto, pedsRes.rows);

        let saldoResultante = 0;
        let movCcFacturaId = null;

        if (canasto.codigo_bunker_cliente) {
            const ccRes = await client.query(
                `SELECT id, saldo FROM public.factura_cuentas_corrientes
                 WHERE codigo_bunker_cliente = $1
                 LIMIT 1
                 FOR UPDATE`,
                [canasto.codigo_bunker_cliente]
            );
            if (ccRes.rows.length > 0) {
                const ccId = ccRes.rows[0].id;
                const saldoActual = Number(ccRes.rows[0].saldo || 0);

                if (cuadro.direccion_compensacion === 'GESTOR_RINDE_A_LAMDA' && cuadro.monto_compensacion_final > 0) {
                    // El Gestor rinde a LAMDA el excedente de efectivo -> Crédito que cancela el saldo deudor en Cta. Cte.
                    saldoResultante = Number((saldoActual + cuadro.monto_compensacion_final).toFixed(2));
                    await client.query(
                        'UPDATE public.factura_cuentas_corrientes SET saldo = $1, actualizada_en = NOW() WHERE id = $2',
                        [saldoResultante, ccId]
                    );
                    const insMov = await client.query(
                        `INSERT INTO public.factura_cuenta_corriente_movimientos (
                            cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                            tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                            creado_en, metadatos
                         ) VALUES ($1, 'CREDITO', $2, $3, 'LIQUIDACION_LOTE_NODO', NULL, $4, NOW(), NOW(), $5)
                         RETURNING id`,
                        [
                            ccId,
                            cuadro.monto_compensacion_final,
                            saldoResultante,
                            `Liquidación y Rendición Lote ${canasto.codigo_canasto} (${canasto.gestor_nombre} retuvo ganancia de $${cuadro.ganancia_neta_gestor.toLocaleString('es-AR')} y rindió saldo neto a LAMDA)`,
                            JSON.stringify(cuadro)
                        ]
                    );
                    movCcFacturaId = insMov.rows[0].id;
                } else if (cuadro.direccion_compensacion === 'LAMDA_TRANSFIERE_A_GESTOR' && cuadro.monto_compensacion_final > 0) {
                    saldoResultante = Number((saldoActual - cuadro.monto_compensacion_final).toFixed(2));
                    await client.query(
                        'UPDATE public.factura_cuentas_corrientes SET saldo = $1, actualizada_en = NOW() WHERE id = $2',
                        [saldoResultante, ccId]
                    );
                    const insMov = await client.query(
                        `INSERT INTO public.factura_cuenta_corriente_movimientos (
                            cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                            tipo_comprobante, comprobante_id, descripcion, fecha_movimiento,
                            creado_en, metadatos
                         ) VALUES ($1, 'DEBITO', $2, $3, 'LIQUIDACION_LOTE_NODO', NULL, $4, NOW(), NOW(), $5)
                         RETURNING id`,
                        [
                            ccId,
                            cuadro.monto_compensacion_final,
                            saldoResultante,
                            `Liquidación Lote ${canasto.codigo_canasto}: Transferencia de saldo de comisiones de LAMDA al Gestor`,
                            JSON.stringify(cuadro)
                        ]
                    );
                    movCcFacturaId = insMov.rows[0].id;
                } else {
                    saldoResultante = saldoActual;
                }
            }
        }

        const codigoLiq = `LIQ-${canasto.codigo_canasto}-${Date.now().toString().slice(-4)}`;
        const insLiq = await client.query(
            `INSERT INTO public.nodos_liquidaciones_lote (
                codigo_liquidacion, nodo_id, lote_canasto_id,
                total_venta_vecinos, total_base_lamda, ganancia_neta_gestor,
                total_transferencias_lamda, total_efectivo_mano_gestor,
                direccion_compensacion, monto_compensacion_final,
                saldo_cta_cte_post_cierre, movimiento_cc_id, observaciones
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING *`,
            [
                codigoLiq,
                canasto.nodo_id,
                canasto.id,
                cuadro.total_venta_vecinos,
                cuadro.total_base_lamda,
                cuadro.ganancia_neta_gestor,
                cuadro.transferencias_conciliadas_lamda,
                cuadro.efectivo_cobrado_mano_gestor,
                cuadro.direccion_compensacion,
                cuadro.monto_compensacion_final,
                saldoResultante,
                movCcFacturaId,
                payload.observaciones || cuadro.explicacion_compensacion
            ]
        );
        const liqRow = insLiq.rows[0];

        const signoMov = cuadro.direccion_compensacion === 'GESTOR_RINDE_A_LAMDA' ? 1 : -1;
        await client.query(
            `INSERT INTO public.nodos_movimientos_cta_cte (
                nodo_id, lote_canasto_id, tipo_movimiento, signo, monto,
                saldo_resultante, concepto, referencia_externa
             ) VALUES ($1, $2, 'LIQUIDACION_CIERRE_LOTE', $3, $4, $5, $6, $7)`,
            [
                canasto.nodo_id,
                canasto.id,
                signoMov,
                cuadro.monto_compensacion_final,
                saldoResultante,
                `Cierre de Liquidación ${codigoLiq} (${canasto.codigo_canasto}): Ganancia Gestor $${cuadro.ganancia_neta_gestor.toLocaleString('es-AR')} cubierta · ${cuadro.titulo_resultado} · Cta. Cte. Saldada`,
                codigoLiq
            ]
        );

        await client.query(
            `UPDATE public.nodos_lotes_estacion
             SET liquidacion_cerrada = true,
                 liquidacion_id = $1,
                 fecha_liquidacion = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
            [liqRow.id, canasto.id]
        );

        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_operativo = 'ENTREGADO_VECINO',
                 updated_at = NOW()
             WHERE lote_canasto_id = $1`,
            [canasto.id]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    return obtenerTableroLiquidacionCobros();
}

/**
 * Herramienta de Laboratorio: Reabre los cobros y la liquidación de un Canasto
 * dejando el lote nuevamente en estado "Entregado al Gestor" (saldo -$66.820) para repetir la prueba.
 */
async function reabrirLiquidacionCanastoPrueba(canastoId) {
    await asegurarEsquemaNodosBarriales();

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const canRes = await client.query(
            `SELECT nle.*, nm.codigo_bunker_cliente
             FROM public.nodos_lotes_estacion nle
             JOIN public.nodos_maestro nm ON nm.id = nle.nodo_id
             WHERE nle.id = $1::int
             FOR UPDATE OF nle`,
            [Number(canastoId)]
        );
        if (canRes.rows.length === 0) {
            throw new Error('Canasto no encontrado.');
        }
        const canasto = canRes.rows[0];

        // 1. Revertir liquidación final si estaba cerrada
        const liqRes = await client.query(
            'SELECT * FROM public.nodos_liquidaciones_lote WHERE lote_canasto_id = $1::int',
            [canasto.id]
        );
        for (const liq of liqRes.rows) {
            if (canasto.codigo_bunker_cliente && Number(liq.monto_compensacion_final) > 0) {
                const ajuste = liq.direccion_compensacion === 'GESTOR_RINDE_A_LAMDA'
                    ? -Number(liq.monto_compensacion_final)
                    : Number(liq.monto_compensacion_final);
                await client.query(
                    'UPDATE public.factura_cuentas_corrientes SET saldo = COALESCE(saldo, 0) + $1, actualizada_en = NOW() WHERE codigo_bunker_cliente = $2',
                    [ajuste, canasto.codigo_bunker_cliente]
                );
            }
            if (liq.movimiento_cc_id) {
                await client.query('DELETE FROM public.factura_cuenta_corriente_movimientos WHERE id = $1', [liq.movimiento_cc_id]);
            }
        }
        await client.query('DELETE FROM public.nodos_liquidaciones_lote WHERE lote_canasto_id = $1::int', [canasto.id]);

        // 2. Revertir créditos de transferencias de vecinos de este lote
        const pedsRes = await client.query(
            'SELECT * FROM public.nodos_pedidos_vecinos WHERE lote_canasto_id = $1::int',
            [canasto.id]
        );
        for (const p of pedsRes.rows) {
            if (p.impactado_cta_cte_pago && String(p.medio_pago).toUpperCase() === 'TRANSFERENCIA' && canasto.codigo_bunker_cliente) {
                await client.query(
                    'UPDATE public.factura_cuentas_corrientes SET saldo = COALESCE(saldo, 0) - $1, actualizada_en = NOW() WHERE codigo_bunker_cliente = $2',
                    [Number(p.total_vecino || 0), canasto.codigo_bunker_cliente]
                );
            }
            if (p.movimiento_pago_cc_id) {
                await client.query('DELETE FROM public.factura_cuenta_corriente_movimientos WHERE id = $1', [p.movimiento_pago_cc_id]);
            }
        }

        // 3. Limpiar movimientos de cobro/liquidación en nodos_movimientos_cta_cte (conservando DEBITO_RETIRO_LOTE)
        await client.query(
            `DELETE FROM public.nodos_movimientos_cta_cte
             WHERE lote_canasto_id = $1::int
               AND tipo_movimiento IN ('CREDITO_TRANSFERENCIA_VECINO', 'COBRO_EFECTIVO_MANO_GESTOR', 'LIQUIDACION_CIERRE_LOTE')`,
            [canasto.id]
        );

        // 4. Restaurar estado de pago de los pedidos del canasto
        await client.query(
            `UPDATE public.nodos_pedidos_vecinos
             SET estado_pago = CASE WHEN medio_pago = 'EFECTIVO' THEN 'COBRAR_EN_ENTREGA' ELSE 'PENDIENTE_TRANSFERENCIA' END,
                 estado_operativo = CASE WHEN $2::varchar = 'ENTREGADO_AL_GESTOR' THEN 'EN_PODER_GESTOR' ELSE estado_operativo END,
                 impactado_cta_cte_pago = false,
                 movimiento_pago_cc_id = NULL,
                 fecha_conciliacion_pago = NULL,
                 updated_at = NOW()
             WHERE lote_canasto_id = $1::int`,
            [canasto.id, canasto.estado_canasto]
        );

        await client.query(
            `UPDATE public.nodos_lotes_estacion
             SET liquidacion_cerrada = false,
                 liquidacion_id = NULL,
                 fecha_liquidacion = NULL,
                 updated_at = NOW()
             WHERE id = $1::int`,
            [canasto.id]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    return obtenerTableroLiquidacionCobros();
}

module.exports = {
    asegurarEsquemaNodosBarriales,
    calcularEstructuraCostosNodo,
    obtenerEstadoCompletoNodos,
    guardarNodoMaestro,
    crearPropuestaFraccion,
    cotizarYAprobarArticuloNodo,
    recalcularCascadaCatalogoNodos,
    actualizarOfertaGestor,
    calcularProximaEntregaNodo,
    obtenerDatosPortalNodo,
    actualizarConfiguracionGestorNodo,
    crearPedidoVecinoTienda,
    generarEtiquetaDePedidoExistente,
    sincronizarCanastosEstacionNodos,
    sincronizarNodosConCircuitoOperativoLamda,
    sincronizarCambioSecuenciaDesdeLamda,
    cambiarEtapaCircuitoLamdaCanasto,
    obtenerEstadoCircuitoOperativoLamda,
    obtenerTableroMesaArmadoDeposito,
    armarBolsaPedidoVecino,
    armarTodasBolsasDeCanasto,
    generarEtiquetaQrMaestroCanasto,
    confirmarRetiroCanastoPorGestor,
    reabrirCanastoParaPruebaLaboratorio,
    calcularCuadroLiquidacionCanasto,
    obtenerTableroLiquidacionCobros,
    conciliarPagoPedidoVecino,
    conciliarTodosLosPagosPendientesCanasto,
    cerrarLiquidacionCanasto,
    reabrirLiquidacionCanastoPrueba,
    convertirLogoAZplGfa,
    generarEtiquetaZplParNodo,
    generarPreviewVisualEtiquetaPar,
    generarPreviewVisualCanastoQrMaestro
};
