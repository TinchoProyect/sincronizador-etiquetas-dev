/**
 * Normalizador Físico y Dimensional de Unidades y Metadatos de Ofertas (LAMDA)
 */

function extraerKilosYEmpaque(descripcionText, kilosUnidadArticulo = 1) {
    if (!descripcionText) {
        return { kilos: kilosUnidadArticulo || 1, patron: '1kg (default)' };
    }
    
    const text = descripcionText.toLowerCase();

    // 1. Patrón: "x 10kg", "10 kg", "10k"
    const matchKg = text.match(/(?:x\s*|bulto\s*x\s*|caja\s*x\s*|bolsa\s*x\s*|caja\s+de\s+)?(\d+(?:[\.,]\d+)?)\s*(?:kg|kilos|k)\b/i);
    if (matchKg) {
        const val = parseFloat(matchKg[1].replace(',', '.'));
        if (!isNaN(val) && val > 0) {
            return { kilos: val, patron: `${val}kg` };
        }
    }

    // 2. Patrón: "granel" o "bolsón 25kg"
    if (text.includes('granel') && !text.includes('kg')) {
        return { kilos: 25, patron: '25kg (granel)' };
    }

    // 3. Patrón gramos: "500g", "x 500 gramos"
    const matchG = text.match(/(?:x\s*)?(\d+(?:[\.,]\d+)?)\s*(?:g|gramos)\b/i);
    if (matchG) {
        const valG = parseFloat(matchG[1].replace(',', '.'));
        if (!isNaN(valG) && valG > 0) {
            return { kilos: valG / 1000, patron: `${valG}g` };
        }
    }

    // Fallback: usar los kilos unidad del artículo original
    return { kilos: kilosUnidadArticulo || 1, patron: `${kilosUnidadArticulo || 1}kg (artículo)` };
}

function calcularAntiguedadDias(fechaActualizacion) {
    if (!fechaActualizacion) return { dias: 999, esAntigua: true, etiqueta: '⚠️ Sin Fecha' };
    
    const fechaOferta = new Date(fechaActualizacion);
    const ahora = new Date();
    const difMs = ahora - fechaOferta;
    const dias = Math.max(0, Math.floor(difMs / (1000 * 60 * 60 * 24)));

    let etiqueta = `🟢 Hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
    if (dias > 45) {
        etiqueta = `⚠️ Hace ${dias} días (Oferta Antigua > 45d)`;
    } else if (dias > 15) {
        etiqueta = `🟡 Hace ${dias} días`;
    }

    return {
        dias,
        esAntigua: dias > 45,
        etiqueta
    };
}

function normalizarOfertaProveedor(row, kilosUnidadArt = 1) {
    const empaque = extraerKilosYEmpaque(row.descripcion_proveedor, kilosUnidadArt);
    const precioBulto = parseFloat(row.precio_costo) || 0;
    const costoKiloCalculado = empaque.kilos > 0 ? (precioBulto / empaque.kilos) : precioBulto;
    const antiguedad = calcularAntiguedadDias(row.fecha_actualizacion || row.updated_at);

    return {
        id: row.id,
        proveedor_id: row.proveedor_id,
        proveedor_nombre: row.proveedor_nombre || 'Proveedor Maestra',
        codigo_proveedor: row.codigo_proveedor || 'N/D',
        descripcion_proveedor: row.descripcion_proveedor || '',
        precio_costo_bulto: precioBulto,
        kilos_empaque: empaque.kilos,
        costo_kilo_calculado: parseFloat(costoKiloCalculado.toFixed(2)),
        fecha_actualizacion: row.fecha_actualizacion || row.updated_at,
        antiguedad_dias: antiguedad.dias,
        es_antigua: antiguedad.esAntigua,
        etiqueta_antiguedad: antiguedad.etiqueta
    };
}

module.exports = {
    extraerKilosYEmpaque,
    calcularAntiguedadDias,
    normalizarOfertaProveedor
};
