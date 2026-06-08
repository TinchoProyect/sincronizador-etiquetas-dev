-- 15. Agregar id_domicilio_entrega a ordenes_tratamiento para selección dinámica de destinos alternativos
ALTER TABLE public.ordenes_tratamiento 
ADD COLUMN IF NOT EXISTS id_domicilio_entrega INTEGER REFERENCES public.clientes_domicilios(id);
