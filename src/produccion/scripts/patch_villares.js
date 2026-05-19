require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabaseUrl = 'https://wofttcnpipozwupmpuul.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseKey) {
    console.error("❌ ERROR: SUPABASE_SERVICE_KEY no definida en el archivo .env.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixVillaresData() {
    console.log("=============================================");
    console.log("  INICIANDO DEPURACIÓN VILLARES (TICKET #100)");
    console.log("=============================================\n");

    try {
        // 1. Obtener ID del Proveedor Villares
        const { data: provData, error: provError } = await supabase
            .from('proveedores')
            .select('id, nombre')
            .eq('nombre', 'Villares')
            .single();

        if (provError || !provData) {
            throw new Error("No se pudo encontrar al proveedor Villares: " + (provError?.message || "Not found"));
        }
        
        const villaresId = provData.id;
        console.log(`✅ Proveedor Encontrado: ${provData.nombre} (${villaresId})`);

        // ==========================================
        // PARTE A: REHIDRATAR TABLA MAESTRA OPERATIVA
        // ==========================================
        console.log("\n--- Auditando tabla_maestra_operativa ---");
        
        const skusToPatch = [
            { codigo: '45903', descripcion: 'Harina de Avena', cant_bult: 1, cant_valor: 25 },
            { codigo: '45125', descripcion: 'Maíz Pisingallo', cant_bult: 1, cant_valor: 25, iva: 10.5 },
            { codigo: '44149', descripcion: 'Maíz Pisado Blanco', cant_bult: 1, cant_valor: 30, iva: 10.5 }
        ];

        for (const sku of skusToPatch) {
            // Verificar si existe
            const { data: existingData, error: checkError } = await supabase
                .from('tabla_maestra_operativa')
                .select('id, datos_maestros')
                .eq('proveedor_id', villaresId)
                .contains('datos_maestros', { codigo: sku.codigo });

            if (existingData && existingData.length > 0) {
                console.log(`⚠️  SKU ${sku.codigo} ya existe. Actualizando volumetría y alícuota...`);
                const existingRow = existingData[0];
                const updatedDatos = { ...existingRow.datos_maestros, cant_bult: sku.cant_bult, cant_valor: sku.cant_valor, codigo: sku.codigo };
                if (sku.iva) updatedDatos.iva = sku.iva;
                
                const { error: updateError } = await supabase
                    .from('tabla_maestra_operativa')
                    .update({ datos_maestros: updatedDatos })
                    .eq('id', existingRow.id);
                
                if (updateError) console.error(`❌ Error al actualizar SKU ${sku.codigo}:`, updateError.message);
                else console.log(`✅ SKU ${sku.codigo} actualizado con éxito.`);
            } else {
                console.log(`➕ SKU ${sku.codigo} no encontrado. Insertando nuevo registro...`);
                const newRow = {
                    proveedor_id: villaresId,
                    datos_maestros: {
                        codigo: sku.codigo,
                        cant_bult: sku.cant_bult,
                        cant_valor: sku.cant_valor,
                        descripcion: sku.descripcion
                    }
                };
                const { error: insertError } = await supabase
                    .from('tabla_maestra_operativa')
                    .insert(newRow);
                
                if (insertError) console.error(`❌ Error al insertar SKU ${sku.codigo}:`, insertError.message);
                else console.log(`✅ SKU ${sku.codigo} insertado con éxito.`);
            }
        }

        // ==========================================
        // PARTE B: VINCULAR FACTURAS HUÉRFANAS
        // ==========================================
        console.log("\n--- Auditando facturas_raw huérfanas ---");
        
        // Buscar facturas donde pedido_b2b_id es null, pero el match_report tiene datos
        const { data: facturasHuerfanas, error: fError } = await supabase
            .from('facturas_raw')
            .select('id, match_report')
            .is('pedido_b2b_id', null)
            .not('match_report', 'is', null);

        if (fError) {
            console.error("❌ Error al buscar facturas huérfanas:", fError.message);
        } else if (!facturasHuerfanas || facturasHuerfanas.length === 0) {
            console.log("✅ No se detectaron facturas con match_report pero sin pedido_b2b_id.");
        } else {
            console.log(`⚠️  Se detectaron ${facturasHuerfanas.length} facturas huérfanas con match_report.`);
            let arregladas = 0;
            
            for (const fac of facturasHuerfanas) {
                // Inferir pedido_b2b_id desde el match_report
                const mrArray = fac.match_report || [];
                let inferredPedidoId = null;
                
                for (const item of mrArray) {
                    if (item.pedido && item.pedido.pedido_id) {
                        inferredPedidoId = item.pedido.pedido_id;
                        break; // Tomamos el primer pedido_id que encontremos válido
                    }
                }
                
                if (inferredPedidoId) {
                    const { error: updateFacError } = await supabase
                        .from('facturas_raw')
                        .update({ pedido_b2b_id: inferredPedidoId })
                        .eq('id', fac.id);
                        
                    if (updateFacError) {
                        console.error(`❌ Error al actualizar factura ${fac.id}:`, updateFacError.message);
                    } else {
                        console.log(`✅ Factura ${fac.id} vinculada al pedido ${inferredPedidoId}.`);
                        arregladas++;
                    }
                } else {
                    console.log(`⏭️  Factura ${fac.id} no posee 'pedido_id' explícito en su match_report. Ignorada.`);
                }
            }
            console.log(`\n✅ Resumen: Se reparó el nexo de ${arregladas} facturas huérfanas.`);
        }

        console.log("\n=============================================");
        console.log("  DEPURACIÓN VILLARES COMPLETADA CON ÉXITO");
        console.log("=============================================\n");

    } catch (e) {
        console.error("❌ ERROR CRÍTICO:", e.message);
    }
}

fixVillaresData();
