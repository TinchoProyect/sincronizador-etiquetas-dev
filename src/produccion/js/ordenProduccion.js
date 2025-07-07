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
        const [articulosData, operarioData, ingresosData, mixesData] = await Promise.all([
            obtenerArticulosCarro(carroId),
            obtenerOperario(colaborador.id),
            obtenerIngresosManuales(carroId),
            obtenerRecetasMixes(carroId)
        ]);

        console.log('📋 Artículos obtenidos:', articulosData);
        console.log('👤 Operario obtenido:', operarioData);
        console.log('📦 Ingresos manuales obtenidos:', ingresosData);
        console.log('🧪 Mixes obtenidos:', mixesData);

        // Generar HTML de la orden
        const htmlOrden = generarHTMLOrden({
            carroId,
            operario: operarioData,
            articulos: articulosData,
            mixes: mixesData,
            ingresos: ingresosData,
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
            articulo_descripcion: ingreso.articulo_nombre || ingreso.articuloNombre || 'Artículo sin nombre',
            articulo_numero: ingreso.articulo_numero || ingreso.articuloNumero || '',
            codigo_barras: ingreso.codigo_barras || ingreso.codigoBarras || '',
            kilos_totales: parseFloat(ingreso.kilos || ingreso.kilosTotales || 0),
            cantidad_total: parseFloat(ingreso.cantidad || ingreso.cantidadUnidades || 0),
            tipo_articulo: ingreso.tipo_articulo || 'simple',
            fuente_datos: ingreso.fuente_datos || 'backend',
            fecha: ingreso.fecha || ingreso.fechaIngreso || new Date().toISOString()
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
function generarHTMLOrden({ carroId, operario, articulos, mixes, ingresos, fecha }) {
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
                @page { margin: 20mm; }
                body { 
                    font-family: Arial, sans-serif; 
                    font-size: 12px; 
                    line-height: 1.4;
                    margin: 0;
                    padding: 0;
                }
                .header { 
                    text-align: center; 
                    border-bottom: 2px solid #000; 
                    padding-bottom: 10px; 
                    margin-bottom: 20px;
                }
                .header h1 { 
                    margin: 0; 
                    font-size: 18px; 
                    font-weight: bold;
                }
                .info-carro { 
                    margin-bottom: 20px; 
                    background: #f5f5f5; 
                    padding: 10px; 
                    border-radius: 5px;
                }
                .seccion { 
                    margin-bottom: 25px; 
                    page-break-inside: avoid;
                }
                .seccion h2 { 
                    background: #333; 
                    color: white; 
                    padding: 8px; 
                    margin: 0 0 10px 0; 
                    font-size: 14px;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    margin-bottom: 10px;
                }
                th, td { 
                    border: 1px solid #ddd; 
                    padding: 6px; 
                    text-align: left;
                }
                th { 
                    background: #f0f0f0; 
                    font-weight: bold;
                }
                .receta-detalle { 
                    margin-left: 20px; 
                    margin-top: 10px;
                    background: #fafafa;
                    padding: 10px;
                    border-left: 3px solid #007bff;
                }
                .no-data { 
                    text-align: center; 
                    color: #666; 
                    font-style: italic; 
                    padding: 20px;
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
                ${mixes.length > 0 ? mixes.map(mix => `
                    <div style="margin-bottom: 20px;">
                        <strong>${mix.nombre_mix}</strong> (Cantidad a producir: ${mix.cantidad_total} kg)
                        <br><em>Receta base para ${mix.receta_base_kg} kg:</em>
                        <div class="receta-detalle">
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
                                        // Calcular el acumulado sumando este ingrediente y todos los anteriores
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
                    </div>
                `).join('') : '<div class="no-data">No hay mixes en este carro</div>'}
            </div>

            <div class="seccion">
                <h2>📦 INGRESOS MANUALES REALIZADOS</h2>
                ${ingresos.length > 0 ? `
                    <table>
                        <thead>
                            <tr>
                                <th>Artículo</th>
                                <th>Kilos Totales</th>
                                <th>Stock Anterior</th>
                                <th>Stock Nuevo</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ingresos.map(ing => `
                                <tr>
                                    <td>${ing.articulo_descripcion}</td>
                                    <td>${parseFloat(ing.kilos_totales || 0).toFixed(2)}</td>
                                    <td>${parseFloat(ing.stock_anterior || 0).toFixed(2)}</td>
                                    <td>${parseFloat(ing.stock_nuevo || 0).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : '<div class="no-data">No se realizaron ingresos manuales</div>'}
            </div>
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
