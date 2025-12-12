// filepath: src/actualizaPrecios/inspect-api.js
'use strict';

/**
 * Script de inspección de la API
 * Consulta la API real y muestra los campos que trae cada artículo
 * para verificar que 'familia' y 'subfamilia' están presentes
 */

const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
require('dotenv').config();

const LOMASOFT_ARTICULOS_URL =
  process.env.LOMASOFT_ARTICULOS_URL || 'https://api.lamdaser.com/api/articulos';

console.log('═══════════════════════════════════════════════════════');
console.log('🔍 [INSPECT-API] INSPECCIÓN DE API REAL');
console.log('═══════════════════════════════════════════════════════');
console.log(`📡 URL: ${LOMASOFT_ARTICULOS_URL}`);
console.log('═══════════════════════════════════════════════════════\n');

async function inspectAPI() {
  try {
    console.log('🚀 Consultando API...\n');

    // Consultar solo los primeros 5 artículos para inspección
    const url = `${LOMASOFT_ARTICULOS_URL}?limit=5`;
    console.log(`📞 GET ${url}\n`);

    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    
    // Determinar si es array directo o tiene estructura con data
    let articulos = [];
    if (Array.isArray(data)) {
      articulos = data;
    } else if (data.data && Array.isArray(data.data)) {
      articulos = data.data;
    } else {
      console.error('❌ Formato de respuesta no reconocido');
      console.log('Respuesta recibida:', JSON.stringify(data, null, 2));
      return;
    }

    if (articulos.length === 0) {
      console.log('⚠️ La API no devolvió artículos');
      return;
    }

    console.log(`✅ API respondió correctamente`);
    console.log(`📊 Total de artículos recibidos: ${articulos.length}\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 CAMPOS DISPONIBLES EN EL PRIMER ARTÍCULO:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const primerArticulo = articulos[0];
    const campos = Object.keys(primerArticulo);
    
    console.log(`Total de campos: ${campos.length}\n`);
    
    // Mostrar todos los campos
    campos.forEach((campo, index) => {
      const valor = primerArticulo[campo];
      const tipo = typeof valor;
      const preview = tipo === 'string' && valor.length > 50 
        ? valor.substring(0, 47) + '...' 
        : valor;
      
      console.log(`${(index + 1).toString().padStart(2, '0')}. ${campo.padEnd(25)} = ${preview} (${tipo})`);
    });

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 BÚSQUEDA DE CAMPOS CLAVE:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Buscar campos relacionados con rubro/categoría
    const camposRubro = campos.filter(c => 
      /familia|rubro|categoria|category|grupo|group/i.test(c)
    );

    if (camposRubro.length > 0) {
      console.log('✅ CAMPOS RELACIONADOS CON RUBRO/CATEGORÍA ENCONTRADOS:\n');
      camposRubro.forEach(campo => {
        console.log(`   🎯 ${campo}: ${primerArticulo[campo]}`);
      });
    } else {
      console.log('❌ NO se encontraron campos relacionados con rubro/categoría');
      console.log('   Campos buscados: familia, rubro, categoria, category, grupo, group');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 MUESTRA DE 3 ARTÍCULOS COMPLETOS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    articulos.slice(0, 3).forEach((art, index) => {
      console.log(`\n📄 Artículo ${index + 1}:`);
      console.log(JSON.stringify(art, null, 2));
      console.log('\n' + '─'.repeat(60));
    });

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('✅ INSPECCIÓN COMPLETADA');
    console.log('═══════════════════════════════════════════════════════\n');

    // Resumen final
    console.log('📋 RESUMEN:');
    console.log(`   • Total de campos por artículo: ${campos.length}`);
    console.log(`   • Campos relacionados con rubro: ${camposRubro.length}`);
    
    if (camposRubro.length > 0) {
      console.log('\n✅ VERIFICACIÓN: Los campos de rubro/categoría están presentes');
      console.log('   Campos encontrados:', camposRubro.join(', '));
    } else {
      console.log('\n⚠️ ADVERTENCIA: No se encontraron campos de rubro/categoría');
      console.log('   Revisa la lista completa de campos arriba');
    }

    console.log('\n═══════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Error al consultar la API:', error.message);
    
    if (error.message.includes('HTTP 404')) {
      console.log('\n💡 POSIBLES CAUSAS:');
      console.log('   1. La API no está disponible en este momento');
      console.log('   2. La URL ha cambiado');
      console.log('   3. Se requiere autenticación o VPN');
      console.log('   4. El túnel no está activo');
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 POSIBLES CAUSAS:');
      console.log('   1. No hay conexión a internet');
      console.log('   2. El servidor no está accesible');
      console.log('   3. Firewall bloqueando la conexión');
    }
    
    console.log('\n📝 URL intentada:', LOMASOFT_ARTICULOS_URL);
    console.log('\n═══════════════════════════════════════════════════════\n');
    
    process.exitCode = 1;
  }
}

// Ejecutar inspección
inspectAPI();
