/**
 * @file motorCalculadoraFiscal.js
 * @description Módulo encapsulado y puro (Sin efectos secundarios ni acoplamiento PDF)
 * que resuelve las lógicas matemáticas de costos finales asumiendo descuentos.
 */

/**
 * Procesa un registro del Lote de Producción (Artículo) cruzado con su Stock (Kilos)
 * y devuelve los componentes del costo real.
 * 
 * @param {Object} articulo - Objeto del iterador de impresión Lomasoft
 * @param {Object} presupuestoGeneral - Header del presupuesto (por si tiene descuentos extra, opcional)
 * @returns {Object} { precioBrutoUnitario, precioNetoReal, kilosTotales, precioPorKilo, descuentoAplicado }
 */
function extraerCostoFinanciero(articulo, presupuestoGeneral = null) {
    try {
        let precioBase = Number(articulo.valor1) || Number(articulo.precio1) || 0;
        let descuentoPorcentaje = 0;
        
        // 2. Detección de Descuentos
        // Descuento a Nivel Renglón (camp4 en presupuestos_detalles)
        if (articulo.descuento) {
            let descVal = Number(articulo.descuento) || 0;
            if (descVal <= 100) {
                descuentoPorcentaje += descVal;
            }
        } 
        
        // Descuento a Nivel Presupuesto Global (e.g., 0.05 significa 5%)
        if (presupuestoGeneral && presupuestoGeneral.descuento) {
            let descGlobal = Number(presupuestoGeneral.descuento) || 0;
            if (descGlobal > 0 && descGlobal < 1) { // Lomasoft almacena el global como fracción decimal
                descuentoPorcentaje += (descGlobal * 100);
            } else if (descGlobal >= 1 && descGlobal <= 100) {
                descuentoPorcentaje += descGlobal;
            }
        }

        // 3. Resolución Neta (Paso A)
        let factorDescuento = 1 - (descuentoPorcentaje / 100);
        let precioNetoReal = precioBase * factorDescuento;

        // NUEVO: Paso B - Precio con IVA
        let tasaIva = 0;
        if (articulo.iva_tasa) {
            let ivaVal = Number(articulo.iva_tasa) || 0;
            if (ivaVal > 0 && ivaVal < 1) { // Ej: 0.210 -> 21%
                tasaIva = ivaVal * 100;
            } else if (ivaVal >= 1) {
                tasaIva = ivaVal; // Ej: 21.0 -> 21%
            }
        }
        let precioConIva = precioNetoReal * (1 + (tasaIva / 100));

        // 4. Métrica de Kilos
        let kilosBase = Number(articulo.kilos_unidad || 0);
        let unidadesEmpaque = (articulo.es_pack && articulo.pack_unidades) ? Number(articulo.pack_unidades) : 1;
        // Empíricamente, la DB aloja el peso total del pack en kilos_unidad. 
        // No multiplicar por unidades de empaque.
        let kilosTotalesArticulo = kilosBase;

        // Paso C - Resultado Columna
        let precioPorKilo = (kilosTotalesArticulo > 0) ? (precioConIva / kilosTotalesArticulo) : null;
        let precioUnidad = (articulo.es_pack === true && unidadesEmpaque > 0) ? (precioConIva / unidadesEmpaque) : null;

        return {
            validez: true,
            precioBrutoUnitario: precioBase,
            descuentoPorcentaje: descuentoPorcentaje,
            tasaIva: tasaIva,
            precioNetoReal: precioNetoReal,
            precioConIva: precioConIva,
            kilosTotales: kilosTotalesArticulo,
            precioPorKilo: precioPorKilo,
            precioUnidad: precioUnidad
        };
    } catch (error) {
        console.error('❌ [CALC-FISCAL] Falla de cálculo en artículo:', articulo.articulo_numero, error);
        return { validez: false, error: error.message };
    }
}

/**
 * Acumulador iterativo para Total General del Remito.
 * Ignora los montos que no tengan validez.
 */
function calcularTotalRemitoAcumulado(articulosArray, presupuestoGeneral = null) {
    return articulosArray.reduce((acc, articulo) => {
        const { validez, precioConIva } = extraerCostoFinanciero(articulo, presupuestoGeneral);
        if (validez) {
            let cantidadRenglon = Number(articulo.cantidad || 1);
            return acc + (precioConIva * cantidadRenglon);
        }
        return acc;
    }, 0);
}

module.exports = {
    extraerCostoFinanciero,
    calcularTotalRemitoAcumulado
};
