d.imprimirZPL) {
                        try {
                            // Construir el nombre completo de destino buscando en la cache
                            let artNombreDest = '' + payload.articuloDestino;
                            if (window.articulosCache) {
                                const articuloDbg = window.articulosCache.find(a => a.numero.toString() === payload.articuloDestino.toString());
                                if (articuloDbg) artNombreDest = articuloDbg.nombre;
                            }
                            
                            const resImp = await fetch('http://localhost:3000/api/imprimir', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    articulo: artNombreDest,
                                    fecha: new Date().toLocaleDateString('es-AR'),
                                    responsable_id: payload.responsable,
                                    cantidad: payload.copiasZPL || 1,
                                    estado: '1'
                                })
                            });
                            if(!resImp.ok) throw new Error('Error al conectar con spooler Zebra local.');
                        } catch(errImp) {
                            console.error('Error Zebra:', errImp);
                            Swal.fire('Atención', 'Stock liberado y reenvasado a ventas, pero la impresora Zebra no re