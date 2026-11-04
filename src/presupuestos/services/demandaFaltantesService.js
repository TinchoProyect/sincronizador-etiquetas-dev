/**
 * Servicio Centralizado de Demanda No Satisfecha (Faltantes y Stock Disponible)
 * Sistema LAMDA
 * 
 * Gestiona el ciclo de vida de los artículos marcados sin stock en presupuestos,
 * evaluando tanto el stock consolidado directo de la fracción como la disponibilidad
 * de insumos a granel / producciones de carros externos (UP / Matías).
 */

/**
 * Obtiene los artículos con demanda no satisfecha y calcula su disponibilidad en tiempo real
 * @param {object} pool - Pool de PostgreSQL
 * @param {object} [opciones] - Filtros opcionales { soloConStock, estado }
 */
async function obtenerDemandaFaltantes(pool, opciones = {}) {
    const { soloConStock = false, estado = 'Pendiente' } = opciones;

    const query = `
        WITH stock_directo AS (
            SELECT 
                COALESCE(src.articulo_numero, a.numero) as codigo_art,
                COALESCE(src.codigo_barras, a.codigo_barras) as codigo_barras,
                COALESCE(src.descripcion, a.nombre) as descripcion_art,
                COALESCE(src.stock_consolidado::numeric, 0) as stock_consolidado,
                src.pack_hijo_codigo
            FROM public.stock_real_consolidado src
            FULL OUTER JOIN public.articulos a ON a.numero = src.articulo_numero
        ),
        stock_granel AS (
            -- Mapeo de artículos a granel / insumos de producción externa / carros
            SELECT 
                ba.articulo_id as fraccion_codigo,
                ba.pack_hijo_codigo as granel_codigo,
                COALESCE(src_g.stock_consolidado::numeric, 0) as stock_granel_consolidado,
                COALESCE(i.stock_actual::numeric, 0) as stock_ingrediente_kg
            FROM public.bunker_articulos ba
            LEFT JOIN public.stock_real_consolidado src_g ON src_g.articulo_numero = ba.pack_hijo_codigo
            LEFT JOIN public.ingredientes i ON i.articulo_vinculado_numero = ba.pack_hijo_codigo
            WHERE ba.pack_hijo_codigo IS NOT NULL
        ),
        produccion_externa AS (
            -- Mapeo de producciones externas / carros de Matías (UP)
            SELECT 
                aper.articulo_produccion_codigo,
                aper.articulo_kilo_codigo,
                COALESCE(src_k.stock_consolidado::numeric, 0) as stock_up_consolidado
            FROM public.articulos_produccion_externa_relacion aper
            LEFT JOIN public.stock_real_consolidado src_k ON src_k.articulo_numero = aper.articulo_kilo_codigo
        )
        SELECT 
            s.id,
            s.id_presupuesto,
            s.articulo,
            COALESCE(s.descripcion, sd.descripcion_art, s.articulo) as descripcion,
            s.cantidad::numeric as cantidad,
            s.motivo_falta,
            s.fecha_registro,
            s.estado,
            s.fecha_resolucion,
            s.motivo_resolucion,
            s.origen_resolucion,
            p.id_presupuesto_ext,
            p.estado as pres_estado,
            p.secuencia as pres_secuencia,
            p.fecha as pres_fecha,
            c.cliente_id,
            COALESCE(bc.razon_social, NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''), NULLIF(TRIM(c.nombre), ''), c.otros, 'Cliente ' || p.id_cliente) as cliente_nombre,
            COALESCE(c.telefono, '') as telefono,
            COALESCE(c.celular, '') as celular,
            bc.id as bunker_cliente_id,
            bc.codigo_bunker_cliente,
            bc.whatsapp_facturas,
            bc.email_facturas,
            COALESCE(sd.stock_consolidado, 0) as stock_consolidado,
            COALESCE(sg.granel_codigo, pe.articulo_kilo_codigo, '') as granel_codigo,
            GREATEST(
                COALESCE(sg.stock_granel_consolidado, 0), 
                COALESCE(sg.stock_ingrediente_kg, 0),
                COALESCE(pe.stock_up_consolidado, 0)
            ) as stock_granel_disponible
        FROM public.presupuestos_articulos_sin_stock s
        JOIN public.presupuestos p ON s.id_presupuesto = p.id
        LEFT JOIN public.clientes c ON c.cliente_id = (CASE WHEN p.id_cliente ~ '^[0-9]+$' THEN p.id_cliente::integer ELSE NULL END)
        LEFT JOIN public.bunker_clientes bc ON (CASE WHEN bc.lomas_soft_id ~ '^[0-9]+$' THEN bc.lomas_soft_id::integer ELSE NULL END) = (CASE WHEN p.id_cliente ~ '^[0-9]+$' THEN p.id_cliente::integer ELSE NULL END)
        LEFT JOIN stock_directo sd ON (sd.codigo_art = s.articulo OR sd.codigo_barras = s.articulo)
        LEFT JOIN stock_granel sg ON (sg.fraccion_codigo = sd.codigo_art)
        LEFT JOIN produccion_externa pe ON (pe.articulo_kilo_codigo = sd.codigo_art OR pe.articulo_produccion_codigo = sd.codigo_art)
        WHERE ($1::text IS NULL OR s.estado = $1::text)
        ORDER BY s.fecha_registro DESC;
    `;

    const result = await pool.query(query, [estado]);

    // Enriquecer registros con tipo de disponibilidad e inteligencia de producto
    const items = result.rows.map(row => {
        const cantFaltante = parseFloat(row.cantidad) || 0;
        const stockDirecto = parseFloat(row.stock_consolidado) || 0;
        const stockGranel = parseFloat(row.stock_granel_disponible) || 0;

        let disponibilidad = 'SIN_STOCK';
        let disponibilidad_texto = 'Sin stock disponible';
        let tieneStockSuficiente = false;

        if (stockDirecto > 0) {
            disponibilidad = 'STOCK_DIRECTO';
            disponibilidad_texto = `Stock listo: ${stockDirecto} un.`;
            tieneStockSuficiente = stockDirecto >= cantFaltante;
        } else if (stockGranel > 0) {
            disponibilidad = 'GRANEL_DISPONIBLE';
            disponibilidad_texto = `Granel disponible para preparar: ${stockGranel.toFixed(1)} kg`;
            tieneStockSuficiente = true;
        }

        // Parsear contactos de WhatsApp
        let contactosWp = [];
        if (row.whatsapp_facturas && row.whatsapp_facturas.trim().startsWith('[')) {
            try {
                contactosWp = JSON.parse(row.whatsapp_facturas);
            } catch(e) {}
        }
        if (!Array.isArray(contactosWp) || contactosWp.length === 0) {
            const fallbackTel = (row.celular || row.telefono || '').replace(/\D/g, '');
            if (fallbackTel) {
                contactosWp = [{
                    numero: fallbackTel,
                    nombre: row.cliente_nombre || 'Contacto Principal',
                    cargo: 'Principal',
                    default: true,
                    default_presupuesto: true
                }];
            }
        }

        // Parsear contactos de Email
        let contactosEmail = [];
        if (row.email_facturas && row.email_facturas.trim().startsWith('[')) {
            try {
                contactosEmail = JSON.parse(row.email_facturas);
            } catch(e) {}
        }
        if (Array.isArray(contactosEmail)) {
            contactosEmail = contactosEmail.filter(e => e && e.email && typeof e.email === 'string' && e.email.includes('@') && e.email !== '[]');
        }

        // WhatsApp link limpio si tiene número válido (fallback)
        const primerTel = (contactosWp[0] && contactosWp[0].numero ? contactosWp[0].numero : (row.celular || row.telefono || '')).replace(/\D/g, '');
        let whatsappUrl = null;
        if (primerTel.length >= 8) {
            let phoneArg = primerTel;
            if (phoneArg.length === 10) phoneArg = '549' + phoneArg;
            else if (!phoneArg.startsWith('54')) phoneArg = '54' + phoneArg;
            const msj = encodeURIComponent(`Hola ${row.cliente_nombre}, te contactamos de LAMDA para avisarte que ya ingresó stock de ${row.descripcion} que habías solicitado.`);
            whatsappUrl = `https://wa.me/${phoneArg}?text=${msj}`;
        }

        return {
            id: row.id,
            id_presupuesto: row.id_presupuesto,
            id_presupuesto_ext: row.id_presupuesto_ext,
            articulo: row.articulo,
            descripcion: row.descripcion,
            cantidad: cantFaltante,
            motivo_falta: row.motivo_falta || 'Sin Stock en mostrador',
            fecha_registro: row.fecha_registro,
            estado: row.estado || 'Pendiente',
            fecha_resolucion: row.fecha_resolucion,
            motivo_resolucion: row.motivo_resolucion,
            cliente_id: row.cliente_id,
            cliente_nombre: row.cliente_nombre,
            telefono: row.telefono,
            celular: row.celular,
            bunker_cliente_id: row.bunker_cliente_id,
            codigo_bunker_cliente: row.codigo_bunker_cliente,
            whatsapp_facturas: row.whatsapp_facturas,
            email_facturas: row.email_facturas,
            contactos_whatsapp: contactosWp,
            contactos_email: contactosEmail,
            whatsapp_url: whatsappUrl,
            stock_consolidado: stockDirecto,
            stock_granel_disponible: stockGranel,
            granel_codigo: row.granel_codigo,
            disponibilidad,
            disponibilidad_texto,
            tiene_stock: stockDirecto > 0 || stockGranel > 0,
            tiene_stock_suficiente: tieneStockSuficiente
        };
    });

    if (soloConStock) {
        return items.filter(it => it.tiene_stock);
    }

    return items;
}

/**
 * Actualiza el estado de una demanda de faltante (Cubierto, Desestimado, Pendiente)
 */
async function cambiarEstadoFaltante(pool, params) {
    const { id, nuevoEstado, motivo = null, origen = 'manual' } = params;

    if (!id || !nuevoEstado) {
        throw new Error('ID y nuevoEstado son requeridos');
    }

    const query = `
        UPDATE public.presupuestos_articulos_sin_stock
        SET estado = $1::varchar,
            fecha_resolucion = CASE WHEN $1::varchar = 'Pendiente' THEN NULL ELSE NOW() END,
            motivo_resolucion = $2::text,
            origen_resolucion = $3::varchar
        WHERE id = $4::integer
        RETURNING *;
    `;

    const result = await pool.query(query, [nuevoEstado, motivo, origen, id]);
    if (result.rowCount === 0) {
        throw new Error(`No se encontró el registro de demanda faltante #${id}`);
    }

    return result.rows[0];
}

module.exports = {
    obtenerDemandaFaltantes,
    cambiarEstadoFaltante
};
