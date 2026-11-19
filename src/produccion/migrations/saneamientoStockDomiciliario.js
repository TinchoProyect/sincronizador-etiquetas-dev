/**
 * Migración estructural idempotente para Stock Domiciliario de Colaboradores
 * (`public.ingredientes_stock_usuarios`).
 *
 * Regla dura de arquitectura:
 * - `origen_carro_id` queda reservado EXCLUSIVAMENTE para egresos negativos
 *   (`tipo_movimiento = 'consumo_produccion'`) al confirmar el carro externo.
 * - Todo ingreso/ajuste (`abastecimiento_deposito`, `compra_externa`, `ajuste_inventario`)
 *   se graba con `origen_carro_id = NULL` y conserva `carro_referencia_id` únicamente
 *   como metadato informativo, evitando que eliminar/revertir un carro borre mercadería
 *   física en el domicilio del colaborador.
 */

async function asegurarEsquemaStockDomiciliario(db) {
    await db.query(`
        ALTER TABLE public.ingredientes_stock_usuarios
            ADD COLUMN IF NOT EXISTS tipo_movimiento VARCHAR(40),
            ADD COLUMN IF NOT EXISTS observaciones TEXT,
            ADD COLUMN IF NOT EXISTS articulo_origen_numero VARCHAR(60),
            ADD COLUMN IF NOT EXISTS carro_referencia_id INTEGER;
    `);

    // 1. Desacoplar cualquier ingreso positivo histórico que tuviera origen_carro_id hacia carro_referencia_id
    const { rowCount: desacoplados } = await db.query(`
        UPDATE public.ingredientes_stock_usuarios
           SET carro_referencia_id = COALESCE(carro_referencia_id, origen_carro_id),
               origen_carro_id = NULL,
               tipo_movimiento = COALESCE(
                   tipo_movimiento,
                   CASE
                       WHEN contexto_envase IS NOT NULL THEN 'abastecimiento_deposito'
                       ELSE 'ajuste_inventario'
                   END
               )
         WHERE cantidad > 0
           AND origen_carro_id IS NOT NULL;
    `);

    // 2. Completar tipo_movimiento en registros históricos donde siga NULL (sin alterar cantidades)
    const { rowCount: clasificados } = await db.query(`
        UPDATE public.ingredientes_stock_usuarios
           SET tipo_movimiento = CASE
               WHEN cantidad < 0 AND origen_carro_id IS NOT NULL THEN 'consumo_produccion'
               WHEN cantidad > 0 AND contexto_envase IS NOT NULL THEN 'abastecimiento_deposito'
               ELSE 'ajuste_inventario'
           END
         WHERE tipo_movimiento IS NULL;
    `);

    return {
        ok: true,
        ingresos_desacoplados: desacoplados || 0,
        historicos_clasificados: clasificados || 0
    };
}

module.exports = {
    asegurarEsquemaStockDomiciliario
};
