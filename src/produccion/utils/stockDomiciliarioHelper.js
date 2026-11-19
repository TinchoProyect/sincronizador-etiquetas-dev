const { expandirIngrediente } = require('./ingredientes/expandirIngredientes');

/**
 * Calcula los ingredientes base (receta padre de la UP) requeridos por un carro externo,
 * usando el cliente o pool provisto para respetar transacciones activas.
 *
 * @param {Object} db - Pool o cliente PostgreSQL transaccional
 * @param {number} carroId - ID del carro
 * @returns {Promise<Array<{id:number, nombre:string, unidad_medida:string, cantidad:number, origen_mix_id:number|null, es_insumo:boolean, articulos_origen:string[]}>>}
 */
async function obtenerIngredientesRecetaPadreCarroExterno(db, carroId) {
    const { rows: articulosRows } = await db.query(
        `SELECT ca.articulo_numero,
                CAST(ca.cantidad AS numeric) AS cantidad_carro,
                COALESCE(NULLIF(BTRIM(ba.descripcion_generada), ''), NULLIF(BTRIM(ba.descripcion), ''), a.nombre, ca.articulo_numero) AS articulo_nombre
           FROM public.carros_articulos ca
           LEFT JOIN public.articulos a ON a.numero = ca.articulo_numero
           LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ca.articulo_numero
          WHERE ca.carro_id = $1
          ORDER BY ca.id ASC`,
        [carroId]
    );

    if (!articulosRows || articulosRows.length === 0) {
        return [];
    }

    const acumulador = new Map();

    const acumularItem = (ingId, meta) => {
        if (!ingId) return;
        const idNum = Number(ingId);
        const clave = `${idNum}:${meta.origen_mix_id || 'null'}`;
        if (!acumulador.has(clave)) {
            acumulador.set(clave, {
                id: idNum,
                nombre: meta.nombre || `Ingrediente #${idNum}`,
                unidad_medida: meta.unidad_medida || 'Kilo',
                cantidad: 0,
                origen_mix_id: meta.origen_mix_id || null,
                es_insumo: Boolean(meta.es_insumo),
                articulos_origen: []
            });
        }
        const item = acumulador.get(clave);
        item.cantidad = Number((item.cantidad + Number(meta.cantidad || 0)).toFixed(4));
        if (meta.articulo_etiqueta && !item.articulos_origen.includes(meta.articulo_etiqueta)) {
            item.articulos_origen.push(meta.articulo_etiqueta);
        }
    };

    for (const art of articulosRows) {
        const cantCarro = parseFloat(art.cantidad_carro) || 0;
        if (cantCarro <= 0) continue;

        const { rows: recetaRows } = await db.query(
            `SELECT ri.ingrediente_id,
                    CAST(ri.cantidad AS numeric) AS cantidad_receta,
                    COALESCE(i.nombre, ri.nombre_ingrediente) AS nombre_ingrediente,
                    COALESCE(i.unidad_medida, 'Kilo') AS unidad_medida,
                    COALESCE(i.es_insumo, false) AS es_insumo,
                    EXISTS (
                        SELECT 1 FROM public.ingrediente_composicion ic WHERE ic.mix_id = ri.ingrediente_id
                    ) AS es_mix
               FROM public.recetas r
               JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
               LEFT JOIN public.ingredientes i ON i.id = ri.ingrediente_id
              WHERE r.articulo_numero = $1`,
            [art.articulo_numero]
        );

        const etiquetaArt = `[${art.articulo_numero}] ${art.articulo_nombre} × ${Number(cantCarro.toFixed(2))}`;

        for (const ing of recetaRows) {
            const cantTotal = Number(((parseFloat(ing.cantidad_receta) || 0) * cantCarro).toFixed(4));
            if (cantTotal <= 0) continue;

            let ingId = ing.ingrediente_id ? parseInt(ing.ingrediente_id, 10) : null;
            if (!ingId && ing.nombre_ingrediente) {
                const { rows: fb } = await db.query(
                    'SELECT id FROM public.ingredientes WHERE LOWER(nombre) = LOWER($1) LIMIT 1',
                    [ing.nombre_ingrediente]
                );
                ingId = fb[0]?.id || null;
            }
            if (!ingId) continue;

            if (ing.es_mix) {
                const expandidos = await expandirIngrediente(ingId, cantTotal, new Set(), ingId);
                for (const exp of expandidos) {
                    acumularItem(exp.id, {
                        nombre: exp.nombre,
                        unidad_medida: exp.unidad_medida || 'Kilo',
                        cantidad: exp.cantidad,
                        origen_mix_id: exp.origen_mix_id || ingId,
                        es_insumo: Boolean(exp.es_insumo),
                        articulo_etiqueta: etiquetaArt
                    });
                }
            } else {
                acumularItem(ingId, {
                    nombre: ing.nombre_ingrediente,
                    unidad_medida: ing.unidad_medida,
                    cantidad: cantTotal,
                    origen_mix_id: null,
                    es_insumo: Boolean(ing.es_insumo),
                    articulo_etiqueta: etiquetaArt
                });
            }
        }
    }

    return Array.from(acumulador.values());
}

