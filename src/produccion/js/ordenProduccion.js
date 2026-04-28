// Función para imprimir orden de producción
export async function imprimirOrdenProduccion() {
    const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    if (!carroId) {
        console.error('No hay carro activo');
        return;
    }

    try {
        console.log('📄 Generando orden de producción para carro:', carroId);

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;

        if (!colaborador) {
            throw new Error('No se encontró información del colaborador activo');
        }

        // 🎯 OBTENER TIPO DE CARRO para personalizar el reporte
        let tipoCarro = 'interna';
        let estadoCarro = 'en_preparacion';
        try {
            const estadoResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
            if (estadoResponse.ok) {
                const estadoData = await estadoResponse.json();
                tipoCarro = estadoData.tipo_carro || 'interna';
                estadoCarro = estadoData.estado || 'en_preparacion';
                console.log(`📊 Tipo de carro: ${tipoCarro}, Estado: ${estadoCarro}`);
            }
        } catch (error) {
            console.warn('⚠️ No se pudo obtener tipo de carro, asumiendo interna');
        }

        // Obtener datos del carro usando consultas directas a las tablas
        const promesas = [
            obtenerArticulosCarro(carroId),
            obtenerOperario(colaborador.id),
            obtenerIngresosManuales(carroId),
            obtenerRecetasMixes(carroId),
            obtenerResumenIngredientes(carroId, colaborador.id)
        ];

        // 🎯 PARA CARROS EXTERNOS: Obtener artículos de producción externa (insumos a retirar)
        if (tipoCarro === 'externa') {
            promesas.push(obtenerArticulosExternos(carroId, colaborador.id));
        }

        const resultados = await Promise.all(promesas);

        const [articulosData, operarioData, ingresosData, mixesData, resumenIngredientesData, articulosExternosData] = resultados;

        console.log('📋 Artículos obtenidos:', articulosData);
        console.log('👤 Operario obtenido:', operarioData);
        console.log('📦 Ingresos manuales obtenidos:', ingresosData);
        console.log('🧪 Mixes obtenidos:', mixesData);
        console.log('🌿 Resumen de ingredientes obtenido:', resumenIngredientesData);
        if (tipoCarro === 'externa') {
            console.log('🚚 Artículos externos obtenidos:', articulosExternosData);
        }

        // Generar HTML de la orden
        const htmlOrden = generarHTMLOrden({
            carroId,
            operario: operarioData,
            articulos: articulosData,
            mixes: mixesData,
            ingresos: ingresosData,
            resumenIngredientes: resumenIngredientesData,
            articulosExternos: articulosExternosData || [],
            tipoCarro,
            estadoCarro,
            fecha: new Date()
        });

        // Imprimir directamente
        await imprimirHTML(htmlOrden);

        console.log('✅ Orden de producción enviada a impresora');

    } catch (error) {
        console.error('❌ Error al imprimir orden de producción:', error);
        alert('Error al imprimir orden de producción: ' + error.message);
    }
}

// Función para obtener artículos del carro
async function obtenerArticulosCarro(carroId) {
    try {
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;

        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${colaborador.id}`);
        if (!response.ok) {
            throw new Error('Error al obtener artículos del carro');
        }

        const articulos = await response.json();

        // Mapear los datos para que coincidan con el formato esperado en el HTML
        return articulos.map(art => ({
            articulo_numero: art.numero || art.articulo_numero,
            descripcion: art.descripcion,
            cantidad: art.cantidad
        }));
    } catch (error) {
        console.error('Error al obtener artículos:', error);
        throw error;
    }
}

// Función para obtener información del operario
async function obtenerOperario(usuarioId) {
    try {
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            return { nombre_completo: 'No disponible' };
        }

        const colaborador = JSON.parse(colaboradorData);
        console.log('📋 Datos del colaborador desde localStorage:', colaborador);

        // Intentar obtener información más completa del usuario desde la base de datos
        try {
            const response = await fetch(`http://localhost:3002/api/produccion/usuarios?rol=1&activo=true`);
            if (response.ok) {
                const usuarios = await response.json();
                const usuarioCompleto = usuarios.find(u => u.id === colaborador.id);

                if (usuarioCompleto) {
                    console.log('✅ Usuario encontrado en base de datos:', usuarioCompleto);
                    return {
                        nombre_completo: usuarioCompleto.nombre_completo,
                        id: usuarioCompleto.id
                    };
                }
            }
        } catch (dbError) {
            console.warn('⚠️ No se pudo obtener usuario desde BD, usando localStorage:', dbError);
        }

        // Si no se puede obtener desde BD, usar datos del localStorage
        console.log('📋 Usando datos del localStorage para operario');
        return {
            nombre_completo: colaborador.nombre_completo || colaborador.nombre || 'Usuario sin nombre',
            id: colaborador.id
        };
    } catch (error) {
        console.error('❌ Error al obtener operario:', error);
        return { nombre_completo: 'Error al obtener operario' };
    }
}

