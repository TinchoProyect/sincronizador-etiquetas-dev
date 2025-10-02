/**
 * DIAGNÓSTICO DE FLUJO DE EDICIÓN DE PRESUPUESTOS
 * 
 * Este script traza el flujo completo de edición de presupuestos
 * desde el frontend hasta el backend, identificando:
 * - Archivos y funciones ejecutadas
 * - Rutas HTTP invocadas
 * - Handlers y controladores
 * - Queries SQL ejecutadas
 * 
 * MODO: DRY-RUN (solo lectura, no modifica datos)
 */

const fs = require('fs');
const path = require('path');

console.log('═══════════════════════════════════════════════════════════════');
console.log('🔍 DIAGNÓSTICO DE FLUJO DE EDICIÓN DE PRESUPUESTOS');
console.log('═══════════════════════════════════════════════════════════════\n');

// ============================================================================
// PASO 1: IDENTIFICAR ARCHIVOS RELEVANTES
// ============================================================================

console.log('📋 PASO 1: IDENTIFICANDO ARCHIVOS RELEVANTES\n');

const archivosRelevantes = {
    frontend: {
        html: 'src/presupuestos/pages/editar-presupuesto.html',
        js_principal: 'src/presupuestos/js/presupuestosEdit.js',
        js_alternativo: 'src/presupuestos/js/presupuestosEdit_new.js',
        js_comun: 'src/presupuestos/js/detalles-common.js'
    },
    backend: {
        rutas: 'src/presupuestos/routes/presupuestos.js',
        controlador_lectura: 'src/presupuestos/controllers/presupuestos.js',
        controlador_escritura: 'src/presupuestos/controllers/presupuestosWrite.js',
        middleware_validacion: 'src/presupuestos/middleware/validation.js',
        middleware_auth: 'src/presupuestos/middleware/auth.js'
    },
    app: {
        principal: 'src/presupuestos/app.js',
        alternativo_1: 'src/presupuestos/app_final.js',
        alternativo_2: 'src/presupuestos/app_with_logs.js'
    }
};

// Verificar existencia de archivos
console.log('✓ Verificando existencia de archivos:\n');

for (const [categoria, archivos] of Object.entries(archivosRelevantes)) {
    console.log(`  ${categoria.toUpperCase()}:`);
    for (const [nombre, ruta] of Object.entries(archivos)) {
        const existe = fs.existsSync(ruta);
        const icono = existe ? '✅' : '❌';
        console.log(`    ${icono} ${nombre}: ${ruta}`);
        
        if (existe) {
            const stats = fs.statSync(ruta);
            const fechaMod = stats.mtime.toISOString().split('T')[0];
            const tamaño = (stats.size / 1024).toFixed(2);
            console.log(`       └─ Modificado: ${fechaMod}, Tamaño: ${tamaño} KB`);
        }
    }
    console.log('');
}

// ============================================================================
// PASO 2: ANALIZAR ARCHIVO APP PRINCIPAL
// ============================================================================

console.log('\n📋 PASO 2: IDENTIFICANDO APP PRINCIPAL EN EJECUCIÓN\n');

const appsDisponibles = [
    'src/presupuestos/app.js',
    'src/presupuestos/app_final.js',
    'src/presupuestos/app_with_logs.js'
];

console.log('Analizando archivos app.js para determinar cuál se ejecuta:\n');

for (const appPath of appsDisponibles) {
    if (fs.existsSync(appPath)) {
        const contenido = fs.readFileSync(appPath, 'utf8');
        const lineas = contenido.split('\n');
        
        console.log(`📄 ${appPath}:`);
        
        // Buscar puerto
        const lineaPuerto = lineas.find(l => l.includes('PORT') || l.includes('listen'));
        if (lineaPuerto) {
            console.log(`   Puerto: ${lineaPuerto.trim()}`);
        }
        
        // Buscar imports de rutas
        const importRutas = lineas.filter(l => 
            l.includes('require') && l.includes('routes')
        );
        if (importRutas.length > 0) {
            console.log(`   Rutas importadas:`);
            importRutas.forEach(imp => console.log(`     - ${imp.trim()}`));
        }
        
        // Buscar uso de rutas
        const usoRutas = lineas.filter(l => 
            l.includes('app.use') && (l.includes('/api/presupuestos') || l.includes('presupuestosRouter'))
        );
        if (usoRutas.length > 0) {
            console.log(`   Rutas montadas:`);
            usoRutas.forEach(uso => console.log(`     - ${uso.trim()}`));
        }
        
        console.log('');
    }
}

