require('dotenv').config({path: '.env'});
const fs = require('fs');

async function runPatch() {
    let envContent = fs.readFileSync('.env');
    envContent = Buffer.from(envContent.filter(b => b !== 0)).toString('utf8');
    const key = envContent.match(/SUPABASE_SERVICE_KEY=([^\r\n]+)/)[1].trim();

    const baseUrl = 'https://wofttcnpipozwupmpuul.supabase.co/rest/v1';
    const headers = {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    };

    console.log('--- 1. Insertando SKUs huérfanos de Bavosi ---');
    const bProvId = '8929039a-407e-40dd-a399-98d17f647dc4';
    const skusToInsert = [
        {
            proveedor_id: bProvId,
            archivo_origen_id: '3f2a8469-adb8-422b-817d-f68379dba066',
            nombre_proveedor: 'Bavosi',
            es_delta: false,
            datos_maestros: {
                codigo: "20102",
                descripcion: "ALMENDRAS PELADAS NON PAREIL",
                cant_bult: "1",
                cant_valor: "22.68",
                Origen_Sistema: "Parche Manual (Ticket #096)",
                _estado_delta: "ALTA"
            }
        },
        {
            proveedor_id: bProvId,
            archivo_origen_id: '3f2a8469-adb8-422b-817d-f68379dba066',
            nombre_proveedor: 'Bavosi',
            es_delta: false,
            datos_maestros: {
                codigo: "20912",
                descripcion: "DATILES C/CAROZO MEDJOUL",
                cant_bult: "1",
                cant_valor: "5",
                Origen_Sistema: "Parche Manual (Ticket #096)",
                _estado_delta: "ALTA"
            }
        }
    ];

    for (const sku of skusToInsert) {
        const res = await fetch(`${baseUrl}/tabla_maestra_operativa`, {
            method: 'POST',
            headers,
            body: JSON.stringify(sku)
        });
        if (!res.ok) {
            console.error(`Error insertando SKU ${sku.datos_maestros.codigo}:`, await res.text());
        } else {
            console.log(`SKU ${sku.datos_maestros.codigo} insertado correctamente.`);
        }
    }

    console.log('--- 2. Parcheando Trazabilidad Histórica de Lotes ---');
    const loteId = 'f6c0b78c-8d0b-484b-80b2-aa8ae4691f22';
    const historicDate = '2026-05-04T12:00:00+00:00';

    // Update cabecera
    const resCab = await fetch(`${baseUrl}/recepciones_fisicas_cabecera?id=eq.${loteId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
            fecha_recepcion: historicDate,
            created_at: historicDate
        })
    });
    if (!resCab.ok) {
        console.error('Error parcheando cabecera:', await resCab.text());
    } else {
        console.log('Cabecera parcheada correctamente.');
    }

    // Update items
    const resItems = await fetch(`${baseUrl}/recepciones_fisicas_items?recepcion_id=eq.${loteId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
            created_at: historicDate
        })
    });
    if (!resItems.ok) {
        console.error('Error parcheando items:', await resItems.text());
    } else {
        console.log('Items hijos parcheados correctamente.');
    }

    console.log('--- Proceso de parcheo finalizado ---');
}

runPatch();
