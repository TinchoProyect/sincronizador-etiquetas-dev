-- Migración 25: Trigger de Stock Satélite y Movimientos por Venta de Mezclas
-- Fecha: 5 de Julio de 2026

BEGIN;

-- 1. Crear tabla de movimientos de stock satélite
CREATE TABLE IF NOT EXISTS public.colaborador_stock_satelite_movimientos (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    ingrediente_id INTEGER NOT NULL REFERENCES public.ingredientes(id) ON DELETE CASCADE,
    kilos NUMERIC(15,4) NOT NULL,
    tipo VARCHAR(50) NOT NULL, -- 'transferencia', 'egreso_produccion', 'egreso_venta', 'devolucion_venta'
    carro_id INTEGER REFERENCES public.carros_produccion(id) ON DELETE SET NULL,
    presupuesto_id INTEGER REFERENCES public.presupuestos(id) ON DELETE SET NULL,
    observaciones TEXT,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    stock_anterior NUMERIC(15,4) DEFAULT 0.0000
);

CREATE INDEX IF NOT EXISTS idx_colab_stock_sat_mov_user ON public.colaborador_stock_satelite_movimientos(usuario_id);

-- 2. Crear trigger para actualizar stock_actual en colaborador_stock_satelite al insertar en movimientos
CREATE OR REPLACE FUNCTION public.actualizar_stock_satelite()
RETURNS TRIGGER AS $$
DECLARE
    v_stock_anterior NUMERIC(15,4);
BEGIN
    -- Obtener stock actual antes del movimiento para registrarlo como stock_anterior
    SELECT COALESCE(stock_actual, 0.0000) INTO v_stock_anterior
    FROM public.colaborador_stock_satelite
    WHERE usuario_id = NEW.usuario_id AND ingrediente_id = NEW.ingrediente_id;

    IF NOT FOUND THEN
        v_stock_anterior := 0.0000;
        INSERT INTO public.colaborador_stock_satelite (usuario_id, ingrediente_id, stock_actual, ultima_actualizacion)
        VALUES (NEW.usuario_id, NEW.ingrediente_id, NEW.kilos, NOW());
    ELSE
        UPDATE public.colaborador_stock_satelite
        SET stock_actual = stock_actual + NEW.kilos,
            ultima_actualizacion = NOW()
        WHERE usuario_id = NEW.usuario_id AND ingrediente_id = NEW.ingrediente_id;
    END IF;

    -- Actualizar el stock_anterior en el propio registro de movimiento
    NEW.stock_anterior := v_stock_anterior;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_actualizar_stock_satelite
BEFORE INSERT ON public.colaborador_stock_satelite_movimientos
FOR EACH ROW
EXECUTE FUNCTION public.actualizar_stock_satelite();

-- 3. Trigger sobre presupuestos_detalles para registrar consumo de insumos por venta de mezcla
CREATE OR REPLACE FUNCTION public.actualizar_stock_satelite_por_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_usuario_id INTEGER;
    r_ing RECORD;
    v_consumo NUMERIC(15,4);
    v_diff NUMERIC(15,4);