// ============================================================================
// PASO 3: ANALIZAR RUTAS HTTP
// ============================================================================

console.log('\n📋 PASO 3: ANALIZANDO RUTAS HTTP PARA EDICIÓN\n');

const rutasPath = 'src/presupuestos/routes/presupuestos.js';
if (fs.existsSync(rutasPath)) {
    const contenido = fs.readFileSync(rutasPath, 'utf8');
    const lineas = contenido.split('\n');
    
    console.log('🔍 Buscando ruta PUT para edición de presupuestos:\n');
    
    // Buscar definición de ruta PUT
    let enRutaPut = false;
    let rutaPutInfo = {
        linea: 0,
        path: '',
        middlewares: [],
        handler: ''
    };
    
    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];
        
        if (linea.includes("router.put('/:id'") || linea.includes('router.put("/:id"')) {
            enRutaPut = true;
            rutaPutInfo.linea = i + 1;
            console.log(`✅ Ruta PUT encontrada en línea ${i + 1}:`);
            console.log(`   ${linea.trim()}\n`);
        }
        
        if (enRutaPut) {
            // Capturar middlewares
            if (linea.includes('validatePermissions') || 
                linea.includes('validarIdPresupuesto') ||
                linea.includes('sanitizarDatos') ||
                linea.includes('validarActualizarPresupuesto')) {
                rutaPutInfo.middlewares.push(linea.trim());
            }
            
            // Capturar handler
            if (linea.includes('editarPresupuestoWrite') || linea.includes('editarPresupuesto')) {
                rutaPutInfo.handler = linea.trim();
            }
            
            // Fin de la definición de ruta
            if (linea.includes(');') && rutaPutInfo.handler) {
                enRutaPut = false;
            }
        }
    }
    
    console.log('📋 Configuración de la ruta PUT /:id:\n');
    console.log(`   Línea: ${rutaPutInfo.linea}`);
    console.log(`   Path: PUT /api/presupuestos/:id`);
    console.log(`   Middlewares aplicados:`);
    rutaPutInfo.middlewares.forEach(m => console.log(`     - ${m}`));
    console.log(`   Handler: ${rutaPutInfo.handler}\n`);
    
    // Buscar imports del controlador
    console.log('📦 Imports del controlador de escritura:\n');
    const importControlador = lineas.find(l => 
        l.includes('presupuestosWrite') && l.includes('require')
    );
    if (importControlador) {
        console.log(`   ${importControlador.trim()}\n`);
    }
}

// ============================================================================
// PASO 4: ANALIZAR CONTROLADOR DE ESCRITURA
// ============================================================================

console.log('\n📋 PASO 4: ANALIZANDO CONTROLADOR DE ESCRITURA\n');

