    async function handleSubmit(event) {
        event.preventDefault();

        console.log('Ä‘ÂŸÂ“Â¤ [PRESUPUESTOS-EDIT] Iniciando envÄ‚Â­o de formulario...');

        const btnGuardar = document.getElementById('btn-guardar');
        const spinner = btnGuardar.querySelector('.loading-spinner');

        // Mostrar loading
        btnGuardar.disabled = true;
        spinner.style.display = 'inline-block';

        try {
            // Recopilar datos del formulario
            const form = event.target;
            const formData = new FormData(form);
            const data = {};

            // Campos principales
            data.id_cliente = formData.get('id_cliente');
            data.fecha = formData.get('fecha');
            data.tipo_comprobante = formData.get('tipo_comprobante');
            data.estado = formData.get('estado');
            data.agente = formData.get('agente');
            data.punto_entrega = formData.get('punto_entrega');

            // Normalizar descuento (aceptar 5 o 0.05) y mandarlo siempre como decimal
            const descUI = Number(formData.get('descuento')) || 0;
            const descuento = Number.isFinite(descUI)
                ? (descUI > 1 ? descUI / 100 : descUI)
                : 0;
            data.descuento = +descuento.toFixed(4);
            console.log(`[EDIT] Descuento normalizado ->`, { input: descUI, output: data.descuento });

            data.fecha_entrega = formData.get('fecha_entrega') || null;
            data.nota = formData.get('nota');

            // Validar campos obligatorios
            if (!data.id_cliente) throw new Error('ID Cliente es obligatorio');
            if (!data.fecha) throw new Error('Fecha es obligatoria');
            if (!data.estado) throw new Error('Estado es obligatorio');

            // CORRECCIÓN: Validar que haya al menos un detalle


            const tbody = document.getElementById('detalles-tbody');


            const filasDetalles = tbody ? tbody.querySelectorAll('tr') : [];





            console.log('[EDIT-DETALLE] Validación de detalles:', {


                tbody_existe: !!tbody,


                cantidad_filas: filasDetalles.length


            });





            if (!tbody || filasDetalles.length === 0) {


                console.error('[EDIT-DETALLE] ❌ Validación fallida: No hay detalles');


                throw new Error('El presupuesto debe tener al menos un artículo antes de guardar.');


            }





            console.log('[EDIT-DETALLE] ✅ Validación de detalles exitosa');

            // Validar cada fila del DOM
            const rows = tbody.querySelectorAll('tr');
            for (const row of rows) {
                const artInput = row.querySelector('input[name*="[articulo]"]');
                const cantInput = row.querySelector('input[name*="[cantidad]"]');
                const valorInput = row.querySelector('input[name*="[valor1]"]');
                const ivaInput = row.querySelector('input[name*="[iva1]"]');

                if (!artInput || !artInput.value.trim()) {
                    throw new Error('Todos los detalles deben tener un artÄ‚Â­culo vÄ‚Ä„lido');
                }
                // Validar que el artÄ‚Â­culo tenga cÄ‚Å‚digo de barras (seleccionado desde autocompletar)
                if (!artInput.dataset.codigoBarras || !artInput.dataset.codigoBarras.trim()) {
                    throw new Error(`El artÄ‚Â­culo "${artInput.value}" no es vÄ‚Ä„lido. SelecciÄ‚Å‚nalo desde el autocompletar.`);
                }
                if (!cantInput || parseFloat(cantInput.value) <= 0) {
                    throw new Error('Todos los detalles deben tener una cantidad mayor a cero');
                }
                if (!valorInput || parseFloat(valorInput.value) < 0) {
                    throw new Error('Todos los detalles deben tener un valor unitario vÄ‚Ä„lido');
                }
                if (!ivaInput || parseFloat(ivaInput.value) < 0) {
                    throw new Error('Todos los detalles deben tener un IVA vÄ‚Ä„lido');
                }
            }

            // Serializar detalles del DOM con el mismo formato que espera el POST
            const detalles = [];
            rows.forEach(row => {
                const artInput = row.querySelector('input[name*="[articulo]"]');
                const cantInput = row.querySelector('input[name*="[cantidad]"]');
                const valorInput = row.querySelector('input[name*="[valor1]"]');
                const ivaInput = row.querySelector('input[name*="[iva1]"]');

                if (artInput && artInput.dataset.codigoBarras) {
                    detalles.push({
                        articulo: artInput.dataset.codigoBarras.trim(),  // CÄ‚Å‚digo de barras
                        cantidad: parseFloat(cantInput.value) || 0,      // Cantidad
                        valor1: parseFloat(valorInput.value) || 0,       // Neto unitario
                        iva1: parseFloat(ivaInput.value) || 0            // IVA (% o decimal, backend normaliza)
                    });
                }
            });

            console.log(`[PUT-FRONT] detalles serializados:`, detalles.length, detalles[0]);

            // Enviar actualizaciÄ‚Å‚n del presupuesto (cabecera + detalles)
            const updateData = {
                // Campos existentes (ya funcionan)
                agente: data.agente,
                punto_entrega: data.punto_entrega,
                descuento: data.descuento,
                fecha_entrega: data.fecha_entrega,
                nota: data.nota,

                // NUEVOS: Campos del encabezado que faltaban
                tipo_comprobante: data.tipo_comprobante,
                estado: data.estado,
                id_cliente: data.id_cliente,
                fecha: data.fecha,
                secuencia: (data.estado === 'Orden de Retiro' || new URLSearchParams(window.location.search).get('modo') === 'retiro')
                    ? 'Pedido_Listo'
                    : 'Imprimir', // REQ: "Pedido_Listo" si es Retiro, sino "Imprimir"
