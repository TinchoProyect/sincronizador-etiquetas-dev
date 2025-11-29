// Función para imprimir orden de producción
export async function imprimirOrdenProduccion() {
    const carroId = localStorage.getItem('carroActivo');
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

        // Obtener datos del carro usando consultas directas a las tablas
        const [articulosData, operarioData, ingresosData, mixesData, resumenIngredientesData] = await Promise.all([
            obtenerArticulosCarro(carroId),
            obtenerOperario(colaborador.id),
            obtenerIngresosManuales(carroId),
            obtenerRecetasMixes(carroId),
            obtenerResumenIngredientes(carroId, colaborador.id)
        ]);

        console.log('📋 Artículos obtenidos:', articulosData);
        console.log('👤 Operario obtenido:', operarioData);
        console.log('📦 Ingresos manuales obtenidos:', ingresosData);
        console.log('🧪 Mixes obtenidos:', mixesData);
        console.log('🌿 Resumen de ingredientes obtenido:', resumenIngredientesData);

        // Generar HTML de la orden
        const htmlOrden = generarHTMLOrden({
            carroId,
            operario: operarioData,
            articulos: articulosData,
            mixes: mixesData,
            ingresos: ingresosData,
            resumenIngredientes: resumenIngredientesData,
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

// Función para obtener el resumen de ingredientes
async function obtenerResumenIngredientes(carroId, usuarioId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingredientes?usuarioId=${usuarioId}`);
        if (!response.ok) {
            throw new Error('No se pudo obtener el resumen de ingredientes');
        }
        return await response.json();
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

// Función para generar HTML de la orden
function generarHTMLOrden({ carroId, operario, articulos, mixes, ingresos, resumenIngredientes, fecha }) {
    // 🔍 DEBUGGING STOCK REPORTE
    console.log("🔍 DEBUGGING STOCK REPORTE:");
    console.log("1. Resumen Ingredientes (Data Cruda):", resumenIngredientes);
    console.log("2. Ingresos Manuales (Data Cruda):", ingresos);
    
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

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Orden de Producción - Carro ${carroId}</title>
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
            </style>
        </head>
        <body>
            <div class="header">
                <h1>ORDEN DE PRODUCCIÓN</h1>
            </div>
            
            <div class="info-carro">
                <strong>Carro ID:</strong> ${carroId}<br>
                <strong>Operario:</strong> ${operario?.nombre_completo || 'No disponible'}<br>
                <strong>Fecha y Hora:</strong> ${fechaFormateada}
            </div>

            <div class="seccion">
                <h2>🧾 ARTÍCULOS A PRODUCIR</h2>
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
                                                    <td>${cantidadCalculada.toFixed(2)}</td>
                                                    <td><strong>${acumulado.toFixed(2)}</strong></td>
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
                                                    <td>${parseFloat(ing.cantidad_total || 0).toFixed(2)}</td>
                                                    <td><strong>${acumulado.toFixed(2)}</strong></td>
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
                                                            <td>${cantidadResto.toFixed(2)}</td>
                                                            <td><strong>${acumuladoResto.toFixed(2)}</strong></td>
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
                                            const stockSaldoNeto = parseFloat(ingredienteResumen.stock_actual || 0);
                                            const consumoProduccion = parseFloat(ingredienteResumen.cantidad || 0);
                                            stockNuevo = stockSaldoNeto + consumoProduccion;
                                            stockAnterior = stockNuevo - ingresoManual;
                                        }
                                    }

                                    return `
                                    <tr>
                                        <td>${ing.articulo_descripcion}</td>
                                        <td>${ingresoManual.toFixed(2)}</td>
                                        <td class="stock-anterior-cell">${stockAnterior.toFixed(2)}</td>
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