// Función para obtener el resumen de ingredientes (incluyendo vinculados para externos)
async function obtenerResumenIngredientes(carroId, usuarioId) {
    try {
        // Obtener ingredientes base
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingredientes?usuarioId=${usuarioId}`);
        if (!response.ok) {
            throw new Error('No se pudo obtener el resumen de ingredientes');
        }
        const ingredientesBase = await response.json();

        // 🎯 PARA CARROS EXTERNOS: Obtener también ingredientes vinculados
        let ingredientesVinculados = [];
        try {
            const responseVinculados = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingredientes-vinculados?usuarioId=${usuarioId}`);
            if (responseVinculados.ok) {
                ingredientesVinculados = await responseVinculados.json();
                // Marcar como vinculados
                ingredientesVinculados = ingredientesVinculados.map(ing => ({
                    ...ing,
                    es_de_articulo_vinculado: true
                }));
                console.log(`🔗 Ingredientes vinculados para PDF: ${ingredientesVinculados.length}`);
            }
        } catch (error) {
            console.warn('⚠️ No se pudieron obtener ingredientes vinculados:', error);
        }

        // Combinar ambos arrays
        return [...ingredientesBase, ...ingredientesVinculados];
    } catch (error) {
        console.error('❌ Error al obtener resumen de ingredientes:', error);
        return []; // Devolver array vacío en caso de error
    }
}