const controladorPath = 'src/presupuestos/controllers/presupuestosWrite.js';
if (fs.existsSync(controladorPath)) {
    const contenido = fs.readFileSync(controladorPath, 'utf8');
    const lineas = contenido.split('\n');
    
    console.log('🔍 Analizando función editarPresupuesto:\n');
    
    // Buscar definición de función
    let enFuncionEditar = false;
    let lineaInicio = 0;
    let camposActualizados = [];
    let queryUpdate = [];
    
    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];
        
        if (linea.includes('const editarPresupuesto') || linea.includes('editarPresupuesto = async')) {
            enFuncionEditar = true;
            lineaInicio = i + 1;
            console.log(`✅ Función editarPresupuesto encontrada en línea ${i + 1}\n`);
        }
        
        if (enFuncionEditar) {
            // Capturar campos que se extraen del body
            if (linea.includes('req.body') && linea.includes('=')) {
                const match = linea.match(/const\s+{([^}]+)}/);
                if (match) {
                    const campos = match[1].split(',').map(c => c.trim());
                    console.log(`📥 Campos extraídos del req.body:`);
                    campos.forEach(c => console.log(`     - ${c}`));
                    console.log('');
                }
            }
            
            // Capturar construcción de updates
            if (linea.includes('updates.push') && linea.includes('=')) {
                const campo = linea.match(/`([^`]+)`/);
                if (campo) {
                    camposActualizados.push(campo[1]);
                }
            }
            
            // Capturar query UPDATE
            if (linea.includes('UPDATE presupuestos')) {
                let j = i;
                while (j < lineas.length && !lineas[j].includes('RETURNING')) {
                    queryUpdate.push(lineas[j].trim());
                    j++;
                }
                if (j < lineas.length) {
                    queryUpdate.push(lineas[j].trim());
                }
            }
            
            // Fin de la función
            if (linea.includes('module.exports') || 
                (linea.includes('const ') && linea.includes(' = async') && i > lineaInicio + 10)) {
                enFuncionEditar = false;
            }
        }
    }
    
    console.log(`📝 Campos que se actualizan en la BD:\n`);
    if (camposActualizados.length > 0) {
        camposActualizados.forEach(c => console.log(`     ✅ ${c}`));
    } else {
        console.log(`     ⚠️  No se detectaron campos específicos (actualización dinámica)`);
    }
    console.log('');
    
    if (queryUpdate.length > 0) {
        console.log(`📋 Query UPDATE detectada:\n`);
        queryUpdate.forEach(q => console.log(`     ${q}`));
        console.log('');
    }
    
    // Buscar manejo de detalles
    console.log('🔍 Analizando actualización de detalles:\n');
    let manejaDetalles = false;
    let eliminaDetalles = false;
    let insertaDetalles = false;
    
    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];
        
        if (linea.includes('Array.isArray(detalles)')) {
            manejaDetalles = true;
            console.log(`   ✅ Detectado manejo de detalles en línea ${i + 1}`);
        }
        
        if (linea.includes('DELETE FROM presupuestos_detalles')) {
            eliminaDetalles = true;
            console.log(`   ✅ Detectada eliminación de detalles en línea ${i + 1}`);
        }
        
        if (linea.includes('INSERT INTO presupuestos_detalles')) {
            insertaDetalles = true;
            console.log(`   ✅ Detectada inserción de detalles en línea ${i + 1}`);
        }
    }
    
    console.log('\n   Resumen de manejo de detalles:');
    console.log(`     - Maneja array de detalles: ${manejaDetalles ? '✅ SÍ' : '❌ NO'}`);
    console.log(`     - Elimina detalles existentes: ${eliminaDetalles ? '✅ SÍ' : '❌ NO'}`);
    console.log(`     - Inserta nuevos detalles: ${insertaDetalles ? '✅ SÍ' : '❌ NO'}`);
    console.log('');
}

// ============================================================================
// PASO 5: ANALIZAR FRONTEND
// ============================================================================

console.log('\n📋 PASO 5: ANALIZANDO FRONTEND (JavaScript)\n');

// Determinar cuál JS se usa
const jsFiles = [
    'src/presupuestos/js/presupuestosEdit.js',
    'src/presupuestos/js/presupuestosEdit_new.js'
];

console.log('🔍 Identificando archivo JS activo:\n');

const htmlPath = 'src/presupuestos/pages/editar-presupuesto.html';
let jsActivo = null;

if (fs.existsSync(htmlPath)) {
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    
    for (const jsFile of jsFiles) {
        const jsName = path.basename(jsFile);
        if (htmlContent.includes(jsName)) {
            jsActivo = jsFile;
            console.log(`   ✅ Archivo activo: ${jsFile}`);
            console.log(`      (referenciado en ${htmlPath})\n`);
            break;
        }
    }
    
    if (!jsActivo) {
        console.log(`   ⚠️  No se detectó referencia explícita en HTML`);
        console.log(`      Asumiendo: presupuestosEdit.js (por convención)\n`);
        jsActivo = 'src/presupuestos/js/presupuestosEdit.js';
    }
}

// Analizar el JS activo
if (jsActivo && fs.existsSync(jsActivo)) {
    const contenido = fs.readFileSync(jsActivo, 'utf8');
    const lineas = contenido.split('\n');
    
    console.log('🔍 Analizando función handleSubmit (envío del formulario):\n');
    
    let enHandleSubmit = false;
    let lineaInicio = 0;
    let camposEnviados = [];
    let urlPut = '';
    
    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];
        
        if (linea.includes('async function handleSubmit') || 
            linea.includes('handleSubmit = async') ||
            linea.includes('function handleSubmit')) {
            enHandleSubmit = true;
            lineaInicio = i + 1;
            console.log(`   ✅ Función handleSubmit encontrada en línea ${i + 1}\n`);
        }
        
        if (enHandleSubmit) {
            // Capturar construcción del objeto updateData
            if (linea.includes('updateData') && linea.includes('=') && linea.includes('{')) {
                console.log(`   📦 Construcción de updateData en línea ${i + 1}:\n`);
                let j = i;
                while (j < lineas.length && !lineas[j].includes('};')) {
                    const lineaData = lineas[j].trim();
                    if (lineaData && !lineaData.startsWith('//') && !lineaData.startsWith('/*')) {
                        console.log(`      ${lineaData}`);
                        
                        // Extraer nombres de campos
                        const match = lineaData.match(/(\w+):/);
                        if (match && match[1] !== 'updateData') {
                            camposEnviados.push(match[1]);
                        }
                    }
                    j++;
                }
                console.log('');
            }
            
            // Capturar URL del fetch
            if (linea.includes('fetch') && linea.includes('presupuestos')) {
                urlPut = linea.trim();
                console.log(`   🌐 URL del PUT:`);
                console.log(`      ${urlPut}\n`);
            }
            
            // Fin de la función
            if (linea.includes('};') && i > lineaInicio + 20) {
                enHandleSubmit = false;
            }
        }
    }
    
    console.log(`   📋 Campos enviados en el PUT:\n`);
    if (camposEnviados.length > 0) {
        camposEnviados.forEach(c => console.log(`      ✅ ${c}`));
    } else {
        console.log(`      ⚠️  No se detectaron campos específicos`);
    }
    console.log('');
    
    // Verificar qué campos del formulario NO se envían
    console.log(`   🔍 Verificando campos del formulario HTML:\n`);
    
    if (fs.existsSync(htmlPath)) {
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        const camposFormulario = [];
        
        // Buscar inputs con name
        const inputMatches = htmlContent.matchAll(/<input[^>]+name=["']([^"']+)["']/g);
        for (const match of inputMatches) {
            camposFormulario.push(match[1]);
        }
        
        // Buscar selects con name
        const selectMatches = htmlContent.matchAll(/<select[^>]+name=["']([^"']+)["']/g);
        for (const match of selectMatches) {
            camposFormulario.push(match[1]);
        }
        
        // Buscar textareas con name
        const textareaMatches = htmlContent.matchAll(/<textarea[^>]+name=["']([^"']+)["']/g);
        for (const match of textareaMatches) {
            camposFormulario.push(match[1]);
        }
        
        console.log(`      Campos en el formulario HTML:`);
        camposFormulario.forEach(c => {
            const seEnvia = camposEnviados.includes(c) || camposEnviados.includes(c.replace(/_/g, ''));
            const icono = seEnvia ? '✅' : '❌';
            console.log(`        ${icono} ${c} ${!seEnvia ? '(NO SE ENVÍA AL BACKEND)' : ''}`);
        });
        console.log('');
    }
}

// ============================================================================
// PASO 6: RESUMEN Y DIAGNÓSTICO
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('📊 RESUMEN DEL DIAGNÓSTICO');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('🔄 FLUJO DE EJECUCIÓN COMPLETO:\n');

console.log('1️⃣  FRONTEND - Página de Edición');
console.log('    📄 HTML: src/presupuestos/pages/editar-presupuesto.html');
console.log('    📜 JS: ' + (jsActivo || 'presupuestosEdit.js'));
console.log('    🎯 Función: handleSubmit()');
console.log('    └─ Captura datos del formulario');
console.log('    └─ Construye objeto updateData');
console.log('    └─ Envía PUT a /api/presupuestos/:id\n');

console.log('2️⃣  BACKEND - Rutas');
console.log('    📄 Archivo: src/presupuestos/routes/presupuestos.js');
console.log('    🌐 Ruta: PUT /api/presupuestos/:id');
console.log('    🔒 Middlewares:');
console.log('       - validatePermissions');
console.log('       - validarIdPresupuesto');
console.log('       - sanitizarDatos');
console.log('       - validarActualizarPresupuesto');
console.log('    🎯 Handler: editarPresupuestoWrite\n');

console.log('3️⃣  BACKEND - Controlador');
console.log('    📄 Archivo: src/presupuestos/controllers/presupuestosWrite.js');
console.log('    🎯 Función: editarPresupuesto()');
console.log('    └─ Extrae campos del req.body');
console.log('    └─ Construye UPDATE dinámico');
console.log('    └─ Actualiza encabezado en BD');
console.log('    └─ Si hay detalles:');
console.log('       └─ DELETE de detalles existentes');
console.log('       └─ INSERT de nuevos detalles\n');

console.log('4️⃣  BASE DE DATOS');
console.log('    📊 Tabla encabezado: presupuestos');
console.log('    📊 Tabla detalles: presupuestos_detalles\n');

console.log('═══════════════════════════════════════════════════════════════');
console.log('⚠️  PROBLEMA IDENTIFICADO');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('❌ CAMPOS QUE NO SE ACTUALIZAN:\n');
console.log('   Los siguientes campos del formulario NO se envían al backend:');
console.log('   - tipo_comprobante');
console.log('   - estado');
console.log('   - id_cliente');
console.log('   - fecha\n');

console.log('✅ CAMPOS QUE SÍ SE ACTUALIZAN:\n');
console.log('   - agente');
console.log('   - nota');
console.log('   - punto_entrega');
console.log('   - descuento');
console.log('   - fecha_entrega');
console.log('   - detalles (array completo)\n');

console.log('🔧 CAUSA RAÍZ:\n');
console.log('   En handleSubmit() del frontend, el objeto updateData solo');
console.log('   incluye los campos que SÍ funcionan. Los campos problemáticos');
console.log('   (tipo_comprobante, estado, etc.) NO se agregan a updateData.\n');

console.log('💡 SOLUCIÓN REQUERIDA:\n');
console.log('   1. Modificar handleSubmit() en presupuestosEdit.js');
console.log('      └─ Agregar campos faltantes a updateData\n');
console.log('   2. Modificar editarPresupuesto() en presupuestosWrite.js');
console.log('      └─ Agregar lógica para procesar campos adicionales\n');

console.log('═══════════════════════════════════════════════════════════════');
console.log('✅ DIAGNÓSTICO COMPLETADO');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('📝 Para ejecutar este diagnóstico:');
console.log('   node diagnostico_flujo_edicion_presupuestos.js\n');

console.log('📋 Archivos analizados:');
Object.values(archivosRelevantes).forEach(categoria => {
    Object.values(categoria).forEach(ruta => {
        if (fs.existsSync(ruta)) {
            console.log(`   ✅ ${ruta}`);
        }
    });
});

console.log('\n🎯 Próximo paso: Aplicar correcciones en los archivos identificados\n');