BEGIN
    -- Obtener usuario_id asociado al lomas_soft_id (legacy) del presupuesto
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        SELECT usuario_id INTO v_usuario_id
        FROM public.bunker_clientes
        WHERE TRIM(lomas_soft_id) = (
            SELECT TRIM(id_cliente) 
            FROM public.presupuestos 
            WHERE id = NEW.id_presupuesto
        ) AND usuario_id IS NOT NULL;
    ELSIF (TG_OP = 'DELETE') THEN
        SELECT usuario_id INTO v_usuario_id
        FROM public.bunker_clientes
        WHERE TRIM(lomas_soft_id) = (
            SELECT TRIM(id_cliente) 
            FROM public.presupuestos 
            WHERE id = OLD.id_presupuesto
        ) AND usuario_id IS NOT NULL;
    END IF;

    IF v_usuario_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Registrar egreso/ajuste en colaborador_stock_satelite_movimientos
    IF (TG_OP = 'INSERT') THEN
        FOR r_ing IN (
            SELECT ri.ingrediente_id, ri.cantidad AS cantidad_receta
            FROM public.recetas r
            JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
            WHERE r.articulo_numero = NEW.articulo AND ri.ingrediente_id IS NOT NULL
        ) LOOP
            v_consumo := NEW.cantidad * r_ing.cantidad_receta;
            
            INSERT INTO public.colaborador_stock_satelite_movimientos 
                (usuario_id, ingrediente_id, kilos, tipo, presupuesto_id, observaciones)
            VALUES 
                (v_usuario_id, r_ing.ingrediente_id, -v_consumo, 'egreso_venta', NEW.id_presupuesto, 
                 'Egreso proporcional automático por compra de mezcla ' || NEW.articulo);
        END LOOP;

    ELSIF (TG_OP = 'DELETE') THEN
        FOR r_ing IN (
            SELECT ri.ingrediente_id, ri.cantidad AS cantidad_receta
            FROM public.recetas r
            JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
            WHERE r.articulo_numero = OLD.articulo AND ri.ingrediente_id IS NOT NULL
        ) LOOP
            v_consumo := OLD.cantidad * r_ing.cantidad_receta;
            
            INSERT INTO public.colaborador_stock_satelite_movimientos 
                (usuario_id, ingrediente_id, kilos, tipo, presupuesto_id, observaciones)
            VALUES 
                (v_usuario_id, r_ing.ingrediente_id, v_consumo, 'devolucion_venta', OLD.id_presupuesto, 
                 'Reversión automática por cancelación de línea de mezcla ' || OLD.articulo);
        END LOOP;

    ELSIF (TG_OP = 'UPDATE') THEN
        IF (NEW.articulo <> OLD.articulo) THEN
            -- Revertir viejo artículo
            FOR r_ing IN (
                SELECT ri.ingrediente_id, ri.cantidad AS cantidad_receta
                FROM public.recetas r
                JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
                WHERE r.articulo_numero = OLD.articulo AND ri.ingrediente_id IS NOT NULL
            ) LOOP
                v_consumo := OLD.cantidad * r_ing.cantidad_receta;
                
                INSERT INTO public.colaborador_stock_satelite_movimientos 
                    (usuario_id, ingrediente_id, kilos, tipo, presupuesto_id, observaciones)
                VALUES 
                    (v_usuario_id, r_ing.ingrediente_id, v_consumo, 'devolucion_venta', OLD.id_presupuesto, 
                     'Reversión automática por cambio de artículo de mezcla ' || OLD.articulo);
            END LOOP;

            -- Aplicar nuevo artículo
            FOR r_ing IN (
                SELECT ri.ingrediente_id, ri.cantidad AS cantidad_receta
                FROM public.recetas r
                JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
                WHERE r.articulo_numero = NEW.articulo AND ri.ingrediente_id IS NOT NULL
            ) LOOP
                v_consumo := NEW.cantidad * r_ing.cantidad_receta;
                
                INSERT INTO public.colaborador_stock_satelite_movimientos 
                    (usuario_id, ingrediente_id, kilos, tipo, presupuesto_id, observaciones)
                VALUES 
                    (v_usuario_id, r_ing.ingrediente_id, -v_consumo, 'egreso_venta', NEW.id_presupuesto, 
                     'Egreso proporcional automático por compra de mezcla ' || NEW.articulo);
            END LOOP;
        ELSE
            v_diff := NEW.cantidad - OLD.cantidad;
            IF (v_diff <> 0) THEN
                FOR r_ing IN (
                    SELECT ri.ingrediente_id, ri.cantidad AS cantidad_receta
                    FROM public.recetas r
                    JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
                    WHERE r.articulo_numero = NEW.articulo AND ri.ingrediente_id IS NOT NULL
                ) LOOP
                    v_consumo := v_diff * r_ing.cantidad_receta;
                    
                    INSERT INTO public.colaborador_stock_satelite_movimientos 
                        (usuario_id, ingrediente_id, kilos, tipo, presupuesto_id, observaciones)
                    VALUES 
                        (v_usuario_id, r_ing.ingrediente_id, -v_consumo, 'egreso_venta', NEW.id_presupuesto, 
                         'Ajuste automático de cantidad por compra de mezcla ' || NEW.articulo);
                END LOOP;
            END IF;
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_actualizar_stock_satelite_por_venta ON public.presupuestos_detalles;
CREATE TRIGGER trg_actualizar_stock_satelite_por_venta
AFTER INSERT OR UPDATE OR DELETE ON public.presupuestos_detalles
FOR EACH ROW
EXECUTE FUNCTION public.actualizar_stock_satelite_por_venta();

COMMIT;