// Función para obtener ingresos manuales realizados (usando la misma fuente que la pantalla)
async function obtenerIngresosManuales(carroId) {
    try {
        console.log(`\n🔍 OBTENIENDO INGRESOS MANUALES PARA IMPRESIÓN`);
        console.log(`=======================================================`);
        console.log(`📦 Carro: ${carroId}`);

        // 🎯 USAR LA MISMA FUENTE QUE LA PANTALLA: endpoint del backend
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingresos-manuales`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.warn(`⚠️ Error al obtener ingresos manuales del backend: ${response.status}`);
            return [];
        }

        const ingresosDelBackend = await response.json();
        console.log(`📦 Ingresos obtenidos del backend: ${ingresosDelBackend.length}`);
        console.log(`📦 Datos del backend:`, ingresosDelBackend);

        // 🔄 APLICAR EL MISMO FILTRO DE DUPLICADOS QUE LA PANTALLA
        const ingresosUnicosMap = new Map();
        ingresosDelBackend.forEach(ing => {
            const key = `${ing.articulo_numero || ing.articuloNumero}-${ing.kilos || ing.kilosTotales}-${ing.fecha || ing.fechaIngreso}-${ing.fuente_datos || ing.fuenteDatos}`;
            if (!ingresosUnicosMap.has(key)) {
                ingresosUnicosMap.set(key, ing);
            }
        });
        const ingresosUnicos = Array.from(ingresosUnicosMap.values());

        console.log(`🔍 Ingresos después de filtrar duplicados: ${ingresosUnicos.length}`);

        // 📋 CONVERTIR AL FORMATO ESPERADO POR EL INFORME IMPRESO
        const ingresosManuales = ingresosUnicos.map(ingreso => ({
            ingrediente_id: ingreso.ingrediente_id,
            articulo_descripcion: ingreso.articulo_nombre || ingreso.ingrediente_nombre || ingreso.articuloNombre || 'Artículo sin nombre',
            articulo_numero: ingreso.articulo_numero || ingreso.articuloNumero || '',
            codigo_barras: ingreso.codigo_barras || ingreso.codigoBarras || '',
            kilos_totales: parseFloat(ingreso.kilos || ingreso.kilosTotales || 0),
            cantidad_total: parseFloat(ingreso.cantidad || ingreso.cantidadUnidades || 0),
            tipo_articulo: ingreso.tipo_articulo || 'simple',
            fuente_datos: ingreso.fuente_datos || 'backend',
            fecha: ingreso.fecha || ingreso.fechaIngreso || new Date().toISOString(),
            ingrediente_destino_nombre: ingreso.ingrediente_destino_nombre || null,
            observaciones: ingreso.observaciones || null
        }));

        console.log(`\n📊 RESULTADO FINAL PARA IMPRESIÓN:`);
        console.log(`- Total de ingresos manuales: ${ingresosManuales.length}`);
        console.log(`- Datos para impresión:`, ingresosManuales);
        console.log(`=======================================================\n`);

        return ingresosManuales;

    } catch (error) {
        console.error('❌ Error al obtener ingresos manuales para impresión:', error);
        console.error('❌ Stack trace:', error.stack);

        // 🔄 FALLBACK: Intentar usar datos del array global si el backend falla
        console.log('🔄 Intentando fallback con array global...');
        try {
            if (typeof window.ingresosManualesDelCarro !== 'undefined') {
                const ingresosDelCarro = window.ingresosManualesDelCarro.filter(ingreso =>
                    ingreso.carroId && ingreso.carroId.toString() === carroId.toString()
                );

                return ingresosDelCarro.map(ingreso => ({
                    ingrediente_id: ingreso.ingrediente_id,
                    articulo_descripcion: ingreso.articuloNombre || 'Artículo',
                    articulo_numero: ingreso.articuloNumero || '',
                    codigo_barras: ingreso.codigoBarras || '',
                    kilos_totales: parseFloat(ingreso.kilosTotales || 0),
                    cantidad_total: parseFloat(ingreso.cantidadUnidades || 0),
                    tipo_articulo: 'simple',
                    fuente_datos: 'memoria',
                    fecha: ingreso.fechaIngreso || new Date().toISOString()
                }));
            }
        } catch (fallbackError) {
            console.error('❌ Error en fallback:', fallbackError);
        }

        return [];
    }
}

// Función para obtener recetas de mixes
async function obtenerRecetasMixes(carroId) {
    try {
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;

        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/mixes?usuarioId=${colaborador.id}`);
        if (!response.ok) {
            return [];
        }

        const mixes = await response.json();
        console.log('🧪 Mixes obtenidos del carro:', mixes);

        // Para cada mix, obtener su composición detallada
        const mixesConRecetas = await Promise.all(mixes.map(async (mix) => {
            try {
                console.log(`🔍 Obteniendo composición para mix: ${mix.nombre} (ID: ${mix.id})`);

                // Obtener composición del mix
                const composicionResponse = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mix.id}/composicion`);
                if (!composicionResponse.ok) {
                    console.warn(`⚠️ No se pudo obtener composición para mix ${mix.nombre}`);
                    return {
                        nombre_mix: mix.nombre,
                        cantidad_total: mix.cantidad,
                        receta_base_kg: 'N/A',
                        ingredientes: []
                    };
                }

                const { composicion, mix: mixInfo } = await composicionResponse.json();
                console.log(`📋 Composición obtenida para ${mix.nombre}:`, { composicion, mixInfo });

                if (composicion && composicion.length > 0) {
                    const recetaBaseKg = mixInfo.receta_base_kg || 10; // Default 10kg si no está definido

                    console.log(`📊 Mix ${mix.nombre}:`);
                    console.log(`- Cantidad a producir: ${mix.cantidad} kg`);
                    console.log(`- Receta base: ${recetaBaseKg} kg`);
                    console.log(`- Mostrando receta original (sin multiplicar por cantidad a producir)`);

                    return {
                        nombre_mix: mix.nombre,
                        cantidad_total: mix.cantidad,
                        receta_base_kg: recetaBaseKg,
                        ingredientes: composicion.map(ing => ({
                            nombre_ingrediente: ing.nombre_ingrediente,
                            cantidad_total: ing.cantidad, // Cantidad original de la receta base
                            unidad_medida: ing.unidad_medida
                        }))
                    };
                }

                return {
                    nombre_mix: mix.nombre,
                    cantidad_total: mix.cantidad,
                    receta_base_kg: mixInfo.receta_base_kg || 'N/A',
                    ingredientes: []
                };
            } catch (error) {
                console.warn(`❌ Error al obtener composición para mix ${mix.nombre}:`, error);
                return {
                    nombre_mix: mix.nombre,
                    cantidad_total: mix.cantidad,
                    receta_base_kg: 'N/A',
                    ingredientes: []
                };
            }
        }));

        console.log('✅ Recetas de mixes procesadas:', mixesConRecetas);
        return mixesConRecetas;
    } catch (error) {
        console.error('❌ Error al obtener recetas de mixes:', error);
        return [];
    }
}

// 🎯 NUEVA FUNCIÓN: Obtener artículos de producción externa (insumos a retirar)
async function obtenerArticulosExternos(carroId, usuarioId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos-resumen?usuarioId=${usuarioId}`);
        if (!response.ok) {
            if (response.status === 404) {
                return [];
            }
            throw new Error('Error al obtener artículos externos');
        }
        return await response.json();
    } catch (error) {
        console.error('❌ Error al obtener artículos externos:', error);
        return [];
    }
}

// Función para generar HTML de la orden
function generarHTMLOrden({ carroId, operario, articulos, mixes, ingresos, resumenIngredientes, articulosExternos, tipoCarro, estadoCarro, fecha }) {
    // 🔍 DEBUGGING STOCK REPORTE
    console.log("🔍 DEBUGGING STOCK REPORTE:");
    console.log("1. Resumen Ingredientes (Data Cruda):", resumenIngredientes);
    console.log("2. Ingresos Manuales (Data Cruda):", ingresos);
    console.log("3. Tipo de carro:", tipoCarro);
    console.log("4. Artículos externos:", articulosExternos);

    ingresos.forEach(ing => {
        const match = resumenIngredientes.find(r => r.id === ing.ingrediente_id);
        console.log(`👉 Cruce para ${ing.articulo_descripcion}:`);
        console.log(`   - ID Buscado: ${ing.ingrediente_id}`);
        console.log(`   - Match encontrado:`, match);
        console.log(`   - Stock en Match:`, match ? match.stock_actual : 'N/A');
    });

    const fechaFormateada = fecha.toLocaleString('es-AR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

    // 🎯 TÍTULO DINÁMICO según tipo de carro
    const tituloOrden = tipoCarro === 'externa'
        ? 'ORDEN DE PRODUCCIÓN EXTERNA'
        : 'ORDEN DE PRODUCCIÓN';

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${tituloOrden} - Carro ${carroId}</title>
            <style>
                @page { margin: 12mm; }
                body { 
                    font-family: Arial, sans-serif; 
                    font-size: 10px; 
                    line-height: 1.2;
                    margin: 0;
                    padding: 0;
                }
                .header { 
                    text-align: center; 
                    border-bottom: 2px solid #000; 
                    padding-bottom: 6px; 
                    margin-bottom: 10px;
                }
                .header h1 { 
                    margin: 0; 
                    font-size: 16px; 
                    font-weight: bold;
                }
                .info-carro { 
                    margin-bottom: 10px; 
                    background: #f5f5f5; 
                    padding: 6px; 
                    border-radius: 3px;
                    font-size: 10px;
                }
                .seccion { 
                    margin-bottom: 12px; 
                    page-break-inside: avoid;
                }
                .seccion h2 { 
                    background: #333; 
                    color: white; 
                    padding: 4px 6px; 
                    margin: 0 0 6px 0; 
                    font-size: 12px;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    margin-bottom: 6px;
                    font-size: 10px;
                }
                th, td { 
                    border: 1px solid #ddd; 
                    padding: 3px 4px; 
                    text-align: left;
                }
                th { 
                    background: #f0f0f0; 
                    font-weight: bold;
                    font-size: 10px;
                }
                .stock-anterior-header {
                    background: #ff9800 !important;
                    color: white !important;
                    font-weight: bold;
                }
                .stock-anterior-cell {
                    background: #fff3e0;
                    font-weight: bold;
                    font-size: 10px;
                }
                .receta-detalle { 
                    margin-left: 15px; 
                    margin-top: 5px;
                    background: #fafafa;
                    padding: 6px;
                    border-left: 2px solid #007bff;
                }
                .no-data { 
                    text-align: center; 
                    color: #666; 
                    font-style: italic; 
                    padding: 10px;
                    font-size: 10px;
                }
                /* 🎯 NUEVAS CLASES PARA VISIBILIDAD CRÍTICA */
                .font-x2 {
                    font-size: 20px !important;
                    line-height: 1.1;
                }
                .font-x2-bold {
                    font-size: 20px !important;
                    font-weight: bold;
                    line-height: 1.1;
                }
                /* Optimización de espacio para compensar fuentes grandes */
                td { padding-top: 2px; padding-bottom: 2px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>${tituloOrden}</h1>
                ${tipoCarro === 'externa' ? '<p style="margin: 5px 0 0 0; font-size: 11px; color: #666;">Producción realizada fuera del taller</p>' : ''}
            </div>
            
            <div class="info-carro">
                <strong>Carro ID:</strong> ${carroId}<br>
                <strong>Tipo:</strong> ${tipoCarro === 'externa' ? '🚚 Producción Externa' : '🏭 Producción Interna'}<br>
                <strong>Operario:</strong> ${operario?.nombre_completo || 'No disponible'}<br>
                <strong>Fecha y Hora:</strong> ${fechaFormateada}
            </div>

            ${tipoCarro === 'externa' && articulosExternos && articulosExternos.length > 0 ? `
                <div class="seccion">
                    <h2>📦 INSUMOS A RETIRAR DEL DEPÓSITO</h2>
                    <p style="margin: 0 0 8px 0; font-size: 10px; color: #666;">
                        <em>Artículos intermedios que el operario retira del depósito para llevar a producción externa</em>
                    </p>
                    <table>
                        <thead>
                            <tr>
                                <th>Código</th>
                                <th>Artículo</th>
                                <th>Cantidad</th>
                                <th>Stock Disponible</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${articulosExternos.map(art => `
                                <tr>
                                    <td>${art.articulo_numero}</td>
                                    <td>${art.nombre || 'Sin descripción'}</td>
                                    <td style="text-align: center; font-weight: bold;">${parseFloat(art.cantidad_total || 0).toFixed(2)}</td>
                                    <td style="text-align: center; ${parseFloat(art.stock_actual || 0) > 0 ? 'color: #28a745;' : 'color: #dc3545;'} font-weight: bold;">
                                        ${parseFloat(art.stock_actual || 0).toFixed(2)}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}

            <div class="seccion">
                <h2>🧾 ARTÍCULOS A PRODUCIR</h2>
                ${tipoCarro === 'externa' ? '<p style="margin: 0 0 8px 0; font-size: 10px; color: #666;"><em>Productos finales que se fabricarán con los insumos retirados</em></p>' : ''}
                ${articulos.length > 0 ? `
                    <table>
                        <thead>
                            <tr>
                                <th>Código</th>
                                <th>Descripción</th>
                                <th>Cantidad</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${articulos.map(art => `
                                <tr>
                                    <td>${art.articulo_numero}</td>
                                    <td>${art.descripcion}</td>
                                    <td>${art.cantidad}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : '<div class="no-data">No hay artículos en el carro</div>'}
            </div>

            <div class="seccion">
                <h2>🥣 RECETAS DE MIXES</h2>
                ${mixes.length > 0 ? mixes.map(mix => {
        const cantidadTotal = parseFloat(mix.cantidad_total);
        const recetaBase = parseFloat(mix.receta_base_kg);

        // Calcular si hay resto (cantidad que no es múltiplo de la receta base)
        const resto = cantidadTotal % recetaBase;
        const tieneResto = resto > 0.01; // Tolerancia para decimales
        const esMenorQueBase = cantidadTotal < recetaBase;

        console.log(`📊 Mix ${mix.nombre_mix}:`);
        console.log(`- Cantidad total: ${cantidadTotal} kg`);
        console.log(`- Receta base: ${recetaBase} kg`);
        console.log(`- Resto: ${resto} kg`);
        console.log(`- ¿Es menor que base?: ${esMenorQueBase}`);
        console.log(`- ¿Tiene resto?: ${tieneResto}`);

        return `
                    <div style="margin-bottom: 12px;">
                        <strong>${mix.nombre_mix}</strong> (Cantidad a producir: ${cantidadTotal} kg)
                        
                        ${esMenorQueBase ? `
                            <br><em>Receta calculada para ${cantidadTotal} kg:</em>
                            <div class="receta-detalle" style="margin-top: 5px; padding: 6px;">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Ingrediente</th>
                                            <th>Cantidad</th>
                                            <th>Acumulado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${mix.ingredientes.map((ing, index, arr) => {
            const proporcion = cantidadTotal / recetaBase;
            const cantidadCalculada = parseFloat(ing.cantidad_total || 0) * proporcion;
            const acumulado = arr
                .slice(0, index + 1)
                .reduce((sum, i) => sum + (parseFloat(i.cantidad_total || 0) * proporcion), 0);
            return `
                                                <tr>
                                                    <td>${ing.nombre_ingrediente}</td>
                                                    <td class="font-x2" style="text-align: center;">${cantidadCalculada.toFixed(2)}</td>
                                                    <td class="font-x2-bold" style="text-align: center;">${acumulado.toFixed(2)}</td>
                                                </tr>
                                            `;
        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : `
                            <br><em>Receta base para ${recetaBase} kg:</em>
                            <div class="receta-detalle" style="margin-top: 5px; padding: 6px;">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Ingrediente</th>
                                            <th>Cantidad</th>
                                            <th>Acumulado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${mix.ingredientes.map((ing, index, arr) => {
            const acumulado = arr
                .slice(0, index + 1)
                .reduce((sum, i) => sum + parseFloat(i.cantidad_total || 0), 0);
            return `
                                                <tr>
                                                    <td>${ing.nombre_ingrediente}</td>
                                                    <td class="font-x2" style="text-align: center;">${parseFloat(ing.cantidad_total || 0).toFixed(2)}</td>
                                                    <td class="font-x2-bold" style="text-align: center;">${acumulado.toFixed(2)}</td>
                                                </tr>
                                            `;
        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                            
                            ${tieneResto ? `
                                <div style="margin-top: 8px; padding: 6px; background: #fff3cd; border-left: 3px solid #ffc107;">
                                    <strong style="color: #856404; font-size: 11px;">⚠️ RESTO: ${resto.toFixed(2)} kg</strong>
                                    <br><em style="font-size: 10px; color: #856404;">Receta para los ${resto.toFixed(2)} kg restantes:</em>
                                    <div style="margin-top: 4px;">
                                        <table style="background: white;">
                                            <thead>
                                                <tr style="background: #ffc107;">
                                                    <th style="color: #000;">Ingrediente</th>
                                                    <th style="color: #000;">Cantidad</th>
                                                    <th style="color: #000;">Acumulado</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${mix.ingredientes.map((ing, index, arr) => {
            const proporcion = resto / recetaBase;
            const cantidadResto = parseFloat(ing.cantidad_total || 0) * proporcion;
            const acumuladoResto = arr
                .slice(0, index + 1)
                .reduce((sum, i) => sum + (parseFloat(i.cantidad_total || 0) * proporcion), 0);
            return `
                                                        <tr>
                                                            <td>${ing.nombre_ingrediente}</td>
                                                            <td class="font-x2" style="text-align: center;">${cantidadResto.toFixed(2)}</td>
                                                            <td class="font-x2-bold" style="text-align: center;">${acumuladoResto.toFixed(2)}</td>
                                                        </tr>
                                                    `;
        }).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p style="margin: 4px 0 0 0; font-size: 9px; color: #856404; font-style: italic;">
                                        💡 Después de las tandas de ${recetaBase}kg, usar esta tabla para los ${resto.toFixed(2)}kg restantes.
                                    </p>
                                </div>
                            ` : ''}
                        `}
                    </div>
                    `;
    }).join('') : '<div class="no-data">No hay mixes en este carro</div>'}
            </div>

            ${(() => {
            // 🎯 SECCIÓN DE INGREDIENTES NECESARIOS (con stock personal para externos)
            let htmlIngredientes = '';

            if (resumenIngredientes && resumenIngredientes.length > 0) {
                // Separar ingredientes según si son de artículos vinculados o no
                const ingredientesPersonales = resumenIngredientes.filter(ing => !ing.es_de_articulo_vinculado);
                const ingredientesLocales = resumenIngredientes.filter(ing => ing.es_de_articulo_vinculado);

                if (tipoCarro === 'externa') {
                    // 🚚 CARRO EXTERNO: Mostrar stock personal del operario
                    if (ingredientesPersonales.length > 0) {
                        htmlIngredientes += `
                            <div class="seccion">
                                <h2>🏠 INGREDIENTES PERSONALES DEL OPERARIO</h2>
                                <p style="margin: 0 0 8px 0; font-size: 10px; color: #666;">
                                    <em>Ingredientes que el operario gestiona en su stock personal (casa)</em>
                                </p>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Ingrediente</th>
                                            <th>Cantidad Necesaria</th>
                                            <th style="background: #e3f2fd;">Stock Actual (Operador)</th>
                                            <th>Estado</th>
                                            <th>Unidad</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${ingredientesPersonales.map(ing => {
                            const cantidadNecesaria = parseFloat(ing.cantidad || 0);
                            const stockActual = parseFloat(ing.stock_actual || 0);
                            const diferencia = stockActual - cantidadNecesaria;
                            const tieneStock = diferencia >= -0.01;
                            const faltante = tieneStock ? 0 : Math.abs(diferencia);

                            return `
                                            <tr>
                                                <td><strong>${ing.nombre || 'Sin nombre'}</strong></td>
                                                <td style="text-align: center;">${cantidadNecesaria.toFixed(2)}</td>
                                                <td style="text-align: center; background: #e3f2fd; font-weight: bold; ${tieneStock ? 'color: #28a745;' : 'color: #dc3545;'}">
                                                    ${stockActual.toFixed(2)}
                                                </td>
                                                <td style="text-align: center; ${tieneStock ? 'color: #28a745;' : 'color: #dc3545;'}">
                                                    ${tieneStock ? '✅ Suficiente' : `❌ Faltan ${faltante.toFixed(2)}`}
                                                </td>
                                                <td style="text-align: center;">${ing.unidad_medida || ''}</td>
                                            </tr>
                                            `;
                        }).join('')}
                                    </tbody>
                                </table>
                                <p style="margin-top: 8px; font-size: 10px; color: #666; font-style: italic;">
                                    💡 <strong>Nota:</strong> El "Stock Actual (Operador)" muestra lo que el sistema registra que tiene en su casa.
                                </p>
                            </div>
                            `;
                    }

                    if (ingredientesLocales.length > 0) {
                        htmlIngredientes += `
                            <div class="seccion">
                                <h2>🏭 INGREDIENTES LOCALES DEL TALLER (TRAZABILIDAD)</h2>
                                <p style="margin: 0 0 8px 0; font-size: 10px; color: #666;">
                                    <em>Ingredientes que se usarán al volver al taller (stock del depósito)</em>
                                </p>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Ingrediente</th>
                                            <th style="text-align: center; background: #e3f2fd;">Stock Inicial</th>
                                            <th style="text-align: center; background: #fff3e0;">Gestión Manual</th>
                                            <th style="text-align: center;">Resultado Final</th>
                                            <th style="text-align: center;">Unidad</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${ingredientesLocales.map(ing => {
                            // Calcular desglose de origen para locales
                            const manuales = ingresos ? ingresos.filter(m => m.ingrediente_id === ing.id) : [];
                            const totalManual = manuales.reduce((sum, m) => sum + parseFloat(m.kilos_totales || 0), 0);
                            const cantidadTotal = parseFloat(ing.cantidad || 0);

                            // El stock inicial (sistema) es la diferencia entre lo usado y lo agregado manualmente
                            const stockInicial = Math.max(0, cantidadTotal - totalManual);

                            return `
                                            <tr>
                                                <td><strong>${ing.nombre || 'Sin nombre'}</strong></td>
                                                <td style="text-align: center; background: #e3f2fd;">${stockInicial.toFixed(2)}</td>
                                                <td style="text-align: center; background: #fff3e0;">${totalManual > 0 ? totalManual.toFixed(2) : '-'}</td>
                                                <td style="text-align: center; font-weight: bold;">${cantidadTotal.toFixed(2)}</td>
                                                <td style="text-align: center;">${ing.unidad_medida || ''}</td>
                                            </tr>
                                            `;
                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                            `;
                    }
                } else if (false) {
                    htmlIngredientes += `
                        <div class="seccion">
                            <h2>🌿 TRAZABILIDAD DE INGREDIENTES</h2>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Ingrediente</th>
                                        <th style="text-align: center; background: #e3f2fd;">Stock Anterior</th>
                                        <th style="text-align: center; background: #fff3e0;">Gestión Manual</th>
                                        <th style="text-align: center;">Requerido</th>
                                        <th style="text-align: center; background: #f5f5f5;">Nuevo Stock</th>
                                        <th style="text-align: center;">Unidad</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${resumenIngredientes.map(ing => {
                        // Calcular desglose de origen
                        const manuales = ingresos ? ingresos.filter(m => m.ingrediente_id === ing.id) : [];
                        const totalManual = manuales.reduce((sum, m) => sum + parseFloat(m.kilos_totales || 0), 0);
                        const cantidadRequerida = parseFloat(ing.cantidad || 0);

                        // LÓGICA DE TRAZABILIDAD REVERSA (SOLICITADA POR USUARIO)
                        // 🧮 LÓGICA ROBUSTA BASADA EN SNAPSHOT (FWD CALCULATION)
                        // Igual que en frontend
                        const stockDisponibleSnapshot = parseFloat(ing.stock_snapshot || ing.stock_actual || 0);

                        // 3. Stock Anterior (Lo que había antes de meter mano)
                        // Formula: Snapshot - Manual
                        const stockAnterior = stockDisponibleSnapshot - totalManual;

                        // 4. Stock Nuevo (Lo que quedó después de consumir)
                        // Formula: Snapshot - Requerido
                        const stockNuevo = stockDisponibleSnapshot - cantidadRequerida;

                        // Estilo para alertas
                        const stockAnteriorInsuficiente = stockAnterior < cantidadRequerida;
                        // Si era insuficiente, lo mostramos en rojo (a menos que haya ingresado manual para cubrirlo)
                        const colorStockAnterior = stockAnterior < 0 ? '#dc3545' : '#000';

                        return `
                                        <tr>
                                            <td><strong>${ing.nombre || 'Sin nombre'}</strong></td>
                                            <td style="text-align: center; background: #e3f2fd; color: ${colorStockAnterior};">
                                                ${stockAnterior.toFixed(2)}
                                            </td>
                                            <td style="text-align: center; background: #fff3e0;">
                                                ${totalManual > 0 ? `+${totalManual.toFixed(2)}` : '-'}
                                            </td>
                                            <td style="text-align: center;">${cantidadRequerida.toFixed(2)}</td>
                                            <td style="text-align: center; background: #f5f5f5; font-weight: bold;">
                                                ${stockNuevo.toFixed(2)}
                                            </td>
                                            <td style="text-align: center;">${ing.unidad_medida || ''}</td>
                                        </tr>
                                        `;
                    }).join('')}
                                </tbody>
                            </table>
                            <p style="margin-top: 5px; font-size: 9px; color: #666; font-style: italic;">
                                * <strong>Stock Anterior:</strong> Existencia en sistema al momento de iniciar.<br>
                                * <strong>Gestión Manual:</strong> Bultos/Kilos agregados por operario.<br>
                                * <strong>Requerido:</strong> Consumo total de la receta.<br>
                                * <strong>Nuevo Stock:</strong> Resultado (Anterior + Manual - Requerido).
                            </p>
                        </div>
                        `;
                }
            }

            return htmlIngredientes;
        })()}

            ${(() => {
            // Separar ingresos en dos categorías
            const ingresosArticulos = ingresos.filter(ing => ing.tipo_articulo !== 'sustitucion');
            const sustitucionesIngredientes = ingresos.filter(ing => ing.tipo_articulo === 'sustitucion');

            console.log('📊 Separación de ingresos para PDF:');
            console.log(`- Artículos: ${ingresosArticulos.length}`);
            console.log(`- Sustituciones: ${sustitucionesIngredientes.length}`);

            let html = '';

            // SECCIÓN A: INSUMOS / BULTOS AGREGADOS (Artículos)
            if (ingresosArticulos.length > 0) {
                html += `
                    <div class="seccion">
                        <h2>📦 INSUMOS / BULTOS AGREGADOS</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>Artículo</th>
                                    <th>Kilos</th>
                                    <th class="stock-anterior-header">⚠️ Stock Anterior</th>
                                    <th>Stock Nuevo</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${ingresosArticulos.map(ing => {
                    let stockAnterior = 0;
                    let stockNuevo = 0;
                    let ingresoManual = parseFloat(ing.kilos_totales || 0);

                    if (ing.ingrediente_id && resumenIngredientes) {
                        const ingredienteResumen = resumenIngredientes.find(ri => ri.id === ing.ingrediente_id);
                        if (ingredienteResumen) {
                            // 🧮 LÓGICA CORREGIDA (SNAPSHOT)
                            // Stock Nuevo = Snapshot (Stock disponible para producción)
                            const stockSnapshot = parseFloat(ingredienteResumen.stock_snapshot || ingredienteResumen.stock_actual || 0);
                            stockNuevo = stockSnapshot;

                            // Stock Anterior = Snapshot - Manual
                            stockAnterior = stockNuevo - ingresoManual;
                        }
                    }

                    return `
                                    <tr>
                                        <td>${ing.articulo_descripcion}</td>
                                        <td>${ingresoManual.toFixed(2)}</td>
                                        <td class="stock-anterior-cell font-x2-bold">${stockAnterior.toFixed(2)}</td>
                                        <td>${stockNuevo.toFixed(2)}</td>
                                    </tr>
                                    `;
                }).join('')}
                            </tbody>
                        </table>
                    </div>
                    `;
            }

            // SECCIÓN B: SUSTITUCIONES Y REFUERZOS (Ingredientes)
            if (sustitucionesIngredientes.length > 0) {
                console.log('\n🔍 DEBUG PDF - SUSTITUCIONES:');
                console.log('==========================================');
                console.log('Total de sustituciones:', sustitucionesIngredientes.length);
                sustitucionesIngredientes.forEach((sust, index) => {
                    console.log(`\nSustitución ${index + 1}:`);
                    console.log('- Datos completos:', sust);
                    console.log('- articulo_descripcion:', sust.articulo_descripcion);
                    console.log('- ingrediente_nombre:', sust.ingrediente_nombre);
                    console.log('- kilos_totales:', sust.kilos_totales);
                    console.log('- observaciones:', sust.observaciones);
                    console.log('- ingrediente_destino_nombre:', sust.ingrediente_destino_nombre);
                });
                console.log('==========================================\n');

                html += `
                    <div class="seccion">
                        <h2>🌾 SUSTITUCIONES Y REFUERZOS</h2>
                        <p style="margin: 0 0 10px 0; font-size: 11px; color: #666;">
                            <em>Ingredientes utilizados para cubrir faltantes de otros ingredientes en las recetas</em>
                        </p>
                        <table>
                            <thead>
                                <tr>
                                    <th>Ingrediente Utilizado</th>
                                    <th>Cantidad (kg)</th>
                                    <th>Asignado a / Cubre</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sustitucionesIngredientes.map(sust => {
                    const cantidad = parseFloat(sust.kilos_totales || 0);
                    const ingredienteOrigen = sust.articulo_descripcion || sust.ingrediente_nombre || 'Ingrediente sin nombre';

                    console.log(`\n🔍 Procesando sustitución para PDF:`);
                    console.log(`- Ingrediente origen: "${ingredienteOrigen}"`);
                    console.log(`- Cantidad: ${cantidad}`);
                    console.log(`- Observaciones: "${sust.observaciones}"`);

                    // Extraer el nombre del ingrediente destino de las observaciones
                    // Formato esperado: "SUSTITUCIÓN: Usado para cubrir [Nombre] (ID: X)"
                    let ingredienteDestino = 'No especificado';

                    if (sust.observaciones) {
                        // Intentar extraer del texto de observaciones
                        const match = sust.observaciones.match(/cubrir\s+(.+?)\s+\(ID:/i);
                        if (match && match[1]) {
                            ingredienteDestino = match[1].trim();
                            console.log(`✅ Destino extraído: "${ingredienteDestino}"`);
                        } else {
                            console.log(`⚠️ No se pudo extraer destino del texto: "${sust.observaciones}"`);
                        }
                    }

                    return `
                                    <tr>
                                        <td><strong>${ingredienteOrigen}</strong></td>
                                        <td style="text-align: center; font-weight: bold;">${cantidad.toFixed(2)}</td>
                                        <td style="background: #e3f2fd; font-style: italic;">→ ${ingredienteDestino}</td>
                                    </tr>
                                    `;
                }).join('')}
                            </tbody>
                        </table>
                        <p style="margin-top: 10px; font-size: 10px; color: #666; font-style: italic;">
                            💡 <strong>Instrucción:</strong> Buscar la bolsa del "Ingrediente Utilizado", pesar la cantidad indicada 
                            y agregarlo junto con el ingrediente que está cubriendo en la receta.
                        </p>
                    </div>
                    `;
            }

            // Si no hay ningún ingreso
            if (ingresosArticulos.length === 0 && sustitucionesIngredientes.length === 0) {
                html += '<div class="no-data">No se realizaron ingresos manuales ni sustituciones</div>';
            }

            return html;
        })()}
        </body>
        </html>
    `;
}

// Función para imprimir HTML directamente
async function imprimirHTML(html) {
    // Crear ventana oculta para imprimir
    const ventanaImpresion = window.open('', '_blank', 'width=1,height=1');

    if (!ventanaImpresion) {
        throw new Error('No se pudo abrir ventana de impresión. Verifique que no esté bloqueada por el navegador.');
    }

    try {
        ventanaImpresion.document.write(html);
        ventanaImpresion.document.close();

        // Esperar a que se cargue el contenido
        await new Promise(resolve => {
            ventanaImpresion.onload = resolve;
            setTimeout(resolve, 1000); // Fallback
        });

        // Imprimir y cerrar
        ventanaImpresion.print();
        ventanaImpresion.close();

    } catch (error) {
        ventanaImpresion.close();
        throw error;
    }
}

// Hacer la función disponible globalmente
window.imprimirOrdenProduccion = imprimirOrdenProduccion;