/**
 * Calcula los kilos comprometidos por ingrediente domiciliario en todos los carros externos
 * preparados y aún no confirmados (`fecha_preparado IS NOT NULL AND fecha_confirmacion IS NULL`)
 * de un colaborador, omitiendo cualquier carro cuyo consumo ya hubiese sido descontado en
 * `ingredientes_stock_usuarios` (protección anti-doble conteo para registros legacy).
 *
 * @param {Object} db - Pool o cliente PostgreSQL
 * @param {number} usuarioId - ID del colaborador
 * @param {Object} [opts]
 * @param {number|null} [opts.excluirCarroId] - Excluir un carro puntual (ej. el carro activo en vista)
 * @returns {Promise<Map<number, {ingrediente_id:number, kilos_comprometidos:number, carros_count:number, carros_detalle:Array}>>}
 */
async function obtenerCompromisosCarrosExternos(db, usuarioId, { excluirCarroId = null } = {}) {
    const mapa = new Map();
    if (!usuarioId) return mapa;

    const params = [parseInt(usuarioId, 10)];
    let filtroExcluir = '';
    if (excluirCarroId !== null && excluirCarroId !== undefined && !isNaN(parseInt(excluirCarroId, 10))) {
        params.push(parseInt(excluirCarroId, 10));
        filtroExcluir = ` AND cp.id <> $${params.length}`;
    }

    const { rows: carrosAbiertos } = await db.query(
        `SELECT cp.id,
                cp.fecha_preparado,
                cp.en_auditoria
           FROM public.carros_produccion cp
          WHERE cp.usuario_id = $1
            AND cp.tipo_carro = 'externa'
            AND cp.fecha_preparado IS NOT NULL
            AND cp.fecha_confirmacion IS NULL
            ${filtroExcluir}
          ORDER BY cp.fecha_preparado ASC, cp.id ASC`,
        params
    );

    if (!carrosAbiertos || carrosAbiertos.length === 0) {
        return mapa;
    }

    const carroIds = carrosAbiertos.map(c => c.id);
    const { rows: yaDescontadosRows } = await db.query(
        `SELECT DISTINCT origen_carro_id, ingrediente_id
           FROM public.ingredientes_stock_usuarios
          WHERE origen_carro_id = ANY($1::int[])
            AND cantidad < 0`,
        [carroIds]
    );
    const yaDescontadosSet = new Set(
        yaDescontadosRows.map(r => `${r.origen_carro_id}:${r.ingrediente_id}`)
    );

    for (const carro of carrosAbiertos) {
        const itemsReceta = await obtenerIngredientesRecetaPadreCarroExterno(db, carro.id);

        // Consolidar por ingrediente_id dentro del mismo carro
        const porIngEnCarro = new Map();
        for (const it of itemsReceta) {
            if (it.es_insumo) continue;
            if (yaDescontadosSet.has(`${carro.id}:${it.id}`)) continue;

            if (!porIngEnCarro.has(it.id)) {
                porIngEnCarro.set(it.id, {
                    id: it.id,
                    nombre: it.nombre,
                    unidad_medida: it.unidad_medida,
                    cantidad: 0,
                    articulos_origen: []
                });
            }
            const acc = porIngEnCarro.get(it.id);
            acc.cantidad = Number((acc.cantidad + Number(it.cantidad || 0)).toFixed(4));
            for (const et of (it.articulos_origen || [])) {
                if (!acc.articulos_origen.includes(et)) acc.articulos_origen.push(et);
            }
        }

        for (const [ingId, datosCarro] of porIngEnCarro.entries()) {
            if (datosCarro.cantidad <= 0) continue;
            if (!mapa.has(ingId)) {
                mapa.set(ingId, {
                    ingrediente_id: ingId,
                    kilos_comprometidos: 0,
                    carros_count: 0,
                    carros_detalle: []
                });
            }
            const entry = mapa.get(ingId);
            entry.kilos_comprometidos = Number((entry.kilos_comprometidos + datosCarro.cantidad).toFixed(4));
            entry.carros_count += 1;
            entry.carros_detalle.push({
                carro_id: carro.id,
                fecha_preparado: carro.fecha_preparado,
                cantidad_requerida: datosCarro.cantidad,
                unidad_medida: datosCarro.unidad_medida,
                articulos_resumen: datosCarro.articulos_origen.join(' + ')
            });
        }
    }

    return mapa;
}

module.exports = {
    obtenerIngredientesRecetaPadreCarroExterno,
    obtenerCompromisosCarrosExternos
};
