const pool = require('../../usuarios/pool');
const db = require('../config/database');
const { expandirIngrediente } = require('../utils/ingredientes/expandirIngredientes');
const { consolidarIngredientes } = require('../utils/ingredientes/consolidarIngredientes');
const { validarPropiedadCarro } = require('./carro');

/**
 * Extrae la letra del sector desde la descripción o nombre.
 */
function extraerLetraSector(descripcion, nombre) {
    let texto = (descripcion || nombre || '').replace(/["']/g, '');
    if (!texto) return null;

    let letraPura = null;

    // 1. Buscar explícitamente el patrón "Sector X" con un espacio (capturando sólo la letra/número)
    const matchSector = texto.match(/Sector\s+([A-Z0-9])/i);
    if (matchSector) {
        letraPura = matchSector[1].toUpperCase();
    } else {
        // 2. Buscar si el texto ES exactamente 1 o 2 letras/números (ej "A", "B1")
        const textoLimpio = texto.trim();
        if (textoLimpio.length > 0 && textoLimpio.length <= 2) {
            letraPura = textoLimpio.toUpperCase();
        } else {
            // 3. Fallback: buscar una letra/número suelto en el texto
            const matchLetraSuelta = textoLimpio.match(/(?:^|\s)([A-Z0-9])(?:\s|$)/i);
            if (matchLetraSuelta) {
                letraPura = matchLetraSuelta[1].toUpperCase();
            }
        }
    }

    // Si encontramos la letra y existe un nombre descriptivo, los concatenamos
    if (letraPura) {
        const nombreDescriptivo = nombre || '';
        if (nombreDescriptivo && nombreDescriptivo.toUpperCase() !== letraPura) {
            return `${letraPura} - ${nombreDescriptivo}`;
        }
        return letraPura;
    }

    // 4. Si falla, devolver nulo para usar el nombre directamente
    return null;
}

/**
 * Helper para verificar si un carro ya está preparado
 */
async function esCarroPreparado(carroId) {
    try {
        const query = 'SELECT fecha_preparado FROM carros_produccion WHERE id = $1';
        const result = await pool.query(query, [carroId]);
        return !!result.rows[0]?.fecha_preparado;
    } catch (error) {
        console.error('Error verificando estado de carro:', error);
        return false;
    }
}

/**
 * Obtiene los ingredientes históricamente descontados para un carro preparado
 */
async function obtenerIngredientesHistoricos(carroId, tipoCarro) {
    console.log(`\n📜 RECUPERANDO HISTORIAL DE INGREDIENTES (Carro ${carroId}, ${tipoCarro})`);

    let query;
    if (tipoCarro === 'interna') {
        // Para interna, mirar ingredientes_movimientos
        query = `
            SELECT 
                im.ingrediente_id as id, 
                i.nombre, 
                i.unidad_medida,
                i.stock_actual as current_system_stock, -- Stock REAL actual en sistema
                (SELECT descripcion FROM sectores_ingredientes WHERE id = i.sector_id LIMIT 1) as sector_descripcion,
                (SELECT nombre FROM sectores_ingredientes WHERE id = i.sector_id LIMIT 1) as sector_nombre,
                i.sector_id,
                SUM(ABS(im.kilos)) as cantidad,
                MAX(im.stock_anterior) as stock_snapshot
            FROM ingredientes_movimientos im
            JOIN ingredientes i ON im.ingrediente_id = i.id
            WHERE im.carro_id = $1 AND im.kilos < 0
            GROUP BY im.ingrediente_id, i.nombre, i.unidad_medida, i.stock_actual, i.sector_id
        `;
    } else {
        // Para externa, mirar mezcla de stock_usuarios y movimientos (fallback)
        query = `
        SELECT
        sub.id,
            i.nombre,
            i.unidad_medida,
            i.stock_actual as current_system_stock, --Stock REAL actual en sistema
            (SELECT descripcion FROM sectores_ingredientes WHERE id = i.sector_id LIMIT 1) as sector_descripcion,
            (SELECT nombre FROM sectores_ingredientes WHERE id = i.sector_id LIMIT 1) as sector_nombre,
            i.sector_id,
        SUM(sub.cantidad) as cantidad,
            MAX(sub.stock_anterior) as stock_snapshot,
            sub.origen_mix_id
        FROM(
            SELECT ingrediente_id as id, ABS(cantidad) as cantidad, origen_mix_id, NULL:: numeric as stock_anterior
                FROM ingredientes_stock_usuarios 
                WHERE origen_carro_id = $1 AND cantidad < 0
                UNION ALL
                SELECT ingrediente_id as id, ABS(kilos) as cantidad, NULL as origen_mix_id, stock_anterior
                FROM ingredientes_movimientos 
                WHERE carro_id = $1 AND kilos < 0 AND tipo = 'egreso'
        ) sub
            JOIN ingredientes i ON sub.id = i.id
            GROUP BY sub.id, i.nombre, i.unidad_medida, i.stock_actual, sub.origen_mix_id, i.sector_id
            `;
    }

    const result = await pool.query(query, [carroId]);

    // Retornar con lógica de fallback robusta para Stock Anterior
    return result.rows.map(row => {
        const cantidad = Number(parseFloat(row.cantidad).toPrecision(10));
        let stockAnterior;

        if (row.stock_snapshot != null) {
            // OPCIÓN 1: Tenemos el snapshot exacto (Ideal para nuevos carros)
            stockAnterior = Number(row.stock_snapshot);
        } else {
            // OPCIÓN 2: Fallback Matematico (Ideal para carros viejos)
            // Stock Anterior = Stock Actual Real + Lo que consumimos
            const currentStock = Number(row.current_system_stock || 0);
            stockAnterior = currentStock + cantidad;
        }

        const sectorLetra = extraerLetraSector(row.sector_descripcion, row.sector_nombre) || row.sector_nombre || row.sector_descripcion || null;

        return {
            ...row,
            cantidad: cantidad,
            stock_actual: stockAnterior, // Mantener compatibilidad (Snapshot)
            stock_snapshot: stockAnterior, // Explicito para evitar dudas
            stock_live: Number(row.current_system_stock || 0), // Stock real actual del sistema
            sector_letra: sectorLetra
        };
    });
}

/**
 * Verifica si un ingrediente es un mix consultando la tabla ingrediente_composicion
 * @param {number} ingredienteId - ID del ingrediente a verificar
 * @returns {Promise<boolean>} true si es mix, false si es ingrediente simple
 */
async function verificarSiEsMix(ingredienteId) {
    try {
        const query = `
            SELECT COUNT(*):: integer as count 
            FROM ingrediente_composicion 
            WHERE mix_id = $1
            `;
        const result = await pool.query(query, [ingredienteId]);
        return result.rows[0].count > 0;
    } catch (error) {
        console.error(`Error verificando si ingrediente ${ingredienteId} es mix: `, error);
        return false;
    }
}


/**
 * Busca un ingrediente por nombre y retorna su ID
 * @param {string} nombre - Nombre del ingrediente a buscar
 * @returns {Promise<number|null>} ID del ingrediente o null si no se encuentra
 */
async function buscarIngredientePorNombre(nombre) {
    try {
        const query = `
            SELECT id 
            FROM ingredientes 
            WHERE LOWER(nombre) = LOWER($1)
            `;
        const result = await pool.query(query, [nombre]);
        return result.rows[0]?.id || null;
    } catch (error) {
        console.error(`Error buscando ingrediente por nombre ${nombre}: `, error);
        return null;
    }
}

/**
 * Obtiene todos los artículos de recetas necesarios para un carro
 * @param {number} carroId - ID del carro
 * @param {number} usuarioId - ID del usuario que solicita los artículos
 * @returns {Promise<Array>} Lista de artículos consolidados
 */
async function obtenerArticulosDeRecetas(carroId, usuarioId) {
    try {
        console.log(`\n🚚 INICIANDO ANÁLISIS DE ARTÍCULOS DE RECETAS DEL CARRO ${carroId} `);
        console.log(`=============================================== `);

        // Validar que el carro pertenece al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // 1. Obtener artículos del carro
        const queryArticulos = `
        SELECT
        ca.articulo_numero,
            ca.cantidad
            FROM carros_articulos ca
            WHERE ca.carro_id = $1
            `;
        const articulosResult = await pool.query(queryArticulos, [carroId]);
        console.log(`📦 ARTÍCULOS EN EL CARRO: ${articulosResult.rows.length} `);

        // 2. Por cada artículo, obtener sus artículos de receta
        let todosLosArticulos = [];
        for (const articulo of articulosResult.rows) {
            console.log(`\n🔍 PROCESANDO ARTÍCULO: ${articulo.articulo_numero} `);
            console.log(`Cantidad solicitada: ${articulo.cantidad} `);

            // Obtener artículos de la receta del artículo
            const queryRecetaArticulos = `
        SELECT
        ra.articulo_numero,
            CAST(ra.cantidad AS DECIMAL(20, 10)) as cantidad,
            a.nombre as descripcion,
            a.codigo_barras
                FROM recetas r
                JOIN receta_articulos ra ON r.id = ra.receta_id
                LEFT JOIN articulos a ON a.numero = ra.articulo_numero
                WHERE r.articulo_numero = $1
            `;
            const recetaResult = await pool.query(queryRecetaArticulos, [articulo.articulo_numero]);
            console.log("🔎 recetaArticulos para", articulo.articulo_numero, recetaResult.rows);

            // Por cada artículo en la receta
            for (const art of recetaResult.rows) {
                // Mantener alta precisión en el cálculo de cantidad total
                const cantidadTotal = Number((art.cantidad * articulo.cantidad).toPrecision(10));

                console.log(`\n🔍 ANÁLISIS DE CANTIDADES - ${articulo.articulo_numero} `);
                console.log(`===================================================== `);
                console.log(`1️⃣ DATOS DE ENTRADA: `);
                console.log(`- Cantidad en receta: ${art.cantidad} unidades`);
                console.log(`- Unidades pedidas: ${articulo.cantidad} `);
                console.log(`2️⃣ CÁLCULO: `);
                console.log(`${art.cantidad} × ${articulo.cantidad} = ${cantidadTotal} unidades`);
                console.log(`=====================================================\n`);

                todosLosArticulos.push({
                    articulo_numero: art.articulo_numero,
                    descripcion: art.descripcion || art.articulo_numero,
                    cantidad: cantidadTotal,
                    codigo_barras: art.codigo_barras || ''
                });
            }
        }

        // 3. Consolidar todos los artículos por articulo_numero
        const articulosConsolidados = consolidarArticulos(todosLosArticulos);

        console.log(`\n✅ ARTÍCULOS DE RECETAS CONSOLIDADOS: ${articulosConsolidados.length} `);
        if (articulosConsolidados.length > 0) {
            articulosConsolidados.forEach((art, index) => {
                console.log(`  ${index + 1}. ${art.articulo_numero}: ${art.cantidad} unidades`);
            });
        } else {
            console.log(`⚠️ No se encontraron artículos en las recetas del carro ${carroId} `);
        }

        console.log(`===============================================\n`);

        return articulosConsolidados;

    } catch (error) {
        console.error('Error al obtener artículos de recetas del carro:', error);
        throw new Error('No se pudieron obtener los artículos de las recetas del carro');
    }
}

/**
 * Consolida una lista de artículos sumando cantidades de artículos con el mismo número
 * @param {Array} articulos - Lista de artículos a consolidar
 * @returns {Array} Lista de artículos consolidados
 */
function consolidarArticulos(articulos) {
    console.log(`\n📊 INICIANDO CONSOLIDACIÓN DE ARTÍCULOS`);
    console.log(`========================================= `);
    console.log(`Total artículos a consolidar: ${articulos.length} `);

    const consolidados = {};

    articulos.forEach((art, index) => {
        // Validar estructura del artículo
        if (!art.articulo_numero || typeof art.cantidad !== 'number') {
            console.error(`❌ Artículo #${index + 1} inválido: `, art);
            return;
        }

        const key = art.articulo_numero;

        console.log(`\n🔍 Procesando artículo #${index + 1}: `);
        console.log(`- Número: "${art.articulo_numero}"`);
        console.log(`- Descripción: "${art.descripcion}"`);
        console.log(`- Cantidad: ${art.cantidad} `);

        if (consolidados[key]) {
            const anterior = consolidados[key].cantidad;
            // Mantener alta precisión en las sumas
            consolidados[key].cantidad = Number((consolidados[key].cantidad + art.cantidad).toPrecision(10));
            console.log(`➕ SUMANDO cantidades para ${key}: `);
            console.log(`   ${anterior} + ${art.cantidad} = ${consolidados[key].cantidad} `);
        } else {
            console.log(`🆕 NUEVO ARTÍCULO(${key})`);
            // Asegurar que la cantidad inicial tenga alta precisión
            consolidados[key] = {
                articulo_numero: art.articulo_numero,
                descripcion: art.descripcion,
                cantidad: Number(art.cantidad.toPrecision(10)),
                codigo_barras: art.codigo_barras || ''
            };
        }
    });

    console.log(`\n✅ CONSOLIDACIÓN COMPLETADA`);
    console.log(`- Artículos únicos: ${Object.keys(consolidados).length} `);

    const resultado = Object.values(consolidados)
        .sort((a, b) => a.articulo_numero.localeCompare(b.articulo_numero));

    console.log(`✅ Consolidación completada.${resultado.length} artículos únicos: `, resultado);
    return resultado;
}

/**
 * Obtiene todos los ingredientes base necesarios para un carro,
 * expandiendo mixes y consolidando cantidades
 * @param {number} carroId - ID del carro
 * @param {number} usuarioId - ID del usuario que solicita los ingredientes
 * @returns {Promise<Array>} Lista de ingredientes base consolidados
 */
async function obtenerIngredientesBaseCarro(carroId, usuarioId) {
    try {
        console.log(`\n🚀 INICIANDO ANÁLISIS DE CARRO ${carroId} `);
        console.log(`=============================================== `);

        // Validar que el carro pertenece al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // 🛑 VERIFICACIÓN DE ESTADO: Si el carro está preparado, devolver HISTÓRICO
        const estaPreparado = await esCarroPreparado(carroId);
        if (estaPreparado) {
            // Necesitamos saber el tipo de carro
            const queryTipoCarro = 'SELECT tipo_carro FROM carros_produccion WHERE id = $1';
            const tipoCarroResult = await pool.query(queryTipoCarro, [carroId]);
            const tipoCarro = tipoCarroResult.rows[0]?.tipo_carro || 'interna';

            console.log(`❄️ CARRO PREPARADO DETECTADO: Usando datos congelados`);
            const ingredientesHistoricos = await obtenerIngredientesHistoricos(carroId, tipoCarro);

            if (tipoCarro === 'externa') {
                console.log(`🚚 CARRO EXTERNO PREPARADO: Fusionando ingredientes históricos (base) con vinculados (receta)`);
                // Para carros externos, los ingredientes vinculados (deferred) no están en el historial hasta 'Asentar Producción'
                // Por lo tanto, debemos obtenerlos de la receta para que no desaparezcan de la vista
                const ingredientesVinculados = await obtenerIngredientesArticulosVinculados(carroId, usuarioId);

                // Filtrar vinculados que ya estén en históricos (para evitar duplicados si ya se asentaron)
                const idsHistoricos = new Set(ingredientesHistoricos.map(i => i.id));
                const vinculadosFaltantes = ingredientesVinculados.filter(i => {
                    // Si no tiene ID o su ID no está en históricos, lo agregamos
                    return !i.id || !idsHistoricos.has(i.id);
                });

                console.log(`🔗 Fusionando: ${ingredientesHistoricos.length} históricos + ${vinculadosFaltantes.length} vinculados faltantes`);
                return [...ingredientesHistoricos, ...vinculadosFaltantes];
            }

            return ingredientesHistoricos;
        }

        // 1. Obtener artículos del carro
        const queryArticulos = `
        SELECT
        ca.articulo_numero,
            ca.cantidad
            FROM carros_articulos ca
            WHERE ca.carro_id = $1
            `;
        const articulosResult = await pool.query(queryArticulos, [carroId]);
        console.log(`📦 ARTÍCULOS EN EL CARRO: ${articulosResult.rows.length} `);
        articulosResult.rows.forEach((art, index) => {
            console.log(`  ${index + 1}. ${art.articulo_numero} - Cantidad: ${art.cantidad} `);
        });

        // 2. Por cada artículo, obtener sus ingredientes
        let todosLosIngredientes = [];
        for (const articulo of articulosResult.rows) {
            console.log(`\n🔍 PROCESANDO ARTÍCULO: ${articulo.articulo_numero} `);
            console.log(`Cantidad solicitada: ${articulo.cantidad} `);
            // Obtener la receta del artículo
            const queryReceta = `
        SELECT
        ri.ingrediente_id,
            CAST(ri.cantidad AS DECIMAL(20, 10)) as cantidad,
            COALESCE(i.nombre, ri.nombre_ingrediente) as nombre_ingrediente,
            COALESCE(i.unidad_medida, 'Kilo') as unidad_medida,
            i.sector_id,
            (SELECT descripcion FROM sectores_ingredientes WHERE id = i.sector_id LIMIT 1) as sector_descripcion,
            (SELECT nombre FROM sectores_ingredientes WHERE id = i.sector_id LIMIT 1) as sector_nombre
                FROM recetas r
                JOIN receta_ingredientes ri ON r.id = ri.receta_id
                LEFT JOIN ingredientes i ON i.id = ri.ingrediente_id
                WHERE r.articulo_numero = $1
            `;
            const recetaResult = await pool.query(queryReceta, [articulo.articulo_numero]);
            console.log("🔎 recetaResult para", articulo.articulo_numero, recetaResult.rows);

            // Por cada ingrediente en la receta
            for (const ing of recetaResult.rows) {
                // Mantener alta precisión en el cálculo de cantidad total
                const cantidadTotal = Number((ing.cantidad * articulo.cantidad).toPrecision(10));

                console.log(`\n🔍 ANÁLISIS DE CANTIDADES - ${articulo.articulo_numero} `);
                console.log(`===================================================== `);
                console.log(`1️⃣ DATOS DE ENTRADA: `);
                console.log(`- Cantidad en receta: ${ing.cantidad} kg`);
                console.log(`- Unidades pedidas: ${articulo.cantidad} `);
                console.log(`2️⃣ CÁLCULO CORREGIDO: `);
                console.log(`${ing.cantidad} × ${articulo.cantidad} = ${cantidadTotal} kg`);
                console.log(`✅ El peso unitario se manejará en expandirIngrediente via receta_base_kg`);
                console.log(`=====================================================\n`);

                let ingredienteIdParaExpandir = ing.ingrediente_id;

                // Si ingrediente_id es null, buscar por nombre
                if (!ingredienteIdParaExpandir) {
                    console.log(`🔍 ingrediente_id es NULL para ${ing.nombre_ingrediente}, buscando por nombre...`);
                    ingredienteIdParaExpandir = await buscarIngredientePorNombre(ing.nombre_ingrediente);
                    if (ingredienteIdParaExpandir) {
                        console.log(`✅ ID encontrado por nombre: ${ingredienteIdParaExpandir} para ${ing.nombre_ingrediente} `);
                    } else {
                        console.log(`⚠️ No se encontró ID para ${ing.nombre_ingrediente}, omitiendo expansión`);
                    }
                }

                let ingredientesExpandidos = [];
                let sectorLetra = null;
                if (ing.sector_descripcion || ing.sector_nombre || ing.sector_id) {
                    sectorLetra = extraerLetraSector(ing.sector_descripcion, ing.sector_nombre) || ing.sector_nombre || ing.sector_descripcion || null;
                }

                if (ingredienteIdParaExpandir) {
                    const esMix = await verificarSiEsMix(ingredienteIdParaExpandir);

                    if (esMix) {
                        console.log(`✅ Ingrediente ${ing.nombre_ingrediente} (ID: ${ingredienteIdParaExpandir}) es un MIX - procediendo a expandir`);
                        ingredientesExpandidos = await expandirIngrediente(
                            ingredienteIdParaExpandir,
                            cantidadTotal,
                            new Set(),
                            ingredienteIdParaExpandir // Pasar el ID del mix como origen_mix_id
                        );

                        if (ingredientesExpandidos.length > 0) {
                            todosLosIngredientes = todosLosIngredientes.concat(ingredientesExpandidos);
                        } else {
                            console.log(`⚠️ Error: No se obtuvieron ingredientes expandidos para el mix ${ing.nombre_ingrediente} `);
                        }
                    } else {
                        console.log(`ℹ️ Ingrediente ${ing.nombre_ingrediente} (ID: ${ingredienteIdParaExpandir}) es un ingrediente simple - agregando directamente`);
                        // Para ingredientes simples, agregar directamente
                        todosLosIngredientes.push({
                            id: ingredienteIdParaExpandir,
                            nombre: ing.nombre_ingrediente,
                            unidad_medida: ing.unidad_medida,
                            cantidad: cantidadTotal,
                            sector_letra: sectorLetra
                        });
                    }
                } else {
                    console.log(`⚠️ No se encontró ID para ${ing.nombre_ingrediente} - agregando sin ID`);
                    // Si no se encontró ID, agregar sin ID (fallback)
                    todosLosIngredientes.push({
                        id: null,
                        nombre: ing.nombre_ingrediente,
                        unidad_medida: ing.unidad_medida,
                        cantidad: cantidadTotal,
                        sector_letra: sectorLetra
                    });
                }
            }

            // Si el artículo no tiene receta, verificar si es un mix o ingrediente primario
            if (recetaResult.rows.length === 0) {
                console.log(`📦 Artículo ${articulo.articulo_numero} sin receta - verificando tipo`);
                const queryIngredientePrimario = `
                    SELECT id, nombre, unidad_medida
                    FROM ingredientes
                    WHERE LOWER(nombre) = LOWER($1)
            `;
                const ingredientePrimario = await pool.query(queryIngredientePrimario, [articulo.articulo_numero]);

                if (ingredientePrimario.rows.length > 0) {
                    const ingredienteId = ingredientePrimario.rows[0].id;
                    const esMix = await verificarSiEsMix(ingredienteId);

                    if (esMix) {
                        console.log(`✅ Artículo ${articulo.articulo_numero} es un MIX - expandiendo componentes`);
                        const ingredientesExpandidos = await expandirIngrediente(
                            ingredienteId,
                            articulo.cantidad
                        );
                        if (ingredientesExpandidos.length > 0) {
                            todosLosIngredientes = todosLosIngredientes.concat(ingredientesExpandidos);
                        } else {
                            console.log(`⚠️ Error: No se obtuvieron ingredientes expandidos para el mix ${articulo.articulo_numero} `);
                        }
                    } else {
                        console.log(`✅ Artículo ${articulo.articulo_numero} es ingrediente primario - agregando directamente`);
                        todosLosIngredientes.push({
                            id: ingredienteId,
                            nombre: ingredientePrimario.rows[0].nombre,
                            unidad_medida: ingredientePrimario.rows[0].unidad_medida,
                            cantidad: articulo.cantidad
                        });
                    }
                } else {
                    console.log(`⚠️ No se encontró ingrediente para artículo ${articulo.articulo_numero} `);
                }
            }
        }

        // 3. Consolidar todos los ingredientes
        const ingredientesConsolidados = consolidarIngredientes(todosLosIngredientes);

        // Obtener el tipo de carro
        const queryTipoCarro = `
            SELECT tipo_carro, usuario_id
            FROM carros_produccion
            WHERE id = $1
            `;
        const tipoCarroResult = await pool.query(queryTipoCarro, [carroId]);
        const tipoCarro = tipoCarroResult.rows[0]?.tipo_carro || 'interna';
        const carroUsuarioId = tipoCarroResult.rows[0]?.usuario_id;

        console.log(`\n🔍 TIPO DE CARRO: ${tipoCarro} `);
        console.log(`Usuario del carro: ${carroUsuarioId} `);

        // 4. Agregar stock_actual a cada ingrediente consolidado según el tipo de carro
        const ingredientesConStock = await Promise.all(
            ingredientesConsolidados.map(async (ingrediente) => {
                if (ingrediente.id) {
                    try {
                        let stockActual = 0;

                        if (tipoCarro === 'externa') {
                            console.log(`\n📦 Obteniendo stock de usuario para ingrediente ${ingrediente.id} `);
                            // Consultar stock del usuario para carros externos
                            const queryStockUsuario = `
                                SELECT SUM(cantidad) as stock_usuario
                                FROM ingredientes_stock_usuarios
                                WHERE usuario_id = $1 AND ingrediente_id = $2
                                GROUP BY ingrediente_id
                            `;
                            const stockUsuarioResult = await pool.query(queryStockUsuario, [carroUsuarioId, ingrediente.id]);
                            stockActual = stockUsuarioResult.rows[0]?.stock_usuario || 0;
                            console.log(`Stock usuario encontrado: ${stockActual} `);
                        } else {
                            console.log(`\n📦 Obteniendo stock REAL para ingrediente ${ingrediente.id} (tabla ingredientes + sustituciones)`);
                            // 🔧 CORRECCIÓN CRÍTICA: Incluir sustituciones en el cálculo
                            // Stock = stock_actual de tabla ingredientes (ya incluye trigger de movimientos normales)
                            const queryStockReal = `
        SELECT
        i.stock_actual,
            i.nombre as ingrediente_nombre
                                FROM ingredientes i
                                WHERE i.id = $1
            `;
                            const stockResult = await pool.query(queryStockReal, [ingrediente.id]);

                            if (stockResult.rows.length > 0) {
                                const stockData = stockResult.rows[0];
                                stockActual = parseFloat(stockData.stock_actual) || 0;
                                console.log(`📊 Stock obtenido para ingrediente ${ingrediente.id} (${stockData.ingrediente_nombre}): `);
                                console.log(`- Stock actual(incluye trigger automático): ${stockActual} `);
                                console.log(`- Tipo de dato: ${typeof stockData.stock_actual} `);
                                console.log(`- Valor raw: ${stockData.stock_actual} `);
                            } else {
                                stockActual = 0;
                                console.log(`⚠️ No se encontró el ingrediente ${ingrediente.id} `);
                            }
                        }

                        return {
                            ...ingrediente,
                            stock_actual: Number(parseFloat(stockActual).toPrecision(10)),
                            origen_mix_id: ingrediente.origen_mix_id, // Preservar origen_mix_id
                            sector_letra: ingrediente.sector_letra
                        };
                    } catch (error) {
                        console.error(`Error obteniendo stock para ingrediente ${ingrediente.id}: `, error);
                        return {
                            ...ingrediente,
                            stock_actual: 0,
                            origen_mix_id: ingrediente.origen_mix_id, // Preservar origen_mix_id también en caso de error
                            sector_letra: ingrediente.sector_letra
                        };
                    }
                } else {
                    // Si no tiene ID, no podemos obtener stock
                    return {
                        ...ingrediente,
                        stock_actual: 0
                    };
                }
            })
        );

        console.log(`\n📊 INGREDIENTES CON STOCK AGREGADO: `);
        ingredientesConStock.forEach((ing, index) => {
            const estado = ing.stock_actual >= ing.cantidad ? '✅' : '❌';
            console.log(`  ${index + 1}. ${ing.nombre}: Necesario ${ing.cantidad}, Stock ${ing.stock_actual} ${estado} `);
        });

        return ingredientesConStock;

    } catch (error) {
        console.error('Error al obtener ingredientes base del carro:', error);
        throw new Error(`Error detallado al obtener ingredientes del carro: ${error.message}`);
    }
}

/**
 * Obtiene todos los ingredientes compuestos (mixes) necesarios para un carro,
 * consolidando cantidades sin expandir a ingredientes primarios
 * @param {number} carroId - ID del carro
 * @param {number} usuarioId - ID del usuario que solicita los ingredientes
 * @returns {Promise<Array>} Lista de mixes consolidados
 */
async function obtenerMixesCarro(carroId, usuarioId) {
    try {
        console.log(`\n🧪 INICIANDO ANÁLISIS DE MIXES DEL CARRO ${carroId} `);
        console.log(`=============================================== `);

        // Validar que el carro pertenece al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // 1. Obtener artículos del carro
        const queryArticulos = `
        SELECT
        ca.articulo_numero,
            ca.cantidad
            FROM carros_articulos ca
            WHERE ca.carro_id = $1
            `;
        const articulosResult = await pool.query(queryArticulos, [carroId]);
        console.log(`📦 ARTÍCULOS EN EL CARRO: ${articulosResult.rows.length} `);

        // 2. Por cada artículo, obtener sus ingredientes que sean mixes
        let todosLosMixes = [];
        for (const articulo of articulosResult.rows) {
            console.log(`\n🔍 PROCESANDO ARTÍCULO: ${articulo.articulo_numero} `);

            // Obtener la receta del artículo
            const queryReceta = `
        SELECT
        ri.ingrediente_id,
            CAST(ri.cantidad AS DECIMAL(20, 10)) as cantidad,
            COALESCE(i.nombre, ri.nombre_ingrediente) as nombre_ingrediente,
            COALESCE(i.unidad_medida, 'Kilo') as unidad_medida
                FROM recetas r
                JOIN receta_ingredientes ri ON r.id = ri.receta_id
                LEFT JOIN ingredientes i ON i.id = ri.ingrediente_id
                WHERE r.articulo_numero = $1
            `;
            const recetaResult = await pool.query(queryReceta, [articulo.articulo_numero]);

            // Por cada ingrediente en la receta, verificar si es un mix
            for (const ing of recetaResult.rows) {
                let ingredienteIdParaVerificar = ing.ingrediente_id;

                // Si ingrediente_id es null, buscar por nombre
                if (!ingredienteIdParaVerificar) {
                    ingredienteIdParaVerificar = await buscarIngredientePorNombre(ing.nombre_ingrediente);
                }

                if (ingredienteIdParaVerificar) {
                    const esMix = await verificarSiEsMix(ingredienteIdParaVerificar);

                    if (esMix) {
                        console.log(`✅ Ingrediente ${ing.nombre_ingrediente} (ID: ${ingredienteIdParaVerificar}) es un MIX`);

                        // Mantener alta precisión en el cálculo de cantidad total para mixes
                        const cantidadTotal = Number((ing.cantidad * articulo.cantidad).toPrecision(10));

                        console.log(`\n📊 CÁLCULO DE CANTIDAD PARA MIX EN RECETA: `);
                        console.log(`- Artículo: ${articulo.articulo_numero} `);
                        console.log(`- Cantidad en receta: ${ing.cantidad} kg`);
                        console.log(`- Unidades pedidas: ${articulo.cantidad} `);
                        console.log(`- Cantidad total: ${cantidadTotal} kg`);

                        todosLosMixes.push({
                            id: ingredienteIdParaVerificar,
                            nombre: ing.nombre_ingrediente,
                            unidad_medida: ing.unidad_medida,
                            cantidad: cantidadTotal
                        });
                    }
                }
            }

            // Si el artículo no tiene receta, verificar si el artículo mismo es un mix
            if (recetaResult.rows.length === 0) {
                console.log(`📦 Artículo ${articulo.articulo_numero} sin receta - verificando si es mix`);
                const queryIngrediente = `
                    SELECT id, nombre, unidad_medida
                    FROM ingredientes
                    WHERE LOWER(nombre) = LOWER($1)
            `;
                const ingredienteResult = await pool.query(queryIngrediente, [articulo.articulo_numero]);

                if (ingredienteResult.rows.length > 0) {
                    const ingredienteId = ingredienteResult.rows[0].id;
                    const esMix = await verificarSiEsMix(ingredienteId);

                    if (esMix) {
                        console.log(`✅ Artículo ${articulo.articulo_numero} es un MIX`);

                        // Obtener receta_base_kg del mix
                        const queryRecetaBase = `
                            SELECT receta_base_kg 
                            FROM ingredientes 
                            WHERE id = $1
            `;
                        const recetaBaseResult = await pool.query(queryRecetaBase, [ingredienteId]);
                        const recetaBaseKg = recetaBaseResult.rows[0]?.receta_base_kg || 10;

                        // Mantener alta precisión en el cálculo de cantidad total para mixes directos
                        const cantidadTotal = Number((articulo.cantidad * 0.3).toPrecision(10)); // 0.3kg por unidad

                        console.log(`\n📊 CÁLCULO DE CANTIDAD PARA MIX DIRECTO: `);
                        console.log(`- Nombre del mix: ${ingredienteResult.rows[0].nombre} `);
                        console.log(`- Unidades pedidas: ${articulo.cantidad} `);
                        console.log(`- Cantidad por unidad: 0.3kg`);
                        console.log(`- Cantidad total: ${cantidadTotal} kg`);

                        todosLosMixes.push({
                            id: ingredienteId,
                            nombre: ingredienteResult.rows[0].nombre,
                            unidad_medida: ingredienteResult.rows[0].unidad_medida,
                            cantidad: cantidadTotal
                        });
                    }
                }
            }
        }

        // 3. Consolidar todos los mixes por ID
        const mixesConsolidados = consolidarIngredientes(todosLosMixes);

        // Obtener el tipo de carro
        const queryTipoCarro = `
            SELECT tipo_carro, usuario_id
            FROM carros_produccion
            WHERE id = $1
            `;
        const tipoCarroResult = await pool.query(queryTipoCarro, [carroId]);
        const tipoCarro = tipoCarroResult.rows[0]?.tipo_carro || 'interna';
        const carroUsuarioId = tipoCarroResult.rows[0]?.usuario_id;

        console.log(`\n🔍 TIPO DE CARRO: ${tipoCarro} `);
        console.log(`Usuario del carro: ${carroUsuarioId} `);

        // Agregar stock a los mixes según el tipo de carro
        const mixesConStock = await Promise.all(
            mixesConsolidados.map(async (mix) => {
                try {
                    let stockActual = 0;

                    if (tipoCarro === 'externa') {
                        console.log(`\n📦 Obteniendo stock de usuario para mix ${mix.id} `);
                        // Consultar stock del usuario para carros externos
                        const queryStockUsuario = `
                            SELECT SUM(cantidad) as stock_usuario
                            FROM ingredientes_stock_usuarios
                            WHERE usuario_id = $1 AND ingrediente_id = $2
                            GROUP BY ingrediente_id
                        `;
                        const stockUsuarioResult = await pool.query(queryStockUsuario, [carroUsuarioId, mix.id]);
                        stockActual = stockUsuarioResult.rows[0]?.stock_usuario || 0;
                        console.log(`Stock usuario encontrado: ${stockActual} `);
                    } else {
                        console.log(`\n📦 Obteniendo stock central para mix ${mix.id} `);
                        // Consultar stock central para carros internos
                        const queryStock = `
                            SELECT stock_actual 
                            FROM ingredientes 
                            WHERE id = $1
            `;
                        const stockResult = await pool.query(queryStock, [mix.id]);
                        stockActual = stockResult.rows[0]?.stock_actual || 0;
                        console.log(`Stock central encontrado: ${stockActual} `);
                    }

                    return {
                        ...mix,
                        stock_actual: Number(parseFloat(stockActual).toPrecision(10))
                    };
                } catch (error) {
                    console.error(`Error obteniendo stock para mix ${mix.id}: `, error);
                    return {
                        ...mix,
                        stock_actual: 0
                    };
                }
            })
        );

        console.log(`\n✅ MIXES CONSOLIDADOS CON STOCK: ${mixesConStock.length} `);
        if (mixesConStock.length > 0) {
            mixesConStock.forEach((mix, index) => {
                const estado = mix.stock_actual >= mix.cantidad ? '✅' : '❌';
                console.log(`  ${index + 1}. ${mix.nombre}: Necesario ${mix.cantidad}, Stock ${mix.stock_actual} ${estado} `);
            });
        } else {
            console.log(`⚠️ No se encontraron mixes en el carro ${carroId} `);
        }

        console.log(`\n🔍 DIAGNÓSTICO FINAL - MIXES: `);
        console.log(`- Total de artículos procesados: ${articulosResult.rows.length} `);
        console.log(`- Total de mixes encontrados antes de consolidar: ${todosLosMixes.length} `);
        console.log(`- Total de mixes después de consolidar: ${mixesConsolidados.length} `);
        console.log(`===============================================\n`);

        return mixesConsolidados;

    } catch (error) {
        console.error('Error al obtener mixes del carro:', error);
        throw new Error('No se pudieron obtener los mixes del carro');
    }
}

/**
 * Obtiene todos los ingredientes de artículos vinculados para un carro de producción externa
 * @param {number} carroId - ID del carro
 * @param {number} usuarioId - ID del usuario que solicita los ingredientes
 * @returns {Promise<Array>} Lista de ingredientes de artículos vinculados consolidados
 */
async function obtenerIngredientesArticulosVinculados(carroId, usuarioId) {
    try {
        console.log(`\n🔗 INICIANDO ANÁLISIS DE INGREDIENTES VINCULADOS DEL CARRO ${carroId} `);
        console.log(`=============================================== `);

        // Validar que el carro pertenece al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // Verificar que es un carro de producción externa
        const queryTipoCarro = `
            SELECT tipo_carro, fecha_preparado
            FROM carros_produccion
            WHERE id = $1
            `;
        const tipoCarroResult = await pool.query(queryTipoCarro, [carroId]);
        const tipoCarro = tipoCarroResult.rows[0]?.tipo_carro;
        const fechaPreparado = tipoCarroResult.rows[0]?.fecha_preparado;

        if (tipoCarro !== 'externa') {
            console.log(`⚠️ Carro ${carroId} no es de producción externa(tipo: ${tipoCarro})`);
            return [];
        }

        // 1. Obtener artículos del carro que tienen vínculos
        const queryArticulosVinculados = `
        SELECT
        ca.articulo_numero,
            ca.cantidad,
            rel.articulo_kilo_codigo,
            COALESCE(rel.multiplicador_ingredientes, 1) as multiplicador_ingredientes
            FROM carros_articulos ca
            INNER JOIN articulos_produccion_externa_relacion rel 
                ON ca.articulo_numero = rel.articulo_produccion_codigo
            WHERE ca.carro_id = $1
            `;
        const articulosVinculadosResult = await pool.query(queryArticulosVinculados, [carroId]);

        console.log(`🔗 ARTÍCULOS CON VÍNCULOS: ${articulosVinculadosResult.rows.length} `);

        if (articulosVinculadosResult.rows.length === 0) {
            console.log(`⚠️ No se encontraron artículos vinculados en el carro ${carroId} `);
            return [];
        }

        // 2. Por cada artículo vinculado, obtener sus ingredientes
        let todosLosIngredientesVinculados = [];

        for (const articuloVinculado of articulosVinculadosResult.rows) {
            console.log(`\n🔍 PROCESANDO ARTÍCULO VINCULADO: ${articuloVinculado.articulo_kilo_codigo} `);
            console.log(`Cantidad del artículo padre: ${articuloVinculado.cantidad} `);

            // Obtener la receta del artículo vinculado
            const queryRecetaVinculado = `
        SELECT
        ri.ingrediente_id,
            CAST(ri.cantidad AS DECIMAL(20, 10)) as cantidad,
            COALESCE(i.nombre, ri.nombre_ingrediente) as nombre_ingrediente,
            COALESCE(i.unidad_medida, 'Kilo') as unidad_medida
                FROM recetas r
                JOIN receta_ingredientes ri ON r.id = ri.receta_id
                LEFT JOIN ingredientes i ON i.id = ri.ingrediente_id
                WHERE r.articulo_numero = $1
            `;
            const recetaVinculadoResult = await pool.query(queryRecetaVinculado, [articuloVinculado.articulo_kilo_codigo]);

            console.log(`🔎 Ingredientes en receta vinculada: ${recetaVinculadoResult.rows.length} `);

            // Por cada ingrediente en la receta del artículo vinculado
            for (const ing of recetaVinculadoResult.rows) {
                // Aplicar multiplicador de ingredientes para artículos vinculados
                const multiplicador = articuloVinculado.multiplicador_ingredientes || 1;
                const cantidadTotal = Number((ing.cantidad * articuloVinculado.cantidad * multiplicador).toPrecision(10));

                console.log(`\n🔍 ANÁLISIS DE CANTIDADES VINCULADAS - ${articuloVinculado.articulo_kilo_codigo} `);
                console.log(`===================================================== `);
                console.log(`1️⃣ DATOS DE ENTRADA: `);
                console.log(`- Cantidad en receta vinculada: ${ing.cantidad} kg`);
                console.log(`- Unidades del artículo padre: ${articuloVinculado.cantidad} `);
                console.log(`- Multiplicador de ingredientes: ${multiplicador} `);
                console.log(`2️⃣ CÁLCULO CON MULTIPLICADOR: `);
                console.log(`${ing.cantidad} × ${articuloVinculado.cantidad} × ${multiplicador} = ${cantidadTotal} kg`);
                console.log(`=====================================================\n`);

                let ingredienteIdParaExpandir = ing.ingrediente_id;

                // Si ingrediente_id es null, buscar por nombre
                if (!ingredienteIdParaExpandir) {
                    console.log(`🔍 ingrediente_id es NULL para ${ing.nombre_ingrediente}, buscando por nombre...`);
                    ingredienteIdParaExpandir = await buscarIngredientePorNombre(ing.nombre_ingrediente);
                    if (ingredienteIdParaExpandir) {
                        console.log(`✅ ID encontrado por nombre: ${ingredienteIdParaExpandir} para ${ing.nombre_ingrediente} `);
                    } else {
                        console.log(`⚠️ No se encontró ID para ${ing.nombre_ingrediente}, omitiendo expansión`);
                    }
                }

                let ingredientesExpandidos = [];
                if (ingredienteIdParaExpandir) {
                    const esMix = await verificarSiEsMix(ingredienteIdParaExpandir);

                    if (esMix) {
                        console.log(`✅ Ingrediente vinculado ${ing.nombre_ingrediente} (ID: ${ingredienteIdParaExpandir}) es un MIX - procediendo a expandir`);
                        ingredientesExpandidos = await expandirIngrediente(
                            ingredienteIdParaExpandir,
                            cantidadTotal,
                            new Set(),
                            ingredienteIdParaExpandir
                        );

                        if (ingredientesExpandidos.length > 0) {
                            todosLosIngredientesVinculados = todosLosIngredientesVinculados.concat(ingredientesExpandidos);
                        } else {
                            console.log(`⚠️ Error: No se obtuvieron ingredientes expandidos para el mix vinculado ${ing.nombre_ingrediente} `);
                        }
                    } else {
                        console.log(`ℹ️ Ingrediente vinculado ${ing.nombre_ingrediente} (ID: ${ingredienteIdParaExpandir}) es un ingrediente simple - agregando directamente`);
                        // Para ingredientes simples, agregar directamente
                        todosLosIngredientesVinculados.push({
                            id: ingredienteIdParaExpandir,
                            nombre: ing.nombre_ingrediente,
                            unidad_medida: ing.unidad_medida,
                            cantidad: cantidadTotal
                        });
                    }
                } else {
                    console.log(`⚠️ No se encontró ID para ingrediente vinculado ${ing.nombre_ingrediente} - agregando sin ID`);
                    // Si no se encontró ID, agregar sin ID (fallback)
                    todosLosIngredientesVinculados.push({
                        id: null,
                        nombre: ing.nombre_ingrediente,
                        unidad_medida: ing.unidad_medida,
                        cantidad: cantidadTotal
                    });
                }
            }

            // Si el artículo vinculado no tiene receta, verificar si es un mix o ingrediente primario
            if (recetaVinculadoResult.rows.length === 0) {
                console.log(`📦 Artículo vinculado ${articuloVinculado.articulo_kilo_codigo} sin receta - verificando tipo`);
                const queryIngredientePrimario = `
                    SELECT id, nombre, unidad_medida
                    FROM ingredientes
                    WHERE LOWER(nombre) = LOWER($1)
            `;
                const ingredientePrimario = await pool.query(queryIngredientePrimario, [articuloVinculado.articulo_kilo_codigo]);

                if (ingredientePrimario.rows.length > 0) {
                    const ingredienteId = ingredientePrimario.rows[0].id;
                    const esMix = await verificarSiEsMix(ingredienteId);

                    if (esMix) {
                        console.log(`✅ Artículo vinculado ${articuloVinculado.articulo_kilo_codigo} es un MIX - expandiendo componentes`);
                        const ingredientesExpandidos = await expandirIngrediente(
                            ingredienteId,
                            articuloVinculado.cantidad
                        );
                        if (ingredientesExpandidos.length > 0) {
                            todosLosIngredientesVinculados = todosLosIngredientesVinculados.concat(ingredientesExpandidos);
                        } else {
                            console.log(`⚠️ Error: No se obtuvieron ingredientes expandidos para el mix vinculado ${articuloVinculado.articulo_kilo_codigo} `);
                        }
                    } else {
                        console.log(`✅ Artículo vinculado ${articuloVinculado.articulo_kilo_codigo} es ingrediente primario - agregando directamente`);
                        todosLosIngredientesVinculados.push({
                            id: ingredienteId,
                            nombre: ingredientePrimario.rows[0].nombre,
                            unidad_medida: ingredientePrimario.rows[0].unidad_medida,
                            cantidad: articuloVinculado.cantidad
                        });
                    }
                } else {
                    console.log(`⚠️ No se encontró ingrediente para artículo vinculado ${articuloVinculado.articulo_kilo_codigo} `);
                }
            }
        }

        // 3. Consolidar todos los ingredientes vinculados
        const ingredientesVinculadosConsolidados = consolidarIngredientes(todosLosIngredientesVinculados);

        // 4. Agregar stock_actual de producción general (stock_real_consolidado) a cada ingrediente
        console.log(`\n🔍 INICIANDO PROCESO DE OBTENCIÓN DE STOCK PARA INGREDIENTES VINCULADOS`);
        console.log(`Total de ingredientes vinculados consolidados: ${ingredientesVinculadosConsolidados.length} `);

        const ingredientesVinculadosConStock = await Promise.all(
            ingredientesVinculadosConsolidados.map(async (ingrediente, index) => {
                // 🛑 Si el carro estamos preparado, simular stock suficiente (congelado)
                if (fechaPreparado) {
                    return {
                        ...ingrediente,
                        stock_actual: Number(ingrediente.cantidad.toPrecision(10)),
                        origen_mix_id: ingrediente.origen_mix_id
                    };
                }

                console.log(`\n🔍[${index + 1}/${ingredientesVinculadosConsolidados.length}] PROCESANDO INGREDIENTE VINCULADO: `);
                console.log(`- ID: ${ingrediente.id} `);
                console.log(`- Nombre: ${ingrediente.nombre} `);
                console.log(`- Cantidad necesaria: ${ingrediente.cantidad} `);

                if (ingrediente.id) {
                    try {
                        console.log(`\n📦 Obteniendo stock de producción general para ingrediente vinculado ${ingrediente.id} `);

                        // Para ingredientes vinculados, consultar stock directamente desde la tabla ingredientes
                        console.log(`🔍 Consultando stock directamente desde tabla ingredientes para ID ${ingrediente.id} `);

                        // Consultar stock de producción general desde tabla ingredientes
                        const queryStockGeneral = `
    SELECT
    i.stock_actual,
        i.nombre as ingrediente_nombre,
        i.id as ingrediente_id
                            FROM ingredientes i
                            WHERE i.id = $1
        `;
                        console.log(`🔍 Ejecutando query de stock: ${queryStockGeneral} `);
                        console.log(`🔍 Parámetro ingrediente_id: ${ingrediente.id} `);

                        const stockGeneralResult = await pool.query(queryStockGeneral, [ingrediente.id]);
                        console.log(`🔍 Resultado de query stock: `, stockGeneralResult.rows);
                        console.log(`🔍 Número de filas devueltas: ${stockGeneralResult.rows.length} `);

                        if (stockGeneralResult.rows.length > 0) {
                            const stockData = stockGeneralResult.rows[0];
                            console.log(`✅ Stock encontrado para ${stockData.ingrediente_nombre}: `);
                            console.log(`- stock_actual: ${stockData.stock_actual} `);
                            console.log(`- ingrediente_id: ${stockData.ingrediente_id} `);
                        } else {
                            console.log(`❌ No se encontró stock para ingrediente ID ${ingrediente.id} `);
                        }

                        const stockActual = stockGeneralResult.rows[0]?.stock_actual || 0;
                        console.log(`📊 Stock final asignado: ${stockActual} `);

                        const resultado = {
                            ...ingrediente,
                            stock_actual: Number(parseFloat(stockActual).toPrecision(10)),
                            origen_mix_id: ingrediente.origen_mix_id
                        };

                        console.log(`✅ Ingrediente procesado: `, {
                            id: resultado.id,
                            nombre: resultado.nombre,
                            cantidad: resultado.cantidad,
                            stock_actual: resultado.stock_actual
                        });

                        return resultado;
                    } catch (error) {
                        console.error(`❌ Error obteniendo stock de producción general para ingrediente vinculado ${ingrediente.id}: `, error);
                        console.error(`❌ Stack trace: `, error.stack);
                        return {
                            ...ingrediente,
                            stock_actual: 0,
                            origen_mix_id: ingrediente.origen_mix_id
                        };
                    }
                } else {
                    console.log(`⚠️ Ingrediente sin ID, asignando stock 0`);
                    // Si no tiene ID, no podemos obtener stock
                    return {
                        ...ingrediente,
                        stock_actual: 0
                    };
                }
            })
        );

        console.log(`\n📊 RESUMEN FINAL DE INGREDIENTES VINCULADOS CON STOCK: `);
        ingredientesVinculadosConStock.forEach((ing, index) => {
            console.log(`${index + 1}. ${ing.nombre} (ID: ${ing.id}): Necesario ${ing.cantidad}, Stock ${ing.stock_actual} `);
        });

        console.log(`\n📊 INGREDIENTES VINCULADOS CON STOCK AGREGADO: `);
        ingredientesVinculadosConStock.forEach((ing, index) => {
            const estado = ing.stock_actual >= ing.cantidad ? '✅' : '❌';
            console.log(`  ${index + 1}. ${ing.nombre}: Necesario ${ing.cantidad}, Stock ${ing.stock_actual} ${estado} `);
        });

        console.log(`\n✅ INGREDIENTES VINCULADOS CONSOLIDADOS: ${ingredientesVinculadosConStock.length} `);
        console.log(`===============================================\n`);

        return ingredientesVinculadosConStock;

    } catch (error) {
        console.error('Error al obtener ingredientes de artículos vinculados:', error);
        throw new Error('No se pudieron obtener los ingredientes de artículos vinculados');
    }
}

module.exports = {
    obtenerIngredientesBaseCarro,
    obtenerMixesCarro,
    obtenerArticulosDeRecetas,
    obtenerIngredientesArticulosVinculados
};
